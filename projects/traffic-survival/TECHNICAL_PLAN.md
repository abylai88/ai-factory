# Technical Plan: Анекдоты — Угадай Концовку

**Version:** 1.0
**Date:** 2026-09-13
**Based on:** GDD v1.0, GAMEPLAY_MECHANICS v1.0, CONCEPT.md
**Status:** Design only — no code changes

---

## 0. Executive Summary

Current state: 5 hardcoded jokes, left/right page navigation, time-based interstitials (1.1 min), no coin economy, no streaks, no hints, no categories. Target: quiz mechanic with 4 options, 100+ jokes across categories, coin economy, streaks, hints, daily rewards, event-based interstitials, rewarded ads, sticky banner.

**4 increments planned:**
1. Core quiz loop (JokesData + GameScene refactor + Economy)
2. Retention systems (DailyRewards + Streaks + Progression + LocalData expansion)
3. Content & UX polish (Categories + MenuScene refactor + Hints + Sounds)
4. Growth features (Achievements + ShareCard + Analytics + A/B testing)

---

## 1. Increment 1 — Core Quiz Loop

**Goal:** Replace left/right navigation with 4-option quiz mechanic, coin economy, event-based interstitials.

### 1.1 New file: `src/data/JokesData.ts`

**Purpose:** Joke database with setup/punchline/distractors, category system, joke selection.

**Current state:** `src/data/GameData.ts` has 5 hardcoded `{ text: string }` objects with no structure.

**Changes:**

```
CREATE src/data/JokesData.ts
```

**Contents:**
- `CategoryId` enum: Family, Animals, Work, School, DarkHumor, Medical, Absurdist, Politics
- `Joke` interface: `{ id: number; category: CategoryId; setup: string; punchline: string; distractors: string[]; difficulty: 1 | 2 | 3 }`
- `JokesDatabase` class (singleton):
  - `_jokes: Joke[]` — all jokes loaded
  - `getJokeById(id: number): Joke`
  - `getJokesByCategory(cat: CategoryId): Joke[]`
  - `getAvailableJokes(completedIds: number[], category?: CategoryId): Joke[]`
  - `getRandomJoke(available: Joke[]): Joke`
  - `shuffleOptions(joke: Joke): string[]` — returns 4 shuffled options (1 correct + 3 distractors), preserves correct index
  - `totalCount(): number`
- Static data: 100+ jokes hardcoded in the same file (content authoring responsibility)
- Migration: convert existing 5 jokes from `GameData.ts` into new format with generated distractors

**Depends on:** Nothing (pure data layer)

### 1.2 Modified file: `src/data/Config.ts`

**Current state (line 19):** Only `AD_PERIOD: 1.1`

**Add after line 19:**
```typescript
// Quiz mechanics
AD_COOLDOWN_JOKES: 4,       // interstitial every N jokes
AD_MIN_GAP: 2,              // minimum jokes between interstitials
HINT_COST: 30,              // coins to remove 2 options
CORRECT_REWARD: 10,         // coins per correct answer
REWARDED_AMOUNT: 100,       // coins from rewarded ad
STREAK_BONUS_5: 25,
STREAK_BONUS_10: 50,
STREAK_BONUS_25: 100,
XP_PER_CORRECT: 10,
CATEGORY_UNLOCK_COST: 200,
DAILY_REWARDS: [50, 75, 100, 125, 200, 250, 350],
```

**Keep existing:** `GW`, `GH`, `GW_HALF`, `GH_HALF`, `checkOrientation`, `TAP_TO_START`, `DRAW_DEBUG_BORDER`, `GW_SAFE`, `GH_SAFE`

**Remove:** `AD_PERIOD: 1.1` (replaced by `AD_COOLDOWN_JOKES`)

**Depends on:** Nothing

### 1.3 Modified file: `src/data/GameData.ts`

**Current state:** Singleton with 5 hardcoded jokes, `getAnekdotId()`/`setAnekdotId()` localStorage, `getAnektod()`.

**Changes:**
- Remove `ANEKDOTS` array (moved to `JokesData.ts`)
- Remove `getAnekdotId()`, `setAnekdotId()` (joke position now managed in GameScene)
- Remove `getAnekdotCount()`, `getAnektod()` (replaced by JokesData API)
- Keep singleton pattern and EventEmitter inheritance
- Repurpose as **game state manager**: expose current joke index, session stats
- Add `sessionCorrect: number`, `sessionTotal: number`, `sessionCoins: number` fields
- Add `resetSession()` method

**Depends on:** JokesData.ts (1.1)

### 1.4 New file: `src/data/Economy.ts`

**Purpose:** Centralized coin/XP management with localStorage persistence.

**Current state:** No economy system. Coins not tracked. `LocalData.ts` only tracks `inputByKeys` and `records`.

