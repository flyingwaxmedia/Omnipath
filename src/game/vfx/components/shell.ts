// shell: a shield round an actor (docs/VFX.md §5, §6.9). It forms from the ground up, holds as a loop, flashes when it
// soaks a hit and breaks into pieces that fall. Every family wears its own skin (§3.3): fire a ring of tongues, water
// and toxin a bubble, earth and magma turning plates, wind three hoops of air, lightning and storm a cage of arcs,
// shadow and stealth a dark veil, holy a hex dome, ice a faceted gem, twilight orbiting crescents, steel a pair of
// guard brackets, arcane orbiting runes, spirit a double ki rim. The dome is an ellipse round the body; with
// anchor.half = 'back' only its far side is drawn (the upper half of the dome, the far arc of each hoop), 'front' the
// rest. form 5 x 67 · loop 8 x 117 (seamless) · absorb 33 · 50 · 50 (a family-free rim flash over the loop) ·
// break 6 x 50. Cell (bodyW + 30) x (bodyH + 30), anchored at the feet.
import { IDX, BODY_PX, type FamilyId, type ShellParams, type Template } from '../types';
import { midpoint, type Painter } from '../painter';
import { mulberry32 } from '../../../core/rng';
import { Strip, glint, mkKey, runeMark, seedOf, type TemplateOptions } from './kit';
import { hexEdge } from './aura';
import { tongue } from './erupt';

type Half = 'back' | 'front';
type Skin = 'hex' | 'bubble' | 'flames' | 'plates' | 'hoops' | 'arcs' | 'veil' | 'facets' | 'crescents' | 'guard' | 'runes' | 'ripple';

export const SHELL_SKIN: Readonly<Record<FamilyId, Skin>> = {
  fire: 'flames',
  water: 'bubble',
  earth: 'plates',
  wind: 'hoops',
  lightning: 'arcs',
  shadow: 'veil',
  holy: 'hex',
  ice: 'facets',
  magma: 'plates',
  storm: 'arcs',
  twilight: 'crescents',
  steel: 'guard',
  arcane: 'runes',
  stealth: 'veil',
  toxin: 'bubble',
  spirit: 'ripple',
  danger: 'hex',
};

function keyOf(p: ShellParams, motif: FamilyId, opts: TemplateOptions): string {
  // The absorb flash is a family-free rim: one bake serves every skin.
  return mkKey('shell', { phase: p.phase, body: p.body }, p.phase === 'absorb' ? null : motif, opts, true);
}

interface Geo {
  bw: number;
  bh: number;
  wx: number;
  wy: number;
  cy: number;
}

const LOOP = 8;

