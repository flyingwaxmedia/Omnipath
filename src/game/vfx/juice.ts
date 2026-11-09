// Juice rig (docs/QUALITY-PLAN.md §7, docs/VFX.md §6.6, §9): the hit feel on actors, inside hard budgets.
//
// - Hit-stop is VICTIM-LOCAL and visual (the victim's sprite and frame hold; gameplay timers never stop), coalescing:
//   a new request on a victim already held only extends the hold to the later end, and every victim has a rolling
//   budget of VFX_BUDGET.hitStop.budgetMsPerSecond (150 ms) per second, each hold <= localMaxMs (100 ms). So a
//   flurry of hits reads as a few crisp beats, never as a stalled body. The global freeze stays the spark's alone
//   (MapScene.hitStop(150), docs/VFX.md §13 item 2).
// - Impact frame: ONE rendered frame of white (reduce-flash: the hit's colour), a 1-frame squash and a whole-pixel
//   recoil along the blow (never a fractional tween). Body flashes are gated per victim (BODY_FLASH): only the first
//   hit of a cast on a victim may flash; later ticks of that cast within 150 ms are spark-only (no flash, squash or
//   recoil), later beats of it recoil without a flash; and a victim flashes at most once per 220 ms AND per 8 rendered
//   frames, so a full-body silhouette covers <= 12.5 % of the frames even in a busy fight at a low frame rate (it was
//   a solid silhouette in most frames under multi-hit skills). DoT ticks share the gate (tick()); deaths and spawns
//   (pop()) are not gated.
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
  /** Rendered-frame counter (game.loop.frame): the flash cooldown also counts frames. Absent: time only. */
  frame?(): number;
}

/** Body-flash gate per victim (docs/VFX.md §6.6). */
export const BODY_FLASH = {
  /** A later hit of the same cast on the same victim inside this gap is spark-only (no flash, squash or recoil). */
  sameCastQuietMs: 150,
  /** At least this long between two body flashes of one victim (ms)... */
  cooldownMs: 220,
  /** ...and at least this many rendered frames: a 1-frame flash then covers <= 1 / 8 of the frames at any rate. */
  cooldownFrames: 8,
  /** Casts remembered per victim (their first hit already landed); older than this they are forgotten (ms). */
  castMemoryMs: 3000,
} as const;

/** What a juice impact did to the victim's body (QA / tests). */
export type ImpactOutcome = 'flash' | 'cooled' | 'beat' | 'quiet' | 'gone';

interface FlashState {
  /** Last body flash: scene time and rendered frame. */
  at: number;
  frame: number;
  /** Cast key -> scene time of its latest hit on this victim. */
  casts: Map<unknown, number>;
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
  private flashState = new WeakMap<object, FlashState>();
  /** Stats (QA): holds granted / trimmed by the budget. */
  granted = 0;
  trimmed = 0;
  /** Stats (QA): body flashes shown, and hits that stayed spark-only / beat-only / cooled by the gate. */
  readonly flashes = { shown: 0, quiet: 0, beat: 0, cooled: 0 };

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

  /**
   * A blow on the victim's body, through the flash gate (BODY_FLASH). `cast` keys the blow's cast (any stable per-cast value):
   * its first hit on this victim may flash (one frame: white, or `color` under reduce-flash) + squash + recoil, unless
   * the victim flashed within the cooldown (then only the recoil); later hits of the same cast within 150 ms are
   * spark-only, later beats of it only recoil. Without a cast every blow counts as a first hit.
   */
  impact(victim: object | 'player', color: number, ang: number, recoilPx: number, cast?: unknown): ImpactOutcome {
    const a = this.host.actor(victim);
    if (!a) return 'gone';
    const now = this.host.now();
    const st = this.flashOf(victim);
    if (cast !== undefined) {
      const prev = st.casts.get(cast);
      st.casts.set(cast, now);
      if (st.casts.size > 12) for (const [k, t] of st.casts) if (now - t > BODY_FLASH.castMemoryMs) st.casts.delete(k);
      if (prev !== undefined) {
        if (now - prev < BODY_FLASH.sameCastQuietMs) {
          this.flashes.quiet++;
          return 'quiet';
        }
        this.flashes.beat++;
        if (recoilPx > 0) a.recoil(ang, Math.round(recoilPx));
        return 'beat';
      }
    }
    if (!this.flashReady(st, now)) {
      this.flashes.cooled++;
      if (recoilPx > 0) a.recoil(ang, Math.round(recoilPx));
      return 'cooled';
    }
    this.markFlash(st, now);
    a.impactFlash([this.host.reduceFlash() ? color : WHITE]);
    a.squash();
    if (recoilPx > 0) a.recoil(ang, Math.round(recoilPx));
    return 'flash';
  }

  /** A damage-over-time tick: one frame of `color` on the body when the victim's flash gate allows it. */
  tick(victim: object | 'player', color: number): boolean {
    const a = this.host.actor(victim);
    if (!a) return false;
    const now = this.host.now();
    const st = this.flashOf(victim);
    if (!this.flashReady(st, now)) {
      this.flashes.cooled++;
      return false;
    }
    this.markFlash(st, now);
    a.impactFlash([color]);
    return true;
  }

  /** Death / spawn pop: two white frames (one under reduce-flash) and a squash; never gated, it restarts the gate. */
  pop(victim: object | 'player'): void {
    const a = this.host.actor(victim);
    if (!a) return;
    this.markFlash(this.flashOf(victim), this.host.now());
    a.impactFlash(this.host.reduceFlash() ? [WHITE] : [WHITE, WHITE]);
    a.squash();
  }

  private flashOf(victim: object | 'player'): FlashState {
    const key = victim === 'player' ? PLAYER_KEY : victim;
    let st = this.flashState.get(key);
    if (!st) this.flashState.set(key, (st = { at: -1e9, frame: -1e9, casts: new Map() }));
    return st;
  }

  private flashReady(st: FlashState, now: number): boolean {
    if (now - st.at < BODY_FLASH.cooldownMs) return false;
    const f = this.host.frame?.();
    return f === undefined || f - st.frame >= BODY_FLASH.cooldownFrames;
  }

  private markFlash(st: FlashState, now: number): void {
    st.at = now;
    st.frame = this.host.frame?.() ?? st.frame;
    this.flashes.shown++;
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
