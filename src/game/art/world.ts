import type Phaser from 'phaser';
import { mulberry32 } from '../../core/rng';
import { T, TILE_COUNT } from '../../core/world/tiles';
import { type Ctx, canvasTex, ellipse, line, poly, rect, rgba, scratch, shade } from './common';
import { PAL, artRng, disc, keySeed, line as seg, outline, px } from './pixel';

// World art: tileset atlas, props, structures, objects, gather nodes, portals and hidden-portal blockers.
// Every texture key here is a contract with the client (see docs/SPEC-v2.md §7 and src/core/world/types.ts).
// Everything below the tile section is true pixel art (docs/ART-DIRECTION.md "Lush Pixel"): integer pixels, flat
// colour ramps lit from the top-left and a 1 px PAL.outline rim. Sizes and anchors are unchanged from v2.

const TILE = 32;

/** Tiles are drawn edge-to-edge, then copied into an atlas with 1px extruded borders
 *  so fractional camera zoom never samples a neighbouring tile (no seams). */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;

import { canvasTexAll, glow, groundShadow, mix, outlined, vgrad } from './common';
const OUTLINE = 'rgba(22,18,30,0.78)';
// ================================================================== tiles

type Wrap = (f: () => void) => void;
interface TileKit {
  c: Ctx;
  rnd: () => number;
  /** Run `f` at the 9 toroidal offsets so anything it draws wraps across tile edges (seamless). */
  wrap: Wrap;
}

function makeTile(seed: number, draw: (k: TileKit) => void): HTMLCanvasElement {
  const { el, c } = scratch(TILE, TILE);
  const rnd = mulberry32(seed);
  const wrap: Wrap = (f) => {
    for (const dx of [-TILE, 0, TILE])
      for (const dy of [-TILE, 0, TILE]) {
        c.save();
        c.translate(dx, dy);
        f();
        c.restore();
      }
  };
  draw({ c, rnd, wrap });
  return el;
}

const ri = (rnd: () => number, n: number) => Math.floor(rnd() * n);

/** Wrapped speckles. */
function wspeck(k: TileKit, colors: string[], n: number, size = 2, size2 = size): void {
  for (let i = 0; i < n; i++) {
    const col = colors[ri(k.rnd, colors.length)];
    const x = ri(k.rnd, TILE);
    const y = ri(k.rnd, TILE);
    const s = k.rnd() < 0.5 ? size : size2;
    k.wrap(() => rect(k.c, x, y, s, s, col));
  }
}

/** Soft low-frequency blotches that break up flat fills. */
function wblobs(k: TileKit, colors: string[], n: number, rMin: number, rMax: number): void {
  for (let i = 0; i < n; i++) {
    const col = colors[i % colors.length];
    const x = k.rnd() * TILE;
    const y = k.rnd() * TILE;
    const rx = rMin + k.rnd() * (rMax - rMin);
    const ry = rx * (0.6 + k.rnd() * 0.3);
    k.wrap(() => ellipse(k.c, x, y, rx, ry, col));
  }
}

/** Little grass tufts. */
function wtufts(k: TileKit, n: number, dark: string, light: string, tall = false): void {
  for (let i = 0; i < n; i++) {
    const x = ri(k.rnd, TILE);
    const y = ri(k.rnd, TILE);
    const h = tall ? 4 : 3;
    k.wrap(() => {
      rect(k.c, x, y + 1, 1, h - 1, dark);
      rect(k.c, x + 1, y - 1, 1, h + 1, dark);
      rect(k.c, x + 2, y + 1, 1, h - 1, dark);
      rect(k.c, x + 1, y - 1, 1, 1, light);
    });
  }
}

/** Pebbles: lit top pixel row, dark underside. */
function wpebbles(k: TileKit, n: number, body: string, hi: string, lo: string): void {
  for (let i = 0; i < n; i++) {
    const x = ri(k.rnd, TILE);
    const y = ri(k.rnd, TILE);
    const w = 2 + ri(k.rnd, 2);
    k.wrap(() => {
      rect(k.c, x, y + 1, w, 1, lo);
      rect(k.c, x, y, w, 1, body);
      rect(k.c, x, y, 1, 1, hi);
    });
  }
}

/** Water surface glints. */
function wwaves(k: TileKit, n: number, crest: string, trough: string, sparkle: string): void {
  for (let i = 0; i < n; i++) {
    const x = ri(k.rnd, TILE);
    const y = ri(k.rnd, TILE);
    const len = 5 + ri(k.rnd, 5);
    k.wrap(() => {
      rect(k.c, x + 1, y, len - 2, 1, crest);
      rect(k.c, x, y + 1, 1, 1, crest);
      rect(k.c, x + len - 1, y + 1, 1, 1, crest);
      rect(k.c, x + 1, y + 1, len - 2, 1, trough);
    });
  }
  for (let i = 0; i < 3; i++) {
    const x = ri(k.rnd, TILE);
    const y = ri(k.rnd, TILE);
    k.wrap(() => rect(k.c, x, y, 1, 1, sparkle));
  }
}

/**
 * Raised rock / masonry: two rows of chunky blocks per tile (brick offset), each with a lit top
 * face, a darker south-facing front face and a deep crevice — reads as a raised mass from 3/4 view.
 */
function wblocks(
  k: TileKit,
  o: { top: string; front: string; crevice: string; hi: string; lo: string; jag: number; widths: [number[], number[]]; topH: [number, number]; frontH: number; square?: boolean },
): void {
  const { c } = k;
  c.fillStyle = o.crevice;
  c.fillRect(0, 0, TILE, TILE);
  for (let row = 0; row < 2; row++) {
    const y0 = row * 16;
    let x = row === 0 ? 0 : 8;
    for (const bw of o.widths[row]) {
      const j = o.jag;
      const bx = x + (j ? ri(k.rnd, 2) : 0);
      const ww = bw - 1 - (j ? ri(k.rnd, 2) : 0);
      const th = o.topH[0] + ri(k.rnd, o.topH[1] - o.topH[0] + 1);
      const fh = o.frontH;
      const by = y0 + 16 - 1 - fh - th;
      const tv = (k.rnd() - 0.5) * 14;
      const top = shade(o.top, tv);
      const front = shade(o.front, tv * 0.6);
      const cracks: number[] = [];
      for (let q = 0; q < 2; q++) cracks.push(bx + 2 + ri(k.rnd, Math.max(1, ww - 4)));
      const specks: [number, number][] = [];
      for (let q = 0; q < 4; q++) specks.push([bx + 1 + ri(k.rnd, Math.max(1, ww - 2)), by + 1 + ri(k.rnd, Math.max(1, th - 2))]);
      const r = o.square ? 0 : 1;
      k.wrap(() => {
        // front face
        rect(c, bx, by + th, ww, fh, front);
        rect(c, bx, by + th + fh - 1, ww, 1, o.lo);
        if (r) {
          rect(c, bx, by + th + fh - 1, 1, 1, o.crevice);
          rect(c, bx + ww - 1, by + th + fh - 1, 1, 1, o.crevice);
        }
        for (const cx of cracks) rect(c, cx, by + th + 1, 1, fh - 2, shade(front, -22));
        // top face
        rect(c, bx, by, ww, th, top);
        rect(c, bx, by, ww, 1, o.hi);
        rect(c, bx, by, 1, th, shade(top, 10));
        rect(c, bx, by + th - 1, ww, 1, shade(top, -14));
        if (r) {
          rect(c, bx, by, 1, 1, o.crevice);
          rect(c, bx + ww - 1, by, 1, 1, o.crevice);
        }
        for (const [sx, sy] of specks) rect(c, sx, sy, 1, 1, shade(top, -18));
      });
      x += bw;
    }
  }
}

/**
 * Rugged raised rock: a pile of lumps on three rows, each lump with a lit top face, a darker
 * south-facing front face and a dark crevice rim. Copies are painted in screen-y order across
 * the torus so lower lumps overlap upper ones exactly as they would in an endless wall.
 */
function wrocks(
  k: TileKit,
  o: { top: string; front: string; crevice: string; hi: string; lo: string; grass?: [string, string]; w: [number, number]; th: [number, number]; fh: number; rows: number[]; per: number },
): void {
  const { c, rnd } = k;
  rect(c, 0, 0, TILE, TILE, shade(o.front, -26));
  interface Lump { x: number; y: number; w: number; th: number; top: string; front: string; crack: number; notch: number; tuft: number }
  const lumps: Lump[] = [];
  o.rows.forEach((ry) => {
    // Random partition of the 32px row into 2-3 lumps at a random phase (wraps seamlessly).
    const n = o.per + ri(rnd, 2);
    const widths: number[] = [];
    let left = TILE;
    for (let q = 0; q < n; q++) {
      const w = q === n - 1 ? left : Math.round(TILE / n + (rnd() - 0.5) * 6);
      widths.push(w);
      left -= w;
    }
    let x = ri(rnd, TILE);
    for (const cell of widths) {
      const w = Math.max(o.w[0], Math.min(o.w[1], cell + 1));
      const v = (rnd() - 0.5) * 18;
      lumps.push({
        x,
        y: ry + ri(rnd, 4) - 1,
        w,
        th: o.th[0] + ri(rnd, o.th[1] - o.th[0] + 1),
        top: shade(o.top, v),
        front: shade(o.front, v * 0.6),
        crack: 2 + ri(rnd, Math.max(1, w - 5)),
        notch: ri(rnd, 3),
        tuft: o.grass && rnd() < 0.35 ? 2 + ri(rnd, Math.max(1, w - 6)) : -1,
      });
      x += cell;
    }
  });
  const copies: [Lump, number][] = [];
  for (const l of lumps) for (const dy of [-TILE, 0, TILE]) copies.push([l, dy]);
  copies.sort((a, b) => a[0].y + a[1] - (b[0].y + b[1]));
  for (const [l, dy] of copies)
    for (const dx of [-TILE, 0, TILE]) {
      const x = l.x + dx;
      const y = l.y + dy;
      const { w, th } = l;
      const fh = o.fh;
      // crevice rim
      poly(c, [x + 1, y - 1, x + w - 1, y - 1, x + w + 1, y + 1, x + w + 1, y + th + fh, x + w - 1, y + th + fh + 1, x + 1, y + th + fh + 1, x - 1, y + th + fh, x - 1, y + 1], o.crevice);
      // front face (south-facing, in shade)
      poly(c, [x, y + th - 1, x + w, y + th - 1, x + w, y + th + fh - 1, x + w - 1, y + th + fh, x + 1, y + th + fh, x, y + th + fh - 1], l.front);
      rect(c, x + 1, y + th + fh - 1, w - 2, 1, o.lo);
      rect(c, x + l.crack, y + th + 1, 1, fh - 2, shade(l.front, -20));
      rect(c, x + w - 1, y + th, 1, fh - 1, shade(l.front, -14));
      // top face (lit from the north-west)
      poly(c, [x + 2 + l.notch, y, x + w - 3, y, x + w, y + 3, x + w, y + th, x, y + th, x, y + 2], l.top);
      rect(c, x + 2 + l.notch, y, w - 4 - l.notch, 1, o.hi);
      rect(c, x, y + 2, 1, th - 2, shade(l.top, 12));
      rect(c, x + 1, y + th - 1, w - 2, 1, shade(l.top, -16));
      rect(c, x + Math.round(w * 0.6), y + 2 + (l.notch % 2), 2, 1, shade(l.top, -14));
      if (th >= 8) {
        line(c, [x + 2, y + th - 2, x + Math.round(w * 0.45), y + 3], shade(l.top, 9), 1, 'butt');
        poly(c, [x + Math.round(w * 0.45) + 1, y + 3, x + w - 1, y + 3, x + w - 1, y + th - 1, x + 3, y + th - 1], shade(l.top, -7));
      }
      if (o.grass && l.tuft >= 0) {
        rect(c, x + l.tuft, y, 4, 1, o.grass[0]);
        rect(c, x + l.tuft + 1, y - 1, 1, 1, o.grass[1]);
        rect(c, x + l.tuft + 3, y + 1, 1, 1, o.grass[0]);
      }
    }
}

