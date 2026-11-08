import type Phaser from 'phaser';
import { mulberry32 } from '../../core/rng';
import { T, TILE_COUNT } from '../../core/world/tiles';
import {
  type Ctx,
  canvasTex,
  canvasTexAll,
  ellipse,
  glow,
  groundShadow,
  line,
  mix,
  outlined,
  poly,
  rect,
  rgba,
  scratch,
  shade,
  vgrad,
} from './common';

// World art: tileset atlas, props, structures, objects, gather nodes, portals and hidden-portal blockers.
// Every texture key here is a contract with the client (see docs/SPEC-v2.md §7 and src/core/world/types.ts).

const TILE = 32;

/** Tiles are drawn edge-to-edge, then copied into an atlas with 1px extruded borders
 *  so fractional camera zoom never samples a neighbouring tile (no seams). */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;

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

// ================================================================== props
// Origin bottom-centre: the client anchors (0.5, 1) at the tile's bottom edge.

type Blob = readonly [number, number, number];

/** Cloud-like foliage: dark underside, body, top-left highlights, leaf texture. */
function canopy(c: Ctx, blobs: readonly Blob[], leaf: string, rnd: () => number, hiAmt = 26): void {
  for (const [x, y, r] of blobs) ellipse(c, x, y + 2, r, r * 0.92, shade(leaf, -42));
  for (const [x, y, r] of blobs) ellipse(c, x, y, r - 1, (r - 1) * 0.9, leaf);
  for (const [x, y, r] of blobs) ellipse(c, x - r * 0.28, y - r * 0.32, r * 0.5, r * 0.4, shade(leaf, hiAmt));
  for (const [x, y, r] of blobs) {
    for (let i = 0; i < 3; i++) {
      const a = rnd() * Math.PI * 2;
      const d = rnd() * r * 0.7;
      rect(c, Math.round(x + Math.cos(a) * d), Math.round(y + Math.sin(a) * d * 0.8), 2, 1, shade(leaf, -24));
    }
    rect(c, Math.round(x - r * 0.4), Math.round(y - r * 0.5), 1, 1, shade(leaf, hiAmt + 26));
  }
}

function trunk(c: Ctx, cx: number, top: number, base: number, w: number, bark: string): void {
  poly(c, [cx - w / 2 - 3, base, cx - w / 2, base - 5, cx - w / 2, top, cx + w / 2, top, cx + w / 2, base - 5, cx + w / 2 + 3, base], bark);
  rect(c, cx + w / 2 - 3, top, 3, base - top - 1, shade(bark, -24));
  rect(c, cx - w / 2 + 1, top + 3, 1, base - top - 8, shade(bark, 18));
  rect(c, cx - 1, top + 6, 1, 4, shade(bark, -18));
  rect(c, cx + 1, base - 10, 1, 3, shade(bark, -18));
}

function broadTree(scene: Phaser.Scene, key: string, leaf: string, bark: string, seed: number, extra?: (c: Ctx) => void): void {
  canvasTex(scene, key, 48, 64, (c) => {
    const rnd = mulberry32(seed);
    groundShadow(c, 24, 58, 16, 4.5);
    outlined(c, 48, 64, OUTLINE, (b) => {
      trunk(b, 24, 34, 59, 8, bark);
      canopy(
        b,
        [
          [14, 32, 10],
          [34, 32, 10],
          [24, 34, 11],
          [17, 21, 11],
          [31, 21, 11],
          [24, 12, 10],
        ],
        leaf,
        rnd,
      );
      extra?.(b);
    });
  });
}

function pineTree(scene: Phaser.Scene, key: string, needle: string, snow: boolean): void {
  canvasTex(scene, key, 40, 64, (c) => {
    groundShadow(c, 20, 59, 13, 4);
    if (snow) ellipse(c, 20, 58, 11, 3, 'rgba(240,248,255,0.85)');
    outlined(c, 40, 64, OUTLINE, (b) => {
      rect(b, 17, 46, 6, 13, '#5c3b1e');
      rect(b, 20, 46, 3, 13, '#472d16');
      const tier = (y: number, hw: number, h: number, col: string) => {
        const pts: number[] = [20, y];
        const teeth = 4;
        for (let i = 0; i <= teeth * 2; i++) {
          const t = i / (teeth * 2);
          const x = 20 + hw - t * hw * 2;
          pts.push(x, y + h - (i % 2 ? 3 : 0));
        }
        poly(b, pts, col);
        // shaded right half
        const rp: number[] = [20, y];
        for (let i = 0; i <= teeth; i++) {
          const t = i / (teeth * 2);
          rp.push(20 + hw - t * hw * 2, y + h - (i % 2 ? 3 : 0));
        }
        poly(b, rp, shade(col, -22));
        line(b, [20, y + 2, 20 - hw * 0.55, y + h - 4], shade(col, 26), 1, 'butt');
        if (snow) {
          poly(b, [20, y, 20 - hw * 0.62, y + h * 0.62, 20 - hw * 0.3, y + h * 0.5, 20 - hw * 0.05, y + h * 0.58, 20 + hw * 0.25, y + h * 0.42, 20 + hw * 0.5, y + h * 0.5], '#eef6ff');
          poly(b, [20, y, 20 + hw * 0.25, y + h * 0.42, 20 + hw * 0.5, y + h * 0.5, 20 + hw * 0.12, y + h * 0.2], '#c9dcef');
          rect(b, Math.round(20 - hw) + 1, y + h - 2, 3, 1, '#e3eefa');
        }
      };
      tier(26, 17, 22, needle);
      tier(14, 13, 18, shade(needle, 8));
      tier(3, 9, 15, shade(needle, 16));
    });
  });
}

