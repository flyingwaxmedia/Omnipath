// Bolt strip pool (docs/VFX.md §8.5, §8.12): chain hops and arc zaps are the only cast-time bakes, and painting a hop
// (two stamped lightning paths over six frames) cost 1-5 ms per hop on the container CPU — 7-11 ms single-frame spikes
// when a chain fired in a busy fight. Now every bolt look (style × strength) pre-bakes a POOL of short lightning strips
// at warm-up, in index space:
//   trunk runs   4 length buckets (6 / 10 / 16 / 24 px) × 9 headings of one quadrant (11.25° apart) × 2 seeded
//                roughness variants, each inked in the three trunk modes (bolt / white / remnant);
//   fork runs    4 length buckets (4 / 7 / 11 / 16 px) × 9 headings × 2 variants, wiggly, in the fork ink;
//   micro steps  every integer step of at most 6 px (trunk and fork ink): they close a run exactly on its kink.
// A hop then COMPOSES its frames (composeBolt): the template's two-scale path — the same coarse midpoint kinks, same
// parameters and seeds — laid run by run as a chain of pool strips (quadrant flips only: never rotated, never
// stretched) that lands exactly on each kink; forks grown along it as the template grows them; everything merged
// max-wins by brightness rank (what the painter's stamps do), glow beads every ~12 px, then the strip grammar (chain:
// contrast / white / blank / remnant / blank / fragments; zap: white / bolt) and the shared finalize rules
// (reduce-flash, biome keyline, frame times, the empty last frame). Copying a few dozen small strips costs a fraction
// of a millisecond instead of stamping thousands of discs. Phaser-free (tests/vfx-boltpool.test.ts).
import { hashSeed, mulberry32 } from '../../core/rng';
import { boltInks, stampLine, styleOf, type BoltStyle } from './components/bolt';
import { clampMs } from './components/kit';
import { bayerT } from './dither';
import { glowDisc } from './glow';
import { Painter, midpoint, rank } from './painter';
import { pack } from './ramps';
import { IDX, type BakeOptions, type BoltParams, type FamilyId, type IndexFrame, type RgbaFrame } from './types';

/** Trunk run lengths, fork run lengths (px), headings per quadrant, seeded variants per run. */
export const BOLT_POOL = { trunkLens: [6, 10, 16, 24], forkLens: [4, 7, 11, 16], headings: 9, variants: 2, micro: 6 } as const;

const MODES = ['bolt', 'white', 'remnant'] as const;
type Mode = (typeof MODES)[number];

/** One pooled strip: ink from (0, 0) to (ex, ey), trimmed to its pixels at (x0 + i, y0 + j). */
interface Seg {
  ex: number;
  ey: number;
  x0: number;
  y0: number;
  w: number;
  h: number;
  /** Index pixels per mode (trunk: bolt / white / remnant; fork: one). */
  ink: Uint8Array[];
}

/** A pool strip as a candidate step: its end after the quadrant flip. */
interface Cand {
  seg: Seg;
  fx: 1 | -1;
  fy: 1 | -1;
  ex: number;
  ey: number;
}

/** A placed strip (a step of a composed path). */
interface Place {
  c: Cand;
  x: number;
  y: number;
}

/** One look's pool (style × strength): its candidates and exact micro steps. */
export interface BoltLook {
  readonly style: BoltStyle;
  readonly strength: number;
  trunk: Cand[];
  fork: Cand[];
  /** Micro steps by `${|dx|},${|dy|}` (first quadrant; flipped per use). */
  trunkMicro: Map<string, Seg>;
  forkMicro: Map<string, Seg>;
  /** Strips baked (QA). */
  strips: number;
}

const RANK = new Float32Array(256);
for (let i = 0; i < 256; i++) RANK[i] = rank(i);

