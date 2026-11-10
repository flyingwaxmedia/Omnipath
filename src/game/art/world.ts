import type Phaser from 'phaser';
import { type Ctx, canvasTex, rgba, scratch, shade } from './common';
import { PAL, RAMPS, WORLD_OUTLINE, artRng, disc, keySeed, line as seg, outline, px } from './pixel';
import { drawTiles } from './tiles';
import { type IdleAnim, SWAY_CELLS, stripTex, swayLean } from './dressing';

// World art (the tile atlases live in art/tiles.ts): props, structures, objects, gather nodes, portals and hidden-portal blockers.
// Every texture key here is a contract with the client (see docs/SPEC-v2.md §7 and src/core/world/types.ts).
// Everything here is true pixel art (docs/ART-DIRECTION.md "Lush Pixel"): integer pixels, flat
// colour ramps lit from the top-left and a 1 px PAL.outline rim. Sizes and anchors are unchanged from v2.

/** Tile atlas margin / spacing (px) of art/tiles.ts's 'tiles' atlas (1 px extruded borders, so neighbouring tiles
 *  never bleed). Kept here for v2 importers (textures.ts re-exports them). */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;

// ================================================================== pixel kit
// Shared by props, structures, objects, nodes and portals. Bodies are painted on a scratch canvas by sprite(),
// which then adds the 1 px PAL.outline rim and composites over whatever (shadows, halos) is already on the texture.

const OUT = WORLD_OUTLINE;
type Ramp = readonly string[];

/** Material ramps, darkest -> lightest. Anchors from docs/ART-DIRECTION.md §2, extended by a shade either side. */
const R = {
  leaf: RAMPS.foliage,
  bark: RAMPS.wood,
  stone: RAMPS.stone,
  warmStone: ['#3a342e', '#544c43', '#70665a', '#8f8475', '#aea290', '#ccc2ae'],
  dirt: RAMPS.dirt.slice(1),
  grass: RAMPS.grass.slice(1),
  moss: RAMPS.foliage.slice(1, 5),
  gold: ['#6a4818', '#a0702c', '#d0a048', '#e9c46a', '#f8e6a8'],
  iron: ['#24252b', '#3a3c44', '#565a64', '#7c818c', '#a8adb6'],
  crimson: ['#4a1418', '#7a1f26', '#b8323a', '#d85a58', '#f09080'],
  blue: ['#141c3a', '#1f2c58', '#2c4380', '#3f5fa6', '#6a8acc'],
  teal: ['#16302e', '#1f4a46', '#2c6a62', '#3f8f84', '#68b8a8'],
  cream: ['#8a7a5a', '#b8a684', '#d6c8a4', '#efe6c8', '#fbf6e6'],
  violet: ['#2a1c4a', '#43307a', '#6a4ea8', '#8a6cc0', '#b8a0e8', '#e4d8ff'],
  cyan: ['#163a52', '#1f5a7a', '#2f86ac', '#4ab0d8', '#8ce0f4', '#e0fbff'],
  flame: ['#7a1e0c', '#c8401a', '#f07a28', '#ffc04a', '#fff0a8'],
} as const;


/** Integer rectangle (rounded), the workhorse of every sprite. */
function box(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.round(x + w) - x0;
  const hh = Math.round(y + h) - y0;
  if (ww <= 0 || hh <= 0) return;
  c.fillStyle = color;
  c.fillRect(x0, y0, ww, hh);
}

/** Scanline polygon fill on pixel centres (no anti-aliasing). pts = [x0,y0,x1,y1,...]. */
function fpoly(c: Ctx, pts: readonly number[], color: string): void {
  const n = pts.length >> 1;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    y0 = Math.min(y0, pts[i * 2 + 1]);
    y1 = Math.max(y1, pts[i * 2 + 1]);
  }
  c.fillStyle = color;
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
      if (b > a) c.fillRect(a, y, b - a, 1);
    }
  }
}

/** Square-brush polyline (w px wide), for branches, ropes and stems. */
function brush(c: Ctx, pts: readonly number[], w: number, color: string): void {
  c.fillStyle = color;
  for (let i = 0; i + 3 < pts.length; i += 2) {
    const [x0, y0, x1, y1] = [pts[i], pts[i + 1], pts[i + 2], pts[i + 3]];
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let s = 0; s <= n; s++) {
      const x = x0 + ((x1 - x0) * s) / n;
      const y = y0 + ((y1 - y0) * s) / n;
      c.fillRect(Math.round(x - w / 2), Math.round(y - w / 2), w, w);
    }
  }
}

/** Stepped (banded) light halo — reads as pixel light, never a smooth gradient. */
function halo(c: Ctx, cx: number, cy: number, r: number, color: string, a = 0.3, steps = 3): void {
  for (let i = 0; i < steps; i++) {
    const rr = r * (1 - i / (steps + 0.5));
    disc(c, cx, cy, rr, rr * 0.92, rgba(color, a / steps));
  }
}

/** Paint the body on a scratch canvas, rim it with the 1 px outline, composite it. */
function sprite(c: Ctx, w: number, h: number, draw: (b: Ctx) => void, color: string = OUT): void {
  const s = scratch(w, h);
  draw(s.c);
  outline(s.c, w, h, color);
  c.drawImage(s.el, 0, 0);
}

/** Same drawing under every key (legacy aliases). */
function texAll(scene: Phaser.Scene, keys: readonly string[], w: number, h: number, draw: (c: Ctx) => void): void {
  for (const k of keys) canvasTex(scene, k, w, h, draw);
}

/** Four-point sparkle. */
function twinkle(c: Ctx, x: number, y: number, color: string, arm = 1): void {
  box(c, x - arm, y, arm * 2 + 1, 1, color);
  box(c, x, y - arm, 1, arm * 2 + 1, color);
}

/**
 * Foliage mass made of overlapping leaf puffs. Puffs are painted bottom-first, each with a darker underside, so every
 * clump gets the dark lower edge of the reference style; tone steps follow the top-left light. `rim` paints a dark
 * band around the whole cluster first so it separates from the clusters behind it.
 */
function leafMass(b: Ctx, cx: number, cy: number, rx: number, ry: number, ramp: Ramp, rnd: () => number, rim = true, pr = 4): void {
  const puffs: [number, number, number][] = [];
  const sx = pr * 1.3;
  const sy = pr * 1.1;
  let row = 0;
  for (let y = cy - ry + pr * 0.7; y <= cy + ry - pr * 0.5; y += sy, row++) {
    for (let x = cx - rx + pr * 0.7 + (row & 1) * sx * 0.5; x <= cx + rx - pr * 0.6; x += sx) {
      const jx = x + (rnd() - 0.5) * 1.6;
      const jy = y + (rnd() - 0.5) * 1.2;
      const e = ((jx - cx) / Math.max(1, rx - pr * 0.6)) ** 2 + ((jy - cy) / Math.max(1, ry - pr * 0.6)) ** 2;
      if (e > 1.08) continue;
      puffs.push([jx, jy, pr * (0.85 + rnd() * 0.35)]);
    }
  }
  if (!puffs.length) puffs.push([cx, cy, pr]);
  if (rim) for (const [x, y, r] of puffs) disc(b, x, y + 0.6, r + 1.1, (r + 1.1) * 0.9, ramp[0]);
  puffs.sort((p, q) => q[1] - p[1]);
  const top = ramp.length - 1;
  for (const [x, y, r] of puffs) {
    const L = -((x - cx) / rx) * 0.5 - ((y - cy) / ry) * 0.95 + (rnd() - 0.5) * 0.3;
    const t = L > 0.6 ? 4 : L > 0.12 ? 3 : L > -0.4 ? 2 : 1;
    disc(b, x + 0.3, y + 0.9, r, r * 0.86, ramp[t - 1]);
    disc(b, x - 0.2, y - 0.2, r - 0.7, (r - 0.7) * 0.84, ramp[t]);
    if (t >= 2) disc(b, x - r * 0.35, y - r * 0.42, r * 0.4, r * 0.3, ramp[Math.min(top, t + 1)]);
  }
}

/** Tree trunk with flared roots, lit left edge, shaded right edge and bark crevices. */
function trunkPx(b: Ctx, cx: number, top: number, base: number, w: number, ramp: Ramp, rnd: () => number): void {
  const hw = w / 2;
  fpoly(b, [cx - hw, top, cx + hw, top, cx + hw, base - 6, cx + hw + 5, base, cx - hw - 5, base, cx - hw, base - 6], ramp[3]);
  // roots
  fpoly(b, [cx - hw - 1, base - 4, cx - hw - 7, base + 1, cx - hw - 2, base + 1], ramp[2]);
  fpoly(b, [cx + hw + 1, base - 4, cx + hw + 7, base + 1, cx + hw + 2, base + 1], ramp[1]);
  for (let y = top; y < base; y++) {
    const flare = y > base - 6 ? (y - (base - 6)) * 0.85 : 0;
    const x0 = Math.round(cx - hw - flare);
    const x1 = Math.round(cx + hw + flare);
    box(b, x0, y, 2, 1, ramp[4]);
    box(b, x1 - 3, y, 3, 1, ramp[2]);
    box(b, x1 - 1, y, 1, 1, ramp[1]);
  }
  for (let i = 0; i < Math.round(w / 2) + 1; i++) {
    const x = Math.round(cx - hw + 2 + rnd() * (w - 4));
    const y = Math.round(top + 2 + rnd() * (base - top - 9));
    const len = 2 + Math.floor(rnd() * 4);
    box(b, x, y, 1, len, ramp[1]);
    box(b, x - 1, y + len, 1, 1, ramp[2]);
  }
  box(b, Math.round(cx - hw + 1), top + 3, 1, Math.max(1, base - top - 10), ramp[5] ?? ramp[4]);
  box(b, Math.round(cx - 1), base - 3, 1, 3, ramp[1]);
  box(b, Math.round(cx + hw + 1), base - 2, 1, 2, ramp[0]);
}

// ================================================================== props
// Origin bottom-centre: the client anchors (0.5, 1) at the tile's bottom edge.

const LEAF_DARK = ['#10181a', '#172426', '#203434', '#2b4642', '#3a5c52', '#5e826e'];
const LEAF_DUSK = ['#1b1828', '#28233a', '#383150', '#4a4268', '#625a84', '#8c84ac'];
const PINE = ['#12261c', '#1a3826', '#264e34', '#346840', '#4a8350', '#73a663'];
const FROST_PINE = ['#122a32', '#1a3c44', '#26545a', '#356e70', '#4c8a86', '#74aaa2'];
const SNOW = ['#7f97b0', '#a8bdd2', '#cddcea', '#eef4fa', '#ffffff'];
const DEAD_BARK = ['#201814', '#2e241e', '#43362c', '#5a4a3c', '#74624f', '#8e7b64'];
const DUSK_BARK = ['#1a1220', '#281c30', '#3a2a44', '#4f3b5a', '#664e72', '#7f6690'];
const BASALT = ['#0e0c10', '#19161c', '#252128', '#332e38', '#45404c', '#5e5866'];

/** Leaf-mass layouts for broad trees ([cx, cy, rx, ry] × top, left, right, bottom): variant 0 is the v2 look. */
const BROAD_LAYOUTS: readonly (readonly (readonly [number, number, number, number])[])[] = [
  [
    [24, 16, 16, 12],
    [12, 29, 11, 9],
    [36, 28, 11, 9],
    [23, 36, 10, 6],
  ],
  [
    [25, 15, 15, 12],
    [13, 27, 10, 9],
    [35, 30, 12, 9],
    [24, 37, 11, 6],
  ],
  [
    [23, 17, 17, 11],
    [11, 30, 11, 8],
    [37, 27, 10, 9],
    [22, 36, 10, 6],
  ],
];

/**
 * Wind-sway strips (render/ambient.ts steps them in travelling gusts): cell 1 is the same tree with its crown a pixel
 * downwind (same RNG draws, so only the crown moves), cell 2 the same lean mirrored for flipped trees (art/dressing.ts
 * SWAY_CELLS). One texture.
 */
function broadTree(scene: Phaser.Scene, key: string, leaf: Ramp, bark: Ramp, extra?: (b: Ctx, rnd: () => number) => void, v = 0): void {
  const L = BROAD_LAYOUTS[v % BROAD_LAYOUTS.length];
  stripTex(scene, key, 48, 64, SWAY_CELLS, (c, cell) => {
    const f = swayLean(cell);
    const rnd = artRng(keySeed(key));
    sprite(c, 48, 64, (b) => {
      trunkPx(b, 24, 30, 61, 8, bark, rnd);
      brush(b, [22, 42, 15 + (v === 2 ? -1 : 0), 33], 2, bark[3]);
      brush(b, [26, 40, 33 + (v === 1 ? 1 : 0), 31], 2, bark[2]);
      leafMass(b, L[0][0] + f, L[0][1], L[0][2], L[0][3], leaf, rnd, false);
      for (let i = 1; i < L.length; i++) leafMass(b, L[i][0], L[i][1], L[i][2], L[i][3], leaf, rnd);
      extra?.(b, rnd);
    });
  });
}

/** One conifer tier: zig-zag hem, lit left half, chevron needle strokes, shaded under the tier above. */
function pineTier(b: Ctx, cx: number, top: number, bottom: number, hw: number, ramp: Ramp, snow: boolean, under: boolean): void {
  const H = bottom - top;
  const halfAt = (y: number) => 1 + ((y - top) / H) * hw;
  for (let y = top; y <= bottom; y++) {
    const half = halfAt(y);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    for (let x = x0; x <= x1; x++) {
      const k = (((x - cx) % 6) + 6) % 6;
      const depth = k < 3 ? k : 5 - k;
      if (y > bottom - 3 && y - (bottom - 3) > depth) continue;
      const rel = (x - cx) / Math.max(1, half);
      let tone = rel < -0.45 ? 4 : rel < 0.05 ? 3 : rel < 0.55 ? 2 : 1;
      if (y >= bottom - 2) tone = Math.max(0, tone - 2);
      else if (y >= bottom - 4) tone = Math.max(1, tone - 1);
      if (under && y < top + H * 0.45) tone = Math.max(0, tone - 2);
      px(b, x, y, ramp[tone]);
    }
  }
  // chevron needle strokes: light "/" on the lit half, dark "\\" on the shaded half
  for (let y = top + 4, r = 0; y < bottom - 4; y += 4, r++) {
    const half = halfAt(y) - 2;
    for (let xo = -Math.floor(half) + (r & 1) * 2; xo <= half - 1; xo += 4) {
      const x = Math.round(cx + xo);
      if (xo < -1) seg(b, x, y, x - 1, y + 2, ramp[5]);
      else if (xo > 1) seg(b, x, y, x + 1, y + 2, ramp[0]);
    }
  }
  if (snow) {
    for (let y = top; y <= top + Math.round(H * 0.55); y++) {
      const t = (y - top) / H;
      const half = 1 + t * hw;
      const x0 = Math.round(cx - half);
      const x1 = Math.round(cx + half * (0.55 - t));
      if (x1 >= x0) box(b, x0, y, x1 - x0 + 1, 1, y === top ? SNOW[4] : SNOW[3]);
      px(b, x0, y, SNOW[2]);
    }
    for (let x = Math.round(cx - hw) + 1; x < cx + hw - 2; x += 5) box(b, x, bottom - 3, 2, 1, SNOW[2]);
  }
}

function pineTree(scene: Phaser.Scene, key: string, ramp: Ramp, snow: boolean, v = 0): void {
  // tier [top, bottom, half width] × 3, bottom tier first; variant 1 is slimmer and taller in the middle
  const tiers =
    v === 2
      ? ([
          [30, 51, 15],
          [18, 39, 12],
          [8, 28, 9],
        ] as const)
      : v === 1
      ? ([
          [27, 51, 16],
          [13, 37, 14],
          [2, 23, 8],
        ] as const)
      : ([
          [28, 51, 17],
          [15, 37, 13],
          [3, 24, 9],
        ] as const);
  // frame 1: the top tier and the tip a pixel downwind (sway strip, see broadTree; pines are never mirrored by
  // render/stage.ts PROP_NO_FLIP, so they need no mirrored cell)
  stripTex(scene, key, 40, 64, 2, (c, f) => {
    if (snow) disc(c, 20, 60, 12, 3, 'rgba(238,244,250,0.75)');
    sprite(c, 40, 64, (b) => {
      box(b, 17, 48, 6, 13, DEAD_BARK[3]);
      box(b, 17, 48, 2, 13, DEAD_BARK[4]);
      box(b, 21, 48, 2, 13, DEAD_BARK[2]);
      box(b, 16, 59, 8, 2, DEAD_BARK[2]);
      tiers.forEach(([top, bottom, hw], i) => pineTier(b, 20 + (i === 2 ? f : 0), top, bottom, hw, ramp, snow, i < 2));
      box(b, 19 + f, tiers[2][0] - 2, 2, 3, snow ? SNOW[3] : ramp[4]);
    });
  });
}

/** Chunky faceted rock: lit top, mid front-left face, shaded right face, dark foot. Coordinates in a 30x24 box. */
function rockPx(b: Ctx, ox: number, oy: number, s: number, ramp: Ramp, mossy: boolean, rnd: () => number): void {
  const P = (pts: number[]) => pts.map((v, i) => Math.round(i % 2 ? oy + v * s : ox + v * s));
  fpoly(b, P([1, 21, 3, 11, 9, 5, 17, 2, 25, 4, 30, 11, 30, 21, 25, 24, 7, 24]), ramp[2]);
  fpoly(b, P([1, 21, 3, 11, 10, 13, 12, 24, 7, 24]), ramp[3]);
  fpoly(b, P([3, 11, 9, 5, 17, 2, 25, 4, 30, 11, 21, 13, 10, 13]), ramp[4]);
  fpoly(b, P([21, 13, 30, 11, 30, 21, 25, 24, 20, 24]), ramp[1]);
  fpoly(b, P([1, 21, 7, 24, 25, 24, 30, 21, 30, 23, 25, 25, 7, 25, 1, 23]), ramp[0]);
  // lit rims and a crack
  seg(b, ...(P([4, 11, 9, 6]) as [number, number, number, number]), ramp[5] ?? ramp[4]);
  seg(b, ...(P([10, 5, 17, 3]) as [number, number, number, number]), ramp[5] ?? ramp[4]);
  seg(b, ...(P([10, 13, 20, 13]) as [number, number, number, number]), ramp[3]);
  seg(b, ...(P([15, 13, 16, 18]) as [number, number, number, number]), ramp[1]);
  seg(b, ...(P([16, 18, 14, 22]) as [number, number, number, number]), ramp[1]);
  for (let i = 0; i < 3; i++) {
    const [x, y] = P([12 + rnd() * 10, 6 + rnd() * 5]);
    px(b, x, y, ramp[3]);
  }
  if (mossy) {
    const [mx, my] = P([7, 6]);
    mossCap(b, mx, my, Math.round(9 * s));
  }
}

/**
 * Low flat stone (slab): lit top face, mid front face, shaded right end, dark foot, a crack and pits. Same top-left
 * light as rockPx. Coordinates in a 30x14 box, scaled by `s`.
 */
function slabPx(b: Ctx, ox: number, oy: number, s: number, ramp: Ramp, mossy: boolean, rnd: () => number): void {
  const P = (pts: number[]) => pts.map((v, i) => Math.round(i % 2 ? oy + v * s : ox + v * s));
  fpoly(b, P([0, 8, 3, 3, 12, 0, 24, 1, 30, 5, 30, 11, 26, 14, 3, 14, 0, 11]), ramp[2]);
  fpoly(b, P([3, 3, 12, 0, 24, 1, 30, 5, 22, 7, 6, 7]), ramp[4]);
  fpoly(b, P([22, 7, 30, 5, 30, 11, 26, 14, 21, 14]), ramp[1]);
  fpoly(b, P([0, 11, 3, 14, 26, 14, 30, 11, 30, 13, 26, 15, 3, 15, 0, 13]), ramp[0]);
  seg(b, ...(P([4, 3, 12, 1]) as [number, number, number, number]), ramp[5] ?? ramp[4]);
  seg(b, ...(P([6, 7, 22, 7]) as [number, number, number, number]), ramp[3]);
  seg(b, ...(P([14, 7, 15, 10]) as [number, number, number, number]), ramp[1]);
  seg(b, ...(P([15, 10, 13, 13]) as [number, number, number, number]), ramp[1]);
  for (let i = 0; i < 4; i++) {
    const [x, y] = P([5 + rnd() * 20, 8 + rnd() * 4]);
    px(b, x, y, ramp[1]);
  }
  if (mossy) {
    const [mx, my] = P([5, 1]);
    mossCap(b, mx, my, Math.round(13 * s));
  }
}

