// Sparks (docs/SPEC-v2.md §4.1/§4.2): a morph learned mid-combat, charge-free, when a parent skill
// hits a monster whose threat suits the morph's spark spec. Rolls are deterministic — each one is
// `rollAt(state.seed, state.counter++)` — so a server replaying the same hits gets the same sparks.
// The SkillBook owns the SparkState and learns the returned morph with source `spark:<parent>`.
import { monsterThreat } from './mastery';
import type { Registry } from './registry';
import { rollAt } from './rng';
import type { SparkState } from './state';
import type { MonsterDef, MorphDef, Requirement, SparkSpec } from './types';

/** Spark tuning (SPEC §4.2). Mutable like MASTERY so dev tools and tests can adjust it. */
export const SPARK = {
  /** At most one spark per this many ms of game time. */
  cooldownMs: 60000,
  /** Percentage points of pity a morph gains each time its roll fails. */
  pityPerFail: 0.1,
  /** Pity never exceeds this many percentage points. */
  pityCap: 3,
};

/** Parent rank a morph needs before it can spark when its SparkSpec has no `minParentRank`. */
export const DEFAULT_SPARK_PARENT_RANK = 3;

/** Spark chance (percent) for spark index -3 .. +3; below -3 it is 0, above +3 it stays at +3's. */
const CHANCE_BY_INDEX: readonly number[] = [0.4, 0.8, 1.5, 3.0, 2.5, 2.0, 1.5];
const MIN_SPARK_INDEX = -3;
const MAX_SPARK_INDEX = 3;

/** Hotbar telegraph for how promising a spark is right now — never shown as a percentage. */
export type SparkWindow = 'none' | 'low' | 'good' | 'peak';

/** A morph that carries a spark spec (what sparkCandidates and rollSpark return). */
export type SparkMorph = MorphDef & { spark: SparkSpec };

/** What spark rules may ask about the player. Implemented by the SkillBook. */
export interface SparkContext {
  /** Rank of a known skill (0 if unknown). */
  rank(id: string): number;
  /** Knows this skill id. */
  has(id: string): boolean;
  /** Whether the player satisfies a requirement (see meetsRequirement). */
  meets(req: Requirement): boolean;
}

/**
 * Spark chance in percent for a spark index `si` (floored first): <= -4: 0 · -3: 0.4 · -2: 0.8 ·
 * -1: 1.5 · 0: 3.0 · +1: 2.5 · +2: 2.0 · >= +3: 1.5. Peaks when the monster matches the spec's
 * threat; weaker monsters teach poorly and much stronger ones overwhelm.
 */
export function sparkChance(si: number): number {
  const i = Math.floor(si);
  if (i < MIN_SPARK_INDEX) return 0;
  return CHANCE_BY_INDEX[Math.min(i, MAX_SPARK_INDEX) - MIN_SPARK_INDEX];
}

/** Spark index of a monster for a spark spec: floor(monsterThreat - spark.threat). */
export function sparkIndex(monster: MonsterDef, spark: SparkSpec): number {
  return Math.floor(monsterThreat(monster) - spark.threat);
}

/** Key a morph's pity is stored under in SparkState.pity: `${from}>${to}`. */
export function morphKey(morph: Pick<MorphDef, 'from' | 'to'>): string {
  return `${morph.from}>${morph.to}`;
}

const hasSpark = (m: MorphDef): m is SparkMorph => m.spark !== undefined;

/** Strips float noise from accumulated pity (0.1 steps) so saved values stay exact. */
const roundPity = (x: number): number => Math.round(x * 1e6) / 1e6;

/** Pity applied to a morph's next roll (stored value, capped at SPARK.pityCap). */
function pityOf(state: SparkState, morph: MorphDef): number {
  return Math.min(SPARK.pityCap, state.pity[morphKey(morph)] ?? 0);
}

