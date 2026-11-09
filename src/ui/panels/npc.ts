// NPC dialog (panels lane; docs/CLIENT-v3.md §4, docs/QUESTS.md §5): talking to an NPC opens this — the NPC's line,
// its quests (offer → Accept / Later; active → progress lines; ready → Complete with the reward preview) and its role
// actions (Forge, Buy, Travel, Sell…). The game builds the view (Interactions → ui.npcDialog); quest data comes from
// ctrl.npcQuests(npcId) and actions go through ctrl.acceptQuest / ctrl.turnInQuest with the NPC id.
//
// It is a re-renderable panel registered as 'dialog' (and 'npc'), arg = NPC id (docs/INTEGRATION-v3.md §3.1):
// ui.npcDialog → openNpcDialog keeps the game's view in host.state and opens the panel, so Accept / Complete
// re-render it in place and `ui.current` still reads 'dialog' while an NPC talks (the playtest waits on it). An
// object dialog (ui.dialog, no arg) is left untouched by re-renders. Complete shows the reward right inside the
// dialog (no extra card: announce.ts withInlineReward), then the NPC's next quest. Role options keep
// `.dialog [data-opt="<i>"]` in the game's order (the playtest drives option 0 of Brann / Alba); quest buttons
// carry their own attributes (data-accept, data-complete, data-later, data-focus).
import { withInlineReward } from '../announce';
import type { DialogOption } from '../dialogs';
import type { NpcDialogView, QuestRewardView } from '../controller';
import { $$, esc } from '../util';
import { type PanelHost, wireToggles } from './common';
import { type QuestArt, focusQuest, learnIconUrl, learnedLine, npcQuestsHtml, npcSpeech, pxImg, rewardChipsHtml } from './quests';

const VIEW = 'npc.view';
const FOCUS = 'npc.focus';
const REWARD = 'npc.reward';
/** Offers put off with "Later" while this talk lasts (they wait as small rows; the NPC's own actions stay). */
const LATER = 'npc.later';

/** The panel name the NPC dialog opens under (ui.current reads it). */
export const NPC_PANEL = 'dialog';

interface InlineReward {
  name: string;
  rewards: QuestRewardView;
  /** A learned skill that found no free slot ("Equip"). */
  equip?: string;
}

/** "Quest complete!" inside the dialog: the first thing learned big, the rest as chips. */
export function inlineRewardHtml(art: QuestArt, r: InlineReward): string {
  const first = r.rewards.learn[0];
  const img = first ? pxImg(learnIconUrl(art, first), 48) : '';
  const rest = { ...r.rewards, learn: r.rewards.learn.slice(1) };
  return `<div class="qwin" role="status">
    <div class="qwin-k">✓ Quest complete!</div>
    <div class="qwin-main">${img || '<span class="qwin-ico" aria-hidden="true">📜</span>'}
      <div><b>${esc(r.name)}</b><span>${learnedLine(first)}</span></div></div>
    ${rewardChipsHtml(art, rest)}
    ${r.equip ? `<button class="btn small" data-equip-skill="${esc(r.equip)}">Equip</button>` : ''}
  </div>`;
}

/** Labels that only close the dialog (they never become the gold primary button). */
const CLOSE_WORDS = /^(leave|bye|ok|got it|thank you|thanks|later|goodbye|farewell)$/i;

/** True for an option that only closes the dialog. */
export function isCloseOption(o: DialogOption): boolean {
  return !o.action && CLOSE_WORDS.test(o.label.replace(/<[^>]+>/g, '').trim());
}

