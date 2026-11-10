// Ground dressing planner (docs/ART-DIRECTION.md §3 "Dressing"). planDressing() is PURE and deterministic per map:
// it reads only the CompiledMap (and its MapDef) and seeds every roll from def.seed, so the same map always gets the
// same flowers, fences and crates. Dressing is purely visual and never blocks: the planner keeps it off blocked tiles,
// portal rects (+1), entity tiles (+1), spawn centres, arrivals, structure footprints/aprons and path tiles (only
// small flat pebbles sit on path edges). Textures come from src/game/art/dressing.ts (keys 'dr_*').
import type Phaser from 'phaser';
import { hashSeed, mulberry32 } from '../../core/rng';
import { STRUCTURE_FOOTPRINT, TILE } from '../../core/world/compile';
import { T, WATER_TILES } from '../../core/world/tiles';
import { COLL, type Biome, type CompiledMap, type StructureKind } from '../../core/world/types';
import { DEPTH, ySort } from './depths';

export interface DressingItem {
  /** Texture key ('dr_*'). Origin is bottom-centre (0.5, 1). */
  key: string;
  /** World position in px of the sprite's bottom-centre. */
  x: number;
  y: number;
  /** Phaser depth: the foot y for standing decor, DRESSING_DECAL_DEPTH for flat ground decals. */
  depthY: number;
  flipX?: boolean;
}

/** Depth for flat decals (pebbles, cracks, bones, cobwebs): above the ground layer, below every y-sorted sprite. */
export const DRESSING_DECAL_DEPTH = DEPTH.DRESSING_FLAT;

/** Keys drawn flat on the ground (no y-sorting). */
export const DRESSING_FLAT: ReadonlySet<string> = new Set(['dr_pebbles', 'dr_ember_crack', 'dr_bones', 'dr_cobweb']);

/**
 * Max jitter (px) of repeated dressing (docs/ART-DIRECTION.md §3, QUALITY-PLAN §12 item 4): every placed sprite is
 * nudged by up to ±DRESSING_JITTER px (staying on the tile the planner checked) and, unless its facing means
 * something, flipped at random — so crates beside every house, reeds along a shore or pebbles along a road never
 * repeat at the same offset and the tile grid never reads. Both come from a seeded hash of the item: deterministic.
 */
export const DRESSING_JITTER = 4;
/** Placed on an exact line or corner (fence runs, posts, corner cobwebs): never nudged or flipped. */
export const DRESSING_ALIGNED: ReadonlySet<string> = new Set(['dr_fence_h', 'dr_fence_v', 'dr_fence_v_end', 'dr_fence_post', 'dr_cobweb']);
/** Facing that means something (banners carry the emblem lit from the left; lanterns hang toward the road). */
export const DRESSING_FACING: ReadonlySet<string> = new Set(['dr_banner_blue', 'dr_banner_red', 'dr_lantern']);
/**
 * A clear lit face and shadow face (light from the top-left, docs/ART-DIRECTION.md §1): jittered but never mirrored,
 * like render/stage.ts PROP_NO_FLIP for props — a mirrored stone, stump, crate or barrel would be lit from the right
 * beside its unmirrored neighbour. Organic dressing (grass, reeds, flowers, mushrooms, logs, bones) keeps the coin.
 */
export const DRESSING_LIT: ReadonlySet<string> = new Set(['dr_stone', 'dr_rubble', 'dr_pebbles', 'dr_stump', 'dr_ice_shards', 'dr_crate', 'dr_crates', 'dr_barrel']);

// ------------------------------------------------------------------ decor tables

type Pick = readonly [key: string, weight: number];
type FlowerColor = 'crimson' | 'rose' | 'cream' | 'violet';

interface Table {
  /** Base chance per eligible off-path tile. */
  density: number;
  items: readonly Pick[];
  /** Flower colours that may form patches here ('flower' picks resolve per patch). */
  flowers?: readonly FlowerColor[];
}

// Mid-size clumps (tall grass, stumps, logs) weigh more than single flowers: with the patch noise they gather into
// clumps, so a field reads as clumps and clearings rather than an even sprinkle of small flowers.
const GREEN: Table = {
  density: 0.22,
  flowers: ['crimson', 'rose', 'cream', 'violet'],
  items: [
    ['flower', 32],
    ['dr_tallgrass_a', 16],
    ['dr_tallgrass_b', 22],
    ['dr_stone', 7],
    ['dr_pebbles', 4],
    ['dr_mushrooms_red', 5],
    ['dr_mushrooms_brown', 4],
    ['dr_stump', 8],
    ['dr_log', 5],
  ],
};
const TOWN_GREEN: Table = {
  density: 0.24,
  flowers: ['crimson', 'rose', 'cream', 'violet'],
  items: [
    ['flower', 46],
    ['dr_tallgrass_a', 16],
    ['dr_tallgrass_b', 10],
    ['dr_stone', 4],
    ['dr_pebbles', 6],
    ['dr_mushrooms_brown', 2],
    ['dr_barrel', 3],
    ['dr_crate', 3],
    ['dr_crates', 2],
  ],
};

