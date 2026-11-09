// Stage (render lane; docs/INTEGRATION-v3.md §2): everything static a map shows and the camera that looks at it —
// the baked ground (render/ground.ts), ground dressing (render/dressing.ts), props, structures, the darkness of dark
// maps, background colour, and the pixel-perfect camera (zoom 1, HUD-safe bounds, smooth follow of the player's
// LOGICAL position with the scroll on whole art pixels). MapScene calls buildStage() once in create(), stage.follow()
// once the player exists, stage.fit() after the HUD layout settles, stage.update() every frame and stage.destroy()
// on shutdown; it never touches these objects itself.
//
// Units: everything here is in art px (the backbuffer is art px; render/config.ts upscales it by an integer factor).
// HUD insets arrive in CSS px (StageHost.safeInsets()) and are converted with the current pixel scale.
import Phaser from 'phaser';
import { STRUCTURE_FOOTPRINT } from '../../core/world/compile';
import type { CompiledMap, MapDef } from '../../core/world/types';
import { PROP_VARIANTS } from '../art/world';
import { TILE } from '../world/runtime';
import { cellHash } from './autotile';
import { currentScale } from './config';
import { DEPTH, Y_BIAS, ySort } from './depths';
import { type DressingItem, placeDressing, planDressing } from './dressing';
import { type BakedGround, bakeGround } from './ground';
import { clampScroll, cssToArt } from './pixelscale';

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
  destroy(): void;
}

/** Culling chunk size in tiles. */
const CHUNK = 16;
/** The darkness texture is drawn at this scale (3 art px steps; 512 × 3 = 1536 px across, like v2's 256 × 6). */
const DARK_SCALE = 3;
/** Darkness colour / outer alpha (the texture's rim), also used for the plain fill around the texture. */
const DARK_RGB = [4, 6, 14] as const;
const DARK_RIM = 0.8;
/** How far (art px) the plain fill reaches beyond the texture: wider than any view, whatever the scale. */
const DARK_REACH = 4096;
/** Camera smoothing time constant (s): v2's lerp 0.12 per 60 fps frame. */
const FOLLOW_TAU = 0.13;
/** Camera rig: max shake (art px) at trauma 1, trauma decay per second, noise frequency (Hz). */
const SHAKE_PX = 6;
const TRAUMA_DECAY = 2;
const SHAKE_HZ = 25;

/** Smooth 1-D value noise in [-1, 1] (deterministic: shake never reads Math.random). */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t);
  const f = t - i;
  const h = (n: number) => {
    const x = Math.sin((n + seed * 101.3) * 127.1) * 43758.5453;
    return (x - Math.floor(x)) * 2 - 1;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) * (1 - u) + h(i + 1) * u;
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
    const left = x - TILE * 1.5;
    const right = x + w + TILE * 1.5;
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
  private target: FollowTarget | null = null;
  /** Smoothed camera centre (float, art px). */
  private cx = 0;
  private cy = 0;
  /** Scroll range (art px, integers); min > max on an axis means "centre the map". */
  private range = { minX: 0, maxX: 0, minY: 0, maxY: 0 };
  /** The part of the camera actually on screen (art px): the canvas overflows the viewport by < artStep art px at
   *  its right / bottom edge, and that strip is cropped, so bounds and centring use this size. */
  private view = { w: 0, h: 0 };
  /** Camera rig: trauma 0..1, its clock (s) and the integer offset it adds to the scroll this frame. */
  private tau = 0;
  private shakeT = 0;
  private shake = { x: 0, y: 0 };
  private readonly onResize = () => this.fit();

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
    const cols = Math.ceil(cm.w / CHUNK);
    const rows = Math.ceil(cm.h / CHUNK);
    this.props = new Culler(cols, rows, TILE * 3);
    this.decor = new Culler(cols, rows, TILE * 2);
    this.ground = bakeGround(scene, cm);
    this.buildDressing();
    this.buildProps();
    this.buildStructures();
    if (def.flags?.includes('dark')) this.dark = this.buildDarkness();
    scene.scale.on('resize', this.onResize);
  }

  get visibleProps(): number {
    return this.props.visible;
  }

  get trauma(): number {
    return this.tau;
  }

  addTrauma(amount: number): void {
    if (amount > 0) this.tau = Math.min(1, this.tau + amount);
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
    // Camera rig: trauma² shake in whole art pixels, decaying 2 / s.
    if (this.tau > 0) {
      this.shakeT += Math.max(0, dt);
      const k = SHAKE_PX * this.tau * this.tau;
      this.shake = { x: Math.round(k * noise1(this.shakeT * SHAKE_HZ, 1)), y: Math.round(k * noise1(this.shakeT * SHAKE_HZ, 2)) };
      this.tau = Math.max(0, this.tau - TRAUMA_DECAY * Math.max(0, dt));
    } else if (this.shake.x || this.shake.y) this.shake = { x: 0, y: 0 };
    this.place();
    this.dark?.setPosition(Math.round(t.x), Math.round(t.y - 16));
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize);
    this.ground?.destroy();
    this.ground = null;
    this.dressing?.destroy();
    this.dressing = null;
    this.props.clear();
    this.decor.clear();
    this.dark = null;
    this.target = null;
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
    const sx = clampScroll(ax, this.view.w || cam.width, r.minX, r.maxX) + this.shake.x;
    const sy = clampScroll(ay, this.view.h || cam.height, r.minY, r.maxY) + this.shake.y;
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
    // (radius as a fraction of the half size, alpha): clear within ~110 px of the player, 0.8 at the rim
    const bands: readonly [number, number][] = [
      [1, 0.8],
      [0.62, 0.72],
      [0.48, 0.62],
      [0.38, 0.5],
      [0.3, 0.36],
      [0.24, 0.22],
      [0.19, 0.1],
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

  private buildDressing(): void {
    const id = this.host.def.id;
    let plan = dressingPlans.get(id);
    if (!plan) {
      plan = planDressing(this.host.cm);
      dressingPlans.set(id, plan);
    }
    const handle = placeDressing(this.scene, plan);
    for (const img of handle.images) this.decor.add(img);
    this.dressing = handle;
  }

  /**
   * Props on their tiles. Kinds with look variants (trees, pines) pick one per tile and every prop gets a small
   * deterministic nudge, so dense forests and rock fields stop reading as a grid of one stamp. Visual only: collision
   * stays on the tile.
   */
  private buildProps(): void {
    const seed = this.host.def.seed ?? 0;
    for (const pr of this.host.cm.props) {
      if (!this.scene.textures.exists(pr.kind)) continue;
      const h = cellHash(pr.tx, pr.ty, seed, 0x9a0b);
      const looks = [pr.kind, ...(PROP_VARIANTS[pr.kind] ?? []).filter((k) => this.scene.textures.exists(k))];
      const key = looks[h % looks.length];
      const x = pr.tx * TILE + TILE / 2 + (((h >>> 8) % 5) - 2);
      const y = (pr.ty + 1) * TILE + ((h >>> 12) % 2);
      this.props.add(this.scene.add.image(x, y, key).setOrigin(0.5, 1).setDepth(ySort(y, Y_BIAS.PROP)));
    }
  }

  private buildStructures(): void {
    for (const st of this.host.def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[st.kind];
      const key = `struct_${st.kind}`;
      if (!fp || !this.scene.textures.exists(key)) continue;
      const x = (st.tx + fp.w / 2) * TILE;
      const y = (st.ty + fp.h) * TILE;
      this.scene.add.image(Math.round(x), y + 4, key).setOrigin(0.5, 1).setDepth(ySort(y));
    }
  }
}
