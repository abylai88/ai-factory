# Coin Rush Arena — Gameplay Mechanics Design

**Version:** 1.0
**Date:** September 2026
**Author:** AI Factory Gameplay Designer
**Project:** coin-rush-arena (Roblox + Luau + Rojo)
**Status:** COMPLETE — Ready for programmer implementation

---

## Table of Contents

1. [Physics & Movement](#1-physics--movement)
2. [Coin Collection System](#2-coin-collection-system)
3. [Upgrade System Tuning](#3-upgrade-system-tuning)
4. [Arena PvP Mechanics](#4-arena-pvp-mechanics)
5. [Feedback Systems](#5-feedback-systems)
6. [Juice Effects](#6-juice-effects)
7. [Input Handling](#7-input-handling)
8. [Difficulty Curve & Progression Tuning](#8-difficulty-curve--progression-tuning)
9. [Economy Balancing](#9-economy-balancing)
10. [Bot AI](#10-bot-ai)
11. [Numerical Reference Tables](#11-numerical-reference-tables)

---

## 1. Physics & Movement

### 1.1 Character Physics

The game uses Roblox's default `Humanoid` physics with specific overrides to create a responsive, arcade-y feel. The goal is movement that feels **snappy and fast**, not realistic.

| Parameter | Default Roblox | Coin Rush Arena | Rationale |
|-----------|---------------|-----------------|-----------|
| WalkSpeed (base) | 16 | 16 | Standard Roblox feel at start |
| WalkSpeed (max) | 16 | 32 | 2× base speed at max level — visually dramatic |
| JumpPower | 50 | 62 | Slightly higher jump for better traversal and arena mobility |
| JumpHeight | ~7.2 studs | ~9 studs | Enables clearing low obstacles in arena maps |
| HipHeight | 0 (auto) | 0 (auto) | Let Roblox compute from avatar |
| Gravity | 196.2 | 196.2 | Keep default — changing gravity causes animation issues |
| AirControl | 0 (Humanoid default) | 0 | No air strafing — ground movement is the skill expression |
| WalkAcceleration | 0 | 80 | Snappy acceleration (feels responsive, not floaty) |
| WalkDeceleration | 0 | 120 | Fast stop (prevents sliding, improves precision) |
| Friction | 1 | 1 | Default ground friction |

**Implementation Note (Humanoid properties):**
```lua
-- Apply in applyWalkSpeed() after setting WalkSpeed:
humanoid.UseJumpPower = true
humanoid.JumpPower = 62
humanoid.WalkSpeed = computedSpeed -- 16 + (SpeedLevel × 2)
-- HipHeight and Friction use defaults
```

### 1.2 Movement Feel Tuning

**Acceleration curve:** The `WalkAcceleration` and `WalkDeceleration` values create a responsive feel. Without them (defaults = 0), Roblox applies instant velocity changes that can feel stiff. With these values:

- **Start moving:** Reaches full speed in ~0.2 seconds (from 0 to 16+ studs/s)
- **Stop moving:** Decelerates to 0 in ~0.13 seconds
- **Direction change:** Near-instant — feels like a dual-stick arcade game

**Speed perception scaling:** At higher speed levels, the visual sense of speed is amplified through:
- FOV increase (subtle, +5° from base 70° to max 75° at speed level 16)
- Motion blur on character (post-processing effect)
- Trail effects behind character (cosmetic, scales with speed)

```lua
-- FOV scaling (client-side, in camera controller):
local function updateFOV(humanoid: Humanoid)
    local speed = humanoid.WalkSpeed
    local t = math.clamp((speed - 16) / 16, 0, 1) -- 0 at base, 1 at max
    local targetFOV = 70 + (5 * t) -- 70 → 75
    -- Tween camera.FieldOfView toward targetFOV over 0.3s
end
```

### 1.3 Arena Physics Overrides

Inside the arena, physics parameters shift slightly to support combat:

| Parameter | Open World | Arena | Rationale |
|-----------|-----------|-------|-----------|
| WalkSpeed | Variable (16-32) | Same as open world | Upgrades carry over — rewards progression |
| JumpPower | 62 | 72 | Higher jumps in arena for more vertical plays |
| Gravity | 196.2 | 196.2 | Keep consistent |
| WalkAcceleration | 80 | 100 | Slightly more responsive in combat |
| WalkDeceleration | 120 | 160 | Faster stops for precision dodging |
| Health | 100 | 100 | No health system in Coin King (steal mechanic instead) |

### 1.4 Coin Magnet Physics

The magnet system uses distance-based detection, NOT a physics force:

```lua
-- Server-side check (in coin touch handler):
local MAGNET_BASE_RADIUS = 4 -- studs
local MAGNET_PER_LEVEL = 1   -- studs per upgrade level
local MAGNET_MAX_RADIUS = 12 -- studs

local function checkMagnetRange(player, coin): boolean
    local character = player.Character
    if not character then return false end
    local rootPart = character:FindFirstChild("HumanoidRootPart")
    if not rootPart then return false end

    local data = PlayerData.get(player)
    local radius = math.min(
        MAGNET_BASE_RADIUS + (data.MagnetLevel * MAGNET_PER_LEVEL),
        MAGNET_MAX_RADIUS
    )

    local distance = (rootPart.Position - coin.Position).Magnitude
    return distance <= radius
end
```

**Magnet is NOT a physics attractor** — coins don't move toward the player. Instead, the collection radius check is expanded. This avoids visual jank of coins flying through geometry.

**Client-side magnet preview:** Show a translucent ring around the character at the magnet radius to give visual feedback on pickup range:

```lua
-- Visual indicator ring (client-only):
local ring = Instance.new("Part")
ring.Shape = Enum.PartType.Cylinder
ring.Size = Vector3.new(0.1, radius*2, radius*2) -- thin disc
ring.Color = Color3.fromRGB(255, 255, 100)
ring.Transparency = 0.85
ring.Anchored = true
ring.CanCollide = false
ring.Material = Enum.Material.Neon
-- Position at character feet
```

### 1.5 Coin Steal Physics (Arena)

When players bump into each other in the Coin King arena, a steal occurs:

```lua
-- Steal mechanics:
local STEAL_PERCENT = 0.10 -- steal 10% of victim's carried coins
local STEAL_COOLDOWN = 2.0 -- seconds between steals on same victim
local STEAL_RANGE = 4.0    -- studs — must be very close
local STEAL_MINIMUM = 1    -- minimum coins to steal (round up)
local INVULN_TIME = 0.5    -- seconds after being stolen from (can't be re-stolen)

-- Validation:
-- 1. Victim must have >= STEAL_MINIMUM coins
-- 2. Stealer must be within STEAL_RANGE of victim's HumanoidRootPart
-- 3. No active cooldown between stealer↔victim pair
-- 4. Both players must be alive and in the arena
```

**Steal amount formula:**
```
stolenAmount = math.ceil(victimCoins * STEAL_PERCENT)
stolenAmount = math.max(stolenAmount, STEAL_MINIMUM)
```

**Visual feedback on steal:**
- Red "-N" floating text above victim
- Green "+N" floating text above stealer
- Brief screen shake on victim (subtle)
- Whoosh sound effect
- Coin particle trail from victim to stealer

---

## 2. Coin Collection System

### 2.1 Coin Type Specifications

| Property | Bronze | Silver | Gold | Meteor |
|----------|--------|--------|------|--------|
| **Value** | 1 | 5 | 25 | 100 |
| **Spawn Weight** | 60% | 25% | 12% | 3% |
| **Appearance** | Small disc, matte gold | Medium disc, silver sheen | Large disc, bright gold glow | Extra-large disc, fire particles |
| **Size (studs)** | 0.3 × 1.0 × 1.0 | 0.4 × 1.4 × 1.4 | 0.5 × 1.8 × 1.8 | 0.6 × 2.2 × 2.2 |
| **Color** | RGB(205, 127, 50) | RGB(192, 192, 192) | RGB(255, 215, 0) | RGB(255, 69, 0) |
| **Material** | SmoothPlastic | Metal | Neon | Neon + Particles |
| **Rotation Speed** | 60°/s | 90°/s | 120°/s | 150°/s |
| **Bob Amplitude** | 0.2 studs | 0.3 studs | 0.4 studs | 0.5 studs |
| **Bob Frequency** | 1.5 Hz | 1.5 Hz | 2.0 Hz | 2.5 Hz |
| **Glow Radius** | 2 studs | 4 studs | 6 studs | 8 studs |
| **Spawn Area** | Full map | Full map | Inner 60% | Inner 30% |
| **Max Concurrent** | 30 | 12 | 6 | 2 |

**Spawn restriction rationale:** Gold and Meteor coins spawn closer to center where players congregate, creating natural focal points and increasing encounter probability in the arena.

### 2.2 Coin Spawning Algorithm

```lua
-- Weighted random selection:
local function selectCoinType(): string
    local roll = math.random() * 100
    local cumulative = 0
    for name, info in pairs(Config.COIN_TYPES) do
        cumulative += info.Weight
        if roll <= cumulative then
            return name
        end
    end
    return "Bronze" -- fallback
end

-- Position generation with zone restrictions:
local function getRandomSpawnPosition(coinType: string): Vector3
    local mapSize = Config.COIN_SPAWN_AREA_SIZE -- 80 studs total
    local halfSize = mapSize / 2

    -- Gold and Meteor coins spawn in restricted zones
    local restriction = Config.COIN_TYPES[coinType].SpawnRestriction or 1.0
    local restrictedHalf = halfSize * restriction

    return Vector3.new(
        math.random(-restrictedHalf * 100, restrictedHalf * 100) / 100,
        Config.COIN_SPAWN_HEIGHT, -- 3 studs
        math.random(-restrictedHalf * 100, restrictedHalf * 100) / 100
    )
end
```

### 2.3 Coin Respawn Timing

| Phase | Respawn Delay | Rationale |
|-------|--------------|-----------|
| Server startup (initial fill) | 0s (instant) | World feels populated immediately |
| Normal respawn | 5 seconds (`Config.COIN_RESPAWN_SECONDS`) | Steady supply without overwhelming |
| Meteor respawn | 8 seconds | Rarer = more special feel |
| Arena coin spawn | 1-3 seconds (varies by mode) | Faster pace in competitive setting |
| Post-steal respawn | 3 seconds | Quick replacement maintains arena tension |

### 2.4 Collection Mechanics

**Touch detection flow:**
```
Coin.Touched(hit) fires
  → Is hit from a valid character? (Has Humanoid, Health > 0)
  → Is this player in the valid collection context? (Same server, not in different arena)
  → Is the coin still collectable? (Attribute "Collecting" == false)
  → Does the player pass the magnet range check?
  → PASS: Mark coin as "Collecting", award coins, destroy coin, schedule respawn
  → FAIL: Ignore (coin stays)
```

**Coin value with multiplier:**
```lua
local function calculateCoinValue(baseValue: number, player: Player): number
    local data = PlayerData.get(player)
    local multiplier = 1.0 + (data.MultiplierLevel * 0.2) -- 1.0x → 2.0x at max
    local gamePassMultiplier = MarketplaceService:UserOwnsGamePassAsync(player.UserId, PASS_ID_2X) and 2 or 1
    local vipMultiplier = MarketplaceService:UserOwnsGamePassAsync(player.UserId, PASS_ID_VIP) and 1.5 or 1
    local partyMultiplier = PartyService.hasParty(player) and 1.2 or 1

    return math.floor(baseValue * multiplier * gamePassMultiplier * vipMultiplier * partyMultiplier)
end
```

**Multiplier stacking rules:**
- All multipliers are multiplicative (not additive)
- Maximum theoretical multiplier: `2.0 (upgrade) × 2 (game pass) × 1.5 (VIP) × 1.2 (party) = 7.2×`
- This is intentional — paying players progress ~7× faster in farming but this doesn't affect arena power
- A player with max multiplier farming for 1 hour ≈ a free player farming for 7 hours in coin accumulation

---

## 3. Upgrade System Tuning

### 3.1 Exponential Cost Curve

The upgrade system uses a generalized exponential formula:

```
cost(level) = floor(baseCost × growthRate^level)
```

Where `growthRate = 1.6` is the universal growth multiplier.

**Why 1.6?**
- 1.0 = linear (too easy to max)
- 1.2 = shallow exponential (maxed in ~2 hours)
- **1.6 = satisfying exponential** (maxed in ~8-10 hours of play)
- 2.0 = steep exponential (discouraging, maxed in ~20+ hours)
- 2.5 = near-impossible (only for prestige systems)

### 3.2 Full Upgrade Tables

#### Speed Upgrade

| Level | Cost (this level) | Cumulative Cost | WalkSpeed | Effect |
|-------|-------------------|-----------------|-----------|--------|
| 0 | — | 0 | 16 | Base speed |
| 1 | 25 | 25 | 18 | +2 speed |
| 2 | 40 | 65 | 20 | +2 speed |
| 3 | 64 | 129 | 22 | +2 speed |
| 4 | 102 | 231 | 24 | +2 speed |
| 5 | 164 | 395 | 26 | +2 speed |
| 6 | 262 | 657 | 28 | +2 speed |
| 7 | 419 | 1,076 | 30 | +2 speed |
| 8 | 671 | 1,747 | 32 | **MAX** |

**Max speed cost:** 1,747 coins total → achievable in ~4-5 sessions (8-15 min each)

#### Magnet Upgrade

| Level | Cost (this level) | Cumulative Cost | Radius (studs) | Effect |
|-------|-------------------|-----------------|----------------|--------|
| 0 | — | 0 | 4 | Base pickup range |
| 1 | 50 | 50 | 5 | +1 stud |
| 2 | 80 | 130 | 6 | +1 stud |
| 3 | 128 | 258 | 7 | +1 stud |
| 4 | 205 | 463 | 8 | +1 stud |
| 5 | 328 | 791 | 9 | +1 stud |
| 6 | 525 | 1,316 | 10 | +1 stud |
| 7 | 840 | 2,156 | 11 | +1 stud |
| 8 | 1,344 | 3,500 | 12 | **MAX** |

**Max magnet cost:** 3,500 coins total

#### Power Upgrade (Arena)

| Level | Cost (this level) | Cumulative Cost | Damage | Effect |
|-------|-------------------|-----------------|--------|--------|
| 0 | — | 0 | 0 | No power attacks |
| 1 | 100 | 100 | 2 | Unlock bump steal |
| 2 | 160 | 260 | 4 | +2 damage |
| 3 | 256 | 516 | 6 | +2 damage |
| 4 | 410 | 926 | 8 | +2 damage |
| 5 | 655 | 1,581 | 10 | +2 damage |
| 6 | 1,048 | 2,629 | 12 | +2 damage |
| 7 | 1,677 | 4,306 | 14 | +2 damage |
| 8 | 2,683 | 6,989 | 16 | +2 damage |
| 9 | 4,293 | 11,282 | 18 | +2 damage |
| 10 | 6,869 | 18,151 | 20 | **MAX** |

**Max power cost:** 18,151 coins — long-term goal

#### Coin Multiplier Upgrade

| Level | Cost (this level) | Cumulative Cost | Multiplier | Effect |
|-------|-------------------|-----------------|------------|--------|
| 0 | — | 0 | 1.0× | Base rate |
| 1 | 200 | 200 | 1.2× | +20% coins |
| 2 | 320 | 520 | 1.4× | +20% coins |
| 3 | 512 | 1,032 | 1.6× | +20% coins |
| 4 | 819 | 1,851 | 1.8× | +20% coins |
| 5 | 1,311 | 3,162 | 2.0× | **MAX** |

**Max multiplier cost:** 3,162 coins

### 3.3 Total Progression Budget

| Upgrade Path | Max Level | Total Cost | % of Total |
|-------------|-----------|------------|------------|
| Speed | 8 | 1,747 | 4.5% |
| Magnet | 8 | 3,500 | 9.1% |
| Power | 10 | 18,151 | 47.1% |
| Multiplier | 5 | 3,162 | 8.2% |
| **Cosmetics/Pets** | — | ~12,000 (estimated) | 31.2% |
| **TOTAL** | — | **~38,560** | 100% |

**Time to "complete" (all upgrades):** ~40-50 hours of active play
**Time to "competitive" (speed + magnet maxed):** ~8-10 hours
**Time to "max speed only":** ~4-5 hours

### 3.4 Upgrade Purchase Flow

```
Player taps "Upgrade" button
  → Client calculates cost using local Config values
  → Client checks if affordable (visual feedback: green/red/gray button)
  → Client fires RequestUpgrade remote event
  → Server validates:
      1. Player has enough coins (data.Coins >= cost)
      2. Player is not at max level for this upgrade
      3. Player is not in an arena round (prevents exploit)
  → Server deducts coins via PlayerData.addCoins(player, -cost)
  → Server increments upgrade level
  → Server applies effect (WalkSpeed, magnet radius, etc.)
  → Server syncs leaderstats
  → Client receives leaderstats change → updates HUD
```

**Optimistic UI update:** The client updates the button appearance immediately on tap (before server confirmation), then reverts if the server rejects. This makes the UI feel instant.

---

## 4. Arena PvP Mechanics

### 4.1 Coin King Mode (FFA, 8 players) — P0

**Round structure:**

```
[Matchmaking] → [Lobby (5s countdown)] → [Round (180s)] → [Results (10s)] → [Rematch/Return]
```

| Phase | Duration | What Happens |
|-------|----------|-------------|
| Matchmaking | 0-30s | Fill lobby with 2-8 players; bots fill after 30s |
| Lobby countdown | 5s | Players see each other, "Starting in 3..." text |
| Round active | 180s (3 min) | Coins spawn, players collect, steals happen |
| Results display | 10s | Show placement, coins, steals, rating change |
| Rematch | 0-15s | "Play Again" or auto-return after 15s |

**Coin spawning in arena:**

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Arena coin spawn rate | 1 coin every 2 seconds | Higher density than open world (5s) |
| Arena max coins | 30 | Concentrated map, fewer needed |
| Coin types | Bronze 65%, Silver 25%, Gold 8%, Meteor 2% | Slightly more Bronze for tension |
| Spawn area | 40×40 studs | Smaller than open world (80×80) |

**Scoring:**
```lua
-- Final score = coins collected during round
-- Placement bonuses:
-- 1st place: +50 bonus coins
-- 2nd place: +30 bonus coins
-- 3rd place: +15 bonus coins
-- 4th-8th: +5 participation coins

-- Rating change (Elo-like):
-- vs. average opponent rating:
local expectedWin = 1 / (1 + 10^((opponentAvgRating - playerRating) / 400))
local actualWin = (placement == 1) and 1 or 0
local kFactor = 32 -- standard K-factor for moderate rating swings
local ratingChange = math.floor(kFactor * (actualWin - expectedWin))
-- Clamped to [-50, +50] per round to prevent extreme swings
```

### 4.2 Speed Blitz Mode (Team 4v4) — P1

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Team size | 4v4 | Matches friend group sizes |
| Round duration | 240s (4 min) | Slightly longer for team coordination |
| Coin spawn rate | 1 coin every 1.5s | Faster pace for team modes |
| Team scoring | Sum of all team members' coins | Simple aggregation |
| Party bonus | 1.2× multiplier for party members | Incentivizes friend-to-friend invites |
| Team color | Red vs Blue | Clear visual distinction |

**Team assignment:**
- If players are in a party of 2-4, they're placed on the same team
- Remaining slots filled individually
- Balance: distribute solo players by rating

### 4.3 Last Coin Standing Mode (FFA, 12 players) — P2

| Parameter | Value | Rationale |
|-----------|-------|-----------|
| Player count | 12 | High tension, battle-royale feel |
| Coin spawn pattern | 1 coin at a time | Extreme scarcity = tension |
| Spawn interval | 5-8 seconds (random) | Unpredictable timing |
| Elimination | Fail to grab coin → eliminated | Simple, clear rule |
| Arena shrink | Every 2 minutes, arena radius reduces by 25% | Forces confrontation |
| Starting arena | 60×60 studs | Shrinks to 15×15 |
| Victory | Last player standing | Clear win condition |

### 4.4 Arena Balance Rules

**Anti-pay-to-win enforcement:**
```lua
-- Arena power is ONLY from gameplay upgrades:
local function getArenaStats(player): ArenaStats
    local data = PlayerData.get(player)
    return {
        -- FROM UPGRADES ONLY (earned through coins):
        Speed = CoinService.nextWalkSpeed(..., data.SpeedLevel),
        MagnetRadius = MAGNET_BASE_RADIUS + (data.MagnetLevel * MAGNET_PER_LEVEL),
        StealPower = data.PowerLevel * 2, -- 0-20

        -- NEVER from game passes or dev products:
        -- No multiplier in arena (farming multiplier only)
        -- No speed boost from passes
        -- No power from purchases
    }
end
```

**Server authority validation for all arena actions:**
```lua
-- Every arena action is validated server-side:
-- 1. Coin pickup: server checks distance, debounce, alive status
-- 2. Steal: server checks range, cooldown, victim coins, both alive
-- 3. Position: server tracks authoritative positions for validation
-- 4. Scoring: server maintains all scores, client is display-only
```

### 4.5 Matchmaking Algorithm

```lua
-- Simple skill-based matchmaking:
-- 1. Find existing lobby for the requested mode
-- 2. If lobby exists AND has open slots AND rating is within ±200:
--    → Add player to lobby
-- 3. If no suitable lobby:
--    → Create new lobby, add player as first member
-- 4. If queue time > 30 seconds:
--    → Fill remaining slots with bots
-- 5. If lobby has ≥2 players AND (full OR 60s elapsed):
--    → Start countdown

-- Bot fill rules:
-- Bot rating = average lobby rating ± random(50)
-- Bot names = generated from pool: "CoinBot_Alpha", "CoinBot_Bravo", etc.
-- Bot difficulty scales with average lobby rating:
--   < 1000: Easy bots (slow movement, poor pathing)
--   1000-1200: Medium bots (decent movement, some stealing)
--   > 1200: Hard bots (fast movement, strategic stealing)
```

---

## 5. Feedback Systems

### 5.1 Coin Collection Feedback

Every coin pickup must deliver a **multi-sensory burst** of satisfaction.

#### Visual Feedback

| Element | Bronze | Silver | Gold | Meteor |
|---------|--------|--------|------|--------|
| **Floating text** | "+1" (gold) | "+5" (silver) | "+25" (bright gold) | "+100" (orange-red) |
| **Text size** | 16px | 20px | 28px | 36px |
| **Text animation** | Float up 2 studs, fade | Float up 3 studs, fade | Float up 4 studs + scale 1→1.5 | Float up 5 studs + scale 1→2 |
| **Text duration** | 1.0s | 1.2s | 1.5s | 2.0s |
| **Particle burst** | 5 particles | 10 particles | 20 particles | 30 particles |
| **Particle color** | Gold | Silver | Gold + white sparkles | Orange + red fire |
| **Screen shake** | None | None | Subtle (0.5 magnitude, 0.2s) | Medium (1.0 magnitude, 0.3s) |
| **Coin trail** | None | None | 3-particle trail | 5-particle fire trail |

#### Audio Feedback

| Element | Bronze | Silver | Gold | Meteor |
|---------|--------|--------|------|--------|
| **SFX pitch** | Low clink | Medium chime | High bell | Deep boom + chime |
| **SFX volume** | 0.5 | 0.6 | 0.8 | 1.0 |
| **SFX duration** | 0.2s | 0.3s | 0.5s | 0.8s |
| **Reverb** | None | None | Short | Long |
| **Coin streak sound** | None | None | Ascending chime every 5 coins | Ascending chime every 5 coins |

#### HUD Feedback

| Element | Description |
|---------|-------------|
| **Coin counter** | Number increments with a "roll" animation (counting up visually over 0.3s) |
| **Coin counter glow** | Brief golden glow pulse on the counter frame (0.2s fade) |
| **Coin counter pop** | Counter scales 1.0→1.1→1.0 over 0.15s (subtle "bounce") |

### 5.2 Upgrade Feedback

#### Purchase Success

| Element | Description |
|---------|-------------|
| **Speed upgrade** | Character briefly glows blue, speed trail intensifies for 1s |
| **Magnet upgrade** | Magnetic ring around character pulses once, expands to new radius |
| **Power upgrade** | Character briefly glows red, fist-pump animation plays |
| **Multiplier upgrade** | Gold sparkles surround character, coin icon appears above head |
| **Sound** | Ascending chime (pitch increases with level) |
| **Text** | "LEVEL UP!" floating text above character, size scales with level |
| **Button** | Button flashes green, then updates to new cost |

#### Purchase Failure (insufficient coins)

| Element | Description |
|---------|-------------|
| **Button** | Brief red flash (0.2s) |
| **Sound** | Soft "deny" click sound |
| **Text** | Cost label shakes slightly (horizontal shake, 0.1s) |

#### Max Level Reached

| Element | Description |
|---------|-------------|
| **Button** | Grayed out, text changes to "MAXED" |
| **Sound** | None (silent) |
| **Text** | "MAX" badge appears on button |

### 5.3 Arena Feedback

#### Round Start

| Element | Description |
|---------|-------------|
| **Countdown** | Large "3... 2... 1... GO!" text in center screen |
| **Sound** | Countdown beeps (pitch rising), final "GO!" has a horn/crash |
| **Camera** | Quick zoom-out sweep of arena (0.5s cinematic) |
| **Border** | Screen border flashes team color (blue/red for Speed Blitz) |

#### Coin Pickup in Arena

| Element | Description |
|---------|-------------|
| **Floating text** | Same as open world but with player name prefix |
| **Score HUD** | Score number updates with "roll" animation |
| **Top bar** | Progress bar shows your score vs. leader |
| **Streak** | "3× STREAK!" text when collecting 3 coins rapidly |

#### Steal Event

| Element | Description |
|---------|-------------|
| **Victim screen** | Brief red vignette (0.3s), coin counter shakes |
| **Victim text** | "-N STOLEN!" floating red text |
| **Stealer screen** | Brief gold flash, coin counter pops |
| **Stealer text** | "+N STOLEN!" floating green text |
| **Sound** | Whoosh + coin cascade sound |
| **Camera** | Quick screen shake on victim (1.5 magnitude, 0.2s) |

#### Round End

| Element | Description |
|---------|-------------|
| **1st place** | Confetti particles, "🏆 VICTORY!" text, victory fanfare |
| **2nd-3rd place** | Silver/bronze podium text, pleasant chime |
| **4th-8th place** | "ROUND OVER" text, neutral sound |
| **Results panel** | Slide-in panel showing: placement, coins, steals, rating change |
| **"Play Again" button** | Prominent green button, pulses to draw attention |

### 5.4 Offline/Daily Feedback

#### Welcome Back Modal

| Element | Description |
|---------|-------------|
| **Title** | "WELCOME BACK!" with golden glow |
| **Duration text** | "You were away for 3h 24m" |
| **Coin reward** | Coins count up from 0 to earned amount (1.5s animation) |
| **Claim button** | Large green button with coin icon |
| **Sound** | Gentle chime, coins clinking sound during count-up |

#### Daily Reward Modal

| Element | Description |
|---------|-------------|
| **Calendar grid** | 7-day grid, claimed days have checkmarks |
| **Current day** | Highlighted with pulsing glow |
| **Claim animation** | Reward item flies from grid to inventory area |
| **Day 7 reward** | Special golden crate animation with sparkle burst |
| **Sound** | Ascending chime scale through the week, fanfare on Day 7 |

---

## 6. Juice Effects

### 6.1 Definition

"Juice" refers to the extra visual/audio polish that makes game interactions feel **impactful and satisfying** beyond what's strictly necessary for gameplay clarity. Every interaction in Coin Rush Arena should feel "juicy."

### 6.2 Global Juice Settings

| Effect | Setting | Description |
|--------|---------|-------------|
| **Screen shake** | Enabled | Used on: meteor pickup, steal, arena knockout, 1st place |
| **Camera zoom punch** | Enabled | Brief FOV increase on big events |
| **Time freeze** | Disabled | Not appropriate for real-time multiplayer |
| **Hit stop** | Disabled | Not appropriate for non-combat |
| **Slow-mo** | Disabled | Not appropriate for competitive play |

### 6.3 Screen Shake Presets

| Event | Intensity | Duration | Frequency | Falloff |
|-------|-----------|----------|-----------|---------|
| Meteor coin pickup | 0.5 | 0.2s | 30 Hz | Linear |
| Gold coin pickup | 0.3 | 0.15s | 25 Hz | Linear |
| Steal (victim) | 1.5 | 0.25s | 40 Hz | Exponential |
| Steal (stealer) | 0.3 | 0.1s | 20 Hz | Linear |
| Arena knockout | 2.0 | 0.3s | 50 Hz | Exponential |
| 1st place victory | 1.0 | 0.5s | 30 Hz | Linear |

```lua
-- Screen shake implementation (client-side):
local function shakeCamera(intensity: number, duration: number, frequency: number)
    local camera = workspace.CurrentCamera
    local startTime = tick()
    local connection

    connection = game:GetService("RunService").RenderStepped:Connect(function()
        local elapsed = tick() - startTime
        if elapsed > duration then
            connection:Disconnect()
            -- Reset camera offset
            return
        end

        local progress = elapsed / duration
        local decay = 1 - progress -- linear falloff

        local offsetX = (math.random() - 0.5) * 2 * intensity * decay
        local offsetY = (math.random() - 0.5) * 2 * intensity * decay

        camera.CFrame = camera.CFrame * CFrame.new(offsetX, offsetY, 0)
    end)
end
```

### 6.4 Particle Effect Catalog

| Effect Name | Trigger | Particles | Lifetime | Speed | Color |
|------------|---------|-----------|----------|-------|-------|
| CoinBurst_Bronze | Bronze pickup | 5 | 0.5s | 5 studs/s | Gold |
| CoinBurst_Silver | Silver pickup | 10 | 0.7s | 8 studs/s | Silver |
| CoinBurst_Gold | Gold pickup | 20 | 1.0s | 12 studs/s | Gold+White |
| CoinBurst_Meteor | Meteor pickup | 30 | 1.5s | 15 studs/s | Orange+Red |
| UpgradeFlash | Upgrade purchase | 15 | 0.5s | 3 studs/s | Blue (speed), Red (power), Gold (multi) |
| StealTrail | Steal event | 8 | 0.3s | 20 studs/s | Gold (from victim to stealer) |
| VictoryConfetti | 1st place | 50 | 2.0s | 10 studs/s | Rainbow |
| SpeedTrail | Character movement | Continuous | 0.3s | 0 (relative) | Blue (fades with speed) |

### 6.5 Floating Text System

```lua
-- Server-authoritative floating text (sent via RemoteEvent to all clients):
local function createFloatingText(parent: Model, text: string, color: Color3, size: number, duration: number)
    -- Creates BillboardGui above parent's HumanoidRootPart
    -- Text animates: scale 1→1.2→1.0, position floats upward
    -- Fades out over duration
    -- Gold text gets a slight glow effect
end

-- Floating text types:
-- "+N" for coin pickup (per-player only)
-- "-N STOLEN!" for steal victim
-- "+N STOLEN!" for steal stealer
-- "LEVEL UP!" for upgrade purchase
-- "3× STREAK!" for rapid coin collection
-- "VICTORY!" / "ROUND OVER" for arena end
```

### 6.6 Sound Design Specifications

#### Music

| Track | When | BPM | Mood |
|-------|------|-----|------|
| Main Theme | Menu / Spawn | 120 | Upbeat, energetic |
| Farming Ambient | Open world | 100 | Relaxed, exploratory |
| Arena Lobby | Matchmaking | 130 | Anticipation, building tension |
| Arena Battle | During round | 150 | High energy, competitive |
| Victory | Round win | 140 | Triumphant, satisfying |
| Defeat | Round loss | 90 | Brief, motivating to retry |

#### Sound Effects

| Category | Effect | Pitch Range | Volume |
|----------|--------|-------------|--------|
| Coin pickup | Bronze clink | 400-500 Hz | 0.5 |
| Coin pickup | Silver chime | 600-800 Hz | 0.6 |
| Coin pickup | Gold bell | 1000-1200 Hz | 0.8 |
| Coin pickup | Meteor boom | 150-200 Hz | 1.0 |
| UI | Button tap | 800 Hz | 0.4 |
| UI | Upgrade success | 600→1200 Hz sweep | 0.7 |
| UI | Upgrade failure | 300 Hz short | 0.3 |
| Arena | Countdown beep | 800 Hz (rising) | 0.6 |
| Arena | GO! horn | 400 Hz | 0.9 |
| Arena | Steal whoosh | 200→800 Hz sweep | 0.7 |
| Arena | Round end | 500 Hz bell | 0.8 |

---

## 7. Input Handling

### 7.1 Platform Input Mapping

| Action | PC | Mobile | Xbox |
|--------|-----|--------|------|
| Movement | WASD | Virtual joystick (bottom-left) | Left stick |
| Jump | Space | Jump button (bottom-right) | A button |
| Upgrade | Mouse click on button | Tap on button | X button |
| Arena enter | Mouse click on portal | Tap on portal | B button near portal |
| Leaderboard | Mouse click on button | Tap on button | Y button |
| Menu/Settings | Esc | Gear icon tap | Menu button |

### 7.2 Mobile Virtual Joystick

```lua
-- Virtual joystick properties:
local joystickConfig = {
    -- Position
    Position = UDim2.new(0, 30, 1, -160), -- bottom-left
    Size = UDim2.new(0, 120, 0, 120),

    -- Appearance
    BackgroundColor = Color3.fromRGB(255, 255, 255),
    BackgroundTransparency = 0.7,
    KnobSize = UDim2.new(0, 50, 0, 50),
    KnobColor = Color3.fromRGB(255, 255, 255),
    KnobTransparency = 0.5,

    -- Behavior
    Deadzone = 0.15, -- 15% deadzone in center
    MaxRadius = 50, -- max distance knob can travel
    ReturnSpeed = 10, -- how fast knob returns to center (studs/s)

    -- Visibility
    AppearOnTouch = true, -- appears when player touches the area
    AlwaysVisible = false,
    FadeOutDelay = 2.0, -- seconds before fading when not in use
    FadeOutDuration = 0.3,
}

-- Movement mapping:
-- Joystick delta → Vector3 input direction
-- inputDirection = Vector3.new(joystickX, 0, -joystickY) -- Y is inverted
-- character:MoveTo(character.Position + inputDirection * moveDistance)
```

### 7.3 Touch Target Sizing

All interactive UI elements must meet minimum touch target sizes for mobile:

| Element | Min Touch Target | Actual Size | Padding |
|---------|-----------------|-------------|---------|
| Upgrade button | 48×48 px | 200×50 px | 76×- px (exceeds) |
| Arena portal tap | 48×48 px | Character proximity check | N/A |
| Leaderboard button | 48×48 px | 150×40 px | 51×- px (exceeds) |
| Daily reward claim | 48×48 px | 200×60 px | 76×6 px (exceeds) |
| Settings gear | 48×48 px | 48×48 px | Exact minimum |

### 7.4 Input State Machine

```
IDLE → (player taps joystick area) → MOVING
MOVING → (player releases) → IDLE (after 0.1s delay to prevent jitter)
IDLE/MOVING → (player taps upgrade button) → UPGRADE_REQUEST
UPGRADE_REQUEST → (server confirms) → IDLE
IDLE → (player approaches arena portal + taps) → ARENA_QUEUE
ARENA_QUEUE → (matchmaking found) → ARENA_LOBBY
ARENA_LOBBY → (countdown complete) → ARENA_PLAYING
ARENA_PLAYING → (round ends) → ARENA_RESULTS
ARENA_RESULTS → (player taps "Play Again") → ARENA_QUEUE
ARENA_RESULTS → (player taps "Return" OR 15s elapsed) → IDLE
```

### 7.5 Input Debouncing

| Action | Debounce | Rationale |
|--------|----------|-----------|
| Coin pickup | 0.3s per player | Prevent double-collection from rapid touches |
| Upgrade purchase | 1.0s | Prevent spam-buying (server validates anyway) |
| Arena join | 5.0s | Prevent rapid queue/leave cycling |
| Steal | 2.0s per victim | Prevent steal spamming |
| Menu toggle | 0.5s | Prevent menu flickering |
| Button taps | 0.2s | Prevent double-tap issues on mobile |

---

## 8. Difficulty Curve & Progression Tuning

### 8.1 Session Progression Curve

**Target: 1-2 upgrades per 8-15 minute session**

| Session # | Minutes Played | Coins Earned (est.) | Upgrades Purchased | Cumulative Speed Level |
|-----------|---------------|---------------------|-------------------|----------------------|
| 1 | 10 | 250-350 | 2-3 (speed) | 2-3 |
| 2 | 10 | 300-400 | 1-2 (speed) | 4-5 |
| 3 | 12 | 400-500 | 2 (speed + magnet) | 6 speed, 1 magnet |
| 4 | 12 | 500-600 | 1-2 (various) | 7-8 speed, 2 magnet |
| 5 | 15 | 600-800 | 1-2 (various) | Max speed, 3 magnet |
| 6-10 | 15 | 800-1200 | 1-2 (power/magnet) | Building power |
| 11-20 | 15 | 1000-1500 | 1-2 (power/multi) | Power 5, Multi 3 |
| 21-40 | 15 | 1200-2000 | 1 (power/endgame) | Approaching max |
| 41-60 | 15 | 1500-2500 | Cosmetic hunting | Near-complete |

### 8.2 Arena Skill Curve

**New players (sessions 1-5):**
- Matched with other new players (rating 800-1000)
- Bots fill most lobbies
- Expected win rate: 20-30% (mostly against bots)
- Learning: coin collection, map awareness, movement basics

**Intermediate (sessions 5-15):**
- Mixed lobbies with real players and bots
- Expected win rate: 30-40%
- Learning: steal timing, farming route optimization, when to run vs. fight

**Advanced (sessions 15-40):**
- Mostly real players
- Expected win rate: 40-50% (approaching true skill level)
- Mastery: optimal routes, steal prediction, speed-magnet combo plays

**Expert (sessions 40+):**
- Top-tier lobbies
- Expected win rate: 45-55% (Elo equilibrium)
- Edge: micro-optimizations, reading opponents, risk management

### 8.3 Economic Progression Gates

| Time Gate | Content Unlocked | Purpose |
|-----------|-----------------|---------|
| 0 minutes | Coin collection, speed upgrade | Immediate gameplay |
| 30 minutes | First arena round | Introduce competition |
| 2 hours | Magnet upgrade available | Expand gameplay depth |
| 5 hours | Max speed achievable | First "completed" feeling |
| 8 hours | Power upgrades meaningful | Arena power matters |
| 15 hours | Multiplier upgrades impactful | Economy optimization |
| 25 hours | Most upgrades near-max | Transition to cosmetics |
| 40 hours | All upgrades maxed | Full progression complete |
| 50+ hours | Cosmetic collection, prestige goals | Endgame engagement |

### 8.4 Retention Hooks by Time Window

| Window | Hook | Implementation |
|--------|------|---------------|
| 0-5 min | "Collect coins and get faster!" | Instant progression, visible speed increase |
| 5-10 min | "Try the arena!" | Arena portal visible, tutorial prompts |
| 10-15 min | "One more round!" | Quick rematch, small coin bonus for consecutive plays |
| 15-60 min | "Check your offline coins!" | Offline coin notification at 15 min |
| 1-4 hours | "New upgrade available!" | Power/multiplier becomes affordable |
| 4-8 hours | "Come back for idle coins!" | 8-hour offline cap notification |
| 8-24 hours | "Daily reward waiting!" | Daily reward calendar notification |
| 1-7 days | "Weekly leaderboard reset!" | Weekly coins leaderboard |
| 7-30 days | "New season cosmetics!" | Seasonal content rotation |
| 30+ days | "Prestige awaits!" | Prestige system unlock |

### 8.5 Difficulty Parameters by Arena Rating

| Rating Range | Bot Fill Speed | Bot Skill | Coin Density | Steal Aggression |
|-------------|---------------|-----------|-------------|-----------------|
| < 800 | 15s | Easy | High (35 coins) | Low (10% of bots steal) |
| 800-1000 | 20s | Easy-Medium | Medium (30 coins) | Low-Medium (25%) |
| 1000-1200 | 25s | Medium | Medium (30 coins) | Medium (40%) |
| 1200-1400 | 30s | Medium-Hard | Low (25 coins) | Medium-High (60%) |
| > 1400 | 30s | Hard | Low (25 coins) | High (80%) |

---

## 9. Economy Balancing

### 9.1 Coin Income Sources

| Source | Coins/Hour (Free) | Coins/Hour (2× Pass) | Coins/Hour (VIP) | Notes |
|--------|-------------------|----------------------|-------------------|-------|
| Open world farming (base) | 180-240 | 360-480 | 270-360 | ~1 coin/5s at 50% collection efficiency |
| Open world farming (max multi) | 360-480 | 720-960 | 540-720 | At 2.0× multiplier upgrade |
| Arena wins (avg 3 rounds/hr) | 90-150 | 90-150 | 90-150 | 30-50 coins per win (not affected by multi) |
| Arena participation | 15-45 | 15-45 | 15-45 | 5-15 participation coins per round |
| Offline idle (per hour while away) | 36-72 | 36-72 | 54-108 | 1 coin/10s base, VIP +50% |
| Daily login (amortized) | 30-50 | 30-50 | 60-100 | ~200-350 coins over 7-day cycle |
| **TOTAL (hourly)** | **320-520** | **500-720** | **440-620** | |

### 9.2 Coin Sink Rates

| Sink | Coins/Hour (Early) | Coins/Hour (Mid) | Coins/Hour (Late) |
|------|--------------------|--------------------|---------------------|
| Speed upgrades | 80-120 | 0 (maxed) | 0 |
| Magnet upgrades | 0 (locked) | 40-60 | 0 (maxed) |
| Power upgrades | 0 (locked) | 60-100 | 100-150 |
| Multiplier upgrades | 0 (locked) | 30-50 | 0 (maxed) |
| **TOTAL** | **80-120** | **130-210** | **100-150** |

### 9.3 Economy Health Indicators

| Indicator | Healthy Range | Warning | Danger |
|-----------|--------------|---------|--------|
| Net coin flow (income - sink) | +200-400/hr | +500-700/hr | +800/hr or more |
| Time to max speed | 4-6 hours | < 3 hours | > 8 hours |
| Time to all upgrades maxed | 40-60 hours | < 30 hours | > 80 hours |
| Coin accumulation at max | 300-500/hr (cosmetics) | 600+/hr (too much) | < 200/hr (too little) |
| Arena coin earning % | 20-30% of total | > 40% (too dominant) | < 10% (arena unrewarding) |

### 9.4 Game Pass Impact on Economy

| Game Pass | Price | Effect | Break-Even Point | ROI for Player |
|-----------|-------|--------|-----------------|----------------|
| 2× Coins | 99-199 R$ | 2× coin collection | ~10 hours of play | Permanent value |
| VIP | 299-499 R$ | 1.5× offline, 2× daily rewards | ~15 hours of play | Plus exclusive cosmetics |
| Speed Boost | 49-99 R$ | +4 speed for 30 min | 1 session | Convenience only |

**Anti-pay-to-win math:**
- A paying player with 2× Coins + VIP earns ~2.5× coins per hour in farming
- This means they upgrade 2.5× faster, reaching max speed in ~2 hours instead of ~5
- In arena, power upgrades are the same cost for everyone
- A paying player reaches arena power parity ~2.5× faster
- BUT arena skill (movement, positioning, timing) is unaffected by purchases
- **Result:** Paying players have a progression advantage but not a skill advantage

### 9.5 Inflation Prevention

| Mechanism | Description |
|-----------|-------------|
| **Upgrade cost scaling** | Exponential costs naturally absorb coins faster as players progress |
| **No coin trading** | Players can't transfer coins (prevents coin farming/selling) |
| **Offline cap** | 8-hour maximum prevents infinite AFK accumulation |
| **Arena earnings cap** | Max 20 arena rounds per day (diminishing returns after 15) |
| **Seasonal resets** | Leaderboard ratings reset monthly (cosmetic rewards persist) |
| **Prestige sink** | Resetting upgrades for exclusive rewards absorbs end-game coins |

### 9.6 Monetization Pricing Guide

#### Game Passes

| Pass | Price Range | Recommended | Target Uptake |
|------|------------|-------------|--------------|
| 2× Coins | 99-199 R$ | 149 R$ | 15-20% of players |
| VIP | 299-499 R$ | 399 R$ | 5-8% of players |
| Speed Boost | 49-99 R$ | 79 R$ | 20-25% of players (per session) |

#### Developer Products

| Product | Price Range | Recommended | Purpose |
|---------|------------|-------------|---------|
| Coin Pack S | 25-49 R$ | 39 R$ (~500 coins) | Impulse buy |
| Coin Pack M | 79-129 R$ | 99 R$ (~2000 coins) | Mid-tier |
| Coin Pack L | 149-199 R$ | 179 R$ (~5000 coins) | Whale |
| 2× Boost (30 min) | 49-99 R$ | 69 R$ | Session enhancement |
| Cosmetic Crate | 49-149 R$ | 99 R$ | Random cosmetic |
| Legendary Crate | 199-299 R$ | 249 R$ | Guaranteed epic+ |

#### Rewarded Ads

| Reward | Value | Frequency Limit | Expected Watch Rate |
|--------|-------|----------------|-------------------|
| 2× Coins (5 min) | ~18 coins | 10/day | 60% of DAU |
| Free Spin (wheel) | Random 10-100 coins | 5/day | 50% of DAU |
| Arena Revive | Continue in round | 2/day | 40% of DAU |
| Daily Reward Bonus | 2× next daily reward | 1/day | 55% of DAU |

---

## 10. Bot AI

### 10.1 Bot Behavior States

```lua
-- Bot AI State Machine:
-- IDLE → FARMING → (see coin nearby) → CHASE_COIN → COLLECT → FARMING
-- FARMING → (see player with many coins) → CHASE_PLAYER → STEAL → FARMING
-- Any → (round ending) → RUSH_TO_CENTER → FARMING
-- Any → (low coins, near elimination zone) → FLEE → FARMING
```

### 10.2 Bot Difficulty Tiers

| Parameter | Easy | Medium | Hard |
|-----------|------|--------|------|
| Reaction time | 1.0s | 0.5s | 0.2s |
| Pathfinding efficiency | 60% | 80% | 95% |
| Steal tendency | 10% | 30% | 60% |
| Coin awareness range | 15 studs | 25 studs | 40 studs |
| Steal range awareness | 5 studs | 4 studs | 3.5 studs (perfect) |
| Movement prediction | None | Basic | Advanced |
| Dodge ability | None | Basic | 30% success rate |
| Farming route optimization | Random | Semi-optimal | Optimal |

### 10.3 Bot Farming Algorithm

```lua
-- Simple bot farming behavior:
-- 1. Find nearest visible coin (within awareness range)
-- 2. Move toward it
-- 3. If coin collected, find next coin
-- 4. If no coins visible, move toward center of arena (higher spawn density)
-- 5. If another player is within steal range AND has > 10 coins:
--    → 30% chance to attempt steal (move toward player)
--    → 70% chance to ignore and continue farming
-- 6. If arena timer < 30s AND not in top 3:
--    → Move toward nearest coin aggressively (desperation mode)
-- 7. If arena timer < 30s AND in top 3:
--    → Move away from other players (protect lead)
```

### 10.4 Bot Naming Convention

```lua
local botNamePrefixes = {
    "Coin", "Gold", "Silver", "Speed", "Bolt", "Flash",
    "Rush", "Dash", "Swift", "Blitz", "Zap", "Pixel",
    "Neon", "Glitch", "Byte", "Spark", "Surge", "Nova",
}
local botNameSuffixes = {
    "Alpha", "Bravo", "Charlie", "Delta", "Echo", "Foxtrot",
    "Bot", "X", "Pro", "1", "2", "3", "Go", "Max",
}
-- Generated name: random prefix + random suffix
-- Example: "FlashDelta", "CoinX", "SpeedBot", "RushPro"
```

---

## 11. Numerical Reference Tables

### 11.1 Complete Config Constants

```lua
local GameplayConfig = {
    -- PHYSICS
    BASE_WALK_SPEED = 16,
    MAX_WALK_SPEED = 32,
    SPEED_PER_LEVEL = 2,
    JUMP_POWER = 62,
    ARENA_JUMP_POWER = 72,
    WALK_ACCELERATION = 80,
    WALK_DECELERATION = 120,
    ARENA_WALK_ACCELERATION = 100,
    ARENA_WALK_DECELERATION = 160,

    -- COIN SYSTEM
    COIN_VALUE = 1,
    COIN_RESPAWN_SECONDS = 5,
    COIN_SPAWN_AREA_SIZE = 80,
    COIN_SPAWN_HEIGHT = 3,
    COIN_MAX_COUNT = 50,
    COIN_TOUCH_COOLDOWN = 0.3,

    -- COIN TYPES
    COIN_TYPES = {
        Bronze = { Value = 1, Weight = 60, Size = Vector3.new(0.3, 1, 1),
                   Color = Color3.fromRGB(205, 127, 50), RotationSpeed = 60 },
        Silver = { Value = 5, Weight = 25, Size = Vector3.new(0.4, 1.4, 1.4),
                   Color = Color3.fromRGB(192, 192, 192), RotationSpeed = 90 },
        Gold = { Value = 25, Weight = 12, Size = Vector3.new(0.5, 1.8, 1.8),
                 Color = Color3.fromRGB(255, 215, 0), RotationSpeed = 120 },
        Meteor = { Value = 100, Weight = 3, Size = Vector3.new(0.6, 2.2, 2.2),
                   Color = Color3.fromRGB(255, 69, 0), RotationSpeed = 150 },
    },

    -- UPGRADE SYSTEM
    UPGRADE_GROWTH_RATE = 1.6,

    -- Speed
    SPEED_BASE_COST = 25,
    SPEED_MAX_LEVEL = 8,

    -- Magnet
    MAGNET_BASE_COST = 50,
    MAGNET_MAX_LEVEL = 8,
    MAGNET_BASE_RADIUS = 4,
    MAGNET_PER_LEVEL = 1,

    -- Power
    POWER_BASE_COST = 100,
    POWER_MAX_LEVEL = 10,
    POWER_BASE_DAMAGE = 0,
    POWER_PER_LEVEL = 2,

    -- Multiplier
    MULTI_BASE_COST = 200,
    MULTI_MAX_LEVEL = 5,
    MULTI_BASE = 1.0,
    MULTI_PER_LEVEL = 0.2,

    -- COIN STEAL (ARENA)
    STEAL_PERCENT = 0.10,
    STEAL_COOLDOWN = 2.0,
    STEAL_RANGE = 4.0,
    STEAL_MINIMUM = 1,
    INVULN_TIME = 0.5,

    -- ARENA
    ARENA_COIN_SPAWN_RATE = 2, -- seconds between spawns
    ARENA_MAX_COINS = 30,
    ARENA_COIN_RESTRICTION = 0.5, -- spawn area multiplier

    -- COIN KING
    COIN_KING_DURATION = 180, -- 3 minutes
    COIN_KING_MAX_PLAYERS = 8,
    COIN_KING_MIN_PLAYERS = 2,
    COIN_KING_BOT_FILL_DELAY = 30, -- seconds
    COIN_KING_1ST_BONUS = 50,
    COIN_KING_2ND_BONUS = 30,
    COIN_KING_3RD_BONUS = 15,
    COIN_KING_PARTICIPATION = 5,

    -- SPEED BLITZ
    SPEED_BLITZ_DURATION = 240, -- 4 minutes
    SPEED_BLITZ_TEAM_SIZE = 4,
    SPEED_BLITZ_COIN_SPAWN_RATE = 1.5,
    SPEED_BLITZ_PARTY_MULTIPLIER = 1.2,

    -- LAST COIN STANDING
    LCS_DURATION_MAX = 480, -- 8 minutes max
    LCS_MAX_PLAYERS = 12,
    LCS_MIN_PLAYERS = 2,
    LCS_COIN_INTERVAL_MIN = 5,
    LCS_COIN_INTERVAL_MAX = 8,
    LCS_SHRINK_INTERVAL = 120, -- shrink every 2 minutes
    LCS_SHRINK_PERCENT = 0.25, -- reduce by 25%

    -- MATCHMAKING
    MATCH_RATING_RANGE = 200,
    MATCH_MAX_WAIT = 30, -- seconds before bot fill
    MATCH_COUNTDOWN = 5, -- seconds
    MATCH_LOBBY_TIMEOUT = 60,

    -- RATING
    RATING_K_FACTOR = 32,
    RATING_START = 1000,
    RATING_MIN_CHANGE = -50,
    RATING_MAX_CHANGE = 50,

    -- DAILY REWARDS
    DAILY_REWARDS = {
        [1] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
        [2] = { Type = "Coins", Amount = 25, Name = "25 Coins" },
        [3] = { Type = "SpeedBoost", Duration = 300, Name = "Speed Boost (5 min)" },
        [4] = { Type = "Coins", Amount = 25, Name = "25 Coins" },
        [5] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
        [6] = { Type = "Coins", Amount = 50, Name = "50 Coins" },
        [7] = { Type = "Crate", Rarity = "Legendary", Name = "Legendary Crate" },
    },

    -- OFFLINE COINS
    OFFLINE_BASE_RATE = 0.1, -- coins per second
    OFFLINE_MAX_HOURS = 8,
    OFFLINE_MAX_COINS = 500,
    OFFLINE_MAGNET_BONUS = 0.1, -- per magnet level
    OFFLINE_VIP_MULTIPLIER = 1.5,

    -- CONSECUTIVE PLAY BONUS
    CONSECUTIVE_BONUS_COINS = 10, -- bonus coins per consecutive arena round
    CONSECUTIVE_BONUS_MAX = 50, -- max consecutive bonus

    -- FOV
    BASE_FOV = 70,
    MAX_FOV = 75,
    FOV_TWEEN_SPEED = 0.3, -- seconds
}
```

### 11.2 Progression Timeline

```
Hour 0     : Start, 16 speed, 1.0× multi, no magnet, no power
Hour 0.5   : Speed 3, first arena attempt
Hour 1     : Speed 5, magnet 1
Hour 2     : Speed 7, magnet 2, power 1
Hour 3     : Speed 8 (MAX), magnet 3, power 2
Hour 5     : Magnet 5, power 4, multiplier 2
Hour 8     : Magnet 8 (MAX), power 6, multiplier 3
Hour 12    : Power 8, multiplier 4
Hour 16    : Power 10 (MAX), multiplier 5 (MAX)
Hour 16-40 : Cosmetic hunting, arena rating climbing
Hour 40+   : Endgame / prestige consideration
```

### 11.3 Arena Round Economy

**Average Coin King round earnings:**

| Placement | Coins Earned | Rating Change | Cumulative (10 rounds) |
|-----------|-------------|---------------|----------------------|
| 1st (×2/10) | 80-120 | +15 to +25 | 160-240 |
| 2nd (×2/10) | 60-90 | +5 to +15 | 120-180 |
| 3rd (×2/10) | 45-70 | +0 to +10 | 90-140 |
| 4th-5th (×2/10) | 30-50 | -5 to +5 | 60-100 |
| 6th-8th (×2/10) | 20-35 | -10 to -5 | 40-70 |
| **TOTAL (10 rounds)** | **470-630** | **Varies** | |

**This ensures arena is worth ~15-20 minutes of farming in coin terms**, making it a meaningful but not dominant income source.

---

## Appendix A: Implementation Priority Matrix

| System | Priority | Estimated Effort | Dependencies |
|--------|----------|-----------------|--------------|
| Coin types (visual + value) | P0 | 2h | Config.lua update |
| Floating text system | P0 | 3h | RemoteEvent |
| Screen shake | P0 | 2h | Client module |
| Sound effects catalog | P0 | 4h | Audio assets |
| Upgrade feedback | P0 | 2h | Existing upgrade system |
| Arena coin king mechanics | P0 | 8h | ArenaService |
| Bot AI (easy/medium) | P0 | 6h | ArenaService |
| Arena results screen | P0 | 3h | ArenaClient |
| Coin magnet visual ring | P1 | 2h | Magnet upgrade |
| Arena speed blitz mode | P1 | 4h | ArenaService |
| Daily rewards UI | P1 | 3h | DailyRewardService |
| Offline coins modal | P1 | 3h | OfflineService |
| Mobile joystick | P1 | 4h | Client input |
| FOV scaling | P2 | 1h | Client camera |
| Particle effects catalog | P2 | 4h | VFX assets |
| Music system | P2 | 3h | Audio assets |
| Bot AI (hard) | P2 | 3h | ArenaService |
| Last coin standing mode | P2 | 6h | ArenaService |
| Prestige system | P3 | 8h | Max upgrades |

**Total estimated effort:** ~74 hours across all systems

---

## Appendix B: Tuning Knobs Reference

These are the primary values to adjust during playtesting:

| Knob | Where | Effect of Increasing | Effect of Decreasing |
|------|-------|---------------------|---------------------|
| `UPGRADE_GROWTH_RATE` | Config.lua | Slower progression, more grind | Faster progression, less grind |
| `COIN_RESPAWN_SECONDS` | Config.lua | Fewer coins available, slower farming | More coins, faster farming |
| `COIN_MAX_COUNT` | Config.lua | Denser coin field, easier collection | Sparser coins, more exploration |
| `STEAL_PERCENT` | Config.lua | More punishing steals, higher tension | Gentler steals, less frustrating |
| `ARENA_COIN_SPAWN_RATE` | Config.lua | Faster arena pace, more action | Slower arena pace, more strategic |
| `RATING_K_FACTOR` | Config.lua | Faster rating movement, more volatile | Slower rating movement, more stable |
| `MATCH_RATING_RANGE` | Config.lua | Better match quality, longer queues | Worse match quality, shorter queues |
| `OFFLINE_BASE_RATE` | Config.lua | More idle reward, stronger return hook | Less idle reward, active play rewarded |
| `WALK_ACCELERATION` | Config.lua | Snappier movement, more responsive | Sluggish movement, more momentum |
| `JUMP_POWER` | Config.lua | Higher jumps, more vertical play | Lower jumps, more grounded play |

**Playtesting protocol:**
1. Start with values in this document
2. Measure session length, upgrade purchases, arena participation
3. If session < 8 min: increase coin income or decrease upgrade costs
4. If session > 15 min: decrease coin income or increase upgrade costs
5. If arena participation < 30%: increase arena rewards or reduce wait times
6. If win rate is > 60% for average players: increase bot difficulty
7. Iterate weekly based on telemetry data

---

**END OF GAMEPLAY MECHANICS DESIGN**
