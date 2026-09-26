-- Coin Rush Arena: arena mode configurations (shared).
-- Arena-specific constants used by both server and client.

local ArenaConfig = {
	-- Coin King (FFA, 8 players)
	CoinKing = {
		Name = "CoinKing",
		DisplayName = "Coin King",
		Description = "Collect the most coins in 3 minutes!",
		Duration = 180,
		MaxPlayers = 8,
		MinPlayers = 2,
		BotFillDelay = 30,
		CoinSpawnRate = 2,
		MaxCoins = 30,
		FirstBonus = 50,
		SecondBonus = 30,
		ThirdBonus = 15,
		ParticipationBonus = 5,
		CoinTypes = {
			Bronze = { Value = 1, Weight = 65 },
			Silver = { Value = 5, Weight = 25 },
			Gold = { Value = 25, Weight = 8 },
			Meteor = { Value = 100, Weight = 2 },
		},
		SpawnAreaSize = 40, -- smaller than open world
		SpawnHeight = 3,
	},

	-- Speed Blitz (Team 4v4) — P1
	SpeedBlitz = {
		Name = "SpeedBlitz",
		DisplayName = "Speed Blitz",
		Description = "Team up and collect the most coins!",
		Duration = 240,
		MaxPlayers = 8,
		MinPlayers = 2,
		TeamSize = 4,
		CoinSpawnRate = 1.5,
		PartyMultiplier = 1.2,
		SpawnAreaSize = 40,
		SpawnHeight = 3,
	},

	-- Last Coin Standing (FFA, 12 players) — P2
	LastCoinStanding = {
		Name = "LastCoinStanding",
		DisplayName = "Last Coin Standing",
		Description = "Grab the coin or get eliminated!",
		DurationMax = 480,
		MaxPlayers = 12,
		MinPlayers = 2,
		CoinIntervalMin = 5,
		CoinIntervalMax = 8,
		ShrinkInterval = 120,
		ShrinkPercent = 0.25,
		SpawnAreaSize = 60,
		SpawnHeight = 3,
	},
}

return ArenaConfig
