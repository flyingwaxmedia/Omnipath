// SkillBook v2 (docs/SPEC-v2.md §6): the player's living grimoire. It owns the persisted
// SkillBookState and orchestrates every rule module — mastery, sparks, echoes, fusion, trainers,
// passives, classes and the bestiary — emitting typed events for the client. The rule modules are
// pure; every state mutation and every event happens here. Engine-agnostic: game time comes from
// `now()` (or an explicit argument), randomness from rng.ts, and the bag from `inv`.
import {
  buyNode as buyTreeNode,
  classProgress as classView,
  classStatBonus,
  CLASS,
  discoverableNow,
  grantClassXp,
  imprintSlots as unlockedImprintSlots,
  imprintUnlocked,
  respec as respecTree,
  type ClassRankUp,
  type ClassView,
} from './classes';
import { MONSTER_TAG } from './compose';
import { anchorFor, echoNeed, witnessOutcome, type EchoContext, type WitnessOutcome } from './echo';
import { Emitter } from './emitter';
import {
  essenceSlots as slotsFor,
  hintCandidates,
  resolveFusion,
  type FusionContext,
  type FusionOutcome,
} from './fusion';
import { MASTERY, fusionMinRank, overmasteryCost, useXp, xpForHit, xpToNext } from './mastery';
import {
  BESTIARY_BONUS,
  activePassives,
  aggregate,
  masteryXpPct,
  powerPctFor,
  type ActivePassive,
  type PassiveTotals,
} from './passives';
import { elRef, modRef, pairKey, parseRef, skillRef } from './refs';
import type { Registry } from './registry';
import { countTagged, describeRequirement, meetsRequirement } from './requirements';
import { hashSeed, mulberry32 } from './rng';
import { BOOK_FLAGS, migrateBookState } from './save';
import {
  DEFAULT_SPARK_PARENT_RANK,
  rollSpark,
  sparkWindow as sparkWindowFor,
  type SparkContext,
  type SparkWindow,
} from './spark';
import { emptyState, type SkillBookState, type SkillProgress } from './state';
import { lessonState as lessonStateFor, type LessonState, type TrainerContext } from './trainers';
import {
  PRIMAL_ELEMENTS,
  type ClassDef,
  type ElementDef,
  type ElementId,
  type EssenceDef,
  type IngredientRef,
  type LessonDef,
  type MonsterDef,
  type MorphDef,
  type PassiveDef,
  type PassiveSource,
  type PassiveStat,
  type Requirement,
  type SkillDef,
  type StatBonus,
  type TrainerDef,
} from './types';

export type { SkillBookState, SkillProgress } from './state';

// ------------------------------------------------------------------ inventory

/** A purchase price: coins and/or bag items by id. */
export interface Cost {
  coins?: number;
  items?: Record<string, number>;
}

/** The game's bag, as the SkillBook sees it (requirements, lesson costs). Set by the game layer. */
export interface Inventory {
  /** Bag count of an item. */
  count(id: string): number;
  coins(): number;
  /** Pays `cost` if the bag covers all of it; returns false (and changes nothing) otherwise. */
  spend(cost: Cost): boolean;
}

/** The default inventory: holds nothing and can pay for nothing. */
export const EMPTY_INVENTORY: Inventory = Object.freeze({
  count: () => 0,
  coins: () => 0,
  spend: () => false,
});

// ------------------------------------------------------------------ bestiary

/** Kills of one species needed for bestiary stars 1, 2 and 3 (reveal stats · family bonus · max HP). */
export const STAR_KILLS: readonly [number, number, number] = [1, BESTIARY_BONUS.familyKills, BESTIARY_BONUS.hpKills];

/**
 * Essence drops (SPEC §4.6): each kill of a species with an `essence` drops it with `chance`; the
 * `guaranteedAt`-th kill (star 2) always drops it if that species has never dropped one.
 */
export const ESSENCE_DROP = { chance: 0.03, guaranteedAt: BESTIARY_BONUS.familyKills } as const;

/** Bestiary stars (0–3) for a species' kill count. */
export function bestiaryStars(kills: number): number {
  let stars = 0;
  for (const need of STAR_KILLS) if (kills >= need) stars++;
  return stars;
}

// ------------------------------------------------------------------ results

/** A plain success/failure with player-facing text (class, tree, imprint and lesson actions). */
export interface BookOutcome {
  ok: boolean;
  message: string;
}

/** One hit landed by a skill, as the game reports it to recordHit. */
export interface HitInfo {
  monster: MonsterDef;
  /** True when this hit killed the monster. */
  killed: boolean;
  /** 0-based index of this hit within the cast (hit XP only for the first MASTERY.maxHitsPerUse). */
  hitIndex: number;
  /** Hit-XP grants this skill already earned on this monster instance (capped at MASTERY.instanceHitCap). */
  instanceHits: number;
}

/** What one kill did to the bestiary. */
export interface KillResult {
  /** Stars of the species after this kill (0–3). */
  stars: number;
  /** True when this kill earned a new star. */
  starUp: boolean;
  /** Essence id dropped by this kill, if any (already added to the essence inventory). */
  essence?: string;
}

/** Result of SkillBook.witness: the echo's state after the new mark. */
export interface WitnessResult {
  status: WitnessOutcome['status'];
  /** Marks earned in total. */
  marks: number;
  need: number;
  /** Shape kind an anchor skill must have. */
  anchorShape: WitnessOutcome['anchorShape'];
}

/** One branch a skill can morph into, as the morph tree view shows it. */
export interface MorphOption {
  morph: MorphDef;
  /** The resulting skill; null while hidden (an unmet world requirement — flag, map, item — and not owned). */
  skill: SkillDef | null;
  /** Tree depth: the morph's authored tier, else the result's tier. */
  tier: number;
  /** Every `requires` entry is met. */
  available: boolean;
  owned: boolean;
  /** The parent has a morph charge to spend. */
  chargeReady: boolean;
  /** Each requirement with progress text and whether it is met, in authored order. */
  requirements: { text: string; ok: boolean }[];
  /** Present when the morph can also be learned by a Spark (charge-free). */
  spark?: { threat: number; minParentRank: number };
  hint: string;
}

/** Result of SkillBook.morph. */
export type MorphResult = { ok: true; skill: SkillDef; message: string } | { ok: false; message: string };

/** Which fusion pipeline step produced a result. */
export type FusionKind = Extract<FusionOutcome, { ok: true }>['kind'];
/** Why a fusion failed. */
export type FusionFailReason = Extract<FusionOutcome, { ok: false }>['reason'];

