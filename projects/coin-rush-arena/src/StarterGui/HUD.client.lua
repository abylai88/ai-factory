-- Coin Rush Arena: main HUD display.
-- LocalScript in StarterGui. Reads leaderstats for display only; purchases
-- and upgrades go through server-validated remotes.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local CoinMath = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinMath"))

local player = Players.LocalPlayer

-------------------------------------------------------------------------------
-- 1. Create HUD ScreenGui
-------------------------------------------------------------------------------

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "CoinRushHUD"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

-- Stats frame (top-left corner)
local frame = Instance.new("Frame")
frame.Name = "StatsFrame"
frame.Size = UDim2.new(0, 260, 0, 120)
frame.Position = UDim2.new(0, 10, 0, 10)
frame.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
frame.BackgroundTransparency = 0.2
frame.BorderSizePixel = 0
frame.Parent = screenGui

local corner = Instance.new("UICorner")
corner.CornerRadius = UDim.new(0, 10)
corner.Parent = frame

local stroke = Instance.new("UIStroke")
stroke.Color = Color3.fromRGB(255, 215, 0)
stroke.Thickness = 2
stroke.Transparency = 0.5
stroke.Parent = frame

-- Coin icon + counter
local coinIcon = Instance.new("TextLabel")
coinIcon.Name = "CoinIcon"
coinIcon.Size = UDim2.new(0, 30, 0, 30)
coinIcon.Position = UDim2.new(0, 10, 0, 10)
coinIcon.BackgroundTransparency = 1
coinIcon.TextColor3 = Color3.fromRGB(255, 215, 0)
coinIcon.Font = Enum.Font.GothamBold
coinIcon.TextSize = 24
coinIcon.Text = "$"
coinIcon.Parent = frame

local coinsLabel = Instance.new("TextLabel")
coinsLabel.Name = "CoinsLabel"
coinsLabel.Size = UDim2.new(1, -50, 0, 30)
coinsLabel.Position = UDim2.new(0, 40, 0, 10)
coinsLabel.BackgroundTransparency = 1
coinsLabel.TextColor3 = Color3.fromRGB(255, 215, 0)
coinsLabel.Font = Enum.Font.GothamBold
coinsLabel.TextSize = 20
coinsLabel.TextXAlignment = Enum.TextXAlignment.Left
coinsLabel.Text = "0"
coinsLabel.Parent = frame

-- Speed display
local speedIcon = Instance.new("TextLabel")
speedIcon.Name = "SpeedIcon"
speedIcon.Size = UDim2.new(0, 30, 0, 24)
speedIcon.Position = UDim2.new(0, 10, 0, 48)
speedIcon.BackgroundTransparency = 1
speedIcon.TextColor3 = Color3.fromRGB(100, 200, 255)
speedIcon.Font = Enum.Font.GothamBold
speedIcon.TextSize = 18
speedIcon.Text = ">>"
speedIcon.Parent = frame

local speedLabel = Instance.new("TextLabel")
speedLabel.Name = "SpeedLabel"
speedLabel.Size = UDim2.new(1, -50, 0, 24)
speedLabel.Position = UDim2.new(0, 40, 0, 48)
speedLabel.BackgroundTransparency = 1
speedLabel.TextColor3 = Color3.fromRGB(100, 200, 255)
speedLabel.Font = Enum.Font.GothamBold
speedLabel.TextSize = 16
speedLabel.TextXAlignment = Enum.TextXAlignment.Left
speedLabel.Text = "Speed: Lv.0"
speedLabel.Parent = frame

-- Arena wins display
local winsLabel = Instance.new("TextLabel")
winsLabel.Name = "WinsLabel"
winsLabel.Size = UDim2.new(1, -20, 0, 20)
winsLabel.Position = UDim2.new(0, 10, 0, 78)
winsLabel.BackgroundTransparency = 1
winsLabel.TextColor3 = Color3.fromRGB(255, 180, 50)
winsLabel.Font = Enum.Font.Gotham
winsLabel.TextSize = 14
winsLabel.TextXAlignment = Enum.TextXAlignment.Left
winsLabel.Text = "Arena Wins: 0"
winsLabel.Parent = frame

