import { describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import {
  CLASS,
  CLASS_SLOTS,
  HARDENED_RANK,
  IMPRINT_THIRD_SLOT_CLASSES,
  bonusShare,
  canBuyNode,
  classBonusAt,
  classFeeds,
  classMatchesSkill,
  classMaxRank,
  classMechanic,
  classPoints,
  classProgress,
  classRarity,
  classSkillFit,
  classSkills,
  classSlotEligible,
  classStatBonus,
  classTagPct,
  classTier,
  classXpNeed,
  classXpToNext,
  clauseCount,
  discoverableNow,
  grantClassXp,
  imprintSlots,
  imprintUnlocked,
  kitLevelOf,
  kitSkillsAt,
  kitUnlocked,
  mastered,
  ownSlotEligible,
  spentPoints,
  trialReady,
  wornClass,
  wornMechanic,
} from '../src/core/classes';
import { SkillBook } from '../src/core/skillbook';
import { Registry } from '../src/core/registry';
import { VISITED_FLAG_PREFIX, countTagged, type RequirementContext } from '../src/core/requirements';
import { emptyState, type ClassProgress, type SkillBookState, type SkillProgress } from '../src/core/state';
import type { ClassDef, ClassDefV4, ClassMechanic, ClassTier, ElementDef, ElementId, GameData, PassiveDef, QuestDef, SkillDef } from '../src/core/types';
import { createRegistry } from '../src/data';

// ------------------------------------------------------------------ inline fixture

const el = (id: ElementId, name: string): ElementDef => ({
  id,
  name,
  prefix: name,
  icon: `i_${id}`,
  color: 0,
  tier: 0,
  desc: name,
  status: 'burn',
  strongVs: [],
});

const sk = (s: Pick<SkillDef, 'id' | 'tags'> & Partial<SkillDef>): SkillDef => ({
  name: s.id,
  desc: `${s.id}.`,
  icon: `i_${s.id}`,
  tier: 1,
  weapons: ['sword'],
  power: 1,
  spCost: 8,
  cooldown: 3000,
  shape: { kind: 'strike', range: 40, arc: 90 },
  maxRank: 10,
  ...s,
});

const treePassives: PassiveDef[] = [];

/** A class with a templated tree + imprint; its passives are collected into `treePassives`. */
function cls(c: Pick<ClassDef, 'id' | 'tier'> & Partial<ClassDef>, tag = 'blade'): ClassDef {
  const t = classTreeTemplate({ classId: c.id, className: c.id, tier: c.tier, tag, stat: 'atk', icon: 'i' });
  treePassives.push(...t.passives, t.imprint);
  return {
    name: c.id,
    icon: 'i',
    desc: '',
    hint: `riddle of ${c.id}`,
    clauses: [],
    bonus: {},
    tree: t.nodes,
    imprint: t.imprint.id,
    ...c,
  };
}

const BLADEMASTER = cls({
  id: 'blademaster',
  tier: 1,
  clauses: [{ tags: ['blade'], count: 4 }],
  bonus: { atk: 10, crit: 2, tagPower: { blade: 10, spin: 5 } },
});
const STALKER = cls({
  id: 'stalker',
  tier: 1,
  clauses: [
    { tags: ['stealth'], count: 1 },
    { tags: ['blade', 'fire'], count: 2 },
  ],
});
const PRISM = cls({ id: 'prism', tier: 1, distinctElements: 2 });
const MOONWARDEN = cls({
  id: 'moonwarden',
  tier: 1,
  hidden: true,
  clauses: [{ tags: ['holy'], count: 1 }],
  requires: [{ type: 'mapVisited', id: 'vale.moonlit_glade' }],
});
const SAINT = cls({
  id: 'sword_saint',
  tier: 2,
  clauses: [{ tags: ['blade'], count: 2 }],
  parents: [{ id: 'blademaster', rank: 10 }],
});
const ASCENDANT = cls({
  id: 'ascendant',
  tier: 3,
  parents: [{ id: 'sword_saint', rank: 6 }],
  requires: [{ type: 'flag', id: 'relic_storm', min: 1, label: 'Hold the Storm Relic' }],
});
/** Twelve plain Tier I classes for the third imprint slot. */
const FILLERS = Array.from({ length: IMPRINT_THIRD_SLOT_CLASSES }, (_, i) =>
  cls({ id: `filler_${i}`, tier: 1, clauses: [{ tags: ['filler'], count: 1 }] }),
);

const CLASSES = [BLADEMASTER, STALKER, PRISM, MOONWARDEN, SAINT, ASCENDANT, ...FILLERS];

const DATA: GameData = {
  dataVersion: 2,
  elements: [el('fire', 'Fire'), el('holy', 'Holy'), el('water', 'Water')],
  skills: [
    sk({ id: 'slash', tier: 0, tags: ['blade', 'basic'] }),
    sk({ id: 'whirlwind', tags: ['blade', 'spin'], shape: { kind: 'spin', radius: 60 } }),
    sk({ id: 'throw', tags: ['blade', 'projectile'], shape: { kind: 'projectile', speed: 300, range: 300 } }),
    sk({ id: 'cleave', tags: ['blade', 'heavy'] }),
    sk({ id: 'searing', tags: ['blade'], element: 'fire' }),
    sk({ id: 'smite', tags: ['blade'], element: 'holy' }),
    sk({
      id: 'vanish',
      weapons: ['dagger'],
      tags: ['stealth', 'buff'],
      shape: { kind: 'buff', stat: 'speed', amount: 10, duration: 3000 },
    }),
    sk({ id: 'orb', weapons: ['staff'], tags: ['arcane'] }),
  ],
  morphs: [],
  recipes: [],
  classes: CLASSES,
  essences: [],
  passives: treePassives,
  trainers: [],
  monsters: [],
  items: [],
};

const reg = new Registry(DATA);

const prog = (id: string, rank: number): SkillProgress => ({
  id,
  rank,
  xp: 0,
  charges: 0,
  uses: 0,
  source: 'test',
  learnedAt: 0,
  overBars: 0,
  study: {},
});

function stateWith(ranks: Record<string, number>, patch: Partial<SkillBookState> = {}): SkillBookState {
  const s = emptyState();
  for (const [id, rank] of Object.entries(ranks)) s.skills[id] = prog(id, rank);
  return { ...s, ...patch };
}

const cp = (rank: number, xp = 0): ClassProgress => ({ rank, xp });

/** A RequirementContext reading straight from a state (what the SkillBook implements). */
function ctxOf(state: SkillBookState, r: Registry = reg): RequirementContext {
  return {
    level: 1,
    hasElement: (id) => !!state.elements[id],
    elementsKnown: () => Object.keys(state.elements).length,
    rank: (id) => state.skills[id]?.rank ?? 0,
    flag: (id) => state.flags[id] ?? 0,
    classRank: (id) => state.classes[id]?.rank ?? 0,
    worn: state.worn,
    tagCount: (tags, minRank) => countTagged(r, state.skills, tags, minRank),
    itemCount: () => 0,
    lessons: state.lessons,
    witness: (id) => state.witness[id] ?? 0,
  };
}

const view = (state: SkillBookState, c: ClassDef) => classProgress(reg, state, c, ctxOf(state));

// ------------------------------------------------------------------ tests

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('Class Level curve (SPEC-v4 §3.4)', () => {
  it('follows round(60 × 1.22^(level-1) × the rarity multiplier)', () => {
    expect(CLASS.xpMul).toEqual({ common: 1, uncommon: 1, rare: 1.2, epic: 1.4, legendary: 1.6, mythic: 1.6 });
    expect(classXpToNext(1)).toBe(60);
    expect(classXpToNext(2, 'common')).toBe(73);
    expect(classXpToNext(5, 'uncommon')).toBe(Math.round(60 * 1.22 ** 4));
    expect(classXpToNext(1, 'rare')).toBe(72);
    expect(classXpToNext(1, 'epic')).toBe(84);
    expect(classXpToNext(1, 'legendary')).toBe(96);
    expect(classXpToNext(1, 'mythic')).toBe(96);
  });

  it('has one max level for every class: 10', () => {
    expect(CLASS.maxLevel).toBe(10);
    for (const c of [BLADEMASTER, SAINT, ASCENDANT]) expect(classMaxRank(c)).toBe(10);
  });

  it('maps v2 tiers to rarities and back (classes without a rarity)', () => {
    expect([BLADEMASTER, SAINT, ASCENDANT].map(classRarity)).toEqual(['uncommon', 'rare', 'epic']);
    expect((['common', 'uncommon', 'rare', 'epic', 'legendary', 'mythic'] as const).map((rarity) => classTier({ rarity }))).toEqual([1, 1, 2, 3, 3, 3]);
    expect(classXpNeed(SAINT, 1)).toBe(72);
  });
});

describe('classMatchesSkill', () => {
  it('matches a skill carrying every tag of any clause', () => {
    expect(classMatchesSkill(BLADEMASTER, reg.skill('slash')!)).toBe(true);
    expect(classMatchesSkill(BLADEMASTER, reg.skill('orb')!)).toBe(false);
    expect(classMatchesSkill(STALKER, reg.skill('slash')!)).toBe(false);
    expect(classMatchesSkill(STALKER, reg.skill('searing')!)).toBe(true);
    expect(classMatchesSkill(STALKER, reg.skill('vanish')!)).toBe(true);
    // Weapons and elements are tags: slash@fire carries blade + fire.
    expect(classMatchesSkill(STALKER, reg.skill('slash@fire')!)).toBe(true);
  });

  it('matches aligned skills for element classes and every skill for parent-only classes', () => {
    expect(classMatchesSkill(PRISM, reg.skill('smite')!)).toBe(true);
    expect(classMatchesSkill(PRISM, reg.skill('orb')!)).toBe(false);
    expect(classMatchesSkill(ASCENDANT, reg.skill('orb')!)).toBe(true);
  });
});

describe('clauseCount', () => {
  const blade = { tags: ['blade'], count: 4 };

  it('counts every known skill id when permissive (variants included)', () => {
    const state = stateWith({ slash: 1, 'slash@fire': 1, whirlwind: 2, orb: 9 });
    expect(clauseCount(reg, state, blade, false)).toBe(3);
  });

  it('counts distinct authored skills at rank ≥ 5 when hardened', () => {
    const state = stateWith({ slash: 3, 'slash@fire': HARDENED_RANK, whirlwind: 6, throw: 4 });
    // slash counts once via its variant at rank 5; whirlwind counts; throw is below rank 5.
    expect(clauseCount(reg, state, blade, true)).toBe(2);
  });
});

describe('discovery', () => {
  it('discovers Tier I classes with permissive counting', () => {
    const state = stateWith({ slash: 1, whirlwind: 1, throw: 1 });
    expect(discoverableNow(reg, state, BLADEMASTER, ctxOf(state))).toBe(false);
    state.skills['slash@fire'] = prog('slash@fire', 1);
    expect(discoverableNow(reg, state, BLADEMASTER, ctxOf(state))).toBe(true);
    state.classes.blademaster = cp(1);
    expect(discoverableNow(reg, state, BLADEMASTER, ctxOf(state))).toBe(false);
  });

  it('counts distinct skill elements for element classes', () => {
    const state = stateWith({ searing: 1, 'slash@fire': 1 });
    expect(view(state, PRISM).elements).toEqual({ have: 1, need: 2 });
    state.skills.smite = prog('smite', 1);
    expect(discoverableNow(reg, state, PRISM, ctxOf(state))).toBe(true);
  });

  it('hardens Tier II: parents at CR and skills at rank 5', () => {
    const state = stateWith({ slash: 10, whirlwind: 4 }, { classes: { blademaster: cp(10) } });
    expect(discoverableNow(reg, state, SAINT, ctxOf(state))).toBe(false);
    const v = view(state, SAINT);
    expect(v.clauses.map((c) => c.have)).toEqual([1]);
    expect(v.parents).toEqual([{ id: 'blademaster', need: 10, have: 10 }]);
    state.skills.whirlwind.rank = 5;
    expect(discoverableNow(reg, state, SAINT, ctxOf(state))).toBe(true);
    state.classes.blademaster.rank = 9;
    expect(discoverableNow(reg, state, SAINT, ctxOf(state))).toBe(false);
  });

  it('checks extra requirements (Tier III relic flag)', () => {
    const state = stateWith({}, { classes: { blademaster: cp(10), sword_saint: cp(6) } });
    const before = view(state, ASCENDANT);
    expect(before.requires).toEqual([{ text: 'Hold the Storm Relic', ok: false }]);
    expect(before.progress).toBe(0.5);
    expect(discoverableNow(reg, state, ASCENDANT, ctxOf(state))).toBe(false);
    state.flags.relic_storm = 1;
    expect(discoverableNow(reg, state, ASCENDANT, ctxOf(state))).toBe(true);
  });
});

describe('discoverableNow agrees with classProgress', () => {
  const hasComponents = (c: ClassDef): boolean =>
    (c.clauses?.length ?? 0) > 0 || !!c.distinctElements || !!c.parents?.length || !!c.requires?.length || !!c.discover?.requires.length;

  function expectAgreement(r: Registry, states: SkillBookState[]): number {
    let discoverable = 0;
    for (const state of states) {
      const ctx = ctxOf(state, r);
      for (const c of r.classes) {
        const v = classProgress(r, state, c, ctx);
        const expected = !v.discovered && v.progress >= 1 && hasComponents(c);
        expect(discoverableNow(r, state, c, ctx), `${c.id}`).toBe(expected);
        if (expected) discoverable++;
      }
    }
    return discoverable;
  }

  it('on the fixture classes', () => {
    const states = [
      stateWith({}),
      stateWith({ slash: 1, whirlwind: 1, throw: 1, 'slash@fire': 1 }),
      stateWith({ vanish: 1, searing: 1, 'slash@fire': 1, smite: 1 }),
      stateWith({ slash: 10, whirlwind: 5 }, { classes: { blademaster: cp(10) } }),
      stateWith({}, { classes: { blademaster: cp(10), sword_saint: cp(6) }, flags: { relic_storm: 1 } }),
      stateWith({ smite: 1 }, { flags: { [VISITED_FLAG_PREFIX + 'vale.moonlit_glade']: 1 } }),
    ];
    expect(expectAgreement(reg, states)).toBeGreaterThan(0);
  });

  it('on the real classes', () => {
    const real = createRegistry();
    const all = Object.fromEntries(real.authoredSkills().map((s) => [s.id, HARDENED_RANK]));
    const classes = Object.fromEntries(real.classes.map((c) => [c.id, cp(c.tier === 1 ? 10 : 6)]));
    const half = Object.fromEntries(real.authoredSkills().slice(0, 40).map((s) => [s.id, 3]));
    const states = [
      stateWith({}),
      stateWith(half),
      stateWith(all),
      stateWith(all, { classes: Object.fromEntries(Object.entries(classes).filter(([id]) => real.classDef(id)!.tier === 1)) }),
      stateWith(all, {
        classes: Object.fromEntries(Object.entries(classes).filter(([id]) => (real.classDef(id)!.tier ?? 1) < 3)),
        flags: { relic_storm: 1, relic_dusk: 1, [VISITED_FLAG_PREFIX + 'vale.moonlit_glade']: 1 },
      }),
    ];
    expect(expectAgreement(real, states)).toBeGreaterThan(0);
    // v4: the Commons are found by using the weapon, not by which skills are known.
    const hits = stateWith({}, { flags: { 'hits:sword': 60, 'hits:fists': 59 } });
    expectAgreement(real, [hits]);
    expect(discoverableNow(real, hits, real.classDef('blademaster')!, ctxOf(hits, real))).toBe(true);
    expect(discoverableNow(real, hits, real.classDef('wayfarer')!, ctxOf(hits, real))).toBe(false);
    expect(discoverableNow(real, stateWith(all), real.classDef('blademaster')!, ctxOf(stateWith(all), real))).toBe(false);
  });
});

describe('hardened distinct elements', () => {
  const real = createRegistry();
  // v4 merged Prism Sage into Prismcaller, so no real class counts distinct elements any more. The rule still
  // serves kit-less (v2) classes: the old Prism Sage as data, against the real skills.
  const prism: ClassDef = {
    id: 'prism_sage_v2',
    name: 'Prism Sage',
    icon: '💎',
    desc: 'Five elements in one voice.',
    hint: 'Five elements.',
    bonus: {},
    tier: 2,
    distinctElements: 5,
    parents: [{ id: 'elementalist', rank: 10 }],
  };
  const withElementalist = (ranks: Record<string, number>) =>
    stateWith(ranks, { classes: { elementalist: cp(10) } });

  it('counts each distinct authored skill for at most one element', () => {
    expect(prism.distinctElements).toBe(5);
    const variants = Object.fromEntries(
      ['fire', 'water', 'earth', 'wind', 'holy'].map((e) => [`slash@${e}`, HARDENED_RANK]),
    );
    const state = withElementalist(variants);
    expect(classProgress(real, state, prism, ctxOf(state, real)).elements).toEqual({ have: 1, need: 5 });
    expect(discoverableNow(real, state, prism, ctxOf(state, real))).toBe(false);
  });

  it('counts five distinct authored elemental skills as five', () => {
    const ids = ['firebolt', 'aqua_lance', 'lightning_bolt', 'wind_cutter', 'holy_light'];
    const state = withElementalist(Object.fromEntries(ids.map((id) => [id, HARDENED_RANK])));
    expect(new Set(ids.map((id) => real.skill(id)!.element)).size).toBe(5);
    expect(classProgress(real, state, prism, ctxOf(state, real)).elements).toEqual({ have: 5, need: 5 });
    expect(discoverableNow(real, state, prism, ctxOf(state, real))).toBe(true);
    // Below the hardened rank one of them stops counting.
    state.skills.holy_light.rank = HARDENED_RANK - 1;
    expect(classProgress(real, state, prism, ctxOf(state, real)).elements?.have).toBe(4);
  });

  it('uses a true matching, not min(elements, skills)', () => {
    // firebolt {fire}, flame_spin {fire}, slash {water, earth}: 3 elements and 3 skills, but both
    // fire skills compete for fire, so only 2 skills can each claim a distinct element.
    const state = withElementalist({
      firebolt: HARDENED_RANK,
      flame_spin: HARDENED_RANK,
      'slash@water': HARDENED_RANK,
      'slash@earth': HARDENED_RANK,
    });
    expect(classProgress(real, state, prism, ctxOf(state, real)).elements?.have).toBe(2);
    // An augmenting path: aqua_lance takes water, so slash moves to earth → fire, water, earth.
    state.skills.aqua_lance = prog('aqua_lance', HARDENED_RANK);
    expect(classProgress(real, state, prism, ctxOf(state, real)).elements?.have).toBe(3);
  });

  it('keeps Tier I element counting permissive', () => {
    const state = stateWith({ searing: 1, 'slash@fire': 1, 'slash@holy': 1 });
    expect(view(state, PRISM).elements).toEqual({ have: 2, need: 2 });
  });
});

describe('classProgress and codex', () => {
  it('averages component fills and walks unknown → whispered → near → known', () => {
    const state = stateWith({});
    expect(view(state, BLADEMASTER)).toMatchObject({ discovered: false, rank: 0, progress: 0, codex: 'unknown' });
    state.skills.slash = prog('slash', 1);
    expect(view(state, BLADEMASTER)).toMatchObject({ progress: 0.25, codex: 'whispered' });
    state.skills.whirlwind = prog('whirlwind', 1);
    expect(view(state, BLADEMASTER)).toMatchObject({ progress: 0.5, codex: 'near' });
    state.classes.blademaster = cp(3);
    expect(view(state, BLADEMASTER)).toMatchObject({ discovered: true, rank: 3, progress: 1, codex: 'known' });
  });

  it('weights clauses equally', () => {
    const state = stateWith({ vanish: 1 });
    // stealth 1/1 and blade+fire 0/2 → 0.5.
    const v = view(state, STALKER);
    expect(v.progress).toBe(0.5);
    expect(v.clauses.map((c) => c.have)).toEqual([1, 0]);
    expect(v.elements).toBeUndefined();
    expect(v.parents).toBeUndefined();
    expect(v.requires).toBeUndefined();
  });

  it('whispers early when the class is in state.whispered', () => {
    const state = stateWith({}, { whispered: ['blademaster'] });
    expect(view(state, BLADEMASTER).codex).toBe('whispered');
  });

  it('keeps hidden classes unknown until whispered', () => {
    const state = stateWith({ smite: 1 });
    state.flags[VISITED_FLAG_PREFIX + 'vale.moonlit_glade'] = 1;
    const v = view(state, MOONWARDEN);
    expect(v.progress).toBe(1);
    expect(v.codex).toBe('unknown');
    expect(v.requires).toEqual([{ text: 'Visit Moonlit Glade', ok: true }]);
    expect(discoverableNow(reg, state, MOONWARDEN, ctxOf(state))).toBe(true);
    state.whispered.push('moonwarden');
    expect(view(state, MOONWARDEN).codex).toBe('near');
  });
});

describe('grantClassXp: only the worn class', () => {
  const slash = reg.skill('slash')!;
  const orb = reg.skill('orb')!;

  it('gives the worn class 50% and every other class nothing', () => {
    const state = stateWith(
      {},
      { classes: { blademaster: cp(1), sword_saint: cp(1), stalker: cp(1), prism: cp(1) }, worn: 'blademaster' },
    );
    expect(CLASS.wornShare).toBe(0.5);
    expect(grantClassXp(reg, state, slash, 20)).toEqual([]);
    expect(state.classes.blademaster.xp).toBeCloseTo(10, 10);
    for (const id of ['sword_saint', 'stalker', 'prism']) expect(state.classes[id].xp).toBe(0);
  });

  it('gives a worn v2 class nothing for a non-matching skill', () => {
    const state = stateWith({}, { classes: { blademaster: cp(1) }, worn: 'blademaster' });
    grantClassXp(reg, state, orb, 100);
    expect(state.classes.blademaster.xp).toBe(0);
  });

  it('ignores undiscovered worn ids, "No class" and bad XP', () => {
    const state = stateWith({}, { classes: { sword_saint: cp(1) }, worn: 'blademaster' });
    expect(grantClassXp(reg, state, slash, 100)).toEqual([]);
    state.worn = null;
    expect(grantClassXp(reg, state, slash, 100)).toEqual([]);
    state.worn = 'sword_saint';
    expect(grantClassXp(reg, state, slash, -5)).toEqual([]);
    expect(grantClassXp(reg, state, slash, Number.NaN)).toEqual([]);
    expect(state.classes.sword_saint.xp).toBe(0);
  });

  it('reports every level gained and stops at level 10', () => {
    const state = stateWith({}, { classes: { sword_saint: cp(1), blademaster: cp(1) }, worn: 'blademaster' });
    // 60 + 73 = 133 for level 3 at 50% → 266 XP; the rest carries over.
    const ups = grantClassXp(reg, state, slash, 270);
    expect(ups.map((u) => [u.cls.id, u.rank])).toEqual([['blademaster', 2], ['blademaster', 3]]);
    expect(state.classes.blademaster.xp).toBeCloseTo(135 - 133, 10);

    const capped = grantClassXp(reg, state, slash, 1e9);
    expect(capped.map((u) => u.rank)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(state.classes.blademaster).toEqual({ rank: 10, xp: 0 });
    expect(mastered(BLADEMASTER, state.classes.blademaster)).toBe(true);
    expect(grantClassXp(reg, state, slash, 1e9)).toEqual([]);
    expect(state.classes.blademaster.xp).toBe(0);
    expect(state.classes.sword_saint).toEqual({ rank: 1, xp: 0 });
  });
});

describe('the class tree is gone', () => {
  it('has no points and sells nothing, whatever the old data says', () => {
    expect(BLADEMASTER.tree?.length).toBeGreaterThan(0);
    expect(classPoints(BLADEMASTER, cp(9))).toBe(0);
    expect(spentPoints(BLADEMASTER, cp(9))).toBe(0);
    expect(canBuyNode(BLADEMASTER, cp(10), 'n1').ok).toBe(false);
  });
});

describe('imprints (unchanged until Phase 2)', () => {
  it('unlock at Class Level 5 for every class', () => {
    expect(CLASS.imprintAt).toBe(5);
    for (const c of [BLADEMASTER, SAINT, ASCENDANT]) {
      expect(imprintUnlocked(c, cp(4))).toBe(false);
      expect(imprintUnlocked(c, cp(5))).toBe(true);
    }
    expect(imprintUnlocked({ ...BLADEMASTER, imprint: undefined }, cp(10))).toBe(false);
  });

  it('open slots at the imprint level, first Tier II, first Tier III or 12 classes', () => {
    const tier = (t: ClassTier) => CLASSES.find((c) => c.tier === t)!.id;
    expect(imprintSlots(reg, stateWith({}))).toBe(0);
    expect(imprintSlots(reg, stateWith({}, { classes: { blademaster: cp(4) } }))).toBe(0);
    expect(imprintSlots(reg, stateWith({}, { classes: { blademaster: cp(5) } }))).toBe(1);
    expect(imprintSlots(reg, stateWith({}, { classes: { blademaster: cp(10), [tier(2)]: cp(1) } }))).toBe(2);
    expect(imprintSlots(reg, stateWith({}, { classes: { [tier(2)]: cp(6), [tier(3)]: cp(1) } }))).toBe(3);
    const many = Object.fromEntries(FILLERS.map((c) => [c.id, cp(1)]));
    expect(imprintSlots(reg, stateWith({}, { classes: many }))).toBe(3);
    // Classes unknown to the registry do not count.
    expect(imprintSlots(reg, stateWith({}, { classes: { ghost: cp(10) } }))).toBe(0);
  });
});

describe('worn class bonus (40% at Class Level 1 → 100% at 10)', () => {
  it('grows linearly with the Class Level', () => {
    expect(bonusShare(1)).toBeCloseTo(0.4, 10);
    expect(bonusShare(10)).toBe(1);
    expect(bonusShare(4)).toBeCloseTo(0.4 + 0.6 * (3 / 9), 10);
    for (let l = 2; l <= 10; l++) expect(bonusShare(l) - bonusShare(l - 1)).toBeCloseTo(0.6 / 9, 10);
    expect(bonusShare(0)).toBeCloseTo(0.4, 10);
    expect(bonusShare(99)).toBe(1);
    expect(classBonusAt(BLADEMASTER, 10)).toEqual(BLADEMASTER.bonus);
    expect(classBonusAt(BLADEMASTER, 1)).toEqual({ atk: 4, crit: 0.8, tagPower: { blade: 4, spin: 2 } });
  });

  it('sums tagPower over distinct skill tags', () => {
    const state = stateWith({}, { classes: { blademaster: cp(10) }, worn: 'blademaster' });
    expect(wornClass(reg, state)?.id).toBe('blademaster');
    expect(classTagPct(reg, state, reg.skill('whirlwind')!)).toBe(15);
    expect(classTagPct(reg, state, { tags: ['blade', 'blade'] })).toBe(10);
    expect(classTagPct(reg, state, reg.skill('orb')!)).toBe(0);
    state.classes.blademaster.rank = 1;
    expect(classTagPct(reg, state, reg.skill('whirlwind')!)).toBe(6);
  });

  it('returns stats without tagPower', () => {
    const state = stateWith({}, { classes: { blademaster: cp(10) }, worn: 'blademaster' });
    expect(classStatBonus(reg, state)).toEqual({ atk: 10, crit: 2 });
    state.classes.blademaster.rank = 1;
    expect(classStatBonus(reg, state)).toEqual({ atk: 4, crit: 0.8 });
  });

  it('is empty when nothing (discovered) is worn', () => {
    expect(classStatBonus(reg, stateWith({}))).toEqual({});
    const ghost = stateWith({}, { worn: 'blademaster' });
    expect(wornClass(reg, ghost)).toBeUndefined();
    expect(classTagPct(reg, ghost, reg.skill('slash')!)).toBe(0);
  });
});

// ------------------------------------------------------------------ v4 classes: kits, the level table, discovery, Trials

const HEAT: ClassMechanic = {
  kind: 'gauge',
  name: 'Heat',
  max: 10,
  fill: [{ on: 'hit', weapon: 'sword', amount: 1 }],
  decay: { afterMs: 3000, perSec: 2 },
  effects: [{ do: 'nextSkill', at: 'max', filter: { of: 'kit' }, boost: { sizePct: 100, hpCostPct: 5 } }],
  autoRule: { spend: 'atMax' },
};

const KIT = ['k_edge', 'k_cut', 'k_line', 'k_arc', 'k_heat'] as [string, string, string, string, string];

const EMBERBLADE: ClassDefV4 = {
  id: 'emberblade',
  name: 'Emberblade',
  icon: 'i',
  desc: 'Sword forms that breathe like a bellows.',
  hint: 'Carry the forge on an edge.',
  rarity: 'uncommon',
  weapon: 'sword',
  source: 'fire',
  mechanic: HEAT,
  mechanicUpgrade: { line: 'Heat holds 12.', mechanic: { ...HEAT, max: 12 } },
  kit: KIT,
  passive: 'banked_coals',
  discover: { requires: [{ type: 'element', id: 'fire' }, { type: 'flag', id: 'kills:sword:fire', min: 20 }] },
  bonus: { atk: 5, tagPower: { fire: 5 } },
  look: 'emberblade',
};

const WARDEN_KIT = ['w_slam', 'w_plant', 'w_cut', 'w_bulwark', 'w_shatter'] as [string, string, string, string, string];
const STONEWARDEN: ClassDefV4 = {
  id: 'stonewarden',
  name: 'Stonewarden',
  icon: 'i',
  desc: 'Carves runes into steel.',
  hint: 'Stone remembers.',
  rarity: 'rare',
  weapon: 'sword',
  source: 'earth',
  mechanic: { kind: 'combo', name: 'Cadence', length: 3, distinct: true, finisher: { name: 'Finisher', boost: { crit: true } }, autoRule: { spend: 'atMax' } },
  kit: WARDEN_KIT,
  discover: { requires: [{ type: 'flag', id: 'hits:sword', min: 60 }], trial: 'tamsin_trial_stonewarden' },
  bonus: {},
};

const kitSkill = (id: string, classOf: string, extra: Partial<SkillDef> = {}): SkillDef =>
  sk({ id, tags: ['blade'], weapons: ['sword'], classOf, ...extra });

const TRIAL: QuestDef = {
  id: 'tamsin_trial_stonewarden',
  name: 'Trial of Stone',
  giver: 'tamsin',
  summary: 'Prove it.',
  dialog: { offer: 'Ready?', progress: 'Go on.', complete: 'Done.' },
  objectives: [{ kind: 'use', tag: 'blade', count: 1 }],
  rewards: {},
  trialOf: 'stonewarden',
};

const V4: GameData = {
  ...DATA,
  elements: [...DATA.elements, el('earth', 'Earth')],
  skills: [
    ...DATA.skills,
    ...KIT.map((id) => kitSkill(id, 'emberblade', { element: 'fire' })),
    ...WARDEN_KIT.map((id) => kitSkill(id, 'stonewarden')),
    sk({ id: 'ember_dart', tags: ['arcane', 'spell'], weapons: undefined, element: 'fire', tier: 2 }),
    sk({ id: 'knife_fan', tags: ['pierce'], weapons: ['dagger'], tier: 3 }),
    sk({ id: 'flame_cut', tags: ['blade'], weapons: ['sword'], element: 'fire' }),
  ],
  classes: [...CLASSES, EMBERBLADE, STONEWARDEN],
  passives: [
    ...treePassives,
    { id: 'banked_coals', name: 'Banked Coals', icon: 'i', desc: 'Burns pop when they end.', source: 'class', maxRank: 1, budget: 3, effect: { kind: 'trigger', when: 'statusEnds', do: { burst: 0.3 } } },
  ],
  quests: [TRIAL],
};
const reg4 = new Registry(V4);

describe('v4 fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg4.validate()).toEqual([]);
  });
});

