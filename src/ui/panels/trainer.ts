// NPC quest list (panels lane; docs/CLIENT-v3.md §4, docs/QUESTS.md): panel 'trainer', arg = NPC id. Trainers no
// longer sell lessons — what they teach is a quest reward — so this is that NPC's quests: ready ones to complete,
// new ones to accept, the ones in progress with their lines, and the finished ones. The quest that teaches a lesson
// keeps `data-lesson="<lessonId>"` on its button (the playtest's old selector).
import type { NpcQuestView } from '../controller';
import { $$, esc } from '../util';
import { type PanelHost, wireToggles } from './common';
import { QUEST_MARK, hasRewards, objectivesHtml, pxImg, rewardChipsHtml } from './quests';
import { sheet } from './skills';

const ORDER: Record<NpcQuestView['status'], number> = { ready: 0, available: 1, active: 2, cooldown: 3, done: 4, locked: 5 };

/** One quest of the list; `primary` makes its action the screen's one gold button. */
function questItem(host: PanelHost, q: NpcQuestView, primary: boolean): string {
  const lesson = host.ctrl.reg.quest(q.id)?.rewards.lesson;
  const dl = lesson ? ` data-lesson="${esc(lesson)}"` : '';
  const rewards = hasRewards(q.rewards) ? `<div class="qrew"><small>Reward</small>${rewardChipsHtml(host.ctrl, q.rewards)}</div>` : '';
  const head = `<div class="qhead"><span class="qmark m-${q.status}" aria-hidden="true">${QUEST_MARK[q.status]}</span><b>${esc(q.name)}</b>${
    q.status === 'ready' ? '<span class="qtag ready">Done!</span>' : ''
  }</div>`;
  switch (q.status) {
    case 'available':
      return `<div class="qitem offer" data-quest="${esc(q.id)}">${head}<p class="qsum">${esc(q.summary)}</p>${rewards}
        <button class="btn ${primary ? 'gold' : ''} wide" data-accept="${esc(q.id)}"${dl}>Accept</button></div>`;
    case 'ready':
      return `<div class="qitem ready" data-quest="${esc(q.id)}">${head}${rewards}
        <button class="btn ${primary ? 'gold' : ''} wide" data-complete="${esc(q.id)}"${dl}>Complete</button></div>`;
    case 'active':
      return `<div class="qitem active" data-quest="${esc(q.id)}">${head}${objectivesHtml(q.objectives)}
        ${q.dialog ? `<button class="hint-t" data-hint aria-expanded="false">Hint</button><p class="qhint hidden">${esc(q.dialog)}</p>` : ''}</div>`;
    default:
      return `<div class="qitem done" data-quest="${esc(q.id)}">${head}<small>${q.status === 'cooldown' ? 'Come back later for more.' : 'Done'}</small></div>`;
  }
}

export function renderTrainer(host: PanelHost, npcId?: string): void {
  const { ctrl } = host;
  const view = npcId ? ctrl.npcQuests(npcId) : null;
  if (!view || !npcId) {
    sheet(host, 'Quests', '<p class="sub">Nobody here has a quest for you.</p>');
    return;
  }
  const quests = [...view.quests].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  const firstAction = quests.find((q) => q.status === 'ready' || q.status === 'available')?.id;
  const open = quests.filter((q) => q.status !== 'done' && q.status !== 'cooldown');
  const done = quests.filter((q) => q.status === 'done' || q.status === 'cooldown');
  const teaches = [
    ...new Map(quests.flatMap((q) => q.rewards.learn.filter((l) => l.kind === 'skill' || l.kind === 'passive')).map((l) => [l.id, l])).values(),
  ];
  const body = `
    <div class="tr-head"><span class="portrait">${view.portrait}</span><div><b>${esc(view.name)}</b><small>${esc(view.title)}</small>
      ${teaches.length ? `<div class="teaches" aria-label="Teaches">${teaches
        .slice(0, 8)
        .map((l) => pxImg(ctrl.iconUrl(l.kind === 'skill' ? 'skill' : 'passive', l.id), 24))
        .join('')}</div>` : ''}</div></div>
    <p class="sub">${open.length ? (teaches.length ? 'Help out and learn new skills as a reward.' : 'Help out for a reward.') : 'Nothing new right now. Come back later.'}</p>
    <div class="qlist">${open.map((q) => questItem(host, q, q.id === firstAction)).join('')}</div>
    ${done.length ? `<h3>Done <small>${done.length}</small></h3><div class="qlist done">${done.map((q) => questItem(host, q, false)).join('')}</div>` : ''}`;
  sheet(host, `${esc(view.name)} · Quests`, body, 'npc-quests-sheet');
  const after = (r: { ok: boolean; message?: string }) => {
    if (!r.ok && r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-accept]').forEach((b) => b.addEventListener('click', () => after(ctrl.acceptQuest(b.dataset.accept!, npcId))));
  $$<HTMLButtonElement>(host.modal, '[data-complete]').forEach((b) =>
    b.addEventListener('click', () => {
      b.disabled = true;
      after(ctrl.turnInQuest(b.dataset.complete!, npcId));
    }),
  );
  wireToggles(host.modal);
}
