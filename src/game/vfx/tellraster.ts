// Monster telegraph rasteriser (docs/VFX.md §6.5, §8.1, §13 item 1): draws a technique's danger area at the EXACT
// geometry MonsterSkills hit-tests (zone ellipses ry = 0.65 rx, cones, capsule lanes, aim lines, chain range
// circles), pixel by pixel, into two RGBA regions the runtime uploads to a pooled canvas texture:
//
//   fill  (DEPTH.TELEGRAPH, under bodies)  a sparse 12.5 % danger dither over the whole area (25 % in the last
//         third), and a denser fill-up front (37.5 % danger + a 12.5 % family hint) growing from the caster / centre
//         toward the rim as the wind-up runs out (the gap between the front and the rim is the time left), a 1 px
//         front line, lane chevrons marching toward the far end
//   rim   (DEPTH.TELL_TOP, above canopies, glow and darkness)  a 2 px dashed rim whose OUTER edge is the hit-test
//         boundary, marching, a dark #24180f keyline outside each dash and a 1 px dark connector in the gaps (the
//         outline never breaks), lane arrow heads, aim lines. The rim is drawn white + keyline only: the runtime
//         tints it per state (danger R3 -> hot R4 in the last 15 % -> #fff8f0 lock in the last 50 ms), so a state
//         change never re-uploads it.
//
// Pixel (i, j) of a region covers world [X0 + i, X0 + i + 1) where X0 = round(anchor.x) - ox: a pixel is inside
// when its centre is (within half a pixel of the true shape, rims within 2 px — tests/vfx-tell.test.ts checks 16
// directions per shape). Phaser-free and deterministic (no clocks, no randomness): the runtime passes the state.
import { BAYER4 } from './dither';
import { lut } from './ramps';
import { IDX, type Pt, type RampId, type TellGeometry } from './types';

/** Geometry relative to its anchor (anchor = zone / cone / range / aura centre, lane start, aim mouth). */
export type LocalTell =
  | { kind: 'zone' | 'aura'; rx: number; ry: number }
  | { kind: 'cone'; r: number; ang: number; arc: number }
  | { kind: 'lane'; dx: number; dy: number; width: number }
  | { kind: 'aim'; angs: readonly number[]; len: number; lens?: readonly number[] }
  | { kind: 'range'; r: number };

/** Splits a world telegraph into its anchor and anchor-relative shape, plus a key that changes only when the
 *  shape itself does (a pure translation keeps the raster: the runtime just moves the images). */
export function localTell(g: TellGeometry): { anchor: Pt; local: LocalTell; key: string } {
  const q = (v: number, k = 1) => Math.round(v * k);
  switch (g.kind) {
    case 'zone':
    case 'aura':
      return { anchor: { x: g.x, y: g.y }, local: { kind: g.kind, rx: g.rx, ry: g.ry }, key: `${g.kind}|${q(g.rx, 2)}|${q(g.ry, 2)}` };
    case 'cone':
      return { anchor: { x: g.x, y: g.y }, local: { kind: 'cone', r: g.r, ang: g.ang, arc: g.arc }, key: `cone|${q(g.r, 2)}|${q(g.ang, 200)}|${q(g.arc, 200)}` };
    case 'lane':
      return { anchor: { x: g.x0, y: g.y0 }, local: { kind: 'lane', dx: g.x1 - g.x0, dy: g.y1 - g.y0, width: g.width }, key: `lane|${q(g.x1 - g.x0)}|${q(g.y1 - g.y0)}|${q(g.width)}` };
    case 'aim': {
      // Aim lines follow the player every frame: quantised (1 degree, 4 px) so they re-rasterise only on a real move.
      // Each shot's line ends where that shot would stop (`lens`: the first blocked tile), as MonsterSkills flies it.
      const lens = g.lens ? g.lens.map((l) => Math.round(Math.min(l, g.len) / 4) * 4) : undefined;
      return {
        anchor: { x: g.x, y: g.y },
        local: { kind: 'aim', angs: g.angs.map((a) => Math.round((a * 180) / Math.PI) * (Math.PI / 180)), len: Math.round(g.len / 4) * 4, ...(lens ? { lens } : {}) },
        key: `aim|${g.angs.map((a) => q((a * 180) / Math.PI)).join(',')}|${q(g.len / 4)}${lens ? `|${lens.join(',')}` : ''}`,
      };
    }
    case 'range':
      return { anchor: { x: g.x, y: g.y }, local: { kind: 'range', r: g.r }, key: `range|${q(g.r, 2)}` };
  }
}

