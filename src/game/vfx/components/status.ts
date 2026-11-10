// status: small character-anchored status units (docs/VFX.md §5, §6.4). The runtime places them on silhouette
// anchor points (top edge, lower body, feet, head) and follows the target. Loops 4-9 frames at 100-200 ms; one-shots
// <= 800 ms. Units scale with the body bucket (S/M 1, L 1.4, W 1.8). The pip is the 7x7 hidden-status marker.
import { IDX, BODY_PX, type BodySize, type StatusParams, type StatusUnit, type Template } from '../types';
import { STATUS_GLYPHS } from '../glyphs';
import { midpoint, type Painter } from '../painter';
import { mulberry32 } from '../../../core/rng';
import { Strip, glint, headingOf, mkKey, plus, seedOf, type TemplateOptions } from './kit';
import { tongue } from './erupt';

const SCALE: Record<BodySize, number> = { S: 1, M: 1, L: 1.4, W: 1.8 };
const LOOPS: ReadonlySet<StatusUnit> = new Set<StatusUnit>(['tongue', 'drip', 'puddle', 'chevron', 'star', 'crystal', 'icicle', 'pip', 'shackle', 'updraft', 'breach', 'beckon']);

function keyOf(p: StatusParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('status', p.unit === 'pip' ? { unit: p.unit, kind: p.kind } : { unit: p.unit, body: p.body }, null, opts);
}

/** Cell (w, h, ox, oy) per unit. */
function cellOf(unit: StatusUnit, body: BodySize): [number, number, number, number] {
  const s = SCALE[body];
  const c = (w: number, h: number, ox: number, oy: number): [number, number, number, number] => [Math.ceil(w * s), Math.ceil(h * s), Math.floor(ox * s), Math.floor(oy * s)];
  switch (unit) {
    case 'tongue':
      return c(11, 13, 5, 11);
    case 'drip':
      return c(7, 13, 3, 1);
    case 'puddle':
      return c(13, 6, 6, 3);
    case 'chevron':
      return c(11, 8, 5, 3);
    case 'star':
      return c(22, 11, 11, 5);
    case 'microarc':
      return c(16, 16, 8, 8);
    case 'crystal': {
      const h = BODY_PX[body] + 4,
        w = Math.round(BODY_PX[body] * 0.8) + 4;
      return [w, h, w >> 1, h - 2];
    }
    case 'icicle':
      return c(15, 10, 7, 8);
    case 'bubble':
      return c(9, 12, 4, 9);
    case 'drop':
      return c(9, 14, 4, 2);
    case 'splash':
      return c(15, 15, 7, 7);
    case 'beam':
      return c(9, 54, 4, 51);
    case 'speedline':
      return c(25, 25, 12, 12);
    case 'spiral':
      return c(31, 31, 15, 15);
    case 'pip':
      return [9, 9, 4, 4];
    case 'shackle':
      return c(27, 14, 13, 9);
    case 'updraft':
      return c(23, 24, 11, 19);
    case 'breach':
      return c(15, 16, 7, 8);
    case 'beckon':
      return c(13, 16, 6, 12);
  }
}

/** The 7x7 pip: dark frame, glyph field, glyph, #24180f keyline around. */
function pip(p: Painter, prm: StatusParams): void {
  const g = STATUS_GLYPHS[prm.kind];
  const x0 = p.ox - 3,
    y0 = p.oy - 3;
  for (let y = 0; y < 7; y++)
    for (let x = 0; x < 7; x++) {
      const edge = x === 0 || y === 0 || x === 6 || y === 6;
      const on = !edge && g[y - 1][x - 1] === '#';
      p.set(x0 + x, y0 + y, edge ? IDX.R1 : on ? IDX.R5 : IDX.R2);
    }
  p.outline();
}

