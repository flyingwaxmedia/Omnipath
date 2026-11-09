// The VFX runtime (docs/VFX.md §8): plays recipe pieces in a Phaser scene. It owns no gameplay: the bus bridge
// (../bridge.ts) calls play(pieces, ctx) on game events and the runtime places, times, pools and governs them.
//
// - Atlas: run-wide canvas pages, baked lazily and time-sliced (baker.ts), uploaded by dirty rectangle (atlas.ts).
//   A strip that is not ready plays the family fallback (a steel burst tint-filled in the family R3, a steel charge
//   orb for loops): never blank, never a stall.
// - Strips play with per-frame durations on the world clock (scene time minus pauses and hit-stops).
// - Body pieces y-sort with ySort(anchor y ± 1, bias); rings and auras round an actor split into a back half (y - 1)
//   and a front half (y + 1); glow twins are white, tinted family R4 and drawn in ONE shared ADD Layer (front halves
//   only), moved above the darkness on dark maps; ground decals use MULTIPLY for scorch / ink.
// - Rings wider than RING_WHOLE_MAX, and aim-relative arcs, are placed from baked 10 px band chunks (Blitter bobs).
// - Motes are particles on shared Blitters (closed-form motion, age-stepped frames), spawned by pattern or by
//   distance travelled (trails). Afterimages snapshot the actor's own frame (tint-filled, stepped alpha).
// - Quality governor: an EMA of the frame time degrades counts, chunks, trails, decals and glow before the frame rate
//   drops; the Canvas renderer runs at the lowest tier. Telegraph pieces are never governed.
import Phaser from 'phaser';
import { hashSeed, mulberry32 } from '../../../core/rng';
import { DEPTH, VFX_DEPTH, Y_BIAS, ySort } from '../../render/depths';
import type { GhostSource, LivePt, PlayCtx, VfxGroup, VfxStage } from '../play';
import { RAMPS, hexToRgb } from '../ramps';
import {
  RING_WHOLE_MAX,
  VFX_BUDGET,
  VFX_GOVERNOR,
  pickDir,
  type BakeOptions,
  type DirPick,
  type FamilyId,
  type Pt,
  type RampId,
  type RingInk,
  type VfxBiomeProfile,
  type VfxLayer,
  type VfxPiece,
  type VfxPieceOf,
  type VfxQuality,
} from '../types';
import { TEMPLATES } from '../components';
import { Atlas, type AtlasEntry, type FrameRef, type StripRef } from './atlas';
import { Baker, bakeReq, type BakeReq } from './baker';
import { BoltCanvases } from './bolts';
import { freePos, launch, scaledCount, spotMotion, spots, type Launch, type Rng } from './place';
import { BobPool, ImagePool } from './pools';
import { vfxSettings } from './settings';

const TAU = Math.PI * 2;
const RING_INKS: readonly RingInk[] = ['hot', 'lit', 'mid', 'dim'];
/** Mote blitters sit above the y-sorted world (shared emitters cannot y-sort) and under canopies / rims. */
const MOTE_DEPTH = VFX_DEPTH.FX_MOTES;

type RingPiece = VfxPieceOf<'ring'>;

const colorOf = (ramp: RampId, i: number): number => {
  const [r, g, b] = hexToRgb(RAMPS[ramp].R[i]);
  return (r << 16) | (g << 8) | b;
};

/** Biome contrast profiles (docs/VFX.md §3.5). */
export function biomeProfile(biome: string, dark: boolean): VfxBiomeProfile {
  if (dark || biome === 'cave' || biome === 'crypt') return { keyline: ['shadow', 'stealth', 'twilight'], glowGain: 1, dark: true };
  if (biome === 'frost' || biome === 'plateau') return { keyline: ['ice', 'storm', 'steel', 'water', 'holy', 'spirit', 'lightning'], glowGain: 0.6, dark: false };
  if (biome === 'ember' || biome === 'basalt') return { keyline: ['fire', 'magma', 'holy', 'lightning'], glowGain: 0.6, dark: false };
  return { keyline: [], glowGain: 0.6, dark: false };
}

// ------------------------------------------------------------------ shared, run-wide state

interface Shared {
  atlas: Atlas;
  baker: Baker;
  bolts: BoltCanvases;
}
const SHARED = new WeakMap<Phaser.Game, Shared>();

function sharedFor(scene: Phaser.Scene): Shared {
  const game = scene.game;
  let s = SHARED.get(game);
  const gl = scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer ? scene.sys.renderer.gl : null;
  if (!s) {
    const atlas = new Atlas(game.textures, gl);
    const baker = new Baker(atlas, () => performance.now());
    s = { atlas, baker, bolts: new BoltCanvases(game.textures, gl) };
    SHARED.set(game, s);
  } else {
    s.atlas.setGl(gl);
    s.bolts.setGl(gl);
  }
  return s;
}

// ------------------------------------------------------------------ groups & instances

class Group implements VfxGroup {
  insts: Inst[] = [];
  ended = false;
  constructor(readonly ctx: PlayCtx) {}
  end(): void {
    this.ended = true;
  }
  get done(): boolean {
    return this.insts.every((i) => i.dead);
  }
}

abstract class Inst {
  dead = false;
  constructor(
    protected readonly rt: VfxRuntime,
    readonly group: Group,
    /** World ms at which the instance starts. */
    readonly t0: number,
  ) {}
  abstract update(now: number): void;
  abstract destroy(): void;
  /** Atlas keys in use (never evicted while live). */
  keys(): readonly string[] {
    return [];
  }
}

/** Where a piece instance is drawn: anchor point (world px), sort y, and the heading. */
interface Where {
  pos(t: number): Pt | null;
  sortY(): number;
}

interface SpriteOpts {
  layer: VfxLayer;
  blend: 'normal' | 'add' | 'multiply';
  bias: number;
  /** Half offset for depth (-1 back, +1 front, 0 whole). */
  half: -1 | 0 | 1;
  glow: boolean;
  /** Loop life (ms) or null (one-shot / alive()). */
  life: number | null;
  dir: DirPick | (() => DirPick);
  fallback: 'burst' | 'orb' | null;
  /** Family colour for the fallback (R3). */
  tint: number;
  /** Image tier for the pool. */
  tier: 'body' | 'ground';
  /** Hold the first frame this long (victim hit-stop on the impact spark). */
  holdMs?: number;
  /** Counts toward a target's spark cap. */
  spark?: object;
}

class SpriteInst extends Inst {
  private img: Phaser.GameObjects.Image | null = null;
  private glowImg: Phaser.GameObjects.Image | null = null;
  private usingFallback = false;
  private started = false;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    readonly piece: VfxPiece,
    readonly req: BakeReq,
    private readonly where: Where,
    private readonly o: SpriteOpts,
  ) {
    super(rt, group, t0);
    if (o.spark) rt.sparkAdd(o.spark, 1);
  }

  keys(): readonly string[] {
    return [this.req.key];
  }

  update(now: number): void {
    let t = now - this.t0;
    if (t < 0) return this.hide();
    const rt = this.rt;
    const loop = this.req.piece.component !== 'motes' && rt.useOf(this.req) !== 'once';
    if (loop && ((this.o.life !== null && t >= this.o.life) || this.group.ended || (this.o.life === null && this.group.ctx.alive && !this.group.ctx.alive()))) {
      this.dead = true;
      return;
    }
    let e = rt.ready(this.req);
    const dir = typeof this.o.dir === 'function' ? this.o.dir() : this.o.dir;
    let strip: StripRef | null = e?.strips[dir.u] ?? null;
    let tintFill = 0;
    let useT = t;
    if (!strip) {
      if (!this.started && this.o.fallback && (this.o.fallback === 'orb' || loop || t < 120)) {
        // The family fallback: never blank. One-shots commit to it; loops swap to the real strip once baked.
        const fb = rt.fallback(this.o.fallback);
        strip = fb?.strips[0] ?? null;
        if (strip) {
          this.usingFallback = this.o.fallback === 'burst';
          tintFill = this.o.tint;
          e = fb;
          if (this.usingFallback) this.started = true;
        }
      } else if (!this.started && !loop && t > 160) {
        this.dead = true;
        return;
      }
      if (!strip) return this.hide();
    } else if (this.usingFallback) {
      const fb = rt.fallback('burst');
      strip = fb?.strips[0] ?? null;
      tintFill = this.o.tint;
      if (!strip) return this.hide();
    } else if (!this.started) {
      this.started = true;
    }
    if (e) rt.touch(e, now);
    // Victim hit-stop: the spark holds its hero frame.
    if (this.o.holdMs && useT < this.o.holdMs) useT = 0;
    else if (this.o.holdMs) useT -= this.o.holdMs;
    const use = this.usingFallback ? 'once' : (e?.use ?? 'once');
    const k = frameAt(strip, use, useT, loop);
    if (k < 0) {
      if (!loop) this.dead = true;
      return this.hide();
    }
    const p = this.where.pos(t);
    if (!p) return this.hide();
    const f = strip.frames[k];
    if (!f.w) return this.hide();
    const depth = rt.depthFor(this.o.layer, this.where.sortY() + this.o.half, this.o.bias);
    this.img = this.place(this.img, f, p, dir, depth, this.o.layer === 'glow' || this.o.layer === 'light' ? 'glow' : this.o.tier);
    if (!this.img) return;
    if (tintFill) this.img.setTintFill(tintFill);
    else if (this.img.isTinted) this.img.clearTint();
    const blend = this.o.layer === 'glow' || this.o.layer === 'light' ? Phaser.BlendModes.ADD : this.o.blend === 'multiply' ? Phaser.BlendModes.MULTIPLY : Phaser.BlendModes.NORMAL;
    if (this.img.blendMode !== blend) this.img.setBlendMode(blend);
    if (this.o.layer === 'glow' || this.o.layer === 'light') this.img.setAlpha(rt.profile.glowGain);
    // Glow twin (front halves and whole pieces only; not on the ground; dropped at the lowest quality tier).
    const g = this.o.glow && !tintFill && rt.glowOn ? strip.glow?.[k] : undefined;
    if (g && g.w) {
      this.glowImg = this.place(this.glowImg, g, p, dir, 0, 'glow');
      if (this.glowImg) {
        this.glowImg.setTint(rt.glowTint(this.req.piece.ramp)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(rt.profile.glowGain);
      }
    } else if (this.glowImg) {
      rt.pool('glow').put(this.glowImg);
      this.glowImg = null;
    }
  }

  private place(img: Phaser.GameObjects.Image | null, f: FrameRef, p: Pt, dir: DirPick, depth: number, tier: 'body' | 'ground' | 'glow'): Phaser.GameObjects.Image | null {
    const pool = this.rt.pool(tier);
    if (!img) {
      img = pool.get(f.tex, f.name);
      if (!img) return null;
    } else if (img.texture.key !== f.tex || img.frame.name !== f.name) img.setTexture(f.tex, f.name);
    const ax = Math.round(p.x);
    const ay = Math.round(p.y);
    const x = dir.flipX ? ax - (f.w - 1 - f.ox) : ax - f.ox;
    const y = dir.flipY ? ay - (f.h - 1 - f.oy) : ay - f.oy;
    img.setPosition(x, y).setFlip(dir.flipX, dir.flipY).setVisible(true);
    if (tier !== 'glow' && img.depth !== depth) img.setDepth(depth);
    return img;
  }

  private hide(): void {
    this.img?.setVisible(false);
    this.glowImg?.setVisible(false);
  }

  destroy(): void {
    this.rt.pool(this.o.layer === 'glow' || this.o.layer === 'light' ? 'glow' : this.o.tier).put(this.img);
    this.rt.pool('glow').put(this.glowImg);
    this.img = this.glowImg = null;
    if (this.o.spark) this.rt.sparkAdd(this.o.spark, -1);
  }
}

