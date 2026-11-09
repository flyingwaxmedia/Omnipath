import { describe, expect, it } from 'vitest';
import { classTreeTemplate } from '../src/core/balance';
import {
  BESTIARY_BONUS,
  IMPRINT_STRENGTH,
  PASSIVE_CAPS,
  TAG_PASSIVE_TAGS,
  activePassives,
  aggregate,
  bestiaryFamilyPct,
  bestiaryHpPct,
  cooldownPctFor,
  masteryXpPct,
  powerPctFor,
  regenStillPct,
  spCostPctFor,
  statPct,
  tagPassiveId,
  tagPassiveRank,
  tagPassiveTotalFor,
  tagTotals,
  vsFamilyPct,
  vsStatusPct,
} from '../src/core/passives';
import { Registry } from '../src/core/registry';
import { emptyState, type SkillBookState, type SkillProgress } from '../src/core/state';
import type { ClassDef, ClassTier, ElementDef, Family, GameData, MonsterDef, PassiveDef, PassiveEffect, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const FIRE: ElementDef = {
  id: 'fire',
  name: 'Fire',
  prefix: 'Blazing',
  icon: 'i_fire',
  color: 0,
  tier: 0,
  desc: 'Fire.',
  status: 'burn',
  strongVs: [],
};

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

const passive = (id: string, source: PassiveDef['source'], effect: PassiveEffect, maxRank = 3, tag?: string): PassiveDef => ({
  id,
  name: id,
  icon: `i_${id}`,
  desc: '',
  source,
  maxRank,
  effect,
  ...(tag ? { tag } : {}),
});

const monster = (id: string, family: Family): MonsterDef => ({
  id,
  name: id,
  level: 3,
  hp: 50,
  atk: 5,
  def: 1,
  family,
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
});

/** A class with a templated tree + imprint (classTreeTemplate), returning its passives too. */
function templated(id: string, tier: ClassTier, tag: string, extra: Partial<ClassDef> = {}): { cls: ClassDef; passives: PassiveDef[] } {
  const t = classTreeTemplate({ classId: id, className: id, tier, tag, stat: 'atk', icon: 'i' });
  return {
    cls: {
      id,
      name: id,
      icon: 'i',
      desc: '',
      hint: '',
      tier,
      clauses: [{ tags: [tag], count: 2 }],
      bonus: {},
      tree: t.nodes,
      imprint: t.imprint.id,
      ...extra,
    },
    passives: [...t.passives, t.imprint],
  };
}

const BLADEMASTER = templated('blademaster', 1, 'blade', { bonus: { atk: 10, tagPower: { blade: 10, fire: 5 } } });
const ARCANIST = templated('arcanist', 1, 'arcane');
const ARCHMAGE = templated('archmage', 2, 'arcane', { parents: [{ id: 'arcanist', rank: 10 }] });

const SPRITES = Array.from({ length: 12 }, (_, i) => monster(`sprite_${i}`, 'sprite'));

/** Extra blade/melee/spin skills so a save can push those tag totals to rank 5. */
const DRILLS = Array.from({ length: 5 }, (_, i) =>
  sk({ id: `drill_${i}`, tags: ['blade', 'melee', 'spin'], shape: { kind: 'spin', radius: 50 } }),
);

const DATA: GameData = {
  dataVersion: 2,
  elements: [FIRE],
  skills: [
    sk({ id: 'slash', tier: 0, tags: ['blade', 'melee', 'basic'] }),
    sk({ id: 'whirlwind', tags: ['blade', 'spin', 'melee'], shape: { kind: 'spin', radius: 60 } }),
    sk({ id: 'cleave', tags: ['blade', 'heavy', 'melee'] }),
    sk({ id: 'orb', weapons: ['staff'], tags: ['arcane', 'projectile'], shape: { kind: 'projectile', speed: 300, range: 300 } }),
    sk({ id: 'palm', weapons: undefined, tags: ['spirit', 'melee'] }),
    ...DRILLS,
  ],
  morphs: [],
  recipes: [],
  classes: [BLADEMASTER.cls, ARCANIST.cls, ARCHMAGE.cls],
  essences: [],
  passives: [
    // `tag_heavy` is deliberately absent: tag passives only exist where content authors them.
    passive('tag_blade', 'tag', { kind: 'power', tag: 'blade', pct: 3 }, 5, 'blade'),
    passive('tag_melee', 'tag', { kind: 'power', tag: 'melee', pct: 3 }, 5, 'melee'),
    passive('tag_spin', 'tag', { kind: 'power', tag: 'spin', pct: 3 }, 5, 'spin'),
    passive('tag_spirit', 'tag', { kind: 'regenStill', pct: 15 }, 5, 'spirit'),
    passive('forgehand', 'trainer', { kind: 'stat', stat: 'atk', pct: 3 }),
    passive('devotion', 'trainer', { kind: 'stat', stat: 'sp', pct: 5 }),
    passive('patience', 'trainer', { kind: 'regenStill', pct: 20 }),
    passive('still_mind', 'trainer', { kind: 'masteryXp', pct: 5 }),
    passive('echo_ear', 'trainer', { kind: 'masteryXp', tag: 'echo', pct: 6 }),
    passive('thrift', 'trainer', { kind: 'spCost', pct: -20 }),
    passive('haste', 'trainer', { kind: 'cooldown', tag: 'blade', pct: -30 }),
    passive('sprite_bane', 'trainer', { kind: 'vsFamily', family: 'sprite', pct: 4 }),
    passive('res_fire_wind', 'resonance', { kind: 'vsStatus', element: 'wind', status: 'burn', pct: 15 }, 1),
    passive('res_any_burn', 'resonance', { kind: 'vsStatus', status: 'burn', pct: 5 }, 1),
    passive('res_earth_wind', 'resonance', { kind: 'power', tag: 'spin', pct: 8 }, 1),
    passive('big_power', 'trainer', { kind: 'power', pct: 10 }),
    ...BLADEMASTER.passives,
    ...ARCANIST.passives,
    ...ARCHMAGE.passives,
  ],
  trainers: [],
  monsters: SPRITES,
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

// ------------------------------------------------------------------ tests

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('tag passive curve', () => {
  it('unlocks at 15 and ranks up every 8, capped at 5', () => {
    expect(tagPassiveRank(0)).toBe(0);
    expect(tagPassiveRank(14)).toBe(0);
    expect(tagPassiveRank(15)).toBe(1);
    expect(tagPassiveRank(22)).toBe(1);
    expect(tagPassiveRank(23)).toBe(2);
    expect(tagPassiveRank(46)).toBe(4);
    expect(tagPassiveRank(47)).toBe(5);
    expect(tagPassiveRank(500)).toBe(5);
  });

  it('reports the total each rank needs', () => {
    expect([1, 2, 3, 4, 5].map(tagPassiveTotalFor)).toEqual([15, 23, 31, 39, 47]);
    for (let r = 1; r <= 5; r++) {
      expect(tagPassiveRank(tagPassiveTotalFor(r))).toBe(r);
      expect(tagPassiveRank(tagPassiveTotalFor(r) - 1)).toBe(r - 1);
    }
  });

  it('uses tag_<tag> passive ids', () => {
    expect(tagPassiveId('blade')).toBe('tag_blade');
    expect(TAG_PASSIVE_TAGS).toHaveLength(12);
  });
});

describe('tagTotals', () => {
  it('sums distinct authored skills, a variant counting toward its base at the max rank', () => {
    const totals = tagTotals(reg, stateWith({ slash: 6, 'slash@fire': 8, whirlwind: 7 }).skills);
    // slash and slash@fire are one authored skill (max 8), plus whirlwind 7.
    expect(totals.blade).toBe(15);
    expect(totals.melee).toBe(15);
    expect(totals.spin).toBe(7);
    expect(totals.arcane).toBe(0);
    expect(Object.keys(totals).sort()).toEqual([...TAG_PASSIVE_TAGS].sort());
  });

  it('ignores unknown skill ids', () => {
    expect(tagTotals(reg, stateWith({ nope: 10 }).skills).blade).toBe(0);
  });
});

describe('activePassives', () => {
  it('derives tag passives from totals, only for authored tag_ defs', () => {
    const state = stateWith({ slash: 10, whirlwind: 10, cleave: 10 });
    const tags = activePassives(reg, state).filter((p) => p.source === 'tag');
    // blade = melee = 30 → rank 2; heavy = 10 → rank 0 (and has no def anyway); spin 10 → 0.
    expect(tags.map((p) => [p.def.id, p.rank, p.strength])).toEqual([
      ['tag_blade', 2, 1],
      ['tag_melee', 2, 1],
    ]);
  });

  it('includes learned passives clamped to maxRank and skips unknown or derived ids', () => {
    const state = stateWith({}, { passives: { forgehand: 9, res_fire_wind: 1, ghost: 2, tag_blade: 5, cls_blademaster_1: 3, devotion: 0 } });
    const learned = activePassives(reg, state);
    expect(learned.map((p) => [p.def.id, p.rank, p.source])).toEqual([
      ['forgehand', 3, 'learned'],
      ['res_fire_wind', 1, 'learned'],
    ]);
  });

  it('activates bought nodes of the worn class tree only', () => {
    const state = stateWith(
      {},
      {
        classes: {
          blademaster: { rank: 6, xp: 0, spent: { n1: 2, n2: 0, n3: 1, cap: 1, ghost: 3 } },
          arcanist: { rank: 6, xp: 0, spent: { n1: 3 } },
        },
        worn: 'blademaster',
      },
    );
    const cls = activePassives(reg, state).filter((p) => p.source === 'class');
    expect(cls.map((p) => [p.def.id, p.rank])).toEqual([
      ['cls_blademaster_1', 2],
      ['cls_blademaster_3', 1],
      ['cls_blademaster_5', 1],
    ]);
  });

  it('ignores a worn class that is not discovered', () => {
    const state = stateWith({}, { classes: {}, worn: 'blademaster' });
    expect(activePassives(reg, state)).toEqual([]);
  });

  it('slots unlocked imprints of non-worn classes with tier strength', () => {
    const state = stateWith(
      {},
      {
        classes: {
          blademaster: { rank: 5, xp: 0, spent: {} },
          arcanist: { rank: 10, xp: 0, spent: {} },
          archmage: { rank: 4, xp: 0, spent: {} },
        },
        worn: 'blademaster',
        imprints: ['blademaster', 'archmage'],
      },
    );
    // Tier II discovered → 2 slots; blademaster is worn so its slotted imprint is inactive.
    const imprints = activePassives(reg, state).filter((p) => p.source === 'imprint');
    expect(imprints.map((p) => [p.def.id, p.rank, p.strength])).toEqual([['imprint_archmage', 1, IMPRINT_STRENGTH[2]]]);
    expect(IMPRINT_STRENGTH[2]).toBe(0.6);

    state.worn = 'arcanist';
    const again = activePassives(reg, state).filter((p) => p.source === 'imprint');
    expect(again.map((p) => [p.def.id, p.strength])).toEqual([
      ['imprint_blademaster', 1],
      ['imprint_archmage', 0.6],
    ]);
  });

  it('skips locked, undiscovered, duplicate and over-slot imprints', () => {
    const state = stateWith(
      {},
      {
        classes: { blademaster: { rank: 5, xp: 0, spent: {} }, arcanist: { rank: 4, xp: 0, spent: {} } },
        worn: null,
        imprints: ['blademaster', 'blademaster', 'arcanist', 'archmage'],
      },
    );
    // 1 slot (a class at imprint CR, no Tier II): only the first entry can be active.
    expect(activePassives(reg, state).map((p) => p.def.id)).toEqual(['imprint_blademaster']);
    state.imprints = ['arcanist'];
    expect(activePassives(reg, state)).toEqual([]);
  });
});

describe('bestiary', () => {
  it('gives +1% per species at 25 kills, capped at 10 per family', () => {
    const some = stateWith({}, { bestiary: { sprite_0: 25, sprite_1: 24, sprite_2: 100, wolf: 500 } });
    expect(bestiaryFamilyPct(reg, some)).toEqual({ sprite: 2 });
    const all = stateWith({}, { bestiary: Object.fromEntries(SPRITES.map((m) => [m.id, 30])) });
    expect(bestiaryFamilyPct(reg, all)).toEqual({ sprite: BESTIARY_BONUS.familyCap });
  });

  it('gives +1% max HP per species at 100 kills, capped at 10', () => {
    expect(bestiaryHpPct(reg, stateWith({}, { bestiary: { sprite_0: 100, sprite_1: 99, wolf: 1000 } }))).toBe(1);
    const all = stateWith({}, { bestiary: Object.fromEntries(SPRITES.map((m) => [m.id, 100])) });
    expect(bestiaryHpPct(reg, all)).toBe(BESTIARY_BONUS.hpCap);
  });
});

describe('aggregate and readers', () => {
  const blade = reg.skill('slash')!;
  const spinner = reg.skill('whirlwind')!;
  const orb = reg.skill('orb')!;

  it('starts empty', () => {
    const t = aggregate(reg, emptyState());
    expect(powerPctFor(t, blade)).toBe(0);
    expect(spCostPctFor(t, blade)).toBe(0);
    expect(cooldownPctFor(t, blade)).toBe(0);
    expect(statPct(t, 'atk')).toBe(0);
    expect(vsFamilyPct(t, 'sprite')).toBe(0);
    expect(vsStatusPct(t, 'fire', ['burn'])).toBe(0);
    expect(masteryXpPct(t, blade)).toBe(0);
    expect(regenStillPct(t)).toBe(0);
  });

  it('scales effects by rank and applies tag passives per matching tag', () => {
    // blade 30 → rank 2 (+6), melee 30 → rank 2 (+6), spin 10 → rank 0.
    const t = aggregate(reg, stateWith({ slash: 10, whirlwind: 10, cleave: 10 }));
    expect(powerPctFor(t, blade)).toBe(12);
    expect(powerPctFor(t, orb)).toBe(0);
  });

  it('caps tag-passive power at 25% per skill', () => {
    // Every blade/melee/spin skill at max rank: blade, melee and spin each reach rank 5 (+15).
    const ranks: Record<string, number> = { slash: 10, whirlwind: 10, cleave: 10 };
    for (const d of DRILLS) ranks[d.id] = 10;
    const state = stateWith(ranks);
    const t = aggregate(reg, state);
    expect(t.tagPower.byTag).toEqual({ blade: 15, melee: 15, spin: 15 });
    expect(powerPctFor(t, blade)).toBe(PASSIVE_CAPS.tagPower);
    expect(powerPctFor(t, spinner)).toBe(PASSIVE_CAPS.tagPower);
    // A non-tag source still stacks on top of the capped tag part.
    state.passives = { res_earth_wind: 1 };
    expect(powerPctFor(aggregate(reg, state), spinner)).toBe(PASSIVE_CAPS.tagPower + 8);
  });

  it('includes the worn class tagPower bonus and caps everything at 45%', () => {
    const state = stateWith(
      { slash: 10, whirlwind: 10, cleave: 10 },
      {
        passives: { big_power: 3 },
        classes: { blademaster: { rank: 10, xp: 0, spent: { n1: 3 } } },
        worn: 'blademaster',
      },
    );
    const t = aggregate(reg, state);
    expect(t.classTagPower).toEqual({ blade: 10, fire: 5 });
    // tag 12 + big_power 30 + tree n1 (+3 blade × 3) 9 + class blade 10 = 61 → 45.
    expect(powerPctFor(t, blade)).toBe(PASSIVE_CAPS.power);
    // orb: big_power 30 only.
    expect(powerPctFor(t, orb)).toBe(30);
    // The class bonus counts each matching tag once.
    const fireBlade = reg.skill('slash@fire')!;
    state.passives = {};
    state.classes.blademaster.spent = {};
    expect(powerPctFor(aggregate(reg, state), fireBlade)).toBe(12 + 10 + 5);
  });

  it('applies imprint strength to the effect', () => {
    const state = stateWith(
      {},
      {
        classes: { arcanist: { rank: 10, xp: 0, spent: {} }, archmage: { rank: 4, xp: 0, spent: {} } },
        worn: 'arcanist',
        imprints: ['archmage'],
      },
    );
    const imprint = reg.passive('imprint_archmage')!;
    expect(imprint.effect.kind).toBe('power');
    expect(powerPctFor(aggregate(reg, state), orb)).toBeCloseTo(imprint.effect.pct * 0.6, 10);
  });

  it('floors SP cost and cooldown reductions', () => {
    const t = aggregate(reg, stateWith({}, { passives: { thrift: 3, haste: 3 } }));
    expect(spCostPctFor(t, orb)).toBe(PASSIVE_CAPS.minSpCost); // -60 → -50
    expect(cooldownPctFor(t, blade)).toBe(PASSIVE_CAPS.minCooldown); // -90 → -50
    expect(cooldownPctFor(t, orb)).toBe(0); // haste is blade-only
    const mild = aggregate(reg, stateWith({}, { passives: { thrift: 1 } }));
    expect(spCostPctFor(mild, blade)).toBe(-20);
  });

  it('sums stats, family, status, mastery XP and still-regen effects', () => {
    const state = stateWith(
      { palm: 10, slash: 5 },
      {
        passives: { forgehand: 2, devotion: 1, patience: 2, still_mind: 3, echo_ear: 1, sprite_bane: 2, res_fire_wind: 1, res_any_burn: 1 },
        bestiary: { sprite_0: 100, sprite_1: 30 },
        classes: { blademaster: { rank: 3, xp: 0, spent: { n2: 1, n4: 2 } } },
        worn: 'blademaster',
      },
    );
    const t = aggregate(reg, state);
    // forgehand 3×2 + tree n4 (+3 atk × 2).
    expect(statPct(t, 'atk')).toBe(12);
    expect(statPct(t, 'sp')).toBe(5);
    // bestiary 3-star species.
    expect(statPct(t, 'hp')).toBe(1);
    expect(statPct(t, 'crit')).toBe(0);
    // sprite_bane 4×2 + bestiary 2 species at ≥ 25.
    expect(vsFamilyPct(t, 'sprite')).toBe(10);
    expect(vsFamilyPct(t, 'beast')).toBe(0);
    expect(vsStatusPct(t, 'wind', ['burn', 'slow'])).toBe(20);
    expect(vsStatusPct(t, 'fire', ['burn'])).toBe(5);
    expect(vsStatusPct(t, undefined, ['burn'])).toBe(5);
    expect(vsStatusPct(t, 'wind', ['slow'])).toBe(0);
    // still_mind 5×3 for everything, echo_ear only for echo skills.
    expect(masteryXpPct(t, blade)).toBe(15);
    expect(masteryXpPct(t, { tags: ['echo', 'strike'] })).toBe(21);
    // patience 20×2; palm (spirit) is 10 → tag_spirit locked.
    expect(regenStillPct(t)).toBe(40);
    // tree n2: SP cost for blade skills.
    expect(spCostPctFor(t, blade)).toBe(reg.passive('cls_blademaster_2')!.effect.pct);
    expect(spCostPctFor(t, orb)).toBe(0);
  });

  it('merges vsStatus entries by element and status', () => {
    const t = aggregate(reg, stateWith({}, { passives: { res_fire_wind: 1, res_any_burn: 1 } }));
    expect(t.vsStatus).toEqual([
      { element: 'wind', status: 'burn', pct: 15 },
      { status: 'burn', pct: 5 },
    ]);
  });
});