/**
 * Result of SkillBook.fuse. Every field is declared on both branches (unused ones as undefined), so
 * `res.result`, `res.hint`, … can be read before narrowing on `ok`.
 */
export type FuseResult =
  | {
      ok: true;
      result: IngredientRef;
      name: string;
      /** False when the player already had the result (nothing new learned, nothing consumed). */
      isNew: boolean;
      kind: FusionKind;
      message: string;
      /** Essence id removed from the inventory. */
      consumed?: string;
      reason?: undefined;
      hint?: undefined;
    }
  | {
      ok: false;
      reason: FusionFailReason;
      message: string;
      /** Whisper revealed by a failed ('nothing') fusion: a recipe hint or a class riddle. */
      hint?: string;
      result?: undefined;
      name?: undefined;
      isNew?: undefined;
      kind?: undefined;
      consumed?: undefined;
    };

/** What the journal remembers about an ingredient pair. */
export type PairMemory = 'unknown' | 'nothing' | 'discovered';

/** One ingredient the altar can take. */
export interface IngredientEntry {
  ref: IngredientRef;
  name: string;
  icon: string;
  /** Skills: rank ≥ fusionMinRank. Elements and essences are always ready. */
  ready: boolean;
  /** Why a skill is not ready yet. */
  message?: string;
  /** Essences: how many are held. */
  count?: number;
}

/** Every ingredient the player owns, by altar tab. */
export interface IngredientList {
  elements: IngredientEntry[];
  skills: IngredientEntry[];
  /** Essences with count > 0. */
  essences: IngredientEntry[];
}

/** Discovery totals for the journal. */
export interface BookStats {
  skillsKnown: number;
  authoredKnown: number;
  /** Learnable authored skills (monster-only techniques excluded). */
  authoredTotal: number;
  /** Generated skills known (element/essence variants and shape merges). */
  infusions: number;
  elementsKnown: number;
  elementsTotal: number;
  classesKnown: number;
  classesTotal: number;
  experiments: number;
  discoveries: number;
  echoesKnown: number;
  /** Authored skills some monster teaches as an echo. */
  echoesTotal: number;
  passivesActive: number;
  /** Essence units held, and distinct essence kinds held. */
  essencesHeld: number;
  essenceKinds: number;
  /** Species with at least one kill, of all species. */
  speciesSeen: number;
  speciesTotal: number;
  kills: number;
}

// ------------------------------------------------------------------ events

/** What revealed a whisper (recipe hint or class riddle). */
export type WhisperSource = 'fusion' | 'echo' | 'bestiary' | 'trainer';

export interface LearnedEvent {
  skill: SkillDef;
  /** e.g. 'start', 'morph:<from>', 'spark:<from>', 'echo:<monster>', 'fusion:<pair>', 'class:<id>', 'lesson:<id>'. */
  source: string;
}
export interface ElementEvent {
  element: ElementDef;
  source: string;
}
export interface RankUpEvent {
  skill: SkillDef;
  rank: number;
}
export interface MasteredEvent {
  skill: SkillDef;
}
export interface ChargeEvent {
  skill: SkillDef;
  charges: number;
}
export interface MorphedEvent {
  from: SkillDef;
  to: SkillDef;
}
export interface FusedEvent {
  a: IngredientRef;
  b: IngredientRef;
  result: IngredientRef;
  kind: FusionKind;
  isNew: boolean;
  consumed?: string;
}
export interface ClassDiscoveredEvent {
  cls: ClassDef;
  /** True when this discovery was worn automatically (no class was worn yet). */
  worn: boolean;
}
export type ClassRankEvent = ClassRankUp;
export interface HintEvent {
  text: string;
  source: WhisperSource;
  /** Set when the whisper reveals a class riddle (the class is now in `state.whispered`). */
  classId?: string;
}
export interface SparkEvent {
  from: SkillDef;
  to: SkillDef;
  monster: MonsterDef;
}
export interface WitnessEvent extends WitnessResult {
  skill: SkillDef;
}
export interface EchoEvent {
  skill: SkillDef;
  /** The monster credited as teacher (the first one using the technique as an echo). */
  monster: MonsterDef;
  /** Id of the owned skill that anchored it. */
  anchor: string;
}
export interface PassiveEvent {
  def: PassiveDef;
  rank: number;
  /** 'tag' for derived tag passives, else the learn source (e.g. 'lesson:<id>', 'fusion:<pair>'). */
  source: string;
}
export interface EssenceEvent {
  essence: EssenceDef;
  added: number;
  total: number;
  /** e.g. 'drop:<species>', 'lesson:<id>', 'loot'. */
  source: string;
}
export interface LessonEvent {
  lesson: LessonDef;
  trainer: TrainerDef;
}
export interface BestiaryEvent {
  monster: MonsterDef;
  kills: number;
  stars: number;
  starUp: boolean;
  essence?: string;
}

/** Every SkillBook event and its payload. */
export interface SkillBookEvents {
  learned: LearnedEvent;
  element: ElementEvent;
  rankUp: RankUpEvent;
  mastered: MasteredEvent;
  charge: ChargeEvent;
  morphed: MorphedEvent;
  fused: FusedEvent;
  classDiscovered: ClassDiscoveredEvent;
  classRank: ClassRankEvent;
  hint: HintEvent;
  spark: SparkEvent;
  witness: WitnessEvent;
  echo: EchoEvent;
  passive: PassiveEvent;
  essence: EssenceEvent;
  lesson: LessonEvent;
  bestiary: BestiaryEvent;
}

// ------------------------------------------------------------------ internals

/** Everything the rule modules may ask about the player. */
type BookContext = TrainerContext & FusionContext & SparkContext & EchoContext;

/** Unmet requirements of these types hide a morph's result (world progress the player must find). */
const HIDING_REQUIREMENTS: ReadonlySet<Requirement['type']> = new Set<Requirement['type']>([
  'flag',
  'mapVisited',
  'item',
]);

const DEFAULT_MORPH_HINT = 'Something stirs within this technique...';

/** Failures where the altar never really tried the pair (not remembered as attempts). */
const NOT_ATTEMPTED: ReadonlySet<FusionFailReason> = new Set<FusionFailReason>(['missing', 'rank', 'same']);

/** Passive sources that are explicitly learned (the others are derived and never stored). */
const LEARNABLE_PASSIVES: ReadonlySet<PassiveSource> = new Set<PassiveSource>(['trainer', 'resonance', 'bestiary']);

