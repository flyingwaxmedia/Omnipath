// World map (docs/CLIENT-v2.md §7), two layers:
//  1. the region graph: one cell per `worldCell` (visited · seen-unknown "?" · hidden), level bands, links between
//     cells along discovered portals, gate pins with their socket state, stubs to other regions, dungeon floors
//     grouped in one cell (their list opens in a popover), the current position and the auto-travel route;
//  2. the local map: the compiled map rendered 1:1 (one ground texel per tile, upscaled crisp) under the explored fog
//     of `world.fog`, with portals, NPCs, nodes, waystones and the secrets found. Markers can be tapped for a label.
// Pure DOM/canvas over the GameController + world runtime helpers; the Map panel (panels/map.ts) composes it.
import { BIOMES } from '../core/world/compile';
import { portalKey } from '../core/world/graph';
import type { CompiledMap, MapDef, PortalDef, RegionDef } from '../core/world/types';
import { COLL } from '../core/world/types';
import { NPCS } from '../data/npcs';
import { MAPS, REGIONS, mapById } from '../data/world';
import {
  TILE,
  cellExplored,
  compiled,
  fogBits,
  fogDims,
  FOG_CELL,
  gateOpen,
  gateSockets,
  isRevealed,
  nodeReady,
  objectKey,
  portalOpen,
} from '../game/world/runtime';
import type { GameController } from './controller';
import {
  GROUND_RGB,
  NODE_RGB,
  OBJECT_RGB,
  diamond,
  disc,
  drawFog,
  paintFog,
  paintGround,
  playerArrow,
  portalGlyph,
  unrevealedPortals,
} from './minimap';
import { bandText, esc, hex } from './util';

export type CellState = 'visited' | 'seen' | 'unknown';

const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));

/** Whether the player has seen a portal leading into `mapId` from a map they visited. */
function seenInto(ctrl: GameController, mapId: string): boolean {
  const w = ctrl.world();
  for (const m of MAPS) {
    if (!w.visited.includes(m.id)) continue;
    for (const p of m.portals) if (p.to.map === mapId && w.seenPortals.includes(portalKey(m.id, p.id)) && isRevealed(w, m.id, p)) return true;
  }
  return false;
}

export function mapState(ctrl: GameController, def: MapDef): CellState {
  const w = ctrl.world();
  if (w.visited.includes(def.id)) return 'visited';
  return seenInto(ctrl, def.id) ? 'seen' : 'unknown';
}

export const KIND_ICON: Record<MapDef['kind'], string> = {
  town: '🏠',
  outpost: '⛺',
  field: '',
  dungeon: '⛓️',
  arena: '⚔️',
  secret: '✨',
};

/** "Quarry Depths I" -> "Quarry Depths". */
function groupName(maps: MapDef[]): string {
  const first = maps.find((m) => m.kind === 'dungeon') ?? maps[0];
  return first.name.replace(/\s+[IVX]+$/, '');
}

function regionDef(id: string): RegionDef | undefined {
  return REGIONS.find((r) => r.id === id);
}

// ------------------------------------------------------------------ region graph model

export interface GraphCell {
  key: string;
  /** Grid position (0-based, region bounds trimmed). */
  x: number;
  y: number;
  /** Every map in this worldCell (dungeon floors share one), in MAPS order. */
  all: MapDef[];
  /** The maps the player knows of here (visited or seen). */
  shown: { def: MapDef; state: CellState }[];
  here: boolean;
  group: boolean;
}

export interface GraphLink {
  a: GraphCell;
  b: GraphCell;
  /** Portal keys (either direction) this link stands for. */
  keys: string[];
  /** Gated portal on this link, if any (pin). */
  gate?: { map: MapDef; portal: PortalDef; open: boolean };
  /** A revealed hidden way. */
  secret: boolean;
}

export interface GraphStub {
  cell: GraphCell;
  map: MapDef;
  portal: PortalDef;
  dest: MapDef;
  region: RegionDef;
  open: boolean;
}

