import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { EventBus } from "../utils/EventBus";
import { GAME_WIDTH, GAME_HEIGHT, LEFT_BOUND, RIGHT_BOUND, GROUND_Y, GameMode, GAUNTLET_FIGHTS } from "../utils/Constants";
import { InputManager } from "../systems/InputManager";
import { CombatSystem } from "../systems/CombatSystem";
import { AISystem } from "../systems/AISystem";
import { CameraSystem } from "../systems/CameraSystem";
import { RoundManager, RoundPhase } from "../systems/RoundManager";
import { ComboTracker } from "../systems/ComboTracker";
import { ParticleSystem } from "../systems/ParticleSystem";
import { AudioManager } from "../systems/AudioManager";
import { Fighter } from "../entities/Fighter";
import { Stage } from "../entities/Stage";
import { getRandomStage } from "../data/stages";
import { CHARACTERS } from "../data/characters";
import { SaveSystem } from "../utils/SaveSystem";
import { DeviceInfo } from "../utils/DeviceDetector";
import { DifficultyTier } from "../utils/Constants";

export class GameScene extends Phaser.Scene {
  private inputManager!: InputManager;
  private combatSystem!: CombatSystem;
  private aiSystem: AISystem | null = null;
  private cameraSystem!: CameraSystem;
  private roundManager!: RoundManager;
  private comboTracker!: ComboTracker;
  private particleSystem!: ParticleSystem;
  private audioManager!: AudioManager;
  private p1!: Fighter;
  private p2!: Fighter;
  private stage!: Stage;
  private mode: GameMode = "gauntlet";
  private playerCharacter: string = "rex";
  private opponentCharacter: string = "volt";
  private gauntletFight: number = 1;
  private saveSystem!: SaveSystem;
  private device!: DeviceInfo;
  private isPaused: boolean = false;
  private activeUpgrades: string[] = [];
  private aiDifficulty: DifficultyTier = "Novice";

  constructor() {
    super(SceneKey.Game);
  }

  init(data: {
    mode?: GameMode;
    playerCharacter?: string;
    opponentCharacter?: string;
    saveSystem?: SaveSystem;
    device?: DeviceInfo;
    gauntletFight?: number;
    activeUpgrades?: string[];
  }): void {
    this.mode = data.mode || "gauntlet";
    this.playerCharacter = data.playerCharacter || "rex";
    this.opponentCharacter = data.opponentCharacter || this.getRandomOpponent();
    this.saveSystem = data.saveSystem || this.registry.get("saveSystem");
    this.device = data.device || this.registry.get("device");
    this.gauntletFight = data.gauntletFight || 1;
    this.activeUpgrades = data.activeUpgrades || [];
  }

  create() {
    this.isPaused = false;
    this.time.timeScale = 1;

    const stageData = getRandomStage();
    this.stage = new Stage(this, stageData);

    this.p1 = new Fighter(this, this.playerCharacter, "p1", LEFT_BOUND + 200);
    this.p2 = new Fighter(this, this.opponentCharacter, "p2", RIGHT_BOUND - 200);

    this.setAIDifficulty();
    this.aiSystem = new AISystem(this.aiDifficulty);

    this.inputManager = new InputManager(this, this.device);
    this.combatSystem = new CombatSystem(this);
    this.cameraSystem = new CameraSystem(this);
    this.roundManager = new RoundManager(this);
    this.comboTracker = new ComboTracker();
    this.particleSystem = new ParticleSystem(this);
    this.audioManager = new AudioManager(this);

    this.registry.set("p1Name", CHARACTERS[this.playerCharacter]?.name || "P1");
    this.registry.set("p2Name", CHARACTERS[this.opponentCharacter]?.name || "CPU");

    this.scene.launch(SceneKey.FightOverlay);

    this.setupEventListeners();
    this.roundManager.startRound();

    this.input.keyboard?.on("keydown-ESC", () => {
      if (!this.isPaused && this.roundManager.getPhase() === RoundPhase.Fighting) {
        this.isPaused = true;
        this.scene.pause();
        this.scene.launch(SceneKey.PauseMenu);
      }
    });

    EventBus.emit("gameplayStart", {});
  }

  private setupEventListeners(): void {
    EventBus.on("fightStart", () => {
      // Fight begins
    });

    EventBus.on("ko", (data: { loser: string; winner: string }) => {
      const winner = data.winner as "p1" | "p2";
      this.roundManager.onKO(winner);
      EventBus.emit("gameplayStop", {});
    });

    EventBus.on("matchEnd", (data: { winner: string }) => {
      this.time.delayedCall(1500, () => {
        this.endMatch(data.winner as "p1" | "p2");
      });
    });

    EventBus.on("upgradeSelected", (data: { upgrade: { id: string } }) => {
      this.activeUpgrades.push(data.upgrade.id);
      this.applyUpgrade(data.upgrade.id);
      this.scene.stop(SceneKey.UpgradeSelect);
      if (this.gauntletFight < GAUNTLET_FIGHTS) {
        this.scene.restart({
          mode: this.mode,
          playerCharacter: this.playerCharacter,
          saveSystem: this.saveSystem,
          device: this.device,
          gauntletFight: this.gauntletFight + 1,
          activeUpgrades: this.activeUpgrades,
        });
      } else {
        this.endMatch("p1");
      }
    });
  }

