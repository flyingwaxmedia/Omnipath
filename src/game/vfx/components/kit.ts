// Shared template plumbing (package P): the frame strip builder with the finalize passes every template shares,
// geometry keys and seeds, and small family marks used by several components.
import { hashSeed, mulberry32 } from '../../../core/rng';
import { IDX, quantMs, type BakeOptions, type DirCount, type FamilyId, type IndexFrame, type StripUse } from '../types';
import { Painter, type FrameKind, type PFrame } from '../painter';
import { ELEMENT_GLYPHS, rune } from '../glyphs';

/**
 * What templates receive as options: BakeOptions plus the piece's anchor half. bake.ts passes `piece.anchor.half`, so a
 * ring or aura piece with half 'back' bakes only its far half (y < anchor) and 'front' only the near half.
 */
export interface TemplateOptions extends BakeOptions {
  half?: 'back' | 'front';
}

export type Rng = () => number;

/** hashSeed('vfx', geometryKey, u) (docs/VFX.md §10.2): output never depends on bake order or on the skill. */
export function seedOf(key: string, u: number): number {
  return hashSeed('vfx', key, u);
}

/** `${component}|${sorted bake params}|${motif if used}|kl${keyline}|rf${reduceFlash}` (+ `|h${half}` when set). */
export function mkKey(component: string, fields: Record<string, unknown>, motif: FamilyId | null, opts: TemplateOptions, half = false): string {
  const parts = Object.keys(fields)
    .filter((k) => fields[k] !== undefined)
    .sort()
    .map((k) => {
      const v = fields[k];
      return `${k}=${Array.isArray(v) ? v.join('/') : String(v)}`;
    });
  let key = `${component}|${parts.join(',')}|${motif ?? ''}|kl${opts.keyline ? 1 : 0}|rf${opts.reduceFlash ? 1 : 0}`;
  if (half && opts.half) key += `|h${opts.half}`;
  return key;
}

/** Heading of unique direction u (0 = east; unique bakes cover east -> south). */
export function headingOf(u: number, dirs: DirCount): number {
  return dirs === 1 ? 0 : (u * Math.PI * 2) / dirs;
}

export interface StripCfg {
  /** Matter templates carry their own #24180f outline; the biome keyline is skipped for them. */
  matter?: boolean;
  /** Remove lone pixels outside the last two non-empty frames (one-shots) or in every frame (loops). */
  orphans?: boolean;
  /** Emissive dilation source: 'hot' = R5 + WHITE, 'bright' = R4 + R5 + WHITE, 'none' = only explicit glow. */
  glowFrom?: 'hot' | 'bright' | 'none';
}

const HOT = (i: number) => i === IDX.R5 || i === IDX.WHITE;
const BRIGHT = (i: number) => i === IDX.R4 || i === IDX.R5 || i === IDX.WHITE;

/**
 * Collects the frames of one strip (one unique direction). `done(use)` applies the shared finalize passes:
 * reduce-flash (drop contrast and blank frames, WHITE -> R5), orphan removal, the biome keyline, glow dilation, VSYNC
 * frame times and the empty final frame of one-shots.
 */
export class Strip {
  readonly frames: PFrame[] = [];
  readonly rng: Rng;
  readonly bx: number;
  readonly by: number;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly ox: number,
    readonly oy: number,
    readonly seed: number,
    readonly opts: TemplateOptions,
    readonly cfg: StripCfg = {},
  ) {
    this.w = Math.max(1, Math.round(w));
    this.h = Math.max(1, Math.round(h));
    this.ox = Math.round(ox);
    this.oy = Math.round(oy);
    this.rng = mulberry32(seed);
    this.bx = seed & 3;
    this.by = (seed >>> 2) & 3;
  }

  /** A fresh painter for one frame (same anchor and Bayer origin for every frame of the strip). */
  painter(heading = 0): Painter {
    return new Painter(this.w, this.h, this.ox, this.oy, this.bx, this.by).heading(heading);
  }

  /** Draw one frame. */
  add(ms: number, draw: (p: Painter, rnd: Rng) => void, kind: FrameKind = 'normal', heading = 0): void {
    const p = this.painter(heading);
    draw(p, this.rng);
    this.frames.push(p.frame(ms, kind));
  }

  /** An empty frame inside the strip (electric flicker); dropped by reduce-flash. */
  blank(ms: number): void {
    this.frames.push(this.painter().frame(ms, 'blank'));
  }

  done(use: StripUse): PFrame[] {
    let frames = this.frames;
    const { opts, cfg } = this;
    if (opts.reduceFlash) {
      const kept: PFrame[] = [];
      let carry = 0;
      for (const f of frames) {
        if (f.kind === 'contrast' || f.kind === 'blank') {
          if (kept.length) kept[kept.length - 1].ms += f.ms;
          else carry += f.ms;
          continue;
        }
        f.ms += carry;
        carry = 0;
        for (let k = 0; k < f.body.length; k++) if (f.body[k] === IDX.WHITE) f.body[k] = IDX.R5;
        if (f.kind === 'hero') f.kind = 'normal';
        kept.push(f);
      }
      frames = kept.length ? kept : [this.painter().frame(17 + carry)];
    }
    const once = use === 'once';
    // The last two non-empty frames of a one-shot may keep orphans (Saint11 dissipation).
    const nonEmpty = frames.map((f, k) => (f.body.some((v) => v !== 0) ? k : -1)).filter((k) => k >= 0);
    const tail = new Set(once ? nonEmpty.slice(-2) : []);
    const emissive = cfg.glowFrom === 'none' ? null : cfg.glowFrom === 'bright' ? BRIGHT : HOT;
    frames.forEach((f, k) => {
      const p = wrap(f, this.bx, this.by);
      if (cfg.orphans && !tail.has(k)) p.orphans();
      if (opts.keyline && !cfg.matter) p.keyline();
      if (emissive) p.dilate(emissive);
      f.ms = clampMs(f.ms);
    });
    if (once && (frames.length === 0 || frames[frames.length - 1].body.some((v) => v !== 0))) {
      frames.push(this.painter().frame(17));
    }
    return frames;
  }
}

