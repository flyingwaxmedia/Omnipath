// Ground and dressing fixes from the v3 visual audit (src/game/render/ground.ts, autotile.ts, dressing.ts and
// src/game/art/world.ts): small maps get an apron of their own border terrain, the plaza rim is dressed away from
// NPCs and roads, the ground tone noise is smooth, and the common props have look variants.
import { describe, expect, it } from 'vitest';
import { compileMap } from '../src/core/world/compile';
import { T } from '../src/core/world/tiles';
import { PAL, RAMPS, SHADOW_COLOR, WORLD_OUTLINE } from '../src/game/art/pixel';
import { groundBase } from '../src/game/art/tiles';
import { PROP_VARIANTS, TREE_LEAF_RAMPS } from '../src/game/art/world';
import { TILE_PX, toneNoise } from '../src/game/render/autotile';
import { planDressing } from '../src/game/render/dressing';
import { APRON_VIEW_PX, FOREST_TINTS, apronTiles, extendMap } from '../src/game/render/ground';
import { MAPS } from '../src/data/world';

const map = (id: string) => compileMap(MAPS.find((m) => m.id === id)!);

describe('apron for maps smaller than the view', () => {
  it('covers half the widest view plus a tile on each side, and nothing for big maps', () => {
    expect(apronTiles(16)).toBe(Math.ceil((APRON_VIEW_PX - 16 * TILE_PX) / 2 / TILE_PX) + 1);
    expect(apronTiles(16) * TILE_PX * 2 + 16 * TILE_PX).toBeGreaterThanOrEqual(APRON_VIEW_PX);
    expect(apronTiles(Math.ceil(APRON_VIEW_PX / TILE_PX))).toBe(0);
    // every map narrower than a phone in landscape (844 art px) gets one
    for (const m of MAPS) {
      const cm = compileMap(m);
      if (cm.w * TILE_PX < 844) expect(apronTiles(cm.w), m.id).toBeGreaterThan(0);
      if (cm.h * TILE_PX < 548) expect(apronTiles(cm.h), m.id).toBeGreaterThan(0);
    }
  });

  it('repeats the border terrain outward and keeps the map itself unchanged', () => {
    const cm = map('vale.lake_islet');
    const ext = extendMap(cm, 3, 2);
    expect([ext.w, ext.h]).toEqual([cm.w + 6, cm.h + 4]);
    for (let y = 0; y < cm.h; y++) for (let x = 0; x < cm.w; x++) expect(ext.ground[(y + 2) * ext.w + x + 3]).toBe(cm.ground[y * cm.w + x]);
    expect(ext.ground[0]).toBe(cm.ground[0]); // corner: the map's corner cell
    expect(ext.ground[2 * ext.w + 1]).toBe(cm.ground[0]); // left of row 0: row 0's first cell
    expect(ext.props).toEqual([]);
  });
});

describe('ground tone noise', () => {
  it('is smooth (patches several tiles across, not per-tile noise) and deterministic', () => {
    let maxStep = 0;
    for (let x = 0; x < 60; x += 0.25) maxStep = Math.max(maxStep, Math.abs(toneNoise(x + 0.25, 3.5, 7) - toneNoise(x, 3.5, 7)));
    expect(maxStep).toBeLessThan(0.1);
    expect(toneNoise(4.2, 9.1, 7)).toBe(toneNoise(4.2, 9.1, 7));
    const samples = Array.from({ length: 400 }, (_, i) => toneNoise(i * 1.7, i * 0.9, 3));
    expect(Math.min(...samples)).toBeLessThan(0.3); // some darker patches…
    expect(Math.max(...samples)).toBeGreaterThan(0.7); // …and some drier ones
  });
});

describe('town plaza rim', () => {
  const RIM = new Set(['dr_crates', 'dr_barrel', 'dr_crate', 'dr_banner_blue', 'dr_banner_red', 'dr_lantern', 'dr_fence_post']);
  for (const id of ['vale.hearthvale', 'rift.riftmarch']) {
    it(`${id}: crates, barrels and banners stand on the cobble rim, clear of NPCs, portals and road centrelines`, () => {
      const cm = map(id);
      const onCobble = planDressing(cm).filter((d) => {
        const tx = Math.floor(d.x / TILE_PX);
        const ty = Math.floor((d.y - 1) / TILE_PX);
        return RIM.has(d.key) && cm.ground[ty * cm.w + tx] === T.COBBLE;
      });
      expect(onCobble.length).toBeGreaterThanOrEqual(2);
      for (const d of onCobble) {
        const tx = Math.floor(d.x / TILE_PX);
        const ty = Math.floor((d.y - 1) / TILE_PX);
        for (const n of cm.def.npcs ?? []) expect(Math.max(Math.abs(n.tx - tx), Math.abs(n.ty - ty)), `${d.key} near ${n.npc}`).toBeGreaterThan(1);
        for (const p of cm.def.portals) expect(tx < p.tx - 2 || tx > p.tx + p.w + 1 || ty < p.ty - 2 || ty > p.ty + p.h + 1).toBe(true);
      }
    });
  }
});

