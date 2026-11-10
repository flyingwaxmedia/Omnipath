// emblem: class mechanic feedback on an actor (docs/VFX.md §5, §6.10). Short, readable marks, never a screen flash:
//   full      the meter is full: three chevrons climb over the head and hold a beat          (6 frames, 450 ms)
//   finisher  the combo's finisher: a crossed cut with a 4-point star at the crossing         (5 frames, 285 ms)
//   cashIn    marks cashed in: the mark diamond splits into four shards that fly apart       (5 frames, 300 ms)
//   stance    the stance swapped: two half rings trade places round the feet; `n` = lit side (6 frames, 335 ms)
//   step      a combo step: `of` pips in a row, `n` lit, the newest popping                   (4 frames, 420 ms)
//   mark      the pip a marked foe wears: a diamond reticle with `n` pips (loop 4 x 150 ms)
// Only `finisher` carries WHITE (one hero frame, ~60 px: far under the flash budget); reduce-flash maps it to R5.
// Family-free geometry: the ramp alone carries the class's element.
import { IDX, type EmblemParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, glint, mkKey, seedOf, type TemplateOptions } from './kit';

function keyOf(p: EmblemParams, _motif: unknown, opts: TemplateOptions): string {
  const f: Record<string, unknown> = { kind: p.kind };
  if (p.kind === 'step' || p.kind === 'mark' || p.kind === 'stance') f.n = p.n;
  if (p.kind === 'step') f.of = p.of ?? 3;
  return mkKey('emblem', f, null, opts);
}

/** An upward chevron `w` wide, 2 px thick, apex at (0, y). */
function chevron(p: Painter, y: number, w: number, top: number, under: number): void {
  p.line(-w, y + w * 0.7, 0, y, top);
  p.line(w, y + w * 0.7, 0, y, top);
  p.line(-w, y + w * 0.7 + 1, 0, y + 1, under);
  p.line(w, y + w * 0.7 + 1, 0, y + 1, under);
}

/** A filled diamond of half-size r: lit upper-left faces, dark rim. */
function diamond(p: Painter, x: number, y: number, r: number, core: number, face: number): void {
  p.poly([x, y - r, x + r, y, x, y + r, x - r, y], (lx, ly) => (lx - x + (ly - y) < -r * 0.2 ? core : face));
  p.outline(IDX.R1, (v) => v === core || v === face);
}

