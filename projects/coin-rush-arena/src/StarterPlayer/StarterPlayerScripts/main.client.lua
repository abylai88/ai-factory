-- Coin Rush Arena: client entry point.
-- LocalScripts under StarterPlayer/StarterPlayerScripts run on each client.
-- They render state and send requests; the server owns authoritative state.

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local CoinMath = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinMath"))
local UpgradeConfig = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("UpgradeConfig"))

local player = Players.LocalPlayer

print(("[CoinRushArena] Client online for %s"):format(player.Name))

-------------------------------------------------------------------------------
-- 1. Wait for remotes (created by server)
-------------------------------------------------------------------------------

local remotes = ReplicatedStorage:WaitForChild("Remotes")
local requestUpgrade = remotes:WaitForChild(RemoteNames.RequestUpgrade)
local joinArena = remotes:WaitForChild(RemoteNames.JoinArena)
local leaveQueue = remotes:WaitForChild(RemoteNames.LeaveQueue)
local arenaState = remotes:WaitForChild(RemoteNames.ArenaState)
local arenaScore = remotes:WaitForChild(RemoteNames.ArenaScore)
local arenaResults = remotes:WaitForChild(RemoteNames.ArenaResults)

-------------------------------------------------------------------------------
-- 2. Create upgrade panel UI
-------------------------------------------------------------------------------

local screenGui = Instance.new("ScreenGui")
screenGui.Name = "UpgradeGui"
screenGui.ResetOnSpawn = false
screenGui.Parent = player:WaitForChild("PlayerGui")

-- Upgrade panel frame (bottom-right)
local panelFrame = Instance.new("Frame")
panelFrame.Name = "UpgradePanel"
panelFrame.Size = UDim2.new(0, 220, 0, 280)
panelFrame.Position = UDim2.new(1, -240, 1, -300)
panelFrame.BackgroundColor3 = Color3.fromRGB(20, 20, 30)
panelFrame.BackgroundTransparency = 0.2
panelFrame.BorderSizePixel = 0
panelFrame.Parent = screenGui

local panelCorner = Instance.new("UICorner")
panelCorner.CornerRadius = UDim.new(0, 10)
panelCorner.Parent = panelFrame

local panelStroke = Instance.new("UIStroke")
panelStroke.Color = Color3.fromRGB(100, 100, 120)
panelStroke.Thickness = 1
panelStroke.Parent = panelFrame

-- Panel title
local panelTitle = Instance.new("TextLabel")
panelTitle.Name = "PanelTitle"
panelTitle.Size = UDim2.new(1, 0, 0, 30)
panelTitle.Position = UDim2.new(0, 0, 0, 0)
panelTitle.BackgroundTransparency = 1
panelTitle.TextColor3 = Color3.fromRGB(255, 255, 255)
panelTitle.Font = Enum.Font.GothamBold
panelTitle.TextSize = 16
panelTitle.Text = "UPGRADES"
panelTitle.Parent = panelFrame

-- Create upgrade buttons
local upgradeTypes = { "Speed", "Magnet", "Power", "Multiplier" }
local upgradeButtons = {}

for i, upgradeType in ipairs(upgradeTypes) do
	local info = UpgradeConfig[upgradeType]
	if info then
		local btn = Instance.new("TextButton")
		btn.Name = upgradeType .. "Button"
		btn.Size = UDim2.new(1, -20, 0, 48)
		btn.Position = UDim2.new(0, 10, 0, 35 + (i - 1) * 58)
		btn.BackgroundColor3 = Color3.fromRGB(50, 150, 50)
		btn.TextColor3 = Color3.fromRGB(255, 255, 255)
		btn.Font = Enum.Font.GothamBold
		btn.TextSize = 14
		btn.Text = info.DisplayName
		btn.Parent = panelFrame

		local btnCorner = Instance.new("UICorner")
		btnCorner.CornerRadius = UDim.new(0, 6)
		btnCorner.Parent = btn

		-- Cost label inside button
		local costLabel = Instance.new("TextLabel")
		costLabel.Name = "CostLabel"
		costLabel.Size = UDim2.new(1, 0, 0, 16)
		costLabel.Position = UDim2.new(0, 0, 1, -18)
		costLabel.BackgroundTransparency = 1
		costLabel.TextColor3 = Color3.fromRGB(200, 200, 200)
		costLabel.Font = Enum.Font.Gotham
		costLabel.TextSize = 11
		costLabel.Text = ""
		costLabel.Parent = btn

		upgradeButtons[upgradeType] = { button = btn, costLabel = costLabel }
	end
end

-------------------------------------------------------------------------------
-- 3. Create arena join button (bottom-center)
-------------------------------------------------------------------------------

local arenaButton = Instance.new("TextButton")
arenaButton.Name = "ArenaButton"
arenaButton.Size = UDim2.new(0, 200, 0, 50)
arenaButton.Position = UDim2.new(0.5, -100, 1, -70)
arenaButton.BackgroundColor3 = Color3.fromRGB(200, 100, 30)
arenaButton.TextColor3 = Color3.fromRGB(255, 255, 255)
arenaButton.Font = Enum.Font.GothamBold
arenaButton.TextSize = 18
arenaButton.Text = "Enter Arena"
arenaButton.Parent = screenGui

