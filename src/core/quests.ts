// Quest engine (docs/QUESTS.md §2-§3). Pure functions over a Registry, a SkillBookState and a
// QuestContext the SkillBook implements; the SkillBook wraps them, applies book-side rewards and emits
// events. Deterministic: game time only comes from `ctx.now()`, and nothing here touches the DOM, the
// engine or randomness, so an authoritative server can run the same rules on its copy of the player.
import type { Registry } from './registry';
import { describeRequirement, meetsRequirement, type RequirementContext } from './requirements';
import { emptyQuestState, type QuestState, type SkillBookState } from './state';
import type {
  Family,
  MonsterDef,
  MonsterRank,
  QuestDef,
  QuestNodeKind,
  QuestObjective,
  QuestReward,
  SkillDef,
} from './types';

// ------------------------------------------------------------------ types

/**
 * Where a quest stands for the player: 'locked' (an `after` quest is not completed or a `requires`
 * entry is unmet), 'available' (can be accepted), 'active' (accepted, objectives outstanding), 'ready'
 * (accepted, every objective met: turn it in), 'done' (a non-repeatable quest completed, or a repeatable
 * one with nothing left to give — see questExhausted) or 'cooldown' (a repeatable quest waiting for its
 * next offer time).
 */
export type QuestStatus = 'locked' | 'available' | 'active' | 'ready' | 'done' | 'cooldown';

/** Display names for things the core registry does not hold (NPCs and maps live in the world data). */
export interface QuestNames {
  /** NpcDef name by id, e.g. 'pell' → 'Fisher Pell'. */
  npc?(id: string): string | undefined;
  /** MapDef name by id, e.g. 'vale.mirror_lake' → 'Mirror Lake'. */
  map?(id: string): string | undefined;
}

/** What quest rules may ask about the player. Implemented by the SkillBook. */
export interface QuestContext extends RequirementContext {
  /** Game clock in ms (acceptedAt, repeatable cooldowns). */
  now(): number;
  /**
   * Removes delivered items from the bag if it holds all of them; returns false (changing nothing)
   * otherwise. Omitted: quests with `deliver` objectives cannot be turned in.
   */
  spendItems?(items: Record<string, number>): boolean;
  /** Optional display names (fallback: the id, prettified). */
  npcName?(id: string): string | undefined;
  mapName?(id: string): string | undefined;
  /**
   * Whether a trainer lesson has nothing left to give (trainers.lessonOwned: taken once, or its grant
   * already fully owned). Omitted: lessons are never owned. Turn-in drops an owned `rewards.lesson`
   * from the payload, and a repeatable quest whose lesson is owned and that pays nothing else but coins
   * and exp is exhausted (status 'done').
   */
  lessonOwned?(lessonId: string): boolean;
}

/** One objective of a quest with the player's progress, as the log, dialog and tracker show it. */
export interface ObjectiveProgress {
  objective: QuestObjective;
  /** Counter value (kill, gather, use, cast, witness; 0/1 for visit and talk), bag count (deliver), 0/1 (state). */
  have: number;
  need: number;
  done: boolean;
  /** e.g. 'Defeat Jellops 3/8', 'Bring 5 Lake Fish (4 in bag)', 'Visit Mirror Lake ✓'. */
  text: string;
}

/** A quest and its status for the player. */
export interface QuestView {
  quest: QuestDef;
  status: QuestStatus;
  /** NpcDef id the quest is turned in to (`quest.turnIn ?? quest.giver`). */
  turnIn: string;
}

/**
 * Something the player did that quest counters may count (docs/QUESTS.md §3). The game reports each one
 * with notifyQuest; counters only move for quests that are active at that moment.
 * - kill: a monster died to the player (elites and wardens also count toward their `base` species).
 * - gather: a successful gather of a node kind.
 * - visit: the player entered a map (every entry, not only the first).
 * - talk: the player talked to an NPC. With `map` (where that NPC stands), talking to a quest's GIVER
 *   also completes its `visit` objectives for that map (the player was already there).
 * - use: an engaged cast (the cast's first hit), the same moment as SkillBook.recordUse.
 * - cast: any cast of a skill, in the map the player is in.
 * - witness: one witness mark earned toward an echo (a SkillDef or its id).
 */
