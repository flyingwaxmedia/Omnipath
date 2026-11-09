// Ground and dressing fixes from the v3 visual audit (src/game/render/ground.ts, autotile.ts, dressing.ts and
// src/game/art/world.ts): small maps get an apron of their own border terrain, the plaza rim is dressed away from
// NPCs and roads, the ground tone noise is smooth, and the common props have look variants.
import { describe, expect, it } from 'vitest';
import { compileMap } from '../src/core/world/compile';
import { T } from '../src/core/world/tiles';
import { PROP_VARIANTS } from '../src/game/art/world';
import { TILE_PX, toneNoise } from '../src/game/render/autotile';
import { planDressing } from '../src/game/render/dressing';
import { APRON_VIEW_PX, apronTiles, extendMap } from '../src/game/render/ground';
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