/** Passive stats that have a StatBonus field (activeBonus folds them in). */
const BONUS_STATS = ['hp', 'sp', 'atk', 'matk', 'crit', 'speed'] as const satisfies readonly (PassiveStat &
  keyof StatBonus)[];

/** Label of the essence-drop roll stream (kept apart from the spark stream sharing the seed). */
const ESSENCE_STREAM = 'essence';

function own<T>(rec: Readonly<Partial<Record<string, T>>>, key: string): T | undefined {
  return Object.hasOwn(rec, key) ? rec[key] : undefined;
}

/** Whether a cost asks for anything at all. */
function hasPrice(cost: Cost): boolean {
  return (cost.coins ?? 0) > 0 || Object.values(cost.items ?? {}).some((n) => n > 0);
}

// ------------------------------------------------------------------ the book

/**
 * The player's living grimoire: what they know, how well they know it, every experiment they have
 * tried, their classes, passives, bestiary and echoes. All discovery rules run here, on events only
 * (learning, rank-ups, flags, fusions, kills) — never per frame. Mutate state only through this API so
 * the passive caches stay valid.
 */
export class SkillBook {
  readonly events = new Emitter<SkillBookEvents>();
  /** The persisted state (v2). Read freely; mutate through the SkillBook's methods. */
  readonly state: SkillBookState;
  /** Player base level, supplied by the game layer for level requirements. */
  level = 1;
  /** Game clock in ms (learn timestamps, sparkWindow). Set by the game layer; core never reads wall time. */
  now: () => number = () => 0;
  /** The game's bag (item requirements, lesson costs). Defaults to an empty inventory. */
  inv: Inventory = EMPTY_INVENTORY;

  private readonly ctx: BookContext;
  private cache: { passives?: readonly ActivePassive[]; totals?: PassiveTotals } = {};
  /** Tag passive ranks last announced, by passive id (to emit 'passive' on unlocks and rank-ups). */
  private readonly tagRanks = new Map<string, number>();
  private evaluating = false;
  private reevaluate = false;

  /**
   * @param state Any saved book (v2, or v1 — migrated by migrateBookState with this registry). It is
   * copied, never shared. Omit for a new book; pass `emptyState(seed)` to choose the roll seed. Class
   * discovery is not run on load: call evaluateClasses() once listeners are attached if desired.
   */
  constructor(
    readonly reg: Registry,
    state?: SkillBookState,
  ) {
    this.state = migrateBookState(state ?? emptyState(), reg);
    this.ctx = this.makeContext();
    for (const p of this.passives()) if (p.source === 'tag') this.tagRanks.set(p.def.id, p.rank);
  }

  // ---------------------------------------------------------------- queries

  /** Knows this skill id (authored, variant or merge). */
  has(id: string): boolean {
    return Object.hasOwn(this.state.skills, id);
  }

  hasElement(id: ElementId): boolean {
    return own(this.state.elements, id) !== undefined;
  }

  /** Live progress record of a known skill. */
  progress(id: string): SkillProgress | undefined {
    return own(this.state.skills, id);
  }

  /** Rank of a known skill (0 if unknown). */
  rank(id: string): number {
    return this.progress(id)?.rank ?? 0;
  }

  /** Known skills that resolve in the registry, in learn order. */
  known(): SkillDef[] {
    return Object.keys(this.state.skills)
      .map((id) => this.reg.skill(id))
      .filter((s): s is SkillDef => s !== undefined);
  }

  /** Attuned elements that resolve in the registry. */
  knownElements(): ElementDef[] {
    return (Object.keys(this.state.elements) as ElementId[])
      .map((id) => this.reg.element(id))
      .filter((e): e is ElementDef => e !== undefined);
  }

  flag(id: string): number {
    return own(this.state.flags, id) ?? 0;
  }

  /** Known and at its max rank. */
  isMaxed(id: string): boolean {
    const s = this.reg.skill(id);
    const p = this.progress(id);
    return !!s && !!p && p.rank >= s.maxRank;
  }

  /** XP needed to fill the current bar: the next rank, or one overmastery bar at max rank. */
  barSize(id: string): number {
    const s = this.reg.skill(id);
    const p = this.progress(id);
    if (!s || !p) return 1;
    return p.rank >= s.maxRank ? overmasteryCost(s.maxRank, s.tier) : xpToNext(p.rank, s.tier);
  }

  /** Essence slots of a known skill: 0 for buffs, 1, or 2 once it has ≥ 3 overmastery bars (0 if unknown). */
  essenceSlots(id: string): number {
    const s = this.reg.skill(id);
    const p = this.progress(id);
    return s && p ? slotsFor(s, p.overBars) : 0;
  }

  /** Whether the player meets a requirement (morphs, recipes, classes, lessons, portal gates). */
  meets(req: Requirement): boolean {
    return meetsRequirement(req, this.ctx);
  }

  /** Requirement text with the player's progress, e.g. 'Ore Mined 3/6'. */
  describe(req: Requirement): string {
    return describeRequirement(this.reg, req, this.ctx);
  }

  // ---------------------------------------------------------------- learning

  /**
   * Learns a skill at rank 1 and runs discovery. Returns false if it was already known.
   * @throws Error if the id does not resolve to a skill.
   */
  learn(id: string, source: string): boolean {
    const skill = this.reg.skill(id);
    if (!skill) throw new Error(`Unknown skill ${id}`);
    if (this.has(id)) return false;
    this.state.skills[id] = {
      id,
      rank: 1,
      xp: 0,
      charges: 0,
      uses: 0,
      source,
      learnedAt: this.now(),
      overBars: 0,
      study: {},
    };
    this.invalidate();
    this.events.emit('learned', { skill, source });
    this.checkTagPassives();
    this.evaluateClasses();
    return true;
  }

  /**
   * Attunes an element and runs discovery. Returns false if it was already attuned.
   * @throws Error for an unknown element.
   */
  learnElement(id: ElementId, source: string): boolean {
    const element = this.reg.element(id);
    if (!element) throw new Error(`Unknown element ${id}`);
    if (this.hasElement(id)) return false;
    this.state.elements[id] = { source, learnedAt: this.now() };
    this.invalidate();
    this.events.emit('element', { element, source });
    this.evaluateClasses();
    return true;
  }

  /**
   * Adds `n` to a flag (world progress: `visited:<mapId>`, `ore_mined`, relic flags…), runs class
   * discovery, and returns the new value.
   */
  incFlag(id: string, n = 1): number {
    const value = this.flag(id) + n;
    this.state.flags[id] = value;
    this.evaluateClasses();
    return value;
  }