describe('the level table (SPEC-v4 §3.4)', () => {
  it('unlocks kit skills at levels 1 / 1 / 2 / 4 / 6', () => {
    expect(CLASS.kitAt).toEqual([1, 1, 2, 4, 6]);
    expect([1, 2, 3, 4, 5, 6, 10].map(kitUnlocked)).toEqual([2, 3, 3, 4, 4, 5, 5]);
    expect(kitSkillsAt(EMBERBLADE, 1)).toEqual(['k_edge', 'k_cut']);
    expect(kitSkillsAt(EMBERBLADE, 4)).toEqual(['k_edge', 'k_cut', 'k_line', 'k_arc']);
    expect(kitSkillsAt(EMBERBLADE, 6)).toEqual(KIT);
    expect(kitSkillsAt(BLADEMASTER, 10)).toEqual([]);
    expect(KIT.map((id) => kitLevelOf(EMBERBLADE, id))).toEqual([1, 1, 2, 4, 6]);
    expect(kitLevelOf(EMBERBLADE, 'slash')).toBeUndefined();
  });

  it('upgrades the mechanic at level 8', () => {
    expect(CLASS.mechanicUpgradeAt).toBe(8);
    expect(classMechanic(EMBERBLADE, 7)).toBe(HEAT);
    expect(classMechanic(EMBERBLADE, 8)).toMatchObject({ kind: 'gauge', max: 12 });
    expect(classMechanic(STONEWARDEN, 10)).toBe(STONEWARDEN.mechanic);
    expect(classMechanic(BLADEMASTER, 10)).toBeUndefined();
    const state = stateWith({}, { classes: { emberblade: cp(8) }, worn: 'emberblade' });
    expect(wornMechanic(reg4, state)).toMatchObject({ max: 12 });
  });

  it('masters at level 10, and only there', () => {
    expect(mastered(EMBERBLADE, cp(9))).toBe(false);
    expect(mastered(EMBERBLADE, cp(10))).toBe(true);
    expect(mastered(EMBERBLADE, undefined)).toBe(false);
  });

  it('a worn kit class gains XP from kit skills and from anything usable with its weapon, never otherwise', () => {
    const feeds = (id: string) => classFeeds(reg4, EMBERBLADE, reg4.skill(id)!);
    expect(feeds('k_edge')).toBe(true);
    expect(feeds('slash')).toBe(true); // sword-bound
    expect(feeds('ember_dart')).toBe(true); // free: works with a sword in hand
    expect(feeds('knife_fan')).toBe(false); // needs a dagger
    const state = stateWith({}, { classes: { emberblade: cp(1), blademaster: cp(1) }, worn: 'emberblade' });
    grantClassXp(reg4, state, reg4.skill('knife_fan')!, 100);
    expect(state.classes.emberblade.xp).toBe(0);
    grantClassXp(reg4, state, reg4.skill('ember_dart')!, 100);
    expect(state.classes.emberblade.xp).toBe(50);
    expect(state.classes.blademaster.xp).toBe(0); // not worn: nothing, though slash-like skills match it
  });
});

