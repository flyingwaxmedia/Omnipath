// Stage (render lane; docs/INTEGRATION-v3.md §2): everything static a map shows and the camera that looks at it —
// ground, ground dressing, props (chunk-culled), structures, the darkness of dark maps, background colour, camera
// zoom / HUD-safe bounds / follow. MapScene calls buildStage() once in create(), stage.follow() once the player
// exists, stage.fit() after the HUD layout settles, stage.update() every frame and stage.destroy() on shutdown;
// it never touches these objects itself. The render lane owns this file and may restructure it freely behind
// the Stage interface.
//
// Today: the v2 look moved verbatim (tilemap ground, fractional zoom, fx_darkness gradient). Render lane: bakeGround
// + placeDressing, pixel-perfect camera (zoom 1, integer CSS upscale, rounded scroll), banded light map later.
import Phaser from 'phaser';
import { STRUCTURE_FOOTPRINT } from '../../core/world/compile';
import type { CompiledMap, MapDef } from '../../core/world/types';
import { TILE_MARGIN, TILE_SPACING } from '../art/world';
import { TILE } from '../world/runtime';
import { DEPTH, Y_BIAS, ySort } from './depths';

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
  /** Re-fits zoom and bounds (HUD layout changed); centres on `at` when given. */
  fit(at?: { x: number; y: number }): void;
  /** Per frame: darkness follows the focus, props culling. */
  update(dt: number, focus: { x: number; y: number }): void;
  destroy(): void;
}

/** Prop culling chunk size in tiles. */
const CHUNK = 16;

export function buildStage(scene: Phaser.Scene, host: StageHost): Stage {
  return new V2Stage(scene, host);
}

