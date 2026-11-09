// Panel registration (panels lane): every modal panel this lane owns, by the name ui.open() uses.
// The UI merges this with STARCHART_PANELS (src/ui/starchart/index.ts) and HUD_PANELS (src/ui/picker.ts);
// names must not collide (docs/INTEGRATION-v3.md §6 lists every panel name and its arg).
import { renderAltar } from './altar';
import { renderBag } from './bag';
import { renderClasses } from './classes';
import { renderCodex } from './codex';
import type { PanelRender } from './common';
import { renderMap } from './map';
import { renderTrainer } from './trainer';

/** Panels of this lane that cover the whole screen (uiOpen.fullscreen: the render lane sleeps the game loop). */
export const PANELS_FULLSCREEN: ReadonlySet<string> = new Set<string>();

export const PANELS: Record<string, PanelRender> = {
  altar: renderAltar,
  classes: renderClasses,
  codex: renderCodex,
  bag: renderBag,
  trainer: renderTrainer,
  map: renderMap,
};