**Contents:**
- `Economy` class (singleton):
  - `_coins: number`, `_xp: number`, `_level: number`
  - `get coins(): number`, `get xp(): number`, `get level(): number`
  - `addCoins(amount: number): void` — adds + updates localStorage + emits change event
  - `spendCoins(amount: number): boolean` — returns false if insufficient, deducts + updates
  - `canAfford(amount: number): boolean`
  - `addXP(amount: number): void` — adds + checks level up
  - `getLevelForXP(xp: number): number` — pure function, lookup table
  - `getXPForLevel(level: number): number`
  - `save(): void` — batch write to localStorage
  - `load(): void` — read from localStorage
  - Extends `Phaser.Events.EventEmitter` — emits `'coinsChanged'`, `'levelUp'`
- localStorage keys: `coins`, `xp`, `level`

**Depends on:** Config.ts (1.2)

### 1.5 Refactored file: `src/game/scenes/GameScene.ts`

**This is the largest change.** Currently 242 lines with left/right navigation. Must become a state-machine-driven quiz scene.

**Current architecture to remove:**
- `_btnLeft`, `_btnRight` (left/right buttons) — lines 28-29, 76-82
- `onLeftClick()`, `onRightClick()` — lines 146-158
- `_keyA`, `_keyD`, `_keyLeft`, `_keyRight` — lines 31-34, 85-93
- `showNextPage()`, `showNextPage2()` — lines 212-235
- `updateContent()` — lines 188-210 (joke text display)
- `updateButtons()` — lines 177-186

**New architecture:**

**State machine** (enum `GameState`):
```
IDLE | PROCESSING | AD_BREAK | REWARDED | TRANSITION | HINT_ANIM | DISABLED
```

**New properties:**
- `_state: GameState`
- `_currentJoke: Joke`
- `_options: string[]` (4 shuffled options)
- `_correctIndex: number`
- `_jokeCount: number` (session counter)
- `_streak: number`
- `_hintUsed: boolean`
- `_answerButtons: MyButton[]` (4 buttons, pooled)
- `_setupText: Phaser.GameObjects.Text`
- `_punchlineText: Phaser.GameObjects.Text`
- `_headerContainer: Phaser.GameObjects.Container`
- `_answerContainer: Phaser.GameObjects.Container`
- `_footerContainer: Phaser.GameObjects.Container`
- `_coinText: Phaser.GameObjects.Text`
- `_streakText: Phaser.GameObjects.Text`

**New UI layout (2400x1080):**
```
Header (y: -Config.GH_HALF + 50):
  - Category label (left)
  - Coin display with icon (right)
  - Streak display (right-center)

Joke Area (y: -150 to +100):
  - SetupText: joke beginning, word-wrapped, auto-scaled font
  - PunchlineText: hidden initially, revealed after answer

Answer Grid (y: +150 to +500):
  - 4 MyButton instances in 2x2 grid
  - Layout: A(x:-400, y:+200), B(x:+400, y:+200), C(x:-400, y:+420), D(x:+400, y:+420)

Footer (y: +Config.GH_HALF - 80):
  - Hint button (left): "Подсказка 30💰"
  - Rewarded button (right): "Rewarded +100"
```

**New methods:**
- `loadNextJoke(): void` — picks random from available, shuffles options, resets UI
- `onAnswerSelected(index: number): void` — checks correct, triggers feedback
- `showFeedback(isCorrect: boolean): void` — color change, animations, coin float
- `onNextTap(): void` — transitions to next joke or AD_BREAK
- `showAdCountdown(): void` — 3-2-1 countdown then interstitial
- `onHintTap(): void` — deducts coins, removes 2 wrong options with animation
- `onRewardedTap(): void` — shows rewarded ad, grants coins on complete
- `updateStreak(isCorrect: boolean): void` — increment/reset streak, check milestones
- `transitionToNextJoke(): void` — black curtain fade, load new joke, fade in

**Keyboard support (desktop):**
- A/Left → option A
- B/Right → option B
- C/Up → option C
- D/Down → option D
- H → hint
- Space/Enter → next joke

**Depends on:** JokesData.ts (1.1), Config.ts (1.2), Economy.ts (1.4), MyButton.ts (existing)

### 1.6 Modified file: `src/game/mng/AdMng.ts`

**Current state:** Time-based interstitial check (`INTER_PERIOD = 1.1` min, line 6). `isInterstitialReady()` checks `dt > INTER_PERIOD`.

**Changes:**
- Remove `INTER_PERIOD` constant (line 6)
- Remove `_prevInterTimeMin` property (line 10)
- Remove `getCurrTimeInMin()` method (lines 31-33)
- Replace with **event-based** tracking:
  - Add `_jokesSinceLastAd: number = 0`
  - Add `_adCooldown: number` (read from Config.AD_COOLDOWN_JOKES)
  - Add `incrementJokeCount(): void` — increments `_jokesSinceLastAd`
  - Add `resetJokeCount(): void` — sets to 0
  - `isInterstitialReady(): boolean` — returns `_jokesSinceLastAd >= _adCooldown`
  - `showInterstitial(...)`: on close callback, call `resetJokeCount()`
