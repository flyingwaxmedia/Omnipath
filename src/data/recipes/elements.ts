import type { FusionRecipe } from '../../core/types';

export const ELEMENT_RECIPES: FusionRecipe[] = [
  { a: 'el:water', b: 'el:wind', result: 'el:ice', hint: 'Water longs for the cold breath of the wind.' },
  { a: 'el:fire', b: 'el:earth', result: 'el:magma', hint: 'Fire yearns to melt the stone.' },
  { a: 'el:wind', b: 'el:lightning', result: 'el:storm', hint: 'Lightning rides upon the wind.' },
  { a: 'el:holy', b: 'el:shadow', result: 'el:twilight', hint: 'Light and dark, held in perfect balance...' },
];
