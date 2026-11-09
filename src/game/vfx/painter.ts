// Index-map painter for VFX templates (docs/VFX.md §4). Phaser-free, DOM-free, deterministic.
//
// Technique credits (techniques only, no code or pixels ported; docs/VFX.md §12):
// - Sprite Fusion pixel-art VFX (spritefusion.com/pixel-art-vfx, (c) Hugo Duprez, MIT) and its derivative
//   patch-gg/pixelfx ((c) Patch, MIT): separate colour and light buffers, limited ramps, dithering instead of blur,
//   Bayer-threshold put(), quantised field ramps.
// - Pedro Medeiros (Saint11) pixel-art tutorials (CC BY 4.0): contrast frames, held key frames, crescent smoke
//   dissolve, orphan pixels allowed only in the last frames.
// - B. E. Bayer (1973) ordered dithering.
//
// Model: a frame is two w*h buffers, `body` (PixelIndex, coloured later through a ramp LUT) and `glow` (levels 0..3).
// Shapes are written in a *local* space whose origin is the anchor (ox, oy) and whose +x axis points along the
// painter's heading. Area shapes are scanned in frame space and every pixel centre is inverse-mapped into local space
// before the shape test, so pre-baked headings never need ctx.rotate or anti-aliased paths. Points and lines are
// forward-mapped and rounded.
import { IDX, type IndexFrame } from './types';
import { bayerT, erode as erodeBuffers, type ErodeMode } from './dither';
import { dilateGlow, glowDisc } from './glow';

/** How a frame is used by reduce-flash and the flash budget. 'hero' frames may contain WHITE. */
export type FrameKind = 'normal' | 'hero' | 'contrast' | 'blank';

/** An IndexFrame with its declared kind (P-internal; the bake reads it for flash accounting). */
export interface PFrame extends IndexFrame {
  kind: FrameKind;
}

/** Ink callback for area shapes: return a PixelIndex, 0 to skip, or ERASE to clear the pixel. */
export type InkFn = (lx: number, ly: number, fx: number, fy: number) => number;
export type Ink = number | InkFn;
/** Ink value that clears a pixel (body and glow). */
export const ERASE = 255;

/** Pixel-centre slack for discs: d <= r + 0.35 gives round pixel circles without cardinal nubs. */
const EPS = 0.35;
const TAU = Math.PI * 2;

/** Brightness rank for max-wins inking (bolts): S ramp < R0..R5 < ACCENT < WHITE; outline lowest. */
export function rank(i: number): number {
  if (i === 0) return 0;
  if (i >= IDX.R0 && i <= IDX.R5) return i;
  if (i === IDX.WHITE) return 7;
  if (i === IDX.ACCENT) return 5.5;
  if (i >= IDX.S0 && i <= IDX.S3) return 1 + (i - IDX.S0) * 0.25;
  return 0.5;
}

/** One ramp step brighter (+1) or darker (-1), staying inside the main or secondary ramp. */
export function step(i: number, d: number): number {
  if (i >= IDX.R0 && i <= IDX.R5) return Math.max(IDX.R0, Math.min(IDX.R5, i + d));
  if (i >= IDX.S0 && i <= IDX.S3) return Math.max(IDX.S0, Math.min(IDX.S3, i + d));
  if (i === IDX.WHITE && d < 0) return IDX.R5;
  return i;
}

/** Is `deg` (screen degrees) inside the arc [from, to] going clockwise on screen (increasing angle)? */
export function inArc(deg: number, from: number, to: number): boolean {
  if (to - from >= 360 || from - to >= 360) return true;
  const span = (((to - from) % 360) + 360) % 360;
  const rel = (((deg - from) % 360) + 360) % 360;
  return rel <= span;
}

export class Painter {
  readonly body: Uint8Array;
  readonly glow: Uint8Array;
  private c = 1;
  private s = 0;

