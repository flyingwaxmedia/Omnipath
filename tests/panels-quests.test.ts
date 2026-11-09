// Quest pieces of the panels lane (src/ui/panels/quests.ts, npc.ts, announce.ts helpers): pure HTML-string
// builders and the choices behind them — the NPC dialog's focus quest and ONE primary action, reward chips,
// objective lines, the Codex log card, the NPC's role options (playtest indices), and the announcement helpers.
import { describe, expect, it } from 'vitest';
import type { NpcQuestView, NpcQuestsView, QuestCardView, QuestRewardView } from '../src/ui/controller';
import { learnedKicker, movedObjective, notableStep, quietLearn } from '../src/ui/announce';
import { isCloseOption, npcOptionsHtml } from '../src/ui/panels/npc';
import {
  focusQuest,
  hasRewards,
  learnIconUrl,
  learnedLine,
  logCardHtml,
  npcQuestsHtml,
  npcSpeech,
  objectiveText,
  objectivesHtml,
  questFocusHtml,
  questStatusLine,
  rewardChipsHtml,
} from '../src/ui/panels/quests';

const art = { iconUrl: (kind: string, id: string) => `data:${kind}/${id}` };

const NONE: QuestRewardView = { coins: 0, exp: 0, items: [], learn: [], secret: false };

function quest(id: string, status: QuestCardView['status'], extra: Partial<NpcQuestView> = {}): NpcQuestView {
  return {
    id,
    name: `Quest ${id}`,
    summary: `Do the ${id} thing.`,
    status,
    giverId: 'brann',
    giverName: 'Brann the Smith',
    turnInId: 'brann',
    turnInName: 'Brann the Smith',
    where: 'Hearthvale',
    objectives: [
      { text: 'Defeat Jellops 3/8', have: 3, need: 8, done: false },
      { text: 'Visit Mirror Lake ✓', have: 1, need: 1, done: true },
    ],
    rewards: { coins: 10, exp: 40, items: [{ id: 'ore', name: 'Iron Ore', count: 2 }], learn: [{ kind: 'skill', id: 'hammer_toss', name: 'Hammer Toss' }], secret: false },
    tracked: false,
    repeatable: false,
    dialog: `Line for ${id}.`,
    ...extra,
  };
}

function view(quests: NpcQuestView[]): NpcQuestsView {
  return { npcId: 'brann', name: 'Brann the Smith', title: 'Blacksmith', portrait: '🔨', quests };
}

const count = (html: string, re: RegExp) => (html.match(re) ?? []).length;

