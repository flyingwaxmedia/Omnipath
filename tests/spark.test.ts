import { describe, expect, it } from 'vitest';
import { Registry } from '../src/core/registry';
import { meetsRequirement, type RequirementContext } from '../src/core/requirements';
import { rollAt } from '../src/core/rng';
import {
  SPARK,
  morphKey,
  rollSpark,
  sparkCandidates,
  sparkChance,
  sparkIndex,
  sparkWindow,
  type SparkContext,
} from '../src/core/spark';
import { emptyState, type SparkState } from '../src/core/state';
import type { Family, GameData, MonsterDef, MorphDef, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const sk = (id: string, shape: SkillDef['shape'], tier = 1): SkillDef => ({
  id,
  name: id,
  desc: id,
  icon: id,
  tier,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 5,
  cooldown: 2000,
  maxRank: 10,
  shape,
});

const STRIKE: SkillDef['shape'] = { kind: 'strike', range: 56, arc: 110 };

const mon = (id: string, family: Family, threat: number): MonsterDef => ({
  id,
  name: id,
  level: 1,
  hp: 50,
  atk: 5,
  def: 1,
  family,
  size: 'M',
  rank: 'common',
  threat,
  exp: 5,
  coins: [1, 2],
  speed: 40,
  aggressive: false,
  radius: 12,
  attackRange: 32,
  attackDelay: 1200,
  respawn: 20000,
});

const WHIRL: MorphDef = { from: 'slash', to: 'whirlwind', tier: 1, spark: { threat: 4 } };
const CLEAVE: MorphDef = {
  from: 'slash',
  to: 'heavy_cleave',
  tier: 1,
  requires: [{ type: 'flag', id: 'ore_mined', min: 6 }],
  spark: { threat: 6, minParentRank: 5, families: ['construct'] },
};
const THROW: MorphDef = { from: 'slash', to: 'sword_throw', tier: 1 };
const LUNGE: MorphDef = { from: 'slash', to: 'lunge', tier: 1, spark: { threat: 2 } };
const BOOMERANG: MorphDef = {
  from: 'sword_throw',
  to: 'boomerang_blade',
  tier: 2,
  requires: [{ type: 'skill', id: 'whirlwind', rank: 5 }],
  spark: { threat: 6, minParentRank: 4, families: ['sprite'] },
};

const DATA: GameData = {
  dataVersion: 2,
  elements: [],
  skills: [
    sk('slash', STRIKE, 0),
    sk('whirlwind', { kind: 'spin', radius: 80 }),
    sk('heavy_cleave', STRIKE),
    sk('sword_throw', { kind: 'projectile', speed: 500, range: 300 }),
    sk('lunge', { kind: 'dash', distance: 120, width: 40 }),
    sk('boomerang_blade', { kind: 'projectile', speed: 500, range: 300 }, 2),
  ],
  morphs: [WHIRL, CLEAVE, THROW, LUNGE, BOOMERANG],
  recipes: [],
  classes: [],
  essences: [],
  passives: [],
  trainers: [],
  monsters: [],
  items: [],
};

const reg = new Registry(DATA);

interface Player {
  ranks?: Record<string, number>;
  flags?: Record<string, number>;
}

/** A SparkContext over plain rank/flag maps; meets() goes through the real requirement rules. */
function ctxOf(p: Player = {}): SparkContext {
  const ranks = p.ranks ?? {};
  const flags = p.flags ?? {};
  const req: RequirementContext = {
    level: 1,
    hasElement: () => false,
    elementsKnown: () => 0,
    rank: (id) => ranks[id] ?? 0,
    flag: (id) => flags[id] ?? 0,
    classRank: () => 0,
    worn: null,
    tagCount: () => 0,
    itemCount: () => 0,
    lessons: [],
    witness: () => 0,
  };
  return { rank: req.rank, has: (id) => (ranks[id] ?? 0) > 0, meets: (r) => meetsRequirement(r, req) };
}

const sparkState = (seed: number): SparkState => emptyState(seed).spark;

/** First seed in 1..1e6 satisfying `pred` (rolls are deterministic, so tests can pick their dice). */
function seedWhere(pred: (seed: number) => boolean): number {
  for (let seed = 1; seed <= 1_000_000; seed++) if (pred(seed)) return seed;
  throw new Error('no seed found');
}

/** Rolls [from, to) of a seed's stream, as percentages. */
const pcts = (seed: number, from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, i) => rollAt(seed, from + i) * 100);

const NOW = 1_000_000;
const sprite = (threat: number) => mon(`sprite_t${threat}`, 'sprite', threat);
/** Slash at rank 3 sparks only Whirlwind (threat 4) and Lunge (threat 2) against non-constructs. */
const SLASH3 = ctxOf({ ranks: { slash: 3 } });
/** Only Whirlwind is a candidate (Lunge already known). */
const WHIRL_ONLY = ctxOf({ ranks: { slash: 3, lunge: 1 } });

