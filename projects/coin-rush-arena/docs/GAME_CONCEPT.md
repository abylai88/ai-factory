# Coin Rush Arena — Game Concept

**Date:** September 2026  
**Sources:** docs/MARKET_ANALYSIS.md (verified Q2 2026 data), docs/competitor-analysis.md, src/ codebase  
**Status:** REFINED — Market-validated concept grounded in actual codebase state

---

## 1. Elevator Pitch

**Coin Rush Arena** is a Roblox game that fuses incremental coin-collecting loops with fast-paced arena PvP rounds. Players farm coins in an open world to upgrade speed and abilities, then enter timed PvP arenas where those upgrades matter — creating a "collect → upgrade → compete → repeat" loop that no top Roblox game currently offers.

**One-liner:** *"Collect coins. Get faster. Dominate the arena."*

### Market Validation (from verified research)

| Signal | Data | Implication |
|--------|------|-------------|
| RIVALS success | $6.8M/month, 122.6K CCU — classified as "Incremental Simulator" with PvP | Hybrid sim+PvP model is proven at scale |
| Steal An Egg breakout | 1.2M CCU in first month, $10.2M revenue | Platform rewards new content velocity — first-mover advantage matters |
| Grow a Garden longevity | 35.9B lifetime visits via offline growth mechanic | Idle/return-frequency design drives massive visit counts |
| Pet Simulator 99 decline | 56.5K CCU (down from ~500K peak) | Pure simulator loop has natural ceiling; differentiation needed |
| Top 10 share shrinking | Now ~20% of total hours (down from 30%) | Room for polished mid-tier games to capture audience |
| 18+ audience explosion | 27% of age-checked DAU, growing 50%+ YoY, 40-50% higher spend | Competitive depth + cosmetics appeal to high-value segment |
| Return frequency trend | Core users stack 6-8 daily sessions (+33% YoY) | Short arena rounds (3-5 min) align with platform behavior |

---

## 2. Unique Selling Proposition (USP)

### Primary USP
**The only Roblox game that merges incremental coin farming with competitive arena PvP in a single seamless loop.**

### Competitive Positioning Matrix

| Game | Incremental Loop | Arena PvP | Offline Progression | Trading Economy | Social Co-play |
|------|:---:|:---:|:---:|:---:|:---:|
| Pet Simulator 99 | ✅ | ❌ | ❌ | ✅ | Limited |
| Grow a Garden | ✅ | ❌ | ✅ | ❌ | Limited |
| Bee Swarm Simulator | ✅ | ❌ | ❌ | ❌ | ❌ |
| +1 Speed Monkey Escape | ✅ | ❌ | ❌ | ❌ | ❌ |
| RIVALS | Partial | ✅ | ❌ | ❌ | Limited |
| Blox Fruits | Grinding | ✅ | ❌ | ✅ | ✅ |
| Arsenal | ❌ | ✅ | ❌ | ❌ | ✅ |
| **Coin Rush Arena** | **✅** | **✅** | **✅** | **✅** | **✅** |

**Gap exploited:** No top-20 Roblox game combines all five mechanics. Coin Rush Arena fills the intersection of incremental simulation + competitive arena + idle progression + trading + social play.

### Secondary USPs
1. **Exponential power curve** — `floor(25 × 1.6^level)` creates satisfying long-tail progression (already implemented in `CoinService.upgradeCost`)
2. **Arena rounds are 3-5 minutes** — mobile-friendly, session-stacking design aligned with 2026 platform behavior
3. **Anti-pay-to-win philosophy** — "Pay for convenience and cosmetics, not for power in PvP"
4. **Offline/idle coin generation** — capped at 8 hours, drives 3-5 daily returns per the RFY 28-day retention window
5. **Trading economy** — tradeable pets/cosmetics with scarcity tiers; #1 signal of long-term staying power per market research
6. **R15 avatars** — qualifies for US 18+ DevEx rate ($0.0054/Robux, +42% over standard)

