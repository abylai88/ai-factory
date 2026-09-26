-- Coin Rush Arena: Open World Map Configuration.
-- Defines map layout, spawn zones, portals, decorations, and landmarks.
-- Server uses this for procedural generation; client uses for minimap/waypoints.

local MapConfig = {}

-------------------------------------------------------------------------------
-- MAP METADATA
-------------------------------------------------------------------------------

MapConfig.Metadata = {
	Name = "CoinRush_MainMap",
	DisplayName = "Coin Fields",
	Description = "The main farming area. Collect coins, upgrade, then enter the arena!",
	Version = 1,
	Author = "AI Factory",
	Size = Vector2.new(80, 80), -- studs (X, Z)
	Height = 100, -- max build height
	GroundY = 0, -- ground level Y coordinate
	SkyboxId = "rbxassetid://0", -- placeholder
	MusicTrack = "FarmingAmbient", -- from SoundConfig
	AmbientLighting = {
		OutdoorAmbient = Color3.fromRGB(180, 200, 160),
		Ambient = Color3.fromRGB(120, 140, 120),
		Brightness = 2,
		ClockTime = 14, -- 2 PM
		GeographicLatitude = 45,
	},
}

-------------------------------------------------------------------------------
-- SPAWN ZONES
-- Defines where coins can spawn. Multiple zones with different properties.
-------------------------------------------------------------------------------

MapConfig.SpawnZones = {
	-- Central zone: high traffic, all coin types
	{
		Id = "zone_center",
		Name = "Central Plaza",
		Center = Vector3.new(0, 3, 0),
		Size = Vector3.new(30, 10, 30),
		Weight = 40, -- 40% of spawns
		AllowedCoinTypes = { "Bronze", "Silver", "Gold", "Meteor" },
		CoinDensity = 1.0, -- normal density
		Description = "Heart of the fields. All coin types spawn here.",
	},

	-- North zone: slightly more silver/gold
	{
		Id = "zone_north",
		Name = "Northern Hills",
		Center = Vector3.new(0, 3, -25),
		Size = Vector3.new(25, 10, 20),
		Weight = 20,
		AllowedCoinTypes = { "Bronze", "Silver", "Gold" },
		CoinDensity = 0.9,
		Description = "Gentle hills with richer deposits.",
	},

	-- South zone: more bronze, good for beginners
	{
		Id = "zone_south",
		Name = "Southern Plains",
		Center = Vector3.new(0, 3, 25),
		Size = Vector3.new(30, 10, 25),
		Weight = 20,
		AllowedCoinTypes = { "Bronze", "Silver" },
		CoinDensity = 1.2,
		Description = "Wide open plains. Great for starting farmers.",
	},

	-- East zone: balanced
	{
		Id = "zone_east",
		Name = "Eastern Ridge",
		Center = Vector3.new(25, 3, 0),
		Size = Vector3.new(20, 10, 30),
		Weight = 10,
		AllowedCoinTypes = { "Bronze", "Silver", "Gold", "Meteor" },
		CoinDensity = 0.8,
		Description = "Rocky ridge with rare meteor strikes.",
	},

	-- West zone: balanced
	{
		Id = "zone_west",
		Name = "Western Valley",
		Center = Vector3.new(-25, 3, 0),
		Size = Vector3.new(20, 10, 30),
		Weight = 10,
		AllowedCoinTypes = { "Bronze", "Silver", "Gold", "Meteor" },
		CoinDensity = 0.8,
		Description = "Peaceful valley with hidden treasures.",
	},
}

-- Total weight should equal 100 for percentage-based spawning
MapConfig.TotalSpawnWeight = 100

-------------------------------------------------------------------------------
-- PORTALS
-- Teleportation points to arena modes and other maps.
-------------------------------------------------------------------------------

MapConfig.Portals = {
	{
		Id = "portal_coin_king",
		Name = "Coin King Arena",
		DisplayName = "COIN KING",
		Description = "Enter the 3-minute free-for-all!",
		Position = Vector3.new(0, 0, -35),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Size = Vector3.new(6, 10, 2),
		Color = Color3.fromRGB(255, 215, 0),
		ParticleColor = Color3.fromRGB(255, 215, 0),
		TargetMode = "CoinKing",
		MinLevel = 2,
		Enabled = true,
		Cooldown = 1, -- seconds between uses
	},

	{
		Id = "portal_speed_blitz",
		Name = "Speed Blitz Arena",
		DisplayName = "SPEED BLITZ",
		Description = "Team up 4v4 for coin glory!",
		Position = Vector3.new(30, 0, -35),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Size = Vector3.new(6, 10, 2),
		Color = Color3.fromRGB(0, 200, 255),
		ParticleColor = Color3.fromRGB(0, 200, 255),
		TargetMode = "SpeedBlitz",
		MinLevel = 10,
		Enabled = true,
		Cooldown = 1,
	},

	{
		Id = "portal_last_standing",
		Name = "Last Coin Standing",
		DisplayName = "LAST STANDING",
		Description = "Survive the coin battle royale!",
		Position = Vector3.new(-30, 0, -35),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Size = Vector3.new(6, 10, 2),
		Color = Color3.fromRGB(255, 69, 0),
		ParticleColor = Color3.fromRGB(255, 69, 0),
		TargetMode = "LastCoinStanding",
		MinLevel = 20,
		Enabled = true,
		Cooldown = 1,
	},
}

