// Pixel-perfect scaling maths (render lane; docs/QUALITY-PLAN.md §1). PURE: no Phaser, no DOM.
//
// The game renders into a LOW-RESOLUTION backbuffer measured in art pixels (camera zoom 1, so Phaser rounds every
// sprite to whole art pixels), and the browser upscales that canvas by an INTEGER number k of device pixels per art
// pixel with `image-rendering: pixelated`. k is chosen so the short screen side shows about 360–560 art px:
// phones (DPR 3) get k = 3, iPads (DPR 2) k = 3, a 1080p desktop k = 2.

/** The short side should show this many art px at least / at most (ART-DIRECTION §7). */
export const SHORT_SIDE_MIN = 360;
export const SHORT_SIDE_MAX = 560;
/** Inside the range, the k whose short side lands closest to this wins (more world on big screens). */
export const SHORT_SIDE_TARGET = 480;

export interface PixelScale {
  /** Device pixels per art pixel (integer ≥ 1). */
  k: number;
  /** Device pixel ratio the scale was computed for. */
  dpr: number;
  /** Backbuffer size in art px (= canvas.width / height). */
  artW: number;
  artH: number;
  /** CSS px per art px (k / dpr): the canvas' CSS size is art size × this. */
  cssPerArt: number;
  /** Canvas CSS size (≥ the viewport by less than `artStep` art px; the overflow is cropped at the right / bottom).
   *  Whole CSS px whenever the DPR is a simple fraction (2, 3, 2.625 = 21/8, 1.75, …). */
  cssW: number;
  cssH: number;
  /** The viewport (CSS px) the scale was computed for: the part of the canvas actually on screen. */
  viewW: number;
  viewH: number;
}

/** A k already in use is kept while its short side stays within this slack of the range (no zoom flip when a mobile
 *  address bar shows / hides or a window is dragged a little). */
const KEEP_MIN = SHORT_SIDE_MIN * 0.8;
const KEEP_MAX = SHORT_SIDE_MAX * 1.2;

/**
 * Integer k for a short side of `shortDevicePx` device px (or the forced one, clamped to 1..8). `keep` is the k in
 * use: it stays while its short side is within [KEEP_MIN, KEEP_MAX] art px, so the world does not jump between two
 * zoom levels when iOS Safari's bars show / hide in landscape (≈ 340 ↔ 390 CSS px tall at DPR 3).
 */
export function chooseK(shortDevicePx: number, forced?: number, keep?: number): number {
  if (forced && Number.isFinite(forced)) return Math.max(1, Math.min(8, Math.round(forced)));
  const s = Math.max(1, shortDevicePx);
  if (keep && Number.isInteger(keep) && keep >= 1 && keep <= 8 && s / keep >= KEEP_MIN && s / keep <= KEEP_MAX) return keep;
  let best = 1;
  let bestScore = Infinity;
  for (let k = 1; k <= 8; k++) {
    const art = s / k;
    // distance outside the range dominates; inside it, closeness to the target decides
    const out = art < SHORT_SIDE_MIN ? SHORT_SIDE_MIN - art : art > SHORT_SIDE_MAX ? art - SHORT_SIDE_MAX : 0;
    const score = out * 1000 + Math.abs(art - SHORT_SIDE_TARGET);
    if (score < bestScore - 1e-9) {
      bestScore = score;
      best = k;
    }
  }
  return best;
}

/** The backbuffer for a viewport of cssW × cssH CSS px at `dpr` (canvas = ceil(device px / k) art px, snapped to
 *  artStep so its CSS size is whole). `keepK`: the k in use (see chooseK). */
export function pixelScale(cssW: number, cssH: number, dpr: number, forcedK?: number, keepK?: number): PixelScale {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const devW = Math.max(1, Math.round(cssW * d));
  const devH = Math.max(1, Math.round(cssH * d));
  const k = chooseK(Math.min(devW, devH), forcedK, keepK);
  // Round the art size up so the canvas' CSS size is a whole number of CSS px: Chromium composites a canvas with a
  // fractional CSS size (e.g. 787 art px × 1.5 = 1180.5 px on an iPad, or any size at DPR 2.625) with a 1 device-px
  // seam in its right part, breaking the k×k pixel grid there.
  const step = artStep(k, d);
  const artW = Math.max(step, Math.ceil(devW / k / step) * step);
  const artH = Math.max(step, Math.ceil(devH / k / step) * step);
  const f = dprFraction(d);
  const css = (art: number) => {
    const v = f ? (art * k * f[1]) / f[0] : (art * k) / d;
    return Math.abs(v - Math.round(v)) < 1e-6 ? Math.round(v) : v;
  };
  return { k, dpr: d, artW, artH, cssPerArt: k / d, cssW: css(artW), cssH: css(artH), viewW: cssW, viewH: cssH };
}

const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);

/**
 * Art px the canvas size snaps to so art × k / dpr is a whole CSS px. The DPR is read as a fraction p / q with a small
 * q (2 = 2/1, 2.625 = 21/8, 1.75 = 7/4, 1.1 = 11/10); the art size must then be a multiple of p / gcd(k·q, p).
 * 1 when the DPR is no such fraction or the step would crop too much (nothing to snap).
 */
export function artStep(k: number, dpr: number): number {
  const f = dprFraction(dpr);
  if (!f) return 1;
  const step = f[0] / gcd(k * f[1], f[0]);
  return step <= 32 ? step : 1;
}

/** The DPR as [p, q] with p / q = dpr and q ≤ 64 (browsers report 110 % zoom as 1.100000023841858), or null. */
export function dprFraction(dpr: number): [number, number] | null {
  if (!(dpr > 0) || !Number.isFinite(dpr)) return null;
  for (let q = 1; q <= 64; q++) {
    const p = Math.round(dpr * q);
    if (p >= 1 && Math.abs(p / q - dpr) <= 1e-6) return [p, q];
  }
  return null;
}

/** CSS px → art px (HUD insets, DOM rects) for a scale. */
export function cssToArt(cssPx: number, s: Pick<PixelScale, 'cssPerArt'>): number {
  return cssPx / s.cssPerArt;
}

/**
 * Camera scroll for a view of `viewW` art px centred on `centre`, clamped to [min, max] scroll and rounded to a
 * whole art pixel. A map narrower than the view is centred (min > max collapses to their midpoint).
 */
export function clampScroll(centre: number, viewW: number, min: number, max: number): number {
  const want = centre - viewW / 2;
  const s = max < min ? (min + max) / 2 : Math.min(max, Math.max(min, want));
  return Math.round(s);
}
