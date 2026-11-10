// Ground baker: renders a compiled map's terrain (base tiles + autotile edge pieces) ONCE into a few static
// RenderTexture chunks. Replaces the Phaser tilemap layer: same depth, nothing to update per frame.
//
// APRON: a map smaller than the widest view (Lake Islet is 512 px, phone landscape shows 844) would show the flat
// camera clear colour around it. The baker repeats the map's own border terrain outward (water around an islet, wall
// tops around a crypt, the tree wall around a glade, with the border's trees and rocks echoed on it), so the centred
// camera always shows world. Purely visual: nothing outside the map is walkable or collides.
import type Phaser from 'phaser';
import type { CompiledMap, PropKind } from '../../core/world/types';
import { PROP_VARIANTS } from '../art/world';
import { BLEND_MULTIPLY, BLEND_NORMAL, type Caster, CONTACT_ALPHA, SHADOW_ALPHA, SHADOW_RGB, SHADOW_SHEAR, ShadowBaker } from './shadows';
import { ensureEdgeFamilies } from '../art/tiles';
import { T } from '../../core/world/tiles';
import { DECALS_PER_SET, DECAL_SETS, EDGE_VARIANTS, TERRAIN_CLASS, TILE_PX, TONE_TILES, cellHash, computeTerrainLayers, edgeFrameInfo, toneNoise } from './autotile';
import { DEPTH, Y_BIAS, ySort } from './depths';

/** Chunk size in tiles (32 x 32 px = 1024 px, safely under mobile texture limits). */
export const GROUND_CHUNK_TILES = 32;
/** Same depth as the v2 tilemap layer: under every y-sorted sprite and ground decal. */
export const GROUND_DEPTH = DEPTH.GROUND;

export interface BakedGround {
  /** Apron width in tiles on each side (0 when the map fills the widest view on that axis). */
  readonly apron: { x: number; y: number };
  /** Destroys every chunk (and its GPU texture) and the apron's props. */
  destroy(): void;
}

/**
 * Widest view (art px) a map must fill edge to edge: phone landscape 844 x 390, iPad 788 x 548, desktop windows up to
 * about 1100 art px wide. A map narrower or shorter than this gets an apron on that axis.
 */
export const APRON_VIEW_PX = 1120;

/** Apron width in tiles on each side of a map axis `tiles` long: enough to cover half the widest view, plus one. */
export function apronTiles(tiles: number): number {
  const px = tiles * TILE_PX;
  return px >= APRON_VIEW_PX ? 0 : Math.ceil((APRON_VIEW_PX - px) / 2 / TILE_PX) + 1;
}

/** `cm` grown by `ax` / `ay` tiles on each side, every border cell repeated outward (ground and collision; no props). */
export function extendMap(cm: CompiledMap, ax: number, ay: number): CompiledMap {
  const W = cm.w + 2 * ax;
  const H = cm.h + 2 * ay;
  const ground = new Uint8Array(W * H);
  const coll = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    const sy = Math.min(cm.h - 1, Math.max(0, y - ay));
    for (let x = 0; x < W; x++) {
      const sx = Math.min(cm.w - 1, Math.max(0, x - ax));
      ground[y * W + x] = cm.ground[sy * cm.w + sx];
      coll[y * W + x] = cm.coll[sy * cm.w + sx];
    }
  }
  let forest: Uint8Array | undefined;
  if (cm.forest) {
    forest = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(cm.h - 1, Math.max(0, y - ay));
      for (let x = 0; x < W; x++) {
        const sx = Math.min(cm.w - 1, Math.max(0, x - ax));
        const d = cm.forest[sy * cm.w + sx];
        // past the map edge a tree line only gets deeper
        forest[y * W + x] = d && (x < ax || y < ay || x >= ax + cm.w || y >= ay + cm.h) ? Math.max(d, 3) : d;
      }
    }
  }
  return { ...cm, w: W, h: H, ground, coll, props: [], forest, clearing: undefined };
}

