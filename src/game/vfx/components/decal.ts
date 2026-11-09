// decal: ground fills and aftermath (docs/VFX.md §5, P14). Never rimmed, so a decal never resembles a hazard
// telegraph. 'fill' and 'shadow' are static loops the runtime swaps by bucket / density; the aftermath kinds are
// one-shots: hold, then dissolve 50 -> 25 -> 12.5 -> 0 % every 100 ms, life <= 1000 ms (pool 1600), <= 25 % coverage
// after 600 ms. shape 'line' (16 dirs): r is HALF the length and the anchor is the line's midpoint (docs/VFX.md §6.8).
import { IDX, type DecalParams, type Template } from '../types';
import { hash01 } from '../dither';
import type { Painter } from '../painter';
import { Strip, headingOf, mkKey, runeMark, seedOf, type Rng, type TemplateOptions } from './kit';

const LOOPED = new Set<DecalParams['kind']>(['fill', 'shadow']);
const NO_DENSITY = new Set<DecalParams['kind']>(['cracks', 'rune', 'rift', 'pool', 'frost']);

function keyOf(p: DecalParams, _motif: unknown, opts: TemplateOptions): string {
  const f: Record<string, unknown> = { kind: p.kind, r: p.r, aspect: p.aspect, shape: p.shape };
  if (!NO_DENSITY.has(p.kind)) f.density = p.density;
  return mkKey('decal', f, null, opts);
}

/** (coverage, ms) steps of the standard dissolve from a starting density. */
function schedule(start: number): [number, number][] {
  if (start >= 0.5)
    return [
      [0.5, 200],
      [0.5, 200],
      [0.5, 100],
      [0.25, 100],
      [0.125, 100],
    ];
  if (start >= 0.25)
    return [
      [0.25, 200],
      [0.25, 200],
      [0.25, 200],
      [0.125, 100],
    ];
  return [
    [0.125, 200],
    [0.125, 200],
    [0.125, 200],
    [0.125, 100],
  ];
}

/** Zigzag crack polylines from the centre, or along local x from -r to r for lines (r = half length). */
function crackPaths(r: number, aspect: number, line: boolean, rnd: Rng): number[][] {
  const out: number[][] = [];
  if (line) {
    const main: number[] = [];
    for (let x = -r; x <= r; x += 4) main.push(x, Math.abs(x) >= r - 1 ? 0 : Math.round((rnd() - 0.5) * 4));
    out.push(main);
    for (let k = 0; k < Math.max(2, Math.floor(r / 12)); k++) {
      const j = 1 + Math.floor(rnd() * (main.length / 2 - 2));
      const x = main[j * 2],
        y = main[j * 2 + 1];
      const s = rnd() < 0.5 ? -1 : 1;
      out.push([x, y, x + 3 + rnd() * 3, y + s * (3 + rnd() * 3), x + 5 + rnd() * 4, y + s * (5 + rnd() * 3)]);
    }
    return out;
  }
  const n = 4 + Math.floor(rnd() * 4);
  for (let k = 0; k < n; k++) {
    const a = ((k + rnd() * 0.6) / n) * Math.PI * 2;
    const len = r * (0.45 + rnd() * 0.4);
    const pts: number[] = [Math.cos(a) * 2, Math.sin(a) * 2 * aspect];
    const segs = Math.max(2, Math.round(len / 5));
    for (let s = 1; s <= segs; s++) {
      const d = (s / segs) * len;
      const j = (rnd() - 0.5) * 0.5;
      pts.push(Math.cos(a + j) * d, Math.sin(a + j) * d * aspect);
    }
    out.push(pts);
  }
  return out;
}

