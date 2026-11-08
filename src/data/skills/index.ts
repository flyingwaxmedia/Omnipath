import type { SkillDef } from '../../core/types';
import { CROSS_SKILLS } from './cross';
import { DAGGER_SKILLS } from './dagger';
import { ECHO_SKILLS } from './echoes';
import { MONSTER_SKILLS } from './monster';
import { SIGNATURE_SKILLS } from './signatures';
import { STAFF_SKILLS } from './staff';
import { SWORD_SKILLS } from './sword';
import { TECHNIQUE_SKILLS } from './techniques';
import { UNIVERSAL_SKILLS } from './universal';

export const SKILLS: SkillDef[] = [
  ...SWORD_SKILLS,
  ...DAGGER_SKILLS,
  ...STAFF_SKILLS,
  ...CROSS_SKILLS,
  ...UNIVERSAL_SKILLS,
  ...TECHNIQUE_SKILLS,
  ...ECHO_SKILLS,
  ...MONSTER_SKILLS,
  ...SIGNATURE_SKILLS,
];
