export interface Upgrade {
  id: string;
  name: string;
  description: string;
  effectType: "damage" | "speed" | "health" | "stamina" | "combo" | "block" | "counter" | "heal" | "special";
  effectValue: number;
  rarityWeight: number;
  rarity: "common" | "uncommon" | "rare" | "epic" | "legendary";
}

export const UPGRADES: Upgrade[] = [
  {
    id: "iron-fists",
    name: "Iron Fists",
    description: "+15% attack damage",
    effectType: "damage",
    effectValue: 0.15,
    rarityWeight: 15,
    rarity: "common",
  },
  {
    id: "stone-skin",
    name: "Stone Skin",
    description: "-20% damage taken",
    effectType: "health",
    effectValue: 0.2,
    rarityWeight: 15,
    rarity: "common",
  },
  {
    id: "swift-feet",
    name: "Swift Feet",
    description: "+15% movement speed",
    effectType: "speed",
    effectValue: 0.15,
    rarityWeight: 15,
    rarity: "common",
  },
  {
    id: "meter-builder",
    name: "Meter Builder",
    description: "25% faster SP regeneration",
    effectType: "stamina",
    effectValue: 0.25,
    rarityWeight: 15,
    rarity: "common",
  },
  {
    id: "combo-master",
    name: "Combo Master",
    description: "Extend combo window by 4 frames",
    effectType: "combo",
    effectValue: 4,
    rarityWeight: 10,
    rarity: "uncommon",
  },
  {
    id: "quick-recovery",
    name: "Quick Recovery",
    description: "30% faster knockdown recovery",
    effectType: "speed",
    effectValue: 0.3,
    rarityWeight: 10,
    rarity: "uncommon",
  },
  {
    id: "counter-boost",
    name: "Counter Boost",
    description: "Counter-hits deal +50% damage",
    effectType: "counter",
    effectValue: 0.5,
    rarityWeight: 10,
    rarity: "uncommon",
  },
  {
    id: "piercing-strikes",
    name: "Piercing Strikes",
    description: "Heavy attacks ignore 30% block",
    effectType: "damage",
    effectValue: 0.3,
    rarityWeight: 8,
    rarity: "rare",
  },
  {
    id: "second-wind",
    name: "Second Wind",
    description: "Restore 30 HP once per fight below 20%",
    effectType: "heal",
    effectValue: 30,
    rarityWeight: 8,
    rarity: "rare",
  },
  {
    id: "super-armor",
    name: "Super Armor",
    description: "Absorb 1 hit during heavy attacks",
    effectType: "block",
    effectValue: 1,
    rarityWeight: 5,
    rarity: "epic",
  },
  {
    id: "berserker",
    name: "Berserker",
    description: "+1% damage per 1% HP missing",
    effectType: "damage",
    effectValue: 0.01,
    rarityWeight: 5,
    rarity: "epic",
  },
  {
    id: "glass-cannon",
    name: "Glass Cannon",
    description: "+40% damage, -20% damage taken",
    effectType: "special",
    effectValue: 0.4,
    rarityWeight: 2,
    rarity: "legendary",
  },
];

export function getRandomUpgrades(count: number): Upgrade[] {
  const pool = [...UPGRADES];
  const selected: Upgrade[] = [];
  for (let i = 0; i < count && pool.length > 0; i++) {
    const totalWeight = pool.reduce((sum, u) => sum + u.rarityWeight, 0);
    let roll = Math.random() * totalWeight;
    for (let j = 0; j < pool.length; j++) {
      roll -= pool[j].rarityWeight;
      if (roll <= 0) {
        selected.push(pool[j]);
        pool.splice(j, 1);
        break;
      }
    }
  }
  return selected;
}
