// World v2 content: the authored maps in src/data/world.ts against the SPEC §7.3 / §7.4 manifest and the §7.2 rules.
import { describe, expect, it } from 'vitest';
import { compileMap, mapSizeTiles } from '../src/core/world/compile';
import { buildPortalGraph, routeMaps } from '../src/core/world/graph';
import type { Biome, MapDef, MapKind, NodeKind, ObjectKind, PortalDef, PortalGate, PortalReveal } from '../src/core/world/types';
import { spawnWarnings, validateMap, validateWorld } from '../src/core/world/validate';
import { MAPS, REGIONS } from '../src/data/world';

type Row = [id: string, kind: MapKind, size: string, biome: Biome, band: [number, number] | null, cell: string, portals: string];

// SPEC §7.3. Portals: "<id>><dest>" with the region prefix omitted for same-region destinations.
const MANIFEST: Row[] = [
  ['vale.hearthvale', 'town', '40x32', 'town', null, '2,2', 'west>greenmeadow#east north>mirror_lake#south east>greystone_quarry#west south>gloomwood#north'],
  ['vale.greenmeadow', 'field', '56x44', 'meadow', [1, 3], '1,2', 'east>hearthvale#west north>mirror_lake#southwest'],
  ['vale.mirror_lake', 'field', '64x44', 'lake', [2, 4], '2,1', 'south>hearthvale#north southwest>greenmeadow#north northeast>windcrest_hill#southwest islet>lake_islet#shore'],
  ['vale.lake_islet', 'secret', '16x16', 'lake', [3, 3], '2,0', 'shore>mirror_lake#islet'],
  ['vale.windcrest_hill', 'field', '56x48', 'hill', [4, 6], '3,1', 'southwest>mirror_lake#northeast south>greystone_quarry#north falls>falls_hollow#mouth'],
  ['vale.falls_hollow', 'secret', '20x20', 'glade', [6, 6], '4,0', 'mouth>windcrest_hill#falls'],
  ['vale.greystone_quarry', 'field', '64x48', 'quarry', [3, 6], '3,2', 'west>hearthvale#east north>windcrest_hill#south south>cinder_fields#north depths>quarry_depths.1#entrance shaft>collapsed_shaft#ladder'],
  ['vale.collapsed_shaft', 'secret', '16x16', 'cave', [5, 5], '4,1', 'ladder>greystone_quarry#shaft'],
  ['vale.quarry_depths.1', 'dungeon', '40x40', 'cave', [5, 7], '4,2', 'entrance>greystone_quarry#depths down>quarry_depths.2#up'],
  ['vale.quarry_depths.2', 'dungeon', '40x40', 'cave', [6, 8], '4,2', 'up>quarry_depths.1#down down>quarry_depths.3#up'],
  ['vale.quarry_depths.3', 'arena', '24x24', 'cave', [9, 9], '4,2', 'up>quarry_depths.2#down'],
  ['vale.gloomwood', 'field', '64x48', 'grove', [5, 7], '2,3', 'north>hearthvale#south east>cinder_fields#west barrow>hollow_barrow.1#entrance glade>moonlit_glade#path'],
  ['vale.moonlit_glade', 'secret', '24x24', 'glade', [7, 7], '1,3', 'path>gloomwood#glade'],
  ['vale.hollow_barrow.1', 'dungeon', '40x40', 'crypt', [7, 8], '2,4', 'entrance>gloomwood#barrow down>hollow_barrow.2#up'],
  ['vale.hollow_barrow.2', 'dungeon', '40x40', 'crypt', [8, 9], '2,4', 'up>hollow_barrow.1#down down>hollow_barrow.3#up'],
  ['vale.hollow_barrow.3', 'dungeon', '40x40', 'crypt', null, '2,4', 'up>hollow_barrow.2#down down>hollow_barrow.4#up vault>barrow_vault#door'],
  ['vale.barrow_vault', 'secret', '16x16', 'crypt', null, '2,4', 'door>hollow_barrow.3#vault'],
  ['vale.hollow_barrow.4', 'arena', '24x24', 'crypt', [11, 11], '2,4', 'up>hollow_barrow.3#down'],
  ['vale.cinder_fields', 'field', '56x44', 'ember', [6, 9], '3,3', 'west>gloomwood#east north>greystone_quarry#south east>stormbreak_approach#west outpost>emberwatch#gate'],
  ['vale.emberwatch', 'outpost', '24x20', 'ember', null, '3,4', 'gate>cinder_fields#outpost'],
  ['vale.stormbreak_approach', 'field', '40x32', 'plateau', [8, 10], '4,3', 'west>cinder_fields#east gate>stormbreak#entrance'],
  ['vale.stormbreak', 'arena', '24x24', 'plateau', [12, 12], '5,3', 'entrance>stormbreak_approach#gate rift>rift.riftgate_road#vale'],
  ['rift.riftgate_road', 'field', '64x48', 'storm', [11, 13], '0,1', 'vale>vale.stormbreak#rift town>riftmarch#west'],
  ['rift.riftmarch', 'town', '40x32', 'town', null, '1,1', 'west>riftgate_road#town north>frost_shelf#south east>basalt_steps#west south>dusk_orchard#north'],
  ['rift.frost_shelf', 'field', '64x48', 'frost', [12, 15], '1,0', 'south>riftmarch#north east>thunderhead_ridge#west'],
  ['rift.basalt_steps', 'field', '64x48', 'basalt', [14, 17], '2,1', 'west>riftmarch#east north>thunderhead_ridge#south'],
  ['rift.thunderhead_ridge', 'field', '64x48', 'storm', [16, 19], '2,0', 'west>frost_shelf#east south>basalt_steps#north'],
  ['rift.dusk_orchard', 'field', '64x48', 'dusk', [18, 21], '1,2', 'north>riftmarch#south'],
];

