# Coin Rush Arena — Technical Design Document

**Date:** September 2026
**Author:** AI Factory Designer Agent
**Project:** coin-rush-arena (Roblox)
**Status:** APPROVED — Ready for Programmer Implementation

---

## 1. Executive Summary

This document translates the Researcher's diagnosis (13 issues: 4 High, 4 Medium, 5 Low) and the Market Analysis into a concrete technical implementation plan. The codebase is currently a minimal Roblox/Luau template skeleton with no functional gameplay. The design addresses all confirmed issues in prioritized phases, producing a working MVP: coin collection loop with server-authoritative persistence, visual HUD, and basic speed upgrades.

The design follows the existing server-authoritative architecture and Rojo conventions already established in the template.

---

## 2. Architecture Overview

### 2.1 Runtime Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     SERVER (Script)                       │
│                                                          │
│  main.server.lua ─── requires ──→ PlayerData.lua         │
│       │                              │                   │
│       ├── Creates RemoteEvents       ├── load(player)    │
│       ├── PlayerAdded handler        ├── save(player)    │
│       │   ├── setupLeaderstats       ├── addCoins()      │
│       │   ├── PlayerData.load()      ├── get(player)     │
│       │   └── applyWalkSpeed()       └── autosave loop   │
│       │                                                 │
│       ├── CoinManager (inline)                          │
│       │   ├── SpawnCoins()                              │
│       │   ├── OnCoinTouched()                           │
│       │   └── RespawnCoin()                             │
│       │                                                 │
│       └── UpgradeHandler (inline)                       │
│           └── OnUpgradeRequest() → validate → apply     │
│                                                          │
├──────────── ReplicatedStorage (shared) ──────────────────┤
│  Shared/Config.lua        ← constants, tuning           │
│  Shared/CoinService.lua   ← pure math functions         │
│  Shared/RemoteNames.lua   ← remote event name constants │
│  Remotes/                 ← created at runtime by server│
│     ├── CoinPickupRequest (RemoteEvent)                 │
│     └── UpgradeRequest (RemoteEvent)                    │
├─────────────────────────────────────────────────────────┤
│                   CLIENT (LocalScript)                    │
│                                                          │
│  main.client.lua          ← minimal client bootstrap    │
│                                                          │
│  HUD.client.lua           ← ScreenGui + TextLabel       │
│     ├── Binds to leaderstats.Coins                      │
│     └── Updates visual display                          │
└─────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

```
Coin Touch → Client detects → Fires CoinPickupRequest RemoteEvent
    → Server validates (cooldown, alive, valid coin reference)
    → Server adds coins via PlayerData.addCoins()
    → Server destroys coin part, schedules respawn
    → Client sees updated leaderstats → HUD updates
```

```
Upgrade Button → Client fires UpgradeRequest RemoteEvent
    → Server validates (enough coins, valid level)
    → Server deducts coins, increments SpeedLevel
    → Server applies WalkSpeed to character
    → Client sees updated leaderstats → HUD updates
```

### 2.3 Trust Boundaries

| Data | Owner | Validation |
|------|-------|------------|
| Player Coins | Server (PlayerData._cache) | Server-side only; client reads leaderstats for display |
| Player SpeedLevel | Server (PlayerData._cache) | Server-side only; applies WalkSpeed |
| Coin pickup | Client detects touch | Server validates coin exists + cooldown |
| Upgrade request | Client initiates | Server validates balance + level cap |

---

## 3. File Plan

### 3.1 Files to MODIFY (existing)

| # | File | Changes | Severity |
|---|------|---------|----------|
| M1 | `src/ReplicatedStorage/Shared/Config.lua` | Fix GAME_NAME, add coin spawn constants, add arena constants | LOW |
| M2 | `src/ServerScriptService/main.server.lua` | Require PlayerData, wire load/save, add coin spawning, add upgrade handler, create remotes, add autosave, add race-condition guard | HIGH |
| M3 | `src/ServerScriptService/PlayerData.lua` | Add warn() logging on pcall failures, add autosave loop, add subtractCoins(), add speed upgrade helpers | MEDIUM |
| M4 | `src/StarterGui/HUD.client.lua` | Replace print-only with ScreenGui + TextLabel visual display, add upgrade button | MEDIUM |
| M5 | `default.project.json` | Fix name, add Workspace mapping | LOW |
| M6 | `README.md` | Update to reflect project name and new architecture | LOW |

