// Deterministic world layout. Pure data — no Phaser — so it can be tested
// and later shared with a server.

export const TILE = 32;
export const MAP_W = 80;
export const MAP_H = 60;

export const T = {
  GRASS: 0,
  GRASS2: 1,
  FLOWERS: 2,
  PATH: 3,
  WATER: 4,
  SAND: 5,
  STONE: 6,
  DARK: 7,
  COBBLE: 8,
  BRIDGE: 9,
  EMBER: 10,
  HILL: 11,
  DEEP: 12,
} as const;
export type TileId = (typeof T)[keyof typeof T];
export const TILE_COUNT = 13;

export type PropKind = 'tree' | 'darktree' | 'deadtree' | 'pine' | 'rock' | 'bush';

export interface Prop {
  kind: PropKind;
  tx: number;
  ty: number;
}

export type InteractKind =
  | 'blacksmith'
  | 'priestess'
  | 'hermit'
  | 'fisher'
  | 'fishing_spot'
  | 'ore'
  | 'wind_shrine'
  | 'obelisk'
  | 'signpost';

export interface InteractDef {
  id: string;
  kind: InteractKind;
  name: string;
  /** World position in px. */
  x: number;
  y: number;
  /** Tiles this object blocks. */
  blocks: [number, number][];
}

export interface BuildingDef {
  kind: 'smithy' | 'chapel' | 'hut';
  tx: number;
  ty: number;
  w: number;
  h: number;
}

export interface SpawnZone {
  id: string;
  name: string;
  monster: string;
  count: number;
  cx: number;
  cy: number;
  /** Radius in tiles. */
  r: number;
}

export interface Region {
  name: string;
  cx: number;
  cy: number;
  rx: number;
  ry: number;
}

