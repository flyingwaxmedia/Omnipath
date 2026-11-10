import type Phaser from 'phaser';
import { parseVariantId } from '../../core/compose';
import type { Registry } from '../../core/registry';
import type { ClassDef, ElementId, EssenceCategory, EssenceDef, ItemDef, SkillDef, WeaponType } from '../../core/types';
import { mix } from './common';
import { PAL, artRng, keySeed, pixelTex, px, rect, textureDataUrl, type Ctx } from './pixel';

// Procedural pixel icons (docs/ART-DIRECTION.md §6). Every icon is 32x32, painted on integer pixels with flat
// colours, lit from the top-left and rimmed by a 1 px PAL.outline. Texture keys:
//   icon_skill_<id>   framed tile: element-tinted backdrop, shape motif (arc / whirl / thrown object / streak /
//                     burst / chain / aura), object or weapon, tier rim (wood → bronze → bright bronze → gold + gems)
//   icon_el_<id>      element glyph            icon_mod_<id>   essence rune-stone (hexagon, category colour)
//   icon_item_<id>    item sprite              icon_cls_<id>   class crest (shield shaped by tier)
//   icon_pip_el_<id>, icon_pip_mod_<id>        12x12 pips (skill-bar element pip, variant badges)
//   icon_<kind>_generic                        fallbacks
// Generated skill ids (`base@el~mod`, `fuse:a|b…`) are drawn lazily by iconKey()/iconUrl() from the composed
// SkillDef (so an infused variant really takes its element's colours) plus small element / essence / merge badges.

export type IconKind = 'skill' | 'el' | 'mod' | 'item' | 'cls' | 'passive';
export const ICON_SIZE = 32;
export const PIP_SIZE = 12;

type Ramp = readonly string[];
const OUT = PAL.outline;
const PI = Math.PI;
const DEG = PI / 180;

// ------------------------------------------------------------------ palettes (6 tones, dark → light)

export const ELEMENT_RAMPS: Readonly<Record<ElementId, Ramp>> = {
  fire: ['#3a1410', '#7a2216', '#c4421c', '#ec7a26', '#fbbf45', '#fff0a6'],
  water: ['#132a48', '#1f4a78', '#2f6fa3', '#4a92c4', '#8cc6e6', '#e2f4fa'],
  earth: ['#2e1f12', '#53391f', '#7d5a32', '#a8814a', '#cfae72', '#efdcae'],
  wind: ['#173a30', '#25604a', '#3e8a68', '#62b48a', '#a2dcb4', '#e4fbea'],
  lightning: ['#3a2c0c', '#6e5412', '#b08a1a', '#e2bc2c', '#f8e264', '#fffbd8'],
  shadow: ['#150d22', '#2a1a44', '#432c6e', '#664a9e', '#9478cc', '#cfbaf6'],
  holy: ['#4a3a18', '#80662c', '#bc9a44', '#e6c86a', '#faeaa8', '#fffdf0'],
  ice: ['#173650', '#275e80', '#4a90b8', '#7cc2e2', '#bce6f6', '#f6fdff'],
  magma: ['#1e0a08', '#4a160c', '#94280e', '#dc4c16', '#ff962a', '#ffe27a'],
  storm: ['#141c34', '#24345e', '#3e5892', '#6a8cc8', '#a6c4ee', '#eef6ff'],
  twilight: ['#1e1032', '#3c2262', '#664294', '#9c66bc', '#d896d2', '#ffe2f2'],
};

const R = {
  steel: ['#22252d', '#3c414c', '#5e6572', '#8b93a0', '#c3cad3', '#f4f7fa'],
  arcane: ['#14163e', '#232a6e', '#3546a6', '#4f74d8', '#8eb2fa', '#e4eeff'],
  venom: ['#16260e', '#28461a', '#457428', '#6aa236', '#a6d45a', '#e8f8b4'],
  dusk: ['#171222', '#2a2238', '#443a58', '#665a80', '#9a8cb4', '#d6ccec'],
  spirit: ['#173434', '#245252', '#3a7a74', '#5aa898', '#98d8c0', '#e6fbf0'],
  gold: ['#4a3010', '#7a5420', '#b0803a', '#d8a848', '#e9c46a', '#fff1c0'],
  wood: ['#2a1a0e', '#3d2817', '#5c3d22', '#7d5530', '#9c6d3e', '#c09060'],
  blood: ['#2e0a0e', '#5a141a', '#8e2028', '#b8323a', '#e0626a', '#ffb0b0'],
  bone: ['#3a3226', '#6e6450', '#a09478', '#cfc4a6', '#ebe2c8', '#faf6e8'],
  stone: ['#26272c', '#3a3c44', '#4a4d55', '#666a73', '#878b93', '#c4c8cc'],
  leaf: ['#1f3519', '#2b4a22', '#3d6630', '#548540', '#74a655', '#a8d070'],
  rose: ['#3a1420', '#5a2030', '#94404e', '#c05a6a', '#e0788a', '#f8c0c8'],
  iron: ['#1c1d22', '#2e3038', '#464a55', '#666b77', '#9298a4', '#d0d4dc'],
  violet: ['#1e1636', '#2a1c4a', '#4a3480', '#6a4ea8', '#8a6cc0', '#d4c4f4'],
  teal: ['#0e2026', '#16323a', '#21505a', '#2e7280', '#5aa8b4', '#b0e6ec'],
  cream: ['#5a4a32', '#8a7a5a', '#b8a684', '#d6c8a4', '#efe6c8', '#fffaf0'],
} as const satisfies Record<string, Ramp>;

const LEATHER: Ramp = ['#3a2414', '#5a3a1e', '#8a5e34', '#b8844a', '#d8a868', '#f0d098'];

/** Backdrop ramps (4 tones edge → centre glow) for skill tiles whose colour is not an element's. */
const BG = {
  steel: ['#11171c', '#1a262c', '#22363e', '#2c4850'],
  arcane: ['#0e0f2a', '#161a46', '#202862', '#2c387e'],
  venom: ['#0e170a', '#172812', '#22381a', '#2e4c22'],
  dusk: ['#100c18', '#1a1426', '#261e36', '#342a48'],
  spirit: ['#0c1c1c', '#132a2a', '#1c3c3a', '#26504c'],
} as const;

const TIER_RIM = [
  { hi: '#8c6e4c', lo: '#4a3220' },
  { hi: '#c8924a', lo: '#6e4a26' },
  { hi: '#e9c46a', lo: '#8a5e2a' },
  { hi: '#fff1c0', lo: '#b0803a' },
] as const;

const ESSENCE_RAMPS: Readonly<Record<EssenceCategory, Ramp>> = {
  multiply: ['#3a2208', '#6e420e', '#b07018', '#e0a030', '#fbd46a', '#fff4c8'],
  propagate: ['#0c2a2c', '#145052', '#1f7e7c', '#34b0a4', '#7ee0cc', '#e0fff6'],
  repeat: ['#22123a', '#3e2068', '#64389e', '#8e5ccc', '#c09cf0', '#f0e4ff'],
  area: ['#14280e', '#244a18', '#3a7424', '#5ea038', '#9cd062', '#e8fbc4'],
  tempo: ['#0e2238', '#18406a', '#2866a0', '#4a92d0', '#94c8f4', '#eaf6ff'],
  sustain: ['#2e0a12', '#5a1420', '#902432', '#c43c48', '#ec7a80', '#ffd0d0'],
};

// ------------------------------------------------------------------ painter kit

type Scratch = { el: HTMLCanvasElement; c: Ctx };
const POOL = new Map<string, Scratch[]>();

/** Borrows a cleared, CPU-backed scratch canvas (layers are read back for outlines; avoid GPU readbacks). */
function scratch(w: number, h: number): Scratch {
  const free = POOL.get(`${w}x${h}`);
  const hit = free?.pop();
  if (hit) {
    hit.c.clearRect(0, 0, w, h);
    return hit;
  }
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const c = el.getContext('2d', { willReadFrequently: true })!;
  c.imageSmoothingEnabled = false;
  return { el, c };
}

/** Returns a scratch canvas to the pool. */
function release(s: Scratch): void {
  const k = `${s.el.width}x${s.el.height}`;
  const list = POOL.get(k) ?? [];
  if (list.length < 8) list.push(s);
  POOL.set(k, list);
}

/** 1 px outline on transparent 4-neighbours of opaque pixels (fast ImageData version of pixel.ts outline). */
function outlineFast(c: Ctx, w: number, h: number, color: string = OUT): void {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const n = parseInt(color.slice(1), 16);
  const solid = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) solid[i] = d[i * 4 + 3] >= 128 ? 1 : 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (solid[i]) continue;
      if ((x > 0 && solid[i - 1]) || (x < w - 1 && solid[i + 1]) || (y > 0 && solid[i - w]) || (y < h - 1 && solid[i + w])) {
        d[i * 4] = (n >> 16) & 255;
        d[i * 4 + 1] = (n >> 8) & 255;
        d[i * 4 + 2] = n & 255;
        d[i * 4 + 3] = 255;
      }
    }
  c.putImageData(img, 0, 0);
}

type Painter = (x: number, y: number) => string | null | undefined | false;

/** Calls `fn` with each pixel centre in the box; paints the returned colour (same-colour runs batched). */
function paint(c: Ctx, x0: number, y0: number, x1: number, y1: number, fn: Painter): void {
  const xa = Math.max(0, Math.floor(x0));
  const xb = Math.min(c.canvas.width, Math.ceil(x1));
  const ya = Math.max(0, Math.floor(y0));
  const yb = Math.min(c.canvas.height, Math.ceil(y1));
  let last = '';
  for (let y = ya; y < yb; y++) {
    let runCol = '';
    let runX = 0;
    for (let x = xa; x <= xb; x++) {
      const col = x < xb ? fn(x + 0.5, y + 0.5) || '' : '';
      if (col === runCol) continue;
      if (runCol) {
        if (runCol !== last) {
          c.fillStyle = runCol;
          last = runCol;
        }
        c.fillRect(runX, y, x - runX, 1);
      }
      runCol = col;
      runX = x;
    }
  }
}

/** Checkerboard parity of a pixel centre (for dithered fades). */
const chk = (x: number, y: number): number => (Math.floor(x) + Math.floor(y)) & 1;

/** +1 / -1: which side (sign of the normal offset) of an axis at `ang` faces the top-left light. */
function litSign(ang: number): number {
  const v = Math.sin(ang) - Math.cos(ang);
  return v >= 0 ? 1 : -1;
}

type AlongCol = (s: number, t: number, h: number, x: number, y: number) => string | null | undefined | false;

/**
 * Oriented shape: pixels whose centre lies at distance s ∈ [s0, s1] along the axis through (ox, oy) at `ang`
 * and |t| ≤ half(s) across it.
 */
function along(c: Ctx, ox: number, oy: number, ang: number, s0: number, s1: number, half: (s: number) => number, col: AlongCol): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const r = Math.max(Math.abs(s0), Math.abs(s1)) + 5;
  paint(c, ox - r, oy - r, ox + r, oy + r, (x, y) => {
    const dx = x - ox;
    const dy = y - oy;
    const s = dx * ca + dy * sa;
    if (s < s0 || s > s1) return null;
    const t = -dx * sa + dy * ca;
    const h = half(s);
    if (h <= 0 || Math.abs(t) > h) return null;
    return col(s, t, h, x, y);
  });
}

/** Three-band shading across an oriented shape: lit edge, body, shade edge. */
function shadeAcross(r: Ramp, ang: number, lit = 5, mid = 4, dark = 2): AlongCol {
  const ls = litSign(ang);
  return (_s, t, h) => {
    const u = (t * ls) / Math.max(h, 0.01);
    return u > 0.34 ? r[lit] : u < -0.34 ? r[dark] : r[mid];
  };
}

/** Pixel line with a colour per step (Bresenham). */
function seg(c: Ctx, x0: number, y0: number, x1: number, y1: number, col: string | ((i: number, n: number) => string | null)): void {
  let x = Math.round(x0);
  let y = Math.round(y0);
  const tx = Math.round(x1);
  const ty = Math.round(y1);
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  const n = Math.max(dx, -dy);
  let err = dx + dy;
  for (let i = 0; ; i++) {
    const k = typeof col === 'string' ? col : col(i, n);
    if (k) {
      c.fillStyle = k;
      c.fillRect(x, y, 1, 1);
    }
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/** Scanline polygon fill on pixel centres. */
function fpoly(c: Ctx, pts: readonly number[], color: string | Painter): void {
  const n = pts.length >> 1;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    y0 = Math.min(y0, pts[i * 2 + 1]);
    y1 = Math.max(y1, pts[i * 2 + 1]);
  }
  const xs: number[] = [];
  for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (let i = 0; i < n; i++) {
      const ax = pts[i * 2];
      const ay = pts[i * 2 + 1];
      const bx = pts[((i + 1) % n) * 2];
      const by = pts[((i + 1) % n) * 2 + 1];
      if ((ay <= sy && by > sy) || (by <= sy && ay > sy)) xs.push(ax + ((sy - ay) / (by - ay)) * (bx - ax));
    }
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const a = Math.round(xs[k]);
      const b = Math.round(xs[k + 1]);
      for (let x = a; x < b; x++) {
        const col = typeof color === 'string' ? color : color(x + 0.5, sy);
        if (col) {
          c.fillStyle = col;
          c.fillRect(x, y, 1, 1);
        }
      }
    }
  }
}

/** Shaded sphere, light from the top-left. */
function ball(c: Ctx, cx: number, cy: number, r: number, rp: Ramp, spec = true): void {
  paint(c, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > r) return null;
    const l = Math.hypot(x - (cx - r * 0.42), y - (cy - r * 0.42)) / (r * 1.65);
    if (spec && r >= 2.4 && l < 0.16) return rp[5];
    if (l < 0.42) return rp[4];
    if (l < 0.72) return rp[3];
    if (d > r - 1.1 && dx + dy > r * 0.3) return rp[1];
    return rp[2];
  });
}

/** Flat disc. */
function dot(c: Ctx, cx: number, cy: number, r: number, color: string): void {
  paint(c, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => (Math.hypot(x - cx, y - cy) <= r ? color : null));
}

/** Annulus (optionally only the angular span a0 → a0 + span, canvas angles). */
function ring(c: Ctx, cx: number, cy: number, r0: number, r1: number, color: string | ((a: number, d: number, x: number, y: number) => string | null), a0 = 0, span = 2 * PI): void {
  paint(c, cx - r1 - 1, cy - r1 - 1, cx + r1 + 1, cy + r1 + 1, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d < r0 || d > r1) return null;
    let a = Math.atan2(y - cy, x - cx) - a0;
    a = ((a % (2 * PI)) + 2 * PI) % (2 * PI);
    if (a > span) return null;
    return typeof color === 'string' ? color : color(a / span, (d - r0) / Math.max(0.01, r1 - r0), x, y);
  });
}

/**
 * Swoosh crescent: an arc band from angle a0 sweeping `span` (positive = clockwise on screen), thick in the
 * middle and tapering at both ends; the outer edge is brightest and the tail dithers out.
 */
function swoosh(c: Ctx, cx: number, cy: number, rOut: number, thick: number, a0: number, span: number, rp: Ramp, opts: { fade?: boolean; head?: number } = {}): void {
  const fade = opts.fade ?? true;
  const head = opts.head ?? 0.72;
  const R0 = rOut + 1;
  paint(c, cx - R0, cy - R0, cx + R0, cy + R0, (x, y) => {
    const dx = x - cx;
    const dy = y - cy;
    const d = Math.hypot(dx, dy);
    if (d > rOut) return null;
    let a = Math.atan2(dy, dx) - a0;
    if (span < 0) a = -a;
    a = ((a % (2 * PI)) + 2 * PI) % (2 * PI);
    const t = a / Math.abs(span);
    if (t > 1) return null;
    const prof = t < head ? Math.sin((t / head) * (PI / 2)) : Math.cos(((t - head) / (1 - head)) * (PI / 2));
    const th = thick * Math.pow(Math.max(0, prof), 0.75);
    if (d < rOut - th) return null;
    if (fade && t < 0.18 && chk(x, y)) return null;
    if (fade && t < 0.08) return null;
    const u = (rOut - d) / Math.max(th, 0.01);
    return u < 0.3 ? rp[5] : u < 0.6 ? rp[4] : u < 0.85 ? rp[3] : rp[2];
  });
}

/** Four-point sparkle. */
function star4(c: Ctx, x: number, y: number, len: number, rp: Ramp): void {
  const X = Math.round(x);
  const Y = Math.round(y);
  for (let i = 1; i <= len; i++) {
    const col = i === len ? rp[3] : rp[4];
    px(c, X + i, Y, col);
    px(c, X - i, Y, col);
    px(c, X, Y + i, col);
    px(c, X, Y - i, col);
  }
  if (len >= 3) {
    px(c, X + 1, Y + 1, rp[4]);
    px(c, X - 1, Y - 1, rp[4]);
    px(c, X + 1, Y - 1, rp[4]);
    px(c, X - 1, Y + 1, rp[4]);
  }
  px(c, X, Y, rp[5]);
}

/** Jagged energy bolt between two points (2 px body + 1 px core). */
function zap(c: Ctx, x0: number, y0: number, x1: number, y1: number, rp: Ramp, rng: () => number, segs = 4, amp = 2.4, wide = false): void {
  const pts: number[] = [x0, y0];
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  for (let i = 1; i < segs; i++) {
    const f = i / segs;
    const o = (i % 2 ? 1 : -1) * amp * (0.6 + rng() * 0.6);
    pts.push(x0 + dx * f + nx * o, y0 + dy * f + ny * o);
  }
  pts.push(x1, y1);
  const body: [number, number][] = wide ? [[-1, 0], [1, 0], [0, -1], [0, 1], [1, 1]] : [[1, 0], [0, 1]];
  for (let i = 0; i + 3 < pts.length; i += 2) for (const [ox, oy] of body) seg(c, pts[i] + ox, pts[i + 1] + oy, pts[i + 2] + ox, pts[i + 3] + oy, wide ? rp[3] : rp[3]);
  if (wide) for (let i = 0; i + 3 < pts.length; i += 2) seg(c, pts[i] + 1, pts[i + 1], pts[i + 2] + 1, pts[i + 3], rp[4]);
  for (let i = 0; i + 3 < pts.length; i += 2) seg(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], rp[5]);
}

/** Flame silhouette mask: round base at `by`, tip at by - h, tip leaning by `lean` px. */
function flameMask(cx: number, by: number, w: number, h: number, lean: number): (x: number, y: number) => boolean {
  return (x, y) => {
    const t = (by - y) / h;
    if (t < 0 || t > 1) return false;
    const prof = t < 0.32 ? Math.sqrt(Math.max(0, 1 - ((0.32 - t) / 0.32) ** 2)) : Math.pow(1 - (t - 0.32) / 0.68, 0.85);
    return Math.abs(x - (cx + lean * t * t)) <= (w / 2) * prof;
  };
}

/** Layered flame (outer → core). */
function flame(c: Ctx, cx: number, by: number, w: number, h: number, rp: Ramp, lean = 0): void {
  const m = [
    flameMask(cx, by, w, h, lean),
    flameMask(cx + w * 0.04, by - h * 0.03, w * 0.72, h * 0.78, lean * 0.75),
    flameMask(cx + w * 0.06, by - h * 0.05, w * 0.46, h * 0.52, lean * 0.5),
    flameMask(cx + w * 0.06, by - h * 0.07, w * 0.22, h * 0.28, lean * 0.3),
  ];
  const cols = [rp[2], rp[3], rp[4], rp[5]];
  paint(c, cx - w - 2, by - h - 2, cx + w + Math.abs(lean) + 2, by + 1, (x, y) => {
    for (let i = 3; i >= 0; i--) if (m[i](x, y)) return cols[i];
    return null;
  });
}