/** Irregular moss cap: lit top edge, darker underside and a couple of drips. */
function mossCap(b: Ctx, x: number, y: number, w: number): void {
  box(b, x + 1, y, w - 3, 1, R.moss[3]);
  box(b, x, y + 1, w, 1, R.moss[2]);
  box(b, x + 1, y + 2, w - 2, 1, R.moss[1]);
  px(b, x + 2, y + 1, R.moss[3]);
  box(b, x + 2, y + 3, 1, 2, R.moss[1]);
  box(b, x + w - 3, y + 3, 1, 1, R.moss[0]);
  px(b, x + Math.round(w / 2), y + 3, R.moss[0]);
}

/** Grass tuft at a sprite foot (pointy 3-4 px blades). */
function tuft(b: Ctx, x: number, y: number, ramp: Ramp = R.grass): void {
  px(b, x, y - 1, ramp[2]);
  px(b, x + 1, y - 3, ramp[3]);
  box(b, x + 1, y - 2, 1, 2, ramp[2]);
  px(b, x + 2, y - 2, ramp[1]);
  px(b, x + 3, y - 4, ramp[4]);
  box(b, x + 3, y - 3, 1, 3, ramp[3]);
  px(b, x + 4, y - 1, ramp[1]);
}

/** Pointed crystal shard: lit left face, dark right face, glint edge. */
function shard(b: Ctx, x: number, base: number, top: number, w: number, lean: number, ramp: Ramp): void {
  fpoly(b, [x - w, base, x - w + lean, top + w + 1, x + lean, top, x, base + 1], ramp[3]);
  fpoly(b, [x, base + 1, x + lean, top, x + w + lean, top + w + 1, x + w, base], ramp[1]);
  fpoly(b, [x - 1, base, x - 1 + lean * 0.9, top + 2, x + lean, top, x + 1, base], ramp[2]);
  seg(b, Math.round(x - w + 1), base - 2, Math.round(x - w + 1 + lean), top + w + 2, ramp[4]);
  px(b, Math.round(x + lean), top + 1, ramp[5] ?? ramp[4]);
}

/** Mushroom: cap dome with spots, gill band, stem. */
function shroom(b: Ctx, x: number, y: number, rx: number, ry: number, stemH: number, cap: Ramp, stem: Ramp = R.cream, spots = true): void {
  box(b, x - 2, y, 4, stemH, stem[2]);
  box(b, x - 2, y, 1, stemH, stem[3]);
  box(b, x + 1, y, 1, stemH, stem[1]);
  box(b, x - 3, y + stemH - 1, 6, 1, stem[1]);
  for (let yy = -ry; yy <= 0; yy++) {
    const half = Math.round(rx * Math.sqrt(1 - (yy / (ry + 0.5)) ** 2));
    box(b, x - half, y + yy, half * 2 + 1, 1, cap[2]);
    box(b, x + half - Math.max(1, Math.round(half * 0.35)), y + yy, Math.max(1, Math.round(half * 0.35)) + 1, 1, cap[1]);
    if (yy < -ry * 0.3) box(b, x - half + 1, y + yy, Math.max(1, Math.round(half * 0.5)), 1, cap[3]);
  }
  box(b, x - rx + 1, y + 1, rx * 2 - 1, 1, cap[0]);
  box(b, x - rx + 2, y + 1, rx * 2 - 3, 1, stem[1]);
  px(b, x - Math.round(rx * 0.4), y - ry + 1, cap[4]);
  if (spots) {
    px(b, x + Math.round(rx * 0.3), y - Math.round(ry * 0.6), R.cream[4]);
    px(b, x - Math.round(rx * 0.55), y - Math.round(ry * 0.25), R.cream[3]);
    if (rx >= 5) box(b, x + Math.round(rx * 0.55) - 1, y - 1, 2, 1, R.cream[3]);
  }
}

function drawProps(scene: Phaser.Scene): void {
  const darkMotes = (b: Ctx, rnd: () => number) => {
    for (let i = 0; i < 5; i++) {
      const x = Math.round(8 + rnd() * 32);
      const y = Math.round(8 + rnd() * 30);
      px(b, x, y, '#b89ae8');
      px(b, x + 1, y + 1, '#6a4ea8');
    }
  };
  broadTree(scene, 'tree', R.leaf, R.bark);
  broadTree(scene, 'darktree', LEAF_DARK, DEAD_BARK, darkMotes);
  pineTree(scene, 'pine', PINE, false);
  pineTree(scene, 'frostpine', FROST_PINE, true);
  // Layout variants (render/stage.ts picks one per tile, so dense forests stop repeating one sprite in a grid).
  broadTree(scene, 'tree~1', R.leaf, R.bark, undefined, 1);
  broadTree(scene, 'tree~2', R.leaf, R.bark, undefined, 2);
  broadTree(scene, 'darktree~1', LEAF_DARK, DEAD_BARK, darkMotes, 1);
  broadTree(scene, 'darktree~2', LEAF_DARK, DEAD_BARK, darkMotes, 2);
  pineTree(scene, 'pine~1', PINE, false, 1);
  pineTree(scene, 'frostpine~1', FROST_PINE, true, 1);
  pineTree(scene, 'pine~2', PINE, false, 2);
  pineTree(scene, 'frostpine~2', FROST_PINE, true, 2);

  canvasTex(scene, 'deadtree', 40, 56, (c) => {
    sprite(c, 40, 56, (b) => {
      const B = DEAD_BARK;
      fpoly(b, [14, 53, 17, 47, 17, 24, 23, 22, 23, 47, 27, 53], B[3]);
      brush(b, [19, 36, 12, 26, 8, 15], 3, B[3]);
      brush(b, [21, 30, 29, 20, 31, 9], 3, B[2]);
      brush(b, [20, 24, 19, 11], 3, B[3]);
      brush(b, [12, 26, 5, 22], 2, B[3]);
      brush(b, [29, 20, 36, 17], 2, B[2]);
      brush(b, [8, 15, 5, 7], 2, B[3]);
      brush(b, [8, 15, 12, 9], 2, B[3]);
      brush(b, [31, 9, 34, 3], 2, B[2]);
      brush(b, [31, 9, 27, 4], 2, B[2]);
      brush(b, [19, 11, 22, 4], 2, B[3]);
      brush(b, [19, 11, 16, 6], 1, B[3]);
      box(b, 17, 24, 2, 28, B[4]);
      box(b, 21, 24, 2, 28, B[1]);
      seg(b, 18, 35, 11, 26, B[4]);
      seg(b, 21, 29, 28, 20, B[4]);
      seg(b, 19, 23, 18, 12, B[4]);
      box(b, 18, 40, 1, 4, B[1]);
      box(b, 20, 30, 1, 3, B[1]);
      disc(b, 20, 34, 1.5, 2, B[0]);
      fpoly(b, [17, 47, 11, 54, 16, 54], B[2]);
      fpoly(b, [23, 47, 29, 54, 24, 54], B[1]);
    });
  });

  canvasTex(scene, 'bush', 32, 28, (c) => {
    const rnd = artRng(keySeed('bush'));
    sprite(c, 32, 28, (b) => {
      leafMass(b, 16, 16, 14, 10, R.leaf, rnd, false, 3.6);
      for (const [x, y] of [
        [8, 17],
        [19, 20],
        [15, 10],
        [23, 14],
        [11, 22],
      ]) {
        box(b, x, y, 2, 2, R.crimson[2]);
        px(b, x, y, R.crimson[4]);
        px(b, x + 1, y + 1, R.crimson[1]);
      }
    });
  });

  canvasTex(scene, 'bush~1', 32, 28, (c) => {
    // two round lobes, cream blossoms instead of berries
    const rnd = artRng(keySeed('bush~1'));
    sprite(c, 32, 28, (b) => {
      leafMass(b, 11, 17, 9, 8, R.leaf, rnd, false, 3.4);
      leafMass(b, 21, 15, 9, 9, R.leaf, rnd, true, 3.4);
      for (const [x, y] of [
        [7, 15],
        [20, 10],
        [24, 18],
        [13, 21],
      ]) {
        px(b, x, y, R.cream[4]);
        px(b, x + 1, y, R.cream[3]);
        px(b, x, y + 1, R.cream[2]);
        px(b, x + 1, y + 1, R.gold[3]);
      }
    });
  });
  canvasTex(scene, 'bush~2', 32, 28, (c) => {
    // a low, wide shrub with grass at its foot
    const rnd = artRng(keySeed('bush~2'));
    sprite(c, 32, 28, (b) => {
      leafMass(b, 16, 19, 14, 7, R.leaf, rnd, false, 3.2);
      for (const [x, y] of [
        [10, 16],
        [22, 18],
      ]) {
        box(b, x, y, 2, 2, R.gold[2]);
        px(b, x, y, R.gold[4]);
      }
      tuft(b, 1, 27);
      tuft(b, 25, 27);
    });
  });

  canvasTex(scene, 'rock', 34, 30, (c) => {
    const rnd = artRng(keySeed('rock'));
    sprite(c, 34, 30, (b) => {
      rockPx(b, 2, 3, 1, R.stone, true, rnd);
      tuft(b, 2, 28);
      tuft(b, 26, 29);
    });
  });

  canvasTex(scene, 'boulder', 48, 40, (c) => {
    const rnd = artRng(keySeed('boulder'));
    sprite(c, 48, 40, (b) => {
      rockPx(b, 1, 2, 1.32, R.stone, true, rnd);
      rockPx(b, 29, 21, 0.58, R.stone, false, rnd);
      tuft(b, 3, 38);
      tuft(b, 22, 39);
    });
  });

  // Look variants (PROP_VARIANTS; render/stage.ts picks one per tile): same size and foot anchor as the base key, a
  // different composition each, light always from the top-left (never a mirrored sprite).
  canvasTex(scene, 'rock~1', 34, 30, (c) => {
    // two stones, the small one in front on the right
    const rnd = artRng(keySeed('rock~1'));
    sprite(c, 34, 30, (b) => {
      rockPx(b, 1, 8, 0.72, R.stone, true, rnd);
      rockPx(b, 19, 17, 0.45, R.stone, false, rnd);
      tuft(b, 14, 29);
    });
  });
  canvasTex(scene, 'rock~2', 34, 30, (c) => {
    // a low flat slab half sunk in the grass
    const rnd = artRng(keySeed('rock~2'));
    sprite(c, 34, 30, (b) => {
      slabPx(b, 2, 12, 1, R.stone, false, rnd);
      tuft(b, 0, 29);
      tuft(b, 27, 29);
      tuft(b, 15, 29);
    });
  });
  canvasTex(scene, 'boulder~1', 48, 40, (c) => {
    // a split boulder: two halves leaning together, a dark crevice between them
    const rnd = artRng(keySeed('boulder~1'));
    sprite(c, 48, 40, (b) => {
      rockPx(b, 20, 11, 0.92, R.stone, false, rnd);
      rockPx(b, 0, 13, 0.88, R.stone, true, rnd);
      box(b, 25, 19, 1, 16, R.stone[0]);
      box(b, 26, 21, 1, 13, R.stone[1]);
      tuft(b, 2, 38);
      tuft(b, 30, 39);
      tuft(b, 40, 38);
    });
  });
  canvasTex(scene, 'boulder~2', 48, 40, (c) => {
    // a low mossy slab with a small stone in front on the left
    const rnd = artRng(keySeed('boulder~2'));
    sprite(c, 48, 40, (b) => {
      slabPx(b, 2, 14, 1.45, R.stone, true, rnd);
      rockPx(b, 3, 25, 0.42, R.stone, false, rnd);
      mossCap(b, 30, 16, 9);
      tuft(b, 18, 39);
      tuft(b, 40, 38);
    });
  });

  canvasTex(scene, 'crystal', 32, 44, (c) => {
    halo(c, 16, 28, 16, '#8ce0f4', 0.32);
    sprite(c, 32, 44, (b) => {
      shard(b, 9, 38, 17, 4, -2, R.violet);
      shard(b, 23, 38, 14, 4, 2, R.cyan);
      shard(b, 16, 40, 3, 5, 0, R.cyan);
      shard(b, 27, 40, 30, 2, 1, R.violet);
      fpoly(b, [3, 42, 6, 37, 14, 36, 22, 37, 29, 38, 30, 42], R.stone[2]);
      box(b, 6, 37, 8, 1, R.stone[4]);
      box(b, 3, 41, 27, 1, R.stone[1]);
    });
    px(c, 15, 7, '#ffffff');
    px(c, 22, 18, '#ffffff');
  });

  canvasTex(scene, 'stalagmite', 28, 44, (c) => {
    sprite(c, 28, 44, (b) => {
      const cone = (x: number, base: number, top: number, w: number, ramp: Ramp) => {
        fpoly(b, [x - w, base, x - 1, top, x + 1, top, x + w, base], ramp[2]);
        fpoly(b, [x, top, x + 1, top, x + w, base, x + 1, base], ramp[1]);
        fpoly(b, [x - w, base, x - 1, top, x - 1, base], ramp[3]);
        for (let y = top + 6; y < base - 2; y += 6) {
          const t = (y - top) / (base - top);
          box(b, Math.round(x - w * t), y, Math.round(w * t * 2), 1, ramp[1]);
          box(b, Math.round(x - w * t), y + 1, Math.round(w * t), 1, ramp[4]);
        }
        seg(b, Math.round(x - w * 0.6), base - 2, x - 1, top + 2, ramp[4]);
        box(b, x - w, base - 1, w * 2, 1, ramp[0]);
      };
      cone(19, 41, 17, 6, R.warmStone);
      cone(10, 42, 3, 8, R.warmStone);
    });
  });

  canvasTex(scene, 'tombstone', 28, 36, (c) => {
    sprite(c, 28, 36, (b) => {
      const S = ['#2e2c38', '#46434f', '#625e6c', '#7f7a8a', '#9d98a8', '#bdb8c6'];
      // side thickness (right), then the face
      fpoly(b, [17, 9, 21, 12, 22, 33, 18, 33], S[1]);
      for (let y = 6; y < 33; y++) {
        const dy = y - 13;
        const half = dy < 0 ? Math.round(7 * Math.sqrt(Math.max(0, 1 - (dy / 7.5) ** 2))) : 7;
        box(b, 13 - half, y, half * 2 + 1, 1, S[3]);
        box(b, 13 - half, y, 1, 1, S[4]);
        box(b, 13 + half - 1, y, 2, 1, S[2]);
      }
      box(b, 9, 7, 5, 1, S[5]);
      box(b, 7, 9, 2, 1, S[4]);
      // carved star rune + epitaph lines
      fpoly(b, [13, 11, 15, 15, 13, 19, 11, 15], S[1]);
      px(b, 13, 15, S[3]);
      box(b, 9, 22, 9, 1, S[1]);
      box(b, 9, 23, 9, 1, S[4]);
      box(b, 10, 26, 7, 1, S[1]);
      box(b, 10, 27, 7, 1, S[4]);
      seg(b, 16, 8, 14, 12, S[1]);
      // moss + grass
      disc(b, 8, 32, 4, 1.6, R.moss[1]);
      box(b, 6, 31, 4, 1, R.moss[2]);
      tuft(b, 3, 34);
      tuft(b, 18, 34);
    });
  });

  const TOMB = ['#2e2c38', '#46434f', '#625e6c', '#7f7a8a', '#9d98a8', '#bdb8c6'];
  canvasTex(scene, 'tombstone~1', 28, 36, (c) => {
    // a stone grave cross, a chip off one arm, moss at its foot
    sprite(c, 28, 36, (b) => {
      const S = TOMB;
      box(b, 16, 9, 2, 24, S[1]); // side thickness
      box(b, 11, 6, 5, 27, S[3]);
      box(b, 11, 6, 1, 27, S[4]);
      box(b, 15, 6, 1, 27, S[2]);
      box(b, 5, 12, 17, 5, S[3]);
      box(b, 5, 12, 17, 1, S[5]);
      box(b, 5, 16, 17, 1, S[2]);
      box(b, 22, 13, 1, 4, S[1]);
      box(b, 11, 6, 5, 1, S[5]);
      px(b, 5, 16, S[1]); // the chipped arm end
      px(b, 6, 16, S[2]);
      seg(b, 13, 19, 12, 24, S[1]);
      box(b, 9, 31, 10, 2, S[2]); // plinth
      box(b, 9, 31, 10, 1, S[4]);
      disc(b, 18, 32, 3.5, 1.5, R.moss[1]);
      box(b, 16, 31, 4, 1, R.moss[2]);
      tuft(b, 3, 34);
      tuft(b, 20, 35);
    });
  });
  canvasTex(scene, 'tombstone~2', 28, 36, (c) => {
    // an old square-topped stone, leaning, its top corner broken off; rubble at its foot
    const rnd = artRng(keySeed('tombstone~2'));
    sprite(c, 28, 36, (b) => {
      const S = TOMB;
      fpoly(b, [19, 12, 22, 14, 21, 33, 18, 33], S[1]);
      fpoly(b, [7, 12, 14, 10, 17, 13, 19, 12, 18, 33, 8, 33], S[3]);
      fpoly(b, [7, 12, 14, 10, 15, 11, 8, 13], S[5]);
      box(b, 7, 13, 1, 20, S[4]);
      box(b, 17, 14, 1, 19, S[2]);
      box(b, 9, 18, 7, 1, S[1]);
      box(b, 9, 19, 7, 1, S[4]);
      box(b, 10, 22, 5, 1, S[1]);
      seg(b, 15, 12, 12, 17, S[1]);
      for (let i = 0; i < 3; i++) {
        const x = 4 + Math.round(rnd() * 3) + i * 7;
        box(b, x, 32, 2, 1, S[2]);
        px(b, x, 31, S[4]);
      }
      disc(b, 9, 33, 3, 1.3, R.moss[1]);
      tuft(b, 2, 35);
      tuft(b, 19, 35);
    });
  });

  canvasTex(scene, 'mushroom', 28, 30, (c) => {
    sprite(c, 28, 30, (b) => {
      shroom(b, 19, 19, 5, 4, 7, R.crimson);
      shroom(b, 10, 15, 7, 6, 11, ['#4a1c10', '#7a3218', '#a84a24', '#c86a38', '#e8a070']);
      shroom(b, 4, 23, 3, 2, 4, R.crimson, R.cream, false);
      tuft(b, 20, 28);
    });
  });

  // sway strip: cell 1 moves the crown and the strands' lower halves a pixel downwind (cell 2: mirrored lean)
  stripTex(scene, 'duskwillow', 56, 72, SWAY_CELLS, (c, cell) => {
    const f = swayLean(cell);
    const rnd = artRng(keySeed('duskwillow'));
    halo(c, 13, 47, 9, '#ffb0e8', 0.35);
    halo(c, 43, 43, 9, '#9fe8ff', 0.35);
    sprite(c, 56, 72, (b) => {
      trunkPx(b, 28, 34, 69, 9, DUSK_BARK, rnd);
      brush(b, [26, 42, 18, 31], 3, DUSK_BARK[3]);
      brush(b, [31, 40, 39, 30], 3, DUSK_BARK[2]);
      leafMass(b, 28 + f, 14, 19, 12, LEAF_DUSK, rnd, false);
      leafMass(b, 14, 26, 11, 8, LEAF_DUSK, rnd);
      leafMass(b, 42, 25, 11, 8, LEAF_DUSK, rnd);
      // weeping strands
      for (let i = 0; i < 17; i++) {
        const x = 5 + Math.round(i * 2.8);
        const top = 26 + Math.round(Math.abs(i - 8) * 0.5);
        const len = 10 + ((i * 7) % 11) - (i === 0 || i === 16 ? 4 : 0);
        const col = LEAF_DUSK[2 + (i % 3)];
        const dx = i < 8 ? -1 : 1;
        box(b, x, top, 1, Math.round(len * 0.6), col);
        box(b, x + dx + f, top + Math.round(len * 0.6), 1, len - Math.round(len * 0.6), col);
        px(b, x, top + 2, LEAF_DUSK[5]);
        if (i % 4 === 1) box(b, x + dx + f, top + len, 1, 2, i % 8 === 1 ? '#f0a0d8' : '#a8e0ff');
      }
      // glowing blossom lanterns
      disc(b, 13, 47, 2.5, 3, '#f8b8e8');
      box(b, 12, 45, 1, 2, '#ffffff');
      disc(b, 43, 43, 2.5, 3, '#b8ecff');
      box(b, 42, 41, 1, 2, '#ffffff');
    });
  });

  canvasTex(scene, 'basalt_spire', 32, 60, (c) => {
    halo(c, 15, 54, 12, '#ff6a20', 0.3);
    sprite(c, 32, 60, (b) => {
      const col = (x: number, top: number, base: number, w: number) => {
        box(b, x, top + 3, w, base - top - 3, BASALT[2]);
        box(b, x, top + 3, 2, base - top - 3, BASALT[3]);
        box(b, x + w - 3, top + 3, 3, base - top - 3, BASALT[1]);
        box(b, x + w - 1, top + 3, 1, base - top - 3, BASALT[0]);
        fpoly(b, [x, top + 3, x + w * 0.25, top, x + w * 0.75, top, x + w, top + 3, x + w * 0.75, top + 6, x + w * 0.25, top + 6], BASALT[4]);
        box(b, x + w * 0.25, top, w * 0.5, 1, BASALT[5]);
        for (let y = top + 12; y < base - 4; y += 9) {
          box(b, x, y, w, 1, BASALT[0]);
          box(b, x, y + 1, w - 3, 1, BASALT[3]);
        }
      };
      col(13, 4, 55, 10);
      col(3, 18, 56, 10);
      col(21, 27, 57, 9);
      seg(b, 8, 55, 10, 50, R.flame[2]);
      seg(b, 10, 50, 9, 46, R.flame[1]);
      seg(b, 25, 56, 27, 51, R.flame[2]);
      px(b, 9, 50, R.flame[4]);
      px(b, 26, 53, R.flame[3]);
    });
  });

  // sway strip: cell 1 bends the upper blades and the cattails a pixel downwind (cell 2: mirrored lean)
  stripTex(scene, 'reeds', 28, 34, SWAY_CELLS, (c, cell) => {
    const f = swayLean(cell);
    sprite(c, 28, 34, (b) => {
      const blades: [number, number, number, number][] = [
        [5, 31, -4, 1],
        [8, 31, -1, 2],
        [11, 32, -3, 1],
        [14, 32, 1, 3],
        [17, 31, 3, 2],
        [20, 31, 5, 3],
        [23, 31, 2, 1],
        [10, 32, 2, 3],
      ];
      for (const [x, base, lean, tone] of blades) {
        const tipY = base - 16 - ((x * 3) % 7);
        seg(b, x, base, x + Math.round(lean * 0.4), base - 9, R.grass[tone]);
        seg(b, x + Math.round(lean * 0.4), base - 9, x + lean + f, tipY, R.grass[Math.min(4, tone + 1)]);
        px(b, x + 1, base - 1, R.grass[tone - 1 < 0 ? 0 : tone - 1]);
      }
      for (const [x, top] of [
        [13, 5],
        [18, 3],
      ]) {
        if (f) seg(b, x, 30, x + f, top + 7, R.grass[1]);
        else box(b, x, top + 7, 1, 31 - top - 7, R.grass[1]);
        box(b, x - 1 + f, top, 3, 7, R.bark[2]);
        box(b, x - 1 + f, top, 1, 7, R.bark[4]);
        box(b, x + 1 + f, top + 1, 1, 6, R.bark[1]);
        px(b, x + f, top - 1, R.grass[3]);
      }
    });
  });
  drawBigProps(scene);
}

