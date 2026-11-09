// nova: the layered release at a nova centre (also death pops and dash landings), docs/VFX.md §5 and the nova-core
// spec. Small whatever the nova radius: units, rings and decals carry the scale. Cell (2c + 16)^2.
// Timing: (33 contrast if heavy; always for 'sky') · 50 hero · 100 hold · 6 x 67 · empty.
//
// Element identity (docs/VFX.md §3.3): three cores read the motif so families that share a core still differ in
// grayscale. 'blast' has a fire (fireball + rising tongues + embers), magma (crust lumps with glowing cracks and
// falling drips), earth (no white: dust shock + outlined rocks thrown on arcs), ice (faceted crystal flash + flying
// shards), steel (spark spray + grey dust + outlined chips) and a plain energy style (other families, death pops).
// 'ripple' has water (droplets), wind (no white, no fill: curved swirl streaks) and spirit (ki double rings 3 px
// apart). 'sky' has a storm style with a cloud cap and slanted rain. The style is part of the geometry key.
import { mulberry32 } from '../../../core/rng';
import { IDX, type CoreKind, type FamilyId, type NovaParams, type Template } from '../types';
import { midpoint, quantize, starPts, type Ball, type Painter } from '../painter';
import { Strip, chip, mkKey, plus, runeMark, seedOf, type Rng, type TemplateOptions } from './kit';

export type BlastStyle = 'fire' | 'magma' | 'earth' | 'ice' | 'steel' | 'energy';
export type RippleStyle = 'water' | 'wind' | 'spirit';

export function blastStyle(motif: FamilyId): BlastStyle {
  switch (motif) {
    case 'fire':
    case 'magma':
    case 'earth':
    case 'ice':
    case 'steel':
      return motif;
    case 'danger':
      return 'steel';
    default:
      return 'energy';
  }
}

export function rippleStyle(motif: FamilyId): RippleStyle {
  return motif === 'wind' ? 'wind' : motif === 'spirit' ? 'spirit' : 'water';
}

/** The motif-dependent drawing style of a core ('' when the core ignores the motif). */
export function coreStyle(core: CoreKind, motif: FamilyId): string {
  if (core === 'blast') return blastStyle(motif);
  if (core === 'ripple') return rippleStyle(motif);
  if (core === 'sky') return motif === 'storm' ? 'storm' : 'bolt';
  return '';
}

function keyOf(p: NovaParams, motif: FamilyId, opts: TemplateOptions): string {
  const v = coreStyle(p.core, motif);
  return mkKey('nova', { core: p.core, c: p.c, heavy: p.heavy, ...(v ? { v } : {}) }, null, opts);
}

interface CoreDraw {
  contrast?: (p: Painter) => void;
  hero: (p: Painter) => void;
  heroKind: 'hero' | 'normal';
  hold: (p: Painter) => void;
  tail: (p: Painter, j: number, rnd: Rng) => void;
}

/** Balls with per-frame drift and growth. */
interface Blob {
  a: number;
  d: number;
  r: number;
}

function blobs(rnd: Rng, n: number, d0: number, d1: number, r0: number, r1: number): Blob[] {
  const out: Blob[] = [];
  for (let k = 0; k < n; k++) out.push({ a: ((k + rnd() * 0.7) / n) * Math.PI * 2, d: d0 + rnd() * (d1 - d0), r: r0 + rnd() * (r1 - r0) });
  return out;
}

/** Ordered dissolve, outer pixels first (clean Bayer pattern, never salt-and-pepper). */
function fade(p: Painter, progress: number, c: number, seed: number): void {
  p.erode(progress, 'bayer', seed, (fx, fy) => (Math.hypot(fx - p.ox, fy - p.oy) / c - 0.5) * 0.5);
}

/** An irregular two-layer flash star (blast hold frames): long jagged spikes, a short inner star, hot centre. */
function flash(p: Painter, c: number, tips: readonly number[], rot: number): void {
  const n = tips.length;
  const outer: number[] = [];
  for (let s = 0; s < n * 2; s++) {
    const a = rot + (s * Math.PI) / n;
    const r = s % 2 === 0 ? tips[s / 2] : c * (0.36 + 0.08 * ((s * 7) % 3));
    outer.push(Math.cos(a) * r, Math.sin(a) * r);
  }
  p.poly(outer, (lx, ly) => {
    const d = Math.hypot(lx, ly) / c;
    return d < 0.3 ? IDX.R5 : d < 0.62 ? IDX.R4 : IDX.R3;
  });
  p.poly(starPts(0, 0, n, c * 0.22, c * 0.55, rot + Math.PI / n), IDX.R5);
}

/** Noisy white disc (blast hero frames). */
function heroDisc(p: Painter, r: number, noise: readonly number[]): void {
  p.fill(-r - 2, -r - 2, r + 2, r + 2, (lx, ly) => {
    const a = Math.atan2(ly, lx);
    const b = Math.floor(((a + Math.PI) / (Math.PI * 2)) * noise.length) % noise.length;
    return Math.hypot(lx, ly) <= r + noise[b] + 0.35 ? IDX.WHITE : 0;
  });
}