/** Droplet: round bottom (radius r) at by - r, tip at by - h. */
function droplet(c: Ctx, cx: number, by: number, r: number, h: number, rp: Ramp): void {
  const cy = by - r;
  paint(c, cx - r - 1, by - h - 1, cx + r + 1, by + 1, (x, y) => {
    let inside = Math.hypot(x - cx, y - cy) <= r;
    if (!inside && y < cy) {
      const t = (cy - y) / (h - r);
      inside = t <= 1 && Math.abs(x - cx) <= r * Math.pow(1 - t, 1.15);
    }
    if (!inside) return null;
    const l = Math.hypot(x - (cx - r * 0.4), y - (cy - r * 0.35)) / (r * 1.7);
    if (l < 0.2 && x < cx) return rp[5];
    if (l < 0.45) return rp[4];
    if (l < 0.75) return rp[3];
    return x > cx + r * 0.3 || y > cy + r * 0.5 ? rp[2] : rp[3];
  });
}

/** Crescent moon: disc minus an offset disc. */
function moon(c: Ctx, cx: number, cy: number, r: number, rp: Ramp, ox = 0.45, oy = -0.3): void {
  const bx = cx + r * ox;
  const by = cy + r * oy;
  paint(c, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r || Math.hypot(x - bx, y - by) < r * 0.85) return null;
    const l = Math.hypot(x - (cx - r * 0.5), y - (cy - r * 0.2)) / (r * 1.4);
    return l < 0.35 ? rp[5] : l < 0.62 ? rp[4] : d > r - 1.2 ? rp[2] : rp[3];
  });
}

/** Puffy cloud: overlapping discs, lit top, flat-ish shaded base. */
function cloud(c: Ctx, cx: number, cy: number, w: number, rp: Ramp): void {
  const blobs = [
    [cx - w * 0.3, cy + w * 0.06, w * 0.24],
    [cx + w * 0.02, cy - w * 0.1, w * 0.3],
    [cx + w * 0.3, cy + w * 0.05, w * 0.22],
    [cx, cy + w * 0.12, w * 0.24],
  ];
  paint(c, cx - w, cy - w, cx + w, cy + w, (x, y) => {
    let best = -1;
    for (const [bx, by, br] of blobs) {
      const d = Math.hypot(x - bx, y - by);
      if (d <= br) best = Math.max(best, 1 - d / br + (by - y) * 0.02);
    }
    if (best < 0) return null;
    if (y > cy + w * 0.22) return rp[1];
    const top = y < cy - w * 0.05;
    return top && best > 0.45 ? rp[5] : top ? rp[4] : best > 0.5 ? rp[3] : rp[2];
  });
}

/** Faceted rock: polygon with a lit top-left facet and a dark lower-right. */
function rock(c: Ctx, pts: readonly number[], rp: Ramp, cx: number, cy: number): void {
  fpoly(c, pts, (x, y) => {
    const u = (x - cx) + (y - cy);
    return u < -4 ? rp[4] : u < 1 ? rp[3] : u < 5 ? rp[2] : rp[1];
  });
}

/** Spikes rising from a ground line (earth eruption). */
function spike(c: Ctx, x: number, by: number, w: number, h: number, rp: Ramp): void {
  fpoly(c, [x - w / 2, by, x + w * 0.1, by - h, x + w / 2, by], (px0) => (px0 < x - w * 0.05 ? rp[4] : px0 < x + w * 0.2 ? rp[3] : rp[2]));
}

/** Draws on a fresh layer, outlines it and composites onto `dst`. */
function onLayer(dst: Ctx, draw: (c: Ctx) => void, outlineColor: string | false = OUT): void {
  const w = dst.canvas.width;
  const h = dst.canvas.height;
  const s = scratch(w, h);
  draw(s.c);
  if (outlineColor) outlineFast(s.c, w, h, outlineColor);
  dst.drawImage(s.el, 0, 0);
  release(s);
}

/** Flat afterimage of whatever `draw` paints, offset by (dx, dy), in one colour (parity < 0 = solid). */
function ghostOf(dst: Ctx, draw: (c: Ctx) => void, dx: number, dy: number, col: string, parity = -1): void {
  const w = dst.canvas.width;
  const h = dst.canvas.height;
  const s = scratch(w, h);
  draw(s.c);
  const d = s.c.getImageData(0, 0, w, h).data;
  dst.fillStyle = col;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (d[(y * w + x) * 4 + 3] > 128 && (parity < 0 || ((x + y) & 1) === parity)) dst.fillRect(Math.round(x + dx), Math.round(y + dy), 1, 1);
  release(s);
}

/** Paints a small bitmap ('#' = colour a, '+' = colour b, '*' = colour d, 'o' = outline). */
function bitmap(c: Ctx, x: number, y: number, rows: readonly string[], a: string, b = a, d = b): void {
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch === '#') px(c, x + i, y + j, a);
      else if (ch === '+') px(c, x + i, y + j, b);
      else if (ch === '*') px(c, x + i, y + j, d);
      else if (ch === 'o') px(c, x + i, y + j, OUT);
    }
  });
}

// ------------------------------------------------------------------ objects (weapons, projectiles, emblems)

/** Sword: guard at (x, y), blade toward `ang`. */
function swordAt(c: Ctx, x: number, y: number, ang: number, len: number, blade: Ramp = R.steel, hilt: Ramp = R.gold): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const bw = len >= 12 ? 1.4 : 1.1;
  along(c, x, y, ang, 0.6, len, (s) => (s > len - 3 ? Math.max(0.45, ((len - s) / 3) * bw) : bw), shadeAcross(blade, ang));
  along(c, x - ca * 0.5, y - sa * 0.5, ang, -4.5, -0.6, () => 0.8, (s) => (s < -3.6 ? hilt[4] : R.wood[3]));
  const gw = len >= 12 ? 3.6 : 2.6;
  along(c, x, y, ang + PI / 2, -gw, gw, () => 0.85, (s) => (Math.abs(s) > gw - 1 ? hilt[3] : hilt[4]));
}

/** Dagger: shorter, leaf-shaped blade with a small guard. */
function daggerAt(c: Ctx, x: number, y: number, ang: number, len: number, blade: Ramp = R.steel): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  along(c, x, y, ang, 0.6, len, (s) => {
    const f = s / len;
    return f < 0.55 ? 1.25 : Math.max(0.4, 1.25 * (1 - (f - 0.55) / 0.45));
  }, shadeAcross(blade, ang));
  along(c, x - ca * 0.5, y - sa * 0.5, ang, -3.5, -0.6, () => 0.75, () => R.wood[2]);
  along(c, x, y, ang + PI / 2, -2.2, 2.2, () => 0.8, () => R.gold[3]);
}

/** Staff: shaft from (x, y) along ang, crystal orb at the head. */
function staffAt(c: Ctx, x: number, y: number, ang: number, len: number, orb: Ramp): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  along(c, x, y, ang, 0, len - 2, () => 0.9, shadeAcross(R.wood, ang, 4, 3, 2));
  const hx = x + ca * len;
  const hy = y + sa * len;
  along(c, hx - ca * 2, hy - sa * 2, ang + PI / 2, -2.6, 2.6, () => 0.8, () => R.gold[3]);
  ball(c, hx + ca * 1.2, hy + sa * 1.2, len >= 14 ? 3.3 : 2.6, orb);
}

function axeAt(c: Ctx, x: number, y: number, ang: number, len: number): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  along(c, x, y, ang, -len / 2, len / 2, () => 0.85, shadeAcross(R.wood, ang, 4, 3, 2));
  const hx = x + ca * (len / 2 - 2.5);
  const hy = y + sa * (len / 2 - 2.5);
  along(c, hx, hy, ang - PI / 2, 0, len * 0.42, (s) => 1.6 + s * 0.55, (s, t, h) => (s > len * 0.42 - 1.2 ? R.steel[5] : Math.abs(t) > h - 0.8 ? R.steel[2] : R.steel[4]));
}

function hammerAt(c: Ctx, x: number, y: number, ang: number, len: number): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  along(c, x, y, ang, -len / 2, len / 2 - 1, () => 0.85, shadeAcross(R.wood, ang, 4, 3, 2));
  const hx = x + ca * (len / 2 - 1);
  const hy = y + sa * (len / 2 - 1);
  along(c, hx, hy, ang + PI / 2, -len * 0.32, len * 0.32, () => len * 0.17, shadeAcross(R.iron, ang + PI / 2, 5, 4, 2));
}

/** Thrown-object kinds for projectile motifs. */
type Obj =
  | 'sword'
  | 'knife'
  | 'blade'
  | 'axe'
  | 'hammer'
  | 'orb'
  | 'fireball'
  | 'missile'
  | 'lance'
  | 'shard'
  | 'crescent'
  | 'feather'
  | 'star'
  | 'prism'
  | 'bubble'
  | 'glob'
  | 'thorn'
  | 'nail'
  | 'wisp'
  | 'hook'
  | 'net'
  | 'web';

/** Draws a projectile object centred at (x, y) flying toward `ang`; `len` ~ its long side. */
function object(c: Ctx, kind: Obj, x: number, y: number, ang: number, len: number, fx: Ramp, rng: () => number): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  const back = (d: number): [number, number] => [x - ca * d, y - sa * d];
  switch (kind) {
    case 'sword': {
      const [gx, gy] = back(len * 0.4);
      swordAt(c, gx, gy, ang, len, fx === R.steel ? R.steel : bladeRamp(fx));
      break;
    }
    case 'knife': {
      const [gx, gy] = back(len * 0.35);
      daggerAt(c, gx, gy, ang, len * 0.8, fx === R.steel ? R.steel : bladeRamp(fx));
      break;
    }
    case 'axe':
      axeAt(c, x, y, ang, len);
      break;
    case 'hammer':
      hammerAt(c, x, y, ang, len);
      break;
    case 'orb': {
      const r = Math.max(2.2, len * 0.32);
      along(c, x, y, ang + PI, 0, len * 0.9, (s) => r * (1 - s / (len * 0.9)) * 0.9, (s, _t, _h, px0, py0) => (s > len * 0.45 && chk(px0, py0) ? null : s > len * 0.3 ? fx[3] : fx[4]));
      ball(c, x, y, r, fx);
      break;
    }
    case 'fireball': {
      const r = Math.max(2.2, len * 0.3);
      along(c, x, y, ang + PI, -r * 0.3, len, (s) => r * 1.05 * (1 - s / len) + 0.4, (s, t, h) => {
        const u = Math.abs(t) / h;
        if (s > len * 0.65 && u > 0.3) return null;
        return u < 0.35 ? fx[5] : u < 0.7 ? fx[4] : fx[3];
      });
      ball(c, x, y, r, fx);
      break;
    }
    case 'missile':
      along(c, x, y, ang, -len / 2, len / 2, (s) => (len * 0.2) * (1 - Math.abs(s) / (len / 2)) + 0.2, (s, t, h) => (Math.abs(t) < h * 0.4 && s > -len * 0.3 ? fx[5] : shadeAcross(fx, ang, 4, 3, 2)(s, t, h, 0, 0)));
      break;
    case 'lance':
      along(c, x, y, ang, -len / 2, len / 2, (s) => (s > len * 0.1 ? 2.4 * (1 - (s - len * 0.1) / (len * 0.4)) + 0.3 : 1.5), (s, t, h, px0, py0) => {
        if (s < -len * 0.3 && chk(px0, py0)) return null;
        return shadeAcross(fx, ang, 5, 4, 2)(s, t, h, px0, py0);
      });
      break;
    case 'shard':
      along(c, x, y, ang, -len * 0.42, len / 2, (s) => (s >= 0 ? len * 0.2 * (1 - s / (len / 2)) : len * 0.2 * (1 + s / (len * 0.42))) + 0.3, (s, t, h) => {
        const u = (t * litSign(ang)) / Math.max(0.01, h);
        return Math.abs(u) < 0.2 ? fx[5] : u > 0 ? fx[4] : s > 0 ? fx[2] : fx[3];
      });
      break;
    case 'crescent': {
      const r = len * 0.55;
      swoosh(c, x - ca * r * 0.7, y - sa * r * 0.7, r, Math.max(2.6, len * 0.3), ang - 75 * DEG, 150 * DEG, fx, { fade: false, head: 0.5 });
      break;
    }
    case 'feather': {
      const wv = Math.max(2.4, len * 0.13);
      along(c, x, y, ang, -len / 2, len / 2, (s) => wv * Math.pow(Math.max(0, Math.sin(((s + len / 2) / len) * PI)), 0.55) + 0.2, (s, t, h, px0, py0) => {
        if (Math.abs(t) < 0.5) return s < -len * 0.3 ? R.cream[3] : R.cream[5];
        if (Math.abs(t) > h - 0.9 && (Math.floor(px0) + Math.floor(py0) * 2) % 3 === 0) return null;
        return t * litSign(ang) > 0 ? fx[4] : fx[2];
      });
      break;
    }
    case 'blade':
      along(c, x, y, ang, -len / 2, len / 2, (s) => (s > len * 0.05 ? 1.35 * (1 - (s - len * 0.05) / (len * 0.45)) + 0.35 : 1.35), (s, t, h, px0, py0) => {
        if (s < -len * 0.3 && chk(px0, py0)) return null;
        return shadeAcross(fx, ang)(s, t, h, px0, py0);
      });
      break;
    case 'star': {
      const L = Math.max(2, Math.round(len * 0.36));
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * 2 * PI;
        const l = i % 2 ? L * 0.55 : L;
        along(c, x, y, a, 0, l, (s) => (i % 2 ? 0.7 : 1.3) * (1 - s / l) + 0.3, (s) => (s < l * 0.5 ? fx[5] : fx[4]));
      }
      ball(c, x, y, Math.max(1.6, L * 0.32), fx);
      break;
    }
    case 'prism': {
      const r = len * 0.45;
      const p = [x + ca * r, y + sa * r, x + Math.cos(ang + 2.45) * r, y + Math.sin(ang + 2.45) * r, x + Math.cos(ang - 2.45) * r, y + Math.sin(ang - 2.45) * r];
      const ls = litSign(ang);
      fpoly(c, p, (px0, py0) => {
        const t = (-(px0 - x) * sa + (py0 - y) * ca) * ls;
        return t > 0.8 ? fx[5] : t < -0.8 ? fx[3] : fx[4];
      });
      const [tx, ty] = back(r * 0.55);
      const ox = -sa;
      const oy = ca;
      ['#e0626a', '#f8e264', '#7ee0a0', '#8eb2fa'].forEach((col, i) => {
        const o = (i - 1.5) * 1.1;
        seg(c, tx + ox * o, ty + oy * o, tx + ox * o * 1.8 - ca * r * 1.3, ty + oy * o * 1.8 - sa * r * 1.3, (j, n) => (j > n * 0.7 && j % 2 ? null : col));
      });
      break;
    }
    case 'bubble': {
      const r = Math.max(2.5, len * 0.32);
      ring(c, x, y, r - 1.1, r, fx[4]);
      dot(c, x, y, r - 1.2, fx[2]);
      px(c, x - r * 0.4, y - r * 0.45, fx[5]);
      px(c, x - r * 0.4 + 1, y - r * 0.45, fx[5]);
      break;
    }
    case 'glob': {
      const r = Math.max(2.4, len * 0.3);
      ball(c, x, y, r, fx);
      const [d1x, d1y] = back(r + 2.5);
      dot(c, d1x, d1y, 1.1, fx[3]);
      const [d2x, d2y] = back(r + 5);
      px(c, d2x + sa * 1.5, d2y - ca * 1.5, fx[3]);
      break;
    }
    case 'thorn':
      along(c, x, y, ang, -len / 2, len / 2, (s) => 1.5 * (1 - Math.abs(s) / (len / 2)) + 0.4, shadeAcross(R.leaf, ang, 5, 4, 2));
      break;
    case 'nail':
      along(c, x, y, ang, -len * 0.35, len / 2, (s) => (s > len * 0.25 ? Math.max(0.4, 1.2 * (1 - (s - len * 0.25) / (len * 0.25))) : 1.2), shadeAcross(R.steel, ang, 5, 4, 2));
      along(c, x - ca * len * 0.35, y - sa * len * 0.35, ang + PI / 2, -2.8, 2.8, () => 1.1, () => R.steel[4]);
      break;
    case 'wisp': {
      const r = Math.max(2.8, len * 0.3);
      along(c, x, y, ang + PI, 0, len, (s) => r * (1 - s / len) + 0.3, (s, _t, _h, px0, py0) => (s > len * 0.5 && chk(px0, py0) ? null : fx[3]));
      ball(c, x, y, r, R.bone);
      px(c, x - 1, y - 0.2, OUT);
      px(c, x + 1, y - 0.2, OUT);
      px(c, x, y + 1.3, fx[1]);
      break;
    }
    case 'hook': {
      const [tx, ty] = back(len * 0.5);
      seg(c, tx - ca * 6, ty - sa * 6, tx, ty, (i) => (i % 2 ? R.iron[4] : R.iron[2]));
      along(c, x, y, ang, -len * 0.5, len * 0.1, () => 0.8, () => R.steel[4]);
      const hx = x + ca * len * 0.1;
      const hy = y + sa * len * 0.1;
      const hr = Math.max(3.4, len * 0.22);
      ring(c, hx + Math.cos(ang + PI / 2) * (hr - 0.6), hy + Math.sin(ang + PI / 2) * (hr - 0.6), hr - 1.7, hr, (_a, d) => (d < 0.5 ? R.steel[5] : R.steel[3]), ang - PI / 2, PI * 1.2);
      along(c, x, y, ang, -len * 0.5, len * 0.1, () => (len > 14 ? 1.1 : 0.8), shadeAcross(R.steel, ang, 5, 4, 3));
      break;
    }
    case 'net': {
      const r = len * 0.48;
      paint(c, x - r - 1, y - r - 1, x + r + 1, y + r + 1, (px0, py0) => {
        const u = Math.abs(px0 - x) + Math.abs(py0 - y);
        if (u > r) return null;
        const i = Math.floor(px0);
        const j = Math.floor(py0);
        if (u > r - 1) return R.cream[2];
        return (i + j) % 3 === 0 || (((i - j) % 3) + 3) % 3 === 0 ? R.cream[3] : null;
      });
      for (const [ox, oy] of [[r, 0], [-r, 0], [0, r], [0, -r]]) dot(c, x + ox, y + oy, 1, R.iron[4]);
      break;
    }
    case 'web':
      ball(c, x, y, Math.max(2.6, len * 0.3), fx);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * 2 * PI + rng() * 0.3;
        seg(c, x + Math.cos(a) * 3, y + Math.sin(a) * 3, x + Math.cos(a) * (len * 0.6), y + Math.sin(a) * (len * 0.6), R.leaf[4]);
      }
      break;
  }
}

/** A blade tinted toward an element: steel edges with the element's hot core. */
function bladeRamp(fx: Ramp): Ramp {
  return [fx[0], fx[1], fx[2], fx[4], mix(fx[5], '#ffffff', 0.4), '#ffffff'];
}

/** Motion streaks behind (x, y), parallel to `ang`. */
function streaks(c: Ctx, x: number, y: number, ang: number, n: number, len: number, fx: Ramp, rng: () => number, gap = 3): void {
  const ca = Math.cos(ang);
  const sa = Math.sin(ang);
  for (let i = 0; i < n; i++) {
    const off = (i - (n - 1) / 2) * gap;
    const L = len * (0.55 + rng() * 0.45) * (1 - Math.abs(off) / (gap * n));
    const sx = x - ca * 2 - sa * off;
    const sy = y - sa * 2 + ca * off;
    seg(c, sx, sy, sx - ca * L, sy - sa * L, (j, m) => (j > m * 0.6 ? (j % 2 ? null : fx[3]) : j > m * 0.25 ? fx[4] : fx[5]));
  }
}

/** Claw marks: three curved parallel rakes. */
function claws(c: Ctx, cx: number, cy: number, size: number, fx: Ramp): void {
  for (let i = -1; i <= 1; i++) {
    const ox = i * size * 0.32;
    along(c, cx + ox, cy - ox * 0.3, -60 * DEG, -size / 2, size / 2, (s) => 1.15 * Math.sin(((s + size / 2) / size) * PI) + 0.1, (s, t) => (s > 0 && t < 0 ? fx[5] : fx[4]));
  }
}

