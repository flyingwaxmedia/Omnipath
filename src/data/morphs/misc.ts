import type { MorphDef } from '../../core/types';

export const MISC_MORPHS: MorphDef[] = [
  {
    from: 'quickstep',
    to: 'shadowstep',
    requires: [{ type: 'element', id: 'shadow' }],
    hint: 'Your footwork could vanish entirely, if you knew the dark.',
  },
  { from: 'meditation', to: 'focus' },
];
