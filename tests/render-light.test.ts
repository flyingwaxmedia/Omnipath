// Light lane (docs/QUALITY-PLAN.md §11): the pixel-banded light map's pure parts — map profiles, the hard-banded
// stamps, flame flicker, the static light sources of real maps, lava glow and the live-spell merge. The Phaser side
// (RenderTexture × MULTIPLY) is checked in the browser through window.omnipath.render.light().
import { describe, expect, it } from 'vitest';
import { compileMap, TILE } from '../src/core/world/compile';
import { T } from '../src/core/world/tiles';
import { MAPS } from '../src/data/world';
import { planDressing } from '../src/game/render/dressing';
import {
  BAYER4,
  bandedDisc,
  FLICKER_MS,
  FLICKER_RANGE,
  flicker,
  LIGHT_BANDS,
  LIGHT_PROFILES,
  lavaLights,
  lightingEnabled,
  lightProfile,
  mergeSpellLights,
  NIGHT_MAPS,
  onLightingChange,
  SEAM,
  setLightingEnabled,
  SPELL_CELL,
  SPELL_RADII,
  spellColor,
  spellRadius,
  staticLights,
} from '../src/game/render/lighting';

const def = (id: string) => MAPS.find((m) => m.id === id)!;
const lum = (c: number) => 0.299 * ((c >> 16) & 255) + 0.587 * ((c >> 8) & 255) + 0.114 * (c & 255);

describe('light profiles', () => {
  it('lights every dark map, the listed night maps, and no day map', () => {
    for (const m of MAPS) {
      const p = lightProfile(m);
      if (m.flags?.includes('dark')) {
        expect(p?.mode, m.id).toBe(m.biome === 'cave' ? 'cave' : 'dungeon');
        // warden arenas: dark, but a little brighter than the halls and with a wider lantern
        const base = LIGHT_PROFILES[p!.mode];
        if (m.kind === 'arena') {
          expect(lum(p!.ambient), m.id).toBeGreaterThan(lum(base.ambient) + 8);
          expect(lum(p!.ambient), m.id).toBeLessThan(80);
          expect(p!.lantern!.r, m.id).toBeGreaterThan(base.lantern!.r);
        } else expect(p, m.id).toBe(base);
      }
      else if (NIGHT_MAPS[m.id]) expect(p?.mode, m.id).toBe(NIGHT_MAPS[m.id]);
      else expect(p, m.id).toBeNull();
    }
    for (const id of Object.keys(NIGHT_MAPS)) expect(MAPS.some((m) => m.id === id), id).toBe(true);
  });

  it('makes dungeons clearly dark but never pitch black, and night maps readable', () => {
    // Hollow Barrow I was "barely dark" with the old overlay (most of an iPad view under 36% darkening).
    for (const mode of ['dungeon', 'cave'] as const) {
      const p = LIGHT_PROFILES[mode];
      expect(lum(p.ambient), mode).toBeGreaterThan(20); // silhouettes still read
      expect(lum(p.ambient), mode).toBeLessThan(56); // under a quarter of full brightness
      // the lantern lights about a third of an iPad view (548 art px tall) and never the whole view
      expect(p.lantern!.r * 2).toBeGreaterThan(548 * 0.4);
      expect(p.lantern!.r * 2).toBeLessThan(548 * 0.6);
      expect(lum(p.lantern!.color)).toBeGreaterThan(230); // the core keeps the art's colours
    }
    expect(lum(LIGHT_PROFILES.night.ambient)).toBeGreaterThan(110);
    expect(lum(LIGHT_PROFILES.ash.ambient)).toBeGreaterThan(150);
    expect(LIGHT_PROFILES.ash.lantern).toBeNull();
  });
});

