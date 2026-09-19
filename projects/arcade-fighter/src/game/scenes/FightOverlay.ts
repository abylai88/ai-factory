import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { EventBus } from "../utils/EventBus";
import { HPBar } from "../ui/HPBar";
import { SPBar } from "../ui/SPBar";
import { ComboCounter } from "../ui/ComboCounter";
import { GAME_WIDTH, UI, ROUND } from "../utils/Constants";
import { Fighter } from "../entities/Fighter";

export class FightOverlay extends Phaser.Scene {
  private p1HPBar!: HPBar;
  private p1SPBar!: SPBar;
  private p2HPBar!: HPBar;
  private p2SPBar!: SPBar;
  private comboCounter!: ComboCounter;
  private timerText!: Phaser.GameObjects.Text;
  private roundText!: Phaser.GameObjects.Text;
  private p1WinsDots: Phaser.GameObjects.Arc[] = [];
  private p2WinsDots: Phaser.GameObjects.Arc[] = [];
  private p1Name!: Phaser.GameObjects.Text;
  private p2Name!: Phaser.GameObjects.Text;
  private p1: Fighter | null = null;
  private p2: Fighter | null = null;

  constructor() {
    super(SceneKey.FightOverlay);
  }

  create() {
    const w = this.cameras.main.width;
    const p1Name = this.registry.get("p1Name") || "P1";
    const p2Name = this.registry.get("p2Name") || "P2";

    this.p1HPBar = new HPBar(this, 30, 30, UI.hpBarWidth, UI.hpBarHeight, true);
    this.p1SPBar = new SPBar(this, 30, 50, UI.spBarWidth, UI.spBarHeight, true);
    this.p2HPBar = new HPBar(this, w - 30, 30, UI.hpBarWidth, UI.hpBarHeight, false);
    this.p2SPBar = new SPBar(this, w - 30, 50, UI.spBarWidth, UI.spBarHeight, false);

    this.p1Name = this.add.text(30, 8, p1Name, { font: "bold 14px sans-serif", color: "#ffffff" });
    this.p2Name = this.add.text(w - 30, 8, p2Name, { font: "bold 14px sans-serif", color: "#ffffff" }).setOrigin(1, 0);

    this.comboCounter = new ComboCounter(this, w / 2, 100);

    this.timerText = this.add.text(w / 2, 15, "99", {
      font: "bold 32px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.roundText = this.add.text(w / 2, 55, "", {
      font: "bold 18px sans-serif",
      color: "#ffcc00",
    }).setOrigin(0.5);

    for (let i = 0; i < Math.ceil(ROUND.bestOf / 2); i++) {
      this.p1WinsDots.push(this.add.circle(40 + i * 18, 68, 6, 0x333333));
      this.p2WinsDots.push(this.add.circle(w - 40 - i * 18, 68, 6, 0x333333));
    }

    this.setupListeners();
  }

  private setupListeners(): void {
    EventBus.on("timerTick", (data: { time: number }) => {
      this.timerText.setText(String(data.time));
      if (data.time <= 10) {
        this.timerText.setColor("#ff3333");
      }
    });

    EventBus.on("roundStart", (data: { round: number }) => {
      this.roundText.setText(`ROUND ${data.round}`);
      this.tweens.add({
        targets: this.roundText,
        scaleX: 1.5,
        scaleY: 1.5,
        duration: 300,
        yoyo: true,
        hold: 500,
        onComplete: () => {
          this.roundText.setText("FIGHT!");
          this.tweens.add({
            targets: this.roundText,
            scaleX: 1.2,
            scaleY: 1.2,
            duration: 200,
            yoyo: true,
            hold: 300,
            onComplete: () => this.roundText.setText(""),
          });
        },
      });
    });

    EventBus.on("roundEnd", (data: { p1Wins: number; p2Wins: number }) => {
      for (let i = 0; i < this.p1WinsDots.length; i++) {
        this.p1WinsDots[i].setFillStyle(i < data.p1Wins ? 0x00cc00 : 0x333333);
      }
      for (let i = 0; i < this.p2WinsDots.length; i++) {
        this.p2WinsDots[i].setFillStyle(i < data.p2Wins ? 0xcc0000 : 0x333333);
      }
    });

    EventBus.on("koAnimation", (data: { winner: string }) => {
      const text = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, "K.O.!", {
        font: "bold 64px sans-serif",
        color: "#ff0000",
        stroke: "#000000",
        strokeThickness: 4,
      }).setOrigin(0.5);
      this.tweens.add({
        targets: text,
        scaleX: 2,
        scaleY: 2,
        alpha: 0,
        duration: 1500,
        onComplete: () => text.destroy(),
      });
    });

    EventBus.on("timeUp", () => {
      const text = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2, "TIME UP", {
        font: "bold 48px sans-serif",
        color: "#ffcc00",
        stroke: "#000000",
        strokeThickness: 3,
      }).setOrigin(0.5);
      this.tweens.add({ targets: text, alpha: 0, duration: 1500, onComplete: () => text.destroy() });
    });

    EventBus.on("perfectBlock", (data: { target: string }) => {
      const t = data.target === "p1" ? this.p1HPBar : this.p2HPBar;
      const text = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 80, "PERFECT!", {
        font: "bold 28px sans-serif",
        color: "#3399ff",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.tweens.add({ targets: text, alpha: 0, y: text.y - 40, duration: 800, onComplete: () => text.destroy() });
    });

    EventBus.on("guardBreak", () => {
      const text = this.add.text(this.cameras.main.width / 2, this.cameras.main.height / 2 + 80, "GUARD BREAK!", {
        font: "bold 28px sans-serif",
        color: "#ff3333",
        stroke: "#000000",
        strokeThickness: 2,
      }).setOrigin(0.5);
      this.tweens.add({ targets: text, alpha: 0, y: text.y - 40, duration: 800, onComplete: () => text.destroy() });
    });

    EventBus.on("comboUpdate", (data: { count: number }) => {
      this.comboCounter.update(data.count);
    });

    EventBus.on("comboReset", () => {
      this.comboCounter.reset();
    });
  }

  setFighters(p1: Fighter, p2: Fighter): void {
    this.p1 = p1;
    this.p2 = p2;
  }

  update(): void {
    if (this.p1) {
      this.p1HPBar.update(this.p1.getHpPercent());
      this.p1SPBar.update(this.p1.getStamina() / this.p1.getMaxStamina());
    }
    if (this.p2) {
      this.p2HPBar.update(this.p2.getHpPercent());
      this.p2SPBar.update(this.p2.getStamina() / this.p2.getMaxStamina());
    }
  }
}
