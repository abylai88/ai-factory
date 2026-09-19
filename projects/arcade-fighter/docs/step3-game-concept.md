# Step 3: Game Concept — Battle Brawl

**Date:** September 15, 2026 (v4 — Canonical Game Concept Artifact)
**Status:** ✅ Complete — Final synthesis from market analysis + competitor analysis
**Game:** Battle Brawl — Browser Arcade Fighter with Roguelite Progression
**Platform:** Phaser 3.90 (HTML5/WebGL) — Poki + CrazyGames
**Pipeline:** Step 3/14 — Game Concept

---

## Executive Summary

**Battle Brawl** is a zero-download browser arcade fighter that fills the largest gap in the $6–8B browser gaming market: **no quality-tier fighter exists on the world's top gaming portals**. By combining non-stickman character art (90%+ competitors are stickmen), a roguelite gauntlet loop (validated on PC but absent from browser), and mobile-first touch controls (62–81% of traffic is mobile), Battle Brawl targets the undiscovered sweet spot between casual stickman spam and hardcore competitive fighters.

The game ships on Poki (100M+ MAU) and CrazyGames (50M+ MAU) — a combined 150M+ monthly active users — generating revenue through rewarded video ads ($4–$8 blended net eCPM) with a clear expansion path to online multiplayer (Poki Netlib P2P, zero server costs) and cosmetic IAP.

**Window:** 53% of mobile developers plan browser ports within 12 months. Ship fast, establish portal presence, win.

---

## 1. USP (Unique Selling Proposition)

### Primary USP
> **"The first browser fighter with real characters, roguelite runs, and mobile-first touch — play instantly, no download."**

### Three-Word Pitch
**Characters. Runs. Zero Download.**

### Why This USP Works

| Element | What Battle Brawl Delivers | What Competitors Do | Market Gap |
|---------|---------------------------|---------------------|------------|
| **Real Characters** | 8 distinctive fighters with unique silhouettes, archetypes, and mechanics | 90%+ use generic stickman art (Ragdoll Hit 591K, Stick Fighter 531K, Stickman Kombat 2D, Magic Battleground, Stickman Fury) | #1 visual differentiator; portal thumbnails; brand identity |
| **Roguelite Runs** | 3–5 fight gauntlets with upgrade choices between rounds; run-only power-ups create build variety | Zero portal fighters use roguelite. Super Stick Hero has basic boons but is self-hosted (zero portal traffic) | "One more try" loop drives retention; fits 5–15 min sessions |
| **Mobile-First Touch** | Virtual joystick + 48px buttons designed from day one using phaser-virtual-joystick | All competitors treat touch as afterthought | 62–81% of browser traffic is mobile; Poki mandates force-touch |
| **Zero Download** | Works in any browser tab, < 3s load, < 10s to first fight | Core advantage vs. app stores; 58% choose web for frictionless access | Poki 100M+ MAU exists because of this |

### Competitive Moat (Ranked by Durability)

| Rank | Moat | Durability | Evidence |
|------|------|------------|----------|
| 1 | **First-mover on portals** | HIGH | Poki/CrazyGames placement = discoverability advantage; vote count and ratings compound; 227 games finalized in 2025 from thousands reviewed |
| 2 | **Non-stickman art** | HIGH | Visual identity = brand recognition; 90%+ competitors use stickmen; difficult to copy quality art; Poki thumbnails require distinctive silhouettes |
| 3 | **Online multiplayer via Poki Netlib** | HIGH (if shipped first) | P2P WebRTC, zero server costs; only ONE game on Poki has online PvP (Gladihoppers — not a fighter) |
| 4 | **Roguelite structure** | MEDIUM | Unique in portal fighters; creates "one more try" loop; validated by PolyFighter, Shot One, Garden Souls (all PC-only) |
| 5 | **Touch-first design** | MEDIUM | 62–81% mobile traffic demands this; competitors treat mobile as afterthought |

### Market Positioning

```
                        DEPTH
                          ▲
                          │
    Street Fighter 6 ●    │
                          │
    Rivals of Aether ●    │     ● Super Stick Hero
                          │
                          │          ● DAWPUNCH (self-hosted)
                          │
                          │              ★ BATTLE BRAWL (target)
                          │
    Ragdoll Hit ●         │
                          │  ● Stick Fighter
    Iron Snout ●          │
                          │
                          └──────────────────────────────────► ACCESSIBILITY
                        HARDCORE                          CASUAL
```

**Position:** More depth than casual stickman fighters (combo system, roguelite upgrades, stamina management) but more accessible than hardcore competitive fighters (simplified controls, 5-minute sessions, auto-combos for basics).