function skull(c: Ctx, x: number, y: number, rp: Ramp = R.bone): void {
  bitmap(c, x, y, ['.####.', '######', '#o##o#', '######', '.#.#.#'], rp[4]);
  px(c, x + 1, y, rp[5]);
}

function eye(c: Ctx, cx: number, cy: number, w: number, rp: Ramp, iris: Ramp): void {
  paint(c, cx - w, cy - w, cx + w, cy + w, (x, y) => {
    const u = (x - cx) / w;
    const hh = (w * 0.55) * (1 - u * u);
    if (Math.abs(y - cy) > hh) return null;
    return Math.abs(y - cy) > hh - 1 ? rp[2] : rp[5];
  });
  ball(c, cx, cy, Math.max(1.8, w * 0.36), iris, false);
  px(c, cx, cy, OUT);
  px(c, cx - 1, cy - 1, '#ffffff');
}

function shield(c: Ctx, cx: number, cy: number, w: number, h: number, body: Ramp, rim: Ramp): void {
  const top = cy - h / 2;
  const mask = (x: number, y: number, inset: number): boolean => {
    const t = (y - top - inset) / (h - inset * 2);
    if (t < 0 || t > 1) return false;
    const half = (w / 2 - inset) * (t < 0.5 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.5) / 0.5) ** 2)));
    return Math.abs(x - cx) <= half;
  };
  paint(c, cx - w / 2 - 1, top - 1, cx + w / 2 + 1, top + h + 1, (x, y) => {
    if (!mask(x, y, 0)) return null;
    if (!mask(x, y, 1.2)) return x + y < cx + cy ? rim[5] : rim[3];
    return x < cx ? body[4] : body[3];
  });
}

function boot(c: Ctx, x: number, y: number, rp: Ramp, big = false): void {
  const k = big ? 1.4 : 1;
  const X = (v: number): number => x + v * k;
  const Y = (v: number): number => y + v * k;
  fpoly(c, [X(0.5), Y(1), X(6.5), Y(1), X(6.5), Y(8), X(11), Y(9.5), X(12), Y(11), X(12), Y(13), X(0), Y(13), X(0.5), Y(8)], (px0, py0) =>
    px0 < X(2.2) ? rp[4] : py0 > Y(10.5) && px0 > X(7) ? rp[2] : rp[3],
  );
  rect(c, X(0), Y(0), 7.5 * k, 2 * k, rp[4]);
  rect(c, X(0), Y(0), 7.5 * k, 1, rp[5]);
  rect(c, X(0), Y(13), 12.5 * k, 1.4 * k, rp[1]);
  px(c, X(9), Y(10), rp[4]);
}

function wing(c: Ctx, x: number, y: number, rp: Ramp, flip = false): void {
  const rows = ['#####.', '.#####', '..####', '...###', '....##'];
  rows.forEach((row, j) => {
    for (let i = 0; i < row.length; i++) if (row[i] === '#') px(c, flip ? x - i : x + i, y + j, j === 0 ? rp[5] : rp[4]);
  });
}

function heart(c: Ctx, cx: number, cy: number, r: number, rp: Ramp): void {
  paint(c, cx - r * 2, cy - r * 2, cx + r * 2, cy + r * 2.2, (x, y) => {
    const lx = x - (cx - r * 0.75);
    const rx = x - (cx + r * 0.75);
    const dy = y - (cy - r * 0.2);
    const inL = Math.hypot(lx, dy) <= r;
    const inR = Math.hypot(rx, dy) <= r;
    const inT = y >= cy - r * 0.2 && Math.abs(x - cx) <= (r * 1.75) * (1 - (y - (cy - r * 0.2)) / (r * 2));
    if (!(inL || inR || inT)) return null;
    const l = Math.hypot(x - (cx - r), y - (cy - r * 0.6)) / (r * 2.4);
    return l < 0.2 ? rp[5] : l < 0.5 ? rp[4] : rp[3];
  });
}

function palm(c: Ctx, x: number, y: number, rp: Ramp): void {
  bitmap(c, x, y, ['.#.#.#..', '.#.#.#..', '.#.#.#.#', '.######.', '#######.', '.######.', '..#####.', '..####..'], rp[4], rp[3]);
  rect(c, x + 1, y, 1, 3, rp[5]);
}

function lotus(c: Ctx, cx: number, cy: number, rp: Ramp): void {
  for (const [a, l] of [[-90, 7], [-135, 6], [-45, 6], [-170, 5], [-10, 5]] as const) {
    along(c, cx, cy, a * DEG, 0, l, (s) => 2 * Math.sin((s / l) * PI) + 0.3, shadeAcross(rp, a * DEG, 5, 4, 3));
  }
  rect(c, cx - 4, cy, 9, 2, R.leaf[3]);
}

function mushroom(c: Ctx, cx: number, by: number, w: number, cap: Ramp): void {
  rect(c, cx - 1, by - w * 0.6, 3, w * 0.6, R.bone[4]);
  paint(c, cx - w, by - w * 1.3, cx + w, by - w * 0.4, (x, y) => {
    const dy = (by - w * 0.55 - y) / (w * 0.65);
    const dx = (x - cx - 0.5) / (w * 0.75);
    if (dy < 0 || dx * dx + dy * dy > 1) return null;
    return dx < -0.2 && dy > 0.3 ? cap[4] : dy < 0.25 ? cap[2] : cap[3];
  });
  px(c, cx - 1, by - w * 1.0, R.cream[4]);
  px(c, cx + 2, by - w * 0.8, R.cream[4]);
}

function ghost(c: Ctx, cx: number, cy: number, s: number, rp: Ramp): void {
  paint(c, cx - s, cy - s - 1, cx + s + 1, cy + s + 2, (x, y) => {
    const dx = x - cx;
    const top = cy - s * 0.2;
    const inside = y < top ? Math.hypot(dx, y - top) <= s * 0.8 : Math.abs(dx) <= s * 0.8 && y <= cy + s * 0.8 + (Math.floor(x) % 3 === 0 ? 1 : 0);
    if (!inside) return null;
    return dx < -s * 0.2 ? rp[5] : dx > s * 0.4 ? rp[3] : rp[4];
  });
  px(c, cx - 2, cy - s * 0.3, OUT);
  px(c, cx + 1, cy - s * 0.3, OUT);
  rect(c, cx - 1, cy + 1, 2, 2, OUT);
}

function crown(c: Ctx, cx: number, by: number, w: number, rp: Ramp, gem: string): void {
  const x0 = cx - w / 2;
  fpoly(c, [x0, by, x0, by - 7, x0 + w * 0.25, by - 4, cx, by - 9, x0 + w * 0.75, by - 4, x0 + w, by - 7, x0 + w, by], (x) => (x < cx - 1 ? rp[5] : x < cx + 2 ? rp[4] : rp[3]));
  rect(c, x0, by - 2, w, 2, rp[2]);
  px(c, cx, by - 4, gem);
  px(c, cx - 0.5, by - 5, gem);
}

function mask(c: Ctx, cx: number, cy: number, rp: Ramp): void {
  // a two-faced mask: pale left half, dusky right half (the mimic's borrowed face)
  paint(c, cx - 8, cy - 8, cx + 8, cy + 9, (x, y) => {
    const dx = (x - cx) / 6.5;
    const dy = (y - cy + 0.5) / (y < cy ? 7 : 8);
    if (dx * dx + dy * dy > 1) return null;
    if (x < cx) return dx < -0.6 ? rp[4] : rp[5];
    return dx > 0.6 ? R.violet[2] : R.violet[3];
  });
  fpoly(c, [cx - 5, cy - 2, cx - 2, cy - 3, cx - 1, cy - 1, cx - 4, cy - 1], OUT);
  fpoly(c, [cx + 1, cy - 1, cx + 2, cy - 3, cx + 5, cy - 2, cx + 4, cy - 1], R.violet[5]);
  seg(c, cx - 3, cy + 3, cx, cy + 4, OUT);
  seg(c, cx, cy + 4, cx + 3, cy + 2, R.violet[5]);
  rect(c, cx - 8, cy - 2, 2, 1, R.blood[4]);
  rect(c, cx + 7, cy - 2, 2, 1, R.blood[4]);
}

function bolt(c: Ctx, x: number, y: number, s: number, rp: Ramp): void {
  const p = [6, 0, 1, 9, 5, 9, 2, 17, 11, 6, 7, 6, 10, 0].map((v) => v * s);
  for (let i = 0; i < p.length; i += 2) {
    p[i] += x;
    p[i + 1] += y;
  }
  fpoly(c, p, (px0, py0) => ((px0 - x) < 5 * s - (py0 - y) * 0.15 ? rp[5] : rp[4]));
}

function spiral(c: Ctx, cx: number, cy: number, r: number, rp: Ramp, a0 = 0, arms = 3): void {
  for (let i = 0; i < arms; i++) {
    const rr = r * (1 - i * 0.28);
    swoosh(c, cx, cy, rr, Math.max(1.6, r * 0.24), a0 + (i * 2 * PI) / arms, 200 * DEG, rp, { fade: true, head: 0.6 });
  }
}

/** Eight-ray burst with a hot core. */
function burst(c: Ctx, cx: number, cy: number, r: number, rp: Ramp, rays = 8, rot = 0): void {
  for (let i = 0; i < rays; i++) {
    const a = rot + (i / rays) * 2 * PI;
    const L = i % 2 ? r * 0.7 : r;
    along(c, cx, cy, a, r * 0.25, L, (s) => 1.4 * (1 - (s - r * 0.25) / (L - r * 0.25)) + 0.35, (s) => (s < L * 0.55 ? rp[5] : rp[4]));
  }
  ball(c, cx, cy, Math.max(2.5, r * 0.32), rp);
}

function planet(c: Ctx, cx: number, cy: number, r: number, rp: Ramp, ringRp: Ramp): void {
  ball(c, cx, cy, r, rp);
  paint(c, cx - r * 2, cy - r, cx + r * 2, cy + r, (x, y) => {
    const u = (x - cx) / (r * 1.8);
    const v = (y - cy + (x - cx) * 0.3) / (r * 0.45);
    const d = u * u + v * v;
    if (d > 1 || d < 0.55) return null;
    if (y < cy - (x - cx) * 0.3 && Math.hypot(x - cx, y - cy) < r) return null;
    return u < 0 ? ringRp[5] : ringRp[3];
  });
}

/** War horn: a tapering tube along a curve from the mouthpiece (x, y) up-right to a flared bell. */
function horn(c: Ctx, x: number, y: number, rp: Ramp, scale = 1): void {
  const x1 = x + 19 * scale;
  const y1 = y - 9 * scale;
  const mx = (x + x1) / 2 + 3 * scale;
  const my = (y + y1) / 2 + 5 * scale;
  const N = 48;
  let tx = 1;
  let ty = 0;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const px0 = (1 - t) * (1 - t) * x + 2 * (1 - t) * t * mx + t * t * x1;
    const py0 = (1 - t) * (1 - t) * y + 2 * (1 - t) * t * my + t * t * y1;
    tx = 2 * (1 - t) * (mx - x) + 2 * t * (x1 - mx);
    ty = 2 * (1 - t) * (my - y) + 2 * t * (y1 - my);
    const r = (0.9 + t * t * 3.4) * scale;
    const band = Math.floor(t * 10) % 3 === 2 && t < 0.8;
    paint(c, px0 - r - 1, py0 - r - 1, px0 + r + 1, py0 + r + 1, (qx, qy) => {
      const dx = qx - px0;
      const dy = qy - py0;
      if (dx * dx + dy * dy > r * r) return null;
      const lit = -(dx + dy) / Math.max(r, 0.5);
      if (band) return lit > 0.3 ? R.gold[5] : lit < -0.6 ? R.gold[2] : R.gold[4];
      return lit > 0.55 ? rp[5] : lit < -0.7 ? rp[2] : rp[4];
    });
  }
  const tl = Math.hypot(tx, ty) || 1;
  const ux = tx / tl;
  const uy = ty / tl;
  const rb = 4.6 * scale;
  paint(c, x1 - rb - 2, y1 - rb - 2, x1 + rb + 2, y1 + rb + 2, (qx, qy) => {
    const a = (qx - x1) * ux + (qy - y1) * uy;
    const b = -(qx - x1) * uy + (qy - y1) * ux;
    const e = (a / (1.8 * scale)) ** 2 + (b / rb) ** 2;
    if (e > 1) return null;
    return e < 0.42 && a > -0.6 * scale ? '#1a120c' : b < 0 ? R.gold[5] : R.gold[3];
  });
  rect(c, x - 1.5 * scale, y - 1, 2 * scale, 2 * scale, R.gold[3]);
}

function hourglass(c: Ctx, cx: number, cy: number, sand: Ramp): void {
  rect(c, cx - 5, cy - 8, 11, 2, R.wood[4]);
  rect(c, cx - 5, cy + 7, 11, 2, R.wood[3]);
  fpoly(c, [cx - 4, cy - 6, cx + 5, cy - 6, cx + 1.5, cy, cx + 5, cy + 7, cx - 4, cy + 7, cx - 0.5, cy], (x) => (x < cx ? '#cfe6f0' : '#a0c0d0'));
  fpoly(c, [cx - 2, cy - 4, cx + 3, cy - 4, cx + 0.5, cy - 1], sand[4]);
  fpoly(c, [cx - 3, cy + 7, cx + 4, cy + 7, cx + 0.5, cy + 3], sand[3]);
}

function footprint(c: Ctx, x: number, y: number, col: string): void {
  bitmap(c, x, y, ['.#.#', '#.#.', '.##.', '###.', '###.', '.##.', '.##.'], col);
}

function millstone(c: Ctx, cx: number, cy: number, r: number): void {
  paint(c, cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (x, y) => {
    const d = Math.hypot(x - cx, y - cy);
    if (d > r || d < 1.6) return null;
    const a = Math.atan2(y - cy, x - cx);
    if (d > r - 1.2 && Math.floor((a + PI) / (PI / 6)) % 2 === 0) return R.stone[2];
    if (Math.abs(Math.sin(a * 2)) < 0.12 && d < r - 1.5) return R.stone[2];
    const l = Math.hypot(x - (cx - r * 0.4), y - (cy - r * 0.4)) / (r * 1.6);
    return l < 0.4 ? R.stone[5] : l < 0.7 ? R.stone[4] : R.stone[3];
  });
}

// ------------------------------------------------------------------ skill tiles

interface SkillCtx {
  def: SkillDef;
  /** Words of the id plus tags (lower-case). */
  w: Set<string>;
  fx: Ramp;
  rng: () => number;
  weapon?: WeaponType;
  /** Set by a motif when it already shows the weapon (suppresses the corner weapon badge). */
  showsWeapon: boolean;
}

function skillRamps(def: SkillDef): { fx: Ramp; bg: readonly string[] } {
  if (def.element) {
    const fx = ELEMENT_RAMPS[def.element];
    if (fx) return { fx, bg: [mix(fx[0], '#0c0806', 0.6), mix(fx[0], '#0c0806', 0.15), mix(fx[0], fx[1], 0.5), mix(fx[0], fx[1], 0.95)] };
  }
  const t = new Set(def.tags);
  if (t.has('toxin')) return { fx: R.venom, bg: BG.venom };
  if (t.has('arcane')) return { fx: R.arcane, bg: BG.arcane };
  if (t.has('stealth')) return { fx: R.dusk, bg: BG.dusk };
  if (t.has('spirit') || t.has('echo')) return { fx: R.spirit, bg: BG.spirit };
  return { fx: R.steel, bg: BG.steel };
}

function words(def: SkillDef): Set<string> {
  const id = def.generated ? (def.baseId ?? def.id) : def.id;
  return new Set([...id.split(/[_@~|:]/), ...def.tags, ...(def.element ? [def.element] : [])]);
}

function has(k: SkillCtx, ...ws: string[]): boolean {
  return ws.some((w) => k.w.has(w));
}

function tileBack(c: Ctx, bg: readonly string[], pattern: number): void {
  const [b0, b1, b2, b3] = bg;
  paint(c, 1, 1, 31, 31, (x, y) => {
    const dx = x - 15.2;
    const dy = y - 15.2;
    let d = Math.hypot(dx, dy) / 15;
    const ch = chk(x, y);
    if (pattern === 1) {
      const a = Math.atan2(dy, dx);
      if (Math.floor((a + PI) / (PI / 6)) % 2 === 0 && d > 0.3) d += 0.16;
    } else if (pattern === 2) {
      d += (Math.floor(x) - Math.floor(y) + 64) % 10 < 5 ? 0 : 0.12;
    } else if (pattern === 3) {
      d += Math.floor(d * 7) % 2 ? 0.07 : 0;
    }
    if (d < 0.36) return b3;
    if (d < 0.44) return ch ? b3 : b2;
    if (d < 0.68) return b2;
    if (d < 0.76) return ch ? b2 : b1;
    if (d < 0.98) return b1;
    if (d < 1.06) return ch ? b1 : b0;
    return b0;
  });
}

function tileFrame(c: Ctx, tier: number, gem: Ramp): void {
  const rim = TIER_RIM[Math.max(0, Math.min(3, tier))];
  rect(c, 2, 0, 28, 1, OUT);
  rect(c, 2, 31, 28, 1, OUT);
  rect(c, 0, 2, 1, 28, OUT);
  rect(c, 31, 2, 1, 28, OUT);
  for (const [x, y] of [[1, 1], [30, 1], [1, 30], [30, 30]]) px(c, x, y, OUT);
  c.clearRect(0, 0, 1, 2);
  c.clearRect(0, 0, 2, 1);
  c.clearRect(31, 0, 1, 2);
  c.clearRect(30, 0, 2, 1);
  c.clearRect(0, 30, 1, 2);
  c.clearRect(0, 31, 2, 1);
  c.clearRect(31, 30, 1, 2);
  c.clearRect(30, 31, 2, 1);
  rect(c, 2, 1, 28, 1, rim.hi);
  rect(c, 1, 2, 1, 28, rim.hi);
  rect(c, 2, 30, 28, 1, rim.lo);
  rect(c, 30, 2, 1, 28, rim.lo);
  if (tier === 2) {
    for (const [x, y] of [[2, 2], [28, 2], [2, 28], [28, 28]]) {
      rect(c, x, y, 2, 2, R.gold[3]);
      px(c, x, y, R.gold[5]);
      px(c, x + 1, y + 1, R.gold[2]);
    }
  }
  if (tier >= 3) {
    for (const [x, y] of [[3, 3], [28, 3], [3, 28], [28, 28]]) {
      for (const [ox, oy] of [[0, -2], [-2, 0], [2, 0], [0, 2], [-1, -1], [1, -1], [-1, 1], [1, 1]]) px(c, x + ox, y + oy, OUT);
      for (const [ox, oy] of [[0, -1], [-1, 0], [1, 0], [0, 1]]) px(c, x + ox, y + oy, R.gold[4]);
      px(c, x, y, gem[5]);
      px(c, x, y - 1, R.gold[5]);
    }
  }
}

/** Small weapon glyph for the bottom-right corner. */
function weaponBadge(c: Ctx, weapon: WeaponType, fx: Ramp): void {
  rect(c, 21, 21, 10, 10, OUT);
  rect(c, 22, 22, 9, 9, R.gold[2]);
  rect(c, 22, 22, 9, 1, R.gold[4]);
  rect(c, 22, 22, 1, 9, R.gold[4]);
  rect(c, 23, 23, 7, 7, '#1c140e');
  const glyph: Record<WeaponType, readonly string[]> = {
    sword: ['......#', '.....#.', '....#..', '.+.#...', '..+....', '.+.+...', '+......'],
    dagger: ['.......', '.....#.', '....#..', '..+#...', '..+....', '.+.....', '.......'],
    staff: ['....**.', '....**.', '...+...', '..+....', '.+.....', '+......', '.......'],
    fists: ['.......', '.####..', '.#####.', '.#####.', '.++++..', '..++...', '.......'],
  };
  bitmap(c, 23, 23, glyph[weapon], R.steel[5], weapon === 'staff' ? R.wood[5] : R.gold[4], fx === R.steel ? R.arcane[4] : fx[4]);
}

