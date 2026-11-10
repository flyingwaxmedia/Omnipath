import type Phaser from 'phaser';
import type { MonsterDef } from '../../core/types';
import { MONSTERS } from '../../data/monsters';
import { PAL, outline, pixelTex } from './pixel';

// =====================================================================================================
// Monster sprites — "Lush Pixel" pass (docs/ART-DIRECTION.md §1, §4).
//
// Every creature is painted pixel-by-pixel into an RGBA buffer (no anti-aliasing, no gradients), then the
// shared toolkit adds the 1 px dark outline. Shapes are filled from 3-5 tone hue-shifted ramps lit from the
// top-left; front parts get a 1 px "contact" edge where they overlap what is behind them so limbs, gear and
// faces read at phone size.
//
// Contract
// - `mon_<id>` = frame 0 (unchanged key, v2 size; a few species add 1-2 px of outline room via `pad`, kept
//   symmetric left/right so origin x 0.5 still centres them), `mon_<id>_1` = frame 1 (same size as frame 0).
// - Creatures face RIGHT (the game mirrors them). The last body row of walkers sits on round(0.9*h) - 1 of the
//   logical size, i.e. on the anchor of origin (0.5, 0.9); flyers and ghosts hover above it.
// - MONSTER_ANIMS[`mon_<id>`] = { frames: [`mon_<id>`, `mon_<id>_1`], fps } — a 2-frame loop (idle bob,
//   walk step, wing beat or flicker) keyed by the frame-0 texture key, so tinted elites that reuse a base
//   texture can look it up with their own `texture` field.
// - Commons that elites tint (jellop, puddlewisp, gustling, cragling, gloomcap, cairn_wraith, emberkit,
//   voltcalf) keep mid-to-light bodies so a multiply tint still shows.
// - Elites (`base` + `scale` + `tint` in src/data/monsters.ts) get their own `mon_<eliteId>` / `_1` frames painted
//   NATIVELY at round(size x scale) with the tint baked in (MONSTER_VARIANTS, monsterTexture): shapes re-rasterised at
//   the real size, 1 px outline added at that size — the game never scales a monster sprite (docs/QUALITY-PLAN.md §1).
// - monsterHideColor(id) is each monster's body tone (the VFX death pop tints its chips with it).
// - Deterministic: no Math.random, every texture <= 2048 px.
// =====================================================================================================

// ------------------------------------------------------------------ colour

type RGBA = [number, number, number, number];
const RGB_CACHE = new Map<string, RGBA>();

function rgbaOf(col: string): RGBA {
  let v = RGB_CACHE.get(col);
  if (!v) {
    const n = parseInt(col.slice(1, 7), 16);
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255, col.length >= 9 ? parseInt(col.slice(7, 9), 16) : 255];
    RGB_CACHE.set(col, v);
  }
  return v;
}

function toHsl(col: string): [number, number, number] {
  const [r8, g8, b8] = rgbaOf(col);
  const r = r8 / 255;
  const g = g8 / 255;
  const b = b8 / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const l = (mx + mn) / 2;
  if (mx === mn) return [0, 0, l];
  const d = mx - mn;
  const s = l > 0.5 ? d / (2 - mx - mn) : d / (mx + mn);
  let h = mx === r ? (g - b) / d + (g < b ? 6 : 0) : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  h *= 60;
  return [h, s, l];
}

function fromHsl(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  const k = (v: number) => Math.round((v + m) * 255);
  return `#${((k(r) << 16) | (k(g) << 8) | k(b)).toString(16).padStart(6, '0')}`;
}

/** Move hue `h` toward `target` by at most `amt` degrees. */
function hueToward(h: number, target: number, amt: number): number {
  let d = ((target - h + 540) % 360) - 180;
  if (Math.abs(d) < amt) return target;
  return h + Math.sign(d) * amt;
}

type Ramp = readonly string[];

/**
 * Hue-shifted ramp, dark -> light, with `base` at index n-2 (one highlight above it): shadows drift toward
 * blue-violet and gain saturation, the highlight drifts toward warm yellow.
 */
function ramp(base: string, n = 4, step = 0.105): string[] {
  const [h, s, l] = toHsl(base);
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const k = i - (n - 2); // ..., -2, -1, 0, +1
    if (k < 0) out.push(fromHsl(hueToward(h, 250, -k * 9), s + -k * 0.05, l + k * step));
    else if (k === 0) out.push(base);
    else out.push(fromHsl(hueToward(h, 55, 8), s - 0.04, l + step * 1.05));
  }
  return out;
}

// ------------------------------------------------------------------ painter

const O = PAL.outline;
const EYE = '#1d1420';
const WHITE = '#fffdf2';

/** Light direction (top-left, toward the viewer), normalised. */
const LX = -0.45;
const LY = -0.6;
const LZ = 0.66;
const LN = Math.hypot(LX, LY, LZ);
const THRESH: Record<number, number[]> = {
  1: [],
  2: [0.15],
  3: [-0.05, 0.78],
  4: [-0.32, 0.22, 0.8],
  5: [-0.5, -0.12, 0.36, 0.82],
};

type Mode = 'ball' | 'bevel' | 'flat' | 'vert';
type Normal = (x: number, y: number) => [number, number, number];

interface ShapeOpts {
  /** Shading: ball (lit volume), bevel (flat + lit top-left rim + dark bottom-right rim), flat, vert (top light). */
  mode?: Mode;
  /** Colour for boundary pixels that touch paint already on the canvas (separates front parts). */
  edge?: string;
  /** Explicit surface normal (ball mode). */
  norm?: Normal;
  /** Brightness bias for ball shading (+ lighter). */
  lift?: number;
}

class Pix {
  readonly d: Uint8ClampedArray<ArrayBuffer>;

  /**
   * `w` x `h` is the real buffer; (ox, oy) offsets every drawing call, so a species drawn in its logical
   * coordinates can get a few pixels of margin (outline room) without touching its drawing code.
   * `k` > 1 paints the species natively bigger (elites, docs/QUALITY-PLAN.md §1): shapes are re-rasterised at the real
   * resolution (pixel centres sampled in logical coordinates), single pixels / lines / rects cover their logical cell
   * ([floor(i·k), floor((i+1)·k))), and the 1 px outline is added afterwards at the real size — no sprite scaling.
   * k = 1 paints exactly as before.
   */
  constructor(
    readonly w: number,
    readonly h: number,
    readonly ox = 0,
    readonly oy = 0,
    readonly k = 1,
  ) {
    this.d = new Uint8ClampedArray(w * h * 4);
  }

  /** Real start of logical cell `i` along an axis with offset `off`. */
  private at(i: number, off: number): number {
    return this.k === 1 ? i + off : Math.floor((i + off) * this.k);
  }

  ok(x: number, y: number): boolean {
    const X = this.at(x, this.ox);
    const Y = this.at(y, this.oy);
    return X >= 0 && Y >= 0 && X < this.w && Y < this.h;
  }

  /** Real-pixel opacity test. */
  private rsolid(X: number, Y: number): boolean {
    return X >= 0 && Y >= 0 && X < this.w && Y < this.h && this.d[(Y * this.w + X) * 4 + 3] >= 128;
  }

  solid(x: number, y: number): boolean {
    if (this.k === 1) return this.rsolid(x + this.ox, y + this.oy);
    return this.rsolid(Math.floor((x + this.ox + 0.5) * this.k), Math.floor((y + this.oy + 0.5) * this.k));
  }

  /** Calls `fn` for every real pixel of logical cell (x, y) (one pixel when k = 1). */
  private cell(x: number, y: number, fn: (X: number, Y: number) => void): void {
    const X0 = this.at(x, this.ox);
    const Y0 = this.at(y, this.oy);
    if (this.k === 1) {
      fn(X0, Y0);
      return;
    }
    const X1 = this.at(x + 1, this.ox);
    const Y1 = this.at(y + 1, this.oy);
    for (let Y = Y0; Y < Y1; Y++) for (let X = X0; X < X1; X++) fn(X, Y);
  }

  /** One pixel; `a` < 1 composites over what is there. */
  px(x: number, y: number, col: string, a = 1): void {
    this.cell(Math.round(x), Math.round(y), (X, Y) => this.rpx(X, Y, col, a));
  }

  /** One real pixel of the buffer. */
  private rpx(X: number, Y: number, col: string, a = 1): void {
    if (X < 0 || Y < 0 || X >= this.w || Y >= this.h) return;
    const [r, g, b, ca] = rgbaOf(col);
    const k = (Y * this.w + X) * 4;
    const d = this.d;
    const al = (a * ca) / 255;
    if (al >= 0.999) {
      d[k] = r;
      d[k + 1] = g;
      d[k + 2] = b;
      d[k + 3] = 255;
      return;
    }
    const da = d[k + 3] / 255;
    const oa = al + da * (1 - al);
    if (oa <= 0) return;
    d[k] = (r * al + d[k] * da * (1 - al)) / oa;
    d[k + 1] = (g * al + d[k + 1] * da * (1 - al)) / oa;
    d[k + 2] = (b * al + d[k + 2] * da * (1 - al)) / oa;
    d[k + 3] = oa * 255;
  }

  /** Only paints over pixels that are already opaque (details on a body). */
  on(x: number, y: number, col: string): void {
    this.cell(Math.round(x), Math.round(y), (X, Y) => {
      if (this.rsolid(X, Y)) this.rpx(X, Y, col);
    });
  }

  clear(x: number, y: number): void {
    this.cell(Math.round(x), Math.round(y), (X, Y) => {
      if (X >= 0 && Y >= 0 && X < this.w && Y < this.h) this.d[(Y * this.w + X) * 4 + 3] = 0;
    });
  }

  rect(x: number, y: number, w: number, h: number, col: string, a = 1): void {
    x = Math.round(x);
    y = Math.round(y);
    for (let j = 0; j < Math.round(h); j++) for (let i = 0; i < Math.round(w); i++) this.px(x + i, y + j, col, a);
  }

  line(x0: number, y0: number, x1: number, y1: number, col: string, a = 1): void {
    let x = Math.round(x0);
    let y = Math.round(y0);
    const tx = Math.round(x1);
    const ty = Math.round(y1);
    const dx = Math.abs(tx - x);
    const dy = -Math.abs(ty - y);
    const sx = x < tx ? 1 : -1;
    const sy = y < ty ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      this.px(x, y, col, a);
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

  /** Polyline through flat [x0,y0,x1,y1,...]. */
  path(pts: number[], col: string): void {
    for (let i = 2; i < pts.length; i += 2) this.line(pts[i - 2], pts[i - 1], pts[i], pts[i + 1], col);
  }

  dots(pts: number[], col: string, a = 1): void {
    for (let i = 0; i < pts.length; i += 2) this.px(pts[i], pts[i + 1], col, a);
  }

  /** Masked shape filled from a ramp (dark -> light). Pixel centres are sampled, so params may be fractional. */
  shape(bx0: number, by0: number, bx1: number, by1: number, inside: (x: number, y: number) => boolean, fill: Ramp | string, o: ShapeOpts = {}): void {
    // Works on REAL pixels (x, y below); `lx` / `ly` map a real pixel centre back to logical coordinates.
    const k = this.k;
    const { ox, oy } = this;
    const lx = (x: number) => (x + 0.5) / k - ox;
    const ly = (y: number) => (y + 0.5) / k - oy;
    const X0 = Math.max(0, Math.floor((bx0 + ox) * k));
    const Y0 = Math.max(0, Math.floor((by0 + oy) * k));
    const X1 = Math.min(this.w - 1, Math.ceil((bx1 + ox + 1) * k) - 1);
    const Y1 = Math.min(this.h - 1, Math.ceil((by1 + oy + 1) * k) - 1);
    const mw = X1 - X0 + 1;
    const mh = Y1 - Y0 + 1;
    if (mw <= 0 || mh <= 0) return;
    const m = new Uint8Array(mw * mh);
    let ax0 = Infinity;
    let ay0 = Infinity;
    let ax1 = -Infinity;
    let ay1 = -Infinity;
    for (let y = Y0; y <= Y1; y++)
      for (let x = X0; x <= X1; x++)
        if (inside(lx(x), ly(y))) {
          m[(y - Y0) * mw + x - X0] = 1;
          if (x < ax0) ax0 = x;
          if (y < ay0) ay0 = y;
          if (x > ax1) ax1 = x;
          if (y > ay1) ay1 = y;
        }
    if (ax0 === Infinity) return;
    const R = typeof fill === 'string' ? [fill] : fill;
    const n = R.length;
    const base = R[n >= 3 ? n - 2 : n - 1];
    const mode: Mode = o.mode ?? (n >= 3 ? 'ball' : 'flat');
    // ellipse fitted to the mask, in logical units
    const ecx = (ax0 + ax1 + 1) / 2 / k - ox;
    const ecy = (ay0 + ay1 + 1) / 2 / k - oy;
    const erx = (ax1 - ax0 + 1) / 2 / k;
    const ery = (ay1 - ay0 + 1) / 2 / k;
    const norm: Normal =
      o.norm ??
      ((x, y) => {
        const nx = (x - ecx) / erx;
        const ny = (y - ecy) / ery;
        const d2 = nx * nx + ny * ny;
        if (d2 >= 1) {
          const dd = Math.sqrt(d2);
          return [nx / dd, ny / dd, 0];
        }
        return [nx, ny, Math.sqrt(1 - d2)];
      });
    const th = THRESH[Math.min(5, n)] ?? THRESH[4];
    const lift = o.lift ?? 0;
    const inM = (x: number, y: number) => x >= X0 && y >= Y0 && x <= X1 && y <= Y1 && m[(y - Y0) * mw + x - X0] === 1;
    const out: [number, number, string][] = [];
    for (let y = ay0; y <= ay1; y++)
      for (let x = ax0; x <= ax1; x++) {
        if (!inM(x, y)) continue;
        const up = !inM(x, y - 1);
        const dn = !inM(x, y + 1);
        const lf = !inM(x - 1, y);
        const rt = !inM(x + 1, y);
        let col: string;
        if (o.edge && ((up && this.rsolid(x, y - 1)) || (dn && this.rsolid(x, y + 1)) || (lf && this.rsolid(x - 1, y)) || (rt && this.rsolid(x + 1, y)))) col = o.edge;
        else if (mode === 'flat') col = base;
        else if (mode === 'bevel') {
          const lit = up || lf;
          const dark = dn || rt;
          col = lit && !dark ? R[n - 1] : dark && !lit ? R[0] : base;
        } else if (mode === 'vert') {
          const t = (y - ay0 + 0.5) / (ay1 - ay0 + 1);
          col = R[Math.max(0, Math.min(n - 1, n - 1 - Math.floor(t * n)))];
        } else {
          const [nx, ny, nz] = norm(lx(x), ly(y));
          const l = (nx * LX + ny * LY + nz * LZ) / LN + lift;
          let i = 0;
          while (i < th.length && l >= th[i]) i++;
          col = R[Math.min(n - 1, i)];
        }
        out.push([x, y, col]);
      }
    for (const [x, y, col] of out) this.rpx(x, y, col);
  }

  ell(cx: number, cy: number, rx: number, ry: number, fill: Ramp | string, o: ShapeOpts = {}): void {
    this.shape(
      cx - rx - 1,
      cy - ry - 1,
      cx + rx + 1,
      cy + ry + 1,
      (x, y) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1,
      fill,
      {
        norm: (x, y) => {
          const nx = (x - cx) / rx;
          const ny = (y - cy) / ry;
          const d2 = nx * nx + ny * ny;
          return d2 >= 1 ? [nx / Math.sqrt(d2), ny / Math.sqrt(d2), 0] : [nx, ny, Math.sqrt(1 - d2)];
        },
        ...o,
      },
    );
  }

  /** Polygon from flat [x0,y0,...] (even-odd). */
  poly(pts: number[], fill: Ramp | string, o: ShapeOpts = {}): void {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) {
      x0 = Math.min(x0, pts[i]);
      x1 = Math.max(x1, pts[i]);
      y0 = Math.min(y0, pts[i + 1]);
      y1 = Math.max(y1, pts[i + 1]);
    }
    this.shape(x0 - 1, y0 - 1, x1 + 1, y1 + 1, (x, y) => inPoly(pts, x, y), fill, o);
  }

  /** Tapered capsule from (x0,y0) radius r0 to (x1,y1) radius r1, shaded as a cylinder. */
  cap(x0: number, y0: number, x1: number, y1: number, r0: number, fill: Ramp | string, r1 = r0, o: ShapeOpts = {}): void {
    const dx = x1 - x0;
    const dy = y1 - y0;
    const L2 = dx * dx + dy * dy || 1e-6;
    const at = (x: number, y: number) => {
      const t = Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2));
      const r = r0 + (r1 - r0) * t;
      return { vx: (x - (x0 + dx * t)) / r, vy: (y - (y0 + dy * t)) / r };
    };
    const R = Math.max(r0, r1);
    this.shape(
      Math.min(x0, x1) - R - 1,
      Math.min(y0, y1) - R - 1,
      Math.max(x0, x1) + R + 1,
      Math.max(y0, y1) + R + 1,
      (x, y) => {
        const { vx, vy } = at(x, y);
        return vx * vx + vy * vy <= 1;
      },
      fill,
      {
        norm: (x, y) => {
          const { vx, vy } = at(x, y);
          const d2 = vx * vx + vy * vy;
          return d2 >= 1 ? [vx, vy, 0] : [vx, vy, Math.sqrt(1 - d2)];
        },
        ...o,
      },
    );
  }

  /** Pixel eye: dark w x h block with a 1 px shine in its top-left. */
  eye(x: number, y: number, w = 2, h = 3, col = EYE, shine: string | null = WHITE): void {
    this.rect(x, y, w, h, col);
    if (shine) this.px(x, y, shine);
  }

  /** Copy the canvas back in (after the toolkit outline) / write the buffer to it. */
  load(c: CanvasRenderingContext2D): void {
    this.d.set(c.getImageData(0, 0, this.w, this.h).data);
  }

  put(c: CanvasRenderingContext2D): void {
    c.putImageData(new ImageData(this.d, this.w, this.h), 0, 0);
  }
}

