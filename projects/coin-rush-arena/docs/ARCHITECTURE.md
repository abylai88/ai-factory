# Coin Rush Arena — Technical Architecture

**Date:** September 2026  
**Author:** AI Factory Architect Agent  
**Project:** coin-rush-arena (Roblox + Luau + Rojo v7.7.0)  
**Status:** APPROVED — Defines the full technical architecture from MVP through launch

---

## 1. Executive Summary

This document defines the technical architecture for Coin Rush Arena: a Roblox game fusing incremental coin-collecting loops with competitive arena PvP. The architecture is organized around **server-authoritative gameplay** with clear trust boundaries, a **modular service layer** that scales with feature complexity, and a **Rojo-based build pipeline** that enables rapid iteration.

**Key architectural decisions:**
1. **Server-authoritative trust model** — all game state mutations validated on the server; clients are display + input only
2. **Service-oriented module decomposition** — each game system (coins, arena, leaderboards, etc.) is an independent ModuleScript with explicit interfaces
3. **Rojo Model-based RemoteEvents** — remotes declared as `.model.json` files in source, synced to ReplicatedStorage at build time (no runtime creation)
4. **DataStore + in-memory cache** — PlayerData module owns all persistence; other services read/write through it
5. **Shared constants in ReplicatedStorage** — Config, RemoteNames, and pure math functions shared across client/server to prevent duplication
6. **Client-side UI composition** — each screen/module is an independent LocalScript with clear input/output patterns

---

## 2. Platform & Toolchain

| Component | Version | Purpose |
|-----------|---------|---------|
| **Engine** | Roblox (2026 latest) | Runtime platform |
| **Language** | Luau (Luau strict mode where possible) | Type-safe scripting |
| **Build tool** | Rojo 7.7.0 (pinned via `rokit.toml`) | Source → place sync |
| **Toolchain manager** | Rokit | Pins tool versions across machines |
| **Output** | `build/coin-rush-arena.rbxlx` | Place file opened in Studio |

**Build command:**
```sh
rojo build default.project.json --output build/coin-rush-arena.rbxlx
```

**No npm, webpack, or external bundler** — this is a pure Roblox/Luau project validated by `rojo build` plus structural checks.

---

## 3. Runtime Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                        SERVER (Script)                            │
│                                                                   │
│  ServerScriptService/                                            │
│  ├── main.server.lua          ← Server entry / orchestrator      │
│  ├── PlayerData.lua           ← DataStore persistence + cache    │
│  ├── CoinService.lua          ← Coin spawning, collection, respawn│
│  ├── ArenaService.lua         ← Arena matchmaking + round logic  │
│  ├── LeaderboardService.lua   ← Leaderboard aggregation          │
│  ├── OfflineService.lua       ← Offline/idle coin calculation    │
│  ├── DailyRewardService.lua   ← Daily login rewards              │
│  └── PartyService.lua         ← Party/friend groups              │
│                                                                   │
│  ServerStorage/ (server-only, never replicates)                   │
│  ├── ServerConfig.lua         ← Internal tuning + secrets        │
│  └── MathService.lua          ← Server-only math (exploit guard) │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│                   REPLICATEDSTORAGE (shared)                       │
│                                                                   │
│  Shared/                                                          │
│  ├── Config.lua               ← Game constants (shared R/O)      │
│  ├── RemoteNames.lua          ← RemoteEvent name constants       │
│  ├── CoinMath.lua             ← Pure math functions (shared)     │
│  ├── UpgradeConfig.lua        ← Upgrade definitions              │
│  └── ArenaConfig.lua          ← Arena mode configurations        │
│                                                                   │
│  Remotes/ (declared as .model.json, synced by Rojo)               │
│  ├── RequestUpgrade.model.json      ← Client→Server              │
│  ├── CoinCollected.model.json       ← Server→Client feedback     │
│  ├── JoinArena.model.json           ← Client→Server              │
│  ├── LeaveQueue.model.json          ← Client→Server              │
│  ├── ArenaState.model.json          ← Server→Client              │
│  ├── ArenaScore.model.json          ← Server→Client              │
│  ├── ArenaCoinPickup.model.json     ← Client→Server              │
│  ├── ClaimDailyReward.model.json    ← Client→Server              │
│  ├── ClaimOfflineCoins.model.json   ← Client→Server              │
│  ├── RequestTrade.model.json        ← Client→Server              │
│  ├── AcceptTrade.model.json         ← Client→Server              │
│  └── LeaderboardData.model.json     ← Server→Client              │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│                      CLIENT (LocalScript)                          │
│                                                                   │
│  StarterPlayerScripts/                                            │
│  ├── main.client.lua          ← Client bootstrap                 │
│  ├── InputController.lua      ← Joystick + touch abstraction     │
│  ├── ArenaClient.lua          ← Arena UI + matchmaking           │
│  ├── LeaderboardClient.lua    ← Leaderboard display              │
│  ├── ShopClient.lua           ← Cosmetic shop                    │
│  └── EffectsClient.lua        ← VFX, particles, screen shake     │
│                                                                   │
│  StarterGui/                                                      │
│  ├── HUD.client.lua           ← Main HUD (coins, speed)          │
│  ├── UpgradeUI.client.lua     ← Upgrade panel                    │
│  ├── DailyRewardUI.client.lua ← Daily reward modal               │
│  ├── OfflineCoinsUI.client.lua← Welcome-back modal               │
│  └── SettingsUI.client.lua    ← Settings menu                    │
│                                                                   │
├──────────────────────────────────────────────────────────────────┤
│                        WORKSPACE                                   │
│                                                                   │
│  Map/                      ← Static geometry (Rojo-synced)        │
│  ├── SpawnPoint            ← Player spawn location                │
│  ├── ArenaPortal           ← Portal to enter arena                │
│  ├── LeaderboardBoard      ← In-world leaderboard display        │
│  ├── Terrain               ← Ground terrain                       │
│  └── Decorations/          ← Trees, rocks, paths                  │
│                                                                   │
│  Coins/ (created at runtime by CoinService)                       │
│  └── Coin (Part) × N       ← Active coin instances                │
│                                                                   │
│  Arena/ (created at runtime by ArenaService)                      │
│  ├── ArenaLobby            ← Waiting area                         │
│  └── ArenaBattlefield      ← Battle arena map                     │
│                                                                   │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. Module Structure & Responsibilities

