import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { Button } from "../ui/Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../utils/Constants";
import { SaveSystem } from "../utils/SaveSystem";
import { DeviceInfo } from "../utils/DeviceDetector";
import { EventBus } from "../utils/EventBus";

export class Settings extends Phaser.Scene {
  private saveSystem!: SaveSystem;
  private device!: DeviceInfo;
  private sfxVolume: number = 0.8;
  private musicVolume: number = 0.6;
  private touchEnabled: boolean = false;
  private sfxText!: Phaser.GameObjects.Text;
  private musicText!: Phaser.GameObjects.Text;
  private touchText!: Phaser.GameObjects.Text;

  constructor() {
    super(SceneKey.Settings);
  }

  init(data: { saveSystem?: SaveSystem; device?: DeviceInfo }): void {
    this.saveSystem = data.saveSystem || this.registry.get("saveSystem");
    this.device = data.device || this.registry.get("device");

    if (this.saveSystem) {
      const settings = this.saveSystem.getSettings();
      this.sfxVolume = settings.sfxVolume;
      this.musicVolume = settings.musicVolume;
      this.touchEnabled = settings.touchEnabled;
    }
  }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0a0a1a);

    this.add.text(GAME_WIDTH / 2, 60, "SETTINGS", {
      font: "bold 48px sans-serif",
      color: "#ffffff",
      stroke: "#ff6633",
      strokeThickness: 3,
    }).setOrigin(0.5);

    // SFX Volume
    this.add.text(GAME_WIDTH / 2, 160, "SFX Volume", {
      font: "22px sans-serif",
      color: "#cccccc",
    }).setOrigin(0.5);

    this.sfxText = this.add.text(GAME_WIDTH / 2, 195, `${Math.round(this.sfxVolume * 100)}%`, {
      font: "bold 20px sans-serif",
      color: "#ffcc00",
    }).setOrigin(0.5);

    new Button(this, GAME_WIDTH / 2 - 120, 195, "-", () => {
      this.sfxVolume = Math.max(0, Math.round((this.sfxVolume - 0.1) * 10) / 10);
      this.sfxText.setText(`${Math.round(this.sfxVolume * 100)}%`);
      this.saveSettings();
    }, 60, 40, "22px");

    new Button(this, GAME_WIDTH / 2 + 120, 195, "+", () => {
      this.sfxVolume = Math.min(1, Math.round((this.sfxVolume + 0.1) * 10) / 10);
      this.sfxText.setText(`${Math.round(this.sfxVolume * 100)}%`);
      this.saveSettings();
    }, 60, 40, "22px");

    // Music Volume
    this.add.text(GAME_WIDTH / 2, 260, "Music Volume", {
      font: "22px sans-serif",
      color: "#cccccc",
    }).setOrigin(0.5);

    this.musicText = this.add.text(GAME_WIDTH / 2, 295, `${Math.round(this.musicVolume * 100)}%`, {
      font: "bold 20px sans-serif",
      color: "#ffcc00",
    }).setOrigin(0.5);

    new Button(this, GAME_WIDTH / 2 - 120, 295, "-", () => {
      this.musicVolume = Math.max(0, Math.round((this.musicVolume - 0.1) * 10) / 10);
      this.musicText.setText(`${Math.round(this.musicVolume * 100)}%`);
      this.saveSettings();
    }, 60, 40, "22px");

    new Button(this, GAME_WIDTH / 2 + 120, 295, "+", () => {
      this.musicVolume = Math.min(1, Math.round((this.musicVolume + 0.1) * 10) / 10);
      this.musicText.setText(`${Math.round(this.musicVolume * 100)}%`);
      this.saveSettings();
    }, 60, 40, "22px");

    // Touch Controls Toggle (only relevant on touch devices)
    if (this.device?.isTouchDevice) {
      this.add.text(GAME_WIDTH / 2, 360, "Touch Controls", {
        font: "22px sans-serif",
        color: "#cccccc",
      }).setOrigin(0.5);

      this.touchText = this.add.text(GAME_WIDTH / 2, 395, this.touchEnabled ? "ON" : "OFF", {
        font: "bold 20px sans-serif",
        color: this.touchEnabled ? "#00cc00" : "#cc0000",
      }).setOrigin(0.5);

      new Button(this, GAME_WIDTH / 2 + 100, 395, "Toggle", () => {
        this.touchEnabled = !this.touchEnabled;
        this.touchText.setText(this.touchEnabled ? "ON" : "OFF");
        this.touchText.setColor(this.touchEnabled ? "#00cc00" : "#cc0000");
        this.saveSettings();
      }, 100, 40, "16px");
    }

    // Info text
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 120, "Controls:\nKeyboard P1: WASD + JKL + Space\nKeyboard P2: Arrows + Numpad 1/2/3/0", {
      font: "14px sans-serif",
      color: "#888888",
      align: "center",
    }).setOrigin(0.5);

    // Back button
    new Button(this, GAME_WIDTH / 2, GAME_HEIGHT - 50, "BACK", () => {
      EventBus.emit("gameplayStop", {});
      this.scene.start(SceneKey.MainMenu, {
        saveSystem: this.saveSystem,
        device: this.device,
      });
    }, 200, 50, "20px");
  }

  private saveSettings(): void {
    if (this.saveSystem) {
      this.saveSystem.updateSettings({
        sfxVolume: this.sfxVolume,
        musicVolume: this.musicVolume,
        touchEnabled: this.touchEnabled,
      });
      EventBus.emit("settingsChanged", {
        sfxVolume: this.sfxVolume,
        musicVolume: this.musicVolume,
        touchEnabled: this.touchEnabled,
      });
    }
  }
}
