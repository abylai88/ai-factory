# Gameplay Mechanics Design: Анекдоты — Угадай Концовку

**Version:** 1.0
**Date:** 2026-09-13
**Platform:** Yandex Games (Web, Phaser 3 + TypeScript)

---

## 1. Physics & Timing

### 1.1 Core Timing Constants

```typescript
// TimingConfig.ts
export const Timing = {
    // Transition durations (ms)
    CURTAIN_FADE: 750,           // black curtain fade in/out
    JOKES_FADE_IN: 300,          // new joke content fade in
    JOKES_FADE_OUT: 200,         // old content fade out (faster = snappy)
    BUTTONS_STAGGER: 80,         // delay between each answer button appearing
    FEEDBACK_DISPLAY: 1500,      // how long to show correct/incorrect before next
    PUNCHLINE_REVEAL: 600,       // punchline text fade-in duration
    
    // Answer feedback
    CORRECT_HIGHLIGHT: 200,      // time to highlight correct answer
    INCORRECT_SHAKE: 400,        // shake animation duration on wrong answer
    STREAK_PULSE: 300,           // streak counter pulse duration
    
    // Ad flow
    AD_COUNTDOWN: 3,             // seconds for countdown before interstitial
    AD_COOLDOWN_JOKES: 4,        // interstitial every N jokes
    AD_MIN_GAP: 2,               // minimum jokes between interstitials
    
    // Coins animation
    COIN_FLOAT_DURATION: 800,    // "+10 монет!" float-up duration
    COIN_FLOAT_HEIGHT: 120,      // pixels to float up
    
    // Hint
    HINT_REMOVE_DURATION: 400,   // animation for removing 2 wrong options
    HINT_COST: 30,               // coins
    
    // Economy
    CORRECT_REWARD: 10,
    STREAK_BONUS_5: 25,
    STREAK_BONUS_10: 50,
    STREAK_BONUS_25: 100,
    REWARDED_AMOUNT: 100,
};
```

### 1.2 Animation Easing Curves

| Animation | Ease Function | Duration | Rationale |
|-----------|---------------|----------|-----------|
| Button appear | `easeOutBack` | 300ms | Bouncy entrance, playful feel |
| Button press | `easeInQuad` | 100ms | Quick squish, immediate feedback |
| Correct highlight | `easeOutElastic` | 500ms | Celebratory bounce |
| Incorrect shake | `easeOutBounce` | 400ms | Physical wobble, not harsh |
| Streak pulse | `easeOutElastic` | 300ms | Energy burst |
| Float text (+10) | `easeOutCubic` | 800ms | Smooth float upward |
| Curtain fade | `easeInOutSine` | 750ms | Gentle scene transition |
| Punchline reveal | `easeOutCubic` | 600ms | Smooth text appearance |
| Hint option removal | `easeInBack` | 400ms | Options shrink away |
| Daily reward pop | `easeOutBack` | 400ms | Bouncy notification |

### 1.3 Screen Shake Parameters

```typescript
export const ShakeConfig = {
    CORRECT: {
        intensity: 0.002,
        duration: 200,
        frequency: 50
    },
    STREAK_MILESTONE: {
        intensity: 0.005,
        duration: 400,
        frequency: 40
    },
    INCORRECT: {
        intensity: 0.003,
        duration: 300,
        frequency: 30
    }
};
```

---

## 2. Feedback Systems

### 2.1 Answer Feedback Matrix

