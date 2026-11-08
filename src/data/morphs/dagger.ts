import type { MorphDef } from '../../core/types';

export const DAGGER_MORPHS: MorphDef[] = [
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
];
