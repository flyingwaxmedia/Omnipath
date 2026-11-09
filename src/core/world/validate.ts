// Map + world validation (SPEC §7.2) and a debug ASCII renderer for map authors.
// validateMap/validateWorld return human-readable error strings; [] means valid.
import type { ElementId } from '../types';
import { STRUCTURE_FOOTPRINT, TILE, arrivalTile, compileMap, mapSizeTiles } from './compile';
import { buildPortalGraph, isOpenPortal, portalKey, reachableMaps } from './graph';
import { COLL, type CompiledMap, type MapDef, type MapKind, type PortalDef, type RegionDef } from './types';

export interface SizeRule {
  /** Inclusive tile ranges. */
  w: [number, number];
  h: [number, number];
  /** Extra exact sizes allowed besides the ranges. */
  also?: [number, number][];
}

/**
 * Allowed sizes in tiles per map kind. Field also allows 40×32 because the §7.3 manifest authors
 * vale.stormbreak_approach as a 40×32 field.
 */
export const MAP_SIZES: Readonly<Record<MapKind, SizeRule>> = {
  town: { w: [40, 40], h: [32, 32] },
  outpost: { w: [24, 24], h: [20, 20] },
  field: { w: [56, 64], h: [44, 48], also: [[40, 32]] },
  dungeon: { w: [40, 40], h: [40, 40] },
  arena: { w: [24, 24], h: [24, 24] },
  secret: { w: [16, 24], h: [16, 24] },
};

export const MAP_BUDGET = { monsters: 60, spawns: 12, npcs: 12, portals: 8 } as const;

/** Edge portals must span at least this many tiles along their border. */
export const EDGE_MIN_SPAN = 3;

/**
 * Spawn spread (soft rule, spawnWarnings): at most `maxFarShare` of a spawn square's walkable tiles may lie more
 * than `stepsPerR × r` walking steps from its centre (or be unreachable from it).
 */
export const SPAWN_SPREAD = { stepsPerR: 3, maxFarShare: 0.05 } as const;

/** Primal element sources used by the soft-lock check (SPEC §7.2 / §7.4). */
export const ELEMENT_SOURCES: readonly { element: ElementId; source: string; test: (m: MapDef) => boolean }[] = [
  { element: 'fire', source: "npc 'brann' (forge)", test: (m) => (m.npcs ?? []).some((n) => n.npc === 'brann') },
  { element: 'earth', source: "node 'ore'", test: (m) => (m.nodes ?? []).some((n) => n.kind === 'ore') },
  { element: 'water', source: "node 'fishing'", test: (m) => (m.nodes ?? []).some((n) => n.kind === 'fishing') },
  { element: 'wind', source: "object 'wind_shrine'", test: (m) => (m.objects ?? []).some((o) => o.kind === 'wind_shrine') },
  { element: 'shadow', source: "object 'obelisk'", test: (m) => (m.objects ?? []).some((o) => o.kind === 'obelisk') },
];

const fitsSize = (rule: SizeRule, w: number, h: number) =>
  (w >= rule.w[0] && w <= rule.w[1] && h >= rule.h[0] && h <= rule.h[1]) ||
  (rule.also ?? []).some(([aw, ah]) => aw === w && ah === h);

const range = ([a, b]: [number, number]) => (a === b ? `${a}` : `${a}-${b}`);

function duplicates(ids: string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) (seen.has(id) ? dup : seen).add(id);
  return [...dup];
}

const inRect = (p: PortalDef, x: number, y: number) => x >= p.tx && y >= p.ty && x < p.tx + p.w && y < p.ty + p.h;

