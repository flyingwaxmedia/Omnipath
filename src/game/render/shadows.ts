// Directional cast shadows (SPEC-v4 §11.2 A; docs/ART-DIRECTION.md §3 "Shadows").
//
// The sun is top-left, so everything that stands throws its own silhouette DOWN-RIGHT across the ground: the sprite's
// alpha mask, laid down at half height and sheared so its top lands SHEAR x its height to the right (never more than
// MAX_REACH px). Colour: SHADOW_COLOR (#3a3560), multiplied at 40% outdoors and 30% underground — never black alpha.
// Under every grounded sprite a 1 px contact line is multiplied in a second time.
//
//  - castShape()        pure: RGBA pixels -> the shadow's bitmap (1 = cast, 2 = contact). Tests run on it.
//  - ShadowBaker        static casters (props, structures, standing dressing, objects, gather nodes): the ground
//                       baker paints their shadows INTO the ground chunks (render/ground.ts), so a map's hundreds of
//                       static shadows cost no sprite, no draw call and never double-darken where they overlap.
//  - ActorShadows       moving casters (the player, monsters, NPCs): one small shared atlas ('cast_shadows', frames
//                       '<key>|<frame>|<flip>' = the spec's `<key>__sh`, baked lazily, cached), shown through the
//                       actor's own shadow image on DEPTH.SHADOW. Flying monsters keep a small offset ellipse.
//
// Everything is whole pixels: the shear is rounded per row, nothing is scaled or rotated at draw time.
import type Phaser from 'phaser';
import { SHADOW_COLOR } from '../art/pixel';

/** How far right the top of a sprite lands, as a share of its height (golden-hour and dusk maps: SHEAR_LATE). */
export const SHADOW_SHEAR = 0.6;
export const SHADOW_SHEAR_LATE = 0.9;
/** The silhouette is laid down at this share of its height. */
export const SHADOW_FLATTEN = 0.5;
/** Longest sideways reach of a shadow (px); taller sprites compress their shear to fit. */
export const SHADOW_MAX_REACH = 48;
/** Multiply strength outdoors / underground. */
export const SHADOW_ALPHA = 0.4;
export const SHADOW_ALPHA_DARK = 0.3;
/** Extra multiply strength of the contact line. */
export const CONTACT_ALPHA = 0.35;
/** Pixels count as silhouette from this alpha up (glows and haze cast nothing). */
export const SHADOW_MIN_ALPHA = 128;
export const SHADOW_RGB = parseInt(SHADOW_COLOR.slice(1), 16);
/** Atlas of actor shadows. */
export const SHADOW_ATLAS = 'cast_shadows';
const PAGE = 512;
/** Phaser.BlendModes values (kept as numbers so this module stays importable without a DOM, for tests). */
export const BLEND_NORMAL = 0;
export const BLEND_MULTIPLY = 2;

/** Maps whose light is low (dusk biomes): longer shadows through the one shear constant. */
export function shearFor(biome: string): number {
  return biome === 'dusk' || biome === 'glade' ? SHADOW_SHEAR_LATE : SHADOW_SHEAR;
}

/** Multiply strength for a map: 30% under a roof or in the dark, 40% under the sky. */
export function shadowAlphaFor(def: { biome: string; kind?: string; flags?: readonly string[] }): number {
  return def.biome === 'cave' || def.biome === 'crypt' || def.kind === 'dungeon' || def.flags?.includes('dark') ? SHADOW_ALPHA_DARK : SHADOW_ALPHA;
}

export interface ShadowShape {
  /** Bitmap size (px). */
  w: number;
  h: number;
  /** Row-major: 0 empty, 1 cast shadow, 2 contact line (also shadow). */
  bits: Uint8Array;
  /** The sprite row its feet stand on (the lowest silhouette row): the shape's row 0 lies on that row. */
  foot: number;
  /** Silhouette height in px (foot row - top row + 1); 0 = nothing to cast. */
  tall: number;
}

/**
 * The cast shadow of a sprite. `rgba` is its pixels (row-major RGBA, `sw` x `sh`); `flip` mirrors the sprite first
 * (the shadow always falls down-right, whichever way the sprite faces). Pure and deterministic.
 */