/** A painter view over an existing frame's buffers (passes only). */
function wrap(f: IndexFrame, bx: number, by: number): Painter {
  return new Painter(f.w, f.h, f.ox, f.oy, bx, by, f);
}

/** Frame times are VSYNC_MS values; longer holds must be split by the template. */
export function clampMs(ms: number): number {
  return quantMs(Math.max(17, Math.min(200, ms)));
}

/** Push `total` ms of a held frame as <= 200 ms pieces (VSYNC). */
export function holdMs(total: number): number[] {
  const out: number[] = [];
  let left = total;
  while (left > 0) {
    const v = clampMs(Math.min(200, left));
    out.push(v);
    left -= v;
  }
  return out;
}

// ------------------------------------------------------------------ easing

export const outCubic = (u: number) => 1 - (1 - u) ** 3;
export const outBack = (u: number) => {
  const c = 1.70158;
  return 1 + (c + 1) * (u - 1) ** 3 + c * (u - 1) ** 2;
};
export const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

// ------------------------------------------------------------------ small shared marks (local space)

/** 4-point star / glint: centre `c`, arms of length L in `arm` ink. */
export function glint(p: Painter, x: number, y: number, L: number, c: number = IDX.R5, arm: number = IDX.R4): void {
  const fx = p.X(x, y),
    fy = p.Y(x, y);
  for (let k = 1; k <= L; k++) {
    const ink = k === L && L > 1 ? IDX.R3 : arm;
    p.put(fx + k, fy, ink);
    p.put(fx - k, fy, ink);
    p.put(fx, fy + k, ink);
    p.put(fx, fy - k, ink);
  }
  p.put(fx, fy, c);
}

/** 3x3 plus sparkle. */
export function plus(p: Painter, x: number, y: number, c: number = IDX.R5, arm: number = IDX.R4): void {
  glint(p, x, y, 1, c, arm);
}

/** A short spark streak from (x, y) along `ang` (local radians): head bright, tail dim. */
export function spark(p: Painter, x: number, y: number, ang: number, len: number, head: number = IDX.R5, tail: number = IDX.R3): void {
  const ex = x + Math.cos(ang) * len,
    ey = y + Math.sin(ang) * len;
  p.line(x, y, ex, ey, (t) => (t > 0.6 ? head : tail));
}

/** An outlined matter chip (2x2 or 2x3) at a local point; the outline only lands on clear pixels. */
export function chip(p: Painter, x: number, y: number, ink: number = IDX.R2, tall = false): void {
  const fx = p.X(x, y),
    fy = p.Y(x, y);
  const hh = tall ? 3 : 2;
  for (let yy = -1; yy <= hh; yy++)
    for (let xx = -1; xx <= 2; xx++) {
      const inner = xx >= 0 && xx < 2 && yy >= 0 && yy < hh;
      const corner = (xx === -1 || xx === 2) && (yy === -1 || yy === hh);
      if (inner) p.set(fx + xx, fy + yy, xx === 0 && yy === 0 ? Math.min(IDX.R5, ink + 2) : ink);
      else if (!corner) p.under(fx + xx, fy + yy, IDX.OUTLINE);
    }
}

/** 3x3 rune glyph from a seed (ACCENT ink). */
export function runeMark(p: Painter, x: number, y: number, seed: number, ink: number = IDX.ACCENT, h: 3 | 5 = 3): void {
  p.bits(x, y, rune(seed, h), ink);
}

/** Element glyph (5x5) with a 1 px dark border for contrast. */
export function elementGlyph(p: Painter, x: number, y: number, el: keyof typeof ELEMENT_GLYPHS, ink: number = IDX.R5, rim: number = IDX.R0): void {
  const g = ELEMENT_GLYPHS[el];
  const fx = p.X(x, y) - 2,
    fy = p.Y(x, y) - 2;
  for (let yy = -1; yy <= 5; yy++)
    for (let xx = -1; xx <= 5; xx++) {
      const on = yy >= 0 && yy < 5 && xx >= 0 && xx < 5 && g[yy][xx] === '#';
      if (on) p.set(fx + xx, fy + yy, ink);
    }
  // Rim on clear 4-neighbours of the glyph.
  for (let yy = -1; yy <= 5; yy++)
    for (let xx = -1; xx <= 5; xx++) {
      const on = (a: number, b: number) => b >= 0 && b < 5 && a >= 0 && a < 5 && g[b][a] === '#';
      if (on(xx, yy)) continue;
      if (on(xx - 1, yy) || on(xx + 1, yy) || on(xx, yy - 1) || on(xx, yy + 1)) p.under(fx + xx, fy + yy, rim);
    }
}

