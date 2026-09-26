-- Coin Rush Arena: ServerStorage CoinService (legacy shim).
-- The main CoinService has moved to ServerScriptService/CoinService.lua.
-- Pure math functions are now in ReplicatedStorage/Shared/CoinMath.lua.
-- This file exists for backward compatibility only.

local CoinMath = require(game:GetService("ReplicatedStorage"):WaitForChild("Shared"):WaitForChild("CoinMath"))

local CoinService = {}
-- Delegate to CoinMath for any callers still referencing this module.
CoinService.upgradeCost = CoinMath.upgradeCost
CoinService.nextWalkSpeed = CoinMath.nextWalkSpeed

return CoinService