/** Single-map rules (SPEC §7.2). */
export function validateMap(def: MapDef): string[] {
  const errs: string[] = [];
  const portals = def.portals ?? [];
  const spawns = def.spawns ?? [];
  const npcs = def.npcs ?? [];
  const nodes = def.nodes ?? [];
  const objects = def.objects ?? [];

  // Layout shape & kind size.
  let size: { w: number; h: number } | null = null;
  if (!Array.isArray(def.layout) || def.layout.length === 0 || !def.layout[0]?.length) {
    errs.push('layout is empty');
  } else {
    const cols = def.layout[0].length;
    const bad = def.layout.findIndex((r) => r.length !== cols);
    if (bad >= 0) errs.push(`layout row ${bad} has ${def.layout[bad].length} chars, expected ${cols} (rows must be equal length)`);
    else size = mapSizeTiles(def);
  }
  if (size) {
    const rule = MAP_SIZES[def.kind];
    if (!rule) errs.push(`unknown map kind ${JSON.stringify(def.kind)}`);
    else if (!fitsSize(rule, size.w, size.h)) {
      const also = (rule.also ?? []).map(([aw, ah]) => ` or ${aw}x${ah}`).join('');
      errs.push(`size ${size.w}x${size.h} tiles is not allowed for kind ${def.kind} (${range(rule.w)} x ${range(rule.h)}${also})`);
    }
  }

  // Budgets & safety.
  const monsters = spawns.reduce((s, sp) => s + sp.count, 0);
  if (monsters > MAP_BUDGET.monsters) errs.push(`${monsters} monsters exceeds the budget of ${MAP_BUDGET.monsters}`);
  if (spawns.length > MAP_BUDGET.spawns) errs.push(`${spawns.length} spawn entries exceeds the budget of ${MAP_BUDGET.spawns}`);
  if (npcs.length > MAP_BUDGET.npcs) errs.push(`${npcs.length} NPCs exceeds the budget of ${MAP_BUDGET.npcs}`);
  if (portals.length > MAP_BUDGET.portals) errs.push(`${portals.length} portals exceeds the budget of ${MAP_BUDGET.portals}`);
  if (def.safety === 'safe' && spawns.length > 0) errs.push(`safe map has ${spawns.length} spawn entries (must be 0)`);

  // Unique ids.
  for (const id of duplicates(portals.map((p) => p.id))) errs.push(`duplicate portal id '${id}'`);
  for (const id of duplicates(nodes.map((n) => n.id))) errs.push(`duplicate node id '${id}'`);
  for (const id of duplicates(objects.map((o) => o.id))) errs.push(`duplicate object id '${id}'`);

  if (!size) return errs;
  const { w: W, h: H } = size;
  const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;

  // Portal rects & edge rules.
  for (const p of portals) {
    const okDims = Number.isInteger(p.w) && Number.isInteger(p.h) && p.w >= 1 && p.h >= 1;
    if (!okDims || !inMap(p.tx, p.ty) || p.tx + p.w > W || p.ty + p.h > H) {
      errs.push(`portal ${p.id}: rect (${p.tx},${p.ty} ${p.w}x${p.h}) is not inside the ${W}x${H} map`);
      continue;
    }
    if (p.kind === 'edge') {
      const onBorder =
        p.facing === 'n' ? p.ty === 0 : p.facing === 's' ? p.ty + p.h === H : p.facing === 'w' ? p.tx === 0 : p.tx + p.w === W;
      if (!onBorder) errs.push(`portal ${p.id}: edge portal facing '${p.facing}' must sit on the ${p.facing} border`);
      const span = p.facing === 'n' || p.facing === 's' ? p.w : p.h;
      if (span < EDGE_MIN_SPAN) errs.push(`portal ${p.id}: edge portal spans ${span} tiles along the border (min ${EDGE_MIN_SPAN})`);
    }
  }

  // Placements inside the map and off portal rects.
  const placed: { label: string; tx: number; ty: number }[] = [
    ...npcs.map((e) => ({ label: `npc ${e.npc}`, tx: e.tx, ty: e.ty })),
    ...nodes.map((e) => ({ label: `node ${e.id}`, tx: e.tx, ty: e.ty })),
    ...objects.map((e) => ({ label: `object ${e.id}`, tx: e.tx, ty: e.ty })),
  ];
  for (const e of placed) {
    if (!inMap(e.tx, e.ty)) errs.push(`${e.label} at (${e.tx},${e.ty}) is outside the map`);
    const on = portals.find((p) => inRect(p, e.tx, e.ty));
    if (on) errs.push(`${e.label} at (${e.tx},${e.ty}) sits on portal ${on.id}`);
  }
  for (const s of def.structures ?? []) {
    const fp = STRUCTURE_FOOTPRINT[s.kind];
    if (!fp) errs.push(`unknown structure kind ${JSON.stringify(s.kind)}`);
    else if (!inMap(s.tx, s.ty) || s.tx + fp.w > W || s.ty + fp.h > H) errs.push(`structure ${s.kind} at (${s.tx},${s.ty}) is not inside the map`);
  }
  for (const s of spawns) if (!inMap(s.cx, s.cy)) errs.push(`spawn ${s.monster} centre (${s.cx},${s.cy}) is outside the map`);

  let cm: CompiledMap;
  try {
    cm = compileMap(def);
  } catch (e) {
    errs.push(e instanceof Error ? e.message : String(e));
    return errs;
  }
  const blocked = (x: number, y: number) => !inMap(x, y) || (cm.coll[y * W + x] & COLL.BLOCK) !== 0;

  // Nominal arrival tiles must be walkable (and not on a portal).
  for (const p of portals) {
    const [ax, ay] = arrivalTile(p);
    if (!inMap(ax, ay)) errs.push(`portal ${p.id}: arrival tile (${ax},${ay}) is outside the map`);
    else if (blocked(ax, ay)) errs.push(`portal ${p.id}: arrival tile (${ax},${ay}) is not walkable`);
    else if (cm.coll[ay * W + ax] & COLL.PORTAL) errs.push(`portal ${p.id}: arrival tile (${ax},${ay}) lands on a portal`);
  }

  // Reachability: 4-connected components of walkable tiles (same set 8-dir A* without corner cutting reaches).
  const comp = new Int32Array(W * H).fill(-1);
  let nComp = 0;
  const stack: number[] = [];
  for (let i = 0; i < W * H; i++) {
    if (comp[i] >= 0 || cm.coll[i] & COLL.BLOCK) continue;
    comp[i] = nComp;
    stack.push(i);
    while (stack.length) {
      const c = stack.pop()!;
      const x = c % W;
      const y = (c - x) / W;
      for (const [dx, dy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = x + dx;
        const ny = y + dy;
        if (blocked(nx, ny)) continue;
        const ni = ny * W + nx;
        if (comp[ni] < 0) {
          comp[ni] = nComp;
          stack.push(ni);
        }
      }
    }
    nComp++;
  }
  /** Components that "reach" a tile: its own, or any 8-neighbour's when the tile itself is blocked. */
  const reachers = (tiles: [number, number][]): Set<number> => {
    const out = new Set<number>();
    for (const [x, y] of tiles) {
      if (!inMap(x, y)) continue;
      if (!blocked(x, y)) {
        out.add(comp[y * W + x]);
        continue;
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && !blocked(x + dx, y + dy)) out.add(comp[(y + dy) * W + x + dx]);
      }
    }
    return out;
  };

  const sources: { label: string; portal?: string; comp: number }[] = [];
  for (const p of portals) {
    const a = cm.arrivals[p.id];
    const tx = Math.floor(a.x / TILE);
    const ty = Math.floor(a.y / TILE);
    if (blocked(tx, ty)) errs.push(`portal ${p.id}: no walkable arrival tile near (${tx},${ty})`);
    else sources.push({ label: `arrival ${p.id}`, portal: p.id, comp: comp[ty * W + tx] });
  }
  // A waystone spawn is also an entry point (travel / respawn), so it must reach everything too.
  if (objects.some((o) => o.kind === 'waystone') || sources.length === 0) {
    const tx = Math.floor(cm.spawn.x / TILE);
    const ty = Math.floor(cm.spawn.y / TILE);
    if (!blocked(tx, ty)) sources.push({ label: 'spawn', comp: comp[ty * W + tx] });
  }

  const targets: { label: string; portal?: string; comps: Set<number> }[] = [
    ...placed.filter((e) => inMap(e.tx, e.ty)).map((e) => ({ label: `${e.label} at (${e.tx},${e.ty})`, comps: reachers([[e.tx, e.ty]]) })),
    ...spawns
      .filter((s) => inMap(s.cx, s.cy))
      .map((s) => ({ label: `spawn ${s.monster} centre (${s.cx},${s.cy})`, comps: reachers([[s.cx, s.cy]]) })),
  ];
  // Hidden and gated portals are excluded from their own map's reachability requirement.
  for (const p of portals) {
    if (!isOpenPortal(p)) continue;
    const tiles: [number, number][] = [];
    for (let y = p.ty; y < p.ty + p.h; y++) for (let x = p.tx; x < p.tx + p.w; x++) tiles.push([x, y]);
    targets.push({ label: `portal ${p.id}`, portal: p.id, comps: reachers(tiles) });
  }
  for (const t of targets) {
    const missing = sources.filter((s) => s.portal === undefined || s.portal !== t.portal).filter((s) => !t.comps.has(s.comp));
    if (missing.length) errs.push(`${t.label} is unreachable from ${missing.map((s) => s.label).join(', ')}`);
  }
  return errs;
}