export const decal: Template<'decal'> = {
  id: 'decal',
  use: (p) => (LOOPED.has(p.kind) ? 'loop' : 'once'),
  dirs: (p) => (p.shape === 'line' ? 16 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const line = prm.shape === 'line';
    const r = prm.r;
    const asp = prm.aspect;
    const S = line
      ? new Strip(2 * (r + 10) + 1, 2 * (r + 10) + 1, r + 10, r + 10, seedOf(key, u), opts, { glowFrom: 'none' })
      : new Strip(2 * r + 5, 2 * Math.ceil(r * asp) + 5, r + 2, Math.ceil(r * asp) + 2, seedOf(key, u), opts, { glowFrom: 'none' });
    const heading = line ? headingOf(u, 16) : 0;
    const noise = S.seed;
    // Area of the decal: an ellipse, or a capsule along +x for lines. Edges are hash-noised for organic kinds.
    const area = (p: Painter, ink: (lx: number, ly: number, fx: number, fy: number) => number, a: number, ragged = false) => {
      if (line) {
        p.stroke(-r, 0, r, 0, (t) => 10 * Math.min(1, Math.sin(Math.PI * t) * 3), (_t, _q, fx, fy) => ink(0, 0, fx, fy), 0, a);
        return;
      }
      p.fill(-r - 1, -r * asp - 1, r + 1, r * asp + 1, (lx, ly, fx, fy) => {
        const ang = Math.atan2(ly / asp, lx);
        const edge = ragged ? 0.82 + 0.18 * hash01(Math.floor(((ang + Math.PI) / (Math.PI * 2)) * 24), 3, noise) : 1;
        const d = Math.hypot(lx / (r + 0.35), ly / (r * asp + 0.35));
        return d <= edge ? ink(lx, ly, fx, fy) : 0;
      }, a);
    };
    const flat = (i: number) => () => i;
    const add = (ms: number, draw: (p: Painter) => void) => S.add(ms, draw, 'normal', heading);
    switch (prm.kind) {
      case 'fill':
        add(200, (p) => area(p, flat(IDX.R3), prm.density));
        return S.done('loop');
      case 'shadow':
        add(200, (p) => area(p, flat(IDX.R0), prm.density));
        return S.done('loop');
      case 'scorch':
      case 'ink':
      case 'wet':
      case 'frost': {
        // The decal's area is shaped once at full coverage; each step keeps it at an ordered density.
        const master = S.painter(heading);
        const ink = prm.kind === 'scorch' ? IDX.S0 : prm.kind === 'ink' ? IDX.R1 : prm.kind === 'wet' ? IDX.R2 : IDX.R4;
        area(master, prm.kind === 'frost' ? (_lx, _ly, fx, fy) => (hash01(fx, fy, noise) > 0.95 ? IDX.R5 : IDX.R4) : flat(ink), 1, prm.kind !== 'wet');
        const inner = S.painter(heading);
        if (prm.kind === 'scorch') area(inner, (lx, ly) => (Math.hypot(lx, ly / asp) < r * 0.55 ? IDX.R0 : 0), 1);
        const steps: [number, number][] =
          prm.kind === 'frost'
            ? [
                [0.125, 100],
                [0.25, 100],
                [0.5, 200],
                [0.5, 200],
                [0.25, 100],
                [0.125, 100],
              ]
            : schedule(prm.density);
        for (const [d, ms] of steps)
          add(ms, (p) => {
            for (let fy = 0; fy < p.h; fy++)
              for (let fx = 0; fx < p.w; fx++) {
                const k = fy * p.w + fx;
                if (inner.body[k] && p.pass(fx, fy, d * 0.5)) p.body[k] = inner.body[k];
                else if (master.body[k] && p.pass(fx, fy, d)) p.body[k] = master.body[k];
              }
          });
        return S.done('once');
      }
      case 'cracks': {
        const paths = crackPaths(r, line ? 1 : asp, line, S.rng);
        const steps: [number, number][] = [
          [0, 200],
          [0, 200],
          [0, 200],
          [0.5, 100],
          [0.75, 100],
        ];
        for (const [e, ms] of steps)
          add(ms, (p) => {
            for (const pts of paths) p.polyline(pts.map((v) => v + 1), IDX.R2);
            for (const pts of paths) p.polyline(pts, IDX.R1);
            if (e > 0) p.erode(e, 'hash', noise);
          });
        return S.done('once');
      }
      case 'rune': {
        const units = 12;
        for (const [d, ms] of schedule(0.5))
          add(ms, (p) => {
            const e = 1 - d / 0.5;
            p.band(0, 0, r * 0.9, r * 0.9 * asp, 1, (_q, deg) => (Math.floor((((deg + 360) % 360) / 360) * units) % 3 !== 2 ? IDX.R4 : 0));
            p.band(0, 0, r * 0.6, r * 0.6 * asp, 1, (_q, deg) => (Math.floor((((deg + 400) % 360) / 360) * units) % 2 === 0 ? IDX.R3 : 0));
            for (let k = 0; k < 4; k++) {
              const a = (k / 4) * Math.PI * 2 + 0.4;
              runeMark(p, Math.cos(a) * r * 0.75, Math.sin(a) * r * 0.75 * asp, noise + k, IDX.ACCENT);
            }
            if (e > 0) p.erode(e, 'bayer', noise);
          });
        return S.done('once');
      }
      case 'pool': {
        const bub: [number, number][] = [
          [(S.rng() - 0.5) * r, (S.rng() - 0.5) * r * asp],
          [(S.rng() - 0.5) * r, (S.rng() - 0.5) * r * asp],
        ];
        const cool = [IDX.R5, IDX.R4, IDX.R3];
        for (let f = 0; f < 3; f++)
          add(200, (p) => {
            area(p, (lx, ly) => (Math.hypot(lx, ly / asp) < r * 0.45 ? cool[f] : Math.max(IDX.R2, cool[f] - 1)), 1, true);
            if (f < 2) p.ring(bub[f][0], bub[f][1], 2, 1, IDX.R5);
          });
        for (let f = 0; f < 4; f++)
          add(200, (p) => area(p, (lx, ly) => (Math.hypot(lx, ly / asp) < r * 0.3 ? IDX.R2 : IDX.S1), 0.25, true));
        add(100, (p) => area(p, flat(IDX.S1), 0.125, true));
        return S.done('once');
      }
      case 'rift': {
        const hh = Math.max(6, Math.round(r * 0.62));
        const widths = [1, 2, 4, 6];
        const slit = (p: Painter, W: number) =>
          p.fill(-W - 1, -hh - 1, W + 1, hh + 1, (lx, ly) => {
            const half = (W / 2) * Math.sqrt(Math.max(0, 1 - (ly / hh) ** 2));
            const ax = Math.abs(lx);
            if (ax > half + 0.5) return 0;
            return ax > half - 0.6 ? IDX.R4 : IDX.R0;
          });
        for (const W of widths) add(50, (p) => slit(p, W));
        add(200, (p) => slit(p, 6));
        for (const W of [...widths].reverse()) add(50, (p) => slit(p, W));
        return S.done('once');
      }
    }
    return S.done('once');
  },
};
