// slash: melee crescents, claw rakes (monster auto-attacks) and execute chops (docs/VFX.md §5 slash notes).
//
// The smear is an annulus between R - w(u) and R around the caster, u running tail -> head over the swept arc,
// w(u) = W sin(PI u^2.2)^0.6 (thin tail, widest near the head, pointed tip). Frames follow the phase grammar:
// snap -> hero -> hold -> tail eats 40% -> split + sparks -> dotted trace -> dots -> empty (~400 ms).
import { IDX, type DirCount, type FamilyId, type SlashParams, type Template } from '../types';
import { step, type Painter } from '../painter';
import { mulberry32 } from '../../../core/rng';
import { Strip, glint, headingOf, mkKey, motifMark, runeMark, seedOf, spark, type TemplateOptions } from './kit';

const D2R = Math.PI / 180;
/**
 * Sweeps of this arc or more read as a whirl round the caster (the gap faces away from the aim): they bake 8
 * headings (3 unique, within 22.5 deg) instead of 16 and skip the heavy contrast frame (a dark full ring round the
 * player). Their frames are near-full circles, so this keeps the two widest smears (tidal_crescent, crescent_sweep)
 * inside the busy-fight atlas budget (docs/VFX.md §9). Claw rakes (monster auto-attacks, which hit all round) bake 8.
 */
const WIDE_ARC = 240;
const dirsOf = (p: SlashParams): DirCount => (p.form === 'chop' ? 1 : p.arc >= WIDE_ARC || p.rakes === 3 ? 8 : 16);

function usesMotif(p: SlashParams, motif: FamilyId): boolean {
  return p.tier >= 2 || motif === 'wind' || motif === 'shadow';
}

function keyOf(p: SlashParams, motif: FamilyId, opts: TemplateOptions): string {
  const f: Record<string, unknown> =
    p.form === 'chop'
      ? { r: p.r, form: p.form, weight: p.weight, tier: p.tier, sense: p.sense }
      : { r: p.r, arc: p.arc, rakes: p.rakes, form: p.form, weight: p.weight, tier: p.tier, sense: p.sense, rune: p.rune };
  return mkKey('slash', f, usesMotif(p, motif) ? motif : null, opts);
}

type Phase = 'contrast' | 'snap' | 'hero' | 'hold' | 'tail' | 'split' | 'trace' | 'dots';

/** Ink of a smear pixel by family language. */
function smearInk(motif: FamilyId, u: number, depth: number, w: number, hero: boolean, p: Painter, fx: number, fy: number): number {
  if (motif === 'wind') {
    // Parallel 1 px echo arcs, no fill, no white.
    if (depth < 1) return u > 0.6 ? IDX.R5 : IDX.R4;
    if (depth >= 2.5 && depth < 3.5 && w > 4) return IDX.R3;
    if (depth >= 5 && depth < 6 && w > 7) return IDX.R2;
    return 0;
  }
  if (motif === 'shadow') {
    // Inverted value: bright rim, dark core.
    if (depth < 1) return u > 0.66 ? (hero ? IDX.WHITE : IDX.R5) : IDX.R4;
    return depth / w < 0.5 ? IDX.R1 : IDX.R0;
  }
  let i: number;
  if (depth < 1) i = u > 0.66 ? (hero ? IDX.WHITE : IDX.R5) : IDX.R4;
  else {
    const q = depth / w;
    i = q < 0.5 ? IDX.R3 : q < 0.8 ? IDX.R2 : IDX.R1;
    // 50% R0 inner edge: contrast on light grass.
    if (w > 3 && depth >= w - 1 && p.pass(fx, fy, 0.5)) i = IDX.R0;
  }
  if (u < 0.33 && i !== IDX.WHITE) i = step(i, -1);
  return i;
}

