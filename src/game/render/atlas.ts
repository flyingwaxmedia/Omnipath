// The stage atlas (performance; docs/SPEC-v4.md §11.2). A map's props and dressing are dozens of small textures
// drawn interleaved by depth: with more of them on screen than the GPU has texture units (16 on an iPad) the sprite
// batch is flushed again and again. packAtlas() copies the textures one map uses into ONE canvas texture with a frame
// per key, so everything static on the stage shares a texture unit. The source textures stay as they are (the shadow
// baker, previews and tests read them by key); nothing about the look changes — same pixels, same sizes.
import type Phaser from 'phaser';

/** Key of the one stage atlas (rebuilt for each map; the previous map's images are gone by then). */
export const STAGE_ATLAS = 'stage_atlas';
/** Transparent gap between packed frames (px): no bleeding when a sprite is mirrored. */
const PAD = 1;
/** Widest atlas (px): well under every device's limit. */
const MAX_W = 2048;
const MAX_H = 4096;

export interface PackedRect {
  key: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Shelf packing, tallest first (pure): places every rectangle with PAD around it inside a `maxW`-wide sheet. Returns
 * the placements and the sheet size, or null when one rectangle is wider than the sheet.
 */
export function shelfPack(items: readonly { key: string; w: number; h: number }[], maxW = MAX_W): { rects: PackedRect[]; w: number; h: number } | null {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w || (a.key < b.key ? -1 : 1));
  const rects: PackedRect[] = [];
  let x = PAD;
  let y = PAD;
  let shelf = 0;
  let w = 0;
  for (const it of sorted) {
    if (it.w + 2 * PAD > maxW) return null;
    if (x + it.w + PAD > maxW) {
      x = PAD;
      y += shelf + PAD;
      shelf = 0;
    }
    rects.push({ key: it.key, x, y, w: it.w, h: it.h });
    x += it.w + PAD;
    w = Math.max(w, x);
    shelf = Math.max(shelf, it.h);
  }
  return { rects, w: Math.max(1, w), h: Math.max(1, y + shelf + PAD) };
}

/**
 * Builds the stage atlas from the textures named by `keys` (unknown keys are skipped) and returns the keys it holds:
 * show one with `scene.add.image(x, y, STAGE_ATLAS, key)`. Returns an empty set — and the caller keeps using the
 * separate textures — when there is nothing to pack, no canvas to pack into (tests, a headless scene) or the sheet
 * would be too big.
 */
export function packAtlas(scene: Phaser.Scene, keys: Iterable<string>): ReadonlySet<string> {
  const none: ReadonlySet<string> = new Set();
  const tm = scene.textures as Phaser.Textures.TextureManager | undefined;
  if (!tm || typeof tm.createCanvas !== 'function' || typeof document === 'undefined') return none;
  try {
    const items: { key: string; w: number; h: number; img: CanvasImageSource; sx: number; sy: number }[] = [];
    for (const key of new Set(keys)) {
      if (!tm.exists(key)) continue;
      const f = tm.get(key).get();
      const img = f?.source?.image as CanvasImageSource | undefined;
      if (!f || !img || f.cutWidth < 1 || f.cutHeight < 1) continue;
      items.push({ key, w: f.cutWidth, h: f.cutHeight, img, sx: f.cutX, sy: f.cutY });
    }
    if (items.length < 2) return none;
    const packed = shelfPack(items);
    if (!packed || packed.h > MAX_H) return none;
    if (tm.exists(STAGE_ATLAS)) tm.remove(STAGE_ATLAS);
    const tex = tm.createCanvas(STAGE_ATLAS, packed.w, packed.h);
    if (!tex) return none;
    const ctx = tex.getContext();
    const byKey = new Map(items.map((it) => [it.key, it]));
    const held = new Set<string>();
    for (const r of packed.rects) {
      const it = byKey.get(r.key)!;
      ctx.drawImage(it.img, it.sx, it.sy, r.w, r.h, r.x, r.y, r.w, r.h);
      tex.add(r.key, 0, r.x, r.y, r.w, r.h);
      held.add(r.key);
    }
    tex.refresh();
    return held;
  } catch (e) {
    console.warn('[omnipath] stage atlas skipped:', e);
    return none;
  }
}