/** What the ground baker paints over the terrain: the cast shadows of everything static (SPEC-v4 §11.2 A). */
export interface GroundShadows {
  casters: readonly Caster[];
  /** Multiply strength (0.4 outdoors, 0.3 underground). */
  alpha?: number;
  shear?: number;
}

/** Forest floor: the shade under a tree line, a second step darker from the third row in (multiply strengths). */
const FOREST_SHADE = 0.5;
const FOREST_DEEP = 0.62;

/**
 * The shade of a tree line's floor for one chunk: every forest cell from the second row in is in shadow; the edge
 * toward the front row is ragged in 8 px blocks (hard pixels, no gradient). Returns [shade, deep] canvases or null.
 */
function forestFloor(ext: CompiledMap, seed: number, tx0: number, ty0: number, tw: number, th: number): [HTMLCanvasElement, HTMLCanvasElement] | null {
  const f = ext.forest;
  if (!f) return null;
  const at = (X: number, Y: number) => (X < 0 || Y < 0 || X >= ext.w || Y >= ext.h ? 7 : f[Y * ext.w + X]);
  let any = false;
  for (let y = 0; y < th && !any; y++) for (let x = 0; x < tw && !any; x++) any = at(tx0 + x, ty0 + y) >= 1;
  if (!any) return null;
  const mk = () => {
    const cv = document.createElement('canvas');
    cv.width = tw * TILE_PX;
    cv.height = th * TILE_PX;
    const c = cv.getContext('2d')!;
    c.fillStyle = `#${SHADOW_RGB.toString(16).padStart(6, '0')}`;
    return [cv, c] as const;
  };
  const [shade, sc] = mk();
  const [deep, dc] = mk();
  const B = 4;
  for (let y = 0; y < th; y++)
    for (let x = 0; x < tw; x++) {
      const X = tx0 + x;
      const Y = ty0 + y;
      const d = at(X, Y);
      if (!d) continue;
      if (d >= 2) sc.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      if (d >= 3) dc.fillRect(x * TILE_PX, y * TILE_PX, TILE_PX, TILE_PX);
      // ragged rim: the front row takes blocks of shade along its sides that touch the second row (and the second
      // row takes blocks of the deep tone along the third)
      for (const [c2, need] of [[sc, 2], [dc, 3]] as const) {
        if (d !== need - 1) continue;
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
          if (at(X + dx, Y + dy) < need) continue;
          for (let k = 0; k < TILE_PX / B; k++) {
            const hsh = cellHash(X * 8 + k, Y * 8 + (dx ? 1 : 0), seed, 0xf07e + need);
            const depth = B * (1 + (hsh % 3)) + (k & 1) * B;
            const px = dx ? (dx < 0 ? 0 : TILE_PX - depth) : k * B;
            const py = dy ? (dy < 0 ? 0 : TILE_PX - depth) : k * B;
            c2.fillRect(x * TILE_PX + px, y * TILE_PX + py, dx ? depth : B, dy ? depth : B);
          }
        }
      }
    }
  return [shade, deep];
}

/**
 * Moss under a cave or crypt roof: about 35% darker and greyer than the meadow moss the shared tile atlas draws, so a
 * mossy crypt wing does not read as outdoors (multiply tint on the moss base cells, edge pieces and decals).
 */
const UNDERGROUND_MOSS_TINT = 0x9c9ea8;
const UNDERGROUND: ReadonlySet<string> = new Set(['cave', 'crypt']);

/** Tone wash colours (RGBA): deeper, cooler grass where the noise is low; drier olive where it is high. */
const TONE_DARK = [31, 59, 51, 70] as const;
const TONE_LIGHT = [147, 171, 69, 46] as const;
/** The wash fades out over this many px toward ground it does not cover. */
const FADE_PX = 28;

/**
 * Large-scale ground tone for one chunk (docs/ART-DIRECTION.md; the reference reads as darker and lighter grass patches
 * several tiles across): a translucent wash over grass-like base tiles, its coverage following smooth value noise
 * (autotile.ts toneNoise) as hard-edged two-tone pixel clusters (no dither, no soft blobs). Drawn
 * over the base tiles and edge pieces, under the decals. Null when the chunk has no grass-like ground.
 */
