// Pixel-banded light map (light lane; docs/QUALITY-PLAN.md §11, docs/ART-DIRECTION.md "no smooth gradients"). Dark
// maps (dungeons, caves) and the few night maps get a low-res RenderTexture on the art-px grid, one art px per texel,
// the size of the camera view. Every frame it is cleared to the map's AMBIENT dark colour, the visible light stamps are
// drawn into it (ADD among themselves, then laid over the ambient), and the texture is composited over the world with
// MULTIPLY at DEPTH.DARKNESS — so a lit texel shows the art in the light's colour and an unlit one at the ambient.
// The VFX glow layer (DEPTH.LIGHT: the runtime puts it there on dark maps, the light map lifts it there on night maps)
// and the telegraph rims (DEPTH.TELL_TOP) stay above it.
//
// Stamps are pre-baked HARD-BANDED discs: 4 flat levels with 2 px Bayer-dithered seams between them, never a smooth
// gradient. Flames flicker by shifting their bands a pixel in or out (a seeded step every FLICKER_MS), never by
// tweening alpha. Sources: the player's lantern (radius by map), campfires, door torches, dressing lanterns and
// candles, ember vents / sun springs / frost crystals / shadow fungus, crystal props, portals, waystones, altars,
// lava (inner tiles glow whole, shore tiles get a banded pool) and live spells (sampled from the VFX glow layer every
// frame; on night maps the light map lifts that layer above itself, as the VFX runtime does on dark maps).
//
// Canvas renderer, Low quality or `?light=0`: the stage keeps the old fx_darkness overlay (render/stage.ts).
// Quality hook: setLightingEnabled(on) (the stage swaps light map <-> overlay live); `?light=0` starts it off.
//
// This module never imports Phaser at runtime (types only): the pure parts (profiles, stamps, sources, flicker) are
// unit-tested in node (tests/render-light.test.ts).
import type Phaser from 'phaser';
import { TILE } from '../../core/world/compile';
import { T } from '../../core/world/tiles';
import type { CompiledMap, MapDef } from '../../core/world/types';
import { cellHash } from './autotile';
import { DEPTH, LIGHT_DEPTH } from './depths';

// ------------------------------------------------------------------ settings (quality hook)

function urlFlag(name: string, dflt: boolean): boolean {
  try {
    if (typeof location === 'undefined') return dflt;
    const v = new URLSearchParams(location.search).get(name);
    if (v === null) return dflt;
    return !(v === '0' || v === 'off' || v === 'false');
  } catch {
    return dflt;
  }
}

/** Light map on / off (Low quality and the Canvas renderer use the flat overlay instead). */
export const lightSettings = { enabled: urlFlag('light', true) };

const lightListeners = new Set<(on: boolean) => void>();

/** Quality hook: turns the light map on or off (live: the stage swaps to / from the flat overlay). */
export function setLightingEnabled(on: boolean): void {
  if (lightSettings.enabled === on) return;
  lightSettings.enabled = on;
  for (const fn of [...lightListeners]) {
    try {
      fn(on);
    } catch {
      /* a listener's failure never blocks the setting */
    }
  }
}

export function lightingEnabled(): boolean {
  return lightSettings.enabled;
}

/** Called when the setting changes; returns the unsubscribe. */
export function onLightingChange(fn: (on: boolean) => void): () => void {
  lightListeners.add(fn);
  return () => lightListeners.delete(fn);
}

// ------------------------------------------------------------------ profiles

export type LightMode = 'dungeon' | 'cave' | 'night' | 'ash';

export interface LightProfile {
  mode: LightMode;
  /** The RT is cleared to this every frame (0xRRGGBB): with MULTIPLY it is the brightness of unlit ground. */
  ambient: number;
  /** The player's lantern: radius (art px), colour (the lit core multiplies the art by it, so keep it near white);
   *  null where the dim is daylight (an ash sky), not night. */
  lantern: { r: number; color: number } | null;
  /** Scale on prop / spell stamp radii (night maps use smaller pools: the ambient is already readable). */
  reach: number;
}

