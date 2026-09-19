export interface MoveData {
  id: string;
  name: string;
  damage: number;
  startup: number;
  active: number;
  recovery: number;
  staminaCost: number;
  hitstun: number;
  blockstun: number;
  hitboxWidth: number;
  hitboxHeight: number;
  hitboxOffsetX: number;
  hitboxOffsetY: number;
  knockbackX: number;
  knockbackY: number;
  properties: string[];
}

export const MOVES: Record<string, MoveData> = {
  light: {
    id: "light",
    name: "Light Attack",
    damage: 7,
    startup: 6,
    active: 3,
    recovery: 4,
    staminaCost: 0,
    hitstun: 12,
    blockstun: 8,
    hitboxWidth: 56,
    hitboxHeight: 32,
    hitboxOffsetX: 30,
    hitboxOffsetY: -50,
    knockbackX: 40,
    knockbackY: 0,
    properties: [],
  },
  heavy: {
    id: "heavy",
    name: "Heavy Attack",
    damage: 15,
    startup: 12,
    active: 4,
    recovery: 8,
    staminaCost: 15,
    hitstun: 18,
    blockstun: 12,
    hitboxWidth: 72,
    hitboxHeight: 40,
    hitboxOffsetX: 40,
    hitboxOffsetY: -48,
    knockbackX: 80,
    knockbackY: 0,
    properties: [],
  },
  crouchLight: {
    id: "crouchLight",
    name: "Crouch Light",
    damage: 6,
    startup: 5,
    active: 3,
    recovery: 4,
    staminaCost: 0,
    hitstun: 11,
    blockstun: 7,
    hitboxWidth: 56,
    hitboxHeight: 28,
    hitboxOffsetX: 28,
    hitboxOffsetY: -30,
    knockbackX: 35,
    knockbackY: 0,
    properties: [],
  },
  crouchHeavy: {
    id: "crouchHeavy",
    name: "Crouch Heavy",
    damage: 14,
    startup: 14,
    active: 5,
    recovery: 10,
    staminaCost: 15,
    hitstun: 20,
    blockstun: 14,
    hitboxWidth: 64,
    hitboxHeight: 36,
    hitboxOffsetX: 36,
    hitboxOffsetY: -32,
    knockbackX: 70,
    knockbackY: -20,
    properties: [],
  },
  airLight: {
    id: "airLight",
    name: "Air Light",
    damage: 6,
    startup: 5,
    active: 4,
    recovery: 6,
    staminaCost: 0,
    hitstun: 10,
    blockstun: 6,
    hitboxWidth: 50,
    hitboxHeight: 30,
    hitboxOffsetX: 26,
    hitboxOffsetY: -40,
    knockbackX: 30,
    knockbackY: 0,
    properties: [],
  },
  airHeavy: {
    id: "airHeavy",
    name: "Air Heavy",
    damage: 13,
    startup: 10,
    active: 5,
    recovery: 10,
    staminaCost: 15,
    hitstun: 16,
    blockstun: 10,
    hitboxWidth: 64,
    hitboxHeight: 36,
    hitboxOffsetX: 34,
    hitboxOffsetY: -42,
    knockbackX: 60,
    knockbackY: 40,
    properties: [],
  },
  throw: {
    id: "throw",
    name: "Throw",
    damage: 15,
    startup: 10,
    active: 1,
    recovery: 18,
    staminaCost: 20,
    hitstun: 20,
    blockstun: 0,
    hitboxWidth: 40,
    hitboxHeight: 40,
    hitboxOffsetX: 20,
    hitboxOffsetY: -50,
    knockbackX: 100,
    knockbackY: -60,
    properties: ["unblockable"],
  },
};

export function getMoveData(moveId: string): MoveData {
  return MOVES[moveId] || MOVES.light;
}
