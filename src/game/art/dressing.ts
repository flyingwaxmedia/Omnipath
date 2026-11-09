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
  m: { w: 22, h: 20, blooms: 5, leaves: 5, leaf: 9 },
  l: { w: 30, h: 28, blooms: 9, leaves: 8, leaf: 13 },
} as const;

function flowerClump(scene: Phaser.Scene, color: keyof typeof FLOWERS, size: keyof typeof FLOWER_SIZES): void {
  const key = `dr_flower_${color}_${size}`;
  const S = FLOWER_SIZES[size];
  const F = FLOWERS[color];
  tex(scene, key, S.w, S.h, (c, rnd) => {
    const cx = S.w / 2;
    const base = S.h - 2;
    shadow(c, cx, base + 0.5, S.w * 0.36, 1.6);
    sprite(c, S.w, S.h, (b) => {
      // leaves fan out from the base, lily-like arcs
      for (let i = 0; i < S.leaves; i++) {
        const t = i / (S.leaves - 1);
        const ang = -Math.PI / 2 + (t - 0.5) * 2.3 + (rnd() - 0.5) * 0.25;
        const len = S.leaf * (0.7 + rnd() * 0.4) * (1 - Math.abs(t - 0.5) * 0.5);
        const x1 = cx + Math.cos(ang) * len;
        const y1 = base + Math.sin(ang) * len * 0.85;
        blade(b, cx + (t - 0.5) * 3, base, x1, y1, size === 's' ? 2 : 3, R.leaf, t < 0.5 ? 4 : 3);
      }
      // stems + blooms, highest blooms at the back
      const pts: [number, number][] = [];
      for (let i = 0; i < S.blooms; i++) {
        const t = i / (S.blooms - 1);
        const x = Math.round(3 + t * (S.w - 6) + (rnd() - 0.5) * 2);
        const y = Math.round(3 + rnd() * (S.h * 0.42) + Math.abs(t - 0.5) * S.h * 0.25);
        pts.push([x, Math.min(base - 4, y + (F.kind === 'spike' ? 3 : 0))]);
      }
      pts.sort((p, q) => p[1] - q[1]);
      for (const [x, y] of pts) seg(b, Math.round(cx + (x - cx) * 0.3), base - 1, x, y + 1, R.leaf[2]);
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
  const w = wide ? 22 : 16;
  const h = wide ? 20 : 17;
  tex(scene, key, w, h, (c, rnd) => {
    const cx = w / 2;
    const base = h - 2;
    shadow(c, cx, base + 0.5, w * 0.36, 1.5);
    sprite(c, w, h, (b) => {
      const n = wide ? 9 : 6;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        const x0 = cx + (t - 0.5) * (wide ? 8 : 5);
        const lean = (t - 0.5) * (wide ? 14 : 9) + (rnd() - 0.5) * 3;
        const len = (wide ? 13 : 11) * (0.65 + rnd() * 0.4) * (1 - Math.abs(t - 0.5) * 0.6);
        const x1 = x0 + lean;
        const y1 = base - len;
        const tone = t < 0.4 ? 4 : t < 0.7 ? 3 : 2;
        blade(b, x0, base, x1, y1, 2, ramp, tone);
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

function bannerBody(b: Ctx, cloth: Ramp, h: number): void {
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
  fpoly(b, [2, top, 12, top, 12, bot, 7, bot - 4, 2, bot], cloth[2]);
  box(b, 2, top, 2, bot - top - 1, cloth[3]);
  box(b, 10, top, 2, bot - top - 2, cloth[1]);
  box(b, 2, top, 10, 1, R.gold[2]);
  box(b, 3, bot - 4, 1, 3, R.gold[2]);
  box(b, 10, bot - 4, 1, 3, R.gold[2]);
  waystar(b, 7, Math.round(top + (bot - top) * 0.42), 3);
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
  tex(scene, 'dr_banner_blue', 14, 40, (c) => {
    shadow(c, 7, 38.5, 6, 1.5);
    sprite(c, 14, 40, (b) => bannerBody(b, R.blue, 39));
  });
  tex(scene, 'dr_banner_red', 14, 40, (c) => {
    shadow(c, 7, 38.5, 6, 1.5);
    sprite(c, 14, 40, (b) => bannerBody(b, R.red, 39));
  });
  tex(scene, 'dr_lantern', 16, 40, (c) => {
    shadow(c, 7, 38.5, 5, 1.5);
    halo(c, 11, 12, 9, '#ffcf6a', 0.4);
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
      box(b, 10, 10, 3, 4, R.glass[4]);
      box(b, 11, 9, 1, 6, R.iron[2]);
      box(b, 9, 15, 5, 1, R.iron[1]);
      box(b, 3, 36, 7, 3, R.stone[2]);
      box(b, 3, 36, 7, 1, R.stone[4]);
    });
  });
  tex(scene, 'dr_candles', 14, 16, (c) => {
    halo(c, 7, 7, 7, '#ffcf6a', 0.4);
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
    for (const [x, h] of [
      [4, 6],
      [8, 9],
      [11, 4],
    ]) {
      box(c, x, 14 - h - 3, 1, 2, R.ember[4]);
      px(c, x, 14 - h - 1, R.ember[5]);
      px(c, x, 14 - h - 4, R.ember[3]);
    }
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
  // Vertical segment: a run going north-south in the 3/4 view. One post per tile at the foot; the two rails seen
  // edge-on become a strip that climbs to where the next segment's post stands (a run is capped by dr_fence_post).
  tex(scene, 'dr_fence_v', 10, 52, (c) => {
    const vf = 51;
    disc(c, 5, vf, 4, 1.2, SHADOW);
    box(c, 6, 20, 2, vf - 20, 'rgba(36,24,15,0.14)');
    sprite(c, 10, 52, (b) => {
      const B = R.bark;
      box(b, 3, 5, 4, vf - 12, B[3]);
      box(b, 3, 5, 1, vf - 12, B[4]);
      box(b, 6, 5, 1, vf - 12, B[1]);
      for (let y = 10; y < vf - 8; y += 9) box(b, 4, y, 2, 1, B[2]);
      box(b, 4, 12, 2, 1, B[5]);
      post(b, 3, vf, 18);
      rope(b, 3, vf - 14);
      rope(b, 3, vf - 7);
    });
  });
  tex(scene, 'dr_fence_post', 8, H, (c) => {
    disc(c, 4, foot, 4, 1.2, SHADOW);
    sprite(c, 8, H, (b) => post(b, 2, foot, 18));
  });
}

// ------------------------------------------------------------------ biome accents

function drawAccents(scene: Phaser.Scene): void {
  tex(scene, 'dr_reeds', 16, 22, (c) => {
    shadow(c, 8, 20.5, 6, 1.4);
    sprite(c, 16, 22, (b) => {
      for (const [x0, lean, len, tone] of [
        [5, -4, 12, 4],
        [7, -1, 15, 3],
        [9, 2, 13, 3],
        [11, 5, 10, 2],
        [8, 0, 9, 4],
      ] as const)
        blade(b, x0, 20, x0 + lean, 20 - len, 2, R.grass, tone);
      for (const [x, top] of [
        [6, 3],
        [10, 5],
      ]) {
        box(b, x, top + 5, 1, 20 - top - 5, R.grass[2]);
        box(b, x - 1, top, 3, 5, R.bark[2]);
        box(b, x - 1, top, 1, 5, R.bark[4]);
        px(b, x, top - 1, R.grass[4]);
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
