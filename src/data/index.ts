import { Registry } from '../core/registry';
import type { GameData } from '../core/types';
import { CLASS_PASSIVES, CLASSES } from './classes';
import { ELEMENTS } from './elements';
import { ESSENCES } from './essences';
import { ITEMS } from './items';
import { MONSTERS } from './monsters';
import { MORPHS } from './morphs';
import { PASSIVES } from './passives';
import { RECIPES } from './recipes';
import { SKILLS } from './skills';
import { TRAINERS } from './trainers';

export const GAME_DATA: GameData = {
  dataVersion: 2,
  elements: ELEMENTS,
  skills: SKILLS,
  morphs: MORPHS,
  recipes: RECIPES,
  classes: CLASSES,
  essences: ESSENCES,
  passives: [...PASSIVES, ...CLASS_PASSIVES],
  trainers: TRAINERS,
  monsters: MONSTERS,
  items: ITEMS,
};

export function createRegistry(): Registry {
  return new Registry(GAME_DATA);
}
