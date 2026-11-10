// World v2 core: compiler, pathfinding, portal graph and validator on synthetic MapDefs (SPEC §7).
import { describe, expect, it } from 'vitest';
import {
  BIOMES,
  MACRO_LEGEND,
  STRUCTURE_FOOTPRINT,
  TILE,
  arrivalTile,
  compileMap,
  isBlocked,
  isBlockedPx,
  mapSizeTiles,
  tileAt,
} from '../src/core/world/compile';
import { buildPortalGraph, isOpenPortal, portalKey, reachableMaps, routeMaps } from '../src/core/world/graph';
import { findPath, lineClear, nearestWalkable } from '../src/core/world/pathfinding';
import { T } from '../src/core/world/tiles';
import {
  COLL,
  type Biome,
  type CompiledMap,
  type Facing,
  type MapDef,
  type PortalDef,
  type PropKind,
  type RegionDef,
  type StructureKind,
} from '../src/core/world/types';
import { SPAWN_SPREAD, renderAscii, spawnWarnings, validateMap, validateWorld } from '../src/core/world/validate';

const fill = (cols: number, rows: number, ch = '.') => Array.from({ length: rows }, () => ch.repeat(cols));

function mk(over: Partial<MapDef> = {}): MapDef {
  return {
    id: 'test.a',
    name: 'Test',
    kind: 'secret',
    region: 'test',
    biome: 'meadow',
    seed: 7,
    levelBand: [1, 1],
    safety: 'pve',
    worldCell: { x: 0, y: 0 },
    layout: fill(8, 8),
    portals: [],
    spawns: [],
    decor: 0,
    ...over,
  };
}

function portal(
  id: string,
  facing: Facing,
  rect: [number, number, number, number],
  to: string,
  extra: Partial<PortalDef> = {},
): PortalDef {
  const [map, p] = to.split('#');
  const [tx, ty, w, h] = rect;
  return { id, facing, tx, ty, w, h, kind: 'edge', to: { map, portal: p }, ...extra };
}

const at = (cm: CompiledMap, x: number, y: number) => cm.coll[y * cm.w + x];
const tileOfPx = (p: { x: number; y: number }): [number, number] => [Math.floor(p.x / TILE), Math.floor(p.y / TILE)];
const propAt = (cm: CompiledMap, x: number, y: number) => cm.props.find((p) => p.tx === x && p.ty === y);
/** v4: a tree line blocks every hostable tile and is DRAWN as layered rows (cm.forest = the row depth), not a tree per tile. */
const inForest = (cm: CompiledMap, x: number, y: number) => (cm.forest?.[y * cm.w + x] ?? 0) > 0 && isBlocked(cm, x, y);

// ------------------------------------------------------------------ legend & biomes

const SPEC_BIOMES: Record<Biome, [number, number, PropKind, number]> = {
  meadow: [T.GRASS, T.FLOWERS, 'tree', T.CLIFF],
  lake: [T.GRASS, T.GRASS2, 'tree', T.CLIFF],
  hill: [T.HILL, T.GRASS2, 'pine', T.CLIFF],
  quarry: [T.STONE, T.GRASS2, 'pine', T.CLIFF],
  grove: [T.DARK, T.MOSS, 'darktree', T.CLIFF],
  glade: [T.GLADE, T.MOSS, 'duskwillow', T.CLIFF],
  ember: [T.EMBER, T.STONE, 'deadtree', T.CLIFF],
  plateau: [T.STONE, T.STORMGRASS, 'deadtree', T.CLIFF],
  town: [T.GRASS, T.FLOWERS, 'tree', T.CLIFF],
  cave: [T.CAVE, T.MOSS, 'stalagmite', T.CAVE_WALL],
  crypt: [T.CRYPT, T.CAVE, 'tombstone', T.CRYPT_WALL],
  frost: [T.SNOW, T.ICE, 'frostpine', T.CLIFF],
  basalt: [T.BASALT, T.EMBER, 'basalt_spire', T.CLIFF],
  storm: [T.STORMGRASS, T.HILL, 'pine', T.CLIFF],
  dusk: [T.DUSK, T.GLADE, 'duskwillow', T.CLIFF],
};

const LITERAL: Record<string, number> = {
  '=': T.PATH,
  '+': T.COBBLE,
  ':': T.SAND,
  o: T.STONE,
  g: T.GRASS,
  h: T.HILL,
  d: T.DARK,
  e: T.EMBER,
  '*': T.SNOW,
  i: T.ICE,
  c: T.CAVE,
  x: T.CRYPT,
  m: T.MOSS,
  l: T.DUSK,
  b: T.BRIDGE,
  L: T.LAVA,
  ' ': T.VOID,
  '~': T.DEEP,
  '-': T.WATER,
};
// Shore chars first and water last so no sand appears in this strip.
const ALL_CHARS = ['.', ',', 't', 'T', 'C', '#', ...Object.keys(LITERAL)];
const BLOCKING_CHARS = new Set(['T', 'C', '#', 'L', ' ', '~', '-']);

