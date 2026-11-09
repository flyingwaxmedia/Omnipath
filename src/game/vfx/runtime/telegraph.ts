// TelegraphFx (docs/VFX.md §6.5, §8.3, §13 item 1): monster technique tells at the exact hit-test geometry. Each
// live tell rasterises its shape (../tellraster.ts) into a pooled canvas texture with three regions — the danger
// fill (DEPTH.TELEGRAPH, under bodies), the rim (DEPTH.TELL_TOP: above canopies, glow and darkness) and an off-view
// edge marker — and re-uploads only what changed, by dirty rectangle, at most 15 times a second (a shared per-frame
// upload budget defers a re-raster to the next frame; the previous frame keeps showing, never blank).
//
// Progress always comes from the phase's live timing record (scene time; MonsterSkills.shiftTime moves it through
// panel pauses and hit-stops), never from a VFX timer, so the lock flash lands on the hit. Geometry is read live
// every frame: a pure translation (the caster pushed mid wind-up) only moves the images; a changed shape (an aim
// line following the player) re-rasterises. Tells are never governed, culled or dropped.
import Phaser from 'phaser';
import { DEPTH } from '../../render/depths';
import { lut } from '../ramps';
import type { TellSpec } from '../play';
import { TellRaster, localTell, rimTint } from '../tellraster';
import { IDX } from '../types';

/** Per-frame upload budget for tells (bytes), on top of the atlas's. */
const TELL_UPLOAD_BYTES = 512 * 1024;
const EDGE = 13;
const GAP = 2;

interface Slot {
  key: string;
  tex: Phaser.Textures.CanvasTexture;
  W: number;
  H: number;
  busy: boolean;
}

let canvasSeq = 0;

/** Run-wide pool of tell canvases (textures outlive map restarts). */
export class TellCanvases {
  private slots: Slot[] = [];
  bytes = 0;
  constructor(
    private readonly textures: Phaser.Textures.TextureManager,
    private gl: WebGLRenderingContext | null,
  ) {}

  setGl(gl: WebGLRenderingContext | null): void {
    this.gl = gl;
  }

  get busy(): number {
    return this.slots.filter((s) => s.busy).length;
  }

  get count(): number {
    return this.slots.length;
  }

  get(w: number, h: number): Slot {
    const W = Math.ceil(w / 64) * 64;
    const H = Math.ceil(h / 64) * 64;
    let best: Slot | undefined;
    for (const s of this.slots) {
      if (s.busy || s.W < W || s.H < H || s.W * s.H > W * H * 2.5) continue;
      if (!best || s.W * s.H < best.W * best.H) best = s;
    }
    if (best) {
      best.busy = true;
      return best;
    }
    const key = `vfx_tell_${canvasSeq++}`;
    const tex = this.textures.createCanvas(key, W, H)!;
    tex.getContext().imageSmoothingEnabled = false;
    const slot: Slot = { key, tex, W, H, busy: true };
    this.slots.push(slot);
    return slot;
  }

  put(slot: Slot): void {
    slot.busy = false;
    // Keep a few free canvases; drop the largest extras.
    const free = this.slots.filter((s) => !s.busy).sort((a, b) => b.W * b.H - a.W * a.H);
    while (free.length > 8) {
      const s = free.shift()!;
      this.textures.remove(s.key);
      this.slots.splice(this.slots.indexOf(s), 1);
    }
  }

  private scratch = new Uint32Array(4096);

  /** Uploads rectangle `q` of a region (row stride `stride`) placed at (x0, y0); returns the bytes sent. */
  uploadRect(slot: Slot, x0: number, y0: number, stride: number, data: Uint32Array, q: { x: number; y: number; w: number; h: number }): number {
    const n = q.w * q.h;
    if (this.scratch.length < n) this.scratch = new Uint32Array(n);
    const buf = this.scratch.subarray(0, n);
    for (let j = 0; j < q.h; j++) buf.set(data.subarray((q.y + j) * stride + q.x, (q.y + j) * stride + q.x + q.w), j * q.w);
    this.upload(slot, x0 + q.x, y0 + q.y, q.w, q.h, buf);
    return n * 4;
  }

  /** Writes a region (RGBA words) at (x, y): texSubImage2D on WebGL, putImageData on the Canvas renderer. */
  upload(slot: Slot, x: number, y: number, w: number, h: number, data: Uint32Array): void {
    this.bytes += w * h * 4;
    const bytes = new Uint8Array(data.buffer, data.byteOffset, w * h * 4);
    const gl = this.gl;
    if (!gl) {
      slot.tex.getContext().putImageData(new ImageData(new Uint8ClampedArray(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength), w, h), x, y);
      return;
    }
    if (gl.isContextLost()) return;
    const wrapper = (slot.tex.source[0] as unknown as { glTexture?: { webGLTexture?: WebGLTexture | null; pma?: boolean } }).glTexture;
    const tex = wrapper?.webGLTexture;
    if (!tex) return;
    gl.activeTexture(gl.TEXTURE0);
    const prev = gl.getParameter(gl.TEXTURE_BINDING_2D) as WebGLTexture | null;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, !!wrapper?.pma);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texSubImage2D(gl.TEXTURE_2D, 0, x, y, w, h, gl.RGBA, gl.UNSIGNED_BYTE, bytes);
    gl.bindTexture(gl.TEXTURE_2D, prev);
  }
}