/** Point-in-shape for anchor-relative coordinates: exactly MonsterSkills' hit tests minus the player radius terms
 *  (zones test the player's feet; cones, lanes and ranges test body overlap, so the drawn area is the bare shape). */
export function insideLocal(s: LocalTell, x: number, y: number): boolean {
  return sdLocal(s, x, y) <= 0;
}

/** Signed distance (px, negative inside) from an anchor-relative point to the shape's boundary (aim: none). */
export function sdLocal(s: LocalTell, x: number, y: number): number {
  switch (s.kind) {
    case 'zone':
    case 'aura': {
      const e = Math.hypot(x / s.rx, y / s.ry);
      if (e < 1e-6) return -Math.min(s.rx, s.ry);
      const g = Math.hypot(x / (s.rx * s.rx), y / (s.ry * s.ry)) / e;
      return (e - 1) / g;
    }
    case 'range':
      return Math.hypot(x, y) - s.r;
    case 'cone': {
      const d = Math.hypot(x, y);
      let th = Math.atan2(y, x) - s.ang;
      while (th > Math.PI) th -= Math.PI * 2;
      while (th < -Math.PI) th += Math.PI * 2;
      const half = s.arc / 2;
      const off = Math.abs(th) - half;
      const sdEdge = off <= 0 ? -d * Math.sin(Math.min(Math.PI / 2, -off)) : off >= Math.PI / 2 ? d : d * Math.sin(off);
      return Math.max(d - s.r, sdEdge);
    }
    case 'lane': {
      const L2 = s.dx * s.dx + s.dy * s.dy;
      const t = L2 > 0 ? Math.max(0, Math.min(1, (x * s.dx + y * s.dy) / L2)) : 0;
      return Math.hypot(x - s.dx * t, y - s.dy * t) - s.width / 2;
    }
    case 'aim':
      return Infinity;
  }
}

/** What the runtime passes each frame. */
export interface TellState {
  /** Progress of the current phase (0 at the tell's start, 1 on the hit). */
  t: number;
  /** Ms since the tell appeared (marching clock). */
  ms: number;
  /** Cancel dissolve: 0 none, 1 and 2 the two dithered-out frames. */
  dissolve: 0 | 1 | 2;
}

export interface TellLook {
  /** The technique's family ramp (front, family hint). */
  family: RampId;
  /** Self-buff tells (aura) do not hurt: family rim, no danger fill. */
  danger: boolean;
}

/** Rim tint per state (multiplied over the white rim pixels; the keyline stays dark). */
export function rimTint(t: number, leftMs: number, danger: boolean, family: RampId): number {
  const pick = (ramp: RampId, i: number) => {
    const v = lut(ramp, 'base')[IDX.R0 + i];
    return ((v & 255) << 16) | (((v >>> 8) & 255) << 8) | ((v >>> 16) & 255);
  };
  if (!danger) return pick(family, t >= 0.85 ? 5 : 4);
  if (leftMs <= 50) return 0xfff8f0;
  return t >= 0.85 ? pick('danger', 4) : pick('danger', 3);
}

const DASH_PERIOD = 10;
const DASH_ON = 6;
/** Marching: 2 px per 67 ms tick, doubled in the last 25 % (docs/VFX.md §6.5). */
const MARCH_MS = 67;

const bayerAt = (i: number, j: number): number => BAYER4[(j & 3) * 4 + (i & 3)];
/** The dissolve's threshold: Bayer from another origin, so it thins the fill's own ordered pattern too. */
const dissolveAt = (k: number, w: number): number => {
  const i = k % w;
  const j = (k - i) / w;
  return BAYER4[((j + 1) & 3) * 4 + ((i + 2) & 3)];
};

