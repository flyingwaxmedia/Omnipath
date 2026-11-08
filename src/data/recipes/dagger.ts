import type { FusionRecipe } from '../../core/types';

export const DAGGER_RECIPES: FusionRecipe[] = [
  { a: 'el:shadow', b: 'skill:backstab', result: 'skill:umbral_strike', hint: 'Strike from within the shadow itself.' },
  { a: 'el:fire', b: 'skill:fan_of_knives', result: 'skill:ember_fan', hint: 'Knives heated red would spread fire.' },
  {
    a: 'el:lightning',
    b: 'skill:fan_of_knives',
    result: 'skill:static_needles',
    hint: 'Many needles... many paths for lightning.',
  },
  { a: 'skill:shadowstep', b: 'skill:backstab', result: 'skill:ambush', hint: 'Arrive unseen, strike unseen.' },
];