  /**
   * Adds `n` essences (whole, > 0; anything else changes nothing) and returns the new total.
   * @throws Error for an unknown essence.
   */
  addEssence(id: string, n = 1, source = 'loot'): number {
    const essence = this.reg.essence(id);
    if (!essence) throw new Error(`Unknown essence ${id}`);
    const added = Math.floor(n);
    const held = own(this.state.essences, id) ?? 0;
    if (!(added > 0)) return held;
    const total = held + added;
    this.state.essences[id] = total;
    this.events.emit('essence', { essence, added, total, source });
    return total;
  }

  /**
   * Raises a learnable passive (trainer, resonance, bestiary) by one rank, up to its maxRank.
   * Returns false when nothing changed: already at max, or a derived passive (tag/class/imprint).
   * @throws Error for an unknown passive.
   */
  learnPassive(id: string, source: string): boolean {
    const def = this.reg.passive(id);
    if (!def) throw new Error(`Unknown passive ${id}`);
    if (!LEARNABLE_PASSIVES.has(def.source)) return false;
    const rank = (own(this.state.passives, id) ?? 0) + 1;
    if (rank > def.maxRank) return false;
    this.state.passives[id] = rank;
    this.invalidate();
    this.events.emit('passive', { def, rank, source });
    return true;
  }

  // ---------------------------------------------------------------- mastery

  /**
   * Low-level mastery grant: adds `amount × MASTERY.rate` XP to a known skill, ranking it up (a
   * charge and `mastered` at max rank), then filling overmastery bars: each bar adds overBars + 1 and
   * a charge while below MASTERY.maxCharges. With charges capped a bar still completes while it would
   * open an essence slot (so the 2nd slot never depends on spending charges); after that it holds
   * full. Every grant also feeds Class Ranks (classRank events), and rank-ups re-run discovery.
   * Returns the XP granted (0 for unknown skills or non-positive amounts).
   */
  addMastery(id: string, amount: number): number {
    const skill = this.reg.skill(id);
    const p = this.progress(id);
    const xp = amount * MASTERY.rate;
    if (!skill || !p || !Number.isFinite(xp) || xp <= 0) return 0;
    const startCharges = p.charges;
    let ranked = false;
    p.xp += xp;
    while (p.rank < skill.maxRank && p.xp >= xpToNext(p.rank, skill.tier)) {
      p.xp -= xpToNext(p.rank, skill.tier);
      p.rank++;
      ranked = true;
      this.invalidate();
      this.events.emit('rankUp', { skill, rank: p.rank });
      if (p.rank >= skill.maxRank) {
        p.charges = Math.min(MASTERY.maxCharges, p.charges + 1);
        this.state.flags[BOOK_FLAGS.masteredAny] = Math.max(1, this.flag(BOOK_FLAGS.masteredAny));
        this.events.emit('mastered', { skill });
      }
    }
    if (p.rank >= skill.maxRank) this.fillOverBars(p, skill);
    if (p.charges > startCharges) this.events.emit('charge', { skill, charges: p.charges });
    const classUps = grantClassXp(this.reg, this.state, skill, xp);
    if (classUps.length > 0) this.invalidate();
    for (const up of classUps) this.events.emit('classRank', up);
    if (ranked) this.checkTagPassives();
    if (ranked || classUps.length > 0) this.evaluateClasses();
    return xp;
  }

  /**
   * Use XP for an engaged cast (`useXp × threatMult`, no study or passive bonus). The game calls it
   * once per cast, on the cast's first hit. Counts the use. Returns the XP granted.
   */
  recordUse(id: string, threat: number): number {
    const skill = this.reg.skill(id);
    const p = this.progress(id);
    if (!skill || !p) return 0;
    p.uses++;
    return this.addMastery(id, useXp(skill, p.rank, threat));
  }

  /**
   * Use XP for a buff cast while in combat (the game checks combat); `threat` is the highest threat
   * among engaged monsters. Ignores non-buff skills (they earn use XP through recordUse). Returns the XP granted.
   */
  recordBuffUse(id: string, threat: number): number {
    if (this.reg.skill(id)?.shape.kind !== 'buff') return 0;
    return this.recordUse(id, threat);
  }

  /**
   * Hit (and kill) XP for one hit (mastery.xpForHit): threat-weighted, ×study while this skill has
   * killed fewer than MASTERY.studyKills of the species, × passive masteryXp; hit XP only for the
   * cast's first MASTERY.maxHitsPerUse hits and below MASTERY.instanceHitCap grants per instance.
   * A kill also advances the skill's study counter. Returns the XP granted.
   */
  recordHit(id: string, hit: HitInfo): number {
    const skill = this.reg.skill(id);
    const p = this.progress(id);
    if (!skill || !p) return 0;
    const species = hit.monster.id;
    const studyKills = own(p.study, species) ?? 0;
    const xp = xpForHit({
      skill,
      rank: p.rank,
      monster: hit.monster,
      killed: hit.killed,
      studyKills,
      masteryPct: masteryXpPct(this.totals(), skill),
      hitIndex: hit.hitIndex,
      instanceHits: hit.instanceHits,
    });
    if (hit.killed) p.study[species] = studyKills + 1;
    return this.addMastery(id, xp);
  }

  // ---------------------------------------------------------------- bestiary

  /**
   * Records a kill in the bestiary (elites and wardens under their own id) and rolls the species'
   * essence (ESSENCE_DROP; deterministic stream seeded from `state.spark.seed`). Star 2 whispers a
   * class whose clause is the monster's element. Emits 'bestiary' (and 'essence' on a drop).
   */
  recordKill(monster: MonsterDef): KillResult {
    const before = own(this.state.bestiary, monster.id) ?? 0;
    const kills = before + 1;
    this.state.bestiary[monster.id] = kills;
    const stars = bestiaryStars(kills);
    const starUp = stars > bestiaryStars(before);
    if (starUp) this.invalidate();
    const essence = this.rollEssence(monster, kills);
    const event: BestiaryEvent = { monster, kills, stars, starUp };
    this.events.emit('bestiary', essence ? { ...event, essence } : event);
    if (starUp && stars === 2 && monster.element) this.whisperRelated([monster.element], 'bestiary');
    return essence ? { stars, starUp, essence } : { stars, starUp };
  }

  // ---------------------------------------------------------------- sparks & echoes

