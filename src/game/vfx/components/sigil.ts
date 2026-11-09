// sigil: rune circle (2 rings + star polygon + glyphs) drawn on in sequence (docs/VFX.md §5). Arcane tells, rune
// cores, staff strikes. draw: 8 x 50 ms + hold + dissolve; flash: hero pair; static: 1-frame loop.
import { IDX, type SigilParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, clamp01, mkKey, runeMark, seedOf, type TemplateOptions } from './kit';

function keyOf(p: SigilParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('sigil', { r: p.r, points: p.points, glyphs: p.glyphs, anim: p.anim }, null, opts);
}

interface Reveal {
  outer: number;
  inner: number;
  star: number;
  glyphs: number;
}

function drawSigil(p: Painter, prm: SigilParams, rv: Reveal, seed: number, white: boolean): void {
  const R = prm.r;
  const hot = white ? IDX.WHITE : IDX.R4;
  const mid = white ? IDX.WHITE : IDX.R3;
  if (rv.outer > 0) p.band(0, 0, R, R, 1, hot, 1, [-90, -90 + 360 * rv.outer]);
  if (rv.inner > 0) p.band(0, 0, R - 3, R - 3, 1, mid, 1, [90, 90 + 360 * rv.inner]);
  // Star polygon {n / step} inscribed in the inner ring.
  const n = prm.points;
  const stepN = n <= 6 ? 2 : 3;
  const rs = R - 4;
  const v = (k: number): [number, number] => {
    const a = -Math.PI / 2 + ((k % n) * Math.PI * 2) / n;
    return [Math.cos(a) * rs, Math.sin(a) * rs];
  };
  const segs = n;
  const shown = rv.star * segs;
  for (let s = 0; s < segs; s++) {
    if (s >= shown) break;
    const [x0, y0] = v(s * stepN);
    const [x1, y1] = v(s * stepN + stepN);
    const part = Math.min(1, shown - s);
    p.line(x0, y0, x0 + (x1 - x0) * part, y0 + (y1 - y0) * part, hot);
  }
  const g = Math.round(prm.glyphs * rv.glyphs);
  const rg = R - (R >= 32 ? 9 : 7);
  for (let k = 0; k < g; k++) {
    const a = -Math.PI / 2 + ((k + 0.5) * Math.PI * 2) / prm.glyphs;
    runeMark(p, Math.cos(a) * rg, Math.sin(a) * rg, seed + k, white ? IDX.WHITE : IDX.ACCENT);
  }
}

export const sigil: Template<'sigil'> = {
  id: 'sigil',
  use: (p) => (p.anim === 'static' ? 'loop' : 'once'),
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const R = prm.r;
    const S = new Strip(2 * R + 5, 2 * R + 5, R + 2, R + 2, seedOf(key, u), opts, { glowFrom: 'bright' });
    const all: Reveal = { outer: 1, inner: 1, star: 1, glyphs: 1 };
    const seed = S.seed;
    if (prm.anim === 'static') {
      S.add(200, (p) => drawSigil(p, prm, all, seed, false));
      return S.done('loop');
    }
    if (prm.anim === 'flash') {
      S.add(33, (p) => drawSigil(p, prm, all, seed, true), 'hero');
      S.add(33, (p) => {
        drawSigil(p, prm, all, seed, false);
        p.map((i) => (i === IDX.R4 ? IDX.R5 : i));
      });
      S.add(50, (p) => {
        drawSigil(p, prm, all, seed, false);
        p.erode(0.5, 'bayer', seed);
      });
      return S.done('once');
    }
    for (let f = 0; f < 8; f++) {
      const rv: Reveal = {
        outer: clamp01((f + 1) / 3),
        inner: clamp01(f / 3),
        star: clamp01((f - 2) / 3),
        glyphs: clamp01((f - 4) / 3),
      };
      S.add(50, (p) => drawSigil(p, prm, rv, seed, false));
    }
    S.add(200, (p) => drawSigil(p, prm, all, seed, false));
    S.add(50, (p) => {
      drawSigil(p, prm, all, seed, false);
      p.erode(0.5, 'bayer', seed);
    });
    S.add(50, (p) => {
      drawSigil(p, prm, all, seed, false);
      p.erode(0.75, 'bayer', seed);
    });
    return S.done('once');
  },
};
