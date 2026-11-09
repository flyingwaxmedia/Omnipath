// Placement maths for the VFX runtime (docs/VFX.md §5, §6.2-6.4 VfxPlacement): where the instances of a piece go
// and how motes move. Pure (no Phaser), seeded from the per-cast stream, so a replay places the same pixels.
import type { Pt, VfxPiece, VfxPlacement } from '../types';

export type Rng = () => number;

const TAU = Math.PI * 2;
const GOLDEN = 2.39996;

/** One placed instance: offset from the anchor (px), extra start delay (ms). */
export interface Spot {
  x: number;
  y: number;
  delay: number;
}

/** Instance count after the quota and the governor (patterns that need at least one keep one). */
export function scaledCount(pl: VfxPlacement | undefined, quota: number, quality: number, cap = 24): number {
  const n = pl?.count ?? 1;
  return Math.max(1, Math.min(cap, Math.round(n * quota * quality)));
}

/**
 * Static spots for a non-mote piece (units, puffs, status units, decals). Moving patterns (orbit, spiral, streaming
 * bursts) get their start here and their motion from `spotMotion`.
 */
export function spots(p: VfxPiece, n: number, ang: number, rng: Rng): Spot[] {
  const pl = p.place;
  if (!pl) return [{ x: 0, y: 0, delay: 0 }];
  const R = pl.radius ?? 0;
  const asp = pl.aspect ?? 1;
  const stagger = pl.staggerMs ?? 0;
  const out: Spot[] = [];
  const sun = (k: number, rad: number): Pt => {
    const r = rad * Math.sqrt((k + 0.5) / n);
    const a = k * GOLDEN + rng() * 0.6;
    return { x: r * Math.cos(a), y: r * Math.sin(a) * asp };
  };
  for (let k = 0; k < n; k++) {
    let x = 0;
    let y = 0;
    let delay = k * stagger;
    switch (pl.pattern) {
      case 'single':
        x = (k - (n - 1) / 2) * 8;
        break;
      case 'burst': {
        const spread = pl.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : TAU;
        const a = pl.spreadDeg ? ang - spread / 2 + (spread * (k + 0.5)) / n : (k / n) * TAU + rng() * 0.5;
        const d = pl.speed ? 0 : (R || 8) * (0.6 + 0.4 * rng());
        x = Math.cos(a) * d;
        y = Math.sin(a) * d * asp;
        break;
      }
      case 'poisson':
      case 'lattice':
      case 'fall': {
        const s = sun(k, R || 10);
        x = s.x;
        y = s.y - (pl.pattern === 'fall' ? 8 : 0);
        if (pl.wave && R > 0) {
          const d = Math.min(0.999, Math.hypot(x, y / asp) / R);
          delay += Math.round(150 * (1 - Math.cbrt(1 - d)));
        }
        break;
      }
      case 'rim':
        if (R) {
          const spread = pl.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : TAU;
          const a = pl.spreadDeg ? ang - spread / 2 + (spread * (k + 0.5)) / n : (k / n) * TAU;
          x = Math.cos(a) * R;
          y = Math.sin(a) * R * asp;
        } else {
          // Status units on the silhouette's top edge.
          x = (k - (n - 1) / 2) * 7;
          y = Math.abs(k - (n - 1) / 2) * 2;
        }
        break;
      case 'rise':
        x = ((k * 5) % 9) - 4;
        y = -k * 7;
        break;
      case 'stack':
        x = (k - (n - 1) / 2) * (R ? Math.min(12, (2 * R) / n) : 9);
        y = -(k % 2) * 5;
        break;
      case 'line': {
        const lateral = pl.spacing ? [-pl.spacing / 2, pl.spacing / 2] : [0];
        const per = Math.max(1, Math.ceil(n / lateral.length));
        const side = lateral[k % lateral.length];
        const j = Math.floor(k / lateral.length);
        const d = ((R || 24) * (j + 0.5)) / per;
        x = Math.cos(ang) * d - Math.sin(ang) * side;
        y = Math.sin(ang) * d + Math.cos(ang) * side;
        break;
      }
      case 'orbit':
      case 'spiral':
      case 'converge':
      case 'path':
      case 'trail':
        break;
    }
    out.push({ x: Math.round(x), y: Math.round(y), delay });
  }
  return out;
}

/** Live offset of a moving non-mote instance at age t (ms) (orbits, spirals, streaming puffs); null = static. */
export function spotMotion(p: VfxPiece, k: number, n: number, t: number, ang: number): Pt | null {
  const pl = p.place;
  if (!pl) return null;
  const R = pl.radius ?? 8;
  switch (pl.pattern) {
    case 'orbit': {
      const a = (k / n) * TAU + t / 300;
      return { x: Math.round(Math.cos(a) * R), y: Math.round(Math.sin(a) * R * 0.35) };
    }
    case 'spiral': {
      const life = p.lifeMs ?? 400;
      const r = R * Math.max(0, 1 - t / life);
      const a = k * 0.9 + t / 120;
      return { x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r * (pl.aspect ?? 1)) };
    }
    case 'burst':
      if (pl.speed) {
        const spread = pl.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : TAU;
        const a = pl.spreadDeg ? ang - spread / 2 + (spread * (k + 0.5)) / n : (k / n) * TAU;
        const d = Math.min(R, (pl.speed * t) / 1000);
        return { x: Math.round(Math.cos(a) * d), y: Math.round(Math.sin(a) * d * (pl.aspect ?? 1)) };
      }
      return null;
    default:
      return null;
  }
}

