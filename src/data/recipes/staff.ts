import type { FusionRecipe } from '../../core/types';

export const STAFF_RECIPES: FusionRecipe[] = [
  { a: 'el:fire', b: 'skill:bolt', result: 'skill:firebolt', hint: 'The simplest spell could burn.' },
  { a: 'el:water', b: 'skill:bolt', result: 'skill:aqua_lance', hint: 'The simplest spell could flow like water.' },
  { a: 'el:lightning', b: 'skill:bolt', result: 'skill:lightning_bolt', hint: 'The simplest spell could crackle.' },
  { a: 'el:wind', b: 'skill:bolt', result: 'skill:wind_cutter', hint: 'The simplest spell could cut like wind.' },
  { a: 'el:holy', b: 'skill:bolt', result: 'skill:holy_light', hint: 'The simplest spell could shine.' },
  { a: 'el:earth', b: 'skill:arcane_nova', result: 'skill:quake', hint: 'A burst of magic could shake the ground.' },
  { a: 'el:fire', b: 'skill:arcane_nova', result: 'skill:inferno_ring', hint: 'A burst of magic could ring you in fire.' },
  { a: 'el:ice', b: 'skill:arcane_orb', result: 'skill:glacial_orb', hint: 'A slow orb would freeze all it passed.' },
  { a: 'el:storm', b: 'skill:arcane_nova', result: 'skill:thunderstorm', hint: 'A burst of magic could birth a storm.' },
  {
    a: 'skill:firebolt',
    b: 'skill:lightning_bolt',
    result: 'skill:plasma_lance',
    hint: 'Two elemental bolts, compressed into one beam.',
  },
  { a: 'el:holy', b: 'skill:meditation', result: 'skill:sanctuary', hint: 'Stillness could be filled with light.' },
];