export interface WorldMap {
  w: number;
  h: number;
  tiles: TileId[][];
  blocked: boolean[][];
  props: Prop[];
  buildings: BuildingDef[];
  interactables: InteractDef[];
  spawns: SpawnZone[];
  regions: Region[];
  spawnPoint: { x: number; y: number };
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const tileCenter = (tx: number, ty: number) => ({ x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2 });

export function isWaterTile(t: TileId): boolean {
  return t === T.WATER || t === T.DEEP;
}

export function generateWorld(seed = 1337): WorldMap {
  const rnd = mulberry32(seed);
  const w = MAP_W;
  const h = MAP_H;
  const tiles: TileId[][] = [];
  for (let y = 0; y < h; y++) {
    const row: TileId[] = [];
    for (let x = 0; x < w; x++) {
      const r = rnd();
      row.push(r < 0.04 ? T.FLOWERS : r < 0.2 ? T.GRASS2 : T.GRASS);
    }
    tiles.push(row);
  }
  const inBounds = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h;
  const set = (x: number, y: number, t: TileId) => {
    if (inBounds(x, y)) tiles[y][x] = t;
  };
  const ellipse = (cx: number, cy: number, rx: number, ry: number, fn: (x: number, y: number, d: number) => void) => {
    for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++) {
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (!inBounds(x, y)) continue;
        const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
        fn(x, y, d);
      }
    }
  };
  // Wobbly ellipses look more natural.
  const blob = (cx: number, cy: number, rx: number, ry: number, t: TileId, edge?: TileId) =>
    ellipse(cx, cy, rx + 1.2, ry + 1.2, (x, y, d) => {
      const wob = 1 + (rnd() - 0.5) * 0.12;
      if (d * wob <= 1) set(x, y, t);
      else if (edge !== undefined && d * wob <= 1 + 1.4 / Math.min(rx, ry)) set(x, y, edge);
    });

  const regions: Region[] = [
    { name: 'Hearthvale', cx: 22, cy: 30, rx: 10, ry: 8 },
    { name: 'Mirror Lake', cx: 40, cy: 9, rx: 12, ry: 7 },
    { name: 'Greystone Quarry', cx: 64, cy: 26, rx: 9, ry: 7 },
    { name: 'Windcrest Hill', cx: 70, cy: 8, rx: 8, ry: 6 },
    { name: 'Gloomwood', cx: 14, cy: 51, rx: 12, ry: 8 },
    { name: 'Cinder Fields', cx: 50, cy: 49, rx: 10, ry: 7 },
    { name: 'Stormbreak Plateau', cx: 72, cy: 47, rx: 6, ry: 7 },
    { name: 'Greenmeadow', cx: 40, cy: 32, rx: 14, ry: 10 },
  ];

  // Terrain regions.
  blob(40, 9, 11, 6, T.WATER, T.SAND);
  ellipse(40, 9, 7.5, 3.6, (x, y, d) => d <= 1 && set(x, y, T.DEEP));
  blob(64, 26, 9, 7, T.STONE);
  blob(70, 8, 8, 6, T.HILL);
  blob(14, 51, 12, 8, T.DARK);
  blob(50, 49, 10, 7, T.EMBER);
  blob(72, 47, 6, 7, T.STONE);

  // Town plaza.
  for (let y = 24; y <= 36; y++) for (let x = 14; x <= 30; x++) set(x, y, T.COBBLE);

  // Paths from the plaza to every region.
  const paint = (x: number, y: number) => {
    for (let dy = 0; dy < 2; dy++)
      for (let dx = 0; dx < 2; dx++) {
        const px = x + dx;
        const py = y + dy;
        if (!inBounds(px, py)) continue;
        const cur = tiles[py][px];
        if (cur === T.COBBLE) continue;
        if (isWaterTile(cur)) set(px, py, T.BRIDGE);
        else if (cur === T.STONE || cur === T.DARK || cur === T.EMBER || cur === T.HILL) {
          if (rnd() < 0.5) set(px, py, T.PATH);
        } else set(px, py, T.PATH);
      }
  };
  const line = (x0: number, y0: number, x1: number, y1: number) => {
    const steps = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
    for (let i = 0; i <= steps; i++) {
      const t = steps ? i / steps : 0;
      paint(Math.round(x0 + (x1 - x0) * t), Math.round(y0 + (y1 - y0) * t));
    }
  };
  const route = (...pts: [number, number][]) => {
    for (let i = 0; i < pts.length - 1; i++) line(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1]);
  };
  route([22, 24], [26, 20], [38, 18], [38, 16]); // to lake
  route([30, 30], [44, 28], [56, 26]); // to quarry
  route([44, 28], [54, 18], [62, 12], [68, 9]); // to hill
  route([18, 36], [16, 42], [14, 46]); // to grove
  route([26, 36], [36, 42], [46, 47]); // to cinder fields
  route([46, 47], [58, 47], [67, 47]); // to plateau
  route([14, 30], [8, 34], [6, 40]); // to hermit

  // Pier into the lake.
  for (let y = 10; y <= 16; y++) {
    set(38, y, T.BRIDGE);
    set(39, y, T.BRIDGE);
  }

  // ---- Blocking ----
  const blocked: boolean[][] = tiles.map((row) => row.map((t) => isWaterTile(t)));
  const reserved: boolean[][] = tiles.map((row) => row.map(() => false));
  const reserve = (cx: number, cy: number, r: number) => {
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) if (inBounds(x, y)) reserved[y][x] = true;
  };

  const buildings: BuildingDef[] = [
    { kind: 'smithy', tx: 15, ty: 24, w: 4, h: 3 },
    { kind: 'chapel', tx: 25, ty: 23, w: 4, h: 4 },
    { kind: 'hut', tx: 4, ty: 39, w: 3, h: 3 },
  ];
  for (const b of buildings) {
    for (let y = b.ty; y < b.ty + b.h; y++) for (let x = b.tx; x < b.tx + b.w; x++) blocked[y][x] = true;
    reserve(b.tx + Math.floor(b.w / 2), b.ty + b.h, 2);
  }

  const interactables: InteractDef[] = [];
  const addI = (id: string, kind: InteractKind, name: string, tx: number, ty: number, block = true) => {
    const c = tileCenter(tx, ty);
    interactables.push({ id, kind, name, x: c.x, y: c.y, blocks: block ? [[tx, ty]] : [] });
    if (block) blocked[ty][tx] = true;
    reserve(tx, ty, 2);
  };
  addI('blacksmith', 'blacksmith', 'Brann the Smith', 17, 28);
  addI('priestess', 'priestess', 'Sister Alba', 27, 28);
  addI('hermit', 'hermit', 'Old Hermit Oru', 5, 43);
  addI('fisher', 'fisher', 'Fisher Pell', 41, 17);
  addI('fishing_spot', 'fishing_spot', 'Fishing Spot', 38, 10, false);
  addI('wind_shrine', 'wind_shrine', 'Shrine of Winds', 71, 6);
  addI('obelisk', 'obelisk', 'Umbral Obelisk', 8, 55);
  addI('sign', 'signpost', 'Signpost', 19, 33);
  const orePos: [number, number][] = [
    [60, 22], [63, 21], [67, 23], [69, 27], [66, 30], [61, 29], [58, 25], [64, 25],
  ];
  orePos.forEach(([x, y], i) => addI(`ore_${i}`, 'ore', 'Ore Vein', x, y));

  const spawns: SpawnZone[] = [
    { id: 'meadow_w', name: 'Greenmeadow', monster: 'jellop', count: 7, cx: 34, cy: 30, r: 6 },
    { id: 'meadow_s', name: 'Greenmeadow', monster: 'jellop', count: 5, cx: 26, cy: 42, r: 5 },
    { id: 'shore', name: 'Mirror Lake', monster: 'puddlewisp', count: 6, cx: 32, cy: 15, r: 4 },
    { id: 'shore_e', name: 'Mirror Lake', monster: 'puddlewisp', count: 4, cx: 50, cy: 14, r: 3 },
    { id: 'quarry', name: 'Greystone Quarry', monster: 'mossling', count: 7, cx: 64, cy: 26, r: 6 },
    { id: 'hill', name: 'Windcrest Hill', monster: 'gustling', count: 6, cx: 68, cy: 10, r: 5 },
    { id: 'plains_e', name: 'Greenmeadow', monster: 'sparkbug', count: 5, cx: 52, cy: 36, r: 5 },
    { id: 'cinder', name: 'Cinder Fields', monster: 'emberkit', count: 7, cx: 50, cy: 49, r: 6 },
    { id: 'grove', name: 'Gloomwood', monster: 'gloomcap', count: 7, cx: 15, cy: 51, r: 6 },
    { id: 'boss', name: 'Stormbreak Plateau', monster: 'thunderhoof', count: 1, cx: 73, cy: 47, r: 2 },
  ];
  for (const s of spawns) reserve(s.cx, s.cy, 1);

  // Plaza is kept clear.
  for (let y = 24; y <= 36; y++) for (let x = 14; x <= 30; x++) reserved[y][x] = true;

  // ---- Props ----
  const props: Prop[] = [];
  const canProp = (x: number, y: number) => {
    if (!inBounds(x, y) || blocked[y][x] || reserved[y][x]) return false;
    const t = tiles[y][x];
    if (t === T.PATH || t === T.BRIDGE || t === T.COBBLE || t === T.SAND) return false;
    // Keep a one-tile margin around paths so roads stay open.
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx;
        const ny = y + dy;
        if (inBounds(nx, ny) && (tiles[ny][nx] === T.PATH || tiles[ny][nx] === T.BRIDGE)) return false;
      }
    return true;
  };
  const place = (kind: PropKind, x: number, y: number) => {
    props.push({ kind, tx: x, ty: y });
    blocked[y][x] = true;
  };

  // Border forest.
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const edge = x < 2 || y < 2 || x >= w - 2 || y >= h - 2;
      if (!edge || blocked[y][x]) continue;
      const t = tiles[y][x];
      place(t === T.DARK ? 'darktree' : t === T.HILL ? 'pine' : t === T.EMBER ? 'deadtree' : 'tree', x, y);
    }

  for (let y = 2; y < h - 2; y++)
    for (let x = 2; x < w - 2; x++) {
      if (!canProp(x, y)) continue;
      const t = tiles[y][x];
      const r = rnd();
      if (t === T.DARK && r < 0.13) place('darktree', x, y);
      else if (t === T.HILL && r < 0.04) place('pine', x, y);
      else if (t === T.EMBER && r < 0.03) place('deadtree', x, y);
      else if (t === T.STONE && r < 0.03) place('rock', x, y);
      else if ((t === T.GRASS || t === T.GRASS2 || t === T.FLOWERS) && r < 0.05) place(rnd() < 0.8 ? 'tree' : 'bush', x, y);
    }

  return {
    w,
    h,
    tiles,
    blocked,
    props,
    buildings,
    interactables,
    spawns,
    regions,
    spawnPoint: tileCenter(22, 30),
  };
}

export function regionAt(map: WorldMap, px: number, py: number): string {
  const tx = px / TILE;
  const ty = py / TILE;
  let best: Region | null = null;
  let bestD = Infinity;
  for (const r of map.regions) {
    const d = Math.hypot((tx - r.cx) / r.rx, (ty - r.cy) / r.ry);
    if (d <= 1 && d < bestD) {
      best = r;
      bestD = d;
    }
  }
  return best?.name ?? 'The Wilds';
}

export function isWalkable(map: WorldMap, tx: number, ty: number): boolean {
  return tx >= 0 && ty >= 0 && tx < map.w && ty < map.h && !map.blocked[ty][tx];
}

export function isWalkablePx(map: WorldMap, x: number, y: number): boolean {
  return isWalkable(map, Math.floor(x / TILE), Math.floor(y / TILE));
}
