import Phaser from "phaser";
import { GameAction, AI_DIFFICULTY, DifficultyTier } from "../utils/Constants";
import { Fighter } from "../entities/Fighter";
import { CHARACTERS } from "../data/characters";

interface AIDecision {
  action: GameAction;
  priority: number;
}

export class AISystem {
  private difficulty: DifficultyTier;
  private reactionTimer: number = 0;
  private lastDecision: GameAction | null = null;
  private config: typeof AI_DIFFICULTY[DifficultyTier];

  constructor(difficulty: DifficultyTier) {
    this.difficulty = difficulty;
    this.config = AI_DIFFICULTY[difficulty];
  }

  update(delta: number, ai: Fighter, opponent: Fighter): GameAction | null {
    this.reactionTimer -= delta;
    if (this.reactionTimer > 0) return null;

    this.reactionTimer = this.config.reactionTime + Math.random() * 100;

    if (ai.isInState("hitstun") || ai.isInState("ko")) return null;
    if (ai.isInState("attacking")) return null;

    const dist = this.getDistance(ai, opponent);
    const decision = this.decide(ai, opponent, dist);
    this.lastDecision = decision;
    return decision;
  }

  private decide(ai: Fighter, opponent: Fighter, dist: number): GameAction | null {
    if (ai.isInState("blocking")) {
      if (opponent.isInState("attacking")) return null;
      return "moveLeft";
    }

    if (dist < 90) {
      return this.closeRangeDecision(ai, opponent);
    } else if (dist < 200) {
      return this.midRangeDecision(ai, opponent);
    } else {
      return this.farRangeDecision(ai, opponent);
    }
  }

  private closeRangeDecision(ai: Fighter, opponent: Fighter): GameAction | null {
    if (opponent.isInState("attacking") && Math.random() < this.config.blockChance) {
      return "block";
    }

    if (Math.random() < this.config.throwUse && this.isInThrowRange(ai, opponent)) {
      return "heavyAttack";
    }

    if (this.config.comboKnowledge >= 2 && ai.getComboCount() > 0) {
      return this.executeCombo(ai);
    }

    if (Math.random() < this.config.specialUse && ai.getStamina() >= 40) {
      return "special";
    }

    const roll = Math.random();
    if (roll < 0.5) return "lightAttack";
    if (roll < 0.7) return "heavyAttack";
    return "block";
  }

  private midRangeDecision(ai: Fighter, opponent: Fighter): GameAction | null {
    const aiHp = ai.getHpPercent();
    const oppHp = opponent.getHpPercent();

    if (aiHp < 0.3 && Math.random() < 0.4) {
      return "moveLeft";
    }

    if (oppHp < 0.3 && Math.random() < 0.6) {
      return "moveRight";
    }

    if (Math.random() < 0.3) return "moveRight";
    if (Math.random() < 0.2 && this.config.antiAir > 0 && opponent.isInState("jumping")) {
      return "heavyAttack";
    }
    return null;
  }

  private farRangeDecision(ai: Fighter, _opponent: Fighter): GameAction | null {
    if (Math.random() < 0.3) {
      return "special";
    }
    if (Math.random() < 0.6) return "moveRight";
    if (Math.random() < 0.2) return "jump";
    return null;
  }

  private executeCombo(ai: Fighter): GameAction | null {
    const comboCount = ai.getComboCount();
    if (comboCount === 0) return "lightAttack";
    if (comboCount === 1) return "lightAttack";
    if (comboCount === 2) return "heavyAttack";
    if (comboCount >= 3 && this.config.comboKnowledge >= 3) return "special";
    return "heavyAttack";
  }

  private getDistance(a: Fighter, b: Fighter): number {
    const pa = a.getPosition();
    const pb = b.getPosition();
    return Math.abs(pa.x - pb.x);
  }

  private isInThrowRange(a: Fighter, b: Fighter): boolean {
    return this.getDistance(a, b) < 60;
  }

  getDifficulty(): DifficultyTier {
    return this.difficulty;
  }

  setDifficulty(d: DifficultyTier): void {
    this.difficulty = d;
    this.config = AI_DIFFICULTY[d];
  }
}
