# Gameplay Mechanics Design: Battle Brawl

**Version:** 1.0
**Date:** September 14, 2026
**Status:** Implementation-Ready Specification
**Source Documents:** game-design-document.md, game-concept.md, market-research.md, competitor-analysis.md
**Scope:** Physics, Tuning, Feedback Systems, Juice Effects, Input Handling, Difficulty Curve

---

## Table of Contents

1. [Physics System](#1-physics-system)
2. [Combat Tuning & Frame Data](#2-combat-tuning--frame-data)
3. [Character-Specific Mechanics](#3-character-specific-mechanics)
4. [Combo System Specification](#4-combo-system-specification)
5. [Input Handling System](#5-input-handling-system)
6. [Feedback Systems](#6-feedback-systems)
7. [Juice Effects](#7-juice-effects)
8. [Difficulty Curve](#8-difficulty-curve)
9. [Stage Physics & Boundaries](#9-stage-physics--boundaries)
10. [Projectile Mechanics](#10-projectile-mechanics)
11. [State Machine Specification](#11-state-machine-specification)
12. [Balance Formulas & Constants](#12-balance-formulas--constants)

---

## 1. Physics System

### 1.1 Engine Configuration

| Parameter | Value | Rationale |
|---|---|---|
| **Physics Engine** | Phaser Arcade Physics | Lightweight, sufficient for 2D fighter hitbox/hurtbox collision |
| **Gravity X** | 0 | No horizontal gravity |
| **Gravity Y** | 800 px/s² | Standard platformer gravity — feels responsive without being floaty |
| **World Bounds** | x: 240, y: 160, w: 800, h: 400 | Centered play area within 1280×720 viewport |
| **Max Physics Step** | 1000/60 ms (16.67ms) | Ensures 60fps physics updates |
| **Physics Iterations** | 10 | Sufficient for accurate collision at fighting game speeds |
| **Delta Smoothing** | true | Prevents physics spikes from frame drops |

### 1.2 Movement Physics

| Parameter | Value | Formula/Notes |
|---|---|---|
| **Ground Friction** | 0.85 | Applied per frame when no input; creates natural deceleration |
| **Air Friction** | 0.95 | Reduced friction in air for floatier feel |
| **Max Fall Speed** | 600 px/s | Terminal velocity prevents infinite acceleration |
| **Jump Cut** | 0.4× | Releasing jump early multiplies upward velocity by 0.4 — allows variable jump height |
| **Coyote Time** | 6 frames (100ms) | Grace period after leaving ground where jump is still valid |
| **Jump Buffer** | 8 frames (133ms) | Input jump slightly before landing; executes on land |
| **Dash Momentum** | 500 px/s initial → 0 px/s over 12 frames | Burst movement with exponential decay |
| **Back Dash Momentum** | 400 px/s initial → 0 px/s over 10 frames | Slightly weaker retreat option |
| **Air Dash** | Disabled in MVP | Unlockable via upgrade (Swift Feet) |
| **Walk Deceleration** | 100 px/s² | Applied when releasing movement input |

### 1.3 Jump Physics Detail

| Parameter | Value | Notes |
|---|---|---|
| **Initial Velocity** | -600 px/s (upward) | Negative = upward in Phaser coordinate system |
| **Gravity Multiplier (Rising)** | 1.0× | Standard gravity while rising |
| **Gravity Multiplier (Falling)** | 1.2× | Slightly faster fall for snappier feel |
| **Max Height** | ~180 px above ground | Achieved at frame ~20 (333ms) |
| **Total Air Time** | ~35 frames (583ms) | Jump to land |
| **Horizontal Momentum** | Preserved from ground | Walking momentum carries into jump |

**Jump Curve Formula:**
```
velocity_y(t) = -600 + (800 × gravity_multiplier × t)
height(t) = sum of velocity_y over frames
```

### 1.4 Collision Groups

| Group A | Group B | Behavior | Notes |
|---|---|---|---|
| Player1 (body) | Player2 (body) | Separate | Prevents overlap; pushes apart |
| Player1 (hitbox) | Player2 (hurtbox) | Overlap | Triggers hit detection |
| Player2 (hitbox) | Player1 (hurtbox) | Overlap | Triggers hit detection |
| Projectile | Player (hurtbox) | Overlap | Triggers projectile hit |
| Player (body) | StageBounds | Collide | Prevents leaving play area |
| Projectile | StageBounds | Collide | Destroys projectile on boundary hit |

### 1.5 Hitbox/Hurtbox System

**Implementation:** Sprite-based collision detection using Arcade Physics overlap callbacks, NOT per-pixel collision.

**Hitbox Sizes (relative to character anchor at feet center):**

| Body Part | Width | Height | Offset X | Offset Y | Notes |
|---|---|---|---|---|---|
| **Standing Hurtbox** | 48px | 88px | 0 | -88 | Full body, anchor at feet |
| **Crouching Hurtbox** | 48px | 56px | 0 | -56 | Reduced height when crouching |
| **Jump Hurtbox** | 48px | 80px | 0 | -80 | Slightly smaller in air |
| **Light Attack Hitbox** | 56px | 32px | +30 | -50 | Extends forward from fist |
| **Heavy Attack Hitbox** | 72px | 40px | +40 | -48 | Larger, extends further |
| **Throw Hitbox** | 40px | 40px | +20 | -50 | Close range only |
| **Special Hitbox** | Character-specific | Character-specific | Character-specific | Character-specific | Per character definition |

**Hitbox Timing:**
- Hitboxes are ONLY active during the "active frames" of an attack
- Hitbox sprite is invisible, has no physics body, is added as child of character
- On active frame start: enable hitbox collision
- On active frame end: disable hitbox collision
- Hitbox position mirrors character facing direction

**Hurtbox Behavior:**
- Always active except during invincibility frames
- Shrinks during crouch (88px → 56px height)
- Slightly smaller during jump (88px → 80px height)
- Disabled during back dash invincibility (8 frames)

---

## 2. Combat Tuning & Frame Data

### 2.1 Universal Frame Data

All frame data assumes 60fps. Frame counts are absolute, not relative to animation speed.

**Frame Phases:**
```
[Startup] → [Active] → [Recovery] → [Idle]
  (vulnerable)  (can hit)  (vulnerable)   (free)
```

**Frame Advantage Formula:**
```
Frame Advantage = (Hitstun of defender) - (Recovery of attacker)
Positive = attacker recovers first (frame advantage)
Negative = defender recovers first (frame disadvantage)
```

### 2.2 Rex (Balanced) — Complete Frame Data

| Move | Damage | Startup | Active | Recovery | Total | Hitstun | Blockstun | SP Cost | Frame Advantage (on hit) | Frame Advantage (on block) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light** | 7 | 6 | 3 | 4 | 13 | 12 | 8 | 0 | -1 | -4 |
| **Heavy** | 15 | 12 | 4 | 8 | 24 | 18 | 12 | 15 | -2 | -4 |
| **Special (Power Strike)** | 25 | 16 | 6 | 14 | 36 | 24 | 16 | 40 | -2 | -6 |
| **Throw** | 15 | 10 | 1 | 18 | 29 | 20 | — | 20 | +2 | unblockable |
| **Crouch Light** | 6 | 5 | 3 | 4 | 12 | 11 | 7 | 0 | -1 | -3 |
| **Crouch Heavy** | 14 | 14 | 5 | 10 | 29 | 20 | 14 | 15 | -2 | -5 |
| **Air Light** | 6 | 5 | 4 | 6 | 15 | 10 | 6 | 0 | — | — |
| **Air Heavy** | 13 | 10 | 5 | 10 | 25 | 16 | 10 | 15 | — | — |

### 2.3 Volt (Rushdown) — Complete Frame Data

| Move | Damage | Startup | Active | Recovery | Total | Hitstun | Blockstun | SP Cost | Frame Advantage (on hit) | Frame Advantage (on block) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light** | 6 | 4 | 3 | 3 | 10 | 11 | 7 | 0 | +1 | -2 |
| **Heavy** | 13 | 10 | 4 | 6 | 20 | 16 | 10 | 15 | 0 | -2 |
| **Special (Lightning Dash)** | 20 | 10 | 8 | 12 | 30 | 20 | 14 | 35 | 0 | -4 |
| **Throw** | 15 | 8 | 1 | 16 | 25 | 20 | — | 20 | +4 | unblockable |
| **Crouch Light** | 5 | 4 | 3 | 3 | 10 | 10 | 6 | 0 | +1 | -1 |
| **Crouch Heavy** | 12 | 10 | 4 | 8 | 22 | 16 | 10 | 15 | 0 | -2 |
| **Air Light** | 5 | 4 | 3 | 5 | 12 | 9 | 5 | 0 | — | — |
| **Air Heavy** | 11 | 8 | 4 | 8 | 20 | 14 | 8 | 15 | — | — |

**Volt Special Properties:**
- Lightning Dash passes through opponent (crossup possible)
- Dash distance: 300px
- Invincible frames 4–8 (5 frames of invincibility during dash)
- Can be special-cancelled from Light on hit

### 2.4 Titan (Grappler) — Complete Frame Data

| Move | Damage | Startup | Active | Recovery | Total | Hitstun | Blockstun | SP Cost | Frame Advantage (on hit) | Frame Advantage (on block) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light** | 8 | 8 | 4 | 5 | 17 | 14 | 10 | 0 | -1 | -5 |
| **Heavy** | 20 | 16 | 5 | 12 | 33 | 24 | 16 | 15 | -4 | -8 |
| **Special (Earth Slam)** | 30 | 24 | 8 | 16 | 48 | 30 | 20 | 50 | -4 | -10 |
| **Throw** | 25 | 8 | 1 | 22 | 31 | 24 | — | 20 | +2 | unblockable |
| **Crouch Light** | 7 | 7 | 3 | 5 | 15 | 12 | 8 | 0 | -1 | -4 |
| **Crouch Heavy** | 18 | 18 | 6 | 14 | 38 | 26 | 18 | 15 | -4 | -8 |
| **Air Light** | 7 | 7 | 4 | 7 | 18 | 12 | 8 | 0 | — | — |
| **Air Heavy** | 16 | 12 | 5 | 12 | 29 | 18 | 12 | 15 | — | — |

**Titan Special Properties:**
- Heavy attacks have **super armor** (absorbs 1 hit without flinching; Titan takes 50% damage during armored frames)
- Armor frames: Active frames + first 2 recovery frames
- Earth Slam has **ground wave** — secondary hitbox travels 200px along ground
- Earth Slam startup: 24 frames (very slow, very punishable on whiff)
- Throw range: 60px (longest in roster)

### 2.5 Luna (Zoner) — Complete Frame Data

| Move | Damage | Startup | Active | Recovery | Total | Hitstun | Blockstun | SP Cost | Frame Advantage (on hit) | Frame Advantage (on block) |
|---|---|---|---|---|---|---|---|---|---|---|
| **Light** | 5 | 5 | 3 | 3 | 11 | 10 | 6 | 0 | +1 | -1 |
| **Heavy** | 12 | 11 | 4 | 7 | 22 | 16 | 10 | 15 | -1 | -3 |
| **Special (Lunar Beam)** | 22 | 14 | 1 (projectile spawn) | 16 | 31 | 22 | 14 | 45 | varies | varies |
| **Throw** | 15 | 10 | 1 | 18 | 29 | 20 | — | 20 | +2 | unblockable |
| **Crouch Light** | 4 | 4 | 3 | 3 | 10 | 9 | 5 | 0 | +1 | -1 |
| **Crouch Heavy** | 10 | 12 | 4 | 8 | 24 | 14 | 8 | 15 | -1 | -3 |
| **Air Light** | 4 | 4 | 3 | 5 | 12 | 8 | 4 | 0 | — | — |
| **Air Heavy** | 10 | 9 | 4 | 9 | 22 | 14 | 8 | 15 | — | — |

**Luna Special Properties:**
- Lunar Beam is a **projectile** (see Section 10 for full projectile mechanics)
- Beam speed: 500 px/s
- Beam size: 60px × 24px
- Beam pierces through opponent (does not disappear on hit)
- Beam lifetime: 2 seconds (travels full screen)
- Luna is **vulnerable during special recovery** (16 frames of recovery)
- Shortest throw range: 40px

### 2.6 Block System Tuning

| Block Type | Input Window | Blocks | Blocked Damage | SP Drain | SP Refund | Advantage |
|---|---|---|---|---|---|---|
| **Standing Block** | Hold Block + no down | High attacks, throws | 0 | 5 SP/frame | — | Varies |
| **Crouching Block** | Hold Block + down | Low attacks | 0 | 5 SP/frame | — | Varies |
| **Perfect Block** | Block within 4 frames of impact | Any attack | 0 | 0 (no drain) | +10 SP | +4 frames |
| **Air Block** | Hold Block while airborne | Any attack | 0 | 5 SP/frame | — | -6 frames |

**Guard Break:**
- SP reaches 0 while blocking → guard broken
- **Guard Break Stagger:** 30 frames (500ms) — character stumbles backward 40px
- Cannot block during stagger
- Cannot attack during stagger
- Can be hit (no invincibility)
- SP fully restores after stagger ends

**Frame Advantage Table (On Block):**

| Attack | Blockstun | Blocker Recovery | Attacker Recovery | Net Advantage |
|---|---|---|---|---|
| Light | 8 frames | 8 frames | 4 frames | -4 (attacker disadvantaged) |
| Heavy | 12 frames | 12 frames | 8 frames | -4 |
| Throw | — | — | — | Unblockable |

### 2.7 Hitstun & Knockback

| Attack Type | Hitstun (frames) | Knockback X (px) | Knockback Y (px) | Notes |
|---|---|---|---|---|
| Light (ground) | 10–14 | 40 | 0 | Stagger backward |
| Heavy (ground) | 16–22 | 80 | 0 | Large stagger |
| Heavy (counter-hit) | 20–26 | 100 | -100 | Launches opponent into air |
| Special | 20–28 | 120 | 0 | Character-specific variations |
| Throw | 20–24 | 100 | -60 | Launch + stagger |
| Light (air) | 8–12 | 30 | 0 | Brief stun |
| Heavy (air) | 14–18 | 60 | 40 | Slam down |

**Hitstun Formula:**
```
hitstun = base_hitstun + (damage / 3)
```
Example: Rex Light (7 damage) → 10 + 2 = 12 frames hitstun

**Knockback Formula:**
```
knockback_x = base_knockback × (1 + damage / 50)
knockback_y = base_knockback_y × (1 + damage / 80)
```

---

## 3. Character-Specific Mechanics

### 3.1 Character Stat Comparison

| Stat | Rex | Volt | Titan | Luna |
|---|---|---|---|---|
| **HP** | 100 | 85 | 120 | 90 |
| **SP** | 100 | 90 | 80 | 110 |
| **Walk Speed** | 200 px/s | 250 px/s | 160 px/s | 190 px/s |
| **Jump Velocity** | -600 | -650 | -500 | -600 |
| **Weight** | 1.0 | 0.85 | 1.2 | 0.95 |
| **Light Damage** | 7 | 6 | 8 | 5 |
| **Heavy Damage** | 15 | 13 | 20 | 12 |
| **Special Damage** | 25 | 20 | 30 | 22 |
| **Throw Damage** | 15 | 15 | 25 | 15 |
| **Walk Speed Rank** | 2nd | 1st | 4th | 3rd |
| **Damage Rank** | 2nd | 3rd | 1st | 4th |

**Weight System:**
- Weight affects how far a character is knocked back
- Higher weight = less knockback = harder to juggle
- Formula: `actual_knockback = base_knockback / weight`
- Titan (1.2) takes 17% less knockback than Rex (1.0)
- Volt (0.85) takes 18% more knockback than Rex

### 3.2 Character Special Move Specifications

#### Rex — Power Strike
| Property | Value |
|---|---|
| Type | Mid-range shockwave |
| Startup | 16 frames |
| Active | 6 frames |
| Recovery | 14 frames |
| Damage | 25 |
| SP Cost | 40 |
| Range | 120px horizontal |
| Hitbox | 120px × 48px, ground level |
| Knockback | 100px horizontal, 0px vertical |
| Visual | Orange energy wave emanating from fist |
| Sound | Heavy impact + energy whoosh |

#### Volt — Lightning Dash
| Property | Value |
|---|---|
| Type | Forward dash attack |
| Startup | 10 frames |
| Active | 8 frames (during dash) |
| Recovery | 12 frames |
| Damage | 20 |
| SP Cost | 35 |
| Dash Distance | 300px |
| Invincibility | Frames 4–8 (5 frames) |
| Hitbox | 48px × 64px (full body during dash) |
| Knockback | 80px horizontal, 0px vertical |
| Special | Passes through opponent (crossup) |
| Visual | Blue lightning trail |
| Sound | Electric zap + dash whoosh |

#### Titan — Earth Slam
| Property | Value |
|---|---|
| Type | Ground pound with wave |
| Startup | 24 frames |
| Active | 8 frames |
| Recovery | 16 frames |
| Damage | 30 (direct), 20 (wave) |
| SP Cost | 50 |
| Wave Range | 200px horizontal along ground |
| Hitbox (direct) | 80px × 64px, centered |
| Hitbox (wave) | 200px × 32px, ground level |
| Knockback | 120px horizontal, -60px vertical (launch) |
| Visual | Ground crack + stone debris |
| Sound | Deep rumble + stone impact |

#### Luna — Lunar Beam
| Property | Value |
|---|---|
| Type | Full-screen projectile |
| Startup | 14 frames (beam fires at frame 14) |
| Active | 1 frame (spawn) |
| Recovery | 16 frames |
| Damage | 22 |
| SP Cost | 45 |
| Projectile Speed | 500 px/s |
| Projectile Size | 60px × 24px |
| Projectile Lifetime | 2 seconds |
| Pierce | Yes (passes through opponent) |
| Knockback | 60px horizontal, 0px vertical |
| Visual | Purple crescent energy beam |
| Sound | Ethereal energy whoosh |

### 3.3 Air Attack Rules

| Rule | Value | Notes |
|---|---|---|
| **Air attacks allowed** | Yes | Light, Heavy, Special (character-specific) |
| **Air attack limit** | 1 per jump | Only one air attack per jump (no double attack) |
| **Air special allowed** | Yes | Costs SP; different properties than ground special |
| **Air blocking** | Yes | Allowed but with -6 frame disadvantage |
| **Air throw** | No | Throws are ground-only in MVP |
| **Landing recovery** | 4 frames | If attacking when landing, enter 4-frame recovery |
| **Juggle gravity** | 1.0× | Same as normal gravity during juggle |
| **Juggle limit** | 3 hits max per juggle | Prevents infinite combos |
| **OTG (off-the-ground)** | No | Knocked-down characters cannot be hit while grounded |

### 3.4 Knockdown & Wake-up

| Parameter | Value | Notes |
|---|---|---|
| **Knockdown trigger** | Heavy attack counter-hit OR throw | Launches character into air |
| **Air time** | 20–30 frames | Depends on damage/weight |
| **Ground bounce** | Yes | Character bounces once on landing |
| **Bounce height** | 40px | Small bounce for visual clarity |
| **Wake-up time** | 15 frames (250ms) | Time from landing to standing |
| **Wake-up options** | Block, nothing | Cannot attack during wake-up |
| **Wake-up invincibility** | 0 frames | Vulnerable immediately on landing |

---

## 4. Combo System Specification

### 4.1 Combo Timing Windows

| Window Type | Duration | Description |
|---|---|---|
| **Chain Window** | 8 frames (133ms) | Window to input next attack in auto-chain |
| **Link Window** | 16 frames (267ms) | Window to input next attack as a link (separate hit) |
| **Cancel Window** | 6 frames (100ms) | Window to cancel attack recovery into special |
| **Buffer Window** | 12 frames (200ms) | General input buffer for all actions |

**Chain vs Link:**
- **Chain:** Attacks auto-link with slight advantage; beginner-friendly (L→L→H)
- **Link:** Next attack must land within hitstun window; requires timing skill
- **Cancel:** Special move can interrupt heavy attack recovery; costs extra stamina

### 4.2 Combo Routes (Universal)

#### Basic Chain (All Characters)
```
Light → Light → Heavy
Damage: 7+7+15 = 29 (Rex)
Difficulty: Easy (auto-chain)
SP Cost: 0+0+15 = 15
```

#### Launch Combo (Counter-Hit Required)
```
Heavy (counter-hit) → Air Light → Air Heavy → Slam
Damage: 15×1.25 + 6 + 13 = 37.75 → ~38 (Rex, with counter bonus)
Difficulty: Medium (requires counter-hit confirm)
SP Cost: 15+0+15 = 30
```

#### Special Cancel Combo
```
Heavy → Special
Damage: 15 + 25 = 40 (Rex)
Difficulty: Medium (6-frame cancel window)
SP Cost: 15+40 = 55
```

#### Air Combo
```
Jump → Air Light → Air Heavy → Slam
Damage: 6 + 13 = 19 (Rex)
Difficulty: Easy-Medium
SP Cost: 0+15 = 15
```

### 4.3 Combo Scaling

| Combo Hit | Damage Multiplier | Notes |
|---|---|---|
| Hit 1 | 100% | Full damage |
| Hit 2 | 90% | Slight reduction |
| Hit 3 | 80% | Moderate reduction |
| Hit 4 | 70% | Significant reduction |
| Hit 5+ | 60% | Minimum scaling |

**Scaling Formula:**
```
scaled_damage = base_damage × max(0.6, 1.0 - (combo_hit - 1) × 0.1)
```

**Maximum Combo Length:**
- Universal: 6 hits (limited by scaling and hitstun decay)
- With "Flow State" upgrade: 7 hits
- Air combos: 3 hits max (juggle limit)

### 4.4 Combo Counter Display

| Combo Count | Color | Size | Effect |
|---|---|---|---|
| 1–2 | White | 24px | No special effect |
| 3–4 | Yellow | 32px | Slight pulse |
| 5–6 | Red | 40px | Screen flash, +25 XP bonus |
| 7+ | Purple | 48px | Major screen effect, +50 XP bonus |

### 4.5 Combo Breakers

| Mechanic | Trigger | Effect |
|---|---|---|
| **Mash Out** | Rapid inputs during hitstun | Reduces hitstun by 2 frames per successful mash (max 4 frames) |
| **Perfect Block** | Block within 4 frames | Breaks combo, grants +4 frame advantage |
| **Invincible Reversal** | Special move with i-frames on wake-up | Beats meaty attacks (Volt Lightning Dash) |
| **Super Armor** | Titan Heavy (absorbs 1 hit) | Continues attack through one hit |

---

## 5. Input Handling System

### 5.1 Unified Input Manager Architecture

```
┌─────────────────────────────────────────────────────────┐
│                   INPUT PIPELINE                         │
│                                                         │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐           │
│  │ Keyboard  │   │ Gamepad  │   │  Touch   │           │
│  │ Raw Input │   │ Raw Input│   │ Raw Input│           │
│  └─────┬────┘   └─────┬────┘   └─────┬────┘           │
│        │              │              │                  │
│        ▼              ▼              ▼                  │
│  ┌──────────────────────────────────────────┐          │
│  │         NORMALIZATION LAYER              │          │
│  │  Raw input → Action (per player)         │          │
│  └──────────────────┬───────────────────────┘          │
│                     │                                   │
│                     ▼                                   │
│  ┌──────────────────────────────────────────┐          │
│  │         INPUT BUFFER (12 frames)         │          │
│  │  Queues last valid action                │          │
│  └──────────────────┬───────────────────────┘          │
│                     │                                   │
│                     ▼                                   │
│  ┌──────────────────────────────────────────┐          │
│  │         ACTION STATE (per frame)         │          │
│  │  Current frame's final actions           │          │
│  └──────────────────┬───────────────────────┘          │
│                     │                                   │
│                     ▼                                   │
│              Game Logic (Fighter State Machine)         │
└─────────────────────────────────────────────────────────┘
```

### 5.2 Action Map

| Action | Keyboard P1 | Keyboard P2 | Gamepad (Xbox Layout) | Touch |
|---|---|---|---|---|
| `moveLeft` | A | Left Arrow | Left Stick Left / D-Pad Left | Joystick Left |
| `moveRight` | D | Right Arrow | Left Stick Right / D-Pad Right | Joystick Right |
| `moveUp` | W | Up Arrow | Left Stick Up / D-Pad Up | Joystick Up (disabled for jump in fighting context) |
| `moveDown` | S | Down Arrow | Left Stick Down / D-Pad Down | Joystick Down |
| `jump` | W | Up Arrow | Button South (A) | Jump Button |
| `crouch` | S | Down Arrow | Left Stick Down | Joystick Down |
| `lightAttack` | J | Numpad 1 | Button West (X) | A Button |
| `heavyAttack` | K | Numpad 2 | Button North (Y) | B Button |
| `block` | L | Numpad 3 | Button East (B) | Block Button |
| `special` | Space | Numpad 0 | Left Trigger (LT) | Special Button (Phase 2) |
| `pause` | Escape | Escape | Start / Menu | Pause Icon |

### 5.3 Input Buffer Implementation

**Buffer Size:** 12 frames (200ms at 60fps)

**Buffer Rules:**
1. When an input is received during a state where it cannot be executed (e.g., attacking), it is queued in the buffer
2. Buffer stores the LAST valid input per action type (no flooding)
3. Buffer clears on state transition (when action becomes available)
4. If buffer expires (12 frames pass), input is discarded
5. Priority: `jump` > `block` > `attack` > `move`

**Buffer State Machine:**
```
Input Received → Action Available?
  → YES: Execute immediately
  → NO: Queue in buffer
    → Buffer slot occupied? → Overwrite with new input
    → Buffer slot empty → Store with 12-frame TTL
    → TTL expires → Discard input
```

**Edge Case: Simultaneous Inputs**
- If multiple actions are buffered simultaneously, execute in priority order:
  1. Jump (highest priority)
  2. Block
  3. Special
  4. Heavy Attack
  5. Light Attack
  6. Crouch
  7. Move (lowest priority)

### 5.4 Keyboard Configuration

**Debouncing:**
- Key down events are NOT debounced (need frame-perfect inputs)
- Key up events are debounced (50ms) to prevent phantom releases

**Ghosting Prevention:**
- Uses `event.code` instead of `event.key` for layout independence
- Anti-ghosting: track all keys pressed this frame, resolve conflicts by priority

**Key Repeat:**
- Movement keys (WASD / Arrows): NO repeat — continuous while held
- Attack keys: NO repeat — must release and press for next attack
- This prevents accidental double-taps during intense combat

### 5.5 Gamepad Configuration

**Dead Zone:**
- Left Stick: 0.2 (20% dead zone) — prevents drift
- Triggers: 0.1 (10% dead zone)

**Rumble/Haptics:**
- Light hit: 0.2 intensity, 50ms
- Heavy hit: 0.5 intensity, 100ms
- KO: 0.8 intensity, 200ms
- Block: 0.3 intensity, 30ms

**Analog to Digital:**
- Left stick X-axis: -0.5 = Left, +0.5 = Right
- Left stick Y-axis: -0.5 = Up (jump), +0.5 = Down (crouch)
- D-Pad: Digital, direct mapping

**Gamepad Detection:**
- Listen for `gamepadconnected` / `gamepaddisconnected` events
- On disconnect: pause game, show "Reconnect Controller" prompt
- Auto-detect controller type (Xbox/PlayStation/Switch) for button prompts

### 5.6 Touch Controls Specification

**Layout Zones:**

| Zone | Position | Size | Content |
|---|---|---|---|
| **Movement Zone** | Left 50%, bottom 60% | 640×432px | Virtual joystick |
| **Action Zone** | Right 50%, bottom 60% | 640×432px | Attack/block buttons |
| **HUD Zone** | Top 20% | 1280×144px | No touch input (reserved for HUD) |
| **Jump Zone** | Left 25%, bottom 20% | 320×144px | Jump button |

**Virtual Joystick:**

| Property | Value |
|---|---|
| Base Radius | 64px |
| Stick Radius | 40px |
| Base Opacity | 30% (idle), 50% (active) |
| Stick Opacity | 60% (idle), 80% (active) |
| Dead Zone | 16px (25% of base) |
| Max Displacement | 48px (75% of base) |
| Color | White |
| Activation | Touch anywhere in left 50% of screen |

**Button Specifications:**

| Button | Size | Position | Opacity (Idle) | Opacity (Pressed) |
|---|---|---|---|---|
| **Jump** | 64×64px | Bottom-left | 40% | 80% |
| **Light Attack (A)** | 56×56px | Right side, upper | 40% | 80% |
| **Heavy Attack (B)** | 56×56px | Right side, lower-right of A | 40% | 80% |
| **Block** | 64×64px | Right side, bottom | 40% | 80% |

**Touch Behavior:**
- Multi-touch supported: 4 simultaneous pointers
- Each button tracks its own pointer ID
- Button press = pointer enter + pointer down
- Button release = pointer leave OR pointer up
- No input conflicts between left/right zones (exclusive pointer tracking)

**Tablet Override:**
- If `navigator.maxTouchPoints > 0` AND device is tablet (detected via UA) → force touch controls
- Always show touch controls regardless of other input methods

### 5.7 Input Latency Requirements

| Platform | Target Input Latency | Method |
|---|---|---|
| Desktop (keyboard) | < 1 frame (16.67ms) | Direct key event handling |
| Desktop (gamepad) | < 2 frames (33.33ms) | Gamepad polling at 60Hz |
| Mobile (touch) | < 2 frames (33.33ms) | Touch event + buffer |
| Mobile (low-end) | < 3 frames (50ms) | Acceptable degradation |

---

## 6. Feedback Systems

### 6.1 Hit Feedback Matrix

| Hit Type | Visual | Audio | Camera | UI | Haptic |
|---|---|---|---|---|---|
| **Light hit** | White flash (2 frames) | Light impact SFX | None | Floating number (5–8) | Light rumble (0.2, 50ms) |
| **Heavy hit** | White flash (3 frames) + particle burst | Heavy impact SFX | Screen shake (4px, 150ms) | Floating number (12–18) | Medium rumble (0.5, 100ms) |
| **Special hit** | White flash (4 frames) + large particle burst | Special SFX + screen rumble | Screen shake (6px, 200ms) + zoom (1.1×) | Floating number (20–30) + combo counter | Strong rumble (0.7, 150ms) |
| **Counter-hit** | Red flash (3 frames) + freeze frame (4 frames) | Counter SFX (distinct) | Screen shake (8px, 250ms) | "COUNTER!" text pop | Strong rumble (0.8, 100ms) |
| **Perfect block** | Blue flash (2 frames) + shield particle | Block SFX (sharp) | Screen shake (2px, 100ms) | "PERFECT!" text pop | Light rumble (0.3, 30ms) |
| **Regular block** | Gray flash (2 frames) | Block SFX (dull) | None | — | None |
| **Guard break** | Red screen flash (4 frames) + stagger animation | Break SFX (cracking) | Screen shake (6px, 300ms) | "GUARD BREAK!" text | Strong rumble (0.8, 200ms) |
| **KO** | White flash (4 frames) + KO particles | KO SFX + announcer | Slow-mo (0.3× speed, 500ms) + zoom (1.3×) | "K.O.!" text (scale animation) | Strong rumble (0.8, 300ms) |
| **Throw** | Grab animation (2 frames) + impact | Grab SFX + impact | Screen shake (4px, 150ms) | Floating number (15) | Medium rumble (0.5, 100ms) |

### 6.2 Damage Number System

| Property | Value | Notes |
|---|---|---|
| **Base Size** | 20px | Increases with combo count |
| **Combo Scaling** | +2px per combo hit | Up to 32px max |
| **Color** | White (normal), Yellow (5+ combo), Red (heavy), Purple (counter) |
| **Rise Speed** | 60px/sec upward | Rises then fades |
| **Fade Duration** | 500ms | Complete fadeout |
| **Horizontal Offset** | ±20px random | Prevents overlap |
| **Vertical Offset** | -80px (above character) | Starts above hit position |

### 6.3 HP Bar Feedback

| HP Range | Bar Color | Visual Effect |
|---|---|---|
| 100–60% | Green | No effect |
| 59–30% | Yellow | Slight pulse at 1Hz |
| 29–10% | Orange | Pulse at 2Hz |
| 9–0% | Red | Rapid pulse at 3Hz + screen edge red vignette |
| KO | Gray | Bar drains to 0 with 500ms animation |

**Damage Display:**
- HP bar shows "ghost" segment (white portion) that drains over 500ms after damage
- Creates anticipation of how much HP was lost
- Ghost segment color: White at 30% opacity

### 6.4 SP Bar Feedback

| SP Range | Bar Color | Visual Effect |
|---|---|---|
| 100–50% | Blue | No effect |
| 49–20% | Dark Blue | Slight dimming |
| 19–0% | Dark Blue + Red tint | Pulse at 2Hz when blocking |
| Full (100%) | Bright Blue + glow | Ready indicator |

**SP Regeneration Display:**
- Regeneration shown as small green ticks that rise from the bar
- Speed: matches actual regen rate (8 SP/sec = ~8 ticks/sec)
- Creates satisfying visual feedback for resource recovery

### 6.5 Combo Counter Feedback

| Combo Count | Display | Animation | Color | Sound |
|---|---|---|---|---|
| 1–2 | "1x" / "2x" | Scale in (1.0→0.8→1.0) | White | — |
| 3–4 | "3x" / "4x" | Scale in + slight shake | Yellow | Combo SFX (low) |
| 5–6 | "5x" / "6x" | Scale in + strong shake | Red | Combo SFX (high) |
| 7+ | "7x"+ | Scale in + major shake + glow | Purple + glow | Combo SFX (max) + screen flash |

**Combo Reset:**
- Timer: 2 seconds between hits
- If no hit within 2 seconds → combo resets to 0
- Visual: counter fades out over 300ms
- Audio: fade-out sound on reset

### 6.6 Round Announcement System

| Announcement | Timing | Animation | Duration | Audio |
|---|---|---|---|---|
| **"ROUND 1"** | Before fight starts | Scale from 0 to 1.5 to 1.0 | 1.5 sec | Announcer voice |
| **"FIGHT!"** | After "ROUND 1" | Scale from 0 to 1.0 + screen flash | 0.5 sec | Announcer voice |
| **"K.O.!"** | On KO | Scale from 0 to 2.0 to 1.5 + red glow | 2.0 sec | Announcer voice + impact |
| **"VICTORY"** | After K.O. (if match won) | Slide up from bottom + scale | 1.0 sec | Victory music sting |
| **"DEFEAT"** | After K.O. (if match lost) | Slide up from bottom + scale | 1.0 sec | Defeat music sting |
| **"PERFECT"** | If no damage taken | Scale from 0 to 1.0 + gold glow | 1.5 sec | Special announcer + gold particles |
| **"TIME UP"** | Timer reaches 0 | Flash on screen + text | 1.0 sec | Buzzer SFX |

---

## 7. Juice Effects

### 7.1 Screen Shake System

| Trigger | Intensity (px) | Duration (ms) | Decay | Frequency |
|---|---|---|---|---|
| Light hit | 0 | 0 | — | — |
| Heavy hit | 4 | 150 | Exponential | 60Hz |
| Special hit | 6 | 200 | Exponential | 60Hz |
| Counter-hit | 8 | 250 | Exponential | 60Hz |
| KO | 10 | 400 | Exponential | 60Hz |
| Perfect block | 2 | 100 | Linear | 60Hz |
| Guard break | 6 | 300 | Exponential | 60Hz |
| Boss phase shift | 8 | 300 | Exponential | 60Hz |

**Shake Formula:**
```
shake_offset = intensity × sin(time × frequency) × decay_factor
decay_factor = e^(-time / duration)
```

**Implementation Notes:**
- Use Phaser's `camera.shake()` method
- Stack multiple shakes additively (e.g., heavy hit + counter-hit)
- Maximum shake: 12px (prevent motion sickness)
- Shake is camera-relative, not world-relative

### 7.2 Hit Stop (Freeze Frame) System

| Trigger | Duration (frames) | Duration (ms) | Effect |
|---|---|---|---|
| Light hit | 2 | 33ms | Brief pause, feels snappy |
| Heavy hit | 4 | 67ms | Significant pause, emphasizes impact |
| Special hit | 6 | 100ms | Major pause, dramatic moment |
| Counter-hit | 4 | 67ms | Combined with red flash |
| KO | 8 | 133ms | Extended pause for drama |
| Perfect block | 2 | 33ms | Brief pause, skill reward |

**Hit Stop Rules:**
1. Both fighters freeze (no animation, no physics)
2. Particles continue (creates visual contrast)
3. Camera does NOT freeze (shake continues during hitstop)
4. Audio does NOT freeze (impact sound plays during hitstop)
5. Hit stop stacks: if new hit occurs during hitstop, add frames (max 12 total)
6. Hitstop is frame-rate independent (uses real time)

### 7.3 Particle System

**Particle Types:**

| Particle | Trigger | Count | Speed | Lifetime | Gravity | Color |
|---|---|---|---|---|---|---|
| **Hit Spark** | Any hit | 8–12 | 200–400 px/s | 200–400ms | 200 px/s² | Attacker color |
| **Block Spark** | Block | 4–6 | 100–200 px/s | 150–300ms | 100 px/s² | White/Gray |
| **Dust** | Land from jump | 6–8 | 50–100 px/s | 300–500ms | 50 px/s² | Brown/Tan |
| **KO Burst** | KO | 20–30 | 300–600 px/s | 500–800ms | 150 px/s² | Red/Orange |
| **Special Trail** | Special move | 10–15 | 100–300 px/s | 300–600ms | 0 | Character color |
| **Counter Flash** | Counter-hit | 12–16 | 400–600 px/s | 200–400ms | 100 px/s² | Red |
| **Guard Break** | Guard break | 15–20 | 200–400 px/s | 400–600ms | 200 px/s² | Red/Orange |

**Particle Configuration:**
- Use Phaser's built-in particle system (Phaser 3.90)
- Max particles: 100 per emitter
- Particle textures: Simple circles (2px–8px) or small shapes
- Blend mode: ADD for sparks, NORMAL for dust
- Pool size: 200 particles (recycled, not destroyed)

**Ambient Particles (Stage-Specific):**

| Stage | Particle | Count | Behavior |
|---|---|---|---|
| **Neon Arena** | Rain | 50 | Falling, 300px/s, infinite |
| **Neon Arena** | Neon flicker | 5–10 | Floating, color-shifting |
| **Rooftop** | Wind debris | 20 | Horizontal, 100–200px/s |
| **Rooftop** | Birds | 3–5 | Circular flight paths |
| **Dojo** | Dust motes | 15 | Floating, 10–30px/s |
| **Dojo** | Scroll flutter | 2–3 | Sway animation |

### 7.4 Slow Motion System

| Trigger | Speed | Duration | Zoom | Transition |
|---|---|---|---|---|
| **KO finish** | 0.3× | 500ms | 1.3× | Smooth over 200ms |
| **Last-hit KO** | 0.2× | 800ms | 1.5× | Smooth over 300ms |
| **Counter-hit** | 0.5× | 200ms | None | Instant on/off |
| **Perfect block** | 0.6× | 150ms | None | Instant on/off |

**Slow Motion Rules:**
1. Only triggered on important moments (not every hit)
2. Maximum 1 slow-motion active at a time
3. Slow-motion scales all animations, physics, and timers
4. UI remains at normal speed (damage numbers, combo counter)
5. Audio pitch unchanged (only speed changes)
6. Disabled during hitstop (hitstop takes priority)

### 7.5 Camera Zoom System

| Trigger | Target Zoom | Duration | Transition | Recovery |
|---|---|---|---|---|
| **Default** | 1.0× | — | — | — |
| **Special activation** | 1.1× | 300ms | Smooth (lerp) | Smooth (lerp) |
| **KO finish** | 1.3× | 500ms | Smooth (lerp) | Reset on round start |
| **Both players far apart** | 0.95× | 200ms | Smooth (lerp) | Smooth (lerp) |
| **Both players close** | 1.05× | 200ms | Smooth (lerp) | Smooth (lerp) |

**Zoom Rules:**
1. Zoom is relative to the midpoint between both players
2. Camera follows the midpoint with slight weighting toward P1 (60/40)
3. Zoom is clamped to stage bounds (never shows outside play area)
4. Zoom transitions use exponential interpolation (lerp)

### 7.6 Hit Flash System

| Trigger | Flash Color | Duration | Intensity |
|---|---|---|---|
| **Normal hit** | White | 2 frames (33ms) | 100% |
| **Heavy hit** | White | 3 frames (50ms) | 100% |
| **Counter-hit** | Red | 3 frames (50ms) | 100% |
| **Special hit** | White | 4 frames (67ms) | 100% |
| **Block** | Gray | 2 frames (33ms) | 60% |
| **Perfect block** | Blue | 2 frames (33ms) | 100% |
| **KO** | White | 4 frames (67ms) | 100% |

**Implementation:**
- Set sprite tint to flash color
- Reset tint after duration
- Use `Phaser.Math.Interpolation.Linear` for smooth transitions
- Flash intensity can be reduced via "Reduced Motion" accessibility option

### 7.7 Screen Edge Effects

| Effect | Trigger | Parameters |
|---|---|---|
| **Red Vignette** | HP < 30% | Opacity scales with HP loss (0.0 at 30%, 0.5 at 0%) |
| **Blue Flash** | SP full | Brief blue flash on screen edges (200ms) |
| **KO Flash** | KO | Full-screen white flash (4 frames) |
| **Round Start** | Round start | Full-screen fade from black (500ms) |

---

## 8. Difficulty Curve

### 8.1 Gauntlet Difficulty Progression

| Fight | AI Tier | HP | Damage Multiplier | SP Multiplier | Reaction Time | Combo Knowledge | SP Regen Rate |
|---|---|---|---|---|---|---|---|
| **Fight 1** | Novice | 80 | 0.8× | 0.8× | 500ms | None | 6 SP/s |
| **Fight 2** | Easy | 90 | 0.9× | 0.9× | 350ms | 2-hit combos | 7 SP/s |
| **Fight 3** | Medium | 100 | 1.0× | 1.0× | 200ms | 3-hit combos | 8 SP/s |
| **Fight 4** | Hard | 110 | 1.1× | 1.1× | 100ms | 4+ combos, anti-airs | 9 SP/s |
| **Fight 5 (Boss)** | Boss | 120 | 1.2× | 1.2× | 80ms | Full combos, frame traps | 10 SP/s |

### 8.2 AI Behavior Progression

#### Novice (Fight 1)
- **Attack Pattern:** Random light attacks, rarely heavy
- **Block Rate:** 10%
- **Combo Knowledge:** None (single hits only)
- **Approach:** Walks toward player slowly
- **Special Usage:** Never
- **Throw Usage:** Never
- **Anti-Air:** Never
- **Punish:** Never (whiffs are safe)
- **Spacing:** Stays at random distances
- **Decision Speed:** 500ms (very slow reactions)

#### Easy (Fight 2)
- **Attack Pattern:** Light attacks + occasional heavy
- **Block Rate:** 30%
- **Combo Knowledge:** 2-hit combos (L→L or L→H)
- **Approach:** Walks toward player, occasionally jumps
- **Special Usage:** 10% chance when SP full
- **Throw Usage:** Never
- **Anti-Air:** Never
- **Punish:** Never
- **Spacing:** Maintains some distance
- **Decision Speed:** 350ms

#### Medium (Fight 3)
- **Attack Pattern:** Mixed light/heavy, uses specials
- **Block Rate:** 50%
- **Combo Knowledge:** 3-hit combos (L→L→H), basic cancel
- **Approach:** Active approach, mixes jump-ins
- **Special Usage:** 25% chance
- **Throw Usage:** 10% chance (close range only)
- **Anti-Air:** 20% chance (jumps to intercept)
- **Punish:** Basic (punishes obvious whiffs)
- **Spacing:** Intentional spacing for pokes
- **Decision Speed:** 200ms

#### Hard (Fight 4)
- **Attack Pattern:** Optimized pressure, frame traps
- **Block Rate:** 70%
- **Combo Knowledge:** 4+ hit combos, launch combos, special cancels
- **Approach:** Aggressive, mixes safe pressure with crossups
- **Special Usage:** 40% chance
- **Throw Usage:** 20% chance (tech-chase scenarios)
- **Anti-Air:** 50% chance (consistent)
- **Punish:** Consistent (punishes all major whiffs)
- **Spacing:** Optimal spacing for character matchup
- **Decision Speed:** 100ms

#### Boss (Fight 5)
- **Attack Pattern:** Adaptive, reads player patterns
- **Block Rate:** 80%
- **Combo Knowledge:** Full combo repertoire, optimal punishes
- **Approach:** Adaptive (aggressive vs passive players)
- **Special Usage:** 50% chance
- **Throw Usage:** 30% chance
- **Anti-Air:** 70% chance
- **Punish:** Frame-perfect on heavy whiffs
- **Spacing:** Adaptive based on player tendencies
- **Decision Speed:** 80ms
- **Phase Shifts:** At 66% HP and 33% HP, AI becomes more aggressive
- **Signature Mechanic:** Character-specific boss ability (e.g., Rex Boss has extended range on all attacks)

### 8.3 AI Decision Tree (Formal)

```
Every [reaction_time] ms:
│
├─ STATE ASSESSMENT
│  ├─ Am I in hitstun? → YES → Do nothing (wait for recovery)
│  ├─ Am I in blockstun? → YES → Continue blocking
│  ├─ Am I in attack recovery? → YES → Nothing (committed)
│  ├─ Am I guard broken? → YES → Play defensive (retreat, no block)
│  └─ Am I in KO? → YES → Do nothing
│
├─ DISTANCE CHECK
│  ├─ Am I in attack range? (< 90px)
│  │  ├─ Can I hit them? (their state is vulnerable?)
│  │  │  ├─ YES → ATTACK DECISION
│  │  │  └─ NO → BLOCK/WAIT DECISION
│  │  └─ Are they attacking? → YES → BLOCK (70%) / COUNTER (20%) / TAKE HIT (10%)
│  │
│  ├─ Am I in mid range? (90–200px)
│  │  ├─ Am I low HP? → YES → DEFENSIVE (retreat, zone)
│  │  ├─ Are they low HP? → YES → AGGRESSIVE (approach, pressure)
│  │  └─ Neutral → MIX (approach 60%, wait 40%)
│  │
│  └─ Am I far away? (> 200px)
│     ├─ APPROACH (walk forward or jump)
│     └─ Use projectile (if character has one, 30% chance)
│
├─ ATTACK DECISION
│  ├─ Is this a combo opportunity? → YES → Execute combo (if known)
│  ├─ Is special available? → YES → Use at 30%+ HP advantage
│  ├─ Is throw available? → YES → Use if opponent is blocking
│  ├─ Should I heavy attack? → YES → Only on punish or combo ender
│  └─ Default → Light attack
│
├─ BLOCK DECISION
│  ├─ Block reaction: [block_chance]% based on difficulty
│  ├─ If blocking → Hold block until hitstun ends
│  └─ If not blocking → Take hit (lower difficulty) or counter (higher)
│
└─ POSITIONING
   ├─ Too close to opponent? → Backdash (20% chance) or walk back
   ├─ Opponent is in air? → Anti-air (if difficulty allows)
   └─ Opponent is cornered? → Maintain pressure
```

### 8.4 Player Experience Curve

| Session Time | Player Level | Expected Skill | Difficulty Target | Frustration Level |
|---|---|---|---|---|
| 0–2 min | Beginner | Learning controls | Very Low (Novice AI) | Minimal |
| 2–5 min | Novice | Basic combos | Low (Easy AI) | Low |
| 5–8 min | Intermediate | Cancel combos | Medium (Medium AI) | Low-Medium |
| 8–12 min | Advanced | Optimized combos | High (Hard AI) | Medium |
| 12+ min | Expert | Frame-perfect play | Very High (Boss AI) | Challenging |

### 8.5 Adaptive Difficulty (Hidden)

The game tracks player performance and subtly adjusts difficulty:

| Metric | Easy Adjustment | Hard Adjustment |
|---|---|---|
| **Win Rate > 80%** | Reduce AI combo knowledge by 1 tier | Reduce AI reaction time by 50ms |
| **Win Rate < 30%** | Increase AI combo knowledge by 1 tier | Increase AI reaction time by 50ms |
| **Average HP Remaining < 20%** | AI uses fewer throws | AI uses more throws |
| **Perfect Rounds > 50%** | AI blocks more often | AI uses more specials |
| **Session Length < 3 min** | Reduce fight 1-2 difficulty | — |
| **Session Length > 10 min** | — | Increase fight 4-5 difficulty |

**Adjustment Limits:**
- Maximum adjustment: ±1 tier from base difficulty
- Adjustments apply at run start, not mid-run
- Boss fight is never adjusted below Medium difficulty
- Adjustments are invisible to player (no UI indicator)

### 8.6 Upgrade System Balance

**Rarity Weights:**
| Rarity | Weight | Color | Expected Occurrence |
|---|---|---|---|
| Common | 15% | White | ~1 in 7 picks |
| Uncommon | 10% | Green | ~1 in 10 picks |
| Rare | 8% | Blue | ~1 in 12 picks |
| Epic | 5% | Purple | ~1 in 20 picks |
| Legendary | 2% | Gold | ~1 in 50 picks |

**Upgrade Synergy Matrix:**
| Upgrade A | Upgrade B | Synergy Bonus | Effect |
|---|---|---|---|
| Power Strike | Counter Boost | +10% bonus damage on counters | Offensive powerhouse |
| Quick Feet | Phase Shift | Back dash i-frames + speed = evasion king | High mobility |
| Iron Body | Berserker | Tank + rage = sustain fighter | Survivability |
| Flow State | Combo Master | Extended combos + more hits = style points | Combo specialist |
| Second Wind | Vampire | Heal on demand + heal on hit = sustain | Impossible to kill |
| Thundergod | Meter Builder | Fast specials + cheap specials = spam | Special-focused |
| Auto-Heal | Tough Skin | Regen + damage reduction = passive tank | Low-maintenance |
| Lightning Hands | Reflexes | Fast attacks + perfect blocks = reactive | Counter-play focused |

**Upgrade Stacking Rules:**
- Additive stacking (e.g., +15% damage + +15% damage = +30% damage)
- Maximum of 8 upgrades per run
- Duplicate upgrades are allowed (effects stack)
- Reroll mechanic: After seeing 3 options, can spend 50 coins to reroll (Phase 2)

---

## 9. Stage Physics & Boundaries

### 9.1 Play Area Configuration

| Parameter | Value | Notes |
|---|---|---|
| **Viewport** | 1280×720 | Game resolution |
| **Play Area** | 800×400 | Centered in viewport |
| **Play Area Position** | x: 240, y: 160 | Offset from viewport origin |
| **Ground Level** | y: 560 (160 + 400) | Y-position of ground surface |
| **Left Boundary** | x: 240 | Left wall of play area |
| **Right Boundary** | x: 1040 (240 + 800) | Right wall of play area |
| **Ceiling** | y: 160 | Top of play area |
| **Floor** | y: 560 | Bottom of play area (ground) |

### 9.2 Boundary Behavior

| Boundary | Behavior | Notes |
|---|---|---|
| **Left Wall** | Hard block | Character stops at boundary; cannot pass through |
| **Right Wall** | Hard block | Character stops at boundary; cannot pass through |
| **Ceiling** | Soft limit | Character can jump to ceiling but not beyond; velocity = 0 at ceiling |
| **Floor** | Hard block | Character stands on ground; gravity stops at ground level |

**Corner Behavior:**
- Characters can be "cornered" (pushed against wall by opponent)
- Cornered characters cannot backdash (no space to retreat)
- Cornered characters can still jump out of corner
- Corner pushback: when blocking, character is pushed back 5px/frame until no longer in corner

### 9.3 Camera Bounds

| Parameter | Value |
|---|---|
| **Camera Min X** | 240 (play area left edge) |
| **Camera Max X** | 1040 (play area right edge) |
| **Camera Min Y** | 160 (play area top edge) |
| **Camera Max Y** | 560 (play area bottom edge) |
| **Camera Follow Weight** | 0.1 (smooth follow, 10% per frame) |
| **Camera Zoom Range** | 0.95× – 1.5× |

---

## 10. Projectile Mechanics

### 10.1 Universal Projectile Rules

| Rule | Value | Notes |
|---|---|---|
| **Max Projectiles per Player** | 1 | Only 1 active projectile at a time |
| **Projectile Collision** | Overlap with hurtbox | Does not block; passes through |
| **Projectile vs Block** | Blocked normally | Deals 0 damage, pushed back |
| **Projectile vs Projectile** | Neither | Projectiles do not interact with each other |
| **Projectile Lifetime** | 2 seconds | Despawn after time limit |
| **Projectile Range** | 800px (full screen) | Travels entire play area width |
| **Projectile Spawn Position** | Character's facing direction, 30px forward | Emerges from character |
| **Projectile Direction** | Horizontal only (MVP) | No angled projectiles in MVP |

### 10.2 Luna's Lunar Beam

| Property | Value |
|---|---|
| **Speed** | 500 px/s |
| **Size** | 60px × 24px |
| **Damage** | 22 |
| **Hitstun** | 20 frames |
| **Blockstun** | 14 frames |
| **Knockback** | 60px horizontal, 0px vertical |
| **Pierce** | Yes (passes through opponent, does not disappear) |
| **Startup** | 14 frames (beam fires at frame 14) |
| **Recovery** | 16 frames (Luna is vulnerable after firing) |
| **Visual** | Purple crescent energy, glowing trail |
| **Sound** | Ethereal whoosh + energy crackle |

**Pierce Behavior:**
- Beam continues traveling after hitting an opponent
- Can hit the same opponent multiple times (if they are in hitstun recovery)
- Maximum 2 hits per beam (prevents infinite damage)
- Each hit applies full damage and hitstun

---

## 11. State Machine Specification

### 11.1 Complete State Diagram

```
                         ┌────────────────────────────────────────────────┐
                         │                                                │
    ┌──────────┐  jump  ┌▼─────────┐  attack  ┌──────────────┐          │
    │          ├───────►│  JUMPING  ├─────────►│   ATTACKING   │          │
    │   IDLE   │        │          │          │ (light/heavy)  │          │
    │          │◄──land─┤          │◄─recover─┤              │          │
    └──┬───┬───┘        └──────────┘          └──────┬───────┘          │
       │   │                                          │                  │
  move │   │ block                              hitstop│                  │
       │   │                                          │                  │
       ▼   ▼                                          ▼                  │
  ┌──────────┐  block  ┌──────────┐   hit    ┌──────────────┐          │
  │ WALKING  ├────────►│ BLOCKING ├─────────►│    HITSTUN    │          │
  │          │◄─release┤          │          │              │          │
  └────┬─────┘         └──────────┘          └──────┬───────┘          │
       │                                            │                   │
       │ crouch                                     │ KO                │
       ▼                                            ▼                   │
  ┌──────────┐  attack  ┌──────────────┐    ┌──────────────┐          │
  │ CROUCHING├─────────►│CROUCH_ATTACK ├    │      KO      │          │
  │          │◄─recover─┤              │    │  (terminal)   │          │
  └──────────┘          └──────────────┘    └──────────────┘          │
       │                                                              │
       │ jump                                                         │
       └──────────────────────────────────────────────────────────────┘

    ┌──────────┐  dash  ┌──────────┐
    │   IDLE   ├───────►│  DASHING │
    │          │◄─end───┤          │
    └──────────┘        └──────────┘

    ┌──────────┐  dash  ┌──────────┐
    │ WALKING  ├───────►│  DASHING │
    │          │◄─end───┤          │
    └──────────┘        └──────────┘

    ┌──────────┐  throw ┌──────────┐
    │   IDLE   ├───────►│ THROWING │
    │          │◄─end───┤          │
    └──────────┘        └──────────┘
```

### 11.2 State Definitions (Complete)

| State | Duration | Available Actions | Input Priority | Animation | Invincibility |
|---|---|---|---|---|---|
| **Idle** | Indefinite | Walk, Jump, Crouch, Light, Heavy, Block, Special, Throw | Move > Attack > Block > Special | Idle loop | None |
| **Walking** | Indefinite | Jump, Crouch, Light, Heavy, Block, Special, Throw, Stop, Dash | Move > Attack > Block > Special | Walk cycle | None |
| **Jumping** | Until land | Air Light, Air Heavy, Air Special, Air Block | Attack > Block > Direction | Jump rise/fall | None |
| **Crouching** | Indefinite | Crouch Light, Crouch Heavy, Stand, Jump | Attack > Stand > Jump | Crouch pose | None |
| **Attacking** | 6–20 frames | Nothing (recovery only) | None | Attack animation | None |
| **Blocking** | While held | Release block | None (hold to maintain) | Block pose | None |
| **Hitstun** | 8–20 frames | Nothing | None | Hit reaction | None |
| **KO** | Terminal | Nothing | None | KO animation | Full (terminal) |
| **Crouch Attack** | 8–16 frames | Nothing (recovery only) | None | Crouch attack | None |
| **Dashing** | 12 frames | Light, Heavy, Special | Attack > Special | Dash animation | None (except back dash: 8 frames i-frames) |
| **Throwing** | 20 frames | Nothing | None | Throw animation | None |

### 11.3 Valid State Transitions (Complete)

| From State | → To State | Trigger | Notes |
|---|---|---|---|
| Idle | Walking | Move input | |
| Idle | Jumping | Jump input | |
| Idle | Crouching | Down input | |
| Idle | Attacking | Light/Heavy input | |
| Idle | Blocking | Block input | |
| Idle | Dashing | Double-tap move input | |
| Idle | Throwing | Throw input (close range) | 50px range |
| Walking | Idle | Release move | Deceleration |
| Walking | Jumping | Jump input | Preserves horizontal momentum |
| Walking | Attacking | Attack input | |
| Walking | Dashing | Double-tap move input | |
| Crouching | Idle | Release down | |
| Crouching | Crouch Attack | Attack input | |
| Crouching | Jumping | Jump input | |
| Jumping | Idle | On land | Must be grounded |
| Jumping | Attacking | Attack input (air) | Air attacks allowed |
| Jumping | Blocking | Block input (air) | Air blocking allowed |
| Attacking | Idle | Recovery complete | Cannot interrupt attack |
| Blocking | Idle | Release block | |
| Hitstun | Idle | Hitstun expires | Duration varies |
| Hitstun | KO | HP ≤ 0 | Terminal state |
| Dashing | Idle | Dash ends | After 12 frames |
| Dashing | Attacking | Attack input (during dash) | Dash cancel |
| Throwing | Idle | Throw completes | After 20 frames |
| Any | KO | HP ≤ 0 | Terminal state |

### 11.4 Forbidden Transitions (Guards)

| Transition | Reason | Implementation |
|---|---|---|
| Attack → Attack | Must wait for recovery | `canAttack = false` during attack state |
| Attack → Block | Committed to action | `canBlock = false` during attack recovery |
| Attack → Jump | Grounded commitment | `canJump = false` during attack |
| Hitstun → Any | Must wait for hitstun | `canAct = false` during hitstun |
| KO → Any | Terminal state | `isKO = true` prevents all transitions |
| Jump → Crouch | Airborne state | `canCrouch = false` during jump |
| Special → Special | One special at a time | `canSpecial = false` during special |
| Block → Attack | Holding block | Must release block first |
| Dash → Jump | Committed to dash | `canJump = false` during dash |

---

## 12. Balance Formulas & Constants

### 12.1 Core Balance Numbers

| Constant | Value | Notes |
|---|---|---|
| **FPS** | 60 | Target frame rate |
| **Base HP** | 100 | All characters start here |
| **Base SP** | 100 | All characters start here |
| **SP Regen Rate** | 8 SP/sec | Passive regeneration |
| **SP Block Drain** | 5 SP/frame | While blocking |
| **Max Combo Length** | 6 hits | Universal limit |
| **Chain Window** | 8 frames | Auto-combo timing |
| **Link Window** | 16 frames | Manual combo timing |
| **Cancel Window** | 6 frames | Special cancel timing |
| **Buffer Size** | 12 frames | Input buffer |
| **Perfect Block Window** | 4 frames | Skill-based block |
| **Guard Break Duration** | 30 frames | Stagger length |
| **Round Timer** | 99 seconds | Standard |
| **KO Slow-Mo Duration** | 500ms | At 0.3× speed |
| **Combo Timeout** | 120 frames (2 sec) | Resets combo counter |
| **Back Dash i-Frames** | 8 frames | Invincibility duration |
| **Coyote Time** | 6 frames | Jump grace period |
| **Jump Buffer** | 8 frames | Pre-landing jump input |

### 12.2 Damage Formulas

**Counter-Hit Bonus:**
```
counter_damage = base_damage × 1.25
```

**Scaling Formula:**
```
scaled_damage = base_damage × max(0.6, 1.0 - (combo_hit - 1) × 0.1)
```

**Weight-Adjusted Knockback:**
```
actual_knockback = base_knockback / weight
```

**Hitstun Formula:**
```
hitstun = base_hitstun + floor(damage / 3)
```

**XP Earned:**
```
xp_per_round = 50
xp_per_match = 100
xp_per_run = 300
xp_bonus_perfect = 50
xp_bonus_combo5plus = 25
xp_bonus_highscore = 100
```

**XP to Level:**
```
xp_required(level) = level × 200
```

**Score Multiplier:**
```
multiplier = 1.0 + (rounds_without_loss × 0.1)
max_multiplier = 1.5
```

### 12.3 Timing Constants (In Frames and Milliseconds)

| Event | Frames | Milliseconds | Notes |
|---|---|---|---|
| **Light Startup** | 4–8 | 67–133 | Character-dependent |
| **Heavy Startup** | 10–18 | 167–300 | Character-dependent |
| **Special Startup** | 10–24 | 167–400 | Character-dependent |
| **Throw Startup** | 8–10 | 133–167 | Character-dependent |
| **Hitstun** | 8–28 | 133–467 | Damage-dependent |
| **Blockstun** | 4–20 | 67–333 | Attack-dependent |
| **Guard Break Stagger** | 30 | 500 | Fixed |
| **Dash Duration** | 10–12 | 167–200 | Character-dependent |
| **Back Dash i-Frames** | 8 | 133 | Fixed |
| **Combo Timeout** | 120 | 2000 | Fixed |
| **KO Slow-Mo** | 30 | 500 | Fixed |
| **Round Announcement** | 90 | 1500 | Fixed |
| **Damage Number Fade** | 30 | 500 | Fixed |
| **Particle Lifetime** | 12–48 | 200–800 | Type-dependent |

### 12.4 Movement Constants

| Action | Speed (px/s) | Duration (frames) | Distance (px) | Notes |
|---|---|---|---|---|
| **Walk (Rex)** | 200 | Indefinite | — | Base speed |
| **Walk (Volt)** | 250 | Indefinite | — | Fastest |
| **Walk (Titan)** | 160 | Indefinite | — | Slowest |
| **Walk (Luna)** | 190 | Indefinite | — | — |
| **Jump Velocity** | 600 (up) | 35 total | 180 height | Character-dependent |
| **Max Fall Speed** | 600 | — | — | Terminal velocity |
| **Dash (Rex)** | 500 → 0 | 12 | 300 | Burst + decay |
| **Back Dash (Rex)** | 400 → 0 | 10 | 200 | Weaker retreat |
| **Dash (Volt)** | 600 → 0 | 10 | 350 | Fastest dash |
| **Dash (Titan)** | 400 → 0 | 14 | 280 | Slowest dash |
| **Dash (Luna)** | 450 → 0 | 11 | 250 | — |

---

## Appendix A: Implementation Checklist

### Physics System
- [ ] Configure Arcade Physics in Phaser game config
- [ ] Set gravity to 800 px/s²
- [ ] Create stage boundary colliders
- [ ] Implement hitbox/hurtbox collision groups
- [ ] Add ground friction and air friction
- [ ] Implement jump cut (variable jump height)
- [ ] Add coyote time and jump buffer

### Combat Tuning
- [ ] Implement frame data for all 4 characters
- [ ] Create hitbox/hurtbox sprites per attack
- [ ] Implement hitstun and blockstun
- [ ] Add guard break mechanic
- [ ] Implement perfect block
- [ ] Add combo scaling
- [ ] Create damage number system

### Input System
- [ ] Build Unified Input Manager class
- [ ] Implement keyboard mapping (P1 + P2)
- [ ] Implement gamepad support
- [ ] Integrate phaser-virtual-joystick
- [ ] Add input buffer (12 frames)
- [ ] Implement touch detection
- [ ] Add tablet force-touch override

### Feedback Systems
- [ ] Implement hit flash system
- [ ] Add screen shake
- [ ] Create hit stop (freeze frame)
- [ ] Build particle system
- [ ] Add slow motion
- [ ] Implement camera zoom
- [ ] Create combo counter UI
- [ ] Add floating damage numbers
- [ ] Implement HP/SP bar feedback
- [ ] Create round announcement system

### Difficulty Curve
- [ ] Implement 5 AI difficulty tiers
- [ ] Create AI decision tree
- [ ] Add reaction time variation
- [ ] Implement combo knowledge per tier
- [ ] Add adaptive difficulty (hidden)
- [ ] Create upgrade system with rarity weights
- [ ] Implement upgrade synergies

---

*Gameplay Mechanics Design v1.0 — September 14, 2026*
*Detailed implementation-ready specification for Battle Brawl physics, tuning, feedback, juice, input, and difficulty systems.*
