# Gameplay Design Artifact: Battle Brawl

**Version:** 2.0
**Date:** September 14, 2026
**Status:** Implementation-Ready Specification (Enhanced)
**Scope:** Core gameplay loop, controls, game states, difficulty, progression, feedback, economy, balancing, performance tiers, sound design, visual effect palettes, easing functions, physics tuning, matchup data
**Sources:** GDD v1.1, gameplay-mechanics.md v1.0, game-concept.md v5, market-research.md, competitor-analysis.md

---

## Table of Contents

1. [Core Gameplay Loop](#1-core-gameplay-loop)
2. [Controls](#2-controls)
3. [Game States](#3-game-states)
4. [Difficulty](#4-difficulty)
5. [Progression](#5-progression)
6. [Feedback Systems](#6-feedback-systems)
7. [Juice Effects — Performance-Adaptive Quality Tiers](#7-juice-effects--performance-adaptive-quality-tiers)
8. [Sound Design Specification](#8-sound-design-specification)
9. [Visual Effect Color Palettes](#9-visual-effect-color-palettes)
10. [Easing Functions & Animation Curves](#10-easing-functions--animation-curves)
11. [Physics Tuning & Timestep Management](#11-physics-tuning--timestep-management)
12. [Matchup Data & Rock-Paper-Scissors Validation](#12-matchup-data--rock-paper-scissors-validation)
13. [Economy](#13-economy)
14. [Balancing Requirements](#14-balancing-requirements)
15. [Accessibility Adaptations](#15-accessibility-adaptations)
16. [Implementation Checklist](#16-implementation-checklist)

---

## 1. Core Gameplay Loop

### Primary Loop (Per Match — Gauntlet Mode)

```
┌──────────────────────────────────────────────────────────────┐
│                    BATTLE BRAWL CORE LOOP                     │
├──────────────────────────────────────────────────────────────┤
│                                                                │
│   SELECT FIGHTER ──────►  ENTER ARENA ──────►  FIGHT ──────► │
│       │                         │              ↑                │
│       │                         │          ┌─────────┐          │
│       │                         │          │ WIN     │          │
│       │                         └──────────┴─────────┘          │
│       │                                   │                  │
│       │                                   │                  │
│       │                     ┌───────────▼─────────┐              │
│       │                     │   EARN REWARDS        │              │
│       │                     │   (XP, Coins, Items)    │              │
│       │                     └───────────┬─────────┘              │
│       │                               │                        │
│       │                               │                        │
│       │                     ┌───────────▼─────────┐              │
│       │                     │   UPGRADE/UNLOCK        │              │
│       │                     │ (New move, ability,   │              │
│       │                      |    permanent unlock)    │              │
│       │                     └───────────┬─────────┘              │
│       │                               │                        │
│       └───────────────────────────────┘                        │
│                                                                │
│   META LOOP: Run → Score → Unlock → New Run                     │
│   "One more try" — each run grants permanent progression          │
└──────────────────────────────────────────────────────────────┘
```

### Micro-Loop (Within a Round — 60–90 seconds)

- **Inputs:** Direction + Light Attack (J/X) + Heavy Attack (K/C) + Block (L/V) + Jump (W/Up / Space)
- **Beat:** Position → Attack → React → Combo → Finish
- **Feedback:** Hit flash, screen shake, particles, sound cue, damage number
- **Goal:** Deplete opponent's 100 HP before time runs out or KO occurs

### Meso-Loop (Per Run — Roguelite Gauntlet)

- **Structure:** 3–5 fights with increasing AI difficulty
- **Choice:** After each win, pick 1 of 3 random upgrades (offensive, defensive, special, movement, synergy)
- **Boss:** Final round is a boss-tier opponent with unique mechanics and phase shifts at 66% and 33% HP
- **Duration:** 5–8 minutes typical

### Meta-Loop (Across Runs — Permanent Progression)

- **XP → Level up:** 50 XP per round win, 100 per match win, 300 per run completion
- **Unlockables:** New fighters (Blaze at Level 5, Frost at Level 10, Shadow at Level 20, Astra at Level 30), cosmetics, stages
- **Coins:** Earned per win (10/round, 25/match), daily login (50), rewarded video (30)
- **Shop:** Cosmetic-only purchases (skins, victory poses, particle effects, stage themes)

---

## 2. Controls

### Input Architecture: Unified Input Manager

The game uses an abstracted input layer that normalizes keyboard, gamepad, and touch inputs into a single action-based interface. Game code never reads raw inputs — only actions.

### 2.1 Desktop — Keyboard

| Action | Key (P1) | Key (P2) |
|---|---|---|
| Move Left | A | ← |
| Move Right | D | → |
| Jump | W | ↑ |
| Crouch | S | ↓ |
| Light Attack | J | Numpad 1 |
| Heavy Attack | K | Numpad 2 |
| Block | L | Numpad 3 |
| Special | Space | Numpad 0 |
| Pause | ESC | ESC |

**Keyboard Rules:**
- Movement keys: No repeat — continuous while held
- Attack keys: No repeat — must release and press for next attack
- Key up events debounced (50ms) to prevent phantom releases
- Uses `event.code` for layout independence (QWERTY/AZERTY)

### 2.2 Desktop — Gamepad (Xbox Layout)

| Action | Button |
|---|---|
| Move Left/Right | Left Stick X |
| Move Up/Down (crouch) | Left Stick Y up/down |
| Jump | Button South (A) |
| Light Attack | Button West (X) |
| Heavy Attack | Button North (Y) |
| Block | Button East (B) |
| Special | Left Trigger (LT) |
| Pause | Start / Menu |

**Gamepad Rules:**
- Left Stick dead zone: 0.2 (20%)
- Triggers dead zone: 0.1 (10%)
- Rumble: Light hit (0.2×50ms), Heavy hit (0.5×100ms), KO (0.8×200ms), Block (0.3×30ms)
- Gamepad disconnect: Pause game, show "Reconnect Controller" prompt
- Auto-detect controller type (Xbox/PlayStation/Switch) for button prompts

### 2.3 Mobile — Touch Controls (phaser-virtual-joystick)

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
| Dead Zone | 16px (25% of base) |
| Max Displacement | 48px (75% of base) |
| Base Opacity | 30% (idle), 50% (active) |
| Stick Opacity | 60% (idle), 80% (active) |
| Color | White |
| Activation | Touch anywhere in left 50% of screen |

**Button Specifications:**

| Button | Size | Position | Opacity (Idle) | Opacity (Pressed) |
|---|---|---|---|---|
| **Jump** | 64×64px | Bottom-left | 40% | 80% |
| **Light Attack (A)** | 56×56px | Right side, upper | 40% | 80% |
| **Heavy Attack (B)** | 56×56px | Right side, lower | 40% | 80% |
| **Block** | 64×64px | Right side, bottom | 40% | 80% |

**Touch Behavior:**
- Multi-touch supported: 4 simultaneous pointers
- Each button tracks its own pointer ID
- No input conflicts between left/right zones (exclusive pointer tracking)
- Tablet override: If `navigator.maxTouchPoints > 0` AND device is tablet → force touch controls

**Input Priority (when multiple buffered):**
1. Jump (highest)
2. Block
3. Special
4. Heavy Attack
5. Light Attack
6. Crouch
7. Move (lowest)

### 2.4 Input Buffer

- **Buffer Size:** 12 frames (200ms at 60fps)
- **Rules:**
  1. Inputs during unavailable states are queued
  2. Buffer stores last valid input per action type
  3. Buffer clears on state transition when action becomes available
  4. TTL: 12 frames, then discarded
  5. Priority: jump > block > special > heavy > light > crouch > move

### 2.5 Input Latency Requirements

| Platform | Target Latency | Acceptable Degradation |
|---|---|---|
| Desktop (keyboard) | < 1 frame (16.67ms) | — |
| Desktop (gamepad) | < 2 frames (33.33ms) | Polling at 60Hz |
| Mobile (touch) | < 2 frames (33.33ms) | Buffer compensates |
| Mobile (low-end) | < 3 frames (50ms) | Graceful degradation |

---

## 3. Game States

### 3.1 Scene Flow

```
Boot (1280×720, FIT_SCALE, CENTER_BOTTOM)
    ↓
Preloader (progress bar, load assets)
    ↓
MainMenu (Start, Options, Character Select arrow)
    ↓
CharacterSelect (4 starter fighters, portrait select)
    ↓
GameScene (actual fight)
    ↓
ResultsScreen (win/loss, rewards, meta-progression)
    ↓
→ MainMenu (new run) or CharacterSelect (new run)
```

### 3.2 GameScene Sub-states

| State | Description | Duration | Transitions |
|---|---|---|---|
| **Pre-Fight** | "ROUND 1 — FIGHT!" announcement, characters spawn | 1.5 sec | → Fight |
| **Fight** | Active 1v1 combat, timer counting down | 60–90 sec (or until KO) | → Round Intermission / Match Over |
| **Round Intermission** | Between rounds (best of 3), "NEW ROUND!" | 3 sec | → Fight |
| **Match Over** | KO or timer expiry — winner animated | 2 sec | → Results |
| **Results** | XP/coins earned, upgrade choice, run progression | 5–8 sec | → CharacterSelect / MainMenu |

### 3.3 Pause/Interruption States

- **Menu Pause:** Esc/Start → pause overlay → Resume/Quit to Main
- **Browser Tab Hidden:** `visibilitychange` event → auto-pause via `gameplayStop()` (Poki SDK)
- **Gamepad Disconnect:** Pause game, show "Reconnect Controller" prompt
- **Incutscene/KO:** Cannot pause during KO animation; pause available after

### 3.4 Terminal States

- **KO:** HP ≤ 0 → character falls, slow-mo, "K.O." announcement, results screen
- **Timer Expiry:** 99s elapsed → player with higher HP% wins round; if equal, draw
- **Guard Break:** SP ≤ 0 while blocking → 30-frame stagger, vulnerable to any attack
- **Simultaneous KO:** Round is a draw — no round win awarded; if draw on match point, the round with more remaining HP (from earlier rounds) wins

---

## 4. Difficulty

### 4.1 Gauntlet AI Progression (Per Fight)

| Fight | AI Tier | HP | Damage Multi | SP Multi | Reaction Time | Combo Knowledge | SP Regen |
|---|---|---|---|---|---|---|---|
| Fight 1 | Novice | 80 | 0.8× | 0.8× | 500ms | None | 6 SP/s |
| Fight 2 | Easy | 90 | 0.9× | 0.9× | 350ms | 2-hit combos | 7 SP/s |
| Fight 3 | Medium | 100 | 1.0× | 1.0× | 200ms | 3-hit combos, basic cancel | 8 SP/s |
| Fight 4 | Hard | 110 | 1.1× | 1.1× | 100ms | 4+ combos, anti-airs, frame traps | 9 SP/s |
| Fight 5 (Boss) | Boss | 120 | 1.2× | 1.2× | 80ms | Full combos, optimal punishes, adaptive | 10 SP/s |

### 4.2 AI Behavior Decision Tree

Every [reaction_time] ms (tier-dependent):

1. **State Assessment:**
   - In hitstun? → Wait for recovery
   - In blockstun? → Continue blocking
   - Guard broken? → Play defensive (retreat, no block)
   - In KO? → Do nothing

2. **Distance Check:**
   - In attack range (<90px)? → Can I hit? → Attack / Block / Wait
   - In mid range (90–200px)? → Low HP? → Defensive/aggressive mix / Neutral
   - Far away (>200px)? → Approach or use projectile (30% chance)

3. **Attack Decision:**
   - Combo opportunity? → Execute known combo
   - Special available (SP ≥ cost) & HP ≥ 30%? → Use special
   - Throw available & opponent blocking? → Use throw
   - Default → Light attack

4. **Block Decision:**
   - Block chance based on difficulty (%)
   - If not blocking → Take hit (lower difficulty) or counter (higher)

5. **Positioning:**
   - Too close? → Backdash (20% chance) or walk back
   - Opponent in air? → Anti-air (if difficulty allows)
   - Opponent cornered? → Maintain pressure

### 4.3 Adaptive Difficulty (Hidden)

The game tracks player performance and subtly adjusts difficulty at run start (not mid-run):

| Metric | Easy Adjustment | Hard Adjustment |
|---|---|---|
| Win Rate > 80% | Reduce AI combo knowledge 1 tier | Reduce AI reaction time 50ms |
| Win Rate < 30% | Increase AI combo knowledge 1 tier | Increase AI reaction time 50ms |
| Avg HP remaining < 20% | AI uses fewer throws | AI uses more throws |
| Perfect rounds > 50% | AI blocks more often | AI uses more specials |
| Session length < 3 min | Reduce fight 1-2 difficulty | — |
| Session length > 10 min | — | Increase fight 4-5 difficulty |

**Limits:**
- Maximum adjustment: ±1 tier from base difficulty
- Boss fight never adjusted below Medium
- Adjustments invisible to player (no UI indicator)

### 4.4 Player Experience Curve

| Session Time | Expected Skill | Difficulty Target | Frustration Level | Expected Outcome |
|---|---|---|---|---|
| 0–2 min | Beginner | Very Low (Novice AI) | Minimal | Win Fight 1 easily |
| 2–5 min | Novice | Low (Easy AI) | Low | Win Fight 2, learn combos |
| 5–8 min | Intermediate | Medium (Medium AI) | Low-Medium | Fight 3 is challenging |
| 8–12 min | Advanced | High (Hard AI) | Medium | Fight 4 requires skill |
| 12+ min | Expert | Very High (Boss AI) | Challenging | Boss is a serious test |

### 4.5 Boss Phase Mechanics

| HP Threshold | Phase | Behavior Change |
|---|---|---|
| 100–66% | Phase 1 (Neutral) | Standard AI behavior for difficulty tier |
| 66–33% | Phase 2 (Aggressive) | +20% aggression, +15% special usage, new combo routes |
| 33–0% | Phase 3 (Desperate) | +40% aggression, +25% damage, signature move becomes spammable, desperation super available |

**Boss Signature Mechanics (per character):**

| Boss | Phase 2 Mechanic | Phase 3 Mechanic |
|---|---|---|
| Rex Boss | Extended range on all attacks (+20px) | Multi-hit Power Strike (3 waves) |
| Volt Boss | Lightning Dash leaves electric trail (zone control) | Lightning Dash becomes full-screen teleport strike |
| Titan Boss | Super armor on ALL attacks (not just heavy) | Earth Slam creates permanent ground hazard |
| Luna Boss | Lunar Beam fires 2 projectiles simultaneously | Lunar Beam pierces through block |

---

## 5. Progression

### 5.1 Meta-Progression (Across Runs)

**XP & Leveling:**

| Source | XP |
|---|---|
| Win a round | 50 XP |
| Win a match | 100 XP |
| Complete a run (Gauntlet) | 300 XP |
| Perfect round (no damage) | +50 XP bonus |
| Combo 5+ hits | +25 XP bonus |
| New record high score | +100 XP bonus |

**XP Curve:**

| Level | XP Required | Cumulative XP | Runs to Reach |
|---|---|---|---|
| 1 | 0 | 0 | — |
| 2 | 400 | 400 | ~2 |
| 3 | 600 | 1,000 | ~4 |
| 5 | 1,000 | 2,800 | ~8 |
| 10 | 2,000 | 13,500 | ~30 |
| 15 | 3,000 | 36,000 | ~70 |
| 20 | 4,000 | 71,000 | ~130 |
| 30 | 6,000 | 178,500 | ~300 |

**Level Unlock Table:**

| Level | Unlock | Type |
|---|---|---|
| 1 | Rex, Volt, Titan, Luna (starters) | Fighter |
| 3 | Title: "Challenger" | Cosmetic |
| 5 | Blaze (new fighter) | Fighter |
| 7 | Neon Rex color palette | Cosmetic |
| 10 | Frost (new fighter) | Fighter |
| 12 | Title: "Warrior" | Cosmetic |
| 15 | All-color palette pack | Cosmetic |
| 20 | Shadow (new fighter) | Fighter |
| 25 | Title: "Champion" | Cosmetic |
| 30 | Astra (final fighter) | Fighter |
| 35 | Victory animation pack | Cosmetic |

**Coin Economy:**

| Source | Coins |
|---|---|
| Win a round | 10 coins |
| Win a match | 25 coins |
| Complete a run | 50 coins |
| Daily login | 50 coins |
| Watch rewarded ad | 30 coins |

**Shop (Cosmetic Only):**

| Item Type | Price Range | Examples |
|---|---|---|
| Character Skin | 200–500 coins | Neon Rex, Shadow Volt |
| Stage Theme | 300–600 coins | Midnight Dojo, Neon City |
| Victory Pose | 150–300 coins | Flex, Bow, Taunt |
| Particle Effect | 100–200 coins | Fire trail, Ice spark |

### 5.2 Upgrade System (Per Run — Roguelite)

After each fight win, player picks 1 of 3 random upgrades from a pool of 12. Upgrades last for the current run only.

**Upgrade Categories:**

| Category | Upgrade | Effect | Rarity |
|---|---|---|---|
| **Offensive** | Iron Fists | +15% damage | Common (15%) |
| | Combo Master | Extend combo window by 4 frames | Uncommon (10%) |
| | Counter Boost | +50% counter-hit damage | Uncommon (10%) |
| | Piercing Strikes | Heavy attacks ignore 30% block | Rare (8%) |
| **Defensive** | Stone Skin | -20% damage taken | Common (15%) |
| | Second Wind | Restore 30 HP once per fight below 20% | Rare (8%) |
| | Super Armor | Absorb 1 hit during heavy attacks | Epic (5%) |
| **Movement** | Swift Feet | +15% movement speed | Common (15%) |
| | Quick Recovery | 30% faster knockdown recovery | Uncommon (10%) |
| **Utility** | Meter Builder | 25% faster SP regeneration | Common (15%) |
| **Synergy** | Berserker | +1% damage per 1% HP missing | Epic (5%) |
| | Glass Cannon | +40% damage, -20% damage taken | Legendary (2%) |

**Rarity Weights:**

| Rarity | Weight | Color | Expected Occurrence |
|---|---|---|---|
| Common | 15% | White | ~1 in 7 picks |
| Uncommon | 10% | Green | ~1 in 10 picks |
| Rare | 8% | Blue | ~1 in 12 picks |
| Epic | 5% | Purple | ~1 in 20 picks |
| Legendary | 2% | Gold | ~1 in 50 picks |

**Upgrade Stacking Rules:**
- Additive stacking (e.g., +15% + +15% = +30%)
- Maximum 8 upgrades per run
- Duplicate upgrades allowed (effects stack)
- Reroll: Spend 50 coins to reroll 3 options (Phase 2)

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
| **KO** | White flash (4 frames) + KO particles | KO SFX + announcer | Slow-mo (0.3×, 500ms) + zoom (1.3×) | "K.O.!" text (scale animation) | Strong rumble (0.8, 300ms) |
| **Throw** | Grab animation (2 frames) + impact | Grab SFX + impact | Screen shake (4px, 150ms) | Floating number (15) | Medium rumble (0.5, 100ms) |

### 6.2 Damage Number System

| Property | Value | Notes |
|---|---|---|
| Base Size | 20px | Increases with combo count |
| Combo Scaling | +2px per combo hit | Up to 32px max |
| Color | White (normal), Yellow (5+ combo), Red (heavy), Purple (counter) | Color indicates hit type |
| Rise Speed | 60px/sec upward | Rises then fades |
| Fade Duration | 500ms | Complete fadeout |
| Horizontal Offset | ±20px random | Prevents overlap |
| Vertical Offset | -80px (above character) | Starts above hit position |

### 6.3 HP Bar Feedback

| HP Range | Bar Color | Visual Effect |
|---|---|---|
| 100–60% | Green (#22c55e) | No effect |
| 59–30% | Yellow (#eab308) | Slight pulse at 1Hz |
| 29–10% | Orange (#f97316) | Pulse at 2Hz |
| 9–0% | Red (#ef4444) | Rapid pulse at 3Hz + screen edge red vignette |
| KO | Gray (#6b7280) | Bar drains to 0 with 500ms animation |

**Damage Display:** HP bar shows "ghost" segment (white, 30% opacity) that drains over 500ms after damage, creating anticipation.

### 6.4 SP Bar Feedback

| SP Range | Bar Color | Visual Effect |
|---|---|---|
| 100–50% | Blue (#3b82f6) | No effect |
| 49–20% | Dark Blue (#1e40af) | Slight dimming |
| 19–0% | Dark Blue + Red tint (#dc2626 at 30%) | Pulse at 2Hz when blocking |
| Full (100%) | Bright Blue + glow (#60a5fa) | Ready indicator |

**SP Regeneration:** Small green ticks that rise from the bar at actual regen rate (8 SP/sec = ~8 ticks/sec).

### 6.5 Combo Counter Feedback

| Combo Count | Display | Animation | Color | Sound |
|---|---|---|---|---|
| 1–2 | "1x" / "2x" | Scale in (1.0→0.8→1.0) | White | — |
| 3–4 | "3x" / "4x" | Scale in + slight shake | Yellow | Combo SFX (low) |
| 5–6 | "5x" / "6x" | Scale in + strong shake | Red | Combo SFX (high) |
| 7+ | "7x"+ | Scale in + major shake + glow | Purple + glow | Combo SFX (max) + screen flash |

**Combo Reset:** Timer 2 seconds between hits. If no hit within 2s → combo resets to 0. Visual: counter fades out over 300ms. Audio: fade-out sound on reset.

### 6.6 Round Announcement System

| Announcement | Timing | Animation | Duration | Audio |
|---|---|---|---|---|
| "ROUND 1" | Before fight starts | Scale from 0 to 1.5 to 1.0 | 1.5 sec | Announcer voice |
| "FIGHT!" | After "ROUND 1" | Scale from 0 to 1.0 + screen flash | 0.5 sec | Announcer voice |
| "K.O.!" | On KO | Scale from 0 to 2.0 to 1.5 + red glow | 2.0 sec | Announcer voice + impact |
| "VICTORY" | After match win | Slide up from bottom + scale | 1.0 sec | Victory music sting |
| "DEFEAT" | After match loss | Slide up from bottom + scale | 1.0 sec | Defeat music sting |
| "PERFECT" | If no damage taken | Scale from 0 to 1.0 + gold glow | 1.5 sec | Special announcer + gold particles |
| "TIME UP" | Timer reaches 0 | Flash on screen + text | 1.0 sec | Buzzer SFX |

### 6.7 Slow Motion System

| Trigger | Speed | Duration | Zoom | Transition |
|---|---|---|---|---|
| KO finish | 0.3× | 500ms | 1.3× | Smooth over 200ms |
| Last-hit KO | 0.2× | 800ms | 1.5× | Smooth over 300ms |
| Counter-hit | 0.5× | 200ms | None | Instant on/off |
| Perfect block | 0.6× | 150ms | None | Instant on/off |

**Rules:** Only triggered on important moments; maximum 1 slow-motion active; UI remains at normal speed; audio pitch unchanged; disabled during hitstop.

---

## 7. Juice Effects — Performance-Adaptive Quality Tiers

### 7.1 Quality Tier System

The game automatically detects device performance and adjusts visual fidelity to maintain 30fps minimum on all devices.

| Setting | High (Desktop) | Medium (Mid-range Mobile) | Low (Low-end Mobile) |
|---|---|---|---|
| **Screen Shake** | Full (all triggers) | Heavy/KO only | Disabled |
| **Hit Stop** | Full (all triggers) | Heavy/Special/KO only | KO only |
| **Particles** | Full count (8–30) | 50% count | 25% count + no ambient |
| **Slow Motion** | Full | KO only | Disabled |
| **Camera Zoom** | Full | KO only | Disabled |
| **Damage Numbers** | Full | Full | Disabled |
| **Combo Counter** | Full | Full | Simplified (no animation) |
| **Ambient Particles** | Full | Reduced (50%) | Disabled |
| **Background Parallax** | 3 layers | 2 layers | 1 layer |
| **Shadow Rendering** | Dynamic | Static | Disabled |
| **Target FPS** | 60 | 60 | 30 |

### 7.2 Detection Method

```typescript
// Performance tier detection (run once at boot)
function detectPerformanceTier(): 'high' | 'medium' | 'low' {
  const fps = game.loop.actualFps;
  if (fps >= 55) return 'high';
  if (fps >= 30) return 'medium';
  return 'low';
}

// Adaptive quality adjustment
function adjustQuality(tier: 'high' | 'medium' | 'low') {
  // Disable effects based on tier
  // Reduce particle counts
  // Simplify animations
}
```

### 7.3 Screen Shake (Detailed)

| Trigger | Intensity (px) | Duration (ms) | Decay | High | Medium | Low |
|---|---|---|---|---|---|---|
| Light hit | 0 | 0 | — | — | — | — |
| Heavy hit | 4 | 150 | Exponential | ✅ | ✅ | ❌ |
| Special hit | 6 | 200 | Exponential | ✅ | ✅ | ❌ |
| Counter-hit | 8 | 250 | Exponential | ✅ | ✅ | ❌ |
| KO | 10 | 400 | Exponential | ✅ | ✅ | ❌ |
| Perfect block | 2 | 100 | Linear | ✅ | ❌ | ❌ |
| Guard break | 6 | 300 | Exponential | ✅ | ✅ | ❌ |
| Boss phase shift | 8 | 300 | Exponential | ✅ | ✅ | ❌ |

**Shake Formula:**
```
shake_offset = intensity × sin(time × frequency) × decay_factor
decay_factor = e^(-time / duration)
```

**Implementation Notes:**
- Use Phaser's `camera.shake()` method
- Maximum shake: 12px (prevent motion sickness)
- Shake is camera-relative, not world-relative

### 7.4 Hit Stop (Freeze Frame) System

| Trigger | Duration (frames) | Duration (ms) | High | Medium | Low |
|---|---|---|---|---|---|
| Light hit | 2 | 33ms | ✅ | ❌ | ❌ |
| Heavy hit | 4 | 67ms | ✅ | ✅ | ❌ |
| Special hit | 6 | 100ms | ✅ | ✅ | ❌ |
| Counter-hit | 4 | 67ms | ✅ | ✅ | ❌ |
| KO | 8 | 133ms | ✅ | ✅ | ✅ |
| Perfect block | 2 | 33ms | ✅ | ❌ | ❌ |

**Hit Stop Rules:**
1. Both fighters freeze (no animation, no physics)
2. Particles continue (creates visual contrast)
3. Camera does NOT freeze (shake continues during hitstop)
4. Audio does NOT freeze (impact sound plays during hitstop)
5. Hit stop stacks: if new hit occurs during hitstop, add frames (max 12 total)

### 7.5 Particle System

**Particle Types:**

| Particle | Trigger | Count (High) | Count (Med) | Count (Low) | Speed | Lifetime | Gravity | Color |
|---|---|---|---|---|---|---|---|---|
| **Hit Spark** | Any hit | 8–12 | 4–6 | 2–3 | 200–400 px/s | 200–400ms | 200 px/s² | Character color |
| **Block Spark** | Block | 4–6 | 2–3 | 1 | 100–200 px/s | 150–300ms | 100 px/s² | White/Gray |
| **Dust** | Land from jump | 6–8 | 3–4 | 1–2 | 50–100 px/s | 300–500ms | 50 px/s² | Brown/Tan |
| **KO Burst** | KO | 20–30 | 10–15 | 5–8 | 300–600 px/s | 500–800ms | 150 px/s² | Red/Orange |
| **Special Trail** | Special move | 10–15 | 5–8 | 2–4 | 100–300 px/s | 300–600ms | 0 | Character color |
| **Counter Flash** | Counter-hit | 12–16 | 6–8 | 3–4 | 400–600 px/s | 200–400ms | 100 px/s² | Red |
| **Guard Break** | Guard break | 15–20 | 8–10 | 4–5 | 200–400 px/s | 400–600ms | 200 px/s² | Red/Orange |

**Particle Configuration:**
- Use Phaser's built-in particle system (Phaser 3.90)
- Max particles: 100 per emitter
- Particle textures: Simple circles (2px–8px) or small shapes
- Blend mode: ADD for sparks, NORMAL for dust
- Pool size: 200 particles (recycled, not destroyed)

**Ambient Particles (Stage-Specific):**

| Stage | Particle | Count (High) | Count (Med) | Count (Low) | Behavior |
|---|---|---|---|---|---|
| **Neon Arena** | Rain | 50 | 25 | 0 | Falling, 300px/s |
| **Neon Arena** | Neon flicker | 5–10 | 2–4 | 0 | Floating, color-shifting |
| **Rooftop** | Wind debris | 20 | 10 | 0 | Horizontal, 100–200px/s |
| **Rooftop** | Birds | 3–5 | 1–2 | 0 | Circular flight paths |
| **Dojo** | Dust motes | 15 | 8 | 0 | Floating, 10–30px/s |
| **Dojo** | Scroll flutter | 2–3 | 1 | 0 | Sway animation |

### 7.6 Camera Zoom System

| Trigger | Target Zoom | Duration | Transition | Recovery |
|---|---|---|---|---|
| Default | 1.0× | — | — | — |
| Special activation | 1.1× | 300ms | Smooth (lerp) | Smooth (lerp) |
| KO finish | 1.3× | 500ms | Smooth (lerp) | Reset on round start |
| Both players far apart | 0.95× | 200ms | Smooth (lerp) | Smooth (lerp) |
| Both players close | 1.05× | 200ms | Smooth (lerp) | Smooth (lerp) |

**Zoom Rules:**
1. Zoom is relative to the midpoint between both players
2. Camera follows the midpoint with slight weighting toward P1 (60/40)
3. Zoom is clamped to stage bounds (never shows outside play area)
4. Zoom transitions use exponential interpolation (lerp)

### 7.7 Hit Flash System

| Trigger | Flash Color | Duration | Intensity |
|---|---|---|---|
| Normal hit | White | 2 frames (33ms) | 100% |
| Heavy hit | White | 3 frames (50ms) | 100% |
| Counter-hit | Red | 3 frames (50ms) | 100% |
| Special hit | White | 4 frames (67ms) | 100% |
| Block | Gray | 2 frames (33ms) | 60% |
| Perfect block | Blue | 2 frames (33ms) | 100% |
| KO | White | 4 frames (67ms) | 100% |

### 7.8 Screen Edge Effects

| Effect | Trigger | Parameters |
|---|---|---|
| Red Vignette | HP < 30% | Opacity scales with HP loss (0.0 at 30%, 0.5 at 0%) |
| Blue Flash | SP full | Brief blue flash on screen edges (200ms) |
| KO Flash | KO | Full-screen white flash (4 frames) |
| Round Start | Round start | Full-screen fade from black (500ms) |

---

## 8. Sound Design Specification

### 8.1 Sound Categories

| Category | Count | Format | Priority | Implementation |
|---|---|---|---|---|
| **Hit SFX** | 6 | OGG + MP3 fallback | Critical | Light, Heavy, Special, Counter, Throw, Air |
| **Block SFX** | 3 | OGG + MP3 fallback | Critical | Block, Perfect Block, Guard Break |
| **Movement SFX** | 4 | OGG + MP3 fallback | High | Dash, Land, Jump, Walk |
| **Announcer** | 7 | OGG + MP3 fallback | High | Round Start, Fight, KO, Victory, Defeat, Perfect, Time Up |
| **UI SFX** | 3 | OGG + MP3 fallback | Medium | Menu Click, Upgrade Select, Level Up |
| **Stage Ambience** | 3 | OGG (streamed) | Medium | Neon Rain, Rooftop Wind, Dojo Silence |
| **Music** | 4 | OGG (streamed) | Medium | Menu Theme, Fight Neon, Fight Rooftop, Fight Dojo |
| **Character SFX** | 8 | OGG + MP3 fallback | Low | Per-character special move sounds |

### 8.2 Sound Trigger Map

| Event | Sound | Volume | Pitch Variation | Notes |
|---|---|---|---|---|
| Light hit | `hit-light` | 0.6 | ±5% | Crisp, short |
| Heavy hit | `hit-heavy` | 0.8 | ±5% | Deep, impactful |
| Special hit | `hit-special` | 0.9 | ±5% | Character-specific |
| Counter hit | `hit-counter` | 0.85 | — | Sharp, distinct |
| Block | `block-regular` | 0.5 | — | Dull thud |
| Perfect block | `block-perfect` | 0.7 | — | Sharp, satisfying |
| Guard break | `guard-break` | 0.8 | — | Cracking sound |
| Throw | `throw-grab` | 0.7 | — | Grab + impact |
| KO | `ko-impact` | 1.0 | — | Heavy impact + announcer |
| Dash | `move-dash` | 0.3 | — | Quick whoosh |
| Jump | `move-jump` | 0.2 | ±10% | Subtle lift |
| Land | `move-land` | 0.2 | — | Soft thud |
| Menu click | `ui-click` | 0.4 | — | Crisp, short |
| Upgrade select | `ui-upgrade` | 0.5 | — | Ascending tone |
| Level up | `ui-levelup` | 0.6 | — | Triumphant sting |

### 8.3 Music System

| Track | Duration | BPM | Mood | Trigger |
|---|---|---|---|---|
| Menu Theme | 2:00 | 100 | Chill, inviting | MainMenu scene |
| Fight Neon | 2:30 | 128 | Energetic, synthwave | Neon Arena stage |
| Fight Rooftop | 2:30 | 110 | Lo-fi, relaxed intensity | Rooftop stage |
| Fight Dojo | 2:30 | 95 | Traditional, focused | Dojo stage |

**Music Rules:**
- Cross-fade between tracks (500ms transition)
- Music volume: 40% during gameplay, 70% in menus
- Duck music volume by 50% during announcer voice lines
- Pause music when game is paused
- Stream from disk (do not decode entire track into memory)

---

## 9. Visual Effect Color Palettes

### 9.1 Character Effect Colors

Each character has a unique color palette used for particles, hit flash tinting, and special move effects.

| Character | Primary Color | Secondary Color | Hit Spark Color | Special Trail Color |
|---|---|---|---|---|
| **Rex** | #ff6633 (Orange) | #ff3300 (Red-Orange) | #ff9966 | #ffcc00 (Gold) |
| **Volt** | #3399ff (Blue) | #0066ff (Deep Blue) | #66ccff | #00ffff (Cyan) |
| **Titan** | #996633 (Brown) | #663300 (Dark Brown) | #cc9966 | #99ff33 (Green) |
| **Luna** | #cc66ff (Purple) | #9933cc (Deep Purple) | #dd99ff | #ff66cc (Pink) |
| **Blaze** | #ff3300 (Red) | #ff0000 (Pure Red) | #ff6633 | #ffff00 (Yellow) |
| **Frost** | #66ccff (Cyan) | #3399ff (Blue) | #99eeff | #ffffff (White) |
| **Shadow** | #333366 (Dark Blue) | #1a1a33 (Near Black) | #6666cc | #000000 (Void) |
| **Astra** | #ffcc00 (Gold) | #ff9900 (Amber) | #ffee66 | #ff33ff (Magenta) |

### 9.2 UI Color Constants

| Element | Color | Hex | Usage |
|---|---|---|---|
| HP Bar (Healthy) | Green | #22c55e | HP 100–60% |
| HP Bar (Caution) | Yellow | #eab308 | HP 59–30% |
| HP Bar (Danger) | Orange | #f97316 | HP 29–10% |
| HP Bar (Critical) | Red | #ef4444 | HP 9–0% |
| HP Bar (Dead) | Gray | #6b7280 | KO |
| SP Bar (Full) | Bright Blue | #60a5fa | SP 100% |
| SP Bar (Normal) | Blue | #3b82f6 | SP 100–50% |
| SP Bar (Low) | Dark Blue | #1e40af | SP 49–20% |
| SP Bar (Critical) | Dark Blue+Red | #1e40af + #dc2626 | SP 19–0% |
| Combo Counter (1–2) | White | #ffffff | Low combo |
| Combo Counter (3–4) | Yellow | #eab308 | Medium combo |
| Combo Counter (5–6) | Red | #ef4444 | High combo |
| Combo Counter (7+) | Purple | #a855f7 | Maximum combo |
| Damage Number (Normal) | White | #ffffff | Standard hit |
| Damage Number (Heavy) | Red | #ef4444 | Heavy attack |
| Damage Number (Counter) | Purple | #a855f7 | Counter hit |
| Perfect Block Flash | Blue | #3b82f6 | Perfect block |
| Guard Break Flash | Red | #dc2626 | Guard break |
| KO Text | White + Red Glow | #ffffff + #ef4444 | KO announcement |

### 9.3 Effect Layering Order (Z-Index)

| Layer | Z-Index | Content |
|---|---|---|
| Background (far) | 0 | Stage parallax layer 3 |
| Background (mid) | 1 | Stage parallax layer 2 |
| Background (near) | 2 | Stage parallax layer 1 |
| Ground | 5 | Ground plane |
| Player 1 | 10 | P1 character sprite |
| Player 2 | 10 | P2 character sprite |
| Hit Effects | 15 | Particles, hit sparks |
| Projectile | 12 | Luna's Lunar Beam, etc. |
| Damage Numbers | 20 | Floating numbers |
| UI HUD | 50 | HP bars, SP bars, timer |
| Announcements | 60 | "ROUND 1", "FIGHT!", "KO!" |
| Touch Controls | 70 | Virtual joystick + buttons |
| Pause Overlay | 80 | Pause menu |

---

## 10. Easing Functions & Animation Curves

### 10.1 Easing Library

All animations use these standard easing functions for consistent feel:

```typescript
// Easing functions (t: 0→1, returns 0→1)
const Easing = {
  // Linear
  linear: (t: number) => t,

  // Ease In (slow start)
  easeInQuad: (t: number) => t * t,
  easeInCubic: (t: number) => t * t * t,

  // Ease Out (slow end)
  easeOutQuad: (t: number) => t * (2 - t),
  easeOutCubic: (t: number) => (--t) * t * t + 1,

  // Ease In-Out (slow start and end)
  easeInOutQuad: (t: number) => t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t,
  easeInOutCubic: (t: number) => t < 0.5 ? 4 * t * t * t : (t - 1) * (2 * t - 2) * (2 * t - 2) + 1,

  // Bounce
  easeOutBounce: (t: number) => {
    if (t < 1/2.75) return 7.5625 * t * t;
    if (t < 2/2.75) return 7.5625 * (t -= 1.5/2.75) * t + 0.75;
    if (t < 2.5/2.75) return 7.5625 * (t -= 2.25/2.75) * t + 0.9375;
    return 7.5625 * (t -= 2.625/2.75) * t + 0.984375;
  },

  // Elastic
  easeOutElastic: (t: number) => {
    if (t === 0 || t === 1) return t;
    return Math.pow(2, -10 * t) * Math.sin((t - 0.1) * 5 * Math.PI) + 1;
  },
};
```

### 10.2 Animation Curve Assignments

| Animation | Easing | Duration | Notes |
|---|---|---|---|
| **UI Button Press** | easeOutQuad | 100ms | Quick snap back |
| **UI Screen Slide** | easeInOutCubic | 300ms | Smooth in/out |
| **Combo Counter Scale** | easeOutBounce | 300ms | Playful bounce |
| **Damage Number Rise** | easeOutQuad | 500ms | Fast rise, slow fade |
| **Camera Shake Decay** | Exponential | Variable | `e^(-time/duration)` |
| **Camera Zoom In** | easeOutCubic | 200ms | Smooth zoom |
| **Camera Zoom Out** | easeInCubic | 300ms | Gradual return |
| **Hit Flash** | Linear | 2 frames | On/off, no interpolation |
| **HP Bar Drain** | easeOutQuad | 500ms | Ghost segment fade |
| **SP Regen Ticks** | easeOutLinear | 100ms per tick | Quick rise, quick fade |
| **KO Slow-Mo Transition** | easeInOutQuad | 200ms | Smooth speed change |
| **Round Announcement** | easeOutBounce | 1500ms | Dramatic entrance |
| **Victory Pose** | easeOutElastic | 800ms | Celebratory bounce |
| **Upgrade Card Slide** | easeOutCubic | 400ms | Cards slide in from right |
| **Vignette Pulse** | Sine wave | Variable | `opacity = base + sin(time * freq) * amplitude` |

### 10.3 Key Animation Timing Reference

| Event | Start Value | End Value | Duration | Easing |
|---|---|---|---|---|
| Button press scale | 1.0 | 0.9 | 50ms | easeOutQuad |
| Button release scale | 0.9 | 1.0 | 100ms | easeOutBounce |
| Combo counter appear | 0.0 (scale) | 1.0 | 200ms | easeOutBounce |
| Damage number appear | 0.0 (alpha) | 1.0 | 50ms | Linear |
| Damage number rise | Y+0 | Y-60px | 500ms | easeOutQuad |
| Damage number fade | 1.0 (alpha) | 0.0 | 500ms (last 300ms) | Linear |
| HP ghost drain | current HP | target HP | 500ms | easeOutQuad |
| Screen shake | intensity | 0 | duration | Exponential decay |
| Camera zoom in | 1.0 | 1.1 | 200ms | easeOutCubic |
| Camera zoom out | 1.1 | 1.0 | 300ms | easeInCubic |
| KO slow-mo enter | 1.0 (speed) | 0.3 | 200ms | easeInOutQuad |
| KO slow-mo exit | 0.3 | 1.0 | 100ms | easeInQuad |
| Round text entrance | 0.0 (scale) | 1.0 | 500ms | easeOutElastic |
| Upgrade card slide | X+640 | X+0 | 400ms | easeOutCubic |

---

## 11. Physics Tuning & Timestep Management

### 11.1 Engine Configuration

| Parameter | Value | Rationale |
|---|---|---|
| Physics Engine | Phaser Arcade Physics | Lightweight, sufficient for 2D fighter hitbox/hurtbox collision |
| Gravity X | 0 | No horizontal gravity |
| Gravity Y | 800 px/s² | Standard platformer gravity — responsive without being floaty |
| World Bounds | x: 240, y: 160, w: 800, h: 400 | Centered play area within 1280×720 viewport |
| Max Physics Step | 1000/60 ms (16.67ms) | Ensures 60fps physics updates |
| Physics Iterations | 10 | Sufficient for accurate collision at fighting game speeds |
| Delta Smoothing | true | Prevents physics spikes from frame drops |

### 11.2 Variable Frame Rate Handling

**Problem:** Mobile devices may drop below 60fps, causing physics to slow down or behave erratically.

**Solution:** Fixed timestep with accumulator pattern.

```typescript
// Fixed timestep configuration
const FIXED_TIMESTEP = 1000 / 60; // 16.67ms (60fps)
const MAX_TIMESTEP = 1000 / 30;   // 33.33ms (30fps minimum)
const MAX_SUBSTEPS = 2;           // Maximum physics steps per frame

// In GameScene.update():
update(time: number, delta: number) {
  // Clamp delta to prevent spiral of death
  const clampedDelta = Math.min(delta, MAX_TIMESTEP);
  
  // Accumulate time
  this.accumulator += clampedDelta;
  
  // Fixed timestep loop
  while (this.accumulator >= FIXED_TIMESTEP) {
    this.fixedUpdate(FIXED_TIMESTEP);
    this.accumulator -= FIXED_TIMESTEP;
    this.substeps++;
    
    if (this.substeps >= MAX_SUBSTEPS) break;
  }
  
  // Interpolation factor for smooth rendering
  this.alpha = this.accumulator / FIXED_TIMESTEP;
}

// Physics and game logic run at fixed rate
fixedUpdate(dt: number) {
  // Input processing
  // AI decision making
  // Combat system (hitbox checks, damage)
  // State machine updates
  // Camera updates
}
```

**Frame Drop Behavior:**

| FPS | Physics Steps | Visual Quality | Gameplay Impact |
|---|---|---|---|
| 60fps | 1 per frame | Full | None |
| 45fps | 1–2 per frame | Full (interpolated) | None |
| 30fps | 1–2 per frame | Full (interpolated) | None |
| 20fps | 2 per frame (max) | Reduced quality | Slight input delay |
| <20fps | 2 per frame (max) | Low quality | Noticeable delay |

### 11.3 Movement Physics (Detailed)

| Parameter | Value | Formula/Notes |
|---|---|---|
| Ground Friction | 0.85 | Applied per frame when no input |
| Air Friction | 0.95 | Reduced friction in air |
| Max Fall Speed | 600 px/s | Terminal velocity |
| Jump Cut | 0.4× | Releasing jump early multiplies upward velocity by 0.4 |
| Coyote Time | 6 frames (100ms) | Grace period after leaving ground |
| Jump Buffer | 8 frames (133ms) | Input jump slightly before landing |
| Dash Momentum | 500 px/s → 0 px/s over 12 frames | Burst with exponential decay |
| Back Dash Momentum | 400 px/s → 0 px/s over 10 frames | Weaker retreat |
| Walk Deceleration | 100 px/s² | Applied when releasing movement input |

### 11.4 Jump Physics (Detailed)

| Parameter | Value | Notes |
|---|---|---|
| Initial Velocity | -600 px/s (upward) | Negative = upward in Phaser |
| Gravity Multiplier (Rising) | 1.0× | Standard gravity while rising |
| Gravity Multiplier (Falling) | 1.2× | Slightly faster fall for snappier feel |
| Max Height | ~180 px above ground | Achieved at frame ~20 (333ms) |
| Total Air Time | ~35 frames (583ms) | Jump to land |
| Horizontal Momentum | Preserved from ground | Walking momentum carries into jump |

**Jump Curve Formula:**
```
velocity_y(t) = -600 + (800 × gravity_multiplier × t)
height(t) = sum of velocity_y over frames
```

### 11.5 Collision Groups

| Group A | Group B | Behavior | Notes |
|---|---|---|---|
| Player1 (body) | Player2 (body) | Separate | Prevents overlap; pushes apart |
| Player1 (hitbox) | Player2 (hurtbox) | Overlap | Triggers hit detection |
| Player2 (hitbox) | Player1 (hurtbox) | Overlap | Triggers hit detection |
| Projectile | Player (hurtbox) | Overlap | Triggers projectile hit |
| Player (body) | StageBounds | Collide | Prevents leaving play area |
| Projectile | StageBounds | Collide | Destroys projectile on boundary hit |

### 11.6 Hitbox/Hurtbox System

**Implementation:** Sprite-based collision detection using Arcade Physics overlap callbacks.

**Hitbox Sizes (relative to character anchor at feet center):**

| Body Part | Width | Height | Offset X | Offset Y |
|---|---|---|---|---|
| Standing Hurtbox | 48px | 88px | 0 | -88 |
| Crouching Hurtbox | 48px | 56px | 0 | -56 |
| Jump Hurtbox | 48px | 80px | 0 | -80 |
| Light Attack Hitbox | 56px | 32px | +30 | -50 |
| Heavy Attack Hitbox | 72px | 40px | +40 | -48 |
| Throw Hitbox | 40px | 40px | +20 | -50 |
| Special Hitbox | Character-specific | Character-specific | Character-specific | Character-specific |

**Hitbox Timing:**
- Hitboxes are ONLY active during the "active frames" of an attack
- On active frame start: enable hitbox collision
- On active frame end: disable hitbox collision
- Hitbox position mirrors character facing direction

**Hurtbox Behavior:**
- Always active except during invincibility frames
- Shrinks during crouch (88px → 56px height)
- Slightly smaller during jump (88px → 80px height)
- Disabled during back dash invincibility (8 frames)

---

## 12. Matchup Data & Rock-Paper-Scissors Validation

### 12.1 Character Archetype Matchup Matrix

Win rates are approximate targets based on equally skilled players. Numbers represent expected win rate for the row character against the column character.

| | Rex | Volt | Titan | Luna |
|---|---|---|---|---|
| **Rex** | 50% | 48% | 52% | 50% |
| **Volt** | 52% | 50% | 45% | 55% |
| **Titan** | 48% | 55% | 50% | 42% |
| **Luna** | 50% | 45% | 58% | 50% |

### 12.2 Matchup Logic

| Matchup | Advantage | Why | Counterplay |
|---|---|---|---|
| **Volt vs Titan** | Volt (55%) | Speed negates Titan's slow approach; can whiff-punish heavy attacks | Titan uses armor to absorb hits; closer spacing negates speed advantage |
| **Luna vs Titan** | Luna (58%) | Projectile keeps Titan away; Titan cannot close distance | Titan uses jumping to approach; armor through projectiles |
| **Volt vs Luna** | Volt (55%) | Lightning Dash passes through projectiles; closes distance fast | Luna uses anti-air; keeps Volt at mid-range |
| **Rex vs all** | 48–52% | Balanced — no hard advantage or disadvantage | Rex wins through fundamentals, not matchup knowledge |

### 12.3 Matchup-Specific Frame Data Interactions

| Situation | Interaction | Result |
|---|---|---|
| Volt Light → Luna Block | Volt: +1 on hit, -2 on block | Volt can pressure safely |
| Titan Heavy → Volt Block | Titan: -8 on block, Volt: +8 | Volt gets full punish |
| Luna Projectile → Titan Armor | Titan absorbs 1 hit (50% damage) | Titan continues approach |
| Rex Special → Any Block | Rex: -6 on block | Punishable by fast characters |

### 12.4 Character-Specific Punish Data

| Character | Best Punish | Damage | Input | When to Use |
|---|---|---|---|---|
| **Rex** | Heavy → Special Cancel | 40 | H→Special | After blocking any heavy attack |
| **Volt** | Light → Light → Heavy | 25 | L→L→H | After whiff-punishing any move |
| **Titan** | Throw | 25 | Throw | After blocking any special (close range) |
| **Luna** | Lunar Beam (full screen) | 22 | Special | After any whiff at distance |

---

## 13. Economy

### 13.1 Primary Revenue: Rewarded Video Ads

**Integration Points (all opt-in):**

| Point | Description | Engagement |
|---|---|---|
| **Run Complete** | "Double your coins!" — watch ad for 2× coin reward | Highest engagement |
| **Run Failed** | "Continue your run?" — 1 ad per run to continue from current fight | High engagement |
| **Character Preview** | "Try this locked fighter?" — watch ad to try a locked fighter for 30 sec | Medium engagement |
| **Between Runs** | Interstitial ad (skip after 3s) | Medium engagement |
| **Daily Bonus** | "Watch ad for bonus coins" (50 coins → 80 with ad) | Medium engagement |

**eCPM Benchmarks (2026):**

| Metric | Value |
|---|---|
| Gross US web eCPM | $6–$15 |
| After geo blend + consent + fill + split | $4–$8 net take-home |
| Opt-in rate | 97% |
| Completion rate | 93.8% global, 95.4% tier-1 |
| Fill rate | 95.1% |
| Action/arcade genre ARPU | $0.08 |
| ARPDAU target (casual) | $0.08–$0.15 |

### 13.2 Meta-Economy Balance

**Revenue Projections:**

| Phase | DAU | Monthly Revenue |
|---|---|---|
| Phase 1 (MVP) | 1K–20K | $148–$3,920 |
| Phase 2 (Growth) | 5K–50K | $2,360–$109,800 |
| Phase 3 (Scale) | 20K–100K | $10,000–$250,000+ |

**Coin Faucets:**

| Source | Coins | Frequency |
|---|---|---|
| Win a round | 10 | Per round |
| Win a match | 25 | Per match |
| Complete a run | 50 | Per run |
| Daily login | 50 | Daily |
| Watch rewarded ad | 30 | Per ad |

**Coin Sinks:**

| Item | Price | Runs to Earn (F2P) |
|---|---|---|
| Character skin | 200–500 | 2–5 runs |
| Stage theme | 300–600 | 3–6 runs |
| Victory pose | 150–300 | 1.5–3 runs |
| Particle effect | 100–200 | 1–2 runs |

### 13.3 Daily Login Streak

| Day | Coins | Rationale |
|---|---|---|
| 1 | 50 coins | Daily retention |
| 3 | +20 coins (80 total) | Streak incentive |
| 7 | +50 coins (130 total) | Weekly retention |
| 14 | New fighter preview + 100 coins | Major milestone |
| 30 | Title "Veteran" + 200 coins | Long-term engagement |

### 13.4 Ad Mediation Waterfall

1. **Poki SDK** — 50/50 split on Poki-driven traffic; 100% on developer-driven
2. **CrazyGames** — 60% ads / 70% IAP to developers (2026 jam terms)
3. **Playgama Bridge** — 80% developer share (best in market)
4. **Direct buys** — MarketJS, CodeThisLab: $300–$800 non-exclusive, $5,000+ exclusive

---

## 14. Balancing Requirements

### 14.1 Universal Frame Data (60fps)

**Frame Phases:** [Startup] → [Active] → [Recovery] → [Idle]

**Frame Advantage Formula:**
```
Frame Advantage = Hitstun of defender − Recovery of attacker
```
- Positive = attacker recovers first (frame advantage)
- Negative = defender recovers first (frame disadvantage)

**Universal Attack Properties:**

| Attack Type | Damage Range | Stamina Cost | Blockstun | Hitstun |
|---|---|---|---|---|
| Light | 5–8 | 0 | −4 on block | 10–14 frames |
| Heavy | 12–18 | 15 | −4 on block | 16–22 frames |
| Special | 20–30 | 30–50 | Varies by move | Varies by move |
| Throw | 15 | 20 | Unblockable | 20–24 frames |

### 14.2 Hitstun & Knockback Formulas

**Hitstun Formula:**
```
hitstun = base_hitstun + floor(damage / 3)
```

**Knockback Formula:**
```
knockback_x = base_knockback × (1 + damage / 50)
knockback_y = base_knockback_y × (1 + damage / 80)
```

**Weight System:**
```
actual_knockback = base_knockback / weight
```
- Titan (1.2) takes 17% less knockback than Rex (1.0)
- Volt (0.85) takes 18% more knockback than Rex

### 14.3 Combo Scaling

| Combo Hit | Damage Multiplier | Notes |
|---|---|---|
| Hit 1 | 100% | Full damage |
| Hit 2 | 90% | Slight reduction |
| Hit 3 | 80% | Moderate reduction |
| Hit 4 | 70% | Significant reduction |
| Hit 5+ | 60% | Minimum scaling |

**Scaling Formula:**
```
scaled_damage = base_damage × max(0.6, 1.0 − (combo_hit − 1) × 0.1)
```

**Maximum Combo Length:** 6 hits (limited by scaling and hitstun decay). With "Flow State" upgrade: 7 hits. Air combos: 3 hits max (juggle limit).

### 14.4 Guard Break Balance

- Blocking drains 5 SP/frame
- Reaching 0 SP = guard broken (30-frame stagger, 40px backward push)
- Cannot block or attack during stagger
- SP fully restores after stagger ends
- Guard break cannot be telegraphed; happens silently when SP depletes

### 14.5 Character Balance Targets

| Stat | Rex | Volt | Titan | Luna | Balance Tolerance |
|---|---|---|---|---|---|
| **Time to KO (opponent)** | 4.2 sec | 4.5 sec | 3.8 sec | 4.8 sec | ±0.5 sec |
| **Survival Time** | 4.2 sec | 3.6 sec | 5.0 sec | 3.8 sec | ±0.5 sec |
| **Combo Damage (3-hit)** | 29 | 25 | 36 | 22 | ±5 |
| **Special Damage** | 25 | 20 | 30 | 22 | ±3 |
| **Win Rate vs Random** | 25% | 25% | 25% | 25% | ±3% |

### 14.6 Stage Balance

- All 3 MVP stages (Neon Arena, Rooftop, Dojo) are cosmetically distinct but have **identical play area dimensions** (800×400) and boundary placement
- No stage provides gameplay advantage (no hazards, no uneven ground)
- Visual differences only (background, particles, lighting)

### 14.7 Visual Juice Balance

- Screen shake intensity clamped to 12px max (prevent motion sickness)
- Hit stop duration: Light 2 frames, Heavy 4 frames, Special 6 frames, KO 8 frames
- Slow motion limited to 1 active at a time; KO finish 0.3× for 500ms max
- Particle count max 100 per emitter; 200 pooled particles recycled

---

## 15. Accessibility Adaptations

### 15.1 Reduced Motion Mode

When enabled (Settings → Accessibility → Reduced Motion):

| Effect | Normal | Reduced Motion |
|---|---|---|
| Screen Shake | Full | Disabled |
| Hit Stop | Full | Disabled |
| Slow Motion | Full | Disabled |
| Particles | Full | 25% count |
| Flash Effects | Full | 50% intensity |
| Camera Zoom | Full | Disabled |
| Combo Counter Animation | Full | Static (no animation) |
| Damage Number Animation | Full | Static (appear/disappear) |

### 15.2 Colorblind Modes

| Mode | HP Bar | P1 Indicator | P2 Indicator | Hit Numbers |
|---|---|---|---|---|
| Normal | Green→Yellow→Orange→Red | Blue | Red | White/Yellow/Red/Purple |
| Protanopia | Blue→Yellow→Orange→Red | Blue | Yellow | White/Yellow/Blue/Purple |
| Deuteranopia | Blue→Yellow→Orange→Red | Blue | Yellow | White/Yellow/Blue/Purple |
| Tritanopia | Green→Yellow→Orange→Red | Blue | Red | White/Yellow/Red/Purple |

### 15.3 Control Remapping

- Full keyboard remapping in Settings
- Touch button positions adjustable (drag to reposition)
- Gamepad button remapping via standard browser API
- Virtual joystick sensitivity slider (50%–150%)

### 15.4 Audio Accessibility

| Feature | Implementation |
|---|---|
| Separate volume sliders | SFX, Music, Announcer — independent 0–100% |
| Mute toggle | Global mute for all audio |
| Visual sound indicators | Subtitle for important sounds ("*HIT*", "*BLOCK*") |
| Announcer text backup | All announcer lines also shown as text on screen |

### 15.5 Difficulty Accessibility

| Feature | Effect |
|---|---|
| **Auto-Block** (optional) | Character automatically blocks when not attacking |
| **Combo Assist** (optional) | Holding light attack auto-chains L→L→H |
| **Slow Game** (optional) | Game runs at 0.8× speed (all timings scaled) |
| **Extended Windows** (optional) | All timing windows extended by 50% |

---

## 16. Implementation Checklist

### Physics System
- [ ] Configure Arcade Physics in Phaser game config
- [ ] Set gravity to 800 px/s²
- [ ] Create stage boundary colliders
- [ ] Implement hitbox/hurtbox collision groups
- [ ] Add ground friction and air friction
- [ ] Implement jump cut (variable jump height)
- [ ] Add coyote time and jump buffer
- [ ] Implement fixed timestep with accumulator
- [ ] Add delta clamping for low-end devices

### Combat Tuning
- [ ] Implement frame data for all 4 starter characters
- [ ] Create hitbox/hurtbox sprites per attack
- [ ] Implement hitstun and blockstun
- [ ] Add guard break mechanic
- [ ] Implement perfect block
- [ ] Add combo scaling
- [ ] Create damage number system
- [ ] Validate matchup balance (win rates within ±5% of 50%)

### Input System
- [ ] Build Unified Input Manager class
- [ ] Implement keyboard mapping (P1 + P2)
- [ ] Implement gamepad support with rumble
- [ ] Integrate phaser-virtual-joystick
- [ ] Add input buffer (12 frames)
- [ ] Implement touch detection
- [ ] Add tablet force-touch override
- [ ] Add input latency measurement

### Feedback Systems
- [ ] Implement hit flash system with character colors
- [ ] Add screen shake with exponential decay
- [ ] Create hit stop (freeze frame) system
- [ ] Build particle system with pooling
- [ ] Add slow motion with smooth transitions
- [ ] Implement camera zoom with lerp
- [ ] Create combo counter UI with easing
- [ ] Add floating damage numbers
- [ ] Implement HP/SP bar feedback
- [ ] Create round announcement system

### Sound Design
- [ ] Implement AudioManager class
- [ ] Add hit SFX (6 variants)
- [ ] Add block SFX (3 variants)
- [ ] Add movement SFX (4 variants)
- [ ] Add announcer voice lines (7 lines)
- [ ] Add UI SFX (3 variants)
- [ ] Add stage ambience (3 tracks)
- [ ] Add music system with cross-fade
- [ ] Add ducking for announcer voice

### Difficulty Curve
- [ ] Implement 5 AI difficulty tiers
- [ ] Create AI decision tree
- [ ] Add reaction time variation
- [ ] Implement combo knowledge per tier
- [ ] Add adaptive difficulty (hidden)
- [ ] Create upgrade system with rarity weights
- [ ] Implement upgrade synergies
- [ ] Create boss phase mechanics

### Performance
- [ ] Implement performance tier detection
- [ ] Add quality tier switching
- [ ] Reduce particle counts for medium/low tiers
- [ ] Disable effects for low tier
- [ ] Optimize sprite atlases
- [ ] Add FPS counter for debugging
- [ ] Test on low-end Android device (2020+)
- [ ] Verify 30fps minimum on all tiers

---

## Artifact Summary

This gameplay design artifact v2.0 defines the complete mechanics foundation for Battle Brawl. All specifications are implementation-ready with performance-adaptive quality tiers, sound design specs, visual effect color palettes, easing functions, physics timestep management, matchup data, and accessibility adaptations.

**Key design pillars:**
1. **Instant play** — <10s to first fight, zero download
2. **Distinctive characters** — 4 starter archetypes (Balanced, Rushdown, Grappler, Zoner), non-stickman art
3. **Satisfying combat** — Frame-data-based system with visual juice (hitstop, screen shake, particles, slow-mo)
4. **Roguelite gauntlet** — 3–5 fights per run with upgrade choices between rounds ("one more try" loop)
5. **Mobile-first touch** — Virtual joystick + 4 buttons designed from day one for 62–81% mobile traffic
6. **Portal compliance** — <8MB initial load, 16:9 aspect ratio, incognito-safe save, Poki SDK integration
7. **Performance-adaptive** — 3 quality tiers (High/Medium/Low) maintain 30fps on all devices
8. **Accessible** — Reduced motion, colorblind modes, control remapping, difficulty assists

**Implementation phases:**
- **MVP (8–10 weeks):** Core combat, 4 characters, 3 stages, gauntlet mode, touch controls, juice effects, XP/coin economy, Poki SDK
- **Phase 2 (4–6 weeks):** Online multiplayer (Colyseus), 2 additional characters, cosmetic IAP, daily challenges
- **Phase 3 (4–6 weeks):** Season pass/battle pass, team battles, story mode, 2 additional characters

---

*Gameplay Design Artifact v2.0 — September 14, 2026*
*Enhanced with: performance tiers, sound design, color palettes, easing functions, physics timestep management, matchup data, accessibility.*
*Based on: GDD v1.1, gameplay-mechanics.md v1.0, game-concept.md v5, market-research.md, competitor-analysis.md.*