/** What stands along a plaza's rim (town and outpost cobble with grass or a wall beside it). */
const PLAZA_RIM: readonly Pick[] = [
  ['dr_crates', 6],
  ['dr_barrel', 6],
  ['dr_crate', 5],
  ['banner', 2],
];
const STONY: Table = {
  density: 0.14,
  flowers: ['cream', 'violet'],
  items: [
    ['dr_pebbles', 22],
    ['dr_stone', 18],
    ['dr_rubble', 16],
    ['dr_tallgrass_a', 14],
    ['flower', 8],
    ['dr_stump', 3],
  ],
};
const SANDY: Table = {
  density: 0.08,
  items: [
    ['dr_pebbles', 30],
    ['dr_stone', 18],
    ['dr_tallgrass_a', 8],
    ['dr_log', 4],
  ],
};
const GROVE: Table = {
  density: 0.18,
  flowers: ['violet'],
  items: [
    ['dr_mushrooms_red', 14],
    ['dr_mushrooms_brown', 16],
    ['dr_spores', 12],
    ['dr_tallgrass_b', 16],
    ['dr_tallgrass_a', 8],
    ['dr_stump', 9],
    ['dr_log', 7],
    ['dr_stone', 5],
    ['flower', 6],
    ['dr_bones', 2],
  ],
};
const GLADE: Table = {
  density: 0.18,
  flowers: ['violet', 'cream'],
  items: [
    ['dr_spores', 18],
    ['flower', 26],
    ['dr_mushrooms_red', 8],
    ['dr_tallgrass_b', 14],
    ['dr_tallgrass_a', 10],
    ['dr_stone', 4],
  ],
};
const DUSK: Table = {
  density: 0.19,
  flowers: ['violet', 'rose'],
  items: [
    ['dr_dusk_blossom', 24],
    ['dr_tallgrass_dusk', 24],
    ['dr_spores', 16],
    ['flower', 12],
    ['dr_mushrooms_red', 6],
    ['dr_stump', 4],
    ['dr_stone', 4],
  ],
};
const STORM: Table = {
  density: 0.16,
  flowers: ['cream', 'violet'],
  items: [
    ['dr_tallgrass_a', 24],
    ['dr_tallgrass_b', 16],
    ['dr_stone', 14],
    ['dr_pebbles', 12],
    ['flower', 14],
    ['dr_stump', 4],
  ],
};
const EMBER: Table = {
  density: 0.13,
  items: [
    ['dr_ember_crack', 30],
    ['dr_pebbles', 14],
    ['dr_rubble', 16],
    ['dr_stone', 10],
    ['dr_bones', 7],
    ['dr_stump', 4],
  ],
};
const FROST: Table = {
  density: 0.14,
  items: [
    ['dr_ice_shards', 30],
    ['dr_tallgrass_frost', 26],
    ['dr_stone', 14],
    ['dr_pebbles', 10],
  ],
};
const CAVE: Table = {
  density: 0.08,
  items: [
    ['dr_pebbles', 24],
    ['dr_rubble', 24],
    ['dr_mushrooms_brown', 12],
    ['dr_spores', 10],
    ['dr_bones', 10],
    ['dr_stone', 8],
    ['dr_candles', 3],
  ],
};
const CRYPT: Table = {
  density: 0.09,
  items: [
    ['dr_bones', 26],
    ['dr_rubble', 24],
    ['dr_pebbles', 14],
    ['dr_candles', 10],
    ['dr_stone', 4],
  ],
};

/** Decor table for a ground tile, refined by the map biome. */
function tableFor(tile: number, biome: Biome, town: boolean): Table | null {
  switch (tile) {
    case T.GRASS:
    case T.GRASS2:
    case T.FLOWERS:
    case T.HILL:
      if (biome === 'glade') return GLADE;
      if (biome === 'dusk') return DUSK;
      if (biome === 'grove') return GROVE;
      if (biome === 'storm' || biome === 'plateau') return STORM;
      return town ? TOWN_GREEN : GREEN;
    case T.GLADE:
      return biome === 'dusk' ? DUSK : GLADE;
    case T.DARK:
    case T.MOSS:
      return biome === 'cave' ? CAVE : biome === 'dusk' ? DUSK : biome === 'glade' ? GLADE : GROVE;
    case T.DUSK:
      return DUSK;
    case T.STORMGRASS:
      return STORM;
    case T.STONE:
      return biome === 'ember' || biome === 'basalt' ? EMBER : STONY;
    case T.SAND:
      return SANDY;
    case T.EMBER:
    case T.BASALT:
      return EMBER;
    case T.SNOW:
    case T.ICE:
      return FROST;
    case T.CAVE:
      return biome === 'crypt' ? CRYPT : CAVE;
    case T.CRYPT:
      return CRYPT;
    default:
      return null;
  }
}

/** Clutter stacked beside each structure kind (left/right of the front wall). */
const STRUCTURE_CLUTTER: Readonly<Record<StructureKind, readonly string[]>> = {
  smithy: ['dr_barrel', 'dr_crates', 'dr_crate'],
  hall: ['dr_banner_blue', 'dr_banner_blue', 'dr_lantern'],
  chapel: ['flower:rose', 'flower:cream', 'dr_lantern'],
  hut: ['dr_log', 'dr_stump', 'dr_barrel'],
  house: ['flower:crimson', 'dr_barrel', 'flower:cream'],
  tent: ['dr_crates', 'dr_barrel', 'dr_crate'],
  ruin: ['dr_rubble', 'dr_stone', 'dr_tallgrass_b'],
  tower: ['dr_banner_red', 'dr_crates', 'dr_barrel'],
  well: ['dr_barrel'],
};

/** Visual height (px) of each structure texture, to keep decor out from under roofs. */
const STRUCTURE_TEX_H: Readonly<Record<StructureKind, number>> = {
  smithy: 128,
  chapel: 176,
  hut: 100,
  hall: 156,
  house: 108,
  tent: 72,
  ruin: 104,
  tower: 160,
  well: 48,
};

const PATH_TILES: ReadonlySet<number> = new Set([T.PATH, T.BRIDGE, T.COBBLE]);
const WALL_TILES: ReadonlySet<number> = new Set([T.CAVE_WALL, T.CRYPT_WALL, T.CLIFF]);
const FENCE_BIOMES: ReadonlySet<Biome> = new Set<Biome>(['meadow', 'town']);
const SHORE_REED_BIOMES: ReadonlySet<Biome> = new Set<Biome>(['meadow', 'lake', 'town', 'grove', 'glade', 'dusk', 'storm', 'hill']);

// ------------------------------------------------------------------ zones

/** Dressing zone of a cell. NONE: nothing grows (blocked, water, path, plaza). */
export const ZONE = { NONE: 0, CALM: 1, MEDIUM: 2, DENSE: 3 } as const;
/** Poisson spacing between dressing anchors, in tiles (SPEC-v4 §11.2 D). */
export const SPACING = { calm: 5, medium: 2.5, dense: 1.2 } as const;
/** Tables dressed by the ecology rules (the green outdoor ones); the others keep plain picks from their table. */
const ECOLOGY: ReadonlySet<Table> = new Set<Table>([GREEN, TOWN_GREEN, GROVE, GLADE, DUSK, STONY]);

export interface DressingZones {
  /** ZONE per cell (row-major). */
  zones: Uint8Array;
  /** 1 where the cell lies under or beside a tree (within 2 tiles of a tree prop or a tree line). */
  underTree: Uint8Array;
  /** 1 on the sunlit side of a wood: 2 – 4 tiles from a tree line, not under a tree. */
  sunEdge: Uint8Array;
  /** 1 at a cliff's or wall's foot (a wall within 1 tile). */
  wallFoot: Uint8Array;
}