### 4.1 Server Modules

#### `main.server.lua` — Server Orchestrator
**Location:** `src/ServerScriptService/main.server.lua`  
**Type:** Script (entry point)  
**Responsibilities:**
- Require and initialize all server services
- Create RemoteEvent references from ReplicatedStorage/Remotes
- Player lifecycle (PlayerAdded → load data, setup leaderstats, apply speed)
- Coin spawning system startup
- Autosave loop
- Graceful shutdown (BindToClose)

**Depends on:** PlayerData, CoinService, ArenaService, Config, RemoteNames, ServerConfig

#### `PlayerData.lua` — Data Persistence
**Location:** `src/ServerScriptService/PlayerData.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- In-memory cache (`_cache[player] → PlayerDataEntry`)
- DataStore read/write (key: `"player_{UserId}"`)
- Coin balance operations: `addCoins`, `subtractCoins`, `getCoins`
- Upgrade level accessors: `getSpeedLevel`, `setSpeedLevel`, etc.
- Leaderstats synchronization
- Autosave loop coordination
- PlayerRemoving cleanup + BindToClose save-all
- Error logging with `warn()` on DataStore failures

**Data model (server-only cache):**
```lua
type PlayerDataEntry = {
    -- Core
    Coins: number,
    TotalCoins: number,
    -- Upgrades
    SpeedLevel: number,       -- 0-8
    MagnetLevel: number,      -- 0-8
    PowerLevel: number,       -- 0-10
    MultiplierLevel: number,  -- 0-5
    -- Arena
    ArenaWins: number,
    ArenaRating: number,      -- starts at 1000
    GamesPlayed: number,
    WinStreak: number,
    BestWinStreak: number,
    -- Cosmetics
    Cosmetics: {number},
    EquippedTrail: number?,
    EquippedPet: number?,
    -- Retention
    LastLogin: number,        -- os.time()
    LastOnline: number,       -- os.time()
    DailyRewardsClaimed: number,
    TutorialComplete: boolean,
}
```

**DataStore schema:**
```
Key:    "player_{UserId}"
Value:  { Coins, TotalCoins, SpeedLevel, MagnetLevel, PowerLevel, MultiplierLevel,
          ArenaWins, ArenaRating, GamesPlayed, WinStreak, BestWinStreak,
          Cosmetics, EquippedTrail, EquippedPet, LastLogin, LastOnline,
          DailyRewardsClaimed, TutorialComplete }
Size:   ~300 bytes estimated (well within 4 MB limit)
```

**Data versioning:**
```lua
-- Future-proofing: add schemaVersion on load
local CURRENT_SCHEMA_VERSION = 1
-- On load: if saved.schemaVersion ~= CURRENT_SCHEMA_VERSION → migrate
```

#### `CoinService.lua` — Coin Spawning & Collection
**Location:** `src/ServerScriptService/CoinService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Coin spawning (weighted random type selection, zone-based positioning)
- Coin collection validation (touch detection, debounce, magnet range check)
- Coin respawn scheduling
- Multi-type coins (Bronze/Silver/Gold/Meteor)
- Coin value calculation with multiplier stacking
- Arena coin management (separate from world coins)

**Key interfaces:**
```lua
CoinService.startSpawning()              -- Begin world coin spawning
CoinService.stopSpawning()               -- Pause (e.g. during arena)
CoinService.spawnArenaCoins(config)      -- Arena-specific spawning
CoinService.validatePickup(player, coin) → boolean
CoinService.calculateValue(player, baseValue) → number
```

#### `ArenaService.lua` — Arena Matchmaking & Rounds
**Location:** `src/ServerScriptService/ArenaService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Matchmaking queue management
- Lobby creation, filling, and timeout
- Round lifecycle (countdown → active → results → cleanup)
- Score tracking and validation (server-authoritative)
- Coin steal validation (range, cooldown, alive check)
- Bot AI for queue fill
- Rating calculation (Elo-like system)
- Multi-mode support (Coin King, Speed Blitz, Last Coin Standing)

**Key interfaces:**
```lua
ArenaService.joinQueue(player, mode) → queueId
ArenaService.leaveQueue(player) → removed
ArenaService.getLobbyStatus(player) → status
-- Internal:
ArenaService.createLobby(mode, players)
ArenaService.startRound(lobby)
ArenaService.handleArenaCoinPickup(player, coinId)
ArenaService.handleSteal(stealer, victim)
ArenaService.endRound(lobby) → results
```

**State machine per lobby:**
```
WAITING → (min players met OR 60s elapsed) → COUNTDOWN
COUNTDOWN → (5s elapsed) → ACTIVE
ACTIVE → (timer expires OR last-coin-standing winner) → RESULTS
RESULTS → (10s display) → CLEANUP → (back to WAITING or destroyed)
```

#### `LeaderboardService.lua` — Leaderboards
**Location:** `src/ServerScriptService/LeaderboardService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Aggregates player scores across categories
- Supports Global / Friends / Server views
- Periodic refresh (every 60 seconds)
- In-world leaderboard board updates
- Seasonal rating reset (monthly)

