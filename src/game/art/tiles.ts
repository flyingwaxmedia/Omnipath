// Terrain art (art direction v3 "Lush Pixel" §2-3): every ground tile and every autotile transition piece, drawn
// pixel-by-pixel into typed buffers at boot (no image files, fully deterministic).
//
//   'tiles'      TILE_COUNT columns (tile-id order) x TILE_VARIANTS rows, 32x32 cells, 1 px extruded margin,
//                2 px spacing. Row 0 is the v2-compatible base; any variant tiles seamlessly next to any other.
//                Frames are registered as atlasIndex(tileId, variant).
//   'tiles_edge' EDGE_FAMILIES rows x (16 corner masks * EDGE_VARIANTS) columns, same cell convention.
//                Frames are registered as edgeFrame(family, mask, variant).
// Which piece goes where is decided by the pure model in ../render/autotile.ts.
import type Phaser from 'phaser';
import { T, TILE_COUNT } from '../../core/world/tiles';
import {
  CORNER,
  EDGE_COLS,
  EDGE_FAMILIES,
  EDGE_ROWS,
  EDGE_VARIANTS,
  TILE_MARGIN,
  TILE_SPACING,
  TILE_VARIANTS,
  edgeFrame,
  type EdgeFamily,
} from '../render/autotile';
import { PAL, artRng, keySeed, pixelTex } from './pixel';

export {
  CORNER,
  EDGE_FAMILIES,
  EDGE_VARIANTS,
  TILE_MARGIN,
  TILE_SPACING,
  TILE_VARIANTS,
  atlasIndex,
  edgeFrame,
  edgeFrameInfo,
  type EdgeFamily,
} from '../render/autotile';

const S = 32;
type Rnd = () => number;
const ri = (rnd: Rnd, n: number) => Math.floor(rnd() * n);

// ================================================================== colour + pixel buffer

type RGB = number;
const hx = (s: string): RGB => parseInt(s.slice(1), 16);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
function sh(c: RGB, amt: number): RGB {
  const r = clamp(((c >> 16) & 255) + amt, 0, 255);
  const g = clamp(((c >> 8) & 255) + amt, 0, 255);
  const b = clamp((c & 255) + amt, 0, 255);
  return (r << 16) | (g << 8) | b;
}
function mixc(a: RGB, b: RGB, t: number): RGB {
  const m = (sa: number, sb: number) => Math.round(sa + (sb - sa) * t);
  return (m((a >> 16) & 255, (b >> 16) & 255) << 16) | (m((a >> 8) & 255, (b >> 8) & 255) << 8) | m(a & 255, b & 255);
}

/** RGBA pixel buffer with straight-alpha "over" compositing. */
class Buf {
  readonly d: Uint8ClampedArray<ArrayBuffer>;
  constructor(
    readonly w = S,
    readonly h = S,
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }
  set(x: number, y: number, c: RGB, a = 1): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h || a <= 0) return;
    const d = this.d;
    const i = ((y | 0) * this.w + (x | 0)) * 4;
    const sr = (c >> 16) & 255;
    const sg = (c >> 8) & 255;
    const sb = c & 255;
    const da = d[i + 3] / 255;
    if (a >= 1 || da === 0) {
      d[i] = sr;
      d[i + 1] = sg;
      d[i + 2] = sb;
      d[i + 3] = a >= 1 ? 255 : Math.round(a * 255);
      return;
    }
    const oa = a + da * (1 - a);
    d[i] = (sr * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (sg * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (sb * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }
  rect(x: number, y: number, w: number, h: number, c: RGB, a = 1): void {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }
  fill(c: RGB): void {
    this.rect(0, 0, this.w, this.h, c);
  }
  rgb(x: number, y: number): RGB {
    const i = (y * this.w + x) * 4;
    return (this.d[i] << 16) | (this.d[i + 1] << 8) | this.d[i + 2];
  }
  alpha(x: number, y: number): number {
    return this.d[(y * this.w + x) * 4 + 3];
  }
  clear(x: number, y: number): void {
    this.d[(y * this.w + x) * 4 + 3] = 0;
  }
}

/** Pixel sprite: rows of palette letters, '.' = skip. */
function stamp(b: Buf, x: number, y: number, rows: readonly string[], pal: Readonly<Record<string, RGB>>): void {
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const ch = rows[j][i];
      if (ch !== '.') b.set(x + i, y + j, pal[ch]);
    }
}
const spriteW = (rows: readonly string[]) => Math.max(...rows.map((r) => r.length));

// ================================================================== detail placement

/** Finds a free spot for a w x h detail (top-left), or null. */
type Place = (w: number, h: number, gap?: number) => [number, number] | null;

function makePlacer(rnd: Rnd, ok: (x: number, y: number) => boolean): Place {
  const used = new Uint8Array(S * S);
  return (w, h, gap = 1) => {
    for (let tries = 0; tries < 24; tries++) {
      const x = 1 + ri(rnd, Math.max(1, S - 1 - w));
      const y = 1 + ri(rnd, Math.max(1, S - 1 - h));
      let free = true;
      for (let yy = y - gap; yy < y + h + gap && free; yy++)
        for (let xx = x - gap; xx < x + w + gap && free; xx++) {
          if (xx < 0 || yy < 0 || xx >= S || yy >= S) {
            if (xx < 0 || yy < 0 || xx > S || yy > S) free = false;
            continue;
          }
          if (used[yy * S + xx] || !ok(xx, yy)) free = false;
        }
      if (!free) continue;
      for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) used[yy * S + xx] = 1;
      return [x, y];
    }
    return null;
  };
}

// ================================================================== ground materials

interface Ground {
  base: RGB;
  /** Small clustered details (never touching the cell border, so every variant pairing stays seamless). */
  deco(b: Buf, rnd: Rnd, place: Place, variant: number, density: number): void;
}

/** n details, scaled by density with a random rounding. */
const count = (rnd: Rnd, n: number, density: number) => Math.floor(n * density + rnd());

interface GrassLook {
  base: string;
  dark: string;
  deep: string;
  light: string;
  hi: string;
  tufts: number;
  specks: number;
  /** Wind-bent blades (storm grass). */
  bent?: boolean;
  /** Accent pixels (dusk glints, glade motes). */
  glints?: readonly string[];
  /** Leaf litter colours (dark forest floor). */
  litter?: readonly string[];
}

const TUFTS: readonly (readonly string[])[] = [
  ['.h.', 'ldl', '.d.'],
  ['h..h', 'l.hl', 'dldd'],
  ['.h.h.', 'hl.ld', 'dddl.'],
  ['h.h', 'ldl'],
  ['..h..', '.hl.h', 'hdlld', '.ddd.'],
];
const BENT: readonly (readonly string[])[] = [
  ['..hh', '.ll.', 'dd..'],
  ['...h', '.hl.', 'ldd.', 'd...'],
  ['.hh..h', 'll..l.', 'd..dd.'],
];

function grassGround(g: GrassLook): Ground {
  const pal = { d: hx(g.dark), l: hx(g.light), h: hx(g.hi), x: hx(g.deep) };
  return {
    base: hx(g.base),
    deco(b, rnd, place, v, density) {
      // a soft darker patch for low-frequency variation (only in full tiles)
      if (density >= 1 && v !== 0) {
        const p = place(9, 6, 0);
        if (p) {
          const tone = sh(hx(g.base), v === 1 ? -5 : 4);
          for (let j = 0; j < 6; j++)
            for (let i = 0; i < 9; i++) {
              const dx = (i - 4) / 4.5;
              const dy = (j - 2.5) / 3;
              if (dx * dx + dy * dy < 1 - rnd() * 0.25) b.set(p[0] + i, p[1] + j, tone);
            }
        }
      }
      const set = g.bent ? BENT : TUFTS;
      const nt = count(rnd, g.tufts + (v === 2 ? 2 : v === 1 ? -1 : 0), density);
      for (let i = 0; i < nt; i++) {
        const sp = set[ri(rnd, set.length)];
        const p = place(spriteW(sp), sp.length);
        if (p) stamp(b, p[0], p[1], sp, pal);
      }
      // speck pairs: tiny lighter / darker dashes, clustered in twos and threes
      const ns = count(rnd, g.specks, density);
      for (let i = 0; i < ns; i++) {
        const p = place(3, 2, 1);
        if (!p) continue;
        const c = rnd() < 0.55 ? pal.l : pal.d;
        b.set(p[0], p[1], c);
        if (rnd() < 0.6) b.set(p[0] + 1, p[1], c);
        if (rnd() < 0.4) b.set(p[0] + 2, p[1] + 1, c);
      }
      if (g.glints) {
        const ng = count(rnd, 2, density);
        for (let i = 0; i < ng; i++) {
          const p = place(1, 1, 2);
          if (p) b.set(p[0], p[1], hx(g.glints[ri(rnd, g.glints.length)]));
        }
      }
      if (g.litter) {
        const nl = count(rnd, 3, density);
        for (let i = 0; i < nl; i++) {
          const p = place(3, 2);
          if (!p) continue;
          const c = hx(g.litter[ri(rnd, g.litter.length)]);
          b.set(p[0], p[1], c);
          b.set(p[0] + 1, p[1], c);
          b.set(p[0] + 1, p[1] + 1, sh(c, -22));
          if (rnd() < 0.5) b.set(p[0] + 2, p[1] + 1, sh(c, 14));
        }
      }
    },
  };
}

const GRASS_LOOK: GrassLook = {
  base: '#6f8a42',
  dark: '#5a7536',
  deep: '#4a612c',
  light: '#83a04d',
  hi: '#99b75c',
  tufts: 4,
  specks: 5,
};

