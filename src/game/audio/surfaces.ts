// What the player's feet stand on (pure): ground tile → footstep surface (src/core/world/tiles.ts T indexes).
import { T } from '../../core/world/tiles';

export type Surface = 'grass' | 'dirt' | 'stone' | 'wood' | 'sand' | 'snow' | 'water' | 'cave';
export const SURFACES: readonly Surface[] = ['grass', 'dirt', 'stone', 'wood', 'sand', 'snow', 'water', 'cave'];

const BY_TILE: Readonly<Record<number, Surface>> = {
  [T.GRASS]: 'grass',
  [T.GRASS2]: 'grass',
  [T.FLOWERS]: 'grass',
  [T.HILL]: 'grass',
  [T.DARK]: 'grass',
  [T.MOSS]: 'grass',
  [T.DUSK]: 'grass',
  [T.STORMGRASS]: 'grass',
  [T.GLADE]: 'grass',
  [T.PATH]: 'dirt',
  [T.EMBER]: 'dirt',
  [T.STONE]: 'stone',
  [T.COBBLE]: 'stone',
  [T.BASALT]: 'stone',
  [T.CRYPT]: 'stone',
  [T.ICE]: 'stone',
  [T.LAVA]: 'stone',
  [T.CLIFF]: 'stone',
  [T.CAVE_WALL]: 'cave',
  [T.CRYPT_WALL]: 'stone',
  [T.VOID]: 'stone',
  [T.BRIDGE]: 'wood',
  [T.SAND]: 'sand',
  [T.SNOW]: 'snow',
  [T.WATER]: 'water',
  [T.DEEP]: 'water',
  [T.CAVE]: 'cave',
};

/** The footstep surface of a ground tile index (unknown tiles walk like dirt). */
export function surfaceOf(tile: number | undefined): Surface {
  return (tile !== undefined && BY_TILE[tile]) || 'dirt';
}

/** The minimal compiled-map shape the lookup needs. */
export interface GroundGrid {
  w: number;
  h: number;
  ground: ArrayLike<number>;
}

/** The surface under a world position (px; `tile` = tile size). */
export function surfaceAt(grid: GroundGrid | undefined, x: number, y: number, tile = 32): Surface {
  if (!grid) return 'dirt';
  const tx = Math.floor(x / tile);
  const ty = Math.floor(y / tile);
  if (tx < 0 || ty < 0 || tx >= grid.w || ty >= grid.h) return 'dirt';
  return surfaceOf(grid.ground[ty * grid.w + tx]);
}
