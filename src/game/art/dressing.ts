import type Phaser from 'phaser';
import { type Ctx, rgba, scratch } from './common';
import { PAL, artRng, disc, keySeed, line as seg, outline, pixelTex, px } from './pixel';

// Ground dressing (docs/ART-DIRECTION.md §3 "Dressing"): small, non-blocking, purely visual decor scattered by
// src/game/render/dressing.ts. Every texture is keyed 'dr_<name>', anchored bottom-centre (origin 0.5, 1), drawn in
// true pixel art (integer pixels, top-left light, 1 px PAL.outline rim) with a small flat shadow where it is grounded.
// Flat decals (pebbles, ember cracks, bones, cobwebs) carry no shadow and are placed below every sprite.

type Ramp = readonly string[];
const OUT = PAL.outline;

const R = {
  grass: ['#2e4420', '#3f5a26', '#56772f', '#6c8f3a', '#86a64a', '#a2bd62'],
  leaf: ['#1f3519', '#2b4a22', '#3d6630', '#548540', '#74a655', '#a2c46a'],
  bark: ['#2e1d10', '#3d2817', '#5c3d22', '#7d5530', '#9c6d3e', '#b8874f'],
  crate: ['#3a2412', '#5a3a1e', '#7a5430', '#9a6e40', '#b88a54', '#d0a670'],
  stone: ['#33353c', '#4a4d55', '#666a73', '#878b93', '#a9adb3', '#cfd2d5'],
  warm: ['#3a342e', '#544c43', '#70665a', '#8f8475', '#aea290', '#ccc2ae'],
  iron: ['#24252b', '#3a3c44', '#565a64', '#7c818c', '#a8adb6'],
  gold: ['#6a4818', '#a0702c', '#d0a048', '#e9c46a', '#f8e6a8'],
  cream: ['#8a7a5a', '#b8a684', '#d6c8a4', '#efe6c8', '#fbf6e6'],
  bone: ['#6e6450', '#a09478', '#cfc4a6', '#ebe2c8', '#faf6e8'],
  crimson: ['#4a1418', '#7a1f26', '#b8323a', '#d85a58', '#f09080'],
  rose: ['#5a2030', '#94404e', '#c05a6a', '#e0788a', '#f4aab6'],
  violet: ['#2a1c4a', '#4a3480', '#6a4ea8', '#8a6cc0', '#b8a0e8', '#e4d8ff'],
  blue: ['#141c3a', '#1f2c58', '#2c4380', '#3f5fa6', '#6a8acc'],
  red: ['#3a1014', '#5e1a20', '#8a2a30', '#b8323a', '#d85a58'],
  ice: ['#2e5a78', '#4a86aa', '#7ab8d8', '#b4e0f2', '#e8f8ff', '#ffffff'],
  ember: ['#2a1410', '#5a2412', '#c8401a', '#f07a28', '#ffc04a', '#fff0a8'],
  dusk: ['#1d1730', '#2e2450', '#463a72', '#64549a', '#8a76c0', '#b4a4e2'],
  frost: ['#3a5a62', '#567a80', '#7a9ea2', '#a2c2c4', '#cce2e2', '#eef8f8'],
  glass: ['#6a4418', '#c0842e', '#eab456', '#f8da8a', '#fff4cc'],
  shroomRed: ['#4a1414', '#7a2420', '#a8382c', '#cc5a44', '#ec9070'],
  shroomBrown: ['#3a2414', '#5c3a20', '#7e5430', '#a07244', '#c49464'],
} as const;

const SHADOW = 'rgba(36,24,15,0.28)';

// ------------------------------------------------------------------ kit

function box(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  const x0 = Math.round(x);
  const y0 = Math.round(y);
  const ww = Math.round(x + w) - x0;
  const hh = Math.round(y + h) - y0;
  if (ww <= 0 || hh <= 0) return;
  c.fillStyle = color;
  c.fillRect(x0, y0, ww, hh);
}

/** Scanline polygon fill on pixel centres (no anti-aliasing). */
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

/** Body on a scratch canvas, 1 px outline, composite. */
function sprite(c: Ctx, w: number, h: number, draw: (b: Ctx) => void, color: string = OUT): void {
  const s = scratch(w, h);
  draw(s.c);
  outline(s.c, w, h, color);
  c.drawImage(s.el, 0, 0);
}

function shadow(c: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  disc(c, cx, cy, rx, ry, SHADOW);
}

function halo(c: Ctx, cx: number, cy: number, r: number, color: string, a = 0.3, steps = 3): void {
  for (let i = 0; i < steps; i++) {
    const rr = r * (1 - i / (steps + 0.5));
    disc(c, cx, cy, rr, rr * 0.92, rgba(color, a / steps));
  }
}

function tex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx, rnd: () => number) => void): void {
  pixelTex(scene, key, w, h, (c) => draw(c, artRng(keySeed(key))));
}

// ------------------------------------------------------------------ idle strips (docs/QUALITY-PLAN.md §12)

/** Transparent gap (px) between the frames of an idle strip. */
export const IDLE_GAP = 2;

/**
 * Idle animation strip: `n` frames of w x h side by side under ONE texture key, registered as frames 0..n-1. Frame 0
 * becomes the texture's default frame (Phaser's firstFrame), so `scene.add.image(x, y, key)` shows the still look
 * unchanged, and render/ambient.ts steps the others with setFrame(): the key, size and anchor never change and every
 * frame shares one GPU texture (no extra textures, no extra batches). Each frame is clipped to its own cell.
 */
export function stripTex(scene: Phaser.Scene, key: string, w: number, h: number, n: number, draw: (c: Ctx, frame: number) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, n * w + (n - 1) * IDLE_GAP, h);
  if (!tex) return;
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  for (let f = 0; f < n; f++) {
    c.save();
    c.translate(f * (w + IDLE_GAP), 0);
    c.beginPath();
    c.rect(0, 0, w, h);
    c.clip();
    draw(c, f);
    c.restore();
  }
  for (let f = 0; f < n; f++) tex.add(f, 0, f * (w + IDLE_GAP), 0, w, h);
  tex.refresh();
}

/** stripTex with the key's art RNG restarted per frame, so every frame makes the same random choices. */
function idleTex(scene: Phaser.Scene, key: string, w: number, h: number, n: number, draw: (c: Ctx, rnd: () => number, frame: number) => void): void {
  stripTex(scene, key, w, h, n, (c, f) => draw(c, artRng(keySeed(key)), f));
}

/** How an idle strip is stepped (render/ambient.ts): cloth waves, flames flicker, plants sway in the wind. */
export type IdleKind = 'wave' | 'flicker' | 'flame' | 'sway';
export interface IdleAnim {
  /** Frames the idle steps through (0 .. frames-1). */
  frames: number;
  kind: IdleKind;
  /**
   * Sway strips only: the strip frame shown INSTEAD of frame 1 on a mirrored (flipX) image — the same pose leaning
   * the other way in texture space, so on screen every plant leans downwind (east), mirrored or not.
   */
  mirror?: number;
}

/**
 * Sway strips hold 3 cells: 0 still, 1 leaning a pixel downwind (+x), 2 the same lean mirrored (-x) for flipped
 * images (IdleAnim.mirror). `swayLean(cell)` is the cell's x lean in px.
 */
export const SWAY_CELLS = 3;
export const swayLean = (cell: number): number => (cell === 2 ? -1 : cell);
const SWAY: IdleAnim = { frames: 2, kind: 'sway', mirror: 2 };

