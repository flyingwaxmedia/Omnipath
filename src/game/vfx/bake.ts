// Bake: index frames -> colourised RGBA strips through a family LUT, plus white glow twins (docs/VFX.md §3.4, §10.2).
// Pure: no DOM, no clock, no randomness beyond the templates' seeded streams. Frames are trimmed to their content;
// a trimmed frame's ox/oy is the anchor inside it, so the runtime places (anchor - (ox, oy)). Empty frames are 0x0.
// A frame identical to the previous one reuses its `data` buffer (same reference): the atlas packs it once.
import {
  DEFAULT_BAKE,
  IDX,
  UNIQUE_DIRS,
  type BakeOptions,
  type BakedPiece,
  type ComponentId,
  type DirCount,
  type FamilyId,
  type IndexFrame,
  type RgbaFrame,
  type StripUse,
  type VfxBakeApi,
  type VfxPiece,
} from './types';
import { TEMPLATES } from './components';
import type { TemplateOptions } from './components/kit';
import { bayerT } from './dither';
import { NO_GLOW, lut as lutFor, pack } from './ramps';
import type { PFrame } from './painter';

/** Templates seen without their component generic (dispatch by piece.component). */
interface AnyTemplate {
  use(p: unknown): StripUse;
  dirs(p: unknown): DirCount;
  key(p: unknown, motif: FamilyId, opts: BakeOptions): string;
  frames(p: unknown, motif: FamilyId, u: number, opts: BakeOptions): IndexFrame[];
}

const templateOf = (c: ComponentId): AnyTemplate => TEMPLATES[c] as unknown as AnyTemplate;

/** Effective template options: explicit opts win, the piece's LUT is the default, the anchor half is passed through. */
function optionsFor(piece: VfxPiece, opts?: Partial<BakeOptions>): TemplateOptions {
  return {
    lut: opts?.lut ?? piece.lut ?? DEFAULT_BAKE.lut,
    reduceFlash: opts?.reduceFlash ?? DEFAULT_BAKE.reduceFlash,
    keyline: opts?.keyline ?? DEFAULT_BAKE.keyline,
    half: piece.anchor?.half,
  };
}

/** Index frames of one unique direction (deterministic; seeded from the geometry key and u). */
export function indexFrames(piece: VfxPiece, u: number, opts?: Partial<BakeOptions>): IndexFrame[] {
  return templateOf(piece.component).frames(piece.params, piece.motif, u, optionsFor(piece, opts));
}

function geometryKeyOf(piece: VfxPiece, o: TemplateOptions): string {
  return templateOf(piece.component).key(piece.params, piece.motif, o);
}

/** `${geometryKey}|${ramp}|${lut}`: the atlas / animation key. */
export function pieceKey(piece: VfxPiece, opts?: Partial<BakeOptions>): string {
  const o = optionsFor(piece, opts);
  return `${geometryKeyOf(piece, o)}|${piece.ramp}|${o.lut}`;
}