---

## 2. Core Gameplay Loop

### Three Interlocking Loops

#### 2.1 Micro-Loop: Per Round (60–90 seconds)

```
POSITION ──► ATTACK ──► REACT ──► COMBO ──► FINISH
   ▲              │         │         │         │
   │              ▼         ▼         ▼         ▼
   │         Hit Flash  Block    Combo      Slow-Mo
   │         Screen Shake       Counter    KO Zoom
   │         Particles          Hit
   │              │
   └──────────────┘
       (continuous engagement)

Inputs: Direction + Light + Heavy + Block
Feedback: Shake, flash, particles, sound, slow-mo
Duration: 60–90 seconds
```

**What happens in each round:**
1. Player positions their fighter (walk, jump, crouch, dash)
2. Attacks opponent with light/heavy/special moves
3. Reacts to opponent's attacks (block, counter, dodge)
4. Chains hits into combos for bonus damage and XP
5. Finishes opponent with a KO (slow-motion, camera zoom, particles)
6. Wins the round (best of 3 per match)

**Combat Mechanics:**

| Mechanic | Detail |
|----------|--------|
| Health | 100 HP per character (varies by archetype) |
| Stamina | 100 SP; regenerates 8/sec; consumed by heavy, specials, blocks |
| Light Attack | 5–8 dmg, 6-frame startup, 0 SP cost |
| Heavy Attack | 12–18 dmg, 12-frame startup, 15 SP cost |
| Special | 20–30 dmg, varies, 30–50 SP cost; character-specific |
| Throw | 15 dmg, 10-frame startup, unblockable, 20 SP cost |
| Perfect Block | Block within 4 frames = 10 SP refund + advantage |
| Guard Break | 0 SP = 30-frame stagger; cannot block |
| Combo Timing | 8-frame window (133ms) for true combos |

**Visual Juice (non-negotiable):**

| Effect | Trigger | Implementation |
|--------|---------|----------------|
| Hit Flash | Any attack connects | White flash, 2 frames |
| Screen Shake | Heavy hit / special | 4–8px, 200ms, exponential decay |
| Hit Stop | Any attack connects | 2–4 frame freeze |
| Particle Burst | Hit connects | 8–12 particles in hit direction |
| Slow Motion | KO / last-hit finish | 0.5s at 0.3× speed |
| Camera Zoom | Special move | 1.1× zoom for 300ms |
| Floating Damage | Damage dealt | Rises 60px, fades over 500ms |
| Combo Counter | 3+ hit combo | Animated number; color escalates |

#### 2.2 Meso-Loop: Gauntlet Run (5–8 minutes)

```
SELECT FIGHTER ──► FIGHT 1 ──► UPGRADE ──► FIGHT 2 ──► UPGRADE
                  (Novice)     Choice      (Easy)       Choice
                                         │
                                         ▼
                 Pick 1 of 3 upgrades per fight win
                                         │
                                         ▼
              ──► FIGHT 3 ──► UPGRADE ──► FIGHT 4 ──► UPGRADE
                  (Medium)    Choice      (Hard)        Choice
                                         │
                                         ▼
              ──► FIGHT 5 (BOSS) ──► RESULTS ──► "ONE MORE TRY"
                  "The Final Challenger"
                  Phase shifts at 66% and 33% HP
```

| Stage | Difficulty | Duration | Design Intent |
|-------|-----------|----------|---------------|
| Fight 1 | Novice | 60–75s | Learn controls, feel the juice |
| Fight 2 | Easy | 65–80s | Combos start to click |
| Fight 3 | Medium | 70–85s | Upgrades compound, challenge rises |
| Fight 4 | Hard | 75–90s | Tension peaks, adaptation required |
| Fight 5 (Boss) | Boss | 80–95s | Phase shifts at 66% and 33% HP; dramatic music |

**Key design decisions:**
- **3–5 fights per run** = one browser session (Poki benchmark: 11–20 min)
- **Upgrades are run-only** — resets every run keep runs fresh and encourage experimentation
- **Upgrade variety (12+ power-ups)** — damage, speed, health, stamina, combo extension, perfect block, counter, heal, movement, synergy builds
- **Boss has unique mechanics** — phase shifts at 66% and 33% HP, not just a stat bump

**Session fit:** 3–5 fights = one browser session. Runs per session: 2–4. Session total: 10–20 min. Aligns with Poki's 11–20 min benchmark and CrazyGames' 30 min average.

#### 2.3 Meta-Loop: Across Runs (Ongoing)

