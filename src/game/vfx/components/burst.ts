// burst: hit sparks by impact class, muzzle flashes, split stars, glints, fizzles and the spark-moment star
// (docs/VFX.md §5, §6.3). Classes slash and pierce face the blow direction (8 dirs); the rest are radial.
// Normal timing 50 · 50 · 67 · 67 · 67 · empty; tick 33 · 50 · 50 · empty.
import { IDX, type BurstClass, type BurstParams, type FamilyId, type Template } from '../types';
import { starPts, type Painter } from '../painter';
import { Strip, chip, elementGlyph, glint, headingOf, motifMark, mkKey, plus, seedOf, spark, type Rng, type TemplateOptions } from './kit';

const CELL: Record<BurstParams['size'], number> = { s: 16, m: 24, l: 32 };
const DIRECTIONAL: ReadonlySet<BurstClass> = new Set<BurstClass>(['slash', 'pierce']);

function cellOf(p: BurstParams): number {
  if (p.cls === 'star') return 64;
  if (p.cls === 'tick') return 16;
  return CELL[p.size];
}

function keyOf(p: BurstParams, motif: FamilyId, opts: TemplateOptions): string {
  const fields: Record<string, unknown> = { cls: p.cls };
  if (p.cls !== 'star' && p.cls !== 'tick') fields.size = p.size;
  if (p.cls === 'strong') fields.glyph = p.glyph ?? 'none';
  return mkKey('burst', fields, p.cls === 'magic' ? motif : null, opts);
}

/** n rays from r0 to r1 starting at angle rot; ink by t along the ray. */
function rays(p: Painter, n: number, r0: number, r1: number, rot: number, ink: (t: number) => number, thick = false): void {
  for (let k = 0; k < n; k++) {
    const a = rot + (k * Math.PI * 2) / n;
    const x0 = Math.cos(a) * r0,
      y0 = Math.sin(a) * r0,
      x1 = Math.cos(a) * r1,
      y1 = Math.sin(a) * r1;
    if (thick) p.stroke(x0, y0, x1, y1, (t) => Math.max(1, 2.4 * (1 - t * 0.6)), (t) => ink(t));
    else p.line(x0, y0, x1, y1, ink);
  }
}

/** A 1 px ring with hashed gaps (fraction `gap` of 8-px units missing). */
function brokenRing(p: Painter, r: number, ink: number, gap: number, rnd: Rng): void {
  const units = Math.max(4, Math.round((Math.PI * 2 * r) / 4));
  const keep: boolean[] = [];
  for (let k = 0; k < units; k++) keep.push(rnd() >= gap);
  p.ring(0, 0, r, 1, (_q, deg) => (keep[Math.floor((((deg + 360) % 360) / 360) * units) % units] ? ink : 0));
}

/** Ring broken into `n` short arcs that drift outward. */
function arcs(p: Painter, r: number, n: number, ink: number, rot: number): void {
  for (let k = 0; k < n; k++) {
    const a0 = rot + (k * 360) / n;
    p.band(0, 0, r, r, 1, ink, 1, [a0, a0 + 360 / n / 2.2]);
  }
}

function dots(p: Painter, n: number, r0: number, r1: number, ink: number, rnd: Rng): void {
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    const r = r0 + rnd() * (r1 - r0);
    p.dot(Math.cos(a) * r, Math.sin(a) * r, ink);
  }
}

