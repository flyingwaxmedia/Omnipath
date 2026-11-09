// Living world (living lane; docs/QUALITY-PLAN.md §12): the pure parts of src/game/render/ambient.ts (profiles, tiers,
// the seeded air / smoke / cloud simulations, wind and idle frame pickers, open-water cells), the ambient art
// (art/tiles.ts water shimmer, art/dressing.ts clouds + banner wave + idle registries, art/world.ts chimney anchors)
// and the dressing planner's jitter + flips (render/dressing.ts). The Phaser layer is checked in the browser.
import { describe, expect, it } from 'vitest';
import { compileMap } from '../src/core/world/compile';
import { T } from '../src/core/world/tiles';
import type { CompiledMap } from '../src/core/world/types';
import { MAPS } from '../src/data/world';
import { CLOUD_SIZES, DRESSING_IDLE, DRESSING_KEYS, LEAF_FRAMES, PUFF_SIZES, SWAY_CELLS, clothShift, cloudMask, swayLean } from '../src/game/art/dressing';
import { GLINT_FRAMES, SHIMMER_PHASES, SHIMMER_VARIANTS, glintPixels, shimmerPixels, shimmerWavelets } from '../src/game/art/tiles';
import { STRUCTURE_SMOKE, WORLD_IDLE } from '../src/game/art/world';
import {
  AIR_MARGIN,
  AMBIENT_CAPS,
  AMBIENT_DEPTH,
  AMBIENT_TIERS,
  AirSim,
  CLOUD_REACH,
  CloudSim,
  EMISSIVE,
  PuffSim,
  type View,
  ambientProfile,
  ambientQuality,
  effectiveTier,
  governorScale,
  gust,
  idleFrame,
  onAmbientQuality,
  openWater,
  setAmbientQuality,
  shimmerAt,
  shimmerNudge,
  waterKindAt,
  windWave,
} from '../src/game/render/ambient';
import { DEPTH, VFX_DEPTH, WORLD_MAX } from '../src/game/render/depths';
import { DRESSING_ALIGNED, DRESSING_FACING, DRESSING_JITTER, DRESSING_LIT, planDressing } from '../src/game/render/dressing';

const map = (id: string): CompiledMap => compileMap(MAPS.find((m) => m.id === id)!);
const PHONE: View = { x: 400, y: 300, w: 390, h: 844 };

/** Runs a sim for `seconds` at a fixed 60 fps step. */
function run(sim: { step(dt: number, t: number, v: View): void }, v: View, seconds: number, t0 = 0): number {
  const dt = 1 / 60;
  let t = t0;
  for (let i = 0; i < seconds * 60; i++) sim.step(dt, (t += dt), v);
  return t;
}

