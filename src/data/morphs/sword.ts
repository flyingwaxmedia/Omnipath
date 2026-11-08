import type { MorphDef } from '../../core/types';

export const SWORD_MORPHS: MorphDef[] = [
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
];
