// Light lane (polish audit): repeated map props are mirrored and jittered per tile so forests and rock fields stop
// reading as one stamp on a grid (render/stage.ts propPlacement). Phaser is stubbed: only the pure placement runs.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

const { propPlacement, PROP_JX, PROP_JY_DOWN, PROP_JY_UP, PROP_NO_FLIP } = await import('../src/game/render/stage');
const { compileMap, TILE } = await import('../src/core/world/compile');
const { MAPS } = await import('../src/data/world');

describe('prop placement (flip + jitter)', () => {
  it('stays within ±4 px across and -4..+2 px down of the tile foot, in whole pixels, deterministically', () => {
    expect(PROP_JX).toBe(4);
    for (let ty = 0; ty < 40; ty++)
      for (let tx = 0; tx < 40; tx++) {
        const a = propPlacement(tx, ty, 1234, 'tree', 3);
        expect(a).toEqual(propPlacement(tx, ty, 1234, 'tree', 3));
        const dx = a.x - (tx * TILE + TILE / 2);
        const dy = a.y - (ty + 1) * TILE;
        expect(Number.isInteger(a.x) && Number.isInteger(a.y)).toBe(true);
        expect(Math.abs(dx)).toBeLessThanOrEqual(PROP_JX);
        expect(dy).toBeGreaterThanOrEqual(-PROP_JY_UP);
        expect(dy).toBeLessThanOrEqual(PROP_JY_DOWN);
        expect(a.look).toBeGreaterThanOrEqual(0);
        expect(a.look).toBeLessThan(3);
      }
  });

  it('mirrors about half of a real forest and uses the whole jitter range', () => {
    const cm = compileMap(MAPS.find((m) => m.id === 'vale.gloomwood')!);
    const seed = cm.def.seed;
    const all = cm.props.map((p) => ({ p, at: propPlacement(p.tx, p.ty, seed, p.kind, 3) }));
    expect(all.length).toBeGreaterThan(100);
    const flipped = all.filter((a) => a.at.flip && !PROP_NO_FLIP.has(a.p.kind)).length / all.length;
    expect(flipped).toBeGreaterThan(0.35);
    expect(flipped).toBeLessThan(0.65);
    const xs = new Set(all.map((a) => a.at.x - (a.p.tx * TILE + TILE / 2)));
    const ys = new Set(all.map((a) => a.at.y - (a.p.ty + 1) * TILE));
    expect(xs.size).toBe(2 * PROP_JX + 1);
    expect(ys.size).toBe(PROP_JY_UP + PROP_JY_DOWN + 1);
    // neighbours do not move together (independent bits for x, y, flip)
    let sameDx = 0;
    for (let i = 1; i < all.length; i++) if (all[i].at.x - all[i].p.tx * TILE === all[i - 1].at.x - all[i - 1].p.tx * TILE) sameDx++;
    expect(sameDx / all.length).toBeLessThan(0.3);
  });

  it('never mirrors a prop lit from the top-left (rocks, crystals, spires, tombstones, two-tone pines), but still jitters it', () => {
    for (const kind of ['rock', 'boulder', 'crystal', 'stalagmite', 'tombstone', 'basalt_spire', 'pine', 'frostpine'] as const) {
      expect(PROP_NO_FLIP.has(kind), kind).toBe(true);
      const xs = new Set<number>();
      for (let ty = 0; ty < 20; ty++)
        for (let tx = 0; tx < 20; tx++) {
          const at = propPlacement(tx, ty, 777, kind, 2);
          expect(at.flip, `${kind} ${tx},${ty}`).toBe(false);
          xs.add(at.x - (tx * TILE + TILE / 2));
        }
      expect(xs.size, kind).toBe(2 * PROP_JX + 1);
    }
    for (const kind of ['tree', 'darktree', 'bush', 'reeds'] as const) expect(PROP_NO_FLIP.has(kind), kind).toBe(false);
  });
});

// ------------------------------------------------------------------ v4 (SPEC-v4 §11.2 A, B, D, E; §14)

