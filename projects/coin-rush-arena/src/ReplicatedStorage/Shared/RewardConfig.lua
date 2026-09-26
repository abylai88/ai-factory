-- Coin Rush Arena: consolidated reward definitions.
-- Centralizes all reward types: daily rewards, login streaks, achievement
-- rewards, level-up rewards, and seasonal rewards.
-- Server validates and grants; client reads for display.

local RewardConfig = {}

-------------------------------------------------------------------------------
-- DAILY LOGIN REWARDS (7-day cycle)
-------------------------------------------------------------------------------

RewardConfig.DailyRewards = {
	[1] = {
		Day = 1,
		Type = "Coins",
		Amount = 50,
		Name = "50 Coins",
		Description = "Start your journey with 50 coins!",
		Icon = "Coins",
		Color = Color3.fromRGB(255, 215, 0),
	},
	[2] = {
		Day = 2,
		Type = "Coins",
		Amount = 25,
		Name = "25 Coins",
		Description = "A small bonus to keep you going.",
		Icon = "Coins",
		Color = Color3.fromRGB(255, 215, 0),
	},
	[3] = {
		Day = 3,
		Type = "SpeedBoost",
		Amount = 100,
		Duration = 300,
		Name = "Speed Boost (5 min)",
		Description = "5 minutes of 2x speed!",
		Icon = "Lightning",
		Color = Color3.fromRGB(100, 200, 255),
	},
	[4] = {
		Day = 4,
		Type = "Coins",
		Amount = 25,
		Name = "25 Coins",
		Description = "Halfway through the week!",
		Icon = "Coins",
		Color = Color3.fromRGB(255, 215, 0),
	},
	[5] = {
		Day = 5,
		Type = "Coins",
		Amount = 50,
		Name = "50 Coins",
		Description = "Getting closer to the big prize!",
		Icon = "Coins",
		Color = Color3.fromRGB(255, 215, 0),
	},
	[6] = {
		Day = 6,
		Type = "Coins",
		Amount = 50,
		Name = "50 Coins",
		Description = "Almost there! One more day!",
		Icon = "Coins",
		Color = Color3.fromRGB(255, 215, 0),
	},
	[7] = {
		Day = 7,
		Type = "Crate",
		CrateId = "crate_legendary",
		Name = "Legendary Crate",
		Description = "Your loyalty is rewarded! Open for an Epic or Legendary cosmetic!",
		Icon = "Crate",
		Color = Color3.fromRGB(255, 193, 7),
	},
}

-- VIP bonus multipliers for daily rewards
RewardConfig.VIPDailyMultiplier = 2.0

-- Missed day threshold (hours) before streak resets
RewardConfig.DailyStreakResetHours = 48

-------------------------------------------------------------------------------
-- LOGIN STREAK BONUSES
-- Bonus rewards for consecutive daily logins beyond the 7-day cycle.
-------------------------------------------------------------------------------

RewardConfig.LoginStreakBonuses = {
	[14] = {
		Days = 14,
		Type = "Coins",
		Amount = 500,
		Name = "500 Coins Streak Bonus",
		Description = "14-day login streak! Here's 500 bonus coins!",
	},
	[30] = {
		Days = 30,
		Type = "Crate",
		CrateId = "crate_meteor",
		Name = "Meteor Crate",
		Description = "30-day login streak! Ultimate loyalty rewarded!",
	},
	[60] = {
		Days = 60,
		Type = "Cosmetic",
		CosmeticId = "pet_cosmic_serpent",
		Name = "Cosmic Serpent",
		Description = "60-day login streak! The Cosmic Serpent is yours!",
	},
	[90] = {
		Days = 90,
		Type = "Title",
		TitleId = "title_eternal",
		Name = "Eternal Collector",
		Description = "90-day login streak! You are truly legendary.",
	},
}

-------------------------------------------------------------------------------
-- LEVEL-UP REWARDS
-- Coins granted when reaching specific levels.
-------------------------------------------------------------------------------