interface DirtLook {
  base: string;
  dark: string;
  light: string;
  stone: string;
  stoneHi: string;
  pebbles: number;
  specks: number;
  cracks?: number;
  crackColor?: string;
  /** Glowing crack interior (ember ground). */
  glow?: string;
  /** Sand ripples instead of cracks. */
  ripples?: number;
}

function dirtGround(g: DirtLook): Ground {
  const base = hx(g.base);
  const dark = hx(g.dark);
  const light = hx(g.light);
  const stone = hx(g.stone);
  const stoneHi = hx(g.stoneHi);
  return {
    base,
    deco(b, rnd, place, v, density) {
      if (density >= 1 && v !== 0) {
        const p = place(10, 6, 0);
        if (p) {
          const tone = sh(base, v === 1 ? -5 : 5);
          for (let j = 0; j < 6; j++)
            for (let i = 0; i < 10; i++) {
              const dx = (i - 4.5) / 5;
              const dy = (j - 2.5) / 3;
              if (dx * dx + dy * dy < 1 - rnd() * 0.3) b.set(p[0] + i, p[1] + j, tone);
            }
        }
      }
      const np = count(rnd, g.pebbles + (v === 2 ? 1 : 0), density);
      for (let i = 0; i < np; i++) {
        const big = rnd() < 0.35;
        const w = big ? 4 : 2 + ri(rnd, 2);
        const h = big ? 3 : 2;
        const p = place(w, h + 1);
        if (!p) continue;
        const [x, y] = p;
        const tone = sh(stone, ri(rnd, 13) - 6);
        if (big) {
          b.rect(x + 1, y, w - 2, 1, stoneHi);
          b.rect(x, y + 1, w, h - 1, tone);
          b.set(x, y + 1, stoneHi);
          b.rect(x + 1, y + h, w - 2, 1, dark);
          b.set(x + w - 1, y + h - 1, sh(tone, -18));
        } else {
          b.rect(x, y, w, 1, tone);
          b.set(x, y, stoneHi);
          b.rect(x, y + 1, w, 1, dark);
        }
      }
      const ns = count(rnd, g.specks, density);
      for (let i = 0; i < ns; i++) {
        const p = place(3, 2, 1);
        if (!p) continue;
        const c = rnd() < 0.5 ? light : dark;
        b.set(p[0], p[1], c);
        if (rnd() < 0.5) b.set(p[0] + 1, p[1], c);
        if (rnd() < 0.3) b.set(p[0] + 2, p[1] + 1, c);
      }
      const nc = count(rnd, g.cracks ?? 0, density);
      for (let i = 0; i < nc; i++) {
        const p = place(7, 4);
        if (!p) continue;
        const cc = hx(g.crackColor ?? g.dark);
        let [x, y] = p;
        y += 1 + ri(rnd, 2);
        for (let k = 0; k < 7; k++) {
          b.set(x + k, y, cc);
          if (g.glow && k > 0 && k < 6) b.set(x + k, y - 1, k % 3 === 1 ? hx('#ffd27a') : hx(g.glow));
          if (k < 6 && rnd() < 0.35) y += rnd() < 0.5 ? -1 : 1;
          y = clamp(y, p[1] + 1, p[1] + 3);
        }
      }
      const nr = count(rnd, g.ripples ?? 0, density);
      for (let i = 0; i < nr; i++) {
        const p = place(8, 2);
        if (!p) continue;
        const [x, y] = p;
        b.rect(x + 1, y, 5, 1, light);
        b.rect(x, y + 1, 2, 1, dark);
        b.rect(x + 2, y + 1, 4, 1, sh(base, -8));
        b.rect(x + 6, y + 1, 2, 1, dark);
      }
    },
  };
}

const PATH_LOOK: DirtLook = {
  base: '#a08a63',
  dark: '#86704f',
  light: '#b39e78',
  stone: '#b8a888',
  stoneHi: '#d2c4a4',
  pebbles: 3,
  specks: 6,
};

interface WaterLook {
  base: string;
  dark: string;
  ripple: string;
  sparkle: string;
  ripples: number;
}
function waterGround(g: WaterLook): Ground {
  const base = hx(g.base);
  return {
    base,
    deco(b, rnd, place, v, density) {
      const n = count(rnd, g.ripples + (v === 1 ? 1 : 0), density);
      for (let i = 0; i < n; i++) {
        const len = 4 + ri(rnd, 4);
        const p = place(len, 2, 2);
        if (!p) continue;
        const [x, y] = p;
        b.rect(x + 1, y, len - 2, 1, hx(g.ripple));
        b.set(x, y + 1, hx(g.ripple));
        b.set(x + len - 1, y + 1, hx(g.ripple));
        b.rect(x + 1, y + 1, len - 2, 1, hx(g.dark));
      }
      const ns = count(rnd, v === 2 ? 2 : 1, density);
      for (let i = 0; i < ns; i++) {
        const p = place(2, 1, 2);
        if (p) {
          b.set(p[0], p[1], hx(g.sparkle));
          if (rnd() < 0.5) b.set(p[0] + 1, p[1], hx(g.ripple));
        }
      }
    },
  };
}

const MOSS_LOOK = { base: '#48632f', dark: '#3a5127', deep: '#2f4220', light: '#5b7b39', hi: '#729447' };
function mossGround(): Ground {
  const base = hx(MOSS_LOOK.base);
  return {
    base,
    deco(b, rnd, place, v, density) {
      const n = count(rnd, 5 + (v === 2 ? 1 : 0), density);
      for (let i = 0; i < n; i++) {
        const w = 4 + ri(rnd, 3);
        const h = 3 + ri(rnd, 2);
        const p = place(w, h + 1, 0);
        if (!p) continue;
        const [x, y] = p;
        // cushion: rounded lump with lit top, dark under-lip
        for (let j = 0; j < h; j++)
          for (let k = 0; k < w; k++) {
            const corner = (j === 0 || j === h - 1) && (k === 0 || k === w - 1);
            if (corner) continue;
            b.set(x + k, y + j, j === 0 ? hx(MOSS_LOOK.light) : hx(MOSS_LOOK.base));
          }
        b.set(x + 1, y, hx(MOSS_LOOK.hi));
        b.rect(x + 1, y + h, w - 2, 1, hx(MOSS_LOOK.deep));
        b.set(x + w - 1, y + h - 1, hx(MOSS_LOOK.dark));
      }
      const ns = count(rnd, 4, density);
      for (let i = 0; i < ns; i++) {
        const p = place(2, 1);
        if (p) b.set(p[0], p[1], rnd() < 0.5 ? hx(MOSS_LOOK.dark) : hx(MOSS_LOOK.light));
      }
    },
  };
}

const SNOW_LOOK = { base: '#e2eaf0', shade: '#c7d4df', deep: '#aebdcc', light: '#f4f8fb', hi: '#ffffff' };
function snowGround(): Ground {
  const base = hx(SNOW_LOOK.base);
  return {
    base,
    deco(b, rnd, place, v, density) {
      const n = count(rnd, 3 + (v === 2 ? 1 : 0), density);
      for (let i = 0; i < n; i++) {
        const w = 5 + ri(rnd, 4);
        const p = place(w, 3);
        if (!p) continue;
        const [x, y] = p;
        // small drift: bright crest, blue shadow under it
        b.rect(x + 1, y, w - 2, 1, hx(SNOW_LOOK.hi));
        b.rect(x, y + 1, w, 1, hx(SNOW_LOOK.light));
        b.rect(x + 1, y + 2, w - 2, 1, hx(SNOW_LOOK.shade));
      }
      const ns = count(rnd, 5, density);
      for (let i = 0; i < ns; i++) {
        const p = place(2, 1, 1);
        if (!p) continue;
        b.set(p[0], p[1], rnd() < 0.6 ? hx(SNOW_LOOK.shade) : hx(SNOW_LOOK.deep));
        if (rnd() < 0.4) b.set(p[0] + 1, p[1], hx(SNOW_LOOK.shade));
      }
      if (rnd() < 0.7 * density) {
        const p = place(1, 1, 2);
        if (p) b.set(p[0], p[1], hx('#ffffff'));
      }
    },
  };
}

const ICE_LOOK = { base: '#9ccde2', dark: '#7fb2cc', deep: '#6a9cb8', light: '#c2e4f1', hi: '#eef9fd' };
function iceGround(): Ground {
  const base = hx(ICE_LOOK.base);
  return {
    base,
    deco(b, rnd, place, v, density) {
      const n = count(rnd, 2 + (v === 1 ? 1 : 0), density);
      for (let i = 0; i < n; i++) {
        const len = 5 + ri(rnd, 5);
        const p = place(len, len);
        if (!p) continue;
        const [x, y] = p;
        for (let k = 0; k < len; k++) {
          b.set(x + k, y + len - 1 - k, hx(ICE_LOOK.light));
          if (k % 2 === 0 && k < len - 1) b.set(x + k + 1, y + len - 1 - k, hx(ICE_LOOK.hi));
        }
      }
      const nc = count(rnd, 2, density);
      for (let i = 0; i < nc; i++) {
        const p = place(7, 3);
        if (!p) continue;
        let [x, y] = p;
        y += 1;
        for (let k = 0; k < 7; k++) {
          b.set(x + k, y, hx(ICE_LOOK.deep));
          b.set(x + k, y + 1, hx(ICE_LOOK.light));
          if (rnd() < 0.3) y = clamp(y + (rnd() < 0.5 ? -1 : 1), p[1], p[1] + 1);
        }
        x += 0;
      }
      if (rnd() < density) {
        const p = place(3, 3, 2);
        if (p) {
          b.set(p[0] + 1, p[1], hx(ICE_LOOK.hi));
          b.set(p[0], p[1] + 1, hx(ICE_LOOK.hi));
          b.set(p[0] + 1, p[1] + 1, hx('#ffffff'));
          b.set(p[0] + 2, p[1] + 1, hx(ICE_LOOK.hi));
          b.set(p[0] + 1, p[1] + 2, hx(ICE_LOOK.hi));
        }
      }
    },
  };
}

