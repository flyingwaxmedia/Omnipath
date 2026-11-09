import Phaser from 'phaser';
import type { ElementDef, MonsterDef, StatusKind } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { CompiledMap } from '../../core/world/types';

export interface Dot {
  until: number;
  next: number;
  dmg: number;
  color: number;
  kind: StatusKind;
}

export interface StatusState {
  stunUntil: number;
  slowUntil: number;
  slowMult: number;
  dots: Dot[];
  vx: number;
  vy: number;
  /** Status markers (combos, vsStatus passives): kind -> until (scene time). */
  marks: Partial<Record<StatusKind, number>>;
}

export const freshStatus = (): StatusState => ({
  stunUntil: 0,
  slowUntil: 0,
  slowMult: 1,
  dots: [],
  vx: 0,
  vy: 0,
  marks: {},
});

let nextUid = 1;

export class Monster {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly bar: Phaser.GameObjects.Graphics;
  readonly label: Phaser.GameObjects.Text;
  /** Elites: soft coloured ring under the body. */
  readonly aura: Phaser.GameObjects.Graphics | null;
  /** Instance id (new on every respawn): per-instance mastery caps and echo witness marks. */
  uid = nextUid++;
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
  status: StatusState = freshStatus();
  /** Hit-XP grants per skill id earned on this instance (SkillBook.recordHit instanceHits). */
  hitGrants = new Map<string, number>();
  /** Echo technique ids witnessed on this instance (credited on kill). */
  witnessed = new Set<string>();
  /** Technique skill id -> ready time (scene time). */
  techReadyAt = new Map<string, number>();
  nextTechRoll = 0;
  /** While > now the monster is performing a technique (no moving / auto-attacks). */
  busyUntil = 0;
  private bob = Math.random() * Math.PI * 2;
  private flashUntil = 0;
  readonly baseScale: number;

