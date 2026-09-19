# Step 4: Game Design Document — Battle Brawl

**Date:** September 15, 2026
**Status:** Complete — GDD v1.3 produced (updated from v1.2)
**Artifact:** `docs/game-design-document.md` (v1.3, ~1,790 lines)

---

## 1. What Was Done

Reviewed and updated the authoritative GDD from v1.2 to v1.3 with the following improvements:

### 1.1 Market Context Enhancement (§10.8)
- **Expanded** market context section from single table to 5 sub-sections: Core Market Sizing, Platform Data, Demographics & Behavior, Monetization Benchmarks, Season Pass Benchmarks
- **Added** fresh verified data from post-analysis web research:
  - Mobile fighting game market: $4.31B (2025), 9.2% CAGR (Dataintelo)
  - 2D fighting games: $1.77B (2025), 8.5% CAGR (Data Insights Reports)
  - Browser games market: $8.01B (2026, TBRC)
  - Adults 18+ generate 54.2% of fighting game revenue despite being 38.7% of players
  - F2P share: 61.5% of global market (Straits Research)
- **Added** Season Pass benchmarks from 2026 fighting games (2XKO, Guilty Gear Strive, Street Fighter 6) — $4–$5 sweet spot for battle passes, free tier mandatory
- **Added** Phaser engine positioning data — dominant 2D browser framework, proven by Stickforge (4M+ players), Grapplenauts, DAWPUNCH
- **Added** verification column to all tables for traceability

### 1.2 Version & Changelog
- Updated version from 1.2 → 1.3
- Added v1.2 → v1.3 changelog entry

---

## 2. Verification Against Requirements

The GDD v1.3 satisfies all step requirements:

| Requirement | Section | Status | Lines |
|---|---|---|---|
| **Vision & Identity** | §1 Vision Statement, Core Pillars, Target Metrics | ✅ Complete | 66–93 |
| **Core Mechanics** | §2 Combat Fundamentals, Visual Feedback, AI, Fighter FSM, Edge Cases | ✅ Complete | 96–283 |
| **Systems** | §3 Input Manager, Touch Controls, Camera, Stage System | ✅ Complete | 286–393 |
| **Progression** | §4 Gauntlet Run, Meta-Progression, High Scores | ✅ Complete | 395–486 |
| **UX Flow** | §5 User Journey Map, Screen Specs, Transitions | ✅ Complete | 488–661 |
| **Content Structure** | §6 Asset Manifest, Budget, Naming Convention | ✅ Complete | 664–778 |
| **Phaser Scene Architecture** | §7 Scene Registry, Flow, Responsibilities, Implementation, Systems, Communication, Config, Physics, Network | ✅ Complete | 782–1316 |
| **Production Priorities** | §8 MoSCoW, Timeline, Risk Register | ✅ Complete | 1319–1410 |
| **Acceptance Criteria** | §9 Feature AC, Build QA, Poki Checklist | ✅ Complete | 1414–1530 |
| **Appendix** | §10 Character Stats, Upgrades, XP, Balance, Analytics, Accessibility, Compliance, Market Context | ✅ Complete | 1533–1790 |

---

## 3. Phaser Scene Architecture Summary

The game uses **12 Phaser scenes** organized into **4 layers**:

```
Layer 1 (Bootstrap):    Boot → Preloader
Layer 2 (UI/Menu):      MainMenu, CharacterSelect, Settings, Shop
Layer 3 (Gameplay):     Game, FightOverlay (parallel), PauseMenu (parallel)
Layer 4 (Results):      UpgradeSelect, Results, LevelUp
```

**Key architectural decisions (v1.3):**
1. **Scene Isolation:** Each screen is a separate Phaser.Scene; no cross-scene state leakage
2. **System Composition:** 8 systems (Input, Combat, AI, Camera, Round, Combo, Particle, Audio) are plain TypeScript classes composed into GameScene
3. **EventBus Pattern:** Singleton EventEmitter for cross-scene pub/sub (damage, KO, combo events)
4. **Data-Driven Design:** All balance numbers in `data/` modules; tuning without code changes
5. **Parallel Scenes:** FightOverlay runs as a parallel scene on top of Game for HUD without cluttering gameplay code
6. **Physics:** Arcade Physics sufficient for hitbox/hurtbox collision; gravity 800px/s²; 800×400 play area
7. **Network (Phase 2):** Poki Netlib P2P WebRTC with deterministic lockstep, zero server costs, TURN relay fallback

---

## 4. Document Structure

### Total: ~1,790 lines across 10 sections + 8 subsections

