// The simple skill card (starchart lane; docs/UX-SIMPLE.md §3): big icon, name, ★ rank, one line, cooldown / SP and
// ONE action (Equip / Equipped ✓ / Transform / the next step); "Details" closed by default. Opened from a star, a
// class slot (HUD long-press) or any list: ui.open('skill', skillId). Data: ctrl.skillCard(id).
//
// Skeleton: a plain card. LANE starchart: the real design.
import { esc } from '../util';
import type { PanelHost } from '../panels/common';
import { stars } from '../words';

export function renderSkillCard(host: PanelHost, id?: string): void {
  const ctrl = host.ctrl;
  const card = ctrl.skillCard(id ?? '');
  const a = card.action;
  const btn =
    a.kind === 'equip'
      ? '<button class="primary" data-act="equip">Equip</button>'
      : a.kind === 'equipped'
        ? `<button class="primary" disabled>Equipped ✓${a.byClass ? ` <small>by ${esc(a.byClass)}</small>` : ''}</button>`
        : a.kind === 'transform'
          ? `<button class="primary" data-act="transform">Transform → ${esc(a.toName)}</button>`
          : a.kind === 'step'
            ? `<p class="next">${esc(a.text)}</p>`
            : '';
  const body = host.sheet(
    esc(card.name),
    `<div class="skcard">
      <img class="big-icon" alt="" src="${ctrl.iconUrl('skill', card.id)}" width="64" height="64">
      <div class="stars" aria-label="Rank ${card.rank} of ${card.maxRank}">${stars(card.rank, card.maxRank)}</div>
      <p class="line">${esc(card.line)}</p>
      <p class="meta">${card.cooldown ? `${card.cooldown} s` : 'No cooldown'} · ${card.sp} SP</p>
      ${btn}
      ${card.next ? `<p class="next">${esc(card.next)}</p>` : ''}
      <details><summary>Details</summary>${card.details.map((d) => `<div>${esc(d.label)}: ${esc(d.value)}</div>`).join('')}</details>
    </div>`,
  );
  body.querySelector('[data-act="equip"]')?.addEventListener('click', () => {
    const r = ctrl.equipSkill(card.id);
    if (r.ok) host.render();
    else host.open('picker', `skill:${card.id}`);
  });
  body.querySelector('[data-act="transform"]')?.addEventListener('click', () => {
    if (a.kind === 'transform') ctrl.morph(card.id, a.to);
    host.render();
  });
}
