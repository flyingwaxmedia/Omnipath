// Stage (render lane; docs/INTEGRATION-v3.md §2): everything static a map shows and the camera that looks at it —
// the baked ground (render/ground.ts), ground dressing (render/dressing.ts), props, structures, the darkness of dark
// maps, background colour, and the pixel-perfect camera (zoom 1, HUD-safe bounds, smooth follow of the player's
// LOGICAL position with the scroll on whole art pixels). MapScene calls buildStage() once in create(), stage.follow()
// once the player exists, stage.fit() after the HUD layout settles, stage.update() every frame and stage.destroy()
// on shutdown; it never touches these objects itself.
//
// Units: everything here is in art px (the backbuffer is art px; render/config.ts upscales it by an integer factor).
// HUD insets arrive in CSS px (StageHost.safeInsets()) and are converted with the current pixel scale.
//
// Light lane (docs/QUALITY-PLAN.md §10–11): dark and night maps get the pixel-banded light map (render/lighting.ts)
// instead of the flat fx_darkness overlay (kept as the Canvas / Low-quality fallback), every map gets OmniGrade
// (render/grade.ts) on the world camera; both follow their quality hooks live. The camera rig's flash rectangle is
// handed to the grade's soft flash channel while the grade runs. Props are flipped and jittered per tile.
import Phaser from 'phaser';
import { STRUCTURE_FOOTPRINT } from '../../core/world/compile';
import type { CompiledMap, MapDef, PropInst, PropKind } from '../../core/world/types';
import { PROP_VARIANTS, propKey } from '../art/world';
import { TILE } from '../world/runtime';
import { STAGE_ATLAS, packAtlas } from './atlas';
import { cellHash } from './autotile';
import { CameraRig, type RigScene } from './camera';
import { currentScale } from './config';
import { DEPTH, Y_BIAS, ySort } from './depths';
import { DRESSING_DECAL_DEPTH, type DressingItem, placeDressing, planDressing } from './dressing';
import { Grade, gradeEnabled, gradeSupported, onGradeChange } from './grade';
import { type BakedGround, FOREST_TINTS, bakeGround } from './ground';
import { ActorShadows, type Caster, type ShadowActor, shadowAlphaFor, shearFor } from './shadows';
import { LightMap, lightMapSupported, lightProfile, lightingEnabled, onLightingChange, staticLights } from './lighting';
import { clampScroll, cssToArt } from './pixelscale';
import { vfxSettings } from '../vfx/runtime/settings';

/** CSS px the persistent HUD covers along each screen edge. */
export interface Insets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

/** What the stage needs from the map scene. */
export interface StageHost {
  /** Runtime collision copy of the compiled map (sizes, ground, props). */
  readonly cm: CompiledMap;
  readonly def: MapDef;
  /** CSS px the HUD covers along each edge (the camera may scroll past a map edge by that much where needed). */
  safeInsets(): Insets;
}

/** A point the camera follows (the player's logical position — never the bobbing sprite). */
export interface FollowTarget {
  x: number;
  y: number;
  sprite: Phaser.GameObjects.Components.Transform;
}

export interface Stage {
  /** Props currently visible (perf budget ≤ 250 on phones; debug info). */
  readonly visibleProps: number;
  /** Starts following the player and centres the view on (x, y). */
  follow(target: FollowTarget, x: number, y: number): void;
  /** Re-fits bounds (HUD layout or screen size changed); centres on `at` when given. */
  fit(at?: { x: number; y: number }): void;
  /** Per frame (after the player moved): camera follow, darkness, culling. */
  update(dt: number, focus: { x: number; y: number }): void;
  /**
   * Camera rig (docs/VFX.md §8.6 item 6): adds trauma 0..1 (summed, capped at 1). The view shakes by
   * round(6 · τ² · noise(t · 25)) whole art pixels per axis while τ decays 2 / s — never a fractional offset.
   */
  addTrauma(amount: number): void;
  /** Current trauma (QA). */
  readonly trauma: number;
  /** The camera rig (render/camera.ts): trauma, kicks, governed flashes, the warden intro pan and the lead. */
  readonly rig: CameraRig;
  /** How this map is lit right now: the light map, the flat overlay (fallback) or daylight (debug / QA). */
  readonly lighting: 'lightmap' | 'overlay' | 'day';
  /** The light map and the grade while they run (debug / QA: stats, uniforms). */
  readonly lightMap: LightMap | null;
  readonly grade: Grade | null;
  destroy(): void;
}

