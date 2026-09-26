-- Coin Rush Arena: server-side player data + persistence.
-- DataStore access MUST stay on the server. Clients request changes through
-- RemoteEvents/RemoteFunctions and the server validates every request.

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ServerStorage = game:GetService("ServerStorage")

local ServerConfig = require(ServerStorage:WaitForChild("ServerConfig"))

local PlayerData = {}

-- Type for documentation purposes (Luau uses structural typing).
-- type PlayerDataEntry = {
--     Coins: number,
--     TotalCoins: number,
--     SpeedLevel: number,
--     MagnetLevel: number,
--     PowerLevel: number,
--     MultiplierLevel: number,
--     ArenaWins: number,
--     ArenaRating: number,
--     GamesPlayed: number,
--     WinStreak: number,
--     BestWinStreak: number,
--     LastOnline: number,
-- }

PlayerData._cache = {} :: { [Player]: any }

local function store(): DataStore
	return DataStoreService:GetDataStore(ServerConfig.DATASTORE_NAME)
end

-- Default data template for new players.
local function defaultData()
	return {
		Coins = 0,
		TotalCoins = 0,
		SpeedLevel = 0,
		MagnetLevel = 0,
		PowerLevel = 0,
		MultiplierLevel = 0,
		ArenaWins = 0,
		ArenaRating = 1000,
		GamesPlayed = 0,
		WinStreak = 0,
		BestWinStreak = 0,
		LastOnline = os.time(),
	}
end

function PlayerData.get(player: Player)
	local data = PlayerData._cache[player]
	if not data then
		data = defaultData()
		PlayerData._cache[player] = data
	end
	return data
end

function PlayerData.addCoins(player: Player, amount: number): number
	local data = PlayerData.get(player)
	data.Coins += amount
	if amount > 0 then
		data.TotalCoins += amount
	end
	-- Sync to leaderstats
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local coinsValue = leaderstats:FindFirstChild("Coins")
		if coinsValue and coinsValue:IsA("IntValue") then
			coinsValue.Value = data.Coins
		end
		local totalValue = leaderstats:FindFirstChild("TotalCoins")
		if totalValue and totalValue:IsA("IntValue") then
			totalValue.Value = data.TotalCoins
		end
	end
	return data.Coins
end

function PlayerData.subtractCoins(player: Player, amount: number): boolean
	local data = PlayerData.get(player)
	if data.Coins < amount then
		return false
	end
	data.Coins -= amount
	local leaderstats = player:FindFirstChild("leaderstats")
	if leaderstats then
		local coinsValue = leaderstats:FindFirstChild("Coins")
		if coinsValue and coinsValue:IsA("IntValue") then
			coinsValue.Value = data.Coins
		end
	end
	return true
end

function PlayerData.syncLeaderstats(player: Player)
	local data = PlayerData.get(player)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		return
	end
	local coins = leaderstats:FindFirstChild("Coins")
	if coins and coins:IsA("IntValue") then
		coins.Value = data.Coins
	end
	local speed = leaderstats:FindFirstChild("SpeedLevel")
	if speed and speed:IsA("IntValue") then
		speed.Value = data.SpeedLevel
	end
	local magnet = leaderstats:FindFirstChild("MagnetLevel")
	if magnet and magnet:IsA("IntValue") then
		magnet.Value = data.MagnetLevel
	end
	local power = leaderstats:FindFirstChild("PowerLevel")
	if power and power:IsA("IntValue") then
		power.Value = data.PowerLevel
	end
	local multi = leaderstats:FindFirstChild("MultiplierLevel")
	if multi and multi:IsA("IntValue") then
		multi.Value = data.MultiplierLevel
	end
	local total = leaderstats:FindFirstChild("TotalCoins")
	if total and total:IsA("IntValue") then
		total.Value = data.TotalCoins
	end
	local wins = leaderstats:FindFirstChild("ArenaWins")
	if wins and wins:IsA("IntValue") then
		wins.Value = data.ArenaWins
	end
	local rating = leaderstats:FindFirstChild("ArenaRating")
	if rating and rating:IsA("IntValue") then
		rating.Value = data.ArenaRating
	end
end

function PlayerData.load(player: Player)
	local ok, saved = pcall(function()
		return store():GetAsync("player_" .. player.UserId)
	end)
	if ok and type(saved) == "table" then
		local data = PlayerData.get(player)
		data.Coins = tonumber(saved.Coins) or 0
		data.TotalCoins = tonumber(saved.TotalCoins) or 0
		data.SpeedLevel = tonumber(saved.SpeedLevel) or 0
		data.MagnetLevel = tonumber(saved.MagnetLevel) or 0
		data.PowerLevel = tonumber(saved.PowerLevel) or 0
		data.MultiplierLevel = tonumber(saved.MultiplierLevel) or 0
		data.ArenaWins = tonumber(saved.ArenaWins) or 0
		data.ArenaRating = tonumber(saved.ArenaRating) or 1000
		data.GamesPlayed = tonumber(saved.GamesPlayed) or 0
		data.WinStreak = tonumber(saved.WinStreak) or 0
		data.BestWinStreak = tonumber(saved.BestWinStreak) or 0
		data.LastOnline = tonumber(saved.LastOnline) or os.time()
	elseif not ok then
		warn(("[PlayerData] FAILED to load data for %s: %s"):format(player.Name, tostring(saved)))
	end
	PlayerData.syncLeaderstats(player)
end

function PlayerData.save(player: Player)
	local data = PlayerData._cache[player]
	if not data then
		return
	end
	data.LastOnline = os.time()
	local ok, err = pcall(function()
		store():SetAsync("player_" .. player.UserId, {
			Coins = data.Coins,
			TotalCoins = data.TotalCoins,
			SpeedLevel = data.SpeedLevel,
			MagnetLevel = data.MagnetLevel,
			PowerLevel = data.PowerLevel,
			MultiplierLevel = data.MultiplierLevel,
			ArenaWins = data.ArenaWins,
			ArenaRating = data.ArenaRating,
			GamesPlayed = data.GamesPlayed,
			WinStreak = data.WinStreak,
			BestWinStreak = data.BestWinStreak,
			LastOnline = data.LastOnline,
		})
	end)
	if not ok then
		warn(("[PlayerData] FAILED to save data for %s: %s"):format(player.Name, tostring(err)))
	end
end

function PlayerData.startAutosave()
	task.spawn(function()
		while true do
			task.wait(ServerConfig.AUTOSAVE_SECONDS)
			for _, player in ipairs(Players:GetPlayers()) do
				task.spawn(PlayerData.save, player)
			end
		end
	end)
end

Players.PlayerRemoving:Connect(function(player: Player)
	PlayerData.save(player)
	PlayerData._cache[player] = nil
end)

game:BindToClose(function()
	for _, player in ipairs(Players:GetPlayers()) do
		PlayerData.save(player)
	end
end)

return PlayerData
