-- Coin Rush Arena: server-only configuration.
-- ModuleScript in ServerStorage. Only server scripts may require this.
-- Contains secrets and internal tuning not exposed to clients.

local ServerConfig = {
	-- DataStore keys (secret - clients must not know the exact key name).
	DATASTORE_NAME = "CoinRushArenaV1",

	-- Internal server timing.
	AUTOSAVE_SECONDS = 60,
	DATASTORE_RETRY_COUNT = 3,
	DATASTORE_RETRY_DELAY = 1,
	MAX_PLAYERS = 50,
}

return ServerConfig