export function castShape(rgba: ArrayLike<number>, sw: number, sh: number, flip = false, shear = SHADOW_SHEAR): ShadowShape {
  const solid = (x: number, y: number) => rgba[(y * sw + (flip ? sw - 1 - x : x)) * 4 + 3] >= SHADOW_MIN_ALPHA;
  let top = -1;
  let foot = -1;
  for (let y = 0; y < sh; y++)
    for (let x = 0; x < sw; x++)
      if (solid(x, y)) {
        if (top < 0) top = y;
        foot = y;
        break;
      }
  if (top < 0) return { w: 1, h: 1, bits: new Uint8Array(1), foot: sh - 1, tall: 0 };
  const tall = foot - top + 1;
  const k = Math.min(shear, SHADOW_MAX_REACH / tall);
  const reach = Math.round(k * (tall - 1));
  const w = sw + reach + 1;
  const h = Math.floor((tall - 1) * SHADOW_FLATTEN) + 2;
  const bits = new Uint8Array(w * h);
  for (let y = top; y <= foot; y++) {
    const z = foot - y;
    const oy = Math.floor(z * SHADOW_FLATTEN);
    const dx = Math.round(k * z);
    for (let x = 0; x < sw; x++) {
      if (!solid(x, y)) continue;
      bits[oy * w + x + dx] = 1;
      bits[oy * w + x + dx + 1] = 1; // the shear steps more than a pixel per shadow row: no pinholes
    }
  }
  // contact line: one row right under whatever touches the ground (the lowest two silhouette rows)
  for (let x = 0; x < sw; x++) if (solid(x, foot) || (foot > 0 && solid(x, foot - 1))) bits[w + x] = 2;
  return { w, h, bits, foot, tall };
}

/** Pixels of a texture frame (null when the frame has no readable canvas / image). */
function framePixels(scene: Phaser.Scene, key: string, frame?: string | number): { data: Uint8ClampedArray; w: number; h: number } | null {
  if (!scene.textures.exists(key)) return null;
  const tex = scene.textures.get(key);
  const f = tex.get(frame);
  const src = f?.source?.image as CanvasImageSource | undefined;
  if (!f || !src || f.width < 1 || f.height < 1) return null;
  const cv = document.createElement('canvas');
  cv.width = f.cutWidth;
  cv.height = f.cutHeight;
  const c = cv.getContext('2d', { willReadFrequently: true });
  if (!c) return null;
  try {
    c.drawImage(src, f.cutX, f.cutY, f.cutWidth, f.cutHeight, 0, 0, f.cutWidth, f.cutHeight);
    return { data: c.getImageData(0, 0, f.cutWidth, f.cutHeight).data, w: f.cutWidth, h: f.cutHeight };
  } catch {
    return null;
  }
}

/** A shape painted opaque on two canvases: the whole shadow, and its contact line alone. */
interface Stamp {
  shape: ShadowShape;
  cast: HTMLCanvasElement;
  contact: HTMLCanvasElement | null;
}

function stampOf(shape: ShadowShape): Stamp {
  const paint = (want: (v: number) => boolean): HTMLCanvasElement | null => {
    const cv = document.createElement('canvas');
    cv.width = shape.w;
    cv.height = shape.h;
    const c = cv.getContext('2d')!;
    const img = c.createImageData(shape.w, shape.h);
    let any = false;
    for (let i = 0; i < shape.bits.length; i++) {
      if (!want(shape.bits[i])) continue;
      img.data[i * 4] = (SHADOW_RGB >> 16) & 255;
      img.data[i * 4 + 1] = (SHADOW_RGB >> 8) & 255;
      img.data[i * 4 + 2] = SHADOW_RGB & 255;
      img.data[i * 4 + 3] = 255;
      any = true;
    }
    if (!any) return null;
    c.putImageData(img, 0, 0);
    return cv;
  };
  return { shape, cast: paint((v) => v > 0) ?? document.createElement('canvas'), contact: paint((v) => v === 2) };
}

/** A static thing that throws a shadow: a texture frame whose top-left corner is at world (x, y). */
export interface Caster {
  key: string;
  frame?: string | number;
  x: number;
  y: number;
  flip?: boolean;
}

/**
 * Bakes the shadows of static casters for the ground baker. Shapes are cached per texture frame (game-wide: textures
 * never change after boot), so a forest of one tree look is read back once.
 */