  constructor(
    readonly w: number,
    readonly h: number,
    readonly ox: number,
    readonly oy: number,
    /** Bayer origin offset (from the seed) so overlapping effects do not moiré. */
    readonly bx = 0,
    readonly by = 0,
    /** Existing buffers to paint into (whole-frame passes over a finished frame). */
    buffers?: { body: Uint8Array; glow: Uint8Array },
  ) {
    this.body = buffers?.body ?? new Uint8Array(w * h);
    this.glow = buffers?.glow ?? new Uint8Array(w * h);
  }

  // ---------------------------------------------------------------- mapping

  /** Local +x points along `rad` (screen radians: 0 east, +PI/2 south). */
  heading(rad: number): this {
    let c = Math.cos(rad);
    let s = Math.sin(rad);
    if (Math.abs(c) < 1e-12) c = 0;
    if (Math.abs(s) < 1e-12) s = 0;
    this.c = c;
    this.s = s;
    return this;
  }

  /** Current heading (radians). */
  get angle(): number {
    return Math.atan2(this.s, this.c);
  }

  /** Frame x of a local point. */
  X(lx: number, ly: number): number {
    return this.ox + Math.round(lx * this.c - ly * this.s);
  }

  /** Frame y of a local point. */
  Y(lx: number, ly: number): number {
    return this.oy + Math.round(lx * this.s + ly * this.c);
  }

  // ---------------------------------------------------------------- pixels (frame space)

  inside(fx: number, fy: number): boolean {
    return fx >= 0 && fy >= 0 && fx < this.w && fy < this.h;
  }

  get(fx: number, fy: number): number {
    return this.inside(fx, fy) ? this.body[fy * this.w + fx] : 0;
  }

  set(fx: number, fy: number, i: number): void {
    if (!this.inside(fx, fy)) return;
    const k = fy * this.w + fx;
    if (i === ERASE) {
      this.body[k] = 0;
      this.glow[k] = 0;
    } else this.body[k] = i;
  }

  /** Ordered coverage at a frame pixel. */
  pass(fx: number, fy: number, a: number): boolean {
    if (a >= 1) return true;
    if (a <= 0) return false;
    return a > bayerT(fx, fy, this.bx, this.by);
  }

  /** put(x, y, i, a): skips the pixel when a <= the Bayer threshold (docs/VFX.md §4). */
  put(fx: number, fy: number, i: number, a = 1): void {
    if (i && this.pass(fx, fy, a)) this.set(fx, fy, i);
  }

  /** Max-wins put by brightness rank (bolts, overlapping strokes). */
  putMax(fx: number, fy: number, i: number, a = 1): void {
    if (!i || !this.inside(fx, fy) || !this.pass(fx, fy, a)) return;
    const k = fy * this.w + fx;
    if (rank(i) > rank(this.body[k])) this.body[k] = i;
  }

  /** Put only where the pixel is clear. */
  under(fx: number, fy: number, i: number, a = 1): void {
    if (this.inside(fx, fy) && !this.body[fy * this.w + fx]) this.put(fx, fy, i, a);
  }

  // ---------------------------------------------------------------- points and lines (forward-mapped)

  /** A local point. */
  dot(lx: number, ly: number, i: number, a = 1): void {
    this.put(this.X(lx, ly), this.Y(lx, ly), i, a);
  }