function toneWash(cm: CompiledMap, ext: CompiledMap, ax: number, ay: number, tx0: number, ty0: number, tw: number, th: number): HTMLCanvasElement | null {
  const seed = cm.def.seed | 0;
  const toned = (X: number, Y: number) => TONE_TILES.has(ext.ground[Y * ext.w + X]) || TONE_TILES.has(TERRAIN_CLASS[ext.ground[Y * ext.w + X]]);
  let any = false;
  for (let y = 0; y < th && !any; y++) for (let x = 0; x < tw && !any; x++) any = toned(tx0 + x, ty0 + y);
  if (!any) return null;
  const W = tw * TILE_PX;
  const H = th * TILE_PX;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  const img = ctx.createImageData(W, H);
  const d = img.data;
  const B = 4; // noise resolution (px); the dither works per pixel
  for (let by = 0; by < H; by += B)
    for (let bx = 0; bx < W; bx += B) {
      const X = tx0 + Math.floor(bx / TILE_PX);
      const Y = ty0 + Math.floor(by / TILE_PX);
      if (!toned(X, Y)) continue;
      const n = toneNoise((tx0 - ax) + (bx + B / 2) / TILE_PX, (ty0 - ay) + (by + B / 2) / TILE_PX, seed);
      const dark = n < 0.42 ? Math.min(1, (0.42 - n) / 0.2) : 0;
      const light = n > 0.6 ? Math.min(1, (n - 0.6) / 0.2) : 0;
      if (!dark && !light) continue;
      // fade out toward other ground (its edge pieces spill grass that the wash never covers: no hard line there)
      const fx = (bx % TILE_PX) + B / 2;
      const fy = (by % TILE_PX) + B / 2;
      let edge = FADE_PX;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if ((!dx && !dy) || X + dx < 0 || Y + dy < 0 || X + dx >= ext.w || Y + dy >= ext.h || toned(X + dx, Y + dy)) continue;
          const ex = dx < 0 ? fx : dx > 0 ? TILE_PX - fx : 0;
          const ey = dy < 0 ? fy : dy > 0 ? TILE_PX - fy : 0;
          edge = Math.min(edge, Math.hypot(ex, ey));
        }
      const col = dark ? TONE_DARK : TONE_LIGHT;
      // hard-edged two-tone clusters (SPEC-v4 §11.2 H): a 4 px block is in the patch or out of it; only a ragged
      // one-block rim (a coin per block) breaks the outline. No dither, no soft blob.
      const cover = (dark || light) * Math.min(1, edge / FADE_PX);
      const coin = (cellHash(Math.floor(bx / B) + tx0 * 8, Math.floor(by / B) + ty0 * 8, seed, 0x70ee) & 0xff) / 255;
      if (cover < 0.5 + coin * 0.12) continue;
      for (let y = by; y < by + B; y++)
        for (let x = bx; x < bx + B; x++) {
          const i = (y * W + x) * 4;
          d[i] = col[0];
          d[i + 1] = col[1];
          d[i + 2] = col[2];
          d[i + 3] = col[3];
        }
    }
  ctx.putImageData(img, 0, 0);
  return canvas;
}

/** How far out (tiles) the apron echoes border props. */
const APRON_PROP_TILES = 7;

/** Border props echoed on the apron (trees, rocks and bushes; never signs, gates or anything that reads as a place). */
const APRON_PROPS: ReadonlySet<string> = new Set(['tree', 'darktree', 'pine', 'frostpine', 'deadtree', 'duskwillow', 'basalt_spire', 'rock', 'boulder', 'bush', 'stalagmite', 'crystal']);

/**
 * Bakes the ground of `cm` into static RenderTexture chunks (<= 1024 x 1024 px each) at depth GROUND_DEPTH.
 * Requires the 'tiles', 'tiles_edge' and 'tiles_decal' textures (drawTiles from ../art/tiles). Deterministic per map.
 */
