import Phaser from 'phaser';
import type { StatusKind, WeaponType } from '../../core/types';
import { DEPTH, ySort } from '../render/depths';

/** A damage-over-time effect a monster technique left on the player. */
export interface PlayerDot {
  kind: StatusKind;
  until: number;
  next: number;
  every: number;
  dmg: number;
  color: number;
  from: string;
}

/** Status glyphs shown above the player's head (never colour alone). */
const STATUS_GLYPH: Partial<Record<StatusKind, string>> = {
  burn: '🔥',
  poison: '☠️',
  bleed: '🩸',
  soak: '💧',
  slow: '🐌',
  freeze: '❄️',
  stun: '💫',
  shock: '⚡',
};

export class Player {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly nameText: Phaser.GameObjects.Text;
  readonly aura: Phaser.GameObjects.Graphics;
  /** Wind-up bar drawn above the head while a castMs skill charges. */
  readonly castBar: Phaser.GameObjects.Graphics;
  path: { x: number; y: number }[] = [];
  facing = 1;
  aimAngle = 0;
  moving = false;
  /** While > now, input movement is locked (dashes, stuns, roots). */
  lockedUntil = 0;
  /** Monster slows on the player (soak, chill). */
  slowUntil = 0;
  slowMult = 1;
  /** Stunned or frozen: no moving, no casting. */
  stunUntil = 0;
  /** Frozen solid (ice tint) — a stun variant. */
  frozenUntil = 0;
  /** Crowd-control immunity after a stun/freeze ends (no stun-lock from several monsters). */
  ccImmuneUntil = 0;
  dots: PlayerDot[] = [];
  /** Status markers for the head glyphs: kind -> until. */
  marks: Partial<Record<StatusKind, number>> = {};
  /** Knockback / pull velocity (px/s), decays quickly. */
  pushVx = 0;
  pushVy = 0;
  private walkT = 0;
  private lunge = 0;
  private hurtUntil = 0;
  private statusText: Phaser.GameObjects.Text | null = null;
  private statusKey = '';
  private castColor = 0x9fe0ff;
  private castProgress: number | null = null;

