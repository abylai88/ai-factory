import Phaser from "phaser";

export class Button {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private label: Phaser.GameObjects.Text;
  private onClick: () => void;

  constructor(
    scene: Phaser.Scene,
    x: number,
    y: number,
    text: string,
    onClick: () => void,
    width = 200,
    height = 50,
    fontSize = "24px"
  ) {
    this.scene = scene;
    this.onClick = onClick;

    this.bg = scene.add.rectangle(0, 0, width, height, 0x444444);
    this.bg.setStrokeStyle(2, 0x666666);

    this.label = scene.add.text(0, 0, text, {
      font: `bold ${fontSize} sans-serif`,
      color: "#ffffff",
    }).setOrigin(0.5);

    this.container = scene.add.container(x, y, [this.bg, this.label]);
    this.container.setSize(width, height);
    this.container.setInteractive({ useHandCursor: true });

    this.container.on("pointerover", () => {
      this.bg.setFillStyle(0x666666);
      this.scene.tweens.add({ targets: this.container, scaleX: 1.05, scaleY: 1.05, duration: 100 });
    });

    this.container.on("pointerout", () => {
      this.bg.setFillStyle(0x444444);
      this.scene.tweens.add({ targets: this.container, scaleX: 1, scaleY: 1, duration: 100 });
    });

    this.container.on("pointerdown", () => {
      this.bg.setFillStyle(0x333333);
      this.scene.tweens.add({ targets: this.container, scaleX: 0.95, scaleY: 0.95, duration: 50 });
    });

    this.container.on("pointerup", () => {
      this.bg.setFillStyle(0x666666);
      this.scene.tweens.add({ targets: this.container, scaleX: 1, scaleY: 1, duration: 50 });
      onClick();
    });
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
  }

  setText(text: string): void {
    this.label.setText(text);
  }

  setEnabled(enabled: boolean): void {
    if (enabled) {
      this.container.setInteractive({ useHandCursor: true });
      this.bg.setFillStyle(0x444444);
      this.label.setAlpha(1);
    } else {
      this.container.disableInteractive();
      this.bg.setFillStyle(0x222222);
      this.label.setAlpha(0.5);
    }
  }

  destroy(): void {
    this.container.destroy();
  }
}