```
┌──────────────────────────────────────────────────────────────┐
│              META-LOOP: ACROSS RUNS                           │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  ┌─────────┐    ┌──────────┐    ┌──────────┐               │
│  │  XP &   │───►│ UNLOCK   │───►│  NEW     │               │
│  │ LEVELING│    │ FIGHTERS │    │  RUN     │               │
│  └─────────┘    │ TITLES   │    └────┬─────┘               │
│       ▲         │ SKINS    │         │                      │
│       │         └──────────┘         │                      │
│       │                              │                      │
│       │         ┌──────────┐         │                      │
│       │         │  COINS   │         │                      │
│       │         │ ECONOMY  │─────────┘                      │
│       │         └──────────┘                                │
│       │              │                                      │
│       │              ▼                                      │
│       │         ┌──────────┐                                │
│       │         │ COSMETIC │                                │
│       │         │   SHOP   │                                │
│       │         │ (Phase 2)│                                │
│       │         └──────────┘                                │
│       │                                                     │
│       │         ┌──────────┐                                │
│       └─────────│  DAILY   │                                │
│                 │CHALLENGES│                                │
│                 └──────────┘                                │
└──────────────────────────────────────────────────────────────┘
```

**What persists across runs:**
- **XP & Levels:** 35 levels; each unlocks a fighter, title, or cosmetic
- **Coins:** Earned per fight, spent in cosmetic shop (skins, effects, stages)
- **Character Unlocks:** 4 starters → unlock 4 more through gameplay achievements
- **High Scores:** Best run score per character; leaderboard drive
- **Daily Challenges:** Unique modifiers each day (e.g., "All Criticals", "Double Speed")

### Loop Interaction

```
                    ┌─────────────────────────┐
                    │      META-LOOP          │
                    │  (XP, Levels, Unlocks)  │
                    └────────────┬────────────┘
                                 │
                    Motivates new runs
                                 │
                                 ▼
┌─────────────────────────────────────────────────────────┐
│                   MESO-LOOP                              │
│            (Gauntlet: 3-5 Fights + Upgrades)             │
│                                                         │
│   Fight 1 ──► Upgrade ──► Fight 2 ──► Upgrade ──► ...   │
└────────────────────────┬────────────────────────────────┘
                         │
                    Contains rounds
                         │
                         ▼
┌─────────────────────────────────────────────────────────┐
│                   MICRO-LOOP                             │
│              (Per Round: 60-90 sec)                      │
│                                                         │
│   Position ──► Attack ──► React ──► Combo ──► Finish     │
└─────────────────────────────────────────────────────────┘
```

**Why this works:**
- **Micro-loop** delivers instant satisfaction (every hit feels good)
- **Meso-loop** creates "one more try" motivation (upgrades, boss tension, near-misses)
- **Meta-loop** provides long-term goals (new fighters, cosmetics, high scores)
- All three loops fit within Poki's 11–20 minute session benchmark
- The roguelite meso-loop is the critical differentiator — no other portal fighter has it

---

## 3. Target Player Experience

### 3.1 Session Design

| Metric | Target | Rationale |
|--------|--------|-----------|
| **Session Length** | 5–12 minutes | Poki benchmark: 11–20 min; CrazyGames avg: 30 min |
| **Match Length** | 60–90 seconds per round | Quick, intense, satisfying; 64% of mobile fighting game matches last < 10 min |
| **Rounds per Match** | Best of 3 | Standard fighting game format; 3–5 min per full match |
| **Fights per Run** | 3–5 (Gauntlet) | Full run = one browser session |
| **Time to First Fun** | < 10 seconds | No tutorial walls; learn by doing (Poki requirement: streamlined entry) |
| **Matches per Session** | 2–4 | Run → result → "one more try" → run again |

### 3.2 Player Journey (First 10 Minutes)

```
TIME    EVENT                           EMOTION         HOOK
─────   ─────────────────────────────   ─────────────   ──────────────────
0–5s    Title screen → tap "PLAY"       Anticipation    "This looks cool"
5–15s   Character select (4 fighters)   Curiosity       "Who do I pick?"
15–30s  First fight begins              Excitement      "Controls feel good"
30–60s  Win first round                 Satisfaction    "I'm getting this"
1–3min  Fight 2–3 more opponents        Flow            "Combos feel natural"
3–5min  Pick upgrade after fight 2      Strategic       "Iron Fists or Combo Master?"
5–8min  Face boss-tier opponent         Tension         "This is hard..."
8–10min Run ends → score screen         Reward          "New fighter unlocked!"
10–12min Start new run with unlocks     Motivation      "One more try..."
```