describe('macro legend & biomes', () => {
  it('covers exactly the SPEC §7.1 characters', () => {
    expect(Object.keys(MACRO_LEGEND).sort()).toEqual([...ALL_CHARS].sort());
  });

  it('matches the SPEC biome table', () => {
    for (const [biome, [ground, alt, tree, wall]] of Object.entries(SPEC_BIOMES) as [Biome, [number, number, PropKind, number]][]) {
      const b = BIOMES[biome];
      expect([b.ground, b.alt, b.tree, b.wall], biome).toEqual([ground, alt, tree, wall]);
      expect(b.decor.length, biome).toBeGreaterThan(0);
    }
    expect(Object.keys(BIOMES).sort()).toEqual(Object.keys(SPEC_BIOMES).sort());
  });

  it('compiles every legend char in every biome', () => {
    const layout = [ALL_CHARS.join(''), ALL_CHARS.join('')];
    for (const biome of Object.keys(BIOMES) as Biome[]) {
      const [ground, alt, tree, wall] = SPEC_BIOMES[biome];
      const cm = compileMap(mk({ biome, layout }));
      expect(cm.w).toBe(ALL_CHARS.length * 2);
      expect(cm.h).toBe(4);
      ALL_CHARS.forEach((ch, c) => {
        const want = ch === '.' ? ground : ch === ',' ? alt : ch === '#' ? wall : ch in LITERAL ? LITERAL[ch] : ground;
        for (let y = 0; y < 4; y++) {
          for (let x = c * 2; x < c * 2 + 2; x++) {
            const label = `${biome} '${ch}' (${x},${y})`;
            expect(tileAt(cm, x, y), label).toBe(want);
            expect(isBlocked(cm, x, y), label).toBe(BLOCKING_CHARS.has(ch) || (ch === 't' || ch === 'o' ? isBlocked(cm, x, y) : false));
            // a tree line where the biome's tree is a tree (layered rows), else one prop per tile as before
            if (ch === 'T') expect(inForest(cm, x, y) || propAt(cm, x, y)?.kind === tree, label).toBe(true);
            if (ch === '~' || ch === '-') expect(at(cm, x, y) & COLL.WATER, label).toBe(COLL.WATER);
            else expect(at(cm, x, y) & COLL.WATER, label).toBe(0);
          }
        }
      });
    }
  });

  it('throws clear errors on unequal rows and unknown chars', () => {
    expect(() => compileMap(mk({ layout: ['....', '...'] }))).toThrow(/row 1 has 3 chars, expected 4/);
    expect(() => compileMap(mk({ layout: ['..Q.', '....'] }))).toThrow(/unknown layout char "Q" at row 0, col 2/);
    expect(() => compileMap(mk({ layout: [] }))).toThrow(/layout is empty/);
  });

  it('turns biome ground next to water into sand only in shore biomes', () => {
    const layout = ['.....', '..~..', '..g..', '.....'];
    const meadow = compileMap(mk({ layout }));
    const quarry = compileMap(mk({ layout, biome: 'quarry' }));
    expect(tileAt(meadow, 3, 1)).toBe(T.SAND); // diagonal-adjacent counts
    expect(tileAt(meadow, 6, 2)).toBe(T.SAND);
    expect(tileAt(meadow, 0, 0)).toBe(T.GRASS);
    expect(tileAt(meadow, 4, 4)).toBe(T.GRASS); // explicit 'g' stays grass
    expect(tileAt(quarry, 3, 1)).toBe(T.STONE);
    expect(meadow.props).toEqual([]);
  });

  it('reports map size in tiles', () => {
    expect(mapSizeTiles(mk({ layout: fill(20, 16) }))).toEqual({ w: 40, h: 32 });
    const cm = compileMap(mk());
    expect(tileAt(cm, -1, 0)).toBe(T.VOID);
    expect(isBlocked(cm, 16, 0)).toBe(true);
    expect(isBlockedPx(cm, 5 * TILE + 3, 5 * TILE + 30)).toBe(false);
    expect(isBlockedPx(cm, -1, 10)).toBe(true);
  });
});

// ------------------------------------------------------------------ compile passes

