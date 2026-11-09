// Bag (docs/CLIENT-v2.md §7): coins, materials, consumables (use), relics, weapons (equip / where to buy) and a pointer
// to the essence pouch. Opened with arg 'sell' from a Waykeeper: materials get a quantity picker and a Sell button
// (the controller re-checks that a Waykeeper is near).
import type { ItemDef, WeaponType } from '../../core/types';
import { WEAPON_TYPES } from '../../core/types';
import { WEAPONS } from '../../data/weapons';
import { $$, esc } from '../util';
import type { PanelHost } from './common';
import { sheet } from './skills';

type Held = { it: ItemDef; id: string; n: number };

function qtyKey(id: string): string {
  return `bag.qty:${id}`;
}

export function renderBag(host: PanelHost, arg?: string): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const p = ctrl.session.player;
  const selling = arg === 'sell';
  const held: Held[] = Object.entries(p.bag)
    .filter(([, n]) => n > 0)
    .map(([id, n]) => ({ it: reg.item(id), id, n }))
    .filter((x): x is Held => !!x.it);
  const of = (kind: ItemDef['kind']) => held.filter((x) => x.it.kind === kind);
  const row = (x: Held, extra = '', cls = '') =>
    `<div class="irow ${cls}"><span class="ico">${x.it.icon}<i class="cnt">${x.n}</i></span><span><b>${esc(x.it.name)}</b><small>${esc(x.it.desc)}</small></span>${extra}</div>`;

  let worth = 0;
  const mats = of('material')
    .map((x) => {
      const price = x.it.kind === 'material' ? (x.it.price ?? 0) : 0;
      worth += price * x.n;
      if (!selling || !price) return row(x, price ? `<span class="price">🪙${price}<small>each</small></span>` : '');
      const q = Math.min(x.n, Math.max(1, (host.state[qtyKey(x.id)] as number | undefined) ?? 1));
      return row(
        x,
        `<div class="sellbox">
          <div class="qty"><button class="btn q" data-q="${esc(x.id)}" data-d="-1" ${q <= 1 ? 'disabled' : ''} aria-label="Fewer">−</button><b>${q}</b>
            <button class="btn q" data-q="${esc(x.id)}" data-d="1" ${q >= x.n ? 'disabled' : ''} aria-label="More">+</button>
            <button class="btn q max" data-q="${esc(x.id)}" data-d="max" ${q >= x.n ? 'disabled' : ''}>All</button></div>
          <button class="btn gold" data-sell="${esc(x.id)}" data-n="${q}">Sell ${q} · 🪙${price * q}</button></div>`,
        'selling',
      );
    })
    .join('');
  const cons = of('consumable')
    .map((x) => row(x, `<button class="btn gold" data-use="${esc(x.id)}">Use</button>`))
    .join('');
  const relics = of('relic')
    .map((x) => row(x, '<span class="chip tier">relic</span>', 'relic'))
    .join('');
  const other = held
    .filter((x) => x.it.kind === 'tome' || x.it.kind === 'shard')
    .map((x) => row(x))
    .join('');
  const ess = book.ingredients().essences;
  const unowned = WEAPON_TYPES.filter((w) => !p.ownedWeapons.includes(w));
  const body = `
    <div class="purse">
      <div class="coins"><span>🪙</span><b>${p.coins}</b><small>coins</small></div>
      <div><b>${held.reduce((a, x) => a + x.n, 0)}</b><small>items</small></div>
      <div><b>${worth}</b><small>materials worth</small></div>
    </div>
    ${selling ? '<div class="away sell"><span class="ico">🧭</span><div><b>The Waykeeper buys gathered materials.</b><small>Choose how many, then sell. Draughts, relics and tomes are not for sale.</small></div></div>' : ''}
    <h3>Materials</h3>${mats || '<p class="sub">Nothing gathered yet. Ore, herbs, fish and stranger things grow on the map.</p>'}
    ${selling ? '' : `<h3>Consumables</h3>${cons || '<p class="sub">No draughts or seeds. Old chests sometimes hold them.</p>'}`}
    ${relics ? `<h3>Relics</h3>${relics}<p class="sub">Relics are proof of a warden's fall: the deepest morphs and callings answer to them.</p>` : ''}
    ${other ? `<h3>Other</h3>${other}` : ''}
    ${
      selling
        ? ''
        : `<h3>Essences <small>${ess.reduce((a, e) => a + (e.count ?? 0), 0)}</small></h3>
      ${ess.length ? `<div class="ess-strip">${ess.map((e) => `<span class="echip">${e.icon} ${esc(e.name)} <b>×${e.count}</b></span>`).join('')}</div>` : '<p class="sub">No essences. Monsters drop the essence of what they do.</p>'}
      <button class="btn wide" data-goto-ess>Essences in 📖 Skills ›</button>
      <h3>Weapons</h3>
      <div class="weapons">${p.ownedWeapons
        .map((w) => {
          const d = WEAPONS[w];
          const on = p.weapon === w;
          return `<div class="wpn ${on ? 'on' : ''}"><span class="ico">${d.icon}</span><span><b>${d.name}</b><small>${esc(d.blurb)}</small>
            <small>ATK ${d.atk} · MATK ${d.matk} · crit ${d.crit}%</small></span>
            <button class="btn ${on ? '' : 'gold'}" data-equip="${w}" ${on ? 'disabled' : ''}>${on ? 'Equipped' : 'Equip'}</button></div>`;
        })
        .join('')}
        ${unowned
          .map((w) => {
            const d = WEAPONS[w];
            return `<div class="wpn locked"><span class="ico">${d.icon}</span><span><b>${d.name}</b><small>${esc(d.blurb)}</small>
              <small>Brann the Smith in Hearthvale sells one for 🪙${d.price}.</small></span></div>`;
          })
          .join('')}</div>
      <p class="sub">Each weapon opens its own morph path. Switching keeps every skill you know.</p>`
    }`;
  sheet(host, selling ? '🎒 Bag · Sell' : '🎒 Bag', body);
  const after = (r: { ok: boolean; message?: string }) => {
    if (r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-use]').forEach((b) => b.addEventListener('click', () => after(ctrl.useItem(b.dataset.use!))));
  $$<HTMLButtonElement>(host.modal, '[data-q]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.q!;
      const n = ctrl.session.count(id);
      const cur = (host.state[qtyKey(id)] as number | undefined) ?? 1;
      host.state[qtyKey(id)] = b.dataset.d === 'max' ? n : Math.max(1, Math.min(n, cur + Number(b.dataset.d)));
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-sell]').forEach((b) =>
    b.addEventListener('click', () => {
      delete host.state[qtyKey(b.dataset.sell!)];
      after(ctrl.sellItem(b.dataset.sell!, Number(b.dataset.n)));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-equip]').forEach((b) =>
    b.addEventListener('click', () => after(ctrl.equipWeapon(b.dataset.equip as WeaponType))),
  );
  host.modal.querySelector('[data-goto-ess]')?.addEventListener('click', () => {
    host.state['skills.tab'] = 'essences';
    host.open('skills');
  });
}