export type QuestEvent =
  | { type: 'kill'; monster: MonsterDef }
  | { type: 'gather'; node: QuestNodeKind }
  | { type: 'visit'; map: string }
  | { type: 'talk'; npc: string; map?: string }
  | { type: 'use'; skill: SkillDef }
  | { type: 'cast'; skill: SkillDef; map: string }
  | { type: 'witness'; skill: string | SkillDef };

/** What a quest event changed. */
export interface QuestEventResult {
  /** Active quests whose counters moved, in data order. */
  progressed: string[];
  /** Of those, the quests whose status became 'ready'. */
  ready: string[];
}

/** A quest action's result with player-facing text. */
export interface QuestOutcome {
  ok: boolean;
  message: string;
}

/** Result of turnInQuest: on success the quest's full reward payload (still to be applied). */
export interface QuestTurnInOutcome extends QuestOutcome {
  /** The quest's rewards; {} on failure. */
  rewards: QuestReward;
}

// ------------------------------------------------------------------ constants

/** Quests shown in the Pursuits tracker at most (newest first). */
export const QUEST_TRACK_LIMIT = 3;

/** Every gathering node kind a `gather` objective may name (mirrors world NodeKind). */
export const QUEST_NODE_KINDS: readonly QuestNodeKind[] = [
  'ore',
  'fishing',
  'herb',
  'ember_vent',
  'wind_chime',
  'storm_tree',
  'shadow_fungus',
  'sun_spring',
  'frost_crystal',
];

/** Objective text for gathering each node kind (followed by the counter). */
const GATHER_TEXT: Record<QuestNodeKind, string> = {
  ore: 'Mine ore',
  fishing: 'Catch fish',
  herb: 'Gather herbs',
  ember_vent: 'Collect ember shards',
  wind_chime: 'Collect chime feathers',
  storm_tree: 'Cut stormwood',
  shadow_fungus: 'Harvest umbral spores',
  sun_spring: 'Draw sun water',
  frost_crystal: 'Chip frost crystals',
};

const FAMILY_NOUN: Record<Family, [one: string, many: string]> = {
  beast: ['beast', 'beasts'],
  sprite: ['sprite', 'sprites'],
  construct: ['construct', 'constructs'],
  revenant: ['revenant', 'revenants'],
  fiend: ['fiend', 'fiends'],
  sylvan: ['sylvan', 'sylvans'],
  swarm: ['swarm creature', 'swarm creatures'],
  wyrm: ['wyrm', 'wyrms'],
};

const RANK_NOUN: Record<MonsterRank, [one: string, many: string]> = {
  common: ['common foe', 'common foes'],
  elite: ['elite', 'elites'],
  warden: ['warden', 'wardens'],
};

/** Sort order of questsFor (lower first). */
const STATUS_ORDER: Record<QuestStatus, number> = {
  ready: 0,
  available: 1,
  active: 2,
  cooldown: 3,
  done: 4,
  locked: 5,
};

const CHECK = ' ✓';

const EMPTY_QUESTS: QuestState = Object.freeze({
  active: Object.freeze({}),
  done: Object.freeze({}),
  cooldown: Object.freeze({}),
  tracked: Object.freeze([]) as unknown as string[],
}) as QuestState;

// ------------------------------------------------------------------ helpers

