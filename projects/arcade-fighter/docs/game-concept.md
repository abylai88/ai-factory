# Game Concept: Battle Brawl

**Date:** September 14, 2026 (v6 — Final Concept, Post-Cross-Verification)
**Platform:** Phaser 3.90 (HTML5/WebGL) — Browser Distribution (Poki + CrazyGames)
**Genre:** Arcade Fighter × Roguelite
**Tech Stack:** TypeScript 5.9, Webpack 5, Phaser 3.90, Arcade Physics
**Sources:** Market Research v7 (945 lines), Competitor Analysis v2 (205 lines), GDD v1.1 (1,677 lines), Gameplay Mechanics v1.0 (1,230 lines)

---

## 1. Game Identity

### Title
**Battle Brawl** — An instant-play browser fighter with distinctive characters, roguelite runs, and mobile-first design.

### Elevator Pitch
> "Street Fighter meets Vampire Survivors — a zero-download browser fighter where you battle through a gauntlet of increasingly skilled opponents, collect run-only upgrades, and unlock new fighters in 5-minute sessions."

### Core Fantasy
> "I'm a rising champion fighting through a gauntlet of increasingly skilled opponents, discovering new fighters and mastering their unique abilities — all from my browser in under 10 minutes."

### Why This Game Exists Now (Market Thesis — Cross-Verified September 14, 2026)

Three converging market facts make this game viable:

1. **No dominant browser fighter exists.** All top Poki fighters (Ragdoll Hit 591K votes, Karate Fighter 971K votes, Stick Fighter 531K votes) use generic stickman art with basic mechanics. There is no quality-tier browser fighter with distinctive art, meaningful progression, or genuine depth. **Cross-verified:** Stickman Fury (Jun 2026, 28K votes) is the newest Poki fighter — still stickman, still basic.

2. **Roguelite + fighter is validated on PC.** PolyFighter (PAX/EVO 2026, Kotaku "favorite game at PAX East," Steam EA October 13, 2026), Shot One Fighters ($221,841 Kickstarter raised at 370% of goal, Justin Wong collaboration, Day of the Devs selection), and Garden Souls (Statera Studio, TGA 2023 nominee dev, Steam playtest September 2026) prove the mashup has audience demand. **None exist on browser.** All three are PC-only with no browser plans.

3. **The audience is massive and waiting.** Poki has 100M+ MAU, 153 employees (Tracxn August 2026, up from 65 FTE), 625M players visited in 2025, 1B+ gameplays/month. CrazyGames has 50M+ MAU, 300M+ monthly gameplays, ~$24.6M annual revenue (Tracxn). Karate Fighter proves fighting games scale on Poki (971K votes). 46% of online consumers ages 13–55 played a browser game last month (Newzoo-Google, 7,500 sample — the largest study on browser gaming ever conducted).

**Window:** 53% of mobile developers plan browser ports in the next 12 months (Poki 2026 study). Ship fast, establish portal presence, win.

---

## 2. Unique Selling Proposition (USP)

### Primary USP
**"The first browser fighter with real characters, roguelite runs, and mobile-first touch — play instantly, no download."**

### Three-Word Pitch
**Characters. Runs. Zero Download.**

### Differentiation Pillars