export function bakeGround(scene: Phaser.Scene, cm: CompiledMap, shadows?: GroundShadows): BakedGround {
  const ax = apronTiles(cm.w);
  const ay = apronTiles(cm.h);
  const inner = computeTerrainLayers(cm);
  // The apron's own layers come from the extended map; inside the map rect the map's layers are used unchanged.
  const ext = ax || ay ? extendMap(cm, ax, ay) : cm;
  const outer = ax || ay ? computeTerrainLayers(ext) : inner;
  const W = ext.w;
  const H = ext.h;
  const inMap = (X: number, Y: number) => X >= ax && Y >= ay && X < ax + cm.w && Y < ay + cm.h;
  const base = ax || ay ? new Uint16Array(W * H) : inner.base;
  if (ax || ay)
    for (let Y = 0; Y < H; Y++)
      for (let X = 0; X < W; X++) base[Y * W + X] = inMap(X, Y) ? inner.base[(Y - ay) * cm.w + (X - ax)] : outer.base[Y * W + X];
  const overlays = [
    ...inner.overlays.map((o) => (ax || ay ? { ...o, tx: o.tx + ax, ty: o.ty + ay } : o)),
    ...(ax || ay ? outer.overlays.filter((o) => !inMap(o.tx, o.ty)) : []),
  ];
  const decals = [
    ...inner.decals.map((d) => (ax || ay ? { ...d, x: d.x + ax * TILE_PX, y: d.y + ay * TILE_PX } : d)),
    ...(ax || ay ? outer.decals.filter((d) => !inMap(Math.floor(d.x / TILE_PX), Math.floor(d.y / TILE_PX))) : []),
  ];
  // paint the edge families this map uses (first visit only)
  const fams = new Set<number>();
  for (const o of overlays) fams.add(Math.floor((o.frame >> 4) / EDGE_VARIANTS));
  ensureEdgeFamilies(scene, fams);
  const C = GROUND_CHUNK_TILES;
  const cols = Math.ceil(W / C);
  const rows = Math.ceil(H / C);

  // Bucket overlays and decals per chunk (they keep their relative order; decals never straddle a cell).
  const buckets: { tx: number; ty: number; frame: number }[][] = Array.from({ length: cols * rows }, () => []);
  for (const o of overlays) buckets[Math.floor(o.ty / C) * cols + Math.floor(o.tx / C)].push(o);
  const decalBuckets: { x: number; y: number; frame: number }[][] = Array.from({ length: cols * rows }, () => []);
  const CP = C * TILE_PX;
  for (const d of decals) decalBuckets[Math.floor(d.y / CP) * cols + Math.floor(d.x / CP)].push(d);

  // Underground maps dim their moss (UNDERGROUND_MOSS_TINT); every other cell draws untinted.
  const dimMoss = UNDERGROUND.has(cm.def.biome);
  const mossSet = DECAL_SETS.indexOf('moss');
  const groundAt = (X: number, Y: number) => ext.ground[Y * W + X];
  const baseTint = (X: number, Y: number) => (dimMoss && groundAt(X, Y) === T.MOSS ? UNDERGROUND_MOSS_TINT : 0xffffff);
  const edgeTint = (frame: number) => (dimMoss && edgeFrameInfo(frame).family === 'moss' ? UNDERGROUND_MOSS_TINT : 0xffffff);
  const decalTint = (frame: number) => (dimMoss && Math.floor(frame / DECALS_PER_SET) === mossSet ? UNDERGROUND_MOSS_TINT : 0xffffff);

  // Shadows: the apron's echoed props are planned first so they cast too. One multiply stamp per layer and chunk.
  const apron = ax || ay ? planApronProps(scene, cm, ax, ay) : [];
  const baker = new ShadowBaker(scene, shadows?.shear ?? SHADOW_SHEAR);
  const casters: Caster[] = [...(shadows?.casters ?? [])];
  for (const a of apron) {
    const f = scene.textures.get(a.key).get(a.frame);
    casters.push({ key: a.key, frame: a.frame, x: a.x - Math.floor(f.width / 2), y: a.y - f.height, flip: a.flip });
  }
  const shadowAlpha = shadows?.alpha ?? SHADOW_ALPHA;
  let tmpId = 0;
  const multiply = (rt: Phaser.GameObjects.RenderTexture, canvas: HTMLCanvasElement, alpha: number) => {
    const key = `__shade_${cm.def.id}_${tmpId++}`;
    if (scene.textures.exists(key)) scene.textures.remove(key);
    if (!scene.textures.addCanvas(key, canvas)) return;
    const img = scene.make.image({ key, add: false }).setOrigin(0, 0).setBlendMode(BLEND_MULTIPLY).setAlpha(alpha);
    rt.batchDraw(img, 0, 0);
    // batchDrawFrame() never sets a blend mode: hand the renderer back to NORMAL, or the next chunk's tiles multiply
    const r = scene.renderer as unknown as { gl?: unknown; setBlendMode?: (mode: number, force?: boolean) => boolean };
    if (r.gl && r.setBlendMode) r.setBlendMode(BLEND_NORMAL);
    stale.push(() => {
      img.destroy();
      if (scene.textures.exists(key)) scene.textures.remove(key);
    });
  };
  const stale: (() => void)[] = [];

  const chunks: Phaser.GameObjects.RenderTexture[] = [];
  for (let cy = 0; cy < rows; cy++) {
    for (let cx = 0; cx < cols; cx++) {
      const tx0 = cx * C;
      const ty0 = cy * C;
      const tw = Math.min(C, W - tx0);
      const th = Math.min(C, H - ty0);
      const rt = scene.add.renderTexture((tx0 - ax) * TILE_PX, (ty0 - ay) * TILE_PX, tw * TILE_PX, th * TILE_PX);
      rt.setOrigin(0, 0).setDepth(GROUND_DEPTH);
      rt.beginDraw();
      for (let y = 0; y < th; y++) {
        const row = (ty0 + y) * W;
        for (let x = 0; x < tw; x++)
          rt.batchDrawFrame('tiles', base[row + tx0 + x], x * TILE_PX, y * TILE_PX, 1, baseTint(tx0 + x, ty0 + y));
      }
      for (const o of buckets[cy * cols + cx])
        rt.batchDrawFrame('tiles_edge', o.frame, (o.tx - tx0) * TILE_PX, (o.ty - ty0) * TILE_PX, 1, edgeTint(o.frame));
      // the tone wash goes over the edge pieces too (they repaint whole cells), fading out toward un-toned ground
      const wash = toneWash(cm, ext, ax, ay, tx0, ty0, tw, th);
      const washKey = `__tone_${cm.def.id}_${cx}_${cy}`;
      if (wash && !scene.textures.exists(washKey) && scene.textures.addCanvas(washKey, wash)) rt.batchDrawFrame(washKey, undefined, 0, 0);
      for (const d of decalBuckets[cy * cols + cx])
        rt.batchDrawFrame('tiles_decal', d.frame, d.x - tx0 * TILE_PX, d.y - ty0 * TILE_PX, 1, decalTint(d.frame));
      // forest floor shade, then every static cast shadow as ONE flat layer (overlaps never add up), then contacts
      const floor = forestFloor(ext, cm.def.seed | 0, tx0, ty0, tw, th);
      const layer = baker.layer(casters, (tx0 - ax) * TILE_PX, (ty0 - ay) * TILE_PX, tw * TILE_PX, th * TILE_PX);
      if (floor) {
        // the forest shade and the cast shadows share one layer: a trunk's shadow on a shaded floor adds nothing
        if (layer) floor[0].getContext('2d')!.drawImage(layer.cast, 0, 0);
        multiply(rt, floor[0], Math.max(shadowAlpha, FOREST_SHADE));
        multiply(rt, floor[1], FOREST_DEEP);
      } else if (layer) multiply(rt, layer.cast, shadowAlpha);
      if (layer) multiply(rt, layer.contact, CONTACT_ALPHA);
      rt.endDraw();
      for (const f of stale.splice(0)) f();
      if (scene.textures.exists(washKey)) scene.textures.remove(washKey);
      chunks.push(rt);
    }
  }
  const props = apron.map((a) => {
    const img = scene.add.image(a.x, a.y, a.key, a.frame).setOrigin(0.5, 1).setDepth(ySort(a.y, Y_BIAS.PROP));
    if (a.flip) img.setFlipX(true);
    if (a.tint !== undefined) img.setTint(a.tint);
    return img;
  });
  return {
    apron: { x: ax, y: ay },
    destroy() {
      for (const rt of chunks) rt.destroy();
      chunks.length = 0;
      for (const p of props) p.destroy();
      props.length = 0;
    },
  };
}