#### `OfflineService.lua` — Offline Coins
**Location:** `src/ServerScriptService/OfflineService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Calculate offline coin accumulation from `LastOnline`
- Validate offline time (cap at 8 hours, prevent clock manipulation)
- Apply VIP and multiplier bonuses
- Generate claimable coin amount

#### `DailyRewardService.lua` — Daily Login
**Location:** `src/ServerScriptService/DailyRewardService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Track daily login streaks (7-day cycle)
- Validate claim timing (must claim within 24h or reset)
- Generate reward based on day number
- VIP 2x bonus

#### `PartyService.lua` — Party System
**Location:** `src/ServerScriptService/PartyService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Create/leave/disband parties (2-4 players)
- Party member tracking
- Coin multiplier application (1.2x for party members)
- Team assignment for Speed Blitz mode

### 4.2 ServerStorage Modules (Server-Only)

#### `ServerConfig.lua` — Internal Configuration
**Location:** `src/ServerStorage/ServerConfig.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- DataStore name and retry config
- Autosave interval
- Max players
- Log level
- Any values that must NOT reach the client

```lua
local ServerConfig = {
    DATASTORE_NAME = "CoinRushArenaV1",
    AUTOSAVE_SECONDS = 60,
    DATASTORE_RETRY_COUNT = 3,
    DATASTORE_RETRY_DELAY = 1,
    MAX_PLAYERS = 50,
    LOG_LEVEL = "INFO",
}
```

#### `MathService.lua` — Server-Only Math
**Location:** `src/ServerStorage/MathService.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Elo rating calculation
- Matchmaking scoring
- Any computation that must not be readable by clients (exploit prevention)

### 4.3 Shared Modules (ReplicatedStorage/Shared)

#### `Config.lua` — Game Constants
**Location:** `src/ReplicatedStorage/Shared/Config.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- All gameplay-tuning constants
- Coin system params, upgrade params, arena params
- UI layout constants
- **READ-ONLY at runtime** — never mutated after initial return

#### `RemoteNames.lua` — Remote Event Name Registry
**Location:** `src/ReplicatedStorage/Shared/RemoteNames.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Single source of truth for all remote event names
- Prevents string typos across client/server code
- Both sides require this module

```lua
local RemoteNames = {
    RequestUpgrade     = "RequestUpgrade",
    CoinCollected      = "CoinCollected",
    JoinArena          = "JoinArena",
    LeaveQueue         = "LeaveQueue",
    ArenaState         = "ArenaState",
    ArenaScore         = "ArenaScore",
    ArenaCoinPickup    = "ArenaCoinPickup",
    ClaimDailyReward   = "ClaimDailyReward",
    ClaimOfflineCoins  = "ClaimOfflineCoins",
    RequestTrade       = "RequestTrade",
    AcceptTrade        = "AcceptTrade",
    LeaderboardData    = "LeaderboardData",
}
return RemoteNames
```

#### `CoinMath.lua` — Pure Math Functions
**Location:** `src/ReplicatedStorage/Shared/CoinMath.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- `upgradeCost(baseCost, level) → number`
- `nextWalkSpeed(start, step, max, level) → number`
- `magnetRadius(base, perLevel, max, level) → number`
- `offlineCoinRate(baseRate, magnetLevel, multiplierLevel) → number`
- Pure functions only — no side effects, no service dependencies

