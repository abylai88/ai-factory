import Phaser from "phaser";
import { FIGHTER_STATES, PHYSICS, HITSTOP, PLAY_AREA, LEFT_BOUND, RIGHT_BOUND, GROUND_Y, COMBAT } from "../utils/Constants";
import { CharacterStats, CHARACTERS } from "../data/characters";
import { EventBus } from "../utils/EventBus";

export class Fighter {
  scene: Phaser.Scene;
  sprite: Phaser.GameObjects.Rectangle;
  playerId: "p1" | "p2";
  stats: CharacterStats;
  private state: string = FIGHTER_STATES.Idle;
  private hp: number;
  private maxHp: number;
  private sp: number;
  private maxSp: number;
  private facing: number = 1;
  private comboCount: number = 0;
  private velocityX: number = 0;
  private velocityY: number = 0;
  private isGrounded: boolean = true;
  private attackFrame: number = 0;
  private attackMoveId: string = "";
  private attackTotalFrames: number = 0;
  private hitstunFrames: number = 0;
  private knockbackX: number = 0;
  private perfectBlockWindow: number = 0;
  private guardBreakTimer: number = 0;
  private spRegenRate: number = 8;
  private damageMultiplier: number = 1.0;
  private speedMultiplier: number = 1.0;
  private cooldownTimer: number = 0;

  // Hit stop (freeze frame) state
  private hitstopTimer: number = 0;
  private isHitstopping: boolean = false;

  // Coyote time & jump buffer
  private coyoteTimer: number = 0;
  private jumpBufferTimer: number = 0;
  private jumpBuffered: boolean = false;

  constructor(scene: Phaser.Scene, characterId: string, playerId: "p1" | "p2", x: number) {
    this.scene = scene;
    this.playerId = playerId;
    this.stats = CHARACTERS[characterId] || CHARACTERS.rex;
    this.hp = this.stats.hp;
    this.maxHp = this.stats.hp;
    this.sp = this.stats.sp;
    this.maxSp = this.stats.sp;

    this.sprite = scene.add.rectangle(x, GROUND_Y - 44, 48, 88, this.stats.color);
    this.sprite.setOrigin(0.5, 1);
    scene.add.existing(this.sprite);

    if (playerId === "p2") {
      this.facing = -1;
      this.sprite.setScale(-1, 1);
    }
  }

  update(delta: number, inputActions: string[]): void {
    // Hit stop: freeze fighter during hit stop frames
    if (this.isHitstopping) {
      this.hitstopTimer -= delta;
      if (this.hitstopTimer <= 0) {
        this.isHitstopping = false;
        this.hitstopTimer = 0;
      }
      // Update sprite position but don't process state during hitstop
      this.updateSprite();
      return;
    }

    this.updateTimers(delta);
    this.updateCoyoteTime(delta);
    this.updateJumpBuffer(delta);
    this.applyGravity(delta);
    this.applySpRegen(delta);

    // Check jump buffer: if we buffered a jump and are now grounded, execute it
    if (this.jumpBuffered && this.isGrounded && this.canAct()) {
      this.jumpBuffered = false;
      this.jumpBufferTimer = 0;
      this.jump();
      this.applyVelocity(delta);
      this.clampPosition();
      this.updateSprite();
      return;
    }

    switch (this.state) {
      case FIGHTER_STATES.Idle:
        this.handleIdle(inputActions);
        break;
      case FIGHTER_STATES.Walking:
        this.handleWalking(inputActions);
        break;
      case FIGHTER_STATES.Jumping:
        this.handleJumping(inputActions);
        break;
      case FIGHTER_STATES.Crouching:
        this.handleCrouching(inputActions);
        break;
      case FIGHTER_STATES.Attacking:
        this.handleAttacking();
        break;
      case FIGHTER_STATES.CrouchAttack:
        this.handleAttacking();
        break;
      case FIGHTER_STATES.Blocking:
        this.handleBlocking(inputActions);
        break;
      case FIGHTER_STATES.Hitstun:
        this.handleHitstun();
        break;
      case FIGHTER_STATES.KO:
        break;
      case FIGHTER_STATES.Dashing:
        this.handleDashing();
        break;
    }

    this.applyVelocity(delta);
    this.clampPosition();
    this.updateSprite();
  }

