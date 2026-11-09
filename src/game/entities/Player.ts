// The player's body in the world (actors lane): an animated sprite that plays idle / walk / attack from its look
// (the weapon look `player_<w>` or the worn class's outfit `player_<w>__<classId>`, art/classLooks.ts), its shadow,
// name tag (bitmap pixel font), buff rings, wind-up bar, status icons and — at Tier III — aura motes.
// Game systems drive it through the members below (position, path, timers, statuses, attackAnim, setCast, sync…).
import Phaser from 'phaser';
import type { StatusKind, WeaponType } from '../../core/types';
import { auraColor } from '../art/classLooks';
import { DEPTH, ySort } from '../render/depths';
import { type WorldLabel, worldLabel } from '../render/text';
import { PLAYER_STATUS_ICONS, statusIconKey } from './actorArt';
import { ensurePlayerLook, playerAnims } from './looks';
import { iconRow } from './rules';

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

/** How long the attack pose holds before the body returns to idle / walk (ms; the anim is 2 frames at 12 fps). */
const ATK_MS = 190;
/** Status icons: size and gap (art px). */
const ICON = 9;
const ICON_GAP = 1;

interface Mote {
  x: number;
  y: number;
  vy: number;
  born: number;
  life: number;
  size: number;
}

export class Player {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  /** Name tag under the feet (bitmap pixel font). */
  readonly nameText: WorldLabel;
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
  /** Status markers for the head icons: kind -> until. */
  marks: Partial<Record<StatusKind, number>> = {};
  /** Knockback / pull velocity (px/s), decays quickly. */
  pushVx = 0;
  pushVy = 0;
  /** The weapon whose look is shown. */
  weapon: WeaponType;
  /** The worn class whose outfit is shown (null = no class: the weapon look). */
  classId: string | null = null;
  /** Base texture key of the current look (`player_<w>` or `player_<w>__<classId>`). */
  lookKey = '';
  private anims: { idle: string | null; walk: string | null; atk: string | null } = { idle: null, walk: null, atk: null };
  private lunge = 0;
  private hurtUntil = 0;
  private atkUntil = 0;
  private castColor = 0x9fe0ff;
  private castProgress: number | null = null;
  private icons: Phaser.GameObjects.Image[] = [];
  private iconKey = '';
  /** Tier III aura motes (rising pixels in the class's aura colour). */
  private readonly motes: Phaser.GameObjects.Graphics;
  private moteList: Mote[] = [];
  private moteAt = 0;
  private moteColor: number | null = null;

  constructor(
    readonly scene: Phaser.Scene,
    public x: number,
    public y: number,
    name: string,
    weapon: WeaponType,
  ) {
    this.weapon = weapon;
    this.shadow = scene.add.image(x, y, 'shadow').setDepth(DEPTH.SHADOW);
    this.aura = scene.add.graphics().setDepth(DEPTH.AURA);
    this.sprite = scene.add.sprite(x, y, `player_${weapon}`).setOrigin(0.5, 0.95);
    this.motes = scene.add.graphics();
    this.castBar = scene.add.graphics().setDepth(DEPTH.CAST_BAR);
    this.nameText = worldLabel(scene, x, y + 4, name, { color: '#ffffff', originY: 0 });
    this.applyLook();
  }

  /** Shows the look for a weapon (MapScene.equipWeapon) — the worn class's outfit stays on. */
  setWeapon(w: WeaponType): void {
    if (w === this.weapon && this.lookKey) return;
    this.weapon = w;
    this.applyLook();
  }

  /** Shows the outfit of a worn class (null = no class). Called on load and on every class change. */
  setLook(classId: string | null): void {
    if (classId === this.classId && this.lookKey) return;
    this.classId = classId;
    this.applyLook();
  }

