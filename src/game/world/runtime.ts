// World runtime helpers (docs/CLIENT-v2.md §1-§5): the compile cache, fog bitsets, node/chest/waystone keys,
// portal gate + hidden-reveal rules and travel targets. Pure functions over WorldState + SkillBook — no Phaser.
import type { SkillBook } from '../../core/skillbook';
import type { SkillDef } from '../../core/types';
import { PRIMAL_ELEMENTS } from '../../core/types';
import { TILE, compileMap } from '../../core/world/compile';
import { buildPortalGraph, portalKey, routeMaps, type PortalGraph } from '../../core/world/graph';
import type { CompiledMap, MapDef, PortalDef, PortalGate, PortalReveal } from '../../core/world/types';
import { MAPS, REGIONS, mapById } from '../../data/world';
import type { WorldState } from '../session';

export { TILE, portalKey };

// ------------------------------------------------------------------ compile cache

const compiledCache = new Map<string, CompiledMap>();

/** Compiled map by id (compiled once per id and cached for the session). Throws for unknown ids. */
export function compiled(mapId: string): CompiledMap {
  let cm = compiledCache.get(mapId);
  if (!cm) {
    const def = mapById(mapId);
    if (!def) throw new Error(`Unknown map ${mapId}`);
    cm = compileMap(def);
    compiledCache.set(mapId, cm);
  }
  return cm;
}

let graph: PortalGraph | null = null;
export function portalGraph(): PortalGraph {
  return (graph ??= buildPortalGraph(MAPS));
}

export function regionOf(mapId: string) {
  return REGIONS.find((r) => r.maps.includes(mapId)) ?? REGIONS[0];
}

/** "Name · Lv a–b". */
export function mapTitle(def: MapDef): string {
  const b = def.levelBand;
  return b ? `${def.name} · Lv ${b[0] === b[1] ? b[0] : `${b[0]}–${b[1]}`}` : def.name;
}

// ------------------------------------------------------------------ keys

export const nodeKey = (mapId: string, id: string) => `${mapId}#${id}`;
export const objectKey = (mapId: string, id: string) => `${mapId}#${id}`;

export function nodeReady(world: WorldState, mapId: string, nodeId: string, now = Date.now()): boolean {
  return (world.nodes[nodeKey(mapId, nodeId)] ?? 0) <= now;
}

export function addOnce(list: string[], v: string): boolean {
  if (list.includes(v)) return false;
  list.push(v);
  return true;
}

// ------------------------------------------------------------------ fog (4x4-tile cells)

export const FOG_CELL = 4;
export const FOG_RADIUS_TILES = 6;

const fogCache = new WeakMap<WorldState, Map<string, Uint8Array>>();

export function fogDims(cm: Pick<CompiledMap, 'w' | 'h'>): { cw: number; ch: number } {
  return { cw: Math.ceil(cm.w / FOG_CELL), ch: Math.ceil(cm.h / FOG_CELL) };
}

function decode(s: string | undefined, bytes: number): Uint8Array {
  const out = new Uint8Array(bytes);
  if (!s) return out;
  try {
    const bin = atob(s);
    for (let i = 0; i < Math.min(bytes, bin.length); i++) out[i] = bin.charCodeAt(i);
  } catch {
    /* corrupt: start unexplored */
  }
  return out;
}

function encode(bits: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bits.length; i++) s += String.fromCharCode(bits[i]);
  return btoa(s);
}

/** The explored-cell bitset of a map (row-major cells, LSB first). Do not mutate; use markFog. */
export function fogBits(world: WorldState, mapId: string, cm: Pick<CompiledMap, 'w' | 'h'>): Uint8Array {
  let perWorld = fogCache.get(world);
  if (!perWorld) fogCache.set(world, (perWorld = new Map()));
  let bits = perWorld.get(mapId);
  const { cw, ch } = fogDims(cm);
  const bytes = Math.ceil((cw * ch) / 8);
  if (!bits || bits.length !== bytes) {
    bits = decode(world.fog[mapId], bytes);
    perWorld.set(mapId, bits);
  }
  return bits;
}

export function cellExplored(bits: Uint8Array, cw: number, cx: number, cy: number): boolean {
  const i = cy * cw + cx;
  return (bits[i >> 3] & (1 << (i & 7))) !== 0;
}

/** Marks every cell within FOG_RADIUS_TILES of px (x, y). Returns true when something new was explored. */
export function markFog(world: WorldState, mapId: string, cm: Pick<CompiledMap, 'w' | 'h'>, x: number, y: number): boolean {
  const bits = fogBits(world, mapId, cm);
  const { cw, ch } = fogDims(cm);
  const tx = x / TILE;
  const ty = y / TILE;
  const r = FOG_RADIUS_TILES;
  let changed = false;
  for (let cy = Math.max(0, Math.floor((ty - r) / FOG_CELL)); cy <= Math.min(ch - 1, Math.floor((ty + r) / FOG_CELL)); cy++) {
    for (let cx = Math.max(0, Math.floor((tx - r) / FOG_CELL)); cx <= Math.min(cw - 1, Math.floor((tx + r) / FOG_CELL)); cx++) {
      // distance from the player to the nearest point of the cell
      const nx = Math.max(cx * FOG_CELL, Math.min(tx, (cx + 1) * FOG_CELL));
      const ny = Math.max(cy * FOG_CELL, Math.min(ty, (cy + 1) * FOG_CELL));
      if (Math.hypot(nx - tx, ny - ty) > r) continue;
      const i = cy * cw + cx;
      if (bits[i >> 3] & (1 << (i & 7))) continue;
      bits[i >> 3] |= 1 << (i & 7);
      changed = true;
    }
  }
  if (changed) world.fog[mapId] = encode(bits);
  return changed;
}

