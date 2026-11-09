import { describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import {
  CLASS,
  HARDENED_RANK,
  IMPRINT_THIRD_SLOT_CLASSES,
  buyNode,
  canBuyNode,
  classMatchesSkill,
  classMaxRank,
  classPoints,
  classProgress,
  classStatBonus,
  classTagPct,
  classXpToNext,
  clauseCount,
  discoverableNow,
  grantClassXp,
  imprintSlots,
  imprintUnlocked,
  respec,
  spentPoints,
  wornClass,
} from '../src/core/classes';
import { Registry } from '../src/core/registry';
import { VISITED_FLAG_PREFIX, countTagged, type RequirementContext } from '../src/core/requirements';
import { emptyState, type ClassProgress, type SkillBookState, type SkillProgress } from '../src/core/state';
import type { ClassDef, ClassTier, ElementDef, ElementId, GameData, PassiveDef, SkillDef } from '../src/core/types';
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

const cp = (rank: number, spent: Record<string, number> = {}, xp = 0): ClassProgress => ({ rank, xp, spent });

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

describe('Class Rank curve', () => {
  it('follows round(60 × 1.22^(rank-1) × tier mult)', () => {
    expect(classXpToNext(1, 1)).toBe(60);
    expect(classXpToNext(2, 1)).toBe(73);
    expect(classXpToNext(5, 1)).toBe(Math.round(60 * 1.22 ** 4));
    expect(classXpToNext(1, 2)).toBe(108);
    expect(classXpToNext(1, 3)).toBe(180);
  });

  it('caps ranks by tier', () => {
    expect(classMaxRank(BLADEMASTER)).toBe(10);
    expect(classMaxRank(SAINT)).toBe(8);
    expect(classMaxRank(ASCENDANT)).toBe(5);
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
    c.clauses.length > 0 || !!c.distinctElements || !!c.parents?.length || !!c.requires?.length;

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
        classes: Object.fromEntries(Object.entries(classes).filter(([id]) => real.classDef(id)!.tier < 3)),
        flags: { relic_storm: 1, relic_dusk: 1, [VISITED_FLAG_PREFIX + 'vale.moonlit_glade']: 1 },
      }),
    ];
    expect(expectAgreement(real, states)).toBeGreaterThan(0);
  });
});

