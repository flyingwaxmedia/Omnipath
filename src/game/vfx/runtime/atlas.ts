// VFX atlas (docs/VFX.md §8.5): up to VFX_BUDGET.maxPages 1024² canvas textures, shelf-packed with a 2 px gutter.
// Baked RGBA frames are written into a page canvas (the CPU copy: Canvas renderer, context restore) and queued as
// dirty rectangles; flush() pushes them to the GPU with texSubImage2D, at most VFX_BUDGET.uploadBytesPerFrame per
// frame (a full CanvasTexture.refresh() would re-upload 4 MB). A strip is drawable only once its rectangles are on
// the GPU (`ready`); until then the runtime plays the family fallback.
//
// The atlas is run-wide (one per Phaser.Game, textures outlive map restarts): the warm set of the last map stays
// baked, and least-recently-used pages are recycled when every page is full.
import type Phaser from 'phaser';
import { VFX_BUDGET, type DirCount, type RgbaFrame, type StripUse } from '../types';

/** A drawable frame: texture key + frame name, the anchor inside the frame and its display time. w = 0: empty. */
export interface FrameRef {
  tex: string;
  name: string;
  page: number;
  w: number;
  h: number;
  ox: number;
  oy: number;
  ms: number;
}

/** One baked direction of a strip. */
export interface StripRef {
  frames: FrameRef[];
  /** White glow twins (w = 0 where a frame has none); null when the strip has no glow at all. */
  glow: FrameRef[] | null;
  totalMs: number;
}

/** A baked piece in the atlas (all unique directions). */
export interface AtlasEntry {
  key: string;
  geometryKey: string;
  use: StripUse;
  dirs: DirCount;
  strips: (StripRef | null)[];
  heroFrames: number[];
  flashPx: number[];
  /** Rectangles still waiting for the GPU. */
  pending: number;
  /** Every direction is baked and uploaded. */
  ready: boolean;
  lastUsed: number;
  pages: Set<number>;
}

interface Shelf {
  y: number;
  h: number;
  x: number;
}

interface Page {
  idx: number;
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  ctx: CanvasRenderingContext2D;
  shelves: Shelf[];
  /** Next free row below the last shelf. */
  top: number;
  usedPx: number;
  entries: Set<string>;
  lastUsed: number;
}

interface Upload {
  page: Page;
  x: number;
  y: number;
  w: number;
  h: number;
  data: Uint8ClampedArray;
  entries: AtlasEntry[];
}

const PAGE = VFX_BUDGET.atlasPage;
const GUTTER = VFX_BUDGET.gutterPx;
const EMPTY = (ms: number, ox: number, oy: number): FrameRef => ({ tex: '', name: '', page: -1, w: 0, h: 0, ox, oy, ms });

let pageSeq = 0;

/**
 * Best-fit shelf for a w × h rectangle: the lowest shelf tall enough with room left. A much taller shelf is used
 * only once the page has little height left (keeps short frames from wasting tall rows early).
 */
function bestShelf(shelves: Shelf[], w: number, h: number, free: number): Shelf | undefined {
  let best: Shelf | undefined;
  for (const sh of shelves) {
    if (sh.h < h || PAGE - sh.x < w) continue;
    if (sh.h > h * 2 + 8 && free >= h * 2) continue;
    if (!best || sh.h < best.h) best = sh;
  }
  return best;
}

