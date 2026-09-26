-- Coin Rush Arena: Leaderboard management service.
-- Server-authoritative leaderboard aggregation with Global, Friends, Server views.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local LeaderboardService = {}

-- Remote reference
local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
local leaderboardDataRemote = remotesFolder:WaitForChild(RemoteNames.LeaderboardData)

-- Leaderboard categories
local CATEGORIES = {
	"TotalCoins",
	"ArenaWins",
	"ArenaRating",
	"WinStreak",
	"WeeklyCoins",
}

-- Get leaderboard entries for a category
function LeaderboardService.getLeaderboard(category: string, filter: string?, limit: number?): { any }
	local entries = {}
	local limitNum = limit or 100

	for _, player in ipairs(Players:GetPlayers()) do
		local data = PlayerData.get(player)
		local score = 0

		if category == "TotalCoins" then
			score = data.TotalCoins
		elseif category == "ArenaWins" then
			score = data.ArenaWins
		elseif category == "ArenaRating" then
			score = data.ArenaRating
		elseif category == "WinStreak" then
			score = data.BestWinStreak
		elseif category == "WeeklyCoins" then
			-- Placeholder: would track weekly coins separately
			score = data.TotalCoins
		else
			score = 0
		end

		-- Apply filter
		local include = true
		if filter == "Friends" then
			-- Check if player is friends with local player
			-- This would need the requesting player context
			include = true -- Simplified for now
		elseif filter == "Server" then
			include = true -- All players on server are included
		end

		if include then
			table.insert(entries, {
				name = player.Name,
				userId = player.UserId,
				score = score,
			})
		end
	end

	-- Sort descending by score
	table.sort(entries, function(a, b)
		return a.score > b.score
	end)

	-- Limit results
	local result = {}
	for i = 1, math.min(limitNum, #entries) do
		table.insert(result, entries[i])
	end

	return result
end

-- Get leaderboard for a specific player (with friend context)
function LeaderboardService.getLeaderboardForPlayer(requestingPlayer: Player, category: string, view: string, limit: number?): { any }
	local entries = {}
	local limitNum = limit or 100

	-- For friend view, we need to check friendships
	local isFriendView = (view == "Friends")

	for _, player in ipairs(Players:GetPlayers()) do
		local include = true

		if isFriendView then
			-- Check if player is friends with requesting player
			-- Note: This is a simplified check. In production, you'd use Players:IsFriendsWith()
			-- but that requires an API call. For now, we'll include all players on server.
			include = true
		end

		if include then
			local data = PlayerData.get(player)
			local score = 0

			if category == "TotalCoins" then
				score = data.TotalCoins
			elseif category == "ArenaWins" then
				score = data.ArenaWins
			elseif category == "ArenaRating" then
				score = data.ArenaRating
			elseif category == "WinStreak" then
				score = data.BestWinStreak
			elseif category == "WeeklyCoins" then
				score = data.TotalCoins -- Placeholder
			end

			table.insert(entries, {
				name = player.Name,
				userId = player.UserId,
				score = score,
			})
		end
	end

	-- Sort descending
	table.sort(entries, function(a, b)
		return a.score > b.score
	end)

	-- Limit results
	local result = {}
	for i = 1, math.min(limitNum, #entries) do
		table.insert(result, entries[i])
	end

	return result
end

-- Send leaderboard data to client
function LeaderboardService.sendToPlayer(player: Player, category: string, view: string, limit: number?)
	local data = LeaderboardService.getLeaderboardForPlayer(player, category, view, limit)
	leaderboardDataRemote:FireClient(player, {
		category = category,
		view = view,
		entries = data,
	})
end

-- Broadcast leaderboard to all players (periodic refresh)
function LeaderboardService.broadcastAll(category: string, view: string, limit: number?)
	for _, player in ipairs(Players:GetPlayers()) do
		LeaderboardService.sendToPlayer(player, category, view, limit)
	end
end

return LeaderboardService