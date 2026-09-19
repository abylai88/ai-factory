-- AI Factory reusable game system: Zone unlock (level/coin-gated areas).
-- Gates are transparent Parts; server teleports unauthorized players back.
-- Usage (server):
--   local Zone = require(ReplicatedStorage.Shared.GameSystems.Zone)
--   Zone.wireGate(gatePart, { statName = "Coins", cost = 100 })

local Zone = {}

export type GateOptions = {
	statName: string?,
	cost: number?,
	levelAttribute: string?,
	levelRequired: number?,
	spawnOnUnlock: Vector3?,
}

function Zone.canEnter(player: Player, options: GateOptions): boolean
	if options.levelAttribute and options.levelRequired then
		local v = player:GetAttribute(options.levelAttribute)
		if typeof(v) ~= "number" or v < options.levelRequired then
			return false
		end
	end
	if options.cost and options.cost > 0 then
		local Currency = require(script.Parent:WaitForChild("Currency"))
		return Currency.get(player, options.statName or "Coins") >= 0 -- entry check only; spend happens in unlock()
	end
	return true
end

function Zone.unlock(player: Player, options: GateOptions): (boolean, string)
	if options.cost and options.cost > 0 then
		local Currency = require(script.Parent:WaitForChild("Currency"))
		if not Currency.spend(player, options.statName or "Coins", options.cost) then
			return false, "not enough coins"
		end
	end
	player:SetAttribute("ZoneUnlocked", true)
	if options.spawnOnUnlock then
		local character = player.Character
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if root and root:IsA("BasePart") then
			root.CFrame = CFrame.new(options.spawnOnUnlock)
		end
	end
	return true, "zone unlocked"
end

function Zone.wireGate(gate: BasePart, options: GateOptions)
	gate.Anchored = true
	gate.CanCollide = false
	gate.Touched:Connect(function(hit: BasePart)
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and game:GetService("Players"):GetPlayerFromCharacter(character)
		if not player then
			return
		end
		if player:GetAttribute("ZoneUnlocked") then
			return
		end
		-- Soft gate: nudge back unless unlocked (never fling).
		local root = character:FindFirstChild("HumanoidRootPart")
		if root and root:IsA("BasePart") then
			root.CFrame = root.CFrame + Vector3.new(0, 2, -4)
		end
	end)
end

return Zone