  private updateTimers(delta: number): void {
    if (this.cooldownTimer > 0) this.cooldownTimer -= delta;
    if (this.perfectBlockWindow > 0) this.perfectBlockWindow -= delta;
    if (this.guardBreakTimer > 0) {
      this.guardBreakTimer -= delta;
      if (this.guardBreakTimer <= 0) {
        this.sp = this.maxSp;
        this.changeState(FIGHTER_STATES.Idle);
      }
    }
  }

  private updateCoyoteTime(delta: number): void {
    if (this.isGrounded) {
      this.coyoteTimer = PHYSICS.coyoteTime * (delta / 16.67);
    } else {
      if (this.coyoteTimer > 0) {
        this.coyoteTimer--;
      }
    }
  }

  private updateJumpBuffer(delta: number): void {
    if (this.jumpBufferTimer > 0) {
      this.jumpBufferTimer -= delta / 16.67;
      if (this.jumpBufferTimer <= 0) {
        this.jumpBuffered = false;
        this.jumpBufferTimer = 0;
      }
    }
  }

  private canAct(): boolean {
    return (
      this.state !== FIGHTER_STATES.Attacking &&
      this.state !== FIGHTER_STATES.CrouchAttack &&
      this.state !== FIGHTER_STATES.Hitstun &&
      this.state !== FIGHTER_STATES.KO &&
      this.state !== FIGHTER_STATES.Dashing &&
      this.guardBreakTimer <= 0
    );
  }

  /** Trigger hit stop (freeze frame) on this fighter */
  applyHitstop(frames: number): void {
    const duration = frames * HITSTOP.frameDuration;
    if (this.isHitstopping) {
      // Stack hit stop, but cap at max
      this.hitstopTimer = Math.min(this.hitstopTimer + duration, HITSTOP.maxStack * HITSTOP.frameDuration);
    } else {
      this.hitstopTimer = duration;
      this.isHitstopping = true;
    }
  }

  isCurrentlyHitstopping(): boolean {
    return this.isHitstopping;
  }

  private applyGravity(delta: number): void {
    if (!this.isGrounded) {
      const gravMult = this.velocityY > 0 ? 1.2 : 1.0;
      this.velocityY += PHYSICS.gravity * gravMult * (delta / 1000);
      this.velocityY = Math.min(this.velocityY, PHYSICS.maxFallSpeed);
    }
  }

  private applySpRegen(delta: number): void {
    if (this.state !== FIGHTER_STATES.Blocking) {
      this.sp = Math.min(this.maxSp, this.sp + this.spRegenRate * (delta / 1000));
    }
  }

  private handleIdle(actions: string[]): void {
    if (actions.includes("jump") && this.isGrounded) {
      this.jump();
    } else if (actions.includes("crouch")) {
      this.changeState(FIGHTER_STATES.Crouching);
      this.sprite.setSize(48, 56);
    } else if (actions.includes("lightAttack") && this.cooldownTimer <= 0) {
      this.startAttack("light");
    } else if (actions.includes("heavyAttack") && this.cooldownTimer <= 0 && this.sp >= 15) {
      this.startAttack("heavy");
    } else if (actions.includes("special") && this.sp >= this.stats.specialCost) {
      this.startSpecial();
    } else if (actions.includes("block")) {
      this.changeState(FIGHTER_STATES.Blocking);
    } else if (actions.includes("moveRight")) {
      this.changeState(FIGHTER_STATES.Walking);
      this.velocityX = this.stats.walkSpeed * this.speedMultiplier;
    } else if (actions.includes("moveLeft")) {
      this.changeState(FIGHTER_STATES.Walking);
      this.velocityX = -this.stats.walkSpeed * this.speedMultiplier;
    }
  }

  private handleWalking(actions: string[]): void {
    if (actions.includes("jump") && this.isGrounded) {
      this.jump();
    } else if (actions.includes("crouch")) {
      this.changeState(FIGHTER_STATES.Crouching);
      this.sprite.setSize(48, 56);
      this.velocityX = 0;
    } else if (actions.includes("lightAttack") && this.cooldownTimer <= 0) {
      this.startAttack("light");
    } else if (actions.includes("heavyAttack") && this.cooldownTimer <= 0 && this.sp >= 15) {
      this.startAttack("heavy");
    } else if (actions.includes("special") && this.sp >= this.stats.specialCost) {
      this.startSpecial();
    } else if (actions.includes("block")) {
      this.changeState(FIGHTER_STATES.Blocking);
      this.velocityX = 0;
    } else if (actions.includes("moveRight")) {
      this.velocityX = this.stats.walkSpeed * this.speedMultiplier;
    } else if (actions.includes("moveLeft")) {
      this.velocityX = -this.stats.walkSpeed * this.speedMultiplier;
    } else {
      this.velocityX = 0;
      this.changeState(FIGHTER_STATES.Idle);
    }
  }