  constructor(
    readonly scene: Phaser.Scene,
    readonly def: MonsterDef,
    readonly spawn: { x: number; y: number; r: number },
    readonly element: ElementDef | undefined,
    /** Spawn slot id (elite respawn timers survive map changes). */
    readonly slot: string,
  ) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.hp = def.hp;
    this.baseScale = def.scale ?? 1;
    let tex = def.texture ?? `mon_${def.id}`;
    if (!scene.textures.exists(tex)) tex = def.base && scene.textures.exists(`mon_${def.base}`) ? `mon_${def.base}` : 'mon_jellop';
    const big = def.rank === 'warden' ? 2.6 : def.rank === 'elite' ? 1.6 : 1;
    this.shadow = scene.add.image(this.x, this.y, 'shadow').setScale(big * this.baseScale * 0.8 + 0.2);
    this.aura =
      def.rank === 'elite'
        ? scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD)
        : null;
    this.sprite = scene.add.image(this.x, this.y, tex).setOrigin(0.5, 0.9);
    this.bar = scene.add.graphics();
    const color = element ? `#${element.color.toString(16).padStart(6, '0')}` : '#ffffff';
    const warden = def.rank === 'warden';
    this.label = scene.add
      .text(this.x, this.y, `${def.name} Lv${def.level}`, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: warden ? '13px' : '10px',
        fontStyle: warden || def.rank === 'elite' ? 'bold' : 'normal',
        color,
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1)
      .setResolution(2);
    this.label.setVisible(warden);
    this.restoreTint();
    this.sync(0);
  }

  get radius(): number {
    return this.def.radius;
  }

  get maxHp(): number {
    return this.def.hp;
  }

  get warden(): boolean {
    return this.def.rank === 'warden';
  }

  get elite(): boolean {
    return this.def.rank === 'elite';
  }

  get stunned(): boolean {
    return this.scene.time.now < this.status.stunUntil;
  }

  speedMult(now: number): number {
    return now < this.status.slowUntil ? this.status.slowMult : 1;
  }

  /** Active status kinds (read BEFORE a combo consumes them). */
  statuses(now: number): StatusKind[] {
    const out: StatusKind[] = [];
    for (const [k, until] of Object.entries(this.status.marks) as [StatusKind, number][]) if (until > now) out.push(k);
    return out;
  }

  /** Moves toward (tx, ty) with axis-sliding collision. True when arrived. */
  stepToward(map: CompiledMap, tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const step = Math.min(d, speed * dt);
    this.moveTo(map, this.x + (dx / d) * step, this.y + (dy / d) * step);
    if (Math.abs(dx) > 1) this.facing = dx > 0 ? 1 : -1;
    return false;
  }

  moveTo(map: CompiledMap, nx: number, ny: number): void {
    if (!isBlockedPx(map, nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else if (!isBlockedPx(map, nx, this.y)) this.x = nx;
    else if (!isBlockedPx(map, this.x, ny)) this.y = ny;
  }

  restoreTint(): void {
    const now = this.scene.time.now;
    if (now < this.flashUntil) return;
    if (this.stunned) this.sprite.setTint(0xdddddd);
    else if (now < this.status.slowUntil) this.sprite.setTint(0x9fd8ff);
    else if (this.def.tint !== undefined) this.sprite.setTint(this.def.tint);
    else this.sprite.clearTint();
  }

  sync(dt: number): void {
    this.bob += dt * (this.stunned ? 0 : 6);
    const squash = 1 + Math.sin(this.bob) * 0.05;
    const scale = this.baseScale;
    this.sprite.setPosition(this.x, this.y);
    this.sprite.setScale(scale * this.facing * (1 / squash), scale * squash);
    this.shadow.setPosition(this.x, this.y + 1);
    const depth = this.y;
    this.sprite.setDepth(depth);
    this.shadow.setDepth(depth - 1000);
    if (this.aura) {
      const t = this.scene.time.now / 400 + this.uid;
      const col = this.element?.color ?? 0xffd76a;
      const rx = this.radius * 1.5;
      this.aura.clear();
      this.aura.fillStyle(col, 0.14 + Math.sin(t) * 0.05).fillEllipse(this.x, this.y, rx * 2, rx * 0.8);
      this.aura.lineStyle(2, col, 0.45 + Math.sin(t) * 0.15).strokeEllipse(this.x, this.y, rx * 2, rx * 0.8);
      this.aura.setDepth(depth - 999);
    }
    const top = this.y - this.sprite.displayHeight * 0.9 - 4;
    this.label.setPosition(this.x, top - 6).setDepth(100000);
    this.bar.clear();
    if (this.hp < this.maxHp || this.warden) {
      const w = this.warden ? 64 : this.elite ? 40 : 28;
      this.bar.fillStyle(0x000000, 0.6).fillRect(this.x - w / 2 - 1, top - 1, w + 2, 5);
      this.bar.fillStyle(this.warden ? 0xff4d6d : 0xe84d4d, 1).fillRect(this.x - w / 2, top, (w * this.hp) / this.maxHp, 3);
      this.bar.setDepth(100000);
    }
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
    this.shadow.setVisible(v);
    this.bar.setVisible(v);
    this.aura?.setVisible(v);
    this.label.setVisible(v && this.warden);
  }

  flash(color = 0xff6666): void {
    this.sprite.setTintFill(color);
    this.flashUntil = this.scene.time.now + 70;
    this.scene.time.delayedCall(70, () => {
      if (!this.sprite.active) return;
      this.sprite.clearTint();
      this.restoreTint();
    });
  }

  /** Fresh instance state for a respawn (new uid: per-instance caps and witness marks reset). */
  reset(): void {
    this.uid = nextUid++;
    this.alive = true;
    this.hp = this.maxHp;
    this.provoked = false;
    this.returning = false;
    this.status = freshStatus();
    this.hitGrants.clear();
    this.witnessed.clear();
    this.techReadyAt.clear();
    this.busyUntil = 0;
    this.x = this.spawn.x;
    this.y = this.spawn.y;
  }

  destroy(): void {
    this.sprite.destroy();
    this.shadow.destroy();
    this.bar.destroy();
    this.label.destroy();
    this.aura?.destroy();
  }
}