const REGION_MANIFEST = [
  { id: 'vale', name: 'Hearth Vale', levelBand: [1, 12], hub: 'vale.hearthvale' },
  { id: 'rift', name: 'Riftmarch', levelBand: [11, 21], hub: 'rift.riftmarch' },
];

/** Portal kinds stated in §7.3 (others are free). */
const PORTAL_KINDS: Record<string, PortalDef['kind']> = {
  'vale.mirror_lake#islet': 'hidden',
  'vale.windcrest_hill#falls': 'hidden',
  'vale.greystone_quarry#depths': 'door',
  'vale.greystone_quarry#shaft': 'hidden',
  'vale.quarry_depths.1#down': 'stairs',
  'vale.gloomwood#barrow': 'door',
  'vale.gloomwood#glade': 'hidden',
  'vale.hollow_barrow.3#vault': 'door',
  'vale.cinder_fields#outpost': 'door',
  'vale.stormbreak_approach#gate': 'edge',
  'vale.stormbreak#rift': 'edge',
};

/** Hidden portals: reveal look + accepted triggers (any one must be set). */
const HIDDEN: Record<string, { look: PortalReveal['look']; any: Partial<PortalReveal>[] }> = {
  'vale.mirror_lake#islet': { look: 'shimmer', any: [{ shape: 'dash' }] },
  'vale.windcrest_hill#falls': { look: 'fog', any: [{ element: 'wind' }] },
  'vale.greystone_quarry#shaft': { look: 'cracked_rock', any: [{ tag: 'heavy' }, { shape: 'nova' }] },
  'vale.gloomwood#glade': { look: 'glyph', any: [{ element: 'shadow' }, { element: 'holy' }] },
};

const GATED: Record<string, Omit<PortalGate, 'hint'>> = {
  'vale.hollow_barrow.3#vault': { elements: ['holy', 'shadow'] },
  'vale.stormbreak_approach#gate': { elementsKnown: 3 },
  'vale.stormbreak#rift': { flag: 'warden_thunderhoof' },
};

