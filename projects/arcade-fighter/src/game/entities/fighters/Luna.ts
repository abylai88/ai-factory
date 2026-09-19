import { Fighter } from "../Fighter";

export class Luna extends Fighter {
  constructor(scene: Phaser.Scene, playerId: "p1" | "p2", x: number) {
    super(scene, "luna", playerId, x);
  }
}
