-- UpgradeShop: server-validated movement-speed upgrades.
-- Clients invoke the RemoteFunction; the server owns coins and walk speed.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local CoinService = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinService"))

local remotes = ReplicatedStorage:WaitForChild("Remotes")

local upgradeFn = Instance.new("RemoteFunction")
upgradeFn.Name = "UpgradeShop"
upgradeFn.Parent = remotes

local function applySpeed(player: Player, level: number)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = CoinService.nextWalkSpeed(
			Config.START_WALK_SPEED,
			Config.SPEED_UPGRADE_STEP,
			Config.SPEED_UPGRADE_MAX,
			level
		)
	end
end

upgradeFn.OnServerInvoke = function(player: Player)
	local leaderstats = player:FindFirstChild("leaderstats")
	local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
	if not (coinsValue and coinsValue:IsA("IntValue")) then
		return false, "no leaderstats"
	end
	local level = player:GetAttribute("SpeedLevel") or 0
	local cost = CoinService.upgradeCost(Config.UPGRADE_BASE_COST, level)
	if coinsValue.Value < cost then
		return false, "not enough coins"
	end
	coinsValue.Value -= cost
	player:SetAttribute("SpeedLevel", level + 1)
	applySpeed(player, level + 1)
	return true, "upgraded"
end

Players.PlayerAdded:Connect(function(player: Player)
	player:SetAttribute("SpeedLevel", 0)
	player.CharacterAdded:Connect(function()
		applySpeed(player, player:GetAttribute("SpeedLevel") or 0)
	end)
end)

print("[AI FACTORY] UpgradeShop online")