class V2Stage implements Stage {
  visibleProps = 0;
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;
  private chunks: Phaser.GameObjects.Image[][] = [];
  private chunkCols = 0;
  private chunkWin = '';
  private liveChunks = new Set<number>();
  private dark: Phaser.GameObjects.Image | null = null;
  private readonly onResize = () => this.fit();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly host: StageHost,
  ) {
    const def = host.def;
    const cave = ['cave', 'crypt'].includes(def.biome);
    scene.cameras.main.setBackgroundColor(cave ? '#0b0d14' : '#16261a');
    this.buildGround();
    this.buildProps();
    this.buildStructures();
    if (def.flags?.includes('dark')) this.dark = scene.add.image(0, 0, this.darkTexture()).setDepth(DEPTH.DARKNESS).setScale(6);
    scene.scale.on('resize', this.onResize);
  }

  follow(target: FollowTarget, x: number, y: number): void {
    const cam = this.scene.cameras.main;
    cam.startFollow(target.sprite, true, 0.12, 0.12);
    this.fit({ x, y });
  }

  fit(at?: { x: number; y: number }): void {
    const cam = this.scene.cameras.main;
    const { width, height } = this.scene.scale;
    const cm = this.host.cm;
    let zoom = Phaser.Math.Clamp(Math.min(width, height) / 380, 1, 1.7);
    const mw = cm.w * TILE;
    const mh = cm.h * TILE;
    if (this.host.def.kind === 'arena') zoom = Math.max(0.8, Math.min(zoom, height / mh));
    cam.setZoom(zoom);
    // Maps smaller than the view are centred instead of pinned to the top-left. HUD-safe bounds: where something the
    // player must see or tap (portal, object, node, NPC) lies near a map edge, the camera may scroll past that edge by
    // the HUD strip on that side (vitals/minimap on top, menu column, hotbar), so it never stays stuck under the HUD
    // (playtest: mirror_lake#islet and greystone_quarry#shaft were untappable on portrait phones). Edges with nothing
    // there keep the tight bounds, so no empty margin shows.
    const vw = width / zoom;
    const vh = height / zoom;
    const ins = this.host.safeInsets();
    const need = this.edgeThings();
    const pad = (px: number, side: keyof typeof need) => (px > 0 && need[side] < px / zoom + TILE * 2 ? px / zoom : 0);
    const minX = Math.min(0, (mw - vw) / 2) - pad(ins.left, 'left');
    const maxX = Math.max(mw - vw, (mw - vw) / 2) + pad(ins.right, 'right');
    const minY = Math.min(0, (mh - vh) / 2) - pad(ins.top, 'top');
    const maxY = Math.max(mh - vh, (mh - vh) / 2) + pad(ins.bottom, 'bottom');
    cam.setBounds(minX, minY, maxX - minX + vw, maxY - minY + vh);
    this.chunkWin = '';
    if (at) cam.centerOn(at.x, at.y);
  }

  update(_dt: number, focus: { x: number; y: number }): void {
    this.dark?.setPosition(focus.x, focus.y - 16);
    this.cullProps();
  }

  destroy(): void {
    this.scene.scale.off('resize', this.onResize);
    this.tilemap?.destroy();
    this.tilemap = null;
    this.chunks = [];
    this.liveChunks.clear();
    this.dark = null;
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

  /** Soft radial darkness for 'dark' maps (a light hole around the player), generated once per game. */
  private darkTexture(): string {
    const key = 'fx_darkness';
    const textures = this.scene.textures;
    if (textures.exists(key)) return key;
    const tex = textures.createCanvas(key, 256, 256);
    if (!tex) return key;
    const g = tex.getContext();
    // Drawn at 6× scale: clear within ~110 px of the player, ~0.6 dark by ~330 px, 0.78 at the 768 px rim.
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(4,6,14,0)');
    grad.addColorStop(0.14, 'rgba(4,6,14,0)');
    grad.addColorStop(0.26, 'rgba(4,6,14,0.35)');
    grad.addColorStop(0.43, 'rgba(4,6,14,0.62)');
    grad.addColorStop(1, 'rgba(4,6,14,0.8)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    tex.refresh();
    return key;
  }

  private buildGround(): void {
    const { w, h, ground } = this.host.cm;
    const data: number[][] = [];
    for (let y = 0; y < h; y++) data.push(Array.from(ground.subarray(y * w, (y + 1) * w)));
    const tm = this.scene.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const ts = tm.addTilesetImage('tiles', 'tiles', TILE, TILE, TILE_MARGIN, TILE_SPACING)!;
    tm.createLayer(0, ts, 0, 0)!.setDepth(DEPTH.GROUND);
    this.tilemap = tm;
  }

  private buildProps(): void {
    const cm = this.host.cm;
    const cols = Math.ceil(cm.w / CHUNK);
    const rows = Math.ceil(cm.h / CHUNK);
    this.chunkCols = cols;
    this.chunks = Array.from({ length: cols * rows }, () => []);
    for (const pr of cm.props) {
      if (!this.scene.textures.exists(pr.kind)) continue;
      const x = pr.tx * TILE + TILE / 2;
      const y = (pr.ty + 1) * TILE;
      const img = this.scene.add.image(x, y, pr.kind).setOrigin(0.5, 1).setDepth(ySort(y, Y_BIAS.PROP)).setVisible(false);
      this.chunks[Math.floor(pr.ty / CHUNK) * cols + Math.floor(pr.tx / CHUNK)].push(img);
    }
  }

  /**
   * Prop culling: props are indexed in 16×16-tile chunks; only chunks touching the camera view are scanned and
   * only props whose sprite can overlap the view stay visible (tall props reach ~3 tiles above their base).
   * Runs only when the view moves by a tile.
   */
  private cullProps(): void {
    const v = this.scene.cameras.main.worldView;
    const left = v.x - TILE;
    const right = v.right + TILE;
    const top = v.y - TILE;
    const bottom = v.bottom + TILE * 3;
    const key = `${Math.floor(left / TILE)},${Math.floor(top / TILE)},${Math.ceil(right / TILE)},${Math.ceil(bottom / TILE)}`;
    if (key === this.chunkWin) return;
    this.chunkWin = key;
    const span = CHUNK * TILE;
    const rows = this.chunks.length / Math.max(1, this.chunkCols);
    const cx0 = Math.max(0, Math.floor(left / span));
    const cx1 = Math.min(this.chunkCols - 1, Math.floor(right / span));
    const cy0 = Math.max(0, Math.floor(top / span));
    const cy1 = Math.min(rows - 1, Math.floor(bottom / span));
    const next = new Set<number>();
    let shown = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * this.chunkCols + cx;
        next.add(ci);
        for (const img of this.chunks[ci]) {
          const on = img.x >= left && img.x <= right && img.y >= top && img.y <= bottom;
          if (img.visible !== on) img.setVisible(on);
          if (on) shown++;
        }
      }
    }
    for (const ci of this.liveChunks) {
      if (next.has(ci)) continue;
      for (const img of this.chunks[ci]) if (img.visible) img.setVisible(false);
    }
    this.liveChunks = next;
    this.visibleProps = shown;
  }

  private buildStructures(): void {
    for (const st of this.host.def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[st.kind];
      const key = `struct_${st.kind}`;
      if (!fp || !this.scene.textures.exists(key)) continue;
      const x = (st.tx + fp.w / 2) * TILE;
      const y = (st.ty + fp.h) * TILE;
      this.scene.add.image(x, y + 4, key).setOrigin(0.5, 1).setDepth(ySort(y));
    }
  }
}