export class TellRaster {
  /** Region size (fill and rim regions are the same size; aim / range tells have no fill). */
  readonly w: number;
  readonly h: number;
  /** The anchor's pixel inside a region. */
  readonly ox: number;
  readonly oy: number;
  readonly fill: Uint32Array | null;
  readonly rim: Uint32Array;
  /** Length (px) of the rim outline (dash count, tests). */
  readonly perimeter: number;
  private readonly fillPix: Int32Array;
  /** Front parameter (0 centre / caster -> 1 rim / far end) and px per unit of it (front line width). */
  private readonly fillU: Float32Array;
  private readonly fillG: Float32Array;
  /** Lane chevron coordinate (along + 0.9 |lateral|: '>' shapes pointing down the lane), NaN elsewhere. */
  private readonly fillC: Float32Array | null;
  private readonly fillB: Uint8Array;
  private readonly rimPix: Int32Array;
  private readonly rimS: Float32Array;
  /** 1 outer body px, 2 inner body px, 3 keyline, 4 solid (arrow body, aim line), 5 solid keyline. */
  private readonly rimRole: Uint8Array;
  /**
   * Upload rectangles that cover every rim pixel (8-row stripes split at the anchor column): a marching rim re-uploads
   * only these, a few KB, instead of its whole (mostly empty) bounding box.
   */
  readonly rimRects: readonly { x: number; y: number; w: number; h: number }[];
  /** Upload rectangles covering the fill pixels the last render changed (pixels outside the area never change). */
  fillDirty: readonly { x: number; y: number; w: number; h: number }[] = [];
  private fillKey = '';
  private rimKey = '';
  private tick = -1;
  private frontPx = 0;
  private readonly c: { R1: number; R2: number; R3: number; R4: number; famR2: number; famR3: number; famR4: number; white: number; outline: number };
  private readonly aimLines: { angs: readonly number[]; len: number; lens?: readonly number[] } | null;

