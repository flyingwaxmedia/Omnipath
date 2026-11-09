import { describe, expect, it } from 'vitest';
import {
  QUEST_TRACK_LIMIT,
  acceptQuest,
  advanceQuests,
  notifyQuest,
  objectiveProgress,
  objectivesDone,
  questStatus,
  questsFor,
  turnInQuest,
  type QuestContext,
} from '../src/core/quests';
import { Registry } from '../src/core/registry';
import { migrateBookState } from '../src/core/save';
import { SkillBook, type Inventory, type SkillBookEvents } from '../src/core/skillbook';
import { emptyQuestState, emptyState, type SkillBookState } from '../src/core/state';
import type {
  ClassDef,
  ElementDef,
  ElementId,
  GameData,
  MonsterDef,
  QuestDef,
  SkillDef,
  SkillShape,
} from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const title = (id: string): string =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const el = (id: ElementId, tier: 0 | 1 = 0): ElementDef => ({
  id,
  name: title(id),
  prefix: title(id),
  icon: `i_${id}`,
  color: 0,
  tier,
  desc: id,
  status: 'burn',
  strongVs: [],
});

const STRIKE: SkillShape = { kind: 'strike', range: 50, arc: 100 };
const SPIN: SkillShape = { kind: 'spin', radius: 80 };
const PROJECTILE: SkillShape = { kind: 'projectile', speed: 400, range: 300 };
const NOVA: SkillShape = { kind: 'nova', radius: 80, range: 120 };

const sk = (s: Pick<SkillDef, 'id' | 'shape'> & Partial<SkillDef>): SkillDef => ({
  name: title(s.id),
  desc: `${s.id}.`,
  icon: `i_${s.id}`,
  tier: 1,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 8,
  cooldown: 3000,
  maxRank: 5,
  ...s,
});

const mon = (m: Pick<MonsterDef, 'id' | 'family'> & Partial<MonsterDef>): MonsterDef => ({
  name: title(m.id),
  level: 3,
  hp: 50,
  atk: 5,
  def: 1,
  size: 'S',
  rank: 'common',
  exp: 5,
  coins: [1, 2],
  speed: 40,
  aggressive: false,
  radius: 12,
  attackRange: 30,
  attackDelay: 1000,
  respawn: 10000,
  ...m,
});

const klass = (c: Pick<ClassDef, 'id' | 'clauses'> & Partial<ClassDef>): ClassDef => ({
  name: title(c.id),
  icon: 'i',
  desc: '',
  hint: `Riddle of ${c.id}.`,
  tier: 1,
  bonus: {},
  ...c,
});

const DIALOG = { offer: 'Help me?', progress: 'Still at it?', complete: 'Thank you.' };

const q = (d: Pick<QuestDef, 'id' | 'giver' | 'objectives'> & Partial<QuestDef>): QuestDef => ({
  name: title(d.id.slice(d.id.indexOf('_') + 1)),
  summary: `${d.id} summary`,
  dialog: DIALOG,
  rewards: {},
  ...d,
});

const jellop = mon({ id: 'jellop', family: 'sprite' });
const jellopKing = mon({ id: 'jellop_king', family: 'sprite', rank: 'warden', base: 'jellop' });
const pip = mon({ id: 'pip', family: 'sylvan' });
const boar = mon({ id: 'boar', family: 'beast' });
const boarAlpha = mon({ id: 'boar_alpha', family: 'beast', rank: 'elite', base: 'boar' });
const brinewisp = mon({
  id: 'brinewisp',
  family: 'sprite',
  rank: 'elite',
  techniques: [{ skill: 'bubble_lance', weight: 1, cooldown: 3000, range: 200, echo: { marks: 3 } }],
});

const QUESTS: QuestDef[] = [
  q({
    id: 'hale_kick_drill',
    giver: 'hale',
    chain: 'drill',
    objectives: [{ kind: 'kill', monster: 'jellop', count: 3 }],
    rewards: { lesson: 'hale_kick', coins: 15, exp: 40, items: { herb: 2 } },
  }),
  q({
    id: 'hale_footwork',
    giver: 'hale',
    chain: 'drill',
    after: ['hale_kick_drill'],
    objectives: [{ kind: 'use', tag: 'melee', count: 2 }],
    rewards: { lesson: 'hale_footing' },
    repeatable: { cooldownMs: 60_000 },
  }),
  q({
    id: 'pell_net',
    giver: 'pell',
    turnIn: 'brann',
    objectives: [
      { kind: 'deliver', item: 'fish', count: 5 },
      { kind: 'talk', npc: 'oru' },
      { kind: 'visit', map: 'vale.lake_islet' },
    ],
    rewards: { skill: 'palm_strike', element: 'water', essences: { split: 1 }, whisper: 'tidecaller', flag: 'pell_net_done' },
  }),
  q({
    id: 'oru_still',
    giver: 'oru',
    requires: [{ type: 'element', id: 'water' }],
    objectives: [
      { kind: 'state', requires: { type: 'skill', id: 'whirlwind' }, label: 'Learn Whirlwind' },
      { kind: 'cast', element: 'ice', shape: 'spin', map: 'vale.mirror_lake', count: 2 },
      { kind: 'witness', skill: 'bubble_lance', count: 2 },
    ],
    rewards: { passive: 'keen_eye' },
  }),
  q({
    id: 'rhea_hunt',
    giver: 'rhea',
    objectives: [
      { kind: 'kill', family: 'beast', rank: 'elite', count: 1 },
      { kind: 'kill', family: 'sprite', count: 2 },
      { kind: 'kill', rank: 'warden', count: 1 },
      { kind: 'kill', count: 4 },
      { kind: 'gather', node: 'ore', count: 2 },
      { kind: 'witness', count: 1 },
    ],
    rewards: { coins: 50 },
  }),
  q({
    id: 'gus_split',
    giver: 'gus',
    objectives: [{ kind: 'gather', node: 'ore', count: 3 }],
    rewards: { lesson: 'hale_split' },
    repeatable: { cooldownMs: 1000 },
  }),
  q({
    id: 'brann_throw',
    giver: 'brann',
    objectives: [
      { kind: 'use', skill: 'sword_throw', count: 2 },
      { kind: 'visit', map: 'vale.hearthvale' },
    ],
  }),
  q({
    id: 'mirelle_errand',
    giver: 'mirelle',
    objectives: [{ kind: 'talk', npc: 'brann' }],
    rewards: { exp: 5 },
  }),
  q({
    id: 'tamsin_free',
    giver: 'tamsin',
    objectives: [{ kind: 'talk', npc: 'hale' }],
    rewards: { lesson: 'hale_free' },
  }),
];