export interface RegionGraph {
  region: RegionDef;
  cols: number;
  rows: number;
  cells: GraphCell[];
  links: GraphLink[];
  stubs: GraphStub[];
}

export function regionGraph(ctrl: GameController, region: RegionDef): RegionGraph | null {
  const world = ctrl.world();
  const book = ctrl.book;
  const here = ctrl.map().def.id;
  const maps = region.maps.map((id) => mapById(id)).filter((m): m is MapDef => !!m);
  if (!maps.length) return null;
  // The graph is trimmed to the cells the player knows of, so it grows as the region is explored.
  const known = maps.filter((m) => mapState(ctrl, m) !== 'unknown');
  if (!known.length) return null;
  const minX = Math.min(...known.map((m) => m.worldCell.x));
  const minY = Math.min(...known.map((m) => m.worldCell.y));
  const cols = Math.max(...known.map((m) => m.worldCell.x)) - minX + 1;
  const rows = Math.max(...known.map((m) => m.worldCell.y)) - minY + 1;
  const byKey = new Map<string, GraphCell>();
  const cellOf = new Map<string, GraphCell>();
  for (const m of maps) {
    const x = m.worldCell.x - minX;
    const y = m.worldCell.y - minY;
    const key = `${x},${y}`;
    let c = byKey.get(key);
    if (!c) byKey.set(key, (c = { key, x, y, all: [], shown: [], here: false, group: false }));
    c.all.push(m);
    cellOf.set(m.id, c);
    const st = mapState(ctrl, m);
    if (known.includes(m)) c.shown.push({ def: m, state: st });
    if (m.id === here) c.here = true;
  }
  const cells = [...byKey.values()].filter((c) => c.shown.length);
  for (const c of cells) c.group = c.all.length > 1;
  if (!cells.length) return null;

  const links = new Map<string, GraphLink>();
  const stubs: GraphStub[] = [];
  for (const c of cells) {
    for (const { def: m, state } of c.shown) {
      if (state !== 'visited') continue;
      for (const p of m.portals) {
        const key = portalKey(m.id, p.id);
        if (!world.seenPortals.includes(key) || !isRevealed(world, m.id, p)) continue;
        const dest = mapById(p.to.map);
        if (!dest) continue;
        if (dest.region !== region.id) {
          const r = regionDef(dest.region);
          if (r) stubs.push({ cell: c, map: m, portal: p, dest, region: r, open: portalOpen(world, book, m.id, p) });
          continue;
        }
        const d = cellOf.get(dest.id);
        if (!d || d === c || !d.shown.length) continue;
        const [a, b] = c.key < d.key ? [c, d] : [d, c];
        const lk = `${a.key}|${b.key}`;
        let link = links.get(lk);
        if (!link) links.set(lk, (link = { a, b, keys: [], secret: false }));
        link.keys.push(key, portalKey(dest.id, p.to.portal));
        if (p.reveal) link.secret = true;
        if (p.gate && !link.gate) link.gate = { map: m, portal: p, open: gateOpen(book, p.gate) };
      }
    }
  }
  return { region, cols, rows, cells, links: [...links.values()], stubs };
}

/** Background tint of a visited map's biome. */
function biomeTint(def: MapDef): string {
  const rgb = GROUND_RGB[BIOMES[def.biome].ground] ?? [80, 90, 110];
  return `rgb(${rgb[0]} ${rgb[1]} ${rgb[2]} / 0.32)`;
}

function bandOf(maps: MapDef[]): string {
  const bands = maps.map((m) => m.levelBand).filter((b): b is [number, number] => !!b);
  if (!bands.length) return '';
  return bandText({ levelBand: [Math.min(...bands.map((b) => b[0])), Math.max(...bands.map((b) => b[1]))] });
}

/** Socket dots for a gate pin / gate card. */
export function socketsHtml(ctrl: GameController, p: PortalDef): string {
  if (!p.gate) return '';
  const sockets = gateSockets(ctrl.book, p.gate);
  const shown = p.gate.elementsKnown !== undefined ? sockets.filter((s, i) => s.need || i < p.gate!.elementsKnown!) : p.gate.flag ? sockets.slice(0, 1) : sockets;
  return `<span class="sockets">${shown
    .map((s) => `<i class="${s.color !== null ? 'lit' : ''}" ${s.color !== null ? `style="--c:${hex(s.color)}"` : ''}></i>`)
    .join('')}</span>`;
}

