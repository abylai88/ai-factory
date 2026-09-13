import Phaser from "phaser";
import { SceneKey } from "./Scenes";

export class MainMenu extends Phaser.Scene {
  constructor() {
    super(SceneKey.MainMenu);
  }

  create() {
    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    this.add.text(width / 2, height / 2 - 100, "Main Menu", {
      font: "bold 48px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    const startButton = this.add.text(width / 2, height / 2 + 50, "▶  Start Game", {
      font: "28px sans-serif",
      color: "#ffffff",
      backgroundColor: "#333333",
      padding: { x: 20, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    startButton.on("pointerover", () => startButton.setStyle({ backgroundColor: "#555555" }));
    startButton.on("pointerout", () => startButton.setStyle({ backgroundColor: "#333333" }));
    startButton.on("pointerdown", () => this.scene.start(SceneKey.Game));
  }
}