/** The 13 × 13 off-view edge marker (danger disc with a '!'), drawn once per canvas. */
function edgeMarker(): Uint32Array {
  const d = lut('danger', 'base');
  const out = new Uint32Array(EDGE * EDGE);
  const c = (EDGE - 1) / 2;
  for (let j = 0; j < EDGE; j++)
    for (let i = 0; i < EDGE; i++) {
      const r = Math.hypot(i - c, j - c);
      let v = 0;
      if (r <= 4.6) v = d[IDX.R2];
      else if (r <= 5.6) v = d[IDX.R4];
      else if (r <= 6.5) v = d[IDX.OUTLINE];
      if (i === c && ((j >= c - 3 && j <= c + 1) || j === c + 3)) v = d[IDX.ACCENT];
      out[j * EDGE + i] = v;
    }
  return out;
}
const EDGE_PIX = edgeMarker();

class TellInst {
  private raster: TellRaster | null = null;
  private shapeKey = '';
  private slot: Slot | null = null;
  private fillImg: Phaser.GameObjects.Image | null = null;
  private rimImg: Phaser.GameObjects.Image | null = null;
  private edgeImg: Phaser.GameObjects.Image | null = null;
  private dissolve = 0;
  private drawn = false;
  private readonly born: number;
  ended = false;
  dead = false;

  constructor(
    private readonly fx: TelegraphFx,
    readonly spec: TellSpec,
    now: number,
  ) {
    this.born = now;
  }

  update(now: number): void {
    if (this.dead) return;
    const ph = this.spec.phase();
    const cancelled = this.ended || ph?.state === 'cancelled';
    if (!ph && !cancelled) return this.kill();
    if (cancelled) {
      // Interrupt / death: two dithered-out frames, then gone (the bridge plays the fizzle).
      this.dissolve++;
      if (this.dissolve > 2) return this.kill();
    }
    const g = this.spec.geom();
    if (!g) return this.kill();
    const { anchor, local, key } = localTell(g);
    if (key !== this.shapeKey || !this.raster) {
      // Shape changed: a new raster (and canvas when the size grew).
      this.shapeKey = key;
      this.raster = new TellRaster(local, this.spec.look);
      this.drawn = false;
      this.layout();
    }
    const r = this.raster;
    const slot = this.slot!;
    const t = ph ? Math.max(0, Math.min(1, (now - ph.start) / Math.max(1, ph.at - ph.start))) : 1;
    const leftMs = ph ? ph.at - now : 0;
    const need = r.w * r.h * 4 * (r.fill ? 1 : 0) + r.rimRects.reduce((a, q) => a + q.w * q.h * 4, 0);
    if (!this.drawn || this.dissolve || this.fx.uploadLeft >= need) {
      this.drawn = true;
      const ch = r.render({ t, ms: now - this.born, dissolve: this.dissolve as 0 | 1 | 2 });
      if (ch.fill && r.fill) for (const q of r.fillDirty) this.fx.uploadLeft -= this.fx.canvases.uploadRect(slot, 0, 0, r.w, r.fill, q);
      if (ch.rim) {
        // Only the stripes that hold rim pixels (the rest of the box never changes).
        for (const q of r.rimRects) this.fx.uploadLeft -= this.fx.canvases.uploadRect(slot, 0, this.rimY(), r.w, r.rim, q);
      }
    }
    const x = Math.round(anchor.x) - r.ox;
    const y = Math.round(anchor.y) - r.oy;
    if (r.fill) {
      this.fillImg ??= this.fx.image(slot.key, 'f', DEPTH.TELEGRAPH);
      this.fillImg.setPosition(x, y).setVisible(true);
    }
    this.rimImg ??= this.fx.image(slot.key, 'r', DEPTH.TELL_TOP);
    this.rimImg.setPosition(x, y).setVisible(true).setTint(rimTint(t, leftMs, this.spec.look.danger, this.spec.look.family));
    this.edge(anchor, r);
  }

  private rimY(): number {
    const r = this.raster!;
    return r.fill ? r.h + GAP : 0;
  }

