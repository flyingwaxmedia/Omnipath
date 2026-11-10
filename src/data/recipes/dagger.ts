import type { FusionRecipe } from '../../core/types';

export const DAGGER_RECIPES: FusionRecipe[] = [
  // ---------------------------------------------------------------- v1
  { a: 'el:shadow', b: 'skill:backstab', result: 'skill:umbral_strike', hint: 'Strike from within the shadow itself.' },
  { a: 'el:fire', b: 'skill:fan_of_knives', result: 'skill:ember_fan', hint: 'Knives heated red would spread fire.' },
  {
    a: 'el:lightning',
    b: 'skill:fan_of_knives',
    result: 'skill:static_needles',
    hint: 'Many needles... many paths for lightning.',
  },
  { a: 'skill:shadowstep', b: 'skill:backstab', result: 'skill:ambush', hint: 'Arrive unseen, strike unseen.' },

  // ---------------------------------------------------------------- v2: element + new T2 node
  {
    a: 'el:wind',
    b: 'skill:ricochet_knives',
    result: 'skill:gyre_knives',
    hint: 'A knife that bounces could ride the wind and never land.',
  },
  {
    a: 'el:shadow',
    b: 'skill:smoke_veil',
    result: 'skill:gloom_shroud',
    hint: 'Smoke is only a poor cousin of true shadow.',
  },

  // ---------------------------------------------------------------- v4: the two old class signatures that stay
  // ordinary dagger skills once their classes merge (SPEC-v4 §3.7)
  {
    a: 'el:shadow',
    b: 'skill:phantom_rush',
    result: 'skill:phantom_sig',
    hint: 'A rush that leaves an afterimage could become one, with enough shadow.',
  },
  {
    a: 'el:wind',
    b: 'skill:blade_storm',
    result: 'skill:vortex_dancer_sig',
    hint: 'A bloom of knives, caught by the wind and wound into a coil.',
  },

  // ---------------------------------------------------------------- v2: skill + echo
  {
    a: 'skill:venom_edge',
    b: 'skill:spore_burst',
    result: 'skill:blight_whirl',
    hint: "The Matriarch's spores and your venom would make a wicked cloud.",
  },
  {
    a: 'skill:backstab',
    b: 'skill:grave_chill',
    result: 'skill:coffin_nail',
    hint: 'The barrow cold could ride a single needle, thrown true.',
  },
  {
    a: 'skill:smoke_veil',
    b: 'skill:lunar_dust',
    result: 'skill:moonveil',
    hint: 'Moth-dust and smoke, glittering together under the moon.',
  },

  // ---------------------------------------------------------------- v2: skill + technique
  {
    a: 'skill:backstab',
    b: 'skill:palm_strike',
    result: 'skill:pressure_point',
    hint: "The hermit's palm knows where the nerves gather. So could your blade.",
  },
];
