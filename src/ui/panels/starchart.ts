// The Star Chart (starchart lane; docs/CLIENT-v3.md §3): the Skills button opens it. Tabs Chart | List | Passives |
// Essences (later tabs only once they have content). Chart = the night sky drawn from ctrl.starChartData() laid out
// by ../starchart/layout.ts; List / Passives / Essences reuse the v2 skills panel views (./skills.ts).
// Panel 'skills', arg: a tab id ('chart' | 'list' | 'passives' | 'essences') or 'star:<skillId>' (centre on it).
//
// Skeleton: the v2 skills panel. LANE starchart: the sky.
import type { PanelHost } from './common';
import { renderSkills } from './skills';

export function renderStarChart(host: PanelHost, arg?: string): void {
  renderSkills(host, arg?.startsWith('star:') ? arg.slice(5) : arg);
}
