import type { FusionRecipe } from '../../core/types';

export const SWORD_RECIPES: FusionRecipe[] = [
  // ---------------------------------------------------------------- v1
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

  // ---------------------------------------------------------------- v2: elements + new nodes
  {
    a: 'el:fire',
    b: 'skill:sundering_blow',
    result: 'skill:molten_sunder',
    hint: 'Iron struck twice while it glows keeps the shape. Your sundering blow could carry the forge.',
  },
  {
    a: 'el:water',
    b: 'skill:crescent_sweep',
    result: 'skill:tidal_crescent',
    hint: 'A crescent is half a wave. Give it water and it might break like one.',
  },

  // ---------------------------------------------------------------- v2: echoes
  {
    a: 'skill:heavy_cleave',
    b: 'skill:boulder_roll',
    result: 'skill:rockslide_charge',
    hint: 'Something in the quarry arrives like a landslide. Your cleave could learn to arrive the same way.',
  },
  {
    a: 'skill:whirlwind',
    b: 'skill:spore_burst',
    result: 'skill:rotspore_whirl',
    hint: 'Spores ride any wind, even the one your blade makes.',
  },

  // ---------------------------------------------------------------- v2: techniques
  {
    a: 'skill:sword_throw',
    b: 'skill:hammer_toss',
    result: 'skill:cleaver_toss',
    hint: 'The smith throws his hammer like a blade. Could you throw your blade like a hammer?',
  },
  {
    a: 'skill:crescent_sweep',
    b: 'skill:palm_strike',
    result: 'skill:spirit_crescent',
    hint: 'The hermit strikes without touching. A crescent could fly the same way.',
  },
];
