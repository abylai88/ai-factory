-- Coin Rush Arena: Daily login rewards service.
-- Server-authoritative daily reward tracking and claiming.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local DailyRewardService = {}

-- Remote references
local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
local claimDailyReward = remotesFolder:WaitForChild(RemoteNames.ClaimDailyReward)
local dailyRewardStatus = remotesFolder:WaitForChild(RemoteNames.DailyRewardStatus)

-- Daily rewards configuration (7-day cycle)
local DAILY_REWARDS = {
	[1] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
	[2] = { Type = "Coins", Amount = 25, Name = "25 Coins" },
	[3] = { Type = "SpeedBoost", Duration = 300, Name = "Speed Boost (5 min)" },
	[4] = { Type = "Coins", Amount = 25, Name = "25 Coins" },
	[5] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
	[6] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
	[7] = { Type = "Crate", Rarity = "Legendary", Name = "Legendary Crate" },
}

-- Get current day in cycle (1-7)
local function getCurrentDay(data): number
	if data.DailyRewardsClaimed == 0 then
		return 1
	end
	local day = (data.DailyRewardsClaimed % 7) + 1
	return day
end

-- Check if player can claim today's reward
function DailyRewardService.canClaim(player: Player): (boolean, number)
	local data = PlayerData.get(player)
	local now = os.time()
	local lastLogin = data.LastLogin or 0

	-- If never logged in before, can claim day 1
	if lastLogin == 0 then
		return true, 1
	end

	-- Check if 24 hours have passed since last login
	local hoursSinceLogin = (now - lastLogin) / 3600
	if hoursSinceLogin >= 24 then
		-- Check if streak should reset (missed a day)
		if hoursSinceLogin > 48 then
			-- Missed more than a day - reset streak
			data.DailyRewardsClaimed = 0
		end
		return true, getCurrentDay(data)
	end

	-- Already claimed today
	return false, getCurrentDay(data)
end

-- Get daily reward status for client
function DailyRewardService.getStatus(player: Player)
	local canClaim, currentDay = DailyRewardService.canClaim(player)
	local data = PlayerData.get(player)
	return {
		day = currentDay,
		canClaim = canClaim,
		streak = data.DailyRewardsClaimed,
		rewards = DAILY_REWARDS,
	}
end

-- Claim daily reward
function DailyRewardService.claimReward(player: Player)
	local canClaim, currentDay = DailyRewardService.canClaim(player)
	if not canClaim then
		return false, "Already claimed today"
	end

	local reward = DAILY_REWARDS[currentDay]
	if not reward then
		return false, "Invalid day"
	end

	local data = PlayerData.get(player)
	local isVip = false -- TODO: Check VIP game pass

	-- Apply reward
	if reward.Type == "Coins" then
		local amount = reward.Amount
		if isVip then
			amount = amount * 2
		end
		PlayerData.addCoins(player, amount)
	elseif reward.Type == "SpeedBoost" then
		-- Apply temporary speed boost (handled client-side with server validation)
		-- For now, just give coins equivalent
		local amount = 100
		if isVip then
			amount = amount * 2
		end
		PlayerData.addCoins(player, amount)
	elseif reward.Type == "Crate" then
		-- Give cosmetic crate (placeholder - would unlock random cosmetic)
		local amount = 500
		if isVip then
			amount = amount * 2
		end
		PlayerData.addCoins(player, amount)
	end

	-- Update streak
	data.DailyRewardsClaimed += 1
	data.LastLogin = os.time()
	PlayerData.syncLeaderstats(player)

	-- Notify client of updated status
	local status = DailyRewardService.getStatus(player)
	dailyRewardStatus:FireClient(player, status)

	return true, reward
end

-- Send status to client on join
function DailyRewardService.notifyClient(player: Player)
	local status = DailyRewardService.getStatus(player)
	dailyRewardStatus:FireClient(player, status)
end

-- Handle claim request from client
claimDailyReward.OnServerEvent:Connect(function(player: Player)
	DailyRewardService.claimReward(player)
end)

return DailyRewardService