  /**
   * Rolls for a Spark after `skillId` hits `monster` at game time `now` (spark.rollSpark). On success
   * the morph is learned charge-free with source `spark:<skillId>`, 'spark' is emitted and the new
   * skill returned; otherwise null.
   */
  trySpark(skillId: string, monster: MonsterDef, now: number): SkillDef | null {
    const morph = rollSpark(this.reg, this.ctx, this.state.spark, skillId, monster, now);
    const from = this.reg.skill(skillId);
    const to = morph && this.reg.skill(morph.to);
    if (!from || !to) return null;
    this.learn(to.id, `spark:${skillId}`);
    this.events.emit('spark', { from, to, monster });
    return to;
  }

  /** Hotbar spark telegraph for hitting `monster` with `skillId` right now (`now()`). */
  sparkWindow(skillId: string, monster: MonsterDef): SparkWindow {
    return sparkWindowFor(this.reg, this.ctx, this.state.spark, skillId, monster, this.now());
  }

  /**
   * Adds one witness mark toward echo `skillId` (the player killed a monster instance that used it on
   * them). At the need, the echo is learned if an anchor (same shape kind, rank ≥ 3) is owned — source
   * `echo:<first monster teaching it>`, 'echo' emitted, related class whispered — else 'blocked' and the
   * marks are kept. An already known echo returns 'learned' unchanged. Emits 'witness' otherwise.
   * @throws Error if no monster teaches `skillId` as an echo.
   */
  witness(skillId: string): WitnessResult {
    const skill = this.reg.skill(skillId);
    const need = echoNeed(this.reg, skillId);
    const teacher = this.reg.techniqueSources(skillId).find((s) => s.technique.echo !== undefined)?.monster;
    if (!skill || need === null || !teacher) throw new Error(`"${skillId}" is not an echo technique`);
    if (this.has(skillId)) {
      return { status: 'learned', marks: own(this.state.witness, skillId) ?? 0, need, anchorShape: skill.shape.kind };
    }
    const marks = (own(this.state.witness, skillId) ?? 0) + 1;
    this.state.witness[skillId] = marks;
    const outcome = witnessOutcome(this.reg, this.ctx, skillId, marks);
    const anchor = outcome.status === 'learned' ? anchorFor(this.reg, this.ctx, skillId) : null;
    if (anchor !== null) {
      this.learn(skillId, `echo:${teacher.id}`);
      this.events.emit('echo', { skill, monster: teacher, anchor });
      this.whisperRelated(skill.tags, 'echo');
    } else {
      this.evaluateClasses();
    }
    const result: WitnessResult = { status: outcome.status, marks, need: outcome.need, anchorShape: outcome.anchorShape };
    this.events.emit('witness', { skill, ...result });
    return result;
  }

  // ---------------------------------------------------------------- morphing

  /** Every morph branch of a skill with its state (hidden, requirements, charge, spark info). */
  morphOptions(id: string): MorphOption[] {
    const chargeReady = (this.progress(id)?.charges ?? 0) > 0;
    const out: MorphOption[] = [];
    for (const morph of this.reg.morphsFrom(id)) {
      const target = this.reg.skill(morph.to);
      if (!target) continue;
      const reqs = morph.requires ?? [];
      const requirements = reqs.map((r) => ({ text: this.describe(r), ok: this.meets(r) }));
      const owned = this.has(morph.to);
      const hidden = !owned && reqs.some((r, i) => !requirements[i].ok && HIDING_REQUIREMENTS.has(r.type));
      const option: MorphOption = {
        morph,
        skill: hidden ? null : target,
        tier: morph.tier ?? target.tier,
        available: requirements.every((r) => r.ok),
        owned,
        chargeReady,
        requirements,
        hint: morph.hint ?? DEFAULT_MORPH_HINT,
      };
      if (morph.spark) {
        option.spark = {
          threat: morph.spark.threat,
          minParentRank: morph.spark.minParentRank ?? DEFAULT_SPARK_PARENT_RANK,
        };
      }
      out.push(option);
    }
    return out;
  }

  /** The skill has a morph charge and at least one available, unowned branch. */
  canMorph(from: string): boolean {
    const p = this.progress(from);
    return !!p && p.charges > 0 && this.morphOptions(from).some((o) => o.available && !o.owned);
  }

  /** Spends one morph charge of `from` to learn `to` (source `morph:<from>`). */
  morph(from: string, to: string): MorphResult {
    const p = this.progress(from);
    const src = this.reg.skill(from);
    if (!p || !src) return { ok: false, message: 'You do not know that skill.' };
    const opt = this.morphOptions(from).find((o) => o.morph.to === to);
    if (!opt) return { ok: false, message: 'That is not a form this skill can take.' };
    if (opt.owned) return { ok: false, message: 'You already know that form.' };
    if (p.charges <= 0) return { ok: false, message: `${src.name} has no morph charges. Master it further.` };
    if (!opt.available || !opt.skill) {
      const unmet = opt.requirements.filter((r) => !r.ok).map((r) => r.text);
      return { ok: false, message: opt.skill ? `Not yet: ${unmet.join(', ')}.` : opt.hint };
    }
    p.charges--;
    this.learn(to, `morph:${from}`);
    this.events.emit('morphed', { from: src, to: opt.skill });
    return { ok: true, skill: opt.skill, message: `${src.name} becomes ${opt.skill.name}!` };
  }

  // ---------------------------------------------------------------- fusion

  /** Every ingredient the player owns, grouped by altar tab, with readiness. */
  ingredients(): IngredientList {
    const elements = this.knownElements().map((e) => ({ ref: elRef(e.id), name: e.name, icon: e.icon, ready: true }));
    const skills = this.known().map((s): IngredientEntry => {
      const need = fusionMinRank(s.maxRank);
      const entry = { ref: skillRef(s.id), name: s.name, icon: s.icon };
      return this.rank(s.id) >= need
        ? { ...entry, ready: true }
        : { ...entry, ready: false, message: `${s.name} must reach rank ${need} to be fused.` };
    });
    const essences: IngredientEntry[] = [];
    for (const [id, count] of Object.entries(this.state.essences)) {
      const e = this.reg.essence(id);
      if (e && count > 0) essences.push({ ref: modRef(id), name: e.name, icon: e.icon, ready: true, count });
    }
    return { elements, skills, essences };
  }

  /** What the journal remembers about a pair, without performing it. */
  rememberedPair(a: IngredientRef, b: IngredientRef): PairMemory {
    const k = pairKey(a, b);
    if (this.state.discoveries.includes(k)) return 'discovered';
    if (this.state.attempts.includes(k)) return 'nothing';
    return 'unknown';
  }

