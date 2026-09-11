
/**
 * Game Content Interfaces
 * Central type definitions for all data-driven game content.
 */

// ============================================================
// Road & Geometry
// ============================================================

export interface RoadConfig {
    width: number;
    laneCount: number;
    leftEdge: number;
    rightEdge: number;
}

export interface PlayerConfig {
    width: number;
    height: number;
    startY: number;      // distance from bottom
    startLane: number;   // 0-based default lane
    lerpSpeed: number;   // lane-switching smoothness
}

export interface TrafficCarConfig {
    width: number;
    height: number;
    spawnY: number;
    despawnY: number;
}

// ============================================================
// Difficulty & Progression
// ============================================================

export interface DifficultyStage {
    /** Elapsed game-time (seconds) when this stage begins */
    timeThreshold: number;
    /** Traffic speed multiplier applied to base speed */
    speedMultiplier: number;
    /** Average spawn interval in ms at this stage */
    spawnInterval: number;
    /** Max number of simultaneous active cars */
    maxActiveCars: number;
    /** Probability of spawning two cars at once */
    doubleSpawnChance: number;
    /** Probability of spawning three cars at once */
    tripleSpawnChance: number;
}

export interface DifficultyProgression {
    /** Ordered stages from easiest to hardest */
    stages: DifficultyStage[];
    /** Time (seconds) for the difficulty ramp to reach maximum */
    rampDuration: number;
}

// ============================================================
// Traffic
// ============================================================

export interface TrafficColorEntry {
    /** Hex color value */
    color: number;
    /** Weight for weighted random selection (higher = more common) */
    weight: number;
    /** Optional display name for debugging */
    name?: string;
}

export interface TrafficBehaviorProfile {
    /** Unique identifier */
    id: string;
    /** Speed multiplier range [min, max] */
    speedRange: [number, number];
    /** Weight for selection */
    weight: number;
    /** Whether this car type can be a near-miss target */
    nearMissEligible: boolean;
}

// ============================================================
// Scoring
// ============================================================

export interface ScoringConfig {
    /** Points per second of survival */
    pointsPerSecond: number;
    /** Base near-miss bonus */
    nearMissBonus: number;
    /** Multiplier per near-miss accumulated (additive) */
    nearMissMultiplierIncrement: number;
    /** Distance divisor for distance-based score */
    distanceDivisor: number;
}

// ============================================================
// Achievements
// ============================================================

export interface AchievementDefinition {
    /** Unique id, used as localStorage key suffix */
    id: string;
    /** Display name */
    name: string;
    /** Description shown to player */
    description: string;
    /** Condition type */
    conditionType: AchievementConditionType;
    /** Threshold value for the condition */
    threshold: number;
    /** Icon key (emoji or atlas frame name) */
    icon: string;
}

export enum AchievementConditionType {
    /** Total games played */
    TOTAL_GAMES = 'totalGames',
    /** Best score achieved */
    BEST_SCORE = 'bestScore',
    /** Best distance achieved */
    BEST_DISTANCE = 'bestDistance',
    /** Total near-misses across all games */
    TOTAL_NEAR_MISSES = 'totalNearMisses',
    /** Single-game near-miss count */
    SINGLE_NEAR_MISSES = 'singleNearMisses',
    /** Single-game distance */
    SINGLE_DISTANCE = 'singleDistance',
}

// ============================================================
// UI Strings
// ============================================================

export interface GameStrings {
    // Preloader
    preloaderTitle: string;
    preloaderSubtitle: string;
    preloaderMessage: string;
    preloaderError: string;

    // Menu
    menuTitle: string;
    menuSubtitle: string;
    menuBestScore: string;
    menuPlayButton: string;
    menuControlsHint: string;
    menuTouchHint: string;

    // Gameplay HUD
    hudScorePrefix: string;
    hudDistanceUnit: string;
    hudNearMissIcon: string;
    hudPauseTitle: string;
    hudPauseResumeHint: string;

    // Near-miss popup
    nearMissPopupPrefix: string;

    // Game Over
    gameOverTitle: string;
    gameOverScorePrefix: string;
    gameOverNewRecord: string;
    gameOverDistance: string;
    gameOverNearMisses: string;
    gameOverBestPrefix: string;
    gameOverRetryButton: string;
    gameOverMenuButton: string;
}

// ============================================================
// Color Palette
// ============================================================

export interface GameColorPalette {
    road: number;
    roadEdge: number;
    roadLine: number;
    grass: number;
    grassDark: number;
    laneMarking: number;
    player: number;
    playerDark: number;
    hudBackground: number;
    textColor: string;
    textShadow: string;
    gold: string;
    errorRed: string;
    gameOverBackground: number;
}

// ============================================================
// Master Game Content Bundle
// ============================================================

export interface GameContent {
    road: RoadConfig;
    player: PlayerConfig;
    traffic: TrafficCarConfig;
    difficulty: DifficultyProgression;
    scoring: ScoringConfig;
    trafficColors: TrafficColorEntry[];
    trafficProfiles: TrafficBehaviorProfile[];
    achievements: AchievementDefinition[];
    strings: GameStrings;
    colors: GameColorPalette;
}
