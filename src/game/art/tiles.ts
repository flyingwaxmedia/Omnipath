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
  DECALS_PER_SET,
  DECAL_PX,
  DECAL_SETS,
  EDGE_COLS,
  EDGE_FAMILIES,
  EDGE_ROWS,
  EDGE_VARIANTS,
  TILE_MARGIN,
  TILE_SPACING,
  TILE_VARIANTS,
  edgeFrame,
  type DecalSet,
  type EdgeFamily,
} from '../render/autotile';
import { PAL, artRng, keySeed, pixelTex } from './pixel';

export {
  CORNER,
  DECALS_PER_SET,
  DECAL_PX,
  DECAL_SETS,
  EDGE_FAMILIES,
  EDGE_VARIANTS,
  TILE_MARGIN,
  TILE_SPACING,
  TILE_VARIANTS,
  atlasIndex,
  decalFrame,
  edgeFrame,
  edgeFrameInfo,
  type DecalSet,
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
        const pw = 7 + ri(rnd, 6);
        const ph = 4 + ri(rnd, 3);
        const p = place(pw, ph, 0);
        if (p) {
          const tone = sh(hx(g.base), v === 1 ? -4 : 3);
          for (let j = 0; j < ph; j++)
            for (let i = 0; i < pw; i++) {
              const dx = (i - (pw - 1) / 2) / (pw / 2);
              const dy = (j - (ph - 1) / 2) / (ph / 2);
              if (dx * dx + dy * dy < 0.95 - rnd() * 0.45) b.set(p[0] + i, p[1] + j, tone);
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
        const pw = 7 + ri(rnd, 6);
        const ph = 4 + ri(rnd, 3);
        const p = place(pw, ph, 0);
        if (p) {
          const tone = sh(base, v === 1 ? -4 : 4);
          for (let j = 0; j < ph; j++)
            for (let i = 0; i < pw; i++) {
              const dx = (i - (pw - 1) / 2) / (pw / 2);
              const dy = (j - (ph - 1) / 2) / (ph / 2);
              if (dx * dx + dy * dy < 0.95 - rnd() * 0.45) b.set(p[0] + i, p[1] + j, tone);
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
  dark: '#8a7553',
  light: '#b09b75',
  stone: '#b5a585',
  stoneHi: '#cbbd9d',
  pebbles: 1,
  specks: 5,
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
      const n = count(rnd, v === 0 ? 1 : v === 1 ? 2 : 0, density);
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
      const ns = count(rnd, 3, density);
      for (let i = 0; i < ns; i++) {
        const p = place(2, 1, 1);
        if (!p) continue;
        b.set(p[0], p[1], rnd() < 0.7 ? hx(SNOW_LOOK.shade) : hx(SNOW_LOOK.deep));
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
      // calm sheet: a faint frost streak in v1 only; decals add cracks and glints at random spots
      if (v === 1 && rnd() < density) {
        const len = 5 + ri(rnd, 4);
        const p = place(len, len);
        if (p) for (let k = 0; k < len; k += 1) b.set(p[0] + k, p[1] + len - 1 - k, hx(ICE_LOOK.light));
      }
      if (density < 1 && rnd() < 0.5) {
        const p = place(7, 3);
        if (p) {
          let y = p[1] + 1;
          for (let k = 0; k < 7; k++) {
            b.set(p[0] + k, y, mixc(base, hx(ICE_LOOK.deep), 0.6));
            b.set(p[0] + k, y + 1, hx(ICE_LOOK.light));
            if (rnd() < 0.3) y = clamp(y + (rnd() < 0.5 ? -1 : 1), p[1], p[1] + 1);
          }
        }
      }
      const ns = count(rnd, 2, density);
      for (let i = 0; i < ns; i++) {
        const p = place(2, 1, 1);
        if (p) b.set(p[0], p[1], rnd() < 0.5 ? hx(ICE_LOOK.light) : mixc(base, hx(ICE_LOOK.dark), 0.5));
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
    cracks: 1,
    crackColor: '#2a1a14',
    glow: '#e8642a',
  }),
  water: waterGround({ base: '#3f86b9', dark: '#3676a8', ripple: '#6aa8d2', sparkle: '#cfeaf6', ripples: 1 }),
  deep: waterGround({ base: '#2d6596', dark: '#275a87', ripple: '#4580b2', sparkle: '#8cc6e6', ripples: 1 }),
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

/** Crypt flagstones: two offset rows of 16 px slabs. */
const SLABS: readonly Stone[] = [
  { x: 0, y: 0, w: 16, h: 16, wraps: false, seed: 11 },
  { x: 16, y: 0, w: 16, h: 16, wraps: false, seed: 23 },
  { x: 8, y: 16, w: 16, h: 16, wraps: false, seed: 37 },
  { x: 24, y: 16, w: 16, h: 16, wraps: true, seed: 41 },
];
function paintCrypt(b: Buf, v: number): void {
  const base = hx('#5a5566');
  b.fill(mixc(base, hx('#2e2a38'), 0.45));
  SLABS.forEach((st) => {
    const rnd = artRng(st.wraps ? st.seed : st.seed + v * 977);
    const body = sh(base, ri(rnd, 9) - 4);
    for (let j = 0; j < st.h - 1; j++)
      for (let k = 0; k < st.w - 1; k++) {
        let c = body;
        if (j === 0 || k === 0) c = sh(body, 7);
        if (j === st.h - 2 || k === st.w - 2) c = sh(body, -9);
        b.set((st.x + k) % S, st.y + j, c);
      }
    // worn speckles
    for (let q = 0; q < 3; q++) b.set((st.x + 3 + ri(rnd, 10)) % S, st.y + 3 + ri(rnd, 10), sh(body, rnd() < 0.5 ? -8 : 6));
  });
}

/** Toroidal Voronoi cells (layout shared by every variant so tile edges always match). */
interface Plates {
  /** nearest cell id per pixel */
  id: Uint8Array;
  /** distance to the cell border (second-nearest minus nearest) */
  edge: Float32Array;
  /** +1 when the pixel lies on the lower-right half of its cell (shadow side) */
  side: Int8Array;
  /** centre of the pixel's cell (nearest toroidal copy, may lie outside the tile) */
  cx: Float32Array;
  cy: Float32Array;
  /** third-nearest minus nearest distance: small near cell vertices (used to round stones) */
  vert: Float32Array;
}
const plateCache = new Map<string, Plates>();
function voronoi(seed: number, n: number, minD: number, yScale: number): Plates {
  const key = `${seed}:${n}:${minD}:${yScale}`;
  const hit = plateCache.get(key);
  if (hit) return hit;
  const rnd = artRng(seed);
  const pts: [number, number][] = [];
  const tdist = (a: [number, number], b: [number, number]) => {
    const dx = Math.min(Math.abs(a[0] - b[0]), S - Math.abs(a[0] - b[0]));
    const dy = Math.min(Math.abs(a[1] - b[1]), S - Math.abs(a[1] - b[1])) * yScale;
    return Math.sqrt(dx * dx + dy * dy);
  };
  // Poisson-ish centres: the first few far apart (big cells), the rest fill in (irregular sizes)
  for (let tries = 0; tries < 600 && pts.length < n; tries++) {
    const c: [number, number] = [rnd() * S, rnd() * S];
    const d = pts.length < 3 ? minD * 1.35 : minD;
    if (pts.every((q) => tdist(q, c) >= d)) pts.push(c);
  }
  const id = new Uint8Array(S * S);
  const edge = new Float32Array(S * S);
  const side = new Int8Array(S * S);
  const cx = new Float32Array(S * S);
  const cy = new Float32Array(S * S);
  const vert = new Float32Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      let d1 = 1e9;
      let d2 = 1e9;
      let d3 = 1e9;
      let best = 0;
      let bx = 0;
      let by = 0;
      pts.forEach(([px, py], i) => {
        for (const ox of [-S, 0, S])
          for (const oy of [-S, 0, S]) {
            const dx = x + 0.5 - (px + ox);
            const dy = (y + 0.5 - (py + oy)) * yScale;
            const d = Math.sqrt(dx * dx + dy * dy);
            if (d < d1) {
              d3 = d2;
              d2 = d1;
              d1 = d;
              best = i;
              bx = px + ox;
              by = py + oy;
            } else if (d < d2) {
              d3 = d2;
              d2 = d;
            } else if (d < d3) d3 = d;
          }
      });
      const i = y * S + x;
      vert[i] = d3 - d1;
      id[i] = best;
      edge[i] = d2 - d1;
      side[i] = x + 0.5 - bx + (y + 0.5 - by) > 0 ? 1 : -1;
      cx[i] = bx;
      cy[i] = by;
    }
  const out = { id, edge, side, cx, cy, vert };
  plateCache.set(key, out);
  return out;
}

/** Voronoi paving (cobble plaza, basalt columns): flat cells with dark joints and bevelled rims. */
interface PavingLook {
  key: string;
  cells: () => Plates;
  gap: RGB;
  top: RGB;
  hi: RGB;
  lo: RGB;
  /** joint half-width and bevel width (px of Voronoi edge distance) */
  joint: number;
  bevel: number;
  /** rounds cell corners: pixels this close to a Voronoi vertex become joint */
  round: number;
  /** tone spread between cells, and the share of warm-tinted cells */
  spread: number;
  warm?: [RGB, number];
}

const COBBLE_PAVE: PavingLook = {
  key: 'cobble',
  cells: () => voronoi(keySeed('cobble-cells'), 12, 6.5, 1.15),
  gap: hx('#5b564d'),
  top: hx('#9c968a'),
  hi: hx('#b6b0a3'),
  lo: hx('#7c766b'),
  joint: 1.1,
  bevel: 2.2,
  round: 3.2,
  spread: 16,
  warm: [hx('#a8957a'), 0.3],
};
const BASALT = { gap: hx('#1c1a20'), top: hx('#423e48'), hi: hx('#57525f'), lo: hx('#34313a') };
const BASALT_PAVE: PavingLook = {
  key: 'basalt',
  cells: () => voronoi(keySeed('basalt-cells'), 9, 8.5, 1.2),
  gap: BASALT.gap,
  top: BASALT.top,
  hi: BASALT.hi,
  lo: BASALT.lo,
  joint: 1.3,
  bevel: 2.5,
  round: 0,
  spread: 5,
};

/** Full extent (bbox) of every cell copy, keyed by its canonical centre. */
const extentCache = new Map<string, Map<string, [number, number, number, number]>>();
function cellExtent(look: PavingLook, cx: number, cy: number): [number, number, number, number] {
  const keyOf = (x: number, y: number) => `${Math.round(((x % S) + S) % S)},${Math.round(((y % S) + S) % S)}`;
  let ext = extentCache.get(look.key);
  if (!ext) {
    const pl = look.cells();
    const m = new Map<string, [number, number, number, number]>();
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const bx = ((pl.cx[i] % S) + S) % S;
        const by = ((pl.cy[i] % S) + S) % S;
        const rx = x - (pl.cx[i] - bx);
        const ry = y - (pl.cy[i] - by);
        const k = keyOf(bx, by);
        const e = m.get(k) ?? [1e9, 1e9, -1e9, -1e9];
        m.set(k, [Math.min(e[0], rx), Math.min(e[1], ry), Math.max(e[2], rx), Math.max(e[3], ry)]);
      }
    extentCache.set(look.key, (ext = m));
  }
  const bx = ((cx % S) + S) % S;
  const by = ((cy % S) + S) % S;
  const e = ext.get(keyOf(bx, by))!;
  return [e[0] + (cx - bx), e[1] + (cy - by), e[2] + (cx - bx), e[3] + (cy - by)];
}

/** Paving tile. Cells wholly inside the tile get variant-specific tones; straddling cells stay fixed (seamless). */
function paintPaving(b: Buf, look: PavingLook, v: number): void {
  const pl = look.cells();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const [x0, y0, x1, y1] = cellExtent(look, pl.cx[i], pl.cy[i]);
      const inner = x0 >= 1 && y0 >= 1 && x1 <= S - 2 && y1 <= S - 2;
      const rnd = artRng(keySeed(`${look.key}-${Math.round(pl.cx[i])},${Math.round(pl.cy[i])}`) + (inner ? v * 7919 : 0));
      let tone = sh(look.top, Math.round((rnd() - 0.5) * look.spread));
      if (look.warm && rnd() < look.warm[1]) tone = mixc(tone, look.warm[0], 0.4);
      const e = pl.edge[i];
      let c = tone;
      if (e < look.joint || pl.vert[i] < look.round) c = look.gap;
      else if (e < look.bevel || pl.vert[i] < look.round + 1.2) c = pl.side[i] > 0 ? mixc(tone, look.lo, 0.7) : mixc(tone, look.hi, 0.7);
      b.set(x, y, c);
    }
}
const paintCobble = (b: Buf, v: number) => paintPaving(b, COBBLE_PAVE, v);
const paintBasalt = (b: Buf, v: number) => paintPaving(b, BASALT_PAVE, v);

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
  // rock mass: Voronoi plates shaded as boulders seen from the south (lit crown, darker front above the crevice)
  const pl = voronoi(keySeed('plates') + t, 7, 11, 1.25);
  const idAt = (x: number, y: number) => pl.id[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  const edgeAt = (x: number, y: number) => pl.edge[(((y % S) + S) % S) * S + (((x % S) + S) % S)];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const id = pl.id[i];
      const tone = sh(L.top, ((id * 5) % 7) * 3 - 9);
      let c = tone;
      if (pl.edge[i] < 1.1) c = L.crevice;
      else {
        // steps down to the next crevice / plate
        let down = 0;
        for (let k = 1; k <= 4; k++)
          if (idAt(x, y + k) !== id || edgeAt(x, y + k) < 1.1) {
            down = k;
            break;
          }
        const upEdge = idAt(x, y - 1) !== id || edgeAt(x, y - 1) < 1.1;
        const upEdge2 = idAt(x, y - 2) !== id || edgeAt(x, y - 2) < 1.1;
        if (down === 1) c = L.faceDark;
        else if (down >= 2 && down <= 3) c = mixc(L.face, tone, 0.25);
        else if (upEdge) c = L.lip;
        else if (upEdge2) c = L.topLight;
        else if (pl.edge[i] < 2.2 && pl.side[i] < 0) c = sh(tone, 6);
      }
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

/**
 * Whether a whole item (cobble stone, basalt column) belongs to a spill piece. Items touching or straddling a cell edge
 * decide from that edge's two corner bits (shared by both cells), items touching a corner from that corner's bit
 * (shared by all four cells), so neighbouring pieces always agree; items inside the cell use the shape at their centre.
 */
function itemIncluded(mask: number, D: number, cx: number, cy: number, x0: number, x1: number, y0: number, y1: number): boolean {
  const bit = (c: number) => (mask & c) !== 0;
  // touching the border counts: the neighbour's item right across the line must make the same call
  const cl = x0 <= 0;
  const cr = x1 >= S - 1;
  const ct = y0 <= 0;
  const cb = y1 >= S - 1;
  const profile = (a: boolean, b: boolean, s: number) => (a && b) || (a && s < D) || (b && s > S - D);
  if ((cl || cr) && (ct || cb)) return bit(ct ? (cl ? CORNER.NW : CORNER.NE) : cl ? CORNER.SW : CORNER.SE);
  if (cl || cr) return profile(bit(cl ? CORNER.NW : CORNER.NE), bit(cl ? CORNER.SW : CORNER.SE), cy);
  if (ct || cb) return profile(bit(ct ? CORNER.NW : CORNER.SW), bit(ct ? CORNER.NE : CORNER.SE), cx);
  return shapeG(mask, D, cx, cy) < 0;
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
  const inGrid = new Uint8Array(S * S);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = pi(x, y);
      inGrid[y * S + x] = c[i] & c[i - 1] & c[i + 1] & c[i - P] & c[i + P];
    }
  const place = makePlacer(rnd, (x, y) => inGrid[y * S + x] === 1);
  if (st.extra) st.extra(b, rnd, place, v);
  st.ground.deco(b, rnd, place, v, 0.7);
}

/** Paving spill (cobble, basalt): whole cells (see itemIncluded) with a dark outline around them. */
const pavingFull = new Map<string, Buf>();
function pavingPiece(b: Buf, look: PavingLook, mask: number, v: number, outlineC: RGB, outlineA: number): void {
  const noise = familyNoise(`paving-${look.key}`, v);
  let full = pavingFull.get(look.key);
  if (!full) {
    full = new Buf();
    paintPaving(full, look, 0);
    pavingFull.set(look.key, full);
  }
  const pl = look.cells();
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = y * S + x;
      const [x0, y0, x1, y1] = cellExtent(look, pl.cx[i], pl.cy[i]);
      const touches = x0 <= 0 || y0 <= 0 || x1 >= S - 1 || y1 >= S - 1;
      // cells inside the piece are this piece's own call: wobble the choice so the edge is irregular per variant
      const inside = touches
        ? itemIncluded(mask, 10, pl.cx[i], pl.cy[i], x0, x1, y0, y1)
        : shapeG(mask, 10, pl.cx[i], pl.cy[i]) + 4 * noise[pi(clamp(Math.round(pl.cx[i]), -1, S), clamp(Math.round(pl.cy[i]), -1, S))] < 0;
      if (inside) b.set(x, y, full.rgb(x, y));
    }
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < S && y < S && b.alpha(x, y) > 0;
  const marks: [number, number][] = [];
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push([x, y]);
  for (const [x, y] of marks) b.set(x, y, outlineC, outlineA);
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
      if (g < 0.5) b.set(x, y, FOAM.wet, 0.6);
      else if (g < 2.6) b.set(x, y, FOAM.foam, (x * 7 + y * 3) % 13 === 0 ? 0.55 : 0.95);
      else if (g < 3.6) b.set(x, y, FOAM.wet, 0.65);
      else if (g < 9) b.set(x, y, FOAM.shallow, 0.35);
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
      if (g < -1.5) continue;
      if (g < 0.6) b.set(x, y, hx(LAVA_LOOK.crust), 0.85);
      else if (g < 1.7) b.set(x, y, hx(LAVA_LOOK.white));
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

/** Wall rim family, drawn on the FLOOR cell: the wall's outline, rock bumps at the face foot and a cast shadow. */
function wallRimPiece(b: Buf, t: number, mask: number, v: number): void {
  const L = WALLS[t];
  const nw = !!(mask & CORNER.NW);
  const ne = !!(mask & CORNER.NE);
  const sw = !!(mask & CORNER.SW);
  const se = !!(mask & CORNER.SE);
  const noise = familyNoise(`rim-${t}`, v);
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

/** Bridge rim, drawn on water / void beside a deck: side beam with posts to the north, outlines elsewhere, shadow. */
function bridgeRimPiece(b: Buf, mask: number): void {
  const nw = !!(mask & CORNER.NW);
  const ne = !!(mask & CORNER.NE);
  const sw = !!(mask & CORNER.SW);
  const se = !!(mask & CORNER.SE);
  const beam = hx(PAL.wood[1]);
  const beamLo = hx(PAL.wood[0]);
  const out = OUT;
  if (nw && ne) {
    // deck to the north: its side beam, posts into the water and a soft shadow
    for (let x = 0; x < S; x++) {
      b.set(x, 0, beam);
      b.set(x, 1, beamLo);
      b.set(x, 2, out, 0.9);
      b.set(x, 3, out, 0.3);
      b.set(x, 4, out, 0.15);
    }
    for (const px of [5, 21]) {
      b.rect(px, 2, 2, 4, beamLo);
      b.set(px, 2, beam);
      b.rect(px - 1, 2, 1, 4, out, 0.8);
      b.rect(px + 2, 2, 1, 4, out, 0.8);
      b.rect(px, 6, 2, 1, hx(PAL.foam), 0.7);
    }
  }
  if (sw && se) for (let x = 0; x < S; x++) b.set(x, S - 1, out, 0.85);
  if (nw && sw)
    for (let y = 0; y < S; y++) {
      b.set(0, y, beamLo);
      b.set(1, y, out, 0.85);
      b.set(2, y, out, 0.25);
    }
  if (ne && se) for (let y = 0; y < S; y++) b.set(S - 1, y, out, 0.85);
}

// ================================================================== decals
// Small detail sprites (16x16 cells) the baker scatters at hashed pixel offsets on uniform cells, so features never
// fall into a 32 px rhythm. Each painter draws roughly centred in its cell.

type DecalPainter = (b: Buf, rnd: Rnd) => void;
type Pal4 = { d: RGB; x: RGB; l: RGB; h: RGB };
const pal4 = (d: string, x: string, l: string, h: string): Pal4 => ({ d: hx(d), x: hx(x), l: hx(l), h: hx(h) });
const DG = pal4(GRASS_LOOK.dark, GRASS_LOOK.deep, GRASS_LOOK.light, GRASS_LOOK.hi);

/** 1 px outline around opaque pixels (4-neighbourhood), on transparent pixels only. */
function outlineBuf(b: Buf, color: RGB, a = 1): void {
  const marks: number[] = [];
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < b.w && y < b.h && b.alpha(x, y) > 128;
  for (let y = 0; y < b.h; y++)
    for (let x = 0; x < b.w; x++)
      if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push(x, y);
  for (let i = 0; i < marks.length; i += 2) b.set(marks[i], marks[i + 1], color, a);
}

const TUFT_BIG: readonly (readonly string[])[] = [
  ['...h...', '.h.l.h.', '.l.l.l.', 'dlddlld', '.ddxdd.'],
  ['..h..h.', 'h.l.hl.', 'l.ldl.h', 'dlddldl', '.dxxdd.'],
];
const TUFT_SMALL: readonly (readonly string[])[] = [
  ['.h.h.', 'hl.lh', 'dlldl', '.xdx.'],
  ['h..h', 'l.hl', 'dldd', '.xd.'],
];
const BENT_TUFT: readonly (readonly string[])[] = [
  ['....hh', '..hll.', '.ll.h.', 'dd.ll.', '.dxd..'],
  ['...hh.', '.hll..', 'll.hh.', 'ddll..', '.xdd..'],
];
const centred = (b: Buf, rows: readonly string[], pal: Readonly<Record<string, RGB>>, dy = 0) =>
  stamp(b, Math.floor((DECAL_PX - spriteW(rows)) / 2), Math.floor((DECAL_PX - rows.length) / 2) + dy, rows, pal);

const tuft = (p: Pal4, big: boolean, bent = false): DecalPainter => (b, rnd) => {
  const set = bent ? BENT_TUFT : big ? TUFT_BIG : TUFT_SMALL;
  centred(b, set[ri(rnd, set.length)], p);
};
const clover = (c: string, dark: string): DecalPainter => (b) =>
  centred(b, ['.cc...', 'cCcc..', '.cCccc', '..cCc.', '...c..'], { c: hx(c), C: hx(dark) });
const daisies = (petal: string, eye: string, stem: RGB): DecalPainter => (b, rnd) => {
  const n = 2 + ri(rnd, 2);
  for (let i = 0; i < n; i++) {
    const x = 5 + ri(rnd, 6);
    const y = 5 + ri(rnd, 5);
    b.set(x, y + 1, stem);
    b.set(x, y + 2, stem);
    b.set(x - 1, y, hx(petal));
    b.set(x + 1, y, hx(petal));
    b.set(x, y - 1, hx(petal));
    b.set(x, y, hx(eye));
  }
};
const flowerClump = (petal: string, eye: string, leaf: Pal4): DecalPainter => (b, rnd) => {
  // leaves first, then 3-5 blooms with a darker lower petal and a bright eye
  for (let i = 0; i < 6; i++) {
    const x = 4 + ri(rnd, 8);
    const y = 7 + ri(rnd, 5);
    b.set(x, y, leaf.d);
    b.set(x + 1, y - 1, leaf.l);
    b.set(x, y + 1, leaf.x);
  }
  const n = 3 + ri(rnd, 3);
  const pc = hx(petal);
  for (let i = 0; i < n; i++) {
    const x = 4 + ri(rnd, 8);
    const y = 4 + ri(rnd, 6);
    b.set(x, y, pc);
    b.set(x + 1, y, pc);
    b.set(x, y + 1, sh(pc, -36));
    b.set(x + 1, y + 1, sh(pc, -20));
    b.set(x + (rnd() < 0.5 ? 0 : 1), y, hx(eye));
  }
};
const stone = (body: string, hi: string, lo: string, outlineC: string, big = false): DecalPainter => (b, rnd) => {
  const w = big ? 6 + ri(rnd, 2) : 4 + ri(rnd, 2);
  const h = big ? 4 : 3;
  const x0 = Math.floor((DECAL_PX - w) / 2);
  const y0 = Math.floor((DECAL_PX - h) / 2);
  const tmp = new Buf(DECAL_PX, DECAL_PX);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if ((j === 0 || j === h - 1) && (i === 0 || i === w - 1)) continue;
      tmp.set(x0 + i, y0 + j, j === 0 ? hx(hi) : j === h - 1 ? hx(lo) : hx(body));
    }
  tmp.set(x0 + 1, y0 + 1, hx(hi));
  outlineBuf(tmp, hx(outlineC));
  // ground shadow under the stone
  b.rect(x0, y0 + h + 1, w, 1, hx(PAL.outline), 0.25);
  blitOver(b, tmp);
};
const pebbles = (body: string, hi: string, shadow: string): DecalPainter => (b, rnd) => {
  const n = 2 + ri(rnd, 3);
  for (let i = 0; i < n; i++) {
    const x = 3 + ri(rnd, 9);
    const y = 4 + ri(rnd, 8);
    const w = 1 + ri(rnd, 2);
    b.rect(x, y, w, 1, hx(body));
    b.set(x, y, hx(hi));
    b.rect(x, y + 1, w, 1, hx(shadow));
  }
};
const patch = (color: RGB, a: number): DecalPainter => (b, rnd) => {
  const w = 8 + ri(rnd, 6);
  const h = 4 + ri(rnd, 3);
  const x0 = Math.floor((DECAL_PX - w) / 2);
  const y0 = Math.floor((DECAL_PX - h) / 2);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const dx = (i - (w - 1) / 2) / (w / 2);
      const dy = (j - (h - 1) / 2) / (h / 2);
      if (dx * dx + dy * dy < 0.9 - rnd() * 0.35) b.set(x0 + i, y0 + j, color, a);
    }
};
const crack = (dark: string, light?: string): DecalPainter => (b, rnd) => {
  let x = 2 + ri(rnd, 2);
  let y = 6 + ri(rnd, 4);
  const len = 9 + ri(rnd, 4);
  for (let k = 0; k < len; k++) {
    b.set(x, y, hx(dark));
    if (light) b.set(x, y + 1, hx(light));
    if (k === 4 && rnd() < 0.7) {
      // a short branch
      b.set(x + 1, y - 1, hx(dark));
      b.set(x + 2, y - 2, hx(dark));
    }
    x++;
    if (rnd() < 0.4) y = clamp(y + (rnd() < 0.5 ? -1 : 1), 3, 12);
  }
};
const twig = (dark: string, light: string): DecalPainter => (b, rnd) => {
  const y = 6 + ri(rnd, 4);
  for (let k = 0; k < 9; k++) {
    const yy = y + (k > 5 ? 1 : 0);
    b.set(3 + k, yy, hx(light));
    b.set(3 + k, yy + 1, hx(dark));
  }
  b.set(6, y - 1, hx(light));
  b.set(5, y - 2, hx(light));
};
const leaves = (cols: readonly string[]): DecalPainter => (b, rnd) => {
  const n = 3 + ri(rnd, 3);
  for (let i = 0; i < n; i++) {
    const c = hx(cols[ri(rnd, cols.length)]);
    const x = 3 + ri(rnd, 9);
    const y = 4 + ri(rnd, 8);
    b.set(x, y, c);
    b.set(x + 1, y, c);
    b.set(x + 1, y + 1, sh(c, -24));
    b.set(x, y - 1, sh(c, 16));
  }
};
const mushrooms = (cap: string, capHi: string, stem: string): DecalPainter => (b, rnd) => {
  const n = 2 + ri(rnd, 2);
  const tmp = new Buf(DECAL_PX, DECAL_PX);
  for (let i = 0; i < n; i++) {
    const x = 4 + i * 3 + ri(rnd, 2);
    const y = 6 + ri(rnd, 3);
    const big = i === 0;
    tmp.rect(x, y + 2, 1, big ? 3 : 2, hx(stem));
    tmp.rect(x - 1, y + 1, 3, 1, hx(cap));
    if (big) tmp.rect(x - 2, y + 1, 5, 1, hx(cap));
    tmp.set(x, y, hx(cap));
    tmp.set(x - (big ? 1 : 0), y + (big ? 0 : 1), hx(capHi));
  }
  outlineBuf(tmp, hx(PAL.outline), 0.85);
  blitOver(b, tmp);
};
const sparkle = (c: string, big = false): DecalPainter => (b) => {
  const m = 7;
  b.set(m, m, hx(c));
  b.set(m - 1, m, hx(c), 0.6);
  b.set(m + 1, m, hx(c), 0.6);
  b.set(m, m - 1, hx(c), 0.6);
  b.set(m, m + 1, hx(c), 0.6);
  if (big) {
    b.set(m, m - 2, hx(c), 0.35);
    b.set(m, m + 2, hx(c), 0.35);
  }
};
const ripple = (light: string, dark: string, small = false): DecalPainter => (b) => {
  const w = small ? 6 : 9;
  const x0 = Math.floor((DECAL_PX - w) / 2);
  const y0 = 7;
  b.rect(x0 + 2, y0, w - 4, 1, hx(light));
  b.set(x0 + 1, y0 + 1, hx(light));
  b.set(x0 + w - 2, y0 + 1, hx(light));
  b.rect(x0 + 2, y0 + 1, w - 4, 1, hx(dark));
  b.rect(x0 + 2, y0 + 2, w - 4, 1, hx(light), 0.5);
};
const lilypad = (flower: boolean): DecalPainter => (b, rnd) => {
  const tmp = new Buf(DECAL_PX, DECAL_PX);
  const cx = 7 + ri(rnd, 2);
  const cy = 8;
  for (let y = -3; y <= 3; y++)
    for (let x = -4; x <= 4; x++) {
      if ((x / 4.5) ** 2 + (y / 3.2) ** 2 > 1) continue;
      if (x > 0 && Math.abs(y) <= x * 0.35 && y >= 0) continue; // notch
      tmp.set(cx + x, cy + y, y < 0 ? hx('#5f9a48') : hx('#4a7f3a'));
    }
  tmp.set(cx - 2, cy - 2, hx('#7cb35c'));
  if (flower) {
    tmp.set(cx - 1, cy - 1, hx(PAL.rose));
    tmp.set(cx, cy - 1, hx(PAL.rose));
    tmp.set(cx - 1, cy - 2, hx('#f6d0d8'));
  }
  outlineBuf(tmp, hx('#1f4058'), 0.8);
  blitOver(b, tmp);
};
const drift = (small: boolean): DecalPainter => (b, rnd) => {
  const w = small ? 6 : 9 + ri(rnd, 3);
  const x0 = Math.floor((DECAL_PX - w) / 2);
  const y0 = 6;
  b.rect(x0 + 2, y0, w - 4, 1, hx(SNOW_LOOK.hi));
  b.rect(x0 + 1, y0 + 1, w - 2, 1, hx(SNOW_LOOK.light));
  b.rect(x0, y0 + 2, w, 1, hx(SNOW_LOOK.light));
  b.rect(x0 + 1, y0 + 3, w - 2, 1, hx(SNOW_LOOK.shade));
  b.rect(x0 + 2, y0 + 4, w - 4, 1, hx(SNOW_LOOK.deep), 0.6);
};
const glowCrack = (): DecalPainter => (b, rnd) => {
  let x = 2;
  let y = 7 + ri(rnd, 3);
  for (let k = 0; k < 12; k++) {
    b.set(x, y + 1, hx('#2a1a14'));
    b.set(x, y, k > 2 && k < 9 ? hx('#ff9a3a') : hx('#c8501e'));
    if (k === 5 || k === 6) b.set(x, y, hx('#ffd27a'));
    b.set(x, y - 1, hx('#e8642a'), 0.25);
    x++;
    if (rnd() < 0.35) y = clamp(y + (rnd() < 0.5 ? -1 : 1), 4, 11);
  }
};
const cinders = (): DecalPainter => (b, rnd) => {
  for (let i = 0; i < 4; i++) {
    const x = 3 + ri(rnd, 9);
    const y = 4 + ri(rnd, 8);
    b.set(x, y, hx('#2e2420'));
    b.set(x + 1, y, hx('#3c302a'));
    if (rnd() < 0.5) b.set(x, y - 1, hx('#e8642a'));
  }
};
const bubble = (small: boolean): DecalPainter => (b) => {
  const r = small ? 2 : 3;
  const c = 8;
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++) {
      const d = Math.sqrt(x * x + y * y);
      if (d <= r + 0.2 && d > r - 1) b.set(c + x, c + y, hx(LAVA_LOOK.hotter));
      else if (d <= r - 1) b.set(c + x, c + y, hx(LAVA_LOOK.base), 1);
    }
  b.set(c - 1, c - r + 1, hx(LAVA_LOOK.white));
};
const crustPlate = (): DecalPainter => (b, rnd) => {
  const w = 6 + ri(rnd, 3);
  const x0 = Math.floor((DECAL_PX - w) / 2);
  b.rect(x0 + 1, 6, w - 2, 1, hx(LAVA_LOOK.crustHi));
  b.rect(x0, 7, w, 2, hx(LAVA_LOOK.crust));
  b.rect(x0 + 1, 9, w - 2, 1, sh(hx(LAVA_LOOK.crust), -18));
  b.rect(x0 - 1, 7, 1, 2, hx(LAVA_LOOK.hotter));
  b.rect(x0 + w, 7, 1, 2, hx(LAVA_LOOK.hotter));
};
const shell = (): DecalPainter => (b) =>
  centred(b, ['.ccc.', 'cwcwc', 'cwcwc', '.ccc.', '..s..'], { c: hx('#e8d6c0'), w: hx('#c8a890'), s: hx('#9a8060') });