/** Frame index of a strip at time t (-1 = finished one-shot). */
function frameAt(s: StripRef, use: string, t: number, loop: boolean): number {
  const n = s.frames.length;
  if (!n) return -1;
  if (use === 'pieces') return Math.floor(t / 67) % n;
  if (use === 'once' && !loop && t >= s.totalMs) return -1;
  let tt = use === 'once' ? Math.min(t, s.totalMs - 1) : t % Math.max(1, s.totalMs);
  for (let k = 0; k < n; k++) {
    tt -= s.frames[k].ms;
    if (tt < 0) return k;
  }
  return n - 1;
}

/** Rings placed from 10 px band chunks (r > RING_WHOLE_MAX, aim-relative arcs). */
class ChunkRingInst extends Inst {
  private bobs: Phaser.GameObjects.Bob[] = [];
  private glowBobs: Phaser.GameObjects.Bob[] = [];
  private privates = new Map<string, Phaser.GameObjects.Blitter>();
  private readonly reqs: Map<RingInk, BakeReq>;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly piece: RingPiece,
    private readonly where: Where,
    private readonly o: { layer: VfxLayer; r: number; arcRel: readonly [number, number] | null; ang: () => number; life: number; body: boolean; glow: boolean },
  ) {
    super(rt, group, t0);
    this.reqs = new Map(rt.chunkInks(piece).map((ink) => [ink, rt.chunkReq(piece, ink)]));
  }

  keys(): readonly string[] {
    return [...this.reqs.values()].map((r) => r.key);
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return this.clearFrom(0, 0);
    const prm = this.piece.params;
    const stay = prm.anim === 'static' || prm.anim === 'march';
    if (t >= this.o.life || (stay && this.group.ended)) {
      this.dead = true;
      return;
    }
    const c = this.where.pos(t);
    if (!c) return this.clearFrom(0, 0);
    // Radius and ink by animation.
    const base = RING_INKS.indexOf(prm.ink);
    let r = this.o.r;
    let ink: RingInk = prm.ink;
    if (prm.anim === 'expand' || prm.anim === 'contract') {
      const r0 = prm.r0 ?? (prm.anim === 'contract' ? r * 1.6 : r * 0.3);
      const u = Math.min(1, t / prm.ms);
      r = r0 + (r - r0) * (1 - Math.pow(1 - u, 3));
      ink = RING_INKS[Math.min(3, base + Math.floor(u * 3))];
      if (u >= 1) {
        this.dead = true;
        return;
      }
    }
    const rx = Math.max(4, r);
    const ry = rx * prm.aspect;
    const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
    const per = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
    const N = Math.max(8, Math.ceil(per / 10));
    const aim = this.o.ang();
    const step = this.rt.quality < 1 ? 2 : 1;
    const march = Math.floor(t / 67);
    let nb = 0;
    let ng = 0;
    const sweepT = prm.anim === 'sweep' ? Math.max(1, prm.ms) : 0;
    for (let k = 0; k < N; k += step) {
      const th = (k / N) * TAU;
      // Arc filter: aim-relative arcs (cone rims, strike previews) or screen-degree arcs.
      if (prm.arc) {
        const deg = ((th - (this.o.arcRel ? aim : 0)) * 180) / Math.PI;
        const [a0, a1] = prm.arc;
        const rel = ((((deg - a0) % 360) + 360) % 360);
        if (rel > a1 - a0) continue;
      }
      if (prm.style === 'dashed' && (k + (prm.anim === 'march' ? march : 0)) % 5 >= 3) continue;
      if (prm.style === 'gapped' && k % 4 === 3) continue;
      let kInk = ink;
      if (sweepT) {
        // Ink by age since a head passed (33 ms ticks): hot 1 tick -> lit -> mid 2 -> dim 2 -> gone.
        const heads = prm.heads ?? 1;
        const T = sweepT / 33;
        const tick = t / 33;
        const rel = ((th + Math.PI / 2 + TAU) % TAU) / TAU;
        let best = -1;
        for (let j = 0; j < heads; j++) {
          const tau = ((rel - j / heads + 1) % 1) * T;
          if (tau <= tick && tau > best) best = tau;
        }
        if (best < 0) continue;
        const age = tick - best;
        if (age >= 6) continue;
        kInk = RING_INKS[Math.min(3, base + (age < 1 ? 0 : age < 2 ? 1 : age < 4 ? 2 : 3))];
        if (t > sweepT + 200) {
          this.dead = true;
          return;
        }
      }
      const req = this.reqs.get(kInk);
      const e = req && this.rt.ready(req);
      if (!e) continue;
      this.rt.touch(e, now);
      const nAng = Math.atan2(Math.sin(th) / ry, Math.cos(th) / rx);
      const pick = pickDir(nAng, 16);
      const s = e.strips[pick.u];
      const f = s?.frames[0];
      if (!f?.w) continue;
      const px = Math.round(c.x + Math.cos(th) * rx);
      const py = Math.round(c.y + Math.sin(th) * ry);
      const back = Math.sin(th) < 0;
      const bl = this.blitterFor(f.tex, back, c);
      const x = pick.flipX ? px - (f.w - 1 - f.ox) : px - f.ox;
      const y = pick.flipY ? py - (f.h - 1 - f.oy) : py - f.oy;
      nb = this.setBob(this.bobs, nb, bl, f, x, y, pick);
      const g = s?.glow?.[0];
      if (g?.w && this.o.glow && !back && this.rt.glowOn) {
        const gb = this.rt.bobs.sharedFor('glow', g.tex, 0, true, this.rt.profile.glowGain);
        const gx = pick.flipX ? px - (g.w - 1 - g.ox) : px - g.ox;
        const gy = pick.flipY ? py - (g.h - 1 - g.oy) : py - g.oy;
        const before = ng;
        ng = this.setBob(this.glowBobs, ng, gb, g, gx, gy, pick);
        if (ng > before) this.glowBobs[ng - 1].tint = this.rt.glowTint(this.piece.ramp);
      }
    }
    this.clearFrom(nb, ng);
  }

  private setBob(list: Phaser.GameObjects.Bob[], i: number, bl: Phaser.GameObjects.Blitter, f: FrameRef, x: number, y: number, pick: DirPick): number {
    let bob = list[i];
    if (bob && bob.parent !== bl) {
      this.rt.bobs.freeBob(bob);
      list.splice(i, 1);
      bob = undefined as unknown as Phaser.GameObjects.Bob;
    }
    if (!bob) {
      const nb = this.rt.bobs.bob(bl, f.name, x, y);
      if (!nb) return i;
      list.splice(i, 0, nb);
      bob = nb;
    } else bob.reset(x, y, f.name);
    bob.setFlip(pick.flipX, pick.flipY);
    return i + 1;
  }

  private blitterFor(tex: string, back: boolean, c: Pt): Phaser.GameObjects.Blitter {
    const L = this.o.layer;
    if (!this.o.body) {
      const depth = L === 'preview' ? DEPTH.AIM_PREVIEW : L === 'tell' ? DEPTH.TELEGRAPH : L === 'rim' ? DEPTH.TELL_TOP : DEPTH.FX_GROUND;
      return this.rt.bobs.sharedFor(L, tex, depth, false);
    }
    const k = `${tex}|${back ? 'b' : 'f'}`;
    let b = this.privates.get(k);
    if (!b) {
      b = this.rt.bobs.acquire(tex);
      this.privates.set(k, b);
    }
    b.setDepth(ySort(this.where.sortY() + (back ? -1 : 1), back ? 0 : Y_BIAS.ARC));
    void c;
    return b;
  }

  private clearFrom(nb: number, ng: number): void {
    for (const b of this.bobs.splice(nb)) this.rt.bobs.freeBob(b);
    for (const b of this.glowBobs.splice(ng)) this.rt.bobs.freeBob(b);
  }

  destroy(): void {
    this.clearFrom(0, 0);
    for (const b of this.privates.values()) this.rt.bobs.release(b);
    this.privates.clear();
  }
}

