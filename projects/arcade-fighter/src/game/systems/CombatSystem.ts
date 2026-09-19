import Phaser from "phaser";
import { EventBus } from "../utils/EventBus";
import { COMBAT, COLORS } from "../utils/Constants";
import { Fighter } from "../entities/Fighter";
import { getMoveData, MoveData } from "../data/moves";

export interface HitResult {
  hit: boolean;
  blocked: boolean;
  perfectBlock: boolean;
  counterHit: boolean;
  damage: number;
  moveId: string;
}

export class CombatSystem {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  checkHit(attacker: Fighter, defender: Fighter, moveId: string): HitResult {
    const move = getMoveData(moveId);
    const hitbox = this.getHitbox(attacker, move);
    const hurtbox = this.getHurtbox(defender);

    if (!this.rectanglesOverlap(hitbox, hurtbox)) {
      return { hit: false, blocked: false, perfectBlock: false, counterHit: false, damage: 0, moveId };
    }

    const isCounterHit = defender.isInState("attacking");
    const isBlocking = defender.isInState("blocking");
    const isPerfectBlock = isBlocking && defender.getPerfectBlockWindow() > 0;
    const isUnblockable = move.properties.includes("unblockable");

    if (isBlocking && !isUnblockable) {
      if (isPerfectBlock) {
        defender.applyPerfectBlock();
        EventBus.emit("perfectBlock", { target: defender.playerId });
        return { hit: true, blocked: true, perfectBlock: true, counterHit: false, damage: 0, moveId };
      }

      defender.drainStamina(COMBAT.blockDrainPerFrame * move.blockstun);
      if (defender.getStamina() <= 0) {
        defender.triggerGuardBreak();
        EventBus.emit("guardBreak", { target: defender.playerId });
      } else {
        EventBus.emit("block", { target: defender.playerId, attacker: attacker.playerId });
      }
      return { hit: true, blocked: true, perfectBlock: false, counterHit: false, damage: 0, moveId };
    }

    let damage = move.damage;
    if (isCounterHit) {
      damage = Math.floor(damage * COMBAT.counterHitBonus);
    }

    const comboCount = attacker.getComboCount();
    const scalingIdx = Math.min(comboCount, COMBAT.comboScaling.length - 1);
    damage = Math.floor(damage * COMBAT.comboScaling[scalingIdx]);

    defender.takeDamage(damage);
    defender.applyHitstun(move.hitstun, move.knockbackX, move.knockbackY, attacker.getFacing());
    attacker.incrementCombo();

    EventBus.emit("damage", {
      target: defender.playerId,
      attacker: attacker.playerId,
      damage,
      counterHit: isCounterHit,
      comboCount: attacker.getComboCount(),
      moveId,
    });

    if (defender.getHp() <= 0) {
      attacker.resetCombo();
      EventBus.emit("ko", { loser: defender.playerId, winner: attacker.playerId });
    }

    return { hit: true, blocked: false, perfectBlock: false, counterHit: isCounterHit, damage, moveId };
  }

  checkThrow(attacker: Fighter, defender: Fighter): boolean {
    if (!defender.isInState("blocking")) return false;
    if (!this.isInThrowRange(attacker, defender)) return false;

    const throwMove = getMoveData("throw");
    defender.takeDamage(throwMove.damage);
    defender.applyHitstun(throwMove.hitstun, throwMove.knockbackX, throwMove.knockbackY, attacker.getFacing());

    EventBus.emit("throw", { attacker: attacker.playerId, target: defender.playerId, damage: throwMove.damage });

    if (defender.getHp() <= 0) {
      EventBus.emit("ko", { loser: defender.playerId, winner: attacker.playerId });
    }

    return true;
  }

  private getHitbox(attacker: Fighter, move: MoveData): Phaser.Geom.Rectangle {
    const facing = attacker.getFacing();
    const pos = attacker.getPosition();
    const offsetX = facing === 1 ? move.hitboxOffsetX : -(move.hitboxOffsetX + move.hitboxWidth);
    return new Phaser.Geom.Rectangle(
      pos.x + offsetX,
      pos.y + move.hitboxOffsetY,
      move.hitboxWidth,
      move.hitboxHeight
    );
  }

  private getHurtbox(defender: Fighter): Phaser.Geom.Rectangle {
    const pos = defender.getPosition();
    const width = 48;
    const height = defender.isInState("crouching") ? 56 : defender.isInState("jumping") ? 80 : 88;
    return new Phaser.Geom.Rectangle(pos.x - width / 2, pos.y - height, width, height);
  }

  private rectanglesOverlap(a: Phaser.Geom.Rectangle, b: Phaser.Geom.Rectangle): boolean {
    return Phaser.Geom.Intersects.RectangleToRectangle(a, b);
  }

  private isInThrowRange(attacker: Fighter, defender: Fighter): boolean {
    const dist = Phaser.Math.Distance.Between(
      attacker.getPosition().x, attacker.getPosition().y,
      defender.getPosition().x, defender.getPosition().y
    );
    return dist < 60;
  }
}
