-- Coin Rush Arena: cosmetic definitions.
-- Pets, trails, effects, crates, and item rarity system.
-- Shared between server (validation) and client (UI/display).

local CosmeticConfig = {}

-------------------------------------------------------------------------------
-- RARITY SYSTEM
-------------------------------------------------------------------------------

CosmeticConfig.Rarities = {
	Common = {
		Name = "Common",
		DisplayName = "Common",
		Color = Color3.fromRGB(180, 180, 180),
		Weight = 55, -- 55% drop rate in basic crates
		GlowEnabled = false,
	},
	Uncommon = {
		Name = "Uncommon",
		DisplayName = "Uncommon",
		Color = Color3.fromRGB(76, 175, 80),
		Weight = 25, -- 25% drop rate
		GlowEnabled = false,
	},
	Rare = {
		Name = "Rare",
		DisplayName = "Rare",
		Color = Color3.fromRGB(33, 150, 243),
		Weight = 13, -- 13% drop rate
		GlowEnabled = true,
	},
	Epic = {
		Name = "Epic",
		DisplayName = "Epic",
		Color = Color3.fromRGB(156, 39, 176),
		Weight = 5, -- 5% drop rate
		GlowEnabled = true,
	},
	Legendary = {
		Name = "Legendary",
		DisplayName = "Legendary",
		Color = Color3.fromRGB(255, 193, 7),
		Weight = 1.5, -- 1.5% drop rate
		GlowEnabled = true,
	},
	Meteor = {
		Name = "Meteor",
		DisplayName = "Meteor",
		Color = Color3.fromRGB(255, 69, 0),
		Weight = 0.5, -- 0.5% drop rate
		GlowEnabled = true,
	},
}

-------------------------------------------------------------------------------
-- COSMETIC TYPES
-------------------------------------------------------------------------------

CosmeticConfig.Types = {
	Pet = "Pet",
	Trail = "Trail",
	Effect = "Effect",
	NameTag = "NameTag",
	Title = "Title",
	CoinSkin = "CoinSkin",
}

-------------------------------------------------------------------------------
-- PET DEFINITIONS
-- Pets follow the player and provide minor visual flair.
-- No gameplay advantage (anti-pay-to-win).
-------------------------------------------------------------------------------