/** Paint one strip along `path` (local px, starting at 0, 0) with the given stamps, trimmed. */
function bakeSeg(path: number[], ex: number, ey: number, inks: readonly (readonly (readonly [number, number])[])[]): Seg {
  let mnx = 0,
    mny = 0,
    mxx = 0,
    mxy = 0;
  for (let k = 0; k < path.length; k += 2) {
    mnx = Math.min(mnx, path[k]);
    mxx = Math.max(mxx, path[k]);
    mny = Math.min(mny, path[k + 1]);
    mxy = Math.max(mxy, path[k + 1]);
  }
  const pad = 4;
  const ox = Math.ceil(-mnx) + pad;
  const oy = Math.ceil(-mny) + pad;
  const W = Math.ceil(mxx) + ox + pad + 1;
  const H = Math.ceil(mxy) + oy + pad + 1;
  const bodies = inks.map((stamps) => {
    const p = new Painter(W, H, ox, oy);
    for (const [r, ink] of stamps) stampLine(p, path, r, ink);
    return p.body;
  });
  // Trim to the union of every mode's pixels (one rectangle for all modes).
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (const b of bodies)
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++)
        if (b[y * W + x]) {
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
  if (x1 < 0) return { ex, ey, x0: 0, y0: 0, w: 0, h: 0, ink: bodies.map(() => new Uint8Array(0)) };
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const ink = bodies.map((b) => {
    const out = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) out.set(b.subarray((y + y0) * W + x0, (y + y0) * W + x0 + w), y * w);
    return out;
  });
  return { ex, ey, x0: x0 - ox, y0: y0 - oy, w, h, ink };
}

function flips(seg: Seg): Cand[] {
  const out: Cand[] = [];
  for (const fx of [1, -1] as const)
    for (const fy of [1, -1] as const) {
      if ((fx === -1 && seg.ex === 0) || (fy === -1 && seg.ey === 0)) continue;
      out.push({ seg, fx, fy, ex: fx * seg.ex, ey: fy * seg.ey });
    }
  return out;
}

/** The bake work of one look, as small steps (warm-up runs them in idle slices). */
function* lookSteps(look: BoltLook): Generator<void, void, void> {
  const { style, strength } = look;
  const trunkInks = MODES.map((m) => boltInks(style, strength, m as Mode).trunk);
  const forkInk = [boltInks(style, strength, 'bolt').fork];
  const P = BOLT_POOL;
  for (let k = 0; k < P.headings; k++) {
    const a = (k * Math.PI) / 2 / (P.headings - 1);
    for (let v = 0; v < P.variants; v++) {
      const rnd = mulberry32(hashSeed('boltpool', style, strength, k, v));
      for (const L of P.trunkLens) {
        const ex = Math.round(Math.cos(a) * L),
          ey = Math.round(Math.sin(a) * L);
        // The template's second-scale roughness (+-0.1 L, then halving, every ~4 px).
        const seg = bakeSeg(midpoint(0, 0, ex, ey, 0.1, rnd, 4), ex, ey, trunkInks);
        look.trunk.push(...flips(seg));
        look.strips++;
      }
      yield;
      for (const L of P.forkLens) {
        const ex = Math.round(Math.cos(a) * L),
          ey = Math.round(Math.sin(a) * L);
        // Forks wander like the template's (jag ~0.3 of their length).
        const seg = bakeSeg(midpoint(0, 0, ex, ey, 0.3, rnd, 3), ex, ey, forkInk);
        look.fork.push(...flips(seg));
        look.strips++;
      }
      yield;
    }
  }
  for (let x = 0; x <= P.micro; x++) {
    for (let y = 0; y <= P.micro; y++) {
      if (!x && !y) continue;
      if (x * x + y * y > P.micro * P.micro) continue;
      look.trunkMicro.set(`${x},${y}`, bakeSeg([0, 0, x, y], x, y, trunkInks));
      look.forkMicro.set(`${x},${y}`, bakeSeg([0, 0, x, y], x, y, forkInk));
      look.strips += 2;
    }
    yield;
  }
}

/** The run-wide pool of bolt looks (one per style × strength), baked at warm-up. */
export class BoltPool {
  private looks = new Map<string, BoltLook>();
  private queue: { look: BoltLook; steps: Generator<void, void, void> }[] = [];
  /** Total ms spent baking (QA). */
  bakedMs = 0;