const moteGlow = (c: string): DecalPainter => (b, rnd) => {
  for (let i = 0; i < 2 + ri(rnd, 2); i++) {
    const x = 4 + ri(rnd, 8);
    const y = 4 + ri(rnd, 8);
    b.set(x, y, hx(c));
    b.set(x + 1, y, hx(c), 0.4);
    b.set(x, y + 1, hx(c), 0.4);
  }
};
const cushion = (small: boolean): DecalPainter => (b, rnd) => {
  const w = small ? 5 : 7 + ri(rnd, 2);
  const h = small ? 3 : 4;
  const x0 = Math.floor((DECAL_PX - w) / 2);
  const y0 = Math.floor((DECAL_PX - h) / 2);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      if ((j === 0 || j === h - 1) && (i === 0 || i === w - 1)) continue;
      b.set(x0 + i, y0 + j, j === 0 ? hx(MOSS_LOOK.light) : hx(MOSS_LOOK.base));
    }
  b.set(x0 + 1, y0, hx(MOSS_LOOK.hi));
  b.rect(x0 + 1, y0 + h, w - 2, 1, hx(MOSS_LOOK.deep));
};

/** Overlay a scratch sprite onto the decal cell. */
function blitOver(b: Buf, src: Buf): void {
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const a = src.alpha(x, y);
      if (a) b.set(x, y, src.rgb(x, y), a / 255);
    }
}

