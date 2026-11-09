// thrust: pierce lunge streak + X-cut at the tip (docs/VFX.md §5). Local +x is the aim; the anchor is the caster.
import { IDX, type ThrustParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, glint, headingOf, mkKey, seedOf, spark, type TemplateOptions } from './kit';

function keyOf(p: ThrustParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('thrust', { len: p.len, weight: p.weight, tier: p.tier, slit: p.slit }, null, opts);
}

export const thrust: Template<'thrust'> = {
  id: 'thrust',
  use: () => 'once',
  dirs: () => 16,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const L = prm.len;
    const pad = 12;
    const S = new Strip(2 * (L + pad) + 1, 2 * (L + pad) + 1, L + pad, L + pad, seedOf(key, u), opts, { orphans: true, glowFrom: 'hot' });
    const heading = headingOf(u, 16);
    const heavy = prm.weight === 'heavy' || prm.weight === 'ultimate';
    const x0 = 8;
    const h = Math.max(5, Math.min(10, L * 0.12));
    const tx = L - h * 0.7;
    const x1 = tx - 1;
    const base = heavy ? 4 : 3;
    // Streak: widest at the base, 1 px at the tip; R4 body, R2 tail.
    const streak = (p: Painter, from: number, to: number, hero: boolean, cool = false) =>
      p.stroke(x0 + (x1 - x0) * from, 0, x0 + (x1 - x0) * to, 0, (t) => Math.max(1, base * (1 - t) + 1 * t), (t, q) => {
        const g = from + (to - from) * t;
        if (hero && g > 0.93) return IDX.WHITE;
        if (cool) return q < 0.5 ? IDX.R3 : IDX.R2;
        if (g < 0.3) return q < 0.5 ? IDX.R2 : IDX.R1;
        return q < 0.45 ? (g > 0.8 ? IDX.R5 : IDX.R4) : IDX.R3;
      });
    const cut = (p: Painter, sign: 1 | -1, ink: (q: number) => number, broken = false) => {
      const d = h * 0.7071;
      p.stroke(tx - d, -sign * d, tx + d, sign * d, (t) => (broken && Math.floor(t * 5) % 2 === 1 ? 0 : 3 * Math.sin(Math.PI * t) ** 0.6), (_t, q) => ink(q), 0.6 * sign);
    };
    const echo = (p: Painter) => {
      if (prm.tier >= 1) p.line(x0 + (x1 - x0) * 0.35, -3, x1 - 3, -3, IDX.R2);
      if (prm.tier >= 3) p.ring(tx, 0, 4, 1, IDX.R4);
    };
    if (prm.slit) S.add(33, (p) => p.line(x0, 0, L, 0, IDX.R0), 'contrast', heading);
    S.add(33, (p) => streak(p, 0, 0.5, false), 'normal', heading);
    S.add(33, (p) => {
      streak(p, 0, 1, true);
      cut(p, 1, (q) => (q < 0.4 ? IDX.WHITE : IDX.R4));
      echo(p);
    }, 'hero', heading);
    S.add(50, (p) => {
      streak(p, 0.4, 1, false);
      cut(p, 1, (q) => (q < 0.4 ? IDX.R5 : IDX.R3));
      cut(p, -1, (q) => (q < 0.4 ? IDX.R5 : IDX.R4));
      echo(p);
    }, 'normal', heading);
    if (heavy)
      S.add(50, (p) => {
        streak(p, 0.6, 1, false, true);
        cut(p, 1, (q) => (q < 0.4 ? IDX.R4 : IDX.R3));
        cut(p, -1, (q) => (q < 0.4 ? IDX.R4 : IDX.R3));
        glint(p, tx, 0, 2);
      }, 'normal', heading);
    S.add(67, (p, rnd) => {
      cut(p, 1, (q) => (q < 0.5 ? IDX.R3 : IDX.R2), true);
      cut(p, -1, (q) => (q < 0.5 ? IDX.R3 : IDX.R2), true);
      for (let k = 0; k < 4; k++) {
        const a = (rnd() - 0.5) * 1.1;
        spark(p, tx + 3, (rnd() - 0.5) * 3, a, 2 + Math.floor(rnd() * 2), IDX.R4, IDX.R3);
      }
    }, 'normal', heading);
    S.add(67, (p, rnd) => {
      for (let k = 0; k < 4; k++) p.dot(tx + (rnd() - 0.3) * h * 1.6, (rnd() - 0.5) * h * 1.6, k ? IDX.R1 : IDX.R2);
    }, 'normal', heading);
    return S.done('once');
  },
};
