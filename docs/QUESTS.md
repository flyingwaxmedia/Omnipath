# Omnipath — Quests (v3)

Owner direction: **every NPC has quests**, and **NPCs that teach skills teach them as quest rewards — never as a shop**.
Discovery through *doing* stays (forging still attunes fire, fishing still attunes water…); quests wrap those
activities with story, guidance and rewards, and they are the ONLY way to obtain trainer techniques, trainer passives
and trainer essences.

## 1. Data model (`src/core/types.ts` additions; data in `src/data/quests.ts`)

```ts
type QuestObjective =
  | { kind: 'kill'; monster?: string; family?: Family; rank?: MonsterRank; count: number }   // counted after accept
  | { kind: 'gather'; node: NodeKind; count: number }                                        // counted after accept
  | { kind: 'deliver'; item: string; count: number }                                         // items consumed at turn-in
  | { kind: 'visit'; map: string }                                                           // entering the map after accept
  | { kind: 'talk'; npc: string }                                                            // talk to another NPC after accept
  | { kind: 'use'; tag?: string; skill?: string; count: number }                             // engaged casts (first hit) with a matching skill
  | { kind: 'cast'; element?: ElementId; shape?: ShapeKind; tag?: string; map: string; count: number } // matching cast anywhere in that map
  | { kind: 'witness'; skill?: string; count: number }                                       // witness marks earned after accept
  | { kind: 'state'; requires: Requirement; label: string };                                 // a live condition (skill rank, element, class worn...)

interface QuestReward {
  lesson?: string;            // grants a trainer LessonDef's grant (skill / passive rank / essence / element) for free
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
`takeLesson` refuses with "Learned through <quest name>").

## 2. State (`SkillBookState.quests`, save v2 fill-in)
```ts
quests: {
  active: Record<string, { progress: number[]; acceptedAt: number }>;  // per-objective counters (state/deliver use 0)
  done: Record<string, number>;          // completion count
  cooldown: Record<string, number>;      // repeatable: next offer time (book.now ms)
  tracked: string[];                     // shown in the Pursuits tracker (max 3, newest first)
}
```

## 3. Engine (`src/core/quests.ts`, pure; SkillBook wraps it)
- `questStatus(reg, state, ctx, id)` → `'locked' | 'available' | 'active' | 'ready' | 'done' | 'cooldown'`.
- `questsFor(reg, state, ctx, npcId)` → the NPC's quests with status, sorted ready > available > active > cooldown > done.
- `objectiveProgress(reg, state, ctx, id)` → `{ objective, have, need, done, text }[]` (deliver reads inventory; state
  reads requirements live; counters read `active.progress`).
- `notifyQuest(reg, state, event)` mutates counters for all active quests; events:
  `{ type: 'kill'; monster: MonsterDef }`, `{ type: 'gather'; node: NodeKind }`, `{ type: 'visit'; map }`,
  `{ type: 'talk'; npc }`, `{ type: 'use'; skill: SkillDef }`, `{ type: 'cast'; skill: SkillDef; map }`,
  `{ type: 'witness'; skill }`. Returns ids whose status became `ready`.
- `acceptQuest` / `abandonQuest` / `turnInQuest(reg, state, ctx, id)` (checks every objective; consumes delivered items
  via the inventory; returns the reward payload — the SkillBook applies book-side rewards: lesson grant, skill,
  passive, element, essences, whisper, flag; the GAME applies coins, items and exp).
- Talking to a quest's turn-in NPC also fires `talk` for other quests.
- Deterministic; no Math.random / Date.now.

SkillBook API (additive): `quests(npcId?)`, `questStatus(id)`, `questProgress(id)`, `acceptQuest(id)`,
`abandonQuest(id)`, `turnInQuest(id) → { ok, message, rewards }`, `notifyQuest(event)`, `trackQuest(id, on)`,
`trackedQuests()`; events `questAccepted`, `questProgress`, `questReady`, `questCompleted`.

## 4. Content rules (validated by `tests/quests.test.ts`)
- **Every NPC** in `src/data/npcs.ts` gives ≥ 1 quest; trainers give one quest per lesson (chains are fine).
- **Every LessonDef** is the reward of exactly one quest (repeatable essence trades become repeatable *bounties*).
- Quests reference only existing ids; kill/gather/visit/cast targets must exist somewhere reachable (monster spawned
  in a map, node kind present in a map, map exists); flags only from the client flag contract; no soft-locks (every
  quest's chain is completable from a fresh save in the region it is offered).
- Pacing: the first quest of every Hearth Vale NPC is offered from a fresh save (or right after an earlier
  same-NPC quest); Riftmarch quests require reaching Riftmarch. Rewards scale with effort.
- Tone: short, warm, specific dialog (≤ 3 sentences per beat) that teaches a system (sparks, echoes, essences,
  fusion, classes, waystones) in-world. Original names only.

## 5. Client (docs/CLIENT-v3.md)
Quest markers over NPC heads (`!` available, `?` ready, `…` active), NPC dialog shows that NPC's quests (offer /
progress / turn-in with reward preview), a Quests tab in the Codex (log by chain, track toggle), the Pursuits tracker
shows tracked quests first, toasts on progress/ready/complete, reward cards. The trainer panel becomes the NPC's
quest list; lessons are never bought.