describe('compileMap', () => {
  const busy = mk({
    kind: 'field',
    layout: [
      'tttt,,,,oooo....tttt,,,,oooo',
      ',,,,tttt....oooo,,,,TTTT....',
      'oooo....tttt,,,,....~~~~tttt',
      '....oooo,,,,tttt----....,,,,',
    ],
    decor: 2,
    paths: [
      [
        [0, 4],
        [30, 4],
        [54, 2],
      ],
    ],
    nodes: [{ id: 'n1', kind: 'herb', tx: 10, ty: 6 }],
    spawns: [{ monster: 'jellop', count: 3, cx: 40, cy: 3, r: 2 }],
  });

  it('is deterministic from def.seed', () => {
    const a = compileMap(busy);
    const b = compileMap(structuredClone(busy));
    expect(Array.from(b.ground)).toEqual(Array.from(a.ground));
    expect(Array.from(b.coll)).toEqual(Array.from(a.coll));
    expect(b.props).toEqual(a.props);
    expect(b.arrivals).toEqual(a.arrivals);
    expect(b.spawn).toEqual(a.spawn);
    expect(a.props.length).toBeGreaterThan(20);
    const c = compileMap({ ...busy, seed: 99 });
    expect(c.props).not.toEqual(a.props);
  });

  it('scales decor with def.decor', () => {
    const open = mk({ kind: 'field', layout: fill(32, 24, ',') });
    const none = compileMap({ ...open, decor: 0 }).props.length;
    const some = compileMap({ ...open, decor: 1 }).props.length;
    const lots = compileMap({ ...open, decor: 4 }).props.length;
    expect(none).toBe(0);
    expect(some).toBeGreaterThan(0);
    expect(lots).toBeGreaterThan(some);
  });

  it('paints 2-wide paths, bridging water and never crossing walls', () => {
    const def = mk({
      kind: 'field',
      layout: ['....~~~~..#.', '....~~~~..#.', '....~~~~..#.', '....~~~~..#.'],
      paths: [
        [
          [0, 3],
          [23, 3],
        ],
      ],
    });
    const cm = compileMap(def);
    for (const y of [3, 4]) {
      for (let x = 0; x < 8; x++) expect(tileAt(cm, x, y), `(${x},${y})`).toBe(T.PATH);
      for (let x = 8; x < 16; x++) {
        expect(tileAt(cm, x, y), `(${x},${y})`).toBe(T.BRIDGE);
        expect(at(cm, x, y) & (COLL.BLOCK | COLL.WATER), `(${x},${y})`).toBe(0);
      }
      expect(tileAt(cm, 20, y)).toBe(T.CLIFF);
      expect(isBlocked(cm, 20, y)).toBe(true);
      expect(tileAt(cm, 22, y)).toBe(T.PATH);
    }
    expect(tileAt(cm, 8, 2)).toBe(T.DEEP);
    expect(tileAt(cm, 0, 2)).toBe(T.GRASS); // outside the 2-wide strip
    // Without the path the river splits the map.
    expect(findPath(cm, 16, 3 * TILE, 18 * TILE, 3 * TILE)).not.toBeNull();
    expect(findPath(compileMap({ ...def, paths: [] }), 16, 3 * TILE, 18 * TILE, 3 * TILE)).toBeNull();
  });

  it('keeps props off paths (+1 margin) even in dense forest', () => {
    const cm = compileMap(mk({ layout: fill(8, 8, 'T'), paths: [[[0, 6], [15, 6]]] }));
    for (let x = 0; x < 16; x++) {
      for (const y of [5, 6, 7, 8]) expect(propAt(cm, x, y), `(${x},${y})`).toBeUndefined();
      expect(inForest(cm, x, 4)).toBe(true);
      expect(inForest(cm, x, 9)).toBe(true);
    }
  });

  it('blocks structure footprints and keeps the apron clear', () => {
    expect(STRUCTURE_FOOTPRINT).toEqual({
      smithy: { w: 4, h: 3 },
      chapel: { w: 4, h: 4 },
      hut: { w: 3, h: 3 },
      hall: { w: 6, h: 4 },
      house: { w: 3, h: 3 },
      tent: { w: 3, h: 2 },
      ruin: { w: 4, h: 3 },
      tower: { w: 2, h: 3 },
      well: { w: 1, h: 1 },
    });
    for (const kind of Object.keys(STRUCTURE_FOOTPRINT) as StructureKind[]) {
      const fp = STRUCTURE_FOOTPRINT[kind];
      const cm = compileMap(mk({ layout: fill(8, 8, 'T'), structures: [{ kind, tx: 4, ty: 4 }] }));
      for (let y = 4; y < 4 + fp.h; y++) {
        for (let x = 4; x < 4 + fp.w; x++) {
          expect(isBlocked(cm, x, y), `${kind} (${x},${y})`).toBe(true);
          expect(propAt(cm, x, y), `${kind} (${x},${y})`).toBeUndefined();
        }
      }
      for (let x = 4; x < 4 + fp.w; x++) {
        expect(propAt(cm, x, 4 + fp.h), `${kind} apron`).toBeUndefined();
        expect(isBlocked(cm, x, 4 + fp.h), `${kind} apron`).toBe(false);
      }
      expect(inForest(cm, 3, 4)).toBe(true);
      expect(inForest(cm, 4 + fp.w, 4)).toBe(true);
    }
  });

  it('forces portal rects walkable and reserves 2 tiles around them', () => {
    const cm = compileMap(
      mk({
        layout: ['########', ...fill(8, 7, 'T')],
        portals: [portal('north', 'n', [6, 0, 4, 1], 'test.b#south')],
      }),
    );
    for (let x = 6; x < 10; x++) {
      expect(at(cm, x, 0) & COLL.PORTAL).toBe(COLL.PORTAL);
      expect(isBlocked(cm, x, 0)).toBe(false);
      expect(tileAt(cm, x, 0)).toBe(T.GRASS);
    }
    expect(tileAt(cm, 5, 0)).toBe(T.CLIFF);
    for (let y = 0; y <= 2; y++) for (let x = 4; x <= 11; x++) expect(propAt(cm, x, y)).toBeUndefined();
    expect(inForest(cm, 8, 3)).toBe(true);
  });

  it('blocks node/object/NPC tiles and reserves their neighbours', () => {
    const cm = compileMap(
      mk({
        layout: fill(8, 8, 'T'),
        nodes: [{ id: 'ore1', kind: 'ore', tx: 4, ty: 4 }],
        objects: [{ id: 'sign', kind: 'signpost', tx: 10, ty: 4 }],
        npcs: [{ npc: 'hale', tx: 4, ty: 10 }],
        spawns: [{ monster: 'jellop', count: 1, cx: 11, cy: 11, r: 2 }],
      }),
    );
    for (const [ex, ey] of [
      [4, 4],
      [10, 4],
      [4, 10],
    ]) {
      expect(isBlocked(cm, ex, ey)).toBe(true);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(propAt(cm, ex + dx, ey + dy)).toBeUndefined();
      for (let dx = -1; dx <= 1; dx++) if (dx) expect(isBlocked(cm, ex + dx, ey)).toBe(false);
    }
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) expect(isBlocked(cm, 11 + dx, 11 + dy)).toBe(false);
    expect(inForest(cm, 7, 7)).toBe(true);
  });

  it('places arrivals 2 tiles inward from the rect centre, on walkable ground', () => {
    const def = mk({
      portals: [
        portal('north', 'n', [6, 0, 4, 1], 'x.y#a'),
        portal('south', 's', [6, 15, 4, 1], 'x.y#b'),
        portal('west', 'w', [0, 6, 1, 4], 'x.y#c'),
        portal('east', 'e', [15, 6, 1, 4], 'x.y#d'),
        portal('deep', 's', [6, 14, 4, 2], 'x.y#e', { kind: 'door' }),
      ],
    });
    expect(arrivalTile(def.portals[0])).toEqual([8, 2]);
    expect(arrivalTile(def.portals[1])).toEqual([8, 13]);
    expect(arrivalTile(def.portals[2])).toEqual([2, 8]);
    expect(arrivalTile(def.portals[3])).toEqual([13, 8]);
    expect(arrivalTile(def.portals[4])).toEqual([8, 12]); // 2-tall rect: one tile gap, same as a 2-tall north rect
    const cm = compileMap({ ...def, portals: def.portals.slice(0, 4) });
    for (const p of def.portals.slice(0, 4)) {
      const a = cm.arrivals[p.id];
      const [ax, ay] = tileOfPx(a);
      expect([ax, ay], p.id).toEqual(arrivalTile(p));
      expect(a).toEqual({ x: ax * TILE + 16, y: ay * TILE + 16 });
      expect(isBlocked(cm, ax, ay), p.id).toBe(false);
      expect(at(cm, ax, ay) & COLL.PORTAL, p.id).toBe(0);
    }
    expect(validateMap({ ...def, portals: def.portals.slice(0, 4) })).toEqual([]);
  });

  it('snaps a blocked arrival to the nearest walkable tile (and the validator flags it)', () => {
    const def = mk({
      layout: ['........', '.#......', ...fill(8, 6)],
      portals: [portal('west', 'w', [0, 0, 1, 4], 'x.y#a')],
    });
    const cm = compileMap(def);
    const [ax, ay] = tileOfPx(cm.arrivals.west);
    expect(isBlocked(cm, ax, ay)).toBe(false);
    expect(Math.abs(ax - 2) + Math.abs(ay - 2)).toBeLessThanOrEqual(2);
    expect(validateMap(def).join('\n')).toMatch(/portal west: arrival tile \(2,2\) is not walkable/);
  });

  it('spawns next to the first waystone, else near the map centre', () => {
    const withStone = compileMap(mk({ objects: [{ id: 'ws', kind: 'waystone', tx: 5, ty: 5 }] }));
    expect(tileOfPx(withStone.spawn)).toEqual([5, 6]);
    const blockedBelow = compileMap(
      mk({ layout: ['........', '........', '........', '..##....', ...fill(8, 4)], objects: [{ id: 'ws', kind: 'waystone', tx: 5, ty: 5 }] }),
    );
    expect(tileOfPx(blockedBelow.spawn)).toEqual([6, 5]);
    expect(tileOfPx(compileMap(mk()).spawn)).toEqual([8, 8]);
    const lake = compileMap(mk({ layout: ['........', '........', '........', '...~~...', '...~~...', ...fill(8, 3)] }));
    const [sx, sy] = tileOfPx(lake.spawn);
    expect(isBlocked(lake, sx, sy)).toBe(false);
  });

  it('marks every tile SAFE on safe maps only', () => {
    const safe = compileMap(mk({ safety: 'safe' }));
    const pve = compileMap(mk());
    expect(Array.from(safe.coll).every((c) => c & COLL.SAFE)).toBe(true);
    expect(Array.from(pve.coll).some((c) => c & COLL.SAFE)).toBe(false);
  });

  it('never lets seeded scatter cut a passage', () => {
    // Zig-zag 2-tile corridors of light woods / stony ground / alt ground.
    const layout = [
      'tttttttttttt',
      'tttttttttttt',
      '##########t#',
      'oooooooooooo',
      '#t##########',
      ',,,,,,,,,,,,',
      '##########t#',
      'tttttttttttt',
      '#o##########',
      'oooooooooooo',
      '##########o#',
      ',,,,,,,,,,,,',
    ];
    let scattered = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const def = mk({
        seed,
        kind: 'secret',
        biome: 'grove',
        layout,
        decor: 4,
        portals: [portal('north', 'n', [2, 0, 4, 1], 'x.y#a')],
        nodes: [{ id: 'far', kind: 'shadow_fungus', tx: 22, ty: 22 }],
        npcs: [{ npc: 'oru', tx: 12, ty: 10 }],
        spawns: [{ monster: 'gloomcap', count: 2, cx: 3, cy: 18, r: 1 }],
      });
      expect(validateMap(def), `seed ${seed}`).toEqual([]);
      scattered += compileMap(def).props.length;
    }
    expect(scattered).toBeGreaterThan(40 * 20);
  });
});

