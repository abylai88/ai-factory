-- AI Factory reusable game system: NPC interaction (dialogue prompt stub).
-- ProximityPrompt + RemoteEvent friendly. Server owns effects.
-- Usage (server): Npc.wire(npcModel, { promptText = "Talk", onTalk = fn })

local Npc = {}

export type NpcOptions = {
	promptText: string?,
	holdDuration: number?,
	onTalk: ((player: Player) -> ())?,
}

function Npc.wire(npc: Model, options: NpcOptions?)
	local cfg: NpcOptions = options or {}
	local root = npc:FindFirstChild("HumanoidRootPart") or npc:FindFirstChildWhichIsA("BasePart", true)
	if not root or not root:IsA("BasePart") then
		return
	end
	local prompt = Instance.new("ProximityPrompt")
	prompt.ActionText = cfg.promptText or "Talk"
	prompt.HoldDuration = cfg.holdDuration or 0
	prompt.MaxActivationDistance = 12
	prompt.Parent = root
	prompt.Triggered:Connect(function(player: Player)
		if cfg.onTalk then
			task.spawn(cfg.onTalk, player)
		else
			print(("[Npc] %s talked to %s"):format(player.Name, npc.Name))
		end
	end)
end

return Npc