const PATHP = { body: PATH_LOOK.stone, hi: PATH_LOOK.stoneHi, lo: '#8f7f62', sh: PATH_LOOK.dark };
const GREY_STONE = stone('#9a958b', '#b8b3a8', '#77726a', '#3a352c');
const GRASS_STONE = stone('#9c9784', '#b5b09c', '#7c7766', '#4a5530');

const DECAL_PAINT: Readonly<Record<DecalSet, readonly DecalPainter[]>> = {
  grass: [tuft(DG, true), tuft(DG, false), tuft(DG, false), clover('#7c9a48', '#5f7d38'), daisies(PAL.cream, '#e8c040', DG.d), GRASS_STONE, patch(hx(GRASS_LOOK.dark), 0.35), tuft(DG, true)],
  flowers: [
    flowerClump(PAL.crimson, '#f0c050', DG),
    flowerClump(PAL.rose, '#fff0c0', DG),
    flowerClump(PAL.cream, '#e8c040', DG),
    flowerClump(PAL.violet, '#f0e0ff', DG),
    flowerClump('#e8c040', '#fff6c8', DG),
    tuft(DG, true),
    daisies(PAL.cream, '#e8c040', DG.d),
    flowerClump(PAL.crimson, '#f0c050', DG),
  ],
  hill: (() => {
    const p = pal4('#6d8840', '#5a7233', '#99b45d', '#b0c871');
    return [tuft(p, true), tuft(p, false), daisies('#f0d050', '#fff6c8', p.d), GREY_STONE, patch(hx('#99b45d'), 0.35), clover('#9ab45a', '#7a9446'), tuft(p, true), tuft(p, false)];
  })(),
  storm: (() => {
    const p = pal4('#556b57', '#465a49', '#7d957c', '#a6bfa5');
    return [tuft(p, true, true), tuft(p, false, true), stone('#8d96a0', '#aab3bc', '#6c747d', '#2c3036'), sparkle('#c8e8f0'), patch(hx('#556b57'), 0.4), tuft(p, true, true), tuft(p, false), pebbles('#9aa3a8', '#c0c8cc', '#4c5a50')];
  })(),
  dusk: (() => {
    const p = pal4('#4a446f', '#3c375c', '#6e679b', '#8a80b8');
    return [tuft(p, true), tuft(p, false), flowerClump('#f0a8d8', '#fff0f8', p), flowerClump('#a8e8ff', '#f0ffff', p), sparkle('#f0c8ff'), patch(hx('#3c375c'), 0.35), mushrooms('#8a6cc0', '#b8a0e8', '#d8d0e8'), tuft(p, true)];
  })(),
  glade: (() => {
    const p = pal4('#3f7858', '#336449', '#61a47c', '#7cc094');
    return [tuft(p, true), tuft(p, false), moteGlow('#fff2b0'), flowerClump('#f0f8f0', '#fff2b0', p), mushrooms('#d8c8a0', '#f0e8c8', '#e8e0d0'), patch(hx('#336449'), 0.35), clover('#6cb488', '#4a8c66'), moteGlow('#d8fff0')];
  })(),
  dark: (() => {
    const p = pal4('#3c4a31', '#313d28', '#5a6b49', '#6c7f57');
    return [leaves(['#6e5636', '#7a6038', '#5e4a64']), leaves(['#6e5636', '#5a4a3a']), twig('#3d2817', '#6a4a2a'), mushrooms('#9a5a3a', '#c8845a', '#e0d0b0'), tuft(p, true), tuft(p, false), patch(hx('#313d28'), 0.4), pebbles('#6a6a5a', '#8a8a78', '#2a3020')];
  })(),
  moss: [cushion(false), cushion(true), tuft(pal4(MOSS_LOOK.dark, MOSS_LOOK.deep, MOSS_LOOK.light, MOSS_LOOK.hi), false), patch(hx(MOSS_LOOK.light), 0.3), cushion(false), mushrooms('#b8a070', '#e0c890', '#e8e0c8'), pebbles('#6a7a58', '#8a9a70', '#2f4220'), cushion(true)],
  path: [
    pebbles(PATHP.body, PATHP.hi, PATHP.sh),
    stone(PATH_LOOK.stone, PATH_LOOK.stoneHi, PATHP.lo, '#4a3a26'),
    crack(PATH_LOOK.dark),
    patch(hx(PATH_LOOK.dark), 0.35),
    patch(hx(PATH_LOOK.light), 0.4),
    pebbles(PATHP.body, PATHP.hi, PATHP.sh),
    tuft(DG, false),
    twig('#5c3d22', '#8a6038'),
  ],
  sand: [shell(), pebbles('#e8dcc0', '#f6eedb', '#b8a473'), ripple('#e2d2a4', '#b8a473'), patch(hx('#b8a473'), 0.3), twig('#8a7050', '#b89a70'), tuft(pal4('#8a9a50', '#6a7a40', '#a8b468', '#c0c880'), false), pebbles('#d8ccb0', '#f0e8d8', '#b8a473'), shell()],
  stone: [crack('#5c574f', '#a29c91'), pebbles('#a29d93', '#bdb8ae', '#5c574f'), GREY_STONE, patch(hx('#6d6860'), 0.35), clover('#6a7e45', '#4f6233'), crack('#5c574f', '#a29c91'), stone('#9a958b', '#b8b3a8', '#77726a', '#3a352c', true), pebbles('#a29d93', '#bdb8ae', '#5c574f')],
  cave: [pebbles('#6b6055', '#80746a', '#2e2823'), crack('#2e2823', '#5f554a'), stone('#6b6055', '#80746a', '#4a4038', '#1a1512'), patch(hx('#2e3a44'), 0.45), mushrooms('#5a8ab0', '#8cc0e0', '#c8d8e0'), patch(hx('#3f372f'), 0.4), pebbles('#6b6055', '#80746a', '#2e2823'), crack('#2e2823', '#5f554a')],
  crypt: [crack('#3a3645', '#6a6576'), crack('#3a3645'), patch(hx('#6a6576'), 0.25), pebbles('#6e697a', '#8a8496', '#2a2733'), clover('#4f6a3e', '#3a5030'), stone('#6e697a', '#8a8496', '#4a4656', '#16141b'), crack('#3a3645', '#6a6576'), pebbles('#6e697a', '#8a8496', '#2a2733')],
  snow: [drift(false), drift(true), sparkle('#ffffff'), stone('#8a8f98', '#b8bec8', '#6a7078', '#3a4250'), patch(hx(SNOW_LOOK.shade), 0.45), drift(false), drift(true), sparkle('#ffffff', true)],
  ice: [crack(ICE_LOOK.deep, ICE_LOOK.light), crack(ICE_LOOK.deep), sparkle('#ffffff'), patch(hx(ICE_LOOK.light), 0.5), sparkle('#ffffff', true), crack(ICE_LOOK.deep, ICE_LOOK.hi), patch(hx(ICE_LOOK.dark), 0.3), sparkle(ICE_LOOK.hi)],
  ember: [glowCrack(), glowCrack(), patch(hx('#7a6a62'), 0.35), cinders(), twig('#2a1a14', '#4a3028'), glowCrack(), patch(hx('#46302a'), 0.4), cinders()],
  basalt: [glowCrack(), patch(hx('#6a6670'), 0.25), cinders(), crack('#1c1a20'), glowCrack(), cinders(), patch(hx('#2a2830'), 0.4), pebbles('#55505e', '#6a6574', '#1c1a20')],
  water: [ripple('#6aa8d2', '#3676a8'), ripple('#6aa8d2', '#3676a8', true), sparkle('#cfeaf6'), ripple('#8cc6e6', '#3676a8'), sparkle('#cfeaf6', true), ripple('#8cc6e6', '#3676a8', true), sparkle('#cfeaf6'), ripple('#6aa8d2', '#3676a8')],
  pond: [ripple('#6aa8d2', '#3676a8'), ripple('#6aa8d2', '#3676a8', true), sparkle('#cfeaf6'), lilypad(false), lilypad(true), ripple('#8cc6e6', '#3676a8', true), sparkle('#cfeaf6', true), lilypad(false)],
  lava: [bubble(false), bubble(true), crustPlate(), sparkle(LAVA_LOOK.white), bubble(true), crustPlate(), sparkle(LAVA_LOOK.hotter, true), bubble(false)],
  rock: [
    tuft(pal4('#56702f', '#45592a', '#7a9845', '#94b057'), false),
    stone('#8d8574', '#a8a08c', '#6a6252', '#2a2119'),
    crack('#433d33'),
    patch(hx('#5a7a3a'), 0.45),
    tuft(pal4('#56702f', '#45592a', '#7a9845', '#94b057'), true),
    pebbles('#958c79', '#aea38c', '#433d33'),
    crack('#433d33', '#958c79'),
    patch(hx('#685f50'), 0.4),
  ],
};

