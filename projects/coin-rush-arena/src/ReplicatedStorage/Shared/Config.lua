-- Coin Rush Arena: shared game constants.
-- ModuleScript in ReplicatedStorage/Shared. Both server scripts and (read-only)
-- client scripts may require this module. Never put secrets here.

local Config = {
	GAME_NAME = "Coin Rush Arena",
	GAME_VERSION = "0.1.0",

	---------------------------------------------------------------------------
	-- COIN SYSTEM
	---------------------------------------------------------------------------
	COIN_RESPAWN_SECONDS = 5,
	COIN_SPAWN_AREA_SIZE = 80, -- studs, full map width
	COIN_SPAWN_HEIGHT = 3,     -- studs above ground
	COIN_MAX_COUNT = 50,       -- max coins in world simultaneously
	COIN_TOUCH_COOLDOWN = 0.3, -- seconds between pickup validations per player

	-- Coin types: value, weight (out of 100), color, material, size
	COIN_TYPES = {
		Bronze = {
			Value = 1,
			Weight = 60,
			Color = Color3.fromRGB(205, 127, 50),
			Material = Enum.Material.SmoothPlastic,
			Size = Vector3.new(0.3, 1.0, 1.0),
			GlowRadius = 2,
		},
		Silver = {
			Value = 5,
			Weight = 25,
			Color = Color3.fromRGB(192, 192, 192),
			Material = Enum.Material.Metal,
			Size = Vector3.new(0.4, 1.4, 1.4),
			GlowRadius = 4,
		},
		Gold = {
			Value = 25,
			Weight = 12,
			Color = Color3.fromRGB(255, 215, 0),
			Material = Enum.Material.Neon,
			Size = Vector3.new(0.5, 1.8, 1.8),
			GlowRadius = 6,
		},
		Meteor = {
			Value = 100,
			Weight = 3,
			Color = Color3.fromRGB(255, 69, 0),
			Material = Enum.Material.Neon,
			Size = Vector3.new(0.6, 2.2, 2.2),
			GlowRadius = 8,
		},
	},

	-- Spawn zone restriction multiplier (1.0 = full map, 0.5 = inner half)
	COIN_SPAWN_RESTRICTION = {
		Bronze = 1.0,
		Silver = 1.0,
		Gold = 0.6, -- inner 60% of map
		Meteor = 0.3, -- inner 30% of map
	},

	---------------------------------------------------------------------------
	-- UPGRADE SYSTEM
	---------------------------------------------------------------------------
	UPGRADE_GROWTH_RATE = 1.6,

	-- Speed upgrade
	START_WALK_SPEED = 16,
	SPEED_UPGRADE_STEP = 2,
	SPEED_UPGRADE_MAX = 32,
	SPEED_BASE_COST = 25,
	SPEED_MAX_LEVEL = 8,

	-- Magnet upgrade
	MAGNET_BASE_COST = 50,
	MAGNET_MAX_LEVEL = 8,
	MAGNET_BASE_RADIUS = 4,  -- studs
	MAGNET_PER_LEVEL = 1,    -- studs per level
	MAGNET_MAX_RADIUS = 12,  -- studs

	-- Power upgrade (arena)
	POWER_BASE_COST = 100,
	POWER_MAX_LEVEL = 10,
	POWER_BASE_DAMAGE = 0,
	POWER_PER_LEVEL = 2,

	-- Coin multiplier upgrade
	MULTI_BASE_COST = 200,
	MULTI_MAX_LEVEL = 5,
	MULTI_BASE = 1.0,
	MULTI_PER_LEVEL = 0.2,

	---------------------------------------------------------------------------
	-- COIN STEAL (ARENA)
	---------------------------------------------------------------------------
	STEAL_PERCENT = 0.10,   -- steal 10% of victim's carried coins
	STEAL_COOLDOWN = 2.0,   -- seconds between steals on same victim
	STEAL_RANGE = 4.0,      -- studs, must be very close
	STEAL_MINIMUM = 1,      -- minimum coins to steal
	INVULN_TIME = 0.5,      -- seconds after being stolen from

	---------------------------------------------------------------------------
	-- ARENA: COIN KING (FFA, 8 players)
	---------------------------------------------------------------------------
	COIN_KING_DURATION = 180,       -- 3 minutes
	COIN_KING_MAX_PLAYERS = 8,
	COIN_KING_MIN_PLAYERS = 2,
	COIN_KING_BOT_FILL_DELAY = 30,  -- seconds before filling with bots
	COIN_KING_COIN_SPAWN_RATE = 2,  -- seconds between coin spawns
	COIN_KING_MAX_COINS = 30,
	COIN_KING_1ST_BONUS = 50,
	COIN_KING_2ND_BONUS = 30,
	COIN_KING_3RD_BONUS = 15,
	COIN_KING_PARTICIPATION = 5,

	-- Coin King coin type weights (slightly more bronze for tension)
	COIN_KING_COIN_TYPES = {
		Bronze = { Value = 1, Weight = 65 },
		Silver = { Value = 5, Weight = 25 },
		Gold = { Value = 25, Weight = 8 },
		Meteor = { Value = 100, Weight = 2 },
	},

	---------------------------------------------------------------------------
	-- ARENA: SPEED BLITZ (Team 4v4) — P1
	---------------------------------------------------------------------------
	SPEED_BLITZ_DURATION = 240,       -- 4 minutes
	SPEED_BLITZ_TEAM_SIZE = 4,
	SPEED_BLITZ_COIN_SPAWN_RATE = 1.5, -- faster pace
	SPEED_BLITZ_PARTY_MULTIPLIER = 1.2,
	SPEED_BLITZ_MAX_PLAYERS = 8,
	SPEED_BLITZ_MIN_PLAYERS = 2,

	---------------------------------------------------------------------------
	-- ARENA: LAST COIN STANDING (FFA, 12 players) — P2
	---------------------------------------------------------------------------
	LCS_DURATION_MAX = 480, -- 8 minutes max
	LCS_MAX_PLAYERS = 12,
	LCS_MIN_PLAYERS = 2,
	LCS_COIN_INTERVAL_MIN = 5,
	LCS_COIN_INTERVAL_MAX = 8,
	LCS_SHRINK_INTERVAL = 120, -- shrink every 2 minutes
	LCS_SHRINK_PERCENT = 0.25, -- reduce by 25%

	---------------------------------------------------------------------------
	-- MATCHMAKING
	---------------------------------------------------------------------------
	MATCH_RATING_RANGE = 200,
	MATCH_MAX_WAIT = 30,     -- seconds before bot fill
	MATCH_COUNTDOWN = 5,     -- seconds before round starts
	MATCH_LOBBY_TIMEOUT = 60, -- seconds to disband empty lobbies

	---------------------------------------------------------------------------
	-- RATING (Elo-like)
	---------------------------------------------------------------------------
	RATING_K_FACTOR = 32,
	RATING_START = 1000,
	RATING_MIN_CHANGE = -50,
	RATING_MAX_CHANGE = 50,

	---------------------------------------------------------------------------
	-- LEADERSTATS FOLDER NAME
	---------------------------------------------------------------------------
	LEADERSTATS_FOLDER = "leaderstats",

	---------------------------------------------------------------------------
	-- OFFLINE EARNINGS
	---------------------------------------------------------------------------
	OFFLINE_MAX_HOURS = 8,
	OFFLINE_MAX_COINS = 500,
	OFFLINE_VIP_MULTIPLIER = 1.5,
	OFFLINE_MAGNET_BONUS = 0.10,
}

return Config