/** Dressing textures drawn as idle strips (frame 0 = the still look). */
export const DRESSING_IDLE: Readonly<Record<string, IdleAnim>> = {
  dr_banner_blue: { frames: 3, kind: 'wave' },
  dr_banner_red: { frames: 3, kind: 'wave' },
  dr_lantern: { frames: 3, kind: 'flicker' },
  dr_candles: { frames: 3, kind: 'flicker' },
  dr_tallgrass_a: SWAY,
  dr_tallgrass_b: SWAY,
  dr_tallgrass_dusk: SWAY,
  dr_tallgrass_frost: SWAY,
  dr_reeds: SWAY,
};

/** Gold four-point waystar — Omnipath's own emblem. */
function waystar(b: Ctx, cx: number, cy: number, s: number): void {
  fpoly(b, [cx, cy - s, cx + 1, cy - 1, cx + s, cy, cx + 1, cy + 1, cx, cy + s, cx - 1, cy + 1, cx - s, cy, cx - 1, cy - 1], R.gold[3]);
  fpoly(b, [cx, cy - s, cx + 1, cy - 1, cx + s, cy, cx, cy], R.gold[4]);
  px(b, cx, cy, R.gold[1]);
}

/** Slender pointed leaf from (x0,y0) to the tip (x1,y1), w px at its widest; lit upper edge, dark midrib. */
function blade(b: Ctx, x0: number, y0: number, x1: number, y1: number, w: number, ramp: Ramp, tone = 3): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  if (w <= 1) {
    seg(b, Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1), ramp[tone]);
    return;
  }
  fpoly(b, [x0 - nx * 0.6, y0 - ny * 0.6, x0 + dx * 0.4 + nx * w * 0.5, y0 + dy * 0.4 + ny * w * 0.5, x1, y1, x0 + dx * 0.4 - nx * w * 0.5, y0 + dy * 0.4 - ny * w * 0.5, x0 + nx * 0.6, y0 + ny * 0.6], ramp[tone]);
  seg(b, Math.round(x0), Math.round(y0), Math.round(x0 + dx * 0.75), Math.round(y0 + dy * 0.75), ramp[tone - 1]);
  px(b, Math.round(x0 + dx * 0.45 - nx), Math.round(y0 + dy * 0.45 - ny), ramp[Math.min(ramp.length - 1, tone + 1)]);
}

// ------------------------------------------------------------------ flowers

type BloomKind = 'star' | 'round' | 'daisy' | 'spike';

function bloom(b: Ctx, x: number, y: number, kind: BloomKind, ramp: Ramp, big: boolean): void {
  switch (kind) {
    case 'star': {
      // 5-petal star lily with a dark throat
      const r = big ? 3 : 2;
      for (let k = 0; k < 5; k++) {
        const a = -Math.PI / 2 + (k * Math.PI * 2) / 5;
        const tx = Math.round(x + Math.cos(a) * r);
        const ty = Math.round(y + Math.sin(a) * r * 0.9);
        seg(b, x, y, tx, ty, ramp[2]);
        px(b, tx, ty, k < 2 || k === 4 ? ramp[4] : ramp[3]);
      }
      if (big) {
        px(b, x - 1, y - 1, ramp[3]);
        px(b, x + 1, y - 1, ramp[3]);
        px(b, x + 1, y + 1, ramp[1]);
        px(b, x - 1, y + 1, ramp[2]);
      }
      px(b, x, y, ramp[0]);
      break;
    }
    case 'round': {
      // cupped rose: 3x3 (big 4x4) with a lit crown
      const s = big ? 4 : 3;
      const o = Math.floor(s / 2);
      box(b, x - o, y - o, s, s, ramp[2]);
      box(b, x - o + 1, y - o - 1, s - 2, 1, ramp[3]);
      box(b, x - o, y - o, s - 1, 1, ramp[4]);
      px(b, x - o, y - o + 1, ramp[3]);
      box(b, x - o + 1, y + s - o - 1, s - 1, 1, ramp[1]);
      px(b, x, y, ramp[1]);
      break;
    }
    case 'daisy': {
      // cross of petals around a gold heart
      const r = big ? 2 : 1;
      box(b, x - r, y, r * 2 + 1, 1, ramp[3]);
      box(b, x, y - r, 1, r * 2 + 1, ramp[3]);
      if (big) {
        px(b, x - 1, y - 1, ramp[4]);
        px(b, x + 1, y - 1, ramp[3]);
        px(b, x - 1, y + 1, ramp[2]);
        px(b, x + 1, y + 1, ramp[2]);
      }
      px(b, x - r, y, ramp[4]);
      px(b, x, y - r, ramp[4]);
      px(b, x + r, y, ramp[2]);
      px(b, x, y + r, ramp[1]);
      px(b, x, y, R.gold[3]);
      break;
    }
    case 'spike': {
      // little lavender spike: stacked florets
      const h = big ? 6 : 4;
      for (let i = 0; i < h; i++) {
        const w = i === 0 || i === h - 1 ? 1 : 2;
        box(b, x - (w === 2 ? 1 : 0), y - h + 1 + i, w, 1, i % 2 ? ramp[2] : ramp[3]);
      }
      px(b, x, y - h + 1, ramp[4]);
      px(b, x, y, ramp[1]);
      break;
    }
  }
}

interface FlowerSpec {
  kind: BloomKind;
  ramp: Ramp;
}

const FLOWERS: Record<'crimson' | 'rose' | 'cream' | 'violet', FlowerSpec> = {
  crimson: { kind: 'star', ramp: R.crimson },
  rose: { kind: 'round', ramp: R.rose },
  cream: { kind: 'daisy', ramp: R.cream },
  violet: { kind: 'spike', ramp: R.violet },
};

/** Size presets: canvas, number of blooms, number of leaves, leaf length. */
const FLOWER_SIZES = {
  s: { w: 14, h: 14, blooms: 3, leaves: 3, leaf: 6 },
  m: { w: 22, h: 21, blooms: 6, leaves: 6, leaf: 10 },
  l: { w: 32, h: 30, blooms: 10, leaves: 9, leaf: 15 },
} as const;