/** Culling chunk size in tiles. */
const CHUNK = 16;
/** The darkness texture is drawn at this scale (3 art px steps; 512 × 3 = 1536 px across, like v2's 256 × 6). */
const DARK_SCALE = 3;
/** Darkness colour / outer alpha (the texture's rim), also used for the plain fill around the texture. */
const DARK_RGB = [4, 6, 14] as const;
const DARK_RIM = 0.85;
/** How far (art px) the plain fill reaches beyond the texture: wider than any view, whatever the scale. */
const DARK_REACH = 4096;
/** Camera smoothing time constant (s): v2's lerp 0.12 per 60 fps frame. */
const FOLLOW_TAU = 0.13;
/** Prop jitter (polish audit): ±PROP_JX px across, PROP_JY_UP px up to PROP_JY_DOWN px down, per tile. */
export const PROP_JX = 4;
export const PROP_JY_UP = 4;
export const PROP_JY_DOWN = 2;
/**
 * Props never mirrored: their art carries a clear lit face and shadow face (docs/ART-DIRECTION.md §1: light from the
 * top-left; art/world.ts draws their look variants instead of mirroring). A flipped rock, crystal, spire, tombstone or
 * two-tone pine would be lit from the right next to its unflipped neighbour. Organic props (trees, bushes, dead trees,
 * mushrooms, willows, reeds) keep the flip: their scattered cluster highlights read as another plant, not another sun.
 */
export const PROP_NO_FLIP: ReadonlySet<PropKind> = new Set<PropKind>(['rock', 'boulder', 'crystal', 'stalagmite', 'tombstone', 'basalt_spire', 'pine', 'frostpine', 'menhir']);

/** Alpha of a tall prop or building while the hero stands behind it (SPEC-v4 §11.2 B / G), and the step per frame. */
export const BEHIND_ALPHA = 0.4;
const FADE_STEP = 0.12;
/** The lowest part of a tall sprite never hides the hero (the trunk, a wall's foot): px above its foot. */
const FADE_FOOT = 22;

/** How one compiled prop is drawn: texture, foot position (px), mirror and multiply tint. Pure per map seed. */
export interface PropView {
  key: string;
  x: number;
  y: number;
  flip: boolean;
  tint: number;
  /** L, XL or a canopy mass: fades while the hero stands behind it. */
  tall: boolean;
}

/**
 * Resolves a compiled prop to what the stage draws (SPEC-v4 §11.2 B, E). Tiered props carry their own look, offset
 * and mirror from the compiler; plain one-tile props keep the per-tile look, jitter and coin flip of propPlacement().
 * `has` tells whether a texture exists (a missing tier or look falls back to a drawn one).
 */
export function propView(pr: PropInst, seed: number, has: (key: string) => boolean): PropView | null {
  const tier = pr.tier ?? 'M';
  const tint = FOREST_TINTS[Math.min(FOREST_TINTS.length - 1, pr.shade ?? 0)];
  const noFlip = PROP_NO_FLIP.has(pr.kind);
  if (pr.mass) {
    const key = [`${pr.kind}_mass${pr.look ? `~${pr.look}` : ''}`, `${pr.kind}_mass`].find(has);
    if (!key) return null;
    return { key, x: pr.tx * TILE + TILE / 2 + (pr.ox ?? 0), y: (pr.ty + 1) * TILE + (pr.oy ?? 0), flip: !noFlip && !!pr.flip, tint, tall: true };
  }
  if (tier === 'M') {
    const looks = [pr.kind, ...(PROP_VARIANTS[pr.kind] ?? [])].filter(has);
    if (!looks.length) return null;
    const at = propPlacement(pr.tx, pr.ty, seed, pr.kind, looks.length);
    const key = pr.look !== undefined ? looks[pr.look % looks.length] : looks[at.look];
    if (pr.ox === undefined && pr.oy === undefined) return { key, x: at.x, y: at.y, flip: pr.flip ?? at.flip, tint, tall: false };
    return { key, x: pr.tx * TILE + TILE / 2 + (pr.ox ?? 0), y: (pr.ty + 1) * TILE + (pr.oy ?? 0), flip: !noFlip && (pr.flip ?? at.flip), tint, tall: false };
  }
  const key = [propKey(pr.kind, tier, pr.look ?? 0), propKey(pr.kind, tier, 0), pr.kind].find(has);
  if (!key) return null;
  return { key, x: pr.tx * TILE + TILE / 2 + (pr.ox ?? 0), y: (pr.ty + 1) * TILE + (pr.oy ?? 0), flip: !noFlip && pr.kind !== 'rock' && !!pr.flip, tint, tall: tier !== 'S' };
}