const WAYSTONES = [
  'vale.hearthvale',
  'vale.windcrest_hill',
  'vale.emberwatch',
  'vale.quarry_depths.1',
  'vale.quarry_depths.2',
  'vale.hollow_barrow.1',
  'vale.hollow_barrow.3',
  'vale.stormbreak_approach',
  'rift.riftgate_road',
  'rift.riftmarch',
];
const ALTARS = ['vale.hearthvale', 'vale.emberwatch', 'rift.riftmarch'];

interface Content {
  npcs?: string[];
  nodes?: Partial<Record<NodeKind, number>>;
  /** Object kinds that must be present (at least this many of each). */
  objects?: ObjectKind[];
  /** Exact set of spawn monster ids. */
  spawns?: string[];
  /** Exact monster totals where §7.4 gives "×N". */
  counts?: Record<string, number>;
}

// SPEC §7.4.
const CONTENT: Record<string, Content> = {
  'vale.hearthvale': { npcs: ['brann', 'alba', 'mirelle', 'tamsin'], objects: ['waystone', 'altar', 'signpost'] },
  'vale.greenmeadow': { npcs: ['hale', 'child_lio'], nodes: { herb: 6 }, objects: ['signpost'], spawns: ['jellop', 'pipsprout', 'jellop_monarch'] },
  'vale.mirror_lake': { npcs: ['pell'], nodes: { fishing: 4, herb: 3 }, spawns: ['puddlewisp', 'jellop', 'brinewisp'] },
  'vale.lake_islet': { nodes: { fishing: 2, sun_spring: 1 }, objects: ['chest'], spawns: ['puddlewisp'], counts: { puddlewisp: 3 } },
  'vale.windcrest_hill': { npcs: ['oru'], nodes: { wind_chime: 5 }, objects: ['waystone', 'wind_shrine'], spawns: ['gustling', 'sparkbug', 'galeplume'] },
  'vale.falls_hollow': { nodes: { wind_chime: 3 }, objects: ['chest'], spawns: ['gustling'], counts: { gustling: 4 } },
  'vale.greystone_quarry': { npcs: ['miner_gus'], nodes: { ore: 10 }, objects: ['signpost'], spawns: ['mossling', 'cragling', 'boulderback'] },
  'vale.collapsed_shaft': { nodes: { ore: 5 }, objects: ['chest'], spawns: ['cragling'], counts: { cragling: 4 } },
  'vale.quarry_depths.1': { nodes: { ore: 4 }, objects: ['waystone'], spawns: ['cragling', 'glowmite'] },
  'vale.quarry_depths.2': { nodes: { ore: 3 }, objects: ['waystone'], spawns: ['glowmite', 'cragling', 'geode_sentinel'] },
  'vale.quarry_depths.3': { spawns: ['ironroot_colossus'] },
  'vale.gloomwood': { nodes: { shadow_fungus: 6 }, objects: ['obelisk'], spawns: ['gloomcap', 'hollowshade', 'gloom_matriarch'] },
  'vale.moonlit_glade': { nodes: { sun_spring: 3 }, objects: ['statue'], spawns: ['moonmoth'], counts: { moonmoth: 3 } },
  'vale.hollow_barrow.1': { nodes: { shadow_fungus: 3 }, objects: ['waystone'], spawns: ['hollowshade', 'cairn_wraith'] },
  'vale.hollow_barrow.2': { spawns: ['cairn_wraith', 'hollowshade', 'crypt_keeper'] },
  'vale.hollow_barrow.3': { nodes: { sun_spring: 1 }, objects: ['waystone', 'campfire', 'chest'], spawns: [] },
  'vale.barrow_vault': { objects: ['chest', 'statue'], spawns: [] },
  'vale.hollow_barrow.4': { spawns: ['hollow_regent'] },
  'vale.cinder_fields': { npcs: ['scout_rhea'], nodes: { ember_vent: 6 }, objects: ['signpost'], spawns: ['emberkit', 'ashfly', 'emberkit_alpha'] },
  'vale.emberwatch': { npcs: ['vey', 'mirelle_2'], objects: ['waystone', 'altar', 'campfire'], spawns: [] },
  'vale.stormbreak_approach': { nodes: { storm_tree: 4 }, objects: ['waystone'], spawns: ['sparkbug', 'voltcalf', 'voltmane'] },
  'vale.stormbreak': { spawns: ['thunderhoof'] },
  'rift.riftgate_road': { npcs: ['korrin'], nodes: { storm_tree: 3, herb: 3 }, objects: ['waystone'], spawns: ['riftling', 'rift_stalker'] },
  'rift.riftmarch': { npcs: ['ione', 'dask'], objects: ['waystone', 'altar', 'signpost'], spawns: [] },
  'rift.frost_shelf': { nodes: { frost_crystal: 6, fishing: 3 }, spawns: ['frostling', 'rimefang', 'glacier_matron'] },
  'rift.basalt_steps': { nodes: { ember_vent: 5, ore: 4 }, spawns: ['basalt_crawler', 'cinder_toad', 'magma_brute'] },
  'rift.thunderhead_ridge': { nodes: { storm_tree: 5, wind_chime: 3 }, spawns: ['cloudray', 'thunderwing', 'tempest_drake'] },
  'rift.dusk_orchard': { nodes: { shadow_fungus: 4, sun_spring: 3 }, spawns: ['duskhound', 'gloamthorn', 'dusk_sovereign'] },
};

