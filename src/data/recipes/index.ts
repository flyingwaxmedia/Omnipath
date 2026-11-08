import type { FusionRecipe } from '../../core/types';
import { CROSS_RECIPES } from './cross';
import { DAGGER_RECIPES } from './dagger';
import { ELEMENT_RECIPES } from './elements';
import { STAFF_RECIPES } from './staff';
import { SWORD_RECIPES } from './sword';

export const RECIPES: FusionRecipe[] = [
  ...ELEMENT_RECIPES,
  ...SWORD_RECIPES,
  ...DAGGER_RECIPES,
  ...STAFF_RECIPES,
  ...CROSS_RECIPES,
];
