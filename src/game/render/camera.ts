// Camera rig (docs/QUALITY-PLAN.md §8, docs/VFX.md §6.6, §8.6 item 6): everything that moves the view for feel, on
// top of the stage's smooth follow (render/stage.ts adds `look` before its map clamp and `jolt` after it).
//
// - Trauma shake: offset = round(6 · τ² · noise(t · 25)) art px per axis, τ in [0, 1] decaying 2 / s. Whole pixels,
//   never rotation (Eiserloh, "Juicing Your Cameras With Math", GDC 2016: the technique, no code).
// - Directional kicks: a critically damped spring nudged along the blow (≤ 6 px), back home in ~150 ms.
// - Screen flash: a full-view rectangle stepped down over 3 frames (never tweened), alpha ≤ 0.35, ≥ 333 ms apart,
//   ≤ 3 per rolling second; none under "Reduce shake & flashes".
// - Look: the warden intro pan (ease to a point between the player and the warden, hold, ease back; the player stays
//   in view) and a gentle lead toward a warden / elite target in manual play.
// - Reduce shake & flashes: trauma and kicks × 0.3, no flashes, no pans.
// Legacy direct calls (cameras.main.shake / flash) are routed into the rig by install(), so every shake obeys the same
// rules (QUALITY-PLAN "Do not": no default cam.flash alpha 1, no rotation).
// Phaser is used through types only: the rig is unit-tested headlessly (tests/vfx-juice.test.ts).
import type Phaser from 'phaser';
import { DEPTH } from './depths';

export interface Pt {
  x: number;
  y: number;
}

/** Max shake (art px) at trauma 1, trauma decay per second, noise frequency (Hz). */
export const SHAKE_PX = 6;
export const TRAUMA_DECAY = 2;
export const SHAKE_HZ = 25;
/** Kick spring (rad/s) and the largest kick (art px). */
const KICK_W = 34;
const KICK_MAX = 6;
/** Flash governor (docs/VFX.md §9 flash). */
export const FLASH = { alphaMax: 0.35, minGapMs: 333, perSecond: 3, frameMs: 50 } as const;
/** Warden intro pan: ease in, hold, ease out (ms); weight of the way toward the warden; never more than this share
 *  of the view away from the player. */
const PAN = { inMs: 450, holdMs: 650, outMs: 450, weight: 0.55, maxView: 0.32 } as const;
const LEAD = { weight: 0.18, maxPx: 24, tau: 0.35 } as const;

/** Smooth 1-D value noise in [-1, 1] (deterministic: shake never reads Math.random). */
export function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const x = Math.sin((n + seed * 101.3) * 127.1) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
}

/** What the rig needs from the scene (structural, so tests drive it without Phaser). */
export interface RigScene {
  readonly cameras: { readonly main: Phaser.Cameras.Scene2D.Camera };
  readonly add: { rectangle(x: number, y: number, w: number, h: number, color: number, alpha: number): Phaser.GameObjects.Rectangle };
}

interface Pan {
  at: () => Pt | null;
  t: number;
}

export class CameraRig {
  private tau = 0;
  private clock = 0;
  /** Whole-pixel shake + kick this frame (added after the map clamp). */
  readonly jolt = { x: 0, y: 0 };
  /** Whole-pixel look offset this frame (pan / lead; added before the map clamp). */
  readonly look = { x: 0, y: 0 };
  private kx = 0;
  private ky = 0;
  private kvx = 0;
  private kvy = 0;
  private pan: Pan | null = null;
  private leadAt: (() => Pt | null) | null = null;
  private lx = 0;
  private ly = 0;
  private flashes: number[] = [];
  private overlay: Phaser.GameObjects.Rectangle | null = null;
  private flashFrames: number[] = [];
  private flashFrameT = 0;
  /** Real ms (the flash governor and frames run on the rig clock). */
  private ms = 0;
  /** Stats (QA). */
  readonly stats = { flashes: 0, flashesRefused: 0, kicks: 0, pans: 0 };

