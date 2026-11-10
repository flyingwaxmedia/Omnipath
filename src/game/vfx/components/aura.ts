// aura: buff activation one-shot, sustained loop with a motif per stat, and break (docs/VFX.md §5, buff-aura and
// hex-ward specs). Cell (bodyW + 24) x (bodyH + 24), anchored at the feet. With anchor.half = 'back' only the far
// half (floor-ring back arc, orbiting units with sin < 0, the ward's upper half) is drawn, 'front' only the rest.
// Loop: 16 x 100 ms (1.6 s, seamless). Activate: 6 x 83 ms. Break: 6 x 50 ms.
import { IDX, BODY_PX, type AuraParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, glint, mkKey, plus, runeMark, seedOf, type TemplateOptions } from './kit';
import { tongue } from './erupt';

type Half = 'back' | 'front';

function keyOf(p: AuraParams, _motif: unknown, opts: TemplateOptions): string {
  const f: Record<string, unknown> = { motif: p.motif, phase: p.phase, body: p.body, halo: p.halo };
  if (p.phase === 'activate') f.activation = p.activation;
  return mkKey('aura', f, null, opts, true);
}

interface Geo {
  bw: number;
  bh: number;
  /** Floor ring radii. */
  rx: number;
  ry: number;
}

/** Hex cell edge test (cell radius 4, pointy axial grid). Returns 1 on cell edges, 0 inside. */
export function hexEdge(x: number, y: number): number {
  const size = 4;
  const q = ((Math.sqrt(3) / 3) * x - y / 3) / size;
  const r = ((2 / 3) * y) / size;
  // Cube round.
  let cx = q,
    cz = r,
    cy = -q - r;
  let rx = Math.round(cx),
    ry = Math.round(cy),
    rz = Math.round(cz);
  const dx = Math.abs(rx - cx),
    dy = Math.abs(ry - cy),
    dz = Math.abs(rz - cz);
  if (dx > dy && dx > dz) rx = -ry - rz;
  else if (dy > dz) ry = -rx - rz;
  else rz = -rx - ry;
  cx = q - rx;
  cz = r - rz;
  cy = -q - r - ry;
  return Math.max(Math.abs(cx), Math.abs(cy), Math.abs(cz)) > 0.42 ? 1 : 0;
}

/** Floor ring with a highlight arc travelling 22.5 deg per frame. */
function floorRing(p: Painter, g: Geo, f: number, half: Half | undefined, a = 1): void {
  const hl = (f * 22.5) % 360;
  p.band(0, 0, g.rx, g.ry, 1, (_q, deg) => {
    if (half === 'back' && deg >= 0) return 0;
    if (half === 'front' && deg < 0) return 0;
    const d = Math.abs(((deg - hl + 540) % 360) - 180);
    if (d < 25) return IDX.R4;
    const unit = Math.floor(((deg + 360) % 360) / 15);
    return unit % 2 === 0 ? IDX.R2 : 0;
  }, a);
}