- Keep `showRewarded()` as-is (already event-based via callback)
- Keep `refreshTimer()` — rename to `refreshCooldown()` for clarity

**Depends on:** Config.ts (1.2)

### 1.7 Acceptance Criteria — Increment 1

| # | Criterion | Verification |
|---|-----------|-------------|
| 1.1 | JokesData contains ≥100 jokes with valid Joke structure | Unit: `JokesData.totalCount() >= 100`, each joke has `id, category, setup, punchline, distractors[3], difficulty` |
| 1.2 | `shuffleOptions()` returns exactly 4 items, exactly 1 matches punchline | Unit test with 100 iterations |
| 1.3 | GameScene displays joke setup text + 4 answer buttons in 2x2 grid | Visual: launch game, verify 4 buttons appear, setup text visible |
| 1.4 | Tapping correct answer → green highlight, +10 coins, punchline reveal | Visual + Economy: coin balance increases by 10 |
| 1.5 | Tapping incorrect answer → red highlight, correct shown green, 0 coins | Visual: both selected (red) and correct (green) highlighted |
| 1.6 | Coin balance persists across scene restarts | Test: earn coins, restart, verify balance in localStorage |
| 1.7 | Interstitial triggers every 4th joke (not time-based) | Test: play 4 jokes, verify ad shows on joke #4, #8, etc. |
| 1.8 | Interstitial never shows on first joke of session | Test: restart, play joke #1 → no ad |
| 1.9 | Black curtain transition between jokes | Visual: verify fade animation on joke change |
| 1.10 | Desktop keyboard input works (A/B/C/D keys) | Test: press A → option A selected |
| 1.11 | GameScene handles screen resize without crash | Test: resize window, verify layout adjusts |
| 1.12 | Config contains all new constants, old AD_PERIOD removed | Code review: `grep AD_PERIOD` returns 0 results |

---

## 2. Increment 2 — Retention Systems

**Goal:** Daily rewards, streak system, XP/leveling, expanded localStorage, sticky banner.

### 2.1 Modified file: `src/data/LocalData.ts`

**Current state (55 lines):** Only `inputByKeys` and `records` fields.

**Expand to full save system:**
```
Fields enum:
  inputByKeys = 'NB_inputByKeys'      (keep for backward compat)
  records = 'NB_records'              (keep for backward compat → repurpose as bestStreak)
  coins = 'anekd_coins'               (NEW)
  xp = 'anekd_xp'                     (NEW)
  level = 'anekd_level'               (NEW)
  streak = 'anekd_streak'             (NEW)
  bestStreak = 'anekd_bestStreak'     (NEW)
  dailyDay = 'anekd_dailyDay'         (NEW)
  dailyLastDate = 'anekd_dailyLastDate' (NEW)
  unlockedCategories = 'anekd_cats'   (NEW, JSON array)
  completedJokes = 'anekd_completed'  (NEW, JSON array)
  totalCorrect = 'anekd_totalCorrect' (NEW)
  totalJokes = 'anekd_totalJokes'     (NEW)
```

**New methods:**
- `getField<T>(key: string, defaultVal: T): T`
- `setField<T>(key: string, value: T): void`
- `getJsonField<T>(key: string, defaultVal: T): T` — for array/object fields
- `setJsonField<T>(key: string, value: T): void`
- `clearAll(): void` — reset all fields (debug)
- Migration logic: on first load, if `NB_records` exists but `anekd_bestStreak` doesn't, copy value

**Depends on:** Nothing (standalone)

### 2.2 New file: `src/data/DailyRewards.ts`

**Purpose:** Daily login reward logic with streak tracking.

**Contents:**
- `DailyRewards` class:
  - `checkAndClaim(): { claimed: boolean; day: number; coins: number } | null`
  - Logic: read `dailyLastDate` → compare with today → if same day, return null (already claimed); if consecutive day, increment `dailyDay`; if gap > 1 day, reset to day 1; claim = add coins + update fields
  - `getStreak(): number` — current consecutive days
  - `getNextReward(): { day: number; coins: number }` — preview of next reward
  - Uses `Config.DAILY_REWARDS` array for amounts
  - Extends EventEmitter → emits `'dailyClaimed'`
- localStorage fields: `dailyDay`, `dailyLastDate` (via LocalData)

**Depends on:** LocalData.ts (2.1), Config.ts (1.2)

### 2.3 Modified file: `src/game/scenes/GameScene.ts` (streak additions)

