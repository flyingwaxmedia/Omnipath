// World compiler (v2): MapDef (macro layout + placements) -> CompiledMap (tiles, collision, props, arrivals).
// Pure and deterministic: every random choice is seeded from def.seed through src/core/rng.ts, so a server can
// rebuild exactly the map a client sees. Rules: docs/SPEC-v2.md §7.1.
import { hashSeed, mulberry32 } from '../rng';
import { BLOCKING_TILES, T, WATER_TILES, type TileName } from './tiles';
import {
  COLL,
  type Biome,
  type CompiledMap,
  type Facing,
  type MapDef,
  type PortalDef,
  type PropInst,
  type PropKind,
  type PropTier,
  type StructureKind,
  type TileId,
} from './types';

/** Tile size in px. */
export const TILE = 32;

// ------------------------------------------------------------------ legend & biomes

/** 'ground' / 'alt' / 'wall' resolve through the map's biome; a TileName is used literally. */
export type MacroTile = 'ground' | 'alt' | 'wall' | TileName;

export interface MacroDef {
  label: string;
  tile: MacroTile;
  /**
   * Prop rule: 'forest' a layered tree line (every tile blocks) · 'woods' tree groups · 'stones' rock groups ·
   * 'boulders' a standing stone (lone cell) or boulder groups (every tile blocks).
   */
  fill?: 'forest' | 'woods' | 'stones' | 'boulders';
  /** Base chance per tile of a biome decor prop (scaled by `def.decor`). */
  decor?: number;
  /** true: always blocks · false: never · 'props': only where its props land. */
  blocks: boolean | 'props';
  /** Turns to SAND next to water in shore biomes (meadow/lake/town). */
  shore?: boolean;
}

/** Macro layout characters (each = a 2×2 tile block). SPEC §7.1. */
export const MACRO_LEGEND: Readonly<Record<string, MacroDef>> = {
  '.': { label: 'biome ground', tile: 'ground', decor: 0.03, blocks: false, shore: true },
  ',': { label: 'biome alt ground', tile: 'alt', decor: 0.06, blocks: false, shore: true },
  t: { label: 'light woods', tile: 'ground', fill: 'woods', blocks: 'props', shore: true },
  T: { label: 'dense forest', tile: 'ground', fill: 'forest', blocks: true },
  '#': { label: 'wall / cliff', tile: 'wall', blocks: true },
  '~': { label: 'deep water', tile: 'DEEP', blocks: true },
  '-': { label: 'shallow water', tile: 'WATER', blocks: true },
  '=': { label: 'path', tile: 'PATH', blocks: false },
  '+': { label: 'cobble plaza', tile: 'COBBLE', blocks: false },
  ':': { label: 'sand', tile: 'SAND', blocks: false },
  o: { label: 'stony ground', tile: 'STONE', fill: 'stones', blocks: 'props' },
  g: { label: 'grass', tile: 'GRASS', blocks: false },
  h: { label: 'hill grass', tile: 'HILL', blocks: false },
  d: { label: 'dark grass', tile: 'DARK', blocks: false },
  e: { label: 'ember ground', tile: 'EMBER', blocks: false },
  '*': { label: 'snow', tile: 'SNOW', blocks: false },
  i: { label: 'ice', tile: 'ICE', blocks: false },
  c: { label: 'cave floor', tile: 'CAVE', blocks: false },
  x: { label: 'crypt floor', tile: 'CRYPT', blocks: false },
  m: { label: 'moss', tile: 'MOSS', blocks: false },
  l: { label: 'dusk grass', tile: 'DUSK', blocks: false },
  b: { label: 'bridge / planks', tile: 'BRIDGE', blocks: false },
  L: { label: 'lava', tile: 'LAVA', blocks: true },
  C: { label: 'rock cluster', tile: 'ground', fill: 'boulders', blocks: true },
  ' ': { label: 'void', tile: 'VOID', blocks: true },
};

export interface BiomeDef {
  /** Tile for '.'. */
  ground: TileId;
  /** Tile for ','. */
  alt: TileId;
  /** Prop for 't' / 'T'. */
  tree: PropKind;
  /** Tile for '#'. */
  wall: TileId;
  /** Decor palette scattered on '.' / ','. Repeat a kind to weight it. */
  decor: readonly PropKind[];
}

