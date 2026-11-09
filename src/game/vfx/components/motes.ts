// motes: the particle kit (docs/VFX.md §5). Each strip is a set of age steps: the runtime shows frame
// floor(age / life * n), so colour walks down the ramp as a particle ages. Emission (count, pattern, speed) lives in
// VfxPiece.place. spark / streak / line face local +x (16 headings); the rest are radial.
import { IDX, type MoteKind, type MotesParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, chip, glint, headingOf, mkKey, runeMark, seedOf, type TemplateOptions } from './kit';

const DIRECTIONAL: ReadonlySet<MoteKind> = new Set<MoteKind>(['spark', 'streak', 'line']);

function keyOf(p: MotesParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('motes', { kind: p.kind, size: p.size }, null, opts);
}

/** Cell side per kind and size (the anchor sits at the centre; streak-like kinds end at it). */
function cellOf(p: MotesParams): number {
  const s = p.size;
  switch (p.kind) {
    case 'spark':
      return 2 * [3, 5, 7][s - 1] + 3;
    case 'streak':
      return 2 * [3, 5, 8][s - 1] + 3;
    case 'line':
      return 2 * [6, 10, 14][s - 1] + 3;
    default:
      return 9;
  }
}

const RAMP_DOWN = [IDX.R5, IDX.R4, IDX.R3, IDX.R2];

