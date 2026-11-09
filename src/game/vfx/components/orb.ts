// orb: energy projectile bodies (OrbForm) and the hand charge orb (docs/VFX.md §5 orb forms).
// Loops: 4 x 67 ms; big orbs with `orbit`: 8 x 83 ms. Directional forms face local +x (16 headings, tail behind);
// radial forms (charge, orbit, bubble, prism, moon) bake once. Loops never use WHITE: highlights are R5.
import { IDX, type OrbParams, type Template } from '../types';
import type { Painter } from '../painter';
import { Strip, glint, headingOf, mkKey, plus, runeMark, seedOf, type Rng, type TemplateOptions } from './kit';

const RADIAL = new Set(['bubble', 'prism', 'moon']);
const BODY_R: Record<number, number> = { 16: 3, 24: 5, 32: 7, 48: 10 };
const CHARGE_R: Record<number, number> = { 16: 2, 24: 3, 32: 4, 48: 5 };

function isRadial(p: OrbParams): boolean {
  return p.mode === 'charge' || !!p.orbit || RADIAL.has(p.form);
}

function keyOf(p: OrbParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('orb', p.mode === 'charge' ? { mode: p.mode, cell: p.cell, halo: p.halo } : { form: p.form, cell: p.cell, orbit: p.orbit, halo: p.halo, mode: p.mode }, null, opts);
}

/** Screen-space top-left highlight of a disc at local (cx, cy). */
function highlight(p: Painter, cx: number, cy: number, r: number, ink: number = IDX.R5): void {
  const fx = p.X(cx, cy),
    fy = p.Y(cx, cy);
  const o = Math.max(1, Math.round(r * 0.45));
  p.set(fx - o, fy - o, ink);
  if (r >= 6) p.set(fx - o + 1, fy - o, IDX.R4);
}

/** A tapered tail behind the body (local -x). */
function tail(p: Painter, r: number, len: number, ink0: number = IDX.R2, ink1: number = IDX.R1): void {
  if (len < 2) return;
  p.stroke(-r + 1, 0, -r - len, 0, (t) => Math.max(1, r * 1.4 * (1 - t)), (t) => (t < 0.45 ? ink0 : ink1));
}

function baseOrb(p: Painter, r: number, i: number, rnd: Rng): void {
  p.disc(0, 0, r + 1, IDX.R1, 0.5);
  p.disc(0, 0, r, IDX.R3);
  const cr = Math.max(1, r * 0.6 + (i % 2 ? 0.4 : 0));
  p.disc(r * 0.25, 0, cr, IDX.R4);
  p.disc(r * 0.3, 0, Math.max(0.5, cr * 0.5), IDX.R5);
  // 2-4 rim pixels shift every frame.
  const n = 2 + Math.floor(rnd() * 3);
  for (let k = 0; k < n; k++) {
    const a = rnd() * Math.PI * 2;
    p.dot(Math.cos(a) * (r + 1), Math.sin(a) * (r + 1), IDX.R2);
  }
  highlight(p, 0, 0, r);
}