/** A lit rock (local centre, radius, seeded 5-7 sided polygon) shaded from the top-left; outlined later. */
function rock(p: Painter, x: number, y: number, r: number, rot: number, sides: number): void {
  const pts: number[] = [];
  for (let s = 0; s < sides; s++) {
    const a = rot + (s * Math.PI * 2) / sides;
    const rr = r * (s % 2 ? 0.78 : 1);
    pts.push(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  p.poly(pts, (lx, ly) => {
    const d = (lx - x + (ly - y)) / Math.max(1, r);
    return d < -0.45 ? IDX.R4 : d > 0.45 ? IDX.R2 : IDX.R3;
  });
}

function blast(style: BlastStyle, c: number, rnd: Rng, seed: number): CoreDraw {
  const k = c / 24;
  const noise = Array.from({ length: 24 }, () => Math.round((rnd() - 0.5) * 2));
  const nSp = 8 + Math.floor(rnd() * 5);
  const tips = Array.from({ length: nSp }, () => c * (0.72 + rnd() * 0.5));
  const rot = rnd() * Math.PI;
  const contrast = (p: Painter) => p.disc(0, 0, c * 0.4, IDX.R0);
  switch (style) {
    case 'earth': {
      // No white and no glow (earth is matter): a ground shock, rocks thrown up on arcs, a dust dome lit from the top.
      const rocks = Array.from({ length: 5 }, (_, i) => ({
        a: -Math.PI / 2 + ((i + 0.5) / 5 - 0.5) * 2.2 + (rnd() - 0.5) * 0.25,
        v: (0.75 + rnd() * 0.4) * k,
        r: (2 + rnd() * 1.6) * k,
        rot: rnd() * Math.PI,
        sides: 5 + Math.floor(rnd() * 3),
      }));
      const dome: Blob[] = [
        { a: -Math.PI / 2, d: c * 0.12, r: c * 0.3 },
        { a: Math.PI * 0.9, d: c * 0.36, r: c * 0.22 },
        { a: Math.PI * 0.1, d: c * 0.36, r: c * 0.22 },
        ...blobs(rnd, 3, c * 0.15, c * 0.3, c * 0.15, c * 0.2),
      ];
      const ground = c * 0.18;
      const rocksAt = (p: Painter, j: number) => {
        for (const r of rocks) {
          const t = j + 1.5;
          const x = Math.cos(r.a) * t * 4.5 * r.v;
          const y = ground - c * 0.2 + Math.sin(r.a) * t * 6 * r.v + t * t * 0.9 * k;
          if (y > ground + 2) continue;
          rock(p, x, y, r.r * (j > 3 ? 0.75 : 1), r.rot + j * 0.7, r.sides);
        }
        p.outline(IDX.OUTLINE, (i) => i >= IDX.R2 && i <= IDX.R4);
      };
      // Dust: crisp silhouette; each billow is lit on its top-left (S3), mid S2, shadowed base S1; cools every 2 frames.
      const dust = (p: Painter, grow: number, rise: number, shift: number, a = 1) => {
        const bs: Ball[] = dome.map((b) => ({ x: Math.cos(b.a) * b.d * grow, y: ground - rise - b.r * grow * 0.8 + Math.sin(b.a) * b.d * 0.5 * grow, r: b.r * grow }));
        const R = Math.max(...bs.map((b) => Math.hypot(b.x, b.y - ground) + b.r * 1.3));
        p.fill(-R, ground - rise - R, R, ground + 4, (lx, ly, fx, fy) => {
          if (p.get(fx, fy) || !p.pass(fx, fy, a)) return 0;
          let v = 0,
            best = -1,
            bv = 0;
          for (let i = 0; i < bs.length; i++) {
            const dx = lx - bs[i].x,
              dy = ly - bs[i].y;
            const f = (0.18 * bs[i].r * bs[i].r) / (dx * dx + dy * dy + 0.25);
            v += f;
            if (f > bv) {
              bv = f;
              best = i;
            }
          }
          if (v < 0.3 || ly > ground + 2) return 0;
          const b = bs[best];
          const lit = (lx - b.x) * -0.55 + (ly - b.y) * -0.85; // toward the top-left light
          const base = lit > b.r * 0.35 ? IDX.S3 : ly > ground - 2 || lit < -b.r * 0.55 ? IDX.S1 : IDX.S2;
          return Math.max(IDX.S0, base - shift);
        });
      };
      return {
        contrast,
        heroKind: 'normal',
        hero: (p) => {
          rocksAt(p, -1);
          p.band(0, ground, c * 0.48, c * 0.16, 2, (q) => (q === 0 ? IDX.R5 : IDX.R4));
          dust(p, 0.45, 0, 0);
        },
        hold: (p) => {
          rocksAt(p, 0);
          dust(p, 0.75, 0, 0);
          p.band(0, ground, c * 0.72, c * 0.24, 1, IDX.R4);
        },
        tail: (p, j) => {
          rocksAt(p, j + 1);
          dust(p, 0.9 + j * 0.08, j * 1.2 * k, Math.floor(j / 2), j >= 3 ? 1 - (j - 2) * 0.25 : 1);
          if (j < 1) p.band(0, ground, c * 0.85, c * 0.28, 1, IDX.R3);
        },
      };
    }
    case 'ice': {
      // Faceted crystal flash, then shards fly out turning, glints wink, a frost ring settles.
      const n = 6;
      const rot6 = -Math.PI / 2 + (rnd() - 0.5) * 0.3;
      const shards = Array.from({ length: 8 }, (_, i) => ({ a: (i / 8) * Math.PI * 2 + rnd() * 0.5, v: (0.8 + rnd() * 0.5) * k, L: (3 + rnd() * 3) * k, spin: (rnd() - 0.5) * 0.8 }));
      const crystal = (p: Painter, r1: number, hot: boolean) => {
        for (let s = 0; s < n; s++) {
          const a = rot6 + (s * Math.PI * 2) / n;
          const L = r1 * (s % 2 ? 0.7 : 1);
          const w = 0.32;
          const tip = [Math.cos(a) * L, Math.sin(a) * L];
          const l = [Math.cos(a - w) * L * 0.38, Math.sin(a - w) * L * 0.38];
          const r = [Math.cos(a + w) * L * 0.38, Math.sin(a + w) * L * 0.38];
          // Two facets per spike: the one facing the top-left light is bright.
          const lit = Math.cos(a - w / 2 + Math.PI * 0.75) > 0;
          p.poly([0, 0, l[0], l[1], tip[0], tip[1]], lit ? IDX.R5 : IDX.R3);
          p.poly([0, 0, tip[0], tip[1], r[0], r[1]], lit ? IDX.R4 : IDX.R2);
        }
        p.disc(0, 0, r1 * 0.2, hot ? IDX.WHITE : IDX.R5);
      };
      const shard = (p: Painter, x: number, y: number, a: number, L: number, ink: number) => {
        const ca = Math.cos(a),
          sa = Math.sin(a);
        p.poly([x + ca * L, y + sa * L, x - sa * 1.2, y + ca * 1.2, x - ca * L * 0.6, y - sa * L * 0.6, x + sa * 1.2, y - ca * 1.2], (lx, ly) =>
          (lx - x) * -sa + (ly - y) * ca < 0 ? ink : Math.max(IDX.R1, ink - 2),
        );
      };
      return {
        contrast,
        heroKind: 'hero',
        hero: (p) => {
          heroDisc(p, c * 0.45, noise);
          crystal(p, c * 0.7, true);
          p.glowAt(0, 0, c * 0.8, 3);
        },
        hold: (p) => crystal(p, c * 0.85, false),
        tail: (p, j) => {
          if (j < 2) crystal(p, c * (0.5 - j * 0.18), false);
          for (const s of shards) {
            const d = c * 0.35 + (j + 1) * 4 * s.v;
            const x = Math.cos(s.a) * d,
              y = Math.sin(s.a) * d + j * j * 0.25 * k;
            shard(p, x, y, s.a + s.spin * j, s.L * (j > 3 ? 0.7 : 1), j < 2 ? IDX.R5 : j < 4 ? IDX.R4 : IDX.R3);
          }
          if (j === 1 || j === 3) for (const s of shards.slice(0, 3)) plus(p, Math.cos(s.a + 0.4) * c * 0.5, Math.sin(s.a + 0.4) * c * 0.5, IDX.R5, IDX.R4);
          p.band(0, c * 0.2, c * (0.55 + 0.08 * j), c * (0.24 + 0.035 * j), 1, j < 3 ? IDX.R4 : IDX.R3, j < 4 ? 1 : 0.5);
          if (j >= 3) fade(p, (j - 2) / 4, c, seed);
        },
      };
    }
    case 'steel': {
      // Spark spray with gravity, grey dust at the feet and outlined metal chips; white only on the hero frame.
      const sparks = Array.from({ length: 12 }, () => ({ a: -Math.PI / 2 + (rnd() - 0.5) * 3.6, v: (0.8 + rnd() * 0.6) * k, L: 2 + rnd() * 3 }));
      const chips = Array.from({ length: 5 }, () => ({ a: -Math.PI / 2 + (rnd() - 0.5) * 2.8, v: (0.5 + rnd() * 0.4) * k }));
      const spray = (p: Painter, j: number) => {
        for (const s of sparks) {
          const t = j + 1.5;
          const d = c * 0.2 + t * 5 * s.v;
          const x = Math.cos(s.a) * d,
            y = Math.sin(s.a) * d + t * t * 0.45 * k;
          const len = s.L * k * (j > 3 ? 0.6 : 1);
          const ang = Math.atan2(Math.sin(s.a) * 5 * s.v + t * 0.9 * k, Math.cos(s.a) * 5 * s.v);
          p.line(x - Math.cos(ang) * len, y - Math.sin(ang) * len, x, y, (q) => (q > 0.6 ? (j < 2 ? IDX.R5 : IDX.R4) : j < 2 ? IDX.ACCENT : IDX.R3));
        }
      };
      return {
        contrast,
        heroKind: 'hero',
        hero: (p) => {
          heroDisc(p, c * 0.42, noise);
          p.glowAt(0, 0, c * 0.6, 3);
        },
        hold: (p) => {
          flash(p, c * 0.8, tips, rot);
          spray(p, -1);
        },
        tail: (p, j) => {
          spray(p, j);
          for (const ch of chips) {
            const t = j + 1;
            const x = Math.cos(ch.a) * (c * 0.2 + t * 4 * ch.v),
              y = Math.sin(ch.a) * (c * 0.2 + t * 4 * ch.v) + t * t * 0.5 * k;
            if (y < c * 0.4) chip(p, x, y, IDX.R2);
          }
          if (j < 3) p.band(0, c * 0.2, c * (0.5 + 0.1 * j), c * (0.18 + 0.04 * j), 1, j < 1 ? IDX.R4 : IDX.R3, j < 2 ? 1 : 0.5);
          if (j >= 2) fade(p, (j - 1) / 5, c, seed);
        },
      };
    }
    case 'magma': {
      // Heavy dark crust lumps with glowing cracks; molten core cools; drips fall. Crust edges use S0 (#24180f).
      const lumps = blobs(rnd, 5 + Math.floor(rnd() * 3), c * 0.25, c * 0.45, c * 0.17, c * 0.27);
      const cracks = lumps.map((b, i) => midpoint(Math.cos(b.a) * b.d * 0.4, Math.sin(b.a) * b.d * 0.4, Math.cos(b.a) * (b.d + b.r * 0.8), Math.sin(b.a) * (b.d + b.r * 0.8), 0.3, mulberry32(seed + i * 31), 2));
      const drips = Array.from({ length: 4 }, () => ({ x: (rnd() - 0.5) * c * 0.9, y0: c * 0.1 + rnd() * c * 0.2 }));
      const crust = (p: Painter, j: number) => {
        const out = j * 1.6 * k;
        const bs: Ball[] = lumps.map((b) => ({ x: Math.cos(b.a) * (b.d + out), y: Math.sin(b.a) * (b.d + out) + j * 0.8 * k, r: b.r * (1 - 0.04 * j) }));
        if (j < 2) bs.push({ x: 0, y: 0, r: c * 0.32 * (1 - j * 0.35) });
        p.metaballs(bs, (v) => {
          if (v < 0.18) return 0;
          if (v > 1.6 && j < 2) return j === 0 ? IDX.R5 : IDX.R4; // molten heart
          if (v > 1.15 && j < 3) return IDX.R3;
          return v < 0.45 ? IDX.S1 : v < 0.85 ? IDX.S2 : IDX.S3;
        });
        const hot = j < 2 ? IDX.R5 : j < 4 ? IDX.R4 : IDX.R3;
        cracks.forEach((cr, i) => {
          const dx = Math.cos(lumps[i].a) * out,
            dy = Math.sin(lumps[i].a) * out + j * 0.8 * k;
          const pts = cr.map((v, q) => v + (q % 2 ? dy : dx));
          p.polyline(pts, (t) => (t < 0.5 ? hot : Math.max(IDX.R2, hot - 1)));
        });
        p.outline(IDX.S0, (i) => i >= IDX.S1 && i <= IDX.S3);
      };
      return {
        contrast,
        heroKind: 'hero',
        hero: (p) => {
          heroDisc(p, c * 0.5, noise);
          p.glowAt(0, 0, c * 0.8, 3);
        },
        hold: (p) => {
          flash(p, c * 0.75, tips, rot);
          p.disc(0, 0, c * 0.3, IDX.R5);
        },
        tail: (p, j) => {
          crust(p, j);
          for (const d of drips) {
            if (j < 1 || j > 4) continue;
            const y = d.y0 + (j - 1) * (j - 1) * 2 * k;
            p.line(d.x, y - 2 * k, d.x, y, (t) => (t > 0.5 ? IDX.R4 : IDX.R3));
          }
          if (j >= 3) fade(p, (j - 2) / 4, c, seed);
        },
      };
    }
    case 'fire':
    case 'energy':
    default: {
      // Fireball metaballs that cool and drift out over a rising smoke cap; fire adds rising tongues and embers.
      const fire = blobs(rnd, 5 + Math.floor(rnd() * 5), c * 0.3, c * 0.5, c * 0.16, c * 0.3);
      const smoke = blobs(rnd, 3, c * 0.1, c * 0.3, c * 0.18, c * 0.28);
      const chips = Array.from({ length: 4 + Math.floor(rnd() * 5) }, () => ({ a: -Math.PI / 2 + (rnd() - 0.5) * 3.4, v: 0.7 + rnd() * 0.6 }));
      const tongues = Array.from({ length: 5 }, (_, i) => ({ a: -Math.PI * (0.18 + (0.64 * i) / 4) + (rnd() - 0.5) * 0.2, L: (5 + rnd() * 4) * k, ph: rnd() * Math.PI * 2 }));
      const embers = Array.from({ length: 5 }, () => ({ x: (rnd() - 0.5) * c * 1.1, y: -c * (0.2 + rnd() * 0.3), v: (1.6 + rnd() * 1.2) * k }));
      return {
        contrast,
        heroKind: 'hero',
        hero: (p) => {
          heroDisc(p, c * 0.6, noise);
          p.glowAt(0, 0, c * 0.9, 3);
        },
        hold: (p) => flash(p, c, tips, rot),
        tail: (p, j) => {
          if (j >= 1) {
            const sb: Ball[] = smoke.map((b) => ({ x: Math.cos(b.a) * b.d, y: -c * 0.3 - j * 2.2 * k + Math.sin(b.a) * b.d * 0.5, r: b.r * (1 + j * 0.12) }));
            const sh = Math.floor((j - 1) / 2);
            p.metaballs(sb, (v, fx, fy) => {
              const i = quantize(v, p, fx, fy);
              return i ? Math.max(IDX.S0, Math.min(IDX.S3, IDX.S0 + (i - IDX.R0) - 1 - sh)) : 0;
            });
          }
          if (j < 5) {
            const fb: Ball[] = fire.map((b) => ({ x: Math.cos(b.a) * (b.d + j * 2.5 * k), y: Math.sin(b.a) * (b.d + j * 2.5 * k), r: b.r * 1.1 ** j }));
            if (j < 2) fb.push({ x: 0, y: 0, r: c * 0.38 * (1 - j * 0.3) });
            p.metaballs(fb, (v, fx, fy) => quantize(v, p, fx, fy, Math.floor(j * 0.8)));
          }
          if (style === 'fire' && j < 4)
            for (const tg of tongues) {
              const bx = Math.cos(tg.a) * (c * 0.42 + j * 2 * k),
                by = Math.sin(tg.a) * (c * 0.42 + j * 2 * k) - j * 1.5 * k;
              const L = tg.L * (1 - j * 0.2);
              const pts: number[] = [];
              for (let q = 0; q <= 4; q++) pts.push(bx + Math.sin(tg.ph + q * 1.3) * 1.2 * k, by - (L * q) / 4);
              p.polyline(pts, (t) => (t < 0.3 ? (j < 2 ? IDX.R5 : IDX.R4) : t < 0.7 ? IDX.R4 : IDX.R3));
            }
          if (style === 'fire')
            for (const e of embers) if (j < 5) p.dot(e.x, e.y - j * e.v * 2, j < 3 ? IDX.R5 : IDX.R4);
          if (style !== 'fire')
            for (const ch of chips) {
              const d = c * 0.45 + j * 4 * k * ch.v;
              const x = Math.cos(ch.a) * d,
                y = Math.sin(ch.a) * d + j * j * 0.7 * k;
              p.dot(x, y, IDX.R2);
              p.dot(x + 1, y, IDX.R3);
            }
          if (j >= 2) fade(p, (j - 1) / 5, c, seed);
        },
      };
    }
  }
}

function core(kind: CoreKind, c: number, rnd: Rng, seed: number, motif: FamilyId): CoreDraw {
  const k = c / 24;
  switch (kind) {
    case 'blast':
      return blast(blastStyle(motif), c, rnd, seed);
    case 'ripple': {
      const style = rippleStyle(motif);
      if (style === 'wind') {
        // No white, no fill, no outline (wind): curved swirl streaks that open outward, a few leaves.
        const arcs = Array.from({ length: 4 }, (_, i) => ({ a: ((i / 4) * 360 + rnd() * 25) * (Math.PI / 180), len: (55 + rnd() * 25) * (Math.PI / 180) }));
        const leaves = Array.from({ length: 3 }, () => ({ a: rnd() * Math.PI * 2, d: c * (0.3 + rnd() * 0.3) }));
        // Spiral streaks: the radius opens along each streak, the head is the bright end.
        const swirl = (p: Painter, rx: number, turn: number, head: number, body: number, a = 1) => {
          for (const s of arcs) {
            const pts: number[] = [];
            for (let q = 0; q <= 8; q++) {
              const th = s.a + (turn * Math.PI) / 180 + (s.len * q) / 8;
              const r = rx * (0.7 + 0.35 * (q / 8));
              pts.push(Math.cos(th) * r, Math.sin(th) * r * 0.5);
            }
            p.polyline(pts, (t) => (t > 0.75 ? head : body), a);
          }
        };
        return {
          heroKind: 'normal',
          hero: (p) => swirl(p, c * 0.42, 0, IDX.R5, IDX.R4),
          hold: (p) => swirl(p, c * 0.55, 25, IDX.R5, IDX.R4),
          tail: (p, j) => {
            swirl(p, c * (0.62 + 0.08 * j), 25 + 22 * (j + 1), j < 3 ? IDX.R4 : IDX.R3, j < 3 ? IDX.R3 : IDX.R2, j >= 4 ? 0.5 : 1);
            if (j < 2) swirl(p, c * (0.36 + 0.06 * j), 40 + 30 * j, IDX.R4, IDX.R3);
            if (j < 5)
              for (const l of leaves) {
                const a = l.a + j * 0.35;
                const x = Math.cos(a) * (l.d + j * 2 * k),
                  y = Math.sin(a) * (l.d + j * 2 * k) * 0.5 - j * k;
                p.dot(x, y, IDX.S2);
                p.dot(x + 1, y, IDX.S3);
                p.dot(x, y + 1, IDX.S1);
              }
          },
        };
      }
      if (style === 'spirit') {
        // Ki: a small white core, then rounded double rings exactly 3 px apart travelling out.
        const dbl = (p: Painter, rx: number, outer: number, inner: number, w: number, a = 1) => {
          p.band(0, 0, rx, rx * 0.55, w, outer, a);
          if (rx > 5) p.band(0, 0, rx - 3 - (w - 1), (rx - 3 - (w - 1)) * 0.55, 1, inner, a);
        };
        return {
          heroKind: 'hero',
          hero: (p) => {
            p.ellipse(0, 0, c * 0.22, c * 0.13, IDX.WHITE);
            dbl(p, c * 0.36, IDX.R5, IDX.R4, 2);
            p.glowAt(0, 0, c * 0.5, 3);
          },
          hold: (p) => {
            p.ellipse(0, 0, c * 0.14, c * 0.08, IDX.R5);
            dbl(p, c * 0.5, IDX.R5, IDX.R4, 2);
          },
          tail: (p, j) => {
            const inks = [IDX.R5, IDX.R4, IDX.R4, IDX.R3, IDX.R3, IDX.R2];
            dbl(p, c * (0.6 + 0.08 * j), inks[j], Math.max(IDX.R1, inks[j] - 1), j < 2 ? 2 : 1, j >= 4 ? 0.5 : 1);
            if (j < 3) dbl(p, c * (0.3 + 0.06 * j), inks[j + 2], Math.max(IDX.R1, inks[j + 2] - 1), 1);
          },
        };
      }
      const drops = Array.from({ length: 6 }, (_, i) => ({ x: (i < 3 ? -1 : 1) * c * (0.1 + (i % 3) * 0.1), h: c * (0.3 + rnd() * 0.25) }));
      return {
        heroKind: 'hero',
        hero: (p) => {
          p.ellipse(0, 0, c * 0.5, c * 0.28, IDX.WHITE);
          p.glowAt(0, 0, c * 0.7, 3);
        },
        hold: (p) => {
          p.band(0, 0, c * 0.56, c * 0.31, 2, (q) => (q === 0 ? IDX.R5 : IDX.R4));
          p.band(0, 0, c * 0.36, c * 0.2, 1, IDX.R4);
          // A splash column rising from the centre.
          p.ellipse(0, -c * 0.12, c * 0.08, c * 0.2, IDX.R5);
        },
        tail: (p, j) => {
          const inks = [IDX.R4, IDX.R4, IDX.R3, IDX.R3, IDX.R2, IDX.R2];
          for (const [s, f] of [
            [0.62, 0],
            [0.36, 1],
          ]) {
            const rx = (s + 0.07 * j) * c;
            p.band(0, 0, rx, rx * 0.55, j < 2 ? 2 : 1, Math.max(IDX.R1, inks[j] - f), j >= 4 ? 0.5 : 1);
          }
          if (j < 4)
            for (const d of drops) {
              const y = -Math.sin((Math.PI * (j + 1)) / 5) * d.h;
              p.dot(d.x * (1 + j * 0.15), y, IDX.R5);
              p.dot(d.x * (1 + j * 0.15), y + 1, IDX.R3);
            }
        },
      };
    }
    case 'implode': {
      const streaks = Array.from({ length: 6 }, (_, i) => (i / 6) * Math.PI * 2 + rnd() * 0.5);
      const spiral = (p: Painter, r0: number, r1: number, off: number) => {
        for (const a0 of streaks) {
          const pts: number[] = [];
          for (let t = 0; t <= 1; t += 0.25) {
            const a = a0 + off + t * 0.8;
            const r = r0 + (r1 - r0) * t;
            pts.push(Math.cos(a) * r, Math.sin(a) * r);
          }
          p.polyline(pts, (t) => (t > 0.7 ? IDX.R5 : IDX.R4));
        }
      };
      const accretion = (p: Painter, rot: number, ink: number) => {
        p.band(0, 0, c * 0.8, c * 0.32, 1, ink, 1, [rot, rot + 70]);
        p.band(0, 0, c * 0.8, c * 0.32, 1, ink, 1, [rot + 180, rot + 250]);
      };
      return {
        heroKind: 'normal',
        hero: (p) => {
          spiral(p, c * 0.9, c * 0.6, 0);
          p.disc(0, 0, c * 0.3, IDX.R0);
          p.ring(0, 0, c * 0.3 + 1, 1, IDX.R5);
        },
        hold: (p) => {
          spiral(p, c * 0.6, c * 0.44, 0.6);
          p.disc(0, 0, c * 0.4, IDX.R0);
          p.ring(0, 0, c * 0.4 + 1, 1, IDX.R5);
          accretion(p, 0, IDX.R4);
        },
        tail: (p, j) => {
          const dr = Math.max(1, c * 0.4 * (1 - j / 6));
          p.disc(0, 0, dr, IDX.R0);
          p.ring(0, 0, dr + 1, 1, j < 3 ? IDX.R4 : IDX.R3);
          accretion(p, 30 * (j + 1), j < 3 ? IDX.R3 : IDX.R2);
          const rr = (0.95 - 0.13 * j) * c;
          if (rr > dr + 2) p.ring(0, 0, rr, 1, j < 2 ? IDX.R4 : j < 4 ? IDX.R3 : IDX.R2);
          if (j >= 4) fade(p, (j - 3) / 3, c, seed);
        },
      };
    }
    case 'radiant': {
      // Holy: vertical light first (a beam and a cross flare over a round core), then rings in sequence and rising
      // sparkles. Round and square shapes only, no jagged edges.
      const sp = Array.from({ length: 5 }, () => ({ x: (rnd() - 0.5) * 1.2 * c, y: -rnd() * 0.3 * c }));
      const beam = (p: Painter, half: number, top: number, ink: number, rim: number) => {
        p.fill(-half - 1, -top, half + 1, 0, (lx) => (Math.abs(lx) <= half - 0.5 ? ink : Math.abs(lx) <= half + 0.5 ? rim : 0));
      };
      return {
        heroKind: 'hero',
        hero: (p) => {
          beam(p, 1.5 * k, c * 1.1, IDX.WHITE, IDX.R5);
          p.disc(0, 0, 6 * k, IDX.WHITE);
          p.line(-c * 0.55, 0, c * 0.55, 0, (t) => (Math.abs(t - 0.5) < 0.3 ? IDX.WHITE : IDX.R5));
          p.glowAt(0, 0, c * 0.7, 3);
        },
        hold: (p) => {
          beam(p, 1 * k, c * 0.95, IDX.R5, IDX.R4);
          p.ring(0, 0, 8 * k, 2, (q) => (q === 0 ? IDX.R5 : IDX.R4));
          p.disc(0, 0, 4 * k, IDX.R5);
          p.line(-c * 0.4, 0, c * 0.4, 0, IDX.R4);
        },
        tail: (p, j) => {
          if (j < 2) beam(p, 0.5, c * (0.8 - j * 0.25), IDX.R4, 0);
          const r = Math.min(c, (10 + 3 * j) * k);
          p.ring(0, 0, r, 1, j < 2 ? IDX.R4 : j < 4 ? IDX.R3 : IDX.R2, j >= 4 ? 0.5 : 1);
          if (j >= 1 && j < 4) p.ring(0, 0, Math.max(3, r - 4 * k), 1, j < 2 ? IDX.R5 : IDX.R3);
          for (const s of sp) plus(p, s.x, s.y - j * 2 * k, j < 2 ? IDX.R5 : IDX.R4, j < 3 ? IDX.R4 : IDX.R3);
        },
      };
    }
    case 'sky': {
      const bolt = midpoint(0, -c - 6, 0, 0, 0.15, mulberry32(seed ^ 0x51), 3);
      const arcs = Array.from({ length: 5 }, (_, i) => {
        const a = ((i + rnd() * 0.6) / 5) * Math.PI * 2;
        const L = c * (0.45 + rnd() * 0.2);
        return midpoint(0, 0, Math.cos(a) * L, Math.sin(a) * L * 0.5, 0.25, mulberry32(seed + i), 2);
      });
      const ticks = Array.from({ length: 4 }, () => ({ x: (rnd() - 0.5) * c, y: (rnd() - 0.5) * c * 0.5 }));
      const storm = motif === 'storm';
      const cloud = blobs(rnd, 5, c * 0.1, c * 0.45, c * 0.16, c * 0.22);
      const rain = Array.from({ length: 7 }, () => ({ x: (rnd() - 0.5) * c * 1.2, y: -c * (0.1 + rnd() * 0.7) }));
      const cap = (p: Painter, shift: number) =>
        p.metaballs(cloud.map((b) => ({ x: Math.cos(b.a) * b.d * 1.4, y: -c - 6 + Math.sin(b.a) * b.d * 0.3, r: b.r })), (v, fx, fy) => {
          const i = quantize(v, p, fx, fy, shift);
          return i ? Math.max(IDX.S0, Math.min(IDX.S3, IDX.S0 + (i - IDX.R1))) : 0;
        });
      const drizzle = (p: Painter, j: number, ink: number) => {
        for (const r of rain) {
          const y = r.y + j * 5 * k;
          if (y > c * 0.3) continue;
          p.line(r.x, y, r.x - 2, y + 4, ink);
        }
      };
      return {
        contrast: (p) => p.disc(0, 0, c * 0.5, IDX.R0, 0.5),
        heroKind: 'hero',
        hero: (p) => {
          if (storm) cap(p, 0);
          for (let s = 0; s < bolt.length / 2; s++) p.stamp(bolt[s * 2], bolt[s * 2 + 1], 1, IDX.R4, 1, true);
          p.polyline(bolt, IDX.WHITE);
          p.disc(0, 0, 4 * k, IDX.WHITE);
          p.glowAt(0, 0, c * 0.6, 3);
        },
        hold: (p) => {
          if (storm) {
            cap(p, 0);
            drizzle(p, 0, IDX.S3);
          }
          p.disc(0, 0, 3 * k, IDX.R5);
          for (const a of arcs) p.polyline(a, (t) => (t < 0.3 ? IDX.R5 : IDX.R4));
        },
        tail: (p, j) => {
          if (storm) {
            if (j < 4) cap(p, Math.floor(j / 2));
            drizzle(p, j + 1, j < 3 ? IDX.S3 : IDX.S2);
          }
          for (const a of arcs) p.polyline(a, j < 2 ? IDX.R3 : IDX.R2);
          for (const t of ticks) if (j < 5) p.line(t.x, t.y, t.x + 2, t.y + 1, IDX.R0);
          fade(p, j / 6, c, seed);
        },
      };
    }
    case 'rune': {
      const shards = Array.from({ length: 8 }, (_, i) => (i / 8) * Math.PI * 2 + rnd() * 0.3);
      const draw = (p: Painter, ring: number, glyph: number) => {
        p.ring(0, 0, c * 0.8, 1, ring);
        p.ring(0, 0, c * 0.6, 1, ring);
        const v = (n: number): [number, number] => [Math.cos(-Math.PI / 2 + (n * Math.PI * 2) / 5) * c * 0.58, Math.sin(-Math.PI / 2 + (n * Math.PI * 2) / 5) * c * 0.58];
        for (let s = 0; s < 5; s++) {
          const [x0, y0] = v(s * 2),
            [x1, y1] = v(s * 2 + 2);
          p.line(x0, y0, x1, y1, ring);
        }
        for (let g = 0; g < 8; g++) {
          const a = ((g + 0.5) / 8) * Math.PI * 2;
          runeMark(p, Math.cos(a) * c * 0.7, Math.sin(a) * c * 0.7, seed + g, glyph);
        }
      };
      return {
        heroKind: 'hero',
        hero: (p) => {
          draw(p, IDX.WHITE, IDX.WHITE);
          p.glowAt(0, 0, c * 0.5, 3);
        },
        hold: (p) => draw(p, IDX.R4, IDX.ACCENT),
        tail: (p, j) => {
          draw(p, j < 2 ? IDX.R3 : IDX.R2, IDX.ACCENT);
          fade(p, j / 6, c, seed);
          for (const a of shards) {
            const d = (0.7 + 0.1 * j) * c;
            p.poly([Math.cos(a) * (d + 2), Math.sin(a) * (d + 2), Math.cos(a + 0.12) * d, Math.sin(a + 0.12) * d, Math.cos(a) * (d - 2), Math.sin(a) * (d - 2), Math.cos(a - 0.12) * d, Math.sin(a - 0.12) * d], j < 3 ? IDX.R4 : IDX.R3);
          }
        },
      };
    }
    case 'cloud': {
      const puffs = blobs(rnd, 6, c * 0.1, c * 0.35, c * 0.22, c * 0.3);
      const pops = Array.from({ length: 3 }, () => ({ x: (rnd() - 0.5) * c, y: (rnd() - 0.5) * c * 0.6 }));
      const draw = (p: Painter, grow: number, out: number, shift: number) => {
        const bs: Ball[] = puffs.map((b) => ({ x: Math.cos(b.a) * (b.d + out), y: Math.sin(b.a) * (b.d + out) * 0.7, r: b.r * grow }));
        p.metaballs(bs, (v, fx, fy) => {
          const i = quantize(v, p, fx, fy, shift);
          return i ? Math.max(IDX.R1, Math.min(IDX.R4, i)) : 0;
        });
        p.outline(IDX.ACCENT, (v) => v !== 0 && v !== IDX.ACCENT);
      };
      return {
        heroKind: 'normal',
        hero: (p) => draw(p, 0.85, 0, 0),
        hold: (p) => draw(p, 1, 0, 0),
        tail: (p, j) => {
          draw(p, 1.06 ** (j + 1), (j + 1) * 1.5 * k, Math.floor(j / 2));
          for (const [n, s] of pops.entries()) {
            if (j === n + 1) p.ring(s.x, s.y, 2, 1, IDX.R4);
            if (j === n + 2) for (const [dx, dy] of [[0, -3], [3, 0], [0, 3], [-3, 0]]) p.dot(s.x + dx, s.y + dy, IDX.R3);
          }
          if (j >= 2) fade(p, (j - 1) / 5, c, seed);
        },
      };
    }
    case 'goo': {
      const lobes = blobs(rnd, 5, c * 0.5, c * 0.62, c * 0.16, c * 0.24);
      const draw = (p: Painter, flat: number, out: number, drip: number, shift: number) => {
        const bs: Ball[] = [{ x: 0, y: 0, r: c * 0.45 }, ...lobes.map((b) => ({ x: Math.cos(b.a) * (b.d + out), y: Math.sin(b.a) * (b.d + out) * flat, r: b.r }))];
        if (drip > 0) for (const b of lobes.slice(0, 3)) bs.push({ x: Math.cos(b.a) * b.d, y: Math.sin(b.a) * b.d * flat + c * 0.2 + drip, r: b.r * 0.45 });
        p.metaballs(bs, (v, fx, fy) => quantize(v, p, fx, fy, shift));
        const hx = p.X(-c * 0.2, -c * 0.18),
          hy = p.Y(-c * 0.2, -c * 0.18);
        if (shift < 2) {
          p.set(hx, hy, IDX.R5);
          p.set(hx + 1, hy, IDX.R5);
        }
      };
      return {
        heroKind: 'hero',
        hero: (p) => {
          p.disc(0, 0, c * 0.4, IDX.WHITE);
          p.glowAt(0, 0, c * 0.6, 3);
        },
        hold: (p) => draw(p, 0.8, 0, 0, 0),
        tail: (p, j) => {
          draw(p, 0.8 - 0.07 * j, j * k, (j + 1) * 2 * k, Math.floor(j / 2));
          if (j >= 2) fade(p, (j - 1) / 5, c, seed);
        },
      };
    }
  }
}

export const nova: Template<'nova'> = {
  id: 'nova',
  use: () => 'once',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const c = prm.c;
    const S = new Strip(2 * c + 16, 2 * c + 16, c + 8, c + 8, seedOf(key, u), opts, { orphans: true, glowFrom: 'hot' });
    const d = core(prm.core, c, S.rng, S.seed, motif);
    if (d.contrast && (prm.heavy || prm.core === 'sky')) S.add(33, (p) => d.contrast!(p), 'contrast');
    S.add(50, (p) => d.hero(p), d.heroKind);
    S.add(100, (p) => d.hold(p));
    for (let j = 0; j < 6; j++) S.add(67, (p, rnd) => d.tail(p, j, rnd));
    return S.done('once');
  },
};