const TILE_DRAW: Record<number, (k: TileKit) => void> = {
  [T.GRASS]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#5d9e48');
    wblobs(k, ['#62a44c', '#58973f'], 4, 5, 9);
    wspeck(k, ['#6bae52', '#53913f', '#72b85a'], 30, 1, 2);
    wtufts(k, 4, '#4a873a', '#7cc060');
  },
  [T.GRASS2]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#58994a');
    wblobs(k, ['#5ea24e', '#529143'], 4, 5, 9);
    wspeck(k, ['#4b8a3e', '#66a853', '#79bd5d'], 34, 1, 2);
    wtufts(k, 7, '#447f38', '#7fc262', true);
  },
  [T.FLOWERS]: (k) => {
    TILE_DRAW[T.GRASS](k);
    const cols = ['#ffd84d', '#ff8fb1', '#ffffff', '#b59cff', '#ffd84d'];
    for (let i = 0; i < 5; i++) {
      const fx = ri(k.rnd, TILE);
      const fy = ri(k.rnd, TILE);
      const col = cols[i];
      k.wrap(() => {
        rect(k.c, fx, fy + 2, 1, 2, '#3f7a30');
        rect(k.c, fx - 1, fy, 3, 1, col);
        rect(k.c, fx, fy - 1, 1, 3, col);
        rect(k.c, fx, fy, 1, 1, col === '#ffd84d' ? '#c77d1a' : '#ffe680');
      });
    }
  },
  [T.PATH]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#b8925f');
    wblobs(k, ['#bf9a67', '#ae8856'], 5, 4, 8);
    wspeck(k, ['#a5814f', '#c9a36e', '#9d7a49'], 36, 1, 2);
    wpebbles(k, 4, '#cfae7d', '#e2c597', '#8a6b40');
  },
  [T.WATER]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#3c8fd1');
    wblobs(k, ['#3887c8', '#4296d6'], 4, 6, 10);
    wspeck(k, ['#4aa0e0', '#357fbd'], 12, 1, 2);
    wwaves(k, 4, '#8fd0f6', '#3579b8', '#e8f8ff');
  },
  [T.SAND]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#e2cc8e');
    wblobs(k, ['#e7d398', '#dbc384'], 4, 5, 9);
    wspeck(k, ['#d4bc7c', '#eedb9f', '#c9b06d'], 32, 1, 2);
    for (let i = 0; i < 3; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      k.wrap(() => {
        rect(k.c, x, y, 2, 1, '#cdb575');
        rect(k.c, x + 2, y - 1, 3, 1, '#cdb575');
        rect(k.c, x + 5, y, 2, 1, '#cdb575');
        rect(k.c, x + 2, y, 3, 1, '#f2e2ad');
      });
    }
  },
  [T.STONE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#8d8a85');
    wblobs(k, ['#94918b', '#85827d'], 5, 4, 8);
    wspeck(k, ['#7c7974', '#9f9c97', '#6e6b66'], 34, 1, 2);
    for (let i = 0; i < 3; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const pts = [x, y, x + 4 + ri(k.rnd, 4), y + ri(k.rnd, 3) - 1, x + 9 + ri(k.rnd, 4), y + 2 + ri(k.rnd, 3)];
      k.wrap(() => {
        line(k.c, pts, '#6b6863', 1, 'butt');
        k.c.save();
        k.c.translate(0, 1);
        line(k.c, pts, 'rgba(176,172,165,0.7)', 1, 'butt');
        k.c.restore();
      });
    }
    wpebbles(k, 3, '#a4a19b', '#bdbab3', '#64615c');
  },
  [T.DARK]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#3b4a3e');
    wblobs(k, ['#3f4f42', '#36443a'], 4, 5, 9);
    wspeck(k, ['#323f35', '#455748', '#2b362e', '#4b3d5a'], 40, 1, 2);
    for (let i = 0; i < 5; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const col = i % 2 ? '#5a4a3a' : '#54446c';
      k.wrap(() => {
        rect(k.c, x, y, 2, 1, col);
        rect(k.c, x + 1, y + 1, 1, 1, shade(col, -20));
      });
    }
    wtufts(k, 3, '#2c382f', '#55705a');
  },
  [T.COBBLE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#7a756d');
    for (let r = 0; r < 4; r++) {
      const off = r % 2 ? 4 : 0;
      for (let q = 0; q < 4; q++) {
        const x = off + q * 8;
        const y = r * 8;
        const v = (k.rnd() - 0.5) * 18;
        const body = shade('#a7a29a', v);
        k.wrap(() => {
          rect(k.c, x + 1, y + 1, 6, 6, body);
          rect(k.c, x + 1, y + 1, 1, 1, '#7a756d');
          rect(k.c, x + 6, y + 1, 1, 1, '#7a756d');
          rect(k.c, x + 2, y + 1, 4, 1, shade(body, 16));
          rect(k.c, x + 1, y + 2, 1, 3, shade(body, 8));
          rect(k.c, x + 1, y + 6, 6, 1, shade(body, -22));
          rect(k.c, x + 1, y + 6, 1, 1, '#7a756d');
          rect(k.c, x + 6, y + 6, 1, 1, '#7a756d');
        });
      }
    }
    wspeck(k, ['#b5b0a8', '#8f8a82'], 10, 1);
  },
  [T.BRIDGE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#4a3220');
    for (let r = 0; r < 4; r++) {
      const y = r * 8;
      const body = shade('#9a6b3c', (k.rnd() - 0.5) * 16);
      const seam = ri(k.rnd, TILE);
      const grain = [ri(k.rnd, TILE), ri(k.rnd, TILE)];
      k.wrap(() => {
        rect(k.c, 0, y, TILE, 7, body);
        rect(k.c, 0, y, TILE, 1, shade(body, 22));
        rect(k.c, 0, y + 6, TILE, 1, shade(body, -26));
        rect(k.c, seam, y, 1, 7, '#4a3220');
        rect(k.c, seam + 2, y + 3, 1, 1, '#3a2818');
        rect(k.c, seam - 3, y + 3, 1, 1, '#3a2818');
        for (const g of grain) rect(k.c, g, y + 2 + (g % 3), 6, 1, shade(body, -14));
      });
    }
  },
  [T.EMBER]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#5e4034');
    wblobs(k, ['#654538', '#553a2f'], 4, 5, 9);
    wspeck(k, ['#4f352b', '#6d4b3c', '#8a3f28', '#3d2a22'], 40, 1, 2);
    for (let i = 0; i < 2; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const pts = [x, y, x + 3 + ri(k.rnd, 3), y + 2 + ri(k.rnd, 2), x + 5 + ri(k.rnd, 4), y + 1 + ri(k.rnd, 3), x + 9 + ri(k.rnd, 3), y + 4];
      k.wrap(() => {
        line(k.c, pts, 'rgba(255,120,40,0.25)', 3);
        line(k.c, pts, '#2a1a14', 1, 'butt');
        k.c.save();
        k.c.translate(0, -1);
        line(k.c, pts, '#ff7a3a', 1, 'butt');
        k.c.restore();
        rect(k.c, pts[2], pts[3] - 1, 1, 1, '#ffd27a');
      });
    }
    wspeck(k, ['#ff8a3a', '#ffb050'], 3, 1);
  },
  [T.HILL]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#86b65a');
    wblobs(k, ['#8dbd60', '#7eae52'], 4, 5, 9);
    wspeck(k, ['#97c46a', '#78a64e', '#a2cf78'], 32, 1, 2);
    wtufts(k, 4, '#6d9a45', '#b2da86');
  },
  [T.DEEP]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#2d6fb0');
    wblobs(k, ['#2866a4', '#3175b8'], 4, 6, 10);
    wspeck(k, ['#2a65a1', '#3479bf'], 12, 1, 2);
    wwaves(k, 3, '#5a9edb', '#245d98', '#bfe2ff');
  },
  [T.CAVE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#4d443d');
    wblobs(k, ['#544a42', '#463e37'], 5, 4, 8);
    wspeck(k, ['#5c5148', '#3e3630', '#605650'], 34, 1, 2);
    for (let i = 0; i < 2; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const pts = [x, y, x + 4, y + 1 + ri(k.rnd, 2), x + 7 + ri(k.rnd, 3), y + ri(k.rnd, 3)];
      k.wrap(() => line(k.c, pts, '#352e29', 1, 'butt'));
    }
    wpebbles(k, 4, '#6a5e54', '#7e7166', '#2e2823');
  },
  [T.CAVE_WALL]: (k) =>
    wrocks(k, { top: '#75685b', front: '#4a4038', crevice: '#1b1613', hi: '#93836f', lo: '#342c26', w: [9, 19], th: [6, 8], fh: 4, rows: [0, 11, 22], per: 2 }),
  [T.CRYPT]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#3d3946');
    for (let r = 0; r < 2; r++)
      for (let q = 0; q < 2; q++) {
        const x = q * 16 + (r ? 8 : 0);
        const y = r * 16;
        const body = shade('#5f5a6a', (k.rnd() - 0.5) * 12);
        const crack = k.rnd() < 0.5 ? [x + 3 + ri(k.rnd, 6), y + 2, x + 6 + ri(k.rnd, 4), y + 7, x + 5 + ri(k.rnd, 6), y + 12] : null;
        const moss = k.rnd() < 0.5;
        k.wrap(() => {
          rect(k.c, x + 1, y + 1, 15, 15, body);
          rect(k.c, x + 1, y + 1, 15, 1, shade(body, 14));
          rect(k.c, x + 1, y + 1, 1, 15, shade(body, 8));
          rect(k.c, x + 1, y + 15, 15, 1, shade(body, -16));
          if (crack) line(k.c, crack, shade(body, -26), 1, 'butt');
          if (moss) {
            rect(k.c, x + 1, y + 13, 3, 2, '#4d6648');
            rect(k.c, x + 2, y + 12, 2, 1, '#5d7a55');
          }
        });
      }
    wspeck(k, ['#6a6575', '#514d5c'], 14, 1);
  },
  [T.CRYPT_WALL]: (k) =>
    wblocks(k, {
      top: '#7a7489',
      front: '#504a5e',
      crevice: '#1c1a22',
      hi: '#948ea4',
      lo: '#3b3646',
      jag: 0,
      widths: [
        [16, 16],
        [16, 16],
      ],
      topH: [6, 6],
      frontH: 8,
      square: true,
    }),
  [T.SNOW]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#e6eef6');
    wblobs(k, ['#f2f7fc', '#dbe5f0'], 5, 5, 9);
    wspeck(k, ['#d2deea', '#ffffff', '#c8d6e6'], 22, 1, 2);
    for (let i = 0; i < 4; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      k.wrap(() => {
        rect(k.c, x, y, 3, 1, '#ffffff');
        rect(k.c, x - 1, y + 1, 5, 1, '#c3d2e2');
      });
    }
  },
  [T.ICE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#94cde6');
    wblobs(k, ['#a3d7ec', '#88c3de'], 5, 6, 10);
    for (let i = 0; i < 3; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const len = 7 + ri(k.rnd, 7);
      k.wrap(() => {
        line(k.c, [x, y, x + len, y - len], 'rgba(255,255,255,0.55)', 2, 'butt');
        line(k.c, [x + 3, y + 1, x + 3 + len * 0.6, y + 1 - len * 0.6], 'rgba(255,255,255,0.35)', 1, 'butt');
      });
    }
    for (let i = 0; i < 2; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const pts = [x, y, x + 3, y + 2 + ri(k.rnd, 2), x + 5 + ri(k.rnd, 3), y + 1, x + 8, y + 4];
      k.wrap(() => {
        line(k.c, pts, '#6fa9c6', 1, 'butt');
        k.c.save();
        k.c.translate(0, 1);
        line(k.c, pts, 'rgba(235,250,255,0.8)', 1, 'butt');
        k.c.restore();
      });
    }
    for (let i = 0; i < 2; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      k.wrap(() => {
        rect(k.c, x - 1, y, 3, 1, '#ffffff');
        rect(k.c, x, y - 1, 1, 3, '#ffffff');
      });
    }
  },
  [T.BASALT]: (k) => {
    const { c } = k;
    rect(c, 0, 0, TILE, TILE, '#17151a');
    // Flat-top hexagonal column tops, foreshortened (period 16 x 32 -> seamless on 32).
    const R = 10.6;
    const H = 16;
    for (let col = 0; col < 2; col++)
      for (let row = 0; row < 2; row++) {
        const cx = col * 16;
        const cy = row * 16 + (col ? 8 : 0);
        const face = shade('#3a373e', (k.rnd() - 0.5) * 14);
        const ember = k.rnd() < 0.3;
        const r = R - 1.2;
        const h = H / 2 - 1;
        const hexPts = [cx - r, cy, cx - r / 2, cy - h, cx + r / 2, cy - h, cx + r, cy, cx + r / 2, cy + h, cx - r / 2, cy + h];
        k.wrap(() => {
          poly(c, hexPts.map((v, i) => (i % 2 ? v + 1 : v)), '#26232a');
          poly(c, hexPts, face);
          line(c, [cx - r + 1, cy - 0.5, cx - r / 2 + 0.5, cy - h + 0.5, cx + r / 2 - 0.5, cy - h + 0.5], shade(face, 22), 1, 'butt');
          rect(c, Math.round(cx - 2), Math.round(cy - 1), 2, 1, shade(face, -12));
          if (ember) rect(c, Math.round(cx + r / 2), Math.round(cy + h), 2, 1, '#c8501e');
        });
      }
  },
  [T.LAVA]: (k) => {
    const { c } = k;
    rect(c, 0, 0, TILE, TILE, '#d8461a');
    wblobs(k, ['#e85c1c', '#c43a16', '#f07020'], 6, 5, 9);
    // molten swirls
    for (let i = 0; i < 4; i++) {
      const x = k.rnd() * TILE;
      const y = k.rnd() * TILE;
      const a = (k.rnd() - 0.5) * 3;
      const pts = [x, y, x + 4, y + a - 1, x + 8, y + a + 1, x + 12, y - a];
      k.wrap(() => {
        line(c, pts, '#ff9a2e', 3);
        line(c, pts, '#ffd04a', 1);
      });
    }
    // drifting crust
    for (let i = 0; i < 3; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const w = 3 + ri(k.rnd, 3);
      k.wrap(() => {
        poly(c, [x, y, x + w, y - 1, x + w + 2, y + 1, x + w, y + 3, x + 1, y + 3, x - 1, y + 1], '#7a2412');
        rect(c, x + 1, y, w - 1, 1, '#a83a1a');
      });
    }
    for (let i = 0; i < 4; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      k.wrap(() => {
        rect(c, x, y, 2, 1, '#fff4b0');
        rect(c, x, y + 1, 1, 1, '#ffe070');
      });
    }
  },
  [T.DUSK]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#55507e');
    wblobs(k, ['#5a5585', '#4e4975'], 4, 5, 9);
    wspeck(k, ['#4a4570', '#625c8c', '#6e5f96', '#7a6aa0'], 32, 1, 2);
    wtufts(k, 5, '#433e66', '#9a88c8');
    wspeck(k, ['#ffb0e0', '#9fe8ff'], 2, 1);
  },
  [T.STORMGRASS]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#647f68');
    wblobs(k, ['#6a866e', '#5e7862'], 4, 5, 9);
    wspeck(k, ['#5a745e', '#748f76', '#55705a'], 24, 1, 2);
    for (let i = 0; i < 9; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const lit = k.rnd() < 0.4;
      k.wrap(() => {
        rect(k.c, x, y + 2, 1, 1, '#4c6650');
        rect(k.c, x + 1, y + 1, 1, 1, '#4c6650');
        rect(k.c, x + 2, y, 2, 1, lit ? '#a2bea4' : '#55705a');
      });
    }
    wspeck(k, ['#c6ecff'], 1, 1);
  },
  [T.VOID]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#07060b');
    wblobs(k, ['#0a0810', '#09070e'], 3, 6, 10);
    wspeck(k, ['#141022', '#18132a'], 6, 1);
  },
  [T.CLIFF]: (k) =>
    wrocks(k, {
      top: '#9a8a74',
      front: '#685a49',
      crevice: '#2a221b',
      hi: '#b8a78e',
      lo: '#4a3f33',
      grass: ['#5d9e48', '#7cc060'],
      w: [9, 19],
      th: [6, 8],
      fh: 4,
      rows: [0, 11, 22],
      per: 2,
    }),
  [T.GLADE]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#4f9e74');
    wblobs(k, ['#56a67b', '#48936b'], 4, 5, 9);
    wspeck(k, ['#5fb084', '#438a64', '#6cbd90'], 30, 1, 2);
    wtufts(k, 4, '#3d8060', '#8fd8ac');
    for (let i = 0; i < 3; i++) {
      const x = ri(k.rnd, TILE);
      const y = ri(k.rnd, TILE);
      const col = i === 1 ? '#fff3b0' : '#d8fff0';
      k.wrap(() => {
        rect(k.c, x, y, 1, 1, col);
        rect(k.c, x - 1, y, 1, 1, rgba(col, 0.45));
        rect(k.c, x + 1, y, 1, 1, rgba(col, 0.45));
        rect(k.c, x, y - 1, 1, 1, rgba(col, 0.45));
        rect(k.c, x, y + 1, 1, 1, rgba(col, 0.45));
      });
    }
  },
  [T.MOSS]: (k) => {
    rect(k.c, 0, 0, TILE, TILE, '#2f4c2d');
    for (let i = 0; i < 9; i++) {
      const x = k.rnd() * TILE;
      const y = k.rnd() * TILE;
      const r = 3 + k.rnd() * 3;
      const body = shade('#40683b', (k.rnd() - 0.5) * 14);
      k.wrap(() => {
        ellipse(k.c, x, y + 1, r, r * 0.8, '#263f25');
        ellipse(k.c, x, y, r, r * 0.75, body);
        ellipse(k.c, x - r * 0.3, y - r * 0.3, r * 0.45, r * 0.3, shade(body, 22));
      });
    }
    wspeck(k, ['#5f9450', '#33522f'], 12, 1);
  },
};

