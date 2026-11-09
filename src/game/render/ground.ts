// Ground baker: renders a compiled map's terrain (base tiles + autotile edge pieces) ONCE into a few static
// RenderTexture chunks. Replaces the Phaser tilemap layer: same depth, nothing to update per frame.
import type Phaser from 'phaser';
import type { CompiledMap } from '../../core/world/types';
import { ensureEdgeFamilies } from '../art/tiles';
import { EDGE_VARIANTS, TILE_PX, computeTerrainLayers } from './autotile';
import { DEPTH } from './depths';

/** Chunk size in tiles (32 x 32 px = 1024 px, safely under mobile texture limits). */
export const GROUND_CHUNK_TILES = 32;
/** Same depth as the v2 tilemap layer: under every y-sorted sprite and ground decal. */
export const GROUND_DEPTH = DEPTH.GROUND;

export interface BakedGround {
  /** Destroys every chunk (and its GPU texture). */
  destroy(): void;
}

/**
 * Bakes the ground of `cm` into static RenderTexture chunks (<= 1024 x 1024 px each) at depth GROUND_DEPTH.
 * Requires the 'tiles', 'tiles_edge' and 'tiles_decal' textures (drawTiles from ../art/tiles). Deterministic per map.
 */
export function bakeGround(scene: Phaser.Scene, cm: CompiledMap): BakedGround {
  const { base, overlays, decals } = computeTerrainLayers(cm);
  // paint the edge families this map uses (first visit only)
  const fams = new Set<number>();
  for (const o of overlays) fams.add(Math.floor((o.frame >> 4) / EDGE_VARIANTS));
  ensureEdgeFamilies(scene, fams);
  const C = GROUND_CHUNK_TILES;
  const cols = Math.ceil(cm.w / C);
  const rows = Math.ceil(cm.h / C);

  // Bucket overlays and decals per chunk (they keep their relative order; decals never straddle a cell).
  const buckets: { tx: number; ty: number; frame: number }[][] = Array.from({ length: cols * rows }, () => []);
  for (const o of overlays) buckets[Math.floor(o.ty / C) * cols + Math.floor(o.tx / C)].push(o);
  const decalBuckets: { x: number; y: number; frame: number }[][] = Array.from({ length: cols * rows }, () => []);
  const CP = C * TILE_PX;
  for (const d of decals) decalBuckets[Math.floor(d.y / CP) * cols + Math.floor(d.x / CP)].push(d);

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
      for (const d of decalBuckets[cy * cols + cx]) rt.batchDrawFrame('tiles_decal', d.frame, d.x - tx0 * TILE_PX, d.y - ty0 * TILE_PX);
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