export interface GraphOptions {
  /** Selected cell key (region-qualified: `<region>:<x>,<y>`). */
  sel?: string;
  /** Portal keys on the highlighted route. */
  route?: ReadonlySet<string>;
  /** Map ids on the highlighted route (cells get a route ring). */
  routeMaps?: ReadonlySet<string>;
  /** Auto-travel destination. */
  navTarget?: string;
}

const FACING_STUB: Record<PortalDef['facing'], [number, number]> = { n: [0, -0.5], s: [0, 0.5], e: [0.5, 0], w: [-0.5, 0] };

/** One region's graph as HTML (cells are buttons `data-cell`, gate pins `data-gate`, stubs `data-stub`). */
export function regionGraphHtml(ctrl: GameController, g: RegionGraph, opt: GraphOptions = {}): string {
  const { cols, rows } = g;
  const pct = (v: number, n: number) => `${((v / n) * 100).toFixed(3)}%`;
  const lines = g.links
    .map((l) => {
      const onRoute = l.keys.some((k) => opt.route?.has(k));
      const cls = [l.gate && !l.gate.open ? 'shut' : '', l.secret ? 'secret' : '', onRoute ? 'route' : ''].filter(Boolean).join(' ');
      return `<line class="${cls}" x1="${l.a.x + 0.5}" y1="${l.a.y + 0.5}" x2="${l.b.x + 0.5}" y2="${l.b.y + 0.5}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const stubLines = g.stubs
    .map((s) => {
      const [dx, dy] = FACING_STUB[s.portal.facing];
      const onRoute = opt.route?.has(portalKey(s.map.id, s.portal.id));
      return `<line class="stub ${s.open ? '' : 'shut'} ${onRoute ? 'route' : ''}" x1="${s.cell.x + 0.5}" y1="${s.cell.y + 0.5}" x2="${s.cell.x + 0.5 + dx * 1.15}" y2="${s.cell.y + 0.5 + dy * 1.15}" vector-effect="non-scaling-stroke"/>`;
    })
    .join('');
  const cells = g.cells
    .map((c) => {
      const key = `${g.region.id}:${c.key}`;
      const visited = c.shown.filter((s) => s.state === 'visited').map((s) => s.def);
      const allSeen = !visited.length;
      const style = `left:${pct(c.x, cols)};top:${pct(c.y, rows)};width:${pct(1, cols)};height:${pct(1, rows)}`;
      const tint = visited.length ? `style="--tint:${biomeTint(visited[0])}"` : '';
      let title: string;
      let sub: string;
      let ico = '';
      if (c.group) {
        title = allSeen ? '?' : groupName(c.all);
        sub = bandOf(visited.length ? visited : c.shown.map((s) => s.def)) || 'Safe';
        ico = '⛓️';
      } else {
        const { def, state } = c.shown[0];
        title = state === 'visited' ? def.name : '?';
        sub = state === 'visited' ? bandText(def) || 'Safe' : bandText(def) || 'Unexplored';
        ico = state === 'visited' ? KIND_ICON[def.kind] : '';
      }
      const ws = visited.some((m) => (m.objects ?? []).some((o) => o.kind === 'waystone' && ctrl.world().waystones.includes(objectKey(m.id, o.id))));
      const onRoute = c.shown.some((s) => opt.routeMaps?.has(s.def.id));
      const nav = !!opt.navTarget && c.all.some((m) => m.id === opt.navTarget);
      const gated = g.links.some((l) => l.gate && c.all.some((m) => m.id === l.gate!.portal.to.map));
      const cls = ['rcell', allSeen ? 'seen' : 'visited', c.here ? 'here' : '', c.group ? 'group' : '', gated ? 'gated' : '', opt.sel === key ? 'sel' : '', onRoute ? 'route' : '', nav ? 'navto' : '']
        .filter(Boolean)
        .join(' ');
      const label = c.group ? `${title}, ${c.shown.length} floors, ${sub}` : `${title === '?' ? 'Unexplored map' : title}, ${sub}`;
      return `<div class="rslot" style="${style}"><button class="${cls}" data-cell="${esc(key)}" ${tint} aria-label="${esc(label)}">
          ${ico ? `<span class="rk">${ico}</span>` : ''}${ws ? '<span class="rws" title="Waystone attuned">🔷</span>' : ''}${
            c.group ? `<span class="rfl" title="${c.shown.length} floors known">${c.shown.length}</span>` : ''
          }
          <b>${esc(title)}</b><small>${esc(sub)}</small>
          ${c.here ? '<span class="rpin" title="You are here">📍</span>' : ''}
        </button></div>`;
    })
    .join('');
  // Gate pins badge the gated destination's top-left corner (a 44 px button over the cell; names stay clear).
  const pins = g.links
    .filter((l) => l.gate)
    .map((l) => {
      const gt = l.gate!;
      const dest = l.a.all.some((m) => m.id === gt.portal.to.map) ? l.a : l.b;
      return `<button class="rgate ${gt.open ? 'open' : ''}" style="left:calc(${pct(dest.x, cols)} + 27px);top:calc(${pct(dest.y, rows)} + 17px)" data-gate="${esc(
        portalKey(gt.map.id, gt.portal.id),
      )}" aria-label="${esc(gt.portal.label ?? 'Gate')}: ${gt.open ? 'open' : 'sealed'}">
        <span class="prism"></span>${socketsHtml(ctrl, gt.portal)}</button>`;
    })
    .join('');
  // Roads to other regions: a signpost chip standing on the cell's edge in the portal's direction.
  const stubs = g.stubs
    .map((s) => {
      const [dx, dy] = FACING_STUB[s.portal.facing];
      const x = s.cell.x + 0.5 + dx;
      const y = s.cell.y + 0.5 + dy * 0.9;
      return `<button class="rstub ${s.open ? 'open' : ''} f-${s.portal.facing}" style="left:${pct(x, cols)};top:${pct(y, rows)}" data-stub="${esc(
        portalKey(s.map.id, s.portal.id),
      )}" aria-label="Road to ${esc(s.region.name)}${s.open ? '' : ' (sealed)'}"><span>${esc(s.region.name)}</span></button>`;
    })
    .join('');
  return `<div class="rgraph" style="--cols:${cols};--rows:${rows}">
      <svg class="rlinks" viewBox="0 0 ${cols} ${rows}" preserveAspectRatio="none" aria-hidden="true">${lines}${stubLines}</svg>
      ${cells}${pins}${stubs}
    </div>`;
}

