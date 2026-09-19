-- AI Factory reusable game system: Quest (simple kill/collect/visit tracker).
-- Attribute-driven so server + client UI stay in sync without remotes spam.
-- Usage (server):
--   local Quest = require(ReplicatedStorage.Shared.GameSystems.Quest)
--   local q = Quest.new({ id = "coins10", goal = 10 })
--   q:progress(player, 1)

local Quest = {}
Quest.__index = Quest

export type QuestDef = {
	id: string,
	name: string?,
	goal: number,
	reward: number?,
}

function Quest.new(def: QuestDef)
	assert(typeof(def.id) == "string" and #def.id > 0, "quest id required")
	assert(typeof(def.goal) == "number" and def.goal > 0, "quest goal must be positive")
	local self = setmetatable({}, Quest)
	self.id = def.id
	self.name = def.name or def.id
	self.goal = def.goal
	self.reward = def.reward or 0
	return self
end

function Quest:key(player: Player): string
	return ("Quest_%s"):format(self.id)
end

function Quest:get(player: Player): number
	local v = player:GetAttribute(self:key())
	return if typeof(v) == "number" then v else 0
end

function Quest:isDone(player: Player): boolean
	return self:get(player) >= self.goal
end

-- Returns true when this call completed the quest (reward once).
function Quest:progress(player: Player, amount: number?): boolean
	if self:isDone(player) then
		return false
	end
	local next = math.min(self.goal, self:get(player) + (amount or 1))
	player:SetAttribute(self:key(), next)
	if next >= self.goal then
		player:SetAttribute(self:key() .. "_Done", true)
		if self.reward > 0 then
			local Currency = require(script.Parent:WaitForChild("Currency"))
			Currency.grant(player, "Coins", self.reward)
		end
		return true
	end
	return false
end

return Quest
