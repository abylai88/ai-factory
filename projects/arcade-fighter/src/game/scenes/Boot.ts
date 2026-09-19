import Phaser from "phaser";
import { SceneKey } from "./Scenes";
import { SaveSystem } from "../utils/SaveSystem";
import { detectDevice } from "../utils/DeviceDetector";

export class Boot extends Phaser.Scene {
  constructor() {
    super(SceneKey.Boot);
  }

  create() {
    const device = detectDevice();
    const saveSystem = new SaveSystem();

    this.registry.set("device", device);
    this.registry.set("saveSystem", saveSystem);

    this.scene.start(SceneKey.Preloader);
  }
}