  update(time: number, delta: number): void {
    if (this.isPaused) return;
    if (this.roundManager.getPhase() !== RoundPhase.Fighting) {
      this.p1.update(delta, []);
      this.p2.update(delta, []);
      this.cameraSystem.update(time, delta, [this.p1, this.p2]);
      return;
    }

    this.inputManager.update();

    const p1Actions = this.inputManager.getActions();
    let p2Actions: string[] = [];

    if (this.aiSystem && this.p2) {
      const aiAction = this.aiSystem.update(delta, this.p2, this.p1);
      if (aiAction) p2Actions = [aiAction];
    }

    this.p1.updateFacing(this.p2.getPosition().x);
    this.p2.updateFacing(this.p1.getPosition().x);

    this.p1.update(delta, p1Actions);
    this.p2.update(delta, p2Actions);

    this.checkCombat();
    this.checkComboReset(time);

    this.cameraSystem.update(time, delta, [this.p1, this.p2]);
  }

  private checkCombat(): void {
    if (this.p1.isInState("attacking") || this.p1.isInState("crouch_attack")) {
      const frame = this.p1.getAttackFrame();
      const moveId = this.p1.getAttackMoveId();
      const isStartup = this.isStartupFrame(moveId);
      const isActive = this.isActiveFrame(moveId, frame);

      if (isActive && !this.p1.isInState("hitstun")) {
        const result = this.combatSystem.checkHit(this.p1, this.p2, moveId);
        if (result.hit && !result.blocked) {
          EventBus.emit("heavyHit", {});
        }
      }
    }

    if (this.p2.isInState("attacking") || this.p2.isInState("crouch_attack")) {
      const frame = this.p2.getAttackFrame();
      const moveId = this.p2.getAttackMoveId();
      const isActive = this.isActiveFrame(moveId, frame);

      if (isActive && !this.p2.isInState("hitstun")) {
        const result = this.combatSystem.checkHit(this.p2, this.p1, moveId);
        if (result.hit && !result.blocked) {
          EventBus.emit("heavyHit", {});
        }
      }
    }
  }

  private isStartupFrame(moveId: string): boolean {
    if (moveId === "light" || moveId === "crouchLight" || moveId === "airLight") return false;
    return true;
  }

  private isActiveFrame(moveId: string, frame: number): boolean {
    const startups: Record<string, number> = {
      light: 6, heavy: 12, crouchLight: 5, crouchHeavy: 14,
      airLight: 5, airHeavy: 10, special: 16,
    };
    const actives: Record<string, number> = { light: 3, heavy: 4, crouchLight: 3, crouchHeavy: 5, airLight: 4, airHeavy: 5, special: 6 };
    const s = startups[moveId] || 6;
    const a = actives[moveId] || 3;
    return frame >= s && frame < s + a;
  }

  private checkComboReset(time: number): void {
    if (this.comboTracker.shouldReset(time)) {
      this.comboTracker.reset();
    }
  }

  private setAIDifficulty(): void {
    if (this.mode === "quickmatch") {
      this.aiDifficulty = "Medium";
      return;
    }
    const difficulties: DifficultyTier[] = ["Novice", "Easy", "Medium", "Hard", "Boss"];
    const idx = Math.min(this.gauntletFight - 1, difficulties.length - 1);
    this.aiDifficulty = difficulties[idx];
  }

  private getRandomOpponent(): string {
    const chars = ["rex", "volt", "titan", "luna"];
    return chars[Math.floor(Math.random() * chars.length)];
  }

  private applyUpgrade(_upgradeId: string): void {
    // Upgrade application logic
  }

  private endMatch(winner: "p1" | "p2"): void {
    this.p1.destroy();
    this.p2.destroy();
    this.stage.destroy();
    this.scene.stop(SceneKey.FightOverlay);

    if (winner === "p1" && this.mode === "gauntlet" && this.gauntletFight < GAUNTLET_FIGHTS) {
      this.scene.start(SceneKey.UpgradeSelect);
    } else {
      this.scene.start(SceneKey.Results, {
        won: winner === "p1",
        roundsWon: this.roundManager.getP1Wins(),
        roundsLost: this.roundManager.getP2Wins(),
        gauntletFight: this.gauntletFight,
        totalFights: this.mode === "gauntlet" ? GAUNTLET_FIGHTS : 1,
        saveSystem: this.saveSystem,
        device: this.device,
        playerCharacter: this.playerCharacter,
      });
    }
  }
}