// ================================================================== size tiers (SPEC-v4 §11.2 B)
// The hero is 40 px tall. S: under a tile, 8–24 px · M: one tile, 32–64 px (the keys above) · L: 64–104 px ·
// XL: 104–160 px. Texture keys: propKey(kind, tier, look). Every tier of the tree and rock families has three
// drawn looks: different silhouettes, never a recolour or a mirror. Trees are outlined in the darkest foliage step,
// rocks in the darkest stone step, so the world sits back behind the actors' warm-black outline.

export type PropTier = 'S' | 'M' | 'L' | 'XL';

/** Texture key of a prop look: M keeps the v2 keys ('tree', 'tree~1'); other tiers are '<kind>_<tier>[~n]'. */
export function propKey(kind: string, tier: PropTier = 'M', look = 0): string {
  const base = tier === 'M' ? kind : `${kind}_${tier}`;
  return look > 0 ? `${base}~${look}` : base;
}

/** Looks drawn per '<kind>_<tier>' (M tiers: PROP_VARIANTS + 1). */
export const PROP_TIER_LOOKS: Readonly<Record<string, number>> = {
  tree_S: 3, tree_L: 3, tree_XL: 3, tree_mass: 3,
  darktree_S: 3, darktree_L: 3, darktree_XL: 3, darktree_mass: 3,
  duskwillow_S: 3, duskwillow_L: 3, duskwillow_XL: 3, duskwillow_mass: 3,
  pine_S: 3, pine_L: 3, pine_XL: 3, pine_mass: 3,
  frostpine_S: 3, frostpine_L: 3, frostpine_XL: 3, frostpine_mass: 3,
  deadtree_L: 3, deadtree_XL: 3,
  rock_S: 3, rock_L: 3, rock_XL: 3,
  menhir_L: 3,
  log_L: 3,
};

/** Canvas size (px) of each tiered look; the foot (origin 0.5, 1) is the bottom-centre. */
export const PROP_TIER_SIZE: Readonly<Record<string, readonly [w: number, h: number]>> = {
  tree_S: [28, 36], tree_L: [96, 108], tree_XL: [136, 156], tree_mass: [104, 84],
  pine_S: [24, 36], pine_L: [64, 112], pine_XL: [84, 152], pine_mass: [104, 88],
  deadtree_L: [76, 104], deadtree_XL: [104, 140],
  rock_S: [22, 16], rock_L: [84, 64], rock_XL: [120, 88],
  menhir_L: [44, 88],
  log_L: [112, 46],
};

/** Leaf ramps of the tree kinds (dark -> light): the value plan's test seam (tree masses sit below the ground). */
export const TREE_LEAF_RAMPS: Readonly<Record<string, Ramp>> = { tree: R.leaf, darktree: LEAF_DARK, duskwillow: LEAF_DUSK, pine: PINE, frostpine: FROST_PINE };

/** A ramp one step darker (the darkest step repeats): back canopy layers, second forest rows, canopy masses. */
const darker = (r: Ramp): Ramp => [r[0], ...r.slice(0, r.length - 1)];

type MassDef = readonly [cx: number, cy: number, rx: number, ry: number];
interface BroadDef {
  /** [trunk centre x, trunk top y, trunk width] (+ a second trunk for forked trees). */
  trunks: readonly (readonly [number, number, number])[];
  /** Boughs as brush polylines [x0, y0, x1, y1, width]. */
  boughs: readonly (readonly [number, number, number, number, number])[];
  /** Canopy layers back to front: the back layer is drawn one step darker. */
  back: readonly MassDef[];
  front: readonly MassDef[];
}

// Three grown-tree silhouettes in a 96 x 108 box: a round oak, a tall narrow elm and a forked tree with two crowns.
const BROAD_L: readonly BroadDef[] = [
  {
    trunks: [[48, 56, 12]],
    boughs: [[45, 70, 30, 54, 3], [51, 66, 66, 52, 3]],
    back: [[48, 50, 34, 16], [48, 26, 28, 18]],
    front: [[46, 26, 30, 20], [22, 46, 18, 14], [72, 44, 19, 14], [48, 58, 22, 9]],
  },
  {
    trunks: [[48, 50, 10]],
    boughs: [[46, 66, 36, 52, 3], [50, 60, 60, 46, 2]],
    back: [[48, 44, 24, 18], [48, 20, 18, 14]],
    front: [[48, 18, 20, 15], [38, 36, 19, 13], [60, 40, 18, 13], [47, 54, 18, 9]],
  },
  {
    trunks: [[44, 60, 12]],
    boughs: [[42, 66, 26, 50, 4], [48, 74, 64, 50, 5], [62, 54, 72, 40, 3]],
    back: [[30, 42, 24, 16], [68, 34, 22, 16]],
    front: [[28, 34, 23, 17], [70, 24, 21, 16], [50, 50, 20, 10], [78, 44, 12, 9]],
  },
];
// Hero trees in a 136 x 156 box: 128–152 px tall, three to four heroes.
const BROAD_XL: readonly BroadDef[] = [
  {
    trunks: [[68, 86, 18]],
    boughs: [[62, 106, 38, 82, 5], [74, 100, 100, 78, 5], [68, 90, 66, 66, 4]],
    back: [[68, 74, 52, 24], [68, 40, 44, 28], [68, 20, 30, 14]],
    front: [[64, 34, 44, 28], [30, 68, 26, 20], [106, 64, 27, 20], [68, 86, 32, 12], [84, 18, 22, 12]],
  },
  {
    trunks: [[66, 78, 16]],
    boughs: [[62, 100, 46, 78, 4], [70, 92, 90, 70, 4]],
    back: [[66, 62, 38, 26], [66, 28, 28, 22]],
    front: [[66, 22, 30, 20], [48, 48, 28, 19], [88, 54, 26, 18], [62, 74, 28, 12], [96, 30, 16, 12]],
  },
  {
    trunks: [[60, 92, 18]],
    boughs: [[54, 104, 30, 78, 5], [66, 112, 90, 76, 7], [88, 80, 106, 60, 4], [58, 96, 64, 70, 4]],
    back: [[38, 62, 34, 22], [96, 50, 32, 24], [66, 30, 26, 18]],
    front: [[34, 50, 32, 24], [100, 36, 30, 22], [66, 24, 24, 16], [68, 78, 28, 12], [112, 66, 18, 12]],
  },
];

/** A big broad-leaf tree: forked trunks, boughs, a darker back canopy and a lit front canopy of several masses. */
function bigBroad(scene: Phaser.Scene, key: string, w: number, h: number, d: BroadDef, leaf: Ramp, bark: Ramp, pr: number, extra?: (b: Ctx, rnd: () => number) => void): void {
  // the crown hangs low: about a third of the trunk shows (a bare pole under a ball reads as a lollipop)
  const drop = Math.round(h * 0.1);
  canvasTex(scene, key, w, h, (c) => {
    const rnd = artRng(keySeed(key));
    sprite(
      c,
      w,
      h,
      (b) => {
        for (const [cx, top, tw] of d.trunks) {
          trunkPx(b, cx, top, h - 4, tw, bark, rnd);
          // the crown's shade on the trunk (the leaves below cover its upper part)
          const shadeTo = Math.min(h - 22, top + drop + Math.round(h * 0.16));
          box(b, cx - tw / 2, top, tw, shadeTo - top, bark[2]);
          box(b, cx - tw / 2, top, tw, shadeTo - top - 3, bark[1]);
        }
        for (const [x0, y0, x1, y1, bw] of d.boughs) brush(b, [x0, y0 + drop, x1, y1 + drop], bw, bark[x1 < x0 ? 2 : 1]);
        const back = darker(leaf);
        for (const [cx, cy, rx, ry] of d.back) leafMass(b, cx, cy + drop, rx, ry, back, rnd, false, pr);
        for (let i = 0; i < d.front.length; i++) {
          const [cx, cy, rx, ry] = d.front[i];
          leafMass(b, cx, cy + drop, rx, ry, leaf, rnd, true, pr);
        }
        extra?.(b, rnd);
        tuft(b, Math.round(d.trunks[0][0] - d.trunks[0][2] / 2 - 9), h - 2);
        tuft(b, Math.round(d.trunks[0][0] + d.trunks[0][2] / 2 + 4), h - 1);
      },
      leaf[0],
    );
  });
}

/** A trunkless canopy mass (deep forest interior): one solid, dark crown cluster. */
function canopyMass(scene: Phaser.Scene, key: string, leaf: Ramp, v: number): void {
  const L: readonly (readonly MassDef[])[] = [
    [[52, 46, 48, 30], [30, 30, 24, 18], [74, 28, 26, 18], [52, 18, 22, 12]],
    [[52, 48, 48, 28], [40, 26, 30, 20], [80, 36, 20, 16]],
    [[52, 46, 48, 30], [24, 36, 20, 16], [62, 24, 32, 18]],
  ];
  canvasTex(scene, key, 104, 84, (c) => {
    const rnd = artRng(keySeed(key));
    const dk = darker(leaf);
    sprite(c, 104, 84, (b) => {
      const m = L[v % L.length];
      leafMass(b, m[0][0], m[0][1], m[0][2], m[0][3], darker(dk), rnd, false, 6);
      for (let i = 1; i < m.length; i++) leafMass(b, m[i][0], m[i][1], m[i][2], m[i][3], dk, rnd, true, 6);
    }, leaf[0]);
  });
}

/** A sapling: a thin stem and one small crown (three shapes). */
function sapling(scene: Phaser.Scene, key: string, leaf: Ramp, bark: Ramp, v: number): void {
  canvasTex(scene, key, 28, 36, (c) => {
    const rnd = artRng(keySeed(key));
    sprite(c, 28, 36, (b) => {
      const lean = v === 1 ? 2 : v === 2 ? -1 : 0;
      brush(b, [14, 34, 14 + lean, 18], 2, bark[3]);
      px(b, 13, 33, bark[2]);
      px(b, 15, 34, bark[1]);
      if (v === 0) leafMass(b, 14, 13, 10, 9, leaf, rnd, false, 3.4);
      else if (v === 1) {
        leafMass(b, 16, 10, 8, 7, leaf, rnd, false, 3.2);
        leafMass(b, 10, 19, 6, 5, leaf, rnd, true, 3);
      } else {
        leafMass(b, 13, 16, 11, 6, leaf, rnd, false, 3.2);
        leafMass(b, 13, 8, 6, 5, leaf, rnd, true, 3);
      }
      tuft(b, 4, 35);
    }, leaf[0]);
  });
}

/** A tall conifer of several tiers: [top, bottom, half width] bottom tier first. */
function bigPine(scene: Phaser.Scene, key: string, w: number, h: number, tiers: readonly (readonly [number, number, number])[], ramp: Ramp, snow: boolean, lean = 0): void {
  canvasTex(scene, key, w, h, (c) => {
    const cx = w / 2;
    if (snow) disc(c, cx, h - 4, w * 0.3, 3, 'rgba(238,244,250,0.75)');
    sprite(c, w, h, (b) => {
      const tw = Math.max(6, Math.round(w / 9));
      box(b, cx - tw / 2, tiers[0][1] - 6, tw, h - 3 - (tiers[0][1] - 6), DEAD_BARK[3]);
      box(b, cx - tw / 2, tiers[0][1] - 6, 2, h - 3 - (tiers[0][1] - 6), DEAD_BARK[4]);
      box(b, cx + tw / 2 - 3, tiers[0][1] - 6, 3, h - 3 - (tiers[0][1] - 6), DEAD_BARK[2]);
      box(b, cx - tw / 2 - 2, h - 5, tw + 4, 2, DEAD_BARK[2]);
      box(b, cx - tw / 2 - 1, tiers[0][1] - 6, tw + 2, 4, DEAD_BARK[0]);
      tiers.forEach(([top, bottom, hw], i) => pineTier(b, cx + Math.round((lean * i) / tiers.length), top, bottom, hw, ramp, snow, i < tiers.length - 1));
      const tip = tiers[tiers.length - 1];
      box(b, cx + lean - 1, tip[0] - 2, 2, 3, snow ? SNOW[3] : ramp[4]);
    }, ramp[0]);
  });
}

/** A cluster of dark conifer tops with no trunks (deep pine forest). */
function pineMass(scene: Phaser.Scene, key: string, ramp: Ramp, snow: boolean, v: number): void {
  const tops: readonly (readonly [number, number, number])[][] = [
    [[24, 20, 20], [78, 26, 22], [52, 6, 24]],
    [[30, 10, 22], [80, 22, 20], [56, 30, 22]],
    [[20, 26, 18], [50, 12, 22], [84, 8, 18]],
  ];
  canvasTex(scene, key, 104, 88, (c) => {
    const dk = darker(ramp);
    sprite(c, 104, 88, (b) => {
      for (const [cx, top, hw] of [...tops[v % 3]].sort((p, q) => p[1] - q[1])) {
        pineTier(b, cx, top + 26, 86, hw + 6, dk, false, true);
        pineTier(b, cx, top + 12, top + 44, hw, dk, snow, true);
        pineTier(b, cx, top, top + 24, Math.round(hw * 0.6), dk, snow, false);
      }
    }, ramp[0]);
  });
}

/** A big dead tree grown from a seeded branching rule (three shapes per size). */
function bigDead(scene: Phaser.Scene, key: string, w: number, h: number, v: number): void {
  canvasTex(scene, key, w, h, (c) => {
    const rnd = artRng(keySeed(key) + v * 977);
    const B = DEAD_BARK;
    sprite(c, w, h, (b) => {
      const cx = w / 2 + (v === 1 ? -4 : v === 2 ? 5 : 0);
      const tw = Math.round(w / 8);
      const split = Math.round(h * 0.42);
      fpoly(b, [cx - tw - 5, h - 3, cx - tw / 2, h - 12, cx - tw / 2, split, cx + tw / 2, split - 2, cx + tw / 2, h - 12, cx + tw + 5, h - 3], B[3]);
      const grow = (x: number, y: number, ang: number, len: number, wd: number, depth: number): void => {
        const x1 = x + Math.cos(ang) * len;
        const y1 = y - Math.sin(ang) * len;
        brush(b, [x, y, x1, y1], Math.max(1, Math.round(wd)), ang > Math.PI / 2 ? B[3] : B[2]);
        seg(b, Math.round(x), Math.round(y - 1), Math.round(x1), Math.round(y1 - 1), B[4]);
        if (depth <= 0 || len < 6 || y1 < 14 || x1 < 12 || x1 > w - 12) return;
        const n = depth > 1 ? 2 : 1 + (rnd() < 0.5 ? 1 : 0);
        for (let i = 0; i < n; i++) grow(x1, y1, ang + (i === 0 ? 0.35 + rnd() * 0.4 : -(0.3 + rnd() * 0.45)), len * (0.6 + rnd() * 0.18), wd * 0.66, depth - 1);
      };
      const lim = v === 0 ? [2.0, 1.15, 1.6] : v === 1 ? [2.2, 1.5, 0.95] : [1.85, 1.3, 0.8];
      for (const a of lim) grow(cx + (a > 1.57 ? -1 : 1), split + 4, a, h * (0.15 + rnd() * 0.04), tw * 0.8, 3);
      box(b, cx - tw / 2, split, 2, h - 12 - split, B[4]);
      box(b, cx + tw / 2 - 2, split, 2, h - 12 - split, B[1]);
      disc(b, cx, split + (h - split) * 0.4, tw * 0.22, tw * 0.3, B[0]);
      for (let i = 0; i < 4; i++) box(b, Math.round(cx - tw / 2 + 2 + rnd() * (tw - 4)), Math.round(split + 6 + rnd() * (h - split - 24)), 1, 3 + Math.floor(rnd() * 4), B[1]);
      fpoly(b, [cx - tw / 2, h - 12, cx - tw - 8, h - 2, cx - tw / 2 - 1, h - 2], B[2]);
      fpoly(b, [cx + tw / 2, h - 12, cx + tw + 8, h - 2, cx + tw / 2 + 1, h - 2], B[1]);
    }, B[0]);
  });
}

