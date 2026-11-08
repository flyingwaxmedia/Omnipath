// Mastery tuning. Every attack the player makes feeds the skill it came from.

export const MASTERY = {
  /** XP for simply using a skill. */
  useXp: 1,
  /** XP per enemy struck (capped per use). */
  hitXp: 1,
  /** XP per enemy defeated by the skill. */
  killXp: 3,
  maxHitsPerUse: 4,
  /** Global multiplier. Raise for faster testing (`?fast` in the client). */
  rate: 1,
  /** Overmastery bar after max rank = xpToNext(maxRank) * overMult. */
  overMult: 3,
  /** Minimum skill rank to use it as a fusion ingredient. */
  fusionMinRank: 5,
  /** Unspent morph charges a skill can bank. */
  maxCharges: 3,
};

export function xpToNext(rank: number, tier = 0): number {
  return Math.ceil(4 * Math.pow(rank, 1.15) * (1 + 0.35 * tier));
}

export function overmasteryCost(maxRank: number, tier = 0): number {
  return xpToNext(maxRank, tier) * MASTERY.overMult;
}

/** Damage multiplier earned from rank. */
export function rankPower(rank: number): number {
  return 1 + 0.06 * (rank - 1);
}

export function fusionMinRank(maxRank: number): number {
  return Math.min(MASTERY.fusionMinRank, maxRank);
}
