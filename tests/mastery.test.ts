import { describe, expect, it } from 'vitest';
import {
  MASTERY,
  fusionMinRank,
  monsterThreat,
  overmasteryCost,
  rankPower,
  skillLevel,
  threatMult,
  useXp,
  xpForHit,
  xpToNext,
} from '../src/core/mastery';
import type { MonsterDef, MonsterRank, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixtures

function skill(tier: number): SkillDef {
  return {
    id: `test_t${tier}`,
    name: 'Test Skill',
    desc: '',
    icon: '*',
    tier,
    tags: ['blade'],
    power: 1,
    spCost: 0,
    cooldown: 0,
    shape: { kind: 'strike', range: 40, arc: 90 },
    maxRank: 10,
  };
}

function monster(level: number, rank: MonsterRank = 'common', threat?: number): MonsterDef {
  return {
    id: `mon_${rank}_${level}`,
    name: 'Test Monster',
    level,
    hp: 100,
    atk: 10,
    def: 0,
    family: 'beast',
    size: 'M',
    rank,
    threat,
    exp: 10,
    coins: [1, 2],
    speed: 60,
    aggressive: false,
    radius: 12,
    attackRange: 30,
    attackDelay: 1000,
    respawn: 10000,
  };
}

// ------------------------------------------------------------------ constants & curves

describe('MASTERY constants', () => {
  it('match the spec exactly', () => {
    expect(MASTERY).toEqual({
      useXp: 1,
      hitXp: 1,
      killXp: 3,
      maxHitsPerUse: 4,
      instanceHitCap: 12,
      studyKills: 10,
      studyMult: 1.5,
      rate: 1,
      overMult: 2.5,
      fusionMinRank: 5,
      maxCharges: 3,
    });
  });
});

describe('xpToNext', () => {
  it('follows round(14 * 1.3^(rank-1)) at tier 0', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((r) => xpToNext(r))).toEqual([
      14, 18, 24, 31, 40, 52, 68, 88, 114, 148,
    ]);
  });

  it('scales by 1 + 0.4 * tier', () => {
    expect([1, 5, 10].map((r) => xpToNext(r, 1))).toEqual([20, 56, 208]);
    expect([1, 5, 10].map((r) => xpToNext(r, 2))).toEqual([25, 72, 267]);
    expect([1, 5, 10].map((r) => xpToNext(r, 3))).toEqual([31, 88, 327]);
  });

  it('caps the tier factor at tier 3', () => {
    for (const r of [1, 4, 8]) expect(xpToNext(r, 5)).toBe(xpToNext(r, 3));
  });

  it('defaults to tier 0', () => {
    expect(xpToNext(3)).toBe(xpToNext(3, 0));
  });

  it('totals 449 XP from rank 1 to rank 10 at tier 0', () => {
    let total = 0;
    for (let r = 1; r < 10; r++) total += xpToNext(r);
    expect(total).toBe(449);
  });

  it('totals 345 / 444 / 542 XP from rank 1 to rank 8 at tiers 1 / 2 / 3', () => {
    const total = (tier: number) => {
      let t = 0;
      for (let r = 1; r < 8; r++) t += xpToNext(r, tier);
      return t;
    };
    expect([total(1), total(2), total(3)]).toEqual([345, 444, 542]);
  });
});

describe('overmasteryCost', () => {
  it('is round(2.5 * xpToNext(maxRank, tier))', () => {
    expect(overmasteryCost(10)).toBe(370);
    expect(overmasteryCost(10, 0)).toBe(370);
    expect(overmasteryCost(5, 1)).toBe(140);
    expect(overmasteryCost(8, 1)).toBe(308);
    expect(overmasteryCost(8, 2)).toBe(395);
    expect(overmasteryCost(8, 3)).toBe(483);
  });
});

describe('rankPower', () => {
  it('adds 6% per rank above 1', () => {
    expect(rankPower(1)).toBe(1);
    expect(rankPower(2)).toBeCloseTo(1.06, 10);
    expect(rankPower(5)).toBeCloseTo(1.24, 10);
    expect(rankPower(10)).toBeCloseTo(1.54, 10);
  });
});