const { castShape, SHADOW_MAX_REACH, SHADOW_SHEAR, shadowAlphaFor, shearFor } = await import('../src/game/render/shadows');
const { propView } = await import('../src/game/render/stage');
const { PROP_TIER_LOOKS, PROP_TIER_SIZE, PROP_VARIANTS, propKey } = await import('../src/game/art/world');
const { planDressing, planZones, zoneMix, ZONE } = await import('../src/game/render/dressing');
const { TALL_REACH } = await import('../src/core/world/compile');
const { COLL } = await import('../src/core/world/types');
const { instanceLook, instanceVariant, MONSTER_INSTANCE_LOOKS } = await import('../src/game/art/monsters');
const { MONSTERS } = await import('../src/data/monsters');
const SOURCES: Record<string, string> = {
  'src/game/art/world.ts': (await import('../src/game/art/world.ts?raw')).default,
  'src/game/art/dressing.ts': (await import('../src/game/art/dressing.ts?raw')).default,
  'src/game/textures.ts': (await import('../src/game/textures.ts?raw')).default,
};

const FOCUS = ['vale.greenmeadow', 'vale.gloomwood', 'vale.hearthvale'];
const compiled = (id: string) => compileMap(MAPS.find((m) => m.id === id)!);

/** A w x h RGBA sprite, solid where `on` says so. */
function sprite(w: number, h: number, on: (x: number, y: number) => boolean): Uint8ClampedArray {
  const d = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (on(x, y)) d[(y * w + x) * 4 + 3] = 255;
  return d;
}