  constructor(
    readonly shape: LocalTell,
    readonly look: TellLook,
  ) {
    const d = lut('danger', 'base');
    const f = lut(look.family, 'monster');
    this.c = { R1: d[IDX.R1], R2: d[IDX.R2], R3: d[IDX.R3], R4: d[IDX.R4], famR2: f[IDX.R2], famR3: f[IDX.R3], famR4: f[IDX.R4], white: lut('steel', 'base')[IDX.WHITE], outline: d[IDX.OUTLINE] };
    // Bounding box (anchor-relative), 3 px margin for the keyline and rounding; lanes add the arrow head.
    let x0: number, y0: number, x1: number, y1: number;
    let per = 0;
    switch (shape.kind) {
      case 'zone':
      case 'aura':
        x0 = -shape.rx;
        x1 = shape.rx;
        y0 = -shape.ry;
        y1 = shape.ry;
        per = ellipsePerimeter(shape.rx, shape.ry);
        break;
      case 'range':
        x0 = y0 = -shape.r;
        x1 = y1 = shape.r;
        per = 2 * Math.PI * shape.r;
        break;
      case 'cone': {
        const pts: Pt[] = [{ x: 0, y: 0 }];
        for (let k = 0; k <= 16; k++) {
          const a = shape.ang - shape.arc / 2 + (shape.arc * k) / 16;
          pts.push({ x: Math.cos(a) * shape.r, y: Math.sin(a) * shape.r });
        }
        x0 = Math.min(...pts.map((p) => p.x));
        x1 = Math.max(...pts.map((p) => p.x));
        y0 = Math.min(...pts.map((p) => p.y));
        y1 = Math.max(...pts.map((p) => p.y));
        per = 2 * shape.r + shape.arc * shape.r;
        break;
      }
      case 'lane': {
        const L = Math.hypot(shape.dx, shape.dy) || 1;
        const hw = shape.width / 2;
        const tip = L + hw + 14;
        const ux = shape.dx / L,
          uy = shape.dy / L;
        const xs = [-hw, shape.dx - hw, shape.dx + hw, hw, ux * tip];
        const ys = [-hw, shape.dy - hw, shape.dy + hw, hw, uy * tip];
        x0 = Math.min(...xs);
        x1 = Math.max(...xs);
        y0 = Math.min(...ys);
        y1 = Math.max(...ys);
        per = 2 * L + Math.PI * shape.width;
        break;
      }
      case 'aim': {
        const xs = [0, ...shape.angs.map((a, i) => Math.cos(a) * (shape.lens?.[i] ?? shape.len))];
        const ys = [0, ...shape.angs.map((a, i) => Math.sin(a) * (shape.lens?.[i] ?? shape.len))];
        x0 = Math.min(...xs);
        x1 = Math.max(...xs);
        y0 = Math.min(...ys);
        y1 = Math.max(...ys);
        per = shape.len * shape.angs.length;
        break;
      }
    }
    const M = 4;
    this.ox = Math.ceil(-x0) + M;
    this.oy = Math.ceil(-y0) + M;
    this.w = this.ox + Math.ceil(x1) + M + 1;
    this.h = this.oy + Math.ceil(y1) + M + 1;
    this.perimeter = per;
    this.aimLines = shape.kind === 'aim' ? { angs: shape.angs, len: shape.len, ...(shape.lens ? { lens: shape.lens } : {}) } : null;
    const hasFill = shape.kind === 'zone' || shape.kind === 'cone' || shape.kind === 'lane';
    this.fill = hasFill ? new Uint32Array(this.w * this.h) : null;
    this.rim = new Uint32Array(this.w * this.h);
    // Per-pixel tables (built once per shape; a frame then only walks the lists).
    const fp: number[] = [];
    const fu: number[] = [];
    const fg: number[] = [];
    const fc: number[] = [];
    const rp: number[] = [];
    const rs: number[] = [];
    const rr: number[] = [];
    if (shape.kind !== 'aim') {
      const W = this.w;
      for (let j = 0; j < this.h; j++) {
        const y = j - this.oy + 0.5;
        // Row pruning: a range ring only needs its annulus.
        let i0 = 0,
          i1 = W - 1;
        if (shape.kind === 'range') {
          const ro = shape.r + 2.5;
          if (Math.abs(y) > ro) continue;
          i0 = Math.max(0, Math.floor(this.ox - Math.sqrt(ro * ro - y * y)) - 1);
          i1 = Math.min(W - 1, Math.ceil(this.ox + Math.sqrt(ro * ro - y * y)) + 1);
        }
        for (let i = i0; i <= i1; i++) {
          const x = i - this.ox + 0.5;
          if (shape.kind === 'range') {
            const dd = Math.hypot(x, y);
            const sd = dd - shape.r;
            if (sd > -2.5 && sd <= 1) {
              rp.push(j * W + i);
              rs.push((((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) * shape.r));
              rr.push(sd > 0 ? 3 : sd > -1 ? 1 : 2);
            }
            continue;
          }
          const sd = sdLocal(shape, x, y);
          if (sd > 1) continue;
          const k = j * W + i;
          if (sd <= 0 && hasFill) {
            const [u, g, c] = this.front(x, y);
            fp.push(k);
            fu.push(u);
            fg.push(g);
            fc.push(c);
          }
          if (sd > -2) {
            rp.push(k);
            rs.push(this.perim(x, y));
            rr.push(sd > 0 ? 3 : sd > -1 ? 1 : 2);
          }
        }
      }
      if (shape.kind === 'lane') this.arrow(rp, rs, rr);
    }
    this.fillPix = Int32Array.from(fp);
    this.fillU = Float32Array.from(fu);
    this.fillG = Float32Array.from(fg);
    this.fillC = shape.kind === 'lane' ? Float32Array.from(fc) : null;
    this.fillB = Uint8Array.from(fp.map((k) => bayerAt(k % this.w, Math.floor(k / this.w))));
    this.rimPix = Int32Array.from(rp);
    this.rimS = Float32Array.from(rs);
    this.rimRole = Uint8Array.from(rr);
    this.rimRects = shape.kind === 'aim' ? [{ x: 0, y: 0, w: this.w, h: this.h }] : stripeRects(rp, this.w, this.h, this.ox);
  }

  /** Front parameter u (0..1), px per unit of u, and the lane chevron coordinate. */
  private front(x: number, y: number): [number, number, number] {
    const s = this.shape;
    switch (s.kind) {
      case 'zone':
      case 'aura': {
        const e = Math.hypot(x / s.rx, y / s.ry);
        if (e < 1e-6) return [0, Math.min(s.rx, s.ry), Number.NaN];
        return [e, e / Math.hypot(x / (s.rx * s.rx), y / (s.ry * s.ry)), Number.NaN];
      }
      case 'cone':
        return [Math.hypot(x, y) / s.r, s.r, Number.NaN];
      case 'lane': {
        const L = Math.hypot(s.dx, s.dy) || 1;
        const along = (x * s.dx + y * s.dy) / L;
        const lat = (-x * s.dy + y * s.dx) / L;
        return [Math.max(0, Math.min(1, along / L)), L, along + 0.9 * Math.abs(lat)];
      }
      default:
        return [0, 1, Number.NaN];
    }
  }

  /** Position along the outline (px) for the dash pattern. */
  private perim(x: number, y: number): number {
    const s = this.shape;
    switch (s.kind) {
      case 'zone':
      case 'aura': {
        const a = (Math.atan2(y / s.ry, x / s.rx) + Math.PI * 2) % (Math.PI * 2);
        return (a / (Math.PI * 2)) * ellipsePerimeter(s.rx, s.ry);
      }
      case 'cone': {
        const d = Math.hypot(x, y);
        let th = Math.atan2(y, x) - s.ang;
        while (th > Math.PI) th -= Math.PI * 2;
        while (th < -Math.PI) th += Math.PI * 2;
        const half = s.arc / 2;
        const off = Math.abs(th) - half;
        const sdEdge = off <= 0 ? -d * Math.sin(Math.min(Math.PI / 2, -off)) : d * Math.sin(Math.min(Math.PI / 2, off));
        if (d - s.r > sdEdge) return s.r + (th + half) * s.r;
        return th < 0 ? d : s.r + s.arc * s.r + (s.r - d);
      }
      case 'lane': {
        const L = Math.hypot(s.dx, s.dy) || 1;
        const along = (x * s.dx + y * s.dy) / L;
        const lat = (-x * s.dy + y * s.dx) / L;
        const hw = s.width / 2;
        if (along < 0) return 2 * L + Math.PI * hw + (Math.PI / 2 - Math.atan2(lat, -along)) * hw;
        if (along > L) return L + Math.atan2(along - L, -lat) * hw;
        return lat < 0 ? along : L + Math.PI * hw + (L - along);
      }
      default:
        return 0;
    }
  }

  /** Lane arrow head beyond the far cap (role 4 body, 5 keyline). */
  private arrow(rp: number[], rs: number[], rr: number[]): void {
    const s = this.shape as Extract<LocalTell, { kind: 'lane' }>;
    const L = Math.hypot(s.dx, s.dy) || 1;
    const ux = s.dx / L,
      uy = s.dy / L;
    const hw = s.width / 2;
    const a0 = L + hw + 3,
      a1 = L + hw + 13;
    const bw = Math.max(5, Math.min(12, hw * 0.6));
    const inTri = (x: number, y: number): boolean => {
      const along = x * ux + y * uy;
      const lat = -x * uy + y * ux;
      return along >= a0 && along <= a1 && Math.abs(lat) <= (bw * (a1 - along)) / (a1 - a0);
    };
    const W = this.w;
    const seen = new Set<number>();
    for (let j = 0; j < this.h; j++)
      for (let i = 0; i < W; i++) {
        const x = i - this.ox + 0.5,
          y = j - this.oy + 0.5;
        if (inTri(x, y)) {
          const k = j * W + i;
          seen.add(k);
          rp.push(k);
          rs.push(0);
          rr.push(4);
        }
      }
    for (const k of [...seen]) {
      const i = k % W,
        j = Math.floor(k / W);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const n = (j + dj) * W + (i + di);
        if (i + di < 0 || i + di >= W || j + dj < 0 || j + dj >= this.h || seen.has(n)) continue;
        seen.add(n);
        rp.push(n);
        rs.push(0);
        rr.push(5);
      }
    }
  }

