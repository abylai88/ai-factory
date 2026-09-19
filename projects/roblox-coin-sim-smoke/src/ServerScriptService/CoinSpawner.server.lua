-- CoinSpawner: server-authoritative collectible coins.
-- Coins spawn on the server, collection is granted by the server only.

local Players = game:GetService("Players")
local Workspace = game:GetService("Workspace")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local template = Instance.new("Part")
template.Name = "Coin"
template.Shape = Enum.PartType.Ball
template.Size = Vector3.new(2, 2, 2)
template.BrickColor = BrickColor.new("Bright yellow")
template.Anchored = true
template.CanCollide = false

local collected = {} :: { [BasePart]: boolean }

local function grantCoin(player: Player, coin: BasePart)
	if collected[coin] then
		return
	end
	collected[coin] = true
	local leaderstats = player:FindFirstChild("leaderstats")
	local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
	if coinsValue and coinsValue:IsA("IntValue") then
		coinsValue.Value += Config.COIN_VALUE
	end
	coin:Destroy()
	task.delay(Config.COIN_RESPAWN_SECONDS, function()
		collected[coin] = nil
		spawnCoin()
	end)
end

function spawnCoin()
	local coin = template:Clone()
	coin.Position = Vector3.new(math.random(-40, 40), 4, math.random(-40, 40))
	coin.Parent = Workspace
	coin.Touched:Connect(function(hit: BasePart)
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and Players:GetPlayerFromCharacter(character)
		if player then
			grantCoin(player, coin)
		end
	end)
end

for _ = 1, 8 do
	task.spawn(spawnCoin)
end

print("[AI FACTORY] CoinSpawner online")