**Add to existing GameScene from Increment 1:**
- `_streak: number` property (loaded from LocalData)
- `updateStreak(isCorrect: boolean)`:
  - If correct: `_streak++`, check milestones (5/10/25), add bonus coins via Economy
  - If wrong: `_streak = 0`, animate streak reset
- Streak milestone effects:
  - Streak 5: gold glow on streak text, +25 coins, fanfare sound
  - Streak 10: screen shake, +50 coins, major fanfare
  - Streak 25: full celebration, +100 coins, all effects
- `_streakText` in header: "🔥 {streak}" with pulse animation on increment
- Save streak to LocalData on joke completion
- `updateStreakDisplay()`: animate streak counter text

**Depends on:** Economy.ts (1.4), LocalData.ts (2.1)

### 2.4 New file: `src/data/Progression.ts`

**Purpose:** XP/leveling system, category unlock tracking.

**Contents:**
- `Progression` class (singleton):
  - `addXP(amount: number): void` — delegates to Economy.addXP, checks level thresholds
  - `getLevel(): number` — from Economy
  - `getXP(): number` — from Economy
  - `getXPForNextLevel(): number`
  - `getUnlockedCategories(): CategoryId[]` — from LocalData
  - `unlockCategory(cat: CategoryId): boolean` — spend coins via Economy, add to LocalData
  - `isCategoryUnlocked(cat: CategoryId): boolean`
  - `getCompletedJokes(): number[]` — from LocalData
  - `markJokeCompleted(jokeId: number): void`
  - `getAvailableCategories(): CategoryId[]` — categories unlocked by level OR coin purchase
- Level thresholds from GDD (Level 1=0XP, Level 2=100XP, ..., Level 8=4000XP)
- Category unlock table: Level 1→Family, 2→Animals, 3→Work, etc.

**Depends on:** Economy.ts (1.4), LocalData.ts (2.1), JokesData.ts (1.1)

### 2.5 New file: `src/game/gui/StickyBanner.ts`

**Purpose:** Persistent banner ad at bottom of screen.

**Contents:**
- `StickyBanner` class extending `Phaser.GameObjects.Container`:
  - Constructor: creates container at bottom of screen (`y: Config.GH_HALF - 25`)
  - `show(): void` — calls `YaGamesApi.showBanner()` or equivalent
  - `hide(): void` — hides banner during interstitial
  - `updatePosition(): void` — repositions on resize
- Integration: instantiated in `GameScene.create()`, shown after black curtain hides
- During `AD_BREAK` state: hide banner, show on `IDLE` entry

**Depends on:** YaGamesApi.ts (existing), Config.ts (1.2)

### 2.6 Acceptance Criteria — Increment 2

| # | Criterion | Verification |
|---|-----------|-------------|
| 2.1 | LocalData saves/loads all 13+ fields correctly | Unit: write each field, reload, verify values |
| 2.2 | DailyRewards: first login → day 1 reward (50 coins) | Test: clear localStorage, login → 50 coins claimed |
| 2.3 | DailyRewards: consecutive login → day 2 reward (75 coins) | Test: set dailyLastDate to yesterday → 75 coins |
| 2.4 | DailyRewards: missed day → resets to day 1 | Test: set dailyLastDate to 2 days ago → 50 coins |
| 2.5 | Streak increments on correct, resets on wrong | Visual + Economy: track streak counter and coins |
| 2.6 | Streak 5 → +25 bonus coins, visual fanfare | Visual + Economy: verify coin jump |
| 2.7 | Streak 10 → +50 bonus, screen shake | Visual: camera shake on milestone |
| 2.8 | XP increases on correct answer (+10) | Economy: XP total increases |
| 2.9 | Level up triggers at correct XP threshold | Test: accumulate 100 XP → level 2 |
| 2.10 | Category unlock by level works (Level 2 → Animals) | Progression: `isCategoryUnlocked('animals')` returns true at level 2 |
| 2.11 | Category unlock by coin purchase works (-200 coins) | Economy: coins deducted, category added |
| 2.12 | Sticky banner visible during gameplay, hidden during ad | Visual: check banner presence in IDLE vs AD_BREAK |
| 2.13 | All data persists across page reload | Full test: play, earn, refresh, verify all values |
| 2.14 | Backward compat: old `NB_records` migrated to `anekd_bestStreak` | Test: set `NB_records` in localStorage, reload → `anekd_bestStreak` has same value |

---

## 3. Increment 3 — Content & UX Polish

**Goal:** Category system in MenuScene, hint system, sound effects, animations.

### 3.1 Modified file: `src/game/scenes/MenuScene.ts`

**Current state (194 lines):** Grid of 50 numbered `LevelButton`s with left/right page navigation.