/** One decal (16x16 RGBA) — exported for contact sheets. */
export function paintDecal(set: DecalSet, k: number): ImageData {
  const b = new Buf(DECAL_PX, DECAL_PX);
  DECAL_PAINT[set][k % DECALS_PER_SET](b, artRng(keySeed(`decal-${set}`) + k * 131));
  return new ImageData(b.d, DECAL_PX, DECAL_PX);
}

// ================================================================== atlases

function blitToAtlas(img: ImageData, src: Buf, col: number, row: number): void {
  const n = src.w;
  const step = n + TILE_SPACING;
  const ox = TILE_MARGIN + col * step;
  const oy = TILE_MARGIN + row * step;
  const W = img.width;
  const d = img.data;
  // cell + 1 px extrusion on every side (clamped copy of the border pixels)
  for (let y = -1; y <= n; y++)
    for (let x = -1; x <= n; x++) {
      const sx = clamp(x, 0, n - 1);
      const sy = clamp(y, 0, n - 1);
      const si = (sy * n + sx) * 4;
      const di = ((oy + y) * W + (ox + x)) * 4;
      d[di] = src.d[si];
      d[di + 1] = src.d[si + 1];
      d[di + 2] = src.d[si + 2];
      d[di + 3] = src.d[si + 3];
    }
}

