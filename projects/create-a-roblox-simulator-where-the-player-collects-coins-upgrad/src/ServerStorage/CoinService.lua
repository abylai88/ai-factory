-- AI Factory Roblox template: server-side coin/upgrade formulas.
-- ModuleScript in ServerStorage (does NOT replicate to clients).
-- Upgrade cost formula is sensitive — must not be exposed to exploiters.

local CoinService = {}

function CoinService.upgradeCost(baseCost: number, level: number): number
	return math.floor(baseCost * math.pow(1.6, level))
end

function CoinService.nextWalkSpeed(startSpeed: number, step: number, max: number, level: number): number
	return math.min(max, startSpeed + step * level)
end

return CoinService