describe('fusionMinRank', () => {
  it('is min(5, maxRank)', () => {
    expect(fusionMinRank(10)).toBe(5);
    expect(fusionMinRank(8)).toBe(5);
    expect(fusionMinRank(5)).toBe(5);
    expect(fusionMinRank(3)).toBe(3);
    expect(fusionMinRank(1)).toBe(1);
  });
});

// ------------------------------------------------------------------ threat

describe('skillLevel', () => {
  it('is [0, 3, 6, 9][tier] + rank * 0.5', () => {
    expect(skillLevel(0, 1)).toBe(0.5);
    expect(skillLevel(0, 10)).toBe(5);
    expect(skillLevel(1, 1)).toBe(3.5);
    expect(skillLevel(1, 2)).toBe(4);
    expect(skillLevel(2, 4)).toBe(8);
    expect(skillLevel(3, 5)).toBe(11.5);
  });

  it('caps the tier offset at tier 3', () => {
    expect(skillLevel(4, 2)).toBe(10);
    expect(skillLevel(7, 2)).toBe(skillLevel(3, 2));
  });
});

describe('monsterThreat', () => {
  it('is level for commons, +2 for elites, +3 for wardens', () => {
    expect(monsterThreat(monster(5))).toBe(5);
    expect(monsterThreat(monster(5, 'elite'))).toBe(7);
    expect(monsterThreat(monster(9, 'warden'))).toBe(12);
  });

  it('prefers an authored threat over the derived one', () => {
    expect(monsterThreat(monster(5, 'common', 8))).toBe(8);
    expect(monsterThreat(monster(9, 'warden', 4))).toBe(4);
    expect(monsterThreat(monster(9, 'elite', 0))).toBe(0);
  });
});

describe('threatMult', () => {
  it('maps every integer delta at and around each bucket boundary', () => {
    const cases: [number, number][] = [
      [-20, 0],
      [-8, 0],
      [-7, 0],
      [-6, 0.25],
      [-5, 0.25],
      [-4, 0.5],
      [-3, 0.5],
      [-2, 0.8],
      [-1, 0.8],
      [0, 1],
      [1, 1],
      [2, 1.3],
      [3, 1.3],
      [4, 1.6],
      [5, 1.6],
      [6, 2],
      [7, 2],
      [30, 2],
    ];
    for (const [delta, mult] of cases) expect(threatMult(delta), `delta ${delta}`).toBe(mult);
  });

  it('floors fractional deltas before the lookup', () => {
    const cases: [number, number][] = [
      [-6.5, 0],
      [-4.5, 0.25],
      [-2.5, 0.5],
      [-0.5, 0.8],
      [0.5, 1],
      [1.5, 1],
      [1.99, 1],
      [3.5, 1.3],
      [5.5, 1.6],
      [6.5, 2],
    ];
    for (const [delta, mult] of cases) expect(threatMult(delta), `delta ${delta}`).toBe(mult);
  });
});

// ------------------------------------------------------------------ XP grants

describe('useXp', () => {
  it('is useXp * threatMult(threat - skillLevel)', () => {
    // tier 1 rank 2 => skillLevel 4.
    const s = skill(1);
    expect(useXp(s, 2, 4)).toBe(1);
    expect(useXp(s, 2, 6)).toBe(1.3);
    expect(useXp(s, 2, 10)).toBe(2);
    expect(useXp(s, 2, 3)).toBe(0.8);
    expect(useXp(s, 2, -3)).toBe(0);
  });

  it('greys out as the skill outranks the threat', () => {
    // tier 0: skillLevel 0.5 at rank 1, 5 at rank 10; threat-1 monster.
    const s = skill(0);
    expect(useXp(s, 1, 1)).toBe(1);
    expect(useXp(s, 3, 1)).toBe(0.8);
    expect(useXp(s, 10, 1)).toBe(0.5);
  });
});