const VOID_LOOK = { base: '#0d0b12', fleck: '#17131f', fleck2: '#1d1828' };
function voidGround(): Ground {
  return {
    base: hx(VOID_LOOK.base),
    deco(b, rnd, place, _v, density) {
      const n = count(rnd, 3, density);
      for (let i = 0; i < n; i++) {
        const p = place(2, 1, 2);
        if (p) {
          b.set(p[0], p[1], hx(VOID_LOOK.fleck));
          if (rnd() < 0.4) b.set(p[0] + 1, p[1], hx(VOID_LOOK.fleck2));
        }
      }
    },
  };
}

const LAVA_LOOK = { base: '#cf4a1c', hot: '#ee7424', hotter: '#ffaa3a', white: '#ffe58a', crust: '#6e2412', crustHi: '#943317' };
function lavaGround(): Ground {
  const base = hx(LAVA_LOOK.base);
  return {
    base,
    deco(b, rnd, place, v, density) {
      // bright molten veins
      const nv = count(rnd, 3, density);
      for (let i = 0; i < nv; i++) {
        const p = place(9, 3);
        if (!p) continue;
        let [x, y] = p;
        y += 1;
        for (let k = 0; k < 9; k++) {
          b.set(x + k, y, hx(k > 2 && k < 6 ? LAVA_LOOK.hotter : LAVA_LOOK.hot));
          if (k === 4) b.set(x + k, y, hx(LAVA_LOOK.white));
          if (rnd() < 0.3) y = clamp(y + (rnd() < 0.5 ? -1 : 1), p[1], p[1] + 2);
        }
      }
      // drifting crust plates
      const nc = count(rnd, 2 + (v === 2 ? 1 : 0), density);
      for (let i = 0; i < nc; i++) {
        const w = 4 + ri(rnd, 3);
        const p = place(w, 3, 1);
        if (!p) continue;
        const [x, y] = p;
        b.rect(x + 1, y, w - 2, 1, hx(LAVA_LOOK.crustHi));
        b.rect(x, y + 1, w, 1, hx(LAVA_LOOK.crust));
        b.rect(x + 1, y + 2, w - 2, 1, sh(hx(LAVA_LOOK.crust), -16));
      }
      const ns = count(rnd, 3, density);
      for (let i = 0; i < ns; i++) {
        const p = place(1, 1, 1);
        if (p) b.set(p[0], p[1], rnd() < 0.5 ? hx(LAVA_LOOK.hotter) : sh(base, -20));
      }
    },
  };
}

// ---------------------------------------------------------------- the materials table

const G: Record<string, Ground> = {
  grass: grassGround(GRASS_LOOK),
  grass2: grassGround({ ...GRASS_LOOK, tufts: 7, specks: 4 }),
  hill: grassGround({ base: '#859f4f', dark: '#6d8840', deep: '#5a7233', light: '#99b45d', hi: '#b0c871', tufts: 4, specks: 5 }),
  storm: grassGround({
    base: '#687f69',
    dark: '#556b57',
    deep: '#465a49',
    light: '#7d957c',
    hi: '#9bb39a',
    tufts: 6,
    specks: 4,
    bent: true,
    glints: ['#c8e8f0'],
  }),
  dusk: grassGround({
    base: '#5b5485',
    dark: '#4a446f',
    deep: '#3c375c',
    light: '#6e679b',
    hi: '#8a80b8',
    tufts: 5,
    specks: 5,
    glints: ['#f0a8d8', '#a8e8ff'],
  }),
  glade: grassGround({
    base: '#4f906b',
    dark: '#3f7858',
    deep: '#336449',
    light: '#61a47c',
    hi: '#7cc094',
    tufts: 4,
    specks: 5,
    glints: ['#e8fff0', '#fff2b0'],
  }),
  dark: grassGround({
    base: '#4a5a3c',
    dark: '#3c4a31',
    deep: '#313d28',
    light: '#5a6b49',
    hi: '#6c7f57',
    tufts: 3,
    specks: 4,
    litter: ['#6e5636', '#5e4a64', '#7a6038'],
  }),
  path: dirtGround(PATH_LOOK),
  sand: dirtGround({
    base: '#cfbc89',
    dark: '#b8a473',
    light: '#e0d0a2',
    stone: '#e8dcc0',
    stoneHi: '#f6eedb',
    pebbles: 1,
    specks: 4,
    ripples: 2,
  }),
  stone: dirtGround({
    base: '#87827a',
    dark: '#6d6860',
    light: '#9c968c',
    stone: '#a29d93',
    stoneHi: '#bdb8ae',
    pebbles: 5,
    specks: 4,
    cracks: 1,
    crackColor: '#615c55',
  }),
  cave: dirtGround({
    base: '#4f463e',
    dark: '#3f372f',
    light: '#5f554a',
    stone: '#6b6055',
    stoneHi: '#80746a',
    pebbles: 3,
    specks: 5,
    cracks: 1,
    crackColor: '#352e28',
  }),
  ember: dirtGround({
    base: '#5b4036',
    dark: '#46302a',
    light: '#6e5044',
    stone: '#6a564c',
    stoneHi: '#85695c',
    pebbles: 2,
    specks: 5,
    cracks: 2,
    crackColor: '#2a1a14',
    glow: '#e8642a',
  }),
  water: waterGround({ base: '#3f86b9', dark: '#3676a8', ripple: '#6aa8d2', sparkle: '#cfeaf6', ripples: 3 }),
  deep: waterGround({ base: '#2d6596', dark: '#275a87', ripple: '#4580b2', sparkle: '#8cc6e6', ripples: 2 }),
  moss: mossGround(),
  snow: snowGround(),
  ice: iceGround(),
  void: voidGround(),
  lava: lavaGround(),
};

// ================================================================== flowers

const BLOOMS: readonly [string, string][] = [
  [PAL.crimson, '#e8c040'],
  [PAL.rose, '#f6d0d8'],
  [PAL.cream, '#e8c040'],
  [PAL.violet, '#d8c8f0'],
  ['#e8c040', '#fff2b0'],
];

function flowers(b: Buf, rnd: Rnd, place: Place, v: number): void {
  // sparse clumps (the dressing layer adds the big flower beds): v0 one clump, v1 none, v2 two
  const clusters = v === 0 ? 1 : v === 2 ? 2 : 0;
  const leaf = hx(GRASS_LOOK.deep);
  const leafLight = hx(GRASS_LOOK.dark);
  for (let c = 0; c < clusters; c++) {
    const p = place(6, 5, 2);
    if (!p) continue;
    const [petal, eye] = BLOOMS[ri(rnd, BLOOMS.length)];
    const n = 3 + ri(rnd, 3);
    for (let i = 0; i < n; i++) {
      const x = p[0] + ri(rnd, 5);
      const y = p[1] + 1 + ri(rnd, 3);
      b.set(x, y + 1, rnd() < 0.5 ? leaf : leafLight);
      b.set(x, y, hx(petal));
      if (rnd() < 0.4) b.set(x + 1, y, sh(hx(petal), -34));
      if (rnd() < 0.3) b.set(x, y - 1, hx(eye));
    }
  }
}

// ================================================================== structured tiles

/** Paints a full tile from a Ground. */
function paintGround(b: Buf, g: Ground, seed: number, v: number, extra?: (b: Buf, rnd: Rnd, place: Place) => void): void {
  b.fill(g.base);
  const rnd = artRng(seed + v * 7919);
  const place = makePlacer(rnd, () => true);
  if (extra) extra(b, rnd, place);
  g.deco(b, rnd, place, v, 1);
}

interface Stone {
  x: number;
  y: number;
  w: number;
  h: number;
  /** Crosses the tile border: shading must not depend on the variant. */
  wraps: boolean;
  seed: number;
}

/** Toroidal cobble layout (shared by every variant so edges always match). */
const COBBLES: readonly Stone[] = (() => {
  const rnd = artRng(keySeed('cobble-layout'));
  const out: Stone[] = [];
  for (let row = 0; row < 4; row++) {
    let x = ri(rnd, S);
    let left = S;
    while (left > 0) {
      let w = 6 + ri(rnd, 4);
      if (left - w < 6) w = left;
      const h = 6 + (rnd() < 0.5 ? 1 : 0);
      out.push({ x: x % S, y: row * 8 + (h === 6 ? ri(rnd, 2) : 0), w, h, wraps: (x % S) + w > S, seed: out.length * 131 + 7 });
      x += w;
      left -= w;
    }
  }
  return out;
})();

const COBBLE = { mortar: hx('#5f5a51'), body: hx('#9d978b'), hi: hx('#b9b3a6'), lo: hx('#78726a'), moss: hx('#6a7e45') };