/**
 * Where a map prop stands and whether it is mirrored (pure, deterministic per tile and map seed): a look variant,
 * a whole-pixel jitter of ±4 px across and -4..+2 px down from the tile's bottom-centre, and a horizontal flip on
 * about half the tiles (never for PROP_NO_FLIP kinds) — so repeated props (forests, rock fields) stop reading as one
 * stamp on a grid.
 */
export function propPlacement(tx: number, ty: number, seed: number, kind: PropKind, looks: number): { x: number; y: number; flip: boolean; look: number } {
  const h = cellHash(tx, ty, seed, 0x9a0b);
  const h2 = cellHash(tx, ty, seed, 0x51f7);
  const x = tx * TILE + TILE / 2 + ((h >>> 8) % (2 * PROP_JX + 1)) - PROP_JX;
  const y = (ty + 1) * TILE + ((h2 >>> 4) % (PROP_JY_UP + PROP_JY_DOWN + 1)) - PROP_JY_UP;
  const flip = !PROP_NO_FLIP.has(kind) && ((h2 >>> 12) & 1) === 1;
  return { x, y, flip, look: h % Math.max(1, looks) };
}

/** The player's HP share for the grade's low-HP desaturation, read structurally from the map scene (MapScene keeps
 *  `session.player.hp` and `stats().maxHp`); null when the host has neither. maxHp is re-read every 500 ms. */
function hpReader(host: StageHost): () => number | null {
  const h = host as unknown as { session?: { player?: { hp?: number } }; stats?: () => { maxHp?: number } };
  let max = 0;
  let at = -1e9;
  return () => {
    const hp = h.session?.player?.hp;
    if (typeof hp !== 'number' || typeof h.stats !== 'function') return null;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - at > 500) {
      at = now;
      try {
        max = h.stats().maxHp ?? 0;
      } catch {
        max = 0;
      }
    }
    return max > 0 ? hp / max : null;
  };
}

/** Dressing plans are pure per map: plan each map once per run. */
const dressingPlans = new Map<string, readonly DressingItem[]>();

export function buildStage(scene: Phaser.Scene, host: StageHost): Stage {
  return new PixelStage(scene, host);
}

/** Static images indexed in CHUNK×CHUNK-tile chunks; only chunks touching the view are scanned. */
class Culler {
  private chunks: Phaser.GameObjects.Image[][];
  private live = new Set<number>();
  private win = '';
  visible = 0;

  constructor(
    private readonly cols: number,
    rows: number,
    /** How far above its base (px) an image may reach (tall trees, banners). */
    private readonly reach: number,
    /** How far to either side of its foot (px) an image may reach (half the widest sprite). */
    private readonly side: number = TILE * 1.5,
  ) {
    this.chunks = Array.from({ length: cols * rows }, () => []);
  }

  add(img: Phaser.GameObjects.Image): void {
    const cx = Math.max(0, Math.min(this.cols - 1, Math.floor(img.x / (CHUNK * TILE))));
    const rows = this.chunks.length / this.cols;
    const cy = Math.max(0, Math.min(rows - 1, Math.floor((img.y - 1) / (CHUNK * TILE))));
    img.setVisible(false);
    this.chunks[cy * this.cols + cx].push(img);
  }

  invalidate(): void {
    this.win = '';
  }

  /** Shows what overlaps the view rect (x, y, w, h in px); runs only when the view moved by a tile. */
  cull(x: number, y: number, w: number, h: number): void {
    const left = x - this.side;
    const right = x + w + this.side;
    const top = y - TILE;
    const bottom = y + h + this.reach;
    const key = `${Math.floor(left / TILE)},${Math.floor(top / TILE)},${Math.ceil(right / TILE)},${Math.ceil(bottom / TILE)}`;
    if (key === this.win) return;
    this.win = key;
    const span = CHUNK * TILE;
    const rows = this.chunks.length / Math.max(1, this.cols);
    const cx0 = Math.max(0, Math.floor(left / span));
    const cx1 = Math.min(this.cols - 1, Math.floor(right / span));
    const cy0 = Math.max(0, Math.floor(top / span));
    const cy1 = Math.min(rows - 1, Math.floor(bottom / span));
    const next = new Set<number>();
    let shown = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * this.cols + cx;
        next.add(ci);
        for (const img of this.chunks[ci]) {
          const on = img.x >= left && img.x <= right && img.y >= top && img.y <= bottom;
          if (img.visible !== on) img.setVisible(on);
          if (on) shown++;
        }
      }
    }
    for (const ci of this.live) {
      if (next.has(ci)) continue;
      for (const img of this.chunks[ci]) if (img.visible) img.setVisible(false);
    }
    this.live = next;
    this.visible = shown;
  }

  clear(): void {
    this.chunks = [];
    this.live.clear();
  }
}