function drawProps(scene: Phaser.Scene): void {
  broadTree(scene, 'tree', '#3f8a3a', '#6b4423', 11);
  broadTree(scene, 'darktree', '#4a3d6b', '#3a2e2a', 12, (b) => {
    for (const [x, y] of [
      [15, 30],
      [31, 18],
      [26, 33],
    ])
      rect(b, x, y, 1, 1, '#d7b8ff');
  });
  pineTree(scene, 'pine', '#2f6b3a', false);
  pineTree(scene, 'frostpine', '#2f5f6a', true);

  canvasTex(scene, 'deadtree', 40, 56, (c) => {
    groundShadow(c, 20, 51, 12, 4);
    outlined(c, 40, 56, OUTLINE, (b) => {
      poly(b, [15, 52, 18, 46, 18, 22, 22, 22, 22, 46, 25, 52], '#4a3a30');
      rect(b, 20, 24, 2, 26, '#3a2c24');
      line(b, [19, 34, 11, 24, 8, 14], '#4a3a30', 4);
      line(b, [21, 28, 29, 18, 31, 8], '#4a3a30', 4);
      line(b, [20, 24, 19, 12], '#4a3a30', 3);
      line(b, [11, 24, 4, 21], '#4a3a30', 2);
      line(b, [29, 18, 36, 16], '#4a3a30', 2);
      line(b, [8, 14, 5, 7], '#4a3a30', 2);
      line(b, [31, 8, 34, 3], '#4a3a30', 2);
      line(b, [19, 12, 22, 5], '#4a3a30', 2);
      line(b, [17, 30, 12, 22], '#62503f', 1);
      line(b, [20, 26, 27, 17], '#62503f', 1);
    });
  });

  canvasTex(scene, 'bush', 32, 28, (c) => {
    const rnd = mulberry32(14);
    groundShadow(c, 16, 24, 12, 3);
    outlined(c, 32, 28, OUTLINE, (b) => {
      canopy(
        b,
        [
          [10, 17, 7],
          [22, 17, 7],
          [16, 12, 7],
        ],
        '#3f8a37',
        rnd,
      );
      for (const [x, y] of [
        [9, 17],
        [20, 19],
        [17, 10],
        [24, 14],
      ]) {
        rect(b, x, y, 2, 2, '#e04848');
        rect(b, x, y, 1, 1, '#ff9a9a');
      }
    });
  });

  const rockShape = (b: Ctx, base: string, ox: number, oy: number, s: number) => {
    const P = (pts: number[]) => pts.map((v, i) => (i % 2 ? oy + v * s : ox + v * s));
    poly(b, P([0, 20, 3, 7, 13, 0, 25, 4, 29, 20, 22, 23, 8, 23]), shade(base, -34));
    poly(b, P([3, 15, 5, 7, 13, 2, 24, 6, 25, 13, 16, 16]), base);
    poly(b, P([5, 7, 13, 2, 24, 6, 17, 8]), shade(base, 22));
    line(b, P([16, 16, 18, 21]), shade(base, -50), 1, 'butt');
    line(b, P([25, 13, 27, 19]), shade(base, -14), 1, 'butt');
  };
  canvasTex(scene, 'rock', 34, 30, (c) => {
    groundShadow(c, 17, 25, 14, 4);
    outlined(c, 34, 30, OUTLINE, (b) => rockShape(b, '#9a968f', 2, 3, 1));
  });
  canvasTex(scene, 'boulder', 48, 40, (c) => {
    groundShadow(c, 24, 34, 21, 5);
    outlined(c, 48, 40, OUTLINE, (b) => {
      rockShape(b, '#8f8a82', 2, 2, 1.3);
      rockShape(b, '#9d9890', 30, 22, 0.55);
      ellipse(b, 18, 7, 7, 2.5, '#5d8a46');
      ellipse(b, 15, 6, 3, 1.2, '#78a85a');
    });
  });

  canvasTex(scene, 'crystal', 32, 44, (c) => {
    groundShadow(c, 16, 40, 12, 3.5);
    glow(c, 16, 32, 16, '#7fe0ff', 0.35);
    outlined(c, 32, 44, OUTLINE, (b) => {
      const shard = (x: number, base: number, top: number, w: number, lit: string, dark: string) => {
        poly(b, [x - w, base, x - w, top + w * 1.3, x, top, x, base + 1], lit);
        poly(b, [x, base + 1, x, top, x + w, top + w * 1.3, x + w, base], dark);
        line(b, [x - w + 1, base - 2, x - w + 1, top + w * 1.3 + 1], shade(lit, 40), 1, 'butt');
      };
      shard(9, 39, 18, 4, '#b8a0ff', '#7a5cd0');
      shard(23, 39, 14, 4, '#9ff0ff', '#4ab0e0');
      shard(16, 40, 4, 5, '#c8f8ff', '#5ac4ec');
      rect(b, 4, 38, 24, 3, '#6a6a7a');
      rect(b, 4, 38, 24, 1, '#86869a');
    });
    rect(c, 13, 9, 1, 1, '#ffffff');
    rect(c, 21, 19, 1, 1, '#ffffff');
  });

  canvasTex(scene, 'stalagmite', 28, 44, (c) => {
    groundShadow(c, 14, 40, 11, 3.5);
    outlined(c, 28, 44, OUTLINE, (b) => {
      const cone = (x: number, base: number, top: number, w: number, col: string) => {
        poly(b, [x - w, base, x - 1, top, x + 1, top, x + w, base], col);
        poly(b, [x, top, x + 1, top, x + w, base, x + 1, base], shade(col, -26));
        for (let y = base - 6; y > top + 6; y -= 7) {
          const t = (y - top) / (base - top);
          rect(b, Math.round(x - w * t), y, Math.round(w * t * 2), 1, shade(col, -16));
        }
        line(b, [x - w * 0.55, base - 2, x - 1, top + 4], shade(col, 22), 1, 'butt');
      };
      cone(19, 40, 18, 6, '#7d7064');
      cone(11, 41, 3, 8, '#8a7c6e');
    });
  });

  canvasTex(scene, 'tombstone', 28, 36, (c) => {
    groundShadow(c, 14, 32, 11, 3);
    outlined(c, 28, 36, OUTLINE, (b) => {
      const slab = '#9c98a4';
      // side + top faces give it thickness
      b.fillStyle = shade(slab, -34);
      b.beginPath();
      b.moveTo(22, 32);
      b.lineTo(22, 13);
      b.arc(15, 13, 7, 0, Math.PI, true);
      b.lineTo(8, 32);
      b.fill();
      b.fillStyle = slab;
      b.beginPath();
      b.moveTo(20, 33);
      b.lineTo(20, 15);
      b.arc(13.5, 15, 6.5, 0, Math.PI, true);
      b.lineTo(7, 33);
      b.fill();
      rect(b, 8, 11, 1, 20, shade(slab, 18));
      // engraved diamond and epitaph lines
      poly(b, [13.5, 13, 16, 16, 13.5, 19, 11, 16], '#6a6672');
      poly(b, [13.5, 14.5, 14.5, 16, 13.5, 17.5, 12.5, 16], slab);
      rect(b, 10, 22, 7, 1, '#6a6672');
      rect(b, 10, 25, 7, 1, '#6a6672');
      rect(b, 11, 28, 5, 1, '#6a6672');
      line(b, [18, 10, 16, 14, 18, 17], '#77737f', 1, 'butt');
      // moss and grass at the foot
      ellipse(b, 9, 32, 3, 1.5, '#4d7a3e');
      rect(b, 17, 31, 4, 2, '#5a8a46');
      rect(b, 5, 31, 2, 2, '#5a8a46');
    });
  });

  canvasTex(scene, 'mushroom', 28, 30, (c) => {
    groundShadow(c, 14, 26, 11, 3);
    outlined(c, 28, 30, OUTLINE, (b) => {
      const shroom = (x: number, y: number, rx: number, ry: number, stemH: number, cap: string) => {
        rect(b, x - 2, y, 4, stemH, '#e8dcc0');
        rect(b, x + 1, y, 1, stemH, '#c9b998');
        ellipse(b, x, y + 1, rx, ry * 0.55, shade(cap, -50));
        b.fillStyle = cap;
        b.beginPath();
        b.ellipse(x, y, rx, ry, 0, Math.PI, 0);
        b.fill();
        ellipse(b, x - rx * 0.35, y - ry * 0.55, rx * 0.35, ry * 0.25, shade(cap, 34));
        rect(b, Math.round(x + rx * 0.3), Math.round(y - ry * 0.5), 2, 1, '#f6e6c8');
        rect(b, Math.round(x - rx * 0.1), Math.round(y - ry * 0.85), 1, 1, '#f6e6c8');
      };
      shroom(20, 18, 5, 4, 8, '#b5572e');
      shroom(11, 14, 8, 6, 12, '#c8642e');
      shroom(5, 22, 3, 2.5, 4, '#b5572e');
    });
  });

  canvasTex(scene, 'duskwillow', 56, 72, (c) => {
    const rnd = mulberry32(17);
    groundShadow(c, 28, 66, 20, 5);
    glow(c, 14, 46, 9, '#ffb0e8', 0.35);
    glow(c, 42, 42, 9, '#9fe8ff', 0.35);
    outlined(c, 56, 72, OUTLINE, (b) => {
      trunk(b, 28, 34, 67, 9, '#3e2a40');
      line(b, [26, 40, 18, 30], '#3e2a40', 3);
      line(b, [31, 38, 38, 28], '#3e2a40', 3);
      canopy(
        b,
        [
          [14, 26, 10],
          [42, 26, 10],
          [28, 24, 13],
          [20, 14, 10],
          [36, 14, 10],
          [28, 8, 8],
        ],
        '#4f4486',
        rnd,
        22,
      );
      // weeping strands
      for (let i = 0; i < 16; i++) {
        const x = 6 + i * 2.9;
        const top = 22 + Math.abs(i - 7.5) * 0.6;
        const len = 14 + ((i * 7) % 11) + (i === 0 || i === 15 ? -4 : 0);
        const col = i % 3 === 0 ? '#7b68b8' : i % 3 === 1 ? '#5c4f94' : '#6a5aa6';
        line(b, [x, top, x + (i < 8 ? -1 : 1), top + len], col, 2, 'butt');
        rect(b, Math.round(x + (i < 8 ? -1 : 1)) - 1, Math.round(top + len), 2, 2, i % 2 ? '#e8a0d8' : '#a8c8ff');
      }
      ellipse(b, 14, 46, 2.5, 3, '#ffd0f0');
      ellipse(b, 42, 42, 2.5, 3, '#c8f4ff');
      rect(b, 13, 45, 1, 1, '#ffffff');
      rect(b, 41, 41, 1, 1, '#ffffff');
    });
  });

  canvasTex(scene, 'basalt_spire', 32, 60, (c) => {
    groundShadow(c, 16, 55, 14, 4);
    glow(c, 16, 54, 12, '#ff6a20', 0.3);
    outlined(c, 32, 60, OUTLINE, (b) => {
      const col = (x: number, top: number, base: number, w: number) => {
        const side = '#38353c';
        rect(b, x, top + 3, w / 2, base - top - 3, shade(side, 12));
        rect(b, x + w / 2, top + 3, w / 2, base - top - 3, shade(side, -12));
        rect(b, x, top + 3, 1, base - top - 3, shade(side, 30));
        poly(b, [x, top + 3, x + w * 0.25, top, x + w * 0.75, top, x + w, top + 3, x + w * 0.75, top + 6, x + w * 0.25, top + 6], '#5a5660');
        rect(b, x + w * 0.25, top, w * 0.5, 1, '#77727e');
        for (let y = top + 12; y < base - 4; y += 9) rect(b, x + 1, y, w - 2, 1, shade(side, -24));
      };
      col(14, 4, 54, 10);
      col(4, 18, 55, 10);
      col(22, 26, 56, 9);
      line(b, [8, 55, 10, 50, 9, 46], '#ff7a2a', 1, 'butt');
      line(b, [25, 56, 27, 51], '#ff7a2a', 1, 'butt');
      rect(b, 9, 50, 1, 1, '#ffd27a');
    });
  });

  canvasTex(scene, 'reeds', 28, 34, (c) => {
    groundShadow(c, 14, 30, 10, 2.5);
    outlined(c, 28, 34, OUTLINE, (b) => {
      const blades: [number, number, number, string][] = [
        [6, 30, -3, '#5a8a3a'],
        [9, 30, 1, '#6fa048'],
        [12, 31, -1, '#4f7a32'],
        [15, 31, 2, '#6fa048'],
        [18, 30, 4, '#5a8a3a'],
        [21, 30, 2, '#78ac50'],
        [11, 31, -5, '#78ac50'],
      ];
      for (const [x, base, lean, col] of blades) line(b, [x, base, x + lean * 0.4, base - 12, x + lean, base - 18 - (x % 4)], col, 2, 'butt');
      line(b, [13, 31, 13, 6], '#5d7a34', 1, 'butt');
      line(b, [17, 31, 18, 3], '#5d7a34', 1, 'butt');
      rect(b, 12, 6, 3, 7, '#6b4423');
      rect(b, 12, 6, 1, 7, '#8a5a30');
      rect(b, 17, 3, 3, 7, '#6b4423');
      rect(b, 17, 3, 1, 7, '#8a5a30');
    });
  });
}