export const LIGHT_PROFILES: Readonly<Record<LightMode, LightProfile>> = {
  // Crypts and barrows: violet-black, the lantern ~a third of an iPad view tall.
  dungeon: { mode: 'dungeon', ambient: 0x262238, lantern: { r: 132, color: 0xfff1de }, reach: 1 },
  // Mines and caves: a cooler, slightly brighter dark, a wider lantern.
  cave: { mode: 'cave', ambient: 0x232a38, lantern: { r: 140, color: 0xfff0d8 }, reach: 1 },
  // Moonlight: the world stays readable, blue-dim; lights glow warm against it.
  night: { mode: 'night', ambient: 0x7a86b8, lantern: { r: 96, color: 0xfff6e6 }, reach: 0.85 },
  // Ash sky over lava: a dim warm-grey day (no lantern), every lava tile glowing and its shores lit.
  ash: { mode: 'ash', ambient: 0xbcaca2, lantern: null, reach: 0.85 },
};

/** Maps that are night without being 'dark' (core MapDef flags have no 'night' yet, so they are listed here). */
export const NIGHT_MAPS: Readonly<Record<string, LightMode>> = {
  'vale.moonlit_glade': 'night',
  'rift.basalt_steps': 'ash',
};

/** Warden arenas are dark but fought in: a lifted ambient (shares toward ARENA_LIFT) and a wider lantern. */
export const ARENA_LIFT = { color: 0x5a5470, share: 0.35, lantern: 20 } as const;

function mixRgb(a: number, b: number, t: number): number {
  const ch = (s: number) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
}

/** The light profile of a map, or null when it is lit by day (no light map, no overlay). */
export function lightProfile(def: Pick<MapDef, 'id' | 'biome' | 'flags'> & { kind?: MapDef['kind'] }): LightProfile | null {
  if (def.flags?.includes('dark')) {
    const base = def.biome === 'cave' ? LIGHT_PROFILES.cave : LIGHT_PROFILES.dungeon;
    if (def.kind !== 'arena' || !base.lantern) return base;
    return {
      ...base,
      ambient: mixRgb(base.ambient, ARENA_LIFT.color, ARENA_LIFT.share),
      lantern: { ...base.lantern, r: base.lantern.r + ARENA_LIFT.lantern },
    };
  }
  const mode = NIGHT_MAPS[def.id];
  return mode ? LIGHT_PROFILES[mode] : null;
}

// ------------------------------------------------------------------ stamps (pure)

/** Band edges (fraction of the radius) and levels (0..1), inner -> outer. Four flat levels: no gradient. */
export const LIGHT_BANDS: readonly (readonly [edge: number, level: number])[] = [
  [0.46, 1],
  [0.68, 0.72],
  [0.85, 0.46],
  [1, 0.22],
];
/** Width (px) of the Bayer-dithered seam between two bands (and at the rim). */
export const SEAM = 2;
/** 4×4 ordered-dither thresholds (0..15). */
export const BAYER4: readonly number[] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/**
 * A hard-banded light disc of radius r: (2r+1)² levels 0..255, row-major, centre at (r, r). Inside a seam a texel
 * takes the inner or the outer band by its Bayer threshold, so band edges read as a dithered pixel step.
 */
export function bandedDisc(r: number, bands: readonly (readonly [number, number])[] = LIGHT_BANDS): Uint8Array {
  const R = Math.max(2, Math.round(r));
  const n = 2 * R + 1;
  const out = new Uint8Array(n * n);
  const levels = bands.map((b) => Math.round(Math.max(0, Math.min(1, b[1])) * 255));
  // Band edges in px, the outermost pulled in by half a seam so the dithered rim stays inside the texture.
  const edges = bands.map((b, i) => (i === bands.length - 1 ? R - SEAM / 2 : b[0] * R));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const d = Math.hypot(x - R, y - R);
      const th = (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16;
      let level = 0;
      for (let i = 0; i < edges.length; i++) {
        // u: 1 well inside this band's edge, 0 well outside, linear across the seam; dithered against the threshold.
        const u = (edges[i] + SEAM / 2 - d) / SEAM;
        if (u >= 1 || (u > 0 && th < u)) {
          level = levels[i];
          break;
        }
      }
      out[y * n + x] = level;
    }
  }
  return out;
}

