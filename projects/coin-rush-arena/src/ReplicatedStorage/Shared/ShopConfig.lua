-- Coin Rush Arena: Shop configuration.
-- Defines game passes, developer products, and in-game shop items.
-- Server validates purchases; client reads for UI display.

local ShopConfig = {}

-------------------------------------------------------------------------------
-- GAME PASSES (permanent, one-time purchase)
-------------------------------------------------------------------------------

ShopConfig.GamePasses = {
	{
		Id = 0, -- Set to actual Roblox Game Pass ID after creation
		Name = "2xCoins",
		DisplayName = "2x Coins",
		Description = "Double all coin collection rates permanently!",
		Price = 149, -- Robux
		Icon = "rbxassetid://0", -- Placeholder
		Multiplier = 2.0,
		Category = "Boost",
		DisplayOrder = 1,
	},
	{
		Id = 0,
		Name = "VIP",
		DisplayName = "VIP Status",
		Description = "VIP benefits: 1.5x offline coins, 2x daily rewards, exclusive chat tag, and golden name!",
		Price = 399,
		Icon = "rbxassetid://0",
		OfflineMultiplier = 1.5,
		DailyRewardMultiplier = 2.0,
		ChatTag = "[VIP]",
		NameColor = Color3.fromRGB(255, 215, 0),
		Category = "VIP",
		DisplayOrder = 2,
	},
	{
		Id = 0,
		Name = "SpeedBoost",
		DisplayName = "Speed Boost",
		Description = "Permanent +4 WalkSpeed bonus (stacks with upgrade levels).",
		Price = 199,
		Icon = "rbxassetid://0",
		SpeedBonus = 4,
		Category = "Boost",
		DisplayOrder = 3,
	},
	{
		Id = 0,
		Name = "MagnetBoost",
		DisplayName = "Magnet Boost",
		Description = "Permanent +3 stud pickup radius (stacks with upgrade levels).",
		Price = 179,
		Icon = "rbxassetid://0",
		MagnetBonus = 3,
		Category = "Boost",
		DisplayOrder = 4,
	},
	{
		Id = 0,
		Name = "ArenaAccess",
		DisplayName = "Arena Pass",
		Description = "Unlock all arena modes instantly without level requirements.",
		Price = 249,
		Icon = "rbxassetid://0",
		UnlockAllArenaModes = true,
		Category = "Access",
		DisplayOrder = 5,
	},
	{
		Id = 0,
		Name = "AutoCollect",
		DisplayName = "Auto-Collect",
		Description = "Automatically collect coins within 6 studs without walking to them.",
		Price = 149,
		Icon = "rbxassetid://0",
		AutoCollectRadius = 6,
		Category = "Utility",
		DisplayOrder = 6,
	},
}

-------------------------------------------------------------------------------
-- DEVELOPER PRODUCTS (consumable, repeatable purchases)
-------------------------------------------------------------------------------