#### `UpgradeConfig.lua` — Upgrade Definitions
**Location:** `src/ReplicatedStorage/Shared/UpgradeConfig.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Upgrade type definitions (speed, magnet, power, multiplier)
- Cost formulas, max levels, per-level effects
- Used by both server (validation) and client (UI display)

#### `ArenaConfig.lua` — Arena Mode Configurations
**Location:** `src/ReplicatedStorage/Shared/ArenaConfig.lua`  
**Type:** ModuleScript  
**Responsibilities:**
- Mode-specific configs (Coin King, Speed Blitz, Last Coin Standing)
- Round durations, player counts, spawn rates
- Reward tables, rating parameters

### 4.4 Client Modules

#### `main.client.lua` — Client Bootstrap
**Location:** `src/StarterPlayer/StarterPlayerScripts/main.client.lua`  
**Type:** LocalScript  
**Responsibilities:**
- Require shared modules (Config, RemoteNames, CoinMath)
- Initialize client controllers (InputController, EffectsClient)
- Connect to server-side remotes for feedback events
- Coordinate client module lifecycle

#### `InputController.lua` — Input Abstraction
**Location:** `src/StarterPlayer/StarterPlayerScripts/InputController.lua`  
**Type:** ModuleScript (client-only)  
**Responsibilities:**
- Platform detection (PC / Mobile / Xbox)
- Virtual joystick for mobile
- Input mapping and debounce
- Movement input → character direction

#### `ArenaClient.lua` — Arena UI Controller
**Location:** `src/StarterPlayer/StarterPlayerScripts/ArenaClient.lua`  
**Type:** ModuleScript (client-only)  
**Responsibilities:**
- Arena queue UI (mode selection, queue status)
- In-round HUD (timer, scores, minimap)
- Post-round results screen
- Score animation and effects

#### `EffectsClient.lua` — VFX System
**Location:** `src/StarterPlayer/StarterPlayerScripts/EffectsClient.lua`  
**Type:** ModuleScript (client-only)  
**Responsibilities:**
- Floating text system (+N coins, LEVEL UP!, STOLEN!)
- Particle effects (coin bursts, upgrade flashes, victory confetti)
- Screen shake
- FOV scaling with speed
- Speed trail visual

### 4.5 Client GUI Modules (StarterGui)

Each is a LocalScript in StarterGui that creates and manages a ScreenGui:

| File | Purpose |
|------|---------|
| `HUD.client.lua` | Coin counter, speed display, persistent elements |
| `UpgradeUI.client.lua` | Upgrade panel with type selection, cost display |
| `DailyRewardUI.client.lua` | 7-day calendar modal |
| `OfflineCoinsUI.client.lua` | Welcome-back offline coins modal |
| `SettingsUI.client.lua` | Audio, graphics, account settings |

---

## 5. State Management

### 5.1 State Ownership Matrix

| State | Owner | Replicated? | Access Pattern |
|-------|-------|-------------|----------------|
| **Player coins** | Server (PlayerData._cache) | Via leaderstats (display only) | Server reads/writes cache; client reads leaderstats.IntValue |
| **Upgrade levels** | Server (PlayerData._cache) | Via leaderstats (display only) | Same pattern as coins |
| **Arena scores** | Server (ArenaService lobbies) | Yes (all clients see) | Server pushes via ArenaScore RemoteEvent |
| **Arena state** | Server (ArenaService lobbies) | Yes (all clients see) | Server pushes via ArenaState RemoteEvent |
| **Matchmaking queue** | Server (ArenaService) | Client sees own position | Server pushes via ArenaState |
| **Leaderboard data** | Server (LeaderboardService) | Yes | Server pushes via LeaderboardData RemoteEvent |
| **Daily reward status** | Server (PlayerData + DailyRewardService) | Client sees own status | Server sends on join, updates on claim |
| **Offline coins** | Server (OfflineService) | Client sees claimable amount | Server sends on join |
| **Cosmetics inventory** | Server (PlayerData._cache) | Client sees own inventory | Server sends on join, updates on purchase/trade |
| **Party state** | Server (PartyService) | Party members see | Server pushes to party members |
| **Camera / FOV** | Client (local only) | No | Client computes from WalkSpeed |
| **UI visibility** | Client (local only) | No | Client manages own state |
| **Input state** | Client (local only) | No | Client manages own state |

### 5.2 Client-Side Caching Strategy

Clients maintain a **read-only mirror** of relevant server state for responsive UI:

```lua
-- Client cache (in main.client.lua or per-UI module):
local clientCache = {
    Coins = 0,           -- mirrors leaderstats.Coins
    SpeedLevel = 0,      -- mirrors leaderstats.SpeedLevel
    MagnetLevel = 0,     -- from server on join
    ArenaRating = 1000,  -- from server on join
    IsInQueue = false,
    CurrentArena = nil,
}
```

**Cache invalidation rules:**
- Leaderstats `.Changed` events update client cache
- Server RemoteEvents can push explicit updates
- Client never writes to server-owned state directly
- Optimistic UI updates allowed (revert on server rejection)

### 5.3 Leaderstats Structure

```lua
player
└── leaderstats (Folder)
    ├── Coins (IntValue)           -- current balance
    ├── SpeedLevel (IntValue)      -- 0-8
    ├── TotalCoins (IntValue)      -- lifetime (for leaderboards)
    └── ArenaWins (IntValue)       -- total victories
```

Leaderstats is the **replicated read channel** for server state. Client UIs bind to `.Changed` events on these values.

### 5.4 RemoteEvent Communication Patterns

| Pattern | Use Case | Example |
|---------|----------|---------|
| **Client→Server Request** | Player action requiring validation | UpgradeRequest, JoinArena, ClaimDailyReward |
| **Server→Client Broadcast** | State update to all clients | ArenaState, ArenaScore |
| **Server→Client Targeted** | Feedback to specific player | CoinCollected, LeaderboardData |
| **Server→Client One-shot** | Modal trigger | OfflineCoinsData, DailyRewardStatus |

**All client→server events are validated server-side.** Never trust the client payload.

---

## 6. Data Flow Diagrams

### 6.1 Coin Collection (World)

```
CoinPart.Touched(hit) fires on server
  → CoinService.validatePickup(player, coin):
      1. Is hit from a valid character? (Humanoid, Health > 0)
      2. Is coin still active? (Attribute "Collecting" == false)
      3. Does player pass magnet range check?
  → PASS: Mark coin "Collecting" = true
         → PlayerData.addCoins(player, calculatedValue)
         → Sync leaderstats.Coins
         → coin:Destroy()
         → task.delay(respawnTime, spawnCoin)
         → CoinCollected:FireClient(player)  [feedback]
  → FAIL: Ignore (coin stays)

Client receives CoinCollected:
  → EffectsClient.playCoinBurst(coinType)
  → EffectsClient.showFloatingText("+N")
  → HUD updates via leaderstats.Changed
```

### 6.2 Speed Upgrade Purchase

```
Client: UpgradeButton.Activated
  → UpgradeUI plays optimistic animation
  → RequestUpgrade:FireServer({ upgradeType = "Speed" })