function inPoly(pts: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 2; i < pts.length; j = i, i += 2) {
    const xi = pts[i];
    const yi = pts[i + 1];
    const xj = pts[j];
    const yj = pts[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ------------------------------------------------------------------ shared materials

const R = {
  bark: ramp('#7d5530', 4),
  wood: ['#3d2817', '#5c3d22', '#7d5530', '#9c6d3e'] as Ramp,
  iron: ['#3c3f4a', '#5d626e', '#8a909b', '#c3c8cf'] as Ramp,
  steel: ['#4a5060', '#7a8392', '#b4bcc6', '#e8edf0'] as Ramp,
  gold: ['#7a4e18', '#b07a2a', '#e0b048', '#f8e08a'] as Ramp,
  bronze: ['#5a3a1a', '#8a5c2a', '#b0803a', '#e0b060'] as Ramp,
  leather: ['#3e2616', '#5e3a20', '#82522c', '#a87040'] as Ramp,
  cloth: ['#5a2028', '#82303a', '#b8323a', '#d8606a'] as Ramp,
  bone: ['#8a7c62', '#b8a888', '#ddd0b0', '#f6eed8'] as Ramp,
  stone: ['#4a4d55', '#666a73', '#878b93', '#a9adb3'] as Ramp,
  leaf: ['#2b4a22', '#3d6630', '#548540', '#74a655', '#9cc870'] as Ramp,
};

/** Tiny lit sparkle (4-point star). */
function spark(p: Pix, x: number, y: number, col: string, core = WHITE, arm = 1): void {
  for (let i = 1; i <= arm; i++) {
    p.px(x - i, y, col);
    p.px(x + i, y, col);
    p.px(x, y - i, col);
    p.px(x, y + i, col);
  }
  p.px(x, y, core);
}

/** Jagged bolt through flat points with a bright core, 1 px wide. */
function zap(p: Pix, pts: number[], col: string, core?: string): void {
  p.path(pts, col);
  if (core) for (let i = 2; i < pts.length - 2; i += 2) p.px(pts[i], pts[i + 1], core);
}

/** Soft pixel halo: stepped alpha discs (no gradients), painted after the outline. */
function halo(p: Pix, cx: number, cy: number, r: number, col: string, a = 0.22): void {
  for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++)
    for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy) / r;
      if (d > 1) continue;
      if (p.solid(x, y)) continue;
      p.px(x, y, col, d < 0.6 ? a : a * 0.5);
    }
}

// ------------------------------------------------------------------ species

interface Mon {
  /** Logical drawing size (the v2 texture size). */
  w: number;
  h: number;
  /** Extra outline room: [px on each side, px on top]. The texture grows by 2*x by top. */
  pad?: [number, number];
  /** Recommended loop speed of the 2-frame animation. */
  fps: number;
  draw: (p: Pix, f: number) => void;
  /** Painted after the outline (glows, sparks, auras). */
  post?: (p: Pix, f: number) => void;
}

/** Ground row: the last body row sits at ground(h) - 1, the outline row at ground(h). */
const ground = (h: number) => Math.round(h * 0.9) - 1;

// ---------------------------------------------------------------- Hearth Vale commons

const JELLY = ramp('#78c25a', 5, 0.09);

const jellop: Mon = {
  w: 32,
  h: 32,
  fps: 4,
  draw: (p, f) => {
    const g = ground(32); // 28
    const sq = f; // squash frame
    const rx = 10.5 + sq * 1.5;
    const top = 9 + sq * 2;
    const cy = g - 8 + sq;
    // thorn-sword stuck in the jelly (behind the body)
    const sy = cy - 1 + sq;
    p.line(24, sy + 4, 29, sy - 6, R.steel[2]);
    p.line(25, sy + 4, 30, sy - 6, R.steel[1]);
    p.px(30, sy - 7, R.steel[3]);
    // jelly dome: rounded top, flattened skirt
    p.shape(
      0,
      top - 1,
      31,
      g + 1,
      (x, y) => {
        if (y > g + 1) return false;
        const ry = y < cy ? cy - top : g + 1 - cy;
        return ((x - 16) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1 || (y > cy && Math.abs(x - 16) <= rx - 0.5 - (y - cy) * 0.15);
      },
      JELLY,
    );
    // crossguard + grip poking out of the jelly
    p.line(22, sy + 3, 25, sy + 6, R.bronze[2]);
    p.px(22, sy + 3, R.bronze[3]);
    // inner rim light + bubbles (translucent feel)
    for (let x = 9; x <= 22; x++) p.on(x, g - 1, JELLY[3]);
    for (const [bx, by, r] of [
      [21, cy + 3, 1.3],
      [23, cy - 1, 1],
      [11, cy + 4, 1],
    ])
      p.ell(bx, by, r, r, [JELLY[3], JELLY[4]], { mode: 'flat' });
    // highlight streak top-left
    p.dots([9, top + 5, 10, top + 4, 11, top + 3, 9, top + 6, 12, top + 2], JELLY[4]);
    // acorn-cap helmet, worn askew
    const hy = top - 3 - sq;
    p.ell(14.5, hy + 2.5, 6.5, 3.4, R.bark, { edge: R.bark[0] });
    for (let x = 10; x <= 19; x += 2) p.on(x, hy + 1 + ((x >> 1) & 1), R.bark[1]);
    p.rect(9, hy + 4, 12, 1, R.bark[0]);
    p.rect(14, hy - 2, 2, 2, R.wood[1]);
    p.px(14, hy - 2, R.wood[3]);
    // face: determined brows, shiny eyes, little mouth, blush
    const ey = cy - 1;
    p.eye(12, ey, 2, 3);
    p.eye(18, ey, 2, 3);
    p.line(11, ey - 2, 13, ey - 1, EYE);
    p.line(18, ey - 1, 20, ey - 2, EYE);
    p.dots([14, ey + 4, 15, ey + 5, 16, ey + 5, 17, ey + 4], EYE);
    p.rect(9, ey + 3, 2, 1, PAL.rose);
    p.rect(20, ey + 3, 2, 1, PAL.rose);
  },
};

const STONE_W = ramp('#958772', 5, 0.085);
const AMBER = ['#a0521a', '#e08a2a', '#ffc94a', '#fff2b0'] as Ramp;

const cragling: Mon = {
  w: 40,
  h: 44,
  pad: [1, 1],
  fps: 4,
  draw: (p, f) => {
    const g = ground(44); // 38
    const b = f; // body bob
    // legs (step: the near leg lifts on frame 1)
    p.cap(15, g - 5, 14, g - 1, 3.4, STONE_W, 3.6);
    p.cap(25, g - 5 - f, 26, g - 1 - f, 3.4, STONE_W, 3.6, { edge: STONE_W[0] });
    // back arm (swings)
    p.cap(9, 22 + b, 6 - f, 30 + b, 3, STONE_W, 3.6);
    p.ell(6 - f, 31 + b, 3.6, 3.4, STONE_W);
    // torso + head boulders
    p.ell(20, 26 + b, 11.5, 9.5, STONE_W);
    p.ell(21, 13 + b, 9.5, 8, STONE_W, { edge: STONE_W[1] });
    // cracks / chips
    p.path([13, 21 + b, 15, 23 + b, 14, 26 + b], STONE_W[1]);
    p.path([26, 30 + b, 28, 31 + b], STONE_W[1]);
    p.path([16, 9 + b, 18, 10 + b], STONE_W[1]);
    // moss tuft + sprout on the head
    p.ell(16, 6.5 + b, 5, 2.2, R.leaf, { edge: R.leaf[1] });
    p.dots([14, 5 + b, 17, 5 + b, 19, 6 + b], R.leaf[4]);
    p.line(17, 4 + b, 18, 1 + b, R.leaf[2]);
    p.dots([19, 1 + b, 20, 0 + b, 16, 1 + b], R.leaf[3]);
    // glowing eye slits + heavy brow
    p.rect(17, 11 + b, 12, 2, STONE_W[1]);
    p.rect(20, 13 + b, 3, 2, AMBER[2]);
    p.rect(26, 13 + b, 3, 2, AMBER[2]);
    p.px(20, 13 + b, AMBER[3]);
    p.px(26, 13 + b, AMBER[3]);
    // amber core set in the chest
    p.poly([19, 21 + b, 23, 25 + b, 19, 30 + b, 15, 25 + b], AMBER, { mode: 'bevel', edge: STONE_W[0] });
    p.px(18, 23 + b, AMBER[3]);
    // pickaxe in the near hand, resting on the shoulder
    const hx = 31;
    const hy = 27 + b;
    p.line(hx - 1, hy + 4, hx + 4, hy - 17, R.wood[1]);
    p.line(hx, hy + 4, hx + 5, hy - 17, R.wood[3]);
    p.poly([hx - 5, hy - 15, hx + 2, hy - 20, hx + 8, hy - 19, hx + 9, hy - 16, hx + 4, hy - 17, hx - 4, hy - 13], R.iron, { mode: 'bevel', edge: R.iron[0] });
    // near arm + fist over the handle
    p.cap(29, 21 + b, 31, 26 + b, 3.2, STONE_W, 3.4, { edge: STONE_W[0] });
    p.ell(31.5, 27 + b, 3.4, 3, STONE_W, { edge: STONE_W[0] });
  },
};

const FOX = ramp('#e08a44', 5, 0.085);
const CREAM = ['#b8865a', '#dcb488', '#f2dcb0', '#fff4da'] as Ramp;
const FLAME = ['#a8301e', '#e0602a', '#ffa23a', '#ffe27a', '#fff8d0'] as Ramp;

const emberkit: Mon = {
  w: 40,
  h: 36,
  fps: 6,
  draw: (p, f) => {
    const g = ground(36); // 31
    const b = f ? 0 : 0;
    // tail curling up behind, flame tip
    p.cap(10, 23, 5, 15, 2.6, FOX, 3.2);
    p.cap(5, 15, 7, 9, 3.2, FOX, 2.4);
    const fl = f
      ? [3, 10, 5, 2, 7, 6, 9, 0, 11, 7, 10, 11, 4, 12]
      : [3, 11, 4, 4, 7, 7, 8, 1, 11, 6, 11, 11, 5, 12];
    p.poly(fl, FLAME, { mode: 'vert' });
    // far legs
    p.cap(13 + f, g - 5, 12 + f * 2, g - 1, 2, FOX.slice(0, 4), 2);
    p.cap(25 - f, g - 5, 26 - f * 2, g - 1, 2, FOX.slice(0, 4), 2);
    // body
    p.ell(18, 23 + b, 9.5, 6.5, FOX);
    p.ell(19, 26 + b, 6, 2.5, CREAM, { edge: FOX[2] });
    // near legs
    p.cap(15 - f, g - 5, 15 - f * 2, g - 1, 2.2, FOX, 2.2, { edge: FOX[1] });
    p.cap(23 + f, g - 5, 24 + f * 2, g - 1, 2.2, FOX, 2.2, { edge: FOX[1] });
    for (const x of [15 - f * 2, 24 + f * 2]) p.rect(x - 2, g, 4, 1, CREAM[1]);
    // head
    const hx = 28;
    const hy = 15 + b;
    // ears with ember tufts
    p.poly([hx - 7, hy - 3, hx - 6, hy - 12, hx - 1, hy - 6], FOX, { mode: 'bevel' });
    p.poly([hx + 1, hy - 6, hx + 5, hy - 13, hx + 7, hy - 3], FOX, { mode: 'bevel' });
    p.poly([hx - 6, hy - 6, hx - 5.5, hy - 11, hx - 3, hy - 7], FLAME.slice(1), { mode: 'flat' });
    p.poly([hx + 3, hy - 7, hx + 5, hy - 12, hx + 6, hy - 6], FLAME.slice(1), { mode: 'flat' });
    p.ell(hx, hy, 8, 7, FOX, { edge: FOX[1] });
    // muzzle + nose
    p.ell(hx + 4.5, hy + 3, 4, 3, CREAM, { edge: FOX[1] });
    p.rect(hx + 7, hy + 1, 2, 2, EYE);
    // eye (big, shiny) + cheek
    p.eye(hx, hy - 2, 2, 3);
    p.eye(hx - 5, hy - 2, 2, 3);
    p.rect(hx - 7, hy + 2, 2, 1, PAL.rose);
    // soot bandana with knot
    p.poly([hx - 8, hy + 5, hx + 2, hy + 6, hx, hy + 9, hx - 7, hy + 9], R.cloth, { mode: 'bevel', edge: R.cloth[0] });
    p.poly([hx - 9, hy + 6, hx - 13, hy + 10 - f, hx - 11, hy + 11 - f], R.cloth, { mode: 'bevel' });
    p.px(hx - 5, hy + 7, R.gold[3]);
  },
};

const ROOT = ramp('#c8925a', 5, 0.085);

const pipsprout: Mon = {
  w: 32,
  h: 32,
  fps: 5,
  draw: (p, f) => {
    const g = ground(32); // 28
    const b = f;
    // leaves (sway on frame 1)
    p.poly([15, 11 + b, 9 - f, 4 + b, 5 - f, 6 + b, 9, 10 + b, 14, 12 + b], R.leaf);
    p.poly([16, 11 + b, 19 + f, 3 + b, 24 + f, 3 + b, 22, 8 + b, 17, 12 + b], R.leaf);
    p.line(14, 11 + b, 8 - f, 6 + b, R.leaf[1]);
    p.line(17, 11 + b, 21 + f, 5 + b, R.leaf[1]);
    // root legs
    p.cap(12, g - 4, 11 - f, g, 1.8, ROOT.slice(0, 4), 1.4);
    p.cap(18, g - 4, 19 + f, g, 1.8, ROOT.slice(0, 4), 1.4);
    // bulb body with a pointed crown
    p.shape(4, 8 + b, 27, g - 1, (x, y) => {
      const cy = 19 + b;
      if (y < cy) return Math.abs(x - 15.5) <= 8.5 * Math.pow((y - (10 + b)) / (cy - 10 - b), 0.55);
      return ((x - 15.5) / 8.5) ** 2 + ((y - cy) / 7) ** 2 <= 1;
    }, ROOT);
    // root stripes
    p.path([8, 21 + b, 10, 22 + b], ROOT[1]);
    p.path([21, 23 + b, 22, 24 + b], ROOT[1]);
    // face
    p.eye(12, 16 + b, 2, 3);
    p.eye(17, 16 + b, 2, 3);
    p.rect(14, 21 + b, 2, 2, '#6a2a2a');
    p.px(14, 21 + b, EYE);
    p.rect(9, 20 + b, 2, 1, PAL.rose);
    // leaf shield on a root arm
    p.cap(19, 21 + b, 23, 22 + b, 1.2, ROOT.slice(0, 4));
    p.ell(25, 21 + b, 4, 5.5, R.leaf, { edge: R.leaf[0] });
    p.line(25, 17 + b, 25, 26 + b, R.leaf[1]);
    p.dots([24, 19 + b, 26, 20 + b, 24, 22 + b, 26, 23 + b], R.leaf[1]);
  },
};

const WATER = [...PAL.water, PAL.foam] as Ramp;

const puddlewisp: Mon = {
  w: 32,
  h: 34,
  fps: 4,
  draw: (p, f) => {
    const b = -f; // floats up on frame 1
    const cy = 22 + b;
    // lily-pad parasol held up in the fin (behind the head)
    const ux = 25;
    p.line(ux, cy + 1, ux, 6 + b, R.leaf[1]);
    p.shape(18, 2 + b, 31, 9 + b, (x, y) => ((x - ux) / 6.5) ** 2 + ((y - (6 + b)) / 3) ** 2 <= 1 && !(y < 6 + b && Math.abs(x - ux - 2) < 1), R.leaf, { mode: 'ball' });
    p.dots([ux - 3, 5 + b, ux - 1, 4 + b], R.leaf[4]);
    p.rect(ux + 2, 3 + b, 2, 2, PAL.rose);
    p.px(ux + 2, 3 + b, '#ffd0d8');
    // droplet body with a curling crest
    p.shape(4, 6 + b, 28, 31 + b, (x, y) => {
      const tip = 7 + b;
      if (y < cy) {
        const t = (y - tip) / (cy - tip);
        if (t < 0) return false;
        const xc = 16 + (1 - t) * 3.5;
        return Math.abs(x - xc) <= 8.5 * Math.pow(t, 0.75);
      }
      return ((x - 16) / 8.5) ** 2 + ((y - cy) / 7.5) ** 2 <= 1;
    }, WATER);
    // fins
    p.ell(7, cy + 2, 2.4, 1.6, WATER.slice(1), { edge: WATER[1] });
    p.ell(24, cy + 1, 2.4, 1.6, WATER.slice(1), { edge: WATER[1] });
    // belly shimmer + shine
    p.ell(16.5, cy + 2.5, 5.5, 4, [WATER[3], WATER[3], PAL.foam], { mode: 'ball' });
    p.dots([10, cy - 6, 11, cy - 8, 12, cy - 9, 10, cy - 5], PAL.foam);
    // face
    p.eye(13, cy - 1, 2, 3, '#10305a');
    p.eye(18, cy - 1, 2, 3, '#10305a');
    p.rect(15, cy + 3, 2, 1, '#10305a');
    p.rect(11, cy + 2, 1, 1, PAL.rose);
    p.rect(21, cy + 2, 1, 1, PAL.rose);
  },
  post: (p, f) => {
    // puddle ripple under the hover
    const r = 8 + f;
    for (let x = -r; x <= r; x++) {
      const y = Math.round(Math.sqrt(Math.max(0, 1 - (x / r) ** 2)) * 1.6);
      p.px(16 + x, 31 + y, PAL.foam, 0.55);
      p.px(16 + x, 31 - y, PAL.foam, 0.55);
    }
  },
};

const CLOUD = ['#7f96b4', '#a7bcd2', '#cfdeeb', '#eef5fa', '#ffffff'] as Ramp;
const MINT = ['#2e8478', '#4cb09a', '#8de0c0', '#d4fff0'] as Ramp;

const gustling: Mon = {
  w: 32,
  h: 32,
  fps: 7,
  draw: (p, f) => {
    const b = f; // bobs down as the wings beat down
    const cy = 18 + b;
    const WG = [CLOUD[0], CLOUD[1], CLOUD[2], CLOUD[3]];
    // far wing (mint tipped)
    if (f === 0) p.poly([10, cy - 2, 3, cy - 9, 1, cy - 5, 5, cy + 1], WG);
    else p.poly([10, cy, 2, cy + 3, 1, cy + 6, 8, cy + 4], WG);
    p.px(f ? 2 : 2, f ? cy + 4 : cy - 7, MINT[2]);
    // tail tuft
    p.poly([8, cy + 3, 3, cy + 6, 4, cy + 8, 9, cy + 6], CLOUD.slice(1));
    // puffy body: core + bumps
    for (const [x, y, r] of [
      [10, cy - 3, 3.5],
      [13, cy - 6, 4],
      [18.5, cy - 6, 4],
      [22, cy - 2, 3.5],
      [10, cy + 3, 3.5],
      [21, cy + 3, 3.5],
      [15.5, cy + 5, 4],
    ])
      p.ell(x, y, r, r, CLOUD);
    p.ell(15.5, cy, 7.5, 6.5, CLOUD);
    // near wing at the side (clear of the face)
    if (f === 0) p.poly([21, cy + 1, 26, cy - 6, 30, cy - 7, 28, cy, 24, cy + 3], WG, { edge: CLOUD[0] });
    else p.poly([21, cy + 1, 28, cy + 2, 30, cy + 6, 23, cy + 5], WG, { edge: CLOUD[0] });
    p.px(f ? 29 : 29, f ? cy + 5 : cy - 6, MINT[2]);
    // face + beak
    p.eye(14, cy - 2, 2, 2);
    p.eye(19, cy - 2, 2, 2);
    p.poly([20, cy + 1, 23, cy + 2, 20, cy + 3], ['#c86a2a', '#e8a040', '#ffd070'], { mode: 'bevel' });
    p.rect(12, cy + 1, 2, 1, PAL.rose);
    // pinwheel sprouting from the head, spinning between frames
    p.line(16, cy - 9, 16, cy - 12, R.wood[3]);
    const px0 = 16;
    const py0 = cy - 14;
    const vanes = f === 0
      ? [
          [0, 0, 0, -3, 2, -2],
          [0, 0, 3, 0, 2, 2],
          [0, 0, 0, 3, -2, 2],
          [0, 0, -3, 0, -2, -2],
        ]
      : [
          [0, 0, 2, -2, 3, 0],
          [0, 0, 2, 2, 0, 3],
          [0, 0, -2, 2, -3, 0],
          [0, 0, -2, -2, 0, -3],
        ];
    const cols = [MINT[2], PAL.cream, MINT[2], PAL.cream];
    vanes.forEach((v, i) => {
      const pts = v.map((n, k) => n + (k % 2 ? py0 : px0) + 0.5);
      p.poly(pts, cols[i], { mode: 'flat' });
      p.line(pts[0], pts[1], pts[2], pts[3], cols[i]);
    });
    p.px(px0, py0, PAL.crimson);
    // tiny feet
    p.dots([13, cy + 9, 18, cy + 9], '#e8a040');
  },
  post: (p, f) => {
    const o = f * 2;
    p.dots([1 + o, 27, 2 + o, 27, 3 + o, 27, 5 + o, 26], '#d4fff0', 0.7);
  },
};

const SHELL = ['#7a4e10', '#b88420', '#e6b83a', '#ffe27a', '#fff6c8'] as Ramp;
const NAVY = ['#141a30', '#232c4c', '#36426a', '#56628c'] as Ramp;

const sparkbug: Mon = {
  w: 32,
  h: 32,
  fps: 8,
  draw: (p, f) => {
    const b = f; // hover bob
    const cy = 17 + b;
    // wings (translucent-looking) behind the shell
    const WING = ['#8aa8c8', '#b8d4ec', '#e2f0fc'] as Ramp;
    if (f === 0) {
      p.poly([12, cy - 4, 5, cy - 14, 9, cy - 15, 16, cy - 5], WING, { mode: 'bevel' });
      p.poly([15, cy - 4, 15, cy - 15, 19, cy - 14, 18, cy - 4], WING, { mode: 'bevel' });
    } else {
      p.poly([12, cy - 3, 1, cy - 6, 2, cy - 2, 12, cy], WING, { mode: 'bevel' });
      p.poly([14, cy - 4, 6, cy - 10, 5, cy - 7, 13, cy - 2], WING, { mode: 'bevel' });
    }
    // legs dangling
    for (const [x, d] of [
      [11, -1],
      [15, 0],
      [19, 1],
    ])
      p.path([x, cy + 4, x + d, cy + 7, x + d + 1, cy + 8], NAVY[1]);
    // shell (domed, split line, stripes, bolt emblem)
    p.ell(14, cy, 9, 6.5, SHELL);
    p.line(14, cy - 6, 14, cy + 5, SHELL[0]);
    for (const [x, y] of [
      [9, cy - 3],
      [18, cy - 3],
      [10, cy + 2],
      [19, cy + 2],
    ])
      p.rect(x, y, 2, 2, NAVY[1]);
    p.path([8, cy - 1, 10, cy - 1, 9, cy + 1, 11, cy + 1], NAVY[2]);
    // head
    p.ell(24, cy + 1, 4.5, 4, NAVY, { edge: NAVY[0] });
    p.rect(25, cy - 1, 2, 2, '#fff6b0');
    p.px(25, cy - 1, WHITE);
    p.rect(27, cy + 3, 2, 1, NAVY[0]);
    // antennae with spark bulbs
    p.path([24, cy - 3, 25, cy - 6, 27, cy - 9], NAVY[2]);
    p.path([26, cy - 2, 28, cy - 4, 29, cy - 5], NAVY[2]);
  },
  post: (p, f) => {
    const cy = 17 + f;
    spark(p, 27, cy - 10, f ? '#ffe14a' : '#fff6b0', WHITE, f ? 1 : 0);
    spark(p, 29, cy - 6, f ? '#fff6b0' : '#ffe14a', WHITE, f ? 0 : 1);
    if (f) zap(p, [3, 24, 5, 22, 4, 21, 6, 19], '#ffe14a');
  },
};

const MOSS = ramp('#5f8a3a', 5, 0.085);
const MOUND = ramp('#7a6a52', 4, 0.1);

const mossling: Mon = {
  w: 38,
  h: 38,
  fps: 4,
  draw: (p, f) => {
    const g = ground(38); // 33
    // stubby stone feet
    p.ell(12 - f, g - 1, 4, 2.4, MOUND);
    p.ell(24 + f, g - 1 - f, 4, 2.4, MOUND);
    // club held in the back hand, raised a bit higher on frame 1
    const ca = f ? -2 : 0;
    p.cap(31, 26 + ca, 34, 12 + ca, 1.3, R.wood, 3.2);
    for (const [x, y] of [
      [33, 14 + ca],
      [35, 17 + ca],
      [32, 18 + ca],
    ])
      p.px(x, y, R.wood[0]);
    // shadowed body under the moss
    p.ell(18, 24, 13, 8.5, MOUND);
    p.ell(21, 26.5, 9, 5, ['#2a221a', '#3a3026', '#4a3e30'], { mode: 'flat' });
    // moss mane: drips + cap
    for (const [x, y, r] of [
      [6, 22, 3],
      [10, 24, 3.2],
      [15, 24.5, 2.8],
      [28, 23.5, 3],
      [31, 21, 2.6],
    ])
      p.ell(x, y, r, r * 0.9, MOSS);
    p.ell(18, 15, 14, 8.5, MOSS);
    for (const [x, y] of [
      [10, 13],
      [14, 18],
      [22, 12],
      [26, 17],
      [18, 20],
    ])
      p.on(x, y, MOSS[1]);
    // flower + sprout
    p.line(18, 7, 19, 3, R.leaf[2]);
    p.dots([16, 3, 17, 4, 20, 2, 21, 3], R.leaf[3]);
    p.rect(23, 7, 3, 3, PAL.rose);
    p.px(24, 8, '#ffe46a');
    p.px(23, 7, '#ffc0cc');
    // glowing eyes peeking out + a toothy grin
    p.rect(17, 24, 3, 3, '#f5efb8');
    p.rect(24, 24, 3, 3, '#f5efb8');
    p.rect(18, 25, 1, 2, EYE);
    p.rect(25, 25, 1, 2, EYE);
    p.dots([20, 29, 22, 29, 21, 30], '#e8e0c0');
    // near arm gripping the club
    p.ell(31, 24 + ca, 3, 2.8, MOSS, { edge: MOSS[0] });
  },
};

const MITE = ramp('#7a7090', 4, 0.1);
const CRYST = ['#1a5a64', '#2a9098', '#5cd4cc', '#c8fff6'] as Ramp;

const glowmite: Mon = {
  w: 32,
  h: 32,
  fps: 8,
  draw: (p, f) => {
    const g = ground(32); // 28
    // far legs
    for (const [x, d] of [
      [10, -1],
      [15, 0],
      [20, 1],
    ]) {
      const s = (x === 15 ? f : 1 - f) * 2 - 1;
      p.path([x, 21, x + d * 2 - s, 24, x + d * 2 - s, g], MITE[0]);
    }
    // body + head
    p.ell(14, 20, 8.5, 5, MITE);
    p.ell(24, 21, 4.5, 3.8, MITE, { edge: MITE[0] });
    // mandibles + eyes
    p.path([27, 23, 29, 24, 28, 25], MITE[3]);
    p.rect(25, 19, 2, 2, CRYST[3]);
    p.px(23, 20, CRYST[2]);
    // crystal cluster growing on its back
    p.poly([8, 17, 9, 8, 12, 16], CRYST, { mode: 'bevel', edge: CRYST[0] });
    p.poly([11, 17, 14, 5, 17, 17], CRYST, { mode: 'bevel', edge: CRYST[0] });
    p.poly([16, 17, 20, 9, 21, 17], CRYST, { mode: 'bevel', edge: CRYST[0] });
    p.line(14, 7, 14, 14, CRYST[3]);
    // segment lines
    p.path([10, 23, 18, 23], MITE[1]);
    // near legs
    for (const [x, d] of [
      [11, -1],
      [16, 0],
      [21, 1],
    ]) {
      const s = (x === 16 ? 1 - f : f) * 2 - 1;
      p.path([x, 23, x + d * 2 + s, 25, x + d * 2 + s, g], MITE[2]);
    }
  },
  post: (p, f) => {
    p.px(14, 5, WHITE);
    if (f) spark(p, 21, 7, CRYST[2]);
    else spark(p, 7, 9, CRYST[2], CRYST[3], 0);
  },
};

const CAP = ramp('#9a6cc4', 5, 0.085);
const STEM = ['#9a8468', '#c4b090', '#e6d8b8', '#fbf2dc'] as Ramp;

const gloomcap: Mon = {
  w: 36,
  h: 40,
  fps: 4,
  draw: (p, f) => {
    const g = ground(40); // 35
    // legs
    p.cap(14, g - 4, 13 - f, g - 1, 2.6, STEM);
    p.cap(21, g - 4 - f, 22, g - 1 - f, 2.6, STEM, 2.6, { edge: STEM[1] });
    // stem body
    p.ell(17.5, 25, 7.5, 7, STEM);
    // big cap
    p.shape(1, 3, 34, 22, (x, y) => {
      if (y > 19.5) return false;
      return ((x - 17.5) / 16) ** 2 + ((y - 19.5) / 15) ** 2 <= 1;
    }, CAP);
    // gills shadow + rim
    p.rect(4, 19, 28, 1, CAP[0]);
    for (let x = 6; x < 30; x += 3) p.px(x, 20, CAP[1]);
    // spots
    for (const [x, y, r] of [
      [11, 9, 2.2],
      [20, 7, 1.6],
      [26, 12, 2.2],
      [8, 15, 1.3],
      [17, 13, 1.4],
    ])
      p.ell(x, y, r, r, [STEM[1], STEM[2], STEM[3]], { mode: 'ball' });
    // face in the cap's shadow
    p.eye(17, 22, 2, 3);
    p.eye(22, 22, 2, 3);
    p.rect(19, 27, 2, 1, EYE);
    p.rect(14, 26, 2, 1, PAL.rose);
    // arm holding a lantern with a violet wisp
    const sw = f;
    p.line(26, 26, 29 + sw, 29, STEM[1]);
    p.line(29 + sw, 26, 29 + sw, 29, R.iron[1]);
    p.rect(27 + sw, 29, 5, 6, R.bronze[1]);
    p.rect(28 + sw, 30, 3, 4, f ? '#d8a8ff' : '#b88cf0');
    p.px(28 + sw, 30, WHITE);
    p.rect(27 + sw, 29, 5, 1, R.bronze[3]);
    p.rect(27 + sw, 35, 5, 1, R.bronze[0]);
  },
  post: (p, f) => {
    halo(p, 29.5 + f, 32, 5, '#c89cff', 0.22);
    // drifting spores
    const o = f ? -2 : 0;
    p.dots([5, 25 + o, 3, 21 + o, 31, 8 + o], '#d8b8ff', 0.85);
  },
};

/** Pixel arc (angles in radians, y down). */
function arc(p: Pix, cx: number, cy: number, r: number, a0: number, a1: number, col: string): void {
  const steps = Math.ceil(Math.abs(a1 - a0) * r * 1.6) + 1;
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    p.px(Math.round(cx + Math.cos(a) * r - 0.5), Math.round(cy + Math.sin(a) * r - 0.5), col);
  }
}

