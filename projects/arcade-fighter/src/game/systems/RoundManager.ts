import Phaser from "phaser";
import { EventBus } from "../utils/EventBus";
import { ROUND } from "../utils/Constants";
import { Fighter } from "../entities/Fighter";

export enum RoundPhase {
  Intro = "intro",
  Fighting = "fighting",
  KO = "ko",
  RoundEnd = "roundEnd",
  MatchEnd = "matchEnd",
}

export class RoundManager {
  private scene: Phaser.Scene;
  private phase: RoundPhase = RoundPhase.Intro;
  private currentRound: number = 1;
  private p1Wins: number = 0;
  private p2Wins: number = 0;
  private timer: number = ROUND.timerSeconds;
  private timerEvent: Phaser.Time.TimerEvent | null = null;
  private matchWinner: "p1" | "p2" | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  startRound(): void {
    this.phase = RoundPhase.Intro;
    this.timer = ROUND.timerSeconds;

    EventBus.emit("roundStart", { round: this.currentRound });

    this.scene.time.delayedCall(ROUND.introDuration, () => {
      this.phase = RoundPhase.Fighting;
      this.startTimer();
      EventBus.emit("fightStart", {});
    });
  }

  private startTimer(): void {
    this.timerEvent = this.scene.time.addEvent({
      delay: 1000,
      repeat: ROUND.timerSeconds - 1,
      callback: () => {
        this.timer--;
        EventBus.emit("timerTick", { time: this.timer });
        if (this.timer <= 0) {
          this.onTimerExpire();
        }
      },
    });
  }

  private onTimerExpire(): void {
    this.phase = RoundPhase.RoundEnd;
    this.timerEvent?.destroy();
    EventBus.emit("timeUp", {});
    this.endRound(null);
  }

  onKO(winner: "p1" | "p2"): void {
    if (this.phase !== RoundPhase.Fighting) return;
    this.phase = RoundPhase.KO;
    this.timerEvent?.destroy();

    EventBus.emit("koAnimation", { winner });

    this.scene.time.delayedCall(ROUND.roundEndDuration, () => {
      this.endRound(winner);
    });
  }

  private endRound(winner: "p1" | "p2" | null): void {
    if (winner === "p1") this.p1Wins++;
    else if (winner === "p2") this.p2Wins++;

    EventBus.emit("roundEnd", { round: this.currentRound, p1Wins: this.p1Wins, p2Wins: this.p2Wins, winner });

    const winsNeeded = Math.ceil(ROUND.bestOf / 2);
    if (this.p1Wins >= winsNeeded || this.p2Wins >= winsNeeded) {
      this.matchWinner = this.p1Wins >= winsNeeded ? "p1" : "p2";
      this.phase = RoundPhase.MatchEnd;
      EventBus.emit("matchEnd", { winner: this.matchWinner, p1Wins: this.p1Wins, p2Wins: this.p2Wins });
    } else {
      this.scene.time.delayedCall(1000, () => {
        this.currentRound++;
        this.startRound();
      });
    }
  }

  reset(): void {
    this.currentRound = 1;
    this.p1Wins = 0;
    this.p2Wins = 0;
    this.timer = ROUND.timerSeconds;
    this.matchWinner = null;
    this.phase = RoundPhase.Intro;
    this.timerEvent?.destroy();
  }

  getPhase(): RoundPhase { return this.phase; }
  getCurrentRound(): number { return this.currentRound; }
  getTimer(): number { return this.timer; }
  getP1Wins(): number { return this.p1Wins; }
  getP2Wins(): number { return this.p2Wins; }
  getMatchWinner(): "p1" | "p2" | null { return this.matchWinner; }
}
