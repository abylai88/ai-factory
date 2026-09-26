-- Coin Rush Arena: player level/progression tier system.
-- Defines level thresholds, unlock gates, and tier-based content.
-- Shared between server (validation) and client (UI display).

local LevelData = {}

-------------------------------------------------------------------------------
-- PLAYER LEVEL SYSTEM
-- Level is derived from TotalCoins earned. Each level requires progressively
-- more coins. Levels gate access to arena modes, shop items, and cosmetics.
-------------------------------------------------------------------------------

LevelData.MAX_LEVEL = 50

-- Level thresholds: TotalCoins required to reach each level.
-- Index = level, Value = cumulative TotalCoins needed.
LevelData.LEVEL_THRESHOLDS = {
	[1]  = 0,         -- Starting level
	[2]  = 100,       -- ~10 min of play
	[3]  = 250,       -- ~25 min
	[4]  = 500,       -- ~50 min
	[5]  = 800,       -- ~1.5 hr
	[6]  = 1200,      -- ~2 hr
	[7]  = 1800,      -- ~3 hr
	[8]  = 2500,      -- ~4 hr
	[9]  = 3500,      -- ~5.5 hr
	[10] = 5000,      -- ~8 hr (competitive threshold)
	[11] = 6800,      -- ~10 hr
	[12] = 9000,      -- ~13 hr
	[13] = 11500,     -- ~16 hr
	[14] = 14500,     -- ~20 hr
	[15] = 18000,     -- ~25 hr
	[16] = 22000,     -- ~30 hr
	[17] = 26500,     -- ~35 hr
	[18] = 31500,     -- ~40 hr
	[19] = 37000,     -- ~45 hr
	[20] = 43000,     -- ~50 hr (mid-game milestone)
	[21] = 50000,     -- ~55 hr
	[22] = 58000,     -- ~60 hr
	[23] = 66000,     -- ~65 hr
	[24] = 75000,     -- ~70 hr
	[25] = 85000,     -- ~75 hr (advanced tier)
	[26] = 96000,     -- ~80 hr
	[27] = 108000,    -- ~85 hr
	[28] = 121000,    -- ~90 hr
	[29] = 135000,    -- ~95 hr
	[30] = 150000,    -- ~100 hr (expert tier)
	[31] = 167000,
	[32] = 185000,
	[33] = 205000,
	[34] = 227000,
	[35] = 250000,    -- ~125 hr (master tier)
	[36] = 275000,
	[37] = 302000,
	[38] = 331000,
	[39] = 362000,
	[40] = 400000,    -- ~150 hr (legendary tier)
	[41] = 440000,
	[42] = 483000,
	[43] = 529000,
	[44] = 578000,
	[45] = 630000,    -- ~175 hr
	[46] = 685000,
	[47] = 743000,
	[48] = 804000,
	[49] = 868000,
	[50] = 935000,    -- ~200 hr (MAX)
}

-------------------------------------------------------------------------------
-- TIER SYSTEM
-- Groups of levels that represent meaningful progression milestones.
-- Tiers gate content unlocks and provide display titles.
-------------------------------------------------------------------------------

LevelData.TIERS = {
	{
		Name = "Bronze",
		MinLevel = 1,
		MaxLevel = 10,
		DisplayName = "Bronze Rusher",
		Color = Color3.fromRGB(205, 127, 50),
		Description = "Just getting started on the coin trail.",
	},
	{
		Name = "Silver",
		MinLevel = 11,
		MaxLevel = 20,
		DisplayName = "Silver Collector",
		Color = Color3.fromRGB(192, 192, 192),
		Description = "A seasoned coin hunter with sharp reflexes.",
	},
	{
		Name = "Gold",
		MinLevel = 21,
		MaxLevel = 30,
		DisplayName = "Gold Rusher",
		Color = Color3.fromRGB(255, 215, 0),
		Description = "An arena veteran feared by opponents.",
	},
	{
		Name = "Diamond",
		MinLevel = 31,
		MaxLevel = 40,
		DisplayName = "Diamond Collector",
		Color = Color3.fromRGB(0, 195, 255),
		Description = "Among the elite. Coins bow in your presence.",
	},
	{
		Name = "Meteor",
		MinLevel = 41,
		MaxLevel = 50,
		DisplayName = "Meteor Legend",
		Color = Color3.fromRGB(255, 69, 0),
		Description = "A force of nature. The arena trembles.",
	},
}

-------------------------------------------------------------------------------
-- CONTENT UNLOCKS
-- What becomes available at each level.
-------------------------------------------------------------------------------

