# Technical Design — Coin Collector Simulator

**Date:** 2026-09-16
**Author:** Technical Designer (AI Factory)
**Status:** Ready for implementation
**GDD Goal:** A Roblox coin-collecting simulator where players collect coins, purchase speed upgrades, and persist progress across sessions.

---

## 1. Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        CLIENT                               │
│                                                             │
│  StarterGui/HUD.client.lua    StarterPlayer/main.client.lua│
│       │ (UI rendering)              │ (gameplay requests)   │
│       └──────────┬──────────────────┘                       │
│                  ▼                                          │
│          RemoteEvents (WaitForChild)                        │
└──────────────────┬──────────────────────────────────────────┘
                   │ RemoteEvents replicate
┌──────────────────▼──────────────────────────────────────────┐
│                        SERVER                               │
│                                                             │
│  ServerScriptService/                                      │
│    main.server.lua  ← orchestrator                          │
│      ├── requires PlayerData.lua (persistence)             │
│      ├── requires CoinService.lua (upgrade formulas)       │
│      ├── creates RemoteEvents                               │
│      ├── handles RequestUpgrade, RequestCollectCoin         │
│      ├── spawns coin parts in Workspace                     │
│      ├── runs autosave loop                                 │
│      └── applies WalkSpeed on upgrade                       │
│                                                             │
│  ServerStorage/                                             │
│    CoinService.lua  ← (MOVED from Shared, server-only)     │
└─────────────────────────────────────────────────────────────┘
```

### Key Design Decisions

| Decision | Rationale |
|----------|-----------|
| **Server creates all coins** | Coins are server-authoritative; client cannot fabricate coins |
| **CoinService moves to ServerStorage** | Upgrade cost formula is sensitive; must not replicate to clients |
| **Single RemoteEvent per direction** | Keep network surface small: `RequestUpgrade`, `CoinCollected` |
| **Coin parts use .Touched** | Standard Roblox approach; server verifies via magnitude check |
| **leaderstats kept for auto-replication** | Roblox auto-replicates leaderstats to all clients — zero network code needed for display |
| **Workspace added to Rojo mapping** | Coin spawn points become source-controlled |

---

## 2. Data Structures

### 2.1 PlayerData Cache (Server Memory)

```lua
-- Type already defined in PlayerData.lua
PlayerData._cache: { [Player]: { Coins: number, SpeedLevel: number } }
```

Loaded from DataStore on `PlayerAdded`, saved on `PlayerRemoving` + autosave timer.

### 2.2 RemoteEvent Contracts

```
RemoteEvent: CoinCollected (Server → Client)
  Server fires: ServerFire(player)  -- no payload; client reads leaderstats

RemoteEvent: RequestUpgrade (Client → Server)
  Client fires: FireServer()
  Server validates:
    1. Player has enough coins (cost = CoinService.upgradeCost(...))
    2. SpeedLevel < SPEED_UPGRADE_MAX
  Server action:
    - Deducts coins via PlayerData.addCoins(player, -cost)
    - Increments SpeedLevel in cache
    - Applies Humanoid.WalkSpeed
    - Updates leaderstats (already done by addCoins)
```

### 2.3 Coin Part Instance

Each coin is a server-created `Part`:
```
Part
  Name = "Coin"
  Shape = Cylinder (or custom mesh)
  Size = Vector3.new(1, 0.3, 1)
  Color = Bright yellow
  Material = Neon
  Anchored = true
  CanCollide = false
  Position = random spawn point from SpawnPoints table
  .CoinId = integer (unique ID for deduplication)
  .Collecting = boolean (flag to prevent double-collect)
