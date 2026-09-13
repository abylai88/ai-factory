import Phaser from "phaser";
import { SceneKey } from "./Scenes";

export class Preloader extends Phaser.Scene {
  constructor() {
    super(SceneKey.Preloader);
  }

  preload() {
    // Load game assets here, for example:
    // this.load.image("logo", "assets/images/logo.png");
    // this.load.audio("click", "assets/audio/click.mp3");

    const width = this.cameras.main.width;
    const height = this.cameras.main.height;

    const progressBar = this.add.graphics();
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRoundedRect(width / 2 - 160, height / 2 - 25, 320, 50, 10);

    const loadingText = this.add.text(width / 2, height / 2 - 50, "Loading...", {
      font: "20px monospace",
      color: "#ffffff",
    });
    loadingText.setOrigin(0.5, 0.5);

    this.load.on("progress", (value: number) => {
      progressBar.clear();
      progressBar.fillStyle(0x00aa00, 1);
      progressBar.fillRoundedRect(width / 2 - 155, height / 2 - 20, 310 * value, 40, 8);
    });

    this.load.on("complete", () => {
      progressBar.destroy();
      progressBox.destroy();
      loadingText.destroy();
    });
  }

  create() {
    this.scene.start(SceneKey.MainMenu);
  }
}