**Replace with category grid:**
- Remove: `_btns: LevelButton[]`, `_currPageId`, `getBtnPos()`, `updateFieldSize()`, `updateLevelButtons()`, `getPageValue()`
- Remove: `LevelButton` imports and instantiation loop (lines 78-86)
- New layout:
  ```
  Header (y: -Config.GH_HALF + 80):
    Title: "Анекдоты — чёрный юмор"
    Subtitle: "Угадай концовку"
  
  Category Grid (center):
    3 columns × 3 rows of CategoryButton instances
    Each button: category name, joke count, lock icon if locked
  
  Footer:
    Coin balance, Level display, Settings gear
  ```
- New `_categoryButtons: CategoryButton[]` array
- Each `CategoryButton` shows:
  - Category name
  - Joke count: "25 анекдотов"
  - Lock icon overlay if locked
  - Gold border if completed
- Tap category → `scene.start(SceneName.Game, { category: catId })`
- Read unlocked categories from Progression
- Update on `onResize()`

**New file: `src/game/gui/CategoryButton.ts`**
- Extends `MyButton`
- Properties: `_categoryId`, `_nameText`, `_countText`, `_lockIcon`
- Methods: `setLocked(locked: boolean)`, `setCompleted(completed: boolean)`
- Visual states: locked (grey, opacity 0.5), unlocked (normal), completed (gold border)

**Depends on:** Progression.ts (2.4), JokesData.ts (1.1), MyButton.ts (existing)

### 3.2 Modified file: `src/game/scenes/GameScene.ts` (hint system)

**Add to existing GameScene from Increments 1+2:**
- `_hintButton: MyButton` in footer
- `_hintUsed: boolean` (per joke, resets on new joke)
- `_hintAvailable: boolean` (session-wide, or per-session limit)
- `onHintTap()`:
  1. Check: `Economy.canAfford(Config.HINT_COST)` and `_state === IDLE`
  2. Deduct coins: `Economy.spendCoins(Config.HINT_COST)`
  3. Select 2 wrong options to remove (random from wrong indices)
  4. Animate removal: shake → fade → shrink (400ms, `easeInBack`)
  5. Disable removed buttons (`disableInteractive()`)
  6. Disable hint button for this joke
- Hint button visual: "Подсказка 💰30" with coin icon, greyed out if can't afford
- Keyboard: H key triggers hint (desktop only)

**Depends on:** Economy.ts (1.4), MyButton.ts (existing)

### 3.3 Modified file: `src/sound/SndMng.ts`

**Current state:** Only `Click` sound loaded. No SFX enum for game sounds.

**Changes:**
- Add to `SoundAlias` enum:
  ```typescript
  Correct = 'correct',
  Incorrect = 'incorrect',
  Streak5 = 'streak5',
  Streak10 = 'streak10',
  CoinEarn = 'coinEarn',
  HintUse = 'hintUse',
  LevelUp = 'levelUp',
  ButtonTap = 'buttonTap',
  DailyReward = 'dailyReward',
  Achievement = 'achievement',
  ```
- Add to `SOUND_LOAD_DATA`:
  ```typescript
  { alias: SoundAlias.Correct, file: 'correct.mp3' },
  { alias: SoundAlias.Incorrect, file: 'incorrect.mp3' },
  { alias: SoundAlias.Streak5, file: 'streak5.mp3' },
  { alias: SoundAlias.Streak10, file: 'streak10.mp3' },
  { alias: SoundAlias.CoinEarn, file: 'coin_earn.mp3' },
  { alias: SoundAlias.HintUse, file: 'hint.mp3' },
  { alias: SoundAlias.LevelUp, file: 'level_up.mp3' },
  { alias: SoundAlias.ButtonTap, file: 'click.mp3' },
  { alias: SoundAlias.DailyReward, file: 'daily.mp3' },
  { alias: SoundAlias.Achievement, file: 'achievement.mp3' },
  ```
- Add `sfxPlayConditional(alias, volume)`: plays only if `enabled`, returns null if not loaded
- Preloader: `Preloader.ts` already loads `SOUND_LOAD_DATA` dynamically — no changes needed there

**Depends on:** Nothing (standalone)

### 3.4 Modified file: `src/game/scenes/GameScene.ts` (animations)

**Add juice effects from GAMEPLAY_MECHANICS.md:**

**Button animations:**
- Answer buttons appear with stagger: 80ms delay between each, `scale: 0 → 1.1 → 1` with `easeOutBack`
- Press squish: `pointerdown` → `scaleX: 1 → 0.9, scaleY: 1 → 1.1` (100ms)
- Correct pulse: `scale: 1 → 1.15 → 1` with `easeOutElastic` (500ms)
- Incorrect shake: `x: ±8px` with `easeOutBounce` (400ms)

**Coin float animation:**
- On correct answer: create temporary Text "+10💰" at button position
- Tween: y -= 120, alpha 0 → 1 → 0, duration 800ms, `easeOutCubic`
- Destroy after complete