/** SPEC §7.1 biome table. */
export const BIOMES: Readonly<Record<Biome, BiomeDef>> = {
  meadow: { ground: T.GRASS, alt: T.FLOWERS, tree: 'tree', wall: T.CLIFF, decor: ['bush', 'bush', 'tree', 'rock'] },
  lake: { ground: T.GRASS, alt: T.GRASS2, tree: 'tree', wall: T.CLIFF, decor: ['reeds', 'reeds', 'bush', 'tree'] },
  hill: { ground: T.HILL, alt: T.GRASS2, tree: 'pine', wall: T.CLIFF, decor: ['rock', 'bush', 'pine', 'rock'] },
  quarry: { ground: T.STONE, alt: T.GRASS2, tree: 'pine', wall: T.CLIFF, decor: ['rock', 'rock', 'boulder', 'bush'] },
  grove: { ground: T.DARK, alt: T.MOSS, tree: 'darktree', wall: T.CLIFF, decor: ['mushroom', 'mushroom', 'bush', 'darktree'] },
  glade: { ground: T.GLADE, alt: T.MOSS, tree: 'duskwillow', wall: T.CLIFF, decor: ['mushroom', 'bush', 'crystal', 'reeds'] },
  ember: { ground: T.EMBER, alt: T.STONE, tree: 'deadtree', wall: T.CLIFF, decor: ['rock', 'rock', 'deadtree', 'boulder'] },
  plateau: { ground: T.STONE, alt: T.STORMGRASS, tree: 'deadtree', wall: T.CLIFF, decor: ['rock', 'boulder', 'bush', 'deadtree'] },
  town: { ground: T.GRASS, alt: T.FLOWERS, tree: 'tree', wall: T.CLIFF, decor: ['bush', 'bush', 'tree'] },
  cave: { ground: T.CAVE, alt: T.MOSS, tree: 'stalagmite', wall: T.CAVE_WALL, decor: ['rock', 'mushroom', 'crystal', 'stalagmite'] },
  crypt: { ground: T.CRYPT, alt: T.CAVE, tree: 'tombstone', wall: T.CRYPT_WALL, decor: ['rock', 'mushroom', 'tombstone'] },
  frost: { ground: T.SNOW, alt: T.ICE, tree: 'frostpine', wall: T.CLIFF, decor: ['rock', 'crystal', 'frostpine'] },
  basalt: { ground: T.BASALT, alt: T.EMBER, tree: 'basalt_spire', wall: T.CLIFF, decor: ['rock', 'boulder', 'basalt_spire'] },
  storm: { ground: T.STORMGRASS, alt: T.HILL, tree: 'pine', wall: T.CLIFF, decor: ['rock', 'bush', 'pine'] },
  dusk: { ground: T.DUSK, alt: T.GLADE, tree: 'duskwillow', wall: T.CLIFF, decor: ['bush', 'mushroom', 'duskwillow'] },
};

/** Biomes whose ground turns to SAND next to water. */
export const SHORE_BIOMES: ReadonlySet<Biome> = new Set<Biome>(['meadow', 'lake', 'town']);

/** Whether a prop blocks movement. Small decor (bush, mushroom, reeds) is walk-through. */
export const PROP_BLOCKS: Readonly<Record<PropKind, boolean>> = {
  tree: true,
  darktree: true,
  deadtree: true,
  pine: true,
  frostpine: true,
  duskwillow: true,
  basalt_spire: true,
  stalagmite: true,
  tombstone: true,
  rock: true,
  boulder: true,
  crystal: true,
  bush: false,
  mushroom: false,
  reeds: false,
  menhir: true,
  log: false,
};

/** How far (tiles, Chebyshev) one L or XL prop or structure counts for the tallness rule (SPEC-v4 §11.3 V8). */
export const TALL_REACH = 12;

const TREE_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['tree', 'darktree', 'deadtree', 'pine', 'frostpine', 'duskwillow']);

/** Footprints (tiles) by structure kind. */
export const STRUCTURE_FOOTPRINT: Readonly<Record<StructureKind, { w: number; h: number }>> = {
  smithy: { w: 4, h: 3 },
  chapel: { w: 4, h: 4 },
  hut: { w: 3, h: 3 },
  hall: { w: 6, h: 4 },
  house: { w: 3, h: 3 },
  tent: { w: 3, h: 2 },
  ruin: { w: 4, h: 3 },
  tower: { w: 2, h: 3 },
  well: { w: 1, h: 1 },
};

/** Light woods tree chance / stony ground rock chance. */
export const WOODS_CHANCE = 0.35;
export const STONES_CHANCE = 0.2;

// ------------------------------------------------------------------ geometry helpers

/** Map size in tiles (each layout char = 2×2 tiles). */
export function mapSizeTiles(def: Pick<MapDef, 'layout'>): { w: number; h: number } {
  return { w: (def.layout[0]?.length ?? 0) * 2, h: def.layout.length * 2 };
}

/** Unit step pointing INTO the map, opposite the portal's facing. */
export const INWARD: Readonly<Record<Facing, readonly [number, number]>> = {
  n: [0, 1],
  s: [0, -1],
  e: [-1, 0],
  w: [1, 0],
};

/**
 * Nominal arrival tile for a portal: 2 tiles inward from the rect centre, opposite its facing (SPEC §7.2).
 * Not snapped and not clamped — may be out of bounds or blocked (the validator reports that).
 */
export function arrivalTile(p: Pick<PortalDef, 'tx' | 'ty' | 'w' | 'h' | 'facing'>): [number, number] {
  const [dx, dy] = INWARD[p.facing];
  // Along the inward axis, a point on a tile boundary rounds further inward so all four facings are symmetric.
  const pick = (c: number, d: number) => (d < 0 ? Math.ceil(c) - 1 : Math.floor(c));
  return [pick(p.tx + p.w / 2 + 2 * dx, dx), pick(p.ty + p.h / 2 + 2 * dy, dy)];
}

