import Phaser from "phaser";
import { Upgrade } from "../data/upgrades";

const RARITY_COLORS: Record<string, number> = {
  common: 0xcccccc,
  uncommon: 0x33cc33,
  rare: 0x3399ff,
  epic: 0xcc33ff,
  legendary: 0xffcc00,
};

export class UpgradeCard {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private nameText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;
  private rarityText: Phaser.GameObjects.Text;
  private upgrade: Upgrade;
  private onSelect: (upgrade: Upgrade) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, upgrade: Upgrade, onSelect: (u: Upgrade) => void) {
    this.scene = scene;
    this.upgrade = upgrade;
    this.onSelect = onSelect;

    const cardW = 200;
    const cardH = 250;
    const color = RARITY_COLORS[upgrade.rarity] || 0xcccccc;

    this.bg = scene.add.rectangle(0, 0, cardW, cardH, 0x222233);
    this.bg.setStrokeStyle(3, color);

    this.nameText = scene.add.text(0, -60, upgrade.name, {
      font: "bold 20px sans-serif",
      color: "#" + color.toString(16).padStart(6, "0"),
    }).setOrigin(0.5);

    this.rarityText = scene.add.text(0, -35, upgrade.rarity.toUpperCase(), {
      font: "12px sans-serif",
      color: "#aaaaaa",
    }).setOrigin(0.5);

    this.descText = scene.add.text(0, 10, upgrade.description, {
      font: "14px sans-serif",
      color: "#ffffff",
      wordWrap: { width: cardW - 30 },
      align: "center",
    }).setOrigin(0.5);

    this.container = scene.add.container(x, y, [this.bg, this.nameText, this.rarityText, this.descText]);
    this.container.setSize(cardW, cardH);
    this.container.setInteractive({ useHandCursor: true });

    this.container.on("pointerover", () => {
      this.scene.tweens.add({ targets: this.container, scaleX: 1.08, scaleY: 1.08, duration: 150 });
      this.bg.setFillStyle(0x333355);
    });

    this.container.on("pointerout", () => {
      this.scene.tweens.add({ targets: this.container, scaleX: 1, scaleY: 1, duration: 150 });
      this.bg.setFillStyle(0x222233);
    });

    this.container.on("pointerup", () => {
      this.scene.tweens.add({
        targets: this.container,
        scaleX: 1.15,
        scaleY: 1.15,
        alpha: 0,
        duration: 200,
        onComplete: () => onSelect(upgrade),
      });
    });
  }

  destroy(): void {
    this.container.destroy();
  }
}