  /**
   * Fuses two ingredients (fusion.resolveFusion). Success learns the skill / element / passive
   * (source `fusion:<pair>`), consumes the essence the step names, and records the pair as an attempt
   * and a discovery. A failure with valid ingredients is remembered as an attempt; 'nothing' also
   * whispers — an unseen recipe hint for either ingredient (deterministic pick), else a related class
   * riddle, else a hint already seen.
   */
  fuse(a: IngredientRef, b: IngredientRef): FuseResult {
    const outcome = resolveFusion(this.reg, this.ctx, a, b);
    if (!outcome.ok) {
      if (NOT_ATTEMPTED.has(outcome.reason)) return { ok: false, reason: outcome.reason, message: outcome.message };
      this.remember(this.state.attempts, pairKey(a, b));
      const hint = outcome.reason === 'nothing' ? this.whisperFor(a, b) : undefined;
      return hint !== undefined
        ? { ok: false, reason: outcome.reason, message: outcome.message, hint }
        : { ok: false, reason: outcome.reason, message: outcome.message };
    }
    const key = pairKey(a, b);
    this.remember(this.state.attempts, key);
    this.remember(this.state.discoveries, key);
    const source = `fusion:${key}`;
    const result = parseRef(outcome.result);
    let isNew: boolean;
    switch (result.kind) {
      case 'skill':
        isNew = this.learn(result.id, source);
        break;
      case 'el':
        isNew = this.learnElement(result.id, source);
        break;
      case 'passive':
        isNew = this.learnPassive(result.id, source);
        break;
      case 'mod':
        this.addEssence(result.id, 1, source);
        isNew = true;
        break;
    }
    if (outcome.consumes) this.spendEssence(outcome.consumes);
    const name = this.reg.refName(outcome.result);
    const base = { a, b, result: outcome.result, kind: outcome.kind, isNew };
    this.events.emit('fused', outcome.consumes ? { ...base, consumed: outcome.consumes } : base);
    const message = isNew ? `Discovered ${name}!` : `${name} — you already know this.`;
    const res: FuseResult = { ok: true, result: outcome.result, name, isNew, kind: outcome.kind, message };
    return outcome.consumes ? { ...res, consumed: outcome.consumes } : res;
  }

  // ---------------------------------------------------------------- passives

  /** Every passive in effect (tag, learned, worn class tree, imprints). Cached; do not mutate. */
  passives(): readonly ActivePassive[] {
    return (this.cache.passives ??= activePassives(this.reg, this.state));
  }

  /**
   * Summed passive effects (passives.aggregate). Cached until something that affects passives
   * changes (learning, ranks, elements, passives, classes, imprints, bestiary stars); do not mutate.
   */
  totals(): PassiveTotals {
    return (this.cache.totals ??= aggregate(this.reg, this.state));
  }

  // ---------------------------------------------------------------- trainers

  /** A trainer lesson's state for the player (trainers.lessonState). */
  lessonState(lessonId: string): LessonState {
    return lessonStateFor(this.reg, this.ctx, lessonId);
  }

  /**
   * Takes a lesson: it must be unowned, available and affordable; the cost is paid through `inv`,
   * then the grant applied (skill / passive rank / essences / element, source `lesson:<id>`), the
   * lesson recorded and 'lesson' emitted. A skill grant also whispers a related class.
   */
  takeLesson(lessonId: string): BookOutcome {
    const entry = this.reg.lesson(lessonId);
    if (!entry) return { ok: false, message: 'No one here teaches that.' };
    const { lesson, trainer } = entry;
    const st = this.lessonState(lessonId);
    if (st.owned) return { ok: false, message: `You have already learned ${lesson.name}.` };
    if (!st.available) return { ok: false, message: `Not yet: ${st.missing.join(', ')}.` };
    const cost = lesson.cost;
    if (!st.affordable || (cost && hasPrice(cost) && !this.inv.spend(cost))) {
      return { ok: false, message: `You cannot afford ${lesson.name}.` };
    }
    this.remember(this.state.lessons, lesson.id);
    this.grantLesson(lesson);
    this.events.emit('lesson', { lesson, trainer });
    this.evaluateClasses();
    return { ok: true, message: `Learned ${lesson.name}.` };
  }

  // ---------------------------------------------------------------- classes

  /** Discovery view and codex state of a class. */
  classProgress(cls: ClassDef): ClassView {
    return classView(this.reg, this.state, cls, this.ctx);
  }

  /**
   * Discovers every class whose requirements are met now (Tier I permissive, Tier II/III hardened),
   * repeating until nothing new is found. Each discovery starts at CR 1, is worn if nothing is worn
   * yet, emits 'classDiscovered' and learns its signature skills. Returns the classes discovered.
   */
  evaluateClasses(): ClassDef[] {
    if (this.evaluating) {
      this.reevaluate = true;
      return [];
    }
    this.evaluating = true;
    const found: ClassDef[] = [];
    try {
      let again = true;
      while (again) {
        this.reevaluate = false;
        let discovered = false;
        for (const cls of this.reg.classes) {
          if (!discoverableNow(this.reg, this.state, cls, this.ctx)) continue;
          this.discover(cls);
          found.push(cls);
          discovered = true;
        }
        again = discovered || this.reevaluate;
      }
    } finally {
      this.evaluating = false;
    }
    return found;
  }

  /** Wears a discovered class (free; the game restricts it to safe maps). Unslots its own imprint. */
  wear(id: string): BookOutcome {
    const cls = this.reg.classDef(id);
    if (!cls || !this.discovered(id)) return { ok: false, message: 'You have not discovered that class.' };
    if (this.state.worn === id) return { ok: true, message: `You already wear ${cls.name}.` };
    this.setWorn(id);
    this.evaluateClasses();
    return { ok: true, message: `You now wear ${cls.name}.` };
  }

  /** Buys one rank of a tree node of a discovered class; a skill node also learns its skill. */
  buyNode(classId: string, nodeId: string): BookOutcome {
    const cls = this.reg.classDef(classId);
    const progress = own(this.state.classes, classId);
    if (!cls || !progress) return { ok: false, message: 'You have not discovered that class.' };
    const check = buyTreeNode(cls, progress, nodeId);
    if (!check.ok) return { ok: false, message: check.reason ?? 'That node cannot be bought.' };
    this.invalidate();
    const node = cls.tree?.find((n) => n.id === nodeId);
    if (node?.kind === 'skill' && this.reg.skill(node.ref)) this.learn(node.ref, `class:${classId}`);
    const label = node ? (this.reg.passive(node.ref)?.name ?? this.reg.skill(node.ref)?.name ?? node.id) : nodeId;
    return { ok: true, message: `${label} rank ${progress.spent[nodeId]}.` };
  }

