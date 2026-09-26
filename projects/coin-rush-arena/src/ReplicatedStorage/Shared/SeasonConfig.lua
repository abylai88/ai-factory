-- Coin Rush Arena: seasonal events and content rotation.
-- Defines seasons, limited-time events, and rotating shop items.
-- Server controls season state; client reads for display.

local SeasonConfig = {}

-------------------------------------------------------------------------------
-- CURRENT SEASON
-- Update these values when a new season starts.
-------------------------------------------------------------------------------

SeasonConfig.CurrentSeason = {
	Id = "season_1",
	Name = "Season 1: Coin Rush Origins",
	Description = "The first season of Coin Rush Arena. Collect, compete, conquer!",
	Number = 1,
	StartDate = 1726089600, -- Unix timestamp: Sep 12, 2026 00:00 UTC
	EndDate = 1734038400,   -- Unix timestamp: Dec 12, 2026 00:00 UTC (90 days)
	BattlePassPrice = 0,     -- Free battle pass for Season 1
	PremiumPassPrice = 499,  -- Robux
	MaxBattlePassTier = 50,
}

-------------------------------------------------------------------------------
-- SEASONAL TIERS (Battle Pass progression)
-- Each tier has a reward. Tier progress is based on "Season XP" earned from
-- arena wins, coin collection milestones, and daily challenges.
-------------------------------------------------------------------------------

SeasonConfig.BattlePassTiers = {
	-- Tier rewards for free track
	Free = {
		[1]  = { Type = "Coins", Amount = 100, Name = "100 Coins" },
		[2]  = { Type = "Coins", Amount = 150, Name = "150 Coins" },
		[3]  = { Type = "Cosmetic", CosmeticId = "trail_dust", Name = "Dust Trail" },
		[4]  = { Type = "Coins", Amount = 200, Name = "200 Coins" },
		[5]  = { Type = "Cosmetic", CosmeticId = "pet_pixel", Name = "Pixel Pet" },
		[6]  = { Type = "Coins", Amount = 250, Name = "250 Coins" },
		[7]  = { Type = "Cosmetic", CosmeticId = "effect_sparkle", Name = "Sparkle Effect" },
		[8]  = { Type = "Coins", Amount = 300, Name = "300 Coins" },
		[9]  = { Type = "Crate", CrateId = "crate_basic", Name = "Basic Crate" },
		[10] = { Type = "Coins", Amount = 500, Name = "500 Coins" },
		[11] = { Type = "Cosmetic", CosmeticId = "trail_blue_streak", Name = "Blue Streak" },
		[12] = { Type = "Coins", Amount = 350, Name = "350 Coins" },
		[13] = { Type = "Crate", CrateId = "crate_basic", Name = "Basic Crate" },
		[14] = { Type = "Coins", Amount = 400, Name = "400 Coins" },
		[15] = { Type = "Cosmetic", CosmeticId = "pet_mini_bolt", Name = "Mini Bolt" },
		[16] = { Type = "Coins", Amount = 450, Name = "450 Coins" },
		[17] = { Type = "Cosmetic", CosmeticId = "effect_aura_blue", Name = "Blue Aura" },
		[18] = { Type = "Coins", Amount = 500, Name = "500 Coins" },
		[19] = { Type = "Crate", CrateId = "crate_basic", Name = "Basic Crate" },
		[20] = { Type = "Coins", Amount = 750, Name = "750 Coins" },
		[21] = { Type = "Cosmetic", CosmeticId = "trail_golden_path", Name = "Golden Path" },
		[22] = { Type = "Coins", Amount = 600, Name = "600 Coins" },
		[23] = { Type = "Crate", CrateId = "crate_premium", Name = "Premium Crate" },
		[24] = { Type = "Coins", Amount = 650, Name = "650 Coins" },
		[25] = { Type = "Cosmetic", CosmeticId = "pet_gold_cube", Name = "Golden Cube" },
		[26] = { Type = "Coins", Amount = 700, Name = "700 Coins" },
		[27] = { Type = "Cosmetic", CosmeticId = "effect_coin_rain", Name = "Coin Rain" },
		[28] = { Type = "Coins", Amount = 800, Name = "800 Coins" },
		[29] = { Type = "Crate", CrateId = "crate_premium", Name = "Premium Crate" },
		[30] = { Type = "Coins", Amount = 1000, Name = "1000 Coins" },
		[31] = { Type = "Cosmetic", CosmeticId = "trail_flame", Name = "Flame Trail" },
		[32] = { Type = "Coins", Amount = 900, Name = "900 Coins" },
		[33] = { Type = "Crate", CrateId = "crate_legendary", Name = "Legendary Crate" },
		[34] = { Type = "Coins", Amount = 950, Name = "950 Coins" },
		[35] = { Type = "Cosmetic", CosmeticId = "pet_flame_spirit", Name = "Flame Spirit" },
		[36] = { Type = "Coins", Amount = 1000, Name = "1000 Coins" },
		[37] = { Type = "Cosmetic", CosmeticId = "effect_flame_aura", Name = "Flame Aura" },
		[38] = { Type = "Coins", Amount = 1100, Name = "1100 Coins" },
		[39] = { Type = "Crate", CrateId = "crate_legendary", Name = "Legendary Crate" },
		[40] = { Type = "Coins", Amount = 1500, Name = "1500 Coins" },
		[41] = { Type = "Cosmetic", CosmeticId = "trail_meteor_shower", Name = "Meteor Shower" },
		[42] = { Type = "Coins", Amount = 1200, Name = "1200 Coins" },
		[43] = { Type = "Crate", CrateId = "crate_meteor", Name = "Meteor Crate" },
		[44] = { Type = "Coins", Amount = 1300, Name = "1300 Coins" },
		[45] = { Type = "Cosmetic", CosmeticId = "pet_meteor_golem", Name = "Meteor Golem" },
		[46] = { Type = "Coins", Amount = 1400, Name = "1400 Coins" },
		[47] = { Type = "Cosmetic", CosmeticId = "effect_meteor_swarm", Name = "Meteor Swarm" },
		[48] = { Type = "Coins", Amount = 1500, Name = "1500 Coins" },
		[49] = { Type = "Crate", CrateId = "crate_meteor", Name = "Meteor Crate" },
		[50] = { Type = "Cosmetic", CosmeticId = "pet_cosmic_serpent", Name = "Cosmic Serpent" },
	},

	-- Premium track (additional rewards on top of free)
	Premium = {
		[1]  = { Type = "Coins", Amount = 200, Name = "200 Coins" },
		[5]  = { Type = "Cosmetic", CosmeticId = "trail_golden_path", Name = "Golden Path (Exclusive)" },
		[10] = { Type = "Crate", CrateId = "crate_premium", Name = "Premium Crate" },
		[15] = { Type = "Cosmetic", CosmeticId = "effect_coin_rain", Name = "Coin Rain (Exclusive)" },
		[20] = { Type = "Crate", CrateId = "crate_legendary", Name = "Legendary Crate" },
		[25] = { Type = "Cosmetic", CosmeticId = "pet_neon_dragon", Name = "Neon Dragon" },
		[30] = { Type = "Crate", CrateId = "crate_legendary", Name = "Legendary Crate" },
		[35] = { Type = "Cosmetic", CosmeticId = "trail_flame", Name = "Flame Trail (Exclusive)" },
		[40] = { Type = "Crate", CrateId = "crate_meteor", Name = "Meteor Crate" },
		[45] = { Type = "Cosmetic", CosmeticId = "pet_meteor_golem", Name = "Meteor Golem (Exclusive)" },
		[50] = { Type = "Cosmetic", CosmeticId = "trail_cosmic_rift", Name = "Cosmic Rift (Exclusive)" },
	},
}

