import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { Button } from "../ui/Button";
import { SaveSystem } from "../utils/SaveSystem";
import { DeviceInfo } from "../utils/DeviceDetector";
import { calculateLevel } from "../data/progression";

export class MainMenu extends Phaser.Scene {
  private saveSystem!: SaveSystem;
  private device!: DeviceInfo;

  constructor() {
    super(SceneKey.MainMenu);
  }

  init(data: { saveSystem?: SaveSystem; device?: DeviceInfo }): void {
    this.saveSystem = data.saveSystem || this.registry.get("saveSystem");
    this.device = data.device || this.registry.get("device");
  }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add.rectangle(w / 2, h / 2, w, h, 0x0a0a1a);

    this.add.text(w / 2, 100, "BATTLE BRAWL", {
      font: "bold 64px sans-serif",
      color: "#ffffff",
      stroke: "#ff6633",
      strokeThickness: 4,
    }).setOrigin(0.5);

    this.add.text(w / 2, 160, "Arcade Fighter", {
      font: "20px sans-serif",
      color: "#aaaaaa",
    }).setOrigin(0.5);

    const level = this.saveSystem?.getLevel() || 1;
    const coins = this.saveSystem?.getCoins() || 0;

    this.add.text(w / 2, 210, `Level ${level} | ${coins} Coins`, {
      font: "16px sans-serif",
      color: "#ffcc00",
    }).setOrigin(0.5);

    new Button(this, w / 2, 320, "PLAY", () => {
      this.scene.start(SceneKey.CharacterSelect, { saveSystem: this.saveSystem, device: this.device });
    }, 240, 60, "28px");

    new Button(this, w / 2, 400, "QUICK MATCH", () => {
      const characters = ["rex", "volt", "titan", "luna"];
      const randomChar = characters[Math.floor(Math.random() * characters.length)];
      this.scene.start(SceneKey.Game, {
        mode: "quickmatch",
        playerCharacter: randomChar,
        saveSystem: this.saveSystem,
        device: this.device,
      });
    }, 240, 50, "22px");

    new Button(this, w / 2, 470, "SETTINGS", () => {
      this.scene.start(SceneKey.Settings, { saveSystem: this.saveSystem, device: this.device });
    }, 200, 44, "18px");
  }
}
