-- Coin Rush Arena: upgrade definitions (shared).
-- Both server (validation) and client (UI display) use this module.

local UpgradeConfig = {
	Speed = {
		Name = "Speed",
		DisplayName = "Speed",
		BaseCost = 25,
		MaxLevel = 8,
		GrowthRate = 1.6,
		Description = "Increases WalkSpeed",
		Icon = "speed",
	},
	Magnet = {
		Name = "Magnet",
		DisplayName = "Magnet",
		BaseCost = 50,
		MaxLevel = 8,
		GrowthRate = 1.6,
		Description = "Increases coin pickup radius",
		Icon = "magnet",
	},
	Power = {
		Name = "Power",
		DisplayName = "Power",
		BaseCost = 100,
		MaxLevel = 10,
		GrowthRate = 1.6,
		Description = "Increases arena steal damage",
		Icon = "power",
	},
	Multiplier = {
		Name = "Multiplier",
		DisplayName = "Multiplier",
		BaseCost = 200,
		MaxLevel = 5,
		GrowthRate = 1.6,
		Description = "Increases coin collection rate",
		Icon = "multiplier",
	},
}

return UpgradeConfig
