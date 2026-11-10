// GameController v3 (docs/CLIENT-v2.md §7, docs/INTEGRATION-v3.md §5): the only API the DOM may call. Implemented
// by MapScene (most v3 views are built in src/game/views.ts); the same scene instance survives map restarts, so the
// UI holds it once. Owned by the game lane: other lanes never edit this file — they ask for additions in their
// report. Members are only ever ADDED (never renamed or re-typed) while lanes run in parallel.
//
// View types use plain-language fields (docs/UX-SIMPLE.md): every string meant for players is already friendly
// ("Class Level", "Transform", "Seen 2/3"); ids appear only as keys for lookups and actions — never show them.
import type { Registry } from '../core/registry';
import type { FuseResult, SkillBook } from '../core/skillbook';
import type { ElementId, MonsterRank, WeaponType } from '../core/types';
import type { CompiledMap, MapDef } from '../core/world/types';
import type { IconKind } from '../game/art/icons';
import type { Session, Stats, WorldState } from '../game/session';
import type { DialogOption } from './dialogs';
import type { StarChartData } from './starchart/data';

export type Outcome = { ok: boolean; message?: string };

export interface MinimapView {
  px: number;
  py: number;
  monsters: { x: number; y: number; rank: MonsterRank }[];
  npcs: { x: number; y: number }[];
  portals: { x: number; y: number; open: boolean; label: string }[];
  nodes: { x: number; y: number; ready: boolean }[];
  objects: { x: number; y: number; kind: string }[];
}

export interface TravelTargetView {
  key: string;
  mapId: string;
  name: string;
  region: string;
  cost: number;
}

// ====================================================================== v3 views

/** What changed (onChange): re-render the parts that show it. */
export type ChangeKind = 'bar' | 'class' | 'quests' | 'skills';

/** One skill-bar slot. Slots 0..classSlots-1 are class slots while a class is worn; the rest are the player's own. */
export interface BarSlotView {
  index: number;
  /** Skill in the slot, or null (empty). */
  skillId: string | null;
  /** 'class' = filled by the worn class (long-press → that skill's card); 'own' = the player's pick (→ picker). */
  kind: 'class' | 'own';
  /** Worn class (frame colour + emblem) — class slots only. */
  classId?: string;
  /** Hotkey label: '1'..'8'. */
  key: string;
  /** Filled slots only (plain data so the bar never reads core internals): name, ★ rank of maxRank, element pip,
   *  and ✨ when the skill can transform now. */
  name?: string;
  rank?: number;
  maxRank?: number;
  element?: ElementId;
  transformReady?: boolean;
  /**
   * v4 (SPEC-v4 §2.2): the skill needs another weapon. Grey the slot and show `line` + "— Equip" (→ equipFor);
   * `owned` false = the player does not own that weapon yet.
   */
  lock?: WeaponLockView;
  /** v4: a class skill its meter has not unlocked yet — one line ("Needs more Vow."). */
  waiting?: string;
  /** v4: the class mechanic would add something to this skill if cast right now (glow). */
  boosted?: boolean;
  /** v4: in the current stance this slot casts another skill (show its icon and name). */
  castsAs?: { skillId: string; name: string };
}

/** v4: why a skill is locked by the held weapon, and what "Equip" would equip. */
export interface WeaponLockView {
  /** Core weaponLockLine: "Needs a sword" / "Needs a dagger" / "Needs a rod" / "Needs bare hands". The UI adds "— Equip". */
  line: string;
  weapon: WeaponType;
  /** The player owns that weapon (Bare Hands always). False: Equip cannot work yet. */
  owned: boolean;
}

/**
 * v4 (SPEC-v4 §3.6): the ONE mechanic widget above the class slots. Its only label is `name`.
 * widget: 'bar' (a meter: value of max, max null = open-ended), 'pips' (combo steps, marks), 'sides' (a two-sided
 * stance icon: `stance` 0 / 1, `names` both sides), 'count' (placed objects: value of max).
 */
export interface MechanicHudView {
  classId: string;
  kind: 'gauge' | 'combo' | 'marks' | 'stance' | 'zone';
  name: string;
  widget: 'bar' | 'pips' | 'sides' | 'count';
  value: number;
  max: number | null;
  /** The next fitting skill gets something (meter at its threshold, combo one step from its finisher, marks at max). */
  ready: boolean;
  stance?: 0 | 1;
  /** Stance only: the names of both sides. */
  names?: [string, string];
  /** The widget is a button: tapping it swaps the stance (mechanicTap). */
  tap: boolean;
  /** The class colour, '#rrggbb'. */
  color: string;
  /** One plain line saying what this class's widget does (shown once, the first time it appears). */
  hint?: string;
}