describe('banded light stamps', () => {
  const levels = new Set([0, ...LIGHT_BANDS.map((b) => Math.round(b[1] * 255))]);

  it('uses only the band levels: hard bands, no smooth gradient', () => {
    for (const r of [14, 28, 48, 96, 132]) {
      const d = bandedDisc(r);
      expect(d.length).toBe((2 * r + 1) ** 2);
      const seen = new Set(d);
      for (const v of seen) expect(levels.has(v), `r ${r} level ${v}`).toBe(true);
      expect(seen.size).toBeLessThanOrEqual(LIGHT_BANDS.length + 1);
    }
  });

  it('is full at the core, dark outside the radius and never brighter further out (ring means)', () => {
    const r = 96;
    const n = 2 * r + 1;
    const d = bandedDisc(r);
    const at = (x: number, y: number) => d[(y + r) * n + (x + r)];
    expect(at(0, 0)).toBe(255);
    expect(at(Math.floor(LIGHT_BANDS[0][0] * r) - SEAM, 0)).toBe(255);
    expect(at(r, 0)).toBe(0);
    expect(at(r, r)).toBe(0); // corner of the texture
    const ring = new Map<number, { sum: number; n: number }>();
    for (let y = -r; y <= r; y++)
      for (let x = -r; x <= r; x++) {
        const k = Math.floor(Math.hypot(x, y));
        const e = ring.get(k) ?? { sum: 0, n: 0 };
        e.sum += at(x, y);
        e.n++;
        ring.set(k, e);
      }
    let prev = Infinity;
    for (let k = 0; k <= r + 2; k++) {
      const e = ring.get(k);
      if (!e) continue;
      const mean = e.sum / e.n;
      expect(mean, `ring ${k}`).toBeLessThanOrEqual(prev + 4); // dither noise only
      prev = Math.min(prev, mean);
    }
  });

  it('dithers every band edge with the Bayer matrix (both levels meet inside each seam)', () => {
    const r = 96;
    const n = 2 * r + 1;
    const d = bandedDisc(r);
    expect([...BAYER4].sort((a, b) => a - b)).toEqual([...Array(16).keys()]);
    for (let i = 0; i < LIGHT_BANDS.length - 1; i++) {
      const edge = LIGHT_BANDS[i][0] * r;
      const inner = Math.round(LIGHT_BANDS[i][1] * 255);
      const outer = Math.round(LIGHT_BANDS[i + 1][1] * 255);
      const seen = new Set<number>();
      for (let y = 0; y < n; y++)
        for (let x = 0; x < n; x++) if (Math.abs(Math.hypot(x - r, y - r) - edge) < SEAM / 2) seen.add(d[y * n + x]);
      expect(seen.has(inner) && seen.has(outer), `seam ${i}`).toBe(true);
    }
  });
});

describe('flame flicker (band shift)', () => {
  it('is deterministic, stepped, within the baked range, and steady for unseeded lights', () => {
    expect(flicker(0, 1234)).toBe(0);
    const seen = new Set<number>();
    for (let t = 0; t < 20000; t += 17) {
      const v = flicker(0xabc123, t);
      expect(FLICKER_RANGE).toContain(v);
      expect(flicker(0xabc123, t)).toBe(v);
      seen.add(v);
      expect(FLICKER_RANGE).toContain(flicker(0x51a7, t, true));
    }
    expect(seen.size).toBeGreaterThan(2);
    // never changes faster than every FLICKER_MS / 1.2 (the per-light rate is at most 1.2×)
    let last = flicker(0x77, 0);
    let lastT = 0;
    let minGap = Infinity;
    for (let t = 1; t < 30000; t++) {
      const v = flicker(0x77, t);
      if (v !== last) {
        minGap = Math.min(minGap, t - lastT);
        last = v;
        lastT = t;
      }
    }
    expect(minGap).toBeGreaterThanOrEqual(Math.floor(FLICKER_MS / 1.2));
  });

  it('differs between two flames', () => {
    let same = 0;
    for (let t = 0; t < 10000; t += 50) if (flicker(0x1111, t) === flicker(0x2223, t)) same++;
    expect(same).toBeLessThan(200 * 0.8);
  });
});