const IDS = MANIFEST.map((r) => r[0]);
const byId = new Map(MAPS.map((m) => [m.id, m]));
const regionOf = (id: string) => id.slice(0, id.indexOf('.'));
const resolveDest = (dest: string, from: string) => (/^(vale|rift)\./.test(dest) ? dest : `${regionOf(from)}.${dest}`);
const sorted = <T>(xs: readonly T[]) => [...xs].sort();

function mapOrFail(id: string): MapDef {
  const m = byId.get(id);
  expect(m, `map ${id} is missing from MAPS`).toBeDefined();
  return m!;
}

describe('world manifest (SPEC §7.3)', () => {
  it('has exactly the 28 manifest maps', () => {
    expect(MAPS.length).toBe(28);
    expect(sorted(MAPS.map((m) => m.id))).toEqual(sorted(IDS));
  });

  it('has the two regions with their hubs and maps', () => {
    expect(REGIONS.map((r) => ({ id: r.id, name: r.name, levelBand: r.levelBand, hub: r.hub }))).toEqual(REGION_MANIFEST);
    for (const r of REGIONS) expect(sorted(r.maps), r.id).toEqual(sorted(IDS.filter((id) => regionOf(id) === r.id)));
  });

  it.each(MANIFEST)('%s matches its manifest row', (id, kind, size, biome, band, cell, portals) => {
    const m = mapOrFail(id);
    const [w, h] = size.split('x').map(Number);
    const [cx, cy] = cell.split(',').map(Number);
    expect(m.region).toBe(regionOf(id));
    expect(m.kind).toBe(kind);
    expect(mapSizeTiles(m)).toEqual({ w, h });
    expect(m.biome).toBe(biome);
    expect(m.levelBand).toEqual(band);
    expect(m.worldCell).toEqual({ x: cx, y: cy });
    if (kind === 'town' || kind === 'outpost') expect(m.safety).toBe('safe');
    if (id === 'vale.hollow_barrow.3') expect(m.safety).toBe('pve');

    const want = Object.fromEntries(
      portals.split(' ').map((s) => {
        const [pid, dest] = s.split('>');
        return [pid, resolveDest(dest, id)];
      }),
    );
    expect(Object.fromEntries(m.portals.map((p) => [p.id, `${p.to.map}#${p.to.portal}`]))).toEqual(want);

    for (const p of m.portals) {
      const key = `${id}#${p.id}`;
      if (PORTAL_KINDS[key]) expect(p.kind, key).toBe(PORTAL_KINDS[key]);
      const hidden = HIDDEN[key];
      if (hidden) {
        expect(p.reveal?.look, key).toBe(hidden.look);
        const reveal = (p.reveal ?? {}) as Record<string, unknown>;
        const ok = hidden.any.some((c) => Object.entries(c).every(([k, v]) => reveal[k] === v));
        expect(ok, `${key} reveal trigger`).toBe(true);
      } else {
        expect(p.kind, key).not.toBe('hidden');
        expect(p.reveal, key).toBeUndefined();
      }
      const gate = GATED[key];
      if (gate) {
        expect(p.gate, key).toBeDefined();
        expect(typeof p.gate!.hint, key).toBe('string');
        if (gate.elements) expect(sorted(p.gate!.elements ?? []), key).toEqual(sorted(gate.elements));
        if (gate.elementsKnown !== undefined) expect(p.gate!.elementsKnown, key).toBe(gate.elementsKnown);
        if (gate.flag) expect(p.gate!.flag, key).toBe(gate.flag);
      } else {
        expect(p.gate, key).toBeUndefined();
      }
    }

    const objs = (m.objects ?? []).map((o) => o.kind);
    expect(objs.includes('waystone'), `${id} waystone`).toBe(WAYSTONES.includes(id));
    expect(objs.includes('altar'), `${id} altar`).toBe(ALTARS.includes(id));
  });
});

