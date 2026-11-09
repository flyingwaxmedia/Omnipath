// Map panel (docs/CLIENT-v2.md §7): tabs Travel (only at a waystone / Waykeeper) | World (region graphs with links,
// gate pins, floors popover, route preview and Navigate) | Local (the 1:1 map of the current or a chosen visited map
// under its fog, with portals, NPCs, nodes, waystones and secrets found).
// Opened from the menu, the minimap, a waystone/Waykeeper (`arg 'travel'`) or the auto-travel pill (`arg 'route'`).
import { portalKey } from '../../core/world/graph';
import type { MapDef, PortalDef } from '../../core/world/types';
import { NPCS } from '../../data/npcs';
import { REGIONS, mapById } from '../../data/world';
import { TILE, discoveredRoute, gateText, isRevealed, objectKey, portalOpen } from '../../game/world/runtime';
import type { GameController } from '../controller';
import { $$, bandText, esc } from '../util';
import {
  KIND_ICON,
  localStats,
  mapState,
  regionGraphHtml,
  renderLocalMap,
  socketsHtml,
  worldGraphs,
  type GraphCell,
  type RegionGraph,
} from '../worldmap';
import { tabsHtml, wireTabs, type PanelHost } from './common';

const NPC_ROLE = new Map(NPCS.map((n) => [n.id, n.role]));

type Tab = 'travel' | 'world' | 'local';

const KIND_TEXT: Record<MapDef['kind'], string> = {
  town: 'Town',
  outpost: 'Outpost',
  field: 'Wilds',
  dungeon: 'Dungeon floor',
  arena: 'Warden arena',
  secret: 'Secret place',
};

/** Standing within 3 tiles of a waystone or a Waykeeper (mirrors the controller's travel check). */
function nearTravel(ctrl: GameController): boolean {
  try {
    const def = ctrl.map().def;
    const v = ctrl.minimap();
    const near = (tx: number, ty: number) => Math.hypot((tx + 0.5) * TILE - v.px, (ty + 0.5) * TILE - v.py) <= TILE * 3;
    return (
      (def.objects ?? []).some((o) => o.kind === 'waystone' && near(o.tx, o.ty)) ||
      (def.npcs ?? []).some((n) => NPC_ROLE.get(n.npc) === 'waykeeper' && near(n.tx, n.ty))
    );
  } catch {
    return false;
  }
}

function regionName(id: string): string {
  return REGIONS.find((r) => r.id === id)?.name ?? id;
}

/** Route chips "Here → A → B" for a destination, or a reason there is none. */
function routeHtml(ctrl: GameController, to: string): { html: string; ok: boolean; hops: number } {
  const here = ctrl.map().def.id;
  if (to === here) return { html: '<div class="rroute"><span class="chip here">📍 You are here</span></div>', ok: false, hops: 0 };
  const route = discoveredRoute(ctrl.world(), ctrl.book, here, to);
  if (!route) {
    return {
      html: '<p class="sub rnone">No open road you know of leads there from here yet.</p>',
      ok: false,
      hops: 0,
    };
  }
  const names = [mapById(here)?.name ?? here];
  for (const s of route) {
    const p = mapById(s.map)?.portals.find((x) => x.id === s.portal);
    const dest = p ? mapById(p.to.map) : undefined;
    names.push(dest ? (ctrl.world().visited.includes(dest.id) ? dest.name : '?') : '?');
  }
  const chips = names.map((n, i) => `<span class="chip ${i === 0 ? 'here' : i === names.length - 1 ? 'end' : ''}">${esc(n)}</span>`).join('<i class="arr">›</i>');
  return {
    html: `<div class="rroute" aria-label="Route">${chips}<small>${route.length} portal${route.length === 1 ? '' : 's'}</small></div>`,
    ok: true,
    hops: route.length,
  };
}