function drawTiles(scene: Phaser.Scene): void {
  if (scene.textures.exists('tiles')) return;
  const tiles: HTMLCanvasElement[] = [];
  for (let i = 0; i < TILE_COUNT; i++) {
    const draw = TILE_DRAW[i];
    tiles.push(makeTile(1000 + i * 97, draw ?? ((k) => rect(k.c, 0, 0, TILE, TILE, '#ff00ff'))));
  }
  const step = TILE + TILE_SPACING;
  // Single row: width = 2*margin + n*TILE + (n-1)*spacing  (27 tiles -> 918px).
  canvasTex(scene, 'tiles', TILE_MARGIN * 2 + TILE_COUNT * TILE + (TILE_COUNT - 1) * TILE_SPACING, TILE + TILE_MARGIN * 2, (out) => {
    for (let i = 0; i < TILE_COUNT; i++) {
      const src = tiles[i];
      const dx = TILE_MARGIN + i * step;
      const dy = TILE_MARGIN;
      out.drawImage(src, 0, 0, TILE, TILE, dx, dy, TILE, TILE);
      // Extrude each edge (and corners) by one pixel.
      out.drawImage(src, 0, 0, 1, TILE, dx - 1, dy, 1, TILE);
      out.drawImage(src, TILE - 1, 0, 1, TILE, dx + TILE, dy, 1, TILE);
      out.drawImage(src, 0, 0, TILE, 1, dx, dy - 1, TILE, 1);
      out.drawImage(src, 0, TILE - 1, TILE, 1, dx, dy + TILE, TILE, 1);
      out.drawImage(src, 0, 0, 1, 1, dx - 1, dy - 1, 1, 1);
      out.drawImage(src, TILE - 1, 0, 1, 1, dx + TILE, dy - 1, 1, 1);
      out.drawImage(src, 0, TILE - 1, 1, 1, dx - 1, dy + TILE, 1, 1);
      out.drawImage(src, TILE - 1, TILE - 1, 1, 1, dx + TILE, dy + TILE, 1, 1);
    }
  });
}

// ================================================================== pixel kit
// Shared by props, structures, objects, nodes and portals. Bodies are painted on a scratch canvas by sprite(),
// which then adds the 1 px PAL.outline rim and composites over whatever (shadows, halos) is already on the texture.

const OUT = PAL.outline;
type Ramp = readonly string[];