function sheetSize(cols: number, rows: number, cell = S): [number, number] {
  return [TILE_MARGIN * 2 + cols * cell + (cols - 1) * TILE_SPACING, TILE_MARGIN * 2 + rows * cell + (rows - 1) * TILE_SPACING];
}

function registerFrames(
  scene: Phaser.Scene,
  key: string,
  cols: number,
  rows: number,
  frameOf: (col: number, row: number) => number,
  cell = S,
): void {
  const tex = scene.textures.get(key);
  const step = cell + TILE_SPACING;
  for (let r = 0; r < rows; r++)
    for (let c = 0; c < cols; c++) tex.add(frameOf(c, r), 0, TILE_MARGIN + c * step, TILE_MARGIN + r * step, cell, cell);
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
    case 'bridge_rim':
      return bridgeRimPiece(b, mask);
    case 'cobble':
      return pavingPiece(b, COBBLE_PAVE, mask, v, OUT, 0.6);
    case 'basalt':
      return pavingPiece(b, BASALT_PAVE, mask, v, BASALT.gap, 0.85);
  }
  const st = SOFT[fam];
  if (!st) return;
  softPiece(b, fam, st, mask, v, familyNoise(fam, v, st.hiFreq));
}

/** Edge families already painted into a given 'tiles_edge' texture (rows are painted lazily). */
const paintedEdges = new WeakMap<object, Set<number>>();