function arcFrames(prm: SlashParams, motif: FamilyId, u: number, opts: TemplateOptions): Strip {
  const key = keyOf(prm, motif, opts);
  const R = prm.r;
  const pad = 8;
  const S = new Strip(2 * (R + pad) + 1, 2 * (R + pad) + 1, R + pad, R + pad, seedOf(key, u), opts, { orphans: true, glowFrom: 'hot' });
  const heading = headingOf(u, dirsOf(prm));
  const A = Math.min(360, prm.arc) * D2R;
  const sense = prm.sense;
  const a0 = (-A / 2) * sense,
    a1 = (A / 2) * sense;
  const heavy = prm.weight === 'heavy' || prm.weight === 'ultimate';
  const W = Math.max(3, R * (heavy ? 0.3 : prm.weight === 'light' ? 0.18 : 0.22));
  const wFull = (t: number) => W * Math.sin(Math.PI * Math.min(1, t) ** 2.2) ** 0.6;
  const at = (t: number, d: number): [number, number] => {
    const th = a0 + (a1 - a0) * t;
    return [Math.cos(th) * d, Math.sin(th) * d];
  };
  const tipAng = a1 + (sense * Math.PI) / 2;
  const marksSeed = Math.floor(S.rng() * 1e9);

  const smear = (p: Painter, lo: number, hi: number, hero: boolean, wFn = wFull, rimDim = false) => {
    p.arcBand(0, 0, R, a0, a1, (t) => (t < lo || t > hi ? 0 : wFn(t)), (t, depth, w, fx, fy) => {
      let i = smearInk(motif, t, depth, w, hero, p, fx, fy);
      if (rimDim && (i === IDX.R5 || i === IDX.WHITE)) i = IDX.R4;
      return i;
    });
  };
  const extras = (p: Painter, ph: Phase) => {
    if (prm.tier >= 1 && (ph === 'hero' || ph === 'hold')) {
      p.arcBand(0, 0, R - W * 0.85 - 2, a0, a1, (t) => (t > 0.25 && t < 0.92 ? 1 : 0), () => IDX.R2);
    }
    if (prm.tier >= 2 && (ph === 'hero' || ph === 'hold' || ph === 'tail')) {
      const mr = mulberry32(marksSeed);
      for (let k = 0; k < 4; k++) {
        const t = 0.5 + 0.12 * k + mr() * 0.05;
        const [x, y] = at(t, R + 2);
        motifMark(p, motif, x, y, a0 + (a1 - a0) * t + (sense * Math.PI) / 2, R / 48, mr);
      }
    }
    if (prm.tier >= 3 && (ph === 'hero' || ph === 'hold')) {
      const [x, y] = at(0.88, R - W * 0.4);
      p.ring(x, y, 3, 1, IDX.R4);
    }
    if (prm.rune && (ph === 'hero' || ph === 'hold' || ph === 'tail')) {
      for (const t of [0.6, 0.8]) {
        const [x, y] = at(t, R - wFull(t) * 0.5);
        runeMark(p, x, y, marksSeed + Math.round(t * 10), IDX.ACCENT, 5);
      }
    }
  };

  const frame = (ms: number, ph: Phase) => {
    const kind = ph === 'contrast' ? 'contrast' : ph === 'hero' ? 'hero' : 'normal';
    S.add(ms, (p, rnd) => {
      switch (ph) {
        case 'contrast':
          p.arcBand(0, 0, R, a0, a1, wFull, () => IDX.R0);
          break;
        case 'snap': {
          const span = 0.35;
          smear(p, 0, span, false, (t) => Math.min(2, W * Math.sin(Math.PI * Math.min(1, t / span) ** 2.2) ** 0.6));
          break;
        }
        case 'hero':
          smear(p, 0, 1, true);
          break;
        case 'hold':
          smear(p, 0, 1, false);
          break;
        case 'tail': {
          smear(p, 0.4, 1, false, wFull, true);
          const [x, y] = at(0.96, R - 1);
          glint(p, x, y, 3);
          break;
        }
        case 'split': {
          // Leading 35% only, split into 3 dashes, thinner and cooler; sparks thrown along the tip tangent.
          const dash = (t: number) => t >= 0.65 && Math.floor((t - 0.65) / 0.0875) % 4 !== 3;
          p.arcBand(0, 0, R, a0, a1, (t) => (dash(t) ? wFull(t) * 0.6 : 0), (_t, depth, w) =>
            depth < 1 ? IDX.R3 : depth / w < 0.6 ? IDX.R2 : IDX.R1,
          );
          const n = 3 + Math.floor(rnd() * 4);
          const [tx, ty] = at(1, R - 1);
          for (let k = 0; k < n; k++) {
            const ang = tipAng + (rnd() - 0.5) * 1.0;
            const off = 2 + rnd() * 5;
            spark(p, tx + Math.cos(ang) * off, ty + Math.sin(ang) * off, ang, 2 + Math.floor(rnd() * 3), IDX.R4, IDX.R3);
          }
          break;
        }
        case 'trace': {
          // Dotted trace on r = R - 1, every 2nd pixel.
          const span = Math.abs(a1 - a0);
          const n = Math.max(2, Math.floor((span * (R - 1)) / 2));
          for (let k = 0; k <= n; k++) {
            const t = k / n;
            if (t < 0.45) continue;
            const [x, y] = at(t, R - 1);
            p.dot(x, y, IDX.R2);
          }
          break;
        }
        case 'dots': {
          const n = 2 + Math.floor(rnd() * 2);
          for (let k = 0; k < n; k++) {
            const [x, y] = at(0.8 + rnd() * 0.2, R - 1 - rnd() * 3);
            p.dot(x, y, k === 0 ? IDX.R2 : IDX.R1);
          }
          break;
        }
      }
      extras(p, ph);
    }, kind, heading);
  };

  if (heavy && prm.arc < WIDE_ARC) frame(33, 'contrast');
  frame(33, 'snap');
  frame(33, 'hero');
  frame(50, 'hold');
  if (heavy) frame(50, 'hold');
  frame(50, 'tail');
  frame(67, 'split');
  frame(67, 'trace');
  if (heavy) {
    frame(67, 'trace');
    frame(67, 'dots');
  }
  frame(83, 'dots');
  return S;
}

