import { Fighter } from "../Fighter";
import { CHARACTERS } from "../../data/characters";

export class Rex extends Fighter {
  constructor(scene: Phaser.Scene, playerId: "p1" | "p2", x: number) {
    super(scene, "rex", playerId, x);
  }
}