/** Mirror flat polygon x-coordinates about a canvas of width w. */
const mirror = (pts: number[], w: number) => pts.map((v, i) => (i % 2 ? v : w - v));

/**
 * Bat/drake wing: [shoulder, wrist, tip1, notch1, tip2, notch2, tip3, hip] as flat x,y pairs. Membrane from
 * `memb`, finger spars + leading edge in `bone`.
 */
function batWing(p: Pix, pts: number[], memb: Ramp, bone: string, edge?: string): void {
  p.poly(pts, memb, { edge });
  const [sx, sy, wx, wy] = pts;
  p.line(sx, sy, wx, wy, bone);
  for (const k of [4, 8, 12]) p.line(wx, wy, pts[k], pts[k + 1], bone);
}

const SHADE = ramp('#5c4c80', 5, 0.085);
const VOID = '#160f22';

/** Short sickle: grip at (x, y), blade curling up and forward. */
function sickle(p: Pix, x: number, y: number, dir = 1): void {
  p.line(x, y + 2, x, y - 1, R.wood[2]);
  p.line(x, y - 2, x + dir, y - 4, R.iron[2]);
  arc(p, x + dir * 3.5, y - 3, 3.5, dir > 0 ? Math.PI : 0, dir > 0 ? Math.PI * 1.9 : -Math.PI * 0.9, R.iron[3]);
  p.px(x + dir * 6, y - 2, R.iron[2]);
}

const hollowshade: Mon = {
  w: 40,
  h: 44,
  pad: [1, 1],
  fps: 5,
  draw: (p, f) => {
    const b = -f;
    // hood tip trailing back
    p.poly([14, 8 + b, 4, 2 + b - f, 7, 9 + b, 13, 14 + b], SHADE);
    // robe with tattered hem (tatters shift between frames)
    const hem = f
      ? [32, 31, 30, 37, 27, 33, 24, 38, 21, 33, 18, 37, 15, 33, 12, 36, 10, 31]
      : [32, 31, 31, 36, 28, 33, 25, 37, 22, 33, 19, 38, 16, 33, 12, 37, 10, 31];
    p.poly([13, 17 + b, 29, 17 + b, ...hem.map((v, i) => (i % 2 ? v + b : v))], SHADE, { mode: 'vert' });
    // hood
    p.ell(21, 13 + b, 9.5, 8.5, SHADE);
    // the dark inside of the hood + glowing eyes
    p.ell(23.5, 14.5 + b, 6, 5.5, [VOID, VOID, '#241a34'], { mode: 'flat' });
    p.rect(21, 13 + b, 2, 3, '#f2ecb0');
    p.rect(26, 13 + b, 2, 3, '#f2ecb0');
    p.px(21, 13 + b, WHITE);
    p.px(26, 13 + b, WHITE);
    // sleeves + sickles (raised on frame 1)
    p.cap(15, 20 + b, 9, 25 + b - f, 2.2, SHADE, 1.8, { edge: SHADE[0] });
    sickle(p, 8, 25 + b - f, -1);
    p.cap(27, 21 + b, 32, 25 + b - f, 2.2, SHADE, 1.8, { edge: SHADE[0] });
    sickle(p, 33, 25 + b - f, 1);
    // pale hands
    p.rect(8, 25 + b - f, 2, 2, '#b8b0d0');
    p.rect(32, 25 + b - f, 2, 2, '#b8b0d0');
    // robe fold lines
    p.path([19, 21 + b, 18, 30 + b], SHADE[1]);
    p.path([25, 22 + b, 26, 31 + b], SHADE[1]);
  },
  post: (p, f) => {
    p.dots(f ? [6, 30, 34, 34, 4, 22] : [5, 33, 35, 31, 3, 25], '#b89cff', 0.7);
  },
};

const SHROUD = ramp('#8c88a8', 5, 0.085);
const MASK = ['#7c7466', '#a8a090', '#cfc8b8', '#efeadc'] as Ramp;