function rakeFrames(prm: SlashParams, motif: FamilyId, u: number, opts: TemplateOptions): Strip {
  const key = keyOf(prm, motif, opts);
  const R = prm.r;
  const pad = 6;
  const S = new Strip(2 * (R + pad) + 1, 2 * (R + pad) + 1, R + pad, R + pad, seedOf(key, u), opts, { orphans: true, glowFrom: 'hot' });
  const heading = headingOf(u, dirsOf(prm));
  const A = Math.min(300, prm.arc) * D2R * 0.8;
  const a0 = (-A / 2) * prm.sense,
    a1 = (A / 2) * prm.sense;
  const radii = [R * 0.64, R * 0.82, R];
  const phases: (Phase | null)[] = ['snap', 'hero', 'hold', 'tail', 'split'];
  const ms = [33, 33, 50, 67, 83, 67, 67];
  for (let f = 0; f < phases.length + 2; f++) {
    const kind = f === 1 || f === 2 ? 'hero' : 'normal';
    S.add(ms[f], (p) => {
      radii.forEach((Rk, k) => {
        const ph = phases[f - k] ?? null;
        if (!ph) return;
        const lo = ph === 'snap' ? 0 : ph === 'tail' ? 0.45 : ph === 'split' ? 0.7 : 0;
        const hi = ph === 'snap' ? 0.4 : 1;
        const Wk = 3;
        const wFn = (t: number) => {
          if (t < lo || t > hi) return 0;
          if (ph === 'split' && Math.floor(t * 12) % 3 === 2) return 0;
          return Wk * Math.sin(Math.PI * t) ** 0.5;
        };
        p.arcBand(0, 0, Rk, a0, a1, wFn, (t, depth) => {
          if (ph === 'split') return depth < 1 ? IDX.R3 : IDX.R1;
          if (depth < 1) return ph === 'hero' && t > 0.4 && f <= 2 ? IDX.WHITE : ph === 'tail' ? IDX.R4 : IDX.R5;
          if (depth < 2) return IDX.R3;
          return IDX.R0;
        });
      });
    }, kind, heading);
  }
  return S;
}

function chopFrames(prm: SlashParams, motif: FamilyId, opts: TemplateOptions): Strip {
  const key = keyOf(prm, motif, opts);
  const L = Math.ceil(1.4 * prm.r);
  const H = L + 10;
  const S = new Strip(48, H, 24, Math.round(H / 2), seedOf(key, 0), opts, { orphans: true, glowFrom: 'hot' });
  const Rc = L;
  const c30 = Math.cos(Math.PI / 6);
  const cx = prm.sense === 1 ? -Rc * c30 : Rc * c30;
  const a0 = prm.sense === 1 ? -Math.PI / 6 : (-5 * Math.PI) / 6;
  const a1 = prm.sense === 1 ? Math.PI / 6 : (-7 * Math.PI) / 6;
  const heavy = prm.weight !== 'light';
  const W = Math.max(3, Math.min(9, L * (heavy ? 0.09 : 0.07)));
  const wFn = (t: number) => W * Math.sin(Math.PI * t) ** 0.6;
  type BandInk = (t: number, depth: number, w: number, fx: number, fy: number) => number;
  const band = (p: Painter, lo: number, hi: number, ink: BandInk, dx = 0, dy = 0) =>
    p.arcBand(cx + dx, dy, Rc, a0, a1, (t) => (t < lo || t > hi ? 0 : wFn(t)), ink);
  const lit = (p: Painter, hero: boolean): BandInk => (_t, depth, w, fx, fy) => smearInk(motif, 0.8, depth, w, hero, p, fx, fy);
  S.add(33, (p) => p.line(0, -L / 2, 0, L / 2, IDX.R0), 'contrast');
  S.add(33, (p) => band(p, 0, 0.4, lit(p, false)));
  S.add(33, (p) => band(p, 0, 1, lit(p, true)), 'hero');
  S.add(100, (p) => band(p, 0, 1, lit(p, false)));
  S.add(50, (p) => band(p, 0, 1, lit(p, false)));
  S.add(67, (p) => {
    const ink: BandInk = (_t, depth, w) => (depth < 1 ? IDX.R3 : depth / w < 0.6 ? IDX.R2 : IDX.R1);
    band(p, 0, 0.47, ink, -1, -2);
    band(p, 0.53, 1, ink, 1, 2);
  });
  S.add(83, (p, rnd) => {
    for (let k = 0; k < 4; k++) {
      const t = rnd();
      const th = a0 + (a1 - a0) * t;
      p.dot(cx + Math.cos(th) * (Rc - 1), Math.sin(th) * (Rc - 1) + (t - 0.5) * 4, k ? IDX.R1 : IDX.R2);
    }
  });
  return S;
}

export const slash: Template<'slash'> = {
  id: 'slash',
  use: () => 'once',
  dirs: dirsOf,
  key: keyOf,
  frames(p, motif, u, opts) {
    const S = p.form === 'chop' ? chopFrames(p, motif, opts) : p.rakes === 3 ? rakeFrames(p, motif, u, opts) : arcFrames(p, motif, u, opts);
    return S.done('once');
  },
};