function flowerClump(scene: Phaser.Scene, color: keyof typeof FLOWERS, size: keyof typeof FLOWER_SIZES): void {
  const key = `dr_flower_${color}_${size}`;
  const S = FLOWER_SIZES[size];
  const F = FLOWERS[color];
  tex(scene, key, S.w, S.h, (c, rnd) => {
    const cx = S.w / 2;
    const base = S.h - 2;
    // bloom spots first (kept apart so each bloom reads on its own), highest blooms at the back
    const pts: [number, number][] = [];
    const gap = F.kind === 'spike' ? 3 : size === 's' ? 4 : 5;
    const pad = F.kind === 'spike' ? 2 : size === 's' ? 2 : 3;
    for (let i = 0; i < S.blooms; i++) {
      const t = i / (S.blooms - 1);
      for (let tries = 0; tries < 24; tries++) {
        const x = Math.max(pad, Math.min(S.w - 1 - pad, Math.round(3 + t * (S.w - 6) + (rnd() - 0.5) * (2 + tries * 0.4))));
        const y = Math.max(pad + 1, Math.round(3 + rnd() * (S.h * 0.45) + Math.abs(t - 0.5) * S.h * 0.25));
        const yy = Math.min(base - 4, y + (F.kind === 'spike' ? 3 : 0));
        if (tries < 23 && pts.some(([px0, py0]) => Math.abs(px0 - x) < gap && Math.abs(py0 - yy) < gap)) continue;
        pts.push([x, yy]);
        break;
      }
    }
    pts.sort((p, q) => p[1] - q[1]);
    shadow(c, cx, base + 0.5, S.w * 0.36, 1.6);
    // 1) outlined leaf fan
    sprite(c, S.w, S.h, (b) => {
      for (let i = 0; i < S.leaves; i++) {
        const t = i / (S.leaves - 1);
        const ang = -Math.PI / 2 + (t - 0.5) * 2.3 + (rnd() - 0.5) * 0.25;
        const len = S.leaf * (0.7 + rnd() * 0.4) * (1 - Math.abs(t - 0.5) * 0.5);
        const x1 = cx + Math.cos(ang) * len;
        const y1 = base + Math.sin(ang) * len * 0.85;
        blade(b, cx + (t - 0.5) * 3, base, x1, y1, size === 's' ? 2 : 3, R.leaf, t < 0.5 ? 4 : 3);
      }
    });
    // 2) thin stems, un-outlined so the clump stays airy
    for (const [x, y] of pts) seg(c, Math.round(cx + (x - cx) * 0.3), base - 2, x, y + 1, R.leaf[2]);
    // 3) outlined blooms on top
    sprite(c, S.w, S.h, (b) => {
      for (const [x, y] of pts) bloom(b, x, y, F.kind, F.ramp, size !== 's');
    });
  });
}

// ------------------------------------------------------------------ plants

function mushrooms(scene: Phaser.Scene, key: string, cap: Ramp): void {
  tex(scene, key, 20, 15, (c) => {
    shadow(c, 10, 13, 8, 1.6);
    sprite(c, 20, 15, (b) => {
      const one = (x: number, y: number, rx: number, ry: number, stemH: number, spots: boolean) => {
        box(b, x - 1, y, 3, stemH, R.cream[3]);
        px(b, x + 1, y + 1, R.cream[1]);
        for (let yy = -ry; yy <= 0; yy++) {
          const half = Math.round(rx * Math.sqrt(1 - (yy / (ry + 0.5)) ** 2));
          box(b, x - half, y + yy, half * 2 + 1, 1, cap[2]);
          box(b, x + half - Math.max(0, Math.round(half * 0.4)), y + yy, Math.max(1, Math.round(half * 0.4)), 1, cap[1]);
          if (yy < 0) px(b, x - half + 1, y + yy, cap[3]);
        }
        box(b, x - rx + 1, y + 1, rx * 2 - 1, 1, cap[0]);
        px(b, x - Math.round(rx * 0.4), y - ry + 1, cap[4]);
        if (spots) {
          px(b, x + 1, y - ry + 1, R.cream[4]);
          px(b, x - rx + 1, y - 1, R.cream[3]);
        }
      };
      one(12, 8, 4, 3, 5, true);
      one(6, 10, 3, 2, 3, true);
      one(16, 11, 2, 1, 2, false);
    });
  });
}

function tallGrass(scene: Phaser.Scene, key: string, ramp: Ramp, wide: boolean, tips?: string): void {
  // 'a' = upright tuft; wide = a big arching fern-like clump. Sway cells 1 / 2: the same blades with their tips blown a
  // pixel or two downwind / the mirrored way (the longest blades bend most).
  const w = wide ? 30 : 18;
  const h = wide ? 26 : 19;
  idleTex(scene, key, w, h, SWAY_CELLS, (c, rnd, f) => {
    const wind = swayLean(f) * 1.6;
    const cx = w / 2;
    const base = h - 2;
    shadow(c, cx, base + 0.5, w * 0.36, 1.6);
    sprite(c, w, h, (b) => {
      const n = wide ? 11 : 7;
      // back blades first (darker), front blades last (lighter)
      const order = Array.from({ length: n }, (_, i) => i).sort((a, z) => Math.abs(z - (n - 1) / 2) - Math.abs(a - (n - 1) / 2));
      for (const i of order) {
        const t = i / (n - 1);
        const x0 = cx + (t - 0.5) * (wide ? 10 : 6);
        const lean = (t - 0.5) * (wide ? 22 : 11) + (rnd() - 0.5) * 3;
        const len = (wide ? 19 : 14) * (0.62 + rnd() * 0.38) * (1 - Math.abs(t - 0.5) * 0.55);
        const x1 = x0 + lean + wind * (len / (wide ? 19 : 14));
        const y1 = base - len + (wide ? Math.abs(t - 0.5) * 8 : 0);
        const front = Math.abs(t - 0.5) < 0.2;
        const tone = front ? 4 : t < 0.5 ? 3 : 2;
        blade(b, x0, base, x1, y1, wide ? 3 : 2, ramp, tone);
        if (tips && i % 3 === 1) px(b, Math.round(x1), Math.round(y1), tips);
      }
      box(b, Math.round(cx - 3), base - 1, 6, 2, ramp[1]);
    });
  });
}

// ------------------------------------------------------------------ props in miniature

function rockLump(b: Ctx, x: number, y: number, w: number, h: number, ramp: Ramp): void {
  // y = bottom
  fpoly(b, [x, y, x + 1, y - h + 2, x + 3, y - h, x + w - 3, y - h, x + w, y - h + 3, x + w, y], ramp[2]);
  fpoly(b, [x + 1, y - h + 2, x + 3, y - h, x + w - 3, y - h, x + w, y - h + 3, x + Math.round(w * 0.55), y - Math.round(h * 0.45), x + 1, y - Math.round(h * 0.4)], ramp[4]);
  box(b, x + 3, y - h, Math.max(1, w - 6), 1, ramp[5] ?? ramp[4]);
  box(b, x + Math.round(w * 0.6), y - Math.round(h * 0.5), Math.max(1, w - Math.round(w * 0.6)), Math.round(h * 0.5), ramp[1]);
  box(b, x, y - 1, w, 1, ramp[0]);
}