RewardConfig.LevelUpRewards = {
	[5]  = { Type = "Coins", Amount = 200,  Name = "200 Coins" },
	[10] = { Type = "Coins", Amount = 500,  Name = "500 Coins" },
	[15] = { Type = "Coins", Amount = 750,  Name = "750 Coins" },
	[20] = { Type = "Coins", Amount = 1000, Name = "1000 Coins" },
	[25] = { Type = "Crate", CrateId = "crate_premium", Name = "Premium Crate" },
	[30] = { Type = "Coins", Amount = 2000, Name = "2000 Coins" },
	[35] = { Type = "Crate", CrateId = "crate_legendary", Name = "Legendary Crate" },
	[40] = { Type = "Coins", Amount = 3000, Name = "3000 Coins" },
	[45] = { Type = "Crate", CrateId = "crate_meteor", Name = "Meteor Crate" },
	[50] = { Type = "Cosmetic", CosmeticId = "pet_cosmic_serpent", Name = "Cosmic Serpent" },
}

-- Level-up coin rewards by tier (for levels not in the specific table above)
RewardConfig.LevelUpCoinByTier = {
	{ MaxLevel = 10,  Coins = 50  },
	{ MaxLevel = 20,  Coins = 100 },
	{ MaxLevel = 30,  Coins = 200 },
	{ MaxLevel = 40,  Coins = 300 },
	{ MaxLevel = 50,  Coins = 500 },
}

-------------------------------------------------------------------------------
-- ARENA ROUND REWARDS
-- Coins and bonuses awarded at the end of an arena round.
-------------------------------------------------------------------------------

RewardConfig.ArenaRoundRewards = {
	CoinKing = {
		First = { Coins = 50, RatingChange = "high" },
		Second = { Coins = 30, RatingChange = "medium" },
		Third = { Coins = 15, RatingChange = "low" },
		Participation = { Coins = 5, RatingChange = "minimal" },
	},
	SpeedBlitz = {
		Win = { Coins = 60, RatingChange = "high" },
		Loss = { Coins = 10, RatingChange = "low" },
	},
	LastCoinStanding = {
		First = { Coins = 75, RatingChange = "high" },
		Second = { Coins = 40, RatingChange = "medium" },
		Third = { Coins = 20, RatingChange = "low" },
		Participation = { Coins = 5, RatingChange = "minimal" },
	},
}

-- Consecutive arena round bonus
RewardConfig.ConsecutiveBonus = {
	BonusPerRound = 10,
	MaxBonus = 50,
	RoundsRequired = 1, -- bonus starts from 2nd consecutive round
}

-- VIP arena bonus multiplier
RewardConfig.VIPArenaMultiplier = 1.25

-------------------------------------------------------------------------------
-- OFFLINE COIN REWARDS
-- Coins earned while the player is offline.
-------------------------------------------------------------------------------

RewardConfig.OfflineRewards = {
	BaseRate = 0.1,        -- coins per second
	MaxHours = 8,          -- maximum offline time tracked
	MaxCoins = 500,        -- maximum coins earnable offline
	MagnetBonus = 0.10,    -- +10% per magnet level
	VIPMultiplier = 1.5,   -- VIP gets 1.5x offline coins
}

-------------------------------------------------------------------------------
-- ARENA BONUS TIERS
-- Progressive rewards for consecutive arena plays.
-------------------------------------------------------------------------------

RewardConfig.ArenaStreakBonuses = {
	{ Rounds = 3,  BonusCoins = 25,  Name = "Hat Trick" },
	{ Rounds = 5,  BonusCoins = 50,  Name = "On Fire" },
	{ Rounds = 10, BonusCoins = 150, Name = "Unstoppable" },
	{ Rounds = 20, BonusCoins = 300, Name = "Arena Legend" },
}

-------------------------------------------------------------------------------
-- SEASONAL REWARDS
-- Special rewards tied to seasonal events.
-------------------------------------------------------------------------------