// ------------------------------------------------------------------ pathfinding

describe('pathfinding', () => {
  const cm = compileMap(
    mk({
      layout: ['........', '........', '..####..', '.....#..', '.....#..', '.....#..', '........', '........'],
    }),
  );

  it('routes around walls without cutting corners', () => {
    const path = findPath(cm, 7 * TILE + 16, 2 * TILE, 7 * TILE + 16, 9 * TILE + 16)!;
    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(1);
    expect(path[path.length - 1]).toEqual({ x: 7 * TILE + 16, y: 9 * TILE + 16 });
    let px = 7 * TILE + 16;
    let py = 2 * TILE;
    for (const p of path) {
      expect(isBlockedPx(cm, p.x, p.y)).toBe(false);
      expect(lineClear(cm, px, py, p.x, p.y)).toBe(true);
      px = p.x;
      py = p.y;
    }
  });

  it('returns [] when already there and null when enclosed or over the node cap', () => {
    expect(findPath(cm, 40, 40, 50, 50)).toEqual([]);
    const boxed = compileMap(mk({ layout: ['........', '.###....', '.#.#....', '.###....', ...fill(8, 4)] }));
    expect(findPath(boxed, 16, 16, 4 * TILE + 16, 4 * TILE + 16)).toBeNull();
    expect(findPath(cm, 16, 16, 15 * TILE, 15 * TILE, 5)).toBeNull();
  });

  it('finds the nearest walkable tile and tests straight lines', () => {
    expect(nearestWalkable(cm, 1, 1)).toEqual([1, 1]);
    const near = nearestWalkable(cm, 5, 4)!;
    expect(isBlocked(cm, near[0], near[1])).toBe(false);
    expect(Math.max(Math.abs(near[0] - 5), Math.abs(near[1] - 4))).toBe(1);
    expect(lineClear(cm, 16, 16, 15 * TILE, 16)).toBe(true);
    expect(lineClear(cm, 6 * TILE, 16, 6 * TILE, 15 * TILE)).toBe(false);
  });
});

