import Phaser from 'phaser';
import type { ElementDef, StatusKind } from '../../core/types';
import type { MonsterDef } from '../../data/monsters';
import { isWalkablePx, type WorldMap } from '../world/map';

export interface StatusState {
  stunUntil: number;
  slowUntil: number;
  slowMult: number;
  dots: { until: number; next: number; dmg: number; color: number; kind: StatusKind }[];
  vx: number;
  vy: number;
}

export class Monster {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  x: number;
  y: number;
  hp: number;
  alive = true;
  provoked = false;
  respawnAt = 0;
  facing = 1;
  nextAttack = 0;
  nextWander = 0;
  wanderTo: { x: number; y: number } | null = null;
  returning = false;
  lastHitAt = 0;
  status: StatusState = { stunUntil: 0, slowUntil: 0, slowMult: 1, dots: [], vx: 0, vy: 0 };
  /** Boss-only telegraphed attack. */
  slam: { x: number; y: number; at: number; gfx: Phaser.GameObjects.Graphics } | null = null;
  nextSlam = 0;
  private bob = Math.random() * Math.PI * 2;

  constructor(
    readonly scene: Phaser.Scene,
    readonly def: MonsterDef,
    readonly spawn: { x: number; y: number; r: number },
    readonly element: ElementDef | undefined,
  ) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.hp = def.hp;
    this.shadow = scene.add.image(this.x, this.y, 'shadow').setScale(def.boss ? 2.6 : 1);
    this.sprite = scene.add.image(this.x, this.y, `mon_${def.id}`).setOrigin(0.5, 0.9);
    this.bar = scene.add.graphics();
    const color = element ? `#${element.color.toString(16).padStart(6, '0')}` : '#ffffff';
    this.label = scene.add
      .text(this.x, this.y, `${def.name} Lv${def.level}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: def.boss ? '13px' : '10px',
        color,
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    this.label.setVisible(!!def.boss);
    this.sync(0);
  }

  get radius() {
    return this.def.radius;
  }

  get maxHp() {
    return this.def.hp;
  }

  get stunned() {
    return this.scene.time.now < this.status.stunUntil;
  }

  speedMult(now: number) {
    return now < this.status.slowUntil ? this.status.slowMult : 1;
  }

  /** Moves toward (tx, ty) with axis-sliding collision. */
  stepToward(map: WorldMap, tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const step = Math.min(d, speed * dt);
    const nx = this.x + (dx / d) * step;
    const ny = this.y + (dy / d) * step;
    this.moveTo(map, nx, ny);
    if (Math.abs(dx) > 1) this.facing = dx > 0 ? 1 : -1;
    return false;
  }

  moveTo(map: WorldMap, nx: number, ny: number): void {
    if (isWalkablePx(map, nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else if (isWalkablePx(map, nx, this.y)) this.x = nx;
    else if (isWalkablePx(map, this.x, ny)) this.y = ny;
  }

  sync(dt: number): void {
    this.bob += dt * (this.stunned ? 0 : 6);
    const squash = 1 + Math.sin(this.bob) * 0.05;
    const scale = this.def.boss ? 1.25 : 1;
    this.sprite.setPosition(this.x, this.y);
    this.sprite.setScale(scale * this.facing * (1 / squash), scale * squash);
    this.shadow.setPosition(this.x, this.y + 1);
    const depth = this.y;
    this.sprite.setDepth(depth);
    this.shadow.setDepth(depth - 1000);
    const top = this.y - this.sprite.displayHeight * 0.9 - 4;
    this.label.setPosition(this.x, top - 6).setDepth(100000);
    this.bar.clear();
    if (this.hp < this.maxHp || this.def.boss) {
      const w = this.def.boss ? 64 : 28;
      this.bar.fillStyle(0x000000, 0.6).fillRect(this.x - w / 2 - 1, top - 1, w + 2, 5);
      this.bar.fillStyle(this.def.boss ? 0xff4d6d : 0xe84d4d, 1).fillRect(this.x - w / 2, top, (w * this.hp) / this.maxHp, 3);
      this.bar.setDepth(100000);
    }
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
    this.shadow.setVisible(v);
    this.bar.setVisible(v);
    this.label.setVisible(v && !!this.def.boss);
  }

  flash(color = 0xff6666): void {
    this.sprite.setTintFill(color);
    this.scene.time.delayedCall(70, () => this.sprite.clearTint());
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.bar.destroy();
    this.label.destroy();
    this.slam?.gfx.destroy();
  }
}