// ------------------------------------------------------------------ chance table

describe('sparkChance', () => {
  it('follows the SPEC table, clamped at both ends', () => {
    const table: [number, number][] = [
      [-9, 0],
      [-4, 0],
      [-3, 0.4],
      [-2, 0.8],
      [-1, 1.5],
      [0, 3.0],
      [1, 2.5],
      [2, 2.0],
      [3, 1.5],
      [12, 1.5],
    ];
    for (const [si, pct] of table) expect(sparkChance(si), `si ${si}`).toBe(pct);
  });

  it('floors fractional indices', () => {
    expect(sparkChance(-0.5)).toBe(1.5);
    expect(sparkChance(0.9)).toBe(3.0);
    expect(sparkChance(-3.1)).toBe(0);
  });

  it('sparkIndex floors monster threat minus spark threat', () => {
    expect(sparkIndex(sprite(5.5), { threat: 4 })).toBe(1);
    expect(sparkIndex(sprite(3.5), { threat: 4 })).toBe(-1);
    // Default threat: level +2 for elites.
    expect(sparkIndex({ ...sprite(0), threat: undefined, level: 3, rank: 'elite' }, { threat: 4 })).toBe(1);
  });

  it('morphKey is from>to', () => {
    expect(morphKey(WHIRL)).toBe('slash>whirlwind');
  });
});

// ------------------------------------------------------------------ candidates

describe('sparkCandidates', () => {
  const ids = (ms: MorphDef[]) => ms.map((m) => m.to);

  it('lists unknown spark morphs from the skill, by ascending spark threat', () => {
    expect(ids(sparkCandidates(reg, SLASH3, 'slash', sprite(4)))).toEqual(['lunge', 'whirlwind']);
  });

  it('never includes morphs without a spark spec', () => {
    const all = ids(sparkCandidates(reg, ctxOf({ ranks: { slash: 10 }, flags: { ore_mined: 6 } }), 'slash', mon('c', 'construct', 5)));
    expect(all).not.toContain('sword_throw');
    expect(all).toEqual(['lunge', 'whirlwind', 'heavy_cleave']);
  });

  it('needs the parent at minParentRank (default 3), not max rank', () => {
    expect(sparkCandidates(reg, ctxOf({ ranks: { slash: 2 } }), 'slash', sprite(4))).toEqual([]);
    expect(ids(sparkCandidates(reg, ctxOf({ ranks: { slash: 3 } }), 'slash', sprite(4)))).toEqual(['lunge', 'whirlwind']);
    const construct = mon('c', 'construct', 6);
    const four = ctxOf({ ranks: { slash: 4 }, flags: { ore_mined: 6 } });
    const five = ctxOf({ ranks: { slash: 5 }, flags: { ore_mined: 6 } });
    expect(ids(sparkCandidates(reg, four, 'slash', construct))).not.toContain('heavy_cleave');
    expect(ids(sparkCandidates(reg, five, 'slash', construct))).toContain('heavy_cleave');
  });

  it('skips morphs whose target is already known', () => {
    expect(ids(sparkCandidates(reg, ctxOf({ ranks: { slash: 3, whirlwind: 1 } }), 'slash', sprite(4)))).toEqual(['lunge']);
  });

  it('filters by monster family', () => {
    const p = ctxOf({ ranks: { slash: 5 }, flags: { ore_mined: 6 } });
    expect(ids(sparkCandidates(reg, p, 'slash', mon('c', 'construct', 6)))).toContain('heavy_cleave');
    expect(ids(sparkCandidates(reg, p, 'slash', mon('b', 'beast', 6)))).not.toContain('heavy_cleave');
  });

  it('still applies every authored requirement', () => {
    const construct = mon('c', 'construct', 6);
    const short = ctxOf({ ranks: { slash: 5 }, flags: { ore_mined: 5 } });
    expect(ids(sparkCandidates(reg, short, 'slash', construct))).not.toContain('heavy_cleave');

    const s = sprite(6);
    expect(sparkCandidates(reg, ctxOf({ ranks: { sword_throw: 4, whirlwind: 4 } }), 'sword_throw', s)).toEqual([]);
    expect(ids(sparkCandidates(reg, ctxOf({ ranks: { sword_throw: 4, whirlwind: 5 } }), 'sword_throw', s))).toEqual([
      'boomerang_blade',
    ]);
  });

  it('drops morphs whose spark index is below -3', () => {
    // Whirlwind (threat 4): threat 1 → si -3 (kept), threat 0.9 → si -4 (dropped).
    expect(ids(sparkCandidates(reg, WHIRL_ONLY, 'slash', sprite(1)))).toEqual(['whirlwind']);
    expect(sparkCandidates(reg, WHIRL_ONLY, 'slash', sprite(0.9))).toEqual([]);
  });

  it('has nothing for skills without morphs', () => {
    expect(sparkCandidates(reg, ctxOf({ ranks: { lunge: 10 } }), 'lunge', sprite(4))).toEqual([]);
  });
});

