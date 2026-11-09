// Minimap (docs/CLIENT-v2.md §7): a 112 px DOM-canvas circle in the top-right corner showing a 20-tile radius around
// the player. The ground is painted from the CompiledMap at 2 px/tile once per map (unrevealed hidden portals are
// painted like their surroundings so the map never gives a secret away); explored fog is a separate 1 px/cell layer
// upscaled with smoothing for soft edges. The overlay (player arrow, monsters by rank, NPCs, portals with rim arrows
// when off-radius, nodes ready/depleted, waystones and other objects, the auto-travel exit) is redrawn at most every
// 150 ms. Small maps (arenas, secrets, outposts) are framed: centred and zoomed to fit instead of following the
// player. Collapsible (the choice is remembered; starts collapsed under 360 px width); tap opens the world map.
import { STRUCTURE_FOOTPRINT } from '../core/world/compile';
import { T } from '../core/world/tiles';
import { COLL, type CompiledMap, type MapDef, type NodeKind, type ObjectKind, type PortalDef, type PropKind } from '../core/world/types';
import type { WorldState } from '../game/session';
import {
  FOG_CELL,
  TILE,
  cellExplored,
  compiled,
  discoveredRoute,
  fogBits,
  fogDims,
  isRevealed,
  objectKey,
  portalOpen,
} from '../game/world/runtime';
import type { GameController } from './controller';

const SIZE = 112;
const RADIUS_TILES = 20;
const OVERLAY_MS = 150;
const STORE_KEY = 'omnipath.ui.minimap';

type RGB = [number, number, number];

// ------------------------------------------------------------------ shared map art (also used by the world map)

/** Ground colour per tile id (index = T.*). */
export const GROUND_RGB: Record<number, RGB> = {
  [T.GRASS]: [86, 140, 70],
  [T.GRASS2]: [96, 150, 76],
  [T.FLOWERS]: [104, 150, 84],
  [T.PATH]: [178, 144, 98],
  [T.WATER]: [64, 128, 196],
  [T.SAND]: [214, 194, 136],
  [T.STONE]: [128, 128, 134],
  [T.DARK]: [56, 92, 60],
  [T.COBBLE]: [172, 164, 152],
  [T.BRIDGE]: [156, 114, 72],
  [T.EMBER]: [122, 72, 58],
  [T.HILL]: [112, 156, 84],
  [T.DEEP]: [40, 84, 160],
  [T.CAVE]: [96, 88, 84],
  [T.CAVE_WALL]: [42, 38, 42],
  [T.CRYPT]: [94, 90, 108],
  [T.CRYPT_WALL]: [40, 38, 52],
  [T.SNOW]: [226, 232, 240],
  [T.ICE]: [176, 210, 236],
  [T.BASALT]: [72, 66, 72],
  [T.LAVA]: [236, 104, 40],
  [T.DUSK]: [106, 82, 122],
  [T.STORMGRASS]: [92, 122, 112],
  [T.VOID]: [10, 12, 22],
  [T.CLIFF]: [78, 70, 64],
  [T.GLADE]: [82, 122, 112],
  [T.MOSS]: [72, 112, 72],
};

const PROP_RGB: Partial<Record<PropKind, RGB>> = {
  tree: [42, 92, 46],
  darktree: [28, 60, 38],
  deadtree: [98, 80, 62],
  pine: [34, 84, 56],
  frostpine: [146, 178, 190],
  duskwillow: [86, 58, 102],
  basalt_spire: [48, 44, 52],
  stalagmite: [72, 66, 64],
  tombstone: [122, 120, 132],
  rock: [120, 120, 126],
  boulder: [108, 106, 112],
  crystal: [150, 204, 232],
};

const ROOF_RGB: RGB = [156, 84, 62];

/** Tiny deterministic per-tile noise in [-1, 1]. */
function noise(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return (((h ^ (h >>> 16)) >>> 0) / 0xffffffff) * 2 - 1;
}

const shade = (c: RGB, k: number): RGB => [c[0] * k, c[1] * k, c[2] * k];
const lift = (c: RGB, d: number): RGB => [c[0] + d, c[1] + d, c[2] + d];

