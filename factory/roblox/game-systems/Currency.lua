-- AI Factory reusable game system: Currency (leaderstats).
-- Server-authoritative coin/gem/XP stats. Client treats values as display-only.
-- Usage (server):
--   local Currency = require(ReplicatedStorage.Shared.GameSystems.Currency)
--   Currency.setupLeaderstats(player, { { name = "Coins" }, { name = "Gems" } })

local Currency = {}

export type StatDef = {
	name: string,
	start: number?,
}

function Currency.setupLeaderstats(player: Player, stats: { StatDef }?): Folder
	local defs: { StatDef } = stats or { { name = "Coins" } }
	local folder = Instance.new("Folder")
	folder.Name = "leaderstats"
	for _, def in ipairs(defs) do
		local v = Instance.new("IntValue")
		v.Name = def.name
		v.Value = def.start or 0
		v.Parent = folder
	end
	folder.Parent = player
	return folder
end

function Currency.get(player: Player, statName: string): number
	local folder = player:FindFirstChild("leaderstats")
	local stat = folder and folder:FindFirstChild(statName)
	if stat and stat:IsA("IntValue") then
		return stat.Value
	end
	return 0
end

-- Returns true when the purchase succeeded (server is the authority).
function Currency.spend(player: Player, statName: string, amount: number): boolean
	if amount <= 0 then
		return false
	end
	local folder = player:FindFirstChild("leaderstats")
	local stat = folder and folder:FindFirstChild(statName)
	if stat and stat:IsA("IntValue") and stat.Value >= amount then
		stat.Value -= amount
		return true
	end
	return false
end

function Currency.grant(player: Player, statName: string, amount: number)
	if amount <= 0 then
		return
	end
	local folder = player:FindFirstChild("leaderstats")
	local stat = folder and folder:FindFirstChild(statName)
	if stat and stat:IsA("IntValue") then
		stat.Value += amount
	end
end

return Currency
