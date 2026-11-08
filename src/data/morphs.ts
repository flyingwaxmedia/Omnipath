import type { MorphDef } from '../core/types';

/**
 * Morphs: when a skill hits max rank it earns a morph charge. Spending a
 * charge teaches one of these forms while keeping the original skill.
 * Locked morphs only show their hint until their requirements are met.
 */
export const MORPHS: MorphDef[] = [
  // Sword
  { from: 'slash', to: 'whirlwind' },
  { from: 'slash', to: 'sword_throw' },
  {
    from: 'slash',
    to: 'heavy_cleave',
    requires: [{ type: 'flag', id: 'ore_mined', min: 6, label: 'Mine 6 ore' }],
    hint: 'Your swing could learn real weight from striking stone.',
  },
  { from: 'whirlwind', to: 'spinning_assault' },
  { from: 'sword_throw', to: 'boomerang_blade' },
  {
    from: 'sword_throw',
    to: 'blade_volley',
    requires: [{ type: 'level', min: 6 }],
    hint: 'A more seasoned adventurer could throw more than one blade.',
  },
  { from: 'heavy_cleave', to: 'guillotine' },

  // Dagger
  { from: 'stab', to: 'backstab' },
  { from: 'stab', to: 'fan_of_knives' },
  {
    from: 'stab',
    to: 'shadowstep',
    requires: [{ type: 'flag', id: 'kills', min: 25, label: 'Defeat 25 monsters' }],
    hint: 'Only one who has survived many battles learns to move unseen.',
  },
  { from: 'backstab', to: 'assassinate' },
  {
    from: 'backstab',
    to: 'venom_edge',
    requires: [{ type: 'flag', id: 'kill_gloomcap', min: 8, label: 'Defeat 8 Gloomcaps' }],
    hint: 'The mushrooms of the dark grove carry a potent toxin.',
  },
  { from: 'fan_of_knives', to: 'blade_storm' },
  { from: 'shadowstep', to: 'phantom_rush' },

  // Staff
  { from: 'bolt', to: 'arcane_orb' },
  { from: 'bolt', to: 'arcane_nova' },
  {
    from: 'bolt',
    to: 'focus',
    requires: [{ type: 'flag', id: 'meditations', min: 1, label: 'Meditate at a shrine' }],
    hint: 'A still mind sharpens magic. Seek a place of meditation high in the hills.',
  },
  { from: 'arcane_orb', to: 'singularity' },
  { from: 'arcane_nova', to: 'arcane_barrage' },
  {
    from: 'firebolt',
    to: 'meteor',
    requires: [{ type: 'level', min: 8 }],
    hint: 'Fire that falls from the sky answers only to the experienced.',
  },

  // Alternate paths to the same skill — discovery is never a single road.
  {
    from: 'quickstep',
    to: 'shadowstep',
    requires: [{ type: 'element', id: 'shadow' }],
    hint: 'Your footwork could vanish entirely, if you knew the dark.',
  },
  { from: 'meditation', to: 'focus' },
];