describe('ambient profiles', () => {
  it('every map has one; roofs and darkness never get cloud shadows; outdoor day maps do', () => {
    for (const m of MAPS) {
      const p = ambientProfile(m);
      expect(p.air.length, m.id).toBeGreaterThan(0);
      const covered = m.flags?.includes('dark') || m.flags?.includes('indoor');
      if (covered) expect(p.clouds, m.id).toBe(0);
      expect(p.clouds).toBeLessThanOrEqual(0.35); // MULTIPLY at low alpha
    }
    for (const id of ['vale.greenmeadow', 'vale.gloomwood', 'vale.hearthvale', 'vale.mirror_lake', 'rift.riftgate_road', 'rift.frost_shelf'])
      expect(ambientProfile(MAPS.find((m) => m.id === id)!).clouds, id).toBeGreaterThan(0);
  });

  it('weather fits the biome (leaves, fireflies, embers + heat, snow, spores, dust, rain)', () => {
    const kinds = (biome: string) => ambientProfile({ biome: biome as never, flags: [] }).air.map((a) => a.kind);
    expect(kinds('meadow')).toContain('leaf');
    expect(kinds('grove')).toEqual(expect.arrayContaining(['leaf', 'spore']));
    expect(kinds('glade')).toContain('firefly');
    expect(kinds('dusk')).toContain('firefly');
    expect(kinds('ember')).toEqual(expect.arrayContaining(['ember', 'heat']));
    expect(kinds('basalt')).toEqual(expect.arrayContaining(['ember', 'heat']));
    expect(kinds('frost')).toContain('snow');
    expect(kinds('cave')).toContain('dust');
    expect(kinds('crypt')).toContain('dust');
    expect(kinds('quarry')).toContain('dust');
    expect(kinds('storm')).toContain('rain');
    for (const k of ['firefly', 'spore', 'ember', 'heat'] as const) expect(EMISSIVE.has(k)).toBe(true);
    for (const k of ['leaf', 'snow', 'rain', 'dust'] as const) expect(EMISSIVE.has(k)).toBe(false);
  });

  it('layers sit on named depths: water over the ground, clouds and air over the y-sorted world, under tags', () => {
    expect(AMBIENT_DEPTH.WATER).toBeGreaterThan(DEPTH.GROUND);
    expect(AMBIENT_DEPTH.WATER).toBeLessThan(DEPTH.GROUND_DECAL);
    expect(AMBIENT_DEPTH.PUDDLE).toBeLessThan(DEPTH.DRESSING_FLAT);
    expect(AMBIENT_DEPTH.CLOUD).toBeGreaterThan(WORLD_MAX);
    expect(AMBIENT_DEPTH.CLOUD).toBeLessThan(AMBIENT_DEPTH.AIR);
    expect(AMBIENT_DEPTH.GLOW).toBeLessThan(VFX_DEPTH.FX_MOTES);
    expect(AMBIENT_DEPTH.GLOW).toBeLessThan(DEPTH.CANOPY);
  });
});