Server: RequestUpgrade.OnServerEvent
  → Validate: player has enough coins
  → Validate: player not at max level
  → Validate: player not in arena round
  → PlayerData.subtractCoins(player, cost)
  → PlayerData.setSpeedLevel(player, level + 1)
  → Sync leaderstats
  → Apply WalkSpeed to character
  → Print log

Client: leaderstats.SpeedLevel.Changed
  → HUD updates speed display
  → UpgradeUI updates button state
```

### 6.3 Arena Round Lifecycle

```
Player enters arena portal
  → Client: JoinArena:FireServer({ mode = "CoinKing" })

Server: ArenaService.joinQueue(player, mode)
  → Add to queue
  → Find/ create lobby with open slots
  → If queue > 30s: fill remaining with bots

Server: ArenaService.startRound(lobby)
  → ArenaState:FireAllClients({ state = "Countdown", lobbyId = ... })
  → 5s countdown
  → ArenaState:FireAllClients({ state = "Active", duration = 180 })
  → Spawn arena coins
  → Start round timer

During round:
  → Coin pickups validated by ArenaService
  → Steals validated by ArenaService (range, cooldown, alive)
  → ArenaScore:FireAllClients({ scores = {...} }) every 5s

Server: ArenaService.endRound(lobby)
  → Calculate placement, coins earned, rating change
  → Award coins via PlayerData.addCoins
  → Update PlayerData.ArenaWins, ArenaRating
  → ArenaState:FireAllClients({ state = "Results", results = {...} })
  → 10s results display
  → Cleanup: teleport players back to world
```

### 6.4 Offline Coins Flow

```
Player joins server
  → main.server.lua: onPlayerAdded(player)
  → PlayerData.load(player)
  → OfflineService.calculateOffline(player):
      offlineTime = os.time() - data.LastOnline
      cappedTime = math.min(offlineTime, 8 * 3600)
      coins = cappedTime × baseRate × bonuses
      coins = math.min(coins, 500)
  → If coins > 0:
      Send to client via dedicated remote
      Client shows OfflineCoinsUI modal
  → Client: ClaimOfflineCoins:FireServer()
  → Server: PlayerData.addCoins(player, offlineCoins)
  → Update data.LastOnline = os.time()
```

### 6.5 Daily Reward Flow

```
Player joins server
  → DailyRewardService.checkStreak(player)
  → If streak broken (>24h gap): reset to Day 1
  → Send status to client via remote

Client shows DailyRewardUI:
  → If canClaim: highlight current day, enable Claim button
  → If already claimed today: show "Come back tomorrow!"

Client: ClaimDailyReward:FireServer()
  → Server: DailyRewardService.claimReward(player)
  → Server: Apply reward (coins, speed boost, crate)
  → Server: Increment DailyRewardsClaimed
  → Server: Send updated status to client
