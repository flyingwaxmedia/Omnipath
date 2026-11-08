// Tile index registry shared by the world compiler (core) and the texture generator (client).
// Order matters: index = position in the tileset atlas.
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
  CAVE: 13,
  CAVE_WALL: 14,
  CRYPT: 15,
  CRYPT_WALL: 16,
  SNOW: 17,
  ICE: 18,
  BASALT: 19,
  LAVA: 20,
  DUSK: 21,
  STORMGRASS: 22,
  VOID: 23,
  CLIFF: 24,
  GLADE: 25,
  MOSS: 26,
} as const;

export type TileName = keyof typeof T;
export const TILE_COUNT = 27;

/** Tiles that block movement by themselves. */
export const BLOCKING_TILES: ReadonlySet<number> = new Set([T.WATER, T.DEEP, T.CAVE_WALL, T.CRYPT_WALL, T.LAVA, T.VOID, T.CLIFF]);

/** Tiles that count as water (block walking, allow fishing, are bridged by paths). */
export const WATER_TILES: ReadonlySet<number> = new Set([T.WATER, T.DEEP]);