/** One choice in the own-slot picker grid (docs/UX-SIMPLE.md §3). */
export interface PickerChoiceView {
  skillId: string;
  name: string;
  /** Learned recently and never equipped (gold "new" dot). */
  fresh: boolean;
  /** Slot it already sits in (equipping moves it), or null. */
  slot: number | null;
}

/** The own-slot picker: a grid of skill icons with names, newest first. */
export interface SlotPickerView {
  slot: number;
  /** Skill in that slot now (null = empty: no "Remove" button). */
  current: string | null;
  choices: PickerChoiceView[];
}

/** The ONE primary action of a skill card. */
export type SkillCardAction =
  /** "Equip" → equipSkill(id) (no free own slot: open the picker with arg `skill:<id>`). */
  | { kind: 'equip' }
  /** "Equipped ✓" (disabled). `byClass` = sits in a class slot ("Equipped by Pyroblade"). */
  | { kind: 'equipped'; slot: number; byClass?: string }
  /** "Transform" → morph(id, to). */
  | { kind: 'transform'; to: string; toName: string }
  /** The one next step, shown as text ("Reach rank 10 to transform."). */
  | { kind: 'step'; text: string }
  /** Nothing to do (unknown skill, monster technique). */
  | { kind: 'none' };

/** The simple skill card (docs/UX-SIMPLE.md §3): big icon, name, ★ rank, one line, cooldown/SP, one action. */
export interface SkillCardView {
  /** The id asked for: a skill id, or 'el:<element>' for an element star (Star Chart, The Heart). */
  id: string;
  /** 'element' for 'el:<id>' cards (no rank / cooldown / SP; action is the one step to find it, or none). */
  kind?: 'skill' | 'element';
  name: string;
  /** One short line, written like a game ("Spin and slash everything around you."). */
  line: string;
  element?: ElementId;
  known: boolean;
  /** Stars: rank of maxRank. */
  rank: number;
  maxRank: number;
  /** Fill of the rank bar toward the next star (or the Mastery bar after max rank), 0..1. */
  progress: number;
  /** Cooldown in seconds (0 = none) and SP cost. */
  cooldown: number;
  sp: number;
  /** Ready to transform (✨). */
  transformReady: boolean;
  action: SkillCardAction;
  /** The one next step toward a transform, shown small under the action ("Reach rank 10 to transform."). */
  next?: string;
  /** Behind "Details" (closed by default): plain label/value rows. */
  details: { label: string; value: string }[];
}

/** One class on the Class screen. */
export interface ClassCardView {
  id: string;
  name: string;
  /** One short line. */
  line: string;
  state: 'current' | 'unlocked' | 'locked';
  /** Class Level (0 while locked), its max, and the bar toward the next level (0..1). */
  level: number;
  maxLevel: number;
  levelProgress: number;
  /** Locked classes: ONE short hint line (the first unmet goal). */
  hint?: string;
  /** Locked and not close yet: the name stays '???' (its riddle lives in Codex > Whispers). */
  mystery?: boolean;
  /** Frame / accent colour, '#rrggbb'. */
  color: string;
  /** Skills this class would equip into the class slots (ids, best first). */
  skills: string[];
}

/** The Class screen: current class on top, unlocked cards with Become, locked silhouettes. */
export interface ClassScreenView {
  current: ClassCardView | null;
  unlocked: ClassCardView[];
  /** Locked classes worth showing (riddle heard or close), nearest first. */
  locked: ClassCardView[];
  /** Becoming another class works right now (SPEC-v2 §5.1 v3.1: any time, instant — the game lane may only block
   *  it mid-fight or while dead). */
  canChange: boolean;
  /** Why not, in one line ("Change class in a town."). */
  changeHint?: string;
}

export interface QuestObjectiveView {
  /** "Defeat Jellops 3/8", "Bring 5 Lake Fish (4 in bag)", "Visit Mirror Lake ✓". */
  text: string;
  have: number;
  need: number;
  done: boolean;
}