  /**
   * Draws the state; returns which regions changed (the runtime uploads only those). The fill changes with the
   * front (whole px), the density step and the dissolve; the rim with the march step and the dissolve (its colour
   * is a tint).
   */
  render(st: TellState): { fill: boolean; rim: boolean } {
    const t = Math.max(0, Math.min(1, st.t));
    const fast = t >= 0.75;
    // Everything moves on 67 ms ticks (15 Hz; marching doubles to 33 ms in the last 25 %), so a big tell uploads at
    // most 15 times a second however long its frames are.
    const tick = Math.floor(st.ms / MARCH_MS);
    const march = fast ? Math.floor(st.ms / (MARCH_MS / 2)) * 2 : tick * 2;
    if (tick !== this.tick || st.dissolve) {
      this.tick = tick;
      this.frontPx = Math.floor(t * this.reach());
    }
    const late = t >= 0.66 ? 1 : 0;
    const chev = this.fillC ? tick : 0;
    let fill = false;
    let rim = false;
    if (this.fill) {
      const key = `${this.frontPx}|${late}|${st.dissolve}|${chev}`;
      if (key !== this.fillKey) {
        this.fillKey = key;
        this.drawFill(this.frontPx / Math.max(1, this.reach()), late, st.dissolve, chev * 4);
        fill = true;
      }
    }
    const rk = `${this.shape.kind === 'range' ? 0 : march}|${st.dissolve}`;
    if (rk !== this.rimKey) {
      this.rimKey = rk;
      this.drawRim(march, st.dissolve);
      rim = true;
    }
    return { fill, rim };
  }