**Screen effects:**
- Correct answer: brief camera alpha pulse (100ms yoyo)
- Streak 5+: camera shake (intensity 0.003, duration 300ms)
- Streak 10+: camera shake (intensity 0.005, duration 400ms)

**Particle effects (if atlas supports particle texture):**
- Correct: burst of 15 green circles from button position
- Streak milestone: burst of 30 gold stars from screen center

**Text effects:**
- Setup text: fade in from bottom (300ms, `easeOutCubic`)
- Punchline reveal: fade in (600ms, `easeOutCubic`)
- Streak counter: scale pulse on increment (300ms, `easeOutElastic`)

**Depends on:** Config.ts timing constants (1.2), existing Phaser tweens

### 3.5 Modified file: `src/game/scenes/Preloader.ts`

**Changes:**
- Update subtitle text from "чёрный юмор" to "чёрный юмор — угадай концовку"
- Ensure all new sound aliases are loaded (already dynamic via SOUND_LOAD_DATA)
- After SDK init, call `DailyRewards.checkAndClaim()` to show daily reward popup on game start

**Depends on:** DailyRewards.ts (2.2)

### 3.6 Acceptance Criteria — Increment 3

| # | Criterion | Verification |
|---|-----------|-------------|
| 3.1 | MenuScene shows category grid with 5+ categories | Visual: launch game → menu shows category buttons |
| 3.2 | Locked categories greyed out with lock icon | Visual: Family unlocked, Animals locked at level 1 |
| 3.3 | Tap unlocked category → GameScene starts with that category | Visual: game shows jokes from selected category only |
| 3.4 | Tap locked category → nothing happens (or shows "unlock" prompt) | Visual: no scene transition |
| 3.5 | Hint button deducts 30 coins, removes 2 wrong options | Economy + Visual: coins decrease, 2 buttons disappear |
| 3.6 | Hint button greyed out when coins < 30 | Visual: button opacity reduced, no click response |
| 3.7 | Correct answer plays chime sound | Audio: hear sound on correct tap |
| 3.8 | Incorrect answer plays buzz sound | Audio: hear sound on wrong tap |
| 3.9 | Streak 5 plays fanfare | Audio: hear fanfare on 5th correct |
| 3.10 | Answer buttons animate in with stagger | Visual: buttons appear one by one with bounce |
| 3.11 | "+10💰" floats up on correct answer | Visual: text appears and floats upward |
| 3.12 | Screen shakes on streak milestones | Visual: camera shake at streak 5/10 |
| 3.13 | Desktop keyboard H key triggers hint | Test: press H → hint activates |
| 3.14 | All sounds load without errors | Console: no audio load failures |

---

## 4. Increment 4 — Growth Features

**Goal:** Achievements, share cards, leaderboard, analytics, A/B testing framework.

### 4.1 New file: `src/data/Achievements.ts`

**Purpose:** Achievement definitions and tracking.

**Contents:**
- `AchievementId` enum: FirstStep, Streak5, Streak10, CategoryMaster, Collector7Days, NoHints20, HumorMaster100
- `Achievement` interface: `{ id: AchievementId; name: string; description: string; reward: number; condition: (stats) => boolean }`
- `AchievementsManager` class:
  - `_definitions: Achievement[]` — all achievements
  - `_earned: AchievementId[]` — loaded from LocalData
  - `check(stats: GameStats): AchievementId[]` — returns newly earned achievements
  - `award(id: AchievementId): void` — add to earned, give coins
  - `isEarned(id: AchievementId): boolean`
  - `getAll(): { achievement: Achievement; earned: boolean }[]`
  - Extends EventEmitter → emits `'achievementEarned'`
- localStorage: `achievements` (JSON array of IDs)

**Depends on:** Economy.ts (1.4), LocalData.ts (2.1)

### 4.2 New file: `src/game/gui/ShareCard.ts`

**Purpose:** Generate shareable card image for social platforms.

**Contents:**
- `ShareCard` class:
  - `generate(stats: { streak: number; correct: number; level: number }): void`
  - Creates temporary Phaser Canvas with:
    - Background gradient
    - Text: "Я угадал {streak} подряд в Анекдотах!"
    - Level badge
    - App link
  - Calls `ysdk.adv.share()` or native share API
  - Destroys canvas after share
- Share reward: +50 coins (once per day), tracked via LocalData `lastShareDate`

**Depends on:** YaGamesApi.ts (existing), Economy.ts (1.4)

### 4.3 New file: `src/game/mng/ABTest.ts`

**Purpose:** Simple A/B test framework for tunable parameters.