// ------------------------------------------------------------------ gates & hidden portals

/** Primal elements in the order they were attuned. */
export function primalInOrder(book: SkillBook) {
  return book
    .knownElements()
    .filter((e) => PRIMAL_ELEMENTS.includes(e.id))
    .sort((a, b) => (book.state.elements[a.id]?.learnedAt ?? 0) - (book.state.elements[b.id]?.learnedAt ?? 0));
}

export function gateOpen(book: SkillBook, gate: PortalGate): boolean {
  if (gate.elementsKnown !== undefined && primalInOrder(book).length < gate.elementsKnown) return false;
  if (gate.elements && !gate.elements.every((e) => book.hasElement(e))) return false;
  if (gate.flag && book.flag(gate.flag) < 1) return false;
  return true;
}

/** Socket gems shown on a prism gate: `color` null = grey/unlit. Up to 7. */
export function gateSockets(book: SkillBook, gate: PortalGate): { color: number | null; need: boolean }[] {
  if (gate.elements?.length) {
    return gate.elements.map((id) => ({ color: book.hasElement(id) ? (book.reg.element(id)?.color ?? 0xffffff) : null, need: true }));
  }
  if (gate.elementsKnown !== undefined) {
    const known = primalInOrder(book);
    return Array.from({ length: 7 }, (_, i) => ({ color: known[i]?.color ?? null, need: i < gate.elementsKnown! }));
  }
  const open = gate.flag ? book.flag(gate.flag) > 0 : true;
  return Array.from({ length: 7 }, () => ({ color: open ? 0xbfe8ff : null, need: false }));
}

/** Player-facing requirement text for a closed gate. */
export function gateText(book: SkillBook, gate: PortalGate): string {
  const parts: string[] = [];
  if (gate.elementsKnown !== undefined) parts.push(`Primal elements attuned: ${primalInOrder(book).length}/${gate.elementsKnown}`);
  if (gate.elements) {
    parts.push(
      gate.elements
        .map((e) => {
          const el = book.reg.element(e);
          return `${book.hasElement(e) ? '✓' : '✗'} ${el?.icon ?? ''} ${el?.name ?? e}`;
        })
        .join(' · '),
    );
  }
  if (gate.flag) parts.push(book.flag(gate.flag) > 0 ? '✓ The way has been earned' : '✗ Something still bars the way');
  return parts.join('<br>');
}

/** ANY-OF reveal: tag, element (element / elements) or shape kind. */
export function revealMatches(skill: SkillDef, reveal: PortalReveal): boolean {
  if (reveal.tag && skill.tags.includes(reveal.tag)) return true;
  if (skill.element && (skill.element === reveal.element || reveal.elements?.includes(skill.element))) return true;
  if (reveal.shape && skill.shape.kind === reveal.shape) return true;
  return false;
}

export function isRevealed(world: WorldState, mapId: string, p: PortalDef): boolean {
  return !p.reveal || world.revealed.includes(portalKey(mapId, p.id));
}

/** Open = revealed (if hidden) and its gate open (if gated). Closed portals are blocked targets. */
export function portalOpen(world: WorldState, book: SkillBook, mapId: string, p: PortalDef): boolean {
  if (p.kind === 'hidden' || p.reveal) {
    if (!isRevealed(world, mapId, p)) return false;
  }
  return !p.gate || gateOpen(book, p.gate);
}

/** Px distance from a point to a portal rect. */
export function distToRect(p: Pick<PortalDef, 'tx' | 'ty' | 'w' | 'h'>, x: number, y: number): number {
  const x0 = p.tx * TILE;
  const y0 = p.ty * TILE;
  const nx = Math.max(x0, Math.min(x, x0 + p.w * TILE));
  const ny = Math.max(y0, Math.min(y, y0 + p.h * TILE));
  return Math.hypot(nx - x, ny - y);
}

// ------------------------------------------------------------------ travel & routing

export interface TravelTarget {
  key: string;
  mapId: string;
  name: string;
  region: string;
  cost: number;
}

/** Cost to travel between waystones: same region free, other region 40 coins. */
export const CROSS_REGION_FARE = 40;

/** Attuned waystones other than `fromKey`, with fares from the current map's region. */
export function travelTargets(world: WorldState, fromMapId: string, fromKey?: string): TravelTarget[] {
  const here = regionOf(fromMapId).id;
  const out: TravelTarget[] = [];
  for (const key of world.waystones) {
    if (key === fromKey) continue;
    const mapId = key.slice(0, key.indexOf('#'));
    const def = mapById(mapId);
    if (!def) continue;
    const region = regionOf(mapId);
    out.push({ key, mapId, name: def.name, region: region.name, cost: region.id === here ? 0 : CROSS_REGION_FARE });
  }
  return out.sort((a, b) => a.cost - b.cost || a.name.localeCompare(b.name));
}

/** The map's first waystone object id, if any. */
export function waystoneOf(def: MapDef): string | undefined {
  return def.objects?.find((o) => o.kind === 'waystone')?.id;
}

/** Route over portals the player has discovered and can use, through visited maps only. */
export function discoveredRoute(world: WorldState, book: SkillBook, from: string, to: string) {
  return routeMaps(portalGraph(), from, to, (map, p) => {
    if (!world.visited.includes(p.to.map) && p.to.map !== to) return false;
    if (!world.seenPortals.includes(portalKey(map.id, p.id))) return false;
    return portalOpen(world, book, map.id, p);
  });
}