// ================================================================== structures
// Width = footprint x 32. The client anchors (0.5, 1) at the footprint's bottom edge + 4px,
// so the front wall stands on the southern row and roofs overhang upward.

type RoofStyle = 'tile' | 'slate' | 'thatch' | 'shingle';

/** Side-gabled roof seen from the front: back slope sliver, front slope with courses, ridge cap, eave. */
function roofFront(c: Ctx, x0: number, x1: number, ridge: number, eave: number, inset: number, color: string, style: RoofStyle, rnd: () => number): void {
  const dark = shade(color, -34);
  const lite = shade(color, 18);
  poly(c, [x0 + inset + 3, ridge + 1, x0 + inset + 8, ridge - 4, x1 - inset - 8, ridge - 4, x1 - inset - 3, ridge + 1], shade(color, -52));
  poly(c, [x0 + inset, ridge, x1 - inset, ridge, x1, eave, x0, eave], color);
  const span = (y: number): [number, number] => {
    const t = (y - ridge) / (eave - ridge);
    return [Math.round(x0 + inset * (1 - t)), Math.round(x1 - inset * (1 - t))];
  };
  const step = style === 'thatch' ? 6 : style === 'slate' ? 5 : 6;
  let row = 0;
  for (let y = ridge + step; y < eave - 2; y += step, row++) {
    const [xl, xr] = span(y);
    if (style === 'thatch') {
      for (let x = xl + 1; x < xr - 1; x += 2) {
        const len = 3 + ri(rnd, 4);
        rect(c, x, y - len + 2, 1, len, rnd() < 0.5 ? dark : lite);
      }
      rect(c, xl, y + 1, xr - xl, 1, shade(color, -22));
    } else {
      rect(c, xl, y, xr - xl, 1, dark);
      rect(c, xl, y + 1, xr - xl, 1, lite);
      const tick = style === 'slate' ? 7 : style === 'shingle' ? 5 : 8;
      for (let x = xl + ((row % 2) * tick) / 2 + 2; x < xr - 2; x += tick) rect(c, Math.round(x), y + 2, 1, step - 2, shade(color, -20));
      if (style === 'tile') for (let x = xl + ((row % 2) * tick) / 2 + 5; x < xr - 2; x += tick) rect(c, Math.round(x), y + 2, 2, 1, shade(color, 26));
    }
  }
  line(c, [x0 + inset, ridge, x0, eave], shade(color, 24), 2, 'butt');
  line(c, [x1 - inset, ridge, x1, eave], shade(color, -50), 2, 'butt');
  rect(c, x0 + inset - 1, ridge - 2, x1 - x0 - inset * 2 + 2, 3, shade(color, -40));
  rect(c, x0 + inset - 1, ridge - 2, x1 - x0 - inset * 2 + 2, 1, shade(color, 6));
  rect(c, x0, eave - 2, x1 - x0, 2, shade(color, -46));
  if (style === 'thatch') for (let x = x0 + 1; x < x1 - 1; x += 3) rect(c, x, eave - 1, 2, 2 + ri(rnd, 2), shade(color, -30));
}

