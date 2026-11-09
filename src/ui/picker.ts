// HUD panels (HUD lane; docs/UX-SIMPLE.md §3, docs/INTEGRATION-v3.md §3.1):
//   'picker'  arg '<slot>'       — choose a skill for one of YOUR slots: a grid of skill icons with names, newest
//                                  first ('New' dot), tap to equip, 'Empty' to clear the slot;
//             arg 'skill:<id>'   — choose which of your slots gets that skill (a card's Equip when every slot is full);
//   'menu'    the ☰ button       — New game (with a one-line confirm) and only what exists.
// Class slots are never edited here: the class fills them (holding a class slot opens that skill's card instead).
import { pickerHtml, slotChooserHtml } from './hud/html';
import type { PanelHost, PanelRender } from './panels/common';
import { $, $$, esc } from './util';

const CLASS = 'hud-sheet';

export function renderPicker(host: PanelHost, arg?: string): void {
  const ctrl = host.ctrl;
  const icon = (id: string) => ctrl.iconUrl('skill', id);
  const slots = ctrl.barSlots();
  if (arg?.startsWith('skill:')) {
    const id = arg.slice(6);
    const name = ctrl.reg.skill(id)?.name ?? 'this skill';
    const own = slots.filter((s) => s.kind === 'own');
    const body = host.sheet(
      'Pick a slot',
      `<p class="pk-lead">Where should <b>${esc(name)}</b> go?</p>${slotChooserHtml(own, icon)}`,
      `${CLASS} picker-sheet`,
    );
    $$<HTMLButtonElement>(body, '.pk-tile[data-slot]').forEach((b) =>
      b.addEventListener('click', () => {
        const r = ctrl.equipSkill(id, Number(b.dataset.slot));
        if (!r.ok && r.message) host.toast(esc(r.message));
        host.close();
      }),
    );
    return;
  }
  const slot = Number(arg);
  const here = slots.find((s) => s.index === slot);
  if (!Number.isInteger(slot) || !here || here.kind !== 'own') {
    // Class slots belong to the class: show that skill's card instead (or nothing for an empty one).
    if (here?.skillId) host.open('skill', here.skillId);
    else host.close();
    return;
  }
  const view = ctrl.slotPicker(slot);
  const classSlots = slots.filter((s) => s.kind === 'class').length;
  const now = view.current ? (ctrl.reg.skill(view.current)?.name ?? '') : '';
  const lead = now ? `Slot ${slot + 1} holds <b>${esc(now)}</b>. Tap a skill to swap.` : `Tap a skill to put it in slot ${slot + 1}.`;
  const body = host.sheet('Pick a skill', `<p class="pk-lead">${lead}</p>${pickerHtml(view, icon, classSlots)}`, `${CLASS} picker-sheet`);
  $$<HTMLButtonElement>(body, '.pk-tile[data-skill]').forEach((b) =>
    b.addEventListener('click', () => {
      if (b.classList.contains('inclass')) {
        host.toast('Your class already uses that one.');
        return;
      }
      if (b.classList.contains('cur')) {
        host.close();
        return;
      }
      const r = ctrl.equipSkill(b.dataset.skill!, slot);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.close();
    }),
  );
  body.querySelector('.pk-empty')?.addEventListener('click', () => {
    ctrl.clearSlot(slot);
    host.close();
  });
}

/** "1 h 20 min" / "12 min". */
function playTime(ms: number): string {
  const min = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(min / 60);
  return h > 0 ? `${h} h ${min % 60} min` : `${min} min`;
}

/** The ☰ menu: who you are, "saves by itself", New game with a one-line confirm. */
export function renderMenu(host: PanelHost): void {
  const ctrl = host.ctrl;
  const p = ctrl.session.player;
  let worn = '';
  try {
    worn = ctrl.wornClass()?.name ?? '';
  } catch {
    /* scene not ready */
  }
  const body = host.sheet(
    'Menu',
    `<div class="mn-who"><b>${esc(p.name)}</b><span>Lv ${p.level}${worn ? ` · ${esc(worn)}` : ''} · played ${playTime(p.playMs ?? 0)}</span></div>
     <p class="mn-line">Your game saves by itself.</p>
     <div class="mn-actions">
       <button class="btn big gold mn-resume">Back to the game</button>
       <button class="btn mn-new">New game</button>
     </div>
     <div class="mn-confirm hidden">
       <p>Start over? This erases ${esc(p.name)}.</p>
       <div class="mn-actions"><button class="btn danger-solid mn-yes">Yes, start over</button><button class="btn mn-no">Keep playing</button></div>
     </div>`,
    `${CLASS} menu-sheet`,
  );
  $(body, '.mn-resume').addEventListener('click', () => host.close());
  $(body, '.mn-new').addEventListener('click', () => {
    $(body, '.mn-confirm').classList.remove('hidden');
    $(body, '.mn-actions').classList.add('hidden');
  });
  $(body, '.mn-no').addEventListener('click', () => {
    $(body, '.mn-confirm').classList.add('hidden');
    $(body, '.mn-actions').classList.remove('hidden');
  });
  $(body, '.mn-yes').addEventListener('click', () => ctrl.newGame());
}

/** Panel registration (HUD lane). */
export const HUD_PANELS: Record<string, PanelRender> = {
  picker: renderPicker,
  menu: (host) => renderMenu(host),
};