/** Band-shift flicker: px added to a flame's radius at time t (ms). Stepped every FLICKER_MS, seeded per light. */
export const FLICKER_MS = 130;
const FLICKER_STEPS: readonly number[] = [0, 0, -1, 0, 1, 0, -1, -2, 0, 1, 0, -1];
const SOFT_STEPS: readonly number[] = [0, 0, 0, -1, 0, 0, 0, 1];
/** Every radius offset flicker() can return (the stamps baked per light). */
export const FLICKER_RANGE: readonly number[] = [-2, -1, 0, 1];

export function flicker(seed: number, t: number, soft = false): number {
  if (!seed) return 0;
  const steps = soft ? SOFT_STEPS : FLICKER_STEPS;
  // Each light runs its own clock rate (±20%) so neighbouring flames never step together.
  const rate = soft ? 2.2 : 0.8 + ((seed >>> 3) % 9) * 0.05;
  const step = Math.floor((t / FLICKER_MS) * (soft ? 1 / rate : rate));
  return steps[cellHash(step, seed & 0xffff, seed >>> 16, 0x1f1) % steps.length];
}

// ------------------------------------------------------------------ sources (pure)

export type LightKind = 'flame' | 'crystal' | 'portal' | 'waystone' | 'lava' | 'lava_tile' | 'node' | 'shrine';

export interface LightSource {
  /** Centre (world px, whole pixels). */
  x: number;
  y: number;
  /** Radius (art px). 'lava_tile' sources (inner lava tiles) are a TILE-sized square instead of a disc. */
  r: number;
  color: number;
  /** Stamp alpha 0..1 (1 = the core shows the art in the light's colour). */
  level: number;
  /** 0 = steady; else the flicker seed. */
  flicker: number;
  kind: LightKind;
}

/** Light colours (0xRRGGBB). */
export const LIGHT_COLORS = {
  flame: 0xffb466,
  candle: 0xffc884,
  lamp: 0xffd690,
  crystal: 0x8fd8ff,
  frost: 0xa8ecff,
  portal: 0xa8dcff,
  edge: 0xffd98a,
  gate: 0xc8e8ff,
  waystone: 0x9ceaff,
  lava: 0xff8c42,
  lavaTile: 0xffc89a,
  ember: 0xff9850,
  sun: 0xffe48a,
  fungus: 0xb894ff,
  altar: 0xd8b0ff,
  shrine: 0xc8e0ff,
} as const;

/** A dressing item as the planner returns it (render/dressing.ts): texture key and bottom-centre. */
export interface LitDressing {
  key: string;
  x: number;
  y: number;
  flipX?: boolean;
}

/**
 * Every static light of a map (pure, deterministic per map seed). `dressing` is the stage's dressing plan; the
 * door torches follow portal_door's art (sconces 23 px either side, 32 px up), lanterns and candles their textures.
 * Hidden portals are never lit (a light would give the secret away).
 */
