-- AI Factory Roblox template: client entry point.
-- LocalScripts under StarterPlayer/StarterPlayerScripts run on each client.
-- They render state and send requests; the server owns authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))

local player = Players.LocalPlayer

print(("[AI FACTORY] Client online for %s (game: %s)"):format(player.Name, Config.GAME_NAME))

-------------------------------------------------------------------------------
-- 1. Wait for remotes (created by server)
-------------------------------------------------------------------------------

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local requestUpgrade = remotes:WaitForChild("RequestUpgrade")

-------------------------------------------------------------------------------
-- 2. Create upgrade button UI
-------------------------------------------------------------------------------

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "UpgradeGui"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

local upgradeButton = Instance.new("TextButton")
upgradeButton.Name = "UpgradeButton"
upgradeButton.Size = UDim2.new(0, 200, 0, 50)
upgradeButton.Position = UDim2.new(1, -220, 1, -70)
upgradeButton.AnchorPoint = Vector2.new(0, 0)
upgradeButton.BackgroundColor3 = Color3.fromRGB(50, 150, 50)
upgradeButton.TextColor3 = Color3.fromRGB(255, 255, 255)
upgradeButton.Font = Enum.Font.GothamBold
upgradeButton.TextSize = 18
upgradeButton.Text = "Upgrade Speed"
upgradeButton.Parent = screenGui

local costLabel = Instance.new("TextLabel")
costLabel.Name = "CostLabel"
costLabel.Size = UDim2.new(1, 0, 0, 20)
costLabel.Position = UDim2.new(0, 0, 1, -20)
costLabel.BackgroundTransparency = 1
costLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
costLabel.Font = Enum.Font.Gotham
costLabel.TextSize = 14
costLabel.Text = ""
costLabel.Parent = upgradeButton

-------------------------------------------------------------------------------
-- 3. Wire upgrade button
-------------------------------------------------------------------------------

upgradeButton.Activated:Connect(function()
	requestUpgrade:FireServer()
end)

-- Disable button when at max speed or insufficient coins.
local function updateButton()
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then
		return
	end
	local coinsVal = leaderstats:FindFirstChild("Coins")
	local speedVal = leaderstats:FindFirstChild("SpeedLevel")
	if not coinsVal or not speedVal then
		return
	end

	local currentCoins = coinsVal.Value
	local speedLevel = speedVal.Value
	local cost = math.floor(Config.UPGRADE_BASE_COST * math.pow(1.6, speedLevel))
	local maxed = speedLevel >= Config.SPEED_UPGRADE_MAX
	local canAfford = currentCoins >= cost

	if maxed then
		upgradeButton.BackgroundColor3 = Color3.fromRGB(100, 100, 100)
		upgradeButton.Text = "Max Speed"
		costLabel.Text = ""
	elseif canAfford then
		upgradeButton.BackgroundColor3 = Color3.fromRGB(50, 150, 50)
		upgradeButton.Text = "Upgrade Speed"
		costLabel.Text = ("Cost: %d coins"):format(cost)
	else
		upgradeButton.BackgroundColor3 = Color3.fromRGB(150, 50, 50)
		upgradeButton.Text = "Upgrade Speed"
		costLabel.Text = ("Cost: %d coins"):format(cost)
	end
end

local function bindLeaderstats(leaderstats: Instance)
	local coinsVal = leaderstats:WaitForChild("Coins")
	local speedVal = leaderstats:WaitForChild("SpeedLevel")
	updateButton()
	coinsVal.Changed:Connect(updateButton)
	speedVal.Changed:Connect(updateButton)
end

local existing = player:FindFirstChild("leaderstats")
if existing then
	bindLeaderstats(existing)
else
	player.ChildAdded:Connect(function(child: Instance)
		if child.Name == "leaderstats" then
			bindLeaderstats(child)
		end
	end)
end