const cairnWraith: Mon = {
  w: 40,
  h: 46,
  pad: [1, 0],
  fps: 4,
  draw: (p, f) => {
    const b = -f;
    // floating cairn stones (behind, left)
    const st = [
      [7, 33 + f, 3.5, 2.4],
      [7.5, 28 - f, 3, 2.2],
      [6.5, 24 + f, 2.4, 1.8],
    ];
    for (const [x, y, rx, ry] of st) p.ell(x, y, rx, ry, R.stone, { edge: R.stone[0] });
    // shroud with tattered hem
    const hem = f
      ? [33, 35, 31, 40, 28, 36, 25, 41, 22, 36, 19, 40, 16, 36, 13, 39, 11, 34]
      : [33, 35, 32, 39, 29, 36, 26, 40, 23, 36, 20, 41, 17, 36, 13, 40, 11, 34];
    p.poly([14, 17 + b, 30, 17 + b, ...hem.map((v, i) => (i % 2 ? v + b : v))], SHROUD, { mode: 'vert' });
    p.path([20, 22 + b, 19, 34 + b], SHROUD[1]);
    p.path([26, 22 + b, 27, 34 + b], SHROUD[1]);
    // hood + stone mask
    p.ell(21.5, 13 + b, 8.5, 8.5, SHROUD);
    p.ell(22, 14 + b, 6.5, 6.5, [VOID, VOID, '#2a2238'], { mode: 'flat' });
    p.ell(24, 14 + b, 4.6, 5.6, MASK, { edge: MASK[0] });
    p.rect(22, 13 + b, 2, 2, VOID);
    p.rect(26, 13 + b, 2, 2, VOID);
    p.px(23, 14 + b, '#c8a0ff');
    p.px(27, 14 + b, '#c8a0ff');
    p.path([24, 10 + b, 25, 11 + b, 24, 12 + b], MASK[0]);
    p.dots([23, 17 + b, 25, 17 + b, 27, 17 + b], MASK[0]);
    // staff + grave lantern
    p.line(33, 41 + b, 33, 7 + b, R.wood[1]);
    p.line(34, 41 + b, 34, 8 + b, R.wood[3]);
    p.path([33, 7 + b, 35, 5 + b, 37, 6 + b, 37, 9 + b], R.wood[2]);
    const lx = 35 - f;
    p.rect(lx, 10 + b, 5, 6, R.bronze[1]);
    p.rect(lx + 1, 11 + b, 3, 4, f ? '#b8f0e8' : '#8ad8d0');
    p.px(lx + 1, 11 + b, WHITE);
    p.rect(lx, 10 + b, 5, 1, R.bronze[3]);
    // bony hand on the staff
    p.cap(27, 21 + b, 32, 24 + b, 2.2, SHROUD, 2, { edge: SHROUD[0] });
    p.rect(32, 23 + b, 3, 2, MASK[2]);
  },
  post: (p, f) => {
    halo(p, 37.5 - f, 13 - f, 4, '#8ad8d0', 0.18);
    p.dots(f ? [4, 19, 11, 26] : [3, 21, 10, 29], '#c8a0ff', 0.7);
  },
};

const ASH = ['#4a4044', '#6e6266', '#958886', '#c0b2a6'] as Ramp;
const EMBERB = ['#5a2418', '#a8301e', '#e0602a', '#ffa23a', '#ffd27a'] as Ramp;

const ashfly: Mon = {
  w: 32,
  h: 32,
  pad: [1, 0],
  fps: 9,
  draw: (p, f) => {
    const b = f;
    const cy = 20 + b;
    // far wing
    if (f === 0) p.poly([14, cy - 3, 11, cy - 15, 4, cy - 15, 2, cy - 9, 9, cy - 1], ASH.slice(0, 3));
    else p.poly([13, cy, 4, cy - 2, 0, cy + 3, 4, cy + 6, 12, cy + 3], ASH.slice(0, 3));
    // glowing ember abdomen with ash bands
    p.ell(9, cy + 2, 7.5, 4.5, EMBERB);
    for (const x of [5, 8, 11]) p.line(x, cy - 2, x - 1, cy + 6, ASH[1]);
    // fuzzy thorax + head
    p.ell(17, cy, 5, 4.8, ASH);
    p.dots([15, cy - 4, 17, cy - 5, 19, cy - 4], ASH[3]);
    p.ell(23.5, cy + 0.5, 4, 3.8, ASH, { edge: ASH[0] });
    p.rect(24, cy - 2, 3, 3, '#e8402a');
    p.px(24, cy - 2, '#ffc0a0');
    p.rect(27, cy + 2, 1, 1, ASH[0]);
    // legs
    for (const x of [15, 18, 21]) p.path([x, cy + 4, x - 1, cy + 7, x, cy + 8], ASH[0]);
    // feathery antennae
    p.path([24, cy - 3, 26, cy - 8, 29, cy - 10], ASH[3]);
    p.dots([26, cy - 9, 28, cy - 10, 27, cy - 7], ASH[2]);
    // near wing with an ember eye-spot and smouldering edge
    if (f === 0) {
      p.poly([16, cy - 3, 15, cy - 17, 22, cy - 19, 27, cy - 13, 21, cy - 2], ASH, { edge: ASH[0] });
      p.rect(19, cy - 13, 4, 4, EMBERB[2]);
      p.rect(20, cy - 12, 2, 2, EMBERB[0]);
      p.path([16, cy - 16, 21, cy - 18, 23, cy - 18], EMBERB[3]);
    } else {
      p.poly([16, cy, 10, cy - 8, 3, cy - 9, 2, cy - 4, 9, cy + 2], ASH, { edge: ASH[0] });
      p.rect(6, cy - 7, 4, 4, EMBERB[2]);
      p.rect(7, cy - 6, 2, 2, EMBERB[0]);
      p.path([3, cy - 8, 9, cy - 9], EMBERB[3]);
    }
  },
  post: (p, f) => {
    const cy = 20 + f;
    p.dots(f ? [1, cy + 5, 3, cy + 8] : [2, cy + 4, 0, cy + 7], EMBERB[3], 0.9);
    p.px(f ? 4 : 2, cy + 9, EMBERB[4], 0.7);
  },
};

const CALF = ramp('#6c7cb0', 5, 0.085);
const VOLT = ['#a87818', '#e8b828', '#ffe14a', '#fff8c0'] as Ramp;

const voltcalf: Mon = {
  w: 42,
  h: 40,
  fps: 5,
  draw: (p, f) => {
    const g = ground(40); // 35
    // tail with a bolt tuft
    p.path([9, 21, 6, 24, 5, 28], CALF[1]);
    p.poly([3, 27, 7, 27, 5, 29, 8, 29, 4, 33, 5, 30, 2, 30], VOLT, { mode: 'flat' });
    // far legs
    p.cap(12 + f, 27, 12 + f * 2, g - 1, 2.2, CALF.slice(0, 4));
    p.cap(25 - f, 27, 25 - f * 2, g - 1, 2.2, CALF.slice(0, 4));
    // body
    p.ell(19, 23, 11.5, 7.5, CALF);
    p.ell(19, 27, 7, 2.5, [CALF[3], CALF[4]], { mode: 'flat' });
    // near legs with hooves
    for (const [x0, x1] of [
      [15, 15 - f * 2],
      [27, 28 + f * 2],
    ]) {
      p.cap(x0, 27, x1, g - 2, 2.4, CALF, 2.4, { edge: CALF[1] });
      p.rect(x1 - 2, g - 1, 5, 2, NAVY[1]);
      p.rect(x1 - 2, g - 1, 5, 1, VOLT[2]);
    }
    p.rect(12 + f * 2 - 2, g - 1, 4, 2, NAVY[0]);
    p.rect(25 - f * 2 - 2, g - 1, 4, 2, NAVY[0]);
    // head
    const hx = 31;
    const hy = 16 + (f ? 1 : 0);
    p.poly([hx - 6, hy - 3, hx - 12, hy, hx - 7, hy + 2], CALF, { mode: 'bevel' }); // droopy ear
    p.ell(hx, hy, 7.5, 7, CALF, { edge: CALF[1] });
    p.ell(hx + 4, hy + 4, 4.5, 3.5, ['#b07888', '#d89aa4', '#f0c0c4', '#ffe0e0'], { edge: CALF[1] });
    p.rect(hx + 5, hy + 3, 1, 2, '#6a3a48');
    p.rect(hx + 7, hy + 3, 1, 2, '#6a3a48');
    // stubby horns + cloud tuft
    p.poly([hx - 4, hy - 5, hx - 6, hy - 10, hx - 2, hy - 6], VOLT, { mode: 'bevel' });
    p.poly([hx + 2, hy - 6, hx + 4, hy - 11, hx + 5, hy - 5], VOLT, { mode: 'bevel' });
    p.ell(hx - 1, hy - 7, 3.5, 2.4, CLOUD, { edge: CLOUD[1] });
    // lightning blaze + eye
    p.path([hx + 1, hy - 4, hx, hy - 2, hx + 2, hy - 2, hx + 1, hy], VOLT[2]);
    p.eye(hx + 3, hy - 2, 2, 3);
    // collar + cowbell (swings)
    p.line(hx - 6, hy + 4, hx - 1, hy + 7, R.leather[2]);
    p.line(hx - 6, hy + 5, hx - 1, hy + 8, R.leather[1]);
    const bx = hx - 3 + (f ? 1 : 0);
    p.poly([bx - 2, hy + 8, bx + 2, hy + 8, bx + 3, hy + 12, bx - 3, hy + 12], R.bronze, { mode: 'bevel', edge: R.bronze[0] });
    p.px(bx, hy + 12, R.iron[1]);
  },
  post: (p, f) => {
    if (f) zap(p, [2, 16, 4, 14, 3, 13, 5, 11], VOLT[2], VOLT[3]);
    else spark(p, 22, 13, VOLT[2], VOLT[3], 1);
  },
};

const MOTHW = ['#8a78b0', '#b4a4d4', '#ddd2ec', '#fbf4ea'] as Ramp;
const MOTHL = ['#6a5a98', '#9484c4', '#b8a8e0', '#dcd0f4'] as Ramp;

const moonmoth: Mon = {
  w: 36,
  h: 34,
  fps: 6,
  draw: (p, f) => {
    const b = f;
    const W = 36;
    const up = f
      ? [17, 15 + b, 4, 8 + b, 1, 13 + b, 3, 20 + b, 10, 21 + b, 16, 19 + b]
      : [17, 14 + b, 6, 3 + b, 1, 6 + b, 2, 14 + b, 9, 18 + b, 16, 18 + b];
    const low = f
      ? [16, 19 + b, 10, 22 + b, 9, 27 + b, 13, 28 + b, 17, 23 + b]
      : [16, 18 + b, 9, 20 + b, 7, 26 + b, 12, 27 + b, 17, 22 + b];
    for (const pts of [low, mirror(low, W)]) p.poly(pts, MOTHL);
    for (const pts of [up, mirror(up, W)]) p.poly(pts, MOTHW);
    // crescent moons on the upper wings
    const my = f ? 14 + b : 10 + b;
    const mx = f ? 7 : 8;
    for (const x of [mx, W - 1 - mx - 2]) {
      p.rect(x, my, 1, 3, R.gold[2]);
      p.px(x + 1, my - 1, R.gold[2]);
      p.px(x + 1, my + 3, R.gold[2]);
      p.px(x + 2, my - 1, R.gold[3]);
    }
    // fuzzy body + collar
    p.ell(18, 20 + b, 3.4, 6.5, ['#a89cc0', '#d8d0e8', '#f4f0fa', '#ffffff']);
    for (let y = 17; y < 26; y += 2) p.on(18, y + b, '#c4b8dc');
    p.ell(18, 13 + b, 5.5, 2.6, ['#c8bca8', '#e8dcc4', '#fbf4e2', '#ffffff']);
    // head + eyes
    p.ell(18, 10 + b, 4, 3.4, MOTHL, { edge: MOTHL[0] });
    p.eye(15, 9 + b, 2, 2);
    p.eye(19, 9 + b, 2, 2);
    // feathery gold antennae
    p.path([16, 7 + b, 14, 4 + b, 12, 1 + b], R.gold[2]);
    p.path([20, 7 + b, 22, 4 + b, 24, 1 + b], R.gold[2]);
    p.dots([13, 4 + b, 15, 2 + b, 23, 4 + b, 21, 2 + b], R.gold[3]);
  },
  post: (p, f) => {
    const pts = f ? [3, 25, 32, 4, 30, 27, 6, 2] : [2, 22, 33, 7, 28, 29, 8, 30];
    for (let i = 0; i < pts.length; i += 2) p.px(pts[i], pts[i + 1], i % 4 ? '#fff6c8' : '#e8dcff', 0.9);
    spark(p, f ? 31 : 4, f ? 17 : 15, '#fff6c8', WHITE, 1);
  },
};

// ---------------------------------------------------------------- Riftmarch, frost, basalt, storm & dusk commons

const IMP = ramp('#7c5cb4', 5, 0.085);
const RIFT = ['#3a8aa8', '#5cc8e0', '#a8f4ff', '#ffffff'] as Ramp;

const riftling: Mon = {
  w: 32,
  h: 32,
  pad: [0, 1],
  fps: 6,
  draw: (p, f) => {
    const g = ground(32); // 28
    const b = -2 * f; // hops
    // tail with a diamond tip
    p.path([10, 23 + b, 6, 21 + b, 4, 17 + b, 5, 14 + b], IMP[1]);
    p.poly([5, 10 + b, 7, 12 + b, 5, 15 + b, 3, 12 + b], RIFT, { mode: 'bevel' });
    // bone fork in the back hand
    p.line(24, 27 + b, 26, 8 + b, R.bone[1]);
    p.line(23, 9 + b, 28, 8 + b, R.bone[2]);
    for (const x of [23, 25.5, 28]) p.line(x, 9 + b, x, 5 + b, R.bone[2]);
    p.dots([23, 5 + b, 26, 4 + b, 28, 5 + b], R.bone[3]);
    // legs (tucked mid-hop)
    p.cap(13, 24 + b, 12 - f, g - 1 + b + f, 1.8, IMP.slice(0, 4));
    p.cap(18, 24 + b, 19 + f, g - 1 + b + f, 1.8, IMP.slice(0, 4));
    // body with a rift crack across the belly
    p.ell(15.5, 21 + b, 6, 4.8, IMP);
    p.path([12, 20 + b, 14, 22 + b, 16, 20 + b, 18, 22 + b], RIFT[2]);
    // horns + ears + head
    p.poly([10, 9 + b, 7, 3 + b, 12, 6 + b], R.bone, { mode: 'bevel' });
    p.poly([19, 7 + b, 22, 2 + b, 23, 8 + b], R.bone, { mode: 'bevel' });
    p.poly([8, 13 + b, 2, 11 + b, 8, 16 + b], IMP);
    p.ell(16, 13 + b, 8, 6.8, IMP, { edge: IMP[1] });
    // face: gleaming eyes, toothy grin
    p.rect(12, 11 + b, 3, 3, '#fff2a0');
    p.rect(18, 11 + b, 3, 3, '#fff2a0');
    p.rect(13, 12 + b, 1, 2, EYE);
    p.rect(19, 12 + b, 1, 2, EYE);
    p.rect(13, 16 + b, 8, 1, EYE);
    p.dots([14, 17 + b, 19, 17 + b], WHITE);
    // arm on the fork
    p.cap(20, 19 + b, 24, 20 + b, 1.6, IMP, 1.6, { edge: IMP[0] });
  },
};

const STALK = ramp('#4c3e70', 5, 0.09);

const riftStalker: Mon = {
  w: 40,
  h: 48,
  fps: 5,
  draw: (p, f) => {
    const g = ground(48); // 42
    const s = f ? 1 : -1;
    // back arm (long, claws dragging)
    p.cap(16, 20, 11, 28, 2.2, STALK.slice(0, 4), 1.8);
    p.cap(11, 28, 9 + s, 35, 1.8, STALK.slice(0, 4), 1.6);
    for (const dx of [-1, 1, 3]) p.line(9 + s + dx, 35, 8 + s + dx, 39, R.steel[1]);
    // back leg (digitigrade)
    p.cap(15, 31, 11 - s, 36, 2.6, STALK.slice(0, 4), 2);
    p.cap(11 - s, 36, 13 - s, g - 1, 1.8, STALK.slice(0, 4), 1.4);
    p.rect(12 - s, g - 1, 4, 1, STALK[0]);
    // spines on the back
    for (const [x, y, h] of [
      [12, 17, 6],
      [16, 13, 7],
      [20, 11, 6],
    ])
      p.poly([x - 2, y + 2, x, y - h, x + 2, y + 2], ['#5a2a8a', '#8a4cd0', '#c08cff'], { mode: 'bevel' });
    // hunched torso
    p.ell(19, 24, 8.5, 9, STALK);
    p.path([16, 20, 18, 24, 16, 28], RIFT[1]);
    p.path([22, 21, 23, 26], RIFT[1]);
    // front leg
    p.cap(22, 31, 26 + s, 36, 2.8, STALK, 2.2, { edge: STALK[0] });
    p.cap(26 + s, 36, 24 + s, g - 1, 2, STALK, 1.6, { edge: STALK[0] });
    p.rect(23 + s, g - 1, 5, 1, STALK[1]);
    // head: long skull plate with one glowing slit
    p.ell(28, 15, 6, 5, STALK, { edge: STALK[0] });
    p.poly([28, 11, 38, 15, 36, 18, 28, 19], R.bone, { mode: 'bevel', edge: R.bone[0] });
    p.rect(30, 14, 5, 1, RIFT[2]);
    p.px(34, 14, WHITE);
    p.dots([33, 18, 35, 18], R.bone[3]);
    // front arm with three blade claws
    p.cap(25, 21, 30, 27 + s, 2.4, STALK, 1.8, { edge: STALK[0] });
    const cx = 31;
    const cy = 28 + s;
    for (const [dx, dy] of [
      [0, 0],
      [2, -1],
      [3, 1],
    ])
      p.line(cx + dx, cy + dy, cx + dx + 4, cy + dy - 6, R.steel[2]);
    p.dots([cx + 4, cy - 6, cx + 6, cy - 7, cx + 7, cy - 5], WHITE);
  },
  post: (p, f) => {
    p.dots(f ? [4, 20, 37, 30] : [5, 23, 38, 27], RIFT[2], 0.8);
  },
};

