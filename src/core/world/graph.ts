// Portal graph between maps: routing for auto-travel / the world map, and the reachability checks in validate.ts.
import type { MapDef, PortalDef } from './types';

/** Global portal id `<mapId>#<portalId>`. */
export function portalKey(mapId: string, portalId: string): string {
  return `${mapId}#${portalId}`;
}

export interface PortalGraph {
  maps: ReadonlyMap<string, MapDef>;
  /** Every portal by portalKey. */
  portals: ReadonlyMap<string, { map: MapDef; portal: PortalDef }>;
  /** Outgoing portals per map id, in authored order, whose destination map AND portal exist. */
  out: ReadonlyMap<string, readonly PortalDef[]>;
}

export type PortalFilter = (map: MapDef, portal: PortalDef) => boolean;

/** True for portals anyone can walk through: not hidden (no reveal) and not gated. */
export function isOpenPortal(p: PortalDef): boolean {
  return p.kind !== 'hidden' && !p.reveal && !p.gate;
}

export function buildPortalGraph(maps: readonly MapDef[]): PortalGraph {
  const byId = new Map<string, MapDef>();
  for (const m of maps) if (!byId.has(m.id)) byId.set(m.id, m);
  const portals = new Map<string, { map: MapDef; portal: PortalDef }>();
  for (const m of byId.values()) {
    for (const p of m.portals) {
      const k = portalKey(m.id, p.id);
      if (!portals.has(k)) portals.set(k, { map: m, portal: p });
    }
  }
  const out = new Map<string, PortalDef[]>();
  for (const m of byId.values()) {
    out.set(
      m.id,
      m.portals.filter((p) => portals.has(portalKey(p.to.map, p.to.portal))),
    );
  }
  return { maps: byId, portals, out };
}

/**
 * Shortest route (fewest portal hops, BFS in authored order) from `fromMap` to `toMap`.
 * Each step is "in `map`, take portal `portal`". [] when already there; null when unreachable.
 */
export function routeMaps(
  graph: PortalGraph,
  fromMap: string,
  toMap: string,
  canUse: PortalFilter = () => true,
): { map: string; portal: string }[] | null {
  if (!graph.maps.has(fromMap) || !graph.maps.has(toMap)) return null;
  if (fromMap === toMap) return [];
  const prev = new Map<string, { map: string; portal: string }>();
  const seen = new Set<string>([fromMap]);
  const queue: string[] = [fromMap];
  for (let qi = 0; qi < queue.length; qi++) {
    const id = queue[qi];
    const map = graph.maps.get(id)!;
    for (const p of graph.out.get(id) ?? []) {
      const next = p.to.map;
      if (seen.has(next) || !canUse(map, p)) continue;
      seen.add(next);
      prev.set(next, { map: id, portal: p.id });
      if (next === toMap) {
        const route: { map: string; portal: string }[] = [];
        for (let at = toMap; at !== fromMap; ) {
          const step = prev.get(at)!;
          route.push(step);
          at = step.map;
        }
        return route.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

/** Every map reachable from `fromMap` (inclusive) through usable portals. */
export function reachableMaps(graph: PortalGraph, fromMap: string, canUse: PortalFilter = () => true): Set<string> {
  const seen = new Set<string>();
  if (!graph.maps.has(fromMap)) return seen;
  seen.add(fromMap);
  const queue: string[] = [fromMap];
  for (let qi = 0; qi < queue.length; qi++) {
    const map = graph.maps.get(queue[qi])!;
    for (const p of graph.out.get(map.id) ?? []) {
      if (seen.has(p.to.map) || !canUse(map, p)) continue;
      seen.add(p.to.map);
      queue.push(p.to.map);
    }
  }
  return seen;
}
