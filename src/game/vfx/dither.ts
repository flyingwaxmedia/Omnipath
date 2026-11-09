// Ordered dithering, hash dissolve and crescent erosion (docs/VFX.md §2 P5, §4). Phaser-free and deterministic.
//
// Fades in Omnipath VFX never tween alpha: a pixel is either drawn opaque or skipped. Coverage `a` keeps a pixel
// when a > (BAYER4[y][x] + 0.5) / 16, so a = 0.5 is a checkerboard, a = 0.25 every other pixel of every other row.

/** Bayer (1973) 4x4 threshold matrix, row-major. */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Threshold in (0, 1) for pixel (x, y) with a per-effect origin offset (bx, by) (avoids moiré between effects). */
export function bayerT(x: number, y: number, bx = 0, by = 0): number {
  return (BAYER4[((y + by) & 3) * 4 + ((x + bx) & 3)] + 0.5) / 16;
}

/** Ordered coverage test: true when coverage `a` keeps pixel (x, y). */
export function covered(x: number, y: number, a: number, bx = 0, by = 0): boolean {
  if (a >= 1) return true;
  if (a <= 0) return false;
  return a > bayerT(x, y, bx, by);
}

/** Integer hash of (x, y, seed) -> [0, 1). Organic dissolve for debris and smoke edges. */
export function hash01(x: number, y: number, seed: number): number {
  let h = (Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1) ^ seed) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}

export type ErodeMode = 'bayer' | 'hash';

/**
 * Remove pixels by `progress` (0 keeps all, 1 removes all) in body and glow together. `bias(x, y)` adds to the
 * progress per pixel (directional dissolve: progress + (1 - u) * 0.4 makes tails dissolve first).
 */
export function erode(
  body: Uint8Array,
  glow: Uint8Array,
  w: number,
  h: number,
  progress: number,
  mode: ErodeMode,
  seed: number,
  bx = 0,
  by = 0,
  bias?: (x: number, y: number) => number,
): void {
  if (progress <= 0 && !bias) return;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const k = y * w + x;
      if (!body[k] && !glow[k]) continue;
      const p = progress + (bias ? bias(x, y) : 0);
      if (p <= 0) continue;
      const t = mode === 'bayer' ? bayerT(x, y, bx, by) : hash01(x, y, seed);
      if (p >= t) {
        body[k] = 0;
        glow[k] = 0;
      }
    }
  }
}

/**
 * Crescent erosion (Saint11 smoke dissolve): the eraser disc for step k of n of a puff at (cx, cy) with radius r.
 * Its radius grows r(0.5 + 0.5k/n) while its centre travels from the far edge toward the light (lx, ly), so the puff
 * goes disc -> crescent -> arc -> a few pixels.
 */
export function crescentEraser(
  cx: number,
  cy: number,
  r: number,
  k: number,
  n: number,
  lx = -0.6,
  ly = -0.8,
): { x: number; y: number; r: number } {
  const t = Math.min(1, Math.max(0, k / n));
  const len = Math.hypot(lx, ly) || 1;
  const off = r * (1.25 - 0.95 * t);
  return { x: cx - (lx / len) * off, y: cy - (ly / len) * off, r: r * (0.5 + 0.5 * t) + 0.5 };
}