  private reach(): number {
    const s = this.shape;
    switch (s.kind) {
      case 'zone':
      case 'aura':
        return Math.max(s.rx, s.ry);
      case 'cone':
        return s.r;
      case 'lane':
        return Math.hypot(s.dx, s.dy);
      case 'range':
        return s.r;
      case 'aim':
        return s.len;
    }
  }

  private drawFill(t: number, late: number, dissolve: 0 | 1 | 2, chevShift: number): void {
    const buf = this.fill!;
    const changed: number[] = [];
    const c = this.c;
    const cut = dissolve === 1 ? 8 : dissolve === 2 ? 4 : 16;
    const outN = late ? 4 : 2;
    const pix = this.fillPix,
      U = this.fillU,
      G = this.fillG,
      B = this.fillB,
      C = this.fillC;
    const W = this.w;
    for (let n = 0; n < pix.length; n++) {
      const b = B[n];
      const gone = cut < 16 && dissolveAt(pix[n], W) >= cut;
      const fd = (U[n] - t) * G[n];
      let v = 0;
      if (gone) v = 0;
      else if (fd <= 0) {
        // Inside the front: 31.25 % danger (12.5 % hot R2 + 18.75 % deep R1: a wine-red tint that keeps the ground
        // and the actors readable instead of a neon sheet) + 6.25 % family hint; the front line itself is solid R4.
        if (fd > -1.25 && t > 0.02) v = c.R4;
        else if (b < 2) v = c.R2;
        else if (b < 5) v = c.R1;
        else if (b < 6) v = c.famR3;
      } else if (b < outN) v = c.R1;
      if (C && !gone) {
        const cv = C[n];
        const m = (((cv - chevShift) % 16) + 16) % 16;
        if (m < 2 && U[n] > 0.04 && U[n] < 0.97) v = fd <= 0 ? c.R4 : c.R3;
      }
      const k = pix[n];
      if (buf[k] !== v) {
        buf[k] = v;
        changed.push(k);
      }
    }
    // Only what changed goes up: the ring the front crossed (or everything at a density step / dissolve).
    this.fillDirty = changed.length ? stripeRects(changed, this.w, this.h, this.ox) : [];
  }

  private drawRim(march: number, dissolve: 0 | 1 | 2): void {
    const buf = this.rim;
    buf.fill(0);
    const c = this.c;
    const W = this.w;
    const cut = dissolve === 1 ? 8 : dissolve === 2 ? 4 : 16;
    if (this.aimLines) {
      this.drawAim(march, cut);
      return;
    }
    const pix = this.rimPix,
      S = this.rimS,
      Ro = this.rimRole;
    const statik = this.shape.kind === 'range';
    for (let n = 0; n < pix.length; n++) {
      const k = pix[n];
      if (cut < 16 && dissolveAt(k, W) >= cut) continue;
      const role = Ro[n];
      if (role === 4) {
        buf[k] = c.white;
        continue;
      }
      if (role === 5) {
        buf[k] = c.outline;
        continue;
      }
      const s = S[n] - (statik ? 0 : march);
      const on = ((s % DASH_PERIOD) + DASH_PERIOD) % DASH_PERIOD < DASH_ON;
      if (on) buf[k] = role === 3 ? c.outline : c.white;
      else if (role === 1) buf[k] = c.outline;
    }
  }

