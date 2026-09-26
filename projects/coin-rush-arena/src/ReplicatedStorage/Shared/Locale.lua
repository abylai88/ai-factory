-- Coin Rush Arena: UI strings / localization module.
-- Centralizes all player-facing text strings for easy translation and consistency.
-- Client-side only (UI rendering). Server should never need locale strings.

local Locale = {}

-------------------------------------------------------------------------------
-- LANGUAGE: English (default)
-- Add additional languages as separate tables and switch via Locale.setLanguage()
-------------------------------------------------------------------------------

local strings = {
	---------------------------------------------------------------------------
	-- GENERAL / UI
	---------------------------------------------------------------------------
	GameName = "Coin Rush Arena",
	Version = "v0.1.0",
	Loading = "Loading...",
	Welcome = "Welcome!",
	WelcomeBack = "Welcome Back!",
	Ok = "OK",
	Cancel = "Cancel",
	Confirm = "Confirm",
	Close = "Close",
	Back = "Back",
	Next = "Next",
	Yes = "Yes",
	No = "No",
	Play = "Play",
	Quit = "Quit",
	Error = "Error",
	Success = "Success",
	Retry = "Retry",
	Restart = "Restart",
	Continue = "Continue",
	Claim = "Claim",
	Equip = "Equip",
	Unequip = "Unequip",
	Locked = "Locked",
	Unlocked = "Unlocked",
	MaxLevel = "MAX",
	Level = "Level",
	LevelUp = "LEVEL UP!",
	Coins = "Coins",
	Rating = "Rating",
	Wins = "Wins",
	GamesPlayed = "Games Played",

	---------------------------------------------------------------------------
	-- HUD
	---------------------------------------------------------------------------
	HUD_Coins = "Coins",
	HUD_Speed = "Speed: Lv.%d",
	HUD_Magnet = "Magnet: Lv.%d",
	HUD_Power = "Power: Lv.%d",
	HUD_Multiplier = "Multiplier: Lv.%d",
	HUD_ArenaWins = "Arena Wins: %d",
	HUD_ArenaRating = "Rating: %d",
	HUD_Level = "Lv.%d",
	HUD_Tier = "%s Tier",
	HUD_CoinsToNext = "%d coins to Lv.%d",

	---------------------------------------------------------------------------
	-- UPGRADES
	---------------------------------------------------------------------------
	Upgrades_Title = "UPGRADES",
	Upgrade_Speed = "Speed",
	Upgrade_Speed_Desc = "Increases WalkSpeed",
	Upgrade_Speed_Next = "Speed → Lv.%d (+%d speed)",
	Upgrade_Magnet = "Magnet",
	Upgrade_Magnet_Desc = "Increases coin pickup radius",
	Upgrade_Magnet_Next = "Magnet → Lv.%d (+%d studs)",
	Upgrade_Power = "Power",
	Upgrade_Power_Desc = "Increases arena steal damage",
	Upgrade_Power_Next = "Power → Lv.%d (+%d damage)",
	Upgrade_Multiplier = "Multiplier",
	Upgrade_Multiplier_Desc = "Increases coin collection rate",
	Upgrade_Multiplier_Next = "Multiplier → Lv.%d (+%.1fx)",
	Upgrade_Cost = "Cost: %d",
	Upgrade_Maxed = "%s [MAX]",
	Upgrade_CannotAfford = "Not enough coins!",
	Upgrade_Purchased = "%s upgraded to Lv.%d!",
	Upgrade_LevelUp = "LEVEL UP! %s → Lv.%d",

	---------------------------------------------------------------------------
	-- ARENA
	---------------------------------------------------------------------------
	Arena_Enter = "Enter Arena",
	Arena_LeaveQueue = "Leave Queue",
	Arena_InArena = "In Arena",
	Arena_ReturnToFarm = "Return to Farm",
	Arena_Searching = "Searching for match...",
	Arena_Players = "Players: %d/%d",
	Arena_StartingIn = "Starting in %d...",
	Arena_CollectCoins = "Collect coins! Duration: %ds",
	Arena_RoundOver = "Round Over!",
	Arena_Placement = "Placement: #%d",
	Arena_CoinsEarned = "Coins: %d",
	Arena_Bonus = "Bonus: %d",
	Arena_Total = "Total: %d",
	Arena_RatingChange = "Rating: %+d",
	Arena_Win = "🏆 VICTORY!",
	Arena_Loss = "ROUND OVER",
	Arena_PlayAgain = "Play Again",
	Arena_Remaining = "Time: %ds",

	-- Arena modes
	Arena_CoinKing = "Coin King",
	Arena_CoinKing_Desc = "Collect the most coins in 3 minutes!",
	Arena_SpeedBlitz = "Speed Blitz",
	Arena_SpeedBlitz_Desc = "Team up 4v4 and collect the most coins!",
	Arena_LastCoinStanding = "Last Coin Standing",
	Arena_LastCoinStanding_Desc = "Grab the coin or get eliminated!",

	-- Arena scores
	Arena_Score_Yours = "You: %d",
	Arena_Score_Leader = "Leader: %d",
	Arena_Streak = "%dx STREAK!",
	Arena_TeamsForming = "Teams forming...",
	Arena_TeamRed = "Team Red",
	Arena_TeamBlue = "Team Blue",
	Arena_Eliminated = "ELIMINATED!",
	Arena_LastPlayer = "Last player standing!",

	---------------------------------------------------------------------------
	-- STEAL
	---------------------------------------------------------------------------
	Steal_Victim = "-%d STOLEN!",
	Steal_Stealer = "+%d STOLEN!",
	Steal_Cooldown = "Steal on cooldown!",
	Steal_TooFar = "Too far away!",

	---------------------------------------------------------------------------
	-- OFFLINE COINS
	---------------------------------------------------------------------------
	Offline_Title = "WELCOME BACK!",
	Offline_Duration = "You were away for %s",
	Offline_Coins = "You earned %d coins while away!",
	Offline_Hours = "%dh %dm",
	Offline_Minutes = "%dm",
	Offline_Claim = "Claim %d Coins",
	Offline_None = "No coins earned yet. Come back later!",
	Offline_Max = "Maximum offline time reached (8 hours)",

	---------------------------------------------------------------------------
	-- DAILY REWARDS
	---------------------------------------------------------------------------
	Daily_Title = "DAILY REWARDS",
	Daily_Day = "Day %d",
	Daily_Claimed = "Claimed!",
	Daily_ClaimNow = "Claim Day %d Reward!",
	Daily_Streak = "Streak: %d days",
	Daily_Tomorrow = "Come back tomorrow!",
	Daily_Complete = "Week Complete! +500 bonus coins!",
	Daily_Reward_50Coins = "50 Coins",
	Daily_Reward_25Coins = "25 Coins",
	Daily_Reward_SpeedBoost = "Speed Boost (5 min)",
	Daily_Reward_LegendaryCrate = "Legendary Crate",
	Daily_Reward_VIP2x = "VIP 2x Bonus!",

	---------------------------------------------------------------------------
	-- SHOP
	---------------------------------------------------------------------------
	Shop_Title = "SHOP",
	Shop_GamePasses = "Game Passes",
	Shop_CoinPacks = "Coin Packs",
	Shop_Boosts = "Boosts",
	Shop_Crates = "Crates",
	Shop_Cosmetics = "Cosmetics",
	Shop_Owned = "Owned",
	Shop_Equip = "Equip",
	Shop_Buy = "Buy",
	Shop_BuyConfirm = "Buy %s for %d Robux?",
	Shop_BuyCoins = "Buy %s for %d coins?",
	Shop_PurchaseSuccess = "Purchase successful!",
	Shop_PurchaseFailed = "Purchase failed. Please try again.",
	Shop_AlreadyOwned = "You already own this!",
	Shop_NotEnoughCoins = "Not enough coins!",
	Shop_BestValue = "BEST VALUE",
	Shop_New = "NEW",
	Shop_Sale = "SALE",

	---------------------------------------------------------------------------
	-- LEADERBOARD
	---------------------------------------------------------------------------
	Leaderboard_Title = "LEADERBOARDS",
	Leaderboard_Global = "Global",
	Leaderboard_Friends = "Friends",
	Leaderboard_Server = "Server",
	Leaderboard_TotalCoins = "Total Coins",
	Leaderboard_ArenaWins = "Arena Wins",
	Leaderboard_ArenaRating = "Arena Rating",
	Leaderboard_WinStreak = "Win Streak",
	Leaderboard_WeeklyCoins = "Weekly Coins",
	Leaderboard_You = "You",
	Leaderboard_Rank = "#%d",
	Leaderboard_NoData = "No leaderboard data available.",

	---------------------------------------------------------------------------
	-- SETTINGS
	---------------------------------------------------------------------------
	Settings_Title = "SETTINGS",
	Settings_Music = "Music",
	Settings_SFX = "Sound Effects",
	Settings_Particles = "Particles",
	Settings_ScreenShake = "Screen Shake",
	Settings_MobileControls = "Mobile Controls",
	Settings_DataReset = "Reset All Data",
	Settings_DataResetConfirm = "Are you sure? This cannot be undone!",
	Settings_Credits = "Credits",
	Settings_Version = "Version %s",

	---------------------------------------------------------------------------
	-- TUTORIAL / ONBOARDING
	---------------------------------------------------------------------------
	Tutorial_Welcome = "Welcome to Coin Rush Arena!",
	Tutorial_CollectCoins = "Walk over coins to collect them!",
	Tutorial_UpgradeSpeed = "Upgrade your speed to move faster!",
	Tutorial_UpgradeMagnet = "Upgrade magnet to pick up coins from further away!",
	Tutorial_EnterArena = "Enter the arena to compete for bonus coins!",
	Tutorial_Steal = "Bump into opponents to steal their coins!",
	Tutorial_ComeBack = "Come back daily for free rewards!",
	Tutorial_Skip = "Skip Tutorial",

	---------------------------------------------------------------------------
	-- LEVEL UP NOTIFICATIONS
	---------------------------------------------------------------------------
	LevelUp_CoinKing = "Coin King arena unlocked!",
	LevelUp_MagnetUpgrade = "Magnet upgrade available!",
	LevelUp_PowerUpgrade = "Power upgrade unlocked!",
	LevelUp_MultiplierUpgrade = "Multiplier upgrade available!",
	LevelUp_SpeedBlitz = "Speed Blitz 4v4 unlocked!",
	LevelUp_LastCoinStanding = "Last Coin Standing unlocked!",
	LevelUp_Prestige = "Prestige system unlocked!",
	LevelUp_EliteShop = "Elite shop unlocked!",
	LevelUp_Champion = "You've become a Champion!",

	---------------------------------------------------------------------------
	-- ERRORS / WARNINGS
	---------------------------------------------------------------------------
	Error_DataLoad = "Failed to load your data. Please rejoin.",
	Error_DataSave = "Failed to save your data.",
	Error_ArenaJoin = "Failed to join arena. Please try again.",
	Error_AlreadyInArena = "You're already in an arena!",
	Error_NotInArena = "You're not in an arena!",
	Error_MaxLevel = "Already at maximum level!",
	Error_Cooldown = "Please wait before trying again.",
	Error_ServerFull = "Server is full. Please try another server.",
	Error_PurchaseFailed = "Purchase failed. Please try again.",
	Warning_DataCorrupted = "Some data may be corrupted. Reset recommended.",

	---------------------------------------------------------------------------
	-- TIME FORMATTING
	---------------------------------------------------------------------------
	Time_Days = "%dd",
	Time_Hours = "%dh",
	Time_Minutes = "%dm",
	Time_Seconds = "%ds",
	Time_DayHour = "%dd %dh",
	Time_HourMinute = "%dh %dm",
	Time_MinuteSecond = "%dm %ds",
	Time_Permanent = "Permanent",

	---------------------------------------------------------------------------
	-- TOOLTIPS
	---------------------------------------------------------------------------
	Tooltip_Speed = "Makes you walk faster. Max level: %d",
	Tooltip_Magnet = "Pick up coins from further away. Max radius: %d studs",
	Tooltip_Power = "Increases steal power in arena. Max damage: %d",
	Tooltip_Multiplier = "Earn more coins per pickup. Max multiplier: %.1fx",
	Tooltip_2xCoins = "Permanent 2x coin collection",
	Tooltip_VIP = "VIP: 1.5x offline, 2x daily rewards, chat tag",
	Tooltip_SpeedBoost = "+4 permanent WalkSpeed",
	Tooltip_MagnetBoost = "+3 permanent pickup radius",

	---------------------------------------------------------------------------
	-- MISC
	---------------------------------------------------------------------------
	Misc_Placeholder = "[TODO: %s]",
	Misc_Connecting = "Connecting to server...",
	Misc_Saving = "Saving data...",
	Misc_GenericError = "Something went wrong. Please try again.",
}