/** Portal keys + map ids along the route to `to` (for highlighting the graph). */
function routeSets(ctrl: GameController, to: string | undefined): { keys: Set<string>; maps: Set<string> } {
  const keys = new Set<string>();
  const maps = new Set<string>();
  if (!to) return { keys, maps };
  const here = ctrl.map().def.id;
  const route = to === here ? null : discoveredRoute(ctrl.world(), ctrl.book, here, to);
  if (!route) return { keys, maps };
  maps.add(here);
  for (const s of route) {
    keys.add(portalKey(s.map, s.portal));
    const p = mapById(s.map)?.portals.find((x) => x.id === s.portal);
    if (p) maps.add(p.to.map);
  }
  return { keys, maps };
}

/** The attuned waystone key of a map, if any. */
function attunedStone(ctrl: GameController, def: MapDef): string | undefined {
  const w = ctrl.world();
  return (def.objects ?? []).filter((o) => o.kind === 'waystone').map((o) => objectKey(def.id, o.id)).find((k) => w.waystones.includes(k));
}

/** A gated portal leading into `mapId` from a visited map (for the "?" popover). */
function gateInto(ctrl: GameController, mapId: string): { map: MapDef; portal: PortalDef } | undefined {
  const w = ctrl.world();
  for (const id of w.visited) {
    const m = mapById(id);
    const p = m?.portals.find((x) => x.to.map === mapId && x.gate && isRevealed(w, id, x));
    if (m && p) return { map: m, portal: p };
  }
  return undefined;
}

function gateCard(ctrl: GameController, map: MapDef, p: PortalDef): string {
  if (!p.gate) return '';
  const open = portalOpen(ctrl.world(), ctrl.book, map.id, p);
  return `<div class="rgatecard ${open ? 'open' : ''}">
      <div class="gtop"><span class="prism"></span><b>${esc(p.label ?? 'Sealed gate')}</b><small>${open ? 'Open' : 'Sealed'}</small></div>
      ${socketsHtml(ctrl, p)}
      <div class="gtext">${gateText(ctrl.book, p.gate)}</div>
      ${open ? '' : `<p class="sub">${esc(p.gate.hint)}</p>`}
    </div>`;
}

// ------------------------------------------------------------------ popovers

function mapPopover(ctrl: GameController, def: MapDef, travelOk: boolean): string {
  const st = mapState(ctrl, def);
  const here = ctrl.map().def.id === def.id;
  const r = routeHtml(ctrl, def.id);
  if (st !== 'visited') {
    const gate = gateInto(ctrl, def.id);
    return `<header><span class="ico">❔</span><span><b>Unexplored</b><small>${esc(bandText(def) || 'Safe')} · ${esc(regionName(def.region))}</small></span>${closeBtn()}</header>
      <p class="sub">You have seen a road leading here, but never walked it.</p>
      ${gate ? gateCard(ctrl, gate.map, gate.portal) : ''}
      ${r.html}
      <div class="btns">${r.ok ? `<button class="btn gold" data-nav="${esc(def.id)}">🧭 Navigate</button>` : ''}</div>`;
  }
  const s = localStats(ctrl, def);
  const stone = attunedStone(ctrl, def);
  const fare = stone ? ctrl.travelTargets().find((t) => t.key === stone) : undefined;
  const meta = [
    `<span class="chip">👣 ${Math.round(s.explored * 100)}% explored</span>`,
    s.waystone === 'attuned' ? '<span class="chip ok">🔷 Waystone attuned</span>' : s.waystone === 'unattuned' ? '<span class="chip">🔹 Waystone not attuned</span>' : '',
    s.secrets.total ? `<span class="chip ${s.secrets.found === s.secrets.total ? 'ok' : ''}">✨ Secrets ${s.secrets.found}/${s.secrets.total}</span>` : '',
    s.chests.total ? `<span class="chip ${s.chests.opened === s.chests.total ? 'ok' : ''}">🎁 Chests ${s.chests.opened}/${s.chests.total}</span>` : '',
  ].join('');
  return `<header><span class="ico">${KIND_ICON[def.kind] || '🗺️'}</span><span><b>${esc(def.name)}</b><small>${esc(bandText(def) || 'Safe haven')} · ${esc(
    KIND_TEXT[def.kind],
  )} · ${esc(regionName(def.region))}</small></span>${closeBtn()}</header>
    ${def.landmark ? `<p class="sub">${esc(def.landmark)}</p>` : ''}
    <div class="rmeta">${meta}</div>
    ${r.html}
    <div class="btns">
      <button class="btn" data-local="${esc(def.id)}">🗺️ Area map</button>
      ${travelOk && fare && !here ? `<button class="btn" data-travel="${esc(fare.key)}" ${fare.cost > ctrl.session.player.coins ? 'disabled' : ''}>🔷 Travel${fare.cost ? ` 🪙${fare.cost}` : ''}</button>` : ''}
      ${r.ok ? `<button class="btn gold" data-nav="${esc(def.id)}">🧭 Navigate</button>` : ''}
    </div>`;
}