export function staticLights(cm: CompiledMap, def: MapDef, dressing: readonly LitDressing[] = []): LightSource[] {
  const out: LightSource[] = [];
  const seed = def.seed ?? 0;
  const C = LIGHT_COLORS;
  const add = (x: number, y: number, r: number, color: number, level: number, kind: LightKind, flick: boolean, salt: number) =>
    out.push({ x: Math.round(x), y: Math.round(y), r, color, level, kind, flicker: flick ? cellHash(Math.round(x), Math.round(y), seed, salt) | 1 : 0 });

  for (const o of def.objects ?? []) {
    const x = o.tx * TILE + TILE / 2;
    const foot = o.ty * TILE + TILE - 4;
    if (o.kind === 'campfire') add(x, foot - 9, 72, C.flame, 1, 'flame', true, 1);
    else if (o.kind === 'waystone') add(x, foot - 28, 44, C.waystone, 0.75, 'waystone', false, 2);
    else if (o.kind === 'altar') add(x, foot - 18, 40, C.altar, 0.6, 'shrine', false, 3);
    else if (o.kind === 'obelisk' || o.kind === 'wind_shrine') add(x, foot - 24, 34, C.shrine, 0.5, 'shrine', false, 4);
  }
  for (const n of def.nodes ?? []) {
    const x = n.tx * TILE + TILE / 2;
    const foot = n.ty * TILE + TILE - 4;
    if (n.kind === 'ember_vent') add(x, foot - 10, 40, C.ember, 0.8, 'node', true, 5);
    else if (n.kind === 'sun_spring') add(x, foot - 12, 44, C.sun, 0.7, 'node', false, 6);
    else if (n.kind === 'frost_crystal') add(x, foot - 18, 36, C.frost, 0.7, 'crystal', false, 7);
    else if (n.kind === 'shadow_fungus') add(x, foot - 10, 30, C.fungus, 0.6, 'node', false, 8);
  }
  for (const p of def.portals) {
    if (p.reveal || p.kind === 'hidden') continue;
    const x0 = p.tx * TILE;
    const y0 = p.ty * TILE;
    const w = p.w * TILE;
    const h = p.h * TILE;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    if (p.gate) add(cx, y0 + h - 30, 52, C.gate, 0.7, 'portal', false, 9);
    else if (p.kind === 'door') {
      add(cx - 23, y0 + h - 32, 48, C.flame, 0.95, 'flame', true, 10);
      add(cx + 23, y0 + h - 32, 48, C.flame, 0.95, 'flame', true, 11);
    } else if (p.kind === 'stairs') add(cx, cy - 4, 52, C.portal, 0.8, 'portal', false, 12);
    else {
      // Edge exits: a pool of light on each pair of chevrons, so a way out reads in the dark.
      const horizontal = p.facing === 'n' || p.facing === 's';
      const span = horizontal ? p.w : p.h;
      const n = Math.max(1, Math.round(span / 2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        add(horizontal ? x0 + w * t : cx, horizontal ? cy : y0 + h * t, 40, C.edge, 0.65, 'portal', false, 13);
      }
    }
  }
  for (const pr of cm.props) {
    if (pr.kind !== 'crystal') continue;
    add(pr.tx * TILE + TILE / 2, (pr.ty + 1) * TILE - 14, 40, C.crystal, 0.75, 'crystal', false, 14);
  }
  for (const d of dressing) {
    if (d.key === 'dr_lantern') add(d.x + (d.flipX ? -4 : 4), d.y - 28, 48, C.lamp, 0.9, 'flame', true, 15);
    else if (d.key === 'dr_candles') add(d.x, d.y - 9, 28, C.candle, 0.85, 'flame', true, 16);
  }
  out.push(...lavaLights(cm));
  return out;
}

/**
 * Lava: every lava tile is lit (it glows). A tile with lava all around (8 neighbours) glows whole (a TILE square); a
 * tile on a shore — any of its 8 neighbours is land — gets a banded warm pool instead, which lights its own lava and
 * spills onto the ground. Shore tiles never get the square: the land's autotiled edge is painted over the outer part
 * of a shore lava cell (render/autotile.ts: lava has low precedence), and a full square there showed as a hard-edged
 * lit rectangle on the sand / basalt. Past the map edge counts as lava (the void there is no shore).
 */
export function lavaLights(cm: CompiledMap): LightSource[] {
  const out: LightSource[] = [];
  const { w, h, ground } = cm;
  const seed = cm.def.seed ?? 0;
  const lava = (x: number, y: number) => x < 0 || y < 0 || x >= w || y >= h || ground[y * w + x] === T.LAVA;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (ground[y * w + x] !== T.LAVA) continue;
      const cx = x * TILE + TILE / 2;
      const cy = y * TILE + TILE / 2;
      let shore = false;
      for (let dy = -1; dy <= 1 && !shore; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !lava(x + dx, y + dy)) shore = true;
      if (shore) out.push({ x: cx, y: cy, r: 44, color: LIGHT_COLORS.lava, level: 0.6, flicker: cellHash(x, y, seed, 0x1a7a) | 1, kind: 'lava' });
      else out.push({ x: cx, y: cy, r: TILE / 2, color: LIGHT_COLORS.lavaTile, level: 1, flicker: 0, kind: 'lava_tile' });
    }
  }
  return out;
}

