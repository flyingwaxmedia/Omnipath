// Pooled display objects for the VFX runtime (docs/VFX.md §8.5, §9): Images for strips (body NORMAL, glow twins ADD
// in the shared glow Layer, ground decals NORMAL / MULTIPLY) and Blitter bobs for ring chunks, beads and motes. Every
// pool has a hard cap from VFX_BUDGET; a full pool refuses (the effect drops a piece, the game never stalls).
// Telegraph sprites and bobs are reserved: player effects can never starve a monster tell.
import Phaser from 'phaser';
import { VFX_BUDGET } from '../types';

export type SpriteTier = 'body' | 'glow' | 'ground' | 'tell';

const CAPS: Readonly<Record<SpriteTier, number>> = VFX_BUDGET.sprites;

/** A capped pool of Images (origin 0,0: the runtime places trimmed frames by their top-left corner). */
export class ImagePool {
  private free: Phaser.GameObjects.Image[] = [];
  live = 0;
  peak = 0;
  refused = 0;

  constructor(
    private readonly scene: Phaser.Scene,
    readonly tier: SpriteTier,
    /** Parent container for glow twins (the shared ADD Layer). */
    private readonly layer: Phaser.GameObjects.Layer | null = null,
  ) {}

  get cap(): number {
    return CAPS[this.tier];
  }

  /** `soft` (0..1): refuse beyond that share of the cap (low-priority pieces). */
  get(tex: string, frame: string, soft = 1): Phaser.GameObjects.Image | null {
    // A frame freed with its atlas page (LRU eviction) is never drawn: Phaser would fall back to a removed first frame.
    if (!this.scene.textures.get(tex).has(frame)) return null;
    if (this.live >= this.cap * soft) {
      this.refused++;
      return null;
    }
    let img = this.free.pop();
    if (img && img.active) img.setTexture(tex, frame).setVisible(true);
    else {
      img = this.scene.make.image({ x: 0, y: 0, key: tex, frame }, false);
      img.setOrigin(0, 0);
      if (this.layer) this.layer.add(img);
      else img.addToDisplayList();
    }
    img.setAlpha(1).setFlip(false, false).clearTint().setBlendMode(Phaser.BlendModes.NORMAL);
    this.live++;
    if (this.live > this.peak) this.peak = this.live;
    return img;
  }

  put(img: Phaser.GameObjects.Image | null): void {
    if (!img) return;
    this.live--;
    if (!img.active) return;
    img.setVisible(false);
    this.free.push(img);
  }

  destroy(): void {
    for (const i of this.free) i.destroy();
    this.free = [];
  }
}

/** Blitters (one texture page each) and their bobs, with one global bob cap. */
export class BobPool {
  /** Shared blitters by `${slot}|${page}` (ground, preview, glow, motes ...). */
  private shared = new Map<string, Phaser.GameObjects.Blitter>();
  /** Free per-instance blitters by page key. */
  private spare = new Map<string, Phaser.GameObjects.Blitter[]>();
  private freeBobs = new Map<Phaser.GameObjects.Blitter, Phaser.GameObjects.Bob[]>();
  live = 0;
  liveTell = 0;
  peak = 0;
  refused = 0;
  /** Blitters that hold mote particles (the "emitters" of the budget). */
  readonly moteSlots = new Set<string>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly glowLayer: Phaser.GameObjects.Layer,
  ) {}

  /** A shared blitter for a slot (fixed depth or the glow layer) on a page texture. */
  sharedFor(slot: string, tex: string, depth: number, glow: boolean, alpha = 1): Phaser.GameObjects.Blitter {
    const k = `${slot}|${tex}`;
    let b = this.shared.get(k);
    if (!b || !b.active) {
      b = this.make(tex, glow);
      b.setDepth(depth);
      this.shared.set(k, b);
    }
    if (b.alpha !== alpha) b.setAlpha(alpha);
    return b;
  }

  /** Re-depths every shared blitter of a slot (the glow layer moves to LIGHT on dark maps). */
  depthOf(slot: string, depth: number): void {
    for (const [k, b] of this.shared) if (k.startsWith(`${slot}|`)) b.setDepth(depth);
  }

  /** A private blitter (ring halves y-sorted round an actor); give it back with release(). */
  acquire(tex: string): Phaser.GameObjects.Blitter {
    const list = this.spare.get(tex);
    const b = list?.pop();
    if (b && b.active) return b.setVisible(true);
    return this.make(tex, false);
  }

  release(b: Phaser.GameObjects.Blitter): void {
    if (!b.active) return;
    b.setVisible(false);
    const k = b.texture.key;
    let list = this.spare.get(k);
    if (!list) this.spare.set(k, (list = []));
    list.push(b);
  }

  /** A bob, or null over the cap (tell bobs may use the reserve). */
  bob(b: Phaser.GameObjects.Blitter, frame: string, x: number, y: number, tell = false): Phaser.GameObjects.Bob | null {
    const playerCap = VFX_BUDGET.bobs - VFX_BUDGET.bobsReservedForTells;
    if (this.live >= VFX_BUDGET.bobs || (!tell && this.live - this.liveTell >= playerCap)) {
      this.refused++;
      return null;
    }
    if (!b.texture.has(frame)) return null;
    const list = this.freeBobs.get(b);
    let bob = list?.pop();
    if (bob) {
      bob.reset(x, y, frame);
      bob.setVisible(true);
    } else bob = b.create(x, y, frame);
    bob.setAlpha(1);
    bob.tint = 0xffffff;
    bob.resetFlip();
    this.live++;
    if (tell) this.liveTell++;
    if (this.live > this.peak) this.peak = this.live;
    return bob;
  }

  freeBob(bob: Phaser.GameObjects.Bob | null, tell = false): void {
    if (!bob) return;
    this.live--;
    if (tell) this.liveTell--;
    const b = bob.parent;
    if (!b?.active) return;
    bob.setVisible(false);
    let list = this.freeBobs.get(b);
    if (!list) this.freeBobs.set(b, (list = []));
    list.push(bob);
  }

  get blitterCount(): number {
    let n = this.shared.size;
    for (const l of this.spare.values()) n += l.length;
    return n;
  }

  destroy(): void {
    for (const b of this.shared.values()) b.destroy();
    for (const l of this.spare.values()) for (const b of l) b.destroy();
    this.shared.clear();
    this.spare.clear();
    this.freeBobs.clear();
  }

  private make(tex: string, glow: boolean): Phaser.GameObjects.Blitter {
    // '__BASE' explicitly: an atlas page's first named frame may have gone with an eviction (Phaser would look it up).
    const b = this.scene.make.blitter({ x: 0, y: 0, key: tex, frame: '__BASE' }, false);
    if (glow) {
      b.setBlendMode(Phaser.BlendModes.ADD);
      this.glowLayer.add(b);
    } else b.addToDisplayList();
    return b;
  }
}
