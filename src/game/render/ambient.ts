// Living world (living lane; docs/QUALITY-PLAN.md §12, docs/ART-DIRECTION.md): everything that moves in a map without
// being an actor or an effect.
//
//   weather / air   biome particles in whole-pixel steps: falling leaves and petals, fireflies, embers and heat specks,
//                   snow, spores, dust motes, rain streaks that end in puddle rings (AirSim, pure + seeded)
//   clouds          big soft-edged cloud shadows (1 px noise rims) drifting over outdoor maps, MULTIPLY at low alpha,
//                   stepping in whole pixels (CloudSim)
//   water           a 3-phase shimmer overlay on open water cells (never a re-bake of the ground) plus sparkle glints
//   smoke & sparks  pixel puffs from chimneys (art/world.ts STRUCTURE_SMOKE) and sparks from campfires (PuffSim)
//   idle frames     banners wave, lanterns / candles / torches flicker, campfires burn, trees, tall grass and reeds sway
//                   in travelling gusts: the textures are idle STRIPS (art/dressing.ts stripTex; frame 0 = the still
//                   look), so this only steps setFrame() on images already on screen (same texture: no extra batches)
//
// Rules: every position is rounded to a whole art px (the camera scroll is whole px too), nothing is rotated or
// scaled, every texture pixel is opaque (fades are dithered frames), particles are pooled (Blitter bobs, created once
// per map) and seeded from the map seed (same seed + same frame times = same pixels). Density follows the quality tier
// (setAmbientQuality: off / low / med / high; Canvas renderer = low) times the VFX governor's live level while it is free
// to react to load (governorScale: a pinned or Canvas-tier runtime is a choice the tier already made, never counted twice),
// and everything stops while the loop sleeps or the scene pauses: it runs on the scene's POST_UPDATE only.
//
// MapScene's one seam: `this.disposers.push(attachAmbient(this))` in create(). QA: window.omnipath.ambient
// (.stats(), .setQuality(tier | null), .pin(density | null)) and `?ambient=off|low|med|high`.
//
// This module never imports Phaser at runtime (types only): the pure parts (profiles, sims, wind, frame pickers, open
// water) are unit-tested in node (tests/render-ambient.test.ts).
import type Phaser from 'phaser';
import { hashSeed, mulberry32 } from '../../core/rng';
import { TILE } from '../../core/world/compile';
import { T } from '../../core/world/tiles';
import type { Biome, CompiledMap, MapDef } from '../../core/world/types';
import {
  AMB_CLOUD,
  AMB_FX,
  CLOUD_SHAPES,
  CLOUD_SIZES,
  DRESSING_IDLE,
  type IdleAnim,
  LEAF_FRAMES,
  type LeafSet,
  PUFF_SIZES,
  type SporeSet,
  drawAmbientFx,
} from '../art/dressing';
import { AMB_WATER, GLINT_FRAMES, SHIMMER_PHASES, SHIMMER_VARIANTS, type ShimmerKind, drawWaterShimmer } from '../art/tiles';
import { STRUCTURE_SMOKE, WORLD_IDLE } from '../art/world';
import { DEPTH, VFX_DEPTH } from './depths';

// ------------------------------------------------------------------ depths

/** Where each ambient layer draws (derived from the named layers in depths.ts, never a bare number). */
export const AMBIENT_DEPTH = {
  /** Water shimmer + glints: right over the baked ground, under every decal and sprite. */
  WATER: DEPTH.GROUND + 10,
  /** Rain rings on the ground: under fishing ripples, portal decals and flat dressing. */
  PUDDLE: DEPTH.GROUND_DECAL - 10,
  /** Cloud shadows: over the whole y-sorted world (a shadow falls on trees and actors alike), under the weather. */
  CLOUD: VFX_DEPTH.FX_MOTES - 600,
  /** Weather and smoke in the air: over the world, under spell motes, canopies, rims and name tags. */
  AIR: VFX_DEPTH.FX_MOTES - 300,
  /** Emissive specks (fireflies, spores, embers, heat); moved to DEPTH.LIGHT while a light map / darkness is up. */
  GLOW: VFX_DEPTH.FX_MOTES - 299,
} as const;

// ------------------------------------------------------------------ quality (export setter)

export type AmbientTier = 'off' | 'low' | 'med' | 'high';

export interface TierSpec {
  /** Air particle density (× the profile's per-area counts). */
  air: number;
  /** Cloud shadows on. */
  clouds: boolean;
  /** Share of open water cells that get the shimmer overlay (0 = none). */
  water: number;
  /** Water glints (× the per-cell rate). */
  glints: number;
  /** Prop idle frames on. */
  idle: boolean;
  /** Chimney smoke and campfire sparks (× the spawn rate). */
  smoke: number;
}

export const AMBIENT_TIERS: Readonly<Record<AmbientTier, TierSpec>> = {
  off: { air: 0, clouds: false, water: 0, glints: 0, idle: false, smoke: 0 },
  low: { air: 0.3, clouds: false, water: 0, glints: 0.5, idle: true, smoke: 0.5 },
  med: { air: 0.6, clouds: true, water: 0.5, glints: 0.7, idle: true, smoke: 1 },
  high: { air: 1, clouds: true, water: 1, glints: 1, idle: true, smoke: 1 },
};

/** Hard caps (pool sizes). Ambient bobs live outside the VFX runtime's pools and never starve them. */
export const AMBIENT_CAPS = { air: 150, puddles: 24, puffs: 40, glints: 16 } as const;

function urlTier(): AmbientTier | null {
  try {
    if (typeof location === 'undefined') return null;
    const v = new URLSearchParams(location.search).get('ambient');
    return v === 'off' || v === 'low' || v === 'med' || v === 'high' ? v : null;
  } catch {
    return null;
  }
}

/** The chosen tier (null = automatic: high on WebGL, low on the Canvas renderer). */
const settings: { tier: AmbientTier | null } = { tier: urlTier() };
const listeners = new Set<(tier: AmbientTier | null) => void>();

/** Quality hook (Phase D tiers / settings menu): pins the ambient tier, or null for automatic. Applies live. */
export function setAmbientQuality(tier: AmbientTier | null): void {
  if (settings.tier === tier) return;
  settings.tier = tier;
  for (const fn of [...listeners]) {
    try {
      fn(tier);
    } catch {
      /* a listener's failure never blocks the setting */
    }
  }
}

export function ambientQuality(): AmbientTier | null {
  return settings.tier;
}

