import Phaser from "phaser";
import { COLORS, UI } from "../utils/Constants";

export class ComboCounter {
  private scene: Phaser.Scene;
  private text: Phaser.GameObjects.Text;
  private count: number = 0;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    this.scene = scene;
    this.text = scene.add.text(x, y, "", {
      font: `bold ${UI.comboCounterBaseSize}px sans-serif`,
      color: "#ffffff",
    }).setOrigin(0.5);
    this.text.setAlpha(0);
  }

  update(count: number): void {
    if (count < 2) {
      this.text.setAlpha(0);
      return;
    }
    this.count = count;
    this.text.setText(`${count}x`);
    this.text.setAlpha(1);

    let color: number = COLORS.comboWhite;
    let size: number = UI.comboCounterBaseSize;
    if (count >= 7) { color = COLORS.comboPurple; size = UI.comboCounterMaxSize; }
    else if (count >= 5) { color = COLORS.comboRed; size = 40; }
    else if (count >= 3) { color = COLORS.comboYellow; size = 32; }

    this.text.setStyle({ font: `bold ${size}px sans-serif`, color: "#" + color.toString(16).padStart(6, "0") });

    this.scene.tweens.add({
      targets: this.text,
      scaleX: 1.3,
      scaleY: 1.3,
      duration: 80,
      yoyo: true,
    });
  }

  reset(): void {
    this.count = 0;
    this.scene.tweens.add({ targets: this.text, alpha: 0, duration: 300 });
  }

  destroy(): void {
    this.text.destroy();
  }
}