### 3.3 Emotional Arc

```
    ▲ Satisfaction
    │         ╭──────╮        ╭──────╮
    │        ╱        ╲      ╱        ╲     ╭──────
    │       ╱   Flow   ╲    ╱ Challenge ╲   ╱ Reward
    │      ╱            ╲  ╱             ╲ ╱
    │     ╱              ╲╱               V
    │    ╱            Tension          Release
    │   ╱
    │  ╱ Excitement
    │ ╱
    │╱
    └──────────────────────────────────────────────► Time
    0s    30s    1min   2min   3min   5min   8min  10min
```

**Key emotional beats:**
1. **Excitement (0–30s):** Visual juice hooks immediately — screen shake, particles, satisfying hits
2. **Flow (30s–3min):** Combat system clicks; combos feel natural; difficulty is manageable
3. **Challenge (3–5min):** Upgrades compound; opponents get harder; player adapts
4. **Tension (5–8min):** Boss fight; dramatic music; screen effects; one mistake = KO
5. **Release (8–10min):** Victory or defeat — both feel earned; score screen validates effort
6. **Reward (10–12min):** Unlock new fighter/title/cosmetic; "one more try" motivation kicks in

### 3.4 "One More Try" Hooks

| Hook | Trigger | Psychological Driver | Frequency |
|------|---------|---------------------|-----------|
| **Upgrade Combo** | "I almost had the combo I wanted next fight..." | Near-miss motivation | Every run |
| **New Character** | "I'm 200 XP from unlocking Blaze..." | Completionism | Every 3–5 runs |
| **Daily Challenge** | "Today's modifier is 'All Criticals' — that sounds fun!" | Novelty-seeking | Daily |
| **Score Chase** | "My best run was 4 fights — I want 5" | Mastery drive | Every run |
| **Boss Revenge** | "That boss destroyed me — I know how to beat it now" | Competence seeking | Every boss encounter |
| **Cosmetic Desire** | "That Neon Rex skin looks amazing..." | Collection impulse | Ongoing |

### 3.5 Target Player Profiles

| Profile | Age | Session | Priority Features | Revenue | % of Audience |
|---------|-----|---------|-------------------|---------|---------------|
| **Casual Browser** | 16–25 | 5–8 min | Quick Match, touch controls, visual juice | Low (ad-only) | ~50% |
| **Roguelite Grinder** | 20–35 | 10–15 min | Gauntlet, upgrades, unlockables, score chase | Medium (ads + cosmetics) | ~30% |
| **Competitive Lite** | 18–30 | 15–20 min | Local 2P, combos, characters, online PvP (Phase 2) | High (ads + IAP) | ~15% |
| **Content Creator** | 18–35 | Variable | Spectator mode, clip-worthy moments, replay | High (drives organic traffic) | ~5% |

**Key demographic insight (Dataintelo 2024):** Adults 18+ generate **54.2% of mobile fighting game revenue** despite being only 38.7% of players — they spend **2–3× more** than teenagers. This validates targeting the 18–35 "Roguelite Grinder" and "Competitive Lite" segments as primary revenue drivers.

---

## 4. Key Features

### 4.1 MVP Features (Phase 1 — Ship in 8–10 weeks)