-------------------------------------------------------------------------------
-- SEASON XP REQUIREMENTS
-- How much XP is needed per battle pass tier.
-------------------------------------------------------------------------------

SeasonConfig.XP_PER_TIER = 500 -- XP needed for each tier

-------------------------------------------------------------------------------
-- SEASONAL EVENTS
-- Limited-time events that occur during a season.
-------------------------------------------------------------------------------

SeasonConfig.Events = {
	{
		Id = "event_coin_frenzy",
		Name = "Coin Frenzy",
		Description = "All coin values doubled! Collect as much as you can.",
		Type = "CoinMultiplier",
		Multiplier = 2.0,
		StartDate = 1726694400, -- Sep 19, 2026
		EndDate = 1726953600,   -- Sep 22, 2026 (3 days)
		IsActive = false,
	},
	{
		Id = "event_arena_tournament",
		Name = "Arena Tournament",
		Description = "3x rating gains and bonus coins for arena wins!",
		Type = "ArenaBonus",
		RatingMultiplier = 3.0,
		CoinMultiplier = 3.0,
		StartDate = 1728508800, -- Oct 10, 2026
		EndDate = 1728768000,   -- Oct 13, 2026 (3 days)
		IsActive = false,
	},
	{
		Id = "event_meteor_shower",
		Name = "Meteor Shower",
		Description = "Meteor coins spawn 5x more frequently!",
		Type = "CoinSpawnBoost",
		SpawnWeightMultiplier = 5.0,
		TargetCoinType = "Meteor",
		StartDate = 1730409600, -- Nov 1, 2026
		EndDate = 1730668800,   -- Nov 4, 2026 (3 days)
		IsActive = false,
	},
	{
		Id = "event_harvest_festival",
		Name = "Harvest Festival",
		Description = "All upgrades cost 25% less during the festival!",
		Type = "UpgradeDiscount",
		DiscountPercent = 25,
		StartDate = 1731014400, -- Nov 8, 2026
		EndDate = 1731446400,   -- Nov 13, 2026 (5 days)
		IsActive = false,
	},
	{
		Id = "event_winter_wonderland",
		Name = "Winter Wonderland",
		Description = "Special winter cosmetics available! 2x offline coins.",
		Type = "OfflineBoost",
		OfflineMultiplier = 2.0,
		StartDate = 1733433600, -- Dec 6, 2026
		EndDate = 1734038400,   -- Dec 13, 2026 (season end)
		IsActive = false,
	},
}