function drawGroundBits(scene: Phaser.Scene): void {
  tex(scene, 'dr_pebbles', 16, 9, (c) =>
    sprite(
      c,
      16,
      9,
      (b) => {
        rockLump(b, 1, 7, 5, 4, R.warm);
        rockLump(b, 7, 8, 4, 3, R.stone);
        rockLump(b, 11, 6, 4, 3, R.warm);
      },
      'rgba(36,24,15,0.55)',
    ),
  );
  tex(scene, 'dr_stone', 16, 12, (c) => {
    shadow(c, 8, 10.5, 7, 1.5);
    sprite(c, 16, 12, (b) => {
      rockLump(b, 2, 10, 12, 8, R.stone);
      box(b, 4, 4, 3, 1, R.leaf[3]);
      px(b, 5, 3, R.leaf[4]);
    });
  });
  tex(scene, 'dr_rubble', 22, 13, (c) => {
    shadow(c, 11, 11.5, 9, 1.5);
    sprite(c, 22, 13, (b) => {
      rockLump(b, 1, 11, 7, 6, R.warm);
      rockLump(b, 12, 11, 8, 7, R.warm);
      rockLump(b, 7, 12, 6, 5, R.stone);
      box(b, 4, 11, 2, 1, R.warm[3]);
      box(b, 18, 11, 2, 1, R.warm[2]);
    });
  });
  tex(scene, 'dr_stump', 22, 19, (c) => {
    shadow(c, 11, 17, 10, 2);
    sprite(c, 22, 19, (b) => {
      const B = R.bark;
      fpoly(b, [3, 17, 5, 13, 5, 6, 17, 6, 17, 13, 19, 17], B[3]);
      box(b, 5, 6, 3, 10, B[4]);
      box(b, 14, 6, 3, 10, B[2]);
      box(b, 16, 7, 1, 9, B[1]);
      for (const x of [8, 11]) box(b, x, 9, 1, 5, B[2]);
      fpoly(b, [2, 18, 5, 14, 6, 18], B[2]);
      fpoly(b, [20, 18, 17, 14, 16, 18], B[1]);
      // cut top with rings
      disc(b, 11, 6, 6, 2.6, R.cream[2]);
      disc(b, 11, 6, 4, 1.6, R.cream[1]);
      disc(b, 11, 6, 2, 1, R.cream[2]);
      box(b, 7, 4, 5, 1, R.cream[3]);
      px(b, 11, 6, B[2]);
      box(b, 5, 7, 12, 1, B[2]);
    });
  });
  tex(scene, 'dr_log', 34, 15, (c) => {
    shadow(c, 17, 13, 16, 2);
    sprite(c, 34, 15, (b) => {
      const B = R.bark;
      box(b, 6, 4, 26, 9, B[3]);
      box(b, 6, 4, 26, 2, B[4]);
      box(b, 6, 11, 26, 2, B[1]);
      for (let x = 9; x < 30; x += 5) box(b, x, 7, 3, 1, B[2]);
      box(b, 14, 9, 4, 1, B[2]);
      box(b, 25, 5, 4, 1, B[5]);
      // broken branch nub + moss
      box(b, 20, 1, 3, 4, B[3]);
      px(b, 20, 1, B[4]);
      box(b, 9, 3, 6, 1, R.leaf[3]);
      box(b, 10, 2, 3, 1, R.leaf[4]);
      // end grain at the left
      disc(b, 5.5, 8, 4.5, 4.5, R.cream[2]);
      disc(b, 5.5, 8, 3, 3, R.cream[1]);
      disc(b, 5.5, 8, 1.5, 1.5, R.cream[2]);
      px(b, 4, 5, R.cream[3]);
      px(b, 32, 8, B[2]);
    });
  });
  tex(scene, 'dr_bones', 20, 10, (c) =>
    sprite(c, 20, 10, (b) => {
      const B = R.bone;
      // long bone
      box(b, 3, 6, 11, 2, B[3]);
      box(b, 3, 7, 11, 1, B[2]);
      box(b, 1, 5, 3, 4, B[3]);
      box(b, 13, 5, 3, 4, B[2]);
      px(b, 1, 5, B[4]);
      // skull
      disc(b, 15, 4, 3.5, 3, B[3]);
      box(b, 13, 2, 3, 1, B[4]);
      box(b, 13, 4, 2, 2, B[0]);
      box(b, 16, 4, 2, 2, B[0]);
      box(b, 14, 7, 3, 1, B[1]);
      // rib
      seg(b, 5, 3, 9, 2, B[2]);
    }),
  );
  tex(scene, 'dr_cobweb', 20, 20, (c) => {
    // corner web, anchored on the top-left corner (flipX for the other side); translucent, no outline
    const col = 'rgba(232,232,240,0.55)';
    const dim = 'rgba(232,232,240,0.3)';
    for (const [x1, y1] of [
      [19, 1],
      [17, 9],
      [12, 14],
      [6, 18],
      [1, 19],
    ])
      seg(c, 0, 0, x1, y1, col);
    for (const r of [5, 10, 15]) {
      let prev: [number, number] | null = null;
      for (let k = 0; k <= 8; k++) {
        const a = (k / 8) * (Math.PI / 2);
        const p: [number, number] = [Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r)];
        if (prev) seg(c, prev[0], prev[1], p[0], p[1], r === 10 ? col : dim);
        prev = p;
      }
    }
    px(c, 7, 6, 'rgba(255,255,255,0.8)');
  });
  tex(scene, 'dr_ember_crack', 26, 12, (c) => {
    const E = R.ember;
    const crack = (pts: number[]) => {
      for (let i = 0; i + 3 < pts.length; i += 2) {
        seg(c, pts[i], pts[i + 1] + 1, pts[i + 2], pts[i + 3] + 1, E[0]);
        seg(c, pts[i], pts[i + 1], pts[i + 2], pts[i + 3], E[3]);
      }
    };
    disc(c, 13, 6, 12, 5, 'rgba(240,122,40,0.12)');
    crack([1, 7, 6, 5, 10, 7, 15, 4, 20, 6, 25, 3]);
    crack([10, 7, 12, 10]);
    crack([15, 4, 17, 1]);
    px(c, 10, 7, E[5]);
    px(c, 15, 4, E[4]);
    px(c, 20, 6, E[4]);
  });
}

// ------------------------------------------------------------------ camp & town furniture

function crateBody(b: Ctx, x: number, y: number, s: number): void {
  // y = bottom; s = side. Top face (lit) + front face with a frame and a diagonal brace.
  const C = R.crate;
  const top = Math.round(s * 0.35);
  const fy = y - s;
  box(b, x, fy - top, s, top, C[4]);
  box(b, x, fy - top, s, 1, C[5]);
  for (let xx = x + 3; xx < x + s - 1; xx += 4) box(b, xx, fy - top + 1, 1, top - 1, C[3]);
  box(b, x, fy, s, s, C[3]);
  box(b, x, fy, s, 2, C[2]);
  box(b, x, y - 2, s, 2, C[2]);
  box(b, x, fy, 2, s, C[4]);
  box(b, x + s - 2, fy, 2, s, C[1]);
  seg(b, x + 2, y - 3, x + s - 3, fy + 2, C[2]);
  seg(b, x + 2, y - 4, x + s - 4, fy + 2, C[4]);
  box(b, x + 2, fy + Math.round(s / 2), s - 4, 1, C[2]);
  px(b, x + 1, fy + 1, R.iron[3]);
  px(b, x + s - 2, fy + 1, R.iron[2]);
  px(b, x + 1, y - 2, R.iron[2]);
}

function barrelBody(b: Ctx, x: number, y: number, w: number, h: number): void {
  const C = R.crate;
  for (let yy = y - h; yy < y; yy++) {
    const t = (yy - (y - h)) / h;
    const bulge = Math.round(Math.sin(t * Math.PI) * 1.5);
    box(b, x - bulge, yy, w + bulge * 2, 1, C[3]);
    box(b, x - bulge, yy, 2, 1, C[4]);
    box(b, x + w + bulge - 3, yy, 3, 1, C[1]);
  }
  for (let xx = x + 3; xx < x + w - 2; xx += 3) box(b, xx, y - h + 2, 1, h - 3, C[2]);
  for (const f of [0.22, 0.75]) {
    const yy = Math.round(y - h + h * f);
    box(b, x - 1, yy, w + 2, 2, R.iron[2]);
    box(b, x - 1, yy, w + 2, 1, R.iron[3]);
  }
  // lid
  disc(b, x + w / 2, y - h, w / 2, 2, C[4]);
  disc(b, x + w / 2, y - h + 0.5, w / 2 - 2, 1, C[2]);
  box(b, x + 2, y - h - 1, w - 5, 1, C[5]);
}

/**
 * Banner wave (whole px, within the 14 px canvas so the outline always fits): the cloth's rows shift sideways by
 * -1..1. Frame 0 still, 1 the lower half blown out, 2 a bulge mid-way down (stepped 0 → 2 → 1: the wave runs down).
 */