-------------------------------------------------------------------------------
-- UPGRADE SHOP LOCATION
-------------------------------------------------------------------------------

MapConfig.UpgradeShop = {
	Id = "upgrade_shop",
	Name = "Upgrade Station",
	Position = Vector3.new(0, 0, 5),
	Rotation = CFrame.Angles(0, 0, 0),
	Size = Vector3.new(10, 8, 6),
	InteractionRadius = 8,
	NPCName = "Shopkeeper Sam",
	NPCDialogue = {
		"Welcome! Want to get faster?",
		"Coins make the world go round!",
		"Speed is power in the arena!",
	},
	Categories = { "Speed", "Magnet", "Power", "Multiplier" },
}

-------------------------------------------------------------------------------
-- LEADERBOARD BOARD
-- In-world physical leaderboard display.
-------------------------------------------------------------------------------

MapConfig.LeaderboardBoard = {
	Id = "leaderboard_main",
	Name = "Hall of Legends",
	Position = Vector3.new(0, 2, 20),
	Rotation = CFrame.Angles(0, math.rad(180), 0),
	Size = Vector3.new(12, 16, 1),
	Categories = {
		{ Key = "TotalCoins", DisplayName = "Total Coins", MaxEntries = 10 },
		{ Key = "ArenaWins", DisplayName = "Arena Wins", MaxEntries = 10 },
		{ Key = "ArenaRating", DisplayName = "Rating", MaxEntries = 10 },
		{ Key = "WeeklyCoins", DisplayName = "This Week", MaxEntries = 10 },
	},
	RefreshInterval = 60, -- seconds
	ShowPlayerRank = true,
}

-------------------------------------------------------------------------------
-- DECORATIONS & LANDMARKS
-- Visual variety for the map. Server can use these positions for placement.
-------------------------------------------------------------------------------

MapConfig.Decorations = {
	-- Trees
	{
		Type = "Tree",
		ModelId = "rbxassetid://0", -- placeholder
		Positions = {
			Vector3.new(-30, 0, -30), Vector3.new(-20, 0, -35), Vector3.new(-10, 0, -30),
			Vector3.new(30, 0, -30), Vector3.new(20, 0, -35), Vector3.new(10, 0, -30),
			Vector3.new(-30, 0, 30), Vector3.new(-20, 0, 35), Vector3.new(-10, 0, 30),
			Vector3.new(30, 0, 30), Vector3.new(20, 0, 35), Vector3.new(10, 0, 30),
			Vector3.new(-35, 0, -10), Vector3.new(-35, 0, 0), Vector3.new(-35, 0, 10),
			Vector3.new(35, 0, -10), Vector3.new(35, 0, 0), Vector3.new(35, 0, 10),
		},
		ScaleRange = { 0.8, 1.2 },
		RotationRange = { 0, 360 },
		ColorVariation = {
			Color3.fromRGB(34, 139, 34),
			Color3.fromRGB(46, 125, 50),
			Color3.fromRGB(27, 94, 32),
		},
	},

	-- Rocks
	{
		Type = "Rock",
		ModelId = "rbxassetid://0",
		Positions = {
			Vector3.new(-25, 0, -20), Vector3.new(25, 0, -20),
			Vector3.new(-25, 0, 20), Vector3.new(25, 0, 20),
			Vector3.new(-15, 0, -15), Vector3.new(15, 0, 15),
			Vector3.new(-5, 0, -5), Vector3.new(5, 0, 5),
		},
		ScaleRange = { 1.5, 3.0 },
		RotationRange = { 0, 360 },
		ColorVariation = {
			Color3.fromRGB(100, 100, 100),
			Color3.fromRGB(120, 110, 100),
			Color3.fromRGB(80, 80, 80),
		},
	},

	-- Bushes
	{
		Type = "Bush",
		ModelId = "rbxassetid://0",
		Positions = {
			Vector3.new(-28, 0, -25), Vector3.new(-18, 0, -28), Vector3.new(-8, 0, -25),
			Vector3.new(28, 0, -25), Vector3.new(18, 0, -28), Vector3.new(8, 0, -25),
			Vector3.new(-28, 0, 25), Vector3.new(-18, 0, 28), Vector3.new(-8, 0, 25),
			Vector3.new(28, 0, 25), Vector3.new(18, 0, 28), Vector3.new(8, 0, 25),
		},
		ScaleRange = { 0.6, 1.0 },
		RotationRange = { 0, 360 },
		ColorVariation = {
			Color3.fromRGB(60, 120, 60),
			Color3.fromRGB(50, 100, 50),
		},
	},

	-- Path markers (visual guides for farming routes)
	{
		Type = "PathMarker",
		ModelId = "rbxassetid://0",
		Positions = {
			Vector3.new(0, 0.1, -15), Vector3.new(0, 0.1, -10), Vector3.new(0, 0.1, -5),
			Vector3.new(0, 0.1, 5), Vector3.new(0, 0.1, 10), Vector3.new(0, 0.1, 15),
			Vector3.new(-15, 0.1, 0), Vector3.new(-10, 0.1, 0), Vector3.new(-5, 0.1, 0),
			Vector3.new(5, 0.1, 0), Vector3.new(10, 0.1, 0), Vector3.new(15, 0.1, 0),
		},
		ScaleRange = { 1, 1 },
		RotationRange = { 0, 0 },
		ColorVariation = { Color3.fromRGB(200, 180, 140) },
	},
}