---

## 3. Core Gameplay Loop

### The Four-Phase Loop

The game revolves around a tight cycle that repeats every 8-15 minutes:

```
┌─────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│  FARM   │ →  │ UPGRADE  │ →  │ COMPETE  │ →  │  EARN    │ ──→ (repeat)
│ (5-10m) │    │ (30-60s) │    │ (3-5min) │    │ (30s)    │
└─────────┘    └──────────┘    └──────────┘    └──────────┘
```

#### Phase 1: FARM (Open World)
- **What:** Players run around the map collecting coins that spawn on a timer (every 5 seconds per `Config.COIN_RESPAWN_SECONDS`)
- **Coin types:** Bronze (1), Silver (5), Gold (25), Meteor (100) — different spawn rates and locations
- **Current state:** 8 fixed spawn points in `main.server.lua` (expand to procedural spawning for full map)
- **Hook:** Satisfying "coin magnet" feel, visual/audio feedback on every pickup
- **Duration:** 5-10 minutes per farming session

#### Phase 2: UPGRADE (Progression)
- **What:** Spend coins on upgrades via exponential cost curve
- **Speed upgrades** (already implemented):
  - Cost: `floor(25 × 1.6^level)` — `CoinService.upgradeCost()`
  - Each level: +2 speed — `CoinService.nextWalkSpeed()`
  - Level 0: cost 25, speed 16 → Level 1: cost 40, speed 18 → Level 2: cost 64, speed 20
  - Max: Level 16, speed 32, total cost ~65,000 coins
- **Additional upgrade paths** (planned):
  - Coin Magnet Radius: 4 studs → 12 studs
  - Arena Power: 10 dmg → 30 dmg
  - Coin Multiplier: 1.0x → 2.0x
- **Hook:** Visible speed increase, character movement feels progressively faster
- **Duration:** 30-60 seconds per upgrade cycle

#### Phase 3: COMPETE (Arena PvP)
- **What:** Enter arena portal → matchmaking → 3-5 minute round
- **Modes:**
  - **Coin King** (FFA, 8 players): Collect scattered coins, most coins when timer ends wins
  - **Speed Blitz** (Team 4v4): Teams race to collect coins, team total wins
  - **Last Coin Standing** (FFA, 12 players): Coins spawn one at a time, grab or get eliminated
- **Upgrades carry into arena** — speed, magnet, power all matter
- **Server-authoritative** — all arena outcomes validated server-side
- **Hook:** "Just one more round" — quick wins/losses create re-entry urge
- **Duration:** 3-5 minutes per round

#### Phase 4: EARN (Rewards)
- **What:** Arena winnings + daily rewards + offline coins
- **Winning grants:** Bonus coins + rating points
- **Daily login:** 7-day escalating reward cycle
- **Offline/idle:** Coins generate while away (capped at 8 hours)
- **Return frequency target:** 3-5 sessions per day

---

## 4. Target Player Experience

### Session Flow (8-15 minutes)

| Minute | Activity | Feeling |
|--------|----------|---------|
| 0-1 | Login, claim offline coins, check daily reward | *"Nice, I have coins waiting for me"* |
| 1-5 | Farm coins in open world, buy 1-2 upgrades | *"My character is getting faster, this feels good"* |
| 5-8 | Enter arena, play 1 round | *"That was quick, I almost won — let me try again"* |
| 8-12 | Return to farm, spend arena winnings on upgrades | *"I can afford that upgrade now!"* |
| 12-15 | Play another arena round or log off | *"I'll check back in a few hours for my idle coins"* |

### Emotional Arc

1. **Discovery (Day 1):** "Oh, I collect coins and get faster? Cool." → Simple to understand
2. **Mastery (Day 2-7):** "I'm optimizing my farming route and upgrading strategically" → Depth emerges
3. **Competition (Day 7+):** "I want to beat my friends on the leaderboard" → Social hook
4. **Collection (Day 30+):** "I need that legendary trail effect" → Long-term aspiration