// ------------------------------------------------------------------ graph

describe('portal graph', () => {
  const chain = (id: string, ports: PortalDef[]): MapDef => mk({ id, portals: ports });
  const maps = [
    chain('r.a', [portal('east', 'e', [15, 4, 1, 4], 'r.b#west'), portal('cave', 'n', [2, 2, 1, 1], 'r.d#cave', { kind: 'hidden' })]),
    chain('r.b', [portal('west', 'w', [0, 4, 1, 4], 'r.a#east'), portal('east', 'e', [15, 4, 1, 4], 'r.c#west')]),
    chain('r.c', [portal('west', 'w', [0, 4, 1, 4], 'r.b#east'), portal('east', 'e', [15, 4, 1, 4], 'r.d#west', { gate: { flag: 'k', hint: 'h' } })]),
    chain('r.d', [portal('west', 'w', [0, 4, 1, 4], 'r.c#east'), portal('cave', 's', [2, 2, 1, 1], 'r.a#cave', { kind: 'hidden' })]),
    chain('r.e', [portal('nowhere', 'w', [0, 4, 1, 4], 'r.zz#west')]),
  ];
  const graph = buildPortalGraph(maps);

  it('keys portals globally', () => {
    expect(portalKey('vale.greenmeadow', 'east')).toBe('vale.greenmeadow#east');
    expect(graph.portals.get('r.b#east')?.portal.to.map).toBe('r.c');
    expect(graph.out.get('r.e')).toEqual([]);
  });

  it('routes by fewest hops and respects canUse', () => {
    expect(routeMaps(graph, 'r.a', 'r.d')).toEqual([{ map: 'r.a', portal: 'cave' }]);
    expect(routeMaps(graph, 'r.a', 'r.d', (_m, p) => p.kind !== 'hidden')).toEqual([
      { map: 'r.a', portal: 'east' },
      { map: 'r.b', portal: 'east' },
      { map: 'r.c', portal: 'east' },
    ]);
    expect(routeMaps(graph, 'r.a', 'r.d', (_m, p) => isOpenPortal(p))).toBeNull();
    expect(routeMaps(graph, 'r.d', 'r.b', (m) => m.id !== 'r.c')).toEqual([
      { map: 'r.d', portal: 'cave' },
      { map: 'r.a', portal: 'east' },
    ]);
    expect(routeMaps(graph, 'r.b', 'r.b')).toEqual([]);
    expect(routeMaps(graph, 'r.a', 'r.e')).toBeNull();
    expect(routeMaps(graph, 'r.a', 'nope')).toBeNull();
    expect([...reachableMaps(graph, 'r.a', (_m, p) => isOpenPortal(p))].sort()).toEqual(['r.a', 'r.b', 'r.c']);
  });
});