### 3.2 Files to CREATE (new)

| # | File | Purpose | Severity |
|---|------|---------|----------|
| C1 | `src/ReplicatedStorage/Shared/RemoteNames.lua` | Centralized remote name constants (prevents typos, single source of truth) | HIGH |
| C2 | `src/Workspace/README.md` | Placeholder documenting that workspace objects are NOT Rojo-synced (coins are spawned by code) | LOW |

### 3.3 Files UNCHANGED

| File | Reason |
|------|--------|
| `src/ReplicatedStorage/Shared/CoinService.lua` | Already has pure math functions; will be consumed by new code |
| `src/StarterPlayer/StarterPlayerScripts/main.client.lua` | Client bootstrap; minimal changes not needed |
| `src/ServerStorage/README.md` | No server-only assets needed yet |
| `src/ReplicatedStorage/Remotes/README.md` | Convention doc; remotes created at runtime |

---

## 4. Module Specifications

### 4.1 `RemoteNames.lua` (NEW — C1)

**Path:** `src/ReplicatedStorage/Shared/RemoteNames.lua`
**Type:** ModuleScript
**Lines (est):** ~8
**Dependencies:** None

```lua
-- Purpose: Centralized remote event names. Prevents string typos across
-- client/server code. Both sides require this module.

local RemoteNames = {
    CoinPickupRequest = "CoinPickupRequest",  -- Client → Server: coin collected
    UpgradeRequest = "UpgradeRequest",        -- Client → Server: speed upgrade
}

return RemoteNames
```

**Rationale:** Centralizing names in a shared module prevents the common Roblox bug where client and server use slightly different string keys, causing silent remote failures.

### 4.2 `Config.lua` (MODIFY — M1)

**Path:** `src/ReplicatedStorage/Shared/Config.lua`
**Changes:**
1. `GAME_NAME` → `"Coin Rush Arena"` (fix template artifact)
2. Add coin spawning constants
3. Add upgrade constants (consolidate existing scattered values)

**New config fields:**

```lua
-- Existing (keep, already defined):
COIN_VALUE = 1,
COIN_RESPAWN_SECONDS = 5,
START_WALK_SPEED = 16,
SPEED_UPGRADE_STEP = 2,
SPEED_UPGRADE_MAX = 32,
UPGRADE_BASE_COST = 25,
AUTOSAVE_SECONDS = 60,

-- Add these:
COIN_SPAWN_AREA_SIZE = 40,       -- studs, coins spawn within this radius
COIN_SPAWN_HEIGHT = 3,           -- studs above ground
COIN_MAX_COUNT = 50,             -- max coins in world simultaneously
COIN_TOUCH_COOLDOWN = 0.3,       -- seconds between pickup validations per player
LEADERSTATS_FOLDER = "leaderstats",
```

### 4.3 `PlayerData.lua` (MODIFY — M3)

**Path:** `src/ServerScriptService/PlayerData.lua`
**Changes:**

1. **Add warn() logging** in `load()` and `save()` pcall failure branches:
   ```lua
   if not ok then
       warn(("[PlayerData] FAILED to load data for %s: %s"):format(player.Name, tostring(saved)))
   end
   ```

2. **Add `subtractCoins()` function** — mirror of `addCoins()` for upgrade deductions:
   ```lua
   function PlayerData.subtractCoins(player: Player, amount: number): boolean
       local data = PlayerData.get(player)
       if data.Coins < amount then return false end
       data.Coins -= amount
       -- sync leaderstats
       local leaderstats = player:FindFirstChild("leaderstats")
       local coinsValue = leaderstats and leaderstats:FindFirstChild("Coins")
       if coinsValue and coinsValue:IsA("IntValue") then
           coinsValue.Value = data.Coins
       end
       return true
   end
   ```

3. **Add `getSpeedLevel()` / `setSpeedLevel()` helpers** for clean access:
   ```lua
   function PlayerData.getSpeedLevel(player: Player): number
       return PlayerData.get(player).SpeedLevel
   end

   function PlayerData.setSpeedLevel(player: Player, level: number)
       PlayerData.get(player).SpeedLevel = level
   end
   ```