/** Draw one loop frame of the motif (f in 0..15). */
function motifFrame(p: Painter, prm: AuraParams, g: Geo, f: number, half: Half | undefined, seed: number): void {
  const show = (h: Half) => !half || half === h;
  const ph = f / 16;
  const chestY = -g.bh * 0.55;
  const orbit = (j: number, n: number, rx: number, ry: number, cy: number): [number, number, Half] => {
    const a = (ph + j / n) * Math.PI * 2;
    return [Math.cos(a) * rx, cy + Math.sin(a) * ry, Math.sin(a) < 0 ? 'back' : 'front'];
  };
  switch (prm.motif) {
    case 'edge':
      if (show('front')) {
        for (const [j, x] of [-0.35, 0.35].entries()) tongue(p, 4 + ((f + j * 2) % 4 < 2 ? 1 : 0), 1.6, (f + j * 5) * 0.8, 0, x * g.bw, -g.bh * 0.72);
        if (f === 0 || f === 8) glint(p, g.bw * 0.45, -g.bh * 0.42, f === 0 ? 2 : 1, IDX.R5, IDX.R4);
      }
      break;
    case 'runes':
      for (let j = 0; j < 3; j++) {
        const [x, y, h] = orbit(j, 3, g.bw / 2 + 4, (g.bw / 2 + 4) * 0.35, chestY);
        if (show(h)) runeMark(p, x, y, seed + j, h === 'back' ? IDX.R3 : IDX.ACCENT);
      }
      break;
    case 'gust':
      for (let j = 0; j < 2; j++) {
        const a0 = -f * 22.5 - j * 180;
        for (const h of ['back', 'front'] as Half[])
          if (show(h))
            p.band(0, -2, g.rx - 2, g.ry, 1, (_q, deg) => ((deg < 0) === (h === 'back') ? (j ? IDX.R3 : IDX.R4) : 0), 1, [a0, a0 + 50]);
      }
      if (show('front')) for (let j = 0; j < 2; j++) p.dot(((ph * 2 + j * 0.5) % 1) * -g.rx - 3, -1 - j, IDX.R2);
      break;
    case 'glint':
      if (show('front'))
        for (let j = 0; j < 3; j++) {
          const r2 = (seed >>> (j * 5)) & 31;
          const x = ((r2 / 31) * 1.6 - 0.8) * (g.bw / 2),
            y = -g.bh * (0.25 + 0.2 * j);
          const t = (f + j * 5) % 16;
          const arm = t === 0 ? 1 : t === 1 ? 2 : t === 2 ? 1 : 0;
          if (arm) glint(p, x, y, arm, IDX.R5, IDX.R4);
        }
      break;
    case 'bloom':
      for (let j = 0; j < 3; j++) {
        const h: Half = j % 2 ? 'back' : 'front';
        if (!show(h)) continue;
        const t = (ph + j / 3) % 1;
        const x = (((seed >>> (j * 4)) & 15) / 15 - 0.5) * g.bw;
        plus(p, x, -t * g.bh, t < 0.7 ? IDX.R5 : IDX.R4, IDX.R4);
        p.outline(IDX.R1, (v) => v === IDX.R5 || v === IDX.R4);
      }
      if (show('front')) p.glowAt(0, 0, g.rx, 1);
      break;
    case 'ward': {
      // Hex-cell dome at low intensity: sparse cell edges, a 1 px rim lit top-left, a rotating highlight band.
      const wx = g.bw * 0.65,
        wy = g.bh * 0.6,
        cy = -g.bh * 0.5;
      const hl = ph * Math.PI * 2;
      const halfOk = (dy: number) => !(half === 'back' && dy >= 0) && !(half === 'front' && dy < 0);
      p.fill(-wx - 1, cy - wy - 1, wx + 1, cy + wy + 1, (lx, ly, fx, fy) => {
        const dy = ly - cy;
        if ((lx / wx) ** 2 + (dy / wy) ** 2 > 0.84 || !halfOk(dy)) return 0;
        if (!hexEdge(lx, dy)) return 0;
        const band = Math.abs(Math.sin(Math.atan2(dy, lx) - hl)) < 0.18;
        return band ? IDX.R4 : p.pass(fx, fy, 0.25) ? IDX.R3 : 0;
      });
      p.band(0, cy, wx, wy, 1, (_q, deg) => {
        const dy = Math.sin((deg * Math.PI) / 180);
        if (!halfOk(dy)) return 0;
        return deg > -170 && deg < -60 ? IDX.R5 : IDX.R4;
      });
      break;
    }
    case 'blades':
      for (let j = 0; j < 3; j++) {
        const [x, y, h] = orbit(j, 3, g.bw / 2 + 5, (g.bw / 2 + 5) * 0.35, chestY);
        if (!show(h)) continue;
        const a = (ph + j / 3) * Math.PI * 2 + Math.PI / 2;
        const c = Math.cos(a) * 4,
          s = Math.sin(a) * 4;
        p.line(x - c, y - s * 0.35, x + c, y + s * 0.35, h === 'back' ? IDX.R2 : IDX.R4, 1);
        p.dot(x - c * 0.6, y - s * 0.2 - 1, h === 'back' ? IDX.S1 : IDX.S2);
        p.dot(x + c, y + s * 0.35, IDX.R5);
      }
      break;
    case 'veil':
      for (let j = 0; j < 5; j++) {
        const h: Half = j % 2 ? 'back' : 'front';
        if (!show(h)) continue;
        const t = (ph + j / 5) % 1;
        const x = (j / 4 - 0.5) * g.bw + Math.round(Math.sin((t + j) * 6) * 1.5);
        const y = -t * g.bh * 1.05;
        p.dot(x, y, t < 0.5 ? IDX.R2 : IDX.R1);
        p.dot(x, y + 1, IDX.R1);
      }
      break;
  }
}

function halo(p: Painter, g: Geo, half: Half | undefined): void {
  if (half === 'back') return;
  p.band(0, -g.bh - 3, 6, 2, 1, (_q, deg) => (deg < 0 ? IDX.R5 : IDX.R4));
}