**Contents:**
- `ABTest` class:
  - `_variants: Map<string, string>` — parameter → variant mapping
  - `init(): void` — read from localStorage or assign random variant
  - `getVariant<T>(param: string, defaultVal: T): T`
  - `setVariant(param: string, variant: string): void` (admin override)
  - `getParams(): Record<string, string>` — all active variants
- Testable parameters from GDD:
  - `ad_cooldown`: variants [3, 4, 5, 6]
  - `hint_cost`: variants [20, 30, 50]
  - `correct_reward`: variants [5, 10, 15]
  - `rewarded_frequency`: variants [3, 5, 7]
- Integration: Config reads from ABTest on init

**Depends on:** Config.ts (1.2)

### 4.4 New file: `src/game/mng/Analytics.ts`

**Purpose:** Event tracking for Yandex Games analytics.

**Contents:**
- `Analytics` class:
  - `trackEvent(name: string, params?: Record<string, any>): void`
  - Predefined events:
    - `joke_started` — `{ jokeId, category, difficulty }`
    - `joke_answered` — `{ jokeId, correct, streak, timeMs }`
    - `hint_used` — `{ jokeId, coinsRemaining }`
    - `ad_shown` — `{ type: 'interstitial' | 'rewarded' }`
    - `daily_claimed` — `{ day, coins }`
    - `level_up` — `{ newLevel, totalXP }`
    - `category_selected` — `{ category, isUnlocked }`
    - `session_end` — `{ duration, jokesPlayed, correctRate, coinsEarned }`
  - Sends via `ysdk.features?.Analytics?.sendEvent()` if available
  - Fallback: console.log in debug mode

**Depends on:** YaGamesApi.ts (existing)

### 4.5 Modified file: `src/game/scenes/GameScene.ts` (analytics integration)

**Add analytics calls to existing flow:**
- On `loadNextJoke()`: `Analytics.trackEvent('joke_started', { jokeId, category, difficulty })`
- On `onAnswerSelected()`: `Analytics.trackEvent('joke_answered', { jokeId, correct, streak, timeMs })`
- On `onHintTap()`: `Analytics.trackEvent('hint_used', { jokeId, coinsRemaining })`
- On ad show: `Analytics.trackEvent('ad_shown', { type })`
- On scene shutdown: `Analytics.trackEvent('session_end', { ... })`

**Depends on:** Analytics.ts (4.4)

### 4.6 Modified file: `src/game/scenes/MenuScene.ts` (achievements + share)

**Add to menu footer:**
- Achievements button → shows achievement popup overlay
- Share button → generates share card
- Leaderboard button (if Yandex leaderboard API available)

### 4.7 Acceptance Criteria — Increment 4

| # | Criterion | Verification |
|---|-----------|-------------|
| 4.1 | Achievements unlock when conditions are met | Test: complete 1 joke → "Первый шаг" achievement |
| 4.2 | Achievement popup shows with reward animation | Visual: popup with name, description, +50 coins |
| 4.3 | Share button generates shareable card | Test: tap share → share dialog appears |
| 4.4 | Share reward (+50 coins) given once per day | Test: share twice in one day → only first gives coins |
| 4.5 | A/B test framework assigns variants correctly | Test: reload 100 times, verify variant distribution |
| 4.6 | Analytics events fire on key actions | Console: verify event logging in debug mode |
| 4.7 | No performance degradation with all systems active | Test: 30-joke session, monitor frame rate (target: 60fps) |
| 4.8 | All new files import correctly, no circular deps | Build: `npx tsc --noEmit` passes (ignoring pre-existing tsconfig issues) |

---

## 5. File Dependency Graph

```
Increment 1:
  Config.ts ──────────────────────────────────┐
  JokesData.ts (NEW) ─────────────────────────┤
  Economy.ts (NEW) ───────────────────────────┤
  GameData.ts ────────────────────────────────┤
  GameScene.ts ◄─── GameData, Economy, Config │
  AdMng.ts ◄─── Config                       │
                                              │
Increment 2:                                  │
  LocalData.ts ◄─── (standalone)              │
  DailyRewards.ts (NEW) ◄─── LocalData, Config│
  Progression.ts (NEW) ◄─── Economy, LocalData, JokesData
  StickyBanner.ts (NEW) ◄─── YaGamesApi, Config
  GameScene.ts ◄─── DailyRewards, Progression, StickyBanner
                                              │
Increment 3:                                  │
  MenuScene.ts ◄─── Progression, JokesData   │
  CategoryButton.ts (NEW) ◄─── MyButton       │
  GameScene.ts ◄─── (hint system additions)   │
  SndMng.ts ◄─── (SFX additions)             │
  Preloader.ts ◄─── DailyRewards              │
                                              │
Increment 4:                                  │
  Achievements.ts (NEW) ◄─── Economy, LocalData│
  ShareCard.ts (NEW) ◄─── YaGamesApi, Economy │
  ABTest.ts (NEW) ◄─── Config                 │
  Analytics.ts (NEW) ◄─── YaGamesApi          │
  GameScene.ts ◄─── Analytics                 │
  MenuScene.ts ◄─── Achievements, ShareCard   │
```