### Player Archetypes Served

| Archetype | What They Want | How We Serve It |
|-----------|---------------|-----------------|
| **The Farmer** | Relaxing collection loop | Open world coin farming, satisfying pickup feel |
| **The Competitor** | PvP dominance | Arena rounds, leaderboards, win streaks |
| **The Collector** | Cosmetic completion | Pets, trails, effects, seasonal cosmetics |
| **The Optimizer** | Min-max progression | Exponential upgrade tree, farming route efficiency |
| **The Socializer** | Play with friends | Party system, team arena, friend leaderboards |

---

## 5. Key Features (Prioritized)

### P0 — Must Have for MVP (Launch)

| Feature | Description | Code State | Why P0 |
|---------|-------------|------------|--------|
| **Coin Collection** | Coins spawn on timer, player walks over to collect | ✅ Implemented in `main.server.lua` | Foundation of entire game |
| **Speed Upgrades** | Exponential cost curve, visible speed increase | ✅ Implemented in `main.server.lua` + `CoinService.lua` | Core progression mechanic |
| **Server-Authoritative Persistence** | DataStore save/load, autosave, error logging | ✅ Implemented in `PlayerData.lua` | Required for retention |
| **Visual HUD** | Coin count, speed level display | ✅ Implemented in `HUD.client.lua` + `main.client.lua` | Basic UX |
| **Arena PvP — Coin King** | 8-player FFA, collect coins in 3-minute round | ❌ Not implemented | Primary differentiator from simulators |
| **Leaderboards** | Global + friends-only, sorted by coins/arena wins | ❌ Not implemented | Social competition driver |

### P1 — High Priority (Week 2-4)

| Feature | Description | Why P1 |
|---------|-------------|--------|
| **Offline/Idle Coins** | Coins generate while offline (capped at 8 hours) | Return frequency driver — aligns with RFY 28-day retention |
| **Daily Login Rewards** | 7-day reward cycle, escalating coin amounts | Day 1→7 retention — most critical metric for discovery |
| **Arena — Speed Blitz** | Team-based 4v4 coin collection mode | Leverages friend co-play algorithm boost |
| **Party System** | Invite friends, shared coin multiplier (1.2x) | Discovery algorithm explicitly rewards this |
| **Game Passes** | 2x Coins (99-199 R$), VIP (299-499 R$), Speed Boost (49-99 R$) | Primary revenue at ~70% share |
| **Coin Types** | Bronze/Silver/Gold/Meteor coins with different values | Farming variety, deeper progression |

### P2 — Medium Priority (Month 2-3)

| Feature | Description | Why P2 |
|---------|-------------|--------|
| **Cosmetic System** | Trails, effects, auras unlocked via arena wins | Monetization depth without pay-to-win |
| **Pet Companions** | Collectible pets with passive bonuses + tradeable | Collection loop + trading economy (longevity signal) |
| **Arena — Last Coin Standing** | High-tension FFA mode | Mode variety |
| **Trading Hub** | Player-to-player pet/cosmetic trading | #1 signal of long-term staying power per market research |
| **Seasonal Events** | Limited-time arenas, cosmetics, leaderboards | Re-engagement, FOMO loops |
| **Developer Products** | Coin packs, boost timers, pet unlocks | Secondary revenue stream |

### P3 — Nice to Have (Month 4+)

| Feature | Description | Why P3 |
|---------|-------------|--------|
| **Guilds/Clans** | Group progression, guild leaderboards | Long-term social retention |
| **Arena Spectator Mode** | Watch friends' arena rounds | Social engagement |
| **Creator Store Integration** | Publish custom cosmetics | UGC engagement |
| **Subscription VIP** | Monthly recurring pass (199 R$/month) | Recurring revenue at 100% on renewals |

---

## 6. Monetization Design

### Philosophy
**"Pay for convenience and cosmetics, not for power in PvP."**

