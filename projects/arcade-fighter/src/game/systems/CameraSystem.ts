import Phaser from "phaser";
import { EventBus } from "../utils/EventBus";
import { GAME_WIDTH, GAME_HEIGHT, PLAY_AREA } from "../utils/Constants";

export class CameraSystem {
  private scene: Phaser.Scene;
  private shakeIntensity: number = 0;
  private shakeDuration: number = 0;
  private shakeTimer: number = 0;
  private currentZoom: number = 1.0;
  private targetZoom: number = 1.0;
  private slowMoSpeed: number = 1.0;
  private slowMoTimer: number = 0;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupListeners();
  }

  private setupListeners(): void {
    EventBus.on("heavyHit", () => this.shake(4, 150));
    EventBus.on("specialHit", () => this.shake(6, 200));
    EventBus.on("counterHit", () => this.shake(8, 250));
    EventBus.on("ko", () => {
      this.shake(10, 400);
      this.startSlowMo(0.3, 500);
      this.zoomTo(1.3);
    });
    EventBus.on("perfectBlock", () => this.shake(2, 100));
    EventBus.on("guardBreak", () => this.shake(6, 300));
    EventBus.on("specialStart", () => this.zoomTo(1.1));
  }

  update(_time: number, delta: number, fighters: { getPosition: () => Phaser.Math.Vector2 }[]): void {
    if (fighters.length >= 2) {
      const p1 = fighters[0].getPosition();
      const p2 = fighters[1].getPosition();
      const midX = (p1.x + p2.x) / 2;
      const midY = Math.min(p1.y, p2.y) - 50;

      const clampedX = Phaser.Math.Clamp(midX, PLAY_AREA.x + 100, PLAY_AREA.x + PLAY_AREA.width - 100);
      const clampedY = Phaser.Math.Clamp(midY, PLAY_AREA.y + 50, PLAY_AREA.y + PLAY_AREA.height - 50);

      const cam = this.scene.cameras.main;
      cam.scrollX = Phaser.Math.Linear(cam.scrollX, clampedX - GAME_WIDTH / 2, 0.1);
      cam.scrollY = Phaser.Math.Linear(cam.scrollY, clampedY - GAME_HEIGHT / 2, 0.1);
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer -= delta;
      const decay = Math.exp(-this.shakeTimer / this.shakeDuration);
      const offset = this.shakeIntensity * Math.sin(this.shakeTimer * 0.05) * decay;
      this.scene.cameras.main.scrollY += offset;
    }

    const cam = this.scene.cameras.main;
    this.currentZoom = Phaser.Math.Linear(this.currentZoom, this.targetZoom, 0.1);
    cam.setZoom(this.currentZoom);

    if (this.slowMoTimer > 0) {
      this.slowMoTimer -= delta;
      if (this.slowMoTimer <= 0) {
        this.slowMoSpeed = 1.0;
        this.scene.time.timeScale = 1.0;
      }
    }
  }

  shake(intensity: number, duration: number): void {
    this.shakeIntensity = Math.min(intensity, 12);
    this.shakeDuration = duration;
    this.shakeTimer = duration;
  }

  zoomTo(zoom: number): void {
    this.targetZoom = zoom;
    this.scene.time.delayedCall(300, () => {
      this.targetZoom = 1.0;
    });
  }

  startSlowMo(speed: number, duration: number): void {
    this.slowMoSpeed = speed;
    this.slowMoTimer = duration;
    this.scene.time.timeScale = speed;
  }

  resetCamera(): void {
    this.currentZoom = 1.0;
    this.targetZoom = 1.0;
    this.slowMoSpeed = 1.0;
    this.slowMoTimer = 0;
    this.scene.cameras.main.setZoom(1.0);
    this.scene.time.timeScale = 1.0;
  }

  getSlowMoSpeed(): number {
    return this.slowMoSpeed;
  }
}