// ------------------------------------------------------------------ spell lights (VFX glow layer)

/** At most this many live spell stamps per frame (merged on a SPELL_CELL grid first). */
export const SPELL_MAX = 40;
export const SPELL_CELL = 24;

export interface SpellLight {
  x: number;
  y: number;
  r: number;
  color: number;
}

/**
 * Merges glow points into at most `max` lights: one per SPELL_CELL cell (the biggest radius wins, its colour kept),
 * biggest first. Pure; the LightMap feeds it the VFX glow layer's visible images and bobs every frame.
 */
export function mergeSpellLights(points: readonly SpellLight[], max = SPELL_MAX): SpellLight[] {
  const cells = new Map<number, SpellLight>();
  for (const p of points) {
    const k = (Math.floor(p.x / SPELL_CELL) + 4096) * 8192 + (Math.floor(p.y / SPELL_CELL) + 4096);
    const cur = cells.get(k);
    if (!cur) cells.set(k, { ...p });
    else if (p.r > cur.r) {
      cur.r = p.r;
      cur.color = p.color;
      cur.x = p.x;
      cur.y = p.y;
    }
  }
  const all = [...cells.values()];
  all.sort((a, b) => b.r - a.r);
  return all.slice(0, max);
}

/** Lifts a glow tint toward white so a deep family colour still lights the ground it sits on. */
export function spellColor(tint: number): number {
  const r = (tint >> 16) & 255;
  const g = (tint >> 8) & 255;
  const b = tint & 255;
  const m = Math.max(r, g, b, 1);
  // Normalise to full brightness, then mix 35% white.
  const f = (c: number) => Math.round(Math.min(255, (c * 255) / m) * 0.65 + 255 * 0.35);
  return (f(r) << 16) | (f(g) << 8) | f(b);
}

// ------------------------------------------------------------------ the light map (Phaser)

/** Static lights are bucketed in CHUNK×CHUNK-px cells for the per-frame view cull. */
const CHUNK = 256;
/** Largest stamp radius + flicker (cull margin). */
const MAX_R = 160;

/** Whether the light map can run on this scene's renderer (WebGL only). */
export function lightMapSupported(scene: Phaser.Scene): boolean {
  const r = scene.sys.renderer as { gl?: unknown } | null;
  return !!r && !!r.gl;
}

/** Texture key of a baked stamp of radius r. */
function stampKey(r: number): string {
  return `lm_disc_${r}`;
}

/** Bakes (once per game) the banded disc of radius r as white with alpha = level; returns its key. */
function ensureStamp(scene: Phaser.Scene, r: number): string {
  const key = stampKey(r);
  const textures = scene.textures;
  if (textures.exists(key)) return key;
  const levels = bandedDisc(r);
  const n = 2 * r + 1;
  const tex = textures.createCanvas(key, n, n);
  if (!tex) return key;
  const g = tex.getContext();
  const img = g.createImageData(n, n);
  for (let i = 0; i < levels.length; i++) {
    img.data[i * 4] = 255;
    img.data[i * 4 + 1] = 255;
    img.data[i * 4 + 2] = 255;
    img.data[i * 4 + 3] = levels[i];
  }
  g.putImageData(img, 0, 0);
  tex.refresh();
  return key;
}