/** A mote particle's launch (closed form: p(t) = p0 + v (1 - e^(-kt)) / k + g t² / 2). */
export interface Launch {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Drag (1/s). */
  k: number;
  /** Gravity (px/s²). */
  g: number;
  life: number;
  delay: number;
  /** Orbit / spiral / converge / path particles follow the anchor and a parametric path instead. */
  mode: 'free' | 'orbit' | 'spiral' | 'converge' | 'path';
  /** Parametric path data (orbit radius / phase, path bow). */
  a: number;
  r: number;
  /** Orbit / spiral ground aspect (the placement's; the hand orbit defaults to 0.5). */
  asp?: number;
}

/** Launch parameters for mote k of n. `to` is the stream target (path pattern: back to the caster). */
export function launch(p: VfxPiece, k: number, n: number, ang: number, rng: Rng, life: number): Launch {
  const pl = p.place;
  const R = pl?.radius ?? 0;
  const asp = pl?.aspect ?? 1;
  const stagger = pl?.staggerMs ?? 0;
  const base: Launch = { x: 0, y: 0, vx: 0, vy: 0, k: 0, g: 0, life, delay: k * stagger, mode: 'free', a: 0, r: 0 };
  switch (pl?.pattern ?? 'single') {
    case 'burst': {
      const spread = pl?.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : TAU;
      const a = pl?.spreadDeg ? ang - spread / 2 + spread * ((k + 0.5) / n) + (rng() - 0.5) * (spread / n) : (k / n) * TAU + rng() * 0.6;
      if (pl?.speed) {
        // Streams (breath cones): straight to the range at the given speed.
        const v = pl.speed * (0.8 + 0.4 * rng());
        return { ...base, vx: Math.cos(a) * v, vy: Math.sin(a) * v * asp, life: Math.min(life, ((R || 60) / v) * 1000 + 60), delay: Math.round(rng() * 60) };
      }
      const dist = (R || 14 + 8 * rng()) * (0.6 + 0.4 * rng());
      const kk = 9;
      return { ...base, vx: Math.cos(a) * dist * kk, vy: Math.sin(a) * dist * kk * asp, k: kk, g: 30 };
    }
    case 'rise': {
      const r = R || 8;
      const a = rng() * TAU;
      return { ...base, x: Math.cos(a) * r, y: Math.sin(a) * r * asp * 0.5, vx: (rng() - 0.5) * 12, vy: -(28 + 26 * rng()), k: 0.5 };
    }
    case 'fall':
      return { ...base, x: (rng() - 0.5) * (R || 10) * 2, y: -10 - rng() * 6, vx: (rng() - 0.5) * 8, vy: 20, g: 160 };
    case 'orbit':
      return { ...base, mode: 'orbit', a: (k / n) * TAU, r: R || 10, asp: pl?.aspect ?? 0.5 };
    case 'spiral':
      return { ...base, mode: 'spiral', a: (k / n) * TAU + rng(), r: R || 24, asp: pl?.aspect ?? 0.65 };
    case 'converge':
      return { ...base, mode: 'converge', a: (k / n) * TAU, r: R || 24 };
    case 'rim': {
      const spread = pl?.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : TAU;
      const a = pl?.spreadDeg ? ang - spread / 2 + (spread * (k + 0.5)) / n : (k / n) * TAU;
      const r = R || 12;
      return { ...base, x: Math.cos(a) * r, y: Math.sin(a) * r * asp, vx: Math.cos(a) * 14, vy: Math.sin(a) * 14 - 6, k: 3 };
    }
    case 'line': {
      const lateral = pl?.spacing ? [-pl.spacing / 2, pl.spacing / 2] : [0];
      const side = lateral[k % lateral.length];
      const per = Math.max(1, Math.ceil(n / lateral.length));
      const d = ((R || 24) * (Math.floor(k / lateral.length) + 0.5)) / per;
      return {
        ...base,
        x: Math.cos(ang) * d - Math.sin(ang) * side,
        y: Math.sin(ang) * d + Math.cos(ang) * side,
        vx: Math.cos(ang) * 40,
        vy: Math.sin(ang) * 40,
        k: 6,
        delay: Math.round((k / n) * 90),
      };
    }
    case 'path':
      return { ...base, mode: 'path', a: (rng() < 0.5 ? -1 : 1) * (8 + 8 * rng()), r: 0 };
    case 'poisson':
    case 'lattice': {
      const r = (R || 10) * Math.sqrt((k + 0.5) / n);
      const a = k * GOLDEN;
      return { ...base, x: Math.cos(a) * r, y: Math.sin(a) * r * asp, vy: -10, k: 1 };
    }
    case 'trail':
      return { ...base, x: (rng() - 0.5) * 3, y: (rng() - 0.5) * 3, vx: (rng() - 0.5) * 10, vy: -8 - rng() * 8, k: 2 };
    case 'single':
    case 'stack':
    default:
      return { ...base, vy: -6, k: 1 };
  }
}

/** Closed-form position of a free particle at age t (ms). */
export function freePos(l: Launch, t: number): Pt {
  const s = t / 1000;
  const f = l.k > 0 ? (1 - Math.exp(-l.k * s)) / l.k : s;
  return { x: l.x + l.vx * f, y: l.y + l.vy * f + 0.5 * l.g * s * s };
}