function drawBigProps(scene: Phaser.Scene): void {
  const darkMotes = (w: number, h: number) => (b: Ctx, rnd: () => number) => {
    for (let i = 0; i < Math.round(w / 9); i++) {
      const x = Math.round(10 + rnd() * (w - 20));
      const y = Math.round(10 + rnd() * (h * 0.5));
      px(b, x, y, '#b89ae8');
      px(b, x + 1, y + 1, '#6a4ea8');
    }
  };
  // weeping strands and two blossom lanterns for the dusk willows
  const strands = (w: number, h: number) => (b: Ctx, rnd: () => number) => {
    for (let x = 8; x < w - 8; x += 3) {
      if (rnd() < 0.3) continue;
      const top = Math.round(h * 0.3 + rnd() * h * 0.2);
      const len = Math.round(10 + rnd() * h * 0.16);
      box(b, x, top, 1, len, LEAF_DUSK[2 + (x % 3)]);
      px(b, x, top + 2, LEAF_DUSK[5]);
      if (x % 12 === 2) box(b, x, top + len, 1, 2, x % 24 === 2 ? '#f0a0d8' : '#a8e0ff');
    }
    disc(b, w * 0.24, h * 0.62, 2.5, 3, '#f8b8e8');
    disc(b, w * 0.78, h * 0.56, 2.5, 3, '#b8ecff');
  };
  const broadKinds: readonly [string, Ramp, Ramp, ((w: number, h: number) => (b: Ctx, rnd: () => number) => void) | undefined][] = [
    ['tree', R.leaf, R.bark, undefined],
    ['darktree', LEAF_DARK, DEAD_BARK, darkMotes],
    ['duskwillow', LEAF_DUSK, DUSK_BARK, strands],
  ];
  for (const [kind, leaf, bark, extra] of broadKinds) {
    for (let v = 0; v < 3; v++) {
      sapling(scene, propKey(kind, 'S', v), leaf, bark, v);
      bigBroad(scene, propKey(kind, 'L', v), 96, 108, BROAD_L[v], leaf, bark, 5, extra?.(96, 108));
      bigBroad(scene, propKey(kind, 'XL', v), 136, 156, BROAD_XL[v], leaf, bark, 6.5, extra?.(136, 156));
      canopyMass(scene, `${kind}_mass${v ? `~${v}` : ''}`, leaf, v);
    }
  }
  // conifers: [top, bottom, half width] bottom tier first
  const PINE_S = [
    [[14, 31, 9], [3, 19, 6]],
    [[16, 31, 8], [6, 21, 6], [1, 11, 3]],
    [[12, 31, 10], [2, 17, 6]],
  ] as const;
  const PINE_L = [
    [[70, 100, 28], [50, 84, 24], [32, 64, 19], [16, 44, 14], [3, 26, 8]],
    [[72, 100, 24], [54, 86, 21], [38, 68, 18], [22, 50, 14], [10, 34, 10], [2, 18, 6]],
    [[64, 100, 30], [42, 78, 24], [22, 54, 17], [5, 32, 10]],
  ] as const;
  const PINE_XL = [
    [[104, 140, 38], [82, 122, 34], [62, 102, 29], [44, 82, 24], [28, 62, 18], [14, 42, 13], [3, 24, 8]],
    [[108, 140, 34], [88, 124, 31], [70, 106, 27], [52, 88, 23], [36, 70, 18], [22, 52, 14], [10, 34, 10], [2, 18, 6]],
    [[98, 140, 40], [72, 116, 34], [48, 90, 27], [28, 64, 20], [12, 42, 13], [3, 22, 7]],
  ] as const;
  for (const [kind, ramp, snow] of [['pine', PINE, false], ['frostpine', FROST_PINE, true]] as const) {
    for (let v = 0; v < 3; v++) {
      bigPine(scene, propKey(kind, 'S', v), 24, 36, PINE_S[v], ramp, snow);
      bigPine(scene, propKey(kind, 'L', v), 64, 112, PINE_L[v], ramp, snow, v === 2 ? 2 : 0);
      bigPine(scene, propKey(kind, 'XL', v), 84, 152, PINE_XL[v], ramp, snow, v === 1 ? -2 : 0);
      pineMass(scene, `${kind}_mass${v ? `~${v}` : ''}`, ramp, snow, v);
    }
  }
  for (let v = 0; v < 3; v++) {
    bigDead(scene, propKey('deadtree', 'L', v), 76, 104, v);
    bigDead(scene, propKey('deadtree', 'XL', v), 104, 140, v);
  }

  // ---- rocks. S: a few small stones · L: a boulder group two tiles wide · XL: an outcrop three tiles wide.
  const S = R.stone;
  canvasTex(scene, 'rock_S', 22, 16, (c) => {
    const rnd = artRng(keySeed('rock_S'));
    sprite(c, 22, 16, (b) => {
      rockPx(b, 1, 3, 0.42, S, false, rnd);
      rockPx(b, 13, 8, 0.26, S, false, rnd);
    }, S[0]);
  });
  canvasTex(scene, 'rock_S~1', 22, 16, (c) => {
    const rnd = artRng(keySeed('rock_S~1'));
    sprite(c, 22, 16, (b) => {
      slabPx(b, 2, 7, 0.55, S, false, rnd);
      tuft(b, 15, 15);
    }, S[0]);
  });
  canvasTex(scene, 'rock_S~2', 22, 16, (c) => {
    const rnd = artRng(keySeed('rock_S~2'));
    sprite(c, 22, 16, (b) => {
      rockPx(b, 6, 2, 0.36, S, true, rnd);
      rockPx(b, 0, 9, 0.22, S, false, rnd);
      rockPx(b, 15, 10, 0.2, S, false, rnd);
    }, S[0]);
  });
  canvasTex(scene, 'rock_L', 84, 64, (c) => {
    // one great boulder, a middle one leaning on it and a small stone in front
    const rnd = artRng(keySeed('rock_L'));
    sprite(c, 84, 64, (b) => {
      rockPx(b, 3, 3, 1.72, S, true, rnd);
      rockPx(b, 46, 26, 1.18, S, false, rnd);
      rockPx(b, 30, 46, 0.6, S, true, rnd);
      tuft(b, 2, 62);
      tuft(b, 52, 63);
      tuft(b, 76, 61);
    }, S[0]);
  });
  canvasTex(scene, 'rock_L~1', 84, 64, (c) => {
    // a split boulder: two tall halves with a dark cleft, a slab at its foot
    const rnd = artRng(keySeed('rock_L~1'));
    sprite(c, 84, 64, (b) => {
      rockPx(b, 34, 6, 1.5, S, false, rnd);
      rockPx(b, 2, 12, 1.42, S, true, rnd);
      box(b, 41, 22, 2, 34, S[0]);
      box(b, 43, 26, 1, 28, S[1]);
      slabPx(b, 52, 48, 0.9, S, true, rnd);
      tuft(b, 20, 63);
      tuft(b, 44, 62);
    }, S[0]);
  });
  canvasTex(scene, 'rock_L~2', 84, 64, (c) => {
    // stacked slabs: a wide low ledge with a block on top
    const rnd = artRng(keySeed('rock_L~2'));
    sprite(c, 84, 64, (b) => {
      slabPx(b, 2, 30, 2.6, S, true, rnd);
      rockPx(b, 22, 4, 1.25, S, false, rnd);
      rockPx(b, 60, 20, 0.62, S, true, rnd);
      rockPx(b, 6, 46, 0.5, S, false, rnd);
      tuft(b, 34, 63);
      tuft(b, 70, 62);
    }, S[0]);
  });
  canvasTex(scene, 'rock_XL', 120, 88, (c) => {
    // an outcrop: a great crag with shoulders either side
    const rnd = artRng(keySeed('rock_XL'));
    sprite(c, 120, 88, (b) => {
      rockPx(b, 62, 30, 1.7, S, false, rnd);
      rockPx(b, 20, 2, 2.6, S, true, rnd);
      rockPx(b, 2, 42, 1.5, S, true, rnd);
      rockPx(b, 50, 62, 0.9, S, false, rnd);
      mossCap(b, 74, 33, 16);
      tuft(b, 4, 86);
      tuft(b, 44, 87);
      tuft(b, 98, 85);
    }, S[0]);
  });
  canvasTex(scene, 'rock_XL~1', 120, 88, (c) => {
    // a long ledge of stepped slabs with a boulder at one end
    const rnd = artRng(keySeed('rock_XL~1'));
    sprite(c, 120, 88, (b) => {
      slabPx(b, 4, 44, 3.6, S, true, rnd);
      slabPx(b, 26, 22, 2.5, S, false, rnd);
      rockPx(b, 66, 6, 1.65, S, true, rnd);
      rockPx(b, 6, 60, 0.8, S, false, rnd);
      mossCap(b, 40, 24, 22);
      tuft(b, 30, 87);
      tuft(b, 84, 86);
      tuft(b, 110, 84);
    }, S[0]);
  });
  canvasTex(scene, 'rock_XL~2', 120, 88, (c) => {
    // three crags in a row, the middle one tallest
    const rnd = artRng(keySeed('rock_XL~2'));
    sprite(c, 120, 88, (b) => {
      rockPx(b, 2, 34, 1.6, S, true, rnd);
      rockPx(b, 70, 28, 1.75, S, false, rnd);
      rockPx(b, 32, 4, 2.3, S, true, rnd);
      rockPx(b, 24, 66, 0.75, S, false, rnd);
      rockPx(b, 84, 68, 0.6, S, true, rnd);
      tuft(b, 2, 86);
      tuft(b, 56, 87);
      tuft(b, 108, 86);
    }, S[0]);
  });

  // ---- standing stones (two heroes tall): upright, leaning and broken-topped
  const menhir = (key: string, pts: readonly number[], lit: readonly number[], dark: readonly number[], moss: readonly [number, number, number][]) =>
    canvasTex(scene, key, 44, 88, (c) => {
      const rnd = artRng(keySeed(key));
      sprite(c, 44, 88, (b) => {
        fpoly(b, pts, S[2]);
        fpoly(b, lit, S[3]);
        fpoly(b, dark, S[1]);
        // top face, foot and weathering
        let topX = pts[0];
        let topY = pts[1];
        for (let i = 3; i < pts.length; i += 2) if (pts[i] < topY) [topX, topY] = [pts[i - 1], pts[i]];
        fpoly(b, [topX - 9, topY + 7, topX - 2, topY, topX + 7, topY + 3, topX + 9, topY + 9, topX, topY + 11], S[4]);
        seg(b, Math.round(topX - 8), Math.round(topY + 6), Math.round(topX - 2), Math.round(topY + 1), S[5]);
        box(b, 8, 82, 28, 3, S[0]);
        for (let i = 0; i < 7; i++) {
          const x = Math.round(14 + rnd() * 16);
          const y = Math.round(22 + rnd() * 52);
          box(b, x, y, 1, 3 + Math.floor(rnd() * 5), S[1]);
          px(b, x - 1, y + 2, S[3]);
        }
        for (let i = 0; i < 3; i++) {
          const y = Math.round(30 + i * 16 + rnd() * 6);
          box(b, 13 + i, y, 5 + Math.floor(rnd() * 5), 1, S[1]);
        }
        for (const [mx, my, mw] of moss) mossCap(b, mx, my, mw);
        tuft(b, 3, 86);
        tuft(b, 33, 87);
      }, S[0]);
    });
  menhir('menhir_L', [9, 84, 11, 30, 15, 10, 23, 3, 31, 8, 35, 28, 36, 84], [9, 84, 11, 30, 15, 10, 19, 12, 17, 84], [29, 12, 31, 8, 35, 28, 36, 84, 30, 84], [[13, 9, 12], [9, 46, 7]]);
  menhir('menhir_L~1', [6, 84, 12, 40, 20, 16, 30, 6, 36, 12, 37, 40, 34, 84], [6, 84, 12, 40, 20, 16, 24, 18, 15, 84], [32, 14, 36, 12, 37, 40, 34, 84, 28, 84], [[20, 12, 12]]);
  menhir('menhir_L~2', [8, 84, 9, 38, 13, 22, 20, 18, 24, 26, 30, 14, 35, 34, 36, 84], [8, 84, 9, 38, 13, 22, 17, 24, 16, 84], [30, 20, 35, 34, 36, 84, 30, 84], [[10, 36, 8], [25, 22, 9]]);

  // ---- a fallen giant log, three and a half tiles long
  const W = R.bark;
  const log = (key: string, v: number) =>
    canvasTex(scene, key, 112, 46, (c) => {
      const rnd = artRng(keySeed(key));
      sprite(c, 112, 46, (b) => {
        const y0 = 16;
        const y1 = 40;
        // the bole, lit along its top
        fpoly(b, [14, y0 + 2, 96, y0 - 2 + (v === 1 ? 4 : 0), 100, y1 - 4, 14, y1], W[2]);
        fpoly(b, [14, y0 + 2, 96, y0 - 2 + (v === 1 ? 4 : 0), 97, y0 + 5, 14, y0 + 9], W[3]);
        box(b, 16, y0 + 3, 78, 1, W[4]);
        fpoly(b, [14, y1 - 7, 100, y1 - 10, 100, y1 - 4, 14, y1], W[1]);
        for (let i = 0; i < 12; i++) {
          const x = Math.round(20 + rnd() * 72);
          const y = Math.round(y0 + 9 + rnd() * 10);
          box(b, x, y, 3 + Math.floor(rnd() * 6), 1, W[1]);
        }
        // the cut end with rings (left) and the torn root plate or broken end (right)
        disc(b, 13, (y0 + y1) / 2 + 1, 9, 12, W[1]);
        disc(b, 12, (y0 + y1) / 2 + 1, 7.5, 10.5, W[4]);
        disc(b, 12, (y0 + y1) / 2 + 1, 5, 7.5, W[3]);
        disc(b, 12, (y0 + y1) / 2 + 1, 2.5, 4, v === 2 ? W[0] : W[4]);
        if (v === 2) disc(b, 12, (y0 + y1) / 2 + 1, 5, 8, W[0]);
        if (v !== 1) {
          for (const [dx, dy, len] of [[0, -12, 12], [6, -6, 12], [8, 2, 10], [2, 10, 9], [-2, -4, 8]] as const) brush(b, [98, 26, 98 + dx + len * 0.5, 26 + dy], 3, W[dy < 0 ? 3 : 1]);
          disc(b, 99, 27, 6, 9, W[2]);
          disc(b, 98, 25, 3, 5, W[1]);
        } else {
          fpoly(b, [94, y0 + 2, 104, y0 + 8, 99, y0 + 12, 106, y1 - 12, 98, y1 - 4, 94, y1 - 4], W[2]);
          seg(b, 96, y0 + 4, 103, y0 + 8, W[4]);
        }
        // a broken branch stub, moss and mushrooms
        brush(b, [58, y0 + 2, 62, y0 - 9], 3, W[3]);
        box(b, 61, y0 - 11, 3, 2, W[4]);
        mossCap(b, 26, y0 + 1, 22);
        mossCap(b, 70, y0 - 1 + (v === 1 ? 3 : 0), 14);
        shroom(b, 46, y0 + 2, 4, 3, 4, v === 0 ? R.crimson : ['#4a1c10', '#7a3218', '#a84a24', '#c86a38', '#e8a070']);
        shroom(b, 82, y1 - 1, 3, 2, 4, R.cream, R.cream, false);
        tuft(b, 2, 45);
        tuft(b, 38, 45);
        tuft(b, 86, 45);
      }, W[0]);
    });
  log('log_L', 0);
  log('log_L~1', 1);
  log('log_L~2', 2);
}

// ================================================================== structures
// Width = footprint x 32. The client anchors (0.5, 1) at the footprint's bottom edge + 4px,
// so the front wall stands on the southern row and roofs overhang upward.

const PLASTER = ['#6a5c48', '#968670', '#bcae8e', '#d8cbaa', '#ece2c4'];
const ROOF_RED = ['#3a1812', '#5a281c', '#7e3828', '#a04c34', '#bc6646', '#d88a62'];
const ROOF_GREEN = ['#14241c', '#1f3428', '#2c4a38', '#3c624a', '#527e60', '#72a07c'];
const ROOF_BLUE = ['#161c30', '#222c46', '#304064', '#425886', '#5a74a4', '#7e96c2'];
const THATCH = ['#3e2e14', '#5e4620', '#806230', '#a28044', '#c09c58', '#dcbc78'];
const CANVAS = ['#6e604a', '#a08e6c', '#c8b690', '#e2d4b0', '#f2e8cc'];
const GLASS = ['#6a4418', '#c0842e', '#eab456', '#f8da8a', '#fff4cc'];

type RoofStyle = 'tile' | 'slate' | 'thatch' | 'shingle';

/** Side-gabled roof seen from the front: back-slope sliver, courses with staggered shingles, ridge cap, eave. */
function roofPx(b: Ctx, x0: number, x1: number, ridge: number, eave: number, inset: number, ramp: Ramp, style: RoofStyle, rnd: () => number): void {
  const span = (y: number): [number, number] => {
    const t = (y - ridge) / (eave - ridge);
    return [Math.round(x0 + inset * (1 - t)), Math.round(x1 - inset * (1 - t))];
  };
  fpoly(b, [x0 + inset + 3, ridge + 1, x0 + inset + 8, ridge - 4, x1 - inset - 8, ridge - 4, x1 - inset - 3, ridge + 1], ramp[1]);
  box(b, x0 + inset + 8, ridge - 4, x1 - x0 - inset * 2 - 16, 1, ramp[2]);
  for (let y = ridge; y < eave; y++) {
    const [l, r] = span(y);
    box(b, l, y, r - l, 1, ramp[3]);
  }
  const step = style === 'slate' ? 5 : 6;
  const tick = style === 'slate' ? 7 : style === 'shingle' ? 5 : 8;
  let row = 0;
  for (let y = ridge + 2; y < eave - 2; y += step, row++) {
    const [l, r] = span(y + 1);
    if (style === 'thatch') {
      for (let x = l + 1; x < r - 1; x += 2) {
        const len = 2 + Math.floor(rnd() * 4);
        box(b, x, y + step - len, 1, len, rnd() < 0.5 ? ramp[2] : ramp[4]);
      }
      box(b, l, y + step - 1, r - l, 1, ramp[1]);
      for (let x = l + 1; x < r - 1; x += 3) px(b, x, y + step, ramp[2]);
      continue;
    }
    box(b, l, y, r - l, 1, ramp[1]);
    box(b, l, y + 1, r - l, 1, ramp[4]);
    const off = (row % 2) * Math.floor(tick / 2);
    for (let x = l + off + 2; x < r - 1; x += tick) {
      const w = Math.min(tick - 1, r - 1 - x - 1);
      const roll = rnd();
      if (w > 0 && roll < 0.22) box(b, x + 1, y + 2, w, step - 2, ramp[2]);
      else if (w > 0 && roll > 0.9) box(b, x + 1, y + 2, w, step - 2, ramp[4]);
      box(b, x, y + 2, 1, step - 2, ramp[1]);
      if (style === 'tile' && w > 2) px(b, x + 2, y + 2, ramp[5]);
    }
  }
  // barge boards, ridge cap, eave shadow
  seg(b, x0 + inset, ridge, x0, eave - 1, ramp[5]);
  seg(b, x0 + inset + 1, ridge, x0 + 1, eave - 1, ramp[4]);
  seg(b, x1 - inset - 1, ridge, x1 - 1, eave - 1, ramp[0]);
  seg(b, x1 - inset - 2, ridge, x1 - 2, eave - 1, ramp[1]);
  box(b, x0 + inset - 1, ridge - 2, x1 - x0 - inset * 2 + 2, 3, ramp[1]);
  box(b, x0 + inset - 1, ridge - 2, x1 - x0 - inset * 2 + 2, 1, ramp[4]);
  for (let x = x0 + inset + 3; x < x1 - inset - 2; x += 6) px(b, x, ridge - 1, ramp[2]);
  box(b, x0, eave - 2, x1 - x0, 2, ramp[0]);
  box(b, x0, eave - 3, x1 - x0, 1, ramp[2]);
  if (style === 'thatch') for (let x = x0 + 1; x < x1 - 1; x += 3) box(b, x, eave - 1, 2, 1 + Math.floor(rnd() * 2), ramp[1]);
}

type WallKind = 'plaster' | 'stone' | 'log' | 'plank';

/** Wall face with foundation. Timber frames for plaster, coursed blocks for stone, stacked logs, planks. */
function wallPx(b: Ctx, x: number, y: number, w: number, h: number, kind: WallKind, rnd: () => number): void {
  const B = R.bark;
  const S = R.warmStone;
  switch (kind) {
    case 'plaster': {
      box(b, x, y, w, h, PLASTER[3]);
      for (let i = 0; i < (w * h) / 220; i++) {
        const sx = x + 3 + Math.floor(rnd() * (w - 8));
        const sy = y + 4 + Math.floor(rnd() * (h - 14));
        box(b, sx, sy, 2 + Math.floor(rnd() * 3), 1, PLASTER[2]);
        px(b, sx + 1, sy + 1, PLASTER[4]);
      }
      const post = (px0: number) => {
        box(b, px0, y, 3, h - 6, B[3]);
        box(b, px0, y, 1, h - 6, B[4]);
        box(b, px0 + 2, y, 1, h - 6, B[1]);
      };
      const n = Math.max(1, Math.round(w / 26));
      for (let i = 0; i <= n; i++) post(Math.round(x + ((w - 3) * i) / n));
      box(b, x, y, w, 3, B[3]);
      box(b, x, y, w, 1, B[4]);
      box(b, x, y + 2, w, 1, B[1]);
      box(b, x, y + h - 9, w, 3, B[3]);
      box(b, x, y + h - 9, w, 1, B[4]);
      box(b, x, y + h - 7, w, 1, B[1]);
      break;
    }
    case 'stone': {
      box(b, x, y, w, h, S[1]);
      for (let yy = y, r = 0; yy < y + h - 4; yy += 6, r++) {
        let xx = x - (r % 2 ? 4 : 0);
        while (xx < x + w) {
          const bw = 7 + Math.floor(rnd() * 5);
          const a = Math.max(x, xx);
          const z = Math.min(x + w, xx + bw - 1);
          if (z - a >= 2) {
            const tone = rnd() < 0.25 ? 2 : rnd() < 0.2 ? 4 : 3;
            box(b, a, yy, z - a, 5, S[tone]);
            box(b, a, yy, z - a, 1, S[Math.min(5, tone + 1)]);
            box(b, z - 1, yy + 1, 1, 4, S[tone - 1]);
            box(b, a, yy + 4, z - a, 1, S[tone - 1]);
          }
          xx += bw;
        }
      }
      break;
    }
    case 'log': {
      for (let yy = y, r = 0; yy < y + h; yy += 6, r++) {
        box(b, x, yy, w, 6, B[r % 2 ? 3 : 2]);
        box(b, x, yy, w, 1, B[4]);
        box(b, x, yy + 5, w, 1, B[1]);
        for (let k = 0; k < w / 14; k++) box(b, x + 4 + Math.floor(rnd() * (w - 10)), yy + 2 + Math.floor(rnd() * 2), 3 + Math.floor(rnd() * 3), 1, B[2]);
        for (const ex of [x - 2, x + w - 3]) {
          disc(b, ex + 2.5, yy + 3, 3, 3, R.cream[1]);
          disc(b, ex + 2.5, yy + 3, 2, 2, R.cream[2]);
          px(b, ex + 2, yy + 3, B[2]);
        }
      }
      break;
    }
    case 'plank': {
      box(b, x, y, w, h, B[3]);
      for (let xx = x; xx < x + w; xx += 4) {
        box(b, xx, y, 1, h, B[1]);
        box(b, xx + 1, y, 1, h, B[4]);
      }
      break;
    }
  }
  // foundation course
  box(b, x - 1, y + h - 5, w + 2, 5, R.stone[2]);
  box(b, x - 1, y + h - 5, w + 2, 1, R.stone[4]);
  box(b, x - 1, y + h - 1, w + 2, 1, R.stone[1]);
  for (let xx = x + 2; xx < x + w; xx += 7) box(b, xx, y + h - 4, 1, 3, R.stone[1]);
  // right-hand corner falls into shade
  box(b, x + w - 3, y, 3, h - 5, 'rgba(58,53,96,0.3)');
}