/** Material ramps, darkest -> lightest. Anchors from docs/ART-DIRECTION.md §2, extended by a shade either side. */
const R = {
  leaf: ['#1f3519', '#2b4a22', '#3d6630', '#548540', '#74a655', '#a2c46a'],
  bark: ['#2e1d10', '#3d2817', '#5c3d22', '#7d5530', '#9c6d3e', '#b8874f'],
  stone: ['#33353c', '#4a4d55', '#666a73', '#878b93', '#a9adb3', '#cfd2d5'],
  warmStone: ['#3a342e', '#544c43', '#70665a', '#8f8475', '#aea290', '#ccc2ae'],
  dirt: ['#5a4a34', '#7a6446', '#96805c', '#ad9a74', '#c2b18a'],
  grass: ['#3f5a26', '#56772f', '#6c8f3a', '#86a64a', '#a2bd62'],
  moss: ['#2b4a22', '#3d6630', '#548540', '#74a655'],
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

const SHADOW = 'rgba(36,24,15,0.30)';

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

/** Flat pixel ground shadow (hard-edged, translucent, warm). */
function shadow(c: Ctx, cx: number, cy: number, rx: number, ry: number, a = 0.3): void {
  disc(c, cx, cy, rx, ry, a === 0.3 ? SHADOW : `rgba(36,24,15,${a})`);
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

const LEAF_DARK = ['#151320', '#201d31', '#2e2946', '#40395f', '#574d7e', '#8576b0'];
const LEAF_DUSK = ['#1d1730', '#2b2248', '#3e3168', '#56468a', '#7462aa', '#a690d6'];
const PINE = ['#12261c', '#1a3826', '#264e34', '#346840', '#4a8350', '#73a663'];
const FROST_PINE = ['#122a32', '#1a3c44', '#26545a', '#356e70', '#4c8a86', '#74aaa2'];
const SNOW = ['#7f97b0', '#a8bdd2', '#cddcea', '#eef4fa', '#ffffff'];
const DEAD_BARK = ['#201814', '#2e241e', '#43362c', '#5a4a3c', '#74624f', '#8e7b64'];
const DUSK_BARK = ['#1a1220', '#281c30', '#3a2a44', '#4f3b5a', '#664e72', '#7f6690'];
const BASALT = ['#0e0c10', '#19161c', '#252128', '#332e38', '#45404c', '#5e5866'];

function broadTree(scene: Phaser.Scene, key: string, leaf: Ramp, bark: Ramp, extra?: (b: Ctx, rnd: () => number) => void): void {
  canvasTex(scene, key, 48, 64, (c) => {
    const rnd = artRng(keySeed(key));
    shadow(c, 24, 60, 18, 4);
    sprite(c, 48, 64, (b) => {
      trunkPx(b, 24, 30, 61, 8, bark, rnd);
      brush(b, [22, 42, 15, 33], 2, bark[3]);
      brush(b, [26, 40, 33, 31], 2, bark[2]);
      leafMass(b, 24, 16, 16, 12, leaf, rnd, false);
      leafMass(b, 12, 29, 11, 9, leaf, rnd);
      leafMass(b, 36, 28, 11, 9, leaf, rnd);
      leafMass(b, 23, 36, 10, 6, leaf, rnd);
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

function pineTree(scene: Phaser.Scene, key: string, ramp: Ramp, snow: boolean): void {
  canvasTex(scene, key, 40, 64, (c) => {
    shadow(c, 20, 60, 14, 4);
    if (snow) disc(c, 20, 60, 12, 3, 'rgba(238,244,250,0.75)');
    sprite(c, 40, 64, (b) => {
      box(b, 17, 48, 6, 13, DEAD_BARK[3]);
      box(b, 17, 48, 2, 13, DEAD_BARK[4]);
      box(b, 21, 48, 2, 13, DEAD_BARK[2]);
      box(b, 16, 59, 8, 2, DEAD_BARK[2]);
      pineTier(b, 20, 28, 51, 17, ramp, snow, true);
      pineTier(b, 20, 15, 37, 13, ramp, snow, true);
      pineTier(b, 20, 3, 24, 9, ramp, snow, false);
      box(b, 19, 1, 2, 3, snow ? SNOW[3] : ramp[4]);
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
  broadTree(scene, 'tree', R.leaf, R.bark);
  broadTree(scene, 'darktree', LEAF_DARK, DEAD_BARK, (b, rnd) => {
    for (let i = 0; i < 5; i++) {
      const x = Math.round(8 + rnd() * 32);
      const y = Math.round(8 + rnd() * 30);
      px(b, x, y, '#c8a8ff');
    }
  });
  pineTree(scene, 'pine', PINE, false);
  pineTree(scene, 'frostpine', FROST_PINE, true);

  canvasTex(scene, 'deadtree', 40, 56, (c) => {
    shadow(c, 20, 52, 13, 3.5);
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
    shadow(c, 16, 25, 13, 3);
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

  canvasTex(scene, 'rock', 34, 30, (c) => {
    const rnd = artRng(keySeed('rock'));
    shadow(c, 17, 26, 15, 3.5);
    sprite(c, 34, 30, (b) => {
      rockPx(b, 2, 3, 1, R.stone, true, rnd);
      tuft(b, 2, 28);
      tuft(b, 26, 29);
    });
  });

  canvasTex(scene, 'boulder', 48, 40, (c) => {
    const rnd = artRng(keySeed('boulder'));
    shadow(c, 24, 35, 22, 4.5);
    sprite(c, 48, 40, (b) => {
      rockPx(b, 1, 2, 1.32, R.stone, true, rnd);
      rockPx(b, 29, 21, 0.58, R.stone, false, rnd);
      tuft(b, 3, 38);
      tuft(b, 22, 39);
    });
  });

  canvasTex(scene, 'crystal', 32, 44, (c) => {
    shadow(c, 16, 41, 12, 3);
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
    shadow(c, 14, 41, 11, 3);
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
    shadow(c, 14, 33, 11, 3);
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

  canvasTex(scene, 'mushroom', 28, 30, (c) => {
    shadow(c, 14, 27, 11, 2.5);
    sprite(c, 28, 30, (b) => {
      shroom(b, 19, 19, 5, 4, 7, R.crimson);
      shroom(b, 10, 15, 7, 6, 11, ['#4a1c10', '#7a3218', '#a84a24', '#c86a38', '#e8a070']);
      shroom(b, 4, 23, 3, 2, 4, R.crimson, R.cream, false);
      tuft(b, 20, 28);
    });
  });

  canvasTex(scene, 'duskwillow', 56, 72, (c) => {
    const rnd = artRng(keySeed('duskwillow'));
    shadow(c, 28, 68, 21, 4.5);
    halo(c, 13, 47, 9, '#ffb0e8', 0.35);
    halo(c, 43, 43, 9, '#9fe8ff', 0.35);
    sprite(c, 56, 72, (b) => {
      trunkPx(b, 28, 34, 69, 9, DUSK_BARK, rnd);
      brush(b, [26, 42, 18, 31], 3, DUSK_BARK[3]);
      brush(b, [31, 40, 39, 30], 3, DUSK_BARK[2]);
      leafMass(b, 28, 14, 19, 12, LEAF_DUSK, rnd, false);
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
        box(b, x + dx, top + Math.round(len * 0.6), 1, len - Math.round(len * 0.6), col);
        px(b, x, top + 2, LEAF_DUSK[5]);
        if (i % 4 === 1) box(b, x + dx, top + len, 1, 2, i % 8 === 1 ? '#f0a0d8' : '#a8e0ff');
      }
      // glowing blossom lanterns
      disc(b, 13, 47, 2.5, 3, '#f8b8e8');
      box(b, 12, 45, 1, 2, '#ffffff');
      disc(b, 43, 43, 2.5, 3, '#b8ecff');
      box(b, 42, 41, 1, 2, '#ffffff');
    });
  });

  canvasTex(scene, 'basalt_spire', 32, 60, (c) => {
    shadow(c, 16, 56, 14, 3.5);
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

  canvasTex(scene, 'reeds', 28, 34, (c) => {
    shadow(c, 14, 31, 10, 2.5);
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
        seg(b, x + Math.round(lean * 0.4), base - 9, x + lean, tipY, R.grass[Math.min(4, tone + 1)]);
        px(b, x + 1, base - 1, R.grass[tone - 1 < 0 ? 0 : tone - 1]);
      }
      for (const [x, top] of [
        [13, 5],
        [18, 3],
      ]) {
        box(b, x, top + 7, 1, 31 - top - 7, R.grass[1]);
        box(b, x - 1, top, 3, 7, R.bark[2]);
        box(b, x - 1, top, 1, 7, R.bark[4]);
        box(b, x + 1, top + 1, 1, 6, R.bark[1]);
        px(b, x, top - 1, R.grass[3]);
      }
    });
  });
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
  box(b, x + w - 3, y, 3, h - 5, 'rgba(36,24,15,0.22)');
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

/** Pixel smoke puffs (translucent, drawn outside the sprite so they get no outline). */
function smokePx(c: Ctx, x: number, y: number): void {
  disc(c, x, y, 3, 2.5, 'rgba(214,208,200,0.55)');
  disc(c, x + 3, y - 6, 4, 3, 'rgba(214,208,200,0.42)');
  disc(c, x + 1, y - 13, 5, 3.5, 'rgba(214,208,200,0.28)');
  px(c, x - 1, y - 1, 'rgba(255,255,255,0.6)');
}

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
    shadow(c, 64, 123, 62, 6);
    sprite(c, 128, 128, (b) => {
      wallPx(b, 8, 72, 112, 52, 'stone', rnd);
      // forge bay
      box(b, 12, 86, 46, 36, R.bark[1]);
      box(b, 14, 90, 42, 32, '#160e09');
      disc(b, 35, 116, 18, 9, '#4a200e');
      disc(b, 35, 117, 12, 6, '#6e2c12');
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
      box(b, 8, 77, 112, 2, 'rgba(36,24,15,0.4)');
      chimneyPx(b, 92, 8, 14, 34);
      // anvil out front
      box(b, 30, 120, 10, 5, R.iron[1]);
      fpoly(b, [23, 114, 45, 114, 45, 117, 41, 118, 41, 120, 29, 120, 29, 118, 25, 117, 21, 115], R.iron[2]);
      box(b, 24, 114, 21, 1, R.iron[4]);
      box(b, 24, 115, 21, 1, R.iron[3]);
      // quench barrel
      box(b, 104, 110, 11, 15, R.bark[3]);
      box(b, 104, 110, 2, 15, R.bark[4]);
      box(b, 113, 110, 2, 15, R.bark[1]);
      for (const yy of [112, 119]) box(b, 104, yy, 11, 1, R.iron[1]);
      box(b, 105, 109, 9, 2, PAL.water[1]);
      px(b, 106, 109, PAL.water[3]);
    });
    halo(c, 99, 6, 8, '#ff9a3a', 0.45);
    smokePx(c, 100, 2);
  });

  // ---- chapel 4x4: front gable, slate planes going back, rose window, bell cote with the waystar finial
  texAll(scene, ['struct_chapel', 'chapel'], 128, 176, (c) => {
    const rnd = artRng(keySeed('struct_chapel'));
    shadow(c, 64, 171, 60, 6);
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
    shadow(c, 48, 95, 44, 5);
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
    smokePx(c, 48, 2);
  });

  // ---- hall 6x4: timber guild hall, slate roof, central gable porch, waystar banners and lanterns
  canvasTex(scene, 'struct_hall', 192, 156, (c) => {
    const rnd = artRng(keySeed('struct_hall'));
    shadow(c, 96, 151, 92, 6);
    sprite(c, 192, 156, (b) => {
      wallPx(b, 8, 84, 176, 68, 'plaster', rnd);
      for (const wx of [20, 44, 136, 160]) windowPx(b, wx, 102, 12, 14, R.teal);
      roofPx(b, 2, 190, 26, 91, 14, ROOF_GREEN, 'slate', rnd);
      box(b, 8, 91, 176, 2, 'rgba(36,24,15,0.4)');
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
    smokePx(c, 37, 8);
  });

  // ---- house 3x3: timber frame cottage, tiled roof, flower box
  canvasTex(scene, 'struct_house', 96, 108, (c) => {
    const rnd = artRng(keySeed('struct_house'));
    shadow(c, 48, 103, 44, 5);
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
      box(b, 10, 67, 76, 2, 'rgba(36,24,15,0.4)');
      chimneyPx(b, 18, 8, 10, 24);
    });
    smokePx(c, 23, 3);
  });

  // ---- tent 3x2: striped canvas, open flap, pennant, guy ropes
  canvasTex(scene, 'struct_tent', 96, 72, (c) => {
    shadow(c, 48, 66, 44, 5);
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
    shadow(c, 64, 98, 60, 5, 0.22);
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
    shadow(c, 32, 155, 28, 5);
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
    shadow(c, 16, 44, 14, 3);
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

function flame(c: Ctx, x: number, base: number, h: number): void {
  poly(c, [x - h * 0.45, base, x - h * 0.3, base - h * 0.55, x - h * 0.05, base - h * 0.4, x, base - h, x + h * 0.25, base - h * 0.5, x + h * 0.4, base - h * 0.6, x + h * 0.45, base], '#e8541c');
  poly(c, [x - h * 0.3, base, x - h * 0.15, base - h * 0.45, x + h * 0.05, base - h * 0.75, x + h * 0.2, base - h * 0.4, x + h * 0.3, base], '#ff9a2e');
  poly(c, [x - h * 0.15, base, x, base - h * 0.45, x + h * 0.15, base], '#ffe27a');
}

function waystone(lit: boolean): (c: Ctx) => void {
  return (c) => {
    groundShadow(c, 16, 52, 12, 3.5);
    if (lit) glow(c, 16, 26, 22, '#6fe8ff', 0.5);
    const rune = lit ? '#c8fcff' : '#5c6773';
    outlined(c, 32, 56, OUTLINE, (b) => {
      poly(b, [4, 53, 7, 46, 25, 46, 28, 53], '#7d776e');
      rect(b, 7, 46, 18, 2, '#99938a');
      rect(b, 11, 49, 1, 4, '#635e57');
      rect(b, 20, 49, 1, 4, '#635e57');
      poly(b, [9, 48, 8, 14, 11, 6, 16, 3, 21, 6, 24, 14, 23, 48], '#8d99a5');
      poly(b, [19, 4, 21, 6, 24, 14, 23, 48, 19, 48], '#6c7782');
      line(b, [10, 44, 9, 15, 12, 8], '#aab6c1', 1, 'butt');
      // carved compass-star rune over three waymarks
      poly(b, [15.5, 13, 17, 18, 21.5, 19.5, 17, 21, 15.5, 26, 14, 21, 9.5, 19.5, 14, 18], rune);
      rect(b, 15, 19, 1, 1, lit ? '#ffffff' : '#46505a');
      for (const y of [30, 35, 40]) rect(b, 13, y, 5, 2, rune);
    });
    if (lit) {
      glow(c, 15.5, 19.5, 7, '#bffcff', 0.7);
      rect(c, 15, 19, 1, 1, '#ffffff');
      for (const [x, y] of [
        [5, 14],
        [27, 22],
        [6, 34],
        [26, 8],
      ]) {
        rect(c, x, y - 1, 1, 3, '#dffcff');
        rect(c, x - 1, y, 3, 1, '#dffcff');
      }
    }
  };
}

function obelisk(c: Ctx): void {
  groundShadow(c, 18, 70, 14, 4.5, 0.34);
  glow(c, 18, 44, 18, '#b08cff', 0.28);
  outlined(c, 36, 76, OUTLINE, (b) => {
    poly(b, [5, 72, 8, 64, 28, 64, 31, 72], '#3a3150');
    rect(b, 8, 64, 20, 2, '#52476e');
    poly(b, [18, 2, 29, 16, 27, 65, 9, 65, 7, 16], '#2b2140');
    poly(b, [18, 2, 18, 65, 9, 65, 7, 16], '#4a3a70');
    line(b, [8, 17, 17, 4], '#6a58a0', 1, 'butt');
  });
  const glyphs: number[][] = [
    [14, 21, 17, 24, 14, 27, 11, 24],
    [11, 33, 17, 33, 14, 38],
    [11, 46, 17, 46, 17, 48, 11, 48],
  ];
  for (const g of glyphs) {
    glow(c, 14, g[1] + 2, 6, '#b08cff', 0.6);
    poly(c, g, '#d7c2ff');
  }
  rect(c, 13, 23, 2, 2, '#4a3a70');
  rect(c, 13, 50, 2, 3, '#b08cff');
}

function windShrine(c: Ctx): void {
  groundShadow(c, 20, 59, 16, 4.5, 0.3);
  outlined(c, 40, 64, OUTLINE, (b) => {
    poly(b, [6, 60, 8, 52, 32, 52, 34, 60], '#8f9aa2');
    rect(b, 8, 52, 24, 2, '#b4bec6');
    rect(b, 13, 14, 14, 39, '#c4ccd3');
    rect(b, 23, 14, 4, 39, '#9aa4ad');
    rect(b, 13, 14, 1, 39, '#dfe6ec');
    // cap with little roof
    rect(b, 9, 10, 22, 5, '#b4bec6');
    poly(b, [7, 11, 20, 3, 33, 11], '#3f7f78');
    poly(b, [20, 3, 33, 11, 20, 11], '#2f6560');
    // spiral wind glyph
    b.strokeStyle = '#3fb8a0';
    b.lineWidth = 1.6;
    b.beginPath();
    for (let i = 0; i <= 40; i++) {
      const t = i / 40;
      const a = t * Math.PI * 3.2;
      const r = 1 + t * 5;
      const x = 18 + Math.cos(a) * r;
      const y = 29 + Math.sin(a) * r;
      if (i) b.lineTo(x, y);
      else b.moveTo(x, y);
    }
    b.stroke();
    line(b, [14, 41, 22, 41], '#3fb8a0', 1.4, 'butt');
    line(b, [15, 45, 24, 45], '#3fb8a0', 1.4, 'butt');
  });
  // ribbons + chime streaming in the wind
  line(c, [31, 12, 35, 16, 33, 21, 38, 26], '#e8f6f2', 2, 'butt');
  line(c, [29, 13, 32, 20, 29, 26, 33, 31], '#5fd0b8', 2, 'butt');
  rect(c, 9, 15, 1, 6, '#c8b48c');
  rect(c, 8, 21, 3, 5, '#d8dee4');
}

function signpost(c: Ctx): void {
  groundShadow(c, 16, 41, 8, 3);
  outlined(c, 32, 44, OUTLINE, (b) => {
    rect(b, 14, 8, 4, 34, '#6b4423');
    rect(b, 17, 8, 1, 34, '#4e3019');
    poly(b, [3, 13, 7, 8, 26, 8, 26, 18, 7, 18], '#b07f4e');
    rect(b, 7, 8, 19, 1, '#cf9c66');
    rect(b, 8, 12, 14, 1, '#6e4a27');
    rect(b, 8, 15, 10, 1, '#6e4a27');
    poly(b, [6, 21, 25, 21, 29, 26, 25, 31, 6, 31], '#a8794a');
    rect(b, 6, 21, 19, 1, '#c8955e');
    rect(b, 9, 25, 13, 1, '#5e3e20');
    rect(b, 9, 28, 9, 1, '#5e3e20');
    rect(b, 15, 10, 2, 2, '#3a3a40');
    rect(b, 15, 24, 2, 2, '#3a3a40');
  });
}

function chest(open: boolean): (c: Ctx) => void {
  return (c) => {
    const H = open ? 32 : 28;
    const oy = open ? 4 : 0;
    groundShadow(c, 16, H - 4, 13, 3);
    if (open) glow(c, 16, 14 + oy, 14, '#ffd84d', 0.45);
    outlined(c, 32, H, OUTLINE, (b) => {
      const wood = '#9a6034';
      if (open) {
        // lid swung back
        rect(b, 5, 1, 22, 11, shade(wood, -20));
        rect(b, 5, 1, 22, 2, shade(wood, 6));
        rect(b, 7, 3, 18, 8, '#4a2c18');
        rect(b, 5, 6, 22, 1, '#d8a83a');
      }
      // body
      rect(b, 4, 13 + oy, 24, 12, wood);
      rect(b, 4, 13 + oy, 24, 1, shade(wood, 18));
      rect(b, 4, 23 + oy, 24, 2, shade(wood, -30));
      rect(b, 24, 13 + oy, 4, 12, shade(wood, -16));
      for (const x of [6, 22]) rect(b, x, 13 + oy, 3, 12, '#d8a83a');
      if (open) {
        rect(b, 5, 11 + oy, 22, 3, '#3a2214');
        for (let i = 0; i < 7; i++) {
          const x = 7 + i * 3;
          ellipse(b, x, 11 + oy + (i % 2), 2, 1.5, i % 3 ? '#ffd84d' : '#f2b830');
        }
        rect(b, 12, 9 + oy, 2, 2, '#9ff0ff');
        rect(b, 19, 9 + oy, 2, 2, '#ff8fb1');
      } else {
        // closed lid: rounded top seen from above
        rect(b, 4, 6, 24, 8, shade(wood, 14));
        ellipse(b, 16, 6, 12, 3, shade(wood, 24));
        rect(b, 4, 12, 24, 2, shade(wood, -24));
        for (const x of [6, 22]) {
          rect(b, x, 4, 3, 10, '#e8b84a');
          rect(b, x, 4, 1, 10, '#ffe08a');
        }
        rect(b, 14, 11, 5, 6, '#d8a83a');
        rect(b, 16, 13, 1, 2, '#3a2214');
      }
    });
    if (open) {
      rect(c, 10, 11, 1, 1, '#ffffff');
      rect(c, 21, 13, 1, 1, '#ffffff');
    } else rect(c, 9, 6, 2, 1, '#fff2c0');
  };
}

function statue(c: Ctx): void {
  groundShadow(c, 20, 63, 16, 4.5, 0.3);
  outlined(c, 40, 68, OUTLINE, (b) => {
    const st = '#aaa69e';
    // pedestal
    rect(b, 7, 50, 26, 14, shade(st, -24));
    rect(b, 7, 48, 26, 5, shade(st, 10));
    rect(b, 7, 48, 26, 1, shade(st, 26));
    rect(b, 29, 50, 4, 14, shade(st, -40));
    rect(b, 14, 55, 12, 5, shade(st, -38));
    rect(b, 15, 56, 10, 1, shade(st, -12));
    // robed wanderer leaning on a tall staff, hood up
    poly(b, [12, 48, 14, 26, 20, 20, 26, 26, 28, 48], st);
    poly(b, [20, 20, 26, 26, 28, 48, 21, 48], shade(st, -22));
    ellipse(b, 20, 15, 6, 6.5, st);
    poly(b, [14, 16, 15, 9, 20, 6, 25, 9, 26, 16, 23, 13, 17, 13], shade(st, 14));
    ellipse(b, 20, 16, 3.5, 3, shade(st, -48));
    rect(b, 15, 30, 10, 3, shade(st, -12));
    line(b, [17, 33, 15, 47], shade(st, -16), 1, 'butt');
    line(b, [23, 33, 25, 47], shade(st, -34), 1, 'butt');
    rect(b, 29, 4, 3, 45, shade(st, -10));
    rect(b, 29, 4, 1, 45, shade(st, 16));
    ellipse(b, 30.5, 4, 3, 3, shade(st, 6));
    rect(b, 25, 26, 6, 3, st);
    // moss + cracks
    rect(b, 8, 61, 6, 2, '#5a8a46');
    rect(b, 26, 47, 5, 2, '#5a8a46');
    line(b, [13, 36, 16, 40, 14, 44], shade(st, -40), 1, 'butt');
  });
}

function campfire(c: Ctx): void {
  groundShadow(c, 16, 26, 13, 3.5, 0.25);
  glow(c, 16, 20, 18, '#ff9a3a', 0.55);
  outlined(c, 32, 32, OUTLINE, (b) => {
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      const x = 16 + Math.cos(a) * 10;
      const y = 24 + Math.sin(a) * 4;
      if (y < 22) continue;
      ellipse(b, x, y, 3, 2.2, i % 2 ? '#8d887f' : '#a29c90');
      rect(b, Math.round(x - 1), Math.round(y - 2), 2, 1, '#bdb7ab');
    }
    line(b, [8, 25, 24, 19], '#6b4423', 3, 'butt');
    line(b, [24, 25, 8, 19], '#5a3a1e', 3, 'butt');
    ellipse(b, 8, 25, 1.5, 1.5, '#c89a62');
    ellipse(b, 24, 25, 1.5, 1.5, '#c89a62');
    flame(b, 16, 23, 17);
  });
  rect(c, 11, 4, 1, 1, '#ffd27a');
  rect(c, 21, 2, 1, 1, '#ffb050');
  rect(c, 18, 6, 1, 1, '#ffe27a');
}

function drawObjects(scene: Phaser.Scene): void {
  canvasTex(scene, 'obj_waystone', 32, 56, waystone(false));
  canvasTex(scene, 'obj_waystone_lit', 32, 56, waystone(true));
  canvasTex(scene, 'obj_altar', 48, 44, (c) => {
    groundShadow(c, 24, 39, 21, 4.5);
    glow(c, 12, 12, 8, '#ffcf6a', 0.4);
    glow(c, 36, 12, 8, '#ffcf6a', 0.4);
    outlined(c, 48, 44, OUTLINE, (b) => {
      const st = '#b8b2a6';
      rect(b, 8, 24, 32, 15, shade(st, -26));
      rect(b, 36, 24, 4, 15, shade(st, -42));
      rect(b, 4, 16, 40, 9, st);
      rect(b, 4, 16, 40, 1, shade(st, 22));
      rect(b, 4, 23, 40, 2, shade(st, -34));
      // cloth runner
      rect(b, 18, 16, 12, 18, '#6a3a8a');
      poly(b, [18, 34, 24, 37, 30, 34], '#6a3a8a');
      rect(b, 18, 16, 12, 1, '#8a5aaa');
      rect(b, 18, 33, 12, 1, '#d8a83a');
      poly(b, [24, 24, 26, 27, 24, 30, 22, 27], '#d8a83a');
      // bowl + candles
      ellipse(b, 24, 16, 5, 2, '#8a7a5a');
      ellipse(b, 24, 15.5, 3.5, 1.2, '#ffd27a');
      for (const x of [11, 36]) {
        rect(b, x - 2, 9, 4, 8, '#f0e8d0');
        rect(b, x - 2, 9, 1, 8, '#ffffff');
        rect(b, x, 7, 1, 2, '#3a3a40');
        flame(b, x + 0.5, 7, 6);
      }
    });
  });
  canvasTexAll(scene, ['obj_wind_shrine', 'shrine'], 40, 64, windShrine);
  canvasTexAll(scene, ['obj_obelisk', 'obelisk'], 36, 76, obelisk);
  canvasTexAll(scene, ['obj_signpost', 'signpost'], 32, 44, signpost);
  canvasTex(scene, 'obj_chest', 32, 28, chest(false));
  canvasTex(scene, 'obj_chest_open', 32, 32, chest(true));
  canvasTex(scene, 'obj_statue', 40, 68, statue);
  canvasTex(scene, 'obj_campfire', 32, 32, campfire);
  canvasTex(scene, 'bobber', 12, 12, (c) => {
    ellipse(c, 6, 6, 5, 5, '#ff4040');
    rect(c, 1, 6, 10, 2, '#ffffff');
    rect(c, 4, 3, 2, 1, '#ff9a9a');
  });
}

// ================================================================== gather nodes

function oreRock(c: Ctx): void {
  groundShadow(c, 17, 25, 14, 4);
  outlined(c, 34, 30, OUTLINE, (b) => {
    poly(b, [2, 23, 5, 10, 15, 3, 27, 7, 31, 23, 24, 26, 10, 26], '#5f5750');
    poly(b, [5, 18, 7, 10, 15, 5, 26, 9, 27, 16, 18, 19], '#857c74');
    poly(b, [7, 10, 15, 5, 26, 9, 19, 11], '#a39a90');
    line(b, [9, 13, 13, 16, 17, 14, 22, 17], '#c8902a', 2, 'butt');
    line(b, [12, 21, 16, 19, 20, 23], '#c8902a', 2, 'butt');
    for (const [x, y] of [
      [12, 12],
      [19, 8],
      [23, 15],
      [14, 18],
      [26, 20],
      [8, 21],
    ]) {
      rect(b, x, y, 3, 2, '#f0b43c');
      rect(b, x, y, 1, 1, '#fff6c0');
    }
  });
}

function drawNodes(scene: Phaser.Scene): void {
  canvasTexAll(scene, ['node_ore', 'ore'], 34, 30, oreRock);

  canvasTex(scene, 'node_fishing', 36, 24, (c) => {
    for (const [rx, ry, a] of [
      [16, 7, 0.35],
      [11, 5, 0.55],
      [6, 2.6, 0.8],
    ] as const) {
      c.strokeStyle = `rgba(230,246,255,${a})`;
      c.lineWidth = 1.5;
      c.beginPath();
      c.ellipse(18, 13, rx, ry, 0, 0, Math.PI * 2);
      c.stroke();
    }
    c.strokeStyle = 'rgba(30,80,130,0.35)';
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(18, 14, 11, 5, 0, 0.2, Math.PI - 0.2);
    c.stroke();
    for (const [x, y, r] of [
      [13, 10, 2],
      [22, 8, 1.5],
      [26, 13, 1.2],
      [17, 5, 1],
    ] as const) {
      ellipse(c, x, y, r + 0.6, r + 0.6, 'rgba(220,244,255,0.55)');
      ellipse(c, x, y, r, r, 'rgba(120,190,240,0.6)');
      rect(c, Math.round(x - r * 0.5), Math.round(y - r * 0.6), 1, 1, '#ffffff');
    }
  });

  canvasTex(scene, 'node_herb', 28, 28, (c) => {
    groundShadow(c, 14, 24, 10, 2.5);
    outlined(c, 28, 28, OUTLINE, (b) => {
      const leaf = (x: number, y: number, ang: number, len: number, col: string) => {
        b.save();
        b.translate(x, y);
        b.rotate(ang);
        ellipse(b, 0, -len / 2, len * 0.28, len / 2, col);
        rect(b, 0, -len + 2, 1, len - 2, shade(col, -26));
        b.restore();
      };
      leaf(14, 24, -1.1, 11, '#4f9a3c');
      leaf(14, 24, 1.1, 11, '#4a9038');
      leaf(14, 24, -0.55, 13, '#5fae48');
      leaf(14, 24, 0.55, 13, '#58a442');
      leaf(14, 24, 0, 14, '#6cbc52');
      for (const [x, y] of [
        [9, 8],
        [19, 6],
        [14, 4],
      ]) {
        line(b, [14, 18, x, y + 2], '#3f7a30', 1, 'butt');
        ellipse(b, x, y, 2.2, 2.2, '#f4f4ff');
        rect(b, x, y, 1, 1, '#9ab8ff');
      }
    });
  });

  canvasTex(scene, 'node_ember_vent', 32, 32, (c) => {
    groundShadow(c, 16, 27, 14, 4);
    glow(c, 16, 20, 14, '#ff7a2a', 0.5);
    outlined(c, 32, 32, OUTLINE, (b) => {
      poly(b, [2, 27, 6, 20, 12, 16, 20, 16, 26, 20, 30, 27, 22, 29, 10, 29], '#4a3028');
      poly(b, [6, 20, 12, 16, 20, 16, 26, 20, 18, 21, 12, 21], '#6b4a3a');
      ellipse(b, 16, 19, 5, 2.2, '#2a120c');
      ellipse(b, 16, 19, 3.5, 1.4, '#ff8a2a');
      ellipse(b, 16, 19, 1.8, 0.8, '#ffe27a');
      line(b, [8, 26, 11, 22, 10, 19], '#ff7a3a', 1, 'butt');
      line(b, [23, 27, 21, 23, 24, 21], '#ff7a3a', 1, 'butt');
    });
    ellipse(c, 15, 12, 3, 2.4, 'rgba(120,110,105,0.55)');
    ellipse(c, 18, 7, 4, 3, 'rgba(120,110,105,0.4)');
    ellipse(c, 15, 2, 4, 2.5, 'rgba(120,110,105,0.25)');
    rect(c, 20, 10, 1, 1, '#ffb050');
    rect(c, 12, 6, 1, 1, '#ffd27a');
  });

  canvasTex(scene, 'node_wind_chime', 28, 52, (c) => {
    groundShadow(c, 12, 48, 8, 2.5);
    outlined(c, 28, 52, OUTLINE, (b) => {
      rect(b, 10, 6, 4, 43, '#7a5230');
      rect(b, 13, 6, 1, 43, '#5a3a20');
      rect(b, 4, 6, 22, 3, '#8a6238');
      rect(b, 4, 6, 22, 1, '#a87a48');
      poly(b, [9, 6, 12, 1, 15, 6], '#3f7f78');
      for (const [x, len] of [
        [6, 9],
        [17, 12],
        [21, 8],
        [25, 11],
      ] as const) {
        rect(b, x, 9, 1, 3, '#c8b48c');
        rect(b, x - 1, 12, 3, len, '#cfd8e0');
        rect(b, x - 1, 12, 1, len, '#ffffff');
      }
      line(b, [8, 9, 7, 20, 9, 26], '#e8f6f2', 2, 'butt');
      poly(b, [6, 24, 10, 22, 11, 30, 8, 31], '#5fd0b8');
    });
    line(c, [2, 30, 6, 28], 'rgba(255,255,255,0.7)', 1, 'butt');
    line(c, [1, 36, 6, 34], 'rgba(255,255,255,0.5)', 1, 'butt');
  });

  canvasTex(scene, 'node_storm_tree', 44, 64, (c) => {
    const rnd = mulberry32(311);
    groundShadow(c, 22, 59, 15, 4.5);
    glow(c, 22, 22, 22, '#8fd8ff', 0.3);
    outlined(c, 44, 64, OUTLINE, (b) => {
      const bark = '#4a4a5c';
      poly(b, [16, 60, 19, 52, 19, 34, 25, 34, 25, 52, 28, 60], bark);
      rect(b, 22, 34, 3, 24, shade(bark, -22));
      line(b, [20, 40, 10, 30, 6, 18], bark, 4);
      line(b, [24, 36, 34, 26, 38, 14], bark, 4);
      line(b, [22, 34, 21, 18, 24, 8], bark, 3);
      line(b, [10, 30, 3, 28], bark, 2);
      line(b, [34, 26, 41, 26], bark, 2);
      line(b, [6, 18, 3, 11], bark, 2);
      line(b, [6, 18, 11, 10], bark, 2);
      line(b, [38, 14, 35, 6], bark, 2);
      line(b, [38, 14, 42, 8], bark, 2);
      line(b, [24, 8, 21, 2], bark, 2);
      line(b, [24, 8, 28, 3], bark, 2);
      line(b, [22, 40, 22, 52], shade(bark, 16), 1, 'butt');
      // sparse slate leaves clinging to the twigs
      for (let i = 0; i < 22; i++) {
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
        const [tx, ty] = tips[i % tips.length];
        const x = Math.round(tx + (rnd() - 0.5) * 7);
        const y = Math.round(ty + (rnd() - 0.5) * 5);
        rect(b, x, y, 2, 2, rnd() < 0.5 ? '#3f5a6a' : '#55788a');
      }
    });
    // crackling lightning through the branches
    const bolt = (pts: number[]) => {
      line(c, pts, 'rgba(160,230,255,0.55)', 3);
      line(c, pts, '#ffffff', 1, 'butt');
    };
    bolt([6, 18, 11, 24, 8, 28, 14, 33]);
    bolt([38, 14, 33, 20, 36, 23, 30, 29]);
    bolt([24, 8, 20, 14, 23, 17]);
    rect(c, 3, 10, 1, 1, '#dff6ff');
    rect(c, 41, 20, 1, 1, '#dff6ff');
  });

  canvasTex(scene, 'node_shadow_fungus', 28, 30, (c) => {
    groundShadow(c, 14, 26, 11, 3);
    glow(c, 14, 20, 14, '#a060ff', 0.45);
    outlined(c, 28, 30, OUTLINE, (b) => {
      const sh = (x: number, y: number, rx: number, ry: number, stemH: number) => {
        rect(b, x - 1, y, 3, stemH, '#c8b8e8');
        b.fillStyle = '#3a2458';
        b.beginPath();
        b.ellipse(x, y, rx, ry, 0, Math.PI, 0);
        b.fill();
        ellipse(b, x, y, rx, ry * 0.35, '#b07aff');
        ellipse(b, x - rx * 0.3, y - ry * 0.55, rx * 0.35, ry * 0.25, '#5a3a8a');
        rect(b, Math.round(x + rx * 0.2), Math.round(y - ry * 0.6), 1, 1, '#d8b8ff');
      };
      sh(18, 16, 6, 5, 10);
      sh(9, 20, 5, 4, 6);
      sh(22, 23, 3, 2.5, 3);
    });
    for (const [x, y] of [
      [5, 9],
      [24, 6],
      [13, 4],
    ])
      rect(c, x, y, 1, 1, '#e0c8ff');
  });

  canvasTex(scene, 'node_sun_spring', 40, 36, (c) => {
    groundShadow(c, 20, 31, 18, 4);
    for (const x of [13, 20, 27]) {
      const g = c.createLinearGradient(0, 2, 0, 26);
      g.addColorStop(0, 'rgba(255,230,140,0)');
      g.addColorStop(1, 'rgba(255,230,140,0.45)');
      c.fillStyle = g;
      c.fillRect(x - 2, 2, 4, 24);
    }
    glow(c, 20, 24, 16, '#ffd860', 0.45);
    outlined(c, 40, 36, OUTLINE, (b) => {
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        const x = 20 + Math.cos(a) * 15;
        const y = 25 + Math.sin(a) * 6;
        ellipse(b, x, y, 3.5, 2.6, i % 2 ? '#a39d92' : '#b8b2a6');
        rect(b, Math.round(x - 1), Math.round(y - 2), 2, 1, '#d0cabe');
      }
      ellipse(b, 20, 25, 12, 4.5, '#e8a830');
      ellipse(b, 20, 24.5, 10, 3.5, '#ffd860');
      ellipse(b, 17, 24, 4, 1.2, '#fff4b0');
      for (let i = 6; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        if (Math.sin(a) < 0.2) continue;
        const x = 20 + Math.cos(a) * 15;
        const y = 25 + Math.sin(a) * 6;
        ellipse(b, x, y, 3.5, 2.6, i % 2 ? '#a39d92' : '#b8b2a6');
      }
    });
    for (const [x, y] of [
      [10, 12],
      [30, 9],
      [21, 5],
    ]) {
      rect(c, x, y - 1, 1, 3, '#fff4c0');
      rect(c, x - 1, y, 3, 1, '#fff4c0');
    }
  });

  canvasTex(scene, 'node_frost_crystal', 28, 40, (c) => {
    groundShadow(c, 14, 36, 11, 3);
    glow(c, 14, 26, 14, '#c8f0ff', 0.4);
    outlined(c, 28, 40, OUTLINE, (b) => {
      ellipse(b, 14, 35, 11, 3, '#eef6ff');
      const shard = (x: number, base: number, top: number, w: number, lean: number) => {
        poly(b, [x - w, base, x - w + lean, top + w, x + lean, top, x, base + 1], '#e8f8ff');
        poly(b, [x, base + 1, x + lean, top, x + w + lean, top + w, x + w, base], '#8cc8e8');
        line(b, [x - w + 1, base - 2, x - w + 1 + lean, top + w + 1], '#ffffff', 1, 'butt');
      };
      shard(8, 34, 18, 3, -3);
      shard(20, 34, 16, 3, 3);
      shard(14, 35, 4, 4, 0);
    });
    rect(c, 12, 12, 1, 1, '#ffffff');
    rect(c, 3, 10, 1, 1, '#e8fbff');
    rect(c, 25, 14, 1, 1, '#e8fbff');
  });

  canvasTex(scene, 'node_depleted', 32, 22, (c) => {
    groundShadow(c, 16, 16, 13, 3.5, 0.2);
    ellipse(c, 16, 15, 12, 4, '#6e6458');
    ellipse(c, 16, 14, 10, 3, '#857a6c');
    for (const [x, y] of [
      [8, 13],
      [13, 11],
      [20, 12],
      [24, 15],
      [11, 16],
      [18, 16],
    ]) {
      rect(c, x, y, 3, 2, '#8d887f');
      rect(c, x, y, 2, 1, '#aaa59c');
      rect(c, x, y + 2, 3, 1, '#4e4840');
    }
    rect(c, 15, 6, 1, 6, '#6b4423');
    rect(c, 15, 6, 3, 1, '#6b4423');
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
  // White chevrons pointing NORTH (up); the client rotates by facing (e 90°, s 180°, w 270°) and tints.
  canvasTex(scene, 'portal_edge', 32, 32, (c) => {
    glow(c, 16, 16, 16, '#ffffff', 0.28);
    const chev = (y: number, a: number) => {
      poly(c, [4, y + 9, 16, y, 28, y + 9, 28, y + 13, 16, y + 4, 4, y + 13], `rgba(0,0,0,${a * 0.25})`);
      poly(c, [4, y + 8, 16, y - 1, 28, y + 8, 28, y + 12, 16, y + 3, 4, y + 12], `rgba(255,255,255,${a})`);
    };
    chev(5, 0.95);
    chev(16, 0.6);
  });

  // Dungeon entrance carved into a rock face (origin bottom-centre).
  canvasTex(scene, 'portal_door', 64, 64, (c) => {
    groundShadow(c, 32, 58, 30, 5, 0.3);
    outlined(c, 64, 64, OUTLINE, (b) => {
      const rock = '#857868';
      poly(b, [2, 60, 3, 34, 8, 18, 18, 8, 32, 4, 46, 8, 56, 18, 61, 34, 62, 60], shade(rock, -30));
      poly(b, [4, 40, 9, 20, 19, 10, 32, 6, 45, 10, 55, 20, 60, 40, 48, 30, 32, 26, 16, 30], rock);
      poly(b, [9, 20, 19, 10, 32, 6, 45, 10, 36, 12, 22, 15], shade(rock, 24));
      for (const [x, y, w] of [
        [8, 44, 8],
        [50, 40, 9],
        [12, 30, 6],
        [44, 26, 7],
      ] as const) {
        rect(b, x, y, w, 1, shade(rock, -50));
        rect(b, x, y + 1, w, 1, shade(rock, 10));
      }
      // opening
      poly(b, [19, 61, 19, 36, 24, 28, 32, 26, 40, 28, 45, 36, 45, 61], '#0e0b0a');
      poly(b, [21, 61, 21, 38, 25, 31, 32, 29, 32, 61], '#1a1412');
      // timber frame
      rect(b, 17, 32, 4, 29, '#6b4423');
      rect(b, 43, 32, 4, 29, '#5a3a1e');
      rect(b, 15, 29, 34, 4, '#7a5230');
      rect(b, 15, 29, 34, 1, '#9a7048');
      rect(b, 19, 33, 1, 27, '#8a6238');
      // threshold
      rect(b, 16, 60, 32, 3, '#6e665c');
    });
    for (const x of [10, 54]) {
      glow(c, x, 36, 9, '#ffb050', 0.55);
      rect(c, x - 1, 38, 2, 7, '#5a3a1e');
      flame(c, x, 38, 7);
    }
  });

  // Hole in the floor with steps descending north into darkness.
  canvasTex(scene, 'portal_stairs_down', 32, 32, (c) => {
    rect(c, 2, 2, 28, 28, '#6e6860');
    rect(c, 2, 2, 28, 2, '#8d877e');
    rect(c, 2, 2, 2, 28, '#827c73');
    rect(c, 28, 2, 2, 28, '#57524b');
    const steps = 5;
    for (let i = 0; i < steps; i++) {
      const y = 25 - i * 4.4;
      const t = i / (steps - 1);
      const tread = mix('#9a948a', '#1a1716', t);
      rect(c, 5, Math.round(y), 22, 4, tread);
      rect(c, 5, Math.round(y), 22, 1, shade(tread, 18));
      rect(c, 5, Math.round(y) + 3, 22, 1, shade(tread, -30));
    }
    vgrad(c, 5, 4, 22, 6, 'rgba(0,0,0,0.85)', 'rgba(0,0,0,0)');
    rect(c, 4, 4, 1, 25, '#3a3632');
    rect(c, 27, 4, 1, 25, '#2a2724');
    rect(c, 2, 29, 28, 2, '#57524b');
  });

  // Staircase rising north into a lit archway.
  canvasTex(scene, 'portal_stairs_up', 32, 40, (c) => {
    groundShadow(c, 16, 37, 15, 3, 0.25);
    glow(c, 16, 8, 14, '#fff2c0', 0.55);
    outlined(c, 32, 40, OUTLINE, (b) => {
      // stone surround
      rect(b, 2, 6, 28, 33, '#6e6860');
      rect(b, 2, 6, 5, 33, '#8d877e');
      rect(b, 2, 6, 1, 33, '#a39d92');
      rect(b, 25, 6, 5, 33, '#57524b');
      b.fillStyle = '#7d776e';
      b.beginPath();
      b.arc(16, 12, 14, Math.PI, 0);
      b.fill();
      // lit arch opening
      b.fillStyle = '#fff2c0';
      b.beginPath();
      b.arc(16, 12, 8, Math.PI, 0);
      b.fill();
      rect(b, 8, 12, 16, 4, '#ffe6a0');
      // steps narrowing as they climb
      const steps = 6;
      for (let i = 0; i < steps; i++) {
        const t = i / (steps - 1);
        const y = Math.round(34 - i * 3.6);
        const hw = Math.round(9 - t * 2);
        const tread = mix('#8a847a', '#d8d0b8', t);
        rect(b, 16 - hw, y + 1, hw * 2, 3, shade(tread, -40));
        rect(b, 16 - hw, y - 1, hw * 2, 2, tread);
        rect(b, 16 - hw, y - 1, hw * 2, 1, shade(tread, 22));
      }
      // inner side walls
      poly(b, [7, 38, 7, 16, 9, 16, 7, 38], '#4a453f');
      poly(b, [25, 38, 25, 16, 23, 16, 25, 38], '#3a3632');
      rect(b, 2, 37, 28, 2, '#57524b');
    });
  });

  // Prism Gate: stone arch with 7 empty sockets. The opening is left transparent so the client can
  // draw its own barrier/portal effect behind or inside it.
  canvasTex(scene, 'gate_prism', PRISM_GATE_SIZE.w, PRISM_GATE_SIZE.h, (c) => {
    groundShadow(c, 48, 106, 46, 6, 0.32);
    outlined(c, 96, 112, OUTLINE, (b) => {
      const st = '#a8a2b4';
      // plinths
      for (const x of [4, 70]) {
        rect(b, x, 96, 22, 12, shade(st, -30));
        rect(b, x, 94, 22, 4, shade(st, 6));
        rect(b, x, 94, 22, 1, shade(st, 24));
      }
      // pillars
      for (const x of [8, 72]) {
        rect(b, x, 46, 16, 49, st);
        rect(b, x + 11, 46, 5, 49, shade(st, -28));
        rect(b, x, 46, 2, 49, shade(st, 18));
        for (let y = 56; y < 94; y += 10) rect(b, x, y, 16, 1, shade(st, -36));
        poly(b, [x + 8, 64, x + 11, 70, x + 8, 76, x + 5, 70], '#6a5a8a');
        poly(b, [x + 8, 66, x + 9.5, 70, x + 8, 74, x + 6.5, 70], '#9a8ac0');
      }
      // arch ring (voussoirs)
      const cx = 48;
      const cy = 48;
      const R1 = 42;
      const R0 = 26;
      b.fillStyle = st;
      b.beginPath();
      b.arc(cx, cy, R1, Math.PI, 0);
      b.lineTo(cx + R0, cy);
      b.arc(cx, cy, R0, 0, Math.PI, true);
      b.closePath();
      b.fill();
      b.fillStyle = shade(st, 20);
      b.beginPath();
      b.arc(cx, cy, R1, Math.PI, Math.PI * 1.5);
      b.arc(cx, cy, R1 - 3, Math.PI * 1.5, Math.PI, true);
      b.closePath();
      b.fill();
      b.fillStyle = shade(st, -30);
      b.beginPath();
      b.arc(cx, cy, R0 + 3, Math.PI, 0);
      b.arc(cx, cy, R0, 0, Math.PI, true);
      b.closePath();
      b.fill();
      for (let i = 0; i <= 8; i++) {
        const a = Math.PI + (i * Math.PI) / 8;
        line(b, [cx + Math.cos(a) * R0, cy + Math.sin(a) * R0, cx + Math.cos(a) * R1, cy + Math.sin(a) * R1], shade(st, -40), 1, 'butt');
      }
      // keystone
      poly(b, [41, 4, 55, 4, 53, 22, 43, 22], shade(st, 10));
      poly(b, [41, 4, 55, 4, 54, 6, 42, 6], shade(st, 30));
      poly(b, [48, 9, 51, 13, 48, 17, 45, 13], '#e8e0ff');
      // empty sockets
      for (const [x, y] of PRISM_SOCKETS) {
        ellipse(b, x, y, 5, 5, shade(st, -48));
        ellipse(b, x, y + 0.5, 4, 4, '#2a2436');
        ellipse(b, x - 1, y - 1, 1.6, 1.4, '#4a405e');
      }
    });
  });

  canvasTex(scene, 'gate_socket', 12, 12, (c) => {
    glow(c, 6, 6, 6, '#ffffff', 0.5);
    poly(c, [6, 1, 10, 4, 10, 8, 6, 11, 2, 8, 2, 4], '#c8c8d0');
    poly(c, [6, 1, 10, 4, 6, 6, 2, 4], '#ffffff');
    poly(c, [2, 4, 6, 6, 6, 11, 2, 8], '#e6e6ee');
    poly(c, [10, 4, 10, 8, 6, 11, 6, 6], '#9a9aa6');
    rect(c, 4, 3, 1, 1, '#ffffff');
  });

  // ---- hidden-portal blockers
  canvasTex(scene, 'hide_shimmer', 40, 48, (c) => {
    const g = c.createRadialGradient(20, 26, 2, 20, 26, 20);
    g.addColorStop(0, 'rgba(255,255,255,0.28)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 40, 48);
    for (let i = 0; i < 6; i++) {
      const x0 = 8 + i * 5;
      const pts: number[] = [];
      for (let y = 6 + (i % 2) * 4; y <= 44 - (i % 3) * 3; y += 2) pts.push(x0 + Math.sin(y * 0.35 + i) * 2, y);
      line(c, pts, `rgba(255,255,255,${0.25 + (i % 2) * 0.2})`, 1, 'butt');
    }
    for (const [x, y] of [
      [12, 12],
      [27, 18],
      [17, 34],
      [31, 38],
      [8, 28],
    ]) {
      rect(c, x, y - 1, 1, 3, 'rgba(255,255,255,0.9)');
      rect(c, x - 1, y, 3, 1, 'rgba(255,255,255,0.9)');
    }
  });

  canvasTex(scene, 'hide_cracked_rock', 48, 44, (c) => {
    groundShadow(c, 24, 38, 21, 5);
    outlined(c, 48, 44, OUTLINE, (b) => {
      const st = '#8f877c';
      poly(b, [3, 37, 5, 18, 14, 6, 28, 3, 40, 9, 45, 24, 44, 37, 34, 41, 14, 41], shade(st, -34));
      poly(b, [6, 30, 8, 18, 15, 9, 28, 6, 38, 11, 41, 22, 36, 29, 20, 32], st);
      poly(b, [8, 18, 15, 9, 28, 6, 38, 11, 26, 13, 16, 15], shade(st, 22));
      const crack = (pts: number[]) => {
        line(b, pts, '#2a241f', 2, 'butt');
        b.save();
        b.translate(1, 1);
        line(b, pts, shade(st, 30), 1, 'butt');
        b.restore();
      };
      crack([24, 6, 21, 14, 26, 20, 22, 28, 25, 38]);
      crack([21, 14, 13, 18, 10, 26]);
      crack([26, 20, 34, 22, 40, 30]);
      crack([22, 28, 16, 34]);
    });
    for (const [x, y] of [
      [6, 39],
      [40, 40],
      [33, 41],
    ]) {
      rect(c, x, y, 3, 2, '#7a7268');
      rect(c, x, y, 2, 1, '#a39b90');
    }
  });

  canvasTex(scene, 'hide_brambles', 48, 40, (c) => {
    const rnd = mulberry32(421);
    groundShadow(c, 24, 35, 21, 4);
    outlined(c, 48, 40, OUTLINE, (b) => {
      ellipse(b, 24, 25, 21, 12, '#2c3a22');
      for (let i = 0; i < 14; i++) {
        const x0 = 4 + rnd() * 40;
        const y0 = 34 - rnd() * 6;
        const pts = [x0, y0];
        let x = x0;
        let y = y0;
        for (let s = 0; s < 4; s++) {
          x += (rnd() - 0.5) * 14;
          y -= 4 + rnd() * 5;
          pts.push(Math.max(2, Math.min(46, x)), Math.max(4, y));
        }
        line(b, pts, i % 2 ? '#5a4a2a' : '#4a5a2a', 2);
        for (let p = 2; p < pts.length; p += 2) {
          rect(b, Math.round(pts[p]) + 1, Math.round(pts[p + 1]) - 1, 2, 1, '#c8b890');
          rect(b, Math.round(pts[p]) - 2, Math.round(pts[p + 1]) + 1, 2, 1, '#c8b890');
        }
      }
      for (let i = 0; i < 9; i++) {
        const x = 6 + rnd() * 36;
        const y = 10 + rnd() * 22;
        ellipse(b, x, y, 3, 2, i % 2 ? '#3f6a2e' : '#4f7a36');
      }
      for (const [x, y] of [
        [14, 18],
        [31, 14],
        [36, 26],
      ]) {
        rect(b, x, y, 2, 2, '#7a2a5a');
        rect(b, x, y, 1, 1, '#c86aa0');
      }
    });
  });

  canvasTex(scene, 'hide_fog', 64, 48, (c) => {
    for (const [x, y, rx, ry, a] of [
      [32, 30, 30, 14, 0.25],
      [20, 26, 16, 11, 0.35],
      [44, 24, 18, 12, 0.35],
      [32, 18, 14, 10, 0.4],
      [14, 34, 12, 7, 0.3],
      [50, 34, 12, 7, 0.3],
      [28, 24, 8, 5, 0.35],
    ] as const) {
      const g = c.createRadialGradient(x, y, 0, x, y, rx);
      g.addColorStop(0, `rgba(236,240,248,${a})`);
      g.addColorStop(0.7, `rgba(236,240,248,${a * 0.6})`);
      g.addColorStop(1, 'rgba(236,240,248,0)');
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
      c.fill();
    }
  });

  canvasTex(scene, 'hide_glyph', 32, 32, (c) => {
    const col = 'rgba(200,170,255,0.75)';
    glow(c, 16, 16, 16, '#b08cff', 0.22);
    c.strokeStyle = col;
    c.lineWidth = 1;
    c.beginPath();
    c.ellipse(16, 16, 13, 10, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.ellipse(16, 16, 9, 7, 0, 0, Math.PI * 2);
    c.stroke();
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      const x = 16 + Math.cos(a) * 11;
      const y = 16 + Math.sin(a) * 8.5;
      rect(c, Math.round(x) - 1, Math.round(y) - 1, 2, 2, col);
    }
    line(c, [16, 10, 20, 18, 12, 18, 16, 10], col, 1, 'butt');
    rect(c, 15, 15, 2, 2, 'rgba(235,225,255,0.9)');
  });
}

/** Draw every world texture (tiles, props, structures, objects, nodes, portals). */
export function drawWorld(scene: Phaser.Scene): void {
  drawTiles(scene);
  drawProps(scene);
  drawStructures(scene);
  drawObjects(scene);
  drawNodes(scene);
  drawPortals(scene);
}