CosmeticConfig.Pets = {
	-- Common Pets
	{
		Id = "pet_coin_basic",
		Name = "Bronze Buddy",
		Type = "Pet",
		Rarity = "Common",
		Description = "A tiny bronze coin that floats beside you.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.5,
		FollowDistance = 2,
		FollowHeight = 1.5,
		SpinSpeed = 90, -- degrees/sec
		GlowColor = Color3.fromRGB(205, 127, 50),
	},
	{
		Id = "pet_mini_bolt",
		Name = "Mini Bolt",
		Type = "Pet",
		Rarity = "Common",
		Description = "A tiny lightning bolt that zips around you.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.4,
		FollowDistance = 1.8,
		FollowHeight = 2,
		SpinSpeed = 120,
		GlowColor = Color3.fromRGB(255, 255, 100),
	},
	{
		Id = "pet_pixel",
		Name = "Pixel",
		Type = "Pet",
		Rarity = "Common",
		Description = "A floating pixel cube. Retro vibes.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.3,
		FollowDistance = 2.2,
		FollowHeight = 1.8,
		SpinSpeed = 60,
		GlowColor = Color3.fromRGB(0, 255, 128),
	},

	-- Uncommon Pets
	{
		Id = "pet_silver_orb",
		Name = "Silver Orb",
		Type = "Pet",
		Rarity = "Uncommon",
		Description = "A shimmering silver orb that trails sparkles.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.5,
		FollowDistance = 2,
		FollowHeight = 2,
		SpinSpeed = 75,
		GlowColor = Color3.fromRGB(192, 192, 192),
		ParticleColor = Color3.fromRGB(200, 200, 255),
	},
	{
		Id = "pet_speed_wisp",
		Name = "Speed Wisp",
		Type = "Pet",
		Rarity = "Uncommon",
		Description = "A wispy blue spirit that trails behind you.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.45,
		FollowDistance = 2.5,
		FollowHeight = 1.5,
		SpinSpeed = 0,
		TrailEnabled = true,
		TrailColor = Color3.fromRGB(100, 200, 255),
	},

	-- Rare Pets
	{
		Id = "pet_gold_cube",
		Name = "Golden Cube",
		Type = "Pet",
		Rarity = "Rare",
		Description = "A spinning golden cube with inner glow.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.55,
		FollowDistance = 2.2,
		FollowHeight = 2,
		SpinSpeed = 150,
		GlowColor = Color3.fromRGB(255, 215, 0),
		ParticleColor = Color3.fromRGB(255, 230, 100),
	},
	{
		Id = "pet_flame_spirit",
		Name = "Flame Spirit",
		Type = "Pet",
		Rarity = "Rare",
		Description = "A small fire elemental that flickers with life.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.5,
		FollowDistance = 2,
		FollowHeight = 1.8,
		SpinSpeed = 0,
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 100, 0),
	},

	-- Epic Pets
	{
		Id = "pet_neon_dragon",
		Name = "Neon Dragon",
		Type = "Pet",
		Rarity = "Epic",
		Description = "A miniature dragon that breathes neon fire.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.6,
		FollowDistance = 2.5,
		FollowHeight = 2.5,
		SpinSpeed = 45,
		GlowColor = Color3.fromRGB(255, 0, 255),
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 0, 200),
	},

	-- Legendary Pets
	{
		Id = "pet_meteor_golem",
		Name = "Meteor Golem",
		Type = "Pet",
		Rarity = "Legendary",
		Description = "A living meteorite with burning eyes. The ultimate companion.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.7,
		FollowDistance = 2.5,
		FollowHeight = 2,
		SpinSpeed = 30,
		GlowColor = Color3.fromRGB(255, 69, 0),
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 100, 0),
		FireEnabled = true,
	},

	-- Meteor Pets
	{
		Id = "pet_cosmic_serpent",
		Name = "Cosmic Serpent",
		Type = "Pet",
		Rarity = "Meteor",
		Description = "A celestial serpent from beyond the stars. Ultra-rare.",
		MeshId = "rbxassetid://0",
		TextureId = "rbxassetid://0",
		Scale = 0.8,
		FollowDistance = 3,
		FollowHeight = 3,
		SpinSpeed = 60,
		GlowColor = Color3.fromRGB(100, 0, 255),
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(150, 50, 255),
		TrailEnabled = true,
		TrailColor = Color3.fromRGB(200, 100, 255),
	},
}

-------------------------------------------------------------------------------
-- TRAIL DEFINITIONS
-- Visual trails that follow the player's movement.
-------------------------------------------------------------------------------

CosmeticConfig.Trails = {
	-- Common
	{
		Id = "trail_dust",
		Name = "Dust Trail",
		Type = "Trail",
		Rarity = "Common",
		Description = "A subtle dust trail behind your feet.",
		Color = Color3.fromRGB(180, 160, 120),
		Width = 0.5,
		LengthScale = 1,
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0),
			NumberSequenceKeypoint.new(1, 1),
		}),
	},

	-- Uncommon
	{
		Id = "trail_blue_streak",
		Name = "Blue Streak",
		Type = "Trail",
		Rarity = "Uncommon",
		Description = "A vivid blue energy trail.",
		Color = Color3.fromRGB(50, 150, 255),
		Width = 0.8,
		LengthScale = 1.5,
		Transparency = NumberSequence.new({
			NumberSequenceKeypoint.new(0, 0.2),
			NumberSequenceKeypoint.new(1, 1),
		}),
	},

	-- Rare
	{
		Id = "trail_golden_path",
		Name = "Golden Path",
		Type = "Trail",
		Rarity = "Rare",
		Description = "A sparkling golden trail of coins.",
		Color = Color3.fromRGB(255, 215, 0),
		Width = 1.0,
		LengthScale = 2,
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 230, 100),
	},

	-- Epic
	{
		Id = "trail_flame",
	 Name = "Flame Trail",
		Type = "Trail",
		Rarity = "Epic",
		Description = "A blazing fire trail that lights up the ground.",
		Color = Color3.fromRGB(255, 100, 0),
		Width = 1.2,
		LengthScale = 2.5,
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 150, 0),
	},

	-- Legendary
	{
		Id = "trail_meteor_shower",
		Name = "Meteor Shower",
		Type = "Trail",
		Rarity = "Legendary",
		Description = "A trail of falling meteors and cosmic dust.",
		Color = Color3.fromRGB(255, 69, 0),
		Width = 1.5,
		LengthScale = 3,
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(255, 120, 0),
	},

	-- Meteor
	{
		Id = "trail_cosmic_rift",
		Name = "Cosmic Rift",
		Type = "Trail",
		Rarity = "Meteor",
		Description = "Tears a rift in spacetime wherever you walk.",
		Color = Color3.fromRGB(150, 0, 255),
		Width = 2.0,
		LengthScale = 3,
		ParticleEnabled = true,
		ParticleColor = Color3.fromRGB(200, 50, 255),
	},
}

