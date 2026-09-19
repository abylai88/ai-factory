import Phaser from "phaser";
import { PLAY_AREA, GROUND_Y } from "../utils/Constants";
import { StageData } from "../data/stages";

export class Stage {
  private scene: Phaser.Scene;
  private bgLayers: Phaser.GameObjects.Rectangle[] = [];
  private ground: Phaser.GameObjects.Rectangle;
  private leftWall: Phaser.GameObjects.Rectangle;
  private rightWall: Phaser.GameObjects.Rectangle;
  private ceiling: Phaser.GameObjects.Rectangle;
  private data: StageData;

  constructor(scene: Phaser.Scene, data: StageData) {
    this.scene = scene;
    this.data = data;

    this.ground = scene.add.rectangle(
      PLAY_AREA.x + PLAY_AREA.width / 2,
      GROUND_Y + 10,
      PLAY_AREA.width,
      20,
      data.groundColor
    );
    scene.add.existing(this.ground);
    this.ground.setDepth(-1);

    this.leftWall = scene.add.rectangle(PLAY_AREA.x - 5, PLAY_AREA.y + PLAY_AREA.height / 2, 10, PLAY_AREA.height, 0x333333);
    this.rightWall = scene.add.rectangle(PLAY_AREA.x + PLAY_AREA.width + 5, PLAY_AREA.y + PLAY_AREA.height / 2, 10, PLAY_AREA.height, 0x333333);
    this.ceiling = scene.add.rectangle(PLAY_AREA.x + PLAY_AREA.width / 2, PLAY_AREA.y - 5, PLAY_AREA.width, 10, 0x222222);

    this.bgLayers.push(
      scene.add.rectangle(PLAY_AREA.x + PLAY_AREA.width / 2, PLAY_AREA.y + PLAY_AREA.height / 2, PLAY_AREA.width, PLAY_AREA.height, data.bgColor).setDepth(-3)
    );

    const midColor = Phaser.Display.Color.Interpolate.ColorWithColor(
      Phaser.Display.Color.IntegerToColor(data.bgColor),
      Phaser.Display.Color.IntegerToColor(data.ambientColor),
      10, 5
    );
    const midHex = Phaser.Display.Color.GetColor(midColor.r, midColor.g, midColor.b);
    this.bgLayers.push(
      scene.add.rectangle(PLAY_AREA.x + PLAY_AREA.width / 2, PLAY_AREA.y + PLAY_AREA.height * 0.6, PLAY_AREA.width, PLAY_AREA.height * 0.4, midHex).setDepth(-2).setAlpha(0.5)
    );
  }

  destroy(): void {
    this.bgLayers.forEach((l) => l.destroy());
    this.ground.destroy();
    this.leftWall.destroy();
    this.rightWall.destroy();
    this.ceiling.destroy();
  }

  getData(): StageData {
    return this.data;
  }
}
