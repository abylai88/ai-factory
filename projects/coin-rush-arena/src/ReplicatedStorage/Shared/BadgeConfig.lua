-- Coin Rush Arena: achievement/badge definitions.
-- Defines all achievements, their unlock conditions, and rewards.
-- Server validates unlock conditions; client displays achievement progress.

local BadgeConfig = {}

-------------------------------------------------------------------------------
-- ACHIEVEMENT CATEGORIES
-------------------------------------------------------------------------------

BadgeConfig.Categories = {
	{
		Name = "Collection",
		DisplayName = "Collection",
		Icon = "Coins",
		Description = "Milestones for collecting coins",
	},
	{
		Name = "Arena",
		DisplayName = "Arena",
		Icon = "Sword",
		Description = "Arena combat achievements",
	},
	{
		Name = "Progression",
		DisplayName = "Progression",
		Icon = "Star",
		Description = "Level and upgrade milestones",
	},
	{
		Name = "Social",
		DisplayName = "Social",
		Icon = "People",
		Description = "Party and friends achievements",
	},
	{
		Name = "Special",
		DisplayName = "Special",
		Icon = "Trophy",
		Description = "Rare and challenging feats",
	},
}

-------------------------------------------------------------------------------
-- ACHIEVEMENT DEFINITIONS
-------------------------------------------------------------------------------

