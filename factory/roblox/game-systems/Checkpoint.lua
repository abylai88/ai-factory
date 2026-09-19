-- AI Factory reusable game system: Checkpoint.
-- Touch a pad to set respawn; SpawnLocation-neutral (works with any spawn).
-- Usage (server): Checkpoint.wireFolder(folderWithPads)

local Checkpoint = {}

function Checkpoint.wirePad(pad: BasePart)
	if not pad:IsA("BasePart") then
		return
	end
	pad.Anchored = true
	local touched = false
	pad.Touched:Connect(function(hit: BasePart)
		if touched then
			return
		end
		local character = hit:FindFirstAncestorOfClass("Model")
		local player = character and game:GetService("Players"):GetPlayerFromCharacter(character)
		if not player then
			return
		end
		touched = true
		player:SetAttribute("Checkpoint", pad:GetFullName())
		player:SetAttribute("CheckpointPosition", pad.Position)
		-- Brief visual feedback (server-owned part color flash).
		local old = pad.Color
		pad.Color = Color3.fromRGB(80, 220, 120)
		task.delay(0.6, function()
			pad.Color = old
			touched = false
		end)
	end)
end

function Checkpoint.wireFolder(folder: Instance)
	for _, child in ipairs(folder:GetChildren()) do
		if child:IsA("BasePart") then
			Checkpoint.wirePad(child)
		end
	end
	folder.ChildAdded:Connect(function(child: Instance)
		if child:IsA("BasePart") then
			Checkpoint.wirePad(child)
		end
	end)
end

return Checkpoint
