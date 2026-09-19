import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { CHARACTERS, STARTER_CHARACTERS } from "../data/characters";
import { Button } from "../ui/Button";
import { SaveSystem } from "../utils/SaveSystem";
import { DeviceInfo } from "../utils/DeviceDetector";

export class CharacterSelect extends Phaser.Scene {
  private selectedCharacter: string = "rex";
  private previewSprite!: Phaser.GameObjects.Rectangle;
  private nameText!: Phaser.GameObjects.Text;
  private statsText!: Phaser.GameObjects.Text;
  private saveSystem!: SaveSystem;
  private device!: DeviceInfo;

  constructor() {
    super(SceneKey.CharacterSelect);
  }

  init(data: { saveSystem: SaveSystem; device: DeviceInfo }): void {
    this.saveSystem = data.saveSystem;
    this.device = data.device;
  }

  create() {
    const w = this.cameras.main.width;
    const h = this.cameras.main.height;

    this.add.text(w / 2, 40, "SELECT YOUR FIGHTER", {
      font: "bold 36px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.previewSprite = this.add.rectangle(w / 2, h / 2 - 40, 64, 128, CHARACTERS.rex.color);
    this.nameText = this.add.text(w / 2, h / 2 + 60, "Rex", {
      font: "bold 28px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);
    this.statsText = this.add.text(w / 2, h / 2 + 95, "Balanced | HP: 100 | SP: 100", {
      font: "16px sans-serif",
      color: "#aaaaaa",
    }).setOrigin(0.5);

    const characters = Object.values(CHARACTERS);
    const cols = 4;
    const startX = w / 2 - (cols * 120) / 2 + 60;
    const startY = 120;

    characters.forEach((char, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * 120;
      const y = startY + row * 120;
      const unlocked = this.saveSystem?.isCharacterUnlocked(char.id) ?? STARTER_CHARACTERS.includes(char.id);

      const btn = this.add.rectangle(x, y, 90, 90, unlocked ? char.color : 0x333333);
      btn.setStrokeStyle(2, unlocked ? 0xffffff : 0x666666);
      if (!unlocked) btn.setAlpha(0.5);

      const name = this.add.text(x, y - 30, char.name, {
        font: "bold 14px sans-serif",
        color: "#ffffff",
      }).setOrigin(0.5);

      if (!unlocked) {
        const lock = this.add.text(x, y + 5, `Lv.${char.unlockLevel}`, {
          font: "12px sans-serif",
          color: "#888888",
        }).setOrigin(0.5);
        lock.setAlpha(0.7);
      }

      btn.setInteractive({ useHandCursor: unlocked });
      btn.on("pointerdown", () => {
        if (unlocked) {
          this.selectCharacter(char.id);
        }
      });
      btn.on("pointerover", () => {
        if (unlocked) btn.setStrokeStyle(3, 0x00ff00);
      });
      btn.on("pointerout", () => {
        btn.setStrokeStyle(2, unlocked ? 0xffffff : 0x666666);
      });
    });

    new Button(this, w / 2 - 120, h - 60, "BACK", () => {
      this.scene.start(SceneKey.MainMenu, { saveSystem: this.saveSystem, device: this.device });
    }, 160, 44);

    new Button(this, w / 2 + 120, h - 60, "FIGHT!", () => {
      this.scene.start(SceneKey.Game, {
        mode: "gauntlet",
        playerCharacter: this.selectedCharacter,
        saveSystem: this.saveSystem,
        device: this.device,
        gauntletFight: 1,
      });
    }, 160, 44);
  }

  private selectCharacter(id: string): void {
    this.selectedCharacter = id;
    const char = CHARACTERS[id];
    this.previewSprite.setFillStyle(char.color);
    this.nameText.setText(char.name);
    this.statsText.setText(`${char.archetype} | HP: ${char.hp} | SP: ${char.sp}`);
    this.tweens.add({ targets: this.previewSprite, scaleX: 1.1, scaleY: 1.1, duration: 100, yoyo: true });
  }
}