/** A solid TILE square (lava tiles glow whole). */
function ensureTileStamp(scene: Phaser.Scene): string {
  const key = 'lm_tile';
  if (scene.textures.exists(key)) return key;
  const tex = scene.textures.createCanvas(key, TILE, TILE);
  if (!tex) return key;
  const g = tex.getContext();
  g.fillStyle = '#ffffff';
  g.fillRect(0, 0, TILE, TILE);
  tex.refresh();
  return key;
}

/** What the light map needs from its host (the stage): the followed point and the view in world px. */
export interface LightHost {
  /** The player's logical position (null before the player exists). */
  focus(): { x: number; y: number } | null;
}

export interface LightStats {
  stamps: number;
  statics: number;
  spells: number;
  ms: number;
}

/**
 * The per-map light map. Draws at the game's PRE_RENDER (after every update, so the camera scroll and the VFX glow
 * layer are final for the frame) into a RenderTexture of the camera's size, composited with MULTIPLY.
 */
export class LightMap {
  private rt: Phaser.GameObjects.RenderTexture;
  private chunks = new Map<number, LightSource[]>();
  private glow: Phaser.GameObjects.Layer | null = null;
  /** The glow layer this light map lifted from FX_GLOW to LIGHT (night maps), restored on destroy. */
  private lifted: Phaser.GameObjects.Layer | null = null;
  private glowCheck = 0;
  private readonly points: SpellLight[] = [];
  private readonly tileKey: string;
  private alive = true;
  /** View + scene time of the last draw (a paused scene skips identical redraws). */
  private drawn = '';
  /** One stamp config reused for every stamp (no per-stamp allocation): ADD among the lights, origin top-left. */
  private readonly cfg = { originX: 0, originY: 0, tint: 0xffffff, alpha: 1, blendMode: 'ADD', skipBatch: true };
  readonly stats: LightStats = { stamps: 0, statics: 0, spells: 0, ms: 0 };
  private readonly onPreRender = () => this.draw();

  constructor(
    private readonly scene: Phaser.Scene,
    readonly profile: LightProfile,
    sources: readonly LightSource[],
    private readonly host: LightHost,
  ) {
    const cam = scene.cameras.main;
    this.rt = this.makeTexture(Math.ceil(cam.width), Math.ceil(cam.height));
    this.tileKey = ensureTileStamp(scene);
    // Bake every stamp this map can use now (lantern, sources × flicker range), not mid-fight.
    const radii = new Set<number>();
    const addR = (r: number, flick: boolean) => {
      for (const d of flick ? FLICKER_RANGE : [0]) radii.add(Math.max(2, Math.round(r + d)));
    };
    if (profile.lantern) addR(profile.lantern.r, true);
    for (const s of sources) {
      if (s.kind === 'lava_tile') continue;
      const r = Math.round(s.r * (s.kind === 'flame' || s.kind === 'lava' ? 1 : profile.reach));
      const src = { ...s, r };
      addR(r, !!s.flicker);
      const k = this.chunkOf(src.x, src.y);
      const list = this.chunks.get(k);
      if (list) list.push(src);
      else this.chunks.set(k, [src]);
      this.stats.statics++;
    }
    for (const s of sources) if (s.kind === 'lava_tile') this.pushChunk(s);
    for (const r of SPELL_RADII) radii.add(r);
    for (const r of radii) ensureStamp(scene, r);
    scene.game.events.on('prerender', this.onPreRender);
  }

  /** The light texture: one art px per texel, the camera's size, screen-fixed, MULTIPLY over the world. */
  private makeTexture(w: number, h: number): Phaser.GameObjects.RenderTexture {
    return this.scene.add
      .renderTexture(0, 0, Math.max(1, w), Math.max(1, h))
      .setOrigin(0, 0)
      .setScrollFactor(0)
      .setDepth(LIGHT_DEPTH.LIGHT_MAP)
      .setBlendMode('MULTIPLY');
  }

