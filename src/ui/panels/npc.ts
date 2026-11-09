// NPC dialog (panels lane; docs/CLIENT-v3.md §4, docs/QUESTS.md §5): talking to an NPC opens this — the NPC's line,
// its quests (offer → Accept / Later; active → progress lines; ready → Complete with the reward preview) and its role
// actions (Forge, Buy, Travel, Sell…). The game builds the view (Interactions → ui.npcDialog); quest data comes from
// ctrl.npcQuests(npcId) and actions go through ctrl.acceptQuest / ctrl.turnInQuest with the NPC id.
//
// Skeleton: the v2 dialog (line + role actions), unchanged. LANE panels: the quest-aware dialog.
import type { NpcDialogView } from '../controller';
import type { PanelHost } from './common';

export function openNpcDialog(host: PanelHost, view: NpcDialogView): void {
  host.dialog(view.name, view.portrait, view.line, view.options);
}
