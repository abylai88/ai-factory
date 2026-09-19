import Phaser from "phaser";
import { COLORS } from "../utils/Constants";

export class HPBar {
  private scene: Phaser.Scene;
  private bg: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;
  private ghost: Phaser.GameObjects.Rectangle;
  private width: number;
  private height: number;
  private currentValue: number = 1;
  private ghostValue: number = 1;
  private isP1: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, isP1: boolean) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.isP1 = isP1;

    this.bg = scene.add.rectangle(x, y, width, height, 0x333333);
    this.bg.setOrigin(isP1 ? 0 : 1, 0.5);

    this.ghost = scene.add.rectangle(x, y, width, height, 0xffffff, 0.3);
    this.ghost.setOrigin(isP1 ? 0 : 1, 0.5);

    this.fill = scene.add.rectangle(x, y, width, height, COLORS.hpGreen);
    this.fill.setOrigin(isP1 ? 0 : 1, 0.5);

    scene.add.existing(this.bg);
    scene.add.existing(this.ghost);
    scene.add.existing(this.fill);
  }

  update(hpPercent: number): void {
    this.currentValue = hpPercent;

    let color: number = COLORS.hpGreen;
    if (hpPercent <= 0.09) color = COLORS.hpRed;
    else if (hpPercent <= 0.29) color = COLORS.hpOrange;
    else if (hpPercent <= 0.59) color = COLORS.hpYellow;

    this.fill.setFillStyle(color);
    this.fill.setScale(hpPercent, 1);

    this.scene.time.delayedCall(300, () => {
      this.ghostValue = Phaser.Math.Linear(this.ghostValue, hpPercent, 0.05);
      this.ghost.setScale(this.ghostValue, 1);
    });
  }

  flash(): void {
    this.fill.setFillStyle(0xffffff);
    this.scene.time.delayedCall(100, () => {
      this.update(this.currentValue);
    });
  }

  destroy(): void {
    this.bg.destroy();
    this.fill.destroy();
    this.ghost.destroy();
  }
}