/** One cobble stone (wrapped across the tile). `only` restricts drawing to a pixel predicate (edge pieces). */
function cobbleStone(b: Buf, st: Stone, rnd: Rnd, feature: boolean, only?: (x: number, y: number) => boolean): void {
  const tone = sh(COBBLE.body, ri(rnd, 17) - 8);
  const warm = rnd() < 0.3;
  const body = warm ? mixc(tone, hx('#a8957a'), 0.35) : tone;
  const crack = feature && rnd() < 0.5;
  const moss = feature && !crack;
  for (let j = 0; j < st.h - 1; j++)
    for (let i = 0; i < st.w - 1; i++) {
      const corner = (j === 0 || j === st.h - 2) && (i === 0 || i === st.w - 2);
      if (corner) continue;
      let c = body;
      if (j === 0 || i === 0) c = sh(body, 16);
      if (j === st.h - 2 || i === st.w - 2) c = sh(body, -18);
      if (j === 0 && i === 1) c = sh(body, 26);
      if (crack && i === (st.w >> 1) && j > 0 && j < st.h - 2) c = sh(body, -30);
      if (moss && j === st.h - 2 && i < 3) c = COBBLE.moss;
      const x = (st.x + i) % S;
      const y = st.y + j;
      if (!only || only(x, y)) b.set(x, y, c);
    }
}

function paintCobble(b: Buf, v: number): void {
  b.fill(COBBLE.mortar);
  const vr = artRng(keySeed('cobble') + v * 977);
  const featureAt = v === 0 ? -1 : ri(vr, COBBLES.length);
  COBBLES.forEach((st, i) => {
    const rnd = artRng(st.wraps ? st.seed : st.seed + v * 4099);
    cobbleStone(b, st, rnd, !st.wraps && i === featureAt);
  });
}

/** Crypt flagstones: two offset rows of 16 px slabs. */
const SLABS: readonly Stone[] = [
  { x: 0, y: 0, w: 16, h: 16, wraps: false, seed: 11 },
  { x: 16, y: 0, w: 16, h: 16, wraps: false, seed: 23 },
  { x: 8, y: 16, w: 16, h: 16, wraps: false, seed: 37 },
  { x: 24, y: 16, w: 16, h: 16, wraps: true, seed: 41 },
];
function paintCrypt(b: Buf, v: number): void {
  const seam = hx('#3a3645');
  b.fill(seam);
  const vr = artRng(keySeed('crypt') + v * 131);
  const feature = v === 0 ? -1 : ri(vr, 3);
  SLABS.forEach((st, i) => {
    const rnd = artRng(st.wraps ? st.seed : st.seed + v * 977);
    const body = sh(hx('#5c5768'), ri(rnd, 11) - 5);
    for (let j = 0; j < st.h - 1; j++)
      for (let k = 0; k < st.w - 1; k++) {
        let c = body;
        if (j === 0 || k === 0) c = sh(body, 12);
        if (j === st.h - 2 || k === st.w - 2) c = sh(body, -14);
        b.set((st.x + k) % S, st.y + j, c);
      }
    // worn speckles
    for (let q = 0; q < 3; q++) b.set((st.x + 3 + ri(rnd, 10)) % S, st.y + 3 + ri(rnd, 10), sh(body, rnd() < 0.5 ? -10 : 8));
    if (i === feature) {
      if (v === 1) {
        // short hairline crack
        let x = st.x + 4 + ri(rnd, 6);
        const y0 = st.y + 3 + ri(rnd, 4);
        for (let y = y0; y < y0 + 5; y++) {
          b.set(x % S, y, sh(body, -20));
          if (rnd() < 0.5) x += rnd() < 0.5 ? 1 : -1;
        }
      } else {
        // chipped corner with a tuft of moss
        const x = st.x + 1;
        const y = st.y + st.h - 4;
        b.rect(x, y, 2, 2, hx('#4a6040'));
        b.set(x + 2, y + 1, hx('#4a6040'));
        b.set(x, y, hx('#5c7650'));
      }
    }
  });
}

/** Basalt: foreshortened hexagonal column tops (Voronoi of a hex lattice; period 32). */
const HEX_CENTRES: readonly [number, number][] = [
  [0, 0],
  [0, 16],
  [16, 8],
  [16, 24],
];
const BASALT = { gap: hx('#1c1a20'), top: hx('#45414b'), hi: hx('#5d5866'), lo: hx('#36333b'), ember: hx('#d0561e') };
interface HexCell {
  id: number;
  edge: number;
  dx: number;
  dy: number;
}
let hexMap: HexCell[] | null = null;
function hexCellAt(x: number, y: number): HexCell {
  hexMap ??= Array.from({ length: S * S }, (_, i) => computeHexCell(i % S, Math.floor(i / S)));
  return hexMap[y * S + x];
}
function computeHexCell(x: number, y: number): HexCell {
  let best = 1e9;
  let second = 1e9;
  let id = 0;
  let bdx = 0;
  let bdy = 0;
  for (let i = 0; i < HEX_CENTRES.length; i++)
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        const dx = x + 0.5 - (HEX_CENTRES[i][0] + ox);
        const dy = (y + 0.5 - (HEX_CENTRES[i][1] + oy)) * 1.15;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) {
          second = best;
          best = d;
          id = i * 9 + (ox / S + 1) * 3 + (oy / S + 1);
          bdx = dx;
          bdy = dy;
        } else if (d < second) second = d;
      }
  return { id, edge: second - best, dx: bdx, dy: bdy };
}
function paintBasalt(b: Buf, v: number): void {
  const rnd = artRng(keySeed('basalt') + v * 31);
  const emberHex = v === 0 ? -1 : 9 * (2 + ri(rnd, 2)) + 4; // an interior hex centre (16, 8|24)
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const h = hexCellAt(x, y);
      const tone = sh(BASALT.top, ((h.id * 37) % 9) - 4);
      let c = tone;
      if (h.edge < 1.2) c = BASALT.gap;
      else if (h.edge < 2.4) c = h.dx + h.dy < 0 ? BASALT.hi : BASALT.lo;
      else if (Math.abs(h.dx + 1) < 1 && Math.abs(h.dy) < 1.5 && (h.id * 7) % 3 === 0) c = sh(tone, -10);
      if (h.id === emberHex && h.edge >= 1.2 && h.edge < 2.4 && h.dx > 0 && h.dy > 0) c = BASALT.ember;
      b.set(x, y, c);
    }
}

const BRIDGE = { gap: hx('#3a2616'), plank: hx(PAL.wood[2]), hi: hx(PAL.wood[3]), lo: hx(PAL.wood[1]), nail: hx('#2a1d12') };
function paintBridge(b: Buf, v: number): void {
  b.fill(BRIDGE.gap);
  const rnd = artRng(keySeed('bridge') + v * 53);
  for (let r = 0; r < 4; r++) {
    const y = r * 8;
    const body = sh(BRIDGE.plank, ri(rnd, 13) - 6);
    b.rect(0, y, S, 7, body);
    b.rect(0, y, S, 1, sh(body, 22));
    b.rect(0, y + 6, S, 1, sh(body, -22));
    // grain
    for (let q = 0; q < 2; q++) {
      const gx = 2 + ri(rnd, 22);
      b.rect(gx, y + 2 + ri(rnd, 3), 4 + ri(rnd, 4), 1, sh(body, -12));
    }
    // a butt joint inside the tile
    if (rnd() < 0.6) {
      const jx = 6 + ri(rnd, 20);
      b.rect(jx, y, 1, 7, BRIDGE.gap);
      b.set(jx - 2, y + 3, BRIDGE.nail);
      b.set(jx + 2, y + 3, BRIDGE.nail);
    }
  }
}

// ---------------------------------------------------------------- walls

interface WallLook {
  top: RGB;
  topLight: RGB;
  topDark: RGB;
  crevice: RGB;
  lip: RGB;
  face: RGB;
  faceLight: RGB;
  faceDark: RGB;
  strata: RGB;
  outline: RGB;
  /** Face height inside the wall cell. */
  fh: number;
  /** Brick courses and a dark cap instead of rock plates and rock columns. */
  masonry: boolean;
  /** Bits of vegetation on top (cliffs). */
  tuft?: [RGB, RGB];
}

const WALLS: Readonly<Record<number, WallLook>> = {
  [T.CLIFF]: {
    top: hx('#7f7766'),
    topLight: hx('#958c79'),
    topDark: hx('#686152'),
    crevice: hx('#433d33'),
    lip: hx('#aea38c'),
    face: hx('#5e5649'),
    faceLight: hx('#71685a'),
    faceDark: hx('#3f3931'),
    strata: hx('#4a443a'),
    outline: hx(PAL.outline),
    fh: 18,
    masonry: false,
    tuft: [hx('#56702f'), hx('#7a9845')],
  },
  [T.CAVE_WALL]: {
    top: hx('#544b43'),
    topLight: hx('#655a50'),
    topDark: hx('#463e37'),
    crevice: hx('#2a2420'),
    lip: hx('#7d7064'),
    face: hx('#3f3731'),
    faceLight: hx('#4d443c'),
    faceDark: hx('#2a2420'),
    strata: hx('#332c27'),
    outline: hx('#130f0c'),
    fh: 18,
    masonry: false,
  },
  [T.CRYPT_WALL]: {
    top: hx('#2e2b38'),
    topLight: hx('#3a3646'),
    topDark: hx('#25222d'),
    crevice: hx('#1d1b24'),
    lip: hx('#7a7490'),
    face: hx('#544f68'),
    faceLight: hx('#67617e'),
    faceDark: hx('#3a3649'),
    strata: hx('#26232f'),
    outline: hx('#121017'),
    fh: 20,
    masonry: true,
  },
};

