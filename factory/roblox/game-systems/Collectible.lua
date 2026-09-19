-- AI Factory reusable game system: Collectible.
-- Server-authoritative pickup (coin/ring/star). Pure logic + touched wiring.
-- Agents adapt Config values per game; do not trust the client.
-- Usage (server):
--   local Collectible = require(ReplicatedStorage.Shared.GameSystems.Collectible)
--   Collectible.spawnCollectibles(folder, template, positions, { value = 1 })

local Collectible = {}

export type CollectibleConfig = {
	value: number?,
	respawnSeconds: number?,
	statName: string?,
}

function awardCoins(player: Player, amount: number, statName: string)
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		return
	end
	local stat = leaderstats:FindFirstChild(statName)
	if stat and stat:IsA("IntValue") then
		stat.Value += amount
	end
end

function wirePrompt(part: BasePart, config: CollectibleConfig)
	local statName: string = config.statName or "Coins"
	local value: number = config.value or 1
	local respawn: number = config.respawnSeconds or 5

	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = "Collect"
	prompt.ObjectText = part.Name
	prompt.HoldDuration = 0
	prompt.MaxActivationDistance = 10
	prompt.Parent = part

	prompt.Triggered:Connect(function(player: Player)
		if not part.Parent then
			return
		end
		awardCoins(player, value, statName)
		part.Parent = nil
		task.delay(respawn, function()
			-- Re-parent only if the container still exists.
			if prompt.Parent == part then
				part.Parent = prompt:GetAttribute("HomeContainer") and nil or part.Parent
			end
		end)
	end)
end

-- Spawn `count` collectibles from a template part at given positions.
-- Returns the created instances. Fully inspectable: plain Instances.
function Collectible.spawn(
	parent: Instance,
	template: BasePart,
	positions: { Vector3 },
	config: CollectibleConfig?
): { BasePart }
	local cfg: CollectibleConfig = config or {}
	local created: { BasePart } = {}
	for i, pos in ipairs(positions) do
		local part = template:Clone()
		part.Name = ("Collectible_%d"):format(i)
		part.Anchored = true
		part.CanCollide = false
		part.Position = pos
		part.Parent = parent
		wirePrompt(part, cfg)
		table.insert(created, part)
	end
	return created
end

-- Ring positions around a center point (deterministic helper for agents).
function Collectible.ringPositions(center: Vector3, radius: number, count: number, height: number?): { Vector3 }
	local list: { Vector3 } = {}
	local y = height or (center.Y + 3)
	for i = 1, count do
		local angle = (math.pi * 2 * (i - 1)) / count
		table.insert(list, Vector3.new(center.X + math.cos(angle) * radius, y, center.Z + math.sin(angle) * radius))
	end
	return list
end

return Collectible