export const burst: Template<'burst'> = {
  id: 'burst',
  use: () => 'once',
  dirs: (p) => (DIRECTIONAL.has(p.cls) ? 8 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const C = cellOf(prm);
    const k = C / 24;
    const R = C / 2 - 1;
    const heading = DIRECTIONAL.has(prm.cls) ? headingOf(u, 8) : 0;
    const S = new Strip(C, C, C / 2, C / 2, seedOf(key, u), opts, { orphans: true, glowFrom: 'hot', matter: prm.cls === 'blunt' || prm.cls === 'star' });
    const rot0 = S.rng() * Math.PI;
    const add = (ms: number, draw: (p: Painter, rnd: Rng) => void, kind: 'normal' | 'hero' | 'contrast' = 'normal') => S.add(ms, draw, kind, heading);
    const cool = (t: number) => (t < 0.3 ? IDX.WHITE : t < 0.65 ? IDX.R4 : IDX.R3);
    switch (prm.cls) {
      case 'slash':
        add(50, (p) => {
          glint(p, 0, 0, Math.max(2, Math.round(3 * k)), IDX.WHITE, IDX.R5);
          p.line(-2 * k, 0, Math.min(R, 11 * k), 0, (t) => (t < 0.6 ? IDX.WHITE : IDX.R5));
        }, 'hero');
        add(50, (p) => {
          rays(p, 7, 2, Math.min(R, 8 * k), rot0, cool);
          p.ring(0, 0, Math.max(2, 4 * k), 1, IDX.R4);
        }, 'hero');
        add(67, (p, rnd) => {
          rays(p, 7, 4 * k, Math.min(R, 8 * k), rot0, (t) => (t < 0.5 ? IDX.R3 : IDX.R2));
          brokenRing(p, Math.min(R, 7 * k), IDX.R3, 0.3, rnd);
        });
        add(67, (p, rnd) => {
          arcs(p, Math.min(R, 8.5 * k), 5, IDX.R2, rot0 * 57);
          for (let j = 0; j < 3; j++) {
            const a = rnd() * Math.PI * 2;
            spark(p, Math.cos(a) * 6 * k, Math.sin(a) * 6 * k, a, 2, IDX.R4, IDX.R3);
          }
        });
        add(67, (p, rnd) => dots(p, 5, Math.min(R - 1, 9 * k), Math.min(R, 11 * k), IDX.R1, rnd));
        break;
      case 'pierce':
        add(50, (p) => {
          p.stamp(0, 0, 1, IDX.WHITE);
          for (const a of [0, -0.3, 0.3]) p.line(0, 0, Math.cos(a) * Math.min(R, 10 * k), Math.sin(a) * Math.min(R, 10 * k), cool);
        }, 'hero');
        add(50, (p) => {
          for (const a of [0, -0.3, 0.3]) p.line(2, 0, Math.cos(a) * R, Math.sin(a) * R, (t) => (t < 0.4 ? IDX.R5 : IDX.R4));
          p.ring(0, 0, Math.max(2, 3 * k), 1, IDX.R4);
        });
        add(67, (p, rnd) => {
          for (const a of [0, -0.3, 0.3]) p.line(R * 0.45, 0, Math.cos(a) * R, Math.sin(a) * R, IDX.R3);
          brokenRing(p, Math.max(3, 5 * k), IDX.R3, 0.3, rnd);
        });
        add(67, (p) => arcs(p, Math.max(4, 6.5 * k), 4, IDX.R2, 20));
        add(67, (p, rnd) => dots(p, 4, R * 0.6, R, IDX.R1, rnd));
        break;
      case 'blunt': {
        if (prm.size === 'l') add(33, (p) => p.disc(0, 0, 6 * k, IDX.R0), 'contrast');
        const chips: [number, number][] = [];
        for (let j = 0; j < 3 + Math.floor(S.rng() * 3); j++) {
          const a = -Math.PI / 2 + (S.rng() - 0.5) * 2.6;
          chips.push([Math.cos(a), Math.sin(a)]);
        }
        add(50, (p) => p.disc(0, 0, Math.max(2, 4 * k), IDX.WHITE), 'hero');
        add(50, (p) => {
          rays(p, 6, 3 * k, Math.min(R, 8 * k), rot0, (t) => (t < 0.5 ? IDX.R4 : IDX.R3), true);
          p.disc(0, 0, Math.max(1, 3 * k), IDX.R5);
        });
        add(67, (p) => {
          rays(p, 6, 5 * k, Math.min(R, 8.5 * k), rot0, () => IDX.R2, true);
          p.disc(-5 * k, 3 * k, 2.5 * k, IDX.S2);
          p.disc(5 * k, 3 * k, 2.5 * k, IDX.S1);
          for (const [cx, cy] of chips) chip(p, cx * 6 * k, cy * 6 * k, IDX.R2);
        });
        add(67, (p) => {
          p.disc(-6 * k, 3 * k, 3 * k, IDX.S1, 0.5);
          p.disc(6 * k, 3 * k, 3 * k, IDX.S0, 0.5);
          for (const [cx, cy] of chips) chip(p, cx * 8.5 * k, cy * 8.5 * k + 1, IDX.R2);
        });
        add(67, (p) => {
          p.disc(-6 * k, 3 * k, 3 * k, IDX.S0, 0.25);
          for (const [cx, cy] of chips) p.dot(cx * 10 * k, cy * 10 * k + 3, IDX.R1);
        });
        break;
      }
      case 'magic': {
        const spokes = 6;
        // Hero: a white-hot core with a 4-point flare (wind never uses white: R5 instead).
        const hot = motif === 'wind' ? IDX.R5 : IDX.WHITE;
        add(50, (p) => {
          glint(p, 0, 0, Math.max(3, Math.round(5 * k)), hot, IDX.R5);
          p.disc(0, 0, Math.max(1, 1.6 * k), hot);
        }, motif === 'wind' ? 'normal' : 'hero');
        add(50, (p, rnd) => {
          p.ring(0, 0, Math.max(2, 4 * k), 1, IDX.R4);
          for (let j = 0; j < spokes; j++) {
            const a = rot0 + (j * Math.PI * 2) / spokes;
            motifMark(p, motif, Math.cos(a) * 6 * k, Math.sin(a) * 6 * k, a, k, rnd);
          }
          p.dot(0, 0, IDX.R5);
        });
        add(67, (p, rnd) => {
          for (let j = 0; j < spokes; j++) {
            const a = rot0 + (j * Math.PI * 2) / spokes + 0.15;
            motifMark(p, motif, Math.cos(a) * 8 * k, Math.sin(a) * 8 * k - (motif === 'fire' ? 1 : 0), a, k * 0.8, rnd);
          }
        });
        add(67, (p, rnd) => {
          brokenRing(p, Math.min(R, 9 * k), IDX.R2, 0.45, rnd);
          dots(p, 3, 6 * k, 9 * k, IDX.R3, rnd);
        });
        add(67, (p, rnd) => dots(p, 4, 8 * k, Math.min(R, 11 * k), IDX.R1, rnd));
        break;
      }
      case 'ki':
        add(50, (p) => p.disc(0, 0, Math.max(1.5, 3 * k), IDX.WHITE), 'hero');
        add(50, (p) => {
          rays(p, 6, 3 * k, Math.min(R, 7 * k), rot0, (t) => (t < 0.5 ? IDX.R5 : IDX.R4), true);
          p.ring(0, 0, Math.min(R, 5 * k), 1, IDX.R4);
        });
        add(67, (p) => {
          p.ring(0, 0, Math.min(R, 7 * k), 1, IDX.R4);
          p.ring(0, 0, Math.min(R, 7 * k) - 3, 1, IDX.R3);
        });
        add(67, (p, rnd) => {
          brokenRing(p, Math.min(R, 9.5 * k), IDX.R3, 0.25, rnd);
          brokenRing(p, Math.min(R, 9.5 * k) - 3, IDX.R2, 0.25, rnd);
        });
        add(67, (p, rnd) => brokenRing(p, R, IDX.R2, 0.55, rnd));
        break;
      case 'crit':
      case 'strong': {
        const r1 = R * 0.95;
        const pts = starPts(0, 0, 8, r1 * 0.4, r1 * 1.06, rot0);
        add(33, (p) => p.poly(pts, IDX.R0), 'contrast');
        add(33, (p) => {
          p.star(0, 0, 8, r1 * 0.42, r1 * 1.08, rot0, (lx, ly) => (Math.hypot(lx, ly) < r1 * 0.55 ? IDX.WHITE : IDX.R5));
        }, 'hero');
        add(50, (p) => {
          p.star(0, 0, 8, r1 * 0.36, r1 * 0.92, rot0, (lx, ly) => (Math.hypot(lx, ly) < r1 * 0.3 ? IDX.WHITE : IDX.R4));
          if (prm.cls === 'strong' && prm.glyph) elementGlyph(p, 0, 0, prm.glyph);
        }, 'hero');
        add(67, (p) => {
          p.star(0, 0, 8, r1 * 0.3, r1 * 0.72, rot0 + 0.2, (lx, ly) => (Math.hypot(lx, ly) < r1 * 0.3 ? IDX.R4 : IDX.R3));
          p.ring(0, 0, R, 1, IDX.R4);
          if (prm.cls === 'strong' && prm.glyph) elementGlyph(p, 0, 0, prm.glyph);
        });
        add(67, (p, rnd) => {
          arcs(p, R, 5, IDX.R3, rot0 * 50);
          for (let j = 0; j < 6; j++) {
            const a = rnd() * Math.PI * 2;
            spark(p, Math.cos(a) * R * 0.4, Math.sin(a) * R * 0.4, a, 2, IDX.R4, IDX.R3);
          }
          if (prm.cls === 'strong' && prm.glyph) elementGlyph(p, 0, 0, prm.glyph, IDX.R4);
        });
        add(67, (p, rnd) => dots(p, 6, R * 0.7, R, IDX.R2, rnd));
        break;
      }
      case 'tick':
        add(33, (p) => plus(p, 0, 0, IDX.WHITE, IDX.R5), 'hero');
        add(50, (p) => rays(p, 4, 2, 5, rot0, (t) => (t < 0.5 ? IDX.R5 : IDX.R4)));
        add(50, (p) => {
          for (let j = 0; j < 4; j++) {
            const a = rot0 + (j * Math.PI) / 2;
            p.dot(Math.cos(a) * 6, Math.sin(a) * 6, IDX.R2);
          }
        });
        break;
      case 'resist':
        add(50, (p) => p.ring(0, 0, Math.max(2, 3 * k), 1, IDX.R3));
        add(67, (p) => p.ring(0, 0, Math.max(3, 6 * k), 1, IDX.R2));
        add(67, (p, rnd) => brokenRing(p, Math.min(R, 8 * k), IDX.R1, 0.4, rnd));
        break;
      case 'immune':
        add(67, (p) => {
          p.ring(0, 0, Math.min(R, 5 * k), 1, IDX.R2);
          const d = 3 * k;
          p.line(-d, -d, d, d, IDX.R3);
          p.line(-d, d, d, -d, IDX.R3);
        });
        add(67, (p) => {
          p.ring(0, 0, Math.min(R, 6 * k), 1, IDX.R2);
          const d = 2.5 * k;
          p.line(-d, -d, d, d, IDX.R2);
          p.line(-d, d, d, -d, IDX.R2);
        });
        add(67, (p, rnd) => brokenRing(p, Math.min(R, 7 * k), IDX.R1, 0.5, rnd));
        break;
      case 'muzzle':
        add(33, (p) => {
          glint(p, 0, 0, 2, IDX.WHITE, IDX.WHITE);
          for (const [dx, dy] of [
            [1, 1],
            [-1, 1],
            [1, -1],
            [-1, -1],
          ])
            p.dot(dx, dy, IDX.R5);
        }, 'hero');
        add(50, (p) => {
          rays(p, 3, 1, Math.min(R, 5 * k), rot0, (t) => (t < 0.5 ? IDX.R5 : IDX.R3));
          p.disc(0, 0, 1.5, IDX.R4);
        });
        add(67, (p) => {
          p.dot(Math.cos(rot0) * 4 * k, Math.sin(rot0) * 4 * k, IDX.R2);
          p.dot(-Math.cos(rot0) * 3 * k, -Math.sin(rot0) * 3 * k, IDX.R2);
        });
        break;
      case 'split':
        add(33, (p) => p.star(0, 0, 6, 1.5 * k, Math.min(R, 5 * k), -Math.PI / 2, IDX.WHITE), 'hero');
        add(50, (p) => p.star(0, 0, 6, 2 * k, Math.min(R, 8 * k), -Math.PI / 2, (lx, ly) => (Math.hypot(lx, ly) < 2.5 * k ? IDX.R5 : IDX.R4)));
        add(67, (p) => rays(p, 6, 5 * k, Math.min(R, 10 * k), -Math.PI / 2, () => IDX.R3));
        break;
      case 'glint':
        for (const L of [1, 2, 3, 2, 1]) add(33, (p) => glint(p, 0, 0, Math.max(1, Math.round(L * Math.min(1.4, k + 0.2))), IDX.R5, IDX.R4));
        break;
      case 'fizzle':
        add(50, (p) => {
          p.disc(0, 0, Math.max(2, 3 * k), IDX.R2);
          p.disc(-1, -1, Math.max(1, 1.5 * k), IDX.R3);
        });
        add(67, (p) => p.crescent(0, -1, Math.max(2.5, 4 * k), 1.5 * k, 1.5 * k, Math.max(2, 3.5 * k), IDX.R1));
        add(67, (p) => p.crescent(0, -2, Math.max(3, 4.5 * k), 1 * k, 1 * k, Math.max(3, 4.6 * k), IDX.R1));
        break;
      case 'star': {
        const r1 = 28,
          r0 = 12;
        const crack: number[] = [];
        for (let j = 0; j < 6; j++) crack.push(-14 + j * 5.5, (j % 2 ? 3 : -3) + (S.rng() - 0.5) * 2);
        const starInk = (inner: number) => (lx: number, ly: number) => {
          const d = Math.hypot(lx, ly);
          return d < 6 ? inner : d < 12 ? IDX.R5 : d > 20 ? IDX.R3 : IDX.R4;
        };
        add(33, (p) => p.star(0, 0, 8, r0, r1, -Math.PI / 2, (lx, ly) => (Math.hypot(lx, ly) < 16 ? IDX.WHITE : IDX.R5)), 'hero');
        add(200, (p) => {
          p.star(0, 0, 8, r0, r1, -Math.PI / 2, starInk(IDX.R5));
          p.outline(IDX.R1);
          p.polyline(crack, IDX.OUTLINE);
        });
        add(67, (p) => {
          p.star(0, 0, 8, r0 * 0.9, r1 * 0.9, -Math.PI / 2 + 0.1, starInk(IDX.R4));
          p.polyline(crack, IDX.OUTLINE);
          rays(p, 8, r1 * 0.95, R, -Math.PI / 2, () => IDX.R4);
        });
        add(67, (p) => {
          p.star(0, 0, 8, r0 * 0.8, r1 * 0.8, -Math.PI / 2 + 0.2, starInk(IDX.R3));
          p.erode(0.5, 'bayer', S.seed);
        });
        add(67, (p) => {
          p.star(0, 0, 8, r0 * 0.7, r1 * 0.7, -Math.PI / 2 + 0.3, IDX.R2);
          p.erode(0.75, 'bayer', S.seed);
        });
        break;
      }
    }
    return S.done('once');
  },
};