/** Px centre of a tile. */
export function tileCenterPx(tx: number, ty: number): { x: number; y: number } {
  return { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 };
}

/** Ground tile at (tx, ty); VOID outside the map. */
export function tileAt(cm: CompiledMap, tx: number, ty: number): TileId {
  if (tx < 0 || ty < 0 || tx >= cm.w || ty >= cm.h) return T.VOID;
  return cm.ground[ty * cm.w + tx];
}

/** True when the tile blocks movement (outside the map counts as blocked). */
export function isBlocked(cm: CompiledMap, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= cm.w || ty >= cm.h) return true;
  return (cm.coll[ty * cm.w + tx] & COLL.BLOCK) !== 0;
}

/** isBlocked for a world position in px. */
export function isBlockedPx(cm: CompiledMap, x: number, y: number): boolean {
  return isBlocked(cm, Math.floor(x / TILE), Math.floor(y / TILE));
}

/** Nearest tile (Chebyshev rings, Euclidean pick, scan order breaks ties) satisfying `ok`. */
function nearestTile(
  w: number,
  h: number,
  ok: (i: number) => boolean,
  tx: number,
  ty: number,
  maxR: number,
): [number, number] | null {
  for (let r = 0; r <= maxR; r++) {
    let best: [number, number] | null = null;
    let bestD = Infinity;
    for (let y = ty - r; y <= ty + r; y++) {
      if (y < 0 || y >= h) continue;
      for (let x = tx - r; x <= tx + r; x++) {
        if (x < 0 || x >= w) continue;
        if (Math.max(Math.abs(x - tx), Math.abs(y - ty)) !== r) continue;
        if (!ok(y * w + x)) continue;
        const d = (x - tx) * (x - tx) + (y - ty) * (y - ty);
        if (d < bestD) {
          bestD = d;
          best = [x, y];
        }
      }
    }
    if (best) return best;
  }
  return null;
}

// 8-neighbour ring in cyclic order; consecutive entries are 4-adjacent to each other.
const RING: readonly [number, number][] = [
  [0, -1],
  [1, -1],
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
];

/**
 * True when blocking (x, y) cannot split the walkable area: every walkable orthogonal neighbour stays connected to
 * the others through the 3×3 ring. Random props use this so seeded scatter never changes reachability.
 */
function safeToBlock(coll: Uint8Array, w: number, h: number, x: number, y: number): boolean {
  const free: boolean[] = RING.map(([dx, dy]) => {
    const nx = x + dx;
    const ny = y + dy;
    return nx >= 0 && ny >= 0 && nx < w && ny < h && (coll[ny * w + nx] & COLL.BLOCK) === 0;
  });
  const start = free.indexOf(false);
  if (start < 0) return true; // fully open ring
  let arcs = 0;
  let inArc = false;
  let arcHasOrtho = false;
  for (let k = 1; k <= 8; k++) {
    const j = (start + k) % 8;
    if (free[j]) {
      if (!inArc) {
        inArc = true;
        arcHasOrtho = false;
      }
      if (j % 2 === 0) arcHasOrtho = true;
    } else if (inArc) {
      inArc = false;
      if (arcHasOrtho) arcs++;
    }
  }
  if (inArc && arcHasOrtho) arcs++;
  return arcs <= 1;
}

// ------------------------------------------------------------------ compiler

const WALL_TILES: ReadonlySet<number> = new Set([T.CLIFF, T.CAVE_WALL, T.CRYPT_WALL]);
const NO_PROP_TILES: ReadonlySet<number> = new Set([T.PATH, T.BRIDGE, T.COBBLE]);
const SPAWN_NEIGHBOURS: readonly [number, number][] = [
  [0, 1],
  [1, 0],
  [-1, 0],
  [0, -1],
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
];

/** Validates the layout grid and returns its tile size. Throws a descriptive error on malformed layouts. */
function checkLayout(def: MapDef): { w: number; h: number } {
  const id = def.id ?? '?';
  if (!Array.isArray(def.layout) || def.layout.length === 0 || def.layout[0].length === 0) {
    throw new Error(`compileMap(${id}): layout is empty`);
  }
  const cols = def.layout[0].length;
  def.layout.forEach((row, r) => {
    if (row.length !== cols) {
      throw new Error(`compileMap(${id}): layout row ${r} has ${row.length} chars, expected ${cols} (all rows must be equal length)`);
    }
    for (let c = 0; c < row.length; c++) {
      if (!(row[c] in MACRO_LEGEND)) {
        throw new Error(`compileMap(${id}): unknown layout char ${JSON.stringify(row[c])} at row ${r}, col ${c}`);
      }
    }
  });
  return { w: cols * 2, h: def.layout.length * 2 };
}

