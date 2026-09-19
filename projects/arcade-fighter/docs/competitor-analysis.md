# Competitor Analysis

**Date:** September 15, 2026 (v3 — Consolidated, Project-Local Only)
**Project:** Battle Brawl — Browser Arcade Fighter (Phaser 3.90, TypeScript 5.9)
**Method:** Project-local files only (GDD v1.2, market-research.md v5, market-analysis-report.md, game-concept.md v6, step1-market-analysis-sep15-v2.md, package.json). No external web research.

---

## Game Concept Summary

**Battle Brawl** is a zero-download browser arcade fighter that combines the accessibility and instant gratification of Poki-style games with genuine fighting game depth. The game delivers 5–12 minute sessions of skill-expressive 1v1 combat through distinctive non-stickman characters, a roguelite progression loop, and mobile-first touch controls — all distributed on the world's largest gaming portals.

---

## Direct Competitors

| Name | Platform | Why Similar | Strength | Weakness |
|------|----------|-------------|----------|----------|
| **Stickman Kombat 2D** | CrazyGames (#2 fighting), Poki, 10+ portals | Browser 2D fighter with combos, stamina system, tower progression | Most polished visual feedback (camera shake, hit flashes, slow-mo, 60 FPS); 10+ portal distribution; "feeling first" design; actively maintained (Aug 2026) | Stickman art style (generic); no online multiplayer; no roguelite progression; no distinctive character designs |
| **Stick Fighter** | Poki (official), iOS/Android | 1P gauntlet mode + local 1v1 on Poki with character variety | 531K+ votes on Poki (2nd most-voted fighter); 4.6 rating; 6 unique characters with distinct movesets; mobile app versions | Flash-era heritage (dated presentation, last updated Mar 2024); no online multiplayer; basic visual presentation (no juice/particles); no roguelite; no cosmetic system |
| **Ragdoll Hit** | Poki + Google Play + App Store | Physics-based combat on Poki; highest engagement in fighting category | 591K+ votes on Poki (highest engagement); ragdoll physics is trending mechanic; cross-platform; weapon variety; boss fights; 4.5 rating | Ragdoll physics reduce skill-based depth; no combo system; no online multiplayer; generic stickman art; no roguelite; mobile has excessive ads |
| **Karate Fighter** | Poki, CrazyGames Unblocked | Fighting game on Poki with multiple modes and characters | #1 most-voted fighting game on Poki (971K+ votes); 3D graphics; multiple modes (Tournament, Arcade, VS, Training); multiple fighting styles | Lower rating (4.2 vs competitors' 4.6); no online multiplayer; 3D style may not appeal to retro/arcade audience; no roguelite; no combo depth |
| **Iron Snout** | Poki + Steam + Switch + PS/Xbox + Mobile | Browser fighter on Poki with arcade-style combat | Highest-rated fighting game on Poki (4.6); active since 2014; cross-platform; deep mastery curve; local 2P mode; proven retention | Not a traditional fighter (arcade survival, not 1v1 dueling); single character (pig only); no online multiplayer; no progression/unlock system |
| **DAWPUNCH** | Self-hosted (dawpunch.es) | Browser 2D fighter with online multiplayer and full-stack features | Most complete browser fighter — full-stack with accounts, shop, ranking, social; real-time online PvP via Colyseus; multiple characters/maps; cosmetic shop with Stripe | Spanish-language focused; not on portals (self-hosted only); no portal traffic; complex stack; no roguelite progression; no distinctive art |
| **Super Stick Hero** | Self-hosted (superstickhero.com) | Browser fighter with deep combat, roguelite elements, and progression | Deepest combo system (40+ moves/character); roguelite boons (pick 1 of 3); 3-phase boss AI; 18 stages; training mode; combat overhaul (hit-stop, screen shake) | No multiplayer (local or online); stickman art; not on portals (no discoverability); no monetization beyond ads; no IAP/cosmetic system |

### Feature Comparison Matrix

| Feature | Battle Brawl (Target) | Stickman Kombat 2D | Stick Fighter | Ragdoll Hit | Karate Fighter | Iron Snout | DAWPUNCH | Super Stick Hero |
|---------|----------------------|-------------------|---------------|-------------|----------------|------------|----------|-----------------|
| **Non-stickman art** | ✅ 8 distinctive fighters | ❌ Stickmen | ❌ Stickmen | ❌ Stickmen | ⚠️ 3D (dated) | ❌ Animal | ❌ Stickmen | ❌ Stickmen |
| **Online multiplayer** | ✅ Poki Netlib (Phase 2) | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Colyseus | ❌ |
| **Roguelite progression** | ✅ Gauntlet + upgrades | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ | ⚠️ Basic boons |
| **Mobile touch controls** | ✅ Virtual joystick + 48px | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ✅ | ⚠️ Desktop only | ❌ Desktop only |
| **Combo system** | ✅ Timing-based (8 frame) | ✅ Basic | ⚠️ Simple | ❌ | ❌ | ✅ Deep | ✅ Full | ✅ 40+ moves |
| **Visual juice** | ✅ Full package | ✅ Strong | ❌ Minimal | ⚠️ Physics-based | ⚠️ Basic | ⚠️ Basic | ⚠️ Basic | ✅ Added Aug 2026 |
| **Portal distribution** | ✅ Poki + CrazyGames | ✅ 10+ portals | ✅ Poki | ✅ Poki | ✅ Poki + CG | ✅ Poki | ❌ Self-hosted | ❌ Self-hosted |
| **Meta-progression** | ✅ XP, levels, 35 unlocks | ❌ | ❌ | ❌ | ❌ | ❌ | ✅ Accounts | ⚠️ Basic |

---

## Indirect Competitors

| Name | Platform | Relevance |
|------|----------|-----------|
| **PolyFighter** | PC (Steam EA Oct 2026) | Roguelike + fighter mashup validated at PAX East/West 2026 and EVO 2026; 40+ characters; Kotaku "favorite game at PAX East"; built for solo play — no online PvP; PC-only, no browser plans |
| **Shot One Fighters** | PC (Kickstarter funded, $221K raised) | Roguelite + fighter with FGC veteran Justin Wong collaboration; 370% of $60K goal; Day of the Devs selection; 100+ moves, 100+ artifacts; PC-only, no browser plans |
| **Garden Souls** | PC (Steam playtest Sep 2026) | Fighting-game cancel system in roguelite structure; developer Statera Studio previously nominated for TGA 2023 Best Fighting Game (Pocket Bravery); PC-only |
| **Street Fighter 6** | PS5/Xbox/PC | Sets industry standard for modern fighting games; proves accessibility features (modern controls, World Tour) expand audience; $2B+ franchise |
| **2XKO (Riot Games)** | PS5/Xbox/PC | Validates F2P + cosmetic monetization model at scale in fighting games; tag-team format influences design trends; tiered season passes ($10 Premium, $35 Ultra) |
| **Rivals of Aether II** | PC (Steam) | Proves indie fighters can compete at EVO (1,022 entrants, tripled from 363); free DLC fighter model; 79% positive reviews |
| **Grapplenauts** | Self-hosted | Phaser + Colyseus + Bun runtime; validates Phaser for real-time multiplayer browser fighters; io-style arena |
| **Gladihoppers** | Poki | Only game on Poki with online PvP — validates demand for online multiplayer on portals (not a traditional fighter) |
| **Magic Battleground** | Poki (official) | Ragdoll + elemental magic on Poki; 245K votes in 6 months; validates fast traction for new fighters on portals |
| **mITyFighter** | Open source (GitHub) | 17 playable fighters with story modes; proves Phaser 3 can handle massive character rosters; deterministic sim |
| **Stickman Fury** | Poki (official) | Released Jun 2026; 3.6 rating; 28K votes; new stickman competitor — our non-stickman art differentiation remains critical |
| **Ultimate Evolution** | CrazyGames | Released Jun 2026; new fighter on CrazyGames — validates portal demand for fighting games |

### Roguelite + Fighter Landscape (Strategic Context)

| Game | Platform | Status | Roguelite Depth | Online PvP | Browser? |
|------|----------|--------|----------------|------------|----------|
| **PolyFighter** | Steam | EA Oct 2026 | Deep (move-stealing, 40+ chars) | ❌ Solo only | ❌ PC only |
| **Shot One Fighters** | Steam | Coming Soon | Deep (100+ artifacts, boss acts) | ❌ | ❌ PC only |
| **Garden Souls** | Steam | Playtest Sep 2026 | Cancel system in roguelite | ❌ | ❌ PC only |
| **Super Stick Hero** | Self-hosted | Live | Basic (pick 1 of 3 boons) | ❌ | ⚠️ Self-hosted |
| **Battle Brawl** | Poki + CrazyGames | Target: Ship Fast | Medium (12 upgrades, meta-progression) | ✅ Phase 2 | ✅ Portal |

**Critical insight:** All validated roguelite + fighter games are PC-only (Steam). None exist on browser portals. First to browser = market leader in the roguelite fighter sub-genre.

---

## Differentiation Opportunities

### Highest Impact

- **Non-Stickman Art (HIGHEST IMPACT):** 90%+ of browser fighters use generic stickman art (Ragdoll Hit 591K votes, Stick Fighter 531K, Stickman Kombat 2D, Magic Battleground, Stickman Fury). Distinctive characters with memorable silhouettes will stand out on portal thumbnails, create brand recognition, appeal to the FGC audience, and justify higher ratings. Battle Brawl's 8 unique fighters (balanced, rushdown, grappler, zoner, glass cannon, defensive, trickster, all-rounder) cover classic fighting game archetypes. This is the single most impactful differentiator — portal thumbnails with distinctive art get higher click-through than stickman thumbnails.

- **Online Multiplayer on Portals via Poki Netlib (HIGH IMPACT):** Only ONE game on Poki offers online PvP (Gladihoppers — not a traditional fighter). DAWPUNCH proves full-stack online multiplayer works but is self-hosted with no portal traffic. Poki Netlib (@poki/netlib v0.0.18) enables P2P WebRTC multiplayer with zero server costs, lobby system, TURN fallback, and Phaser compatibility. First to bring online multiplayer to Poki/CrazyGames = massive competitive moat. The online multiplayer gap is the largest structural opportunity in browser fighting games.

- **Roguelite Progression on Portals (HIGH IMPACT):** No browser fighter on portals uses roguelite structure. Super Stick Hero has basic boons but is self-hosted only. The roguelite + fighter mashup is validated on PC by PolyFighter (PAX/EVO 2026), Shot One Fighters (Day of the Devs, Justin Wong), and Garden Souls (TGA nominee dev). Our run-based progression (3–5 fights with upgrade choices) fits Poki's 11–20 minute session benchmark and creates "one more try" engagement loops. The roguelite market itself is $4.8B (2025) growing at 10.3% CAGR to $11.6B by 2034 (Dataintelo).

- **Mobile-First Touch Controls (HIGH IMPACT):** 62–81% of browser game traffic is mobile. Most competitors treat touch as an afterthought (limited inputs, complex button chords that don't work on screens). Battle Brawl designs a virtual joystick + 48px touch targets from day one using phaser-virtual-joystick (Brawl Stars-inspired), ensuring full playability for the majority of the audience and Poki compliance.

### Medium-High Impact

- **Visual Juice / Game Feel (MEDIUM-HIGH IMPACT):** Stickman Kombat 2D sets the quality bar with camera shake, hit flashes, slow-motion finishers, and 60 FPS. Super Stick Hero recently added hit-stop and damage-scaled screen shake (Aug 2026). Battle Brawl's comprehensive juice package (hit flash, screen shake, hit-stop, particle burst, slow-motion KO, camera zoom, floating damage numbers, combo counter escalation) is essential for competitive ratings (target: >4.0/5).

### Medium Impact

- **Roguelite Depth Beyond Simple Boons (MEDIUM IMPACT):** Super Stick Hero's roguelite system (pick 1 of 3 boons per stage) is the current browser benchmark. Battle Brawl goes deeper with 12 power-up categories, meta-progression with XP/leveling (35 levels), character unlocks, coin economy for cosmetic shop, and build variety (Glass Cannon, Tank, Combo King, Balanced archetypes). This creates the "one more try" loop that drives retention and ad impressions.

- **Character Variety at Launch (MEDIUM IMPACT):** Stick Fighter has 6 characters, Karate Fighter has multiple styles, mITyFighter has 17. Battle Brawl's 4 starter characters + 4 unlockable characters (8 total) is competitive. Each character must feel mechanically distinct with unique archetypes, special moves, and stat profiles.

- **Session Design Optimized for Browser (MEDIUM IMPACT):** Battle Brawl targets 5–12 minute sessions with 60–90 second matches and 3–5 fights per gauntlet run, aligning with Poki's 11–20 minute benchmark and CrazyGames' 30-minute average. Most competitors don't explicitly design for browser session patterns.

### Lower Impact

- **Streamable / Content Creator Design (LOW-MEDIUM IMPACT):** None of the current browser fighters optimize for content creation. Fighting games are inherently streamable (1v1 clarity, dramatic comebacks). Adding replay systems, clip sharing, and spectator-friendly UI creates organic discovery on Twitch/YouTube.

---

## Feature Priorities

### MVP (Phase 1) — Ship Fast, Establish Portal Presence

| Priority | Feature | Why First | Addresses Competitor Gap |
|----------|---------|-----------|--------------------------|
| 1 | **Distinctive non-stickman character art (4 starters)** | #1 visual gap in market; 90%+ competitors use stickmen; portal thumbnail standing; brand identity; this is the single most impactful differentiator | All 7 direct competitors |
| 2 | **Touch controls (virtual joystick + 48px buttons)** | Mandatory for 62–81% mobile traffic; Poki requirement; most competitors fail here; must be designed from day one | Stickman Kombat 2D, Stick Fighter, Ragdoll Hit, Karate Fighter all have basic touch |
| 3 | **Visual juice (shake, flash, hit-stop, particles, slow-mo)** | Sets quality bar above Stickman Kombat 2D; drives 4.0+ ratings on portals; every hit must feel impactful | Matches Stickman Kombat 2D's quality, exceeds Stick Fighter/Ragdoll Hit |
| 4 | **Combo system with timing windows** | 8-frame timing window; basic chains, launch combos, special cancels; matches Super Stick Hero depth; differentiator from casual fighters | Exceeds Stick Fighter, Ragdoll Hit, Karate Fighter; matches DAWPUNCH, Super Stick Hero |
| 5 | **4+ distinct starter characters with unique mechanics** | Matches Stick Fighter's variety; avoids generic feel; archetypes: balanced (Rex), rushdown (Volt), grappler (Titan), zoner (Luna) | Matches Stick Fighter (6), competitive with mITyFighter (17) |
| 6 | **Roguelite gauntlet progression (3–5 fights + upgrades)** | Unique on portals; "one more try" loop; fits 5–15 min sessions; creates build variety with 12 power-ups | Only Super Stick Hero has basic roguelite; no portal fighter has this |
| 7 | **1P vs AI with 5 difficulty tiers** | Novice → Boss progression; adaptive AI decision tree; matches gauntlet structure; boss has unique phase-shift mechanics | Standard feature, but AI quality differentiates |
| 8 | **Local 2P mode** | Proven on Poki (Stick Fighter 531K votes, Stickman Kombat 2D); social/viral potential; low implementation cost | Matches Stick Fighter, Stickman Kombat 2D; exceeds most competitors |
| 9 | **3 distinct stages with parallax backgrounds** | Visual variety; ambient effects; stage-specific music; 3 parallax layers each; Neon Arena, Rooftop, Dojo | Standard, but quality execution differentiates |
| 10 | **Meta-progression (XP, levels, coin economy)** | 35 levels; unlock characters, titles, cosmetics; coin economy for shop; drives retention | No portal fighter has deep meta-progression |
| 11 | **Rewarded video ads + Poki SDK integration** | Primary monetization; $4–$8 net eCPM; 97% opt-in rate; Poki SDK commercialBreak() | Essential for portal distribution |
| 12 | **Poki + CrazyGames submission** | Portal distribution = 150M+ MAU combined; Poki's 50/50 rev share; CrazyGames 60% ads / 70% IAP; distribution = everything | Most competitors are on portals, but few combine both |
| 13 | **localStorage save system** | Progress persistence; Poki incognito mode compliant; try/catch fallback | Standard requirement |

### Phase 2 — Growth & Retention

| Priority | Feature | Strategic Value |
|----------|---------|-----------------|
| 14 | **Online multiplayer via Poki Netlib (P2P WebRTC)** | #1 differentiator; zero server costs; only Gladihoppers has this on Poki; first portal fighter with online PvP wins |
| 15 | **4 unlockable characters (Blaze, Frost, Shadow, Astra)** | Roster depth; each with unique archetypes and unlock conditions via leveling |
| 16 | **Cosmetic IAP store** | Revenue expansion; character skins, stage themes, victory poses, particle effects ($0.99–$4.99) |
| 17 | **Training mode** | Smart CPU teaches combos and adapts to skill; lowers barrier for new players; expands audience |
| 18 | **Daily/weekly challenges** | Retention driver; daily login bonuses (50 coins); unique modifiers; no browser fighter does this |

### Phase 3 — Scale & Monetization

| Priority | Feature | Strategic Value |
|----------|---------|-----------------|
| 19 | **Season pass / battle pass** | Recurring revenue + retention; $4–$5 monthly sweet spot (GG Strive, SF6); $10–$35 seasonal tiers (2XKO); free tier mandatory |
| 20 | **Spectator mode + replay system** | Content creator tool; organic Twitch/YouTube discovery; clip-worthy moments |
| 21 | **Cross-platform progression** | Cloud saves; unified account across portals |
| 22 | **Seasonal content cycles** | New stages, characters, events; live ops for long-term engagement |

---

## Competitive Threat Assessment

| Threat | Severity | Probability | Mitigation |
|--------|----------|-------------|------------|
| New Phaser fighter launches on Poki/CrazyGames | HIGH | MEDIUM | Ship fast; establish portal presence; build vote count and ratings |
| Stickman Kombat 2D adds online multiplayer | HIGH | LOW | Ship our online multiplayer first via Poki Netlib |
| 53% of mobile devs porting to browser (supply flood) | MEDIUM | HIGH | Ship before the wave; establish quality reputation early |
| Ragdoll physics trend overtakes skill-based fighters | MEDIUM | MEDIUM | Include ragdoll elements for accessibility while maintaining skill ceiling |
| PolyFighter or Shot One adds browser version | MEDIUM | LOW | Both are PC-only with no browser plans; first to browser = leader |
| AAA fighter goes F2P on web (2XKO model) | MEDIUM | LOW | Differentiate through browser-native accessibility and session design |
| Established mobile IPs arriving on web (SYBO, Fingersoft, Outfit7) | MEDIUM | MEDIUM | Ship before they arrive; focus on niche (fighting × roguelite) |

---

## Market Opportunity Summary

| Factor | Evidence | Implication |
|--------|----------|-------------|
| **No dominant browser fighter** | All top Poki fighters are stickmen with basic mechanics; no roguelite fighter on any portal | First to ship distinctive art + roguelite + online multiplayer = market leader |
| **Fighting games have massive Poki audience** | Karate Fighter: 971K votes; Ragdoll Hit: 591K; Stick Fighter: 531K | The audience exists and is engaged; quality games get rewarded |
| **Roguelite + fighter validated on PC** | PolyFighter (PAX/EVO 2026), Shot One Fighters (Day of the Devs, $221K Kickstarter), Garden Souls (TGA nominee) | Genre mashup works; first to browser captures the wave; all PC-only competitors |
| **Online multiplayer is the #1 gap** | Only Gladihoppers on Poki has online PvP (not a traditional fighter) | Massive opportunity for P2P multiplayer via Poki Netlib |
| **62–81% of traffic is mobile** | Multiple sources confirm mobile browser dominance | Touch-first design is mandatory, not optional |
| **Window is closing** | 53% of mobile devs plan browser ports in next 12 months | Ship fast, establish presence before supply flood |
| **Roguelite market booming** | $4.8B in 2025, 10.3% CAGR to $11.6B by 2034 (Dataintelo) | Genre tailwinds support our roguelite progression loop |
| **Browser gaming is mainstream** | 46% of online consumers played a browser game last month (Newzoo-Google 7,500 sample) | Addressable audience is massive and growing |
| **2D fighting games specifically growing** | $1.77B in 2025, 8.5% CAGR (Data Insights Reports) | Our 2D art direction aligns with fastest-growing sub-segment |
| **Mobile fighting games fastest-growing platform** | 10.2% CAGR, faster than console (6.8%) and PC (7.8%) | Mobile-first strategy is validated by market growth rates |
| **Free-to-play dominance** | F2P holds 61.5% of global gaming market ($180.6B in 2025, Straits Research) | F2P + cosmetics is the correct monetization model |
| **Adults 18+ drive fighting game revenue** | 54.2% of mobile fighting revenue despite being 38.7% of players; spend 2–3× more than teens (Dataintelo 2024) | Targeting 18–35 "Roguelite Grinder" and "Competitive Lite" segments as primary revenue drivers |
| **Battle pass sweet spot validated** | $4–$5/month (GG Strive, SF6); $10–$35 seasonal (2XKO); free tier mandatory in all 2026 fighters | Phase 3 battle pass pricing and structure validated |
| **Rewarded ads are premium inventory** | $6.98 US net eCPM (AppLixir); 97% opt-in; 93.8% completion; WebGL resists ad blockers | Monetization model is structurally sound |

---

*Analysis based on: GDD v1.2, Market Research v5, Market Analysis Report, Market Analysis v2, Game Concept v6, package.json (Phaser 3.90, TypeScript 5.9.3, Webpack 5). All information sourced from project-local files only. No external web research performed.*
*7 direct competitors, 12 indirect competitors, 8 differentiation opportunities, 22 prioritized features.*