ShopConfig.DeveloperProducts = {
	-- Coin Packs
	{
		Id = 0, -- Set to actual Roblox Developer Product ID after creation
		Name = "CoinPackS",
		DisplayName = "Coin Pack (S)",
		Description = "500 Coins",
		Price = 39,
		CoinsGranted = 500,
		Category = "Coins",
		DisplayOrder = 1,
	},
	{
		Id = 0,
		Name = "CoinPackM",
		DisplayName = "Coin Pack (M)",
		Description = "2,000 Coins + 10% bonus!",
		Price = 99,
		CoinsGranted = 2200, -- 2000 + 10% bonus
		Category = "Coins",
		DisplayOrder = 2,
	},
	{
		Id = 0,
		Name = "CoinPackL",
		DisplayName = "Coin Pack (L)",
		Description = "5,000 Coins + 20% bonus!",
		Price = 179,
		CoinsGranted = 6000, -- 5000 + 20% bonus
		Category = "Coins",
		DisplayOrder = 3,
	},
	{
		Id = 0,
		Name = "CoinPackXL",
		DisplayName = "Coin Pack (XL)",
		Description = "12,000 Coins + 30% bonus!",
		Price = 349,
		CoinsGranted = 15600, -- 12000 + 30% bonus
		Category = "Coins",
		DisplayOrder = 4,
	},

	-- Boosts
	{
		Id = 0,
		Name = "2xBoost30",
		DisplayName = "2x Coins (30 min)",
		Description = "Double coin collection for 30 minutes.",
		Price = 69,
		Duration = 1800, -- 30 minutes in seconds
		Multiplier = 2.0,
		Category = "Boosts",
		DisplayOrder = 5,
	},
	{
		Id = 0,
		Name = "2xBoost60",
		DisplayName = "2x Coins (60 min)",
		Description = "Double coin collection for 60 minutes. Better value!",
		Price = 119,
		Duration = 3600,
		Multiplier = 2.0,
		Category = "Boosts",
		DisplayOrder = 6,
	},
	{
		Id = 0,
		Name = "SpeedBoost30",
		DisplayName = "Speed Burst (30 min)",
		Description = "+8 WalkSpeed for 30 minutes.",
		Price = 49,
		Duration = 1800,
		SpeedBonus = 8,
		Category = "Boosts",
		DisplayOrder = 7,
	},

	-- Crates / Cosmetics
	{
		Id = 0,
		Name = "BasicCrate",
		DisplayName = "Basic Crate",
		Description = "Open for a random Common or Uncommon cosmetic.",
		Price = 49,
		Rarity = "Basic",
		Category = "Crates",
		DisplayOrder = 8,
	},
	{
		Id = 0,
		Name = "PremiumCrate",
		DisplayName = "Premium Crate",
		Description = "Open for a random Rare or Epic cosmetic.",
		Price = 99,
		Rarity = "Premium",
		Category = "Crates",
		DisplayOrder = 9,
	},
	{
		Id = 0,
		Name = "LegendaryCrate",
		DisplayName = "Legendary Crate",
		Description = "Guaranteed Epic or Legendary cosmetic!",
		Price = 249,
		Rarity = "Legendary",
		Category = "Crates",
		DisplayOrder = 10,
	},
	{
		Id = 0,
		Name = "MeteorCrate",
		DisplayName = "Meteor Crate",
		Description = "Guaranteed Legendary cosmetic! The rarest items inside.",
		Price = 499,
		Rarity = "Meteor",
		Category = "Crates",
		DisplayOrder = 11,
	},
}

-------------------------------------------------------------------------------
-- IN-GAME SHOP (coins, not Robux)
-- These items are purchased with in-game coins.
-------------------------------------------------------------------------------