  /** (Re)binds a canvas big enough for fill + rim + edge marker and names the frames. */
  private layout(): void {
    const r = this.raster!;
    const w = Math.max(r.w, EDGE);
    const h = (r.fill ? r.h * 2 + GAP : r.h) + GAP + EDGE;
    const c = this.fx.canvases;
    if (!this.slot || this.slot.W < w || this.slot.H < h) {
      if (this.slot) c.put(this.slot);
      this.slot = c.get(w, h);
      this.fillImg = this.fx.release(this.fillImg);
      this.rimImg = this.fx.release(this.rimImg);
      this.edgeImg = this.fx.release(this.edgeImg);
    }
    const tex = this.slot.tex;
    for (const n of ['f', 'r', 'e']) if (tex.has(n)) tex.remove(n);
    if (r.fill) tex.add('f', 0, 0, 0, r.w, r.h);
    tex.add('r', 0, 0, this.rimY(), r.w, r.h);
    const ey = this.rimY() + r.h + GAP;
    tex.add('e', 0, 0, ey, EDGE, EDGE);
    // Clear the regions (a reused canvas may hold an older tell) and draw the marker.
    const blank = new Uint32Array(r.w * r.h);
    if (r.fill) c.upload(this.slot, 0, 0, r.w, r.h, blank);
    c.upload(this.slot, 0, this.rimY(), r.w, r.h, blank);
    c.upload(this.slot, 0, ey, EDGE, EDGE, EDGE_PIX);
    // Frames changed under the images: re-bind them.
    this.fillImg?.setFrame('f');
    this.rimImg?.setFrame('r');
    this.edgeImg?.setFrame('e');
  }

  /** Off-view tells show a marker at the view edge, toward the danger (docs/VFX.md §6.5). */
  private edge(anchor: { x: number; y: number }, r: TellRaster): void {
    const v = this.fx.view();
    const x0 = Math.round(anchor.x) - r.ox;
    const y0 = Math.round(anchor.y) - r.oy;
    const off = x0 + r.w < v.x || x0 > v.x + v.width || y0 + r.h < v.y || y0 > v.y + v.height;
    if (!off) {
      this.edgeImg?.setVisible(false);
      return;
    }
    this.edgeImg ??= this.fx.image(this.slot!.key, 'e', DEPTH.TELL_TOP);
    const m = 8;
    const ex = Math.max(v.x + m, Math.min(v.x + v.width - m - EDGE, Math.round(anchor.x) - (EDGE >> 1)));
    const ey = Math.max(v.y + m, Math.min(v.y + v.height - m - EDGE, Math.round(anchor.y) - (EDGE >> 1)));
    this.edgeImg.setPosition(Math.round(ex), Math.round(ey)).setVisible(true);
  }

  kill(): void {
    if (this.dead) return;
    this.dead = true;
    this.fillImg = this.fx.release(this.fillImg);
    this.rimImg = this.fx.release(this.rimImg);
    this.edgeImg = this.fx.release(this.edgeImg);
    if (this.slot) this.fx.canvases.put(this.slot);
    this.slot = null;
  }
}

export class TelegraphFx {
  private insts: TellInst[] = [];
  private free: Phaser.GameObjects.Image[] = [];
  /** Bytes the tells may still upload this frame. */
  uploadLeft = TELL_UPLOAD_BYTES;
  peak = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly canvases: TellCanvases,
  ) {}

  get live(): number {
    return this.insts.length;
  }

  add(spec: TellSpec): { end(): void; readonly done: boolean } {
    const inst = new TellInst(this, spec, this.scene.time.now);
    this.insts.push(inst);
    this.peak = Math.max(this.peak, this.insts.length);
    inst.update(this.scene.time.now);
    return {
      end: () => {
        inst.ended = true;
      },
      get done() {
        return inst.dead;
      },
    };
  }

  /** Once per frame (after the systems moved): progress, geometry, uploads. */
  update(): void {
    this.uploadLeft = TELL_UPLOAD_BYTES;
    const now = this.scene.time.now;
    for (const i of this.insts) {
      try {
        i.update(now);
      } catch (err) {
        console.error('[omnipath] telegraph failed', err);
        i.kill();
      }
    }
    if (this.insts.some((i) => i.dead)) this.insts = this.insts.filter((i) => !i.dead);
  }

  view(): Phaser.Geom.Rectangle {
    return this.scene.cameras.main.worldView;
  }

  image(tex: string, frame: string, depth: number): Phaser.GameObjects.Image {
    const img = this.free.pop() ?? this.scene.add.image(0, 0, tex, frame).setOrigin(0, 0);
    img.setTexture(tex, frame).setDepth(depth).setVisible(true).setAlpha(1).clearTint();
    return img;
  }

  release(img: Phaser.GameObjects.Image | null): null {
    if (img) {
      img.setVisible(false);
      this.free.push(img);
    }
    return null;
  }

  destroy(): void {
    for (const i of this.insts) i.kill();
    this.insts = [];
    for (const img of this.free) img.destroy();
    this.free = [];
  }
}