/** One mote particle on a shared blitter. */
interface Particle {
  req: BakeReq;
  ramp: RampId;
  slot: string;
  depth: number;
  born: number;
  l: Launch;
  /** Spawn point (free particles) or the live anchor (orbit / spiral / converge / path). */
  ox: number;
  oy: number;
  anchor: (() => Pt | null) | null;
  /** Path pattern: stream target. */
  to: (() => Pt | null) | null;
  dirAng: number;
  bob: Phaser.GameObjects.Bob | null;
  glowBob: Phaser.GameObjects.Bob | null;
  glow: boolean;
}

/** Emits a motes piece's particles over time (staggered waves, cadence repeats). */
class MotesInst extends Inst {
  private emitted = 0;
  private nextWave: number;
  private readonly n: number;
  private readonly life: number;
  private readonly cadence: number;
  private readonly until: number;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly piece: VfxPieceOf<'motes'>,
    private readonly req: BakeReq,
    private readonly where: Where,
    private readonly o: { layer: VfxLayer; ang: () => number; rng: Rng; quota: number; to: (() => Pt | null) | null; glow: boolean },
  ) {
    super(rt, group, t0);
    const pl = piece.place;
    const pat = pl?.pattern ?? 'single';
    this.n = scaledCount(pl, o.quota, rt.quality, VFX_BUDGET.perEvent.novaMotes);
    const lifeMs = piece.lifeMs ?? 400;
    const persistent = pat === 'orbit' || pat === 'converge';
    this.life = persistent ? lifeMs : Math.min(lifeMs, 600);
    const wave = this.n * (pl?.staggerMs ?? 0);
    this.cadence = !persistent && pl?.staggerMs && lifeMs >= 2 * Math.max(1, wave) ? Math.max(wave, pl.staggerMs) : 0;
    this.until = this.cadence ? lifeMs : 0;
    this.nextWave = 0;
  }

  keys(): readonly string[] {
    return [this.req.key];
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return;
    if (this.group.ended && this.piece.place?.pattern === 'orbit') {
      this.dead = true;
      return;
    }
    if (t >= this.nextWave) {
      const e = this.rt.ready(this.req);
      if (!e) {
        if (t > 200 && !this.cadence) this.dead = true;
        return;
      }
      const at = this.where.pos(t);
      if (!at) {
        this.dead = true;
        return;
      }
      this.rt.touch(e, now);
      const ang = this.o.ang();
      for (let k = 0; k < this.n; k++) {
        const l = launch(this.piece, k, this.n, ang, this.o.rng, this.life);
        this.rt.spawnParticle(this, this.req, this.piece.ramp, this.o.layer, now + l.delay, l, at, this.where, this.o.to, this.o.glow);
      }
      this.emitted++;
      if (this.cadence && t + this.cadence < this.until) this.nextWave += this.cadence;
      else this.dead = true;
    }
  }

  destroy(): void {}
}

/** Distance-spawned trail: one instance per `everyPx` travelled by the anchor (projectiles, dashes). */
class TrailInst extends Inst {
  private last: Pt | null = null;
  private acc = 0;
  private ghosts = 0;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly piece: VfxPiece,
    private readonly where: Where,
    private readonly emit: (at: Pt, ang: number, idx: number) => void,
  ) {
    super(rt, group, t0);
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return;
    const ctx = this.group.ctx;
    if (this.group.ended || (ctx.alive && !ctx.alive()) || (this.piece.lifeMs !== undefined && t > this.piece.lifeMs)) {
      this.dead = true;
      return;
    }
    const p = this.where.pos(t);
    if (!p) return;
    if (!this.last) {
      this.last = { x: p.x, y: p.y };
      return;
    }
    const every = Math.max(2, (this.piece.place?.everyPx ?? 8) / (this.rt.quality < 1 ? 0.6 : 1));
    const dx = p.x - this.last.x;
    const dy = p.y - this.last.y;
    const d = Math.hypot(dx, dy);
    this.acc += d;
    const ang = Math.atan2(dy, dx);
    let guard = 0;
    while (this.acc >= every && guard++ < 6) {
      this.acc -= every;
      const back = this.acc / Math.max(1, d);
      this.emit({ x: p.x - dx * back, y: p.y - dy * back }, ang, this.ghosts++);
    }
    this.last = { x: p.x, y: p.y };
  }

  destroy(): void {}
}

/** Afterimage: the actor's own frame, tint-filled family R3, stepped alpha (never tweened). */
class GhostInst extends Inst {
  private img: Phaser.GameObjects.Image | null = null;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly snap: { tex: string; frame: string | number; flipX: boolean; ox: number; oy: number; sx: number; sy: number; x: number; y: number },
    private readonly steps: readonly number[],
    private readonly color: number,
    private readonly stepMs = 50,
  ) {
    super(rt, group, t0);
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return;
    const k = Math.floor(t / this.stepMs);
    if (k >= this.steps.length) {
      this.dead = true;
      return;
    }
    if (!this.img) {
      this.img = this.rt.pool('body').get(this.snap.tex, String(this.snap.frame));
      if (!this.img) {
        this.dead = true;
        return;
      }
      if (this.img.texture.key !== this.snap.tex || this.img.frame.name !== String(this.snap.frame)) this.img.setTexture(this.snap.tex, this.snap.frame);
      this.img
        .setOrigin(this.snap.ox, this.snap.oy)
        .setScale(this.snap.sx, this.snap.sy)
        .setFlipX(this.snap.flipX)
        .setPosition(Math.round(this.snap.x), Math.round(this.snap.y))
        .setTintFill(this.color)
        .setDepth(ySort(this.snap.y - 1));
    }
    this.img.setAlpha(this.steps[k]);
  }

  destroy(): void {
    if (this.img) {
      this.img.setOrigin(0, 0).setScale(1, 1);
      this.rt.pool('body').put(this.img);
    }
    this.img = null;
  }
}

/** A cast-time bolt (chain hops, arc zaps) in a pooled transient canvas; bead line when none is free. */
class BoltInst extends Inst {
  private img: Phaser.GameObjects.Image | null = null;
  private glowImg: Phaser.GameObjects.Image | null = null;
  private baked: { strip: StripRef; release: () => void } | null = null;
  private tried = false;

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly piece: VfxPieceOf<'bolt'>,
    private readonly opts: BakeOptions,
    private readonly from: Pt,
  ) {
    super(rt, group, t0);
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return;
    if (!this.tried) {
      this.tried = true;
      this.baked = this.rt.bolts.bake(this.piece, this.opts);
      if (!this.baked) {
        this.rt.beadLine(this.group, now, this.from, { x: this.from.x + this.piece.params.dx, y: this.from.y + this.piece.params.dy }, this.piece.ramp);
        this.dead = true;
        return;
      }
    }
    const s = this.baked!.strip;
    const k = frameAt(s, 'once', t, false);
    if (k < 0) {
      this.dead = true;
      return;
    }
    const f = s.frames[k];
    const g = s.glow?.[k];
    this.img = this.show(this.img, f, 'body');
    this.img?.setDepth(DEPTH.FX_GLOW - 1);
    if (g?.w && this.rt.glowOn) {
      this.glowImg = this.show(this.glowImg, g, 'glow');
      this.glowImg?.setTint(this.rt.glowTint(this.piece.ramp)).setBlendMode(Phaser.BlendModes.ADD).setAlpha(this.rt.profile.glowGain);
    } else this.glowImg?.setVisible(false);
  }

  private show(img: Phaser.GameObjects.Image | null, f: FrameRef, tier: 'body' | 'glow'): Phaser.GameObjects.Image | null {
    if (!f.w) {
      img?.setVisible(false);
      return img;
    }
    if (!img) img = this.rt.pool(tier).get(f.tex, f.name);
    else img.setTexture(f.tex, f.name);
    img?.setPosition(Math.round(this.from.x) - f.ox, Math.round(this.from.y) - f.oy).setVisible(true);
    return img;
  }

  destroy(): void {
    this.rt.pool('body').put(this.img);
    this.rt.pool('glow').put(this.glowImg);
    this.img = this.glowImg = null;
    this.baked?.release();
    this.baked = null;
  }
}