type WallKind = 'plaster' | 'stone' | 'plank' | 'log';

function wallFace(c: Ctx, x: number, y: number, w: number, h: number, color: string, kind: WallKind, rnd: () => number): void {
  rect(c, x, y, w, h, color);
  switch (kind) {
    case 'plaster': {
      for (let i = 0; i < (w * h) / 40; i++) rect(c, x + ri(rnd, w), y + ri(rnd, h), 1, 1, shade(color, rnd() < 0.5 ? -12 : 8));
      const beam = '#6a4a2e';
      rect(c, x, y, w, 3, beam);
      rect(c, x, y + h - 9, w, 2, beam);
      for (let bx = x; bx <= x + w - 3; bx += Math.max(18, Math.floor(w / Math.round(w / 26)))) rect(c, bx, y, 3, h - 7, beam);
      rect(c, x + w - 3, y, 3, h - 7, beam);
      break;
    }
    case 'stone': {
      for (let yy = y, r = 0; yy < y + h; yy += 6, r++) {
        rect(c, x, yy, w, 1, shade(color, -26));
        for (let xx = x + (r % 2 ? 5 : 0); xx < x + w; xx += 10) rect(c, xx, yy, 1, 6, shade(color, -26));
        for (let xx = x + (r % 2 ? 6 : 1); xx < x + w - 3; xx += 10) rect(c, xx, yy + 1, 3, 1, shade(color, 14));
      }
      break;
    }
    case 'plank': {
      for (let xx = x; xx < x + w; xx += 5) {
        rect(c, xx, y, 1, h, shade(color, -26));
        rect(c, xx + 1, y, 1, h, shade(color, 10));
      }
      break;
    }
    case 'log': {
      for (let yy = y; yy < y + h; yy += 6) {
        rect(c, x, yy, w, 6, shade(color, (yy / 6) % 2 ? -6 : 4));
        rect(c, x, yy, w, 1, shade(color, 18));
        rect(c, x, yy + 5, w, 1, shade(color, -30));
        ellipse(c, x + 1, yy + 3, 3, 3, shade(color, 10));
        ellipse(c, x + 1, yy + 3, 1.5, 1.5, shade(color, -20));
        ellipse(c, x + w - 1, yy + 3, 3, 3, shade(color, -6));
        ellipse(c, x + w - 1, yy + 3, 1.5, 1.5, shade(color, -30));
      }
      break;
    }
  }
  // foundation + right-side shading for volume
  rect(c, x, y + h - 6, w, 6, '#7d776e');
  rect(c, x, y + h - 6, w, 1, '#99938a');
  for (let xx = x + 3; xx < x + w; xx += 8) rect(c, xx, y + h - 5, 1, 5, '#635e57');
  rect(c, x + w - 4, y, 4, h, 'rgba(0,0,0,0.12)');
}

function door(c: Ctx, cx: number, bottom: number, w: number, h: number, wood: string, arched = true): void {
  const x = Math.round(cx - w / 2);
  rect(c, x - 2, bottom - h - 1, w + 4, h + 1, '#3d2a1a');
  if (arched) ellipse(c, cx, bottom - h + w / 2, w / 2 + 2, w / 2 + 2, '#3d2a1a');
  rect(c, x, bottom - h + (arched ? w / 2 : 1), w, h - (arched ? w / 2 : 1), wood);
  if (arched) ellipse(c, cx, bottom - h + w / 2, w / 2, w / 2, wood);
  for (let xx = x + 3; xx < x + w - 1; xx += 4) rect(c, xx, bottom - h + 3, 1, h - 3, shade(wood, -26));
  rect(c, x, bottom - Math.round(h * 0.35), w, 2, '#4a4a52');
  rect(c, x, bottom - Math.round(h * 0.75), w, 2, '#4a4a52');
  rect(c, x + w - 4, bottom - Math.round(h * 0.5), 2, 2, '#e8c070');
  rect(c, x - 3, bottom, w + 6, 2, '#8d877e');
}

