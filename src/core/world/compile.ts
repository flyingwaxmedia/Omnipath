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
  /** Prop rule: 'forest' biome tree on every tile, 'woods' 35% biome trees, 'stones' 20% rocks/boulders, 'boulders' every tile. */
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
};

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

  // 7) props
  const props: PropInst[] = [];
  const canHost = (i: number) => !reserved[i] && (coll[i] & COLL.BLOCK) === 0 && !NO_PROP_TILES.has(ground[i]);
  const place = (kind: PropKind, x: number, y: number) => {
    props.push({ kind, tx: x, ty: y });
    if (PROP_BLOCKS[kind]) coll[y * w + x] |= COLL.BLOCK;
  };
  // 7a) authored blockers first ('T', 'C'), so the random pass sees final terrain.
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const fill = macroAt(x, y).fill;
      if (fill !== 'forest' && fill !== 'boulders') continue;
      if (canHost(y * w + x)) place(fill === 'forest' ? biome.tree : 'boulder', x, y);
    }
  }
  // 7b) seeded scatter. Rolls are per tile (hash of seed + position) so editing one area never reshuffles another,
  // and blocking scatter is only placed where it cannot cut a passage.
  const decorScale = Math.max(0, def.decor ?? 1);
  const scatter = (kind: PropKind, x: number, y: number) => {
    const i = y * w + x;
    if (TREE_KINDS.has(kind) && ground[i] === T.SAND) return;
    if (PROP_BLOCKS[kind] && !safeToBlock(coll, w, h, x, y)) return;
    place(kind, x, y);
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const m = macroAt(x, y);
      if (m.fill === 'forest' || m.fill === 'boulders') continue;
      if (!m.fill && !m.decor) continue;
      if (!canHost(i)) continue;
      const rnd = mulberry32(hashSeed(def.seed, 'prop', x, y));
      if (m.fill === 'woods') {
        if (rnd() < WOODS_CHANCE) scatter(biome.tree, x, y);
      } else if (m.fill === 'stones') {
        if (rnd() < STONES_CHANCE) scatter(rnd() < 0.65 ? 'rock' : 'boulder', x, y);
      } else if (m.decor && biome.decor.length && rnd() < Math.min(1, m.decor * decorScale)) {
        scatter(biome.decor[Math.floor(rnd() * biome.decor.length)], x, y);
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

  return { def, w, h, ground, coll, props, arrivals, spawn: tileCenterPx(spawnTile[0], spawnTile[1]) };
}
