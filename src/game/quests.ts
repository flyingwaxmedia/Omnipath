// Quest hooks (game lane; docs/QUESTS.md §3/§5, docs/CLIENT-v3.md §4, docs/INTEGRATION-v3.md §2.3): what the player
// does in the world reaches the SkillBook's quest counters. The world already announces everything on the game bus,
// so this module only listens and forwards — Combat, Interactions and MapScene stay untouched:
//
//   kill      a monster died to the player            → { type: 'kill', monster }
//   gather    a node paid out                         → { type: 'gather', node }
//   visit     the player entered a map (every entry)  → { type: 'visit', map }
//   talk      the player talked to an NPC             → { type: 'talk', npc, map }
//   use       an ENGAGED cast: its first hit           → { type: 'use', skill }   (once per cast)
//   cast      any cast, with the map it happened in   → { type: 'cast', skill, map }
//   witness   a witness mark was earned (book event)  → { type: 'witness', skill }
//
// Bag changes re-check deliveries through Session.addItem (coalesced); accept / turn-in live in views.ts.
// Wired ONCE per run (the bus and the book outlive map restarts); returns the unsubscribe function.
import type { SkillBook } from '../core/skillbook';
import { type EventBus, type GameEvents, gameBus } from './events';

/** How many recent cast ids remember their 'use' (a cast's hits arrive within a second or two). */
const RECENT_CASTS = 64;

export function wireQuestHooks(book: SkillBook, bus: EventBus<GameEvents> = gameBus): () => void {
  const used: number[] = [];
  const offs = [
    bus.on('kill', ({ def }) => book.notifyQuest({ type: 'kill', monster: def })),
    bus.on('gather', ({ node }) => book.notifyQuest({ type: 'gather', node })),
    bus.on('mapEnter', ({ map }) => book.notifyQuest({ type: 'visit', map })),
    bus.on('talk', ({ npcId, map }) => book.notifyQuest({ type: 'talk', npc: npcId, map })),
    bus.on('castFire', ({ skill, map }) => book.notifyQuest({ type: 'cast', skill, map })),
    bus.on('hit', ({ skill, castId, hitIndex, resisted }) => {
      // One 'use' per engaged cast: the first hit of each cast id (reprises and arc zaps share their cast's id).
      if (castId === undefined) {
        if (hitIndex === 0 && !resisted) book.notifyQuest({ type: 'use', skill });
        return;
      }
      if (used.includes(castId)) return;
      used.push(castId);
      if (used.length > RECENT_CASTS) used.shift();
      book.notifyQuest({ type: 'use', skill });
    }),
    book.events.on('witness', ({ skill }) => book.notifyQuest({ type: 'witness', skill })),
  ];
  return () => offs.forEach((off) => off());
}