  /** Aim lines: a 2 px dashed line per shot from the mouth, marching outward, keylined. */
  private drawAim(march: number, cut: number): void {
    const buf = this.rim;
    const c = this.c;
    const W = this.w,
      H = this.h;
    const { angs, len, lens } = this.aimLines!;
    const body: number[] = [];
    for (let ai = 0; ai < angs.length; ai++) {
      const a = angs[ai];
      const ca = Math.cos(a),
        sa = Math.sin(a);
      const end = lens?.[ai] ?? len;
      for (let s = 8; s <= end; s += 0.5) {
        const ph = (((s - march) % 12) + 12) % 12;
        if (ph >= 7) continue;
        const px = Math.floor(this.ox + ca * s),
          py = Math.floor(this.oy + sa * s);
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ]) {
          const i = px + di,
            j = py + dj;
          if (i < 0 || j < 0 || i >= W || j >= H) continue;
          const k = j * W + i;
          if (buf[k] !== c.white) {
            buf[k] = c.white;
            body.push(k);
          }
        }
      }
    }
    for (const k of body) {
      const i = k % W,
        j = Math.floor(k / W);
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const ii = i + di,
          jj = j + dj;
        if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
        const n = jj * W + ii;
        if (!buf[n]) buf[n] = c.outline;
      }
    }
    if (cut < 16) for (let k = 0; k < buf.length; k++) if (buf[k] && dissolveAt(k, W) >= cut) buf[k] = 0;
  }

  /** Fill pixel count (tests, stats). */
  get fillCount(): number {
    return this.fillPix.length;
  }

  /** 1 on every pixel of the fill AREA, dither aside (the hitbox check, tests/vfx-tell.test.ts). */
  fillMask(): Uint8Array {
    const m = new Uint8Array(this.w * this.h);
    for (const k of this.fillPix) m[k] = 1;
    return m;
  }

  /** 1 on every rim body pixel, dashes aside (roles 1 and 2: the 2 px inside the boundary). */
  rimMask(): Uint8Array {
    const m = new Uint8Array(this.w * this.h);
    for (let n = 0; n < this.rimPix.length; n++) if (this.rimRole[n] === 1 || this.rimRole[n] === 2) m[this.rimPix[n]] = 1;
    return m;
  }
}

/** Rectangles covering pixel indices `pix` in 8-row stripes, split at column `split` (left / right arcs). */
function stripeRects(pix: readonly number[], w: number, h: number, split: number): { x: number; y: number; w: number; h: number }[] {
  const S = 8;
  const n = Math.ceil(h / S);
  const lo = [new Array(n).fill(Infinity), new Array(n).fill(Infinity)];
  const hi = [new Array(n).fill(-1), new Array(n).fill(-1)];
  for (const k of pix) {
    const x = k % w;
    const st = Math.floor((k - x) / w / S);
    const side = x < split ? 0 : 1;
    if (x < lo[side][st]) lo[side][st] = x;
    if (x > hi[side][st]) hi[side][st] = x;
  }
  const out: { x: number; y: number; w: number; h: number }[] = [];
  for (let st = 0; st < n; st++) {
    const y = st * S;
    const hh = Math.min(S, h - y);
    const l = hi[0][st] >= 0 ? [lo[0][st], hi[0][st]] : null;
    const r = hi[1][st] >= 0 ? [lo[1][st], hi[1][st]] : null;
    if (l && r && r[0] - l[1] <= 8) out.push({ x: l[0], y, w: r[1] - l[0] + 1, h: hh });
    else {
      if (l) out.push({ x: l[0], y, w: l[1] - l[0] + 1, h: hh });
      if (r) out.push({ x: r[0], y, w: r[1] - r[0] + 1, h: hh });
    }
  }
  return out;
}

/** Ramanujan's ellipse perimeter. */
export function ellipsePerimeter(rx: number, ry: number): number {
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  return Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}