function floorsPopover(ctrl: GameController, cell: GraphCell): string {
  const here = ctrl.map().def.id;
  const visited = cell.shown.filter((s) => s.state === 'visited').map((s) => s.def);
  const title = visited.length ? (cell.all.find((m) => m.kind === 'dungeon') ?? cell.all[0]).name.replace(/\s+[IVX]+$/, '') : 'Unexplored depths';
  const rows = cell.shown
    .map(({ def, state }) => {
      const isHere = def.id === here;
      const route = isHere ? null : discoveredRoute(ctrl.world(), ctrl.book, here, def.id);
      const name = state === 'visited' ? def.name : '?';
      const gate = state !== 'visited' ? gateInto(ctrl, def.id) : undefined;
      return `<div class="trow floor ${isHere ? 'here' : ''}"><span class="ico">${isHere ? '📍' : state !== 'visited' ? '❔' : KIND_ICON[def.kind] || '🗺️'}</span>
        <span><b>${esc(name)}</b><small>${esc(bandText(def) || 'Safe haven')}${state === 'visited' ? '' : ' · unexplored'}${
          route ? ` · ${route.length} portal${route.length === 1 ? '' : 's'}` : ''
        }</small>${gate ? socketsHtml(ctrl, gate.portal) : ''}</span>
        <span class="fbtns">${state === 'visited' ? `<button class="btn" data-local="${esc(def.id)}" aria-label="Area map of ${esc(def.name)}">🗺️</button>` : ''}${
          route ? `<button class="btn gold" data-nav="${esc(def.id)}">Go</button>` : isHere ? '<small class="you">Here</small>' : ''
        }</span></div>`;
    })
    .join('');
  const unknown = cell.all.length - cell.shown.length;
  return `<header><span class="ico">⛓️</span><span><b>${esc(title)}</b><small>${cell.shown.length} floor${cell.shown.length === 1 ? '' : 's'} known${
    unknown ? ' · more lie deeper' : ''
  }</small></span>${closeBtn()}</header>
    <div class="floors">${rows}</div>`;
}

function stubPopover(ctrl: GameController, key: string): string {
  const [mapId, pid] = [key.slice(0, key.indexOf('#')), key.slice(key.indexOf('#') + 1)];
  const map = mapById(mapId);
  const p = map?.portals.find((x) => x.id === pid);
  if (!map || !p) return '';
  const dest = mapById(p.to.map);
  if (!dest) return '';
  const r = routeHtml(ctrl, dest.id);
  const known = ctrl.world().visited.includes(dest.id);
  return `<header><span class="ico">🌐</span><span><b>Road to ${esc(regionName(dest.region))}</b><small>${esc(
    known ? dest.name : 'Unexplored',
  )} · ${esc(bandText(dest) || 'Safe')}</small></span>${closeBtn()}</header>
    <p class="sub">From ${esc(map.name)}${p.label ? ` — ${esc(p.label)}` : ''}.</p>
    ${gateCard(ctrl, map, p)}
    ${r.html}
    <div class="btns">${r.ok ? `<button class="btn gold" data-nav="${esc(dest.id)}">🧭 Navigate</button>` : ''}</div>`;
}

function gatePopover(ctrl: GameController, key: string): string {
  const [mapId, pid] = [key.slice(0, key.indexOf('#')), key.slice(key.indexOf('#') + 1)];
  const map = mapById(mapId);
  const p = map?.portals.find((x) => x.id === pid);
  if (!map || !p) return '';
  const dest = mapById(p.to.map);
  return `<header><span class="ico">💠</span><span><b>${esc(p.label ?? 'Sealed gate')}</b><small>${esc(map.name)} → ${esc(
    dest && ctrl.world().visited.includes(dest.id) ? dest.name : '?',
  )}</small></span>${closeBtn()}</header>
    ${gateCard(ctrl, map, p)}`;
}