| # | Feature | Why It's Critical | Competitive Evidence | Effort |
|---|---------|-------------------|----------------------|--------|
| **F1** | **Distinctive Non-Stickman Characters (4 starters)** | #1 visual differentiator; 90%+ competitors use stickmen; portal thumbnails; brand identity | Karate Fighter (3D, 971K votes) proves quality art gets votes; stickman fighters rate 4.2–4.6 | HIGH |
| **F2** | **Mobile-First Touch Controls** | 62–81% of traffic is mobile; Poki requires force-touch on tablets; most competitors fail here | phaser-virtual-joystick (Brawl Stars-inspired) provides proven touch UX | MEDIUM |
| **F3** | **Visual Juice (shake, flash, particles, slow-mo)** | Sets quality bar above Stickman Kombat 2D; drives 4.0+ ratings; every hit feels impactful | Stickman Kombat 2D sets bar (camera shake, hit flash, slow-mo); Super Stick Hero added hit-stop (Aug 2026) | MEDIUM |
| **F4** | **Combo System (timing-based confirms)** | Depth beyond button mashing; 8-frame timing window; basic chains + special cancels | Super Stick Hero (40+ moves); DAWPUNCH (full combo system); validates depth in browser fighters | MEDIUM |
| **F5** | **Roguelite Gauntlet (3–5 fights + upgrades)** | Unique on portals; "one more try" loop; fits 5–15 min sessions; creates build variety | Validated by PolyFighter (PAX/EVO 2026), Shot One Fighters (Justin Wong), Garden Souls (TGA nominee) — all PC-only | HIGH |
| **F6** | **Local 2-Player Mode** | Social/viral potential; low implementation cost; proven on Poki | Stick Fighter has 531K votes partly due to local 2P; social sharing drives discovery | LOW |
| **F7** | **AI Opponent (5 difficulty tiers)** | Novice → Boss progression; adaptive AI; matches gauntlet structure | Stickman Kombat 2D tower progression; Super Stick Hero 3-phase boss AI | MEDIUM |
| **F8** | **XP/Leveling + Coin Economy** | Meta-progression drives retention; 35 levels; unlock fighters through gameplay | Standard F2P retention mechanic; Poki COO confirms 11–20 min sessions require progression hooks | LOW |
| **F9** | **Rewarded Video Ads** | Primary monetization; $4–$8 net eCPM; 97% opt-in rate | AppLixir 2026: US web rewarded eCPM $6.98; completion rate 93.8% | LOW |
| **F10** | **Poki + CrazyGames Submission** | Portal distribution = 150M+ MAU combined; 50/50 (Poki) and 60/70 (CG) revenue share | Poki COO confirms fighting games are sought; 227 games finalized in 2025 from thousands reviewed | LOW |
| **F11** | **3 Distinct Stages** | Visual variety; parallax backgrounds; ambient effects; stage-specific music | Stickman Kombat 2D has multiple stages; visual variety keeps runs fresh | MEDIUM |
| **F12** | **localStorage Save System** | Progress persistence; Poki incognito mode compliant; try/catch fallback | Poki requirement; essential for meta-progression to function | LOW |

### 4.2 Phase 2 Features (Growth — 4–6 weeks post-MVP)

| # | Feature | Why It Matters | Competitive Evidence | Effort |
|---|---------|---------------|----------------------|--------|
| **F13** | **Online Multiplayer (Poki Netlib P2P)** | #1 differentiator; zero server costs; only ONE fighter on Poki has online PvP | Gladihoppers is the only online PvP game on Poki (not a fighter); Poki Netlib v0.0.18 in production | HIGH |
| **F14** | **4 Unlockable Characters** | Roster depth; each with unique archetypes and mechanics | Stick Fighter has 6 characters; mITyFighter has 17; 8 total competitive | HIGH |
| **F15** | **Cosmetic IAP Store** | Revenue expansion; skins, effects, stages ($0.99–$4.99) | DAWPUNCH validates cosmetic shop; 2XKO proves F2P + cosmetics in fighters | MEDIUM |
| **F16** | **Daily/Weekly Challenges** | Retention driver; daily login bonuses; unique modifiers | Standard live-ops mechanic; no browser fighter does this | LOW |
| **F17** | **Training Mode** | Smart CPU teaches combos; adapts to skill; lowers barrier for new players | Super Stick Hero has training mode; accessibility expands audience | MEDIUM |

### 4.3 Phase 3 Features (Scale — 4–6 weeks post-Phase 2)

| # | Feature | Why It Matters |
|---|---------|---------------|
| **F18** | **Season Pass / Battle Pass** | Recurring revenue + retention; regular character drops every 1–3 months; $4–$5/month sweet spot (GG Strive, SF6 validated) |
| **F19** | **Spectator Mode + Replay System** | Content creator tool; organic Twitch/YouTube discovery; fighting games are inherently streamable |
| **F20** | **Clip Sharing** | Social viral loop; browser-native sharing to social media |
| **F21** | **Seasonal Content Cycles** | New stages, characters, events; live ops for long-term engagement |

### 4.4 Feature Priority Matrix