  /** Bresenham line between two local points; `i` may vary along t in [0, 1]. */
  line(x0: number, y0: number, x1: number, y1: number, i: number | ((t: number) => number), a = 1, max = false): void {
    let ax = this.X(x0, y0),
      ay = this.Y(x0, y0);
    const bx = this.X(x1, y1),
      by = this.Y(x1, y1);
    const dx = Math.abs(bx - ax),
      dy = -Math.abs(by - ay);
    const sx = ax < bx ? 1 : -1,
      sy = ay < by ? 1 : -1;
    const n = Math.max(dx, -dy);
    let err = dx + dy;
    for (let k = 0; ; k++) {
      const ink = typeof i === 'number' ? i : i(n ? k / n : 0);
      if (max) this.putMax(ax, ay, ink, a);
      else this.put(ax, ay, ink, a);
      if (ax === bx && ay === by) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        ax += sx;
      }
      if (e2 <= dx) {
        err += dx;
        ay += sy;
      }
    }
  }

  /** Polyline through flat local points [x0, y0, x1, y1, ...]. */
  polyline(pts: readonly number[], i: number | ((t: number) => number), a = 1, max = false): void {
    const segs = pts.length / 2 - 1;
    for (let k = 0; k < segs; k++) {
      const ink = typeof i === 'number' ? i : (t: number) => i((k + t) / segs);
      this.line(pts[k * 2], pts[k * 2 + 1], pts[k * 2 + 2], pts[k * 2 + 3], ink, a, max);
    }
  }

  /** A small frame-space disc brush around a mapped local point. */
  stamp(lx: number, ly: number, r: number, i: number, a = 1, max = false): void {
    const cx = this.X(lx, ly),
      cy = this.Y(lx, ly);
    const R = Math.ceil(r);
    const rr = (r + EPS) * (r + EPS);
    for (let y = -R; y <= R; y++)
      for (let x = -R; x <= R; x++) {
        if (x * x + y * y > rr) continue;
        if (max) this.putMax(cx + x, cy + y, i, a);
        else this.put(cx + x, cy + y, i, a);
      }
  }

  /** Upright bitmask ('#' = on) centred on a mapped local point. */
  bits(lx: number, ly: number, rows: readonly string[], i: number, a = 1): void {
    const gh = rows.length,
      gw = rows[0]?.length ?? 0;
    const x0 = this.X(lx, ly) - (gw >> 1),
      y0 = this.Y(lx, ly) - (gh >> 1);
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) if (rows[y][x] === '#') this.put(x0 + x, y0 + y, i, a);
  }

  // ---------------------------------------------------------------- area shapes (inverse-mapped)

  /** Scan the frame pixels covering the local box and ink each by its inverse-mapped local centre. */
  fill(x0: number, y0: number, x1: number, y1: number, ink: InkFn, a = 1): void {
    const { c, s, ox, oy, w, h } = this;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [lx, ly] of [
      [x0, y0],
      [x1, y0],
      [x0, y1],
      [x1, y1],
    ]) {
      const fx = lx * c - ly * s,
        fy = lx * s + ly * c;
      if (fx < minX) minX = fx;
      if (fx > maxX) maxX = fx;
      if (fy < minY) minY = fy;
      if (fy > maxY) maxY = fy;
    }
    const X0 = Math.max(0, Math.floor(ox + minX) - 1),
      X1 = Math.min(w - 1, Math.ceil(ox + maxX) + 1);
    const Y0 = Math.max(0, Math.floor(oy + minY) - 1),
      Y1 = Math.min(h - 1, Math.ceil(oy + maxY) + 1);
    for (let fy = Y0; fy <= Y1; fy++) {
      const dy = fy - oy;
      for (let fx = X0; fx <= X1; fx++) {
        const dx = fx - ox;
        const lx = dx * c + dy * s,
          ly = -dx * s + dy * c;
        const i = ink(lx, ly, fx, fy);
        if (!i) continue;
        if (i === ERASE) this.set(fx, fy, ERASE);
        else this.put(fx, fy, i, a);
      }
    }
  }

  /** Span disc (d <= r + 0.35). */
  disc(cx: number, cy: number, r: number, ink: Ink, a = 1): void {
    if (r < 0) return;
    const rr = (r + EPS) * (r + EPS);
    this.fill(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (lx, ly, fx, fy) => {
      const dx = lx - cx,
        dy = ly - cy;
      if (dx * dx + dy * dy > rr) return 0;
      return typeof ink === 'number' ? ink : ink(lx, ly, fx, fy);
    }, a);
  }

  /** Axis-aligned (local) ellipse. */
  ellipse(cx: number, cy: number, rx: number, ry: number, ink: Ink, a = 1): void {
    const ex = rx + EPS,
      ey = ry + EPS;
    this.fill(cx - rx - 1, cy - ry - 1, cx + rx + 1, cy + ry + 1, (lx, ly, fx, fy) => {
      const dx = (lx - cx) / ex,
        dy = (ly - cy) / ey;
      if (dx * dx + dy * dy > 1) return 0;
      return typeof ink === 'number' ? ink : ink(lx, ly, fx, fy);
    }, a);
  }

  /**
   * Ellipse band of constant pixel thickness `bw` just inside the rim (rings, rims, bands). `ink` gets the depth row
   * q (0 = outermost pixel row) and the screen angle in degrees. `arc` restricts to [from, to] degrees on screen.
   */
  band(
    cx: number,
    cy: number,
    rx: number,
    ry: number,
    bw: number,
    ink: number | ((q: number, deg: number, fx: number, fy: number) => number),
    a = 1,
    arc?: readonly [number, number],
    /** Per-angle radius offset in px (jagged rims). */
    roff?: (deg: number) => number,
  ): void {
    if (rx <= 0 || ry <= 0 || bw <= 0) return;
    const pad = roff ? 2 : 1;
    this.fill(cx - rx - pad, cy - ry - pad, cx + rx + pad, cy + ry + pad, (lx, ly, fx, fy) => {
      const dx = lx - cx,
        dy = ly - cy;
      const deg = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (arc && !inArc(deg, arc[0], arc[1])) return 0;
      const o = roff ? roff(deg) : 0;
      const ex = rx + o + EPS,
        ey = ry + o * (ry / rx) + EPS;
      const ex2 = ex * ex,
        ey2 = ey * ey;
      const F = (dx * dx) / ex2 + (dy * dy) / ey2 - 1;
      if (F > 0.0001) return 0;
      const g = 2 * Math.sqrt((dx * dx) / (ex2 * ex2) + (dy * dy) / (ey2 * ey2));
      if (g < 1e-9) return 0;
      const depth = -F / g;
      if (depth >= bw) return 0;
      return typeof ink === 'number' ? ink : ink(Math.floor(depth), deg, fx, fy);
    }, a);
  }

  /** Circular ring of width bw (outer radius r). */
  ring(cx: number, cy: number, r: number, bw: number, ink: number | ((q: number, deg: number, fx: number, fy: number) => number), a = 1): void {
    this.band(cx, cy, r, r, bw, ink, a);
  }

  /**
   * Arc band (smears): pixels between R - w(u) and R, for angles a0 -> a1 (local radians, either sense). `ink` gets
   * u (0 at a0, 1 at a1), the depth in px from the outer edge, and w(u).
   */
  arcBand(
    cx: number,
    cy: number,
    R: number,
    a0: number,
    a1: number,
    wFn: (u: number) => number,
    ink: (u: number, depth: number, w: number, fx: number, fy: number) => number,
    a = 1,
  ): void {
    const span = a1 - a0;
    if (Math.abs(span) < 1e-6 || R <= 0) return;
    let wMax = 0;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let k = 0; k <= 32; k++) {
      const u = k / 32;
      wMax = Math.max(wMax, wFn(u));
    }
    for (let k = 0; k <= 32; k++) {
      const th = a0 + (span * k) / 32;
      for (const rr of [R + 1, Math.max(0, R - wMax - 1)]) {
        const x = cx + Math.cos(th) * rr,
          y = cy + Math.sin(th) * rr;
        minX = Math.min(minX, x);
        maxX = Math.max(maxX, x);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
      }
    }
    const outer = R + EPS;
    const inner = R - wMax - 1;
    this.fill(minX, minY, maxX, maxY, (lx, ly, fx, fy) => {
      const dx = lx - cx,
        dy = ly - cy;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d > outer || d < inner) return 0;
      let rel = Math.atan2(dy, dx) - a0;
      if (span > 0) rel = ((rel % TAU) + TAU) % TAU;
      else rel = -((((-rel) % TAU) + TAU) % TAU);
      const u = rel / span;
      if (u < 0 || u > 1) return 0;
      const ww = wFn(u);
      if (ww <= 0) return 0;
      const depth = outer - d;
      if (depth >= ww) return 0;
      return ink(u, depth, ww, fx, fy);
    }, a);
  }

  /** Crescent: disc (cx, cy, r) minus disc (cx + ex, cy + ey, r2). */
  crescent(cx: number, cy: number, r: number, ex: number, ey: number, r2: number, ink: Ink, a = 1): void {
    const rr = (r + EPS) * (r + EPS);
    const r2r = (r2 + EPS) * (r2 + EPS);
    this.fill(cx - r - 1, cy - r - 1, cx + r + 1, cy + r + 1, (lx, ly, fx, fy) => {
      const dx = lx - cx,
        dy = ly - cy;
      if (dx * dx + dy * dy > rr) return 0;
      const ux = dx - ex,
        uy = dy - ey;
      if (ux * ux + uy * uy <= r2r) return 0;
      return typeof ink === 'number' ? ink : ink(lx, ly, fx, fy);
    }, a);
  }

  /** Polygon (even-odd) through flat local points. */
  poly(pts: readonly number[], ink: Ink, a = 1): void {
    const n = pts.length / 2;
    if (n < 3) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (let k = 0; k < n; k++) {
      minX = Math.min(minX, pts[k * 2]);
      maxX = Math.max(maxX, pts[k * 2]);
      minY = Math.min(minY, pts[k * 2 + 1]);
      maxY = Math.max(maxY, pts[k * 2 + 1]);
    }
    this.fill(minX, minY, maxX, maxY, (lx, ly, fx, fy) => {
      let inside = false;
      for (let k = 0, j = n - 1; k < n; j = k++) {
        const xi = pts[k * 2],
          yi = pts[k * 2 + 1],
          xj = pts[j * 2],
          yj = pts[j * 2 + 1];
        if (yi > ly !== yj > ly && lx < ((xj - xi) * (ly - yi)) / (yj - yi) + xi) inside = !inside;
      }
      if (!inside) return 0;
      return typeof ink === 'number' ? ink : ink(lx, ly, fx, fy);
    }, a);
  }

  /** Star polygon: n tips at r1, valleys at r0, first tip at `rot` (local radians). */
  star(cx: number, cy: number, n: number, r0: number, r1: number, rot: number, ink: Ink, a = 1): void {
    this.poly(starPts(cx, cy, n, r0, r1, rot), ink, a);
  }

  /**
   * Tapered stroke A -> B: full width wFn(t), optional bow (perpendicular bulge bow * sin(PI t)). `ink` gets t and
   * q in [0, 1] (0 on the centre line, 1 at the edge).
   */
  stroke(
    ax: number,
    ay: number,
    bx: number,
    by: number,
    wFn: (t: number) => number,
    ink: number | ((t: number, q: number, fx: number, fy: number) => number),
    bow = 0,
    a = 1,
  ): void {
    const vx = bx - ax,
      vy = by - ay;
    const L2 = vx * vx + vy * vy;
    if (L2 < 1e-6) return;
    const L = Math.sqrt(L2);
    let wM = 0;
    for (let k = 0; k <= 16; k++) wM = Math.max(wM, wFn(k / 16));
    const pad = wM / 2 + Math.abs(bow) + 1;
    this.fill(Math.min(ax, bx) - pad, Math.min(ay, by) - pad, Math.max(ax, bx) + pad, Math.max(ay, by) + pad, (lx, ly, fx, fy) => {
      const px = lx - ax,
        py = ly - ay;
      const t = (px * vx + py * vy) / L2;
      if (t < 0 || t > 1) return 0;
      const n = (px * vy - py * vx) / L;
      const half = wFn(t) / 2;
      if (half <= 0) return 0;
      const dd = Math.abs(n - bow * Math.sin(Math.PI * t));
      if (dd > half + 0.15) return 0;
      return typeof ink === 'number' ? ink : ink(t, Math.min(1, dd / Math.max(half, 0.5)), fx, fy);
    }, a);
  }

  /**
   * Metaball field (each ball adds 0.18 r^2 / d^2, so a lone ball's edge sits at d = r) mapped to indices by `map`
   * (default: quantize()). Used for explosions, goo, gas and clouds.
   */
  metaballs(balls: readonly Ball[], map?: (v: number, fx: number, fy: number) => number, a = 1): void {
    if (!balls.length) return;
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const b of balls) {
      minX = Math.min(minX, b.x - b.r * 1.5);
      maxX = Math.max(maxX, b.x + b.r * 1.5);
      minY = Math.min(minY, b.y - b.r * 1.5);
      maxY = Math.max(maxY, b.y + b.r * 1.5);
    }
    const m = map ?? ((v: number, fx: number, fy: number) => quantize(v, this, fx, fy));
    this.fill(minX, minY, maxX, maxY, (lx, ly, fx, fy) => {
      let v = 0;
      for (const b of balls) {
        const dx = lx - b.x,
          dy = ly - b.y;
        v += (0.18 * b.r * b.r) / (dx * dx + dy * dy + 0.25);
      }
      return m(v, fx, fy);
    }, a);
  }

  // ---------------------------------------------------------------- glow

  /** Explicit glow disc at a local point (levels max -> 0). */
  glowAt(lx: number, ly: number, r: number, max: number): void {
    glowDisc(this.glow, this.w, this.h, this.X(lx, ly), this.Y(lx, ly), r, max);
  }

  /** Emissive dilation of the body into the glow buffer. */
  dilate(emissive: (i: number) => boolean): void {
    dilateGlow(this.body, this.glow, this.w, this.h, emissive);
  }

  // ---------------------------------------------------------------- whole-frame passes

  /** Remap every body index. */
  map(fn: (i: number, fx: number, fy: number) => number): void {
    const { w, h, body } = this;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (body[k]) body[k] = fn(body[k], x, y);
      }
  }

  /** Matter shading in screen space (light from the top-left): lit edge +1, shadow edge -1. */
  shade(): void {
    const { w, h, body } = this;
    const src = body.slice();
    const clear = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= w || y >= h) return true;
      const v = src[y * w + x];
      return v === 0 || v === IDX.OUTLINE;
    };
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        const v = src[k];
        if (!v || v === IDX.OUTLINE || v === IDX.WHITE || v === IDX.ACCENT) continue;
        if (clear(x, y - 1) || clear(x - 1, y)) body[k] = step(v, 1);
        else if (clear(x, y + 1) || clear(x + 1, y)) body[k] = step(v, -1);
      }
  }

  /** Write `idx` on transparent 4-neighbours of pixels passing `src` (matter outline #24180f by default). */
  outline(idx: number = IDX.OUTLINE, src: (i: number) => boolean = (i) => i !== 0 && i !== IDX.OUTLINE, a = 1): void {
    const { w, h, body } = this;
    const from = body.slice();
    const hit = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && src(from[y * w + x]);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (from[k]) continue;
        if (hit(x - 1, y) || hit(x + 1, y) || hit(x, y - 1) || hit(x, y + 1)) {
          if (this.pass(x, y, a)) body[k] = idx;
        }
      }
  }

  /** 50% Bayer keyline under energy pieces (light biomes, docs/VFX.md §3.5). */
  keyline(): void {
    this.outline(IDX.OUTLINE, (i) => i !== 0 && i !== IDX.OUTLINE, 0.5);
  }

  /** Remove lone pixels (no non-clear 8-neighbour): speckle never survives outside the last frames. */
  orphans(): number {
    const { w, h, body, glow } = this;
    const src = body.slice();
    let n = 0;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const k = y * w + x;
        if (!src[k]) continue;
        let alone = true;
        for (let dy = -1; dy <= 1 && alone; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            if (!dx && !dy) continue;
            const xx = x + dx,
              yy = y + dy;
            if (xx >= 0 && yy >= 0 && xx < w && yy < h && src[yy * w + xx]) {
              alone = false;
              break;
            }
          }
        if (alone) {
          body[k] = 0;
          glow[k] = 0;
          n++;
        }
      }
    return n;
  }

  /** Dissolve body + glow by progress (ordered or hashed), with an optional per-pixel bias. */
  erode(progress: number, mode: ErodeMode, seed: number, bias?: (fx: number, fy: number) => number): void {
    erodeBuffers(this.body, this.glow, this.w, this.h, progress, mode, seed, this.bx, this.by, bias);
  }

  count(i?: number): number {
    let n = 0;
    for (const v of this.body) if (i === undefined ? v !== 0 : v === i) n++;
    return n;
  }

  /** Hand the buffers over as a frame (the painter must not be used afterwards). */
  frame(ms: number, kind: FrameKind = 'normal'): PFrame {
    return { w: this.w, h: this.h, ox: this.ox, oy: this.oy, body: this.body, glow: this.glow, ms, kind };
  }
}