interface ApronProp {
  key: string;
  frame?: number;
  x: number;
  y: number;
  flip?: boolean;
  tint?: number;
}

/**
 * The border echoed on the apron: a tree line continues as canopy masses (one per 2 x 2 cells, like the interior of
 * the map's own forest); other border props (rocks, spires, bushes) are echoed on most apron cells beside them.
 */
function planApronProps(scene: Phaser.Scene, cm: CompiledMap, ax: number, ay: number): ApronProp[] {
  const kindAt = new Map<number, PropKind>();
  for (const p of cm.props) if (APRON_PROPS.has(p.kind) && !p.mass && (p.tier ?? 'M') === 'M') kindAt.set(p.ty * cm.w + p.tx, p.kind);
  const forestKind = cm.props.find((p) => p.mass)?.kind;
  if (!kindAt.size && !forestKind) return [];
  const seed = cm.def.seed | 0;
  const out: ApronProp[] = [];
  for (let ty = -ay; ty < cm.h + ay; ty++) {
    for (let tx = -ax; tx < cm.w + ax; tx++) {
      if (tx >= 0 && ty >= 0 && tx < cm.w && ty < cm.h) continue;
      // past APRON_PROP_TILES from the map nothing is on screen at the usual views: keep the image count small
      if (Math.max(-tx, tx - cm.w + 1, -ty, ty - cm.h + 1) > APRON_PROP_TILES) continue;
      const bi = Math.min(cm.h - 1, Math.max(0, ty)) * cm.w + Math.min(cm.w - 1, Math.max(0, tx));
      const h = cellHash(tx, ty, seed, 0x51ab);
      if (forestKind && cm.forest?.[bi]) {
        if ((tx & 1) || !(ty & 1)) continue;
        const key = `${forestKind}_mass${['', '~1', '~2'][(h >>> 16) % 3]}`;
        if (!scene.textures.exists(key)) continue;
        out.push({ key, x: tx * TILE_PX + TILE_PX + (((h >>> 8) % 13) - 6), y: (ty + 1) * TILE_PX + ((h >>> 12) % 5) - 2, flip: (h & 1) === 1, tint: FOREST_TINTS[3] });
        continue;
      }
      const kind = kindAt.get(bi);
      if (!kind || !scene.textures.exists(kind)) continue;
      if (h % 100 >= 82) continue;
      const looks = [kind, ...(PROP_VARIANTS[kind] ?? []).filter((k) => scene.textures.exists(k))];
      const key = looks[(h >>> 16) % looks.length];
      out.push({ key, frame: scene.textures.get(key).has('0') ? 0 : undefined, x: tx * TILE_PX + TILE_PX / 2 + (((h >>> 8) % 7) - 3), y: (ty + 1) * TILE_PX + ((h >>> 12) % 3) });
    }
  }
  return out;
}

/** Multiply tints of a tree line's rows: front row untinted, each row back a step darker and cooler. */
export const FOREST_TINTS: readonly number[] = [0xffffff, 0xb9c4c8, 0x97a6b0, 0x7d8d9c, 0x6a7a8c];