  private applyLook(): void {
    const base = ensurePlayerLook(this.scene, this.weapon, this.classId);
    this.lookKey = base;
    this.anims = playerAnims(this.scene, base);
    this.moteColor = auraColor(this.classId);
    if (this.moteColor === null) {
      this.moteList = [];
      this.motes.clear();
    }
    const now = this.scene.time.now;
    const key = now < this.atkUntil ? this.anims.atk : this.moving ? this.anims.walk : this.anims.idle;
    if (key) this.sprite.play(key, false);
    else this.sprite.setTexture(base);
  }

  face(tx: number, ty: number): void {
    this.aimAngle = Math.atan2(ty - this.y, tx - this.x);
    if (Math.abs(tx - this.x) > 2) this.facing = tx > this.x ? 1 : -1;
  }

  /** Plays the attack pose (every cast: Combat.fire, castFire). Restarting it mid-swing is fine. */
  attackAnim(): void {
    const now = this.scene.time.now;
    this.lunge = 1;
    if (now < this.atkUntil - ATK_MS + 40) return; // the same cast reported twice (attackAnim + castFire)
    this.atkUntil = now + ATK_MS;
    if (this.anims.atk) this.sprite.play(this.anims.atk, false);
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
    const x = Math.round(this.x - w / 2);
    const y = Math.round(this.y - 58);
    // Pixel bar: dark frame, fill, a white flash as it completes.
    g.fillStyle(0x24180f, 0.85).fillRect(x - 2, y - 2, w + 4, 7);
    g.fillStyle(0x000000, 0.45).fillRect(x, y, w, 3);
    g.fillStyle(this.castColor, 1).fillRect(x, y, Math.max(2, Math.round(w * p)), 3);
    if (p > 0.85) g.fillStyle(0xffffff, (p - 0.85) * 5).fillRect(x, y, w, 3);
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
    this.atkUntil += ms;
    this.moteAt += ms;
    for (const m of this.moteList) m.born += ms;
    for (const d of this.dots) {
      d.until += ms;
      d.next += ms;
    }
    for (const k of Object.keys(this.marks) as StatusKind[]) this.marks[k]! += ms;
  }

  sync(dt: number, auraColors: number[]): void {
    const now = this.scene.time.now;
    this.lunge = Math.max(0, this.lunge - dt * 6);
    const lx = Math.cos(this.aimAngle) * this.lunge * 3;
    const ly = Math.sin(this.aimAngle) * this.lunge * 3;
    const stunned = now < this.stunUntil;
    const shake = stunned && now >= this.frozenUntil ? Math.sin(now / 25) * 1.2 : 0;
    const s = this.sprite;
    s.setPosition(this.x + lx + shake, this.y + ly);
    s.setFlipX(this.facing < 0);
    s.setDepth(ySort(this.y));
    this.syncAnim(now, stunned);
    if (now < this.hurtUntil) s.setTintFill(0xff4444);
    else if (now < this.frozenUntil) s.setTint(0xaee9ff);
    else if ((this.marks.poison ?? 0) > now) s.setTint(0xd0f0b8);
    else s.clearTint();
    this.shadow.setPosition(this.x, this.y + 1);
    this.nameText.setPosition(Math.round(this.x), Math.round(this.y + 4));
    this.aura.clear();
    auraColors.forEach((col, i) => {
      const t = now / 300 + i;
      this.aura.lineStyle(2, col, 0.55 + Math.sin(t) * 0.25);
      this.aura.strokeEllipse(this.x, this.y, 30 + i * 6, 12 + i * 3);
    });
    if (this.moteColor !== null) {
      // Tier III: a faint ring at the feet in the aura colour, breathing slowly — on the ground layer, under the boots
      const k = 0.5 + 0.5 * Math.sin(now / 520);
      this.aura.lineStyle(1, this.moteColor, 0.25 + 0.25 * k).strokeEllipse(Math.round(this.x), Math.round(this.y), 26 + 2 * k, 10 + k);
    }
    if (stunned && now >= this.frozenUntil) {
      for (let i = 0; i < 3; i++) {
        const a = now / 160 + (i * Math.PI * 2) / 3;
        this.aura.fillStyle(0xfff3a0, 1).fillRect(Math.round(this.x + Math.cos(a) * 12) - 1, Math.round(this.y - 50 + Math.sin(a) * 4) - 1, 3, 3);
      }
    }
    if (this.castProgress !== null) this.drawCast();
    this.syncMotes(now);
    this.syncStatusIcons(now);
  }