  private static key(style: BoltStyle, strength: number): string {
    return `${style}|${strength}`;
  }

  /** Queues a look for baking (no-op once queued or ready). */
  want(motif: FamilyId, strength: number): void {
    const style = styleOf(motif);
    const key = BoltPool.key(style, strength);
    if (this.looks.has(key)) return;
    const look: BoltLook = { style, strength, trunk: [], fork: [], trunkMicro: new Map(), forkMicro: new Map(), strips: 0 };
    this.looks.set(key, look);
    this.queue.push({ look, steps: lookSteps(look) });
  }

  get pending(): boolean {
    return this.queue.length > 0;
  }

  /**
   * Bakes queued looks for about `budgetMs` of `clock` time (the runtime's idle slices pass performance.now; the core
   * never reads a clock itself); a look becomes usable once fully baked.
   */
  step(budgetMs: number, clock: () => number): void {
    const t0 = clock();
    while (this.queue.length && clock() - t0 < budgetMs) {
      const q = this.queue[0];
      if (q.steps.next().done) this.queue.shift();
    }
    this.bakedMs += clock() - t0;
  }

  /** Bakes every queued look now (tests, QA). */
  flush(): void {
    while (this.queue.length) this.step(Infinity, () => 0);
  }

  /** The ready look for a bolt, or null while it is still baking / never wanted. */
  look(motif: FamilyId, strength: number): BoltLook | null {
    const look = this.looks.get(BoltPool.key(styleOf(motif), strength));
    if (!look) return null;
    return this.queue.some((q) => q.look === look) ? null : look;
  }
}

// ------------------------------------------------------------------ composition

/** Lays the integer run (rx, ry) from (px, py) as pool strips ending exactly on its end. */
function layRun(out: Place[], cands: readonly Cand[], micro: Map<string, Seg>, px: number, py: number, rx: number, ry: number, rnd: () => number): void {
  let cx = 0,
    cy = 0;
  const M2 = BOLT_POOL.micro * BOLT_POOL.micro;
  for (let guard = 0; guard < 96; guard++) {
    const remx = rx - cx,
      remy = ry - cy;
    const d2 = remx * remx + remy * remy;
    if (d2 <= M2) break;
    let best: Cand | null = null;
    let bd = d2;
    for (const c of cands) {
      const ux = remx - c.ex,
        uy = remy - c.ey;
      const dd = ux * ux + uy * uy;
      if (dd < bd || (dd === bd && best && rnd() < 0.5)) {
        bd = dd;
        best = c;
      }
    }
    if (!best) break;
    out.push({ c: best, x: px + cx, y: py + cy });
    cx += best.ex;
    cy += best.ey;
  }
  const remx = rx - cx,
    remy = ry - cy;
  if (!remx && !remy) return;
  const seg = micro.get(`${Math.abs(remx)},${Math.abs(remy)}`);
  if (seg) out.push({ c: { seg, fx: remx < 0 ? -1 : 1, fy: remy < 0 ? -1 : 1, ex: remx, ey: remy }, x: px + cx, y: py + cy });
}

interface Composed {
  trunk: Place[];
  forks: Place[];
  /** Trunk joints (local px), start to end. */
  joints: number[];
}

/** One path (the template's makePath, laid with pool strips). */
function composePath(prm: BoltParams, look: BoltLook, rnd: () => number): Composed {
  const L = Math.hypot(prm.dx, prm.dy);
  const dx = Math.round(prm.dx),
    dy = Math.round(prm.dy);
  // The template's coarse kinks: same jag scaling, same minimum segment.
  const coarse = midpoint(0, 0, dx, dy, prm.jag * Math.min(1, (48 + 0.3 * L) / Math.max(1, L)), rnd, Math.max(7, L / 8));
  const kinks: number[] = [];
  for (let k = 0; k < coarse.length; k += 2) kinks.push(Math.round(coarse[k]), Math.round(coarse[k + 1]));
  kinks[kinks.length - 2] = dx;
  kinks[kinks.length - 1] = dy;
  const trunk: Place[] = [];
  for (let k = 0; k + 3 < kinks.length; k += 2) {
    layRun(trunk, look.trunk, look.trunkMicro, kinks[k], kinks[k + 1], kinks[k + 2] - kinks[k], kinks[k + 3] - kinks[k + 1], rnd);
  }
  const joints: number[] = [];
  for (const p of trunk) joints.push(p.x, p.y);
  joints.push(dx, dy);
  const forks: Place[] = [];
  if (prm.strength >= 0.5) grow(forks, joints, prm, look, rnd, 0, Math.max(2, Math.round(L / 4) + 1));
  return { trunk, forks, joints };
}

