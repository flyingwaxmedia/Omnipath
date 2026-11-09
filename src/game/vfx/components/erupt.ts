// erupt: area eruption units the runtime scatters inside a nova (docs/VFX.md §5 and the nova-units spec). One-shots
// of 6-10 frames at 50-67 ms, anchored at their ground point (bottom centre). Scale s / m / l = 0.75 / 1 / 1.25.
// Matter units (rock / crystal / ice spikes, lava crust, debris) carry the #24180f outline.
import { mulberry32 } from '../../../core/rng';
import { IDX, type EruptParams, type Template, type UnitKind } from '../types';
import { crescentEraser } from '../dither';
import { ERASE, Painter, midpoint, step } from '../painter';
import { Strip, chip, glint, mkKey, outBack, plus, seedOf, type Rng, type TemplateOptions } from './kit';

const SCALE: Record<EruptParams['scale'], number> = { s: 0.75, m: 1, l: 1.25 };
/** Base cell (w, h) at scale m. */
const SIZE: Record<UnitKind, [number, number]> = {
  'flame-column': [16, 32],
  'lava-geyser': [18, 30],
  'rock-spike': [14, 26],
  'crystal-spike': [14, 26],
  'ice-spike': [12, 24],
  'splash-crown': [24, 18],
  'gust-swirl': [24, 18],
  'sky-bolt': [24, 190],
  'light-pillar': [18, 120],
  tendril: [12, 28],
  'moon-mote': [14, 16],
  'star-shard': [10, 20],
  'spore-puff': [16, 16],
  'smoke-sheet': [32, 12],
  debris: [20, 20],
  'ki-ripple': [26, 14],
};
const MATTER: ReadonlySet<UnitKind> = new Set<UnitKind>(['lava-geyser', 'rock-spike', 'crystal-spike', 'ice-spike', 'debris']);

function keyOf(p: EruptParams, _motif: unknown, opts: TemplateOptions): string {
  return mkKey('erupt', { unit: p.unit, scale: p.scale }, null, opts);
}

/** Flame tongue rising from (x0, y0): S-sway, bright base, cool tip (fire language). */
export function tongue(p: Painter, h: number, w: number, phase: number, cool = 0, x0 = 0, y0 = 0): void {
  if (h < 1) return;
  p.fill(x0 - w - 3, y0 - h - 1, x0 + w + 3, y0 + 1, (gx, gy) => {
    const lx = gx - x0,
      ly = gy - y0;
    const t = -ly / h;
    if (t < -0.05 || t > 1) return 0;
    const half = w * (1 - t) ** 0.6 * (t < 0.12 ? 0.75 + t * 2 : 1);
    const cx = Math.round(1.6 * Math.sin(phase + t * 4) * t);
    const dx = Math.abs(lx - cx);
    if (dx > half + 0.3) return 0;
    let i: number = t < 0.35 ? (dx < half * 0.45 ? IDX.R5 : IDX.R4) : t < 0.7 ? (dx < half * 0.4 ? IDX.R4 : IDX.R3) : IDX.R2;
    i = Math.max(IDX.R1, i - cool);
    return i;
  });
}

/** Faceted spike: lit left face, dark right face, ridge line. */
export function facetSpike(p: Painter, h: number, bw: number, lean: number, facets: boolean): void {
  if (h < 1) return;
  const pts = facets ? [-bw / 2, 0, bw / 2, 0, bw / 2 + lean * 0.6, -h * 0.68, lean, -h, -bw / 2 + lean * 0.6, -h * 0.68] : [-bw / 2, 0, bw / 2, 0, lean, -h];
  p.poly(pts, (lx, ly) => {
    const ridge = (lean * -ly) / h;
    if (Math.abs(lx - ridge) < 0.5) return IDX.R3;
    return lx < ridge ? IDX.R4 : IDX.R2;
  });
}

/**
 * A rock spike: a broken, notched silhouette (never a clean cone) in the basalt secondary ramp, lit face S3, ridge S2,
 * shadow face S1, one darker stratum line and an ochre (R3/R4) catch-light on the lit edge near the tip.
 */
