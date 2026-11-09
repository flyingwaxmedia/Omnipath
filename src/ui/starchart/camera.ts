// Star Chart camera maths (starchart lane). PURE: sky px ↔ screen px, zoom about a point, fitting a box into the
// visible part of the canvas, clamping, culling and star picking — unit-tested in tests/starchart-layout.test.ts.
// Screen px are CSS px of the canvas (the renderer multiplies by devicePixelRatio itself).

/** Sky point at the canvas centre and zoom (screen px per sky px). */
export interface Camera {
  x: number;
  y: number;
  z: number;
}

/** Canvas size in CSS px. */
export interface ViewSize {
  w: number;
  h: number;
}

/** CSS px of the canvas covered by overlays (chips on top, the card at the bottom or right). */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export const ZOOM_MIN = 0.5;
export const ZOOM_MAX = 2.5;
/** Smallest tap target around a star (CSS px radius: a 44 px touch target). */
export const TAP_RADIUS = 22;

export const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

export function clampZoom(z: number): number {
  return Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Number.isFinite(z) ? z : 1));
}

export function toScreen(cam: Camera, view: ViewSize, x: number, y: number): { x: number; y: number } {
  return { x: (x - cam.x) * cam.z + view.w / 2, y: (y - cam.y) * cam.z + view.h / 2 };
}

export function toSky(cam: Camera, view: ViewSize, sx: number, sy: number): { x: number; y: number } {
  return { x: (sx - view.w / 2) / cam.z + cam.x, y: (sy - view.h / 2) / cam.z + cam.y };
}

/** Zooms by `factor` keeping the sky point under (sx, sy) where it is (wheel, pinch, double tap). */
export function zoomAt(cam: Camera, view: ViewSize, factor: number, sx: number, sy: number): Camera {
  const z = clampZoom(cam.z * factor);
  const p = toSky(cam, view, sx, sy);
  return { x: p.x - (sx - view.w / 2) / z, y: p.y - (sy - view.h / 2) / z, z };
}

/** Keeps the camera centre inside the sky's bounds. */
export function clampCam(cam: Camera, bounds: Box): Camera {
  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, cam.x)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, cam.y)),
    z: clampZoom(cam.z),
  };
}

/** Camera that shows sky point `p` at the centre of the visible area (the canvas minus `insets`) at zoom `z`. */
export function centreOn(p: { x: number; y: number }, z: number, view: ViewSize, insets: Insets = NO_INSETS): Camera {
  const zz = clampZoom(z);
  const cx = (insets.left + view.w - insets.right) / 2;
  const cy = (insets.top + view.h - insets.bottom) / 2;
  return { x: p.x - (cx - view.w / 2) / zz, y: p.y - (cy - view.h / 2) / zz, z: zz };
}

/** Camera that fits `box` (plus `pad` screen px) into the visible area, zoom clamped to 0.5–2.5 (and ≤ `maxZ`). */
export function fitBox(box: Box, view: ViewSize, insets: Insets = NO_INSETS, pad = 24, maxZ = 1.4): Camera {
  const vw = Math.max(40, view.w - insets.left - insets.right - pad * 2);
  const vh = Math.max(40, view.h - insets.top - insets.bottom - pad * 2);
  const bw = Math.max(1, box.maxX - box.minX);
  const bh = Math.max(1, box.maxY - box.minY);
  const z = clampZoom(Math.min(maxZ, vw / bw, vh / bh));
  return centreOn({ x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 }, z, view, insets);
}

/** The sky box the canvas shows, grown by `pad` screen px (culling: draw only what is in it). */
export function visibleBox(cam: Camera, view: ViewSize, pad = 48): Box {
  const a = toSky(cam, view, -pad, -pad);
  const b = toSky(cam, view, view.w + pad, view.h + pad);
  return { minX: a.x, minY: a.y, maxX: b.x, maxY: b.y };
}

export function inBox(b: Box, x: number, y: number, r = 0): boolean {
  return x + r >= b.minX && x - r <= b.maxX && y + r >= b.minY && y - r <= b.maxY;
}

/** Whether the segment a–b may cross the box (cheap bounding-box test, enough for culling lines). */
export function segmentInBox(b: Box, ax: number, ay: number, bx: number, by: number): boolean {
  return Math.max(ax, bx) >= b.minX && Math.min(ax, bx) <= b.maxX && Math.max(ay, by) >= b.minY && Math.min(ay, by) <= b.maxY;
}

/** On-screen radius of a star: shrinks slower than the sky when zooming out, never below a visible dot. */
export function starScreenRadius(r: number, z: number): number {
  return Math.max(2.2, r * Math.pow(z, 0.75));
}

/**
 * The star under a tap: the nearest one whose drawn disc (or the 44 px touch target around it) holds the point.
 * Returns null when the tap hit empty sky.
 */
export function pickStar(
  stars: Iterable<{ id: string; x: number; y: number; r: number }>,
  cam: Camera,
  view: ViewSize,
  sx: number,
  sy: number,
  minRadius = TAP_RADIUS,
): string | null {
  let best: string | null = null;
  let bestD = Infinity;
  for (const s of stars) {
    const p = toScreen(cam, view, s.x, s.y);
    const d = Math.hypot(p.x - sx, p.y - sy);
    const reach = Math.max(minRadius, starScreenRadius(s.r, cam.z) + 8);
    if (d <= reach && d < bestD) {
      best = s.id;
      bestD = d;
    }
  }
  return best;
}

/** Smooth step for camera flights. */
export function easeInOut(t: number): number {
  const k = Math.max(0, Math.min(1, t));
  return k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
}

/** Camera between `a` and `b` at `t` (0..1): position linear, zoom geometric (feels even when zooming). */
export function lerpCam(a: Camera, b: Camera, t: number): Camera {
  const k = easeInOut(t);
  return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, z: a.z * Math.pow(b.z / a.z, k) };
}