BadgeConfig.Achievements = {
	-- =========================================================================
	-- COLLECTION ACHIEVEMENTS
	-- =========================================================================
	{
		Id = "ach_first_coin",
		Name = "First Pick",
		Description = "Collect your first coin.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 10 },
		Points = 5,
	},
	{
		Id = "ach_coin_100",
		Name = "Penny Pincher",
		Description = "Collect 100 coins total.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 100,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 50 },
		Points = 10,
	},
	{
		Id = "ach_coin_1000",
		Name = "Coin Collector",
		Description = "Collect 1,000 coins total.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 1000,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 100 },
		Points = 20,
	},
	{
		Id = "ach_coin_10000",
		Name = "Coin Hoarder",
		Description = "Collect 10,000 coins total.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 10000,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 500 },
		Points = 40,
	},
	{
		Id = "ach_coin_100000",
		Name = "Coin Tycoon",
		Description = "Collect 100,000 coins total.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 100000,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_legendary" },
		Points = 80,
	},
	{
		Id = "ach_coin_1000000",
		Name = "Millionaire",
		Description = "Collect 1,000,000 coins total.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "TotalCoins",
			Value = 1000000,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_meteor" },
		Points = 200,
	},
	{
		Id = "ach_meteor_hunter",
		Name = "Meteor Hunter",
		Description = "Collect 10 Meteor coins.",
		Category = "Collection",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "MeteorCoins",
			Value = 10,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "effect_meteor_swarm" },
		Points = 50,
	},

	-- =========================================================================
	-- ARENA ACHIEVEMENTS
	-- =========================================================================
	{
		Id = "ach_first_arena",
		Name = "Arena Rookie",
		Description = "Play your first arena round.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "GamesPlayed",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 25 },
		Points = 5,
	},
	{
		Id = "ach_first_win",
		Name = "First Victory",
		Description = "Win your first arena round.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaWins",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 100 },
		Points = 15,
	},
	{
		Id = "ach_win_10",
		Name = "Arena Veteran",
		Description = "Win 10 arena rounds.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaWins",
			Value = 10,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_golden_path" },
		Points = 30,
	},
	{
		Id = "ach_win_50",
		Name = "Arena Champion",
		Description = "Win 50 arena rounds.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaWins",
			Value = 50,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_legendary" },
		Points = 80,
	},
	{
		Id = "ach_win_100",
		Name = "Arena Legend",
		Description = "Win 100 arena rounds.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaWins",
			Value = 100,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "pet_cosmic_serpent" },
		Points = 200,
	},
	{
		Id = "ach_games_100",
		Name = "Dedicated Competitor",
		Description = "Play 100 arena rounds.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "GamesPlayed",
			Value = 100,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 1000 },
		Points = 40,
	},
	{
		Id = "ach_games_500",
		Name = "Arena Addict",
		Description = "Play 500 arena rounds.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "GamesPlayed",
			Value = 500,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_cosmic_rift" },
		Points = 120,
	},
	{
		Id = "ach_win_streak_3",
		Name = "Hat Trick",
		Description = "Win 3 arena rounds in a row.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "BestWinStreak",
			Value = 3,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 200 },
		Points = 25,
	},
	{
		Id = "ach_win_streak_5",
		Name = "On Fire!",
		Description = "Win 5 arena rounds in a row.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "BestWinStreak",
			Value = 5,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "effect_flame_aura" },
		Points = 50,
	},
	{
		Id = "ach_win_streak_10",
		Name = "Unstoppable",
		Description = "Win 10 arena rounds in a row.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "BestWinStreak",
			Value = 10,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_meteor" },
		Points = 150,
	},
	{
		Id = "ach_rating_1200",
		Name = "Rising Star",
		Description = "Reach 1200 arena rating.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaRating",
			Value = 1200,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 500 },
		Points = 30,
	},
	{
		Id = "ach_rating_1500",
		Name = "Arena Master",
		Description = "Reach 1500 arena rating.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaRating",
			Value = 1500,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "pet_neon_dragon" },
		Points = 100,
	},
	{
		Id = "ach_rating_2000",
		Name = "Grandmaster",
		Description = "Reach 2000 arena rating.",
		Category = "Arena",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "ArenaRating",
			Value = 2000,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_cosmic_rift" },
		Points = 250,
	},

	-- =========================================================================
	-- PROGRESSION ACHIEVEMENTS
	-- =========================================================================
	{
		Id = "ach_speed_5",
		Name = "Getting Faster",
		Description = "Reach Speed level 5.",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "SpeedLevel",
			Value = 5,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 100 },
		Points = 10,
	},
	{
		Id = "ach_speed_max",
		Name = "Maximum Velocity",
		Description = "Reach maximum Speed level (8).",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "SpeedLevel",
			Value = 8,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_blue_streak" },
		Points = 30,
	},
	{
		Id = "ach_magnet_max",
		Name = "Master Magnet",
		Description = "Reach maximum Magnet level (8).",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "MagnetLevel",
			Value = 8,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "effect_coin_rain" },
		Points = 30,
	},
	{
		Id = "ach_power_max",
		Name = "Power Overwhelming",
		Description = "Reach maximum Power level (10).",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PowerLevel",
			Value = 10,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "pet_meteor_golem" },
		Points = 50,
	},
	{
		Id = "ach_multi_max",
		Name = "Multiplier Master",
		Description = "Reach maximum Multiplier level (5).",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "MultiplierLevel",
			Value = 5,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_meteor_shower" },
		Points = 50,
	},
	{
		Id = "ach_level_10",
		Name = "Double Digits",
		Description = "Reach player level 10.",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PlayerLevel",
			Value = 10,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 200 },
		Points = 15,
	},
	{
		Id = "ach_level_25",
		Name = "Quarter Century",
		Description = "Reach player level 25.",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PlayerLevel",
			Value = 25,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_legendary" },
		Points = 60,
	},
	{
		Id = "ach_level_50",
		Name = "Maxed Out",
		Description = "Reach maximum player level (50).",
		Category = "Progression",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PlayerLevel",
			Value = 50,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "pet_cosmic_serpent" },
		Points = 200,
	},

	-- =========================================================================
	-- SOCIAL ACHIEVEMENTS
	-- =========================================================================
	{
		Id = "ach_party_arena",
		Name = "Team Player",
		Description = "Complete an arena round in a party.",
		Category = "Social",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PartyRoundsPlayed",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 50 },
		Points = 10,
	},
	{
		Id = "ach_party_win",
		Name = "Party Champion",
		Description = "Win an arena round in a party.",
		Category = "Social",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PartyWins",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 150 },
		Points = 20,
	},

	-- =========================================================================
	-- SPECIAL ACHIEVEMENTS
	-- =========================================================================
	{
		Id = "ach_daily_7",
		Name = "Loyal Customer",
		Description = "Log in for 7 consecutive days.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "DailyLoginStreak",
			Value = 7,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 500 },
		Points = 30,
	},
	{
		Id = "ach_daily_30",
		Name = "Dedicated Fan",
		Description = "Log in for 30 consecutive days.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "DailyLoginStreak",
			Value = 30,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_meteor" },
		Points = 100,
	},
	{
		Id = "ach_perfect_round",
		Name = "Perfect Round",
		Description = "Win a Coin King round without being stolen from.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "PerfectRounds",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 300 },
		Points = 40,
	},
	{
		Id = "ach_speed_demon",
		Name = "Speed Demon",
		Description = "Collect 50 coins in a single arena round.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "MaxCoinsInRound",
			Value = 50,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "pet_speed_wisp" },
		Points = 50,
	},
	{
		Id = "ach_big_steal",
		Name = "Jackpot Thief",
		Description = "Steal 20+ coins in a single steal.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "MaxStealAmount",
			Value = 20,
			Comparison = ">=",
		},
		Reward = { Type = "Coins", Amount = 250 },
		Points = 35,
	},
	{
		Id = "ach_no_upgrades_win",
		Name = "Pure Skill",
		Description = "Win an arena round with all upgrades at level 0.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "NoUpgradeWins",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Cosmetic", CosmeticId = "trail_cosmic_rift" },
		Points = 150,
	},
	{
		Id = "ach_all_upgrades_max",
		Name = "Fully Loaded",
		Description = "Max out all upgrade types.",
		Category = "Special",
		Icon = "rbxassetid://0",
		Condition = {
			Type = "AllUpgradesMaxed",
			Value = 1,
			Comparison = ">=",
		},
		Reward = { Type = "Crate", CrateId = "crate_meteor" },
		Points = 200,
	},
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get achievements by category.
function BadgeConfig.getByCategory(categoryName: string): { table }
	local result = {}
	for _, ach in ipairs(BadgeConfig.Achievements) do
		if ach.Category == categoryName then
			table.insert(result, ach)
		end
	end
	return result