  private pushChunk(s: LightSource): void {
    const k = this.chunkOf(s.x, s.y);
    const list = this.chunks.get(k);
    if (list) list.push(s);
    else this.chunks.set(k, [s]);
  }

  private chunkOf(x: number, y: number): number {
    return (Math.floor(x / CHUNK) + 512) * 1024 + (Math.floor(y / CHUNK) + 512);
  }

  /** The RenderTexture (debug / QA). */
  get texture(): Phaser.GameObjects.RenderTexture {
    return this.rt;
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.scene.game.events.off('prerender', this.onPreRender);
    this.rt.destroy();
    this.chunks.clear();
    this.glow = null;
    // A glow layer lifted above the light map (night maps) goes back under the world's darkness band.
    if (this.lifted?.scene) this.lifted.setDepth(DEPTH.FX_GLOW);
    this.lifted = null;
  }

  private draw(): void {
    if (!this.alive) return;
    const sys = this.scene.sys;
    // Only while the map scene renders (running or paused under a windowed panel).
    if (!sys.settings.visible || !(sys.isActive() || sys.isPaused())) return;
    const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
    const cam = this.scene.cameras.main;
    const w = Math.max(1, Math.ceil(cam.width));
    const h = Math.max(1, Math.ceil(cam.height));
    if (this.rt.width !== w || this.rt.height !== h) {
      // A new texture on resize (rotation, address bar): RenderTexture.resize() left the old render target's
      // extent in use after an orientation change (half the view unlit), so start clean instead. The new texture keeps
      // the old one's camera filter: OmniGrade (render/grade.ts) set it this frame already (its PRE_RENDER may run
      // first), and without it the ungraded overlay camera would multiply the view a second time for a frame.
      const filter = this.rt.cameraFilter;
      this.rt.destroy();
      this.rt = this.makeTexture(w, h);
      this.rt.cameraFilter = filter;
      this.drawn = '';
    }
    const rt = this.rt;
    const sx = Math.round(cam.scrollX);
    const sy = Math.round(cam.scrollY);
    const now = this.scene.time.now;
    if (sys.isPaused()) {
      // Paused under a windowed panel: the texture already holds this view (flicker is frozen with scene time).
      const key = `${sx},${sy},${w},${h},${now}`;
      if (key === this.drawn) return;
      this.drawn = key;
    } else this.drawn = '';
    let stamps = 0;
    const cfg = this.cfg;
    rt.clear();
    rt.fill(this.profile.ambient, 1);
    rt.beginDraw();
    const disc = (x: number, y: number, r: number, color: number, level: number) => {
      if (x + r < sx || x - r > sx + w || y + r < sy || y - r > sy + h) return;
      cfg.tint = color;
      cfg.alpha = level;
      rt.stamp(stampKey(r), undefined, x - r - sx, y - r - sy, cfg);
      stamps++;
    };
    // Static lights in view.
    const c0x = Math.floor((sx - MAX_R) / CHUNK);
    const c1x = Math.floor((sx + w + MAX_R) / CHUNK);
    const c0y = Math.floor((sy - MAX_R) / CHUNK);
    const c1y = Math.floor((sy + h + MAX_R) / CHUNK);
    for (let cy = c0y; cy <= c1y; cy++) {
      for (let cx = c0x; cx <= c1x; cx++) {
        const list = this.chunks.get((cx + 512) * 1024 + (cy + 512));
        if (!list) continue;
        for (const s of list) {
          if (s.kind === 'lava_tile') {
            const x0 = s.x - TILE / 2;
            const y0 = s.y - TILE / 2;
            if (x0 + TILE < sx || x0 > sx + w || y0 + TILE < sy || y0 > sy + h) continue;
            cfg.tint = s.color;
            cfg.alpha = s.level;
            rt.stamp(this.tileKey, undefined, x0 - sx, y0 - sy, cfg);
            stamps++;
            continue;
          }
          const r = Math.max(2, s.r + (s.flicker ? flicker(s.flicker, now) : 0));
          disc(s.x, s.y, r, s.color, s.level);
        }
      }
    }
    // Live spells: whatever the VFX glow layer shows this frame.
    const spells = this.spellLights();
    for (const p of spells) disc(Math.round(p.x), Math.round(p.y), p.r, p.color, 0.8);
    // The player's lantern (body centre), last so it is never culled by the stamp budget.
    const f = this.host.focus();
    const L = this.profile.lantern;
    if (f && L) {
      disc(Math.round(f.x), Math.round(f.y) - 12, Math.max(2, L.r + flicker(0x51a7, now, true)), L.color, 1);
    }
    rt.endDraw();
    this.stats.stamps = stamps;
    this.stats.spells = spells.length;
    if (t0) this.stats.ms = performance.now() - t0;
  }