export const emblem: Template<'emblem'> = {
  id: 'emblem',
  use: (p) => (p.kind === 'mark' ? 'loop' : 'once'),
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const seed = seedOf(key, u);
    switch (prm.kind) {
      case 'full': {
        const S = new Strip(27, 40, 13, 34, seed, opts, { glowFrom: 'hot' });
        // Chevron j lifts off at frame j; all three hold, then dither out from the bottom.
        const ms = [50, 67, 83, 83, 83, 83];
        for (let f = 0; f < 6; f++)
          S.add(ms[f], (p) => {
            for (let j = 0; j < 3; j++) {
              if (f < j) continue;
              const rise = Math.min(3, f - j) * 2;
              const y = -4 - j * 7 - rise;
              const hot = f - j < 2;
              chevron(p, y, 7 - j, hot ? IDX.R5 : IDX.R4, hot ? IDX.R4 : IDX.R3);
            }
            if (f === 0) p.band(0, 4, 9, 3, 1, IDX.R5);
            if (f === 1) p.band(0, 4, 12, 4, 1, IDX.R3, 0.5);
            if (f >= 4) p.erode((f - 3) / 3, 'bayer', seed, (_fx, fy) => (fy / p.h) * 0.4);
          });
        return S.done('once');
      }
      case 'finisher': {
        const S = new Strip(45, 45, 22, 22, seed, opts, { glowFrom: 'hot', orphans: true });
        const cut = (p: Painter, L: number, w: number, head: number, tail: number): void => {
          for (const s of [-1, 1]) p.stroke(-L, s * L * 0.55, L, -s * L * 0.55, (t) => Math.max(1, w * Math.sin(Math.PI * t)), (t) => (Math.abs(t - 0.5) < 0.22 ? head : tail));
        };
        S.add(33, (p) => glint(p, 0, 0, 4, IDX.WHITE, IDX.R5), 'hero');
        S.add(50, (p) => {
          cut(p, 19, 3.4, IDX.WHITE, IDX.R4);
          glint(p, 0, 0, 7, IDX.WHITE, IDX.R5);
        }, 'hero');
        S.add(67, (p) => {
          cut(p, 20, 2, IDX.R5, IDX.R3);
          glint(p, 0, 0, 5, IDX.R5, IDX.R4);
        });
        S.add(67, (p) => {
          cut(p, 21, 1, IDX.R3, IDX.R2);
          p.ring(0, 0, 8, 1, IDX.R3, 0.5);
        });
        S.add(67, (p) => {
          for (const [x, y] of [
            [-17, -9],
            [17, 9],
            [-17, 9],
            [17, -9],
            [0, 0],
          ])
            p.dot(x, y, IDX.R2);
        });
        return S.done('once');
      }
      case 'cashIn': {
        const S = new Strip(41, 41, 20, 20, seed, opts, { glowFrom: 'hot' });
        const shard = (p: Painter, d: number, ink: number): void => {
          for (const [sx, sy] of [
            [-1, -1],
            [1, -1],
            [1, 1],
            [-1, 1],
          ]) {
            const x = sx * d,
              y = sy * d;
            p.poly([x, y, x + sx * 4, y + sy, x + sx, y + sy * 4], ink);
          }
        };
        S.add(50, (p) => diamond(p, 0, 0, 6, IDX.R5, IDX.R4));
        S.add(50, (p) => {
          diamond(p, 0, 0, 4, IDX.R5, IDX.R5);
          p.ring(0, 0, 8, 1, IDX.R5);
        });
        S.add(67, (p) => {
          shard(p, 4, IDX.R5);
          p.ring(0, 0, 12, 1, IDX.R4);
        });
        S.add(67, (p) => {
          shard(p, 9, IDX.R4);
          p.ring(0, 0, 16, 1, IDX.R3, 0.5);
        });
        S.add(67, (p) => {
          shard(p, 13, IDX.R3);
          p.erode(0.5, 'bayer', seed);
        });
        return S.done('once');
      }
      case 'stance': {
        const S = new Strip(51, 23, 25, 11, seed, opts, { glowFrom: 'hot' });
        const rx = 21,
          ry = 8;
        // Two half rings turn half a circle (eased out) and settle: the lit one ends on the side named by `n`.
        const turn = [0, 0.3, 0.6, 0.85, 1, 1];
        const ms = [33, 50, 50, 67, 67, 67];
        for (let f = 0; f < 6; f++)
          S.add(ms[f], (p) => {
            const a0 = (prm.n === 2 ? 0 : 180) + 180 * (1 - turn[f]) - 75;
            for (let j = 0; j < 2; j++) {
              const from = a0 + j * 180;
              const lit = j === 0;
              p.band(0, 0, rx, ry, lit ? 2 : 1, (q, deg) => {
                if (!lit) return IDX.R2;
                const rel = (((deg - from) % 360) + 360) % 360;
                return q === 0 ? (rel > 110 ? IDX.R5 : IDX.R4) : IDX.R3;
              }, 1, [from, from + 150]);
            }
            if (f === 4) glint(p, prm.n === 2 ? rx : -rx, 0, 2, IDX.R5, IDX.R4);
            if (f === 5) p.erode(0.5, 'bayer', seed);
          });
        return S.done('once');
      }
      case 'step': {
        const of = prm.of ?? 3;
        const gap = 7;
        const W = of * gap + 6;
        const S = new Strip(W, 11, W >> 1, 5, seed, opts, { glowFrom: 'hot' });
        const ms = [50, 117, 133, 117];
        for (let f = 0; f < 4; f++)
          S.add(ms[f], (p) => {
            for (let j = 0; j < of; j++) {
              const x = (j - (of - 1) / 2) * gap;
              const lit = j < prm.n;
              const newest = j === prm.n - 1;
              if (!lit) {
                p.ring(x, 0, 2, 1, IDX.R2);
                continue;
              }
              const r = newest && f === 0 ? 3 : 2;
              p.disc(x, 0, r, newest && f < 2 ? IDX.R5 : IDX.R4);
              p.dot(x - 1, -1, IDX.R5);
            }
            p.outline(IDX.R1, (v) => v === IDX.R4 || v === IDX.R5);
            if (f === 3) p.erode(0.5, 'bayer', seed);
          });
        return S.done('once');
      }
      case 'mark': {
        const S = new Strip(21, 21, 10, 10, seed, opts, { glowFrom: 'none' });
        for (let f = 0; f < 4; f++)
          S.add(150, (p) => {
            // A bright diamond hovering over the foe (it bobs a pixel), the marks counted in pips under it.
            const y = f === 1 || f === 2 ? -4 : -3;
            p.poly([0, y - 4, 4, y, 0, y + 4, -4, y], (lx, ly) => (lx + (ly - y) < -1 ? IDX.R5 : f === 1 ? IDX.R5 : IDX.R4));
            const n = prm.n;
            for (let j = 0; j < n; j++) {
              const x = Math.round((j - (n - 1) / 2) * 3);
              p.dot(x, 5, IDX.R5);
              p.dot(x, 6, IDX.R4);
            }
            p.outline(IDX.R0, (v) => v !== 0);
          });
        return S.done('loop');
      }
    }
  },
};
