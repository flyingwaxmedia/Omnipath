// bolt: midpoint-displaced lightning between two points (chain hops, arc zaps, palm bolts, tethers).
// Baked at hop time (docs/VFX.md §5, §8.5). The anchor is the start point; (dx, dy) is the end.
//   chain: 33 contrast + bolt -> 33 white re-seed -> 33 blank -> 50 remnant -> 33 blank -> 50 fragments -> empty
//   zap:   33 white bolt -> 33 re-seeded bolt -> empty (peak first)
// Inking is max-wins: trunk halo, fork halo, 1 px core; the white frame has a 3 px core (Saint11 electric technique).
// Paths have sharp kinks with short straight runs (two-scale midpoint displacement).
import { mulberry32 } from '../../../core/rng';
import { IDX, type BoltParams, type FamilyId, type Template } from '../types';
import { midpoint, type Painter } from '../painter';
import { Strip, mkKey, seedOf, type Rng, type TemplateOptions } from './kit';

export type BoltStyle = 'violet' | 'inverted' | 'plain';

/** Largest pooled live-bolt texture side (VFX_BUDGET.boltCanvases). */
const BOLT_TEX = 512;

export const styleOf = (motif: FamilyId): BoltStyle => (motif === 'lightning' ? 'violet' : motif === 'shadow' || motif === 'twilight' ? 'inverted' : 'plain');

function keyOf(p: BoltParams, motif: FamilyId, opts: TemplateOptions): string {
  return mkKey(
    'bolt',
    { dx: Math.round(p.dx), dy: Math.round(p.dy), jag: p.jag, forks: p.forks, strength: p.strength, seq: p.seq, seed: p.seed, style: styleOf(motif) },
    null,
    opts,
  );
}

interface Path {
  trunk: number[];
  forks: number[][];
}

function makePath(p: BoltParams, rnd: Rng): Path {
  // Long hops keep a bounded wander (off0 = jag * min(L, 48 + 0.3 L)), so a 180 px bolt reads as a strike, not a river.
  // Two scales: sharp kinks every ~L/8 (straight runs between them read as lightning, not a wavy worm), then a
  // +-1 px roughness pass on each run.
  const L = Math.hypot(p.dx, p.dy);
  const coarse = midpoint(0, 0, p.dx, p.dy, p.jag * Math.min(1, (48 + 0.3 * L) / Math.max(1, L)), rnd, Math.max(7, L / 8));
  const trunk: number[] = [coarse[0], coarse[1]];
  for (let k = 0; k < coarse.length / 2 - 1; k++) {
    const seg = midpoint(coarse[k * 2], coarse[k * 2 + 1], coarse[k * 2 + 2], coarse[k * 2 + 3], 0.1, rnd, 4);
    trunk.push(...seg.slice(2));
  }
  const forks: number[][] = [];
  const n = trunk.length / 2;
  const grow = (pts: number[], depth: number) => {
    const m = pts.length / 2;
    const remainingFrom = (j: number) => Math.hypot(pts[(m - 1) * 2] - pts[j * 2], pts[(m - 1) * 2 + 1] - pts[j * 2 + 1]);
    for (let j = 1; j < m - 1; j++) {
      const prob = (0.35 * p.forks) / (1 + depth) / Math.max(4, n / 6);
      if (rnd() >= prob * 4) continue;
      const seg = Math.atan2(pts[j * 2 + 3] - pts[j * 2 + 1], pts[j * 2 + 2] - pts[j * 2]);
      const ang = seg + (rnd() < 0.5 ? -1 : 1) * (0.35 + rnd() * 0.55);
      const len = remainingFrom(j) * (0.25 + rnd() * 0.3);
      if (len < 5) continue;
      const fx = pts[j * 2],
        fy = pts[j * 2 + 1];
      const f = midpoint(fx, fy, fx + Math.cos(ang) * len, fy + Math.sin(ang) * len, p.jag, rnd, 3);
      forks.push(f);
      if (depth < 1) grow(f, depth + 1);
    }
  };
  if (p.strength >= 0.5) grow(trunk, 0);
  return { trunk, forks };
}

/** Stamp a polyline every 0.5 px with a disc brush (max-wins). Shared with the hop-time bolt pool (../boltpool.ts). */
export function stampLine(p: Painter, pts: number[], r: number, ink: number): void {
  for (let k = 0; k < pts.length / 2 - 1; k++) {
    const x0 = pts[k * 2],
      y0 = pts[k * 2 + 1],
      x1 = pts[k * 2 + 2],
      y1 = pts[k * 2 + 3];
    const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) * 2));
    for (let s = 0; s <= n; s++) {
      const x = x0 + (x1 - x0) * (s / n),
        y = y0 + (y1 - y0) * (s / n);
      if (r < 0.75) p.putMax(p.X(x, y), p.Y(x, y), ink);
      else p.stamp(x, y, r, ink, 1, true);
    }
  }
}

