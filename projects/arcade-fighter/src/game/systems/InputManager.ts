import Phaser from "phaser";
import { GameAction, COMBAT } from "../utils/Constants";
import { DeviceInfo } from "../utils/DeviceDetector";

interface InputBufferEntry {
  action: GameAction;
  framesLeft: number;
}

const KEYBOARD_P1: Record<string, GameAction> = {
  KeyA: "moveLeft",
  KeyD: "moveRight",
  KeyW: "jump",
  KeyS: "crouch",
  KeyJ: "lightAttack",
  KeyK: "heavyAttack",
  KeyL: "block",
  Space: "special",
  Escape: "pause",
};

const KEYBOARD_P2: Record<string, GameAction> = {
  ArrowLeft: "moveLeft",
  ArrowRight: "moveRight",
  ArrowUp: "jump",
  ArrowDown: "crouch",
  Numpad1: "lightAttack",
  Numpad2: "heavyAttack",
  Numpad3: "block",
  Numpad0: "special",
};

interface TouchButton {
  action: GameAction;
  rect: Phaser.Geom.Rectangle;
  pointerId: number | null;
  active: boolean;
}

export class InputManager {
  private scene: Phaser.Scene;
  private device: DeviceInfo;
  private keys: Map<string, Phaser.Input.Keyboard.Key> = new Map();
  private buffer: InputBufferEntry[] = [];
  private currentActions: GameAction[] = [];
  private previousActions: GameAction[] = [];
  private touchButtons: TouchButton[] = [];
  private joystick: {
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } = { active: false, pointerId: null, startX: 0, startY: 0, currentX: 0, currentY: 0 };

  constructor(scene: Phaser.Scene, device: DeviceInfo) {
    this.scene = scene;
    this.device = device;
    this.setupKeyboard();
    if (device.isTouchDevice) {
      this.setupTouch();
    }
  }

  private setupKeyboard(): void {
    const keyboard = this.scene.input.keyboard;
    if (!keyboard) return;

    const allKeys = [
      ...Object.keys(KEYBOARD_P1),
      ...Object.keys(KEYBOARD_P2),
    ];

    for (const code of allKeys) {
      const key = keyboard.addKey(code);
      this.keys.set(code, key);
    }
  }

  private setupTouch(): void {
    const w = this.scene.cameras.main.width;
    const h = this.scene.cameras.main.height;
    const btnSize = 56;
    const jumpSize = 64;
    const padding = 20;
    const bottomY = h - padding - btnSize / 2;

    this.touchButtons = [
      { action: "jump", rect: new Phaser.Geom.Rectangle(padding, h - padding - jumpSize, jumpSize, jumpSize), pointerId: null, active: false },
      { action: "lightAttack", rect: new Phaser.Geom.Rectangle(w - padding - btnSize, bottomY - btnSize - 10, btnSize, btnSize), pointerId: null, active: false },
      { action: "heavyAttack", rect: new Phaser.Geom.Rectangle(w - padding - btnSize * 2 - 15, bottomY, btnSize, btnSize), pointerId: null, active: false },
      { action: "block", rect: new Phaser.Geom.Rectangle(w - padding - btnSize, bottomY, btnSize, btnSize), pointerId: null, active: false },
    ];

    const input = this.scene.input;
    input.on("pointerdown", (pointer: Phaser.Input.Pointer) => {
      if (pointer.x < w / 2 && pointer.y > h * 0.4) {
        this.joystick.active = true;
        this.joystick.pointerId = pointer.id;
        this.joystick.startX = pointer.x;
        this.joystick.startY = pointer.y;
        this.joystick.currentX = pointer.x;
        this.joystick.currentY = pointer.y;
      } else {
        for (const btn of this.touchButtons) {
          if (btn.rect.contains(pointer.x, pointer.y)) {
            btn.pointerId = pointer.id;
            btn.active = true;
          }
        }
      }
    });

    input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.joystick.pointerId) {
        this.joystick.currentX = pointer.x;
        this.joystick.currentY = pointer.y;
      }
    });

    input.on("pointerup", (pointer: Phaser.Input.Pointer) => {
      if (pointer.id === this.joystick.pointerId) {
        this.joystick.active = false;
        this.joystick.pointerId = null;
      }
      for (const btn of this.touchButtons) {
        if (pointer.id === btn.pointerId) {
          btn.pointerId = null;
          btn.active = false;
        }
      }
    });
  }

  update(): void {
    this.previousActions = [...this.currentActions];
    this.currentActions = [];
    this.processKeyboard();
    if (this.device.isTouchDevice) {
      this.processTouch();
    }
    this.processBuffer();
  }

  private processKeyboard(): void {
    const checkKeys = (map: Record<string, GameAction>) => {
      for (const [code, action] of Object.entries(map)) {
        const key = this.keys.get(code);
        if (key && key.isDown) {
          if (!this.isRepeatAction(action) || key.getDuration() === 0) {
            this.addAction(action);
          }
        }
      }
    };
    checkKeys(KEYBOARD_P1);
    checkKeys(KEYBOARD_P2);
  }

  private processTouch(): void {
    for (const btn of this.touchButtons) {
      if (btn.active) {
        this.addAction(btn.action);
      }
    }

    if (this.joystick.active) {
      const dx = this.joystick.currentX - this.joystick.startX;
      const dy = this.joystick.currentY - this.joystick.startY;
      const deadZone = 16;

      if (Math.abs(dx) > deadZone) {
        this.addAction(dx > 0 ? "moveRight" : "moveLeft");
      }
      if (dy > deadZone) {
        this.addAction("crouch");
      }
    }
  }

  private isRepeatAction(action: GameAction): boolean {
    return action === "moveLeft" || action === "moveRight" || action === "crouch";
  }

  private addAction(action: GameAction): void {
    if (!this.currentActions.includes(action)) {
      this.currentActions.push(action);
    }
  }

  private processBuffer(): void {
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      this.buffer[i].framesLeft--;
      if (this.buffer[i].framesLeft <= 0) {
        this.buffer.splice(i, 1);
      }
    }
  }

  isActionPressed(action: GameAction): boolean {
    return this.currentActions.includes(action);
  }

  isActionJustPressed(action: GameAction): boolean {
    return this.currentActions.includes(action) && !this.previousActions.includes(action);
  }

  bufferAction(action: GameAction): void {
    const existing = this.buffer.find((e) => e.action === action);
    if (existing) {
      existing.framesLeft = COMBAT.inputBuffer;
    } else {
      this.buffer.push({ action, framesLeft: COMBAT.inputBuffer });
    }
  }

  consumeBuffered(action: GameAction): boolean {
    const idx = this.buffer.findIndex((e) => e.action === action);
    if (idx !== -1) {
      this.buffer.splice(idx, 1);
      return true;
    }
    return false;
  }

  getActions(): GameAction[] {
    return [...this.currentActions];
  }

  hasBufferedAction(action: GameAction): boolean {
    return this.buffer.some((e) => e.action === action);
  }
}
