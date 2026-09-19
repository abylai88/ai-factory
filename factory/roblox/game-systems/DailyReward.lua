-- AI Factory reusable game system: Daily reward (join-streak, attribute-based).
-- Server-only streak tracking; client reads attributes for UI.
-- Usage (server): DailyReward.claim(player) -> (boolean, string)

local DailyReward = {}

DailyReward.DAY_SECONDS = 24 * 60 * 60
DailyReward.REWARDS = { 25, 50, 75, 100, 150, 200, 300 }

function DailyReward.claim(player: Player, nowUnix: number?): (boolean, string)
	local now: number = nowUnix or os.time()
	local last = player:GetAttribute("DailyLastClaim") or 0
	if typeof(last) ~= "number" then
		last = 0
	end
	if now - last < DailyReward.DAY_SECONDS then
		return false, "already claimed today"
	end
	local streak = player:GetAttribute("DailyStreak") or 0
	if typeof(streak) ~= "number" then
		streak = 0
	end
	-- Reset streak when a full day was skipped.
	if now - last > DailyReward.DAY_SECONDS * 2 then
		streak = 0
	end
	streak += 1
	local index = math.clamp(streak, 1, #DailyReward.REWARDS)
	local amount: number = DailyReward.REWARDS[index]
	player:SetAttribute("DailyLastClaim", now)
	player:SetAttribute("DailyStreak", streak)
	local Currency = require(script.Parent:WaitForChild("Currency"))
	Currency.grant(player, "Coins", amount)
	return true, ("day %d: +%d coins"):format(streak, amount)
end

return DailyReward
