import type { MorphDef } from '../../core/types';
import { DAGGER_MORPHS } from './dagger';
import { FIST_MORPHS } from './fists';
import { MISC_MORPHS } from './misc';
import { STAFF_MORPHS } from './staff';
import { SWORD_MORPHS } from './sword';

export const MORPHS: MorphDef[] = [...SWORD_MORPHS, ...DAGGER_MORPHS, ...STAFF_MORPHS, ...FIST_MORPHS, ...MISC_MORPHS];