describe('quality tiers (export setter)', () => {
  it('automatic tier: high on WebGL, low on Canvas; the setter pins it and notifies', () => {
    expect(effectiveTier(true, null)).toBe('high');
    expect(effectiveTier(false, null)).toBe('low');
    expect(effectiveTier(false, 'med')).toBe('med');
    const seen: (string | null)[] = [];
    const off = onAmbientQuality((t) => seen.push(t));
    setAmbientQuality('low');
    expect(ambientQuality()).toBe('low');
    setAmbientQuality('low'); // no change, no event
    setAmbientQuality(null);
    off();
    setAmbientQuality('high');
    setAmbientQuality(null);
    expect(seen).toEqual(['low', null]);
  });

  it('density grows off < low < med < high; off turns every layer off', () => {
    const t = AMBIENT_TIERS;
    expect(t.off).toEqual({ air: 0, clouds: false, water: 0, glints: 0, idle: false, smoke: 0 });
    expect(t.low.air).toBeLessThan(t.med.air);
    expect(t.med.air).toBeLessThan(t.high.air);
    expect(t.low.clouds).toBe(false);
    expect(t.high.clouds && t.high.idle).toBe(true);
    const sim = new AirSim(ambientProfile({ biome: 'storm', flags: [] }).air, 7, 14);
    const n = (d: number) => sim.counts(PHONE, d).reduce((a, b) => a + b, 0);
    expect(n(0)).toBe(0);
    expect(n(t.low.air)).toBeLessThan(n(t.med.air));
    expect(n(t.med.air)).toBeLessThan(n(t.high.air));
    // a huge view never exceeds the pool cap
    expect(sim.counts({ x: 0, y: 0, w: 4000, h: 4000 }, 1).reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(AMBIENT_CAPS.air);
  });

  it('the VFX governor scales density only while it runs free (a pinned / Canvas tier never counts twice)', () => {
    expect(governorScale(undefined)).toBe(1);
    expect(governorScale({})).toBe(1);
    // free governor under load: its live level
    expect(governorScale({ quality: 1, pinned: null, canvasTier: false })).toBe(1);
    expect(governorScale({ quality: 0.5, pinned: null, canvasTier: false })).toBe(0.5);
    expect(governorScale({ quality: 0.25, pinned: null })).toBe(0.25);
    // Medium / Low / battery saver pin the runtime: the ambient tier (med / low) already holds the cut
    expect(governorScale({ quality: 0.5, pinned: 0.5, canvasTier: false })).toBe(1);
    expect(governorScale({ quality: 0.25, pinned: 0.25 })).toBe(1);
    // the Canvas renderer's fixed VFX tier (ambient: low)
    expect(governorScale({ quality: 0.25, pinned: null, canvasTier: true })).toBe(1);
    // a ceiling (setMaxQuality): the level under it
    expect(governorScale({ quality: 0.5, pinned: null, maxQuality: 0.5 })).toBe(1);
    expect(governorScale({ quality: 0.25, pinned: null, maxQuality: 0.5 })).toBe(0.5);
  });
});

describe('air particles (pooled, seeded, whole pixels)', () => {
  const biomes = ['meadow', 'grove', 'glade', 'ember', 'frost', 'storm', 'cave', 'dusk', 'quarry'] as const;
  const hot = (_k: 'ember' | 'heat', r: () => number) => ({ x: 500 + r() * 64, y: 700 + r() * 64 });

  it('same seed + same frame times = the same pixels; another seed differs', () => {
    for (const b of biomes) {
      const p = ambientProfile({ biome: b, flags: [] });
      const make = (seed: number) => {
        const s = new AirSim(p.air, seed, p.wind, hot);
        s.layout(PHONE, 1);
        run(s, PHONE, 3);
        return s.parts.map((q) => `${q.on}:${q.px},${q.py},${q.frame}`).join('|');
      };
      expect(make(42), b).toBe(make(42));
      expect(make(42), b).not.toBe(make(43));
    }
  });

  it('draw positions are whole art pixels and frames come from the atlas names', () => {
    const names = new Set<string>();
    for (const b of biomes) {
      const p = ambientProfile({ biome: b, flags: [] });
      const s = new AirSim(p.air, 5, p.wind, hot);
      s.layout(PHONE, 1);
      for (let k = 0; k < 120; k++) {
        s.step(1 / 60, k / 60, PHONE);
        for (const q of s.parts) {
          if (!q.on) continue;
          expect(Number.isInteger(q.px) && Number.isInteger(q.py)).toBe(true);
          names.add(q.frame);
        }
        for (const q of s.puddles) if (q.on) expect(Number.isInteger(q.x) && Number.isInteger(q.y)).toBe(true);
      }
    }
    for (const n of names) expect(n).toMatch(/^(leaf_(green|autumn|grove|petal)_([0-3]|fade)|snow_[0-2]|rain_[01]|firefly_[0-3]|spore_(gloom|dusk)_[0-2]|dust_[01]|ember_[0-4]|heat_[01])$/);
    expect([...names].some((n) => n.startsWith('leaf_'))).toBe(true);
  });

  it('the field follows the view: particles live in the view plus a margin, wherever the camera goes', () => {
    for (const b of ['meadow', 'frost', 'glade', 'storm'] as const) {
      const p = ambientProfile({ biome: b, flags: [] });
      const s = new AirSim(p.air, 9, p.wind);
      const v = { ...PHONE };
      s.layout(v, 1);
      let t = 0;
      for (let k = 0; k < 600; k++) {
        v.x += 1.5; // the player walks east and south
        v.y += 0.7;
        s.step(1 / 60, (t += 1 / 60), v);
      }
      const live = s.parts.filter((q) => q.on);
      expect(live.length, b).toBe(s.counts(v, 1).reduce((a, c) => a + c, 0));
      for (const q of live) {
        expect(q.x, b).toBeGreaterThanOrEqual(v.x - AIR_MARGIN - 2);
        expect(q.x, b).toBeLessThanOrEqual(v.x + v.w + AIR_MARGIN + 2);
        expect(q.y, b).toBeGreaterThanOrEqual(v.y - AIR_MARGIN - 120);
        expect(q.y, b).toBeLessThanOrEqual(v.y + v.h + AIR_MARGIN + 2);
      }
    }
  });

  it('density changes park or wake particles from the same pool', () => {
    const p = ambientProfile({ biome: 'frost', flags: [] });
    const s = new AirSim(p.air, 3, p.wind);
    s.layout(PHONE, 1);
    const pool = s.parts.length;
    expect(s.live).toBe(pool);
    s.layout(PHONE, 0.3);
    expect(s.live).toBeLessThan(pool);
    expect(s.parts.length).toBe(pool);
    s.layout(PHONE, 1);
    expect(s.live).toBe(pool);
    expect(s.parts.length).toBe(pool);
  });

  it('leaves flutter down, land, rest and fade (dithered frame), then fall again', () => {
    const s = new AirSim([{ kind: 'leaf', per100k: 3, sets: ['green'] }], 11, 8);
    s.layout(PHONE, 1);
    const seen = new Set<string>();
    let landed = 0;
    let t = 0;
    for (let k = 0; k < 60 * 30; k++) {
      s.step(1 / 60, (t += 1 / 60), PHONE);
      for (const q of s.parts) {
        seen.add(q.frame);
        if (q.state === 1) landed++;
      }
    }
    for (let i = 0; i < LEAF_FRAMES; i++) expect(seen.has(`leaf_green_${i}`)).toBe(true);
    expect(seen.has('leaf_green_fade')).toBe(true);
    expect(landed).toBeGreaterThan(0);
  });

  it('rain splashes into puddle rings (capped), each ring plays out and frees its slot', () => {
    const s = new AirSim([{ kind: 'rain', per100k: 34 }], 2, 14);
    s.layout(PHONE, 1);
    let peak = 0;
    const frames = new Set<string>();
    let t = 0;
    for (let k = 0; k < 120; k++) {
      s.step(1 / 60, (t += 1 / 60), PHONE);
      const on = s.puddles.filter((q) => q.on);
      peak = Math.max(peak, on.length);
      for (const q of on) frames.add(q.frame);
    }
    expect(peak).toBeGreaterThan(0);
    expect(s.puddles.length).toBeLessThanOrEqual(AMBIENT_CAPS.puddles);
    expect(frames.size).toBe(4);
    s.layout(PHONE, 0); // rain stops: rings finish, none restart
    for (let k = 0; k < 60; k++) s.step(1 / 60, (t += 1 / 60), PHONE);
    expect(s.puddles.filter((q) => q.on).length).toBe(0);
  });

  it('embers rise from hot ground and cool through their frames', () => {
    const s = new AirSim([{ kind: 'ember', per100k: 10 }], 4, 4, hot);
    s.layout(PHONE, 1);
    const y0 = s.parts.map((q) => q.y);
    s.step(1 / 60, 1 / 60, PHONE);
    let rose = 0;
    s.parts.forEach((q, i) => (q.y < y0[i] ? rose++ : 0));
    expect(rose).toBeGreaterThan(s.parts.length * 0.8);
    const frames = new Set<string>();
    let t = 0;
    for (let k = 0; k < 240; k++) {
      s.step(1 / 60, (t += 1 / 60), PHONE);
      for (const q of s.parts) frames.add(q.frame);
    }
    expect([...frames].sort()).toEqual(['ember_0', 'ember_1', 'ember_2', 'ember_3', 'ember_4']);
  });

  it('fireflies blink (dark most of the period, a short glow) and wander slowly', () => {
    const s = new AirSim([{ kind: 'firefly', per100k: 8 }], 6, 3);
    s.layout(PHONE, 1);
    const counts: Record<string, number> = {};
    let t = 0;
    const start = s.parts.map((q) => [q.x, q.y]);
    for (let k = 0; k < 60 * 10; k++) {
      s.step(1 / 60, (t += 1 / 60), PHONE);
      for (const q of s.parts) counts[q.frame] = (counts[q.frame] ?? 0) + 1;
    }
    const total = Object.values(counts).reduce((a, b) => a + b, 0);
    expect(counts.firefly_0 / total).toBeGreaterThan(0.4);
    expect(counts.firefly_3 / total).toBeGreaterThan(0.1);
    // ≤ 12 px/s each way: nobody crossed the screen in 10 s (wraps aside, most stay within ~150 px)
    const near = s.parts.filter((q, i) => Math.hypot(q.x - start[i][0], q.y - start[i][1]) < 170).length;
    expect(near).toBeGreaterThan(s.parts.length * 0.7);
  });
});

describe('chimney smoke and campfire sparks', () => {
  it('emits only near the view, rises in whole px, grows and thins, never past the cap', () => {
    const em = () => [
      { x: 500, y: 500, kind: 'smoke' as const, next: 0 },
      { x: 520, y: 520, kind: 'spark' as const, next: 0 },
      { x: 5000, y: 500, kind: 'smoke' as const, next: 0 }, // far off screen
    ];
    const a = new PuffSim(em(), 8, 9);
    const b = new PuffSim(em(), 8, 9);
    const v: View = { x: 300, y: 300, w: 390, h: 600 };
    let t = 0;
    const frames = new Set<string>();
    for (let k = 0; k < 60 * 6; k++) {
      t += 1 / 60;
      a.step(1 / 60, t, v, 1);
      b.step(1 / 60, t, v, 1);
      for (const p of a.puffs) {
        if (!p.on) continue;
        frames.add(p.frame);
        expect(Number.isInteger(p.px) && Number.isInteger(p.py)).toBe(true);
        expect(p.x).toBeLessThan(1000); // the far chimney never smoked
        expect(p.py).toBeLessThanOrEqual(p.kind === 'spark' ? 520 + 1 : 500 + 1);
      }
    }
    expect(a.puffs.map((p) => `${p.px},${p.py},${p.frame}`)).toEqual(b.puffs.map((p) => `${p.px},${p.py},${p.frame}`));
    expect(a.puffs.length).toBeLessThanOrEqual(AMBIENT_CAPS.puffs);
    for (let i = 0; i < PUFF_SIZES.length; i++) expect(frames.has(`smoke_${i}`)).toBe(true);
    expect([...frames].some((f) => f.startsWith('ember_'))).toBe(true);
    // rate 0 (tier off) stops new puffs
    const c = new PuffSim(em(), 8, 9);
    for (let k = 0; k < 120; k++) c.step(1 / 60, k / 60, v, 0);
    expect(c.live).toBe(0);
    // ... and the tier coming back restarts the smoke at once (no schedule pushed seconds ahead while it was off)
    for (let k = 120; k < 120 + 12; k++) c.step(1 / 60, k / 60, v, 1);
    expect(c.live).toBeGreaterThan(0);
  });

  it('chimney mouths sit inside their structure textures', () => {
    const size: Record<string, [number, number]> = { struct_house: [96, 108], struct_hut: [96, 100], struct_smithy: [128, 128], struct_hall: [192, 156], smithy: [128, 128], hut: [96, 100] };
    for (const [key, mouths] of Object.entries(STRUCTURE_SMOKE)) {
      expect(size[key], key).toBeDefined();
      for (const [x, y] of mouths) {
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(size[key][0]);
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(size[key][1] / 4);
      }
    }
  });
});

describe('cloud shadows', () => {
  it('drift slowly in whole-pixel steps and stay in a field around the view', () => {
    const s = new CloudSim(17, 9);
    const v = { ...PHONE };
    s.step(1 / 60, 0, v);
    expect(s.clouds.length).toBeGreaterThanOrEqual(2);
    const x0 = s.clouds.map((c) => c.x);
    run(s, v, 1);
    s.clouds.forEach((c, i) => {
      expect(Number.isInteger(c.px) && Number.isInteger(c.py)).toBe(true);
      const moved = c.x - x0[i];
      expect(moved).toBeGreaterThan(0); // drifting downwind
      expect(moved).toBeLessThan(20); // a few px per second: big slow shapes
    });
    // walk far: the field follows (wraps off screen), every cloud stays within the domain
    let t = 1;
    for (let k = 0; k < 600; k++) {
      v.x += 2;
      s.step(1 / 60, (t += 1 / 60), v);
    }
    for (const c of s.clouds) {
      const [w, h] = CLOUD_SIZES[c.shape];
      expect(c.x + w).toBeGreaterThanOrEqual(v.x - CLOUD_REACH.x - 4);
      expect(c.x).toBeLessThanOrEqual(v.x + v.w + CLOUD_REACH.x + 4);
      expect(c.y + h).toBeGreaterThanOrEqual(v.y - CLOUD_REACH.y - 4);
      expect(c.y).toBeLessThanOrEqual(v.y + v.h + CLOUD_REACH.y + 4);
    }
  });

  it('masks are opaque shapes with a 1 px-noise rim (no alpha), an empty border, and deterministic', () => {
    for (const [i, [w, h]] of CLOUD_SIZES.entries()) {
      const m = cloudMask(w, h, 100 + i);
      expect(m).toEqual(cloudMask(w, h, 100 + i));
      let on = 0;
      let lone = 0;
      for (let y = 0; y < h; y++)
        for (let x = 0; x < w; x++) {
          const v = m[y * w + x];
          expect(v === 0 || v === 1).toBe(true);
          if (x < 2 || y < 2 || x >= w - 2 || y >= h - 2) expect(v).toBe(0);
          if (!v) continue;
          on++;
          const n = m[y * w + x - 1] + m[y * w + x + 1] + m[(y - 1) * w + x] + m[(y + 1) * w + x];
          if (n <= 1) lone++;
        }
      expect(on / (w * h)).toBeGreaterThan(0.25); // a big shape …
      expect(lone).toBeGreaterThan(20); // … whose rim breaks into single pixels (soft edge by noise)
    }
  });
});

describe('water shimmer', () => {
  it('open water excludes every cell an autotile edge could reach (shores, shallow/deep borders)', () => {
    const cm = map('vale.mirror_lake');
    let open = 0;
    for (let y = 0; y < cm.h; y++)
      for (let x = 0; x < cm.w; x++) {
        const k = openWater(cm, x, y);
        if (!k) continue;
        open++;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(waterKindAt(cm, x + dx, y + dy)).toBe(k);
        expect(cm.ground[y * cm.w + x] === T.WATER || cm.ground[y * cm.w + x] === T.DEEP).toBe(true);
      }
    expect(open).toBeGreaterThan(20);
    expect(openWater(cm, -5, -5) === null || typeof openWater(cm, -5, -5) === 'string').toBe(true); // apron: clamped
  });

  it('cells step through 3 phases (~0.38 s each), desynced, nudged off the grid by at most 8 px', () => {
    const phases = new Set<number>();
    for (let t = 0; t < 2; t += 0.05) phases.add(shimmerAt(12345, t).phase);
    expect([...phases].sort()).toEqual([0, 1, 2]);
    const at0 = new Set(Array.from({ length: 50 }, (_, i) => shimmerAt(i * 7919, 0).phase));
    expect(at0.size).toBe(3);
    for (let h = 0; h < 5000; h += 37) {
      const [x, y] = shimmerNudge(h * 2654435761);
      expect(Math.abs(x)).toBeLessThanOrEqual(8);
      expect(Math.abs(y)).toBeLessThanOrEqual(8);
    }
  });

  it('overlay frames are opaque wavelet pixels only, inside the cell, different every phase', () => {
    for (const kind of ['water', 'deep'] as const)
      for (let v = 0; v < SHIMMER_VARIANTS; v++) {
        const w = shimmerWavelets(kind, v);
        expect(w.length).toBeGreaterThanOrEqual(2);
        for (const [x, y, len] of w) {
          expect(x).toBeGreaterThanOrEqual(0);
          expect(x + len + 1).toBeLessThanOrEqual(32);
          expect(y + 1).toBeLessThan(32);
        }
        const frames = Array.from({ length: SHIMMER_PHASES }, (_, p) => shimmerPixels(kind, v, p));
        for (const f of frames) {
          let set = 0;
          for (let i = 3; i < f.length; i += 4) {
            expect(f[i] === 0 || f[i] === 255).toBe(true);
            if (f[i]) set++;
          }
          expect(set).toBeGreaterThan(3);
          expect(set).toBeLessThan(80); // a few wavelets, never a tile repaint
        }
        expect(frames[0]).not.toEqual(frames[1]);
        expect(frames[1]).not.toEqual(frames[2]);
      }
    for (let f = 0; f < GLINT_FRAMES; f++) {
      const g = glintPixels('water', f);
      for (let i = 3; i < g.length; i += 4) expect(g[i] === 0 || g[i] === 255).toBe(true);
    }
  });
});

describe('prop idle frames', () => {
  it('registries: idle textures have 2-3 frames; dressing ones are real dressing keys', () => {
    for (const [k, a] of Object.entries(DRESSING_IDLE)) {
      expect(DRESSING_KEYS, k).toContain(k);
      expect(a.frames).toBeGreaterThanOrEqual(2);
      expect(a.frames).toBeLessThanOrEqual(3);
    }
    for (const a of Object.values(WORLD_IDLE)) expect(a.frames === 2 || a.frames === 3).toBe(true);
    for (const k of ['dr_banner_blue', 'dr_lantern', 'dr_tallgrass_b']) expect(DRESSING_IDLE[k]).toBeDefined();
    for (const k of ['tree', 'pine', 'obj_campfire', 'portal_door']) expect(WORLD_IDLE[k]).toBeDefined();
    // mirrorable plants carry a mirrored lean cell (flipped images lean downwind on screen too)
    for (const k of ['tree', 'darktree~2', 'duskwillow', 'reeds']) expect(WORLD_IDLE[k].mirror).toBe(2);
    for (const k of ['dr_tallgrass_a', 'dr_reeds']) expect(DRESSING_IDLE[k].mirror).toBe(2);
    for (const a of [...Object.values(WORLD_IDLE), ...Object.values(DRESSING_IDLE)])
      if (a.mirror !== undefined) {
        expect(a.kind).toBe('sway');
        expect(a.mirror).toBeGreaterThanOrEqual(a.frames);
        expect(a.mirror).toBeLessThan(SWAY_CELLS);
      }
    expect([0, 1, 2].map(swayLean)).toEqual([0, 1, -1]);
  });

  it('frames stay in range; sway follows gust bands, banners wave, flames flicker without a steady loop', () => {
    const seen = (anim: { frames: number; kind: 'wave' | 'flicker' | 'flame' | 'sway' }, h: number) => {
      const out = new Map<number, number>();
      for (let t = 0; t < 30; t += 0.03) {
        const f = idleFrame(anim, t, 300, 200, h);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThan(anim.frames);
        out.set(f, (out.get(f) ?? 0) + 1);
      }
      return out;
    };
    const sway = seen({ frames: 2, kind: 'sway' }, 77);
    expect(sway.size).toBe(2);
    expect(seen({ frames: 3, kind: 'wave' }, 5).size).toBe(3);
    const flick = seen({ frames: 3, kind: 'flicker' }, 9);
    expect(flick.get(0)! / [...flick.values()].reduce((a, b) => a + b, 0)).toBeGreaterThan(0.45); // mostly still
    expect(flick.size).toBe(3);
    expect(seen({ frames: 3, kind: 'flame' }, 3).size).toBe(3);
    // neighbours sway in a travelling band: at one instant, trees 300 px apart can disagree
    let differ = 0;
    for (let t = 0; t < 20; t += 0.25) if (idleFrame({ frames: 2, kind: 'sway' }, t, 0, 0, 0) !== idleFrame({ frames: 2, kind: 'sway' }, t, 300, 0, 0)) differ++;
    expect(differ).toBeGreaterThan(5);
    for (let t = 0; t < 30; t += 0.1) {
      expect(gust(t)).toBeGreaterThanOrEqual(0.29);
      expect(gust(t)).toBeLessThanOrEqual(1.01);
      expect(windWave(t, 10, 10)).toBeGreaterThanOrEqual(0);
    }
  });

  it('banner wave shifts cloth rows by whole px within -1..1, still at frame 0', () => {
    for (let u = 0; u <= 1; u += 0.05) {
      expect(clothShift(0, u)).toBe(0);
      for (const f of [1, 2]) expect([0, 1, -1]).toContain(clothShift(f, u));
    }
    expect(clothShift(1, 0.9)).toBe(1);
    expect(clothShift(2, 0.5)).toBe(1);
  });
});

describe('dressing jitter and flips (grids never read)', () => {
  const ids = ['vale.greenmeadow', 'vale.hearthvale', 'rift.riftmarch', 'vale.mirror_lake', 'vale.gloomwood', 'vale.hollow_barrow.1'];

  it('is deterministic and keeps every item on a walkable, non-path tile (pebbles excepted)', () => {
    for (const id of ids) {
      const cm = map(id);
      const a = planDressing(cm);
      expect(planDressing(cm)).toEqual(a);
      for (const d of a) {
        expect(Number.isInteger(d.x) && Number.isInteger(d.y), id).toBe(true);
        const tx = Math.floor(d.x / 32);
        const ty = Math.floor((d.y - 1) / 32);
        expect(tx >= 0 && ty >= 0 && tx < cm.w && ty < cm.h, `${id} ${d.key}`).toBe(true);
        const g = cm.ground[ty * cm.w + tx];
        expect(g === T.WATER || g === T.DEEP, `${id} ${d.key} on water`).toBe(false);
      }
    }
  });

  it('fence runs stay exact; banners and lanterns keep their facing', () => {
    for (const id of ['vale.greenmeadow', 'vale.hearthvale']) {
      const plan = planDressing(map(id));
      const fences = plan.filter((d) => d.key === 'dr_fence_h');
      expect(fences.length, id).toBeGreaterThan(0);
      for (const f of fences) expect(f.x % 32, id).toBe(16);
      for (const d of plan) if (d.key.startsWith('dr_banner')) expect(d.flipX ?? false).toBe(false);
      for (const d of plan) if (DRESSING_ALIGNED.has(d.key) && d.key !== 'dr_cobweb') expect(d.flipX ?? false).toBe(false);
    }
    // lit faces (light from the top-left) are never mirrored
    let lit = 0;
    for (const id of ['vale.greenmeadow', 'vale.hearthvale', 'rift.riftmarch', 'vale.greystone_quarry', 'rift.frost_shelf'])
      for (const d of planDressing(map(id)))
        if (DRESSING_LIT.has(d.key)) {
          lit++;
          expect(d.flipX ?? false, `${id} ${d.key}`).toBe(false);
        }
    expect(lit).toBeGreaterThan(20);
    expect(DRESSING_FACING.has('dr_lantern')).toBe(true);
  });

  it('repeated sprites never share one in-tile offset or one facing', () => {
    let items = 0;
    let flips = 0;
    for (const id of ids) {
      const plan = planDressing(map(id));
      const by = new Map<string, typeof plan>();
      for (const d of plan) {
        if (DRESSING_ALIGNED.has(d.key) || DRESSING_FACING.has(d.key) || DRESSING_LIT.has(d.key)) continue;
        items++;
        if (d.flipX) flips++;
        if (!by.has(d.key)) by.set(d.key, []);
        by.get(d.key)!.push(d);
      }
      for (const [key, list] of by) {
        if (list.length < 8) continue;
        const offsets = new Set(list.map((d) => `${d.x % 32},${d.y % 32}`));
        expect(offsets.size / list.length, `${id} ${key}`).toBeGreaterThan(0.4);
        const flipped = list.filter((d) => d.flipX).length / list.length;
        expect(flipped, `${id} ${key}`).toBeGreaterThan(0.05);
        expect(flipped, `${id} ${key}`).toBeLessThan(0.95);
      }
    }
    // a fair seeded coin over thousands of items
    expect(flips / items).toBeGreaterThan(0.42);
    expect(flips / items).toBeLessThan(0.58);
    expect(DRESSING_JITTER).toBe(4);
  });
});

describe('air layout after a tier round trip', () => {
  it('parking at density 0 and coming back wakes the whole pool', () => {
    const p = ambientProfile({ biome: 'storm', flags: [] });
    const s = new AirSim(p.air, 1, p.wind);
    s.layout(PHONE, 1);
    const n = s.live;
    s.layout(PHONE, 0);
    expect(s.live).toBe(0);
    s.layout(PHONE, 1);
    expect(s.live).toBe(n);
  });
});
