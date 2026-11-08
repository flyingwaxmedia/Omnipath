import type { MorphDef, Requirement } from '../../core/types';

// Dagger morph tree (SPEC-v2 §4.1): 13 nodes — stab, 3×T1, 6×T2 (2 per branch), 3×T3 capstones.
// T2: + one sibling-branch skill at rank 5. T3: + 2 other tree skills at rank 5, 1 element, relic_dusk.

const r5 = (id: string): Requirement => ({ type: 'skill', id, rank: 5 });
const DUSK_RELIC: Requirement = { type: 'flag', id: 'relic_dusk', min: 1, label: "Claim the Hollow Regent's relic" };

export const DAGGER_MORPHS: MorphDef[] = [
  // ---------------------------------------------------------------- T1 (from stab)
  { from: 'stab', to: 'backstab', tier: 1 },
  {
    from: 'stab',
    to: 'fan_of_knives',
    tier: 1,
    hint: 'Darting sprites are hard to stab. A handful of thrown knives might do better.',
    spark: { threat: 3, minParentRank: 5, families: ['sprite'] },
  },
  {
    from: 'stab',
    to: 'shadowstep',
    tier: 1,
    requires: [{ type: 'flag', id: 'kills', min: 25, label: 'Defeat 25 monsters' }],
    hint: 'Only one who has survived many battles learns to move unseen.',
  },

  // ---------------------------------------------------------------- T2 · backstab branch
  {
    from: 'backstab',
    to: 'assassinate',
    tier: 2,
    requires: [r5('shadowstep')],
    hint: 'Learn to arrive unseen, and one strike may be all a fight needs.',
  },
  {
    from: 'backstab',
    to: 'venom_edge',
    tier: 2,
    requires: [r5('fan_of_knives'), { type: 'flag', id: 'kill_gloomcap', min: 8, label: 'Defeat 8 Gloomcaps' }],
    hint: 'The mushrooms of the dark grove carry a potent toxin.',
    spark: { threat: 6, minParentRank: 4, families: ['sylvan'] },
  },

  // ---------------------------------------------------------------- T2 · fan_of_knives branch
  {
    from: 'fan_of_knives',
    to: 'blade_storm',
    tier: 2,
    requires: [r5('shadowstep')],
    hint: 'Vanish, and let your knives bloom outward from where you stood.',
  },
  {
    from: 'fan_of_knives',
    to: 'ricochet_knives',
    tier: 2,
    requires: [r5('backstab')],
    hint: 'A knife aimed at a vital point can glance off stone and find another.',
    spark: { threat: 5, minParentRank: 4, families: ['construct'] },
  },

  // ---------------------------------------------------------------- T2 · shadowstep branch
  {
    from: 'shadowstep',
    to: 'phantom_rush',
    tier: 2,
    requires: [r5('backstab')],
    hint: 'Every step could leave a cut behind, if your strikes were surer.',
  },
  {
    from: 'shadowstep',
    to: 'smoke_veil',
    tier: 2,
    requires: [r5('fan_of_knives'), { type: 'flag', id: 'ember_gathered', min: 4, label: 'Gather from 4 ember vents' }],
    hint: 'Ember vents breathe a smoke that hides a body well. Linger by the cinders, then learn to wear it.',
  },

  // ---------------------------------------------------------------- T3 capstones
  {
    from: 'assassinate',
    to: 'coup_de_grace',
    tier: 3,
    requires: [r5('venom_edge'), r5('phantom_rush'), { type: 'element', id: 'holy' }, DUSK_RELIC],
    hint: "A merciful end asks for venom's patience, a phantom's speed, a touch of holy light, and the Regent's dusk.",
  },
  {
    from: 'blade_storm',
    to: 'thousand_cuts',
    tier: 3,
    requires: [r5('ricochet_knives'), r5('venom_edge'), { type: 'element', id: 'wind' }, DUSK_RELIC],
    hint: 'Ricochet and venom, carried on the wind. Hold the dusk relic and no wound you open will ever close.',
  },
  {
    from: 'phantom_rush',
    to: 'nightfall_waltz',
    tier: 3,
    requires: [r5('smoke_veil'), r5('assassinate'), { type: 'element', id: 'shadow' }, DUSK_RELIC],
    hint: "Dance in smoke, finish in silence. Shadow and the Regent's dusk relic keep the waltz's time.",
  },
];
