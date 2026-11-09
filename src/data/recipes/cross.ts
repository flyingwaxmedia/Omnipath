import type { FusionRecipe } from '../../core/types';

// Cross recipes: results in src/data/skills/cross.ts.
//   v1: cross-weapon fusions. v2: echo + weapon skill, echo + technique, and sword + dagger.

export const CROSS_RECIPES: FusionRecipe[] = [
  // ---------------------------------------------------------------- v1
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

  // ---------------------------------------------------------------- v2: echo + weapon skill
  {
    a: 'skill:whirlwind',
    b: 'skill:boulder_roll',
    result: 'skill:millstone_whirl',
    hint: 'The Boulderback rolls like a millstone. A spinning blade could learn to roll the same way.',
  },
  {
    a: 'skill:fan_of_knives',
    b: 'skill:gale_feather',
    result: 'skill:fletched_fan',
    hint: 'Galeplume quills fly true for a very long way. Your knives could borrow their fletching.',
  },
  {
    a: 'skill:shadowstep',
    b: 'skill:ember_pounce',
    result: 'skill:ashen_pounce',
    hint: 'The Emberkit Alpha pounces out of its own smoke. Your step could vanish the same way, and land burning.',
  },
  {
    a: 'skill:arcane_orb',
    b: 'skill:bubble_lance',
    result: 'skill:undertow_orb',
    hint: "The Brinewisp's lance is a river held still. Wrap it in an orb and the whole lake might follow.",
  },
  {
    a: 'skill:sword_throw',
    b: 'skill:static_charge',
    result: 'skill:thunder_tether',
    hint: "Voltmane's charge always finds its way back to it. A thrown blade could ride that leash home.",
  },
  {
    a: 'skill:boomerang_blade',
    b: 'skill:static_charge',
    result: 'skill:thunder_tether',
    hint: 'A blade that already comes home could carry lightning there and back.',
  },

  // ---------------------------------------------------------------- v2: echo + technique
  {
    a: 'skill:hook_pull',
    b: 'skill:grave_chill',
    result: 'skill:grave_hook',
    hint: 'The barrow cold clings to whatever it touches. A hook dipped in it would never let go.',
  },
  {
    a: 'skill:palm_strike',
    b: 'skill:static_charge',
    result: 'skill:static_palm',
    hint: 'Oru says force moves through the body like water. Lightning moves faster still.',
  },
  {
    a: 'skill:hammer_toss',
    b: 'skill:geode_spikes',
    result: 'skill:crystal_mallet',
    hint: 'Geodes split along their seams when struck. A thrown hammer could do the striking.',
  },
  {
    a: 'skill:shoulder_charge',
    b: 'skill:tremor_stomp',
    result: 'skill:quakestride',
    hint: 'The Colossus shakes the ground with every step. Charge the way it walks and the ground might follow.',
  },

  // ---------------------------------------------------------------- v2: across weapons
  {
    a: 'skill:heavy_cleave',
    b: 'skill:backstab',
    result: 'skill:felling_cut',
    hint: "A sword's weight and a dagger's aim. Together they would go for the legs.",
  },
];