/** Compiles a MapDef. Deterministic: the same def always yields identical ground/coll/props/arrivals/spawn. */
export function compileMap(def: MapDef): CompiledMap {
  const { w, h } = checkLayout(def);
  const biome = BIOMES[def.biome];
  if (!biome) throw new Error(`compileMap(${def.id}): unknown biome ${JSON.stringify(def.biome)}`);
  const n = w * h;
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const macroAt = (x: number, y: number): MacroDef => MACRO_LEGEND[def.layout[y >> 1][x >> 1]];

  // 1) expand macro chars into tiles
  const ground = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const m = macroAt(x, y);
      ground[y * w + x] =
        m.tile === 'ground' ? biome.ground : m.tile === 'alt' ? biome.alt : m.tile === 'wall' ? biome.wall : T[m.tile];
    }
  }

  // 2) shore: biome ground next to water becomes sand
  if (SHORE_BIOMES.has(def.biome)) {
    const shore: number[] = [];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!macroAt(x, y).shore) continue;
        let wet = false;
        for (const [dx, dy] of RING) {
          const nx = x + dx;
          const ny = y + dy;
          if (inB(nx, ny) && WATER_TILES.has(ground[ny * w + nx])) {
            wet = true;
            break;
          }
        }
        if (wet) shore.push(y * w + x);
      }
    }
    for (const i of shore) ground[i] = T.SAND;
  }

  // 3) paths: 2-wide polylines; water -> bridge; walls/void/lava untouched
  const pathMask = new Uint8Array(n);
  const paint = (px: number, py: number) => {
    for (let dy = 0; dy < 2; dy++) {
      for (let dx = 0; dx < 2; dx++) {
        const x = px + dx;
        const y = py + dy;
        if (!inB(x, y)) continue;
        const i = y * w + x;
        const cur = ground[i];
        if (WALL_TILES.has(cur) || cur === T.VOID || cur === T.LAVA) continue;
        if (WATER_TILES.has(cur)) ground[i] = T.BRIDGE;
        else if (cur !== T.COBBLE && cur !== T.BRIDGE) ground[i] = T.PATH;
        pathMask[i] = 1;
      }
    }
  };
  for (const line of def.paths ?? []) {
    if (!line.length) continue;
    if (line.length === 1) paint(Math.round(line[0][0]), Math.round(line[0][1]));
    for (let k = 0; k < line.length - 1; k++) {
      const [x0, y0] = line[k];
      const [x1, y1] = line[k + 1];
      const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      for (let s = 0; s <= steps; s++) {
        const t = steps ? s / steps : 0;
        paint(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
      }
    }
  }

  // Terrain collision.
  const coll = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const g = ground[i];
    if (BLOCKING_TILES.has(g)) coll[i] |= COLL.BLOCK;
    if (WATER_TILES.has(g)) coll[i] |= COLL.WATER;
  }

  const reserved = new Uint8Array(n);
  const reserveRect = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) reserved[y * w + x] = 1;
    }
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) if (pathMask[y * w + x]) reserveRect(x - 1, y - 1, x + 1, y + 1);
  }

  // 4) structures: block the footprint, reserve it plus a 1-tile apron below
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    if (!fp) continue;
    for (let y = s.ty; y < s.ty + fp.h; y++) {
      for (let x = s.tx; x < s.tx + fp.w; x++) if (inB(x, y)) coll[y * w + x] |= COLL.BLOCK;
    }
    reserveRect(s.tx, s.ty, s.tx + fp.w - 1, s.ty + fp.h);
  }

  // 5) portals: rect forced walkable + PORTAL flag, reserve +2
  for (const p of def.portals) {
    for (let y = p.ty; y < p.ty + p.h; y++) {
      for (let x = p.tx; x < p.tx + p.w; x++) {
        if (!inB(x, y)) continue;
        const i = y * w + x;
        const g = ground[i];
        if (WATER_TILES.has(g)) ground[i] = T.BRIDGE;
        else if (BLOCKING_TILES.has(g)) ground[i] = biome.ground;
        coll[i] = (coll[i] & ~(COLL.BLOCK | COLL.WATER)) | COLL.PORTAL;
      }
    }
    reserveRect(p.tx - 2, p.ty - 2, p.tx + p.w + 1, p.ty + p.h + 1);
  }

  // 6) nodes, objects, NPCs: block their tile, reserve the 8 neighbours
  const entities: { tx: number; ty: number }[] = [...(def.nodes ?? []), ...(def.objects ?? []), ...(def.npcs ?? [])];
  for (const e of entities) {
    if (inB(e.tx, e.ty)) coll[e.ty * w + e.tx] |= COLL.BLOCK;
    reserveRect(e.tx - 1, e.ty - 1, e.tx + 1, e.ty + 1);
  }
  for (const s of def.spawns) reserveRect(s.cx - 1, s.cy - 1, s.cx + 1, s.cy + 1);

  // 7) props (SPEC-v4 §11.2 B, D, E): size tiers, groups of big + medium + small, monster clearings and layered
  // tree lines. Collision of the authored blockers ('T', 'C') is what it always was — every hostable tile blocks —
  // only what is DRAWN on them changed, so reachability is untouched there.
  const props: PropInst[] = [];
  const canHost = (i: number) => !reserved[i] && (coll[i] & COLL.BLOCK) === 0 && !NO_PROP_TILES.has(ground[i]);
  const place = (kind: PropKind, x: number, y: number) => {
    props.push({ kind, tx: x, ty: y });
    if (PROP_BLOCKS[kind]) coll[y * w + x] |= COLL.BLOCK;
  };
  const h32 = (tag: string, x: number, y: number) => hashSeed(def.seed, tag, x, y) >>> 0;

  // Clearings: every spawn entry's circle is clean ground (2) with a dressed rim two tiles wide (1).
  const clearing = new Uint8Array(n);
  for (const s of def.spawns) {
    const R = s.r + 3;
    for (let y = Math.max(0, s.cy - R); y <= Math.min(h - 1, s.cy + R); y++) {
      for (let x = Math.max(0, s.cx - R); x <= Math.min(w - 1, s.cx + R); x++) {
        const d = Math.hypot(x - s.cx, y - s.cy);
        const i = y * w + x;
        if (d <= s.r + 0.5) clearing[i] = 2;
        else if (d <= s.r + 2.5 && clearing[i] < 1) clearing[i] = 1;
      }
    }
  }

  /** The look (0..2) least used by props of the same kind and tier within 6 tiles; ties broken by a tile hash. */
  const lookFor = (kind: PropKind, tier: PropTier, x: number, y: number, mass = false): number => {
    const used = [0, 0, 0];
    for (const p of props) {
      if (p.kind !== kind || (p.tier ?? 'M') !== tier || !!p.mass !== mass || p.look === undefined) continue;
      if (Math.abs(p.tx - x) <= 6 && Math.abs(p.ty - y) <= 6) used[p.look]++;
    }
    const start = h32('look', x, y) % 3;
    let best = start;
    for (let k = 1; k < 3; k++) {
      const c = (start + k) % 3;
      if (used[c] < used[best]) best = c;
    }
    return best;
  };

  // 7a) authored blockers first ('T', 'C'), so the random pass sees final terrain.
  const treeLine = TREE_KINDS.has(biome.tree);
  const forest = new Uint8Array(n);
  const stoneMask = new Uint8Array(n);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fill = macroAt(x, y).fill;
      if (fill !== 'forest' && fill !== 'boulders') continue;
      const i = y * w + x;
      if (!canHost(i)) continue;
      if (fill === 'boulders') {
        coll[i] |= COLL.BLOCK;
        stoneMask[i] = 1;
      } else if (treeLine) {
        coll[i] |= COLL.BLOCK;
        forest[i] = 255;
      } else place(biome.tree, x, y);
    }
  }

  // Rock clusters: a lone 'C' cell is a standing stone two heroes tall, touching cells are boulder groups.
  const macroChar = (mx: number, my: number) => (my >= 0 && my < def.layout.length && mx >= 0 && mx < def.layout[0].length ? def.layout[my][mx] : '');
  for (let my = 0; my < h >> 1; my++) {
    for (let mx = 0; mx < w >> 1; mx++) {
      if (MACRO_LEGEND[def.layout[my][mx]].fill !== 'boulders') continue;
      const x = mx * 2;
      const y = my * 2 + 1;
      if (!stoneMask[y * w + x] && !stoneMask[y * w + x + 1] && !stoneMask[(y - 1) * w + x] && !stoneMask[(y - 1) * w + x + 1]) continue;
      const fills = (c: string) => c !== '' && MACRO_LEGEND[c].fill === 'boulders';
      const lone = !fills(macroChar(mx - 1, my)) && !fills(macroChar(mx + 1, my)) && !fills(macroChar(mx, my - 1)) && !fills(macroChar(mx, my + 1));
      const hsh = h32('stone', mx, my);
      const kind: PropKind = lone ? 'menhir' : 'rock';
      props.push({ kind, tx: x, ty: y, tier: 'L', look: lookFor(kind, 'L', x, y), ox: 16 + ((hsh >>> 8) % 7) - 3, oy: -(((hsh >>> 12) % 5) + 1) });
      if (!lone && (hsh & 3) === 0) props.push({ kind: 'rock', tx: x, ty: y, tier: 'S', look: (hsh >>> 4) % 3, ox: ((hsh >>> 16) % 25) - 4, oy: 0 });
    }
  }

  // Tree lines, from the open side inward (SPEC-v4 §11.2 E): undergrowth, a front row of full trees of three
  // heights, a darker second row, then one solid canopy mass. A notch (a fallen log or a low bay) every 8 tiles.
  if (treeLine) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!forest[y * w + x]) continue;
        let open = false;
        for (const [dx, dy] of RING) {
          const nx = x + dx;
          const ny = y + dy;
          if (inB(nx, ny) && !forest[ny * w + nx]) open = true;
        }
        if (open) forest[y * w + x] = 1;
      }
    }
    for (let d = 2; d <= 6; d++) {
      const next: number[] = [];
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          if (forest[y * w + x] !== 255) continue;
          for (const [dx, dy] of RING) {
            const nx = x + dx;
            const ny = y + dy;
            if (inB(nx, ny) && forest[ny * w + nx] === d - 1) {
              next.push(y * w + x);
              break;
            }
          }
        }
      }
      for (const i of next) forest[i] = d;
    }
    for (let i = 0; i < n; i++) if (forest[i] === 255) forest[i] = 7;
    const kind = biome.tree;
    const fungal = def.biome === 'grove' || def.biome === 'glade' || def.biome === 'dusk';
    for (let cy = 0; cy < h >> 1; cy++) {
      for (let cx = 0; cx < w >> 1; cx++) {
        const cell: [number, number][] = [];
        let minD = 99;
        for (const [dx, dy] of [[0, 1], [1, 1], [0, 0], [1, 0]] as const) {
          const x = cx * 2 + dx;
          const y = cy * 2 + dy;
          const d = forest[y * w + x];
          if (!d) continue;
          cell.push([x, y]);
          if (d < minD) minD = d;
        }
        if (!cell.length) continue;
        const hsh = h32('fo', cx, cy);
        const jx = ((hsh >>> 16) % 17) - 8;
        const jy = ((hsh >>> 21) % 5) - 2;
        if (minD === 1) {
          const front = cell.filter(([x, y]) => forest[y * w + x] === 1);
          const notch = h32('notch', cx >> 2, cy >> 2) % 16 === (cx & 3) * 4 + (cy & 3);
          // open ground to the north: the canopy would rise over it, so stand the tree a row back and keep it low
          const [fx, fy] = front[hsh % front.length];
          const south = inB(fx, fy - 1) && !forest[(fy - 1) * w + fx];
          const r = (hsh >>> 8) % 100;
          let host: [number, number] = [fx, fy];
          let tier: PropTier = r < 18 ? 'XL' : r < 88 ? 'L' : 'M';
          if (south) {
            tier = r < 40 ? 'M' : 'L';
            host = cell[0];
          }
          if (notch) {
            if (cell.length >= 2 && (hsh & 1) === 0) props.push({ kind: 'log', tx: cell[0][0], ty: cell[0][1], tier: 'L', look: (hsh >>> 4) % 3, ox: (cell[0][0] === cx * 2 ? 16 : -16) + (jx >> 1), oy: -2, flip: (hsh & 2) !== 0 });
            else props.push({ kind: 'bush', tx: fx, ty: fy, look: (hsh >>> 4) % 3, ox: jx >> 1 });
          } else if (tier === 'M') props.push({ kind, tx: host[0], ty: host[1], ox: jx >> 1, oy: jy });
          else props.push({ kind, tx: host[0], ty: host[1], tier, look: lookFor(kind, tier, host[0], host[1]), ox: jx, oy: jy, flip: (hsh & 4) !== 0 });
          for (const [x, y] of front) {
            if (x === host[0] && y === host[1]) continue;
            const u = h32('ug', x, y);
            if (u % 100 >= 46) continue;
            const pick = (u >>> 8) % 10;
            const ox = ((u >>> 12) % 15) - 7;
            const oy = -((u >>> 18) % 9);
            if (pick < 4) props.push({ kind: 'bush', tx: x, ty: y, look: (u >>> 4) % 3, ox, oy });
            else if (pick < 7 || !fungal) props.push({ kind, tx: x, ty: y, tier: 'S', look: (u >>> 4) % 3, ox, oy, flip: (u & 1) === 1 });
            else props.push({ kind: 'mushroom', tx: x, ty: y, ox, oy });
          }
        } else if (minD === 2) {
          const [x, y] = cell[hsh % cell.length];
          const r = (hsh >>> 8) % 100;
          if (r < 62) props.push({ kind, tx: x, ty: y, tier: 'L', look: lookFor(kind, 'L', x, y), ox: jx, oy: jy, shade: 1, flip: (hsh & 4) !== 0 });
          else if (r < 72) props.push({ kind, tx: x, ty: y, ox: jx >> 1, oy: jy, shade: 1 });
          else props.push({ kind, tx: cell[0][0], ty: cell[0][1], mass: true, look: (hsh >>> 4) % 3, ox: (cell[0][0] === cx * 2 ? 16 : -16) + jx, oy: jy, shade: 1, flip: (hsh & 4) !== 0 });
        } else if (minD === 3 || ((cx + cy) & 1) === 0) {
          props.push({ kind, tx: cell[0][0], ty: cell[0][1], mass: true, look: (hsh >>> 4) % 3, ox: (cell[0][0] === cx * 2 ? 16 : -16) + jx, oy: jy, shade: Math.min(4, minD - 1), flip: (hsh & 4) !== 0 });
        }
      }
    }
  }

  // 7b) seeded groups. Every roll hangs off a lattice cell (hash of seed + cell), so editing one area never
  // reshuffles another; blocking pieces are only placed where they cannot cut a passage, and never inside a clearing.
  const decorScale = Math.max(0, def.decor ?? 1);
  const hostable = (x: number, y: number) => inB(x, y) && canHost(y * w + x) && clearing[y * w + x] !== 2;
  const tryBlock = (x: number, y: number): boolean => {
    if (!hostable(x, y) || !safeToBlock(coll, w, h, x, y)) return false;
    coll[y * w + x] |= COLL.BLOCK;
    return true;
  };
  const AROUND: readonly [number, number][] = [[-2, 1], [2, 0], [1, 2], [-1, -1], [2, 1], [-2, 0], [1, -2], [-1, 2], [3, 1], [-3, 0]];
  /** Places `kind` as a group of big + medium + small around (x, y). Returns whether the big piece went down. */
  const group = (kind: PropKind, x: number, y: number, rnd: () => number, where: (x: number, y: number) => boolean = () => true): boolean => {
    if (!hostable(x, y)) return false;
    const i = y * w + x;
    const start = Math.floor(rnd() * AROUND.length);
    const spots = AROUND.map((_, k) => AROUND[(start + k) % AROUND.length]).map(([dx, dy]) => [x + dx, y + dy] as [number, number]);
    const jit = () => Math.floor(rnd() * 9) - 4;
    const small = (k: PropKind, tier: PropTier | undefined, count: number) => {
      for (const [sx, sy] of spots) {
        if (count <= 0) break;
        if (!hostable(sx, sy) || !where(sx, sy) || props.some((p) => p.tx === sx && p.ty === sy)) continue;
        if (TREE_KINDS.has(k) && ground[sy * w + sx] === T.SAND) continue;
        props.push({ kind: k, tx: sx, ty: sy, ...(tier ? { tier } : {}), look: Math.floor(rnd() * 3), ox: jit(), oy: -Math.floor(rnd() * 6) });
        count--;
      }
    };
    if (TREE_KINDS.has(kind)) {
      if (ground[i] === T.SAND || !tryBlock(x, y)) return false;
      const tier: PropTier = rnd() < 0.24 ? 'XL' : 'L';
      props.push({ kind, tx: x, ty: y, tier, look: lookFor(kind, tier, x, y), ox: jit(), oy: 0, flip: rnd() < 0.5 });
      let med = false;
      for (const [sx, sy] of spots) {
        if (!inB(sx, sy) || !where(sx, sy) || ground[sy * w + sx] === T.SAND || clearing[sy * w + sx] || !tryBlock(sx, sy)) continue;
        props.push({ kind, tx: sx, ty: sy, ox: jit(), oy: 0 });
        med = true;
        break;
      }
      small(rnd() < 0.5 && kind !== 'deadtree' ? kind : 'bush', rnd() < 0.5 && kind !== 'deadtree' ? 'S' : undefined, med ? 1 : 2);
      return true;
    }
    if (kind === 'rock' || kind === 'boulder') {
      if (!tryBlock(x, y)) return false;
      const wide = hostable(x + 1, y) && where(x + 1, y) && safeToBlock(coll, w, h, x + 1, y);
      if (!wide) {
        props.push({ kind: 'boulder', tx: x, ty: y, look: Math.floor(rnd() * 3), ox: jit(), oy: 0 });
        small('rock', 'S', 2);
        return false;
      }
      coll[y * w + x + 1] |= COLL.BLOCK;
      const xl = rnd() < 0.28 && inB(x + 2, y) && where(x + 2, y) && tryBlock(x + 2, y);
      const tier: PropTier = xl ? 'XL' : 'L';
      props.push({ kind: 'rock', tx: x, ty: y, tier, look: lookFor('rock', tier, x, y), ox: xl ? 32 : 16, oy: -2 });
      let med = false;
      for (const [sx, sy] of spots) {
        if (sy === y && sx >= x && sx <= x + 2) continue;
        if (!inB(sx, sy) || !where(sx, sy) || clearing[sy * w + sx] || !tryBlock(sx, sy)) continue;
        props.push({ kind: rnd() < 0.6 ? 'rock' : 'boulder', tx: sx, ty: sy, look: Math.floor(rnd() * 3), ox: jit(), oy: 0 });
        med = true;
        break;
      }
      small('rock', 'S', med ? 1 : 2);
      return true;
    }
    if (!PROP_BLOCKS[kind]) {
      // low growth comes as a clump of three
      props.push({ kind, tx: x, ty: y, look: Math.floor(rnd() * 3), ox: jit(), oy: 0 });
      small(kind, undefined, 2);
      return false;
    }
    if (!tryBlock(x, y)) return false;
    props.push({ kind, tx: x, ty: y });
    return false;
  };
  // low-frequency density mask (8-tile cells): dense here, calm there
  const maskAt = (x: number, y: number) => {
    const fx = x / 8;
    const fy = y / 8;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const v = (cx: number, cy: number) => (h32('mask', cx, cy) & 0xffff) / 0x10000;
    const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
    const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
    const a = v(x0, y0) + (v(x0 + 1, y0) - v(x0, y0)) * sx;
    const b = v(x0, y0 + 1) + (v(x0 + 1, y0 + 1) - v(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const lattice = (G: number, tag: string, fn: (x: number, y: number, m: MacroDef, rnd: () => number) => void) => {
    for (let gy = 0; gy * G < h; gy++) {
      for (let gx = 0; gx * G < w; gx++) {
        const rnd = mulberry32(hashSeed(def.seed, tag, gx, gy));
        const x = gx * G + Math.floor(rnd() * G);
        const y = gy * G + Math.floor(rnd() * G);
        if (inB(x, y)) fn(x, y, macroAt(x, y), rnd);
      }
    }
  };
  lattice(3, 'woods', (x, y, m, rnd) => {
    if (m.fill === 'woods' && rnd() < WOODS_CHANCE * 2.4) group(biome.tree, x, y, rnd, (sx, sy) => macroAt(sx, sy).fill === 'woods');
  });
  lattice(3, 'stones', (x, y, m, rnd) => {
    if (m.fill === 'stones' && rnd() < STONES_CHANCE * 3) group(rnd() < 0.65 ? 'rock' : 'boulder', x, y, rnd, (sx, sy) => macroAt(sx, sy).fill === 'stones');
  });
  const open = (sx: number, sy: number) => {
    const m = macroAt(sx, sy);
    return !m.fill && !!m.decor;
  };
  lattice(5, 'decor', (x, y, m, rnd) => {
    if (m.fill || !m.decor || !biome.decor.length) return;
    const i = y * w + x;
    const chance = m.decor * decorScale * 9 * (0.35 + 1.3 * maskAt(x, y)) * (clearing[i] === 1 ? 1.6 : 1);
    if (rnd() < Math.min(0.95, chance)) group(biome.decor[Math.floor(rnd() * biome.decor.length)], x, y, rnd, open);
  });

  // 7c) tallness (SPEC-v4 §11.2 B): outdoors, every stretch of walkable ground has something three heroes tall
  // within 12 tiles — where the rolls left a gap, one more tree or rock group goes in.
  const outdoor = def.biome !== 'cave' && def.biome !== 'crypt' && def.kind !== 'dungeon' && !def.flags?.includes('indoor');
  if (outdoor && decorScale > 0) {
    const covered = new Uint8Array(n);
    const stampTall = (x: number, y: number) => {
      for (let yy = Math.max(0, y - TALL_REACH); yy <= Math.min(h - 1, y + TALL_REACH); yy++)
        for (let xx = Math.max(0, x - TALL_REACH); xx <= Math.min(w - 1, x + TALL_REACH); xx++) covered[yy * w + xx] = 1;
    };
    for (const p of props) if ((p.tier === 'L' || p.tier === 'XL') && !p.mass && p.kind !== 'log') stampTall(p.tx, p.ty);
    for (const s of def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[s.kind];
      if (fp && s.kind !== 'well') stampTall(s.tx + (fp.w >> 1), s.ty + fp.h - 1);
    }
    const tallKind: PropKind = treeLine ? biome.tree : 'rock';
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        if (covered[i] || coll[i] & COLL.BLOCK) continue;
        let done = false;
        for (let r = 0; r <= 7 && !done; r++) {
          for (let dy = -r; dy <= r && !done; dy++) {
            for (let dx = -r; dx <= r && !done; dx++) {
              if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
              const gx = x + dx;
              const gy = y + dy;
              if (!inB(gx, gy) || clearing[gy * w + gx] === 2) continue;
              if (!open(gx, gy)) continue;
              if (group(tallKind, gx, gy, mulberry32(hashSeed(def.seed, 'tall', gx, gy)), open)) {
                stampTall(gx, gy);
                done = true;
              }
            }
          }
        }
        if (!done) covered[i] = 1;
      }
    }
  }

  // 8) safety flag, arrivals, spawn
  if (def.safety === 'safe') for (let i = 0; i < n; i++) coll[i] |= COLL.SAFE;

  const standable = (i: number) => (coll[i] & (COLL.BLOCK | COLL.PORTAL)) === 0;
  const clampX = (x: number) => Math.min(w - 1, Math.max(0, x));
  const clampY = (y: number) => Math.min(h - 1, Math.max(0, y));

  const arrivals: Record<string, { x: number; y: number }> = {};
  for (const p of def.portals) {
    const [ax, ay] = arrivalTile(p);
    const cx = clampX(ax);
    const cy = clampY(ay);
    const t = nearestTile(w, h, standable, cx, cy, 8) ?? [cx, cy];
    arrivals[p.id] = tileCenterPx(t[0], t[1]);
  }

  let spawnTile: [number, number] | null = null;
  const waystone = (def.objects ?? []).find((o) => o.kind === 'waystone' && inB(o.tx, o.ty));
  if (waystone) {
    for (const [dx, dy] of SPAWN_NEIGHBOURS) {
      const x = waystone.tx + dx;
      const y = waystone.ty + dy;
      if (inB(x, y) && standable(y * w + x)) {
        spawnTile = [x, y];
        break;
      }
    }
    spawnTile ??= nearestTile(w, h, standable, waystone.tx, waystone.ty, 8);
  }
  spawnTile ??= nearestTile(w, h, standable, w >> 1, h >> 1, Math.max(w, h));
  spawnTile ??= [w >> 1, h >> 1];

  return { def, w, h, ground, coll, props, forest, clearing, arrivals, spawn: tileCenterPx(spawnTile[0], spawnTile[1]) };
}