describe('kit-based class slots', () => {
  const known = (ids: string[], patch: Partial<SkillBookState> = {}) =>
    stateWith(Object.fromEntries(ids.map((id) => [id, 1])), { classes: { emberblade: cp(1) }, worn: 'emberblade', ...patch });

  it('holds the kit in kit order once every kit skill is known, whatever else is known', () => {
    const state = known([...KIT].reverse().concat(['whirlwind', 'flame_cut', 'ember_dart']));
    state.skills.whirlwind.rank = 10;
    expect(classSkills(reg4, state, EMBERBLADE)).toEqual(KIT);
  });

  it('fills the slots of kit skills not known yet with related skills, keeping kit positions', () => {
    const state = known(['k_edge', 'k_cut', 'whirlwind', 'flame_cut', 'ember_dart', 'knife_fan', 'slash']);
    // Slots 3 – 5: bound to the sword and of the class element first, then sword-bound, then the free fire spell.
    const picks = classSkills(reg4, state, EMBERBLADE);
    expect(picks.slice(0, 2)).toEqual(['k_edge', 'k_cut']);
    expect(picks[2]).toBe('flame_cut');
    expect(picks).toHaveLength(CLASS_SLOTS);
    expect(picks).not.toContain('knife_fan'); // needs a dagger
    expect(picks).not.toContain('slash'); // a basic attack never sits on the bar
  });

  it('a late kit skill takes its own slot back from the fill', () => {
    const state = known(['k_edge', 'k_cut', 'k_heat', 'whirlwind', 'flame_cut', 'ember_dart']);
    const picks = classSkills(reg4, state, EMBERBLADE);
    expect(picks[4]).toBe('k_heat');
    expect(picks.slice(2, 4)).toEqual(['flame_cut', 'whirlwind']); // sword + fire, then sword; the free fire spell waits
    state.skills.k_line = prog('k_line', 1);
    expect(classSkills(reg4, state, EMBERBLADE)[2]).toBe('k_line');
  });

  it("never fills with another class's own skill, and returns fewer than 5 when nothing usable is known", () => {
    const state = known(['k_edge', 'w_slam', 'knife_fan']);
    expect(classSkills(reg4, state, EMBERBLADE)).toEqual(['k_edge']);
  });

  it('appends spare fills when asked for more than the class slots', () => {
    const state = known([...KIT, 'whirlwind', 'flame_cut', 'ember_dart', 'knife_fan']);
    const all = classSkills(reg4, state, EMBERBLADE, Infinity);
    expect(all.slice(0, 5)).toEqual(KIT);
    expect(new Set(all.slice(5))).toEqual(new Set(['whirlwind', 'flame_cut', 'ember_dart']));
  });

  it('classSkillFit: kit skills match, usable skills are fills, the rest is nothing', () => {
    const fit = (id: string) => classSkillFit(reg4, EMBERBLADE, reg4.skill(id)!);
    expect(fit('k_heat')).toBe('match');
    expect(fit('whirlwind')).toBe('related');
    expect(fit('ember_dart')).toBe('related');
    expect(fit('knife_fan')).toBeNull();
    expect(fit('w_slam')).toBeNull();
  });

  it('class skills sit only in their own class slots', () => {
    expect(ownSlotEligible(reg4.skill('k_edge')!)).toBe(false);
    expect(ownSlotEligible(reg4.skill('whirlwind')!)).toBe(true);
    expect(ownSlotEligible(reg4.skill('slash')!)).toBe(false);
    expect(classSlotEligible(EMBERBLADE, reg4.skill('k_edge')!)).toBe(true);
    expect(classSlotEligible(STONEWARDEN, reg4.skill('k_edge')!)).toBe(false);
    // A v2 class never takes a class skill either.
    expect(classSkillFit(reg4, BLADEMASTER, reg4.skill('k_edge')!)).toBeNull();
  });

  it('a class without a kit keeps the relevance pick', () => {
    const state = stateWith({ whirlwind: 3, throw: 2, cleave: 1, searing: 1, orb: 5 }, { classes: { blademaster: cp(1) }, worn: 'blademaster' });
    const picks = classSkills(reg4, state, BLADEMASTER);
    expect(new Set(picks)).toEqual(new Set(['whirlwind', 'throw', 'cleave', 'searing']));
  });
});

