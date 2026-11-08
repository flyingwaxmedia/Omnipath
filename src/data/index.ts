import { Registry } from '../core/registry';
import type { GameData } from '../core/types';
import { CLASSES } from './classes';
import { ELEMENTS } from './elements';
import { MORPHS } from './morphs';
import { RECIPES } from './recipes';
import { SKILLS } from './skills';

export const GAME_DATA: GameData = {
  elements: ELEMENTS,
  skills: SKILLS,
  morphs: MORPHS,
  recipes: RECIPES,
  classes: CLASSES,
};

export function createRegistry(): Registry {
  return new Registry(GAME_DATA);
}
