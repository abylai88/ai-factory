
import { DifficultyStage } from "@/interfaces/GameContent";
import { STRINGS_RU } from "./Strings";
import { DIFFICULTY_STAGES, interpolateDifficulty } from "./LevelData";
import { ACHIEVEMENTS } from "./Achievements";
import { TRAFFIC_COLORS } from "./TrafficData";

/**
 * Master configuration for all game constants.
 *
 * This file holds the "raw" config values (screen size, geometry, etc.)
 * and the data-driven content loaded from the content modules.
 * Game logic reads from Config; content designers modify the content files.
 */
export const Config = {

    // ── Display ──
    GW: 2400,
    GH: 1080,

    GW_HALF: 2400 / 2,
    GH_HALF: 1080 / 2,

    checkOrientation: false,
    GW_SAFE: 1300,
    GH_SAFE: 1080,

    TAP_TO_START: false,
    DRAW_DEBUG_BORDER: false,

    // ── Ads ──
    AD_PERIOD: 1.1,

    // ── Road geometry ──
    ROAD_WIDTH: 1000,
    LANE_COUNT: 5,
    get LANE_WIDTH(): number { return this.ROAD_WIDTH / this.LANE_COUNT; },
    ROAD_LEFT: 1200 - 500, // GW_HALF - ROAD_WIDTH/2
    ROAD_RIGHT: 1200 + 500,

    // ── Player ──
    PLAYER_WIDTH: 80,
    PLAYER_HEIGHT: 140,
    PLAYER_START_Y: 350, // distance from bottom
    PLAYER_START_LANE: 2,
    PLAYER_LERP_SPEED: 12,

    // ── Traffic ──
    CAR_WIDTH: 80,
    CAR_HEIGHT: 140,
    SPAWN_Y: -200, // off-screen top
    DESPAWN_Y: 1300, // off-screen bottom
    TRAFFIC_POOL_SIZE: 15,

    // ── Speeds (pixels per second) ──
    BASE_SPEED: 300,
    SPEED_INCREMENT: 8, // per second of gameplay
    MAX_SPEED: 800,

    // ── Near-miss ──
    NEAR_MISS_THRESHOLD: 30, // extra pixels beyond car width
    NEAR_MISS_SAFE_DISTANCE: 2, // car heights from player

    // ── Scoring ──
    SCORE_PER_SECOND: 10,
    NEAR_MISS_BONUS: 50,
    NEAR_MISS_SCORE_MULTIPLIER: 0.05,

    // ── Spawn ──
    MIN_SPAWN_INTERVAL: 400, // ms
    MAX_SPAWN_INTERVAL: 1200, // ms
    SPAWN_INTERVAL_DECREASE: 5, // per second of gameplay

    // ── Difficulty ──
    DIFFICULTY_RAMP_TIME: 180, // full difficulty in 3 minutes

    // ── Input ──
    SWIPE_THRESHOLD: 40, // minimum px for swipe detection

    // ── Visual constants ──
    ROAD_LINE_SPACING: 60,
    ROAD_LINE_LENGTH: 30,
    GRASS_STRIPE_HEIGHT: 40,
    GRASS_STRIPE_SPACING: 80,
    CAR_BORDER_RADIUS: 8,
    HUD_HEIGHT: 80,

    // ── Text Styles ──
    FONT_FAMILY: 'Ubuntu',

    // ── Layout ──
    PLAY_BUTTON_WIDTH: 300,
    PLAY_BUTTON_HEIGHT: 100,
    PLAY_BUTTON_RADIUS: 20,

    // ── Colors ──
    COLORS: {
        ROAD: 0x333333,
        ROAD_EDGE: 0x555555,
        GRASS: 0x2d5a1e,
        GRASS_DARK: 0x1e4a14,
        LANE_MARKING: 0xffffff,
        PLAYER: 0x2196f3,
        PLAYER_DARK: 0x1565c0,
        HUD_BG: 0x000000,
        TEXT: '#ffffff',
        TEXT_SHADOW: '#000000',
        GOLD: '#ffd700',
        ERROR_RED: '#ff0000',
        GAME_OVER_BG: 0x1a1a2e,
        PLAY_BUTTON: 0x4caf50,
        MENU_BUTTON: 0x555555,
        RETRY_BUTTON: 0x4caf50,
        NEW_RECORD: '#ffd700',
        WINDSHIELD: 0x87ceeb,
        HEADLIGHT: 0xffff88,
        HEADLIGHT_ALT: 0xffffaa,
        TAILLIGHT: 0xff3333,
        TAILLIGHT_ALT: 0xff0000,
        SIDEWALK: 0x888888,
        ROAD_EDGE_LINE: 0xffffff,
    },

    // ── Traffic car color palette (legacy flat array) ──
    TRAFFIC_COLORS: [
        0xf44336, // red
        0xff9800, // orange
        0xffeb3b, // yellow
        0x4caf50, // green
        0x9c27b0, // purple
        0xe91e63, // pink
        0x00bcd4, // cyan
        0xff5722, // deep orange
        0x795548, // brown
        0x607d8b, // blue-grey
    ],

    // ── Content data helpers ──

    /** Interpolated difficulty stage at current game time */
    getDifficultyStage(gameTime: number): DifficultyStage {
        return interpolateDifficulty(DIFFICULTY_STAGES, gameTime);
    },

    /** Access to the current language strings */
    getStrings() {
        return STRINGS_RU;
    },

    /** Access to achievement definitions */
    getAchievements() {
        return ACHIEVEMENTS;
    },
};