describe('prop look variants', () => {
  it('rocks, boulders, bushes and tombstones have two extra looks each (the stage picks one per tile)', () => {
    for (const k of ['rock', 'boulder', 'bush', 'tombstone']) expect(PROP_VARIANTS[k], k).toEqual([`${k}~1`, `${k}~2`]);
  });
});

// ------------------------------------------------------------------ v4 palette (SPEC-v4 §11.2 H)

const lum = (c: string | number) => {
  const n = typeof c === 'number' ? c : parseInt(c.slice(1), 16);
  return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
};
const hue = (c: string) => {
  const n = parseInt(c.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255);
  const mx = Math.max(r, g, b);
  const d = mx - Math.min(r, g, b);
  if (!d) return 0;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
};

describe('palette ramps', () => {
  it('match the SPEC-v4 §11.2 H table', () => {
    expect(RAMPS.grass).toEqual(['#1f3b33', '#2f5435', '#47702f', '#6a8f36', '#93ab45', '#c4c765']);
    expect(RAMPS.foliage).toEqual(['#17302f', '#23483a', '#32663a', '#4f8a3c', '#86ad45', '#c9cf6a']);
    expect(RAMPS.dirt).toEqual(['#4a3340', '#6e4f48', '#94714f', '#b8955f', '#d9bd7c', '#efdc9e']);
    expect(RAMPS.stone).toEqual(['#2b2a40', '#454660', '#69708a', '#959aa6', '#c2c2b4', '#e8e2c6']);
    expect(RAMPS.wood).toEqual(['#2e1a26', '#4d2a2a', '#74432d', '#9c6534', '#c48e48', '#e3bb6c']);
    expect(RAMPS.water).toEqual(['#1b2f5a', '#23508a', '#2f7fa8', '#4fb0b8', '#9adcc8', '#e4f6e0']);
    expect(RAMPS.roofTerracotta).toEqual(['#4a1f33', '#7a2f33', '#a8472f', '#cf6b38', '#e89a52']);
    expect(RAMPS.roofSlate).toEqual(['#232a4a', '#34466e', '#4d6c8f', '#7a9cab']);
    expect(RAMPS.roofThatch).toEqual(['#5a4326', '#86682f', '#b3923f', '#d9bd5e']);
    expect(RAMPS.roofVerdigris).toEqual(['#173b40', '#23605a', '#3a8a72', '#74b890']);
  });

  it('are hue-shifted: every step is lighter than the last, shadows sit cooler than lights', () => {
    for (const [name, ramp] of Object.entries(RAMPS)) {
      for (let i = 1; i < ramp.length; i++) expect(lum(ramp[i]), `${name}[${i}]`).toBeGreaterThan(lum(ramp[i - 1]));
      // the darkest and the lightest step differ in hue (a value-only ramp keeps one hue)
      const a = hue(ramp[0]);
      const b = hue(ramp[ramp.length - 1]);
      expect(Math.min(Math.abs(a - b), 360 - Math.abs(a - b)), name).toBeGreaterThanOrEqual(8);
    }
    // older call sites read shorter cuts of the same tables
    expect(PAL.grass).toEqual(RAMPS.grass.slice(1));
    expect(PAL.stone).toEqual(RAMPS.stone.slice(1, 5));
  });

  it('keeps the character outline for actors and a cooler shared dark for the world; shadows are violet', () => {
    expect(PAL.outline).toBe('#24180f');
    expect(WORLD_OUTLINE).toBe(RAMPS.stone[0]);
    expect(WORLD_OUTLINE).not.toBe(PAL.outline);
    expect(SHADOW_COLOR).toBe('#3a3560');
  });
});

describe('value plan', () => {
  // biome ground -> the tree whose masses stand on it
  const BIOMES: readonly [ground: string, tree: string][] = [
    ['grass', 'tree'],
    ['dark', 'darktree'],
    ['hill', 'pine'],
    ['storm', 'pine'],
    ['dusk', 'duskwillow'],
    ['glade', 'duskwillow'],
  ];
  it('paths are at least 25% lighter than the ground, tree masses at least 20% darker', () => {
    const path = lum(groundBase('path')!);
    for (const [ground, tree] of BIOMES) {
      const g = lum(groundBase(ground)!);
      expect(path, `${ground}: path`).toBeGreaterThanOrEqual(g * 1.25);
      // a canopy mass is painted a ramp step down (its mid tone is the leaf ramp's step 1 – 2) and tinted by its row
      const leaf = TREE_LEAF_RAMPS[tree];
      const tint = lum(FOREST_TINTS[2]);
      expect(lum(leaf[2]) * tint, `${ground}: ${tree} mass`).toBeLessThanOrEqual(g * 0.8);
    }
  });

  it('keeps the ground dark-mid: darker than the path, lighter than the tree masses, quieter than v3', () => {
    expect(lum(groundBase('grass')!)).toBeLessThan(0.4); // v3 grass sat at 0.45
    expect(lum(groundBase('grass')!)).toBeGreaterThan(0.25);
    expect(lum(groundBase('path')!)).toBeGreaterThan(0.6); // v3 path sat at 0.56
    for (let i = 1; i < FOREST_TINTS.length; i++) expect(lum(FOREST_TINTS[i])).toBeLessThan(lum(FOREST_TINTS[i - 1]));
  });
});
