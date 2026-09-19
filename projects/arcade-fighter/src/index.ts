import "./html/css/main.css";
import { createGameConfig } from "./game/config/PhaserConfig";
import { Boot } from "./game/scenes/Boot";
import { Preloader } from "./game/scenes/Preloader";
import { MainMenu } from "./game/scenes/MainMenu";
import { CharacterSelect } from "./game/scenes/CharacterSelect";
import { Settings } from "./game/scenes/Settings";
import { GameScene } from "./game/scenes/GameScene";
import { FightOverlay } from "./game/scenes/FightOverlay";
import { PauseMenu } from "./game/scenes/PauseMenu";
import { UpgradeSelect } from "./game/scenes/UpgradeSelect";
import { Results } from "./game/scenes/Results";
import { LevelUp } from "./game/scenes/LevelUp";

function createGame(parent: HTMLElement): Phaser.Game {
  const config = createGameConfig(parent);
  config.scene = [
    Boot,
    Preloader,
    MainMenu,
    CharacterSelect,
    Settings,
    GameScene,
    FightOverlay,
    PauseMenu,
    UpgradeSelect,
    Results,
    LevelUp,
  ];
  return new Phaser.Game(config);
}

window.addEventListener("load", () => {
  const container = document.getElementById("game");
  if (!container) {
    throw new Error('Game container #game not found in HTML.');
  }
  createGame(container);
});
