// Terrain autotiling model (art direction v3 §3): pure, Phaser-free, deterministic.
//
// A CompiledMap stores one terrain id per cell. The ground renderer draws, for every cell:
//   1. a BASE tile from the 'tiles' atlas (27 terrains x TILE_VARIANTS hashed variants), then
//   2. OVERLAY pieces from the 'tiles_edge' atlas, in list order:
//        underlays on liquids/void (shore foam, lava glow, abyss face),
//        soft terrains of higher precedence spilling over this cell (path over grass, sand over water, ...),
//        wall rims (outline + cast shadow of an adjacent wall) — or, on wall cells, the wall's face / lit lip.
// Every overlay is chosen by a 4-bit CORNER mask: bit set = that corner of the cell touches the overlaying terrain
// (any of the 4 cells sharing the corner). Because a piece's profile along an edge depends only on that edge's two
// corner bits, neighbouring pieces always join seamlessly.
import { T, TILE_COUNT } from '../../core/world/tiles';
import type { CompiledMap } from '../../core/world/types';

/** Tile size in px. */
export const TILE_PX = 32;
/** Atlas convention (both 'tiles' and 'tiles_edge'): 1 px extruded margin around the sheet, 2 px between cells. */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;
/** Rows in the 'tiles' atlas: row 0 is the v2-compatible base, rows 1-2 are variants. */
export const TILE_VARIANTS = 3;
/** Variants per edge piece in 'tiles_edge' (columns = 16 masks x EDGE_VARIANTS). */
export const EDGE_VARIANTS = 2;

/** Frame / tile index inside the 'tiles' atlas (row-major, TILE_COUNT columns). */
export function atlasIndex(tileId: number, variant: number): number {
  return variant * TILE_COUNT + tileId;
}

/** Corner bits of a 4-bit corner mask (reading order). */
export const CORNER = { NW: 1, NE: 2, SW: 4, SE: 8 } as const;

/**
 * Edge families = rows of the 'tiles_edge' atlas. Soft families are named after the terrain that spills OVER its
 * lower-precedence neighbours; `foam`/`lavaglow`/`abyss` are underlays drawn on liquid/void cells beneath the land's
 * edge; `*_face` pieces go on wall cells (mask = corners touching floor), `*_rim` pieces on floor cells next to walls
 * (mask = corners touching that wall); `bridge_rim` puts a deck's side beam, posts and shadow on water/void next to it.
 */
export const EDGE_FAMILIES = [
  'foam',
  'lavaglow',
  'abyss',
  'shallow',
  'ice',
  'cave',
  'stone',
  'basalt',
  'sand',
  'grass',
  'hill',
  'storm',
  'dusk',
  'glade',
  'dark',
  'moss',
  'snow',
  'ember',
  'path',
  'cobble',
  'cliff_face',
  'cliff_rim',
  'cavewall_face',
  'cavewall_rim',
  'crypt_face',
  'crypt_rim',
  'bridge_rim',
] as const;
export type EdgeFamily = (typeof EDGE_FAMILIES)[number];

const FAMILY_INDEX: Readonly<Record<EdgeFamily, number>> = Object.fromEntries(EDGE_FAMILIES.map((f, i) => [f, i])) as Record<
  EdgeFamily,
  number
>;

/** Frame index inside 'tiles_edge' for a family, a corner mask (0..15) and a variant (0..EDGE_VARIANTS-1). */
export function edgeFrame(family: EdgeFamily | number, mask: number, variant = 0): number {
  const f = typeof family === 'number' ? family : FAMILY_INDEX[family];
  return (f * EDGE_VARIANTS + (variant % EDGE_VARIANTS)) * 16 + (mask & 15);
}

/** Inverse of edgeFrame (for debugging / contact sheets). */
export function edgeFrameInfo(frame: number): { family: EdgeFamily; mask: number; variant: number } {
  const mask = frame & 15;
  const fv = frame >> 4;
  return { family: EDGE_FAMILIES[Math.floor(fv / EDGE_VARIANTS)], mask, variant: fv % EDGE_VARIANTS };
}

/** Cells in the 'tiles_edge' sheet. */
export const EDGE_COLS = 16 * EDGE_VARIANTS;
export const EDGE_ROWS = EDGE_FAMILIES.length;

// ------------------------------------------------------------------ decals