  private handleJumping(actions: string[]): void {
    if (actions.includes("lightAttack") && this.cooldownTimer <= 0) {
      this.startAttack("airLight");
    } else if (actions.includes("heavyAttack") && this.cooldownTimer <= 0 && this.sp >= 15) {
      this.startAttack("airHeavy");
    }

    if (actions.includes("moveRight")) {
      this.velocityX = this.stats.walkSpeed * this.speedMultiplier;
    } else if (actions.includes("moveLeft")) {
      this.velocityX = -this.stats.walkSpeed * this.speedMultiplier;
    }
  }

  private handleCrouching(actions: string[]): void {
    if (!actions.includes("crouch")) {
      this.sprite.setSize(48, 88);
      this.changeState(FIGHTER_STATES.Idle);
      return;
    }
    if (actions.includes("lightAttack") && this.cooldownTimer <= 0) {
      this.startAttack("crouchLight");
    } else if (actions.includes("heavyAttack") && this.cooldownTimer <= 0 && this.sp >= 15) {
      this.startAttack("crouchHeavy");
    }
  }

  private handleAttacking(): void {
    this.attackFrame++;
    if (this.attackFrame >= this.attackTotalFrames) {
      this.sprite.setSize(48, 88);
      this.changeState(this.isGrounded ? FIGHTER_STATES.Idle : FIGHTER_STATES.Jumping);
      this.cooldownTimer = 4;
    }
  }

  private handleBlocking(actions: string[]): void {
    if (!actions.includes("block")) {
      this.changeState(FIGHTER_STATES.Idle);
    }
  }

  private handleHitstun(): void {
    this.hitstunFrames--;
    if (this.hitstunFrames <= 0) {
      this.changeState(FIGHTER_STATES.Idle);
    }
  }

  private handleDashing(): void {
    this.cooldownTimer -= 16.67;
    if (this.cooldownTimer <= 0) {
      this.changeState(FIGHTER_STATES.Idle);
      this.velocityX = 0;
    }
  }

  private jump(): void {
    this.velocityY = this.stats.jumpVelocity;
    this.isGrounded = false;
    this.changeState(FIGHTER_STATES.Jumping);
  }

  private startAttack(moveId: string): void {
    this.attackMoveId = moveId;
    this.attackFrame = 0;
    const isLight = moveId.includes("Light");
    const startup = isLight ? 6 : 12;
    const active = isLight ? 3 : 4;
    const recovery = isLight ? 4 : 8;
    this.attackTotalFrames = startup + active + recovery;
    this.changeState(moveId.startsWith("crouch") ? FIGHTER_STATES.CrouchAttack : FIGHTER_STATES.Attacking);

    if (moveId === "heavy") {
      this.sp -= 15;
    }
  }

  private startSpecial(): void {
    this.sp -= this.stats.specialCost;
    this.attackMoveId = "special";
    this.attackFrame = 0;
    this.attackTotalFrames = 36;
    this.changeState(FIGHTER_STATES.Attacking);
    EventBus.emit("specialStart", { player: this.playerId });
  }

  changeState(newState: string): void {
    if (this.state === newState) return;
    this.state = newState;
    EventBus.emit("stateChange", { player: this.playerId, state: newState });
  }

  takeDamage(amount: number): void {
    const actualDamage = Math.floor(amount * this.damageMultiplier);
    this.hp = Math.max(0, this.hp - actualDamage);
    EventBus.emit("hit", {
      x: this.sprite.x,
      y: this.sprite.y - 44,
      direction: -this.facing,
      color: this.stats.color,
    });
  }

  applyHitstun(frames: number, kbX: number, kbY: number, fromDirection: number): void {
    this.hitstunFrames = frames;
    this.knockbackX = kbX * fromDirection / this.stats.weight;
    this.velocityY = kbY;
    this.changeState(FIGHTER_STATES.Hitstun);
    this.sprite.setSize(48, 88);
  }

  applyPerfectBlock(): void {
    this.perfectBlockWindow = 0;
    this.sp += COMBAT.perfectBlockRefund;
  }