/**
 * Soft warnings for one map (never errors: validateMap and validateWorld ignore them). The client samples a
 * monster's home from every walkable tile of its spawn square (cx ± r, cy ± r), so a square that reaches over a
 * cliff or wall puts monsters on another terrace, where they aggro across it and stall. Warns for each spawn with
 * more than SPAWN_SPREAD.maxFarShare of its walkable square farther than stepsPerR × r 4-connected steps from the
 * centre (unreachable tiles count as far). [] when nothing is wrong or the map does not compile.
 */
export function spawnWarnings(def: MapDef): string[] {
  let cm: CompiledMap;
  try {
    cm = compileMap(def);
  } catch {
    return [];
  }
  const { w: W, h: H } = cm;
  const walkable = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H && (cm.coll[y * W + x] & COLL.BLOCK) === 0;
  const out: string[] = [];
  for (const s of def.spawns ?? []) {
    const dist = new Int32Array(W * H).fill(-1);
    const queue: number[] = [];
    const seed = (x: number, y: number, d: number) => {
      if (!walkable(x, y) || dist[y * W + x] >= 0) return;
      dist[y * W + x] = d;
      queue.push(y * W + x);
    };
    seed(s.cx, s.cy, 0);
    // A blocked centre (e.g. a prop) starts from its walkable 8-neighbours.
    if (queue.length === 0) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) seed(s.cx + dx, s.cy + dy, 1);
    for (let head = 0; head < queue.length; head++) {
      const c = queue[head];
      const x = c % W;
      const y = (c - x) / W;
      seed(x + 1, y, dist[c] + 1);
      seed(x - 1, y, dist[c] + 1);
      seed(x, y + 1, dist[c] + 1);
      seed(x, y - 1, dist[c] + 1);
    }
    const limit = SPAWN_SPREAD.stepsPerR * s.r;
    let tiles = 0;
    let far = 0;
    for (let y = s.cy - s.r; y <= s.cy + s.r; y++) {
      for (let x = s.cx - s.r; x <= s.cx + s.r; x++) {
        if (!walkable(x, y)) continue;
        tiles++;
        const d = dist[y * W + x];
        if (d < 0 || d > limit) far++;
      }
    }
    if (tiles > 0 && far / tiles > SPAWN_SPREAD.maxFarShare) {
      out.push(
        `spawn ${s.monster} at (${s.cx},${s.cy}) r ${s.r}: ${far} of ${tiles} walkable tiles in its square are more than ${limit} steps from the centre`,
      );
    }
  }
  return out;
}

