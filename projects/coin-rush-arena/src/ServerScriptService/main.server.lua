-- Coin Rush Arena: server entry point / orchestrator.
-- Server-authoritative gameplay lives here and in ModuleScripts required
-- from here. Never trust the client with authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Shared modules
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local CoinMath = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinMath"))
local UpgradeConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("UpgradeConfig"))

-- Server modules
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))
local CoinService = require(script.Parent:WaitForChild("CoinService"))
local ArenaService = require(script.Parent:WaitForChild("ArenaService"))
local OfflineService = require(script.Parent:WaitForChild("OfflineService"))
local DailyRewardService = require(script.Parent:WaitForChild("DailyRewardService"))
local LeaderboardService = require(script.Parent:WaitForChild("LeaderboardService"))
local PartyService = require(script.Parent:WaitForChild("PartyService"))

-------------------------------------------------------------------------------
-- 1. Resolve RemoteEvents (declared in Rojo under ReplicatedStorage/Remotes)
-------------------------------------------------------------------------------

local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")

local requestUpgrade = remotesFolder:WaitForChild(RemoteNames.RequestUpgrade) :: RemoteEvent
local coinCollected = remotesFolder:WaitForChild(RemoteNames.CoinCollected) :: RemoteEvent
local joinArena = remotesFolder:WaitForChild(RemoteNames.JoinArena) :: RemoteEvent
local leaveQueue = remotesFolder:WaitForChild(RemoteNames.LeaveQueue) :: RemoteEvent
local arenaCoinPickup = remotesFolder:WaitForChild(RemoteNames.ArenaCoinPickup) :: RemoteEvent
local claimDailyReward = remotesFolder:WaitForChild(RemoteNames.ClaimDailyReward) :: RemoteEvent
local claimOfflineCoins = remotesFolder:WaitForChild(RemoteNames.ClaimOfflineCoins) :: RemoteEvent
local leaderboardData = remotesFolder:WaitForChild(RemoteNames.LeaderboardData) :: RemoteEvent

-------------------------------------------------------------------------------
-- 2. Player lifecycle
-------------------------------------------------------------------------------

local initializedPlayers = {}

