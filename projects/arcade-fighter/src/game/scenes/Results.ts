import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { Button } from "../ui/Button";
import { GAME_WIDTH, GAME_HEIGHT } from "../utils/Constants";
import { XP_PER_ROUND, XP_PER_MATCH, XP_PER_RUN, COINS_PER_ROUND, COINS_PER_MATCH, COINS_PER_RUN, calculateLevel, getUnlockReward } from "../data/progression";
import { SaveSystem } from "../utils/SaveSystem";
import { DeviceInfo } from "../utils/DeviceDetector";

export class Results extends Phaser.Scene {
  private saveSystem!: SaveSystem;
  private device!: DeviceInfo;

  constructor() {
    super(SceneKey.Results);
  }

  init(data: { won: boolean; roundsWon: number; roundsLost: number; gauntletFight: number; totalFights: number; saveSystem: SaveSystem; device: DeviceInfo; playerCharacter: string }): void {
    this.saveSystem = data.saveSystem;
    this.device = data.device;

    const xpEarned = (data.roundsWon * XP_PER_ROUND) + (data.won ? XP_PER_MATCH : 0) + (data.won && data.totalFights >= 5 ? XP_PER_RUN : 0);
    const coinsEarned = (data.roundsWon * COINS_PER_ROUND) + (data.won ? COINS_PER_MATCH : 0) + (data.won && data.totalFights >= 5 ? COINS_PER_RUN : 0);

    this.create(xpEarned, coinsEarned, data.won, data.gauntletFight, data.totalFights);
  }

  private create(xpEarned: number, coinsEarned: number, won: boolean, gauntletFight: number, totalFights: number): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x111122);

    this.add.text(GAME_WIDTH / 2, 80, won ? "VICTORY!" : "DEFEAT", {
      font: "bold 56px sans-serif",
      color: won ? "#00cc00" : "#cc0000",
    }).setOrigin(0.5);

    const oldLevel = this.saveSystem.getLevel();
    const oldXp = this.saveSystem.getXp();

    this.saveSystem.addXp(xpEarned);
    this.saveSystem.addCoins(coinsEarned);
    this.saveSystem.incrementStat("totalMatches");
    if (won) this.saveSystem.incrementStat("totalWins");

    const newXp = this.saveSystem.getXp();
    const newLevel = calculateLevel(newXp);

    if (newLevel > oldLevel) {
      this.saveSystem.setLevel(newLevel);
      const reward = getUnlockReward(newLevel);
      this.add.text(GAME_WIDTH / 2, 160, `LEVEL UP! Level ${newLevel}`, {
        font: "bold 28px sans-serif",
        color: "#ffcc00",
      }).setOrigin(0.5);
      if (reward) {
        this.add.text(GAME_WIDTH / 2, 195, `Unlocked: ${reward}`, {
          font: "18px sans-serif",
          color: "#00ffaa",
        }).setOrigin(0.5);
      }
    }

    this.add.text(GAME_WIDTH / 2, 240, `XP Earned: +${xpEarned}`, {
      font: "24px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 280, `Coins Earned: +${coinsEarned}`, {
      font: "24px sans-serif",
      color: "#ffffff",
    }).setOrigin(0.5);

    this.add.text(GAME_WIDTH / 2, 320, `Fight: ${gauntletFight} / ${totalFights}`, {
      font: "18px sans-serif",
      color: "#aaaaaa",
    }).setOrigin(0.5);

    if (won && gauntletFight < totalFights) {
      new Button(this, GAME_WIDTH / 2, 420, "NEXT FIGHT", () => {
        this.scene.start(SceneKey.UpgradeSelect);
        this.scene.start(SceneKey.Game, {
          mode: "gauntlet",
          playerCharacter: this.registry.get("playerCharacter") || "rex",
          saveSystem: this.saveSystem,
          device: this.device,
          gauntletFight: gauntletFight + 1,
        });
      });
    }

    new Button(this, GAME_WIDTH / 2 - 120, won ? 500 : 420, "PLAY AGAIN", () => {
      this.scene.start(SceneKey.CharacterSelect, { saveSystem: this.saveSystem, device: this.device });
    });

    new Button(this, GAME_WIDTH / 2 + 120, won ? 500 : 420, "MAIN MENU", () => {
      this.scene.start(SceneKey.MainMenu, { saveSystem: this.saveSystem, device: this.device });
    });
  }
}
