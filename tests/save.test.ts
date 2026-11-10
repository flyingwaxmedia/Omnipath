import { describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import { classXpNeed, classXpToNext } from '../src/core/classes';
import { MASTERY, overmasteryCost, xpToNext } from '../src/core/mastery';
import { Registry } from '../src/core/registry';
import { hashSeed } from '../src/core/rng';
import { BOOK_FLAGS, LEGACY_CLASS_MAX, MERGED_CLASSES, SHELVE_PAY_MOTES, clearLostSlots, migrateBookState } from '../src/core/save';
import { SkillBook } from '../src/core/skillbook';
import { SPARK } from '../src/core/spark';
import { emptyPouch, emptyQuestState, emptyState, emptyWeaponLevels, type SkillBookState } from '../src/core/state';
import type { ClassDef, ClassDefV4, GameData, PassiveDef, QuestDef, SkillDef } from '../src/core/types';
import { GAME_DATA, createRegistry } from '../src/data';
import SAVE_V2_LATE from './fixtures/save-v2-late.json';

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
  it('converts classes, the active class and adds every v2 and v3 field', () => {
    const s = migrateBookState(V1);
    expect(s).toEqual({
      version: 3,
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
      classes: { blademaster: { rank: 1, xp: 0 }, pyroblade: { rank: 1, xp: 0 } },
      worn: 'pyroblade',
      imprints: [],
      witness: {},
      spark: { pity: {}, lastAt: emptyState().spark.lastAt, seed: V1_SEED, counter: 0 },
      bestiary: {},
      whispered: [],
      quests: emptyQuestState(),
      shelved: {},
      weaponLevel: emptyWeaponLevels(),
      pouch: emptyPouch(),
      matPity: {},
      echoOn: {},
      deeds: {},
      titles: [],
      title: null,
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
    expect(s.classes).toEqual({ blademaster: { rank: 2, xp: 0 } }); // tree points are dropped
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
    book.state.classes.pyroblade = { rank: 1, xp: 0 };
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
    expect(s.classes.blademaster).toEqual({ rank: 10, xp: 0 });
    expect(s.classes.pyroblade).toEqual({ rank: 3, xp: classXpToNext(3) - 1 });
    expect(s.classes.ghost).toEqual({ rank: 4, xp: 1 });
    // Worn and unknown classes are never slotted; Blademaster (CR 10) unlocked its imprint.
    expect(s.imprints).toEqual(['blademaster']);
  });
});

// ------------------------------------------------------------------ v2 → v3 (SPEC-v4 §13) on a real late-v2 save

/**
 * tests/fixtures/save-v2-late.json is a book written by the v2 build (the commit before SPEC-v4 Phase 1): 153
 * skills, every one of the 30 classes discovered up to its v2 cap (10 / 8 / 5), tree points spent, three
 * Keepsakes slotted, Phantom worn, and two stale passive ids in the learned list.
 */
const LATE = SAVE_V2_LATE as unknown as Record<string, unknown> & {
  classes: Record<string, { rank: number; xp: number; spent: Record<string, number> }>;
  skills: Record<string, { rank: number }>;
};
const late = (): typeof LATE => JSON.parse(JSON.stringify(LATE)) as typeof LATE;

/** The v2 Class Rank curve, as the old build had it. */
const v2Need = (rank: number, oldMax: number): number => Math.round(60 * 1.22 ** (rank - 1) * ({ 10: 1, 8: 1.8, 5: 3 } as Record<number, number>)[oldMax]);

/**
 * The content as the content lane will ship it, as far as the migration cares: the four merged classes are gone,
 * Pyroblade has a kit of its own skills, and a class the player never discovered (Tidefencer) owns a skill they know.
 */
const PYRO_KIT = ['searing_edge', 'flame_spin', 'molten_sunder', 'flare_dash', 'firestorm'] as [string, string, string, string, string];
const LANDED: GameData = (() => {
  const tide: ClassDefV4 = {
    id: 'tidefencer',
    name: 'Tidefencer',
    icon: 'i',
    desc: 'A blade that never stops moving.',
    hint: 'Walk, and the water walks with you.',
    rarity: 'uncommon',
    weapon: 'sword',
    source: 'water',
    mechanic: { kind: 'gauge', name: 'Flow', max: 8, fill: [{ on: 'move', perTile: 1 }], effects: [], autoRule: { spend: 'atMax' } },
    kit: ['tidal_crescent', 'whirlwind', 'sword_throw', 'heavy_cleave', 'blade_aura'],
    discover: { requires: [{ type: 'flag', id: 'kills:sword:water', min: 20 }] },
    bonus: {},
  };
  const classOf: Record<string, string> = { tidal_crescent: 'tidefencer', ...Object.fromEntries(PYRO_KIT.map((id) => [id, 'pyroblade'])) };
  return {
    ...GAME_DATA,
    skills: GAME_DATA.skills.map((sk0) => (classOf[sk0.id] ? { ...sk0, classOf: classOf[sk0.id] } : sk0)),
    classes: [
      ...GAME_DATA.classes
        .filter((c) => !(c.id in MERGED_CLASSES))
        .map((c) => (c.id === 'pyroblade' ? { ...c, rarity: 'uncommon' as const, weapon: 'sword' as const, source: 'fire' as const, kit: PYRO_KIT } : c)),
      tide,
    ],
  };
})();

describe('v2 → v3 migration of a real late-v2 save (SPEC-v4 §13)', () => {
  const real = createRegistry();
  const landed = new Registry(LANDED);

  it('the fixture is a v2 book of the old build, and the merge table matches the data', () => {
    expect(LATE.version).toBe(2);
    expect(Object.keys(LATE.classes)).toHaveLength(30);
    expect(LATE.worn).toBe('phantom');
    expect(Object.keys(LATE.skills).length).toBeGreaterThan(100);
    for (const [from, to] of Object.entries(MERGED_CLASSES)) {
      expect(real.classDef(to), to).toBeDefined();
      expect(landed.classDef(from), from).toBeUndefined();
    }
    // The legacy caps are exactly the v2 tiers of today's data.
    for (const c of real.classes) expect(LEGACY_CLASS_MAX[c.id] ?? 10, c.id).toBe({ 1: 10, 2: 8, 3: 5 }[c.tier ?? 1]);
  });

  it('rule 16 and rule 1: becomes version 3 with every new field empty and all four weapons at level 0', () => {
    const s = migrateBookState(late(), real);
    expect(s.version).toBe(3);
    expect(s).toMatchObject({ shelved: {}, matPity: {}, echoOn: {}, deeds: {}, titles: [], title: null });
    expect(s.weaponLevel).toEqual({ sword: 0, dagger: 0, staff: 0, fists: 0 });
    expect(s.pouch).toEqual(emptyPouch());
    expect(Object.keys(s).sort()).toEqual(Object.keys(emptyState()).sort());
  });

  it('rule 2: rescales class levels 10 / 8 / 5 → 10, keeps the share of the bar, drops tree points', () => {
    const s = migrateBookState(late(), real);
    for (const [id, old] of Object.entries(LATE.classes)) {
      const oldMax = LEGACY_CLASS_MAX[id] ?? 10;
      const want = Math.max(1, Math.round((old.rank * 10) / oldMax));
      const got = s.classes[id];
      expect(got.rank, id).toBe(want);
      expect(got).not.toHaveProperty('spent');
      const cls = real.classDef(id)!;
      const need = classXpNeed(cls, want);
      if (want >= 10) expect(got.xp, id).toBe(0);
      else expect(got.xp, id).toBe(Math.min(need - 1, Math.floor((old.xp / v2Need(old.rank, oldMax)) * need)));
    }
    // By hand: Tier I unchanged, Tier II 8 → 10 and 2 → 3, Tier III 5 → 10 and 3 → 6.
    expect(s.classes.blademaster).toEqual({ rank: 10, xp: 0 });
    expect(s.classes.pyroblade.rank).toBe(7);
    expect(s.classes.magma_knight).toEqual({ rank: 10, xp: 0 });
    expect(s.classes.sword_saint.rank).toBe(3);
    expect(s.classes.ascendant).toEqual({ rank: 10, xp: 0 });
    expect(s.classes.eclipse_walker.rank).toBe(6);
    // Levels are scaled up, never down.
    for (const [id, old] of Object.entries(LATE.classes)) expect(s.classes[id].rank, id).toBeGreaterThanOrEqual(old.rank);
  });

  it('rule 4: every discovered class stays discovered, whatever its requirements are now', () => {
    const s = migrateBookState(late(), real);
    expect(Object.keys(s.classes).sort()).toEqual(Object.keys(LATE.classes).sort());
    const book = new SkillBook(landed, late() as unknown as SkillBookState);
    // Pyroblade now has a kit and (here) no discovery data the player meets: it is still theirs.
    expect(book.state.classes.pyroblade.rank).toBe(7);
    book.evaluateClasses();
    expect(book.state.classes.pyroblade.rank).toBe(7);
  });

  it('rule 3: merged classes wait while the registry still has them, then fold into their targets', () => {
    const before = migrateBookState(late(), real);
    expect(before.classes.phantom).toBeDefined();
    expect(before.worn).toBe('phantom');

    const s = migrateBookState(late(), landed);
    for (const from of Object.keys(MERGED_CLASSES)) expect(s.classes[from], from).toBeUndefined();
    // Both discovered: the higher level after rule 2, +1, at most 10.
    expect(s.classes.shadowstalker).toEqual({ rank: 10, xp: 0 }); // 10 and Phantom 8/8 → 10
    expect(s.classes.tempest_dancer).toEqual({ rank: 10, xp: 0 }); // 6 and Vortex Dancer 10 → 10
    expect(s.classes.elementalist).toEqual({ rank: 10, xp: 0 }); // 9 and Prism Sage 6/8 → 8: 9 + 1
    expect(s.classes.mimic).toEqual({ rank: 4, xp: 0 }); // 3 and Echo Sovereign 2/8 → 3: 3 + 1
    // `worn`, whispers and Keepsakes follow the target.
    expect(s.worn).toBe('shadowstalker');
    expect(s.imprints).toEqual(['blademaster', 'elementalist', 'tempest_dancer']);
    expect(Object.keys(s.classes)).toHaveLength(26);

    // A v3 save written while the merged classes still existed is folded the same way later.
    expect(migrateBookState(JSON.parse(JSON.stringify(before)), landed).classes).toEqual(s.classes);
    // Without a registry the table alone decides, for pre-v3 books only.
    expect(migrateBookState(late()).classes.phantom).toBeUndefined();
    expect(migrateBookState(JSON.parse(JSON.stringify(before))).classes.phantom).toBeDefined();
  });

  it('rule 3: a merged class alone becomes its target', () => {
    const raw = { version: 2, classes: { vortex_dancer: { rank: 4, xp: 54, spent: { n1: 1 } } }, worn: 'vortex_dancer', whispered: ['phantom'] };
    const s = migrateBookState(raw, landed);
    expect(s.classes).toEqual({ tempest_dancer: { rank: 5, xp: Math.floor((54 / v2Need(4, 8)) * classXpToNext(5)) } });
    expect(s.worn).toBe('tempest_dancer');
    expect(s.whispered).toEqual(['shadowstalker']);
  });

  it('rule 8: class-only skills of undiscovered classes are shelved with their rank and pay 3 Motes each', () => {
    const s = migrateBookState(late(), landed);
    expect(SHELVE_PAY_MOTES).toBe(3);
    expect(s.skills.tidal_crescent).toBeUndefined();
    expect(s.shelved.tidal_crescent).toMatchObject({ id: 'tidal_crescent', rank: LATE.skills.tidal_crescent.rank });
    expect(Object.keys(s.shelved)).toEqual(['tidal_crescent']);
    expect(s.pouch.mote).toBe(3);
    // Pyroblade is discovered: its class skills stay known, ranks kept.
    for (const id of PYRO_KIT) expect(s.skills[id].rank, id).toBe(LATE.skills[id].rank);
    // Nothing is shelved while the content has no class skills.
    expect(migrateBookState(late(), real).shelved).toEqual({});
    expect(migrateBookState(late(), real).pouch.mote).toBe(0);
  });

  it('rule 8: a shelved skill comes back, rank kept, when its class is discovered', () => {
    const book = new SkillBook(landed, late() as unknown as SkillBookState);
    const learned: string[] = [];
    book.events.on('learned', (e) => learned.push(e.skill.id));
    expect(book.has('tidal_crescent')).toBe(false);
    book.incFlag('kills:sword:water', 20);
    expect(book.state.classes.tidefencer).toEqual({ rank: 1, xp: 0 });
    expect(book.rank('tidal_crescent')).toBe(LATE.skills.tidal_crescent.rank);
    expect(book.state.shelved).toEqual({});
    expect(learned).toContain('tidal_crescent');
    expect(book.state.pouch.mote).toBe(3); // the payment is kept
    // And a reload does not shelve it again.
    const again = migrateBookState(book.serialize(), landed);
    expect(again.skills.tidal_crescent).toBeDefined();
    expect(again.pouch.mote).toBe(3);
  });

  it('rule 9: the worn class knows the kit its level has unlocked, and lost bar slots are cleared', () => {
    const raw = late();
    delete (raw.skills as Record<string, unknown>).flare_dash; // kit skill 4 (Class Level 4); Pyroblade is 7
    delete (raw.skills as Record<string, unknown>).searing_edge;
    raw.worn = 'pyroblade';
    const s = migrateBookState(raw, landed);
    expect(s.skills.flare_dash).toMatchObject({ rank: 1, source: 'class:pyroblade' });
    expect(s.skills.searing_edge).toMatchObject({ rank: 1, source: 'class:pyroblade' });
    const book = new SkillBook(landed, s);
    expect(book.classSkills('pyroblade')).toEqual(PYRO_KIT);
    // The bar: shelved and unknown skills leave it; a dagger skill held with a sword stays (the bar greys it).
    expect(clearLostSlots(s, ['tidal_crescent', 'whirlwind', null, 'ghost_skill', 'backstab', 'searing_edge'])).toEqual([
      null,
      'whirlwind',
      null,
      null,
      'backstab',
      'searing_edge',
    ]);
  });

  it('rule 15: tree, imprint and derived passive ids leave the learned list; real ones stay', () => {
    const raw = late();
    (raw.passives as Record<string, number>).tag_echo = 1;
    (raw.passives as Record<string, number>).tag_blade = 2;
    const learnedBefore = Object.keys(LATE.passives as Record<string, number>);
    expect(learnedBefore).toEqual(expect.arrayContaining(['cls_blademaster_1', 'imprint_pyroblade']));
    const s = migrateBookState(raw, real);
    for (const id of Object.keys(s.passives)) {
      expect(id).not.toMatch(/^(cls_|imprint_|tag_)/);
      expect(['trainer', 'resonance', 'bestiary']).toContain(real.passive(id)?.source);
    }
    expect(Object.keys(s.passives).sort()).toEqual(learnedBefore.filter((id) => !/^(cls_|imprint_)/.test(id)).sort());
    // Nothing active refers to a tree node.
    const book = new SkillBook(real, s);
    expect(book.passives().some((p) => p.def.id.startsWith('cls_'))).toBe(false);
  });

  it('keeps everything else the player earned', () => {
    const s = migrateBookState(late(), real);
    for (const key of ['elements', 'flags', 'attempts', 'discoveries', 'hints', 'essences', 'lessons', 'witness', 'bestiary', 'whispered', 'spark'] as const) {
      expect(s[key], key).toEqual(LATE[key]);
    }
    expect(Object.keys(s.skills).sort()).toEqual(Object.keys(LATE.skills).sort());
    for (const [id, p] of Object.entries(LATE.skills)) expect(s.skills[id].rank, id).toBe(p.rank);
    expect(s.imprints).toEqual(LATE.imprints);
  });

  it('is pure, deterministic and idempotent', () => {
    for (const r of [undefined, real, landed]) {
      const input = late();
      const snapshot = JSON.stringify(input);
      const once = migrateBookState(input, r);
      expect(JSON.stringify(input)).toBe(snapshot);
      expect(migrateBookState(late(), r)).toEqual(once);
      const twice = migrateBookState(JSON.parse(JSON.stringify(once)), r);
      expect(twice).toEqual(once);
      expect(migrateBookState(twice, r)).toEqual(once);
    }
    // The SkillBook migrates again on construction and on every reload: still the same book.
    const once = migrateBookState(late(), landed);
    expect(new SkillBook(landed, once).serialize()).toEqual(once);
  });

  it('an early v2 save (one class, nothing spent) migrates cleanly too', () => {
    const early = { version: 2, skills: { slash: { id: 'slash', rank: 3, xp: 4, charges: 0, uses: 9, source: 'start', learnedAt: 5, overBars: 0, study: {} } }, classes: { blademaster: { rank: 2, xp: 30, spent: {} } }, worn: 'blademaster' };
    const s = migrateBookState(early, landed);
    expect(s.classes).toEqual({ blademaster: { rank: 2, xp: 30 } });
    expect(s.worn).toBe('blademaster');
    expect(s.shelved).toEqual({});
    expect(migrateBookState(s, landed)).toEqual(s);
  });

  it('repairs malformed v3 fields', () => {
    const s = migrateBookState({
      version: 3,
      weaponLevel: { sword: 9, dagger: -2, staff: 'x', bow: 3 },
      pouch: { fang: 12.7, mote: 1e9, gold: 5 },
      shelved: { a: null, b: { rank: 2 } },
      echoOn: { slash: 'gale_feather', bad: 4 },
      deeds: { fallen: 2, zero: 0 },
      titles: ['Wanderer', 'Wanderer', 7],
      title: 'Nobody',
    });
    expect(s.weaponLevel).toEqual({ sword: 5, dagger: 0, staff: 0, fists: 0 });
    expect(s.pouch).toEqual({ ...emptyPouch(), fang: 12, mote: 9999 });
    expect(Object.keys(s.shelved)).toEqual(['b']);
    expect(s.echoOn).toEqual({ slash: 'gale_feather' });
    expect(s.deeds).toEqual({ fallen: 2 });
    expect(s.titles).toEqual(['Wanderer']);
    expect(s.title).toBeNull();
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