describe('static light sources', () => {
  it('lights Hollow Barrow I: its waystone, stairs, candles and no hidden portal', () => {
    const d = def('vale.hollow_barrow.1');
    const cm = compileMap(d);
    const lights = staticLights(cm, d, planDressing(cm));
    expect(lights.some((l) => l.kind === 'waystone')).toBe(true);
    expect(lights.some((l) => l.kind === 'portal')).toBe(true);
    expect(lights.filter((l) => l.kind === 'flame').length).toBeGreaterThan(3);
    for (const l of lights) {
      expect(Number.isInteger(l.x) && Number.isInteger(l.y), `${l.kind} at ${l.x},${l.y}`).toBe(true);
      expect(l.level).toBeGreaterThan(0);
      expect(l.level).toBeLessThanOrEqual(1);
      expect(l.x).toBeGreaterThanOrEqual(0);
      expect(l.y).toBeGreaterThanOrEqual(0);
      expect(l.x).toBeLessThanOrEqual(cm.w * TILE);
      expect(l.y).toBeLessThanOrEqual(cm.h * TILE);
    }
    // deterministic per map
    expect(staticLights(cm, d, planDressing(cm))).toEqual(lights);
  });

  it('never lights an unrevealed hidden portal (the light would give the secret away)', () => {
    let checked = 0;
    for (const m of MAPS) {
      const hidden = m.portals.filter((p) => p.reveal || p.kind === 'hidden');
      if (!hidden.length) continue;
      const lights = staticLights(compileMap(m), m).filter((l) => l.kind === 'portal');
      for (const p of hidden) {
        const inside = lights.filter((l) => l.x >= p.tx * TILE && l.x <= (p.tx + p.w) * TILE && l.y >= p.ty * TILE - TILE && l.y <= (p.ty + p.h) * TILE);
        expect(inside, `${m.id}#${p.id}`).toEqual([]);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('gives every dark map a lit way out and some lights to walk between', () => {
    for (const m of MAPS.filter((x) => x.flags?.includes('dark'))) {
      const cm = compileMap(m);
      const lights = staticLights(cm, m, planDressing(cm));
      expect(lights.some((l) => l.kind === 'portal' || (l.kind === 'flame' && m.portals.some((p) => p.kind === 'door'))), m.id).toBe(true);
      // halls (kind 'dungeon') have lights to walk between; small vaults and arenas at least two
      expect(lights.length, m.id).toBeGreaterThanOrEqual(m.kind === 'dungeon' ? 5 : 2);
    }
  });

  it('lights every lava tile once: inner tiles glow whole, shore tiles get a warm pool (never a square on the land edge)', () => {
    const d = def('rift.basalt_steps');
    const cm = compileMap(d);
    const lava = lavaLights(cm);
    let count = 0;
    for (let i = 0; i < cm.ground.length; i++) if (cm.ground[i] === T.LAVA) count++;
    expect(count).toBeGreaterThan(0);
    expect(lava.length).toBe(count);
    // past the map edge counts as lava (the void there is no shore)
    const isLava = (x: number, y: number) => x < 0 || y < 0 || x >= cm.w || y >= cm.h || cm.ground[y * cm.w + x] === T.LAVA;
    const landNear = (tx: number, ty: number) => {
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (!isLava(tx + dx, ty + dy)) return true;
      return false;
    };
    const tiles = lava.filter((l) => l.kind === 'lava_tile');
    const shores = lava.filter((l) => l.kind === 'lava');
    expect(tiles.length).toBeGreaterThan(0);
    expect(shores.length).toBeGreaterThan(0);
    const seen = new Set<string>();
    for (const s of lava) {
      const tx = (s.x - TILE / 2) / TILE;
      const ty = (s.y - TILE / 2) / TILE;
      expect(Number.isInteger(tx) && Number.isInteger(ty)).toBe(true);
      expect(cm.ground[ty * cm.w + tx]).toBe(T.LAVA);
      expect(seen.has(`${tx},${ty}`)).toBe(false);
      seen.add(`${tx},${ty}`);
      // the land's autotiled edge covers part of a shore cell: a whole-tile square there lit a hard rectangle of land
      expect(landNear(tx, ty), `${s.kind} at ${tx},${ty}`).toBe(s.kind === 'lava');
      if (s.kind === 'lava') expect(s.flicker).not.toBe(0);
    }
    // a map without lava has none
    expect(lavaLights(compileMap(def('vale.greenmeadow')))).toEqual([]);
  });
});

describe('live spell lights', () => {
  it('merges glow points per cell (biggest wins) and caps the count', () => {
    const pts = [
      { x: 5, y: 5, r: 14, color: 0xff0000 },
      { x: 10, y: 8, r: 36, color: 0x00ff00 },
      { x: SPELL_CELL * 3 + 1, y: 2, r: 24, color: 0x0000ff },
    ];
    const out = mergeSpellLights(pts);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ r: 36, color: 0x00ff00 });
    const many = Array.from({ length: 300 }, (_, i) => ({ x: i * SPELL_CELL, y: 0, r: 14, color: 0xffffff }));
    expect(mergeSpellLights(many, 40)).toHaveLength(40);
  });

  it('picks a baked radius a little wider than the glow, and lifts deep tints toward white', () => {
    expect(SPELL_RADII).toContain(spellRadius(4));
    expect(spellRadius(64)).toBe(SPELL_RADII[SPELL_RADII.length - 1]);
    expect(spellRadius(8)).toBeLessThanOrEqual(spellRadius(40));
    const c = spellColor(0x401010);
    expect((c >> 16) & 255).toBe(255);
    expect(c & 255).toBeGreaterThan(80);
    expect(lum(spellColor(0x2040a0))).toBeGreaterThan(lum(0x2040a0));
  });
});

describe('quality hook', () => {
  it('turns the light map on and off and tells listeners once per change', () => {
    const was = lightingEnabled();
    const calls: boolean[] = [];
    const off = onLightingChange((on) => calls.push(on));
    setLightingEnabled(false);
    setLightingEnabled(false);
    setLightingEnabled(true);
    off();
    setLightingEnabled(false);
    expect(calls).toEqual([false, true]);
    setLightingEnabled(was);
    expect(lightingEnabled()).toBe(was);
  });
});
