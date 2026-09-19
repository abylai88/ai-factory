# Technical Architecture: Battle Brawl

**Version:** 2.0
**Date:** September 14, 2026
**Status:** Authoritative architecture document — module structure, state management, data flows, build configuration, and risk register.
**Source:** Actual codebase audit (all 44 source files read line-by-line), GDD v1.1, market-research.md, competitor-analysis.md

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Modular Structure](#2-modular-structure)
3. [State Management](#3-state-management)
4. [Data Flows](#4-data-flows)
5. [Build Configuration](#5-build-configuration)
6. [Risk Register](#6-risk-register)

---

## 1. Architecture Overview

### 1.1 Technology Stack

| Layer | Technology | Version | Purpose |
|-------|-----------|---------|---------|
| **Runtime** | TypeScript | 5.9 | Type-safe game logic, strict mode enabled |
| **Framework** | Phaser | 3.90 | 2D game engine (WebGL/Canvas auto-detect) |
| **Physics** | Arcade Physics | built-in | Hitbox/hurtbox collision, gravity, FPS target 60 |
| **Bundler** | Webpack | 5.110 | Build, optimize, bundle with asset modules |
| **Dev Server** | webpack-dev-server | 4.15 | HMR on port 9100, inline source maps |
| **Multiplayer (Phase 2)** | Colyseus | 0.17 | Authoritative server, WebSocket (reference only) |

**Current build status:** `npm run typecheck` — zero errors. `npm run build` — succeeds. Bundle size: 1.3MB (no game assets yet). Total build with assets target: ≤ 8MB.

### 1.2 Architecture Principles

| Principle | Description | Consequence |
|-----------|-------------|-------------|
| **Scene Isolation** | Each screen is a Phaser.Scene; no cross-scene state leakage | EventBus for events, scene.data for transitions, registry for session state |
| **System Composition** | Game systems (Combat, AI, Camera) are plain TS classes composed into GameScene | Systems are independently testable and reusable |
| **Data-Driven Design** | All balance numbers in `data/` modules; character differentiation is data, not subclass | Tuning without code changes; new characters = new data entries |
| **Input Abstraction** | Game logic reads `GameAction` enum values, never raw keyboard/touch | Single input layer supports all devices |
| **Portal Compliance** | Architecture enforces Poki/CrazyGames requirements from day one | ≤ 8MB bundle, no external requests, incognito-safe, ad blocker safe |
| **Event-Driven Decoupling** | Systems communicate via EventBus pub/sub, not direct references | Systems can be added/removed without modifying others |

### 1.3 System Layer Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SCENE LAYER                                  │
│                                                                      │
│  Boot ──► Preloader ──► MainMenu ──► CharacterSelect ──► GameScene   │
│                                    ◄── (Settings planned)  │    │    │
│                                                         │    │    │
│                                          ┌──────────────┘    │    │
│                                          ▼                   ▼    │
│                                    FightOverlay        PauseMenu  │
│                                    (parallel scene)    (parallel) │
│                                          │                         │
│                                          ▼                         │
│                               UpgradeSelect ──► Results ──► LevelUp│
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       SYSTEM LAYER (composed into GameScene)          │
│                                                                      │
│  InputManager ──► [GameAction[]] ──► Fighter.stateMachine            │
│                    │                    │                            │
│                    ▼                    ▼                            │
│              AISystem          CombatSystem ──► EventBus             │
│                                                  │                  │
│                               ComboTracker ◄─────┤                  │
│                               ParticleSystem ◄───┤                  │
│                               CameraSystem ◄─────┤                  │
│                               RoundManager ◄─────┤                  │
│                               AudioManager ◄─────┘                  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                        DATA LAYER (static, imported)                  │
│                                                                      │
│  characters.ts ──► Fighter.ts, AISystem, CharacterSelect              │
│  moves.ts ──► CombatSystem, Fighter                                  │
│  stages.ts ──► Stage.ts, GameScene                                   │
│  upgrades.ts ──► UpgradeSelect                                       │
│  progression.ts ──► Results, LevelUp, SaveSystem                     │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       UTIL LAYER (shared)                             │
│                                                                      │
│  EventBus ◄──► All scenes + all systems (pub/sub)                    │
│  SaveSystem ◄──► Boot, Results, LevelUp, MainMenu (persistence)      │
│  Constants ◄──► All systems, all entities, all scenes                │
│  DeviceDetector ◄──► Boot, InputManager (touch/tablet/perf)          │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 2. Modular Structure

### 2.1 Directory Tree (Current Implementation — 44 Files)

```
src/
├── index.ts                          [IMPLEMENTED] Entry point — config factory + scene registration
├── html/
│   ├── index.html                    [IMPLEMENTED] Title "Battle Brawl", viewport meta for mobile
│   └── css/main.css                  [IMPLEMENTED] Base styles
│
├── game/
│   ├── config/
│   │   └── PhaserConfig.ts           [IMPLEMENTED] Game config factory (1280×720, Arcade physics, FIT scaling)
│   │
│   ├── scenes/                       [11 scenes implemented, 1 planned]
│   │   ├── Scenes.ts                 [IMPLEMENTED] SceneKey enum with 11 values
│   │   ├── Boot.ts                   [IMPLEMENTED] Device detection, SaveSystem init, registry setup
│   │   ├── Preloader.ts              [IMPLEMENTED] Progress bar, event emission (no assets loaded yet)
│   │   ├── MainMenu.ts               [IMPLEMENTED] Title, PLAY/QUICK MATCH/SETTINGS buttons, level display
│   │   ├── CharacterSelect.ts        [IMPLEMENTED] 8-character grid, preview, stats, locked indicators
│   │   ├── GameScene.ts              [IMPLEMENTED] Core combat loop orchestrator (263 lines)
│   │   ├── FightOverlay.ts           [IMPLEMENTED] HUD overlay: HP/SP bars, timer, round dots, combo, KO text
│   │   ├── PauseMenu.ts              [IMPLEMENTED] RESUME/QUIT overlay with ESC binding
│   │   ├── UpgradeSelect.ts          [IMPLEMENTED] 3 upgrade cards with weighted random selection
│   │   ├── Results.ts                [IMPLEMENTED] XP/coins earned, level-up check, navigation
│   │   └── LevelUp.ts               [IMPLEMENTED] Level celebration with particle effects
│   │
│   ├── systems/                      [8 systems implemented]
│   │   ├── InputManager.ts           [IMPLEMENTED] Keyboard (P1: WASD+JKL, P2: Arrows+Numpad) + touch joystick/buttons, 12-frame input buffer
│   │   ├── CombatSystem.ts           [IMPLEMENTED] Hitbox/hurtbox AABB, damage calc, block/PGuard/GBreak, counter-hit, combo scaling, throw
│   │   ├── AISystem.ts               [IMPLEMENTED] Decision tree (close/mid/far range), 5 difficulty tiers, combo execution
│   │   ├── CameraSystem.ts           [IMPLEMENTED] Follow midpoint, screen shake (exponential decay), zoom, slow-motion
│   │   ├── RoundManager.ts           [IMPLEMENTED] Best-of-3 FSM (Intro→Fighting→KO→RoundEnd→MatchEnd), 99s timer
│   │   ├── ComboTracker.ts           [IMPLEMENTED] Consecutive hit tracking, 2s reset timer, events
│   │   ├── ParticleSystem.ts         [IMPLEMENTED] Hit/block/KO particle effects using Phaser tweens
│   │   └── AudioManager.ts           [IMPLEMENTED] SFX/music playback, volume controls, mute
│   │
│   ├── entities/
│   │   ├── Fighter.ts                [IMPLEMENTED] Base fighter: 399 lines, FSM (10 states), physics, damage, stats
│   │   ├── fighters/
│   │   │   ├── Rex.ts               [IMPLEMENTED] Thin wrapper (data-driven via characters.ts)
│   │   │   ├── Volt.ts              [IMPLEMENTED] Thin wrapper
│   │   │   ├── Titan.ts             [IMPLEMENTED] Thin wrapper
│   │   │   └── Luna.ts              [IMPLEMENTED] Thin wrapper
│   │   └── Stage.ts                  [IMPLEMENTED] Parallax BG layers, ground plane, boundary walls
│   │
│   ├── data/
│   │   ├── characters.ts             [IMPLEMENTED] 8 characters (4 starter + 4 locked), stats interface
│   │   ├── moves.ts                  [IMPLEMENTED] 7 moves (light, heavy, crouch variants, air variants, throw)
│   │   ├── stages.ts                 [IMPLEMENTED] 3 stages with colors and music keys
│   │   ├── upgrades.ts               [IMPLEMENTED] 12 upgrades with rarity-weighted selection
│   │   └── progression.ts            [IMPLEMENTED] XP curve, level unlocks, coin rewards
│   │
│   ├── ui/
│   │   ├── Button.ts                 [IMPLEMENTED] Reusable: container + bg + label, hover/press tweens
│   │   ├── HPBar.ts                  [IMPLEMENTED] Animated fill + ghost bar, color escalation
│   │   ├── SPBar.ts                  [IMPLEMENTED] Animated fill, color thresholds
│   │   ├── ComboCounter.ts           [IMPLEMENTED] Animated number, color escalation at 3/5/7 hits
│   │   └── UpgradeCard.ts            [IMPLEMENTED] Card with rarity border, hover/select animations
│   │
│   └── utils/
│       ├── Constants.ts              [IMPLEMENTED] All game constants, physics, combat, AI, UI values (129 lines)
│       ├── EventBus.ts               [IMPLEMENTED] Singleton Phaser.Events.EventEmitter
│       ├── SaveSystem.ts             [IMPLEMENTED] localStorage with try/catch, SaveData interface, CRUD methods
│       └── DeviceDetector.ts         [IMPLEMENTED] Touch/tablet/desktop/perf-tier detection
│
public/
└── assets/
    └── images/                       [EMPTY — needs game assets]
```

### 2.2 Module Responsibilities

#### Scenes (Phaser.Scene subclasses)

| Module | Lines | Responsibility | Active During |
|--------|-------|---------------|---------------|
| `Boot` | 20 | Device detection, SaveSystem init, populate registry | Startup only |
| `Preloader` | 50 | Progress bar UI, emit `gameLoadingFinished` | Startup only |
| `MainMenu` | 66 | Title, player level/coins, PLAY/QUICK MATCH/SETTINGS buttons | Menu state |
| `CharacterSelect` | 110 | 8-character grid (4 starter + 4 locked), preview, stats, SELECT/BACK | Pre-fight |
| `GameScene` | 263 | Core combat loop: spawn stage+fighters, compose all systems, run update loop, manage gauntlet flow | During combat |
| `FightOverlay` | 175 | HUD overlay (HP bars, SP bars, timer, round dots, combo counter, announcements) — runs as parallel scene | During combat |
| `PauseMenu` | 37 | RESUME/QUIT overlay; ESC to unpause | During combat (parallel) |
| `UpgradeSelect` | 38 | 3 upgrade cards with weighted random selection (between gauntlet fights) | Between rounds |
| `Results` | 97 | Score display, XP/coins earned, level-up check, navigation | Post-fight |
| `LevelUp` | 66 | Level-up celebration, star particles, continue button | Post-level-up |

#### Systems (plain TypeScript classes)

| Module | Lines | Responsibility | Dependencies |
|--------|-------|---------------|-------------|
| `InputManager` | 234 | Keyboard (P1: WASD+JKL, P2: Arrows+Numpad) + touch (joystick + 4 buttons) → `GameAction[]`; 12-frame ring buffer | DeviceDetector, Constants |
| `CombatSystem` | 131 | AABB hitbox/hurtbox collision, damage calc, block/PGuard/GBreak, counter-hit (+25%), combo scaling, throw | Fighter, moves.ts, Constants, EventBus |
| `AISystem` | 130 | Decision tree: close/mid/far range behavior, 5 difficulty tiers with scaling reaction time/combo knowledge | Fighter, characters.ts, Constants |
| `CameraSystem` | 100 | Follow midpoint between fighters, screen shake (intensity+duration+exponential decay), zoom, slow-motion | EventBus, Constants |
| `RoundManager` | 109 | Best-of-3 FSM: Intro→Fighting→KO→RoundEnd→MatchEnd; 99s countdown timer | Fighter, EventBus, Constants |
| `ComboTracker` | 40 | Track consecutive hits; 2s reset timer; emit `comboUpdate`/`comboReset` events | EventBus, Constants |
| `ParticleSystem` | 88 | Hit/block/KO particle bursts using Phaser tweens (no particle emitter) | EventBus |
| `AudioManager` | 73 | SFX/music playback, volume controls, mute for ad integration | EventBus |

#### Entities

| Module | Lines | Responsibility | Dependencies |
|--------|-------|---------------|-------------|
| `Fighter` | 399 | Core entity: Phaser.Rectangle sprite, 10-state FSM, physics (gravity/velocity/clamping), stats, hitbox/hurtbox generation, damage handling, stamina, combo count, facing, upgrade multipliers | Constants, characters.ts, EventBus |
| `Rex` | 8 | Thin wrapper (data-driven via `"rex"` character ID) | Fighter base |
| `Volt` | 7 | Thin wrapper (data-driven via `"volt"` character ID) | Fighter base |
| `Titan` | 7 | Thin wrapper (data-driven via `"titan"` character ID) | Fighter base |
| `Luna` | 7 | Thin wrapper (data-driven via `"luna"` character ID) | Fighter base |
| `Stage` | 58 | Stage renderer: BG color layers (parallax-style), ground plane, boundary walls (left/right/ceiling) | stages.ts, Constants |

#### Data (static, imported at compile time)

| Module | Lines | Purpose | Consumers |
|--------|-------|---------|-----------|
| `characters.ts` | 167 | 8 character definitions: id, name, archetype, stats (HP/SP/speed/damage), special cost, unlock level, color | Fighter, AISystem, CharacterSelect |
| `moves.ts` | 151 | 7 move definitions: damage, startup/active/recovery frames, stamina cost, hitbox dimensions, knockback, properties | CombatSystem, Fighter |
| `stages.ts` | | 3 stage definitions: id, name, bgColor/groundColor/ambientColor, musicKey | Stage, GameScene |
| `upgrades.ts` | 138 | 12 power-up definitions: id, name, effectType, effectValue, rarityWeight, rarity | UpgradeSelect |
| `progression.ts` | 41 | XP curve (`level × 200`), level unlocks table, coin earn rates | Results, LevelUp, SaveSystem |

#### Utils (shared across all modules)

| Module | Lines | Purpose | Consumers |
|--------|-------|---------|-----------|
| `EventBus` | 3 | Singleton `Phaser.Events.EventEmitter` for cross-scene pub/sub | All scenes, all systems |
| `SaveSystem` | 156 | localStorage CRUD with try/catch for incognito; typed `SaveData` interface; version migration | Boot, Results, MainMenu |
| `Constants` | 129 | All game balance numbers: physics, combat, AI, UI, colors, types | All systems, all entities |
| `DeviceDetector` | 42 | Touch/tablet/desktop detection; hardwareConcurrency + deviceMemory perf tiering | Boot, InputManager |

### 2.3 Module Dependency Graph

```
Increment 1 (Foundation):    Constants ──► EventBus ──► SaveSystem ──► DeviceDetector
                              │                │              │              │
                              └── characters.ts│  moves.ts    │  stages.ts   │
                                  upgrades.ts │  progression │              │
                                  PhaserConfig│              │              │
                                              ▼              ▼              ▼
Increment 2 (Input):         InputManager (DeviceDetector, Constants, EventBus)
                                              │
                                              ▼
Increment 3 (Fighter):       Fighter base (Constants, EventBus, characters.ts, moves.ts)
                              │
                              ├── Rex, Volt, Titan, Luna (thin wrappers)
                              │
                              ▼
Increment 4 (Combat):        CombatSystem + ComboTracker (Fighter, moves.ts, Constants, EventBus)
                              │
                              ▼
Increment 6 (AI):            AISystem (Fighter, characters.ts, Constants)
                              │
                              ▼
Increment 7 (Visuals):       CameraSystem + ParticleSystem (EventBus, Constants)
                              │
                              ▼
Increment 8 (Audio):         AudioManager (EventBus)
                              │
                              ▼
Increment 9 (Rounds):        RoundManager (Fighter, EventBus, Constants)
                              │
                              ▼
Increment 10 (Stages):       Stage (stages.ts, Constants)
                              │
                              ▼
Increment 11 (UI):           HPBar, SPBar, Button, UpgradeCard, ComboCounter (Constants, EventBus)
                              │
                              ▼
Increment 12 (Scenes):       GameScene (orchestrates ALL systems)
                              FightOverlay, PauseMenu, CharacterSelect,
                              UpgradeSelect, Results, LevelUp
                              │
                              ▼
Increment 13 (Progression):  XP/Coins, LevelUp, SaveSystem integration
                              │
                              ▼
Increment 14 (Integration):  Poki SDK, asset optimization, build verification
```

### 2.4 Per-Character Architecture Decision

Characters are **data-driven, not subclass-driven**. The `Fighter` base class accepts a `characterId` string, looks up stats from `CHARACTERS[characterId]`, and behaves accordingly. The per-character files (`Rex.ts`, `Volt.ts`, etc.) are thin wrappers that currently do nothing beyond passing the character ID to the base constructor.

**Rationale:** All 8 characters share the same FSM, physics, and combat logic. Character differentiation comes from:
1. **Stats** (HP, SP, speed, damage, weight, jump velocity) — defined in `characters.ts`
2. **Special cost and name** — defined in `characters.ts`
3. **Visual color** — defined in `characters.ts` (used for placeholder sprites)
4. **Future: unique move properties** — will be added to `moves.ts` with character-specific entries

This design means adding a new character requires only a new entry in `characters.ts` (and optionally `moves.ts`), not a new class file. The per-character files exist as extension points for future character-specific behavior (e.g., unique animation hooks, passive abilities).

---

## 3. State Management

### 3.1 State Layers

The game manages state across four distinct layers:

```
┌─────────────────────────────────────────────────────────────┐
│                    LAYER 1: PERSISTENT STATE                 │
│  SaveSystem (localStorage)                                   │
│  ── Player level, XP, coins                                  │
│  ── Unlocked characters, skins                               │
│  ── High scores, stats                                       │
│  ── Settings (volume, touch toggle)                          │
│  Format: SaveData interface, serialized as JSON              │
│  Incognito: try/catch, game works without save               │
│  Versioning: CURRENT_VERSION = 1, migration on load          │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 2: SESSION STATE                    │
│  Phaser.Registry (this.registry / game.registry)             │
│  ── device: DeviceInfo (isTouchDevice, isTablet, perfTier)  │
│  ── saveSystem: SaveSystem instance                          │
│  ── p1Name, p2Name: display names for HUD                   │
│  Scope: Lives for entire game session (page load)            │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 3: SCENE STATE                      │
│  Scene.data (passed via scene.start() / scene.restart())     │
│  ── mode, playerCharacter, opponentCharacter                 │
│  ── gauntletFight number, activeUpgrades[]                   │
│  ── won/lost booleans, round counts                          │
│  Scope: Per scene lifecycle; passed during transitions       │
├─────────────────────────────────────────────────────────────┤
│                    LAYER 4: FRAME STATE                      │
│  Local variables in update() loops                           │
│  ── Input actions (this frame)                               │
│  ── AI decisions (this frame)                                │
│  ── Hitbox collision results                                 │
│  ── Delta time                                               │
│  Scope: Per-frame; not persisted or shared                   │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Fighter State Machine (FSM)

Each fighter instance operates as a finite state machine with 10 states and strict transition rules.

```typescript
// Defined in Constants.ts
export const FIGHTER_STATES = {
  Idle: "idle",
  Walking: "walking",
  Jumping: "jumping",
  Crouching: "crouching",
  Attacking: "attacking",
  Blocking: "blocking",
  Hitstun: "hitstun",
  KO: "ko",
  CrouchAttack: "crouch_attack",
  Dashing: "dashing",
} as const;
```

#### State Transition Table

| From State | → To State | Trigger | Guard |
|-----------|-----------|---------|-------|
| Idle | Walking | moveLeft/moveRight input | — |
| Idle | Jumping | jump input | isGrounded |
| Idle | Crouching | crouch input | — |
| Idle | Attacking | lightAttack/heavyAttack input | cooldownTimer ≤ 0, SP ≥ cost |
| Idle | Blocking | block input | — |
| Walking | Idle | Release move input | — |
| Walking | Jumping | jump input | isGrounded |
| Walking | Attacking | attack input | cooldownTimer ≤ 0, SP ≥ cost |
| Walking | Blocking | block input | — |
| Crouching | Idle | Release crouch | — |
| Crouching | CrouchAttack | attack input | cooldownTimer ≤ 0, SP ≥ cost |
| Jumping | Idle | On land (y ≥ GROUND_Y) | Must be grounded |
| Jumping | Attacking | attack input (air) | cooldownTimer ≤ 0 |
| Attacking | Idle | Recovery frames complete | Cannot interrupt |
| Blocking | Idle | Release block | — |
| Hitstun | Idle | hitstunFrames ≤ 0 | — |
| Dashing | Idle | Dash frames complete | — |
| Any | KO | HP ≤ 0 | Terminal state |

#### Forbidden Transitions (Enforced in Fighter.ts)

- Cannot attack during hitstun (state check in `handleIdle`, `handleWalking`, etc.)
- Cannot block during attack recovery (attacking state ignores inputs)
- Cannot jump during attack (attacking state ignores jump)
- Cannot special without sufficient SP (SP cost checked before `startSpecial()`)
- Cannot crouch during jump (jumping state ignores crouch)

### 3.3 Round State Machine

```typescript
// Defined in RoundManager.ts
export enum RoundPhase {
  Intro = "intro",        // "ROUND 1 — FIGHT!" announcement
  Fighting = "fighting",  // Active combat — timer counting
  KO = "ko",              // KO animation + slow-motion
  RoundEnd = "roundEnd",  // Round result; check match winner
  MatchEnd = "matchEnd",  // Match decided (best-of-3)
}
```

```
                 ┌──────────┐
        ┌───────►│  INTRO   │
        │        └────┬─────┘
        │             │ introDuration (1500ms)
        │        ┌────▼─────┐
        │   ┌───►│ FIGHTING │◄───┐
        │   │    └────┬─────┘    │
        │   │         │ KO       │ next round
        │   │    ┌────▼─────┐    │
        │   │    │    KO    │    │
        │   │    └────┬─────┘    │
        │   │         │ roundEndDuration (2000ms)
        │   │    ┌────▼──────┐   │
        │   └────┤ ROUND END │───┘
        │        └────┬──────┘
        │             │ match decided (2+ wins)
        │        ┌────▼──────┐
        └────────┤ MATCH END │
                 └───────────┘
```

### 3.4 Cross-Scene Communication Patterns

**Pattern 1: EventBus (pub/sub)** — for game events during combat

```typescript
// Emitted by CombatSystem:
EventBus.emit("damage", { target, attacker, damage, counterHit, comboCount, moveId });
EventBus.emit("ko", { loser, winner });
EventBus.emit("block", { target, attacker });
EventBus.emit("perfectBlock", { target });
EventBus.emit("guardBreak", { target });
EventBus.emit("throw", { attacker, target, damage });

// Emitted by RoundManager:
EventBus.emit("roundStart", { round });
EventBus.emit("fightStart", {});
EventBus.emit("roundEnd", { round, p1Wins, p2Wins, winner });
EventBus.emit("matchEnd", { winner, p1Wins, p2Wins });
EventBus.emit("timerTick", { time });
EventBus.emit("timeUp", {});

// Emitted by GameScene:
EventBus.emit("gameplayStart", {});
EventBus.emit("gameplayStop", {});
EventBus.emit("upgradeSelected", { upgrade: { id } });

// Emitted by Fighter:
EventBus.emit("stateChange", { player, state });
EventBus.emit("hit", { x, y, direction, color });
EventBus.emit("specialStart", { player });

// Listeners: FightOverlay, CameraSystem, ParticleSystem, AudioManager, ComboTracker
```

**Pattern 2: Scene.data (Phaser built-in)** — for scene transitions

```typescript
// CharacterSelect → GameScene
this.scene.start(SceneKey.Game, {
  mode: "gauntlet",
  playerCharacter: "rex",
  saveSystem: this.saveSystem,
  device: this.device,
  gauntletFight: 1,
});

// GameScene → Results
this.scene.start(SceneKey.Results, {
  won: true,
  roundsWon: 2,
  roundsLost: 1,
  gauntletFight: 3,
  totalFights: 5,
  saveSystem: this.saveSystem,
  device: this.device,
  playerCharacter: "rex",
});
```

**Pattern 3: Phaser.Registry** — for session-wide singletons

```typescript
// Set in Boot.ts:
this.registry.set("device", device);
this.registry.set("saveSystem", saveSystem);

// Read in any scene:
const saveSystem = this.registry.get("saveSystem") as SaveSystem;
const device = this.registry.get("device") as DeviceInfo;
```

### 3.5 Persistent Save State

```typescript
// Defined in SaveSystem.ts
interface SaveData {
  version: number;          // CURRENT_VERSION = 1
  level: number;            // Player level (starts at 1)
  xp: number;               // Total XP earned
  coins: number;            // Currency for shop (Phase 2)
  unlockedCharacters: string[];  // ["rex", "volt", "titan", "luna"] at start
  unlockedSkins: string[];       // Empty at start
  highScores: Record<string, number>;
  settings: {
    sfxVolume: number;      // 0-1, default 0.8
    musicVolume: number;    // 0-1, default 0.6
    touchEnabled: boolean;  // false by default
  };
  stats: {
    totalMatches: number;
    totalWins: number;
    totalKOs: number;
    bestGauntletRun: number;
  };
  lastLogin: string;        // ISO date string
}
```

**Save/Load Flow:**
1. `SaveSystem` constructor calls `load()` → reads localStorage → parses JSON → validates version
2. If version mismatch → resets to defaults (no migration logic yet)
3. If parse fails → `available = false`, game continues without save
4. Every mutation (`addXp`, `addCoins`, `spendCoins`, etc.) calls `save()` immediately
5. `save()` wraps `localStorage.setItem` in try/catch for quota errors

---

## 4. Data Flows

### 4.1 Per-Frame Combat Loop

The core data flow runs every frame (target: 60fps):

```
┌─────────────────────────────────────────────────────────────────┐
│                      FRAME UPDATE (60fps)                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. EARLY EXIT CHECK                                             │
│     if (isPaused || roundPhase !== Fighting) → skip to step 8   │
│                                                                  │
│  2. INPUT CAPTURE                                                │
│     Keyboard/Touch ──► InputManager.update() ──► GameAction[]    │
│     (raw inputs)         (normalize + buffer)    (actions)       │
│                                                                  │
│  3. AI DECISION (if vs CPU)                                      │
│     Fighter state + Distance ──► AISystem.update() ──► GameAction│
│     (self + opponent context)   (decision tree)       (AI action)│
│                                                                  │
│  4. FACING UPDATE                                                │
│     p1.updateFacing(p2.x) — flip sprite if opponent crosses      │
│     p2.updateFacing(p1.x) — skip during attack states           │
│                                                                  │
│  5. ENTITY UPDATE                                                │
│     p1.update(delta, p1Actions) ──► FSM transition + velocity    │
│     p2.update(delta, p2Actions) ──► FSM transition + velocity    │
│     Each update: timers → gravity → SP regen → state handler →   │
│                  apply velocity → clamp position → update sprite │
│                                                                  │
│  6. COMBAT RESOLUTION                                            │
│     For each attacking fighter:                                  │
│       isActiveFrame(moveId, frame)?                              │
│       → CombatSystem.checkHit(attacker, defender, moveId)        │
│         → AABB hitbox ∩ hurtbox overlap check                   │
│         → Resolve: hit/blocked/counter-hit/perfect-block         │
│         → Apply damage, hitstun, knockback                       │
│         → Emit events (damage, ko, block, perfectBlock, etc.)    │
│                                                                  │
│  7. COMBO RESET CHECK                                            │
│     if (comboTracker.shouldReset(time)) → reset                  │
│                                                                  │
│  8. CAMERA UPDATE                                                │
│     CameraSystem.update(time, delta, [p1, p2])                   │
│     → Follow midpoint, apply shake, zoom, slow-motion            │
│                                                                  │
│  9. RENDER (Phaser automatic)                                    │
│     Fighter sprites + Stage + Particles ──► WebGL Renderer       │
│                                                                  │
│  10. OVERLAY UPDATE                                              │
│      FightOverlay.update() ──► HP/SP bars sync with fighter HP   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.2 Input → Action Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────┐
│  RAW INPUT       │────►│  INPUT MANAGER    │────►│  GAME ACTION │
│                  │     │                  │     │              │
│ Keyboard P1:     │     │ Normalize:       │     │ moveLeft     │
│  A/D → move      │     │  keyboard code → │     │ moveRight    │
│  W → jump        │     │  GameAction      │     │ jump         │
│  S → crouch      │     │                  │     │ crouch       │
│  J → lightAtk    │     │ Buffer:          │     │ lightAttack  │
│  K → heavyAtk    │     │  12-frame ring   │     │ heavyAttack  │
│  L → block       │     │  buffer for      │     │ block        │
│  Space → special │     │  attack buffering│     │ special      │
│                  │     │                  │     │              │
│ Keyboard P2:     │     │ Repeat filter:   │     │              │
│  Arrows → move   │     │  move/crouch =   │     │              │
│  Numpad 1/2/3    │     │  repeatable;     │     │              │
│  Numpad 0        │     │  attacks = 1-press│    │              │
│                  │     │                  │     │              │
│ Touch (mobile):  │     │ Per-device:      │     │              │
│  Left half:      │     │  auto-detect     │     │              │
│   virtual joy    │     │  keyboard OR     │     │              │
│  Right half:     │     │  touch, not both │     │              │
│   4 buttons      │     │                  │     │              │
└─────────────────┘     └──────────────────┘     └──────┬───────┘
                                                        │
                     ┌──────────────────────────────────┘
                     ▼
             ┌──────────────┐
             │   FIGHTER    │
             │   FSM        │
             │              │
             │  State +     │
             │  Action →    │
             │  Transition  │
             │  → Velocity  │
             │  → Position  │
             └──────────────┘
```

### 4.3 Damage Calculation Flow

```
Attack Active Frame
    │
    ▼
┌─────────────────────────┐
│ AABB Overlap Check       │
│ hitbox(attacker) ∩       │
│ hurtbox(defender)        │
├──────┬──────────────────┤
│ MISS │ HIT              │
│      │                  │
│ done │                  │
│      ▼                  │
│ ┌─────────────────────┐│
│ │ Is defender blocking?││
│ ├──────┬──────────────┤│
│ │ NO   │ YES          ││
│ │      │              ││
│ │      ▼              ││
│ │ ┌───────────────┐   ││
│ │ │ Perfect Block? │   ││
│ │ │ (4-frame wind) │   ││
│ │ ├──┬────────────┤   ││
│ │ │YES│ NO        │   ││
│ │ │  │            │   ││
│ │ │  ▼            │   ││
│ │ │ Block:        │   ││
│ │ │ dmg = 0       │   ││
│ │ │ SP -= 5×bs    │   ││
│ │ │               │   ││
│ │ │ SP ≤ 0?       │   ││
│ │ │ → Guard Break │   ││
│ │ │   (30 frames) │   ││
│ │ └───────────────┘   ││
│ │                     ││
│ │ PGuard:             ││
│ │ dmg = 0             ││
│ │ SP += 10 refund     ││
│ │ +4 frame advantage  ││
│ └─────────────────────┘│
│                         │
│                         ▼
│ ┌──────────────────────────┐
│ │ Full Damage Applied      │
│ │                          │
│ │ 1. Counter-hit check:    │
│ │    if defender attacking │
│ │    → damage × 1.25       │
│ │                          │
│ │ 2. Combo scaling:        │
│ │    damage × scaling[idx] │
│ │    [1.0, 0.9, 0.8, 0.7, │
│ │     0.6, 0.6, 0.6]      │
│ │                          │
│ │ 3. Apply to defender:    │
│ │    HP -= finalDamage     │
│ │    Enter hitstun state   │
│ │    Apply knockback       │
│ │    Increment combo count │
│ │                          │
│ │ 4. Emit events:          │
│ │    "damage" → HUD, FX    │
│ │    "hit" → particles     │
│ │    "heavyHit" → shake    │
│ │                          │
│ │ 5. HP ≤ 0?               │
│ │    → KO state            │
│ │    → "ko" event          │
│ │    → RoundManager.onKO() │
│ └──────────────────────────┘
```

### 4.4 Gauntlet Run Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    GAUNTLET RUN LIFECYCLE                         │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  MainMenu ──► CharacterSelect ──► GameScene (Fight 1)            │
│                │                    │                             │
│                │ select char        │ Win: UpgradeSelect          │
│                │                    │ Lose: Results               │
│                ▼                    ▼                             │
│          GameStartData ──► GameScene.init(data) + create()       │
│          { mode,            {                                    │
│            character,         mode: 'gauntlet',                  │
│            saveSystem,        playerCharacter: 'rex',            │
│            device,            saveSystem, device,                │
│            gauntletFight }    gauntletFight: 1,                  │
│                               activeUpgrades: []                 │
│                             }                                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ FIGHT LOOP (per gauntlet fight):                         │    │
│  │                                                          │    │
│  │  1. GameScene.create():                                  │    │
│  │     - Spawn random stage                                 │    │
│  │     - Create P1 (player) + P2 (AI opponent) fighters    │    │
│  │     - Set AI difficulty based on gauntletFight number    │    │
│  │     - Compose all 8 systems                              │    │
│  │     - Launch FightOverlay (parallel scene)               │    │
│  │     - Start RoundManager                                 │    │
│  │                                                          │    │
│  │  2. Round loop (best-of-3):                              │    │
│  │     Round 1 → Round 2 → Round 3 (if needed)             │    │
│  │                                                          │    │
│  │  3. Match end → EventBus "matchEnd" event                │    │
│  │     → GameScene.endMatch(winner)                         │    │
│  │                                                          │    │
│  │  If Win + fight < 5:                                     │    │
│  │    → UpgradeSelect (pick 1 of 3 power-ups)              │    │
│  │    → "upgradeSelected" event → apply upgrade             │    │
│  │    → GameScene.scene.restart(fight+1, activeUpgrades)   │    │
│  │                                                          │    │
│  │  If Win + fight = 5:                                     │    │
│  │    → Results (run complete)                              │    │
│  │                                                          │    │
│  │  If Lose (any fight):                                    │    │
│  │    → Results (run failed)                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  Results ──► SaveSystem.addXp() + addCoins() + incrementStat()  │
│           ──► Check calculateLevel() → LevelUp (if new level)   │
│           ──► MainMenu / CharacterSelect                         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 4.5 Scene Transition Map

```
Boot ──────────► Preloader ──────────► MainMenu
                                          │
                     ┌────────────────────┤
                     │                    │
                     ▼                    ▼
              CharacterSelect       Quick Match
                     │                    │
                     └────────┬───────────┘
                              │
                              ▼
                           GameScene ◄───────────────────┐
                          │    │    │                     │
                     ┌────┘    │    └────┐                │
                     ▼         ▼         ▼                │
               FightOverlay  PauseMenu  UpgradeSelect ───┘
                              │         (restarts GameScene)
                              │
                              ▼
                           MainMenu   Results
                                         │
                                    ┌────┘
                                    ▼
                                 LevelUp
                                    │
                                    ▼
                                 MainMenu
```

---

## 5. Build Configuration

### 5.1 Webpack Architecture

```
configs/
├── webpack.common.js    Shared config (entry, output, plugins, rules)
├── webpack.dev.js       Dev config (source maps, HMR, dev server)
└── webpack.prod.js      Prod config (minify, extract CSS, optimize)
```

**Path resolution:**
- `__base` = project root (`/arcade-fighter`)
- `__src` = `src/`

### 5.2 Entry & Output

| Property | Dev | Prod |
|----------|-----|------|
| **Entry** | `src/index.ts` | `src/index.ts` |
| **Output** | `build/app.bundle.js` | `build/app.bundle.js` |
| **Mode** | `development` | `production` |
| **Source maps** | `inline-source-map` | `false` |
| **Minification** | None | Webpack built-in + CssMinimizerPlugin |

### 5.3 Module Rules

| Rule | Test | Dev Loader | Prod Loader | Output Path |
|------|------|-----------|-------------|-------------|
| TypeScript | `/\.ts$/` | `ts-loader` | `ts-loader` | — |
| CSS | `/\.css$/` | `style-loader` + `css-loader` | `MiniCssExtractPlugin.loader` + `css-loader` | `css/main.css` |
| Images | `/\.png\|jpe?g\|gif\|svg$/i` | `asset/resource` | `asset/resource` | `assets/images/[name]-[hash:4][ext]` |
| Audio | `/\.ogg\|mp3$/i` | `asset/resource` | `asset/resource` | `assets/audio/[name]-[hash:4][ext]` |
| Fonts | `/\.woff(2)?\|ttf\|otf\|eot\|svg$/` | `asset/resource` | `asset/resource` | `assets/fonts/[name]-[hash:4].[ext]` |

### 5.4 Plugins

| Plugin | Dev | Prod | Purpose |
|--------|-----|------|---------|
| `HtmlWebpackPlugin` | ✅ | ✅ | Generate index.html with title "Battle Brawl" |
| `CopyWebpackPlugin` | ✅ | ✅ | Copy `public/assets/` to `build/` |
| `CleanWebpackPlugin` | ✅ | ✅ | Clean build dir + remove LICENSE.txt |
| `MiniCssExtractPlugin` | ❌ | ✅ | Extract CSS to separate file |
| `CssMinimizerPlugin` | ❌ | ✅ | Minify CSS |
| `TsconfigPathsPlugin` | ✅ | ✅ | Resolve `@/*` path aliases |

### 5.5 Dev Server

| Setting | Value |
|---------|-------|
| Port | 9100 |
| Static | `./build` |
| HMR | Enabled |
| Client overlay | Enabled (shows errors on screen) |

### 5.6 TypeScript Configuration

**tsconfig.json (dev):**
- `target: ES2020`, `module: ES2020`, `strict: true`
- Path alias: `@/*` → `src/*`
- `sourceMap: true`

**tsconfig.prod.json (production):**
- Extends tsconfig.json
- `removeComments: true`, `declaration: false`, `sourceMap: false`

### 5.7 Asset Budget

| Category | Estimated Size | Budget |
|----------|---------------|--------|
| Character sprites (8 × atlas) | ~3.5MB | — |
| Stage backgrounds (3 × 3 layers) | ~400KB | — |
| UI elements (atlas) | ~200KB | — |
| Audio SFX (20 files, OGG+MP3) | ~800KB | — |
| Music (3 tracks, OGG) | ~1.5MB | — |
| Phaser 3.90 (minified) | ~600KB | — |
| JS bundle (game code, minified) | ~400KB | — |
| HTML/CSS | ~50KB | — |
| **TOTAL** | **~7.45MB** | **≤ 8MB** |

**Current state:** Build is 1.3MB without game assets. With assets, projected ~7.5MB — within budget.

### 5.8 Build Verification Commands

```bash
# Type checking (must pass with zero errors)
npm run typecheck

# Production build
npm run build

# Check build size (must be ≤ 8MB)
du -sh build/
```

---

## 6. Risk Register

### 6.1 Technical Risks

| # | Risk | Severity | Probability | Impact | Mitigation | Validation |
|---|------|----------|-------------|--------|------------|------------|
| T1 | **Build exceeds 8MB Poki limit** | HIGH | MEDIUM | Cannot publish on Poki | Texture atlases; WebP for stage BGs; OGG-only initially; measure build size every increment | `du -sh build/` after each increment |
| T2 | **Touch controls feel imprecise on mobile** | HIGH | HIGH | Poor mobile UX; 62–81% of traffic is mobile | 64px joystick base, 40px stick, 16px dead zone; 48px minimum buttons; test on real devices early | Physical device testing in Increment 13 |
| T3 | **Frame drops on low-end mobile** | HIGH | MEDIUM | Unplayable on budget devices | Sprite atlases (1 draw call per character); reduce particles on low-end; target 30fps fallback; `DeviceDetector` perf tier | Performance profiling in Increment 14 |
| T4 | **Combo system too complex for casuals** | MEDIUM | MEDIUM | High skill floor deters casual players | Auto-combo for basic chains (L→L→H); generous 12-frame buffer window; visual feedback on timing; difficulty tiers scale AI complexity | Playtest with non-gamers |
| T5 | **AI feels unfair or too easy** | MEDIUM | MEDIUM | Poor single-player experience | 5 difficulty tiers with clear scaling; Boss AI uses character-specific mechanics; tuning passes after each increment; Constants.ts numbers easy to adjust | Playtest each difficulty tier |
| T6 | **State machine bugs (forbidden transitions)** | MEDIUM | MEDIUM | Fighter gets stuck in invalid state | Forbidden transition guards (checked in each state handler); exhaustive state switch in update(); state validation | State transition verification |
| T7 | **Poki SDK integration breaks game** | HIGH | LOW | Cannot publish on primary portal | SDK calls stubbed with `if (window.PokiSDK)` checks; game fully playable without SDK; test with/without SDK | Integration test in Increment 14 |
| T8 | **Audio autoplay blocked by browsers** | MEDIUM | HIGH | No sound on first interaction | Phaser's AudioContext unlock on first user input; SFX only after player interaction; music starts after first click/tap | Test on Chrome, Safari, Firefox |
| T9 | **EventBus memory leaks from unsubscribed listeners** | MEDIUM | MEDIUM | Memory grows during long sessions | EventBus listeners attached in `create()` should be cleaned in `shutdown()` or `destroy()`; audit listener cleanup | Memory profiling during extended play |

### 6.2 Design Risks

| # | Risk | Severity | Probability | Impact | Mitigation | Validation |
|---|------|----------|-------------|--------|------------|------------|
| D1 | **No dominant browser fighter = no proven market** | HIGH | N/A | Market may be smaller than estimated | Validate with Poki/CrazyGames submission data; iterate based on portal analytics (retention, session length) | Portal feedback post-launch |
| D2 | **Stickman Kombat 2D adds online multiplayer** | HIGH | LOW | Primary competitor gains our key differentiator | Ship our MVP fast; establish portal presence first; our Phase 2 online targets portals (their weakness) | Monitor competitor updates |
| D3 | **New Phaser fighter launches on Poki/CrazyGames** | HIGH | MEDIUM | Increased competition in our window | Ship fast (8–10 week MVP); build community; distinctive art; first-mover on portals | Monitor portal new releases |
| D4 | **Ragdoll physics overtakes skill-based fighters** | MEDIUM | MEDIUM | Player preference shifts to physics-based games | Include ragdoll elements (KO animations); maintain skill ceiling; monitor Ragdoll Hit trends | Track Ragdoll Hit votes/growth |
| D5 | **AAA F2P comes to browser (2XKO model)** | MEDIUM | LOW | High-production competitor enters browser space | Differentiate via accessibility, session length, roguelite loop; these don't port well to 5-min sessions | Long-term monitoring |

### 6.3 Platform Risks

| # | Risk | Severity | Probability | Impact | Mitigation | Validation |
|---|------|----------|-------------|--------|------------|------------|
| P1 | **Poki rejects submission** | HIGH | MEDIUM | No distribution on primary portal | Follow Poki checklist exactly (GDD §9.3); test all requirements pre-submit; iterate on feedback | Pre-submission audit against checklist |
| P2 | **CrazyGames slow approval** | MEDIUM | MEDIUM | Delayed secondary distribution | Submit early; use Basic Launch first (no SDK needed); iterate to Full Launch | Track approval timeline |
| P3 | **localStorage unavailable (incognito)** | MEDIUM | LOW | Player progress lost | SaveSystem wraps all localStorage in try/catch; game works without save; display "Save unavailable" indicator | Test in incognito mode |
| P4 | **Ad blocker blocks game functionality** | MEDIUM | LOW | Game partially broken | Game fully playable without ads; SDK calls are optional; no ad-dependent game mechanics | Test with popular ad blockers |
| P5 | **External requests blocked by portal** | HIGH | LOW | Game fails to load | All assets bundled; no CDN; no external fonts; no analytics services; zero external fetches | Network tab verification |

### 6.4 Timeline Risks

| # | Risk | Severity | Probability | Impact | Mitigation | Validation |
|---|------|----------|-------------|--------|------------|------------|
| TL1 | **185 engineering hours exceeds estimate** | MEDIUM | HIGH | MVP delayed beyond 8–10 weeks | 14 clear increments with acceptance criteria; parallel work possible (systems + UI); cut Settings/Shop for MVP | Track hours per increment |
| TL2 | **Art assets not ready** | HIGH | MEDIUM | Cannot proceed past Increment 5 (characters) | Create placeholder sprites (colored rectangles) for all development; final art is a separate track | Placeholder assets in Increment 1 |
| TL3 | **Audio assets not ready** | MEDIUM | MEDIUM | No sound in early testing | Use free placeholder SFX; final audio is a separate track | Placeholder audio in Increment 1 |
| TL4 | **Scope creep from Phase 2 features** | MEDIUM | HIGH | MVP delayed; features added prematurely | Strict MoSCoW prioritization; Phase 2 (online, IAP, shop) explicitly excluded from MVP scope | Feature checklist review |

### 6.5 Risk Response Priority

| Priority | Risk | Action Required |
|----------|------|----------------|
| 1 | T1 (Build > 8MB) | Measure build size from Increment 1; optimize proactively |
| 2 | T2 (Touch controls) | Design touch layout first; test on real devices by Increment 3 |
| 3 | T3 (Frame drops) | Profile on low-end device from Increment 5; degrade gracefully |
| 4 | P1 (Poki rejection) | Use Poki checklist as acceptance criteria for every increment |
| 5 | TL2 (Art assets) | Establish placeholder asset pipeline before any visual work |
| 6 | D3 (New competitor) | Ship MVP within 8–10 weeks; establish portal presence early |
| 7 | T8 (Audio autoplay) | Implement Phaser AudioContext unlock pattern from day one |
| 8 | T9 (EventBus leaks) | Audit listener cleanup in scene shutdown/destroy methods |

---

## 7. Network Architecture (Phase 2 — Reference)

### 7.1 Overview

Online multiplayer uses **Colyseus** for authoritative server-side game simulation with client-side prediction.

```
┌──────────────────────────────────────────────────────────────────┐
│                     PHASE 2 NETWORK ARCHITECTURE                 │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐         WebSocket          ┌─────────────┐ │
│  │    CLIENT        │◄═══════════════════════►   │   SERVER     │ │
│  │  (Phaser 3.90)   │    Colyseus Protocol      │  (Colyseus   │ │
│  │                  │                            │   + Node.js) │ │
│  │  • Input capture │   Send: inputs (60Hz)      │              │ │
│  │  • Prediction    │   Recv: game state (20Hz)  │  • Room mgmt │ │
│  │  • Interpolation │                            │  • Game sim  │ │
│  │  • Rendering     │                            │  • Matchmake │ │
│  └─────────────────┘                            │  • Validate  │ │
│                                                  └─────────────┘ │
│  ┌─────────────────┐                            ┌─────────────┐ │
│  │   MATCHMAKER     │◄═══════════════════════►  │   DATABASE   │ │
│  │  (Colyseus)      │                            │  (SQLite/    │ │
│  │                  │                            │   PostgreSQL)│ │
│  │  • Queue mgmt    │                            │              │ │
│  │  • Skill rating  │                            │  • Accounts  │ │
│  │  • Region select │                            │  • ELO/MMR   │ │
│  └─────────────────┘                            └─────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

### 7.2 Sync Strategy

| Layer | Frequency | Method | Notes |
|---|---|---|---|
| **Inputs** | 60Hz | Client → Server | Raw directional + action inputs |
| **Game State** | 20Hz | Server → Client | Authoritative positions, HP, SP, state |
| **Physics** | Server-authoritative | Colyseus room state | Collision resolved on server only |
| **Matchmaking** | On-demand | Colyseus matchmaker | ELO-based pairing ±150 range |

### 7.3 Deployment

```
┌──────────────────────────────────────────┐
│            CLOUDFLARE / AWS               │
│                                           │
│  ┌─────────────┐  ┌─────────────────┐    │
│  │   Colyseus   │  │  Static Assets   │    │
│  │   Server     │  │  (CDN)           │    │
│  │  (Node.js)   │  │  Phaser bundle   │    │
│  │  WebSocket   │  │                  │    │
│  └─────────────┘  └─────────────────┘    │
│       │                                   │
│  ┌────▼──────────┐                       │
│  │   Database     │                       │
│  │  (PostgreSQL)  │                       │
│  └───────────────┘                       │
└──────────────────────────────────────────┘
```

---

*Technical Architecture Document v2.0 — September 14, 2026*
*Audited against all 44 source files. Covers: modular structure (44 files, 7 layers), state management (4 layers + 2 FSMs), data flows (per-frame combat loop + gauntlet lifecycle + damage resolution), build configuration (Webpack 5.110 + asset budget ≤ 8MB), and risk register (18 risks across 4 categories).*