export interface WorldCheckOptions {
  /** Start of the soft-lock check (default 'vale.hearthvale'). */
  hub?: string;
  /** Primal element sources that must be reachable over open portals (default 3). */
  minPrimal?: number;
}

/** Whole-world rules: per-map rules (prefixed by map id), portal pairing, regions, world cells, soft-lock check. */
export function validateWorld(maps: readonly MapDef[], regions: readonly RegionDef[], opts: WorldCheckOptions = {}): string[] {
  const errs: string[] = [];
  const byId = new Map<string, MapDef>();
  for (const m of maps) {
    if (byId.has(m.id)) errs.push(`${m.id}: duplicate map id`);
    else byId.set(m.id, m);
  }

  for (const m of byId.values()) {
    for (const e of validateMap(m)) errs.push(`${m.id}: ${e}`);
    const c = m.worldCell;
    if (!c || !Number.isFinite(c.x) || !Number.isFinite(c.y)) errs.push(`${m.id}: worldCell is missing`);
  }

  // Portal destinations and pairing.
  for (const m of byId.values()) {
    for (const p of m.portals ?? []) {
      const dest = byId.get(p.to?.map);
      if (!dest) {
        errs.push(`${m.id}: portal ${p.id} leads to unknown map '${p.to?.map}'`);
        continue;
      }
      const back = (dest.portals ?? []).find((q) => q.id === p.to.portal);
      if (!back) {
        errs.push(`${m.id}: portal ${p.id} leads to unknown portal '${portalKey(p.to.map, p.to.portal)}'`);
        continue;
      }
      if (!p.oneWay && (back.to?.map !== m.id || back.to?.portal !== p.id)) {
        const there = back.to ? portalKey(back.to.map, back.to.portal) : 'nowhere';
        errs.push(
          `${m.id}: portal ${p.id} -> ${portalKey(dest.id, back.id)} does not pair back (it leads to ${there}; mark oneWay if intended)`,
        );
      }
    }
  }

  // Regions.
  for (const id of duplicates(regions.map((r) => r.id))) errs.push(`region ${id}: duplicate region id`);
  for (const r of regions) {
    if (!r.maps.includes(r.hub)) errs.push(`region ${r.id}: hub '${r.hub}' is not one of its maps`);
    for (const id of r.maps) if (!byId.has(id)) errs.push(`region ${r.id}: lists unknown map '${id}'`);
  }
  for (const m of byId.values()) {
    const owners = regions.filter((r) => r.maps.includes(m.id));
    if (owners.length === 0) errs.push(`${m.id}: not listed in any region (map.region is '${m.region}')`);
    else if (owners.length > 1) errs.push(`${m.id}: listed in ${owners.length} regions (${owners.map((r) => r.id).join(', ')})`);
    else if (owners[0].id !== m.region) errs.push(`${m.id}: map.region is '${m.region}' but region '${owners[0].id}' lists it`);
  }

  // Soft-lock: the Prism Gate needs 3 primal elements, so 3 sources must be reachable without gates/reveals.
  const hub = opts.hub ?? 'vale.hearthvale';
  const need = opts.minPrimal ?? 3;
  if (!byId.has(hub)) errs.push(`soft-lock check: hub map '${hub}' is missing`);
  else {
    const graph = buildPortalGraph([...byId.values()]);
    const reach = [...reachableMaps(graph, hub, (_m, p) => isOpenPortal(p))].map((id) => byId.get(id)!);
    const found = ELEMENT_SOURCES.filter((s) => reach.some((m) => s.test(m)));
    if (found.length < need) {
      const got = found.map((s) => s.element).join(', ') || 'none';
      errs.push(
        `soft-lock check: from ${hub} over open portals only ${found.length} primal element source(s) are reachable (${got}); need >= ${need}`,
      );
    }
  }
  return errs;
}

/** Debug view, one char per tile: '@' spawn, 'P' portal, '~' water, '#' blocked, '.' walkable. Rows joined by '\n'. */
export function renderAscii(cm: CompiledMap): string {
  const sx = Math.floor(cm.spawn.x / TILE);
  const sy = Math.floor(cm.spawn.y / TILE);
  const rows: string[] = [];
  for (let y = 0; y < cm.h; y++) {
    let row = '';
    for (let x = 0; x < cm.w; x++) {
      const c = cm.coll[y * cm.w + x];
      row +=
        x === sx && y === sy ? '@' : c & COLL.PORTAL ? 'P' : c & COLL.WATER ? '~' : c & COLL.BLOCK ? '#' : '.';
    }
    rows.push(row);
  }
  return rows.join('\n');
}
