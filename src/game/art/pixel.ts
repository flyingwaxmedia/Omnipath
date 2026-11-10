// Shared pixel-art toolkit for the "Lush Pixel" art direction (docs/ART-DIRECTION.md).
// Everything draws on integer pixels with flat colours; `outline()` adds the 1 px dark rim every sprite needs.
import Phaser from 'phaser';

/**
 * The v4 material ramps (SPEC-v4 §11.2 H, docs/ART-DIRECTION.md §2): six steps each, HUE-SHIFTED — shadows lean cool
 * and violet, lights lean warm and yellow — with shared darks, so no material shades toward grey or black.
 */
export const RAMPS = {
  grass: ['#1f3b33', '#2f5435', '#47702f', '#6a8f36', '#93ab45', '#c4c765'],
  foliage: ['#17302f', '#23483a', '#32663a', '#4f8a3c', '#86ad45', '#c9cf6a'],
  dirt: ['#4a3340', '#6e4f48', '#94714f', '#b8955f', '#d9bd7c', '#efdc9e'],
  stone: ['#2b2a40', '#454660', '#69708a', '#959aa6', '#c2c2b4', '#e8e2c6'],
  wood: ['#2e1a26', '#4d2a2a', '#74432d', '#9c6534', '#c48e48', '#e3bb6c'],
  water: ['#1b2f5a', '#23508a', '#2f7fa8', '#4fb0b8', '#9adcc8', '#e4f6e0'],
  roofTerracotta: ['#4a1f33', '#7a2f33', '#a8472f', '#cf6b38', '#e89a52'],
  roofSlate: ['#232a4a', '#34466e', '#4d6c8f', '#7a9cab'],
  roofThatch: ['#5a4326', '#86682f', '#b3923f', '#d9bd5e'],
  roofVerdigris: ['#173b40', '#23605a', '#3a8a72', '#74b890'],
} as const;

/** Cast and contact shadows: this violet, multiplied at SHADOW_ALPHA — never black alpha (SPEC-v4 §11.2 A). */
export const SHADOW_COLOR = '#3a3560';
/** Outline of world props and buildings: the shared dark of the ramps, so the world sits back and actors
 *  (outlined in PAL.outline) pop. Sprites made of one material use the darkest step of that ramp instead. */
export const WORLD_OUTLINE = '#2b2a40';

/** Palette anchors (docs/ART-DIRECTION.md §2). Ramps run dark -> light; shorter cuts of RAMPS for older call sites. */
export const PAL = {
  outline: '#24180f',
  grass: ['#2f5435', '#47702f', '#6a8f36', '#93ab45', '#c4c765'],
  dirt: ['#94714f', '#b8955f', '#d9bd7c', '#efdc9e'],
  foliage: ['#23483a', '#32663a', '#4f8a3c', '#86ad45'],
  wood: ['#4d2a2a', '#74432d', '#9c6534', '#c48e48'],
  stone: ['#454660', '#69708a', '#959aa6', '#c2c2b4'],
  water: ['#23508a', '#2f7fa8', '#4fb0b8', '#9adcc8'],
  foam: '#e4f6e0',
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