/** The dome part of a skin (everything on the ellipse); masked to a half afterwards. */
function dome(p: Painter, skin: Skin, motif: FamilyId, g: Geo, f: number, seed: number): void {
  const { wx, wy, cy } = g;
  const ph = f / LOOP;
  const hl = ph * Math.PI * 2;
  switch (skin) {
    case 'hex':
      p.fill(-wx - 1, cy - wy - 1, wx + 1, cy + wy + 1, (lx, ly, fx, fy) => {
        const dy = ly - cy;
        if ((lx / wx) ** 2 + (dy / wy) ** 2 > 0.84 || !hexEdge(lx, dy)) return 0;
        const band = Math.abs(Math.sin(Math.atan2(dy, lx) - hl)) < 0.18;
        return band ? IDX.R4 : p.pass(fx, fy, 0.25) ? IDX.R3 : 0;
      });
      p.band(0, cy, wx, wy, 1, (_q, deg) => (deg > -170 && deg < -60 ? IDX.R5 : IDX.R4));
      break;
    case 'bubble': {
      const wob = [0, 1, 1, 0, -1, -1, 0, 0][f];
      const rx = wx + wob,
        ry = wy - wob;
      // A soft sheen in the upper-left, then the film.
      p.fill(-rx - 1, cy - ry - 1, rx + 1, cy + ry + 1, (lx, ly, fx, fy) => {
        const dy = ly - cy;
        if ((lx / rx) ** 2 + (dy / ry) ** 2 > 0.84) return 0;
        if (((lx + rx * 0.35) / (rx * 0.5)) ** 2 + ((dy + ry * 0.4) / (ry * 0.42)) ** 2 > 1) return 0;
        return p.pass(fx, fy, 0.25) ? IDX.R3 : 0;
      });
      if (motif === 'toxin') p.band(0, cy, rx, ry, 2, (q, deg) => (q === 0 ? IDX.ACCENT : deg > -160 && deg < -100 ? IDX.R5 : IDX.R3));
      else p.band(0, cy, rx, ry, 1, (_q, deg) => (deg > -160 && deg < -100 ? IDX.R5 : IDX.R4));
      const arm = [2, 1, 0, 0, 0, 0, 0, 1][f];
      if (arm) glint(p, rx * 0.45, cy - ry * 0.52, arm, IDX.R5, IDX.R4);
      if (motif === 'toxin') p.ring(-rx * 0.3, cy + ry * 0.5 - f * 2, 1.5, 1, IDX.R4);
      break;
    }
    case 'flames': {
      // A faint heat rim above, tongues licking up from the lower arc and the flanks.
      p.band(0, cy, wx, wy, 1, (_q, deg, fx, fy) => (deg < 0 ? (p.pass(fx, fy, 0.5) ? IDX.R3 : 0) : IDX.R4));
      const angs = [-155, -25, 165, 15, 130, 50, 90];
      angs.forEach((a, j) => {
        const r = (a * Math.PI) / 180;
        tongue(p, 5 + ((f + j) % 2) * 2 + (j > 4 ? 1 : 0), 2, f * 1.1 + j * 1.7, 0, Math.cos(r) * wx, cy + Math.sin(r) * wy);
      });
      break;
    }
    case 'plates': {
      const a0 = f * (90 / LOOP);
      const magma = motif === 'magma';
      for (let j = 0; j < 4; j++) {
        const from = a0 + j * 90 + 8;
        p.band(0, cy, wx, wy, 3, (q, deg) => {
          if (magma) return q === 0 ? IDX.S2 : q === 1 ? (j % 2 ? IDX.R4 : IDX.R3) : IDX.S1;
          return q === 0 ? (deg > -170 && deg < -60 ? IDX.R4 : IDX.R3) : q === 1 ? IDX.R2 : IDX.R1;
        }, 1, [from, from + 66]);
      }
      p.outline();
      break;
    }
    case 'arcs': {
      p.band(0, cy, wx, wy, 1, (_q, _deg, fx, fy) => (p.pass(fx, fy, 0.5) ? IDX.R2 : 0));
      const rnd = mulberry32(seed + f * 131);
      for (let j = 0; j < 3; j++) {
        const a = rnd() * Math.PI * 2;
        const b = a + 0.6 + rnd() * 0.5;
        const pts = midpoint(Math.cos(a) * wx, cy + Math.sin(a) * wy, Math.cos(b) * wx, cy + Math.sin(b) * wy, 0.22, rnd, 2);
        p.polyline(pts, (u) => (u > 0.25 && u < 0.75 ? IDX.R5 : IDX.R4), 1, true);
      }
      if (motif === 'storm') {
        p.disc(-4, cy - wy + 1, 3.5, IDX.S2);
        p.disc(3, cy - wy, 4, IDX.S2);
        p.band(3, cy - wy, 4, 4, 1, (_q, deg) => (deg < -20 && deg > -160 ? IDX.S3 : 0));
      }
      break;
    }
    case 'veil': {
      const dark = motif === 'shadow' ? IDX.R0 : IDX.S1;
      p.fill(-wx - 1, cy - wy - 1, wx + 1, cy + wy + 1, (lx, ly, fx, fy) => {
        const dy = ly - cy;
        if ((lx / wx) ** 2 + (dy / wy) ** 2 > 0.9) return 0;
        if (Math.abs(Math.sin(Math.atan2(dy, lx) - hl)) < 0.3) return 0;
        return p.pass(fx, fy, 0.25) ? dark : 0;
      });
      p.band(0, cy, wx, wy, 1, (_q, deg) => (deg > -170 && deg < -60 ? IDX.R4 : IDX.R3));
      break;
    }
    case 'facets': {
      const v: [number, number][] = [];
      for (let j = 0; j < 8; j++) {
        const a = ((j * 45 + 22.5) * Math.PI) / 180;
        v.push([Math.cos(a) * wx, cy + Math.sin(a) * wy]);
      }
      for (let j = 0; j < 8; j++) {
        const [x0, y0] = v[j],
          [x1, y1] = v[(j + 1) % 8];
        // Edges whose outward normal faces the top-left light are the bright ones.
        const lit = x0 + x1 < 0 && y0 + y1 < 2 * cy;
        p.line(x0, y0, x1, y1, lit ? IDX.R5 : IDX.R4);
        if (j % 2 === 0) p.line(x0, y0, x0 * 0.45, cy + (y0 - cy) * 0.45, IDX.R3, 0.5);
      }
      const [gx, gy] = v[(f + 4) % 8];
      if (f % 2 === 0) glint(p, gx, gy, 1, IDX.R5, IDX.R4);
      break;
    }
    case 'crescents':
      p.band(0, cy, wx, wy, 1, (_q, _deg, fx, fy) => (p.pass(fx, fy, 0.5) ? IDX.R2 : 0));
      glint(p, 0, cy - wy - 1, [1, 2, 3, 2, 1, 1, 0, 0][f], IDX.ACCENT, IDX.R4);
      break;
    case 'guard': {
      const off = [0, 0, 1, 1, 0, 0, -1, -1][f];
      for (const arc of [
        [-52, 52],
        [128, 232],
      ] as const)
        p.band(0, cy, wx + off, wy, 2, (q, deg) => (q === 0 ? (deg < -10 || deg > 190 ? IDX.R5 : IDX.R4) : IDX.R2), 1, arc);
      if (f < 2) glint(p, (wx + off) * 0.82, cy - wy * 0.5, 2 - f, IDX.R5, IDX.R4);
      break;
    }
    case 'runes':
      p.band(0, cy, wx, wy, 1, (_q, deg) => (Math.abs(((deg - f * 45 + 540) % 360) - 180) < 30 ? IDX.R4 : IDX.R2));
      break;
    case 'ripple': {
      const off = [0, 1, 1, 0, 0, -1, -1, 0][f];
      p.band(0, cy, wx + off, wy + off, 1, (_q, deg) => (deg > -170 && deg < -60 ? IDX.R5 : IDX.R4));
      p.band(0, cy, wx + off - 3, wy + off - 3, 1, IDX.R3);
      break;
    }
    case 'hoops':
      break;
  }
}