| Pillar | What Battle Brawl Does | What Competitors Do | Gap We Fill |
|---|---|---|---|
| **Distinctive Non-Stickman Characters** | 8 unique fighters with memorable silhouettes, distinct archetypes, unique mechanics | 90%+ of browser fighters use generic stickman art (Ragdoll Hit, Stick Fighter, Stickman Kombat 2D, Magic Battleground, Stickman Fury) | #1 visual differentiator; portal thumbnail standing; brand identity; FGC appeal |
| **Roguelite Gauntlet on Portals** | 3–5 fight runs with upgrade choices between rounds; run-only power-ups create build variety | No portal-distributed fighter uses roguelite. Super Stick Hero has basic boons but is self-hosted (no portal traffic) | "One more try" loop drives retention; fits 5–15 min browser sessions; unique in market |
| **Mobile-First Touch Controls** | Virtual joystick + 48px buttons designed from day one using phaser-virtual-joystick | All competitors treat touch as afterthought or have limited mobile support | 62–81% of browser traffic is mobile; Poki requires force-touch on tablets; most competitors fail here |
| **Instant Play (Zero Download)** | Works in any browser tab, < 3s load, < 10s to first fight | Core advantage vs. app stores; 58% of players choose web for frictionless access (Poki 2026 study) | Poki 100M+ MAU, CrazyGames 50M+ MAU exist because of this |
| **Portal Distribution** | Poki (100M+ MAU) + CrazyGames (50M+ MAU) = 150M+ MAU combined | DAWPUNCH proves multiplayer works but is self-hosted with zero portal traffic | Distribution = discoverability; first to portals = market leader |
| **Online PvP via Poki Netlib (Phase 2)** | P2P WebRTC multiplayer with zero server costs using @poki/netlib v0.0.18 (production-ready) | Only ONE game on Poki offers online PvP (Gladihoppers — not a traditional fighter) | First portal fighter with online PvP wins the competitive audience |

### Competitive Moat (Ranked by Durability)

| Rank | Moat | Durability | Why |
|---|---|---|---|
| 1 | **First-mover on portals** | HIGH | Poki/CrazyGames placement creates discoverability advantage; vote count and ratings compound |
| 2 | **Non-stickman art** | HIGH | Visual identity creates brand recognition; 90%+ competitors use stickmen; difficult to copy quality |
| 3 | **Online multiplayer via Poki Netlib** | HIGH (if shipped first) | P2P WebRTC with zero server costs; aligns with Poki platform direction; only ONE fighter has online PvP |
| 4 | **Roguelite structure** | MEDIUM | Unique in portal fighters; creates "one more try" loop; can be copied but execution matters |
| 5 | **Touch-first design** | MEDIUM | 62–81% mobile traffic demands this; competitors treat mobile as afterthought |

### Market Positioning Map

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

**Battle Brawl targets the sweet spot:** More depth than casual stickman fighters (combo system, roguelite upgrades, stamina management) but more accessible than hardcore competitive fighters (simplified controls, 5-minute sessions, auto-combos for basics).

---

## 3. Core Gameplay Loop

### The Three Loops

Battle Brawl operates on three interlocking loops that drive engagement, retention, and monetization:

### 3.1 Micro-Loop (Per Round — 60–90 seconds)

```
┌──────────────────────────────────────────────────────────────┐
│                    MICRO-LOOP: PER ROUND                      │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│   POSITION ──► ATTACK ──► REACT ──► COMBO ──► FINISH        │
│      ▲              │         │         │         │          │
│      │              ▼         ▼         ▼         ▼          │
│      │         Hit Flash  Block    Combo      Slow-Mo       │
│      │         Screen Shake       Counter    KO Zoom        │
│      │         Particles          Hit                        │
│      │              │                                      │
│      └──────────────┘                                      │
│          (continuous engagement)                             │
│                                                              │
│   Inputs: Direction + Light + Heavy + Block                  │
│   Feedback: Shake, flash, particles, sound, slow-mo          │
│   Duration: 60–90 seconds                                    │
└──────────────────────────────────────────────────────────────┘
```

**What happens in each round:**
1. Player positions their fighter (walk, jump, crouch, dash)
2. Attacks opponent with light/heavy/special moves
3. Reacts to opponent's attacks (block, counter, dodge)
4. Chains hits into combos for bonus damage and XP
5. Finishes opponent with a KO (slow-motion, camera zoom, particles)
6. Wins the round (best of 3 per match)

**Key feel:** Every hit must feel impactful. Visual juice (hit flash, screen shake, hit-stop, particles) is non-negotiable — this is what separates a quality browser fighter from stickman spam.