RewardConfig.SeasonalRewards = {
	event_coin_frenzy = {
		Name = "Coin Frenzy Champion",
		Reward = { Type = "Crate", CrateId = "crate_premium" },
	},
	event_arena_tournament = {
		Name = "Tournament Victor",
		Reward = { Type = "Cosmetic", CosmeticId = "pet_neon_dragon" },
	},
	event_meteor_shower = {
		Name = "Meteor Master",
		Reward = { Type = "Cosmetic", CosmeticId = "trail_meteor_shower" },
	},
	event_harvest_festival = {
		Name = "Harvest Hero",
		Reward = { Type = "Crate", CrateId = "crate_legendary" },
	},
	event_winter_wonderland = {
		Name = "Winter Warrior",
		Reward = { Type = "Cosmetic", CosmeticId = "effect_meteor_swarm" },
	},
}

-------------------------------------------------------------------------------
-- REWARD TYPES ENUM
-------------------------------------------------------------------------------

RewardConfig.Types = {
	Coins = "Coins",
	Crate = "Crate",
	Cosmetic = "Cosmetic",
	Boost = "Boost",
	Title = "Title",
	SpeedBoost = "SpeedBoost",
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get daily reward for a specific day (1-7).
function RewardConfig.getDailyReward(day: number): table?
	return RewardConfig.DailyRewards[day]
end

--- Get level-up reward for a specific level.
function RewardConfig.getLevelUpReward(level: number): table?
	-- Check specific level rewards first
	if RewardConfig.LevelUpRewards[level] then
		return RewardConfig.LevelUpRewards[level]
	end

	-- Fall back to tier-based coin rewards
	for _, tier in ipairs(RewardConfig.LevelUpCoinByTier) do
		if level <= tier.MaxLevel then
			return { Type = "Coins", Amount = tier.Coins, Name = tier.Coins .. " Coins" }
		end
	end

	return nil
end

--- Get arena placement reward for a specific mode and placement.
function RewardConfig.getArenaReward(mode: string, placement: number): table?
	local modeRewards = RewardConfig.ArenaRoundRewards[mode]
	if not modeRewards then return nil end

	if mode == "SpeedBlitz" then
		if placement == 1 then
			return modeRewards.Win
		else
			return modeRewards.Loss
		end
	else
		-- FFA modes (CoinKing, LastCoinStanding)
		if placement == 1 then
			return modeRewards.First
		elseif placement == 2 then
			return modeRewards.Second
		elseif placement == 3 then
			return modeRewards.Third
		else
			return modeRewards.Participation
		end
	end
end

--- Get arena streak bonus for consecutive rounds.
function RewardConfig.getArenaStreakBonus(consecutiveRounds: number): number
	local bonus = 0
	for _, streak in ipairs(RewardConfig.ArenaStreakBonuses) do
		if consecutiveRounds >= streak.Rounds then
			bonus = streak.BonusCoins
		end
	end
	return bonus
end

--- Calculate offline coins earned.
function RewardConfig.calculateOfflineCoins(
	offlineSeconds: number,
	magnetLevel: number,
	multiplierLevel: number,
	isVip: boolean
): number
	local rate = RewardConfig.OfflineRewards.BaseRate

	-- Magnet bonus
	rate = rate * (1 + (magnetLevel * RewardConfig.OfflineRewards.MagnetBonus))

	-- Multiplier bonus
	local multiplier = 1 + (multiplierLevel * 0.2)
	rate = rate * multiplier

	-- VIP bonus
	if isVip then
		rate = rate * RewardConfig.OfflineRewards.VIPMultiplier
	end

	-- Cap offline time
	local cappedSeconds = math.min(offlineSeconds, RewardConfig.OfflineRewards.MaxHours * 3600)

	-- Calculate coins
	local coins = math.floor(rate * cappedSeconds)
	return math.min(coins, RewardConfig.OfflineRewards.MaxCoins)
end

--- Format a reward for display.
function RewardConfig.formatReward(reward: table): string
	if not reward then return "No reward" end

	if reward.Type == "Coins" then
		return tostring(reward.Amount) .. " Coins"
	elseif reward.Type == "Crate" then
		return reward.Name or "Crate"
	elseif reward.Type == "Cosmetic" then
		return reward.Name or "Cosmetic"
	elseif reward.Type == "Boost" then
		return reward.Name or "Boost"
	elseif reward.Type == "Title" then
		return reward.Name or "Title"
	end

	return reward.Name or "Reward"
end

return RewardConfig