function drawForm(p: Painter, prm: OrbParams, r: number, C: number, i: number, n: number, rnd: Rng): void {
  const tl = Math.max(0, Math.min(6, Math.floor(C / 2) - r - 2));
  const ph = i / n;
  switch (prm.form) {
    case 'orb':
      tail(p, r, tl);
      baseOrb(p, r, i, rnd);
      break;
    case 'fireball': {
      // Corona of tongues streaming back, rotating one step per frame.
      const nt = 7;
      for (let k = 0; k < nt; k++) {
        const a = ((k + ph) / nt) * Math.PI * 2;
        const back = (1 - Math.cos(a)) / 2;
        const len = 1.5 + back * Math.min(tl + 1, r * 0.9);
        const ex = Math.cos(a) * (r + len),
          ey = Math.sin(a) * (r + len) * (1 - back * 0.35);
        p.stroke(Math.cos(a) * (r - 1), Math.sin(a) * (r - 1), ex - back * 2, ey, (t) => Math.max(1, 2.6 * (1 - t)), (t) => (t < 0.5 ? IDX.R3 : IDX.R2));
      }
      p.disc(0, 0, r, IDX.R4);
      p.disc(r * 0.2, 0, Math.max(1, r * 0.55), IDX.R5);
      highlight(p, 0, 0, r, IDX.R5);
      break;
    }
    case 'shade':
      tail(p, r, tl, IDX.R1, IDX.R0);
      p.disc(0, 0, r + 1, IDX.R2, 0.5);
      p.disc(0, 0, r, IDX.R4);
      p.disc(-0.4, 0, Math.max(1, r - 1.2), IDX.R0);
      p.disc(r * 0.35, 0, Math.max(0.5, r * 0.25), IDX.R1);
      highlight(p, 0, 0, r, IDX.ACCENT);
      break;
    case 'spark': {
      tail(p, Math.max(1, r - 1), tl, IDX.R2, IDX.R1);
      p.disc(0, 0, r, IDX.R4, 0.5);
      p.disc(0, 0, Math.max(1, r * 0.55), IDX.R5);
      // Crackle re-seeded every frame, never a blank frame.
      for (let arc = 0; arc < 2; arc++) {
        const a0 = rnd() * Math.PI * 2;
        const pts: number[] = [];
        for (let k = 0; k <= 4; k++) {
          const a = a0 + k * 0.45;
          const rr = r + 1 + rnd() * 2;
          pts.push(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        p.polyline(pts, (t) => (t > 0.5 ? IDX.R5 : IDX.R4));
      }
      break;
    }
    case 'storm': {
      // Rain-fleck tail.
      for (let k = 0; k < 4; k++) {
        const x = -r - 1 - ((k * 3 + i * 2) % Math.max(3, tl + 2));
        const y = ((k * 5) % (r * 2 + 1)) - r;
        p.line(x, y, x - 1, y + 1, k % 2 ? IDX.S3 : IDX.S2);
      }
      p.disc(0, 0, r + 1, IDX.R1, 0.5);
      p.disc(0, 0, r, IDX.R3);
      p.disc(r * 0.2, 0, Math.max(1, r * 0.6), IDX.R4);
      highlight(p, 0, 0, r);
      break;
    }
    case 'lightbolt': {
      const L = r * 1.6,
        Wd = Math.max(2, r * 0.7);
      for (let k = 0; k < 2; k++) plus(p, -L - 2 - k * 4 - (i % 2) * 2, (k % 2 ? 1 : -1) * (i % 2), k ? IDX.R3 : IDX.R4, IDX.R3);
      p.poly([L, 0, 0, -Wd, -L, 0, 0, Wd], (lx, ly) => (Math.abs(ly) < 0.8 ? IDX.R5 : lx * 0.3 - ly > 0 ? IDX.R4 : IDX.R3));
      break;
    }
    case 'moon': {
      const a = (i % 4) * (Math.PI / 2);
      const ex = Math.cos(a) * r * 0.55,
        ey = Math.sin(a) * r * 0.55;
      p.crescent(0, 0, r, ex, ey, r * 0.9, (lx, ly) => {
        const d = Math.hypot(lx, ly);
        return d > r - 1 ? IDX.R5 : IDX.R4;
      });
      break;
    }
    case 'prism': {
      // 6 facets; the lit facet walks round one step per frame.
      const shades = [IDX.R5, IDX.R4, IDX.R3, IDX.R2, IDX.R2, IDX.R3];
      p.poly(hexPts(r + 0.5), (lx, ly) => {
        const a = Math.atan2(ly, lx);
        const f = (Math.floor(((a + Math.PI) / (Math.PI * 2)) * 6) + i) % 6;
        return shades[f];
      });
      p.outline(IDX.R1);
      break;
    }
    case 'lance': {
      const half = Math.max(2, Math.floor(C / 2) - 2);
      const t = Math.max(1.5, r * 0.45);
      p.stroke(-half, 0, half, 0, (s) => (s > 0.85 ? t * 2 * (1 - s) / 0.15 + 1 : t * 2), (_s, q) => (q < 0.35 ? IDX.R5 : q < 0.75 ? IDX.R3 : IDX.R2));
      p.line(-half + 2 + (i % 2), 0, half - 2, 0, (s) => (Math.floor(s * 6 + i) % 3 === 0 ? IDX.R4 : IDX.R5));
      break;
    }
    case 'wave': {
      const R = Math.max(5, C * 0.42);
      const A = (60 * Math.PI) / 180;
      p.arcBand(-R * 0.55, 0, R, -A, A, (t) => Math.max(1, R * 0.3) * Math.sin(Math.PI * t) ** 0.6, (_t, depth, w) =>
        depth < 1 ? IDX.R5 : depth / w < 0.5 ? IDX.R3 : IDX.R2,
      );
      break;
    }
    case 'gust': {
      const R = Math.max(4, C * 0.38);
      const A = (55 * Math.PI) / 180;
      const sh = i % 2;
      p.arcBand(-R * 0.5 - sh, 0, R, -A, A, (t) => 1.01 * (Math.sin(Math.PI * t) > 0.15 ? 1 : 0), () => IDX.R4);
      p.arcBand(-R * 0.5 - 3 - sh, 0, R - 1, -A * 0.8, A * 0.8, (t) => (Math.sin(Math.PI * t) > 0.25 ? 1 : 0), () => IDX.R3);
      break;
    }
    case 'spellblade': {
      const tip = C * 0.42,
        guard = -C * 0.18,
        grip = -C * 0.36;
      const bw = Math.max(1.5, C / 14);
      p.poly([tip, 0, tip - bw * 2.2, -bw, guard, -bw, guard, bw, tip - bw * 2.2, bw], (lx, ly, fx, fy) => {
        if (ly < -bw + 1) return IDX.R5;
        return p.pass(fx + i, fy, 0.5) ? IDX.R3 : IDX.R4;
      });
      p.line(guard, -bw - 2, guard, bw + 2, IDX.S2);
      p.line(guard - 1, 0, grip, 0, IDX.S1);
      p.dot(grip - 1, 0, IDX.S3);
      break;
    }
    case 'bubble': {
      const sq = i % 4 === 1 ? 1 : i % 4 === 3 ? -1 : 0;
      p.ellipse(0, 0, r + sq, r - sq, IDX.R2, 0.25);
      p.band(0, 0, r + sq, r - sq, 1, IDX.R4);
      const fx = p.X(0, 0) - Math.round(r * 0.45),
        fy = p.Y(0, 0) - Math.round(r * 0.45);
      p.set(fx, fy, IDX.R5);
      p.set(fx + 1, fy, IDX.R5);
      p.set(fx, fy + 1, IDX.R5);
      if (r >= 5) p.set(fx + 1, fy + 1, IDX.R5);
      break;
    }
    case 'droplet': {
      p.poly([-r * 2.2, 0, -r * 0.2, -r * 0.85, -r * 0.2, r * 0.85], IDX.R3);
      p.disc(0, 0, r, (_lx, _ly, fx, fy) => {
        const sy = fy - p.Y(0, 0),
          sx = fx - p.X(0, 0);
        return sy > r * 0.5 ? IDX.R2 : sx + sy < -r * 0.4 ? IDX.R4 : IDX.R3;
      });
      highlight(p, 0, 0, r, IDX.R5);
      break;
    }
  }
}

function hexPts(r: number): number[] {
  const out: number[] = [];
  for (let k = 0; k < 6; k++) out.push(Math.cos((k * Math.PI) / 3) * r, Math.sin((k * Math.PI) / 3) * r);
  return out;
}

/** Orbiting units for big orbs: 3 units on a tilted ellipse; back ones (sin < 0) dimmer. */
function drawOrbit(p: Painter, prm: OrbParams, r: number, C: number, i: number, n: number, seed: number, back: boolean): void {
  const R = Math.min(C / 2 - 3, r + 5);
  const motif = prm.orbit!;
  if (motif === 'spiral') {
    for (let arm = 0; arm < 2; arm++) {
      const a0 = (i / n) * Math.PI * 2 + arm * Math.PI;
      const pts: number[] = [];
      for (let k = 0; k <= 8; k++) {
        const a = a0 + k * 0.35;
        const rr = r + 1 + (k / 8) * (R - r);
        const y = Math.sin(a) * rr * 0.6;
        if (back !== y < 0) {
          if (pts.length >= 4) p.polyline(pts, back ? IDX.R2 : IDX.R4);
          pts.length = 0;
          continue;
        }
        pts.push(Math.cos(a) * rr, y);
      }
      if (pts.length >= 4) p.polyline(pts, back ? IDX.R2 : IDX.R4);
    }
    return;
  }
  for (let k = 0; k < 3; k++) {
    const a = (i / n + k / 3) * Math.PI * 2;
    const x = Math.cos(a) * R,
      y = Math.sin(a) * R * 0.6;
    if (back !== y < 0) continue;
    switch (motif) {
      case 'glyphs':
        runeMark(p, x, y, seed + k, back ? IDX.R3 : IDX.ACCENT);
        break;
      case 'shards': {
        const fx = p.X(x, y),
          fy = p.Y(x, y);
        for (const [dx, dy, v] of [
          [0, -2, IDX.R5],
          [0, -1, IDX.R4],
          [-1, 0, IDX.R4],
          [0, 0, IDX.R3],
          [1, 0, IDX.R2],
          [0, 1, IDX.R2],
        ])
          p.set(fx + dx, fy + dy, back ? Math.max(IDX.R1, v - 1) : v);
        for (const [dx, dy] of [
          [0, -3],
          [-1, -2],
          [1, -2],
          [-1, -1],
          [1, -1],
          [-2, 0],
          [2, 0],
          [-1, 1],
          [1, 1],
          [0, 2],
        ])
          p.under(fx + dx, fy + dy, IDX.OUTLINE);
        break;
      }
      case 'vines': {
        p.ring(x, y, 2, 1, back ? IDX.S1 : IDX.S2);
        p.dot(x + 2, y - 2, back ? IDX.S2 : IDX.S3);
        break;
      }
      case 'motes':
      default:
        p.stamp(x, y, 0.8, back ? IDX.R3 : IDX.R5);
        break;
    }
  }
}

export const orb: Template<'orb'> = {
  id: 'orb',
  use: () => 'loop',
  dirs: (p) => (isRadial(p) ? 1 : 16),
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const C = prm.cell;
    const radial = isRadial(prm);
    const S = new Strip(C, C, C / 2, C / 2, seedOf(key, u), opts, { orphans: true, glowFrom: 'bright' });
    const heading = radial ? 0 : headingOf(u, 16);
    if (prm.mode === 'charge') {
      const r = CHARGE_R[C];
      for (let i = 0; i < 4; i++)
        S.add(67, (p, rnd) => {
          const hot = i >= 2;
          p.disc(0, 0, r + 1, IDX.R2, 0.5);
          p.disc(0, 0, r, hot ? IDX.R4 : IDX.R3);
          p.disc(0, 0, Math.max(0.5, r * 0.5), hot ? IDX.R5 : IDX.R4);
          if (i === 1 || i === 3) {
            const a = rnd() * Math.PI * 2;
            glint(p, Math.cos(a) * (r + 2), Math.sin(a) * (r + 2), 1, IDX.R5, IDX.R4);
          }
          p.glowAt(0, 0, r + 3, 2);
          if (prm.halo) p.outline(IDX.ACCENT);
        });
      return S.done('loop');
    }
    const r = BODY_R[C];
    const n = prm.orbit ? 8 : 4;
    const ms = prm.orbit ? 83 : 67;
    for (let i = 0; i < n; i++)
      S.add(ms, (p, rnd) => {
        if (prm.orbit) drawOrbit(p, prm, r, C, i, n, S.seed, true);
        drawForm(p, prm, r, C, i, n, rnd);
        if (prm.orbit) drawOrbit(p, prm, r, C, i, n, S.seed, false);
        if (prm.form !== 'gust') p.glowAt(0, 0, r + 3, 1);
        if (prm.halo) p.outline(IDX.ACCENT);
      }, 'normal', heading);
    return S.done('loop');
  },
};