export interface QuestRewardView {
  coins: number;
  exp: number;
  items: { id: string; name: string; count: number }[];
  /** What it teaches: skills, passives (Mastery bonus), elements, essences — friendly names. */
  learn: { kind: 'skill' | 'passive' | 'element' | 'essence'; id: string; name: string }[];
  /** Reveals a class secret (whisper). */
  secret: boolean;
}

export type QuestStatusView = 'locked' | 'available' | 'active' | 'ready' | 'done' | 'cooldown';

export interface QuestCardView {
  id: string;
  name: string;
  /** One line for the log / tracker. */
  summary: string;
  status: QuestStatusView;
  giverId: string;
  giverName: string;
  turnInId: string;
  turnInName: string;
  /** Map the giver stands in (log: "available — from Brann in Hearthvale"). */
  where?: string;
  /** Chain name for grouping in the log (plain words). */
  chain?: string;
  objectives: QuestObjectiveView[];
  rewards: QuestRewardView;
  tracked: boolean;
  repeatable: boolean;
}

/** An NPC's quest as their dialog shows it. */
export interface NpcQuestView extends QuestCardView {
  /** The NPC's line for this status: offer (available), progress (active), complete (ready). */
  dialog: string;
  /** Flavour behind the dialog's small "More" toggle (offer and complete only; src/data/quests.ts QUEST_LORE). */
  more?: string;
}

/** What talking to an NPC shows (the quest list part of the NPC dialog / trainer panel). */
export interface NpcQuestsView {
  npcId: string;
  name: string;
  title: string;
  portrait: string;
  /** Ready first, then available, active, cooldown, done (core order). */
  quests: NpcQuestView[];
}

export interface QuestLogView {
  active: QuestCardView[];
  available: QuestCardView[];
  done: QuestCardView[];
}

/** Result of turning a quest in, with the reward card's content. */
export interface QuestTurnInView extends Outcome {
  rewards?: QuestRewardView;
}

/** One row of the Pursuits tracker: tracked quests first, then at most 2 goals. */
export interface PursuitView {
  /** Stable key: 'quest:<id>' or 'goal:<kind>:<id>'. */
  key: string;
  kind: 'quest' | 'goal';
  title: string;
  /** ONE next-step line ("Defeat Jellops 3/8", "Reach rank 10 to transform", "Seen 2/3"). */
  line: string;
  /** Optional bar, 0..1. */
  progress?: number;
  /** Quest ready to turn in (gold). */
  ready?: boolean;
  /** Icon for the row. */
  icon?: { kind: IconKind; id: string };
  /** Tap → ui.open(panel, arg). */
  open: { panel: string; arg?: string };
}

/** Top-centre zone plate. */
export interface ZoneView {
  name: string;
  /** Safety tag shown on the plate. */
  tag: 'Safe' | 'Hunting' | 'Dungeon' | 'Warden';
  /** "Lv 3–6", or '' for towns. */
  band: string;
  /** Explored share of the map, 0..100. */
  explored: number;
  /** Element sources here (element ids: forge fire, lake water, …). */
  sources: ElementId[];
  /** Warden of this map: alive, defeated, or none. */
  warden: 'alive' | 'defeated' | null;
}

/** The worn class for the HUD stat strip ("Pyroblade · Class Level 4"). */
export interface WornClassView {
  id: string;
  name: string;
  level: number;
  maxLevel: number;
  /** Toward the next Class Level, 0..1. */
  progress: number;
  color: string;
}

/**
 * Progressive disclosure (docs/UX-SIMPLE.md rule 7): which systems the player has met, so every lane hides the same
 * things until they matter. The HUD hides Fuse until `fusion`; the Star Chart shows its Passives / Essences tabs
 * after `passives` / `essences`; the Class screen shows Keepsakes after `keepsakes`; the Codex shows Quests after
 * `quests`.
 */
export interface UnlocksView {
  /** First element attuned: the Fuse button and fusion hints. */
  fusion: boolean;
  /** First essence owned: the Essences tab and Rune sockets. */
  essences: boolean;
  /** First passive (Mastery bonus) learned: the Passives tab. */
  passives: boolean;
  /** First class unlocked: class slots, the Class screen's cards. */
  classes: boolean;
  /** First Class Level 5 reached: Keepsakes. */
  keepsakes: boolean;
  /** Any quest accepted (or completed): the Codex Quests tab. */
  quests: boolean;
}