/**
 * Paints the given edge families (indices into EDGE_FAMILIES) into 'tiles_edge' if they are not there yet, and
 * re-uploads the texture once. bakeGround calls this with the families a map uses; call it with every index (or use
 * drawTiles(scene, { allEdges: true })) if you need the whole sheet up front.
 */
export function ensureEdgeFamilies(scene: Phaser.Scene, families: Iterable<number>): void {
  const tex = scene.textures.get('tiles_edge') as Phaser.Textures.CanvasTexture;
  if (!tex || typeof tex.getContext !== 'function') return;
  let done = paintedEdges.get(tex);
  if (!done) paintedEdges.set(tex, (done = new Set()));
  const todo = [...new Set(families)].filter((f) => f >= 0 && f < EDGE_ROWS && !done.has(f));
  if (!todo.length) return;
  const c = tex.getContext();
  const step = S + TILE_SPACING;
  for (const row of todo) {
    // paint one row into a strip, then copy it into place
    const [w] = sheetSize(EDGE_COLS, 1);
    const img = c.createImageData(w, S + 2);
    const fam = EDGE_FAMILIES[row];
    for (let v = 0; v < EDGE_VARIANTS; v++)
      for (let mask = 1; mask < 16; mask++) {
        const b = new Buf();
        drawPiece(b, fam, mask, v);
        blitToAtlas(img, b, v * 16 + mask, 0);
      }
    c.putImageData(img, 0, row * step);
    done.add(row);
  }
  tex.refresh();
}

