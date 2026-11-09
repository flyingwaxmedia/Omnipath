import { describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import { classXpToNext } from '../src/core/classes';
import { MASTERY, overmasteryCost, xpToNext } from '../src/core/mastery';
import { Registry } from '../src/core/registry';
import { hashSeed } from '../src/core/rng';
import { BOOK_FLAGS, migrateBookState } from '../src/core/save';
import { SkillBook } from '../src/core/skillbook';
import { SPARK } from '../src/core/spark';
import { emptyQuestState, emptyState, type SkillBookState } from '../src/core/state';
import type { ClassDef, GameData, PassiveDef, QuestDef, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const sk = (s: Pick<SkillDef, 'id' | 'name' | 'shape'> & Partial<SkillDef>): SkillDef => ({
  desc: '',
  icon: 'i',
  tier: 1,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 8,
  cooldown: 3000,
  maxRank: 5,
  ...s,
});

const passives: PassiveDef[] = [];
const cls = (c: Pick<ClassDef, 'id' | 'name' | 'tier'> & Partial<ClassDef>): ClassDef => {
  const t = classTreeTemplate({ classId: c.id, className: c.name, tier: c.tier, tag: 'blade', stat: 'atk', icon: 'i' });
  passives.push(...t.passives, t.imprint);
  return { icon: 'i', desc: '', hint: '', clauses: [{ tags: ['blade'], count: 4 }], bonus: {}, tree: t.nodes, imprint: t.imprint.id, ...c };
};

const DATA: GameData = {
  dataVersion: 2,
  elements: [
    { id: 'fire', name: 'Fire', prefix: 'Blazing', icon: 'f', color: 0, tier: 0, desc: '', status: 'burn', strongVs: [] },
  ],
  skills: [
    sk({ id: 'slash', name: 'Slash', tier: 0, tags: ['blade', 'basic'], maxRank: 10, spCost: 0, cooldown: 0, shape: { kind: 'strike', range: 50, arc: 100 } }),
    sk({ id: 'whirlwind', name: 'Whirlwind', tags: ['blade', 'spin'], shape: { kind: 'spin', radius: 80 } }),
  ],
  morphs: [{ from: 'slash', to: 'whirlwind' }],
  recipes: [],
  classes: [
    cls({ id: 'blademaster', name: 'Blademaster', tier: 1 }),
    cls({ id: 'pyroblade', name: 'Pyroblade', tier: 1, clauses: [{ tags: ['blade', 'fire'], count: 2 }] }),
  ],
  essences: [],
  passives,
  trainers: [],
  monsters: [],
  items: [],
  quests: [
    {
      id: 'gus_dust',
      name: 'Dust and Stone',
      giver: 'gus',
      summary: '',
      dialog: { offer: '', progress: '', complete: '' },
      objectives: [
        { kind: 'gather', node: 'ore', count: 5 },
        { kind: 'visit', map: 'vale.greystone_quarry' },
        { kind: 'state', requires: { type: 'skill', id: 'whirlwind' }, label: 'Learn Whirlwind' },
      ],
      rewards: { coins: 10 },
    } satisfies QuestDef,
  ],
};

const reg = new Registry(DATA);

/** A v1 save's book, exactly as the v1 client wrote it. */
const V1 = {
  version: 1,
  skills: {
    slash: { id: 'slash', rank: 10, xp: 500, charges: 1, uses: 340, source: 'starting weapon', learnedAt: 1731000000000 },
    'slash@fire': { id: 'slash@fire', rank: 10, xp: 3, charges: 1, uses: 20, source: 'fusion:el:fire+skill:slash', learnedAt: 1731000500000 },
    whirlwind: { id: 'whirlwind', rank: 3, xp: 40, charges: 0, uses: 12, source: 'morph:slash', learnedAt: 1731000100000 },
  },
  elements: { fire: { source: 'forge', learnedAt: 1731000200000 } },
  flags: { ore_mined: 7, kills: 31, intro: 1 },
  attempts: ['el:fire+skill:slash', 'el:fire+el:water'],
  discoveries: ['el:fire+skill:slash'],
  classes: ['blademaster', 'pyroblade'],
  activeClass: 'pyroblade',
  hints: ['A spinning blade could carry flame.'],
};

const V1_SEED = hashSeed('omnipath.book', 1731000000000, 1731000500000, 1731000100000);

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('v1 migration', () => {
  it('converts classes, the active class and adds every v2 field', () => {
    const s = migrateBookState(V1);
    expect(s).toEqual({
      version: 2,
      skills: {
        slash: { ...V1.skills.slash, overBars: 0, study: {} },
        'slash@fire': { ...V1.skills['slash@fire'], overBars: 0, study: {} },
        whirlwind: { ...V1.skills.whirlwind, overBars: 0, study: {} },
      },
      elements: V1.elements,
      flags: { ...V1.flags, [BOOK_FLAGS.classWorn]: 1 },
      attempts: V1.attempts,
      discoveries: V1.discoveries,
      hints: V1.hints,
      essences: {},
      passives: {},
      lessons: [],
      classes: { blademaster: { rank: 1, xp: 0, spent: {} }, pyroblade: { rank: 1, xp: 0, spent: {} } },
      worn: 'pyroblade',
      imprints: [],
      witness: {},
      spark: { pity: {}, lastAt: emptyState().spark.lastAt, seed: V1_SEED, counter: 0 },
      bestiary: {},
      whispered: [],
      quests: emptyQuestState(),
    } satisfies SkillBookState);
  });

  it('clamps ranks and XP to the v2 curves when given the registry', () => {
    const s = migrateBookState(V1, reg);
    // slash is maxed: XP holds at most one full overmastery bar.
    expect(s.skills.slash).toMatchObject({ rank: 10, xp: overmasteryCost(10, 0) });
    // v2 variants cap at maxRank 8.
    expect(s.skills['slash@fire']).toMatchObject({ rank: 8, xp: 3 });
    // Below max rank, XP stays strictly inside the current bar.
    expect(s.skills.whirlwind).toMatchObject({ rank: 3, xp: xpToNext(3, 1) - 1 });
    expect(s.flags[BOOK_FLAGS.masteredAny]).toBe(1);
  });

  it('is what the SkillBook loads', () => {
    const book = new SkillBook(reg, V1 as unknown as SkillBookState);
    expect(book.serialize()).toEqual(migrateBookState(V1, reg));
    expect(book.rank('slash@fire')).toBe(8);
    expect(book.state.worn).toBe('pyroblade');
    expect(V1.skills['slash@fire'].rank).toBe(10);
  });

  it('wears the first discovered class when none (or an unknown one) was active', () => {
    expect(migrateBookState({ ...V1, activeClass: null }).worn).toBe('blademaster');
    expect(migrateBookState({ ...V1, activeClass: 'ghost' }).worn).toBe('blademaster');
    const none = migrateBookState({ ...V1, classes: [], activeClass: null });
    expect(none.worn).toBeNull();
    expect(none.flags[BOOK_FLAGS.classWorn]).toBeUndefined();
  });

  it('v1 had no "No class": a null active class still wears the first class even with a worn: null key', () => {
    expect(migrateBookState({ ...V1, activeClass: null, worn: null }).worn).toBe('blademaster');
    expect(migrateBookState({ ...V1, activeClass: undefined }).worn).toBe('blademaster');
  });

  it('derives a deterministic per-save spark seed', () => {
    expect(migrateBookState(V1).spark.seed).toBe(migrateBookState(V1).spark.seed);
    const other = { ...V1, skills: { slash: { ...V1.skills.slash, learnedAt: 1731999999999 } } };
    expect(migrateBookState(other).spark.seed).not.toBe(V1_SEED);
    expect(migrateBookState({ version: 1, skills: {} }).spark.seed).toBe(emptyState().spark.seed);
  });
});

describe('v2 fill-ins', () => {
  it('keeps a complete v2 state unchanged (idempotent)', () => {
    const book = new SkillBook(reg);
    book.learn('slash', 'start');
    book.learn('whirlwind', 'test');
    book.addMastery('whirlwind', 30);
    book.learnElement('fire', 'forge');
    book.incFlag('visited:vale.hearthvale');
    const saved = book.serialize();
    saved.spark = { pity: { 'slash>whirlwind': 0.3 }, lastAt: 1200, seed: 99, counter: 7 };
    saved.bestiary = { pip: 3 };
    saved.witness = { bubble_lance: 2 };
    saved.whispered = ['pyroblade'];
    saved.quests = {
      active: { gus_dust: { progress: [3, 1, 0], acceptedAt: 40 } },
      done: { old_quest: 2 },
      cooldown: { old_quest: 9000 },
      tracked: ['gus_dust'],
    };
    expect(migrateBookState(saved, reg)).toEqual(saved);
    expect(migrateBookState(migrateBookState(saved, reg), reg)).toEqual(saved);
  });

  it('fills missing fields with defaults and keeps what is there', () => {
    const s = migrateBookState({
      version: 2,
      skills: {
        whirlwind: { id: 'whirlwind', rank: 2, xp: 5, charges: 0, uses: 1, source: 's', learnedAt: 3, overBars: 0, study: { pip: 2 } },
      },
      essences: { split: 2 },
      spark: { seed: 5 },
    });
    expect(s).toEqual({
      ...emptyState(5),
      skills: {
        whirlwind: { id: 'whirlwind', rank: 2, xp: 5, charges: 0, uses: 1, source: 's', learnedAt: 3, overBars: 0, study: { pip: 2 } },
      },
      essences: { split: 2 },
    });
  });

  it('repairs malformed entries', () => {
    const raw = JSON.parse(
      JSON.stringify({
        skills: {
          a: null,
          b: { rank: 'x', xp: -5, charges: 99, uses: Number.NaN, overBars: -1, study: { pip: -3, mom: 2.7 }, source: 4 },
        },
        flags: { ok: 2, bad: 'x' },
        essences: { split: 0, pierce: -1, haste: 2 },
        attempts: ['p', 'p', 3, 'q'],
        classes: { blademaster: { rank: 2.9, xp: -1, spent: { n1: 1, n2: 'x' } }, junk: 'x' },
        worn: 'junk',
        imprints: ['blademaster', 'ghost'],
        spark: { pity: { 'a>b': 99, 'c>d': -1 }, seed: 'x', counter: -4 },
      }),
    );
    // An own "__proto__" key, as JSON.parse produces for `{"__proto__": …}`.
    Object.defineProperty(raw.skills, '__proto__', { value: { rank: 9 }, enumerable: true, configurable: true, writable: true });
    expect(Object.keys(raw.skills)).toContain('__proto__');
    const s = migrateBookState(raw);
    expect(Object.keys(s.skills)).toEqual(['b']);
    expect(Object.getPrototypeOf(s.skills)).toBe(Object.prototype);
    expect(s.skills.b).toEqual({
      id: 'b',
      rank: 1,
      xp: 0,
      charges: MASTERY.maxCharges,
      uses: 0,
      source: 'unknown',
      learnedAt: 0,
      overBars: 0,
      study: { mom: 2 },
    });
    expect(s.flags).toEqual({ ok: 2, [BOOK_FLAGS.classWorn]: 1 });
    expect(s.essences).toEqual({ haste: 2 });
    expect(s.attempts).toEqual(['p', 'q']);
    expect(s.classes).toEqual({ blademaster: { rank: 2, xp: 0, spent: { n1: 1 } } });
    // The saved worn id is not a discovered class, so the first discovered one is worn.
    expect(s.worn).toBe('blademaster');
    expect(s.imprints).toEqual([]);
    expect(s.spark).toMatchObject({ pity: { 'a>b': SPARK.pityCap }, counter: 0 });
  });

  it('keeps an explicit "No class" (worn: null) and its Keepsakes; a missing or unknown worn wears the first class', () => {
    const base = {
      version: 2,
      classes: { blademaster: { rank: 6, xp: 0, spent: {} }, pyroblade: { rank: 2, xp: 0, spent: {} } },
      flags: { [BOOK_FLAGS.classWorn]: 1 },
      imprints: ['blademaster'],
    };
    const none = migrateBookState({ ...base, worn: null }, reg);
    expect(none.worn).toBeNull();
    expect(none.flags[BOOK_FLAGS.classWorn]).toBe(1); // a class was worn once: stays set
    expect(none.imprints).toEqual(['blademaster']); // not worn, so its Keepsake stays slotted
    // Idempotent: the SkillBook runs the migration again on construction.
    expect(migrateBookState(none, reg)).toEqual(none);
    const book = new SkillBook(reg, none);
    expect(book.state.worn).toBeNull();
    expect(book.serialize().worn).toBeNull();
    // Missing / unknown / undiscovered worn ids still fall back to the first discovered class.
    expect(migrateBookState({ ...base }, reg).worn).toBe('blademaster');
    expect(migrateBookState({ ...base, worn: 'ghost' }, reg).worn).toBe('blademaster');
    expect(migrateBookState({ ...base, worn: 42 }, reg).worn).toBe('blademaster');
    expect(migrateBookState({ ...base, worn: 'pyroblade' }, reg).worn).toBe('pyroblade');
    // No classes at all: nothing to wear either way.
    expect(migrateBookState({ version: 2, worn: null }).worn).toBeNull();
  });

  it('a book that took its class off round-trips through serialize without wearing one again', () => {
    const book = new SkillBook(reg);
    book.state.classes.pyroblade = { rank: 1, xp: 0, spent: {} };
    expect(book.wear('pyroblade').ok).toBe(true);
    expect(book.unwear().ok).toBe(true);
    const back = new SkillBook(reg, JSON.parse(JSON.stringify(book.serialize())) as SkillBookState);
    expect(back.state.worn).toBeNull();
    expect(back.state.classes.pyroblade).toBeDefined();
  });

  it('fills a save from before quests with an empty quest state', () => {
    const book = new SkillBook(reg);
    book.learn('slash', 'start');
    const saved: Partial<SkillBookState> = book.serialize();
    delete saved.quests;
    expect(migrateBookState(saved).quests).toEqual(emptyQuestState());
    expect(new SkillBook(reg, saved as SkillBookState).state.quests).toEqual(emptyQuestState());
  });

  it('repairs quest state and fits counters to the current objectives', () => {
    const raw = {
      version: 2,
      quests: {
        active: {
          gus_dust: { progress: [99, 'x', 4, 7, -2], acceptedAt: 'soon' },
          gone_quest: { progress: [5, 2.6, -1], acceptedAt: 12 },
          junk: 4,
        },
        done: { old_quest: 1, bad: -2, frac: 2.5 },
        cooldown: { gus_dust: 500, bad: 'x' },
        tracked: ['gone_quest', 'nope', 'gus_dust', 'gone_quest', 7],
      },
    };
    const structural = migrateBookState(raw);
    expect(structural.quests).toEqual({
      active: {
        gus_dust: { progress: [99, 0, 4, 7, 0], acceptedAt: 0 },
        gone_quest: { progress: [5, 2, 0], acceptedAt: 12 },
      },
      done: { old_quest: 1, frac: 2 },
      cooldown: { gus_dust: 500 },
      tracked: ['gone_quest', 'gus_dust'],
    });
    // With the registry: one counter per objective, capped (ore 5, visit 1, state keeps none). Unknown
    // quests are kept untouched (content may come back).
    expect(migrateBookState(raw, reg).quests?.active).toEqual({
      gus_dust: { progress: [5, 0, 0], acceptedAt: 0 },
      gone_quest: { progress: [5, 2, 0], acceptedAt: 12 },
    });
    expect(migrateBookState({ quests: { tracked: ['a', 'b', 'c', 'd'], active: { a: {}, b: {}, c: {}, d: {} } } }).quests?.tracked).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('clamps classes, elements and imprints with the registry', () => {
    const s = migrateBookState(
      {
        version: 2,
        elements: { fire: { source: 'forge', learnedAt: 1 }, plasma: { source: '?', learnedAt: 2 } },
        classes: {
          blademaster: { rank: 99, xp: 500, spent: {} },
          pyroblade: { rank: 3, xp: 9999, spent: {} },
          ghost: { rank: 4, xp: 1, spent: {} },
        },
        worn: 'pyroblade',
        imprints: ['blademaster', 'ghost', 'pyroblade'],
      },
      reg,
    );
    expect(Object.keys(s.elements)).toEqual(['fire']);
    expect(s.classes.blademaster).toEqual({ rank: 10, xp: 0, spent: {} });
    expect(s.classes.pyroblade).toEqual({ rank: 3, xp: classXpToNext(3, 1) - 1, spent: {} });
    expect(s.classes.ghost).toEqual({ rank: 4, xp: 1, spent: {} });
    // Worn and unknown classes are never slotted; Blademaster (CR 10) unlocked its imprint.
    expect(s.imprints).toEqual(['blademaster']);
  });
});

describe('garbage', () => {
  it('returns emptyState() for anything that is not a book', () => {
    for (const raw of [null, undefined, 42, 'save', [], true, () => 1]) expect(migrateBookState(raw)).toEqual(emptyState());
    expect(
      migrateBookState({ skills: 'x', classes: 5, flags: [1], attempts: 'nope', worn: 7, spark: { seed: 'x' } }),
    ).toEqual(emptyState());
  });

  it('never throws, even on hostile objects', () => {
    const hostile = {
      get skills(): never {
        throw new Error('boom');
      },
    };
    expect(migrateBookState(hostile)).toEqual(emptyState());
    expect(migrateBookState(hostile, reg)).toEqual(emptyState());
  });

  it('never shares objects with its input', () => {
    const s = migrateBookState(V1, reg);
    s.skills.slash.rank = 1;
    s.attempts.push('x');
    s.elements.fire!.source = 'changed';
    expect(V1.skills.slash.rank).toBe(10);
    expect(V1.attempts).toHaveLength(2);
    expect(V1.elements.fire.source).toBe('forge');
  });
});