describe('hardened distinct elements', () => {
  const real = createRegistry();
  const prism = real.classDef('prism_sage')!;
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

describe('grantClassXp', () => {
  const slash = reg.skill('slash')!;
  const orb = reg.skill('orb')!;

  it('gives the worn class 50% and other matching classes 15%', () => {
    const state = stateWith(
      {},
      { classes: { blademaster: cp(1), sword_saint: cp(1), stalker: cp(1), prism: cp(1) }, worn: 'blademaster' },
    );
    expect(grantClassXp(reg, state, slash, 20)).toEqual([]);
    expect(state.classes.blademaster.xp).toBeCloseTo(10, 10);
    expect(state.classes.sword_saint.xp).toBeCloseTo(3, 10);
    expect(state.classes.stalker.xp).toBe(0); // slash has no stealth / fire
    expect(state.classes.prism.xp).toBe(0); // slash is unaligned
  });

  it('gives the worn class nothing for a non-matching skill', () => {
    const state = stateWith({}, { classes: { blademaster: cp(1) }, worn: 'blademaster' });
    grantClassXp(reg, state, orb, 100);
    expect(state.classes.blademaster.xp).toBe(0);
  });

  it('ignores undiscovered worn ids and bad XP', () => {
    const state = stateWith({}, { classes: { sword_saint: cp(1) }, worn: 'blademaster' });
    grantClassXp(reg, state, slash, 100);
    expect(state.classes.sword_saint.xp).toBeCloseTo(15, 10);
    expect(grantClassXp(reg, state, slash, -5)).toEqual([]);
    expect(grantClassXp(reg, state, slash, Number.NaN)).toEqual([]);
    expect(state.classes.sword_saint.xp).toBeCloseTo(15, 10);
  });

  it('reports every rank gained, worn class first, and stops at max rank', () => {
    const state = stateWith({}, { classes: { sword_saint: cp(1), blademaster: cp(1) }, worn: 'blademaster' });
    // 60 + 73 = 133 for CR 3 at 50% → 266 XP; the rest carries over.
    const ups = grantClassXp(reg, state, slash, 270);
    expect(ups.map((u) => [u.cls.id, u.rank])).toEqual([['blademaster', 2], ['blademaster', 3]]);
    expect(state.classes.blademaster.xp).toBeCloseTo(135 - 133, 10);
    expect(state.classes.sword_saint.rank).toBe(1);

    const capped = grantClassXp(reg, state, slash, 1e9);
    const worn = capped.filter((u) => u.cls.id === 'blademaster');
    expect(worn.map((u) => u.rank)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    expect(capped.indexOf(worn[6])).toBe(6);
    expect(capped.filter((u) => u.cls.id === 'sword_saint').at(-1)?.rank).toBe(CLASS.maxRank[2]);
    expect(state.classes.blademaster).toMatchObject({ rank: 10, xp: 0 });
    expect(grantClassXp(reg, state, slash, 1e9).filter((u) => u.cls.id === 'blademaster')).toEqual([]);
    expect(state.classes.blademaster.xp).toBe(0);
  });
});

describe('class tree', () => {
  it('derives points from rank × tier minus spent costs', () => {
    expect(classPoints(BLADEMASTER, cp(4))).toBe(4);
    expect(classPoints(SAINT, cp(4))).toBe(8);
    expect(spentPoints(BLADEMASTER, cp(9, { n1: 3, cap: 1, ghost: 5 }))).toBe(6);
    expect(classPoints(BLADEMASTER, cp(9, { n1: 3, cap: 1 }))).toBe(3);
  });

  it('enforces existence, max rank, prerequisites, minSpent and points', () => {
    const p = cp(2);
    expect(canBuyNode(BLADEMASTER, p, 'nope')).toMatchObject({ ok: false });
    expect(canBuyNode(BLADEMASTER, p, 'n3')).toEqual({ ok: false, reason: 'Requires node n1 at rank 1.' });
    expect(canBuyNode(BLADEMASTER, p, 'cap')).toEqual({
      ok: false,
      reason: 'Spend 6 points in the blademaster tree first.',
    });
    expect(buyNode(BLADEMASTER, p, 'n1')).toEqual({ ok: true });
    expect(buyNode(BLADEMASTER, p, 'n3')).toEqual({ ok: true });
    expect(p.spent).toEqual({ n1: 1, n3: 1 });
    expect(classPoints(BLADEMASTER, p)).toBe(0);
    expect(buyNode(BLADEMASTER, p, 'n1')).toEqual({ ok: false, reason: 'Needs 1 point (0 available).' });
    expect(p.spent).toEqual({ n1: 1, n3: 1 });

    const rich = cp(10, { n1: 3 });
    expect(canBuyNode(BLADEMASTER, rich, 'n1')).toEqual({ ok: false, reason: 'Already at max rank.' });
    rich.spent.n2 = 3;
    expect(canBuyNode(BLADEMASTER, rich, 'cap')).toEqual({ ok: true });
    rich.rank = 8; // 8 points, 6 spent, cap costs 3
    expect(canBuyNode(BLADEMASTER, rich, 'cap')).toEqual({ ok: false, reason: 'Needs 3 points (2 available).' });
  });

  it('respec refunds everything', () => {
    const p = cp(10, { n1: 3, n2: 3, cap: 1 });
    respec(p);
    expect(p.spent).toEqual({});
    expect(classPoints(BLADEMASTER, p)).toBe(10);
    // Without the class, even a skill node id is refunded (the v1 behaviour).
    const q = cp(5, { n1: 1, n2: 2, n5: 1 });
    respec(q);
    expect(q.spent).toEqual({});
  });

  it('respec with the class keeps skill nodes bought (their skill is kept)', () => {
    const real = createRegistry();
    const assassin = real.classDef('assassin')!;
    expect(assassin.tree?.find((n) => n.id === 'n5')).toMatchObject({ kind: 'skill', ref: 'shade_cloak', cost: 2 });
    const p = cp(5, { n1: 1, n2: 2, n5: 1, cap: 0 });
    respec(p, assassin);
    expect(p.spent).toEqual({ n5: 1 });
    expect(classPoints(assassin, p)).toBe(5 * assassin.tier - 2);
    // A class without a skill node refunds everything.
    const q = cp(10, { n1: 3, n2: 3, cap: 1 });
    respec(q, BLADEMASTER);
    expect(q.spent).toEqual({});
  });
});

describe('imprints', () => {
  it('unlock at CR 5 / 4 / 3 by tier', () => {
    expect(imprintUnlocked(BLADEMASTER, cp(4))).toBe(false);
    expect(imprintUnlocked(BLADEMASTER, cp(5))).toBe(true);
    expect(imprintUnlocked(SAINT, cp(4))).toBe(true);
    expect(imprintUnlocked(ASCENDANT, cp(3))).toBe(true);
    expect(imprintUnlocked({ ...BLADEMASTER, imprint: undefined }, cp(10))).toBe(false);
  });

  it('open slots at imprint CR, first Tier II, first Tier III or 12 classes', () => {
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

describe('worn class bonus', () => {
  it('sums tagPower over distinct skill tags', () => {
    const state = stateWith({}, { classes: { blademaster: cp(1) }, worn: 'blademaster' });
    expect(wornClass(reg, state)?.id).toBe('blademaster');
    expect(classTagPct(reg, state, reg.skill('whirlwind')!)).toBe(15);
    expect(classTagPct(reg, state, { tags: ['blade', 'blade'] })).toBe(10);
    expect(classTagPct(reg, state, reg.skill('orb')!)).toBe(0);
  });

  it('returns stats without tagPower', () => {
    const state = stateWith({}, { classes: { blademaster: cp(1) }, worn: 'blademaster' });
    expect(classStatBonus(reg, state)).toEqual({ atk: 10, crit: 2 });
  });

  it('is empty when nothing (discovered) is worn', () => {
    expect(classStatBonus(reg, stateWith({}))).toEqual({});
    const ghost = stateWith({}, { worn: 'blademaster' });
    expect(wornClass(reg, ghost)).toBeUndefined();
    expect(classTagPct(reg, ghost, reg.skill('slash')!)).toBe(0);
  });
});