4. **Add `startAutosave()` function** — called once from main.server.lua:
   ```lua
   function PlayerData.startAutosave()
       task.spawn(function()
           while true do
               task.wait(Config.AUTOSAVE_SECONDS)
               for _, player in ipairs(Players:GetPlayers()) do
                   task.spawn(PlayerData.save, player)
               end
           end
       end)
   end
   ```

**No changes to existing function signatures** — all existing code (`get`, `addCoins`, `load`, `save`, `PlayerRemoving`, `BindToClose`) remains backward-compatible.

### 4.4 `main.server.lua` (MODIFY — M2)

**Path:** `src/ServerScriptService/main.server.lua`
**This is the largest change.** The server entry point becomes the orchestrator.

**New requires:**
```lua
local PlayerData = require(ReplicatedStorage:WaitForChild("ServerScriptService"):WaitForChild("PlayerData"))
-- Note: PlayerData is in ServerScriptService, not ReplicatedStorage.
-- Actually, since Rojo maps ServerScriptService, the require path is:
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))
-- OR (cleaner, using ReplicatedStorage reference pattern):
-- PlayerData stays in ServerScriptService, main.server.lua also in ServerScriptService
-- So: local PlayerData = require(script.Parent.PlayerData)
```

Wait — **important architectural note**: Both `main.server.lua` and `PlayerData.lua` are Scripts in `ServerScriptService`. A Script cannot directly `require()` a sibling Script. However, PlayerData.lua is a ModuleScript (uses `return PlayerData`), not a Script. The file extension is `.lua` not `.server.lua`, so Rojo will treat it as a ModuleScript. This is correct and will work with `require()`.

**Full revised structure of main.server.lua:**