-------------------------------------------------------------------------------
-- SPAWN POINTS
-- Player spawn locations (for initial join and respawn).
-------------------------------------------------------------------------------

MapConfig.SpawnPoints = {
	{
		Id = "spawn_main",
		Name = "Main Spawn",
		Position = Vector3.new(0, 5, 10),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Priority = 1, -- primary spawn
		TeamNeutral = true,
	},

	{
		Id = "spawn_alt_1",
		Name = "Alt Spawn North",
		Position = Vector3.new(-5, 5, 5),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Priority = 2,
		TeamNeutral = true,
	},

	{
		Id = "spawn_alt_2",
		Name = "Alt Spawn South",
		Position = Vector3.new(5, 5, 5),
		Rotation = CFrame.Angles(0, math.rad(180), 0),
		Priority = 2,
		TeamNeutral = true,
	},
}

-------------------------------------------------------------------------------
-- SPECIAL AREAS
-- Areas with special effects or rules.
-------------------------------------------------------------------------------

MapConfig.SpecialAreas = {
	{
		Id = "speed_boost_zone",
		Name = "Speed Boost Pad",
		Position = Vector3.new(0, 0.5, 0),
		Size = Vector3.new(8, 1, 8),
		Effect = "SpeedBoost",
		EffectValue = 1.5, -- 1.5x speed for 3 seconds
		Cooldown = 10,
		Visual = {
			Color = Color3.fromRGB(0, 255, 150),
			Particle = "SpeedRing",
			Sound = "SpeedPadActivate",
		},
	},

	{
		Id = "magnet_boost_zone",
		Name = "Magnetic Field",
		Position = Vector3.new(-20, 0.5, -20),
		Size = Vector3.new(6, 1, 6),
		Effect = "MagnetBoost",
		EffectValue = 2.0, -- 2x magnet radius for 5 seconds
		Cooldown = 15,
		Visual = {
			Color = Color3.fromRGB(100, 200, 255),
			Particle = "MagneticField",
			Sound = "MagnetPadActivate",
		},
	},

	{
		Id = "coin_frenzy_zone",
		Name = "Coin Frenzy",
		Position = Vector3.new(20, 0.5, 20),
		Size = Vector3.new(10, 1, 10),
		Effect = "CoinSpawnRate",
		EffectValue = 3.0, -- 3x coin spawn rate for 10 seconds
		Cooldown = 60,
		Visual = {
			Color = Color3.fromRGB(255, 215, 0),
			Particle = "GoldSparkles",
			Sound = "FrenzyActivate",
		},
	},
}

-------------------------------------------------------------------------------
-- MAP BOUNDARIES
-- Invisible walls to keep players in bounds.
-------------------------------------------------------------------------------

