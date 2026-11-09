// Quest pieces shared by the NPC dialog (npc.ts), the NPC quest list (trainer.ts), the Codex Quests tab (codex.ts) and
// the reward card (announce.ts) — panels lane, docs/CLIENT-v3.md §4, docs/UX-SIMPLE.md. Pure HTML-string builders
// (no DOM access) so tests/panels*.test.ts can run them in node; wiring lives with each panel.
//
// Words: one short line per thing, the quest's own summary / objective lines (already friendly: "Defeat Jellops 3/8"),
// rewards as icons with names, and ONE big action per quest (Accept / Complete).
import type { IconKind } from '../../game/art/icons';
import type { NpcQuestView, NpcQuestsView, QuestCardView, QuestObjectiveView, QuestRewardView } from '../controller';
import { esc } from '../util';
import { FRIENDLY, fraction } from '../words';

/** What the builders need for pixel icons (GameController.iconUrl). */
export interface QuestArt {
  iconUrl(kind: IconKind, id: string): string;
}

/** Statuses a quest shows in a dialog / list (locked quests never reach the UI). */
type Shown = QuestCardView['status'];

/** The mark over the NPC's head, repeated on the quest row so the two read as one thing. */
export const QUEST_MARK: Record<Shown, string> = {
  available: '!',
  ready: '?',
  active: '…',
  done: '✓',
  cooldown: '✓',
  locked: '',
};

const LEARN_ICON: Record<QuestRewardView['learn'][number]['kind'], IconKind> = {
  skill: 'skill',
  passive: 'passive',
  element: 'el',
  essence: 'mod',
};

/** A crisp pixel icon (32 px art shown at `size` CSS px). Empty src → ''. */
export function pxImg(src: string, size = 32, cls = ''): string {
  if (!src) return '';
  return `<img class="px ${cls}" src="${src}" width="${size}" height="${size}" alt="" draggable="false">`;
}

/** Pixel icon of something a quest teaches ('' when there is no art). */
export function learnIconUrl(art: QuestArt, l: QuestRewardView['learn'][number]): string {
  try {
    return art.iconUrl(LEARN_ICON[l.kind], l.id);
  } catch {
    return '';
  }
}

/** The reward's headline: "You learned <b>Hammer Toss</b>!" — an essence is found, not learned ("You got …"). */
export function learnedLine(l: QuestRewardView['learn'][number] | undefined): string {
  if (!l) return 'Well done!';
  return `${l.kind === 'essence' ? 'You got' : 'You learned'} <b>${esc(l.name)}</b>!`;
}

/** True when a reward gives anything at all. */
export function hasRewards(r: QuestRewardView): boolean {
  return r.coins > 0 || r.exp > 0 || r.items.length > 0 || r.learn.length > 0 || r.secret;
}

/** Reward chips: icons + names for what it teaches and gives, then coins and EXP. */
export function rewardChipsHtml(art: QuestArt, r: QuestRewardView, big = false): string {
  const chips: string[] = [];
  for (const l of r.learn) {
    chips.push(
      `<span class="rw rw-${l.kind}" data-rw="${l.kind}">${pxImg(art.iconUrl(LEARN_ICON[l.kind], l.id), big ? 40 : 24)}<b>${esc(l.name)}</b></span>`,
    );
  }
  for (const it of r.items) {
    chips.push(
      `<span class="rw rw-item" data-rw="item">${pxImg(art.iconUrl('item', it.id), big ? 40 : 24)}<b>${it.count > 1 ? `${it.count} ` : ''}${esc(it.name)}</b></span>`,
    );
  }
  if (r.coins > 0) chips.push(`<span class="rw rw-coins" data-rw="coins"><i aria-hidden="true">🪙</i><b>${r.coins}</b></span>`);
  if (r.exp > 0) chips.push(`<span class="rw rw-exp" data-rw="exp"><i aria-hidden="true">✦</i><b>${r.exp} EXP</b></span>`);
  if (r.secret) chips.push('<span class="rw rw-secret" data-rw="secret"><i aria-hidden="true">❔</i><b>A class riddle</b></span>');
  return chips.length ? `<div class="rewards ${big ? 'big' : ''}">${chips.join('')}</div>` : '';
}

/** An objective line without the engine's trailing ✓ (the row draws its own tick). */
export function objectiveText(o: QuestObjectiveView): string {
  return o.text.replace(/\s*✓\s*$/, '');
}