function own<T>(rec: Readonly<Record<string, T>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** The quest state for reading (a frozen empty one when the book has none yet). */
function read(state: SkillBookState): QuestState {
  return state.quests ?? EMPTY_QUESTS;
}

/** The quest state for writing (created on first use). */
function write(state: SkillBookState): QuestState {
  return (state.quests ??= emptyQuestState());
}

/** "mirror_lake" → "Mirror Lake", "quarry_depths.1" → "Quarry Depths 1". */
function prettify(id: string): string {
  return id
    .split(/[_.]/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

/** English plural of a display name ('Jellop' → 'Jellops', 'Ashfly' → 'Ashflies'). */
function pluralName(name: string): string {
  if (/(s|x|z|sh)$/i.test(name)) return `${name}es`;
  if (/[^aeiou]y$/i.test(name)) return `${name.slice(0, -1)}ies`;
  return `${name}s`;
}

/** An item's display name for `n` of it: its name for 1, else ItemDef.plural or the English plural. */
function itemName(reg: Registry, id: string, n: number): string {
  const item = reg.item(id);
  const name = item?.name ?? prettify(id);
  return n === 1 ? name : (item?.plural ?? pluralName(name));
}

function npcName(ctx: QuestContext, id: string): string {
  return ctx.npcName?.(id) ?? prettify(id);
}

function mapName(ctx: QuestContext, id: string): string {
  const named = ctx.mapName?.(id);
  if (named !== undefined) return named;
  const dot = id.indexOf('.');
  return prettify(dot >= 0 ? id.slice(dot + 1) : id);
}

/** The NPC a quest is turned in to. */
export function questTurnIn(quest: QuestDef): string {
  return quest.turnIn ?? quest.giver;
}

/** Whether a skill carries a tag (element ids and weapons count as tags, as in registry normalization). */
function hasTag(skill: SkillDef, tag: string): boolean {
  const weapons: readonly string[] = skill.weapons ?? [];
  return skill.tags.includes(tag) || skill.element === tag || weapons.includes(tag);
}

/** The authored skill a skill id rolls up to (variants → base, merges → higher-tier parent). */
function baseSkill(reg: Registry, skill: SkillDef): string {
  return reg.baseOf(skill.id) ?? skill.baseId ?? skill.id;
}

/**
 * Whether a skill, or the authored skill it rolls up to, carries a tag. Generated variants drop some
 * of their base's tags (an infused basic attack loses 'basic'), yet a Blazing Slash is still the slash.
 */
function rollsUpToTag(reg: Registry, skill: SkillDef, tag: string): boolean {
  if (hasTag(skill, tag)) return true;
  const base = baseSkill(reg, skill);
  const root = base !== skill.id ? reg.skill(base) : undefined;
  return root !== undefined && hasTag(root, tag);
}

/**
 * Counter target of an objective: its count (kill, gather, use, cast, witness), 1 (visit, talk), or 0
 * for live objectives that keep no counter (deliver reads the bag, state its requirement).
 */
export function counterNeed(o: QuestObjective): number {
  switch (o.kind) {
    case 'kill':
    case 'gather':
    case 'use':
    case 'cast':
    case 'witness':
      return Math.max(1, Math.floor(o.count));
    case 'visit':
    case 'talk':
      return 1;
    case 'deliver':
    case 'state':
      return 0;
  }
}

/**
 * Whether a kill of `m` counts for a kill objective: every given filter must match (`monster` also
 * matches elites and wardens whose `base` is that species).
 */
export function killCounts(o: Extract<QuestObjective, { kind: 'kill' }>, m: MonsterDef): boolean {
  if (o.monster !== undefined && m.id !== o.monster && m.base !== o.monster) return false;
  if (o.family !== undefined && m.family !== o.family) return false;
  if (o.rank !== undefined && m.rank !== o.rank) return false;
  return true;
}

/** Whether an event advances one objective of an active quest (and by how much: always 1). */
function eventMatches(reg: Registry, quest: QuestDef, o: QuestObjective, event: QuestEvent): boolean {
  switch (o.kind) {
    case 'kill':
      return event.type === 'kill' && killCounts(o, event.monster);
    case 'gather':
      return event.type === 'gather' && event.node === o.node;
    case 'visit':
      if (event.type === 'visit') return event.map === o.map;
      // Talking to the giver where it stands: the player is already in that map.
      return event.type === 'talk' && event.map === o.map && event.npc === quest.giver;
    case 'talk':
      return event.type === 'talk' && event.npc === o.npc;
    case 'use':
      if (event.type !== 'use') return false;
      if (o.skill !== undefined && event.skill.id !== o.skill && baseSkill(reg, event.skill) !== o.skill) return false;
      return o.tag === undefined || rollsUpToTag(reg, event.skill, o.tag);
    case 'cast': {
      if (event.type !== 'cast' || event.map !== o.map) return false;
      const s = event.skill;
      const any = o.element !== undefined || o.shape !== undefined || o.tag !== undefined;
      return (
        !any ||
        (o.element !== undefined && s.element === o.element) ||
        (o.shape !== undefined && s.shape.kind === o.shape) ||
        (o.tag !== undefined && rollsUpToTag(reg, s, o.tag))
      );
    }
    case 'witness': {
      if (event.type !== 'witness') return false;
      const id = typeof event.skill === 'string' ? event.skill : event.skill.id;
      return o.skill === undefined || o.skill === id;
    }
    case 'deliver':
    case 'state':
      return false;
  }
}

/** Items every `deliver` objective of a quest asks for, summed by item id. */
function deliveries(quest: QuestDef): Record<string, number> {
  const out: Record<string, number> = {};
  for (const o of quest.objectives) {
    if (o.kind === 'deliver') out[o.item] = (out[o.item] ?? 0) + o.count;
  }
  return out;
}

// ------------------------------------------------------------------ queries

/** Texts of what keeps a quest locked: 'Complete <quest>' per unfinished `after`, then unmet `requires`. */
export function questMissing(reg: Registry, state: SkillBookState, ctx: QuestContext, id: string): string[] {
  const quest = reg.quest(id);
  if (!quest) return [`Unknown quest ${id}`];
  const done = read(state).done;
  const out: string[] = [];
  for (const prev of quest.after ?? []) {
    if ((own(done, prev) ?? 0) < 1) out.push(`Complete ${reg.quest(prev)?.name ?? prettify(prev)}`);
  }
  // A Trial is offered once its class's discovery requirements hold (SPEC-v4 §3.4).
  const trialReqs = quest.trialOf !== undefined ? (reg.classDef(quest.trialOf)?.discover?.requires ?? []) : [];
  for (const req of [...(quest.requires ?? []), ...trialReqs]) {
    if (!meetsRequirement(req, ctx)) out.push(describeRequirement(reg, req, ctx));
  }
  return out;
}

/** One objective measured for the player (objectiveProgress without its text). */
interface Measured {
  have: number;
  need: number;
  done: boolean;
}

/**
 * Measures every objective of a quest (shared by objectiveProgress and the cheap done-ness path):
 * counters read `active.progress`; a `witness` objective naming an echo the player already knows is
 * met (no more marks can be earned for it); `deliver` reads the bag against everything the quest
 * asks of that item (two deliveries of one item need their sum, as turn-in spends the sum); `state`
 * evaluates its requirement live. A completed non-repeatable quest reads every objective as met.
 */
function measure(state: SkillBookState, ctx: QuestContext, quest: QuestDef): Measured[] {
  const qs = read(state);
  const active = own(qs.active, quest.id);
  const completed = !active && !quest.repeatable && (own(qs.done, quest.id) ?? 0) >= 1;
  let totals: Record<string, number> | undefined;
  return quest.objectives.map((objective, i) => {
    if (objective.kind === 'deliver') {
      const have = ctx.itemCount(objective.item);
      totals ??= deliveries(quest);
      return { have, need: objective.count, done: completed || have >= (totals[objective.item] ?? objective.count) };
    }
    if (objective.kind === 'state') {
      const done = completed || meetsRequirement(objective.requires, ctx);
      return { have: done ? 1 : 0, need: 1, done };
    }
    const need = counterNeed(objective);
    const known = objective.kind === 'witness' && objective.skill !== undefined && ctx.rank(objective.skill) > 0;
    const have = completed || known ? need : Math.min(need, Math.max(0, active?.progress[i] ?? 0));
    return { have, need, done: have >= need };
  });
}

/**
 * Each objective of a quest with the player's progress: counters read `active.progress` (0 when the
 * quest is not active; every objective reads done once a non-repeatable quest is completed), a `witness`
 * objective for an echo the player already knows reads met, `deliver` reads the bag (against the sum
 * the quest asks of that item) and `state` evaluates its requirement live. Texts: 'Defeat Jellops 3/8',
 * 'Mine ore 2/10', 'Bring 5 Lake Fish (4 in bag)', 'Bring 3 Meadow Herbs (0 in bag)', 'Visit Mirror
 * Lake', 'Speak with Fisher Pell', 'Use blade skills 6/20', 'Cast ice at Mirror Lake 0/1', 'Witness an
 * echo 1/2', a state objective's label; ' ✓' is appended to every met objective. Unknown ids yield [].
 */
export function objectiveProgress(
  reg: Registry,
  state: SkillBookState,
  ctx: QuestContext,
  id: string,
): ObjectiveProgress[] {
  const quest = reg.quest(id);
  if (!quest) return [];
  return measure(state, ctx, quest).map(({ have, need, done }, i) => {
    const objective = quest.objectives[i];
    const text = objectiveText(reg, ctx, objective, have, need) + (done ? CHECK : '');
    return { objective, have, need, done, text };
  });
}

/**
 * Done-ness of each objective of a quest, in order — objectiveProgress without building any text (cheap
 * enough to run after every flag or bag change). Unknown ids yield [].
 */
export function objectivesDone(reg: Registry, state: SkillBookState, ctx: QuestContext, id: string): boolean[] {
  const quest = reg.quest(id);
  return quest ? measure(state, ctx, quest).map((m) => m.done) : [];
}

/** Objective text without the ✓ (see objectiveProgress). */
function objectiveText(reg: Registry, ctx: QuestContext, o: QuestObjective, have: number, need: number): string {
  const counter = `${have}/${need}`;
  switch (o.kind) {
    case 'kill': {
      const many = need !== 1;
      let noun: string;
      if (o.monster !== undefined) {
        const name = reg.monster(o.monster)?.name ?? prettify(o.monster);
        noun = many ? pluralName(name) : name;
      } else {
        const fam = o.family !== undefined ? FAMILY_NOUN[o.family][many ? 1 : 0] : undefined;
        const generic =
          fam !== undefined
            ? (o.rank !== undefined ? `${o.rank} ${fam}` : fam)
            : o.rank !== undefined
              ? RANK_NOUN[o.rank][many ? 1 : 0]
              : many
                ? 'foes'
                : 'foe';
        noun = many ? generic : `${/^[aeiou]/.test(generic) ? 'an' : 'a'} ${generic}`;
      }
      return `Defeat ${noun} ${counter}`;
    }
    case 'gather':
      return `${GATHER_TEXT[o.node] ?? `Gather ${prettify(o.node)}`} ${counter}`;
    case 'deliver':
      return `Bring ${o.count} ${itemName(reg, o.item, o.count)} (${have} in bag)`;
    case 'visit':
      return `Visit ${mapName(ctx, o.map)}`;
    case 'talk':
      return `Speak with ${npcName(ctx, o.npc)}`;
    case 'use': {
      const name = o.skill !== undefined ? (reg.skill(o.skill)?.name ?? prettify(o.skill)) : undefined;
      const subject = name ?? (o.tag !== undefined ? `${o.tag} skills` : 'skills');
      return `Use ${subject} ${counter}`;
    }
    case 'cast': {
      const parts: string[] = [];
      if (o.element !== undefined) parts.push((reg.element(o.element)?.name ?? o.element).toLowerCase());
      if (o.shape !== undefined) parts.push(o.shape);
      if (o.tag !== undefined) parts.push(o.tag);
      return `Cast ${parts.length > 0 ? parts.join(' or ') : 'skills'} at ${mapName(ctx, o.map)} ${counter}`;
    }
    case 'witness': {
      const subject = o.skill !== undefined ? (reg.skill(o.skill)?.name ?? prettify(o.skill)) : 'an echo';
      return `Witness ${subject} ${counter}`;
    }
    case 'state':
      return o.label;
  }
}

/** Every objective of an active quest is met (counters full, bag holds the deliveries, states hold). */
function allObjectivesMet(state: SkillBookState, ctx: QuestContext, quest: QuestDef): boolean {
  return measure(state, ctx, quest).every((m) => m.done);
}

/**
 * A repeatable quest with nothing left to give: its `rewards.lesson` is owned (ctx.lessonOwned — e.g. a
 * passive drill whose passive is at its max rank) and it pays nothing else but coins and exp. Bounties
 * that teach an essence, or pay only coins, never run out.
 */
function exhausted(ctx: QuestContext, quest: QuestDef): boolean {
  const r = quest.rewards;
  if (!quest.repeatable || r.lesson === undefined || !(ctx.lessonOwned?.(r.lesson) ?? false)) return false;
  const others = r.skill ?? r.passive ?? r.element ?? r.whisper ?? r.flag;
  return others === undefined && Object.keys(r.essences ?? {}).length === 0 && Object.keys(r.items ?? {}).length === 0;
}

/** Whether quest `id` is a repeatable quest with nothing left to give (see QuestContext.lessonOwned). */
export function questExhausted(reg: Registry, ctx: QuestContext, id: string): boolean {
  const quest = reg.quest(id);
  return quest !== undefined && exhausted(ctx, quest);
}

/**
 * Status of quest `id` (see QuestStatus): active quests are 'ready' when every objective is met, else
 * 'active'; a completed non-repeatable quest is 'done', and so is an exhausted repeatable one (its lesson
 * owned, nothing else but coins and exp to give — see questExhausted); a repeatable one is 'cooldown'
 * until its next offer time (`state.quests.cooldown`, game clock); otherwise 'locked' while an `after`
 * quest is not completed or a `requires` entry is unmet, else 'available'. Unknown ids are 'locked'.
 */
export function questStatus(reg: Registry, state: SkillBookState, ctx: QuestContext, id: string): QuestStatus {
  const quest = reg.quest(id);
  if (!quest) return 'locked';
  const qs = read(state);
  if (own(qs.active, id)) return allObjectivesMet(state, ctx, quest) ? 'ready' : 'active';
  const done = own(qs.done, id) ?? 0;
  if (done >= 1 && !quest.repeatable) return 'done';
  if (exhausted(ctx, quest)) return 'done';
  if (quest.repeatable && (own(qs.cooldown, id) ?? -Infinity) > ctx.now()) return 'cooldown';
  return questMissing(reg, state, ctx, id).length > 0 ? 'locked' : 'available';
}

function view(reg: Registry, state: SkillBookState, ctx: QuestContext, quest: QuestDef): QuestView {
  return { quest, status: questStatus(reg, state, ctx, quest.id), turnIn: questTurnIn(quest) };
}

/** Every quest with its status, in data order (the quest log; filter 'locked' out to hide spoilers). */
export function questList(reg: Registry, state: SkillBookState, ctx: QuestContext): QuestView[] {
  return [...reg.quests.values()].map((q) => view(reg, state, ctx, q));
}

/** Data order of every quest id, per registry (built once). */
const ORDER = new WeakMap<Registry, ReadonlyMap<string, number>>();

function dataOrder(reg: Registry): ReadonlyMap<string, number> {
  let order = ORDER.get(reg);
  if (!order) {
    order = new Map([...reg.quests.keys()].map((id, i) => [id, i]));
    ORDER.set(reg, order);
  }
  return order;
}

/**
 * The quests NPC `npcId` deals with, with status: every quest it gives, plus active / ready quests
 * turned in to it. Sorted ready > available > active > cooldown > done > locked, then data order.
 * `turnIn` tells whether a ready quest can be handed in here. Only that NPC's quests are evaluated
 * (Registry.questsBy / questsTurnedInAt), so refreshing every NPC costs one pass over the quests.
 */
export function questsFor(reg: Registry, state: SkillBookState, ctx: QuestContext, npcId: string): QuestView[] {
  const out: QuestView[] = [];
  const seen = new Set<string>();
  for (const quest of reg.questsBy(npcId)) {
    seen.add(quest.id);
    out.push(view(reg, state, ctx, quest));
  }
  const active = read(state).active;
  for (const quest of reg.questsTurnedInAt(npcId)) {
    if (seen.has(quest.id) || !own(active, quest.id)) continue;
    out.push(view(reg, state, ctx, quest));
  }
  const order = dataOrder(reg);
  return out.sort(
    (a, b) =>
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status] || (order.get(a.quest.id) ?? 0) - (order.get(b.quest.id) ?? 0),
  );
}

/** The marker over an NPC's head (docs/CLIENT-v3.md §4): '?' ready to turn in here, '!' available, '…' active. */
export type QuestMarker = '?' | '!' | '…';

/**
 * Marker for NPC `npcId`: '?' when a ready quest can be turned in to it, else '!' when it offers an
 * available quest, else '…' when a quest it gives or takes is in progress, else null. Cheaper than
 * questsFor: it stops at the first '?'.
 */
export function questMarker(reg: Registry, state: SkillBookState, ctx: QuestContext, npcId: string): QuestMarker | null {
  let marker: QuestMarker | null = null;
  const active = read(state).active;
  for (const quest of reg.questsTurnedInAt(npcId)) {
    if (!own(active, quest.id)) continue;
    if (allObjectivesMet(state, ctx, quest)) return '?';
    marker = '…';
  }
  for (const quest of reg.questsBy(npcId)) {
    const status = questStatus(reg, state, ctx, quest.id);
    if (status === 'available') return '!';
    if (status === 'active' || status === 'ready') marker = '…';
  }
  return marker;
}

// ------------------------------------------------------------------ mutations

/**
 * Advances the counters of every active quest an event matches (each matching objective +1, capped
 * at its need) and reports which quests moved and which became 'ready'. Readiness needs `ctx` (bag and
 * live state objectives); without it a quest is reported ready only when its counters are full and it
 * has no live objective (deliver, state) that might still be unmet — such quests show up in
 * `progressed` alone. Servers should always pass `ctx`.
 */
export function advanceQuests(
  reg: Registry,
  state: SkillBookState,
  event: QuestEvent,
  ctx?: QuestContext,
): QuestEventResult {
  const progressed: string[] = [];
  const ready: string[] = [];
  const active = state.quests?.active;
  if (!active) return { progressed, ready };
  for (const quest of reg.quests.values()) {
    const entry = own(active, quest.id);
    if (!entry) continue;
    const hits = quest.objectives.flatMap((o, i) =>
      (entry.progress[i] ?? 0) < counterNeed(o) && eventMatches(reg, quest, o, event) ? [i] : [],
    );
    if (hits.length === 0) continue;
    const before = ctx ? questStatus(reg, state, ctx, quest.id) === 'ready' : countersFull(quest, entry.progress);
    while (entry.progress.length < quest.objectives.length) entry.progress.push(0);
    for (const i of hits) entry.progress[i] = Math.max(0, entry.progress[i]) + 1;
    progressed.push(quest.id);
    const after = ctx ? questStatus(reg, state, ctx, quest.id) === 'ready' : countersFull(quest, entry.progress);
    if (after && !before) ready.push(quest.id);
  }
  return { progressed, ready };
}

/** Readiness without a context: every counter full and no live objective (deliver, state) to check. */
function countersFull(quest: QuestDef, progress: readonly number[]): boolean {
  return quest.objectives.every(
    (o, i) => o.kind !== 'deliver' && o.kind !== 'state' && (progress[i] ?? 0) >= counterNeed(o),
  );
}

/**
 * Reports an event to every active quest (see advanceQuests); returns the ids whose status became
 * 'ready'. Pass `ctx` (docs/QUESTS.md §3): without it, quests with deliver or state objectives are never
 * reported ready.
 */
export function notifyQuest(reg: Registry, state: SkillBookState, event: QuestEvent, ctx?: QuestContext): string[] {
  return advanceQuests(reg, state, event, ctx).ready;
}

/**
 * Tracks (`on`) or untracks a quest in the Pursuits tracker: newest first, at most QUEST_TRACK_LIMIT
 * (the oldest drops off). Only active quests can be tracked. Returns false when nothing could be done
 * (tracking a quest that is not active).
 */
export function trackQuest(state: SkillBookState, id: string, on: boolean): boolean {
  const qs = write(state);
  const rest = qs.tracked.filter((t) => t !== id);
  if (!on) {
    qs.tracked = rest;
    return true;
  }
  if (!own(qs.active, id)) return false;
  qs.tracked = [id, ...rest].slice(0, QUEST_TRACK_LIMIT);
  return true;
}

/**
 * Accepts an available quest: its counters start at 0 (`acceptedAt` = ctx.now()) and it is tracked.
 * Counters only count what happens from now on; a `visit` to the map the player stands in completes when
 * the player talks to the giver there (a talk event with `map`). With `at` (the NPC the player is
 * talking to), the quest must be that NPC's to give; servers should always pass it.
 */
export function acceptQuest(
  reg: Registry,
  state: SkillBookState,
  ctx: QuestContext,
  id: string,
  at?: string,
): QuestOutcome {
  const quest = reg.quest(id);
  if (!quest) return { ok: false, message: 'No one here offers that.' };
  if (at !== undefined && at !== quest.giver) return { ok: false, message: `Ask ${npcName(ctx, quest.giver)} about that.` };
  const status = questStatus(reg, state, ctx, id);
  switch (status) {
    case 'active':
    case 'ready':
      return { ok: false, message: `You are already on ${quest.name}.` };
    case 'done':
      if (exhausted(ctx, quest)) return { ok: false, message: `${quest.name} has nothing more to teach you.` };
      return { ok: false, message: `You have already completed ${quest.name}.` };
    case 'cooldown':
      return { ok: false, message: `${quest.name} is not offered again yet.` };
    case 'locked':
      return { ok: false, message: `Not yet: ${questMissing(reg, state, ctx, id).join(', ')}.` };
    case 'available':
      break;
  }
  const qs = write(state);
  qs.active[id] = { progress: quest.objectives.map(() => 0), acceptedAt: ctx.now() };
  trackQuest(state, id, true);
  return { ok: true, message: `Accepted ${quest.name}.` };
}

/**
 * Drops an active quest: its counters are lost and it leaves the tracker (no cooldown is started). An
 * active entry whose quest is no longer in the content can be dropped too (it would otherwise hold a
 * tracker slot forever).
 */
export function abandonQuest(reg: Registry, state: SkillBookState, _ctx: QuestContext, id: string): QuestOutcome {
  if (!own(read(state).active, id)) return { ok: false, message: 'You are not on that quest.' };
  delete write(state).active[id];
  trackQuest(state, id, false);
  return { ok: true, message: `Abandoned ${reg.quest(id)?.name ?? 'that quest'}.` };
}

/**
 * Turns in a ready quest: checks every objective, removes the delivered items through
 * `ctx.spendItems`, records the completion (`done` +1; repeatable quests start their cooldown on the
 * game clock), untracks it and returns the reward payload. Nothing is applied here: the SkillBook applies
 * book-side rewards (lesson grant, skill, passive, element, essences, whisper, flag) and the game coins,
 * items and exp. A `rewards.lesson` the player already owns (ctx.lessonOwned) is left out of the payload:
 * it would teach nothing. With `at`, the quest must be turned in to that NPC (servers should always pass
 * it). On failure nothing changes.
 */
export function turnInQuest(
  reg: Registry,
  state: SkillBookState,
  ctx: QuestContext,
  id: string,
  at?: string,
): QuestTurnInOutcome {
  const fail = (message: string): QuestTurnInOutcome => ({ ok: false, message, rewards: {} });
  const quest = reg.quest(id);
  if (!quest || !own(read(state).active, id)) return fail('You are not on that quest.');
  const turnIn = questTurnIn(quest);
  if (at !== undefined && at !== turnIn) return fail(`Bring this to ${npcName(ctx, turnIn)}.`);
  const progress = objectiveProgress(reg, state, ctx, id);
  const unmet = progress.filter((p) => !p.done);
  if (unmet.length > 0) return fail(`Not yet: ${unmet.map((p) => p.text).join(', ')}.`);
  // Ownership is read before anything changes (spending items could, in principle, change it).
  const lessonOwned = quest.rewards.lesson !== undefined && (ctx.lessonOwned?.(quest.rewards.lesson) ?? false);
  const items = deliveries(quest);
  if (Object.keys(items).length > 0 && !(ctx.spendItems?.(items) ?? false)) {
    const wanted = Object.entries(items).map(([item, n]) => `${n} ${itemName(reg, item, n)}`);
    return fail(`You need ${wanted.join(', ')}.`);
  }
  const qs = write(state);
  delete qs.active[id];
  qs.done[id] = (own(qs.done, id) ?? 0) + 1;
  if (quest.repeatable) qs.cooldown[id] = ctx.now() + Math.max(0, quest.repeatable.cooldownMs);
  trackQuest(state, id, false);
  const r = quest.rewards;
  const rewards: QuestReward = { ...r };
  if (r.items) rewards.items = { ...r.items };
  if (r.essences) rewards.essences = { ...r.essences };
  if (lessonOwned) delete rewards.lesson;
  return { ok: true, message: `Completed ${quest.name}!`, rewards };
}

/**
 * Credits the non-repeatable quests that teach lessons the player has already taken (a save from before
 * quests, or a lesson bought through SkillBook.takeLesson while lessons are not `questOnly`): each such
 * quest that is neither active nor completed is recorded as completed once, so its follow-ups open and
 * it is never offered for a lesson that would teach nothing. Repeatable quests are left alone. Returns
 * the credited quest ids, in data order.
 */
export function creditLessonQuests(reg: Registry, state: SkillBookState, lessonIds: readonly string[]): string[] {
  const credited: string[] = [];
  if (lessonIds.length === 0) return credited;
  const taken = new Set(lessonIds);
  for (const quest of reg.quests.values()) {
    const lesson = quest.rewards.lesson;
    if (quest.repeatable || lesson === undefined || !taken.has(lesson)) continue;
    const qs = read(state);
    if (own(qs.active, quest.id) || (own(qs.done, quest.id) ?? 0) >= 1) continue;
    write(state).done[quest.id] = 1;
    credited.push(quest.id);
  }
  return credited;
}
