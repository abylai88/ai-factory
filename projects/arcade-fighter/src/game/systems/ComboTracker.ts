import { EventBus } from "../utils/EventBus";
import { COMBAT } from "../utils/Constants";

export class ComboTracker {
  private currentCount: number = 0;
  private lastHitTime: number = 0;
  private maxCombo: number = 0;

  registerHit(time: number): void {
    const timeSinceLastHit = time - this.lastHitTime;
    if (timeSinceLastHit > COMBAT.comboResetTimer || this.currentCount === 0) {
      this.currentCount = 1;
    } else {
      this.currentCount++;
    }
    this.lastHitTime = time;
    if (this.currentCount > this.maxCombo) {
      this.maxCombo = this.currentCount;
    }
    EventBus.emit("comboUpdate", { count: this.currentCount });
  }

  reset(): void {
    this.currentCount = 0;
    this.lastHitTime = 0;
    EventBus.emit("comboReset", {});
  }

  getCount(): number {
    return this.currentCount;
  }

  getMaxCombo(): number {
    return this.maxCombo;
  }

  shouldReset(time: number): boolean {
    return this.currentCount > 0 && (time - this.lastHitTime) > COMBAT.comboResetTimer;
  }
}
