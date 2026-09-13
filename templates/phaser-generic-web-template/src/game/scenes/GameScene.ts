import Phaser from "phaser";
import { SceneKey } from "./Scenes";

export class GameScene extends Phaser.Scene {
  constructor() {
    super(SceneKey.Game);
  }

  create() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.add.text(width / 2, 50, "Game Scene", {
      font: "bold 32px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(width / 2, height / 2, "Your game starts here!", {
      font: "20px sans-serif",
      color: "#cccccc",
    }).setOrigin(0.5);
  }

  update(_time: number, _delta: number): void {
    // Game loop — add update logic here
  }
}
