-- AI Factory Roblox template: server entry point.
-- Server-authoritative gameplay lives here (or in ModuleScripts required
-- from here). Never trust the client with authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local function setupLeaderstats(player: Player)
	local leaderstats = Instance.new("Folder")
	leaderstats.Name = "leaderstats"

	local coins = Instance.new("IntValue")
	coins.Name = "Coins"
	coins.Value = 0
	coins.Parent = leaderstats

	leaderstats.Parent = player
end

local function onPlayerAdded(player: Player)
	print(("[AI FACTORY] Player joined: %s (game: %s)"):format(player.Name, Config.GAME_NAME))
	setupLeaderstats(player)
end

Players.PlayerAdded:Connect(onPlayerAdded)
for _, player in ipairs(Players:GetPlayers()) do
	task.spawn(onPlayerAdded, player)
end

print("[AI FACTORY] Roblox server online")