| State | Visual | Audio | Animation |
|-------|--------|-------|-----------|
| **Correct** | Green highlight (#4CAF50), coin icon | Positive chime (250Hz, 200ms) | Elastic scale pulse, confetti burst |
| **Incorrect** | Red highlight (#F44336), correct shown green | Negative buzz (150Hz, 300ms) | Horizontal shake, sad trombone |
| **Streak 5** | Gold text, fire emoji 🔥 | Fanfare jingle | Screen pulse, particles |
| **Streak 10** | Rainbow text, sparkle | Longer fanfare | Major screen shake, full-screen flash |
| **Streak 25** | Diamond text, crown 👑 | Epic fanfare | Massive celebration, all effects |
| **Hint used** | Grey out removed options | Pop sound | Shrink-fade animation |
| **Coins earned** | "+10" floats up gold | Coin clink | Float + fade |

### 2.2 Visual Feedback Layers

```
Layer 0: Background (static)
Layer 1: Joke content (text)
Layer 2: Answer buttons (interactive)
Layer 3: UI overlay (coins, streak, hint button)
Layer 4: Feedback overlay (correct/incorrect flash)
Layer 5: Particle effects
Layer 6: Floating text (+10, streak bonuses)
Layer 7: Screen effects (shake, flash)
```

### 2.3 Color Palette

```typescript
export const Colors = {
    // UI
    BACKGROUND: 0x1a1a2e,
    TEXT_PRIMARY: 0xdddddd,
    TEXT_SECONDARY: 0x999999,
    
    // Answer states
    ANSWER_DEFAULT: 0x333355,
    ANSWER_HOVER: 0x444477,
    ANSWER_PRESSED: 0x222244,
    CORRECT: 0x4CAF50,
    INCORRECT: 0xF44336,
    STREAK_GOLD: 0xFFD700,
    
    // Coins
    COIN_COLOR: 0xFFD700,
    COIN_SHADOW: 0xB8860B,
    
    // Effects
    PARTICLE_CORRECT: [0x4CAF50, 0x66BB6A, 0x81C784],
    PARTICLE_STREAK: [0xFFD700, 0xFFA000, 0xFF6F00],
    PARTICLE_MILESTONE: [0xFF0000, 0xFF6600, 0xFFFF00, 0x00FF00, 0x0066FF, 0x9900FF],
};
```

### 2.4 Audio Feedback Design

```typescript
// Sound effects to implement
export enum SFX {
    CLICK = 'click',
    CORRECT = 'correct',
    INCORRECT = 'incorrect',
    STREAK_5 = 'streak_5',
    STREAK_10 = 'streak_10',
    STREAK_25 = 'streak_25',
    COIN_EARN = 'coin_earn',
    COIN_SPEND = 'coin_spend',
    HINT_USE = 'hint_use',
    HINT_FAIL = 'hint_fail',
    AD_READY = 'ad_ready',
    DAILY_REWARD = 'daily_reward',
    LEVEL_UP = 'level_up',
    ACHIEVEMENT = 'achievement',
    BUTTON_TAP = 'button_tap',
    TRANSITION = 'transition',
};

// Audio specifications
export const SFXSpecs = {
    [SFX.CORRECT]: { freq: 523.25, duration: 200, type: 'sine', volume: 0.6 },
    [SFX.INCORRECT]: { freq: 220, duration: 300, type: 'sawtooth', volume: 0.4 },
    [SFX.STREAK_5]: { freq: [523, 659, 784], duration: 400, type: 'sine', volume: 0.7 },
    [SFX.COIN_EARN]: { freq: 1200, duration: 100, type: 'sine', volume: 0.3 },
    [SFX.HINT_USE]: { freq: 800, duration: 150, type: 'triangle', volume: 0.5 },
    [SFX.LEVEL_UP]: { freq: [440, 554, 659, 880], duration: 600, type: 'sine', volume: 0.8 },
    [SFX.BUTTON_TAP]: { freq: 600, duration: 50, type: 'sine', volume: 0.2 },
};
```

---

## 3. Juice Effects

### 3.1 Particle Systems

#### 3.1.1 Correct Answer Particles
```typescript
const CorrectParticles = {
    texture: 'particle_circle',
    quantity: 15,
    lifespan: 800,
    gravityY: 200,
    speed: { min: 100, max: 200 },
    angle: { min: 220, max: 320 },  // upward spread
    scale: { start: 0.3, end: 0 },
    tint: Colors.PARTICLE_CORRECT,
    emitting: false,
    blendMode: 'ADD',
};
// Trigger: burst at answer button position
```

#### 3.1.2 Streak Milestone Particles
```typescript
const StreakParticles = {
    texture: 'particle_star',
    quantity: 30,
    lifespan: 1200,
    gravityY: 100,
    speed: { min: 150, max: 300 },
    angle: { min: 0, max: 360 },
    scale: { start: 0.5, end: 0 },
    tint: Colors.PARTICLE_STREAK,
    emitting: false,
    blendMode: 'ADD',
};
// Trigger: full-screen burst at streak milestones
```

#### 3.1.3 Coin Float Particles
```typescript
const CoinParticles = {
    texture: 'particle_circle',
    quantity: 8,
    lifespan: 600,
    gravityY: -50,
    speed: { min: 30, max: 80 },
    angle: { min: 250, max: 290 },
    scale: { start: 0.2, end: 0 },
    tint: Colors.COIN_COLOR,
    emitting: false,
};
// Trigger: at coin earn position
```

### 3.2 Screen Effects

#### 3.2.1 Background Pulse
```typescript
// On correct answer
this.tweens.add({
    targets: this._bg,
    alpha: 1.1,
    duration: 100,
    yoyo: true,
    ease: 'Sine.Out'
});

// On streak milestone
this.tweens.add({
    targets: this._bg,
    scale: 1.02,
    duration: 200,
    yoyo: true,
    ease: 'Elastic.Out'
});
```

#### 3.2.2 Answer Button Effects

| Effect | Trigger | Implementation |
|--------|---------|----------------|
| **Scale bounce** | Button appears | `scale: 0 → 1.1 → 1` with `easeOutBack` |
| **Press squish** | Pointer down | `scaleX: 1 → 0.9`, `scaleY: 1 → 1.1` |
| **Hover glow** | Pointer over | Add glow tint, scale 1.05 |
| **Correct pulse** | Correct answer | `scale: 1 → 1.15 → 1` with `easeOutElastic` |
| **Incorrect shake** | Wrong answer | `x: ±8px` with `easeOutBounce` |
| **Remove shrink** | Hint used | `scale: 1 → 0` with `easeInBack` |

#### 3.2.3 Text Effects

| Element | Effect | Trigger |
|---------|--------|---------|
| **Setup text** | Fade in from bottom | New joke loaded |
| **Punchline text** | Typewriter reveal | After answer shown |
| **"+10 монет"** | Float up + fade | Correct answer |
| **"🔥 5 подряд!"** | Scale pulse + glow | Streak milestone |
| **Streak counter** | Increment animation | Each correct answer |
| **Coin balance** | Count-up animation | Coins earned |

### 3.3 Screen Transitions

#### 3.3.1 Black Curtain (Current)
- Duration: 750ms
- Ease: `easeInOutSine`
- Used for: scene transitions, joke changes

#### 3.3.2 Content Transition
```
1. Current content fades out (200ms, easeOutQuad)
2. Answer buttons shrink away (150ms staggered)
3. Black curtain fades in (300ms, easeInOutSine)
4. Load new joke data
5. Black curtain fades out (300ms, easeInOutSine)
6. New content fades in (300ms, easeOutCubic)
7. New buttons bounce in (300ms staggered, easeOutBack)
```

#### 3.3.3 Interstitial Transition
```
1. Content fades out (200ms)
2. "Небольшая реклама через..." text appears (300ms)
3. Countdown: 3 → 2 → 1 (1s each)
4. Screen fades to black (500ms)
5. Interstitial ad shown
6. On close: screen fades from black (500ms)
7. Content fades in (300ms)
```

---

## 4. Input Handling

### 4.1 Input Map

| Input | Action | Condition |
|-------|--------|-----------|
| **Tap answer button** | Select answer | State = IDLE, button not disabled |
| **Tap hint button** | Use hint | State = IDLE, coins ≥ 30, hints remaining > 0 |
| **Tap rewarded button** | Watch ad | State = IDLE, after every 5 jokes |
| **Tap next button** | Next joke | State = PROCESSING |
| **Keyboard A/Left** | Select option A (if highlighted) | Desktop only |
| **Keyboard B/Right** | Select option B | Desktop only |
| **Keyboard C/Up** | Select option C | Desktop only |
| **Keyboard D/Down** | Select option D | Desktop only |
| **Keyboard H** | Use hint | Desktop only |
| **Keyboard Space/Enter** | Next joke / confirm | Desktop only |

### 4.2 Touch Handling

```typescript
// Touch zones (2400×1080)
const TouchZones = {
    ANSWER_A: { x: 400, y: 550, width: 700, height: 180 },
    ANSWER_B: { x: 1200, y: 550, width: 700, height: 180 },
    ANSWER_C: { x: 400, y: 750, width: 700, height: 180 },
    ANSWER_D: { x: 1200, y: 750, width: 700, height: 180 },
    HINT_BUTTON: { x: 200, y: 980, width: 300, height: 80 },
    REWARDED_BUTTON: { x: 2200, y: 980, width: 300, height: 80 },
    NEXT_BUTTON: { x: 1200, y: 900, width: 400, height: 100 },
};
```

### 4.3 Input State Machine

```
States:
  IDLE        → accepting input
  PROCESSING  → showing result, waiting for "next"
  AD_BREAK    → ad countdown/ad playing
  REWARDED    → rewarded ad playing
  TRANSITION  → fading between jokes
  HINT_ANIM   → hint animation playing
  DISABLED    → no input accepted

Transitions:
  IDLE → PROCESSING: answer button tapped
  PROCESSING → IDLE: next button tapped
  PROCESSING → AD_BREAK: jokeCount % AD_COOLDOWN_JOKES == 0
  IDLE → REWARDED: rewarded button tapped
  REWARDED → IDLE: ad complete
  AD_BREAK → IDLE: ad complete
  IDLE → HINT_ANIM: hint button tapped
  HINT_ANIM → IDLE: hint animation complete
  Any → TRANSITION: joke change initiated
  TRANSITION → IDLE: transition complete
```

### 4.4 Input Debouncing

```typescript
// Prevent double-tap issues
const DEBOUNCE = {
    ANSWER: 300,      // ms after answer before next input
    HINT: 500,        // ms after hint use
    NEXT: 200,        // ms after next tap
    AD_BUTTON: 1000,  // ms after ad button tap
};

// Implementation
private _lastInputTime: number = 0;

private canAcceptInput(): boolean {
    return this.time.now - this._lastInputTime > DEBOUNCE.ANSWER;
}
```

### 4.5 Hover States (Desktop)

```typescript
// Button hover behavior
button.on('pointerover', () => {
    if (this._state === GameState.IDLE) {
        button.setTint(0x444477);
        this.tweens.add({
            targets: button,
            scaleX: 1.05,
            scaleY: 1.05,
            duration: 150,
            ease: 'Sine.Out'
        });
    }
});

button.on('pointerout', () => {
    button.clearTint();
    this.tweens.add({
        targets: button,
        scaleX: 1,
        scaleY: 1,
        duration: 150,
        ease: 'Sine.Out'
    });
});
```

---

## 5. Difficulty Curve

### 5.1 Player Level Progression

| Level | XP Required | Total XP | Categories Unlocked | Difficulty |
|-------|-------------|----------|---------------------|------------|
| 1 | 0 | 0 | Family | Easy |
| 2 | 100 | 100 | + Animals | Easy |
| 3 | 200 | 300 | + Work | Easy-Medium |
| 4 | 300 | 600 | + School | Medium |
| 5 | 400 | 1000 | + Dark Humor | Medium |
| 6 | 500 | 1500 | + Medical | Medium-Hard |
| 7 | 750 | 2250 | + Absurdist | Hard |
| 8 | 1000 | 3250 | All unlocked | Hard |

**XP per action:**
- Correct answer: +10 XP
- Streak bonus: +5 XP per streak level (e.g., streak 5 = +25 XP)
- Daily login: +20 XP

### 5.2 Distractor Difficulty by Level

```typescript
export const DifficultyConfig = {
    EASY: {
        levelRange: [1, 10],
        distractorType: 'obviously_wrong',
        examples: [
            // Setup: "Мам, смотри голубь! У тебя есть хлеб?"
            // Correct: "Без хлеба ешь!"
            // Easy distractors (clearly wrong context):
            "Давай一起去公园散步吧",  // wrong language
            "Конечно, вот тебе кусочек!",  // too nice for black humor
            "Смотри, он улетел!"  // irrelevant
        ],
        timeToRead: 15,  // seconds
        allowSkip: true
    },
    MEDIUM: {
        levelRange: [11, 30],
        distractorType: 'plausible',
        examples: [
            // Distractors reference same context but wrong tone:
            "Мам, я тоже хочу голубя!",  // child's response
            "А почему ты кричишь?",  // confusion
            "Голуби не едят хлеб!"  // factual but wrong
        ],
        timeToRead: 12,
        allowSkip: true
    },
    HARD: {
        levelRange: [31, 50],
        distractorType: 'similar_tone',
        examples: [
            // Distractors are dark humor but wrong:
            "Без хлеба, но с горчицей!",  // dark but wrong
            "А хлеб закончился вчера!",  // plausible
            "Голубь уже съел весь хлеб!"  // twist but wrong
        ],
        timeToRead: 10,
        allowSkip: false
    },
    EXPERT: {
        levelRange: [51, Infinity],
        distractorType: 'very_close',
        examples: [
            // Distractors nearly match punchline style:
            "Без хлеба, а молоко есть?",  // same structure
            "Без хлеба, но с любовью!",  // same tone
            "Без хлеба, зато с юмором!"  // meta-humor
        ],
        timeToRead: 8,
        allowSkip: false
    }
};
```

### 5.3 Adaptive Difficulty

```typescript
export class DifficultyManager {
    private _correctRate: number = 0;
    private _recentAnswers: boolean[] = [];
    private _windowSize: number = 10;
    
    // Track recent performance
    recordAnswer(correct: boolean): void {
        this._recentAnswers.push(correct);
        if (this._recentAnswers.length > this._windowSize) {
            this._recentAnswers.shift();
        }
        this._correctRate = this._recentAnswers.filter(Boolean).length / this._recentAnswers.length;
    }
    
    // Get current difficulty tier
    getDifficultyTier(): DifficultyTier {
        // Base on player level
        let level = this.getPlayerLevel();
        let baseTier = this.getTierForLevel(level);
        
        // Adjust based on performance
        if (this._correctRate > 0.8 && level < 30) {
            // Player doing well, increase difficulty faster
            return this.upgradeTier(baseTier);
        } else if (this._correctRate < 0.4) {
            // Player struggling, decrease difficulty
            return this.downgradeTier(baseTier);
        }
        
        return baseTier;
    }
    
    // Joke selection based on difficulty
    selectJoke(availableJokes: Joke[]): Joke {
        let tier = this.getDifficultyTier();
        let candidates = availableJokes.filter(j => j.difficulty === tier.difficultyLevel);
        
        if (candidates.length === 0) {
            candidates = availableJokes;
        }
        
        // Prefer jokes not seen recently
        let unseen = candidates.filter(j => !this._recentJokes.includes(j.id));
        if (unseen.length > 0) candidates = unseen;
        
        // Random selection
        return candidates[Math.floor(Math.random() * candidates.length)];
    }
}
```

### 5.4 Session Difficulty Progression

```
Session Start:
  - Easy jokes (levels 1-10)
  - No timer pressure
  - Hints available

Mid-Session (after 10 jokes):
  - Medium difficulty
  - Slightly faster transitions
  - Hint cost reminder

Late Session (after 20 jokes):
  - Hard/Expert difficulty
  - Quick transitions
  - "Continue streak?" prompts

Session End (after 30+ jokes):
  - "You've seen all jokes in this category!"
  - Suggest switching categories
  - Show session stats
```

### 5.5 Category Difficulty Scaling

| Category | Base Difficulty | Special Rules |
|----------|-----------------|---------------|
| Family | Easy | Child-friendly distractors |
| Animals | Easy | Animal-themed puns |
| Work | Medium | Office humor context |
| School | Medium | Student/teacher dynamics |
| Dark Humor | Hard | Darker distractors allowed |
| Medical | Hard | Medical terminology |
| Absurdist | Expert | Non-sequitur distractors |
| Politics | Expert | Current events references |

---

## 6. Game Scene State Machine

### 6.1 State Diagram

```
                    ┌─────────────┐
                    │   IDLE      │←──────────────────┐
                    └──────┬──────┘                    │
                           │                           │
                    Player taps answer                │
                           │                           │
                    ┌──────▼──────┐                    │
                    │  PROCESSING │──── Next tap ──────┘
                    └──────┬──────┘
                           │
                    jokeCount % AD_COOLDOWN == 0?
                           │
                    ┌──────▼──────┐
                    │  AD_BREAK   │
                    └──────┬──────┘
                           │
                    Ad complete
                           │
                    ┌──────▼──────┐
                    │ TRANSITION  │
                    └──────┬──────┘
                           │
                    Load next joke
                           │
                    ┌──────▼──────┐
                    │   IDLE      │
                    └─────────────┘
```

### 6.2 State Handler Implementation

```typescript
enum GameState {
    IDLE = 'IDLE',
    PROCESSING = 'PROCESSING',
    AD_BREAK = 'AD_BREAK',
    REWARDED = 'REWARDED',
    TRANSITION = 'TRANSITION',
    HINT_ANIM = 'HINT_ANIM',
    DISABLED = 'DISABLED'
}

class GameStateMachine {
    private _state: GameState = GameState.DISABLED;
    private _stateTime: number = 0;
    
    transition(newState: GameState): boolean {
        if (!this.canTransition(this._state, newState)) {
            console.warn(`Invalid transition: ${this._state} → ${newState}`);
            return false;
        }
        
        this._state = newState;
        this._stateTime = this.scene.time.now;
        this.onStateEnter(newState);
        return true;
    }
    
    canTransition(from: GameState, to: GameState): boolean {
        const validTransitions: Record<GameState, GameState[]> = {
            [GameState.IDLE]: [GameState.PROCESSING, GameState.REWARDED, GameState.HINT_ANIM],
            [GameState.PROCESSING]: [GameState.IDLE, GameState.AD_BREAK, GameState.TRANSITION],
            [GameState.AD_BREAK]: [GameState.TRANSITION],
            [GameState.REWARDED]: [GameState.IDLE],
            [GameState.TRANSITION]: [GameState.IDLE],
            [GameState.HINT_ANIM]: [GameState.IDLE],
            [GameState.DISABLED]: [GameState.IDLE],
        };
        return validTransitions[from]?.includes(to) ?? false;
    }
    
    onStateEnter(state: GameState): void {
        switch (state) {
            case GameState.IDLE:
                this.enableInput();
                break;
            case GameState.PROCESSING:
                this.disableInput();
                this.showFeedback();
                break;
            case GameState.AD_BREAK:
                this.disableInput();
                this.showAdCountdown();
                break;
            case GameState.TRANSITION:
                this.disableInput();
                this.transitionToNextJoke();
                break;
        }
    }
}
```

---

## 7. Coin Economy Tuning

### 7.1 Income Sources

| Source | Amount | Frequency | Daily Potential |
|--------|--------|-----------|-----------------|
| Correct answer | +10 | Every joke | 150-300 |
| Streak 5 bonus | +25 | Every 5 correct | 50-100 |
| Streak 10 bonus | +50 | Every 10 correct | 25-50 |
| Streak 25 bonus | +100 | Every 25 correct | 10-20 |
| Daily login (day 1) | +50 | Once/day | 50 |
| Daily login (day 7) | +350 | Once/day | 350 |
| Rewarded ad | +100 | Every 5 jokes | 300-600 |
| **Total potential** | | | **935-1,470** |

### 7.2 Expense Sinks

| Sink | Cost | Frequency | Daily Drain |
|------|------|-----------|-------------|
| Hint (remove 2 options) | -30 | 2-5 times/session | 60-150 |
| Premium category unlock | -200 | Every 2-3 sessions | 100-200 |
| Cosmetic theme (P3) | -500 | Rare | 0-50 |
| **Total potential** | | | **160-400** |

### 7.3 Balance Analysis

```
Daily Income:  935 - 1,470 coins
Daily Expense:   160 - 400 coins
Net Daily:      535 - 1,070 coins

Time to unlock premium category (200 coins): 0.5 - 1 session
Time to buy 10 hints (300 coins): 0.3 - 0.6 session
Time to buy cosmetic (500 coins): 0.5 - 1 session

Balance verdict: HEALTHY
- Players earn enough to progress
- Premium content accessible in 2-3 sessions
- Hints are affordable but not free
- Rewarded ads provide meaningful boost
```

### 7.4 Coin Display Animation

```typescript
// Count-up animation for coin balance
function animateCoins(from: number, to: number, duration: number = 500): void {
    const diff = to - from;
    const steps = 20;
    const stepDuration = duration / steps;
    let current = from;
    let step = 0;
    
    const timer = scene.time.addEvent({
        delay: stepDuration,
        repeat: steps,
        callback: () => {
            step++;
            const progress = step / steps;
            const eased = EaseUtils.easeOutCubic(progress);
            current = Math.round(from + diff * eased);
            coinText.setText(current.toString());
            
            if (step === steps) {
                coinText.setText(to.toString());
                timer.remove();
            }
        }
    });
}
```

---

## 8. Streak System Tuning

### 8.1 Streak Milestones

| Streak | Bonus | Visual Effect | Sound Effect |
|--------|-------|---------------|--------------|
| 3 | +0 | Small pulse | Light chime |
| 5 | +25 | Gold glow | Fanfare |
| 10 | +50 | Screen shake | Major fanfare |
| 15 | +0 | Rainbow text | Ascending notes |
| 20 | +0 | Sparkle trail | Epic build |
| 25 | +100 | Full celebration | Grand fanfare |

### 8.2 Streak Reset Effects

```typescript
// When streak breaks
function onStreakBreak(): void {
    // Visual
    this.tweens.add({
        targets: this._streakText,
        alpha: 0,
        scaleX: 0.5,
        scaleY: 0.5,
        duration: 300,
        ease: 'Back.In'
    });
    
    // Screen effect
    this.cameras.main.shake(300, 0.003);
    
    // Audio
    SndMng.sfxPlay(SFX.INCORRECT, 0.5);
    
    // Particles (sad)
    this.emitParticles('streak_break', this._streakText.x, this._streakText.y);
}
```

### 8.3 Streak Persistence

```typescript
// Save best streak to localStorage
interface StreakData {
    current: number;      // current streak
    best: number;         // best ever streak
    bestToday: number;    // best today
    lastDate: string;     // last play date
}

// Reset bestToday if new day
function checkStreakReset(data: StreakData): StreakData {
    const today = new Date().toDateString();
    if (data.lastDate !== today) {
        data.bestToday = 0;
        data.lastDate = today;
    }
    return data;
}
```

---

## 9. Hint System Mechanics

### 9.1 Hint Availability

```typescript
const HintConfig = {
    MAX_HINTS_PER_SESSION: 5,           // max hints per session
    HINT_COST: 30,                      // coins per hint
    OPTIONS_TO_REMOVE: 2,               // remove 2 wrong options
    MIN_OPTIONS_FOR_HINT: 4,            // need 4 options to use hint
    HINT_COOLDOWN: 5000,               // ms between hints
    SHOW_HINT_REMINDER: 3,             // remind after 3 wrong answers
};
```

### 9.2 Hint Animation Sequence

```
1. Player taps hint button
2. Button pulse animation (100ms)
3. Coin deduction animation (-30 coins)
4. Two wrong options:
   a. Shake (200ms)
   b. Fade out (300ms)
   c. Shrink to nothing (400ms)
5. Remaining options reposition (optional, 300ms)
6. Hint button disabled for session
```

### 9.3 Hint Visual Feedback

```typescript
// Options to remove (randomly selected wrong ones)
function selectOptionsToRemove(joke: Joke, selectedAnswer: number): number[] {
    const wrongIndices = [0, 1, 2, 3].filter(i => i !== selectedAnswer);
    MyMath.shuffleArray(wrongIndices);
    return wrongIndices.slice(0, HintConfig.OPTIONS_TO_REMOVE);
}

// Animation for removed option
function animateOptionRemoval(button: AnswerButton): void {
    // Shake
    this.tweens.add({
        targets: button,
        x: button.x + 10,
        duration: 50,
        yoyo: true,
        repeat: 2,
        ease: 'Sine.InOut'
    });
    
    // Fade + shrink
    this.tweens.add({
        targets: button,
        alpha: 0,
        scaleX: 0.3,
        scaleY: 0.3,
        duration: HintConfig.HINT_REMOVE_DURATION,
        ease: 'Back.In',
        delay: 200,
        onComplete: () => {
            button.setVisible(false);
            button.disableInteractive();
        }
    });
}
```

---

## 10. Difficulty Curve Visualization

```
Difficulty
    │
    │                                          ┌──── Expert
    │                                    ┌─────┘
    │                              ┌─────┘
    │                        ┌─────┘ Hard
    │                  ┌─────┘
    │            ┌─────┘
    │      ┌─────┘ Medium
    │ ─────┘
    │ Easy
    └──────────────────────────────────────────── Player Level
        1    5    10   15   20   25   30   50   75  100

Engagement
    │
    │    ┌───┐
    │   │   │   ┌───┐
    │  │   │   │   │   ┌───┐
    │ │   │   │   │   │   │   ┌───┐
    ││   │   │   │   │   │   │   │   ┌───
    └──────────────────────────────────────────── Session Time
        0    5   10   15   20   25   30   35 min

    Peak 1: First correct answer (immediate feedback)
    Peak 2: Streak 5 milestone
    Peak 3: Category completion
    Peak 4: Daily reward claim
```

---

## 11. Implementation Priority

### Phase 1: Core Mechanics (MVP)
- [ ] Answer button system (4 options)
- [ ] Correct/incorrect feedback
- [ ] Basic coin earning (+10)
- [ ] Black curtain transition
- [ ] Keyboard input (desktop)

### Phase 2: Juice & Feedback
- [ ] Button hover/press animations
- [ ] Coin float animation
- [ ] Correct particle burst
- [ ] Screen shake on streak
- [ ] Sound effects (correct/incorrect)

### Phase 3: Advanced Systems
- [ ] Streak system with milestones
- [ ] Hint system
- [ ] Adaptive difficulty
- [ ] Daily rewards
- [ ] Rewarded ad integration

### Phase 4: Polish
- [ ] Full particle effects
- [ ] Achievement animations
- [ ] Level-up effects
- [ ] Category transition effects
- [ ] Final balance tuning

---

*This document defines all gameplay mechanics, timing, feedback systems, juice effects, input handling, and difficulty curve for the "Анекдоты — Угадай Концовку" game. All values are tunable via the config constants defined in each section.*