| Priority | Feature | MVP? | Competitive Impact | Effort | Rationale |
|----------|---------|------|-------------------|--------|-----------|
| 1 | Distinctive non-stickman characters (4+) | ✅ | 🔴 CRITICAL | HIGH | #1 visual gap; 90%+ stickmen; portal thumbnails |
| 2 | Touch controls (virtual joystick + buttons) | ✅ | 🔴 CRITICAL | MEDIUM | Mandatory for 62–81% mobile traffic |
| 3 | Visual juice (shake, flash, particles, slow-mo) | ✅ | 🔴 CRITICAL | MEDIUM | Quality bar; every hit must feel impactful |
| 4 | Combo system (timing-based confirms) | ✅ | 🟠 HIGH | MEDIUM | Depth beyond mashing; matches competitors |
| 5 | Roguelite gauntlet progression | ✅ | 🟠 HIGH | HIGH | Unique on portals; "one more try" loop |
| 6 | Local 2P mode | ✅ | 🟡 MEDIUM | LOW | Social/viral; proven on Poki |
| 7 | XP/leveling + coin economy | ✅ | 🟡 MEDIUM | LOW | Meta-progression drives retention |
| 8 | 3 distinct stages with effects | ✅ | 🟡 MEDIUM | MEDIUM | Visual variety |
| 9 | AI opponent (5 tiers) | ✅ | 🟡 MEDIUM | MEDIUM | Gauntlet structure requires it |
| 10 | Rewarded video ads | ✅ | 🟡 MEDIUM | LOW | Primary monetization |
| 11 | Poki + CrazyGames submission | ✅ | 🔴 CRITICAL | LOW | Distribution = everything |
| 12 | Online PvP (Poki Netlib) | Phase 2 | 🔴 CRITICAL | HIGH | #1 differentiator; zero server costs |
| 13 | 4 unlockable characters | Phase 2 | 🟠 HIGH | HIGH | Roster depth |
| 14 | Cosmetic IAP store | Phase 2 | 🟡 MEDIUM | MEDIUM | Revenue expansion |
| 15 | Daily challenges | Phase 2 | 🟡 MEDIUM | LOW | Retention driver |

---

## 5. Characters

### Design Philosophy
- **Distinct silhouettes** — recognizable at thumbnail size (critical for Poki thumbnails)
- **Unique mechanics** — each fighter feels different to play
- **Not stickmen** — memorable, stylized character designs (90%+ of competitors use stickmen)
- **Archetypes** — cover classic fighting game roles (rushdown, zoner, grappler, etc.)

### Starter Roster (MVP — 4 Characters)

| # | Name | Archetype | HP | Speed | Special Move | Visual Theme |
|---|------|-----------|-----|-------|-------------|--------------|
| 1 | **Rex** | Balanced | 100 | 200px/s | Power Strike (25 dmg shockwave) | Red/orange, boxer gloves, athletic |
| 2 | **Volt** | Rushdown | 85 | 250px/s | Lightning Dash (20 dmg, passes through) | Blue/electric, spiky hair, lightning |
| 3 | **Titan** | Grappler | 120 | 160px/s | Earth Slam (30 dmg ground pound) | Green/stone, large build, earth |
| 4 | **Luna** | Zoner | 90 | 190px/s | Lunar Beam (22 dmg full-screen projectile) | Purple/lunar, staff weapon, moon |

### Unlockable Roster (Phase 2)

| # | Name | Archetype | Unlock Method |
|---|------|-----------|---------------|
| 5 | **Blaze** | Glass Cannon | Reach Level 5 |
| 6 | **Frost** | Defensive | Reach Level 10 |
| 7 | **Shadow** | Trickster | Reach Level 20 |
| 8 | **Astra** | All-Rounder+ | Reach Level 30 |

### Rock-Paper-Scissors Balance

```
        ┌───── beats ─────┐
        │                  │
        ▼                  │
   ┌─────────┐        ┌─────────┐
   │RUSHDOWN │        │  ZONER  │
   │ (Volt)  │───────►│ (Luna)  │
   └─────────┘        └─────────┘
        ▲                  │
        │                  │
        │    ┌─────────┐   │
        │    │BALANCED │   │
        └────│ (Rex)   │◄──┘
             └─────────┘
                ▲
                │
        ┌───────┴───────┐
        │               │
   ┌─────────┐    ┌─────────┐
   │GRAPPLER │    │         │
   │(Titan)  │───►│         │
   └─────────┘    └─────────┘
   Beats rushdown  Zoner beats grappler
   (armor through  (keep distance,
    fast attacks)   avoid throws)
```

---

## 6. Roguelite Upgrade System

### Upgrade Pool (12 Power-Ups)

After each fight win, pick 1 of 3 randomly selected upgrades. Upgrades last for the current run only.

| Category | Upgrade | Effect | Rarity |
|----------|---------|--------|--------|
| **Offensive** | Power Strike | +15% damage | 15% |
| | Combo Master | Extend combo window by 4 frames | 10% |
| | Punisher | +50% counter-hit damage | 8% |
| | Thundergod | Special moves cost 50% less SP | 2% |
| **Defensive** | Iron Body | +25 max HP | 15% |
| | Second Wind | Heal 30% HP now | 12% |
| | Tough Skin | Reduce incoming damage by 10% | 5% |
| | Auto-Heal | Regenerate 2 HP/sec | 2% |
| **Movement** | Quick Feet | +20% move speed | 15% |
| **Utility** | Deep Breath | +25 max SP + 20% SP regen | 15% |
| | Reflexes | Perfect block window: 4→8 frames | 10% |
| | Berserker | +25% damage below 30% HP | 3% |