  /** Refunds every tree point of a discovered class (safe maps; the game enforces where). */
  respec(classId: string): BookOutcome {
    const cls = this.reg.classDef(classId);
    const progress = own(this.state.classes, classId);
    if (!cls || !progress) return { ok: false, message: 'You have not discovered that class.' };
    respecTree(progress);
    this.invalidate();
    return { ok: true, message: `${cls.name} points refunded.` };
  }

  /**
   * Replaces the slotted imprints. Rejected (nothing changes) unless every id is distinct, discovered,
   * has an unlocked imprint, is not the worn class, and the list fits imprintSlots().
   */
  setImprints(ids: readonly string[]): BookOutcome {
    const slots = this.imprintSlots();
    if (ids.length > slots) {
      return { ok: false, message: `Only ${slots} imprint slot${slots === 1 ? '' : 's'} unlocked.` };
    }
    if (new Set(ids).size !== ids.length) return { ok: false, message: 'Each imprint can be slotted once.' };
    for (const id of ids) {
      const cls = this.reg.classDef(id);
      const progress = own(this.state.classes, id);
      if (!cls || !progress) return { ok: false, message: 'You have not discovered that class.' };
      if (id === this.state.worn) return { ok: false, message: `${cls.name} is worn; its imprint is already yours.` };
      if (!cls.imprint) return { ok: false, message: `${cls.name} has no imprint.` };
      if (!imprintUnlocked(cls, progress)) {
        return { ok: false, message: `${cls.name}'s imprint unlocks at CR ${CLASS.imprintAt[cls.tier]}.` };
      }
    }
    this.state.imprints = [...ids];
    this.invalidate();
    return { ok: true, message: ids.length > 0 ? 'Imprints set.' : 'Imprints cleared.' };
  }

  /** Imprint slots unlocked (0–3). */
  imprintSlots(): number {
    return unlockedImprintSlots(this.reg, this.state);
  }

  /**
   * Stat bonuses for the player's stats: the worn class's bonus (atk, matk, hp, sp, speed, crit, cdr)
   * plus every passive `stat` effect — class tree, imprints, trainer passives and bestiary HP — folded
   * into the matching fields (percent, crit in points). Passive `def` has no StatBonus field: read it
   * with passives.statPct(book.totals(), 'def'). Skill damage is tagPowerFor(), never `tagPower` here.
   */
  activeBonus(): StatBonus {
    const bonus = classStatBonus(this.reg, this.state);
    const stat = this.totals().stat;
    for (const key of BONUS_STATS) {
      const pct = stat[key];
      if (pct) bonus[key] = (bonus[key] ?? 0) + pct;
    }
    return bonus;
  }

  /**
   * Percent bonus damage for a skill: the worn class's tagPower plus passive power (tag passives
   * ≤ 25%, everything ≤ 45%; passives.powerPctFor). Pass as computeDamage's `tagPct`.
   */
  tagPowerFor(skill: Pick<SkillDef, 'tags'>): number {
    return powerPctFor(this.totals(), skill);
  }

  /**
   * Reveals an undiscovered class's riddle in the codex (state.whispered) and emits 'hint' with it.
   * The game calls it for NPC reveals (e.g. the Loremaster); the book itself whispers on failed
   * fusions, echoes, bestiary star 2 and lessons. Returns false if already whispered or discovered.
   */
  whisperClass(id: string, source: WhisperSource = 'trainer'): boolean {
    const cls = this.reg.classDef(id);
    if (!cls || this.discovered(id) || this.state.whispered.includes(id)) return false;
    this.state.whispered.push(id);
    this.remember(this.state.hints, cls.hint);
    this.events.emit('hint', { text: cls.hint, source, classId: id });
    return true;
  }

  // ---------------------------------------------------------------- journal

  /** Discovery totals for the journal. */
  stats(): BookStats {
    const known = this.known();
    const learnable = this.reg.authoredSkills().filter((s) => !s.tags.includes(MONSTER_TAG));
    const echoes = learnable.filter((s) => echoNeed(this.reg, s.id) !== null);
    let essencesHeld = 0;
    let essenceKinds = 0;
    for (const n of Object.values(this.state.essences)) {
      if (n <= 0) continue;
      essencesHeld += n;
      essenceKinds++;
    }
    let speciesSeen = 0;
    let kills = 0;
    for (const [id, n] of Object.entries(this.state.bestiary)) {
      if (n <= 0 || !this.reg.monster(id)) continue;
      speciesSeen++;
      kills += n;
    }
    return {
      skillsKnown: known.length,
      authoredKnown: known.filter((s) => !s.generated).length,
      authoredTotal: learnable.length,
      infusions: known.filter((s) => s.generated).length,
      elementsKnown: this.knownElements().length,
      elementsTotal: this.reg.elements.size,
      classesKnown: Object.keys(this.state.classes).length,
      classesTotal: this.reg.classes.length,
      experiments: this.state.attempts.length,
      discoveries: this.state.discoveries.length,
      echoesKnown: echoes.filter((s) => this.has(s.id)).length,
      echoesTotal: echoes.length,
      passivesActive: this.passives().length,
      essencesHeld,
      essenceKinds,
      speciesSeen,
      speciesTotal: this.reg.monsters.size,
      kills,
    };
  }

  /** A deep, JSON-safe copy of the state for saving. */
  serialize(): SkillBookState {
    return JSON.parse(JSON.stringify(this.state)) as SkillBookState;
  }

  // ---------------------------------------------------------------- internals

