// Trainer panel (docs/CLIENT-v2.md §7): opened from NPC dialogs with the NPC id. Each lesson shows a preview of what it
// grants (technique stats, passive rank step, essence effect, element), a ✓/✗ requirement checklist, the cost with
// what the bag holds, and a Learn button — all through SkillBook.lessonState / takeLesson (via the controller).
import type { LessonDef } from '../../core/types';
import { NPCS } from '../../data/npcs';
import { $$, esc, shapeText } from '../util';
import { type PanelHost, reqList } from './common';
import { elChip, pips, sheet } from './skills';

function grantHtml(host: PanelHost, l: LessonDef): { kind: string; html: string } {
  const { reg, book } = host.ctrl;
  const g = l.grants;
  if ('skill' in g) {
    const s = reg.skill(g.skill);
    if (!s) return { kind: 'Technique', html: esc(g.skill) };
    return {
      kind: 'Technique',
      html: `<div class="gprev"><span class="ico">${s.icon}</span><div><b>${esc(s.name)}</b> ${elChip(reg, s.element)}
        <small>${esc(s.desc)}</small>
        <small class="stats">${esc(shapeText(s.shape))}${s.power ? ` · power ${Math.round(s.power * 100)}%` : ''} · ${s.spCost} SP${s.cooldown ? ` · ${(s.cooldown / 1000).toFixed(1)}s` : ''} · ${s.weapons ? s.weapons.join('/') : 'any weapon'}</small></div></div>`,
    };
  }
  if ('passive' in g) {
    const p = reg.passive(g.passive);
    const r = book.state.passives[g.passive] ?? 0;
    if (!p) return { kind: 'Passive', html: esc(g.passive) };
    return {
      kind: 'Passive',
      html: `<div class="gprev"><span class="ico">${p.icon}</span><div><b>${esc(p.name)}</b> ${pips(r, p.maxRank, 'gold')}
        <small>${esc(p.desc)}</small>
        <small class="stats">${r >= p.maxRank ? 'Max rank reached' : `Rank ${r} → ${r + 1} of ${p.maxRank}`}</small></div></div>`,
    };
  }
  if ('essence' in g) {
    const e = reg.essence(g.essence);
    if (!e) return { kind: 'Essence', html: esc(g.essence) };
    return {
      kind: 'Essence',
      html: `<div class="gprev"><span class="ico">${e.icon}</span><div><b>${esc(e.name)} ×${g.count}</b> <span class="chip">${e.category}</span>
        <small>${esc(e.desc)}</small>
        <small class="stats">Shapes ${e.appliesTo.join(', ')} · you hold ×${book.state.essences[e.id] ?? 0}</small></div></div>`,
    };
  }
  const el = reg.element(g.element);
  return {
    kind: 'Element',
    html: `<div class="gprev"><span class="ico">${el?.icon ?? '✦'}</span><div><b>${esc(el?.name ?? g.element)}</b><small>${esc(el?.desc ?? '')}</small></div></div>`,
  };
}

function costHtml(host: PanelHost, l: LessonDef): string {
  const { ctrl } = host;
  const cost = l.cost;
  if (!cost || (!cost.coins && !Object.keys(cost.items ?? {}).length)) return '<span class="cost free">Free</span>';
  const parts: string[] = [];
  if (cost.coins) {
    const ok = ctrl.session.player.coins >= cost.coins;
    parts.push(`<span class="${ok ? 'ok' : 'no'}">🪙${cost.coins}</span>`);
  }
  for (const [id, n] of Object.entries(cost.items ?? {})) {
    const it = ctrl.reg.item(id);
    const have = ctrl.session.count(id);
    parts.push(`<span class="${have >= n ? 'ok' : 'no'}">${it?.icon ?? ''}${n} ${esc(it?.name ?? id)} <small>(${have})</small></span>`);
  }
  return `<span class="cost">${parts.join('<i>+</i>')}</span>`;
}

export function renderTrainer(host: PanelHost, npcId?: string): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const npc = NPCS.find((n) => n.id === npcId);
  const trainer = npc?.trainer ? reg.trainer(npc.trainer) : undefined;
  if (!npc || !trainer) {
    sheet(host, '📜 Lessons', '<p class="sub">No one here teaches anything.</p>');
    return;
  }
  const p = ctrl.session.player;
  const wants = [...new Set(trainer.lessons.flatMap((l) => Object.keys(l.cost?.items ?? {})))];
  const lessons = trainer.lessons.map((l) => ({ l, st: book.lessonState(l.id) }));
  const open = lessons.filter((x) => !x.st.owned);
  const done = lessons.filter((x) => x.st.owned);
  const card = ({ l, st }: (typeof lessons)[number]) => {
    const reqs = l.requires.map((r) => ({ text: book.describe(r), ok: book.meets(r) }));
    const can = !st.owned && st.available && st.affordable;
    const label = !st.available ? 'Locked' : !st.affordable ? "Can't afford" : l.repeatable && book.state.lessons.includes(l.id) ? 'Learn again' : 'Learn';
    const g = grantHtml(host, l);
    return `<div class="lesson ${st.available ? '' : 'locked'} ${can ? 'can' : ''}">
      <div class="lhead"><b>${esc(l.name)}</b><span class="chip">${g.kind}</span>${l.repeatable ? '<span class="chip tier">repeatable</span>' : ''}</div>
      <small class="blurb">${esc(l.blurb)}</small>
      ${g.html}
      ${reqList(reqs)}
      <div class="lfoot">${costHtml(host, l)}
        <button class="btn ${can ? 'gold' : ''}" data-lesson="${esc(l.id)}" ${can ? '' : 'disabled'}>${label}</button></div>
    </div>`;
  };
  const body = `
    <div class="tr-head"><span class="portrait">${npc.portrait}</span><div><b>${esc(npc.name)}</b><small>${esc(npc.title)}</small>
      <div class="purse-mini"><span>🪙 ${p.coins}</span>${wants.map((id) => `<span>${reg.item(id)?.icon ?? ''} ${ctrl.session.count(id)}</span>`).join('')}</div></div></div>
    <div class="lessons">${open.map(card).join('') || '<p class="sub">You have learned everything taught here.</p>'}</div>
    ${done.length ? `<h3>Learned <small>${done.length}</small></h3><div class="lessons done">${done
      .map(({ l }) => `<div class="lesson owned"><div class="lhead"><b>✓ ${esc(l.name)}</b><span class="chip">${grantHtml(host, l).kind}</span></div></div>`)
      .join('')}</div>` : ''}`;
  sheet(host, `📜 ${esc(trainer.title)}`, body);
  $$<HTMLButtonElement>(host.modal, '[data-lesson]').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.takeLesson(b.dataset.lesson!);
      if (r.message) host.toast(esc(r.message));
      host.render();
    }),
  );
}
