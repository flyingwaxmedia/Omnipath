// Trainer panel (docs/CLIENT-v2.md §7): opened from NPC dialogs with the NPC id. Lessons with grant, requirement
// checklist (✓/✗), cost and a Learn button, all through SkillBook.lessonState / takeLesson.
import type { LessonDef } from '../../core/types';
import { NPCS } from '../../data/npcs';
import { $$, esc } from '../util';
import { type PanelHost, costText, reqList } from './common';

function grantText(host: PanelHost, l: LessonDef): string {
  const { reg, book } = host.ctrl;
  const g = l.grants;
  if ('skill' in g) {
    const s = reg.skill(g.skill);
    return `${s?.icon ?? '📖'} Technique: <b>${esc(s?.name ?? g.skill)}</b>`;
  }
  if ('passive' in g) {
    const p = reg.passive(g.passive);
    const r = book.state.passives[g.passive] ?? 0;
    return `${p?.icon ?? '✧'} Passive: <b>${esc(p?.name ?? g.passive)}</b>${p ? ` <small>(rank ${r}/${p.maxRank})</small>` : ''}`;
  }
  if ('essence' in g) {
    const e = reg.essence(g.essence);
    return `${e?.icon ?? '✦'} Essence: <b>${esc(e?.name ?? g.essence)}</b> ×${g.count}`;
  }
  const el = reg.element(g.element);
  return `${el?.icon ?? '✦'} Element: <b>${esc(el?.name ?? g.element)}</b>`;
}

export function renderTrainer(host: PanelHost, npcId?: string): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const npc = NPCS.find((n) => n.id === npcId);
  const trainer = npc?.trainer ? reg.trainer(npc.trainer) : undefined;
  if (!npc || !trainer) {
    host.sheet('📜 Lessons', '<p class="sub">No one here teaches anything.</p>');
    return;
  }
  const p = ctrl.session.player;
  const body = `
    <p class="sub">${npc.portrait} <b>${esc(npc.name)}</b> — ${esc(trainer.title)}. You have 🪙${p.coins}.</p>
    <div class="lessons">${trainer.lessons
      .map((l) => {
        const st = book.lessonState(l.id);
        const reqs = l.requires.map((r) => ({ text: book.describe(r), ok: book.meets(r) }));
        const can = !st.owned && st.available && st.affordable;
        const label = st.owned ? 'Learned' : !st.available ? 'Locked' : !st.affordable ? "Can't afford" : 'Learn';
        return `<div class="lesson ${st.owned ? 'owned' : ''} ${st.available ? '' : 'locked'}">
          <div class="lhead"><b>${esc(l.name)}</b>${l.repeatable ? ' <small>repeatable</small>' : ''}</div>
          <small>${esc(l.blurb)}</small>
          <div class="grant">${grantText(host, l)}</div>
          ${reqList(reqs)}
          <div class="lfoot"><span class="cost">${costText(l.cost, ctrl)}</span>
            <button class="btn ${can ? 'gold' : ''}" data-lesson="${esc(l.id)}" ${can ? '' : 'disabled'}>${label}</button></div>
        </div>`;
      })
      .join('')}</div>`;
  host.sheet(`📜 ${esc(trainer.title)}`, body);
  $$<HTMLButtonElement>(host.modal, '[data-lesson]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.takeLesson(b.dataset.lesson!);
      if (r.message) host.toast(esc(r.message));
      host.render();
    }),
  );
}