This avoids pay-to-win perception while maximizing revenue through volume of cosmetic purchases and convenience boosts.

### Revenue Stack

| Tier | Product | Price Range (Robux) | Revenue Share | Purpose |
|------|---------|---------------------|---------------|---------|
| **Game Passes** | 2x Coins | 99-199 | ~70% | Core monetization, permanent upgrade |
| | VIP | 299-499 | ~70% | Premium experience, daily bonus |
| | Speed Boost | 49-99 | ~70% | Convenience, faster progression |
| **Dev Products** | Coin Packs (S/M/L) | 25-199 | ~70% | Consumable, impulse purchases |
| | Boost Timers (2x 30min) | 49-99 | ~70% | Session-enhancing consumable |
| | Cosmetic Crate | 49-149 | ~70% | Random cosmetic unlock |
| **Subscriptions** | Monthly VIP | 199/month | 70% first / 100% renewals | Recurring revenue |
| **Ads** | Rewarded Video | Free | ~$6-12 eCPM | Extra coins, spin wheel, revive |

### Anti-Pay-to-Win Safeguards
- Arena power upgrades earned through gameplay only
- Cosmetic-only premium items in PvP
- Game passes affect farming speed, not arena damage/defense
- Leaderboards have separate "free" and "all" categories
- **Cross-experience passes disabled (May 2026)** — all monetization stays in-game

### 18+ DevEx Optimization
- Use R15 avatars (required for US 18+ eligibility)
- US 18+ DevEx rate: **$0.0054/Robux** (vs. $0.0038 standard — +42%)
- 18+ cohort: 27% of DAU, growing 50%+ YoY, spending 40-50% more
- Design competitive depth + cosmetics to attract this high-value segment

### Creator Rewards Baseline Income
- **Daily Engagement:** 5 Robux per Active Spender (spent $9.99+ in 60 days) who plays 10+ min
- **Audience Expansion:** 35% revenue share on first $100 spend by new/reactivated users
- Maximize hours engaged (idle/AFK farming) + return frequency (offline coins)

---

## 7. Technical Architecture

### Current Codebase State

| File | Status | Purpose |
|------|--------|---------|
| `src/ReplicatedStorage/Shared/Config.lua` | ✅ Implemented | Game constants (coin value, speed params, upgrade costs) |
| `src/ServerStorage/CoinService.lua` | ✅ Implemented | Pure math functions (upgradeCost, nextWalkSpeed) — server-only |
| `src/ServerStorage/ServerConfig.lua` | ✅ Implemented | Server-only config (DataStore name, autosave interval) |
| `src/ServerScriptService/PlayerData.lua` | ✅ Implemented | DataStore persistence, cache, load/save, leaderstats sync |
| `src/ServerScriptService/main.server.lua` | ✅ Implemented | Server entry: coin spawning, upgrade handler, player lifecycle |
| `src/StarterGui/HUD.client.lua` | ✅ Implemented | Visual HUD: coin count + speed display |
| `src/StarterPlayer/StarterPlayerScripts/main.client.lua` | ✅ Implemented | Client entry: upgrade button UI + wiring |

### Server-Authoritative Design
- All coin collection, upgrades, and arena outcomes validated server-side
- Client sends requests via RemoteEvents, server validates and responds
- Player data stored in DataStore with autosave every 60 seconds

### Key Systems (Current + Planned)

| System | Current | Planned |
|--------|---------|---------|
| **CoinService** | Coin spawning, collection, respawn | Multi-type coins, procedural spawn zones |
| **UpgradeService** | Speed upgrades only | Magnet, Power, Multiplier upgrades |
| **ArenaService** | ❌ Not implemented | Matchmaking, round management, scoring, rewards |
| **PlayerDataService** | ✅ DataStore persistence | Offline/idle coin generation |
| **LeaderboardService** | ❌ Not implemented | Global + friend filtering, multiple categories |
| **CosmeticService** | ❌ Not implemented | Equip/unequip, visual effects, trails |
| **TradingService** | ❌ Not implemented | Player-to-player item exchange |