/** Ground decals: small detail sprites ('tiles_decal', DECAL_PX cells) scattered at hashed pixel offsets. */
export const DECAL_PX = 16;
export const DECALS_PER_SET = 8;
export const DECAL_SETS = [
  'grass',
  'flowers',
  'hill',
  'storm',
  'dusk',
  'glade',
  'dark',
  'moss',
  'path',
  'sand',
  'stone',
  'cave',
  'crypt',
  'snow',
  'ice',
  'ember',
  'basalt',
  'water',
  'pond',
  'lava',
  'rock',
] as const;
export type DecalSet = (typeof DECAL_SETS)[number];
const DECAL_SET_INDEX: Readonly<Record<DecalSet, number>> = Object.fromEntries(DECAL_SETS.map((d, i) => [d, i])) as Record<DecalSet, number>;

/** Frame index inside 'tiles_decal'. */
export function decalFrame(set: DecalSet | number, k: number): number {
  return (typeof set === 'number' ? set : DECAL_SET_INDEX[set]) * DECALS_PER_SET + (k % DECALS_PER_SET);
}

/**
 * Ground that gets large-scale tone patches (render/ground.ts washes it darker or drier by TONE_CELL-tile value noise,
 * in an ordered dither): fields read as darker and lighter patches several tiles across, like the reference's two-tone
 * grass, without changing the base tiles (so tile seams stay invisible).
 */
export const TONE_TILES: ReadonlySet<number> = new Set([T.GRASS, T.GRASS2, T.FLOWERS, T.HILL, T.STORMGRASS, T.DARK]);
const TONE_CELL = 6;

/** Smooth value noise in [0, 1) over TONE_CELL-tile cells at tile coordinates (x, y) (deterministic per map seed). */
export function toneNoise(x: number, y: number, seed: number): number {
  const fx = x / TONE_CELL;
  const fy = y / TONE_CELL;
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const v = (cx: number, cy: number) => (cellHash(cx, cy, seed, 0x70e) & 0xffff) / 0x10000;
  const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
  const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
  const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
  const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
  return a + (b - a) * sy;
}

/** Biomes whose open water gets lily pads. */
const POND_BIOMES: ReadonlySet<string> = new Set(['meadow', 'lake', 'town', 'grove', 'glade', 'dusk', 'hill']);

/** Decal set and expected decals per (uniform) cell, by tile id. */
const DECAL_RULES: Readonly<Partial<Record<number, [DecalSet, number]>>> = {
  [T.GRASS]: ['grass', 0.75],
  [T.GRASS2]: ['grass', 1.1],
  [T.FLOWERS]: ['flowers', 1.1],
  [T.HILL]: ['hill', 0.8],
  [T.STORMGRASS]: ['storm', 0.8],
  [T.DUSK]: ['dusk', 0.8],
  [T.GLADE]: ['glade', 0.8],
  [T.DARK]: ['dark', 0.9],
  [T.MOSS]: ['moss', 0.6],
  [T.PATH]: ['path', 0.7],
  [T.SAND]: ['sand', 0.5],
  [T.STONE]: ['stone', 0.8],
  [T.CAVE]: ['cave', 0.7],
  [T.CRYPT]: ['crypt', 0.35],
  [T.SNOW]: ['snow', 0.55],
  [T.ICE]: ['ice', 0.5],
  [T.EMBER]: ['ember', 0.6],
  [T.BASALT]: ['basalt', 0.3],
  [T.WATER]: ['water', 0.3],
  [T.DEEP]: ['water', 0.12],
  [T.LAVA]: ['lava', 0.45],
  [T.CLIFF]: ['rock', 0.3],
  [T.CAVE_WALL]: ['rock', 0.15],
};

// ------------------------------------------------------------------ terrain classes & precedence

/** Terrain class per tile id: GRASS / GRASS2 / FLOWERS share one class (same base colour, no seam between them). */
export const TERRAIN_CLASS: readonly number[] = (() => {
  const c: number[] = [];
  for (let i = 0; i < TILE_COUNT; i++) c.push(i);
  c[T.GRASS2] = T.GRASS;
  c[T.FLOWERS] = T.GRASS;
  return c;
})();

/** Draw precedence, low -> high: a higher soft terrain spills its outlined edge over lower neighbours. */
const PRECEDENCE_ORDER: readonly number[] = [
  T.VOID,
  T.DEEP,
  T.WATER,
  T.LAVA,
  T.ICE,
  T.CRYPT,
  T.CAVE,
  T.STONE,
  T.BASALT,
  T.SAND,
  T.GRASS,
  T.HILL,
  T.STORMGRASS,
  T.DUSK,
  T.GLADE,
  T.DARK,
  T.MOSS,
  T.SNOW,
  T.EMBER,
  T.PATH,
  T.COBBLE,
  // Constructed / raised: never overlaid by soft edges.
  T.BRIDGE,
  T.CLIFF,
  T.CAVE_WALL,
  T.CRYPT_WALL,
];