const DATA: GameData = {
  dataVersion: 2,
  elements: [el('fire'), el('water'), el('wind'), el('ice', 1)],
  skills: [
    sk({ id: 'slash', tier: 0, tags: ['blade', 'basic'], spCost: 0, cooldown: 0, shape: STRIKE }),
    sk({ id: 'whirlwind', tags: ['blade', 'spin'], shape: SPIN }),
    sk({ id: 'sword_throw', tags: ['blade', 'projectile'], shape: PROJECTILE }),
    sk({ id: 'frost_nova', weapons: undefined, element: 'ice', tags: ['arcane'], shape: NOVA }),
    sk({ id: 'rising_kick', weapons: undefined, tags: ['melee'], shape: STRIKE }),
    sk({ id: 'palm_strike', weapons: undefined, tags: ['melee'], shape: STRIKE }),
    sk({ id: 'bubble_lance', weapons: undefined, element: 'water', tags: ['echo', 'projectile'], shape: PROJECTILE }),
  ],
  morphs: [],
  recipes: [],
  classes: [
    klass({ id: 'brawler', clauses: [{ tags: ['melee'], count: 3 }] }),
    klass({ id: 'tidecaller', clauses: [{ tags: ['water'], count: 3 }] }),
  ],
  essences: [
    {
      id: 'split',
      name: 'Split',
      icon: 'i',
      desc: '',
      affix: { text: 'Split', pos: 'prefix' },
      category: 'multiply',
      appliesTo: ['projectile'],
      powerMul: 0.55,
      spMul: 1.3,
      mod: { count: 2, spread: 25 },
    },
  ],
  passives: [
    { id: 'sure_footing', name: 'Sure Footing', icon: 'p', desc: '', source: 'trainer', maxRank: 3, effect: { kind: 'stat', stat: 'speed', pct: 3 } },
    { id: 'keen_eye', name: 'Keen Eye', icon: 'p', desc: '', source: 'trainer', maxRank: 1, effect: { kind: 'stat', stat: 'crit', pct: 2 } },
  ],
  trainers: [
    {
      id: 'hale',
      npc: 'hale',
      title: 'Drill Yard',
      lessons: [
        { id: 'hale_kick', name: 'Rising Kick', blurb: '', grants: { skill: 'rising_kick' }, requires: [], cost: { coins: 20 }, questOnly: true },
        {
          id: 'hale_footing',
          name: 'Sure Footing',
          blurb: '',
          grants: { passive: 'sure_footing' },
          requires: [{ type: 'lesson', id: 'hale_kick' }],
          repeatable: true,
          questOnly: true,
        },
        { id: 'hale_split', name: 'Split Essence', blurb: '', grants: { essence: 'split', count: 2 }, requires: [], repeatable: true, questOnly: true },
        { id: 'hale_free', name: 'Keen Eye', blurb: '', grants: { passive: 'keen_eye' }, requires: [] },
        { id: 'hale_secret', name: 'Secret Form', blurb: '', grants: { element: 'wind' }, requires: [], questOnly: true },
      ],
    },
  ],
  monsters: [jellop, jellopKing, pip, boar, boarAlpha, brinewisp],
  items: [
    { id: 'fish', name: 'Lake Fish', plural: 'Lake Fish', icon: 'f', kind: 'material', desc: '' },
    { id: 'ore', name: 'Iron Ore', icon: 'o', kind: 'material', desc: '' },
    { id: 'herb', name: 'Meadow Herb', icon: 'h', kind: 'material', desc: '' },
  ],
  quests: QUESTS,
};

const reg = new Registry(DATA);

// ------------------------------------------------------------------ helpers

/** A bag the tests can inspect (same contract as the game's). */
function bag(coins = 0, items: Record<string, number> = {}) {
  const held = { coins, items: { ...items } };
  const inventory: Inventory = {
    count: (id) => held.items[id] ?? 0,
    coins: () => held.coins,
    spend: (cost) => {
      if (held.coins < (cost.coins ?? 0)) return false;
      if (Object.entries(cost.items ?? {}).some(([id, n]) => (held.items[id] ?? 0) < n)) return false;
      held.coins -= cost.coins ?? 0;
      for (const [id, n] of Object.entries(cost.items ?? {})) held.items[id] = (held.items[id] ?? 0) - n;
      return true;
    },
  };
  return { held, inventory };
}

/** A book on the fixture with a settable game clock and bag. */
function newBook(items: Record<string, number> = {}, state?: SkillBookState) {
  const b = new SkillBook(reg, state);
  const clock = { t: 0 };
  b.now = () => clock.t;
  const { held, inventory } = bag(0, items);
  b.inv = inventory;
  return { book: b, clock, held };
}

/** Collects every payload of one event type. */
function listen<K extends keyof SkillBookEvents>(b: SkillBook, type: K): SkillBookEvents[K][] {
  const out: SkillBookEvents[K][] = [];
  b.events.on(type, (e) => out.push(e));
  return out;
}

const skill = (id: string): SkillDef => reg.skill(id)!;

/** A bare QuestContext for the pure functions (nothing known, empty bag, clock at `now`). */
function bareCtx(over: Partial<QuestContext> = {}): QuestContext {
  return {
    level: 1,
    worn: null,
    lessons: [],
    hasElement: () => false,
    elementsKnown: () => 0,
    rank: () => 0,
    flag: () => 0,
    classRank: () => 0,
    tagCount: () => 0,
    itemCount: () => 0,
    witness: () => 0,
    now: () => 0,
    ...over,
  };
}

const texts = (b: SkillBook, id: string): string[] => b.questProgress(id).map((p) => p.text);

// ------------------------------------------------------------------ registry

describe('registry', () => {
  it('indexes quests and validates the fixture', () => {
    expect(reg.validate()).toEqual([]);
    expect(reg.quest('pell_net')?.turnIn).toBe('brann');
    expect(reg.quest('nope')).toBeUndefined();
    expect(reg.questsBy('hale').map((x) => x.id)).toEqual(['hale_kick_drill', 'hale_footwork']);
    expect(reg.questsBy('nobody')).toEqual([]);
    expect(reg.questsTurnedInAt('brann').map((x) => x.id)).toEqual(['pell_net', 'brann_throw']);
    expect(reg.questsForLesson('hale_kick').map((x) => x.id)).toEqual(['hale_kick_drill']);
    expect([...reg.quests.keys()]).toEqual(QUESTS.map((x) => x.id));
  });

  it('works without any quest data', () => {
    const { quests: _omit, ...rest } = DATA;
    const bare = new Registry(rest);
    expect(bare.quests.size).toBe(0);
    expect(bare.validate()).toEqual([]);
    const b = new SkillBook(bare);
    expect(b.quests()).toEqual([]);
    expect(b.quests('hale')).toEqual([]);
    expect(b.questStatus('hale_kick_drill')).toBe('locked');
    expect(b.notifyQuest({ type: 'kill', monster: jellop })).toEqual([]);
  });

  it('reports broken quest data', () => {
    const bad: QuestDef[] = [
      q({
        id: 'x_refs',
        giver: '',
        after: ['x_refs', 'ghost'],
        requires: [{ type: 'skill', id: 'nope' }, { type: 'flag', id: 'Bad Flag', min: 1 }],
        objectives: [
          { kind: 'kill', monster: 'dragon', count: 0 },
          { kind: 'gather', node: 'gold' as never, count: 2 },
          { kind: 'deliver', item: 'gem', count: 1 },
          { kind: 'visit', map: 'Mirror Lake' },
          { kind: 'use', skill: 'nope', count: 1 },
          { kind: 'cast', element: 'plasma' as ElementId, shape: 'wave' as never, map: 'vale.mirror_lake', count: 1 },
          { kind: 'witness', skill: 'slash', count: 1 },
          { kind: 'state', requires: { type: 'item', id: 'gem', count: 1 }, label: '' },
        ],
        rewards: {
          lesson: 'nope',
          skill: 'nope',
          passive: 'nope',
          element: 'plasma' as ElementId,
          essences: { nope: 1, split: 0 },
          items: { gem: 1 },
          whisper: 'nope',
          flag: 'has space',
          coins: -1,
        },
        repeatable: { cooldownMs: -5 },
      }),
      q({ id: 'x_empty', giver: 'a', objectives: [] }),
      q({ id: 'x_empty', giver: 'b', objectives: [{ kind: 'talk', npc: 'a' }] }),
      q({ id: 'x_loop_a', giver: 'a', after: ['x_loop_b'], objectives: [{ kind: 'talk', npc: 'a' }] }),
      q({ id: 'x_loop_b', giver: 'a', after: ['x_loop_a'], objectives: [{ kind: 'talk', npc: 'a' }] }),
      q({ id: 'x_twice', giver: 'a', objectives: [{ kind: 'talk', npc: 'a' }], rewards: { lesson: 'hale_kick' } }),
    ];
    const errs = new Registry({ ...DATA, quests: [...QUESTS, ...bad] }).validate();
    const expected = [
      'quest x_empty: duplicate id',
      'quest x_refs: empty giver',
      'quest x_refs: comes after itself',
      "quest x_refs: unknown 'after' quest ghost",
      'quest x_refs: unknown skill nope',
      'quest x_refs: malformed flag id Bad Flag',
      'quest x_refs objective 1 (kill): count must be a whole number >= 1',
      'quest x_refs objective 1 (kill): unknown monster dragon',
      'quest x_refs objective 2 (gather): unknown node kind gold',
      'quest x_refs objective 3 (deliver): unknown item gem',
      'quest x_refs objective 4 (visit): malformed map id Mirror Lake',
      'quest x_refs objective 5 (use): unknown skill nope',
      'quest x_refs objective 6 (cast): unknown element plasma',
      'quest x_refs objective 6 (cast): unknown shape wave',
      'quest x_refs objective 7 (witness): slash is not an echo technique of any monster',
      'quest x_refs objective 8 (state): empty label',
      'quest x_refs objective 8 (state): unknown item gem',
      'quest x_refs: unknown reward lesson nope',
      'quest x_refs: unknown reward skill nope',
      'quest x_refs: unknown reward passive nope',
      'quest x_refs: unknown reward element plasma',
      'quest x_refs: unknown reward essence nope',
      'quest x_refs: reward essence split count must be a whole number >= 1',
      'quest x_refs: unknown reward item gem',
      'quest x_refs: unknown whisper class nope',
      'quest x_refs: malformed reward flag has space',
      'quest x_refs: reward coins must be >= 0',
      'quest x_refs: repeatable cooldownMs must be >= 0',
      'quest x_empty: no objectives',
      "quest x_loop_a: 'after' chain loops back to itself",
      "quest x_loop_b: 'after' chain loops back to itself",
      'lesson hale_kick: reward of 2 non-repeatable quests (hale_kick_drill, x_twice)',
    ];
    expect([...errs].sort()).toEqual([...expected].sort());
  });

  it('allows a repeatable bounty and one quest to share a lesson', () => {
    const extra = q({
      id: 'x_bounty',
      giver: 'a',
      objectives: [{ kind: 'talk', npc: 'a' }],
      rewards: { lesson: 'hale_kick' },
      repeatable: { cooldownMs: 0 },
    });
    expect(new Registry({ ...DATA, quests: [...QUESTS, extra] }).validate()).toEqual([]);
  });
});