ShopConfig.InGameShop = {
	-- Coin Boosts (temporary, coin-purchased)
	{
		Name = "CoinBoostSmall",
		DisplayName = "Small Coin Boost",
		Description = "+25% coins for 5 minutes",
		Cost = 200,
		Duration = 300,
		Multiplier = 1.25,
		Category = "Boosts",
		DisplayOrder = 1,
	},
	{
		Name = "CoinBoostMedium",
		DisplayName = "Medium Coin Boost",
		Description = "+50% coins for 10 minutes",
		Cost = 500,
		Duration = 600,
		Multiplier = 1.5,
		Category = "Boosts",
		DisplayOrder = 2,
	},
	{
		Name = "CoinBoostLarge",
		DisplayName = "Large Coin Boost",
		Description = "+100% coins for 15 minutes",
		Cost = 1200,
		Duration = 900,
		Multiplier = 2.0,
		Category = "Boosts",
		DisplayOrder = 3,
	},

	-- Consumables
	{
		Name = "ArenaTicket",
		DisplayName = "Arena Ticket",
		Description = "Guarantees 1.5x arena bonus coins for your next round.",
		Cost = 100,
		Category = "Consumables",
		DisplayOrder = 4,
	},
	{
		Name = "LuckyCharm",
		DisplayName = "Lucky Charm",
		Description = "Next 5 coin spawns are guaranteed Silver or better.",
		Cost = 300,
		Category = "Consumables",
		DisplayOrder = 5,
	},

	-- Basic Cosmetics (coin-purchased)
	{
		Name = "NameColor_Blue",
		DisplayName = "Blue Name",
		Description = "Change your name color to blue.",
		Cost = 500,
		Type = "NameColor",
		Value = Color3.fromRGB(0, 150, 255),
		Category = "Cosmetics",
		DisplayOrder = 6,
	},
	{
		Name = "NameColor_Red",
		DisplayName = "Red Name",
		Description = "Change your name color to red.",
		Cost = 500,
		Type = "NameColor",
		Value = Color3.fromRGB(255, 50, 50),
		Category = "Cosmetics",
		DisplayOrder = 7,
	},
	{
		Name = "NameColor_Green",
		DisplayName = "Green Name",
		Description = "Change your name color to green.",
		Cost = 500,
		Type = "NameColor",
		Value = Color3.fromRGB(50, 200, 50),
		Category = "Cosmetics",
		DisplayOrder = 8,
	},
	{
		Name = "NameColor_Purple",
		DisplayName = "Purple Name",
		Description = "Change your name color to purple.",
		Cost = 750,
		Type = "NameColor",
		Value = Color3.fromRGB(170, 0, 255),
		Category = "Cosmetics",
		DisplayOrder = 9,
	},
}

-------------------------------------------------------------------------------
-- SHOP CATEGORIES (for UI organization)
-------------------------------------------------------------------------------

ShopConfig.Categories = {
	{
		Name = "Coins",
		DisplayName = "Coin Packs",
		Icon = "Coins",
		Description = "Purchase coins with Robux",
		DisplayOrder = 1,
	},
	{
		Name = "Boosts",
		DisplayName = "Boosts",
		Icon = "Lightning",
		Description = "Temporary and permanent boosts",
		DisplayOrder = 2,
	},
	{
		Name = "Crates",
		DisplayName = "Crates",
		Icon = "Crate",
		Description = "Open for random cosmetics",
		DisplayOrder = 3,
	},
	{
		Name = "Cosmetics",
		DisplayName = "Cosmetics",
		Icon = "Paintbrush",
		Description = "Customize your appearance",
		DisplayOrder = 4,
	},
	{
		Name = "Consumables",
		DisplayName = "Consumables",
		Icon = "Potion",
		Description = "Single-use items",
		DisplayOrder = 5,
	},
}

-------------------------------------------------------------------------------
-- HELPER FUNCTIONS
-------------------------------------------------------------------------------

--- Get a game pass by name.
function ShopConfig.getGamePass(name: string): table?
	for _, pass in ipairs(ShopConfig.GamePasses) do
		if pass.Name == name then
			return pass
		end
	end
	return nil
end

--- Get a developer product by name.
function ShopConfig.getDevProduct(name: string): table?
	for _, product in ipairs(ShopConfig.DeveloperProducts) do
		if product.Name == name then
			return product
		end
	end
	return nil
end

--- Get all shop items for a category.
function ShopConfig.getCategoryItems(categoryName: string): { table }
	local items = {}
	-- Check developer products
	for _, product in ipairs(ShopConfig.DeveloperProducts) do
		if product.Category == categoryName then
			table.insert(items, product)
		end
	end
	-- Check in-game shop
	for _, item in ipairs(ShopConfig.InGameShop) do
		if item.Category == categoryName then
			table.insert(items, item)
		end
	end
	return items
end

--- Calculate best value coin pack (coins per Robux).
function ShopConfig.getBestCoinValue(): table?
	local bestItem = nil
	local bestRatio = 0
	for _, product in ipairs(ShopConfig.DeveloperProducts) do
		if product.CoinsGranted then
			local ratio = product.CoinsGranted / product.Price
			if ratio > bestRatio then
				bestRatio = ratio
				bestItem = product
			end
		end
	end
	return bestItem
end

return ShopConfig