/** Chance (percent) of a candidate's next roll: sparkChance + capped pity. */
function effectiveChance(state: SparkState, morph: SparkMorph, monster: MonsterDef): number {
  return sparkChance(sparkIndex(monster, morph.spark)) + pityOf(state, morph);
}

function onCooldown(state: SparkState, now: number): boolean {
  return now - state.lastAt < SPARK.cooldownMs;
}

/**
 * Morphs a hit by `skillId` on `monster` may spark, sorted by ascending `spark.threat` (ties keep
 * data order). A morph qualifies when it has a spark spec, its target is not known, the parent is
 * at rank >= `minParentRank` (default 3), the monster's family is allowed, every `requires` entry
 * is met and its spark index is >= -3. Sparks waive only the morph charge and the parent's
 * max-rank rule. Only morphs authored from `skillId` itself count (variants have no morphs).
 * Ignores the spark cooldown (see rollSpark).
 */
export function sparkCandidates(reg: Registry, ctx: SparkContext, skillId: string, monster: MonsterDef): SparkMorph[] {
  const parentRank = ctx.rank(skillId);
  return reg
    .morphsFrom(skillId)
    .filter(hasSpark)
    .filter(
      (m) =>
        !ctx.has(m.to) &&
        parentRank >= (m.spark.minParentRank ?? DEFAULT_SPARK_PARENT_RANK) &&
        (m.spark.families === undefined || m.spark.families.includes(monster.family)) &&
        sparkIndex(monster, m.spark) >= MIN_SPARK_INDEX &&
        (m.requires ?? []).every((r) => ctx.meets(r)),
    )
    .sort((a, b) => a.spark.threat - b.spark.threat);
}

/**
 * Hotbar telegraph for hitting `monster` with `skillId` at game time `now`, from the best chance
 * (sparkChance + capped pity) among the candidates: 0 → 'none', < 1 → 'low', < 2.5 → 'good',
 * >= 2.5 → 'peak'. 'none' while the spark cooldown runs or when nothing can spark. Pure.
 */
export function sparkWindow(
  reg: Registry,
  ctx: SparkContext,
  state: SparkState,
  skillId: string,
  monster: MonsterDef,
  now: number,
): SparkWindow {
  if (onCooldown(state, now)) return 'none';
  let best = 0;
  for (const m of sparkCandidates(reg, ctx, skillId, monster)) best = Math.max(best, effectiveChance(state, m, monster));
  if (best <= 0) return 'none';
  if (best < 1) return 'low';
  if (best < 2.5) return 'good';
  return 'peak';
}

/**
 * Rolls for a spark after `skillId` hits `monster` at game time `now` (ms). No roll (and no state
 * change) while `now - state.lastAt < SPARK.cooldownMs`. Otherwise each candidate, by ascending
 * spark.threat, is rolled once with `rollAt(state.seed, state.counter++)` against sparkChance +
 * pity (pity capped at SPARK.pityCap). A failure adds SPARK.pityPerFail to that morph's pity
 * (capped); the first success sets its pity to 0, sets `state.lastAt = now` and returns the morph,
 * which the caller learns charge-free with source `spark:<parent>`. Returns null when nothing
 * sparks. Mutates only `state` (counter, pity, lastAt).
 */
export function rollSpark(
  reg: Registry,
  ctx: SparkContext,
  state: SparkState,
  skillId: string,
  monster: MonsterDef,
  now: number,
): SparkMorph | null {
  if (onCooldown(state, now)) return null;
  for (const m of sparkCandidates(reg, ctx, skillId, monster)) {
    const key = morphKey(m);
    if (rollAt(state.seed, state.counter++) * 100 < effectiveChance(state, m, monster)) {
      state.pity[key] = 0;
      state.lastAt = now;
      return m;
    }
    state.pity[key] = roundPity(Math.min(SPARK.pityCap, pityOf(state, m) + SPARK.pityPerFail));
  }
  return null;
}
