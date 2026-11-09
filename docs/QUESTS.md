# Omnipath — Quests (v3)

Owner direction: **every NPC has quests**, and **NPCs that teach skills teach them as quest rewards — never as a shop**.
Discovery through *doing* stays (forging still attunes fire, fishing still attunes water…); quests wrap those
activities with story, guidance and rewards, and they are the ONLY way to obtain trainer techniques, trainer passives
and trainer essences.

## 1. Data model (`src/core/types.ts` additions; data in `src/data/quests.ts`)

```ts
type QuestObjective =
  | { kind: 'kill'; monster?: string; family?: Family; rank?: MonsterRank; count: number }   // counted after accept (elites count toward their base species)
  | { kind: 'gather'; node: NodeKind; count: number }                                        // counted after accept
  | { kind: 'deliver'; item: string; count: number }                                         // items consumed at turn-in (one objective per item)
  | { kind: 'visit'; map: string }                                                           // entering the map after accept
  | { kind: 'talk'; npc: string }                                                            // talk to another NPC after accept
  | { kind: 'use'; tag?: string; skill?: string; count: number }                             // engaged casts (first hit) with a matching skill
  | { kind: 'cast'; element?: ElementId; shape?: ShapeKind; tag?: string; map: string; count: number } // matching cast anywhere in that map
  | { kind: 'witness'; skill?: string; count: number }                                       // witness marks earned after accept; met once the echo is known
  | { kind: 'state'; requires: Requirement; label: string };                                 // a live condition (skill rank, element, class worn...)

interface QuestReward {
  lesson?: string;            // grants a trainer LessonDef's grant (skill / passive rank / essence / element) for free;
                              // left out of the turn-in payload when the player already owns it (teaches nothing)
  skill?: string; passive?: string; element?: ElementId;
  essences?: Record<string, number>;
  items?: Record<string, number>;
  coins?: number; exp?: number;
  whisper?: string;           // class id whose riddle is revealed
  flag?: string;              // sets this flag to >= 1 (e.g. unlock a follow-up area or story beat)
}

interface QuestDef {
  id: string;                 // '<npc>_<slug>'
  name: string;
  giver: string;              // NpcDef id
  turnIn?: string;            // NpcDef id (default giver)
  chain?: string;             // grouping for the quest log
  summary: string;            // one line for the log/tracker
  dialog: { offer: string; progress: string; complete: string };
  after?: string[];           // quests that must be completed first
  requires?: Requirement[];   // to be OFFERED
  objectives: QuestObjective[];
  rewards: QuestReward;
  repeatable?: { cooldownMs: number };   // bounties; cooldown on the game clock (book.now)
}
```
`LessonDef` gains `questOnly?: boolean` (content sets it on every lesson once the client shows quests; while set,
`takeLesson` refuses with "Learned through <quest name>"). `lessonState` reports `questOnly` and the `quest` id that
teaches the lesson, so the trainer panel can say so. Until the flip, a lesson taken at the trainer credits the
non-repeatable quest that teaches it (`creditLessonQuests`), so no lesson is ever taught twice and its chain opens.

Use / cast `tag` filters also match the authored skill a variant rolls up to (an infused basic attack still counts as
`basic`). `ItemDef.plural` names a count other than one where the English plural does not fit ('Lake Fish').

## 2. State (`SkillBookState.quests`, save v2 fill-in)
```ts
quests: {
  active: Record<string, { progress: number[]; acceptedAt: number }>;  // per-objective counters (state/deliver use 0)
  done: Record<string, number>;          // completion count
  cooldown: Record<string, number>;      // repeatable: next offer time (book.now ms)
  tracked: string[];                     // shown in the Pursuits tracker (max 3, newest first)
}
```
Migration (`migrateBookState` with the registry) fits counters to the current objectives, drops an active entry for a
non-repeatable quest already completed, keeps tracked ids only for known active quests, and credits the
non-repeatable quests teaching lessons already in `state.lessons` (saves from before quests).

## 3. Engine (`src/core/quests.ts`, pure; SkillBook wraps it)
- `questStatus(reg, state, ctx, id)` → `'locked' | 'available' | 'active' | 'ready' | 'done' | 'cooldown'`. A
  repeatable quest whose lesson is owned and that pays nothing else but coins and exp is exhausted: `'done'`
  (`questExhausted`; e.g. a passive drill once the passive is at max rank). `ctx.lessonOwned` supplies ownership.
- `questsFor(reg, state, ctx, npcId)` → the NPC's quests with status, sorted ready > available > active > cooldown > done;
  only that NPC's quests are evaluated (registry indexes). `questMarker(reg, state, ctx, npcId)` → `'?' | '!' | '…' | null`.
