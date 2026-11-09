// The play contract between the bus bridge (bridge.ts, Phaser-free) and the Phaser runtime (runtime/**).
// The bridge turns game events into `play(pieces, ctx)` calls; the runtime places, times, pools and governs them.
// Anchors are live views (actors, movers): the runtime reads x / y every frame, so overlays follow what they mark.
import type { Pt, VfxOwner, VfxPiece } from './types';

/** A point the runtime reads every frame (an actor's feet, a mover's drawn position) or a fixed point. */
export interface LivePt {
  readonly x: number;
  readonly y: number;
}

/** What an afterimage snapshots: the actor's current sprite frame (structural, so this file stays Phaser-free). */
export interface GhostSource {
  readonly x: number;
  readonly y: number;
  readonly sprite: {
    readonly texture: { readonly key: string };
    readonly frame: { readonly name: string | number };
    readonly flipX: boolean;
    readonly originX: number;
    readonly originY: number;
    readonly scaleX: number;
    readonly scaleY: number;
    readonly visible: boolean;
  };
}

export interface PlayCtx {
  owner: VfxOwner;
  /** Anchor sources (VfxAnchor.to). caster / target / aim are feet points; body is a mover's drawn point or the
   *  struck actor's feet (status units); hop / path are fixed segments. */
  caster?: LivePt;
  target?: LivePt;
  aim?: LivePt;
  body?: LivePt;
  /** Depth-sort offset of the body anchor: movers fly 14 px above the ground they sort by. */
  bodySortDy?: number;
  hop?: { from: Pt; to: Pt };
  path?: { from: Pt; to: Pt; ms: number };
  /** Heading (radians, screen space) for directional pieces and aim-relative arcs; a function is read live. */
  ang: number | (() => number);
  /** Per-cast stream seed (hashSeed(recipe.variety, castId, ...)). */
  seed: number;
  /** Count multiplier (1 player, 0.5 monster). */
  quota?: number;
  /** Reprise replay: LUT 'shift' (no white hero frames). */
  shift?: boolean;
  /** Swing sense (odd swings of a multi-hit strike sweep back). */
  sense?: 1 | -1;
  /** Loops without a lifeMs live while this holds (charge, projectile bodies, auras). */
  alive?: () => boolean;
  /** Event radius for geometryFromEvent pieces (true hit-test radius). */
  r?: number;
  /** Skip trail pieces (volleys beyond VFX_BUDGET.perEvent.volleyTrailsFull: every 2nd shot only). */
  noTrail?: boolean;
  /** The actor afterimages snapshot (dash ghosts, reprise mirror). */
  ghostOf?: GhostSource;
  /** Per-target caps (sparks, status loops) are counted against this key. */
  victim?: object;
  /** Victim hit-stop: the impact spark holds its hero frame this long (ms). */
  holdMs?: number;
}

export interface VfxGroup {
  /** Ends loops now (projectile caught, charge cancelled, buff refreshed); one-shots finish on their own. */
  end(): void;
  readonly done: boolean;
}

/** What the bridge needs from the runtime. */
export interface VfxStage {
  /** World clock (ms): scene time minus pauses and hit-stops. */
  now(): number;
  play(pieces: readonly VfxPiece[], ctx: PlayCtx): VfxGroup;
  /** Queues pieces for baking ahead of use (warm set). */
  warm(pieces: readonly VfxPiece[]): void;
  /** Camera trauma (0..1), scaled down under reduce-flash. */
  trauma(amount: number): void;
  /** Runs `fn` once per frame (world clock) until it returns false (watchers: returning projectiles). */
  tick(fn: () => boolean): void;
  /** The 'Reduce shake & flashes' setting (reduce-flash bakes, trauma x0.3, no screen flash). */
  readonly reduceFlash: boolean;
}