// ------------------------------------------------------------------ status & offers

describe('status, chains and offers', () => {
  it('starts available or locked (after / requires) and explains why', () => {
    const { book } = newBook();
    expect(book.questStatus('hale_kick_drill')).toBe('available');
    expect(book.questStatus('hale_footwork')).toBe('locked');
    expect(book.questStatus('oru_still')).toBe('locked');
    expect(book.questStatus('nope')).toBe('locked');
    expect(book.acceptQuest('hale_footwork')).toEqual({ ok: false, message: 'Not yet: Complete Kick Drill.' });
    expect(book.acceptQuest('oru_still')).toEqual({ ok: false, message: 'Not yet: Attune Water.' });
    expect(book.acceptQuest('nope')).toMatchObject({ ok: false });
    book.learnElement('water', 'test');
    expect(book.questStatus('oru_still')).toBe('available');
  });

  it('walks a chain: accept, progress, ready, turn in, unlock the next', () => {
    const { book } = newBook();
    expect(book.acceptQuest('hale_kick_drill')).toEqual({ ok: true, message: 'Accepted Kick Drill.' });
    expect(book.acceptQuest('hale_kick_drill')).toEqual({ ok: false, message: 'You are already on Kick Drill.' });
    expect(book.state.quests?.active.hale_kick_drill).toEqual({ progress: [0], acceptedAt: 0 });
    expect(book.questStatus('hale_kick_drill')).toBe('active');
    expect(book.turnInQuest('hale_kick_drill')).toMatchObject({ ok: false, message: 'Not yet: Defeat Jellops 0/3.' });
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    expect(book.questStatus('hale_kick_drill')).toBe('ready');
    expect(book.turnInQuest('hale_kick_drill').ok).toBe(true);
    expect(book.questStatus('hale_kick_drill')).toBe('done');
    expect(book.acceptQuest('hale_kick_drill')).toEqual({ ok: false, message: 'You have already completed Kick Drill.' });
    expect(book.questStatus('hale_footwork')).toBe('available');
    expect(book.state.quests?.done).toEqual({ hale_kick_drill: 1 });
  });

  it("lists an NPC's quests sorted ready > available > active > cooldown > done > locked", () => {
    const { book, clock } = newBook({ fish: 9 });
    // Hale: kick drill done, footwork available.
    book.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    book.turnInQuest('hale_kick_drill');
    expect(book.quests('hale').map((v) => [v.quest.id, v.status])).toEqual([
      ['hale_footwork', 'available'],
      ['hale_kick_drill', 'done'],
    ]);
    // Footwork on cooldown after one run.
    book.acceptQuest('hale_footwork');
    book.notifyQuest({ type: 'use', skill: skill('rising_kick') });
    expect(book.quests('hale').map((v) => v.status)).toEqual(['active', 'done']);
    book.notifyQuest({ type: 'use', skill: skill('rising_kick') });
    expect(book.quests('hale').map((v) => v.status)).toEqual(['ready', 'done']);
    book.turnInQuest('hale_footwork');
    expect(book.quests('hale').map((v) => [v.quest.id, v.status])).toEqual([
      ['hale_footwork', 'cooldown'],
      ['hale_kick_drill', 'done'],
    ]);
    clock.t = 60_000;
    expect(book.quests('hale').map((v) => v.status)).toEqual(['available', 'done']);

    // Brann gives brann_throw and receives pell_net (only while it is active or ready).
    expect(book.quests('brann').map((v) => v.quest.id)).toEqual(['brann_throw']);
    book.acceptQuest('pell_net');
    expect(book.quests('brann').map((v) => [v.quest.id, v.status, v.turnIn])).toEqual([
      ['brann_throw', 'available', 'brann'],
      ['pell_net', 'active', 'brann'],
    ]);
    expect(book.quests('pell').map((v) => [v.quest.id, v.status, v.turnIn])).toEqual([['pell_net', 'active', 'brann']]);
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    expect(book.quests('brann').map((v) => v.quest.id)).toEqual(['pell_net', 'brann_throw']);
    // Oru's quest is locked until water is attuned: listed last.
    expect(book.quests('oru').map((v) => v.status)).toEqual(['locked']);
    // The log lists every quest in data order.
    expect(book.quests().map((v) => v.quest.id)).toEqual(QUESTS.map((x) => x.id));
  });

  it('repeats bounties after their cooldown on the game clock', () => {
    const { book, clock } = newBook();
    const run = (): void => {
      expect(book.acceptQuest('gus_split').ok).toBe(true);
      for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'gather', node: 'ore' });
      expect(book.turnInQuest('gus_split').ok).toBe(true);
    };
    clock.t = 500;
    run();
    expect(book.state.quests?.cooldown.gus_split).toBe(1500);
    expect(book.questStatus('gus_split')).toBe('cooldown');
    clock.t = 1499;
    expect(book.acceptQuest('gus_split')).toEqual({ ok: false, message: 'Split is not offered again yet.' });
    clock.t = 1500;
    expect(book.questStatus('gus_split')).toBe('available');
    run();
    expect(book.state.quests?.done.gus_split).toBe(2);
    expect(book.state.essences.split).toBe(4);
    // Each run's counters start over.
    clock.t = 5000;
    book.acceptQuest('gus_split');
    expect(book.state.quests?.active.gus_split).toEqual({ progress: [0], acceptedAt: 5000 });
  });
});

// ------------------------------------------------------------------ objectives