/** Called when the tier changes; returns the unsubscribe. */
export function onAmbientQuality(fn: (tier: AmbientTier | null) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** The tier in effect for a renderer (automatic: Canvas = low). */
export function effectiveTier(webgl: boolean, tier: AmbientTier | null = settings.tier): AmbientTier {
  return tier ?? (webgl ? 'high' : 'low');
}

/** What the VFX runtime tells about its quality (src/game/vfx/runtime/runtime.ts, read structurally). */
export interface GovernorLike {
  /** Live quality 1 / 0.5 / 0.25. */
  quality?: number;
  /** A pinned quality (QA, a quality tier below High, the battery saver); null while the governor runs free. */
  pinned?: number | null;
  /** The Canvas renderer's fixed tier. */
  canvasTier?: boolean;
  /** A ceiling the governor stays under (a `setMaxQuality` tier cap), when the runtime has one. */
  maxQuality?: number;
}

/**
 * Share of the ambient density the VFX governor leaves (pure): its live level over its ceiling while it reacts to
 * load. A pinned runtime (Medium / Low pin it at 0.5 / 0.25, so does the battery saver) or the Canvas tier is a static
 * choice the ambient tier already made (med / low): 1, so a quality tier never cuts the weather twice.
 */
export function governorScale(rt: GovernorLike | null | undefined): number {
  const q = rt?.quality;
  if (!rt || typeof q !== 'number' || !(q > 0)) return 1;
  if (rt.canvasTier === true || (rt.pinned !== undefined && rt.pinned !== null)) return 1;
  const ceil = typeof rt.maxQuality === 'number' && rt.maxQuality > 0 ? rt.maxQuality : 1;
  return Math.min(1, q / ceil);
}

// ------------------------------------------------------------------ profiles (pure)

export type AirKind = 'leaf' | 'snow' | 'rain' | 'firefly' | 'spore' | 'dust' | 'ember' | 'heat';

/** Emissive kinds draw on the GLOW layer (above a light map); the rest on AIR. */
export const EMISSIVE: ReadonlySet<AirKind> = new Set<AirKind>(['firefly', 'spore', 'ember', 'heat']);

export interface AirSpec {
  kind: AirKind;
  /** Particles per 100k art px² of view at density 1 (a phone portrait view is ~330k). */
  per100k: number;
  /** Leaf or spore colour sets (picked per particle). */
  sets?: readonly (LeafSet | SporeSet)[];
}

export interface AmbientProfile {
  air: readonly AirSpec[];
  /** Cloud-shadow alpha under MULTIPLY (0 = no clouds). */
  clouds: number;
  /** Wind (px/s, + = east) that carries leaves, snow, rain, smoke and clouds; gusts modulate it. */
  wind: number;
}

const PROFILES: Readonly<Record<Biome, AmbientProfile>> = {
  meadow: { air: [{ kind: 'leaf', per100k: 2.4, sets: ['green', 'green', 'autumn'] }], clouds: 0.2, wind: 9 },
  lake: { air: [{ kind: 'leaf', per100k: 1.4, sets: ['green', 'autumn'] }], clouds: 0.2, wind: 8 },
  hill: { air: [{ kind: 'leaf', per100k: 3.2, sets: ['green', 'green', 'autumn'] }], clouds: 0.22, wind: 16 },
  quarry: { air: [{ kind: 'dust', per100k: 5 }], clouds: 0.2, wind: 6 },
  grove: {
    air: [
      { kind: 'leaf', per100k: 2.2, sets: ['grove'] },
      { kind: 'spore', per100k: 4, sets: ['gloom'] },
    ],
    clouds: 0.14,
    wind: 5,
  },
  ember: {
    air: [
      { kind: 'ember', per100k: 10 },
      { kind: 'heat', per100k: 5 },
    ],
    clouds: 0,
    wind: 4,
  },
  basalt: {
    air: [
      { kind: 'ember', per100k: 9 },
      { kind: 'heat', per100k: 6 },
    ],
    clouds: 0,
    wind: 4,
  },
  plateau: {
    air: [
      { kind: 'leaf', per100k: 2.6, sets: ['green', 'autumn'] },
      { kind: 'dust', per100k: 2 },
    ],
    clouds: 0.24,
    wind: 20,
  },
  town: { air: [{ kind: 'leaf', per100k: 1.2, sets: ['green', 'autumn'] }], clouds: 0.2, wind: 8 },
  cave: {
    air: [
      { kind: 'dust', per100k: 6 },
      { kind: 'spore', per100k: 1.2, sets: ['gloom'] },
    ],
    clouds: 0,
    wind: 0,
  },
  crypt: { air: [{ kind: 'dust', per100k: 6 }], clouds: 0, wind: 0 },
  glade: {
    air: [
      { kind: 'firefly', per100k: 8 },
      { kind: 'spore', per100k: 1.2, sets: ['gloom'] },
    ],
    clouds: 0,
    wind: 3,
  },
  frost: { air: [{ kind: 'snow', per100k: 22 }], clouds: 0.14, wind: 7 },
  storm: { air: [{ kind: 'rain', per100k: 34 }], clouds: 0.3, wind: 14 },
  dusk: {
    air: [
      { kind: 'firefly', per100k: 4 },
      { kind: 'leaf', per100k: 1.6, sets: ['petal'] },
      { kind: 'spore', per100k: 1.5, sets: ['dusk'] },
    ],
    clouds: 0.1,
    wind: 6,
  },
};

/** The ambience of a map: its biome's profile, without cloud shadows under a roof or in the dark. */
export function ambientProfile(def: Pick<MapDef, 'biome' | 'flags'>): AmbientProfile {
  const p = PROFILES[def.biome] ?? PROFILES.meadow;
  const covered = def.flags?.includes('indoor') || def.flags?.includes('dark');
  return covered && p.clouds ? { ...p, clouds: 0 } : p;
}

// ------------------------------------------------------------------ wind (pure)

/** Gust envelope 0.3..1 (two slow sines; deterministic in t seconds). */
export function gust(t: number): number {
  return 0.65 + 0.35 * Math.sin(t * 0.7) * Math.sin(t * 0.23 + 1);
}

/** A gust band travelling east across the map: 0..1 at (x, y) px at t s (wavelength ~570 px, period ~5.7 s). */
export function windWave(t: number, x: number, y: number): number {
  return (0.5 + 0.5 * Math.sin(t * 1.1 - x * 0.011 - y * 0.004)) * gust(t);
}

/** Small integer hash (per image / cell / slot). */
export function hash32(a: number, b = 0, c = 0): number {
  let h = Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  return (h ^ (h >>> 15)) >>> 0;
}

/**
 * Idle frame of an animated image at t s (pure). `h` is the image's own hash (desyncs neighbours), (x, y) its foot.
 *   sway     2 frames: blown (1) while the travelling gust band is over it; `stiff` raises the threshold (trees)
 *   wave     3 frames stepped 0 → 2 → 1 (the wave runs down the cloth), faster in gusts
 *   flicker  mostly the still frame, short flares (1) and dips (2) on a 130 ms random slot
 *   flame    cycles its frames on a 110 ms slot, now and then skipping one (never a steady loop)
 */
export function idleFrame(anim: IdleAnim, t: number, x: number, y: number, h: number, stiff = 0.5): number {
  const n = anim.frames;
  switch (anim.kind) {
    case 'sway':
      return windWave(t, x, y) > stiff + ((h & 255) / 255) * 0.12 ? 1 % n : 0;
    case 'wave': {
      const step = 0.27 - 0.1 * gust(t);
      const seq = [0, 2, 1];
      return seq[(Math.floor(t / step) + (h & 7)) % 3] % n;
    }
    case 'flicker': {
      const slot = Math.floor(t / 0.13) + (h & 15);
      const r = hash32(slot, h) / 4294967296;
      return r < 0.6 ? 0 : r < 0.82 || n < 3 ? 1 % n : 2;
    }
    case 'flame': {
      const slot = Math.floor(t / 0.11) + (h & 15);
      return (slot + (hash32(slot, h) % 4 === 0 ? 1 : 0)) % n;
    }
  }
}

// ------------------------------------------------------------------ air (pure)

export interface View {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface AirParticle {
  spec: number;
  kind: AirKind;
  /** Colour set index into the spec's sets (0 when the kind has none). */
  set: number;
  on: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  /** Per-particle phase 0..1. */
  seed: number;
  /** Size / variant index (snow flake size, rain streak length). */
  size: number;
  /** Ground y where a leaf lands or a raindrop splashes. */
  landY: number;
  /** 0 airborne, 1 landed (leaves). */
  state: number;
  /** Frame name in AMB_FX (one of the precomputed names: no per-frame string building). */
  frame: string;
  /** Rounded draw position (whole art px). */
  px: number;
  py: number;
}

export interface Puddle {
  on: boolean;
  x: number;
  y: number;
  age: number;
  frame: string;
}

/** Margin (px) around the view where particles live, so nothing pops in at the edge. */
export const AIR_MARGIN = 24;

/** Frame names per kind (and set). */
const LEAF_NAMES = (set: string): string[] => [...Array.from({ length: LEAF_FRAMES }, (_, i) => `leaf_${set}_${i}`), `leaf_${set}_fade`];
const SPORE_NAMES = (set: string): string[] => [0, 1, 2].map((i) => `spore_${set}_${i}`);
const NAMES = {
  snow: ['snow_0', 'snow_1', 'snow_2'],
  rain: ['rain_0', 'rain_1'],
  puddle: ['puddle_0', 'puddle_1', 'puddle_2', 'puddle_3'],
  firefly: ['firefly_0', 'firefly_1', 'firefly_2', 'firefly_3'],
  dust: ['dust_0', 'dust_1'],
  ember: ['ember_0', 'ember_1', 'ember_2', 'ember_3', 'ember_4'],
  heat: ['heat_0', 'heat_1'],
} as const;
/** Puddle ring frame time (s). */
const PUDDLE_STEP = 0.075;

/** Where hot particles (embers, heat specks) rise from: a point over lava / ember ground in view, or null. */
export type HotPicker = (kind: 'ember' | 'heat', rnd: () => number) => { x: number; y: number } | null;

/**
 * Biome air particles (pure, deterministic per seed and frame times). Each spec gets per100k × view area / 100k ×
 * density particles (capped at AMBIENT_CAPS.air in all); they live in the view plus AIR_MARGIN, wrapping around it as
 * the camera moves, so the screen always holds the same density. Positions are floats; px / py are the whole-pixel
 * draw positions.
 */
export class AirSim {
  readonly parts: AirParticle[] = [];
  readonly puddles: Puddle[] = [];
  private readonly rnd: () => number;
  /** Frame names [spec][set][frame]. */
  private readonly leafNames: string[][][];
  private readonly sporeNames: string[][][];
  private want = '';
  private puddleCap = 0;

  constructor(
    readonly specs: readonly AirSpec[],
    seed: number,
    private readonly wind: number,
    private readonly hot: HotPicker = () => null,
  ) {
    this.rnd = mulberry32(hashSeed(seed >>> 0, 'ambient-air'));
    this.leafNames = specs.map((s) => (s.kind === 'leaf' ? (s.sets ?? ['green']).map(LEAF_NAMES) : []));
    this.sporeNames = specs.map((s) => (s.kind === 'spore' ? (s.sets ?? ['gloom']).map(SPORE_NAMES) : []));
  }

  /** Target live count per spec for a view and density. */
  counts(view: View, density: number): number[] {
    const area = Math.max(0, view.w * view.h) / 100000;
    const raw = this.specs.map((s) => Math.max(0, Math.round(s.per100k * area * density)));
    const total = raw.reduce((a, b) => a + b, 0);
    if (total <= AMBIENT_CAPS.air) return raw;
    const k = AMBIENT_CAPS.air / total;
    return raw.map((n) => Math.floor(n * k));
  }

  /** Activates / parks particles to match the view area and density (cheap no-op when nothing changed). */
  layout(view: View, density: number): void {
    const want = this.counts(view, density);
    const key = want.join(',');
    this.puddleCap = this.specs.some((s) => s.kind === 'rain') ? Math.round(AMBIENT_CAPS.puddles * Math.min(1, density)) : 0;
    if (key === this.want) return;
    this.want = key;
    for (let si = 0; si < this.specs.length; si++) {
      let live = 0;
      for (const p of this.parts) {
        if (p.spec !== si) continue;
        if (live < want[si]) {
          if (!p.on) this.spawn(p, view, true);
          live++;
        } else p.on = false;
      }
      while (live < want[si]) {
        const p = this.make(si);
        this.parts.push(p);
        this.spawn(p, view, true);
        live++;
      }
    }
    for (let i = this.puddleCap; i < this.puddles.length; i++) this.puddles[i].on = false;
  }

  get live(): number {
    let n = 0;
    for (const p of this.parts) if (p.on) n++;
    return n;
  }

  private make(spec: number): AirParticle {
    const s = this.specs[spec];
    const sets = s.sets?.length ?? 0;
    return {
      spec,
      kind: s.kind,
      set: sets ? Math.floor(this.rnd() * sets) : 0,
      on: false,
      x: 0,
      y: 0,
      vx: 0,
      vy: 0,
      age: 0,
      life: 1,
      seed: this.rnd(),
      size: 0,
      landY: 0,
      state: 0,
      frame: '',
      px: 0,
      py: 0,
    };
  }

  /** (Re)starts a particle. `fill`: anywhere in the view (map start, density up); else at its natural source. */
  private spawn(p: AirParticle, v: View, fill: boolean): void {
    const r = this.rnd;
    const M = AIR_MARGIN;
    p.on = true;
    p.age = 0;
    p.state = 0;
    p.seed = r();
    const anyX = () => v.x - M + r() * (v.w + 2 * M);
    const anyY = () => v.y + r() * v.h;
    switch (p.kind) {
      case 'leaf': {
        p.vy = 13 + r() * 11;
        p.y = fill ? anyY() : v.y - 6 - r() * 30;
        p.x = anyX() - (fill ? 0 : this.wind * 1.5);
        p.landY = fill ? p.y + 20 + r() * v.h * 0.7 : v.y + v.h * (0.15 + r() * 0.95);
        p.life = 1.5 + r() * 2;
        p.frame = this.leafNames[p.spec][p.set][0];
        break;
      }
      case 'snow': {
        p.size = r() < 0.55 ? 0 : r() < 0.7 ? 1 : 2;
        p.vy = 10 + r() * 12 + p.size * 3;
        p.x = anyX();
        p.y = fill ? anyY() : v.y - 4 - r() * 20;
        p.frame = NAMES.snow[p.size];
        break;
      }
      case 'rain': {
        p.size = r() < 0.6 ? 0 : 1;
        p.vy = (p.size ? 200 : 260) + r() * 60;
        p.landY = v.y + r() * (v.h + 20);
        p.y = fill ? v.y + r() * Math.max(1, p.landY - v.y) : v.y - 10 - r() * 60;
        // aim the slanted fall so splashes spread evenly over the view
        p.x = anyX() - (p.landY - p.y) * 0.25;
        p.frame = NAMES.rain[p.size];
        break;
      }
      case 'firefly': {
        p.x = anyX();
        p.y = anyY();
        p.vx = (r() - 0.5) * 10;
        p.vy = (r() - 0.5) * 8;
        p.life = 2.6 + r() * 1.8; // blink period
        p.age = r() * p.life;
        p.frame = NAMES.firefly[0];
        break;
      }
      case 'spore': {
        p.x = anyX();
        p.y = anyY();
        p.vy = -(3.5 + r() * 5);
        p.life = 4 + r() * 4;
        if (fill) p.age = r() * p.life * 0.8;
        p.frame = this.sporeNames[p.spec][p.set][0];
        break;
      }
      case 'dust': {
        p.x = anyX();
        p.y = anyY();
        p.vx = (r() - 0.5) * 7;
        p.vy = (r() - 0.5) * 5;
        p.life = 3 + r() * 4;
        if (fill) p.age = r() * p.life * 0.8;
        p.frame = NAMES.dust[0];
        break;
      }
      case 'ember':
      case 'heat': {
        const at = r() < (p.kind === 'heat' ? 0.95 : 0.55) ? this.hot(p.kind, r) : null;
        p.x = at ? at.x : anyX();
        p.y = at ? at.y : v.y + v.h * (0.3 + r() * 0.7);
        p.size = p.x; // heat specks shimmer about their source column
        p.vx = (r() - 0.5) * 6;
        p.vy = p.kind === 'ember' ? -(22 + r() * 18) : -(9 + r() * 7);
        p.life = p.kind === 'ember' ? 1.6 + r() * 1.2 : 0.6 + r() * 0.6;
        if (fill) p.age = r() * p.life * 0.7;
        p.frame = p.kind === 'ember' ? NAMES.ember[0] : NAMES.heat[1];
        break;
      }
    }
    p.px = Math.round(p.x);
    p.py = Math.round(p.y);
  }

  /** Advances every live particle by dt seconds (t = ambient clock, s). */
  step(dt: number, t: number, v: View): void {
    const r = this.rnd;
    const M = AIR_MARGIN;
    const W = this.wind * gust(t);
    const left = v.x - M;
    const right = v.x + v.w + M;
    const top = v.y - M;
    const bottom = v.y + v.h + M;
    const spanX = v.w + 2 * M;
    const spanY = v.h + 2 * M;
    for (const p of this.parts) {
      if (!p.on) continue;
      p.age += dt;
      switch (p.kind) {
        case 'leaf': {
          const names = this.leafNames[p.spec][p.set];
          if (p.state === 0) {
            p.x += (W * (0.7 + 0.6 * p.seed) + Math.sin(p.age * 2.4 + p.seed * 6.283) * 10) * dt;
            p.y += p.vy * dt;
            p.frame = names[Math.floor(p.age * 7 + p.seed * 4) % LEAF_FRAMES];
            if (p.y >= p.landY) {
              p.state = 1;
              p.age = 0;
              p.frame = names[0];
            }
          } else {
            if (p.age > p.life) this.spawn(p, v, false);
            else if (p.age > p.life * 0.75) p.frame = names[LEAF_FRAMES];
          }
          break;
        }
        case 'snow':
          p.x += (W * 0.5 + Math.sin(p.age * 1.7 + p.seed * 6.283) * 6) * dt;
          p.y += p.vy * dt;
          break;
        case 'rain':
          p.y += p.vy * dt;
          p.x += p.vy * 0.25 * dt;
          if (p.y >= p.landY) {
            this.splash(Math.round(p.x), Math.round(p.landY));
            this.spawn(p, v, false);
          }
          break;
        case 'firefly': {
          p.vx = Math.max(-12, Math.min(12, p.vx + (r() - 0.5) * 30 * dt));
          p.vy = Math.max(-9, Math.min(9, p.vy + (r() - 0.5) * 24 * dt));
          p.x += p.vx * dt;
          p.y += p.vy * dt;
          const u = ((p.age / p.life + p.seed) % 1 + 1) % 1;
          // blink: wake (1), glow (2), full glow (3), glow, fade (1), dark body (0) for the rest of the period
          p.frame = NAMES.firefly[u < 0.06 ? 1 : u < 0.14 ? 2 : u < 0.36 ? 3 : u < 0.44 ? 2 : u < 0.5 ? 1 : 0];
          break;
        }
        case 'spore': {
          p.x += (W * 0.2 + Math.sin(p.age * 1.3 + p.seed * 6.283) * 4) * dt;
          p.y += p.vy * dt;
          const u = p.age / p.life;
          const names = this.sporeNames[p.spec][p.set];
          p.frame = names[u < 0.15 ? 0 : u < 0.7 ? 1 : u < 0.8 ? 2 : 0];
          if (p.age > p.life) this.spawn(p, v, false);
          break;
        }
        case 'dust':
          p.x += (p.vx + W * 0.3) * dt;
          p.y += p.vy * dt;
          p.frame = NAMES.dust[(p.age * 1.6 + p.seed * 2) % 2 < 0.45 ? 1 : 0];
          if (p.age > p.life) this.spawn(p, v, false);
          break;
        case 'ember': {
          p.x += (W + p.vx + Math.sin(p.age * 5 + p.seed * 6.283) * 8) * dt;
          p.y += p.vy * dt;
          const u = p.age / p.life;
          p.frame = NAMES.ember[u < 0.12 ? 0 : u < 0.35 ? 1 : u < 0.6 ? 2 : u < 0.86 ? 3 : 4];
          if (p.age > p.life) this.spawn(p, v, false);
          break;
        }
        case 'heat': {
          p.y += p.vy * dt;
          p.x = p.size + Math.round(Math.sin(p.age * 18 + p.seed * 6.283));
          p.frame = NAMES.heat[p.age / p.life < 0.5 ? 1 : 0];
          if (p.age > p.life) this.spawn(p, v, false);
          break;
        }
      }
      if (!p.on) continue;
      // keep the field around the view: wrap sideways; fallers restart at the top once below it
      if (p.x < left) {
        p.x += spanX;
        if (p.kind === 'heat') p.size += spanX;
      } else if (p.x > right) {
        p.x -= spanX;
        if (p.kind === 'heat') p.size -= spanX;
      }
      if (p.kind === 'leaf' || p.kind === 'rain') {
        if (p.y > bottom || p.y < top - spanY) this.spawn(p, v, false);
      } else if (p.y > bottom) p.y -= spanY;
      else if (p.y < top) p.y += spanY;
      p.px = Math.round(p.x);
      p.py = Math.round(p.y);
    }
    for (const q of this.puddles) {
      if (!q.on) continue;
      q.age += dt;
      const f = Math.floor(q.age / PUDDLE_STEP);
      if (f >= NAMES.puddle.length) q.on = false;
      else q.frame = NAMES.puddle[f];
    }
  }

  private splash(x: number, y: number): void {
    if (!this.puddleCap) return;
    let q: Puddle | undefined;
    for (let i = 0; i < this.puddles.length && i < this.puddleCap; i++)
      if (!this.puddles[i].on) {
        q = this.puddles[i];
        break;
      }
    if (!q) {
      if (this.puddles.length >= this.puddleCap) return;
      q = { on: false, x: 0, y: 0, age: 0, frame: NAMES.puddle[0] };
      this.puddles.push(q);
    }
    q.on = true;
    q.x = x;
    q.y = y;
    q.age = 0;
    q.frame = NAMES.puddle[0];
  }
}

// ------------------------------------------------------------------ smoke & sparks (pure)

export type PuffKind = 'smoke' | 'smokedark' | 'spark';

export interface Emitter {
  x: number;
  y: number;
  kind: PuffKind;
  /** Next emission (ambient clock, s). */
  next: number;
}

export interface Puff {
  on: boolean;
  kind: PuffKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  seed: number;
  frame: string;
  px: number;
  py: number;
}

const PUFF_NAMES: Readonly<Record<PuffKind, readonly string[]>> = {
  smoke: PUFF_SIZES.map((_, i) => `smoke_${i}`),
  smokedark: PUFF_SIZES.map((_, i) => `smokedark_${i}`),
  spark: NAMES.ember,
};

/**
 * Anchored emitters: chimney smoke (opaque pixel puffs that grow, thin out by dithering and drift downwind) and
 * campfire sparks. Only emitters within 64 px of the view emit; at most AMBIENT_CAPS.puffs live. Pure + seeded.
 */
export class PuffSim {
  readonly puffs: Puff[] = [];
  private readonly rnd: () => number;

  constructor(
    readonly emitters: Emitter[],
    seed: number,
    private readonly wind: number,
  ) {
    this.rnd = mulberry32(hashSeed(seed >>> 0, 'ambient-puff'));
    for (const e of emitters) e.next = this.rnd() * 0.8;
  }

  get live(): number {
    let n = 0;
    for (const p of this.puffs) if (p.on) n++;
    return n;
  }

  step(dt: number, t: number, v: View, rate: number): void {
    const r = this.rnd;
    const W = this.wind * gust(t);
    const cap = Math.round(AMBIENT_CAPS.puffs * Math.min(1, rate));
    for (const e of this.emitters) {
      // rate 0 (tier off): no emission and no schedule push, so smoke comes back at once with the tier
      if (rate <= 0 || t < e.next) continue;
      const spark = e.kind === 'spark';
      e.next = t + (spark ? 0.35 + r() * 0.85 : 0.22 + r() * 0.12) / Math.max(0.05, rate);
      if (e.x < v.x - 64 || e.x > v.x + v.w + 64 || e.y < v.y - 32 || e.y > v.y + v.h + 96) continue;
      let p: Puff | undefined;
      for (let i = 0; i < this.puffs.length && i < cap; i++)
        if (!this.puffs[i].on) {
          p = this.puffs[i];
          break;
        }
      if (!p) {
        if (this.puffs.length >= cap) continue;
        p = { on: false, kind: e.kind, x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 1, seed: 0, frame: '', px: 0, py: 0 };
        this.puffs.push(p);
      }
      p.on = true;
      p.kind = e.kind;
      p.x = e.x + (r() - 0.5) * (spark ? 6 : 2);
      p.y = e.y;
      p.age = 0;
      p.seed = r();
      p.vx = spark ? (r() - 0.5) * 8 : (r() - 0.5) * 3;
      p.vy = spark ? -(22 + r() * 14) : -(8 + r() * 4);
      p.life = spark ? 0.6 + r() * 0.5 : 2.6 + r() * 0.8;
      p.frame = PUFF_NAMES[p.kind][0];
    }
    for (const p of this.puffs) {
      if (!p.on) continue;
      p.age += dt;
      if (p.age >= p.life) {
        p.on = false;
        continue;
      }
      const u = p.age / p.life;
      const names = PUFF_NAMES[p.kind];
      if (p.kind === 'spark') {
        p.x += (p.vx + W * 0.3) * dt;
        p.y += p.vy * dt;
      } else {
        // rises, slows, leans downwind as it climbs
        p.x += (p.vx + W * (0.3 + u * 0.7) + Math.sin(p.age * 2 + p.seed * 6.283) * 1.5) * dt;
        p.y += p.vy * (1 - u * 0.5) * dt;
      }
      p.frame = names[Math.min(names.length - 1, Math.floor(u * names.length))];
      p.px = Math.round(p.x);
      p.py = Math.round(p.y);
    }
  }
}

// ------------------------------------------------------------------ clouds (pure)

export interface Cloud {
  x: number;
  y: number;
  shape: number;
  px: number;
  py: number;
}

/** How far (px) the cloud field reaches beyond the view (wider than the biggest cloud, so wraps happen off screen). */
export const CLOUD_REACH = { x: Math.max(...CLOUD_SIZES.map(([w]) => w)) + 8, y: Math.max(...CLOUD_SIZES.map(([, h]) => h)) + 8 };
/** Area of cloud field (px²) per cloud. */
const CLOUD_AREA = 170000;

/**
 * Cloud shadows drifting with the wind over a field that follows the view (a toroidal domain = view + CLOUD_REACH on
 * each side). Positions step in whole px (px / py). A camera jump bigger than the domain re-scatters the field.
 */
export class CloudSim {
  readonly clouds: Cloud[] = [];
  private readonly rnd: () => number;
  private last: View | null = null;

  constructor(
    seed: number,
    private readonly wind: number,
  ) {
    this.rnd = mulberry32(hashSeed(seed >>> 0, 'ambient-cloud'));
  }

  private domain(v: View): View {
    return { x: v.x - CLOUD_REACH.x, y: v.y - CLOUD_REACH.y, w: v.w + 2 * CLOUD_REACH.x, h: v.h + 2 * CLOUD_REACH.y };
  }

  /** Scatters the field over the view's domain (stratified: no two clouds start in the same band). */
  private scatter(v: View): void {
    const d = this.domain(v);
    const n = Math.max(2, Math.round((d.w * d.h) / CLOUD_AREA));
    this.clouds.length = 0;
    for (let i = 0; i < n; i++) {
      const shape = Math.floor(this.rnd() * CLOUD_SHAPES);
      const cx = d.x + ((i + 0.2 + this.rnd() * 0.6) / n) * d.w - CLOUD_SIZES[shape][0] / 2;
      const cy = d.y + this.rnd() * (d.h - CLOUD_SIZES[shape][1]);
      this.clouds.push({ x: cx, y: cy, shape, px: Math.round(cx), py: Math.round(cy) });
    }
  }

  step(dt: number, t: number, v: View): void {
    const L = this.last;
    if (!L || Math.abs(v.x - L.x) > v.w + CLOUD_REACH.x * 2 || Math.abs(v.y - L.y) > v.h + CLOUD_REACH.y * 2 || Math.abs(v.w * v.h - L.w * L.h) > 0.25 * L.w * L.h)
      this.scatter(v);
    this.last = { ...v };
    const d = this.domain(v);
    const vx = 4 + Math.max(0, this.wind) * 0.5 * (0.6 + 0.4 * gust(t));
    const vy = 1.2;
    for (const c of this.clouds) {
      const [w, h] = CLOUD_SIZES[c.shape];
      c.x += vx * dt;
      c.y += vy * dt;
      if (c.x > d.x + d.w) c.x -= d.w + w;
      else if (c.x + w < d.x) c.x += d.w + w;
      if (c.y > d.y + d.h) c.y -= d.h + h;
      else if (c.y + h < d.y) c.y += d.h + h;
      c.px = Math.round(c.x);
      c.py = Math.round(c.y);
    }
  }
}

// ------------------------------------------------------------------ water cells (pure)

/** Water kind of a cell; coordinates outside the map repeat its border (the ground apron does the same). */
export function waterKindAt(cm: Pick<CompiledMap, 'w' | 'h' | 'ground'>, X: number, Y: number): ShimmerKind | null {
  const x = Math.min(cm.w - 1, Math.max(0, X));
  const y = Math.min(cm.h - 1, Math.max(0, Y));
  const t = cm.ground[y * cm.w + x];
  return t === T.WATER ? 'water' : t === T.DEEP ? 'deep' : null;
}

/**
 * Open water: the cell and its 8 neighbours are the same water kind, so no shore foam, land edge or shallow/deep
 * transition piece reaches into it — the shimmer overlay never paints over an autotile edge.
 */
export function openWater(cm: Pick<CompiledMap, 'w' | 'h' | 'ground'>, X: number, Y: number): ShimmerKind | null {
  const k = waterKindAt(cm, X, Y);
  if (!k) return null;
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && waterKindAt(cm, X + dx, Y + dy) !== k) return null;
  return k;
}

/** Overlay offset (whole px, -8..8 each axis) of a cell from its hash: the wavelets never line up with the tiles. */
export function shimmerNudge(h: number): [number, number] {
  return [((h >>> 16) % 17) - 8, ((h >>> 21) % 17) - 8];
}

/** Shimmer step (s) and the overlay frame of a cell at t (pure): variant and phase from the cell hash. */
export const SHIMMER_STEP = 0.38;
export function shimmerAt(h: number, t: number): { variant: number; phase: number } {
  return { variant: h % SHIMMER_VARIANTS, phase: (Math.floor(t / SHIMMER_STEP) + ((h >>> 4) % SHIMMER_PHASES)) % SHIMMER_PHASES };
}

// ------------------------------------------------------------------ Phaser side

/** What the ambience needs from the map scene (MapScene satisfies it). */
export interface AmbientHost extends Phaser.Scene {
  readonly def: MapDef;
  readonly cm: CompiledMap;
}

export interface AmbientStats {
  tier: AmbientTier;
  /** Ambient clock (s): advances only while the scene updates (frozen while paused or the loop sleeps). */
  clock: number;
  density: number;
  governor: number;
  air: number;
  puddles: number;
  puffs: number;
  emitters: number;
  water: number;
  glints: number;
  clouds: number;
  idle: { total: number; shown: number; steps: number };
  blitters: number;
  bobs: number;
  ms: number;
  peakMs: number;
  dark: boolean;
}

interface IdleEntry {
  img: Phaser.GameObjects.Image;
  anim: IdleAnim;
  h: number;
  stiff: number;
  cur: number;
  /** Strip frame shown for idle frame 1 (IdleAnim.mirror on a flipX image, so it leans downwind on screen; else 1). */
  alt: number;
}

interface Glint {
  on: boolean;
  bob: Phaser.GameObjects.Bob | null;
  kind: ShimmerKind;
  x: number;
  y: number;
  age: number;
  wait: number;
}

const IDLE: Readonly<Record<string, IdleAnim>> = { ...DRESSING_IDLE, ...WORLD_IDLE };
/** Idle frames step at most this often (s); flicker / flame slots are longer than this. */
const IDLE_TICK = 0.06;
const GLINT_SEQ = [0, 1, 2, 1, 0];
const GLINT_STEP = 0.09;
const MULTIPLY = 2; // Phaser.BlendModes.MULTIPLY (no runtime Phaser import here)
/** A bob's current frame (protected in the typings, public at runtime). */
const bobFrame = (b: Phaser.GameObjects.Bob): Phaser.Textures.Frame => (b as unknown as { frame: Phaser.Textures.Frame }).frame;

class Ambient {
  private t = 0;
  private tierSpec: TierSpec = AMBIENT_TIERS.off;
  private tier: AmbientTier = 'off';
  private pinned: number | null = null;
  private governor = 1;
  private govT = 0;
  private darkT = 0;
  private dark = false;
  private destroyed = false;
  private readonly profile: AmbientProfile;
  private readonly seed: number;
  private readonly webgl: boolean;
  /** Frame lookups per atlas (name -> Frame), filled on first use. */
  private readonly frames = new Map<string, Map<string, Phaser.Textures.Frame>>();
  /** Water overlay frames [kind][variant][phase] and glints [kind][frame]; cloud frames by shape. */
  private shimmer: Record<ShimmerKind, (Phaser.Textures.Frame | undefined)[][]> | null = null;
  private glintFrames: Record<ShimmerKind, (Phaser.Textures.Frame | undefined)[]> | null = null;
  private cloudFrames: (Phaser.Textures.Frame | undefined)[] = [];
  // layers (created lazily: a map without water or clouds never makes those blitters)
  private airBl: Phaser.GameObjects.Blitter | null = null;
  private glowBl: Phaser.GameObjects.Blitter | null = null;
  private puddleBl: Phaser.GameObjects.Blitter | null = null;
  private cloudBl: Phaser.GameObjects.Blitter | null = null;
  private waterBl: Phaser.GameObjects.Blitter | null = null;
  private air: AirSim | null = null;
  /** The bob of each air particle (same index), on the AIR or the GLOW blitter by kind. */
  private airBobs: Phaser.GameObjects.Bob[] = [];
  private lastLayout = '';
  private puddleBobs: Phaser.GameObjects.Bob[] = [];
  private puffs: PuffSim | null = null;
  private puffBobs: Phaser.GameObjects.Bob[] = [];
  private clouds: CloudSim | null = null;
  private cloudBobs: Phaser.GameObjects.Bob[] = [];
  // water
  private waterCells = 0;
  private waterWin = '';
  private waterBobs: Phaser.GameObjects.Bob[] = [];
  private waterLive: { bob: Phaser.GameObjects.Bob; h: number; kind: ShimmerKind }[] = [];
  private openCells: { X: number; Y: number; kind: ShimmerKind }[] = [];
  private glints: Glint[] = [];
  private glintRnd: () => number;
  // hot cells (lava / ember ground) in the current window
  private hotWin = '';
  private hotCells: number[] = [];
  private warmCells: number[] = [];
  private readonly hasHot: boolean;
  // idle props (tracked: every image already looked at, so the periodic rescan only adds images made later)
  private idle: IdleEntry[] = [];
  private tracked = new WeakSet<Phaser.GameObjects.GameObject>();
  private idleT = 0;
  private idleOn = false;
  private idleShown = 0;
  private idleSteps = 0;
  private ms = 0;
  private peakMs = 0;
  private readonly unsub: () => void;
  private readonly onPost = (_time: number, delta: number) => this.update(delta);

  constructor(
    private readonly scene: AmbientHost,
  ) {
    const def = scene.def;
    this.profile = ambientProfile(def);
    this.seed = def.seed >>> 0;
    this.webgl = !!(scene.sys.renderer as { gl?: unknown }).gl;
    this.glintRnd = mulberry32(hashSeed(this.seed, 'ambient-glint'));
    const cm = scene.cm;
    let hot = false;
    for (let i = 0; i < cm.ground.length && !hot; i++) hot = cm.ground[i] === T.LAVA || cm.ground[i] === T.EMBER;
    this.hasHot = hot;
    this.collectIdle();
    this.applyTier();
    this.unsub = onAmbientQuality(() => this.applyTier());
    scene.events.on('postupdate', this.onPost);
    scene.events.once('shutdown', () => this.destroy());
  }

  // ---------------------------------------------------------------- setup

  private frame(key: string, name: string): Phaser.Textures.Frame | undefined {
    let m = this.frames.get(key);
    if (!m) this.frames.set(key, (m = new Map()));
    let f = m.get(name);
    if (!f && this.scene.textures.exists(key)) {
      f = this.scene.textures.getFrame(key, name) ?? undefined;
      if (f) m.set(name, f);
    }
    return f;
  }

  private waterTables(): void {
    if (this.shimmer) return;
    const kinds: ShimmerKind[] = ['water', 'deep'];
    const sh = {} as Record<ShimmerKind, (Phaser.Textures.Frame | undefined)[][]>;
    const gl = {} as Record<ShimmerKind, (Phaser.Textures.Frame | undefined)[]>;
    for (const k of kinds) {
      sh[k] = Array.from({ length: SHIMMER_VARIANTS }, (_, v) => Array.from({ length: SHIMMER_PHASES }, (_, p) => this.frame(AMB_WATER, `${k}_${v}_${p}`)));
      gl[k] = Array.from({ length: GLINT_FRAMES }, (_, f) => this.frame(AMB_WATER, `glint_${k}_${f}`));
    }
    this.shimmer = sh;
    this.glintFrames = gl;
  }

  /** Every image on the map whose texture is an idle strip (dressing, props, apron props, campfires, doors). */
  private collectIdle(): void {
    for (const go of this.scene.children.list) if (go.type === 'Image') this.track(go);
  }

  /** Starts stepping one image if its texture is an idle strip (once per image; a door drawn later joins too). */
  private track(go: Phaser.GameObjects.GameObject): void {
    if (this.tracked.has(go)) return;
    this.tracked.add(go);
    const img = go as Phaser.GameObjects.Image;
    const key = img.texture?.key;
    const anim = key ? IDLE[key] : undefined;
    if (!anim || !this.scene.textures.exists(key)) return;
    // a texture drawn before strips existed (hot reload) has no frame 1: leave it still
    if (!img.texture.has(1 as unknown as string)) return;
    const mirror = anim.mirror;
    const alt = img.flipX && mirror !== undefined && img.texture.has(mirror as unknown as string) ? mirror : 1;
    const h = hash32(Math.round(img.x), Math.round(img.y), this.seed);
    this.idle.push({ img, anim, h, stiff: key in WORLD_IDLE ? 0.66 : 0.5, cur: 0, alt });
  }

  /** Chimneys (from the structure images actually placed) and campfires (their images). */
  private collectEmitters(): Emitter[] {
    const out: Emitter[] = [];
    for (const go of this.scene.children.list) {
      if (go.type !== 'Image') continue;
      const img = go as Phaser.GameObjects.Image;
      const key = img.texture?.key;
      if (!key) continue;
      const mouths = STRUCTURE_SMOKE[key];
      if (mouths) {
        const left = img.x - img.displayOriginX;
        const top = img.y - img.displayOriginY;
        for (const [mx, my, darkSmoke] of mouths)
          // the first puff sits on the cap's mouth (smoke draws over the roof)
          out.push({ x: Math.round(img.flipX ? left + img.width - 1 - mx : left + mx), y: Math.round(top + my + 2), kind: darkSmoke ? 'smokedark' : 'smoke', next: 0 });
      } else if (key === 'obj_campfire') out.push({ x: Math.round(img.x), y: Math.round(img.y - img.displayOriginY + 8), kind: 'spark', next: 0 });
    }
    return out;
  }

  private blitter(key: string, depth: number): Phaser.GameObjects.Blitter {
    return this.scene.add.blitter(0, 0, key).setDepth(depth);
  }

  /** (Re)applies the tier: creates the layers it needs, parks the rest. */
  private applyTier(): void {
    if (this.destroyed) return;
    this.tier = effectiveTier(this.webgl);
    this.tierSpec = AMBIENT_TIERS[this.tier];
    const s = this.tierSpec;
    const scene = this.scene;
    const wantAir = s.air > 0 && this.profile.air.length > 0;
    const wantClouds = s.clouds && this.profile.clouds > 0;
    const wantWater = s.water > 0 || s.glints > 0;
    if (wantAir || wantClouds || wantWater || s.smoke > 0) {
      drawAmbientFx(scene);
      if (wantWater) drawWaterShimmer(scene);
    }
    // air
    if (wantAir && !this.air) {
      this.air = new AirSim(this.profile.air, this.seed, this.profile.wind, (k, r) => this.hotPoint(k, r));
      this.airBl = this.blitter(AMB_FX, AMBIENT_DEPTH.AIR);
      if (this.profile.air.some((a) => EMISSIVE.has(a.kind))) this.glowBl = this.blitter(AMB_FX, AMBIENT_DEPTH.GLOW);
      if (this.profile.air.some((a) => a.kind === 'rain')) this.puddleBl = this.blitter(AMB_FX, AMBIENT_DEPTH.PUDDLE);
    }
    // smoke & sparks
    if (s.smoke > 0 && !this.puffs) {
      const em = this.collectEmitters();
      if (em.length) {
        this.puffs = new PuffSim(em, this.seed, this.profile.wind);
        if (!this.airBl) this.airBl = this.blitter(AMB_FX, AMBIENT_DEPTH.AIR);
      }
    }
    // clouds
    if (wantClouds && !this.clouds) {
      this.clouds = new CloudSim(this.seed, this.profile.wind);
      this.cloudBl = this.blitter(AMB_CLOUD, AMBIENT_DEPTH.CLOUD).setBlendMode(MULTIPLY);
    }
    this.cloudBl?.setVisible(wantClouds);
    // water (the window rebuilds on the next frame)
    if (wantWater && !this.waterBl && this.mapHasWater()) this.waterBl = this.blitter(AMB_WATER, AMBIENT_DEPTH.WATER);
    this.waterBl?.setVisible(wantWater);
    this.waterWin = '';
    // idle frames: back to the still look when off
    if (!s.idle && this.idleOn) for (const e of this.idle) this.setIdle(e, 0);
    this.idleOn = s.idle;
    // the next frame re-lays the air out for the new density (also after a change made while the world was paused)
    this.lastLayout = '';
    if (!wantAir) {
      this.air?.layout(this.view(), 0);
      for (const b of this.airBobs) if (b.visible) b.setVisible(false);
      for (const b of this.puddleBobs) if (b.visible) b.setVisible(false);
    }
    // a layer with nothing to draw at this tier is hidden outright (no empty batches)
    this.airBl?.setVisible(wantAir || s.smoke > 0);
    this.glowBl?.setVisible(wantAir);
    this.puddleBl?.setVisible(wantAir);
    if (s.smoke <= 0) {
      for (const p of this.puffs?.puffs ?? []) p.on = false;
      for (const b of this.puffBobs) if (b.visible) b.setVisible(false);
    }
    if (!s.idle) this.idleShown = 0;
  }

  private mapHasWater(): boolean {
    const g = this.scene.cm.ground;
    for (let i = 0; i < g.length; i++) if (g[i] === T.WATER || g[i] === T.DEEP) return true;
    return false;
  }

  // ---------------------------------------------------------------- frame

  private view(): View {
    const cam = this.scene.cameras.main;
    return { x: cam.scrollX, y: cam.scrollY, w: cam.width, h: cam.height };
  }

  private update(deltaMs: number): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    const dt = Math.min(Math.max(0, deltaMs), 50) / 1000;
    this.t += dt;
    const t = this.t;
    const v = this.view();
    // the VFX governor's free level (governorScale) scales the air density, re-read once a second
    if ((this.govT -= dt) <= 0) {
      this.govT = 1;
      this.governor = governorScale((this.scene as unknown as { vfx?: { runtime?: GovernorLike } }).vfx?.runtime);
      this.rescan();
    }
    const s = this.tierSpec;
    const density = this.pinned ?? s.air * this.governor;
    if (this.air && this.airBl) {
      const lk = `${v.w}x${v.h}@${density}`;
      if (lk !== this.lastLayout) {
        this.lastLayout = lk;
        this.air.layout(v, density);
      }
      this.air.step(dt, t, v);
      this.syncAir();
    }
    if (this.puffs && this.airBl) {
      this.puffs.step(dt, t, v, this.pinned !== null ? Math.max(0.25, this.pinned) : s.smoke * Math.max(0.5, this.governor));
      this.syncPuffs();
    }
    if (this.clouds && this.cloudBl?.visible) {
      this.clouds.step(dt, t, v);
      this.syncClouds();
    }
    if (this.waterBl?.visible) this.updateWater(v, t, dt);
    if (this.idleOn && (this.idleT -= dt) <= 0) {
      this.idleT = IDLE_TICK;
      this.updateIdle(v, t);
    }
    const ms = performance.now() - t0;
    this.ms = this.ms * 0.95 + ms * 0.05;
    if (ms > this.peakMs) this.peakMs = ms;
  }

  /**
   * Every 2 s, one pass over the display list: a light map / darkness covering the map lifts the emissive layer above
   * it (fireflies glow through the night), and idle-strip images made since (a portal door redrawn when a gate opens
   * or a hidden way is revealed) start stepping.
   */
  private rescan(): void {
    if ((this.darkT -= 1) > 0) return;
    this.darkT = 2;
    let dark = false;
    for (const go of this.scene.children.list) {
      if (go.type === 'Image') this.track(go);
      const d = (go as unknown as { depth: number; visible: boolean }).depth;
      if (d >= DEPTH.DARKNESS && d < DEPTH.LIGHT && (go as unknown as { visible: boolean }).visible) dark = true;
    }
    if (dark !== this.dark) {
      this.dark = dark;
      this.glowBl?.setDepth(dark ? DEPTH.LIGHT : AMBIENT_DEPTH.GLOW);
    }
  }

  private bobFor(list: Phaser.GameObjects.Bob[], i: number, bl: Phaser.GameObjects.Blitter, frame: Phaser.Textures.Frame): Phaser.GameObjects.Bob {
    let b = list[i];
    if (!b) {
      b = bl.create(0, 0, frame);
      list[i] = b;
    }
    return b;
  }

  private place(b: Phaser.GameObjects.Bob, x: number, y: number, frame: Phaser.Textures.Frame | undefined): void {
    if (!frame) {
      if (b.visible) b.setVisible(false);
      return;
    }
    if (bobFrame(b) !== frame) b.setFrame(frame);
    b.x = x;
    b.y = y;
    if (!b.visible) b.setVisible(true);
  }

  private syncAir(): void {
    const air = this.air!;
    const parts = air.parts;
    // bobs are bound to particles by index; emissive kinds live on the GLOW blitter
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      const f = this.frame(AMB_FX, p.frame);
      if (!f) continue;
      const bl = EMISSIVE.has(p.kind) && this.glowBl ? this.glowBl : this.airBl!;
      const b = this.bobFor(this.airBobs, i, bl, f);
      if (!p.on) {
        if (b.visible) b.setVisible(false);
        continue;
      }
      // the frame's origin is its top-left: centre small particles on their point
      this.place(b, p.px - (f.width >> 1), p.py - (f.height >> 1), f);
    }
    if (this.puddleBl) {
      const qs = air.puddles;
      for (let i = 0; i < qs.length; i++) {
        const q = qs[i];
        const f = this.frame(AMB_FX, q.frame);
        if (!f) continue;
        const b = this.bobFor(this.puddleBobs, i, this.puddleBl, f);
        if (!q.on) {
          if (b.visible) b.setVisible(false);
          continue;
        }
        this.place(b, q.x - (f.width >> 1), q.y - (f.height >> 1), f);
      }
    }
  }

  private syncPuffs(): void {
    const ps = this.puffs!.puffs;
    for (let i = 0; i < ps.length; i++) {
      const p = ps[i];
      const f = this.frame(AMB_FX, p.frame);
      if (!f) continue;
      const b = this.bobFor(this.puffBobs, i, this.airBl!, f);
      if (!p.on) {
        if (b.visible) b.setVisible(false);
        continue;
      }
      // puffs sit on their point by the bottom-centre (they grow upward from the chimney mouth)
      this.place(b, p.px - (f.width >> 1), p.py - f.height + 1, f);
    }
  }

  private syncClouds(): void {
    const cs = this.clouds!.clouds;
    const a = this.profile.clouds;
    for (let i = 0; i < cs.length; i++) {
      const c = cs[i];
      const f = (this.cloudFrames[c.shape] ??= this.frame(AMB_CLOUD, `cloud_${c.shape}`));
      if (!f) continue;
      const b = this.bobFor(this.cloudBobs, i, this.cloudBl!, f);
      if (b.alpha !== a) b.setAlpha(a);
      this.place(b, c.px, c.py, f);
    }
    for (let i = cs.length; i < this.cloudBobs.length; i++) if (this.cloudBobs[i].visible) this.cloudBobs[i].setVisible(false);
  }

  // ---------------------------------------------------------------- hot cells

  private refreshHot(v: View): void {
    const x0 = Math.floor(v.x / TILE) - 1;
    const y0 = Math.floor(v.y / TILE) - 1;
    const x1 = Math.ceil((v.x + v.w) / TILE) + 1;
    const y1 = Math.ceil((v.y + v.h) / TILE) + 1;
    const key = `${x0},${y0},${x1},${y1}`;
    if (key === this.hotWin) return;
    this.hotWin = key;
    const cm = this.scene.cm;
    this.hotCells.length = 0;
    this.warmCells.length = 0;
    for (let Y = Math.max(0, y0); Y < Math.min(cm.h, y1); Y++)
      for (let X = Math.max(0, x0); X < Math.min(cm.w, x1); X++) {
        const g = cm.ground[Y * cm.w + X];
        if (g === T.LAVA) this.hotCells.push(Y * cm.w + X);
        else if (g === T.EMBER) this.warmCells.push(Y * cm.w + X);
      }
  }

  private hotPoint(kind: 'ember' | 'heat', r: () => number): { x: number; y: number } | null {
    if (!this.hasHot) return null;
    this.refreshHot(this.view());
    const list = this.hotCells.length ? this.hotCells : kind === 'heat' ? this.warmCells : null;
    if (!list || !list.length) return null;
    const i = list[Math.floor(r() * list.length)];
    const w = this.scene.cm.w;
    return { x: (i % w) * TILE + 2 + r() * (TILE - 4), y: Math.floor(i / w) * TILE + 4 + r() * (TILE - 6) };
  }

  // ---------------------------------------------------------------- water

  private updateWater(v: View, t: number, dt: number): void {
    const bl = this.waterBl!;
    const s = this.tierSpec;
    const x0 = Math.floor(v.x / TILE) - 1;
    const y0 = Math.floor(v.y / TILE) - 1;
    const x1 = Math.ceil((v.x + v.w) / TILE);
    const y1 = Math.ceil((v.y + v.h) / TILE);
    const key = `${x0},${y0},${x1},${y1},${s.water}`;
    if (key !== this.waterWin) {
      this.waterWin = key;
      const cm = this.scene.cm;
      this.openCells.length = 0;
      this.waterLive.length = 0;
      let n = 0;
      for (let Y = y0; Y <= y1; Y++)
        for (let X = x0; X <= x1; X++) {
          const kind = openWater(cm, X, Y);
          if (!kind) continue;
          this.openCells.push({ X, Y, kind });
          const h = hash32(X, Y, this.seed);
          // medium tier: a dithered half of the cells (never a checkerboard of whole tiles in one phase)
          if (s.water < 1 && (h >>> 8) % 100 >= s.water * 100) continue;
          this.waterTables();
          const first = this.shimmer![kind][0][0];
          if (!first) continue;
          const b = this.bobFor(this.waterBobs, n++, bl, first);
          // nudged off the tile grid (open water: every neighbour is the same water, so the nudge stays on it)
          const [ox, oy] = shimmerNudge(h);
          b.x = X * TILE + ox;
          b.y = Y * TILE + oy;
          b.flipX = ((h >>> 12) & 1) === 1;
          if (!b.visible) b.setVisible(true);
          this.waterLive.push({ bob: b, h, kind });
        }
      for (let i = n; i < this.waterBobs.length; i++) if (this.waterBobs[i].visible) this.waterBobs[i].setVisible(false);
      this.waterCells = n;
    }
    const tables = this.shimmer;
    if (tables)
      for (const w of this.waterLive) {
        const { variant, phase } = shimmerAt(w.h, t);
        const f = tables[w.kind][variant][phase];
        if (f && bobFrame(w.bob) !== f) w.bob.setFrame(f);
      }
    this.updateGlints(dt, s.glints);
  }

  /** Sparkles popping on random open-water cells in view (seeded): speck → cross → star → cross → speck, then a rest. */
  private updateGlints(dt: number, rate: number): void {
    const want = Math.min(AMBIENT_CAPS.glints, Math.round(this.openCells.length * 0.12 * rate));
    while (this.glints.length < want) this.glints.push({ on: false, bob: null, kind: 'water', x: 0, y: 0, age: 0, wait: this.glintRnd() * 1.2 });
    const r = this.glintRnd;
    for (let i = 0; i < this.glints.length; i++) {
      const g = this.glints[i];
      if (i >= want || !this.openCells.length) {
        if (g.bob?.visible) g.bob.setVisible(false);
        g.on = false;
        continue;
      }
      if (!g.on) {
        if ((g.wait -= dt) > 0) continue;
        const c = this.openCells[Math.floor(r() * this.openCells.length)];
        g.on = true;
        g.kind = c.kind;
        g.x = c.X * TILE + 3 + Math.floor(r() * (TILE - 10));
        g.y = c.Y * TILE + 3 + Math.floor(r() * (TILE - 10));
        g.age = 0;
      }
      g.age += dt;
      const k = Math.floor(g.age / GLINT_STEP);
      if (k >= GLINT_SEQ.length) {
        g.on = false;
        g.wait = 0.4 + r() * 1.4;
        if (g.bob?.visible) g.bob.setVisible(false);
        continue;
      }
      this.waterTables();
      const f = this.glintFrames![g.kind][Math.min(GLINT_FRAMES - 1, GLINT_SEQ[k])];
      if (!f) continue;
      if (!g.bob) g.bob = this.waterBl!.create(0, 0, f);
      this.place(g.bob, g.x, g.y, f);
    }
  }

  // ---------------------------------------------------------------- idle frames

  private setIdle(e: IdleEntry, f: number): void {
    if (e.cur === f) return;
    e.cur = f;
    if (e.img.scene) e.img.setFrame(f, false, false);
  }

  private updateIdle(v: View, t: number): void {
    const left = v.x - 48;
    const right = v.x + v.w + 48;
    const top = v.y - 16;
    const bottom = v.y + v.h + 96;
    let shown = 0;
    const list = this.idle;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const img = e.img;
      if (!img.scene) {
        // destroyed (a portal door replaced, a node re-made): drop it
        list[i] = list[list.length - 1];
        list.pop();
        i--;
        continue;
      }
      if (!img.visible || img.x < left || img.x > right || img.y < top || img.y > bottom) continue;
      shown++;
      const k = idleFrame(e.anim, t, img.x, img.y, e.h, e.stiff);
      const f = k === 1 ? e.alt : k;
      if (f !== e.cur) {
        this.setIdle(e, f);
        this.idleSteps++;
      }
    }
    this.idleShown = shown;
  }

  // ---------------------------------------------------------------- QA

  stats(): AmbientStats {
    let bobs = 0;
    let blitters = 0;
    for (const bl of [this.airBl, this.glowBl, this.puddleBl, this.cloudBl, this.waterBl]) {
      if (!bl || !bl.visible) continue;
      blitters++;
      for (const b of bl.children.list) if (b.visible) bobs++;
    }
    return {
      tier: this.tier,
      clock: +this.t.toFixed(3),
      density: this.pinned ?? this.tierSpec.air * this.governor,
      governor: this.governor,
      air: this.air?.live ?? 0,
      puddles: this.air?.puddles.filter((q) => q.on).length ?? 0,
      puffs: this.puffs?.live ?? 0,
      emitters: this.puffs?.emitters.length ?? 0,
      water: this.waterBl?.visible ? this.waterCells : 0,
      glints: this.waterBl?.visible ? this.glints.filter((g) => g.on).length : 0,
      clouds: this.cloudBl?.visible ? (this.clouds?.clouds.length ?? 0) : 0,
      idle: { total: this.idle.length, shown: this.idleShown, steps: this.idleSteps },
      blitters,
      bobs,
      ms: +this.ms.toFixed(3),
      peakMs: +this.peakMs.toFixed(3),
      dark: this.dark,
    };
  }

  resetPeaks(): void {
    this.peakMs = 0;
    this.idleSteps = 0;
  }

  /** QA: pins the air density (0..1+), null = tier × governor. */
  pin(d: number | null): void {
    this.pinned = d;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.unsub();
    this.scene.events.off('postupdate', this.onPost);
    for (const bl of [this.airBl, this.glowBl, this.puddleBl, this.cloudBl, this.waterBl]) bl?.destroy();
    this.airBl = this.glowBl = this.puddleBl = this.cloudBl = this.waterBl = null;
    this.airBobs = [];
    this.puddleBobs = [];
    this.puffBobs = [];
    this.cloudBobs = [];
    this.waterBobs = [];
    this.waterLive = [];
    this.glints = [];
    this.idle = [];
    this.tracked = new WeakSet();
    this.frames.clear();
    if (current === this) current = null;
  }
}

let current: Ambient | null = null;

/** QA handle: window.omnipath.ambient. */
const debugApi = {
  stats: () => current?.stats() ?? null,
  resetPeaks: () => current?.resetPeaks(),
  setQuality: (tier: AmbientTier | null) => setAmbientQuality(tier),
  quality: () => ambientQuality(),
  pin: (d: number | null) => current?.pin(d),
};

/**
 * Builds the map's living world (call once in MapScene.create(), after the stage, objects and portals exist).
 * Returns the disposer (it also tears itself down on the scene's SHUTDOWN; calling both is safe).
 */
export function attachAmbient(scene: AmbientHost): () => void {
  const amb = new Ambient(scene);
  current = amb;
  if (typeof window !== 'undefined') {
    const w = window as unknown as { omnipath?: Record<string, unknown> };
    if (w.omnipath && typeof w.omnipath === 'object') w.omnipath.ambient = debugApi;
  }
  return () => amb.destroy();
}
