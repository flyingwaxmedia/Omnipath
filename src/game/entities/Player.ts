// The player's body in the world (actors lane): an animated sprite that plays idle / walk / attack from its look
// (the weapon look `player_<w>` or the worn class's outfit `player_<w>__<classId>`, art/classLooks.ts), its shadow,
// name tag (bitmap pixel font), wind-up bar and status icons.
// Game systems drive it through the members below (position, path, timers, statuses, attackAnim, setCast, sync…).
// Buff auras, the Tier III class aura, status overlays (stun stars, frost, poison…) and the hurt flash's colours are
// the VFX runtime's; the body takes the hit feel through hold / impactFlash / squash / recoil (vfx/juice.ts).
// Pixel rule (docs/QUALITY-PLAN.md §1): the sprite sits on whole pixels and is never scaled but for the 1-frame squash
// (the stunned shake steps by whole pixels). Floating text over the player goes in its lanes (render/text.ts).
import Phaser from 'phaser';
import type { StatusKind, WeaponType } from '../../core/types';
import { DEPTH, ySort } from '../render/depths';
import { type TextAnchor, type WorldLabel, trackTextAnchor, worldLabel } from '../render/text';
import { PLAYER_STATUS_ICONS, opaqueTop, statusIconKey } from './actorArt';
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
/** Stunned shake: whole-pixel x offsets stepped every SHAKE_MS (no sub-pixel wobble). */
const SHAKE = [0, 1, 0, -1] as const;
const SHAKE_MS = 60;

export class Player implements TextAnchor {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  /** Name tag under the feet (bitmap pixel font). */
  readonly nameText: WorldLabel;
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
  private atkUntil = 0;
  /** Juice: tint-fill frames to show, a flash on screen, squash frames, recoil offsets, the hold. */
  private flashQ: number[] = [];
  private flashing = false;
  private squashF = 0;
  private recoilQ: { x: number; y: number }[] = [];
  private holdUntil = 0;
  private held: { x: number; y: number } | null = null;
  /** After a hold the sprite catches up with the body over a few frames. */
  private lag = { x: 0, y: 0 };
  private castColor = 0x9fe0ff;
  private castProgress: number | null = null;
  private icons: Phaser.GameObjects.Image[] = [];
  private iconKey = '';
  readonly textRole = 'player' as const;

  constructor(
    readonly scene: Phaser.Scene,
    public x: number,
    public y: number,
    name: string,
    weapon: WeaponType,
  ) {
    this.weapon = weapon;
    this.shadow = scene.add.image(x, y, 'shadow').setDepth(DEPTH.SHADOW);
    this.sprite = scene.add.sprite(x, y, `player_${weapon}`).setOrigin(0.5, 0.95);
    this.castBar = scene.add.graphics().setDepth(DEPTH.CAST_BAR);
    this.nameText = worldLabel(scene, x, y + 4, name, { color: '#ffffff', originY: 0 });
    this.applyLook();
    trackTextAnchor(scene, this);
  }

  // ---------------------------------------------------------------- TextAnchor (floating text lanes)

  /** Above the head (hat included), the status icons and the wind-up bar, whichever is highest. */
  textTop(): number {
    const y = Math.round(this.y);
    const s = this.sprite;
    let top = y - Math.round(s.displayHeight * 0.95) + opaqueTop(this.scene, this.lookKey || s.texture.key) - 1;
    if (this.iconKey) top = Math.min(top, Math.round(this.y - (this.castProgress !== null ? 62 : 50)) - ICON - 1);
    if (this.castProgress !== null) top = Math.min(top, Math.round(this.y - 58) - 3);
    return top;
  }

  /** Under the name tag. */
  textBottom(): number {
    return Math.round(this.y) + 5 + this.nameText.height;
  }

  textHalfW(): number {
    return 12;
  }

  textLive(): boolean {
    return this.sprite.active && this.sprite.visible;
  }

