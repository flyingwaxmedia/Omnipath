// Mastery v2 (docs/SPEC-v2.md §1). Every engaged attack feeds the skill it came from; XP is scaled
// by how dangerous the target is relative to the skill (threat), with a study bonus for species
// the skill is still learning. Pure functions only — the SkillBook owns state and applies `rate`.
import type { MonsterDef, SkillDef } from './types';

/** Mastery tuning. Mutable on purpose: the client raises `rate` for fast testing (`?fast`). */
export const MASTERY = {
  /** Base XP for an engaged cast (granted on the cast's first hit, or a buff used in combat). */
  useXp: 1,
  /** Base XP per enemy struck. */
  hitXp: 1,
  /** Base XP per enemy defeated by the skill (not subject to the instance cap). */
  killXp: 3,
  /** Only the first N hits of a single cast earn hit XP. */
  maxHitsPerUse: 4,
  /** At most N hit-XP grants per (skill, monster instance). */
  instanceHitCap: 12,
  /** The study bonus applies while the skill has killed fewer than N of a species. */
  studyKills: 10,
  /** Study bonus multiplier on hit and kill XP. */
  studyMult: 1.5,
  /** Global XP multiplier, applied by the SkillBook when XP is added. */
  rate: 1,
  /** Overmastery bar after max rank = round(overMult * xpToNext(maxRank, tier)). */
  overMult: 2.5,
  /** Minimum skill rank to use it as a fusion ingredient (capped by the skill's maxRank). */
  fusionMinRank: 5,
  /** Unspent morph charges a skill can bank. */
  maxCharges: 3,
};

/** Kill XP multiplier for wardens. */
const WARDEN_KILL_MULT = 1.5;

/** Skill level offset per tier (index = tier clamped to 0..3). */
const TIER_LEVEL: readonly [number, number, number, number] = [0, 3, 6, 9];

/**
 * Threat bands, highest first: the first band whose `min` the floored delta reaches wins.
 * Anything below the last band is grey (no XP).
 */
const THREAT_BANDS: readonly { readonly min: number; readonly mult: number }[] = [
  { min: 6, mult: 2.0 },
  { min: 4, mult: 1.6 },
  { min: 2, mult: 1.3 },
  { min: 0, mult: 1.0 },
  { min: -2, mult: 0.8 },
  { min: -4, mult: 0.5 },
  { min: -6, mult: 0.25 },
];

/** Clamps a skill tier to the 0..3 range the curves are defined on. */
function clampTier(tier: number): 0 | 1 | 2 | 3 {
  return Math.max(0, Math.min(3, Math.floor(tier))) as 0 | 1 | 2 | 3;
}

/** XP needed to go from `rank` to `rank + 1`: round(14 * 1.3^(rank-1) * (1 + 0.4 * min(tier, 3))). */
export function xpToNext(rank: number, tier = 0): number {
  return Math.round(14 * Math.pow(1.3, rank - 1) * (1 + 0.4 * clampTier(tier)));
}

/** Size of one overmastery bar for a skill at max rank: round(overMult * xpToNext(maxRank, tier)). */
export function overmasteryCost(maxRank: number, tier = 0): number {
  return Math.round(MASTERY.overMult * xpToNext(maxRank, tier));
}

/** Damage multiplier earned from rank: +6% per rank above 1. */
export function rankPower(rank: number): number {
  return 1 + 0.06 * (rank - 1);
}

/** Rank a skill needs to be used as a fusion ingredient (never above its own maxRank). */
export function fusionMinRank(maxRank: number): number {
  return Math.min(MASTERY.fusionMinRank, maxRank);
}

/** Effective level of a skill for threat math: [0, 3, 6, 9][min(tier, 3)] + rank * 0.5. */
export function skillLevel(tier: number, rank: number): number {
  return TIER_LEVEL[clampTier(tier)] + rank * 0.5;
}

/** A monster's threat: its authored `threat`, else level +2 for elites / +3 for wardens. */
export function monsterThreat(m: Pick<MonsterDef, 'level' | 'rank' | 'threat'>): number {
  return m.threat ?? m.level + (m.rank === 'elite' ? 2 : m.rank === 'warden' ? 3 : 0);
}

/**
 * XP multiplier for `delta = monsterThreat - skillLevel`, floored to an integer before the lookup:
 * <= -7: 0 (grey) · -6..-5: 0.25 · -4..-3: 0.5 · -2..-1: 0.8 · 0..1: 1.0 · 2..3: 1.3 · 4..5: 1.6 · >= 6: 2.0.
 */
export function threatMult(delta: number): number {
  const d = Math.floor(delta);
  for (const band of THREAT_BANDS) if (d >= band.min) return band.mult;
  return 0;
}

/**
 * Use XP for one engaged cast (or a buff used while in combat): `useXp * threatMult`.
 * `threat` is the engaged monster's threat (for buffs, the highest among engaged monsters).
 * Excludes `MASTERY.rate`, which the SkillBook applies when adding XP.
 */
export function useXp(skill: SkillDef, rank: number, threat: number): number {
  return MASTERY.useXp * threatMult(threat - skillLevel(skill.tier, rank));
}

/** Inputs for {@link xpForHit}. */
export interface HitXpArgs {
  /** The skill that landed the hit. */
  skill: SkillDef;
  /** The skill's current rank. */
  rank: number;
  /** The monster struck. */
  monster: MonsterDef;
  /** True when this hit killed the monster (adds kill XP). */
  killed: boolean;
  /** Kills of this monster's species by this skill before this hit (study bonus while < MASTERY.studyKills). */
  studyKills: number;
  /** Summed passive `masteryXp` percent for this skill (e.g. 10 = +10%). Default 0. */
  masteryPct?: number;
  /** 0-based index of this target among the cast's hits; hit XP only while < MASTERY.maxHitsPerUse. Default 0. */
  hitIndex?: number;
  /** Hit-XP grants this skill already earned from this monster instance; hit XP only while < MASTERY.instanceHitCap. Default 0. */
  instanceHits?: number;
}

/**
 * Mastery XP earned by one hit:
 * `(hit + kill) * threatMult(monsterThreat - skillLevel) * study * (1 + masteryPct / 100)`, where
 * `hit = hitXp` unless the per-cast (`hitIndex`) or per-instance (`instanceHits`) cap is reached,
 * `kill = killXp` (×1.5 for wardens) when `killed`, and `study = studyMult` while
 * `args.studyKills < MASTERY.studyKills`. Kill XP ignores both caps. Excludes `MASTERY.rate`, which the
 * SkillBook applies when adding XP.
 */
export function xpForHit(args: HitXpArgs): number {
  const { skill, rank, monster, killed, studyKills, masteryPct = 0, hitIndex = 0, instanceHits = 0 } = args;
  const hitCounts = hitIndex < MASTERY.maxHitsPerUse && instanceHits < MASTERY.instanceHitCap;
  const hit = hitCounts ? MASTERY.hitXp : 0;
  const kill = killed ? MASTERY.killXp * (monster.rank === 'warden' ? WARDEN_KILL_MULT : 1) : 0;
  const threat = threatMult(monsterThreat(monster) - skillLevel(skill.tier, rank));
  const study = studyKills < MASTERY.studyKills ? MASTERY.studyMult : 1;
  return (hit + kill) * threat * study * (1 + masteryPct / 100);
}
