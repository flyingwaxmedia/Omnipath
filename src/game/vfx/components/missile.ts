// missile: thrown matter (docs/VFX.md §5). Always outlined #24180f and shaded from the top-left in screen space.
// Spinning forms: 1 dir, 8 x 50 ms (4 poses a quarter turn apart + 4 smear frames, ~15.7 rad/s). Directional forms:
// 16 dirs, 4 x 67 ms with a glint on the 4th tick. `pose: 'wrap'` is held on the target (net wrap, hook bite).
// The glow twin is the imbue rim (silhouette dilation); the runtime shows it only when the body carries an element.
import { IDX, type MissileForm, type MissileParams, type Template } from '../types';
import type { Painter } from '../painter';
import { glowRim } from '../glow';
import { mulberry32 } from '../../../core/rng';
import { Strip, glint, headingOf, mkKey, seedOf, type TemplateOptions } from './kit';

const SPIN: ReadonlySet<MissileForm> = new Set<MissileForm>(['blade', 'cleaver', 'hammer', 'rock', 'net']);

function dirsOf(p: MissileParams): 1 | 16 {
  if (p.pose === 'wrap') return p.form === 'hook' ? 16 : 1;
  return SPIN.has(p.form) ? 1 : 16;
}

function keyOf(p: MissileParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('missile', { form: p.form, cell: p.cell, halo: p.halo, pose: p.pose }, null, opts);
}

/** Polygon with coordinates scaled by k. */
const polyK = (p: Painter, k: number, pts: number[], ink: number) => p.poly(pts.map((v) => v * k), ink);