/** Plank door in a dark frame (optionally arched) with iron straps, ring handle and a stone step. */
function doorPx(b: Ctx, cx: number, bottom: number, w: number, h: number, ramp: Ramp = R.bark, arched = true): void {
  const x = Math.round(cx - w / 2);
  const top = bottom - h;
  const r = w / 2;
  const rowSpan = (y: number, grow: number): [number, number] => {
    if (!arched || y >= top + r) return [x - grow, x + w + grow];
    const dy = top + r - y - 0.5;
    const half = Math.sqrt(Math.max(0, (r + grow) ** 2 - dy * dy));
    return [Math.round(cx - half), Math.round(cx + half)];
  };
  for (let y = top - 2; y < bottom; y++) {
    const [a, z] = rowSpan(y, 2);
    if (z > a) box(b, a, y, z - a, 1, '#2a1a10');
  }
  for (let y = top; y < bottom; y++) {
    const [a, z] = rowSpan(y, 0);
    if (z <= a) continue;
    box(b, a, y, z - a, 1, ramp[3]);
    for (let xx = x + 3; xx < x + w; xx += 4) if (xx > a && xx < z) px(b, xx, y, ramp[1]);
    px(b, a, y, ramp[4]);
  }
  for (const f of [0.3, 0.72]) {
    const yy = Math.round(bottom - h * f);
    box(b, x, yy, w, 2, R.iron[2]);
    box(b, x, yy, w, 1, R.iron[3]);
    for (let xx = x + 1; xx < x + w - 1; xx += 4) px(b, xx, yy + 1, R.iron[0]);
  }
  box(b, x + w - 4, Math.round(bottom - h * 0.5), 2, 2, R.gold[3]);
  px(b, x + w - 4, Math.round(bottom - h * 0.5) + 1, R.gold[1]);
  box(b, x - 3, bottom, w + 6, 2, R.stone[3]);
  box(b, x - 3, bottom, w + 6, 1, R.stone[4]);
}

/** Lit four-pane window: frame, warm glass with a glint, sill, optional painted shutters. */
function windowPx(b: Ctx, x: number, y: number, w: number, h: number, shutters?: Ramp): void {
  box(b, x - 1, y - 1, w + 2, h + 2, R.bark[1]);
  box(b, x, y, w, h, GLASS[2]);
  box(b, x, y, w, Math.ceil(h / 2), GLASS[3]);
  box(b, x, y + h - 1, w, 1, GLASS[1]);
  box(b, x + Math.floor(w / 2), y, 1, h, R.bark[1]);
  box(b, x, y + Math.floor(h / 2), w, 1, R.bark[1]);
  px(b, x + 1, y + 1, GLASS[4]);
  px(b, x + 2, y + 1, GLASS[4]);
  box(b, x - 2, y + h + 1, w + 4, 2, R.bark[3]);
  box(b, x - 2, y + h + 1, w + 4, 1, R.bark[4]);
  if (shutters) {
    for (const sx of [x - 5, x + w + 1]) {
      box(b, sx, y - 1, 4, h + 2, shutters[2]);
      box(b, sx, y - 1, 4, 1, shutters[3]);
      box(b, sx + 1, y + 1, 2, h - 2, shutters[1]);
      box(b, sx + 1, y + Math.floor(h / 2), 2, 1, shutters[3]);
    }
  }
}

function chimneyPx(b: Ctx, x: number, y: number, w: number, h: number): void {
  const S = R.warmStone;
  box(b, x, y, w, h, S[3]);
  for (let yy = y + 3, r = 0; yy < y + h; yy += 4, r++) {
    box(b, x, yy, w, 1, S[1]);
    for (let xx = x + (r % 2 ? 2 : 5); xx < x + w; xx += 6) box(b, xx, yy - 3, 1, 3, S[1]);
  }
  box(b, x, y, 2, h, S[4]);
  box(b, x + w - 2, y, 2, h, S[2]);
  box(b, x - 2, y - 3, w + 4, 4, S[2]);
  box(b, x - 2, y - 3, w + 4, 1, S[5]);
  box(b, x, y - 2, w, 1, '#1a120c');
}

/**
 * Chimney mouths per structure texture (px from the texture's top-left): render/ambient.ts rises animated pixel smoke
 * from them (the textures carry no baked smoke). 'dark' = forge smoke.
 */
export const STRUCTURE_SMOKE: Readonly<Record<string, readonly (readonly [x: number, y: number, dark?: boolean])[]>> = {
  struct_house: [[23, 4]],
  struct_hut: [[48, 3]],
  struct_smithy: [[99, 4, true]],
  struct_hall: [
    [36, 10],
    [156, 6],
  ],
  smithy: [[99, 4, true]],
  hut: [[48, 3]],
};

/** Omnipath emblem: a gold four-point waystar over a ring, on a cloth field (used by banners and the hall). */
function waystar(b: Ctx, cx: number, cy: number, s: number, gold: Ramp = R.gold): void {
  fpoly(b, [cx, cy - s, cx + 1, cy - 1, cx + s, cy, cx + 1, cy + 1, cx, cy + s, cx - 1, cy + 1, cx - s, cy, cx - 1, cy - 1], gold[3]);
  fpoly(b, [cx, cy - s, cx + 1, cy - 1, cx + s, cy, cx, cy], gold[4]);
  px(b, cx, cy, gold[1]);
}

/** Hanging cloth banner with the waystar, on a crossbar. */
function bannerPx(b: Ctx, x: number, y: number, w: number, h: number, cloth: Ramp): void {
  box(b, x - 1, y - 2, w + 2, 2, R.bark[2]);
  box(b, x - 1, y - 2, w + 2, 1, R.bark[4]);
  fpoly(b, [x, y, x + w, y, x + w, y + h, x + w / 2, y + h - 4, x, y + h], cloth[2]);
  box(b, x, y, 2, h - 2, cloth[3]);
  box(b, x + w - 2, y, 2, h - 2, cloth[1]);
  box(b, x + 1, y + 1, w - 2, 1, R.gold[2]);
  waystar(b, Math.round(x + w / 2), Math.round(y + h * 0.45), Math.max(2, Math.round(w / 3)));
}

/** Little lantern on a bracket (glow drawn by the caller outside the sprite). */
function lanternPx(b: Ctx, x: number, y: number): void {
  box(b, x - 2, y, 5, 1, R.iron[1]);
  box(b, x - 2, y + 1, 5, 5, GLASS[3]);
  box(b, x - 1, y + 2, 3, 3, GLASS[4]);
  box(b, x - 2, y + 6, 5, 1, R.iron[1]);
  px(b, x, y - 1, R.iron[2]);
}

function drawStructures(scene: Phaser.Scene): void {
  // ---- smithy 4x3: coursed stone, open forge bay with coals, anvil sign, quench barrel
  texAll(scene, ['struct_smithy', 'smithy'], 128, 128, (c) => {
    const rnd = artRng(keySeed('struct_smithy'));
    sprite(c, 128, 128, (b) => {
      wallPx(b, 8, 72, 112, 52, 'stone', rnd);
      // forge bay
      box(b, 12, 86, 46, 36, R.bark[1]);
      box(b, 14, 90, 42, 32, '#160e09');
      disc(b, 35, 114, 16, 7, '#4a200e');
      disc(b, 35, 115, 11, 5, '#6e2c12');
      for (const [tx, ty] of [
        [18, 94],
        [22, 93],
        [48, 95],
      ]) box(b, tx, ty, 1, 7, R.iron[2]);
      box(b, 46, 93, 6, 3, R.iron[2]);
      box(b, 24, 108, 22, 14, R.stone[2]);
      box(b, 24, 108, 22, 1, R.stone[4]);
      box(b, 43, 109, 3, 13, R.stone[1]);
      box(b, 26, 105, 18, 3, R.flame[2]);
      box(b, 28, 104, 14, 2, R.flame[3]);
      for (const xx of [29, 33, 37, 40]) px(b, xx, 104, R.flame[4]);
      box(b, 26, 107, 18, 1, R.flame[1]);
      box(b, 11, 85, 48, 4, R.bark[3]);
      box(b, 11, 85, 48, 1, R.bark[4]);
      box(b, 11, 88, 48, 1, R.bark[1]);
      doorPx(b, 80, 122, 16, 26);
      windowPx(b, 96, 92, 9, 9);
      // hanging anvil sign on a bracket
      box(b, 110, 80, 16, 2, R.iron[1]);
      box(b, 111, 82, 1, 3, R.iron[2]);
      box(b, 123, 82, 1, 3, R.iron[2]);
      box(b, 109, 85, 17, 11, R.bark[3]);
      box(b, 109, 85, 17, 1, R.bark[4]);
      box(b, 109, 95, 17, 1, R.bark[1]);
      fpoly(b, [112, 88, 123, 88, 121, 90, 119, 90, 119, 92, 121, 93, 113, 93, 115, 92, 115, 90, 113, 90], R.iron[1]);
      box(b, 112, 88, 11, 1, R.iron[3]);
      roofPx(b, 2, 126, 22, 77, 10, ROOF_RED, 'tile', rnd);
      box(b, 8, 77, 112, 2, 'rgba(58,53,96,0.5)');
      chimneyPx(b, 92, 8, 14, 34);
      // anvil out front
      box(b, 54, 120, 10, 5, R.iron[1]);
      box(b, 52, 124, 14, 1, R.iron[0]);
      fpoly(b, [47, 114, 69, 114, 69, 117, 65, 118, 65, 120, 53, 120, 53, 118, 49, 117, 45, 115], R.iron[2]);
      box(b, 48, 114, 21, 1, R.iron[4]);
      box(b, 48, 115, 21, 1, R.iron[3]);
      // quench barrel
      box(b, 104, 110, 11, 15, R.bark[3]);
      box(b, 104, 110, 2, 15, R.bark[4]);
      box(b, 113, 110, 2, 15, R.bark[1]);
      for (const yy of [112, 119]) box(b, 104, yy, 11, 1, R.iron[1]);
      box(b, 105, 109, 9, 2, PAL.water[1]);
      px(b, 106, 109, PAL.water[3]);
    });
    halo(c, 99, 6, 8, '#ff9a3a', 0.45);
  });

  // ---- chapel 4x4: front gable, slate planes going back, rose window, bell cote with the waystar finial
  texAll(scene, ['struct_chapel', 'chapel'], 128, 176, (c) => {
    const rnd = artRng(keySeed('struct_chapel'));
    sprite(c, 128, 176, (b) => {
      const RB = ROOF_BLUE;
      fpoly(b, [9, 111, 64, 62, 64, 24, 9, 73], RB[3]);
      fpoly(b, [119, 111, 64, 62, 64, 24, 119, 73], RB[1]);
      for (let i = 1; i < 8; i++) {
        const dy = Math.round((i / 8) * 38);
        seg(b, 10, 111 - dy, 63, 62 - dy, RB[2]);
        seg(b, 11, 112 - dy, 63, 63 - dy, RB[4]);
        seg(b, 118, 111 - dy, 65, 62 - dy, RB[0]);
      }
      seg(b, 64, 62, 64, 24, RB[5]);
      seg(b, 65, 62, 65, 24, RB[0]);
      seg(b, 9, 73, 64, 24, RB[5]);
      seg(b, 119, 73, 65, 24, RB[0]);
      // walls + gable
      wallPx(b, 16, 106, 96, 66, 'plaster', rnd);
      fpoly(b, [15, 108, 64, 63, 113, 108], PLASTER[3]);
      fpoly(b, [64, 63, 113, 108, 102, 108, 64, 72], PLASTER[2]);
      brush(b, [11, 111, 64, 61, 117, 111], 3, R.bark[2]);
      seg(b, 10, 109, 63, 60, R.bark[4]);
      seg(b, 65, 60, 118, 109, R.bark[1]);
      // rose window
      disc(b, 64, 88, 10, 10, R.bark[1]);
      disc(b, 64, 88, 8, 8, R.blue[3]);
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        disc(b, 64 + Math.cos(a) * 4.5, 88 + Math.sin(a) * 4.5, 2.2, 2.2, i % 2 ? PAL.rose : R.gold[3]);
      }
      disc(b, 64, 88, 2, 2, R.gold[4]);
      box(b, 59, 82, 2, 2, R.blue[4]);
      // tall stained windows
      for (const wx of [26, 92]) {
        disc(b, wx + 5, 128, 7, 7, R.bark[1]);
        box(b, wx - 2, 128, 14, 25, R.bark[1]);
        disc(b, wx + 5, 128, 5, 5, R.blue[3]);
        box(b, wx, 128, 10, 23, R.blue[3]);
        box(b, wx, 134, 10, 6, PAL.rose);
        box(b, wx, 143, 10, 7, R.gold[3]);
        box(b, wx + 5, 123, 1, 28, R.bark[1]);
        box(b, wx, 128, 2, 5, R.blue[4]);
        box(b, wx - 3, 152, 16, 2, R.stone[4]);
      }
      doorPx(b, 64, 170, 22, 32, R.bark, true);
      box(b, 63, 140, 2, 30, R.bark[1]);
      // bell cote on the ridge
      box(b, 56, 30, 16, 26, PLASTER[3]);
      box(b, 67, 30, 5, 26, PLASTER[1]);
      box(b, 56, 30, 1, 26, PLASTER[4]);
      box(b, 59, 36, 10, 13, '#1e1828');
      disc(b, 64, 44, 4, 4, R.gold[2]);
      box(b, 61, 42, 2, 2, R.gold[4]);
      box(b, 63, 36, 2, 4, R.bark[2]);
      fpoly(b, [51, 33, 64, 9, 77, 33], RB[3]);
      fpoly(b, [64, 9, 77, 33, 64, 33], RB[1]);
      seg(b, 52, 32, 63, 10, RB[5]);
      box(b, 51, 32, 26, 2, RB[0]);
      box(b, 63, 3, 2, 7, R.gold[2]);
      waystar(b, 64, 3, 3);
    });
  });

  // ---- hut 3x3: stacked logs under a domed thatch
  texAll(scene, ['struct_hut', 'hut'], 96, 100, (c) => {
    const rnd = artRng(keySeed('struct_hut'));
    sprite(c, 96, 100, (b) => {
      wallPx(b, 14, 60, 68, 36, 'log', rnd);
      doorPx(b, 52, 94, 16, 22, R.bark, true);
      disc(b, 27, 75, 5, 5, R.bark[1]);
      disc(b, 27, 75, 3.5, 3.5, GLASS[2]);
      box(b, 25, 73, 2, 2, GLASS[4]);
      box(b, 27, 71, 1, 8, R.bark[1]);
      box(b, 23, 75, 8, 1, R.bark[1]);
      // thatch dome
      const T = THATCH;
      for (let y = 6; y <= 70; y++) {
        const dy = (70 - y) / 64;
        const half = Math.round(47 * Math.sqrt(Math.max(0, 1 - dy * dy)));
        box(b, 48 - half, y, half * 2, 1, T[3]);
        box(b, 48 - half, y, Math.max(1, Math.round(half * 0.35)), 1, T[4]);
        box(b, 48 + half - Math.max(1, Math.round(half * 0.4)), y, Math.max(1, Math.round(half * 0.4)), 1, T[2]);
      }
      for (let band = 16; band < 70; band += 9) {
        const dy = (70 - band) / 64;
        const half = Math.round(47 * Math.sqrt(Math.max(0, 1 - dy * dy)));
        for (let x = 48 - half + 1; x < 48 + half - 1; x += 2) {
          const len = 3 + Math.floor(rnd() * 4);
          box(b, x, band - len, 1, len, rnd() < 0.5 ? T[2] : T[5]);
        }
        box(b, 48 - half, band, half * 2, 1, T[1]);
        for (let x = 48 - half + 1; x < 48 + half - 1; x += 3) px(b, x, band + 1, T[2]);
      }
      for (let x = 2; x < 94; x += 3) box(b, x, 68 + Math.floor(rnd() * 2), 2, 3, T[1]);
      mossCap(b, 22, 30, 12);
      mossCap(b, 60, 46, 9);
      box(b, 44, 4, 8, 4, T[1]);
      box(b, 45, 4, 6, 2, '#1a120c');
    });
  });

  // ---- hall 6x4: timber guild hall, slate roof, central gable porch, waystar banners and lanterns
  canvasTex(scene, 'struct_hall', 192, 156, (c) => {
    const rnd = artRng(keySeed('struct_hall'));
    sprite(c, 192, 156, (b) => {
      wallPx(b, 8, 84, 176, 68, 'plaster', rnd);
      for (const wx of [20, 44, 136, 160]) windowPx(b, wx, 102, 12, 14, R.teal);
      roofPx(b, 2, 190, 26, 91, 14, ROOF_GREEN, 'slate', rnd);
      box(b, 8, 91, 176, 2, 'rgba(58,53,96,0.5)');
      chimneyPx(b, 30, 14, 12, 26);
      chimneyPx(b, 150, 10, 12, 28);
      // central gable porch
      fpoly(b, [62, 99, 96, 50, 130, 99], PLASTER[3]);
      fpoly(b, [96, 50, 130, 99, 120, 99, 96, 60], PLASTER[2]);
      brush(b, [59, 101, 96, 48, 133, 101], 3, R.bark[2]);
      seg(b, 58, 99, 95, 46, R.bark[4]);
      seg(b, 97, 46, 134, 99, R.bark[1]);
      disc(b, 96, 76, 7, 7, R.bark[1]);
      disc(b, 96, 76, 5, 5, GLASS[2]);
      box(b, 93, 73, 2, 2, GLASS[4]);
      box(b, 96, 71, 1, 10, R.bark[1]);
      box(b, 91, 76, 11, 1, R.bark[1]);
      box(b, 68, 96, 56, 4, R.bark[3]);
      box(b, 68, 96, 56, 1, R.bark[4]);
      box(b, 68, 99, 56, 1, R.bark[1]);
      doorPx(b, 96, 150, 28, 34, R.bark, true);
      box(b, 95, 118, 2, 32, R.bark[1]);
      bannerPx(b, 70, 104, 9, 22, R.blue);
      bannerPx(b, 113, 104, 9, 22, R.blue);
      lanternPx(b, 85, 124);
      lanternPx(b, 107, 124);
      box(b, 76, 150, 40, 2, R.stone[3]);
    });
    halo(c, 85, 127, 7, '#ffcf6a', 0.5);
    halo(c, 107, 127, 7, '#ffcf6a', 0.5);
  });

  // ---- house 3x3: timber frame cottage, tiled roof, flower box
  canvasTex(scene, 'struct_house', 96, 108, (c) => {
    const rnd = artRng(keySeed('struct_house'));
    sprite(c, 96, 108, (b) => {
      wallPx(b, 10, 62, 76, 42, 'plaster', rnd);
      windowPx(b, 20, 72, 13, 11, R.teal);
      box(b, 17, 85, 19, 4, R.bark[3]);
      box(b, 17, 85, 19, 1, R.bark[4]);
      for (let i = 0; i < 6; i++) {
        box(b, 18 + i * 3, 83 + (i % 2), 2, 2, i % 2 ? PAL.rose : PAL.crimson);
        px(b, 18 + i * 3, 83 + (i % 2), i % 2 ? '#f8b8c0' : R.crimson[4]);
      }
      box(b, 18, 85, 17, 1, R.leaf[3]);
      doorPx(b, 62, 102, 16, 24, R.teal, true);
      roofPx(b, 2, 94, 20, 67, 8, ROOF_RED, 'tile', rnd);
      box(b, 10, 67, 76, 2, 'rgba(58,53,96,0.5)');
      chimneyPx(b, 18, 8, 10, 24);
    });
  });

  // ---- tent 3x2: striped canvas, open flap, pennant, guy ropes
  canvasTex(scene, 'struct_tent', 96, 72, (c) => {
    sprite(c, 96, 72, (b) => {
      const CL = CANVAS;
      const ST = R.crimson;
      fpoly(b, [8, 67, 48, 16, 48, 6, 10, 53], CL[3]);
      fpoly(b, [88, 67, 48, 16, 48, 6, 86, 53], CL[1]);
      for (let i = 1; i < 4; i++) {
        const t = i / 4;
        brush(b, [9 + 2 * t, 67 - 14 * t, 47, 16 - 10 * t], 2, ST[2]);
        brush(b, [87 - 2 * t, 67 - 14 * t, 49, 16 - 10 * t], 2, ST[1]);
      }
      fpoly(b, [8, 67, 48, 16, 88, 67], CL[3]);
      for (const sx of [-26, -13, 13, 26]) {
        const x = 48 + sx;
        fpoly(b, [48 + sx * 0.08 - 1, 18, 48 + sx * 0.08 + 1, 18, x + 2, 67, x - 2, 67], sx < 0 ? ST[2] : ST[1]);
      }
      fpoly(b, [48, 16, 88, 67, 80, 67, 48, 24], CL[2]);
      seg(b, 9, 66, 47, 17, CL[4]);
      // open flap
      fpoly(b, [36, 67, 48, 32, 60, 67], '#1e140e');
      fpoly(b, [48, 32, 60, 67, 67, 67, 52, 34], CL[1]);
      fpoly(b, [48, 32, 36, 67, 30, 65, 45, 36], CL[4]);
      seg(b, 31, 65, 45, 36, CL[2]);
      box(b, 6, 66, 84, 1, CL[0]);
      // pole + pennant
      box(b, 47, 1, 2, 17, R.bark[3]);
      px(b, 47, 1, R.bark[4]);
      fpoly(b, [49, 2, 59, 5, 49, 8], R.blue[3]);
      px(b, 52, 5, R.gold[3]);
      // ropes + stakes
      seg(b, 47, 17, 3, 63, R.bark[2]);
      seg(b, 49, 17, 92, 63, R.bark[2]);
      box(b, 2, 62, 2, 5, R.bark[3]);
      box(b, 92, 62, 2, 5, R.bark[1]);
    });
  });

  // ---- ruin 4x3: flagstone floor, jagged walls, a standing broken column, fallen drums, ivy, rubble
  canvasTex(scene, 'struct_ruin', 128, 104, (c) => {
    const rnd = artRng(keySeed('struct_ruin'));
    const S = R.warmStone;
    // floor is flat ground (no outline)
    box(c, 12, 40, 104, 56, S[1]);
    for (let y = 40; y < 96; y += 12)
      for (let x = 12 + ((y / 12) % 2) * 6; x < 116; x += 12) {
        const w = Math.min(11, 116 - x);
        const tone = rnd() < 0.3 ? 2 : 3;
        box(c, x, y, w, 11, S[tone]);
        box(c, x, y, w, 1, S[tone + 1]);
        box(c, x + w - 1, y + 1, 1, 10, S[tone - 1]);
      }
    for (let i = 0; i < 16; i++) {
      const x = 14 + Math.floor(rnd() * 98);
      const y = 42 + Math.floor(rnd() * 50);
      if (rnd() < 0.6) {
        box(c, x, y, 3, 1, R.moss[2]);
        px(c, x + 1, y - 1, R.moss[3]);
      } else box(c, x, y, 2, 1, S[1]);
    }
    sprite(c, 128, 104, (b) => {
      const wallSeg = (x: number, y: number, w: number, h: number, jag: number[]) => {
        const top: number[] = [];
        jag.forEach((d, i) => top.push(x + (i / (jag.length - 1)) * w, y + d));
        fpoly(b, [...top, x + w, y + h, x, y + h], S[3]);
        for (let yy = y + 4, r = 0; yy < y + h; yy += 6, r++) {
          box(b, x, yy, w, 1, S[1]);
          for (let xx = x + (r % 2 ? 4 : 0); xx < x + w; xx += 9) box(b, xx, yy, 1, 6, S[1]);
          for (let xx = x + (r % 2 ? 5 : 1); xx < x + w - 3; xx += 9) box(b, xx, yy + 1, 3, 1, S[4]);
        }
        for (let i = 0; i < jag.length - 1; i++) {
          const ax = x + (i / (jag.length - 1)) * w;
          const bx = x + ((i + 1) / (jag.length - 1)) * w;
          seg(b, Math.round(ax), Math.round(y + jag[i]), Math.round(bx), Math.round(y + jag[i + 1]), S[5]);
          seg(b, Math.round(ax), Math.round(y + jag[i] + 1), Math.round(bx), Math.round(y + jag[i + 1] + 1), S[4]);
        }
        box(b, x + w - 3, y + Math.max(...jag) + 1, 3, h - Math.max(...jag) - 1, S[2]);
        box(b, x, y + h - 2, w, 2, S[1]);
      };
      wallSeg(10, 18, 108, 26, [10, 2, 6, 0, 4, 12, 16, 8, 3, 9, 14]);
      wallSeg(8, 34, 8, 62, [0, 2]);
      wallSeg(112, 54, 8, 42, [4, 0]);
      wallSeg(8, 76, 34, 22, [0, 2, 8, 12]);
      wallSeg(88, 82, 32, 16, [9, 4, 0, 2]);
      for (const [x, y, n] of [
        [22, 26, 9],
        [70, 22, 7],
        [11, 48, 10],
        [96, 86, 5],
      ] as const)
        for (let i = 0; i < n; i++) {
          const ix = x + Math.floor(rnd() * 7);
          box(b, ix, y + i * 2, 2, 2, i % 3 ? R.leaf[2] : R.leaf[4]);
          px(b, ix + 1, y + i * 2 + 1, R.leaf[1]);
        }
      // standing broken column
      box(b, 28, 52, 10, 30, S[3]);
      box(b, 28, 52, 2, 30, S[5]);
      box(b, 35, 52, 3, 30, S[2]);
      for (let yy = 58; yy < 80; yy += 7) box(b, 28, yy, 10, 1, S[1]);
      fpoly(b, [26, 54, 30, 48, 33, 51, 37, 46, 40, 54], S[4]);
      box(b, 25, 80, 16, 4, S[2]);
      box(b, 25, 80, 16, 1, S[4]);
      // fallen drum
      box(b, 72, 69, 18, 10, S[3]);
      box(b, 72, 69, 18, 2, S[4]);
      box(b, 72, 77, 18, 2, S[1]);
      disc(b, 90, 74, 3, 5, S[2]);
      disc(b, 72, 74, 3, 5, S[4]);
      disc(b, 72, 74, 1.5, 2.5, S[3]);
      for (let i = 0; i < 10; i++) {
        const x = 46 + Math.floor(rnd() * 60);
        const y = 85 + Math.floor(rnd() * 9);
        box(b, x, y, 3, 2, S[2]);
        box(b, x, y, 2, 1, S[4]);
      }
    });
  });

  // ---- tower 2x3: round coursed tower, arrow slits, cone roof, pennant
  canvasTex(scene, 'struct_tower', 64, 160, (c) => {
    const rnd = artRng(keySeed('struct_tower'));
    sprite(c, 64, 160, (b) => {
      const S = R.warmStone;
      for (let x = 9; x < 55; x++) {
        const t = (x - 9) / 46;
        const tone = t < 0.16 ? 4 : t < 0.5 ? 3 : t < 0.8 ? 2 : 1;
        const sag = Math.round(Math.sin(t * Math.PI) * 3);
        box(b, x, 44, 1, 108 + sag, S[tone]);
        for (let y = 50, r = 0; y < 150; y += 7, r++) {
          px(b, x, y + sag, S[Math.max(0, tone - 2)]);
          if ((x + (r % 2) * 5) % 10 === 0) box(b, x, y + sag + 1, 1, 6, S[Math.max(0, tone - 1)]);
          else if ((x + (r % 2) * 5) % 10 === 1 && tone >= 3) px(b, x, y + sag + 1, S[5]);
        }
      }
      for (let i = 0; i < 12; i++) box(b, 12 + Math.floor(rnd() * 20), 52 + Math.floor(rnd() * 90), 2, 1, S[5]);
      box(b, 9, 146, 46, 6, S[2]);
      box(b, 9, 146, 46, 1, S[4]);
      for (const y of [66, 98]) {
        box(b, 29, y, 5, 12, '#1e1828');
        box(b, 30, y - 1, 3, 1, '#1e1828');
        box(b, 30, y + 2, 2, 7, GLASS[3]);
        box(b, 28, y + 12, 7, 1, S[4]);
      }
      doorPx(b, 32, 152, 14, 22, R.bark, true);
      // cone roof
      const RB = ROOF_BLUE;
      for (let y = 0; y <= 46; y++) {
        const half = Math.round((y / 46) * 29);
        for (let x = 32 - half; x <= 32 + half; x++) {
          const t = half ? (x - (32 - half)) / (half * 2) : 0.5;
          const tone = t < 0.22 ? 4 : t < 0.55 ? 3 : t < 0.8 ? 2 : 1;
          px(b, x, y, RB[tone]);
        }
        if (y % 6 === 5) box(b, 32 - half, y, half * 2 + 1, 1, RB[1]);
      }
      for (let x = 4; x <= 60; x++) {
        const t = (x - 32) / 29;
        const yy = 46 + Math.round(Math.sqrt(Math.max(0, 1 - t * t)) * 5);
        box(b, x, 46, 1, yy - 46, RB[1]);
        px(b, x, yy, RB[0]);
      }
      seg(b, 31, 1, 5, 45, RB[5]);
      box(b, 31, 0, 2, 3, R.iron[2]);
      fpoly(b, [33, 0, 43, 2, 33, 5], R.blue[3]);
      px(b, 36, 2, R.gold[3]);
    });
  });

  // ---- well 1x1: stone ring, plank roof, rope and bucket
  canvasTex(scene, 'struct_well', 32, 48, (c) => {
    sprite(c, 32, 48, (b) => {
      const S = R.warmStone;
      box(b, 3, 34, 26, 9, S[3]);
      box(b, 3, 34, 3, 9, S[4]);
      box(b, 24, 34, 5, 9, S[2]);
      for (let x = 7; x < 29; x += 6) box(b, x, 35, 1, 7, S[1]);
      box(b, 3, 38, 26, 1, S[1]);
      box(b, 3, 42, 26, 1, S[1]);
      disc(b, 16, 34, 13, 4.5, S[4]);
      disc(b, 16, 34.5, 10, 3, S[1]);
      disc(b, 16, 35, 9, 2.5, PAL.water[0]);
      box(b, 12, 35, 3, 1, PAL.water[2]);
      box(b, 3, 12, 3, 24, R.bark[3]);
      box(b, 3, 12, 1, 24, R.bark[4]);
      box(b, 26, 12, 3, 24, R.bark[2]);
      box(b, 4, 18, 24, 2, R.bark[2]);
      box(b, 4, 18, 24, 1, R.bark[4]);
      box(b, 27, 17, 4, 2, R.iron[2]);
      box(b, 16, 20, 1, 8, CANVAS[2]);
      box(b, 13, 27, 7, 5, R.bark[3]);
      box(b, 13, 27, 7, 1, R.bark[4]);
      box(b, 13, 29, 7, 1, R.iron[1]);
      fpoly(b, [0, 15, 16, 3, 32, 15, 29, 16, 16, 6, 3, 16], ROOF_RED[3]);
      fpoly(b, [0, 15, 16, 3, 16, 6, 3, 16], ROOF_RED[4]);
      seg(b, 1, 14, 15, 4, ROOF_RED[5]);
      box(b, 15, 1, 2, 3, R.bark[2]);
    });
  });
}

