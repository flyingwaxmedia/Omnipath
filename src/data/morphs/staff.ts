import type { MorphDef } from '../../core/types';

export const STAFF_MORPHS: MorphDef[] = [
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
];
