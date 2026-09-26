-- Coin Rush Arena: Offline/idle coin calculation service.
-- Server-authoritative offline coin accumulation.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local MathService = require(game:GetService("ServerStorage"):WaitForChild("MathService"))
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

local OfflineService = {}

-- Remote reference
local remotesFolder = ReplicatedStorage:WaitForChild("Remotes")
local offlineCoinsReady = remotesFolder:WaitForChild(RemoteNames.OfflineCoinsReady)

-- Calculate offline coins for a player on login
function OfflineService.calculateOffline(player: Player): (number, number)
	local data = PlayerData.get(player)
	local now = os.time()
	local offlineTime = now - data.LastOnline

	-- Validate offline time (prevent clock manipulation)
	-- Cap at reasonable max (8 hours + 1 hour buffer for clock drift)
	local maxAllowed = (Config.OFFLINE_MAX_HOURS + 1) * 3600
	if offlineTime > maxAllowed then
		offlineTime = maxAllowed
		warn(("[OfflineService] Suspicious offline time for %s: %ds, capped"):format(player.Name, offlineTime))
	end

	-- Check VIP status (placeholder - would check game passes)
	local isVip = false -- TODO: MarketplaceService:UserOwnsGamePassAsync(player.UserId, VIP_PASS_ID)

	local coins = MathService.calculateOfflineCoins(
		offlineTime,
		data.MagnetLevel,
		data.MultiplierLevel,
		isVip
	)

	return coins, offlineTime
end

-- Claim offline coins
function OfflineService.claimOffline(player: Player): number
	local coins, timeAway = OfflineService.calculateOffline(player)
	if coins > 0 then
		PlayerData.addCoins(player, coins)
		local data = PlayerData.get(player)
		data.LastOnline = os.time()
		PlayerData.syncLeaderstats(player)
	end
	return coins
end

-- Send offline coins data to client on join
function OfflineService.notifyClient(player: Player)
	local coins, timeAway = OfflineService.calculateOffline(player)
	if coins > 0 then
		offlineCoinsReady:FireClient(player, coins, timeAway)
	end
end

return OfflineService