```lua
-- Services
local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

-- Shared modules
local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local CoinService = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinService"))

-- Server modules (same directory)
local PlayerData = require(script.Parent:WaitForChild("PlayerData"))

---------------------------------------------------------------------------
-- REMOTE EVENTS (created by server, accessed by clients via WaitForChild)
---------------------------------------------------------------------------
local remotesFolder = Instance.new("Folder")
remotesFolder.Name = "Remotes"
remotesFolder.Parent = ReplicatedStorage

local coinPickupEvent = Instance.new("RemoteEvent")
coinPickupEvent.Name = RemoteNames.CoinPickupRequest
coinPickupEvent.Parent = remotesFolder

local upgradeEvent = Instance.new("RemoteEvent")
upgradeEvent.Name = RemoteNames.UpgradeRequest
upgradeEvent.Parent = remotesFolder

---------------------------------------------------------------------------
-- PLAYER SETUP
---------------------------------------------------------------------------
local initializedPlayers = {} -- guard against double-init

local function applyWalkSpeed(player: Player)
    local character = player.Character
    if not character then return end
    local humanoid = character:FindFirstChildOfClass("Humanoid")
    if not humanoid then return end
    local level = PlayerData.getSpeedLevel(player)
    humanoid.WalkSpeed = CoinService.nextWalkSpeed(
        Config.START_WALK_SPEED,
        Config.SPEED_UPGRADE_STEP,
        Config.SPEED_UPGRADE_MAX,
        level
    )
end

local function setupLeaderstats(player: Player)
    local leaderstats = Instance.new("Folder")
    leaderstats.Name = Config.LEADERSTATS_FOLDER or "leaderstats"
    local coins = Instance.new("IntValue")
    coins.Name = "Coins"
    coins.Value = 0
    coins.Parent = leaderstats
    leaderstats.Parent = player
end

local function onPlayerAdded(player: Player)
    -- Race condition guard
    if initializedPlayers[player] then return end
    initializedPlayers[player] = true

    print(("[CoinRushArena] Player joined: %s"):format(player.Name))

    -- Data persistence
    PlayerData.load(player)

    -- Leaderstats (syncs with loaded data)
    setupLeaderstats(player)
    local data = PlayerData.get(player)
    local leaderstats = player:FindFirstChild("leaderstats")
    if leaderstats then
        local coinsValue = leaderstats:FindFirstChild("Coins")
        if coinsValue then
            coinsValue.Value = data.Coins
        end
    end

    -- Apply saved walk speed
    player.CharacterAdded:Connect(function()
        applyWalkSpeed(player)
    end)
    if player.Character then
        applyWalkSpeed(player)
    end
end

local function onPlayerRemoving(player: Player)
    initializedPlayers[player] = nil
    -- PlayerData.save + cache cleanup is already handled by
    -- PlayerData's own PlayerRemoving connection
end

---------------------------------------------------------------------------
-- COIN SPAWNING SYSTEM
---------------------------------------------------------------------------
local activeCoins = {} -- { [coinPart] = true } — tracks live coins

local function getRandomSpawnPosition(): Vector3
    local halfSize = Config.COIN_SPAWN_AREA_SIZE / 2
    return Vector3.new(
        math.random(-halfSize, halfSize),
        Config.COIN_SPAWN_HEIGHT,
        math.random(-halfSize, halfSize)
    )
end

local function spawnCoin()
    if #getCoins() >= Config.COIN_MAX_COUNT then return end  -- pseudocode; see actual impl

    local coin = Instance.new("Part")
    coin.Name = "Coin"
    coin.Shape = Enum.PartType.Cylinder
    coin.Size = Vector3.new(0.4, 2, 2)  -- thin disc
    coin.Position = getRandomSpawnPosition()
    coin.Anchored = true
    coin.CanCollide = false
    coin.BrickColor = BrickColor.new("Bright yellow")
    coin.Material = Enum.Material.Neon
    coin.Parent = workspace

    activeCoins[coin] = true

    coin.Touched:Connect(function(hit)
        local character = hit.Parent
        if not character then return end
        local player = Players:GetPlayerFromCharacter(character)
        if not player then return end

        -- Server-side validation: coin still exists
        if not activeCoins[coin] then return end

        -- Deduct from active set immediately (prevent double-collect)
        activeCoins[coin] = nil

        -- Award coins
        PlayerData.addCoins(player, Config.COIN_VALUE)

        -- Destroy coin part
        coin:Destroy()

        -- Schedule respawn
        task.delay(Config.COIN_RESPAWN_SECONDS, spawnCoin)
    end)
end

local function startCoinSpawning()
    for i = 1, Config.COIN_MAX_COUNT do
        task.defer(spawnCoin)
    end
end

---------------------------------------------------------------------------
-- UPGRADE HANDLER
---------------------------------------------------------------------------
upgradeEvent.OnServerEvent:Connect(function(player: Player)
    local level = PlayerData.getSpeedLevel(player)
    local nextLevel = level + 1

    -- Validate: not at max
    if nextLevel * Config.SPEED_UPGRADE_STEP >= Config.SPEED_UPGRADE_MAX then
        warn(("[CoinRushArena] %s tried to upgrade past max level"):format(player.Name))
        return
    end

    -- Validate: enough coins
    local cost = CoinService.upgradeCost(Config.UPGRADE_BASE_COST, level)
    if not PlayerData.subtractCoins(player, cost) then
        return  -- not enough coins — silently fail (client shouldn't send invalid)
    end

    -- Apply
    PlayerData.setSpeedLevel(player, nextLevel)
    applyWalkSpeed(player)

    print(("[CoinRushArena] %s upgraded to speed level %d (cost: %d)"):format(
        player.Name, nextLevel, cost
    ))
end)

---------------------------------------------------------------------------
-- WIRE UP
---------------------------------------------------------------------------
Players.PlayerAdded:Connect(onPlayerAdded)
Players.PlayerRemoving:Connect(onPlayerRemoving)
for _, player in ipairs(Players:GetPlayers()) do
    task.spawn(onPlayerAdded, player)
end

-- Autosave
PlayerData.startAutosave()

-- Coin system
startCoinSpawning()

print("[CoinRushArena] Server online")
```

### 4.5 `HUD.client.lua` (MODIFY — M4)

**Path:** `src/StarterGui/HUD.client.lua`
**Replace print-only logic with visual ScreenGui.**

**New structure:**

