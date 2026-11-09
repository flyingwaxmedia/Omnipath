// afterimage: runtime-only (dash ghosts, blink slices, reprise mirror). The runtime snapshots the actor's own frame,
// tint-fills it with the family R3 and steps its alpha (never tweened). Nothing is baked.
import type { Template } from '../types';
import { mkKey, type TemplateOptions } from './kit';

export const afterimage: Template<'afterimage'> = {
  id: 'afterimage',
  use: () => 'runtime',
  dirs: () => 1,
  key: (p, _motif, opts: TemplateOptions) => mkKey('afterimage', { mode: p.mode, steps: p.steps }, null, opts),
  frames: () => [],
};