describe('discovery by ClassDiscovery', () => {
  const ctx4 = (state: SkillBookState): RequirementContext => ({
    ...ctxOf(state, reg4),
    questDone: (id) => state.quests?.done[id] ?? 0,
    deed: (id) => state.deeds[id] ?? 0,
  });

  it('needs every requirement, shows them as progress, and ignores v2 patterns', () => {
    const state = stateWith({}, { flags: { 'kills:sword:fire': 20 } });
    expect(discoverableNow(reg4, state, EMBERBLADE, ctx4(state))).toBe(false);
    const half = classProgress(reg4, state, EMBERBLADE, ctx4(state));
    expect(half).toMatchObject({ discovered: false, progress: 0.5, clauses: [], codex: 'near' });
    expect(half.requires?.map((r) => r.ok)).toEqual([false, true]);
    state.elements.fire = { source: 'test', learnedAt: 0 };
    expect(discoverableNow(reg4, state, EMBERBLADE, ctx4(state))).toBe(true);
    state.classes.emberblade = cp(1);
    expect(discoverableNow(reg4, state, EMBERBLADE, ctx4(state))).toBe(false);
    expect(classProgress(reg4, state, EMBERBLADE, ctx4(state))).toMatchObject({ discovered: true, progress: 1, codex: 'known' });
  });

  it('a Trial class waits for its quest: "Trial ready", then unlocked when the Trial is finished', () => {
    const state = stateWith({});
    expect(trialReady(state, STONEWARDEN, ctx4(state))).toBe(false);
    state.flags['hits:sword'] = 60;
    expect(trialReady(state, STONEWARDEN, ctx4(state))).toBe(true);
    expect(discoverableNow(reg4, state, STONEWARDEN, ctx4(state))).toBe(false);
    expect(classProgress(reg4, state, STONEWARDEN, ctx4(state)).trial).toEqual({ quest: TRIAL.id, ready: true, done: false });
    state.quests!.done[TRIAL.id] = 1;
    expect(trialReady(state, STONEWARDEN, ctx4(state))).toBe(false);
    expect(discoverableNow(reg4, state, STONEWARDEN, ctx4(state))).toBe(true);
    expect(trialReady(state, EMBERBLADE, ctx4(state))).toBe(false); // no Trial at all
  });

  it('reads deeds and finished quests as requirements', () => {
    const state = stateWith({});
    const ctx = ctx4(state);
    const book = new SkillBook(reg4);
    expect(book.meets({ type: 'deed', id: 'fallen', tier: 2 })).toBe(false);
    state.deeds.fallen = 2;
    expect(ctx.deed?.('fallen')).toBe(2);
    book.state.deeds.fallen = 2;
    expect(book.meets({ type: 'deed', id: 'fallen', tier: 2 })).toBe(true);
    expect(book.meets({ type: 'deed', id: 'fallen', tier: 3 })).toBe(false);
    expect(book.meets({ type: 'quest', id: TRIAL.id })).toBe(false);
    expect(book.describe({ type: 'quest', id: TRIAL.id })).toBe('Finish Trial of Stone');
    expect(book.describe({ type: 'class', id: 'emberblade', rank: 10 })).toBe('Master Emberblade');
  });
});

