// ring: shockwaves, spin bands, rims, fill fronts, cone edges, accretion arcs (docs/VFX.md §5 ring styles).
//
// Rings within RING_WHOLE_MAX (r and an expand / contract r0) bake whole frames: expand / contract (6 frames), sweep (heads reveal the band at 33 ms ticks,
// ink by age since a head passed: hot 1 tick -> lit -> mid 2 -> dim 2 -> gone), march (dashed loop, one unit per
// 67 ms) and static (1-frame loop). With anchor.half set only the back (y < centre) or front half is drawn.
//
// Larger rings bake a tile set ('pieces'): a 10 px band chunk per unique direction, where u indexes the
// chunk's OUTWARD NORMAL angle (u * 22.5 deg). The runtime places N = ceil(perimeter / 10) chunks and picks each one's
// bake with pickDir(normalAngle, 16): normals mirror correctly under flipX / flipY (tangent angles would not).
// Dashed and gapped patterns are then placement choices (hide 2 of 5 / every 4th chunk).
import { IDX, RING_WHOLE_MAX, type RingInk, type RingParams, type Template } from '../types';
import { hash01 } from '../dither';
import type { Painter } from '../painter';
import { Strip, clampMs, headingOf, mkKey, outCubic, seedOf, type TemplateOptions } from './kit';

const ORDER: readonly RingInk[] = ['hot', 'lit', 'mid', 'dim'];
const INKS: Record<RingInk, [number, number]> = {
  hot: [IDX.R5, IDX.R3],
  lit: [IDX.R4, IDX.R2],
  mid: [IDX.R3, IDX.R1],
  dim: [IDX.R2, IDX.R2],
};
const UNIT = 10;

/** Rings that ever exceed RING_WHOLE_MAX (a contract from r0 > 64 included) are placed from pieces. */
const isPieces = (p: RingParams) => Math.max(p.r, p.anim === 'expand' || p.anim === 'contract' ? (p.r0 ?? 0) : 0) > RING_WHOLE_MAX;

function keyOf(p: RingParams, _motif: unknown, opts: TemplateOptions): string {
  if (isPieces(p)) return mkKey('ring', { pieces: 1, thick: p.thick, style: p.style, ink: p.ink }, null, opts);
  const f: Record<string, unknown> = { r: p.r, aspect: p.aspect, thick: p.thick, style: p.style, ink: p.ink, anim: p.anim, arc: p.arc };
  if (p.anim === 'expand' || p.anim === 'contract') {
    f.r0 = p.r0;
    f.ms = p.ms;
  }
  if (p.anim === 'sweep') {
    f.heads = p.heads ?? 1;
    f.ms = p.ms;
  }
  return mkKey('ring', f, null, opts, true);
}