### Data Model (PlayerData — Expanded)

```lua
-- Current (implemented):
{
    Coins: number,       -- Current coin balance
    SpeedLevel: number,  -- Current speed upgrade level
}

-- Planned expansion:
{
    Coins = 0,              -- Current coin balance
    TotalCoins = 0,         -- Lifetime coins earned
    SpeedLevel = 0,         -- Current speed upgrade level
    MagnetLevel = 0,        -- Coin magnet radius level
    PowerLevel = 0,         -- Arena power level
    MultiplierLevel = 0,    -- Coin multiplier level
    ArenaWins = 0,          -- Total arena victories
    ArenaRating = 1000,     -- Skill rating for matchmaking
    Cosmetics = {},         -- Unlocked cosmetic IDs
    EquippedTrail = nil,    -- Currently equipped trail
    LastLogin = os.time(),  -- For daily rewards
    LastOnline = os.time(), -- For offline coin calculation
    GamesPlayed = 0,        -- Lifetime games
}
```

---

## 8. Success Metrics

### Retention Targets

| Metric | Target | Industry Benchmark (2026) | Source |
|--------|--------|--------------------------|--------|
| Day 1 Retention | 40%+ | 30-35% (Roblox average) | MARKET_ANALYSIS.md |
| Day 7 Retention | 20%+ | 10-15% (Roblox average) | MARKET_ANALYSIS.md |
| Day 30 Retention | 10%+ | 5-8% (Roblox average) | MARKET_ANALYSIS.md |
| Sessions per Day | 3-5 | 2-3 (typical simulator) | MARKET_ANALYSIS.md |

### Engagement Targets

| Metric | Target | Rationale |
|--------|--------|-----------|
| Average Session Length | 8-15 minutes | Mobile-friendly, matches 2026 platform behavior |
| Arena Rounds per Session | 2-3 | "Just one more round" hook |
| Farm-to-Arena Ratio | 60:40 (time split) | Balanced between collection and competition |
| Upgrade Purchases per Session | 2-4 | Progression satisfaction per session |

### Revenue Targets

| Metric | Target | Benchmark |
|--------|--------|-----------|
| Conversion Rate (free→paying) | 5-7% | Industry: 3-8% |
| ARPPU (monthly) | $8-$15 | Industry: $5-$20 |
| Game Pass Uptake | 15-20% of players | Industry: 10-25% |
| Rewarded Ad Watch Rate | 50-60% of DAU | Industry: 40-70% |

### Revenue Scenarios

| Scenario | DAU | Monthly Rev (Est.) | Annual DevEx | Notes |
|----------|-----|-------------------|--------------|-------|
| Conservative | 5K-20K | $2K-$10K | $25K-$120K | Core loop only |
| Moderate | 20K-100K | $10K-$80K | $120K-$960K | Full monetization stack |
| Viral Breakout | 100K-500K+ | $80K-$500K+ | $960K-$6M+ | Trading economy, seasonal events |

---

## 9. Risk Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Arena feels unbalanced (pay-to-win perception) | Medium | High | Power upgrades earned only through gameplay; cosmetics are the monetization layer |
| Farming loop gets boring | Medium | Medium | Add coin types, farming zones, timed challenges, procedural spawning |
| Low return frequency | High | Critical | Offline coins + daily rewards create concrete reasons to return (3-5x/day target) |
| Friend invites do not happen | Medium | High | Party coin multiplier (1.2x) incentivizes group play; algorithm rewards this |
| DataStore throttling at scale | Low | Medium | Batch saves during low traffic; session-based state for arena; `SetRateLimitForRequestType` |
| Competitor copies the concept | High | Medium | First-mover advantage + community building + continuous content updates |
| Content fatigue after 3 months | High | High | Seasonal events, new arena modes, limited-time cosmetics, trading economy |
| Arena matchmaking wait times | Medium | Medium | Fill remaining slots with AI bots if queue > 30 seconds |
| Discovery algorithm change | High | High | Diversify traffic (social, external marketing); optimize for 28-day retention |
| Under-13 monetization decline | High | High | Design for 18+ appeal; R15 avatars for DevEx eligibility |