/**
 * The template's fork growth on a laid path: per joint a chance scaled by the joint spacing (the template rolls
 * every ~4 px), forks leave at 0.35-0.9 rad off the local heading, 25-55 % of the remaining length, wander, and fork
 * once more (depth 1).
 */
function grow(out: Place[], pts: number[], prm: BoltParams, look: BoltLook, rnd: () => number, depth: number, nOrig: number): void {
  const m = pts.length / 2;
  const per4 = Math.min(0.9, (4 * 0.35 * prm.forks) / (1 + depth) / Math.max(4, nOrig / 6));
  const endX = pts[(m - 1) * 2],
    endY = pts[(m - 1) * 2 + 1];
  for (let j = 1; j < m - 1; j++) {
    const sx = pts[j * 2 + 2] - pts[j * 2],
      sy = pts[j * 2 + 3] - pts[j * 2 + 1];
    const spacing = Math.max(1, Math.hypot(sx, sy));
    if (rnd() >= Math.min(0.9, (per4 * spacing) / 4)) continue;
    const ang = Math.atan2(sy, sx) + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.55);
    const len = Math.hypot(endX - pts[j * 2], endY - pts[j * 2 + 1]) * (0.25 + rnd() * 0.3);
    if (len < 5) continue;
    const fx = pts[j * 2],
      fy = pts[j * 2 + 1];
    const tx = Math.round(Math.cos(ang) * len),
      ty = Math.round(Math.sin(ang) * len);
    // A wandering fork: 2-3 coarse runs (the template's jag), each laid exactly.
    const wob = midpoint(0, 0, tx, ty, prm.jag, rnd, Math.max(5, len / 3));
    const placed: Place[] = [];
    let px = fx,
      py = fy;
    for (let k = 2; k < wob.length; k += 2) {
      const nx = fx + Math.round(wob[k]),
        ny = fy + Math.round(wob[k + 1]);
      layRun(placed, look.fork, look.forkMicro, px, py, nx - px, ny - py, rnd);
      px = nx;
      py = ny;
    }
    out.push(...placed);
    if (depth < 1 && placed.length > 1) {
      const sub: number[] = [];
      for (const p of placed) sub.push(p.x, p.y);
      sub.push(px, py);
      grow(out, sub, prm, look, rnd, depth + 1, nOrig);
    }
  }
}

/** A frame under construction: an index + glow buffer over a known box. */
class Canvas {
  readonly body: Uint8Array;
  readonly glow: Uint8Array;
  constructor(
    readonly x0: number,
    readonly y0: number,
    readonly w: number,
    readonly h: number,
  ) {
    this.body = new Uint8Array(w * h);
    this.glow = new Uint8Array(w * h);
  }

  /** Max-wins merge of placed strips (mode m of their ink). */
  merge(places: readonly Place[], m: number): void {
    const { body, w, x0, y0 } = this;
    for (const p of places) {
      const s = p.c.seg;
      const ink = s.ink[Math.min(m, s.ink.length - 1)];
      if (!s.w) continue;
      const fx = p.c.fx,
        fy = p.c.fy;
      for (let j = 0; j < s.h; j++) {
        const ly = p.y + fy * (s.y0 + j) - y0;
        const row = ly * w;
        for (let i = 0; i < s.w; i++) {
          const v = ink[j * s.w + i];
          if (!v) continue;
          const k = row + p.x + fx * (s.x0 + i) - x0;
          if (RANK[v] > RANK[body[k]]) body[k] = v;
        }
      }
    }
  }