// ------------------------------------------------------------------ validator

describe('validateMap', () => {
  const ok = mk({
    portals: [portal('west', 'w', [0, 6, 1, 4], 'x.y#a')],
    nodes: [{ id: 'h1', kind: 'herb', tx: 12, ty: 12 }],
    spawns: [{ monster: 'jellop', count: 4, cx: 10, cy: 4, r: 2 }],
  });
  const errs = (def: MapDef) => validateMap(def).join('\n');

  it('accepts a well-formed map', () => {
    expect(validateMap(ok)).toEqual([]);
  });

  it('rejects wrong sizes per kind', () => {
    expect(errs({ ...ok, layout: fill(16, 16) })).toMatch(/size 32x32 tiles is not allowed for kind secret/);
    expect(errs({ ...ok, kind: 'town' })).toMatch(/kind town \(40 x 32\)/);
    expect(validateMap({ ...ok, kind: 'field', layout: fill(20, 16) })).toEqual([]); // 40x32 approach field
    expect(validateMap({ ...ok, kind: 'field', layout: fill(30, 23) })).toEqual([]);
    expect(errs({ ...ok, kind: 'field', layout: fill(34, 23) })).toMatch(/68x46/);
  });

  it('rejects malformed layouts', () => {
    expect(errs({ ...ok, layout: ['........', '.......', ...fill(8, 6)] })).toMatch(/row 1 has 7 chars, expected 8/);
    expect(errs({ ...ok, layout: ['....?...', ...fill(8, 7)] })).toMatch(/unknown layout char "\?"/);
  });

  it('reports an unreachable node', () => {
    const def = { ...ok, layout: ['........', '........', '..###...', '..#.#...', '..###...', ...fill(8, 3)], nodes: [{ id: 'sealed', kind: 'herb' as const, tx: 6, ty: 6 }] };
    expect(errs(def)).toMatch(/node sealed at \(6,6\) is unreachable from arrival west/);
  });

  it('checks portal rects, edge rules and arrivals', () => {
    expect(errs({ ...ok, portals: [portal('west', 'w', [0, 14, 1, 4], 'x.y#a')] })).toMatch(/rect \(0,14 1x4\) is not inside/);
    expect(errs({ ...ok, portals: [portal('west', 'w', [2, 6, 1, 4], 'x.y#a')] })).toMatch(/must sit on the w border/);
    expect(errs({ ...ok, portals: [portal('west', 'w', [0, 6, 1, 2], 'x.y#a')] })).toMatch(/spans 2 tiles along the border \(min 3\)/);
    expect(errs({ ...ok, portals: [portal('up', 'n', [6, 15, 4, 1], 'x.y#a', { kind: 'stairs' })] })).toMatch(/arrival tile \(8,17\) is outside/);
    expect(
      validateMap({ ...ok, portals: [...ok.portals, portal('door', 'n', [6, 8, 2, 1], 'x.y#b', { kind: 'door' })] }),
    ).toEqual([]);
  });

  it('enforces budgets, safe maps and unique ids', () => {
    const spawns = Array.from({ length: 13 }, (_, i) => ({ monster: 'jellop', count: 5, cx: 8, cy: 4 + (i % 8), r: 1 }));
    const e = errs({ ...ok, spawns });
    expect(e).toMatch(/65 monsters exceeds the budget of 60/);
    expect(e).toMatch(/13 spawn entries exceeds the budget of 12/);
    const npcs = Array.from({ length: 13 }, (_, i) => ({ npc: `n${i}`, tx: 2 + (i % 6) * 2, ty: 2 + Math.floor(i / 6) * 2 }));
    expect(errs({ ...ok, npcs })).toMatch(/13 NPCs exceeds the budget of 12/);
    const many = Array.from({ length: 9 }, (_, i) => portal(`p${i}`, 'n', [i, 15, 1, 1], 'x.y#a', { kind: 'door' }));
    expect(errs({ ...ok, portals: many })).toMatch(/9 portals exceeds the budget of 8/);
    expect(errs({ ...ok, safety: 'safe', levelBand: null })).toMatch(/safe map has 1 spawn entries/);
    expect(errs({ ...ok, nodes: [ok.nodes![0], { ...ok.nodes![0], tx: 3 }] })).toMatch(/duplicate node id 'h1'/);
    expect(errs({ ...ok, portals: [ok.portals[0], { ...ok.portals[0], ty: 2 }] })).toMatch(/duplicate portal id 'west'/);
    expect(errs({ ...ok, objects: [{ id: 'o', kind: 'chest', tx: 3, ty: 3 }, { id: 'o', kind: 'statue', tx: 9, ty: 9 }] })).toMatch(
      /duplicate object id 'o'/,
    );
  });

  it('exempts hidden and gated portals from their own map reachability', () => {
    const layout = ['........', '........', '..###...', '..#.#...', '..###...', ...fill(8, 3)];
    const sealed = portal('secret', 'n', [6, 6, 1, 1], 'x.y#s', { kind: 'hidden', reveal: { look: 'glyph', hint: '?' } });
    expect(validateMap({ ...ok, layout, portals: [ok.portals[0], { ...sealed, kind: 'door', reveal: undefined }] }).join('\n')).toMatch(
      /portal secret is unreachable/,
    );
    // The hidden portal's own arrival sits in the sealed pocket, so that arrival is still reported.
    const e = errs({ ...ok, layout, portals: [ok.portals[0], sealed] });
    expect(e).not.toMatch(/portal secret is unreachable/);
    expect(e).toMatch(/unreachable from arrival secret/);
  });

  it('renders an ASCII debug view', () => {
    const cm = compileMap({
      ...ok,
      layout: ['........', '..~~....', '..##....', ...fill(8, 5)],
      objects: [{ id: 'ws', kind: 'waystone', tx: 12, ty: 3 }],
    });
    const rows = renderAscii(cm).split('\n');
    expect(rows).toHaveLength(16);
    expect(rows.every((r) => r.length === 16)).toBe(true);
    expect(rows[2].slice(4, 6)).toBe('~~');
    expect(rows[4].slice(4, 6)).toBe('##');
    expect(rows[6][0]).toBe('P');
    expect(rows[4][12]).toBe('@');
    expect(rows[3][12]).toBe('#');
    expect(rows[0][0]).toBe('.');
  });
});

