-- Coin Rush Arena: centralized remote event name constants.
-- Prevents string typos across client/server code.
-- Both sides require this module.

local RemoteNames = {
	-- Client → Server
	RequestUpgrade     = "RequestUpgrade",
	JoinArena          = "JoinArena",
	LeaveQueue         = "LeaveQueue",
	ArenaCoinPickup    = "ArenaCoinPickup",
	ArenaPlayerSteal   = "ArenaPlayerSteal",
	ClaimDailyReward   = "ClaimDailyReward",
	ClaimOfflineCoins  = "ClaimOfflineCoins",

	-- Server → Client
	CoinCollected      = "CoinCollected",
	ArenaState         = "ArenaState",
	ArenaScore         = "ArenaScore",
	ArenaResults       = "ArenaResults",
	DailyRewardStatus  = "DailyRewardStatus",
	OfflineCoinsReady  = "OfflineCoinsReady",
	LeaderboardData    = "LeaderboardData",
	FloatingText       = "FloatingText",
}

return RemoteNames