export const aura: Template<'aura'> = {
  id: 'aura',
  use: (p) => (p.phase === 'loop' ? 'loop' : 'once'),
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const bh = BODY_PX[prm.body],
      bw = Math.round(bh * 0.8);
    const W = bw + 24,
      H = bh + 24;
    const S = new Strip(W, H, W >> 1, H - 9, seedOf(key, u), opts, { glowFrom: 'hot' });
    const g: Geo = { bw, bh, rx: bw / 2 + 6, ry: (bw / 2 + 6) * 0.3 };
    const half = (opts as TemplateOptions).half;
    const seed = S.seed;
    if (prm.phase === 'loop') {
      for (let f = 0; f < 16; f++)
        S.add(100, (p) => {
          floorRing(p, g, f, half);
          motifFrame(p, prm, g, f, half, seed);
          if (prm.halo) halo(p, g, half);
        });
      return S.done('loop');
    }
    if (prm.phase === 'break') {
      for (let f = 0; f < 6; f++)
        S.add(50, (p) => {
          floorRing(p, g, 0, half);
          motifFrame(p, prm, g, 0, half, seed);
          if (prm.halo) halo(p, g, half);
          if (prm.motif === 'ward') {
            // Cells drop with gravity while they dither out.
            const src = p.body.slice();
            p.body.fill(0);
            const drop = Math.round(f * f * 0.6);
            for (let y = p.h - 1; y >= 0; y--) for (let x = 0; x < p.w; x++) if (src[y * p.w + x] && y + drop < p.h) p.body[(y + drop) * p.w + x] = src[y * p.w + x];
          }
          p.erode((f + 1) / 6, 'bayer', seed);
        });
      return S.done('once');
    }
    // Activate.
    const show = (h: Half) => !half || half === h;
    const motes = Array.from({ length: 8 }, () => ({ x: (S.rng() - 0.5) * bw, v: 0.6 + S.rng() * 0.6 }));
    for (let f = 0; f < 6; f++) {
      const hero = prm.activation === 'pillar' && f === 0;
      S.add(83, (p) => {
        const r = 4 + (12 * f) / 5 + bw * 0.15;
        p.band(0, 0, r, r * 0.35, Math.max(1, 3 - Math.floor(f / 2)), (q, deg) => {
          if ((half === 'back' && deg >= 0) || (half === 'front' && deg < 0)) return 0;
          return q === 0 ? (f < 2 ? IDX.R5 : IDX.R4) : IDX.R3;
        });
        if (f >= 3) floorRing(p, g, f, half, (f - 2) / 4);
        if (show('front'))
          for (const m of motes) {
            const y = -(f + 1) * 4 * m.v;
            p.dot(m.x, y, f < 3 ? IDX.R5 : IDX.R4);
            p.dot(m.x, y + 1, IDX.R3);
          }
        switch (prm.activation) {
          case 'pillar':
            if (show('front') && f < 4) {
              const wd = [3, 5, 3, 1][f];
              const core = f === 0 ? IDX.WHITE : f === 1 ? IDX.R5 : IDX.R4;
              p.fill(-wd / 2 - 1, -bh - 10, wd / 2 + 1, 0, (lx, ly) => (Math.abs(lx) <= wd / 2 && ly <= 0 && ly >= -bh - 10 ? (Math.abs(lx) < 1 ? core : IDX.R4) : 0));
            }
            break;
          case 'sigil': {
            const rr = g.rx + 2;
            const span = Math.min(360, 120 * (f + 1));
            for (const [k, rad] of [rr, rr - 4].entries())
              p.band(0, 0, rad, rad * 0.35, 1, (_q, deg) => ((half === 'back' && deg >= 0) || (half === 'front' && deg < 0) ? 0 : k ? IDX.R3 : IDX.R4), 1, [-90, -90 + span]);
            if (f >= 2 && show('front'))
              for (let j = 0; j < 4; j++) {
                const a = (j / 4) * Math.PI * 2 + 0.4;
                runeMark(p, Math.cos(a) * (rr - 2), Math.sin(a) * (rr - 2) * 0.35, seed + j, IDX.ACCENT);
              }
            if (f >= 4) p.erode((f - 3) / 3, 'bayer', seed);
            break;
          }
          case 'shout':
            if (show('front')) {
              const hy = -bh * 0.8;
              for (let j = 0; j < 3; j++) {
                const rr = 4 + f * 3 - j * 4;
                if (rr > 2) p.band(0, hy, rr, rr, 1, j ? IDX.R3 : IDX.R4, f > 3 ? 0.5 : 1);
              }
              for (const sgn of [-1, 1]) {
                const ax = sgn * (bw / 2 + 2 + f * 2);
                p.band(ax - sgn * 6, hy, 6, 6, 1, IDX.R4, 1, sgn > 0 ? [-40, 40] : [140, 220]);
              }
            }
            break;
          case 'ring':
          default:
            break;
        }
        if (prm.halo && f >= 2) halo(p, g, half);
      }, hero ? 'hero' : 'normal');
    }
    return S.done('once');
  },
};
