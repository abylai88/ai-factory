import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { Button } from "../ui/Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../utils/Constants";

export class PauseMenu extends Phaser.Scene {
  constructor() {
    super(SceneKey.PauseMenu);
  }

  create() {
    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.7);
    overlay.setInteractive();

    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 120, "PAUSED", {
      font: "bold 48px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 - 20, "RESUME", () => {
      this.scene.resume(SceneKey.Game);
      this.scene.stop();
    });

    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT / 2 + 50, "QUIT", () => {
      this.scene.stop(SceneKey.Game);
      this.scene.stop(SceneKey.FightOverlay);
      this.scene.stop();
      this.scene.start(SceneKey.MainMenu);
    });

    this.input.keyboard?.on("keydown-ESC", () => {
      this.scene.resume(SceneKey.Game);
      this.scene.stop();
    });
  }
}
