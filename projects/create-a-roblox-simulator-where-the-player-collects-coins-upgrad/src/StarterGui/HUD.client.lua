-- AI Factory Roblox template: HUD wiring.
-- LocalScript in StarterGui. Reads leaderstats for display only; purchases
-- and upgrades go through server-validated remotes (see ReplicatedStorage/Remotes).

local Players = game:GetService("Players")

local player = Players.LocalPlayer

-------------------------------------------------------------------------------
-- 1. Create HUD ScreenGui
-------------------------------------------------------------------------------

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "HUD"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

-- Background frame (top-left corner).
local frame = Instance.new("Frame")
frame.Name = "StatsFrame"
frame.Size = UDim2.new(0, 220, 0, 100)
frame.Position = UDim2.new(0, 10, 0, 10)
frame.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
frame.BackgroundTransparency = 0.3
frame.BorderSizePixel = 0
frame.Parent = screenGui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 8)
corner.Parent = frame

-- Coins label.
local coinsLabel = Instance.new("TextLabel")
coinsLabel.Name = "CoinsLabel"
coinsLabel.Size = UDim2.new(1, -16, 0, 36)
coinsLabel.Position = UDim2.new(0, 8, 0, 8)
coinsLabel.BackgroundTransparency = 1
coinsLabel.TextColor3 = Color3.fromRGB(255, 215, 0) -- gold
coinsLabel.Font = Enum.Font.GothamBold
coinsLabel.TextSize = 20
coinsLabel.TextXAlignment = Enum.TextXAlignment.Left
coinsLabel.Text = "Coins: 0"
coinsLabel.Parent = frame

-- Speed label.
local speedLabel = Instance.new("TextLabel")
speedLabel.Name = "SpeedLabel"
speedLabel.Size = UDim2.new(1, -16, 0, 36)
speedLabel.Position = UDim2.new(0, 8, 0, 50)
speedLabel.BackgroundTransparency = 1
speedLabel.TextColor3 = Color3.fromRGB(150, 200, 255) -- light blue
speedLabel.Font = Enum.Font.GothamBold
speedLabel.TextSize = 20
speedLabel.TextXAlignment = Enum.TextXAlignment.Left
speedLabel.Text = "Speed: 16"
speedLabel.Parent = frame

-------------------------------------------------------------------------------
-- 2. Bind to leaderstats
-------------------------------------------------------------------------------

local function updateSpeed()
	local character = player.Character
	if character then
		local humanoid = character:FindFirstChildOfClass("Humanoid")
		if humanoid then
			speedLabel.Text = ("Speed: %d"):format(humanoid.WalkSpeed)
		end
	end
end

local function onLeaderstats(stats: Instance)
	local coins = stats:WaitForChild("Coins") :: IntValue
	coinsLabel.Text = ("Coins: %d"):format(coins.Value)
	coins.Changed:Connect(function(value: number)
		coinsLabel.Text = ("Coins: %d"):format(value)
	end)
end

-- Listen for character to show WalkSpeed.
player.CharacterAdded:Connect(function(character: Model)
	local humanoid = character:WaitForChild("Humanoid") :: Humanoid
	speedLabel.Text = ("Speed: %d"):format(humanoid.WalkSpeed)
	humanoid:GetPropertyChangedSignal("WalkSpeed"):Connect(function()
		speedLabel.Text = ("Speed: %d"):format(humanoid.WalkSpeed)
	end)
end)

if player.Character then
	updateSpeed()
	local humanoid = player.Character:FindFirstChildOfClass("Humanoid")
	if humanoid then
		humanoid:GetPropertyChangedSignal("WalkSpeed"):Connect(updateSpeed)
	end
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