function windowLit(c: Ctx, x: number, y: number, w: number, h: number, frame: string, glass = '#ffe9a8'): void {
  rect(c, x - 1, y - 1, w + 2, h + 2, frame);
  rect(c, x, y, w, h, glass);
  rect(c, x, y, w, Math.ceil(h / 2), shade(glass, 18));
  rect(c, x + Math.floor(w / 2), y, 1, h, frame);
  rect(c, x, y + Math.floor(h / 2), w, 1, frame);
  rect(c, x - 2, y + h + 1, w + 4, 2, shade(frame, -10));
  rect(c, x + 1, y + 1, 1, 2, '#ffffff');
}

function chimney(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  rect(c, x, y, w, h, color);
  rect(c, x, y, 2, h, shade(color, 20));
  rect(c, x + w - 2, y, 2, h, shade(color, -26));
  for (let yy = y + 5; yy < y + h; yy += 5) rect(c, x, yy, w, 1, shade(color, -30));
  rect(c, x - 2, y - 3, w + 4, 4, shade(color, -12));
  rect(c, x - 2, y - 3, w + 4, 1, shade(color, 14));
  rect(c, x, y - 2, w, 2, '#1e1814');
}

function smoke(c: Ctx, x: number, y: number): void {
  ellipse(c, x, y, 4, 3, 'rgba(210,210,215,0.55)');
  ellipse(c, x + 3, y - 6, 5, 4, 'rgba(210,210,215,0.42)');
  ellipse(c, x + 1, y - 13, 6, 4, 'rgba(210,210,215,0.28)');
}

/** Little gold sun-ring emblem used by the chapel and priestess. */
function sunRing(c: Ctx, x: number, y: number, r: number, gold = '#f2d36b'): void {
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    line(c, [x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9, x + Math.cos(a) * r * 1.5, y + Math.sin(a) * r * 1.5], gold, i % 2 ? 1 : 1.6, 'butt');
  }
  c.strokeStyle = gold;
  c.lineWidth = 1.6;
  c.beginPath();
  c.arc(x, y, r * 0.75, 0, Math.PI * 2);
  c.stroke();
}

