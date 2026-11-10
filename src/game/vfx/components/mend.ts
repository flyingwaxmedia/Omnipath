// mend: a heal on an actor (docs/VFX.md §5, §6.9). 'pulse' = the one-shot: a ring of light climbs the body from the
// feet to the head while heal crosses rise and pop; 'loop' = the over-time trickle (two crosses rising in turn over a
// faint floor arc), 8 x 100 ms. Family-free geometry (recipes pair it with the caster family's ring and motes): one
// bake serves every element, in the `heal` ramp. With anchor.half = 'back' only what lies behind the actor is drawn
// (the far arc of each ring, every other cross), 'front' the rest. Cell (bodyW + 24) x (bodyH + 26), feet anchor.
import { IDX, BODY_PX, type MendParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, mkKey, plus, seedOf, type TemplateOptions } from './kit';

type Half = 'back' | 'front';

function keyOf(p: MendParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('mend', { phase: p.phase, body: p.body }, null, opts, true);
}

/** A heal cross: bright centre, lit arms, a dark rim so it reads on grass and on snow. */
function cross(p: Painter, x: number, y: number, big: boolean, dim = false): void {
  const c = dim ? IDX.R4 : IDX.R5;
  const arm = dim ? IDX.R3 : IDX.R4;
  plus(p, x, y, c, arm);
  if (big) {
    const fx = p.X(x, y),
      fy = p.Y(x, y);
    p.put(fx + 2, fy, arm);
    p.put(fx - 2, fy, arm);
    p.put(fx, fy + 2, arm);
    p.put(fx, fy - 2, arm);
  }
}

/** One turn of an ellipse band round the body at height y, split into the far (back) and near (front) arcs. */
function hoop(p: Painter, y: number, rx: number, half: Half | undefined, ink: number, lit: number, a = 1): void {
  p.band(0, y, rx, Math.max(1, rx * 0.32), 1, (_q, deg) => {
    if (half === 'back' && deg >= 0) return 0;
    if (half === 'front' && deg < 0) return 0;
    return deg > -150 && deg < -70 ? lit : ink;
  }, a);
}

export const mend: Template<'mend'> = {
  id: 'mend',
  use: (p) => (p.phase === 'loop' ? 'loop' : 'once'),
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const bh = BODY_PX[prm.body],
      bw = Math.round(bh * 0.8);
    const W = bw + 24,
      H = bh + 26;
    const S = new Strip(W, H, W >> 1, H - 8, seedOf(key, u), opts, { glowFrom: 'hot' });
    const half = (opts as TemplateOptions).half;
    const show = (h: Half) => !half || half === h;
    const rx = bw / 2 + 5;
    const xs = Array.from({ length: 6 }, (_, j) => ((j + 0.5) / 6 - 0.5) * (bw + 8) + (S.rng() - 0.5) * 3);
    if (prm.phase === 'loop') {
      for (let f = 0; f < 8; f++)
        S.add(100, (p) => {
          hoop(p, 0, rx, half, IDX.R2, IDX.R3, 0.5);
          for (let j = 0; j < 2; j++) {
            const h: Half = j ? 'back' : 'front';
            if (!show(h)) continue;
            const t = ((f + j * 4) % 8) / 8;
            const x = xs[j * 3 + 1];
            cross(p, x, -4 - t * (bh - 2), false, t > 0.75);
          }
          if (show('front')) p.outline(IDX.R1, (v) => v === IDX.R5 || v === IDX.R4);
        });
      return S.done('loop');
    }
    // Pulse: 50 · 67 · 67 · 83 · 83 · 83 · 67 (480 ms). The hoop climbs; crosses lift off in two waves and pop.
    const ms = [50, 67, 67, 83, 83, 83, 67];
    for (let f = 0; f < ms.length; f++) {
      S.add(ms[f], (p) => {
        const t = f / (ms.length - 1);
        // Floor flash, then the climbing hoop (two on the way up: the second trails 0.3 behind).
        if (f < 3) hoop(p, 0, rx + f * 2, half, IDX.R3, f === 0 ? IDX.R5 : IDX.R4, f === 2 ? 0.5 : 1);
        for (const lag of [0, 0.3]) {
          const tt = t - lag;
          if (tt < 0 || tt > 0.85) continue;
          const y = -tt * 1.18 * bh;
          hoop(p, y, rx * (1 - tt * 0.35), half, lag ? IDX.R3 : IDX.R4, lag ? IDX.R4 : IDX.R5);
        }
        xs.forEach((x, j) => {
          const h: Half = j % 2 ? 'back' : 'front';
          if (!show(h)) return;
          const start = (j % 3) * 0.14;
          const tt = (t - start) / 0.62;
          if (tt < 0 || tt > 1.15) return;
          const y = -6 - tt * (bh * 0.85) - (j % 2) * 4;
          if (tt > 1) {
            // Pop: four dots.
            for (const [dx, dy] of [
              [0, -3],
              [3, 0],
              [0, 3],
              [-3, 0],
            ])
              p.dot(x + dx, y + dy, IDX.R4);
          } else cross(p, x, y, j % 3 === 0 && tt < 0.7, tt > 0.8);
        });
        if (show('front')) p.outline(IDX.R1, (v) => v === IDX.R5);
      });
    }
    return S.done('once');
  },
};