describe('NPC dialog quests', () => {
  it('puts ready first, then available, then active (or the one asked for)', () => {
    const qs = [quest('a', 'active'), quest('b', 'available'), quest('c', 'ready'), quest('d', 'done')];
    expect(focusQuest(qs)?.id).toBe('c');
    expect(focusQuest(qs.filter((q) => q.id !== 'c'))?.id).toBe('b');
    expect(focusQuest([quest('a', 'active')])?.id).toBe('a');
    expect(focusQuest(qs, 'a')?.id).toBe('a');
    expect(focusQuest(qs, 'd')?.id).toBe('c'); // a finished quest is never the focus
    expect(focusQuest([quest('d', 'done')])).toBeNull();
  });

  it('speaks the offer / thanks line, else the NPC’s own line', () => {
    expect(npcSpeech('Hello <b>there</b>', quest('a', 'available'))).toBe('Line for a.');
    expect(npcSpeech('Hello <b>there</b>', quest('a', 'ready'))).toBe('Line for a.');
    expect(npcSpeech('Hello <b>there</b>', quest('a', 'active'))).toBe('Hello <b>there</b>');
    expect(npcSpeech('Hi', null)).toBe('Hi');
    expect(npcSpeech('Hi', quest('x', 'available', { dialog: '<script>' }))).toBe('&lt;script&gt;');
  });

  it('offers Accept / Later, Complete with the reward, or progress lines — one gold button', () => {
    const offer = questFocusHtml(art, quest('a', 'available'), { lesson: 'brann_hammer_toss' });
    expect(offer).toContain('data-accept="a"');
    expect(offer).toContain('data-lesson="brann_hammer_toss"');
    expect(offer).toContain('data-later');
    expect(offer).toContain('Hammer Toss');
    expect(count(offer, /btn gold/g)).toBe(1);

    const ready = questFocusHtml(art, quest('a', 'ready'));
    expect(ready).toContain('data-complete="a"');
    expect(ready).toContain('Reward');
    expect(count(ready, /btn gold/g)).toBe(1);

    const active = questFocusHtml(art, quest('a', 'active'));
    expect(active).not.toContain('data-accept');
    expect(active).not.toContain('data-complete');
    expect(active).toContain('Defeat Jellops 3/8');
    expect(active).toContain('data-hint');
    expect(active).toContain('qhint hidden'); // the tip is closed by default
  });

  it('lists the other open quests as rows and hides finished ones', () => {
    const html = npcQuestsHtml(art, view([quest('a', 'ready'), quest('b', 'available'), quest('c', 'active'), quest('d', 'done')]), null, (id) =>
      id === 'a' ? 'lesson_a' : undefined,
    );
    expect(html).toContain('data-complete="a"');
    expect(html).toContain('data-lesson="lesson_a"');
    expect(html).toContain('data-focus="b"');
    expect(html).toContain('data-focus="c"');
    expect(html).not.toContain('Quest d');
    expect(npcQuestsHtml(art, view([quest('d', 'done')]))).toBe('');
  });

  it('"Later" puts an offer aside as a small row (tapping it brings it back)', () => {
    const v = view([quest('b', 'available'), quest('c', 'active')]);
    const later = npcQuestsHtml(art, v, null, undefined, ['b']);
    expect(later).not.toContain('data-accept="b"');
    expect(later).toContain('data-focus="b"');
    // Everything put aside: only rows, no focus card and no Accept.
    const all = npcQuestsHtml(art, view([quest('b', 'available')]), null, undefined, ['b']);
    expect(all).toContain('data-focus="b"');
    expect(all).not.toContain('data-accept');
    // Asked for by name, it is the focus again.
    expect(npcQuestsHtml(art, v, 'b', undefined, ['b'])).toContain('data-accept="b"');
  });

  it('reward headline: skills / bonuses are learned, essences are found', () => {
    expect(learnedLine({ kind: 'skill', id: 'hammer_toss', name: 'Hammer Toss' })).toBe('You learned <b>Hammer Toss</b>!');
    expect(learnedLine({ kind: 'essence', id: 'weight', name: 'Weight' })).toBe('You got <b>Weight</b>!');
    expect(learnedLine(undefined)).toBe('Well done!');
    expect(learnIconUrl(art, { kind: 'essence', id: 'weight', name: 'Weight' })).toBe('data:mod/weight');
    expect(learnIconUrl(art, { kind: 'passive', id: 'p', name: 'P' })).toBe('data:passive/p');
  });
});

describe('quest pieces', () => {
  it('shows rewards as icon chips: what it teaches, items, coins, EXP', () => {
    const html = rewardChipsHtml(art, quest('a', 'available').rewards);
    expect(html).toContain('src="data:skill/hammer_toss"');
    expect(html).toContain('src="data:item/ore"');
    expect(html).toContain('2 Iron Ore');
    expect(html).toContain('40 EXP');
    expect(html).toContain('data-rw="coins"');
    expect(rewardChipsHtml(art, NONE)).toBe('');
    expect(hasRewards(NONE)).toBe(false);
    expect(rewardChipsHtml(art, { ...NONE, secret: true })).toContain('A class riddle');
    expect(rewardChipsHtml(art, { ...NONE, learn: [{ kind: 'element', id: 'fire', name: 'Fire' }] })).toContain('data:el/fire');
  });

  it('draws objective lines with a tick, never a doubled ✓', () => {
    const html = objectivesHtml(quest('a', 'active').objectives);
    expect(count(html, /<li/g)).toBe(2);
    expect(html).toContain('Visit Mirror Lake</span>');
    expect(html).toContain('obar');
    expect(objectiveText({ text: 'Visit Mirror Lake ✓', have: 1, need: 1, done: true })).toBe('Visit Mirror Lake');
    expect(objectivesHtml([])).toBe('');
  });

  it('says one line per quest state', () => {
    expect(questStatusLine(quest('a', 'ready'))).toBe('Return to Brann the Smith');
    expect(questStatusLine(quest('a', 'active'))).toBe('Defeat Jellops 3/8');
    expect(questStatusLine(quest('a', 'available'))).toBe('From Brann the Smith · Hearthvale');
    expect(questStatusLine(quest('a', 'cooldown'))).toBe('Again soon');
  });

  it('log cards: track toggle on active quests, from whom on available ones, give up behind Details', () => {
    const active = logCardHtml(art, { ...quest('a', 'active'), tracked: true }, true);
    expect(active).toContain('data-track="a"');
    expect(active).toContain('aria-pressed="true"');
    expect(active).toContain('data-abandon="a"');
    expect(active).toContain('qmore-b hidden');
    const unfocused = logCardHtml(art, quest('a', 'active'), false);
    expect(unfocused).not.toContain('data-abandon');
    const ready = logCardHtml(art, quest('a', 'ready'), true);
    expect(ready).toContain('Return to <b>Brann the Smith</b>');
    expect(ready).not.toContain('data-abandon');
    const avail = logCardHtml(art, quest('a', 'available'), false);
    expect(avail).toContain('From <b>Brann the Smith</b> · Hearthvale');
    expect(avail).not.toContain('data-track');
    expect(avail).not.toContain('data-rw'); // rewards only once tapped
    expect(logCardHtml(art, quest('a', 'available'), true)).toContain('data-rw="skill"');
  });

  it('never shows ids, tiers or formulas in quest HTML', () => {
    const all = [
      questFocusHtml(art, quest('a', 'available')),
      questFocusHtml(art, quest('a', 'ready')),
      logCardHtml(art, quest('a', 'active'), true),
    ].join('');
    const text = all.replace(/<[^>]+>/g, ' ');
    expect(text).not.toMatch(/hammer_toss|brann_|tier|per rank|\bCR\b/i);
  });
});