const ICE = ['#4a6e9c', '#7aa6d0', '#b4dcf2', '#e6f8ff', '#ffffff'] as Ramp;

const frostling: Mon = {
  w: 32,
  h: 32,
  fps: 4,
  draw: (p, f) => {
    const b = -f;
    const cy = 18 + b;
    // icicle spear (behind)
    p.line(25, cy + 9, 26, cy - 9, ICE[1]);
    p.line(26, cy + 9, 27, cy - 9, ICE[3]);
    p.poly([24, cy - 9, 27, cy - 16, 29, cy - 9], ICE, { mode: 'bevel' });
    // crystal crown
    p.poly([10, cy - 4, 9, cy - 11, 13, cy - 5], ICE, { mode: 'bevel' });
    p.poly([13, cy - 5, 16, cy - 14, 19, cy - 5], ICE, { mode: 'bevel' });
    p.poly([19, cy - 5, 23, cy - 10, 22, cy - 3], ICE, { mode: 'bevel' });
    // snowball body
    p.ell(16, cy + 1, 8, 7.5, ICE);
    // knitted scarf, tail flapping back
    p.rect(9, cy + 3, 14, 2, R.cloth[2]);
    p.rect(9, cy + 3, 14, 1, R.cloth[3]);
    for (let x = 10; x < 23; x += 3) p.px(x, cy + 4, R.cloth[1]);
    p.poly([10, cy + 4, 5, cy + 6 + f, 4, cy + 8 + f, 9, cy + 6], R.cloth, { mode: 'bevel' });
    // face
    p.eye(14, cy - 2, 2, 3, '#1a2a4a');
    p.eye(19, cy - 2, 2, 3, '#1a2a4a');
    p.rect(16, cy + 1, 2, 1, '#1a2a4a');
    p.rect(11, cy + 1, 2, 1, PAL.rose);
    // nub arm on the spear
    p.ell(24, cy + 1, 2, 2, ICE, { edge: ICE[0] });
  },
  post: (p, f) => {
    spark(p, f ? 5 : 7, f ? 9 : 12, ICE[3], WHITE, 1);
    p.dots(f ? [28, 26, 3, 20] : [29, 22, 4, 24], ICE[3], 0.8);
  },
};

/** Shared four-legged canine body (rimefang, duskhound): returns head anchor. */
function canine(p: Pix, f: number, fur: Ramp, opts: { ruff: Ramp; eye: string; snout?: number }): { hx: number; hy: number } {
  const sn = opts.snout ?? 0;
  const g = ground(40); // 35
  // far legs
  p.cap(13 + f, 26, 12 + f * 2, g - 2, 2.6, fur.slice(0, 4), 2.4);
  p.cap(28 - f, 26, 29 - f * 2, g - 2, 2.6, fur.slice(0, 4), 2.4);
  p.rect(10 + f * 2, g - 1, 5, 2, fur[0]);
  p.rect(27 - f * 2, g - 1, 5, 2, fur[0]);
  // body
  p.ell(20, 23, 11.5, 7, fur);
  // near legs + paws
  for (const [x0, x1] of [
    [16 - f, 15 - f * 2],
    [30 + f, 31 + f * 2],
  ]) {
    p.cap(x0, 26, x1, g - 2, 2.9, fur, 2.6, { edge: fur[1] });
    p.rect(x1 - 2, g - 1, 6, 2, fur[2]);
    p.rect(x1 - 2, g, 6, 1, fur[1]);
  }
  // neck ruff
  for (const [x, y, r] of [
    [27, 18, 4],
    [28, 23, 3.6],
    [25, 21, 3.4],
  ])
    p.ell(x, y, r, r, opts.ruff, { edge: opts.ruff[0] });
  // head + muzzle
  const hx = 31;
  const hy = 15 + (f ? 1 : 0);
  p.poly([hx - 6, hy - 3, hx - 6, hy - 11 - sn, hx - 1, hy - 5], fur, { mode: 'bevel' });
  p.poly([hx - 1, hy - 5, hx + 1, hy - 11 - sn, hx + 4, hy - 3], fur, { mode: 'bevel' });
  p.ell(hx, hy, 7, 6, fur, { edge: fur[1] });
  p.poly([hx + 3, hy - 1, hx + 11 + sn, hy + 1, hx + 11 + sn, hy + 5, hx + 2, hy + 6], fur, { mode: 'bevel', edge: fur[1] });
  p.rect(hx + 10 + sn, hy, 2, 2, EYE);
  p.line(hx + 4, hy + 4, hx + 10 + sn, hy + 4, fur[0]);
  // fierce eye + brow
  p.rect(hx + 1, hy - 2, 3, 2, opts.eye);
  p.px(hx + 3, hy - 2, WHITE);
  p.line(hx, hy - 3, hx + 4, hy - 4, fur[0]);
  return { hx, hy };
}

const FROSTFUR = ramp('#b0c4dc', 5, 0.08);

const rimefang: Mon = {
  w: 44,
  h: 40,
  pad: [1, 0],
  fps: 6,
  draw: (p, f) => {
    // bushy tail
    p.poly([11, 21, 4, 15 - f, 2, 9 - f, 7, 11, 13, 17], FROSTFUR);
    p.poly([4, 13 - f, 2, 9 - f, 5, 10 - f], ICE.slice(2), { mode: 'flat' });
    const { hx, hy } = canine(p, f, FROSTFUR, { ruff: ['#8aa0bc', '#c4d4e6', '#eaf2fa', '#ffffff'], eye: '#3aa0e0' });
    // ice spikes along the spine, swept back
    for (const [x, h] of [
      [12, 4],
      [16, 6],
      [21, 6],
    ])
      p.poly([x - 2, 18, x - 3, 17 - h, x + 2, 17], ICE, { mode: 'bevel', edge: ICE[0] });
    // icicle fangs
    p.dots([hx + 5, hy + 5, hx + 5, hy + 6, hx + 5, hy + 7, hx + 8, hy + 5, hx + 8, hy + 6], ICE[4]);
    // collar with a frost-rune tag
    p.rect(hx - 4, hy + 6, 3, 3, ICE[2]);
    p.px(hx - 3, hy + 7, ICE[0]);
    p.px(hx - 3, hy + 5, R.leather[1]);
  },
  post: (p, f) => {
    p.dots(f ? [42, 22, 43, 24] : [42, 23], '#e6f8ff', 0.7);
  },
};

const BASALT = ['#1c181c', '#2e282c', '#463e42', '#625858', '#86787a'] as Ramp;
const LAVA = ['#8a1e10', '#e0501e', '#ff9a2a', '#ffe070'] as Ramp;

const basaltCrawler: Mon = {
  w: 44,
  h: 36,
  fps: 7,
  draw: (p, f) => {
    const g = ground(36); // 31
    // far legs
    for (const [x, k] of [
      [12, 0],
      [18, 1],
      [24, 0],
    ]) {
      const s = (k ^ f) * 2 - 1;
      p.path([x, 24, x - 3 + s, 27, x - 4 + s, g], BASALT[1]);
    }
    // body dome
    p.ell(20, 21, 13, 7.5, BASALT);
    // basalt plates (hexes) + lava seams
    const PLATE = [BASALT[1], BASALT[2], BASALT[3], BASALT[4]];
    p.poly([9, 19, 12, 15, 18, 14, 19, 19], PLATE, { mode: 'bevel', edge: BASALT[0] });
    p.poly([20, 19, 20, 14, 26, 14, 30, 19], PLATE, { mode: 'bevel', edge: BASALT[0] });
    p.poly([13, 14, 16, 11, 23, 11, 24, 14], PLATE, { mode: 'bevel', edge: BASALT[0] });
    p.path([9, 21, 12, 20, 18, 21, 22, 20, 29, 21, 31, 23], f ? LAVA[3] : LAVA[2]);
    p.path([14, 24, 17, 23], LAVA[1]);
    // chimney vent
    p.rect(25, 7, 4, 6, BASALT[2]);
    p.rect(25, 7, 1, 6, BASALT[4]);
    p.rect(24, 6, 6, 2, BASALT[3]);
    p.rect(26, 8, 2, 1, LAVA[2]);
    // near legs
    for (const [x, k] of [
      [14, 1],
      [20, 0],
      [26, 1],
    ]) {
      const s = (k ^ f) * 2 - 1;
      p.path([x, 26, x + 2 + s, 28, x + 3 + s, g], BASALT[3]);
      p.px(x + 3 + s, g, BASALT[2]);
    }
    // eye stalks
    p.line(30, 17, 31, 12, BASALT[2]);
    p.line(34, 18, 35, 13, BASALT[2]);
    p.rect(30, 11, 2, 2, LAVA[3]);
    p.rect(34, 12, 2, 2, LAVA[3]);
    // pincer
    p.cap(31, 22, 35, 21, 2, BASALT, 2, { edge: BASALT[0] });
    p.poly([35, 17, 42, 16, 43, 19, 38, 20, 42, 22, 41, 25, 35, 24], BASALT, { mode: 'bevel', edge: BASALT[0] });
    p.px(41, 17, LAVA[2]);
  },
  post: (p, f) => {
    const sm = '#a89a98';
    if (f) p.dots([27, 4, 28, 3, 26, 2, 27, 1], sm, 0.75);
    else p.dots([26, 4, 27, 3, 28, 1], sm, 0.75);
  },
};

const TOAD = ['#2a2228', '#40343a', '#5a4a4e', '#7a6466', '#9a8480'] as Ramp;
const BELLY = ['#a0502a', '#d0803a', '#f0b060', '#ffe0a0'] as Ramp;

const cinderToad: Mon = {
  w: 32,
  h: 32,
  fps: 3,
  draw: (p, f) => {
    const g = ground(32); // 28
    // hind leg
    p.ell(8, g - 3, 4.5, 3.5, TOAD);
    p.rect(3, g - 1, 7, 2, TOAD[2]);
    // squat body
    p.ell(15, g - 7, 11, 7.5 - f * 0.5, TOAD);
    // cream-orange belly + throat sac (puffs on frame 1)
    p.ell(18, g - 3, 7, 3.2, BELLY, { edge: TOAD[1] });
    if (f) p.ell(22, g - 4, 4.6, 3.8, BELLY, { edge: TOAD[1] });
    // magma warts
    for (const [x, y] of [
      [8, g - 11],
      [13, g - 13],
      [11, g - 8],
      [6, g - 7],
    ])
      p.ell(x + 0.5, y + f + 0.5, 1.4, 1.2, [LAVA[1], LAVA[2], LAVA[3]], { mode: 'flat' });
    p.dots([8, g - 12 + f, 13, g - 14 + f], LAVA[3]);
    // front leg
    p.cap(23, g - 4, 24, g - 1, 1.8, TOAD, 1.8, { edge: TOAD[0] });
    p.rect(22, g, 5, 1, TOAD[3]);
    // eye bumps with big golden eyes
    for (const [x, y] of [
      [17, g - 14],
      [23, g - 13],
    ]) {
      p.ell(x + 1.5, y + 1.5 + f, 3.2, 3, TOAD, { edge: TOAD[0] });
      p.rect(x, y + f, 3, 3, '#ffc848');
      p.rect(x, y + 1 + f, 3, 1, EYE);
      p.px(x, y + f, '#fff0b0');
      p.rect(x, y - 1 + f, 3, 1, TOAD[4]);
    }
    // wide smug mouth
    p.path([17, g - 8, 22, g - 8, 27, g - 10], TOAD[0]);
    p.px(27, g - 11, TOAD[0]);
  },
  post: (p, f) => {
    p.dots(f ? [11, 9, 12, 7] : [10, 10, 9, 8], '#a89a98', 0.7);
    p.px(f ? 13 : 10, 5, LAVA[2], 0.8);
  },
};

const STORMB = ramp('#5a6e9c', 5, 0.085);

const cloudray: Mon = {
  w: 44,
  h: 40,
  pad: [1, 0],
  fps: 5,
  draw: (p, f) => {
    const b = f;
    const cy = 21 + b;
    // tail with a bolt tip
    p.path([14, cy + 3, 9, cy + 7, 5, cy + 9], STORMB[1]);
    p.poly([1, cy + 8, 5, cy + 6, 4, cy + 9, 7, cy + 9, 2, cy + 14, 3, cy + 11, 0, cy + 11], VOLT, { mode: 'flat' });
    // wings
    const wl = f ? [16, cy - 2, 4, cy + 4, 1, cy + 8, 9, cy + 7, 16, cy + 4] : [16, cy - 2, 5, cy - 9, 1, cy - 8, 6, cy + 2, 16, cy + 4];
    const wr = f ? [28, cy - 2, 40, cy + 4, 43, cy + 8, 35, cy + 7, 28, cy + 4] : [28, cy - 2, 39, cy - 9, 43, cy - 8, 38, cy + 2, 28, cy + 4];
    p.poly(wl, STORMB);
    p.poly(wr, STORMB);
    // body
    p.ell(22, cy, 8, 5.5, STORMB);
    p.ell(22, cy + 2, 5.5, 2.5, [STORMB[3], STORMB[4]], { mode: 'flat' });
    // cloud puffs along the leading edges
    const puffs = f
      ? [
          [8, cy + 1, 2.4],
          [13, cy - 2, 2.8],
          [19, cy - 5, 3],
          [25, cy - 5, 3],
          [31, cy - 2, 2.8],
          [36, cy + 1, 2.4],
        ]
      : [
          [6, cy - 6, 2.4],
          [11, cy - 4, 2.8],
          [17, cy - 5, 3],
          [27, cy - 5, 3],
          [33, cy - 4, 2.8],
          [38, cy - 6, 2.4],
        ];
    for (const [x, y, r] of puffs) p.ell(x, y, r, r * 0.85, CLOUD, { edge: CLOUD[1] });
    // face
    p.eye(23, cy - 1, 2, 2);
    p.eye(28, cy - 1, 2, 2);
    p.path([24, cy + 2, 25, cy + 3, 27, cy + 3, 28, cy + 2], NAVY[1]);
  },
  post: (p, f) => {
    if (f) zap(p, [40, 30, 38, 33, 40, 33, 38, 37], VOLT[2], VOLT[3]);
    else spark(p, 40, 30, VOLT[2], VOLT[3], 1);
  },
};

const WYRM = ramp('#3e5aa8', 5, 0.09);
const MEMB = ['#b08a1a', '#e0b830', '#ffe060', '#fff4b0'] as Ramp;
const WEB = ['#4a64a0', '#6a88c4', '#94b0e0', '#c4d8f6'] as Ramp;

const thunderwing: Mon = {
  w: 44,
  h: 40,
  pad: [1, 0],
  fps: 7,
  draw: (p, f) => {
    const b = f;
    // tail with a bolt fin
    p.cap(14, 25 + b, 6, 29 + b, 2, WYRM, 1);
    p.poly([1, 27 + b, 5, 26 + b, 4, 29 + b, 7, 29 + b, 2, 34 + b, 3, 30 + b, 0, 30 + b], MEMB, { mode: 'flat' });
    // far wing
    if (f === 0) batWing(p, [18, 19, 17, 8, 10, 2, 11, 7, 5, 6, 8, 10, 6, 13, 13, 17], WEB.slice(0, 3), MEMB[1]);
    else batWing(p, [18, 22, 13, 27, 6, 31, 9, 31, 5, 35, 11, 33, 10, 36, 15, 27], WEB.slice(0, 3), MEMB[1]);
    // body + legs
    p.ell(19, 24 + b, 7, 5, WYRM);
    p.ell(20, 26 + b, 4.5, 2.2, [WYRM[3], WYRM[4]], { mode: 'flat' });
    p.path([16, 28 + b, 15, 31 + b, 17, 32 + b], WYRM[1]);
    p.path([22, 28 + b, 22, 31 + b, 24, 32 + b], WYRM[2]);
    // neck + head
    p.cap(23, 22 + b, 29, 15 + b, 3, WYRM, 2.5);
    p.ell(31, 14 + b, 5, 4, WYRM, { edge: WYRM[1] });
    p.poly([33, 12 + b, 40, 14 + b, 39, 17 + b, 33, 17 + b], WYRM, { mode: 'bevel', edge: WYRM[1] });
    p.poly([28, 11 + b, 23, 6 + b, 30, 9 + b], MEMB, { mode: 'bevel' });
    p.rect(31, 12 + b, 2, 2, MEMB[3]);
    p.px(32, 12 + b, EYE);
    p.dots([37, 14 + b, 34, 16 + b, 36, 16 + b], WYRM[0]);
    // near wing with bone spars
    if (f === 0) batWing(p, [21, 20, 25, 8, 33, 2, 28, 8, 22, 1, 19, 8, 12, 6, 16, 19], WEB, MEMB[2], WEB[0]);
    else batWing(p, [21, 22, 27, 27, 35, 33, 30, 32, 28, 37, 24, 33, 19, 37, 17, 27], WEB, MEMB[2], WEB[0]);
  },
  post: (p, f) => {
    if (f) spark(p, 6, 12, MEMB[2], WHITE, 1);
    else zap(p, [38, 25, 40, 27, 38, 28, 40, 31], MEMB[2]);
  },
};

const DUSK = ramp('#6a4c9c', 5, 0.085);
const DUSKB = ['#a0504a', '#d07a5a', '#f0a87a', '#ffd8a8'] as Ramp;