/** The orbiting part of a skin (hoops round the body): the far arc is the back half. */
function orbit(p: Painter, skin: Skin, g: Geo, f: number, half: Half | undefined, seed: number): void {
  const { wx, cy } = g;
  const show = (h: Half) => !half || half === h;
  const ph = f / LOOP;
  const hoop = (dy: number, a0: number, len: number, ink: number, head: number): void => {
    p.band(0, cy + dy, wx, wx * 0.3, 1, (_q, deg) => {
      const back = deg < 0;
      if (!show(back ? 'back' : 'front')) return 0;
      const rel = (((deg - a0) % 360) + 360) % 360;
      return rel > len - 18 ? head : back ? ink - 1 : ink;
    }, 1, [a0, a0 + len]);
  };
  switch (skin) {
    case 'hoops':
      hoop(-g.bh * 0.3, f * 45, 110, IDX.R3, IDX.R5);
      hoop(0, f * 45 + 130, 110, IDX.R4, IDX.R5);
      hoop(g.bh * 0.28, f * 45 + 250, 110, IDX.R3, IDX.R4);
      break;
    case 'crescents':
      for (let j = 0; j < 2; j++) {
        const a = (ph + j / 2) * Math.PI * 2;
        const h: Half = Math.sin(a) < 0 ? 'back' : 'front';
        if (!show(h)) continue;
        const x = Math.cos(a) * wx,
          y = cy + Math.sin(a) * wx * 0.3;
        p.crescent(x, y, 3.2, 1.6, -0.6, 2.8, h === 'back' ? IDX.R2 : IDX.R4);
      }
      break;
    case 'runes':
      for (let j = 0; j < 4; j++) {
        const a = (ph / 4 + j / 4) * Math.PI * 2;
        const h: Half = Math.sin(a) < 0 ? 'back' : 'front';
        if (show(h)) runeMark(p, Math.cos(a) * (wx + 1), cy + Math.sin(a) * (wx + 1) * 0.3, seed + j, h === 'back' ? IDX.R3 : IDX.ACCENT, 5);
      }
      break;
    default:
      break;
  }
}

