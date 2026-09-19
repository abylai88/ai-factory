-- AI Factory reusable game system: Save/Load (DataStore with pcall + budget).
-- Server-only. Never called from the client.
-- Usage (server):
--   local SaveLoad = require(ServerScriptService.GameSystems.SaveLoad)
--   SaveLoad.start(player, { Coins = 0 })

local SaveLoad = {}

function SaveLoad.storeName(fallback: string?): string
	return fallback or "AIFactorySaveV1"
end

function SaveLoad.snapshot(player: Player): { [string]: number }
	local out: { [string]: number } = {}
	local folder = player:FindFirstChild("leaderstats")
	if folder then
		for _, child in ipairs(folder:GetChildren()) do
			if child:IsA("IntValue") then
				out[child.Name] = child.Value
			end
		end
	end
	out.SpeedLevel = (player:GetAttribute("SpeedLevel") or 0) :: number
	return out
end

function SaveLoad.apply(player: Player, data: { [string]: any })
	if typeof(data) ~= "table" then
		return
	end
	local folder = player:FindFirstChild("leaderstats")
	if folder then
		for key, value in pairs(data) do
			if typeof(key) == "string" and typeof(value) == "number" then
				local stat = folder:FindFirstChild(key)
				if stat and stat:IsA("IntValue") then
					stat.Value = math.floor(value)
				end
			end
		end
	end
	if typeof(data.SpeedLevel) == "number" then
		player:SetAttribute("SpeedLevel", math.floor(data.SpeedLevel))
	end
end

function SaveLoad.load(player: Player, storeName: string?): { [string]: any }?
	local ok, storeOrErr = pcall(function()
		return game:GetService("DataStoreService"):GetDataStore(SaveLoad.storeName(storeName))
	end)
	if not ok then
		warn(("[SaveLoad] DataStore unavailable: %s"):format(tostring(storeOrErr)))
		return nil
	end
	local success, data = pcall(function()
		return (storeOrErr :: DataStore):GetAsync(("player_%d"):format(player.UserId))
	end)
	if success and typeof(data) == "table" then
		return data :: { [string]: any }
	end
	return nil
end

function SaveLoad.save(player: Player, storeName: string?): boolean
	local ok, storeOrErr = pcall(function()
		return game:GetService("DataStoreService"):GetDataStore(SaveLoad.storeName(storeName))
	end)
	if not ok then
		return false
	end
	local success = pcall(function()
		(storeOrErr :: DataStore):SetAsync(("player_%d"):format(player.UserId), SaveLoad.snapshot(player));
	end)
	return success
end

return SaveLoad