/** Objective lines with a tick and, while counting, a slim bar. */
export function objectivesHtml(objs: readonly QuestObjectiveView[]): string {
  if (!objs.length) return '';
  return `<ul class="objs">${objs
    .map((o) => {
      const bar = !o.done && o.need > 1 ? `<span class="obar" aria-label="${fraction(o.have, o.need)}"><i style="width:${Math.round((100 * Math.min(o.have, o.need)) / o.need)}%"></i></span>` : '';
      return `<li class="${o.done ? 'done' : ''}"><i class="tick" aria-hidden="true">${o.done ? '✓' : '○'}</i><span>${esc(objectiveText(o))}</span>${bar}</li>`;
    })
    .join('')}</ul>`;
}

/** The first objective still open (for one-line summaries), or null when all are done. */
export function nextObjective(q: Pick<QuestCardView, 'objectives'>): QuestObjectiveView | null {
  return q.objectives.find((o) => !o.done) ?? null;
}

/** One short status line for a quest row ("Defeat Jellops 3/8", "Return to Brann", "From Hale · Hearthvale"). */
export function questStatusLine(q: QuestCardView): string {
  switch (q.status) {
    case 'ready':
      return `Return to ${q.turnInName}`;
    case 'active': {
      const o = nextObjective(q);
      return o ? objectiveText(o) : q.summary;
    }
    case 'available':
      return q.where ? `From ${q.giverName} · ${q.where}` : `From ${q.giverName}`;
    case 'cooldown':
      return 'Again soon';
    case 'done':
      return 'Done';
    default:
      return q.summary;
  }
}

/** Which of an NPC's quests the dialog puts forward: `want` if shown, else ready → available → active. */
export function focusQuest(quests: readonly NpcQuestView[], want?: string | null): NpcQuestView | null {
  const open = quests.filter((q) => q.status === 'ready' || q.status === 'available' || q.status === 'active');
  return (
    open.find((q) => q.id === want) ??
    open.find((q) => q.status === 'ready') ??
    open.find((q) => q.status === 'available') ??
    open.find((q) => q.status === 'active') ??
    null
  );
}

/**
 * What the NPC says: the focus quest's offer / thanks (with its flavour behind a small "More" toggle, closed by
 * default — wireToggles), else their own line (HTML from the game).
 */
export function npcSpeech(lineHtml: string, focus: NpcQuestView | null): string {
  if (focus && (focus.status === 'available' || focus.status === 'ready') && focus.dialog) {
    const more = focus.more
      ? ` <button class="hint-t say-t" data-more aria-expanded="false">More</button><span class="say-more hidden">${esc(focus.more)}</span>`
      : '';
    return esc(focus.dialog) + more;
  }
  return lineHtml;
}

/** The focused quest as a card with its ONE primary action (data-accept / data-complete / data-later / data-hint). */
export function questFocusHtml(art: QuestArt, q: NpcQuestView, opts: { lesson?: string } = {}): string {
  const lesson = opts.lesson ? ` data-lesson="${esc(opts.lesson)}"` : '';
  const head = `<div class="qhead"><span class="qmark m-${q.status}" aria-hidden="true">${QUEST_MARK[q.status]}</span><b>${esc(q.name)}</b>${
    q.status === 'ready' ? '<span class="qtag ready">Done!</span>' : q.status === 'available' ? '<span class="qtag new">New quest</span>' : ''
  }</div>`;
  const rewards = hasRewards(q.rewards) ? `<div class="qrew"><small>Reward</small>${rewardChipsHtml(art, q.rewards)}</div>` : '';
  if (q.status === 'available') {
    return `<div class="qcard offer" data-quest="${esc(q.id)}">${head}<p class="qsum">${esc(q.summary)}</p>${rewards}
      <div class="qbtns"><button class="btn gold big" data-accept="${esc(q.id)}"${lesson}>${FRIENDLY.questAccept}</button><button class="btn later" data-later>${FRIENDLY.questLater}</button></div></div>`;
  }
  if (q.status === 'ready') {
    return `<div class="qcard ready" data-quest="${esc(q.id)}">${head}${rewards}
      <div class="qbtns"><button class="btn gold big" data-complete="${esc(q.id)}"${lesson}>${FRIENDLY.questComplete}</button></div></div>`;
  }
  // Active: the progress lines; the NPC's tip stays behind a small "Hint" toggle (closed by default).
  return `<div class="qcard active" data-quest="${esc(q.id)}">${head}${objectivesHtml(q.objectives)}
    ${q.dialog ? `<button class="hint-t" data-hint aria-expanded="false">Hint</button><p class="qhint hidden">${esc(q.dialog)}</p>` : ''}</div>`;
}