/** Gold "something new" dots on the top-right buttons (by panel name). */
export interface MenuBadgesView {
  /** A skill can transform now. */
  skills: boolean;
  /** A class is unlocked but has never been worn, or a class point is unspent. */
  classes: boolean;
  /** A tracked / active quest is ready to turn in. */
  codex: boolean;
  /** Standing at an altar with two things that could fuse. */
  altar: boolean;
}

/** Left-edge quick buttons: what they would use, and how many are left. */
export interface QuickSlotsView {
  heal: { itemId: string; count: number } | null;
  recall: { itemId: string; count: number } | null;
  potion: { itemId: string; count: number } | null;
}

/** What Interactions hands the UI when the player talks to an NPC (src/ui/panels/npc.ts renders it). */
export interface NpcDialogView {
  npcId: string;
  name: string;
  title: string;
  portrait: string;
  /** The NPC's line (HTML-escaped; may contain <b>/<small>). */
  line: string;
  /** Role actions (Forge, Buy a Dagger, Travel, Sell, Leave…) — the quest list is added by the dialog itself. */
  options: DialogOption[];
}

export interface GameController {
  readonly session: Session;
  readonly reg: Registry;
  readonly book: SkillBook;
  stats(): Stats;
  /** -1 = basic attack (AUTO off: one swing per press). */
  castSlot(i: number): void;
  /** Attack button held (AUTO off: keep swinging while held). */
  holdAttack(on: boolean): void;
  assignSlot(i: number, id: string | null): void;
  cooldown(id: string): { remain: number; total: number };
  usable(id: string): { ok: boolean; reason?: string };
  sparkWindow(id: string): 'none' | 'low' | 'good' | 'peak';
  /** AUTO battle switch: on = hunt the nearest monster and cast every equipped skill when in reach. */
  autoCastOn(): boolean;
  setAutoCastOn(on: boolean): void;
  morph(from: string, to: string): void;
  fuse(a: string, b: string): FuseResult;
  atAltar(): boolean;
  wearClass(id: string): Outcome;
  buyClassNode(classId: string, nodeId: string): Outcome;
  respecClass(classId: string): Outcome;
  setImprints(ids: string[]): Outcome;
  takeLesson(lessonId: string): Outcome;
  buyWeapon(w: WeaponType): Outcome;
  equipWeapon(w: WeaponType): Outcome;
  useItem(itemId: string): Outcome;
  sellItem(itemId: string, count: number): Outcome;
  isSafe(): boolean;
  map(): { def: MapDef; compiled: CompiledMap };
  world(): WorldState;
  minimap(): MinimapView;
  travelTargets(): TravelTargetView[];
  travel(key: string): Outcome;
  /** BFS over discovered portals + auto-walk, resumes after warps. */
  navigateTo(mapId: string): Outcome;
  setPaused(paused: boolean): void;
  /**
   * The world's pause state for the UI's modal watchdog: 'paused' (a panel paused the scene), 'running', or 'between'
   * (a map change is in progress, so neither pausing nor resuming applies yet).
   */
  pauseState?(): 'paused' | 'running' | 'between';
  newGame(): void;
  /** Fighting right now (dealt or took damage in the last few seconds). Discovery cards wait until it is false. */
  inCombat?(): boolean;

  // -------------------------------------------------------------------- v3: change feed

  /** Subscribes to bar / class / quest / skill changes (run-wide; call the returned function to stop). */
  onChange(fn: (what: ChangeKind) => void): () => void;

  // -------------------------------------------------------------------- v3: skill bar & skills

  /** Every skill-bar slot (HOTBAR_SIZE), class slots first while a class is worn. */
  barSlots(): BarSlotView[];
  /** Puts a skill into one of the player's own slots (`slot`, else the first empty own slot). */
  equipSkill(skillId: string, slot?: number): Outcome;
  /** Empties one of the player's own slots (class slots are managed by the class). */
  clearSlot(slot: number): void;
  /** The own-slot picker for `slot`: every bar-eligible known skill, newest first. */
  slotPicker(slot: number): SlotPickerView;
  /** The simple skill card of any skill id (known or not). */
  skillCard(skillId: string): SkillCardView;
  /** Everything the Star Chart draws (built by src/ui/starchart/data.ts from the registry and the book). */
  starChartData(): StarChartData;

  // -------------------------------------------------------------------- v3: classes

