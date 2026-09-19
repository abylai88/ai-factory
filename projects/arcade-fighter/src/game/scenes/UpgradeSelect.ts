import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { getRandomUpgrades, Upgrade } from "../data/upgrades";
import { UpgradeCard } from "../ui/UpgradeCard";
import { GAME_WIDTH, GAME_HEIGHT } from "../utils/Constants";
import { EventBus } from "../utils/EventBus";

export class UpgradeSelect extends Phaser.Scene {
  private upgrades: Upgrade[] = [];
  private selected: boolean = false;

  constructor() {
    super(SceneKey.UpgradeSelect);
  }

  create() {
    this.selected = false;
    const overlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.6);

    this.add.text(GAME_WIDTH / 2, 60, "CHOOSE YOUR UPGRADE", {
      font: "bold 32px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.upgrades = getRandomUpgrades(3);
    const spacing = 230;
    const startX = GAME_WIDTH / 2 - spacing;

    this.upgrades.forEach((upgrade, i) => {
      new UpgradeCard(this, startX + i * spacing, GAME_HEIGHT / 2 + 20, upgrade, (selected) => {
        if (this.selected) return;
        this.selected = true;
        EventBus.emit("upgradeSelected", { upgrade: selected });
        this.scene.stop();
      });
    });
  }
}