  constructor(
    private readonly scene: RigScene | null,
    private readonly reduce: () => boolean = () => false,
  ) {}

  get trauma(): number {
    return this.tau;
  }

  get panning(): boolean {
    return !!this.pan;
  }

  addTrauma(amount: number): void {
    if (amount > 0) this.tau = Math.min(1, this.tau + amount * (this.reduce() ? 0.3 : 1));
  }

  /** A directional kick: the view jumps up to `px` art px along `ang` and springs back. */
  kick(ang: number, px: number): void {
    const p = Math.min(KICK_MAX, px * (this.reduce() ? 0.3 : 1));
    if (p < 0.5) return;
    // Critically damped: an impulse v0 peaks at v0 / (w e).
    const v0 = p * KICK_W * Math.E;
    this.kvx += Math.cos(ang) * v0;
    this.kvy += Math.sin(ang) * v0;
    this.stats.kicks++;
  }

  /** A governed screen flash; false when refused (reduce-flash, too soon, too many this second). */
  flash(color: number, alpha: number): boolean {
    if (this.reduce() || !this.scene) {
      this.stats.flashesRefused++;
      return false;
    }
    const now = this.ms;
    this.flashes = this.flashes.filter((t) => now - t < 1000);
    const last = this.flashes[this.flashes.length - 1] ?? -1e9;
    if (this.flashes.length >= FLASH.perSecond || now - last < FLASH.minGapMs) {
      this.stats.flashesRefused++;
      return false;
    }
    this.flashes.push(now);
    const a = Math.min(FLASH.alphaMax, Math.max(0, alpha));
    const cam = this.scene.cameras.main;
    if (!this.overlay) {
      this.overlay = this.scene.add.rectangle(0, 0, cam.width, cam.height, color, 0);
      this.overlay.setOrigin(0, 0).setScrollFactor(0).setDepth(DEPTH.SCREEN_FX);
    }
    this.overlay.setSize(cam.width, cam.height).setFillStyle(color, 1);
    this.flashFrames = [a, a * 0.55, a * 0.25];
    this.flashFrameT = 0;
    this.overlay.setAlpha(this.flashFrames[0]).setVisible(true);
    this.stats.flashes++;
    return true;
  }

  /** The warden intro pan toward a live point (skipped under reduce-motion, or while one runs). */
  intro(at: () => Pt | null): boolean {
    if (this.reduce() || this.pan) return false;
    this.pan = { at, t: 0 };
    this.stats.pans++;
    return true;
  }

  /** A gentle lead toward a target (warden / elite in manual play); null stops it. */
  lead(at: (() => Pt | null) | null): void {
    this.leadAt = at;
  }

