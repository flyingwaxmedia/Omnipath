// field: the living interior of a zone (docs/VFX.md §5, §6.9). One small ground-hugging unit per family, in that
// family's grayscale language (§3.3): low flames, ripples, rubble, a swirl, a crawling arc, an ink pool, a ground
// glyph, frost, a bubbling crust, rain splashes, a twinkling star, caltrops, a woven rune, a smoke wisp, a bubbling
// puddle, ki rings. The runtime scatters a handful inside the zone's hit area; each loops 6 x 117 ms (0.7 s) while the
// zone stands. Anchored on its ground point; never taller than ~12 px, so a field never hides who stands in it.
import { IDX, type FamilyId, type FieldParams, type Template } from '../types';
import { midpoint, type Painter } from '../painter';
import { mulberry32 } from '../../../core/rng';
import { Strip, chip, glint, mkKey, plus, runeMark, seedOf, type Rng, type TemplateOptions } from './kit';
import { tongue } from './erupt';

const N = 6;
const MATTER: ReadonlySet<FamilyId> = new Set<FamilyId>(['earth', 'ice', 'steel', 'magma', 'danger']);

function keyOf(p: FieldParams, motif: FamilyId, opts: TemplateOptions): string {
  return mkKey('field', { size: p.size }, motif, opts);
}

/** A flat ground ring (ellipse 1 px band) with ordered coverage `a`. */
function ripple(p: Painter, rx: number, ink: number, a = 1, cx = 0): void {
  if (rx < 1) return;
  p.band(cx, 0, rx, Math.max(1, rx * 0.45), 1, ink, a);
}