// ================================================================== objects
// The client anchors (0.5, 1) at the tile's bottom edge - 4px.

const RUNE_STONE = ['#262c36', '#38404c', '#4e5866', '#68737f', '#86919c', '#a8b2bc'];
const OBSIDIAN = ['#140f1e', '#1e162c', '#2a2040', '#3a2c56', '#4e3c70', '#6a5490'];
const LILAC = ['#6a4ea8', '#9a7ad8', '#c8b0ff', '#ece0ff'];

/** Layered pixel flame (base width ~ h * 0.8). */
function flamePx(b: Ctx, x: number, base: number, h: number): void {
  const F = R.flame;
  const w = Math.max(2, Math.round(h * 0.42));
  fpoly(b, [x - w, base, x - w * 0.7, base - h * 0.55, x - w * 0.15, base - h * 0.4, x, base - h, x + w * 0.35, base - h * 0.5, x + w * 0.8, base - h * 0.62, x + w, base], F[1]);
  fpoly(b, [x - w * 0.65, base, x - w * 0.35, base - h * 0.45, x + w * 0.05, base - h * 0.75, x + w * 0.45, base - h * 0.4, x + w * 0.7, base], F[2]);
  fpoly(b, [x - w * 0.35, base, x, base - h * 0.45, x + w * 0.35, base], F[3]);
  px(b, Math.round(x), Math.round(base - h * 0.2), F[4]);
}

function waystone(lit: boolean): (c: Ctx) => void {
  return (c) => {
    const S = RUNE_STONE;
    if (lit) halo(c, 16, 24, 22, '#6fe8ff', 0.42, 4);
    const rune = lit ? ['#2fb8d8', '#8cf0ff', '#e8ffff'] : [S[1], S[2], S[3]];
    sprite(c, 32, 56, (b) => {
      // two-step plinth
      box(b, 3, 49, 26, 5, S[2]);
      box(b, 3, 49, 26, 1, S[4]);
      box(b, 25, 50, 4, 4, S[1]);
      box(b, 6, 45, 20, 5, S[3]);
      box(b, 6, 45, 20, 1, S[5]);
      box(b, 22, 46, 4, 4, S[2]);
      for (const x of [9, 15, 21]) box(b, x, 50, 1, 3, S[1]);
      // monolith: lit left face, shaded right face, pointed crown
      fpoly(b, [8, 46, 8, 13, 11, 6, 16, 2, 21, 6, 24, 13, 24, 46], S[3]);
      fpoly(b, [17, 3, 21, 6, 24, 13, 24, 46, 19, 46], S[2]);
      fpoly(b, [22, 13, 24, 13, 24, 46, 22, 46], S[1]);
      seg(b, 9, 44, 9, 14, S[4]);
      seg(b, 10, 13, 15, 3, S[5]);
      box(b, 8, 30, 1, 3, S[2]);
      box(b, 20, 37, 2, 1, S[1]);
      // carved waystar in a ring
      disc(b, 15.5, 19.5, 5.5, 5.5, S[1]);
      disc(b, 15.5, 19.5, 4.5, 4.5, S[3]);
      fpoly(b, [15.5, 13, 17, 18, 22, 19.5, 17, 21, 15.5, 26, 14, 21, 9, 19.5, 14, 18], rune[1]);
      fpoly(b, [15.5, 13, 17, 18, 22, 19.5, 15.5, 19.5], rune[2]);
      px(b, 15, 19, lit ? '#ffffff' : S[1]);
      // three waymarks
      for (const y of [30, 35, 40]) {
        box(b, 13, y, 6, 2, rune[0]);
        box(b, 13, y, 6, 1, rune[1]);
      }
      // moss at the foot
      box(b, 4, 48, 5, 1, R.moss[2]);
      px(b, 5, 47, R.moss[3]);
      tuft(b, 0, 55);
      tuft(b, 27, 55);
    });
    if (lit) {
      halo(c, 15.5, 19.5, 8, '#bffcff', 0.6, 3);
      px(c, 15, 19, '#ffffff');
      for (const [x, y] of [
        [4, 14],
        [28, 22],
        [5, 34],
        [27, 7],
      ])
        twinkle(c, x, y, '#dffcff');
    }
  };
}

function obelisk(c: Ctx): void {
  const O = OBSIDIAN;
  halo(c, 17, 40, 18, '#b08cff', 0.26);
  sprite(c, 36, 76, (b) => {
    box(b, 4, 66, 28, 7, O[2]);
    box(b, 4, 66, 28, 1, O[4]);
    box(b, 27, 67, 5, 6, O[1]);
    box(b, 7, 62, 22, 5, O[3]);
    box(b, 7, 62, 22, 1, O[5]);
    fpoly(b, [9, 63, 10, 15, 18, 3, 26, 15, 27, 63], O[2]);
    fpoly(b, [18, 3, 26, 15, 27, 63, 19, 63], O[1]);
    fpoly(b, [10, 15, 18, 3, 18, 15], O[4]);
    seg(b, 10, 16, 10, 61, O[4]);
    seg(b, 11, 14, 17, 5, O[5]);
    box(b, 19, 15, 1, 48, O[3]);
  });
  // glowing glyphs (no outline)
  const glyph = (pts: number[]) => fpoly(c, pts, LILAC[2]);
  for (const gy of [22, 34, 47]) halo(c, 14, gy + 2, 6, '#b08cff', 0.55, 2);
  glyph([14, 20, 17, 23, 14, 26, 11, 23]);
  px(c, 14, 23, OBSIDIAN[1]);
  glyph([11, 33, 17, 33, 14, 38]);
  box(c, 11, 46, 6, 2, LILAC[2]);
  box(c, 13, 49, 2, 3, LILAC[1]);
  px(c, 12, 20, LILAC[3]);
}

function windShrine(c: Ctx): void {
  const S = ['#4c5660', '#66717c', '#86929c', '#a6b0b8', '#c4ccd2', '#e0e6ea'];
  sprite(c, 40, 64, (b) => {
    box(b, 6, 54, 28, 6, S[2]);
    box(b, 6, 54, 28, 1, S[4]);
    box(b, 29, 55, 5, 5, S[1]);
    box(b, 12, 15, 16, 40, S[3]);
    box(b, 12, 15, 3, 40, S[5]);
    box(b, 24, 15, 4, 40, S[2]);
    box(b, 27, 15, 1, 40, S[1]);
    // cap + little roof
    box(b, 9, 11, 22, 5, S[3]);
    box(b, 9, 11, 22, 1, S[5]);
    fpoly(b, [6, 12, 20, 3, 34, 12], R.teal[3]);
    fpoly(b, [20, 3, 34, 12, 20, 12], R.teal[1]);
    seg(b, 7, 11, 19, 4, R.teal[4]);
    box(b, 6, 12, 28, 1, R.teal[0]);
    // spiral wind glyph (plotted)
    for (let i = 0; i <= 46; i++) {
      const t = i / 46;
      const a = t * Math.PI * 3.3;
      const r = 1 + t * 5;
      px(b, Math.round(19.5 + Math.cos(a) * r), Math.round(29 + Math.sin(a) * r * 0.95), R.teal[3]);
    }
    box(b, 14, 41, 11, 1, R.teal[3]);
    box(b, 15, 45, 11, 1, R.teal[3]);
    box(b, 14, 42, 11, 1, S[5]);
  });
  // streaming ribbons + a chime
  brush(c, [31, 13, 35, 17, 33, 22, 38, 27], 2, '#e8f6f2');
  brush(c, [29, 14, 32, 21, 29, 27, 33, 32], 2, R.teal[4]);
  box(c, 8, 15, 1, 6, R.cream[1]);
  box(c, 7, 21, 3, 5, '#d8dee4');
  px(c, 7, 21, '#ffffff');
}

function signpost(c: Ctx): void {
  sprite(c, 32, 44, (b) => {
    const B = R.bark;
    box(b, 14, 6, 5, 36, B[3]);
    box(b, 14, 6, 1, 36, B[4]);
    box(b, 17, 6, 2, 36, B[1]);
    box(b, 14, 5, 5, 1, B[4]);
    // arrow boards
    fpoly(b, [4, 13, 8, 8, 27, 8, 27, 18, 8, 18], B[4]);
    box(b, 8, 8, 19, 1, B[5]);
    box(b, 8, 17, 19, 1, B[2]);
    box(b, 9, 12, 13, 1, B[1]);
    box(b, 9, 14, 9, 1, B[1]);
    fpoly(b, [6, 21, 24, 21, 29, 26, 24, 31, 6, 31], B[3]);
    box(b, 6, 21, 18, 1, B[4]);
    box(b, 6, 30, 18, 1, B[1]);
    box(b, 9, 25, 12, 1, B[1]);
    box(b, 9, 27, 8, 1, B[1]);
    box(b, 16, 10, 2, 2, R.iron[2]);
    box(b, 16, 24, 2, 2, R.iron[2]);
    tuft(b, 9, 43);
    tuft(b, 18, 43);
  });
}