describe('objectives', () => {
  it('kill: monster (elites/wardens count toward their base), family, rank, all given filters', () => {
    const { book } = newBook();
    book.acceptQuest('hale_kick_drill');
    book.acceptQuest('rhea_hunt');
    book.notifyQuest({ type: 'kill', monster: pip }); // only 'any foe'
    book.notifyQuest({ type: 'kill', monster: jellopKing }); // jellop's warden: base, sprite, warden, any
    book.notifyQuest({ type: 'kill', monster: boar }); // beast but not elite
    expect(book.questProgress('hale_kick_drill').map((p) => p.have)).toEqual([1]);
    expect(texts(book, 'rhea_hunt')).toEqual([
      'Defeat an elite beast 0/1',
      'Defeat sprites 1/2',
      'Defeat a warden 1/1 ✓',
      'Defeat foes 3/4',
      'Mine ore 0/2',
      'Witness an echo 0/1',
    ]);
    book.notifyQuest({ type: 'kill', monster: boarAlpha });
    book.notifyQuest({ type: 'kill', monster: brinewisp }); // an elite sprite
    book.notifyQuest({ type: 'kill', monster: jellop });
    expect(book.questProgress('rhea_hunt').map((p) => p.have)).toEqual([1, 2, 1, 4, 0, 0]);
    expect(book.questProgress('hale_kick_drill')[0]).toMatchObject({ have: 2, need: 3, done: false });
    // Counters never pass their need.
    for (let i = 0; i < 5; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    expect(book.state.quests?.active.rhea_hunt.progress.slice(0, 4)).toEqual([1, 2, 1, 4]);
    expect(book.state.quests?.active.hale_kick_drill.progress).toEqual([3]);
  });

  it('only counts what happens after accepting', () => {
    const { book } = newBook();
    book.notifyQuest({ type: 'kill', monster: jellop });
    book.notifyQuest({ type: 'visit', map: 'vale.hearthvale' });
    book.acceptQuest('hale_kick_drill');
    book.acceptQuest('brann_throw');
    expect(book.questProgress('hale_kick_drill')[0].have).toBe(0);
    expect(book.questProgress('brann_throw')[1].done).toBe(false);
  });

  it('gather: counts the node kind', () => {
    const { book } = newBook();
    book.acceptQuest('gus_split');
    book.notifyQuest({ type: 'gather', node: 'fishing' });
    book.notifyQuest({ type: 'gather', node: 'ore' });
    expect(texts(book, 'gus_split')).toEqual(['Mine ore 1/3']);
  });

  it('deliver: reads the bag and consumes the items at turn-in', () => {
    const { book, held } = newBook({ fish: 4 });
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    expect(texts(book, 'pell_net')).toEqual(['Bring 5 Lake Fish (4 in bag)', 'Speak with Oru ✓', 'Visit Lake Islet ✓']);
    expect(book.questStatus('pell_net')).toBe('active');
    expect(book.turnInQuest('pell_net', 'brann')).toMatchObject({ ok: false, message: 'Not yet: Bring 5 Lake Fish (4 in bag).' });
    held.items.fish = 6;
    expect(book.questProgress('pell_net')[0]).toMatchObject({ have: 6, need: 5, done: true, text: 'Bring 5 Lake Fish (6 in bag) ✓' });
    expect(book.questStatus('pell_net')).toBe('ready');
    expect(book.turnInQuest('pell_net', 'brann').ok).toBe(true);
    expect(held.items.fish).toBe(1);
  });

  it('deliver: a bag that cannot pay changes nothing', () => {
    const { book } = newBook({ fish: 5 });
    book.inv = { count: () => 5, coins: () => 0, spend: () => false };
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    const before = book.serialize();
    expect(book.turnInQuest('pell_net')).toEqual({
      ok: false,
      message: 'You need 5 Lake Fish.',
      rewards: {},
      gameRewards: { coins: 0, items: {}, exp: 0 },
    });
    expect(book.serialize()).toEqual(before);
  });

  it('visit: entering after accept, or talking to the giver in its map', () => {
    const { book } = newBook();
    book.acceptQuest('brann_throw');
    book.notifyQuest({ type: 'visit', map: 'vale.greenmeadow' });
    book.notifyQuest({ type: 'talk', npc: 'pell', map: 'vale.hearthvale' }); // not the giver
    expect(book.questProgress('brann_throw')[1].done).toBe(false);
    book.notifyQuest({ type: 'talk', npc: 'brann', map: 'vale.hearthvale' });
    expect(book.questProgress('brann_throw')[1]).toMatchObject({ done: true, text: 'Visit Hearthvale ✓' });
    const other = newBook().book;
    other.acceptQuest('brann_throw');
    other.notifyQuest({ type: 'visit', map: 'vale.hearthvale' });
    expect(other.questProgress('brann_throw')[1].done).toBe(true);
  });

  it('talk: the named NPC, and turning in at an NPC counts as talking to it', () => {
    const { book } = newBook({ fish: 5 });
    book.acceptQuest('mirelle_errand');
    book.notifyQuest({ type: 'talk', npc: 'pell' });
    expect(book.questStatus('mirelle_errand')).toBe('active');
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    const ready = listen(book, 'questReady');
    book.turnInQuest('pell_net', 'brann');
    expect(book.questStatus('mirelle_errand')).toBe('ready');
    expect(ready.map((r) => r.quest.id)).toEqual(['mirelle_errand']);
  });

  it('use: tag or skill; variants and merges count toward their base skill', () => {
    const { book } = newBook();
    book.acceptQuest('brann_throw');
    book.notifyQuest({ type: 'use', skill: skill('slash') });
    book.notifyQuest({ type: 'use', skill: skill('sword_throw@fire~split') });
    expect(texts(book, 'brann_throw')[0]).toBe('Use Sword Throw 1/2');
    book.notifyQuest({ type: 'use', skill: skill('sword_throw') });
    expect(book.questProgress('brann_throw')[0].done).toBe(true);

    // Tag matching uses the normalized tags (element ids and weapons count).
    const melee = newBook().book;
    melee.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) melee.notifyQuest({ type: 'kill', monster: jellop });
    melee.turnInQuest('hale_kick_drill');
    melee.acceptQuest('hale_footwork');
    melee.notifyQuest({ type: 'use', skill: skill('slash') });
    melee.notifyQuest({ type: 'use', skill: skill('palm_strike') });
    expect(texts(melee, 'hale_footwork')).toEqual(['Use melee skills 1/2']);
  });

  it('cast: any of element / shape / tag, only in the given map', () => {
    const { book } = newBook();
    book.learnElement('water', 'test');
    book.acceptQuest('oru_still');
    book.notifyQuest({ type: 'cast', skill: skill('frost_nova'), map: 'vale.greenmeadow' });
    book.notifyQuest({ type: 'cast', skill: skill('slash'), map: 'vale.mirror_lake' });
    expect(book.questProgress('oru_still')[1]).toMatchObject({ have: 0, text: 'Cast ice or spin at Mirror Lake 0/2' });
    book.notifyQuest({ type: 'cast', skill: skill('frost_nova'), map: 'vale.mirror_lake' }); // element
    book.notifyQuest({ type: 'cast', skill: skill('whirlwind'), map: 'vale.mirror_lake' }); // shape
    expect(book.questProgress('oru_still')[1]).toMatchObject({ have: 2, done: true });
  });

  it('witness: marks toward the named echo (id or SkillDef) or any echo', () => {
    const { book } = newBook();
    book.learnElement('water', 'test');
    book.acceptQuest('oru_still');
    book.acceptQuest('rhea_hunt');
    book.notifyQuest({ type: 'witness', skill: 'tremor' });
    expect(book.questProgress('oru_still')[2].have).toBe(0);
    expect(book.questProgress('rhea_hunt')[5].done).toBe(true);
    book.notifyQuest({ type: 'witness', skill: 'bubble_lance' });
    book.notifyQuest({ type: 'witness', skill: skill('bubble_lance') });
    expect(texts(book, 'oru_still')[2]).toBe('Witness Bubble Lance 2/2 ✓');
  });

  it('state: a live condition, announced when it flips', () => {
    const { book } = newBook();
    book.learnElement('water', 'test');
    book.acceptQuest('oru_still');
    for (let i = 0; i < 2; i++) {
      book.notifyQuest({ type: 'cast', skill: skill('frost_nova'), map: 'vale.mirror_lake' });
      book.notifyQuest({ type: 'witness', skill: 'bubble_lance' });
    }
    expect(texts(book, 'oru_still')[0]).toBe('Learn Whirlwind');
    expect(book.questStatus('oru_still')).toBe('active');
    const progress = listen(book, 'questProgress');
    const ready = listen(book, 'questReady');
    book.learn('whirlwind', 'test');
    expect(texts(book, 'oru_still')[0]).toBe('Learn Whirlwind ✓');
    expect(book.questStatus('oru_still')).toBe('ready');
    expect(progress.map((p) => p.quest.id)).toEqual(['oru_still']);
    expect(ready.map((r) => [r.quest.id, r.turnIn])).toEqual([['oru_still', 'oru']]);
    // Nothing changed since: no repeat.
    book.refreshQuests();
    book.incFlag('kills');
    expect(ready).toHaveLength(1);
  });

  it('names NPCs and maps through book.names, else prettifies ids', () => {
    const { book } = newBook();
    book.acceptQuest('pell_net');
    expect(texts(book, 'pell_net').slice(1)).toEqual(['Speak with Oru', 'Visit Lake Islet']);
    book.names = { npc: (id) => (id === 'oru' ? 'Old Hermit Oru' : undefined), map: () => 'The Islet' };
    expect(texts(book, 'pell_net').slice(1)).toEqual(['Speak with Old Hermit Oru', 'Visit The Islet']);
    expect(book.turnInQuest('pell_net', 'pell').message).toBe('Bring this to Brann.');
  });

  it('shows every objective met once a quest is done', () => {
    const { book } = newBook();
    book.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    book.turnInQuest('hale_kick_drill');
    expect(texts(book, 'hale_kick_drill')).toEqual(['Defeat Jellops 3/3 ✓']);
    expect(book.questProgress('nope')).toEqual([]);
  });
});