### Build Variety Examples

| Build | Upgrades | Playstyle |
|-------|----------|-----------|
| **Glass Cannon** | Power Strike + Berserker + Thundergod | Maximum damage, minimum defense |
| **Tank** | Iron Body + Tough Skin + Auto-Heal | Survive everything, chip away |
| **Combo King** | Combo Master + Quick Feet + Punisher | Hit-confirm everything, counter-focused |
| **Balanced** | Power Strike + Iron Body + Second Wind | Solid all-around |

---

## 7. Monetization Strategy

### MVP Monetization

| Method | Placement | Revenue Target |
|--------|-----------|----------------|
| **Rewarded Video** | "Double coins" after run; "Continue" after defeat; "Try locked fighter" | Primary ($4–$8 net eCPM) |
| **Interstitial** | Between runs (natural break) | Secondary |
| **Portal Ad Revenue** | Standard portal share (Poki 50%, CG 60%) | Base revenue |

### Revenue Benchmarks (September 15, 2026 — Cross-Verified)

| Metric | Value | Source |
|--------|-------|--------|
| US Web Rewarded eCPM (net) | $4–$8 | AppLixir mid-year 2026 |
| Gross US Web eCPM | $15–$28 | Cinevva 2026, Playgama 2026 |
| Opt-in Rate | 97% | AppLixir 2026 |
| Completion Rate | 93.8% global, 95.4% tier-1 | AppLixir 2026 |
| Fill Rate | 95.1% | AppLixir 2026 |
| ARPDAU Target (Action/Arcade) | $0.08 | AppLixir genre benchmark |
| Poki Top Studios | Up to €1M/year | Poki COO (Jul 2026) |
| Median Portal Games | $200–$2,000/month | Cinevva 2026 |

### Revenue Projections

| Phase | DAU | Monthly Revenue |
|-------|-----|----------------|
| Phase 1 (MVP) | 1K–20K | $148–$3,920 |
| Phase 2 (Growth) | 5K–50K | $2,360–$109,800 |
| Phase 3 (Scale) | 20K–100K | $10,000–$250,000+ |

---

## 8. Distribution Strategy

### Primary: Poki (100M+ MAU)

| Aspect | Detail |
|--------|--------|
| Revenue Share | 50/50 (Poki traffic); 100% (own traffic) |
| Approval | Rigorous, multi-stage; 227 games finalized in 2025 from thousands reviewed |
| Requirements | ≤8MB initial load; 16:9; desktop+mobile+tablet; SDK events; <3s load on 4G |
| Exclusivity | Preferred (web exclusive, 5-year term); non-exclusive available |
| Employee Count | 153 (Tracxn August 2026, up from 65 FTE) |
| Self-funded | Never took outside investment (Yahoo Finance Mar 2026) |

### Secondary: CrazyGames (50–60M MAU)

| Aspect | Detail |
|--------|--------|
| Revenue Share | 60% ads / 70% IAP |
| Approval | QA review (1–2 days); faster than Poki |
| Requirements | ≤50MB total; ≤1,500 files; SDK at launch |
| Exclusivity | Not required |
| Revenue | ~$24.6M annual (Tracxn) |
| Games in Catalog | 4,000+ |

### Community: itch.io

| Aspect | Detail |
|--------|--------|
| Revenue Share | 90%+ to developer |
| Purpose | Community building, direct sales, feedback, wishlist |

---

## 9. Success Metrics

### MVP KPIs

| Metric | Target | Rationale |
|--------|--------|-----------|
| Average Session Length | 8–12 minutes | Poki benchmark: 11–20 min |
| Retention D1 | > 30% | Industry average for casual browser games |
| Retention D7 | > 10% | Above average for F2P casual |
| Matches per Session | 3–5 | Enough for satisfaction, not fatigue |
| Portal Rating | > 4.0/5 | Poki/CrazyGames quality threshold |
| Revenue per DAU | $0.05–$0.15 | Based on ad eCPM benchmarks |
| Gauntlet Completion Rate | > 40% | Run should be challenging but finishable |

### Phase 2 KPIs

| Metric | Target |
|--------|--------|
| Online PvP Match Completion | > 60% |
| IAP Conversion Rate | 2–5% of DAU |
| Monthly Revenue | $2,000–$10,000 (mid-tier) |

---

## 10. Risk Assessment (Updated September 15, 2026)

