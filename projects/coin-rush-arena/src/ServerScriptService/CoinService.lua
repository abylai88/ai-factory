-- Coin Rush Arena: server-side coin spawning & collection service.
-- Handles multi-type coins, procedural spawning, and collection validation.
-- This is a ModuleScript in ServerScriptService (server-only).

local Players = game:GetService("Players")
local ServerStorage = game:GetService("ServerStorage")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local CoinMath = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinMath"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local CoinService = {}

local activeCoins = {} -- { [coinPart] = { coinType: string, value: number } }
local debounce = {}    -- { [player]: { [coinId]: number } } — timestamp per player per coin
local coinsFolder: Folder? = nil

-- Cache the coin collected remote
local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
local coinCollectedRemote = remotesFolder:WaitForChild(RemoteNames.CoinCollected)

-- Initialize the coins folder in workspace.
function CoinService.init()
	if not workspace:FindFirstChild("Coins") then
		coinsFolder = Instance.new("Folder")
		coinsFolder.Name = "Coins"
		coinsFolder.Parent = workspace
	else
		coinsFolder = workspace:FindFirstChild("Coins")
	end
end

-- Weighted random selection for arena-specific coin types.
function CoinService.selectCoinType(coinTypeConfig: { [string]: any }): string
	local totalWeight = 0
	for _, info in pairs(coinTypeConfig) do
		totalWeight += info.Weight
	end

	local roll = math.random() * totalWeight
	local cumulative = 0
	for name, info in pairs(coinTypeConfig) do
		cumulative += info.Weight
		if roll <= cumulative then
			return name
		end
	end
	return "Bronze"
end

-- Get a random spawn position, optionally restricted by zone.
function CoinService.getRandomSpawnPosition(zoneMultiplier: number?): Vector3
	local halfSize = (Config.COIN_SPAWN_AREA_SIZE / 2) * (zoneMultiplier or 1.0)
	return Vector3.new(
		math.random(-halfSize * 100, halfSize * 100) / 100,
		Config.COIN_SPAWN_HEIGHT,
		math.random(-halfSize * 100, halfSize * 100) / 100
	)
end

-- Spawn a single world coin.
function CoinService.spawnCoin(): Part?
	if not coinsFolder then
		CoinService.init()
	end
	if not coinsFolder then return nil end

	-- Count active coins
	local count = 0
	for _ in pairs(activeCoins) do
		count += 1
	end
	if count >= Config.COIN_MAX_COUNT then return nil end

	-- Select coin type by weighted random
	local coinTypeName = CoinService.selectCoinType(Config.COIN_TYPES)
	local coinInfo = Config.COIN_TYPES[coinTypeName]
	local restriction = Config.COIN_SPAWN_RESTRICTION[coinTypeName] or 1.0

	local coin = Instance.new("Part")
	coin.Name = "Coin"
	coin.Shape = Enum.PartType.Cylinder
	coin.Size = coinInfo.Size
	coin.Color = coinInfo.Color
	coin.Material = coinInfo.Material
	coin.Anchored = true
	coin.CanCollide = false
	coin.CFrame = CFrame.new(
		CoinService.getRandomSpawnPosition(restriction)
	) * CFrame.Angles(0, 0, math.rad(90)) -- orient cylinder horizontally
	coin:SetAttribute("CoinType", coinTypeName)
	coin:SetAttribute("CoinValue", coinInfo.Value)
	coin:SetAttribute("Collecting", false)
	coin.Parent = coinsFolder

	activeCoins[coin] = { coinType = coinTypeName, value = coinInfo.Value }

	-- Touch handler
	coin.Touched:Connect(function(hit: BasePart)
		if coin:GetAttribute("Collecting") then return end

		local character = hit.Parent
		if not character then return end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if not humanoid or humanoid.Health <= 0 then return end
		local player = Players:GetPlayerFromCharacter(character)
		if not player then return end

		-- Debounce check (0.3s cooldown per player per coin)
		local now = tick()
		local playerDebounce = debounce[player]
		if playerDebounce then
			local lastCollect = playerDebounce[coin]
			if lastCollect and (now - lastCollect) < Config.COIN_TOUCH_COOLDOWN then
				return
			end
		else
			debounce[player] = {}
		end

		-- Magnet range check - collect all coins within magnet radius
		local rootPart = character:FindFirstChild("HumanoidRootPart")
		if rootPart then
			local data = PlayerData.get(player)
			local magnetRadius = CoinMath.magnetRadius(
				Config.MAGNET_BASE_RADIUS,
				Config.MAGNET_PER_LEVEL,
				Config.MAGNET_MAX_RADIUS,
				data.MagnetLevel
			)

			-- If magnet level > 0, check for nearby coins to auto-collect
			if data.MagnetLevel > 0 then
				for otherCoin, coinData in pairs(activeCoins) do
					if otherCoin ~= coin and otherCoin.Parent then
						local distance = (otherCoin.Position - rootPart.Position).Magnitude
						if distance <= magnetRadius then
							-- Auto-collect this coin
							if otherCoin:GetAttribute("Collecting") then continue end
							otherCoin:SetAttribute("Collecting", true)

							-- Calculate value with multiplier
							local multiplier = CoinMath.coinMultiplier(
								Config.MULTI_BASE,
								Config.MULTI_PER_LEVEL,
								data.MultiplierLevel
							)
							local finalValue = CoinMath.calculateCoinValue(coinData.value, multiplier)

							-- Award coins
							PlayerData.addCoins(player, finalValue)

							-- Notify client for feedback
							if coinCollectedRemote then
								coinCollectedRemote:FireClient(player, coinData.coinType, finalValue)
							end

							-- Remove and destroy
							activeCoins[otherCoin] = nil
							otherCoin:Destroy()
							task.delay(Config.COIN_RESPAWN_SECONDS, function()
								CoinService.spawnCoin()
							end)
						end
					end
				end
			end
		end

		-- Mark collecting
		coin:SetAttribute("Collecting", true)
		debounce[player][coin] = now

		-- Calculate coin value with multiplier
		local data = PlayerData.get(player)
		local multiplier = CoinMath.coinMultiplier(
			Config.MULTI_BASE,
			Config.MULTI_PER_LEVEL,
			data.MultiplierLevel
		)
		local finalValue = CoinMath.calculateCoinValue(coinInfo.Value, multiplier)

		-- Award coins (server-authoritative)
		PlayerData.addCoins(player, finalValue)

		-- Notify client for feedback
		if coinCollectedRemote then
			coinCollectedRemote:FireClient(player, coinTypeName, finalValue)
		end

		-- Remove from tracking
		activeCoins[coin] = nil
		debounce[player][coin] = nil

		-- Destroy and respawn
		coin:Destroy()
		task.delay(Config.COIN_RESPAWN_SECONDS, function()
			CoinService.spawnCoin()
		end)
	end)

	return coin
end

-- Spawn initial batch of coins.
function CoinService.startSpawning()
	CoinService.init()
	for _ = 1, Config.COIN_MAX_COUNT do
		task.defer(function()
			CoinService.spawnCoin()
		end)
	end
end

-- Clean up a player's debounce data on leave.
function CoinService.onPlayerRemoving(player: Player)
	debounce[player] = nil
end

return CoinService
