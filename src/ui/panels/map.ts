// Map panel (docs/CLIENT-v2.md §7) — foundation version: Travel list (when opened from a waystone / Waykeeper with
// arg 'travel'), the region grid (worldmap.ts), and every visited map with a Navigate button (auto-travel over
// discovered portals). The hud-maps stage adds the local 1:1 map with fog and the full region graph.
import { REGIONS, mapById } from '../../data/world';
import { $$, bandText, esc } from '../util';
import { worldMapHtml } from '../worldmap';
import type { PanelHost } from './common';

export function renderMap(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const world = ctrl.world();
  const here = ctrl.map().def;
  const travel = arg === 'travel';
  const targets = travel ? ctrl.travelTargets() : [];
  const coins = ctrl.session.player.coins;
  const travelHtml = travel
    ? `<h3>Travel</h3>${
        targets.length
          ? targets
              .map(
                (t) => `<div class="trow"><span class="ico">🔷</span><span><b>${esc(t.name)}</b><small>${esc(t.region)}${t.cost ? ` · 🪙${t.cost}` : ' · free'}</small></span>
              <button class="btn gold" data-travel="${esc(t.key)}" ${t.cost > coins ? 'disabled' : ''}>Travel</button></div>`,
              )
              .join('')
          : '<p class="sub">Touch other waystones to travel between them. Crossing to another region costs 🪙40.</p>'
      }`
    : '';
  const visited = REGIONS.map((r) => {
    const list = r.maps.filter((id) => world.visited.includes(id)).map((id) => mapById(id)!);
    if (!list.length) return '';
    return `<h3>${esc(r.name)}</h3>${list
      .map(
        (m) => `<div class="trow ${m.id === here.id ? 'here' : ''}"><span class="ico">${m.id === here.id ? '📍' : m.safety === 'safe' ? '🏠' : '🗺️'}</span>
          <span><b>${esc(m.name)}</b><small>${bandText(m) || 'Safe haven'}${m.landmark ? ` · ${esc(m.landmark)}` : ''}</small></span>
          ${m.id === here.id ? '<small class="you">You are here</small>' : `<button class="btn" data-nav="${esc(m.id)}">Navigate</button>`}</div>`,
      )
      .join('')}`;
  }).join('');
  const body = `
    <p class="sub">📍 <b>${esc(here.name)}</b>${bandText(here) ? ` · ${bandText(here)}` : ''}${travel ? '' : ' — travel between waystones from any attuned stone or a Waykeeper.'}</p>
    ${travelHtml}
    <h3>World</h3>${worldMapHtml(ctrl)}
    ${visited}`;
  host.sheet('🗺️ Map', body, 'mapsheet');
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    if (!r.ok) host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-travel]').forEach((b) => b.addEventListener('click', () => after(ctrl.travel(b.dataset.travel!))));
  $$<HTMLButtonElement>(host.modal, '[data-nav]').forEach((b) => b.addEventListener('click', () => after(ctrl.navigateTo(b.dataset.nav!))));
}