const closeBtn = () => '<button class="x popx" data-popx aria-label="Close details">✕</button>';

// ------------------------------------------------------------------ tabs

function travelTab(ctrl: GameController): string {
  const targets = ctrl.travelTargets();
  const coins = ctrl.session.player.coins;
  const rows = targets
    .map(
      (t) => `<div class="trow"><span class="ico">🔷</span><span><b>${esc(t.name)}</b><small>${esc(t.region)} · ${t.cost ? `🪙${t.cost}` : 'free'}</small></span>
        <button class="btn gold" data-travel="${esc(t.key)}" ${t.cost > coins ? 'disabled' : ''}>Travel</button></div>`,
    )
    .join('');
  return `<p class="sub">Step between attuned waystones. Stones in the same region are free; crossing to another region costs 🪙40. You carry 🪙${coins}.</p>
    ${rows || '<p class="sub empty">No other waystone answers yet. Touch waystones on your journey and they will remember you.</p>'}`;
}

function worldTab(ctrl: GameController, graphs: RegionGraph[], sel: string | undefined, travelOk: boolean): string {
  const here = ctrl.map().def;
  const nav = ctrl.session.nav;
  // highlight: the selected destination's route, else the auto-travel route
  let target: string | undefined;
  let popover = '';
  if (sel?.startsWith('cell:')) {
    const key = sel.slice(5);
    const g = graphs.find((x) => key.startsWith(`${x.region.id}:`));
    const cell = g?.cells.find((c) => `${g.region.id}:${c.key}` === key);
    if (cell) {
      if (cell.group) popover = floorsPopover(ctrl, cell);
      else {
        target = cell.shown[0].def.id;
        popover = mapPopover(ctrl, cell.shown[0].def, travelOk);
      }
    }
  } else if (sel?.startsWith('gate:')) popover = gatePopover(ctrl, sel.slice(5));
  else if (sel?.startsWith('stub:')) {
    popover = stubPopover(ctrl, sel.slice(5));
    const k = sel.slice(5);
    const p = mapById(k.slice(0, k.indexOf('#')))?.portals.find((x) => x.id === k.slice(k.indexOf('#') + 1));
    target = p?.to.map;
  }
  const hl = routeSets(ctrl, target ?? nav?.target);
  const selKey = sel?.startsWith('cell:') ? sel.slice(5) : undefined;
  const navRow = nav
    ? `<div class="navrow"><span>🧭 Navigating to <b>${esc(mapById(nav.target)?.name ?? nav.target)}</b></span><button class="btn" data-stopnav>Stop</button></div>`
    : '';
  const regions = graphs
    .map(
      (g) => `<section class="region" data-region="${esc(g.region.id)}"><h3>${esc(g.region.name)} <small>Lv ${g.region.levelBand[0]}–${g.region.levelBand[1]}${
        g.region.id === here.region ? ' · you are here' : ''
      }</small></h3>
        ${regionGraphHtml(ctrl, g, { sel: selKey, route: hl.keys, routeMaps: hl.maps, navTarget: nav?.target })}</section>`,
    )
    .join('');
  const legend = `<div class="rlegend" aria-label="Legend">
      <span><i class="lg here"></i>You</span><span><i class="lg visited"></i>Visited</span><span><i class="lg seen"></i>Unexplored</span>
      <span><i class="lg gate"></i>Gate</span><span><i class="lg route"></i>Route</span></div>`;
  return `${navRow}${regions}${legend}
    <p class="sub tip">Tap a place for its route. <b>Navigate</b> walks you there along roads you have already found.</p>
    ${popover ? `<div class="rpop" role="dialog" aria-label="Place details">${popover}</div>` : ''}`;
}