/** Every region graph the player has a foothold in. */
export function worldGraphs(ctrl: GameController): RegionGraph[] {
  return REGIONS.map((r) => regionGraph(ctrl, r)).filter((g): g is RegionGraph => !!g);
}

// ------------------------------------------------------------------ local map (1:1 compiled render)

interface Marker {
  x: number;
  y: number;
  r: number;
  label: string;
}

export interface LocalStats {
  explored: number;
  secrets: { found: number; total: number };
  chests: { opened: number; total: number };
  waystone: 'none' | 'attuned' | 'unattuned';
}

/** Share of explorable fog cells explored, secrets found, chests opened, waystone state. */
export function localStats(ctrl: GameController, def: MapDef): LocalStats {
  const world = ctrl.world();
  const cm = compiled(def.id);
  const bits = fogBits(world, def.id, cm);
  const { cw, ch } = fogDims(cm);
  let total = 0;
  let seen = 0;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let walk = false;
      for (let y = cy * FOG_CELL; y < Math.min(cm.h, (cy + 1) * FOG_CELL) && !walk; y++) {
        for (let x = cx * FOG_CELL; x < Math.min(cm.w, (cx + 1) * FOG_CELL); x++) {
          if (!(cm.coll[y * cm.w + x] & COLL.BLOCK)) {
            walk = true;
            break;
          }
        }
      }
      if (!walk) continue;
      total++;
      if (cellExplored(bits, cw, cx, cy)) seen++;
    }
  }
  const hidden = def.portals.filter((p) => !!p.reveal);
  const chests = (def.objects ?? []).filter((o) => o.kind === 'chest');
  const ws = (def.objects ?? []).filter((o) => o.kind === 'waystone');
  return {
    explored: total ? seen / total : 1,
    secrets: { found: hidden.filter((p) => isRevealed(world, def.id, p)).length, total: hidden.length },
    chests: { opened: chests.filter((o) => world.chests.includes(objectKey(def.id, o.id))).length, total: chests.length },
    waystone: !ws.length ? 'none' : ws.some((o) => world.waystones.includes(objectKey(def.id, o.id))) ? 'attuned' : 'unattuned',
  };
}

