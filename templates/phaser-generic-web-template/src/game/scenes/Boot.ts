import Phaser from "phaser";
import { SceneKey } from "./Scenes";

export class Boot extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create() {
    this.scene.start(SceneKey.Preloader);
  }
}