describe('xpForHit', () => {
  // tier 1 rank 2 => skillLevel 4; a level-6 common is threat 6 => delta 2 => x1.3.
  const s = skill(1);
  const base = { skill: s, rank: 2, monster: monster(6), killed: false, studyKills: MASTERY.studyKills };

  it('grants hitXp * threatMult for a plain hit', () => {
    expect(xpForHit(base)).toBeCloseTo(1.3, 10);
  });

  it('adds killXp * threatMult on a kill', () => {
    expect(xpForHit({ ...base, killed: true })).toBeCloseTo((1 + 3) * 1.3, 10);
  });

  it('applies the study bonus while the skill has killed fewer than studyKills of the species', () => {
    expect(xpForHit({ ...base, studyKills: 0 })).toBeCloseTo(1.3 * 1.5, 10);
    expect(xpForHit({ ...base, studyKills: 9, killed: true })).toBeCloseTo(4 * 1.3 * 1.5, 10);
    expect(xpForHit({ ...base, studyKills: 10, killed: true })).toBeCloseTo(4 * 1.3, 10);
    expect(xpForHit({ ...base, studyKills: 25 })).toBeCloseTo(1.3, 10);
  });

  it('multiplies warden kill XP (only) by 1.5', () => {
    // A level-3 warden is threat 6, same delta as the level-6 common.
    const warden = monster(3, 'warden');
    expect(xpForHit({ ...base, monster: warden })).toBeCloseTo(1.3, 10);
    expect(xpForHit({ ...base, monster: warden, killed: true })).toBeCloseTo((1 + 3 * 1.5) * 1.3, 10);
    // Elites get no kill multiplier: level-4 elite is threat 6 too.
    expect(xpForHit({ ...base, monster: monster(4, 'elite'), killed: true })).toBeCloseTo(4 * 1.3, 10);
  });

  it('applies the masteryXp passive percent to hit and kill XP', () => {
    expect(xpForHit({ ...base, masteryPct: 20 })).toBeCloseTo(1.3 * 1.2, 10);
    expect(xpForHit({ ...base, killed: true, masteryPct: 20 })).toBeCloseTo(4 * 1.3 * 1.2, 10);
  });

  it('combines threat, study, warden and passive bonuses multiplicatively', () => {
    const xp = xpForHit({ ...base, monster: monster(3, 'warden'), killed: true, studyKills: 0, masteryPct: 10 });
    expect(xp).toBeCloseTo((1 + 4.5) * 1.3 * 1.5 * 1.1, 10);
  });

  it('uses the monster threat, including an authored override', () => {
    expect(xpForHit({ ...base, monster: monster(6, 'common', 10) })).toBe(2);
    expect(xpForHit({ ...base, monster: monster(6, 'elite') })).toBe(1.6);
  });

  it('grants nothing against grey targets, even on a kill', () => {
    const grey = monster(1); // threat 1 vs skillLevel 10 (tier 3, rank 2) => delta -9.
    expect(xpForHit({ ...base, skill: skill(3), rank: 2, monster: grey, killed: true, studyKills: 0 })).toBe(0);
  });

  it('caps hit XP to the first maxHitsPerUse hits of a cast but keeps kill XP', () => {
    expect(xpForHit({ ...base, hitIndex: MASTERY.maxHitsPerUse - 1 })).toBeCloseTo(1.3, 10);
    expect(xpForHit({ ...base, hitIndex: MASTERY.maxHitsPerUse })).toBe(0);
    expect(xpForHit({ ...base, hitIndex: MASTERY.maxHitsPerUse, killed: true })).toBeCloseTo(3 * 1.3, 10);
  });

  it('caps hit XP per monster instance but keeps kill XP', () => {
    expect(xpForHit({ ...base, instanceHits: MASTERY.instanceHitCap - 1 })).toBeCloseTo(1.3, 10);
    expect(xpForHit({ ...base, instanceHits: MASTERY.instanceHitCap })).toBe(0);
    expect(xpForHit({ ...base, instanceHits: MASTERY.instanceHitCap, killed: true })).toBeCloseTo(3 * 1.3, 10);
  });

  it('leaves the global rate to the SkillBook', () => {
    const before = MASTERY.rate;
    MASTERY.rate = 6;
    try {
      expect(xpForHit(base)).toBeCloseTo(1.3, 10);
      expect(useXp(s, 2, 6)).toBe(1.3);
    } finally {
      MASTERY.rate = before;
    }
  });
});