```lua
-- Creates a ScreenGui with:
-- 1. Coin counter TextLabel (top-center)
-- 2. Speed level TextLabel (below coin counter)
-- 3. Upgrade button TextButton (bottom-center, visible when affordable)

local Players = game:GetService("Players")
local ReplicatedStorage = game:GetService("ReplicatedStorage")

local Config = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("Config"))
local RemoteNames = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("RemoteNames"))
local CoinService = require(ReplicatedStorage:WaitForChild("Shared"):WaitForChild("CoinService"))

local player = Players.LocalPlayer

-- Wait for remotes folder
local remotes = ReplicatedStorage:WaitForChild("Remotes")
local upgradeEvent = remotes:WaitForChild(RemoteNames.UpgradeRequest)

-- Create ScreenGui
local screenGui = Instance.new("ScreenGui")
screenGui.Name = "CoinRushHUD"
screenGui.ResetOnSpawn = true
screenGui.Parent = player:WaitForChild("PlayerGui")

-- Coin counter (top-center)
local coinLabel = Instance.new("TextLabel")
coinLabel.Name = "CoinLabel"
coinLabel.Size = UDim2.new(0, 200, 0, 50)
coinLabel.Position = UDim2.new(0.5, -100, 0, 20)
coinLabel.BackgroundColor3 = Color3.fromRGB(30, 30, 30)
coinLabel.TextColor3 = Color3.fromRGB(255, 215, 0) -- gold
coinLabel.TextScaled = true
coinLabel.Font = Enum.Font.GothamBold
coinLabel.Text = "Coins: 0"
coinLabel.Parent = screenGui

-- Speed level label
local speedLabel = Instance.new("TextLabel")
speedLabel.Name = "SpeedLabel"
speedLabel.Size = UDim2.new(0, 200, 0, 35)
speedLabel.Position = UDim2.new(0.5, -100, 0, 75)
speedLabel.BackgroundTransparency = 1
speedLabel.TextColor3 = Color3.fromRGB(255, 255, 255)
speedLabel.TextScaled = true
speedLabel.Font = Enum.Font.Gotham
speedLabel.Text = "Speed: Lv.0"
speedLabel.Parent = screenGui

-- Upgrade button
local upgradeButton = Instance.new("TextButton")
upgradeButton.Name = "UpgradeButton"
upgradeButton.Size = UDim2.new(0, 180, 0, 50)
upgradeButton.Position = UDim2.new(0.5, -90, 1, -80)
upgradeButton.BackgroundColor3 = Color3.fromRGB(50, 150, 50)
upgradeButton.TextColor3 = Color3.fromRGB(255, 255, 255)
upgradeButton.TextScaled = true
upgradeButton.Font = Enum.Font.GothamBold
upgradeButton.Text = "Upgrade Speed (25c)"
upgradeButton.Parent = screenGui

-- Upgrade click handler
upgradeButton.MouseButton1Click:Connect(function()
    upgradeEvent:FireServer()
end)

-- Bind to leaderstats
local function onLeaderstats(stats: Instance)
    local coins = stats:WaitForChild("Coins")

    -- Initial display
    coinLabel.Text = ("Coins: %d"):format(coins.Value)

    -- Update on change
    coins.Changed:Connect(function(value: number)
        coinLabel.Text = ("Coins: %d"):format(value)
        -- Could update upgrade button affordability here
    end)
end

local existing = player:FindFirstChild("leaderstats")
if existing then
    onLeaderstats(existing)
else
    player.ChildAdded:Connect(function(child)
        if child.Name == "leaderstats" then
            onLeaderstats(child)
        end
    end)
end
```

### 4.6 `default.project.json` (MODIFY — M5)

Add Workspace mapping for future map objects:

```json
{
  "name": "Coin Rush Arena",
  "tree": {
    "$className": "DataModel",
    "ServerScriptService": {
      "$path": "src/ServerScriptService"
    },
    "ReplicatedStorage": {
      "$path": "src/ReplicatedStorage"
    },
    "ServerStorage": {
      "$path": "src/ServerStorage"
    },
    "StarterGui": {
      "$path": "src/StarterGui"
    },
    "StarterPlayer": {
      "$path": "src/StarterPlayer"
    },
    "Workspace": {
      "$path": "src/Workspace"
    }
  }
}
```