local arenaCorner = Instance.new("UICorner")
arenaCorner.CornerRadius = UDim.new(0, 8)
arenaCorner.Parent = arenaButton

-- Arena status label
local arenaStatus = Instance.new("TextLabel")
arenaStatus.Name = "ArenaStatus"
arenaStatus.Size = UDim2.new(0, 200, 0, 20)
arenaStatus.Position = UDim2.new(0.5, -100, 1, -20)
arenaStatus.BackgroundTransparency = 1
arenaStatus.TextColor3 = Color3.fromRGB(200, 200, 200)
arenaStatus.Font = Enum.Font.Gotham
arenaStatus.TextSize = 12
arenaStatus.Text = ""
arenaStatus.Parent = screenGui

-------------------------------------------------------------------------------
-- 4. Wire upgrade buttons
-------------------------------------------------------------------------------

local function getUpgradeCost(typeName: string, level: number): number
	local info = UpgradeConfig[typeName]
	if info then
		return CoinMath.upgradeCost(info.BaseCost, level, info.GrowthRate)
	end
	return 0
end

local function getUpgradeMaxLevel(typeName: string): number
	local info = UpgradeConfig[typeName]
	if info then
		return info.MaxLevel
	end
	return 0
end

local function updateUpgradeButtons()
	local leaderstats = player:FindFirstChild("leaderstats")
	if not leaderstats then return end

	local coinsVal = leaderstats:FindFirstChild("Coins")
	if not coinsVal then return end
	local currentCoins = coinsVal.Value

	for upgradeType, btnData in pairs(upgradeButtons) do
		local btn = btnData.button
		local costLabel = btnData.costLabel

		-- Get current level from a dedicated IntValue or default to 0
		local levelVal = leaderstats:FindFirstChild(upgradeType .. "Level")
		local level = levelVal and levelVal.Value or 0

		local cost = getUpgradeCost(upgradeType, level)
		local maxed = level >= getUpgradeMaxLevel(upgradeType)
		local canAfford = currentCoins >= cost

		if maxed then
			btn.BackgroundColor3 = Color3.fromRGB(80, 80, 80)
			btn.Text = UpgradeConfig[upgradeType].DisplayName .. " [MAX]"
			costLabel.Text = ""
		elseif canAfford then
			btn.BackgroundColor3 = Color3.fromRGB(50, 150, 50)
			btn.Text = UpgradeConfig[upgradeType].DisplayName
			costLabel.Text = ("Cost: %d"):format(cost)
		else
			btn.BackgroundColor3 = Color3.fromRGB(150, 50, 50)
			btn.Text = UpgradeConfig[upgradeType].DisplayName
			costLabel.Text = ("Cost: %d"):format(cost)
		end
	end
end

for upgradeType, btnData in pairs(upgradeButtons) do
	btnData.button.Activated:Connect(function()
		requestUpgrade:FireServer(upgradeType)
	end)
end

-------------------------------------------------------------------------------
-- 5. Wire arena button
-------------------------------------------------------------------------------

local inArena = false

arenaButton.Activated:Connect(function()
	if inArena then
		leaveQueue:FireServer()
		arenaButton.Text = "Enter Arena"
		arenaStatus.Text = ""
		inArena = false
	else
		joinArena:FireServer("CoinKing")
		arenaButton.Text = "Leave Queue"
		arenaStatus.Text = "Searching for match..."
		inArena = true
	end
end)

-- Arena state updates from server
arenaState.OnClientEvent:Connect(function(data: { [string]: any })
	if data.state == "Queue" then
		arenaStatus.Text = ("Players: %d/%d"):format(data.playerCount, data.maxPlayers)
	elseif data.state == "Countdown" then
		arenaStatus.Text = ("Starting in %d..."):format(data.duration)
	elseif data.state == "Active" then
		arenaButton.Text = "In Arena"
		arenaStatus.Text = "Collect coins! Duration: " .. data.duration .. "s"
	elseif data.state == "Results" then
		arenaButton.Text = "Return to Farm"
		arenaStatus.Text = "Round Over!"
	elseif data.state == "ReturnToWorld" then
		inArena = false
		arenaButton.Text = "Enter Arena"
		arenaStatus.Text = ""
	end
end)

-- Arena score updates
arenaScore.OnClientEvent:Connect(function(scores: { [string]: any })
	-- Could update a scoreboard UI here
end)

-- Arena results
arenaResults.OnClientEvent:Connect(function(results: { any })
	-- Display results (could create a modal)
	for _, entry in ipairs(results) do
		if entry.userId == player.UserId then
			arenaStatus.Text = ("Placement: #%d | Coins: %d | Bonus: %d"):format(
				entry.placement, entry.coins, entry.bonus
			)
			break
		end
	end
end)

-------------------------------------------------------------------------------
-- 6. Bind to leaderstats for updates
-------------------------------------------------------------------------------

local function bindLeaderstats(leaderstats: Instance)
	local coinsVal = leaderstats:WaitForChild("Coins") :: IntValue

	updateUpgradeButtons()

	coinsVal.Changed:Connect(function()
		updateUpgradeButtons()
	end)

	-- Watch for upgrade level changes
	for _, child in ipairs(leaderstats:GetChildren()) do
		if child:IsA("IntValue") and child.Name:match("Level$") then
			child.Changed:Connect(function()
				updateUpgradeButtons()
			end)
		end
	end
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
