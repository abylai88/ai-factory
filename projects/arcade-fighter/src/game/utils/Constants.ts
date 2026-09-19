export const GAME_WIDTH = 1280;
export const GAME_HEIGHT = 720;

export const PLAY_AREA = {
  x: 240,
  y: 160,
  width: 800,
  height: 400,
} as const;

export const GROUND_Y = PLAY_AREA.y + PLAY_AREA.height;
export const LEFT_BOUND = PLAY_AREA.x;
export const RIGHT_BOUND = PLAY_AREA.x + PLAY_AREA.width;

export const PHYSICS = {
  gravity: 800,
  groundFriction: 0.85,
  airFriction: 0.95,
  maxFallSpeed: 600,
  jumpCutMultiplier: 0.4,
  coyoteTime: 6,
  jumpBuffer: 8,
  dashSpeed: 500,
  dashFrames: 12,
  backDashSpeed: 400,
  backDashFrames: 10,
  maxPhysicsStep: 1000 / 60,
  deltaSmoothing: true,
  physicsIterations: 10,
} as const;

export const HITSTOP = {
  lightHit: 2,
  heavyHit: 4,
  specialHit: 6,
  counterHit: 4,
  koHit: 8,
  perfectBlock: 2,
  maxStack: 12,
  frameDuration: 1000 / 60,
} as const;

export const FIGHTER_STATES = {
  Idle: "idle",
  Walking: "walking",
  Jumping: "jumping",
  Crouching: "crouching",
  Attacking: "attacking",
  Blocking: "blocking",
  Hitstun: "hitstun",
  KO: "ko",
  CrouchAttack: "crouch_attack",
  Dashing: "dashing",
} as const;

export const COMBAT = {
  inputBuffer: 12,
  lightHitstun: 10,
  heavyHitstun: 16,
  blockDrainPerFrame: 5,
  perfectBlockWindow: 4,
  perfectBlockRefund: 10,
  perfectBlockAdvantage: 4,
  guardBreakDuration: 30,
  guardBreakPushback: 40,
  counterHitBonus: 1.25,
  comboScaling: [
    1.0, 0.9, 0.8, 0.7, 0.6, 0.6, 0.6,
  ],
  comboResetTimer: 2000,
  maxCombo: 6,
  juggleLimit: 3,
  throwDamage: 15,
  throwHitstun: 20,
  throwKnockbackX: 100,
  throwKnockbackY: -60,
} as const;

export const ROUND = {
  timerSeconds: 99,
  bestOf: 3,
  introDuration: 1500,
  roundEndDuration: 2000,
  koSlowMoSpeed: 0.3,
  koSlowMoDuration: 500,
} as const;

export const UI = {
  hpBarWidth: 300,
  hpBarHeight: 24,
  spBarWidth: 200,
  spBarHeight: 12,
  comboCounterBaseSize: 24,
  comboCounterMaxSize: 48,
  damageNumberBaseSize: 20,
  damageNumberRiseSpeed: 60,
  damageNumberFadeDuration: 500,
} as const;

export const COLORS = {
  hpGreen: 0x00cc00,
  hpYellow: 0xcccc00,
  hpOrange: 0xff8800,
  hpRed: 0xff0000,
  spBlue: 0x0066ff,
  spDarkBlue: 0x003399,
  comboWhite: 0xffffff,
  comboYellow: 0xffcc00,
  comboRed: 0xff3333,
  comboPurple: 0xcc33ff,
  hitFlash: 0xffffff,
  blockFlash: 0x888888,
  perfectBlockFlash: 0x3399ff,
  counterFlash: 0xff0000,
} as const;

export const AI_DIFFICULTY = {
  Novice: { reactionTime: 500, blockChance: 0.1, comboKnowledge: 0, specialUse: 0, throwUse: 0, antiAir: 0, punish: 0 },
  Easy: { reactionTime: 350, blockChance: 0.3, comboKnowledge: 2, specialUse: 0.1, throwUse: 0, antiAir: 0, punish: 0 },
  Medium: { reactionTime: 200, blockChance: 0.5, comboKnowledge: 3, specialUse: 0.25, throwUse: 0.1, antiAir: 0.2, punish: 1 },
  Hard: { reactionTime: 100, blockChance: 0.7, comboKnowledge: 4, specialUse: 0.4, throwUse: 0.2, antiAir: 0.5, punish: 1 },
  Boss: { reactionTime: 80, blockChance: 0.8, comboKnowledge: 6, specialUse: 0.5, throwUse: 0.3, antiAir: 0.7, punish: 1 },
} as const;

export const GAUNTLET_FIGHTS = 5;

export type GameAction =
  | "moveLeft"
  | "moveRight"
  | "jump"
  | "crouch"
  | "lightAttack"
  | "heavyAttack"
  | "block"
  | "special"
  | "pause";

export type GameMode = "gauntlet" | "quickmatch" | "local2p";

export type DifficultyTier = "Novice" | "Easy" | "Medium" | "Hard" | "Boss";