// ------------------------------------------------------------------ rolls

describe('rollSpark', () => {
  // Whirlwind against a threat-1 sprite: si -3 → 0.4 %.
  const weak = sprite(1);
  const BASE = 0.4;

  it('rolls once per candidate on its own counter and accumulates pity on failure', () => {
    const seed = seedWhere((s) => pcts(s, 0, 2).every((p) => p >= 3.5));
    const st = sparkState(seed);
    // Two candidates against a threat-4 sprite: Lunge (si +2) and Whirlwind (si 0), both fail.
    expect(rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW)).toBeNull();
    expect(st.counter).toBe(2);
    expect(st.pity).toEqual({ 'slash>lunge': 0.1, 'slash>whirlwind': 0.1 });
    expect(st.lastAt).toBe(emptyState().spark.lastAt);
  });

  it('accumulates pity in exact 0.1 steps per failed roll', () => {
    const seed = seedWhere((s) => pcts(s, 0, 7).every((p) => p >= BASE + 0.7));
    const st = sparkState(seed);
    for (let i = 0; i < 7; i++) expect(rollSpark(reg, WHIRL_ONLY, st, 'slash', weak, NOW + i)).toBeNull();
    expect(st.counter).toBe(7);
    expect(st.pity['slash>whirlwind']).toBe(0.7);
  });

  it('caps pity at SPARK.pityCap', () => {
    const fails = Math.round(SPARK.pityCap / SPARK.pityPerFail) + 5;
    const seed = seedWhere((s) => pcts(s, 0, fails).every((p) => p >= BASE + SPARK.pityCap));
    const st = sparkState(seed);
    for (let i = 0; i < fails; i++) rollSpark(reg, WHIRL_ONLY, st, 'slash', weak, NOW);
    expect(st.pity['slash>whirlwind']).toBe(SPARK.pityCap);
  });

  it('adds pity to the chance, and only up to the cap', () => {
    // First roll lands between the base chance and base + cap: fails without pity, succeeds with it.
    const lifted = seedWhere((s) => {
      const p = rollAt(s, 0) * 100;
      return p >= BASE && p < BASE + SPARK.pityCap;
    });
    expect(rollSpark(reg, WHIRL_ONLY, sparkState(lifted), 'slash', weak, NOW)).toBeNull();
    const withPity = sparkState(lifted);
    withPity.pity['slash>whirlwind'] = SPARK.pityCap;
    expect(rollSpark(reg, WHIRL_ONLY, withPity, 'slash', weak, NOW)?.to).toBe('whirlwind');

    // A roll just above base + cap fails even with a huge stored pity, which is then clamped.
    const above = seedWhere((s) => {
      const p = rollAt(s, 0) * 100;
      return p >= BASE + SPARK.pityCap && p < BASE + SPARK.pityCap + 2;
    });
    const hoarded = sparkState(above);
    hoarded.pity['slash>whirlwind'] = 50;
    expect(rollSpark(reg, WHIRL_ONLY, hoarded, 'slash', weak, NOW)).toBeNull();
    expect(hoarded.pity['slash>whirlwind']).toBe(SPARK.pityCap);
  });

  it('a success resets pity, starts the cooldown and stops walking candidates', () => {
    // Lunge (si +2, 2.0 %) is rolled first; make it succeed.
    const seed = seedWhere((s) => rollAt(s, 0) * 100 < 2.0);
    const st = sparkState(seed);
    st.pity['slash>lunge'] = 1.2;
    const got = rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW);
    expect(got).toBe(LUNGE);
    expect(st.pity['slash>lunge']).toBe(0);
    expect(st.pity['slash>whirlwind']).toBeUndefined();
    expect(st.counter).toBe(1);
    expect(st.lastAt).toBe(NOW);
  });

  it('walks to the next candidate when an earlier one fails', () => {
    // Lunge (si +2, 2.0 %) fails, Whirlwind (si 0, 3.0 %) succeeds.
    const seed = seedWhere((s) => rollAt(s, 0) * 100 >= 2.1 && rollAt(s, 1) * 100 < 3.0);
    const st = sparkState(seed);
    expect(rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW)).toBe(WHIRL);
    expect(st.pity).toEqual({ 'slash>lunge': 0.1, 'slash>whirlwind': 0 });
    expect(st.counter).toBe(2);
  });

  it('does not roll during the cooldown (state untouched)', () => {
    const st = sparkState(7);
    st.lastAt = NOW - SPARK.cooldownMs + 1;
    st.pity['slash>whirlwind'] = 0.5;
    const before = structuredClone(st);
    expect(rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW)).toBeNull();
    expect(st).toEqual(before);
  });

  it('rolls again once the cooldown has fully elapsed', () => {
    const st = sparkState(7);
    st.lastAt = NOW - SPARK.cooldownMs;
    rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW);
    expect(st.counter).toBeGreaterThan(0);
  });

  it('a spark blocks further sparks for cooldownMs', () => {
    const seed = seedWhere((s) => rollAt(s, 0) * 100 < 2.0);
    const st = sparkState(seed);
    expect(rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW)).not.toBeNull();
    const counter = st.counter;
    expect(rollSpark(reg, SLASH3, st, 'slash', sprite(4), NOW + SPARK.cooldownMs - 1)).toBeNull();
    expect(st.counter).toBe(counter);
  });

  it('consumes no rolls when nothing can spark', () => {
    const st = sparkState(3);
    expect(rollSpark(reg, ctxOf({ ranks: { slash: 2 } }), st, 'slash', sprite(4), NOW)).toBeNull();
    expect(st).toEqual(sparkState(3));
  });

  it('is deterministic: the same seed replays the same sparks', () => {
    const run = (seed: number) => {
      const st = sparkState(seed);
      const known = new Set<string>();
      const p: SparkContext = { rank: (id) => (id === 'slash' ? 3 : known.has(id) ? 1 : 0), has: (id) => known.has(id), meets: () => true };
      const log: string[] = [];
      for (let hit = 0; hit < 3000; hit++) {
        const m = rollSpark(reg, p, st, 'slash', sprite(4), hit * 1000);
        if (m) {
          known.add(m.to);
          log.push(`${hit}:${m.to}`);
        }
      }
      return { log, state: st };
    };
    const a = run(424242);
    const b = run(424242);
    expect(a.log.length).toBe(2);
    expect(b.log).toEqual(a.log);
    expect(b.state).toEqual(a.state);
  });
});