  /** The live view of the player every rule module reads (getters keep it current). */
  private makeContext(): BookContext {
    const book = this;
    const ctx: BookContext = {
      get level() {
        return book.level;
      },
      get worn() {
        return book.state.worn;
      },
      get lessons() {
        return book.state.lessons;
      },
      hasElement: (id) => book.hasElement(id),
      elementsKnown: (primalOnly) =>
        book.knownElements().filter((e) => !primalOnly || PRIMAL_ELEMENTS.includes(e.id)).length,
      rank: (id) => book.rank(id),
      flag: (id) => book.flag(id),
      classRank: (id) => own(book.state.classes, id)?.rank ?? 0,
      tagCount: (tags, minRank) => countTagged(book.reg, book.state.skills, tags, minRank),
      itemCount: (id) => book.inv.count(id),
      witness: (id) => own(book.state.witness, id) ?? 0,
      has: (id) => book.has(id),
      passiveRank: (id) => own(book.state.passives, id) ?? 0,
      coins: () => book.inv.coins(),
      essenceCount: (id) => own(book.state.essences, id) ?? 0,
      overBars: (id) => book.progress(id)?.overBars ?? 0,
      meets: (req) => meetsRequirement(req, ctx),
      known: () => Object.keys(book.state.skills),
    };
    return ctx;
  }

  private invalidate(): void {
    this.cache = {};
  }

  private discovered(classId: string): boolean {
    return Object.hasOwn(this.state.classes, classId);
  }

  /** Adds a string to a journal list once. */
  private remember(list: string[], value: string): void {
    if (!list.includes(value)) list.push(value);
  }

  /** Completes overmastery bars at max rank (see addMastery). */
  private fillOverBars(p: SkillProgress, skill: SkillDef): void {
    const cost = overmasteryCost(skill.maxRank, skill.tier);
    while (p.xp >= cost) {
      const capped = p.charges >= MASTERY.maxCharges;
      if (capped && slotsFor(skill, p.overBars) >= slotsFor(skill, p.overBars + 1)) {
        p.xp = cost;
        return;
      }
      p.xp -= cost;
      p.overBars++;
      if (!capped) p.charges++;
    }
  }

  /** Emits 'passive' for every tag passive that unlocked or ranked up since the last check. */
  private checkTagPassives(): void {
    for (const p of this.passives()) {
      if (p.source !== 'tag' || p.rank <= (this.tagRanks.get(p.def.id) ?? 0)) continue;
      this.tagRanks.set(p.def.id, p.rank);
      this.events.emit('passive', { def: p.def, rank: p.rank, source: 'tag' });
    }
  }

  private discover(cls: ClassDef): void {
    this.state.classes[cls.id] = { rank: 1, xp: 0, spent: {} };
    const worn = this.state.worn === null || !this.discovered(this.state.worn);
    if (worn) this.setWorn(cls.id);
    this.invalidate();
    this.events.emit('classDiscovered', { cls, worn });
    for (const g of cls.grants ?? []) if (this.reg.skill(g)) this.learn(g, `class:${cls.id}`);
  }

  private setWorn(id: string): void {
    this.state.worn = id;
    this.state.flags[BOOK_FLAGS.classWorn] = Math.max(1, this.flag(BOOK_FLAGS.classWorn));
    this.state.imprints = this.state.imprints.filter((i) => i !== id);
    this.invalidate();
  }

  private spendEssence(id: string): void {
    const left = (own(this.state.essences, id) ?? 0) - 1;
    if (left > 0) this.state.essences[id] = left;
    else delete this.state.essences[id];
  }

  private grantLesson(lesson: LessonDef): void {
    const g = lesson.grants;
    const source = `lesson:${lesson.id}`;
    if ('skill' in g) {
      this.learn(g.skill, source);
      const skill = this.reg.skill(g.skill);
      if (skill) this.whisperRelated(skill.tags, 'trainer');
    } else if ('passive' in g) {
      this.learnPassive(g.passive, source);
    } else if ('essence' in g) {
      this.addEssence(g.essence, g.count, source);
    } else {
      this.learnElement(g.element, source);
    }
  }

  /** Rolls a kill's essence drop; returns the essence id when one dropped. */
  private rollEssence(monster: MonsterDef, kills: number): string | undefined {
    const id = monster.essence;
    if (!id || !this.reg.essence(id)) return undefined;
    const flags = this.state.flags;
    const n = this.flag(BOOK_FLAGS.essenceRolls);
    flags[BOOK_FLAGS.essenceRolls] = n + 1;
    const roll = mulberry32(hashSeed(this.state.spark.seed, ESSENCE_STREAM, n))();
    const dropKey = BOOK_FLAGS.essenceDropPrefix + monster.id;
    const dropped = this.flag(dropKey);
    const guaranteed = dropped === 0 && kills >= ESSENCE_DROP.guaranteedAt;
    if (!guaranteed && roll >= ESSENCE_DROP.chance) return undefined;
    flags[dropKey] = dropped + 1;
    this.addEssence(id, 1, `drop:${monster.id}`);
    return id;
  }

  /**
   * Whispers the first undiscovered, unwhispered class (data order, hidden ones included) having a
   * clause whose tags are all among `tags`. Returns it, if any.
   */
  private whisperRelated(tags: readonly string[], source: WhisperSource): ClassDef | undefined {
    const have = new Set(tags);
    const cls = this.reg.classes.find(
      (c) =>
        !this.discovered(c.id) &&
        !this.state.whispered.includes(c.id) &&
        c.clauses.some((clause) => clause.tags.length > 0 && clause.tags.every((t) => have.has(t))),
    );
    if (cls) this.whisperClass(cls.id, source);
    return cls;
  }

  /** Tags an altar pair brings: skill tags, element ids and essence tags. */
  private ingredientTags(refs: readonly IngredientRef[]): string[] {
    const tags: string[] = [];
    for (const ref of refs) {
      const p = parseRef(ref);
      if (p.kind === 'skill') tags.push(...(this.reg.skill(p.id)?.tags ?? []));
      else if (p.kind === 'el') tags.push(p.id);
      else if (p.kind === 'mod') {
        const tag = this.reg.essence(p.id)?.tag;
        if (tag) tags.push(tag);
      }
    }
    return tags;
  }

  /** The whisper for a failed ('nothing') fusion; see fuse(). */
  private whisperFor(a: IngredientRef, b: IngredientRef): string | undefined {
    const texts = [
      ...new Set(hintCandidates(this.reg, a, b, this.state.discoveries).flatMap((r) => (r.hint ? [r.hint] : []))),
    ];
    const pick = (list: readonly string[]): string => list[hashSeed(pairKey(a, b)) % list.length];
    const fresh = texts.filter((t) => !this.state.hints.includes(t));
    if (fresh.length > 0) {
      const text = pick(fresh);
      this.state.hints.push(text);
      this.events.emit('hint', { text, source: 'fusion' });
      return text;
    }
    const cls = this.whisperRelated(this.ingredientTags([a, b]), 'fusion');
    if (cls) return cls.hint;
    return texts.length > 0 ? pick(texts) : undefined;
  }
}