-------------------------------------------------------------------------------
-- ROTATING SHOP
-- Items that rotate on a schedule (daily/weekly).
-------------------------------------------------------------------------------

SeasonConfig.RotatingShop = {
	-- Daily rotation items (pick 3 per day from this pool)
	DailyPool = {
		{ CosmeticId = "pet_coin_basic", Price = 300, Currency = "Coins" },
		{ CosmeticId = "pet_mini_bolt", Price = 300, Currency = "Coins" },
		{ CosmeticId = "trail_dust", Price = 250, Currency = "Coins" },
		{ CosmeticId = "effect_sparkle", Price = 200, Currency = "Coins" },
		{ CosmeticId = "pet_silver_orb", Price = 500, Currency = "Coins" },
		{ CosmeticId = "trail_blue_streak", Price = 450, Currency = "Coins" },
		{ CosmeticId = "pet_speed_wisp", Price = 500, Currency = "Coins" },
		{ CosmeticId = "effect_aura_blue", Price = 400, Currency = "Coins" },
		{ CosmeticId = "pet_gold_cube", Price = 800, Currency = "Coins" },
		{ CosmeticId = "trail_golden_path", Price = 750, Currency = "Coins" },
		{ CosmeticId = "effect_coin_rain", Price = 700, Currency = "Coins" },
		{ CosmeticId = "pet_flame_spirit", Price = 1000, Currency = "Coins" },
		{ CosmeticId = "trail_flame", Price = 900, Currency = "Coins" },
		{ CosmeticId = "effect_flame_aura", Price = 850, Currency = "Coins" },
		{ CosmeticId = "pet_neon_dragon", Price = 1500, Currency = "Coins" },
	},
	DailyCount = 3, -- Number of items shown per day
	DailyRefreshHour = 0, -- UTC hour for daily refresh

	-- Weekly rotation items (pick 1 per week)
	WeeklyPool = {
		{ CosmeticId = "pet_meteor_golem", Price = 3000, Currency = "Coins" },
		{ CosmeticId = "trail_meteor_shower", Price = 2500, Currency = "Coins" },
		{ CosmeticId = "effect_meteor_swarm", Price = 2000, Currency = "Coins" },
		{ CosmeticId = "pet_cosmic_serpent", Price = 5000, Currency = "Coins" },
		{ CosmeticId = "trail_cosmic_rift", Price = 4000, Currency = "Coins" },
	},
	WeeklyCount = 1,
	WeeklyRefreshDay = 1, -- Monday
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Check if a season event is currently active.
function SeasonConfig.isEventActive(eventId: string): boolean
	for _, event in ipairs(SeasonConfig.Events) do
		if event.Id == eventId then
			local now = os.time()
			return now >= event.StartDate and now <= event.EndDate
		end
	end
	return false
end

--- Get all currently active events.
function SeasonConfig.getActiveEvents(): { table }
	local active = {}
	local now = os.time()
	for _, event in ipairs(SeasonConfig.Events) do
		if now >= event.StartDate and now <= event.EndDate then
			table.insert(active, event)
		end
	end
	return active
end

--- Check if the current season is active.
function SeasonConfig.isSeasonActive(): boolean
	local now = os.time()
	return now >= SeasonConfig.CurrentSeason.StartDate
		and now <= SeasonConfig.CurrentSeason.EndDate
end

--- Get time remaining in current season (in seconds).
function SeasonConfig.getSeasonTimeRemaining(): number
	local now = os.time()
	return math.max(0, SeasonConfig.CurrentSeason.EndDate - now)
end

--- Calculate battle pass tier from total XP.
function SeasonConfig.getTierFromXP(totalXP: number): number
	return math.min(
		SeasonConfig.CurrentSeason.MaxBattlePassTier,
		math.floor(totalXP / SeasonConfig.XP_PER_TIER) + 1
	)
end

--- Calculate XP progress within current tier.
function SeasonConfig.getTierProgress(totalXP: number): number
	local xpInTier = totalXP % SeasonConfig.XP_PER_TIER
	return xpInTier / SeasonConfig.XP_PER_TIER
end

--- Get daily shop seed (deterministic based on date).
function SeasonConfig.getDailyShopSeed(): number
	local today = os.date("*t")
	return today.year * 10000 + today.month * 100 + today.day
end

--- Get rotating shop items for today (deterministic selection).
function SeasonConfig.getDailyShopItems(): { table }
	local seed = SeasonConfig.getDailyShopSeed()
	math.randomseed(seed)

	local pool = SeasonConfig.RotatingShop.DailyPool
	local count = math.min(SeasonConfig.RotatingShop.DailyCount, #pool)

	-- Fisher-Yates shuffle to pick unique items
	local shuffled = {}
	for i, item in ipairs(pool) do
		shuffled[i] = item
	end
	for i = #shuffled, 2, -1 do
		local j = math.random(1, i)
		shuffled[i], shuffled[j] = shuffled[j], shuffled[i]
	end

	local result = {}
	for i = 1, count do
		table.insert(result, shuffled[i])
	end
	return result
end

return SeasonConfig