describe('spawnWarnings', () => {
  // A cliff across the map (tiles y 6-7) with a gap only at the far east (x 14-15).
  const cliff = mk({ layout: ['........', '........', '........', '#######.', '........', '........', '........', '........'] });

  it('warns when a spawn square reaches over a wall onto tiles far from its centre', () => {
    const over = { ...cliff, spawns: [{ monster: 'jellop', count: 3, cx: 2, cy: 5, r: 3 }] };
    expect(validateMap(over)).toEqual([]); // a soft rule: never a validateMap error
    const warns = spawnWarnings(over);
    expect(warns).toHaveLength(1);
    // Row y 8 (x 0-5) lies under the cliff: 6 of 30 walkable tiles, far more than 3 × r steps away.
    expect(warns[0]).toMatch(/spawn jellop at \(2,5\) r 3: 6 of 30 walkable tiles .* more than 9 steps/);
  });

  it('accepts squares that stay on the centre side, or whose far share is small', () => {
    expect(spawnWarnings({ ...cliff, spawns: [{ monster: 'jellop', count: 3, cx: 2, cy: 4, r: 2 }] })).toEqual([]);
    expect(spawnWarnings({ ...cliff, spawns: [{ monster: 'jellop', count: 3, cx: 12, cy: 5, r: 3 }] })).toEqual([]);
    expect(SPAWN_SPREAD).toEqual({ stepsPerR: 3, maxFarShare: 0.05 });
  });
});