// ------------------------------------------------------------------ pure functions

describe('pure engine', () => {
  it('notifyQuest returns the ids that became ready, once', () => {
    const state = emptyState();
    const ctx = bareCtx();
    expect(acceptQuest(reg, state, ctx, 'hale_kick_drill').ok).toBe(true);
    expect(acceptQuest(reg, state, ctx, 'gus_split').ok).toBe(true);
    const kill = { type: 'kill', monster: jellop } as const;
    expect(notifyQuest(reg, state, kill, ctx)).toEqual([]);
    expect(notifyQuest(reg, state, kill, ctx)).toEqual([]);
    expect(notifyQuest(reg, state, kill, ctx)).toEqual(['hale_kick_drill']);
    expect(notifyQuest(reg, state, kill, ctx)).toEqual([]);
    expect(advanceQuests(reg, state, { type: 'gather', node: 'ore' }, ctx)).toEqual({ progressed: ['gus_split'], ready: [] });
    // Without a context readiness reads counters only.
    expect(notifyQuest(reg, state, { type: 'gather', node: 'ore' })).toEqual([]);
    expect(notifyQuest(reg, state, { type: 'gather', node: 'ore' })).toEqual(['gus_split']);
    expect(questStatus(reg, state, ctx, 'gus_split')).toBe('ready');
  });

  it('a deliver quest whose counters fill while the bag is short is not ready', () => {
    const state = emptyState();
    let fish = 0;
    const ctx = bareCtx({ itemCount: (id) => (id === 'fish' ? fish : 0) });
    acceptQuest(reg, state, ctx, 'pell_net');
    expect(notifyQuest(reg, state, { type: 'talk', npc: 'oru' }, ctx)).toEqual([]);
    expect(notifyQuest(reg, state, { type: 'visit', map: 'vale.lake_islet' }, ctx)).toEqual([]);
    fish = 5;
    expect(questStatus(reg, state, ctx, 'pell_net')).toBe('ready');
    expect(objectiveProgress(reg, state, ctx, 'pell_net').every((p) => p.done)).toBe(true);
  });

  it('works on a state saved before quests existed', () => {
    const state: SkillBookState = emptyState();
    delete state.quests;
    const ctx = bareCtx();
    expect(questStatus(reg, state, ctx, 'hale_kick_drill')).toBe('available');
    expect(notifyQuest(reg, state, { type: 'kill', monster: jellop }, ctx)).toEqual([]);
    expect(state.quests).toBeUndefined();
    expect(acceptQuest(reg, state, ctx, 'hale_kick_drill').ok).toBe(true);
    expect(state.quests).toEqual({
      ...emptyQuestState(),
      active: { hale_kick_drill: { progress: [0], acceptedAt: 0 } },
      tracked: ['hale_kick_drill'],
    });
  });
});

// ------------------------------------------------------------------ actions, rewards & events

describe('turn-in and rewards', () => {
  it('validates the turn-in NPC', () => {
    const { book } = newBook({ fish: 5 });
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    expect(book.turnInQuest('pell_net', 'pell')).toMatchObject({ ok: false, message: 'Bring this to Brann.' });
    expect(book.questStatus('pell_net')).toBe('ready');
    expect(book.turnInQuest('hale_kick_drill')).toMatchObject({ ok: false, message: 'You are not on that quest.' });
    expect(book.turnInQuest('pell_net', 'brann').ok).toBe(true);
  });

  it('applies book rewards and hands coins, items and exp to the game', () => {
    const { book } = newBook({ fish: 5 });
    const learned = listen(book, 'learned');
    const elements = listen(book, 'element');
    const hints = listen(book, 'hint');
    const completed = listen(book, 'questCompleted');
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    const res = book.turnInQuest('pell_net', 'brann');
    expect(res).toEqual({
      ok: true,
      message: 'Completed Net!',
      rewards: QUESTS[2].rewards,
      gameRewards: { coins: 0, items: {}, exp: 0 },
    });
    expect(book.progress('palm_strike')?.source).toBe('quest:pell_net');
    expect(learned.map((l) => [l.skill.id, l.source])).toEqual([['palm_strike', 'quest:pell_net']]);
    expect(elements.map((e) => [e.element.id, e.source])).toEqual([['water', 'quest:pell_net']]);
    expect(book.state.essences.split).toBe(1);
    expect(book.state.whispered).toEqual(['tidecaller']);
    expect(hints.map((h) => h.classId)).toEqual(['tidecaller']);
    expect(book.flag('pell_net_done')).toBe(1);
    expect(completed.map((c) => [c.quest.id, c.count])).toEqual([['pell_net', 1]]);

    const drill = newBook().book;
    drill.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) drill.notifyQuest({ type: 'kill', monster: jellop });
    expect(drill.turnInQuest('hale_kick_drill')).toMatchObject({
      ok: true,
      gameRewards: { coins: 15, items: { herb: 2 }, exp: 40 },
    });
  });

  it("grants a lesson exactly as takeLesson does (free, recorded, 'lesson' emitted)", () => {
    // Same data with questOnly lifted and no costs, so takeLesson can teach it.
    const open = new Registry({
      ...DATA,
      trainers: DATA.trainers.map((t) => ({
        ...t,
        lessons: t.lessons.map(({ questOnly: _q, cost: _c, ...l }) => l),
      })),
    });
    const taught = new SkillBook(open);
    const tLessons = listen(taught, 'lesson');
    const tHints = listen(taught, 'hint');
    expect(taught.takeLesson('hale_kick').ok).toBe(true);

    const { book } = newBook();
    const qLessons = listen(book, 'lesson');
    const qHints = listen(book, 'hint');
    book.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    expect(book.turnInQuest('hale_kick_drill').ok).toBe(true);

    const { quests: _a, ...viaLesson } = taught.serialize();
    const { quests: _b, ...viaQuest } = book.serialize();
    expect(viaQuest).toEqual(viaLesson);
    expect(book.progress('rising_kick')?.source).toBe('lesson:hale_kick');
    expect(book.state.lessons).toEqual(['hale_kick']);
    expect(qLessons.map((l) => [l.lesson.id, l.trainer.id])).toEqual(tLessons.map((l) => [l.lesson.id, l.trainer.id]));
    expect(qHints).toEqual(tHints);
    expect(qHints.map((h) => h.classId)).toEqual(['brawler']);

    // Passive and essence grants too (the repeatable bounty raises the passive each run).
    const runFootwork = (b: SkillBook): void => {
      b.acceptQuest('hale_footwork');
      for (let i = 0; i < 2; i++) b.notifyQuest({ type: 'use', skill: skill('rising_kick') });
      expect(b.turnInQuest('hale_footwork').ok).toBe(true);
    };
    runFootwork(book);
    expect(book.state.passives.sure_footing).toBe(1);
    expect(book.state.lessons).toEqual(['hale_kick', 'hale_footing']);
    expect(taught.takeLesson('hale_footing').ok).toBe(true);
    expect(taught.state.passives).toEqual(book.state.passives);
  });

  it('refuses questOnly lessons at the trainer but still teaches the others', () => {
    const { book, held } = newBook();
    held.coins = 100;
    expect(book.takeLesson('hale_kick')).toEqual({ ok: false, message: 'Learned through Kick Drill' });
    expect(book.takeLesson('hale_split')).toEqual({ ok: false, message: 'Learned through Split' });
    expect(book.takeLesson('hale_secret')).toEqual({ ok: false, message: 'Learned through a quest' });
    expect(held.coins).toBe(100);
    expect(book.state.lessons).toEqual([]);
    expect(book.takeLesson('hale_free')).toEqual({ ok: true, message: 'Learned Keen Eye.' });
    // The quest teaching an already taken lesson counts as completed: it is never offered for nothing.
    expect(book.questStatus('tamsin_free')).toBe('done');
    expect(book.acceptQuest('tamsin_free').ok).toBe(false);
    expect(book.state.passives.keen_eye).toBe(1);
    expect(book.state.lessons).toEqual(['hale_free']);
  });

  it('emits questAccepted, questProgress, questReady and questCompleted', () => {
    const { book } = newBook();
    const log: string[] = [];
    book.events.on('questAccepted', (e) => log.push(`accepted ${e.quest.id}`));
    book.events.on('questProgress', (e) => log.push(`progress ${e.quest.id} ${e.progress.map((p) => p.text).join('; ')}`));
    book.events.on('questReady', (e) => log.push(`ready ${e.quest.id} @${e.turnIn}`));
    book.events.on('questCompleted', (e) => log.push(`completed ${e.quest.id} x${e.count} +${e.gameRewards.coins}`));
    book.acceptQuest('hale_kick_drill');
    book.notifyQuest({ type: 'kill', monster: pip });
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    book.turnInQuest('hale_kick_drill');
    expect(log).toEqual([
      'accepted hale_kick_drill',
      'progress hale_kick_drill Defeat Jellops 1/3',
      'progress hale_kick_drill Defeat Jellops 2/3',
      'progress hale_kick_drill Defeat Jellops 3/3 ✓',
      'ready hale_kick_drill @hale',
      'completed hale_kick_drill x1 +15',
    ]);
  });

  it('announces questReady on accept when the objectives are already met', () => {
    const { book } = newBook({ fish: 5 });
    const ready = listen(book, 'questReady');
    const deliverOnly = new Registry({
      ...DATA,
      quests: [q({ id: 'pell_fish', giver: 'pell', objectives: [{ kind: 'deliver', item: 'fish', count: 5 }] })],
    });
    const b = new SkillBook(deliverOnly);
    b.inv = book.inv;
    const r2 = listen(b, 'questReady');
    expect(b.acceptQuest('pell_fish').ok).toBe(true);
    expect(r2.map((r) => r.quest.id)).toEqual(['pell_fish']);
    expect(ready).toEqual([]);
  });

  it('abandons: counters lost, untracked, offered again', () => {
    const { book } = newBook();
    book.acceptQuest('hale_kick_drill');
    book.notifyQuest({ type: 'kill', monster: jellop });
    expect(book.abandonQuest('hale_kick_drill')).toEqual({ ok: true, message: 'Abandoned Kick Drill.' });
    expect(book.abandonQuest('hale_kick_drill')).toEqual({ ok: false, message: 'You are not on that quest.' });
    expect(book.questStatus('hale_kick_drill')).toBe('available');
    expect(book.trackedQuests()).toEqual([]);
    book.acceptQuest('hale_kick_drill');
    expect(book.questProgress('hale_kick_drill')[0].have).toBe(0);
  });
});

