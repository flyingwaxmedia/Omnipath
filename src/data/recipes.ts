import type { FusionRecipe } from '../core/types';

/**
 * Authored fusion recipes. Any element + any unaligned attack that has no
 * authored recipe still fuses procedurally into an "infused" variant
 * (e.g. Fire + Sword Throw = Blazing Sword Throw), so the combination space
 * is far larger than this list.
 */
export const RECIPES: FusionRecipe[] = [
  // ---- Element + Element = new element ----
  { a: 'el:water', b: 'el:wind', result: 'el:ice', hint: 'Water longs for the cold breath of the wind.' },
  { a: 'el:fire', b: 'el:earth', result: 'el:magma', hint: 'Fire yearns to melt the stone.' },
  { a: 'el:wind', b: 'el:lightning', result: 'el:storm', hint: 'Lightning rides upon the wind.' },
  { a: 'el:holy', b: 'el:shadow', result: 'el:twilight', hint: 'Light and dark, held in perfect balance...' },

  // ---- Sword ----
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

  // ---- Dagger ----
  { a: 'el:shadow', b: 'skill:backstab', result: 'skill:umbral_strike', hint: 'Strike from within the shadow itself.' },
  { a: 'el:fire', b: 'skill:fan_of_knives', result: 'skill:ember_fan', hint: 'Knives heated red would spread fire.' },
  {
    a: 'el:lightning',
    b: 'skill:fan_of_knives',
    result: 'skill:static_needles',
    hint: 'Many needles... many paths for lightning.',
  },
  { a: 'skill:shadowstep', b: 'skill:backstab', result: 'skill:ambush', hint: 'Arrive unseen, strike unseen.' },

  // ---- Staff ----
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

  // ---- Cross-weapon (requires training more than one weapon) ----
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