  /**
   * The VFX glow layer (the Layer of ADD glow twins at DEPTH.LIGHT on dark maps, DEPTH.FX_GLOW elsewhere; docs/VFX.md
   * §8.3), found by type and depth so the light lane never reaches into the VFX runtime. On a night map the runtime
   * leaves it at FX_GLOW (the map is not flagged 'dark'), under this light map, which would multiply every spell glow
   * down to the ambient: the light map lifts it to DEPTH.LIGHT while it runs (as the runtime itself does on dark
   * maps) and puts it back on destroy (lighting turned off).
   */
  private glowLayer(): Phaser.GameObjects.Layer | null {
    if (this.glow && this.glow.scene) return this.glow;
    this.glow = null;
    if (this.glowCheck-- > 0) return null;
    this.glowCheck = 30;
    for (const go of this.scene.children.list) {
      const l = go as unknown as Phaser.GameObjects.Layer;
      if (l.type === 'Layer' && (l.depth === DEPTH.LIGHT || l.depth === DEPTH.FX_GLOW)) {
        this.glow = l;
        if (l.depth === DEPTH.FX_GLOW) {
          l.setDepth(DEPTH.LIGHT);
          this.lifted = l;
        }
        break;
      }
    }
    return this.glow;
  }

  private spellLights(): SpellLight[] {
    const layer = this.glowLayer();
    if (!layer || !layer.visible) return [];
    const pts = this.points;
    pts.length = 0;
    for (const ch of layer.list) {
      const any = ch as unknown as { type: string; visible: boolean; alpha: number };
      if (!any.visible || any.alpha < 0.05) continue;
      if (any.type === 'Blitter') {
        const b = ch as Phaser.GameObjects.Blitter;
        for (const bob of b.children.list) {
          if (!bob.visible || bob.alpha < 0.1) continue;
          if (pts.length >= 400) break;
          pts.push({ x: b.x + bob.x + 2, y: b.y + bob.y + 2, r: SPELL_RADII[0], color: spellColor(bob.tint) });
        }
      } else if (any.type === 'Image' || any.type === 'Sprite') {
        const im = ch as Phaser.GameObjects.Image;
        const dw = im.displayWidth;
        const dh = im.displayHeight;
        const size = Math.max(Math.abs(dw), Math.abs(dh));
        if (size < 4) continue;
        const cx = im.x + (0.5 - im.originX) * dw;
        const cy = im.y + (0.5 - im.originY) * dh;
        pts.push({ x: cx, y: cy, r: spellRadius(size), color: spellColor(im.tintTopLeft) });
      }
    }
    return mergeSpellLights(pts);
  }
}

/** Spell stamp radii (a few sizes, baked once): motes, small glows, orbs and novas. */
export const SPELL_RADII: readonly number[] = [14, 24, 36, 52];

/** The stamp radius for a glow sprite `size` px across: a pool a little wider than the glow. */
export function spellRadius(size: number): number {
  const want = size * 0.75 + 8;
  for (const r of SPELL_RADII) if (want <= r) return r;
  return SPELL_RADII[SPELL_RADII.length - 1];
}