describe('SkillBook: v4 classes end to end', () => {
  function emberBook(): SkillBook {
    const book = new SkillBook(reg4);
    book.learn('slash', 'start');
    book.learnElement('fire', 'test');
    return book;
  }

  it('discovers by requirements, wears the class and learns kit skills 1 and 2', () => {
    const book = emberBook();
    const learned: string[] = [];
    book.events.on('learned', (e) => learned.push(`${e.skill.id}<${e.source}`));
    expect(book.state.classes.emberblade).toBeUndefined();
    book.incFlag('kills:sword:fire', 20);
    expect(book.state.classes.emberblade).toEqual({ rank: 1, xp: 0 });
    expect(book.state.worn).toBe('emberblade');
    expect(learned).toEqual(['k_edge<class:emberblade', 'k_cut<class:emberblade']);
    expect(book.kitSkills('emberblade')).toEqual(['k_edge', 'k_cut']);
    expect(book.classSkills('emberblade')).toEqual(['k_edge', 'k_cut']);
    expect(book.mechanic()).toBe(HEAT);
    expect(book.passives().map((p) => [p.def.id, p.source])).toContainEqual(['banked_coals', 'class']);
    expect(book.totals().triggers).toEqual([{ id: 'banked_coals', source: 'class', when: 'statusEnds', do: { burst: 0.3 } }]);
  });

  it('levels only while worn, learns the kit as it goes, upgrades at 8 and masters at 10', () => {
    const book = emberBook();
    book.incFlag('kills:sword:fire', 20);
    const levels: number[] = [];
    const masteredIds: string[] = [];
    book.events.on('classRank', (e) => levels.push(e.rank));
    book.events.on('classMastered', (e) => masteredIds.push(e.cls.id));
    const bonusAt1 = book.activeBonus().atk;
    expect(bonusAt1).toBe(2); // 40% of 5
    while (book.state.classes.emberblade.rank < 2) book.addMastery('slash', 10);
    expect(book.has('k_line')).toBe(true);
    expect(book.has('k_arc')).toBe(false);
    while (book.state.classes.emberblade.rank < 6) book.addMastery('slash', 50);
    expect(KIT.every((id) => book.has(id))).toBe(true);
    expect(book.classSkills('emberblade')).toEqual(KIT);
    while (book.state.classes.emberblade.rank < 8) book.addMastery('slash', 50);
    expect(book.mechanic()).toMatchObject({ max: 12 });
    expect(masteredIds).toEqual([]);
    while (book.state.classes.emberblade.rank < 10) book.addMastery('slash', 50);
    expect(levels).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(masteredIds).toEqual(['emberblade']);
    expect(book.isMastered('emberblade')).toBe(true);
    expect(book.activeBonus().atk).toBe(5);
    expect(book.tagPowerFor(reg4.skill('k_edge')!)).toBe(5);

    // Unworn: no XP at all.
    book.unwear();
    const before = JSON.stringify(book.state.classes);
    book.addMastery('slash', 500);
    expect(JSON.stringify(book.state.classes)).toBe(before);
  });

  it('announces a ready Trial once, offers the quest only then, and unlocks the class when it is finished', () => {
    const book = new SkillBook(reg4);
    book.learn('slash', 'start');
    const ready: string[] = [];
    book.events.on('trialReady', (e) => ready.push(`${e.cls.id}:${e.quest}`));
    expect(book.questStatus(TRIAL.id)).toBe('locked');
    book.incFlag('hits:sword', 60);
    expect(ready).toEqual(['stonewarden:tamsin_trial_stonewarden']);
    expect(book.trialReady('stonewarden')).toBe(true);
    book.incFlag('hits:sword', 1);
    expect(ready).toHaveLength(1);
    expect(book.questStatus(TRIAL.id)).toBe('available');
    expect(book.acceptQuest(TRIAL.id).ok).toBe(true);
    book.notifyQuest({ type: 'use', skill: reg4.skill('slash')! });
    expect(book.turnInQuest(TRIAL.id).ok).toBe(true);
    expect(book.state.classes.stonewarden).toEqual({ rank: 1, xp: 0 });
    expect(book.has('w_slam') && book.has('w_plant')).toBe(true);
    expect(book.trialReady('stonewarden')).toBe(false);
  });

  it('keeps the old SkillBook class API working', () => {
    const book = emberBook();
    book.incFlag('kills:sword:fire', 20);
    expect(book.buyNode('emberblade', 'n1').ok).toBe(false);
    expect(book.respec('emberblade').ok).toBe(false);
    expect(book.wear('emberblade')).toMatchObject({ ok: true });
    expect(book.imprintSlots()).toBe(0);
    expect(book.setImprints([]).ok).toBe(true);
    expect(book.classProgress(EMBERBLADE).discovered).toBe(true);
  });
});