### 3.2 Meso-Loop (Per Gauntlet Run — 5–8 minutes)

```
┌──────────────────────────────────────────────────────────────┐
│              MESO-LOOP: GAUNTLET RUN                          │
├──────────────────────────────────────────────────────────────┤
│                                                              │
│  SELECT ──► FIGHT 1 ──► UPGRADE ──► FIGHT 2 ──► UPGRADE     │
│  FIGHTER    (Novice)    Choice      (Easy)      Choice      │
│     │                      │           │           │         │
│     │                      ▼           ▼           ▼         │
│     │                  Pick 1 of    Pick 1 of   Pick 1 of   │
│     │                  3 upgrades   3 upgrades  3 upgrades   │
│     │                      │           │           │         │
│     │                      ▼           ▼           ▼         │
│     │          ──► FIGHT 3 ──► UPGRADE ──► FIGHT 4 ──►      │
│     │              (Medium)    Choice      (Hard)            │
│     │                  │           │           │             │
│     │                  ▼           ▼           ▼             │
│     │              Pick 1 of    Pick 1 of                    │
│     │              3 upgrades   3 upgrades                   │
│     │                      │           │                     │
│     │                      ▼           ▼                     │
│     │              ──► FIGHT 5 (BOSS) ──► RESULTS            │
│     │                  "The Final Challenger"                │
│     │                      │                                 │
│     │                      ▼                                 │
│     │              ┌───────────────┐                         │
│     │              │  RUN COMPLETE │                         │
│     │              │  Score, XP,   │                         │
│     │              │  Coins, Unlock│                         │
│     │              └───────┬───────┘                         │
│     │                      │                                 │
│     │                      ▼                                 │
│     │              ┌───────────────┐                         │
│     └──────────────│  "ONE MORE    │                         │
│                    │   TRY" LOOP   │                         │
│                    └───────────────┘                         │
│                                                              │
│   Duration: 5–8 minutes per run                              │
│   Runs per session: 2–4                                      │
│   Session total: 10–20 minutes                               │
└──────────────────────────────────────────────────────────────┘
```

**What happens in each run:**
1. **Character Select:** Choose from unlocked fighters (4 starters, 4 unlockable)
2. **Fight 1 (Novice):** Easy opponent, learn controls, feel the juice
3. **Upgrade Choice:** Pick 1 of 3 random power-ups (run-only)
4. **Fight 2–4 (Easy → Hard):** Difficulty ramps, combos feel natural, upgrades compound
5. **Fight 5 (Boss):** Dramatic music, unique boss mechanics (phase shifts at 66% and 33% HP), tension peaks
6. **Results:** Score, XP earned, coins earned, potential unlocks
7. **"One More Try":** Player starts new run with unlocked content

**Key design decisions:**
- **3–5 fights per run** = one browser session (Poki benchmark: 11–20 min)
- **Upgrades are run-only** — resets every run keep runs fresh and encourage experimentation
- **Upgrade variety (12+ power-ups)** — damage, speed, health, stamina, combo extension, perfect block, counter, heal, movement, synergy builds
- **Boss has unique mechanics** — phase shifts at 66% and 33% HP, not just a stat bump