- `objectiveProgress(reg, state, ctx, id)` → `{ objective, have, need, done, text }[]` (deliver reads inventory against
  the sum the quest asks of that item; state reads requirements live; counters read `active.progress`).
  `objectivesDone(reg, state, ctx, id)` → the same done-ness without building texts.
- `notifyQuest(reg, state, event, ctx)` mutates counters for all active quests; events:
  `{ type: 'kill'; monster: MonsterDef }`, `{ type: 'gather'; node: NodeKind }`, `{ type: 'visit'; map }`,
  `{ type: 'talk'; npc; map? }`, `{ type: 'use'; skill: SkillDef }`, `{ type: 'cast'; skill: SkillDef; map }`,
  `{ type: 'witness'; skill }`. Returns ids whose status became `ready`. Pass `ctx`: without it, quests with deliver
  or state objectives are never reported ready (they only appear in `advanceQuests(...).progressed`).
- `acceptQuest(reg, state, ctx, id, at?)` / `abandonQuest` / `turnInQuest(reg, state, ctx, id, at?)` (checks every
  objective; consumes delivered items via the inventory; returns the reward payload — the SkillBook applies book-side
  rewards: lesson grant, skill, passive, element, essences, whisper, flag; the GAME applies coins, items and exp). With
  `at`, the quest must be that NPC's to give / to take; **an authoritative server always passes `at` and `ctx`**.
  `abandonQuest` also drops an active entry whose quest left the content.
- Turning a quest in at its NPC (`at` / `npc` given) also fires `talk` with that NPC for other quests; a turn-in that
  does not say where fires nothing.
- Deterministic; no Math.random / Date.now.

SkillBook API (additive): `quests(npcId?)`, `questMarker(npcId)`, `questStatus(id)`, `questProgress(id)`,
`acceptQuest(id, npc?)`, `abandonQuest(id)`, `turnInQuest(id, npc?) → { ok, message, rewards, gameRewards,
listenerError? }`, `notifyQuest(event)`, `refreshQuests()`, `trackQuest(id, on)`, `trackedQuests()`; events
`questAccepted`, `questProgress`, `questReady`, `questCompleted`. Live objectives (bag, state) are re-checked after the
book's own changes, after each `notifyQuest`, and on `refreshQuests()` (call it after the bag changes); the re-check
reads done-ness only (no texts), and `incFlag` runs it only for flags a quest `state` objective reads. Constructing the book and assigning `book.inv` record what is already met, so the first change after a
load is still announced. A listener that throws during a turn-in does not cut it short: every reward step runs,
`questCompleted` is emitted, and the first error comes back in `listenerError` (log or rethrow it after applying
`gameRewards`).

## 4. Content rules (validated by `tests/quests.test.ts`)
- **Every NPC** in `src/data/npcs.ts` gives ≥ 1 quest; trainers give one quest per lesson (chains are fine).
- **Every LessonDef** is the reward of exactly one quest (repeatable essence trades become repeatable *bounties*).
- Quests reference only existing ids; kill/gather/visit/cast targets must exist somewhere reachable (monster spawned
  in a map, node kind present in a map, map exists); flags only from the client flag contract; no soft-locks (every
  quest's chain is completable from a fresh save in the region it is offered). One kill never fills two objectives
  (a species objective next to its own elite takes `rank: 'common'`); one item has one deliver objective.
- Pacing: the first quest of every Hearth Vale NPC is offered from a fresh save (or right after an earlier
  same-NPC quest); Riftmarch quests require reaching Riftmarch, a Riftmarch NPC opens one chain at a time, and quests
  sending the player into a map well above the arrival band (11–13) carry a `level` requirement near that map's band.
- Rewards scale with effort. A lesson is the prize: lesson quests pay ≤ 10 coins (lesson bounties none); Hearth Vale
  story exp stays well below the exp to reach level 12, so fighting does most of the levelling.
- Every non-hidden Tier II class with a single Tier I parent has a Tamsin imprint quest for that parent that
  whispers it.
- Tone: short, warm, specific dialog (≤ 3 sentences per beat) that teaches a system (sparks, echoes, essences,
  fusion, classes, waystones) in-world, and matches its objectives (a `gather` is never "brought", a `visit` never
  "woken"). Quest text never spells out a fusion pair; the world's own hints (recipe whispers, the Barrow Vault lid)
  reveal them. Lesson blurbs describe what a lesson teaches, never its price. Original names only.

## 5. Client (docs/CLIENT-v3.md)
Quest markers over NPC heads (`!` available, `?` ready, `…` active), NPC dialog shows that NPC's quests (offer /
progress / turn-in with reward preview), a Quests tab in the Codex (log by chain, track toggle), the Pursuits tracker
shows tracked quests first, toasts on progress/ready/complete, reward cards. The trainer panel becomes the NPC's
quest list; lessons are never bought.
