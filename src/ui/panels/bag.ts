// Bag (panels lane; docs/UX-SIMPLE.md): coins, then what you can use (Use), what you gathered (sell prices), relics,
// books, weapons (Equip; stats behind "Details"; Bare Hands is one of them: "put your weapon away") and the essence
// pouch (only once you own one). Opened with arg
// 'sell' from a Waykeeper: materials get a quantity picker and ONE Sell button each (the controller re-checks that a
// Waykeeper is near). Words: item names with pixel icons, one short line each, no internals.
import { WEAPON_TYPES, type ItemDef, type WeaponType } from '../../core/types';
import { SOLD_WEAPONS, WEAPONS } from '../../data/weapons';
import { $$, esc } from '../util';
import { ownsWeapon } from '../classinfo';
import { WEAPON_WORD, oneLine, weaponName } from '../words';
import { type PanelHost, detailsHtml, iconHtml, refIconHtml, wireToggles } from './common';
import { weaponGlyph } from '../hud/html';
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
    `<div class="irow ${cls}"><span class="ico">${iconHtml(ctrl.iconUrl('item', x.id), x.it.icon)}<i class="cnt">${x.n}</i></span><span><b>${esc(x.it.name)}</b><small>${esc(
      oneLine(x.it.desc),
    )}</small></span>${extra}</div>`;

  const mats = of('material')
    .map((x) => {
      const price = x.it.kind === 'material' ? (x.it.price ?? 0) : 0;
      if (!selling || !price) return row(x, price ? `<span class="price">🪙${price}</span>` : '');
      const q = Math.min(x.n, Math.max(1, (host.state[qtyKey(x.id)] as number | undefined) ?? 1));
      return row(
        x,
        `<div class="sellbox">
          <div class="qty"><button class="btn q" data-q="${esc(x.id)}" data-d="-1" ${q <= 1 ? 'disabled' : ''} aria-label="Fewer">−</button><b>${q}</b>
            <button class="btn q" data-q="${esc(x.id)}" data-d="1" ${q >= x.n ? 'disabled' : ''} aria-label="More">+</button>
            <button class="btn q max" data-q="${esc(x.id)}" data-d="max" ${q >= x.n ? 'disabled' : ''}>All</button></div>
          <button class="btn gold" data-sell="${esc(x.id)}" data-n="${q}">Sell · 🪙${price * q}</button></div>`,
        'selling',
      );
    })
    .join('');
  const cons = of('consumable')
    .map((x) => row(x, `<button class="btn gold" data-use="${esc(x.id)}">Use</button>`))
    .join('');
  const relics = of('relic')
    .map((x) => row(x, '', 'relic'))
    .join('');
  const other = held
    .filter((x) => x.it.kind === 'tome' || x.it.kind === 'shard')
    .map((x) => row(x))
    .join('');
  const ess = ctrl.unlocks().essences ? book.ingredients().essences : [];
  const unowned = SOLD_WEAPONS.filter((w) => !p.ownedWeapons.includes(w));
  // Bare Hands are always yours (SPEC-v4 §2.1): the last weapon row, "put your weapon away".
  const mine = [...WEAPON_TYPES.filter((w) => w !== 'fists' && ownsWeapon(p, w)), 'fists' as WeaponType];
  const weapons = `<div class="weapons">${mine
    .map((w) => {
      const d = WEAPONS[w];
      const on = p.weapon === w;
      const bare = w === 'fists';
      const line = bare ? (on ? 'Your weapon is put away.' : 'Put your weapon away.') : oneLine(d.blurb);
      return `<div class="wpn ${on ? 'on' : ''} ${bare ? 'bare' : ''}" data-w="${w}"><span class="ico">${weaponGlyph(w)}</span><span><b>${esc(bare ? WEAPON_WORD.fists : weaponName(d.name))}</b><small>${esc(line)}</small>
        ${detailsHtml(`<small>ATK ${d.atk} · MATK ${d.matk} · Crit ${d.crit}%</small>`)}</span>
        <button class="btn ${on ? '' : 'gold'}" data-equip="${w}" ${on ? 'disabled' : ''}>${on ? (bare ? 'Bare hands ✓' : 'Equipped ✓') : bare ? 'Put away' : 'Equip'}</button></div>`;
    })
    .join('')}
    ${unowned
      .map((w) => {
        const d = WEAPONS[w];
        return `<div class="wpn locked"><span class="ico">${weaponGlyph(w)}</span><span><b>${esc(weaponName(d.name))}</b><small>Brann sells one in Hearthvale · 🪙${d.price}</small></span></div>`;
      })
      .join('')}</div>`;

  const body = selling
    ? `<div class="purse"><div class="coins"><span>🪙</span><b>${p.coins}</b><small>coins</small></div></div>
      <p class="sub">Pick how many, then sell.</p>
      ${mats || '<p class="sub">Nothing to sell yet. Gather ore, herbs and fish out in the world.</p>'}`
    : `<div class="purse"><div class="coins"><span>🪙</span><b>${p.coins}</b><small>coins</small></div></div>
      ${cons ? `<h3>Use</h3>${cons}` : ''}
      <h3>Gathered</h3>${mats || '<p class="sub">Nothing yet. Tap ore, herbs and fishing spots to gather.</p>'}
      ${relics ? `<h3>Treasures</h3>${relics}` : ''}
      ${other ? `<h3>Books &amp; shards</h3>${other}` : ''}
      ${
        ess.length
          ? `<h3>Essences <small>${ess.reduce((a, e) => a + (e.count ?? 0), 0)}</small></h3>
        <div class="ess-strip">${ess.map((e) => `<span class="echip">${refIconHtml(ctrl, e.ref, e.icon, 24)} ${esc(e.name)} <b>×${e.count}</b></span>`).join('')}</div>`
          : ''
      }
      <h3>Weapons</h3>${weapons}
      <p class="sub">If a move uses a weapon, you need that weapon.</p>`;
  sheet(host, selling ? '🎒 Sell' : '🎒 Bag', body, 'bag3');
  wireToggles(host.modal);
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
    b.addEventListener('click', () => {
      const w = b.dataset.equip as WeaponType;
      after(w === 'fists' && ctrl.unequipWeapon ? ctrl.unequipWeapon() : ctrl.equipWeapon(w));
    }),
  );
}