function drawStructures(scene: Phaser.Scene): void {
  // ---- smithy 4x3
  canvasTexAll(scene, ['struct_smithy', 'smithy'], 128, 128, (c) => {
    const rnd = mulberry32(201);
    groundShadow(c, 64, 122, 62, 7, 0.32);
    wallFace(c, 10, 70, 108, 54, '#8e8478', 'stone', rnd);
    // open forge bay
    rect(c, 16, 88, 40, 30, '#3b2a1f');
    rect(c, 16, 88, 40, 3, '#5a3f2a');
    rect(c, 18, 91, 36, 27, '#22160f');
    glow(c, 36, 108, 18, '#ff8a2a', 0.65);
    rect(c, 26, 104, 20, 8, '#5a5552');
    rect(c, 28, 101, 16, 4, '#ff9a3a');
    rect(c, 31, 99, 10, 3, '#ffd27a');
    rect(c, 15, 86, 42, 3, '#6a4a2e');
    door(c, 86, 118, 18, 28, '#7a4f2c');
    windowLit(c, 102, 92, 10, 9, '#5a3a22');
    roofFront(c, 4, 124, 24, 76, 10, '#9a3f2c', 'tile', rnd);
    rect(c, 6, 76, 116, 3, 'rgba(0,0,0,0.28)');
    chimney(c, 92, 8, 16, 34, '#7d776e');
    glow(c, 100, 5, 9, '#ff8a2a', 0.6);
    smoke(c, 101, 0);
    // hanging anvil sign
    rect(c, 106, 80, 14, 2, '#3d2a1a');
    rect(c, 108, 82, 1, 3, '#3d2a1a');
    rect(c, 117, 82, 1, 3, '#3d2a1a');
    rect(c, 105, 85, 16, 11, '#a8794a');
    rect(c, 105, 85, 16, 1, '#c8955e');
    poly(c, [108, 88, 118, 88, 116, 90, 115, 90, 115, 92, 117, 93, 109, 93, 111, 92, 111, 90, 109, 90], '#2b2b30');
    // anvil out front
    rect(c, 30, 119, 10, 4, '#3a3a40');
    poly(c, [24, 113, 44, 113, 44, 116, 40, 117, 40, 119, 30, 119, 30, 117, 26, 116, 22, 114], '#4a4a52');
    rect(c, 24, 113, 20, 1, '#8a8a96');
    // water barrel
    rect(c, 106, 108, 10, 13, '#7a4f2c');
    rect(c, 106, 110, 10, 1, '#3a3a40');
    rect(c, 106, 117, 10, 1, '#3a3a40');
    ellipse(c, 111, 108, 5, 1.6, '#3c6f9a');
  });

  // ---- chapel 4x4 (front-gabled, bell cote)
  canvasTexAll(scene, ['struct_chapel', 'chapel'], 128, 176, (c) => {
    const rnd = mulberry32(202);
    groundShadow(c, 64, 170, 60, 7, 0.32);
    const roof = '#4a6aa8';
    // roof slopes going back from the gable
    poly(c, [12, 108, 64, 66, 64, 28, 12, 70], shade(roof, 14));
    poly(c, [116, 108, 64, 66, 64, 28, 116, 70], shade(roof, -22));
    for (let i = 1; i < 7; i++) {
      const t = i / 7;
      line(c, [12, 108 - t * 38, 64, 66 - t * 38], shade(roof, -6), 1, 'butt');
      line(c, [116, 108 - t * 38, 64, 66 - t * 38], shade(roof, -40), 1, 'butt');
    }
    line(c, [64, 66, 64, 28], shade(roof, -50), 2, 'butt');
    line(c, [12, 70, 64, 28], shade(roof, 30), 2, 'butt');
    line(c, [116, 70, 64, 28], shade(roof, -40), 2, 'butt');
    // walls + gable
    wallFace(c, 16, 104, 96, 68, '#e8e2d4', 'plaster', rnd);
    rect(c, 16, 104, 96, 3, '#e8e2d4');
    poly(c, [14, 106, 64, 64, 114, 106], '#e8e2d4');
    poly(c, [64, 64, 114, 106, 104, 106, 64, 72], '#d6cfbf');
    line(c, [10, 110, 64, 63, 118, 110], '#7a5a3a', 4, 'butt');
    line(c, [10, 109, 64, 62, 118, 109], '#9a7a52', 1, 'butt');
    // rose window
    ellipse(c, 64, 90, 9, 9, '#7a5a3a');
    ellipse(c, 64, 90, 7.5, 7.5, '#5a8ad8');
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      ellipse(c, 64 + Math.cos(a) * 4, 90 + Math.sin(a) * 4, 2.2, 2.2, i % 2 ? '#e86a8a' : '#f2d36b');
    }
    ellipse(c, 64, 90, 2, 2, '#fff6d0');
    // tall stained windows
    for (const wx of [28, 92]) {
      rect(c, wx - 1, 124, 12, 26, '#7a5a3a');
      ellipse(c, wx + 5, 124, 6, 6, '#7a5a3a');
      rect(c, wx, 124, 10, 25, '#5a8ad8');
      ellipse(c, wx + 5, 124, 5, 5, '#5a8ad8');
      rect(c, wx, 132, 10, 6, '#e86a8a');
      rect(c, wx, 142, 10, 7, '#f2d36b');
      rect(c, wx + 5, 119, 1, 30, '#7a5a3a');
      rect(c, wx, 124, 2, 6, '#bfe0ff');
    }
    door(c, 64, 168, 22, 32, '#8a5a32');
    rect(c, 63, 138, 2, 30, '#5a3a22');
    rect(c, 48, 168, 32, 3, '#b8b2a6');
    // bell cote on the ridge
    rect(c, 56, 30, 16, 26, '#e8e2d4');
    rect(c, 66, 30, 6, 26, '#d0c9b9');
    rect(c, 59, 36, 10, 12, '#3a3040');
    ellipse(c, 64, 44, 4, 4, '#d8a83a');
    rect(c, 63, 36, 2, 5, '#7a5a3a');
    poly(c, [52, 32, 64, 8, 76, 32], shade(roof, 6));
    poly(c, [64, 8, 76, 32, 64, 32], shade(roof, -26));
    rect(c, 52, 31, 24, 2, shade(roof, -40));
    rect(c, 63, 2, 2, 7, '#c9a03a');
    sunRing(c, 64, 4, 3);
  });

  // ---- hut 3x3 (thatch, logs)
  canvasTexAll(scene, ['struct_hut', 'hut'], 96, 100, (c) => {
    const rnd = mulberry32(203);
    groundShadow(c, 48, 94, 44, 6, 0.3);
    wallFace(c, 14, 60, 68, 36, '#8c6a46', 'log', rnd);
    door(c, 50, 92, 16, 22, '#6a4426');
    ellipse(c, 27, 74, 5, 5, '#4a3020');
    ellipse(c, 27, 74, 3.5, 3.5, '#ffe9a8');
    rect(c, 26, 70, 1, 8, '#4a3020');
    // domed thatch
    const thatch = '#c9a24a';
    c.fillStyle = shade(thatch, -40);
    c.beginPath();
    c.moveTo(2, 70);
    c.quadraticCurveTo(6, 10, 48, 8);
    c.quadraticCurveTo(90, 10, 94, 70);
    c.closePath();
    c.fill();
    c.fillStyle = thatch;
    c.beginPath();
    c.moveTo(4, 66);
    c.quadraticCurveTo(8, 12, 48, 10);
    c.quadraticCurveTo(88, 12, 92, 66);
    c.closePath();
    c.fill();
    for (let i = 0; i < 260; i++) {
      const x = 8 + rnd() * 80;
      const y = 14 + rnd() * 50;
      const edge = Math.abs(x - 48) / 44;
      if (y < 12 + edge * edge * 50) continue;
      rect(c, Math.round(x), Math.round(y), 1, 3 + ri(rnd, 3), rnd() < 0.5 ? shade(thatch, -26) : shade(thatch, 22));
    }
    for (let y = 26; y < 64; y += 12) line(c, [10 + (64 - y) * 0.1, y, 86 - (64 - y) * 0.1, y], shade(thatch, -34), 1, 'butt');
    for (let x = 4; x < 92; x += 3) rect(c, x, 64 + ri(rnd, 2), 2, 4, shade(thatch, -30));
    ellipse(c, 30, 30, 9, 4, '#7a8a3a');
    ellipse(c, 66, 46, 7, 3, '#6b7d3a');
    ellipse(c, 38, 20, 10, 4, shade(thatch, 30));
    rect(c, 46, 6, 6, 5, '#5a4630');
    smoke(c, 49, 2);
  });

  // ---- hall 6x4 (timber guild hall with central gable)
  canvasTex(scene, 'struct_hall', 192, 156, (c) => {
    const rnd = mulberry32(204);
    groundShadow(c, 96, 150, 92, 8, 0.32);
    wallFace(c, 10, 84, 172, 68, '#ddc9a0', 'plaster', rnd);
    for (const wx of [22, 48, 134, 160]) windowLit(c, wx, 104, 12, 14, '#5a3a22');
    roofFront(c, 2, 190, 26, 90, 14, '#3f6f5a', 'slate', rnd);
    rect(c, 4, 90, 184, 3, 'rgba(0,0,0,0.28)');
    chimney(c, 30, 14, 12, 26, '#8a837a');
    chimney(c, 152, 10, 12, 28, '#8a837a');
    smoke(c, 37, 8);
    // central gable porch
    poly(c, [64, 96, 96, 50, 128, 96], '#ddc9a0');
    poly(c, [96, 50, 128, 96, 118, 96, 96, 60], '#c8b48c');
    line(c, [60, 99, 96, 48, 132, 99], '#5a3a22', 4, 'butt');
    line(c, [60, 98, 96, 47, 132, 98], '#7a5a3a', 1, 'butt');
    ellipse(c, 96, 76, 6, 6, '#5a3a22');
    ellipse(c, 96, 76, 4.5, 4.5, '#ffe9a8');
    rect(c, 95, 71, 1, 10, '#5a3a22');
    rect(c, 70, 96, 52, 3, '#5a3a22');
    door(c, 96, 148, 28, 34, '#7a4f2c');
    rect(c, 95, 118, 2, 30, '#4a2f1a');
    // banners
    for (const bx of [68, 118]) {
      rect(c, bx - 1, 100, 10, 2, '#5a3a22');
      poly(c, [bx, 102, bx + 8, 102, bx + 8, 124, bx + 4, 120, bx, 124], '#2f7f8f');
      rect(c, bx, 102, 2, 20, '#3f95a6');
      poly(c, [bx + 4, 106, bx + 6, 111, bx + 4, 116, bx + 2, 111], '#f2d36b');
    }
    // lanterns
    for (const lx of [78, 114]) {
      glow(c, lx, 128, 8, '#ffcf6a', 0.5);
      rect(c, lx - 2, 125, 4, 6, '#ffd77a');
      rect(c, lx - 3, 124, 6, 1, '#3a3a40');
      rect(c, lx - 3, 131, 6, 1, '#3a3a40');
    }
    rect(c, 76, 148, 40, 3, '#9a948a');
  });

  // ---- house 3x3
  canvasTex(scene, 'struct_house', 96, 108, (c) => {
    const rnd = mulberry32(205);
    groundShadow(c, 48, 102, 44, 6, 0.3);
    wallFace(c, 10, 62, 76, 42, '#eadcbc', 'plaster', rnd);
    windowLit(c, 20, 72, 14, 11, '#5a3a22');
    rect(c, 18, 85, 18, 4, '#7a4f2c');
    for (let i = 0; i < 6; i++) rect(c, 19 + i * 3, 83 + (i % 2), 2, 2, i % 2 ? '#ff6a6a' : '#ffd84d');
    door(c, 62, 100, 16, 24, '#6a8a4a');
    roofFront(c, 2, 94, 20, 66, 8, '#b5653a', 'tile', rnd);
    rect(c, 4, 66, 88, 3, 'rgba(0,0,0,0.28)');
    chimney(c, 18, 8, 10, 24, '#8a837a');
    smoke(c, 23, 3);
  });

  // ---- tent 3x2
  canvasTex(scene, 'struct_tent', 96, 72, (c) => {
    groundShadow(c, 48, 66, 44, 6, 0.3);
    const cloth = '#e8dcc0';
    const stripe = '#c0503a';
    // roof slopes running back from the front triangle
    poly(c, [8, 66, 48, 16, 48, 6, 10, 52], shade(cloth, -6));
    poly(c, [88, 66, 48, 16, 48, 6, 86, 52], shade(cloth, -44));
    for (let i = 1; i < 4; i++) {
      const t = i / 4;
      line(c, [8 + 2 * t, 66 - 14 * t, 48, 16 - 10 * t], stripe, 3, 'butt');
      line(c, [88 - 2 * t, 66 - 14 * t, 48, 16 - 10 * t], shade(stripe, -40), 3, 'butt');
    }
    // front face
    poly(c, [8, 66, 48, 16, 88, 66], cloth);
    for (const sx of [-24, -12, 12, 24]) {
      const x = 48 + sx;
      poly(c, [48 + sx * 0.08, 18, 48 + sx * 0.08 + 2, 18, x + 2, 66, x - 2, 66], sx < 0 ? stripe : shade(stripe, -16));
    }
    poly(c, [48, 16, 88, 66, 80, 66, 48, 24], 'rgba(0,0,0,0.12)');
    // open flap
    poly(c, [36, 66, 48, 32, 60, 66], '#2a1e18');
    poly(c, [48, 32, 60, 66, 66, 66, 52, 34], shade(cloth, -18));
    poly(c, [48, 32, 36, 66, 31, 64, 45, 36], shade(cloth, 10));
    line(c, [8, 66, 48, 16, 88, 66], '#8a6a4a', 1, 'butt');
    // pole + pennant + ropes
    rect(c, 47, 2, 2, 16, '#6a4a2e');
    poly(c, [49, 3, 58, 6, 49, 9], '#2f7f8f');
    line(c, [48, 16, 2, 62], 'rgba(90,70,50,0.8)', 1, 'butt');
    line(c, [48, 16, 94, 62], 'rgba(90,70,50,0.8)', 1, 'butt');
    rect(c, 1, 61, 2, 4, '#6a4a2e');
    rect(c, 93, 61, 2, 4, '#6a4a2e');
  });

  // ---- ruin 4x3 (roofless, broken walls, toppled column)
  canvasTex(scene, 'struct_ruin', 128, 104, (c) => {
    const rnd = mulberry32(206);
    groundShadow(c, 64, 98, 60, 6, 0.22);
    const stone = '#a39d92';
    // old floor
    rect(c, 12, 40, 104, 56, '#8a857b');
    for (let y = 40; y < 96; y += 12)
      for (let x = 12 + ((y / 12) % 2) * 6; x < 116; x += 12) {
        rect(c, x, y, 11, 11, shade('#8a857b', (rnd() - 0.5) * 14));
        rect(c, x, y, 11, 1, '#9a958b');
      }
    for (let i = 0; i < 18; i++) rect(c, 14 + ri(rnd, 100), 42 + ri(rnd, 52), 3, 2, rnd() < 0.5 ? '#5d8a46' : '#6b665d');
    // broken wall: lit top + front face + jagged silhouette
    const wallSeg = (x: number, y: number, w: number, h: number, jag: number[]) => {
      const top: number[] = [];
      jag.forEach((d, i) => top.push(x + (i / (jag.length - 1)) * w, y + d));
      poly(c, [...top, x + w, y + h, x, y + h], stone);
      for (let yy = y + 4; yy < y + h; yy += 6) {
        rect(c, x, yy, w, 1, shade(stone, -28));
        for (let xx = x + ((yy / 6) % 2 ? 4 : 0); xx < x + w; xx += 9) rect(c, xx, yy, 1, 6, shade(stone, -28));
      }
      // repaint jagged top above courses + lit cap
      for (let i = 0; i < jag.length - 1; i++) {
        const ax = x + (i / (jag.length - 1)) * w;
        const bx = x + ((i + 1) / (jag.length - 1)) * w;
        line(c, [ax, y + jag[i] + 1, bx, y + jag[i + 1] + 1], shade(stone, 26), 2, 'butt');
      }
      rect(c, x + w - 3, y + Math.max(...jag), 3, h - Math.max(...jag), shade(stone, -20));
      rect(c, x, y + h - 2, w, 2, shade(stone, -40));
    };
    wallSeg(10, 18, 108, 26, [10, 2, 6, 0, 4, 12, 16, 8, 3, 9, 14]);
    wallSeg(8, 34, 8, 62, [0, 2]);
    wallSeg(112, 54, 8, 42, [4, 0]);
    wallSeg(8, 76, 34, 22, [0, 2, 8, 12]);
    wallSeg(88, 82, 32, 16, [9, 4, 0, 2]);
    // ivy
    for (const [x, y, n] of [
      [22, 26, 9],
      [70, 22, 7],
      [12, 50, 10],
      [96, 86, 5],
    ] as const)
      for (let i = 0; i < n; i++) rect(c, x + ri(rnd, 8), y + i * 2, 2, 2, i % 3 ? '#4f7a3a' : '#6a9a4a');
    // standing broken column + fallen drums
    rect(c, 28, 52, 10, 30, '#bab4a8');
    rect(c, 34, 52, 4, 30, '#9e988c');
    rect(c, 29, 52, 1, 30, '#d0cabe');
    poly(c, [26, 54, 30, 48, 34, 51, 38, 47, 40, 54], '#c6c0b4');
    rect(c, 25, 80, 16, 4, '#9e988c');
    rect(c, 72, 69, 18, 10, '#b4aea2');
    rect(c, 72, 69, 18, 2, '#c8c2b6');
    rect(c, 72, 77, 18, 2, '#8a8478');
    ellipse(c, 90, 74, 3, 5, '#8a8478');
    ellipse(c, 72, 74, 3, 5, '#d0cabe');
    ellipse(c, 72, 74, 1.5, 2.5, '#b4aea2');
    for (let i = 0; i < 10; i++) {
      const x = 46 + ri(rnd, 60);
      const y = 84 + ri(rnd, 10);
      rect(c, x, y, 3, 2, '#9e988c');
      rect(c, x, y, 2, 1, '#c6c0b4');
    }
  });

  // ---- tower 2x3 (round stone tower, cone roof)
  canvasTex(scene, 'struct_tower', 64, 160, (c) => {
    const rnd = mulberry32(207);
    groundShadow(c, 32, 154, 28, 6, 0.32);
    const stone = '#a29c90';
    const body = c.createLinearGradient(8, 0, 56, 0);
    body.addColorStop(0, shade(stone, 18));
    body.addColorStop(0.45, stone);
    body.addColorStop(1, shade(stone, -46));
    c.fillStyle = body;
    c.fillRect(9, 44, 46, 108);
    ellipse(c, 32, 152, 23, 5, shade(stone, -30));
    rect(c, 9, 140, 46, 12, shade(stone, -10));
    for (let y = 50, r = 0; y < 150; y += 7, r++) {
      c.strokeStyle = 'rgba(40,36,32,0.35)';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(32, y, 23, 3, 0, 0, Math.PI);
      c.stroke();
      for (let x = 12 + (r % 2) * 5; x < 54; x += 10) rect(c, x, y + 1 + Math.round(Math.sin(((x - 9) / 46) * Math.PI) * 3), 1, 6, 'rgba(40,36,32,0.3)');
    }
    for (let i = 0; i < 30; i++) rect(c, 11 + ri(rnd, 40), 50 + ri(rnd, 96), 2, 1, 'rgba(255,255,255,0.12)');
    // windows + door
    for (const y of [64, 96]) {
      rect(c, 29, y, 5, 12, '#2a2430');
      ellipse(c, 31.5, y, 2.5, 2.5, '#2a2430');
      rect(c, 30, y + 2, 1, 6, '#ffe9a8');
    }
    door(c, 32, 150, 14, 22, '#6a4426');
    // cone roof
    ellipse(c, 32, 46, 28, 7, shade('#4a5a8a', -40));
    poly(c, [4, 46, 32, 0, 60, 46], '#4a5a8a');
    poly(c, [32, 0, 60, 46, 40, 50], shade('#4a5a8a', -30));
    poly(c, [32, 0, 4, 46, 14, 49], shade('#4a5a8a', 18));
    for (let y = 12; y < 46; y += 7) {
      const hw = (y / 46) * 28;
      line(c, [32 - hw, y, 32 + hw, y], 'rgba(20,24,40,0.35)', 1, 'butt');
    }
    c.fillStyle = shade('#4a5a8a', -10);
    c.beginPath();
    c.ellipse(32, 46, 28, 6, 0, 0, Math.PI);
    c.fill();
    line(c, [32, 0, 32, -1], '#3a3a40', 1);
    rect(c, 31, 0, 2, 4, '#3a3a40');
    poly(c, [33, 0, 42, 2, 33, 5], '#c0503a');
  });

  // ---- well 1x1
  canvasTex(scene, 'struct_well', 32, 48, (c) => {
    groundShadow(c, 16, 44, 14, 3.5, 0.3);
    const stone = '#a29c90';
    // ring front face (cylinder)
    rect(c, 3, 34, 26, 9, shade(stone, -14));
    ellipse(c, 16, 43, 13, 3.5, shade(stone, -30));
    rect(c, 3, 34, 26, 8, shade(stone, -14));
    for (let x = 5; x < 29; x += 6) rect(c, x, 35, 1, 7, shade(stone, -40));
    rect(c, 3, 38, 26, 1, shade(stone, -40));
    // rim + water
    ellipse(c, 16, 34, 13, 5, stone);
    ellipse(c, 16, 34, 13, 5, stone);
    ellipse(c, 16, 33, 13, 4.5, shade(stone, 16));
    ellipse(c, 16, 34, 9, 3, '#1c3550');
    ellipse(c, 14, 33.5, 3, 1, '#4a7aa8');
    // posts, crank, roof
    rect(c, 3, 12, 3, 24, '#6a4426');
    rect(c, 26, 12, 3, 24, '#4e3019');
    rect(c, 4, 18, 24, 2, '#5a3a22');
    rect(c, 27, 17, 4, 2, '#3a3a40');
    line(c, [16, 20, 16, 27], '#c8b48c', 1, 'butt');
    rect(c, 13, 27, 6, 5, '#7a4f2c');
    rect(c, 13, 28, 6, 1, '#3a3a40');
    poly(c, [0, 14, 16, 3, 32, 14, 29, 15, 16, 6, 3, 15], '#8a3b2a');
    poly(c, [0, 14, 16, 3, 16, 6, 3, 15], '#a8503a');
    rect(c, 15, 2, 2, 3, '#5a3a22');
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
