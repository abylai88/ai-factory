# Game Design Document: Battle Brawl

**Version:** 1.3
**Date:** September 15, 2026
**Status:** Authoritative GDD — MVP (Phase 1) focused, with Phase 2/3 outlines
**Source Documents:** market-analysis-report.md (Sep 15), competitor-analysis.md (Sep 15), game-concept.md (v6), gameplay-mechanics.md (v1.0), technical-architecture.md (v2.0)
**Changelog:** v1.3 — Updated market context with fresh Sep 15 post-analysis verification (mobile fighting $4.31B, 2D fighting $1.77B, season pass benchmarks); v1.2 — Network architecture (Poki Netlib replaces Colyseus), new competitors

---

## Table of Contents

1. [Vision & Identity](#1-vision--identity)
2. [Core Mechanics](#2-core-mechanics)
   - 2.1 Combat Fundamentals
   - 2.2 Visual Feedback ("Juice")
   - 2.3 AI Opponent System
   - 2.4 Fighter State Machine
   - 2.5 Edge Case Handling
3. [Systems](#3-systems)
   - 3.1 Input System — Unified Input Manager
   - 3.2 Touch Controls Layout
   - 3.3 Camera System
   - 3.4 Stage System
4. [Progression](#4-progression)
   - 4.1 Run Structure (Gauntlet Mode)
   - 4.2 Meta-Progression (Across Runs)
   - 4.3 High Score System
5. [UX Flow](#5-ux-flow)
   - 5.1 Complete User Journey Map
   - 5.2 Screen Specifications
   - 5.3 Transition Animations
6. [Content Structure](#6-content-structure)
   - 6.1 Asset Manifest (MVP)
   - 6.2 Total Asset Budget
   - 6.3 File Naming Convention
7. [Phaser Scene Architecture](#7-phaser-scene-architecture)
   - 7.1 Scene Registry
   - 7.2 Scene Flow Diagram
   - 7.3 Scene Responsibilities
   - 7.4 Scene Implementation Architecture
   - 7.5 Core Systems Architecture
   - 7.6 Cross-Scene Communication
   - 7.7 Game Config Factory
   - 7.8 Physics Configuration
   - 7.9 Network Architecture (Phase 2 — Poki Netlib)
8. [Production Priorities](#8-production-priorities)
   - 8.1 MVP Feature Prioritization (MoSCoW)
   - 8.2 Development Timeline
   - 8.3 Risk Register
9. [Acceptance Criteria](#9-acceptance-criteria)
   - 9.1 Feature Acceptance Criteria
   - 9.2 Build & QA Criteria
   - 9.3 Poki Submission Checklist
10. [Appendix](#10-appendix)
    - 10.1 Character Stat Tables
    - 10.2 Upgrade Catalog (12 Power-Ups)
    - 10.3 Level XP Requirements
    - 10.4 Balance Reference Numbers
    - 10.5 Analytics Tracking Plan
    - 10.6 Accessibility Options
    - 10.7 Platform Compliance Matrix
    - 10.8 Market Context (Sep 2026)

---

## 1. Vision & Identity

### 1.1 Vision Statement

**Battle Brawl** is a zero-download browser arcade fighter that combines the accessibility and instant gratification of Poki-style games with genuine fighting game depth. The game delivers 5–12 minute sessions of skill-expressive 1v1 combat through distinctive non-stickman characters, a roguelite progression loop, and mobile-first touch controls — all distributed on the world's largest gaming portals.

### 1.2 Core Pillars

| Pillar | Description | Design Consequence |
|---|---|---|
| **Instant Play** | Zero download, zero install, < 3s to first fight | Streamlined entry; no tutorial walls; learn-by-doing |
| **Distinctive Characters** | Non-stickman fighters with memorable silhouettes and unique mechanics | 8+ characters with different archetypes; visual identity is the #1 differentiator |
| **Satisfying Combat** | Every hit feels impactful; deep combos accessible to casuals | Visual juice (shake, flash, particles, hit-stop); timing-based combo system |
| **Roguelite Gauntlet** | Run-based progression with permanent unlocks fits browser sessions | 3–5 fights per run; upgrades between rounds; one-more-try loop |
| **Mobile-First** | Designed for touch from day one (62–81% of traffic is mobile) | Virtual joystick + buttons; 48px touch targets; tablet force-touch |

### 1.3 Target Experience Metrics

| Metric | Target | Rationale | Sep 2026 Benchmark |
|---|---|---|---|
| Session length | 5–12 min | Poki benchmark: 11–20 min | CrazyGames avg: 30 min |
| Match length | 60–90 sec | Quick, intense, satisfying | 64% of mobile fighting games < 10 min |
| Rounds per run | 3–5 | Full run = one browser session | Poki 11–20 min sessions |
| Time to first fun | < 10 sec | Poki requirement: streamlined entry | 58% choose web for frictionless access |
| Retention D1 | > 30% | Industry average for casual browser games | 37% play multiple times/day |
| Retention D7 | > 10% | Above average for F2P casual | 27% spend $50+/month on gaming |
| Portal rating | > 4.0/5 | Poki/CrazyGames quality threshold | Top fighters: 4.2–4.6 |

---

## 2. Core Mechanics

### 2.1 Combat Fundamentals

#### Health & Stamina

| Resource | Value | Behavior |
|---|---|---|
| **Health (HP)** | 100 per character | Reduced by attacks; reaching 0 = KO |
| **Stamina (SP)** | 100 per character | Regenerates at 8 SP/sec; consumed by heavy attacks, specials, blocks, throws |
| **Rounds** | Best of 3 per match | Round wins displayed on HUD |

#### Attack Types

| Attack | Damage | Startup | Active | Recovery | Stamina Cost | Properties |
|---|---|---|---|---|---|---|
| **Light Attack** | 5–8 | 6 frames | 3 frames | 4 frames | 0 | Fast poke; combo starter; +1 on hit, −2 on block |
| **Heavy Attack** | 12–18 | 12 frames | 4 frames | 8 frames | 15 | Combo ender; −4 on block; launches on counter-hit |
| **Special** | 20–30 | Varies | Varies | Varies | 30–50 | Character-specific signature move; unique properties per fighter |
| **Throw** | 15 | 10 frames | 1 frame | 6 frames | 20 | Unblockable; beats block; close range only |

#### Combo System

| Combo Type | Input Sequence | Description |
|---|---|---|
| **Basic Chain** | L → L → H | Auto-chains on timing; bread-and-butter |
| **Launch Combo** | H (counter-hit) → L (air) → H (air) → slam | Juggle sequence; visually spectacular |
| **Special Cancel** | H → Special | Cancel heavy recovery into special; costs extra stamina |
| **Cross-up** | Jump over opponent → L | Ambiguous overhead; beats crouch block |

**Combo Timing Window:** 8 frames (133ms at 60fps) for true combos; 16 frames (267ms) for links.

**Combo Counter:** Displays on-screen; combos of 5+ grant bonus XP (+25 XP).

#### Blocking System

| Block Type | Input | Blocks | Breaks Against |
|---|---|---|---|
| **Standing Block** | Hold Block + no down | High attacks, throws | Low attacks, grabs |
| **Crouching Block** | Hold Block + down | Low attacks | Overhead attacks, throws |
| **Perfect Block** | Block within 4 frames of impact | Any attack | Nothing (reward: −10 stamina refund + 4-frame advantage) |

**Guard Break:** Blocking drains 5 SP/frame. Reaching 0 SP = guard broken (character staggers for 30 frames, unable to block). Punishes turtling.

#### Movement

| Action | Input | Description |
|---|---|---|
| Walk Left/Right | Joystick left/right | 200px/sec ground speed |
| Jump | Up / Jump button | Single jump; 600px/sec upward velocity; gravity pulls down |
| Crouch | Down | Lowers hurtbox; enables crouch attacks/blocks |
| Dash | Double-tap left/right | 500px/sec burst; 12-frame duration; 30-frame cooldown |
| Back Dash | Double-tap away from opponent | 400px/sec retreat; 8-frame invincibility |

### 2.2 Visual Feedback ("Juice")

| Effect | Trigger | Implementation |
|---|---|---|
| **Hit Flash** | Any attack connects | Character sprite flashes white for 2 frames |
| **Screen Shake** | Heavy hit or special | Camera shake: intensity 4–8px, duration 200ms |
| **Hit Stop** | Any attack connects | Freeze both characters for 2–4 frames (longer on heavy/special) |
| **Particle Burst** | Hit connects | 8–12 particles in hit direction; color matches attacker |
| **Slow Motion** | KO or last-hit finish | 0.5s at 0.3× speed; dramatic zoom on final hit |
| **Camera Zoom** | Special move activation | 1.1× zoom for 300ms during special startup |
| **UI Pop** | Damage dealt | Floating damage number: rises 60px, fades over 500ms |
| **Combo Counter** | 3+ hit combo | Large animated number; color escalates (white → yellow → red → purple) |
| **Round Announcement** | Round start/end | "ROUND 1 — FIGHT!" / "KO!" text with scale animation |

### 2.3 AI Opponent System

#### AI Difficulty Tiers (Gauntlet Progression)

| Tier | Fight # | Behavior | Reaction Time | Combo Knowledge |
|---|---|---|---|---|
| **Novice** | Fight 1 | Random attacks, rarely blocks | 500ms | No combos |
| **Easy** | Fight 2 | Blocks sometimes, uses light attacks | 350ms | 2-hit combos only |
| **Medium** | Fight 3 | Blocks frequently, uses specials | 200ms | 3-hit combos, basic punish |
| **Hard** | Fight 4 | Reads patterns, uses feints | 100ms | 4+ hit combos, anti-airs, mixups |
| **Boss** | Fight 5 | Adaptive AI, signature mechanics | 80ms | Full combos, frame traps, movement reads |

#### AI Decision Tree

```
Every 100ms:
├─ Is player in range? → YES → Can I hit them? → YES → Attack
│                                        → NO → Block/Wait
│                         → NO → Am I far away? → YES → Approach
│                                              → NO → Wait/Jump
├─ Is player attacking? → YES → Block (70% chance) / Counter (20%) / Take hit (10%)
│                → NO → Am I low HP? → YES → Play defensive
│                                → NO → Aggressive approach
├─ Is this a combo opportunity? → YES → Execute learned combo
│                       → NO → Reset to neutral
└─ Special move available? → YES → Use at 30%+ HP advantage → NO → Regular attacks
```

### 2.4 Fighter State Machine

Each fighter operates as a finite state machine (FSM) with strict transition rules. The state determines which actions are available and how inputs are interpreted.

#### State Diagram

```
                         ┌──────────────────────────────────────┐
                         │                                      │
    ┌──────────┐  jump  ┌▼─────────┐  attack  ┌──────────────┐ │
    │          ├───────►│  JUMPING  ├─────────►│   ATTACKING   │ │
    │   IDLE   │        │          │          │ (light/heavy)  │ │
    │          │◄──land─┤          │◄─recover─┤              │ │
    └──┬───┬───┘        └──────────┘          └──────┬───────┘ │
       │   │                                          │         │
  move │   │ block                              hitstop│         │
       │   │                                          │         │
       ▼   ▼                                          ▼         │
  ┌──────────┐  block  ┌──────────┐   hit    ┌──────────────┐  │
  │ WALKING  ├────────►│ BLOCKING ├─────────►│    HITSTUN    │  │
  │          │◄─release┤          │          │              │  │
  └──────────┘         └──────────┘          └──────┬───────┘  │
       │                                            │           │
       │ crouch                                     │ KO        │
       ▼                                            ▼           │
  ┌──────────┐  attack  ┌──────────────┐    ┌──────────────┐   │
  │ CROUCHING├─────────►│ CROUCH_ATTACK├    │      KO      │   │
  │          │◄─recover─┤              │    │  (terminal)   │   │
  └──────────┘          └──────────────┘    └──────────────┘   │
       │                                                       │
       │ jump                                                  │
       └───────────────────────────────────────────────────────┘
```

#### State Definitions

| State | Duration | Available Actions | Input Priority | Animation |
|---|---|---|---|---|
| **Idle** | Indefinite | Walk, Jump, Crouch, Light, Heavy, Block, Special | Move > Attack > Block | Idle loop |
| **Walking** | Indefinite | Jump, Crouch, Light, Heavy, Block, Special, Stop | Move > Attack > Block | Walk cycle |
| **Jumping** | Until land | Air Light, Air Heavy, Air Special | Attack > Direction | Jump rise/fall |
| **Crouching** | Indefinite | Crouch Light, Crouch Heavy, Stand, Jump | Attack > Stand > Jump | Crouch pose |
| **Attacking** | 6–20 frames | Nothing (recovery only) | None | Attack animation |
| **Blocking** | While held | Release block | None (hold to maintain) | Block pose |
| **Hitstun** | 8–20 frames | Nothing | None | Hit reaction |
| **KO** | Terminal | Nothing | None | KO animation |
| **Crouch Attack** | 8–16 frames | Nothing (recovery only) | None | Crouch attack |

#### Valid State Transitions

| From State | → To State | Trigger | Notes |
|---|---|---|---|
| Idle | Walking | Move input | |
| Idle | Jumping | Jump input | |
| Idle | Crouching | Down input | |
| Idle | Attacking | Light/Heavy input | |
| Idle | Blocking | Block input | |
| Walking | Idle | Release move | Deceleration: 100px/sec² |
| Walking | Jumping | Jump input | Preserves horizontal momentum |
| Walking | Attacking | Attack input | |
| Crouching | Idle | Release down | |
| Crouching | Crouch Attack | Attack input | |
| Jumping | Idle | On land | Must be grounded |
| Jumping | Attacking | Attack input (air) | Air attacks allowed |
| Attacking | Idle | Recovery complete | Cannot interrupt attack |
| Blocking | Idle | Release block | |
| Hitstun | Idle | Hitstun expires | Duration: 8–20 frames based on attack |
| Hitstun | KO | HP ≤ 0 | Terminal state |
| Any | KO | HP ≤ 0 | Terminal state |

#### Forbidden Transitions (Guards)

- **Cannot attack during hitstun** — must wait for recovery
- **Cannot block during attack recovery** — committed to action
- **Cannot jump during attack** — grounded commitment
- **Cannot special without 30+ SP** — stamina check before state entry
- **Cannot crouch during jump** — airborne state blocks crouch

### 2.5 Edge Case Handling

| Edge Case | Rule | Rationale |
|---|---|---|
| **Simultaneous KO** | Round is a draw — no round win awarded; both players reset to full HP for next round; if draw occurs on match point (1-1), the round with more remaining HP (from earlier rounds) wins | Avoids ambiguous "who won" feeling; keeps game moving |
| **Timer Expiry (99s)** | Player with higher HP% wins the round; if equal HP, round is a draw | Standard fighting game timeout rule |
| **Both players at 0 HP same frame** | Simultaneous KO rule (above) | Avoids priority-dependent outcomes |
| **Player disconnect (Phase 2 online)** | 15-second reconnect window; if no reconnect, the disconnecting player forfeits | Prevents rage-quit abuse while allowing network blips |
| **Gamepad disconnect** | Pause game; prompt "Reconnect controller"; resume on reconnect | Prevents unfair loss |
| **Browser tab hidden** | Auto-pause via `visibilitychange` event; call `gameplayStop()` | Poki SDK requirement; prevents "free wins" |
| **Browser resize** | Phaser Scale FIT handles automatically; no manual intervention | Phaser handles this natively |
| **localStorage full** | Silently fail; game continues without save; display "Save unavailable" indicator | Poki incognito mode requirement |
| **Multiple rapid inputs** | Input buffer (12 frames) queues last valid input; cancels if new input arrives before buffer expires | Prevents input drops while avoiding input flooding |

---

## 3. Systems

### 3.1 Input System — Unified Input Manager

The game uses an **abstracted input layer** that normalizes keyboard, gamepad, and touch inputs into a single action-based interface. Game code never reads raw inputs — only actions.

```
┌─────────────────────────────────────────────────┐
│              UNIFIED INPUT MANAGER               │
├─────────────────────────────────────────────────┤
│                                                  │
│  Keyboard    →  ┐                               │
│                  ├── Normalized Actions → Game   │
│  Gamepad     →  ┤    (per frame)        Logic   │
│                  │                               │
│  Touch       →  ┘                               │
│  (Virtual Joystick + Buttons)                    │
│                                                  │
└─────────────────────────────────────────────────┘
```

**Action Map:**

| Action | Keyboard P1 | Keyboard P2 | Gamepad | Touch |
|---|---|---|---|---|
| moveLeft | A | ← | Left stick left | Joystick left |
| moveRight | D | → | Left stick right | Joystick right |
| jump | W | ↑ | Button South (A) | Jump button |
| crouch | S | ↓ | Left stick down | Joystick down |
| lightAttack | J | Numpad 1 | Button West (X) | A button |
| heavyAttack | K | Numpad 2 | Button North (Y) | B button |
| block | L | Numpad 3 | Button East (B) | Block button |
| special | Space | Numpad 0 | Left trigger | Special button (Phase 2) |
| pause | ESC | ESC | Start | Pause icon |

**Input Buffer:** 12-frame buffer (200ms) for buffered inputs. Allows players to input attacks slightly early and have them come out on the first available frame.

**Touch Detection:** `Phaser.Input.Touch` events or `navigator.maxTouchPoints > 0`. Touch controls shown only on touch devices. On tablets, always force touch controls (Poki requirement).

### 3.2 Touch Controls Layout

```
┌──────────────────────────────────────────────┐
│                                              │
│  ┌──────────┐              ┌──────────┐     │
│  │ P1 HP/SP │              │ P2 HP/SP │     │
│  └──────────┘              └──────────┘     │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│  ┌────────────┐              ┌────┬────┐    │
│  │  ← │ →    │              │  A │  B │    │
│  │    ↑      │              ├────┴────┤    │
│  │  JUMP     │              │ BLOCK   │    │
│  └────────────┘              └─────────┘    │
└──────────────────────────────────────────────┘
```

**Specifications:**
- Joystick zone: Left 50% of screen (20% top padding for UI)
- Button zone: Right 50% of screen
- Joystick base: 64px radius, 30% opacity white
- Joystick stick: 40px radius, 60% opacity white, 16px dead zone
- All buttons: 48px minimum (Apple HIG compliance)
- Button opacity: 40% idle, 80% pressed
- No input on top 20% of screen (reserved for HUD)

### 3.3 Camera System

| Camera Behavior | Trigger | Parameters |
|---|---|---|
| **Follow players** | During combat | Camera centers between both players; clamped to stage bounds |
| **Zoom to 1.0×** | Default | Standard view |
| **Zoom to 1.1×** | Special move activation | Smooth zoom over 200ms |
| **Zoom to 1.3×** | KO finish | Slow zoom over 500ms during KO animation |
| **Screen shake** | Heavy hit / special | Intensity: 4–8px, duration: 150–300ms, decay: exponential |
| **Pan to center** | Round start | Smooth pan from last KO position to center |

### 3.4 Stage System

Each stage has the following structure:

```
Stage
├─ Background (parallax layers, 3 depth layers)
├─ Ground plane (collision floor)
├─ Stage boundaries (left wall, right wall — soft or hard)
├─ Visual effects (ambient particles, animated elements)
├─ Stage-specific hazard (optional, Phase 2)
└─ Music track
```

#### MVP Stages

| Stage | Theme | Parallax Layers | Ambient Effect | Music Mood |
|---|---|---|---|---|
| **Neon Arena** | Cyberpunk city | 3 (buildings, neon signs, rain) | Rain particles, neon flicker | Synthwave |
| **Rooftop** | Urban skyline | 3 (clouds, skyline, building) | Wind debris, birds | Lo-fi beats |
| **Dojo** | Traditional martial arts | 3 (mountains, trees, room) | Scroll flutter, dust motes | Traditional |

**Stage Bounds:** Fixed at 800px wide × 400px tall play area (within 1280×720 viewport). Players cannot leave this boundary.

---

## 4. Progression

### 4.1 Run Structure (Gauntlet Mode)

Each Gauntlet run is a self-contained session:

```
Character Select → Fight 1 (Novice) → Upgrade Choice → Fight 2 (Easy) → Upgrade Choice
→ Fight 3 (Medium) → Upgrade Choice → Fight 4 (Hard) → Upgrade Choice → Fight 5 (Boss)
→ Results Screen
```

**Upgrade Choice:** After each win, choose 1 of 3 randomly selected power-ups:

| Power-Up Category | Example | Effect |
|---|---|---|
| **Damage Boost** | "Power Strike" | +15% damage for rest of run |
| **Speed Boost** | "Quick Feet" | +20% move speed for rest of run |
| **Health Boost** | "Iron Body" | +25 max HP for rest of run |
| **Stamina Boost** | "Deep Breath" | +25 max SP + faster regen |
| **Combo Extension** | "Flow State" | Extend combos by 1 additional hit |
| **Perfect Block Window** | "Reflexes" | Expand perfect block window from 4 to 8 frames |
| **Counter Damage** | "Punisher" | +50% damage on counter hits |
| **Heal** | "Second Wind" | Restore 30% HP immediately |

Power-ups are **run-only** — they reset at the start of each new run. This keeps runs fresh and encourages experimentation.

### 4.2 Meta-Progression (Across Runs)

#### XP & Leveling

| Source | XP Earned |
|---|---|
| Win a round | 50 XP |
| Win a match | 100 XP |
| Complete a Gauntlet run | 300 XP |
| Perfect round (no damage taken) | +50 XP bonus |
| 5+ hit combo | +25 XP bonus |
| New record high score | +100 XP bonus |

**Level Curve:** XP required per level = `level × 200`. Level 2 = 400 XP, Level 5 = 1000 XP, Level 10 = 2000 XP.

#### Level Rewards

| Level | Unlock | Type |
|---|---|---|
| 1 | Rex, Volt, Titan, Luna | Starter fighters (4) |
| 3 | Title: "Challenger" | Cosmetic |
| 5 | **Blaze** (Glass Cannon fighter) | New character |
| 7 | Neon Rex color palette | Cosmetic skin |
| 10 | **Frost** (Defensive fighter) | New character |
| 12 | Title: "Warrior" | Cosmetic |
| 15 | All-color palette pack | Cosmetic skins |
| 20 | **Shadow** (Trickster fighter) | New character |
| 25 | Title: "Champion" | Cosmetic |
| 30 | **Astra** (All-Rounder+ fighter) | New character |
| 35 | Victory animation pack | Cosmetic |

#### Coin Economy

| Source | Coins Earned |
|---|---|
| Win a round | 10 coins |
| Win a match | 25 coins |
| Complete a Gauntlet run | 50 coins |
| Daily login | 50 coins |
| Watch rewarded ad | 30 coins |

#### Cosmetic Shop

| Item Type | Price Range | Examples |
|---|---|---|
| Character Skin | 200–500 coins | Neon Rex, Shadow Volt, Frost Bite Luna |
| Stage Theme | 300–600 coins | Midnight Dojo, Neon City, Stormy Rooftop |
| Victory Pose | 150–300 coins | Flex, Bow, Taunt, Drop Mic |
| Particle Effect | 100–200 coins | Fire trail, Ice spark, Lightning crack |

### 4.3 High Score System

| Score Source | Points |
|---|---|
| Win a round | 1,000 |
| Perfect round | +500 bonus |
| 3+ hit combo | +100 per combo |
| 5+ hit combo | +250 per combo |
| Finish round with < 25% HP | +200 comeback bonus |
| Win without using special | +300 skill bonus |
| Boss defeat | 5,000 |

**Score Multiplier:** Increases by 0.1× per round completed without losing. Max 1.5× multiplier at round 5.

---

## 5. UX Flow

### 5.1 Complete User Journey Map

```
┌──────────────────────────────────────────────────────────────────┐
│                        PLAYER JOURNEY                            │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  [1] BOOT                                                        │
│  └─→ Splash screen (if Poki: Poki logo)                         │
│                                                                  │
│  [2] PRELOADER                                                   │
│  └─→ Progress bar (green, on dark background)                   │
│  └─→ Load all assets (≤ 8MB for Poki)                           │
│  └─→ Poki SDK: gameLoadingFinished()                            │
│                                                                  │
│  [3] MAIN MENU                                                   │
│  └─→ Title logo "BATTLE BRAWL"                                  │
│  └─→ [PLAY] button → Character Select                           │
│  └─→ [QUICK MATCH] button → Random fight                        │
│  └─→ [SHOP] button → Cosmetic shop (Phase 2)                    │
│  └─→ [SETTINGS] button → Audio, controls                        │
│  └─→ Player level + coins displayed in corner                   │
│                                                                  │
│  [4] CHARACTER SELECT                                            │
│  └─→ 4 starter fighters shown (Rex, Volt, Titan, Luna)          │
│  └─→ Locked fighters shown with unlock requirement              │
│  └─→ Tap/click fighter → preview animation + stats              │
│  └─→ [SELECT] → Start fight                                     │
│  └─→ [BACK] → Return to main menu                               │
│                                                                  │
│  [5] FIGHT                                                       │
│  └─→ Stage loads (random from unlocked stages)                  │
│  └─→ "ROUND 1 — FIGHT!" announcement                           │
│  └─→ 60–90 second match                                         │
│  └─→ KO → Slow motion → "KO!" → Victory/Defeat screen          │
│  └─→ Best of 3 rounds                                           │
│                                                                  │
│  [6] POST-FIGHT (Quick Match)                                   │
│  └─→ Results: XP earned, coins earned, score                    │
│  └─→ [REMATCH] → Fight again                                    │
│  └─→ [CHARACTER SELECT] → Choose new fighter                    │
│  └─→ [MAIN MENU] → Return                                       │
│  └─→ Poki SDK: commercialBreak() (interstitial ad)              │
│                                                                  │
│  [6'] POST-FIGHT (Gauntlet)                                     │
│  └─→ Upgrade choice: pick 1 of 3 power-ups                      │
│  └─→ [NEXT FIGHT] → Continue gauntlet                           │
│  └─→ OR [END RUN] → Results screen                              │
│                                                                  │
│  [7] GAUNTLET COMPLETE                                           │
│  └─→ Results: total score, XP, coins, power-ups used            │
│  └─→ Unlock check: new fighter/level-up?                        │
│  └─→ "DOUBLE YOUR COINS!" → Rewarded ad                         │
│  └─→ [PLAY AGAIN] → New run                                     │
│  └─→ [MAIN MENU] → Return                                       │
│  └─→ Poki SDK: commercialBreak()                                │
│                                                                  │
│  [8] REPEAT (one-more-try loop)                                 │
│  └─→ Player starts new run with unlocks                         │
│  └─→ Meta-progression motivates continued play                  │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 Screen Specifications

#### Main Menu Screen

```
┌──────────────────────────────────────────────┐
│                                              │
│                                              │
│         BATTLE BRAWL                        │
│         [animated logo]                      │
│                                              │
│                                              │
│         ┌──────────────────┐                │
│         │    ▶  PLAY        │                │
│         └──────────────────┘                │
│         ┌──────────────────┐                │
│         │  QUICK MATCH     │                │
│         └──────────────────┘                │
│                                              │
│         Lv.5 "Challenger"    💰 1,250       │
│                                              │
└──────────────────────────────────────────────┘
```

#### Character Select Screen

```
┌──────────────────────────────────────────────┐
│  SELECT YOUR FIGHTER                         │
│                                              │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │ REX │ │VOLT │ │TITAN│ │LUNA │          │
│  │ [✓] │ │     │ │     │ │     │          │
│  └─────┘ └─────┘ └─────┘ └─────┘          │
│                                              │
│  ┌─────┐ ┌─────┐ ┌─────┐ ┌─────┐          │
│  │BLAZE│ │FROST│ │SHADW│ │ASTRA│          │
│  │ 🔒  │ │ 🔒  │ │ 🔒  │ │ 🔒  │          │
│  └─────┘ └─────┘ └─────┘ └─────┘          │
│                                              │
│  ┌─────────────────────────────────┐        │
│  │ REX — Balanced                  │        │
│  │ HP: ████████████ 100            │        │
│  │ SP: ████████ 100                │        │
│  │ Speed: ██████░░ 7/10            │        │
│  │ Power: █████░░░ 5/10            │        │
│  └─────────────────────────────────┘        │
│                                              │
│  [SELECT]                    [BACK]          │
└──────────────────────────────────────────────┘
```

#### HUD During Fight

```
┌──────────────────────────────────────────────┐
│  ┌──────────────────┐  ┌──────────────────┐ │
│  │ P1 HP  ████████░░│  │ HP ████████░░ P2 │ │
│  │ P1 SP  ██████░░░░│  │ SP ██████░░░░    │ │
│  └──────────────────┘  └──────────────────┘ │
│                                              │
│                    BATTLE AREA               │
│                                              │
│                                              │
│                                              │
│                                              │
│                                              │
│                    Combo: 3x                 │
│                                              │
└──────────────────────────────────────────────┘
```

#### Results Screen

```
┌──────────────────────────────────────────────┐
│                                              │
│              VICTORY!                        │
│         (or DEFEAT)                          │
│                                              │
│         Score: 12,450                        │
│         XP Earned: +350                      │
│         Coins Earned: +85                    │
│                                              │
│         ┌──────────────────┐                │
│         │  PLAY AGAIN      │                │
│         └──────────────────┘                │
│         ┌──────────────────┐                │
│         │  MAIN MENU       │                │
│         └──────────────────┘                │
│                                              │
│         [Watch ad: Double coins → 170]       │
│                                              │
└──────────────────────────────────────────────┘
```

### 5.3 Transition Animations

| Transition | Animation | Duration |
|---|---|---|
| Main Menu → Character Select | Slide left | 300ms |
| Character Select → Fight | Fade to black → Stage fade in | 500ms total |
| Fight → KO | Slow motion (0.3×) → Zoom → "KO!" | 1000ms |
| KO → Victory/Defeat | Slide up from bottom | 400ms |
| Victory/Defeat → Upgrade (Gauntlet) | Fade to dark → Upgrade cards slide in | 600ms |
| Upgrade → Next Fight | Cards merge → Fade to black → Stage load | 500ms |
| Any → Main Menu | Fade to black → Fade in | 400ms |

---

## 6. Content Structure

### 6.1 Asset Manifest (MVP)

#### Character Sprites

| Character | Animations | Frames per Animation | Total Frames | Est. Size |
|---|---|---|---|---|
| Rex | Idle, Walk, Jump, Crouch, Light, Heavy, Special, Block, Hit, KO | 8–12 each | ~90 | ~500KB |
| Volt | Idle, Walk, Jump, Crouch, Light, Heavy, Special, Block, Hit, KO | 8–12 each | ~90 | ~500KB |
| Titan | Idle, Walk, Jump, Crouch, Light, Heavy, Special, Block, Hit, KO | 8–12 each | ~90 | ~500KB |
| Luna | Idle, Walk, Jump, Crouch, Light, Heavy, Special, Block, Hit, KO | 8–12 each | ~90 | ~500KB |
| **Total (4 chars)** | | | **~360 frames** | **~2MB** |

Each character also needs:
- Selection screen portrait (1 image per character): ~50KB each
- Character select animation (idle pose on selection screen): part of sprite atlas

#### Stage Assets

| Stage | Layers | Est. Size |
|---|---|---|
| Neon Arena | Background (3 parallax layers) | ~400KB |
| Rooftop | Background (3 parallax layers) | ~400KB |
| Dojo | Background (3 parallax layers) | ~400KB |
| **Total (3 stages)** | | **~1.2MB** |

#### UI Elements

| Element | Est. Size |
|---|---|
| HUD (HP bars, SP bars, round markers, combo counter) | ~150KB |
| Menu screens (main menu, character select, results, shop) | ~200KB |
| Buttons, icons, backgrounds | ~100KB |
| **Total UI** | **~450KB** |

#### Audio

| Type | Count | Format | Est. Size |
|---|---|---|---|
| SFX (hit, block, special, KO, menu click) | ~20 | OGG (MP3 fallback) | ~800KB |
| Music (3 stage tracks, menu theme) | 4 | OGG (streamed) | ~2MB |
| **Total Audio** | | | **~2.8MB** |

#### Build Output

| Component | Est. Size |
|---|---|
| Phaser 3.90 library (tree-shaken) | ~600KB |
| Game code (TypeScript → JS) | ~400KB |
| HTML/CSS | ~50KB |
| **Total JS bundle** | **~1MB** |

### 6.2 Total Asset Budget

| Category | Estimated Size |
|---|---|
| Character sprites + portraits | ~2.2MB |
| Stage backgrounds | ~1.2MB |
| UI elements | ~450KB |
| Audio (SFX + music) | ~2.8MB |
| JS bundle (Phaser + code) | ~1MB |
| **Grand Total** | **~7.65MB** |

**Target: ≤ 8MB initial load (Poki requirement)**

Optimization strategies if over budget:
1. Reduce music to 2 tracks (menu + generic fight), stream the rest
2. Compress stage backgrounds with WebP
3. Use texture atlases for all sprites
4. Lazy-load non-critical assets after gameplay starts

### 6.3 File Naming Convention

```
public/assets/
├── images/
│   ├── characters/
│   │   ├── rex/
│   │   │   ├── rex-spritesheet.png (atlas)
│   │   │   ├── rex-portrait.png
│   │   │   └── rex-atlas.json
│   │   ├── volt/
│   │   ├── titan/
│   │   └── luna/
│   ├── stages/
│   │   ├── neon-arena/
│   │   │   ├── bg-far.png
│   │   │   ├── bg-mid.png
│   │   │   └── bg-near.png
│   │   ├── rooftop/
│   │   └── dojo/
│   ├── ui/
│   │   ├── hud.png (atlas)
│   │   ├── menu.png (atlas)
│   │   └── buttons.png (atlas)
│   └── effects/
│       ├── particles.png
│       └── hit-effects.png
├── audio/
│   ├── sfx/
│   │   ├── hit-light.ogg (+ .mp3)
│   │   ├── hit-heavy.ogg (+ .mp3)
│   │   ├── block.ogg (+ .mp3)
│   │   ├── special.ogg (+ .mp3)
│   │   ├── ko.ogg (+ .mp3)
│   │   └── menu-click.ogg (+ .mp3)
│   └── music/
│       ├── menu-theme.ogg
│       ├── fight-neon.ogg
│       ├── fight-rooftop.ogg
│       └── fight-dojo.ogg
└── fonts/
    └── game-font.ttf (if custom font needed)
```

---

## 7. Phaser Scene Architecture

### 7.1 Scene Registry

The game uses a centralized scene enum and 12 scenes organized into 4 layers:

```typescript
// src/game/scenes/Scenes.ts

export enum SceneKey {
  // Layer 1: Bootstrap
  Boot = "Boot",
  Preloader = "Preloader",

  // Layer 2: UI / Menu
  MainMenu = "MainMenu",
  CharacterSelect = "CharacterSelect",
  Settings = "Settings",
  Shop = "Shop",

  // Layer 3: Gameplay
  Game = "Game",
  FightOverlay = "FightOverlay",
  PauseMenu = "PauseMenu",

  // Layer 4: Results
  UpgradeSelect = "UpgradeSelect",
  Results = "Results",
  LevelUp = "LevelUp",
}
```

### 7.2 Scene Flow Diagram

```
                          ┌──────────────────────┐
                          │        BOOT           │
                          │ (initialize config)   │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │      PRELOADER        │
                          │ (load all assets)     │
                          │ Poki: gameLoading     │
                          │   Finished()          │
                          └──────────┬───────────┘
                                     │
                          ┌──────────▼───────────┐
                          │      MAIN MENU        │
                          │ (title, nav buttons)  │
                          └──────┬───────┬───────┘
                     ┌───────────┘       └───────────┐
          ┌──────────▼───────────┐       ┌───────────▼───────────┐
          │   CHARACTER SELECT   │       │     QUICK MATCH       │
          │ (pick fighter)       │       │ (random char + stage) │
          └──────────┬───────────┘       └───────────┬───────────┘
                     │                               │
                     └───────────┬───────────────────┘
                                 │
                          ┌──────▼───────┐
                     ┌────│     GAME      │────┐
                     │    │ (combat loop) │    │
                     │    └──────┬───────┘    │
                     │           │             │
              ┌──────▼──┐  ┌────▼─────┐  ┌───▼──────┐
              │  PAUSE  │  │ FIGHT    │  │ LEVEL UP │
              │  MENU   │  │ OVERLAY  │  │ (unlock) │
              └────┬────┘  └──────────┘  └──────────┘
                   │
          ┌────────┼────────┐
          │        │        │
    ┌─────▼──┐ ┌───▼────┐ ┌─▼────────┐
    │ RESUME │ │ QUIT   │ │ SETTINGS │
    └────────┘ └───┬────┘ └──────────┘
                   │
          ┌────────▼───────────┐
          │   MAIN MENU        │
          └────────────────────┘

         After fight:
              │
              ▼
     ┌────────────────┐
     │  UPGRADE SELECT│ (Gauntlet only: pick 1 of 3 power-ups)
     └────────┬───────┘
              │
              ▼
     ┌────────────────┐
     │    RESULTS     │ (score, XP, coins, unlocks)
     └────────┬───────┘
              │
     ┌────────┼────────┐
     │        │        │
┌────▼──┐ ┌──▼──────┐ ┌▼────────┐
│REPLAY │ │MAIN MENU│ │ NEW RUN │
└───────┘ └─────────┘ └─────────┘
```

### 7.3 Scene Responsibilities

| Scene | Key | Parent | Responsibilities | Active During |
|---|---|---|---|---|
| **Boot** | `Boot` | — | Initialize Phaser config, detect device, set up input manager | Startup only |
| **Preloader** | `Preloader` | Boot | Load all assets, show progress bar, call Poki SDK `gameLoadingFinished()` | Startup only |
| **MainMenu** | `MainMenu` | Preloader | Title screen, navigation to modes, display player stats, Poki `gameplayStart()` | Menu state |
| **CharacterSelect** | `CharacterSelect` | MainMenu | Show available fighters, preview animations, select fighter | Pre-fight |
| **Settings** | `Settings` | MainMenu | Audio volume, control remapping, touch toggle | Menu state |
| **Shop** | `Shop` | MainMenu | Cosmetic shop, coin display, purchase flow | Menu state (Phase 2) |
| **Game** | `Game` | CharacterSelect | Core combat loop, physics, AI, input processing, stage rendering, camera management | During combat |
| **FightOverlay** | `FightOverlay` | Game | HUD overlay (HP bars, SP bars, round counters, combo counter, timer) | During combat (parallel) |
| **PauseMenu** | `PauseMenu` | Game | Pause/resume, settings, quit | During combat (parallel) |
| **UpgradeSelect** | `UpgradeSelect` | Game | Show 3 upgrade cards, let player pick one (Gauntlet only) | Between rounds |
| **Results** | `Results` | Game | Show score, XP, coins, unlocks, play again / main menu options | Post-fight |
| **LevelUp** | `LevelUp` | Results | Level-up celebration, show unlock, new fighter/title revealed | Post-level-up |

### 7.4 Scene Implementation Architecture

#### Boot Scene (`src/game/scenes/Boot.ts`)

```typescript
// Responsibilities:
// 1. Detect device type (desktop / mobile / tablet)
// 2. Set up Unified Input Manager
// 3. Configure Poki SDK (if running on Poki)
// 4. Pass device info to all subsequent scenes
// 5. Transition to Preloader

export class Boot extends Phaser.Scene {
  create() {
    // Detect touch support
    const isTouchDevice = this.sys.game.device.input.touch;
    const isTablet = /iPad|Android(?!.*Mobile)/.test(navigator.userAgent);

    // Store in registry for all scenes to access
    this.registry.set('isTouchDevice', isTouchDevice || isTablet);
    this.registry.set('isTablet', isTablet);

    // Initialize save system (localStorage with fallback)
    this.registry.set('saveData', this.loadSave());

    this.scene.start(SceneKey.Preloader);
  }
}
```

#### Preloader Scene (`src/game/scenes/Preloader.ts`)

```typescript
// Responsibilities:
// 1. Load ALL game assets (sprites, audio, UI)
// 2. Show progress bar
// 3. Call Poki SDK gameLoadingFinished()
// 4. Transition to MainMenu

export class Preloader extends Phaser.Scene {
  preload() {
    // Character sprite atlases
    this.load.atlas('rex', 'assets/images/characters/rex/rex-spritesheet.png',
                     'assets/images/characters/rex/rex-atlas.json');
    // ... same for volt, titan, luna

    // Stage backgrounds
    this.load.image('neon-bg-far', 'assets/images/stages/neon-arena/bg-far.png');
    // ... etc

    // UI atlases
    this.load.atlas('hud', 'assets/images/ui/hud.png', 'assets/images/ui/hud.json');

    // Audio
    this.load.audio('hit-light', 'assets/audio/sfx/hit-light.ogg');
    // ... etc

    // Progress bar UI (keep existing)
  }

  create() {
    // Notify Poki that loading is complete
    // if (window.PokiSDK) PokiSDK.gameLoadingFinished();

    this.scene.start(SceneKey.MainMenu);
  }
}
```

#### Game Scene (`src/game/scenes/GameScene.ts`)

The core gameplay scene manages the combat loop. It uses Phaser's Arcade Physics for collision detection.

```typescript
// Responsibilities:
// 1. Create stage (background, ground, boundaries)
// 2. Spawn player and opponent sprites
// 3. Run combat system (input → animation → hitbox → damage)
// 4. Manage round state (round count, win conditions)
// 5. Trigger AI behavior (for Gauntlet / Quick Match)
// 6. Emit events for FightOverlay to display
// 7. Handle KO, round end, match end

export class GameScene extends Phaser.Scene {
  // Key systems managed within this scene:
  // - PlayerController (input processing → actions)
  // - AIController (decision tree → actions)
  // - CombatSystem (hitbox collision, damage, combos)
  // - RoundManager (round state, win conditions)
  // - CameraController (follow, shake, zoom)

  create(data: { mode: 'gauntlet' | 'quickmatch' | 'local2p'; opponent: string; stage: string }) {
    // 1. Create stage
    // 2. Create characters
    // 3. Launch FightOverlay scene in parallel
    // 4. Start round 1
  }

  update(time: number, delta: number) {
    // 1. Process inputs (keyboard/gamepad/touch → actions)
    // 2. Run AI decision tree (if vs CPU)
    // 3. Execute combat (hitbox checks, damage application)
    // 4. Update animations
    // 5. Update camera
    // 6. Check win conditions
  }
}
```

#### FightOverlay Scene (`src/game/scenes/FightOverlay.ts`)

Runs as a **parallel scene** on top of Game — manages HUD without cluttering gameplay code.

```typescript
// Responsibilities:
// 1. Display HP bars and SP bars
// 2. Display round indicators
// 3. Display combo counter
// 4. Display "ROUND X — FIGHT!" announcements
// 5. Display "KO!" animation
// 6. Listen to events from Game scene

export class FightOverlay extends Phaser.Scene {
  create() {
    // Create HP bar graphics
    // Create SP bar graphics
    // Create combo counter text
    // Create round indicators

    // Listen to Game scene events:
    this.scene.get('Game').events.on('damage', this.onDamage, this);
    this.scene.get('Game').events.on('combo', this.onCombo, this);
    this.scene.get('Game').events.on('roundStart', this.onRoundStart, this);
    this.scene.get('Game').events.on('roundEnd', this.onRoundEnd, this);
    this.scene.get('Game').events.on('ko', this.onKO, this);
  }
}
```

### 7.5 Core Systems Architecture

These are not Phaser scenes but modular TypeScript classes used within scenes:

```
src/game/
├── scenes/           (Phaser scenes — see above)
│   ├── Scenes.ts
│   ├── Boot.ts
│   ├── Preloader.ts
│   ├── MainMenu.ts
│   ├── CharacterSelect.ts
│   ├── Settings.ts
│   ├── Shop.ts
│   ├── GameScene.ts
│   ├── FightOverlay.ts
│   ├── PauseMenu.ts
│   ├── UpgradeSelect.ts
│   ├── Results.ts
│   └── LevelUp.ts
│
├── systems/          (Core game systems)
│   ├── InputManager.ts       (Unified input: keyboard/gamepad/touch)
│   ├── CombatSystem.ts       (Hitbox collision, damage, combos, blocks)
│   ├── AISystem.ts           (AI decision tree, difficulty scaling)
│   ├── CameraSystem.ts       (Follow, shake, zoom, transitions)
│   ├── RoundManager.ts       (Round state, win conditions, best-of-3)
│   ├── ComboTracker.ts       (Combo counting, timing, display events)
│   ├── ParticleSystem.ts     (Hit effects, ambient particles)
│   └── AudioManager.ts       (SFX, music, cross-fade)
│
├── entities/         (Game objects)
│   ├── Fighter.ts            (Base fighter class: stats, state machine)
│   ├── fighters/
│   │   ├── Rex.ts
│   │   ├── Volt.ts
│   │   ├── Titan.ts
│   │   ├── Luna.ts
│   │   ├── Blaze.ts
│   │   ├── Frost.ts
│   │   ├── Shadow.ts
│   │   └── Astra.ts
│   └── Stage.ts              (Stage background, boundaries, hazards)
│
├── data/             (Static game data)
│   ├── characters.ts         (Character stats, move lists, frame data)
│   ├── moves.ts              (Move definitions: damage, frames, hitboxes)
│   ├── stages.ts             (Stage metadata)
│   ├── upgrades.ts           (Power-up definitions)
│   ├── progression.ts        (XP curve, level rewards, unlock requirements)
│   └── shop.ts               (Shop item catalog)
│
├── ui/               (Reusable UI components)
│   ├── HPBar.ts
│   ├── SPBar.ts
│   ├── Button.ts
│   ├── UpgradeCard.ts
│   └── ComboCounter.ts
│
├── utils/            (Shared utilities)
│   ├── SaveSystem.ts         (localStorage with incognito fallback)
│   ├── EventBus.ts           (Cross-scene communication)
│   ├── Constants.ts          (Game balance numbers, dimensions)
│   └── DeviceDetector.ts     (Touch, tablet, performance tier)
│
└── config/           (Game configuration)
    └── PhaserConfig.ts       (Game config factory — scales for portals)
```

### 7.6 Cross-Scene Communication

Scenes communicate through two patterns:

1. **EventBus (pub/sub):** For game events (damage, KO, round end)
2. **Scene.data (Phaser built-in):** For passing data between scene transitions

```typescript
// EventBus pattern:
// src/game/utils/EventBus.ts
import Phaser from 'phaser';
export const EventBus = new Phaser.Events.EventEmitter();

// Game scene emits:
EventBus.emit('damage', { target: 'p1', amount: 12 });
EventBus.emit('ko', { loser: 'p1', winner: 'p2' });

// FightOverlay listens:
EventBus.on('damage', (data) => { this.updateHPBar(data.target, data.amount); });
```

### 7.7 Game Config Factory

```typescript
// src/game/config/PhaserConfig.ts

export function createGameConfig(parent: HTMLElement, options?: {
  isPoki?: boolean;
  isMobile?: boolean;
}): Phaser.Types.Core.GameConfig {
  return {
    parent,
    type: Phaser.AUTO,
    backgroundColor: '#1a1a2e',
    width: 1280,
    height: 720,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 800 },  // Standard gravity for jumps
        debug: false,
        tileBias: 16,
      },
    },
    input: {
      activePointers: 4,  // Support multi-touch (P1 + P2 touch)
    },
    scene: [
      Boot, Preloader, MainMenu, CharacterSelect, Settings,
      Shop, GameScene, FightOverlay, PauseMenu,
      UpgradeSelect, Results, LevelUp,
    ],
  };
}
```

### 7.8 Physics Configuration

| Parameter | Value | Rationale |
|---|---|---|
| **Physics engine** | Arcade Physics | Sufficient for 2D fighter hitbox/hurtbox collision |
| **Gravity** | y: 800 | Standard platformer gravity for jumps |
| **World bounds** | 800×400 (within 1280×720 viewport) | Play area for combat |
| **Collision groups** | Player1 ↔ Player2, Projectiles ↔ Fighters | Optimized collision checks |
| **Frame rate** | 60fps (desktop), 30fps (mobile low-end) | Target via `maxPhysicsFrame` tuning |

### 7.9 Network Architecture (Phase 2 — Poki Netlib)

Online multiplayer uses **@poki/netlib v0.0.18** for P2P WebRTC multiplayer with zero server costs. This approach aligns with Poki's platform direction and eliminates the need for dedicated server infrastructure.

> **v1.2 Change:** Network architecture updated from Colyseus (v1.1) to Poki Netlib. Poki Netlib is the platform-native solution, already in production on Poki, with zero server costs and built-in TURN relay fallback. Colyseus remains a viable alternative for self-hosted deployments.

#### Why Poki Netlib Over Colyseus

| Factor | Poki Netlib | Colyseus |
|---|---|---|
| **Server costs** | Zero (P2P WebRTC) | Requires Node.js server ($5–50/mo) |
| **Platform alignment** | Native Poki solution | Third-party; not platform-integrated |
| **TURN relay** | Built-in (free) | Requires external TURN server |
| **Lobby system** | Built-in matchmaking | Must implement separately |
| **Phaser compatibility** | Designed for Phaser | Compatible but not native |
| **Production readiness** | v0.0.18, used in production | v0.17, mature |
| **Latency** | P2P (lowest possible) | Server relay (adds hop) |

#### Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                  PHASE 2 NETWORK ARCHITECTURE                     │
│                    (Poki Netlib P2P WebRTC)                       │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐      P2P WebRTC       ┌─────────────────┐  │
│  │    CLIENT A      │◄═══════════════════►  │    CLIENT B      │  │
│  │  (Phaser 3.90)   │   Direct peer conn   │  (Phaser 3.90)   │  │
│  │                  │                       │                  │  │
│  │  • Input capture │   TURN relay (if P2P  │  • Input capture │  │
│  │  • Prediction    │   fails, via Poki)    │  • Prediction    │  │
│  │  • Interpolation │                       │  • Interpolation │  │
│  │  • Rendering     │                       │  • Rendering     │  │
│  └─────────────────┘                       └─────────────────┘  │
│           │                                         │             │
│           └──────────────┬──────────────────────────┘             │
│                          │                                        │
│                  ┌───────▼────────┐                               │
│                  │  POKI LOBBY    │                               │
│                  │  (netlib)      │                               │
│                  │                │                               │
│                  │  • Queue mgmt  │                               │
│                  │  • Skill rating│                               │
│                  │  • Room create │                               │
│                  │  • TURN relay  │                               │
│                  └────────────────┘                               │
└──────────────────────────────────────────────────────────────────┘
```

#### Poki Netlib Integration

```typescript
// src/game/network/NetlibManager.ts (Phase 2)
import { Netlib } from '@poki/netlib';

export class NetlibManager {
  private netlib: Netlib;
  private room: any;

  async init() {
    this.netlib = new Netlib({
      appId: 'battle-brawl',  // Registered with Poki
      version: '1.0.0',
    });
  }

  async createRoom(options: { mode: 'ranked' | 'casual' }) {
    this.room = await this.netlib.createRoom('fight', {
      maxPlayers: 2,
      mode: options.mode,
    });
    return this.room;
  }

  async joinRoom(roomId: string) {
    this.room = await this.netlib.joinRoom(roomId);
    return this.room;
  }

  // Input sync: send local inputs, receive remote inputs
  sendInput(input: GameInput) {
    this.room.send('input', {
      frame: this.currentFrame,
      actions: input.actions,
    });
  }

  onRemoteInput(callback: (playerId: string, input: GameInput) => void) {
    this.room.onMessage('input', (playerId: string, data: any) => {
      callback(playerId, data);
    });
  }
}
```

#### Sync Strategy

| Layer | Frequency | Method | Notes |
|---|---|---|---|
| **Inputs** | 60Hz (every frame) | Client → Peer | Raw directional + action inputs |
| **Game State** | Deterministic sim | Both clients run same simulation | Deterministic lockstep with input sync |
| **Matchmaking** | On-demand | Poki Lobby | Skill-based pairing |
| **TURN Relay** | Automatic | Poki infrastructure | Fallback when P2P fails (NAT traversal) |

#### Deterministic Lockstep Model

Since P2P WebRTC provides direct input exchange without an authoritative server, the game uses **deterministic lockstep simulation**:

1. Both clients run the same deterministic physics/combat simulation
2. Inputs are exchanged every frame (60Hz)
3. Simulation advances only when both players' inputs for that frame are received
4. If inputs are delayed, game buffers up to 4 frames before pausing
5. Both clients must produce identical results — no floating-point drift

**Determinism Requirements:**
- Fixed-point math for physics (no `Math.random()` during gameplay — use seeded RNG)
- Identical frame order across clients
- No platform-dependent behavior (gravity, timing, collision)

#### Latency Handling

| Latency | Behavior |
|---|---|
| **< 50ms** | Optimal — smooth gameplay, 1-frame input delay |
| **50–100ms** | Acceptable — 2-frame input buffer covers gap |
| **100–150ms** | Noticeable — add input delay indicator; still playable |
| **150–200ms** | Degraded — warn player; prefer regional lobbies |
| **> 200ms** | Unplayable — disconnect and return to menu with rating protection |

#### Fallback: Colyseus (Self-Hosted)

If Poki Netlib proves insufficient for competitive ranked play (e.g., need for replays, anti-cheat, or server-authoritative validation), Colyseus remains available as a self-hosted fallback:

- **Colyseus Room Schema:** Server-authoritative state sync (FightState, PlayerState)
- **Sync:** 60Hz input → server, 20Hz state → clients
- **Deployment:** Cloudflare Workers or AWS Lambda + WebSocket
- **Cost:** ~$5–50/month at scale

This fallback is NOT part of the MVP — Poki Netlib is the primary and preferred approach.

---

## 8. Production Priorities

### 8.1 MVP Feature Prioritization (MoSCoW)

#### MUST HAVE (MVP — Ship-blocking)

| # | Feature | Effort (days) | Dependencies | Acceptance Criteria |
|---|---|---|---|---|
| M1 | Unified Input Manager | 3 | None | Keyboard P1/P2 + touch all produce identical game actions; input buffer of 12 frames |
| M2 | Fighter base class + state machine | 4 | M1 | Fighter can idle, walk, jump, crouch, attack (light/heavy), block, take damage, be KO'd |
| M3 | Combat system (hitbox/hurtbox) | 5 | M2 | Light/heavy attacks deal correct damage; blocking reduces to 0; perfect block refunds stamina |
| M4 | Combo system | 3 | M3 | L→L→H chains correctly; combo counter increments; 5+ hit combos grant bonus XP |
| M5 | 4 starter characters (Rex, Volt, Titan, Luna) | 6 | M2, M3 | Each has unique special move, distinct stats, different visual design |
| M6 | AI opponent (5 difficulty tiers) | 4 | M2, M3 | Novice rarely blocks; Boss uses frame traps; difficulty scales across gauntlet |
| M7 | Stage system (3 stages) | 3 | M3 | Each stage has 3 parallax layers, stage boundaries, ambient effects, music |
| M8 | Camera system | 2 | M3 | Follows players between bounds; shakes on heavy hit; zooms on special/finisher |
| M9 | Visual juice package | 3 | M3 | Hit flash, screen shake, hit-stop, particles, slow-mo KO, floating damage numbers |
| M10 | Touch controls (phaser-virtual-joystick) | 3 | M1 | Virtual joystick + 3 buttons (A, B, Block); auto-detect touch devices; 48px targets |
| M11 | Gauntlet mode (roguelite run) | 3 | M5, M6, M7 | 5 fights with increasing difficulty; upgrade choice between fights; best-of-3 rounds |
| M12 | Quick Match mode | 1 | M5, M6, M7 | Random opponent + stage; single fight; results screen |
| M13 | Local 2P mode | 2 | M1, M5, M6 | Shared keyboard; P1 uses WASD+JKL; P2 uses arrows+numpad |
| M14 | XP/Leveling + coin economy | 2 | M11, M12 | XP earned per fight; levels unlock characters/cosmetics; coins earned and spent |
| M15 | Save system (localStorage) | 1 | M14 | Progress persists across sessions; try/catch for incognito mode |
| M16 | Main menu + character select UI | 3 | M5, M14 | Navigate modes; select fighter; view stats; level/coins displayed |
| M17 | Results screen | 2 | M11, M12 | Score, XP earned, coins earned, play again / menu buttons |
| M18 | Poki SDK integration | 2 | All | @poki/phaser-3 plugin; gameLoadingFinished, gameplayStart/Stop, commercialBreak |
| M19 | Rewarded video ads | 2 | M18 | "Double coins" after run, "Continue" after defeat, "Try locked fighter" |
| M20 | Asset optimization | 3 | M5-M7 | Total build ≤ 8MB; sprite atlases; audio compression; load time < 3s on 4G |

**Total MUST HAVE: ~55 person-days**

#### SHOULD HAVE (Phase 1.5 — within first 6 weeks post-launch)

| # | Feature | Effort (days) | Acceptance Criteria |
|---|---|---|---|
| S1 | 4 unlockable characters (Blaze, Frost, Shadow, Astra) | 8 | Each unique archetype, unique special, unlock conditions working |
| S2 | Upgrade variety (12+ power-ups) | 3 | 12 distinct run-only upgrades with meaningful gameplay impact |
| S3 | Settings menu | 1 | Audio volume sliders, touch control toggle, control remapping |
| S4 | Tutorial / first-time experience | 2 | Visual tutorial on first play; teach movement, light/heavy, block |
| S5 | Score leaderboard (local) | 1 | Track high scores per character per stage; display on main menu |
| S6 | Daily rewards | 1 | Login bonus; escalating rewards for consecutive days |
| S7 | CrazyGames submission | 2 | Meet CrazyGames QA requirements; test on their platform |

#### COULD HAVE (Phase 2 — 4–6 weeks after MVP)

| # | Feature | Effort (days) |
|---|---|---|
| C1 | Online multiplayer (Poki Netlib P2P) | 15 |
| C2 | Ranked PvP with matchmaking | 8 |
| C3 | Cosmetic IAP store | 5 |
| C4 | Daily/weekly challenges | 3 |
| C5 | Replay system | 5 |
| C6 | Spectator mode | 5 |

> **v1.2 Change:** Online multiplayer effort reduced from 20 days (Colyseus) to 15 days (Poki Netlib) due to built-in lobby, TURN relay, and zero server setup.

#### WON'T HAVE (Phase 3 or later)

- Season Pass / Battle Pass
- Story Mode with cutscenes
- Team Battle (2v2 tag)
- Cross-platform cloud saves
- Tournament mode (8-player bracket)

### 8.2 Development Timeline

```
WEEK 1-2:  Core Systems (M1–M4) — Input, Fighter base, Combat, Combos
WEEK 3-4:  Characters + AI (M5–M6) — 4 fighters, AI system
WEEK 5-6:  Stage + Camera + Juice (M7–M9) — Visual polish
WEEK 7:    Touch Controls (M10) — Mobile support
WEEK 8:    Game Modes (M11–M13) — Gauntlet, Quick Match, Local 2P
WEEK 9:    Progression + Save (M14–M15) — XP, coins, localStorage
WEEK 10:   UI + Menus (M16–M17) — Main menu, character select, results
WEEK 11:   Portal Integration (M18–M19) — Poki SDK, ads
WEEK 12:   Polish + Optimization (M20) — Asset optimization, testing, submission
```

### 8.3 Risk Register

| # | Risk | Severity | Probability | Mitigation | Owner |
|---|---|---|---|---|---|
| R1 | Touch controls feel imprecise on mobile | HIGH | MEDIUM | Design touch-first; playtest; simplify inputs; use Brawl Stars joystick reference | Combat designer |
| R2 | Asset size exceeds 8MB Poki limit | MEDIUM | MEDIUM | Aggressive atlas packing; WebP textures; lazy-load music; measure weekly | Tech artist |
| R3 | AI feels too easy or too hard | MEDIUM | HIGH | Tuning passes after each milestone; A/B test difficulty curves | Game designer |
| R4 | New Phaser fighter launches on Poki before us | HIGH | MEDIUM | Ship fast; prioritize MVP features; establish portal presence early | Producer |
| R5 | Phaser 3 performance on low-end mobile | LOW | MEDIUM | Sprite atlas optimization; reduce particles on low-end; target 30fps fallback | Engineer |
| R6 | Poki SDK integration blocks submission | LOW | LOW | Official @poki/phaser-3 plugin; follow documented examples | Engineer |
| R7 | Ad blockers reduce revenue | MEDIUM | MEDIUM | Game works without ads; non-intrusive placements; WebGL canvas ads | Producer |
| R8 | Combo system too complex for casuals | MEDIUM | MEDIUM | Auto-combo for basic chains; timing window generous (8 frames); AI training mode | Game designer |
| R9 | Poki Netlib beta instability | MEDIUM | LOW | Design abstraction layer; test early in Phase 2; Colyseus fallback available | Engineer |
| R10 | 53% mobile devs porting to browser (supply flood) | HIGH | HIGH | Ship before supply flood; establish quality reputation early | Producer |

---

## 9. Acceptance Criteria

### 9.1 Feature Acceptance Criteria

#### M1: Unified Input Manager
- [ ] Keyboard P1 (WASD + JKL) produces identical game actions to touch (joystick + buttons)
- [ ] Input buffer of 12 frames (200ms) — early inputs are executed on first available frame
- [ ] No input lag > 1 frame between raw input and game action
- [ ] Touch controls auto-appear on touch devices, hidden on desktop
- [ ] Tablets always show touch controls (Poki requirement)
- [ ] Simultaneous P1 + P2 input supported in local 2P mode

#### M2: Fighter Base Class
- [ ] Fighter has 6 states: Idle, Walk, Jump, Attack, Block, Hit/KO
- [ ] State transitions are valid (e.g., cannot jump while in hit-stun)
- [ ] Health and stamina are correctly tracked and displayed
- [ ] Fighter sprite correctly reflects current state (correct animation plays)
- [ ] Fighter stays within stage boundaries

#### M3: Combat System
- [ ] Light attack: 5–8 damage, 6-frame startup, 0 stamina cost
- [ ] Heavy attack: 12–18 damage, 12-frame startup, 15 stamina cost
- [ ] Block: reduces incoming damage to 0; drains 5 SP/frame
- [ ] Perfect block (4-frame window): refunds 10 stamina + 4-frame advantage
- [ ] Guard break at 0 stamina: 30-frame stagger, cannot block
- [ ] Throw: 15 damage, 10-frame startup, unblockable, 20 stamina cost
- [ ] Counter-hit (hitting during opponent's attack startup): extra 25% damage

#### M4: Combo System
- [ ] L → L → H chains correctly (auto-combo with timing window)
- [ ] Combo counter displays on-screen, increments on each hit
- [ ] Combos of 5+ hits grant +25 XP bonus
- [ ] Combo drops if timing window (8 frames) is missed
- [ ] Special cancel (H → Special) works and costs extra stamina

#### M5: 4 Starter Characters
- [ ] Rex: Balanced archetype, "Power Strike" special, beginner-friendly
- [ ] Volt: Rushdown, fast combos, dash cancel special
- [ ] Titan: Grappler, slow but powerful, armor moves
- [ ] Luna: Zoner, projectile special, spacing-focused
- [ ] Each character has at least 8 unique animations (idle, walk, jump, crouch, light, heavy, special, block, hit, KO)
- [ ] Each character's stats match their archetype (speed, power, HP, SP values differ)

#### M6: AI Opponent
- [ ] 5 difficulty tiers (Novice → Boss) with distinct behavior
- [ ] AI correctly executes combos at Medium+ difficulty
- [ ] AI correctly blocks at Easy+ difficulty
- [ ] AI does not cheat (no input reads, no frame-perfect reactions at Novice/Easy)
- [ ] Boss AI uses character-specific signature mechanics

#### M10: Touch Controls
- [ ] Virtual joystick on left 50% of screen controls movement
- [ ] 3 buttons on right 50%: Light (A), Heavy (B), Block
- [ ] Jump button in bottom-left area
- [ ] All touch targets ≥ 48px (Apple HIG)
- [ ] Joystick base: 64px radius, 30% opacity; stick: 40px radius, 60% opacity
- [ ] No input conflicts with HUD area (top 20% of screen)

#### M11: Gauntlet Mode
- [ ] 5 fights with increasing difficulty (Novice → Boss)
- [ ] Best-of-3 rounds per fight
- [ ] Upgrade selection between fights (pick 1 of 3)
- [ ] Run-only power-ups reset on new run
- [ ] Final boss has unique mechanics (phase shifts at 66% and 33% HP)
- [ ] Results screen shows score, XP, coins, power-ups used

#### M18: Poki SDK Integration
- [ ] `gameLoadingFinished()` called after Preloader completes
- [ ] `gameplayStart()` called when fight begins
- [ ] `gameplayStop()` called when fight ends (KO, pause, menu)
- [ ] `commercialBreak()` called between runs (natural break)
- [ ] `rewardedBreak()` available for "Double coins" and "Continue"
- [ ] Game fully playable without ads (ad blocker safe)
- [ ] No external HTTP requests (all assets bundled)

#### M20: Asset Optimization
- [ ] Total build output ≤ 8MB (measured after webpack build)
- [ ] Initial load time < 3 seconds on simulated 4G connection
- [ ] All sprites use texture atlases (no individual image files for animation frames)
- [ ] Audio files use OGG format with MP3 fallback
- [ ] No debug code in production build
- [ ] Source maps disabled in production

### 9.2 Build & QA Criteria

| Criterion | Requirement | How to Verify |
|---|---|---|
| **TypeScript compiles** | `npm run typecheck` passes with zero errors | `npx tsc --noEmit` |
| **Production build succeeds** | `npm run build` completes without errors | `npm run build` |
| **Build size ≤ 8MB** | Total output in `build/` directory | `du -sh build/` |
| **60fps on desktop** | No frame drops during combat | Chrome DevTools Performance tab |
| **30fps minimum on mobile** | Playable on low-end Android (2020+) | Test on physical device |
| **Touch controls functional** | All actions reachable via touch | Manual test on iOS Safari + Android Chrome |
| **No console errors** | Zero errors in browser console during play | Chrome DevTools Console |
| **Save/load works** | Progress persists across page refreshes | Manual test + check localStorage |
| **Pause/resume works** | Game pauses on ESC, resumes correctly | Manual test |
| **Round transitions work** | "ROUND X" announcements display, KO animations play | Manual test |
| **All 4 characters playable** | Select and fight as each character | Manual test |

### 9.3 Poki Submission Checklist

| Requirement | Status | Verified |
|---|---|---|
| 16:9 aspect ratio | ✅ 1280×720 with FIT scaling | Config |
| Desktop + mobile + tablet support | ✅ Unified input manager | M1, M10 |
| Force mobile controls on tablets | ✅ Device detection + force-touch | M10 |
| Incognito mode support | ✅ localStorage try/catch | M15 |
| No external requests | ✅ All assets bundled | M20 |
| No ad blocker prevention | ✅ Game playable without ads | M18 |
| SDK events correct | ✅ @poki/phaser-3 plugin | M18 |
| Clean build (no debug code) | ✅ Production config strips debug | M20 |
| < 8MB initial load | ✅ Asset budget enforced | M20 |
| Skippable sequences | ✅ All announcements/animations skippable | UX |
| Visual tutorials (not text-heavy) | ✅ First-time experience shows inputs | S4 |
| Static + animated thumbnails | ✅ Required for global release | Art |
| Streamlined entry | ✅ < 10s to first fight | UX |

---

## 10. Appendix

### 10.1 Character Stat Tables

#### Rex (Balanced)

| Stat | Value |
|---|---|
| HP | 100 |
| SP | 100 |
| Walk Speed | 200px/sec |
| Jump Velocity | 600px/sec |
| Light Damage | 7 |
| Heavy Damage | 15 |
| Special | Power Strike — 25 damage, mid-range shockwave |
| Special Cost | 40 SP |
| Archetype Notes | Versatile; no extreme weaknesses; recommended for beginners |

#### Volt (Rushdown)

| Stat | Value |
|---|---|
| HP | 85 |
| SP | 90 |
| Walk Speed | 250px/sec |
| Jump Velocity | 650px/sec |
| Light Damage | 6 |
| Heavy Damage | 13 |
| Special | Lightning Dash — 20 damage, passes through opponent |
| Special Cost | 35 SP |
| Archetype Notes | Fastest character; weak to zoners; relies on staying close |

#### Titan (Grappler)

| Stat | Value |
|---|---|
| HP | 120 |
| SP | 80 |
| Walk Speed | 160px/sec |
| Jump Velocity | 500px/sec |
| Light Damage | 8 |
| Heavy Damage | 20 |
| Special | Earth Slam — 30 damage, ground pound, slow startup |
| Special Cost | 50 SP |
| Archetype Notes | Slowest character; highest damage; armor on heavy (absorbs 1 hit) |

#### Luna (Zoner)

| Stat | Value |
|---|---|
| HP | 90 |
| SP | 110 |
| Walk Speed | 190px/sec |
| Jump Velocity | 600px/sec |
| Light Damage | 5 |
| Heavy Damage | 12 |
| Special | Lunar Beam — 22 damage, full-screen projectile |
| Special Cost | 45 SP |
| Archetype Notes | Best spacing; projectile keeps opponents away; weak up close |

### 10.2 Upgrade Catalog (12 Power-Ups)

| ID | Name | Effect | Rarity Weight |
|---|---|---|---|
| U1 | Power Strike | +15% damage | 15% |
| U2 | Quick Feet | +20% move speed | 15% |
| U3 | Iron Body | +25 max HP | 15% |
| U4 | Deep Breath | +25 max SP, +20% SP regen | 15% |
| U5 | Flow State | Extend max combo by 1 hit | 10% |
| U6 | Reflexes | Perfect block window: 4 → 8 frames | 10% |
| U7 | Punisher | +50% counter-hit damage | 8% |
| U8 | Second Wind | Heal 30% HP now | 12% |
| U9 | Tough Skin | Reduce incoming damage by 10% | 5% |
| U10 | Berserker | +25% damage when below 30% HP | 3% |
| U11 | Auto-Heal | Regenerate 2 HP/sec | 2% |
| U12 | Thundergod | Special moves cost 50% less SP | 2% |

### 10.3 Level XP Requirements

| Level | XP Required | Cumulative XP |
|---|---|---|
| 1 | 0 | 0 |
| 2 | 400 | 400 |
| 3 | 600 | 1,000 |
| 4 | 800 | 1,800 |
| 5 | 1,000 | 2,800 |
| 10 | 2,000 | 13,500 |
| 15 | 3,000 | 36,000 |
| 20 | 4,000 | 71,000 |
| 25 | 5,000 | 118,500 |
| 30 | 6,000 | 178,500 |

Formula: `XP_for_level_N = N × 200`

### 10.4 Balance Reference Numbers

| Parameter | Value | Notes |
|---|---|---|
| Stage width | 800px | Play area within 1280×720 viewport |
| Stage height (floor) | 400px | Y-position of ground plane |
| Character width | 64px | Hitbox width |
| Character height | 96px | Standing hitbox height |
| Crouch height | 64px | Crouching hitbox height |
| Jump height | 200px | Max height above ground |
| Attack range (light) | 70px | Horizontal reach |
| Attack range (heavy) | 90px | Horizontal reach |
| Throw range | 50px | Must be this close |
| Projectile speed | 400px/sec | Luna's Lunar Beam |
| Projectile lifetime | 2sec | Despawn after distance |
| Round timer | 99 seconds | Standard fighting game timer |
| KO slow-motion | 500ms | At 0.3× speed |
| Perfect block window | 4 frames (66ms) | Increases to 8 with Reflexes upgrade |

### 10.5 Analytics Tracking Plan

All analytics events are tracked locally (localStorage) and optionally sent to portal analytics APIs. No external tracking services are used in MVP (Poki requirement: no external HTTP requests).

#### Core Events

| Event | Trigger | Data Payload | Purpose |
|---|---|---|---|
| `game_start` | App loaded, MainMenu visible | `{ timestamp, device, isTouch }` | Measure load-to-play funnel |
| `match_start` | Fight begins | `{ mode, character, stage, opponent, difficulty }` | Track mode/character popularity |
| `match_end` | Fight ends | `{ mode, character, result, score, roundsWon, roundsLost, duration, hpRemaining }` | Core engagement metric |
| `round_end` | Round concludes | `{ roundNumber, winner, hpRemaining, comboMax }` | Combat balance data |
| `ko` | KO occurs | `{ attacker, defender, move, comboCount, isCounter }` | Move effectiveness |
| `upgrade_selected` | Player picks upgrade | `{ upgradeId, roundNumber, runScore }` | Upgrade popularity |
| `run_complete` | Gauntlet run ends | `{ result, totalScore, upgradesUsed, character, duration }` | Session quality |
| `character_select` | Character chosen | `{ character, timesPlayed }` | Character popularity |
| `ad_watched` | Rewarded ad completed | `{ placement, timestamp }` | Monetization tracking |
| `ad_skipped` | Rewarded ad skipped | `{ placement }` | Ad fatigue detection |
| `level_up` | Player levels up | `{ newLevel, totalXP }` | Progression pacing |
| `session_end` | Game closed/tab hidden | `{ duration, matchesPlayed, highestScore }` | Session length |

#### Funnel Metrics

| Funnel Stage | Event | Target Conversion |
|---|---|---|
| **Load → Play** | `game_start` → `match_start` | > 85% within 10s |
| **First Match → Second** | `match_end` (first) → `match_start` (second) | > 50% |
| **Session → Return (D1)** | `session_end` → next day `game_start` | > 30% |
| **Session → Return (D7)** | `session_end` → 7-day `game_start` | > 10% |
| **Ad Opt-in Rate** | `ad_watched` / (ad prompt shown) | > 15% of eligible sessions |
| **Gauntlet Completion** | `run_complete` / `match_start` (gauntlet) | > 40% |

### 10.6 Accessibility Options

| Feature | Implementation | Phase |
|---|---|---|
| **Colorblind Mode** | 3 modes: Protanopia, Deuteranopia, Tritanopia — shifts HP bar colors and player indicators | Phase 1.5 |
| **Control Remapping** | Keyboard remapping in Settings; touch button positions adjustable | Phase 1.5 |
| **Audio Balance** | Separate sliders for SFX, Music, Announcer; mute toggle | MVP |
| **Screen Reader Support** | ARIA labels on menu buttons; alt-text for character portraits | Phase 2 |
| **High Contrast Mode** | Increased outline thickness on characters and UI elements; simplified backgrounds | Phase 2 |
| **Reduced Motion** | Disable screen shake, slow-motion, particle effects; toggle in Settings | Phase 1.5 |
| **Auto-Attack** | Optional simplified mode: character auto-attacks when in range (accessibility toggle) | Phase 3 |
| **Text Scale** | Small / Medium / Large text option for all UI text | Phase 2 |

### 10.7 Platform Compliance Matrix

| Requirement | Poki | CrazyGames | Our Status |
|---|---|---|---|
| 16:9 aspect ratio | ✅ Required | ✅ Recommended | ✅ 1280×720 + FIT |
| Desktop support | ✅ Required | ✅ Required | ✅ Keyboard + gamepad |
| Mobile support | ✅ Required | ✅ Required | ✅ Touch controls |
| Tablet force-touch | ✅ Required | — | ✅ Device detection |
| < 8MB initial load | ✅ Required | ≤ 50MB | ⚠️ Target: 7.65MB |
| ≤ 250MB total | — | ✅ Required | ✅ ~8MB |
| ≤ 1500 files | — | ✅ Required | ✅ Texture atlases |
| No external requests | ✅ Required | ✅ Required | ✅ All bundled |
| Incognito mode | ✅ Required | — | ✅ try/catch localStorage |
| Ad blocker safe | ✅ Required | ✅ Required | ✅ Game playable without ads |
| SDK events correct | ✅ Required | ✅ Required | ✅ @poki/phaser-3 |
| No ad interruptions | ✅ Required | ✅ Required | ✅ Natural breaks only |
| Audio mute during ads | ✅ Required | ✅ Required | ✅ AudioManager hook |
| Static + animated thumbs | ✅ Required for global | — | ⚠️ Art deliverable |
| Skippable sequences | ✅ Required | — | ✅ All skippable |
| PEGI 12 / Age 13+ | — | ✅ Required | ✅ No mature content |

### 10.8 Market Context (Sep 2026 — Updated v1.3)

Key market data points cross-verified via live web research on September 14–15, 2026:

#### Core Market Sizing

| Metric | Value | Source | Verification |
|---|---|---|---|
| **Fighting game market (2026)** | $1.58B–$4.8B | Multi-source cross-verified | ✅ Verified Market Research ($1.58B), MarkWide ($4.8B) |
| **Fighting game CAGR** | 4.2–8.7% | MarkWide, IndustryResearch, Verified Market Research | ✅ Confirmed |
| **Mobile fighting game market (2025)** | $4.31B | Dataintelo Fighting Mobile Game Market Report | ✅ Confirmed |
| **Mobile fighting CAGR (2026–2034)** | 9.2% | Dataintelo | ✅ Confirmed |
| **2D fighting games (2025)** | $1.77B | Data Insights Reports | ✅ Confirmed |
| **2D fighting CAGR** | 8.5% | Data Insights Reports | ✅ Confirmed |
| **HTML5/browser gaming market** | $6–8B | Verified Market Reports, TBRC | ✅ Verified Market Reports Jul 2026 |
| **Browser games market (2026)** | $8.01B | TBRC Feb 2026 | ✅ Confirmed |
| **Roguelite market (2025)** | $2.8B–$4.8B | Dataintelo, Verified Market Reports | ✅ Confirmed |

#### Platform Data

| Metric | Value | Source | Verification |
|---|---|---|---|
| **Poki MAU** | 100M+ | Poki LinkedIn, Yahoo Finance | ✅ Confirmed |
| **Poki players (2025)** | 625M | Yahoo Finance Mar 2026 | ✅ Confirmed |
| **Poki gameplays/month** | 1B+ | Poki developer portal, TheStreet Jun 2026 | ✅ Confirmed |
| **Poki employees** | 153 | Tracxn Aug 2026 | ✅ Up from 65 FTE |
| **Poki top studios revenue** | Up to €1M/year | Poki COO interview PocketGamer.biz Jul 2026 | ✅ Confirmed |
| **CrazyGames MAU** | 50–60M | LinkedIn (60M) vs developer portal (50M) | ✅ Confirmed |
| **CrazyGames annual revenue** | ~$24.6M | Tracxn company profile | ✅ Confirmed |
| **CrazyGames revenue split** | 60% ads / 70% IAP | CrazyGames 2026 GameMaker jam terms | ✅ Confirmed |

#### Demographics & Behavior

| Metric | Value | Source | Verification |
|---|---|---|---|
| **Browser gamers (monthly)** | 46% of online consumers | Poki 2026 (Atomik Research) | ✅ Confirmed |
| **Mobile browser traffic** | 62–81% of all browser game traffic | Poki 2026 study | ✅ Confirmed |
| **Mobile devs planning browser ports** | 53% in next 12 months | Poki 2026 (Atomik Research) | ✅ Confirmed |
| **Adults 18+ revenue share (fighting)** | 54.2% | Dataintelo 2024 | ✅ Confirmed |
| **Adults 18+ annual spend** | $32–$58 | Dataintelo 2024 | ✅ Confirmed |

#### Monetization Benchmarks

| Metric | Value | Source | Verification |
|---|---|---|---|
| **Rewarded ad opt-in rate** | 97% | AppLixir H1 2026 | ✅ Confirmed |
| **Rewarded ad completion rate** | 93.8% global, 95.4% tier-1 | AppLixir H1 2026 | ✅ Confirmed |
| **US web rewarded eCPM (net)** | $4–$8 ($6.98 US net) | AppLixir mid-year 2026 | ✅ Confirmed |
| **Poki revenue share** | 50% (own traffic) | Poki terms | ✅ Confirmed |
| **CrazyGames revenue share** | 60% ads / 70% IAP | CrazyGames terms | ✅ Confirmed |
| **F2P share of global market** | 61.5% | Straits Research Aug 2026 | ✅ Confirmed |

#### Season Pass Benchmarks (2026 Fighting Games)

| Game | Pass Type | Price | Duration | Notes |
|---|---|---|---|---|
| **2XKO (Riot)** | Free tier | $0 | Season | Warwick skin, avatar gear |
| **2XKO (Riot)** | Premium | ~$10 | Season | 4 character skins, avatar items |
| **2XKO (Riot)** | Ultra | ~$35 | Season | Everything + Arcane skin, 10 level skips |
| **Guilty Gear Strive** | Blazing Pass Plus | $4 | ~6 weeks | Accessories, UI skins |
| **Street Fighter 6** | Fighting Pass | $5 | ~1 month | 30 levels, costume colors |

**Key insight for Battle Brawl:** $4–$5 sweet spot for monthly battle passes. Free tier is mandatory in every major 2026 fighter.

**Competitive Landscape (Sep 2026):**
- 90%+ of browser fighters use generic stickman art
- Only ONE game on Poki offers online PvP (Gladihoppers — not a fighter)
- No browser fighter on portals uses roguelite structure
- New competitors: Stickman Fury (Jun 2026, 28K votes), Ultimate Evolution (Jun 2026)
- Roguelite + fighter validated on PC: PolyFighter (PAX/EVO 2026), Shot One Fighters ($221K Kickstarter), Garden Souls (TGA nominee dev)
- Phaser 3 is the dominant 2D browser engine: proven by Stickforge (4M+ players), Grapplenauts, DAWPUNCH, mITyFighter

---

*Game Design Document v1.3 — September 15, 2026*
*Based on market-analysis-report.md (Sep 15), competitor-analysis.md (Sep 15), game-concept.md (v6), gameplay-mechanics.md (v1.0), technical-architecture.md (v2.0)*
*All claims verified via live web research on September 14–15, 2026.*
*v1.2 → v1.3 changes: Updated market context (§10.8) with fresh post-analysis verification data — mobile fighting market ($4.31B, 9.2% CAGR), 2D fighting market ($1.77B, 8.5% CAGR), season pass benchmarks from 2026 fighting games, Phaser engine positioning data, adult demographics spending data.*
*v1.1 → v1.2 changes: Network architecture updated from Colyseus to Poki Netlib (§7.9), market data refreshed (§1.3, §10.8), new competitors added (Stickman Fury, Ultimate Evolution), Phase 2 online multiplayer effort reduced (20→15 days), added R9/R10 risks, added Colyseus fallback option.*
