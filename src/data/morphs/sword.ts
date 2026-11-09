import type { MorphDef, Requirement } from '../../core/types';

// Sword morph tree: 13 nodes (SPEC-v2 §4.1).
//   T1: parent at max rank + 1 charge.
//   T2: + one sibling-branch sword skill at rank 5.
//   T3: + two other sword-tree skills at rank 5, one element, and the stone relic.
// Sparks: slash→whirlwind, sword_throw→boomerang_blade, heavy_cleave→sundering_blow.
// World flags: heavy_cleave (ore), crescent_sweep (wind chimes), sundering_blow (cragling kills).

const STONE_RELIC: Requirement = { type: 'flag', id: 'relic_stone', min: 1, label: 'Claim the stone relic' };

export const SWORD_MORPHS: MorphDef[] = [
  // ---------------------------------------------------------------- tier 1
  {
    from: 'slash',
    to: 'whirlwind',
    tier: 1,
    // Being swarmed in the meadow teaches you to turn all the way around.
    spark: { threat: 2, minParentRank: 5 },
  },
  { from: 'slash', to: 'sword_throw', tier: 1 },
  {
    from: 'slash',
    to: 'heavy_cleave',
    tier: 1,
    requires: [{ type: 'flag', id: 'ore_mined', min: 6, label: 'Mine 6 ore' }],
    hint: 'Your swing could learn real weight from striking stone.',
  },

  // ---------------------------------------------------------------- tier 2: whirlwind branch
  {
    from: 'whirlwind',
    to: 'spinning_assault',
    tier: 2,
    requires: [{ type: 'skill', id: 'sword_throw', rank: 5 }],
    hint: 'Chase your own thrown blade often enough and your spin will learn to follow it.',
  },
  {
    from: 'whirlwind',
    to: 'crescent_sweep',
    tier: 2,
    requires: [
      { type: 'skill', id: 'heavy_cleave', rank: 5 },
      { type: 'flag', id: 'chime_gathered', min: 5, label: 'Gather 5 chime feathers' },
    ],
    hint: 'On Windcrest Hill the chimes swing in half-moons. A spin with weight behind it could learn to sweep.',
  },

  // ---------------------------------------------------------------- tier 2: sword_throw branch
  {
    from: 'sword_throw',
    to: 'boomerang_blade',
    tier: 2,
    requires: [{ type: 'skill', id: 'whirlwind', rank: 5 }],
    hint: 'A blade that has learned to spin might learn never to stop.',
    // The wind-sprites of the lake and hill bat thrown blades back toward you.
    spark: { threat: 6, minParentRank: 4, families: ['sprite'] },
  },
  {
    from: 'sword_throw',
    to: 'blade_volley',
    tier: 2,
    requires: [
      { type: 'level', min: 6 },
      { type: 'skill', id: 'heavy_cleave', rank: 5 },
    ],
    hint: 'A more seasoned adventurer, used to wide arcs, could throw more than one blade.',
  },

  // ---------------------------------------------------------------- tier 2: heavy_cleave branch
  {
    from: 'heavy_cleave',
    to: 'guillotine',
    tier: 2,
    requires: [{ type: 'skill', id: 'sword_throw', rank: 5 }],
    hint: 'A thrown blade flies true. Bring that straight line down from above.',
  },
  {
    from: 'heavy_cleave',
    to: 'sundering_blow',
    tier: 2,
    requires: [
      { type: 'skill', id: 'whirlwind', rank: 5 },
      { type: 'flag', id: 'kill_cragling', min: 12, label: 'Defeat 12 Craglings' },
    ],
    hint: 'Stone things in the quarry have seams. Break enough of them and your cleave will find its second blow.',
    // Cracking constructs open mid-swing teaches the second blow.
    spark: { threat: 7, minParentRank: 5, families: ['construct'] },
  },

  // ---------------------------------------------------------------- tier 3 capstones
  {
    from: 'spinning_assault',
    to: 'tempest_waltz',
    tier: 3,
    requires: [
      { type: 'skill', id: 'crescent_sweep', rank: 5 },
      { type: 'skill', id: 'blade_volley', rank: 5 },
      { type: 'element', id: 'wind' },
      STONE_RELIC,
    ],
    hint: 'A dance needs a partner and steady feet: take the wind by the hand, and the stone relic to hold you to the ground.',
  },
  {
    from: 'blade_volley',
    to: 'hundredfold_edge',
    tier: 3,
    requires: [
      { type: 'skill', id: 'boomerang_blade', rank: 5 },
      { type: 'skill', id: 'guillotine', rank: 5 },
      { type: 'element', id: 'fire' },
      STONE_RELIC,
    ],
    hint: 'Steel folded a hundred times in flame remembers every fold. Know the forge-fire, and carry the stone relic.',
  },
  {
    from: 'guillotine',
    to: 'worldbreaker',
    tier: 3,
    requires: [
      { type: 'skill', id: 'sundering_blow', rank: 5 },
      { type: 'skill', id: 'spinning_assault', rank: 5 },
      { type: 'element', id: 'earth' },
      STONE_RELIC,
    ],
    hint: 'The colossus beneath the quarry held the earth together. Know the earth, take its relic, and your blade could break it.',
  },
];
