-- AI Factory reusable game system: Shop (developer-product-free coin shop).
-- Server owns purchases via RemoteFunction; client only sends requests.
-- Wiring (server):
--   local Shop = require(ReplicatedStorage.Shared.GameSystems.Shop)
--   Shop.serve(remoteFunction, catalog, { statName = "Coins" })

local Shop = {}

export type ShopItem = {
	id: string,
	name: string,
	price: number,
	kind: string, -- "speed" | "jump" | "coins" | "tool"
	amount: number?,
}

function Shop.find(catalog: { ShopItem }, id: string): ShopItem?
	for _, item in ipairs(catalog) do
		if item.id == id then
			return item
		end
	end
	return nil
end

function Shop.serve(remote: RemoteFunction, catalog: { ShopItem }, options: { statName: string? }?)
	local statName: string = (options and options.statName) or "Coins"
	local Currency = require(script.Parent:WaitForChild("Currency"))

	remote.OnServerInvoke = function(player: Player, itemId: string)
		if typeof(itemId) ~= "string" then
			return false, "bad item"
		end
		local item = Shop.find(catalog, itemId)
		if not item then
			return false, "unknown item"
		end
		if not Currency.spend(player, statName, item.price) then
			return false, "not enough coins"
		end
		if item.kind == "speed" then
			local level = player:GetAttribute("SpeedLevel") or 0
			if typeof(level) ~= "number" then
				level = 0
			end
			player:SetAttribute("SpeedLevel", level + 1)
			local character = player.Character
			local humanoid = character and character:FindFirstChildOfClass("Humanoid")
			if humanoid then
				humanoid.WalkSpeed = math.min(48, humanoid.WalkSpeed + (item.amount or 2))
			end
		elseif item.kind == "coins" then
			Currency.grant(player, statName, item.amount or 10)
		end
		return true, ("purchased %s"):format(item.name)
	end
end

return Shop