| Risk | Severity | Probability | Mitigation |
|------|----------|-------------|------------|
| 53% mobile devs porting to browser (supply flood) | HIGH | HIGH | Ship fast; establish portal presence before wave |
| New Phaser fighter on portals before us | HIGH | MEDIUM | Ship fast; prioritize MVP; establish portal presence early |
| Touch controls feel imprecise | HIGH | MEDIUM | Design touch-first; Brawl Stars joystick reference; playtest extensively |
| Asset size exceeds 8MB Poki limit | MEDIUM | MEDIUM | Target 7.65MB; aggressive atlas packing; WebP; lazy-load music; measure weekly |
| AI feels too easy or hard | MEDIUM | HIGH | Tuning passes after each milestone; A/B test difficulty curves |
| Roguelite doesn't fit browser sessions | LOW | LOW | Validated by PolyFighter, Shot One, Garden Souls (2026); all PC-only, none on browser |
| Ad blockers reduce revenue | MEDIUM | MEDIUM | Game works without ads; non-intrusive; WebGL canvas ads resist blockers |
| eCPM volatility (Q4 highs, Q1 troughs) | MEDIUM | MEDIUM | Plan on 12-month rolling average, not spot figures |
| Phaser 4 migration needed | LOW | LOW | "Few hours of work" for standard API; stay on 3.90 for MVP; migrate in Phase 2 if needed |
| Poki Netlib still beta | MEDIUM | MEDIUM | Design abstraction layer for networking; actively used in production |
| Established mobile IPs arriving on web (SYBO, Fingersoft, Outfit7) | HIGH | MEDIUM | Ship before they arrive; focus on fighting game niche they don't occupy |
| Ragdoll physics trend overtakes skill-based fighters | MEDIUM | MEDIUM | Include ragdoll elements for accessibility while maintaining skill ceiling |

---

## 11. Development Timeline

### Phase 1: MVP (8–10 weeks)
- Core combat system (input, fighter base, combat, combos)
- 4 starter characters with unique movesets
- 3 stages with parallax backgrounds and ambient effects
- Gauntlet mode (roguelite progression)
- Quick Match mode
- Local 2P mode
- Touch controls for mobile
- Visual juice package
- XP/leveling and coin economy
- Poki SDK integration
- Rewarded video ad integration
- localStorage save system
- Poki + CrazyGames submission

### Phase 2: Growth (4–6 weeks post-MVP)
- Online multiplayer (Poki Netlib P2P)
- Ranked PvP with matchmaking
- 4 unlockable characters
- Cosmetic IAP store
- Daily/weekly challenges
- Training mode

### Phase 3: Scale (4–6 weeks post-Phase 2)
- Season Pass / Battle Pass
- Spectator mode + replay system
- Clip sharing
- Seasonal content cycles

---

## 12. Verification Checklist

| Item | Status | Evidence |
|------|--------|----------|
| USP is differentiating from competitors | ✅ | Non-stickman art + roguelite + touch-first = unique combination; 90%+ competitors are stickmen; zero portal fighters have roguelite |
| Core loop is concrete and testable | ✅ | Three loops defined with timing, inputs, feedback, and session fit; all within Poki 11–20 min benchmark |
| Target audience is specific | ✅ | 4 player profiles with age, session length, features, revenue; backed by Dataintelo demographic data |
| Key features are prioritized | ✅ | 21 features across 3 phases; priority matrix with competitive impact and effort ratings |
| Monetization is realistic | ✅ | AppLixir 2026 benchmarks ($4–$8 eCPM, 97% opt-in); revenue projections by phase |
| Distribution strategy is concrete | ✅ | Poki + CrazyGames requirements, revenue shares, and approval processes documented |
| Risks are identified | ✅ | 12 risks with severity, probability, and mitigation strategies |

---

*Step 3 Game Concept v4 — September 15, 2026*
*Canonical game concept artifact for Battle Brawl pipeline.*
*Sources: step1-market-analysis-sep15-v2.md (market), competitor-analysis.md v3 (competitors), game-concept.md v6, game-design-document.md v1.2*
*All market claims cross-verified via live web research on September 14–15, 2026.*
*Key data: Poki 100M+ MAU, CrazyGames 50–60M MAU, 46% of online consumers play browser games, fighting game market $1.58B–$4.8B, HTML5 gaming market $6–8B, roguelite market $2.8–$4.8B, no dominant browser fighter exists, 90%+ stickman art, 62–81% mobile traffic, Poki Netlib v0.0.18 production-ready, 53% mobile devs planning browser ports within 12 months.*
