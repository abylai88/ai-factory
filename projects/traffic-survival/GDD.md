# Game Design Document: Анекдоты — Угадай Концовку

**Version:** 1.0
**Date:** 2026-09-13
**Platform:** Yandex Games (Web, Phaser 3 + TypeScript)
**Resolution:** 2400×1080 (20:9 landscape)

---

## 1. Vision

### 1.1 Concept Summary

**"Анекдоты — Угадай Концовку"** — текстовый квиз на Yandex Games, где игроки угадывают правильную концовку анекдотов из 4 вариантов. Чёрный юмор, 18+, экономика монет, ежедневные бонусы, достижения и rewarded ads.

### 1.2 Target Metrics

| Метрика | MVP | 3 мес | 6 мес |
|---------|-----|-------|-------|
| DAU | 5,000 | 20,000 | 50,000 |
| D1 Retention | 30% | 35% | 40% |
| D7 Retention | 10% | 15% | 20% |
| Avg Session | 5 min | 8 min | 12 min |
| Revenue | $100/mo | $500/mo | $2,000/mo |

### 1.3 Platform Constraints

- Yandex Games SDK (`ysdk`) only
- Landscape-only (2400×1080), `checkOrientation: false`
- Web, no install required
- Yandex moderation removes thin-content apps — gameplay integration is survival requirement
- 40% international traffic (currently Russian-only)

---

## 2. Core Mechanics

### 2.1 Primary Loop

```
[Показ начала анекдота] → [4 варианта концовки] → [Выбор игрока] → [Результат]
                                                                    ↓
                                                              [Начисление монет]
                                                                    ↓
                                                              [Следующий анекдот / Interstitial]
```

**Flow per joke:**
1. Player sees joke setup (2-3 sentences)
2. 4 answer options appear (1 correct, 3 distractors)
3. Player taps one option
4. Correct → green highlight, +10 coins, punchline revealed with animation
5. Incorrect → red highlight, correct shown in green, 0 coins, full joke revealed
6. After every 3-5 jokes: interstitial ad prompt
7. Player can buy hint (-30 coins) to remove 2 wrong options
8. Player can watch rewarded ad for +100 coins

### 2.2 Scoring

| Action | Reward |
|--------|--------|
| Correct answer | +10 coins |
| 5 correct streak | +25 bonus |
| 10 correct streak | +50 bonus |
| 25 correct streak | +100 bonus |
| Daily login (day 1-7) | 50-350 coins |
| Rewarded ad | +100 coins |

### 2.3 Hints

- **Remove 2 wrong options:** -30 coins
- **Skip joke (no penalty):** unlimited, but 0 coins for that joke
- **Double coins for next 3 jokes:** -200 coins (P2)

### 2.4 Difficulty Progression

| Level Range | Categories | Distractor Quality | Time Bonus |
|-------------|------------|-------------------|------------|
| 1-10 | Family, Animals | Easy (obviously wrong) | None |
| 11-25 | + Work, School | Medium (plausible) | None |
| 26-50 | + Dark Humor, Medical | Hard (similar tone) | None |
| 51+ | + Politics, Absurdist | Expert (very close) | None |

---

## 3. Systems

### 3.1 Coin Economy

**Income sources:**
- Correct answers (+10)
- Streak bonuses (+25/50/100)
- Daily login (50-350 by day)
- Rewarded ads (+100)

**Expense sinks:**
- Hints: remove 2 options (-30)
- Premium categories (-200 each, P2)
- Cosmetic themes (-500 each, P3)
- No-ads pass (-1000 coins or IAP, P3)

**Balance target:** Player earns ~150 coins/session, spends ~50 coins/session → net +100/session → unlocks premium category every 2 sessions.

### 3.2 Streak System

```
Streak counter: 0 → 1 → 2 → 3 → 4 → 5(bonus) → 6 → ... → 10(bonus) → ...
```

- Streak resets on wrong answer
- Streak bonus displayed prominently: "🔥 5 подряд! +25 монет!"
- Best streak saved to localStorage

### 3.3 Daily Rewards

| Day | Coins |
|-----|-------|
| 1 | 50 |
| 2 | 75 |
| 3 | 100 |
| 4 | 125 |
| 5 | 200 |
| 6 | 250 |
| 7 | 350 |
| 8+ | 350 (loop) |