describe('validateWorld', () => {
  const region = (maps: MapDef[]): RegionDef[] => [
    { id: 'vale', name: 'Vale', levelBand: [1, 12], hub: 'vale.hearthvale', maps: maps.map((m) => m.id) },
  ];
  const hub = mk({
    id: 'vale.hearthvale',
    region: 'vale',
    safety: 'safe',
    levelBand: null,
    npcs: [{ npc: 'brann', tx: 8, ty: 8 }],
    portals: [portal('east', 'e', [15, 6, 1, 4], 'vale.quarry#west'), portal('west', 'w', [0, 6, 1, 4], 'vale.lake#east')],
  });
  const quarry = mk({
    id: 'vale.quarry',
    region: 'vale',
    nodes: [{ id: 'ore1', kind: 'ore', tx: 8, ty: 8 }],
    portals: [portal('west', 'w', [0, 6, 1, 4], 'vale.hearthvale#east')],
  });
  const lake = mk({
    id: 'vale.lake',
    region: 'vale',
    nodes: [{ id: 'fish1', kind: 'fishing', tx: 8, ty: 8 }],
    portals: [portal('east', 'e', [15, 6, 1, 4], 'vale.hearthvale#west')],
  });
  const world = [hub, quarry, lake];

  it('accepts a consistent world', () => {
    expect(validateWorld(world, region(world))).toEqual([]);
  });

  it('prefixes per-map errors with the map id', () => {
    const bad = { ...quarry, layout: fill(16, 16) };
    expect(validateWorld([hub, bad, lake], region(world)).join('\n')).toMatch(/^vale\.quarry: size 32x32/m);
  });

  it('reports missing destinations and broken pairs', () => {
    const lost = { ...lake, portals: [portal('east', 'e', [15, 6, 1, 4], 'vale.hearthvale#north')] };
    const e1 = validateWorld([hub, quarry, lost], region(world)).join('\n');
    expect(e1).toMatch(/vale\.lake: portal east leads to unknown portal 'vale\.hearthvale#north'/);
    expect(e1).toMatch(/vale\.hearthvale: portal west -> vale\.lake#east does not pair back/);
    const gone = { ...quarry, portals: [portal('west', 'w', [0, 6, 1, 4], 'vale.nowhere#x')] };
    expect(validateWorld([hub, gone, lake], region(world)).join('\n')).toMatch(/vale\.quarry: portal west leads to unknown map 'vale\.nowhere'/);
    const oneWay = { ...lake, portals: [portal('east', 'e', [15, 6, 1, 4], 'vale.quarry#west', { oneWay: true })] };
    const e2 = validateWorld([hub, quarry, oneWay], region(world)).join('\n');
    expect(e2).not.toMatch(/vale\.lake: portal east/);
    expect(e2).toMatch(/vale\.hearthvale: portal west -> vale\.lake#east/);
  });

  it('checks regions and world cells', () => {
    const regions: RegionDef[] = [
      { id: 'vale', name: 'Vale', levelBand: [1, 12], hub: 'vale.missing', maps: ['vale.hearthvale', 'vale.quarry', 'vale.ghost'] },
      { id: 'rift', name: 'Rift', levelBand: [11, 21], hub: 'vale.quarry', maps: ['vale.quarry'] },
    ];
    const noCell = { ...lake, worldCell: undefined as unknown as MapDef['worldCell'] };
    const e = validateWorld([hub, quarry, noCell], regions).join('\n');
    expect(e).toMatch(/region vale: hub 'vale\.missing' is not one of its maps/);
    expect(e).toMatch(/region vale: lists unknown map 'vale\.ghost'/);
    expect(e).toMatch(/vale\.quarry: listed in 2 regions/);
    expect(e).toMatch(/vale\.lake: not listed in any region/);
    expect(e).toMatch(/vale\.lake: worldCell is missing/);
    const wrong = validateWorld([hub, { ...quarry, region: 'rift' }, lake], region(world)).join('\n');
    expect(wrong).toMatch(/vale\.quarry: map\.region is 'rift' but region 'vale' lists it/);
    expect(validateWorld([...world, quarry], region(world)).join('\n')).toMatch(/vale\.quarry: duplicate map id/);
  });

  it('flags a soft-lock when < 3 primal sources are reachable over open portals', () => {
    const hidden = {
      ...hub,
      portals: [hub.portals[0], { ...hub.portals[1], kind: 'hidden' as const, reveal: { shape: 'dash' as const, look: 'shimmer' as const, hint: '' } }],
    };
    expect(validateWorld([hidden, quarry, lake], region(world)).join('\n')).toMatch(
      /soft-lock check: from vale\.hearthvale over open portals only 2 primal element source\(s\) are reachable \(fire, earth\)/,
    );
    const gated = { ...hub, portals: [{ ...hub.portals[0], gate: { elementsKnown: 3, hint: '' } }, hub.portals[1]] };
    expect(validateWorld([gated, quarry, lake], region(world)).join('\n')).toMatch(/only 2 primal/);
    expect(validateWorld([quarry, lake], region([quarry, lake])).join('\n')).toMatch(/hub map 'vale\.hearthvale' is missing/);
  });
});
