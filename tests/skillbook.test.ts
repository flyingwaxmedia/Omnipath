import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import { classXpToNext } from '../src/core/classes';
import { MASTERY, monsterThreat, overmasteryCost, xpForHit, xpToNext } from '../src/core/mastery';
import { Registry } from '../src/core/registry';
import { BOOK_FLAGS } from '../src/core/save';
import {
  ESSENCE_DROP,
  SkillBook,
  bestiaryStars,
  type Inventory,
  type SkillBookEvents,
} from '../src/core/skillbook';
import { SPARK } from '../src/core/spark';
import { emptyState } from '../src/core/state';
import type {
  ClassDef,
  ElementDef,
  ElementId,
  EssenceDef,
  GameData,
  MonsterDef,
  PassiveDef,
  PassiveStat,
  SkillDef,
  SkillShape,
} from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const title = (id: string): string =>
  id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');

const PREFIX: Record<string, string> = {
  fire: 'Blazing',
  water: 'Tidal',
  wind: 'Gale',
  earth: 'Stone',
  holy: 'Radiant',
  ice: 'Frost',
};

const el = (id: ElementId, tier: 0 | 1 = 0): ElementDef => ({
  id,
  name: title(id),
  prefix: PREFIX[id],
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
const BUFF: SkillShape = { kind: 'buff', stat: 'def', amount: 5, duration: 5000 };

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

const ess = (e: Pick<EssenceDef, 'id' | 'category' | 'appliesTo' | 'mod'> & Partial<EssenceDef>): EssenceDef => ({
  name: title(e.id),
  icon: `i_${e.id}`,
  desc: e.id,
  affix: { text: title(e.id), pos: 'prefix' },
  powerMul: 0.9,
  spMul: 1.2,
  ...e,
});

const mon = (m: Pick<MonsterDef, 'id' | 'level'> & Partial<MonsterDef>): MonsterDef => ({
  name: title(m.id),
  hp: 50,
  atk: 5,
  def: 1,
  family: 'sprite',
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

const technique = (skill: string, marks?: number) => ({
  skill,
  weight: 1,
  cooldown: 3000,
  range: 200,
  ...(marks === undefined ? {} : { echo: { marks } }),
});

const treePassives: PassiveDef[] = [];

/** A class with a templated tree + imprint (its passives are collected into `treePassives`). */
function cls(c: Pick<ClassDef, 'id' | 'tier'> & Partial<ClassDef>, tag: string, stat: PassiveStat): ClassDef {
  const t = classTreeTemplate({ classId: c.id, className: title(c.id), tier: c.tier, tag, stat, icon: 'i' });
  treePassives.push(...t.passives, t.imprint);
  return {
    name: title(c.id),
    icon: 'i',
    desc: '',
    hint: `Riddle of ${c.id}.`,
    clauses: [],
    bonus: {},
    tree: t.nodes,
    imprint: t.imprint.id,
    ...c,
  };
}

const CLASSES: ClassDef[] = [
  cls(
    { id: 'blademaster', tier: 1, clauses: [{ tags: ['blade'], count: 2 }], bonus: { atk: 10, tagPower: { blade: 10 } } },
    'blade',
    'atk',
  ),
  cls({ id: 'pyroblade', tier: 1, clauses: [{ tags: ['blade', 'fire'], count: 2 }], bonus: { matk: 5 } }, 'fire', 'matk'),
  cls({ id: 'mimic', tier: 1, clauses: [{ tags: ['echo'], count: 2 }] }, 'echo', 'hp'),
  cls(
    {
      id: 'moonwarden',
      tier: 1,
      hidden: true,
      hint: 'Where moonlight pools, a warden waits.',
      clauses: [{ tags: ['holy'], count: 1 }],
      requires: [{ type: 'mapVisited', id: 'vale.moonlit_glade' }],
    },
    'holy',
    'sp',
  ),
  cls(
    {
      id: 'sword_saint',
      tier: 2,
      clauses: [{ tags: ['blade'], count: 2 }],
      parents: [{ id: 'blademaster', rank: 4 }],
      grants: ['saint_sig'],
    },
    'blade',
    'crit',
  ),
];

const pip = mon({ id: 'pip', level: 4, essence: 'split' });
const puddle = mon({ id: 'puddle', level: 3, element: 'water', essence: 'pierce', techniques: [technique('bubble_lance', 5)] });
const brinewisp = mon({
  id: 'brinewisp',
  level: 4,
  rank: 'elite',
  element: 'water',
  techniques: [technique('bubble_lance', 3), technique('mon_spit')],
});
const colossus = mon({ id: 'colossus', level: 9, rank: 'warden', element: 'earth', techniques: [technique('tremor', 1)] });
const moth = mon({ id: 'moth', level: 7, element: 'holy' });

const DATA: GameData = {
  dataVersion: 2,
  elements: [el('fire'), el('water'), el('wind'), el('earth'), el('holy'), el('ice', 1)],
  skills: [
    sk({ id: 'slash', tier: 0, tags: ['blade', 'basic', 'melee'], spCost: 0, cooldown: 0, maxRank: 4, shape: STRIKE }),
    sk({ id: 'whirlwind', tags: ['blade', 'spin', 'aoe'], power: 0.9, shape: SPIN }),
    sk({ id: 'sword_throw', tags: ['blade', 'projectile'], power: 1.2, shape: PROJECTILE }),
    sk({ id: 'heavy_cleave', tags: ['blade', 'heavy'], power: 1.6, shape: STRIKE }),
    sk({ id: 'blade_volley', tier: 2, tags: ['blade', 'projectile'], shape: { ...PROJECTILE, count: 3 } }),
    sk({ id: 'flame_spin', tier: 2, element: 'fire', tags: ['blade', 'spin', 'aoe'], shape: SPIN }),
    sk({ id: 'ember_edge', element: 'fire', shape: STRIKE }),
    sk({ id: 'tidal_cut', element: 'water', shape: STRIKE }),
    sk({ id: 'guard', weapons: undefined, tags: ['buff'], power: 0, maxRank: 3, shape: BUFF }),
    sk({ id: 'rising_kick', weapons: undefined, tags: ['melee'], shape: STRIKE }),
    sk({ id: 'bubble_lance', weapons: undefined, element: 'water', tags: ['echo', 'projectile'], shape: PROJECTILE }),
    sk({ id: 'tremor', tier: 2, weapons: undefined, element: 'earth', tags: ['echo', 'aoe'], shape: NOVA }),
    sk({ id: 'mon_spit', weapons: undefined, tags: ['monster'], shape: PROJECTILE }),
    sk({ id: 'saint_sig', tier: 2, shape: STRIKE }),
  ],
  morphs: [
    { from: 'slash', to: 'whirlwind', tier: 1, hint: 'A blade that never stops turning.', spark: { threat: 4, minParentRank: 2 } },
    { from: 'slash', to: 'sword_throw', tier: 1, spark: { threat: 6, minParentRank: 2 } },
    {
      from: 'slash',
      to: 'heavy_cleave',
      tier: 1,
      requires: [{ type: 'flag', id: 'ore_mined', min: 6, label: 'Mine 6 ore' }],
      hint: 'The strength of stone could lend weight to a swing.',
    },
    { from: 'sword_throw', to: 'blade_volley', tier: 2, requires: [{ type: 'skill', id: 'whirlwind', rank: 3 }] },
  ],
  recipes: [
    { a: 'el:fire', b: 'skill:whirlwind', result: 'skill:flame_spin', hint: 'A spinning blade could carry flame.' },
    { a: 'el:water', b: 'el:wind', result: 'el:ice', hint: 'Water and wind together grow cold.' },
    {
      a: 'el:fire',
      b: 'el:water',
      result: 'passive:res_fire_water',
      requires: [
        { type: 'tagCount', tags: ['fire'], count: 2 },
        { type: 'tagCount', tags: ['water'], count: 1 },
      ],
      hint: 'Steam remembers both fire and water.',
    },
  ],
  classes: CLASSES,
  essences: [
    ess({ id: 'split', category: 'multiply', appliesTo: ['projectile'], powerMul: 0.55, spMul: 1.3, mod: { count: 2, spread: 25 } }),
    ess({ id: 'pierce', category: 'propagate', appliesTo: ['projectile'], mod: { pierce: 2 } }),
    ess({ id: 'heavy', category: 'tempo', appliesTo: ['strike', 'spin', 'dash'], powerMul: 1.5, cdMul: 1.6, mod: { knockback: true }, tag: 'heavy' }),
  ],
  passives: [
    { id: 'tag_blade', name: 'Blade Affinity', icon: 'p', desc: '', source: 'tag', tag: 'blade', maxRank: 5, effect: { kind: 'power', tag: 'blade', pct: 3 } },
    { id: 'res_fire_water', name: 'Steam Resonance', icon: 'p', desc: '', source: 'resonance', maxRank: 1, effect: { kind: 'power', pct: 5 } },
    { id: 'sure_footing', name: 'Sure Footing', icon: 'p', desc: '', source: 'trainer', maxRank: 3, effect: { kind: 'stat', stat: 'speed', pct: 3 } },
    { id: 'still_mind', name: 'Still Mind', icon: 'p', desc: '', source: 'trainer', maxRank: 3, effect: { kind: 'masteryXp', pct: 10 } },
    ...treePassives,
  ],
  trainers: [
    {
      id: 'hale',
      npc: 'hale',
      title: 'Drill Yard',
      lessons: [
        { id: 'hale_kick', name: 'Rising Kick', blurb: '', grants: { skill: 'rising_kick' }, requires: [], cost: { coins: 20 } },
        {
          id: 'hale_footing',
          name: 'Sure Footing',
          blurb: '',
          grants: { passive: 'sure_footing' },
          requires: [{ type: 'lesson', id: 'hale_kick' }],
          cost: { coins: 10, items: { herb: 2 } },
          repeatable: true,
        },
        { id: 'hale_split', name: 'Split Essence', blurb: '', grants: { essence: 'split', count: 2 }, requires: [], cost: { coins: 5 }, repeatable: true },
        { id: 'hale_focus', name: 'Still Mind', blurb: '', grants: { passive: 'still_mind' }, requires: [] },
      ],
    },
  ],
  monsters: [pip, puddle, brinewisp, colossus, moth],
  items: [{ id: 'herb', name: 'Herb', icon: 'h', kind: 'material', desc: '' }],
};

const reg = new Registry(DATA);

// ------------------------------------------------------------------ helpers

/** Grants exactly the XP that takes a skill from its current progress to `rank`. */
function trainTo(b: SkillBook, id: string, rank: number): void {
  const s = b.reg.skill(id)!;
  const p = b.progress(id)!;
  let need = -p.xp;
  for (let r = p.rank; r < rank; r++) need += xpToNext(r, s.tier);
  if (need > 0) b.addMastery(id, need + 1e-9);
  expect(b.rank(id)).toBe(rank);
}

/** Collects every payload of one event type. */
function listen<K extends keyof SkillBookEvents>(b: SkillBook, type: K): SkillBookEvents[K][] {
  const out: SkillBookEvents[K][] = [];
  b.events.on(type, (e) => out.push(e));
  return out;
}

/** A simple bag the lesson tests can inspect. */
function bag(coins: number, items: Record<string, number> = {}) {
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

let book: SkillBook;

beforeEach(() => {
  MASTERY.rate = 1;
  book = new SkillBook(reg);
});

afterEach(() => {
  MASTERY.rate = 1;
});

// ------------------------------------------------------------------ tests

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('learning and queries', () => {
  it('learns skills, elements, flags, essences and passives with events', () => {
    const learned = listen(book, 'learned');
    const essences = listen(book, 'essence');
    book.now = () => 1234;
    expect(book.learn('slash', 'start')).toBe(true);
    expect(book.learn('slash', 'again')).toBe(false);
    expect(book.progress('slash')).toEqual({
      id: 'slash',
      rank: 1,
      xp: 0,
      charges: 0,
      uses: 0,
      source: 'start',
      learnedAt: 1234,
      overBars: 0,
      study: {},
    });
    expect(learned.map((e) => [e.skill.id, e.source])).toEqual([['slash', 'start']]);
    expect(() => book.learn('nope', 'x')).toThrow();
    expect(book.has('constructor')).toBe(false);

    expect(book.learnElement('fire', 'forge')).toBe(true);
    expect(book.learnElement('fire', 'forge')).toBe(false);
    expect(book.knownElements().map((e) => e.id)).toEqual(['fire']);

    expect(book.incFlag('ore_mined', 4)).toBe(4);
    expect(book.incFlag('ore_mined')).toBe(5);
    expect(book.flag('toString')).toBe(0);

    expect(book.addEssence('split', 2, 'chest')).toBe(2);
    expect(book.addEssence('split', 0)).toBe(2);
    expect(essences).toHaveLength(1);
    expect(essences[0]).toMatchObject({ added: 2, total: 2, source: 'chest' });
    expect(essences[0].essence.id).toBe('split');

    expect(book.learnPassive('sure_footing', 'test')).toBe(true);
    expect(book.state.passives).toEqual({ sure_footing: 1 });
    expect(book.learnPassive('tag_blade', 'test')).toBe(false);
    expect(book.learnPassive('res_fire_water', 'test')).toBe(true);
    expect(book.learnPassive('res_fire_water', 'test')).toBe(false);
  });

  it('reports bars, maxed state and essence slots', () => {
    book.learn('slash', 'start');
    book.learn('guard', 'start');
    expect(book.barSize('slash')).toBe(xpToNext(1, 0));
    expect(book.essenceSlots('slash')).toBe(1);
    expect(book.essenceSlots('guard')).toBe(0);
    expect(book.essenceSlots('whirlwind')).toBe(0);
    trainTo(book, 'slash', 4);
    expect(book.isMaxed('slash')).toBe(true);
    expect(book.barSize('slash')).toBe(overmasteryCost(4, 0));
  });
});

describe('mastery v2', () => {
  it('ranks up, masters with a charge and sets mastered_any', () => {
    book.learn('slash', 'start');
    const ranks = listen(book, 'rankUp');
    const mastered = listen(book, 'mastered');
    const charges = listen(book, 'charge');
    trainTo(book, 'slash', 4);
    expect(ranks.map((e) => e.rank)).toEqual([2, 3, 4]);
    expect(mastered).toHaveLength(1);
    expect(charges.map((e) => e.charges)).toEqual([1]);
    expect(book.progress('slash')!.charges).toBe(1);
    expect(book.flag(BOOK_FLAGS.masteredAny)).toBe(1);
  });

  it('fills overmastery bars: overBars, charges, the 2nd essence slot, then holds full', () => {
    book.learn('whirlwind', 'start');
    trainTo(book, 'whirlwind', 5);
    const cost = overmasteryCost(5, 1);
    const charges = listen(book, 'charge');
    book.addMastery('whirlwind', cost);
    expect(book.progress('whirlwind')).toMatchObject({ overBars: 1, charges: 2 });
    // Charges cap after the 2nd bar, but the 3rd bar still completes because it opens the 2nd slot.
    book.addMastery('whirlwind', cost * 10);
    expect(book.progress('whirlwind')).toMatchObject({ overBars: 3, charges: MASTERY.maxCharges });
    expect(book.progress('whirlwind')!.xp).toBeCloseTo(cost, 6);
    expect(book.essenceSlots('whirlwind')).toBe(2);
    expect(charges.map((e) => e.charges)).toEqual([2, 3]);
  });

  it('grants threat-weighted use XP once per engaged cast', () => {
    book.learn('slash', 'start');
    // slash: tier 0, rank 1 → skill level 0.5; pip threat 4 → delta 3 → ×1.3.
    expect(book.recordUse('slash', monsterThreat(pip))).toBeCloseTo(1.3, 10);
    expect(book.recordUse('slash', -10)).toBe(0);
    expect(book.progress('slash')!.uses).toBe(2);
    expect(book.recordUse('nope', 4)).toBe(0);
  });

  it('grants buff use XP only to buffs, and applies MASTERY.rate', () => {
    book.learn('slash', 'start');
    book.learn('guard', 'start');
    expect(book.recordBuffUse('slash', 4)).toBe(0);
    expect(book.recordBuffUse('guard', 4)).toBe(1);
    MASTERY.rate = 2;
    expect(book.recordBuffUse('guard', 4)).toBe(2);
    expect(book.progress('guard')!.uses).toBe(2);
  });

  it('caps hit XP per cast and per instance, never kill XP, and tracks study kills', () => {
    book.learn('slash', 'start');
    book.recordUse('slash', 4);
    const hit = (o: Partial<{ killed: boolean; hitIndex: number; instanceHits: number }>) =>
      book.recordHit('slash', { monster: pip, killed: false, hitIndex: 0, instanceHits: 0, ...o });
    expect(hit({})).toBeCloseTo(1 * 1.3 * 1.5, 10);
    expect(hit({ hitIndex: MASTERY.maxHitsPerUse })).toBe(0);
    expect(hit({ instanceHits: MASTERY.instanceHitCap })).toBe(0);
    expect(hit({ killed: true, hitIndex: 9 })).toBeCloseTo(3 * 1.3 * 1.5, 10);
    expect(book.progress('slash')!.study).toEqual({ pip: 1 });
    for (let i = 1; i < MASTERY.studyKills; i++) hit({ killed: true });
    expect(book.progress('slash')!.study.pip).toBe(MASTERY.studyKills);
    const skill = reg.skill('slash')!;
    const expected = xpForHit({ skill, rank: book.rank('slash'), monster: pip, killed: true, studyKills: MASTERY.studyKills });
    expect(hit({ killed: true })).toBeCloseTo(expected, 10);
  });

  it('multiplies hit XP by passive masteryXp', () => {
    book.learn('sword_throw', 'start');
    book.learnPassive('still_mind', 'test');
    const skill = reg.skill('sword_throw')!;
    const expected = xpForHit({ skill, rank: 1, monster: pip, killed: false, studyKills: 0, masteryPct: 10 });
    expect(book.recordHit('sword_throw', { monster: pip, killed: false, hitIndex: 0, instanceHits: 0 })).toBeCloseTo(expected, 10);
    expect(expected).toBeCloseTo(xpForHit({ skill, rank: 1, monster: pip, killed: false, studyKills: 0 }) * 1.1, 10);
  });
});

describe('morphing', () => {
  it('masters a skill and morphs it, hiding world-locked branches until found', () => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 4);
    const opts = book.morphOptions('slash');
    expect(opts.map((o) => o.morph.to)).toEqual(['whirlwind', 'sword_throw', 'heavy_cleave']);
    expect(opts[0]).toMatchObject({
      tier: 1,
      available: true,
      owned: false,
      chargeReady: true,
      requirements: [],
      spark: { threat: 4, minParentRank: 2 },
      hint: 'A blade that never stops turning.',
    });
    expect(opts[0].skill?.id).toBe('whirlwind');
    expect(opts[2]).toMatchObject({ skill: null, available: false, requirements: [{ text: 'Mine 6 ore', ok: false }] });
    expect(opts[2].spark).toBeUndefined();
    expect(book.canMorph('slash')).toBe(true);

    expect(book.morph('slash', 'heavy_cleave')).toEqual({ ok: false, message: opts[2].hint });
    const morphed = listen(book, 'morphed');
    const learned = listen(book, 'learned');
    const res = book.morph('slash', 'whirlwind');
    expect(res.ok).toBe(true);
    expect(book.progress('slash')!.charges).toBe(0);
    expect(book.progress('whirlwind')!.source).toBe('morph:slash');
    expect(morphed.map((e) => [e.from.id, e.to.id])).toEqual([['slash', 'whirlwind']]);
    expect(learned[0].source).toBe('morph:slash');
    expect(book.morph('slash', 'whirlwind')).toMatchObject({ ok: false });
    expect(book.morph('slash', 'sword_throw')).toMatchObject({ ok: false, message: expect.stringMatching(/no morph charges/) });
    expect(book.canMorph('slash')).toBe(false);

    book.incFlag('ore_mined', 6);
    const cleave = book.morphOptions('slash')[2];
    expect(cleave.skill?.name).toBe('Heavy Cleave');
    expect(cleave).toMatchObject({ available: true, chargeReady: false, requirements: [{ text: 'Mine 6 ore', ok: true }] });
  });

  it('shows unmet skill requirements without hiding the result', () => {
    const volley = book.morphOptions('sword_throw')[0];
    expect(volley).toMatchObject({ tier: 2, available: false, chargeReady: false });
    expect(volley.skill?.id).toBe('blade_volley');
    expect(volley.requirements).toEqual([{ text: 'Whirlwind rank 3', ok: false }]);
  });
});

describe('sparks', () => {
  it('learns a morph charge-free mid-combat, then respects the cooldown', () => {
    book.learn('slash', 'start');
    expect(book.sparkWindow('slash', pip)).toBe('none'); // rank 1 < minParentRank 2
    trainTo(book, 'slash', 2);
    expect(book.sparkWindow('slash', pip)).toBe('peak');
    const sparks = listen(book, 'spark');
    let at = -1;
    let got: SkillDef | null = null;
    for (let t = 0; t < 5000 && !got; t++) {
      got = book.trySpark('slash', pip, t);
      at = t;
    }
    expect(got).not.toBeNull();
    const id = got!.id;
    expect(['whirlwind', 'sword_throw']).toContain(id);
    expect(book.progress(id)!.source).toBe('spark:slash');
    expect(book.progress('slash')!.charges).toBe(0);
    expect(sparks).toHaveLength(1);
    expect(sparks[0].from.id).toBe('slash');
    expect(sparks[0].to.id).toBe(id);
    expect(sparks[0].monster).toBe(pip);
    expect(book.state.spark.lastAt).toBe(at);
    expect(book.state.spark.pity[`slash>${id}`]).toBe(0);

    const counter = book.state.spark.counter;
    expect(book.trySpark('slash', pip, at + 1)).toBeNull();
    expect(book.state.spark.counter).toBe(counter);
    book.now = () => at + 1;
    expect(book.sparkWindow('slash', pip)).toBe('none');
    book.now = () => at + SPARK.cooldownMs;
    expect(book.sparkWindow('slash', pip)).not.toBe('none');
  });

  it('is deterministic for a seed', () => {
    const run = (seed: number) => {
      const b = new SkillBook(reg, emptyState(seed));
      b.learn('slash', 'start');
      trainTo(b, 'slash', 2);
      for (let t = 0; t < 5000; t++) {
        const s = b.trySpark('slash', pip, t);
        if (s) return [s.id, t];
      }
      return null;
    };
    expect(run(42)).toEqual(run(42));
  });
});

describe('echoes', () => {
  it('blocks without an anchor (keeping marks) and learns once one is owned', () => {
    const witnessed = listen(book, 'witness');
    const echoes = listen(book, 'echo');
    const hints = listen(book, 'hint');
    expect(book.witness('bubble_lance')).toEqual({ status: 'progress', marks: 1, need: 3, anchorShape: 'projectile' });
    expect(book.witness('bubble_lance')).toMatchObject({ status: 'progress', marks: 2 });
    expect(book.witness('bubble_lance')).toEqual({ status: 'blocked', marks: 3, need: 3, anchorShape: 'projectile' });
    expect(book.has('bubble_lance')).toBe(false);
    expect(book.state.witness.bubble_lance).toBe(3);

    book.learn('sword_throw', 'start');
    trainTo(book, 'sword_throw', 3);
    expect(book.witness('bubble_lance')).toEqual({ status: 'learned', marks: 4, need: 3, anchorShape: 'projectile' });
    // The first monster teaching it is credited.
    expect(book.progress('bubble_lance')!.source).toBe('echo:puddle');
    expect(echoes).toHaveLength(1);
    expect(echoes[0]).toMatchObject({ anchor: 'sword_throw' });
    expect(echoes[0].monster.id).toBe('puddle');
    expect(witnessed.map((w) => w.status)).toEqual(['progress', 'progress', 'blocked', 'learned']);
    expect(witnessed[3].skill.id).toBe('bubble_lance');
    // The echo whispers the class it feeds.
    expect(book.state.whispered).toEqual(['mimic']);
    expect(hints).toEqual([{ text: 'Riddle of mimic.', source: 'echo', classId: 'mimic' }]);

    expect(book.witness('bubble_lance')).toEqual({ status: 'learned', marks: 4, need: 3, anchorShape: 'projectile' });
    expect(witnessed).toHaveLength(4);
  });

  it('uses each echo’s own need and anchor shape, and rejects non-echoes', () => {
    expect(book.witness('tremor')).toEqual({ status: 'blocked', marks: 1, need: 1, anchorShape: 'nova' });
    expect(() => book.witness('sword_throw')).toThrow();
    expect(() => book.witness('mon_spit')).toThrow();
  });
});

describe('bestiary', () => {
  it('counts kills and stars per species', () => {
    const events = listen(book, 'bestiary');
    expect(book.recordKill(moth)).toMatchObject({ stars: 1, starUp: true });
    expect(book.recordKill(moth)).toMatchObject({ stars: 1, starUp: false });
    expect(book.state.bestiary).toEqual({ moth: 2 });
    expect(events.map((e) => [e.kills, e.stars, e.starUp])).toEqual([
      [1, 1, true],
      [2, 1, false],
    ]);
    expect([0, 1, 24, 25, 99, 100].map(bestiaryStars)).toEqual([0, 1, 1, 2, 2, 3]);
  });

  it('drops essences deterministically at about 3%', () => {
    const drops = (seed: number, kills: number): (string | undefined)[] => {
      const b = new SkillBook(reg, emptyState(seed));
      return Array.from({ length: kills }, () => b.recordKill(pip).essence);
    };
    expect(drops(7, 300)).toEqual(drops(7, 300));
    const b = new SkillBook(reg, emptyState(11));
    let dropped = 0;
    for (let i = 0; i < 4000; i++) if (b.recordKill(pip).essence) dropped++;
    expect(dropped / 4000).toBeGreaterThan(0.02);
    expect(dropped / 4000).toBeLessThan(0.045);
    expect(b.state.essences.split).toBe(dropped);
    expect(b.flag(`${BOOK_FLAGS.essenceDropPrefix}pip`)).toBe(dropped);
  });

  it('guarantees the species essence on the 25th kill if none dropped yet', () => {
    let checked = 0;
    for (let seed = 1; seed <= 60; seed++) {
      const b = new SkillBook(reg, emptyState(seed));
      const early = Array.from({ length: ESSENCE_DROP.guaranteedAt - 1 }, () => b.recordKill(pip).essence);
      if (early.some((e) => e !== undefined)) continue;
      expect(b.recordKill(pip)).toEqual({ stars: 2, starUp: true, essence: 'split' });
      expect(b.state.essences.split).toBe(1);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('feeds bestiary bonuses into totals and whispers at star 2', () => {
    const hints = listen(book, 'hint');
    for (let i = 0; i < 24; i++) book.recordKill(moth);
    expect(book.totals().vsFamily.sprite).toBeUndefined();
    book.recordKill(moth);
    expect(book.totals().vsFamily.sprite).toBe(1);
    expect(book.state.whispered).toEqual(['moonwarden']);
    expect(hints).toEqual([{ text: 'Where moonlight pools, a warden waits.', source: 'bestiary', classId: 'moonwarden' }]);
    expect(book.classProgress(reg.classDef('moonwarden')!).codex).toBe('whispered');
    for (let i = 25; i < 100; i++) book.recordKill(moth);
    expect(book.activeBonus().hp).toBe(1);
  });
});

describe('fusion', () => {
  beforeEach(() => {
    for (const id of ['sword_throw', 'whirlwind']) {
      book.learn(id, 'start');
      trainTo(book, id, 5);
    }
    for (const e of ['fire', 'water', 'wind', 'earth', 'holy'] as const) book.learnElement(e, 'test');
  });

  it('applies an essence and consumes it on success only', () => {
    const fused = listen(book, 'fused');
    expect(book.fuse('skill:sword_throw', 'mod:split')).toMatchObject({ ok: false, reason: 'missing' });
    expect(book.rememberedPair('skill:sword_throw', 'mod:split')).toBe('unknown');

    book.addEssence('split', 1);
    const res = book.fuse('mod:split', 'skill:sword_throw');
    expect(res).toEqual({
      ok: true,
      result: 'skill:sword_throw~split',
      name: 'Split Sword Throw',
      isNew: true,
      kind: 'essence',
      message: 'Discovered Split Sword Throw!',
      consumed: 'split',
    });
    expect(book.state.essences).toEqual({});
    expect(book.progress('sword_throw~split')!.source).toBe('fusion:mod:split+skill:sword_throw');
    expect(fused).toEqual([
      { a: 'mod:split', b: 'skill:sword_throw', result: 'skill:sword_throw~split', kind: 'essence', isNew: true, consumed: 'split' },
    ]);
    expect(book.rememberedPair('skill:sword_throw', 'mod:split')).toBe('discovered');

    // Re-creating a known variant consumes nothing.
    book.addEssence('split', 1);
    const again = book.fuse('skill:sword_throw', 'mod:split');
    expect(again).toMatchObject({ ok: true, isNew: false });
    expect(again.consumed).toBeUndefined();
    expect(book.state.essences).toEqual({ split: 1 });
  });

  it('needs a 2nd essence slot (3 overmastery bars) for a second essence', () => {
    book.learn('sword_throw~split', 'test');
    trainTo(book, 'sword_throw~split', 5);
    book.addEssence('pierce', 1);
    expect(book.fuse('skill:sword_throw~split', 'mod:pierce')).toMatchObject({ ok: false, reason: 'slot' });
    expect(book.state.essences.pierce).toBe(1);
    expect(book.rememberedPair('mod:pierce', 'skill:sword_throw~split')).toBe('nothing');

    book.addMastery('sword_throw~split', 3 * overmasteryCost(5, 2));
    expect(book.essenceSlots('sword_throw~split')).toBe(2);
    expect(book.fuse('skill:sword_throw~split', 'mod:pierce')).toMatchObject({
      ok: true,
      result: 'skill:sword_throw~pierce~split',
      consumed: 'pierce',
    });
    expect(book.fuse('skill:sword_throw~pierce~split', 'el:fire')).toMatchObject({ ok: false, reason: 'rank' });
  });

  it('swaps the element of a variant, keeping its essences and consuming nothing', () => {
    book.addEssence('split', 2);
    book.learn('sword_throw@fire~split', 'test');
    trainTo(book, 'sword_throw@fire~split', 5);
    const res = book.fuse('skill:sword_throw@fire~split', 'el:water');
    expect(res).toMatchObject({ ok: true, result: 'skill:sword_throw@water~split', kind: 'element', isNew: true });
    expect(res.consumed).toBeUndefined();
    expect(book.state.essences).toEqual({ split: 2 });
    expect(book.reg.skill('sword_throw@water~split')!.essences).toEqual(['split']);
  });

  it('refuses elements on bound skills', () => {
    book.learn('flame_spin', 'test');
    trainTo(book, 'flame_spin', 5);
    expect(book.fuse('skill:flame_spin', 'el:water')).toMatchObject({ ok: false, reason: 'bound' });
  });

  it('shape-merges two authored skills', () => {
    const res = book.fuse('skill:whirlwind', 'skill:sword_throw');
    expect(res).toMatchObject({ ok: true, result: 'skill:fuse:sword_throw|whirlwind', kind: 'merge', isNew: true });
    expect(res.name).toBe('Sword Throw Cyclone');
    expect(book.has('fuse:sword_throw|whirlwind')).toBe(true);
  });

  it('follows authored recipes, including fused elements', () => {
    expect(book.fuse('el:fire', 'skill:whirlwind')).toMatchObject({ ok: true, result: 'skill:flame_spin', kind: 'authored', isNew: true });
    expect(book.fuse('skill:whirlwind', 'el:fire')).toMatchObject({ ok: true, isNew: false });
    expect(book.fuse('el:wind', 'el:water')).toMatchObject({ ok: true, result: 'el:ice', kind: 'authored' });
    expect(book.hasElement('ice')).toBe(true);
    expect(book.state.discoveries).toEqual(['el:fire+skill:whirlwind', 'el:water+el:wind']);
  });

  it('turns a resonance recipe into a learned passive once its tag counts are met', () => {
    expect(book.fuse('el:fire', 'el:water')).toMatchObject({ ok: false, reason: 'requirement' });
    for (const id of ['ember_edge', 'flame_spin', 'tidal_cut']) book.learn(id, 'test');
    const passives = listen(book, 'passive');
    expect(book.fuse('el:water', 'el:fire')).toMatchObject({ ok: true, result: 'passive:res_fire_water', kind: 'authored', isNew: true });
    expect(passives).toHaveLength(1);
    expect(passives[0]).toMatchObject({ rank: 1, source: 'fusion:el:fire+el:water' });
    expect(book.passives().find((p) => p.def.id === 'res_fire_water')).toMatchObject({ rank: 1, strength: 1, source: 'learned' });
    expect(book.totals().power.all).toBe(5);
    expect(book.fuse('el:fire', 'el:water')).toMatchObject({ ok: true, isNew: false });
  });

  it('whispers an unseen recipe hint on a failed fusion, once', () => {
    const hints = listen(book, 'hint');
    const res = book.fuse('el:earth', 'el:wind');
    expect(res).toMatchObject({ ok: false, reason: 'nothing', hint: 'Water and wind together grow cold.' });
    expect(hints).toEqual([{ text: 'Water and wind together grow cold.', source: 'fusion' }]);
    expect(book.state.hints).toEqual(['Water and wind together grow cold.']);
    expect(book.rememberedPair('el:wind', 'el:earth')).toBe('nothing');
    expect(book.fuse('el:earth', 'el:wind').hint).toBe('Water and wind together grow cold.');
    expect(hints).toHaveLength(1);
  });

  it('whispers a related class riddle when no recipe hint is left', () => {
    const hints = listen(book, 'hint');
    const res = book.fuse('el:holy', 'el:earth');
    expect(res).toMatchObject({ ok: false, reason: 'nothing', hint: 'Where moonlight pools, a warden waits.' });
    expect(hints).toEqual([{ text: 'Where moonlight pools, a warden waits.', source: 'fusion', classId: 'moonwarden' }]);
    expect(book.state.whispered).toEqual(['moonwarden']);
  });

  it('lists ingredients by tab with readiness', () => {
    book.learn('slash', 'start');
    book.addEssence('pierce', 2);
    const list = book.ingredients();
    expect(list.elements.map((e) => e.ref)).toEqual(['el:fire', 'el:water', 'el:wind', 'el:earth', 'el:holy']);
    expect(list.elements.every((e) => e.ready)).toBe(true);
    expect(list.skills.map((s) => [s.ref, s.ready])).toEqual([
      ['skill:sword_throw', true],
      ['skill:whirlwind', true],
      ['skill:slash', false],
    ]);
    expect(list.skills[2].message).toBe('Slash must reach rank 4 to be fused.');
    expect(list.essences).toEqual([{ ref: 'mod:pierce', name: 'Pierce', icon: 'i_pierce', ready: true, count: 2 }]);
  });
});

describe('passives', () => {
  it('unlocks a tag passive when the tag total reaches 15 and announces it once', () => {
    const passives = listen(book, 'passive');
    for (const id of ['slash', 'whirlwind', 'sword_throw', 'heavy_cleave']) book.learn(id, 'start');
    expect(book.tagPowerFor(reg.skill('slash')!)).toBe(10); // worn Blademaster's blade tagPower
    trainTo(book, 'slash', 4); // total 7
    trainTo(book, 'whirlwind', 5); // 11
    expect(passives).toEqual([]);
    trainTo(book, 'sword_throw', 5); // 15
    expect(passives).toHaveLength(1);
    expect(passives[0]).toMatchObject({ rank: 1, source: 'tag' });
    expect(passives[0].def.id).toBe('tag_blade');
    expect(book.passives().filter((p) => p.source === 'tag').map((p) => [p.def.id, p.rank])).toEqual([['tag_blade', 1]]);
    expect(book.tagPowerFor(reg.skill('slash')!)).toBe(13);
    trainTo(book, 'heavy_cleave', 5); // 19: still rank 1
    book.learn('sword_throw~split', 'test'); // a variant counts toward its base, not on top
    expect(passives).toHaveLength(1);
  });

  it('caches totals until something changes', () => {
    const before = book.totals();
    expect(book.totals()).toBe(before);
    book.learnPassive('sure_footing', 'test');
    const after = book.totals();
    expect(after).not.toBe(before);
    expect(after.stat.speed).toBe(3);
    expect(book.activeBonus()).toEqual({ speed: 3 });
  });
});

describe('classes', () => {
  it('feeds Class Rank XP: worn 50%, other matching classes 15%', () => {
    book.learn('slash', 'start');
    book.learn('ember_edge', 'test'); // 2 blade → Blademaster (worn)
    book.learn('flame_spin', 'test'); // 2 blade+fire → Pyroblade
    expect(book.state.worn).toBe('blademaster');
    expect(Object.keys(book.state.classes)).toEqual(['blademaster', 'pyroblade']);
    const ranks = listen(book, 'classRank');
    book.addMastery('ember_edge', 10);
    expect(book.state.classes.blademaster.xp).toBeCloseTo(5, 10);
    expect(book.state.classes.pyroblade.xp).toBeCloseTo(1.5, 10);
    book.addMastery('slash', 10); // no fire: Pyroblade gains nothing
    expect(book.state.classes.blademaster.xp).toBeCloseTo(10, 10);
    expect(book.state.classes.pyroblade.xp).toBeCloseTo(1.5, 10);
    book.addMastery('ember_edge', 110);
    expect(ranks.map((r) => [r.cls.id, r.rank])).toEqual([['blademaster', 2]]);
    expect(book.state.classes.blademaster).toMatchObject({ rank: 2 });
    expect(book.state.classes.blademaster.xp).toBeCloseTo(65 - classXpToNext(1, 1), 10);
  });

  it('discovers Tier I permissively, auto-wears it, and hardens Tier II (rank 5, parents CR)', () => {
    const discovered = listen(book, 'classDiscovered');
    book.learn('sword_throw', 'start');
    book.learn('sword_throw~split', 'test'); // a variant counts for Tier I
    expect(discovered.map((d) => [d.cls.id, d.worn])).toEqual([['blademaster', true]]);
    expect(book.state.worn).toBe('blademaster');
    expect(book.flag(BOOK_FLAGS.classWorn)).toBe(1);

    trainTo(book, 'sword_throw', 5);
    trainTo(book, 'sword_throw~split', 5);
    const saint = reg.classDef('sword_saint')!;
    expect(book.state.classes.blademaster.rank).toBe(3);
    // Hardened: the variant counts as its base, so only one distinct authored blade skill.
    expect(book.classProgress(saint)).toMatchObject({
      discovered: false,
      clauses: [{ have: 1 }],
      parents: [{ id: 'blademaster', need: 4, have: 3 }],
    });

    book.learn('whirlwind', 'start');
    trainTo(book, 'whirlwind', 4);
    expect(book.classProgress(saint).clauses[0].have).toBe(1); // rank 4 does not count
    trainTo(book, 'whirlwind', 5);
    expect(book.classProgress(saint).clauses[0].have).toBe(2);
    expect(book.state.classes.blademaster.rank).toBe(3); // parents gate it
    expect(book.state.classes.sword_saint).toBeUndefined();

    book.addMastery('whirlwind', 50); // overmastery XP still feeds Class Rank
    expect(book.state.classes.blademaster.rank).toBe(4);
    expect(book.state.classes.sword_saint).toEqual({ rank: 1, xp: 0, spent: {} });
    expect(discovered.map((d) => [d.cls.id, d.worn])).toEqual([
      ['blademaster', true],
      ['sword_saint', false],
    ]);
    expect(book.progress('saint_sig')!.source).toBe('class:sword_saint');
    expect(book.state.worn).toBe('blademaster');

    // Imprints: a Tier II discovery opens 2 slots; the worn class and locked imprints are refused.
    expect(book.imprintSlots()).toBe(2);
    expect(book.setImprints(['blademaster'])).toMatchObject({ ok: false });
    expect(book.wear('sword_saint')).toEqual({ ok: true, message: 'You now wear Sword Saint.' });
    expect(book.setImprints(['blademaster'])).toEqual({ ok: false, message: "Blademaster's imprint unlocks at CR 5." });
    book.addMastery('whirlwind', 720); // Blademaster now bleeds 15%
    expect(book.state.classes.blademaster.rank).toBe(5);
    expect(book.setImprints(['blademaster', 'blademaster'])).toMatchObject({ ok: false });
    expect(book.setImprints(['blademaster', 'pyroblade'])).toMatchObject({ ok: false });
    expect(book.setImprints(['blademaster', 'sword_saint', 'mimic'])).toMatchObject({ ok: false });
    expect(book.setImprints(['blademaster'])).toEqual({ ok: true, message: 'Imprints set.' });
    expect(book.passives().find((p) => p.source === 'imprint')).toMatchObject({ rank: 1, strength: 1 });
    expect(book.tagPowerFor(reg.skill('whirlwind')!)).toBe(5); // imprint +5% blade; Saint has no tagPower
    expect(book.wear('blademaster').ok).toBe(true);
    expect(book.state.imprints).toEqual([]);
  });

  it('buys and refunds tree nodes, folding stat nodes into activeBonus', () => {
    book.learn('slash', 'start');
    book.learn('whirlwind', 'start');
    expect(book.activeBonus()).toEqual({ atk: 10 });
    expect(book.buyNode('blademaster', 'n4')).toMatchObject({ ok: false });
    expect(book.buyNode('pyroblade', 'n1')).toEqual({ ok: false, message: 'You have not discovered that class.' });
    expect(book.buyNode('blademaster', 'n1')).toEqual({ ok: true, message: 'Blade Focus rank 1.' });
    expect(book.tagPowerFor(reg.skill('slash')!)).toBe(13);
    expect(book.buyNode('blademaster', 'n2')).toEqual({ ok: false, message: 'Needs 1 point (0 available).' });
    expect(book.respec('blademaster').ok).toBe(true);
    expect(book.tagPowerFor(reg.skill('slash')!)).toBe(10);
    expect(book.buyNode('blademaster', 'n2').ok).toBe(true);
    book.addMastery('whirlwind', 120); // 60 class XP → CR 2
    expect(book.state.classes.blademaster.rank).toBe(2);
    expect(book.buyNode('blademaster', 'n4').ok).toBe(true);
    expect(book.activeBonus()).toEqual({ atk: 13 });
    expect(book.wear('pyroblade')).toMatchObject({ ok: false });
    expect(book.wear('blademaster')).toMatchObject({ ok: true });
  });
});

describe('trainer lessons', () => {
  it('checks requirements, spends the inventory and applies each grant', () => {
    const lessons = listen(book, 'lesson');
    expect(book.takeLesson('hale_kick')).toEqual({ ok: false, message: 'You cannot afford Rising Kick.' });
    expect(book.takeLesson('hale_focus')).toEqual({ ok: true, message: 'Learned Still Mind.' }); // free
    expect(book.takeLesson('hale_focus')).toMatchObject({ ok: false });
    expect(book.takeLesson('nope')).toMatchObject({ ok: false });

    const { held, inventory } = bag(100, { herb: 3 });
    book.inv = inventory;
    expect(book.takeLesson('hale_footing')).toEqual({ ok: false, message: 'Not yet: Lesson: Rising Kick.' });
    expect(book.takeLesson('hale_kick').ok).toBe(true);
    expect(held.coins).toBe(80);
    expect(book.progress('rising_kick')!.source).toBe('lesson:hale_kick');
    expect(book.takeLesson('hale_kick')).toEqual({ ok: false, message: 'You have already learned Rising Kick.' });

    expect(book.takeLesson('hale_footing').ok).toBe(true);
    expect(held).toEqual({ coins: 70, items: { herb: 1 } });
    expect(book.state.passives.sure_footing).toBe(1);
    expect(book.lessonState('hale_footing')).toMatchObject({ owned: false, available: true, affordable: false });
    expect(book.takeLesson('hale_footing')).toMatchObject({ ok: false });
    held.items.herb = 10;
    expect(book.takeLesson('hale_footing').ok).toBe(true);
    expect(book.takeLesson('hale_footing').ok).toBe(true);
    expect(book.state.passives.sure_footing).toBe(3);
    expect(book.takeLesson('hale_footing')).toMatchObject({ ok: false }); // passive at max rank
    expect(book.activeBonus().speed).toBe(9);

    const essences = listen(book, 'essence');
    expect(book.takeLesson('hale_split').ok).toBe(true);
    expect(book.takeLesson('hale_split').ok).toBe(true);
    expect(book.state.essences.split).toBe(4);
    expect(essences.map((e) => e.source)).toEqual(['lesson:hale_split', 'lesson:hale_split']);
    expect(book.state.lessons).toEqual(['hale_focus', 'hale_kick', 'hale_footing', 'hale_split']);
    expect(lessons.map((l) => [l.lesson.id, l.trainer.id])).toEqual([
      ['hale_focus', 'hale'],
      ['hale_kick', 'hale'],
      ['hale_footing', 'hale'],
      ['hale_footing', 'hale'],
      ['hale_footing', 'hale'],
      ['hale_split', 'hale'],
      ['hale_split', 'hale'],
    ]);
  });
});

describe('journal and persistence', () => {
  it('summarizes discoveries', () => {
    book.learn('slash', 'start');
    book.learn('sword_throw~split', 'test');
    book.learnElement('fire', 'forge');
    book.addEssence('split', 2);
    book.recordKill(moth);
    expect(book.stats()).toEqual({
      skillsKnown: 2,
      authoredKnown: 1,
      authoredTotal: DATA.skills.length - 1,
      infusions: 1,
      elementsKnown: 1,
      elementsTotal: 6,
      classesKnown: 1,
      classesTotal: CLASSES.length,
      experiments: 0,
      discoveries: 0,
      echoesKnown: 0,
      echoesTotal: 2,
      passivesActive: 0,
      essencesHeld: 2,
      essenceKinds: 1,
      speciesSeen: 1,
      speciesTotal: 5,
      kills: 1,
    });
  });

  it('round-trips through serialize() and never shares state', () => {
    book.learn('sword_throw@fire~split', 'test');
    book.learn('slash', 'start');
    trainTo(book, 'slash', 3);
    book.learnElement('holy', 'test');
    book.incFlag('kills', 3);
    book.addEssence('pierce', 1);
    book.recordKill(pip);
    const saved = JSON.parse(JSON.stringify(book.serialize()));
    const copy = new SkillBook(reg, saved);
    expect(copy.serialize()).toEqual(book.serialize());
    expect(copy.known().map((s) => s.name)).toEqual(['Blazing Split Sword Throw', 'Slash']);
    saved.skills.slash.rank = 1;
    expect(copy.rank('slash')).toBe(3);
    const out = book.serialize();
    out.skills.slash.rank = 1;
    expect(book.rank('slash')).toBe(3);
  });
});
