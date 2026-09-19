-- AI Factory Roblox template: client entry point.
-- LocalScripts under StarterPlayer/StarterPlayerScripts run on each client.
-- They render state and send requests; the server owns authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local player = Players.LocalPlayer

print(("[AI FACTORY] Client online for %s (game: %s)"):format(player.Name, Config.GAME_NAME))