/** Compact rows for the NPC's other open quests (tap → focus it). */
export function questRowsHtml(quests: readonly NpcQuestView[], focusId: string | null): string {
  const rows = quests.filter((q) => q.id !== focusId && (q.status === 'available' || q.status === 'active' || q.status === 'ready'));
  if (!rows.length) return '';
  return `<div class="qrows">${rows
    .map(
      (q) =>
        `<button class="qrow s-${q.status}" data-focus="${esc(q.id)}"><span class="qmark m-${q.status}" aria-hidden="true">${QUEST_MARK[q.status]}</span><b>${esc(q.name)}</b><small>${esc(q.status === 'available' ? q.summary : questStatusLine(q))}</small></button>`,
    )
    .join('')}</div>`;
}

/**
 * The quest part of an NPC dialog: focus card + the other open quests. '' when the NPC has nothing open. Quests in
 * `later` (offers the player put off with "Later") are never put forward on their own: they wait as small rows.
 */
export function npcQuestsHtml(
  art: QuestArt,
  view: NpcQuestsView,
  focusId?: string | null,
  lessonOf?: (questId: string) => string | undefined,
  later: readonly string[] = [],
): string {
  const focus = focusQuest(
    view.quests.filter((q) => q.id === focusId || !later.includes(q.id)),
    focusId,
  );
  if (!focus) {
    const rows = questRowsHtml(view.quests, null);
    return rows ? `<div class="npc-quests">${rows}</div>` : '';
  }
  const lesson = lessonOf?.(focus.id);
  return `<div class="npc-quests">${questFocusHtml(art, focus, lesson ? { lesson } : {})}${questRowsHtml(view.quests, focus.id)}</div>`;
}

/** A quest in the Codex log: name, one line, objectives (active), track toggle, reward chips (available). */
export function logCardHtml(art: QuestArt, q: QuestCardView, focused: boolean): string {
  const ready = q.status === 'ready';
  const active = q.status === 'active' || ready;
  const track = active
    ? `<button class="track ${q.tracked ? 'on' : ''}" data-track="${esc(q.id)}" aria-pressed="${q.tracked}">${q.tracked ? '★ Tracking' : '☆ Track'}</button>`
    : '';
  const body = active
    ? `${ready ? `<p class="qready">✓ Ready! Return to <b>${esc(q.turnInName)}</b>${q.where && q.turnInId === q.giverId ? ` in ${esc(q.where)}` : ''}.</p>` : objectivesHtml(q.objectives)}`
    : q.status === 'available'
      ? `<p class="qsum">${esc(q.summary)}</p><p class="qfrom">From <b>${esc(q.giverName)}</b>${q.where ? ` · ${esc(q.where)}` : ''}</p>`
      : '';
  // Rewards: always on what you are doing; on an available quest only once it is tapped (the list stays short).
  const showRewards = active || (q.status === 'available' && focused);
  const rewards = showRewards && hasRewards(q.rewards) ? `<div class="qrew">${rewardChipsHtml(art, q.rewards)}</div>` : '';
  const giveUp =
    active && focused && !ready
      ? `<div class="qmore"><button class="hint-t" data-more aria-expanded="false">Details</button><div class="qmore-b hidden"><p class="qfrom">From <b>${esc(q.giverName)}</b>${q.where ? ` · ${esc(q.where)}` : ''}</p><button class="btn small danger-l" data-abandon="${esc(q.id)}">${FRIENDLY.questGiveUp}</button></div></div>`
      : '';
  return `<div class="qlog s-${q.status} ${focused ? 'focus' : ''}" data-qlog="${esc(q.id)}">
    <div class="qhead"><span class="qmark m-${q.status}" aria-hidden="true">${QUEST_MARK[q.status]}</span><b>${esc(q.name)}</b>${track}</div>
    ${body}${rewards}${giveUp}</div>`;
}