### 3.3 Meta-Loop (Across Runs — Ongoing)

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
│                                                              │
│   Duration: Ongoing (permanent account progression)          │
└──────────────────────────────────────────────────────────────┘
```

**What persists across runs:**
- **XP & Levels:** 35 levels; each level unlocks a fighter, title, or cosmetic
- **Coins:** Earned per fight, spent in cosmetic shop (skins, effects, stages)
- **Character Unlocks:** 4 starters → unlock 4 more through gameplay achievements
- **High Scores:** Best run score per character; leaderboard drive
- **Daily Challenges:** Unique modifiers each day (e.g., "All Criticals", "Double Speed")

### Loop Interaction Diagram

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

---

## 4. Target Player Experience

### 4.1 Session Design

| Metric | Target | Rationale |
|---|---|---|
| **Session Length** | 5–12 minutes | Matches Poki success benchmark (11–20 min); CrazyGames avg is 30 min |
| **Match Length** | 60–90 seconds per round | Quick, intense, satisfying; 64% of mobile fighting game matches last < 10 min |
| **Rounds per Match** | Best of 3 | Standard fighting game format; 3–5 min per full match |
| **Fights per Run** | 3–5 (Gauntlet) | Full run = one browser session |
| **Time to First Fun** | < 10 seconds | No tutorial walls; learn by doing (Poki requirement: streamlined entry) |
| **Matches per Session** | 2–4 | Run → result → "one more try" → run again |

### 4.2 Player Journey (First 10 Minutes)

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

### 4.3 Emotional Arc

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

### 4.4 "One More Try" Hooks

| Hook | Trigger | Psychological Driver | Frequency |
|---|---|---|---|
| **Upgrade Combo** | "I almost had the combo I wanted next fight..." | Near-miss motivation | Every run |
| **New Character** | "I'm 200 XP from unlocking Blaze..." | Completionism | Every 3–5 runs |
| **Daily Challenge** | "Today's modifier is 'All Criticals' — that sounds fun!" | Novelty-seeking | Daily |
| **Score Chase** | "My best run was 4 fights — I want 5" | Mastery drive | Every run |
| **Boss Revenge** | "That boss destroyed me — I know how to beat it now" | Competence seeking | Every boss encounter |
| **Cosmetic Desire** | "That Neon Rex skin looks amazing..." | Collection impulse | Ongoing |

### 4.5 Target Player Profiles

| Profile | Age | Session | Priority Features | Revenue | % of Audience |
|---|---|---|---|---|---|
| **Casual Browser** | 16–25 | 5–8 min | Quick Match, touch controls, visual juice | Low (ad-only) | ~50% |
| **Roguelite Grinder** | 20–35 | 10–15 min | Gauntlet, upgrades, unlockables, score chase | Medium (ads + cosmetics) | ~30% |
| **Competitive Lite** | 18–30 | 15–20 min | Local 2P, combos, characters, online PvP (Phase 2) | High (ads + IAP) | ~15% |
| **Content Creator** | 18–35 | Variable | Spectator mode, clip-worthy moments, replay | High (drives organic traffic) | ~5% |

---

## 5. Key Features

### 5.1 MVP Features (Phase 1 — Ship in 8–10 weeks)

| # | Feature | Why It's Critical | Competitive Evidence |
|---|---|---|---|
| **F1** | **Distinctive Non-Stickman Characters (4 starters)** | #1 visual differentiator; 90%+ competitors use stickmen; portal thumbnails; brand identity | Karate Fighter (3D, 971K votes) proves quality art gets votes; stickman fighters rate 4.2–4.6 |
| **F2** | **Mobile-First Touch Controls** | 62–81% of traffic is mobile; Poki requires force-touch on tablets; most competitors fail here | phaser-virtual-joystick (Brawl Stars-inspired) provides proven touch UX |
| **F3** | **Visual Juice (shake, flash, particles, slow-mo)** | Sets quality bar above Stickman Kombat 2D; drives 4.0+ ratings; every hit feels impactful | Stickman Kombat 2D sets bar (camera shake, hit flash, slow-mo); Super Stick Hero added hit-stop (Aug 2026) |
| **F4** | **Combo System (timing-based confirms)** | Depth beyond button mashing; 8-frame timing window; basic chains + special cancels | Super Stick Hero (40+ moves); DAWPUNCH (full combo system); validates depth in browser fighters |
| **F5** | **Roguelite Gauntlet (3–5 fights + upgrades)** | Unique on portals; "one more try" loop; fits 5–15 min sessions; creates build variety | Validated by PolyFighter (PAX/EVO 2026), Shot One Fighters (Justin Wong), Garden Souls (TGA nominee) |
| **F6** | **Local 2-Player Mode** | Social/viral potential; low implementation cost; proven on Poki (Stick Fighter, Stickman Kombat 2D) | Stick Fighter has 531K votes partly due to local 2P; social sharing drives discovery |
| **F7** | **AI Opponent (5 difficulty tiers)** | Novice → Boss progression; adaptive AI; matches gauntlet structure | Stickman Kombat 2D tower progression; Super Stick Hero 3-phase boss AI |
| **F8** | **XP/Leveling + Coin Economy** | Meta-progression drives retention; 35 levels; unlock fighters through gameplay | Standard F2P retention mechanic; Poki COO confirms 11–20 min sessions require progression hooks |
| **F9** | **Rewarded Video Ads** | Primary monetization; $4–$8 net eCPM; 97% opt-in rate | AppLixir 2026: US web rewarded eCPM $6.98; completion rate 93.8% |
| **F10** | **Poki + CrazyGames Submission** | Portal distribution = 150M+ MAU combined; 50/50 (Poki) and 60/70 (CG) revenue share | Poki COO confirms fighting games are sought; 227 games finalized in 2025 from thousands reviewed |
| **F11** | **3 Distinct Stages** | Visual variety; parallax backgrounds; ambient effects; stage-specific music | Stickman Kombat 2D has multiple stages; visual variety keeps runs fresh |
| **F12** | **localStorage Save System** | Progress persistence; Poki incognito mode compliant; try/catch fallback | Poki requirement; essential for meta-progression to function |

### 5.2 Phase 2 Features (Growth — 4–6 weeks post-MVP)

| # | Feature | Why It Matters | Competitive Evidence |
|---|---|---|---|
| **F13** | **Online Multiplayer (Poki Netlib P2P)** | #1 differentiator; zero server costs; only ONE fighter on Poki has online PvP | Gladihoppers is the only online PvP game on Poki (not a fighter); Poki Netlib v0.0.18 in production |
| **F14** | **4 Unlockable Characters** | Roster depth; each with unique archetypes and mechanics | Stick Fighter has 6 characters; mITyFighter has 17; 8 total competitive |
| **F15** | **Cosmetic IAP Store** | Revenue expansion; skins, effects, stages ($0.99–$4.99) | DAWPUNCH validates cosmetic shop; 2XKO proves F2P + cosmetics in fighters |
| **F16** | **Daily/Weekly Challenges** | Retention driver; daily login bonuses; unique modifiers | Standard live-ops mechanic; no browser fighter does this |
| **F17** | **Training Mode** | Smart CPU teaches combos; adapts to skill; lowers barrier for new players | Super Stick Hero has training mode; accessibility expands audience |

### 5.3 Phase 3 Features (Scale — 4–6 weeks post-Phase 2)

| # | Feature | Why It Matters |
|---|---|---|
| **F18** | **Season Pass / Battle Pass** | Recurring revenue + retention; regular character drops every 1–3 months |
| **F19** | **Spectator Mode + Replay System** | Content creator tool; organic Twitch/YouTube discovery |
| **F20** | **Clip Sharing** | Social viral loop; browser-native sharing to social media |
| **F21** | **Seasonal Content Cycles** | New stages, characters, events; live ops for long-term engagement |

### 5.4 Feature Priority Matrix

| Priority | Feature | MVP? | Competitive Impact | Effort | Rationale |
|---|---|---|---|---|---|
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

## 6. Characters

### Design Philosophy
- **Distinct silhouettes** — recognizable at thumbnail size (critical for Poki thumbnails)
- **Unique mechanics** — each fighter feels different to play
- **Not stickmen** — memorable, stylized character designs (90%+ of competitors use stickmen)
- **Archetypes** — cover classic fighting game roles (rushdown, zoner, grappler, etc.)

### Starter Roster (MVP — 4 Characters)

| # | Name | Archetype | HP | Speed | Special Move | Visual Theme |
|---|---|---|---|---|---|---|
| 1 | **Rex** | Balanced | 100 | 200px/s | Power Strike (25 dmg shockwave) | Red/orange, boxer gloves, athletic |
| 2 | **Volt** | Rushdown | 85 | 250px/s | Lightning Dash (20 dmg, passes through) | Blue/electric, spiky hair, lightning |
| 3 | **Titan** | Grappler | 120 | 160px/s | Earth Slam (30 dmg ground pound) | Green/stone, large build, earth |
| 4 | **Luna** | Zoner | 90 | 190px/s | Lunar Beam (22 dmg full-screen projectile) | Purple/lunar, staff weapon, moon |

### Unlockable Roster (Phase 2)

| # | Name | Archetype | Unlock Method |
|---|---|---|---|
| 5 | **Blaze** | Glass Cannon | Reach Level 5 |
| 6 | **Frost** | Defensive | Reach Level 10 |
| 7 | **Shadow** | Trickster | Reach Level 20 |
| 8 | **Astra** | All-Rounder+ | Reach Level 30 |

### Character Stat Comparison

```
HEALTH:
Rex    ████████████ 100
Volt   █████████    85
Titan  ████████████▓ 120
Luna   █████████    90