/** Draw a form's silhouette in local space (+x = flight direction / blade tip). `v` = per-frame variant. */
function silhouette(p: Painter, form: MissileForm, k: number, v: number, seed: number, flat?: number): void {
  const I = (i: number) => flat ?? i;
  switch (form) {
    case 'blade':
      polyK(p, k, [10, 0, 7, -1.6, -3, -1.6, -3, 1.6, 7, 1.6], I(IDX.R3));
      polyK(p, k, [-4.6, -3.6, -3.1, -3.6, -3.1, 3.6, -4.6, 3.6], I(IDX.S2));
      polyK(p, k, [-8.5, -1, -4.6, -1, -4.6, 1, -8.5, 1], I(IDX.S1));
      p.stamp(-9.4 * k, 0, Math.max(0.6, k), I(IDX.S2));
      break;
    case 'cleaver':
      polyK(p, k, [8, -4.5, 8, 3.5, -2, 3.5, -2, -4.5], I(IDX.R3));
      polyK(p, k, [-2, -1, -9, -1, -9, 1, -2, 1], I(IDX.S1));
      if (flat === undefined) p.dot(6 * k, -2.5 * k, IDX.R1);
      break;
    case 'hammer':
      polyK(p, k, [-9, -1, 3, -1, 3, 1, -9, 1], I(IDX.S1));
      polyK(p, k, [3, -4.5, 9, -4.5, 9, 4.5, 3, 4.5], I(IDX.R2));
      polyK(p, k, [3, -4.5, 4.4, -4.5, 4.4, 4.5, 3, 4.5], I(IDX.S3));
      break;
    case 'knife':
      polyK(p, k, [6, 0, 4, -1.3, -1, -1.3, -1, 1.3, 4, 1.3], I(IDX.R4));
      polyK(p, k, [-1, -1.1, -5, -1.1, -5, 1.1, -1, 1.1], I(IDX.S1));
      if (flat === undefined) p.dot(6 * k, 0, IDX.R5);
      break;
    case 'needle':
      p.stroke(-4.5 * k, 0, 4.5 * k, 0, () => 1, I(IDX.R1));
      if (flat === undefined) {
        p.dot(4.5 * k, 0, IDX.R5);
        p.dot((v % 2 ? 0 : 1.5) * k, 0, IDX.R3);
      }
      break;
    case 'dart':
      polyK(p, k, [-5, 0, -8.5, -2.6, -6.5, 0], I(IDX.S3));
      polyK(p, k, [-5, 0, -8.5, 2.6, -6.5, 0], I(IDX.S3));
      polyK(p, k, [6, 0, 4, -1.2, -5, -1, -5, 1, 4, 1.2], I(IDX.R4));
      if (flat === undefined) p.dot(6 * k, 0, IDX.R5);
      break;
    case 'feather': {
      const s = v % 2 ? 0.7 : 1;
      polyK(p, k, [6, 0, 2, -2.6 * s, -5, -2 * s, -6.5, 0, -5, 2 * s, 2, 2.6 * s], I(IDX.R3));
      if (flat === undefined) p.line(-7 * k, 0, 6 * k, 0, IDX.R5);
      break;
    }
    case 'shard':
      p.poly([5.5 * k, 0, 0, -1.8 * k, -5.5 * k, 0, 0, 1.8 * k], (_lx, ly) => (flat ? flat : ly < 0 ? IDX.R4 : IDX.R2));
      break;
    case 'thorn':
      polyK(p, k, [6.5, 0, -1, -2.2, -4.5, -1.2, -3.5, 0.6, -1, 2], I(IDX.S2));
      if (flat === undefined) p.dot(6.5 * k, 0, IDX.ACCENT);
      break;
    case 'rock': {
      const rnd = mulberry32(seed);
      const pts: number[] = [];
      const n = 6;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + rnd() * 0.4;
        const r = 7.5 * k * (0.78 + rnd() * 0.27);
        pts.push(Math.cos(a) * r, Math.sin(a) * r);
      }
      p.poly(pts, I(IDX.R2));
      if (flat === undefined) p.line(pts[0] * 0.2, pts[1] * 0.2, pts[4] * 0.7, pts[5] * 0.7, IDX.R3);
      break;
    }
    case 'glob': {
      p.disc(0, 0, 3.6 * k, I(IDX.S1));
      p.disc(-2.2 * k, 1 * k, 2.6 * k, I(IDX.S1));
      p.disc(2.2 * k, -0.8 * k, 2.6 * k, I(IDX.S2));
      if (flat === undefined) {
        const o = (v >> 1) % 2;
        p.polyline([-3 * k, (o - 1) * k, -1 * k, 1 * k, 1 * k, (-1 + o) * k, 3 * k, 0.5 * k], (t) => (t > 0.4 && t < 0.7 ? IDX.R5 : IDX.R4));
        p.dot(-6 * k, (1.5 + (v % 2)) * k, IDX.R4);
      }
      break;
    }
    case 'net': {
      const h = 7.5 * k;
      for (let i = 0; i <= 3; i++) {
        const t = -h + (i * 2 * h) / 3;
        p.line(t, -h, t, h, I(i === 0 || i === 3 ? IDX.S3 : IDX.S2));
        p.line(-h, t, h, t, I(i === 0 || i === 3 ? IDX.S3 : IDX.S2));
      }
      for (const [x, y] of [
        [-h, -h],
        [h, -h],
        [h, h],
        [-h, h],
      ])
        p.stamp(x, y, Math.max(0.6, k * 1.1), I(IDX.R2));
      break;
    }
    case 'hook': {
      p.arcBand(2 * k, 0, 4 * k, -Math.PI / 2, Math.PI * 0.85, () => Math.max(1.6, 1.8 * k), () => I(IDX.R3));
      p.stroke(2 * k, -3 * k, -8 * k, -3 * k, () => Math.max(1.5, 1.7 * k), I(IDX.R3));
      const ex = 2 * k + Math.cos(Math.PI * 0.85) * 3 * k,
        ey = Math.sin(Math.PI * 0.85) * 3 * k;
      p.stroke(ex, ey, ex + 1.5 * k, ey - 2.5 * k, (t) => Math.max(1, 2 * (1 - t)), I(IDX.R4));
      break;
    }
  }
}

