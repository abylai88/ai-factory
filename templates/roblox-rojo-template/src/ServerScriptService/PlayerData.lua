-- AI Factory Roblox template: server-side player data + persistence.
-- DataStore access MUST stay on the server. Clients request changes through
-- RemoteEvents/RemoteFunctions and the server validates every request.

local Players = game:GetService("Players")
local DataStoreService = game:GetService("DataStoreService")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local PlayerData = {}
PlayerData._cache = {} :: { [Player]: { Coins: number, SpeedLevel: number } }

local function store(): DataStore
	return DataStoreService:GetDataStore(Config.DATASTORE_NAME)
end

function PlayerData.get(player: Player)
	local data = PlayerData._cache[player]
	if not data then
		data = { Coins = 0, SpeedLevel = 0 }
		PlayerData._cache[player] = data
	end
	return data
end

function PlayerData.addCoins(player: Player, amount: number): number
	assert(amount >= 0, "coin amount must be non-negative")
	local data = PlayerData.get(player)
	data.Coins += amount
	local leaderstats = player:FindFirstChild("leaderstats")
	local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
	if coinsValue and coinsValue:IsA("IntValue") then
		coinsValue.Value = data.Coins
	end
	return data.Coins
end

function PlayerData.load(player: Player)
	local ok, saved = pcall(function()
		return store():GetAsync("player_" .. player.UserId)
	end)
	if ok and type(saved) == "table" then
		local data = PlayerData.get(player)
		data.Coins = tonumber(saved.Coins) or 0
		data.SpeedLevel = tonumber(saved.SpeedLevel) or 0
	end
end

function PlayerData.save(player: Player)
	local data = PlayerData._cache[player]
	if not data then
		return
	end
	pcall(function()
		store():SetAsync("player_" .. player.UserId, {
			Coins = data.Coins,
			SpeedLevel = data.SpeedLevel,
		})
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