/**
 * A small family mark at a local point (strike tier-2 overlays, magic hit spokes). `ang` is the local direction the
 * mark travels or points along; `k` scales it (1 = 24 px cell). Marks with an "up" read are drawn screen-upright.
 */
export function motifMark(p: Painter, motif: FamilyId, x: number, y: number, ang: number, k: number, rnd: Rng): void {
  const fx = p.X(x, y),
    fy = p.Y(x, y);
  const sa = ang + p.angle;
  const ca = Math.cos(sa),
    sn = Math.sin(sa);
  const big = k >= 1.2;
  switch (motif) {
    case 'fire': {
      // Rising tongue: bright base, cool tip, S-sway.
      const hgt = big ? 4 : 3;
      const sway = rnd() < 0.5 ? -1 : 1;
      for (let t = 0; t < hgt; t++) {
        const xx = fx + (t === hgt - 1 ? sway : 0);
        p.put(xx, fy - t, t === 0 ? IDX.R5 : t === 1 ? IDX.R4 : IDX.R3);
        if (t === 0 && big) p.put(fx + 1, fy, IDX.R4);
      }
      break;
    }
    case 'magma':
      chip(p, x, y, IDX.S2);
      p.put(fx, fy, IDX.R4);
      break;
    case 'water':
      p.put(fx, fy, IDX.R4);
      p.put(fx, fy + 1, IDX.R3);
      p.put(fx + 1, fy + 1, IDX.R3);
      p.put(fx, fy - 1, IDX.R5);
      break;
    case 'ice': {
      // Shard tooth pointing along ang.
      for (let t = 0; t < 4; t++) p.put(fx + Math.round(ca * t), fy + Math.round(sn * t), t === 3 ? IDX.R5 : IDX.R4);
      p.put(fx + Math.round(-sn), fy + Math.round(ca), IDX.R2);
      break;
    }
    case 'lightning':
    case 'storm': {
      let px = fx,
        py = fy;
      for (let t = 0; t < 4; t++) {
        const side = t % 2 === 0 ? 1 : -1;
        const nx = px + Math.round(ca * 1.5 - sn * side),
          ny = py + Math.round(sn * 1.5 + ca * side);
        p.put(nx, ny, t === 3 ? IDX.R5 : IDX.R4);
        px = nx;
        py = ny;
      }
      p.put(fx, fy, IDX.R5);
      if (motif === 'storm') {
        p.put(fx + 2, fy - 2, IDX.S2);
        p.put(fx + 1, fy - 1, IDX.S3);
      }
      break;
    }
    case 'earth':
      chip(p, x, y, IDX.R2, rnd() < 0.5);
      break;
    case 'wind':
      for (let t = -2; t <= 2; t++) {
        const bend = Math.round((t * t) / 3);
        p.put(fx + Math.round(ca * t - sn * bend), fy + Math.round(sn * t + ca * bend), t > 0 ? IDX.R4 : IDX.R3);
      }
      break;
    case 'shadow':
      p.put(fx, fy, IDX.R0);
      p.put(fx + 1, fy, IDX.R0);
      p.put(fx, fy + 1, IDX.R1);
      p.put(fx - 1, fy, IDX.R4);
      break;
    case 'holy':
      plus(p, x, y, IDX.R5, IDX.R4);
      p.put(fx, fy - 2, IDX.R3);
      break;
    case 'twilight':
      glint(p, x, y, big ? 2 : 1, IDX.ACCENT, IDX.R4);
      break;
    case 'arcane':
      runeMark(p, x, y, Math.floor(rnd() * 1e9));
      break;
    case 'toxin':
      p.put(fx, fy, IDX.R4);
      p.put(fx, fy + 1, IDX.R3);
      p.put(fx, fy + 3, IDX.R3);
      p.put(fx + 1, fy, IDX.ACCENT);
      break;
    case 'spirit':
      for (const [dx, dy] of [
        [0, -1],
        [1, 0],
        [0, 1],
        [-1, 0],
      ])
        p.put(fx + dx, fy + dy, IDX.R4);
      break;
    case 'stealth':
      for (let t = -2; t <= 2; t++) p.put(fx + Math.round(ca * t), fy + Math.round(sn * t), t === 0 ? IDX.ACCENT : IDX.R3);
      break;
    case 'danger':
      p.put(fx, fy, IDX.R3);
      p.put(fx - 1, fy - 1, IDX.R3);
      p.put(fx - 1, fy + 1, IDX.R3);
      break;
    case 'steel':
    default:
      glint(p, x, y, big ? 2 : 1, IDX.R5, IDX.R4);
      break;
  }
}