-- Version label (bottom)
local versionLabel = Instance.new("TextLabel")
versionLabel.Name = "VersionLabel"
versionLabel.Size = UDim2.new(1, -20, 0, 14)
versionLabel.Position = UDim2.new(0, 10, 0, 100)
versionLabel.BackgroundTransparency = 1
versionLabel.TextColor3 = Color3.fromRGB(120, 120, 120)
versionLabel.Font = Enum.Font.Gotham
versionLabel.TextSize = 10
versionLabel.TextXAlignment = Enum.TextXAlignment.Left
versionLabel.Text = "v" .. Config.GAME_VERSION
versionLabel.Parent = frame

-------------------------------------------------------------------------------
-- 2. Floating text system (on CoinCollected)
-------------------------------------------------------------------------------

local function createFloatingText(text: string, color: Color3, size: number)
	local billboard = Instance.new("BillboardGui")
	billboard.Name = "FloatingText"
	billboard.Size = UDim2.new(0, 100, 0, 50)
	billboard.StudsOffset = Vector3.new(0, 3, 0)
	billboard.AlwaysOnTop = true
	billboard.Adornee = nil

	-- Attach to player character
	local character = player.Character
	if character then
		local head = character:FindFirstChild("Head")
		if head then
			billboard.Adornee = head
		end
	end
	if not billboard.Adornee then return end

	billboard.Parent = character

	local label = Instance.new("TextLabel")
	label.Size = UDim2.new(1, 0, 1, 0)
	label.BackgroundTransparency = 1
	label.TextColor3 = color
	label.Font = Enum.Font.GothamBold
	label.TextSize = size
	label.Text = text
	label.Parent = billboard

	-- Animate and destroy
	task.spawn(function()
		local tweenService = game:GetService("TweenService")
		local tween = tweenService:Create(billboard, TweenInfo.new(1.0, Enum.EasingStyle.Quad, Enum.EasingDirection.Out), {
			StudsOffset = Vector3.new(0, 6, 0),
		})
		tween:Play()

		-- Fade out
		task.wait(0.7)
		local fadeTween = tweenService:Create(label, TweenInfo.new(0.3, Enum.EasingStyle.Quad), {
			TextTransparency = 1,
		})
		fadeTween:Play()
		fadeTween.Completed:Wait()
		billboard:Destroy()
	end)
end

-------------------------------------------------------------------------------
-- 3. Wire up remotes
-------------------------------------------------------------------------------

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local coinCollectedRemote = remotes:WaitForChild(RemoteNames.CoinCollected)

coinCollectedRemote.OnClientEvent:Connect(function(coinType: string, value: number)
	-- Show floating text
	local color = Color3.fromRGB(255, 215, 0)
	local size = 18
	if coinType == "Silver" then
		color = Color3.fromRGB(192, 192, 192)
		size = 22
	elseif coinType == "Gold" then
		color = Color3.fromRGB(255, 215, 0)
		size = 28
	elseif coinType == "Meteor" then
		color = Color3.fromRGB(255, 69, 0)
		size = 32
	end

	createFloatingText("+" .. tostring(value), color, size)
end)

-------------------------------------------------------------------------------
-- 4. Bind to leaderstats
-------------------------------------------------------------------------------

local function onLeaderstats(stats: Instance)
	local coins = stats:WaitForChild("Coins") :: IntValue
	local speed = stats:WaitForChild("SpeedLevel") :: IntValue
	local wins = stats:WaitForChild("ArenaWins") :: IntValue

	-- Initial display
	coinsLabel.Text = tostring(coins.Value)
	speedLabel.Text = ("Speed: Lv.%d"):format(speed.Value)
	winsLabel.Text = ("Arena Wins: %d"):format(wins.Value)

	-- Update on change
	coins.Changed:Connect(function(value: number)
		coinsLabel.Text = tostring(value)
	end)
	speed.Changed:Connect(function(value: number)
		speedLabel.Text = ("Speed: Lv.%d"):format(value)
	end)
	wins.Changed:Connect(function(value: number)
		winsLabel.Text = ("Arena Wins: %d"):format(value)
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