  /**
   * Per frame, after the follow: integrates trauma, kicks, the flash frames and the look. `focus` is the followed
   * point, `view` the visible size (art px) — a pan never pushes the player out of it.
   */
  update(dt: number, focus: Pt, view: { w: number; h: number }): void {
    const d = Math.max(0, Math.min(0.1, dt));
    this.clock += d;
    this.ms += d * 1000;
    // Trauma² shake.
    let sx = 0;
    let sy = 0;
    if (this.tau > 0) {
      const k = SHAKE_PX * this.tau * this.tau;
      sx = k * noise1(this.clock * SHAKE_HZ, 1);
      sy = k * noise1(this.clock * SHAKE_HZ, 2);
      this.tau = Math.max(0, this.tau - TRAUMA_DECAY * d);
    }
    // Kick spring (substeps keep it stable at low frame rates).
    const n = Math.max(1, Math.ceil(d / (1 / 240)));
    const h = d / n;
    for (let i = 0; i < n; i++) {
      this.kvx += (-KICK_W * KICK_W * this.kx - 2 * KICK_W * this.kvx) * h;
      this.kvy += (-KICK_W * KICK_W * this.ky - 2 * KICK_W * this.kvy) * h;
      this.kx += this.kvx * h;
      this.ky += this.kvy * h;
    }
    if (Math.abs(this.kx) < 0.05 && Math.abs(this.kvx) < 0.5) this.kx = this.kvx = 0;
    if (Math.abs(this.ky) < 0.05 && Math.abs(this.kvy) < 0.5) this.ky = this.kvy = 0;
    this.jolt.x = Math.round(sx + Math.max(-KICK_MAX, Math.min(KICK_MAX, this.kx)));
    this.jolt.y = Math.round(sy + Math.max(-KICK_MAX, Math.min(KICK_MAX, this.ky)));
    // Flash frames (stepped, never tweened).
    if (this.overlay?.visible) {
      this.flashFrameT += d * 1000;
      const f = Math.floor(this.flashFrameT / FLASH.frameMs);
      if (f >= this.flashFrames.length) this.overlay.setVisible(false);
      else this.overlay.setAlpha(this.flashFrames[f]);
    }
    // Look: the intro pan wins over the lead.
    let tx = 0;
    let ty = 0;
    if (this.pan && !this.reduce()) {
      const p = this.pan;
      p.t += d * 1000;
      const at = p.at();
      const total = PAN.inMs + PAN.holdMs + PAN.outMs;
      if (!at || p.t >= total) this.pan = null;
      else {
        const e = (u: number) => u * u * (3 - 2 * u);
        const w = p.t < PAN.inMs ? e(p.t / PAN.inMs) : p.t < PAN.inMs + PAN.holdMs ? 1 : 1 - e((p.t - PAN.inMs - PAN.holdMs) / PAN.outMs);
        tx = (at.x - focus.x) * PAN.weight * w;
        ty = (at.y - focus.y) * PAN.weight * w;
        const mx = view.w * PAN.maxView;
        const my = view.h * PAN.maxView;
        tx = Math.max(-mx, Math.min(mx, tx));
        ty = Math.max(-my, Math.min(my, ty));
      }
    } else if (this.pan) this.pan = null;
    if (!this.pan) {
      const at = this.leadAt?.() ?? null;
      let gx = 0;
      let gy = 0;
      if (at && !this.reduce()) {
        gx = (at.x - focus.x) * LEAD.weight;
        gy = (at.y - focus.y) * LEAD.weight;
        const L = Math.hypot(gx, gy);
        if (L > LEAD.maxPx) {
          gx = (gx / L) * LEAD.maxPx;
          gy = (gy / L) * LEAD.maxPx;
        }
      }
      const a = 1 - Math.exp(-d / LEAD.tau);
      this.lx += (gx - this.lx) * a;
      this.ly += (gy - this.ly) * a;
      tx = this.lx;
      ty = this.ly;
    } else {
      this.lx = tx;
      this.ly = ty;
    }
    this.look.x = Math.round(tx);
    this.look.y = Math.round(ty);
  }

  /**
   * Routes legacy direct calls on this camera (cameras.main.shake / flash) into the rig: trauma instead of Phaser's
   * sub-pixel shake, a governed ≤ 0.35 flash instead of a full-white one. Fades are untouched.
   */
  install(cam: Phaser.Cameras.Scene2D.Camera): void {
    const rig = this;
    cam.shake = function (this: Phaser.Cameras.Scene2D.Camera, _duration?: number, intensity?: number | Phaser.Math.Vector2) {
      const i = typeof intensity === 'number' ? intensity : 0.005;
      rig.addTrauma(Math.min(0.6, Math.sqrt(Math.max(0, i) / 0.01) * 0.3));
      return this;
    } as typeof cam.shake;
    cam.flash = function (this: Phaser.Cameras.Scene2D.Camera, _duration?: number, red = 255, green = 255, blue = 255) {
      rig.flash(((red & 255) << 16) | ((green & 255) << 8) | (blue & 255), 0.3);
      return this;
    } as typeof cam.flash;
  }

  destroy(): void {
    this.overlay?.destroy();
    this.overlay = null;
    this.pan = null;
    this.leadAt = null;
  }
}