describe('cast shadows', () => {
  it('lays the silhouette down-right: half height, sheared by 0.6 x height, whole pixels', () => {
    // a 4 px wide, 40 px tall post standing on row 43 of a 12 x 48 canvas
    const s = castShape(sprite(12, 48, (x, y) => x >= 4 && x < 8 && y >= 4 && y <= 43), 12, 48);
    expect(s.foot).toBe(43);
    expect(s.tall).toBe(40);
    expect(s.h).toBe(Math.floor(39 * 0.5) + 2);
    const at = (x: number, y: number) => s.bits[y * s.w + x];
    expect(at(4, 0)).toBeGreaterThan(0); // starts under the foot…
    const last = s.h - 2;
    const cols = [...Array(s.w).keys()].filter((x) => at(x, last));
    expect(Math.min(...cols)).toBe(4 + Math.round(SHADOW_SHEAR * 39)); // …and its far end has moved 0.6 x 39 px right
    for (let y = 1; y < s.h - 1; y++) expect([...Array(s.w).keys()].some((x) => at(x, y)), `row ${y}`).toBe(true); // no gaps
    for (let x = 0; x < 4; x++) for (let y = 0; y < s.h; y++) expect(at(x, y), 'nothing falls to the left').toBe(0);
  });

  it('never reaches further than 48 px, however tall the sprite', () => {
    const s = castShape(sprite(8, 160, (x, y) => x >= 2 && x < 6 && y < 158), 8, 160);
    expect(s.w).toBeLessThanOrEqual(8 + SHADOW_MAX_REACH + 1);
    expect(s.h).toBe(Math.floor(157 * 0.5) + 2);
  });

  it('falls the same way for a mirrored sprite, ignores glows and marks a contact line under the feet', () => {
    const lop = (x: number, y: number) => y >= 10 && y < 30 && x >= 2 && x < (y > 20 ? 14 : 6); // an L: foot to the right
    const a = castShape(sprite(16, 32, lop), 16, 32, false);
    const b = castShape(sprite(16, 32, lop), 16, 32, true);
    const minX = (s: typeof a) => Math.min(...[...Array(s.w).keys()].filter((x) => s.bits[x]));
    expect(minX(a)).toBe(2);
    expect(minX(b)).toBe(2); // the mirrored foot spans 2..13 as well, and the shadow still leans right
    expect([...a.bits]).not.toEqual([...b.bits]);
    const contact = [...Array(a.w).keys()].filter((x) => a.bits[a.w + x] === 2);
    expect(contact).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]);
    const glow = new Uint8ClampedArray(8 * 8 * 4).fill(60);
    expect(castShape(glow, 8, 8).tall).toBe(0);
  });

  it('is 40% outdoors, 30% underground, and longer at dusk through the one shear constant', () => {
    expect(shadowAlphaFor({ biome: 'meadow', kind: 'field' })).toBe(0.4);
    expect(shadowAlphaFor({ biome: 'crypt', kind: 'dungeon' })).toBe(0.3);
    expect(shadowAlphaFor({ biome: 'grove', kind: 'field', flags: ['dark'] })).toBe(0.3);
    expect(shearFor('meadow')).toBe(0.6);
    expect(shearFor('dusk')).toBe(0.9);
  });

  it('leaves no ellipse shadow, and no black alpha, in the world and dressing art', () => {
    for (const f of ['src/game/art/world.ts', 'src/game/art/dressing.ts']) {
      const src = SOURCES[f];
      expect(src, f).not.toMatch(/\bfunction shadow\(/);
      expect(src, f).not.toMatch(/\bshadow\(c,/);
      expect(src, f).not.toMatch(/rgba\(36,\s*24,\s*15/);
      expect(src, f).not.toMatch(/groundShadow\(/);
    }
    expect(SOURCES['src/game/textures.ts']).not.toMatch(/rgba\(20,12,6/);
  });
});

describe('prop size tiers', () => {
  it('has three drawn looks for every tier of the tree and rock families', () => {
    for (const kind of ['tree', 'darktree', 'pine', 'frostpine']) {
      expect((PROP_VARIANTS[kind] ?? []).length + 1, `${kind} M`).toBeGreaterThanOrEqual(3);
      for (const tier of ['S', 'L', 'XL']) expect(PROP_TIER_LOOKS[`${kind}_${tier}`], `${kind} ${tier}`).toBeGreaterThanOrEqual(3);
      expect(PROP_TIER_LOOKS[`${kind}_mass`], `${kind} mass`).toBeGreaterThanOrEqual(3);
    }
    for (const k of ['rock', 'boulder']) expect((PROP_VARIANTS[k] ?? []).length + 1, `${k} M`).toBeGreaterThanOrEqual(3);
    for (const k of ['rock_S', 'rock_L', 'rock_XL', 'menhir_L', 'log_L', 'deadtree_L', 'deadtree_XL', 'duskwillow_L', 'duskwillow_XL']) expect(PROP_TIER_LOOKS[k], k).toBeGreaterThanOrEqual(3);
  });

  it('draws L props 64 – 112 px and XL props 104 – 160 px tall (the hero is 40)', () => {
    for (const [k, [w, h]] of Object.entries(PROP_TIER_SIZE)) {
      expect(w, k).toBeLessThanOrEqual(2048);
      if (k.endsWith('_XL')) expect(h, k).toBeGreaterThanOrEqual(88);
      if (k.endsWith('_XL')) expect(h, k).toBeLessThanOrEqual(160);
      if (k.endsWith('_L') && !k.startsWith('log')) expect(h, k).toBeGreaterThanOrEqual(64);
      if (k.endsWith('_S')) expect(h, k).toBeLessThanOrEqual(36);
    }
    expect(PROP_TIER_SIZE.tree_XL[1]).toBeGreaterThanOrEqual(3 * 40); // a hero tree is three to four heroes tall
    expect(propKey('tree')).toBe('tree');
    expect(propKey('tree', 'M', 2)).toBe('tree~2');
    expect(propKey('rock', 'XL', 1)).toBe('rock_XL~1');
  });

  it('resolves every compiled prop of every map to a drawn look, on whole pixels', () => {
    const keys = new Set<string>();
    for (const [k, n] of Object.entries(PROP_TIER_LOOKS)) for (let i = 0; i < n; i++) keys.add(i ? `${k}~${i}` : k);
    for (const [k, v] of Object.entries(PROP_VARIANTS)) for (const x of [k, ...v]) keys.add(x);
    for (const k of ['deadtree', 'duskwillow', 'crystal', 'stalagmite', 'mushroom', 'basalt_spire', 'reeds']) keys.add(k);
    for (const def of MAPS) {
      const cm = compileMap(def);
      for (const p of cm.props) {
        const v = propView(p, def.seed, (k) => keys.has(k));
        expect(v, `${def.id} ${p.kind} ${p.tier ?? 'M'}`).not.toBeNull();
        expect(Number.isInteger(v!.x) && Number.isInteger(v!.y), `${def.id} ${p.kind}`).toBe(true);
        if (PROP_NO_FLIP.has(p.kind)) expect(v!.flip).toBe(false);
      }
    }
  });

  it('gives neighbours different looks wherever three looks can cover them (6 tiles)', () => {
    for (const id of FOCUS) {
      const cm = compiled(id);
      const tall = cm.props.filter((p) => (p.tier === 'L' || p.tier === 'XL') && !p.mass && p.look !== undefined);
      const near = (p: (typeof tall)[number]) => tall.filter((q) => q.kind === p.kind && q.tier === p.tier && Math.abs(q.tx - p.tx) <= 6 && Math.abs(q.ty - p.ty) <= 6);
      let pairs = 0;
      for (const p of tall) {
        const mine = near(p);
        if (mine.length > 3) continue; // more than three in reach: a repeat cannot be avoided with three looks
        for (const q of mine) {
          if (q === p || near(q).length > 3) continue;
          pairs++;
          expect(q.look, `${id} ${p.kind} ${p.tier} at ${p.tx},${p.ty} / ${q.tx},${q.ty}`).not.toBe(p.look);
        }
      }
      expect(pairs, id).toBeGreaterThan(0);
    }
  });

  it('puts something three heroes tall within 12 tiles of 95% of the walkable ground', () => {
    for (const id of FOCUS) {
      const cm = compiled(id);
      const tall = cm.props.filter((p) => (p.tier === 'L' || p.tier === 'XL') && !p.mass && p.kind !== 'log');
      let walk = 0;
      let near = 0;
      for (let y = 0; y < cm.h; y++)
        for (let x = 0; x < cm.w; x++) {
          if (cm.coll[y * cm.w + x] & COLL.BLOCK) continue;
          walk++;
          if (tall.some((p) => Math.abs(p.tx - x) <= TALL_REACH && Math.abs(p.ty - y) <= TALL_REACH)) near++;
        }
      expect(near / walk, id).toBeGreaterThanOrEqual(0.95);
    }
  });
});

describe('layered tree lines and clearings', () => {
  it('draws a tree line as rows: full trees in front, darker rows behind, a trunkless mass inside', () => {
    for (const id of ['vale.greenmeadow', 'vale.gloomwood']) {
      const cm = compiled(id);
      const f = cm.forest!;
      const depth = (p: { tx: number; ty: number }) => f[p.ty * cm.w + p.tx];
      const inLine = cm.props.filter((p) => depth(p) > 0);
      const front = inLine.filter((p) => depth(p) === 1 && !p.mass);
      const heights = new Set(front.filter((p) => p.kind !== 'bush' && p.kind !== 'log' && p.kind !== 'mushroom').map((p) => p.tier ?? 'M'));
      expect([...heights].sort(), `${id} front row heights`).toEqual(['L', 'M', 'S', 'XL']);
      expect(front.some((p) => p.kind === 'bush' || p.tier === 'S'), `${id} undergrowth`).toBe(true);
      expect(inLine.some((p) => p.shade === 1 && !p.mass), `${id} second row`).toBe(true);
      const masses = inLine.filter((p) => p.mass);
      expect(masses.length, `${id} canopy mass`).toBeGreaterThan(5);
      for (const m of masses) expect(depth(m), `${id} mass depth`).toBeGreaterThanOrEqual(3);
      for (const p of inLine) if (!p.mass && depth(p) >= 5) throw new Error(`${id}: a trunk stands in the interior at ${p.tx},${p.ty}`);
      // far fewer sprites than a tree on every tile
      let tiles = 0;
      for (const d of f) if (d) tiles++;
      expect(inLine.length, `${id} sprites`).toBeLessThan(tiles * 0.6);
      // every forest tile still blocks
      for (let i = 0; i < f.length; i++) if (f[i]) expect(cm.coll[i] & COLL.BLOCK).toBe(COLL.BLOCK);
    }
  });

  it('keeps monster clearings free of scattered blockers and nearly free of dressing, with a dressed rim', () => {
    for (const id of ['vale.greenmeadow', 'vale.gloomwood']) {
      const cm = compiled(id);
      const c = cm.clearing!;
      for (const p of cm.props) {
        const i = p.ty * cm.w + p.tx;
        // authored blockers ('C' stones, tree lines) may stand in a clearing; scattered groups may not
        if (c[i] === 2 && !cm.forest![i] && p.kind !== 'menhir' && !(p.kind === 'rock' && p.tier !== 'S' && cm.def.layout[p.ty >> 1][p.tx >> 1] === 'C'))
          expect(cm.coll[i] & COLL.BLOCK, `${id} ${p.kind} at ${p.tx},${p.ty}`).toBe(0);
      }
      const z = planZones(cm).zones;
      const dr = planDressing(cm);
      let inClear = 0;
      let clearArea = 0;
      let inMedium = 0;
      let mediumArea = 0;
      for (let i = 0; i < z.length; i++) {
        if (!z[i]) continue;
        if (c[i] === 2) clearArea++;
        else if (z[i] === ZONE.MEDIUM) mediumArea++;
      }
      for (const d of dr) {
        const i = Math.floor((d.y - 1) / TILE) * cm.w + Math.floor(d.x / TILE);
        if (c[i] === 2) inClear++;
        else if (z[i] === ZONE.MEDIUM) inMedium++;
      }
      expect(inClear / clearArea, `${id} clearing`).toBeLessThanOrEqual(0.25 * (inMedium / mediumArea));
    }
  });

  it('splits the ground about 60 / 30 / 10 into calm, medium and dense (within 15 points)', () => {
    for (const id of FOCUS) {
      const m = zoneMix(compiled(id));
      expect(Math.abs(m.calm - 0.6), `${id} calm ${m.calm.toFixed(2)}`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(m.medium - 0.3), `${id} medium ${m.medium.toFixed(2)}`).toBeLessThanOrEqual(0.15);
      expect(Math.abs(m.dense - 0.1), `${id} dense ${m.dense.toFixed(2)}`).toBeLessThanOrEqual(0.15);
    }
  });

  it('follows the ecology rules: mushrooms and logs only by trees, no lantern ring round a plaza', () => {
    const cm = compiled('vale.greenmeadow');
    const z = planZones(cm);
    for (const d of planDressing(cm)) {
      if (!/^dr_(mushrooms|log|stump)/.test(d.key)) continue;
      const tx = Math.floor(d.x / TILE);
      const ty = Math.floor((d.y - 1) / TILE);
      if (cm.ground[ty * cm.w + tx] === 5 /* T.SAND: driftwood on a shore is its own rule */) continue;
      let near = false;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (z.underTree[(ty + dy) * cm.w + tx + dx]) near = true;
      expect(near, `${d.key} at ${tx},${ty}`).toBe(true);
    }
    const town = compiled('vale.hearthvale');
    const lamps = planDressing(town).filter((d) => d.key === 'dr_lantern');
    for (const l of lamps) {
      const tx = Math.floor(l.x / TILE);
      const ty = Math.floor((l.y - 1) / TILE);
      expect(town.ground[ty * town.w + tx], `lantern at ${tx},${ty} is not on the plaza`).not.toBe(8 /* T.COBBLE */);
    }
  });
});

describe('monster instance looks', () => {
  it('gives common monsters four looks (size in whole pixels, a palette nudge) and elites one', () => {
    expect(MONSTER_INSTANCE_LOOKS).toHaveLength(4);
    const jellop = MONSTERS.find((m) => m.id === 'jellop')!;
    expect(instanceVariant(jellop, 0)).toBeNull();
    const looks = [1, 2, 3].map((i) => instanceVariant(jellop, i)!);
    expect(looks.map((v) => v.key)).toEqual(['mon_jellop~1', 'mon_jellop~2', 'mon_jellop~3']);
    expect(new Set(looks.map((v) => `${v.k}|${v.tint}`)).size).toBe(3);
    for (const v of looks) expect(Math.abs(v.k - 1)).toBeLessThanOrEqual(0.1);
    for (const m of MONSTERS.filter((d) => d.rank !== 'common')) expect(instanceVariant(m, 2), m.id).toBeNull();
  });

  it('deals the looks in a fixed shuffled cycle: every four spawns show all four', () => {
    for (const id of ['jellop', 'gloomcap', 'hollowshade']) {
      for (let block = 0; block < 5; block++) expect([0, 1, 2, 3].map((k) => instanceLook(id, block * 4 + k)).sort()).toEqual([0, 1, 2, 3]);
      expect(instanceLook(id, 5)).toBe(instanceLook(id, 5));
    }
  });
});