/** Ramanujan's ellipse perimeter. */
export function perimeter(rx: number, ry: number): number {
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

interface RingDraw {
  rx: number;
  ry: number;
  thick: number;
  ink: RingInk;
  /** Unit visibility (dash / gap patterns, sweep reveal) and per-unit ink override. */
  unitInk?: (unit: number, deg: number) => RingInk | null;
}

/** Draw a whole ring (or arc) into p with the given style. */
function drawWhole(p: Painter, prm: RingParams, d: RingDraw, half: TemplateOptions['half'], seed: number): void {
  const { rx, ry, thick } = d;
  const per = perimeter(rx, ry);
  const units = Math.max(4, Math.round(per / UNIT));
  const unitOf = (deg: number) => Math.floor((((deg + 360) % 360) / 360) * units) % units;
  const halfOk = (deg: number) => !half || (half === 'back' ? deg < 0 : deg >= 0);
  const vis = (deg: number): RingInk | null => {
    if (!halfOk(deg)) return null;
    const u = unitOf(deg);
    if (prm.style === 'gapped' && u % 4 === 3) return null;
    return d.unitInk ? d.unitInk(u, deg) : d.ink;
  };
  const roff = prm.style === 'jagged' ? (deg: number) => (hash01(unitOf(deg), 7, seed) < 0.5 ? 1 : 0) - (hash01(unitOf(deg), 9, seed) < 0.3 ? 1 : 0) : undefined;
  const main = (q: number, deg: number, fx: number, fy: number) => {
    const ink = vis(deg);
    if (!ink) return 0;
    const [o, i] = INKS[ink];
    if (ink === 'dim' && !p.pass(fx, fy, 0.5)) return 0;
    if (prm.style === 'inverted') return q === 0 ? IDX.R4 : IDX.R0;
    return q === 0 ? o : i;
  };
  p.band(0, 0, rx, ry, thick, main, 1, prm.arc, roff);
  if (prm.style === 'double') {
    const g = thick + 2;
    if (rx - g > 1)
      p.band(0, 0, rx - g, ry - g * (ry / rx), 1, (_q, deg, fx, fy) => {
        const ink = vis(deg);
        if (!ink) return 0;
        if (ink === 'dim' && !p.pass(fx, fy, 0.5)) return 0;
        return INKS[ink][1];
      }, 1, prm.arc);
  }
  if (prm.style === 'dashed') {
    // 1 px contrast line outside, #24180f keyline outside it and inside the band.
    p.band(0, 0, rx + 1, ry + (ry / rx), 1, (_q, deg) => (vis(deg) ? IDX.ACCENT : 0), 1, prm.arc);
    p.band(0, 0, rx + 2, ry + 2 * (ry / rx), 1, (_q, deg) => (vis(deg) ? IDX.OUTLINE : 0), 1, prm.arc);
    if (rx - thick > 1) p.band(0, 0, rx - thick, ry - thick * (ry / rx), 1, (_q, deg) => (vis(deg) ? IDX.OUTLINE : 0), 1, prm.arc);
  }
}

function pieceFrames(prm: RingParams, u: number, opts: TemplateOptions, key: string): Strip {
  const S = new Strip(16, 16, 8, 8, seedOf(key, u), opts, { glowFrom: 'hot' });
  const [o, i] = INKS[prm.ink];
  const t = prm.thick;
  const a = prm.ink === 'dim' ? 0.5 : 1;
  // Local +x = outward normal; the chunk spans y in [-5, 5), x in (-t, 0].
  S.add(33, (p) => {
    const chunk = (x0: number, x1: number, ink: (x: number) => number, y0 = -5, y1 = 4.99) =>
      p.fill(x0, y0, x1, y1, (lx, ly) => (lx > x0 && lx <= x1 && ly >= y0 && ly < y1 ? ink(lx) : 0), a);
    const off = prm.style === 'jagged' ? 1 : 0;
    const bandInk = (x: number) => (prm.style === 'inverted' ? (x > -1 ? IDX.R4 : IDX.R0) : x > -1 ? o : i);
    chunk(-t, 0, bandInk, -5, 0);
    chunk(-t + off, off, bandInk, 0, 4.99);
    if (prm.style === 'double') chunk(-t - 3, -t - 2, () => i);
    if (prm.style === 'dashed') {
      chunk(0, 1, () => IDX.ACCENT);
      chunk(1, 2, () => IDX.OUTLINE);
      chunk(-t - 1, -t, () => IDX.OUTLINE);
    }
  }, 'normal', headingOf(u, 16));
  return S;
}

export const ring: Template<'ring'> = {
  id: 'ring',
  use: (p) => (isPieces(p) ? 'pieces' : p.anim === 'march' || p.anim === 'static' ? 'loop' : 'once'),
  dirs: (p) => (isPieces(p) ? 16 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    if (isPieces(prm)) return pieceFrames(prm, u, opts, key).done('pieces');
    const asp = prm.aspect;
    const r0 = prm.r0 ?? (prm.anim === 'contract' ? Math.min(RING_WHOLE_MAX, prm.r * 1.6) : prm.r * 0.3);
    const maxR = Math.ceil(Math.max(prm.r, prm.anim === 'expand' || prm.anim === 'contract' ? r0 : 0)) + 4;
    const S = new Strip(2 * maxR + 1, 2 * Math.ceil(maxR * asp) + 3, maxR, Math.ceil(maxR * asp) + 1, seedOf(key, u), opts, { glowFrom: 'hot' });
    const half = (opts as TemplateOptions).half;
    const base = ORDER.indexOf(prm.ink);
    const draw = (p: Painter, d: RingDraw) => drawWhole(p, prm, d, half, S.seed);
    const ellipse = (r: number) => ({ rx: Math.max(1, r), ry: Math.max(1, r * asp) });
    switch (prm.anim) {
      case 'expand':
      case 'contract': {
        const n = 6;
        const ms = clampMs(Math.max(50, Math.min(67, prm.ms / n)));
        for (let f = 0; f < n; f++) {
          const t = (f + 1) / n;
          const r = r0 + (prm.r - r0) * outCubic(t);
          const thick = Math.max(1, Math.round(prm.thick * (1 - (f / n) * 0.7)));
          const ink = ORDER[Math.min(3, base + Math.floor(f / 2))];
          S.add(ms, (p) => draw(p, { ...ellipse(r), thick, ink }));
        }
        return S.done('once');
      }
      case 'sweep': {
        const heads = prm.heads ?? 1;
        const T = Math.max(1, Math.round(prm.ms / 33));
        const span = prm.arc ? ((((prm.arc[1] - prm.arc[0]) % 360) + 360) % 360 || 360) : 360;
        const start = prm.arc ? prm.arc[0] : -90;
        for (let k = 0; k < T + 6; k++)
          S.add(33, (p) => {
            draw(p, {
              ...ellipse(prm.r),
              thick: prm.thick,
              ink: prm.ink,
              unitInk: (_unit, deg) => {
                const rel = ((((deg - start) % 360) + 360) % 360) / span;
                if (rel > 1) return null;
                // Most recent pass of any head at or before tick k.
                let best = -1;
                for (let h = 0; h < heads; h++) {
                  const tau = ((rel - h / heads + 1) % 1) * T;
                  if (tau <= k + 0.999 && tau > best) best = tau;
                }
                if (best < 0) return null;
                const age = k - Math.floor(best);
                if (age < 1) return ORDER[base];
                if (age < 2) return ORDER[Math.min(3, base + 1)];
                if (age < 4) return ORDER[Math.min(3, base + 2)];
                if (age < 6) return 'dim';
                return null;
              },
            });
          });
        return S.done('once');
      }
      case 'march': {
        if (prm.style !== 'dashed') {
          S.add(200, (p) => draw(p, { ...ellipse(prm.r), thick: prm.thick, ink: prm.ink }));
          return S.done('loop');
        }
        for (let f = 0; f < 5; f++)
          S.add(67, (p) => draw(p, { ...ellipse(prm.r), thick: prm.thick, ink: prm.ink, unitInk: (unit) => ((unit + f) % 5 < 3 ? prm.ink : null) }));
        return S.done('loop');
      }
      case 'static':
      default:
        S.add(200, (p) =>
          draw(p, { ...ellipse(prm.r), thick: prm.thick, ink: prm.ink, unitInk: prm.style === 'dashed' ? (unit) => (unit % 5 < 3 ? prm.ink : null) : undefined }),
        );
        return S.done('loop');
    }
  },
};