// ---- motifs

function motifStrike(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const sh = k.def.shape.kind === 'strike' ? k.def.shape : null;
  const heavy = has(k, 'heavy');
  const wpn = k.weapon;
  if (has(k, 'kick', 'heel')) {
    swoosh(c, 15, 17, 12, 4, 110 * DEG, -200 * DEG, fx);
    boot(c, 11, 5, LEATHER, true);
    star4(c, 24, 6, 3, fx);
    if (has(k, 'heel')) wing(c, 10, 9, R.cream, true);
    return;
  }
  if (has(k, 'palm', 'point')) {
    ring(c, 19, 13, 7, 8.2, fx[4], -100 * DEG, 200 * DEG);
    ring(c, 19, 13, 10, 11, fx[3], -90 * DEG, 180 * DEG);
    palm(c, has(k, 'point') ? 9 : 10, 12, R.cream);
    if (has(k, 'point')) star4(c, 22, 10, 3, fx);
    return;
  }
  if (has(k, 'crack', 'armor')) {
    shield(c, 15, 16, 16, 19, R.iron, R.iron);
    seg(c, 15, 7, 13, 12, OUT);
    seg(c, 13, 12, 17, 16, OUT);
    seg(c, 17, 16, 14, 22, OUT);
    hammerAt(c, 22, 10, -135 * DEG, 12);
    return;
  }
  if (has(k, 'breath', 'gust')) {
    for (let i = 0; i < 4; i++) swoosh(c, 6, 16, 9 + i * 5, 2.2, -30 * DEG, 60 * DEG, fx, { fade: false, head: 0.5 });
    for (let i = 0; i < 5; i++) {
      const a = (-25 + rng() * 50) * DEG;
      const d = 10 + rng() * 14;
      star4(c, 6 + Math.cos(a) * d, 16 + Math.sin(a) * d, 1, fx);
    }
    return;
  }
  if (has(k, 'rend')) {
    claws(c, 16, 16, 18, fx);
    return;
  }
  if (has(k, 'lash')) {
    seg(c, 6, 25, 9, 22, R.wood[3]);
    for (let i = 0; i < 26; i++) {
      const t = i / 25;
      const x = 9 + t * 18;
      const y = 22 - Math.sin(t * PI * 1.5) * 9 - t * 6;
      rect(c, x, y, t > 0.8 ? 1 : 2, t > 0.8 ? 1 : 2, i % 4 === 0 ? fx[5] : fx[4]);
    }
    return;
  }
  const thrust = (wpn === 'dagger' || (!wpn && has(k, 'pierce') && !has(k, 'blade'))) && !has(k, 'twin', 'felling');
  if (thrust) {
    const ang = (-40 - rng() * 10) * DEG;
    streaks(c, 13, 20, ang, 3, 9, fx, rng, 3.5);
    daggerAt(c, 10, 22, ang, 12, has(k, 'shadow', 'umbral') ? bladeRamp(fx) : R.steel);
    const ix = 10 + Math.cos(ang) * 15;
    const iy = 22 + Math.sin(ang) * 15;
    star4(c, ix, iy, 4, has(k, 'execute') ? R.blood : fx);
    k.showsWeapon = true;
    if (has(k, 'stealth') && !has(k, 'execute')) moon(c, 9, 10, 5, R.dusk, 0.5, -0.2);
    if (has(k, 'execute')) {
      skull(c, 4, 4, R.bone);
      dot(c, ix + 3, iy + 4, 1, R.blood[3]);
    }
    if (has(k, 'toxin')) {
      droplet(c, 22, 27, 1.6, 4, R.venom);
      droplet(c, 26, 23, 1.3, 3, R.venom);
    }
    if (has(k, 'hex')) ring(c, 23, 9, 4, 5, R.arcane[4]);
    if (has(k, 'coup')) {
      dot(c, 25, 24, 2, R.rose[3]);
      px(c, 24, 23, R.rose[5]);
      seg(c, 25, 26, 23, 28, R.leaf[3]);
    }
    return;
  }
  // ---- crescent slash with weapon
  const spanDeg = Math.max(140, Math.min(290, (sh?.arc ?? 110) * 0.9 + 60));
  const a0 = (170 + rng() * 30) * DEG;
  const thick = heavy ? 6.5 : 4.5 + rng();
  const r = has(k, 'crescent', 'sweep') ? 13 : 12;
  if (has(k, 'guillotine')) {
    swoosh(c, 16, 14, 12, 5, 200 * DEG, 150 * DEG, fx);
    swordAt(c, 16, 6, 90 * DEG, 17, R.steel);
    rect(c, 6, 26, 21, 2, R.wood[3]);
    dot(c, 21, 25, 1.2, R.blood[3]);
    k.showsWeapon = true;
    return;
  }
  if (has(k, 'sunder', 'sundering')) {
    rock(c, [3, 26, 9, 22, 16, 23, 23, 21, 29, 25, 29, 29, 3, 29], has(k, 'molten') ? ELEMENT_RAMPS.magma : R.stone, 16, 25);
    seg(c, 16, 23, 13, 29, has(k, 'molten') ? ELEMENT_RAMPS.magma[5] : OUT);
    seg(c, 17, 23, 21, 29, has(k, 'molten') ? ELEMENT_RAMPS.magma[4] : OUT);
    swoosh(c, 16, 15, 11, 4.5, 190 * DEG, 160 * DEG, fx);
    swordAt(c, 21, 6, 115 * DEG, 15);
    k.showsWeapon = true;
    return;
  }
  if (has(k, 'twin')) {
    swoosh(c, 15, 16, 12, 4, 170 * DEG, 200 * DEG, fx);
    swoosh(c, 17, 16, 12, 4, 10 * DEG, -200 * DEG, fx);
    swordAt(c, 8, 24, -45 * DEG, 13);
    daggerAt(c, 24, 24, -135 * DEG, 10);
    k.showsWeapon = true;
    return;
  }
  swoosh(c, 15.5, 16.5, r, thick, a0, spanDeg * DEG, fx);
  if (has(k, 'tidal')) {
    for (let i = 0; i < 4; i++) dot(c, 8 + i * 5, 26 - (i % 2), 1.4, fx[4]);
  }
  if (wpn === 'staff') {
    staffAt(c, 7, 26, -45 * DEG, 17, fx === R.steel ? R.arcane : fx);
  } else if (wpn === 'sword' || has(k, 'blade')) {
    const len = heavy ? 17 : 16;
    swordAt(c, 8, 24, -45 * DEG, len, has(k, 'molten', 'magma', 'runic') ? bladeRamp(fx) : R.steel);
  } else if (has(k, 'felling')) {
    axeAt(c, 13, 18, -45 * DEG, 16);
  } else {
    palm(c, 8, 17, R.cream);
  }
  k.showsWeapon = true;
  if (heavy) {
    for (let i = 0; i < 4; i++) {
      const x = 5 + rng() * 22;
      const y = 25 + rng() * 3;
      rect(c, x, y, 2, 2, R.stone[3]);
      px(c, x, y, R.stone[5]);
    }
  }
  if (has(k, 'execute')) skull(c, 22, 22, R.bone);
  if (has(k, 'runic')) {
    ring(c, 22, 9, 3.5, 4.6, R.arcane[4]);
    px(c, 22, 9, R.arcane[5]);
  }
  if (has(k, 'saint')) {
    for (let i = 0; i < 4; i++) {
      const x = 18 + rng() * 10;
      const y = 4 + rng() * 10;
      rect(c, x, y, 2, 1, R.rose[4]);
      px(c, x, y + 1, R.rose[3]);
    }
  }
}

function motifSpin(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const a0 = rng() * 2 * PI;
  if (has(k, 'tornado') || (has(k, 'eye') && has(k, 'storm')) || has(k, 'firestorm')) {
    for (let i = 0; i < 6; i++) {
      const y = 6.5 + i * 3.7;
      const w = 12.5 - i * 1.85;
      const cx = 16 + Math.sin(i * 1.2) * 1.6;
      paint(c, cx - w - 1, y - 4, cx + w + 1, y + 4, (x, yy) => {
        const u = (x - cx) / w;
        const v = (yy - y) / 2.6;
        const d = u * u + v * v;
        if (d > 1 || d < 0.4) return null;
        return yy < y - 0.4 ? fx[2] : u < -0.25 ? fx[5] : fx[4];
      });
    }
    for (let i = 0; i < 4; i++) rect(c, 4 + rng() * 24, 22 + rng() * 6, 2, 1, fx[3]);
    if (has(k, 'eye')) eye(c, 16, 8, 5, R.bone, fx);
    if (has(k, 'firestorm')) {
      flame(c, 9, 29, 6, 10, ELEMENT_RAMPS.fire, -1);
      flame(c, 23, 29, 6, 9, ELEMENT_RAMPS.fire, 1);
    }
    return;
  }
  if (has(k, 'ring', 'inferno')) {
    for (let i = 0; i < 8; i++) {
      const a = a0 + (i / 8) * 2 * PI;
      flame(c, 16 + Math.cos(a) * 9, 18 + Math.sin(a) * 8, 6, 9, fx);
    }
    ball(c, 16, 16, 3, fx);
    return;
  }
  if (has(k, 'ripple', 'pulse', 'peal', 'field', 'wail') || (has(k, 'echo') && has(k, 'sovereign'))) {
    for (let i = 0; i < 3; i++) ring(c, 16, 16, 5 + i * 4.2, 6.2 + i * 4.2, i % 2 ? fx[3] : fx[4], -PI / 2 + 0.4, 2 * PI - 0.8);
    if (has(k, 'peal')) {
      fpoly(c, [12, 21, 13, 13, 16, 10, 19, 13, 20, 21], (x) => (x < 15 ? R.gold[5] : R.gold[3]));
      rect(c, 11, 21, 10, 2, R.gold[2]);
      dot(c, 16, 24, 1.2, R.gold[4]);
    } else if (has(k, 'palm')) palm(c, 12, 12, R.cream);
    else if (has(k, 'wail')) ghost(c, 16, 15, 5, R.bone);
    else if (has(k, 'field')) zap(c, 10, 10, 22, 22, fx, rng, 4, 2);
    else if (has(k, 'sovereign')) crown(c, 16, 20, 10, R.gold, fx[4]);
    else ball(c, 16, 16, 3.2, fx);
    return;
  }
  if (has(k, 'thousand', 'cuts')) {
    for (let i = 0; i < 7; i++) {
      const a = a0 + (i / 7) * 2 * PI;
      along(c, 16 + Math.cos(a) * 8, 16 + Math.sin(a) * 8, a + PI / 2, -4, 4, (s) => 1.1 * Math.cos((s / 4) * (PI / 2)) + 0.1, (_s, t) => (t < 0 ? fx[5] : fx[4]));
    }
    daggerAt(c, 13, 19, -45 * DEG, 8);
    k.showsWeapon = true;
    return;
  }
  if (has(k, 'radiant', 'moonwarden')) {
    for (let i = 0; i < 10; i++) {
      const a = a0 + (i / 10) * 2 * PI;
      along(c, 16, 16, a, 9, 13, (s) => 1.2 * (1 - (s - 9) / 4) + 0.3, () => fx[4]);
    }
    ring(c, 16, 16, 7, 8.4, fx[3]);
    if (has(k, 'moonwarden')) moon(c, 16, 16, 5.5, fx);
    else ball(c, 16, 16, 5, fx);
    return;
  }
  const arms = has(k, 'vortex') ? 4 : 3;
  spiral(c, 16, 16, 13, fx, a0, arms);
  if (has(k, 'prism')) {
    const rainbow: Ramp = ['#3a1410', '#c4421c', '#e2bc2c', '#62b48a', '#4f74d8', '#e4eeff'];
    spiral(c, 16, 16, 9, rainbow, a0 + 1, 2);
  }
  if (k.weapon === 'sword' || (has(k, 'blade') && !k.weapon)) {
    swordAt(c, 10, 22, -45 * DEG, 11, has(k, 'flame', 'fire') ? bladeRamp(fx) : R.steel);
    k.showsWeapon = true;
  } else if (k.weapon === 'dagger') {
    daggerAt(c, 12, 20, -45 * DEG, 8);
    k.showsWeapon = true;
  } else if (has(k, 'spore', 'blight', 'rotspore')) {
    mushroom(c, 16, 21, 5, has(k, 'blight') ? R.violet : R.blood);
  } else ball(c, 16, 16, 3.2, fx);
  if (has(k, 'spore', 'blight', 'rotspore', 'toxin')) {
    for (let i = 0; i < 6; i++) dot(c, 4 + rng() * 24, 4 + rng() * 24, 0.9, R.venom[4]);
  }
  if (has(k, 'stormreaver') || (has(k, 'lightning') && !has(k, 'field'))) zap(c, 4, 6, 12, 14, ELEMENT_RAMPS.lightning, rng, 3, 1.6);
}

function projObj(k: SkillCtx): Obj {
  if (has(k, 'hook')) return 'hook';
  if (has(k, 'net')) return 'net';
  if (has(k, 'feather', 'featherstorm')) return 'feather';
  if (has(k, 'hammer')) return 'hammer';
  if (has(k, 'cleaver')) return 'axe';
  if (has(k, 'prism', 'dawn')) return 'prism';
  if (has(k, 'bubble')) return 'bubble';
  if (has(k, 'spit', 'glob')) return 'glob';
  if (has(k, 'thorn')) return 'thorn';
  if (has(k, 'nail')) return 'nail';
  if (has(k, 'tangle')) return 'web';
  if (has(k, 'chill')) return 'wisp';
  if (has(k, 'cutter', 'crescent')) return 'crescent';
  if (has(k, 'lance')) return 'lance';
  if (has(k, 'shard')) return 'shard';
  if (has(k, 'orb', 'barrage', 'deluge')) return k.def.element === 'ice' ? 'shard' : 'orb';
  if (has(k, 'blade') || k.weapon === 'sword') return 'sword';
  if (has(k, 'pierce') || k.weapon === 'dagger') return 'knife';
  switch (k.def.element) {
    case 'fire':
    case 'magma':
      return 'fireball';
    case 'ice':
      return 'shard';
    case 'holy':
      return 'star';
    case 'wind':
      return 'crescent';
    case 'water':
      return 'lance';
    case 'shadow':
      return 'wisp';
    default:
      break;
  }
  if (has(k, 'bolt')) return 'missile';
  return 'orb';
}

function motifProjectile(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const sh = k.def.shape.kind === 'projectile' ? k.def.shape : { count: 1, radial: false };
  const n = sh.count ?? 1;
  const obj = projObj(k);
  const bladed = obj === 'sword' || obj === 'knife';
  if (bladed) k.showsWeapon = true;
  const objFx = bladed ? (fx === R.steel || fx === R.dusk ? R.steel : fx) : fx;
  if (sh.radial) {
    const m = Math.min(n, 8);
    const rot = rng() * PI;
    spiral(c, 16, 16, 7, fx, rot, 2);
    ball(c, 16, 16, 2.6, fx);
    for (let i = 0; i < m; i++) {
      const a = rot + (i / m) * 2 * PI;
      if (bladed) object(c, 'blade', 16 + Math.cos(a) * 10.5, 16 + Math.sin(a) * 10.5, a, 9, objFx === R.steel ? R.steel : bladeRamp(objFx), rng);
      else object(c, obj, 16 + Math.cos(a) * 10, 16 + Math.sin(a) * 10, a, 8, objFx, rng);
    }
    return;
  }
  if (has(k, 'boomerang') || k.def.riders?.returns) {
    ring(c, 15, 17, 10, 11, (a, _d, x, y) => (a > 0.15 && (a < 0.5 || chk(x, y)) ? fx[4] : null), 120 * DEG, 270 * DEG);
    object(c, obj, 20, 10, -20 * DEG, 16, objFx, rng);
    seg(c, 5, 23, 8, 20, fx[5]);
    return;
  }
  if (n >= 8) {
    const ang = (100 + rng() * 15) * DEG;
    const cols = 3;
    for (let i = 0; i < Math.min(n, 9); i++) {
      const gx = i % cols;
      const gy = Math.floor(i / cols);
      const x = 7 + gx * 9 + (gy % 2) * 3 + rng() * 2;
      const y = 7 + gy * 8 + rng() * 2;
      streaks(c, x, y, ang, 1, 5, fx, rng);
      object(c, obj, x, y, ang, 8, objFx, rng);
    }
    return;
  }
  if (n >= 2 && !['sword', 'knife', 'feather', 'axe', 'hammer'].includes(obj)) {
    const m = Math.min(n, 5);
    const ang = (-36 - rng() * 8) * DEG;
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const spacing = m >= 5 ? 5.2 : m === 3 ? 7.5 : 9;
    for (let i = 0; i < m; i++) {
      const off = (i - (m - 1) / 2) * spacing;
      const stag = m > 2 ? (i % 2 ? -3 : 2) : 0;
      const x = 16 - dy * off + dx * stag;
      const y = 16 + dx * off + dy * stag;
      streaks(c, x, y, ang, 1, 8, fx, rng);
      object(c, obj, x, y, ang, m >= 5 ? 9 : 12, objFx, rng);
    }
    return;
  }
  if (n >= 2) {
    const m = Math.min(n, 5);
    const lo = -84;
    const hi = -6;
    const ox = 4;
    const oy = 28;
    const big = obj === 'crescent' || obj === 'feather' || obj === 'prism';
    for (let i = 0; i < m; i++) {
      const a = (lo + ((hi - lo) * (i + 0.5)) / m) * DEG;
      const d = m >= 5 ? 18 : 17;
      const x = ox + Math.cos(a) * d;
      const y = oy + Math.sin(a) * d;
      streaks(c, x, y, a, 1, 6, fx, rng);
      if (obj === 'knife' && m >= 4) object(c, 'blade', x, y, a, 11, objFx === R.steel ? R.steel : bladeRamp(objFx), rng);
      else object(c, obj, x, y, a, (m >= 5 ? 10 : 12) + (big ? 2 : 0), objFx, rng);
    }
    if (has(k, 'tether')) zap(c, 4, 28, 26, 6, ELEMENT_RAMPS.lightning, rng, 5, 1.5);
    return;
  }
  const ang = (-38 - rng() * 12) * DEG;
  const x = 17 + rng() * 2;
  const y = 15 - rng() * 2;
  streaks(c, x, y, ang, 3, 13, fx, rng);
  object(c, obj, x, y, ang, obj === 'net' ? 20 : 19, objFx, rng);
  if (has(k, 'tether')) zap(c, 4, 28, x - 2, y + 3, ELEMENT_RAMPS.lightning, rng, 4, 1.5);
  if (has(k, 'plasma')) zap(c, 6, 24, 24, 6, ELEMENT_RAMPS.lightning, rng, 4, 2);
}

type Head = { draw: (c: Ctx, x: number, y: number) => void; ghost: boolean };