describe('NPC role options', () => {
  const opts = [
    { label: '🔥 Forge', action: () => {} },
    { label: 'Buy Rogue Dagger', action: () => {}, disabled: true },
    { label: 'Leave' },
  ];
  it('keeps the game’s order as data-opt indices', () => {
    const html = npcOptionsHtml(opts, false);
    expect(html.indexOf('data-opt="0"')).toBeLessThan(html.indexOf('data-opt="1"'));
    expect(html).toContain('data-opt="2"');
  });
  it('makes the first real action gold unless a quest owns the primary button', () => {
    expect(npcOptionsHtml(opts, false)).toMatch(/class="btn gold [^"]*" data-opt="0"/);
    expect(npcOptionsHtml(opts, true)).not.toContain('gold');
    expect(npcOptionsHtml([{ label: 'Leave' }], false)).not.toContain('gold');
    expect(isCloseOption({ label: 'Bye' })).toBe(true);
    expect(isCloseOption({ label: 'Thank you' })).toBe(true);
    expect(isCloseOption({ label: 'Receive the light', action: () => {} })).toBe(false);
  });
});

describe('announcement helpers', () => {
  it('gives quest / spark / fusion / class learns no card of their own', () => {
    for (const s of ['quest:x', 'lesson:x', 'spark:x', 'fusion:a+b', 'class:x', 'debug', 'start']) expect(quietLearn(s), s).toBe(true);
    for (const s of ['morph:x', 'echo:x', 'tome:x']) expect(quietLearn(s), s).toBe(false);
    expect(learnedKicker('morph:x')).toBe('TRANSFORMED');
    expect(learnedKicker('echo:x')).toBe('NEW MOVE LEARNED');
    expect(learnedKicker('tome:x')).toBe('NEW SKILL');
  });

  it('toasts progress only at notable steps', () => {
    expect(notableStep(undefined, 1, 12, false)).toBe(true);
    expect(notableStep(1, 2, 12, false)).toBe(false);
    expect(notableStep(2, 3, 12, false)).toBe(true); // a quarter of the way
    expect(notableStep(3, 4, 12, false)).toBe(false);
    expect(notableStep(11, 12, 12, true)).toBe(true);
    expect(notableStep(1, 2, 3, false)).toBe(true); // small counts: every step
    expect(notableStep(0, 0, 3, false)).toBe(false);
  });

  it('finds the objective a progress event moved', () => {
    const now = [
      { have: 2, done: false, text: 'a' },
      { have: 4, done: false, text: 'b' },
    ];
    expect(movedObjective([2, 3], now)?.text).toBe('b');
    expect(movedObjective(undefined, now)?.text).toBe('a');
    expect(movedObjective([2, 4], [{ have: 2, done: true, text: 'a' }, now[1]])?.text).toBe('b');
  });
});