| Section | Lines | Content |
|---|---|---|
| §1 Vision & Identity | ~28 | Vision statement, 5 core pillars, 7 target metrics with benchmarks |
| §2 Core Mechanics | ~188 | Combat (HP/SP, attacks, combos, blocking, movement), Visual Juice (9 effects), AI (5 tiers, decision tree), FSM (9 states, transitions, guards), Edge Cases (9 scenarios) |
| §3 Systems | ~110 | Unified Input Manager (12 actions, 3 devices), Touch Controls (48px targets), Camera (6 behaviors), Stage System (3 MVP stages) |
| §4 Progression | ~92 | Gauntlet (5 fights + upgrades), Meta-Progression (35 levels, XP curve, coins), High Scores (7 score sources) |
| §5 UX Flow | ~174 | 8-step user journey, 4 screen wireframes (ASCII), 7 transitions |
| §6 Content Structure | ~115 | Asset manifest (7.65MB budget), file naming convention |
| §7 Phaser Architecture | ~535 | 12 scenes, flow diagram, responsibilities, implementation code, 8 systems, EventBus, config factory, physics config, Poki Netlib network architecture |
| §8 Production Priorities | ~92 | MoSCoW (20 MUST, 7 SHOULD, 6 COULD, 4 WON'T), 12-week timeline, 10 risks |
| §9 Acceptance Criteria | ~120 | 12 feature checklists, 11 QA gates, 13-item Poki submission checklist |
| §10 Appendix | ~310 | 4 character stat tables, 12 upgrades, XP curve, balance numbers, analytics (12 events, 6 funnels), 8 accessibility features, 16-item compliance matrix, market context (5 sub-sections with verification) |

---

## 5. Supporting Documents

| Document | Lines | Purpose | Status |
|---|---|---|---|
| `market-analysis-report.md` | 323 | Sep 15 market data with live web verification | ✅ Current |
| `step1-market-analysis-sep15-v2.md` | 370+ | Fresh market research with post-analysis verification | ✅ Current |
| `competitor-analysis.md` | 180+ | 15+ competitor analysis with feature matrix | ✅ Current |
| `game-concept.md` (v6) | 727 | Market-validated concept with USP, loops, features | ✅ Current |
| `gameplay-mechanics.md` (v1.0) | 1,402 | Detailed physics, frame data, tuning, feedback | ✅ Current |
| `technical-architecture.md` (v2.0) | 1,013 | Module structure, state management, data flows | ✅ Current |
| `technical-design.md` (v1.0) | 917 | File manifest, implementation increments | ✅ Current |

**Total project documentation:** ~7,500+ lines across 8+ documents.

---

## 6. Implementation Readiness

| Criterion | Status | Notes |
|---|---|---|
| All mechanics specified | ✅ | Frame data, hitbox sizes, formulas — all in GDD + gameplay-mechanics.md |
| All systems designed | ✅ | 8 systems with interfaces and dependencies documented |
| All scenes defined | ✅ | 12 scenes with responsibilities, transitions, and code examples |
| All data structures defined | ✅ | TypeScript interfaces for Fighter, Move, Upgrade, SaveData, etc. |
| All acceptance criteria defined | ✅ | Per-feature, per-increment, and per-platform criteria |
| Build pipeline specified | ✅ | Webpack config, asset pipeline, optimization strategy |
| Risk register complete | ✅ | 10 risks with severity, probability, mitigation, owner |
| Platform compliance verified | ✅ | Poki + CrazyGames requirements matrix with status |
| Network architecture finalized | ✅ | Poki Netlib P2P with deterministic lockstep; Colyseus fallback |
| Market context validated | ✅ | Fresh Sep 15 data with source verification |

**The GDD is implementation-ready.** No gaps or missing specifications were found.

---

## 7. Conclusion

The `docs/game-design-document.md` v1.3 (~1,790 lines) is the authoritative GDD for Battle Brawl. It comprehensively covers:

1. ✅ **Vision:** Clear market position, 5 core pillars, target metrics with Sep 2026 benchmarks
2. ✅ **Mechanics:** Complete combat system with frame data, state machine, edge cases
3. ✅ **Systems:** Input abstraction, touch controls, camera, stages
4. ✅ **Progression:** Roguelite runs, meta-progression, XP/coin economy
5. ✅ **UX Flow:** Full user journey, screen specs, transition animations
6. ✅ **Content:** Asset manifest, budget (7.65MB ≤ 8MB), naming conventions
7. ✅ **Phaser Architecture:** 12 scenes, 8 systems, EventBus, config factory
8. ✅ **Network:** Poki Netlib P2P WebRTC (zero server costs), deterministic lockstep, Colyseus fallback
9. ✅ **Production:** MoSCoW priorities, 12-week timeline, 10 risks
10. ✅ **Acceptance Criteria:** Feature AC, build QA, Poki submission checklist
11. ✅ **Market Context:** Sep 2026 cross-verified data with 5 sub-sections, source verification, competitive landscape, season pass benchmarks

**Key v1.3 improvement:** Enhanced market context with fresh post-analysis verification data — mobile fighting market sizing ($4.31B, 9.2% CAGR), 2D fighting market ($1.77B, 8.5% CAGR), season pass benchmarks from 2026 fighting games ($4–$5 sweet spot), adult demographics spending data (54.2% revenue share), and Phaser engine positioning.

**Key v1.2 improvement:** Network architecture aligned with game concept (Poki Netlib over Colyseus), reducing Phase 2 online multiplayer effort from 20 to 15 days while eliminating server costs.
