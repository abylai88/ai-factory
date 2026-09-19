import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { GAME_WIDTH, GAME_HEIGHT } from "../utils/Constants";
import { Button } from "../ui/Button";

export class LevelUp extends Phaser.Scene {
  private level: number = 1;
  private reward: string | null = null;

  constructor() {
    super(SceneKey.LevelUp);
  }

  init(data: { level: number; reward: string | null }): void {
    this.level = data.level;
    this.reward = data.reward;
  }

  create() {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x111133);

    const text = this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 80, `LEVEL ${this.level}!`, {
      font: "bold 64px sans-serif",
      color: "#ffcc00",
      stroke: "#000000",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.tweens.add({
      targets: text,
      scaleX: 1.2,
      scaleY: 1.2,
      duration: 500,
      yoyo: true,
      repeat: -1,
    });

    if (this.reward) {
      this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2, `Unlocked: ${this.reward}`, {
        font: "bold 24px sans-serif",
        color: "#00ffaa",
      }).setOrigin(0.5);
    }

    for (let i = 0; i < 20; i++) {
      const star = this.add.circle(
        Math.random() * GAME_WIDTH,
        Math.random() * GAME_HEIGHT,
        2 + Math.random() * 4,
        0xffcc00
      );
      this.tweens.add({
        targets: star,
        alpha: 0,
        y: star.y - 100,
        duration: 1000 + Math.random() * 2000,
        delay: Math.random() * 1000,
        repeat: -1,
      });
    }

    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 120, "CONTINUE", () => {
      this.scene.start(SceneKey.MainMenu);
    });
  }
}