// ------------------------------------------------------------------ tracking

describe('tracking', () => {
  it('auto-tracks on accept, newest first, at most three', () => {
    const { book } = newBook();
    for (const id of ['hale_kick_drill', 'pell_net', 'rhea_hunt', 'gus_split']) book.acceptQuest(id);
    expect(QUEST_TRACK_LIMIT).toBe(3);
    expect(book.state.quests?.tracked).toEqual(['gus_split', 'rhea_hunt', 'pell_net']);
    expect(book.trackQuest('hale_kick_drill', true)).toEqual({ ok: true, message: 'Tracking Kick Drill.' });
    expect(book.state.quests?.tracked).toEqual(['hale_kick_drill', 'gus_split', 'rhea_hunt']);
    expect(book.trackQuest('rhea_hunt', false)).toEqual({ ok: true, message: 'Stopped tracking Hunt.' });
    expect(book.state.quests?.tracked).toEqual(['hale_kick_drill', 'gus_split']);
    expect(book.trackQuest('oru_still', true)).toEqual({ ok: false, message: 'Still is not an active quest.' });
    expect(book.trackQuest('nope', true)).toMatchObject({ ok: false });

    const tracked = book.trackedQuests();
    expect(tracked.map((t) => [t.quest.id, t.status, t.turnIn])).toEqual([
      ['hale_kick_drill', 'active', 'hale'],
      ['gus_split', 'active', 'gus'],
    ]);
    expect(tracked[0].progress.map((p) => p.text)).toEqual(['Defeat Jellops 0/3']);

    // Turning in untracks.
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    book.turnInQuest('hale_kick_drill');
    expect(book.state.quests?.tracked).toEqual(['gus_split']);
  });
});

// ------------------------------------------------------------------ determinism & persistence

describe('determinism and persistence', () => {
  /** One scripted session; returns the saved state and every quest event. */
  function play(): { saved: SkillBookState; log: string[] } {
    const { book, clock } = newBook({ fish: 5 });
    const log: string[] = [];
    for (const type of ['questAccepted', 'questProgress', 'questReady', 'questCompleted'] as const) {
      book.events.on(type, (e) => log.push(`${type}:${e.quest.id}`));
    }
    book.acceptQuest('hale_kick_drill');
    book.acceptQuest('pell_net');
    clock.t = 250;
    book.acceptQuest('gus_split');
    for (const m of [jellop, boar, jellop, jellopKing]) book.notifyQuest({ type: 'kill', monster: m });
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'gather', node: 'ore' });
    clock.t = 900;
    book.turnInQuest('gus_split');
    book.turnInQuest('hale_kick_drill');
    book.turnInQuest('pell_net', 'brann');
    return { saved: book.serialize(), log };
  }

  it('replays identically', () => {
    const a = play();
    const b = play();
    expect(a.saved).toEqual(b.saved);
    expect(a.log).toEqual(b.log);
    expect(a.saved.quests).toEqual({
      active: {},
      done: { gus_split: 1, hale_kick_drill: 1, pell_net: 1 },
      cooldown: { gus_split: 1900 },
      tracked: [],
    });
  });

  it('round-trips active quests through serialize()', () => {
    const { book } = newBook();
    book.acceptQuest('rhea_hunt');
    book.notifyQuest({ type: 'kill', monster: boarAlpha });
    const saved = JSON.parse(JSON.stringify(book.serialize())) as SkillBookState;
    const copy = newBook({}, saved).book;
    expect(copy.serialize()).toEqual(book.serialize());
    expect(texts(copy, 'rhea_hunt')).toEqual(texts(book, 'rhea_hunt'));
    expect(copy.trackedQuests().map((t) => t.quest.id)).toEqual(['rhea_hunt']);
    // A loaded book does not re-announce what was already true, but keeps counting.
    const ready = listen(copy, 'questReady');
    copy.refreshQuests();
    expect(ready).toEqual([]);
    copy.notifyQuest({ type: 'kill', monster: jellop });
    expect(copy.questProgress('rhea_hunt')[1].have).toBe(1);
  });

  it('loads a save from before quests with an empty quest state', () => {
    const old = emptyState() as Partial<SkillBookState>;
    delete old.quests;
    const { book } = newBook({}, old as SkillBookState);
    expect(book.state.quests).toEqual(emptyQuestState());
    expect(book.acceptQuest('hale_kick_drill').ok).toBe(true);
  });
});

// ------------------------------------------------------------------ review fixes (quest review Q-1..Q-14, QC-7)

/** The fixture plus extra quests (each test names what it adds). */
function withQuests(...extra: QuestDef[]): Registry {
  return new Registry({ ...DATA, quests: [...QUESTS, ...extra] });
}

/** A book on another registry, with a settable bag. */
function bookOn(r: Registry, items: Record<string, number> = {}, state?: SkillBookState) {
  const b = new SkillBook(r, state);
  const { held, inventory } = bag(0, items);
  b.inv = inventory;
  return { book: b, held };
}