/** Tip radius of spinning forms (px at cell 24), for the smear wedge. */
const SPIN_R: Partial<Record<MissileForm, number>> = { blade: 10, cleaver: 9, hammer: 9.5, rock: 7.5, net: 8.5 };

function finish(p: Painter, prm: MissileParams, glintAt: [number, number] | null, after?: () => void): void {
  p.shade();
  if (glintAt) glint(p, glintAt[0], glintAt[1], 2, IDX.R5, IDX.R4);
  p.outline();
  // Motion smear sits under the outlined pose (an unoutlined streak, like a held swing smear).
  after?.();
  if (prm.halo) p.outline(IDX.ACCENT);
  glowRim(p.body, p.glow, p.w, p.h);
}

export const missile: Template<'missile'> = {
  id: 'missile',
  use: () => 'loop',
  dirs: dirsOf,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const C = prm.cell;
    const k = C / 24;
    const seed = seedOf(key, u);
    const S = new Strip(C, C, C / 2, C / 2, seed, opts, { matter: true, orphans: true, glowFrom: 'none' });
    if (prm.pose === 'wrap' && prm.form === 'net') {
      const rx = C * 0.42,
        ry = C * 0.45;
      for (let i = 0; i < 4; i++)
        S.add(150, (p) => {
          const sag = i % 2;
          for (let g = -2; g <= 2; g++) {
            const x = (g / 2.6) * rx;
            const yy = ry * Math.sqrt(Math.max(0, 1 - (x / rx) ** 2));
            p.line(x, -yy, x + (g ? sag * Math.sign(g) : 0), yy - 1, IDX.S2);
            const y = (g / 2.6) * ry;
            const xx = rx * Math.sqrt(Math.max(0, 1 - (y / ry) ** 2));
            p.line(-xx, y + sag, xx, y + sag, IDX.S2);
          }
          p.band(0, 0, rx, ry, 1, IDX.S3);
          p.stamp(-rx * 0.7, ry * 0.7 + sag, 1, IDX.R2);
          p.stamp(rx * 0.7, ry * 0.7 + 1 - sag, 1, IDX.R2);
          finish(p, prm, null);
        });
      return S.done('loop');
    }
    const dirs = dirsOf(prm);
    if (dirs === 1 && prm.pose === 'fly') {
      // Spinning: poses at quarter turns; smear frames add a wedge swept over the last 45 deg behind the tip.
      const R = (SPIN_R[prm.form] ?? 9) * k;
      for (let i = 0; i < 8; i++)
        S.add(50, (p) => {
          const a = (i * Math.PI) / 4;
          p.heading(a);
          silhouette(p, prm.form, k, i, seed);
          p.heading(0);
          const smear =
            i % 2 === 1
              ? () =>
                  p.arcBand(0, 0, R, a - Math.PI / 4, a - 0.12, (t) => Math.max(1, R * 0.5 * t), (_t, depth, _w, fx, fy) =>
                    p.get(fx, fy) ? 0 : depth < 1 ? IDX.R3 : IDX.R2,
                  )
              : undefined;
          finish(p, prm, null, smear);
        });
      return S.done('loop');
    }
    const heading = headingOf(u, dirs);
    const n = prm.pose === 'wrap' ? 2 : 4;
    for (let i = 0; i < n; i++)
      S.add(prm.pose === 'wrap' ? 100 : 67, (p) => {
        const wob = prm.pose === 'wrap' && i === 1 ? 0.08 : 0;
        p.heading(heading + wob);
        silhouette(p, prm.form, k, i, seed);
        const g: [number, number] | null = prm.pose === 'fly' && i === 3 ? [2 * k, -1 * k] : null;
        finish(p, prm, g);
      }, 'normal', heading);
    return S.done('loop');
  },
};
