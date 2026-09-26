-- Coin Rush Arena: pure math functions (shared).
-- No side effects, no service dependencies.
-- Both server and client may require this for UI cost calculations.

local CoinMath = {}

-- Exponential upgrade cost formula.
-- cost(level) = floor(baseCost × growthRate^level)
function CoinMath.upgradeCost(baseCost: number, level: number, growthRate: number?): number
	local rate = growthRate or 1.6
	return math.floor(baseCost * math.pow(rate, level))
end

-- Linear walk speed from upgrade level.
function CoinMath.nextWalkSpeed(startSpeed: number, step: number, max: number, level: number): number
	return math.min(max, startSpeed + step * level)
end

-- Magnet radius from upgrade level.
function CoinMath.magnetRadius(base: number, perLevel: number, max: number, level: number): number
	return math.min(max, base + perLevel * level)
end

-- Arena power (damage) from upgrade level.
function CoinMath.arenaPower(base: number, perLevel: number, level: number): number
	return base + perLevel * level
end

-- Coin multiplier from upgrade level.
function CoinMath.coinMultiplier(base: number, perLevel: number, level: number): number
	return base + perLevel * level
end

-- Coin value with multiplier applied.
function CoinMath.calculateCoinValue(baseValue: number, multiplier: number): number
	return math.floor(baseValue * multiplier)
end

-- Weighted random selection from coin type table.
-- Returns the key of the selected type.
function CoinMath.selectCoinType(coinTypes: { [string]: { Weight: number } }): string
	local totalWeight = 0
	for _, info in pairs(coinTypes) do
		totalWeight += info.Weight
	end

	local roll = math.random() * totalWeight
	local cumulative = 0
	for name, info in pairs(coinTypes) do
		cumulative += info.Weight
		if roll <= cumulative then
			return name
		end
	end
	return "Bronze" -- fallback
end

-- Clamp a number between min and max.
function CoinMath.clamp(value: number, min: number, max: number): number
	return math.min(max, math.max(min, value))
end

-- Elo-like rating change calculation.
function CoinMath.ratingChange(
	playerRating: number,
	opponentAvgRating: number,
	placement: number,
	kFactor: number?
): number
	local k = kFactor or 32
	local expectedWin = 1 / (1 + 10 ^ ((opponentAvgRating - playerRating) / 400))
	local actualWin = (placement == 1) and 1 or 0
	local change = math.floor(k * (actualWin - expectedWin))
	return CoinMath.clamp(change, -50, 50)
end

return CoinMath