export function clothShift(frame: number, u: number): number {
  if (frame === 1) return u > 0.5 ? 1 : 0;
  if (frame === 2) return u > 0.22 && u < 0.72 ? 1 : 0;
  return 0;
}

function bannerBody(b: Ctx, cloth: Ramp, h: number, frame = 0): void {
  // pole with a finial, crossbar, swallow-tailed cloth with the waystar
  box(b, 6, 3, 2, h - 3, R.bark[3]);
  px(b, 6, 3, R.bark[5]);
  box(b, 7, 3, 1, h - 3, R.bark[2]);
  box(b, 5, 0, 4, 3, R.gold[3]);
  px(b, 5, 0, R.gold[4]);
  px(b, 8, 2, R.gold[1]);
  box(b, 1, 5, 12, 2, R.bark[3]);
  box(b, 1, 5, 12, 1, R.bark[4]);
  const top = 7;
  const bot = top + Math.round(h * 0.55);
  // the cloth on its own layer, laid over the pole row by row with the frame's wave shift
  const cl = scratch(14, h);
  const k = cl.c;
  fpoly(k, [2, top, 12, top, 12, bot, 7, bot - 4, 2, bot], cloth[2]);
  box(k, 2, top, 2, bot - top - 1, cloth[3]);
  box(k, 10, top, 2, bot - top - 2, cloth[1]);
  box(k, 2, top, 10, 1, R.gold[2]);
  box(k, 3, bot - 4, 1, 3, R.gold[2]);
  box(k, 10, bot - 4, 1, 3, R.gold[2]);
  waystar(k, 7, Math.round(top + (bot - top) * 0.42), 3);
  for (let y = top; y <= bot; y++) b.drawImage(cl.el, 0, y, 14, 1, clothShift(frame, (y - top) / (bot - top)), y, 14, 1);
  // base stones
  box(b, 3, h - 3, 8, 3, R.stone[2]);
  box(b, 3, h - 3, 8, 1, R.stone[4]);
}

function drawFurniture(scene: Phaser.Scene): void {
  tex(scene, 'dr_crate', 18, 20, (c) => {
    shadow(c, 9, 18, 9, 2);
    sprite(c, 18, 20, (b) => crateBody(b, 1, 19, 15));
  });
  tex(scene, 'dr_crates', 30, 32, (c) => {
    shadow(c, 15, 30, 15, 2.5);
    sprite(c, 30, 32, (b) => {
      crateBody(b, 1, 31, 14);
      crateBody(b, 15, 31, 14);
      crateBody(b, 7, 17, 13);
    });
  });
  tex(scene, 'dr_barrel', 16, 20, (c) => {
    shadow(c, 8, 18, 7.5, 2);
    sprite(c, 16, 20, (b) => barrelBody(b, 3, 19, 10, 15));
  });
  idleTex(scene, 'dr_banner_blue', 14, 40, 3, (c, _r, f) => {
    shadow(c, 7, 38.5, 6, 1.5);
    sprite(c, 14, 40, (b) => bannerBody(b, R.blue, 39, f));
  });
  idleTex(scene, 'dr_banner_red', 14, 40, 3, (c, _r, f) => {
    shadow(c, 7, 38.5, 6, 1.5);
    sprite(c, 14, 40, (b) => bannerBody(b, R.red, 39, f));
  });
  // flicker: 0 the still look, 1 a brighter flare (hot core, wider halo), 2 a dip (the flame sinks a pixel)
  idleTex(scene, 'dr_lantern', 16, 40, 3, (c, _r, f) => {
    shadow(c, 7, 38.5, 5, 1.5);
    halo(c, 11, 12, [9, 10, 8][f], '#ffcf6a', [0.4, 0.46, 0.32][f]);
    sprite(c, 16, 40, (b) => {
      box(b, 5, 6, 3, 33, R.bark[3]);
      box(b, 5, 6, 1, 33, R.bark[4]);
      box(b, 7, 6, 1, 33, R.bark[1]);
      box(b, 5, 5, 9, 2, R.bark[3]);
      box(b, 5, 5, 9, 1, R.bark[4]);
      px(b, 12, 7, R.iron[2]);
      // lantern
      box(b, 9, 8, 5, 1, R.iron[1]);
      box(b, 9, 9, 5, 6, R.glass[3]);
      if (f === 2) box(b, 10, 11, 3, 3, R.glass[4]);
      else box(b, 10, 10, 3, 4, R.glass[4]);
      box(b, 11, 9, 1, 6, R.iron[2]);
      if (f === 1) {
        px(b, 10, 12, '#fffbe8');
        px(b, 12, 12, '#fffbe8');
      }
      box(b, 9, 15, 5, 1, R.iron[1]);
      box(b, 3, 36, 7, 3, R.stone[2]);
      box(b, 3, 36, 7, 1, R.stone[4]);
    });
  });
  idleTex(scene, 'dr_candles', 14, 16, 3, (c, _r, f) => {
    halo(c, 7, 7, 7, '#ffcf6a', [0.4, 0.44, 0.36][f]);
    sprite(c, 14, 16, (b) => {
      disc(b, 7, 14, 6, 1.6, R.cream[2]);
      const candle = (x: number, h: number) => {
        box(b, x - 1, 14 - h, 3, h, R.cream[3]);
        px(b, x - 1, 14 - h, R.cream[4]);
        box(b, x + 1, 15 - h, 1, h - 1, R.cream[1]);
      };
      candle(4, 6);
      candle(8, 9);
      candle(11, 4);
    });
    // flames (frame 0 the still look; 1 and 2 stretch one flame a pixel and lean another's tip downwind)
    [
      [4, 6],
      [8, 9],
      [11, 4],
    ].forEach(([x, h], k) => {
      const tall = f && (k + f) % 3 === 0 ? 1 : 0;
      const lean = f && (k + 2 * f) % 3 === 1 ? 1 : 0;
      box(c, x, 14 - h - 3 - tall, 1, 2 + tall, R.ember[4]);
      px(c, x, 14 - h - 1, R.ember[5]);
      px(c, x + lean, 14 - h - 4 - tall, R.ember[3]);
    });
  });
}

// ------------------------------------------------------------------ fences (our rustic split-rail with rope ties)

function post(b: Ctx, x: number, foot: number, h: number): void {
  const B = R.bark;
  box(b, x, foot - h, 4, h, B[3]);
  box(b, x, foot - h, 1, h, B[4]);
  box(b, x + 3, foot - h, 1, h, B[1]);
  // split-log cap, angled cut
  box(b, x, foot - h - 1, 3, 1, B[4]);
  px(b, x + 3, foot - h, B[2]);
  box(b, x + 1, foot - h - 1, 2, 1, R.cream[2]);
  px(b, x + 1, foot - 3, B[2]);
}

function rail(b: Ctx, x0: number, x1: number, y: number): void {
  const B = R.bark;
  box(b, x0, y, x1 - x0, 3, B[3]);
  box(b, x0, y, x1 - x0, 1, B[4]);
  box(b, x0, y + 2, x1 - x0, 1, B[1]);
  for (let x = x0 + 5; x < x1 - 2; x += 9) px(b, x, y + 1, B[2]);
}

function rope(b: Ctx, x: number, y: number): void {
  box(b, x, y - 1, 4, 1, R.cream[1]);
  box(b, x, y + 1, 4, 1, R.cream[2]);
  px(b, x + 1, y, R.cream[3]);
}