function localTab(ctrl: GameController, mapId: string): string {
  const def = mapById(mapId)!;
  const here = ctrl.map().def;
  const isHere = def.id === here.id;
  const s = localStats(ctrl, def);
  const options = REGIONS.map((r) => {
    const list = r.maps.filter((id) => ctrl.world().visited.includes(id)).map((id) => mapById(id)!);
    if (!list.length) return '';
    return `<optgroup label="${esc(r.name)}">${list
      .map((m) => `<option value="${esc(m.id)}" ${m.id === def.id ? 'selected' : ''}>${m.id === here.id ? '📍 ' : ''}${esc(m.name)}</option>`)
      .join('')}</optgroup>`;
  }).join('');
  const route = isHere ? null : discoveredRoute(ctrl.world(), ctrl.book, here.id, def.id);
  const chips = [
    `<span class="chip">👣 ${Math.round(s.explored * 100)}% explored</span>`,
    s.waystone === 'attuned' ? '<span class="chip ok">🔷 Attuned</span>' : s.waystone === 'unattuned' ? '<span class="chip">🔹 Waystone unattuned</span>' : '',
    s.secrets.total ? `<span class="chip ${s.secrets.found === s.secrets.total ? 'ok' : ''}">✨ Secrets ${s.secrets.found}/${s.secrets.total}</span>` : '',
    s.chests.total ? `<span class="chip ${s.chests.opened === s.chests.total ? 'ok' : ''}">🎁 ${s.chests.opened}/${s.chests.total}</span>` : '',
  ].join('');
  return `<div class="ltab"><div class="lhead">
      <span class="lname"><b>${KIND_ICON[def.kind] ? `${KIND_ICON[def.kind]} ` : ''}${esc(def.name)}</b><small>${esc(bandText(def) || 'Safe haven')} · ${esc(
        regionName(def.region),
      )}${isHere ? ' · you are here' : ''}</small></span>
      <label class="lpick"><span class="sr">Show map</span><select data-pick aria-label="Show another visited map">${options}</select></label>
    </div>
    <div class="lmap" data-lmap></div>
    <div class="lside">
    <div class="rmeta">${chips}</div>
    <div class="llegend" aria-label="Legend">
      <span><i class="lg you"></i>You</span><span><i class="lg exit"></i>Exit</span><span><i class="lg stone"></i>Waystone</span>
      <span><i class="lg npc"></i>People</span><span><i class="lg node"></i>Gathering</span><span><i class="lg secret"></i>Secret</span>
    </div>
    <p class="sub tip">Tap a marker to name it. Unexplored ground stays veiled until you walk near it.</p>
    ${
      isHere
        ? ''
        : `<div class="btns lbtns"><button class="btn" data-local="${esc(here.id)}">📍 Back to ${esc(here.name)}</button>${
            route ? `<button class="btn gold" data-nav="${esc(def.id)}">🧭 Navigate · ${route.length} portal${route.length === 1 ? '' : 's'}</button>` : ''
          }</div>`
    }</div></div>`;
}

// ------------------------------------------------------------------ panel

/** Shrinks region-cell names whose longest word would overflow a narrow cell (never breaks words mid-way). */
function fitCellNames(root: HTMLElement): void {
  for (const b of $$<HTMLElement>(root, '.rcell b')) {
    let size = 11.5;
    b.style.fontSize = '';
    while (size > 8 && b.scrollWidth > b.clientWidth + 1) {
      size -= 0.5;
      b.style.fontSize = `${size}px`;
    }
  }
}