const groundCache = new Map<string, HTMLCanvasElement>();

function groundFor(world: ReturnType<GameController['world']>, def: MapDef): HTMLCanvasElement {
  const hide = unrevealedPortals(world, def);
  const key = `${def.id}|${hide.map((p) => p.id).join(',')}`;
  let c = groundCache.get(key);
  if (!c) {
    c = paintGround(compiled(def.id), 2, hide);
    groundCache.set(key, c);
    if (groundCache.size > 12) groundCache.delete(groundCache.keys().next().value!);
  }
  return c;
}

/**
 * Renders the local map of `mapId` into `wrap` (canvas + tap tooltip). The canvas fills the wrap width (capped so the
 * whole map fits in `maxH` CSS px) and draws at device resolution.
 */
export function renderLocalMap(wrap: HTMLElement, ctrl: GameController, mapId: string, maxH: number, maxW?: number): void {
  const def = mapById(mapId);
  if (!def) return;
  const world = ctrl.world();
  const book = ctrl.book;
  const cm: CompiledMap = compiled(mapId);
  const isHere = ctrl.map().def.id === mapId;
  const avail = Math.max(200, (maxW ?? wrap.clientWidth ?? 340) - 8);
  const ppt = Math.max(2, Math.min(14, avail / cm.w, maxH / cm.h));
  const cssW = Math.floor(cm.w * ppt);
  const cssH = Math.floor(cm.h * ppt);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', `Map of ${def.name}`);
  const g = canvas.getContext('2d')!;
  const k = (ppt * dpr) as number; // device px per tile
  const d = dpr;
  g.imageSmoothingEnabled = false;
  g.drawImage(groundFor(world, def), 0, 0, cm.w * k, cm.h * k);
  // fog (explored cells clear, the rest under a soft veil)
  const fog = paintFog(world, cm, 0.93);
  drawFog(g, fog, 0, 0, k);
  // a subtle tile grid when zoomed in
  if (ppt >= 9) {
    g.strokeStyle = 'rgba(0,0,0,0.08)';
    g.lineWidth = 1;
    g.beginPath();
    for (let x = 1; x < cm.w; x++) {
      g.moveTo(x * k + 0.5, 0);
      g.lineTo(x * k + 0.5, cm.h * k);
    }
    for (let y = 1; y < cm.h; y++) {
      g.moveTo(0, y * k + 0.5);
      g.lineTo(cm.w * k, y * k + 0.5);
    }
    g.stroke();
  }

  const bits = fogBits(world, mapId, cm);
  const { cw } = fogDims(cm);
  const explored = (tx: number, ty: number) => cellExplored(bits, cw, Math.floor(tx / FOG_CELL), Math.floor(ty / FOG_CELL));
  const markers: Marker[] = [];
  const cx = (tx: number) => (tx + 0.5) * k;
  const cy = (ty: number) => (ty + 0.5) * k;
  const R = Math.max(5.5, Math.min(9, ppt * 1.15)) * d;
  const badge = (x: number, y: number, ring: string, emoji: string, dim = false) => {
    g.globalAlpha = dim ? 0.55 : 1;
    disc(g, x, y, R, 'rgba(10,14,28,0.88)', ring, 1.6 * d);
    g.font = `${Math.round(R * 1.15)}px system-ui, "Apple Color Emoji", "Segoe UI Emoji", sans-serif`;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.fillText(emoji, x, y + R * 0.08);
    g.globalAlpha = 1;
  };

  // nodes
  for (const n of def.nodes ?? []) {
    if (!explored(n.tx, n.ty)) continue;
    const ready = nodeReady(world, mapId, n.id);
    const x = cx(n.tx);
    const y = cy(n.ty);
    const s = Math.max(2.4, Math.min(4.5, ppt * 0.55)) * d;
    if (ready) {
      g.fillStyle = 'rgba(8,12,26,0.95)';
      g.fillRect(x - s - d, y - s - d, 2 * s + 2 * d, 2 * s + 2 * d);
      g.fillStyle = NODE_RGB[n.kind];
      g.fillRect(x - s, y - s, 2 * s, 2 * s);
    } else disc(g, x, y, s * 0.7, 'rgba(120,126,140,0.8)');
    markers.push({ x: x / d, y: y / d, r: 12, label: `${nodeLabel(n.kind)}${ready ? '' : ' (depleted)'}` });
  }
  // objects
  for (const o of def.objects ?? []) {
    if (!explored(o.tx, o.ty)) continue;
    const x = cx(o.tx);
    const y = cy(o.ty);
    switch (o.kind) {
      case 'waystone': {
        const lit = world.waystones.includes(objectKey(mapId, o.id));
        diamond(g, x, y, R * 0.95, lit ? OBJECT_RGB.waystone : '#4f7480', 'rgba(8,12,26,0.95)', 1.6 * d);
        if (lit) disc(g, x, y, R * 0.28, '#ffffff');
        markers.push({ x: x / d, y: y / d, r: 14, label: lit ? 'Waystone (attuned)' : 'Waystone — touch to attune' });
        break;
      }
      case 'chest': {
        const opened = world.chests.includes(objectKey(mapId, o.id));
        badge(x, y, OBJECT_RGB.chest, opened ? '📭' : '🎁', opened);
        markers.push({ x: x / d, y: y / d, r: 14, label: opened ? 'Chest (opened)' : 'Chest' });
        break;
      }
      default: {
        const em = { altar: '⚗️', wind_shrine: '🌀', obelisk: '🗿', signpost: '🪧', statue: '🗽', campfire: '🔥' }[o.kind] ?? '•';
        badge(x, y, OBJECT_RGB[o.kind], em);
        const names: Record<string, string> = {
          altar: 'Fusion Altar',
          wind_shrine: 'Shrine of Winds',
          obelisk: 'Umbral Obelisk',
          signpost: 'Signpost',
          statue: 'Statue',
          campfire: 'Campfire',
        };
        markers.push({ x: x / d, y: y / d, r: 14, label: names[o.kind] ?? o.kind });
      }
    }
  }
  // NPCs
  for (const n of def.npcs ?? []) {
    if (!explored(n.tx, n.ty)) continue;
    const npc = NPC_BY_ID.get(n.npc);
    const x = cx(n.tx);
    const y = cy(n.ty);
    badge(x, y, '#ffe9a0', npc?.portrait ?? '🙂');
    markers.push({ x: x / d, y: y / d, r: 14, label: npc ? `${npc.name} — ${npc.title}` : n.npc });
  }
  // portals (every seen one, even under fog: their signs are visible from afar)
  g.font = `600 ${Math.round(10 * d)}px system-ui, sans-serif`;
  for (const p of def.portals) {
    if (!isRevealed(world, mapId, p)) continue;
    const key = portalKey(mapId, p.id);
    if (!world.seenPortals.includes(key) && !isHere) continue;
    const open = portalOpen(world, book, mapId, p);
    const x = (p.tx + p.w / 2) * k;
    const y = (p.ty + p.h / 2) * k;
    if (p.reveal) {
      g.beginPath();
      g.arc(x, y, R * 1.55, 0, Math.PI * 2);
      g.strokeStyle = 'rgba(228, 210, 255, 0.85)';
      g.lineWidth = 1.5 * d;
      g.setLineDash([3 * d, 2.5 * d]);
      g.stroke();
      g.setLineDash([]);
    }
    portalGlyph(g, p, x, y, R * 0.95, open, 1.3 * d);
    // in-world signs name the destination, so the map does too (dimmer while unexplored)
    const name = mapById(p.to.map)?.name ?? '?';
    const visitedDest = world.visited.includes(p.to.map);
    const text = p.label && p.gate ? p.label : `→ ${name}`;
    // label inside the map, beside the portal, away from the border it sits on
    const tw = g.measureText(text).width;
    let lx = x;
    let ly = y;
    if (p.facing === 'w') lx = x + R * 1.4 + tw / 2;
    else if (p.facing === 'e') lx = x - R * 1.4 - tw / 2;
    else if (p.facing === 'n') ly = y + R * 1.9;
    else ly = y - R * 1.9;
    lx = Math.max(tw / 2 + 3 * d, Math.min(canvas.width - tw / 2 - 3 * d, lx));
    ly = Math.max(8 * d, Math.min(canvas.height - 8 * d, ly));
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.lineWidth = 3 * d;
    g.strokeStyle = 'rgba(8,12,26,0.9)';
    g.strokeText(text, lx, ly);
    g.fillStyle = !open ? '#b8bdcc' : visitedDest ? '#ffe9a0' : '#e8dcc0';
    g.fillText(text, lx, ly);
    const dest = mapById(p.to.map);
    const status = p.gate && !open ? ' — sealed' : '';
    markers.push({
      x: x / d,
      y: y / d,
      r: 16,
      label: `${p.reveal ? '✨ Hidden way' : p.gate ? (p.label ?? 'Gate') : 'Exit'}: ${dest?.name ?? '?'}${visitedDest ? '' : ' (unexplored)'}${status}`,
    });
  }
  // the player
  if (isHere) {
    const v = ctrl.minimap();
    const x = (v.px / TILE) * k;
    const y = (v.py / TILE) * k;
    g.beginPath();
    g.arc(x, y, R * 1.6, 0, Math.PI * 2);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fill();
    playerArrow(g, x, y, R * 0.8, -Math.PI / 2, 1.4 * d);
    markers.push({ x: x / d, y: y / d, r: 16, label: 'You are here' });
  }

  wrap.innerHTML = '';
  const frame = document.createElement('div');
  frame.className = 'lmap-frame';
  frame.appendChild(canvas);
  const tip = document.createElement('div');
  tip.className = 'lmap-tip hidden';
  frame.appendChild(tip);
  wrap.appendChild(frame);
  canvas.addEventListener('click', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = ((e.clientX - r.left) / r.width) * cssW;
    const sy = ((e.clientY - r.top) / r.height) * cssH;
    let best: Marker | null = null;
    let bd = Infinity;
    for (const m of markers) {
      const dd = Math.hypot(m.x - sx, m.y - sy);
      if (dd < Math.max(m.r, 18) && dd < bd) {
        best = m;
        bd = dd;
      }
    }
    if (!best) {
      tip.classList.add('hidden');
      return;
    }
    tip.textContent = best.label;
    tip.classList.remove('hidden');
    tip.style.left = `${3 + Math.max(8, Math.min(cssW - 8, best.x))}px`;
    tip.style.top = `${3 + best.y}px`;
    tip.classList.toggle('below', best.y < 40);
  });
}

function nodeLabel(kind: string): string {
  return (
    {
      ore: 'Ore vein',
      fishing: 'Fishing spot',
      herb: 'Herbs',
      ember_vent: 'Ember vent',
      wind_chime: 'Wind chime',
      storm_tree: 'Storm tree',
      shadow_fungus: 'Shadow fungus',
      sun_spring: 'Sun spring',
      frost_crystal: 'Frost crystal',
    }[kind] ?? kind
  );
}
