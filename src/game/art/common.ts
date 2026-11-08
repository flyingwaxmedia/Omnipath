import type Phaser from 'phaser';

// Shared canvas helpers for the procedural art pipeline. Pure 2D-canvas code: every texture
// is drawn once at boot into a Phaser CanvasTexture, so the game ships with zero image assets.

export type Ctx = CanvasRenderingContext2D;
export type Draw = (c: Ctx) => void;

/** Largest side any generated canvas may have (mobile GPU texture limit with headroom). */
export const MAX_CANVAS = 2048;

/** Create `key` as a w x h canvas texture (no-op if the key already exists). */
export function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: Draw): void {
  if (scene.textures.exists(key)) return;
  if (w > MAX_CANVAS || h > MAX_CANVAS) throw new Error(`texture ${key} ${w}x${h} exceeds ${MAX_CANVAS}px`);
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

/** Same drawing under several keys (used for legacy aliases). */
export function canvasTexAll(scene: Phaser.Scene, keys: string[], w: number, h: number, draw: Draw): void {
  for (const k of keys) canvasTex(scene, k, w, h, draw);
}

/** Detached scratch canvas (not registered with Phaser). */
export function scratch(w: number, h: number): { el: HTMLCanvasElement; c: Ctx } {
  const el = document.createElement('canvas');
  el.width = w;
  el.height = h;
  const c = el.getContext('2d')!;
  c.imageSmoothingEnabled = false;
  return { el, c };
}

// ------------------------------------------------------------------ colour

export const hex = (n: number) => `#${(n & 0xffffff).toString(16).padStart(6, '0')}`;

function rgbOf(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

const clamp255 = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/** Add `amt` (-255..255) to every channel of a #rrggbb colour. */
export function shade(color: string, amt: number): string {
  const [r, g, b] = rgbOf(color);
  return hex((clamp255(r + amt) << 16) | (clamp255(g + amt) << 8) | clamp255(b + amt));
}

/** Linear blend of two #rrggbb colours (t = 0 -> a, 1 -> b). */
export function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = rgbOf(a);
  const [r2, g2, b2] = rgbOf(b);
  return hex((clamp255(r1 + (r2 - r1) * t) << 16) | (clamp255(g1 + (g2 - g1) * t) << 8) | clamp255(b1 + (b2 - b1) * t));
}

/** #rrggbb + alpha -> rgba() string. */
export function rgba(color: string, a: number): string {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r},${g},${b},${a})`;
}

// ------------------------------------------------------------------ primitives

export function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: string): void {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}

export function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), 0, 0, Math.PI * 2);
  c.fill();
}

/** Filled polygon from a flat [x0,y0,x1,y1,...] list. */
export function poly(c: Ctx, pts: readonly number[], fill: string): void {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

export function line(c: Ctx, pts: readonly number[], stroke: string, width = 1, cap: CanvasLineCap = 'round'): void {
  c.strokeStyle = stroke;
  c.lineWidth = width;
  c.lineCap = cap;
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}

export function speckle(c: Ctx, x: number, y: number, w: number, h: number, colors: string[], n: number, rnd: () => number, size = 2): void {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(rnd() * colors.length)];
    c.fillRect(x + Math.floor(rnd() * (w - size + 1)), y + Math.floor(rnd() * (h - size + 1)), size, size);
  }
}

/** Two-layer soft ground shadow (the house style under every standing thing). */
export function groundShadow(c: Ctx, x: number, y: number, rx: number, ry: number, alpha = 0.28): void {
  ellipse(c, x, y, rx + 2, ry + 1, `rgba(0,0,0,${alpha * 0.45})`);
  ellipse(c, x, y, rx, ry, `rgba(0,0,0,${alpha * 0.6})`);
  ellipse(c, x, y, rx * 0.65, ry * 0.65, `rgba(0,0,0,${alpha * 0.35})`);
}

/** Radial glow (additive-looking light blob). */
export function glow(c: Ctx, x: number, y: number, r: number, color: string, alpha = 0.6): void {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, alpha));
  g.addColorStop(0.45, rgba(color, alpha * 0.45));
  g.addColorStop(1, rgba(color, 0));
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
}

/** Vertical linear gradient fill of a rect. */
export function vgrad(c: Ctx, x: number, y: number, w: number, h: number, top: string, bottom: string): void {
  const g = c.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top);
  g.addColorStop(1, bottom);
  c.fillStyle = g;
  c.fillRect(x, y, w, h);
}

/** Cartoon eyes with a white catch-light. */
export function eyes(c: Ctx, x: number, y: number, gap: number, r = 2, color = '#1b1b2a'): void {
  ellipse(c, x - gap, y, r, r * 1.3, color);
  ellipse(c, x + gap, y, r, r * 1.3, color);
  c.fillStyle = '#fff';
  c.fillRect(Math.round(x - gap), Math.round(y - r), 1, 1);
  c.fillRect(Math.round(x + gap), Math.round(y - r), 1, 1);
}

/**
 * Draw `draw` with a 1px silhouette outline around everything it paints.
 * Only pixels with alpha >= `minAlpha` count as silhouette, so soft glows and haze drawn inside
 * stay un-outlined. Draw ground shadows directly on `c` BEFORE calling this.
 */
export function outlined(c: Ctx, w: number, h: number, color: string, draw: Draw, minAlpha = 110): void {
  const body = scratch(w, h);
  draw(body.c);
  const mask = scratch(w, h);
  const src = body.c.getImageData(0, 0, w, h).data;
  const md = mask.c.createImageData(w, h);
  for (let i = 3; i < src.length; i += 4) if (src[i] >= minAlpha) md.data[i] = 255;
  mask.c.putImageData(md, 0, 0);
  const edge = scratch(w, h);
  for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) edge.c.drawImage(mask.el, dx, dy);
  edge.c.globalCompositeOperation = 'source-in';
  edge.c.fillStyle = color;
  edge.c.fillRect(0, 0, w, h);
  c.drawImage(edge.el, 0, 0);
  c.drawImage(body.el, 0, 0);
}