export function renderMap(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const st = host.state;
  const here = ctrl.map().def;
  const fresh = !host.modal.querySelector('.sheet.mapsheet') || st['map.arg'] !== (arg ?? '');
  const travelOk = arg === 'travel' || nearTravel(ctrl);
  if (fresh) {
    st['map.arg'] = arg ?? '';
    st['map.local'] = here.id;
    st['map.sel'] = undefined;
    if (arg === 'travel' && travelOk) st['map.tab'] = 'travel';
    else if (arg === 'route') {
      st['map.tab'] = 'world';
      const target = ctrl.session.nav?.target;
      const def = target ? mapById(target) : undefined;
      if (def) {
        const g = worldGraphs(ctrl).find((x) => x.region.id === def.region);
        const cell = g?.cells.find((c) => c.all.some((m) => m.id === def.id));
        if (g && cell && !cell.group) st['map.sel'] = `cell:${g.region.id}:${cell.key}`;
      }
    }
  }
  let current = (st['map.tab'] as Tab | undefined) ?? 'world';
  if (current === 'travel' && !travelOk) current = 'world';
  st['map.tab'] = current;
  const localId = mapById((st['map.local'] as string) ?? '') && ctrl.world().visited.includes(st['map.local'] as string) ? (st['map.local'] as string) : here.id;
  const tabs: [string, string][] = [
    ...(travelOk ? ([['travel', '🔷 Travel']] as [string, string][]) : []),
    ['world', '🗺️ World'],
    ['local', '📍 Local'],
  ];
  const graphs = current === 'world' ? worldGraphs(ctrl) : [];
  const body =
    current === 'travel'
      ? travelTab(ctrl)
      : current === 'world'
        ? worldTab(ctrl, graphs, st['map.sel'] as string | undefined, travelOk)
        : localTab(ctrl, localId);
  const title = `🗺️ ${esc(here.name)}<small class="hband">${esc(bandText(here) || 'Safe haven')}</small>`;
  host.sheet(title, `${tabsHtml('map.tab', tabs, current)}<div class="mapbody tab-${current}">${body}</div>`, 'mapsheet');
  wireTabs(host, 'map.tab');

  const m = host.modal;
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    if (!r.ok) host.render();
  };
  $$<HTMLButtonElement>(m, '[data-travel]').forEach((b) => b.addEventListener('click', () => after(ctrl.travel(b.dataset.travel!))));
  // a successful Navigate closes the panel and the scene announces the walk itself
  $$<HTMLButtonElement>(m, '[data-nav]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.navigateTo(b.dataset.nav!);
      if (!r.ok) after(r);
    }),
  );
  $$<HTMLButtonElement>(m, '[data-cell]').forEach((b) =>
    b.addEventListener('click', () => {
      const key = `cell:${b.dataset.cell}`;
      st['map.sel'] = st['map.sel'] === key ? undefined : key;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(m, '[data-gate]').forEach((b) =>
    b.addEventListener('click', () => {
      st['map.sel'] = `gate:${b.dataset.gate}`;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(m, '[data-stub]').forEach((b) =>
    b.addEventListener('click', () => {
      st['map.sel'] = `stub:${b.dataset.stub}`;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(m, '[data-popx]').forEach((b) =>
    b.addEventListener('click', () => {
      st['map.sel'] = undefined;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(m, '[data-local]').forEach((b) =>
    b.addEventListener('click', () => {
      st['map.local'] = b.dataset.local;
      st['map.tab'] = 'local';
      host.render();
    }),
  );
  m.querySelector<HTMLSelectElement>('[data-pick]')?.addEventListener('change', (e) => {
    st['map.local'] = (e.target as HTMLSelectElement).value;
    host.render();
  });
  m.querySelector<HTMLButtonElement>('[data-stopnav]')?.addEventListener('click', () => {
    const c = ctrl as GameController & { cancelNavigate?: () => void };
    if (c.cancelNavigate) c.cancelNavigate();
    else c.session.nav = null;
    host.toast('🧭 Auto-travel stopped.');
    host.render();
  });

  const wrap = m.querySelector<HTMLElement>('[data-lmap]');
  if (wrap) {
    // landscape phones put the map beside its legend (see maps.css .ltab)
    const side = window.innerHeight < 500 && window.innerWidth >= 600;
    const body = m.querySelector<HTMLElement>('.sheet-body');
    const tabsH = m.querySelector<HTMLElement>('.tabs')?.offsetHeight ?? 50;
    const maxW = side && body ? body.clientWidth * 0.6 : undefined;
    // landscape: fit the sheet's visible height; portrait: about half the screen
    const maxH = side && body ? body.clientHeight - tabsH - 22 : window.innerHeight * 0.5;
    renderLocalMap(wrap, ctrl, localId, Math.max(160, maxH), maxW);
  }
  fitCellNames(m);
  // keep the selected place in view
  if (fresh && st['map.sel']) {
    const selEl = m.querySelector<HTMLElement>('.rcell.sel');
    selEl?.scrollIntoView({ block: 'center' });
  }
}