function chest(open: boolean): (c: Ctx) => void {
  return (c) => {
    const H = open ? 32 : 28;
    const oy = open ? 4 : 0;
    const B = ['#3a2010', '#5a3218', '#7e4824', '#a0602e', '#bc7c40', '#d49a5a'];
    if (open) halo(c, 16, 13 + oy, 14, '#ffd84d', 0.45);
    sprite(c, 32, H, (b) => {
      if (open) {
        box(b, 5, 1, 22, 11, B[2]);
        box(b, 5, 1, 22, 1, B[4]);
        box(b, 7, 3, 18, 8, '#2a160a');
        box(b, 5, 6, 22, 1, R.gold[2]);
      }
      box(b, 4, 13 + oy, 24, 12, B[3]);
      box(b, 4, 13 + oy, 24, 1, B[4]);
      box(b, 4, 23 + oy, 24, 2, B[1]);
      box(b, 24, 13 + oy, 4, 12, B[2]);
      for (let x = 8; x < 24; x += 5) box(b, x, 14 + oy, 1, 9, B[2]);
      for (const x of [6, 21]) {
        box(b, x, 13 + oy, 3, 12, R.gold[2]);
        box(b, x, 13 + oy, 1, 12, R.gold[3]);
        box(b, x + 2, 13 + oy, 1, 12, R.gold[1]);
      }
      if (open) {
        box(b, 5, 11 + oy, 22, 3, '#2a160a');
        for (let i = 0; i < 7; i++) {
          const x = 7 + i * 3;
          const y = 10 + oy + (i % 2);
          box(b, x - 1, y, 3, 2, i % 3 ? R.gold[3] : R.gold[2]);
          px(b, x - 1, y, R.gold[4]);
        }
        box(b, 12, 8 + oy, 2, 2, '#8ce0f4');
        px(b, 12, 8 + oy, '#e0fbff');
        box(b, 19, 8 + oy, 2, 2, PAL.rose);
      } else {
        // domed lid
        box(b, 4, 6, 24, 8, B[4]);
        box(b, 5, 5, 22, 1, B[4]);
        box(b, 7, 4, 18, 1, B[5]);
        box(b, 4, 6, 24, 1, B[5]);
        box(b, 4, 12, 24, 2, B[1]);
        box(b, 24, 6, 4, 6, B[3]);
        for (const x of [6, 21]) {
          box(b, x, 4, 3, 10, R.gold[3]);
          box(b, x, 4, 1, 10, R.gold[4]);
          box(b, x + 2, 4, 1, 10, R.gold[1]);
        }
        box(b, 14, 11, 5, 6, R.gold[2]);
        box(b, 14, 11, 5, 1, R.gold[4]);
        box(b, 16, 13, 1, 2, '#2a160a');
      }
    });
    if (open) {
      twinkle(c, 10, 9, '#fff8d0');
      px(c, 22, 12, '#ffffff');
    } else box(c, 9, 6, 2, 1, '#fff2c0');
  };
}

function statue(c: Ctx): void {
  const S = R.warmStone;
  sprite(c, 40, 68, (b) => {
    box(b, 6, 50, 28, 14, S[2]);
    box(b, 6, 48, 28, 4, S[4]);
    box(b, 6, 48, 28, 1, S[5]);
    box(b, 29, 51, 5, 13, S[1]);
    box(b, 13, 55, 13, 5, S[1]);
    box(b, 14, 56, 11, 1, S[3]);
    // robed wanderer, hood up, leaning on a tall staff
    fpoly(b, [11, 48, 13, 27, 20, 20, 27, 27, 29, 48], S[3]);
    fpoly(b, [20, 20, 27, 27, 29, 48, 21, 48], S[2]);
    seg(b, 12, 46, 14, 28, S[4]);
    disc(b, 20, 15, 6, 6.5, S[3]);
    fpoly(b, [14, 16, 15, 9, 20, 6, 25, 9, 26, 16, 23, 13, 17, 13], S[4]);
    disc(b, 20, 16, 3.5, 3, S[0]);
    box(b, 14, 30, 12, 3, S[2]);
    seg(b, 17, 33, 15, 47, S[1]);
    seg(b, 23, 33, 25, 47, S[1]);
    box(b, 29, 4, 3, 45, S[3]);
    box(b, 29, 4, 1, 45, S[5]);
    box(b, 31, 4, 1, 45, S[1]);
    disc(b, 30.5, 4, 3, 3, S[4]);
    px(b, 29, 3, S[5]);
    box(b, 25, 26, 6, 3, S[3]);
    // moss + cracks
    mossCap(b, 7, 47, 7);
    box(b, 26, 46, 4, 1, R.moss[2]);
    seg(b, 13, 36, 16, 40, S[1]);
    seg(b, 16, 40, 14, 44, S[1]);
    tuft(b, 3, 67);
    tuft(b, 31, 67);
  });
}

/** Campfire flame per idle frame [dx, h]: frame 0 the still look, then a lower lick left and a taller lick right. */
const CAMPFIRE_FLAME: readonly (readonly [number, number])[] = [
  [0, 17],
  [-1, 15],
  [1, 18],
];
/** Spark pixels above the fire per frame ([x, y, ramp index]). */
const CAMPFIRE_SPARKS: readonly (readonly (readonly [number, number, number])[])[] = [
  [
    [11, 4, 3],
    [21, 2, 2],
    [18, 6, 4],
  ],
  [
    [12, 2, 2],
    [20, 5, 3],
    [14, 7, 4],
  ],
  [
    [10, 6, 3],
    [19, 1, 2],
    [22, 7, 4],
  ],
];

function campfire(c: Ctx, frame = 0): void {
  const [dx, fh] = CAMPFIRE_FLAME[frame];
  halo(c, 16, 20, [17, 16, 18][frame], '#ff9a3a', 0.5);
  sprite(c, 32, 32, (b) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = 16 + Math.cos(a) * 10;
      const y = 24 + Math.sin(a) * 4;
      if (y < 22) continue;
      disc(b, x, y, 3, 2.2, i % 2 ? R.warmStone[2] : R.warmStone[3]);
      box(b, Math.round(x - 1), Math.round(y - 2), 2, 1, R.warmStone[5]);
    }
    brush(b, [8, 25, 24, 19], 3, R.bark[3]);
    brush(b, [24, 25, 8, 19], 3, R.bark[2]);
    seg(b, 8, 24, 23, 18, R.bark[4]);
    disc(b, 8, 25, 1.5, 1.5, R.cream[2]);
    disc(b, 24, 25, 1.5, 1.5, R.cream[2]);
    box(b, 12, 21, 8, 2, R.flame[0]);
    flamePx(b, 16 + dx, 23, fh);
  });
  for (const [x, y, k] of CAMPFIRE_SPARKS[frame]) px(c, x, y, R.flame[k]);
}

function drawObjects(scene: Phaser.Scene): void {
  canvasTex(scene, 'obj_waystone', 32, 56, waystone(false));
  canvasTex(scene, 'obj_waystone_lit', 32, 56, waystone(true));
  // idle strip: the two candle flames flicker out of step (frame 0 the still look)
  stripTex(scene, 'obj_altar', 48, 44, 3, (c, f) => {
    halo(c, 11, 10, 8, '#ffcf6a', 0.4);
    halo(c, 37, 10, 8, '#ffcf6a', 0.4);
    sprite(c, 48, 44, (b) => {
      const S = R.warmStone;
      box(b, 8, 24, 32, 15, S[2]);
      box(b, 8, 24, 3, 15, S[3]);
      box(b, 36, 24, 4, 15, S[1]);
      box(b, 6, 37, 36, 3, S[1]);
      box(b, 6, 37, 36, 1, S[3]);
      box(b, 4, 16, 40, 9, S[3]);
      box(b, 4, 16, 40, 1, S[5]);
      box(b, 4, 17, 40, 1, S[4]);
      box(b, 4, 23, 40, 2, S[1]);
      box(b, 40, 17, 4, 6, S[2]);
      // cloth runner with the waystar
      box(b, 18, 16, 12, 19, R.violet[2]);
      fpoly(b, [18, 35, 24, 38, 30, 35], R.violet[2]);
      box(b, 18, 16, 2, 19, R.violet[3]);
      box(b, 28, 17, 2, 18, R.violet[1]);
      box(b, 18, 16, 12, 1, R.violet[4]);
      box(b, 18, 33, 12, 1, R.gold[2]);
      waystar(b, 24, 27, 3);
      // offering bowl
      box(b, 20, 13, 9, 3, R.gold[1]);
      box(b, 20, 13, 9, 1, R.gold[3]);
      box(b, 21, 12, 7, 1, '#ffe08a');
      for (const x of [11, 36]) {
        box(b, x - 2, 9, 4, 8, R.cream[3]);
        box(b, x - 2, 9, 1, 8, R.cream[4]);
        box(b, x + 1, 9, 1, 8, R.cream[1]);
        px(b, x, 8, R.iron[1]);
        flamePx(b, x, 8, 6 + (f === 0 ? 0 : (x < 24) === (f === 1) ? 1 : -1));
      }
    });
  });
  texAll(scene, ['obj_wind_shrine', 'shrine'], 40, 64, windShrine);
  texAll(scene, ['obj_obelisk', 'obelisk'], 36, 76, obelisk);
  texAll(scene, ['obj_signpost', 'signpost'], 32, 44, signpost);
  canvasTex(scene, 'obj_chest', 32, 28, chest(false));
  canvasTex(scene, 'obj_chest_open', 32, 32, chest(true));
  canvasTex(scene, 'obj_statue', 40, 68, statue);
  stripTex(scene, 'obj_campfire', 32, 32, 3, campfire);
  canvasTex(scene, 'bobber', 12, 12, (c) =>
    sprite(c, 12, 12, (b) => {
      disc(b, 6, 6, 4.5, 4.5, R.crimson[2]);
      box(b, 2, 6, 9, 2, R.cream[4]);
      box(b, 4, 3, 2, 1, R.crimson[4]);
      box(b, 6, 1, 1, 2, R.bark[2]);
    }),
  );
}

// ================================================================== gather nodes

function oreRock(c: Ctx): void {
  const rnd = artRng(keySeed('node_ore'));
  sprite(c, 34, 30, (b) => {
    rockPx(b, 2, 3, 1, R.warmStone, false, rnd);
    const vein = (pts: number[]) => {
      brush(b, pts, 2, R.gold[1]);
      for (let i = 0; i + 3 < pts.length; i += 2) seg(b, pts[i], pts[i + 1] - 1, pts[i + 2], pts[i + 3] - 1, R.gold[3]);
    };
    vein([9, 14, 13, 17, 18, 15, 23, 18]);
    vein([12, 22, 16, 20, 21, 24]);
    for (const [x, y] of [
      [12, 10],
      [19, 8],
      [24, 14],
      [15, 18],
      [26, 21],
      [7, 20],
    ]) {
      box(b, x, y, 3, 2, R.gold[3]);
      px(b, x, y, R.gold[4]);
      px(b, x + 2, y + 1, R.gold[1]);
    }
  });
  twinkle(c, 20, 6, '#fff6c0');
}

function drawNodes(scene: Phaser.Scene): void {
  texAll(scene, ['node_ore', 'ore'], 34, 30, oreRock);

  // Ripple decal on water (centred, no outline): pixel rings, bubbles and a glint.
  canvasTex(scene, 'node_fishing', 36, 24, (c) => {
    const ring = (rx: number, ry: number, col: string) => {
      for (let a = 0; a < 96; a++) {
        const t = (a / 96) * Math.PI * 2;
        px(c, Math.round(18 + Math.cos(t) * rx), Math.round(12 + Math.sin(t) * ry), col);
      }
    };
    ring(16, 8, 'rgba(216,238,246,0.35)');
    ring(11, 5.5, 'rgba(216,238,246,0.55)');
    ring(6, 3, 'rgba(232,248,255,0.8)');
    for (const [x, y, r] of [
      [13, 10, 1.6],
      [22, 8, 1.2],
      [26, 13, 1],
      [17, 5, 1],
    ] as const) {
      disc(c, x, y, r + 0.8, r + 0.8, 'rgba(216,238,246,0.6)');
      disc(c, x, y, r, r, 'rgba(74,146,196,0.7)');
      px(c, Math.round(x - r * 0.5), Math.round(y - r * 0.6), '#ffffff');
    }
  });

  canvasTex(scene, 'node_herb', 28, 28, (c) => {
    sprite(c, 28, 28, (b) => {
      const leaf = (x0: number, y0: number, x1: number, y1: number, w: number, tone: number) => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        const nx = -dy / len;
        const ny = dx / len;
        fpoly(b, [x0, y0, x0 + dx * 0.5 + nx * w, y0 + dy * 0.5 + ny * w, x1, y1, x0 + dx * 0.5 - nx * w, y0 + dy * 0.5 - ny * w], R.leaf[tone]);
        seg(b, Math.round(x0), Math.round(y0), Math.round(x0 + dx * 0.8), Math.round(y0 + dy * 0.8), R.leaf[tone - 1]);
      };
      leaf(14, 25, 3, 16, 3, 2);
      leaf(14, 25, 25, 16, 3, 2);
      leaf(14, 25, 6, 11, 3, 3);
      leaf(14, 25, 22, 11, 3, 3);
      leaf(14, 25, 14, 9, 3, 4);
      for (const [x, y] of [
        [8, 6],
        [19, 4],
        [14, 3],
      ]) {
        seg(b, 14, 17, x, y + 2, R.leaf[1]);
        box(b, x - 1, y, 3, 3, R.cream[3]);
        px(b, x - 1, y, R.cream[4]);
        px(b, x, y + 2, '#9ab8ff');
      }
    });
  });

  canvasTex(scene, 'node_ember_vent', 32, 32, (c) => {
    halo(c, 16, 20, 14, '#ff7a2a', 0.5);
    sprite(c, 32, 32, (b) => {
      const E = ['#2a1a14', '#3e2820', '#56382a', '#6e4a38', '#8a604a'];
      fpoly(b, [2, 28, 6, 21, 12, 17, 20, 17, 26, 21, 30, 28, 22, 30, 10, 30], E[2]);
      fpoly(b, [6, 21, 12, 17, 20, 17, 26, 21, 18, 22, 12, 22], E[4]);
      fpoly(b, [22, 21, 26, 21, 30, 28, 22, 30], E[1]);
      seg(b, 7, 21, 12, 18, E[4]);
      disc(b, 16, 20, 5, 2.2, '#200c06');
      disc(b, 16, 20, 3.5, 1.4, R.flame[2]);
      box(b, 15, 20, 3, 1, R.flame[4]);
      seg(b, 8, 27, 11, 23, R.flame[2]);
      seg(b, 23, 28, 21, 24, R.flame[2]);
      px(b, 11, 23, R.flame[4]);
    });
    disc(c, 15, 12, 3, 2.4, 'rgba(120,110,105,0.55)');
    disc(c, 18, 7, 4, 3, 'rgba(120,110,105,0.4)');
    disc(c, 15, 2, 4, 2, 'rgba(120,110,105,0.25)');
    px(c, 20, 10, R.flame[3]);
    px(c, 12, 6, R.flame[4]);
  });

  canvasTex(scene, 'node_wind_chime', 28, 52, (c) => {
    sprite(c, 28, 52, (b) => {
      box(b, 10, 6, 4, 44, R.bark[3]);
      box(b, 10, 6, 1, 44, R.bark[4]);
      box(b, 13, 6, 1, 44, R.bark[1]);
      box(b, 3, 6, 23, 3, R.bark[3]);
      box(b, 3, 6, 23, 1, R.bark[5]);
      box(b, 3, 8, 23, 1, R.bark[1]);
      fpoly(b, [8, 6, 12, 1, 16, 6], R.teal[3]);
      fpoly(b, [12, 1, 16, 6, 12, 6], R.teal[1]);
      for (const [x, len] of [
        [5, 9],
        [17, 12],
        [21, 8],
        [25, 11],
      ] as const) {
        box(b, x, 9, 1, 3, R.cream[1]);
        box(b, x - 1, 12, 3, len, R.iron[3]);
        box(b, x - 1, 12, 1, len, '#e8eef4');
        box(b, x + 1, 12, 1, len, R.iron[2]);
      }
      brush(b, [8, 9, 7, 20, 9, 26], 2, '#e8f6f2');
      fpoly(b, [6, 24, 10, 22, 11, 30, 8, 31], R.teal[4]);
      tuft(b, 7, 51);
    });
    box(c, 1, 30, 4, 1, 'rgba(255,255,255,0.7)');
    box(c, 0, 36, 5, 1, 'rgba(255,255,255,0.5)');
  });

  canvasTex(scene, 'node_storm_tree', 44, 64, (c) => {
    const rnd = artRng(keySeed('node_storm_tree'));
    halo(c, 22, 22, 22, '#8fd8ff', 0.28);
    sprite(c, 44, 64, (b) => {
      const B = ['#22222e', '#30303e', '#40404f', '#545466', '#6a6a7e', '#84849a'];
      fpoly(b, [15, 61, 19, 53, 19, 34, 25, 34, 25, 53, 29, 61], B[3]);
      box(b, 23, 34, 2, 26, B[1]);
      box(b, 19, 36, 2, 22, B[4]);
      brush(b, [20, 40, 10, 30, 6, 18], 3, B[3]);
      brush(b, [24, 36, 34, 26, 38, 14], 3, B[2]);
      brush(b, [22, 34, 21, 18, 24, 8], 3, B[3]);
      brush(b, [10, 30, 3, 28], 2, B[3]);
      brush(b, [34, 26, 41, 26], 2, B[2]);
      brush(b, [6, 18, 3, 11], 2, B[3]);
      brush(b, [6, 18, 11, 10], 2, B[3]);
      brush(b, [38, 14, 35, 6], 2, B[2]);
      brush(b, [38, 14, 42, 8], 2, B[2]);
      brush(b, [24, 8, 21, 2], 2, B[3]);
      brush(b, [24, 8, 28, 3], 2, B[3]);
      seg(b, 19, 39, 10, 30, B[5]);
      seg(b, 21, 33, 20, 18, B[5]);
      const tips = [
        [4, 12],
        [10, 11],
        [35, 7],
        [41, 9],
        [21, 3],
        [28, 4],
        [3, 28],
        [41, 26],
      ];
      for (let i = 0; i < 22; i++) {
        const [tx, ty] = tips[i % tips.length];
        const x = Math.round(tx + (rnd() - 0.5) * 7);
        const y = Math.round(ty + (rnd() - 0.5) * 5);
        box(b, x, y, 2, 2, rnd() < 0.5 ? '#3f5a6a' : '#5a7c8e');
        px(b, x, y, '#7a9cae');
      }
    });
    const bolt = (pts: number[]) => {
      for (let i = 0; i + 3 < pts.length; i += 2) seg(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], '#e8faff');
      for (let i = 0; i + 3 < pts.length; i += 2) seg(c, pts[i] + 1, pts[i + 1], pts[i + 2] + 1, pts[i + 3], 'rgba(140,224,244,0.6)');
    };
    bolt([6, 18, 11, 24, 8, 28, 14, 33]);
    bolt([38, 14, 33, 20, 36, 23, 30, 29]);
    bolt([24, 8, 20, 14, 23, 17]);
    twinkle(c, 3, 10, '#dff6ff');
    px(c, 41, 20, '#dff6ff');
  });

  canvasTex(scene, 'node_shadow_fungus', 28, 30, (c) => {
    halo(c, 14, 20, 14, '#a060ff', 0.42);
    const CAP = ['#1e1230', '#2e1c48', '#46306c', '#6a4aa0', '#9a78d8'];
    const STEM = ['#6a5a8a', '#9888b8', '#c8b8e8', '#e8dcff'];
    sprite(c, 28, 30, (b) => {
      shroom(b, 17, 17, 6, 5, 10, CAP, STEM, false);
      shroom(b, 8, 21, 5, 4, 6, CAP, STEM, false);
      shroom(b, 22, 24, 3, 2, 3, CAP, STEM, false);
      for (const [x, y] of [
        [15, 14],
        [19, 13],
        [7, 19],
        [10, 18],
      ])
        px(b, x, y, '#d8b8ff');
    });
    for (const [x, y] of [
      [5, 9],
      [24, 6],
      [13, 4],
    ])
      px(c, x, y, '#e0c8ff');
    box(c, 11, 17, 12, 1, 'rgba(176,122,255,0.7)');
  });

  canvasTex(scene, 'node_sun_spring', 40, 36, (c) => {
    for (const x of [13, 20, 27]) for (let y = 2; y < 26; y += 2) box(c, x - 1, y, 3, 1, `rgba(255,230,140,${0.05 + (y / 26) * 0.4})`);
    halo(c, 20, 24, 16, '#ffd860', 0.42);
    sprite(c, 40, 36, (b) => {
      const S = R.warmStone;
      const stone = (i: number) => {
        const a = (i / 12) * Math.PI * 2;
        const x = 20 + Math.cos(a) * 15;
        const y = 25 + Math.sin(a) * 6;
        disc(b, x, y, 3.5, 2.6, i % 2 ? S[3] : S[4]);
        box(b, Math.round(x - 1), Math.round(y - 2), 2, 1, S[5]);
        box(b, Math.round(x), Math.round(y + 1), 2, 1, S[2]);
      };
      for (let i = 0; i < 12; i++) if (Math.sin((i / 12) * Math.PI * 2) <= 0.2) stone(i);
      disc(b, 20, 25, 12, 4.5, R.gold[1]);
      disc(b, 20, 24.5, 10, 3.5, R.gold[3]);
      box(b, 14, 23, 6, 1, R.gold[4]);
      for (let i = 0; i < 12; i++) if (Math.sin((i / 12) * Math.PI * 2) > 0.2) stone(i);
    });
    for (const [x, y] of [
      [10, 12],
      [30, 9],
      [21, 5],
    ])
      twinkle(c, x, y, '#fff4c0');
  });

  canvasTex(scene, 'node_frost_crystal', 28, 40, (c) => {
    halo(c, 14, 26, 14, '#c8f0ff', 0.38);
    const ICE = ['#3a6a8a', '#5a94b8', '#8cc6e6', '#c8ecfa', '#eefaff', '#ffffff'];
    sprite(c, 28, 40, (b) => {
      disc(b, 14, 36, 11, 3, SNOW[3]);
      box(b, 5, 35, 18, 1, SNOW[4]);
      shard(b, 8, 34, 18, 3, -3, ICE);
      shard(b, 20, 34, 16, 3, 3, ICE);
      shard(b, 14, 35, 4, 4, 0, ICE);
    });
    px(c, 13, 9, '#ffffff');
    px(c, 3, 10, '#e8fbff');
    px(c, 25, 14, '#e8fbff');
  });

  canvasTex(scene, 'node_depleted', 32, 22, (c) => {
    sprite(c, 32, 22, (b) => {
      disc(b, 16, 15, 12, 4, R.dirt[0]);
      disc(b, 16, 14, 10, 3, R.dirt[1]);
      box(b, 10, 12, 8, 1, R.dirt[2]);
      for (const [x, y] of [
        [8, 13],
        [13, 11],
        [20, 12],
        [24, 15],
        [11, 16],
        [18, 16],
      ]) {
        box(b, x, y, 3, 2, R.stone[3]);
        px(b, x, y, R.stone[4]);
        box(b, x, y + 2, 3, 1, R.stone[1]);
      }
      box(b, 15, 5, 1, 7, R.bark[3]);
      box(b, 15, 5, 3, 1, R.bark[3]);
    });
  });
}

