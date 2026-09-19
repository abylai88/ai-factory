-- AI Factory reusable game system: Teleport pad.
-- Touch to teleport within the same place (cross-place TeleportService
-- intentionally NOT wrapped — needs game-specific safety review).
-- Usage (server): Teleport.wire(pad, Vector3.new(0, 10, 0))

local Teleport = {}

function Teleport.wire(pad: BasePart, destination: Vector3, cooldownSeconds: number?)
	local cd: number = cooldownSeconds or 1
	local busy = false
	pad.Anchored = true
	pad.Touched:Connect(function(hit: BasePart)
		if busy then
			return
		end
		local character = hit:FindFirstAncestorOfClass("Model")
		local root = character and character:FindFirstChild("HumanoidRootPart")
		if not (root and root:IsA("BasePart")) then
			return
		end
		busy = true
		root.CFrame = CFrame.new(destination + Vector3.new(0, 3, 0))
		task.delay(cd, function()
			busy = false
		end)
	end)
end

return Teleport