export const PRECEDENCE: readonly number[] = (() => {
  const p: number[] = new Array(TILE_COUNT).fill(0);
  PRECEDENCE_ORDER.forEach((t, i) => (p[t] = i));
  p[T.GRASS2] = p[T.GRASS];
  p[T.FLOWERS] = p[T.GRASS];
  return p;
})();

/** Soft edge family of a terrain class (the terrain spills over lower neighbours), or -1. */
export const SOFT_FAMILY: readonly number[] = (() => {
  const f: number[] = new Array(TILE_COUNT).fill(-1);
  const set = (t: number, fam: EdgeFamily) => (f[t] = FAMILY_INDEX[fam]);
  set(T.WATER, 'shallow');
  set(T.ICE, 'ice');
  set(T.CAVE, 'cave');
  set(T.STONE, 'stone');
  set(T.BASALT, 'basalt');
  set(T.SAND, 'sand');
  set(T.GRASS, 'grass');
  set(T.HILL, 'hill');
  set(T.STORMGRASS, 'storm');
  set(T.DUSK, 'dusk');
  set(T.GLADE, 'glade');
  set(T.DARK, 'dark');
  set(T.MOSS, 'moss');
  set(T.SNOW, 'snow');
  set(T.EMBER, 'ember');
  set(T.PATH, 'path');
  set(T.COBBLE, 'cobble');
  return f;
})();

/** Wall tiles: raised masses with a south face inside the wall cell and an outlined rim on the floor side. */
export const WALL_FAMILIES: Readonly<Record<number, { face: number; rim: number }>> = {
  [T.CLIFF]: { face: FAMILY_INDEX.cliff_face, rim: FAMILY_INDEX.cliff_rim },
  [T.CAVE_WALL]: { face: FAMILY_INDEX.cavewall_face, rim: FAMILY_INDEX.cavewall_rim },
  [T.CRYPT_WALL]: { face: FAMILY_INDEX.crypt_face, rim: FAMILY_INDEX.crypt_rim },
};

const isWall = (t: number) => t === T.CLIFF || t === T.CAVE_WALL || t === T.CRYPT_WALL;
const isWater = (t: number) => t === T.WATER || t === T.DEEP;
/** Solid ground that throws foam / glow / an abyss face onto a liquid or void neighbour. */
const isShoreLand = (t: number) => !isWater(t) && t !== T.VOID && t !== T.LAVA && t !== T.BRIDGE;

// ------------------------------------------------------------------ hashing

