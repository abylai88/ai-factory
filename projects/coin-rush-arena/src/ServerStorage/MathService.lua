-- Coin Rush Arena: server-only math functions.
-- ModuleScript in ServerStorage. Only server scripts may require this.
-- Contains computations that must not be readable by clients (exploit prevention).

local Config = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("Config"))
local CoinMath = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("CoinMath"))

local MathService = {}

-- Elo-like rating change calculation (server-authoritative version)
function MathService.ratingChange(
	playerRating: number,
	opponentAvgRating: number,
	placement: number,
	kFactor: number?
): number
	local k = kFactor or Config.RATING_K_FACTOR
	local expectedWin = 1 / (1 + 10 ^ ((opponentAvgRating - playerRating) / 400))
	local actualWin = (placement == 1) and 1 or 0
	local change = math.floor(k * (actualWin - expectedWin))
	return math.clamp(change, Config.RATING_MIN_CHANGE, Config.RATING_MAX_CHANGE)
end

-- Matchmaking score for lobby balancing
function MathService.matchmakingScore(playerRating: number, waitTime: number): number
	-- Higher score = better match priority
	-- Prioritize closer ratings, then longer wait times
	return 1000 - math.abs(playerRating - 1000) + (waitTime * 2)
end

-- Calculate offline coins earned (server-authoritative)
function MathService.calculateOfflineCoins(
	offlineSeconds: number,
	magnetLevel: number,
	multiplierLevel: number,
	isVip: boolean
): number
	local baseRate = 0.1 -- coins per second (1 coin per 10 seconds)
	local cappedSeconds = math.min(offlineSeconds, Config.OFFLINE_MAX_HOURS * 3600)

	local magnetBonus = 1 + (magnetLevel * Config.OFFLINE_MAGNET_BONUS)
	local multiplier = CoinMath.coinMultiplier(Config.MULTI_BASE, Config.MULTI_PER_LEVEL, multiplierLevel)
	local vipBonus = isVip and Config.OFFLINE_VIP_MULTIPLIER or 1

	local coins = math.floor(cappedSeconds * baseRate * magnetBonus * multiplier * vipBonus)
	return math.min(coins, Config.OFFLINE_MAX_COINS)
end

-- Arena steal amount calculation
function MathService.calculateStealAmount(victimCoins: number): number
	local amount = math.ceil(victimCoins * Config.STEAL_PERCENT)
	return math.max(amount, Config.STEAL_MINIMUM)
end

-- Validate steal attempt (server-authoritative)
function MathService.validateSteal(
	stealerPos: Vector3,
	victimPos: Vector3,
	stealerCoins: number,
	victimCoins: number,
	lastStealTime: number?
): boolean
	-- Range check
	if (stealerPos - victimPos).Magnitude > Config.STEAL_RANGE then
		return false
	end

	-- Victim must have minimum coins
	if victimCoins < Config.STEAL_MINIMUM then
		return false
	end

	-- Cooldown check
	if lastStealTime and (tick() - lastStealTime) < Config.STEAL_COOLDOWN then
		return false
	end

	return true
end

return MathService