function drawFences(scene: Phaser.Scene): void {
  const H = 24;
  const foot = H - 2;
  // Horizontal segment: one tile wide; posts at x 0 and 16, rails run edge to edge so segments chain seamlessly.
  // The right end of a run is closed with dr_fence_post placed at the next tile's left edge.
  tex(scene, 'dr_fence_h', 32, H, (c) => {
    for (const x of [2, 18]) disc(c, x + 2, foot, 4, 1.2, SHADOW);
    box(c, 0, foot, 32, 1, 'rgba(36,24,15,0.16)');
    sprite(c, 32, H, (b) => {
      rail(b, 0, 32, foot - 15);
      rail(b, 0, 32, foot - 8);
      for (const x of [0, 16]) {
        post(b, x, foot, 18);
        rope(b, x, foot - 14);
        rope(b, x, foot - 7);
      }
    });
  });
  // Vertical segment (a run going north-south seen from the 3/4 view): stacked posts joined by the rails seen edge-on.
  // Vertical segment: a run going north-south in the 3/4 view. Two short chunky posts per tile (every 16 px) give the
  // run a clear rhythm; the rails seen edge-on are a thin strip climbing to the next post. A run is capped at its
  // north end by dr_fence_v_end.
  const vpost = (b: Ctx, foot: number) => {
    const B = R.bark;
    box(b, 2, foot - 10, 8, 10, B[3]);
    box(b, 2, foot - 10, 2, 10, B[4]);
    box(b, 8, foot - 10, 2, 10, B[2]);
    box(b, 9, foot - 10, 1, 10, B[1]);
    box(b, 2, foot - 13, 8, 3, R.cream[1]);
    box(b, 3, foot - 13, 6, 2, R.cream[2]);
    px(b, 4, foot - 13, R.cream[3]);
    box(b, 2, foot - 7, 8, 1, R.cream[1]);
    box(b, 2, foot - 6, 8, 1, R.cream[3]);
    px(b, 4, foot - 3, B[2]);
  };
  tex(scene, 'dr_fence_v', 12, 52, (c) => {
    const vf = 51;
    const B = R.bark;
    for (const f of [vf, vf - 16]) disc(c, 6, f, 5, 1.5, SHADOW);
    sprite(c, 12, 52, (b) => {
      box(b, 5, 9, 2, vf - 13, B[3]);
      px(b, 5, 9, B[5]);
      box(b, 6, 10, 1, vf - 14, B[1]);
      vpost(b, vf - 16);
      vpost(b, vf);
    });
  });
  tex(scene, 'dr_fence_v_end', 12, 16, (c) => {
    disc(c, 6, 15, 5, 1.5, SHADOW);
    sprite(c, 12, 16, (b) => vpost(b, 15));
  });
  tex(scene, 'dr_fence_post', 8, H, (c) => {
    disc(c, 4, foot, 4, 1.2, SHADOW);
    sprite(c, 8, H, (b) => post(b, 2, foot, 18));
  });
}

// ------------------------------------------------------------------ biome accents

function drawAccents(scene: Phaser.Scene): void {
  // sway cells 1 / 2: blade tips and the cattail heads a pixel downwind / the mirrored way
  idleTex(scene, 'dr_reeds', 16, 22, SWAY_CELLS, (c, _r, cell) => {
    const f = swayLean(cell);
    shadow(c, 8, 20.5, 6, 1.4);
    sprite(c, 16, 22, (b) => {
      for (const [x0, lean, len, tone] of [
        [5, -4, 12, 4],
        [7, -1, 15, 3],
        [9, 2, 13, 3],
        [11, 5, 10, 2],
        [8, 0, 9, 4],
      ] as const)
        blade(b, x0, 20, x0 + lean + (len > 10 ? f : 0), 20 - len, 2, R.grass, tone);
      for (const [x, top] of [
        [6, 3],
        [10, 5],
      ]) {
        if (f) seg(b, x, 19, x + f, top + 5, R.grass[2]);
        else box(b, x, top + 5, 1, 20 - top - 5, R.grass[2]);
        box(b, x - 1 + f, top, 3, 5, R.bark[2]);
        box(b, x - 1 + f, top, 1, 5, R.bark[4]);
        px(b, x + f, top - 1, R.grass[4]);
      }
    });
  });
  tex(scene, 'dr_ice_shards', 18, 18, (c) => {
    shadow(c, 9, 16.5, 7, 1.4);
    disc(c, 9, 10, 8, 7, 'rgba(200,240,255,0.12)');
    sprite(c, 18, 18, (b) => {
      const I = R.ice;
      const shard = (x: number, base: number, top: number, w: number, lean: number) => {
        fpoly(b, [x - w, base, x - w + lean, top + w, x + lean, top, x, base], I[3]);
        fpoly(b, [x, base, x + lean, top, x + w + lean, top + w, x + w, base], I[1]);
        seg(b, Math.round(x - w + 1), base - 1, Math.round(x - w + 1 + lean), top + w + 1, I[4]);
        px(b, Math.round(x + lean), top + 1, I[5]);
      };
      shard(5, 16, 7, 2, -2);
      shard(12, 16, 6, 2, 2);
      shard(9, 16, 1, 3, 0);
      box(b, 2, 16, 14, 1, I[2]);
    });
  });
  tex(scene, 'dr_spores', 16, 16, (c) => {
    halo(c, 8, 9, 8, '#b08cff', 0.38);
    sprite(c, 16, 16, (b) => {
      for (const [x, h, col] of [
        [4, 7, 0],
        [8, 11, 1],
        [12, 6, 0],
        [6, 4, 1],
      ] as const) {
        box(b, x, 15 - h, 1, h, R.dusk[2]);
        const cap = col ? R.violet : R.ice;
        box(b, x - 1, 15 - h - 2, 3, 2, cap[3]);
        px(b, x - 1, 15 - h - 2, cap[4]);
        px(b, x, 15 - h - 3, cap[4]);
      }
    });
    for (const [x, y] of [
      [2, 3],
      [13, 2],
      [10, 6],
    ])
      px(c, x, y, 'rgba(220,200,255,0.9)');
  });
  tex(scene, 'dr_dusk_blossom', 20, 20, (c, rnd) => {
    shadow(c, 10, 18.5, 7, 1.4);
    halo(c, 10, 8, 9, '#ffb0e8', 0.3);
    sprite(c, 20, 20, (b) => {
      for (let i = 0; i < 6; i++) {
        const t = i / 5;
        const ang = -Math.PI / 2 + (t - 0.5) * 2.2;
        blade(b, 10, 18, 10 + Math.cos(ang) * 9, 18 + Math.sin(ang) * 8, 3, R.dusk, t < 0.5 ? 4 : 3);
      }
      for (const [x, y] of [
        [5, 7],
        [10, 3],
        [15, 6],
        [8, 10],
        [13, 11],
      ]) {
        seg(b, 10, 16, x, y + 1, R.dusk[2]);
        box(b, x - 1, y - 1, 3, 3, rnd() < 0.5 ? '#e890d0' : '#c070c8');
        px(b, x - 1, y - 1, '#ffd0f0');
        px(b, x, y, '#fff0fa');
      }
    });
  });
}