```

---

## 7. RemoteEvent Inventory

All remotes are declared as `.model.json` files under `src/ReplicatedStorage/Remotes/` and synced by Rojo. No runtime creation needed.

| Remote Name | Direction | Type | Payload | Purpose |
|------------|-----------|------|---------|---------|
| `RequestUpgrade` | C→S | RemoteEvent | `{ upgradeType: string }` | Buy upgrade |
| `CoinCollected` | S→C | RemoteEvent | `{ coinType: string, value: number }` | Pickup feedback |
| `JoinArena` | C→S | RemoteEvent | `{ mode: string }` | Enter queue |
| `LeaveQueue` | C→S | RemoteEvent | `{}` | Leave queue |
| `ArenaState` | S→C | RemoteEvent | `{ state: string, data: any }` | Round state |
| `ArenaScore` | S→C | RemoteEvent | `{ scores: { [userId]: number } }` | Score updates |
| `ArenaCoinPickup` | C→S | RemoteEvent | `{ coinId: number }` | Arena coin claim |
| `ClaimDailyReward` | C→S | RemoteEvent | `{}` | Claim reward |
| `ClaimOfflineCoins` | C→S | RemoteEvent | `{}` | Claim offline coins |
| `RequestTrade` | C→S | RemoteEvent | `{ targetId: number, items: {} }` | Initiate trade |
| `AcceptTrade` | C→S | RemoteEvent | `{ tradeId: number }` | Accept trade |
| `LeaderboardData` | S→C | RemoteEvent | `{ category: string, entries: {} }` | Board update |
| `ShopData` | S→C | RemoteEvent | `{ items: {} }` | Shop inventory |
| `DailyRewardStatus` | S→C | RemoteEvent | `{ day: number, canClaim: boolean }` | Reward status |
| `OfflineCoinsReady` | S→C | RemoteEvent | `{ amount: number, timeAway: number }` | Offline info |

---

## 8. Rojo Project Structure & Build Configuration

### 8.1 `default.project.json`

```json
{
  "name": "Coin Rush Arena",
  "tree": {
    "$className": "DataModel",
    "ServerScriptService": {
      "$path": "src/ServerScriptService"
    },
    "ServerStorage": {
      "$path": "src/ServerStorage"
    },
    "ReplicatedStorage": {
      "$path": "src/ReplicatedStorage"
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

### 8.2 File Naming Convention

| Suffix | Rojo Class | Location | Notes |
|--------|-----------|----------|-------|
| `.server.lua` | Script | ServerScriptService | Server entry points |
| `.client.lua` | LocalScript | StarterGui, StarterPlayerScripts | Client entry points |
| `.lua` (no suffix) | ModuleScript | Any | Requires `return` statement |
| `.model.json` | Instance | Any | Declares Rojo instances |

### 8.3 Source Tree

```
src/
├── ServerScriptService/
│   ├── main.server.lua              ← Server entry (1 file, orchestrates)
│   ├── PlayerData.lua               ← DataStore + cache
│   ├── CoinService.lua              ← Coin spawning & collection
│   ├── ArenaService.lua             ← Arena matchmaking & rounds
│   ├── LeaderboardService.lua       ← Leaderboard management
│   ├── OfflineService.lua           ← Offline coin calculation
│   ├── DailyRewardService.lua       ← Daily login rewards
│   └── PartyService.lua             ← Party system
│
├── ServerStorage/
│   ├── ServerConfig.lua             ← Server-only config
│   ├── MathService.lua              ← Server-only math (Elo, etc.)
│   └── README.md                    ← Convention doc
│
├── ReplicatedStorage/
│   ├── Shared/
│   │   ├── Config.lua               ← Game constants
│   │   ├── RemoteNames.lua          ← Remote name registry
│   │   ├── CoinMath.lua             ← Pure math functions
│   │   ├── UpgradeConfig.lua        ← Upgrade definitions
│   │   ├── ArenaConfig.lua          ← Arena mode configs
│   │   └── README.md                ← Convention doc
│   │
│   ├── Remotes/
│   │   ├── RequestUpgrade.model.json
│   │   ├── CoinCollected.model.json
│   │   ├── JoinArena.model.json
│   │   ├── LeaveQueue.model.json
│   │   ├── ArenaState.model.json
│   │   ├── ArenaScore.model.json
│   │   ├── ArenaCoinPickup.model.json
│   │   ├── ClaimDailyReward.model.json
│   │   ├── ClaimOfflineCoins.model.json
│   │   ├── RequestTrade.model.json
│   │   ├── AcceptTrade.model.json
│   │   └── LeaderboardData.model.json
│   │
│   └── README.md
│
├── StarterPlayer/
│   └── StarterPlayerScripts/
│       ├── main.client.lua          ← Client bootstrap
│       ├── InputController.lua      ← Input abstraction
│       ├── ArenaClient.lua          ← Arena UI logic
│       ├── LeaderboardClient.lua    ← Leaderboard display
│       ├── ShopClient.lua           ← Cosmetic shop
│       ├── EffectsClient.lua        ← VFX, particles, shake
│       └── README.md
│
├── StarterGui/
│   ├── HUD.client.lua               ← Main HUD
│   ├── UpgradeUI.client.lua         ← Upgrade panel
│   ├── DailyRewardUI.client.lua     ← Daily rewards modal
│   ├── OfflineCoinsUI.client.lua    ← Welcome-back modal
│   ├── SettingsUI.client.lua        ← Settings
│   └── README.md
│
└── Workspace/
    ├── Map/                         ← Static geometry (Rojo-synced)
    │   ├── SpawnPoint
    │   ├── ArenaPortal
    │   ├── LeaderboardBoard
    │   └── Decorations/
    └── README.md
```

### 8.4 Build Pipeline

```
Source (src/) ──rojo build──→ build.rbxlx ──open in──→ Roblox Studio
                                                       │
                                                       ├── Edit mode (design)
                                                       ├── Play mode (solo testing)
                                                       └── Publish (upload to Roblox)
```

**Validation steps:**
1. `rojo build default.project.json` — structural validation (no syntax errors in project.json)
2. Luau type checking (via `luau-analyze` if available in toolchain)
3. Manual playtest in Studio (solo + multiplayer)
4. `rojo sourcemap` (optional) — generates instance tree for IDE integration

---

## 9. Trust Boundary Rules

### 9.1 Server Authority

| Rule | Implementation |
|------|---------------|
| **All game state mutations on server** | Coins, upgrades, ratings, cosmetics — only server writes to PlayerData |
| **Client sends requests, server decides** | RemoteEvents carry intent, not state changes |
| **DataStore access server-only** | ServerStorage modules only; client never requires DataStoreService |
| **Arena validation server-side** | All coin pickups, steals, scoring validated in ArenaService |
| **Rate limiting** | Debounce on all client→server events (coin: 0.3s, upgrade: 1.0s, arena: 5.0s) |
| **Input validation** | Server validates: coin exists, player alive, player not in wrong arena, sufficient balance |

### 9.2 Client Responsibilities

| Responsibility | Implementation |
|---------------|---------------|
| **Display server state** | Bind to leaderstats.Changed, RemoteEvent callbacks |
| **Collect input** | Joystick, buttons, touch events |
| **Send requests** | FireServer with intent only |
| **Visual feedback** | Particles, sound, screen shake, floating text |
| **Optimistic UI** | Update button colors immediately, revert on server rejection |

### 9.3 Exploit Prevention

| Attack Vector | Mitigation |
|--------------|------------|
| Client fires upgrade without coins | Server validates `data.Coins >= cost` |
| Client fires coin pickup for non-existent coin | Server checks `coin.Parent ~= nil` (still in workspace) |
| Client sends fake arena score | Server tracks scores independently; client display only |
| Client manipulates character position | Server validates distance checks (magnet range, steal range) |
| Client spams remote events | Server-side debounce per player per event type |
| Client reads server-only config | ServerStorage is not replicable; client cannot require it |
| Client modifies DataStore directly | DataStore access only in server scripts (enforced by Roblox) |

---

## 10. Scalability Considerations

### 10.1 DataStore Limits

| Limit | Value | Our Usage | Headroom |
|-------|-------|-----------|----------|
| Read rate per server | 60+6×players/s | ~1 read/player on join | ✅ Well under |
| Write rate per server | 6+6×players/s | ~1 write/player/min (autosave) | ✅ Well under |
| Max data per key | 4 MB | ~300 bytes | ✅ 99.99% headroom |
| Max key length | 50 chars | `"player_1234567890"` (20 chars) | ✅ Safe |

### 10.2 Server Performance

| Concern | Mitigation |
|---------|------------|
| Many coin Parts in workspace | Max 50 world + 30 arena = 80 Parts. Roblox handles thousands. ✅ |
| Touch event overhead | Coins are Anchored + CanCollide=false, minimal physics cost. ✅ |
| RemoteEvent throughput | ~10 events/player/min average. Scales linearly. ✅ |
| Leaderstats updates | IntValue.Changed is efficient. Max 4 values per player. ✅ |
| Bot AI computation | Simple state machine, runs every 0.5s. 8 bots max per arena. ✅ |

### 10.3 Multi-Server (Future)

| Scenario | Approach |
|----------|----------|
| 50 players per server | Current `MAX_PLAYERS = 50` in ServerConfig |
| Multiple servers | Roblox handles server splitting; each server is independent |
| Cross-server leaderboards | Would require external API (Open Cloud) — deferred |
| Cross-server trading | Would require external API — deferred |

---

## 11. Risk Register

### 11.1 Technical Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| **DataStore throttling at high CCU** | Medium | High | Batch saves during low traffic; session-based state for arena; autosave only saves dirty players; retry with exponential backoff | PlayerData |
| **Arena desync / lag exploitation** | Medium | High | Server-authoritative round timer + scoring; all coin pickups validated server-side; position checks use server-tracked values | ArenaService |
| **Coin accumulation exploit (AFK farming)** | Low | Medium | Touch detection requires character movement; AFK kick after 15 min idle; offline cap at 8 hours | CoinService |
| **Rojo sync conflicts during development** | Medium | Low | Only code files in src/; coins/arena spawned at runtime; workspace geometry minimal | Build pipeline |
| **RemoteEvent spam / flooding** | Low | Medium | Per-player debounce on all events; server rejects duplicate requests within cooldown window | All services |
| **Data loss on server crash** | Low | High | Autosave every 60s + BindToClose saves all + PlayerRemoving saves individual. Worst case: 60s of progress lost | PlayerData |
| **Luau type errors at runtime** | Low | Medium | Use type annotations, test with `luau-analyze` if available, manual playtest | Development |
| **Memory leaks from disconnected events** | Medium | Medium | Always disconnect connections on player leave; coin parts destroyed on collect; arena instances cleaned up | All services |

### 11.2 Design Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| **Farming loop feels boring** | Medium | High | Multi-type coins with visual variety; magnet upgrade expands gameplay; timed challenges; procedural spawning | CoinService + Config |
| **Arena feels unbalanced** | Medium | High | Server-authoritative validation; power upgrades earned (not bought); skill-based matchmaking; bot fill for fair lobbies | ArenaService |
| **Pay-to-win perception** | Medium | Critical | Arena power from gameplay only; cosmetics are monetization layer; game passes affect farming (not combat); separate leaderboards | Monetization design |
| **Content fatigue after 3 months** | High | High | Seasonal events; new arena modes; trading economy; cosmetic pipeline; leaderboard resets | Content pipeline |
| **Low return frequency** | High | Critical | Offline coins + daily rewards + arena "one more round" hook; short sessions (8-15 min); 3-5 daily returns target | OfflineService + DailyRewardService |
| **Matchmaking wait times** | Medium | Medium | Bot fill after 30s; min 2 players to start; multiple modes running simultaneously | ArenaService |

### 11.3 Operational Risks

| Risk | Likelihood | Impact | Mitigation | Owner |
|------|-----------|--------|------------|-------|
| **Roblox platform change (RFY algorithm)** | High | High | Diversify traffic (social + external); optimize for 28-day retention; design for return frequency | Product |
| **Cross-experience pass removal (May 2026)** | Done | Medium | All monetization stays in-game; no reliance on cross-game passes | Monetization |
| **Under-13 monetization decline** | High | High | Design for 18+ appeal; R15 avatars for US 18+ DevEx rate; competitive depth attracts older audience | Product |
| **DataStore outages** | Low | High | Graceful degradation: play continues with cached data; retry on next autosave cycle | PlayerData |
| **Server shutdown during arena round** | Low | Medium | BindToClose saves all player data; arena round cancelled, rewards not distributed (fair for all) | main.server |

---

## 12. Dependency Graph (Module Load Order)

```
Phase 1: Foundation (no dependencies)
├── Config.lua           (shared constants)
├── RemoteNames.lua      (remote name registry)
├── ServerConfig.lua     (server-only config)
├── CoinMath.lua         (pure math)
├── UpgradeConfig.lua    (upgrade definitions)
└── ArenaConfig.lua      (arena configs)

Phase 2: Core Services (depend on Phase 1)
├── PlayerData.lua       (depends on: ServerConfig, Config)
├── CoinService.lua      (depends on: PlayerData, Config, CoinMath, RemoteNames)
└── MathService.lua      (depends on: Config)

Phase 3: Advanced Services (depend on Phase 2)
├── ArenaService.lua     (depends on: PlayerData, CoinService, Config, ArenaConfig, MathService, RemoteNames)
├── LeaderboardService.lua (depends on: PlayerData, Config)
├── OfflineService.lua   (depends on: PlayerData, Config, CoinMath)
├── DailyRewardService.lua (depends on: PlayerData, Config)
└── PartyService.lua     (depends on: Config, RemoteNames)

Phase 4: Server Entry (depends on all services)
└── main.server.lua      (depends on: all server services + shared modules)

Phase 5: Client (depends on Phase 1 shared modules)
├── main.client.lua      (depends on: Config, RemoteNames, CoinMath)
├── InputController.lua  (depends on: Config)
├── EffectsClient.lua    (depends on: Config)
├── ArenaClient.lua      (depends on: Config, RemoteNames, ArenaConfig)
├── LeaderboardClient.lua (depends on: Config, RemoteNames)
└── ShopClient.lua       (depends on: Config, RemoteNames)

Phase 6: Client GUI (depends on Phase 5)
├── HUD.client.lua       (depends on: Config, CoinMath)
├── UpgradeUI.client.lua (depends on: Config, CoinMath, UpgradeConfig, RemoteNames)
├── DailyRewardUI.client.lua (depends on: Config, RemoteNames)
├── OfflineCoinsUI.client.lua (depends on: RemoteNames)
└── SettingsUI.client.lua (depends on: Config)
```

---

## 13. Implementation Phases

### Phase 1: MVP Core Loop (Week 1-2)

**Goal:** Coin collection + speed upgrades + DataStore persistence + visual HUD

| File | Action | Effort |
|------|--------|--------|
| `Config.lua` | Modify: add coin spawn constants, arena constants | 5 min |
| `RemoteNames.lua` | Create | 5 min |
| `PlayerData.lua` | Modify: add subtractCoins, autosave, speed helpers, logging | 15 min |
| `main.server.lua` | Modify: wire remotes, coin spawning, upgrade handler, autosave | 30 min |
| `HUD.client.lua` | Already implemented — minor updates | 10 min |
| `main.client.lua` | Already implemented — minor updates | 5 min |
| `default.project.json` | Verify name is correct | 2 min |
| **Total** | | **~72 min** |

### Phase 2: Arena PvP (Week 2-3)

**Goal:** Coin King arena mode + matchmaking + bot fill

| File | Action | Effort |
|------|--------|--------|
| `ArenaService.lua` | Create: full arena system | 6h |
| `ArenaClient.lua` | Create: arena UI | 4h |
| `ArenaConfig.lua` | Create | 30 min |
| `.model.json` remotes | Create arena remotes | 30 min |
| `main.server.lua` | Wire ArenaService | 1h |
| **Total** | | **~12h** |

### Phase 3: Retention Systems (Week 3-4)

**Goal:** Offline coins + daily rewards + leaderboards

| File | Action | Effort |
|------|--------|--------|
| `OfflineService.lua` | Create | 3h |
| `DailyRewardService.lua` | Create | 3h |
| `LeaderboardService.lua` | Create | 4h |
| `OfflineCoinsUI.client.lua` | Create | 2h |
| `DailyRewardUI.client.lua` | Create | 2h |
| `LeaderboardClient.lua` | Create | 3h |
| `CoinService.lua` | Modify: multi-type coins | 2h |
| **Total** | | **~19h** |

### Phase 4: Social & Monetization (Month 2)

**Goal:** Game passes, party system, cosmetic basics

| File | Action | Effort |
|------|--------|--------|
| `PartyService.lua` | Create | 4h |
| Marketplace integration | Modify server + client | 3h |
| `ShopClient.lua` | Create | 3h |
| Speed Blitz mode | Extend ArenaService | 4h |
| **Total** | | **~14h** |

---

## 14. Acceptance Criteria for Architecture

| ID | Criterion | Verification |
|----|-----------|-------------|
| AC-ARCH-1 | All server state mutations validated server-side | Code review: every RemoteEvent handler validates input |
| AC-ARCH-2 | No client code requires ServerStorage modules | `grep -r "ServerStorage" src/StarterGui src/StarterPlayer` returns 0 results |
| AC-ARCH-3 | RemoteNames used consistently (no raw strings) | `grep -r '"[A-Z][a-z]' src/ --include="*.lua"` — all remote references go through RemoteNames |
| AC-ARCH-4 | PlayerData is single source of truth for persistence | All DataStore access is in PlayerData.lua only |
| AC-ARCH-5 | Rojo builds cleanly | `rojo build default.project.json` exits 0 |
| AC-ARCH-6 | No circular dependencies | Module dependency graph is a DAG |
| AC-ARCH-7 | All modules have clear single responsibility | Code review: each module does one thing well |
| AC-ARCH-8 | Config constants are tunable without code changes in services | Services reference Config.* for all magic numbers |

---

## 15. Summary

This architecture provides:

1. **Server-authoritative trust model** — eliminates exploit vectors through centralized validation
2. **Modular service decomposition** — each game system is an independent ModuleScript with explicit interfaces, enabling parallel development and isolated testing
3. **Scalable state management** — server owns truth, leaderstats provide replicated display, client caches for responsive UI
4. **Clean build pipeline** — Rojo 7.7.0 with model-based RemoteEvents, clear file naming conventions, validated by `rojo build`
5. **Documented risk register** — 20 identified risks with mitigations across technical, design, and operational categories
6. **Phased implementation** — MVP in ~2h, arena in ~12h, retention in ~19h, full game in ~50h

**Total files (planned):** 30+ Lua modules + 15 model.json files  
**Architecture complexity:** Moderate — appropriate for a mid-tier Roblox game targeting 20K-100K DAU
