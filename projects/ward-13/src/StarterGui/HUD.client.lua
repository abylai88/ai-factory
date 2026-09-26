-- AI Factory Roblox template: HUD wiring.
-- LocalScript in StarterGui. Reads leaderstats for display only; purchases
-- and upgrades go through server-validated remotes (see ReplicatedStorage/Remotes).

local Players = game:GetService("Players")

local player = Players.LocalPlayer

local function onLeaderstats(stats: Instance)
	local coins = stats:WaitForChild("Coins")
	print(("[AI FACTORY] HUD bound, coins: %d"):format((coins :: IntValue).Value))
	;(coins :: IntValue).Changed:Connect(function(value: number)
		print(("[AI FACTORY] Coins: %d"):format(value))
	end)
end

local existing = player:FindFirstChild("leaderstats")
if existing then
	onLeaderstats(existing)
else
	player.ChildAdded:Connect(function(child: Instance)
		if child.Name == "leaderstats" then
			onLeaderstats(child)
		end
	end)
end