/** Hidden portals the player has not revealed yet (their rects are painted like the surroundings). */
export function unrevealedPortals(world: WorldState, def: MapDef): PortalDef[] {
  return def.portals.filter((p) => !isRevealed(world, def.id, p));
}

/**
 * Paints a compiled map's terrain at `ppt` canvas pixels per tile: ground colours, wall/cliff relief, tree canopies
 * and rocks, structure roofs and shore foam. Rects of `hide` portals take the colour of the nearest outside tile.
 */
export function paintGround(cm: CompiledMap, ppt: number, hide: readonly PortalDef[] = []): HTMLCanvasElement {
  const { w, h } = cm;
  const def = cm.def;
  const props = new Map<number, PropKind>();
  for (const p of cm.props) props.set(p.ty * w + p.tx, p.kind);
  const roofs = new Uint8Array(w * h);
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    for (let y = s.ty; y < s.ty + fp.h; y++) for (let x = s.tx; x < s.tx + fp.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) roofs[y * w + x] = 1;
  }
  const hidden = new Uint8Array(w * h);
  for (const p of hide) {
    for (let y = p.ty; y < p.ty + p.h; y++) for (let x = p.tx; x < p.tx + p.w; x++) if (x >= 0 && y >= 0 && x < w && y < h) hidden[y * w + x] = 1;
  }
  const isWater = (i: number) => (cm.coll[i] & COLL.WATER) !== 0;
  /** Colour of a tile: [base, relief] — relief > 0 means a raised (blocking) tile. */
  const tileRgb = (x: number, y: number): { c: RGB; kind: 'ground' | 'wall' | 'prop' | 'roof' | 'water' } => {
    const i = y * w + x;
    const g = cm.ground[i];
    const base = GROUND_RGB[g] ?? [40, 40, 48];
    const n = noise(x, y) * 5;
    if (roofs[i]) return { c: lift(ROOF_RGB, n), kind: 'roof' };
    if (isWater(i)) return { c: lift(base, n * 0.6), kind: 'water' };
    const blocked = (cm.coll[i] & COLL.BLOCK) !== 0 && !(cm.coll[i] & COLL.PORTAL);
    if (blocked) {
      const prop = props.get(i);
      if (prop && PROP_RGB[prop]) return { c: lift(PROP_RGB[prop]!, n), kind: 'prop' };
      if (g === T.LAVA) return { c: lift(base, n), kind: 'water' };
      if (g === T.CLIFF || g === T.CAVE_WALL || g === T.CRYPT_WALL || g === T.VOID) return { c: lift(base, n), kind: 'wall' };
      // nodes / objects / NPC tiles: keep the ground
    }
    return { c: lift(base, n), kind: 'ground' };
  };
  const cols: RGB[] = new Array(w * h);
  const kinds: string[] = new Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const t = tileRgb(x, y);
      cols[y * w + x] = t.c;
      kinds[y * w + x] = t.kind;
    }
  }
  // Unrevealed hidden portal rects: copy the nearest tile outside the rect.
  for (let i = 0; i < w * h; i++) {
    if (!hidden[i]) continue;
    const x = i % w;
    const y = (i / w) | 0;
    let found = -1;
    for (let r = 1; r <= 6 && found < 0; r++) {
      for (let dy = -r; dy <= r && found < 0; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const j = ny * w + nx;
          if (!hidden[j]) {
            found = j;
            break;
          }
        }
      }
    }
    if (found >= 0) {
      cols[i] = cols[found];
      kinds[i] = kinds[found];
    }
  }
  const c = document.createElement('canvas');
  c.width = w * ppt;
  c.height = h * ppt;
  const g = c.getContext('2d')!;
  const img = g.createImageData(w * ppt, h * ppt);
  const put = (px: number, py: number, rgb: RGB) => {
    const o = (py * w * ppt + px) * 4;
    img.data[o] = rgb[0];
    img.data[o + 1] = rgb[1];
    img.data[o + 2] = rgb[2];
    img.data[o + 3] = 255;
  };
  const kindAt = (x: number, y: number) => (x < 0 || y < 0 || x >= w || y >= h ? 'wall' : kinds[y * w + x]);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const k = kinds[i];
      const base = cols[i];
      for (let sy = 0; sy < ppt; sy++) {
        for (let sx = 0; sx < ppt; sx++) {
          let rgb = base;
          const top = sy === 0;
          const left = sx === 0;
          const bottom = sy === ppt - 1;
          const right = sx === ppt - 1;
          if (k === 'wall' || k === 'roof') {
            // raised: lit top-left, shaded bottom-right; darker where it meets walkable ground below
            if (top && left) rgb = lift(base, 14);
            else if (bottom && right) rgb = shade(base, 0.72);
            if (bottom && kindAt(x, y + 1) !== k && kindAt(x, y + 1) !== 'wall') rgb = shade(base, 0.55);
          } else if (k === 'prop') {
            // canopy blob with a shaded lower-right pixel
            if (ppt > 1 && bottom && right) rgb = shade(base, 0.7);
            else if (top && left) rgb = lift(base, 10);
          } else if (k === 'water') {
            const shore = (top && kindAt(x, y - 1) !== 'water') || (left && kindAt(x - 1, y) !== 'water');
            if (shore) rgb = [base[0] * 0.6 + 90, base[1] * 0.6 + 96, base[2] * 0.6 + 100];
          }
          put(x * ppt + sx, y * ppt + sy, rgb);
        }
      }
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Fog layer: 1 px per 4x4-tile cell, transparent where explored. Draw it upscaled with smoothing. */
export function paintFog(world: WorldState, cm: CompiledMap, alpha = 0.86): HTMLCanvasElement {
  const { cw, ch } = fogDims(cm);
  const bits = fogBits(world, cm.def.id, cm);
  const c = document.createElement('canvas');
  // one cell of padding so edge cells blend into darkness outside the map
  c.width = cw + 2;
  c.height = ch + 2;
  const g = c.getContext('2d')!;
  const img = g.createImageData(cw + 2, ch + 2);
  for (let y = -1; y <= ch; y++) {
    for (let x = -1; x <= cw; x++) {
      const inside = x >= 0 && y >= 0 && x < cw && y < ch;
      const seen = inside && cellExplored(bits, cw, x, y);
      const o = ((y + 1) * (cw + 2) + (x + 1)) * 4;
      img.data[o] = 9;
      img.data[o + 1] = 13;
      img.data[o + 2] = 26;
      img.data[o + 3] = seen ? 0 : Math.round(alpha * 255);
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Draws a fog canvas from paintFog over a map drawn at (x0, y0) with `k` px per tile. */
export function drawFog(g: CanvasRenderingContext2D, fog: HTMLCanvasElement, x0: number, y0: number, k: number): void {
  const cell = FOG_CELL * k;
  g.save();
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  g.drawImage(fog, x0 - cell, y0 - cell, fog.width * cell, fog.height * cell);
  g.restore();
}

export const NODE_RGB: Record<NodeKind, string> = {
  ore: '#d9c6a6',
  fishing: '#8fd6ff',
  herb: '#9fe870',
  ember_vent: '#ff8a4a',
  wind_chime: '#e4f4ff',
  storm_tree: '#b9a6ff',
  shadow_fungus: '#c890ff',
  sun_spring: '#ffe680',
  frost_crystal: '#c8f4ff',
};

export const OBJECT_RGB: Record<ObjectKind, string> = {
  waystone: '#7ff0ff',
  altar: '#c9a0ff',
  wind_shrine: '#bfe8ff',
  obelisk: '#a07ad8',
  signpost: '#d8c8a8',
  chest: '#ffd76a',
  statue: '#c8ccd8',
  campfire: '#ffa040',
};

/** A small diamond. */
export function diamond(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke = 'rgba(8,12,26,0.9)', lw = 1): void {
  g.beginPath();
  g.moveTo(x, y - r);
  g.lineTo(x + r, y);
  g.lineTo(x, y + r);
  g.lineTo(x - r, y);
  g.closePath();
  g.fillStyle = fill;
  g.fill();
  g.lineWidth = lw;
  g.strokeStyle = stroke;
  g.stroke();
}

export function disc(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, stroke?: string, lw = 1): void {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineWidth = lw;
    g.strokeStyle = stroke;
    g.stroke();
  }
}

const FACING_ANGLE: Record<PortalDef['facing'], number> = { n: -Math.PI / 2, e: 0, s: Math.PI / 2, w: Math.PI };

/** Portal glyph: an outward chevron for edges, an arch for doors/stairs/hidden, a prism for gates. */
export function portalGlyph(g: CanvasRenderingContext2D, p: PortalDef, x: number, y: number, r: number, open: boolean, lw = 1): void {
  const fill = open ? '#ffd76a' : '#8a8f9e';
  const ink = 'rgba(8,12,26,0.95)';
  g.save();
  g.translate(x, y);
  g.lineJoin = 'round';
  if (p.gate) {
    // prism: tall diamond with a socket dot
    g.beginPath();
    g.moveTo(0, -r * 1.25);
    g.lineTo(r * 0.8, 0);
    g.lineTo(0, r * 1.25);
    g.lineTo(-r * 0.8, 0);
    g.closePath();
    g.fillStyle = open ? '#fff0b0' : '#6c7288';
    g.fill();
    g.lineWidth = lw * 1.2;
    g.strokeStyle = ink;
    g.stroke();
    disc(g, 0, 0, r * 0.32, open ? '#ffd76a' : '#2a2f40');
  } else if (p.kind === 'edge') {
    g.rotate(FACING_ANGLE[p.facing]);
    g.beginPath();
    g.moveTo(r * 1.1, 0);
    g.lineTo(-r * 0.7, -r * 0.95);
    g.lineTo(-r * 0.25, 0);
    g.lineTo(-r * 0.7, r * 0.95);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = lw * 1.2;
    g.strokeStyle = ink;
    g.stroke();
  } else {
    // arch (door / stairs / revealed hidden way)
    const hiddenWay = p.kind === 'hidden' || !!p.reveal;
    g.beginPath();
    g.moveTo(-r * 0.85, r * 0.9);
    g.lineTo(-r * 0.85, -r * 0.1);
    g.arc(0, -r * 0.1, r * 0.85, Math.PI, 0);
    g.lineTo(r * 0.85, r * 0.9);
    g.closePath();
    g.fillStyle = hiddenWay ? (open ? '#e4d2ff' : '#8a8f9e') : fill;
    g.fill();
    g.lineWidth = lw * 1.2;
    g.strokeStyle = ink;
    g.stroke();
    g.beginPath();
    g.moveTo(-r * 0.38, r * 0.9);
    g.lineTo(-r * 0.38, r * 0.05);
    g.arc(0, r * 0.05, r * 0.38, Math.PI, 0);
    g.lineTo(r * 0.38, r * 0.9);
    g.closePath();
    g.fillStyle = p.kind === 'stairs' ? '#3a2a18' : '#20160c';
    g.fill();
  }
  g.restore();
}

/** Player arrow pointing at `angle` (radians, 0 = east). */
export function playerArrow(g: CanvasRenderingContext2D, x: number, y: number, r: number, angle: number, lw = 1.5): void {
  g.save();
  g.translate(x, y);
  g.rotate(angle);
  g.beginPath();
  g.moveTo(r * 1.25, 0);
  g.lineTo(-r * 0.85, -r * 0.9);
  g.lineTo(-r * 0.35, 0);
  g.lineTo(-r * 0.85, r * 0.9);
  g.closePath();
  g.fillStyle = '#ffffff';
  g.shadowColor = 'rgba(0,0,0,0.6)';
  g.shadowBlur = r * 0.8;
  g.fill();
  g.shadowBlur = 0;
  g.lineWidth = lw;
  g.strokeStyle = '#1a2244';
  g.stroke();
  g.restore();
}

/** The first portal of the auto-travel route out of this map, or null. */
export function navExit(ctrl: GameController): string | null {
  const nav = ctrl.session.nav;
  if (!nav) return null;
  const here = ctrl.map().def.id;
  if (nav.target === here) return null;
  const route = discoveredRoute(ctrl.world(), ctrl.book, here, nav.target);
  return route?.[0]?.portal ?? null;
}

// ------------------------------------------------------------------ the HUD minimap

function readCollapsed(): boolean {
  try {
    const v = localStorage.getItem(STORE_KEY);
    if (v === '1') return true;
    if (v === '0') return false;
  } catch {
    /* storage unavailable */
  }
  // Small screens start folded: narrow portrait phones and short landscape phones (the Pursuits need the room).
  return window.innerWidth < 360 || window.innerHeight < 480;
}

function writeCollapsed(v: boolean): void {
  try {
    localStorage.setItem(STORE_KEY, v ? '1' : '0');
  } catch {
    /* storage unavailable */
  }
}

export class Minimap {
  readonly el: HTMLElement;
  private face: HTMLButtonElement;
  private toggleBtn: HTMLButtonElement;
  private pings: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private ground: HTMLCanvasElement | null = null;
  private groundKey = '';
  private fog: HTMLCanvasElement | null = null;
  private fogKey = '';
  private collapsed: boolean;
  private lastDraw = 0;
  private heading = -Math.PI / 2;
  private lastPos: { x: number; y: number } | null = null;
  private mapId = '';
  private revealedSeen = 0;
  private wardenPinged = false;
  private navKey = '';
  private navPortal: string | null = null;
  private navAt = 0;

  constructor(
    parent: HTMLElement,
    private ctrl: GameController,
    onOpen: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.innerHTML = `<button class="mm-face" aria-label="Open world map"><canvas></canvas><span class="mm-n" aria-hidden="true">N</span><span class="mm-pings" aria-hidden="true"></span></button>
      <button class="mm-toggle" aria-label="Collapse minimap"><i aria-hidden="true"></i></button>`;
    parent.appendChild(this.el);
    this.face = this.el.querySelector<HTMLButtonElement>('.mm-face')!;
    this.toggleBtn = this.el.querySelector<HTMLButtonElement>('.mm-toggle')!;
    this.pings = this.el.querySelector<HTMLElement>('.mm-pings')!;
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.face.addEventListener('click', onOpen);
    this.toggleBtn.addEventListener('click', () => this.setCollapsed(!this.collapsed, true));
    this.collapsed = readCollapsed();
    this.applyCollapsed();
  }

  get isCollapsed(): boolean {
    return this.collapsed;
  }

  setCollapsed(v: boolean, remember = false): void {
    this.collapsed = v;
    if (remember) writeCollapsed(v);
    this.applyCollapsed();
    if (!v) {
      this.lastDraw = 0;
      this.update();
    }
  }

  private applyCollapsed(): void {
    this.el.classList.toggle('collapsed', this.collapsed);
    this.el.parentElement?.classList.toggle('mm-collapsed', this.collapsed);
    this.toggleBtn.setAttribute('aria-label', this.collapsed ? 'Show minimap' : 'Collapse minimap');
    this.toggleBtn.title = this.collapsed ? 'Show minimap' : 'Hide minimap';
  }

  /** New map: drop the cached terrain and per-map ping state. */
  setMap(): void {
    this.ground = null;
    this.groundKey = '';
    this.fog = null;
    this.fogKey = '';
    this.lastPos = null;
    this.navKey = '';
    this.pings.textContent = '';
    try {
      const def = this.ctrl.map().def;
      this.mapId = def.id;
      this.revealedSeen = this.revealedHere(def);
    } catch {
      this.mapId = '';
    }
    this.wardenPinged = false;
    this.lastDraw = 0;
    this.update();
  }

  private revealedHere(def: MapDef): number {
    const prefix = `${def.id}#`;
    return this.ctrl.world().revealed.filter((k) => k.startsWith(prefix)).length;
  }

  /** Ground: the base compiled map (hidden rects are walkable there), repainted only when a hidden way opens. */
  private groundCanvas(def: MapDef): HTMLCanvasElement {
    const world = this.ctrl.world();
    const hide = unrevealedPortals(world, def);
    const key = `${def.id}|${hide.map((p) => p.id).join(',')}`;
    if (this.ground && key === this.groundKey) return this.ground;
    this.groundKey = key;
    this.ground = paintGround(compiled(def.id), 2, hide);
    return this.ground;
  }

  private fogCanvas(def: MapDef, cm: CompiledMap): HTMLCanvasElement {
    const fog = this.ctrl.world().fog[def.id] ?? '';
    const key = `${def.id}|${fog}`;
    if (this.fog && key === this.fogKey) return this.fog;
    this.fogKey = key;
    this.fog = paintFog(this.ctrl.world(), cm, 0.8);
    return this.fog;
  }

  /** Called by the HUD tick (≤ 10 Hz); redraws at most every 150 ms. */
  update(): void {
    if (this.collapsed || !this.el.isConnected) return;
    const t = performance.now();
    if (t - this.lastDraw < OVERLAY_MS) return;
    this.lastDraw = t;
    let view, def: MapDef, cm: CompiledMap;
    try {
      view = this.ctrl.minimap();
      ({ def, compiled: cm } = this.ctrl.map());
    } catch {
      return;
    }
    if (!def || !cm) return;
    if (def.id !== this.mapId) this.setMapQuiet(def);
    const world = this.ctrl.world();
    const book = this.ctrl.book;

    // heading from movement
    if (this.lastPos) {
      const dx = view.px - this.lastPos.x;
      const dy = view.py - this.lastPos.y;
      if (Math.hypot(dx, dy) > 1.5) this.heading = Math.atan2(dy, dx);
    }
    this.lastPos = { x: view.px, y: view.py };

    // backing store follows the CSS size (112 px, 88 px on short landscape) × DPR
    const css = this.face.clientWidth || SIZE;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const N = Math.round(css * dpr);
    if (this.canvas.width !== N) {
      this.canvas.width = N;
      this.canvas.height = N;
    }
    const d = N / css;
    const g = this.ctx;

    // framing: small maps are centred and zoomed to fit the circle
    const diag = Math.hypot(cm.w, cm.h);
    const framed = diag <= RADIUS_TILES * 2 * 0.98;
    const across = framed ? Math.max(16, Math.min(RADIUS_TILES * 2, diag / 0.92)) : RADIUS_TILES * 2;
    const k = N / across;
    const ptx = view.px / TILE;
    const pty = view.py / TILE;
    const cx = framed ? cm.w / 2 : ptx;
    const cy = framed ? cm.h / 2 : pty;
    const toX = (x: number) => (x / TILE - cx) * k + N / 2;
    const toY = (y: number) => (y / TILE - cy) * k + N / 2;
    const half = N / 2;
    const inCircle = (x: number, y: number, pad = 0) => Math.hypot(x - half, y - half) <= half - pad;

    g.save();
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, N, N);
    g.fillStyle = '#0a0f1c';
    g.fillRect(0, 0, N, N);
    g.imageSmoothingEnabled = false;
    const gx = (0 - cx) * k + half;
    const gy = (0 - cy) * k + half;
    g.drawImage(this.groundCanvas(def), gx, gy, cm.w * k, cm.h * k);
    drawFog(g, this.fogCanvas(def, cm), gx, gy, k);
    if (framed) {
      g.strokeStyle = 'rgba(255, 215, 106, 0.55)';
      g.lineWidth = 1.5 * d;
      g.strokeRect(gx - 1.5 * d, gy - 1.5 * d, cm.w * k + 3 * d, cm.h * k + 3 * d);
    }

    // objects (waystones lit when attuned; opened chests vanish)
    const objByTile = new Map<string, { id: string; kind: ObjectKind }>();
    for (const o of def.objects ?? []) objByTile.set(`${o.tx},${o.ty}`, { id: o.id, kind: o.kind });
    for (const o of view.objects) {
      const x = toX(o.x);
      const y = toY(o.y);
      if (!inCircle(x, y, -4)) continue;
      const ref = objByTile.get(`${Math.floor(o.x / TILE)},${Math.floor(o.y / TILE)}`);
      const kind = (ref?.kind ?? o.kind) as ObjectKind;
      if (kind === 'chest' && ref && world.chests.includes(objectKey(def.id, ref.id))) continue;
      if (kind === 'waystone') {
        const lit = !!ref && world.waystones.includes(objectKey(def.id, ref.id));
        diamond(g, x, y, 4.2 * d, lit ? OBJECT_RGB.waystone : '#4f7480', 'rgba(8,12,26,0.95)', 1.2 * d);
        if (lit) disc(g, x, y, 1.2 * d, '#ffffff');
      } else if (kind === 'signpost' || kind === 'statue') {
        disc(g, x, y, 1.6 * d, OBJECT_RGB[kind], 'rgba(8,12,26,0.8)', d);
      } else {
        diamond(g, x, y, 3.4 * d, OBJECT_RGB[kind] ?? '#d8e0f0', 'rgba(8,12,26,0.95)', d);
      }
    }

    // nodes: coloured squares when ready, dim dots when depleted
    const nodeByTile = new Map<string, NodeKind>();
    for (const n of def.nodes ?? []) nodeByTile.set(`${n.tx},${n.ty}`, n.kind);
    for (const n of view.nodes) {
      const x = toX(n.x);
      const y = toY(n.y);
      if (!inCircle(x, y, -3)) continue;
      const kind = nodeByTile.get(`${Math.floor(n.x / TILE)},${Math.floor(n.y / TILE)}`);
      if (n.ready) {
        const r = 2.1 * d;
        g.fillStyle = 'rgba(8,12,26,0.9)';
        g.fillRect(x - r - d * 0.8, y - r - d * 0.8, 2 * r + 1.6 * d, 2 * r + 1.6 * d);
        g.fillStyle = kind ? NODE_RGB[kind] : '#9fe870';
        g.fillRect(x - r, y - r, 2 * r, 2 * r);
      } else disc(g, x, y, 1.3 * d, 'rgba(120,126,140,0.75)');
    }

    // NPCs
    for (const n of view.npcs) {
      const x = toX(n.x);
      const y = toY(n.y);
      if (!inCircle(x, y, -4)) continue;
      disc(g, x, y, 3.1 * d, '#ffe9a0', 'rgba(60,40,0,0.95)', 1.2 * d);
    }

    // portals (rim arrows when off-radius); the auto-travel exit glows
    const exit = this.navExitCached(def);
    const rimR = half - 6.5 * d;
    const pulse = 0.5 + 0.5 * Math.sin(t / 220);
    for (const p of def.portals) {
      if (!isRevealed(world, def.id, p)) continue;
      const open = portalOpen(world, book, def.id, p);
      const wx = (p.tx + p.w / 2) * TILE;
      const wy = (p.ty + p.h / 2) * TILE;
      const x = toX(wx);
      const y = toY(wy);
      const isExit = p.id === exit;
      if (inCircle(x, y, 5 * d)) {
        if (isExit) {
          g.beginPath();
          g.arc(x, y, (7 + 3 * pulse) * d, 0, Math.PI * 2);
          g.strokeStyle = `rgba(127, 240, 255, ${0.5 + 0.5 * pulse})`;
          g.lineWidth = 2 * d;
          g.stroke();
        }
        portalGlyph(g, p, x, y, 4.4 * d, open, d);
      } else {
        const a = Math.atan2(y - half, x - half);
        const rx = half + Math.cos(a) * rimR;
        const ry = half + Math.sin(a) * rimR;
        this.rimArrow(g, rx, ry, a, (isExit ? 5.2 : 4.2) * d, isExit ? '#7ff0ff' : open ? '#ffd76a' : '#8a8f9e', d);
      }
    }

    // monsters by rank (wardens also get a rim pip when off-radius)
    for (const m of view.monsters) {
      const x = toX(m.x);
      const y = toY(m.y);
      if (m.rank === 'warden') {
        if (!this.wardenPinged) {
          this.wardenPinged = true;
          this.ping(x / N, y / N, 'warden');
        }
        if (inCircle(x, y, 6 * d)) {
          g.beginPath();
          g.arc(x, y, (6 + 2.5 * pulse) * d, 0, Math.PI * 2);
          g.strokeStyle = `rgba(255, 77, 157, ${0.35 + 0.4 * pulse})`;
          g.lineWidth = 1.6 * d;
          g.stroke();
          disc(g, x, y, 4.6 * d, '#ff4d9d', '#ffffff', 1.4 * d);
        } else {
          const a = Math.atan2(y - half, x - half);
          disc(g, half + Math.cos(a) * rimR, half + Math.sin(a) * rimR, 3.2 * d, '#ff4d9d', '#ffffff', d);
        }
        continue;
      }
      if (!inCircle(x, y, -3)) continue;
      if (m.rank === 'elite') diamond(g, x, y, 3.6 * d, '#ff9a3a', 'rgba(40,10,0,0.95)', 1.1 * d);
      else disc(g, x, y, 2.2 * d, '#ff5a5a', 'rgba(40,0,0,0.85)', 0.9 * d);
    }

    // the player
    playerArrow(g, toX(view.px), toY(view.py), 5 * d, this.heading, 1.4 * d);
    g.restore();

    // pings: a hidden way opened here
    const rev = this.revealedHere(def);
    if (rev > this.revealedSeen) {
      for (const p of def.portals) {
        if (!p.reveal || !isRevealed(world, def.id, p)) continue;
        const x = toX((p.tx + p.w / 2) * TILE);
        const y = toY((p.ty + p.h / 2) * TILE);
        this.ping(x / N, y / N, 'secret');
      }
    }
    this.revealedSeen = rev;
  }

  private setMapQuiet(def: MapDef): void {
    this.mapId = def.id;
    this.ground = null;
    this.fog = null;
    this.groundKey = this.fogKey = '';
    this.lastPos = null;
    this.revealedSeen = this.revealedHere(def);
    this.wardenPinged = false;
  }

  private navExitCached(def: MapDef): string | null {
    const nav = this.ctrl.session.nav;
    if (!nav) {
      this.navKey = '';
      this.navPortal = null;
      return null;
    }
    const key = `${def.id}>${nav.target}`;
    const t = performance.now();
    if (key !== this.navKey || t - this.navAt > 1000) {
      const fresh = key !== this.navKey;
      this.navKey = key;
      this.navAt = t;
      this.navPortal = navExit(this.ctrl);
      if (fresh && this.navPortal) {
        const p = def.portals.find((x) => x.id === this.navPortal);
        if (p) this.pingWorld(p, 'nav');
      }
    }
    return this.navPortal;
  }

  /** Pings a portal on the next draw (clamped to the rim when off-radius). */
  private pingWorld(p: PortalDef, kind: 'nav' | 'secret'): void {
    const view = this.ctrl.minimap();
    const cm = this.ctrl.map().compiled;
    const diag = Math.hypot(cm.w, cm.h);
    const framed = diag <= RADIUS_TILES * 2 * 0.98;
    const across = framed ? Math.max(16, Math.min(RADIUS_TILES * 2, diag / 0.92)) : RADIUS_TILES * 2;
    const cx = framed ? cm.w / 2 : view.px / TILE;
    const cy = framed ? cm.h / 2 : view.py / TILE;
    this.ping(0.5 + (p.tx + p.w / 2 - cx) / across, 0.5 + (p.ty + p.h / 2 - cy) / across, kind);
  }

  /** CSS ripple at a fraction of the face (0..1). */
  private ping(fx: number, fy: number, kind: 'warden' | 'secret' | 'nav'): void {
    if (this.collapsed) return;
    // clamp to just inside the rim
    let ox = fx - 0.5;
    let oy = fy - 0.5;
    const r = Math.hypot(ox, oy);
    if (r > 0.42) {
      ox = (ox / r) * 0.42;
      oy = (oy / r) * 0.42;
    }
    const s = document.createElement('i');
    s.className = `mm-ping ${kind}`;
    s.style.left = `${(0.5 + ox) * 100}%`;
    s.style.top = `${(0.5 + oy) * 100}%`;
    this.pings.appendChild(s);
    while (this.pings.children.length > 4) this.pings.firstElementChild?.remove();
    s.addEventListener('animationend', () => s.remove());
    setTimeout(() => s.remove(), 2600);
  }

  private rimArrow(g: CanvasRenderingContext2D, x: number, y: number, a: number, r: number, fill: string, d: number): void {
    g.save();
    g.translate(x, y);
    g.rotate(a);
    g.beginPath();
    g.moveTo(r, 0);
    g.lineTo(-r * 0.8, -r * 0.85);
    g.lineTo(-r * 0.4, 0);
    g.lineTo(-r * 0.8, r * 0.85);
    g.closePath();
    g.fillStyle = fill;
    g.fill();
    g.lineWidth = d;
    g.strokeStyle = 'rgba(8,12,26,0.95)';
    g.stroke();
    g.restore();
  }
}
