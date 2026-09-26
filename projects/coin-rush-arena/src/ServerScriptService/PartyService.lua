-- Coin Rush Arena: Party system service.
-- Handles party creation, invitations, and party-based bonuses.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))

local PartyService = {}

-- Party state: { [leaderUserId] = { leader, members: { [userId] = player }, invites: { [userId] = player } } }
local parties = {}

-- Party bonus multiplier
local PARTY_COIN_MULTIPLIER = Config.SPEED_BLITZ_PARTY_MULTIPLIER or 1.2

-- Create a new party
function PartyService.createParty(leader: Player): boolean
	if parties[leader.UserId] then
		return false -- Already leading a party
	end

	-- Check if player is already in a party
	for _, party in pairs(parties) do
		if party.members[leader.UserId] then
			return false -- Already in a party
		end
	end

	parties[leader.UserId] = {
		leader = leader,
		members = { [leader.UserId] = leader },
		invites = {},
	}

	PartyService.notifyPartyUpdate(leader.UserId)
	return true
end

-- Invite a player to a party
function PartyService.invitePlayer(leader: Player, target: Player): boolean
	local party = parties[leader.UserId]
	if not party then
		return false -- Not a party leader
	end

	if party.members[target.UserId] then
		return false -- Already in party
	end

	if party.invites[target.UserId] then
		return false -- Already invited
	end

	if #party.members >= 4 then
		return false -- Party full (max 4 for Speed Blitz teams)
	end

	party.invites[target.UserId] = target
	-- TODO: Send invite notification to target client
	return true
end

-- Accept party invitation
function PartyService.acceptInvite(player: Player, leaderUserId: number): boolean
	local party = parties[leaderUserId]
	if not party then
		return false -- Party doesn't exist
	end

	if not party.invites[player.UserId] then
		return false -- Not invited
	end

	if #party.members >= 4 then
		return false -- Party full
	end

	-- Remove from any other party first
	PartyService.leaveParty(player)

	-- Add to party
	party.members[player.UserId] = player
	party.invites[player.UserId] = nil

	PartyService.notifyPartyUpdate(leaderUserId)
	return true
end

-- Leave party
function PartyService.leaveParty(player: Player)
	for leaderId, party in pairs(parties) do
		if party.members[player.UserId] then
			party.members[player.UserId] = nil

			if leaderId == player.UserId then
				-- Leader left - disband party or promote new leader
				if next(party.members) then
					-- Promote first member to leader
					local newLeader = next(party.members)
					local newLeaderPlayer = party.members[newLeader]
					parties[leaderId] = nil
					parties[newLeader] = {
						leader = newLeaderPlayer,
						members = party.members,
						invites = party.invites,
					}
					PartyService.notifyPartyUpdate(newLeader)
				else
					parties[leaderId] = nil
				end
			else
				PartyService.notifyPartyUpdate(leaderId)
			end
			break
		end
	end
end

-- Get party for a player
function PartyService.getParty(player: Player)
	for _, party in pairs(parties) do
		if party.members[player.UserId] then
			return party
		end
	end
	return nil
end

-- Check if player is in a party
function PartyService.hasParty(player: Player): boolean
	return PartyService.getParty(player) ~= nil
end

-- Get party members
function PartyService.getMembers(player: Player): { Player }
	local party = PartyService.getParty(player)
	if not party then return {} end

	local members = {}
	for _, p in pairs(party.members) do
		table.insert(members, p)
	end
	return members
end

-- Get party coin multiplier for a player
function PartyService.getCoinMultiplier(player: Player): number
	if PartyService.hasParty(player) then
		return PARTY_COIN_MULTIPLIER
	end
	return 1.0
end

-- Notify all party members of update
function PartyService.notifyPartyUpdate(leaderUserId: number)
	local party = parties[leaderUserId]
	if not party then return end

	-- Build member list
	local memberList = {}
	for _, player in pairs(party.members) do
		table.insert(memberList, {
			name = player.Name,
			userId = player.UserId,
		})
	end

	-- Send to all members
	for _, player in pairs(party.members) do
		-- TODO: Fire RemoteEvent with party update
		-- For now, we'll just use the existing arena state remote
	end
end

-- Get party for Speed Blitz team assignment
function PartyService.getPartyForTeamAssignment(leaderUserId: number): { Player }?
	local party = parties[leaderUserId]
	if not party then return nil end

	local members = {}
	for _, player in pairs(party.members) do
		table.insert(members, player)
	end
	return members
end

-- Cleanup on player leave
Players.PlayerRemoving:Connect(function(player: Player)
	PartyService.leaveParty(player)
end)

return PartyService