export class Atlas {
  readonly entries = new Map<string, AtlasEntry>();
  private pages: Page[] = [];
  private uploads: Upload[] = [];
  /** Glow strips shared by geometry (white twins are the same for every ramp): `${geometryKey}|${u}`. */
  private glowStrips = new Map<string, { refs: FrameRef[]; page: number }>();
  private frameSeq = 0;
  uploadedBytes = 0;
  /** Bytes pushed this frame (stats). */
  frameBytes = 0;

  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    /** WebGL context, or null on the Canvas renderer (no uploads needed: frames draw from the canvas). */
    private gl: WebGLRenderingContext | null,
  ) {}

  setGl(gl: WebGLRenderingContext | null): void {
    this.gl = gl;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  /** Fraction of atlas pixels in use (stats). */
  get fill(): number {
    return this.pages.reduce((a, p) => a + p.usedPx, 0) / (PAGE * PAGE);
  }

  get queuedBytes(): number {
    return this.uploads.reduce((a, u) => a + u.w * u.h * 4, 0);
  }

  entry(key: string): AtlasEntry | undefined {
    return this.entries.get(key);
  }

  /** Starts an entry (before its directions are baked). */
  begin(key: string, geometryKey: string, use: StripUse, dirs: DirCount, uniq: number): AtlasEntry {
    let e = this.entries.get(key);
    if (e) return e;
    e = { key, geometryKey, use, dirs, strips: new Array(uniq).fill(null), heroFrames: [], flashPx: [], pending: 0, ready: false, lastUsed: 0, pages: new Set() };
    this.entries.set(key, e);
    return e;
  }

  /**
   * Stores one baked direction. `frames[k]` that repeat the previous frame's `data` buffer share its rectangle.
   * Returns false when no page has room (the caller retries after an eviction).
   */
  addStrip(e: AtlasEntry, u: number, frames: readonly RgbaFrame[], glow: readonly RgbaFrame[] | null, now: number): boolean {
    const bodyRefs = this.place(e, frames, now);
    if (!bodyRefs) return false;
    let glowRefs: FrameRef[] | null = null;
    if (glow && glow.some((g) => g.w > 0)) {
      const gk = `${e.geometryKey}|${u}`;
      const shared = this.glowStrips.get(gk);
      if (shared && this.pages[shared.page]?.entries.has(`glow:${gk}`)) glowRefs = shared.refs;
      else {
        const holder: AtlasEntry = e;
        glowRefs = this.place(holder, glow, now, `glow:${gk}`);
        if (!glowRefs) return false;
        this.glowStrips.set(gk, { refs: glowRefs, page: glowRefs.find((g) => g.w)?.page ?? 0 });
      }
    }
    e.strips[u] = { frames: bodyRefs, glow: glowRefs, totalMs: frames.reduce((a, f) => a + f.ms, 0) };
    return true;
  }

  /** Marks an entry used (LRU). */
  touch(e: AtlasEntry, now: number): void {
    e.lastUsed = now;
    for (const p of e.pages) {
      const page = this.pages[p];
      if (page) page.lastUsed = now;
    }
  }

  /** Checks whether every direction is baked and uploaded. */
  settle(e: AtlasEntry): void {
    e.ready = e.pending === 0 && e.strips.every((s) => s !== null);
  }

  /**
   * Pushes queued rectangles to the GPU, up to `budget` bytes (at least one rectangle so nothing starves).
   * Returns the bytes uploaded.
   */
  flush(budget: number = VFX_BUDGET.uploadBytesPerFrame): number {
    let bytes = 0;
    const gl = this.gl;
    while (this.uploads.length) {
      const up = this.uploads[0];
      const n = up.w * up.h * 4;
      if (bytes > 0 && bytes + n > budget) break;
      this.uploads.shift();
      bytes += n;
      if (gl && !gl.isContextLost()) {
        const wrapper = (up.page.tex.source[0] as unknown as { glTexture?: { webGLTexture?: WebGLTexture | null; pma?: boolean } }).glTexture;
        const tex = wrapper?.webGLTexture;
        if (tex) {
          gl.activeTexture(gl.TEXTURE0);
          const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
          gl.bindTexture(gl.TEXTURE_2D, tex);
          gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!wrapper?.pma);
          gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
          gl.texSubImage2D(gl.TEXTURE_2D, 0, up.x, up.y, up.w, up.h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(up.data.buffer, up.data.byteOffset, up.data.byteLength));
          gl.bindTexture(gl.TEXTURE_2D, prev);
        }
      }
      for (const e of up.entries) {
        e.pending--;
        this.settle(e);
      }
    }
    this.uploadedBytes += bytes;
    this.frameBytes = bytes;
    return bytes;
  }

  /**
   * Frees the least recently used page none of whose entries is in `busy` (live instances). Every entry on it is
   * forgotten (it re-bakes on next use). Returns false when nothing could be freed.
   */
  evict(busy: ReadonlySet<string>): boolean {
    // A live entry pins its own pages AND the pages of its shared glow twins (they may sit on another page).
    const pinned = new Set<number>();
    for (const k of busy) {
      const e = this.entries.get(k);
      if (!e) continue;
      for (const p of e.pages) pinned.add(p);
      for (const s of e.strips) for (const g of s?.glow ?? []) if (g.w) pinned.add(g.page);
    }
    const cands = this.pages
      .filter((p) => !pinned.has(p.idx) && ![...p.entries].some((k) => busy.has(k)))
      .sort((a, b) => a.lastUsed - b.lastUsed);
    const page = cands[0];
    if (!page) return false;
    for (const k of page.entries) {
      if (k.startsWith('glow:')) {
        this.glowStrips.delete(k.slice(5));
        continue;
      }
      const e = this.entries.get(k);
      if (!e) continue;
      // Entries spanning several pages are dropped whole.
      this.entries.delete(k);
      for (const p of e.pages) if (p !== page.idx) this.pages[p]?.entries.delete(k);
    }
    this.uploads = this.uploads.filter((u) => u.page !== page);
    const names = Object.keys(page.tex.frames).filter((n) => n !== '__BASE');
    for (const n of names) page.tex.remove(n);
    // Phaser resolves a missing / default frame through `firstFrame`, which still names a removed frame: a new
    // Image or Blitter on this page would crash on it (TypeError: cutWidth). Point it back at the base frame.
    page.tex.firstFrame = '__BASE';
    page.ctx.clearRect(0, 0, PAGE, PAGE);
    page.shelves = [];
    page.top = 0;
    page.usedPx = 0;
    page.entries.clear();
    // The cleared canvas must reach the GPU too (stale pixels are harmless: no frame points at them any more).
    return true;
  }

  /** Destroys every page texture (game shutdown). */
  destroy(): void {
    for (const p of this.pages) this.textures.remove(p.key);
    this.pages = [];
    this.entries.clear();
    this.glowStrips.clear();
    this.uploads = [];
  }

  // ------------------------------------------------------------------ packing

  private place(e: AtlasEntry, frames: readonly RgbaFrame[], now: number, holderKey?: string): FrameRef[] | null {
    // Unique rectangles of this strip (a frame repeating the previous one shares its buffer).
    const need: RgbaFrame[] = [];
    frames.forEach((f, k) => {
      if (!f.w || !f.h) return;
      if (k > 0 && frames[k - 1].data === f.data) return;
      need.push(f);
    });
    const page = this.pageFor(need);
    if (!page) return null;
    const refs: FrameRef[] = [];
    const placed = new Map<Uint8ClampedArray, FrameRef>();
    for (const f of frames) {
      if (!f.w || !f.h) {
        refs.push(EMPTY(f.ms, f.ox, f.oy));
        continue;
      }
      const prev = placed.get(f.data);
      if (prev) {
        refs.push({ ...prev, ms: f.ms, ox: f.ox, oy: f.oy });
        continue;
      }
      const at = this.alloc(page, f.w, f.h)!;
      const name = `f${this.frameSeq++}`;
      page.tex.add(name, 0, at.x, at.y, f.w, f.h);
      page.ctx.putImageData(new ImageData(f.data as unknown as Uint8ClampedArray<ArrayBuffer>, f.w, f.h), at.x, at.y);
      page.usedPx += (f.w + GUTTER) * (f.h + GUTTER);
      const ref: FrameRef = { tex: page.key, name, page: page.idx, w: f.w, h: f.h, ox: f.ox, oy: f.oy, ms: f.ms };
      placed.set(f.data, ref);
      refs.push(ref);
      if (this.gl) {
        e.pending++;
        this.uploads.push({ page, x: at.x, y: at.y, w: f.w, h: f.h, data: f.data, entries: [e] });
      }
    }
    page.entries.add(holderKey ?? e.key);
    page.lastUsed = now;
    e.pages.add(page.idx);
    return refs;
  }

  /** A page with room for every rectangle (all on one page: a strip stays contiguous), creating one if allowed. */
  private pageFor(rects: readonly RgbaFrame[]): Page | null {
    for (const p of this.pages) if (this.fits(p, rects)) return p;
    if (this.pages.length >= VFX_BUDGET.maxPages) return null;
    const p = this.newPage();
    return this.fits(p, rects) ? p : null;
  }

  /** Dry-run of the shelf packer. */
  private fits(p: Page, rects: readonly RgbaFrame[]): boolean {
    const shelves = p.shelves.map((s) => ({ ...s }));
    let top = p.top;
    for (const r of rects) {
      const w = r.w + GUTTER;
      const h = r.h + GUTTER;
      if (w > PAGE || h > PAGE) return false;
      const s = bestShelf(shelves, w, h, PAGE - top);
      if (s) s.x += w;
      else {
        if (top + h > PAGE) return false;
        shelves.push({ y: top, h, x: w });
        top += h;
      }
    }
    return true;
  }

  private alloc(p: Page, rw: number, rh: number): { x: number; y: number } | null {
    const w = rw + GUTTER;
    const h = rh + GUTTER;
    let s = bestShelf(p.shelves, w, h, PAGE - p.top);
    if (!s) {
      if (p.top + h > PAGE) return null;
      s = { y: p.top, h, x: 0 };
      p.shelves.push(s);
      p.top += h;
    }
    const at = { x: s.x, y: s.y };
    s.x += w;
    return at;
  }

  private newPage(): Page {
    const idx = this.pages.length;
    const key = `vfx_page_${pageSeq++}`;
    const tex = this.textures.createCanvas(key, PAGE, PAGE)!;
    const ctx = tex.getContext();
    ctx.imageSmoothingEnabled = false;
    const page: Page = { idx, key, tex, ctx, shelves: [], top: 0, usedPx: 0, entries: new Set(), lastUsed: 0 };
    this.pages.push(page);
    return page;
  }
}
