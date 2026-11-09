// Panel registration (starchart lane): 'skills' (the Star Chart) and 'skill' (the simple skill card, arg = skill id).
import type { PanelRender } from '../panels/common';
import { renderStarChart } from '../panels/starchart';
import { renderSkillCard } from './card';

export const STARCHART_PANELS: Record<string, PanelRender> = {
  skills: renderStarChart,
  skill: renderSkillCard,
};

/** Panels that cover the whole screen (the render lane may sleep the game loop under them). */
export const STARCHART_FULLSCREEN: ReadonlySet<string> = new Set(['skills']);
