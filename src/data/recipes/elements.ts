import type { ElementId, FusionRecipe } from '../../core/types';

// Element + element (SPEC-v2 §3 step 4 / §8).
//   - Four primal pairs fuse into a new element (ice, magma, storm, twilight).
//   - The other 17 primal pairs resonate instead: `el:a + el:b → passive:res_a_b` (a, b sorted), learned
//     once the player knows the first element well (2 authored skills of a) and has at least 1 of b.

export const FUSED_ELEMENT_RECIPES: FusionRecipe[] = [
  { a: 'el:water', b: 'el:wind', result: 'el:ice', hint: 'Water longs for the cold breath of the wind.' },
  { a: 'el:fire', b: 'el:earth', result: 'el:magma', hint: 'Fire yearns to melt the stone.' },
  { a: 'el:wind', b: 'el:lightning', result: 'el:storm', hint: 'Lightning rides upon the wind.' },
  { a: 'el:holy', b: 'el:shadow', result: 'el:twilight', hint: 'Light and dark, held in perfect balance...' },
];

/** A resonance between two primal elements (a < b): needs 2 authored `a` skills and 1 authored `b` skill. */
function resonance(a: ElementId, b: ElementId, hint: string): FusionRecipe {
  return {
    a: `el:${a}`,
    b: `el:${b}`,
    result: `passive:res_${a}_${b}`,
    requires: [
      { type: 'tagCount', tags: [a], count: 2 },
      { type: 'tagCount', tags: [b], count: 1 },
    ],
    hint,
  };
}

export const RESONANCE_RECIPES: FusionRecipe[] = [
  resonance('earth', 'holy', 'Stone and light could ring together, once your hands know the stone well.'),
  resonance('earth', 'lightning', 'Stone drinks lightning. Learn the stone twice over and it might learn to hold the charge.'),
  resonance('earth', 'shadow', 'The barrows are stone wrapped around the dark. A practised earth-hand could feel why.'),
  resonance('earth', 'water', 'Earth and water make mud, and mud holds fast. Know the earth well before you stir it.'),
  resonance('earth', 'wind', 'Wind that has learned the earth carries grit in every gust.'),
  resonance('fire', 'holy', 'Every altar keeps a flame. Tend fire long enough and it may learn to pray.'),
  resonance('fire', 'lightning', 'Lightning is only fire that forgot to wait. A seasoned flame might remember it.'),
  resonance('fire', 'shadow', 'Embers live longest in the dark. A practised flame could find them there.'),
  resonance('fire', 'water', 'Fire and water argue, and their argument scalds. Know fire well before you start one.'),
  resonance('fire', 'wind', 'A flame that knows you well will lean toward the wind.'),
  resonance('holy', 'lightning', 'Light and lightning both fall from the sky. A devout hand could make them fall together.'),
  resonance('holy', 'water', "Sister Alba blesses the font each morning. Holy hands, practised, could do the same."),
  resonance('holy', 'wind', 'Prayers are carried on the wind. Pray often enough and the wind will listen.'),
  resonance('lightning', 'shadow', 'Lightning makes the brightest light, and so the deepest shadow. Master the bolt first.'),
  resonance('lightning', 'water', 'Water carries lightning further than any wire. A practised bolt would know it.'),
  resonance('shadow', 'water', 'Brine finds every wound the dark has opened. Know the dark well first.'),
  resonance('shadow', 'wind', 'A night wind hides every footstep. Walk with shadow long enough to hear it.'),
];

export const ELEMENT_RECIPES: FusionRecipe[] = [...FUSED_ELEMENT_RECIPES, ...RESONANCE_RECIPES];