Consecutive days required. Miss a day → reset to Day 1.

### 3.4 Achievement System (P2)

| Achievement | Condition | Reward |
|-------------|-----------|--------|
| Первый шаг | Complete 1 joke | 50 coins |
| Серия 5 | 5 correct in a row | 100 coins |
| Серия 10 | 10 correct in a row | 200 coins |
| Знаток | Complete all jokes in a category | 500 coins |
| Коллекционер | Unlock 5 categories | 300 coins |
| Ежедневный | Login 7 days in a row | 1000 coins |
| Без подсказок | 20 correct in a row without hints | 500 coins |
| Мастер юмора | 100 correct total | 1000 coins |

### 3.5 Sharing (P2)

- Share card: "Я угадал X подряд в Анекдотах! Попробуй: [link]"
- Platforms: Telegram, VK, WhatsApp (via Yandex Games share API)
- Share reward: +50 coins (once per day)

---

## 4. Progression

### 4.1 XP & Leveling

| Level | XP Required | Unlock |
|-------|-------------|--------|
| 1 | 0 | Family category |
| 2 | 100 | Animals category |
| 3 | 300 | Work category |
| 4 | 600 | School category |
| 5 | 1000 | Dark Humor category |
| 6 | 1500 | Medical category |
| 7 | 2500 | Absurdist category |
| 8 | 4000 | All categories unlocked |

XP per correct answer: 10 XP
XP per streak bonus: additional 5 XP per streak level

### 4.2 Category Unlock Flow

```
Locked (grey) → Unlocked (normal) → Completed (gold border, ✓)
```

- Each category: 25 jokes
- Categories unlock by XP level OR by coin purchase (-200 coins)
- Completed = answered all jokes in category correctly at least once
- Categories repeat after completion (jokes shuffled)

### 4.3 Save System

**localStorage keys:**
- `anekdotNum` — current joke position (legacy, repurpose)
- `NB_records` — best streak
- `coins` — current coin balance
- `xp` — total XP
- `level` — current level
- `streak` — current streak
- `bestStreak` — best streak ever
- `dailyDay` — daily reward day counter
- `dailyLastDate` — last login date
- `unlockedCategories` — array of unlocked category IDs
- `completedJokes` — array of completed joke IDs
- `achievements` — array of earned achievement IDs
- `totalCorrect` — total correct answers
- `totalJokes` — total jokes attempted

---

## 5. UX Flow

### 5.1 Scene Flow

```
Boot → Preloader → Menu → Game
              ↑         ↓
              └─────────┘
```

### 5.2 Boot Scene

- Reads GET params (e.g., `?goto=5`)
- Sets debug mode (`#debug`)
- Transitions to Preloader

### 5.3 Preloader Scene

- Shows "Анекдоты — чёрный юмор" title
- Loads atlas (`game.png`/`game.json`) and audio
- Initializes Yandex SDK
- Progress bar
- On success → Game scene (skip Menu initially for MVP)
- On SDK error → error message + retry

### 5.4 Menu Scene (P1)

- Title: "Анекдоты — чёрный юмор"
- Grid of category buttons (3×4)
- Each button shows: category name, joke count, lock/complete status
- Bottom: coin balance, level, settings gear
- Tap category → Game scene with that category

### 5.5 Game Scene

**Layout (2400×1080):**
```
┌────────────────────────────────────────────┐
│  [Category]            [Coins: 1234] [Lv.5]│  ← Header bar
│                                            │
│     ┌──────────────────────────────┐       │
│     │                              │       │
│     │    НАЧАЛО АНЕКДОТА:          │       │
│     │    — Мам, смотри голубь!     │       │
│     │    У тебя есть хлеб?         │       │
│     │                              │       │
│     │    ┌────────┐ ┌────────┐    │       │
│     │    │  A.    │ │  B.    │    │       │
│     │    │ ответ1 │ │ ответ2 │    │       │
│     │    └────────┘ └────────┘    │       │
│     │    ┌────────┐ ┌────────┐    │       │
│     │    │  C.    │ │  D.    │    │       │
│     │    │ ответ3 │ │ ответ4 │    │       │
│     │    └────────┘ └────────┘    │       │
│     │                              │       │
│     └──────────────────────────────┘       │
│                                            │
│  [Hint: 30💰]              [Streak: 🔥5]  │  ← Footer bar
└────────────────────────────────────────────┘
```