-------------------------------------------------------------------------------
-- MODULE STATE
-------------------------------------------------------------------------------

local currentLanguage = "en"
local languages = { en = strings }

-------------------------------------------------------------------------------
-- PUBLIC API
-------------------------------------------------------------------------------

--- Get a string by key with optional format arguments.
-- Usage: Locale.get("HUD_Speed", 5) → "Speed: Lv.5"
function Locale.get(key: string, ...: any): string
	local langStrings = languages[currentLanguage] or languages["en"]
	local str = langStrings[key]
	if not str then
		return "[MISSING: " .. key .. "]"
	end
	if select("#", ...) > 0 then
		return string.format(str, ...)
	end
	return str
end

--- Shorthand alias for Locale.get().
Locale.t = Locale.get

--- Set the current language.
function Locale.setLanguage(lang: string)
	if languages[lang] then
		currentLanguage = lang
	else
		warn("[Locale] Unknown language: " .. lang)
	end
end

--- Get current language code.
function Locale.getLanguage(): string
	return currentLanguage
end

--- Register a new language (for future localizations).
function Locale.registerLanguage(lang: string, stringsTable: { [string]: string })
	languages[lang] = stringsTable
end

--- Get all available language codes.
function Locale.getAvailableLanguages(): { string }
	local langs = {}
	for lang in pairs(languages) do
		table.insert(langs, lang)
	end
	return langs