/** Static bead / chevron lines from tell 'pieces' strips (dash lane preview edges, returns tethers, bolt fallbacks). */
class BeadInst extends Inst {
  private bobs: Phaser.GameObjects.Bob[] = [];

  constructor(
    rt: VfxRuntime,
    group: Group,
    t0: number,
    private readonly req: BakeReq,
    private readonly o: { layer: VfxLayer; life: number | null; points: (t: number) => Pt[]; dir: DirPick; tell: boolean },
  ) {
    super(rt, group, t0);
  }

  keys(): readonly string[] {
    return [this.req.key];
  }

  update(now: number): void {
    const t = now - this.t0;
    if (t < 0) return;
    const ctx = this.group.ctx;
    if ((this.o.life !== null && t >= this.o.life) || this.group.ended || (this.o.life === null && ctx.alive && !ctx.alive())) {
      this.dead = true;
      return;
    }
    const e = this.rt.ready(this.req);
    if (!e) return;
    this.rt.touch(e, now);
    const s = e.strips[this.o.dir.u];
    if (!s) return;
    const f = s.frames[Math.floor(t / 67) % s.frames.length];
    if (!f?.w) return;
    const L = this.o.layer;
    const depth = L === 'preview' ? DEPTH.AIM_PREVIEW : L === 'tell' ? DEPTH.TELEGRAPH : L === 'rim' ? DEPTH.TELL_TOP : L === 'ground' ? DEPTH.FX_GROUND : DEPTH.FX_FRONT;
    const bl = this.rt.bobs.sharedFor(`bead:${L}`, f.tex, depth, false);
    const pts = this.o.points(t);
    let i = 0;
    for (const p of pts) {
      const x = Math.round(p.x) - f.ox;
      const y = Math.round(p.y) - f.oy;
      let bob = this.bobs[i];
      if (bob && bob.parent !== bl) {
        this.rt.bobs.freeBob(bob, this.o.tell);
        this.bobs.splice(i, 1);
        bob = undefined as unknown as Phaser.GameObjects.Bob;
      }
      if (!bob) {
        const nb = this.rt.bobs.bob(bl, f.name, x, y, this.o.tell);
        if (!nb) break;
        this.bobs.splice(i, 0, nb);
        bob = nb;
      } else bob.reset(x, y, f.name);
      bob.setFlip(this.o.dir.flipX, this.o.dir.flipY);
      i++;
    }
    for (const b of this.bobs.splice(i)) this.rt.bobs.freeBob(b, this.o.tell);
  }

  destroy(): void {
    for (const b of this.bobs.splice(0)) this.rt.bobs.freeBob(b, this.o.tell);
  }
}

// ------------------------------------------------------------------ the runtime

export interface RuntimeHost {
  /** Map is dark (glow moves above the darkness) and its biome (keyline / glow gain). */
  dark: boolean;
  biome: string;
  /** Camera trauma (stage camera rig). */
  trauma?(amount: number): void;
}

export interface VfxStats {
  quality: VfxQuality;
  instances: number;
  sprites: { body: number; glow: number; ground: number; peakBody: number; peakGlow: number; peakGround: number; refused: number };
  bobs: number;
  peakBobs: number;
  particles: number;
  peakParticles: number;
  blitters: number;
  pages: number;
  atlasFill: number;
  bakeQueue: number;
  bakedStrips: number;
  bakedMs: number;
  uploadedKB: number;
  updateMs: number;
  peakUpdateMs: number;
  frameMs: number;
  boltCanvasesBusy: number;
  fallbacks: number;
}

export class VfxRuntime implements VfxStage {
  readonly atlas: Atlas;
  readonly baker: Baker;
  readonly bolts: BoltCanvases;
  readonly bobs: BobPool;
  readonly profile: VfxBiomeProfile;
  private readonly glowLayer: Phaser.GameObjects.Layer;
  private readonly pools: Record<'body' | 'glow' | 'ground', ImagePool>;
  private groups: Group[] = [];
  private ticks: (() => boolean)[] = [];
  private particles: Particle[] = [];
  private clock = 0;
  private sparks = new Map<object, number>();
  private flashes: number[] = [];
  private fallbackReqs: Record<'burst' | 'orb', BakeReq>;
  private readonly canvasTier: boolean;
  quality: VfxQuality = 1;
  private ema = 16.7;
  private over = 0;
  private under = 0;
  private stats0 = { updateMs: 0, peakUpdateMs: 0, peakParticles: 0, fallbacks: 0 };
  private idle: ReturnType<typeof setTimeout> | null = null;
  private destroyed = false;
  private readonly onPost = (_t: number, delta: number) => this.update(delta);
  private readonly onPreRender = () => this.atlas.flush();

