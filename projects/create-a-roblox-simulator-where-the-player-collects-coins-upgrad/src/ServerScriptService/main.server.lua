-- AI Factory Roblox template: server entry point.
-- Server-authoritative gameplay lives here (or in ModuleScripts required
-- from here). Never trust the client with authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")
local ServerStorage = game:GetService("ServerStorage")
local Workspace = game:GetService("Workspace")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))
local CoinService = require(ServerStorage:WaitForChild("CoinService"))

-------------------------------------------------------------------------------
-- 1. Resolve RemoteEvents (declared in Rojo under ReplicatedStorage/Remotes)
-------------------------------------------------------------------------------

local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
local requestUpgrade = remotesFolder:WaitForChild("RequestUpgrade") :: RemoteEvent
local coinCollected = remotesFolder:WaitForChild("CoinCollected") :: RemoteEvent

-------------------------------------------------------------------------------
-- 2. Coin spawning
-------------------------------------------------------------------------------

local COIN_SPAWN_POINTS = {
	Vector3.new(10, 2, 10),
	Vector3.new(-10, 2, 10),
	Vector3.new(10, 2, -10),
	Vector3.new(-10, 2, -10),
	Vector3.new(0, 2, 20),
	Vector3.new(0, 2, -20),
	Vector3.new(20, 2, 0),
	Vector3.new(-20, 2, 0),
}

local coinsFolder = Instance.new("Folder")
coinsFolder.Name = "Coins"
coinsFolder.Parent = Workspace

local nextCoinId = 0

local function spawnCoin(): Part
	nextCoinId += 1
	local spawnPoint = COIN_SPAWN_POINTS[math.random(1, #COIN_SPAWN_POINTS)]

	local coin = Instance.new("Part")
	coin.Name = "Coin"
	coin.Shape = Enum.PartType.Cylinder
	coin.Size = Vector3.new(0.3, 1, 1)
	coin.Color = Color3.fromRGB(255, 215, 0) -- gold
	coin.Material = Enum.Material.Neon
	coin.Anchored = true
	coin.CanCollide = false
	coin.Position = spawnPoint
	coin:SetAttribute("CoinId", nextCoinId)
	coin:SetAttribute("Collecting", false)
	coin.Parent = coinsFolder

	coin.Touched:Connect(function(hit: BasePart)
		-- Debounce: skip if already being collected.
		if coin:GetAttribute("Collecting") then
			return
		end

		-- Determine which player touched the coin.
		local character = hit.Parent
		if not character then
			return
		end
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if not humanoid or humanoid.Health <= 0 then
			return
		end
		local player = Players:GetPlayerFromCharacter(character)
		if not player then
			return
		end

		-- Mark collecting to prevent double-trigger.
		coin:SetAttribute("Collecting", true)

		-- Award coins (server-authoritative).
		PlayerData.addCoins(player, Config.COIN_VALUE)

		-- Notify client (optional feedback).
		coinCollected:FireClient(player)

		-- Remove coin and respawn after delay.
		coin:Destroy()
		task.delay(Config.COIN_RESPAWN_SECONDS, spawnCoin)
	end)

	return coin
end

-------------------------------------------------------------------------------
-- 3. Speed upgrade handler
-------------------------------------------------------------------------------

requestUpgrade.OnServerEvent:Connect(function(player: Player)
	local data = PlayerData.get(player)

	-- Check if already at max speed.
	if data.SpeedLevel >= Config.SPEED_UPGRADE_MAX then
		return
	end

	-- Calculate cost and validate balance.
	local cost = CoinService.upgradeCost(Config.UPGRADE_BASE_COST, data.SpeedLevel)
	if data.Coins < cost then
		return
	end

	-- Deduct coins.
	PlayerData.addCoins(player, -cost)

	-- Increment speed level and sync to leaderstats.
	data.SpeedLevel += 1
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local speedValue = leaderstats:FindFirstChild("SpeedLevel")
		if speedValue and speedValue:IsA("IntValue") then
			speedValue.Value = data.SpeedLevel
		end
	end

	-- Apply new walk speed.
	local newSpeed = CoinService.nextWalkSpeed(
		Config.START_WALK_SPEED,
		Config.SPEED_UPGRADE_STEP,
		Config.SPEED_UPGRADE_MAX,
		data.SpeedLevel
	)
	local character = player.Character
	if character then
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.WalkSpeed = newSpeed
		end
	end
end)

-------------------------------------------------------------------------------
-- 4. Player lifecycle
-------------------------------------------------------------------------------

local function setupLeaderstats(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	local speedLevel = Instance.new("IntValue")
	speedLevel.Name = "SpeedLevel"
	speedLevel.Value = 0
	speedLevel.Parent = leaderstats

	leaderstats.Parent = player
end

local function onPlayerAdded(player: Player)
	print(("[AI FACTORY] Player joined: %s (game: %s)"):format(player.Name, Config.GAME_NAME))
	setupLeaderstats(player)

	-- Load saved data from DataStore (fills cache + syncs leaderstats).
	PlayerData.load(player)

	-- Apply saved walk speed.
	local data = PlayerData.get(player)
	local speed = CoinService.nextWalkSpeed(
		Config.START_WALK_SPEED,
		Config.SPEED_UPGRADE_STEP,
		Config.SPEED_UPGRADE_MAX,
		data.SpeedLevel
	)
	player.CharacterAdded:Connect(function(character: Model)
		local humanoid = character:WaitForChild("Humanoid") :: Humanoid
		humanoid.WalkSpeed = speed
	end)
	if player.Character then
		local humanoid = player.Character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			humanoid.WalkSpeed = speed
		end
	end
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

-------------------------------------------------------------------------------
-- 5. Spawn initial coins
-------------------------------------------------------------------------------

for _ = 1, #COIN_SPAWN_POINTS do
	spawnCoin()
end

-------------------------------------------------------------------------------
-- 6. Autosave loop
-------------------------------------------------------------------------------

task.spawn(function()
	while true do
		task.wait(Config.AUTOSAVE_SECONDS)
		for _, player in ipairs(Players:GetPlayers()) do
			PlayerData.save(player)
		end
	end
end)

print("[AI FACTORY] Roblox server online")