end

--- Format a coin amount with commas (e.g., 12345 → "12,345").
function Locale.formatCoins(amount: number): string
	local formatted = tostring(amount)
	local k
	while true do
		formatted, k = string.gsub(formatted, "^(-?%d+)(%d%d%d)", "%1,%2")
		if k == 0 then break end
	end
	return formatted
end

--- Format a duration in seconds to human-readable string.
-- Usage: Locale.formatDuration(3661) → "1h 1m"
function Locale.formatDuration(seconds: number): string
	if seconds < 60 then
		return Locale.get("Time_Seconds", math.floor(seconds))
	elseif seconds < 3600 then
		local mins = math.floor(seconds / 60)
		local secs = math.floor(seconds % 60)
		if secs > 0 then
			return Locale.get("Time_MinuteSecond", mins, secs)
		end
		return Locale.get("Time_Minutes", mins)
	elseif seconds < 86400 then
		local hours = math.floor(seconds / 3600)
		local mins = math.floor((seconds % 3600) / 60)
		if mins > 0 then
			return Locale.get("Time_HourMinute", hours, mins)
		end
		return Locale.get("Time_Hours", hours)
	else
		local days = math.floor(seconds / 86400)
		local hours = math.floor((seconds % 86400) / 3600)
		if hours > 0 then
			return Locale.get("Time_DayHour", days, hours)
		end
		return Locale.get("Time_Days", days)
	end
end

--- Format a rating change with sign.
-- Usage: Locale.formatRatingChange(25) → "+25"
function Locale.formatRatingChange(change: number): string
	if change >= 0 then
		return "+" .. tostring(change)
	end
	return tostring(change)
end

--- Format a multiplier value.
-- Usage: Locale.formatMultiplier(1.5) → "1.5x"
function Locale.formatMultiplier(multiplier: number): string
	return string.format("%.1fx", multiplier)
end

return Locale