  constructor(
    readonly scene: Phaser.Scene,
    private readonly host: RuntimeHost,
  ) {
    const sh = sharedFor(scene);
    this.atlas = sh.atlas;
    this.baker = sh.baker;
    this.bolts = sh.bolts;
    this.baker.onFull = () => this.atlas.evict(this.busyKeys());
    this.profile = biomeProfile(host.biome, host.dark);
    this.canvasTier = !(scene.sys.renderer instanceof Phaser.Renderer.WebGL.WebGLRenderer);
    if (this.canvasTier) this.quality = 0.25;
    this.glowLayer = scene.add.layer().setDepth(this.profile.dark ? DEPTH.LIGHT : DEPTH.FX_GLOW);
    this.pools = {
      body: new ImagePool(scene, 'body'),
      glow: new ImagePool(scene, 'glow', this.glowLayer),
      ground: new ImagePool(scene, 'ground'),
    };
    this.bobs = new BobPool(scene, this.glowLayer);
    this.fallbackReqs = {
      burst: bakeReq({ component: 'burst', params: { cls: 'magic', size: 'm' }, ramp: 'steel', motif: 'steel', lut: 'base', blend: 'normal', layer: 'body', anchor: { to: 'target', dy: 0 } }),
      orb: bakeReq({ component: 'orb', params: { form: 'orb', cell: 16, halo: false, mode: 'charge' }, ramp: 'steel', motif: 'steel', lut: 'base', blend: 'normal', layer: 'body', anchor: { to: 'caster', dy: 0 } }),
    };
    this.baker.request(this.fallbackReqs.burst, true);
    this.baker.request(this.fallbackReqs.orb, true);
    this.baker.pump(50);
    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.onPost);
    scene.game.events.on(Phaser.Core.Events.PRE_RENDER, this.onPreRender);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
    this.kickIdle();
  }

  // ---------------------------------------------------------------- VfxStage

  now(): number {
    return this.clock;
  }

  get reduceFlash(): boolean {
    return vfxSettings.reduceFlash;
  }

  get glowOn(): boolean {
    return !this.canvasTier && this.quality > 0.25;
  }

  tick(fn: () => boolean): void {
    this.ticks.push(fn);
  }

  trauma(amount: number): void {
    if (amount <= 0) return;
    this.host.trauma?.(amount * (this.reduceFlash ? 0.3 : 1));
  }

  /** Queues every bake variant of these pieces (the warm set); baked in idle slices, even while the scene pauses. */
  warm(pieces: readonly VfxPiece[]): void {
    for (const p of pieces) for (const r of this.variants(p)) this.baker.request(r, false);
    this.kickIdle();
  }

  play(pieces: readonly VfxPiece[], ctx: PlayCtx): VfxGroup {
    const g = new Group(ctx);
    if (this.destroyed) return g;
    const rng = mulberry32(hashSeed('vfxrt', ctx.seed, this.clock | 0, this.groups.length));
    for (const p of pieces) {
      try {
        this.spawn(g, p, rng);
      } catch (err) {
        console.error('[omnipath] vfx piece failed', p.component, err);
      }
    }
    if (g.insts.length) this.groups.push(g);
    return g;
  }

  // ---------------------------------------------------------------- spawning

  private angOf(ctx: PlayCtx): () => number {
    const a = ctx.ang;
    return typeof a === 'function' ? a : () => a;
  }

  private src(ctx: PlayCtx, to: VfxPiece['anchor']['to']): LivePt | null {
    switch (to) {
      case 'caster':
        return ctx.caster ?? null;
      case 'target':
        return ctx.target ?? ctx.body ?? null;
      case 'aim':
        return ctx.aim ?? ctx.target ?? null;
      case 'body':
        return ctx.body ?? ctx.target ?? null;
      case 'path':
        return ctx.caster ?? null;
      case 'hop':
        // Knife / blade hops fly: the bridge passes the moving point as `body`.
        return ctx.body ?? ctx.hop?.from ?? null;
    }
  }

  private where(ctx: PlayCtx, p: VfxPiece, off: { x: number; y: number }, motion?: (t: number) => Pt | null): Where {
    const s = this.src(ctx, p.anchor.to);
    const ang = this.angOf(ctx);
    const dy = p.anchor.dy;
    const along = p.anchor.along ?? 0;
    const sortDy = p.anchor.to === 'body' ? (ctx.bodySortDy ?? 0) : 0;
    const mv = p.move;
    return {
      pos: (t) => {
        if (!s) return null;
        const a = along ? ang() : 0;
        let x = s.x + off.x + (along ? Math.cos(a) * along : 0);
        let y = s.y + dy + off.y + (along ? Math.sin(a) * along : 0);
        const m = motion?.(t);
        if (m) {
          x += m.x;
          y += m.y;
        }
        if (mv) {
          const k = Math.min(1, Math.max(0, t / mv.ms));
          const e = mv.ease === 'in' ? k * k : mv.ease === 'out' ? 1 - (1 - k) * (1 - k) : k;
          x += mv.from.x * (1 - e);
          y += mv.from.y * (1 - e) - (mv.ease === 'arc' ? Math.sin(Math.PI * k) * 24 : 0);
        }
        return { x, y };
      },
      sortY: () => (s ? s.y + sortDy + off.y : 0),
    };
  }

  /** Bake options for this map and setting (reduce flash, biome keyline, reprise shift). */
  private optsFor(p: VfxPiece, shift = false): Partial<BakeOptions> {
    return {
      lut: shift && p.lut === 'base' ? 'shift' : p.lut,
      reduceFlash: vfxSettings.reduceFlash,
      keyline: this.profile.keyline.includes(p.ramp as FamilyId) && p.component !== 'missile',
    };
  }

  /** Whole body-layer rings and auras round an actor split into back / front halves. */
  private splits(p: VfxPiece): boolean {
    if (p.layer !== 'body' || p.anchor.along || p.anchor.half) return false;
    if (p.component === 'aura') return true;
    return p.component === 'ring' && !this.chunked(p as RingPiece) && p.anchor.to !== 'hop';
  }

  private chunked(p: RingPiece): boolean {
    const q = p.params;
    const big = Math.max(q.r, q.anim === 'expand' || q.anim === 'contract' ? (q.r0 ?? 0) : 0) > RING_WHOLE_MAX;
    return big || (!!q.arc && (p.tags ?? []).includes('geometryFromEvent'));
  }

  chunkInks(p: RingPiece): RingInk[] {
    const q = p.params;
    const base = RING_INKS.indexOf(q.ink);
    if (q.anim === 'static' || q.anim === 'march') return [q.ink];
    return RING_INKS.slice(base);
  }

  chunkReq(p: RingPiece, ink: RingInk): BakeReq {
    const q = p.params;
    const piece: RingPiece = { ...p, params: { r: RING_WHOLE_MAX + 36, aspect: q.aspect, thick: q.thick, style: q.style, ink, anim: 'static', ms: 200 }, anchor: { ...p.anchor, half: undefined } };
    return bakeReq(piece, this.optsFor(p));
  }

  /** Every bake request a piece can need (warm set): senses, halves, chunk inks. */
  variants(p: VfxPiece, shift = false): BakeReq[] {
    if (p.component === 'afterimage') return [];
    if (p.component === 'bolt' && (p.tags ?? []).includes('geometryFromEvent')) return [];
    if (p.component === 'ring' && this.chunked(p as RingPiece)) return this.chunkInks(p as RingPiece).map((ink) => this.chunkReq(p as RingPiece, ink));
    const o = this.optsFor(p, shift);
    if (p.component === 'slash' && p.params.form !== 'chop') {
      return [1, -1].map((s) => bakeReq({ ...p, params: { ...p.params, sense: s as 1 | -1 } }, o));
    }
    if (this.splits(p)) return (['back', 'front'] as const).map((h) => bakeReq({ ...p, anchor: { ...p.anchor, half: h } } as VfxPiece, o));
    return [bakeReq(p, o)];
  }

  /** The entry when baked and uploaded (requests it urgently otherwise). */
  ready(req: BakeReq): AtlasEntry | null {
    const e = this.atlas.entry(req.key);
    if (e?.ready) return e;
    if (!this.baker.has(req.key)) this.baker.request(req, true);
    return null;
  }

  useOf(req: BakeReq): string {
    return this.atlas.entry(req.key)?.use ?? 'once';
  }

  touch(e: AtlasEntry, now: number): void {
    this.atlas.touch(e, now);
  }

  fallback(kind: 'burst' | 'orb'): AtlasEntry | null {
    const e = this.atlas.entry(this.fallbackReqs[kind].key);
    if (e?.ready) {
      this.stats0.fallbacks++;
      return e;
    }
    this.baker.request(this.fallbackReqs[kind], true);
    return null;
  }

  pool(tier: 'body' | 'glow' | 'ground'): ImagePool {
    return this.pools[tier];
  }

  glowTint(ramp: RampId): number {
    return colorOf(ramp, 4);
  }

  depthFor(layer: VfxLayer, sortY: number, bias: number): number {
    switch (layer) {
      case 'ground':
        return DEPTH.FX_GROUND;
      case 'preview':
        return DEPTH.AIM_PREVIEW;
      case 'tell':
        return DEPTH.TELEGRAPH;
      case 'rim':
        return DEPTH.TELL_TOP;
      case 'glow':
      case 'light':
        return 0;
      case 'body':
        return ySort(sortY, bias);
    }
  }

  sparkAdd(victim: object, d: number): void {
    this.sparks.set(victim, Math.max(0, (this.sparks.get(victim) ?? 0) + d));
  }

  private biasOf(p: VfxPiece): number {
    switch (p.component) {
      case 'orb':
      case 'missile':
        return Y_BIAS.PROJECTILE;
      case 'nova':
      case 'erupt':
        return Y_BIAS.PILLAR;
      case 'motes':
      case 'puff':
      case 'status':
        return Y_BIAS.PARTICLE;
      default:
        return Y_BIAS.ARC;
    }
  }

  private spawn(g: Group, p: VfxPiece, rng: Rng): void {
    const ctx = g.ctx;
    const tags = p.tags ?? [];
    const governed = !tags.includes('neverGoverned');
    const q = this.quality;
    if (governed && q <= 0.25) {
      if (p.component === 'decal' && p.layer !== 'preview') return;
      if (p.place?.pattern === 'trail') return;
    }
    if (governed && q <= 0.5 && tags.includes('echo') && p.component !== 'motes') return;
    const t0 = this.clock + (p.delayMs ?? 0);
    const ang = this.angOf(ctx);
    const quota = (ctx.quota ?? 1) * (governed ? q : 1);
    const layer = p.layer;

    if (p.component === 'afterimage') return this.spawnGhosts(g, p as VfxPieceOf<'afterimage'>, t0);
    if (p.place?.pattern === 'trail') return this.spawnTrail(g, p, t0, rng);
    if (p.component === 'motes') {
      if (p.place?.pattern === 'path' && p.anchor.to === 'path') return this.spawnTether(g, p, t0);
      const req = bakeReq(p, this.optsFor(p, ctx.shift));
      const toPt = ctx.caster;
      g.insts.push(
        new MotesInst(this, g, t0, p as VfxPieceOf<'motes'>, req, this.where(ctx, p, { x: 0, y: 0 }), {
          layer,
          ang,
          rng,
          quota,
          to: toPt ? () => ({ x: toPt.x, y: toPt.y - 20 }) : null,
          glow: layer === 'body',
        }),
      );
      return;
    }
    if (p.component === 'bolt') {
      const bp = p as VfxPieceOf<'bolt'>;
      const ev = tags.includes('geometryFromEvent');
      const from = ctx.hop?.from ?? this.where(ctx, p, { x: 0, y: 0 }).pos(0);
      if (!from) return;
      if (ev) {
        const to = ctx.hop?.to ?? (ctx.target ? { x: ctx.target.x, y: ctx.target.y + p.anchor.dy } : null);
        if (!to) return;
        let dx = Math.round(to.x - from.x);
        let dy = Math.round(to.y - from.y);
        const L = Math.hypot(dx, dy);
        if (L < 4) return;
        if (L > VFX_BUDGET.boltMaxLen) {
          // Split long hops at the midpoint.
          const mid = { x: from.x + dx / 2, y: from.y + dy / 2 };
          const half = (a: Pt, b: Pt, k: number) => {
            const piece: VfxPieceOf<'bolt'> = { ...bp, params: { ...bp.params, dx: Math.round(b.x - a.x), dy: Math.round(b.y - a.y), seed: (hashSeed(bp.params.seed, ctx.seed, k) >>> 1) } };
            g.insts.push(new BoltInst(this, g, t0, piece, { ...DEFAULT_OPTS, ...this.optsFor(p, ctx.shift) } as BakeOptions, a));
          };
          half(from, mid, 0);
          half(mid, to, 1);
          return;
        }
        const piece: VfxPieceOf<'bolt'> = { ...bp, params: { ...bp.params, dx, dy, seed: hashSeed(bp.params.seed, ctx.seed) >>> 1 } };
        dx = piece.params.dx;
        dy = piece.params.dy;
        g.insts.push(new BoltInst(this, g, t0, piece, { ...DEFAULT_OPTS, ...this.optsFor(p, ctx.shift) } as BakeOptions, from));
        return;
      }
    }
    if (p.component === 'ring' && this.chunked(p as RingPiece)) {
      const rp = p as RingPiece;
      const evR = tags.includes('geometryFromEvent') && ctx.r !== undefined ? ctx.r : rp.params.r;
      const life = p.lifeMs ?? (rp.params.anim === 'sweep' ? rp.params.ms + 220 : rp.params.anim === 'expand' || rp.params.anim === 'contract' ? rp.params.ms : rp.params.ms);
      const life2 = rp.params.anim === 'static' || rp.params.anim === 'march' ? (p.lifeMs ?? (ctx.alive ? 1e9 : rp.params.ms)) : life;
      const n = p.place?.pattern === 'path' ? 1 : 1;
      void n;
      if (p.place?.pattern === 'path') return this.spawnPathRings(g, rp, t0, evR, ang);
      g.insts.push(
        new ChunkRingInst(this, g, t0, rp, this.where(ctx, p, { x: 0, y: 0 }), {
          layer,
          r: evR,
          arcRel: rp.params.arc && tags.includes('geometryFromEvent') ? rp.params.arc : null,
          ang,
          life: life2,
          body: layer === 'body',
          glow: layer === 'body' && q > 0.25,
        }),
      );
      return;
    }
    if (p.component === 'tell' && p.params.piece !== 'lock' && p.params.piece !== 'fizzle') return this.spawnBeads(g, p as VfxPieceOf<'tell'>, t0, ang);
    if (p.component === 'ring' && p.place?.pattern === 'path') return this.spawnPathRings(g, p as RingPiece, t0, (p as RingPiece).params.r, ang);

    // Strips (Images): one per spot, halves split round actors.
    const pl = p.place;
    const cap = p.component === 'erupt' ? Math.min(VFX_BUDGET.perEvent.novaUnits, q <= 0.25 && governed ? 3 : 14) : 24;
    const n = pl ? scaledCount(pl, ctx.quota ?? 1, governed ? q : 1, cap) : 1;
    const a0 = ang();
    const sp = spots(p, n, a0, rng);
    const halves: (VfxPiece['anchor']['half'] | null)[] = this.splits(p) ? ['back', 'front'] : [null];
    const life = p.lifeMs ?? null;
    const fallback: 'burst' | 'orb' | null =
      p.component === 'orb' || p.component === 'missile' ? 'orb' : ['slash', 'thrust', 'nova', 'burst', 'erupt', 'sigil'].includes(p.component) && (tags.includes('hero') || p.component === 'burst') ? 'burst' : null;
    const tint = colorOf(p.ramp, 3);
    const victim = ctx.victim;
    const isSpark = p.component === 'burst' && !!victim;
    if (isSpark && (this.sparks.get(victim!) ?? 0) >= VFX_BUDGET.perEvent.sparksPerTarget) return;
    const stagger = pl?.staggerMs ?? 0;
    const repeat = stagger && life && life >= 2 * n * stagger && this.useOfPiece(p) === 'once' ? n * stagger : 0;
    sp.forEach((s, k) => {
      for (const h of halves) {
        const piece = h ? ({ ...p, anchor: { ...p.anchor, half: h } } as VfxPiece) : p;
        const dirFn = this.dirFor(piece, ang);
        const req = this.reqFor(piece, ctx, dirFn);
        const motion = pl && (pl.pattern === 'orbit' || pl.pattern === 'spiral' || (pl.pattern === 'burst' && pl.speed)) ? (t: number) => spotMotion(p, k, n, t, a0) : undefined;
        const where = this.where(ctx, piece, s, motion);
        const mk = (start: number) =>
          new SpriteInst(this, g, start, piece, req.req, where, {
            layer,
            blend: p.blend,
            bias: h === 'back' ? 0 : this.biasOf(p),
            half: h === 'back' ? -1 : h === 'front' ? 1 : 0,
            glow: layer === 'body' && h !== 'back',
            life: repeat ? null : life,
            dir: req.dir,
            fallback: k === 0 && h !== 'back' ? fallback : null,
            tint,
            tier: layer === 'ground' || layer === 'preview' || layer === 'tell' ? 'ground' : 'body',
            holdMs: isSpark && k === 0 ? ctx.holdMs : undefined,
            spark: isSpark ? victim : undefined,
          });
        if (repeat && life) for (let w = 0; w * repeat < life; w++) g.insts.push(mk(t0 + s.delay + w * repeat));
        else g.insts.push(mk(t0 + s.delay));
      }
    });
  }

  private useOfPiece(p: VfxPiece): string {
    const e = this.atlas.entry(bakeReq(p, this.optsFor(p)).key);
    if (e) return e.use;
    return p.component === 'status' && ['beam', 'splash', 'speedline', 'spiral', 'microarc', 'bubble', 'drop'].includes((p as VfxPieceOf<'status'>).params.unit) ? 'once' : 'loop';
  }

  /** Heading pick (fixed or live) for a piece: the template's direction count, the event heading. */
  private dirFor(p: VfxPiece, ang: () => number): DirPick | (() => DirPick) {
    const dirs = (TEMPLATES[p.component] as unknown as { dirs(q: unknown): 1 | 8 | 16 }).dirs(p.params);
    if (dirs === 1) return NO_FLIP;
    if (p.component === 'orb' || p.component === 'missile') return () => pickDir(ang(), dirs);
    return pickDir(ang(), dirs);
  }

  /** The bake request for a piece instance (slash sense resolved against the flip). */
  private reqFor(p: VfxPiece, ctx: PlayCtx, dir: DirPick | (() => DirPick)): { req: BakeReq; dir: DirPick | (() => DirPick) } {
    const o = this.optsFor(p, ctx.shift);
    if (p.component === 'slash' && p.params.form !== 'chop' && typeof dir !== 'function') {
      const want = (p.params.sense * (ctx.sense ?? 1)) as 1 | -1;
      const flipped = dir.flipX !== dir.flipY;
      const sense = (flipped ? -want : want) as 1 | -1;
      return { req: bakeReq({ ...p, params: { ...p.params, sense } }, o), dir };
    }
    return { req: bakeReq(p, o), dir };
  }

  private spawnGhosts(g: Group, p: VfxPieceOf<'afterimage'>, t0: number): void {
    const src = g.ctx.ghostOf;
    if (!src || this.canvasTier || !this.glowOn) return;
    const snap = this.snapshot(src, p.anchor.dy);
    if (!snap) return;
    g.insts.push(new GhostInst(this, g, t0, snap, p.params.steps, colorOf(p.ramp, 3)));
  }

  private snapshot(src: GhostSource, dy = 0): ConstructorParameters<typeof GhostInst>[3] | null {
    const s = src.sprite;
    if (!s.visible) return null;
    return { tex: s.texture.key, frame: s.frame.name, flipX: s.flipX, ox: s.originX, oy: s.originY, sx: s.scaleX, sy: s.scaleY, x: src.x, y: src.y + dy + 1 };
  }

  private spawnTrail(g: Group, p: VfxPiece, t0: number, rng: Rng): void {
    const ctx = g.ctx;
    if (ctx.noTrail) return;
    const where = this.where(ctx, { ...p, anchor: { ...p.anchor, to: p.anchor.to === 'path' ? 'caster' : p.anchor.to } } as VfxPiece, { x: 0, y: 0 });
    const color = colorOf(p.ramp, 3);
    const cap = Math.max(1, Math.min(6, p.place?.count ?? 6));
    let live: GhostInst[] = [];
    const emit = (at: Pt, a: number, idx: number) => {
      if (p.component === 'afterimage') {
        // Projectile bodies leave afterimages of their own frame; dashes of the actor's.
        const src = ctx.ghostOf ?? this.bodyGhost(g, at);
        if (!src || !this.glowOn) return;
        live = live.filter((x) => !x.dead);
        if (live.length >= cap) return;
        const snap = this.snapshot(src, p.anchor.dy);
        if (!snap) return;
        snap.x = at.x;
        snap.y = at.y + (ctx.ghostOf ? 0 : 0);
        const gi = new GhostInst(this, g, this.clock, snap, (p as VfxPieceOf<'afterimage'>).params.steps, color);
        live.push(gi);
        g.insts.push(gi);
        return;
      }
      if (p.component === 'motes') {
        if (p.params.kind === 'disc' && idx % 1 !== 0) return;
        const req = bakeReq(p, this.optsFor(p, ctx.shift));
        const e = this.ready(req);
        if (!e) return;
        const l = launch(p, 0, 1, a, rng, Math.min(p.lifeMs ?? 320, 400));
        this.spawnParticle(null, req, p.ramp, p.layer, this.clock, l, at, null, null, p.layer === 'body');
        return;
      }
      // Puffs (smoke trails): a strip at the spot.
      const req = bakeReq(p, this.optsFor(p, ctx.shift));
      const fixed = { x: at.x, y: at.y };
      g.insts.push(
        new SpriteInst(this, g, this.clock, p, req, { pos: () => fixed, sortY: () => fixed.y + (ctx.bodySortDy ?? 0) }, {
          layer: p.layer,
          blend: p.blend,
          bias: Y_BIAS.PARTICLE,
          half: 0,
          glow: false,
          life: null,
          dir: { u: 0, flipX: false, flipY: false },
          fallback: null,
          tint: 0,
          tier: p.layer === 'ground' ? 'ground' : 'body',
        }),
      );
    };
    g.insts.push(new TrailInst(this, g, t0, p, where, emit));
  }

  /** A projectile body's current Image as a ghost source (knife / blade afterimages). */
  private bodyGhost(g: Group, at: Pt): GhostSource | null {
    for (const i of g.insts) {
      if (i instanceof SpriteInst && (i.piece.component === 'missile' || i.piece.component === 'orb')) {
        const img = (i as unknown as { img: Phaser.GameObjects.Image | null }).img;
        if (!img || !img.visible) return null;
        return { x: at.x, y: at.y, sprite: { texture: img.texture, frame: img.frame, flipX: img.flipX, originX: (Math.round(at.x) - img.x) / Math.max(1, img.width), originY: (Math.round(at.y) - img.y) / Math.max(1, img.height), scaleX: 1, scaleY: 1, visible: true } };
      }
    }
    return null;
  }

  /** Spin-dash bands: one sweep ring re-anchored on the caster every staggerMs through the dash. */
  private spawnPathRings(g: Group, p: RingPiece, t0: number, r: number, ang: () => number): void {
    const ctx = g.ctx;
    const ms = ctx.path?.ms ?? 170;
    const every = Math.max(33, p.place?.staggerMs ?? 67);
    for (let t = 0; t <= ms; t += every) {
      const at = ctx.caster;
      const piece: RingPiece = { ...p, place: undefined };
      if (this.chunked(piece)) {
        g.insts.push(new ChunkRingInst(this, g, t0 + t, piece, this.where(ctx, piece, { x: 0, y: 0 }), { layer: p.layer, r, arcRel: null, ang, life: p.params.ms + 220, body: p.layer === 'body', glow: true }));
      } else {
        const req = bakeReq(piece, this.optsFor(piece, ctx.shift));
        // Freeze each band where the caster was when it started.
        let fixed: Pt | null = null;
        const start = t0 + t;
        g.insts.push(
          new SpriteInst(this, g, start, piece, req, {
            pos: () => {
              if (!fixed && at && this.clock >= start) fixed = { x: at.x, y: at.y + piece.anchor.dy };
              return fixed;
            },
            sortY: () => (fixed ? fixed.y : (at?.y ?? 0)),
          }, { layer: p.layer, blend: p.blend, bias: Y_BIAS.ARC, half: 0, glow: true, life: null, dir: { u: 0, flipX: false, flipY: false }, fallback: null, tint: 0, tier: 'body' }),
        );
      }
    }
  }

  /** Tell bead / chevron lines (player dash lane preview edges). */
  private spawnBeads(g: Group, p: VfxPieceOf<'tell'>, t0: number, ang: () => number): void {
    const ctx = g.ctx;
    const where = this.where(ctx, p, { x: 0, y: 0 });
    const req = bakeReq(p, this.optsFor(p));
    const n = Math.max(1, Math.min(24, p.place?.count ?? 8));
    const rng = mulberry32(1);
    const dir = p.params.piece === 'chevron' || p.params.piece === 'arrow' ? pickDir(ang(), 16) : { u: 0, flipX: false, flipY: false };
    g.insts.push(
      new BeadInst(this, g, t0, req, {
        layer: p.layer,
        life: p.lifeMs ?? null,
        dir,
        tell: (p.tags ?? []).includes('neverGoverned'),
        points: (t) => {
          const c = where.pos(t);
          if (!c) return [];
          return spots(p, n, ang(), rng).map((s) => ({ x: c.x + s.x, y: c.y + s.y }));
        },
      }),
    );
  }

  /** Returns tether: beads every 6 px from the caster's hand to the returning body. */
  private spawnTether(g: Group, p: VfxPiece, t0: number): void {
    const ctx = g.ctx;
    const req = bakeReq(p, this.optsFor(p));
    const every = p.place?.everyPx ?? 6;
    g.insts.push(
      new BeadInst(this, g, t0, req, {
        layer: 'body',
        life: null,
        dir: { u: 0, flipX: false, flipY: false },
        tell: false,
        points: () => {
          const a = ctx.caster;
          const b = ctx.body;
          if (!a || !b) return [];
          const ax = a.x;
          const ay = a.y - 14;
          const L = Math.hypot(b.x - ax, b.y - ay);
          const n = Math.min(40, Math.floor(L / every));
          const out: Pt[] = [];
          for (let i = 1; i < n; i++) out.push({ x: ax + ((b.x - ax) * i) / n, y: ay + ((b.y - ay) * i) / n });
          return out;
        },
      }),
    );
  }

  /** A 2 px bead line (bolt fallback when no live canvas is free). */
  beadLine(g: Group, now: number, a: Pt, b: Pt, ramp: RampId): void {
    const p: VfxPiece = { component: 'motes', params: { kind: 'bead', size: 2 }, ramp, motif: ramp as FamilyId, lut: 'base', blend: 'normal', layer: 'body', anchor: { to: 'hop', dy: 0 } };
    const req = bakeReq(p, this.optsFor(p));
    g.insts.push(
      new BeadInst(this, g, now, req, {
        layer: 'body',
        life: 150,
        dir: { u: 0, flipX: false, flipY: false },
        tell: false,
        points: () => {
          const n = Math.max(2, Math.floor(Math.hypot(b.x - a.x, b.y - a.y) / 6));
          return Array.from({ length: n + 1 }, (_, i) => ({ x: a.x + ((b.x - a.x) * i) / n, y: a.y + ((b.y - a.y) * i) / n }));
        },
      }),
    );
  }

  // ---------------------------------------------------------------- particles

  spawnParticle(owner: MotesInst | null, req: BakeReq, ramp: RampId, layer: VfxLayer, born: number, l: Launch, at: Pt, where: Where | null, to: (() => Pt | null) | null, glow: boolean): void {
    if (this.particles.length >= VFX_BUDGET.particles) return;
    void owner;
    const slot = layer === 'ground' ? 'gmotes' : layer === 'preview' ? 'pmotes' : layer === 'glow' || layer === 'light' ? 'glow' : 'motes';
    const depth = slot === 'gmotes' ? DEPTH.FX_GROUND : slot === 'pmotes' ? DEPTH.AIM_PREVIEW : MOTE_DEPTH;
    const live = l.mode !== 'free' && where ? () => where.pos(this.clock - born) : null;
    const dirAng = l.mode === 'free' ? Math.atan2(l.vy, l.vx) : 0;
    this.particles.push({ req, ramp, slot, depth, born, l, ox: at.x, oy: at.y, anchor: live, to, dirAng, bob: null, glowBob: null, glow: glow && this.glowOn });
    if (this.particles.length > this.stats0.peakParticles) this.stats0.peakParticles = this.particles.length;
  }

  private updateParticles(now: number): void {
    const keep: Particle[] = [];
    for (const pt of this.particles) {
      const age = now - pt.born;
      if (age >= pt.l.life) {
        this.bobs.freeBob(pt.bob);
        this.bobs.freeBob(pt.glowBob);
        continue;
      }
      keep.push(pt);
      if (age < 0) continue;
      const e = this.atlas.entry(pt.req.key);
      if (!e?.ready) continue;
      let x: number;
      let y: number;
      let heading = pt.dirAng;
      const u = age / pt.l.life;
      const base = pt.anchor?.() ?? { x: pt.ox, y: pt.oy };
      switch (pt.l.mode) {
        case 'orbit': {
          const a = pt.l.a + age / 140;
          x = base.x + Math.cos(a) * pt.l.r;
          y = base.y + Math.sin(a) * pt.l.r * 0.5;
          heading = a + Math.PI / 2;
          break;
        }
        case 'spiral': {
          const r = pt.l.r * (1 - u);
          const a = pt.l.a + u * 5;
          x = base.x + Math.cos(a) * r;
          y = base.y + Math.sin(a) * r * 0.65;
          heading = a + Math.PI / 2;
          break;
        }
        case 'converge': {
          const r = pt.l.r * (1 - u);
          x = base.x + Math.cos(pt.l.a) * r;
          y = base.y + Math.sin(pt.l.a) * r;
          heading = pt.l.a + Math.PI;
          break;
        }
        case 'path': {
          const tgt = pt.to?.() ?? base;
          const k = Math.min(1, u * 1.15);
          const mx = (pt.ox + tgt.x) / 2;
          const my = (pt.oy + tgt.y) / 2;
          const L = Math.hypot(tgt.x - pt.ox, tgt.y - pt.oy) || 1;
          const cx = mx + (-(tgt.y - pt.oy) / L) * pt.l.a;
          const cy = my + ((tgt.x - pt.ox) / L) * pt.l.a - 6;
          const w = 1 - k;
          x = w * w * pt.ox + 2 * w * k * cx + k * k * tgt.x;
          y = w * w * pt.oy + 2 * w * k * cy + k * k * tgt.y;
          heading = Math.atan2(tgt.y - y, tgt.x - x);
          break;
        }
        default: {
          const p = freePos(pt.l, age);
          x = pt.ox + p.x;
          y = pt.oy + p.y;
        }
      }
      const pick = e.dirs === 1 ? NO_FLIP : pickDir(heading, e.dirs);
      const s = e.strips[pick.u];
      if (!s) continue;
      const n = s.frames.length;
      const f = s.frames[Math.min(n - 1, Math.floor(u * n))];
      if (!f?.w) continue;
      const bl = this.bobs.sharedFor(pt.slot, f.tex, pt.depth, pt.slot === 'glow', pt.slot === 'glow' ? this.profile.glowGain : 1);
      const ax = Math.round(x);
      const ay = Math.round(y);
      const bx = pick.flipX ? ax - (f.w - 1 - f.ox) : ax - f.ox;
      const by = pick.flipY ? ay - (f.h - 1 - f.oy) : ay - f.oy;
      if (!pt.bob || pt.bob.parent !== bl) {
        this.bobs.freeBob(pt.bob);
        pt.bob = this.bobs.bob(bl, f.name, bx, by);
      } else pt.bob.reset(bx, by, f.name);
      pt.bob?.setFlip(pick.flipX, pick.flipY);
      const gf = pt.glow ? s.glow?.[Math.min(n - 1, Math.floor(u * n))] : undefined;
      if (gf?.w) {
        const gb = this.bobs.sharedFor('glow', gf.tex, 0, true, this.profile.glowGain);
        const gx = pick.flipX ? ax - (gf.w - 1 - gf.ox) : ax - gf.ox;
        const gy = pick.flipY ? ay - (gf.h - 1 - gf.oy) : ay - gf.oy;
        if (!pt.glowBob || pt.glowBob.parent !== gb) {
          this.bobs.freeBob(pt.glowBob);
          pt.glowBob = this.bobs.bob(gb, gf.name, gx, gy);
        } else pt.glowBob.reset(gx, gy, gf.name);
        if (pt.glowBob) {
          pt.glowBob.setFlip(pick.flipX, pick.flipY);
          pt.glowBob.tint = this.glowTint(pt.ramp);
        }
      } else if (pt.glowBob) {
        this.bobs.freeBob(pt.glowBob);
        pt.glowBob = null;
      }
    }
    this.particles = keep;
  }

  // ---------------------------------------------------------------- frame

  private update(delta: number): void {
    if (this.destroyed) return;
    const t0 = performance.now();
    const scale = this.scene.time.timeScale;
    this.clock += Math.min(delta, 100) * scale;
    const now = this.clock;
    this.govern(delta);
    // Urgent bakes (live effects waiting) within the slice budget; warm work only when the frame is calm.
    const budget = VFX_BUDGET.cpuMs.bakeSlice;
    if (this.baker.pending) this.baker.pump(budget, true, this.ema > 20);
    if (this.ticks.length) {
      this.ticks = this.ticks.filter((fn) => {
        try {
          return fn();
        } catch (err) {
          console.error('[omnipath] vfx tick failed', err);
          return false;
        }
      });
    }
    for (const g of this.groups) {
      for (const i of g.insts) {
        if (i.dead) continue;
        // An ended group drops what has not started yet (a refreshed buff's old break, a cancelled charge).
        if (g.ended && i.t0 > now) i.dead = true;
        else i.update(now);
        if (i.dead) i.destroy();
      }
    }
    this.groups = this.groups.filter((g) => {
      g.insts = g.insts.filter((i) => !i.dead);
      return g.insts.length > 0;
    });
    this.updateParticles(now);
    const ms = performance.now() - t0;
    this.stats0.updateMs = this.stats0.updateMs * 0.9 + ms * 0.1;
    if (ms > this.stats0.peakUpdateMs) this.stats0.peakUpdateMs = ms;
  }

  /** Quality governor (docs/VFX.md §9) on an EMA of the frame delta. */
  private govern(delta: number): void {
    if (this.canvasTier) return;
    this.ema = this.ema * 0.9 + Math.min(delta, 100) * 0.1;
    const G = VFX_GOVERNOR;
    if (this.ema > G.quarter.overMs) this.over = Math.max(this.over + 1, 0);
    else if (this.ema > G.half.overMs) this.over++;
    else this.over = 0;
    this.under = this.ema < G.recover.underMs ? this.under + 1 : 0;
    if (this.over >= G.half.frames) {
      // One step down per 30 slow frames: 1 -> 0.5 (> 20 ms), 0.5 -> 0.25 (> 26 ms).
      if (this.quality === 1) this.quality = 0.5;
      else if (this.ema > G.quarter.overMs) this.quality = 0.25;
      this.over = 0;
    }
    if (this.under >= G.recover.frames && this.quality < 1) {
      this.quality = this.quality === 0.25 ? 0.5 : 1;
      this.under = 0;
    }
  }

  /** Bakes the warm set in real-time slices (setTimeout), so it progresses behind the fade and while paused. */
  private kickIdle(): void {
    if (this.idle || this.destroyed) return;
    const run = () => {
      this.idle = null;
      if (this.destroyed || !this.baker.pending) return;
      this.baker.pump(8);
      this.atlas.flush(VFX_BUDGET.uploadBytesPerFrame);
      this.idle = setTimeout(run, 16);
    };
    this.idle = setTimeout(run, 0);
  }

  private busyKeys(): Set<string> {
    const s = new Set<string>([this.fallbackReqs.burst.key, this.fallbackReqs.orb.key]);
    for (const g of this.groups) for (const i of g.insts) for (const k of i.keys()) s.add(k);
    for (const p of this.particles) s.add(p.req.key);
    return s;
  }

  /** Flash budget (docs/VFX.md §9): true when a big flash may play now (else the caller uses reduce-flash). */
  flashOk(px: number): boolean {
    if (px < VFX_BUDGET.flash.areaPx) return true;
    const now = this.clock;
    this.flashes = this.flashes.filter((t) => now - t < 1000);
    const last = this.flashes[this.flashes.length - 1] ?? -1e9;
    if (this.flashes.length >= VFX_BUDGET.flash.perSecond || now - last < VFX_BUDGET.flash.minGapMs) return false;
    this.flashes.push(now);
    return true;
  }

  stats(): VfxStats {
    const P = this.pools;
    return {
      quality: this.quality,
      instances: this.groups.reduce((a, g) => a + g.insts.length, 0),
      sprites: {
        body: P.body.live,
        glow: P.glow.live,
        ground: P.ground.live,
        peakBody: P.body.peak,
        peakGlow: P.glow.peak,
        peakGround: P.ground.peak,
        refused: P.body.refused + P.glow.refused + P.ground.refused,
      },
      bobs: this.bobs.live,
      peakBobs: this.bobs.peak,
      particles: this.particles.length,
      peakParticles: this.stats0.peakParticles,
      blitters: this.bobs.blitterCount,
      pages: this.atlas.pageCount,
      atlasFill: Math.round(this.atlas.fill * 100) / 100,
      bakeQueue: this.baker.pending,
      bakedStrips: this.baker.bakedStrips,
      bakedMs: Math.round(this.baker.bakedMs),
      uploadedKB: Math.round(this.atlas.uploadedBytes / 1024),
      updateMs: Math.round(this.stats0.updateMs * 100) / 100,
      peakUpdateMs: Math.round(this.stats0.peakUpdateMs * 100) / 100,
      frameMs: Math.round(this.ema * 10) / 10,
      boltCanvasesBusy: this.bolts.busy,
      fallbacks: this.stats0.fallbacks,
    };
  }

  /** Resets peak counters (QA measurements). */
  resetPeaks(): void {
    this.pools.body.peak = this.pools.body.live;
    this.pools.glow.peak = this.pools.glow.live;
    this.pools.ground.peak = this.pools.ground.live;
    this.bobs.peak = this.bobs.live;
    this.stats0.peakParticles = this.particles.length;
    this.stats0.peakUpdateMs = 0;
  }

  /** Forces a quality tier (QA); null returns control to the governor. */
  setQuality(q: VfxQuality): void {
    this.quality = q;
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    if (this.idle) clearTimeout(this.idle);
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.onPost);
    this.scene.game.events.off(Phaser.Core.Events.PRE_RENDER, this.onPreRender);
    for (const g of this.groups) for (const i of g.insts) i.destroy();
    this.groups = [];
    this.ticks = [];
    for (const p of this.particles) {
      this.bobs.freeBob(p.bob);
      this.bobs.freeBob(p.glowBob);
    }
    this.particles = [];
    this.pools.body.destroy();
    this.pools.glow.destroy();
    this.pools.ground.destroy();
    this.bobs.destroy();
    this.glowLayer.destroy();
    // Keep baking the warm set run-wide: the next map's runtime picks the queue up.
  }
}

const NO_FLIP: DirPick = { u: 0, flipX: false, flipY: false };
const DEFAULT_OPTS: BakeOptions = { lut: 'base', reduceFlash: false, keyline: false };
