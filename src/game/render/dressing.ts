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
export const DRESSING_DECAL_DEPTH = -50000;

/** Keys drawn flat on the ground (no y-sorting). */
export const DRESSING_FLAT: ReadonlySet<string> = new Set(['dr_pebbles', 'dr_ember_crack', 'dr_bones', 'dr_cobweb']);

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

const GREEN: Table = {
  density: 0.2,
  flowers: ['crimson', 'rose', 'cream', 'violet'],
  items: [
    ['flower', 42],
    ['dr_tallgrass_a', 16],
    ['dr_tallgrass_b', 14],
    ['dr_stone', 5],
    ['dr_pebbles', 5],
    ['dr_mushrooms_red', 4],
    ['dr_mushrooms_brown', 3],
    ['dr_stump', 3],
    ['dr_log', 2],
  ],
};
const TOWN_GREEN: Table = {
  density: 0.24,
  flowers: ['crimson', 'rose', 'cream', 'violet'],
  items: [
    ['flower', 50],
    ['dr_tallgrass_a', 16],
    ['dr_tallgrass_b', 8],
    ['dr_stone', 4],
    ['dr_pebbles', 6],
    ['dr_mushrooms_brown', 2],
  ],
};
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
  const put = (key: string, x: number, y: number, flipX = false, tx = -1, ty = -1) => {
    const xi = Math.round(x);
    const yi = Math.round(y);
    out.push({ key, x: xi, y: yi, depthY: DRESSING_FLAT.has(key) ? DRESSING_DECAL_DEPTH : yi, ...(flipX ? { flipX: true } : {}) });
    if (tx >= 0 && ty >= 0 && inB(tx, ty)) used[idx(tx, ty)] = 1;
  };

  // --- patch noise: smooth density field + a dominant flower colour per 5x5-tile cell
  const CELL = 5;
  const cw = Math.ceil(w / CELL) + 2;
  const cells = new Float32Array(cw * (Math.ceil(h / CELL) + 2));
  for (let i = 0; i < cells.length; i++) cells[i] = mulberry32(hashSeed(seed, 'patch', i % cw, Math.floor(i / cw)))();
  const cellVal = (cx: number, cy: number) => cells[cy * cw + cx];
  const noise = (x: number, y: number) => {
    const fx = x / CELL;
    const fy = y / CELL;
    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;
    const sx = tx * tx * (3 - 2 * tx);
    const sy = ty * ty * (3 - 2 * ty);
    const a = cellVal(x0, y0) + (cellVal(x0 + 1, y0) - cellVal(x0, y0)) * sx;
    const b = cellVal(x0, y0 + 1) + (cellVal(x0 + 1, y0 + 1) - cellVal(x0, y0 + 1)) * sx;
    return a + (b - a) * sy;
  };
  const patchMul = (x: number, y: number) => {
    const v = noise(x, y);
    return v < 0.3 ? 0.25 : 0.55 + (v - 0.3) * 2.1;
  };
  const flowerKey = (table: Table, x: number, y: number, r: () => number, color?: FlowerColor): string => {
    const cols = table.flowers ?? ['cream'];
    const c = color ?? cols[Math.floor(mulberry32(hashSeed(seed, 'fcol', Math.floor(x / CELL), Math.floor(y / CELL)))() * cols.length)];
    const s = r();
    return `dr_flower_${c}_${s < 0.25 ? 's' : s < 0.65 ? 'm' : 'l'}`;
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

  // --- 1) fences and lanterns along roads (town / meadow / camp areas)
  const fenced = FENCE_BIOMES.has(def.biome) || def.kind === 'outpost' || town;
  if (fenced) planFences();
  if (town || def.kind === 'outpost') planLanterns();

  // --- 2) clutter beside structures, around camps and at portal mouths
  planStructureClutter();
  planCampAndPortals();

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
            const x = side === 'e' ? (tx + 1) * TILE - 5 : tx * TILE + 5;
            put('dr_fence_v', x, (ty + 1) * TILE - 1, false, tx, ty);
          }
        }
        // closing post at the far end of the piece
        const end = i + len;
        if (horizontal) {
          const foot = side === 's' ? (fixed + 1) * TILE - 3 : fixed * TILE + 9;
          if (!blocked(end, fixed)) put('dr_fence_post', end * TILE + 2, foot);
        } else {
          const x = side === 'e' ? (fixed + 1) * TILE - 5 : fixed * TILE + 5;
          if (!blocked(fixed, i - 1)) put('dr_fence_post', x, i * TILE - 1);
        }
      }
      i += len + 1 + (r() < 0.4 ? 1 : 0);
    }
  }

  function planLanterns(): void {
    // Lanterns at plaza rims and along roads, spaced at least 5 tiles apart.
    const placed: [number, number][] = [];
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if (!free(x, y) || fenceBan[idx(x, y)]) continue;
        const nearRoad = isPath(x, y - 1) || isPath(x, y + 1) || isPath(x - 1, y) || isPath(x + 1, y);
        if (!nearRoad) continue;
        const plaza = [tileAt(x, y - 1), tileAt(x, y + 1), tileAt(x - 1, y), tileAt(x + 1, y)].includes(T.COBBLE);
        if (!plaza && rng('lamp?', x, y)() > 0.35) continue;
        if (placed.some(([px, py]) => Math.abs(px - x) + Math.abs(py - y) < (plaza ? 5 : 7))) continue;
        placed.push([x, y]);
        const toRight = isPath(x + 1, y);
        put('dr_lantern', x * TILE + (toRight ? 24 : 8), (y + 1) * TILE - 6, !toRight, x, y);
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
      for (const [tx, ty, ox] of spots) {
        if (k >= items.length) break;
        if (!free(tx, ty)) continue;
        const key = resolve(items[(k + Math.floor(r() * 2)) % items.length], tx, ty, r);
        put(key, tx * TILE + ox, (ty + 1) * TILE - 3, tx >= s.tx + fp.w && !key.startsWith('dr_banner'), tx, ty);
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
      for (const [tx, ty, key] of ring) if (free(tx, ty) && r() < 0.85) put(key, tx * TILE + 16, (ty + 1) * TILE - 6, r() < 0.5, tx, ty);
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
        for (const [tx, ty] of flank) if (free(tx, ty) && !fenceBan[idx(tx, ty)]) put(banner, tx * TILE + 16, (ty + 1) * TILE - 4, false, tx, ty);
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
        if (v < 0.07) put('dr_candles', x * TILE + 8 + Math.floor(r() * 16), y * TILE + 16, false, x, y);
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
        const [dx, dy] = wet;
        const px = x * TILE + 16 + dx * 9 + Math.floor((r() - 0.5) * 10);
        const py = (y + 1) * TILE - 4 + dy * 8;
        put(frost ? 'dr_ice_shards' : 'dr_reeds', px, py, r() < 0.5, x, y);
      }
    }
  }

  function planScatter(): void {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!free(x, y)) continue;
        const table = tableFor(ground[idx(x, y)], def.biome, town);
        if (!table) continue;
        const r = rng('s', x, y);
        const edge = isPath(x, y - 1) || isPath(x, y + 1) || isPath(x - 1, y) || isPath(x + 1, y);
        const chance = table.density * scale * patchMul(x, y) * (edge ? 1.6 : 1);
        if (r() >= chance) continue;
        const key = resolve(pick(table.items, r), x, y, r);
        // position inside the tile, nudged toward an adjacent road so road edges read as dressed
        let ox = 6 + r() * 20;
        let oy = 12 + r() * 18;
        if (isPath(x, y + 1)) oy = 26 + r() * 4;
        else if (isPath(x, y - 1)) oy = 12 + r() * 4;
        if (isPath(x + 1, y)) ox = 22 + r() * 6;
        else if (isPath(x - 1, y)) ox = 4 + r() * 6;
        put(key, x * TILE + ox, y * TILE + oy, r() < 0.5, x, y);
        // flowers and grass come in little clusters: a smaller companion in a free neighbour, sometimes a sprig
        // sharing the tile
        const clumpy = key.startsWith('dr_flower_') || key.startsWith('dr_tallgrass') || key === 'dr_dusk_blossom';
        if (!clumpy) continue;
        const small = key.startsWith('dr_flower_') ? key.replace(/_(s|m|l)$/, r() < 0.6 ? '_s' : '_m') : key;
        if (r() < 0.6) {
          const nx = x + (r() < 0.5 ? -1 : 1);
          const ny = y + (r() < 0.6 ? 0 : 1);
          if (free(nx, ny) && tableFor(tileAt(nx, ny), def.biome, town) === table)
            put(small, nx * TILE + 6 + r() * 20, ny * TILE + 12 + r() * 16, r() < 0.5, nx, ny);
        }
        if (r() < 0.3) {
          const sx = ox < 16 ? ox + 9 + r() * 5 : ox - 9 - r() * 5;
          put(small, x * TILE + sx, y * TILE + Math.min(31, oy + 3 + r() * 4), r() < 0.5);
        }
      }
    }
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