function dashHead(k: SkillCtx): Head {
  const { fx, rng } = k;
  const solid = (draw: Head['draw']): Head => ({ draw, ghost: true });
  const loose = (draw: Head['draw']): Head => ({ draw, ghost: false });
  if (has(k, 'boulder', 'rockslide'))
    return solid((c, x, y) => {
      ball(c, x, y, 6.5, has(k, 'rockslide') ? R.stone : ELEMENT_RAMPS.earth);
      seg(c, x - 2, y - 5, x + 1, y + 1, has(k, 'rockslide') ? R.stone[1] : ELEMENT_RAMPS.earth[1]);
      seg(c, x + 1, y + 1, x + 4, y + 2, has(k, 'rockslide') ? R.stone[1] : ELEMENT_RAMPS.earth[1]);
    });
  if (has(k, 'millstone')) return solid((c, x, y) => millstone(c, x, y, 7.5));
  if (has(k, 'phantom') || (has(k, 'rush') && has(k, 'stealth'))) return solid((c, x, y) => ghost(c, x, y, 7, R.dusk.map((v, i) => (i > 2 ? mix(v, '#ffffff', 0.3) : v))));
  if (has(k, 'pounce', 'ambush', 'lunge')) return loose((c, x, y) => claws(c, x, y + 1, 18, has(k, 'ambush', 'lunge') ? R.cream : fx));
  if (has(k, 'shadowstep'))
    return loose((c, x, y) => {
      const portal = (px0: number, py0: number, rx: number): void =>
        paint(c, px0 - rx - 1, py0 - 4, px0 + rx + 1, py0 + 4, (qx, qy) => {
          const u = (qx - px0) / rx;
          const v = (qy - py0) / (rx * 0.45);
          const d = u * u + v * v;
          return d > 1 ? null : d > 0.55 ? (qy < py0 ? R.dusk[5] : R.dusk[4]) : '#0c0814';
        });
      portal(x - 13, y + 11, 6);
      portal(x + 3, y - 4, 6);
      ring(c, x - 5, y + 9, 10, 11, (a, _d, qx, qy) => (a > 0.1 && a < 0.9 && chk(qx, qy) ? R.dusk[5] : null), PI * 1.15, PI * 0.6);
      footprint(c, x - 4, y + 2, R.dusk[5]);
    });
  if (has(k, 'quickstep', 'quakestride'))
    return loose((c, x, y) => {
      boot(c, x - 6, y - 7, has(k, 'quakestride') ? R.stone : LEATHER, true);
      if (has(k, 'quickstep')) wing(c, x - 4, y - 4, R.cream, true);
    });
  if (has(k, 'shoulder', 'charge')) return solid((c, x, y) => shield(c, x, y, 12, 14, R.blood, R.iron));
  if (has(k, 'blink'))
    return loose((c, x, y) => {
      ring(c, x, y, 4, 6.5, (a) => (a < 0.5 ? fx[5] : fx[3]));
      star4(c, x, y, 2, fx);
      star4(c, x - 9, y + 7, 2, fx);
    });
  if (has(k, 'dive')) return loose((c, x, y) => bolt(c, x - 6, y - 10, 1.15, fx));
  if (has(k, 'flare')) return loose((c, x, y) => object(c, 'fireball', x, y, -18 * DEG, 17, fx, rng));
  if (has(k, 'eclipse'))
    return solid((c, x, y) => {
      ball(c, x, y, 6.5, R.gold);
      dot(c, x + 2, y - 1, 5.5, R.violet[1]);
    });
  if (has(k, 'spin', 'waltz'))
    return loose((c, x, y) => {
      spiral(c, x - 1, y + 1, 10, fx, rng() * 2 * PI, 3);
      if (k.weapon === 'sword' || has(k, 'blade')) swordAt(c, x - 5, y + 5, -45 * DEG, 10);
      else if (k.weapon === 'dagger') daggerAt(c, x - 4, y + 4, -45 * DEG, 8);
      else ball(c, x - 1, y + 1, 2.4, fx);
    });
  if (k.weapon === 'dagger') return solid((c, x, y) => daggerAt(c, x - 4, y + 2, -18 * DEG, 11));
  if (k.weapon === 'sword' || has(k, 'blade')) return solid((c, x, y) => swordAt(c, x - 7, y + 2, -18 * DEG, 15, fx === R.steel ? R.steel : bladeRamp(fx)));
  if (k.weapon === 'staff') return solid((c, x, y) => staffAt(c, x - 8, y + 2, -18 * DEG, 14, fx));
  return loose((c, x, y) => {
    for (let i = 0; i < 2; i++) {
      const ox = x - 3 + i * 6;
      fpoly(c, [ox - 3, y - 6, ox + 3, y, ox - 3, y + 6, ox, y], i ? fx[5] : fx[4]);
    }
  });
}

function motifDash(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const ang = (-14 - rng() * 10) * DEG;
  const hx = 21;
  const hy = 14 + rng() * 2;
  const head = dashHead(k);
  if (/^(sword|dagger|staff)$/.test(k.weapon ?? '') || has(k, 'blade')) k.showsWeapon = true;
  if (head.ghost) {
    ghostOf(c, (l) => head.draw(l, hx, hy), -12, 3.5, fx[1]);
    ghostOf(c, (l) => head.draw(l, hx, hy), -6, 1.5, fx[2]);
  }
  streaks(c, hx - 5, hy + 2, ang, 4, 14, fx, rng, 3);
  head.draw(c, hx, hy);
  if (has(k, 'quakestride', 'rockslide', 'millstone')) {
    seg(c, 4, 27, 28, 27, R.stone[3]);
    for (let i = 0; i < 3; i++) spike(c, 8 + i * 7, 27, 4, 3 + rng() * 3, R.stone);
  }
  if (has(k, 'fire', 'ashen', 'ember') && !has(k, 'flare')) {
    for (let i = 0; i < 3; i++) flame(c, 5 + i * 5, 28, 4, 6 + rng() * 3, ELEMENT_RAMPS.fire);
  }
}

function motifNova(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const cx = 16;
  const cy = 17;
  if (has(k, 'quake', 'earthsplitter', 'spikes', 'stomp', 'mallet', 'worldbreaker', 'runeknight') || (has(k, 'earth') && !has(k, 'maw'))) {
    const ground = has(k, 'earth', 'quake', 'spikes', 'mallet') ? ELEMENT_RAMPS.earth : R.stone;
    rock(c, [2, 25, 8, 23, 16, 24, 24, 22, 30, 24, 30, 29, 2, 29], ground, 16, 26);
    const crystal = has(k, 'spikes', 'mallet', 'geode') ? R.violet : ground;
    spike(c, 9, 24, 6, 10 + rng() * 3, crystal);
    spike(c, 22, 24, 6, 9 + rng() * 3, crystal);
    spike(c, 15.5, 24, 7, 14, crystal);
    seg(c, 16, 24, 13, 29, OUT);
    seg(c, 16, 24, 19, 29, OUT);
    if (has(k, 'stomp')) {
      ring(c, 16, 12, 9, 10, fx[4], PI + 0.3, PI - 0.6);
      footprint(c, 13, 3, fx[4]);
    }
    if (has(k, 'mallet')) hammerAt(c, 22, 9, -135 * DEG, 12);
    if (has(k, 'worldbreaker')) {
      swordAt(c, 16, 6, 90 * DEG, 15);
      k.showsWeapon = true;
    }
    if (has(k, 'runeknight')) {
      ring(c, 16, 10, 5, 6.2, R.arcane[4]);
      px(c, 16, 10, R.arcane[5]);
    }
    if (has(k, 'lightning', 'thunder')) zap(c, 6, 4, 14, 18, ELEMENT_RAMPS.lightning, rng, 3, 1.5);
    for (let i = 0; i < 4; i++) rect(c, 4 + rng() * 24, 6 + rng() * 10, 2, 2, ground[4]);
    return;
  }
  if (has(k, 'gravity', 'singularity', 'maw')) {
    for (let i = 0; i < 3; i++) swoosh(c, cx, cy, 13 - i * 3, 2.4, rng() * 2 * PI + i * 2.1, 230 * DEG, has(k, 'maw') ? R.violet : fx, { fade: true, head: 0.5 });
    dot(c, cx, cy, 4, '#0c0814');
    ring(c, cx, cy, 4, 5, fx[5]);
    if (has(k, 'maw')) for (let i = 0; i < 5; i++) {
      const a = (i / 5) * 2 * PI;
      spike(c, cx + Math.cos(a) * 9, cy + Math.sin(a) * 9 + 2, 3, 5, R.violet);
    }
    return;
  }
  if (has(k, 'meteor')) {
    object(c, 'fireball', 21, 10, 135 * DEG, 18, fx, rng);
    ring(c, 12, 25, 3, 4, fx[4], PI, PI);
    ring(c, 12, 25, 6, 7, fx[3], PI, PI);
    rect(c, 3, 26, 26, 2, R.stone[3]);
    return;
  }
  if (has(k, 'smoke', 'veil', 'shroud', 'gloom', 'moonveil')) {
    const puff = has(k, 'moonveil') ? R.cream : R.dusk;
    if (has(k, 'moonveil')) moon(c, 11, 10, 7, ELEMENT_RAMPS.holy);
    cloud(c, 10, 21, 17, puff);
    cloud(c, 22, 18, 16, puff);
    if (has(k, 'gloom')) eye(c, 16, 19, 6, R.violet, R.blood);
    if (has(k, 'smoke')) daggerAt(c, 19, 13, -60 * DEG, 11);
    if (has(k, 'moonveil')) for (let i = 0; i < 3; i++) star4(c, 20 + i * 4, 5 + (i % 2) * 4, 1, ELEMENT_RAMPS.holy);
    return;
  }
  if (has(k, 'starfall', 'lattice')) {
    for (const [x, y] of [[8, 8], [22, 6], [14, 15], [25, 18], [7, 22]]) {
      seg(c, x, y, x - 5, y - 5, (i) => (i % 2 ? fx[3] : null));
      star4(c, x, y, 3, fx);
    }
    seg(c, 8, 8, 14, 15, fx[3]);
    seg(c, 14, 15, 25, 18, fx[3]);
    seg(c, 22, 6, 14, 15, fx[3]);
    return;
  }
  if (has(k, 'storm', 'thunder', 'lightning') && !has(k, 'ascendant')) {
    cloud(c, 16, 10, 14, ELEMENT_RAMPS.storm);
    zap(c, 10, 15, 7, 28, ELEMENT_RAMPS.lightning, rng, 3, 2);
    zap(c, 19, 15, 23, 28, ELEMENT_RAMPS.lightning, rng, 3, 2);
    return;
  }
  if (has(k, 'lunar', 'moon')) {
    moon(c, 14, 14, 9, fx);
    for (let i = 0; i < 5; i++) star4(c, 18 + rng() * 10, 6 + rng() * 20, 1 + Math.round(rng()), fx);
    return;
  }
  if (has(k, 'jelly')) {
    paint(c, 4, 10, 28, 28, (x, y) => {
      const u = (x - 16) / 11;
      const v = (y - 24) / 12;
      if (v > 0.25 || u * u + v * v > 1) return null;
      return x < 13 && y < 19 ? R.spirit[5] : y > 24 ? R.spirit[2] : R.spirit[4];
    });
    px(c, 13, 20, OUT);
    px(c, 19, 20, OUT);
    for (let i = 0; i < 4; i++) dot(c, 4 + i * 8, 8 + (i % 2) * 3, 1.3, R.spirit[4]);
    return;
  }
  if (has(k, 'crown')) {
    ring(c, cx, 22, 9, 10.5, fx[4], PI, PI);
    crown(c, cx, 20, 14, R.gold, R.blood[4]);
    for (let i = 0; i < 4; i++) rect(c, 4 + i * 7, 26, 3, 2, R.stone[3]);
    return;
  }
  if (has(k, 'spore')) {
    mushroom(c, 16, 26, 6, R.blood);
    for (let i = 0; i < 9; i++) dot(c, 5 + rng() * 22, 4 + rng() * 14, 1, R.venom[4]);
    return;
  }
  if (has(k, 'mimic')) {
    burst(c, cx, cy, 13, fx, 8, rng());
    mask(c, cx, cy, R.cream);
    return;
  }
  if (has(k, 'glob', 'magma')) {
    ball(c, cx, cy + 2, 6, fx);
    for (let i = 0; i < 6; i++) {
      const a = -PI + (i / 5) * PI;
      dot(c, cx + Math.cos(a) * 11, cy + 2 + Math.sin(a) * 9, 1.6, fx[4]);
    }
    return;
  }
  burst(c, cx, cy, 13, fx, has(k, 'archmage', 'ascendant') ? 12 : 8, rng() * 0.8);
  ring(c, cx, cy, 10.5, 11.5, (_a, _d, x, y) => (chk(x, y) ? fx[4] : null));
  if (has(k, 'ascendant')) {
    wing(c, 20, 13, R.cream);
    wing(c, 12, 13, R.cream, true);
  }
}

function motifChain(c: Ctx, k: SkillCtx): void {
  const { fx, rng } = k;
  const sh = k.def.shape.kind === 'chain' ? k.def.shape : { jumps: 2 };
  const javelin = has(k, 'javelin');
  const pts: [number, number][] = javelin
    ? [[18, 13], [26, 6 + rng() * 2], [25, 21 + rng() * 2]]
    : [[7, 24], [15 + rng() * 2, 8 + rng() * 2], [25, 15 + rng() * 3]];
  if ((sh.jumps ?? 2) >= 3) pts.push(javelin ? [13, 26] : [19 + rng() * 2, 26]);
  const electric = has(k, 'lightning', 'storm', 'static', 'thunder', 'zap');
  const bolts = electric ? ELEMENT_RAMPS.lightning : fx;
  const knives = has(k, 'knives', 'needles', 'ricochet');
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    if (electric || !knives) zap(c, ax, ay, bx, by, bolts, rng, 3, 2.2, true);
    else {
      seg(c, ax, ay, bx, by, (j) => (j % 3 === 2 ? null : bolts[4]));
      seg(c, ax + 1, ay, bx + 1, by, (j) => (j % 3 === 2 ? null : bolts[3]));
    }
  }
  if (javelin) {
    along(c, 4, 28, -45 * DEG, 0, 15, () => 0.9, shadeAcross(R.wood, -45 * DEG, 5, 4, 2));
    object(c, 'lance', 15, 17, -45 * DEG, 10, R.steel, rng);
    k.showsWeapon = true;
  }
  pts.forEach(([x, y], i) => {
    if (i === 0 && !javelin) {
      if (has(k, 'palm')) palm(c, x - 5, y - 4, R.cream);
      else if (knives) object(c, has(k, 'needles') ? 'nail' : 'knife', x, y, -60 * DEG, 10, R.steel, rng);
      else ball(c, x, y, 3.6, bolts);
      return;
    }
    if (i === 0) return;
    if (knives) {
      object(c, has(k, 'needles') ? 'nail' : 'knife', x, y, (i * 70 - 40) * DEG, 9, R.steel, rng);
      k.showsWeapon = true;
    } else star4(c, x, y, 3, bolts);
  });
  if (has(k, 'gyre')) spiral(c, 16, 17, 7, fx, 0, 2);
  if (has(k, 'charge') && has(k, 'static')) {
    fpoly(c, [10, 12, 14, 12, 14, 18, 18, 18, 18, 12, 22, 12, 22, 19, 16, 23, 10, 19], (x) => (x < 16 ? R.blood[4] : R.blood[3]));
    rect(c, 10, 11, 4, 2, R.steel[5]);
    rect(c, 18, 11, 4, 2, R.steel[5]);
  }
}

const STAT_AURA: Readonly<Record<string, Ramp>> = {
  atk: ['#3a1410', '#7a2a16', '#b8501e', '#e08a3a', '#f8c070', '#fff0c8'],
  def: R.gold,
  speed: R.teal,
  crit: R.blood,
  regen: R.leaf,
  matk: R.arcane,
};

function motifBuff(c: Ctx, k: SkillCtx): void {
  const { rng } = k;
  const stat = k.def.shape.kind === 'buff' ? k.def.shape.stat : 'atk';
  // unaligned stances glow in their stat's colour (steel auras read as noise)
  const fx = k.fx === R.steel ? (STAT_AURA[stat] ?? k.fx) : k.fx;
  // aura: a glowing ground ring and spirit-flame tongues rising around the emblem
  paint(c, 3, 20, 29, 30, (x, y) => {
    const u = (x - 16) / 12;
    const v = (y - 25.5) / 3.4;
    const d = u * u + v * v;
    return d <= 1 && d > 0.5 ? (y < 25 ? fx[3] : fx[4]) : null;
  });
  for (const [x, h, w] of [[5.5, 10, 4], [10, 13, 4.5], [22, 13, 4.5], [26.5, 10, 4]] as const) {
    flame(c, x, 26.5, w, h + rng() * 3, fx, x < 16 ? -1 : 1);
  }
  const cx = 16;
  const cy = 14;
  if (has(k, 'horn', 'rally')) {
    horn(c, 6, 21, R.bone, 0.95);
    for (const [a, l0] of [[-80, 3], [-40, 4], [0, 3]] as const) {
      const ax = 25 + Math.cos(a * DEG) * 4;
      const ay = 12 + Math.sin(a * DEG) * 4;
      seg(c, ax, ay, ax + Math.cos(a * DEG) * l0, ay + Math.sin(a * DEG) * l0, R.gold[5]);
    }
  }
  else if (has(k, 'searing')) {
    flame(c, 16, 22, 10, 17, ELEMENT_RAMPS.fire);
    swordAt(c, 16, 22, -90 * DEG, 15, bladeRamp(ELEMENT_RAMPS.fire));
  } else if (has(k, 'cloak', 'shade')) {
    paint(c, 8, 4, 24, 26, (x, y) => {
      const u = (x - 16) / (5 + (y - 5) * 0.32);
      if (y < 5 || Math.abs(u) > 1) return null;
      if (y < 15 && Math.hypot(x - 16, y - 11) < 3.6) return '#0c0814';
      return u < -0.3 ? R.dusk[4] : u < 0.4 ? R.dusk[3] : R.dusk[2];
    });
    px(c, 15, 11, R.blood[4]);
    px(c, 17, 11, R.blood[4]);
  } else if (stat === 'atk') swordAt(c, cx, 23, -90 * DEG, 17);
  else if (stat === 'def') {
    shield(c, cx, cy, 15, 17, has(k, 'halo') ? R.cream : fx, R.gold);
    if (has(k, 'arcane', 'ward') && !has(k, 'halo')) {
      ring(c, cx, cy - 1, 3, 4.2, fx[5]);
    } else {
      rect(c, cx - 1, cy - 5, 2, 9, R.gold[4]);
      rect(c, cx - 4, cy - 2, 8, 2, R.gold[4]);
    }
    if (has(k, 'halo')) ring(c, cx, 3.5, 4, 5, R.gold[4], 0, 2 * PI);
  } else if (stat === 'speed') {
    hourglass(c, cx, cy, R.gold);
    wing(c, cx + 6, cy - 6, R.cream);
    wing(c, cx - 6, cy - 6, R.cream, true);
  } else if (stat === 'crit') eye(c, cx, cy, 7, R.bone, R.blood);
  else if (stat === 'regen') {
    if (has(k, 'meditation')) lotus(c, cx, cy + 5, R.rose);
    else if (has(k, 'sanctuary')) {
      fpoly(c, [cx - 7, cy + 8, cx - 7, cy - 1, cx, cy - 8, cx + 7, cy - 1, cx + 7, cy + 8], (x) => (x < cx ? R.cream[5] : R.cream[3]));
      fpoly(c, [cx - 2.5, cy + 8, cx - 2.5, cy + 2, cx, cy - 0.5, cx + 2.5, cy + 2, cx + 2.5, cy + 8], R.gold[2]);
      rect(c, cx - 0.5, cy - 12, 1, 4, R.gold[4]);
      rect(c, cx - 2, cy - 11, 4, 1, R.gold[4]);
    } else {
      heart(c, cx, cy, 4.2, R.blood);
      rect(c, cx - 1, cy - 3, 2, 6, R.cream[5]);
      rect(c, cx - 3, cy - 1, 6, 2, R.cream[5]);
    }
  } else {
    // matk
    if (has(k, 'astral')) planet(c, cx, cy, 6, fx, R.gold);
    else if (has(k, 'surge', 'mana')) {
      object(c, 'shard', cx, cy, -90 * DEG, 18, fx, rng);
    } else eye(c, cx, cy, 8, R.bone, fx);
  }
  // little up-chevrons
  for (const sx of [4, 26]) {
    px(c, sx, 9, fx[5]);
    px(c, sx - 1, 10, fx[5]);
    px(c, sx + 1, 10, fx[5]);
    px(c, sx - 2, 11, fx[4]);
    px(c, sx + 2, 11, fx[4]);
  }
}