SPEED:
Rex    ██████████ 200px/s
Volt   ████████████▓ 250px/s
Titan  ████████ 160px/s
Luna   █████████▌ 190px/s

POWER (Heavy Dmg):
Rex    ████████ 15
Volt   ███████ 13
Titan  ██████████ 20
Luna   ██████ 12
```

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

## 7. Combat System Overview

### Controls

**Desktop (Keyboard):**
| Action | Player 1 | Player 2 |
|---|---|---|
| Move | A/D | ←/→ |
| Jump | W | ↑ |
| Crouch | S | ↓ |
| Light Attack | J | Numpad 1 |
| Heavy Attack | K | Numpad 2 |
| Block | L | Numpad 3 |
| Special | Space | Numpad 0 |

**Mobile (Touch):**
```
┌──────────────────────────────────────┐
│  [P1 HP/SP]            [P2 HP/SP]   │
│                                      │
│                                      │
│                                      │
│  ┌────────────┐      ┌────┬────┐    │
│  │  ← │ →    │      │  A │  B │    │
│  │    ↑      │      ├────┴────┤    │
│  │  JUMP     │      │ BLOCK   │    │
│  └────────────┘      └─────────┘    │
└──────────────────────────────────────┘
```

- Joystick: Left 50% of screen, 64px base radius
- Buttons: Right 50% of screen, 48px minimum (Apple HIG)
- Auto-detect touch devices; force on tablets (Poki requirement)

### Combat Mechanics (Summary)

| Mechanic | Detail |
|---|---|
| **Health** | 100 HP per character (varies by archetype) |
| **Stamina** | 100 SP; regenerates 8/sec; consumed by heavy, specials, blocks |
| **Light Attack** | 5–8 dmg, 6-frame startup, 0 SP cost |
| **Heavy Attack** | 12–18 dmg, 12-frame startup, 15 SP cost |
| **Special** | 20–30 dmg, varies, 30–50 SP cost; character-specific |
| **Throw** | 15 dmg, 10-frame startup, unblockable, 20 SP cost |
| **Perfect Block** | Block within 4 frames = 10 SP refund + advantage |
| **Guard Break** | 0 SP = 30-frame stagger; cannot block |
| **Combo Timing** | 8-frame window (133ms) for true combos |
| **Rounds** | Best of 3 per match |

### Visual Juice (Non-Negotiable)

| Effect | Trigger | Implementation |
|---|---|---|
| Hit Flash | Any attack connects | White flash, 2 frames |
| Screen Shake | Heavy hit / special | 4–8px, 200ms, exponential decay |
| Hit Stop | Any attack connects | 2–4 frame freeze |
| Particle Burst | Hit connects | 8–12 particles in hit direction |
| Slow Motion | KO / last-hit finish | 0.5s at 0.3× speed |
| Camera Zoom | Special move | 1.1× zoom for 300ms |
| Floating Damage | Damage dealt | Rises 60px, fades over 500ms |
| Combo Counter | 3+ hit combo | Animated number; color escalates |

---

## 8. Roguelite Upgrade System

### Upgrade Pool (12 Power-Ups)

After each fight win, pick 1 of 3 randomly selected upgrades. Upgrades last for the current run only.

| Category | Upgrade | Effect | Rarity |
|---|---|---|---|
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
|---|---|---|
| **Glass Cannon** | Power Strike + Berserker + Thundergod | Maximum damage, minimum defense |
| **Tank** | Iron Body + Tough Skin + Auto-Heal | Survive everything, chip away |
| **Combo King** | Combo Master + Quick Feet + Punisher | Hit-confirm everything, counter-focused |
| **Balanced** | Power Strike + Iron Body + Second Wind | Solid all-around |

---

## 9. Monetization Strategy

### MVP Monetization

| Method | Placement | Revenue Target |
|---|---|---|
| **Rewarded Video** | "Double coins" after run; "Continue" after defeat; "Try locked fighter" | Primary ($4–$8 net eCPM) |
| **Interstitial** | Between runs (natural break) | Secondary |
| **Portal Ad Revenue** | Standard portal share (Poki 50%, CG 60%) | Base revenue |

### Revenue Benchmarks (September 2026 Cross-Verified)

| Metric | Value | Source |
|---|---|---|
| US Web Rewarded eCPM (net) | $4–$8 | AppLixir mid-year 2026 |
| Gross US Web eCPM | $15–$28 | Cinevva 2026, Playgama 2026 |
| Opt-in Rate | 97% | AppLixir 2026 |
| Completion Rate | 93.8% global, 95.4% tier-1 | AppLixir 2026 |
| Fill Rate | 95.1% | AppLixir 2026 |
| ARPDAU Target (Casual) | $0.08–$0.15 | Action/arcade benchmark |
| Poki Top Studios | Up to €1M/year | Poki COO (Jul 2026) |
| Median Portal Games | $200–$2,000/month | Cinevva 2026 |
| CrazyGames Revenue | ~$24.6M annual | Tracxn (2026) |

### Revenue Projections

| Phase | DAU | Monthly Revenue |
|---|---|---|
| Phase 1 (MVP) | 1K–20K | $148–$3,920 |
| Phase 2 (Growth) | 5K–50K | $2,360–$109,800 |
| Phase 3 (Scale) | 20K–100K | $10,000–$250,000+ |

---

## 10. Distribution Strategy

### Primary: Poki (100M+ MAU)

| Aspect | Detail |
|---|---|
| Revenue Share | 50/50 (Poki traffic); 100% (own traffic) |
| Approval | Rigorous, multi-stage; 227 games finalized in 2025 |
| Requirements | ≤8MB initial load; 16:9; desktop+mobile+tablet; SDK events |
| Exclusivity | Preferred (web exclusive, 5-year term); non-exclusive available |
| Employee Count | 153 (Tracxn August 2026, up from 65 FTE) |
| Self-funded | Never took outside investment (Yahoo Finance Mar 2026) |

### Secondary: CrazyGames (50M+ MAU)

| Aspect | Detail |
|---|---|
| Revenue Share | 60% ads / 70% IAP |
| Approval | QA review (1–2 days); faster than Poki |
| Requirements | ≤50MB total; ≤1,500 files; SDK at launch |
| Exclusivity | Not required |
| Revenue | ~$24.6M annual (Tracxn) |
| Games in Catalog | 4,000+ |

### Community: itch.io

| Aspect | Detail |
|---|---|
| Revenue Share | 90%+ to developer |
| Purpose | Community building, direct sales, feedback, wishlist |

---

## 11. Success Metrics

### MVP KPIs

| Metric | Target | Rationale |
|---|---|---|
| Average Session Length | 8–12 minutes | Poki benchmark: 11–20 min |
| Retention D1 | > 30% | Industry average for casual browser games |
| Retention D7 | > 10% | Above average for F2P casual |
| Matches per Session | 3–5 | Enough for satisfaction, not fatigue |
| Portal Rating | > 4.0/5 | Poki/CrazyGames quality threshold |
| Revenue per DAU | $0.05–$0.15 | Based on ad eCPM benchmarks |
| Gauntlet Completion Rate | > 40% | Run should be challenging but finishable |

### Phase 2 KPIs

| Metric | Target |
|---|---|
| Online PvP Match Completion | > 60% |
| IAP Conversion Rate | 2–5% of DAU |
| Monthly Revenue | $2,000–$10,000 (mid-tier) |

---

## 12. Risk Assessment (Updated September 14, 2026)

| Risk | Severity | Probability | Mitigation |
|---|---|---|---|
| No dominant browser fighter exists | OPPORTUNITY | CONFIRMED | Ship fast; first-mover advantage |
| Touch controls feel imprecise | HIGH | MEDIUM | Design touch-first; Brawl Stars joystick reference; playtest extensively |
| Asset size exceeds 8MB Poki limit | MEDIUM | MEDIUM | Target 7.65MB; aggressive atlas packing; WebP; lazy-load music; measure weekly |
| AI feels too easy or hard | MEDIUM | HIGH | Tuning passes after each milestone; A/B test difficulty curves |
| New Phaser fighter launches before us | HIGH | MEDIUM | Ship fast; prioritize MVP; establish portal presence early |
| Roguelite doesn't fit browser sessions | LOW | LOW | Validated by PolyFighter, Shot One, Garden Souls (2026); all PC-only, none on browser |
| Ad blockers reduce revenue | MEDIUM | MEDIUM | Game works without ads; non-intrusive; WebGL canvas ads resist blockers |
| eCPM volatility (Q4 highs, Q1 troughs) | MEDIUM | MEDIUM | Plan on 12-month rolling average, not spot figures |
| Phaser 4 migration needed | LOW | LOW | "Few hours of work" for standard API; stay on 3.90 for MVP; migrate in Phase 2 if needed |
| Poki Netlib still beta | MEDIUM | MEDIUM | Design abstraction layer for networking; actively used in production |
| 53% mobile devs porting to browser | HIGH | HIGH | Ship before supply flood; establish quality reputation early |
| Stickman dominance continues | MEDIUM | MEDIUM | Non-stickman art is #1 differentiator; reinforce through marketing |

---

## 13. Development Phases

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

### Phase 2: Growth (4–6 weeks)
- Online multiplayer (Poki Netlib P2P)
- Ranked PvP with matchmaking
- 4 unlockable characters
- Cosmetic IAP store
- Daily/weekly challenges
- Training mode

### Phase 3: Scale (4–6 weeks)
- Season Pass / Battle Pass
- Spectator mode + replay system
- Clip sharing
- Seasonal content cycles

---

*Game Concept v6 — September 14, 2026*
*Based on: Market Research v7 (945 lines), Competitor Analysis v2 (205 lines), GDD v1.1 (1,677 lines), Gameplay Mechanics v1.0 (1,230 lines)*
*All market claims cross-verified via live web research on September 14, 2026.*
*Key verified data: Poki 100M+ MAU (153 employees), CrazyGames 50M+ MAU (~$24.6M revenue), fighting game market $1.75–$4.8B, roguelite market $2.8–$4.8B, 46% of online consumers play browser games monthly (Newzoo-Google 7,500 sample), Poki Netlib v0.0.18 production-ready.*