export function rockSpike(p: Painter, h: number, bw: number, lean: number, notch: number): void {
  if (h < 1) return;
  const pts = [-bw / 2, 0, -bw * 0.42, -h * (0.3 + notch * 0.1), -bw * 0.3 + lean * 0.4, -h * 0.42, -bw * 0.12 + lean * 0.8, -h * 0.82, lean, -h, bw * 0.22 + lean * 0.6, -h * 0.6, bw * 0.34 + lean * 0.4, -h * (0.5 - notch * 0.08), bw * 0.3 + lean * 0.3, -h * 0.38, bw / 2, 0];
  const stratum = -h * (0.28 + notch * 0.12);
  p.poly(pts, (lx, ly) => {
    const ridge = (lean * -ly) / h + bw * 0.05;
    if (Math.abs(ly - stratum - (lx - ridge) * 0.25) < 0.5) return IDX.S0;
    if (Math.abs(lx - ridge) < 0.5) return IDX.S2;
    if (lx < ridge) return ly < -h * 0.72 && lx > ridge - 2.5 ? IDX.R4 : lx < ridge - bw * 0.3 && ly < -h * 0.35 ? IDX.R3 : IDX.S3;
    return IDX.S1;
  });
}

/** #24180f outline on every frame drawn so far (matter units). */
function outlineAll(S: Strip): void {
  for (const f of S.frames) new Painter(f.w, f.h, f.ox, f.oy, S.bx, S.by, f).outline();
}

