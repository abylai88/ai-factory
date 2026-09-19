export const XP_PER_ROUND = 50;
export const XP_PER_MATCH = 100;
export const XP_PER_RUN = 300;
export const XP_PERFECT_BONUS = 50;
export const XP_COMBO_BONUS = 25;

export const COINS_PER_ROUND = 10;
export const COINS_PER_MATCH = 25;
export const COINS_PER_RUN = 50;
export const COINS_REWARDED_AD = 30;

export const LEVEL_UNLOCKS: Record<number, string> = {
  3: "title_challenger",
  5: "blaze",
  7: "palette_rex",
  10: "shadow",
  15: "palette_all",
  20: "astra",
  25: "title_champion",
  30: "victory_animation",
};

export function xpForLevel(level: number): number {
  return level * 200;
}

export function calculateLevel(totalXp: number): number {
  let level = 1;
  let xpNeeded = xpForLevel(level);
  let xpRemaining = totalXp;
  while (xpRemaining >= xpNeeded) {
    xpRemaining -= xpNeeded;
    level++;
    xpNeeded = xpForLevel(level);
  }
  return level;
}

export function getUnlockReward(level: number): string | null {
  return LEVEL_UNLOCKS[level] || null;
}