/**
 * Builds 'tiles' (base atlas), 'tiles_decal' (detail sprites) and the 'tiles_edge' sheet (autotile pieces; its rows
 * are painted on demand by ensureEdgeFamilies / bakeGround unless `allEdges` is set). Idempotent per key.
 * Call once at boot, before the first map is baked.
 */
export function drawTiles(scene: Phaser.Scene, opts: { allEdges?: boolean } = {}): void {
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
  if (!scene.textures.exists('tiles_decal')) {
    const [w, h] = sheetSize(DECALS_PER_SET, DECAL_SETS.length, DECAL_PX);
    pixelTex(scene, 'tiles_decal', w, h, (c) => {
      const img = c.createImageData(w, h);
      DECAL_SETS.forEach((set, row) => {
        for (let k = 0; k < DECALS_PER_SET; k++) {
          const b = new Buf(DECAL_PX, DECAL_PX);
          DECAL_PAINT[set][k](b, artRng(keySeed(`decal-${set}`) + k * 131));
          blitToAtlas(img, b, k, row);
        }
      });
      c.putImageData(img, 0, 0);
    });
    registerFrames(scene, 'tiles_decal', DECALS_PER_SET, DECAL_SETS.length, (c, r) => r * DECALS_PER_SET + c, DECAL_PX);
  }
  if (!scene.textures.exists('tiles_edge')) {
    const [w, h] = sheetSize(EDGE_COLS, EDGE_ROWS);
    pixelTex(scene, 'tiles_edge', w, h, () => {});
    registerFrames(scene, 'tiles_edge', EDGE_COLS, EDGE_ROWS, (c, r) => edgeFrame(r, c & 15, c >> 4));
  }
  if (opts.allEdges) ensureEdgeFamilies(scene, EDGE_FAMILIES.map((_, i) => i));
}