const duskhound: Mon = {
  w: 44,
  h: 40,
  pad: [1, 0],
  fps: 6,
  draw: (p, f) => {
    // bushy tail with a sunset tip
    p.cap(10, 20, 5, 13 - f, 2.6, DUSK, 3);
    p.ell(4.5, 11 - f, 3, 2.6, DUSKB);
    const { hx, hy } = canine(p, f, DUSK, { ruff: DUSKB, eye: '#ffc04a', snout: 1 });
    // star speckles on the back
    p.dots([13, 19, 17, 17, 21, 18, 15, 21, 11, 22], '#f6e8b0');
    p.dots([16, 19, 12, 24], '#fffbe0');
    // ear tips glow + a fang
    p.px(hx - 5, hy - 10, DUSKB[2]);
    p.px(hx + 1, hy - 10, DUSKB[2]);
    p.dots([hx + 7, hy + 5, hx + 7, hy + 6], WHITE);
    // spiked collar
    p.line(hx - 6, hy + 4, hx - 2, hy + 7, R.leather[1]);
    p.dots([hx - 6, hy + 3, hx - 4, hy + 5, hx - 2, hy + 6], R.steel[3]);
  },
};

const GLOAM = ramp('#7a4aa0', 5, 0.085);
const POT = ['#6a2e1e', '#9a4a2a', '#c06a3a', '#e09a5a'] as Ramp;

const gloamthorn: Mon = {
  w: 40,
  h: 44,
  fps: 4,
  draw: (p, f) => {
    const g = ground(44); // 39
    const sw = f; // sway
    // vine stalk curving up to the bulb
    p.cap(20, 33, 18, 25, 2.6, R.leaf, 2.4);
    p.cap(18, 25, 21 + sw, 17, 2.4, R.leaf, 2.2);
    // thorns
    for (const [x, y, d] of [
      [16, 29, -1],
      [21, 26, 1],
      [17, 22, -1],
    ])
      p.poly([x, y, x + d * 4, y - 2, x, y - 2], ['#5a2a3a', '#8a3a4a', '#c06070'], { mode: 'flat' });
    // leaves
    p.poly([18, 29, 9, 25 - sw, 6, 27 - sw, 11, 30], R.leaf);
    p.poly([21, 27, 29, 22 + sw, 33, 23 + sw, 27, 28], R.leaf);
    // petal collar behind the bulb (dusk orange)
    for (const [x, y] of [
      [12 + sw, 9],
      [14 + sw, 3],
      [30 + sw, 4],
      [32 + sw, 11],
    ])
      p.poly([21 + sw, 11, x - 2, y, x + 2, y], DUSKB, { mode: 'bevel' });
    // the bulb head
    const hx = 22 + sw;
    const hy = 11;
    p.ell(hx, hy, 9, 8, GLOAM, { edge: GLOAM[1] });
    if (f === 0) {
      // closed maw with interlocking teeth
      p.path([hx - 2, hy + 3, hx + 8, hy + 2], GLOAM[0]);
      p.dots([hx, hy + 4, hx + 2, hy + 2, hx + 4, hy + 4, hx + 6, hy + 2], WHITE);
    } else {
      // open maw, glowing inside
      p.poly([hx - 3, hy + 2, hx + 9, hy - 1, hx + 9, hy + 6, hx - 2, hy + 4], ['#c0401e', '#ff8a2a', '#ffd070'], { mode: 'vert' });
      p.dots([hx, hy + 1, hx + 3, hy, hx + 6, hy, hx + 1, hy + 4, hx + 4, hy + 5, hx + 7, hy + 5], WHITE);
    }
    // eyes above the maw
    p.rect(hx + 1, hy - 4, 2, 2, '#ffc04a');
    p.rect(hx + 5, hy - 4, 2, 2, '#ffc04a');
    p.px(hx + 1, hy - 4, WHITE);
    p.px(hx + 5, hy - 4, WHITE);
    // cracked clay pot it grows from
    p.poly([11, 31, 30, 31, 28, g + 1, 13, g + 1], POT, { mode: 'bevel', edge: POT[0] });
    p.rect(10, 30, 21, 3, POT[2]);
    p.rect(10, 30, 21, 1, POT[3]);
    p.path([24, 33, 23, 35, 25, 37], POT[0]);
    p.dots([15, 35, 16, 35], POT[3]);
  },
  post: (p, f) => {
    if (f) p.dots([33, 16, 35, 14], '#ffd070', 0.8);
  },
};

// ---------------------------------------------------------------- elites (L, 64 px)

const YAK = ramp('#c2d2e6', 5, 0.075);

const glacierMatron: Mon = {
  w: 64,
  h: 60,
  fps: 4,
  draw: (p, f) => {
    const g = ground(60); // 53
    const hb = f; // head bob
    // short tail
    p.ell(7, 33, 3, 2.5, YAK);
    // far legs
    p.cap(19 + f, 40, 18 + f, g - 4, 4.2, YAK.slice(0, 4), 4.4);
    p.cap(40 - f, 40, 41 - f, g - 4, 4.2, YAK.slice(0, 4), 4.4);
    // huge shaggy body
    p.ell(28, 33, 21.5, 14, YAK);
    // shaggy fringe hanging under the belly
    for (let x = 10; x <= 46; x += 3) p.poly([x - 2, 40, x + 2, 40, x, 46 + ((x >> 1) % 2)], YAK.slice(0, 4), { mode: 'flat' });
    // glacier on the back
    p.poly([10, 22, 14, 9, 19, 21], ICE, { mode: 'bevel', edge: ICE[0] });
    p.poly([16, 21, 23, 3, 29, 20], ICE, { mode: 'bevel', edge: ICE[0] });
    p.poly([26, 20, 33, 6, 37, 21], ICE, { mode: 'bevel', edge: ICE[0] });
    p.poly([34, 22, 40, 13, 43, 24], ICE, { mode: 'bevel', edge: ICE[0] });
    p.line(23, 5, 22, 16, ICE[4]);
    p.line(33, 8, 32, 16, ICE[4]);
    // fur tufts
    for (const [x, y] of [
      [14, 30],
      [22, 34],
      [31, 30],
      [18, 38],
    ])
      p.path([x, y, x + 2, y + 2, x + 4, y], YAK[2]);
    // near legs with paws
    for (const [x, d] of [
      [24, -f],
      [45, f],
    ]) {
      p.cap(x, 40, x + d, g - 5, 4.8, YAK, 5, { edge: YAK[1] });
      p.rect(x + d - 5, g - 1, 10, 2, YAK[1]);
      p.dots([x + d - 3, g - 1, x + d, g - 1, x + d + 3, g - 1], '#5a6a80');
    }
    // head, low and forward
    const hx = 51;
    const hy = 31 + hb;
    p.ell(hx - 7, hy - 6, 3, 2.6, YAK); // ear
    p.ell(hx, hy, 9.5, 8.5, YAK, { edge: YAK[1] });
    p.ell(hx + 6, hy + 4, 5.5, 4.2, ['#7a8ea8', '#a4b6cc', '#ccdae8', '#eef4fa'], { edge: YAK[1] });
    p.rect(hx + 9, hy + 2, 2, 2, '#3a4a60');
    // calm eye with a frosty lash
    p.rect(hx + 1, hy - 3, 3, 2, '#2a3a58');
    p.px(hx + 1, hy - 3, WHITE);
    p.line(hx, hy - 4, hx + 4, hy - 5, YAK[0]);
    // icicle tusks
    p.poly([hx + 4, hy + 7, hx + 7, hy + 7, hx + 5, hy + 12], ICE, { mode: 'bevel' });
    p.poly([hx + 8, hy + 7, hx + 10, hy + 7, hx + 9, hy + 11], ICE, { mode: 'bevel' });
    // bone + crystal necklace
    p.path([hx - 8, hy + 2, hx - 5, hy + 7, hx, hy + 9], R.leather[1]);
    p.dots([hx - 7, hy + 5, hx - 3, hy + 9], R.bone[3]);
    p.dots([hx - 7, hy + 6, hx - 3, hy + 10], R.bone[2]);
    p.poly([hx - 6, hy + 8, hx - 4, hy + 8, hx - 5, hy + 13], ICE, { mode: 'bevel', edge: ICE[0] });
  },
  post: (p, f) => {
    if (f) {
      p.dots([62, 36, 63, 34, 61, 33, 62, 31], '#eef8ff', 0.75);
      spark(p, 12, 6, ICE[3], WHITE, 1);
    } else spark(p, 40, 10, ICE[3], WHITE, 1);
  },
};

const OBS = ['#1a1418', '#2c2228', '#433438', '#5e4a4a', '#7e6460'] as Ramp;

const magmaBrute: Mon = {
  w: 64,
  h: 60,
  fps: 4,
  draw: (p, f) => {
    const g = ground(60); // 53
    const b = f;
    // basalt slab club in the back hand (raised on frame 1)
    const cu = f ? -3 : 0;
    p.poly([5, 44 + cu, 10, 44 + cu, 14, 14 + cu, 6, 12 + cu, 1, 16 + cu], OBS, { mode: 'bevel', edge: OBS[0] });
    p.path([6, 18 + cu, 8, 24 + cu, 7, 30 + cu], LAVA[1]);
    p.path([10, 16 + cu, 11, 21 + cu], LAVA[2]);
    // legs
    p.cap(24, 44, 22 - f, g - 5, 5.5, OBS, 5.5);
    p.cap(39, 44 - f, 41, g - 5 - f, 5.5, OBS, 5.5, { edge: OBS[0] });
    p.rect(16 - f, g - 2, 12, 3, OBS[2]);
    p.rect(35, g - 2 - f, 12, 3, OBS[2]);
    p.rect(16 - f, g - 2, 12, 1, OBS[4]);
    p.rect(35, g - 2 - f, 12, 1, OBS[4]);
    // back arm
    p.cap(15, 27 + b, 10, 38 + b, 5, OBS, 4.5);
    p.ell(9, 41 + b + cu / 3, 5.5, 5, OBS);
    // torso
    p.ell(31, 32 + b, 16.5, 13, OBS);
    // lava cracks + molten core
    p.path([18, 27 + b, 22, 31 + b, 20, 36 + b, 24, 40 + b], f ? LAVA[3] : LAVA[2]);
    p.path([42, 27 + b, 39, 32 + b, 43, 37 + b], f ? LAVA[3] : LAVA[2]);
    p.path([28, 42 + b, 31, 44 + b, 34, 42 + b], LAVA[1]);
    p.ell(31, 33 + b, 4.5, 4.5, LAVA, { edge: OBS[0] });
    p.dots([30, 31 + b, 29, 32 + b], WHITE);
    // shoulders with obsidian spikes
    for (const [x, d] of [
      [16, -1],
      [46, 1],
    ]) {
      p.poly([x - 3, 22 + b, x + d * 3, 12 + b, x + 3, 22 + b], OBS, { mode: 'bevel', edge: OBS[0] });
      p.ell(x, 25 + b, 7.5, 6, OBS, { edge: OBS[0] });
    }
    // small head sunk between the shoulders, with horns
    p.poly([25, 16 + b, 22, 6 + b, 28, 13 + b], R.bone, { mode: 'bevel' });
    p.poly([38, 13 + b, 44, 6 + b, 41, 16 + b], R.bone, { mode: 'bevel' });
    p.ell(32, 17 + b, 7.5, 6.5, OBS, { edge: OBS[0] });
    p.rect(27, 15 + b, 12, 2, OBS[0]);
    p.rect(29, 16 + b, 3, 2, LAVA[3]);
    p.rect(35, 16 + b, 3, 2, LAVA[3]);
    p.path([29, 21 + b, 35, 21 + b], LAVA[1]);
    // near arm: huge molten fist
    p.cap(47, 28 + b, 52, 38 + b, 5, OBS, 4.5, { edge: OBS[0] });
    p.ell(53, 42 + b, 7, 6.5, OBS, { edge: OBS[0] });
    p.path([49, 40 + b, 52, 43 + b, 56, 41 + b, 58, 44 + b], LAVA[2]);
    p.dots([50, 45 + b, 54, 47 + b, 57, 46 + b], LAVA[3]);
  },
  post: (p, f) => {
    halo(p, 31, 33 + f, 7, '#ff9a2a', 0.12);
    p.dots(f ? [58, 52, 60, 49] : [57, 50, 59, 53], LAVA[2], 0.9);
    p.dots(f ? [27, 4, 29, 2] : [28, 5, 26, 3], '#a89a98', 0.6);
  },
};

const DRAKE = ramp('#4a64a8', 5, 0.09);
const STORMM = ['#4a5878', '#6a7a9c', '#94a4c0', '#c4d0e2'] as Ramp;

const tempestDrake: Mon = {
  w: 64,
  h: 60,
  pad: [1, 0],
  fps: 6,
  draw: (p, f) => {
    const b = f * 2;
    // tail with a bolt fin
    p.cap(22, 38 + b, 11, 44 + b, 3.5, DRAKE, 2.4);
    p.cap(11, 44 + b, 4, 38 + b, 2.4, DRAKE, 1.4);
    p.poly([0, 32 + b, 5, 31 + b, 4, 35 + b, 8, 35 + b, 2, 42 + b, 3, 37 + b, 0, 37 + b], VOLT, { mode: 'flat' });
    // far wing
    if (f === 0) batWing(p, [27, 29, 25, 12, 16, 3, 16, 10, 8, 8, 11, 14, 5, 17, 20, 27], STORMM.slice(0, 3), DRAKE[0]);
    else batWing(p, [27, 34, 20, 42, 10, 50, 15, 49, 9, 56, 18, 52, 17, 57, 24, 42], STORMM.slice(0, 3), DRAKE[0]);
    // body + belly
    p.ell(30, 35 + b, 11.5, 8, DRAKE);
    p.ell(31, 39 + b, 8, 3, ['#8a7a5a', '#c8b488', '#e6d6a8'], { mode: 'flat' });
    for (let x = 25; x < 38; x += 3) p.px(x, 39 + b, '#a8946a');
    // legs (tucked claws)
    p.cap(26, 41 + b, 25, 47 + b, 2.6, DRAKE.slice(0, 4), 2);
    p.cap(35, 41 + b, 36, 47 + b, 2.8, DRAKE, 2.2, { edge: DRAKE[0] });
    p.dots([24, 48 + b, 26, 48 + b, 35, 48 + b, 37, 48 + b], R.bone[3]);
    // neck + cloud mane
    p.cap(37, 31 + b, 46, 20 + b, 5, DRAKE, 4);
    for (const [x, y, r] of [
      [34, 27, 3.4],
      [38, 22, 3.4],
      [42, 17, 3],
      [45, 13, 2.6],
    ])
      p.ell(x, y + b, r, r * 0.9, CLOUD, { edge: CLOUD[1] });
    // head + snout + horns
    p.ell(50, 17 + b, 6.5, 5.5, DRAKE, { edge: DRAKE[1] });
    p.poly([52, 14 + b, 62, 17 + b, 61, 21 + b, 52, 22 + b], DRAKE, { mode: 'bevel', edge: DRAKE[1] });
    p.line(54, 21 + b, 60, 20 + b, DRAKE[0]);
    p.dots([59, 17 + b, 61, 18 + b], DRAKE[0]);
    p.poly([46, 13 + b, 39, 5 + b, 41, 4 + b, 48, 11 + b], VOLT, { mode: 'bevel', edge: VOLT[0] });
    p.poly([50, 12 + b, 47, 2 + b, 50, 2 + b, 52, 11 + b], VOLT, { mode: 'bevel', edge: VOLT[0] });
    p.rect(51, 15 + b, 3, 2, VOLT[3]);
    p.px(53, 15 + b, EYE);
    p.dots([56, 22 + b, 58, 22 + b], WHITE);
    // near wing: storm-cloud membrane with lightning veins
    if (f === 0) {
      batWing(p, [31, 30, 37, 12, 49, 2, 42, 11, 33, 1, 29, 11, 19, 7, 25, 27], STORMM, DRAKE[1], STORMM[0]);
      zap(p, [41, 7, 39, 10, 41, 10, 39, 13], VOLT[2]);
    } else {
      batWing(p, [31, 33, 40, 41, 51, 52, 44, 50, 41, 58, 36, 51, 28, 56, 26, 42], STORMM, DRAKE[1], STORMM[0]);
      zap(p, [43, 45, 41, 47, 43, 48, 41, 50], VOLT[2]);
    }
  },
  post: (p, f) => {
    if (f) zap(p, [58, 30, 61, 33, 58, 34, 61, 38], VOLT[2], VOLT[3]);
    else spark(p, 58, 34, VOLT[2], VOLT[3], 1);
  },
};

const FIEND = ramp('#8a6cb8', 5, 0.085);
const ROBE = ramp('#4c3270', 5, 0.08);
const SUN = ['#a04a1a', '#e07a2a', '#ffb44a', '#ffe48a'] as Ramp;

