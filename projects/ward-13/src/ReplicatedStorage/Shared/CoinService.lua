-- AI Factory Roblox template: shared coin logic.
-- Pure functions usable from server scripts. Client scripts must treat all
-- values received from here as untrusted display data.

local CoinService = {}

function CoinService.upgradeCost(baseCost: number, level: number): number
	return math.floor(baseCost * math.pow(1.6, level))
end

function CoinService.nextWalkSpeed(startSpeed: number, step: number, max: number, level: number): number
	return math.min(max, startSpeed + step * level)
end

return CoinService