/** Toroidal Voronoi plates for rock tops (layout shared by every variant so edges always match). */
interface Plates {
  /** nearest plate id per pixel */
  id: Uint8Array;
  /** distance to the plate border (second-nearest minus nearest) */
  edge: Float32Array;
  /** +1 when the pixel lies on the lower-right half of its plate (shadow side) */
  side: Int8Array;
}
const plateCache = new Map<number, Plates>();
function rockPlates(seed: number): Plates {
  const hit = plateCache.get(seed);
  if (hit) return hit;
  const rnd = artRng(seed);
  const pts: [number, number][] = [];
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) pts.push([(gx + 0.2 + rnd() * 0.6) * (S / 3), (gy + 0.2 + rnd() * 0.6) * (S / 3)]);
  const id = new Uint8Array(S * S);
  const edge = new Float32Array(S * S);
  const side = new Int8Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let best = 0;
      let bdx = 0;
      let bdy = 0;
      pts.forEach(([px, py], i) => {
        for (const ox of [-S, 0, S])
          for (const oy of [-S, 0, S]) {
            const dx = x + 0.5 - (px + ox);
            const dy = (y + 0.5 - (py + oy)) * 1.25;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d2 = d1;
              d1 = d;
              best = i;
              bdx = dx;
              bdy = dy;
            } else if (d < d2) d2 = d;
          }
      });
      id[y * S + x] = best;
      edge[y * S + x] = d2 - d1;
      side[y * S + x] = bdx + bdy > 0 ? 1 : -1;
    }
  const out = { id, edge, side };
  plateCache.set(seed, out);
  return out;
}

function paintWallTop(b: Buf, t: number, v: number): void {
  const L = WALLS[t];
  const rnd = artRng(keySeed('walltop') + t * 101 + v * 7);
  const place = makePlacer(rnd, () => true);
  if (L.masonry) {
    // dark capstones: big 16 px slabs, faint seams, worn specks
    b.fill(L.top);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const sx = (x + (y < 16 ? 0 : 8)) % 16;
        const sy = y % 16;
        if (sx === 15 || sy === 15) b.set(x, y, L.crevice);
        else if (sx === 0 || sy === 0) b.set(x, y, L.topLight);
      }
    const n = 2 + v;
    for (let i = 0; i < n; i++) {
      const p = place(2, 1, 2);
      if (p) b.set(p[0], p[1], rnd() < 0.5 ? L.topLight : L.topDark);
    }
    return;
  }
  // rock plateau: irregular plates with dark crevices, lit upper-left rims, shaded lower-right rims
  const pl = rockPlates(keySeed('plates') + t);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const tone = sh(L.top, ((pl.id[i] * 5) % 7) * 2 - 6);
      let c = tone;
      const e = pl.edge[i];
      if (e < 1.1) c = L.crevice;
      else if (e < 2.3) c = pl.side[i] > 0 ? L.topDark : L.topLight;
      b.set(x, y, c);
    }
  for (let i = 0; i < 3; i++) {
    const p = place(2, 1);
    if (p) b.set(p[0], p[1], rnd() < 0.5 ? L.topLight : L.topDark);
  }
  if (v === 1) {
    const p = place(5, 3);
    if (p) {
      // a loose stone sitting on the plateau
      const [x, y] = p;
      b.rect(x + 1, y, 3, 1, L.lip);
      b.rect(x, y + 1, 5, 1, L.topLight);
      b.rect(x, y + 2, 5, 1, L.faceDark);
    }
  }
  if (v === 2) {
    const p = place(4, 3);
    if (p) {
      if (L.tuft) stamp(b, p[0], p[1], TUFTS[1], { d: L.tuft[0], l: L.tuft[1], h: sh(L.tuft[1], 20) });
      else {
        b.rect(p[0], p[1] + 1, 3, 1, L.crevice);
        b.rect(p[0] + 1, p[1] + 2, 3, 1, L.crevice);
      }
    }
  }
}

/** Rock face columns (period 32, shared by every variant): [start, width, tone shift, crack start depth]. */
const faceColCache = new Map<number, [number, number, number, number][]>();
function faceColumns(seed: number): [number, number, number, number][] {
  const hit = faceColCache.get(seed);
  if (hit) return hit;
  const rnd = artRng(seed);
  const cols: [number, number, number, number][] = [];
  let x = 0;
  while (x < S) {
    let w = 4 + ri(rnd, 4);
    if (S - (x + w) < 4) w = S - x;
    cols.push([x, w, [0, 9, -7][cols.length % 3] + ri(rnd, 5) - 2, ri(rnd, 8)]);
    x += w;
  }
  faceColCache.set(seed, cols);
  return cols;
}

/** One face pixel: rock columns or brick courses, with a lit top edge and ambient occlusion at the foot. */
function facePixel(L: WallLook, t: number, x: number, depth: number, h: number): RGB {
  let c: RGB;
  if (L.masonry) {
    const row = Math.floor(depth / 5);
    const off = row % 2 ? 4 : 0;
    const k = depth % 5;
    const mortar = k === 4 || (x + off) % 8 === 7;
    c = mortar ? L.strata : k === 0 ? L.faceLight : k === 3 ? sh(L.face, -8) : L.face;
    if (!mortar && (x + off) % 8 === 0) c = sh(c, 6);
  } else {
    const cols = faceColumns(keySeed('facecols') + t);
    let col = cols[0];
    for (const cc of cols) if (x >= cc[0] && x < cc[0] + cc[1]) col = cc;
    const [start, w, tone, crack] = col;
    c = sh(L.face, tone);
    if (x === start) c = sh(c, 10);
    if (x === start + w - 1 && depth >= crack) c = L.strata;
    if (depth === 0) c = L.faceLight;
    if (depth === 1 && x !== start + w - 1) c = sh(c, 6);
  }
  if (depth >= h - 4) c = mixc(c, L.faceDark, (depth - (h - 5)) / 5);
  return c;
}

// ================================================================== tile table

type TilePainter = (b: Buf, v: number) => void;
const groundTile =
  (g: Ground, seed: string, extra?: (b: Buf, rnd: Rnd, place: Place, v: number) => void): TilePainter =>
  (b, v) =>
    paintGround(b, g, keySeed(seed), v, extra ? (bb, rnd, place) => extra(bb, rnd, place, v) : undefined);

const TILE_PAINT: Record<number, TilePainter> = {
  [T.GRASS]: groundTile(G.grass, 'grass'),
  [T.GRASS2]: groundTile(G.grass2, 'grass2'),
  [T.FLOWERS]: groundTile(G.grass, 'flowers', (b, rnd, place, v) => flowers(b, rnd, place, v)),
  [T.PATH]: groundTile(G.path, 'path'),
  [T.WATER]: groundTile(G.water, 'water'),
  [T.SAND]: groundTile(G.sand, 'sand'),
  [T.STONE]: groundTile(G.stone, 'stone'),
  [T.DARK]: groundTile(G.dark, 'dark'),
  [T.COBBLE]: paintCobble,
  [T.BRIDGE]: paintBridge,
  [T.EMBER]: groundTile(G.ember, 'ember'),
  [T.HILL]: groundTile(G.hill, 'hill'),
  [T.DEEP]: groundTile(G.deep, 'deep'),
  [T.CAVE]: groundTile(G.cave, 'cave'),
  [T.CAVE_WALL]: (b, v) => paintWallTop(b, T.CAVE_WALL, v),
  [T.CRYPT]: paintCrypt,
  [T.CRYPT_WALL]: (b, v) => paintWallTop(b, T.CRYPT_WALL, v),
  [T.SNOW]: groundTile(G.snow, 'snow'),
  [T.ICE]: groundTile(G.ice, 'ice'),
  [T.BASALT]: paintBasalt,
  [T.LAVA]: groundTile(G.lava, 'lava'),
  [T.DUSK]: groundTile(G.dusk, 'dusk'),
  [T.STORMGRASS]: groundTile(G.storm, 'storm'),
  [T.VOID]: groundTile(G.void, 'void'),
  [T.CLIFF]: (b, v) => paintWallTop(b, T.CLIFF, v),
  [T.GLADE]: groundTile(G.glade, 'glade'),
  [T.MOSS]: groundTile(G.moss, 'moss'),
};

// ================================================================== edge pieces: shape field

const P = S + 2; // padded coverage grid: x, y in [-1, 32]
const pi = (x: number, y: number) => (y + 1) * P + (x + 1);

/** Interior weight: 0 within ~3 px of the cell border (edge profile shared by all pieces), 1 deeper inside. */
const INTERIOR: Float32Array = (() => {
  const m = new Float32Array(P * P);
  for (let y = -1; y <= S; y++)
    for (let x = -1; x <= S; x++) {
      const d = Math.min(x + 0.5, S - 0.5 - x, y + 0.5, S - 0.5 - y);
      m[pi(x, y)] = clamp((d - 2.5) / 4, 0, 1);
    }
  return m;
})();

/** 32-periodic smooth noise (integer frequencies), sampled at pixel centres on the padded grid, range ~[-1, 1]. */
function periodicNoise(seed: number, hiFreq = false): Float32Array {
  const rnd = artRng(seed);
  const pool: [number, number][] = hiFreq
    ? [
        [2, 0],
        [0, 2],
        [2, 1],
        [1, 2],
        [3, 0],
        [0, 3],
        [3, 1],
        [1, 3],
        [4, 1],
        [1, 4],
        [3, -2],
        [2, -3],
      ]
    : [
        [1, 0],
        [0, 1],
        [1, 1],
        [1, -1],
        [2, 0],
        [0, 2],
        [2, 1],
        [1, 2],
        [2, -1],
        [-1, 2],
        [3, 1],
        [1, 3],
        [3, 0],
        [0, 3],
      ];
  const terms: [number, number, number, number][] = [];
  const used = new Set<number>();
  while (terms.length < 7) {
    const k = ri(rnd, pool.length);
    if (used.has(k)) continue;
    used.add(k);
    const [fx, fy] = pool[k];
    terms.push([fx, fy, 1 / Math.pow(Math.hypot(fx, fy), 0.7), rnd() * Math.PI * 2]);
  }
  const out = new Float32Array(P * P);
  let max = 0;
  for (let y = -1; y <= S; y++)
    for (let x = -1; x <= S; x++) {
      let v = 0;
      for (const [fx, fy, a, ph] of terms) v += a * Math.sin(((fx * (x + 0.5) + fy * (y + 0.5)) / S) * Math.PI * 2 + ph);
      out[pi(x, y)] = v;
      max = Math.max(max, Math.abs(v));
    }
  for (let i = 0; i < out.length; i++) out[i] /= max || 1;
  return out;
}