/** Element flourishes added on the motif layer (embers, droplets, flakes …). */
function flourish(c: Ctx, k: SkillCtx): void {
  const el = k.def.element;
  if (!el) return;
  const { rng, fx } = k;
  const img = c.getImageData(0, 0, 32, 32).data;
  const free = (x: number, y: number): boolean => {
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        const X = x + i;
        const Y = y + j;
        if (X < 3 || Y < 3 || X > 28 || Y > 28) return false;
        if (img[(Y * 32 + X) * 4 + 3] > 0) return false;
      }
    return true;
  };
  let placed = 0;
  for (let tries = 0; tries < 40 && placed < 3; tries++) {
    const x = 4 + Math.floor(rng() * 24);
    const y = 4 + Math.floor(rng() * 24);
    if (!free(x, y)) continue;
    placed++;
    switch (el) {
      case 'fire':
      case 'magma':
        px(c, x, y, fx[4]);
        px(c, x, y - 1, fx[5]);
        break;
      case 'water':
        dot(c, x, y, 1, fx[4]);
        break;
      case 'ice':
        px(c, x, y, fx[5]);
        px(c, x - 1, y, fx[4]);
        px(c, x + 1, y, fx[4]);
        px(c, x, y - 1, fx[4]);
        px(c, x, y + 1, fx[4]);
        break;
      case 'wind':
        rect(c, x, y, 2, 1, fx[4]);
        px(c, x + 1, y - 1, fx[5]);
        break;
      case 'earth':
        rect(c, x, y, 2, 2, fx[3]);
        px(c, x, y, fx[5]);
        break;
      case 'lightning':
      case 'storm':
        px(c, x, y, fx[5]);
        px(c, x + 1, y + 1, fx[4]);
        px(c, x, y + 2, fx[4]);
        break;
      default:
        px(c, x, y, fx[5]);
        px(c, x + 1, y, fx[4]);
        px(c, x - 1, y, fx[4]);
        px(c, x, y + 1, fx[4]);
        px(c, x, y - 1, fx[4]);
    }
  }
}

/** Paints a full skill tile (backdrop, motif, rim) for `def`; `seedId` drives the per-skill variation. */
function paintSkill(c: Ctx, def: SkillDef, seedId: string): void {
  const rng = artRng(keySeed('icon:' + seedId));
  const { fx, bg } = skillRamps(def);
  const tags = new Set(def.tags);
  const pattern = tags.has('aoe') ? 1 : def.shape.kind === 'projectile' || def.shape.kind === 'dash' ? 2 : rng() < 0.5 ? 0 : 3;
  tileBack(c, bg, pattern);
  const k: SkillCtx = {
    def,
    w: words(def),
    fx,
    rng,
    weapon: def.weapons?.[0],
    showsWeapon: false,
  };
  onLayer(c, (l) => {
    switch (def.shape.kind) {
      case 'strike':
        motifStrike(l, k);
        break;
      case 'spin':
        motifSpin(l, k);
        break;
      case 'projectile':
        motifProjectile(l, k);
        break;
      case 'dash':
        motifDash(l, k);
        break;
      case 'nova':
        motifNova(l, k);
        break;
      case 'chain':
        motifChain(l, k);
        break;
      case 'buff':
        motifBuff(l, k);
        break;
    }
    flourish(l, k);
  });
  if (k.weapon && !k.showsWeapon) weaponBadge(c, k.weapon, fx);
  tileFrame(c, def.tier, fx);
}

// ------------------------------------------------------------------ element glyphs

function paintElement(c: Ctx, id: ElementId | 'generic'): void {
  const rp = id === 'generic' ? R.arcane : ELEMENT_RAMPS[id];
  onLayer(c, (l) => {
    switch (id) {
      case 'fire':
        flame(l, 9, 28, 9, 13, rp, -2);
        flame(l, 23, 28, 9, 12, rp, 2);
        flame(l, 16, 29, 17, 26, rp, 1);
        break;
      case 'water':
        droplet(l, 15, 29, 9, 27, rp);
        droplet(l, 26, 12, 2.4, 7, rp);
        break;
      case 'earth': {
        fpoly(l, [1, 29, 4, 22, 7, 18, 11, 9, 13, 12, 15, 13, 20, 3, 23, 8, 25, 11, 27, 18, 31, 29], (x, y) => {
          const big = x >= 15 || (x > 12.5 && y < 13);
          const px0 = big ? 20 : 11;
          const py0 = big ? 3 : 9;
          const lit = x < px0 + (y - py0) * 0.2;
          if (y < py0 + 3) return lit ? rp[5] : rp[3];
          if (y > 26) return lit ? rp[3] : rp[1];
          return lit ? rp[4] : rp[2];
        });
        for (const [x0, y0, x1, y1] of [[8, 19, 10, 19], [16, 15, 18, 15], [14, 22, 17, 22], [5, 25, 7, 25], [22, 13, 23, 13]]) seg(l, x0, y0, x1, y1, rp[2]);
        for (const [x, y] of [[9, 18], [17, 14], [15, 21]]) px(l, x, y, rp[5]);
        rock(l, [20, 30, 21, 25, 25, 23, 30, 26, 30, 30], R.stone, 25, 26);
        for (const [x, h] of [[3, 4], [5, 3], [7, 5]] as const) rect(l, x, 30 - h, 1, h, R.leaf[4]);
        px(l, 7, 25, R.leaf[5]);
        break;
      }
      case 'wind':
        rect(l, 6, 8, 14, 1, rp[5]);
        rect(l, 6, 9, 14, 1, rp[4]);
        ring(l, 20, 5.5, 1.6, 3.6, rp[4], PI, 1.5 * PI);
        rect(l, 2, 15, 23, 1, rp[5]);
        rect(l, 2, 16, 23, 1, rp[4]);
        ring(l, 25, 18.5, 1.6, 3.6, rp[4], 1.5 * PI, 1.5 * PI);
        rect(l, 9, 23, 10, 1, rp[5]);
        rect(l, 9, 24, 10, 1, rp[3]);
        ring(l, 19, 20.5, 1.6, 3.6, rp[4], PI, 1.5 * PI);
        along(l, 9, 27, -30 * DEG, -3.5, 3.5, (s) => 1.6 * Math.cos((s / 3.5) * (PI / 2)) + 0.2, shadeAcross(R.leaf, -30 * DEG, 5, 4, 2));
        along(l, 28, 10, 200 * DEG, -3, 3, (s) => 1.4 * Math.cos((s / 3) * (PI / 2)) + 0.2, shadeAcross(R.leaf, 200 * DEG, 5, 4, 2));
        break;
      case 'lightning':
        bolt(l, 6, 2, 1.65, rp);
        break;
      case 'shadow': {
        const dark: Ramp = [rp[0], rp[1], rp[4], rp[3], rp[1], '#0c0814'];
        flame(l, 8, 29, 7, 12, dark, -2);
        flame(l, 24, 29, 7, 11, dark, 2);
        flame(l, 16, 30, 18, 28, dark, 1);
        rect(l, 13, 20, 2, 1, rp[5]);
        rect(l, 18, 20, 2, 1, rp[5]);
        break;
      }
      case 'holy':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 2 * PI - PI / 2;
          const L = i % 2 ? 11 : 15;
          along(l, 16, 16, a, 4, L, (s) => 2.2 * (1 - (s - 4) / (L - 4)) + 0.3, (s) => (s < L * 0.6 ? rp[5] : rp[4]));
        }
        ball(l, 16, 16, 5.5, rp);
        break;
      case 'ice':
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * 2 * PI - PI / 2;
          along(l, 16, 16, a, 0, 13, () => 1, (s) => (s > 10 ? rp[5] : rp[4]));
          for (const side of [-1, 1]) {
            const bx = 16 + Math.cos(a) * 8;
            const by = 16 + Math.sin(a) * 8;
            along(l, bx, by, a + side * 0.9, 0, 4, () => 0.7, () => rp[4]);
          }
        }
        ball(l, 16, 16, 3, rp);
        break;
      case 'magma':
        rock(l, [3, 26, 6, 13, 13, 7, 22, 8, 28, 15, 29, 26, 20, 30, 10, 30], R.stone.map((v, i) => mix(v, '#3a1a10', 0.35 + i * 0.02)), 15, 17);
        for (const [x0, y0, x1, y1] of [[9, 12, 14, 18], [14, 18, 12, 26], [14, 18, 22, 16], [22, 16, 25, 23], [18, 9, 22, 16]]) {
          seg(l, x0, y0, x1, y1, rp[4]);
          seg(l, x0 + 1, y0, x1 + 1, y1, rp[3]);
        }
        dot(l, 14, 18, 1.5, rp[5]);
        droplet(l, 25, 31, 1.8, 6, rp);
        break;
      case 'storm':
        for (const x of [5, 9, 24, 28]) seg(l, x, 18, x - 3, 26, (i) => (i % 3 === 2 ? null : rp[4]));
        cloud(l, 16, 11, 21, rp);
        bolt(l, 11, 13, 1.05, ELEMENT_RAMPS.lightning);
        break;
      case 'twilight':
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 2 * PI;
          along(l, 16, 16, a, 9, 14, (s) => 1.4 * (1 - (s - 9) / 5) + 0.3, () => (Math.cos(a) < 0 ? ELEMENT_RAMPS.holy[4] : rp[4]));
        }
        paint(l, 6, 6, 26, 26, (x, y) => {
          const d = Math.hypot(x - 16, y - 16);
          if (d > 8.5) return null;
          if (x < 16) return d > 7.4 ? ELEMENT_RAMPS.holy[2] : x < 12 ? ELEMENT_RAMPS.holy[5] : ELEMENT_RAMPS.holy[4];
          return d > 7.4 ? rp[1] : x > 20 ? rp[2] : rp[3];
        });
        moon(l, 19, 16, 4, rp, 0.6, 0);
        break;
      default:
        ball(l, 16, 16, 11, rp);
        star4(l, 16, 16, 4, rp);
    }
  });
}

// ------------------------------------------------------------------ essence rune-stones

function essenceGlyph(c: Ctx, id: string, rp: Ramp): void {
  const a = rp[5];
  const b = rp[4];
  switch (id) {
    case 'split':
      rect(c, 15, 17, 2, 7, b);
      seg(c, 16, 17, 10, 11, a);
      seg(c, 15, 17, 9, 11, b);
      rect(c, 15, 9, 2, 8, a);
      seg(c, 16, 17, 22, 11, a);
      seg(c, 17, 17, 23, 11, b);
      for (const [x, y] of [[9, 10], [15, 8], [22, 10]]) bitmap(c, x - 1, y - 1, ['.#.', '###'], a);
      break;
    case 'flurry':
      for (let i = 0; i < 3; i++) along(c, 10 + i * 5, 16 + (i - 1) * 1, -60 * DEG, -6, 6, (s) => 1.2 * Math.cos((s / 6) * (PI / 2)) + 0.2, (_s, t) => (t < 0 ? a : b));
      break;
    case 'arc':
      for (const [x, y] of [[9, 20], [16, 12], [23, 20]]) {
        ring(c, x, y, 1.5, 2.8, a);
      }
      ring(c, 12.5, 18, 3.4, 4.4, b, PI * 1.1, PI * 0.6);
      ring(c, 19.5, 18, 3.4, 4.4, b, PI * 1.3, PI * 0.6);
      break;
    case 'pierce':
      rect(c, 15, 8, 2, 6, rp[3]);
      rect(c, 15, 18, 2, 6, rp[3]);
      rect(c, 8, 15, 13, 2, a);
      bitmap(c, 20, 13, ['#..', '##.', '###', '##.', '#..'], a);
      rect(c, 8, 14, 2, 1, b);
      rect(c, 8, 17, 2, 1, b);
      break;
    case 'return':
      ring(c, 16, 16, 5, 7, (t) => (t > 0.15 ? a : b), -PI * 0.1, PI * 1.35);
      bitmap(c, 20, 9, ['####', '.###', '..##', '...#'], a);
      break;
    case 'reprise':
      ring(c, 16, 16, 5, 7, a, PI * 0.15, PI * 0.8);
      ring(c, 16, 16, 5, 7, b, PI * 1.15, PI * 0.8);
      bitmap(c, 9, 7, ['#...', '##..', '###.'], a);
      bitmap(c, 20, 22, ['.###', '..##', '...#'], b);
      break;
    case 'expanse':
      ring(c, 16, 16, 1.5, 3, a);
      ring(c, 16, 16, 5.5, 6.6, b);
      ring(c, 16, 16, 9, 10, (_t, _d, x, y) => (chk(x, y) ? a : null));
      break;
    case 'haste':
      for (let i = 0; i < 2; i++) {
        const x = 11 + i * 6;
        fpoly(c, [x - 3, 9, x + 2, 9, x + 7, 16, x + 2, 23, x - 3, 23, x + 2, 16], i ? a : b);
      }
      break;
    case 'heavy':
      fpoly(c, [9, 23, 11, 13, 21, 13, 23, 23], (x) => (x < 14 ? a : b));
      ring(c, 16, 11, 2, 3.4, b, PI, PI);
      rect(c, 9, 22, 14, 2, rp[3]);
      break;
    case 'leech':
      droplet(c, 16, 24, 5, 16, R.blood);
      fpoly(c, [12, 9, 14, 9, 13, 14], R.bone[5]);
      fpoly(c, [18, 9, 20, 9, 19, 14], R.bone[5]);
      break;
    default:
      star4(c, 16, 16, 5, rp);
  }
}

function paintEssence(c: Ctx, e: EssenceDef | undefined): void {
  const rp = e ? ESSENCE_RAMPS[e.category] : ESSENCE_RAMPS.repeat;
  const stone = R.stone.map((v) => mix(v, rp[1], 0.28));
  const hex = (inset: number): number[] => [16, 1 + inset, 29 - inset, 8.5 + inset * 0.6, 29 - inset, 23.5 - inset * 0.6, 16, 31 - inset, 3 + inset, 23.5 - inset * 0.6, 3 + inset, 8.5 + inset * 0.6];
  onLayer(c, (l) => {
    fpoly(l, hex(0), (x, y) => {
      const u = (x - 16) + (y - 16) * 0.8;
      return u < -6 ? stone[5] : u < 2 ? stone[4] : u < 9 ? stone[3] : stone[2];
    });
    fpoly(l, hex(3.2), (x, y) => (chk(x, y) && Math.hypot(x - 16, y - 16) > 8 ? rp[0] : mix(rp[0], rp[1], 0.6)));
    const g = scratch(32, 32);
    essenceGlyph(g.c, e?.id ?? 'generic', rp);
    // glow: dilate the glyph by one pixel in a mid tone
    const d = g.c.getImageData(0, 0, 32, 32).data;
    l.fillStyle = rp[2];
    for (let y = 1; y < 31; y++)
      for (let x = 1; x < 31; x++) {
        if (d[(y * 32 + x) * 4 + 3] > 0) continue;
        if (d[(y * 32 + x + 1) * 4 + 3] || d[(y * 32 + x - 1) * 4 + 3] || d[((y + 1) * 32 + x) * 4 + 3] || d[((y - 1) * 32 + x) * 4 + 3]) l.fillRect(x, y, 1, 1);
      }
    l.drawImage(g.el, 0, 0);
    release(g);
    px(l, 16, 3, stone[5]);
    px(l, 6, 9, stone[5]);
  });
}

// ------------------------------------------------------------------ pips (12x12)

const EL_PIP: Readonly<Record<string, readonly string[]>> = {
  fire: ['..#..', '.##..', '.###.', '#####', '.###.'],
  water: ['..#..', '..#..', '.###.', '#####', '.###.'],
  earth: ['.....', '..#..', '.###.', '#####', '#####'],
  wind: ['####.', '....#', '.###.', '#....', '.####'],
  lightning: ['..##.', '.##..', '####.', '..##.', '.##..'],
  shadow: ['.###.', '##...', '#....', '##...', '.###.'],
  holy: ['..#..', '.###.', '#####', '.###.', '..#..'],
  ice: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  magma: ['.#.#.', '#####', '##.##', '#####', '.###.'],
  storm: ['.###.', '#####', '..#..', '.#...', '#....'],
  twilight: ['.###.', '##.##', '#..##', '##.##', '.###.'],
};

const MOD_PIP: Readonly<Record<string, readonly string[]>> = {
  split: ['#.#.#', '.###.', '..#..', '..#..', '..#..'],
  flurry: ['..#.#', '.#.#.', '#.#..', '.#...', '#....'],
  arc: ['#...#', '.#.#.', '..#..', '.....', '.....'],
  pierce: ['..#..', '..#..', '#####', '..#..', '..#..'],
  return: ['.###.', '#...#', '#..#.', '#.###', '.....'],
  reprise: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
  expanse: ['#.#.#', '.....', '#.#.#', '.....', '#.#.#'],
  haste: ['#..#.', '.#..#', '..#..', '.#..#', '#..#.'],
  heavy: ['..#..', '.###.', '.###.', '#####', '#####'],
  leech: ['..#..', '.###.', '#####', '#####', '.###.'],
};

function paintElementPip(c: Ctx, id: string, ox = 0, oy = 0, size = PIP_SIZE): void {
  const rp = ELEMENT_RAMPS[id as ElementId] ?? R.arcane;
  const cx = ox + size / 2;
  const cy = oy + size / 2;
  onLayer(c, (l) => ball(l, cx, cy, size / 2 - 1, rp, false));
  const glyph = EL_PIP[id] ?? ['..#..', '.###.', '#####', '.###.', '..#..'];
  const gx = Math.round(cx - 2.5);
  const gy = Math.round(cy - 2.5);
  // light glyph on dark orbs, dark glyph on the bright ones (holy, lightning)
  bitmap(c, gx, gy, glyph, id === 'holy' || id === 'lightning' ? rp[1] : mix(rp[5], '#ffffff', 0.4));
}

function paintModPip(c: Ctx, e: EssenceDef | undefined, ox = 0, oy = 0, size = PIP_SIZE): void {
  const rp = e ? ESSENCE_RAMPS[e.category] : ESSENCE_RAMPS.repeat;
  const k = size / 12;
  const hex = [6, 1, 11, 3.5, 11, 8.5, 6, 11, 1, 8.5, 1, 3.5].map((v, i) => v * k + (i % 2 ? oy : ox));
  onLayer(c, (l) => fpoly(l, hex, (x, y) => (x - ox + (y - oy) < size - 1 ? rp[3] : rp[2])));
  const g = Math.round(size / 2 - 2.5);
  bitmap(c, ox + g, oy + g, MOD_PIP[e?.id ?? ''] ?? ['..#..', '.###.', '#####', '.###.', '..#..'], rp[5]);
}

// ------------------------------------------------------------------ class crests

interface ClassLook {
  main: Ramp;
  glyph: (c: Ctx) => void;
}

/** A class's signature colour (#rrggbb) for tinting class slots / outfit previews; neutral stone if unknown. */
export function classColor(id: string): string {
  return classLook(id).main[3];
}