function unitFrames(S: Strip, unit: UnitKind, k: number, H: number): void {
  const rnd: Rng = S.rng;
  const add = (ms: number, draw: (p: Painter, r: Rng) => void, kind: 'normal' | 'hero' | 'contrast' = 'normal') => S.add(ms, draw, kind);
  switch (unit) {
    case 'flame-column': {
      const fh = H - 4,
        fw = 4.5 * k;
      const ph = rnd() * 6;
      const embers = Array.from({ length: 4 }, () => ({ x: (rnd() - 0.5) * fw * 2, y: -fh * (0.5 + rnd() * 0.4) }));
      const heights = [0.3, 0.65, 1, 1.05, 0.95];
      heights.forEach((t, f) => add(f < 4 ? 50 : 67, (p) => tongue(p, fh * t, fw * (f === 3 ? 1.2 : 1), ph + f * 1.3)));
      for (let f = 0; f < 4; f++)
        add(67, (p) => {
          tongue(p, fh * (0.5 - f * 0.12), fw * (0.9 - f * 0.12), ph + (5 + f) * 1.3, f);
          for (const e of embers) {
            const y = e.y - f * 3 * k;
            p.dot(e.x, y, f < 2 ? IDX.R4 : IDX.R3);
            p.dot(e.x, y + 1, IDX.R2);
          }
          if (f >= 1) {
            const sr = (2 + f) * k;
            const sy = -fh * 0.8 - f * 2 * k;
            p.disc(0, sy, sr, f < 3 ? IDX.S2 : IDX.S1);
            p.disc(-sr * 0.3, sy - sr * 0.3, sr * 0.5, IDX.S3);
            if (f === 3) {
              const e = crescentEraser(0, sy, sr, 2, 3);
              p.disc(e.x, e.y, e.r, ERASE);
            }
          }
        });
      break;
    }
    case 'lava-geyser': {
      const jh = H - 6;
      const chunks = [-1, 1].map((s) => ({ s, v: 0.8 + rnd() * 0.4 }));
      const mound = (p: Painter) => {
        p.ellipse(0, -1, 5 * k, 2.5 * k, IDX.S1);
        p.dot(-1, -2, IDX.R4);
        p.dot(1, -1, IDX.R4);
      };
      const jet = (p: Painter, h: number, wd: number) => {
        if (h <= 0) return;
        p.fill(-wd - 1, -h - 1, wd + 1, 0, (lx, ly) => {
          const t = -ly / h;
          if (t < 0 || t > 1) return 0;
          const half = wd * (t > 0.85 ? 1.3 : 1);
          if (Math.abs(lx) > half) return 0;
          return Math.abs(lx) < half * 0.4 ? IDX.R5 : IDX.R4;
        });
      };
      const chunk = (p: Painter, f: number) => {
        for (const c of chunks) {
          const t = f * 0.35 * c.v;
          const x = c.s * t * 9 * k,
            y = -jh + t * (-10 * k) + t * t * 14 * k;
          p.fill(x - 1.5, y - 1, x + 1.5, y + 1.5, () => IDX.S2);
        }
      };
      add(50, (p) => mound(p));
      add(50, (p) => {
        jet(p, jh * 0.4, 1.8 * k);
        mound(p);
      });
      add(50, (p) => {
        jet(p, jh * 0.9, 2 * k);
        mound(p);
      });
      add(67, (p) => {
        jet(p, jh, 2 * k);
        mound(p);
        chunk(p, 0);
      });
      add(67, (p) => {
        jet(p, jh * 0.55, 1.6 * k);
        mound(p);
        chunk(p, 1);
      });
      add(67, (p) => {
        jet(p, jh * 0.2, 1.4 * k);
        p.ellipse(0, -1, 6 * k, 2.5 * k, IDX.R4);
        chunk(p, 2);
      });
      add(67, (p) => p.ellipse(0, -1, 6 * k, 2.5 * k, (lx) => (Math.abs(lx) < 3 * k ? IDX.R3 : IDX.S1)));
      add(67, (p) => p.ellipse(0, -1, 6 * k, 2.5 * k, IDX.S1, 0.5));
      outlineAll(S);
      break;
    }
    case 'rock-spike':
    case 'crystal-spike':
    case 'ice-spike': {
      const facets = unit !== 'rock-spike';
      const notch = rnd();
      const spike = (p: Painter, h: number, w: number, l: number, f: boolean) => (unit === 'rock-spike' ? rockSpike(p, h, w * 1.15, l, notch) : facetSpike(p, h, w, l, f));
      const sh = H - 4,
        bw = (unit === 'ice-spike' ? 6 : 8) * k;
      const lean = (rnd() - 0.5) * 3 * k;
      const crack = midpoint(-6 * k, -1, 6 * k, -1, 0.15, mulberry32(S.seed), 2);
      const pieces = Array.from({ length: 5 }, () => ({ x: (rnd() - 0.5) * bw, y: -sh * (0.2 + rnd() * 0.6), vx: (rnd() - 0.5) * 3 }));
      const dust = (p: Painter, f: number) => {
        p.disc(-5 * k - f, -2, (2 + f) * k, IDX.S1, f > 1 ? 0.5 : 1);
        p.disc(5 * k + f, -2, (2 + f) * k, IDX.S2, f > 1 ? 0.5 : 1);
      };
      const glintAt = (p: Painter, f: number) => {
        if (unit !== 'rock-spike') glint(p, lean * 0.3, -sh * (0.35 + 0.2 * f), 1, IDX.R5, IDX.R4);
      };
      add(50, (p) => {
        p.polyline(crack, IDX.R1);
        dust(p, 0);
      });
      add(50, (p) => {
        spike(p, sh * 0.6 * outBack(0.7) * 1.15, bw, lean * 0.6, facets);
        dust(p, 1);
      });
      for (let f = 0; f < 3; f++)
        add(67, (p) => {
          spike(p, sh, bw, lean, facets);
          glintAt(p, f);
          if (f === 0) dust(p, 2);
        });
      for (let f = 0; f < 3; f++)
        add(67, (p) => {
          if (f === 0) spike(p, sh * 0.45, bw, lean * 0.45, facets);
          for (const c of pieces) {
            const x = c.x + c.vx * (f + 1),
              y = Math.min(-1, c.y + (f + 1) * (f + 1) * 2.2 * k);
            if (unit === 'rock-spike') chip(p, x, y, IDX.R2);
            else {
              p.dot(x, y, IDX.R4);
              p.dot(x, y - 1, IDX.R5);
              p.dot(x + 1, y, IDX.R2);
            }
          }
        });
      outlineAll(S);
      break;
    }
    case 'splash-crown': {
      const n = 7;
      const drops = Array.from({ length: n }, (_, i) => ({ a: (i / n) * Math.PI * 2, h: (5 + rnd() * 3) * k }));
      const crown = (p: Painter, f: number) => {
        for (const d of drops) {
          const rx = (4 + f * 1.4) * k;
          const x = Math.cos(d.a) * rx,
            base = Math.sin(d.a) * rx * 0.4;
          const y = base - Math.sin((Math.PI * Math.min(4, f)) / 4) * d.h;
          p.dot(x, y, f < 3 ? IDX.R5 : IDX.R4);
          p.dot(x, y + 1, IDX.R3);
        }
      };
      add(50, (p) => p.band(0, -1, 4 * k, 1.8 * k, 1, IDX.R4));
      for (let f = 1; f < 5; f++)
        add(f < 2 ? 50 : 67, (p) => {
          crown(p, f);
          p.band(0, -1, (4 + f * 1.5) * k, (1.8 + f * 0.6) * k, 1, f < 3 ? IDX.R4 : IDX.R3);
        });
      add(67, (p) => p.band(0, -1, 11 * k, 4.5 * k, 1, IDX.R2, 0.5));
      break;
    }
    case 'gust-swirl': {
      const leaves = [0, Math.PI];
      for (let f = 0; f < 6; f++)
        add(f < 2 ? 50 : 67, (p) => {
          for (let j = 0; j < 3; j++) {
            const rx = (9 - j * 2) * k,
              ry = (3.5 - j * 0.6) * k;
            const a0 = f * 60 + j * 120;
            const ink = f + j < 3 ? IDX.R4 : f + j < 5 ? IDX.R3 : IDX.R2;
            p.band(0, -3 - j * 4 * k, rx, ry, 1, ink, 1, [a0, a0 + 130]);
          }
          for (const l of leaves) {
            const a = l + f * 1.1;
            p.dot(Math.cos(a) * 8 * k, -6 * k + Math.sin(a) * 3 * k - f, IDX.S3);
            p.dot(Math.cos(a) * 8 * k + 1, -6 * k + Math.sin(a) * 3 * k - f, IDX.S2);
          }
        });
      break;
    }
    case 'sky-bolt': {
      const top = -(H - 4);
      const x0 = (rnd() - 0.5) * 8 * k;
      const leader = midpoint(x0, top, 0, 0, 0.06, mulberry32(S.seed), 3);
      const second = midpoint(x0 * 0.5, top, 0, 0, 0.07, mulberry32(S.seed ^ 0x77), 3);
      const fork = (() => {
        const j = Math.floor(leader.length / 4) * 2;
        return midpoint(leader[j], leader[j + 1], leader[j] + 9 * k, leader[j + 1] + 22 * k, 0.2, mulberry32(S.seed ^ 3), 3);
      })();
      const stampPath = (p: Painter, pts: number[], r: number, ink: number) => {
        for (let s = 0; s < pts.length / 2; s++) p.stamp(pts[s * 2], pts[s * 2 + 1], r, ink, 1, true);
      };
      add(33, (p) => p.polyline(leader, IDX.R0), 'contrast');
      add(33, (p) => {
        stampPath(p, leader, 2, IDX.R3);
        stampPath(p, fork, 1, IDX.R3);
        stampPath(p, leader, 1, IDX.WHITE);
        p.polyline(fork, IDX.R5);
        p.glowAt(0, -2, 8, 3);
      }, 'hero');
      S.blank(33);
      add(50, (p) => {
        stampPath(p, second, 1, IDX.R4);
        p.polyline(second, IDX.R5);
      });
      add(50, (p) => {
        p.polyline(second, IDX.R2);
        p.band(0, -1, 9 * k, 3 * k, 1, IDX.R4, 1, [150, 390]);
      });
      add(50, (p, r) => {
        for (let j = 0; j < 3; j++) {
          const s = Math.floor(r() * (second.length / 2 - 2)) * 2;
          p.line(second[s], second[s + 1], second[s + 2], second[s + 3], IDX.R3);
        }
        p.band(0, -1, 11 * k, 4 * k, 1, IDX.R2, 0.5, [150, 390]);
      });
      break;
    }
    case 'light-pillar': {
      const ph = H - 2;
      const col = (p: Painter, w: number, core: number, body: number, rim: number) =>
        p.fill(-w / 2 - 1, -ph, w / 2 + 1, 0, (lx, ly, fx, fy) => {
          const t = -ly / ph;
          if (t < 0 || t > 1 || Math.abs(lx) > w / 2) return 0;
          if (t > 0.8 && !p.pass(fx, fy, (1 - t) / 0.2)) return 0;
          const q = Math.abs(lx) / Math.max(0.5, w / 2);
          return q < 0.35 ? core : q < 0.75 ? body : rim;
        });
      const sparkles = Array.from({ length: 3 }, () => ({ x: (rnd() - 0.5) * 14 * k, y: -rnd() * 10 * k }));
      add(33, (p) => col(p, 1, IDX.R4, IDX.R4, IDX.R4));
      add(33, (p) => {
        col(p, 5 * k, IDX.WHITE, IDX.WHITE, IDX.R5);
        p.glowAt(0, -4, 6 * k, 3);
      }, 'hero');
      add(50, (p) => col(p, 14 * k * 1.12, IDX.R5, IDX.R4, IDX.R3));
      for (let f = 0; f < 2; f++)
        add(f ? 50 : 100, (p) => {
          col(p, 12 * k, IDX.R5, IDX.R4, IDX.R3);
          p.ellipse(0, 0, 7 * k, 2.5 * k, IDX.R4, 0.5);
          for (const s of sparkles) plus(p, s.x, s.y - f * 3, IDX.R5, IDX.R4);
        });
      add(67, (p) => col(p, 5 * k, IDX.R5, IDX.R4, IDX.R3));
      add(67, (p) => col(p, 1, IDX.R4, IDX.R4, IDX.R4));
      add(67, (p) => col(p, 1, IDX.R3, IDX.R3, IDX.R3));
      break;
    }
    case 'tendril': {
      const th = H - 3;
      const ph = rnd() * 6;
      const heights = [0.3, 0.7, 1, 1, 0.75, 0.4];
      heights.forEach((t, f) =>
        add(f < 2 ? 50 : 67, (p) => {
          const h = th * t;
          p.fill(-6 * k, -h - 1, 6 * k, 0, (lx, ly) => {
            const s = -ly / h;
            if (s < 0 || s > 1) return 0;
            const cx = Math.sin(ph + f * 0.5 + s * Math.PI * 1.2) * 3 * k * s;
            const half = 2.2 * k * (1 - s) + 0.6;
            const dx = lx - cx;
            if (Math.abs(dx) > half) return 0;
            return dx < -half + 1 ? IDX.R4 : dx < -half + 2 ? IDX.R3 : s > 0.8 ? IDX.R1 : IDX.R0;
          });
        }),
      );
      break;
    }
    case 'moon-mote': {
      const cy = -7 * k;
      const steps: [number, number, number][] = [
        [2, 1, 50],
        [4, 1, 50],
        [4, 1, 67],
        [4, 1, 67],
        [4, 0.5, 67],
        [3, 0.25, 67],
      ];
      steps.forEach(([r, a, ms], f) =>
        add(ms, (p) => {
          p.crescent(0, cy, r * k, 1.6 * k, -1.2 * k, r * k * 0.85, (lx, ly) => (Math.hypot(lx, ly - cy) > r * k - 1 ? IDX.R5 : IDX.R4), a);
          if (f === 2 || f === 3) glint(p, -r * k * 0.7, cy - r * k * 0.7, f === 2 ? 2 : 1, IDX.ACCENT, IDX.R4);
        }),
      );
      break;
    }
    case 'star-shard': {
      const top = -(H - 4);
      for (let f = 0; f < 4; f++)
        add(50, (p) => {
          const y = top + ((f + 1) / 4) * (H - 9);
          p.line(0, y - 5 * k, 0, y - 2, IDX.R3);
          p.poly([0, y - 2.5, 1.5, y, 0, y + 2.5, -1.5, y], IDX.R5);
          p.dot(0, y, IDX.R4);
        });
      add(50, (p) => glint(p, 0, -2, 2, IDX.R5, IDX.R4));
      add(50, (p) => {
        p.dot(-2, -1, IDX.R3);
        p.dot(2, -2, IDX.R3);
        p.dot(0, -4, IDX.R2);
      });
      break;
    }
    case 'spore-puff': {
      const cy = -6 * k;
      const rs = [2, 4, 5, 6, 6, 6];
      rs.forEach((r, f) =>
        add(67, (p) => {
          p.disc(0, cy, r * k, IDX.R3);
          p.disc(-r * k * 0.3, cy - r * k * 0.3, r * k * 0.45, IDX.R4);
          p.outline(IDX.ACCENT, (v) => v !== 0 && v !== IDX.ACCENT);
          if (f === 2) p.ring(r * k * 0.5, cy - r * k, 1.5, 1, IDX.R4);
          if (f === 3) for (const [dx, dy] of [[0, -3], [3, 0], [-3, 0]]) p.dot(r * k * 0.5 + dx, cy - r * k + dy, IDX.R4);
          if (f >= 4) p.erode(f === 4 ? 0.5 : 0.75, 'bayer', S.seed);
        }),
      );
      break;
    }
    case 'smoke-sheet': {
      // A low cumulus bank: round lobes of alternating height on a flat base, lit caps on the top-left, a shadowed
      // base row; it widens, cools and dissolves.
      const lobes = Array.from({ length: 5 }, (_, i) => ({ x: (-12 + i * 6) * k, y: -(3.5 + (i % 2) * 2 + rnd() * 1.5) * k, r: (4 + rnd() * 1.5) * k }));
      for (let f = 0; f < 8; f++)
        add(83, (p) => {
          const g = 0.85 + f * 0.05;
          const ink = step(IDX.R3, -Math.floor(f / 2));
          const drift = f % 2 ? 1 : 0;
          p.fill(-22 * k, -14 * k, 22 * k, 1, (lx, ly) => {
            if (ly > 0) return 0;
            let hit = -1;
            for (let q = 0; q < lobes.length; q++) if (Math.hypot((lx - lobes[q].x * g - drift) / g, ly - lobes[q].y) <= lobes[q].r * g + 0.35) hit = q;
            if (hit < 0) return 0;
            const l = lobes[hit];
            if (ly > -1.5 * k) return step(ink, -1);
            if (f < 5 && Math.hypot(lx - (l.x * g + drift - 0.3 * l.r), ly - (l.y - 0.4 * l.r)) < l.r * 0.45) return step(ink, 1);
            return ink;
          });
          if (f >= 5) p.erode((f - 4) / 4, 'bayer', S.seed);
        });
      break;
    }
    case 'debris': {
      const chunks = Array.from({ length: 3 }, (_, i) => ({ vx: (i - 1) * 2.4 * k + (rnd() - 0.5), vy: -(5 + rnd() * 3) * k }));
      for (let f = 0; f < 6; f++)
        add(f < 2 ? 50 : 67, (p) => {
          if (f < 3) {
            p.disc(-3 * k, -2, (2 + f) * k, IDX.S1, f ? 0.5 : 1);
            p.disc(3 * k, -2, (2 + f) * k, IDX.S2, f ? 0.5 : 1);
          }
          for (const c of chunks) {
            const t = f + 1;
            const x = c.vx * t,
              y = Math.min(-2, c.vy * t + 1.1 * k * t * t);
            p.fill(x - 1.5, y - 1.5, x + 1.5, y + 1.5, (lx, ly) => (lx - x + ly - y < 0 ? IDX.R3 : IDX.R2));
          }
          p.outline();
        });
      break;
    }
    case 'ki-ripple': {
      for (let f = 0; f < 6; f++)
        add(f < 2 ? 50 : 67, (p) => {
          const rx = (3 + f * 1.7) * k;
          const ink = f < 2 ? IDX.R4 : f < 4 ? IDX.R3 : IDX.R2;
          p.band(0, -2, rx, rx * 0.45, 1, ink);
          if (rx > 4) p.band(0, -2, rx - 3, (rx - 3) * 0.45, 1, step(ink, -1));
        });
      break;
    }
  }
}

export const erupt: Template<'erupt'> = {
  id: 'erupt',
  use: () => 'once',
  dirs: () => 1,
  key: keyOf,
  frames(prm, motif, u, opts) {
    const key = keyOf(prm, motif, opts);
    const k = SCALE[prm.scale];
    const [bw, bh] = SIZE[prm.unit];
    const W = Math.ceil(bw * k) + 4,
      H = Math.ceil(bh * k) + 4;
    const S = new Strip(W, H, Math.floor(W / 2), H - 3, seedOf(key, u), opts, { matter: MATTER.has(prm.unit), orphans: true, glowFrom: 'hot' });
    unitFrames(S, prm.unit, k, H);
    return S.done('once');
  },
};
