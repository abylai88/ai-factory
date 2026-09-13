import "./html/css/main.css";
import * as Phaser from "phaser";
import { Boot } from "./game/scenes/Boot";
import { Preloader } from "./game/scenes/Preloader";
import { MainMenu } from "./game/scenes/MainMenu";
import { GameScene } from "./game/scenes/GameScene";

function createGame(parent: HTMLElement): Phaser.Game {
  return new Phaser.Game({
    parent,
    type: Phaser.AUTO,
    backgroundColor: "#2d2d2d",
    width: 1280,
    height: 720,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: [Boot, Preloader, MainMenu, GameScene],
  });
}

window.addEventListener("load", () => {
  const container = document.getElementById("game");
  if (!container) {
    throw new Error('Game container #game not found in HTML.');
  }
  createGame(container);
});
