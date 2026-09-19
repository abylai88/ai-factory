import Phaser from "phaser";
import { EventBus } from "../utils/EventBus";

export class ParticleSystem {
  private scene: Phaser.Scene;
  private emitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
    this.setupListeners();
  }

  private setupListeners(): void {
    EventBus.on("hit", (data: { x: number; y: number; direction: number; color: number }) => {
      this.spawnHitParticles(data.x, data.y, data.direction, data.color);
    });
    EventBus.on("block", (data: { x: number; y: number }) => {
      this.spawnBlockParticles(data.x, data.y);
    });
    EventBus.on("ko", (data: { x: number; y: number }) => {
      this.spawnKOBurst(data.x, data.y);
    });
  }

  spawnHitParticles(x: number, y: number, direction: number, color: number = 0xffffff): void {
    const count = 8 + Math.floor(Math.random() * 5);
    for (let i = 0; i < count; i++) {
      const particle = this.scene.add.circle(x, y, 2 + Math.random() * 3, color);
      const angle = (direction > 0 ? 0 : Math.PI) + (Math.random() - 0.5) * 1.2;
      const speed = 200 + Math.random() * 200;
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed * 0.5,
        y: y + Math.sin(angle) * speed * 0.5 - 30,
        alpha: 0,
        scale: 0,
        duration: 200 + Math.random() * 200,
        ease: "Power2",
        onComplete: () => particle.destroy(),
      });
    }
  }

  spawnBlockParticles(x: number, y: number): void {
    const count = 4 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count; i++) {
      const particle = this.scene.add.circle(x, y, 2 + Math.random() * 2, 0x888888);
      const angle = Math.random() * Math.PI * 2;
      const speed = 100 + Math.random() * 100;
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed * 0.3,
        y: y + Math.sin(angle) * speed * 0.3,
        alpha: 0,
        scale: 0,
        duration: 150 + Math.random() * 150,
        ease: "Power2",
        onComplete: () => particle.destroy(),
      });
    }
  }

  spawnKOBurst(x: number, y: number): void {
    const count = 20 + Math.floor(Math.random() * 11);
    const colors = [0xff3300, 0xff6600, 0xff9900, 0xffcc00];
    for (let i = 0; i < count; i++) {
      const color = colors[Math.floor(Math.random() * colors.length)];
      const particle = this.scene.add.circle(x, y, 3 + Math.random() * 5, color);
      const angle = Math.random() * Math.PI * 2;
      const speed = 300 + Math.random() * 300;
      this.scene.tweens.add({
        targets: particle,
        x: x + Math.cos(angle) * speed,
        y: y + Math.sin(angle) * speed - 50,
        alpha: 0,
        scale: 0,
        duration: 500 + Math.random() * 300,
        ease: "Power2",
        onComplete: () => particle.destroy(),
      });
    }
  }

  cleanup(): void {
    this.emitters.forEach((e) => e.destroy());
    this.emitters = [];
  }
}