/** Role-option buttons in the game's order (indices are the playtest's data-opt). One gold button at most. */
export function npcOptionsHtml(options: readonly DialogOption[], questPrimary: boolean): string {
  const gold = questPrimary ? -1 : options.findIndex((o) => !o.disabled && !isCloseOption(o));
  return options
    .map((o, i) => `<button class="btn ${i === gold ? 'gold' : ''} ${isCloseOption(o) ? 'leave' : ''}" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)
    .join('');
}

/** The lesson a quest teaches (kept on its button as data-lesson for the playtest), if any. */
function lessonOf(host: PanelHost, questId: string): string | undefined {
  return host.ctrl.reg.quest(questId)?.rewards.lesson;
}

/** ui.npcDialog(view) lands here: remember the game's view, then open (or re-open) the NPC panel. */
export function openNpcDialog(host: PanelHost, view: NpcDialogView): void {
  host.state[VIEW] = view;
  delete host.state[FOCUS];
  delete host.state[REWARD];
  delete host.state[LATER];
  host.open(NPC_PANEL, view.npcId);
}

/** Panel 'dialog' / 'npc' (arg = NPC id): the NPC's line, their quests and their role actions. */
export function renderNpc(host: PanelHost, npcId?: string): void {
  // An object dialog (ui.dialog: waystone, chest…) shares the 'dialog' name without an arg: leave it as it is.
  if (npcId === undefined) return;
  const view = host.state[VIEW] as NpcDialogView | undefined;
  if (!view || view.npcId !== npcId) {
    host.close();
    return;
  }
  const { ctrl } = host;
  const quests = ctrl.npcQuests(view.npcId);
  const focusId = (host.state[FOCUS] as string | undefined) ?? null;
  const later = (host.state[LATER] as string[] | undefined) ?? [];
  const focus = focusQuest(
    quests.quests.filter((q) => q.id === focusId || !later.includes(q.id)),
    focusId,
  );
  const questHtml = npcQuestsHtml(ctrl, quests, focus?.id ?? null, (id) => lessonOf(host, id), later);
  const primary = !!focus && (focus.status === 'available' || focus.status === 'ready');
  const options = view.options.length ? view.options : [{ label: 'Leave' }];
  const won = host.state[REWARD] as InlineReward | undefined;
  host.modal.innerHTML = `
    <div class="dialog npc-dialog ${questHtml || won ? 'has-quests' : ''}" role="dialog" aria-label="${esc(view.name)}">
      <div class="speaker"><span class="ico">${view.portrait}</span><span class="who"><b>${esc(view.name)}</b>${view.title ? `<small>${esc(view.title)}</small>` : ''}</span></div>
      <p class="say">${npcSpeech(view.line, focus)}</p>
      ${won || questHtml ? `<div class="npc-right">${won ? inlineRewardHtml(ctrl, won) : ''}${questHtml}</div>` : ''}
      <div class="opts">${npcOptionsHtml(options, primary)}</div>
    </div>`;

  const after = (r: { ok: boolean; message?: string }) => {
    if (!r.ok && r.message) host.toast(esc(r.message));
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-opt]').forEach((b) =>
    b.addEventListener('click', () => {
      const o = options[Number(b.dataset.opt)];
      if (!o.keep) host.close();
      o.action?.();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-accept]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.accept!;
      host.state[FOCUS] = id;
      delete host.state[REWARD];
      after(ctrl.acceptQuest(id, view.npcId));
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-complete]').forEach((b) =>
    b.addEventListener('click', () => {
      b.disabled = true;
      const id = b.dataset.complete!;
      const name = quests.quests.find((q) => q.id === id)?.name ?? '';
      delete host.state[FOCUS];
      const r = withInlineReward(() => ctrl.turnInQuest(id, view.npcId));
      if (r.ok && r.rewards) {
        const skill = r.rewards.learn.find((l) => l.kind === 'skill')?.id;
        let equip: string | undefined;
        try {
          equip = skill && !ctrl.barSlots().some((sl) => sl.skillId === skill) && ctrl.skillCard(skill).action.kind === 'equip' ? skill : undefined;
        } catch {
          equip = undefined;
        }
        host.state[REWARD] = { name, rewards: r.rewards, ...(equip ? { equip } : {}) } satisfies InlineReward;
      }
      after(r);
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-equip-skill]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = b.dataset.equipSkill!;
      const r = ctrl.equipSkill(id);
      const won2 = host.state[REWARD] as InlineReward | undefined;
      if (won2) delete won2.equip;
      if (r.ok) {
        host.toast(`<b>${esc(ctrl.reg.skill(id)?.name ?? '')}</b> is on your bar`);
        host.render();
      } else host.open('picker', `skill:${id}`);
    }),
  );
  // "Later": the offer steps aside as a small row and the NPC's other quests / actions stay; with nothing else to do
  // here, Later simply ends the talk.
  $$<HTMLButtonElement>(host.modal, '[data-later]').forEach((b) =>
    b.addEventListener('click', () => {
      const id = focus?.id;
      const put = id ? [...new Set([...later, id])] : later;
      const otherQuest = quests.quests.some(
        (q) => !put.includes(q.id) && (q.status === 'ready' || q.status === 'available' || q.status === 'active'),
      );
      const otherAction = options.some((o) => !o.disabled && !isCloseOption(o));
      if (!otherQuest && !otherAction) {
        host.close();
        return;
      }
      host.state[LATER] = put;
      delete host.state[FOCUS];
      delete host.state[REWARD];
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-focus]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state[FOCUS] = b.dataset.focus;
      delete host.state[REWARD];
      host.render();
    }),
  );
  wireToggles(host.modal);
}