/** Content bounds of a buffer (null when empty). */
function bounds(buf: Uint8Array, w: number, h: number): [number, number, number, number] | null {
  let x0 = w,
    y0 = h,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (buf[y * w + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : [x0, y0, x1, y1];
}

/** Colourise a frame through a LUT, trimmed to its content. */
export function colourise(f: IndexFrame, table: Uint32Array): RgbaFrame {
  const b = bounds(f.body, f.w, f.h);
  if (!b) return { w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms, data: new Uint8ClampedArray(0) };
  const [x0, y0, x1, y1] = b;
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  const out = new Uint32Array(data.buffer);
  for (let y = 0; y < h; y++) {
    const row = (y + y0) * f.w + x0;
    for (let x = 0; x < w; x++) {
      const v = f.body[row + x];
      if (v) out[y * w + x] = table[v];
    }
  }
  return { w, h, ox: f.ox - x0, oy: f.oy - y0, ms: f.ms, data };
}

const WHITE_PX = pack(255, 255, 255, 255);
const GLOW_COVER = [0, 0.25, 0.5, 0.75];

/** White glow twin: level 1/2/3 = 25/50/75 % ordered coverage (anchor-relative Bayer), opaque; trimmed. */
export function glowTwin(f: IndexFrame): RgbaFrame {
  const mask = new Uint8Array(f.w * f.h);
  for (let y = 0; y < f.h; y++)
    for (let x = 0; x < f.w; x++) {
      const k = y * f.w + x;
      const lvl = f.glow[k];
      if (lvl && GLOW_COVER[Math.min(3, lvl)] > bayerT(x - f.ox, y - f.oy)) mask[k] = 1;
    }
  const b = bounds(mask, f.w, f.h);
  if (!b) return { w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms, data: new Uint8ClampedArray(0) };
  const [x0, y0, x1, y1] = b;
  const w = x1 - x0 + 1,
    h = y1 - y0 + 1;
  const data = new Uint8ClampedArray(w * h * 4);
  const out = new Uint32Array(data.buffer);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (mask[(y + y0) * f.w + x + x0]) out[y * w + x] = WHITE_PX;
  return { w, h, ox: f.ox - x0, oy: f.oy - y0, ms: f.ms, data };
}

function sameFrame(a: IndexFrame, b: IndexFrame): boolean {
  if (a.w !== b.w || a.h !== b.h || a.ox !== b.ox || a.oy !== b.oy) return false;
  for (let i = 0; i < a.body.length; i++) if (a.body[i] !== b.body[i] || a.glow[i] !== b.glow[i]) return false;
  return true;
}

function count(f: IndexFrame, i: number): number {
  let n = 0;
  for (const v of f.body) if (v === i) n++;
  return n;
}

/** Bake every unique direction of a piece: colourised frames + white glow twins + flash accounting. */
export function bakePiece(piece: VfxPiece, opts?: Partial<BakeOptions>): BakedPiece {
  const t = templateOf(piece.component);
  const o = optionsFor(piece, opts);
  const geometryKey = geometryKeyOf(piece, o);
  const key = `${geometryKey}|${piece.ramp}|${o.lut}`;
  const use = t.use(piece.params);
  const dirs = t.dirs(piece.params);
  if (use === 'runtime') return { key, geometryKey, component: piece.component, use, dirs, frames: [[]], glow: [[]], heroFrames: [], flashPx: [], px: 0 };
  const table = lutFor(piece.ramp, o.lut);
  const noGlow = NO_GLOW.has(piece.ramp) && piece.component !== 'missile';
  const frames: RgbaFrame[][] = [];
  const glow: RgbaFrame[][] = [];
  const hero = new Set<number>();
  const flash: number[] = [];
  let px = 0;
  const whiteShows = o.lut === 'base';
  for (let u = 0; u < UNIQUE_DIRS[dirs]; u++) {
    const idx = t.frames(piece.params, piece.motif, u, o);
    const fr: RgbaFrame[] = [];
    const gl: RgbaFrame[] = [];
    idx.forEach((f, k) => {
      // A held frame identical to the previous one shares its pixel buffers (the atlas stores it once).
      const prev = k > 0 ? idx[k - 1] : null;
      if (prev && sameFrame(prev, f)) {
        fr.push({ ...fr[k - 1], ms: f.ms });
        gl.push({ ...gl[k - 1], ms: f.ms });
      } else {
        const c = colourise(f, table);
        const g = noGlow ? { w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms, data: new Uint8ClampedArray(0) } : glowTwin(f);
        fr.push(c);
        gl.push(g);
        px += c.w * c.h + g.w * g.h;
      }
      const white = count(f, IDX.WHITE);
      if (white && whiteShows) hero.add(k);
      const contrast = (f as PFrame).kind === 'contrast' ? count(f, IDX.R0) : 0;
      flash[k] = Math.max(flash[k] ?? 0, white + count(f, IDX.R5) + contrast);
    });
    frames.push(fr);
    glow.push(gl);
  }
  return {
    key,
    geometryKey,
    component: piece.component,
    use,
    dirs,
    frames,
    glow,
    heroFrames: [...hero].sort((a, b) => a - b),
    flashPx: flash,
    px,
  };
}

/** Bake a phase's pieces (aligned with the input; identical keys share one BakedPiece). */
export function bakePhase(pieces: readonly VfxPiece[], opts?: Partial<BakeOptions>): BakedPiece[] {
  const seen = new Map<string, BakedPiece>();
  return pieces.map((p) => {
    const k = pieceKey(p, opts);
    let b = seen.get(k);
    if (!b) {
      b = bakePiece(p, opts);
      seen.set(k, b);
    }
    return b;
  });
}

/** Compile-time pin to the module contract. */
export const BAKE_API: VfxBakeApi = { indexFrames, bakePiece, bakePhase, pieceKey };