// ================================================================== portals & gates

/** Socket centres on gate_prism (texture pixels, top-left origin), left to right along the arch. */
export const PRISM_GATE_SIZE = { w: 96, h: 112 } as const;
export const PRISM_SOCKETS: ReadonlyArray<readonly [number, number]> = (() => {
  const out: [number, number][] = [];
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + 0.32 + (i * (Math.PI - 0.64)) / 6;
    out.push([Math.round(48 + Math.cos(a) * 34), Math.round(48 + Math.sin(a) * 34)]);
  }
  return out;
})();

function drawPortals(scene: Phaser.Scene): void {
  // White chevrons pointing NORTH (up); the client rotates by facing (e 90°, s 180°, w 270°) and tints them.
  canvasTex(scene, 'portal_edge', 32, 32, (c) => {
    const chev = (y: number, a: number) => {
      const s = scratch(32, 32);
      fpoly(s.c, [4, y + 9, 16, y - 2, 28, y + 9, 28, y + 13, 16, y + 3, 4, y + 13], '#ffffff');
      fpoly(s.c, [16, y + 3, 28, y + 13, 28, y + 10, 16, y], '#c8c8c8');
      seg(s.c, 5, y + 9, 16, y - 1, '#ffffff');
      outline(s.c, 32, 32, 'rgba(43,42,64,0.85)');
      c.globalAlpha = a;
      c.drawImage(s.el, 0, 0);
      c.globalAlpha = 1;
    };
    chev(16, 0.6);
    chev(5, 1);
  });

  // Dungeon entrance carved into a rock face, timber-framed, with two torches (origin bottom-centre).
  // idle strip: the two torches flicker out of step (frame 0 the still look)
  stripTex(scene, 'portal_door', 64, 64, 3, (c, f) => {
    const S = R.warmStone;
    sprite(c, 64, 64, (b) => {
      fpoly(b, [2, 61, 3, 34, 8, 18, 18, 8, 32, 4, 46, 8, 56, 18, 61, 34, 62, 61], S[2]);
      fpoly(b, [3, 40, 8, 20, 18, 10, 32, 6, 46, 10, 56, 20, 61, 40, 48, 30, 32, 26, 16, 30], S[3]);
      fpoly(b, [8, 20, 18, 10, 32, 6, 46, 10, 36, 13, 22, 15], S[4]);
      seg(b, 9, 19, 18, 9, S[5]);
      seg(b, 19, 9, 31, 5, S[5]);
      fpoly(b, [46, 10, 56, 20, 61, 40, 61, 61, 52, 61, 50, 34], S[1]);
      for (const [x, y, w] of [
        [6, 46, 8],
        [50, 42, 9],
        [10, 31, 6],
        [44, 26, 7],
        [24, 18, 9],
      ] as const) {
        box(b, x, y, w, 1, S[0]);
        box(b, x, y + 1, w, 1, S[4]);
      }
      mossCap(b, 22, 7, 10);
      // opening
      fpoly(b, [19, 62, 19, 36, 24, 28, 32, 26, 40, 28, 45, 36, 45, 62], '#0c0807');
      fpoly(b, [21, 62, 21, 38, 25, 31, 32, 29, 32, 62], '#1a1210');
      for (let y = 40; y < 62; y += 5) box(b, 22, y, 20, 1, '#241a16');
      // timber frame
      box(b, 16, 31, 5, 31, R.bark[3]);
      box(b, 16, 31, 1, 31, R.bark[4]);
      box(b, 43, 31, 5, 31, R.bark[2]);
      box(b, 47, 31, 1, 31, R.bark[1]);
      box(b, 14, 28, 36, 4, R.bark[3]);
      box(b, 14, 28, 36, 1, R.bark[5]);
      box(b, 14, 31, 36, 1, R.bark[1]);
      for (const x of [18, 45]) px(b, x, 30, R.iron[3]);
      box(b, 15, 61, 34, 3, S[3]);
      box(b, 15, 61, 34, 1, S[5]);
      // torch sconces
      for (const x of [9, 55]) {
        box(b, x - 1, 38, 3, 8, R.bark[2]);
        box(b, x - 2, 37, 5, 2, R.iron[2]);
      }
    });
    for (const x of [9, 55]) {
      const d = f === 0 ? 0 : (x < 32) === (f === 1) ? 1 : -1;
      halo(c, x, 32, 10 + d, '#ffb050', 0.5);
      flamePx(c, x, 37, 8 + d);
    }
  });

  // Hole in the floor with steps descending north into darkness (centred decal).
  canvasTex(scene, 'portal_stairs_down', 32, 32, (c) => {
    const S = R.warmStone;
    box(c, 2, 2, 28, 28, S[2]);
    box(c, 2, 2, 28, 2, S[4]);
    box(c, 2, 2, 2, 28, S[3]);
    box(c, 28, 2, 2, 28, S[1]);
    box(c, 2, 28, 28, 2, S[1]);
    const shades = [S[4], S[3], S[2], S[1], S[0], '#120e0c'];
    for (let i = 0; i < 6; i++) {
      const y = 25 - i * 4;
      box(c, 5, y, 22, 4, shades[i]);
      box(c, 5, y, 22, 1, shade(shades[i], 18));
      box(c, 5, y + 3, 22, 1, shade(shades[i], -24));
    }
    box(c, 5, 4, 22, 3, '#0a0807');
    box(c, 4, 4, 1, 25, S[0]);
    box(c, 27, 4, 1, 25, '#1a1512');
    outline(c, 32, 32, OUT);
  });

  // Staircase rising north into a lit archway.
  canvasTex(scene, 'portal_stairs_up', 32, 40, (c) => {
    const S = R.warmStone;
    halo(c, 16, 8, 14, '#fff2c0', 0.5);
    sprite(c, 32, 40, (b) => {
      box(b, 2, 12, 28, 27, S[2]);
      box(b, 2, 12, 5, 27, S[3]);
      box(b, 2, 12, 1, 27, S[4]);
      box(b, 25, 12, 5, 27, S[1]);
      for (let y = 0; y <= 14; y++) {
        const half = Math.round(Math.sqrt(Math.max(0, 14 * 14 - (14 - y) ** 2)));
        box(b, 16 - half, y, half * 2, 1, S[3]);
        if (y < 14) {
          const ih = Math.round(Math.sqrt(Math.max(0, 9 * 9 - (14 - y) ** 2)));
          if (ih > 0) box(b, 16 - ih, y, ih * 2, 1, GLASS[4]);
        }
      }
      for (let i = 0; i < 11; i++) {
        const a = Math.PI + (i / 10) * Math.PI;
        px(b, Math.round(16 + Math.cos(a) * 11.5), Math.round(14 + Math.sin(a) * 11.5), S[1]);
      }
      box(b, 7, 14, 18, 4, GLASS[3]);
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const y = Math.round(34 - i * 3.6);
        const hw = Math.round(9 - t * 2);
        const tread = [S[2], S[3], S[3], S[4], S[4], S[5]][i];
        box(b, 16 - hw, y + 1, hw * 2, 3, S[1]);
        box(b, 16 - hw, y - 1, hw * 2, 2, tread);
        box(b, 16 - hw, y - 1, hw * 2, 1, shade(tread, 18));
      }
      box(b, 7, 18, 2, 20, S[1]);
      box(b, 23, 18, 2, 20, S[0]);
      box(b, 2, 37, 28, 2, S[1]);
    });
  });

  // Prism Gate: stone arch with 7 empty sockets. The opening stays transparent so the client can draw its own
  // barrier/portal effect inside it.
  canvasTex(scene, 'gate_prism', PRISM_GATE_SIZE.w, PRISM_GATE_SIZE.h, (c) => {
    const S = ['#3a3648', '#55506a', '#716b88', '#8e88a6', '#aca6c2', '#ccc8de'];
    sprite(c, 96, 112, (b) => {
      for (const x of [4, 70]) {
        box(b, x, 96, 22, 12, S[2]);
        box(b, x, 94, 22, 4, S[4]);
        box(b, x, 94, 22, 1, S[5]);
        box(b, x + 18, 96, 4, 12, S[1]);
      }
      for (const x of [8, 72]) {
        box(b, x, 46, 16, 49, S[3]);
        box(b, x, 46, 2, 49, S[5]);
        box(b, x + 11, 46, 5, 49, S[2]);
        box(b, x + 15, 46, 1, 49, S[1]);
        for (let y = 56; y < 94; y += 10) {
          box(b, x, y, 16, 1, S[1]);
          box(b, x, y + 1, 11, 1, S[4]);
        }
        fpoly(b, [x + 8, 63, x + 12, 70, x + 8, 77, x + 4, 70], R.violet[1]);
        fpoly(b, [x + 8, 65, x + 10, 70, x + 8, 75, x + 6, 70], R.violet[3]);
        px(b, x + 7, 68, R.violet[5]);
      }
      // voussoir ring (per-pixel polar fill)
      const cx = 48;
      const cy = 48;
      for (let y = 4; y <= 48; y++)
        for (let x = 4; x <= 92; x++) {
          const dx = x + 0.5 - cx;
          const dy = y + 0.5 - cy;
          const r = Math.hypot(dx, dy);
          if (r < 26 || r > 42 || dy > 0.5) continue;
          const a = Math.atan2(dy, dx);
          const seam = Math.abs(((a + Math.PI) / (Math.PI / 9)) % 1) < 0.07;
          let tone = r > 39.5 ? (dx < 0 ? 5 : 3) : r < 28.5 ? 1 : dx < -8 ? 4 : dx < 10 ? 3 : 2;
          if (seam) tone = 1;
          px(b, x, y, S[tone]);
        }
      // keystone
      fpoly(b, [41, 4, 55, 4, 53, 22, 43, 22], S[4]);
      box(b, 41, 4, 14, 2, S[5]);
      box(b, 52, 6, 2, 16, S[2]);
      fpoly(b, [48, 8, 51, 12, 48, 16, 45, 12], '#ece6ff');
      px(b, 47, 10, '#ffffff');
      // empty sockets
      for (const [x, y] of PRISM_SOCKETS) {
        disc(b, x, y, 5, 5, S[1]);
        disc(b, x, y + 0.5, 4, 4, '#221e2e');
        box(b, x - 2, y - 2, 2, 1, '#4a405e');
        box(b, x - 1, y + 3, 3, 1, S[4]);
      }
    });
  });

  canvasTex(scene, 'gate_socket', 12, 12, (c) => {
    fpoly(c, [6, 0, 11, 4, 11, 8, 6, 12, 1, 8, 1, 4], '#a8a8b4');
    fpoly(c, [6, 1, 10, 4, 6, 6, 2, 4], '#ffffff');
    fpoly(c, [2, 4, 6, 6, 6, 11, 2, 8], '#e6e6ee');
    fpoly(c, [10, 4, 10, 8, 6, 11, 6, 6], '#9a9aa6');
    px(c, 4, 3, '#ffffff');
  });

  // ---- hidden-portal blockers
  canvasTex(scene, 'hide_shimmer', 40, 48, (c) => {
    for (let i = 0; i < 6; i++) {
      const x0 = 8 + i * 5;
      for (let y = 6 + (i % 2) * 4; y <= 44 - (i % 3) * 3; y++) {
        const x = Math.round(x0 + Math.sin(y * 0.35 + i) * 2);
        px(c, x, y, `rgba(255,255,255,${0.22 + (i % 2) * 0.2})`);
      }
    }
    for (const [x, y] of [
      [12, 12],
      [27, 18],
      [17, 34],
      [31, 38],
      [8, 28],
    ])
      twinkle(c, x, y, 'rgba(255,255,255,0.9)');
  });

  canvasTex(scene, 'hide_cracked_rock', 48, 44, (c) => {
    const rnd = artRng(keySeed('hide_cracked_rock'));
    sprite(c, 48, 44, (b) => {
      rockPx(b, 2, 4, 1.45, R.warmStone, true, rnd);
      const crack = (pts: number[]) => {
        for (let i = 0; i + 3 < pts.length; i += 2) {
          seg(b, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], '#1e1814');
          seg(b, pts[i] + 1, pts[i + 1], pts[i + 2] + 1, pts[i + 3], R.warmStone[5]);
        }
      };
      crack([24, 6, 21, 14, 26, 20, 22, 28, 25, 37]);
      crack([21, 14, 13, 18, 10, 26]);
      crack([26, 20, 34, 22, 40, 30]);
      crack([22, 28, 16, 34]);
    });
    for (const [x, y] of [
      [6, 40],
      [40, 41],
      [33, 42],
    ]) {
      box(c, x, y, 3, 2, R.warmStone[2]);
      box(c, x, y, 2, 1, R.warmStone[4]);
    }
  });

  canvasTex(scene, 'hide_brambles', 48, 40, (c) => {
    const rnd = artRng(keySeed('hide_brambles'));
    sprite(c, 48, 40, (b) => {
      leafMass(b, 24, 25, 21, 12, ['#141e10', '#1e2c18', '#2a3c20', '#3a522a', '#4c6a34', '#6a8a48'], rnd, false, 3.4);
      for (let i = 0; i < 12; i++) {
        let x = 4 + rnd() * 40;
        let y = 35 - rnd() * 6;
        const pts = [x, y];
        for (let s = 0; s < 4; s++) {
          x = Math.max(2, Math.min(46, x + (rnd() - 0.5) * 14));
          y = Math.max(3, y - 4 - rnd() * 5);
          pts.push(x, y);
        }
        brush(b, pts, 2, i % 2 ? '#5a4024' : '#4a4a22');
        for (let p = 2; p < pts.length; p += 2) {
          px(b, Math.round(pts[p]) + 1, Math.round(pts[p + 1]) - 1, R.cream[2]);
          px(b, Math.round(pts[p]) - 2, Math.round(pts[p + 1]) + 1, R.cream[2]);
        }
      }
      for (const [x, y] of [
        [14, 18],
        [31, 14],
        [36, 26],
        [20, 28],
      ]) {
        box(b, x, y, 2, 2, '#6a2050');
        px(b, x, y, '#c86aa0');
      }
    });
  });

  canvasTex(scene, 'hide_fog', 64, 48, (c) => {
    for (const [x, y, rx, ry, a] of [
      [32, 30, 30, 13, 0.18],
      [20, 26, 16, 10, 0.22],
      [44, 24, 18, 11, 0.22],
      [32, 18, 14, 9, 0.24],
      [14, 34, 12, 6, 0.2],
      [50, 34, 12, 6, 0.2],
      [28, 23, 8, 5, 0.22],
    ] as const) {
      disc(c, x, y, rx, ry, `rgba(236,240,248,${a})`);
      disc(c, x - rx * 0.2, y - ry * 0.25, rx * 0.6, ry * 0.5, `rgba(248,250,255,${a * 0.8})`);
    }
  });

  canvasTex(scene, 'hide_glyph', 32, 32, (c) => {
    const col = 'rgba(200,170,255,0.8)';
    const dim = 'rgba(200,170,255,0.35)';
    halo(c, 16, 16, 16, '#b08cff', 0.2);
    for (let i = 0; i < 120; i++) {
      const t = (i / 120) * Math.PI * 2;
      px(c, Math.round(16 + Math.cos(t) * 13), Math.round(16 + Math.sin(t) * 10), col);
      if (i % 2) px(c, Math.round(16 + Math.cos(t) * 9), Math.round(16 + Math.sin(t) * 7), dim);
    }
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      box(c, Math.round(16 + Math.cos(a) * 11) - 1, Math.round(16 + Math.sin(a) * 8.5) - 1, 2, 2, col);
    }
    seg(c, 16, 10, 20, 18, col);
    seg(c, 20, 18, 12, 18, col);
    seg(c, 12, 18, 16, 10, col);
    box(c, 15, 15, 2, 2, 'rgba(235,225,255,0.95)');
  });
}

export { drawProps, drawStructures, drawObjects, drawNodes, drawPortals };

/** World textures drawn as idle strips (frame 0 = the still look; art/dressing.ts stripTex, render/ambient.ts). */
export const WORLD_IDLE: Readonly<Record<string, IdleAnim>> = {
  // broad trees, willows and reeds may be mirrored (render/stage.ts): their strips carry the mirrored lean too
  ...Object.fromEntries(
    ['tree', 'tree~1', 'tree~2', 'darktree', 'darktree~1', 'darktree~2', 'duskwillow', 'reeds'].map((k) => [k, { frames: 2, kind: 'sway', mirror: 2 } as IdleAnim]),
  ),
  ...Object.fromEntries(['pine', 'pine~1', 'pine~2', 'frostpine', 'frostpine~1', 'frostpine~2'].map((k) => [k, { frames: 2, kind: 'sway' } as IdleAnim])),
  obj_campfire: { frames: 3, kind: 'flame' },
  obj_altar: { frames: 3, kind: 'flicker' },
  portal_door: { frames: 3, kind: 'flicker' },
};

/** Extra look variants per prop kind (same size and anchor as the base key); render/stage.ts picks one per tile. */
export const PROP_VARIANTS: Readonly<Record<string, readonly string[]>> = {
  tree: ['tree~1', 'tree~2'],
  darktree: ['darktree~1', 'darktree~2'],
  pine: ['pine~1', 'pine~2'],
  frostpine: ['frostpine~1', 'frostpine~2'],
  rock: ['rock~1', 'rock~2'],
  boulder: ['boulder~1', 'boulder~2'],
  bush: ['bush~1', 'bush~2'],
  tombstone: ['tombstone~1', 'tombstone~2'],
};

/**
 * Every world sprite EXCEPT the tile atlas: props (PropKind keys), struct_*, obj_*, node_*, portal_*, gate_*, hide_*,
 * bobber and the legacy aliases. Use this together with the terrain artist's art/tiles.ts drawTiles(). Idempotent.
 */
export function drawWorldSprites(scene: Phaser.Scene): void {
  drawProps(scene);
  drawStructures(scene);
  drawObjects(scene);
  drawNodes(scene);
  drawPortals(scene);
}

/** Draw every world texture: the tile atlases (art/tiles.ts — they must come first) and every world sprite. */
export function drawWorld(scene: Phaser.Scene): void {
  drawTiles(scene);
  drawWorldSprites(scene);
}
