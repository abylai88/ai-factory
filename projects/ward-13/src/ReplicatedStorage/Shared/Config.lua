-- AI Factory Roblox template: shared configuration.
-- ModuleScript in ReplicatedStorage/Shared. Both server scripts and (read-only)
-- client scripts may require this module. Never put secrets here.

local Config = {
	GAME_NAME = "AI Factory Game",
	GAME_VERSION = "0.1.0",

	-- Coin simulator defaults (agents extend these per mission).
	COIN_VALUE = 1,
	COIN_RESPAWN_SECONDS = 5,
	START_WALK_SPEED = 16,
	SPEED_UPGRADE_STEP = 2,
	SPEED_UPGRADE_MAX = 32,
	UPGRADE_BASE_COST = 25,

	-- DataStore keys.
	DATASTORE_NAME = "AIFactorySaveV1",
	AUTOSAVE_SECONDS = 60,
}

return Config