/** Trunk and fork inks per mode (the pool bakes its strips with exactly these). */
export function boltInks(style: BoltStyle, strength: number, mode: 'bolt' | 'white' | 'remnant'): { trunk: readonly (readonly [number, number])[]; fork: readonly (readonly [number, number])[] } {
  if (mode === 'remnant') return { trunk: [[0.5, IDX.R2]], fork: [] };
  const inv = style === 'inverted';
  const white = mode === 'white';
  const halo = inv ? IDX.R4 : style === 'violet' ? IDX.S1 : IDX.R1;
  const body = inv ? IDX.R1 : white ? IDX.WHITE : IDX.R4;
  const core = inv ? IDX.R0 : white ? IDX.WHITE : IDX.R5;
  return {
    trunk: [
      [1.6 * strength, white && !inv ? IDX.R4 : halo],
      [1.0 * strength, white ? body : inv ? IDX.R1 : IDX.R4],
      [0.5, core],
    ],
    fork: [
      [1.0, halo],
      [0.5, strength >= 1 ? IDX.R3 : IDX.R2],
    ],
  };
}

function inkBolt(p: Painter, path: Path, prm: BoltParams, style: BoltStyle, mode: 'bolt' | 'white' | 'remnant'): void {
  const s = prm.strength;
  if (mode === 'remnant') {
    stampLine(p, path.trunk, 0.5, IDX.R2);
    return;
  }
  const inv = style === 'inverted';
  const halo = inv ? IDX.R4 : style === 'violet' ? IDX.S1 : IDX.R1;
  const forkHalo = IDX.R3;
  const body = inv ? IDX.R1 : mode === 'white' ? IDX.WHITE : IDX.R4;
  const core = inv ? IDX.R0 : mode === 'white' ? IDX.WHITE : IDX.R5;
  // Thin and sharp (max-wins by brightness): trunk = dark halo ring, bright 3 px band, 1 px hot core; forks are one
  // step thinner and dimmer than the trunk. The white frame is a 3 px white core in an R4 rim.
  const white = mode === 'white';
  stampLine(p, path.trunk, 1.6 * s, white && !inv ? IDX.R4 : halo);
  for (const f of path.forks) stampLine(p, f, 1.0, halo);
  stampLine(p, path.trunk, 1.0 * s, white ? body : inv ? IDX.R1 : IDX.R4);
  for (const f of path.forks) stampLine(p, f, 0.5, s >= 1 ? forkHalo : IDX.R2);
  stampLine(p, path.trunk, 0.5, core);
  // Glow beads every 3rd trunk point.
  for (let k = 0; k < path.trunk.length / 2; k += 3) p.glowAt(path.trunk[k * 2], path.trunk[k * 2 + 1], 3, 2);
}

export const bolt: Template<'bolt'> = {
  id: 'bolt',
  use: () => 'once',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const style = styleOf(motif);
    const L = Math.hypot(prm.dx, prm.dy);
    // Canvas = path bbox + displacement margin, capped at the pooled 512 px bolt texture (docs/VFX.md §8.5).
    const pad = Math.ceil(Math.min(40, L * prm.jag * 0.7) + 6);
    const adx = Math.round(Math.abs(prm.dx)),
      ady = Math.round(Math.abs(prm.dy));
    const px = Math.max(2, Math.min(pad, Math.floor((BOLT_TEX - 1 - adx) / 2))),
      py = Math.max(2, Math.min(pad, Math.floor((BOLT_TEX - 1 - ady) / 2)));
    const x0 = Math.min(0, Math.round(prm.dx)) - px,
      y0 = Math.min(0, Math.round(prm.dy)) - py;
    const w = adx + px * 2 + 1,
      h = ady + py * 2 + 1;
    const S = new Strip(w, h, -x0, -y0, seedOf(key, u), opts, { glowFrom: 'none' });
    const rndA = mulberry32(prm.seed >>> 0);
    const rndB = mulberry32((prm.seed ^ 0x9e3779b9) >>> 0);
    const first = makePath(prm, rndA);
    const second = makePath(prm, rndB);
    const heroKind = style === 'inverted' ? 'normal' : 'hero';
    if (prm.seq === 'zap') {
      // Peak first (white), then the re-seeded shape in normal ink: a 3-frame side bolt.
      S.add(33, (p) => {
        inkBolt(p, first, prm, style, 'white');
        p.dot(0, 0, IDX.R5);
        p.dot(prm.dx, prm.dy, IDX.R5);
      }, heroKind);
      S.add(33, (p) => inkBolt(p, second, prm, style, 'bolt'));
      return S.done('once');
    }
    S.add(33, (p) => {
      p.disc(prm.dx, prm.dy, 3, IDX.R0);
      inkBolt(p, first, prm, style, 'bolt');
    }, 'contrast');
    S.add(33, (p) => inkBolt(p, second, prm, style, 'white'), heroKind);
    S.blank(33);
    S.add(50, (p) => inkBolt(p, first, prm, style, 'remnant'));
    S.blank(33);
    S.add(50, (p, rnd) => {
      const n = 2 + Math.floor(rnd() * 3);
      const pts = first.trunk;
      const m = pts.length / 2;
      for (let k = 0; k < n; k++) {
        const nearEnd = k % 2 === 0 ? Math.floor(rnd() * m * 0.2) : m - 1 - Math.floor(rnd() * m * 0.2);
        const j = Math.max(0, Math.min(m - 2, nearEnd));
        const len = 3 + rnd() * 2;
        const ax = pts[j * 2],
          ay = pts[j * 2 + 1];
        const a = Math.atan2(pts[j * 2 + 3] - ay, pts[j * 2 + 2] - ax) + (rnd() - 0.5);
        p.line(ax, ay, ax + Math.cos(a) * len, ay + Math.sin(a) * len, IDX.R3);
      }
    });
    return S.done('once');
  },
};