  constructor(
    readonly scene: Phaser.Scene,
    public x: number,
    public y: number,
    name: string,
    weapon: WeaponType,
  ) {
    this.shadow = scene.add.image(x, y, 'shadow').setDepth(DEPTH.SHADOW);
    this.aura = scene.add.graphics().setDepth(DEPTH.AURA);
    this.sprite = scene.add.image(x, y, `player_${weapon}`).setOrigin(0.45, 0.95);
    this.castBar = scene.add.graphics().setDepth(DEPTH.CAST_BAR);
    this.nameText = scene.add
      .text(x, y, name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#1a2244',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setResolution(2)
      .setDepth(DEPTH.NAME_TAG);
  }

  setWeapon(w: WeaponType): void {
    this.sprite.setTexture(`player_${w}`);
  }

  face(tx: number, ty: number): void {
    this.aimAngle = Math.atan2(ty - this.y, tx - this.x);
    if (Math.abs(tx - this.x) > 2) this.facing = tx > this.x ? 1 : -1;
  }

  attackAnim(): void {
    this.lunge = 1;
  }

  speedMult(now: number): number {
    return now < this.slowUntil ? this.slowMult : 1;
  }

  stunned(now: number): boolean {
    return now < this.stunUntil;
  }

  /** Draws the wind-up bar (progress 0..1) or hides it (null). Redrawn every frame by sync. */
  setCast(progress: number | null, color = 0x9fe0ff): void {
    this.castProgress = progress;
    this.castColor = color;
    this.drawCast();
  }

  private drawCast(): void {
    const g = this.castBar;
    g.clear();
    const progress = this.castProgress;
    if (progress === null) return;
    const p = Math.min(1, Math.max(0, progress));
    const w = 38;
    const x = this.x - w / 2;
    const y = this.y - 60;
    g.fillStyle(0x000000, 0.65).fillRoundedRect(x - 2, y - 2, w + 4, 8, 4);
    g.fillStyle(this.castColor, 1).fillRoundedRect(x, y, Math.max(3, w * p), 4, 2);
    if (p > 0.85) g.fillStyle(0xffffff, (p - 0.85) * 5).fillRoundedRect(x, y, w, 4, 2);
    // Charging ring at the feet fills clockwise: readable even when the bar is under a finger.
    g.lineStyle(2, 0x000000, 0.35).strokeEllipse(this.x, this.y, 40, 16);
    g.lineStyle(3, this.castColor, 0.9);
    g.beginPath();
    const steps = Math.max(2, Math.ceil(24 * p));
    for (let i = 0; i <= steps; i++) {
      const a = -Math.PI / 2 + (i / steps) * Math.PI * 2 * p;
      const px = this.x + Math.cos(a) * 20;
      const py = this.y + Math.sin(a) * 8;
      if (i === 0) g.moveTo(px, py);
      else g.lineTo(px, py);
    }
    g.strokePath();
  }

  /** Clears every monster status (death, respawn). */
  clearStatuses(): void {
    this.dots = [];
    this.marks = {};
    this.stunUntil = this.frozenUntil = this.slowUntil = 0;
    this.pushVx = this.pushVy = 0;
    this.slowMult = 1;
  }

  /** Moves every scene-time timer forward by `ms` (the world was paused or hit-stopped). */
  shiftTime(ms: number): void {
    this.lockedUntil += ms;
    this.slowUntil += ms;
    this.stunUntil += ms;
    this.frozenUntil += ms;
    this.ccImmuneUntil += ms;
    this.hurtUntil += ms;
    for (const d of this.dots) {
      d.until += ms;
      d.next += ms;
    }
    for (const k of Object.keys(this.marks) as StatusKind[]) this.marks[k]! += ms;
  }

  sync(dt: number, auraColors: number[]): void {
    const now = this.scene.time.now;
    if (this.moving) this.walkT += dt * 12;
    else this.walkT = 0;
    this.lunge = Math.max(0, this.lunge - dt * 6);
    const bob = this.moving ? Math.abs(Math.sin(this.walkT)) * 3 : 0;
    const lx = Math.cos(this.aimAngle) * this.lunge * 5;
    const ly = Math.sin(this.aimAngle) * this.lunge * 5;
    const shake = now < this.stunUntil && now >= this.frozenUntil ? Math.sin(now / 25) * 1.2 : 0;
    this.sprite.setPosition(this.x + lx + shake, this.y - bob + ly);
    this.sprite.setFlipX(this.facing < 0);
    this.sprite.setDepth(ySort(this.y));
    if (now < this.hurtUntil) this.sprite.setTintFill(0xff4444);
    else if (now < this.frozenUntil) this.sprite.setTint(0xaee9ff);
    else if ((this.marks.poison ?? 0) > now) this.sprite.setTint(0xd0f0b8);
    else this.sprite.clearTint();
    this.shadow.setPosition(this.x, this.y + 1);
    this.nameText.setPosition(this.x, this.y + 4);
    this.aura.clear();
    auraColors.forEach((col, i) => {
      const t = now / 300 + i;
      this.aura.lineStyle(2, col, 0.55 + Math.sin(t) * 0.25);
      this.aura.strokeEllipse(this.x, this.y, 30 + i * 6, 12 + i * 3);
    });
    if (now < this.stunUntil && now >= this.frozenUntil) {
      for (let i = 0; i < 3; i++) {
        const a = now / 160 + (i * Math.PI * 2) / 3;
        this.aura.fillStyle(0xfff3a0, 1).fillCircle(this.x + Math.cos(a) * 12, this.y - 52 + Math.sin(a) * 4, 2.4);
      }
    }
    if (this.castProgress !== null) this.drawCast();
    this.syncStatusGlyphs(now);
  }

  private syncStatusGlyphs(now: number): void {
    let key = '';
    for (const [k, until] of Object.entries(this.marks) as [StatusKind, number][]) {
      if (until > now && STATUS_GLYPH[k]) key += STATUS_GLYPH[k];
    }
    if (key !== this.statusKey) {
      this.statusKey = key;
      if (key && !this.statusText) {
        this.statusText = this.scene.add
          .text(this.x, this.y, '', { fontFamily: 'system-ui, sans-serif', fontSize: '13px', stroke: '#000', strokeThickness: 3 })
          .setOrigin(0.5, 1)
          .setResolution(2)
          .setDepth(DEPTH.STATUS_ICON);
      }
      this.statusText?.setText(key).setVisible(!!key);
    }
    if (key) this.statusText!.setPosition(this.x, this.y - (this.castProgress !== null ? 66 : 54));
  }

  hurt(): void {
    this.hurtUntil = this.scene.time.now + 90;
  }
}
