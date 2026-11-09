// Shared pixel-art toolkit for the "Lush Pixel" art direction (docs/ART-DIRECTION.md).
// Everything draws on integer pixels with flat colours; `outline()` adds the 1 px dark rim every sprite needs.
import Phaser from 'phaser';

/** Palette anchors (docs/ART-DIRECTION.md §2). Ramps run dark -> light. */
export const PAL = {
  outline: '#24180f',
  grass: ['#3f5a26', '#56772f', '#6c8f3a', '#86a64a', '#a2bd62'],
  dirt: ['#7a6446', '#96805c', '#ad9a74', '#c2b18a'],
  foliage: ['#2b4a22', '#3d6630', '#548540', '#74a655'],
  wood: ['#3d2817', '#5c3d22', '#7d5530', '#9c6d3e'],
  stone: ['#4a4d55', '#666a73', '#878b93', '#a9adb3'],
  water: ['#25507a', '#2f6fa3', '#4a92c4', '#8cc6e6'],
  foam: '#d8eef6',
  crimson: '#b8323a',
  rose: '#e0788a',
  cream: '#efe6c8',
  violet: '#8a6cc0',
  ui: {
    outline: '#24180f',
    wood: '#4a3220',
    bevel: '#7a5430',
    bronze: '#b0803a',
    gold: '#e9c46a',
    fill: 'rgba(28,20,14,0.92)',
    text: '#f2e6c9',
    muted: '#b9a98a',
  },
} as const;

export type Ctx = CanvasRenderingContext2D;

/** Creates (once) a canvas texture and runs the drawer on a pixel-snapped context. */
export function pixelTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void): void {
  if (scene.textures.exists(key)) return;
  if (w > 2048 || h > 2048) throw new Error(`texture ${key} too large: ${w}x${h}`);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const c = tex.getContext();
  c.imageSmoothingEnabled = false;
  draw(c);
  tex.refresh();
}

/** One pixel. */
export function px(c: Ctx, x: number, y: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), 1, 1);
}

/** Integer rectangle. */
export function rect(c: Ctx, x: number, y: number, w: number, h: number, color: string): void {
  c.fillStyle = color;
  c.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
}

/** Rasterized filled ellipse (no anti-aliasing). */
export function disc(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string): void {
  c.fillStyle = color;
  for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
    const dy = (y + 0.5 - cy) / ry;
    if (Math.abs(dy) > 1) continue;
    const half = rx * Math.sqrt(1 - dy * dy);
    const x0 = Math.round(cx - half);
    const x1 = Math.round(cx + half);
    if (x1 > x0) c.fillRect(x0, y, x1 - x0, 1);
  }
}

/** Pixel line (Bresenham). */
export function line(c: Ctx, x0: number, y0: number, x1: number, y1: number, color: string): void {
  c.fillStyle = color;
  let [x, y] = [Math.round(x0), Math.round(y0)];
  const [tx, ty] = [Math.round(x1), Math.round(y1)];
  const dx = Math.abs(tx - x);
  const dy = -Math.abs(ty - y);
  const sx = x < tx ? 1 : -1;
  const sy = y < ty ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    c.fillRect(x, y, 1, 1);
    if (x === tx && y === ty) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
  }
}

/**
 * Adds a 1 px outline around every opaque pixel (alpha >= threshold) inside the given region,
 * on transparent neighbours only (4-neighbourhood). Call after drawing a sprite's body.
 */
export function outline(c: Ctx, w: number, h: number, color: string = PAL.outline, threshold = 128): void {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const solid = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] >= threshold;
  const marks: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (solid(x, y)) continue;
      if (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1)) marks.push(x, y);
    }
  c.fillStyle = color;
  for (let i = 0; i < marks.length; i += 2) c.fillRect(marks[i], marks[i + 1], 1, 1);
}

/** Deterministic small RNG for art (mulberry32). */
export function artRng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Stable 32-bit hash of a string (seed per texture key). */
export function keySeed(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Lighten/darken a #rrggbb colour by `amt` (-255..255). */
export function shade(color: string, amt: number): string {
  const n = parseInt(color.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

/** Copies a canvas texture's pixels into a data URL (for DOM icons/frames). Cached by key. */
const urlCache = new Map<string, string>();
export function textureDataUrl(scene: Phaser.Scene, key: string): string {
  const hit = urlCache.get(key);
  if (hit) return hit;
  const tex = scene.textures.get(key);
  const src = tex?.getSourceImage() as HTMLCanvasElement | HTMLImageElement | undefined;
  if (!src) return '';
  let url = '';
  if (src instanceof HTMLCanvasElement) url = src.toDataURL('image/png');
  else {
    const cv = document.createElement('canvas');
    cv.width = src.width;
    cv.height = src.height;
    cv.getContext('2d')!.drawImage(src, 0, 0);
    url = cv.toDataURL('image/png');
  }
  urlCache.set(key, url);
  return url;
}