export class ShadowBaker {
  private static stamps = new Map<string, Stamp | null>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly shear = SHADOW_SHEAR,
  ) {}

  /** Forget every cached shape (WebGL context restore re-bakes the textures; shapes stay valid, so rarely needed). */
  static reset(): void {
    ShadowBaker.stamps.clear();
  }

  stamp(key: string, frame?: string | number, flip = false): Stamp | null {
    const id = `${key}|${frame ?? ''}|${flip ? 1 : 0}|${this.shear}`;
    let s = ShadowBaker.stamps.get(id);
    if (s === undefined) {
      const px = framePixels(this.scene, key, frame);
      const shape = px ? castShape(px.data, px.w, px.h, flip, this.shear) : null;
      s = shape && shape.tall > 0 ? stampOf(shape) : null;
      ShadowBaker.stamps.set(id, s);
    }
    return s;
  }

  /**
   * Paints the shadows of every caster that touches the rect (x0, y0, w, h) (world px) onto two fresh canvases of that
   * size: all cast shadows as one flat opaque layer (overlaps do not add up), and the contact lines. Null when the
   * rect holds no shadow.
   */
  layer(casters: readonly Caster[], x0: number, y0: number, w: number, h: number): { cast: HTMLCanvasElement; contact: HTMLCanvasElement } | null {
    let cast: HTMLCanvasElement | null = null;
    let contact: HTMLCanvasElement | null = null;
    let cc: CanvasRenderingContext2D | null = null;
    let kc: CanvasRenderingContext2D | null = null;
    for (const k of casters) {
      // cheap reject before touching the cache: a shadow never reaches further than the sprite + MAX_REACH
      if (k.x > x0 + w || k.y > y0 + h || k.x + 400 < x0 || k.y + 400 < y0) continue;
      const s = this.stamp(k.key, k.frame, k.flip);
      if (!s) continue;
      const dx = k.x - x0;
      const dy = k.y + s.shape.foot - y0;
      if (dx >= w || dy >= h || dx + s.shape.w <= 0 || dy + s.shape.h <= 0) continue;
      if (!cast) {
        cast = document.createElement('canvas');
        cast.width = w;
        cast.height = h;
        cc = cast.getContext('2d');
        contact = document.createElement('canvas');
        contact.width = w;
        contact.height = h;
        kc = contact.getContext('2d');
      }
      cc?.drawImage(s.cast, dx, dy);
      if (s.contact) kc?.drawImage(s.contact, dx, dy);
    }
    return cast && contact ? { cast, contact } : null;
  }
}

/** What ActorShadows needs to know about an actor (the entities' own fields, read structurally). */
export interface ShadowActor {
  sprite?: Phaser.GameObjects.Sprite | Phaser.GameObjects.Image;
  shadow?: Phaser.GameObjects.Image;
  /** Flying / hovering: keeps a small offset ellipse instead of a silhouette. */
  hover?: boolean;
}

interface AtlasFrame {
  name: string;
  /** Shape row 0 lies on this sprite row. */
  foot: number;
}

/**
 * Cast shadows of moving actors. sync() points an actor's own shadow image at the atlas frame matching the sprite
 * frame it shows right now (baked on first sight); the entity keeps positioning that image at its feet as before.
 */
interface AtlasState {
  frames: Map<string, AtlasFrame | null>;
  pages: { key: string; x: number; y: number; rowH: number; dirty: boolean }[];
  pageOf: Map<string, string>;
  hover: AtlasFrame | null;
}
/** The atlas is game-wide (one per shear): textures never change after boot, so frames are baked once per run. */
const ATLASES = new Map<number, AtlasState>();