function unit(p: Painter, motif: FamilyId, f: number, k: number, seed: number): void {
  const rnd: Rng = mulberry32(seed + f * 7919);
  const fix: Rng = mulberry32(seed);
  const t = f / N;
  switch (motif) {
    case 'fire':
      p.ellipse(0, 0, 5 * k, 1.5 * k, IDX.R1, 0.5);
      tongue(p, (5 + (f % 2)) * k, 2 * k, f * 1.05, 0, -3 * k, 0);
      tongue(p, (4 + ((f + 1) % 2)) * k, 1.6 * k, f * 1.3 + 2, 0, 3 * k, 0);
      p.dot(1, -(6 + f * 1.4) * k, f < 4 ? IDX.R5 : IDX.R3);
      break;
    case 'water':
      ripple(p, (2 + f * 1.3) * k, f < 2 ? IDX.R5 : IDX.R4, 1 - t * 0.5);
      ripple(p, (2 + ((f + 3) % N) * 1.3) * k, IDX.R3, 1 - (((f + 3) % N) / N) * 0.5);
      if (f === 0) p.dot(0, -1, IDX.ACCENT);
      break;
    case 'earth': {
      const hop = [0, 1, 2, 1, 0, 0];
      chip(p, -4 * k, -1, IDX.R2, true);
      chip(p, 3 * k, -hop[f], IDX.R3);
      chip(p, 0, 1 - hop[(f + 3) % N], IDX.R1);
      p.dot(-1 + f, -3 - hop[f], IDX.S2, 0.5);
      break;
    }
    case 'wind': {
      const a0 = f * 60;
      p.band(0, 0, 6 * k, 2.7 * k, 1, IDX.R4, 1, [a0, a0 + 140]);
      p.band(0, 0, 3 * k, 1.4 * k, 1, IDX.R3, 1, [a0 + 180, a0 + 300]);
      const la = ((a0 + 150) * Math.PI) / 180;
      p.dot(Math.cos(la) * 6 * k, Math.sin(la) * 2.7 * k - 1, IDX.ACCENT);
      break;
    }
    case 'lightning':
    case 'storm': {
      const L = 6 * k;
      const pts = midpoint(-L, 0, L, 0, 0.32, rnd, 2);
      for (let j = 0; j < pts.length / 2; j++) p.stamp(pts[j * 2], pts[j * 2 + 1] * 0.5, 1, IDX.R1, 1, true);
      p.polyline(pts.map((v, j) => (j % 2 ? v * 0.5 : v)), (u) => (u > 0.3 && u < 0.7 ? IDX.R5 : IDX.R4), 1, true);
      if (f % 2 === 0) p.line(0, 0, (rnd() - 0.5) * 6 * k, -3 * k, IDX.R4);
      if (motif === 'storm') {
        // Slanted rain and a splash.
        const x = (fix() - 0.5) * 8 * k;
        const y = -9 * k + t * 9 * k;
        p.line(x - 2, y - 3, x, y, IDX.ACCENT);
        p.dot(x + 3 * k, -t * 2, IDX.S3);
      }
      break;
    }
    case 'shadow':
    case 'stealth': {
      const dark = motif === 'shadow' ? IDX.R0 : IDX.S1;
      p.ellipse(0, 0, 5.5 * k, 2 * k, dark, motif === 'shadow' ? 1 : 0.5);
      p.band(0, 0, 5.5 * k, 2 * k, 1, (_q, deg) => (deg < -20 && deg > -160 ? IDX.R3 : 0));
      // A tendril waving out of the pool (shadow) / a low wisp drifting (stealth).
      const sway = Math.sin(t * Math.PI * 2);
      const h = (4 + Math.sin(t * Math.PI * 2 + 1) * 1.5) * k;
      if (motif === 'shadow') p.polyline([-1, 0, -1 + sway, -h * 0.5, -1 + sway * 2, -h], (u) => (u > 0.75 ? IDX.R4 : IDX.R1));
      else {
        p.ellipse(-2 + f * 0.6, -2 * k, 3 * k, 1.2 * k, IDX.S2, 0.5);
        p.dot(-2 + f * 0.6, -2 * k - 1, IDX.R3);
      }
      break;
    }
    case 'holy': {
      p.band(0, 0, 5 * k, 2.2 * k, 1, (_q, deg) => (Math.abs(((deg - f * 60 + 540) % 360) - 180) < 40 ? IDX.R5 : IDX.R3));
      plus(p, 0, 0, f % 3 === 0 ? IDX.R5 : IDX.R4, IDX.R4);
      const y = -(2 + f * 1.5) * k;
      if (f < 5) plus(p, 3 * k, y, IDX.R5, f < 3 ? IDX.R4 : IDX.R3);
      break;
    }
    case 'ice': {
      const tips: [number, number][] = [
        [-3 * k, 5 * k],
        [0.5 * k, 7 * k],
        [4 * k, 4 * k],
      ];
      tips.forEach(([x, h], j) => {
        p.poly([x - 1.6 * k, 0, x + 1.6 * k, 0, x + 0.4, -h], (lx) => (lx < x ? IDX.R4 : IDX.R2));
        if (f === j * 2) glint(p, x, -h + 1, 1, IDX.R5, IDX.R4);
      });
      p.outline();
      break;
    }
    case 'magma': {
      p.ellipse(0, 0, 5.5 * k, 2 * k, IDX.S1);
      p.line(-4 * k, 0, -1, 1, IDX.R3);
      p.line(1, -1, 4 * k, 0, f % 2 ? IDX.R4 : IDX.R3);
      p.outline(IDX.S0, (v) => v === IDX.S1);
      if (f < 4) {
        p.ring(0, -1 - f * 0.5, 1 + f * 0.6 * k, 1, f < 2 ? IDX.R4 : IDX.R5);
      } else if (f === 4) {
        for (const [dx, dy] of [
          [-3, -3],
          [3, -3],
          [0, -5],
          [-2, -1],
        ])
          p.dot(dx * k, dy * k, IDX.R5);
      }
      break;
    }
    case 'twilight': {
      const arm = [1, 2, 3, 2, 1, 0][f];
      p.crescent(-4 * k, -2, 2.6 * k, 1.2, -0.6, 2.3 * k, IDX.R3);
      if (arm) glint(p, 3 * k, -3 * k, arm, IDX.ACCENT, IDX.R4);
      p.dot(-1 + f, -6 * k + f, IDX.R2);
      break;
    }
    case 'arcane': {
      // A woven rune: two crossing threads under a glyph, inside a slow ground ring.
      p.band(0, 0, 6 * k, 2.6 * k, 1, (_q, deg) => (Math.abs(((deg - f * 60 + 540) % 360) - 180) < 35 ? IDX.R4 : IDX.R2));
      p.line(-6 * k, -1.5 * k, 6 * k, 1.5 * k, IDX.R2, 0.5);
      p.line(-6 * k, 1.5 * k, 6 * k, -1.5 * k, IDX.R2, 0.5);
      runeMark(p, 0, -3 * k, seed, f % 3 === 0 ? IDX.R5 : IDX.ACCENT, 5);
      break;
    }
    case 'toxin': {
      p.ellipse(0, 0, 5.5 * k, 1.9 * k, IDX.R2);
      p.band(0, 0, 5.5 * k, 1.9 * k, 1, IDX.ACCENT);
      if (f < 4) {
        p.ring(-1, -1 - f * 1.3 * k, 1.5 + (f > 1 ? 0.6 : 0), 1, IDX.R4);
      } else if (f === 4)
        for (const [dx, dy] of [
          [0, -3],
          [3, 0],
          [-3, 0],
        ])
          p.dot(-1 + dx, -5 * k + dy, IDX.R3);
      p.dot(3 * k, -1, f % 2 ? IDX.R4 : IDX.R3);
      break;
    }
    case 'spirit': {
      const r = (2 + f * 1.2) * k;
      ripple(p, r + 3, IDX.R4, 1 - t * 0.5);
      ripple(p, r, f < 2 ? IDX.R5 : IDX.R3, 1 - t * 0.5);
      break;
    }
    case 'steel':
    default: {
      // Caltrops: three ground spikes and one up, with a glint on the up-spike.
      const one = (x: number, y: number, s: number, lit: boolean): void => {
        p.line(x, y, x - 3 * s, y + 1, IDX.R2);
        p.line(x, y, x + 3 * s, y + 1, IDX.R3);
        p.line(x, y, x + 1, y + 2 * s, IDX.R2);
        p.line(x, y, x, y - 4 * s, (u) => (u > 0.6 ? IDX.R5 : IDX.R4));
        if (lit) glint(p, x, y - 4 * s, 1, IDX.R5, IDX.R4);
      };
      one(-3 * k, 0, k, f === 0);
      one(4 * k, 1, k * 0.8, f === 3);
      p.outline();
      break;
    }
  }
}

export const field: Template<'field'> = {
  id: 'field',
  use: () => 'loop',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const k = prm.size === 'm' ? 1.4 : 1;
    const W = Math.ceil(22 * k),
      H = Math.ceil(18 * k);
    const S = new Strip(W, H, W >> 1, H - Math.ceil(5 * k), seedOf(key, u), opts, { matter: MATTER.has(motif), glowFrom: 'hot' });
    for (let f = 0; f < N; f++) S.add(117, (p) => unit(p, motif, f, k, S.seed));
    return S.done('loop');
  },
};