// ------------------------------------------------------------------ window

describe('sparkWindow', () => {
  const st = () => sparkState(1);
  const win = (p: SparkContext, threat: number, state = st(), now = NOW) =>
    sparkWindow(reg, p, state, 'slash', sprite(threat), now);

  it('bands the best candidate chance: 0 none, <1 low, <2.5 good, >=2.5 peak', () => {
    expect(win(WHIRL_ONLY, 4)).toBe('peak'); // si 0: 3.0
    expect(win(WHIRL_ONLY, 5)).toBe('peak'); // si +1: 2.5 (boundary)
    expect(win(WHIRL_ONLY, 6)).toBe('good'); // si +2: 2.0
    expect(win(WHIRL_ONLY, 9)).toBe('good'); // si +6: 1.5
    expect(win(WHIRL_ONLY, 3)).toBe('good'); // si -1: 1.5
    expect(win(WHIRL_ONLY, 2)).toBe('low'); // si -2: 0.8
    expect(win(WHIRL_ONLY, 1)).toBe('low'); // si -3: 0.4
    expect(win(WHIRL_ONLY, 0)).toBe('none'); // si -4: no candidate
  });

  it('uses the best of several candidates', () => {
    // Threat 2: Lunge si 0 (3.0) beats Whirlwind si -2 (0.8).
    expect(win(SLASH3, 2)).toBe('peak');
  });

  it('includes capped pity', () => {
    const p = st();
    p.pity['slash>whirlwind'] = 0.5;
    expect(win(WHIRL_ONLY, 1, p)).toBe('low'); // 0.9
    p.pity['slash>whirlwind'] = 0.6;
    expect(win(WHIRL_ONLY, 1, p)).toBe('good'); // 1.0
    p.pity['slash>whirlwind'] = 40;
    expect(win(WHIRL_ONLY, 6, p)).toBe('peak'); // 2.0 + 3 (capped)
  });

  it('is none during the cooldown and when nothing qualifies', () => {
    const cooling = st();
    cooling.lastAt = NOW - 10;
    expect(win(WHIRL_ONLY, 4, cooling)).toBe('none');
    expect(win(ctxOf({ ranks: { slash: 2 } }), 4)).toBe('none');
    expect(win(ctxOf({ ranks: { slash: 3, lunge: 1, whirlwind: 1 } }), 4)).toBe('none');
  });

  it('never mutates the state', () => {
    const p = st();
    const before = structuredClone(p);
    win(SLASH3, 4, p);
    expect(p).toEqual(before);
  });
});
