-- Coin Rush Arena: Arena matchmaking & round logic.
-- Server-authoritative arena system with Coin King (FFA), Speed Blitz (4v4),
-- and Last Coin Standing modes. Handles matchmaking, rounds, scoring, bots.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local CoinMath = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinMath"))
local ArenaConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("ArenaConfig"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local ArenaService = {}

-- Internal state
local queue = {} -- { [modeName] = { [player] = queueTime } }
local lobbies = {} -- { [lobbyId] = LobbyState }
local lobbyCounter = 0
local arenaCoinsFolder: Folder? = nil

-- Bot name pool
local botNamePrefixes = {
	"Coin", "Gold", "Silver", "Speed", "Bolt", "Flash",
	"Rush", "Dash", "Swift", "Blitz", "Zap", "Pixel",
	"Neon", "Glitch", "Byte", "Spark", "Surge", "Nova",
}
local botNameSuffixes = {
	"Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot",
	"Bot", "X", "Pro", "Go", "Max", "1",
}

local function generateBotName(): string
	return botNamePrefixes[math.random(1, #botNamePrefixes)]
		.. botNameSuffixes[math.random(1, #botNameSuffixes)]
end

-- Remote references (resolved once at init)
local function getRemote(name: string): RemoteEvent?
	local remotes = ReplicatedStorage:FindFirstChild("Remotes")
	if remotes then
		return remotes:FindFirstChild(name)
	end
	return nil
end

local function fireToPlayer(player: Player, remoteName: string, ...: any)
	local remote = getRemote(remoteName)
	if remote then
		remote:FireClient(player, ...)
	end
end

local function fireToAll(remoteName: string, ...: any)
	local remote = getRemote(remoteName)
	if remote then
		remote:FireAllClients(...)
	end
end

---------------------------------------------------------------------------
-- LOBBY MANAGEMENT
---------------------------------------------------------------------------

type LobbyState = {
	id: number,
	mode: string,
	players: { Player },
	bots: { any },
	state: string, -- "WAITING" | "COUNTDOWN" | "ACTIVE" | "RESULTS" | "CLEANUP"
	timer: number,
	startTime: number,
	scores: { [Player]: { coins: number, steals: number } },
	botScores: { [string]: { coins: number, steals: number } },
	coinSpawnTask: number?,
	countdownTask: number?,
	endTask: number?,
	arenaCoins: { Part },
}

function ArenaService.createLobby(mode: string, player: Player): LobbyState
	lobbyCounter += 1
	local lobby: LobbyState = {
		id = lobbyCounter,
		mode = mode,
		players = { player },
		bots = {},
		state = "WAITING",
		timer = 0,
		startTime = 0,
		scores = {},
		botScores = {},
		arenaCoins = {},
	}
	lobbies[lobby.id] = lobby
	return lobby
end

function ArenaService.destroyLobby(lobbyId: number)
	local lobby = lobbies[lobbyId]
	if not lobby then return end

	-- Clean up arena coins
	for _, coin in ipairs(lobby.arenaCoins) do
		if coin and coin.Parent then
			coin:Destroy()
		end
	end
	lobby.arenaCoins = {}

	-- Disconnect tasks
	if lobby.coinSpawnTask then
		task.cancel(lobby.coinSpawnTask)
	end
	if lobby.countdownTask then
		task.cancel(lobby.countdownTask)
	end
	if lobby.endTask then
		task.cancel(lobby.endTask)
	end

	lobbies[lobbyId] = nil
end

---------------------------------------------------------------------------
-- QUEUE MANAGEMENT
---------------------------------------------------------------------------

function ArenaService.joinQueue(player: Player, mode: string): number
	if not queue[mode] then
		queue[mode] = {}
	end
	queue[mode][player] = tick()

	-- Find existing lobby with open slots
	local config = ArenaConfig[mode]
	if not config then
		warn("[ArenaService] Unknown mode: " .. tostring(mode))
		return 0
	end

	local joinedLobby = nil
	for _, lobby in pairs(lobbies) do
		if lobby.mode == mode and lobby.state == "WAITING" then
			if #lobby.players < config.MaxPlayers then
				table.insert(lobby.players, player)
				lobby.scores[player] = { coins = 0, steals = 0 }
				joinedLobby = lobby
				break
			end
		end
	end

	-- Create new lobby if none found
	if not joinedLobby then
		joinedLobby = ArenaService.createLobby(mode, player)
		joinedLobby.scores[player] = { coins = 0, steals = 0 }
	end

	-- Notify player
	fireToPlayer(player, RemoteNames.ArenaState, {
		state = "Queue",
		lobbyId = joinedLobby.id,
		playerCount = #joinedLobby.players,
		maxPlayers = config.MaxPlayers,
		mode = mode,
	})

	-- Check if we should start (min players met)
	if #joinedLobby.players >= config.MinPlayers then
		ArenaService.startCountdown(joinedLobby)
	end

	return joinedLobby.id
end

function ArenaService.leaveQueue(player: Player)
	-- Remove from all queues
	for mode, players in pairs(queue) do
		players[player] = nil
	end

	-- Remove from any waiting lobby
	for _, lobby in pairs(lobbies) do
		if lobby.state == "WAITING" then
			for i, p in ipairs(lobby.players) do
				if p == player then
					table.remove(lobby.players, i)
					lobby.scores[player] = nil
					break
				end
			end
			-- If lobby is empty, destroy it
			if #lobby.players == 0 then
				ArenaService.destroyLobby(lobby.id)
			end
		end
	end
end

---------------------------------------------------------------------------
-- BOT MANAGEMENT
---------------------------------------------------------------------------

function ArenaService.fillWithBots(lobby: LobbyState, targetCount: number)
	local config = ArenaConfig[lobby.mode]
	if not config then return end

	local slotsNeeded = targetCount - #lobby.players - #lobby.bots
	for _ = 1, slotsNeeded do
		table.insert(lobby.bots, {
			name = generateBotName(),
			coins = 0,
			steals = 0,
			rating = 1000 + math.random(-50, 50),
		})
	end
end

---------------------------------------------------------------------------
-- ROUND LIFECYCLE
---------------------------------------------------------------------------

function ArenaService.startCountdown(lobby: LobbyState)
	lobby.state = "COUNTDOWN"

	-- Fill with bots if needed
	local config = ArenaConfig[lobby.mode]
	if config and #lobby.players < config.MaxPlayers then
		ArenaService.fillWithBots(lobby, config.MaxPlayers)
	end

	-- Notify all players
	for _, player in ipairs(lobby.players) do
		fireToPlayer(player, RemoteNames.ArenaState, {
			state = "Countdown",
			lobbyId = lobby.id,
			duration = Config.MATCH_COUNTDOWN,
			mode = lobby.mode,
			playerCount = #lobby.players,
		})
	end

	-- Start countdown
	lobby.countdownTask = task.delay(Config.MATCH_COUNTDOWN, function()
		ArenaService.startRound(lobby)
	end)
end

function ArenaService.startRound(lobby: LobbyState)
	lobby.state = "ACTIVE"
	lobby.startTime = tick()
	lobby.timer = 0

	local config = ArenaConfig[lobby.mode]
	if not config then
		ArenaService.destroyLobby(lobby.id)
		return
	end

	-- Initialize scores
	for _, player in ipairs(lobby.players) do
		lobby.scores[player] = { coins = 0, steals = 0 }
	end
	for _, bot in ipairs(lobby.bots) do
		bot.coins = 0
		bot.steals = 0
	end

	-- Create arena coins folder
	if not arenaCoinsFolder then
		arenaCoinsFolder = Instance.new("Folder")
		arenaCoinsFolder.Name = "ArenaCoins"
		arenaCoinsFolder.Parent = workspace
	end

	-- Notify round start
	for _, player in ipairs(lobby.players) do
		-- Teleport player to arena spawn
		local character = player.Character
		if character then
			local rootPart = character:FindFirstChild("HumanoidRootPart")
			if rootPart then
				rootPart.CFrame = CFrame.new(
					math.random(-10, 10),
					config.SpawnHeight + 5,
					math.random(-10, 10)
				)
			end
		end

		fireToPlayer(player, RemoteNames.ArenaState, {
			state = "Active",
			lobbyId = lobby.id,
			duration = config.Duration,
			mode = lobby.mode,
		})
	end

	-- Coin spawning loop
	local coinSpawnCount = 0
	lobby.coinSpawnTask = task.spawn(function()
		while lobby.state == "ACTIVE" and coinSpawnCount < config.MaxCoins do
			-- Spawn a coin
			local coinTypeConfig = config.CoinTypes or Config.COIN_KING_COIN_TYPES
			local coinTypeName = CoinMath.selectCoinType(coinTypeConfig)
			local coinInfo = coinTypeConfig[coinTypeName] or { Value = 1, Weight = 60 }
			local halfArea = (config.SpawnAreaSize or 40) / 2

			local coin = Instance.new("Part")
			coin.Name = "ArenaCoin"
			coin.Shape = Enum.PartType.Cylinder
			coin.Size = Vector3.new(0.3, 1, 1)
			coin.Color = Color3.fromRGB(255, 215, 0)
			coin.Material = Enum.Material.Neon
			coin.Anchored = true
			coin.CanCollide = false
			coin.CFrame = CFrame.new(
				math.random(-halfArea * 100, halfArea * 100) / 100,
				config.SpawnHeight or 3,
				math.random(-halfArea * 100, halfArea * 100) / 100
			) * CFrame.Angles(0, 0, math.rad(90))
			coin:SetAttribute("CoinType", coinTypeName)
			coin:SetAttribute("CoinValue", coinInfo.Value)
			coin:SetAttribute("CoinId", coinSpawnCount)
			coin.Parent = arenaCoinsFolder

			table.insert(lobby.arenaCoins, coin)

			-- Touch handler for arena coins
			coin.Touched:Connect(function(hit: BasePart)
				if coin:GetAttribute("Collecting") then return end

				local character = hit.Parent
				if not character then return end
				local humanoid = character:FindFirstChildOfClass("Humanoid")
				if not humanoid or humanoid.Health <= 0 then return end
				local player = Players:GetPlayerFromCharacter(character)
				if not player then return end

				-- Check if player is in this lobby
				local inLobby = false
				for _, p in ipairs(lobby.players) do
					if p == player then
						inLobby = true
						break
					end
				end
				if not inLobby then return end

				-- Mark collecting
				coin:SetAttribute("Collecting", true)

				-- Award coins
				local value = coinInfo.Value
				if lobby.scores[player] then
					lobby.scores[player].coins += value
				end

				-- Notify all players of score update
				ArenaService.broadcastScores(lobby)

				-- Destroy coin
				for i, c in ipairs(lobby.arenaCoins) do
					if c == coin then
						table.remove(lobby.arenaCoins, i)
						break
					end
				end
				coin:Destroy()
			end)

			coinSpawnCount += 1
			task.wait(config.CoinSpawnRate or 2)
		end
	end)

	-- End round timer
	lobby.endTask = task.delay(config.Duration, function()
		ArenaService.endRound(lobby)
	end)

	-- Start bot AI for this lobby
	ArenaService.startBotAI(lobby)
end

---------------------------------------------------------------------------
-- SCORING
---------------------------------------------------------------------------

function ArenaService.broadcastScores(lobby: LobbyState)
	local scoreData = {}
	for _, player in ipairs(lobby.players) do
		if lobby.scores[player] then
			scoreData[player.UserId] = {
				coins = lobby.scores[player].coins,
				steals = lobby.scores[player].steals,
				name = player.Name,
			}
		end
	end
	for _, bot in ipairs(lobby.bots) do
		scoreData[bot.name] = {
			coins = bot.coins,
			steals = bot.steals,
			name = bot.name,
			isBot = true,
		}
	end

	for _, player in ipairs(lobby.players) do
		fireToPlayer(player, RemoteNames.ArenaScore, scoreData)
	end
end

function ArenaService.handleCoinPickup(player: Player, coinId: number)
	-- Find the lobby this player is in
	for _, lobby in pairs(lobbies) do
		if lobby.state == "ACTIVE" then
			for _, p in ipairs(lobby.players) do
				if p == player then
					-- Server validates: coin exists and belongs to this arena
					for i, coin in ipairs(lobby.arenaCoins) do
						if coin:GetAttribute("CoinId") == coinId then
							if coin:GetAttribute("Collecting") then return end
							coin:SetAttribute("Collecting", true)

							local value = coin:GetAttribute("CoinValue") or 1
							if lobby.scores[player] then
								lobby.scores[player].coins += value
							end

							ArenaService.broadcastScores(lobby)

							table.remove(lobby.arenaCoins, i)
							coin:Destroy()
							break
						end
					end
					return
				end
			end
		end
	end
end

---------------------------------------------------------------------------
-- ROUND END
---------------------------------------------------------------------------

function ArenaService.endRound(lobby: LobbyState)
	lobby.state = "RESULTS"

	-- Calculate placements
	local allEntries = {}

	for _, player in ipairs(lobby.players) do
		local scores = lobby.scores[player]
		if scores then
			table.insert(allEntries, {
				player = player,
				isBot = false,
				coins = scores.coins,
				steals = scores.steals,
				name = player.Name,
				userId = player.UserId,
			})
		end
	end

	for _, bot in ipairs(lobby.bots) do
		table.insert(allEntries, {
			player = nil,
			isBot = true,
			coins = bot.coins,
			steals = bot.steals,
			name = bot.name,
			userId = 0,
		})
	end

	-- Sort by coins descending
	table.sort(allEntries, function(a, b)
		return a.coins > b.coins
	end)

	-- Assign placement and bonuses
	local results = {}
	for i, entry in ipairs(allEntries) do
		entry.placement = i
		local bonus = 0
		if i == 1 then
			bonus = ArenaConfig.CoinKing.FirstBonus
		elseif i == 2 then
			bonus = ArenaConfig.CoinKing.SecondBonus
		elseif i == 3 then
			bonus = ArenaConfig.CoinKing.ThirdBonus
		else
			bonus = ArenaConfig.CoinKing.ParticipationBonus
		end

		local totalCoins = entry.coins + bonus

		table.insert(results, {
			name = entry.name,
			userId = entry.userId,
			isBot = entry.isBot,
			coins = entry.coins,
			steals = entry.steals,
			bonus = bonus,
			totalCoins = totalCoins,
			placement = entry.placement,
		})

		-- Award coins and update stats for real players
		if not entry.isBot and entry.player then
			PlayerData.addCoins(entry.player, totalCoins)

			local data = PlayerData.get(entry.player)
			data.GamesPlayed += 1

			if i == 1 then
				data.ArenaWins += 1
				data.WinStreak += 1
				if data.WinStreak > data.BestWinStreak then
					data.BestWinStreak = data.WinStreak
				end
			else
				data.WinStreak = 0
			end

			-- Update rating
			local avgOpponentRating = 1000
			local ratingChange = CoinMath.ratingChange(
				data.ArenaRating,
				avgOpponentRating,
				entry.placement,
				Config.RATING_K_FACTOR
			)
			data.ArenaRating += ratingChange

			PlayerData.syncLeaderstats(entry.player)
		end
	end

	-- Send results to all players
	for _, player in ipairs(lobby.players) do
		fireToPlayer(player, RemoteNames.ArenaResults, results)
	end

	-- Cleanup after delay
	task.delay(10, function()
		ArenaService.cleanupLobby(lobby)
	end)
end

function ArenaService.cleanupLobby(lobby: LobbyState)
	-- Remove from queue
	for mode, players in pairs(queue) do
		for player in pairs(players) do
			players[player] = nil
		end
	end

	-- Teleport players back to world spawn
	for _, player in ipairs(lobby.players) do
		if player and player.Character then
			local rootPart = player.Character:FindFirstChild("HumanoidRootPart")
			if rootPart then
				rootPart.CFrame = CFrame.new(0, 5, 0)
			end
		end

		fireToPlayer(player, RemoteNames.ArenaState, {
			state = "ReturnToWorld",
			lobbyId = lobby.id,
		})
	end

	-- Destroy arena coins
	for _, coin in ipairs(lobby.arenaCoins) do
		if coin and coin.Parent then
			coin:Destroy()
		end
	end
	lobby.arenaCoins = {}

	ArenaService.destroyLobby(lobby.id)
end

---------------------------------------------------------------------------
-- BOT AI (simple farming behavior)
---------------------------------------------------------------------------

function ArenaService.startBotAI(lobby: LobbyState)
	task.spawn(function()
		while lobby.state == "ACTIVE" do
			for _, bot in ipairs(lobby.bots) do
				-- Simple bot: random coin collection simulation
				-- Bots "collect" coins randomly to simulate real players
				if math.random() < 0.3 then -- 30% chance per tick
					local coinTypeConfig = lobby.mode == "CoinKing" and ArenaConfig.CoinKing.CoinTypes or Config.COIN_KING_COIN_TYPES
					local coinTypeName = CoinMath.selectCoinType(coinTypeConfig)
					local coinInfo = coinTypeConfig[coinTypeName] or { Value = 1, Weight = 60 }
					bot.coins += coinInfo.Value
					ArenaService.broadcastScores(lobby)
				end
			end
			task.wait(1)
		end
	end)
end

---------------------------------------------------------------------------
-- STEAL MECHANIC
---------------------------------------------------------------------------

function ArenaService.handleSteal(stealer: Player, victim: Player)
	-- Find the lobby both players are in
	for _, lobby in pairs(lobbies) do
		if lobby.state == "ACTIVE" then
			local stealerInLobby = false
			local victimInLobby = false
			for _, p in ipairs(lobby.players) do
				if p == stealer then stealerInLobby = true end
				if p == victim then victimInLobby = true end
			end
			if not (stealerInLobby and victimInLobby) then
				return
			end

			-- Validate steal using MathService
			local stealerChar = stealer.Character
			local victimChar = victim.Character
			if not stealerChar or not victimChar then return end
			local stealerRoot = stealerChar:FindFirstChild("HumanoidRootPart")
			local victimRoot = victimChar:FindFirstChild("HumanoidRootPart")
			if not stealerRoot or not victimRoot then return end

			local stealerCoins = lobby.scores[stealer] and lobby.scores[stealer].coins or 0
			local victimCoins = lobby.scores[victim] and lobby.scores[victim].coins or 0

			-- Check cooldown
			local lastStealKey = stealer.UserId .. "_" .. victim.UserId
			local lastStealTime = lobby._stealCooldowns and lobby._stealCooldowns[lastStealKey]
			if not lobby._stealCooldowns then lobby._stealCooldowns = {} end

			if not MathService.validateSteal(stealerRoot.Position, victimRoot.Position, stealerCoins, victimCoins, lastStealTime) then
				return
			end

			-- Calculate steal amount
			local stealAmount = MathService.calculateStealAmount(victimCoins)

			-- Apply steal
			lobby.scores[stealer].coins += stealAmount
			lobby.scores[stealer].steals = (lobby.scores[stealer].steals or 0) + 1
			lobby.scores[victim].coins -= stealAmount

			-- Set cooldown
			lobby._stealCooldowns[lastStealKey] = tick()

			-- Broadcast updated scores
			ArenaService.broadcastScores(lobby)

			-- Fire steal event to both players for feedback
			local remoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
			local remotes = ReplicatedStorage:WaitForChild("Remotes")
			local stealRemote = remotes:FindFirstChild(remoteNames.ArenaPlayerSteal)
			if stealRemote then
				stealRemote:FireClient(stealer, victim.Name, stealAmount)
				stealRemote:FireClient(victim, stealer.Name, -stealAmount)
			end
		end
	end
end

---------------------------------------------------------------------------
-- LEADERBOARD DATA
---------------------------------------------------------------------------

function ArenaService.getLeaderboardData(category: string, limit: number): { any }
	local entries = {}
	for _, player in ipairs(Players:GetPlayers()) do
		local data = PlayerData.get(player)
		local score = 0
		if category == "TotalCoins" then
			score = data.TotalCoins
		elseif category == "ArenaWins" then
			score = data.ArenaWins
		elseif category == "ArenaRating" then
			score = data.ArenaRating
		elseif category == "WinStreak" then
			score = data.BestWinStreak
		end
		table.insert(entries, {
			name = player.Name,
			userId = player.UserId,
			score = score,
		})
	end

	-- Sort descending
	table.sort(entries, function(a, b)
		return a.score > b.score
	end)

	-- Limit results
	local result = {}
	for i = 1, math.min(limit or 10, #entries) do
		table.insert(result, entries[i])
	end
	return result
end

return ArenaService