  drainStamina(amount: number): void {
    this.sp = Math.max(0, this.sp - amount);
  }

  triggerGuardBreak(): void {
    this.guardBreakTimer = COMBAT.guardBreakDuration * 16.67;
    this.changeState(FIGHTER_STATES.Hitstun);
    this.knockbackX = -this.facing * COMBAT.guardBreakPushback;
    this.sprite.setSize(48, 88);
  }

  incrementCombo(): void {
    this.comboCount++;
  }

  resetCombo(): void {
    this.comboCount = 0;
  }

  updateFacing(opponentX: number): void {
    if (this.state === FIGHTER_STATES.Attacking || this.state === FIGHTER_STATES.CrouchAttack) return;
    const shouldFaceRight = opponentX > this.sprite.x;
    this.facing = shouldFaceRight ? 1 : -1;
    this.sprite.setScale(this.facing, 1);
  }

  private applyVelocity(delta: number): void {
    const dt = delta / 1000;
    this.sprite.x += this.velocityX * dt;
    this.sprite.y += this.velocityY * dt;

    if (this.state !== FIGHTER_STATES.Idle && this.state !== FIGHTER_STATES.Walking && this.state !== FIGHTER_STATES.Crouching) {
      this.velocityX *= 0.9;
    }

    if (this.sprite.y >= GROUND_Y) {
      this.sprite.y = GROUND_Y;
      this.velocityY = 0;
      if (!this.isGrounded) {
        this.isGrounded = true;
        if (this.state === FIGHTER_STATES.Jumping) {
          this.changeState(FIGHTER_STATES.Idle);
        }
      }
    } else {
      this.isGrounded = false;
    }
  }

  private clampPosition(): void {
    this.sprite.x = Phaser.Math.Clamp(this.sprite.x, LEFT_BOUND + 24, RIGHT_BOUND - 24);
    if (this.sprite.y < PLAY_AREA.y) {
      this.sprite.y = PLAY_AREA.y;
      this.velocityY = 0;
    }
  }

  private updateSprite(): void {
    const colors: Record<string, number> = {
      [FIGHTER_STATES.Idle]: this.stats.color,
      [FIGHTER_STATES.Walking]: this.stats.color,
      [FIGHTER_STATES.Jumping]: this.stats.color,
      [FIGHTER_STATES.Crouching]: this.stats.color,
      [FIGHTER_STATES.Attacking]: 0xffcc00,
      [FIGHTER_STATES.CrouchAttack]: 0xffcc00,
      [FIGHTER_STATES.Blocking]: 0x888888,
      [FIGHTER_STATES.Hitstun]: 0xff4444,
      [FIGHTER_STATES.KO]: 0x444444,
      [FIGHTER_STATES.Dashing]: this.stats.color,
    };
    this.sprite.setFillStyle(colors[this.state] || this.stats.color);
  }

  reset(x: number): void {
    this.hp = this.maxHp;
    this.sp = this.maxSp;
    this.velocityX = 0;
    this.velocityY = 0;
    this.isGrounded = true;
    this.comboCount = 0;
    this.hitstunFrames = 0;
    this.guardBreakTimer = 0;
    this.cooldownTimer = 0;
    this.sprite.x = x;
    this.sprite.y = GROUND_Y;
    this.sprite.setSize(48, 88);
    this.changeState(FIGHTER_STATES.Idle);
  }

  getPosition(): Phaser.Math.Vector2 {
    return new Phaser.Math.Vector2(this.sprite.x, this.sprite.y);
  }

  getHp(): number { return this.hp; }
  getMaxHp(): number { return this.maxHp; }
  getHpPercent(): number { return this.hp / this.maxHp; }
  getStamina(): number { return this.sp; }
  getMaxStamina(): number { return this.maxSp; }
  getFacing(): number { return this.facing; }
  getComboCount(): number { return this.comboCount; }
  isInState(state: string): boolean { return this.state === state; }
  getState(): string { return this.state; }
  getPerfectBlockWindow(): number { return this.perfectBlockWindow; }
  getAttackMoveId(): string { return this.attackMoveId; }
  getAttackFrame(): number { return this.attackFrame; }

  setDamageMultiplier(m: number): void { this.damageMultiplier = m; }
  setSpeedMultiplier(m: number): void { this.speedMultiplier = m; }
  setSpRegenRate(r: number): void { this.spRegenRate = r; }

  destroy(): void {
    this.sprite.destroy();
  }
}