local function setupLeaderstats(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = Config.LEADERSTATS_FOLDER

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	local totalCoins = Instance.new("IntValue")
	totalCoins.Name = "TotalCoins"
	totalCoins.Value = 0
	totalCoins.Parent = leaderstats

	local speedLevel = Instance.new("IntValue")
	speedLevel.Name = "SpeedLevel"
	speedLevel.Value = 0
	speedLevel.Parent = leaderstats

	local magnetLevel = Instance.new("IntValue")
	magnetLevel.Name = "MagnetLevel"
	magnetLevel.Value = 0
	magnetLevel.Parent = leaderstats

	local powerLevel = Instance.new("IntValue")
	powerLevel.Name = "PowerLevel"
	powerLevel.Value = 0
	powerLevel.Parent = leaderstats

	local multiplierLevel = Instance.new("IntValue")
	multiplierLevel.Name = "MultiplierLevel"
	multiplierLevel.Value = 0
	multiplierLevel.Parent = leaderstats

	local arenaWins = Instance.new("IntValue")
	arenaWins.Name = "ArenaWins"
	arenaWins.Value = 0
	arenaWins.Parent = leaderstats

	local arenaRating = Instance.new("IntValue")
	arenaRating.Name = "ArenaRating"
	arenaRating.Value = 1000
	arenaRating.Parent = leaderstats

	leaderstats.Parent = player
end

local function applyWalkSpeed(player: Player)
	local character = player.Character
	if not character then return end
	local humanoid = character:FindFirstChildOfClass("Humanoid")
	if not humanoid then return end

	local data = PlayerData.get(player)
	local speed = CoinMath.nextWalkSpeed(
		Config.START_WALK_SPEED,
		Config.SPEED_UPGRADE_STEP,
		Config.SPEED_UPGRADE_MAX,
		data.SpeedLevel
	)
	humanoid.WalkSpeed = speed

	-- Apply movement feel tuning from GDD
	humanoid.UseJumpPower = true
	humanoid.JumpPower = 62
	humanoid.WalkAcceleration = 80
	humanoid.WalkDeceleration = 120
end

local function onPlayerAdded(player: Player)
	-- Race condition guard
	if initializedPlayers[player] then return end
	initializedPlayers[player] = true

	print(("[CoinRushArena] Player joined: %s"):format(player.Name))

	-- Setup leaderstats
	setupLeaderstats(player)

	-- Load saved data from DataStore
	PlayerData.load(player)

	-- Apply walk speed on spawn
	player.CharacterAdded:Connect(function()
		applyWalkSpeed(player)
	end)
	if player.Character then
		applyWalkSpeed(player)
	end

	-- Notify client of offline coins (after data loaded)
	task.defer(function()
		OfflineService.notifyClient(player)
		DailyRewardService.notifyClient(player)
	end)
end

local function onPlayerRemoving(player: Player)
	initializedPlayers[player] = nil
	CoinService.onPlayerRemoving(player)
	ArenaService.leaveQueue(player)
end

-------------------------------------------------------------------------------
-- 3. Upgrade handlers
-------------------------------------------------------------------------------

-- Universal upgrade handler: accepts an upgrade type parameter
requestUpgrade.OnServerEvent:Connect(function(player: Player, upgradeType: string?)
	local data = PlayerData.get(player)
	local typeName = upgradeType or "Speed" -- default to Speed for backward compat

	if typeName == "Speed" then
		-- Validate: not at max
		if data.SpeedLevel >= Config.SPEED_MAX_LEVEL then return end

		-- Calculate cost and validate balance
		local cost = CoinMath.upgradeCost(Config.SPEED_BASE_COST, data.SpeedLevel)
		if not PlayerData.subtractCoins(player, cost) then return end

		-- Apply
		data.SpeedLevel += 1
		PlayerData.syncLeaderstats(player)
		applyWalkSpeed(player)

		print(("[CoinRushArena] %s upgraded Speed to level %d (cost: %d)"):format(
			player.Name, data.SpeedLevel, cost
		))

	elseif typeName == "Magnet" then
		if data.MagnetLevel >= Config.MAGNET_MAX_LEVEL then return end

		local cost = CoinMath.upgradeCost(Config.MAGNET_BASE_COST, data.MagnetLevel)
		if not PlayerData.subtractCoins(player, cost) then return end

		data.MagnetLevel += 1
		PlayerData.syncLeaderstats(player)

		print(("[CoinRushArena] %s upgraded Magnet to level %d (cost: %d)"):format(
			player.Name, data.MagnetLevel, cost
		))

	elseif typeName == "Power" then
		if data.PowerLevel >= Config.POWER_MAX_LEVEL then return end

		local cost = CoinMath.upgradeCost(Config.POWER_BASE_COST, data.PowerLevel)
		if not PlayerData.subtractCoins(player, cost) then return end

		data.PowerLevel += 1
		PlayerData.syncLeaderstats(player)

		print(("[CoinRushArena] %s upgraded Power to level %d (cost: %d)"):format(
			player.Name, data.PowerLevel, cost
		))

	elseif typeName == "Multiplier" then
		if data.MultiplierLevel >= Config.MULTI_MAX_LEVEL then return end

		local cost = CoinMath.upgradeCost(Config.MULTI_BASE_COST, data.MultiplierLevel)
		if not PlayerData.subtractCoins(player, cost) then return end

		data.MultiplierLevel += 1
		PlayerData.syncLeaderstats(player)

		print(("[CoinRushArena] %s upgraded Multiplier to level %d (cost: %d)"):format(
			player.Name, data.MultiplierLevel, cost
		))
	end
end)

-------------------------------------------------------------------------------
-- 4. Arena handlers
-------------------------------------------------------------------------------

joinArena.OnServerEvent:Connect(function(player: Player, mode: string?)
	local modeName = mode or "CoinKing"
	print(("[CoinRushArena] %s joining arena queue: %s"):format(player.Name, modeName))
	ArenaService.joinQueue(player, modeName)
end)

leaveQueue.OnServerEvent:Connect(function(player: Player)
	ArenaService.leaveQueue(player)
end)

arenaCoinPickup.OnServerEvent:Connect(function(player: Player, coinId: number?)
	if coinId then
		ArenaService.handleCoinPickup(player, coinId)
	end
end)

-------------------------------------------------------------------------------
-- 5. Offline coins & Daily reward handlers
-------------------------------------------------------------------------------

claimOfflineCoins.OnServerEvent:Connect(function(player: Player)
	OfflineService.claimOffline(player)
end)

claimDailyReward.OnServerEvent:Connect(function(player: Player)
	DailyRewardService.claimReward(player)
end)

-------------------------------------------------------------------------------
-- 6. Leaderboard handlers
-------------------------------------------------------------------------------

leaderboardData.OnServerEvent:Connect(function(player: Player, request: { category: string, view: string, limit: number? }?)
	if request and request.category then
		LeaderboardService.sendToPlayer(player, request.category, request.view or "Global", request.limit)
	end
end)

-------------------------------------------------------------------------------
-- 7. Wire up lifecycle events
-------------------------------------------------------------------------------

Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

-------------------------------------------------------------------------------
-- 8. Start coin system
-------------------------------------------------------------------------------

CoinService.startSpawning()

-------------------------------------------------------------------------------
-- 9. Start autosave
-------------------------------------------------------------------------------

PlayerData.startAutosave()

-------------------------------------------------------------------------------
-- 10. Initialize leaderboard refresh (every 60 seconds)
-------------------------------------------------------------------------------

task.spawn(function()
	while true do
		task.wait(60)
		-- Leaderboard data is computed on-demand when clients request it
	end
end)

print("[CoinRushArena] Server online — " .. Config.GAME_NAME .. " v" .. Config.GAME_VERSION)