describe('world content (SPEC §7.4)', () => {
  it.each(IDS)('%s has its NPCs, nodes, objects and spawns', (id) => {
    const m = mapOrFail(id);
    const c = CONTENT[id];
    expect(sorted((m.npcs ?? []).map((n) => n.npc))).toEqual(sorted(c.npcs ?? []));
    const nodes: Record<string, number> = {};
    for (const n of m.nodes ?? []) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
    expect(nodes).toEqual(c.nodes ?? {});
    const objs = (m.objects ?? []).map((o) => o.kind);
    for (const k of new Set(c.objects ?? [])) {
      const need = (c.objects ?? []).filter((x) => x === k).length;
      expect(objs.filter((x) => x === k).length, `${id} object ${k}`).toBeGreaterThanOrEqual(need);
    }
    if (c.spawns) expect(sorted([...new Set(m.spawns.map((s) => s.monster))])).toEqual(sorted(c.spawns));
    for (const [monster, total] of Object.entries(c.counts ?? {})) {
      expect(m.spawns.filter((s) => s.monster === monster).reduce((a, s) => a + s.count, 0), `${id} ${monster}`).toBe(total);
    }
  });
});

describe('world rules (SPEC §7.2)', () => {
  it.each(IDS)('%s compiles and passes validateMap', (id) => {
    const m = mapOrFail(id);
    const cm = compileMap(m);
    expect(cm.w * cm.h).toBe(cm.ground.length);
    for (const p of m.portals) expect(cm.arrivals[p.id], `${id} arrival ${p.id}`).toBeDefined();
    expect(validateMap(m)).toEqual([]);
  });

  it('passes validateWorld', () => {
    expect(validateWorld(MAPS, REGIONS)).toEqual([]);
  });

  it('keeps every spawn square on its centre\'s side of walls and cliffs (spawnWarnings)', () => {
    expect(MAPS.flatMap((m) => spawnWarnings(m).map((w) => `${m.id}: ${w}`))).toEqual([]);
  });

  it('routes from the vale hub to the Riftmarch hub', () => {
    const route = routeMaps(buildPortalGraph(MAPS), 'vale.hearthvale', 'rift.riftmarch');
    expect(route).not.toBeNull();
    // hearthvale -> (quarry | gloomwood) -> cinder_fields -> stormbreak_approach -> stormbreak -> riftgate_road -> riftmarch
    expect(route!.length).toBe(6);
    expect(route!.slice(2).map((s) => s.map)).toEqual([
      'vale.cinder_fields',
      'vale.stormbreak_approach',
      'vale.stormbreak',
      'rift.riftgate_road',
    ]);
  });
});
