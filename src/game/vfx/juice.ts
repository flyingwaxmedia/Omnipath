// Juice rig (docs/QUALITY-PLAN.md §7, docs/VFX.md §6.6, §9): the hit feel on actors, inside hard budgets.
//
// - Hit-stop is VICTIM-LOCAL and visual (the victim's sprite and frame hold; gameplay timers never stop), coalescing:
//   a new request on a victim already held only extends the hold to the later end, and every victim has a rolling
//   budget of VFX_BUDGET.hitStop.budgetMsPerSecond (150 ms) per second, each hold <= localMaxMs (100 ms). So a
//   flurry of hits reads as a few crisp beats, never as a stalled body. The global freeze stays the spark's alone
//   (MapScene.hitStop(150), docs/VFX.md §13 item 2).
// - Impact frames: white for one frame, then the hit's colour for one frame (reduce-flash: the colour frame only),
//   a 1-frame squash and a whole-pixel recoil along the blow (never a fractional tween).
// - Camera: kicks and flashes go to the camera rig (render/camera.ts), which applies reduce-motion and the flash
//   governor; trauma goes through VfxStage.trauma.
// Phaser-free: the actors and the camera are structural views (tests/vfx-world.test.ts drives it with fakes).
import type { JuiceHooks } from './play';
import { VFX_BUDGET } from './types';

/** What an actor (Monster / Player) exposes to the rig (entities/*: hold, impactFlash, squash, recoil). */
export interface JuiceActor {
  /** Holds the sprite (position + frame) for `ms` of scene time; a later call extends it. */
  hold(ms: number): void;
  /** Tint-fill frames, one per rendered frame (e.g. [white, element]); then the normal tint returns. */
  impactFlash(frames: readonly number[]): void;
  /** A 1-frame squash (width +, height -), whole pixels. */
  squash(): void;
  /** Whole-pixel recoil along `ang` (radians): `px`, then half, then home, one step per frame. */
  recoil(ang: number, px: number): void;
}

export interface JuiceCamera {
  kick(ang: number, px: number): void;
  flash(color: number, alpha: number): boolean;
}

export interface JuiceHost {
  /** Scene time (ms). */
  now(): number;
  reduceFlash(): boolean;
  /** The actor behind a victim key ('player' or a Monster), or null when it is gone. */
  actor(victim: object | 'player'): JuiceActor | null;
  camera(): JuiceCamera | null;
}

interface HoldState {
  until: number;
  /** Granted hold ms with their start times (rolling one-second budget). */
  spent: { t: number; ms: number }[];
}

const WHITE = 0xffffff;
/** Hold-budget key of the player (monsters key by themselves). */
const PLAYER_KEY = {};

export class JuiceRig implements JuiceHooks {
  private holds = new WeakMap<object, HoldState>();
  /** Stats (QA): holds granted / trimmed by the budget. */
  granted = 0;
  trimmed = 0;

  constructor(private readonly host: JuiceHost) {}

  hold(victim: object | 'player', ms: number): number {
    const want = Math.min(VFX_BUDGET.hitStop.localMaxMs, Math.max(0, Math.round(ms)));
    if (want <= 0) return 0;
    const now = this.host.now();
    const key = victim === 'player' ? PLAYER_KEY : victim;
    let st = this.holds.get(key);
    if (!st) this.holds.set(key, (st = { until: 0, spent: [] }));
    st.spent = st.spent.filter((s) => now - s.t < 1000);
    const used = st.spent.reduce((a, s) => a + s.ms, 0);
    const left = Math.max(0, VFX_BUDGET.hitStop.budgetMsPerSecond - used);
    // Coalescing: only the part that reaches past the current hold costs budget.
    const extend = Math.max(0, now + want - Math.max(now, st.until));
    const add = Math.min(extend, left);
    if (add < extend) this.trimmed++;
    if (add <= 0) return Math.max(0, st.until - now);
    st.spent.push({ t: now, ms: add });
    st.until = Math.max(now, st.until) + add;
    this.granted++;
    const total = st.until - now;
    this.host.actor(victim)?.hold(total);
    return total;
  }

  impact(victim: object | 'player', color: number, ang: number, recoilPx: number): void {
    const a = this.host.actor(victim);
    if (!a) return;
    a.impactFlash(this.host.reduceFlash() ? [color] : [WHITE, color]);
    a.squash();
    if (recoilPx > 0) a.recoil(ang, Math.round(recoilPx));
  }

  kick(ang: number, px: number): void {
    if (px > 0) this.host.camera()?.kick(ang, px);
  }

  flash(color: number, alpha: number): boolean {
    return this.host.camera()?.flash(color, Math.min(VFX_BUDGET.flash.screenAlphaMax, alpha)) ?? false;
  }
}

/**
 * Victim hold for a hit (docs/VFX.md §6.6): the recipe's weight hold (light 0, normal 33, heavy 67, ultimate 100;
 * +17 on a crit), scaled by how much of the victim's health the blow took (a chip hit barely holds, a chunk holds
 * fully); 0 for later hits of a multi-hit cast.
 */
export function holdFor(baseMs: number, crit: boolean, damage: number, maxHp: number, first: boolean): number {
  if (!first || baseMs <= 0) return 0;
  const frac = maxHp > 0 ? damage / maxHp : 0;
  const scale = Math.max(0.5, Math.min(1.2, 0.5 + frac * 2.5));
  return Math.min(VFX_BUDGET.hitStop.localMaxMs, Math.round((baseMs + (crit ? 17 : 0)) * scale));
}
