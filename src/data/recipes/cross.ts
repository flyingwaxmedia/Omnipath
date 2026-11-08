import type { FusionRecipe } from '../../core/types';

export const CROSS_RECIPES: FusionRecipe[] = [
  {
    a: 'skill:whirlwind',
    b: 'skill:arcane_nova',
    result: 'skill:arcane_cyclone',
    hint: 'A spinning blade could carry a burst of magic.',
  },
  {
    a: 'skill:sword_throw',
    b: 'skill:bolt',
    result: 'skill:spell_sabre',
    hint: 'Magic could throw a blade for you.',
  },
  { a: 'skill:backstab', b: 'skill:bolt', result: 'skill:hex_blade', hint: 'A dagger could carry a curse.' },
  { a: 'skill:slash', b: 'skill:stab', result: 'skill:twin_fang', hint: 'Sword and dagger could strike together.' },
];