  textBody(): { x0: number; y0: number; x1: number; y1: number } {
    const x = Math.round(this.x);
    const y = Math.round(this.y);
    return { x0: x - 9, y0: y - Math.round(this.sprite.displayHeight * 0.95) + opaqueTop(this.scene, this.lookKey || this.sprite.texture.key), x1: x + 9, y1: y };
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
    this.atkUntil += ms;
    this.holdUntil += ms;
    for (const d of this.dots) {
      d.until += ms;
      d.next += ms;
    }
    for (const k of Object.keys(this.marks) as StatusKind[]) this.marks[k]! += ms;
  }

  /** Per frame. (`_auraColors`: the buff colours MapScene still passes; the VFX aura loops draw buffs now.) */
  sync(dt: number, _auraColors?: number[]): void {
    const now = this.scene.time.now;
    const held = now < this.holdUntil && this.held !== null;
    if (!held && this.held) {
      this.lag = { x: this.held.x - this.x, y: this.held.y - this.y };
      this.held = null;
    }
    if (!held) this.lunge = Math.max(0, this.lunge - dt * 6);
    if (!held && (this.lag.x || this.lag.y)) {
      this.lag.x = Math.abs(this.lag.x) < 1 ? 0 : this.lag.x * 0.45;
      this.lag.y = Math.abs(this.lag.y) < 1 ? 0 : this.lag.y * 0.45;
    }
    const lx = Math.cos(this.aimAngle) * this.lunge * 3;
    const ly = Math.sin(this.aimAngle) * this.lunge * 3;
    const stunned = now < this.stunUntil;
    const shake = stunned && now >= this.frozenUntil ? SHAKE[Math.floor(now / SHAKE_MS) % SHAKE.length] : 0;
    const s = this.sprite;
    const rc = this.recoilQ[0];
    if (rc && !held) this.recoilQ.shift();
    const bx = held ? this.held!.x : this.x + this.lag.x;
    const by = held ? this.held!.y : this.y + this.lag.y;
    s.setPosition(Math.round(bx + lx) + shake + (rc?.x ?? 0), Math.round(by + ly) + (rc?.y ?? 0));
    s.setFlipX(this.facing < 0);
    s.setDepth(ySort(this.y));
    if (this.squashF > 0) {
      // 1-frame squash (the one scale the pixel rule allows): 2 px wider, 2 px shorter.
      this.squashF--;
      s.setScale((s.width + 2) / Math.max(8, s.width), (s.height - 2) / Math.max(8, s.height));
    } else if (s.scaleX !== 1 || s.scaleY !== 1) s.setScale(1, 1);
    if (held) {
      if (s.anims.isPlaying) s.anims.pause();
    } else this.syncAnim(now, stunned);
    // Impact flash frames (white -> colour), one per rendered frame; frost / poison read from the VFX overlays.
    if (this.flashQ.length) {
      s.setTintFill(this.flashQ.shift()!);
      this.flashing = true;
    } else if (this.flashing || s.isTinted) {
      this.flashing = false;
      s.clearTint();
    }
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) + 1);
    this.nameText.setPosition(Math.round(this.x), Math.round(this.y + 4));
    if (this.castProgress !== null) this.drawCast();
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

  /** Hurt: a 2-frame red flash (the VFX juice rig replaces it with white -> red on technique and claw hits). */
  hurt(): void {
    this.impactFlash([0xff4444, 0xff4444]);
  }

  // ---------------------------------------------------------------- juice (vfx/juice.ts JuiceActor)

  /** Hit-stop on the player's body: the sprite and its frame hold (movement and timers keep running). */
  hold(ms: number): void {
    const now = this.scene.time.now;
    if (now >= this.holdUntil || !this.held) this.held = { x: this.x, y: this.y };
    this.holdUntil = Math.max(this.holdUntil, now + ms);
  }

  impactFlash(frames: readonly number[]): void {
    this.flashQ = [...frames];
  }

  squash(): void {
    this.squashF = 1;
  }

  recoil(ang: number, px: number): void {
    const at = (k: number) => ({ x: Math.round(Math.cos(ang) * k), y: Math.round(Math.sin(ang) * k * 0.5) });
    this.recoilQ = [at(px), at(Math.round(px / 2)), at(0)];
  }
}
