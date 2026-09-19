export interface SaveData {
  version: number;
  level: number;
  xp: number;
  coins: number;
  unlockedCharacters: string[];
  unlockedSkins: string[];
  highScores: Record<string, number>;
  settings: {
    sfxVolume: number;
    musicVolume: number;
    touchEnabled: boolean;
  };
  stats: {
    totalMatches: number;
    totalWins: number;
    totalKOs: number;
    bestGauntletRun: number;
  };
  lastLogin: string;
}

const STORAGE_KEY = "battlebrawl_save";
const CURRENT_VERSION = 1;

function getDefaultSave(): SaveData {
  return {
    version: CURRENT_VERSION,
    level: 1,
    xp: 0,
    coins: 0,
    unlockedCharacters: ["rex", "volt", "titan", "luna"],
    unlockedSkins: [],
    highScores: {},
    settings: {
      sfxVolume: 0.8,
      musicVolume: 0.6,
      touchEnabled: false,
    },
    stats: {
      totalMatches: 0,
      totalWins: 0,
      totalKOs: 0,
      bestGauntletRun: 0,
    },
    lastLogin: new Date().toISOString(),
  };
}

export class SaveSystem {
  private data: SaveData;
  private available: boolean;

  constructor() {
    this.available = false;
    this.data = getDefaultSave();
    this.load();
  }

  private load(): void {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as SaveData;
        if (parsed && parsed.version === CURRENT_VERSION) {
          this.data = parsed;
          this.available = true;
        }
      } else {
        this.save();
        this.available = true;
      }
    } catch {
      this.available = false;
    }
  }

  save(): void {
    try {
      this.data.lastLogin = new Date().toISOString();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.data));
      this.available = true;
    } catch {
      this.available = false;
    }
  }

  getData(): SaveData {
    return { ...this.data };
  }

  isAvailable(): boolean {
    return this.available;
  }

  getLevel(): number {
    return this.data.level;
  }

  getXp(): number {
    return this.data.xp;
  }

  getCoins(): number {
    return this.data.coins;
  }

  addXp(amount: number): void {
    this.data.xp += amount;
    this.save();
  }

  addCoins(amount: number): void {
    this.data.coins += amount;
    this.save();
  }

  spendCoins(amount: number): boolean {
    if (this.data.coins >= amount) {
      this.data.coins -= amount;
      this.save();
      return true;
    }
    return false;
  }

  setLevel(level: number): void {
    this.data.level = level;
    this.save();
  }

  incrementStat(stat: keyof SaveData["stats"], value = 1): void {
    (this.data.stats[stat] as number) += value;
    this.save();
  }

  unlockCharacter(id: string): void {
    if (!this.data.unlockedCharacters.includes(id)) {
      this.data.unlockedCharacters.push(id);
      this.save();
    }
  }

  isCharacterUnlocked(id: string): boolean {
    return this.data.unlockedCharacters.includes(id);
  }

  updateSettings(settings: Partial<SaveData["settings"]>): void {
    Object.assign(this.data.settings, settings);
    this.save();
  }

  getSettings(): SaveData["settings"] {
    return { ...this.data.settings };
  }
}
