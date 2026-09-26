# Coin Rush Arena — Game Design Document (GDD)

**Version:** 1.0  
**Date:** September 2026  
**Author:** AI Factory Game Designer  
**Project:** coin-rush-arena (Roblox + Luau + Rojo)  
**Status:** COMPLETE — Ready for production planning  

---

## Table of Contents

1. [Vision & Design Pillars](#1-vision--design-pillars)
2. [Core Gameplay Mechanics](#2-core-gameplay-mechanics)
3. [Systems Design](#3-systems-design)
4. [Progression Design](#4-progression-design)
5. [UX Flow](#5-ux-flow)
6. [Content Structure](#6-content-structure)
7. [Monetization Design](#7-monetization-design)
8. [Architecture — Roblox Services & Modules](#8-architecture--roblox-services--modules)
9. [Production Priorities](#9-production-priorities)
10. [Acceptance Criteria](#10-acceptance-criteria)

---

## 1. Vision & Design Pillars

### 1.1 Vision Statement

**Coin Rush Arena** is a Roblox game that fuses incremental coin-collecting loops with fast-paced arena PvP rounds. Players farm coins in an open world to upgrade speed and abilities, then enter timed PvP arenas where those upgrades matter — creating a "collect → upgrade → compete → repeat" loop that no top Roblox game currently offers.

**One-liner:** *"Collect coins. Get faster. Dominate the arena."*

### 1.2 Design Pillars

| # | Pillar | Description | Design Implication |
|---|--------|-------------|-------------------|
| 1 | **Satisfying Collection** | Every coin pickup must feel rewarding — visual sparkle, sound feedback, visible progress | Coin particles, "+1" floating text, satisfying SFX, HUD counter updates instantly |
| 2 | **Visible Progression** | Players must feel measurably stronger after every few minutes of play | Speed upgrades are immediately felt in movement; magnet radius is visible; power affects arena damage |
| 3 | **Quick Competition** | Arena rounds are short (3-5 min), creating "just one more round" re-entry hooks | Mobile-friendly session design, fast matchmaking, clear win/loss outcomes |
| 4 | **Fair Play** | No pay-to-win in PvP; power upgrades earned through gameplay only | Monetization is cosmetic/convenience; arena balance is skill + earned progression |
| 5 | **Social Connection** | Playing with friends is always better than playing alone | Party system with coin multiplier, team arena modes, friend leaderboards |
| 6 | **Return Incentive** | Players always have a reason to come back | Offline coins, daily rewards, limited-time events, arena season resets |

### 1.3 Target Player Experience

**Session Goal:** 8–15 minutes per session, 3–5 sessions per day

| Minute | Activity | Feeling |
|--------|----------|---------|
| 0–1 | Login, claim offline coins, check daily reward | *"Nice, I have coins waiting for me"* |
| 1–5 | Farm coins in open world, buy 1–2 upgrades | *"My character is getting faster, this feels good"* |
| 5–8 | Enter arena, play 1 round | *"That was quick, I almost won — let me try again"* |
| 8–12 | Return to farm, spend arena winnings on upgrades | *"I can afford that upgrade now!"* |
| 12–15 | Play another arena round or log off | *"I'll check back in a few hours for my idle coins"* |

### 1.4 Player Archetypes

| Archetype | What They Want | How We Serve It |
|-----------|---------------|-----------------|
| **The Farmer** | Relaxing collection loop | Open world coin farming, satisfying pickup feel, idle/offline coins |
| **The Competitor** | PvP dominance | Arena rounds, leaderboards, win streaks, rating system |
| **The Collector** | Cosmetic completion | Pets, trails, effects, seasonal cosmetics with rarity tiers |
| **The Optimizer** | Min-max progression | Exponential upgrade tree, farming route efficiency, stat tracking |
| **The Socializer** | Play with friends | Party system, team arena, friend leaderboards, trading |

---

## 2. Core Gameplay Mechanics

### 2.1 Coin Collection (Primary Loop)

**How it works:**
- Coins spawn on a timer (every 5 seconds per `Config.COIN_RESPAWN_SECONDS`)
- 4 coin types with different values and spawn rates
- Players walk over coins to collect them (server-authoritative)
- Satisfying visual/audio feedback on every pickup

**Coin Types:**

| Type | Value | Spawn Rate | Visual | Rarity |
|------|-------|------------|--------|--------|
| Bronze | 1 coin | 60% of spawns | Brown-gold cylinder, small glow | Common |
| Silver | 5 coins | 25% of spawns | Silver cylinder, medium glow | Uncommon |
| Gold | 25 coins | 12% of spawns | Bright gold cylinder, large glow + particles | Rare |
| Meteor | 100 coins | 3% of spawns | Large red-gold cylinder, fire trail + screen shake | Epic |

**Spawn System:**
- Open world area: 80×80 studs (expandable)
- Coins spawn at random positions within the area
- Max 50 coins in world simultaneously (`Config.COIN_MAX_COUNT`)
- Coin respawns after 5-second delay at a new random position
- Procedural spawning (no fixed points — more dynamic than current 8-point system)

**Collection Mechanics:**
- Server-authoritative: client detects touch, server validates and awards
- Debounce: 0.3s cooldown per player to prevent double-collection
- Magnet upgrade: increases collection radius from 4 studs to 12 studs
- Visual: coin part destroyed on collect, particle burst effect, "+N" floating text
- Audio: distinct SFX per coin type (bronze clink → gold chime → meteor boom)

### 2.2 Upgrade System (Progression Loop)

**How it works:**
- Players spend collected coins on upgrades
- Exponential cost curve: `floor(baseCost × 1.6^level)`
- Each upgrade tier is immediately felt in gameplay

**Upgrade Types:**

| Upgrade | What It Does | Cost Formula | Max Level | Max Effect |
|---------|-------------|--------------|-----------|------------|
| **Speed** | Increases WalkSpeed | `floor(25 × 1.6^level)` | 16 | 16 → 32 (+2/level) |
| **Magnet** | Increases coin pickup radius | `floor(50 × 1.6^level)` | 8 | 4 → 12 studs (+1/level) |
| **Power** | Increases arena damage | `floor(100 × 1.6^level)` | 10 | 10 → 30 dmg (+2/level) |
| **Multiplier** | Increases coin collection rate | `floor(200 × 1.6^level)` | 5 | 1.0x → 2.0x (+0.2/level) |

**Speed Upgrade Breakdown (existing, verified):**

| Level | Cost (cumulative) | WalkSpeed | Speed Increase |
|-------|-------------------|-----------|---------------|
| 0 | — | 16 | — |
| 1 | 25 | 18 | +2 |
| 2 | 65 | 20 | +2 |
| 3 | 129 | 22 | +2 |
| 4 | 232 | 24 | +2 |
| 5 | 377 | 26 | +2 |
| 6 | 584 | 28 | +2 |
| 7 | 860 | 30 | +2 |
| 8 | 1,225 | 32 | +2 (MAX) |

**Total cost to max speed:** ~1,225 coins  
**Total cost to max all upgrades:** ~50,000+ coins (long-tail progression)

**Upgrade UX:**
- Upgrade button in bottom-right of HUD
- Button color: green (can afford), red (can't afford), gray (maxed)
- Cost displayed below button
- Instant visual feedback: WalkSpeed changes immediately
- Sound: upgrade SFX, level-up chime

### 2.3 Arena PvP (Competition Loop)

**How it works:**
- Players enter arena portal in open world
- Matchmaking: fill lobby of 4–8 players (or add bots if queue > 30s)
- 3–5 minute timed round
- Upgrades carry into arena (speed, magnet, power all matter)
- Server-authoritative: all outcomes validated server-side
- Winner gets bonus coins + rating points

**Arena Modes:**

#### Coin King (FFA, 8 players) — P0 Priority
- **Goal:** Collect the most coins in 3 minutes
- **Mechanic:** Coins spawn across the arena; players race to collect them
- **Twist:** Players can steal coins from others by bumping into them (steals 10% of their carried coins)
- **Scoring:** Coins collected during round + bonus for 1st/2nd/3rd place
- **Duration:** 3 minutes
- **Win Condition:** Most coins when timer ends

#### Speed Blitz (Team 4v4) — P1 Priority
- **Goal:** Team with the most coins wins
- **Mechanic:** Same as Coin King but team-based
- **Bonus:** Party system grants 1.2x coin multiplier for friends
- **Duration:** 4 minutes
- **Win Condition:** Team total > opposing team total

#### Last Coin Standing (FFA, 12 players) — P2 Priority
- **Goal:** Be the last player alive
- **Mechanic:** One coin spawns at a time; grab it to survive, miss it and you're eliminated
- **Twist:** Shrinking play area forces confrontation
- **Duration:** 5–8 minutes (until 1 player remains)
- **Win Condition:** Last player standing

**Arena Design Principles:**
- Quick rounds (3–5 min) for mobile-friendly sessions
- Upgrades matter but skill (movement, positioning) matters more
- Clear visual indicators for coin locations, timers, scores
- Post-round screen shows stats: coins collected, steals, placement
- "Just one more round" re-entry: instant rematch option, XP/coin bonus for consecutive plays

**Anti-Cheat:**
- Server validates all coin pickups (no client-side coin counting)
- Server tracks player positions for steal validation
- Rate limiting on arena actions (max 1 steal per 2 seconds)
- Server-authoritative round timer and scoring

### 2.4 Open World (Farming Area)

**Map Design:**
- Size: 80×80 studs (expandable to 120×120 at launch)
- Terrain: flat grassy area with visual variety (trees, rocks, paths)
- Spawn area: central point with upgrade shop nearby
- Arena portal: prominent structure on map edge
- Leaderboard board: visible in-world display of top players

**Environmental Features:**
- Coin spawn zones: marked areas where coins appear
- Speed boost pads: temporary speed increase (cosmetic, not upgrade-related)
- Visual landmarks: help players navigate and remember farming routes
- Day/night cycle: cosmetic only, coins always visible

**Map Expansion (Post-Launch):**
- New zones unlocked by total coins earned
- Each zone has unique coin types and spawn patterns
- Zone-specific cosmetics and achievements

---

## 3. Systems Design

### 3.1 Data Persistence System

**Current State:** Implemented in `PlayerData.lua`

**Data Model (expanded):**

```lua
type PlayerData = {
    -- Core
    Coins: number,              -- Current coin balance
    TotalCoins: number,         -- Lifetime coins earned
    
    -- Upgrades
    SpeedLevel: number,         -- Speed upgrade level (0-16)
    MagnetLevel: number,        -- Magnet upgrade level (0-8)
    PowerLevel: number,         -- Arena power upgrade level (0-10)
    MultiplierLevel: number,    -- Coin multiplier level (0-5)
    
    -- Arena
    ArenaWins: number,          -- Total arena victories
    ArenaRating: number,        -- Skill rating for matchmaking (starts at 1000)
    GamesPlayed: number,        -- Lifetime arena games
    WinStreak: number,          -- Current win streak
    BestWinStreak: number,      -- All-time best win streak
    
    -- Cosmetics
    Cosmetics: {number},        -- Unlocked cosmetic IDs
    EquippedTrail: number?,     -- Currently equipped trail ID
    EquippedPet: number?,       -- Currently equipped pet ID
    
    -- Retention
    LastLogin: number,          -- os.time() of last login (for daily rewards)
    LastOnline: number,         -- os.time() of last online (for offline coins)
    DailyRewardsClaimed: number, -- Consecutive days claimed (resets on miss)
    
    -- Social
    FriendsPlayedWith: {number}, -- UserIds of friends who play
}
```

**Persistence Rules:**
- DataStore key: `"player_{UserId}"`
- Autosave every 60 seconds
- Save on PlayerRemoving
- Save on BindToClose (server shutdown)
- Error logging with warn() on DataStore failures
- Estimated data size: ~200 bytes (well within 4 MB limit)

### 3.2 Offline/Idle Coin System

**How it works:**
- When player logs off, `LastOnline` is saved
- When player logs back in, offline time is calculated
- Coins generate at a rate based on player's upgrade level
- Capped at 8 hours of offline accumulation

**Offline Coin Formula:**
```
offlineCoins = min(
    offlineTime (seconds) × baseRate × (1 + magnetLevel × 0.1) × multiplier,
    maxOfflineCoins
)
```

**Parameters:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Base rate | 1 coin/10 seconds | Slow enough to not replace active play |
| Magnet bonus | +10% per magnet level | Rewards magnet investment |
| Multiplier bonus | Applies | Multiplier affects offline too |
| Max offline time | 8 hours | Prevents infinite accumulation |
| Max offline coins | 500 coins | Cap prevents abuse |
| VIP bonus | +50% offline coins | Monetization hook |

**UX:**
- On login, show "Welcome back!" modal with offline coin summary
- "Claim" button to collect offline coins
- Visual: coins fly into HUD counter with satisfying animation

### 3.3 Daily Login Rewards

**7-Day Cycle (repeating):**

| Day | Reward | Value |
|-----|--------|-------|
| 1 | Bronze Coins | 50 |
| 2 | Silver Coins | 25 (5 × 5) |
| 3 | Gold Coins | 25 |
| 4 | Speed Boost (5 min) | Free |
| 5 | Silver Coins | 50 (10 × 5) |
| 6 | Gold Coins | 50 |
| 7 | **Legendary Crate** | Random cosmetic |

**Rules:**
- Must claim within 24 hours or cycle resets to Day 1
- Consecutive days tracked (miss a day = reset to Day 1)
- VIP players get 2x daily rewards
- Visual: calendar-style UI with days 1-7 displayed

### 3.4 Matchmaking System

**Queue Logic:**
1. Player enters arena portal → selects mode → enters queue
2. Server searches for existing lobby with open slots
3. If no lobby found, create new lobby
4. Fill remaining slots with bots if queue > 30 seconds
5. Start countdown when lobby is full (4-8 players depending on mode)
6. Round begins after 5-second countdown

**Matchmaking Parameters:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Min players to start | 2 | Don't block on full lobby |
| Max wait time | 30 seconds | Fill with bots after timeout |
| Bot difficulty | Medium | Simulates real players |
| Lobby timeout | 60 seconds | Disband empty lobbies |
| Rating range | ±200 points | Fair matches within skill range |

**Post-Round:**
- Show stats: coins collected, steals, placement, rating change
- "Play Again" button for instant rematch
- "Return to Farm" button to leave arena

### 3.5 Leaderboard System

**Categories:**

| Category | Sort By | Reset |
|----------|---------|-------|
| Total Coins | Coins earned (lifetime) | Never |
| Arena Wins | Total victories | Never |
| Win Streak | Current streak | Never |
| Arena Rating | Skill rating | Seasonal (monthly) |
| Weekly Coins | Coins earned (this week) | Weekly |

**Views:**
- **Global:** Top 100 players worldwide
- **Friends:** Only players on your friends list
- **Server:** Players on current server

**UX:**
- In-world leaderboard board near spawn
- HUD leaderboard button for quick access
- Friend comparison: "You are #47 among friends"

### 3.6 Trading System (P2)

**How it works:**
- Players can trade cosmetic items (pets, trails, effects)
- Trading hub in open world (physical location)
- Both players must be online and near the hub
- Server validates all trades (no exploits)
- Trade history logged for moderation

**Tradeable Items:**
- Pets (with rarity tiers)
- Trail effects
- Aura effects
- Coin skins (visual only)

**Rarity Tiers:**

| Tier | Color | Drop Rate | Example |
|------|-------|-----------|---------|
| Common | White | 60% | Bronze Trail |
| Uncommon | Green | 25% | Silver Aura |
| Rare | Blue | 10% | Gold Pet |
| Epic | Purple | 4% | Meteor Trail |
| Legendary | Gold | 1% | Dragon Pet |

---

## 4. Progression Design

### 4.1 Short-Term Progression (Session: 8–15 min)

**Goal:** Player earns 1–2 upgrades per session

**Flow:**
1. Login → claim offline coins (~50-100 coins)
2. Farm 5 min → earn ~200-400 coins
3. Buy 1–2 upgrades → feel immediate improvement
4. Enter arena → earn bonus coins (~50-150)
5. Total session earnings: ~300-650 coins
6. 1–2 upgrade purchases = satisfying progression

### 4.2 Medium-Term Progression (Week 1–7)

**Goal:** Player reaches Speed Level 5–8, unlocks first cosmetics

**Milestones:**

| Day | Achievement | Reward |
|-----|-------------|--------|
| Day 1 | First arena win | 100 bonus coins |
| Day 2 | Speed Level 3 | Bronze Trail cosmetic |
| Day 3 | 7-day login streak Day 3 | Speed Boost (5 min) |
| Day 5 | 10 arena wins | Silver Aura cosmetic |
| Day 7 | Speed Level 5 | Gold Pet cosmetic |
| Day 14 | 50 arena wins | Epic Trail cosmetic |
| Day 30 | Speed Level 8 | Legendary Crate |

### 4.3 Long-Term Progression (Month 2–6)

**Goal:** Max upgrades, full cosmetic collection, high arena rating

**End-Game Goals:**
- Max all upgrades (50,000+ coins total)
- Reach Arena Rating 2000+ (top 10%)
- Collect all cosmetics (200+ items)
- Complete all seasonal content
- Achieve legendary pet collection

### 4.4 Prestige System (Post-Launch)

**Concept:** After maxing all upgrades, players can "prestige" to reset upgrades in exchange for exclusive rewards.

**Prestige Tiers:**

| Prestige | Reset Requirement | Reward |
|----------|-------------------|--------|
| 1 | Max all upgrades | Golden character skin + 10% coin bonus |
| 2 | Max all upgrades again | Diamond character skin + 20% coin bonus |
| 3 | Max all upgrades again | Rainbow character skin + 30% coin bonus |

**Prestige Benefits:**
- Permanent coin multiplier (persists through resets)
- Exclusive cosmetics only available through prestige
- Prestige leaderboard category
- Visual indicator of prestige level

---

## 5. UX Flow

### 5.1 First-Time Player Flow

```
[Launch] → [Loading Screen] → [Spawn in Open World]
    ↓
[Tutorial Overlay: "Walk over coins to collect them!"]
    ↓
[Player collects 5 coins] → [Tutorial: "Tap Upgrade to get faster!"]
    ↓
[Player upgrades speed] → [Tutorial: "Enter the arena to compete!"]
    ↓
[Player enters arena] → [Tutorial: "Collect the most coins to win!"]
    ↓
[Round ends] → [Results Screen] → [Tutorial: "Claim your rewards!"]
    ↓
[Return to farm] → [Tutorial Complete]
```

**Tutorial Design:**
- 5-step interactive tutorial (not text walls)
- Each step has a highlight ring pointing to the objective
- Skip option after first 3 steps
- Tutorial state saved (never repeat)

### 5.2 Core Loop UX (Returning Player)

```
[Login] → [Offline Coins Modal: "Welcome back! You earned 150 coins"]
    ↓
[Claim] → [Daily Reward Modal: "Day 3: Speed Boost!"]
    ↓
[Claim] → [Spawn in Open World]
    ↓
[Farm coins 3-5 min] → [Buy upgrades]
    ↓
[Enter Arena] → [Matchmaking 5-30s] → [Play Round 3-5 min]
    ↓
[Results Screen] → ["Play Again" or "Return to Farm"]
    ↓
[If Play Again: repeat arena loop]
[If Return to Farm: spend winnings, buy upgrades, log off]
```

### 5.3 HUD Layout

```
┌─────────────────────────────────────────────────────────┐
│ [Coins: 1,234]                                          │
│ [Speed: 18]                                              │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│                        [Arena Portal]                   │
│                                                         │
│                                                         │
│                                                         │
│                                                         │
│ [Upgrade]  [Leaderboard]  [Shop]  [Settings]           │
└─────────────────────────────────────────────────────────┘
```

**HUD Elements:**

| Element | Position | Purpose |
|---------|----------|---------|
| Coin Counter | Top-left | Shows current coin balance |
| Speed Display | Top-left (below coins) | Shows current speed level |
| Upgrade Button | Bottom-right | Buy upgrades (green/red/gray) |
| Leaderboard Button | Bottom-center | Opens leaderboard modal |
| Shop Button | Bottom-center | Opens cosmetic shop |
| Settings Button | Bottom-right corner | Opens settings menu |
| Arena Portal Marker | In-world | Points to arena entrance |

### 5.4 Modal Designs

**Offline Coins Modal:**
```
┌──────────────────────────────┐
│     WELCOME BACK!            │
│                              │
│   You earned 150 coins       │
│   while you were away!       │
│                              │
│   [Claim Coins]              │
└──────────────────────────────┘
```

**Daily Reward Modal:**
```
┌──────────────────────────────┐
│     DAILY REWARD             │
│                              │
│   Day 3: Speed Boost (5min)  │
│                              │
│   [1] [2] [✓3] [4] [5] [6] [7] │
│                              │
│   [Claim]                    │
└──────────────────────────────┘
```

**Arena Results Modal:**
```
┌──────────────────────────────┐
│     ROUND RESULTS            │
│                              │
│   🥇 1st Place!              │
│                              │
│   Coins: 45                  │
│   Steals: 3                  │
│   Rating: +25 (1,025)        │
│                              │
│   [Play Again]  [Farm]       │
└──────────────────────────────┘
```

### 5.5 Mobile-Specific UX

**Touch Controls:**
- Joystick for movement (bottom-left)
- Virtual joystick appears only on mobile
- Tap coins to collect (in addition to walk-over)
- Upgrade button enlarged for touch targets (min 48px)

**Screen Layout:**
- Portrait: simplified HUD, smaller elements
- Landscape: full HUD, larger touch targets
- Auto-detect orientation and adjust

**Performance:**
- Reduce particle effects on low-end devices
- Lower coin count on mobile (30 vs 50)
- Simplified arena visuals on mobile

---

## 6. Content Structure

### 6.1 Launch Content (MVP)

| Category | Items | Count |
|----------|-------|-------|
| Coin Types | Bronze, Silver, Gold, Meteor | 4 |
| Upgrades | Speed, Magnet | 2 |
| Arena Modes | Coin King (FFA) | 1 |
| Cosmetics | 5 trails, 3 auras | 8 |
| Map | Open world (80×80 studs) | 1 |
| Tutorial | 5-step interactive | 1 |

### 6.2 Week 2–4 Content

| Category | Items | Count |
|----------|-------|-------|
| Upgrades | Power, Multiplier | 2 |
| Arena Modes | Speed Blitz (4v4) | 1 |
| Cosmetics | 10 trails, 5 auras, 5 pets | 20 |
| Daily Rewards | 7-day cycle | 1 system |
| Game Passes | 2x Coins, VIP, Speed Boost | 3 |
| Leaderboards | Global, Friends, Server | 3 views |

### 6.3 Month 2–3 Content

| Category | Items | Count |
|----------|-------|-------|
| Arena Modes | Last Coin Standing | 1 |
| Cosmetics | 20 trails, 10 auras, 15 pets | 45 |
| Trading | Trading hub + system | 1 system |
| Seasonal | First seasonal event | 1 event |
| Dev Products | Coin packs, boost timers, crates | 5 |

### 6.4 Month 4+ Content

| Category | Items | Count |
|----------|-------|-------|
| Social | Guilds/clans system | 1 system |
| Arena | Spectator mode | 1 feature |
| Cosmetics | 30 trails, 15 auras, 20 pets | 65 |
| Seasonal | Monthly seasonal events | 12/year |
| Prestige | Prestige system | 1 system |

### 6.5 Content Pipeline

**Seasonal Content Calendar:**

| Month | Theme | New Cosmetics | New Arena Mode | Event |
|-------|-------|---------------|----------------|-------|
| Launch | Coin Rush | 8 items | Coin King | — |
| Month 2 | Speed Demon | 10 items | Speed Blitz | Speed Week |
| Month 3 | Last Stand | 10 items | Last Coin Standing | Survival Event |
| Month 4 | Trading Post | 15 items | — | Trading Tournament |
| Month 5 | Prestige | 20 items | — | Prestige Launch |
| Month 6 | Summer | 25 items | Summer Arena | Summer Festival |

---

## 7. Monetization Design

### 7.1 Philosophy

**"Pay for convenience and cosmetics, not for power in PvP."**

- Arena power upgrades are earned through gameplay only
- Cosmetic items are the primary monetization layer
- Game passes affect farming speed, not arena damage/defense
- Leaderboards have separate "free" and "all" categories

### 7.2 Revenue Stack

| Tier | Product | Price Range (Robux) | Revenue Share | Purpose |
|------|---------|---------------------|---------------|---------|
| **Game Passes** | 2x Coins | 99–199 | ~70% | Core monetization, permanent upgrade |
| | VIP | 299–499 | ~70% | Premium experience, daily bonus |
| | Speed Boost | 49–99 | ~70% | Convenience, faster progression |
| **Dev Products** | Coin Packs (S/M/L) | 25–199 | ~70% | Consumable, impulse purchases |
| | Boost Timers (2x 30min) | 49–99 | ~70% | Session-enhancing consumable |
| | Cosmetic Crate | 49–149 | ~70% | Random cosmetic unlock |
| **Subscriptions** | Monthly VIP | 199/month | 70% first / 100% renewals | Recurring revenue |
| **Ads** | Rewarded Video | Free | ~$6–12 eCPM | Extra coins, spin wheel, revive |

### 7.3 Anti-Pay-to-Win Safeguards

| Rule | Implementation |
|------|----------------|
| Arena power earned, not bought | PowerLevel upgrade only through coin spending |
| Cosmetics are visual only | No stat bonuses from cosmetic items |
| Game passes affect farming, not combat | 2x Coins doubles collection, not arena damage |
| Separate leaderboards | "Free" and "All" categories |
| Cross-experience passes disabled | All monetization stays in-game |

### 7.4 18+ DevEx Optimization

- Use R15 avatars (required for US 18+ eligibility)
- US 18+ DevEx rate: $0.0054/Robux (vs. $0.0038 standard — +42%)
- 18+ cohort: 27% of DAU, growing 50%+ YoY, spending 40–50% more
- Design competitive depth + cosmetics to attract this high-value segment

### 7.5 Creator Rewards Baseline Income

- **Daily Engagement:** 5 Robux per Active Spender (spent $9.99+ in 60 days) who plays 10+ min
- **Audience Expansion:** 35% revenue share on first $100 spend by new/reactivated users
- Maximize hours engaged (idle/AFK farming) + return frequency (offline coins)

---

## 8. Architecture — Roblox Services & Modules

### 8.1 Runtime Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         SERVER                                   │
│                                                                  │
│  ServerScriptService/                                            │
│  ├── main.server.lua          ← Server entry, orchestrator      │
│  ├── PlayerData.lua           ← DataStore persistence           │
│  ├── ArenaService.lua         ← Arena matchmaking, rounds       │
│  ├── LeaderboardService.lua   ← Leaderboard management          │
│  ├── OfflineService.lua       ← Offline coin calculation        │
│  └── DailyRewardService.lua   ← Daily login rewards             │
│                                                                  │
│  ServerStorage/                                                  │
│  ├── ServerConfig.lua         ← Server-only config              │
│  └── CoinService.lua          ← Pure math functions (server)    │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                    REPLICATEDSTORAGE                              │
│                                                                  │
│  Shared/                                                         │
│  ├── Config.lua               ← Game constants (shared)         │
│  ├── RemoteNames.lua          ← RemoteEvent name constants      │
│  ├── CoinService.lua          ← Pure math functions (shared)    │
│  ├── UpgradeConfig.lua        ← Upgrade definitions             │
│  └── ArenaConfig.lua          ← Arena mode configurations       │
│                                                                  │
│  Remotes/ (created at runtime)                                   │
│  ├── RequestUpgrade           ← Client→Server: buy upgrade      │
│  ├── CoinCollected            ← Server→Client: coin pickup SFX  │
│  ├── JoinArena                ← Client→Server: enter queue      │
│  ├── ArenaState               ← Server→Client: round state      │
│  ├── ArenaScore               ← Server→Client: score update     │
│  ├── ClaimDailyReward         ← Client→Server: claim reward     │
│  ├── ClaimOfflineCoins        ← Client→Server: claim offline    │
│  ├── RequestTrade             ← Client→Server: initiate trade   │
│  └── LeaderboardData          ← Server→Client: leaderboard data │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                       CLIENT                                     │
│                                                                  │
│  StarterPlayerScripts/                                           │
│  ├── main.client.lua          ← Client bootstrap                │
│  ├── ArenaClient.lua          ← Arena UI + input                │
│  ├── LeaderboardClient.lua    ← Leaderboard UI                  │
│  └── ShopClient.lua           ← Cosmetic shop UI                │
│                                                                  │
│  StarterGui/                                                     │
│  ├── HUD.client.lua           ← Main HUD (coins, speed)        │
│  ├── UpgradeUI.client.lua     ← Upgrade panel                   │
│  ├── DailyRewardUI.client.lua ← Daily reward modal              │
│  └── OfflineCoinsUI.client.lua← Offline coins modal             │
│                                                                  │
├─────────────────────────────────────────────────────────────────┤
│                       WORKSPACE                                  │
│                                                                  │
│  Coins/ (created at runtime)                                     │
│  ├── Coin (Part) × N          ← Active coin instances           │
│                                                                  │
│  Arena/ (created at runtime)                                     │
│  ├── ArenaLobby               ← Lobby area                      │
│  ├── ArenaArena               ← Battle arena                    │
│  └── ArenaPortal              ← Portal to enter arena           │
│                                                                  │
│  Map/                                                            │
│  ├── Terrain                  ← Ground terrain                  │
│  ├── Decorations              ← Trees, rocks, paths             │
│  ├── SpawnPoint               ← Player spawn location           │
│  └── LeaderboardBoard         ← In-world leaderboard display   │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 8.2 Server Module Architecture

#### `main.server.lua` — Server Orchestrator

**Responsibilities:**
- Player lifecycle management (PlayerAdded/PlayerRemoving)
- Coin spawning system
- RemoteEvent creation and wiring
- Service initialization
- Autosave loop

**Key Functions:**
```lua
-- Player lifecycle
onPlayerAdded(player) → setupLeaderstats, load data, apply speed
onPlayerRemoving(player) → save data, cleanup

-- Coin system
spawnCoin() → create coin part, wire touch handler
startCoinSpawning() → spawn initial coins

-- Upgrade handler
onUpgradeRequest(player) → validate, deduct, apply, sync

-- Service init
initializeServices() → ArenaService, LeaderboardService, etc.
```

#### `PlayerData.lua` — Data Persistence

**Responsibilities:**
- DataStore read/write
- In-memory cache management
- Leaderstats synchronization
- Autosave coordination

**Key Functions:**
```lua
PlayerData.get(player) → data table
PlayerData.addCoins(player, amount) → new balance
PlayerData.subtractCoins(player, amount) → success boolean
PlayerData.load(player) → load from DataStore
PlayerData.save(player) → save to DataStore
PlayerData.startAutosave() → begin autosave loop
```

#### `ArenaService.lua` — Arena System (NEW)

**Responsibilities:**
- Matchmaking queue management
- Lobby creation and filling
- Round lifecycle (start, tick, end)
- Score tracking and validation
- Bot AI for fill players

**Key Functions:**
```lua
ArenaService.joinQueue(player, mode) → queue position
ArenaService.leaveQueue(player) → removed from queue
ArenaService.startRound(lobby) → initialize round
ArenaService.onCoinCollected(player, coin) → update score
ArenaService.onPlayerSteal(stealer, victim) → validate, update
ArenaService.endRound(lobby) → calculate results, award prizes
```

#### `LeaderboardService.lua` — Leaderboards (NEW)

**Responsibilities:**
- Leaderboard data aggregation
- Global/Friends/Server filtering
- Periodic refresh (every 60 seconds)
- In-world display updates

**Key Functions:**
```lua
LeaderboardService.getTop(category, filter, limit) → entries
LeaderboardService.updateScore(player, category, score) → updated rank
LeaderboardService.refresh() → recalculate all boards
```

#### `OfflineService.lua` — Offline Coins (NEW)

**Responsibilities:**
- Calculate offline coin accumulation
- Validate offline time (prevent exploits)
- Apply VIP bonuses
- Generate offline claim data

**Key Functions:**
```lua
OfflineService.calculateOffline(player) → coins, timeAway
OfflineService.claimOffline(player) → coins awarded
OfflineService.validateOfflineTime(player) → safe time value
```

#### `DailyRewardService.lua` — Daily Rewards (NEW)

**Responsibilities:**
- Track daily login streaks
- Generate reward based on day
- Validate claim timing
- Reset streak on miss

**Key Functions:**
```lua
DailyRewardService.getStatus(player) → day, canClaim
DailyRewardService.claimReward(player) → reward data
DailyRewardService.checkStreak(player) → current streak
```

### 8.3 Client Module Architecture

#### `main.client.lua` — Client Bootstrap

**Responsibilities:**
- Initialize client modules
- Connect to remote events
- Setup HUD bindings
- Handle character spawn

#### `HUD.client.lua` — Main HUD

**Responsibilities:**
- Display coin counter
- Display speed level
- Update on leaderstats changes
- Animate coin pickup feedback

#### `ArenaClient.lua` — Arena UI (NEW)

**Responsibilities:**
- Arena queue UI
- In-round HUD (timer, scores, minimap)
- Post-round results screen
- Input handling during arena

### 8.4 Data Flow Diagrams

#### Coin Collection Flow
```
Client (main.client.lua)          Server (main.server.lua)
        │                                    │
        │ [Coin.Touched fires]              │
        │ ──────────────────────────────→    │
        │                                    │
        │                    [Validate: coin exists, player alive]
        │                    [Check debounce attribute]
        │                    [PlayerData.addCoins(player, value)]
        │                    [Destroy coin part]
        │                    [Schedule respawn]
        │                                    │
        │    ←───────────────────────────── │
        │ [CoinCollected:FireClient(player)] │
        │                                    │
        │ [Play pickup SFX + particles]      │
        │ [Update HUD coin counter]          │
```

#### Upgrade Purchase Flow
```
Client (UpgradeUI)               Server (main.server.lua)
        │                                    │
        │ [UpgradeButton.Activated]          │
        │ ──FireServer()────────────────→    │
        │                                    │
        │                    [Validate: enough coins, not maxed]
        │                    [PlayerData.subtractCoins(player, cost)]
        │                    [Increment SpeedLevel]
        │                    [Apply WalkSpeed]
        │                    [Sync leaderstats]
        │                                    │
        │    ←───────────────────────────── │
        │ [leaderstats.SpeedLevel changes]   │
        │                                    │
        │ [Update HUD speed display]         │
        │ [Update upgrade button state]      │
```

#### Arena Flow
```
Client (ArenaClient)             Server (ArenaService)
        │                                    │
        │ [JoinArena:FireServer(mode)]       │
        │ ──────────────────────────────→    │
        │                                    │
        │                    [Add to queue]
        │                    [If queue full: create lobby]
        │                    [If lobby full: start countdown]
        │                                    │
        │    ←──── ArenaState ────────────── │
        │ [Show "Waiting for players..."]    │
        │                                    │
        │    ←──── ArenaState ────────────── │
        │ [Show "Round starting in 3..."]    │
        │                                    │
        │    ←──── ArenaState ────────────── │
        │ [Show arena HUD, enable movement]  │
        │                                    │
        │ [Player collects coin in arena]    │
        │ ──ArenaCoinCollected:FireServer()→ │
        │                                    │
        │                    [Validate pickup]
        │                    [Update score]
        │                                    │
        │    ←──── ArenaScore ────────────── │
        │ [Update score display]             │
        │                                    │
        │    ←──── ArenaState ────────────── │
        │ [Show results screen]              │
```

### 8.5 Rojo Project Structure

```
coin-rush-arena/
├── default.project.json
├── rokit.toml
├── src/
│   ├── ServerScriptService/
│   │   ├── main.server.lua          ← Server entry
│   │   ├── PlayerData.lua           ← DataStore persistence
│   │   ├── ArenaService.lua         ← Arena system (NEW)
│   │   ├── LeaderboardService.lua   ← Leaderboards (NEW)
│   │   ├── OfflineService.lua       ← Offline coins (NEW)
│   │   └── DailyRewardService.lua   ← Daily rewards (NEW)
│   ├── ServerStorage/
│   │   ├── ServerConfig.lua         ← Server-only config
│   │   └── CoinService.lua          ← Pure math (server)
│   ├── ReplicatedStorage/
│   │   ├── Shared/
│   │   │   ├── Config.lua           ← Game constants
│   │   │   ├── RemoteNames.lua      ← Remote names (NEW)
│   │   │   ├── CoinService.lua      ← Pure math (shared)
│   │   │   ├── UpgradeConfig.lua    ← Upgrade defs (NEW)
│   │   │   └── ArenaConfig.lua      ← Arena config (NEW)
│   │   └── Remotes/
│   │       ├── RequestUpgrade.model.json
│   │       ├── CoinCollected.model.json
│   │       ├── JoinArena.model.json        (NEW)
│   │       ├── ArenaState.model.json       (NEW)
│   │       ├── ArenaScore.model.json       (NEW)
│   │       ├── ClaimDailyReward.model.json (NEW)
│   │       ├── ClaimOfflineCoins.model.json(NEW)
│   │       ├── RequestTrade.model.json     (NEW)
│   │       └── LeaderboardData.model.json  (NEW)
│   ├── StarterPlayer/
│   │   └── StarterPlayerScripts/
│   │       ├── main.client.lua      ← Client entry
│   │       ├── ArenaClient.lua      ← Arena UI (NEW)
│   │       ├── LeaderboardClient.lua← Leaderboard UI (NEW)
│   │       └── ShopClient.lua       ← Shop UI (NEW)
│   ├── StarterGui/
│   │   ├── HUD.client.lua           ← Main HUD
│   │   ├── UpgradeUI.client.lua     ← Upgrade panel (NEW)
│   │   ├── DailyRewardUI.client.lua ← Daily rewards (NEW)
│   │   └── OfflineCoinsUI.client.lua← Offline coins (NEW)
│   └── Workspace/
│       └── README.md
├── build/
└── docs/
    ├── GDD.md                       ← This document
    ├── GAME_CONCEPT.md
    ├── MARKET_ANALYSIS.md
    ├── competitor-analysis.md
    └── TECHNICAL_DESIGN.md
```

---

## 9. Production Priorities

### 9.1 Phase 1: MVP Core Loop (Week 1–2)

**Goal:** Ship the core "collect → upgrade → compete" loop

| Priority | Feature | Files | Est. Time | Dependencies |
|----------|---------|-------|-----------|--------------|
| P0 | Coin collection (multi-type) | main.server.lua, Config.lua | 2h | None |
| P0 | Speed upgrades (existing) | main.server.lua, CoinService.lua | Done | None |
| P0 | DataStore persistence (existing) | PlayerData.lua | Done | None |
| P0 | Visual HUD (existing) | HUD.client.lua | Done | None |
| P0 | Arena PvP — Coin King | ArenaService.lua, ArenaClient.lua | 8h | Coin system |
| P0 | Basic leaderboards | LeaderboardService.lua | 4h | PlayerData |
| P0 | Remote events (all) | RemoteNames.lua, Remotes/ | 2h | None |
| **Total Phase 1** | | | **16h** | |

### 9.2 Phase 2: Retention & Social (Week 3–4)

**Goal:** Drive return frequency and social engagement

| Priority | Feature | Files | Est. Time | Dependencies |
|----------|---------|-------|-----------|--------------|
| P1 | Offline/idle coins | OfflineService.lua | 4h | PlayerData |
| P1 | Daily login rewards | DailyRewardService.lua | 3h | PlayerData |
| P1 | Arena — Speed Blitz (4v4) | ArenaService.lua | 4h | Arena system |
| P1 | Party system | PartyService.lua | 5h | Matchmaking |
| P1 | Game passes (3 passes) | MarketplaceService | 3h | Monetization |
| P1 | Coin types (Bronze/Silver/Gold/Meteor) | Config.lua, main.server.lua | 2h | Coin system |
| **Total Phase 2** | | | **21h** | |

### 9.3 Phase 3: Monetization & Content (Month 2–3)

**Goal:** Full monetization stack and content depth

| Priority | Feature | Files | Est. Time | Dependencies |
|----------|---------|-------|-----------|--------------|
| P2 | Cosmetic system (trails, auras) | CosmeticService.lua | 6h | Data model |
| P2 | Pet companions | PetService.lua | 8h | Cosmetic system |
| P2 | Arena — Last Coin Standing | ArenaService.lua | 4h | Arena system |
| P2 | Trading hub | TradingService.lua | 6h | Pet/cosmetic system |
| P2 | Seasonal events (first) | SeasonalService.lua | 5h | Content pipeline |
| P2 | Developer Products (5 products) | MarketplaceService | 3h | Monetization |
| **Total Phase 3** | | | **32h** | |

### 9.4 Phase 4: Scale & Optimize (Month 4+)

**Goal:** Long-term retention and revenue optimization

| Priority | Feature | Files | Est. Time | Dependencies |
|----------|---------|-------|-----------|--------------|
| P3 | Guilds/clans | GuildService.lua | 8h | Social system |
| P3 | Arena spectator mode | ArenaService.lua | 4h | Arena system |
| P3 | Subscription VIP | MarketplaceService | 2h | Monetization |
| P3 | Prestige system | PrestigeService.lua | 5h | Max upgrades |
| P3 | Map expansion | Workspace assets | 10h | Art pipeline |
| P3 | Creator Store integration | MarketplaceService | 3h | UGC pipeline |
| **Total Phase 4** | | | **32h** | |

### 9.5 Total Production Estimate

| Phase | Duration | Features | Cumulative |
|-------|----------|----------|------------|
| Phase 1: MVP | Week 1–2 | Core loop + arena | 16h |
| Phase 2: Retention | Week 3–4 | Offline, daily, social | 37h |
| Phase 3: Monetization | Month 2–3 | Cosmetics, pets, trading | 69h |
| Phase 4: Scale | Month 4+ | Guilds, prestige, expansion | 101h |

### 9.6 Resource Requirements

| Role | Phase 1–2 | Phase 3–4 | Notes |
|------|-----------|-----------|-------|
| Game Designer | 0.5 FTE | 0.25 FTE | GDD + tuning |
| Lead Programmer | 1.0 FTE | 1.0 FTE | Core systems |
| UI Programmer | 0.5 FTE | 0.5 FTE | HUD, modals, menus |
| 3D Artist | 0.25 FTE | 0.5 FTE | Cosmetics, pets, map |
| Sound Designer | 0.25 FTE | 0.25 FTE | SFX, music |
| QA | 0.25 FTE | 0.5 FTE | Testing, balancing |
| **Total** | **2.75 FTE** | **3.0 FTE** | |

---

## 10. Acceptance Criteria

### 10.1 Core Loop AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-CL-1 | Coin collection works | Walk into coin | Coin disappears, balance increases |
| AC-CL-2 | Multi-type coins spawn | Observe world for 30s | All 4 types appear at expected rates |
| AC-CL-3 | Speed upgrade works | Buy speed upgrade | WalkSpeed increases by 2 |
| AC-CL-4 | Upgrade cost is exponential | Check costs at levels 0-5 | Cost follows floor(25 × 1.6^level) |
| AC-CL-5 | Data persists | Collect coins → rejoin | Coins and upgrades preserved |

### 10.2 Arena AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-AR-1 | Coin King round works | Join 8-player FFA | 3-minute round, coins spawn, winner determined |
| AC-AR-2 | Upgrades carry into arena | Enter arena with Speed 5 | Player moves at Speed 5 in arena |
| AC-AR-3 | Server-authoritative scoring | Check server logs | All coin pickups validated server-side |
| AC-AR-4 | Matchmaking fills lobby | Enter queue alone | Lobby fills with bots after 30s |
| AC-AR-5 | Results screen shows stats | End round | Coins, steals, placement, rating shown |
| AC-AR-6 | Speed Blitz team mode | Join 4v4 | Teams assigned, team total wins |

### 10.3 Retention AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-RT-1 | Offline coins accumulate | Log off for 1 hour, return | Offline coins modal shows earned coins |
| AC-RT-2 | Offline cap works | Log off for 10 hours, return | Only 8 hours of coins awarded |
| AC-RT-3 | Daily reward cycle works | Login 3 consecutive days | Days 1, 2, 3 rewards claimed correctly |
| AC-RT-4 | Streak resets on miss | Skip a day | Streak resets to Day 1 |
| AC-RT-5 | VIP bonus applies | VIP player claims daily | 2x daily reward amount |

### 10.4 Monetization AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-MZ-1 | 2x Coins pass works | Buy pass, collect coins | Coins doubled in collection |
| AC-MZ-2 | VIP pass works | Buy VIP, login daily | Daily rewards doubled |
| AC-MZ-3 | No pay-to-win in arena | Non-VIP vs VIP in arena | Power upgrades not affected by passes |
| AC-MZ-4 | Rewarded ad works | Watch ad, claim reward | Bonus coins awarded |
| AC-MZ-5 | Dev Product purchase works | Buy coin pack | Coins added to balance |

### 10.5 Social AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-SO-1 | Friend leaderboard works | View friends leaderboard | Only friends shown, sorted by score |
| AC-SO-2 | Party system works | Invite friend to party | Both players in party, 1.2x multiplier |
| AC-SO-3 | Trading works | Trade pet with friend | Items exchanged, both inventories updated |
| AC-SO-4 | Guild system works | Create guild, invite member | Guild created, member joined |

### 10.6 Performance AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-PF-1 | 60 FPS on mobile | Play on iPhone 12 | Consistent 60 FPS |
| AC-PF-2 | 60 FPS on PC | Play on mid-range PC | Consistent 60 FPS |
| AC-PF-3 | <100ms network latency | Check client ping | <100ms average |
| AC-PF-4 | DataStore saves succeed | Check server logs | 99.9% save success rate |
| AC-PF-5 | Arena runs at 60 FPS | 8-player arena round | No frame drops |

### 10.7 UX AC

| ID | Criterion | Test | Pass Condition |
|----|-----------|------|----------------|
| AC-UX-1 | Tutorial completes | New player, follow steps | All 5 steps completed |
| AC-UX-2 | HUD updates instantly | Collect coin | Counter updates within 1 frame |
| AC-UX-3 | Upgrade button is clear | Check button state | Green/red/gray based on affordability |
| AC-UX-4 | Modals are readable | Open all modals | Text is legible on mobile |
| AC-UX-5 | Touch targets are large enough | Tap all buttons | Min 48px touch targets |

---

## Appendix A: Configuration Reference

### Config.lua (Shared Constants)

```lua
local Config = {
    GAME_NAME = "Coin Rush Arena",
    GAME_VERSION = "1.0.0",
    
    -- Coin System
    COIN_VALUE = 1,
    COIN_RESPAWN_SECONDS = 5,
    COIN_SPAWN_AREA_SIZE = 80,
    COIN_SPAWN_HEIGHT = 3,
    COIN_MAX_COUNT = 50,
    COIN_TOUCH_COOLDOWN = 0.3,
    
    -- Coin Types
    COIN_TYPES = {
        Bronze = { Value = 1, Weight = 60, Color = Color3.fromRGB(205, 127, 50) },
        Silver = { Value = 5, Weight = 25, Color = Color3.fromRGB(192, 192, 192) },
        Gold = { Value = 25, Weight = 12, Color = Color3.fromRGB(255, 215, 0) },
        Meteor = { Value = 100, Weight = 3, Color = Color3.fromRGB(255, 69, 0) },
    },
    
    -- Speed Upgrade
    START_WALK_SPEED = 16,
    SPEED_UPGRADE_STEP = 2,
    SPEED_UPGRADE_MAX = 32,
    UPGRADE_BASE_COST = 25,
    
    -- Magnet Upgrade
    MAGNET_BASE_RADIUS = 4,
    MAGNET_STEP = 1,
    MAGNET_MAX = 12,
    MAGNET_BASE_COST = 50,
    
    -- Power Upgrade
    POWER_BASE_DAMAGE = 10,
    POWER_STEP = 2,
    POWER_MAX = 30,
    POWER_BASE_COST = 100,
    
    -- Multiplier Upgrade
    MULTIPLIER_BASE = 1.0,
    MULTIPLIER_STEP = 0.2,
    MULTIPLIER_MAX = 2.0,
    MULTIPLIER_BASE_COST = 200,
    
    -- Offline Coins
    OFFLINE_BASE_RATE = 0.1, -- coins per second
    OFFLINE_MAX_HOURS = 8,
    OFFLINE_MAX_COINS = 500,
    
    -- Daily Rewards
    DAILY_REWARDS = {
        [1] = { Type = "Coins", Amount = 50 },
        [2] = { Type = "Coins", Amount = 25 },
        [3] = { Type = "Coins", Amount = 25 },
        [4] = { Type = "SpeedBoost", Duration = 300 },
        [5] = { Type = "Coins", Amount = 50 },
        [6] = { Type = "Coins", Amount = 50 },
        [7] = { Type = "Crate", Rarity = "Legendary" },
    },
    
    -- Arena
    ARENA_ROUND_DURATION = 180, -- 3 minutes
    ARENA_MIN_PLAYERS = 2,
    ARENA_MAX_PLAYERS = 8,
    ARENA_BOT_FILL_DELAY = 30, -- seconds
    ARENA_STEAL_PERCENT = 0.10, -- 10% of carried coins
    
    -- Matchmaking
    MATCHMAKING_RATING_RANGE = 200,
    MATCHMAKING_LOBBY_TIMEOUT = 60,
    
    -- Leaderboard
    LEADERBOARD_REFRESH_INTERVAL = 60, -- seconds
    LEADERBOARD_TOP_LIMIT = 100,
    
    -- Leaderstats
    LEADERSTATS_FOLDER = "leaderstats",
}
```

### ServerConfig.lua (Server-Only)

```lua
local ServerConfig = {
    DATASTORE_NAME = "CoinRushArenaV1",
    AUTOSAVE_SECONDS = 60,
    DATASTORE_RETRY_COUNT = 3,
    DATASTORE_RETRY_DELAY = 1,
    MAX_PLAYERS = 50,
    LOG_LEVEL = "INFO", -- DEBUG, INFO, WARN, ERROR
}
```

---

## Appendix B: Remote Events Reference

| Name | Direction | Payload | Purpose |
|------|-----------|---------|---------|
| RequestUpgrade | Client→Server | { upgradeType: string } | Buy upgrade |
| CoinCollected | Server→Client | {} | Play pickup feedback |
| JoinArena | Client→Server | { mode: string } | Enter matchmaking queue |
| LeaveQueue | Client→Server | {} | Leave matchmaking queue |
| ArenaState | Server→Client | { state: string, data: any } | Round state updates |
| ArenaScore | Server→Client | { scores: {} } | Score updates |
| ArenaCoinCollected | Client→Server | { coinId: number } | Arena coin pickup |
| ClaimDailyReward | Client→Server | {} | Claim daily reward |
| ClaimOfflineCoins | Client→Server | {} | Claim offline coins |
| RequestTrade | Client→Server | { targetPlayer: Player, items: {} } | Initiate trade |
| AcceptTrade | Client→Server | { tradeId: number } | Accept trade |
| LeaderboardData | Server→Client | { category: string, entries: {} } | Leaderboard update |
| ShopData | Server→Client | { items: {} } | Shop inventory |

---

## Appendix C: Success Metrics

### Retention Targets

| Metric | Target | Industry Benchmark (2026) |
|--------|--------|--------------------------|
| Day 1 Retention | 40%+ | 30–35% (Roblox average) |
| Day 7 Retention | 20%+ | 10–15% (Roblox average) |
| Day 30 Retention | 10%+ | 5–8% (Roblox average) |
| Sessions per Day | 3–5 | 2–3 (typical simulator) |

### Engagement Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Average Session Length | 8–15 min | Mobile-friendly, matches platform behavior |
| Arena Rounds per Session | 2–3 | "Just one more round" hook |
| Farm-to-Arena Ratio | 60:40 | Balanced between collection and competition |
| Upgrade Purchases per Session | 2–4 | Progression satisfaction |

### Revenue Targets

| Metric | Target | Benchmark |
|--------|--------|-----------|
| Conversion Rate (free→paying) | 5–7% | Industry: 3–8% |
| ARPPU (monthly) | $8–$15 | Industry: $5–$20 |
| Game Pass Uptake | 15–20% | Industry: 10–25% |
| Rewarded Ad Watch Rate | 50–60% | Industry: 40–70% |

---

**END OF GDD**