  /** The Class screen. */
  classCards(): ClassScreenView;
  /** Becomes a class (null = "No class"): wears it, refills the class slots, banner + outfit change. */
  becomeClass(id: string | null): Outcome;
  /** The worn class for the HUD stat strip, or null. */
  wornClass(): WornClassView | null;

  // -------------------------------------------------------------------- v3: quests

  /** An NPC's quests for its dialog / trainer panel. */
  npcQuests(npcId: string): NpcQuestsView;
  /** Accepts an available quest from NPC `npcId` (the one the player is talking to). */
  acceptQuest(id: string, npcId: string): Outcome;
  /** Turns a ready quest in at NPC `npcId`; applies coins, items and exp; returns the reward card content. */
  turnInQuest(id: string, npcId: string): QuestTurnInView;
  /** Drops an active quest (progress lost). */
  abandonQuest(id: string): Outcome;
  /** Shows / hides a quest in the Pursuits tracker. */
  trackQuest(id: string, on: boolean): Outcome;
  /** The quest log (Codex Quests tab): active, available (where / from whom), completed. */
  questLog(): QuestLogView;
  /** The Pursuits tracker rows: tracked quests first, then at most 2 goals. */
  pursuits(): PursuitView[];
  /** Marker over an NPC's head: '!' available, '?' ready to turn in, '…' in progress, null. */
  questMarker(npcId: string): '!' | '?' | '…' | null;
  /** One quest's card (log focus `quests:<id>`, progress toasts, reward previews); null for unknown ids. */
  questCard(id: string): QuestCardView | null;

  // -------------------------------------------------------------------- v3: HUD helpers

  /** Zone plate data for the current map. */
  zone(): ZoneView;
  /** Left-edge quick buttons (heal, recall, potion) with counts. */
  quickSlots(): QuickSlotsView;
  /** Uses a quick button: heal / recall / potion items, or 'rest' (sit and recover). */
  useQuick(kind: 'heal' | 'recall' | 'potion' | 'rest'): Outcome;
  /** Target button: cycles to the next nearest enemy (none nearby → toast). */
  cycleTarget(): void;
  /** Which systems the player has met (progressive disclosure, docs/UX-SIMPLE.md rule 7). */
  unlocks(): UnlocksView;
  /** Gold dots on the top-right buttons. */
  badges(): MenuBadgesView;
  /**
   * "Teach in the moment" (docs/UX-SIMPLE.md rule 9): true exactly once per save for `key` (then remembered), so a
   * one-line hint toast shows only the first time ("Hold ⚔ to keep swinging"). Keys are plain slugs ('hold_attack').
   */
  firstTime(key: string): boolean;

  // -------------------------------------------------------------------- v3: art for the DOM (data URLs, cached)

  /** 32×32 pixel icon: kind 'skill' | 'el' | 'mod' | 'item' | 'cls' | 'passive'. Unknown ids → the generic icon. */
  iconUrl(kind: IconKind, id: string): string;
  /** 12×12 element / essence pip ('' when unknown). */
  pipUrl(kind: 'el' | 'mod', id: string): string;
  /** Any UI art texture by key (ui_frame_*, ui_round_*, ui_ico_*, ui_chevron…); '' when missing. */
  uiUrl(key: string): string;
  /** The player's current look (40×48 idle frame, worn class outfit) for the portrait medallion. */
  portraitUrl(): string;
  /** Outfit preview of a class with the current weapon (null = no class); the Class screen and class cards. */
  outfitUrl(classId: string | null): string;

  // -------------------------------------------------------------------- v4: weapons & the class mechanic
  // (optional members: added while lanes run in parallel; MapScene implements all of them)

  /** The one mechanic widget of the worn class, or null (no class, or a class without one). Read it on every tick. */
  mechanicView?(): MechanicHudView | null;
  /** The stance button: swaps the stance when the worn class has a tap / hold stance. */
  mechanicTap?(): Outcome;
  /** Why the held weapon locks a skill ("Needs a sword"), or null when it does not. */
  weaponLock?(skillId: string): WeaponLockView | null;
  /** The lock line's one action: equips the weapon the skill needs (swap cooldown applies). */
  equipFor?(skillId: string): Outcome;
  /** Puts every weapon away: Bare Hands (the same as equipWeapon('fists')). */
  unequipWeapon?(): Outcome;
  /** Ms until the next weapon swap is allowed (0 = now). */
  weaponSwapIn?(): number;
}