  /** Overwrite one local pixel (the template's put). */
  put(x: number, y: number, v: number): void {
    const fx = x - this.x0,
      fy = y - this.y0;
    if (fx >= 0 && fy >= 0 && fx < this.w && fy < this.h) this.body[fy * this.w + fx] = v;
  }

  /** Glow beads every ~9 px along the trunk (the template: every 3rd point of its 2-4 px trunk; r 3, level 2). */
  beads(joints: readonly number[]): void {
    const STEP = 9;
    let next = 0;
    let at = 0;
    for (let k = 0; k + 3 < joints.length; k += 2) {
      const ax = joints[k],
        ay = joints[k + 1];
      const L = Math.hypot(joints[k + 2] - ax, joints[k + 3] - ay);
      while (next <= at + L) {
        const u = L > 0 ? (next - at) / L : 0;
        glowDisc(this.glow, this.w, this.h, Math.round(ax + (joints[k + 2] - ax) * u) - this.x0, Math.round(ay + (joints[k + 3] - ay) * u) - this.y0, 3, 2);
        next += STEP;
      }
      at += L;
    }
  }

  /** The template's disc(): an R0 contrast blot (max-wins with what is there). */
  disc(cx: number, cy: number, r: number, v: number): void {
    const R = Math.ceil(r);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        if (x * x + y * y > r * r + 0.5) continue;
        const fx = cx + x - this.x0,
          fy = cy + y - this.y0;
        if (fx < 0 || fy < 0 || fx >= this.w || fy >= this.h) continue;
        const k = fy * this.w + fx;
        if (RANK[v] > RANK[this.body[k]]) this.body[k] = v;
      }
  }

  /** Bresenham line (the template's fragments). */
  line(ax: number, ay: number, bx: number, by: number, v: number): void {
    let x = Math.round(ax),
      y = Math.round(ay);
    const ex = Math.round(bx),
      ey = Math.round(by);
    const dx = Math.abs(ex - x),
      dy = -Math.abs(ey - y);
    const sx = x < ex ? 1 : -1,
      sy = y < ey ? 1 : -1;
    let err = dx + dy;
    for (let n = 0; n < 64; n++) {
      this.put(x, y, v);
      if (x === ex && y === ey) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  frame(ms: number): IndexFrame {
    return { w: this.w, h: this.h, ox: -this.x0, oy: -this.y0, body: this.body, glow: this.glow, ms };
  }
}

/** Local box of some placed strips (+ margin), merged into `box`. */
function boxOf(box: number[], places: readonly Place[]): void {
  for (const p of places) {
    const s = p.c.seg;
    if (!s.w) continue;
    const xa = p.x + p.c.fx * s.x0,
      xb = p.x + p.c.fx * (s.x0 + s.w - 1);
    const ya = p.y + p.c.fy * s.y0,
      yb = p.y + p.c.fy * (s.y0 + s.h - 1);
    box[0] = Math.min(box[0], xa, xb);
    box[1] = Math.min(box[1], ya, yb);
    box[2] = Math.max(box[2], xa, xb);
    box[3] = Math.max(box[3], ya, yb);
  }
}

/**
 * A hop's frames from the pool, frame for frame the bolt template's grammar (components/bolt.ts) after the shared
 * finalize: chain = contrast (A + R0 blot at the end) / white B / blank / remnant A / blank / fragments, zap = white A
 * (+ R5 end dots) / bolt B; reduce-flash drops contrast and blank frames into their neighbours and turns WHITE into R5;
 * the biome keyline outlines each frame; frames are cropped to their pixels + 3 px; the last frame is empty.
 */
export function composeBolt(prm: BoltParams, look: BoltLook, opts: BakeOptions): IndexFrame[] {
  const rndA = mulberry32(prm.seed >>> 0);
  const rndB = mulberry32((prm.seed ^ 0x9e3779b9) >>> 0);
  const rndF = mulberry32(hashSeed('boltfrag', prm.seed >>> 0));
  const A = composePath(prm, look, rndA);
  const B = composePath(prm, look, rndB);
  const dx = Math.round(prm.dx),
    dy = Math.round(prm.dy);
  const zap = prm.seq === 'zap';
  const M = 3; // crop margin (Strip.done crops to content + 3 px)
  const canvas = (sets: readonly (readonly Place[])[], extra: readonly number[] = []): Canvas => {
    const box = [Infinity, Infinity, -Infinity, -Infinity];
    for (const s of sets) boxOf(box, s);
    for (let k = 0; k < extra.length; k += 2) {
      box[0] = Math.min(box[0], extra[k]);
      box[1] = Math.min(box[1], extra[k + 1]);
      box[2] = Math.max(box[2], extra[k]);
      box[3] = Math.max(box[3], extra[k + 1]);
    }
    if (box[0] > box[2]) box[0] = box[1] = box[2] = box[3] = 0;
    return new Canvas(box[0] - M, box[1] - M, box[2] - box[0] + 1 + 2 * M, box[3] - box[1] + 1 + 2 * M);
  };
  const beadBox = (j: readonly number[]): number[] => {
    // Glow beads reach 3 px round every joint.
    const out: number[] = [];
    for (let k = 0; k < j.length; k += 2) out.push(j[k] - 3, j[k + 1] - 3, j[k] + 3, j[k + 1] + 3);
    return out;
  };
  const bolt = (P: Composed, mode: 0 | 1, extra: readonly number[] = []): Canvas => {
    const c = canvas([P.trunk, P.forks], [...beadBox(P.joints), ...extra]);
    c.merge(P.trunk, mode);
    c.merge(P.forks, 0);
    c.beads(P.joints);
    return c;
  };
  type F = { c: Canvas | null; ms: number; kind: 'normal' | 'hero' | 'contrast' | 'blank' };
  const frames: F[] = [];
  const heroKind = look.style === 'inverted' ? 'normal' : 'hero';
  if (zap) {
    const f0 = bolt(A, 1);
    f0.put(0, 0, IDX.R5);
    f0.put(dx, dy, IDX.R5);
    frames.push({ c: f0, ms: 33, kind: heroKind });
    frames.push({ c: bolt(B, 0), ms: 33, kind: 'normal' });
  } else {
    const f0 = bolt(A, 0, [dx - 3, dy - 3, dx + 3, dy + 3]);
    f0.disc(dx, dy, 3, IDX.R0);
    frames.push({ c: f0, ms: 33, kind: 'contrast' });
    frames.push({ c: bolt(B, 1), ms: 33, kind: heroKind });
    frames.push({ c: null, ms: 33, kind: 'blank' });
    const rem = canvas([A.trunk]);
    rem.merge(A.trunk, 2);
    frames.push({ c: rem, ms: 50, kind: 'normal' });
    frames.push({ c: null, ms: 33, kind: 'blank' });
    // Fragments: 2-4 short R3 sparks near either end of path A.
    const pts = A.joints;
    const m = pts.length / 2;
    const n = 2 + Math.floor(rndF() * 3);
    const lines: number[] = [];
    for (let k = 0; k < n; k++) {
      const nearEnd = k % 2 === 0 ? Math.floor(rndF() * m * 0.2) : m - 1 - Math.floor(rndF() * m * 0.2);
      const j = Math.max(0, Math.min(m - 2, nearEnd));
      const len = 3 + rndF() * 2;
      const ax = pts[j * 2],
        ay = pts[j * 2 + 1];
      const a = Math.atan2(pts[j * 2 + 3] - ay, pts[j * 2 + 2] - ax) + (rndF() - 0.5);
      lines.push(ax, ay, Math.round(ax + Math.cos(a) * len), Math.round(ay + Math.sin(a) * len));
    }
    const fr = canvas([], lines);
    for (let k = 0; k < lines.length; k += 4) fr.line(lines[k], lines[k + 1], lines[k + 2], lines[k + 3], IDX.R3);
    frames.push({ c: fr, ms: 50, kind: 'normal' });
  }
  // Shared finalize (kit.ts Strip.done): reduce-flash folds contrast / blank frames into their neighbours.
  let kept: F[] = frames;
  if (opts.reduceFlash) {
    kept = [];
    let carry = 0;
    for (const f of frames) {
      if (f.kind === 'contrast' || f.kind === 'blank') {
        if (kept.length) kept[kept.length - 1].ms += f.ms;
        else carry += f.ms;
        continue;
      }
      f.ms += carry;
      carry = 0;
      const b = f.c!.body;
      for (let k = 0; k < b.length; k++) if (b[k] === IDX.WHITE) b[k] = IDX.R5;
      kept.push(f);
    }
  }
  const out: IndexFrame[] = kept.map((f) => {
    if (!f.c) return { w: 1, h: 1, ox: 0, oy: 0, body: new Uint8Array(1), glow: new Uint8Array(1), ms: clampMs(f.ms) };
    if (opts.keyline) new Painter(f.c.w, f.c.h, -f.c.x0, -f.c.y0, (prm.seed & 3) + f.c.x0, ((prm.seed >>> 2) & 3) + f.c.y0, f.c).keyline();
    return f.c.frame(clampMs(f.ms));
  });
  out.push({ w: 1, h: 1, ox: 0, oy: 0, body: new Uint8Array(1), glow: new Uint8Array(1), ms: 17 });
  return out;
}

// ------------------------------------------------------------------ RGBA (hop time)

const WHITE_PX = pack(255, 255, 255, 255);
const GLOW_COVER = [0, 0.25, 0.5, 0.75];

function trimmed(out: Uint32Array, w: number, x0: number, y0: number, x1: number, y1: number, f: IndexFrame): RgbaFrame {
  if (x1 < 0) return { w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms, data: new Uint8ClampedArray(0) };
  const tw = x1 - x0 + 1,
    th = y1 - y0 + 1;
  const data = new Uint8ClampedArray(tw * th * 4);
  const o32 = new Uint32Array(data.buffer);
  for (let y = 0; y < th; y++) o32.set(out.subarray((y + y0) * w + x0, (y + y0) * w + x0 + tw), y * tw);
  return { w: tw, h: th, ox: f.ox - x0, oy: f.oy - y0, ms: f.ms, data };
}

/**
 * Body and glow-twin RGBA of a bolt frame in one pass each — the same pixels as bake.ts colourise() / glowTwin()
 * (colour through the LUT, trimmed; glow levels 1/2/3 at 25/50/75 % anchor-relative Bayer coverage, white, trimmed)
 * without their per-frame mask and bounds passes (hop-time budget).
 */
export function boltRgba(f: IndexFrame, table: Uint32Array): { body: RgbaFrame; glow: RgbaFrame } {
  const { w, h, body, glow } = f;
  const n = w * h;
  const ob = new Uint32Array(n);
  let og: Uint32Array | null = null;
  let bx0 = w,
    by0 = h,
    bx1 = -1,
    by1 = -1;
  let gx0 = w,
    gy0 = h,
    gx1 = -1,
    gy1 = -1;
  for (let y = 0, k = 0; y < h; y++)
    for (let x = 0; x < w; x++, k++) {
      const v = body[k];
      if (v) {
        ob[k] = table[v];
        if (x < bx0) bx0 = x;
        if (x > bx1) bx1 = x;
        if (y < by0) by0 = y;
        if (y > by1) by1 = y;
      }
      const l = glow[k];
      if (l && GLOW_COVER[l > 3 ? 3 : l] > bayerT(x - f.ox, y - f.oy)) {
        (og ??= new Uint32Array(n))[k] = WHITE_PX;
        if (x < gx0) gx0 = x;
        if (x > gx1) gx1 = x;
        if (y < gy0) gy0 = y;
        if (y > gy1) gy1 = y;
      }
    }
  return { body: trimmed(ob, w, bx0, by0, bx1, by1, f), glow: trimmed(og ?? ob, w, gx0, gy0, gx1, gy1, f) };
}
