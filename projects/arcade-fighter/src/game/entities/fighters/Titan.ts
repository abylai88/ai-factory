import { Fighter } from "../Fighter";

export class Titan extends Fighter {
  constructor(scene: Phaser.Scene, playerId: "p1" | "p2", x: number) {
    super(scene, "titan", playerId, x);
  }
}
