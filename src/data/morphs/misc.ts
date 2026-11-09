import type { MorphDef } from '../../core/types';

// Morphs outside the three weapon trees (SPEC-v2 §4.1 / §8). `tier` is the result skill's tier.
//   - Alternate paths into tree skills: quickstep → shadowstep (with shadow), meditation → focus.
//   - Technique and echo morphs into authored skills in src/data/skills/cross.ts (any weapon).
// All follow the T1 rule: parent at max rank + 1 charge (sparks waive both), plus any `requires`.

export const MISC_MORPHS: MorphDef[] = [
  // ---------------------------------------------------------------- alternate paths
  {
    from: 'quickstep',
    to: 'shadowstep',
    tier: 1,
    requires: [{ type: 'element', id: 'shadow' }],
    hint: 'Your footwork could vanish entirely, if you knew the dark.',
  },
  { from: 'meditation', to: 'focus', tier: 1 },

  // ---------------------------------------------------------------- technique morphs
  {
    from: 'rising_kick',
    to: 'soaring_heel',
    tier: 2,
    requires: [{ type: 'skill', id: 'shoulder_charge', rank: 3 }],
    hint: 'Hale only kicks from the air after a running start. Learn to charge, and your kick might learn to fly.',
  },
  {
    from: 'palm_strike',
    to: 'rippling_palm',
    tier: 2,
    requires: [{ type: 'skill', id: 'meditation', rank: 5 }],
    hint: 'Oru strikes the still air and the grass bows all around him. Your palm needs a quieter mind first.',
  },

  // ---------------------------------------------------------------- echo morphs
  {
    from: 'jelly_slam',
    to: 'crown_slam',
    tier: 2,
    hint: "The Monarch's slam was only a jelly's game. Master it, and you might land like royalty.",
    // Bouncing sprites (jellops, wisps, gustlings) teach the landing.
    spark: { threat: 4, minParentRank: 3, families: ['sprite'] },
  },
];
