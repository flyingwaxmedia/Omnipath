// Live bolt strips (docs/VFX.md §8.5, §8.12): chain hops and arc zaps are the only cast-time bakes. A hop's frames are
// COMPOSED from the bolt look's pre-baked strip pool (../boltpool.ts: warmed with the loadout and the map's spawns, in
// idle slices) — a fraction of a millisecond instead of 1-5 ms of disc stamping per hop; a look that is not baked yet
// paints the hop with the template once (as before) and queues its pool. The frames go into a pooled transient canvas
// texture (VFX_BUDGET.boltCanvases: 8 × 256², 2 × 512²), shelf-packed, uploaded by dirty rectangle like the atlas.
// When no canvas is free (or the hop does not fit) the caller draws a 2 px bead line instead.
import type Phaser from 'phaser';
import { indexFrames } from '../bake';
import { BoltPool, boltRgba, composeBolt } from '../boltpool';
import { lut as lutFor } from '../ramps';
import { VFX_BUDGET, type BakeOptions, type BoltParams, type RgbaFrame, type VfxPiece } from '../types';
import type { FrameRef, StripRef } from './atlas';

interface Slot {
  key: string;
  side: number;
  tex: Phaser.Textures.CanvasTexture;
  busy: boolean;
  names: string[];
}

let boltSeq = 0;

export class BoltCanvases {
  private slots: Slot[] = [];
  bytes = 0;
  /** Pre-baked strip pools per bolt look (run-wide, like the canvases). */
  readonly pool = new BoltPool();
  /** QA: hops baked, hops composed from the pool, and the hop bake time (compose / paint + RGBA + pack + upload). */
  readonly hopStats = { hops: 0, pooled: 0, peakMs: 0, totalMs: 0, frameMs: 0 };

  constructor(
    textures: Phaser.Textures.TextureManager,
    private gl: WebGLRenderingContext | null,
  ) {
    for (const [side, n] of Object.entries(VFX_BUDGET.boltCanvases)) {
      for (let i = 0; i < n; i++) {
        const key = `vfx_bolt_${side}_${boltSeq++}`;
        const s = Number(side);
        const tex = textures.createCanvas(key, s, s)!;
        tex.getContext().imageSmoothingEnabled = false;
        this.slots.push({ key, side: s, tex, busy: false, names: [] });
      }
    }
  }

  setGl(gl: WebGLRenderingContext | null): void {
    this.gl = gl;
  }

  get busy(): number {
    return this.slots.filter((s) => s.busy).length;
  }

  /** Bakes a bolt piece into a free canvas: its strip, or null (no canvas free / too big). Release when done. */
  bake(piece: VfxPiece, opts: BakeOptions): { strip: StripRef; release: () => void } | null {
    const t0 = performance.now();
    const prm = piece.params as BoltParams;
    const look = this.pool.look(piece.motif, prm.strength);
    if (!look) this.pool.want(piece.motif, prm.strength);
    const idx = look ? composeBolt(prm, look, opts) : indexFrames(piece, 0, opts);
    const table = lutFor(piece.ramp, opts.lut);
    const rgba = idx.map((f) => boltRgba(f, table));
    const body: RgbaFrame[] = rgba.map((f) => f.body);
    const glow: RgbaFrame[] = rgba.map((f) => f.glow);
    // Frames ready (compose / paint + RGBA); the rest is packing and the uploads.
    this.hopStats.frameMs += performance.now() - t0;
    const rects = [...body, ...glow].filter((f) => f.w && f.h);
    const done = () => {
      const ms = performance.now() - t0;
      const st = this.hopStats;
      st.hops++;
      if (look) st.pooled++;
      st.totalMs += ms;
      if (ms > st.peakMs) st.peakMs = ms;
    };
    let slot: Slot | null = null;
    let at: { x: number; y: number }[] | null = null;
    for (const sl of this.slots.filter((x) => !x.busy).sort((a, b) => a.side - b.side)) {
      at = this.pack(sl.side, rects);
      if (at) {
        slot = sl;
        break;
      }
    }
    if (!slot || !at) {
      done();
      return null;
    }
    slot.busy = true;
    for (const n of slot.names) slot.tex.remove(n);
    slot.names = [];
    // One staging image over the packed rows: one putImageData and one texture upload per hop (not two per frame).
    let usedH = 1;
    rects.forEach((f, i) => (usedH = Math.max(usedH, at![i].y + f.h)));
    const W = slot.side;
    const staging = new Uint8ClampedArray(W * usedH * 4);
    const s32 = new Uint32Array(staging.buffer);
    const refs = new Map<RgbaFrame, FrameRef>();
    rects.forEach((f, i) => {
      const p = at![i];
      const name = `b${boltSeq++}`;
      slot!.tex.add(name, 0, p.x, p.y, f.w, f.h);
      slot!.names.push(name);
      const src = new Uint32Array(f.data.buffer, f.data.byteOffset, f.w * f.h);
      for (let y = 0; y < f.h; y++) s32.set(src.subarray(y * f.w, (y + 1) * f.w), (p.y + y) * W + p.x);
      refs.set(f, { tex: slot!.key, name, page: -2, w: f.w, h: f.h, ox: f.ox, oy: f.oy, ms: f.ms });
    });
    slot.tex.getContext().putImageData(new ImageData(staging as unknown as Uint8ClampedArray<ArrayBuffer>, W, usedH), 0, 0);
    this.upload(slot, 0, 0, { w: W, h: usedH, data: staging });
    const ref = (f: RgbaFrame): FrameRef => refs.get(f) ?? { tex: '', name: '', page: -1, w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms };
    const strip: StripRef = { frames: body.map(ref), glow: glow.map(ref), totalMs: body.reduce((a, f) => a + f.ms, 0) };
    done();
    return { strip, release: () => (slot.busy = false) };
  }

  /** Row packing of rectangles into a side² canvas (null when they do not fit). */
  private pack(side: number, rects: readonly RgbaFrame[]): { x: number; y: number }[] | null {
    const out: { x: number; y: number }[] = [];
    let x = 0;
    let y = 0;
    let row = 0;
    for (const r of rects) {
      const w = r.w + 2;
      const h = r.h + 2;
      if (w > side) return null;
      if (x + w > side) {
        x = 0;
        y += row;
        row = 0;
      }
      if (y + h > side) return null;
      out.push({ x, y });
      x += w;
      row = Math.max(row, h);
    }
    return out;
  }

  private upload(slot: Slot, x: number, y: number, f: { w: number; h: number; data: Uint8ClampedArray }): void {
    this.bytes += f.w * f.h * 4;
    const gl = this.gl;
    if (!gl || gl.isContextLost()) return;
    const wrapper = (slot.tex.source[0] as unknown as { glTexture?: { webGLTexture?: WebGLTexture | null; pma?: boolean } }).glTexture;
    const tex = wrapper?.webGLTexture;
    if (!tex) return;
    gl.activeTexture(gl.TEXTURE0);
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!wrapper?.pma);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, f.w, f.h, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(f.data.buffer, f.data.byteOffset, f.data.byteLength));
    gl.bindTexture(gl.TEXTURE_2D, prev);
  }

  destroy(textures: Phaser.Textures.TextureManager): void {
    for (const s of this.slots) textures.remove(s.key);
    this.slots = [];
  }
}