export const status: Template<'status'> = {
  id: 'status',
  use: (p) => (LOOPS.has(p.unit) ? 'loop' : 'once'),
  dirs: (p) => (p.unit === 'speedline' ? 16 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const s = SCALE[prm.body];
    const [w, h, ox, oy] = cellOf(prm.unit, prm.body);
    const matter = prm.unit === 'crystal' || prm.unit === 'icicle' || prm.unit === 'pip';
    const S = new Strip(w, h, ox, oy, seedOf(key, u), opts, { matter, glowFrom: 'hot' });
    const heading = prm.unit === 'speedline' ? headingOf(u, 16) : 0;
    const add = (ms: number, draw: (p: Painter) => void, kind: 'normal' | 'hero' = 'normal') => S.add(ms, draw, kind, heading);
    const use = LOOPS.has(prm.unit) ? 'loop' : 'once';
    switch (prm.unit) {
      case 'tongue':
        for (let f = 0; f < 4; f++) add(100, (p) => tongue(p, (6 + (f % 2)) * s, 2.4 * s, f * (Math.PI / 2)));
        break;
      case 'drip':
        for (let f = 0; f < 4; f++)
          add(100, (p) => {
            if (f === 0) p.dot(0, 0, IDX.R4);
            else if (f < 3) {
              const y = f === 1 ? 3 * s : 7 * s;
              p.dot(0, y, IDX.R5);
              p.dot(0, y + 1, IDX.R3);
            } else p.line(-1, 10 * s, 1, 10 * s, IDX.R3);
          });
        break;
      case 'puddle':
        for (let f = 0; f < 2; f++)
          add(117, (p) => {
            p.ellipse(0, 0, 5 * s, 1.6 * s, IDX.R2);
            p.dot(-2 + f * 2, -1, IDX.R4);
            p.dot(-1 + f * 2, -1, IDX.R4);
          });
        break;
      case 'chevron': {
        const ink = [IDX.R3, IDX.R4, IDX.R5, IDX.R4];
        for (let f = 0; f < 4; f++)
          add(117, (p) => {
            p.line(-4 * s, -2, 0, 2, ink[f]);
            p.line(4 * s, -2, 0, 2, ink[f]);
            p.line(-4 * s, -1, 0, 3, ink[f] - 1);
            p.line(4 * s, -1, 0, 3, ink[f] - 1);
          });
        break;
      }
      case 'star': {
        const rx = 7 * s,
          ry = 2 * s;
        for (let f = 0; f < 8; f++)
          add(100, (p) => {
            for (let j = 0; j < 3; j++) {
              const a = ((f / 8 + j / 3) * Math.PI * 2) % (Math.PI * 2);
              const x = Math.cos(a) * rx,
                y = Math.sin(a) * ry;
              if (y < 0) plus(p, x, y, IDX.R3, IDX.R2);
            }
            for (let j = 0; j < 3; j++) {
              const a = ((f / 8 + j / 3) * Math.PI * 2) % (Math.PI * 2);
              const x = Math.cos(a) * rx,
                y = Math.sin(a) * ry;
              if (y >= 0) plus(p, x, y, IDX.R5, IDX.R4);
            }
          });
        break;
      }
      case 'microarc': {
        const rnd = mulberry32(S.seed);
        const a = rnd() * Math.PI;
        const L = 5 * s;
        const pts = midpoint(-Math.cos(a) * L, -Math.sin(a) * L, Math.cos(a) * L, Math.sin(a) * L, 0.35, rnd, 2);
        const pts2 = midpoint(-Math.cos(a) * L, -Math.sin(a) * L, Math.cos(a) * L, Math.sin(a) * L, 0.35, rnd, 2);
        add(33, (p) => {
          for (let k = 0; k < pts.length / 2; k++) p.stamp(pts[k * 2], pts[k * 2 + 1], 1, IDX.R3, 1, true);
          p.polyline(pts, IDX.R5);
        });
        add(50, (p) => p.polyline(pts2, (t) => (t > 0.3 && t < 0.7 ? IDX.R5 : IDX.R4)));
        add(33, (p) => {
          p.line(pts[0], pts[1], pts[4], pts[5], IDX.R3);
          p.line(pts[pts.length - 2], pts[pts.length - 1], pts[pts.length - 6], pts[pts.length - 5], IDX.R3);
        });
        break;
      }
      case 'crystal': {
        const bh = BODY_PX[prm.body],
          bw = Math.round(bh * 0.8);
        const hw = bw / 2;
        const block = [-hw, 0, -hw, -bh * 0.75, -hw * 0.45, -bh + 1, hw * 0.55, -bh + 1, hw, -bh * 0.7, hw, 0];
        const draw = (p: Painter, shine: number | null) => {
          p.poly(block, (lx, ly) => {
            const edgeL = lx < -hw + 1.5,
              edgeT = ly < -bh + 2.5;
            if (edgeT || (edgeL && ly < -bh * 0.4)) return IDX.R5;
            if (edgeL || lx > hw - 1.5 || ly > -1.5) return lx > 0 ? IDX.R2 : IDX.R4;
            if (shine !== null && Math.abs(lx + ly * 0.6 - shine) < 1.5) return IDX.R5;
            // Facet line from the top-left corner down the middle.
            if (Math.abs(lx - (ly + bh) * 0.25 + hw * 0.2) < 0.5) return IDX.R4;
            return IDX.R3;
          });
          // Keyline the block's silhouette only, then thin the ice to a 25 % dither: outlining after the dither put a
          // dark ring round every dot and turned the crystal into an opaque dark checkerboard over the body.
          p.outline();
          p.map((v, fx, fy) => (v === IDX.R3 && !p.pass(fx, fy, 0.25) ? 0 : v));
        };
        for (let f = 0; f < 5; f++) add(200, (p) => draw(p, null));
        for (let f = 0; f < 4; f++) add(50, (p) => draw(p, -hw - bh * 0.6 + (f + 0.5) * ((bw + bh * 0.6) / 4)));
        break;
      }
      case 'icicle': {
        const xs = [-4 * s, 0, 4 * s];
        for (let f = 0; f < 4; f++)
          add(117, (p) => {
            xs.forEach((x, j) => {
              const ih = (j === 1 ? 7 : 5) * s;
              p.poly([x - 1.5 * s, 0, x + 1.5 * s, 0, x, -ih], (lx) => (lx < x ? IDX.R4 : IDX.R2));
              if (f === j) glint(p, x, -ih + 2, 1, IDX.R5, IDX.R4);
            });
            p.outline();
          });
        break;
      }
      case 'bubble':
        add(100, (p) => p.ring(0, 0, 1.5 * s, 1, IDX.R4));
        add(100, (p) => p.ring(0, -2 * s, 2 * s, 1, IDX.R4));
        add(100, (p) => {
          p.ring(0, -4 * s, 2 * s, 1, IDX.R4);
          p.dot(-1, -5 * s, IDX.R5);
        });
        add(50, (p) => {
          for (const [dx, dy] of [
            [0, -3],
            [3, 0],
            [0, 3],
            [-3, 0],
          ])
            p.dot(dx * s, -5 * s + dy * s, IDX.R3);
        });
        break;
      case 'drop':
        for (const y of [0, 3, 6]) add(y ? 67 : 50, (p) => {
          p.dot(0, y * s, IDX.R4);
          p.dot(0, y * s + 1, IDX.R3);
        });
        add(100, (p) => {
          p.line(-1, 9 * s, 1, 9 * s, IDX.R3);
          p.dot(-2, 8 * s, IDX.R4);
          p.dot(2, 8 * s, IDX.R4);
        });
        add(200, (p) => p.line(-1, 9 * s, 1, 9 * s, IDX.R2));
        add(200, (p) => p.line(-1, 9 * s, 1, 9 * s, IDX.R1));
        break;
      case 'splash': {
        const rnd = mulberry32(S.seed);
        const n = 3 + Math.floor(rnd() * 3);
        const angs = Array.from({ length: n }, (_, i) => -Math.PI / 2 + (i - (n - 1) / 2) * 0.7 + (rnd() - 0.5) * 0.3);
        add(50, (p) => p.disc(0, 0, 1.5 * s, IDX.R4));
        add(50, (p) => {
          for (const a of angs) p.stroke(0, 0, Math.cos(a) * 5 * s, Math.sin(a) * 5 * s, (t) => Math.max(1, 2 * (1 - t)), (t) => (t < 0.5 ? IDX.R4 : IDX.R3));
        });
        add(67, (p) => {
          for (const a of angs) p.line(Math.cos(a) * 4 * s, Math.sin(a) * 4 * s, Math.cos(a) * 6.5 * s, Math.sin(a) * 6.5 * s, IDX.R3);
        });
        add(67, (p) => {
          for (const a of angs) p.dot(Math.cos(a) * 7 * s, Math.sin(a) * 7 * s + 2, IDX.R2);
        });
        break;
      }
      case 'beam': {
        const H = 48 * s;
        const col = (p: Painter, wd: number, core: number, edge: number, a = 1) =>
          p.fill(-wd, -H, wd, 0, (lx, ly) => (ly <= 0 && ly >= -H && Math.abs(lx) <= wd - 0.5 ? (Math.abs(lx) < 0.5 ? core : edge) : 0), a);
        add(33, (p) => col(p, 1, IDX.R4, IDX.R4));
        add(50, (p) => {
          col(p, 2, IDX.WHITE, IDX.R5);
          p.ellipse(0, 0, 4 * s, 1.5 * s, IDX.R5);
        }, 'hero');
        add(100, (p) => {
          col(p, 2, IDX.R5, IDX.R4);
          p.ellipse(0, 0, 4 * s, 1.5 * s, IDX.R4, 0.5);
        });
        add(100, (p) => col(p, 1.5, IDX.R4, IDX.R3));
        add(67, (p) => col(p, 1, IDX.R4, IDX.R4));
        add(67, (p) => col(p, 1, IDX.R3, IDX.R3, 0.5));
        break;
      }
      case 'speedline':
        for (let f = 0; f < 3; f++)
          add(33, (p) => {
            const lens = [7, 9, 6];
            [-3, 0, 3].forEach((y, j) => {
              const x0 = -(3 + f * 3) * s - (j === 1 ? 0 : 2);
              p.line(x0, y * s, x0 - lens[j] * s, y * s, (t) => (t < 0.25 ? IDX.R5 : IDX.R3));
            });
          });
        break;
      case 'spiral': {
        const R = 14 * s;
        const arms = Array.from({ length: 6 }, (_, j) => (j / 6) * Math.PI * 2);
        const at = (a0: number, t: number): [number, number] => {
          const r = R * Math.exp(-2.2 * t);
          const th = a0 + 2.4 * t;
          return [Math.cos(th) * r, Math.sin(th) * r];
        };
        for (let f = 0; f < 6; f++)
          add(50, (p) => {
            for (const a0 of arms) {
              const pts: number[] = [];
              for (let q = 0; q <= 2; q++) pts.push(...at(a0, f / 6 + q * 0.06));
              p.polyline(pts, (t) => (t > 0.6 ? IDX.R5 : IDX.R3));
            }
          });
        break;
      }
      case 'pip':
        add(200, (p) => pip(p, prm));
        break;
      case 'shackle': {
        // Root: a cuff closed round the feet (near arc bright, far arc dim) with three teeth biting upward, and two
        // stakes driven into the ground at its ends. It tightens every other frame.
        for (let f = 0; f < 4; f++)
          add(133, (p) => {
            const rx = (10 - (f % 2)) * s,
              ry = 3.2 * s;
            p.band(0, 0, rx, ry, 1, (_q, deg) => (deg < 0 ? IDX.R2 : 0));
            p.band(0, 0, rx, ry, 2, (q, deg) => (deg >= 0 ? (q === 0 ? IDX.R4 : IDX.R3) : 0));
            for (const [x, h] of [
              [-5 * s, 4],
              [0, 5],
              [5 * s, 4],
            ]) {
              const y0 = Math.sqrt(Math.max(0, 1 - (x / rx) ** 2)) * ry;
              p.line(x, y0 - 1, x, y0 - 1 - h * s, (t) => (t > 0.6 ? (f % 2 ? IDX.R5 : IDX.R4) : IDX.R3));
            }
            for (const sx of [-1, 1]) {
              p.line(sx * rx, -1, sx * rx, 3 * s, IDX.R3);
              p.dot(sx * rx, -2, IDX.R5);
            }
          });
        break;
      }
      case 'updraft': {
        // Launch: the body is in the air. A ground shadow shrinks under it while chevrons of air rush upward.
        for (let f = 0; f < 4; f++)
          add(100, (p) => {
            p.ellipse(0, 2, (7 - (f % 2)) * s, 2 * s, IDX.R1, 0.5);
            for (let j = 0; j < 3; j++) {
              const t = ((f + j * 1.33) % 4) / 4;
              const y = -2 - t * 15 * s;
              const w = (5 - t * 2) * s;
              const ink = t < 0.3 ? IDX.R5 : t < 0.7 ? IDX.R4 : IDX.R3;
              p.line(-w, y + w * 0.6, 0, y, ink);
              p.line(w, y + w * 0.6, 0, y, ink);
            }
          });
        break;
      }
      case 'breach': {
        // Expose: a guard plate split by a crack, pulsing; the crack runs top to bottom, a chip falls away.
        const plate = [-5 * s, -6 * s, 5 * s, -6 * s, 5 * s, 1 * s, 0, 6 * s, -5 * s, 1 * s];
        for (let f = 0; f < 4; f++)
          add(150, (p) => {
            p.poly(plate, (lx, ly, fx, fy) => {
              const edge = Math.abs(lx) > 5 * s - 1.5 || ly < -6 * s + 1.5 || ly > 1 * s + (5 * s - Math.abs(lx)) - 1.6;
              if (edge) return lx < 0 ? IDX.R4 : IDX.R3;
              return p.pass(fx, fy, 0.25) ? IDX.R2 : 0;
            });
            // The crack: a zig-zag gap with a hot edge.
            const pts = [0.5, -6 * s, -1.5 * s, -3 * s, 1.5 * s, -0.5 * s, -1 * s, 2.5 * s, 0, 6 * s];
            p.polyline(pts, f % 2 ? IDX.R5 : IDX.R4);
            if (f >= 2) p.dot(3 * s, (f - 1) * 2 * s + 2, IDX.R3);
          });
        break;
      }
      case 'beckon': {
        // Lure: a hook on a line, bobbing over the head, its barb glinting.
        const bob = [0, -1, 0, 1];
        for (let f = 0; f < 4; f++)
          add(150, (p) => {
            const y = bob[f];
            p.line(0, -10 * s + y, 0, -2 * s + y, IDX.R3);
            p.band(-2 * s, -2 * s + y, 2.6 * s, 2.6 * s, 1, IDX.R4, 1, [-10, 190]);
            p.dot(-4 * s - 0.5, -3 * s + y, IDX.R5);
            p.dot(-4 * s - 0.5, -4 * s + y, IDX.R4);
            p.dot(0, -10 * s + y - 1, IDX.ACCENT);
            if (f === 1) glint(p, -4 * s - 0.5, -4 * s + y, 1, IDX.R5, IDX.R4);
          });
        break;
      }
    }
    return S.done(use);
  },
};