---

## 6. Files Summary

### New files (9):
| File | Increment | Lines est. | Purpose |
|------|-----------|------------|---------|
| `src/data/JokesData.ts` | 1 | ~2000+ | Joke database (100+ jokes) |
| `src/data/Economy.ts` | 1 | ~150 | Coin/XP management |
| `src/data/DailyRewards.ts` | 2 | ~80 | Daily login rewards |
| `src/data/Progression.ts` | 2 | ~120 | XP/levels/categories |
| `src/game/gui/StickyBanner.ts` | 2 | ~60 | Banner ad display |
| `src/game/gui/CategoryButton.ts` | 3 | ~80 | Category menu button |
| `src/data/Achievements.ts` | 4 | ~100 | Achievement system |
| `src/game/gui/ShareCard.ts` | 4 | ~120 | Social share card |
| `src/game/mng/ABTest.ts` | 4 | ~80 | A/B testing |
| `src/game/mng/Analytics.ts` | 4 | ~100 | Event tracking |

### Modified files (9):
| File | Increment | Nature of change |
|------|-----------|-----------------|
| `src/data/Config.ts` | 1 | Add 12+ constants, remove AD_PERIOD |
| `src/data/GameData.ts` | 1 | Gut jokes array, repurpose as state shell |
| `src/game/scenes/GameScene.ts` | 1-3 | Major refactor: quiz mechanic, state machine, hints, animations |
| `src/game/mng/AdMng.ts` | 1 | Time-based → event-based interstitials |
| `src/data/LocalData.ts` | 2 | Expand from 2 to 15+ fields |
| `src/game/scenes/MenuScene.ts` | 3-4 | Category grid, achievements, share |
| `src/sound/SndMng.ts` | 3 | Add 10 SFX aliases |
| `src/game/scenes/Preloader.ts` | 3 | Update subtitle, daily reward trigger |
| `src/index.ts` | 2 | Add StickyBanner scene if needed |

### Unchanged files:
| File | Reason |
|------|--------|
| `src/api/YaGamesApi.ts` | Sufficient as-is (showFullscreenAdv, showRewarded, showBanner) |
| `src/game/gui/MyButton.ts` | Reused for all buttons |
| `src/game/gui/MyContainer.ts` | Base class, no changes |
| `src/game/gui/MyText.ts` | Text utility, no changes |
| `src/game/gui/AdShower.ts` | Countdown overlay, reused as-is |
| `src/game/gui/LevelButton.ts` | May be removed or repurposed |
| `src/game/events/FrontEvents.ts` | Event bus, no changes |
| `src/utils/*.ts` | Utility files, no changes |
| `src/interfaces/*.ts` | Interfaces, no changes |

---

## 7. Risk Register

| Risk | Impact | Mitigation | Affected Increment |
|------|--------|------------|-------------------|
| 100+ jokes content creation bottleneck | Delayed launch | Start with 50 jokes (minimum viable), plan 10/week additions | 1 |
| GameScene refactor breaks existing navigation | Regression | Create new state machine alongside old code, switch via flag | 1 |
| localStorage corruption on old saves | Data loss | Migration logic in LocalData.load(), fallback to defaults | 2 |
| Particle effects not supported by Phaser atlas | Reduced juice | Fallback to text-only effects, add particles later | 3 |
| Yandex SDK changes between increments | Integration failure | Abstract SDK calls behind YaGamesApi, test each increment | 4 |
| Circular dependencies between new modules | Build failure | Strict dependency tree (Section 5), no reverse imports | All |

---

## 8. Testing Strategy

### Per-increment verification:

**Increment 1:**
- Visual: manual playtest of quiz mechanic
- Unit: JokesData.shuffleOptions() correctness
- Integration: Economy.addCoins() → localStorage → reload → verify
- Ad timing: count jokes between interstitials

**Increment 2:**
- Unit: DailyRewards date logic (mock dates)
- Unit: Progression level thresholds
- Integration: save → reload → all fields preserved
- Edge cases: midnight crossing for daily rewards, localStorage full

**Increment 3:**
- Visual: menu category grid, hint animation
- Audio: all sounds play without errors
- Performance: no frame drops during animations
- Responsive: resize during animations

**Increment 4:**
- Unit: ABTest variant distribution
- Integration: Analytics events fire on correct triggers
- E2E: full session from menu → game → achievements → share
- Performance: 30+ jokes without memory leak

---

*Technical Plan v1.0 — Maps GDD sections 1-12 and GAMEPLAY_MECHANICS sections 1-11 to specific file-level changes across 4 incremental deliveries.*