const duskSovereign: Mon = {
  w: 64,
  h: 60,
  pad: [0, 2],
  fps: 4,
  draw: (p, f) => {
    const b = -f;
    // broken sun-disk halo behind the head
    const hx = 31;
    const hy = 16 + b;
    for (let r = 11; r <= 12; r++) arc(p, hx + 0.5, hy + 0.5, r, Math.PI * 0.95, Math.PI * 2.35, r === 11 ? SUN[2] : SUN[1]);
    for (const a of [1.1, 1.35, 1.6, 1.85, 2.1, 2.3].map((k) => k * Math.PI)) {
      const x = hx + Math.cos(a) * 14;
      const y = hy + Math.sin(a) * 14;
      p.px(x, y, SUN[3]);
    }
    // cape (sunset lining) behind the robe
    const ct = f ? [12, 53, 16, 49, 20, 53] : [11, 52, 15, 49, 19, 53];
    p.poly([22, 22 + b, 42, 22 + b, 52, 52, 47, 49, 44, 53, 23, 53, ...ct, 9, 47], SUN, { mode: 'vert' });
    // floating robe, hem fading into tatters
    const hem = f ? [43, 46, 40, 52, 36, 47, 32, 52, 28, 47, 24, 51, 21, 46] : [43, 47, 40, 51, 36, 48, 32, 53, 28, 48, 24, 52, 21, 47];
    p.poly([24, 22 + b, 40, 22 + b, ...hem.map((v, i) => (i % 2 ? v + b : v))], ROBE, { mode: 'vert' });
    p.rect(31, 25 + b, 2, 20, SUN[1]);
    p.path([27, 28 + b, 26, 42 + b], ROBE[1]);
    p.path([37, 28 + b, 38, 42 + b], ROBE[1]);
    // belt with a sun clasp
    p.rect(25, 32 + b, 15, 2, R.gold[1]);
    p.rect(30, 31 + b, 4, 4, R.gold[2]);
    p.px(31, 32 + b, R.gold[3]);
    // shoulders (spiked pauldrons)
    for (const [x, d] of [
      [23, -1],
      [41, 1],
    ]) {
      p.poly([x - 2, 21 + b, x + d * 4, 15 + b, x + 3, 21 + b], R.gold, { mode: 'bevel', edge: R.gold[0] });
      p.ell(x, 23 + b, 4.5, 3.5, ROBE, { edge: ROBE[0] });
    }
    // head + curled horns
    p.cap(25, 12 + b, 22, 5 + b, 2, R.bone, 1.2);
    p.cap(22, 5 + b, 24, 1 + b, 1.2, R.bone, 0.8);
    p.cap(37, 12 + b, 40, 5 + b, 2, R.bone, 1.2);
    p.cap(40, 5 + b, 38, 1 + b, 1.2, R.bone, 0.8);
    p.ell(hx + 0.5, hy, 6.5, 6.5, FIEND, { edge: FIEND[0] });
    // glowing eyes + stern brow + fangs
    p.rect(28, 15 + b, 3, 2, SUN[3]);
    p.rect(33, 15 + b, 3, 2, SUN[3]);
    p.line(27, 13 + b, 30, 14 + b, FIEND[0]);
    p.line(34, 14 + b, 37, 13 + b, FIEND[0]);
    p.path([29, 20 + b, 34, 20 + b], FIEND[0]);
    p.dots([30, 21 + b, 33, 21 + b], WHITE);
    // back arm (open palm with a dusk orb)
    p.cap(22, 25 + b, 17, 33 + b, 2.4, ROBE, 2.2);
    p.ell(16, 34 + b, 2.4, 2.2, FIEND);
    // near arm holding the lash handle
    p.cap(42, 25 + b, 46, 32 + b, 2.6, ROBE, 2.4, { edge: ROBE[0] });
    p.rect(45, 31 + b, 4, 3, FIEND[2]);
    p.line(47, 34 + b, 49, 30 + b, R.gold[2]);
  },
  post: (p, f) => {
    const b = -f;
    // the twilight lash, curling
    const lash = f
      ? [49, 30, 53, 25, 58, 24, 61, 28, 60, 34, 56, 38, 57, 44, 61, 47]
      : [49, 30, 54, 28, 59, 31, 61, 37, 58, 42, 54, 44, 52, 49, 55, 53];
    const pts = lash.map((v, i) => (i % 2 ? v + b : v));
    p.path(pts, '#c08cff');
    p.path(pts.map((v, i) => (i % 2 ? v + 1 : v)), '#7a4ac8');
    for (let i = 2; i < pts.length; i += 4) p.px(pts[i], pts[i + 1], SUN[3]);
    // dusk orb in the open hand
    p.ell(16, 30 + b, 2.6, 2.6, SUN, { mode: 'ball' });
    p.px(15, 29 + b, WHITE);
    halo(p, 16, 30 + b, 5, '#ffb44a', 0.16);
  },
};

// ---------------------------------------------------------------- wardens (96 px)

const IRONSTONE = ramp('#8c8070', 5, 0.08);

const ironrootColossus: Mon = {
  w: 96,
  h: 88,
  pad: [0, 1],
  fps: 3,
  draw: (p, f) => {
    const g = ground(88); // 78
    const b = f;
    // tree growing from the back shoulder
    p.cap(22, 30 + b, 18, 14 + b, 2.6, R.wood, 2);
    p.cap(18, 16 + b, 12, 10 + b, 1.6, R.wood, 1.2);
    for (const [x, y, r] of [
      [12, 9, 7],
      [22, 6, 8],
      [30, 12, 6],
      [16, 15, 6],
    ])
      p.ell(x, y + b + (f && x > 20 ? -1 : 0), r, r * 0.8, R.leaf, { edge: R.leaf[0] });
    p.dots([10, 6 + b, 20, 3 + b, 27, 9 + b, 14, 12 + b], R.leaf[4]);
    // legs: stone pillars wrapped in roots
    for (const [x, d] of [
      [33, -f],
      [57, f],
    ]) {
      p.cap(x, 58, x + d, g - 9, 8.5, IRONSTONE, 9, x > 40 ? { edge: IRONSTONE[0] } : {});
      p.rect(x + d - 11, g - 4, 22, 5, IRONSTONE[1]);
      p.rect(x + d - 11, g - 4, 22, 1, IRONSTONE[3]);
      p.path([x - 7 + d, 60, x - 3 + d, 64, x + 4 + d, 63, x + 7 + d, 68], R.wood[1]);
      p.path([x - 7 + d, 70, x + d, 72, x + 6 + d, 70], R.wood[2]);
    }
    // back arm + fist
    p.cap(22, 38 + b, 15, 56 + b, 7, IRONSTONE, 6.5);
    p.ell(13, 60 + b, 8, 7, IRONSTONE);
    p.rect(9, 46 + b, 12, 3, R.iron[1]);
    // torso
    p.poly([20, 32 + b, 70, 32 + b, 74, 52 + b, 64, 64 + b, 28, 64 + b, 17, 52 + b], IRONSTONE);
    // iron bands with rivets
    for (const y of [40, 54]) {
      p.shape(17, y + b, 75, y + 3 + b, (x, yy) => yy >= y + b && yy < y + 3 + b && inPoly([20, 32 + b, 70, 32 + b, 74, 52 + b, 64, 64 + b, 28, 64 + b, 17, 52 + b], x, yy), R.iron, { mode: 'bevel' });
      for (let x = 22; x <= 70; x += 8) p.on(x, y + 1 + b, R.iron[3]);
    }
    // cracks + moss
    p.path([28, 34 + b, 31, 38 + b], IRONSTONE[1]);
    p.path([60, 45 + b, 64, 50 + b, 62, 52 + b], IRONSTONE[1]);
    p.ell(48, 61 + b, 9, 2.5, R.leaf.slice(1), { mode: 'flat' });
    // amber core in an iron frame
    p.poly([46, 41 + b, 53, 47 + b, 46, 54 + b, 39, 47 + b], R.iron, { mode: 'bevel', edge: R.iron[0] });
    p.poly([46, 43 + b, 51, 47 + b, 46, 52 + b, 41, 47 + b], AMBER, { mode: 'bevel' });
    p.dots([45, 45 + b, 44, 46 + b], WHITE);
    // shoulders
    p.ell(21, 33 + b, 10, 8.5, IRONSTONE, { edge: IRONSTONE[0] });
    p.ell(71, 33 + b, 10, 8.5, IRONSTONE, { edge: IRONSTONE[0] });
    p.rect(64, 30 + b, 14, 3, R.iron[2]);
    p.rect(64, 30 + b, 14, 1, R.iron[3]);
    // head sunk between the shoulders, mossy brow, glowing eyes
    p.ell(47, 22 + b, 12, 10, IRONSTONE, { edge: IRONSTONE[0] });
    p.ell(46, 14 + b, 10, 3.5, R.leaf, { edge: R.leaf[0] });
    p.dots([40, 12 + b, 45, 11 + b, 51, 12 + b], R.leaf[4]);
    p.rect(38, 19 + b, 20, 3, IRONSTONE[1]);
    p.rect(41, 22 + b, 5, 3, AMBER[2]);
    p.rect(51, 22 + b, 5, 3, AMBER[2]);
    p.rect(41, 22 + b, 2, 1, AMBER[3]);
    p.rect(51, 22 + b, 2, 1, AMBER[3]);
    p.path([42, 28 + b, 46, 29 + b, 52, 28 + b], IRONSTONE[1]);
    // the iron maul, head resting on the ground (lifts on frame 1)
    const ml = f ? -4 : 0;
    p.rect(80, 34 + ml, 4, 34, R.wood[1]);
    p.rect(80, 34 + ml, 1, 34, R.wood[3]);
    for (let y = 40; y < 64; y += 6) p.rect(80, y + ml, 4, 1, R.iron[1]);
    p.poly([70, 64 + ml, 94, 64 + ml, 94, g + ml, 70, g + ml], R.iron, { mode: 'bevel', edge: R.iron[0] });
    p.rect(73, 67 + ml, 18, 2, R.iron[1]);
    p.rect(70, 64 + ml, 3, g - 64 + 1, R.iron[0]);
    p.rect(91, 64 + ml, 3, g - 64 + 1, R.iron[0]);
    p.poly([82, 69 + ml, 85, 72 + ml, 82, 75 + ml, 79, 72 + ml], AMBER, { mode: 'bevel' });
    p.dots([72, 66 + ml, 92, 66 + ml, 72, 76 + ml, 92, 76 + ml], R.iron[3]);
    // near arm gripping the haft
    p.cap(72, 38 + b, 78, 48 + b, 7, IRONSTONE, 6.5, { edge: IRONSTONE[0] });
    p.ell(81, 51 + b, 7, 6.5, IRONSTONE, { edge: IRONSTONE[0] });
    p.path([75, 42 + b, 78, 46 + b, 83, 47 + b], R.wood[2]);
  },
  post: (p, f) => {
    if (f) halo(p, 46, 47, 9, '#ffc94a', 0.12);
    p.dots(f ? [66, 79, 68, 78, 94, 79] : [70, 78], '#c8b8a0', 0.6);
  },
};

const REGAL = ramp('#4e3a78', 5, 0.085);
const PALEF = ['#7a7096', '#a8a0c0', '#d4cee4', '#f4f0fa'] as Ramp;
const SHBLADE = ['#1c1428', '#2e2244', '#46366a', '#7a62b0', '#c8a8ff'] as Ramp;

const hollowRegent: Mon = {
  w: 96,
  h: 88,
  pad: [0, 1],
  fps: 3,
  draw: (p, f) => {
    const b = -f * 2;
    // royal cape, flaring wide, tattered hem with gold trim
    const tat = f
      ? [86, 70, 79, 79, 72, 72, 64, 80, 56, 73, 48, 79, 40, 73, 32, 80, 24, 72, 17, 79, 9, 70]
      : [86, 71, 78, 78, 71, 73, 63, 81, 55, 74, 48, 80, 41, 74, 33, 79, 25, 73, 18, 78, 9, 71];
    const cape = [28, 27 + b, 66, 27 + b, ...tat.map((v, i) => (i % 2 ? v + b : v))];
    p.poly(cape, REGAL);
    for (let i = 0; i < tat.length - 2; i += 2) p.line(tat[i], tat[i + 1] + b - 1, tat[i + 2], tat[i + 3] + b - 1, R.gold[2]);
    for (const [x0, x1] of [
      [30, 22],
      [38, 34],
      [58, 62],
      [65, 74],
    ])
      p.line(x0, 36 + b, x1, 70 + b, REGAL[1]);
    // spectral robe front, fading into wisps
    p.poly([37, 33 + b, 57, 33 + b, 61, 62 + b, 55, 71 + b, 50, 64 + b, 44, 72 + b, 38, 64 + b, 33, 62 + b], ['#241a38', '#34284e', '#4a3c6c', '#62548a'], { mode: 'vert' });
    p.line(47, 34 + b, 47, 62 + b, R.gold[1]);
    p.line(37, 34 + b, 33, 61 + b, R.cloth[1]);
    p.line(57, 34 + b, 61, 61 + b, R.cloth[1]);
    // greatsword planted point-down in front
    const sx = 47;
    p.poly([sx - 3, 45 + b, sx + 4, 45 + b, sx + 4, 74 + b, sx + 0.5, 80 + b, sx - 3, 74 + b], SHBLADE, { mode: 'bevel', edge: SHBLADE[0] });
    p.line(sx, 46 + b, sx, 77 + b, SHBLADE[4]);
    p.dots([sx - 2, 52 + b, sx - 2, 60 + b, sx - 2, 68 + b], SHBLADE[3]);
    p.rect(sx - 9, 42 + b, 20, 3, R.gold[2]);
    p.rect(sx - 9, 42 + b, 20, 1, R.gold[3]);
    p.rect(sx - 10, 41 + b, 2, 5, R.gold[1]);
    p.rect(sx + 10, 41 + b, 2, 5, R.gold[1]);
    p.rect(sx - 1, 33 + b, 3, 9, R.leather[2]);
    // wide sleeves meeting on the pommel, bony hands
    p.poly([31, 30 + b, 38, 30 + b, 44, 38 + b, 41, 42 + b, 34, 42 + b, 29, 36 + b], REGAL, { edge: REGAL[0] });
    p.poly([63, 30 + b, 56, 30 + b, 50, 38 + b, 53, 42 + b, 60, 42 + b, 65, 36 + b], REGAL, { edge: REGAL[0] });
    p.rect(34, 41 + b, 8, 2, R.gold[1]);
    p.rect(53, 41 + b, 8, 2, R.gold[1]);
    p.rect(43, 36 + b, 4, 4, PALEF[2]);
    p.rect(48, 36 + b, 4, 4, PALEF[1]);
    p.dots([43, 39 + b, 45, 39 + b, 49, 39 + b, 51, 39 + b], PALEF[0]);
    p.ell(sx + 0.5, 32 + b, 2.6, 2.4, R.gold, { edge: R.gold[0] });
    // high fur collar
    p.ell(47, 29 + b, 17, 5, ['#8a82a0', '#bcb6cc', '#e6e2ee', '#ffffff'], { edge: PALEF[0] });
    for (const x of [35, 41, 53, 59]) p.rect(x, 29 + b, 1, 2, '#2a2040');
    // gaunt skull-like face
    p.shape(38, 10 + b, 57, 31 + b, (x, y) => {
      const t = (y - (10 + b)) / 20;
      const hw = t < 0.55 ? 8.5 : 8.5 - (t - 0.55) * 9;
      return t >= 0 && t <= 1 && Math.abs(x - 47.5) <= hw;
    }, PALEF, { edge: PALEF[0] });
    p.rect(40, 18 + b, 6, 5, VOID);
    p.rect(49, 18 + b, 6, 5, VOID);
    p.rect(42, 19 + b, 2, 3, f ? '#f0d8ff' : '#c8a0ff');
    p.rect(51, 19 + b, 2, 3, f ? '#f0d8ff' : '#c8a0ff');
    p.px(42, 19 + b, WHITE);
    p.px(51, 19 + b, WHITE);
    p.dots([40, 24 + b, 41, 25 + b, 54, 24 + b, 53, 25 + b], PALEF[0]);
    p.poly([46.5, 23 + b, 48.5, 23 + b, 47.5, 26 + b], VOID, { mode: 'flat' });
    p.rect(43, 27 + b, 9, 1, PALEF[0]);
    for (let x = 44; x <= 51; x += 2) p.px(x, 28 + b, PALEF[0]);
    // tall crown with gems
    p.poly([37, 14 + b, 37, 4 + b, 41, 8 + b, 44, 2 + b, 47.5, 7 + b, 51, 2 + b, 54, 8 + b, 58, 4 + b, 58, 14 + b], R.gold, { mode: 'bevel', edge: R.gold[0] });
    p.rect(37, 11 + b, 21, 3, R.gold[1]);
    p.rect(37, 11 + b, 21, 1, R.gold[3]);
    p.rect(46, 7 + b, 3, 3, '#b040e0');
    p.px(46, 7 + b, '#f0c0ff');
    p.dots([40, 12 + b, 55, 12 + b], '#60d0ff');
  },
  post: (p, f) => {
    const b = -f * 2;
    // orbiting soul-wisps
    const orbs = f ? [12, 30, 86, 22, 16, 56, 82, 50] : [14, 26, 88, 26, 14, 52, 84, 46];
    for (let i = 0; i < orbs.length; i += 2) {
      p.ell(orbs[i], orbs[i + 1] + b, 2.2, 2.2, ['#6a4ac0', '#a07af0', '#d8c0ff'], { mode: 'ball' });
      p.px(orbs[i] - 1, orbs[i + 1] + b - 1, WHITE);
    }
    halo(p, 47, 79 + b, 6, '#c8a8ff', 0.14);
  },
};

const BISON = ramp('#3a4c84', 5, 0.085);

