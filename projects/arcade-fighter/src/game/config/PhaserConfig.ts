import Phaser from "phaser";
import { GAME_WIDTH, GAME_HEIGHT, PHYSICS } from "../utils/Constants";

export function createGameConfig(parent: HTMLElement): Phaser.Types.Core.GameConfig {
  return {
    parent,
    type: Phaser.AUTO,
    backgroundColor: "#0a0a1a",
    width: GAME_WIDTH,
    height: GAME_HEIGHT,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    physics: {
      default: "arcade",
      arcade: {
        gravity: { x: 0, y: PHYSICS.gravity },
        debug: false,
        fps: 60,
      },
    },
    input: {
      activePointers: 4,
    },
  };
}
