// Bag (docs/CLIENT-v2.md §7): coins, materials, consumables (use), relics, weapons (equip / buy hint).
// Opened with arg 'sell' from a Waykeeper: materials get Sell buttons (the controller re-checks the Waykeeper).
import type { ItemDef, WeaponType } from '../../core/types';
import { WEAPONS } from '../../data/weapons';
import { $$, esc } from '../util';
import type { PanelHost } from './common';

export function renderBag(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const p = ctrl.session.player;
  const selling = arg === 'sell';
  const held = Object.entries(p.bag)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ it: ctrl.reg.item(id), id, n }))
    .filter((x): x is { it: ItemDef; id: string; n: number } => !!x.it);
  const of = (kind: ItemDef['kind']) => held.filter((x) => x.it.kind === kind);
  const row = (x: { it: ItemDef; id: string; n: number }, btn = '') =>
    `<div class="irow"><span class="ico">${x.it.icon}</span><span><b>${esc(x.it.name)}</b> <small>×${x.n}</small><small>${esc(x.it.desc)}</small></span>${btn}</div>`;
  const mats = of('material')
    .map((x) => {
      const price = x.it.kind === 'material' ? (x.it.price ?? 0) : 0;
      return row(
        x,
        selling && price
          ? `<span class="btns"><button class="btn" data-sell="${esc(x.id)}" data-n="1">Sell 1 · 🪙${price}</button><button class="btn gold" data-sell="${esc(x.id)}" data-n="${x.n}">All · 🪙${price * x.n}</button></span>`
          : '',
      );
    })
    .join('');
  const cons = of('consumable')
    .map((x) => row(x, `<button class="btn gold" data-use="${esc(x.id)}">Use</button>`))
    .join('');
  const relics = of('relic').map((x) => row(x)).join('');
  const body = `
    <div class="stat-grid">
      <div><b>🪙 ${p.coins}</b><small>coins</small></div>
      <div><b>${held.reduce((a, x) => a + x.n, 0)}</b><small>items</small></div>
      <div><b>${ctrl.book.stats().essencesHeld}</b><small>essences</small></div>
    </div>
    ${selling ? '<p class="sub">🧭 The Waykeeper buys gathered materials.</p>' : ''}
    <h3>Materials</h3>${mats || '<p class="sub">Nothing gathered yet. Ore, herbs, fish and stranger things grow on the map.</p>'}
    <h3>Consumables</h3>${cons || '<p class="sub">No draughts or seeds.</p>'}
    ${relics ? `<h3>Relics</h3>${relics}` : ''}
    <h3>Weapons</h3>
    <div class="weapons">${p.ownedWeapons
      .map((w) => {
        const d = WEAPONS[w];
        const on = p.weapon === w;
        return `<div class="wpn ${on ? 'on' : ''}"><span class="ico">${d.icon}</span><span><b>${d.name}</b><small>${esc(d.blurb)}</small></span>
          <button class="btn ${on ? '' : 'gold'}" data-equip="${w}" ${on ? 'disabled' : ''}>${on ? 'Equipped' : 'Equip'}</button></div>`;
      })
      .join('')}</div>
    <p class="sub">Brann the Smith in Hearthvale sells weapons you don't own yet.</p>`;
  host.sheet(selling ? '🎒 Bag · Sell' : '🎒 Bag', body);
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-use]').forEach((b) => b.addEventListener('click', () => after(ctrl.useItem(b.dataset.use!))));
  $$<HTMLButtonElement>(host.modal, '[data-sell]').forEach((b) =>
    b.addEventListener('click', () => after(ctrl.sellItem(b.dataset.sell!, Number(b.dataset.n)))),
  );
  $$<HTMLButtonElement>(host.modal, '[data-equip]').forEach((b) =>
    b.addEventListener('click', () => after(ctrl.equipWeapon(b.dataset.equip as WeaponType))),
  );
}