end

--- Get an achievement by ID.
function BadgeConfig.getById(id: string): table?
	for _, ach in ipairs(BadgeConfig.Achievements) do
		if ach.Id == id then
			return ach
		end
	end
	return nil
end

--- Calculate total achievement points from unlocked achievements.
function BadgeConfig.calculateTotalPoints(unlockedIds: { [string]: boolean }): number
	local total = 0
	for _, ach in ipairs(BadgeConfig.Achievements) do
		if unlockedIds[ach.Id] then
			total += ach.Points
		end
	end
	return total
end

--- Check if an achievement condition is met based on player data.
function BadgeConfig.checkCondition(achievement: table, playerData: table): boolean
	local condition = achievement.Condition
	if not condition then return false end

	local value = 0

	-- Map condition type to player data field
	if condition.Type == "TotalCoins" then
		value = playerData.TotalCoins or 0
	elseif condition.Type == "ArenaWins" then
		value = playerData.ArenaWins or 0
	elseif condition.Type == "ArenaRating" then
		value = playerData.ArenaRating or 0
	elseif condition.Type == "GamesPlayed" then
		value = playerData.GamesPlayed or 0
	elseif condition.Type == "BestWinStreak" then
		value = playerData.BestWinStreak or 0
	elseif condition.Type == "SpeedLevel" then
		value = playerData.SpeedLevel or 0
	elseif condition.Type == "MagnetLevel" then
		value = playerData.MagnetLevel or 0
	elseif condition.Type == "PowerLevel" then
		value = playerData.PowerLevel or 0
	elseif condition.Type == "MultiplierLevel" then
		value = playerData.MultiplierLevel or 0
	elseif condition.Type == "PlayerLevel" then
		value = playerData.PlayerLevel or 1
	elseif condition.Type == "DailyLoginStreak" then
		value = playerData.DailyLoginStreak or 0
	elseif condition.Type == "MeteorCoins" then
		value = playerData.MeteorCoins or 0
	elseif condition.Type == "PartyRoundsPlayed" then
		value = playerData.PartyRoundsPlayed or 0
	elseif condition.Type == "PartyWins" then
		value = playerData.PartyWins or 0
	elseif condition.Type == "PerfectRounds" then
		value = playerData.PerfectRounds or 0
	elseif condition.Type == "MaxCoinsInRound" then
		value = playerData.MaxCoinsInRound or 0
	elseif condition.Type == "MaxStealAmount" then
		value = playerData.MaxStealAmount or 0
	elseif condition.Type == "NoUpgradeWins" then
		value = playerData.NoUpgradeWins or 0
	elseif condition.Type == "AllUpgradesMaxed" then
		-- Special: check if all upgrades are maxed
		local allMax = (playerData.SpeedLevel or 0) >= 8
			and (playerData.MagnetLevel or 0) >= 8
			and (playerData.PowerLevel or 0) >= 10
			and (playerData.MultiplierLevel or 0) >= 5
		value = allMax and 1 or 0
	end

	-- Apply comparison
	if condition.Comparison == ">=" then
		return value >= condition.Value
	elseif condition.Comparison == "==" then
		return value == condition.Value
	elseif condition.Comparison == ">" then
		return value > condition.Value
	end

	return false
end

--- Get all unlocked achievements from player data.
function BadgeConfig.getUnlocked(playerData: table): { string }
	local unlocked = {}
	for _, ach in ipairs(BadgeConfig.Achievements) do
		if BadgeConfig.checkCondition(ach, playerData) then
			table.insert(unlocked, ach.Id)
		end
	end
	return unlocked
end

--- Get total possible achievement points.
function BadgeConfig.getMaxPoints(): number
	local total = 0
	for _, ach in ipairs(BadgeConfig.Achievements) do
		total += ach.Points
	end
	return total
end

return BadgeConfig