/** Family noise for a variant: shared near the cell border, variant-specific inside. Cached. */
const noiseCache = new Map<string, Float32Array>();
function familyNoise(family: string, variant: number, hiFreq = false): Float32Array {
  const key = `${family}:${variant}:${hiFreq ? 1 : 0}`;
  const hit = noiseCache.get(key);
  if (hit) return hit;
  const n0 = periodicNoise(keySeed(`edge-${family}`), hiFreq);
  let out = n0;
  if (variant !== 0) {
    const nv = periodicNoise(keySeed(`edge-${family}-${variant}`), hiFreq);
    out = new Float32Array(P * P);
    for (let i = 0; i < out.length; i++) out[i] = n0[i] + (nv[i] - n0[i]) * INTERIOR[i];
  }
  noiseCache.set(key, out);
  return out;
}

/** Corner distance: mostly a chamfer (L1) blended with Euclid, so stair-stepped diagonals turn into ~45 degree edges. */
const CHAMFER = 0.7;
const cdist = (dx: number, dy: number) => {
  const ax = dx < 0 ? -dx : dx;
  const ay = dy < 0 ? -dy : dy;
  return CHAMFER * (ax + ay) + (1 - CHAMFER) * Math.sqrt(ax * ax + ay * ay);
};

/**
 * Signed distance-like shape of the overlay for a corner mask (negative = covered). Chamfered quarter discs of radius D
 * around set corners, bands of depth D along fully-set edges, and for three set corners the complement of a disc around
 * the missing corner (a deep inner fillet). Every profile crosses a cell edge at depth D from the set corner.
 */
function shapeG(mask: number, D: number, x: number, y: number): number {
  if (mask === 0) return 1e6;
  if (mask === 15) return -1e6;
  const nw = mask & CORNER.NW;
  const ne = mask & CORNER.NE;
  const sw = mask & CORNER.SW;
  const se = mask & CORNER.SE;
  const bits = (nw ? 1 : 0) + (ne ? 1 : 0) + (sw ? 1 : 0) + (se ? 1 : 0);
  if (bits === 3) {
    const cx = !ne || !se ? S : 0;
    const cy = !sw || !se ? S : 0;
    return S - D - cdist(x - cx, y - cy);
  }
  let g = 1e6;
  if (nw && ne) g = Math.min(g, y - D);
  if (sw && se) g = Math.min(g, S - y - D);
  if (nw && sw) g = Math.min(g, x - D);
  if (ne && se) g = Math.min(g, S - x - D);
  if (nw) g = Math.min(g, cdist(x, y) - D);
  if (ne) g = Math.min(g, cdist(x - S, y) - D);
  if (sw) g = Math.min(g, cdist(x, y - S) - D);
  if (se) g = Math.min(g, cdist(x - S, y - S) - D);
  return g;
}

/** shapeG sampled on the padded grid (pixel centres). Cached per (mask, D). */
const shapeCache = new Map<number, Float32Array>();
function shapeField(mask: number, D: number): Float32Array {
  const key = mask * 1000 + D;
  const hit = shapeCache.get(key);
  if (hit) return hit;
  const f = new Float32Array(P * P);
  for (let y = -1; y <= S; y++) for (let x = -1; x <= S; x++) f[pi(x, y)] = shapeG(mask, D, x + 0.5, y + 0.5);
  shapeCache.set(key, f);
  return f;
}

/** Covered pixels on the padded grid for a mask (1 = overlay). */
function coverage(mask: number, D: number, amp: number, noise: Float32Array): Uint8Array {
  const g = shapeField(mask, D);
  const c = new Uint8Array(P * P);
  for (let i = 0; i < c.length; i++) c[i] = g[i] + amp * noise[i] < 0 ? 1 : 0;
  return c;
}

/** Signed field (shape + noise) on the padded grid. */
function field(mask: number, D: number, amp: number, noise: Float32Array): Float32Array {
  const g = shapeField(mask, D);
  const f = new Float32Array(P * P);
  for (let i = 0; i < f.length; i++) f[i] = g[i] + amp * noise[i];
  return f;
}

const cov = (c: Uint8Array, x: number, y: number) => (x < -1 || y < -1 || x > S || y > S ? 0 : c[pi(x, y)]);
const deep = (x: number, y: number) => INTERIOR[pi(x, y)] > 0.99;

/** Grass-blade teeth on the overlay's boundary (interior only, so cell borders stay shared). */
function addTeeth(c: Uint8Array, rnd: Rnd, pUp: number, pDown: number): void {
  for (let y = 1; y < S - 1; y++)
    for (let x = 1; x < S - 1; x++) {
      if (!cov(c, x, y)) continue;
      if (!cov(c, x, y - 1) && deep(x, y - 1) && !cov(c, x - 1, y - 1) && !cov(c, x + 1, y - 1) && rnd() < pUp) {
        c[pi(x, y - 1)] = 1;
        if (rnd() < 0.35 && deep(x, y - 2) && !cov(c, x - 1, y - 2) && !cov(c, x + 1, y - 2)) c[pi(x, y - 2)] = 1;
        x += 2;
      } else if (!cov(c, x, y + 1) && deep(x, y + 1) && !cov(c, x - 1, y + 1) && !cov(c, x + 1, y + 1) && rnd() < pDown) {
        c[pi(x, y + 1)] = 1;
        x += 2;
      }
    }
}

// ================================================================== edge pieces: soft families

interface SoftStyle {
  ground: Ground;
  /** Depth of the spill into the lower cell (px at the cell border). */
  D: number;
  /** Boundary wobble amplitude (px). */
  amp: number;
  hiFreq?: boolean;
  /** 'raised' mats (grass, moss, snow) get a lit top lip, a dark under-lip and teeth; 'flat' get none. */
  kind: 'raised' | 'flat' | 'sunken';
  rim: RGB;
  rimA: number;
  /** Lip colours for raised kinds: [highlight, under-lip]. */
  lip?: [RGB, RGB];
  /** Under-lip thickness (snow drifts are thicker). */
  lipH?: number;
  teeth?: [number, number];
  /** Paints extra things after the fill (e.g. flowers). */
  extra?: (b: Buf, rnd: Rnd, place: Place, v: number) => void;
}

const OUT = hx(PAL.outline);
const grassStyle = (g: Ground, look: { light: string; deep: string }): SoftStyle => ({
  ground: g,
  D: 7,
  amp: 2.2,
  kind: 'raised',
  rim: OUT,
  rimA: 0.5,
  lip: [hx(look.light), hx(look.deep)],
  teeth: [0.3, 0.12],
});

const SOFT: Partial<Record<EdgeFamily, SoftStyle>> = {
  shallow: { ground: G.water, D: 10, amp: 2.6, kind: 'flat', rim: hx('#3578a9'), rimA: 1 },
  ice: { ground: G.ice, D: 7, amp: 1.6, kind: 'raised', rim: hx('#2a5070'), rimA: 0.45, lip: [hx(ICE_LOOK.hi), hx(ICE_LOOK.deep)] },
  cave: { ground: G.cave, D: 8, amp: 2.2, kind: 'flat', rim: OUT, rimA: 0.45 },
  stone: { ground: G.stone, D: 8, amp: 2.2, kind: 'flat', rim: OUT, rimA: 0.45 },
  sand: { ground: G.sand, D: 9, amp: 2, kind: 'flat', rim: hx('#5a4a2a'), rimA: 0.35 },
  grass: grassStyle(G.grass, GRASS_LOOK),
  hill: grassStyle(G.hill, { light: '#99b45d', deep: '#5a7233' }),
  storm: grassStyle(G.storm, { light: '#7d957c', deep: '#465a49' }),
  dusk: grassStyle(G.dusk, { light: '#6e679b', deep: '#3c375c' }),
  glade: grassStyle(G.glade, { light: '#61a47c', deep: '#336449' }),
  dark: grassStyle(G.dark, { light: '#5a6b49', deep: '#313d28' }),
  moss: {
    ground: G.moss,
    D: 8,
    amp: 2.6,
    hiFreq: true,
    kind: 'raised',
    rim: OUT,
    rimA: 0.5,
    lip: [hx(MOSS_LOOK.light), hx(MOSS_LOOK.deep)],
  },
  snow: {
    ground: G.snow,
    D: 9,
    amp: 2.6,
    kind: 'raised',
    rim: hx('#3a4a62'),
    rimA: 0.42,
    lip: [hx(SNOW_LOOK.hi), hx(SNOW_LOOK.shade)],
    lipH: 2,
  },
  ember: { ground: G.ember, D: 8, amp: 2.2, kind: 'flat', rim: OUT, rimA: 0.5 },
  path: { ground: G.path, D: 8, amp: 1.7, kind: 'sunken', rim: OUT, rimA: 0.55 },
};

