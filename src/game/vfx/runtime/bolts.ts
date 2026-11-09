// Live bolt strips (docs/VFX.md §8.5): chain hops and arc zaps are the only cast-time bakes. Each hop rasterises
// into a pooled transient canvas texture (VFX_BUDGET.boltCanvases: 8 × 256², 2 × 512²), its frames shelf-packed,
// and uploads by dirty rectangle like the atlas. When no canvas is free (or the hop does not fit) the caller draws a
// 2 px bead line instead.
import type Phaser from 'phaser';
import { colourise, glowTwin, indexFrames } from '../bake';
import { lut as lutFor } from '../ramps';
import { VFX_BUDGET, type BakeOptions, type RgbaFrame, type VfxPiece } from '../types';
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
    const idx = indexFrames(piece, 0, opts);
    const table = lutFor(piece.ramp, opts.lut);
    const body: RgbaFrame[] = idx.map((f) => colourise(f, table));
    const glow: RgbaFrame[] = idx.map((f) => glowTwin(f));
    const rects = [...body, ...glow].filter((f) => f.w && f.h);
    const slot = this.slots
      .filter((s) => !s.busy)
      .sort((a, b) => a.side - b.side)
      .find((s) => this.pack(s.side, rects) !== null);
    if (!slot) return null;
    const at = this.pack(slot.side, rects)!;
    slot.busy = true;
    const ctx = slot.tex.getContext();
    ctx.clearRect(0, 0, slot.side, slot.side);
    for (const n of slot.names) slot.tex.remove(n);
    slot.names = [];
    const refs = new Map<RgbaFrame, FrameRef>();
    rects.forEach((f, i) => {
      const p = at[i];
      const name = `b${boltSeq++}`;
      slot.tex.add(name, 0, p.x, p.y, f.w, f.h);
      slot.names.push(name);
      ctx.putImageData(new ImageData(f.data as unknown as Uint8ClampedArray<ArrayBuffer>, f.w, f.h), p.x, p.y);
      this.upload(slot, p.x, p.y, f);
      refs.set(f, { tex: slot.key, name, page: -2, w: f.w, h: f.h, ox: f.ox, oy: f.oy, ms: f.ms });
    });
    const ref = (f: RgbaFrame): FrameRef => refs.get(f) ?? { tex: '', name: '', page: -1, w: 0, h: 0, ox: f.ox, oy: f.oy, ms: f.ms };
    const strip: StripRef = { frames: body.map(ref), glow: glow.map(ref), totalMs: body.reduce((a, f) => a + f.ms, 0) };
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

  private upload(slot: Slot, x: number, y: number, f: RgbaFrame): void {
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