/** Stable integer hash of (x, y, seed, salt) -> uint32. */
export function cellHash(x: number, y: number, seed: number, salt = 0): number {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ Math.imul(seed | 0, 0x9e3779b1) ^ Math.imul(salt | 0, 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

// ------------------------------------------------------------------ layers

export interface TerrainOverlay {
  tx: number;
  ty: number;
  /** Frame in 'tiles_edge' (see edgeFrame / edgeFrameInfo). */
  frame: number;
}

export interface TerrainDecal {
  /** Top-left in map px (always inside one cell). */
  x: number;
  y: number;
  /** Frame in 'tiles_decal' (see decalFrame). */
  frame: number;
}

export interface TerrainLayers {
  /** 'tiles' atlas index per cell (row-major), hashed variant included. */
  base: Uint16Array;
  /** Edge pieces in draw order (cells ascending; within a cell: underlays, soft edges by precedence, wall rim/face). */
  overlays: TerrainOverlay[];
  /** Detail sprites drawn after the overlays, only on cells that received no overlay. */
  decals: TerrainDecal[];
}

/**
 * Pure, deterministic: base atlas index + overlay pieces for a compiled map. Variants are a hash of (tx, ty, map seed).
 * Cells outside the map repeat the nearest border cell, so map borders never show transitions.
 */
export function computeTerrainLayers(cm: CompiledMap): TerrainLayers {
  const { w, h, ground } = cm;
  const seed = cm.def.seed | 0;
  const base = new Uint16Array(w * h);
  const overlays: TerrainOverlay[] = [];
  const decals: TerrainDecal[] = [];
  const at = (x: number, y: number) => ground[(y < 0 ? 0 : y >= h ? h - 1 : y) * w + (x < 0 ? 0 : x >= w ? w - 1 : x)];

  // Neighbourhood scratch: n[0..8] = 3x3 block in reading order (n[4] = the cell itself).
  const n = new Array<number>(9).fill(0);
  // Cells (indices into n) sharing each corner, in CORNER bit order NW, NE, SW, SE.
  const CORNER_CELLS: readonly (readonly number[])[] = [
    [0, 1, 3],
    [1, 2, 5],
    [3, 6, 7],
    [5, 7, 8],
  ];
  const maskOf = (pred: (t: number) => boolean): number => {
    let m = 0;
    for (let c = 0; c < 4; c++) {
      const cells = CORNER_CELLS[c];
      if (pred(n[cells[0]]) || pred(n[cells[1]]) || pred(n[cells[2]])) m |= 1 << c;
    }
    return m;
  };
  const push = (tx: number, ty: number, family: number, mask: number) => {
    if (!mask) return;
    const v = cellHash(tx, ty, seed, 101 + family) % EDGE_VARIANTS;
    overlays.push({ tx, ty, frame: edgeFrame(family, mask, v) });
  };
  const soft: number[] = [];

  /** Overlays for one non-uniform cell (n[] holds its 3x3 neighbourhood). */
  const layerCell = (x: number, y: number, t: number) => {
    if (isWall(t)) {
      // face / lit lip on the wall itself: corners that touch any non-wall cell
      push(x, y, WALL_FAMILIES[t].face, maskOf((v) => !isWall(v)));
      return;
    }
    // 1) underlays on liquids and the void
    // (no foam where a bridge deck abuts: the foam line would cut across the open water beside it)
    if (isWater(t)) {
      if (!n.includes(T.BRIDGE)) push(x, y, FAMILY_INDEX.foam, maskOf((v) => isShoreLand(v)));
    }
    else if (t === T.LAVA) push(x, y, FAMILY_INDEX.lavaglow, maskOf((v) => isShoreLand(v)));
    else if (t === T.VOID) push(x, y, FAMILY_INDEX.abyss, maskOf((v) => isShoreLand(v) && !isWall(v)));
    // 2) soft terrains of higher precedence, ascending
    const myPrec = PRECEDENCE[t];
    soft.length = 0;
    for (let i = 0; i < 9; i++) {
      const c = TERRAIN_CLASS[n[i]];
      if (SOFT_FAMILY[c] < 0 || PRECEDENCE[c] <= myPrec || soft.includes(c)) continue;
      soft.push(c);
    }
    soft.sort((a, b) => PRECEDENCE[a] - PRECEDENCE[b]);
    for (const c of soft) push(x, y, SOFT_FAMILY[c], maskOf((v) => TERRAIN_CLASS[v] === c));
    // 3) wall rims (outline + cast shadow) on the floor side; walls simply end in darkness over the void
    if (t !== T.VOID) for (const wt of [T.CLIFF, T.CAVE_WALL, T.CRYPT_WALL]) push(x, y, WALL_FAMILIES[wt].rim, maskOf((v) => v === wt));
    // 4) bridge decks: side beam, posts and shadow on the water / void beside them
    if (isWater(t) || t === T.VOID || t === T.LAVA) push(x, y, FAMILY_INDEX.bridge_rim, maskOf((v) => v === T.BRIDGE));
  };

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = ground[y * w + x];
      base[y * w + x] = atlasIndex(t, cellHash(x, y, seed, 7) % TILE_VARIANTS);
      let k = 0;
      let uniform = true;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const v = at(x + dx, y + dy);
          n[k++] = v;
          if (TERRAIN_CLASS[v] !== TERRAIN_CLASS[t]) uniform = false;
        }
      const before = overlays.length;
      if (!uniform) layerCell(x, y, t);
      // decals only where nothing is drawn over this cell's base (no spill from a neighbour, no wall pieces)
      if (overlays.length === before) {
        let rule = DECAL_RULES[t];
        if (!rule) continue;
        if (rule[0] === 'water' && POND_BIOMES.has(cm.def.biome)) rule = ['pond', rule[1]];
        const hd = cellHash(x, y, seed, 53);
        const cnt = Math.floor(rule[1] + (hd & 0xffff) / 0x10000);
        for (let j = 0; j < cnt; j++) {
          const hk = cellHash(x, y, seed, 59 + j);
          decals.push({
            x: x * TILE_PX + (hk % (TILE_PX - DECAL_PX + 1)),
            y: y * TILE_PX + ((hk >>> 8) % (TILE_PX - DECAL_PX + 1)),
            frame: decalFrame(rule[0], hk >>> 16),
          });
        }
      }
    }
  }
  return { base, overlays, decals };
}
