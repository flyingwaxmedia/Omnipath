import type { FusionRecipe } from '../../core/types';

export const SWORD_RECIPES: FusionRecipe[] = [
  { a: 'el:fire', b: 'skill:whirlwind', result: 'skill:flame_spin', hint: 'A spinning blade could carry flame.' },
  { a: 'el:wind', b: 'skill:whirlwind', result: 'skill:tornado', hint: 'Your whirlwind longs to become a true wind.' },
  {
    a: 'skill:whirlwind',
    b: 'skill:sword_throw',
    result: 'skill:cyclone_blades',
    hint: 'What if a spin released thrown blades?',
  },
  { a: 'el:earth', b: 'skill:heavy_cleave', result: 'skill:earthsplitter', hint: 'A heavy blow could split the earth.' },
  {
    a: 'el:lightning',
    b: 'skill:sword_throw',
    result: 'skill:thunder_javelin',
    hint: 'A thrown blade could conduct lightning.',
  },
  { a: 'skill:flame_spin', b: 'skill:tornado', result: 'skill:firestorm', hint: 'Flame and wind, spinning as one...' },
];