export class ActorShadows {
  private shown = new WeakMap<Phaser.GameObjects.Image, string>();
  private readonly st: AtlasState;
  private get frames() {
    return this.st.frames;
  }
  private get pages() {
    return this.st.pages;
  }
  private get pageOf() {
    return this.st.pageOf;
  }

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly alpha = SHADOW_ALPHA,
    private readonly shear = SHADOW_SHEAR,
  ) {
    let st = ATLASES.get(shear);
    // a fresh game (tests, hot reload) starts a fresh atlas
    if (!st || (st.pages.length && !scene.textures.exists(st.pages[0].key))) ATLASES.set(shear, (st = { frames: new Map(), pages: [], pageOf: new Map(), hover: null }));
    this.st = st;
  }

  /** Reserves a w x h cell in the atlas and returns its page + position (a new 512 px page when the last is full). */
  private alloc(w: number, h: number): { page: AtlasState["pages"][number]; x: number; y: number } | null {
    if (w + 2 > PAGE || h + 2 > PAGE) return null;
    let p = this.pages[this.pages.length - 1];
    if (p && p.x + w + 1 > PAGE) {
      p.x = 1;
      p.y += p.rowH + 1;
      p.rowH = 0;
    }
    if (!p || p.y + h + 1 > PAGE) {
      const key = `${SHADOW_ATLAS}_${this.shear}_${this.pages.length}`;
      if (!this.scene.textures.createCanvas(key, PAGE, PAGE)) return null;
      p = { key, x: 1, y: 1, rowH: 0, dirty: false };
      this.pages.push(p);
    }
    const at = { page: p, x: p.x, y: p.y };
    p.x += w + 1;
    p.rowH = Math.max(p.rowH, h);
    return at;
  }

  private bake(id: string, shape: ShadowShape): (AtlasFrame & { page: string }) | null {
    const at = this.alloc(shape.w, shape.h);
    if (!at) return null;
    const tex = this.scene.textures.get(at.page.key) as Phaser.Textures.CanvasTexture;
    tex.getContext().drawImage(stampOf(shape).cast, at.x, at.y);
    tex.add(id, 0, at.x, at.y, shape.w, shape.h);
    at.page.dirty = true;
    return { name: id, foot: shape.foot, page: at.page.key };
  }

  private frameFor(key: string, frame: string | number, flip: boolean): AtlasFrame | null {
    const id = `${key}|${frame}|${flip ? 1 : 0}`;
    let f = this.frames.get(id);
    if (f === undefined) {
      const px = framePixels(this.scene, key, frame);
      const shape = px ? castShape(px.data, px.w, px.h, flip, this.shear) : null;
      const baked = shape && shape.tall > 0 ? this.bake(id, shape) : null;
      if (baked) this.pageOf.set(id, baked.page);
      f = baked;
      this.frames.set(id, f);
    }
    return f;
  }

  private hoverBlob(): AtlasFrame | null {
    if (this.st.hover) return this.st.hover;
    const w = 22;
    const h = 8;
    const bits = new Uint8Array(w * h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) if (((x + 0.5 - w / 2) / (w / 2)) ** 2 + ((y + 0.5 - h / 2) / (h / 2)) ** 2 <= 1) bits[y * w + x] = 1;
    const baked = this.bake('hover', { w, h, bits, foot: 0, tall: h });
    if (baked) this.pageOf.set('hover', baked.page);
    return (this.st.hover = baked);
  }

  /** Points `a.shadow` at the cast shadow of what `a.sprite` shows now. Cheap when nothing changed. */
  sync(a: ShadowActor): void {
    const s = a.sprite;
    const sh = a.shadow;
    if (!s || !sh || !s.active || !sh.active || !s.frame) return;
    const hover = a.hover === true;
    const id = hover ? 'hover' : `${s.texture.key}|${s.frame.name}|${s.flipX ? 1 : 0}`;
    if (this.shown.get(sh) === id) return;
    const f = hover ? this.hoverBlob() : this.frameFor(s.texture.key, s.frame.name, s.flipX);
    if (!f) return;
    this.shown.set(sh, id);
    sh.setTexture(this.pageOf.get(f.name) ?? SHADOW_ATLAS, f.name);
    if (hover) sh.setDisplayOrigin(11 - 5, 4 - 3);
    else {
      // The entity keeps the shadow image at (x, y + 1) with the sprite at (x, y): put the shape's first row on the
      // sprite's foot row and its left edge on the sprite's left edge.
      const ox = s.displayOriginX;
      const oy = s.displayOriginY;
      sh.setDisplayOrigin(ox, oy - f.foot + 1);
    }
    sh.setBlendMode(BLEND_MULTIPLY).setAlpha(this.alpha).setScale(1);
  }

  /** Uploads pages that got new frames this frame (once per frame, after every sync). */
  flush(): void {
    for (const p of this.pages) {
      if (!p.dirty) continue;
      p.dirty = false;
      (this.scene.textures.get(p.key) as Phaser.Textures.CanvasTexture).refresh();
    }
  }

  /** Frames baked so far (QA / tests). */
  get count(): number {
    let n = 0;
    for (const f of this.frames.values()) if (f) n++;
    return n;
  }

  /** Nothing to free: the atlas outlives the map (the actors' images are the entities' own). */
  destroy(): void {
    this.shown = new WeakMap();
  }
}
