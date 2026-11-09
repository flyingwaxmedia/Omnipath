// The own-slot skill picker (HUD lane; docs/UX-SIMPLE.md §3): a grid of skill icons with names, newest first; tap
// one to equip it in the slot. Panel 'picker', arg '<slot>' (choose a skill for that own slot) or 'skill:<id>'
// (choose which own slot gets that skill — from a card's Equip when every own slot is full).
//
// Skeleton: a plain grid. LANE hud: the real design.
import type { PanelHost, PanelRender } from './panels/common';
import { $$, esc } from './util';

export function renderPicker(host: PanelHost, arg?: string): void {
  const ctrl = host.ctrl;
  if (arg?.startsWith('skill:')) {
    const id = arg.slice(6);
    const own = ctrl.barSlots().filter((s) => s.kind === 'own');
    const body = host.sheet(
      'Pick a slot',
      `<div class="picker">${own
        .map((s) => {
          const name = s.skillId ? (ctrl.reg.skill(s.skillId)?.name ?? '') : 'Empty';
          return `<button class="pick" data-slot="${s.index}">${s.skillId ? `<img alt="" src="${ctrl.iconUrl('skill', s.skillId)}" width="32" height="32">` : ''}<small>${esc(name)}</small></button>`;
        })
        .join('')}</div>`,
    );
    $$<HTMLButtonElement>(body, '.pick').forEach((b) =>
      b.addEventListener('click', () => {
        const r = ctrl.equipSkill(id, Number(b.dataset.slot));
        if (r.message) host.toast(esc(r.message));
        host.close();
      }),
    );
    return;
  }
  const slot = Number(arg ?? -1);
  const view = ctrl.slotPicker(slot);
  const body = host.sheet(
    'Pick a skill',
    `<div class="picker">${view.choices
      .map(
        (c) =>
          `<button class="pick ${c.fresh ? 'fresh' : ''}" data-skill="${esc(c.skillId)}"><img alt="" src="${ctrl.iconUrl('skill', c.skillId)}" width="32" height="32"><small>${esc(c.name)}</small></button>`,
      )
      .join('')}</div>${view.current ? '<button class="clear">Remove</button>' : ''}`,
  );
  $$<HTMLButtonElement>(body, '.pick').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.equipSkill(b.dataset.skill!, slot);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.close();
    }),
  );
  body.querySelector('.clear')?.addEventListener('click', () => {
    ctrl.clearSlot(slot);
    host.close();
  });
}

/** Panel registration (HUD lane). */
export const HUD_PANELS: Record<string, PanelRender> = {
  picker: renderPicker,
};