-------------------------------------------------------------------------------
-- EFFECT DEFINITIONS
-- Visual effects applied to the player character.
-------------------------------------------------------------------------------

CosmeticConfig.Effects = {
	-- Common
	{
		Id = "effect_sparkle",
		Name = "Sparkle",
		Type = "Effect",
		Rarity = "Common",
		Description = "Subtle sparkles around your character.",
		ParticleColor = Color3.fromRGB(255, 255, 200),
		Rate = 5,
		Lifetime = 0.5,
		Speed = 2,
	},

	-- Uncommon
	{
		Id = "effect_aura_blue",
		Name = "Blue Aura",
		Type = "Effect",
		Rarity = "Uncommon",
		Description = "A soft blue aura surrounds you.",
		ParticleColor = Color3.fromRGB(50, 150, 255),
		Rate = 8,
		Lifetime = 0.8,
		Speed = 0,
		SpreadAngle = 180,
	},

	-- Rare
	{
		Id = "effect_coin_rain",
		Name = "Coin Rain",
		Type = "Effect",
		Rarity = "Rare",
		Description = "Mini coins rain down around you.",
		ParticleColor = Color3.fromRGB(255, 215, 0),
		Rate = 12,
		Lifetime = 1.2,
		Speed = 3,
		SpreadAngle = 360,
	},

	-- Epic
	{
		Id = "effect_flame_aura",
		Name = "Flame Aura",
		Type = "Effect",
		Rarity = "Epic",
		Description = "You're surrounded by swirling flames.",
		ParticleColor = Color3.fromRGB(255, 80, 0),
		Rate = 15,
		Lifetime = 0.6,
		Speed = 5,
		SpreadAngle = 360,
	},

	-- Legendary
	{
		Id = "effect_meteor_swarm",
		Name = "Meteor Swarm",
		Type = "Effect",
		Rarity = "Legendary",
		Description = "Tiny meteors orbit around you.",
		ParticleColor = Color3.fromRGB(255, 69, 0),
		Rate = 20,
		Lifetime = 1.0,
		Speed = 4,
		SpreadAngle = 360,
	},
}

-------------------------------------------------------------------------------
-- CRATE DEFINITIONS
-- Loot boxes that drop random cosmetics.
-------------------------------------------------------------------------------

CosmeticConfig.Crates = {
	{
		Id = "crate_basic",
		Name = "Basic Crate",
		Rarity = "Common",
		Description = "Contains Common or Uncommon cosmetics.",
		Price = 49, -- Robux
		CoinPrice = 500, -- coins
		PossibleRarities = { "Common", "Uncommon" },
		Icon = "rbxassetid://0",
	},
	{
		Id = "crate_premium",
		Name = "Premium Crate",
		Rarity = "Rare",
		Description = "Contains Rare or Epic cosmetics.",
		Price = 99,
		CoinPrice = 1500,
		PossibleRarities = { "Rare", "Epic" },
		Icon = "rbxassetid://0",
	},
	{
		Id = "crate_legendary",
		Name = "Legendary Crate",
		Rarity = "Epic",
		Description = "Guaranteed Epic or Legendary cosmetic!",
		Price = 249,
		CoinPrice = 4000,
		PossibleRarities = { "Epic", "Legendary" },
		Icon = "rbxassetid://0",
	},
	{
		Id = "crate_meteor",
		Name = "Meteor Crate",
		Rarity = "Legendary",
		Description = "Guaranteed Legendary or Meteor cosmetic!",
		Price = 499,
		CoinPrice = 8000,
		PossibleRarities = { "Legendary", "Meteor" },
		Icon = "rbxassetid://0",
	},
}