function softPiece(b: Buf, fam: EdgeFamily, st: SoftStyle, mask: number, v: number, noise: Float32Array): void {
  const rnd = artRng(keySeed(`piece-${fam}`) + mask * 97 + v * 7717);
  const c = coverage(mask, st.D, st.amp, noise);
  if (st.teeth) addTeeth(c, rnd, st.teeth[0], st.teeth[1]);
  const base = st.ground.base;
  const lipH = st.lipH ?? 1;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (cov(c, x, y)) {
        let col = base;
        if (st.kind === 'raised' && st.lip) {
          let under = false;
          for (let k = 1; k <= lipH; k++) if (!cov(c, x, y + k)) under = true;
          if (under) col = st.lip[1];
          else if (!cov(c, x, y - 1) || (!cov(c, x - 1, y) && cov(c, x, y - 1) && !cov(c, x - 1, y - 1))) col = st.lip[0];
        } else if (st.kind === 'sunken' && !cov(c, x, y - 1)) {
          col = sh(base, -14);
        }
        b.set(x, y, col);
        continue;
      }
      const n4 = cov(c, x - 1, y) || cov(c, x + 1, y) || cov(c, x, y - 1) || cov(c, x, y + 1);
      if (n4) {
        b.set(x, y, st.rim, st.rimA);
        continue;
      }
      if (st.kind === 'raised' && cov(c, x, y - 2)) b.set(x, y, st.rim, st.rimA * 0.35); // soft cast shadow
    }
  // details strictly inside the covered area (1 px clear of the boundary)
  const inside = (x: number, y: number) =>
    cov(c, x, y) === 1 && cov(c, x - 1, y) === 1 && cov(c, x + 1, y) === 1 && cov(c, x, y - 1) === 1 && cov(c, x, y + 1) === 1;
  const place = makePlacer(rnd, inside);
  if (st.extra) st.extra(b, rnd, place, v);
  st.ground.deco(b, rnd, place, v, 0.7);
}

/** Cobble spill: whole stones whose centre lies inside the shape, wrapped in mortar and an outline. */
function cobblePiece(b: Buf, mask: number, v: number, noise: Float32Array): void {
  const f = field(mask, 9, 2.4, noise);
  const own = new Uint8Array(P * P);
  const chosen: Stone[] = [];
  for (const st of COBBLES) {
    // the stone's centre may sit in a neighbouring cell: test every toroidal copy that touches this cell
    for (const ox of [-S, 0, S])
      for (const oy of [-S, 0, S]) {
        const cx = st.x + ox + (st.w - 1) / 2;
        const cy = st.y + oy + (st.h - 1) / 2;
        if (cx < -6 || cy < -6 || cx > S + 6 || cy > S + 6) continue;
        const g = shapeG(mask, 9, cx, cy) + 2.4 * f[pi(clamp(Math.floor(cx), -1, S), clamp(Math.floor(cy), -1, S))] * 0;
        if (g < 0) {
          chosen.push({ ...st, x: st.x + ox, y: st.y + oy });
        }
      }
  }
  for (const st of chosen)
    for (let j = -1; j < st.h; j++)
      for (let i = -1; i < st.w; i++) {
        const x = st.x + i;
        const y = st.y + j;
        if (x >= -1 && y >= -1 && x <= S && y <= S) own[pi(x, y)] = 1;
      }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (own[pi(x, y)]) b.set(x, y, COBBLE.mortar);
      else if (cov(own, x - 1, y) || cov(own, x + 1, y) || cov(own, x, y - 1) || cov(own, x, y + 1)) b.set(x, y, OUT, 0.55);
    }
  const vr = artRng(keySeed('cobble') + 0);
  void vr;
  for (const st of chosen) {
    const base = COBBLES.find((s) => s.seed === st.seed)!;
    const rnd = artRng(base.wraps ? base.seed : base.seed + v * 0);
    const inCell = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S;
    // draw unwrapped at the chosen offset
    const tmp: Stone = { ...st };
    const tone = sh(COBBLE.body, ri(rnd, 17) - 8);
    const warm = rnd() < 0.3;
    const body = warm ? mixc(tone, hx('#a8957a'), 0.35) : tone;
    for (let j = 0; j < tmp.h - 1; j++)
      for (let i = 0; i < tmp.w - 1; i++) {
        const corner = (j === 0 || j === tmp.h - 2) && (i === 0 || i === tmp.w - 2);
        if (corner) continue;
        let col = body;
        if (j === 0 || i === 0) col = sh(body, 16);
        if (j === tmp.h - 2 || i === tmp.w - 2) col = sh(body, -18);
        if (j === 0 && i === 1) col = sh(body, 26);
        const x = tmp.x + i;
        const y = tmp.y + j;
        if (inCell(x, y)) b.set(x, y, col);
      }
  }
}

/** Basalt spill: whole hex column tops whose centre is inside the shape. */
let basaltFull: Buf | null = null;
function basaltPiece(b: Buf, mask: number): void {
  if (!basaltFull) {
    basaltFull = new Buf();
    paintBasalt(basaltFull, 0);
  }
  const full = basaltFull;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const h = hexCellAt(x, y);
      const cx = x + 0.5 - h.dx;
      const cy = y + 0.5 - h.dy / 1.15;
      if (shapeG(mask, 9, cx, cy) < 0) b.set(x, y, full.rgb(x, y));
    }
  // outline around the included columns
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && b.alpha(x, y) > 0;
  const marks: [number, number][] = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push([x, y]);
  for (const [x, y] of marks) b.set(x, y, BASALT.gap, 0.85);
}

// ================================================================== edge pieces: underlays

const FOAM = { foam: hx(PAL.foam), shallow: hx('#5d9fcb'), wet: hx('#78b4d8') };

/** Shore foam on a water cell: a lighter shallow band and a broken foam line just beyond the land's edge. */
function foamPiece(b: Buf, mask: number, v: number): void {
  const f = field(mask, 8, 2.2, familyNoise('foam', v));
  const rnd = artRng(keySeed('foam') + mask * 13 + v * 101);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const g = f[pi(x, y)];
      if (g < -1) b.set(x, y, FOAM.wet, 0.55);
      else if (g < 1.2) b.set(x, y, FOAM.foam, ((x * 7 + y * 3) % 11 === 0 ? 0.5 : 0.95));
      else if (g < 2.2) b.set(x, y, FOAM.wet, 0.6);
      else if (g < 7) b.set(x, y, FOAM.shallow, 0.38);
    }
  // a few loose foam flecks offshore
  for (let i = 0; i < 4; i++) {
    const x = 1 + ri(rnd, S - 3);
    const y = 1 + ri(rnd, S - 2);
    const g = f[pi(x, y)];
    if (g > 3 && g < 6) {
      b.set(x, y, FOAM.foam, 0.9);
      b.set(x + 1, y, FOAM.foam, 0.6);
    }
  }
}

/** Lava glow on a lava cell under the land's edge: a dark cooled crust, then a bright rim. */
function lavaGlowPiece(b: Buf, mask: number, v: number): void {
  const f = field(mask, 8, 2.2, familyNoise('lavaglow', v));
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const g = f[pi(x, y)];
      if (g < 0.5) b.set(x, y, hx(LAVA_LOOK.crust));
      else if (g < 1.6) b.set(x, y, hx(LAVA_LOOK.white));
      else if (g < 3.2) b.set(x, y, hx(LAVA_LOOK.hotter));
      else if (g < 6) b.set(x, y, hx(LAVA_LOOK.hot), 0.7);
    }
}

const ABYSS = { lip: hx('#6a6070'), face: [hx('#544b5a'), hx('#453d4b'), hx('#37303d'), hx('#2a2430'), hx('#1e1a23'), hx('#15121a')] };

/** Abyss face on a void cell: the rock wall dropping away under land to the north, dark rims elsewhere. */
function abyssPiece(b: Buf, mask: number, v: number): void {
  const f = field(mask, 8, 2, familyNoise('abyss', v));
  const landGrid = new Uint8Array(P * P);
  for (let i = 0; i < landGrid.length; i++) landGrid[i] = f[i] < -1.5 ? 1 : 0;
  // beyond the top edge the top-edge profile continues upward
  const land = (x: number, y: number) => landGrid[pi(clamp(x, -1, S), clamp(y, -1, S))] === 1;
  const FH = 14;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (land(x, y)) {
        b.set(x, y, ABYSS.face[0]);
        continue;
      }
      let up = 0;
      for (let k = 1; k <= FH; k++)
        if (land(x, y - k)) {
          up = k;
          break;
        }
      if (up) {
        const band = Math.min(ABYSS.face.length - 1, Math.floor(((up - 1) / FH) * ABYSS.face.length));
        let col = ABYSS.face[band];
        if (up === 1) col = ABYSS.lip;
        if ((x * 5 + 3) % 9 === 0 && up > 2) col = sh(col, -10);
        b.set(x, y, col);
      } else if (land(x - 1, y) || land(x + 1, y) || land(x, y + 1)) b.set(x, y, ABYSS.face[3]);
    }
}

// ================================================================== edge pieces: walls