function classLook(id: string): ClassLook {
  const E = ELEMENT_RAMPS;
  const sw = (c: Ctx, blade: Ramp = R.steel): void => swordAt(c, 10, 22, -45 * DEG, 13, blade);
  switch (id) {
    case 'blademaster':
      return { main: R.blood, glyph: (c) => { sw(c); swordAt(c, 22, 22, -135 * DEG, 13); } };
    case 'tempest_dancer':
      return { main: E.wind, glyph: (c) => spiral(c, 16, 15, 9, E.wind.map((v, i) => (i > 3 ? '#ffffff' : v)), 0.5) };
    case 'pyroblade':
      return { main: E.fire, glyph: (c) => { flame(c, 16, 23, 10, 15, E.fire); sw(c, bladeRamp(E.fire)); } };
    case 'shadowstalker':
      return { main: R.dusk, glyph: (c) => { moon(c, 16, 15, 8, R.bone, 0.45, -0.25); eye(c, 15, 16, 3.5, R.bone, R.blood); } };
    case 'knife_juggler':
      return { main: R.teal, glyph: (c) => { for (let i = 0; i < 3; i++) daggerAt(c, 16 + (i - 1) * 2, 22, (-90 + (i - 1) * 30) * DEG, 10); } };
    case 'assassin':
      return { main: R.violet, glyph: (c) => { moon(c, 18, 12, 6, R.bone, 0.5, -0.3); daggerAt(c, 11, 22, -60 * DEG, 11); } };
    case 'arcanist':
      return { main: R.arcane, glyph: (c) => { ball(c, 16, 14, 5.5, R.arcane); star4(c, 16, 14, 3, R.cream); ring(c, 16, 14, 7.5, 8.5, R.arcane[4], PI * 0.2, PI * 1.4); } };
    case 'pyromancer':
      return { main: E.magma, glyph: (c) => { flame(c, 16, 22, 13, 17, E.fire); palm(c, 12, 17, R.cream); } };
    case 'tidecaller':
      return {
        main: E.water,
        glyph: (c) => {
          rect(c, 15, 9, 2, 15, R.gold[3]);
          rect(c, 15, 9, 1, 15, R.gold[5]);
          rect(c, 10, 11, 12, 2, R.gold[4]);
          for (const x of [10, 15, 20]) fpoly(c, [x, 11, x + 1, 4, x + 2, 11], R.gold[5]);
          for (let i = 0; i < 4; i++) {
            rect(c, 7 + i * 5, 24 + (i % 2), 4, 1, R.cream[4]);
            px(c, 10 + i * 5, 23 + (i % 2), R.cream[5]);
          }
        },
      };
    case 'stormcaller':
      return { main: E.storm, glyph: (c) => { cloud(c, 16, 11, 12, R.cream); bolt(c, 12, 13, 0.7, E.lightning); } };
    case 'earthshaper':
      return { main: E.earth, glyph: (c) => { spike(c, 11, 22, 8, 11, R.stone); spike(c, 19, 22, 9, 15, R.stone); rect(c, 7, 22, 18, 2, E.earth[3]); } };
    case 'elementalist':
      return {
        main: R.cream,
        glyph: (c) => paint(c, 8, 7, 25, 24, (x, y) => {
          const d = Math.hypot(x - 16, y - 15);
          if (d > 7.5) return null;
          const q = (x < 16 ? 0 : 1) + (y < 15 ? 0 : 2);
          const rp = [E.fire, E.water, E.earth, E.wind][q];
          return d > 6.4 ? rp[2] : rp[4];
        }),
      };
    case 'spellblade':
      return { main: R.arcane, glyph: (c) => { ring(c, 16, 15, 6.5, 7.8, R.arcane[4]); sw(c, bladeRamp(R.arcane)); } };
    case 'wayfarer':
      return {
        main: LEATHER,
        glyph: (c) => {
          for (let i = 0; i < 4; i++) {
            const a = (i / 4) * 2 * PI - PI / 2;
            along(c, 16, 15, a, 0, i === 0 ? 9 : 7, (s) => 2.2 * (1 - s / (i === 0 ? 9 : 7)) + 0.2, shadeAcross(i === 0 ? R.blood : R.cream, a, 5, 4, 3));
          }
          ring(c, 16, 15, 3.5, 4.6, R.gold[4]);
          px(c, 16, 15, R.gold[5]);
        },
      };
    case 'paladin':
      return { main: R.gold, glyph: (c) => { shield(c, 16, 15, 12, 14, R.cream, R.gold); rect(c, 15, 10, 2, 10, R.blood[3]); rect(c, 12, 13, 8, 2, R.blood[3]); } };
    case 'twilight_sage':
      return { main: E.twilight, glyph: (c) => { ball(c, 16, 15, 7, E.holy); moon(c, 16, 15, 7, E.twilight, 0.35, 0); } };
    case 'windblade':
      return { main: E.wind, glyph: (c) => { swoosh(c, 16, 16, 9, 3, 150 * DEG, 220 * DEG, E.wind); sw(c); } };
    case 'mimic':
      return { main: R.spirit, glyph: (c) => mask(c, 16, 15, R.cream) };
    case 'moonwarden':
      return { main: ELEMENT_RAMPS.storm, glyph: (c) => { ball(c, 16, 15, 7.5, R.cream); dot(c, 13, 13, 1.4, R.cream[2]); dot(c, 19, 17, 1, R.cream[2]); } };
    case 'sword_saint':
      return { main: R.rose, glyph: (c) => { ring(c, 16, 9, 3.5, 4.6, R.gold[4]); swordAt(c, 16, 24, -90 * DEG, 14); } };
    case 'magma_knight':
      return { main: E.magma, glyph: (c) => { shield(c, 16, 15, 12, 14, R.iron, R.iron); rect(c, 12, 13, 8, 2, E.magma[4]); rect(c, 15, 11, 2, 9, E.magma[4]); } };
    case 'phantom':
      return { main: R.dusk, glyph: (c) => ghost(c, 16, 15, 7, R.bone) };
    case 'archmage':
      return {
        main: R.violet,
        glyph: (c) => {
          fpoly(c, [8, 22, 15, 5, 24, 22], (x) => (x < 15 ? R.violet[4] : R.violet[3]));
          rect(c, 6, 21, 20, 2, R.violet[2]);
          star4(c, 16, 15, 2, R.gold);
        },
      };
    case 'prism_sage':
      return {
        main: R.teal,
        glyph: (c) => {
          fpoly(c, [16, 6, 24, 22, 8, 22], (x, y) => (x < 16 - (y - 6) * 0.1 ? R.cream[5] : R.cream[3]));
          for (const [i, col] of ['#e0626a', '#f8e264', '#7ee0a0', '#8eb2fa'].entries()) seg(c, 18, 15, 27, 12 + i * 2, col);
        },
      };
    case 'vortex_dancer':
      return { main: E.storm, glyph: (c) => spiral(c, 16, 15, 9, R.cream, 0, 4) };
    case 'runeknight':
      return { main: E.earth, glyph: (c) => { fpoly(c, [10, 6, 22, 6, 24, 22, 8, 22], (x) => (x < 16 ? R.stone[4] : R.stone[3])); bitmap(c, 13, 9, ['#...#', '##.##', '#.#.#', '#...#', '#...#', '.###.', '..#..', '..#..', '..#..'], R.arcane[5]); } };
    case 'stormreaver':
      return { main: E.lightning, glyph: (c) => { axeAt(c, 15, 15, -60 * DEG, 18); bolt(c, 17, 9, 0.6, E.lightning); } };
    case 'echo_sovereign':
      return { main: R.gold, glyph: (c) => { crown(c, 16, 18, 14, R.gold, R.spirit[4]); ring(c, 16, 15, 9, 10, R.spirit[4], PI * 1.1, PI * 0.8); } };
    case 'ascendant':
      return { main: R.gold, glyph: (c) => { star4(c, 16, 14, 6, R.gold); wing(c, 20, 12, R.cream); wing(c, 12, 12, R.cream, true); } };
    case 'eclipse_walker':
      return { main: E.twilight, glyph: (c) => { ball(c, 16, 14, 7, R.gold); dot(c, 18, 13, 6, '#120a1c'); ring(c, 16, 14, 7.5, 8.5, R.gold[5], PI * 0.6, PI * 0.8); } };
    default:
      return { main: R.stone, glyph: (c) => star4(c, 16, 15, 5, R.cream) };
  }
}

function paintClass(c: Ctx, def: Pick<ClassDef, 'id' | 'tier'> | undefined): void {
  const look = classLook(def?.id ?? '');
  const tier = def?.tier ?? 1;
  const rim = tier >= 3 ? R.gold : tier === 2 ? ['#3a2a18', '#5a4028', '#8a6a48', '#b89060', '#d8b880', '#f8e8c0'] : R.iron;
  const body = look.main;
  onLayer(c, (l) => {
    if (tier >= 2) {
      // laurel wings
      for (const side of [-1, 1]) {
        for (let i = 0; i < 5; i++) {
          const y = 9 + i * 4;
          const x = 16 + side * (12 - i * 0.8);
          along(l, x, y, (side < 0 ? 210 : -30) * DEG + side * i * 0.12, -2.2, 2.2, (s) => 1.2 * Math.cos((s / 2.2) * (PI / 2)) + 0.2, () => (i % 2 ? R.leaf[3] : R.leaf[4]));
        }
      }
    }
    const top = tier >= 3 ? 7 : 4;
    paint(l, 4, top, 28, 31, (x, y) => {
      const t = (y - top) / (29 - top);
      const half = 11 * (t < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2)));
      if (Math.abs(x - 16) > half) return null;
      if (Math.abs(x - 16) > half - 1.4 || y < top + 1.4) return x + y < 30 ? rim[5] : rim[3];
      const u = (x - 16) + (y - 15) * 0.7;
      return u < -5 ? body[4] : u < 4 ? body[3] : body[2];
    });
    if (tier >= 3) {
      crown(l, 16, 8, 12, R.gold, R.blood[4]);
    }
  });
  onLayer(c, (l) => {
    l.save();
    l.translate(0, tier >= 3 ? 3 : 1);
    look.glyph(l);
    l.restore();
  });
}

// ------------------------------------------------------------------ items

function tome(c: Ctx, cover: Ramp, emblem: Ramp): void {
  fpoly(c, [6, 7, 22, 4, 26, 24, 10, 28], (x, y) => ((x - 6) + (y - 7) * 0.2 < 4 ? cover[4] : cover[3]));
  fpoly(c, [10, 28, 26, 24, 27, 26, 11, 30], R.cream[4]);
  seg(c, 11, 29, 26, 25, R.cream[2]);
  seg(c, 6, 7, 10, 28, cover[2]);
  seg(c, 7, 7, 11, 28, cover[2]);
  ball(c, 16.5, 16, 3.5, emblem);
  rect(c, 12, 6, 2, 1, R.gold[4]);
  rect(c, 21, 25, 2, 1, R.gold[4]);
}

function flask(c: Ctx, liquid: Ramp, tall: boolean): void {
  if (tall) {
    rect(c, 14, 4, 5, 3, R.wood[3]);
    rect(c, 14, 4, 2, 1, R.wood[5]);
    rect(c, 13, 7, 7, 4, '#c8dce0');
    paint(c, 6, 9, 27, 30, (x, y) => {
      const t = (y - 10) / 19;
      if (t < 0 || t > 1) return null;
      const half = 3.5 + t * 7;
      if (Math.abs(x - 16.5) > half) return null;
      if (y < 15) return x < 16 ? '#e8f4f6' : '#a8c4cc';
      return x < 13 ? liquid[4] : x < 19 ? liquid[3] : liquid[2];
    });
  } else {
    rect(c, 13, 4, 7, 3, R.wood[3]);
    rect(c, 13, 4, 3, 1, R.wood[5]);
    rect(c, 14, 7, 5, 4, '#c8dce0');
    ball(c, 16.5, 20, 9, liquid);
    paint(c, 7, 10, 27, 17, (x, y) => (Math.hypot(x - 16.5, y - 20) <= 9 && y < 15 ? (x < 15 ? '#e8f4f6' : '#b8d0d6') : null));
  }
  px(c, 12, 18, '#ffffff');
  px(c, 12, 19, '#ffffff');
  px(c, 11, 21, '#ffffff');
}

function paintItem(c: Ctx, it: ItemDef | undefined, reg: Registry | null): void {
  const E = ELEMENT_RAMPS;
  onLayer(c, (l) => {
    switch (it?.id) {
      case 'ore':
        rock(l, [4, 26, 6, 13, 13, 6, 23, 8, 29, 17, 27, 27, 16, 30], R.stone, 15, 16);
        for (const [x, y] of [[11, 12], [18, 15], [14, 21], [22, 22], [9, 19]]) {
          rect(l, x, y, 2, 2, '#c8762e');
          px(l, x, y, '#f0b070');
        }
        break;
      case 'fish':
        paint(l, 3, 8, 27, 26, (x, y) => {
          const u = (x - 15) / 10;
          const v = (y - 17) / 6.5;
          if (u * u + v * v > 1) return null;
          return y < 15 ? ELEMENT_RAMPS.water[4] : y < 19 ? R.steel[4] : R.steel[5];
        });
        fpoly(l, [24, 17, 30, 10, 29, 17, 30, 24], ELEMENT_RAMPS.water[3]);
        fpoly(l, [12, 11, 17, 7, 19, 11], ELEMENT_RAMPS.water[3]);
        px(l, 9, 15, OUT);
        px(l, 8, 15, '#ffffff');
        seg(l, 12, 13, 12, 21, R.steel[2]);
        break;
      case 'herb':
        seg(l, 16, 29, 16, 14, R.leaf[2]);
        for (const [a, l0, y] of [[-140, 9, 18], [-40, 9, 16], [-100, 9, 12], [-160, 7, 25], [-20, 7, 23]] as const) {
          along(l, 16, y, a * DEG, 0, l0, (s) => 2.6 * Math.sin((s / l0) * PI) + 0.2, (s, t) => (Math.abs(t) < 0.5 && s < l0 - 2 ? R.leaf[2] : t * litSign(a * DEG) > 0 ? R.leaf[5] : R.leaf[3]));
        }
        rect(l, 14, 26, 5, 2, R.wood[4]);
        break;
      case 'chime_feather':
        object(l, 'feather', 14, 14, -55 * DEG, 29, R.teal, artRng(1));
        seg(l, 6, 25, 10, 25, R.gold[2]);
        seg(l, 10, 25, 10, 22, R.gold[2]);
        paint(l, 3, 24, 13, 32, (x, y) => (Math.abs(x - 7.5) <= (y - 24.5) * 0.6 + 1.2 && y < 31 ? (x < 7 ? R.gold[5] : R.gold[3]) : null));
        rect(l, 3, 30, 10, 1, R.gold[2]);
        px(l, 7, 31, R.gold[4]);
        break;
      case 'umbral_spore':
        mushroom(l, 14, 30, 11, R.violet);
        mushroom(l, 24, 30, 5, R.violet);
        dot(l, 10, 13, 1.3, '#b8f0ff');
        dot(l, 17, 10, 1, '#b8f0ff');
        dot(l, 20, 15, 1, '#b8f0ff');
        px(l, 26, 8, '#b8f0ff');
        px(l, 5, 9, '#b8f0ff');
        break;
      case 'ember_shard':
      case 'storm_shard':
      case 'frost_crystal': {
        const rp = it.id === 'ember_shard' ? E.fire : it.id === 'storm_shard' ? E.storm : E.ice;
        object(l, 'shard', 16, 15, -70 * DEG, 29, rp, artRng(2));
        object(l, 'shard', 8, 23, -115 * DEG, 14, rp, artRng(3));
        object(l, 'shard', 24, 24, -40 * DEG, 13, rp, artRng(4));
        if (it.id === 'ember_shard') {
          px(l, 25, 9, rp[5]);
          px(l, 6, 12, rp[4]);
          px(l, 27, 15, rp[4]);
        }
        if (it.id === 'storm_shard') bolt(l, 13, 10, 0.55, E.lightning);
        break;
      }
      case 'sun_water':
        flask(l, E.holy, false);
        star4(l, 16, 21, 3, E.holy);
        break;
      case 'storm_wood':
        along(l, 16, 17, -25 * DEG, -12, 12, () => 5.5, shadeAcross(R.wood, -25 * DEG, 4, 3, 2));
        paint(l, 22, 6, 31, 18, (x, y) => {
          const u = (x - 26.6) / 2.6;
          const v = (y - 11.8) / 5.2;
          return u * u + v * v <= 1 ? (u * u + v * v < 0.4 ? R.wood[5] : R.wood[4]) : null;
        });
        zap(l, 6, 20, 20, 14, E.storm, artRng(7), 3, 1.5);
        break;
      case 'relic_stone':
        rock(l, [5, 27, 4, 14, 10, 6, 20, 5, 27, 11, 28, 25, 17, 30], R.stone, 15, 16);
        for (const [x0, y0, x1, y1] of [[16, 17, 9, 27], [16, 17, 24, 26], [16, 17, 12, 8], [16, 17, 23, 10]]) seg(l, x0, y0, x1, y1, R.wood[3]);
        heart(l, 16, 17, 3.2, E.magma);
        break;
      case 'relic_dusk':
        ball(l, 16, 16, 12, R.violet);
        ring(l, 16, 16, 9, 10.5, R.gold[4]);
        moon(l, 16, 16, 6.5, R.gold, 0.5, -0.2);
        for (let i = 0; i < 8; i++) {
          const a = (i / 8) * 2 * PI;
          px(l, 16 + Math.cos(a) * 12, 16 + Math.sin(a) * 12, R.violet[2]);
        }
        break;
      case 'relic_storm':
        horn(l, 4, 24, R.bone, 1.25);
        ring(l, 11, 21, 0, 2.6, E.lightning[4]);
        bolt(l, 18, 2, 0.6, E.lightning);
        break;
      case 'tome_quickstep':
      case 'tome_static_field': {
        const sk = it.kind === 'tome' && reg ? reg.skill(it.skill) : undefined;
        const rp = sk ? skillRamps(sk).fx : R.arcane;
        tome(l, it.id === 'tome_quickstep' ? R.teal : R.arcane, rp);
        break;
      }
      case 'healing_draught':
        flask(l, R.blood, false);
        break;
      case 'mana_draught':
        flask(l, R.arcane, true);
        break;
      case 'waystone_shard':
        fpoly(l, [12, 4, 22, 7, 26, 18, 19, 29, 9, 26, 6, 14], (x, y) => ((x - 16) + (y - 16) < -4 ? R.stone[5] : (x - 16) + (y - 16) < 4 ? R.stone[4] : R.stone[3]));
        bitmap(l, 13, 10, ['..#..', '.###.', '#.#.#', '..#..', '..#..', '.#.#.', '#...#'], R.teal[5]);
        break;
      case 'blink_seed':
        paint(l, 8, 6, 24, 28, (x, y) => {
          const u = (x - 15.5) / 6.5;
          const v = (y - 18) / 9;
          if (u * u + v * v > 1) return null;
          if (y < 13) return R.wood[x < 15 ? 4 : 3];
          return x < 13 ? R.violet[5] : x < 17 ? R.violet[4] : R.violet[3];
        });
        rect(l, 15, 4, 2, 4, R.wood[3]);
        star4(l, 25, 9, 3, R.violet);
        star4(l, 7, 25, 2, R.violet);
        break;
      default:
        // generic by kind
        switch (it?.kind) {
          case 'tome':
            tome(l, R.wood, R.arcane);
            break;
          case 'shard':
            object(l, 'shard', 16, 16, -70 * DEG, 24, ELEMENT_RAMPS[it.element] ?? R.arcane, artRng(5));
            break;
          case 'consumable':
            flask(l, R.blood, false);
            break;
          case 'relic':
            ball(l, 16, 16, 11, R.gold);
            break;
          default:
            // pouch
            paint(l, 5, 9, 28, 30, (x, y) => {
              const u = (x - 16.5) / 10;
              const v = (y - 21) / 8.5;
              return u * u + v * v <= 1 ? (u + v < -0.6 ? R.wood[5] : u + v < 0.4 ? R.wood[4] : R.wood[3]) : null;
            });
            fpoly(l, [11, 13, 14, 6, 19, 6, 22, 13], R.wood[3]);
            rect(l, 11, 12, 11, 2, R.gold[3]);
        }
    }
  });
}

// ------------------------------------------------------------------ passives (lazy, medallions)

