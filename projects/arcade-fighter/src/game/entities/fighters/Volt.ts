import { Fighter } from "../Fighter";

export class Volt extends Fighter {
  constructor(scene: Phaser.Scene, playerId: "p1" | "p2", x: number) {
    super(scene, "volt", playerId, x);
  }
}
