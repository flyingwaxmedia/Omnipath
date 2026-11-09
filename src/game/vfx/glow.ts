// Glow without blur (docs/VFX.md §3.4, §4): a twin buffer of levels 0..3 the runtime shows white-tinted in the ADD
// layer. Levels come from explicit glow discs and from automatic dilation of emissive body indices.
import { GLOW_MAX } from './types';

/**
 * Emissive dilation: every pixel whose body index passes `emissive` gets level 3, its Chebyshev ring 1 level 2 and
 * ring 2 level 1 (max-wins with what is already there).
 */
export function dilateGlow(body: Uint8Array, glow: Uint8Array, w: number, h: number, emissive: (i: number) => boolean): void {
  // Distance field (Chebyshev, capped at 3) from emissive pixels, two separable max passes.
  const n = w * h;
  const lvl = new Uint8Array(n);
  let any = false;
  for (let k = 0; k < n; k++) {
    if (body[k] && emissive(body[k])) {
      lvl[k] = 3;
      any = true;
    }
  }
  if (!any) return;
  // Each pass spreads level - 1 to the 8 neighbours.
  for (let pass = 0; pass < 2; pass++) {
    const src = lvl.slice();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const v = src[y * w + x];
        if (v < 2) continue;
        const nv = v - 1;
        for (let dy = -1; dy <= 1; dy++) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx;
            if (xx < 0 || xx >= w) continue;
            const kk = yy * w + xx;
            if (lvl[kk] < nv) lvl[kk] = nv;
          }
        }
      }
    }
  }
  for (let k = 0; k < n; k++) if (lvl[k] > glow[k]) glow[k] = lvl[k];
}

/** A soft-looking but hard-edged glow disc: level = round(max * (1 - d/r)^2), never above GLOW_MAX. */
export function glowDisc(glow: Uint8Array, w: number, h: number, cx: number, cy: number, r: number, max: number): void {
  const x0 = Math.max(0, Math.floor(cx - r)),
    x1 = Math.min(w - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r)),
    y1 = Math.min(h - 1, Math.ceil(cy + r));
  const m = Math.min(GLOW_MAX, max);
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const d = Math.hypot(x - cx, y - cy);
      if (d > r) continue;
      const v = Math.round(m * (1 - d / r) ** 2);
      const k = y * w + x;
      if (v > glow[k]) glow[k] = v;
    }
  }
}

/** Silhouette rim (matter imbue): ring 1 around any body pixel -> level 2, ring 2 -> level 1. The body stays 0. */
export function glowRim(body: Uint8Array, glow: Uint8Array, w: number, h: number): void {
  const lvl = new Uint8Array(w * h);
  dilateGlow(body, lvl, w, h, (i) => i > 0);
  for (let k = 0; k < w * h; k++) {
    if (body[k]) continue;
    if (lvl[k] > glow[k]) glow[k] = lvl[k];
  }
}
