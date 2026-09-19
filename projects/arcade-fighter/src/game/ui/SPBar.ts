import Phaser from "phaser";
import { COLORS } from "../utils/Constants";

export class SPBar {
  private scene: Phaser.Scene;
  private bg: Phaser.GameObjects.Rectangle;
  private fill: Phaser.GameObjects.Rectangle;
  private width: number;
  private height: number;
  private currentValue: number = 1;
  private isP1: boolean;

  constructor(scene: Phaser.Scene, x: number, y: number, width: number, height: number, isP1: boolean) {
    this.scene = scene;
    this.width = width;
    this.height = height;
    this.isP1 = isP1;

    this.bg = scene.add.rectangle(x, y, width, height, 0x222244);
    this.bg.setOrigin(isP1 ? 0 : 1, 0.5);

    this.fill = scene.add.rectangle(x, y, width, height, COLORS.spBlue);
    this.fill.setOrigin(isP1 ? 0 : 1, 0.5);

    scene.add.existing(this.bg);
    scene.add.existing(this.fill);
  }

  update(spPercent: number): void {
    this.currentValue = spPercent;

    let color: number = COLORS.spBlue;
    if (spPercent <= 0.19) color = 0x990000;
    else if (spPercent <= 0.49) color = COLORS.spDarkBlue;

    this.fill.setFillStyle(color);
    this.fill.setScale(spPercent, 1);
  }

  destroy(): void {
    this.bg.destroy();
    this.fill.destroy();
  }
}