describe('review fixes', () => {
  const echoQuest = q({ id: 'gus_echo', giver: 'gus', objectives: [{ kind: 'witness', skill: 'bubble_lance', count: 2 }], rewards: { coins: 5 } });

  it('Q-1: a witness objective for an echo already known is met (no soft-lock once the echo is learned)', () => {
    const r = withQuests(echoQuest);
    // Learned before accepting: ready at once.
    const early = bookOn(r).book;
    early.learn('bubble_lance', 'test');
    const ready = listen(early, 'questReady');
    expect(early.acceptQuest('gus_echo').ok).toBe(true);
    expect(early.questStatus('gus_echo')).toBe('ready');
    expect(ready.map((e) => e.quest.id)).toEqual(['gus_echo']);
    expect(early.questProgress('gus_echo')[0].text).toBe('Witness Bubble Lance 2/2 ✓');
    // Learned mid-quest (marks banked before accepting): the flip is announced and the quest turns in.
    const mid = bookOn(r).book;
    mid.acceptQuest('gus_echo');
    mid.notifyQuest({ type: 'witness', skill: 'bubble_lance' });
    const flips = listen(mid, 'questReady');
    mid.learn('bubble_lance', 'echo:brinewisp');
    expect(flips.map((e) => e.quest.id)).toEqual(['gus_echo']);
    expect(mid.turnInQuest('gus_echo', 'gus').ok).toBe(true);
  });

  it('Q-2: the first live-objective flip after a reload is announced', () => {
    const r = withQuests(
      q({ id: 'gus_fish', giver: 'gus', objectives: [{ kind: 'deliver', item: 'fish', count: 2 }] }),
      q({ id: 'gus_learn', giver: 'gus', objectives: [{ kind: 'state', requires: { type: 'skill', id: 'whirlwind' }, label: 'Learn Whirlwind' }] }),
    );
    const first = bookOn(r).book;
    first.acceptQuest('gus_fish');
    first.acceptQuest('gus_learn');
    const saved = first.serialize();
    // As the game does: build the book, then hand it the (already loaded) bag.
    const loaded = new SkillBook(r, saved);
    const { held, inventory } = bag();
    loaded.inv = inventory;
    const ready = listen(loaded, 'questReady');
    const progress = listen(loaded, 'questProgress');
    held.items.fish = 2;
    loaded.refreshQuests();
    loaded.learn('whirlwind', 'test');
    expect(ready.map((e) => e.quest.id)).toEqual(['gus_fish', 'gus_learn']);
    expect(progress.map((e) => e.quest.id)).toEqual(['gus_fish', 'gus_learn']);
    // A bag that already satisfied the delivery when it was handed over is not re-announced.
    const again = new SkillBook(r, loaded.serialize());
    const quiet = listen(again, 'questReady');
    again.inv = bag(0, { fish: 2 }).inventory;
    again.refreshQuests();
    expect(quiet).toEqual([]);
  });

  it('Q-3 / QC-2: an owned lesson is not granted again; an exhausted drill is done', () => {
    // Skill lesson already known: the turn-in pays the rest, emits no 'lesson', leaves the lesson out.
    const { book } = newBook();
    book.learn('rising_kick', 'test');
    const lessons = listen(book, 'lesson');
    const learned = listen(book, 'learned');
    book.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'kill', monster: jellop });
    const res = book.turnInQuest('hale_kick_drill', 'hale');
    expect(res.ok).toBe(true);
    expect(res.rewards.lesson).toBeUndefined();
    expect(res.gameRewards).toEqual({ coins: 15, items: { herb: 2 }, exp: 40 });
    expect(lessons).toEqual([]);
    expect(learned).toEqual([]);
    expect(book.state.lessons).toEqual(['hale_kick']); // still counts as taken (lesson requirements)
    // Passive drill: once the passive is at max, the bounty has nothing left and is 'done'.
    book.state.passives.sure_footing = 2;
    const runFootwork = (): void => {
      expect(book.acceptQuest('hale_footwork').ok).toBe(true);
      for (let i = 0; i < 2; i++) book.notifyQuest({ type: 'use', skill: skill('rising_kick') });
      expect(book.turnInQuest('hale_footwork', 'hale').ok).toBe(true);
    };
    runFootwork();
    expect(book.state.passives.sure_footing).toBe(3);
    expect(book.questStatus('hale_footwork')).toBe('done');
    expect(book.acceptQuest('hale_footwork')).toEqual({ ok: false, message: 'Footwork has nothing more to teach you.' });
    expect(book.quests('hale').find((v) => v.quest.id === 'hale_footwork')?.status).toBe('done');
    // A drill already active when its passive maxes still turns in, without the lesson.
    const other = newBook().book;
    other.state.quests!.done.hale_kick_drill = 1;
    other.acceptQuest('hale_footwork');
    other.state.passives.sure_footing = 3;
    for (let i = 0; i < 2; i++) other.notifyQuest({ type: 'use', skill: skill('rising_kick') });
    const passives = listen(other, 'passive');
    const out = other.turnInQuest('hale_footwork', 'hale');
    expect(out.ok).toBe(true);
    expect(out.rewards.lesson).toBeUndefined();
    expect(passives).toEqual([]);
    // The pure engine without lessonOwned keeps the old payload.
    const state = emptyState();
    acceptQuest(reg, state, bareCtx(), 'hale_kick_drill');
    for (let i = 0; i < 3; i++) notifyQuest(reg, state, { type: 'kill', monster: jellop }, bareCtx());
    expect(turnInQuest(reg, state, bareCtx(), 'hale_kick_drill').rewards.lesson).toBe('hale_kick');
  });

  it('Q-5: accepting checks the giver; only a turn-in at an NPC counts as talking to it', () => {
    const r = withQuests(
      q({ id: 'gus_errand', giver: 'gus', turnIn: 'brann', objectives: [{ kind: 'visit', map: 'vale.greenmeadow' }] }),
      q({ id: 'oru_word', giver: 'oru', objectives: [{ kind: 'talk', npc: 'brann' }] }),
    );
    const { book } = bookOn(r);
    expect(book.acceptQuest('gus_errand', 'oru')).toEqual({ ok: false, message: 'Ask Gus about that.' });
    expect(book.acceptQuest('gus_errand', 'gus').ok).toBe(true);
    expect(book.acceptQuest('oru_word').ok).toBe(true);
    book.notifyQuest({ type: 'visit', map: 'vale.greenmeadow' });
    // Turned in without saying where: no talk with Brann happened.
    expect(book.turnInQuest('gus_errand').ok).toBe(true);
    expect(book.questStatus('oru_word')).toBe('active');
    // Turned in at Brann: that is a talk with Brann.
    const second = bookOn(r).book;
    second.acceptQuest('gus_errand', 'gus');
    second.acceptQuest('oru_word', 'oru');
    second.notifyQuest({ type: 'visit', map: 'vale.greenmeadow' });
    expect(second.turnInQuest('gus_errand', 'brann').ok).toBe(true);
    expect(second.questStatus('oru_word')).toBe('ready');
  });

  it('Q-6: questsFor reads only that NPC\'s quests and keeps the sort; questMarker summarises them', () => {
    const { book, held } = newBook();
    expect(book.questMarker('hale')).toBe('!');
    expect(book.questMarker('nobody')).toBeNull();
    book.acceptQuest('pell_net', 'pell');
    expect(book.questMarker('pell')).toBe('…');
    expect(book.questMarker('brann')).toBe('!'); // an offer outranks a quest in progress
    held.items.fish = 5;
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    expect(book.questMarker('brann')).toBe('?');
    expect(book.questMarker('pell')).toBe('…'); // ready, but handed in elsewhere
    expect(book.quests('brann').map((v) => `${v.quest.id}:${v.status}`)).toEqual(['pell_net:ready', 'brann_throw:available']);
    // The pure query with an empty bag: the delivery is unmet, so the offer sorts first.
    expect(questsFor(reg, book.state, bareCtx(), 'brann').map((v) => `${v.quest.id}:${v.status}`)).toEqual([
      'brann_throw:available',
      'pell_net:active',
    ]);
  });

  it('Q-7: a flag read by a quest state objective still announces readiness; objectivesDone matches the texts', () => {
    const r = withQuests(q({ id: 'gus_forge', giver: 'gus', objectives: [{ kind: 'state', requires: { type: 'flag', id: 'forge_success', min: 2 }, label: 'Forge twice' }] }));
    const { book } = bookOn(r);
    book.evaluateClasses(); // the first incFlag after construction always runs discovery; skip that catch-up
    book.acceptQuest('gus_forge');
    const ready = listen(book, 'questReady');
    book.incFlag('kills');
    book.incFlag('forge_success');
    expect(ready).toEqual([]);
    book.incFlag('forge_success');
    expect(ready.map((e) => e.quest.id)).toEqual(['gus_forge']);
    expect(objectivesDone(r, book.state, bareCtx({ flag: (id) => book.flag(id) }), 'gus_forge')).toEqual([true]);
    expect(objectivesDone(r, book.state, bareCtx(), 'nope')).toEqual([]);
  });

  it('Q-8: one item delivered by two objectives is rejected by validate and needs the sum', () => {
    const dup = q({
      id: 'gus_double',
      giver: 'gus',
      objectives: [
        { kind: 'deliver', item: 'fish', count: 3 },
        { kind: 'deliver', item: 'fish', count: 3 },
      ],
    });
    const r = withQuests(dup);
    expect(r.validate()).toEqual(['quest gus_double: delivers fish in more than one objective']);
    const { book, held } = bookOn(r, { fish: 3 });
    book.acceptQuest('gus_double');
    expect(book.questStatus('gus_double')).toBe('active');
    held.items.fish = 6;
    expect(book.questStatus('gus_double')).toBe('ready');
    expect(book.turnInQuest('gus_double', 'gus').ok).toBe(true);
    expect(held.items.fish).toBe(0);
  });

  it('Q-9: lessons taken before (or outside) quests credit the quest that teaches them', () => {
    const migrated = migrateBookState({ version: 2, lessons: ['hale_kick', 'hale_footing'] }, reg);
    expect(migrated.quests?.done).toEqual({ hale_kick_drill: 1 }); // repeatable hale_footwork is not credited
    const { book } = newBook({}, migrated);
    expect(book.questStatus('hale_kick_drill')).toBe('done');
    expect(book.questStatus('hale_footwork')).toBe('available');
    // An active quest is left to finish.
    const active = migrateBookState({ lessons: ['hale_kick'], quests: { active: { hale_kick_drill: { progress: [1] } } } }, reg);
    expect(active.quests?.done).toEqual({});
    expect(active.quests?.active.hale_kick_drill.progress).toEqual([1]);
  });

  it('Q-10: a species objective must not also count its elite (validate), and rank filters keep them apart', () => {
    const both = q({
      id: 'gus_pack',
      giver: 'gus',
      objectives: [
        { kind: 'kill', monster: 'boar', count: 2 },
        { kind: 'kill', monster: 'boar_alpha', count: 1 },
      ],
    });
    expect(withQuests(both).validate()).toEqual(['quest gus_pack: a boar_alpha kill also counts toward objective 1 (boar)']);
    const fixed = q({ ...both, objectives: [{ kind: 'kill', monster: 'boar', rank: 'common', count: 2 }, both.objectives[1]] });
    const r = withQuests(fixed);
    expect(r.validate()).toEqual([]);
    const { book } = bookOn(r);
    book.acceptQuest('gus_pack');
    book.notifyQuest({ type: 'kill', monster: boar });
    book.notifyQuest({ type: 'kill', monster: boarAlpha });
    expect(book.questStatus('gus_pack')).toBe('active');
    book.notifyQuest({ type: 'kill', monster: boar });
    expect(book.questStatus('gus_pack')).toBe('ready');
  });

  it('Q-11: a throwing listener does not cut a turn-in short', () => {
    const { book } = newBook({ fish: 5 });
    book.acceptQuest('pell_net');
    book.notifyQuest({ type: 'talk', npc: 'oru' });
    book.notifyQuest({ type: 'visit', map: 'vale.lake_islet' });
    book.events.on('learned', () => {
      throw new Error('UI toast crashed');
    });
    const completed = listen(book, 'questCompleted');
    const res = book.turnInQuest('pell_net', 'brann');
    expect(res.ok).toBe(true);
    expect((res.listenerError as Error).message).toBe('UI toast crashed');
    expect(completed).toHaveLength(1);
    expect(book.has('palm_strike')).toBe(true);
    expect(book.hasElement('water')).toBe(true);
    expect(book.state.essences.split).toBe(1);
    expect(book.state.whispered).toContain('tidecaller');
    expect(book.flag('pell_net_done')).toBe(1);
    // Without a throwing listener there is no error field.
    const calm = newBook().book;
    calm.acceptQuest('hale_kick_drill');
    for (let i = 0; i < 3; i++) calm.notifyQuest({ type: 'kill', monster: jellop });
    expect(calm.turnInQuest('hale_kick_drill', 'hale')).not.toHaveProperty('listenerError');
  });

  it('Q-12: without a context, quests with deliver or state objectives are never reported ready', () => {
    const state = emptyState();
    acceptQuest(reg, state, bareCtx(), 'pell_net');
    notifyQuest(reg, state, { type: 'talk', npc: 'oru' });
    const res = advanceQuests(reg, state, { type: 'visit', map: 'vale.lake_islet' });
    expect(res).toEqual({ progressed: ['pell_net'], ready: [] });
    // Counter-only quests still report.
    acceptQuest(reg, state, bareCtx(), 'hale_kick_drill');
    let ready: string[] = [];
    for (let i = 0; i < 3; i++) ready = notifyQuest(reg, state, { type: 'kill', monster: jellop });
    expect(ready).toEqual(['hale_kick_drill']);
  });

  it('Q-13: migration drops impossible quest entries; unknown quests can be abandoned', () => {
    const m = migrateBookState(
      {
        quests: {
          done: { hale_kick_drill: 1 },
          active: { hale_kick_drill: { progress: [3] }, gone_quest: { progress: [] }, pell_net: { progress: [] } },
          tracked: ['gone_quest', 'hale_kick_drill', 'pell_net'],
        },
      },
      reg,
    );
    expect(Object.keys(m.quests!.active)).toEqual(['gone_quest', 'pell_net']);
    expect(m.quests!.tracked).toEqual(['pell_net']);
    const { book } = newBook({}, m);
    expect(book.questStatus('hale_kick_drill')).toBe('done');
    expect(book.abandonQuest('gone_quest')).toEqual({ ok: true, message: 'Abandoned that quest.' });
    expect(book.state.quests!.active).not.toHaveProperty('gone_quest');
  });

  it('Q-14: delivery texts use the plural (ItemDef.plural for mass nouns)', () => {
    const r = withQuests(q({ id: 'gus_herbs', giver: 'gus', objectives: [{ kind: 'deliver', item: 'herb', count: 3 }, { kind: 'deliver', item: 'ore', count: 1 }] }));
    const { book } = bookOn(r);
    book.acceptQuest('gus_herbs');
    expect(texts(book, 'gus_herbs')).toEqual(['Bring 3 Meadow Herbs (0 in bag)', 'Bring 1 Iron Ore (0 in bag)']);
    expect(objectiveProgress(reg, emptyState(), bareCtx(), 'pell_net')[0].text).toBe('Bring 5 Lake Fish (0 in bag)');
    const state = emptyState();
    acceptQuest(r, state, bareCtx(), 'gus_herbs');
    const rich = bareCtx({ itemCount: () => 9, spendItems: () => false });
    expect(turnInQuest(r, state, rich, 'gus_herbs').message).toBe('You need 3 Meadow Herbs, 1 Iron Ore.');
  });

  it('QC-7: use / cast tags also match the authored skill a variant rolls up to', () => {
    const r = withQuests(
      q({ id: 'gus_basics', giver: 'gus', objectives: [{ kind: 'use', tag: 'basic', count: 2 }, { kind: 'cast', tag: 'basic', map: 'vale.hearthvale', count: 1 }] }),
    );
    const blazing = r.skill('slash@fire')!;
    expect(blazing.tags).not.toContain('basic');
    const { book } = bookOn(r);
    book.acceptQuest('gus_basics');
    book.notifyQuest({ type: 'use', skill: blazing });
    book.notifyQuest({ type: 'use', skill: r.skill('slash')! });
    book.notifyQuest({ type: 'cast', skill: blazing, map: 'vale.hearthvale' });
    expect(book.questStatus('gus_basics')).toBe('ready');
    // Unrelated skills still do not count.
    expect(objectiveProgress(r, book.state, bareCtx(), 'gus_basics').map((p) => p.have)).toEqual([2, 1]);
  });

  it('lessonState says whether a lesson is quest-only and which quest teaches it', () => {
    const { book } = newBook();
    expect(book.lessonState('hale_kick')).toMatchObject({ questOnly: true, quest: 'hale_kick_drill' });
    expect(book.lessonState('hale_free')).toMatchObject({ questOnly: false, quest: 'tamsin_free' });
    expect(book.lessonState('hale_secret')).toMatchObject({ questOnly: true });
    expect(book.lessonState('hale_secret')).not.toHaveProperty('quest');
  });
});
