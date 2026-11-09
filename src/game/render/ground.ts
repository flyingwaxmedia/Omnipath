// Ground baker: renders a compiled map's terrain (base tiles + autotile edge pieces) ONCE into a few static
// RenderTexture chunks. Replaces the Phaser tilemap layer: same depth, nothing to update per frame.
import type Phaser from 'phaser';
import type { CompiledMap } from '../../core/world/types';
import { TILE_PX, computeTerrainLayers } from './autotile';

/** Chunk size in tiles (32 x 32 px = 1024 px, safely under mobile texture limits). */
export const GROUND_CHUNK_TILES = 32;
/** Same depth as the v2 tilemap layer: under every y-sorted sprite and ground decal. */
export const GROUND_DEPTH = -100000;

export interface BakedGround {
  /** Destroys every chunk (and its GPU texture). */
  destroy(): void;
}

/**
 * Bakes the ground of `cm` into static RenderTexture chunks (<= 1024 x 1024 px each) at depth GROUND_DEPTH.
 * Requires the 'tiles' and 'tiles_edge' textures (drawTiles from ../art/tiles). Deterministic for a given map.
 */
export function bakeGround(scene: Phaser.Scene, cm: CompiledMap): BakedGround {
  const { base, overlays } = computeTerrainLayers(cm);
  const C = GROUND_CHUNK_TILES;
  const cols = Math.ceil(cm.w / C);
  const rows = Math.ceil(cm.h / C);

  // Bucket overlays per chunk (they keep their relative order).
  const buckets: { tx: number; ty: number; frame: number }[][] = Array.from({ length: cols * rows }, () => []);
  for (const o of overlays) buckets[Math.floor(o.ty / C) * cols + Math.floor(o.tx / C)].push(o);

  const chunks: Phaser.GameObjects.RenderTexture[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const tx0 = cx * C;
      const ty0 = cy * C;
      const tw = Math.min(C, cm.w - tx0);
      const th = Math.min(C, cm.h - ty0);
      const rt = scene.add.renderTexture(tx0 * TILE_PX, ty0 * TILE_PX, tw * TILE_PX, th * TILE_PX);
      rt.setOrigin(0, 0).setDepth(GROUND_DEPTH);
      rt.beginDraw();
      for (let y = 0; y < th; y++) {
        const row = (ty0 + y) * cm.w;
        for (let x = 0; x < tw; x++) rt.batchDrawFrame('tiles', base[row + tx0 + x], x * TILE_PX, y * TILE_PX);
      }
      for (const o of buckets[cy * cols + cx]) rt.batchDrawFrame('tiles_edge', o.frame, (o.tx - tx0) * TILE_PX, (o.ty - ty0) * TILE_PX);
      rt.endDraw();
      chunks.push(rt);
    }
  }
  return {
    destroy() {
      for (const rt of chunks) rt.destroy();
      chunks.length = 0;
    },
  };
}