/**
 * Splits a map's ground into calm, medium and dense cells (about 60 / 30 / 10 by area outdoors). Dense: within 3 tiles
 * of a border (tree line, cliff, water), a structure or a big prop, where the map's low-frequency mask allows. Calm:
 * paths (+1 tile), plazas, portal arrivals (+2), monster clearings, and wherever the mask says so. Pure per map.
 */
export function planZones(cm: CompiledMap): DressingZones {
  const { w, h, ground, coll, def } = cm;
  const n = w * h;
  const seed = def.seed >>> 0;
  const zones = new Uint8Array(n);
  const underTree = new Uint8Array(n);
  const sunEdge = new Uint8Array(n);
  const wallFoot = new Uint8Array(n);
  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  // distance (Chebyshev, capped) to the nearest source cell, by repeated dilation
  const spreadFrom = (src: (i: number) => boolean, max: number): Uint8Array => {
    const d = new Uint8Array(n).fill(255);
    let frontier: number[] = [];
    for (let i = 0; i < n; i++)
      if (src(i)) {
        d[i] = 0;
        frontier.push(i);
      }
    for (let step = 1; step <= max && frontier.length; step++) {
      const next: number[] = [];
      for (const i of frontier) {
        const x = i % w;
        const y = (i - x) / w;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (!inB(nx, ny)) continue;
            const j = ny * w + nx;
            if (d[j] !== 255) continue;
            d[j] = step;
            next.push(j);
          }
      }
      frontier = next;
    }
    return d;
  };
  const treeAt = new Uint8Array(n);
  const bigAt = new Uint8Array(n);
  const TREES = new Set(['tree', 'darktree', 'deadtree', 'pine', 'frostpine', 'duskwillow', 'log']);
  for (const p of cm.props) {
    const i = p.ty * w + p.tx;
    if (TREES.has(p.kind) && p.tier !== 'S') treeAt[i] = 1;
    if (p.tier === 'L' || p.tier === 'XL') bigAt[i] = 1;
  }
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    if (!fp) continue;
    for (let y = s.ty; y < s.ty + fp.h; y++) for (let x = s.tx; x < s.tx + fp.w; x++) if (inB(x, y)) bigAt[y * w + x] = 1;
  }
  const forest = cm.forest;
  const dForest = spreadFrom((i) => !!forest?.[i], 4);
  const dTree = spreadFrom((i) => !!treeAt[i] || !!forest?.[i], 2);
  const dWall = spreadFrom((i) => WALL_TILES.has(ground[i]), 3);
  const dWater = spreadFrom((i) => WATER_TILES.has(ground[i]), 3);
  const dBig = spreadFrom((i) => !!bigAt[i], 3);
  const dPath = spreadFrom((i) => PATH_TILES.has(ground[i]), 1);
  const calm = new Uint8Array(n);
  const mark = (x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) calm[y * w + x] = 1;
  };
  for (const a of [...Object.values(cm.arrivals), cm.spawn]) {
    const ax = Math.floor(a.x / TILE);
    const ay = Math.floor(a.y / TILE);
    mark(ax - 2, ay - 2, ax + 2, ay + 2);
  }
  // low-frequency mask (9-tile cells)
  const CELLM = 9;
  const mv = (cx: number, cy: number) => mulberry32(hashSeed(seed, 'zone', cx, cy))();
  const mask = (x: number, y: number) => {
    const fx = x / CELLM;
    const fy = y / CELLM;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const sx = (fx - x0) ** 2 * (3 - 2 * (fx - x0));
    const sy = (fy - y0) ** 2 * (3 - 2 * (fy - y0));
    const a = mv(x0, y0) + (mv(x0 + 1, y0) - mv(x0, y0)) * sx;
    const b = mv(x0, y0 + 1) + (mv(x0 + 1, y0 + 1) - mv(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (coll[i] & COLL.BLOCK || PATH_TILES.has(ground[i]) || WATER_TILES.has(ground[i])) continue;
      const m = mask(x, y);
      const clear = cm.clearing?.[i] ?? 0;
      const border = Math.min(dForest[i], dWall[i], dWater[i], dBig[i]);
      underTree[i] = dTree[i] <= 2 ? 1 : 0;
      sunEdge[i] = dForest[i] >= 2 && dForest[i] <= 4 && dTree[i] > 1 ? 1 : 0;
      wallFoot[i] = dWall[i] <= 1 ? 1 : 0;
      if (clear === 2 || calm[i] || dPath[i] <= 1) zones[i] = ZONE.CALM;
      else if (border <= 1 && m > 0.55) zones[i] = ZONE.DENSE;
      else if (border <= 2 && m > 0.42) zones[i] = ZONE.MEDIUM;
      else if (clear === 1 || m > 0.74) zones[i] = ZONE.MEDIUM;
      else zones[i] = ZONE.CALM;
    }
  return { zones, underTree, sunEdge, wallFoot };
}

/** Share of a map's dressable cells in each zone (the 60 / 30 / 10 rule; tests and validateWorld V13). */
export function zoneMix(cm: CompiledMap): { calm: number; medium: number; dense: number } {
  const { zones } = planZones(cm);
  let c = 0;
  let m = 0;
  let d = 0;
  for (const z of zones) {
    if (z === ZONE.CALM) c++;
    else if (z === ZONE.MEDIUM) m++;
    else if (z === ZONE.DENSE) d++;
  }
  const t = Math.max(1, c + m + d);
  return { calm: c / t, medium: m / t, dense: d / t };
}

// ------------------------------------------------------------------ planner

/**
 * Plans every dressing sprite for a compiled map (px positions, bottom-centre anchored). Pure + deterministic.
 * Order: fences & lanterns along roads, structure/camp/portal clutter, dungeon wall decor, shore reeds, field scatter,
 * path-edge pebbles. Each tile hosts at most one planned item (fences included), except deliberate flower clusters.
 */
export function planDressing(cm: CompiledMap): DressingItem[] {
  const { w, h, ground, coll, def } = cm;
  const n = w * h;
  const seed = def.seed >>> 0;
  const town = def.kind === 'town';
  const dungeon = def.kind === 'dungeon' || def.biome === 'cave' || def.biome === 'crypt';
  const scale = Math.max(0, def.decor ?? 1) * (def.kind === 'town' ? 1 : def.kind === 'outpost' ? 0.8 : dungeon ? 0.9 : 1);
  const out: DressingItem[] = [];

  const inB = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const idx = (x: number, y: number) => y * w + x;
  const tileAt = (x: number, y: number) => (inB(x, y) ? ground[idx(x, y)] : T.VOID);
  const isPath = (x: number, y: number) => inB(x, y) && PATH_TILES.has(ground[idx(x, y)]);
  const isWater = (x: number, y: number) => inB(x, y) && WATER_TILES.has(ground[idx(x, y)]);
  const isWall = (x: number, y: number) => !inB(x, y) || WALL_TILES.has(ground[idx(x, y)]);
  const blocked = (x: number, y: number) => !inB(x, y) || (coll[idx(x, y)] & COLL.BLOCK) !== 0;
  const rng = (...parts: (string | number)[]) => mulberry32(hashSeed(seed, 'dress', ...parts));

  // --- exclusion masks
  const ban = new Uint8Array(n); // nothing at all here
  const fenceBan = new Uint8Array(n); // no fences/lanterns (wider berth)
  const used = new Uint8Array(n); // one planned item per tile
  const mark = (arr: Uint8Array, x0: number, y0: number, x1: number, y1: number) => {
    for (let y = Math.max(0, y0); y <= Math.min(h - 1, y1); y++) for (let x = Math.max(0, x0); x <= Math.min(w - 1, x1); x++) arr[idx(x, y)] = 1;
  };
  for (let i = 0; i < n; i++) if (coll[i] & (COLL.BLOCK | COLL.PORTAL)) ban[i] = 1;
  for (const p of def.portals) {
    mark(ban, p.tx - 1, p.ty - 1, p.tx + p.w, p.ty + p.h);
    mark(fenceBan, p.tx - 2, p.ty - 2, p.tx + p.w + 1, p.ty + p.h + 1);
  }
  for (const e of [...(def.nodes ?? []), ...(def.objects ?? []), ...(def.npcs ?? [])]) {
    mark(ban, e.tx - 1, e.ty - 1, e.tx + 1, e.ty + 1);
    mark(fenceBan, e.tx - 2, e.ty - 2, e.tx + 2, e.ty + 2);
  }
  for (const s of def.spawns) mark(ban, s.cx - 1, s.cy - 1, s.cx + 1, s.cy + 1);
  const pxTile = (p: { x: number; y: number }): [number, number] => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
  for (const a of [...Object.values(cm.arrivals), cm.spawn]) {
    const [ax, ay] = pxTile(a);
    mark(ban, ax - 1, ay - 1, ax + 1, ay + 1);
    mark(fenceBan, ax - 2, ay - 2, ax + 2, ay + 2);
  }
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    if (!fp) continue;
    const above = Math.max(0, Math.ceil((STRUCTURE_TEX_H[s.kind] - 4 - fp.h * TILE) / TILE));
    mark(ban, s.tx, s.ty - above, s.tx + fp.w - 1, s.ty + fp.h); // footprint, roof overhang, apron
    mark(fenceBan, s.tx - 1, s.ty - above, s.tx + fp.w, s.ty + fp.h + 1);
  }
  for (const pr of cm.props) ban[idx(pr.tx, pr.ty)] = 1;

  const free = (x: number, y: number) => inB(x, y) && !ban[idx(x, y)] && !used[idx(x, y)] && !isPath(x, y) && !isWater(x, y);
  /**
   * Adds one item. `flipX` is kept only for DRESSING_FACING / DRESSING_ALIGNED keys; DRESSING_LIT keys are never
   * mirrored; every other item takes a seeded coin flip. `jit` = max nudge [x, y] in px (DRESSING_JITTER by default).
   * The nudge keeps the item on the tile its foot was planned on, so every check above still holds.
   */
  const put = (key: string, x: number, y: number, flipX?: boolean, tx = -1, ty = -1, jit: readonly [number, number] = [DRESSING_JITTER, DRESSING_JITTER]) => {
    let xi = Math.round(x);
    let yi = Math.round(y);
    let flip = flipX ?? false;
    if (!DRESSING_ALIGNED.has(key)) {
      const jr = mulberry32(hashSeed(seed, 'jit', key, xi, yi, out.length));
      const cx = Math.floor(xi / TILE);
      const cy = Math.floor((yi - 1) / TILE);
      xi = Math.min(cx * TILE + TILE - 1, Math.max(cx * TILE + 1, xi + Math.round((jr() * 2 - 1) * jit[0])));
      yi = Math.min(cy * TILE + TILE, Math.max(cy * TILE + 2, yi + Math.round((jr() * 2 - 1) * jit[1])));
      // facing matters only for banners and lanterns, lit faces never mirror; everything else takes this seeded coin
      // (the planner's own per-tile coin correlated with its pick and placement rolls)
      const coin = jr() < 0.5;
      if (DRESSING_LIT.has(key)) flip = false;
      else if (!DRESSING_FACING.has(key)) flip = coin;
    }
    out.push({ key, x: xi, y: yi, depthY: DRESSING_FLAT.has(key) ? DRESSING_DECAL_DEPTH : ySort(yi), ...(flip ? { flipX: true } : {}) });
    if (tx >= 0 && ty >= 0 && inB(tx, ty)) used[idx(tx, ty)] = 1;
  };

  // a dominant flower colour per 5x5-tile cell
  const CELL = 5;
  const flowerKey = (table: Table, x: number, y: number, r: () => number, color?: FlowerColor): string => {
    const cols = table.flowers ?? ['cream'];
    const c = color ?? cols[Math.floor(mulberry32(hashSeed(seed, 'fcol', Math.floor(x / CELL), Math.floor(y / CELL)))() * cols.length)];
    const s = r();
    return `dr_flower_${c}_${s < 0.15 ? 's' : s < 0.6 ? 'm' : 'l'}`;
  };
  const pick = (items: readonly Pick[], r: () => number): string => {
    let total = 0;
    for (const [, wt] of items) total += wt;
    let v = r() * total;
    for (const [k, wt] of items) {
      v -= wt;
      if (v <= 0) return k;
    }
    return items[items.length - 1][0];
  };
  const resolve = (key: string, x: number, y: number, r: () => number): string => {
    if (key === 'flower') {
      const table = tableFor(tileAt(x, y), def.biome, town) ?? GREEN;
      return flowerKey(table, x, y, r);
    }
    if (key.startsWith('flower:')) return flowerKey(GREEN, x, y, r, key.slice(7) as FlowerColor);
    return key;
  };

  // --- zones (SPEC-v4 §11.2 D): calm / medium / dense per cell, and what grows where
  const { zones, underTree, sunEdge, wallFoot } = planZones(cm);

  // --- 1) fences and lanterns along roads (town / meadow / camp areas)
  const fenced = FENCE_BIOMES.has(def.biome) || def.kind === 'outpost' || town;
  if (fenced) planFences();
  if (town || def.kind === 'outpost') planLanterns();

  // --- 2) clutter beside structures, around camps and at portal mouths; then the plaza rims
  planStructureClutter();
  planCampAndPortals();
  if (town || def.kind === 'outpost') planPlazaRim();

  // --- 3) dungeon walls: cobwebs in corners, candles against walls
  if (dungeon) planWallDecor();

  // --- 4) shore reeds / ice
  planShore();

  // --- 5) field scatter
  planScatter();

  // --- 6) pebbles on path edges
  planPathEdges();

  return out;

  // ------------------------------------------------------------------ steps

  function planFences(): void {
    // Edge tiles: walkable, free, with a road on exactly one orthogonal side and none across.
    type Side = 'n' | 's' | 'e' | 'w'; // side of the TILE the road lies on
    const roadSide = (x: number, y: number): Side | null => {
      if (!free(x, y) || fenceBan[idx(x, y)]) return null;
      const N = isPath(x, y - 1);
      const S = isPath(x, y + 1);
      const E = isPath(x + 1, y);
      const W = isPath(x - 1, y);
      const k = +N + +S + +E + +W;
      if (k !== 1) return null;
      // diagonal path tiles nearby mean a bend or crossing: leave a gap
      if (N && (isPath(x - 1, y - 1) !== true || isPath(x + 1, y - 1) !== true)) return null;
      if (S && (isPath(x - 1, y + 1) !== true || isPath(x + 1, y + 1) !== true)) return null;
      if (E && (isPath(x + 1, y - 1) !== true || isPath(x + 1, y + 1) !== true)) return null;
      if (W && (isPath(x - 1, y - 1) !== true || isPath(x - 1, y + 1) !== true)) return null;
      // only dirt roads get fences (plazas get lanterns)
      const rt = N ? tileAt(x, y - 1) : S ? tileAt(x, y + 1) : E ? tileAt(x + 1, y) : tileAt(x - 1, y);
      if (rt !== T.PATH) return null;
      return N ? 'n' : S ? 's' : E ? 'e' : 'w';
    };
    // horizontal runs (road north or south of the tile)
    for (const side of ['n', 's'] as const) {
      for (let y = 0; y < h; y++) {
        let x = 0;
        while (x < w) {
          if (roadSide(x, y) !== side) {
            x++;
            continue;
          }
          let x1 = x;
          while (x1 + 1 < w && roadSide(x1 + 1, y) === side) x1++;
          emitRun(x, x1, y, side, true);
          x = x1 + 1;
        }
      }
    }
    // vertical runs (road east or west of the tile)
    for (const side of ['e', 'w'] as const) {
      for (let x = 0; x < w; x++) {
        let y = 0;
        while (y < h) {
          if (roadSide(x, y) !== side) {
            y++;
            continue;
          }
          let y1 = y;
          while (y1 + 1 < h && roadSide(x, y1 + 1) === side) y1++;
          emitRun(y, y1, x, side, false);
          y = y1 + 1;
        }
      }
    }
  }

  /** Splits a straight edge run [a..b] into fence pieces of 2-5 segments with 1-2 tile gaps. */
  function emitRun(a: number, b: number, fixed: number, side: 'n' | 's' | 'e' | 'w', horizontal: boolean): void {
    if (b - a + 1 < 3) return;
    const r = rng('fence', side, fixed, a);
    let i = a + (r() < 0.5 ? 1 : 0);
    while (i <= b) {
      const len = Math.min(b - i + 1, 2 + Math.floor(r() * 4));
      if (len >= 2) {
        for (let k = i; k < i + len; k++) {
          const tx = horizontal ? k : fixed;
          const ty = horizontal ? fixed : k;
          if (horizontal) {
            // road to the south: fence stands at the tile's bottom; road to the north: at the road's lower lip
            const foot = side === 's' ? (ty + 1) * TILE - 3 : ty * TILE + 9;
            put('dr_fence_h', tx * TILE + TILE / 2, foot, false, tx, ty);
          } else {
            const x = side === 'e' ? (tx + 1) * TILE - 6 : tx * TILE + 6;
            put('dr_fence_v', x, (ty + 1) * TILE - 1, false, tx, ty);
          }
        }
        // closing post at the far end of the piece
        const end = i + len;
        if (horizontal) {
          const foot = side === 's' ? (fixed + 1) * TILE - 3 : fixed * TILE + 9;
          if (inB(end, fixed) && !ban[idx(end, fixed)] && !isPath(end, fixed)) put('dr_fence_post', end * TILE + 2, foot);
        } else {
          const x = side === 'e' ? (fixed + 1) * TILE - 6 : fixed * TILE + 6;
          if (inB(fixed, i - 1) && !ban[idx(fixed, i - 1)] && !isPath(fixed, i - 1)) put('dr_fence_v_end', x, i * TILE - 1);
        }
      }
      i += len + 1 + (r() < 0.4 ? 1 : 0);
    }
  }

  function planLanterns(): void {
    // Lanterns line the ROADS in a rhythm (one about every 6 tiles, alternating gaps), and one stands where a road
    // meets a plaza. Never a ring round a plaza's rim (SPEC-v4 §11.2 D "road lining").
    const placed: [number, number][] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!free(x, y) || fenceBan[idx(x, y)]) continue;
        const sides = [tileAt(x, y - 1), tileAt(x, y + 1), tileAt(x - 1, y), tileAt(x + 1, y)];
        if (!sides.includes(T.PATH)) continue;
        // a road mouth: dirt road beside the tile and cobble within 2 tiles
        let mouth = false;
        for (let dy = -2; dy <= 2 && !mouth; dy++) for (let dx = -2; dx <= 2; dx++) if (tileAt(x + dx, y + dy) === T.COBBLE) mouth = true;
        if (!mouth && rng('lamp?', x, y)() > 0.3) continue;
        if (placed.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) < (mouth ? 5 : 7))) continue;
        placed.push([x, y]);
        const toRight = isPath(x + 1, y);
        put('dr_lantern', x * TILE + (toRight ? 24 : 8), (y + 1) * TILE - 6, !toRight, x, y, [0, 3]);
      }
    }
  }

  function planStructureClutter(): void {
    for (const s of def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[s.kind];
      if (!fp) continue;
      const items = STRUCTURE_CLUTTER[s.kind];
      const r = rng('struct', s.kind, s.tx, s.ty);
      const fy = s.ty + fp.h - 1; // front row
      const spots: [number, number, number][] = [
        // [tx, ty, x offset inside the tile toward the wall]
        [s.tx - 1, fy, 22],
        [s.tx + fp.w, fy, 10],
        [s.tx - 1, fy - 1, 22],
        [s.tx + fp.w, fy - 1, 10],
      ];
      let k = 0;
      for (let si = 0; si < spots.length && k < items.length; si++) {
        const [tx, ty, ox] = spots[si];
        if (!free(tx, ty)) continue;
        let key = resolve(items[(k + Math.floor(r() * 2)) % items.length], tx, ty, r);
        // banners flank the front wall only; never stack them on one side
        if (key.startsWith('dr_banner') && si >= 2) key = 'dr_barrel';
        put(key, tx * TILE + ox, (ty + 1) * TILE - 3, key.startsWith('dr_banner') ? false : undefined, tx, ty);
        k++;
      }
    }
  }

  function planCampAndPortals(): void {
    // Campfires: logs and crates around the fire.
    for (const o of def.objects ?? []) {
      if (o.kind !== 'campfire') continue;
      const r = rng('camp', o.tx, o.ty);
      const ring: [number, number, string][] = [
        [o.tx - 2, o.ty, 'dr_log'],
        [o.tx + 2, o.ty + 1, 'dr_crate'],
        [o.tx + 2, o.ty - 1, 'dr_barrel'],
        [o.tx - 2, o.ty - 2, 'dr_crates'],
      ];
      // camps sit on plazas, so cobble counts as free here (dirt roads and bridges still do not)
      const ok = (x: number, y: number) =>
        inB(x, y) && !ban[idx(x, y)] && !used[idx(x, y)] && !isWater(x, y) && (tileAt(x, y) === T.COBBLE || !isPath(x, y));
      for (const [tx, ty, key] of ring) if (ok(tx, ty) && r() < 0.85) put(key, tx * TILE + 16, (ty + 1) * TILE - 6, r() < 0.5, tx, ty);
    }
    // Portal mouths: banners flanking edge portals, crates/candles beside doors and stairs.
    const banner = def.region === 'rift' ? 'dr_banner_red' : 'dr_banner_blue';
    for (const p of def.portals) {
      if (p.reveal) continue;
      const r = rng('portal', p.id);
      if (p.kind === 'edge') {
        const horizontal = p.facing === 'n' || p.facing === 's';
        const inward = p.facing === 'n' ? p.ty + p.h + 1 : p.facing === 's' ? p.ty - 2 : p.facing === 'w' ? p.tx + p.w + 1 : p.tx - 2;
        const flank: [number, number][] = horizontal
          ? [
              [p.tx - 2, inward],
              [p.tx + p.w + 1, inward],
            ]
          : [
              [inward, p.ty - 2],
              [inward, p.ty + p.h + 1],
            ];
        if (dungeon || def.kind === 'arena') continue;
        for (const [tx, ty] of flank) if (free(tx, ty) && !fenceBan[idx(tx, ty)]) put(banner, tx * TILE + 16, (ty + 1) * TILE - 4, false, tx, ty, [2, 2]);
      } else {
        const keys = dungeon ? ['dr_candles', 'dr_bones', 'dr_candles'] : ['dr_crate', 'dr_barrel', 'dr_crates'];
        const spots: [number, number][] = [
          [p.tx - 2, p.ty + p.h - 1],
          [p.tx + p.w + 1, p.ty + p.h - 1],
          [p.tx - 2, p.ty + p.h],
        ];
        let k = 0;
        for (const [tx, ty] of spots) {
          if (!free(tx, ty) || r() < 0.25) continue;
          put(keys[k++ % keys.length], tx * TILE + 16, (ty + 1) * TILE - 6, r() < 0.5, tx, ty);
        }
      }
    }
  }

  /**
   * Plaza rims: cobble tiles with a non-cobble neighbour get crates, barrels, a banner, a lantern or a fence post
   * (about 40%), pushed to the outer edge of the tile. Keeps 2 tiles clear of NPCs, objects, nodes and portals
   * (fenceBan), of road centrelines (def.paths) and of other rim items (none within 2 tiles).
   */
  function planPlazaRim(): void {
    const banner = def.region === 'rift' ? 'dr_banner_red' : 'dr_banner_blue';
    const placed: [number, number][] = [];
    // road centrelines (the map's path polylines, rasterised): nothing within 2 tiles of where a road runs in
    const centre = new Uint8Array(n);
    for (const line of def.paths ?? [])
      for (let k = 0; k + 1 < line.length; k++) {
        const [x0, y0] = line[k];
        const [x1, y1] = line[k + 1];
        const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), 1);
        for (let t = 0; t <= steps; t++) {
          const cx = Math.round(x0 + ((x1 - x0) * t) / steps);
          const cy = Math.round(y0 + ((y1 - y0) * t) / steps);
          if (inB(cx, cy)) centre[idx(cx, cy)] = 1;
        }
      }
    const roadNear = (x: number, y: number) => {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) if (inB(x + dx, y + dy) && centre[idx(x + dx, y + dy)]) return true;
      return false;
    };
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (tileAt(x, y) !== T.COBBLE) continue;
        const i = idx(x, y);
        if (ban[i] || used[i] || fenceBan[i] || blocked(x, y)) continue;
        const N = tileAt(x, y - 1) !== T.COBBLE;
        const S = tileAt(x, y + 1) !== T.COBBLE;
        const E = tileAt(x + 1, y) !== T.COBBLE;
        const W = tileAt(x - 1, y) !== T.COBBLE;
        if (!(N || S || E || W) || roadNear(x, y)) continue;
        const r = rng('rim', x, y);
        // goods stand in a few STACKS (two or three pieces on neighbouring rim tiles), six or more tiles apart:
        // a rim dotted every other tile reads as a ring
        const near = placed.filter(([px, py]) => Math.abs(px - x) <= 6 && Math.abs(py - y) <= 6);
        const stack = near.filter(([px, py]) => Math.abs(px - x) <= 1 && Math.abs(py - y) <= 1);
        if (near.length && (!stack.length || near.length >= 3 || near.length !== stack.length)) continue;
        if (!near.length && r() > 0.3 * Math.max(0.5, scale)) continue;
        placed.push([x, y]);
        const pickKey = pick(PLAZA_RIM, r);
        const key = pickKey === 'banner' ? banner : pickKey;
        // stand against the rim: toward the outer side of the tile
        const ox = E ? 24 : W ? 8 : 10 + r() * 12;
        const oy = S ? 30 : N ? 14 : 18 + r() * 8;
        put(key, x * TILE + ox, y * TILE + oy, key === 'dr_lantern' ? W : key.startsWith('dr_banner') ? false : undefined, x, y, key === 'dr_lantern' ? [0, 3] : undefined);
      }
    }
  }

  function planWallDecor(): void {
    for (let y = 1; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!free(x, y) || !isWall(x, y - 1)) continue;
        const r = rng('wall', x, y);
        const left = isWall(x - 1, y);
        const right = isWall(x + 1, y);
        if ((left || right) && r() < 0.6) {
          // web in the corner under the wall face
          if (left) put('dr_cobweb', x * TILE + 10, y * TILE + 20, false, x, y);
          else put('dr_cobweb', (x + 1) * TILE - 10, y * TILE + 20, true, x, y);
          continue;
        }
        const v = r();
        if (v < 0.07) put('dr_candles', x * TILE + 8 + Math.floor(r() * 16), y * TILE + 16, undefined, x, y);
        else if (v < 0.13) put('dr_cobweb', x * TILE + (r() < 0.5 ? 10 : 22), y * TILE + 20, r() < 0.5, x, y);
      }
    }
  }

  function planShore(): void {
    const frost = def.biome === 'frost';
    if (!frost && !SHORE_REED_BIOMES.has(def.biome)) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!free(x, y)) continue;
        const dirs: [number, number][] = [
          [0, -1],
          [0, 1],
          [-1, 0],
          [1, 0],
        ];
        const wet = dirs.find(([dx, dy]) => isWater(x + dx, y + dy));
        if (!wet) continue;
        const r = rng('shore', x, y);
        if (r() > 0.32 * Math.max(0.5, scale)) continue;
        // stand right at the waterline on the wet side of the tile
        const [dx, dy] = wet;
        const px = dx < 0 ? x * TILE + 6 : dx > 0 ? x * TILE + 26 : x * TILE + 16 + Math.floor((r() - 0.5) * 14);
        const py = dy < 0 ? y * TILE + 10 : dy > 0 ? (y + 1) * TILE - 1 : (y + 1) * TILE - 8 + Math.floor((r() - 0.5) * 8);
        put(frost ? 'dr_ice_shards' : 'dr_reeds', px, py, r() < 0.5, x, y, dx ? [1, DRESSING_JITTER] : [DRESSING_JITTER, 1]);
      }
    }
  }

  /**
   * Rule dressing (SPEC-v4 §11.2 D). No density target: every walkable cell is calm, medium or dense, anchors keep a
   * Poisson spacing per zone (5 / 2.5 / 1.2 tiles) and each anchor grows the cluster its surroundings call for —
   * mushrooms, stumps and logs under trees, a drift of one flower colour on a sunlit wood edge, tall grass at cliff
   * feet and fences, a lone tuft or stone in the open. Clearings (monster ground) stay clean with a dressed rim.
   */
  function planScatter(): void {
    const zone = zones;
    const accepted: [number, number, number][] = []; // x, y (tiles, fractional), radius
    const GRID = 5;
    const gw = Math.ceil(w / GRID);
    const buckets: number[][] = Array.from({ length: gw * Math.ceil(h / GRID) }, () => []);
    const farEnough = (x: number, y: number, r: number) => {
      const gx = Math.floor(x / GRID);
      const gy = Math.floor(y / GRID);
      for (let yy = gy - 1; yy <= gy + 1; yy++)
        for (let xx = gx - 1; xx <= gx + 1; xx++) {
          if (xx < 0 || yy < 0 || xx >= gw || yy * gw + xx >= buckets.length) continue;
          for (const k of buckets[yy * gw + xx]) {
            const [ax, ay, ar] = accepted[k];
            const need = Math.min(r, ar);
            if ((ax - x) ** 2 + (ay - y) ** 2 < need * need) return false;
          }
        }
      return true;
    };
    // visit the tiles in a seeded shuffle, so the darts land without a scan-line bias
    const order = new Uint32Array(n);
    for (let i = 0; i < n; i++) order[i] = i;
    const sh = rng('order');
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(sh() * (i + 1));
      const t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    for (let o = 0; o < n; o++) {
      const i = order[o];
      const x = i % w;
      const y = (i - x) / w;
      if (!free(x, y)) continue;
      const table = tableFor(ground[i], def.biome, town);
      if (!table) continue;
      const z = zone[i];
      if (z === ZONE.NONE) continue;
      const r = rng('s', x, y);
      // clearings hold at most a fifth of the medium dressing
      if (cm.clearing?.[i] === 2 && r() > 0.2) continue;
      const radius = (z === ZONE.DENSE ? SPACING.dense : z === ZONE.MEDIUM ? SPACING.medium : SPACING.calm) / Math.max(0.5, Math.sqrt(scale * table.density / 0.18));
      const fx = x + 0.2 + r() * 0.6;
      const fy = y + 0.3 + r() * 0.6;
      if (!farEnough(fx, fy, radius)) continue;
      accepted.push([fx, fy, radius]);
      buckets[Math.floor(fy / GRID) * gw + Math.floor(fx / GRID)].push(accepted.length - 1);
      grow(table, x, y, z, r);
    }
  }

  /** Where a cluster may reach: the anchor tile, then its neighbours in a seeded order. */
  function around(x: number, y: number, r: () => number, reach = 1): [number, number][] {
    const out: [number, number][] = [];
    for (let dy = -reach; dy <= reach; dy++) for (let dx = -reach; dx <= reach; dx++) if (dx || dy) out.push([x + dx, y + dy]);
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(r() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }

  /** Grows the cluster an anchor's surroundings call for (the ecology rules). */
  function grow(table: Table, x: number, y: number, z: number, r: () => number): void {
    const i = idx(x, y);
    const has = (k: string) => table.items.some(([key]) => key === k);
    const at = (key: string, tx: number, ty: number, low = false) => {
      const edgeS = isPath(tx, ty + 1);
      const edgeN = isPath(tx, ty - 1);
      const ox = isPath(tx + 1, ty) ? 22 + r() * 6 : isPath(tx - 1, ty) ? 4 + r() * 6 : 6 + r() * 20;
      const oy = edgeS ? 26 + r() * 4 : edgeN ? 12 + r() * 4 : (low ? 20 : 12) + r() * (low ? 10 : 18);
      put(key, tx * TILE + ox, ty * TILE + oy, r() < 0.5, tx, ty);
    };
    const spread = (keys: readonly string[], count: number, reach = 1) => {
      let k = 0;
      at(keys[k++ % keys.length], x, y);
      for (const [nx, ny] of around(x, y, r, reach)) {
        if (k >= count) break;
        if (!free(nx, ny) || zones[idx(nx, ny)] === ZONE.NONE || cm.clearing?.[idx(nx, ny)] === 2) continue;
        if (tableFor(tileAt(nx, ny), def.biome, town) !== table) continue;
        at(keys[k++ % keys.length], nx, ny);
      }
    };
    if (!ECOLOGY.has(table)) {
      // dungeons, ember, frost, storm and the like keep their own tables: one piece in the calm, two or three where dense
      const count = z === ZONE.DENSE ? 3 : z === ZONE.MEDIUM ? 2 : 1;
      const keys: string[] = [];
      for (let k = 0; k < count; k++) keys.push(resolve(pick(table.items, r), x, y, r));
      spread(keys, count);
      return;
    }
    const grass = has('dr_tallgrass_b') && r() < 0.6 ? 'dr_tallgrass_b' : has('dr_tallgrass_dusk') ? 'dr_tallgrass_dusk' : 'dr_tallgrass_a';
    const shrooms = ['dr_mushrooms_red', 'dr_mushrooms_brown', 'dr_spores'].filter(has);
    if (underTree[i] && r() < 0.75) {
      // under trees and beside logs: mushrooms, a stump or a fallen log, ferny grass
      const v = r();
      if (v < 0.5 && shrooms.length) spread([shrooms[Math.floor(r() * shrooms.length)], shrooms[Math.floor(r() * shrooms.length)], grass], z === ZONE.CALM ? 2 : 3);
      else if (v < 0.75 && has('dr_log')) spread(['dr_log', shrooms[0] ?? grass, grass], 3);
      else if (has('dr_stump')) spread(['dr_stump', grass], 2);
      else spread([grass, grass], 2);
      return;
    }
    if (sunEdge[i] && table.flowers && r() < 0.7) {
      // a drift of ONE colour along the sunlit edge of a wood: 8 – 20 blooms over a few tiles
      const cols = table.flowers;
      const col = cols[Math.floor(mulberry32(hashSeed(seed, 'drift', Math.floor(x / 7), Math.floor(y / 7)))() * cols.length)];
      const n = 3 + Math.floor(r() * 3);
      const keys: string[] = [];
      for (let k = 0; k < n; k++) keys.push(`dr_flower_${col}_${k === 0 ? 'l' : r() < 0.5 ? 'm' : 's'}`);
      spread(keys, n, 2);
      return;
    }
    if (wallFoot[i] && r() < 0.8) {
      // tall grass along cliff feet and fences; pebbles at a cliff's foot
      spread([grass, grass, has('dr_pebbles') ? 'dr_pebbles' : grass], z === ZONE.CALM ? 2 : 3);
      return;
    }
    if (z === ZONE.CALM) {
      // open ground stays quiet: one low tuft, a stone or a few pebbles
      const v = r();
      at(v < 0.55 ? 'dr_tallgrass_a' : v < 0.8 && has('dr_stone') ? 'dr_stone' : has('dr_pebbles') ? 'dr_pebbles' : 'dr_tallgrass_a', x, y, true);
      return;
    }
    const v = r();
    if (v < 0.5) spread([grass, 'dr_tallgrass_a', grass], z === ZONE.DENSE ? 3 : 2);
    else if (v < 0.75 && table.flowers) {
      const key = flowerKey(table, x, y, r);
      spread([key, key.replace(/_(s|m|l)$/, '_s'), grass], z === ZONE.DENSE ? 3 : 2);
    } else if (has('dr_stone')) spread(['dr_stone', has('dr_pebbles') ? 'dr_pebbles' : grass, grass], 2);
    else spread([grass, grass], 2);
  }

  function planPathEdges(): void {
    if (dungeon) return;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const t = tileAt(x, y);
        if (t !== T.PATH || ban[idx(x, y)] || used[idx(x, y)]) continue;
        const N = !isPath(x, y - 1) && !blocked(x, y - 1);
        const S = !isPath(x, y + 1) && !blocked(x, y + 1);
        const E = !isPath(x + 1, y) && !blocked(x + 1, y);
        const W = !isPath(x - 1, y) && !blocked(x - 1, y);
        if (!(N || S || E || W)) continue;
        const r = rng('pe', x, y);
        if (r() > 0.09) continue;
        const ox = E ? 24 : W ? 8 : 8 + r() * 16;
        const oy = S ? 30 : N ? 10 : 12 + r() * 16;
        put('dr_pebbles', x * TILE + ox, y * TILE + oy, r() < 0.5, x, y);
      }
    }
  }
}

// ------------------------------------------------------------------ placement

export interface DressingHandle {
  /** The placed images (for culling or debugging). */
  readonly images: readonly Phaser.GameObjects.Image[];
  /** Destroys every placed image. Safe to call twice. */
  destroy(): void;
}

/**
 * Adds one Image per planned item: origin (0.5, 1), depth = item.depthY (flat decals already carry
 * DRESSING_DECAL_DEPTH). Items whose texture is missing are skipped. Returns a destroy handle.
 */
export function placeDressing(scene: Phaser.Scene, plan: readonly DressingItem[]): DressingHandle {
  const images: Phaser.GameObjects.Image[] = [];
  for (const it of plan) {
    if (!scene.textures.exists(it.key)) continue;
    const img = scene.add.image(it.x, it.y, it.key).setOrigin(0.5, 1).setDepth(it.depthY);
    if (it.flipX) img.setFlipX(true);
    images.push(img);
  }
  return {
    images,
    destroy() {
      for (const img of images) img.destroy();
      images.length = 0;
    },
  };
}