class PixelStage implements Stage {
  private ground: BakedGround | null = null;
  private dressing: { destroy(): void } | null = null;
  private props: Culler;
  private decor: Culler;
  private dark: Phaser.GameObjects.Container | null = null;
  /** Light lane: the light map (dark / night maps, WebGL, lighting on) and OmniGrade (WebGL, grade on). */
  private light: LightMap | null = null;
  private graded: Grade | null = null;
  /** The camera rig's flash rectangle (created lazily by the rig through rigScene()). */
  private flashRect: Phaser.GameObjects.Rectangle | null = null;
  private dressingPlan: readonly DressingItem[] = [];
  private readonly hp: () => number | null;
  private readonly unsub: (() => void)[] = [];
  private target: FollowTarget | null = null;
  /** Smoothed camera centre (float, art px). */
  private cx = 0;
  private cy = 0;
  /** Scroll range (art px, integers); min > max on an axis means "centre the map". */
  private range = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  /** The part of the camera actually on screen (art px): the canvas overflows the viewport by < artStep art px at
   *  its right / bottom edge, and that strip is cropped, so bounds and centring use this size. */
  private view = { w: 0, h: 0 };
  /** Camera rig (render/camera.ts): shake + kicks after the map clamp, the look (pan / lead) before it. */
  readonly rig: CameraRig;
  /** Tall props and buildings (they fade while the hero stands behind them) and the actors' cast shadows. */
  private tall: { img: Phaser.GameObjects.Image; hw: number; h: number }[] = [];
  private actorShadows: ActorShadows | null = null;
  private npcShadows: ShadowActor[] | null = null;
  private readonly onResize = () => this.fit();
  /** A panel paused the world: a flash mid-frames must not stay up behind it (camera rig). */
  private readonly onPause = () => this.rig.settle();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: StageHost,
  ) {
    const def = host.def;
    const cm = host.cm;
    const cave = ['cave', 'crypt'].includes(def.biome);
    const cam = scene.cameras.main;
    cam.setBackgroundColor(cave ? '#0b0d14' : '#16261a');
    cam.setZoom(1);
    cam.setRoundPixels(true);
    cam.removeBounds();
    this.rig = new CameraRig(this.rigScene(), () => vfxSettings.reduceFlash);
    this.rig.install(cam);
    this.hp = hpReader(host);
    const cols = Math.ceil(cm.w / CHUNK);
    const rows = Math.ceil(cm.h / CHUNK);
    this.props = new Culler(cols, rows, TILE * 5, TILE * 2.5);
    this.decor = new Culler(cols, rows, TILE * 2);
    // Plan everything static first: the ground baker paints its cast shadows into the ground (render/shadows.ts).
    const casters: Caster[] = [];
    this.atlas = this.buildAtlas();
    this.buildDressing(casters);
    this.buildProps(casters);
    this.buildStructures(casters);
    this.planFixtureShadows(casters);
    const shear = shearFor(def.biome);
    const alpha = shadowAlphaFor(def);
    this.ground = bakeGround(scene, cm, { casters, alpha, shear });
    this.actorShadows = new ActorShadows(scene, alpha, shear);
    this.applyLighting();
    this.applyGrade();
    this.unsub.push(
      onLightingChange(() => this.applyLighting()),
      onGradeChange(() => this.applyGrade()),
    );
    scene.scale.on('resize', this.onResize);
    scene.events.on(Phaser.Scenes.Events.PAUSE, this.onPause);
  }

  get lighting(): 'lightmap' | 'overlay' | 'day' {
    return this.light ? 'lightmap' : this.dark ? 'overlay' : 'day';
  }

  get lightMap(): LightMap | null {
    return this.light;
  }

  get grade(): Grade | null {
    return this.graded;
  }

  /** The scene as the camera rig sees it: the same cameras, but its flash rectangle is kept for the grade. */
  private rigScene(): RigScene {
    const scene = this.scene;
    return {
      cameras: scene.cameras,
      add: {
        rectangle: (x: number, y: number, w: number, h: number, color: number, alpha: number) => {
          const r = scene.add.rectangle(x, y, w, h, color, alpha);
          this.flashRect = r;
          return r;
        },
      },
    };
  }

  /**
   * Light map, flat overlay or daylight: the light map on dark / night maps when lighting is on and the renderer is
   * WebGL; the old banded overlay on dark maps otherwise (Canvas, Low quality); nothing on day maps.
   */
  private applyLighting(): void {
    this.light?.destroy();
    this.light = null;
    this.dark?.destroy();
    this.dark = null;
    const { def, cm } = this.host;
    const profile = lightProfile(def);
    if (profile && lightingEnabled() && lightMapSupported(this.scene)) {
      const sources = staticLights(cm, def, this.dressingPlan);
      this.light = new LightMap(this.scene, profile, sources, { focus: () => this.target });
    } else if (def.flags?.includes('dark')) {
      this.dark = this.buildDarkness();
      if (this.target) this.dark.setPosition(Math.round(this.target.x), Math.round(this.target.y - 16));
    }
  }

  /** OmniGrade on the world camera (WebGL, grade on); the camera rig's flash goes through its soft flash channel. */
  private applyGrade(): void {
    this.graded?.destroy();
    this.graded = null;
    if (!gradeEnabled() || !gradeSupported(this.scene)) return;
    try {
      this.graded = new Grade(this.scene, Phaser.Renderer.WebGL.Pipelines.PostFXPipeline, {
        biome: this.host.def.biome,
        hp: this.hp,
        flash: () => {
          const r = this.flashRect;
          if (!r || !r.active || !r.visible || r.alpha <= 0) return null;
          const out = { color: r.fillColor, alpha: r.alpha };
          // The grade draws it (softly) instead; the rig sets the alpha again on its next frame step.
          r.setAlpha(0);
          return out;
        },
      });
    } catch (err) {
      // A driver that cannot compile the pass keeps the ungraded look (and the old flash rectangle).
      console.warn('[omnipath] OmniGrade disabled:', err);
      this.graded = null;
    }
  }

  get visibleProps(): number {
    return this.props.visible;
  }

  get trauma(): number {
    return this.rig.trauma;
  }

  addTrauma(amount: number): void {
    this.rig.addTrauma(amount);
  }

  follow(target: FollowTarget, x: number, y: number): void {
    this.target = target;
    this.fit({ x, y });
  }

  fit(at?: { x: number; y: number }): void {
    const cam = this.scene.cameras.main;
    const { width: vw, height: vh } = this.scene.scale;
    if (cam.width !== vw || cam.height !== vh) cam.setSize(vw, vh);
    if (cam.zoom !== 1) cam.setZoom(1);
    const scale = currentScale(this.scene);
    const vis = (cssView: number | undefined, art: number) =>
      scale && cssView && cssView > 0 ? Math.max(1, Math.min(art, Math.round(cssToArt(cssView, scale)))) : art;
    this.view = { w: vis(scale?.viewW, vw), h: vis(scale?.viewH, vh) };
    const cm = this.host.cm;
    const mw = cm.w * TILE;
    const mh = cm.h * TILE;
    // HUD-safe bounds: where something the player must see or tap (portal, object, node, NPC) lies near a map edge,
    // the camera may scroll past that edge by the HUD strip on that side, so it never stays stuck under the HUD
    // (playtest: mirror_lake#islet and greystone_quarry#shaft on portrait phones). Edges with nothing there keep the
    // tight bounds, so no empty margin shows. Maps smaller than the view are centred.
    const toArt = (css: number) => (scale ? cssToArt(css, scale) : css * this.scene.scale.displayScale.x);
    const ins = this.host.safeInsets();
    const need = this.edgeThings();
    const pad = (css: number, side: keyof Insets) => {
      const px = toArt(css);
      return px > 0 && need[side] < px + TILE * 2 ? Math.ceil(px) : 0;
    };
    const { w: sw, h: sh } = this.view;
    const minX = Math.min(0, (mw - sw) / 2) - pad(ins.left, 'left');
    const maxX = Math.max(mw - sw, (mw - sw) / 2) + pad(ins.right, 'right');
    const minY = Math.min(0, (mh - sh) / 2) - pad(ins.top, 'top');
    const maxY = Math.max(mh - sh, (mh - sh) / 2) + pad(ins.bottom, 'bottom');
    this.range = { minX: Math.floor(minX), maxX: Math.ceil(maxX), minY: Math.floor(minY), maxY: Math.ceil(maxY) };
    if (at) {
      this.cx = at.x;
      this.cy = at.y;
    }
    this.place();
  }

  update(dt: number, focus: { x: number; y: number }): void {
    const t = this.target ?? focus;
    // Frame-rate independent smoothing of the camera centre toward the player's logical position; big jumps snap.
    const dx = t.x - this.cx;
    const dy = t.y - this.cy;
    const cam = this.scene.cameras.main;
    if (Math.abs(dx) > cam.width * 1.5 || Math.abs(dy) > cam.height * 1.5) {
      this.cx = t.x;
      this.cy = t.y;
    } else {
      const a = 1 - Math.exp(-Math.max(0, dt) / FOLLOW_TAU);
      this.cx += dx * a;
      this.cy += dy * a;
    }
    // Camera rig: trauma² shake and kicks in whole art pixels, the warden pan / lead.
    this.rig.update(dt, t, { w: this.view.w || cam.width, h: this.view.h || cam.height });
    this.place();
    this.dark?.setPosition(Math.round(t.x), Math.round(t.y - 16));
    this.fadeTall(t);
    this.syncShadows();
  }

  /**
   * Tall things in front of an actor go see-through while they cover it, in a few alpha steps (never a tween): the
   * hero, and every living monster on screen — a foe behind a tall crown must stay readable (and tappable by eye).
   */
  private fadeTall(p: { x: number; y: number }): void {
    const cam = this.scene.cameras.main;
    const view = cam.worldView;
    const pts: { x: number; y: number }[] = [p];
    const foes = (this.host as unknown as { combat?: { monsters?: { x: number; y: number; alive: boolean }[] } }).combat?.monsters;
    if (foes) {
      for (const m of foes) {
        if (m.alive && m.x > view.x - 40 && m.x < view.right + 40 && m.y > view.y - 20 && m.y < view.bottom + 180) pts.push(m);
      }
    }
    for (const t of this.tall) {
      const img = t.img;
      if (!img.visible) continue;
      let covers = false;
      for (const q of pts) {
        if (q.y < img.y - 2 && q.y > img.y - t.h - 4 && q.y - 30 < img.y - FADE_FOOT && Math.abs(q.x - img.x) < t.hw + 6) {
          covers = true;
          break;
        }
      }
      const want = covers ? BEHIND_ALPHA : 1;
      if (img.alpha === want) continue;
      const a = img.alpha < want ? Math.min(want, img.alpha + FADE_STEP) : Math.max(want, img.alpha - FADE_STEP);
      img.setAlpha(a);
    }
  }

  /**
   * Cast shadows of the actors (the player, monsters, NPCs): their own shadow images are pointed at the silhouette of
   * the frame they show (render/shadows.ts). The entities are read structurally (`sprite`, `shadow`, `hover`), like
   * hpReader() reads the session: an actor without those fields simply keeps its plain blob.
   */
  private syncShadows(): void {
    const sh = this.actorShadows;
    if (!sh) return;
    const h = this.host as unknown as { player?: ShadowActor; combat?: { monsters?: ShadowActor[] }; npcs?: { sprite?: Phaser.GameObjects.Sprite }[] };
    if (h.player) sh.sync(h.player);
    const ms = h.combat?.monsters;
    if (ms) for (let i = 0; i < ms.length; i++) sh.sync(ms[i]);
    if (!this.npcShadows && h.npcs) {
      // NPC shadow images are not kept by their views: find each one under its sprite (same x, same foot y)
      const blobs = this.scene.children.list.filter((o): o is Phaser.GameObjects.Image => o instanceof Phaser.GameObjects.Image && o.depth === DEPTH.SHADOW && o.texture.key === 'shadow');
      this.npcShadows = [];
      for (const n of h.npcs) {
        const sp = n.sprite;
        const blob = sp && blobs.find((b) => Math.abs(b.x - sp.x) < 1 && Math.abs(b.y - sp.y) < 2);
        if (sp && blob) this.npcShadows.push({ sprite: sp, shadow: blob });
      }
    }
    if (this.npcShadows) for (const n of this.npcShadows) sh.sync(n);
    sh.flush();
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize);
    this.scene.events.off(Phaser.Scenes.Events.PAUSE, this.onPause);
    this.ground?.destroy();
    this.ground = null;
    this.dressing?.destroy();
    this.dressing = null;
    this.props.clear();
    this.decor.clear();
    this.tall = [];
    this.actorShadows?.destroy();
    this.actorShadows = null;
    this.npcShadows = null;
    for (const u of this.unsub.splice(0)) u();
    this.light?.destroy();
    this.light = null;
    this.graded?.destroy();
    this.graded = null;
    this.dark = null;
    this.target = null;
    this.flashRect = null;
    this.rig.destroy();
  }

  // ------------------------------------------------------------------ camera

  /**
   * Puts the camera on whole art pixels. The player is drawn at round(x); the camera centre is round(x) plus the
   * ROUNDED smoothing lag, so while walking at a steady speed the player keeps the same screen pixel (no 1 px
   * shimmer from the camera and the sprite rounding differently).
   */
  private place(): void {
    const cam = this.scene.cameras.main;
    if (cam.panEffect?.isRunning) return;
    const t = this.target;
    const ax = t ? Math.round(t.x) + Math.round(this.cx - t.x) : Math.round(this.cx);
    const ay = t ? Math.round(t.y) + Math.round(this.cy - t.y) : Math.round(this.cy);
    const r = this.range;
    const rig = this.rig;
    const sx = clampScroll(ax + rig.look.x, this.view.w || cam.width, r.minX, r.maxX) + rig.jolt.x;
    const sy = clampScroll(ay + rig.look.y, this.view.h || cam.height, r.minY, r.maxY) + rig.jolt.y;
    if (cam.scrollX !== sx || cam.scrollY !== sy) cam.setScroll(sx, sy);
    this.props.cull(sx, sy, cam.width, cam.height);
    this.decor.cull(sx, sy, cam.width, cam.height);
  }

  // ------------------------------------------------------------------ building

  /** Distance (px) from each map edge to the nearest portal / object / node / NPC (for the HUD-safe camera bounds). */
  private edgeThings(): Insets {
    const { cm, def } = this.host;
    const mw = cm.w * TILE;
    const mh = cm.h * TILE;
    const out = { top: Infinity, right: Infinity, bottom: Infinity, left: Infinity };
    const add = (tx: number, ty: number, w = 1, h = 1) => {
      out.left = Math.min(out.left, tx * TILE);
      out.top = Math.min(out.top, ty * TILE);
      out.right = Math.min(out.right, mw - (tx + w) * TILE);
      out.bottom = Math.min(out.bottom, mh - (ty + h) * TILE);
    };
    for (const p of def.portals) add(p.tx, p.ty, p.w, p.h);
    for (const o of def.objects ?? []) add(o.tx, o.ty);
    for (const n of def.nodes ?? []) add(n.tx, n.ty);
    for (const n of def.npcs ?? []) add(n.tx, n.ty);
    return out;
  }

  /**
   * Darkness for 'dark' maps, following the player: the banded light hole (darkTexture at DARK_SCALE, 1536 art px
   * across) plus a plain fill of the rim's darkness around it, so wide views (desktop 960 art px, a player at a map
   * edge) never show an unlit strip past the texture.
   */
  private buildDarkness(): Phaser.GameObjects.Container {
    const half = (512 * DARK_SCALE) / 2;
    const R = DARK_REACH;
    const color = (DARK_RGB[0] << 16) | (DARK_RGB[1] << 8) | DARK_RGB[2];
    const fill = (x: number, y: number, w: number, h: number) =>
      this.scene.add.rectangle(x, y, w, h, color, DARK_RIM).setOrigin(0, 0);
    return this.scene.add
      .container(0, 0, [
        this.scene.add.image(0, 0, this.darkTexture()).setScale(DARK_SCALE),
        fill(-R, -R, 2 * R, R - half), // above
        fill(-R, half, 2 * R, R - half), // below
        fill(-R, -half, R - half, 2 * half), // left
        fill(half, -half, R - half, 2 * half), // right
      ])
      .setDepth(DEPTH.DARKNESS);
  }

  /**
   * The light hole for 'dark' maps: flat alpha bands (pixel-banded light, no smooth gradient), 512 px square drawn at
   * DARK_SCALE, DARK_RIM outside the bands. Generated once per game.
   */
  private darkTexture(): string {
    const key = 'fx_darkness_px';
    const textures = this.scene.textures;
    if (textures.exists(key)) return key;
    const S = 512;
    const tex = textures.createCanvas(key, S, S);
    if (!tex) return key;
    const g = tex.getContext();
    // (radius as a fraction of the half size, alpha): clear within ~115 px of the player, DARK_RIM outside ~300 px
    // Tuned to read like the High-tier light map (lantern pool ~130 px, unlit ground ~15-20 %), so Low quality and
    // the Canvas renderer keep dungeons dark instead of evenly grey.
    const bands: readonly [number, number][] = [
      [1, DARK_RIM],
      [0.4, 0.8],
      [0.33, 0.7],
      [0.27, 0.55],
      [0.22, 0.38],
      [0.18, 0.2],
      [0.15, 0],
    ];
    const img = g.createImageData(S, S);
    for (let y = 0; y < S; y++)
      for (let x = 0; x < S; x++) {
        const r = Math.hypot(x + 0.5 - S / 2, y + 0.5 - S / 2) / (S / 2);
        let a = DARK_RIM;
        for (const [br, ba] of bands) if (r <= br) a = ba;
        const i = (y * S + x) * 4;
        img.data[i] = DARK_RGB[0];
        img.data[i + 1] = DARK_RGB[1];
        img.data[i + 2] = DARK_RGB[2];
        img.data[i + 3] = Math.round(a * 255);
      }
    g.putImageData(img, 0, 0);
    tex.refresh();
    return key;
  }

  /** A static image as a shadow caster (its texture frame's top-left corner in world px). */
  private caster(key: string, x: number, y: number, flip = false): Caster {
    const f = this.scene.textures.get(key).get();
    return { key, x: Math.floor(x - f.width / 2), y: y - f.height, flip };
  }

  /** Keys of the textures this map's stage atlas holds (empty: every image keeps its own texture). */
  private atlas: ReadonlySet<string> = new Set();

  private planOfDressing(): readonly DressingItem[] {
    const id = this.host.def.id;
    let plan = dressingPlans.get(id);
    if (!plan) {
      plan = planDressing(this.host.cm);
      dressingPlans.set(id, plan);
    }
    return plan;
  }

  /** One shared texture for this map's props, dressing and buildings (render/atlas.ts). */
  private buildAtlas(): ReadonlySet<string> {
    const keys = new Set<string>();
    const has = (k: string) => this.scene.textures.exists(k);
    for (const it of this.planOfDressing()) keys.add(it.key);
    const seed = this.host.def.seed ?? 0;
    for (const pr of this.host.cm.props) {
      const v = propView(pr, seed, has);
      if (v) keys.add(v.key);
    }
    for (const st of this.host.def.structures ?? []) keys.add(`struct_${st.kind}`);
    return packAtlas(this.scene, keys);
  }

  /** An image of a world texture: from the stage atlas when it holds it. */
  private worldImage(x: number, y: number, key: string): Phaser.GameObjects.Image {
    return this.atlas.has(key) ? this.scene.add.image(x, y, STAGE_ATLAS, key) : this.scene.add.image(x, y, key);
  }

  private buildDressing(casters: Caster[]): void {
    const plan = this.planOfDressing();
    this.dressingPlan = plan;
    const handle = placeDressing(this.scene, plan, { key: STAGE_ATLAS, has: this.atlas });
    for (const img of handle.images) this.decor.add(img);
    for (const it of plan) {
      if (it.depthY === DRESSING_DECAL_DEPTH || !this.scene.textures.exists(it.key)) continue;
      casters.push(this.caster(it.key, it.x, it.y, it.flipX));
    }
    this.dressing = handle;
  }

  /**
   * Props (propView): tiered props stand where the compiler put them, with the look it chose; plain one-tile props
   * pick a look per tile, get a whole-pixel jitter (±4 px) and about half of the organic ones are mirrored (lit-face
   * props never are). Rows deeper in a tree line are tinted a step darker each. Visual only: collision stays on the
   * tiles. Mirroring is flipX (never a fractional scale).
   */
  private buildProps(casters: Caster[]): void {
    const seed = this.host.def.seed ?? 0;
    const has = (k: string) => this.scene.textures.exists(k);
    for (const pr of this.host.cm.props) {
      const v = propView(pr, seed, has);
      if (!v) continue;
      const img = this.worldImage(v.x, v.y, v.key).setOrigin(0.5, 1).setDepth(ySort(v.y, Y_BIAS.PROP));
      if (v.flip) img.setFlipX(true);
      if (v.tint !== 0xffffff) img.setTint(v.tint);
      this.props.add(img);
      // the interior of a tree line is already in shade: only the rows the light reaches cast
      if (!pr.mass && (pr.shade ?? 0) < 2) casters.push(this.caster(v.key, v.x, v.y, v.flip));
      if (v.tall && !pr.mass && (pr.shade ?? 0) < 2) this.tall.push({ img, hw: img.width / 2 - 8, h: img.height });
    }
  }

  private buildStructures(casters: Caster[]): void {
    for (const st of this.host.def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[st.kind];
      const key = `struct_${st.kind}`;
      if (!fp || !this.scene.textures.exists(key)) continue;
      const x = (st.tx + fp.w / 2) * TILE;
      const y = (st.ty + fp.h) * TILE;
      const img = this.worldImage(Math.round(x), y + 4, key).setOrigin(0.5, 1).setDepth(ySort(y));
      casters.push(this.caster(key, Math.round(x), y + 4));
      // only what rises above the footprint can cover the hero (he cannot stand inside it)
      if (img.height > fp.h * TILE + 24) this.tall.push({ img, hw: img.width / 2 - 6, h: img.height });
    }
  }

  /** Objects and gather nodes are placed by the map scene; their shadows are static, so they are baked here. */
  private planFixtureShadows(casters: Caster[]): void {
    const def = this.host.def;
    const add = (key: string, tx: number, ty: number) => {
      if (this.scene.textures.exists(key)) casters.push(this.caster(key, tx * TILE + TILE / 2, ty * TILE + TILE - 4));
    };
    for (const o of def.objects ?? []) add(`obj_${o.kind}`, o.tx, o.ty);
    for (const n of def.nodes ?? []) if (n.kind !== 'fishing') add(`node_${n.kind}`, n.tx, n.ty);
  }
}
