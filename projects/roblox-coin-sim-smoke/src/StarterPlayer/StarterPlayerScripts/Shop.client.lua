-- Shop client: requests speed upgrades through the server-validated remote.
-- Display only: the server decides whether the purchase succeeds.

local ReplicatedStorage = game:GetService("ReplicatedStorage")

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local upgradeFn = remotes:WaitForChild("UpgradeShop") :: RemoteFunction

local function requestUpgrade()
	local ok, result = pcall(function()
		return upgradeFn:InvokeServer()
	end)
	if ok then
		print("[AI FACTORY] Upgrade result:", result)
	else
		warn("[AI FACTORY] Upgrade failed:", result)
	end
end

-- Demo hook: expose for bound UI buttons (StarterGui) to call.
_G.RequestSpeedUpgrade = requestUpgrade

print("[AI FACTORY] Shop client online")
