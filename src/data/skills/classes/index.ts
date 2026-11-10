import type { SkillDef } from '../../../core/types';
import { ARCANIST_SKILLS } from './arcanist';
import { BLADEMASTER_SKILLS } from './blademaster';
import { KNIFE_JUGGLER_SKILLS } from './knife_juggler';
import { PYROBLADE_SKILLS } from './pyroblade';
import { PYROMANCER_SKILLS } from './pyromancer';
import { SHADOWSTALKER_SKILLS } from './shadowstalker';
import { TIDECALLER_SKILLS } from './tidecaller';
import { WAYFARER_SKILLS } from './wayfarer';

/** The class skills of the rebuilt classes (SPEC-v4 §3.6): 5 per class, each `classOf` its class. */
export const CLASS_SKILLS: SkillDef[] = [
  ...BLADEMASTER_SKILLS,
  ...KNIFE_JUGGLER_SKILLS,
  ...ARCANIST_SKILLS,
  ...WAYFARER_SKILLS,
  ...PYROBLADE_SKILLS,
  ...SHADOWSTALKER_SKILLS,
  ...PYROMANCER_SKILLS,
  ...TIDECALLER_SKILLS,
];