/** Every dressing key drawn by drawDressing (for contact sheets and preload checks). */
export const DRESSING_KEYS: readonly string[] = [
  ...(['crimson', 'rose', 'cream', 'violet'] as const).flatMap((col) => (['s', 'm', 'l'] as const).map((s) => `dr_flower_${col}_${s}`)),
  'dr_mushrooms_red',
  'dr_mushrooms_brown',
  'dr_tallgrass_a',
  'dr_tallgrass_b',
  'dr_tallgrass_dusk',
  'dr_tallgrass_frost',
  'dr_pebbles',
  'dr_stone',
  'dr_rubble',
  'dr_stump',
  'dr_log',
  'dr_bones',
  'dr_cobweb',
  'dr_ember_crack',
  'dr_crate',
  'dr_crates',
  'dr_barrel',
  'dr_banner_blue',
  'dr_banner_red',
  'dr_lantern',
  'dr_candles',
  'dr_fence_h',
  'dr_fence_v',
  'dr_fence_post',
  'dr_fence_v_end',
  'dr_reeds',
  'dr_ice_shards',
  'dr_spores',
  'dr_dusk_blossom',
];

/** Generate every 'dr_*' dressing texture (idempotent per key). Call once at boot, after or alongside drawWorld. */
export function drawDressing(scene: Phaser.Scene): void {
  for (const col of ['crimson', 'rose', 'cream', 'violet'] as const) for (const s of ['s', 'm', 'l'] as const) flowerClump(scene, col, s);
  mushrooms(scene, 'dr_mushrooms_red', R.shroomRed);
  mushrooms(scene, 'dr_mushrooms_brown', R.shroomBrown);
  tallGrass(scene, 'dr_tallgrass_a', R.grass, false);
  tallGrass(scene, 'dr_tallgrass_b', R.grass, true, '#c2b18a');
  tallGrass(scene, 'dr_tallgrass_dusk', R.dusk, true, '#f0b0e0');
  tallGrass(scene, 'dr_tallgrass_frost', R.frost, false, '#ffffff');
  drawGroundBits(scene);
  drawFurniture(scene);
  drawFences(scene);
  drawAccents(scene);
}

// ------------------------------------------------------------------ ambient particles (render/ambient.ts)
// The living world's small moving pixels (docs/QUALITY-PLAN.md §12), all in ONE texture so every particle layer is a
// single Blitter on one GPU texture. Matter (leaves, petals) gets the 1 px PAL.outline rim; light, water and smoke
// (snow, rain, embers, fireflies, spores, dust, puffs) do not (docs/VFX.md P7). Every pixel is fully opaque: fades
// are dithered frames, never alpha. Cloud shadows are a second texture (big, flat, soft-edged by 1 px noise).

/** Particle atlas key (frames named below: leaf_<set>_<0..3|fade>, snow_<0..2>, rain_<0..1>, puddle_<0..3>, …). */
export const AMB_FX = 'amb_fx';
/** Cloud-shadow atlas key (frames cloud_0..CLOUD_SHAPES-1). */
export const AMB_CLOUD = 'amb_cloud';

/** Leaf / petal colour sets [light, mid, dark]. */
export const LEAF_SETS = {
  green: ['#a2c46a', '#74a655', '#3d6630'],
  autumn: ['#f0c868', '#d08a30', '#8a4a1e'],
  grove: ['#7aa486', '#3f6a5a', '#203a34'],
  petal: ['#ffd8f2', '#e890d0', '#9a5aa8'],
} as const;
export type LeafSet = keyof typeof LEAF_SETS;
/** Flutter frames per leaf (flat, tilted, edge-on, tilted back) + a dithered 'fade' frame. */
export const LEAF_FRAMES = 4;
const LEAF_BODIES: readonly (readonly string[])[] = [
  ['.ab.', 'abbc', '.cc.'],
  ['..ab', '.abc', 'abc.', 'bc..'],
  ['abbc'],
  ['ab..', 'bbc.', '.bbc', '..cc'],
];

/** Glow-particle palettes [dim, bright, plus-core, plus-arm]. */
export const SPORE_SETS = {
  gloom: ['#3a8a7a', '#7ae0c8', '#d8fff4', '#5ab8a8'],
  dusk: ['#5a4490', '#b8a0e8', '#f4e8ff', '#8a6cc0'],
} as const;
export type SporeSet = keyof typeof SPORE_SETS;

/** Smoke ramps [lit, mid, underside]: chimneys, and the darker forge smoke. */
const SMOKE = {
  smoke: ['#e6e0d6', '#c9c1b5', '#a0988c'],
  smokedark: ['#9c968e', '#7a756e', '#5c5852'],
} as const;
/** Puff sizes [w, h, coverage]: solid while small, Bayer-dithered as it thins out (no alpha fades). */
export const PUFF_SIZES: readonly (readonly [number, number, number])[] = [
  [4, 3, 1],
  [6, 5, 1],
  [8, 6, 1],
  [10, 8, 0.5],
  [12, 9, 0.25],
];

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Cloud shapes [w, h]. */
export const CLOUD_SIZES: readonly (readonly [number, number])[] = [
  [208, 112],
  [272, 132],
  [176, 100],
];
export const CLOUD_SHAPES = CLOUD_SIZES.length;
/** Cloud shadow colour: a cool slate, multiplied over the world at low alpha by render/ambient.ts. */
export const CLOUD_COLOR = '#2c3450';

/** Integer hash -> [0, 1) (1 px noise for cloud edges). */
function hash01(x: number, y: number, seed: number): number {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(seed, 0x27d4eb2d);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * A cloud-shadow mask (pure, 0/1 per pixel, row-major): a few overlapping ellipses whose summed field is solid inside
 * and breaks up into 1 px noise across a soft rim (coverage falls from 1 to 0 over the outer ~40% of the field), with a
 * 2 px empty border. Deterministic per (w, h, seed).
 */
export function cloudMask(w: number, h: number, seed: number): Uint8Array {
  const rnd = artRng(seed);
  const blobs: [number, number, number, number][] = [];
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    blobs.push([w * (0.22 + t * 0.56 + (rnd() - 0.5) * 0.12), h * (0.42 + (rnd() - 0.5) * 0.26), w * (0.15 + rnd() * 0.12), h * (0.24 + rnd() * 0.14)]);
  }
  const out = new Uint8Array(w * h);
  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      let f = 0;
      for (const [cx, cy, rx, ry] of blobs) {
        const d = ((x + 0.5 - cx) / rx) ** 2 + ((y + 0.5 - cy) / ry) ** 2;
        if (d < 1) f += (1 - d) * (1 - d);
      }
      const cover = Math.min(1, f / 0.42);
      if (cover >= 1 || (cover > 0 && hash01(x, y, seed) < cover * cover)) out[y * w + x] = 1;
    }
  return out;
}

interface FxFrame {
  name: string;
  w: number;
  h: number;
  draw: (c: Ctx) => void;
}

/** Paints a pixel map ('.' = empty, other chars looked up in pal) at (ox, oy). */
function pmap(c: Ctx, rows: readonly string[], pal: Readonly<Record<string, string>>, ox = 0, oy = 0, keep?: (x: number, y: number) => boolean): void {
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = pal[row[x]];
      if (col && (!keep || keep(x, y))) px(c, ox + x, oy + y, col);
    }
  });
}