export interface Ball {
  x: number;
  y: number;
  r: number;
}

/**
 * quantize(field) (docs/VFX.md §4): < 0.18 clear · 0.18-0.28 R1 at 50 % Bayer · 0.28-0.45 R1 · 0.45-0.65 R2 ·
 * 0.65-0.85 R3 · 0.85-1.3 R4 · above R5. `shift` steps the result darker (cooling).
 */
export function quantize(v: number, p: Painter, fx: number, fy: number, shift = 0): number {
  let i: number;
  if (v < 0.18) return 0;
  if (v < 0.28) {
    if (!p.pass(fx, fy, 0.5)) return 0;
    i = IDX.R1;
  } else if (v < 0.45) i = IDX.R1;
  else if (v < 0.65) i = IDX.R2;
  else if (v < 0.85) i = IDX.R3;
  else if (v < 1.3) i = IDX.R4;
  else i = IDX.R5;
  return Math.max(IDX.R0, i - shift);
}

/** Flat points of a star polygon. */
export function starPts(cx: number, cy: number, n: number, r0: number, r1: number, rot: number): number[] {
  const pts: number[] = [];
  for (let k = 0; k < n * 2; k++) {
    const r = k % 2 === 0 ? r1 : r0;
    const a = rot + (k * Math.PI) / n;
    pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  return pts;
}

/** Count lone pixels (no non-clear 8-neighbour) in a frame buffer (QA helper). */
export function countOrphans(f: IndexFrame): number {
  const { w, h, body } = f;
  let n = 0;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!body[y * w + x]) continue;
      let alone = true;
      for (let dy = -1; dy <= 1 && alone; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const xx = x + dx,
            yy = y + dy;
          if (xx >= 0 && yy >= 0 && xx < w && yy < h && body[yy * w + xx]) {
            alone = false;
            break;
          }
        }
      if (alone) n++;
    }
  return n;
}

/** Midpoint-displaced polyline A -> B (flat points). off = jag * L, x0.52 per level, until segments are ~minSeg px. */
export function midpoint(ax: number, ay: number, bx: number, by: number, jag: number, rnd: () => number, minSeg = 3): number[] {
  let pts = [ax, ay, bx, by];
  const L = Math.hypot(bx - ax, by - ay);
  let off = jag * L;
  let seg = L;
  while (seg > minSeg) {
    const next: number[] = [pts[0], pts[1]];
    for (let k = 0; k < pts.length / 2 - 1; k++) {
      const x0 = pts[k * 2],
        y0 = pts[k * 2 + 1],
        x1 = pts[k * 2 + 2],
        y1 = pts[k * 2 + 3];
      const dx = x1 - x0,
        dy = y1 - y0;
      const len = Math.hypot(dx, dy) || 1;
      const d = (rnd() * 2 - 1) * off;
      next.push((x0 + x1) / 2 + (-dy / len) * d, (y0 + y1) / 2 + (dx / len) * d, x1, y1);
    }
    pts = next;
    off *= 0.52;
    seg /= 2;
  }
  return pts;
}
