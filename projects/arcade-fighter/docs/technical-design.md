# Technical Design Document: Battle Brawl

**Version:** 1.0
**Date:** September 14, 2026
**Status:** Authoritative technical plan — translates GDD v1.1 into concrete file changes, modules, implementation increments, and acceptance criteria.
**Source:** game-design-document.md v1.1, game-concept.md v3

---

## Table of Contents

1. [Current State Assessment](#1-current-state-assessment)
2. [Target Architecture](#2-target-architecture)
3. [Module Dependency Map](#3-module-dependency-map)
4. [File Manifest — All Changes](#4-file-manifest--all-changes)
5. [Implementation Increments](#5-implementation-increments)
6. [Data Structures](#6-data-structures)
7. [Acceptance Criteria](#7-acceptance-criteria)
8. [Build & Config Changes](#8-build--config-changes)
9. [Asset Pipeline](#9-asset-pipeline)
10. [Risk Mitigations](#10-risk-mitigations)

---

## 1. Current State Assessment

### 1.1 Existing Files

```
/home/asila/game-factory/ai-factory/projects/arcade-fighter/
├── configs/
│   ├── webpack.common.js        ✅ Exists — needs audio rule + sprite atlas support
│   ├── webpack.dev.js           ✅ Exists — no changes needed
│   └── webpack.prod.js          ✅ Exists — no changes needed
├── public/
│   └── assets/images/           ✅ Exists — empty, needs all game assets
├── src/
│   ├── game/
│   │   └── scenes/
│   │       ├── Scenes.ts        ✅ Exists — needs 8 more SceneKeys
│   │       ├── Boot.ts          ✅ Exists — needs device detection + registry init
│   │       ├── Preloader.ts     ✅ Exists — needs asset loading + Poki SDK
│   │       ├── MainMenu.ts      ✅ Exists — needs full menu UI
│   │       └── GameScene.ts     ✅ Exists — needs complete combat loop
│   ├── html/
│   │   ├── css/main.css         ✅ Exists — no changes needed
│   │   └── index.html           ✅ Exists — title needs update
│   └── index.ts                 ✅ Exists — needs config factory refactor
├── package.json                 ✅ Exists — needs @poki/sdk (Phase 1.5)
├── tsconfig.json                ✅ Exists — no changes needed
└── tsconfig.prod.json           ✅ Exists — no changes needed
```

### 1.2 Gap Analysis

| Category | Current | Required (MVP) | Delta |
|----------|---------|-----------------|-------|
| Scenes | 4 | 12 | +8 new scenes |
| Systems | 0 | 8 | +8 new modules |
| Entities | 0 | 5 (base + 4 fighters) | +5 new modules |
| Data | 0 | 6 | +6 new data files |
| UI Components | 0 | 5 | +5 new modules |
| Utilities | 0 | 4 | +4 new modules |
| Config | 1 (PhaserConfig embedded) | 2 | +1 config module |
| **Total new files** | | | **~45 new TypeScript files** |
| **Total modified files** | | | **~6 existing files** |

---

## 2. Target Architecture

### 2.1 Full Directory Tree (MVP)

```
src/
├── index.ts                          [MODIFY] Entry point — use config factory
├── html/
│   ├── index.html                    [MODIFY] Update title to "Battle Brawl"
│   └── css/main.css                  [NO CHANGE]
│
├── game/
│   ├── config/
│   │   └── PhaserConfig.ts           [NEW] Game config factory
│   │
│   ├── scenes/
│   │   ├── Scenes.ts                 [MODIFY] Expand enum to 12 keys
│   │   ├── Boot.ts                   [MODIFY] Device detection + save init
│   │   ├── Preloader.ts              [MODIFY] Load all assets + Poki SDK
│   │   ├── MainMenu.ts               [MODIFY] Full menu UI
│   │   ├── CharacterSelect.ts        [NEW] Character selection screen
│   │   ├── Settings.ts               [NEW] Settings menu (Phase 1.5)
│   │   ├── GameScene.ts              [MODIFY] Full combat loop
│   │   ├── FightOverlay.ts           [NEW] HUD parallel scene
│   │   ├── PauseMenu.ts              [NEW] Pause overlay
│   │   ├── UpgradeSelect.ts          [NEW] Roguelite upgrade picker
│   │   ├── Results.ts                [NEW] Score/XP/coins results
│   │   └── LevelUp.ts               [NEW] Level-up celebration
│   │
│   ├── systems/
│   │   ├── InputManager.ts           [NEW] Unified input abstraction
│   │   ├── CombatSystem.ts           [NEW] Hitbox/hurtbox, damage, blocking
│   │   ├── AISystem.ts               [NEW] AI decision tree, 5 tiers
│   │   ├── CameraSystem.ts           [NEW] Follow, shake, zoom, transitions
│   │   ├── RoundManager.ts           [NEW] Best-of-3, win conditions
│   │   ├── ComboTracker.ts           [NEW] Combo counting + events
│   │   ├── ParticleSystem.ts         [NEW] Hit effects, ambient particles
│   │   └── AudioManager.ts           [NEW] SFX, music, cross-fade
│   │
│   ├── entities/
│   │   ├── Fighter.ts                [NEW] Base fighter class + state machine
│   │   ├── fighters/
│   │   │   ├── Rex.ts               [NEW] Balanced fighter
│   │   │   ├── Volt.ts              [NEW] Rushdown fighter
│   │   │   ├── Titan.ts             [NEW] Grappler fighter
│   │   │   └── Luna.ts              [NEW] Zoner fighter
│   │   └── Stage.ts                  [NEW] Stage renderer
│   │
│   ├── data/
│   │   ├── characters.ts             [NEW] Character stats, frame data
│   │   ├── moves.ts                  [NEW] Move definitions
│   │   ├── stages.ts                 [NEW] Stage metadata
│   │   ├── upgrades.ts               [NEW] Power-up definitions (12)
│   │   ├── progression.ts            [NEW] XP curve, level rewards
│   │   └── shop.ts                   [NEW] Shop catalog (Phase 2)
│   │
│   ├── ui/
│   │   ├── HPBar.ts                  [NEW] Health bar component
│   │   ├── SPBar.ts                  [NEW] Stamina bar component
│   │   ├── Button.ts                 [NEW] Reusable button component
│   │   ├── UpgradeCard.ts            [NEW] Upgrade selection card
│   │   └── ComboCounter.ts           [NEW] Combo display component
│   │
│   └── utils/
│       ├── SaveSystem.ts             [NEW] localStorage with incognito fallback
│       ├── EventBus.ts               [NEW] Cross-scene pub/sub
│       ├── Constants.ts              [NEW] Game balance numbers
│       └── DeviceDetector.ts         [NEW] Touch, tablet, perf tier

public/assets/
├── images/
│   ├── characters/                   [NEW] Sprite atlases + portraits
│   │   ├── rex/ (atlas PNG + JSON + portrait)
│   │   ├── volt/
│   │   ├── titan/
│   │   └── luna/
│   ├── stages/                       [NEW] Parallax backgrounds
│   │   ├── neon-arena/ (bg-far, bg-mid, bg-near)
│   │   ├── rooftop/
│   │   └── dojo/
│   ├── ui/                           [NEW] HUD, menus, buttons atlases
│   └── effects/                      [NEW] Particles, hit effects
├── audio/
│   ├── sfx/                          [NEW] 20 SFX files (OGG + MP3)
│   └── music/                        [NEW] 4 music tracks (OGG)
└── fonts/                            [NEW] Custom font (if needed)
```

### 2.2 Module Communication Diagram

```
┌──────────────────────────────────────────────────────────────────────┐
│                         SCENE LAYER                                  │
│                                                                      │
│  Boot ──► Preloader ──► MainMenu ──► CharacterSelect ──► GameScene   │
│                                    ◄── Settings        │    │       │
│                                                         │    │       │
│                                          ┌──────────────┘    │       │
│                                          ▼                   ▼       │
│                                    FightOverlay        PauseMenu     │
│                                    (parallel)          (parallel)    │
│                                          │                          │
│                                          ▼                          │
│                               UpgradeSelect ──► Results ──► LevelUp  │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       SYSTEM LAYER (used by GameScene)                │
│                                                                      │
│  InputManager ──► [actions] ──► Fighter.stateMachine                 │
│                    │                    │                             │
│                    ▼                    ▼                             │
│              AISystem          CombatSystem ──► EventBus              │
│                                                  │                   │
│                               ComboTracker ◄─────┤                   │
│                               ParticleSystem ◄───┤                   │
│                               CameraSystem ◄─────┤                   │
│                               RoundManager ◄─────┤                   │
│                               AudioManager ◄─────┘                   │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                        DATA LAYER (static, imported)                  │
│                                                                      │
│  characters.ts ──► Fighter.ts, AISystem                              │
│  moves.ts ──► CombatSystem                                            │
│  stages.ts ──► Stage.ts, GameScene                                   │
│  upgrades.ts ──► UpgradeSelect                                       │
│  progression.ts ──► Results, LevelUp, SaveSystem                     │
│                                                                      │
├──────────────────────────────────────────────────────────────────────┤
│                       UTIL LAYER (shared)                             │
│                                                                      │
│  EventBus ◄──► All scenes (pub/sub)                                  │
│  SaveSystem ◄──► Progression, Settings                               │
│  Constants ◄──► All systems                                          │
│  DeviceDetector ◄──► Boot, InputManager, Touch controls              │
│                                                                      │
└──────────────────────────────────────────────────────────────────────┘
```

---

## 3. Module Dependency Map

```
Increment 1 (Foundation):    Utils → Data → Config → EventBus → SaveSystem → DeviceDetector
                              ↓
Increment 2 (Input):         InputManager (depends on: DeviceDetector, Constants, EventBus)
                              ↓
Increment 3 (Fighter):       Fighter base (depends on: InputManager, Constants, EventBus, moves.ts, characters.ts)
                              ↓
Increment 4 (Combat):        CombatSystem + ComboTracker (depends on: Fighter, moves.ts, EventBus)
                              ↓
Increment 5 (Characters):    Rex, Volt, Titan, Luna (depends on: Fighter base, characters.ts, moves.ts)
                              ↓
Increment 6 (AI):            AISystem (depends on: Fighter, InputManager, characters.ts, Constants)
                              ↓
Increment 7 (Visuals):       CameraSystem + ParticleSystem (depends on: EventBus, Constants)
                              ↓
Increment 8 (Audio):         AudioManager (depends on: EventBus, Constants)
                              ↓
Increment 9 (Rounds):        RoundManager (depends on: Fighter, EventBus, Constants)
                              ↓
Increment 10 (Stages):       Stage (depends on: stages.ts, EventBus)
                              ↓
Increment 11 (Scenes):       GameScene refactor (depends on: all systems)
                              FightOverlay, PauseMenu, CharacterSelect, UpgradeSelect, Results, LevelUp
                              ↓
Increment 12 (Progression):  XP/Coins, LevelUp, SaveSystem integration
                              ↓
Increment 13 (Polish):       Visual juice package, touch controls finalization
                              ↓
Increment 14 (Integration):  Poki SDK, asset optimization, build verification
```

---

## 4. File Manifest — All Changes

### 4.1 Files to MODIFY (6 files)

| File | Change Description | Effort |
|------|--------------------|--------|
| `src/index.ts` | Import `createGameConfig` from `PhaserConfig.ts`; replace inline config with factory call | 0.5h |
| `src/game/scenes/Scenes.ts` | Add 8 new SceneKey values: CharacterSelect, Settings, Game (existing), FightOverlay, PauseMenu, UpgradeSelect, Results, LevelUp | 0.5h |
| `src/game/scenes/Boot.ts` | Add device detection, save system init, store in registry; transition to Preloader | 2h |
| `src/game/scenes/Preloader.ts` | Add all asset loading (character atlases, stages, UI, audio); add Poki SDK callback; keep progress bar | 4h |
| `src/game/scenes/MainMenu.ts` | Full menu: title logo, PLAY/QUICK MATCH/SETTINGS buttons, player level + coins display | 6h |
| `src/game/scenes/GameScene.ts` | Complete rewrite: spawn stage, create fighters, run combat loop, manage rounds, emit events | 20h |
| `src/html/index.html` | Change `<title>` from "Phaser Game" to "Battle Brawl" | 5min |

### 4.2 Files to CREATE — Utils (4 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/utils/Constants.ts` | All balance numbers: gravity, frame data, damage values, dimensions, colors | 3h |
| `src/game/utils/EventBus.ts` | Singleton Phaser.Events.EventEmitter for cross-scene communication | 1h |
| `src/game/utils/SaveSystem.ts` | localStorage read/write with try/catch for incognito; save progress, settings, scores | 3h |
| `src/game/utils/DeviceDetector.ts` | Detect touch/tablet/desktop; return device info object; force-touch on tablets | 1h |

### 4.3 Files to CREATE — Config (1 file)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/config/PhaserConfig.ts` | `createGameConfig(parent, options?)` factory returning Phaser.GameConfig with physics, input, scale | 2h |

### 4.4 Files to CREATE — Data (6 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/data/characters.ts` | Character definitions: id, name, archetype, stats (HP/SP/speed/damage), special move ref, unlock requirements | 4h |
| `src/game/data/moves.ts` | Move definitions: damage, startup, active, recovery, stamina cost, hitbox dimensions, combo properties | 4h |
| `src/game/data/stages.ts` | Stage definitions: id, name, theme, parallax layers, ambient effects, music track, bounds | 2h |
| `src/game/data/upgrades.ts` | 12 power-up definitions: id, name, effect type, value, rarity weight, description | 3h |
| `src/game/data/progression.ts` | XP curve formula, level rewards table, unlock requirements, coin earn rates | 2h |
| `src/game/data/shop.ts` | Shop item catalog (Phase 2 placeholder) | 1h |

### 4.5 Files to CREATE — Systems (8 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/systems/InputManager.ts` | Unified input: keyboard mapping (P1/P2), gamepad polling, touch integration; 12-frame input buffer; action-based API | 8h |
| `src/game/systems/CombatSystem.ts` | Hitbox/hurtbox collision detection, damage calculation, blocking logic, perfect block, guard break, throw, counter-hit, stamina management | 16h |
| `src/game/systems/AISystem.ts` | Decision tree: range check, attack/block/approach; 5 difficulty tiers with scaling reaction time and combo knowledge | 10h |
| `src/game/systems/CameraSystem.ts` | Follow midpoint between fighters, clamp to bounds; screen shake (intensity+duration+decay); zoom for specials/finishers | 4h |
| `src/game/systems/RoundManager.ts` | Best-of-3 state machine; round timer (99s); win conditions; simultaneous KO handling; match end detection | 4h |
| `src/game/systems/ComboTracker.ts` | Track consecutive hits; timing window (8 frames); combo counter events; bonus XP triggers | 3h |
| `src/game/systems/ParticleSystem.ts` | Hit particles (8-12 per hit); ambient stage particles; KO burst; uses Phaser particle emitter | 3h |
| `src/game/systems/AudioManager.ts` | SFX playback (spatial); music cross-fade between stages; volume controls; mute during ads (Poki) | 4h |

### 4.6 Files to CREATE — Entities (6 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/entities/Fighter.ts` | Base Fighter class: Phaser.Sprite wrapper, state machine (FSM), stats, hitbox/hurtbox rects, facing, animation controller, damage handling, stamina | 16h |
| `src/game/entities/fighters/Rex.ts` | Balanced fighter: Power Strike special (mid-range shockwave), stats from characters.ts | 3h |
| `src/game/entities/fighters/Volt.ts` | Rushdown fighter: Lightning Dash special (pass-through), fast stats | 3h |
| `src/game/entities/fighters/Titan.ts` | Grappler fighter: Earth Slam special (ground pound), armor on heavy | 3h |
| `src/game/entities/fighters/Luna.ts` | Zoner fighter: Lunar Beam special (full-screen projectile), projectile entity | 4h |
| `src/game/entities/Stage.ts` | Stage renderer: parallax backgrounds, ground plane, boundaries, ambient effects | 4h |

### 4.7 Files to CREATE — UI (5 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/ui/HPBar.ts` | Health bar: smooth fill animation, flash on damage, P1/P2 mirrored layout | 2h |
| `src/game/ui/SPBar.ts` | Stamina bar: similar to HP but faster animation, different color | 1h |
| `src/game/ui/Button.ts` | Reusable button: text + background, hover/press states, pointer events, scale tween | 2h |
| `src/game/ui/UpgradeCard.ts` | Upgrade card: icon + name + description, hover highlight, select animation | 2h |
| `src/game/ui/ComboCounter.ts` | Combo display: large animated number, color escalation (white→yellow→red→purple), shake on increment | 2h |

### 4.8 Files to CREATE — Scenes (8 files)

| File | Purpose | Effort |
|------|---------|--------|
| `src/game/scenes/CharacterSelect.ts` | 8-character grid (4 starter + 4 locked), preview animation, stats display, SELECT/BACK buttons | 6h |
| `src/game/scenes/Settings.ts` | Audio volume sliders, touch toggle, control info display | 3h |
| `src/game/scenes/FightOverlay.ts` | Parallel scene: HP bars, SP bars, round indicators, combo counter, round announcements ("ROUND 1 — FIGHT!"), KO text | 6h |
| `src/game/scenes/PauseMenu.ts` | Overlay: RESUME, SETTINGS, QUIT buttons; pause game loop; ESC to unpause | 2h |
| `src/game/scenes/UpgradeSelect.ts` | 3 upgrade cards, random selection from pool, pick 1, apply to current run | 4h |
| `src/game/scenes/Results.ts` | Score, XP earned, coins earned, play again / main menu buttons; optional rewarded ad | 4h |
| `src/game/scenes/LevelUp.ts` | Level-up celebration: new level display, unlock reveal, continue button | 3h |

### 4.9 Summary — Total Effort

| Category | Files | Estimated Hours |
|----------|-------|-----------------|
| Modify existing | 6 | ~37h |
| Utils | 4 | ~8h |
| Config | 1 | ~2h |
| Data | 6 | ~16h |
| Systems | 8 | ~52h |
| Entities | 6 | ~33h |
| UI | 5 | ~9h |
| Scenes (new) | 8 | ~28h |
| **TOTAL** | **44** | **~185h** |

---

## 5. Implementation Increments

### Increment 1: Foundation (Days 1–2) — ~14h

**Goal:** Establish the foundational layer that all other modules depend on.

**Files to create/modify:**
1. `src/game/utils/Constants.ts` — All game balance numbers
2. `src/game/utils/EventBus.ts` — Cross-scene event emitter
3. `src/game/utils/SaveSystem.ts` — localStorage persistence
4. `src/game/utils/DeviceDetector.ts` — Touch/tablet detection
5. `src/game/config/PhaserConfig.ts` — Game config factory
6. `src/game/data/characters.ts` — Character stat definitions
7. `src/game/data/moves.ts` — Move/frame data definitions
8. `src/game/data/stages.ts` — Stage metadata
9. `src/game/data/upgrades.ts` — 12 power-up definitions
10. `src/game/data/progression.ts` — XP/level/coin formulas
11. `src/index.ts` — Refactor to use config factory
12. `src/game/scenes/Scenes.ts` — Expand enum
13. `src/game/scenes/Boot.ts` — Device detection + save init

**Dependencies:** None (this is the foundation).
**Verification:** `npm run typecheck` passes. `npm run build` succeeds. Game boots and transitions to Preloader.

### Increment 2: Input System (Day 3) — ~8h

**Goal:** Unified input abstraction that produces game actions from any input device.

**Files to create:**
1. `src/game/systems/InputManager.ts` — Full implementation

**Files to modify:**
1. `src/game/scenes/Boot.ts` — Initialize InputManager, pass to registry

**Dependencies:** Increment 1 (Constants, DeviceDetector, EventBus).
**Verification:** Keyboard inputs map to actions; touch inputs map to same actions; input buffer works; no raw input leaks to game code.

### Increment 3: Fighter Base (Days 4–6) — ~16h

**Goal:** A fully functional Fighter entity with state machine, stats, and animation control.

**Files to create:**
1. `src/game/entities/Fighter.ts` — Base class with FSM, stats, hitbox/hurtbox

**Dependencies:** Increment 1 (Constants, EventBus, characters.ts, moves.ts), Increment 2 (InputManager).
**Verification:** Fighter can idle, walk, jump, crouch, attack (light/heavy), block, take damage, be KO'd. State transitions are valid (no forbidden transitions). Fighter stays within bounds.

### Increment 4: Combat System (Days 7–10) — ~19h

**Goal:** Hitbox collision, damage, blocking, perfect block, combos, stamina.

**Files to create:**
1. `src/game/systems/CombatSystem.ts` — Collision + damage + blocking
2. `src/game/systems/ComboTracker.ts` — Combo counting + timing
3. `src/game/systems/RoundManager.ts` — Round state machine

**Dependencies:** Increment 3 (Fighter), Increment 1 (Constants, EventBus, moves.ts).
**Verification:** Light/heavy attacks deal correct damage; blocking reduces damage to 0; perfect block refunds stamina; guard break at 0 stamina; L→L→H chains work; combo counter increments; best-of-3 rounds function; timer expiry works.

### Increment 5: Starter Characters (Days 11–13) — ~13h

**Goal:** 4 distinct playable fighters with unique mechanics.

**Files to create:**
1. `src/game/entities/fighters/Rex.ts`
2. `src/game/entities/fighters/Volt.ts`
3. `src/game/entities/fighters/Titan.ts`
4. `src/game/entities/fighters/Luna.ts`

**Dependencies:** Increment 3 (Fighter base), Increment 4 (CombatSystem), Increment 1 (characters.ts, moves.ts).
**Verification:** Each character has unique stats, unique special move, different visual placeholder. Rex = balanced, Volt = fast/weak, Titan = slow/strong, Luna = projectile.

### Increment 6: AI System (Days 14–16) — ~10h

**Goal:** AI opponent with 5 difficulty tiers.

**Files to create:**
1. `src/game/systems/AISystem.ts` — Full decision tree

**Dependencies:** Increment 3 (Fighter), Increment 2 (InputManager), Increment 1 (characters.ts, Constants).
**Verification:** Novice rarely blocks, uses random attacks. Boss reads patterns, uses frame traps. Difficulty scales across gauntlet fights. AI does not cheat at lower tiers.

### Increment 7: Visual Effects (Days 17–18) — ~7h

**Goal:** Camera system and particle effects that create "juice."

**Files to create:**
1. `src/game/systems/CameraSystem.ts`
2. `src/game/systems/ParticleSystem.ts`

**Dependencies:** Increment 1 (Constants, EventBus).
**Verification:** Camera follows fighters between bounds; screen shakes on heavy hits (4-8px, 150-300ms); zooms on specials (1.1x); KO triggers slow-motion (0.3x, 500ms). Hit particles burst in attack direction.

### Increment 8: Audio (Day 19) — ~4h

**Goal:** Sound effects and music playback.

**Files to create:**
1. `src/game/systems/AudioManager.ts`

**Dependencies:** Increment 1 (Constants, EventBus).
**Verification:** Hit SFX plays on attack connect; music plays per stage; volume controls work; mute function available.

### Increment 9: Stage System (Day 20) — ~4h

**Goal:** Render stage backgrounds with parallax and boundaries.

**Files to create:**
1. `src/game/entities/Stage.ts`

**Dependencies:** Increment 1 (stages.ts, Constants).
**Verification:** 3 parallax layers scroll with camera; ground plane exists; stage boundaries prevent fighter exit; ambient particles visible.

### Increment 10: UI Components (Days 21–22) — ~9h

**Goal:** Reusable UI building blocks for all screens.

**Files to create:**
1. `src/game/ui/HPBar.ts`
2. `src/game/ui/SPBar.ts`
3. `src/game/ui/Button.ts`
4. `src/game/ui/UpgradeCard.ts`
5. `src/game/ui/ComboCounter.ts`

**Dependencies:** Increment 1 (Constants, EventBus).
**Verification:** HP/SP bars animate smoothly on damage; buttons have hover/press states; upgrade cards display correctly; combo counter scales with color.

### Increment 11: Scene Assembly (Days 23–27) — ~34h

**Goal:** All remaining scenes wired together.

**Files to create:**
1. `src/game/scenes/CharacterSelect.ts`
2. `src/game/scenes/FightOverlay.ts`
3. `src/game/scenes/PauseMenu.ts`
4. `src/game/scenes/UpgradeSelect.ts`
5. `src/game/scenes/Results.ts`
6. `src/game/scenes/LevelUp.ts`

**Files to modify:**
1. `src/game/scenes/Preloader.ts` — Load all assets
2. `src/game/scenes/MainMenu.ts` — Full menu UI
3. `src/game/scenes/GameScene.ts` — Full combat loop integration
4. `src/html/index.html` — Update title

**Dependencies:** All previous increments.
**Verification:** Full flow: Boot → Preloader → MainMenu → CharacterSelect → Game → FightOverlay → UpgradeSelect → Results → MainMenu. Pause works. Quick Match works. All transitions smooth.

### Increment 12: Progression (Days 28–29) — ~6h

**Goal:** XP, leveling, coins, save persistence.

**Files to modify:**
1. `src/game/scenes/Results.ts` — Display XP/coins earned
2. `src/game/scenes/LevelUp.ts` — Show unlock
3. `src/game/scenes/MainMenu.ts` — Display level/coins

**Dependencies:** Increment 1 (progression.ts, SaveSystem), Increment 11 (scenes).
**Verification:** XP earned per match; levels up at threshold; coins accumulate; progress saves to localStorage; progress loads on refresh.

### Increment 13: Polish (Days 30–32) — ~8h

**Goal:** Visual juice, touch control refinement, edge cases.

**Changes:**
- Visual juice package: hit flash (2 frames white), screen shake, hit-stop (2-4 frames), floating damage numbers, slow-mo KO, camera zoom on specials
- Touch controls: 48px minimum targets, joystick dead zone (16px), auto-show on touch devices, force on tablets
- Edge cases: simultaneous KO, gamepad disconnect pause, visibilitychange auto-pause, localStorage full fallback

**Dependencies:** All previous increments.
**Verification:** All visual effects trigger correctly; touch controls feel responsive on mobile; edge cases handled per GDD §2.5.

### Increment 14: Integration & Optimization (Days 33–35) — ~10h

**Goal:** Portal submission readiness.

**Changes:**
- Poki SDK integration: `@poki/phaser-3` plugin; gameLoadingFinished, gameplayStart/Stop, commercialBreak, rewardedBreak
- Asset optimization: texture atlases, OGG+MP3 audio, total build ≤ 8MB
- Build verification: `npm run typecheck` zero errors, `npm run build` succeeds, `du -sh build/` ≤ 8MB
- Browser testing: Chrome, Safari, Firefox; desktop + mobile
- Performance: 60fps desktop, 30fps mobile low-end

**Dependencies:** All previous increments.
**Verification:** Poki SDK calls fire at correct moments; build size ≤ 8MB; no console errors; 60fps on desktop Chrome; touch works on iOS Safari + Android Chrome.

---

## 6. Data Structures

### 6.1 Fighter State Machine

```typescript
enum FighterState {
  Idle = "idle",
  Walking = "walking",
  Jumping = "jumping",
  Crouching = "crouching",
  Attacking = "attacking",
  Blocking = "blocking",
  Hitstun = "hitstun",
  KO = "ko",
  CrouchAttack = "crouch_attack",
}
```

### 6.2 Fighter Interface

```typescript
interface FighterStats {
  id: string;
  name: string;
  archetype: string;
  hp: number;          // 85-120
  sp: number;          // 80-110
  walkSpeed: number;   // 160-250 px/sec
  jumpVelocity: number; // 500-650 px/sec
  lightDamage: number; // 5-8
  heavyDamage: number; // 12-20
  specialDamage: number; // 20-30
  specialCost: number; // 35-50 SP
  specialName: string;
  unlockLevel: number; // 1 for starters, 5/10/20/30 for unlockables
}
```

### 6.3 Move Data

```typescript
interface MoveData {
  id: string;
  name: string;
  damage: number;
  startup: number;     // frames
  active: number;      // frames
  recovery: number;    // frames
  staminaCost: number;
  hitboxWidth: number;
  hitboxHeight: number;
  range: number;       // px horizontal reach
  properties: string[]; // "launch", "projectile", "armor", "unblockable"
}
```

### 6.4 Upgrade Definition

```typescript
interface Upgrade {
  id: string;
  name: string;
  description: string;
  effectType: "damage" | "speed" | "health" | "stamina" | "combo" | "block" | "counter" | "heal" | "special";
  effectValue: number;
  rarityWeight: number; // percentage
}
```

### 6.5 Saved Progress

```typescript
interface SaveData {
  version: number;
  level: number;
  xp: number;
  coins: number;
  unlockedCharacters: string[];
  unlockedSkins: string[];
  highScores: Record<string, number>;
  settings: {
    sfxVolume: number;
    musicVolume: number;
    touchEnabled: boolean;
  };
  stats: {
    totalMatches: number;
    totalWins: number;
    totalKOs: number;
    bestGauntletRun: number;
  };
  lastLogin: string; // ISO date
}
```

### 6.6 Game Mode Data

```typescript
type GameMode = "gauntlet" | "quickmatch" | "local2p";

interface GameStartData {
  mode: GameMode;
  playerCharacter: string;
  opponentCharacter?: string;  // random if omitted
  stage?: string;              // random if omitted
  gauntletFight?: number;      // 1-5 for gauntlet mode
}
```

### 6.7 Input Actions

```typescript
type GameAction =
  | "moveLeft"
  | "moveRight"
  | "jump"
  | "crouch"
  | "lightAttack"
  | "heavyAttack"
  | "block"
  | "special"
  | "pause";
```

---

## 7. Acceptance Criteria

### 7.1 Per-Increment Acceptance Criteria

#### Increment 1: Foundation
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` produces a working bundle
- [ ] Game boots and shows Preloader (even with no assets)
- [ ] EventBus can send/receive events between any two scenes
- [ ] SaveSystem writes/reads localStorage with try/catch
- [ ] DeviceDetector correctly identifies touch vs desktop
- [ ] All 12 SceneKeys are registered in Scenes.ts

#### Increment 2: Input System
- [ ] Keyboard P1 (WASD + JKL) maps to GameAction enum correctly
- [ ] Touch joystick produces moveLeft/moveRight/moveUp actions
- [ ] Touch buttons produce lightAttack/heavyAttack/block actions
- [ ] Input buffer stores last 12 frames of inputs
- [ ] Buffered inputs execute on first available frame
- [ ] No input lag > 1 frame between raw input and action dispatch
- [ ] Simultaneous P1 + P2 inputs supported (local 2P mode)

#### Increment 3: Fighter Base
- [ ] Fighter can transition through all 9 states
- [ ] No forbidden state transitions (e.g., attack during hitstun)
- [ ] Health and stamina decrease correctly on damage/block
- [ ] Stamina regenerates at 8 SP/sec when not blocking
- [ ] Fighter sprite reflects current state (correct animation key)
- [ ] Fighter cannot leave stage boundaries (800×400 play area)
- [ ] Facing direction flips based on opponent position

#### Increment 4: Combat System
- [ ] Light attack: 5-8 damage, 6-frame startup, 0 stamina cost
- [ ] Heavy attack: 12-18 damage, 12-frame startup, 15 stamina cost
- [ ] Block: reduces incoming damage to 0; drains 5 SP/frame
- [ ] Perfect block (4-frame window): refunds 10 stamina + 4-frame advantage
- [ ] Guard break at 0 stamina: 30-frame stagger
- [ ] Counter-hit (during opponent attack startup): +25% damage
- [ ] L→L→H chains correctly with 8-frame timing window
- [ ] Combo counter increments and displays on-screen
- [ ] Best-of-3 rounds function correctly
- [ ] 99-second round timer; higher HP% wins on expiry

#### Increment 5: Starter Characters
- [ ] Rex: HP 100, SP 100, Power Strike special (25 dmg, 40 SP)
- [ ] Volt: HP 85, SP 90, Lightning Dash special (20 dmg, 35 SP)
- [ ] Titan: HP 120, SP 80, Earth Slam special (30 dmg, 50 SP)
- [ ] Luna: HP 90, SP 110, Lunar Beam special (22 dmg, 45 SP)
- [ ] Each character has at least 8 unique animations
- [ ] Special moves have unique visual behavior (shockwave, dash, ground pound, projectile)

#### Increment 6: AI System
- [ ] Novice (Fight 1): reaction 500ms, rarely blocks, no combos
- [ ] Easy (Fight 2): reaction 350ms, blocks sometimes, 2-hit combos
- [ ] Medium (Fight 3): reaction 200ms, blocks frequently, 3-hit combos
- [ ] Hard (Fight 4): reaction 100ms, reads patterns, 4+ hit combos
- [ ] Boss (Fight 5): reaction 80ms, adaptive, full combos, frame traps
- [ ] AI does not cheat at Novice/Easy (no input reads, no frame-perfect reactions)
- [ ] Boss AI uses character-specific signature mechanics

#### Increment 7: Visual Effects
- [ ] Camera follows midpoint between fighters
- [ ] Screen shake: 4-8px intensity, 150-300ms duration, exponential decay
- [ ] Camera zoom: 1.1x for 300ms during special startup
- [ ] KO finish: 1.3x zoom over 500ms with 0.3x speed slow-motion
- [ ] Hit particles: 8-12 particles in attack direction per hit
- [ ] Hit flash: character sprite turns white for 2 frames on hit

#### Increment 8: Audio
- [ ] SFX plays on: light hit, heavy hit, block, special, KO, menu click
- [ ] Music plays per stage (cross-fades between stages)
- [ ] Volume sliders for SFX and music
- [ ] Mute function available (for Poki ad integration)

#### Increment 9: Stage System
- [ ] 3 parallax layers render per stage
- [ ] Ground plane at y=400 within 800×400 play area
- [ ] Stage boundaries prevent fighter exit
- [ ] Ambient particles visible (rain for Neon Arena, wind for Rooftop, dust for Dojo)
- [ ] Each stage loads correct background images and music

#### Increment 10: UI Components
- [ ] HP bar: smooth fill animation, flash on damage, P1/P2 mirrored
- [ ] SP bar: similar to HP, different color, faster animation
- [ ] Button: text + background, hover/press visual states, pointer events
- [ ] UpgradeCard: name + description + hover highlight + select animation
- [ ] ComboCounter: animated number, color escalation at 3/5/8/12 hits

#### Increment 11: Scene Assembly
- [ ] Full flow: Boot → Preloader → MainMenu → CharacterSelect → Game → FightOverlay → Results → MainMenu
- [ ] Gauntlet flow: Game → UpgradeSelect (after wins) → Game → Results
- [ ] Pause: ESC opens PauseMenu, RESUME/QUIT work correctly
- [ ] Quick Match: random character + stage, single fight
- [ ] Character Select: 4 starters visible, 4 locked shown with requirements
- [ ] Results screen: score, XP, coins, play again / menu buttons
- [ ] All transitions smooth (fade/slide animations per GDD §5.3)

#### Increment 12: Progression
- [ ] XP earned: 50/round, 100/match, 300/run completion
- [ ] Level formula: `XP_for_level_N = N × 200`
- [ ] Coins earned: 10/round, 25/match, 50/run
- [ ] Unlock check: Level 5 → Blaze, Level 10 → Frost, Level 20 → Shadow, Level 30 → Astra
- [ ] Progress persists across page refreshes (localStorage)
- [ ] Incognito mode: game works without save (try/catch)

#### Increment 13: Polish
- [ ] Hit flash (2 frames white) triggers on all attack connects
- [ ] Hit-stop (2-4 frames) freezes both characters on hit
- [ ] Floating damage numbers: rise 60px, fade over 500ms
- [ ] Touch controls: all targets ≥ 48px, joystick 64px base / 40px stick
- [ ] Auto-show touch controls on touch devices; force on tablets
- [ ] visibilitychange event auto-pauses game
- [ ] Gamepad disconnect triggers pause + "Reconnect" prompt
- [ ] localStorage full: silent fail, "Save unavailable" indicator

#### Increment 14: Integration
- [ ] Poki SDK: `gameLoadingFinished()` after Preloader
- [ ] Poki SDK: `gameplayStart()` when fight begins
- [ ] Poki SDK: `gameplayStop()` when fight ends/pauses
- [ ] Poki SDK: `commercialBreak()` between runs
- [ ] Poki SDK: `rewardedBreak()` available for "Double coins"
- [ ] Total build output ≤ 8MB (`du -sh build/`)
- [ ] Load time < 3s on simulated 4G
- [ ] Zero console errors during full play session
- [ ] 60fps on desktop Chrome
- [ ] Touch controls work on iOS Safari and Android Chrome
- [ ] `npm run typecheck` passes with zero errors
- [ ] `npm run build` succeeds without errors

### 7.2 Poki Submission Checklist

| # | Requirement | GDD Ref | Verification Method |
|---|-------------|---------|---------------------|
| 1 | 16:9 aspect ratio | §7.7 | Check PhaserConfig: 1280×720 + Scale.FIT |
| 2 | Desktop support | §3.1 | Keyboard P1 (WASD+JKL) + gamepad |
| 3 | Mobile support | §3.2 | Touch controls auto-appear |
| 4 | Tablet force-touch | §3.1 | DeviceDetector + force-touch logic |
| 5 | < 8MB initial load | §6.2 | `du -sh build/` |
| 6 | No external requests | §10.7 | Network tab: zero external fetches |
| 7 | Incognito mode | §2.5 | localStorage try/catch in SaveSystem |
| 8 | Ad blocker safe | §10.7 | Game fully playable without SDK |
| 9 | SDK events correct | §10.7 | Poki SDK calls at documented points |
| 10 | Audio mute during ads | §10.7 | AudioManager.mute() hook |
| 11 | Skippable sequences | §5.3 | All announcements/animations skip on tap |
| 12 | Streamlined entry | §1.3 | < 10s from MainMenu to first fight |

---

## 8. Build & Config Changes

### 8.1 `configs/webpack.common.js` — MODIFY

**Changes needed:**
1. Add audio file rule (OGG/MP3) for copying to build output
2. Add JSON rule for sprite atlas JSON files (already handled by default, but verify)
3. Add copy pattern for audio files from `public/assets/audio/`

```javascript
// Add to module.rules:
{
  test: /\.(ogg|mp3)$/i,
  type: 'asset/resource',
  generator: {
    filename: 'assets/audio/[name]-[hash:4][ext]'
  }
}

// Add to CopyWebpackPlugin patterns:
{
  from: 'assets/audio/**/*',
  context: path.resolve(__base, 'public'),
  to: './'
}
```

### 8.2 `src/html/index.html` — MODIFY

**Change:** `<title>Phaser Game</title>` → `<title>Battle Brawl</title>`

### 8.3 `package.json` — NO CHANGE (MVP)

The Poki SDK (`@poki/phaser-3`) is added in Increment 14 (Integration). For MVP, all SDK calls are stubbed with `if (window.PokiSDK)` checks. No new npm dependencies required for MVP.

---

## 9. Asset Pipeline

### 9.1 Asset Creation Order

| Priority | Asset Type | Count | Est. Size | Notes |
|----------|-----------|-------|-----------|-------|
| 1 | Placeholder sprites (colored rectangles) | 4 characters × 10 anims | ~200KB | For development/testing |
| 2 | Placeholder stages (solid color + simple parallax) | 3 stages × 3 layers | ~100KB | For development/testing |
| 3 | UI placeholder elements | 1 atlas | ~50KB | HP bars, buttons, text |
| 4 | Placeholder SFX | 6 core SFX | ~100KB | Hit, block, special, KO, menu |
| 5 | Final character sprites (atlas PNG + JSON) | 4 characters | ~2MB | Artist deliverable |
| 6 | Final stage backgrounds (WebP) | 9 images | ~600KB | Artist deliverable |
| 7 | Final UI assets (atlas PNG + JSON) | 3 atlases | ~300KB | Artist deliverable |
| 8 | Final SFX (OGG + MP3) | 20 files | ~800KB | Audio deliverable |
| 9 | Final music (OGG) | 4 tracks | ~2MB | Audio deliverable |

### 9.2 Asset Loading Order (Preloader)

```
1. Character atlases (4 × ~500KB) = ~2MB
2. Stage backgrounds (9 × ~67KB) = ~600KB
3. UI atlases (3 × ~100KB) = ~300KB
4. SFX (20 × ~40KB) = ~800KB
5. Music (4 × ~500KB) = ~2MB
─────────────────────────────────
Total: ~5.7MB + Phaser (~600KB) + JS bundle (~400KB) = ~6.7MB
Target: ≤ 8MB ✅
```

---

## 10. Risk Mitigations

| Risk | Severity | Mitigation | Validation |
|------|----------|------------|------------|
| Touch controls feel imprecise | HIGH | Use 64px joystick base, 40px stick, 16px dead zone; test on real devices early | Physical device testing in Increment 13 |
| Build exceeds 8MB | MEDIUM | Texture atlases; WebP for stage BGs; OGG-only initially; lazy-load music | Measure build size every increment |
- [ ] All 4 characters playable: select and fight as each

---

## 10. Risk Mitigations

| # | Risk | Mitigation | Verification |
|---|------|------------|--------------|
| R1 | Touch controls imprecise | 64px joystick base; 16px dead zone; 48px buttons; test on real devices | Physical device test in Increment 13 |
| R2 | Build > 8MB | Texture atlases; WebP backgrounds; OGG-only initially; measure each increment | `du -sh build/` after each increment |
| R3 | AI feels wrong | Tuning passes after each increment; easy to adjust Constants.ts numbers | Playtest each difficulty tier |
| R4 | Combo system too complex | Auto-combo for basic chains; 8-frame window (generous); visual feedback | Playtest with non-gamers |
| R5 | Frame drops on mobile | Sprite atlases (1 draw call per character); reduce particles on low-end; target 30fps fallback | Performance profiling in Increment 14 |
| R6 | State machine bugs | Forbidden transition guards with console.warn; exhaustive state switch checks | Unit-style verification in Increment 3 |

---

## Appendix A: Increment Gantt Summary

```
WEEK 1: ████ Inc 1 (Foundation) ████ Inc 2 (Input) ████ Inc 3 (Fighter start)
WEEK 2: ████ Inc 3 (Fighter end) ████ Inc 4 (Combat)
WEEK 3: ████ Inc 5 (Characters) ████ Inc 6 (AI)
WEEK 4: ████ Inc 7 (Visuals) ████ Inc 8 (Audio) ████ Inc 9 (Stage)
WEEK 5: ████ Inc 10 (UI) ████ Inc 11 (Scenes — start)
WEEK 6: ████ Inc 11 (Scenes — end) ████ Inc 12 (Progression)
WEEK 7: ████ Inc 13 (Polish) ████ Inc 14 (Integration)
```

---

*Technical Design Document v1.0 — September 14, 2026*
*Translates GDD v1.1 into 14 implementation increments across ~45 files, ~185 engineering hours.*
*Code changes to be implemented by subsequent pipeline agents.*
