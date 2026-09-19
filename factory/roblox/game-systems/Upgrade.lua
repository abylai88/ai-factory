-- AI Factory reusable game system: Upgrade (speed/jump/multiplier shop).
-- Cost curve is shared pure logic so server + client UI agree on prices
-- while the SERVER remains the purchase authority.
-- Usage (server):
--   local Upgrade = require(ReplicatedStorage.Shared.GameSystems.Upgrade)
--   local cost = Upgrade.cost(baseCost, level)

local Upgrade = {}

function Upgrade.cost(baseCost: number, level: number, growth: number?): number
	local g: number = growth or 1.6
	return math.floor(baseCost * math.pow(g, level))
end

function Upgrade.nextWalkSpeed(startSpeed: number, step: number, max: number, level: number): number
	return math.min(max, startSpeed + step * level)
end

-- Server-side purchase: spends currency, bumps level, applies walk speed.
-- Expects player attributes or a level IntValue the game owns.
function Upgrade.buyWalkSpeed(
	player: Player,
	options: {
		baseCost: number,
		statName: string?,
		startSpeed: number?,
		step: number?,
		maxSpeed: number?,
	}
): (boolean, string)
	local Currency = require(script.Parent:WaitForChild("Currency"))
	local statName: string = options.statName or "Coins"
	local startSpeed: number = options.startSpeed or 16
	local step: number = options.step or 2
	local maxSpeed: number = options.maxSpeed or 32

	local level = player:GetAttribute("SpeedLevel") or 0
	if typeof(level) ~= "number" then
		level = 0
	end
	local price = Upgrade.cost(options.baseCost, level)
	local folder = player:FindFirstChild("leaderstats")
	local stat = folder and folder:FindFirstChild(statName)
	if not (stat and stat:IsA("IntValue")) then
		return false, "no currency stat"
	end
	if stat.Value < price then
		return false, ("need %d %s"):format(price, statName)
	end
	stat.Value -= price
	level += 1
	player:SetAttribute("SpeedLevel", level)
	local character = player.Character
	local humanoid = character and character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid.WalkSpeed = Upgrade.nextWalkSpeed(startSpeed, step, maxSpeed, level)
	end
	return true, ("speed level %d"):format(level)
end

return Upgrade