-------------------------------------------------------------------------------
-- CRATE DROP TABLES
-- Per-rarity drop weights within each crate type.
-------------------------------------------------------------------------------

CosmeticConfig.CrateDropWeights = {
	Basic = {
		Common = 65,
		Uncommon = 35,
	},
	Premium = {
		Rare = 60,
		Epic = 40,
	},
	Legendary = {
		Epic = 55,
		Legendary = 45,
	},
	Meteor = {
		Legendary = 70,
		Meteor = 30,
	},
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get all cosmetics of a specific type.
function CosmeticsByType(cosmeticType: string): { table }
	local result = {}
	local allCosmetics = {}
	-- Merge all cosmetic lists
	for _, pet in ipairs(CosmeticConfig.Pets) do
		table.insert(allCosmetics, pet)
	end
	for _, trail in ipairs(CosmeticConfig.Trails) do
		table.insert(allCosmetics, trail)
	end
	for _, effect in ipairs(CosmeticConfig.Effects) do
		table.insert(allCosmetics, effect)
	end
	for _, item in ipairs(allCosmetics) do
		if item.Type == cosmeticType then
			table.insert(result, item)
		end
	end
	return result
end

--- Get a cosmetic by its unique ID.
function CosmeticConfig.getById(id: string): table?
	local allCosmetics = {}
	for _, pet in ipairs(CosmeticConfig.Pets) do
		table.insert(allCosmetics, pet)
	end
	for _, trail in ipairs(CosmeticConfig.Trails) do
		table.insert(allCosmetics, trail)
	end
	for _, effect in ipairs(CosmeticConfig.Effects) do
		table.insert(allCosmetics, effect)
	end
	for _, item in ipairs(allCosmetics) do
		if item.Id == id then
			return item
		end
	end
	return nil
end

--- Get all cosmetics of a specific rarity.
function CosmeticConfig.getByRarity(rarity: string): { table }
	local result = {}
	local allCosmetics = {}
	for _, pet in ipairs(CosmeticConfig.Pets) do
		table.insert(allCosmetics, pet)
	end
	for _, trail in ipairs(CosmeticConfig.Trails) do
		table.insert(allCosmetics, trail)
	end
	for _, effect in ipairs(CosmeticConfig.Effects) do
		table.insert(allCosmetics, effect)
	end
	for _, item in ipairs(allCosmetics) do
		if item.Rarity == rarity then
			table.insert(result, item)
		end
	end
	return result
end

--- Get a random cosmetic from a crate based on drop weights.
function CosmeticConfig.rollCrate(crateId: string): table?
	local crate = nil
	for _, c in ipairs(CosmeticConfig.Crates) do
		if c.Id == crateId then
			crate = c
			break
		end
	end
	if not crate then return nil end

	-- Determine rarity
	local dropWeights = CosmeticConfig.CrateDropWeights[crate.Rarity] or CosmeticConfig.CrateDropWeights.Basic
	local totalWeight = 0
	for _, weight in pairs(dropWeights) do
		totalWeight += weight
	end

	local roll = math.random() * totalWeight
	local cumulative = 0
	local selectedRarity = nil
	for rarity, weight in pairs(dropWeights) do
		cumulative += weight
		if roll <= cumulative then
			selectedRarity = rarity
			break
		end
	end
	selectedRarity = selectedRarity or "Common"

	-- Get random cosmetic from that rarity
	local rarityItems = CosmeticConfig.getByRarity(selectedRarity)
	if #rarityItems == 0 then return nil end
	return rarityItems[math.random(1, #rarityItems)]
end

--- Count total cosmetics available.
function CosmeticConfig.getTotalCount(): number
	return #CosmeticConfig.Pets + #CosmeticConfig.Trails + #CosmeticConfig.Effects
end

return CosmeticConfig