const thunderhoof: Mon = {
  w: 96,
  h: 88,
  fps: 3,
  draw: (p, f) => {
    const g = ground(88); // 78
    const hd = f * 2; // head lowers to stomp
    // tail with a bolt tuft
    p.cap(16, 42, 10, 52, 2.2, BISON, 1.6);
    p.poly([4, 51, 11, 50, 9, 55, 14, 55, 6, 66, 8, 58, 3, 58], VOLT, { mode: 'flat' });
    // far legs
    p.cap(28, 58, 27, g - 6, 6, BISON.slice(0, 4), 5.5);
    p.cap(62, 58, 64, g - 6, 6, BISON.slice(0, 4), 5.5);
    p.rect(21, g - 3, 12, 4, NAVY[0]);
    p.rect(58, g - 3, 12, 4, NAVY[0]);
    // body + hump
    p.ell(44, 50, 29, 16, BISON);
    p.ell(58, 38, 18, 16, BISON);
    // shaggy underside
    for (let x = 22; x <= 66; x += 4) p.poly([x - 2, 60, x + 2, 60, x, 66], BISON.slice(0, 3), { mode: 'flat' });
    // near legs with glowing hooves (front one raised on frame 1)
    for (const [x, lift] of [
      [37, 0],
      [72, f * 4],
    ]) {
      p.cap(x, 58, x - (lift ? 2 : 0), g - 6 - lift, 7, BISON, 6.5, { edge: BISON[1] });
      p.rect(x - 7 - (lift ? 2 : 0), g - 4 - lift, 14, 5, NAVY[1]);
      p.rect(x - 7 - (lift ? 2 : 0), g - 4 - lift, 14, 2, VOLT[2]);
      p.rect(x - 7 - (lift ? 2 : 0), g - 4 - lift, 4, 1, VOLT[3]);
    }
    // storm-cloud mane over hump and neck
    for (const [x, y, r] of [
      [34, 38, 6],
      [42, 31, 7.5],
      [51, 25, 8.5],
      [61, 22, 9],
      [71, 26, 8],
      [76, 34, 6.5],
      [48, 36, 6],
      [66, 34, 6],
      [57, 32, 6],
    ])
      p.ell(x, y, r, r * 0.9, CLOUD, { edge: CLOUD[1] });
    // head, lowered and forward
    const hx = 79;
    const hy = 50 + hd;
    p.ell(hx, hy, 13, 11.5, BISON, { edge: BISON[0] });
    // shaggy forelock
    for (const [x, y, r] of [
      [hx - 9, hy - 4, 4],
      [hx - 10, hy + 3, 3.6],
    ])
      p.ell(x, y, r, r, BISON.slice(0, 4), { edge: BISON[0] });
    p.ell(hx + 8, hy + 8, 8, 6.5, ['#2a3058', '#4a5488', '#6a76aa', '#929ec8'], { edge: BISON[0] });
    p.rect(hx + 11, hy + 6, 2, 3, NAVY[0]);
    p.rect(hx + 14, hy + 6, 2, 3, NAVY[0]);
    p.path([hx + 4, hy + 12, hx + 9, hy + 13, hx + 14, hy + 12], NAVY[0]);
    // iron nose ring
    arc(p, hx + 13, hy + 12, 3, -0.2, Math.PI + 0.2, R.iron[3]);
    // beard cloud
    p.ell(hx, hy + 12, 5, 3.8, CLOUD, { edge: CLOUD[1] });
    // bronze brow plate
    p.poly([hx - 7, hy - 8, hx + 7, hy - 11, hx + 11, hy - 4, hx - 5, hy - 1], R.bronze, { mode: 'bevel', edge: R.bronze[0] });
    p.dots([hx - 4, hy - 6, hx + 1, hy - 7, hx + 7, hy - 8], R.bronze[3]);
    // glowing eye under the plate
    p.rect(hx + 3, hy - 1, 5, 3, VOLT[2]);
    p.rect(hx + 3, hy - 1, 2, 1, WHITE);
    p.px(hx + 7, hy + 1, VOLT[0]);
    // golden horns (far then near), bolt-shaped
    p.poly([hx - 9, hy - 7, hx - 14, hy - 19, hx - 10, hy - 18, hx - 13, hy - 30, hx - 5, hy - 17, hx - 8, hy - 17, hx - 4, hy - 7], VOLT.slice(0, 3), { mode: 'bevel' });
    p.poly([hx - 1, hy - 8, hx + 3, hy - 20, hx, hy - 20, hx + 8, hy - 33, hx + 7, hy - 22, hx + 10, hy - 22, hx + 4, hy - 7], VOLT, { mode: 'bevel', edge: VOLT[0] });
  },
  post: (p, f) => {
    // crackling mane
    if (f) {
      zap(p, [36, 26, 41, 21, 45, 25, 50, 17, 56, 22, 61, 14], '#bfe4ff', WHITE);
      zap(p, [68, 18, 72, 15, 71, 12, 76, 9], VOLT[2], VOLT[3]);
      zap(p, [6, 74, 9, 71, 8, 70, 11, 66], VOLT[2]);
    } else {
      zap(p, [40, 24, 46, 20, 49, 24, 55, 16, 61, 21, 67, 15], VOLT[2], VOLT[3]);
      spark(p, 80, 14, '#bfe4ff', WHITE, 2);
      spark(p, 24, 30, VOLT[2], WHITE, 1);
    }
  },
};

const SPECIES: Record<string, Mon> = {
  jellop,
  pipsprout,
  puddlewisp,
  gustling,
  sparkbug,
  mossling,
  cragling,
  glowmite,
  gloomcap,
  hollowshade,
  cairn_wraith: cairnWraith,
  emberkit,
  ashfly,
  voltcalf,
  moonmoth,
  riftling,
  rift_stalker: riftStalker,
  frostling,
  rimefang,
  basalt_crawler: basaltCrawler,
  cinder_toad: cinderToad,
  cloudray,
  thunderwing,
  duskhound,
  gloamthorn,
  glacier_matron: glacierMatron,
  magma_brute: magmaBrute,
  tempest_drake: tempestDrake,
  dusk_sovereign: duskSovereign,
  ironroot_colossus: ironrootColossus,
  hollow_regent: hollowRegent,
  thunderhoof,
};

/**
 * Monsters drawn natively bigger and/or recoloured from a common species (elites: `base` + `scale` + `tint` in
 * src/data/monsters.ts). Each gets its own `mon_<id>` / `mon_<id>_1` frames painted at the real size (docs/QUALITY-PLAN.md
 * §1: no fractional sprite scale) with the multiply tint baked into the pixels (no runtime tint state, Canvas-safe).
 */
export interface MonsterVariant {
  /** Frame-0 texture key (`mon_<id>`); frame 1 is `<key>_1`. */
  key: string;
  /** The species painted (`SPECIES` id). */
  species: string;
  /** Native paint scale (1 = the species' own size). */
  k: number;
  /** Multiply tint baked into the pixels (0xRRGGBB) or null. */
  tint: number | null;
}

/** Species id behind a texture key `mon_<species>` (null when the key is not a species frame-0 key). */
function speciesOfKey(key: string | undefined): string | null {
  if (!key?.startsWith('mon_')) return null;
  const id = key.slice(4);
  return SPECIES[id] ? id : null;
}

/** The baked variant a monster def needs, or null when it shows its species texture as is. */
export function monsterVariant(def: Pick<MonsterDef, 'id' | 'base' | 'texture' | 'tint' | 'scale'>): MonsterVariant | null {
  const k = def.scale ?? 1;
  const tint = def.tint ?? null;
  if (k === 1 && tint === null) return null;
  const species = speciesOfKey(def.texture) ?? (def.base && SPECIES[def.base] ? def.base : SPECIES[def.id] ? def.id : null);
  if (!species) return null;
  return { key: `mon_${def.id}`, species, k, tint };
}

/** Every baked variant in the manifest (elites), by frame-0 key. */
export const MONSTER_VARIANTS: Readonly<Record<string, MonsterVariant>> = Object.fromEntries(
  MONSTERS.map((d) => monsterVariant(d))
    .filter((v): v is MonsterVariant => !!v && !SPECIES[v.key.slice(4)])
    .map((v) => [v.key, v]),
);

/** Every monster's 2-frame loop, keyed by its frame-0 texture key (species and baked elite variants). */
export const MONSTER_ANIMS: Record<string, { frames: string[]; fps: number }> = Object.fromEntries(
  [
    ...Object.entries(SPECIES).map(([id, m]): [string, number] => [`mon_${id}`, m.fps]),
    ...Object.values(MONSTER_VARIANTS).map((v): [string, number] => [v.key, SPECIES[v.species].fps]),
  ].map(([key, fps]) => [key, { frames: [key, `${key}_1`], fps }]),
);

/** Real texture size of a species (logical size + pad) painted at scale `k`. */
function texSize(m: Mon, k = 1): [number, number] {
  const [x, top] = m.pad ?? [0, 0];
  return [Math.round((m.w + 2 * x) * k), Math.round((m.h + top) * k)];
}

/** Paints one frame into a fresh buffer (no outline, no post): what tests and colour sampling read. */
function body(m: Mon, f: number, k = 1): Pix {
  const [w, h] = texSize(m, k);
  const [x, top] = m.pad ?? [0, 0];
  const p = new Pix(w, h, x, top, k);
  m.draw(p, f);
  return p;
}

/** Multiplies every pixel but the outline by `tint` (what a WebGL multiply tint did at run time). */
function bakeTint(c: CanvasRenderingContext2D, w: number, h: number, tint: number): void {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const [or, og, ob] = rgbaOf(O);
  const tr = (tint >> 16) & 255;
  const tg = (tint >> 8) & 255;
  const tb = tint & 255;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3] || (d[i] === or && d[i + 1] === og && d[i + 2] === ob)) continue;
    d[i] = Math.round((d[i] * tr) / 255);
    d[i + 1] = Math.round((d[i + 1] * tg) / 255);
    d[i + 2] = Math.round((d[i + 2] * tb) / 255);
  }
  c.putImageData(img, 0, 0);
}

function paint(scene: Phaser.Scene, key: string, m: Mon, f: number, k = 1, tint: number | null = null): void {
  const [w, h] = texSize(m, k);
  pixelTex(scene, key, w, h, (c) => {
    const p = body(m, f, k);
    p.put(c);
    outline(c, w, h, O);
    if (m.post) {
      p.load(c);
      m.post(p, f);
      p.put(c);
    }
    if (tint !== null) bakeTint(c, w, h, tint);
  });
}

/**
 * Per-instance looks of common monsters (SPEC-v4 §11.8): a pack is never N copies of one sprite. Look 0 is the species
 * as drawn; the others are painted natively a little smaller or bigger (whole pixels, no sprite scale) with a small
 * palette nudge baked in (cooler, warmer, duller). Elites and wardens keep their one look.
 */
export const MONSTER_INSTANCE_LOOKS: readonly { k: number; tint: number | null }[] = [
  { k: 1, tint: null },
  { k: 0.92, tint: 0xe2ecff },
  { k: 1.08, tint: 0xfff0d8 },
  { k: 1, tint: 0xe8e2d2 },
];
const instanceCount = new Map<string, number>();

/** Which instance look the n-th spawned monster of a kind wears: a fixed, shuffled cycle (deterministic per kind). */
export function instanceLook(id: string, n: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 16777619);
  h = Math.imul(h ^ (n >>> 2), 16777619) >>> 0;
  // every four spawns show all four looks, in an order that changes block to block
  const order = [0, 1, 2, 3];
  for (let i = 3; i > 0; i--) {
    const j = (h >>> (i * 5)) % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order[n & 3];
}

/**
 * The instance look of one common monster as a baked variant (null: look 0, an elite / warden, or a monster that is
 * already a baked variant of another species). `instance` picks the look; without it the monsters of a kind take the
 * looks in turn (the order is fixed per kind, so a map always shows the same mix).
 */
export function instanceVariant(def: Pick<MonsterDef, 'id' | 'base' | 'texture' | 'tint' | 'scale' | 'rank'>, instance?: number): MonsterVariant | null {
  if (def.rank !== 'common' || monsterVariant(def)) return null;
  const species = speciesOfKey(def.texture) ?? (SPECIES[def.id] ? def.id : def.base && SPECIES[def.base] ? def.base : null);
  if (!species) return null;
  let n = instance;
  if (n === undefined) {
    n = instanceCount.get(def.id) ?? 0;
    instanceCount.set(def.id, n + 1);
  }
  const i = instance === undefined ? instanceLook(def.id, n) : ((n % MONSTER_INSTANCE_LOOKS.length) + MONSTER_INSTANCE_LOOKS.length) % MONSTER_INSTANCE_LOOKS.length;
  if (i === 0) return null;
  const look = MONSTER_INSTANCE_LOOKS[i];
  return { key: `mon_${def.id}~${i}`, species, k: look.k, tint: look.tint };
}

/** Paints (once) a baked variant's two frames; returns its frame-0 key. */
function paintVariant(scene: Phaser.Scene, v: MonsterVariant): string {
  const m = SPECIES[v.species];
  paint(scene, v.key, m, 0, v.k, v.tint);
  paint(scene, `${v.key}_1`, m, 1, v.k, v.tint);
  return v.key;
}

/**
 * Texture to show for a monster: its baked variant (painted on first use if boot has not), its own species texture,
 * or the base species. `species` is the species key behind it (hover / flyer rules key on it); `baked` = the size and
 * tint are in the pixels (show it at scale 1, no tint).
 */
export function monsterTexture(scene: Phaser.Scene, def: MonsterDef, instance?: number): { key: string; species: string; baked: boolean } {
  const inst = instanceVariant(def, instance);
  if (inst) {
    try {
      return { key: paintVariant(scene, inst), species: `mon_${inst.species}`, baked: true };
    } catch (e) {
      console.error(`[omnipath] monster instance look ${inst.key} failed`, e);
      if (scene.textures.exists(inst.key)) scene.textures.remove(inst.key);
      if (scene.textures.exists(`${inst.key}_1`)) scene.textures.remove(`${inst.key}_1`);
    }
  }
  const v = monsterVariant(def);
  if (v) {
    try {
      return { key: paintVariant(scene, v), species: `mon_${v.species}`, baked: true };
    } catch (e) {
      console.error(`[omnipath] monster variant ${v.key} failed`, e);
      if (scene.textures.exists(v.key)) scene.textures.remove(v.key);
      if (scene.textures.exists(`${v.key}_1`)) scene.textures.remove(`${v.key}_1`);
    }
  }
  let tex = def.texture ?? `mon_${def.id}`;
  if (!scene.textures.exists(tex)) tex = def.base && scene.textures.exists(`mon_${def.base}`) ? `mon_${def.base}` : 'mon_jellop';
  return { key: tex, species: tex, baked: false };
}

/** Draws every `mon_<species>` texture plus its `_1` frame, then the baked elite variants (skips existing keys). */
export function drawMonsters(scene: Phaser.Scene): void {
  for (const [id, m] of Object.entries(SPECIES)) {
    paint(scene, `mon_${id}`, m, 0);
    paint(scene, `mon_${id}_1`, m, 1);
  }
  for (const v of Object.values(MONSTER_VARIANTS)) paintVariant(scene, v);
}

// ------------------------------------------------------------------ hide colours (death chips)

const HIDE = new Map<string, number>();

/** Colours that are never a hide: the outline, eye ink, white shine. */
const NOT_HIDE = new Set([O, EYE, WHITE]);

/** Species whose biggest colour family is not what reads as their hide (a cap over a pale stem, a robe's shadow). */
const HIDE_OF: Readonly<Record<string, string>> = {
  gloomcap: '#9a6cc4',
  pipsprout: '#c8925a',
  dusk_sovereign: '#8a6cb8',
  hollow_regent: '#4e3a78',
};

/**
 * Body tone of a species' frame 0, as 0xRRGGBB: opaque pixels are grouped into colour families (30° hue sectors, greys
 * by lightness), the biggest family wins (a shaded body spreads over 4-5 ramp tones), and its most common tone is the
 * hide. The outline, eye ink and white shine never count.
 */
function speciesHide(species: string): number {
  const hit = HIDE.get(species);
  if (hit !== undefined) return hit;
  const m = SPECIES[species];
  let best = 0x8a7c62;
  if (HIDE_OF[species]) best = parseInt(HIDE_OF[species].slice(1), 16);
  else if (m) {
    const { d } = body(m, 0);
    const skip = new Set([...NOT_HIDE].map((c) => parseInt(c.slice(1, 7), 16)));
    const fams = new Map<number, Map<number, number>>();
    const famN = new Map<number, number>();
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] < 128) continue;
      const c = (d[i] << 16) | (d[i + 1] << 8) | d[i + 2];
      if (skip.has(c)) continue;
      const [h, sat, l] = toHsl(`#${c.toString(16).padStart(6, '0')}`);
      const fam = sat < 0.12 || l > 0.92 ? 100 + Math.min(3, Math.floor(l * 4)) : Math.floor(h / 30);
      let tones = fams.get(fam);
      if (!tones) fams.set(fam, (tones = new Map()));
      tones.set(c, (tones.get(c) ?? 0) + 1);
      famN.set(fam, (famN.get(fam) ?? 0) + 1);
    }
    let top = -1;
    let n = 0;
    for (const [f, v] of famN) if (v > n) [top, n] = [f, v];
    n = 0;
    for (const [c, v] of fams.get(top) ?? []) if (v > n) [best, n] = [c, v];
  }
  HIDE.set(species, best);
  return best;
}

/**
 * Hide / body colour of a monster (0xRRGGBB) for the VFX death pop chips: the species' dominant body tone, with an
 * elite's baked tint applied. Takes a monster id (`boulderback`), its def, or a texture key (`mon_cragling`,
 * `mon_boulderback_1`). The VFX death pop tints its chips with it (vfx/runtime/index.ts hideColorOf).
 */
export function monsterHideColor(idOrKey: string | { id: string }): number {
  const raw = typeof idOrKey === 'string' ? idOrKey : idOrKey.id;
  const id = raw.replace(/^mon_/, '').replace(/_1$/, '').replace(/~\d+$/, '');
  const def = MONSTERS.find((d) => d.id === id);
  const v = def ? monsterVariant(def) : null;
  const species = v?.species ?? (SPECIES[id] ? id : (def?.base ?? speciesOfKey(def?.texture) ?? id));
  const hide = speciesHide(species);
  const tint = v?.tint ?? (def && !v ? (def.tint ?? null) : null);
  if (tint === null) return hide;
  const mul = (sh: number) => Math.round((((hide >> sh) & 255) * ((tint >> sh) & 255)) / 255) << sh;
  return mul(16) | mul(8) | mul(0);
}

/** Test seam: a species frame painted at scale `k` (no outline) — size and RGBA pixels. */
export function monsterPixels(species: string, f = 0, k = 1): { w: number; h: number; data: Uint8ClampedArray } | null {
  const m = SPECIES[species];
  if (!m) return null;
  const p = body(m, f, k);
  return { w: p.w, h: p.h, data: p.d };
}