function puff(c: Ctx, w: number, h: number, cover: number, ramp: readonly string[]): void {
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const d = ((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2;
      if (d > 1.02) continue;
      if (cover < 1 && BAYER4[(y & 3) * 4 + (x & 3)] >= cover * 16) continue;
      const col = y < h * 0.4 && x < w * 0.62 ? ramp[0] : y >= h * 0.66 ? ramp[2] : ramp[1];
      px(c, x, y, col);
    }
}

function fxFrames(): FxFrame[] {
  const out: FxFrame[] = [];
  const one = (name: string, w: number, h: number, draw: (c: Ctx) => void) => out.push({ name, w, h, draw });
  for (const set of Object.keys(LEAF_SETS) as LeafSet[]) {
    const [a, b, c3] = LEAF_SETS[set];
    const pal = { a, b, c: c3 };
    LEAF_BODIES.forEach((rows, i) => {
      const w = rows[0].length + 2;
      const h = rows.length + 2;
      one(`leaf_${set}_${i}`, w, h, (c) => sprite(c, w, h, (k) => pmap(k, rows, pal, 1, 1)));
    });
    // fade: the flat leaf, every other pixel, no rim
    one(`leaf_${set}_fade`, 6, 5, (c) => pmap(c, LEAF_BODIES[0], pal, 1, 1, (x, y) => (x + y) % 2 === 0));
  }
  one('snow_0', 1, 1, (c) => px(c, 0, 0, '#ffffff'));
  one('snow_1', 2, 2, (c) => pmap(c, ['ab', 'bc'], { a: '#ffffff', b: '#e2ebf3', c: '#b8c8d8' }));
  one('snow_2', 3, 3, (c) => pmap(c, ['.b.', 'bab', '.b.'], { a: '#ffffff', b: '#d0deea' }));
  // rain: slanted 1:4 downwind, the head (bottom) brightest
  one('rain_0', 3, 12, (c) => {
    for (let i = 0; i < 12; i++) px(c, Math.floor(i / 5), i, i < 3 ? '#8aa4c0' : i < 10 ? '#b8d2ea' : '#eef8ff');
  });
  one('rain_1', 2, 8, (c) => {
    for (let i = 0; i < 8; i++) px(c, Math.floor(i / 5), i, i < 2 ? '#7f98b4' : '#a8c4de');
  });
  one('puddle_0', 3, 1, (c) => pmap(c, ['aaa'], { a: '#c8dcec' }));
  one('puddle_1', 5, 3, (c) => pmap(c, ['.aaa.', 'a...a', '.aaa.'], { a: '#b8d0e4' }));
  one('puddle_2', 7, 3, (c) => pmap(c, ['.a.a.a.', 'a.....a', '.a.a.a.'], { a: '#a8c0d8' }));
  one('puddle_3', 9, 3, (c) => pmap(c, ['..a...a..', 'a.......a', '...a.a...'], { a: '#98b0c8' }));
  one('firefly_0', 1, 1, (c) => px(c, 0, 0, '#7a8a30'));
  one('firefly_1', 1, 1, (c) => px(c, 0, 0, '#e8f878'));
  one('firefly_2', 3, 3, (c) => pmap(c, ['.b.', 'bab', '.b.'], { a: '#fbffd0', b: '#b8e050' }));
  // full glow: a bright cross inside a dim green ring of pixels (opaque; reads as glow on dark ground)
  one('firefly_3', 5, 5, (c) => pmap(c, ['..c..', '.cbc.', 'cbabc', '.cbc.', '..c..'], { a: '#fffff0', b: '#d8f070', c: '#6a9a30' }));
  for (const set of Object.keys(SPORE_SETS) as SporeSet[]) {
    const [dim, bright, core, arm] = SPORE_SETS[set];
    one(`spore_${set}_0`, 1, 1, (c) => px(c, 0, 0, dim));
    one(`spore_${set}_1`, 1, 1, (c) => px(c, 0, 0, bright));
    one(`spore_${set}_2`, 3, 3, (c) => pmap(c, ['.b.', 'bab', '.b.'], { a: core, b: arm }));
  }
  one('dust_0', 1, 1, (c) => px(c, 0, 0, '#8a8070'));
  one('dust_1', 1, 1, (c) => px(c, 0, 0, '#e8dec4'));
  // embers cool as they rise: white-hot cross, 2x2, a 1x2 streak, an orange speck, a dying red one
  one('ember_0', 3, 3, (c) => pmap(c, ['.b.', 'bab', '.b.'], { a: '#fff6c8', b: '#ffc04a' }));
  one('ember_1', 2, 2, (c) => pmap(c, ['ab', 'bc'], { a: '#fff0a8', b: '#ffc04a', c: '#f07a28' }));
  one('ember_2', 1, 2, (c) => pmap(c, ['a', 'b'], { a: '#ffc04a', b: '#f07a28' }));
  one('ember_3', 1, 1, (c) => px(c, 0, 0, '#f07a28'));
  one('ember_4', 1, 1, (c) => px(c, 0, 0, '#a8301a'));
  one('heat_0', 1, 1, (c) => px(c, 0, 0, '#fff6d8'));
  one('heat_1', 1, 2, (c) => pmap(c, ['a', 'b'], { a: '#ffeec0', b: '#f0d090' }));
  for (const kind of ['smoke', 'smokedark'] as const)
    PUFF_SIZES.forEach(([w, h, cover], i) => one(`${kind}_${i}`, w, h, (c) => puff(c, w, h, cover, SMOKE[kind])));
  return out;
}

/**
 * Builds AMB_FX (every particle frame, shelf-packed with 1 px gaps) and AMB_CLOUD (the cloud-shadow shapes).
 * Idempotent per key; render/ambient.ts calls it when the first map with ambience starts.
 */
export function drawAmbientFx(scene: Phaser.Scene): void {
  if (!scene.textures.exists(AMB_FX)) {
    const frames = fxFrames();
    const W = 96;
    const pos: [number, number][] = [];
    let x = 0;
    let y = 0;
    let row = 0;
    for (const f of frames) {
      if (x + f.w > W) {
        x = 0;
        y += row + 1;
        row = 0;
      }
      pos.push([x, y]);
      x += f.w + 1;
      row = Math.max(row, f.h);
    }
    const H = y + row;
    const tex = scene.textures.createCanvas(AMB_FX, W, H);
    if (tex) {
      const c = tex.getContext();
      c.imageSmoothingEnabled = false;
      frames.forEach((f, i) => {
        c.save();
        c.translate(pos[i][0], pos[i][1]);
        f.draw(c);
        c.restore();
      });
      frames.forEach((f, i) => tex.add(f.name, 0, pos[i][0], pos[i][1], f.w, f.h));
      tex.refresh();
    }
  }
  if (!scene.textures.exists(AMB_CLOUD)) {
    const W = CLOUD_SIZES.reduce((s, [w]) => s + w + IDLE_GAP, -IDLE_GAP);
    const H = Math.max(...CLOUD_SIZES.map(([, h]) => h));
    const tex = scene.textures.createCanvas(AMB_CLOUD, W, H);
    if (tex) {
      const c = tex.getContext();
      const img = c.createImageData(W, H);
      const [r, g, b] = [1, 3, 5].map((i) => parseInt(CLOUD_COLOR.slice(i, i + 2), 16));
      let ox = 0;
      CLOUD_SIZES.forEach(([w, h], k) => {
        const m = cloudMask(w, h, keySeed(`cloud-${k}`));
        for (let yy = 0; yy < h; yy++)
          for (let xx = 0; xx < w; xx++) {
            if (!m[yy * w + xx]) continue;
            const i = (yy * W + ox + xx) * 4;
            img.data[i] = r;
            img.data[i + 1] = g;
            img.data[i + 2] = b;
            img.data[i + 3] = 255;
          }
        tex.add(`cloud_${k}`, 0, ox, 0, w, h);
        ox += w + IDLE_GAP;
      });
      c.putImageData(img, 0, 0);
      tex.refresh();
    }
  }
}