---

## 10. Launch Strategy

### Phase 1: Soft Launch (Week 1-2)
- **Scope:** Core loop only — coin collection + speed upgrades + Coin King arena
- **Features:** 1 arena mode, basic leaderboards, DataStore persistence
- **Target:** 500-1,000 DAU, measure Day 1/Day 7 retention
- **Iterate:** Based on retention data before adding features

### Phase 2: Growth Launch (Week 3-4)
- **Add:** Offline coins + daily rewards + Speed Blitz team mode
- **Add:** Party system + Game Passes (2x Coins, VIP, Speed Boost)
- **Target:** 2,000-5,000 DAU
- **Revenue:** Game Passes live, beginning monetization optimization

### Phase 3: Scale (Month 2-3)
- **Add:** Cosmetics + pets + Last Coin Standing mode
- **Add:** Trading hub + seasonal events + Developer Products
- **Target:** 5,000-20,000 DAU
- **Revenue:** Full monetization stack, trading economy live

### Phase 4: Optimize (Month 4+)
- **Add:** Guilds/clans + spectator mode + Subscription VIP
- **Optimize:** Creator Rewards + Audience Expansion + regional pricing
- **Target:** 20,000-100,000 DAU
- **Revenue:** Recurring revenue + optimized DevEx (18+ rate)

---

## 11. Summary

**STATUS: REFINED — Market-validated concept grounded in actual codebase state.**

**USP:** The only Roblox game that merges incremental coin farming with competitive arena PvP in a single seamless loop. No top-20 game combines all five key mechanics (incremental loop, arena PvP, offline progression, trading economy, social co-play).

**CORE LOOP:** Farm coins → Upgrade speed/abilities → Compete in arena PvP → Earn rewards → Repeat. Designed for 8-15 minute sessions with 3-5 daily returns. Currently implemented: coin collection + speed upgrades + DataStore persistence + visual HUD. Next: arena PvP system.

**TARGET EXPERIENCE:** Casual players enjoy the satisfying coin collection and progression. Competitive players engage with arena PvP and leaderboards. Both audiences share one ecosystem, creating network effects that drive organic growth via Roblox's friend-to-friend co-play algorithm.

**KEY FEATURES:**
- **P0 (Launch):** Coin collection ✅, speed upgrades ✅, DataStore persistence ✅, visual HUD ✅, arena PvP Coin King ❌, leaderboards ❌
- **P1 (Week 2-4):** Offline coins, daily rewards, Speed Blitz, party system, game passes
- **P2 (Month 2-3):** Cosmetics, pets, trading hub, seasonal events
- **P3 (Month 4+):** Guilds, spectator mode, subscription VIP

**MONETIZATION:** "Pay for convenience and cosmetics, not for power in PvP." Game Passes at ~70% revenue share. R15 avatars for US 18+ DevEx rate ($0.0054/Robux, +42%). Creator Rewards baseline income (5 R$/Active Spender/day). Regional pricing for international conversion.

**DIFFERENTIATION:** Bridges the gap between incremental simulators (Pet Simulator 99, Grow a Garden) and competitive PvP (RIVALS, Blox Fruits). Aligns with 2026 Roblox trends: return frequency, friend co-play, retention-first algorithm, 18+ audience growth, trading economy longevity.

**CODEBASE STATE:** 7 source files implemented (Config, CoinService, ServerConfig, PlayerData, main.server.lua, HUD, main.client.lua). Core coin collection loop + speed upgrades + DataStore persistence working. Arena PvP and social features are the next implementation priority.