LevelData.UNLOCKS = {
	-- Level 1: Starting abilities
	[1] = {
		Features = { "CoinCollection", "SpeedUpgrade", "OpenWorld" },
		Description = "Welcome to Coin Rush Arena! Collect coins and upgrade your speed.",
	},

	-- Level 2: Arena introduction
	[2] = {
		Features = { "CoinKingArena" },
		Description = "Arena unlocked! Enter Coin King and compete for glory.",
	},

	-- Level 3: Magnet upgrade
	[3] = {
		Features = { "MagnetUpgrade" },
		Description = "Magnet upgrade available! Pick up coins from further away.",
	},

	-- Level 5: Power upgrade
	[5] = {
		Features = { "PowerUpgrade" },
		Description = "Power upgrade unlocked! Steal coins with greater force.",
	},

	-- Level 7: Multiplier upgrade
	[7] = {
		Features = { "MultiplierUpgrade" },
		Description = "Multiplier upgrade available! Earn coins faster.",
	},

	-- Level 10: Advanced arena
	[10] = {
		Features = { "SpeedBlitzArena", "Leaderboards" },
		Description = "Speed Blitz unlocked! Team up 4v4 for coin glory.",
	},

	-- Level 15: Daily rewards streak bonus
	[15] = {
		Features = { "StreakBonus" },
		Description = "Streak bonus active! Consecutive arena rounds earn extra coins.",
	},

	-- Level 20: Last Coin Standing
	[20] = {
		Features = { "LastCoinStandingArena" },
		Description = "Last Coin Standing unlocked! 12-player battle royale.",
	},

	-- Level 25: Prestige preview
	[25] = {
		Features = { "PrestigePreview" },
		Description = "Prestige system preview available. Prepare for the ultimate reset.",
	},

	-- Level 30: Prestige system
	[30] = {
		Features = { "PrestigeSystem" },
		Description = "Prestige unlocked! Reset for exclusive cosmetics and permanent bonuses.",
	},

	-- Level 40: Elite shop
	[40] = {
		Features = { "EliteShop" },
		Description = "Elite shop unlocked! Access exclusive legendary cosmetics.",
	},

	-- Level 50: Max level
	[50] = {
		Features = { "MaxLevel", "ChampionTitle" },
		Description = "You've reached the pinnacle! Champion title unlocked.",
	},
}

-------------------------------------------------------------------------------
-- ARENA MODE UNLOCK LEVELS
-------------------------------------------------------------------------------

LevelData.ARENA_MODE_UNLOCKS = {
	CoinKing = 2,          -- Available from level 2
	SpeedBlitz = 10,       -- Available from level 10
	LastCoinStanding = 20, -- Available from level 20
}

-------------------------------------------------------------------------------
-- ARENA MODE UNLOCK REQUIREMENTS (additional)
-------------------------------------------------------------------------------

LevelData.ARENA_MODE_REQUIREMENTS = {
	CoinKing = {
		MinLevel = 2,
		MinSpeedLevel = 0,
		MinArenaRating = 0,
	},
	SpeedBlitz = {
		MinLevel = 10,
		MinSpeedLevel = 3,
		MinArenaRating = 900,
	},
	LastCoinStanding = {
		MinLevel = 20,
		MinSpeedLevel = 5,
		MinArenaRating = 1000,
	},
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get the level for a given TotalCoins amount.
function LevelData.getLevel(totalCoins: number): number
	for level = LevelData.MAX_LEVEL, 1, -1 do
		if totalCoins >= (LevelData.LEVEL_THRESHOLDS[level] or 0) then
			return level
		end
	end
	return 1
end

--- Get coins needed for next level.
function LevelData.getCoinsToNextLevel(totalCoins: number): number
	local currentLevel = LevelData.getLevel(totalCoins)
	if currentLevel >= LevelData.MAX_LEVEL then
		return 0 -- At max level
	end
	local nextThreshold = LevelData.LEVEL_THRESHOLDS[currentLevel + 1] or 0
	return math.max(0, nextThreshold - totalCoins)
end

--- Get progress toward next level (0.0 to 1.0).
function LevelData.getLevelProgress(totalCoins: number): number
	local currentLevel = LevelData.getLevel(totalCoins)
	if currentLevel >= LevelData.MAX_LEVEL then
		return 1.0
	end
	local currentThreshold = LevelData.LEVEL_THRESHOLDS[currentLevel] or 0
	local nextThreshold = LevelData.LEVEL_THRESHOLDS[currentLevel + 1] or 0
	local range = nextThreshold - currentThreshold
	if range <= 0 then return 1.0 end
	return (totalCoins - currentThreshold) / range
end

--- Get the tier for a given level.
function LevelData.getTier(level: number): table?
	for _, tier in ipairs(LevelData.TIERS) do
		if level >= tier.MinLevel and level <= tier.MaxLevel then
			return tier
		end
	end
	return LevelData.TIERS[1] -- fallback to Bronze
end

--- Get all unlocks for a given level (cumulative).
function LevelData.getUnlocksUpToLevel(level: number): { string }
	local features = {}
	for lvl = 1, level do
		local unlock = LevelData.UNLOCKS[lvl]
		if unlock then
			for _, feature in ipairs(unlock.Features) do
				table.insert(features, feature)
			end
		end
	end
	return features
end

--- Check if a feature is unlocked for a given level.
function LevelData.isFeatureUnlocked(level: number, featureName: string): boolean
	for lvl = 1, level do
		local unlock = LevelData.UNLOCKS[lvl]
		if unlock then
			for _, feature in ipairs(unlock.Features) do
				if feature == featureName then
					return true
				end
			end
		end
	end
	return false
end

--- Get level-up reward (coins bonus for reaching a new level).
function LevelData.getLevelUpReward(level: number): number
	if level <= 5 then
		return level * 20      -- 20-100 coins for early levels
	elseif level <= 15 then
		return level * 30      -- 300-450 for mid levels
	elseif level <= 30 then
		return level * 50      -- 750-1500 for high levels
	else
		return level * 80      -- 2400-4000 for endgame
	end
end

return LevelData