/** Draw age step `i` of `n`. */
function draw(p: Painter, kind: MoteKind, s: 1 | 2 | 3, i: number, seed: number): void {
  const fx = p.ox,
    fy = p.oy;
  const box = (w: number, h: number, ink: number) => {
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) p.set(fx + x - (w >> 1), fy + y - (h >> 1), ink);
  };
  switch (kind) {
    case 'spark': {
      const L = [3, 5, 7][s - 1];
      const head = [IDX.R5, IDX.R4, IDX.R3][i],
        tail = [IDX.R3, IDX.R2, IDX.R1][i];
      p.line(-(L - 1), 0, 0, 0, (t) => (t > 0.55 ? head : tail));
      break;
    }
    case 'ember':
      box(s === 3 ? 2 : 1, s === 1 ? 1 : 2, RAMP_DOWN[i]);
      break;
    case 'mote':
      box(s === 1 ? 1 : 2, s === 3 ? 2 : 1, RAMP_DOWN[i]);
      break;
    case 'streak': {
      const L = [3, 5, 8][s - 1];
      p.line(-(L - 1), 0, 0, 0, (t) => (t > 0.7 ? (i ? IDX.R4 : IDX.R5) : t > 0.35 ? (i ? IDX.R2 : IDX.R3) : i ? IDX.R1 : IDX.R2));
      break;
    }
    case 'flake': {
      const c = i ? IDX.R4 : IDX.R5,
        a = i ? IDX.R3 : IDX.R4;
      if (s === 1) p.set(fx, fy, c);
      else glint(p, 0, 0, s - 1, c, a);
      if (s === 3) for (const [dx, dy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) p.set(fx + dx * 2, fy + dy * 2, a);
      break;
    }
    case 'droplet':
      if (i < 2) {
        const top = i ? IDX.R4 : IDX.R5;
        if (s === 1) {
          p.set(fx, fy, top);
          p.set(fx, fy + 1, IDX.R3);
        } else {
          box(2, s === 3 ? 3 : 2, IDX.R3);
          p.set(fx - 1, fy - 1, top);
          if (s === 3) p.set(fx - 1, fy - 2, IDX.R4);
        }
      } else {
        const w = i === 2 ? s + 1 : s + 2;
        for (let x = -w; x <= w; x++) if (Math.abs(x) >= w - 1) p.set(fx + x, fy, i === 2 ? IDX.R4 : IDX.R3);
      }
      break;
    case 'chip':
      chip(p, i ? -0.5 : 0, 0, s === 1 ? IDX.R2 : IDX.R3, s >= 2);
      if (s === 3) chip(p, 1, 1, IDX.R2);
      break;
    case 'bubble':
      if (i < 2) {
        const r = s;
        p.ring(0, 0, r, 1, i ? IDX.R3 : IDX.R4);
        if (s >= 2) p.set(fx - 1, fy - 1, IDX.R5);
      } else for (const [dx, dy] of [[0, -s - 1], [s + 1, 0], [0, s + 1], [-s - 1, 0]]) p.set(fx + dx, fy + dy, IDX.R3);
      break;
    case 'leaf': {
      const shapes = [
        [[0, 0], [1, 0]],
        [[0, 0], [1, -1]],
        [[0, 0], [0, -1]],
        [[0, 0], [-1, -1]],
      ];
      for (const [k, [dx, dy]] of shapes[i].entries()) p.set(fx + dx, fy + dy, k ? IDX.S2 : IDX.S3);
      if (s >= 2) p.set(fx - shapes[i][1][0], fy - shapes[i][1][1], IDX.S1);
      if (s === 3) p.set(fx + shapes[i][1][0] * 2, fy + shapes[i][1][1] * 2, IDX.S2);
      break;
    }
    case 'glint': {
      const arms = [1, 2, s + 1, 1][i];
      glint(p, 0, 0, arms, IDX.R5, IDX.R4);
      break;
    }
    case 'glyph':
      runeMark(p, 0, 0, seed, i ? IDX.R3 : IDX.ACCENT, s === 1 ? 3 : 5);
      break;
    case 'wisp': {
      const ink = [IDX.R2, IDX.R1, IDX.R0][i];
      const pts = s === 1 ? [[0, 0], [0, 1]] : s === 2 ? [[0, 0], [1, 1], [1, 2]] : [[0, 0], [1, 1], [1, 2], [0, 3]];
      for (const [dx, dy] of pts) p.set(fx + dx, fy + dy - 1, ink);
      break;
    }
    case 'line': {
      const L = [6, 10, 14][s - 1];
      p.line(-(L - 1), 0, 0, 0, (t) => (t > 0.8 ? (i ? IDX.R4 : IDX.R5) : i ? IDX.R2 : IDX.R3));
      break;
    }
    case 'bead': {
      const ink = i ? IDX.R3 : IDX.R4;
      if (s === 1) box(2, 2, ink);
      else p.disc(0, 0, s === 2 ? 1 : 1.6, ink);
      p.set(fx - (s === 1 ? 1 : 1), fy - 1, i ? IDX.R4 : IDX.R5);
      break;
    }
    case 'disc':
      p.disc(0, 0, s, RAMP_DOWN[i]);
      break;
    case 'star':
      glint(p, 0, 0, [s, Math.max(1, s - 1), s][i], i === 1 ? IDX.R5 : IDX.ACCENT, IDX.R4);
      break;
  }
}

const FRAMES: Record<MoteKind, number> = {
  spark: 3,
  ember: 4,
  mote: 4,
  streak: 2,
  flake: 2,
  droplet: 4,
  chip: 2,
  bubble: 3,
  leaf: 4,
  glint: 4,
  glyph: 2,
  wisp: 3,
  line: 2,
  bead: 2,
  disc: 4,
  star: 3,
};

export const motes: Template<'motes'> = {
  id: 'motes',
  use: () => 'pieces',
  dirs: (p) => (DIRECTIONAL.has(p.kind) ? 16 : 1),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const C = cellOf(prm);
    const seed = seedOf(key, u);
    const S = new Strip(C, C, C >> 1, C >> 1, seed, opts, { matter: prm.kind === 'chip', glowFrom: 'hot' });
    const heading = DIRECTIONAL.has(prm.kind) ? headingOf(u, 16) : 0;
    for (let i = 0; i < FRAMES[prm.kind]; i++) S.add(50, (p) => draw(p, prm.kind, prm.size, i, seed), 'normal', heading);
    return S.done('pieces');
  },
};