/** Clear the half of the dome that is not asked for (back = above the dome centre). */
function mask(p: Painter, g: Geo, half: Half | undefined, span = 1): void {
  const cut = p.oy + g.cy;
  // `span` (forming): only the lowest share of the dome exists yet.
  const top = p.oy + g.cy + g.wy - span * 2 * (g.wy + 8);
  for (let y = 0; y < p.h; y++) {
    const off = (half === 'back' && y >= cut) || (half === 'front' && y < cut) || y < top;
    if (!off) continue;
    for (let x = 0; x < p.w; x++) {
      p.body[y * p.w + x] = 0;
      p.glow[y * p.w + x] = 0;
    }
  }
}

/** One ramp step brighter (R2..R4 only: outlines, accents and the dark veil keep their ink). */
function light(p: Painter): void {
  p.map((v) => (v >= IDX.R2 && v <= IDX.R4 ? v + 1 : v));
}

export const shell: Template<'shell'> = {
  id: 'shell',
  use: (p) => (p.phase === 'loop' ? 'loop' : 'once'),
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const bh = BODY_PX[prm.body],
      bw = Math.round(bh * 0.8);
    const W = bw + 30,
      H = bh + 30;
    const skin = SHELL_SKIN[motif];
    const matter = skin === 'plates';
    const S = new Strip(W, H, W >> 1, H - 10, seedOf(key, u), opts, { glowFrom: 'hot', matter });
    const g: Geo = { bw, bh, wx: bw * 0.65, wy: bh * 0.6, cy: -bh * 0.5 };
    const half = (opts as TemplateOptions).half;
    const seed = S.seed;
    const draw = (p: Painter, f: number, span = 1): void => {
      dome(p, skin, motif, g, f, seed);
      mask(p, g, half, span);
      if (span >= 1) orbit(p, skin, g, f, half, seed);
    };
    switch (prm.phase) {
      case 'loop':
        for (let f = 0; f < LOOP; f++) S.add(117, (p) => draw(p, f));
        return S.done('loop');
      case 'form': {
        const spans = [0.25, 0.5, 0.75, 1, 1];
        for (let f = 0; f < 5; f++)
          S.add(67, (p) => {
            draw(p, 0, spans[f]);
            if (f === 3) light(p);
            // The ground line the shell rises from.
            if (f < 3 && half !== 'back') p.band(0, 0, g.wx - 2 + f * 2, (g.wx - 2 + f * 2) * 0.3, 1, (_q, deg) => (deg >= 0 ? (f === 0 ? IDX.R5 : IDX.R4) : 0));
            if (f < 3 && half !== 'front') p.band(0, 0, g.wx - 2 + f * 2, (g.wx - 2 + f * 2) * 0.3, 1, (_q, deg) => (deg < 0 ? IDX.R3 : 0));
          });
        return S.done('once');
      }
      case 'absorb': {
        const rim = (p: Painter, grow: number, bw2: number, ink: number, a = 1): void => {
          p.band(0, g.cy, g.wx + grow, g.wy + grow, bw2, ink, a);
          mask(p, g, half);
        };
        S.add(33, (p) => rim(p, 1, 2, IDX.R5));
        S.add(50, (p) => {
          p.band(0, g.cy, g.wx + 4, g.wy + 4, 1, IDX.R4, 0.5);
          rim(p, 0, 1, IDX.R4);
        });
        S.add(50, (p) => rim(p, 6, 1, IDX.R3, 0.5));
        return S.done('once');
      }
      case 'break':
        for (let f = 0; f < 6; f++)
          S.add(50, (p) => {
            draw(p, 0);
            if (f === 0) light(p);
            else {
              // Pieces fly outward from the dome centre and fall while they dither out.
              const src = p.body.slice();
              p.body.fill(0);
              p.glow.fill(0);
              const push = f * 1.6,
                drop = Math.round(f * f * 0.5);
              const cyF = p.oy + g.cy;
              for (let y = 0; y < p.h; y++)
                for (let x = 0; x < p.w; x++) {
                  const v = src[y * p.w + x];
                  if (!v) continue;
                  const dx = x - p.ox,
                    dy = y - cyF;
                  const d = Math.hypot(dx, dy) || 1;
                  const nx = Math.round(x + (dx / d) * push),
                    ny = Math.round(y + (dy / d) * push * 0.6 + drop);
                  if (nx >= 0 && nx < p.w && ny >= 0 && ny < p.h) p.body[ny * p.w + nx] = v;
                }
              p.erode(f / 6, 'bayer', seed);
            }
          });
        return S.done('once');
    }
  },
};