MapConfig.Boundaries = {
	{
		Id = "boundary_north",
		Position = Vector3.new(0, 25, -40),
		Size = Vector3.new(80, 50, 1),
		Transparency = 1,
		CanCollide = true,
	},

	{
		Id = "boundary_south",
		Position = Vector3.new(0, 25, 40),
		Size = Vector3.new(80, 50, 1),
		Transparency = 1,
		CanCollide = true,
	},

	{
		Id = "boundary_east",
		Position = Vector3.new(40, 25, 0),
		Size = Vector3.new(1, 50, 80),
		Transparency = 1,
		CanCollide = true,
	},

	{
		Id = "boundary_west",
		Position = Vector3.new(-40, 25, 0),
		Size = Vector3.new(1, 50, 80),
		Transparency = 1,
		CanCollide = true,
	},
}

-------------------------------------------------------------------------------
-- MINIMAP CONFIGURATION
-------------------------------------------------------------------------------

MapConfig.Minimap = {
	Enabled = true,
	Size = UDim2.new(0, 180, 0, 180),
	Position = UDim2.new(1, -200, 0, 20),
	BackgroundColor = Color3.fromRGB(20, 20, 20),
	BackgroundTransparency = 0.3,
	BorderColor = Color3.fromRGB(255, 215, 0),
	PlayerIconColor = Color3.fromRGB(0, 255, 100),
	PortalIconColor = Color3.fromRGB(255, 215, 0),
	ShopIconColor = Color3.fromRGB(0, 200, 255),
	LeaderboardIconColor = Color3.fromRGB(255, 100, 100),
	CoinZoneColor = Color3.fromRGB(255, 255, 100),
	CoinZoneTransparency = 0.7,
	ShowPlayerNames = false,
	ShowOtherPlayers = true,
	OtherPlayerColor = Color3.fromRGB(100, 200, 255),
	Zoom = 1.0,
	RotationLocked = true,
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get a spawn zone by ID.
function MapConfig.getSpawnZone(zoneId: string): table?
	for _, zone in ipairs(MapConfig.SpawnZones) do
		if zone.Id == zoneId then
			return zone
		end
	end
	return nil
end

--- Get all enabled portals.
function MapConfig.getEnabledPortals(): { table }
	local result = {}
	for _, portal in ipairs(MapConfig.Portals) do
		if portal.Enabled then
			table.insert(result, portal)
		end
	end
	return result
end

--- Get a portal by ID.
function MapConfig.getPortal(portalId: string): table?
	for _, portal in ipairs(MapConfig.Portals) do
		if portal.Id == portalId then
			return portal
		end
	end
	return nil
end

--- Get portals available for a player's level.
function MapConfig.getAvailablePortals(playerLevel: number): { table }
	local result = {}
	for _, portal in ipairs(MapConfig.Portals) do
		if portal.Enabled and (portal.MinLevel or 1) <= playerLevel then
			table.insert(result, portal)
		end
	end
	return result
end

--- Get a random position within a spawn zone.
function MapConfig.getRandomPositionInZone(zoneId: string): Vector3?
	local zone = MapConfig.getSpawnZone(zoneId)
	if not zone then return nil end

	local halfX = zone.Size.X / 2
	local halfZ = zone.Size.Z / 2

	return zone.Center + Vector3.new(
		math.random(-halfX * 100, halfX * 100) / 100,
		0,
		math.random(-halfZ * 100, halfZ * 100) / 100
	)
end

--- Get weighted random spawn zone.
function MapConfig.getWeightedRandomZone(): table
	local roll = math.random(1, MapConfig.TotalSpawnWeight)
	local cumulative = 0

	for _, zone in ipairs(MapConfig.SpawnZones) do
		cumulative += zone.Weight
		if roll <= cumulative then
			return zone
		end
	end

	return MapConfig.SpawnZones[1] -- fallback
end

--- Get spawn point (respects priority).
function MapConfig.getSpawnPoint(): Vector3
	local candidates = {}
	for _, spawn in ipairs(MapConfig.SpawnPoints) do
		if spawn.Priority == 1 then
			table.insert(candidates, spawn)
		end
	end
	if #candidates == 0 then
		candidates = MapConfig.SpawnPoints
	end
	local chosen = candidates[math.random(1, #candidates)]
	return chosen.Position
end

--- Check if a position is within map boundaries.
function MapConfig.isInBounds(position: Vector3): boolean
	local halfSize = MapConfig.Metadata.Size / 2
	return math.abs(position.X) <= halfSize
		and math.abs(position.Z) <= halfSize
		and position.Y >= MapConfig.Metadata.GroundY
		and position.Y <= MapConfig.Metadata.Height
end

--- Get decoration positions for a type.
function MapConfig.getDecorationPositions(decorationType: string): { Vector3 }
	for _, deco in ipairs(MapConfig.Decorations) do
		if deco.Type == decorationType then
			return deco.Positions
		end
	end
	return {}
end

return MapConfig