---

## 5. Data Structures

### 5.1 PlayerData Cache (Server-Side)

```lua
-- Type definition (for documentation; Luau uses structural typing)
type PlayerDataEntry = {
    Coins: number,       -- non-negative integer
    SpeedLevel: number,  -- 0-based, max = (SPEED_UPGRADE_MAX / SPEED_UPGRADE_STEP) - 1
}

-- Storage:
PlayerData._cache = { [Player]: PlayerDataEntry }
```

### 5.2 DataStore Schema

```
Key: "player_{UserId}"
Value: {
    Coins: number,
    SpeedLevel: number
}
```

**Max size:** ~50 bytes. Well within 4 MB DataStore limit.
**Versioning:** None needed for V1. Future: add `schemaVersion` field.

### 5.3 Leaderstats (Replicated)

```
player
└── leaderstats (Folder)
    └── Coins (IntValue)
```

Leaderstats is the **only** client-readable source for coins. SpeedLevel is intentionally NOT in leaderstats (it's an internal upgrade state; the client tracks it separately via its own cache or we can add it later).

### 5.4 Coin Part (Workspace)

```
workspace
├── Coin (Part) — Anchored, CanCollide=false, Neon yellow cylinder
├── Coin (Part) ...
└── ... up to COIN_MAX_COUNT
```

Coins are created by code, NOT by Rojo. They exist only in the live game instance.

### 5.5 Remote Events (ReplicatedStorage)

```
ReplicatedStorage
└── Remotes (Folder) — created at runtime
    ├── CoinPickupRequest (RemoteEvent) — Client→Server
    └── UpgradeRequest (RemoteEvent) — Client→Server
```

---

## 6. Implementation Order (Dependency Graph)

```
Phase 1: Foundation (no dependencies between files)
├── M1: Config.lua — fix name, add constants        [5 min]
├── C1: RemoteNames.lua — create shared constants    [5 min]
└── M3: PlayerData.lua — add logging, helpers        [15 min]

Phase 2: Core Server (depends on Phase 1)
└── M2: main.server.lua — full rewire                [45 min]
    ├── requires PlayerData, Config, RemoteNames, CoinService
    ├── creates RemoteEvents
    ├── wires PlayerAdded with load + leaderstats + WalkSpeed
    ├── implements coin spawning system
    ├── implements upgrade handler
    └── starts autosave loop

Phase 3: Client (depends on Phase 2 for remotes)
└── M4: HUD.client.lua — visual UI                   [20 min]
    ├── creates ScreenGui
    ├── binds to leaderstats
    └── wires upgrade button to RemoteEvent

Phase 4: Housekeeping (independent)
├── M5: default.project.json — fix name, add Workspace [2 min]
├── C2: Workspace/README.md                            [1 min]
└── M6: README.md — update docs                        [5 min]
```

**Total estimated implementation time:** ~95 minutes

### Dependency Matrix

| Depends On | M1 | C1 | M3 | M2 | M4 | M5 | C2 | M6 |
|------------|----|----|----|----|----|----|----|----|
| M1 Config  | —  |    | ✓  | ✓  | ✓  |    |    |    |
| C1 Remote  |    | —  |    | ✓  | ✓  |    |    |    |
| M3 Player  |    |    | —  | ✓  |    |    |    |    |
| M2 Server  |    |    |    | —  |    |    |    |    |
| M4 HUD     |    |    |    |    | —  |    |    |    |

---

## 7. Acceptance Criteria

### AC-1: PlayerData Persistence (covers HIGH #1, MEDIUM #1, #2)

| Test | Expected |
|------|----------|
| Join server → collect coins → leave → rejoin | Coins persist across sessions |
| Check server log after DataStore failure | `warn()` message appears with player name |
| Stay connected for >60 seconds | Autosave fires (verify in output) |
| Server shutdown (BindToClose) | All player data saved before exit |

### AC-2: Remote Event Framework (covers HIGH #2)

| Test | Expected |
|------|----------|
| Inspect ReplicatedStorage at runtime | `Remotes/` folder exists with 2 RemoteEvents |
| Client fires UpgradeRequest | Server handler receives the event |
| Client code `WaitForChild("Remotes"):WaitForChild("UpgradeRequest")` | Resolves without error |

### AC-3: Coin Collection (covers HIGH #3)

| Test | Expected |
|------|----------|
| Start server | ~50 yellow cylinder parts appear in workspace |
| Walk character into coin | Coin disappears, coin count increments on HUD |
| Wait 5 seconds after collection | New coin spawns in random position |
| Try to collect same coin twice (latency test) | Only awarded once (server-side guard) |
| Rapid-fire touch events from 2 players on same coin | Only first player gets coins |

### AC-4: Visual HUD (covers MEDIUM #4)

| Test | Expected |
|------|----------|
| Join server | ScreenGui visible with "Coins: 0" in gold text |
| Collect a coin | Text updates to "Coins: 1" within 1 frame |
| Speed level label | Shows current speed level |
| Upgrade button | Visible, clickable, sends remote |

### AC-5: Speed Upgrade System (covers MEDIUM #3)

| Test | Expected |
|------|----------|
| Have 0 coins → click upgrade | Nothing happens (not enough coins) |
| Have 25+ coins → click upgrade | Coins deducted, WalkSpeed increases by 2 |
| Speed level 0 → WalkSpeed 16 | Correct |
| Speed level 1 → WalkSpeed 18 | Correct |
| Max speed → try upgrade | Blocked (level cap check) |
| Leave → rejoin | Speed level persists, WalkSpeed applied on spawn |

### AC-6: Config & Naming (covers LOW items)

| Test | Expected |
|------|----------|
| Server output on start | Says "Coin Rush Arena" not "AI Factory Game" |
| `rojo build` succeeds | No errors, project builds cleanly |
| Workspace path in project | `src/Workspace` mapped in `default.project.json` |

### AC-7: Race Condition Guard (covers LOW #5)

| Test | Expected |
|------|----------|
| Player joins during server startup loop | `onPlayerAdded` fires exactly once (check `initializedPlayers` guard) |

---

## 8. Risk Mitigations

| Risk | Mitigation |
|------|------------|
| Coin parts accumulate if respawn not triggered | Each `Touched` connection only fires respawn for that coin; `activeCoins` set tracks lifecycle |
| DataStore throttling at high CCU | Autosave is `task.spawn`-ed per player (non-blocking); errors logged but don't crash |
| Client spamming upgrade requests | Server validates every request (coin balance + level cap); stateless handler |
| Coin touch fires for non-player parts | `Players:GetPlayerFromCharacter()` check filters all non-player hits |
| Rojo sync conflicts | Only code files are in `src/`; coins spawned at runtime, not placed in Studio |
| Double-playerAdded race condition | `initializedPlayers` table guards against re-entry |

---

## 9. Out of Scope (Future Phases)

The following items from the Market Analysis and Research are **intentionally excluded** from this MVP:

| Item | Why Deferred |
|------|-------------|
| Arena / PvP system | Requires GDD, level design, round logic — large feature |
| Matchmaking | Depends on arena existing first |
| Leaderboards | Depends on meaningful progression beyond speed |
| Daily rewards / retention loops | Post-MVP engagement feature |
| Game Passes / Dev Products | Monetization layer after core loop proven |
| Pets / cosmetics | Content pipeline needed |
| Offline/idle progression | Requires server restart strategy |
| Social co-play / party system | Requires lobby + matchmaking |
| Regional pricing | Roblox platform config, not code |

---

## 10. Summary

This technical design transforms the empty template skeleton into a functional MVP with:

1. **Server-authoritative persistence** — PlayerData wired, autosave running, error logging active
2. **Remote event framework** — Clean client→server communication pattern
3. **Core gameplay loop** — Coin spawning, collection, respawn cycle
4. **Upgrade system** — Speed upgrades with server validation
5. **Visual HUD** — ScreenGui with live coin display and upgrade button
6. **Production hardening** — Race condition guards, DataStore error logging, autosave

**Total new/modified files:** 8 (3 modified significantly, 3 modified lightly, 2 new)
**Implementation phases:** 4 phases, ~95 minutes estimated
**Acceptance criteria:** 7 test categories with 25+ individual test cases