  /** idle / walk / attack; frozen in place while stunned; still while knocked down (death pose). */
  private syncAnim(now: number, stunned: boolean): void {
    const s = this.sprite;
    if (s.angle !== 0) {
      // Combat lays the body down on death: hold the current frame.
      if (s.anims.isPlaying) s.anims.pause();
      return;
    }
    if (stunned) {
      if (s.anims.isPlaying) s.anims.pause();
      return;
    }
    if (s.anims.isPaused) s.anims.resume();
    if (now < this.atkUntil && this.anims.atk) return;
    const want = this.moving && this.anims.walk ? this.anims.walk : this.anims.idle;
    if (!want) return;
    if (s.anims.currentAnim?.key !== want || !s.anims.isPlaying) s.play(want, true);
    s.anims.timeScale = this.moving ? Math.max(0.5, this.speedMult(now)) : 1;
  }

  /** Tier III aura: a few pixels in the class's colour rising around the body (the feet ring is drawn in `aura`). */
  private syncMotes(now: number): void {
    const col = this.moteColor;
    const g = this.motes;
    if (col === null) return;
    g.clear();
    if (now >= this.moteAt && this.sprite.angle === 0) {
      this.moteAt = now + 80 + ((now * 7) % 50);
      const k = this.moteList.length;
      const side = k % 2 ? 1 : -1;
      this.moteList.push({
        x: this.x + side * (5 + ((now / 7) % 9)),
        y: this.y - 4 - ((now / 3) % 30),
        vy: 14 + ((now / 11) % 10),
        born: now,
        life: 900 + ((now / 5) % 400),
        size: (now / 13) % 3 < 2 ? 2 : 1,
      });
    }
    this.moteList = this.moteList.filter((m) => now - m.born < m.life);
    for (const m of this.moteList) {
      const t = (now - m.born) / m.life;
      const a = t < 0.2 ? t / 0.2 : 1 - (t - 0.2) / 0.8;
      g.fillStyle(col, Math.max(0, a));
      g.fillRect(Math.round(m.x), Math.round(m.y - (m.vy * (now - m.born)) / 1000), m.size, m.size);
      if (m.size === 2 && a > 0.6) g.fillStyle(0xffffff, a * 0.7).fillRect(Math.round(m.x), Math.round(m.y - (m.vy * (now - m.born)) / 1000), 1, 1);
    }
    g.setDepth(ySort(this.y, 1));
  }

  /** Pixel icons over the head for the statuses on the player (never colour alone; no emoji in-world). */
  private syncStatusIcons(now: number): void {
    const kinds = PLAYER_STATUS_ICONS.filter((k) => (this.marks[k] ?? 0) > now);
    const key = kinds.join(',');
    if (key !== this.iconKey) {
      this.iconKey = key;
      kinds.forEach((k, i) => {
        const tex = statusIconKey(this.scene, k);
        let img = this.icons[i];
        if (!img) {
          img = this.scene.add.image(0, 0, tex ?? '__DEFAULT').setOrigin(0, 1).setDepth(DEPTH.STATUS_ICON);
          this.icons[i] = img;
        }
        if (tex) img.setTexture(tex);
        img.setVisible(!!tex);
      });
      for (let i = kinds.length; i < this.icons.length; i++) this.icons[i].setVisible(false);
    }
    if (!kinds.length) return;
    const y = Math.round(this.y - (this.castProgress !== null ? 62 : 50));
    iconRow(this.x, kinds.length, ICON, ICON_GAP).forEach((x, i) => this.icons[i].setPosition(x, y));
  }

  hurt(): void {
    this.hurtUntil = this.scene.time.now + 90;
  }
}