/** Glyph for a tag / trainer passive, centred on (16, 16) inside a ~20 px field. */
function passiveGlyph(c: Ctx, key: string): void {
  switch (key) {
    case 'blade':
      swordAt(c, 10, 22, -45 * DEG, 12);
      break;
    case 'pierce':
      daggerAt(c, 11, 21, -45 * DEG, 10);
      break;
    case 'arcane':
      ball(c, 16, 16, 5, R.arcane);
      star4(c, 16, 16, 2, R.cream);
      break;
    case 'spin':
      spiral(c, 16, 16, 9, R.steel, 0.4, 3);
      break;
    case 'projectile':
      along(c, 9, 23, -45 * DEG, 0, 14, () => 0.7, () => R.wood[4]);
      fpoly(c, [24, 8, 18, 10, 22, 14], R.steel[5]);
      for (const o of [0, 2]) seg(c, 8 + o, 21 - o, 6 + o, 23 - o, R.cream[4]);
      break;
    case 'dash':
      for (let i = 0; i < 2; i++) fpoly(c, [9 + i * 6, 9, 15 + i * 6, 16, 9 + i * 6, 23, 12 + i * 6, 16], i ? R.teal[5] : R.teal[4]);
      break;
    case 'aoe':
      burst(c, 16, 16, 10, ELEMENT_RAMPS.fire, 8, 0.3);
      break;
    case 'stealth':
      moon(c, 16, 15, 8, R.bone, 0.45, -0.25);
      eye(c, 15, 16, 3.5, R.bone, R.blood);
      break;
    case 'heavy':
    case 'forgehand':
      hammerAt(c, 16, 16, -60 * DEG, 18);
      break;
    case 'spirit':
    case 'still_mind':
      lotus(c, 16, 18, R.rose);
      break;
    case 'echo':
      for (let i = 0; i < 3; i++) ring(c, 10, 16, 3 + i * 4, 4.2 + i * 4, i % 2 ? R.spirit[3] : R.spirit[4], -PI / 3, (2 * PI) / 3);
      ball(c, 10, 16, 2.2, R.spirit);
      break;
    case 'melee':
      palm(c, 12, 12, R.cream);
      break;
    case 'sure_footing':
      boot(c, 10, 8, LEATHER);
      break;
    case 'devotion':
      star4(c, 16, 15, 6, ELEMENT_RAMPS.holy);
      break;
    case 'patience':
      seg(c, 16, 5, 16, 16, R.cream[4]);
      ring(c, 13.5, 18, 1.6, 3, R.steel[4], -PI * 0.1, PI * 1.1);
      fpoly(c, [10, 17, 12, 15, 12, 19], R.steel[5]);
      dot(c, 16, 9, 1.6, R.blood[4]);
      break;
    case 'field_drill':
      shield(c, 16, 16, 13, 15, R.blood, R.gold);
      break;
    case 'pathfinder':
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * 2 * PI - PI / 2;
        along(c, 16, 16, a, 0, i === 0 ? 9 : 7, (s) => 2 * (1 - s / (i === 0 ? 9 : 7)) + 0.2, shadeAcross(i === 0 ? R.blood : R.cream, a, 5, 4, 3));
      }
      break;
    default:
      star4(c, 16, 16, 5, R.gold);
  }
}

function paintPassive(c: Ctx, p: { id: string; source: string; tag?: string } | undefined): void {
  if (p && (p.source === 'class' || p.source === 'imprint')) {
    const cls = p.id.replace(/^cls_/, '').replace(/^imprint_/, '').replace(/_\d+$/, '');
    paintClass(c, REG?.classDef(cls) ?? { id: cls, tier: 1 });
    if (p.source === 'imprint') onLayer(c, (l) => ring(l, 25, 25, 2.5, 4.4, R.gold[4]));
    return;
  }
  const res = p?.source === 'resonance' ? p.id.split('_').slice(1) : null;
  const rim = p?.source === 'trainer' ? R.steel : p?.source === 'bestiary' ? R.bone : R.gold;
  onLayer(c, (l) => {
    paint(l, 1, 1, 31, 31, (x, y) => {
      const d = Math.hypot(x - 16, y - 16);
      if (d > 14.5) return null;
      if (d > 12) {
        const lit = -((x - 16) + (y - 16));
        return lit > 4 ? rim[5] : lit < -4 ? rim[2] : rim[3];
      }
      if (d > 11) return OUT;
      if (res && res.length === 2) {
        const rp = ELEMENT_RAMPS[(x - 16 < y - 16 ? res[0] : res[1]) as ElementId] ?? R.arcane;
        return d > 9 ? rp[2] : rp[3];
      }
      return d > 8.5 ? (chk(x, y) ? '#1c140e' : '#2a1c12') : '#2a1c12';
    });
  });
  if (res && res.length === 2) {
    seg(c, 8, 8, 24, 24, R.gold[4]);
    paintElementPip(c, res[0], 7, 15, 10);
    paintElementPip(c, res[1], 15, 7, 10);
    return;
  }
  onLayer(c, (l) => passiveGlyph(l, p?.tag ?? p?.id ?? ''));
}

// ------------------------------------------------------------------ registry + entry points

let REG: Registry | null = null;
const PREFIX: Readonly<Record<IconKind, string>> = {
  skill: 'icon_skill_',
  el: 'icon_el_',
  mod: 'icon_mod_',
  item: 'icon_item_',
  cls: 'icon_cls_',
  passive: 'icon_passive_',
};

function drawGenerics(scene: Phaser.Scene): void {
  pixelTex(scene, 'icon_skill_generic', 32, 32, (c) => {
    tileBack(c, BG.steel, 0);
    onLayer(c, (l) => {
      ring(l, 16, 16, 8, 9.4, (_a, _d, x, y) => (chk(x, y) ? R.steel[3] : null));
      star4(l, 16, 16, 5, R.steel);
    });
    tileFrame(c, 0, R.steel);
  });
  pixelTex(scene, 'icon_el_generic', 32, 32, (c) => paintElement(c, 'generic'));
  pixelTex(scene, 'icon_mod_generic', 32, 32, (c) => paintEssence(c, undefined));
  pixelTex(scene, 'icon_item_generic', 32, 32, (c) => paintItem(c, undefined, null));
  pixelTex(scene, 'icon_cls_generic', 32, 32, (c) => paintClass(c, undefined));
  pixelTex(scene, 'icon_passive_generic', 32, 32, (c) => paintPassive(c, undefined));
}

/** Variant / merge skill icon: redrawn from the composed SkillDef + element / essence / merge badges. */
function drawGeneratedSkill(scene: Phaser.Scene, id: string): string | null {
  if (!REG) return null;
  const parts = parseVariantId(id);
  const def = REG.skill(id);
  if (!parts || !def) return null;
  const key = PREFIX.skill + id;
  const seedId = parts.merge ? `${parts.merge[0]}|${parts.merge[1]}` : parts.base;
  pixelTex(scene, key, 32, 32, (c) => {
    paintSkill(c, def, seedId);
    if (parts.merge) {
      // two linked rings, top-right
      onLayer(c, (l) => {
        ring(l, 23, 7, 1.6, 3, R.gold[4]);
        ring(l, 26.5, 7, 1.6, 3, R.gold[5]);
      });
    }
    if (parts.element) paintElementPip(c, parts.element, 2, 2, 10);
    parts.mods.forEach((m, i) => paintModPip(c, REG?.essence(m), 2 + i * 9, 20, 10));
  });
  return key;
}

export interface DrawIconsOptions {
  /**
   * Skip painting the ~160 authored skill tiles now; each is painted on first iconKey()/iconUrl() request
   * instead (≈ 60% of the icon boot cost). Everything else is still drawn eagerly. Default false.
   */
  lazySkills?: boolean;
}

/**
 * Generates every icon texture: authored skills, elements, essences, items, classes, pips and generic
 * fallbacks. Idempotent per key. Call once at boot after the registry exists (iconKey / iconUrl need it).
 */
export function drawIcons(scene: Phaser.Scene, reg: Registry, opts: DrawIconsOptions = {}): void {
  REG = reg;
  drawGenerics(scene);
  for (const el of reg.elements.values()) {
    pixelTex(scene, PREFIX.el + el.id, 32, 32, (c) => paintElement(c, el.id));
    pixelTex(scene, 'icon_pip_el_' + el.id, PIP_SIZE, PIP_SIZE, (c) => paintElementPip(c, el.id));
  }
  for (const e of reg.essences.values()) {
    pixelTex(scene, PREFIX.mod + e.id, 32, 32, (c) => paintEssence(c, e));
    pixelTex(scene, 'icon_pip_mod_' + e.id, PIP_SIZE, PIP_SIZE, (c) => paintModPip(c, e));
  }
  if (!opts.lazySkills) for (const s of reg.authoredSkills()) pixelTex(scene, PREFIX.skill + s.id, 32, 32, (c) => paintSkill(c, s, s.id));
  for (const it of reg.items.values()) pixelTex(scene, PREFIX.item + it.id, 32, 32, (c) => paintItem(c, it, reg));
  for (const cl of reg.classes) pixelTex(scene, PREFIX.cls + cl.id, 32, 32, (c) => paintClass(c, cl));
}

/**
 * Texture key for an icon, generating it lazily when needed (generated skill variants and merges, or ids
 * that appeared after boot); falls back to `icon_<kind>_generic`.
 */
export function iconKey(scene: Phaser.Scene, kind: IconKind, id: string): string {
  const key = PREFIX[kind] + id;
  if (scene.textures.exists(key)) return key;
  if (REG) {
    if (kind === 'skill') {
      if (REG.isAuthored(id)) {
        const def = REG.skill(id)!;
        pixelTex(scene, key, 32, 32, (c) => paintSkill(c, def, id));
        return key;
      }
      const made = drawGeneratedSkill(scene, id);
      if (made) return made;
    } else if (kind === 'el' && REG.element(id as ElementId)) {
      pixelTex(scene, key, 32, 32, (c) => paintElement(c, id as ElementId));
      return key;
    } else if (kind === 'mod' && REG.essence(id)) {
      pixelTex(scene, key, 32, 32, (c) => paintEssence(c, REG!.essence(id)));
      return key;
    } else if (kind === 'item' && REG.item(id)) {
      pixelTex(scene, key, 32, 32, (c) => paintItem(c, REG!.item(id), REG));
      return key;
    } else if (kind === 'cls' && REG.classDef(id)) {
      pixelTex(scene, key, 32, 32, (c) => paintClass(c, REG!.classDef(id)));
      return key;
    } else if (kind === 'passive' && REG.passive(id)) {
      pixelTex(scene, key, 32, 32, (c) => paintPassive(c, REG!.passive(id)));
      return key;
    }
  }
  drawGenerics(scene);
  return PREFIX[kind] + 'generic';
}

const URLS = new Map<string, string>();

/** PNG data URL of an icon for DOM use (cached). Unknown ids return the generic icon of that kind. */
export function iconUrl(scene: Phaser.Scene, kind: IconKind, id: string): string {
  const ck = kind + ':' + id;
  const hit = URLS.get(ck);
  if (hit) return hit;
  const url = textureDataUrl(scene, iconKey(scene, kind, id));
  if (url) URLS.set(ck, url);
  return url;
}

/** Data URL of a 12x12 element or essence pip (skill-bar element pip, fusion badges). '' when unknown. */
export function pipUrl(scene: Phaser.Scene, kind: 'el' | 'mod', id: string): string {
  const key = `icon_pip_${kind}_${id}`;
  return scene.textures.exists(key) ? textureDataUrl(scene, key) : '';
}

// ------------------------------------------------------------------ HUD glyphs (used by ./ui.ts)

/** Names of the 24x24 HUD button glyphs drawn by ui.ts as `ui_ico_<name>`. */
export const UI_GLYPHS = [
  'skills',
  'fuse',
  'class',
  'codex',
  'bag',
  'map',
  'menu',
  'quest',
  'attack',
  'auto',
  'target',
  'potion',
  'recall',
  'rest',
  'close',
  // the four weapons (lock lines, locked slots, the bag's weapon rows)
  'w_sword',
  'w_dagger',
  'w_staff',
  'w_fists',
] as const;
export type UiGlyph = (typeof UI_GLYPHS)[number];

/** Paints one 24x24 HUD glyph (outlined, transparent background). */
export function paintUiGlyph(c: Ctx, name: UiGlyph): void {
  onLayer(c, (l) => {
    switch (name) {
      case 'skills':
        for (const [x0, y0, x1, y1] of [[5, 17, 11, 7], [11, 7, 19, 11], [19, 11, 17, 19], [11, 7, 9, 13]]) seg(l, x0, y0, x1, y1, R.gold[2]);
        star4(l, 5, 17, 2, R.gold);
        star4(l, 11, 7, 3, R.gold);
        star4(l, 19, 11, 2, R.gold);
        star4(l, 17, 19, 2, R.gold);
        break;
      case 'fuse':
        paint(l, 3, 9, 21, 22, (x, y) => {
          const u = (x - 12) / 8.5;
          const v = (y - 14) / 7.5;
          return u * u + v * v <= 1 && y > 11 ? (u + v < -0.5 ? R.iron[4] : R.iron[3]) : null;
        });
        rect(l, 3, 10, 18, 2, R.iron[5]);
        rect(l, 5, 21, 3, 2, R.iron[2]);
        rect(l, 16, 21, 3, 2, R.iron[2]);
        dot(l, 9, 7, 2.2, ELEMENT_RAMPS.fire[4]);
        dot(l, 15, 6, 2.2, ELEMENT_RAMPS.water[4]);
        px(l, 12, 3, R.violet[5]);
        break;
      case 'class':
        paint(l, 4, 3, 20, 22, (x, y) => {
          const t = (y - 3) / 18;
          const half = 7.5 * (t < 0.55 ? 1 : Math.sqrt(Math.max(0, 1 - ((t - 0.55) / 0.45) ** 2)));
          if (Math.abs(x - 12) > half) return null;
          if (Math.abs(x - 12) > half - 1.2 || y < 4.2) return x + y < 18 ? R.gold[5] : R.gold[3];
          return x < 12 ? R.blood[4] : R.blood[3];
        });
        swordAt(l, 12, 17, -90 * DEG, 9);
        break;
      case 'codex':
        fpoly(l, [3, 5, 16, 2, 20, 18, 7, 21], (x, y) => ((x - 3) + (y - 5) * 0.2 < 3 ? R.teal[5] : R.teal[4]));
        fpoly(l, [7, 21, 20, 18, 21, 20, 8, 23], R.cream[4]);
        seg(l, 8, 22, 20, 19, R.cream[2]);
        seg(l, 3, 5, 7, 21, R.teal[2]);
        ball(l, 12, 12, 2.6, R.gold);
        px(l, 6, 4, R.gold[4]);
        px(l, 17, 18, R.gold[4]);
        break;
      case 'bag':
        paint(l, 3, 7, 22, 23, (x, y) => {
          const u = (x - 12.5) / 8.5;
          const v = (y - 15.5) / 7;
          return u * u + v * v <= 1 ? (u + v < -0.5 ? LEATHER[5] : u + v < 0.4 ? LEATHER[4] : LEATHER[3]) : null;
        });
        fpoly(l, [7, 9, 10, 3, 15, 3, 18, 9], LEATHER[3]);
        rect(l, 7, 8, 11, 2, R.gold[3]);
        rect(l, 11, 14, 3, 3, R.gold[4]);
        break;
      case 'map':
        fpoly(l, [3, 6, 9, 4, 15, 6, 21, 4, 21, 19, 15, 21, 9, 19, 3, 21], (x) => (x < 9 ? R.cream[4] : x < 15 ? R.cream[3] : R.cream[4]));
        seg(l, 9, 4, 9, 19, R.cream[2]);
        seg(l, 15, 6, 15, 21, R.cream[2]);
        for (const [x, y] of [[6, 15], [8, 12], [11, 11], [13, 9]]) px(l, x, y, R.blood[3]);
        bitmap(l, 15, 9, ['#.#', '.#.', '#.#'], R.blood[3]);
        break;
      case 'menu':
        for (const y of [5, 11, 17]) {
          rect(l, 4, y, 16, 3, R.cream[4]);
          rect(l, 4, y, 16, 1, R.cream[5]);
        }
        break;
      case 'quest':
        fpoly(l, [6, 3, 18, 3, 18, 20, 6, 20], (x) => (x < 12 ? R.cream[5] : R.cream[4]));
        rect(l, 5, 2, 14, 2, LEATHER[4]);
        rect(l, 5, 20, 14, 2, LEATHER[3]);
        rect(l, 11, 6, 2, 8, R.blood[3]);
        rect(l, 11, 16, 2, 2, R.blood[3]);
        break;
      case 'w_sword':
        swordAt(l, 8, 16, -45 * DEG, 15);
        break;
      case 'w_dagger':
        daggerAt(l, 9, 15, -45 * DEG, 11);
        break;
      case 'w_staff':
        staffAt(l, 5, 19, -45 * DEG, 16, R.arcane);
        break;
      case 'w_fists':
        // a closed hand, knuckles up, over a cloth wrap
        paint(l, 5, 5, 19, 15, (x, y) => {
          const rx = x < 7 || x > 16 ? 1 : 0;
          if (y - 5 < rx || 14 - y < rx) return null;
          if (y <= 9 && (x === 8 || x === 11 || x === 14)) return R.cream[2]; // between the fingers
          if (y === 10) return R.cream[2];
          if (y >= 11 && x >= 6 && x <= 13) return y === 11 ? R.cream[5] : R.cream[4]; // the thumb across
          return y <= 6 ? R.cream[5] : x >= 15 ? R.cream[3] : R.cream[4];
        });
        rect(l, 7, 15, 10, 5, R.blood[3]);
        rect(l, 7, 15, 10, 1, R.blood[4]);
        seg(l, 7, 18, 16, 17, R.blood[2]);
        break;
      case 'attack':
        swoosh(l, 12, 12, 10, 3.5, 160 * DEG, 200 * DEG, R.steel);
        swordAt(l, 6, 18, -45 * DEG, 14);
        break;
      case 'auto':
        ring(l, 12, 12, 6, 8.5, R.gold[4], PI * 0.15, PI * 0.75);
        ring(l, 12, 12, 6, 8.5, R.gold[3], PI * 1.15, PI * 0.75);
        bitmap(l, 4, 5, ['#...', '##..', '###.'], R.gold[4]);
        bitmap(l, 16, 16, ['.###', '..##', '...#'], R.gold[3]);
        bitmap(l, 10, 9, ['.##.', '#..#', '####', '#..#', '#..#'], R.cream[5]);
        break;
      case 'target':
        ring(l, 12, 12, 6, 7.6, R.blood[4]);
        for (const [x, y, w, h] of [[11, 2, 2, 6], [11, 16, 2, 6], [2, 11, 6, 2], [16, 11, 6, 2]]) rect(l, x, y, w, h, R.cream[5]);
        dot(l, 12, 12, 1.3, R.blood[5]);
        break;
      case 'potion':
        rect(l, 10, 2, 5, 3, R.wood[3]);
        rect(l, 11, 5, 3, 3, '#c8dce0');
        ball(l, 12.5, 15, 7, R.blood);
        px(l, 9, 13, '#ffffff');
        break;
      case 'recall':
        fpoly(l, [9, 2, 16, 4, 19, 13, 14, 22, 7, 20, 5, 10], (x, y) => ((x - 12) + (y - 12) < -3 ? R.stone[5] : (x - 12) + (y - 12) < 3 ? R.stone[4] : R.stone[3]));
        bitmap(l, 10, 7, ['..#..', '.###.', '#.#.#', '..#..', '.#.#.', '#...#'], R.teal[5]);
        break;
      case 'rest':
        for (const [x0, y0, x1, y1] of [[4, 21, 20, 16], [4, 16, 20, 21]]) along(l, x0, y0, Math.atan2(y1 - y0, x1 - x0), 0, Math.hypot(x1 - x0, y1 - y0), () => 1.2, shadeAcross(R.wood, Math.atan2(y1 - y0, x1 - x0), 4, 3, 2));
        flame(l, 12, 18, 9, 14, ELEMENT_RAMPS.fire);
        break;
      case 'close':
        along(l, 5, 5, 45 * DEG, 0, 19.8, () => 1.5, () => R.cream[5]);
        along(l, 19, 5, 135 * DEG, 0, 19.8, () => 1.5, () => R.cream[4]);
        break;
    }
  });
}