/** Wall face family, drawn ON the wall cell. mask = corners touching floor. */
function wallFacePiece(b: Buf, t: number, mask: number, v: number): void {
  const L = WALLS[t];
  const nw = !!(mask & CORNER.NW);
  const ne = !!(mask & CORNER.NE);
  const sw = !!(mask & CORNER.SW);
  const se = !!(mask & CORNER.SE);
  const noise = familyNoise(`wall-${t}`, v);
  // face top (where the top surface breaks into the face): wobbling rock, straight masonry
  const faceTop = (x: number) => S - L.fh + (L.masonry ? 0 : Math.round(noise[pi(x, 6)] * 1.6));
  const south = sw && se;
  if (south) {
    for (let x = 0; x < S; x++) {
      const top = faceTop(x);
      b.set(x, top - 2, L.lip, L.masonry ? 1 : 0.45);
      b.set(x, top - 1, L.lip);
      for (let y = top; y < S; y++) b.set(x, y, facePixel(L, t, x, y - top, S - top));
    }
  }
  // lit north lip
  if (nw && ne) {
    b.rect(0, 0, S, 1, L.lip);
    b.rect(0, 1, S, 1, L.masonry ? L.topLight : mixc(L.lip, L.top, 0.5));
  }
  // west edge lit, east edge in shade
  if (nw && sw) {
    for (let y = 0; y < S; y++) {
      const inFace = south && y >= faceTop(0);
      b.set(0, y, inFace ? sh(L.faceLight, 8) : L.lip);
      if (!inFace) b.set(1, y, mixc(L.lip, L.top, 0.5));
    }
  }
  if (ne && se) {
    for (let y = 0; y < S; y++) {
      const inFace = south && y >= faceTop(S - 1);
      b.set(S - 1, y, inFace ? L.faceDark : L.crevice);
    }
  }
  // the face ends where a perpendicular wall continues (inner corners of the floor)
  if (se && !sw && !ne) for (let y = faceTop(S - 1) - 1; y < S; y++) b.set(S - 1, y, L.crevice);
  if (sw && !se && !nw) for (let y = faceTop(0) - 1; y < S; y++) b.set(0, y, L.lip);
  if (nw && !ne && !sw) b.set(0, 0, L.lip);
  if (ne && !nw && !se) b.set(S - 1, 0, L.lip);
  // vegetation spilling over cliff tops
  if (L.tuft && south && v === 1) {
    const rnd = artRng(mask * 31 + t);
    const x = 6 + ri(rnd, 18);
    stamp(b, x, faceTop(x) - 3, ['l.l', 'dld', 'ddd', '.d.'], { d: L.tuft[0], l: L.tuft[1] });
  }
}

/** Wall rim family, drawn on the FLOOR cell: the wall's outline, rubble at the face foot and a cast shadow. */
function wallRimPiece(b: Buf, t: number, mask: number, v: number): void {
  const L = WALLS[t];
  const nw = !!(mask & CORNER.NW);
  const ne = !!(mask & CORNER.NE);
  const sw = !!(mask & CORNER.SW);
  const se = !!(mask & CORNER.SE);
  const noise = familyNoise(`rim-${t}`, v);
  const rnd = artRng(keySeed(`rim-${t}`) + mask * 17 + v * 3);
  const shadow = (x: number, y: number, a: number) => b.set(x, y, L.outline, a);
  // wall to the north: the face foot (rock bumps for cliffs), outline and a cast shadow
  if (nw && ne) {
    for (let x = 0; x < S; x++) {
      const bump = L.masonry ? 0 : Math.max(0, Math.round(INTERIOR[pi(x, 2)] * (0.8 + 1.6 * noise[pi(x, 2)])));
      for (let y = 0; y < bump; y++) b.set(x, y, y === bump - 1 ? L.faceDark : mixc(L.face, L.faceDark, 0.6));
      b.set(x, bump, L.outline);
      shadow(x, bump + 1, 0.34);
      shadow(x, bump + 2, 0.2);
      shadow(x, bump + 3, 0.08);
    }
    // one fallen stone at the foot of rock walls
    if (!L.masonry && rnd() < 0.6) {
      const x = 5 + ri(rnd, 20);
      const y = 5 + ri(rnd, 3);
      b.rect(x, y - 1, 3, 1, L.outline, 0.7);
      b.set(x - 1, y, L.outline, 0.7);
      b.set(x + 3, y, L.outline, 0.7);
      b.set(x - 1, y + 1, L.outline);
      b.set(x + 3, y + 1, L.outline);
      b.rect(x, y, 3, 1, L.lip);
      b.rect(x, y + 1, 3, 1, L.face);
      b.rect(x, y + 2, 3, 1, L.outline);
    }
  }
  // wall to the west: outline + shadow to the east (light from the top-left)
  if (nw && sw) {
    for (let y = 0; y < S; y++) {
      b.set(0, y, L.outline);
      shadow(1, y, 0.3);
      shadow(2, y, 0.12);
    }
  }
  // wall to the east: thin outline only
  if (ne && se) for (let y = 0; y < S; y++) b.set(S - 1, y, L.outline, 0.9);
  // wall to the south: its lit back edge meets the floor along an outline
  if (sw && se) for (let x = 0; x < S; x++) b.set(x, S - 1, L.outline);
  // a north-west wall corner touching only our corner: short shadow wedge
  if (nw && !ne && !sw) {
    shadow(0, 0, 0.3);
    shadow(1, 0, 0.18);
    shadow(0, 1, 0.18);
  }
}

// ================================================================== atlases

function blitToAtlas(img: ImageData, src: Buf, col: number, row: number): void {
  const step = S + TILE_SPACING;
  const ox = TILE_MARGIN + col * step;
  const oy = TILE_MARGIN + row * step;
  const W = img.width;
  const d = img.data;
  // cell + 1 px extrusion on every side (clamped copy of the border pixels)
  for (let y = -1; y <= S; y++)
    for (let x = -1; x <= S; x++) {
      const sx = clamp(x, 0, S - 1);
      const sy = clamp(y, 0, S - 1);
      const si = (sy * S + sx) * 4;
      const di = ((oy + y) * W + (ox + x)) * 4;
      d[di] = src.d[si];
      d[di + 1] = src.d[si + 1];
      d[di + 2] = src.d[si + 2];
      d[di + 3] = src.d[si + 3];
    }
}

function sheetSize(cols: number, rows: number): [number, number] {
  return [TILE_MARGIN * 2 + cols * S + (cols - 1) * TILE_SPACING, TILE_MARGIN * 2 + rows * S + (rows - 1) * TILE_SPACING];
}

function registerFrames(scene: Phaser.Scene, key: string, cols: number, rows: number, frameOf: (col: number, row: number) => number): void {
  const tex = scene.textures.get(key);
  const step = S + TILE_SPACING;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) tex.add(frameOf(c, r), 0, TILE_MARGIN + c * step, TILE_MARGIN + r * step, S, S);
}

/** One base tile (32x32 RGBA) — exported for contact sheets / tests. */
export function paintTile(tileId: number, variant: number): ImageData {
  const b = new Buf();
  (TILE_PAINT[tileId] ?? ((bb: Buf) => bb.fill(0xff00ff)))(b, variant);
  return new ImageData(b.d, S, S);
}

/** One edge piece (32x32 RGBA, transparent where the base shows through). */
export function paintEdgePiece(family: EdgeFamily, mask: number, variant: number): ImageData {
  const b = new Buf();
  drawPiece(b, family, mask, variant);
  return new ImageData(b.d, S, S);
}

const WALL_OF: Partial<Record<EdgeFamily, number>> = {
  cliff_face: T.CLIFF,
  cliff_rim: T.CLIFF,
  cavewall_face: T.CAVE_WALL,
  cavewall_rim: T.CAVE_WALL,
  crypt_face: T.CRYPT_WALL,
  crypt_rim: T.CRYPT_WALL,
};

function drawPiece(b: Buf, fam: EdgeFamily, mask: number, v: number): void {
  if (mask === 0) return;
  const wall = WALL_OF[fam];
  if (wall !== undefined) {
    if (fam.endsWith('_face')) wallFacePiece(b, wall, mask, v);
    else wallRimPiece(b, wall, mask, v);
    return;
  }
  switch (fam) {
    case 'foam':
      return foamPiece(b, mask, v);
    case 'lavaglow':
      return lavaGlowPiece(b, mask, v);
    case 'abyss':
      return abyssPiece(b, mask, v);
    case 'cobble':
      return cobblePiece(b, mask, v, familyNoise('cobble', v));
    case 'basalt':
      return basaltPiece(b, mask);
  }
  const st = SOFT[fam];
  if (!st) return;
  softPiece(b, fam, st, mask, v, familyNoise(fam, v, st.hiFreq));
}

/**
 * Builds 'tiles' (base atlas) and 'tiles_edge' (autotile pieces). Idempotent per key.
 * Call once at boot before the first map is baked.
 */
export function drawTiles(scene: Phaser.Scene): void {
  if (!scene.textures.exists('tiles')) {
    const [w, h] = sheetSize(TILE_COUNT, TILE_VARIANTS);
    pixelTex(scene, 'tiles', w, h, (c) => {
      const img = c.createImageData(w, h);
      for (let v = 0; v < TILE_VARIANTS; v++)
        for (let t = 0; t < TILE_COUNT; t++) {
          const b = new Buf();
          (TILE_PAINT[t] ?? ((bb: Buf) => bb.fill(0xff00ff)))(b, v);
          blitToAtlas(img, b, t, v);
        }
      c.putImageData(img, 0, 0);
    });
    registerFrames(scene, 'tiles', TILE_COUNT, TILE_VARIANTS, (c, r) => r * TILE_COUNT + c);
  }
  if (!scene.textures.exists('tiles_edge')) {
    const [w, h] = sheetSize(EDGE_COLS, EDGE_ROWS);
    pixelTex(scene, 'tiles_edge', w, h, (c) => {
      const img = c.createImageData(w, h);
      EDGE_FAMILIES.forEach((fam, row) => {
        for (let v = 0; v < EDGE_VARIANTS; v++)
          for (let mask = 1; mask < 16; mask++) {
            const b = new Buf();
            drawPiece(b, fam, mask, v);
            blitToAtlas(img, b, v * 16 + mask, row);
          }
      });
      c.putImageData(img, 0, 0);
    });
    registerFrames(scene, 'tiles_edge', EDGE_COLS, EDGE_ROWS, (c, r) => edgeFrame(r, c & 15, c >> 4));
  }
}