```

### 2.4 Coin Spawn Configuration

```lua
-- Inside main.server.lua (new local table, NOT in Config.lua since it's map-specific)
local COIN_SPAWN_POINTS = {
    Vector3.new(10, 2, 10),
    Vector3.new(-10, 2, 10),
    Vector3.new(10, 2, -10),
    Vector3.new(-10, 2, -10),
    Vector3.new(0, 2, 20),
    -- ... expand as needed
}
```

---

## 3. File Plan

### 3.1 Files to MODIFY (no new files, only edits)

| # | File (relative) | Changes | Service |
|---|-----------------|---------|---------|
| 1 | `src/ReplicatedStorage/Shared/CoinService.lua` | **DELETE / MOVE** to ServerStorage | — |
| 2 | `src/ServerStorage/CoinService.lua` | **CREATE** (moved from Shared) | Server |
| 3 | `src/ServerScriptService/main.server.lua` | Major rewrite: require PlayerData, require CoinService, create RemoteEvents, coin spawning, upgrade handler, autosave loop | Server |
| 4 | `src/StarterPlayer/StarterPlayerScripts/main.client.lua` | Add: WaitForChild for remotes, upgrade button handler | Client |
| 5 | `src/StarterGui/HUD.client.lua` | Add: ScreenGui with Coins label, Speed label, Upgrade button | Client |
| 6 | `default.project.json` | Add Workspace mapping | — |

### 3.2 File Dependency Graph

```
Config.lua (Shared, read-only) ──→ main.server.lua
                                 ──→ PlayerData.lua
                                 ──→ CoinService.lua (ServerStorage)
                                 ──→ main.client.lua
                                 ──→ HUD.client.lua

PlayerData.lua (Server) ──→ main.server.lua (require)

CoinService.lua (ServerStorage) ──→ main.server.lua (require)

main.server.lua ──→ creates RemoteEvents in ReplicatedStorage/Remotes/

main.client.lua ──→ WaitForChild("Remotes") ──→ fires RequestUpgrade
HUD.client.lua  ──→ WaitForChild("leaderstats") ──→ reads Coins
```

---

## 4. Implementation Order

### Phase 1: Fix Foundations (server-side wiring)

**Step 1.1 — Move CoinService to ServerStorage**
- Delete `src/ReplicatedStorage/Shared/CoinService.lua`
- Create `src/ServerStorage/CoinService.lua` with identical contents
- Rationale: upgrade cost formula must not replicate to clients

**Step 1.2 — Wire PlayerData into main.server.lua**
- Add `require` for PlayerData at top of `main.server.lua`
- In `onPlayerAdded`: call `PlayerData.load(player)` after `setupLeaderstats(player)`
- In `setupLeaderstats`: read from PlayerData cache to set initial Coins value
- Add `PlayerData.addCoins(player, 0)` call to sync leaderstats on load

**Step 1.3 — Add Autosave Loop**
- After player connections setup, spawn a `while true do` loop
- `task.wait(Config.AUTOSAVE_SECONDS)` then `PlayerData.save(player)` for each online player
- Use `task.spawn` so it doesn't block

### Phase 2: Network Layer

**Step 2.1 — Create RemoteEvents**
- In `main.server.lua`, create a `Folder` named `"Remotes"` under `ReplicatedStorage`
- Create two `RemoteEvent` instances inside it:
  - `"RequestUpgrade"` — client → server
  - `"CoinCollected"` — server → client (notification)
- Convention: server creates, clients use `WaitForChild`

**Step 2.2 — Implement RequestUpgrade Server Handler**
```
RequestUpgrade.OnServerEvent:Connect(function(player)
  1. Get player data from cache
  2. Calculate cost = CoinService.upgradeCost(Config.UPGRADE_BASE_COST, data.SpeedLevel)
  3. Validate: data.Coins >= cost AND data.SpeedLevel < SPEED_UPGRADE_MAX
  4. If valid:
     a. data.Coins -= cost
     b. data.SpeedLevel += 1
     c. Update leaderstats.Coins
     d. Apply Humanoid.WalkSpeed = CoinService.nextWalkSpeed(...)
  5. If invalid: do nothing (client can detect via leaderstats unchanged)
end)
```

**Step 2.3 — Implement Coin Collection Server Handler**
- Coin `.Touched` event on each coin Part
- Debounce via `.Collecting` flag
- On touch: verify `player` is from `game.Players:GetPlayerFromPart(otherPart.Parent)`
- Deduct? No — ADD coins via `PlayerData.addCoins(player, Config.COIN_VALUE)`
- Fire `CoinCollected` to client (optional feedback)
- Destroy coin Part
- After `Config.COIN_RESPAWN_SECONDS`, spawn a new coin at a random spawn point

### Phase 3: Client UI

**Step 3.1 — Upgrade Button in main.client.lua**
- WaitForChild for Remotes folder and RequestUpgrade event
- Create a ScreenGui with a TextButton ("Upgrade Speed")
- Button .Activated: `Remotes.RequestUpgrade:FireServer()`
- Disable button when upgrade not affordable (check leaderstats.Coins)

**Step 3.2 — HUD Rendering in HUD.client.lua**
- Replace print-only logic with actual UI elements:
  - `ScreenGui` with `Frame`
  - `TextLabel` for Coins (bind to `leaderstats.Coins.Changed`)
  - `TextLabel` for Speed Level (bind to `leaderstats` SpeedLevel if added, or show WalkSpeed)
  - Style: readable font, semi-transparent background, positioned top-left

### Phase 4: World Setup

**Step 4.1 — Add Workspace Mapping to Rojo**
- Add to `default.project.json`:
  ```json
  "Workspace": {
    "$path": "src/Workspace"
  }
  ```
- Create `src/Workspace/` directory with coin spawn point configuration

**Step 4.2 — Coin Spawning in Workspace**
- Server creates coin Parts in `Workspace.Coins` folder (created by server)
- Spawn points defined in `main.server.lua` as a table of Vector3 positions
- On server start: spawn initial batch of coins (one per spawn point)
- Each coin has a unique `CoinId` attribute for tracking

---

## 5. Security Model

| Concern | Mitigation |
|---------|-----------|
| Client could fire RequestUpgrade without enough coins | Server validates coin balance before deducting |
| Client could fire RequestUpgrade infinitely | Server checks `SpeedLevel < SPEED_UPGRADE_MAX` |
| Client could claim coin collection without touching | Server verifies coin Part exists and `.Touched` fired |
| CoinService formula exposed to exploiters | Moved to ServerStorage (does not replicate) |
| Client could modify leaderstats locally | leaderstats is server-authoritative; client reads only |

---

## 6. Acceptance Criteria

### AC-1: Persistence Works
- [ ] Player joins → coins loaded from DataStore (or 0 if new)
- [ ] Player leaves → coins saved to DataStore
- [ ] Server restart → coins preserved via autosave
- [ ] `PlayerData.load()` is called in `onPlayerAdded`
- [ ] `PlayerData.save()` is called on `PlayerRemoving` and autosave

### AC-2: Coin Collection Works
- [ ] Coins spawn in Workspace at server start
- [ ] Coins are visible (Neon material, yellow color)
- [ ] Walking into a coin increases `leaderstats.Coins` by `COIN_VALUE`
- [ ] Collected coin is destroyed
- [ ] New coin respawns after `COIN_RESPAWN_SECONDS`

### AC-3: Speed Upgrade Works
- [ ] Upgrade button is visible on client
- [ ] Clicking button sends `RequestUpgrade` to server
- [ ] Server validates coins and level before processing
- [ ] Coins are deducted: `cost = floor(25 * 1.6^level)`
- [ ] `SpeedLevel` increments
- [ ] `Humanoid.WalkSpeed` increases by `SPEED_UPGRADE_STEP` per level
- [ ] Cannot exceed `SPEED_UPGRADE_MAX` speed
- [ ] Cannot upgrade if insufficient coins

### AC-4: HUD Displays Correctly
- [ ] ScreenGui renders on player's screen
- [ ] Coins label updates in real-time when coins change
- [ ] Speed label shows current walk speed or level
- [ ] Upgrade button shows cost and disables when unaffordable

### AC-5: Security
- [ ] CoinService.lua is NOT in ReplicatedStorage (moved to ServerStorage)
- [ ] All coin mutations happen server-side only
- [ ] Client only sends request events, never authoritative data
- [ ] Server validates all player requests before applying

### AC-6: Code Quality
- [ ] All existing files have proper Luau type annotations preserved
- [ ] No `print`-only debugging left in production code (HUD uses actual UI)
- [ ] RemoteEvents follow naming convention: PascalCase
- [ ] Rojo project includes Workspace mapping

---

## 7. Non-Goals (explicitly out of scope)

- Multiple coin types or rarities
- Shop/npc system
- Multiple worlds or zones
- Trading between players
- Anti-cheat beyond basic validation
- Sound effects or particle effects
- Mobile-specific UI layout

---

## 8. Open Questions for Implementer

1. **Coin mesh**: Use default Cylinder Part or load a MeshPart from asset? (Recommendation: Cylinder Part for zero external dependencies)
2. **Upgrade UI**: Simple TextButton in HUD.client.lua, or separate proximity-based prompt? (Recommendation: always-visible button for MVP)
3. **SpeedLevel in leaderstats**: Should we add SpeedLevel as a second leaderstats value for display? (Recommendation: yes, adds to progression feel)

---

*End of Technical Design*
