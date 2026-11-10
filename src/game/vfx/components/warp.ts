// warp: a blink's two ends (docs/VFX.md §5, §6.9). 'out' = the actor leaves: the body turns to a column of light,
// folds into a vertical seam and the seam closes, family marks thrown sideways. 'in' = the seam opens where the
// actor arrives, widens to a body-high column over a landing ring and lets go. Shadow, stealth and twilight draw the
// seam inverted (dark core, bright rim). No WHITE: a blink is frequent, so it never counts against the flash budget.
// Cell (bodyW + 28) x (bodyH + 16), anchored at the feet. out 33 · 33 · 50 · 50 · 67 · 67; in mirrors it.
import { IDX, BODY_PX, type FamilyId, type Template, type WarpParams } from '../types';
import type { Painter } from '../painter';
import { Strip, mkKey, motifMark, seedOf, type Rng, type TemplateOptions } from './kit';

const INVERTED: ReadonlySet<FamilyId> = new Set<FamilyId>(['shadow', 'stealth', 'twilight']);

function keyOf(p: WarpParams, motif: FamilyId, opts: TemplateOptions): string {
  return mkKey('warp', { phase: p.phase, body: p.body }, motif, opts);
}

interface Geo {
  bw: number;
  bh: number;
  inv: boolean;
}

/** A body-high capsule of half-width `hw`: bright rim, dithered fill (the body turned to light). */
function column(p: Painter, g: Geo, hw: number, hgt: number, fill: number, a: number): void {
  const core = g.inv ? IDX.R0 : IDX.R5;
  const rim = g.inv ? IDX.R4 : IDX.R4;
  p.fill(-hw - 1, -hgt - 1, hw + 1, 1, (lx, ly, fx, fy) => {
    if (ly > 0 || ly < -hgt) return 0;
    // Rounded ends.
    const end = ly > -hw ? -hw - ly : ly < -hgt + hw ? ly + hgt - hw : 0;
    const half = end < 0 ? Math.sqrt(Math.max(0, hw * hw - end * end)) : hw;
    const dx = Math.abs(lx);
    if (dx > half + 0.3) return 0;
    if (dx > half - 1.2) return rim;
    if (dx < 0.8) return core;
    return p.pass(fx, fy, a) ? fill : 0;
  });
}

/** The seam: a `w` px vertical line over the middle `span` of the body height. */
function seam(p: Painter, g: Geo, w: number, span: number, ink: number): void {
  const y0 = -g.bh * (0.5 + span / 2),
    y1 = -g.bh * (0.5 - span / 2);
  const core = g.inv ? IDX.R0 : ink;
  for (let x = 0; x < w; x++) p.line(x - (w >> 1), y0, x - (w >> 1), y1, core);
  if (g.inv) {
    p.line(-(w >> 1) - 1, y0, -(w >> 1) - 1, y1, ink);
    p.line(w - (w >> 1), y0, w - (w >> 1), y1, ink);
  }
  p.dot(0, y0 - 1, ink);
  p.dot(0, y1 + 1, ink);
}

function floor(p: Painter, r: number, ink: number, a = 1): void {
  p.band(0, 0, r, Math.max(1, r * 0.35), 1, ink, a);
}

/** Family marks thrown sideways from the seam at distance d. */
function marks(p: Painter, motif: FamilyId, g: Geo, d: number, rnd: Rng): void {
  for (const [sx, fy] of [
    [-1, 0.3],
    [1, 0.45],
    [-1, 0.7],
    [1, 0.82],
  ]) {
    motifMark(p, motif, sx * d, -g.bh * fy, sx > 0 ? 0 : Math.PI, 1, rnd);
  }
}

export const warp: Template<'warp'> = {
  id: 'warp',
  use: () => 'once',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const bh = BODY_PX[prm.body],
      bw = Math.round(bh * 0.8);
    const W = bw + 28,
      H = bh + 16;
    const S = new Strip(W, H, W >> 1, H - 7, seedOf(key, u), opts, { glowFrom: 'hot', matter: motif === 'earth' || motif === 'magma' });
    const g: Geo = { bw, bh, inv: INVERTED.has(motif) };
    const hw = bw * 0.36;
    // Six stages from a full column to nothing; 'in' plays them backwards over a landing ring.
    const stage = (p: Painter, k: number, rnd: Rng): void => {
      switch (k) {
        case 0:
          column(p, g, hw, bh, IDX.R3, 0.5);
          break;
        case 1:
          column(p, g, hw * 0.5, bh * 1.08, IDX.R4, 0.5);
          break;
        case 2:
          seam(p, g, 2, 1, IDX.R5);
          marks(p, motif, g, 5, rnd);
          break;
        case 3:
          seam(p, g, 1, 0.6, IDX.R4);
          marks(p, motif, g, 10, rnd);
          break;
        case 4:
          for (const y of [0.3, 0.5, 0.7]) p.dot(0, -bh * y, IDX.R3);
          floor(p, bw / 2 + 2, IDX.R3);
          break;
        case 5:
          floor(p, bw / 2 + 4, IDX.R2, 0.5);
          break;
      }
    };
    const out = prm.phase === 'out';
    const ms = out ? [33, 33, 50, 50, 67, 67] : [33, 50, 50, 50, 67, 67];
    for (let f = 0; f < 6; f++) {
      S.add(ms[f], (p, rnd) => {
        if (out) return stage(p, f, rnd);
        // Arrive: seam -> column, with a ground ring that opens as the body lands, then lets go.
        const k = [3, 2, 1, 0, 4, 5][f];
        if (f >= 1 && f <= 3) floor(p, bw / 2 - 2 + f * 3, f === 1 ? IDX.R5 : IDX.R4);
        stage(p, k, rnd);
      });
    }
    return S.done('once');
  },
};