**States:**
1. **QUESTION** — joke setup shown, 4 options visible, hint button active
2. **ANSWERED** — correct/incorrect shown, punchline revealed, next button appears
3. **AD_TRANSITION** — interstitial countdown (3-2-1), then ad
4. **REWARDED_PROMPT** — "Watch ad for +100 coins?" overlay

### 5.6 Answer Feedback

**Correct:**
- Option turns green (#4CAF50)
- "+10 монет!" floats up with animation
- Streak counter increments with pulse animation
- Full joke text fades in below
- Sound: positive chime

**Incorrect:**
- Selected option turns red (#F44336)
- Correct option turns green
- "Правильный ответ" label appears
- Full joke text fades in below
- Streak resets to 0 with shake animation
- Sound: negative buzz

### 5.7 Interstitial Flow

```
After joke #3 (or #5, configurable):
  → "Небольшая реклама через..." countdown (3s)
  → YaGamesApi.showFullscreenAdv()
  → On close: resume game
  → Refresh cooldown timer
```

**Cooldown:** Every 3-5 jokes (not time-based). Config: `AD_COOLDOWN_JOKES = 4`

### 5.8 Rewarded Flow

```
Tap "Rewarded" button (bottom-right):
  → "Посмотри рекламу → получи 100 монет"
  → YaGamesApi.showRewarded()
  → On rewarded: +100 coins, update balance
  → On close: resume game
```

**Availability:** After every 5 jokes, or when coin balance < 30 (hint cost).

---

## 6. Content Structure

### 6.1 Joke Data Format

```typescript
interface Joke {
    id: number;
    category: CategoryId;
    setup: string;           // начало анекдота (2-3 предложения)
    punchline: string;       // правильная концовка
    distractors: string[];   // 3 ложных варианта
    difficulty: 1 | 2 | 3;   // лёгкий / средний / сложный
}

enum CategoryId {
    Family = 'family',
    Animals = 'animals',
    Work = 'work',
    School = 'school',
    DarkHumor = 'dark',
    Medical = 'medical',
    Absurdist = 'absurdist',
    Politics = 'politics'
}
```

### 6.2 Content Sizing

| Phase | Jokes | Categories | Target |
|-------|-------|------------|--------|
| MVP | 100 | 5 | Launch survival |
| v1.1 | 200 | 7 | Retention |
| v1.2 | 350 | 8 | Engagement |
| v2.0 | 500+ | 10 | Growth |

### 6.3 Distractor Quality Rules

1. Distractors must be in same tone as punchline
2. Distractors should be plausible (not obviously wrong)
3. No duplicate punchlines across jokes
4. Each distractor should reference the setup's context
5. Distractors can be from other jokes in same category

### 6.4 Existing Jokes (Refactored)

Current 5 jokes from `GameData.ts` need to be converted to new format with setup/punchline/distractors. Example:

```typescript
{
    id: 1,
    category: CategoryId.Family,
    setup: "— Мам, смотри голубь! У тебя есть хлеб?",
    punchline: "— Без хлеба ешь!",
    distractors: [
        "— Нет, давай лучше в парк пойдём!",
        "— Конечно, вот тебе кусочек!",
        "— Смотри, он улетел, не успели!"
    ],
    difficulty: 1
}
```

---

## 7. Monetization

### 7.1 Ad Strategy

| Format | Placement | eCPM (RU) | Frequency |
|--------|-----------|-----------|-----------|
| Interstitial | Every 4 jokes | ~$7.86 | 15-20/session |
| Rewarded | Optional, every 5 jokes | ~$9.95 | 2-5/session |
| Sticky Banner | Bottom of screen | ~$0.10 | Always |

### 7.2 Interstitial Timing

- **NOT time-based** (current: 1.1 min = broken)
- **Event-based:** Every N jokes completed
- Default N = 4 (configurable per A/B test)
- Cooldown between interstitials: minimum 2 jokes gap
- Never show on first session joke
- Never show during hint purchase flow

### 7.3 Rewarded Placement

- Button visible in game footer (always)
- Prompt after wrong answer: "Посмотри рекламу → +100 монет"
- Prompt when balance < 30 coins (can't afford hint)
- Prompt on daily login: "Посмотри → удвоить бонус"

### 7.4 Sticky Banner

- Bottom of screen, 320×50
- Always visible during gameplay
- Hidden during interstitial
- `YaGamesApi` sticky banner API

### 7.5 IAP (P3)

- No-ads pass: remove interstitials (keep rewarded)
- Premium joke packs: 50 extra jokes per pack
- Coin bundles: 1000/5000/10000 coins

---

## 8. Production Priorities

### 8.1 Sprint Plan

#### Sprint 1 — Core Loop (MVP)
**Goal:** Playable "guess the punchline" mechanic

| Task | Priority | Files |
|------|----------|-------|
| Joke data structure + 100 jokes | P0 | `src/data/JokesData.ts` (new) |
| GameScene refactor: 4-option quiz | P0 | `src/game/scenes/GameScene.ts` |
| Coin economy | P0 | `src/data/Economy.ts` (new) |
| Answer feedback (correct/incorrect) | P0 | `src/game/scenes/GameScene.ts` |
| Interstitial every N jokes | P0 | `src/game/mng/AdMng.ts` |
| Config: `AD_COOLDOWN_JOKES` | P0 | `src/data/Config.ts` |
| Remove old left/right navigation | P0 | `src/game/scenes/GameScene.ts` |

#### Sprint 2 — Retention
**Goal:** Daily rewards, streaks, persistence

| Task | Priority | Files |
|------|----------|-------|
| Daily rewards system | P1 | `src/data/DailyRewards.ts` (new) |
| Streak system | P1 | `src/game/scenes/GameScene.ts` |
| Save/load via localStorage | P1 | `src/data/LocalData.ts` |
| XP & leveling | P1 | `src/data/Progression.ts` (new) |
| Rewired rewarded ads | P1 | `src/game/mng/AdMng.ts` |
| Sticky banner | P1 | `src/game/gui/StickyBanner.ts` (new) |

#### Sprint 3 — Content & Polish
**Goal:** Categories, hints, UX polish

| Task | Priority | Files |
|------|----------|-------|
| Category system | P1 | `src/data/JokesData.ts` |
| Menu scene with categories | P1 | `src/game/scenes/MenuScene.ts` |
| Hint system (remove 2 options) | P1 | `src/game/scenes/GameScene.ts` |
| Sound effects | P2 | `src/sound/SndMng.ts` |
| Animations (correct/incorrect) | P2 | `src/game/scenes/GameScene.ts` |
| 200+ jokes total | P1 | `src/data/JokesData.ts` |

#### Sprint 4 — Growth
**Goal:** Sharing, achievements, optimization

| Task | Priority | Files |
|------|----------|-------|
| Achievements | P2 | `src/data/Achievements.ts` (new) |
| Share cards (Telegram/VK) | P2 | `src/game/gui/ShareCard.ts` (new) |
| Leaderboard (Yandex Games) | P2 | `src/api/YaGamesApi.ts` |
| A/B test framework | P2 | `src/game/mng/ABTest.ts` (new) |
| Analytics events | P2 | `src/game/mng/Analytics.ts` (new) |

### 8.2 File Structure (Target)

```
src/
├── index.ts
├── api/
│   └── YaGamesApi.ts
├── data/
│   ├── Config.ts              (modify: add AD_COOLDOWN_JOKES, categories)
│   ├── GameData.ts            (modify: use JokesData)
│   ├── JokesData.ts           (NEW: joke database)
│   ├── Economy.ts             (NEW: coin economy)
│   ├── Progression.ts         (NEW: XP, levels, categories)
│   ├── DailyRewards.ts        (NEW: daily reward logic)
│   ├── Achievements.ts        (NEW: achievement definitions)
│   ├── LocalData.ts           (modify: add new save fields)
│   └── Params.ts
├── game/
│   ├── scenes/
│   │   ├── Scenes.ts          (modify: add new scene names)
│   │   ├── Boot.ts
│   │   ├── Preloader.ts
│   │   ├── MenuScene.ts       (modify: category grid)
│   │   ├── GameScene.ts       (modify: major refactor)
│   │   └── ResultScene.ts     (NEW: post-session stats)
│   ├── gui/
│   │   ├── MyButton.ts
│   │   ├── MyContainer.ts
│   │   ├── MyText.ts
│   │   ├── LevelButton.ts
│   │   ├── AdShower.ts
│   │   ├── ScrollList.ts
│   │   ├── StickyBanner.ts    (NEW)
│   │   ├── ShareCard.ts       (NEW)
│   │   └── preloader/
│   │       └── PreloaderBar.ts
│   ├── mng/
│   │   ├── AdMng.ts           (modify: event-based interstitials)
│   │   ├── ABTest.ts          (NEW)
│   │   └── Analytics.ts       (NEW)
│   └── events/
│       └── FrontEvents.ts
├── sound/
│   └── SndMng.ts              (modify: add SFX)
└── utils/
    └── ...existing files...
```

### 8.3 Config Changes

```typescript
// Config.ts additions
export const Config = {
    // ...existing...
    GW: 2400,
    GH: 1080,
    GW_HALF: 1200,
    GH_HALF: 540,
    checkOrientation: false,
    TAP_TO_START: false,
    DRAW_DEBUG_BORDER: true,

    // New
    AD_COOLDOWN_JOKES: 4,       // interstitial every N jokes
    AD_MIN_GAP: 2,              // minimum jokes between interstitials
    HINT_COST: 30,              // coins to remove 2 options
    CORRECT_REWARD: 10,         // coins per correct answer
    REWARDED_AMOUNT: 100,       // coins from rewarded ad
    STREAK_BONUS_5: 25,         // bonus at streak 5
    STREAK_BONUS_10: 50,        // bonus at streak 10
    STREAK_BONUS_25: 100,       // bonus at streak 25
    XP_PER_CORRECT: 10,         // XP per correct answer
    CATEGORY_UNLOCK_COST: 200,  // coins to unlock category
    DAILY_REWARDS: [50, 75, 100, 125, 200, 250, 350],
};
```

---

## 9. Phaser Scene Architecture

### 9.1 Scene Graph

```
Phaser.Game
├── Boot (SceneName.Boot)
│   └── readGETParams() → start Preloader
├── Preloader (SceneName.Preloader)
│   ├── init(): YaGamesApi.init(), load assets
│   └── onSuccess(): start Game (MVP) or Menu (v1.1)
├── Menu (SceneName.Menu) [P1]
│   ├── category grid (ScrollList + LevelButton)
│   ├── header: title, coin balance, level
│   └── footer: settings, daily reward button
└── Game (SceneName.Game)
    ├── header: category name, coin balance, streak
    ├── joke setup text
    ├── 4 answer buttons (MyButton instances)
    ├── hint button
    ├── footer: streak display, rewarded button
    └── overlays: AdShower, answer feedback, daily reward popup
```

### 9.2 Scene Communication

| From | To | Event | Data |
|------|----|-------|------|
| Preloader | Game | `scene.start` | — |
| Game | Menu | `scene.start` | — |
| Game | Game | `scene.restart` | — |
| Any | FrontEvents | `EVENT_WINDOW_RESIZE` | — |
| Game | AdMng | `showInterstitial` | — |
| Game | AdMng | `showRewarded` | — |

### 9.3 GameScene Internal State Machine

```
States:
  IDLE        → waiting for player input
  PROCESSING  → answer shown, waiting for "next" tap
  AD_BREAK    → interstitial countdown + ad
  REWARDED    → rewarded ad playing
  TRANSITION  → fade between jokes

Transitions:
  IDLE → PROCESSING: player taps answer
  PROCESSING → IDLE: player taps "next"
  PROCESSING → AD_BREAK: jokeCount % AD_COOLDOWN_JOKES == 0
  IDLE → REWARDED: player taps rewarded button
  REWARDED → IDLE: ad complete
  AD_BREAK → IDLE: ad complete
```

### 9.4 Component Architecture

```
GameScene
├── Header (Container)
│   ├── CategoryLabel (Text)
│   ├── CoinDisplay (Text + Image)
│   └── StreakDisplay (Text)
├── JokeArea (Container)
│   ├── SetupText (Text) — joke beginning
│   └── PunchlineText (Text) — revealed after answer
├── AnswerGrid (Container)
│   ├── OptionA (AnswerButton)
│   ├── OptionB (AnswerButton)
│   ├── OptionC (AnswerButton)
│   └── OptionD (AnswerButton)
├── Footer (Container)
│   ├── HintButton (MyButton)
│   └── RewardedButton (MyButton)
└── Overlays
    ├── AdShower (countdown)
    ├── FeedbackOverlay (correct/incorrect animation)
    └── DailyRewardPopup (daily login bonus)
```

---

## 10. Technical Notes

### 10.1 Breaking Changes from Current Code

| Current | New | Reason |
|---------|-----|--------|
| `GameScene`: left/right navigation | 4-option quiz | Core mechanic change |
| `GameData`: 5 hardcoded jokes | 100+ jokes with distractors | Content scaling |
| `AdMng`: time-based (1.1 min) | event-based (every N jokes) | UX improvement |
| `MenuScene`: 50 numbered buttons | Category grid | New navigation |
| `LocalData`: 2 fields | 15+ fields | Full save system |

### 10.2 Backward Compatibility

- `localStorage` keys: reuse `anekdotNum` and `NB_records` for migration
- `Config.GW`/`Config.GH`/`Config.GW_HALF`/`Config.GH_HALF`: keep as-is
- `Params.gameWidth`: keep for responsive layout
- `YaGamesApi`: extend, don't replace
- `MyButton`: reuse for answer buttons
- `FrontEvents`: reuse for resize handling
- `SndMng`: extend with new sound aliases

### 10.3 Performance Considerations

- Joke text: use word wrap, not individual letter objects
- Answer buttons: pool and reuse, don't destroy/create per joke
- Animations: use Phaser tweens, not requestAnimationFrame
- localStorage: batch writes, not per-field
- Ad loading: preload next interstitial while playing

### 10.4 Yandex SDK Integration Points

| API | Usage |
|-----|-------|
| `ysdk.adv.showFullscreenAdv()` | Interstitial ads |
| `ysdk.adv.showRewardedVideo()` | Rewarded ads |
| `ysdk.features.LoadingAPI.ready()` | Signal game ready |
| `ysdk.feedback.canReview()` | Check if can show review |
| `ysdk.feedback.requestReview()` | Request app review |
| `ysdk.getLeaderboards()` | Global leaderboard (P2) |
| `ysdk.getPlayer()` | Player data sync (P2) |

---

## 11. Risk Mitigation

| Risk | Impact | Mitigation |
|------|--------|------------|
| Insufficient jokes at launch | Low retention, moderation removal | Pre-load 100+ jokes, plan 20/week additions |
| Interstitials too frequent | User churn | Event-based (every 4 jokes), not time-based |
| No rewarded ads | Low eCPM | P1: implement in Sprint 2 |
| Monotonous mechanic | Session boredom | Categories, streaks, achievements |
| Yandex moderation removal | Total loss | Add gameplay (quiz), not just text viewer |
| localStorage corruption | Save loss | Backup to Yandex cloud (P2) |

---

## 12. A/B Test Plan

| Test | Variable | Default | Variant | Metric |
|------|----------|---------|---------|--------|
| Interstitial frequency | `AD_COOLDOWN_JOKES` | 4 | 3, 5, 6 | Retention, Revenue |
| Hint cost | `HINT_COST` | 30 | 20, 50 | Coin economy balance |
| Correct reward | `CORRECT_REWARD` | 10 | 5, 15 | Engagement, session length |
| Rewarded prompt frequency | — | every 5 jokes | every 3, never | Rewarded show rate |
| Category order | — | by difficulty | random | Category completion rate |

---

*GDD v1.0 — Based on market analysis (Yandex Games 50M+ MAU), competitor analysis (2048 Анекдотов, Анекдоты без интернета), and current project state (5 hardcoded jokes, left/right navigation, 1.1min interstitial cooldown).*
