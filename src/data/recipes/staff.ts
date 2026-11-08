import type { FusionRecipe } from '../../core/types';

export const STAFF_RECIPES: FusionRecipe[] = [
  // ---------------------------------------------------------------- v1
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

  // ---------------------------------------------------------------- v2: elements + new nodes
  {
    a: 'el:water',
    b: 'skill:resonant_pulse',
    result: 'skill:tidal_ripple',
    hint: 'Drop a stone in Mirror Lake and the rings spread forever. Your pulse could ripple the same way.',
  },
  {
    a: 'el:holy',
    b: 'skill:prism_orb',
    result: 'skill:dawn_prism',
    hint: 'A prism is hungry for light. Feed yours the holy, and every colour it splits will burn like dawn.',
  },

  // ---------------------------------------------------------------- v2: echoes
  {
    a: 'skill:arcane_barrage',
    b: 'skill:gale_feather',
    result: 'skill:featherstorm',
    hint: 'The Galeplume sheds feathers sharp as darts. Your barrage could learn to fly on them.',
  },
  {
    a: 'skill:singularity',
    b: 'skill:geode_spikes',
    result: 'skill:geode_maw',
    hint: 'A geode is a hollow lined with teeth. Your singularity could open one beneath your foes.',
  },
  {
    a: 'skill:resonant_pulse',
    b: 'skill:thunder_stomp',
    result: 'skill:thunder_peal',
    hint: 'When Thunderhoof stamps, the plateau rings like a struck bell. So could your pulse.',
  },

  // ---------------------------------------------------------------- v2: techniques
  {
    a: 'skill:arcane_orb',
    b: 'skill:net_throw',
    result: 'skill:tangle_orb',
    hint: "Pell's nets drift and settle over anything slow enough. An orb could weave a net of its own.",
  },
  {
    a: 'skill:quicken',
    b: 'skill:flare_dash',
    result: 'skill:cinder_blink',
    hint: 'A quickened step and a burst of flame: together they might carry you forward in a blink.',
  },
  {
    a: 'skill:arcane_ward',
    b: 'skill:mending_light',
    result: 'skill:halo_ward',
    hint: "Sister Alba's light mends. Folded into your ward, it might guard as well.",
  },
];
