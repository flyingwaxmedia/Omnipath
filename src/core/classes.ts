// Classes v4 (docs/SPEC-v4.md §3.3 – §3.4; Phase 1): rarity, one max level (10) for every class, Class XP only
// while the class is worn, the level table (kit skills at 1 / 1 / 2 / 4 / 6, the mechanic upgrade at 8, mastery at
// 10, the bonus growing from 40% to 100%), discovery by ClassDiscovery (requirements + an optional Trial quest) and
// kit-based class slots. Pure functions over the Registry and SkillBookState; the SkillBook orchestrates (events,
// kit grants, wearing, whispers).
//
// A class without `discover` / `kit` is a v2 class and keeps its v2 behaviour (pattern discovery, relevance slots)
// until the content lane re-authors it. Today's Keepsakes (`imprint`, Class Level 5) work unchanged until Phase 2.
// The class tree is gone: no points, no nodes.
import type { Registry } from './registry';
import { countTagged, describeRequirement, meetsRequirement, weaponOk, type RequirementContext } from './requirements';
import type { ClassProgress, SkillBookState, SkillProgress } from './state';
import {
  GRIP_TAG,
  type ClassClause,
  type ClassDef,
  type ClassMechanic,
  type ClassTier,
  type ElementId,
  type Rarity,
  type SkillDef,
  type StatBonus,
  type WeaponType,
} from './types';

/** Class tuning (SPEC-v4 §3.4). All [T]. */
export const CLASS: {
  /** The one max Class Level. "Mastered" means this level, nothing else. */
  readonly maxLevel: number;
  /** kit[i] unlocks at Class Level kitAt[i]. */
  readonly kitAt: readonly [number, number, number, number, number];
  /** Class Level from which `ClassDef.mechanicUpgrade` replaces the mechanic. */
  readonly mechanicUpgradeAt: number;
  /** Share of a skill's mastery XP the worn class gains. Unworn classes gain nothing. */
  readonly wornShare: number;
  /** Class XP curve multiplier per rarity. */
  readonly xpMul: Readonly<Record<Rarity, number>>;
  /** Share of the class bonus at Class Level 1; it grows linearly to 1 at maxLevel. */
  readonly bonusAtOne: number;
  /** Class Level at which today's Keepsake (`ClassDef.imprint`) unlocks. Goes away in Phase 2. */
  readonly imprintAt: number;
} = {
  maxLevel: 10,
  kitAt: [1, 1, 2, 4, 6],
  mechanicUpgradeAt: 8,
  wornShare: 0.5,
  xpMul: { common: 1, uncommon: 1, rare: 1.2, epic: 1.4, legendary: 1.6, mythic: 1.6 },
  bonusAtOne: 0.4,
  imprintAt: 5,
};

/** Hardened v2 discovery (Tier II/III) counts only skills at this rank or above. */
export const HARDENED_RANK = 5;

/** Codex thresholds on discovery progress: whispered from 25%, near (progress shown) from 50%. */
export const CODEX = { whisperAt: 0.25, nearAt: 0.5 } as const;

/** Discovered classes that open the third imprint slot (any Tier III class also does). */
export const IMPRINT_THIRD_SLOT_CLASSES = 12;

/** StatBonus fields that are plain stats (everything except `tagPower`). */
const STAT_KEYS = ['atk', 'matk', 'hp', 'sp', 'speed', 'crit', 'cdr'] as const satisfies readonly Exclude<
  keyof StatBonus,
  'tagPower'
>[];

/** Codex state of a class: hidden riddle → riddle shown → progress shown → discovered. */
export type CodexState = 'unknown' | 'whispered' | 'near' | 'known';

/** Everything the class panel and codex show about one class. */
export interface ClassView {
  cls: ClassDef;
  discovered: boolean;
  /** Class Level (0 while undiscovered). */
  rank: number;
  /** Discovery progress 0..1: the mean fill of every component below (1 once discovered). */
  progress: number;
  /** v2 classes: matching skills per clause (hardened counting for Tier II/III). Empty for v4 classes. */
  clauses: { clause: ClassClause; have: number }[];
  /** Distinct skill elements, when a v2 class asks for them. */
  elements?: { have: number; need: number };
  /** v2 parent classes and their current Class Level (0 if undiscovered). */
  parents?: { id: string; need: number; have: number }[];
  /** Requirements with display text: `discover.requires` (v4) or the v2 extras. */
  requires?: { text: string; ok: boolean }[];
  /**
   * v4 classes with a Trial: the quest, whether every requirement holds (the card reads "Trial ready" and the one
   * action is Begin Trial) and whether the Trial is finished.
   */
  trial?: { quest: string; ready: boolean; done: boolean };
  codex: CodexState;
}

/** One Class Level gained by a class (grantClassXp reports one entry per level). */
export interface ClassRankUp {
  cls: ClassDef;
  /** The level just reached. */
  rank: number;
}

/** @deprecated Outcome of a class-tree purchase check. The tree is gone; canBuyNode always refuses. */
export interface NodeCheck {
  ok: boolean;
  reason?: string;
}

// ------------------------------------------------------------------ rarity, levels, the level table

/** v2 tier of a class: its own `tier`, else by rarity (common/uncommon 1, rare 2, epic and above 3). */
export function classTier(cls: Pick<ClassDef, 'tier' | 'rarity'>): ClassTier {
  if (cls.tier !== undefined) return cls.tier;
  if (cls.rarity === 'rare') return 2;
  return cls.rarity === 'epic' || cls.rarity === 'legendary' || cls.rarity === 'mythic' ? 3 : 1;
}

/** Rarity of a class: its own, else from the v2 tier (I uncommon, II rare, III epic). */
export function classRarity(cls: Pick<ClassDef, 'tier' | 'rarity'>): Rarity {
  if (cls.rarity !== undefined) return cls.rarity;
  return cls.tier === 3 ? 'epic' : cls.tier === 2 ? 'rare' : 'uncommon';
}

/** Whether a class is authored for v4 (it has a kit). */
export function isKitClass(cls: ClassDef): cls is ClassDef & { kit: [string, string, string, string, string] } {
  return cls.kit !== undefined;
}

/** XP to go from Class Level `level` to `level + 1`: round(60 × 1.22^(level-1) × CLASS.xpMul[rarity]). */
export function classXpToNext(level: number, rarity: Rarity = 'common'): number {
  return Math.round(60 * Math.pow(1.22, level - 1) * CLASS.xpMul[rarity]);
}

/** XP a class needs for its next level (classXpToNext at its rarity). */
export function classXpNeed(cls: Pick<ClassDef, 'tier' | 'rarity'>, level: number): number {
  return classXpToNext(level, classRarity(cls));
}

/** Highest Class Level: CLASS.maxLevel for every class. */
export function classMaxRank(_cls?: unknown): number {
  return CLASS.maxLevel;
}

/** "Mastered" means Class Level 10. Nothing else. */
export function mastered(_cls: unknown, progress: Pick<ClassProgress, 'rank'> | undefined): boolean {
  return (progress?.rank ?? 0) >= CLASS.maxLevel;
}

/** How many kit skills a Class Level has unlocked (2 / 3 / 4 / 5 at levels 1 / 2 / 4 / 6). */
export function kitUnlocked(level: number): number {
  return CLASS.kitAt.filter((at) => level >= at).length;
}

/** The kit skills a class has unlocked at `level`, in kit order ([] for a class without a kit). */
export function kitSkillsAt(cls: Pick<ClassDef, 'kit'>, level: number): string[] {
  return cls.kit ? cls.kit.slice(0, kitUnlocked(level)) : [];
}

/** The Class Level that unlocks a kit skill, or undefined when the skill is not in the kit. */
export function kitLevelOf(cls: Pick<ClassDef, 'kit'>, skillId: string): number | undefined {
  const i = cls.kit?.indexOf(skillId) ?? -1;
  return i < 0 ? undefined : CLASS.kitAt[i];
}

/** The mechanic a class runs at `level`: `mechanicUpgrade.mechanic` from CLASS.mechanicUpgradeAt on. */
export function classMechanic(cls: Pick<ClassDef, 'mechanic' | 'mechanicUpgrade'>, level: number): ClassMechanic | undefined {
  return level >= CLASS.mechanicUpgradeAt && cls.mechanicUpgrade ? cls.mechanicUpgrade.mechanic : cls.mechanic;
}

/** Share of the class bonus at a Class Level: 40% at 1, growing linearly to 100% at 10. */
export function bonusShare(level: number): number {
  const l = Math.max(1, Math.min(CLASS.maxLevel, level));
  return CLASS.bonusAtOne + ((1 - CLASS.bonusAtOne) * (l - 1)) / (CLASS.maxLevel - 1);
}

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** A class's `bonus` at a Class Level (every number × bonusShare, to 0.01). */
export function classBonusAt(cls: Pick<ClassDef, 'bonus'>, level: number): StatBonus {
  const share = bonusShare(level);
  const out: StatBonus = {};
  for (const key of STAT_KEYS) {
    const v = cls.bonus[key];
    if (v !== undefined) out[key] = round2(v * share);
  }
  if (cls.bonus.tagPower) {
    out.tagPower = {};
    for (const [tag, pct] of Object.entries(cls.bonus.tagPower)) out.tagPower[tag] = round2(pct * share);
  }
  return out;
}

// ------------------------------------------------------------------ matching & counting (v2 patterns)

/** v2 Tier II/III classes use hardened discovery counting. */
function isHardened(cls: Pick<ClassDef, 'tier'>): boolean {
  return (cls.tier ?? 1) >= 2;
}

/** Whether a skill has every tag of a clause (element ids and weapons are tags). */
function clauseMatches(clause: ClassClause, skill: Pick<SkillDef, 'tags'>): boolean {
  return clause.tags.every((t) => skill.tags.includes(t));
}

/**
 * Whether a skill's mastery feeds a class's Class Rank: the skill has every tag of at least one
 * clause, or carries an element when the class asks for distinct elements. A class with neither
 * clauses nor an element requirement (defined only by parents/requires) is fed by every skill.
 */
export function classMatchesSkill(
  cls: Pick<ClassDef, 'clauses' | 'distinctElements'>,
  skill: Pick<SkillDef, 'tags' | 'element'>,
): boolean {
  const clauses = cls.clauses ?? [];
  if (clauses.length === 0 && !cls.distinctElements) return true;
  if (cls.distinctElements && skill.element !== undefined) return true;
  return clauses.some((c) => clauseMatches(c, skill));
}

/**
 * Skills counting toward a clause. Permissive (Tier I, v1 rule): every known skill id with the
 * clause's tags, variants included. Hardened (Tier II/III): distinct authored skills with the tags
 * at rank ≥ HARDENED_RANK, a variant counting as its base (see countTagged).
 */
export function clauseCount(
  reg: Registry,
  state: Pick<SkillBookState, 'skills'>,
  clause: ClassClause,
  hardened: boolean,
): number {
  if (hardened) return countTagged(reg, state.skills, clause.tags, HARDENED_RANK);
  let n = 0;
  for (const id of Object.keys(state.skills)) {
    const skill = reg.skill(id);
    if (skill && clauseMatches(clause, skill)) n++;
  }
  return n;
}

/**
 * Distinct elements among known skills. Permissive (Tier I): every known skill id's element.
 * Hardened (Tier II/III): only skills at rank ≥ HARDENED_RANK, and each distinct authored skill (a
 * variant or merge counting as its base, Registry.baseOf) contributes at most one element — the
 * size of a maximum matching between authored skills and the elements they carry.
 */
function distinctElementCount(
  reg: Registry,
  skills: Readonly<Record<string, SkillProgress>>,
  hardened: boolean,
): number {
  if (!hardened) {
    const seen = new Set<string>();
    for (const id of Object.keys(skills)) {
      const element = reg.skill(id)?.element;
      if (element) seen.add(element);
    }
    return seen.size;
  }
  // Element -> authored bases carrying it (at the hardened rank).
  const basesOf = new Map<string, Set<string>>();
  for (const [id, progress] of Object.entries(skills)) {
    if (progress.rank < HARDENED_RANK) continue;
    const element = reg.skill(id)?.element;
    const base = reg.baseOf(id);
    if (!element || base === undefined) continue;
    let bases = basesOf.get(element);
    if (!bases) basesOf.set(element, (bases = new Set()));
    bases.add(base);
  }
  return maxMatching(basesOf);
}

/**
 * Size of a maximum bipartite matching from keys to the values they list (augmenting paths,
 * Kuhn's algorithm): how many keys can each take a distinct value.
 */
function maxMatching(edges: ReadonlyMap<string, ReadonlySet<string>>): number {
  const owner = new Map<string, string>();
  const augment = (key: string, visited: Set<string>): boolean => {
    for (const value of edges.get(key) ?? []) {
      if (visited.has(value)) continue;
      visited.add(value);
      const held = owner.get(value);
      if (held === undefined || augment(held, visited)) {
        owner.set(value, key);
        return true;
      }
    }
    return false;
  };
  let size = 0;
  for (const key of edges.keys()) if (augment(key, new Set())) size++;
  return size;
}

// ------------------------------------------------------------------ discovery

/** Fill of one discovery component, 0..1. */
function fill(have: number, need: number): number {
  return need <= 0 ? 1 : Math.min(have, need) / need;
}

/** A class view without the codex state, plus each component's fill. */
interface Evaluation {
  view: Omit<ClassView, 'codex' | 'progress' | 'discovered' | 'rank'>;
  fills: number[];
}

/** Whether every `discover.requires` entry holds. */
function discoveryMet(cls: ClassDef, ctx: RequirementContext): boolean {
  return (cls.discover?.requires ?? []).every((req) => meetsRequirement(req, ctx));
}

function trialDone(cls: ClassDef, ctx: RequirementContext): boolean {
  return cls.discover?.trial === undefined || (ctx.questDone?.(cls.discover.trial) ?? 0) >= 1;
}

function evaluate(reg: Registry, state: Readonly<SkillBookState>, cls: ClassDef, ctx: RequirementContext): Evaluation {
  const fills: number[] = [];
  if (cls.discover) {
    const view: Evaluation['view'] = { cls, clauses: [] };
    view.requires = cls.discover.requires.map((req) => {
      const ok = meetsRequirement(req, ctx);
      fills.push(ok ? 1 : 0);
      return { text: describeRequirement(reg, req, ctx), ok };
    });
    if (cls.discover.trial !== undefined) {
      const done = trialDone(cls, ctx);
      fills.push(done ? 1 : 0);
      view.trial = { quest: cls.discover.trial, ready: !done && view.requires.every((r) => r.ok), done };
    }
    return { view, fills };
  }
  const hardened = isHardened(cls);
  const clauses = (cls.clauses ?? []).map((clause) => {
    const have = clauseCount(reg, state, clause, hardened);
    fills.push(fill(have, clause.count));
    return { clause, have };
  });
  const view: Evaluation['view'] = { cls, clauses };
  if (cls.distinctElements) {
    const have = distinctElementCount(reg, state.skills, hardened);
    fills.push(fill(have, cls.distinctElements));
    view.elements = { have, need: cls.distinctElements };
  }
  if (cls.parents?.length) {
    view.parents = cls.parents.map((p) => {
      const have = state.classes[p.id]?.rank ?? 0;
      fills.push(fill(have, p.rank));
      return { id: p.id, need: p.rank, have };
    });
  }
  if (cls.requires?.length) {
    view.requires = cls.requires.map((req) => {
      const ok = meetsRequirement(req, ctx);
      fills.push(ok ? 1 : 0);
      return { text: describeRequirement(reg, req, ctx), ok };
    });
  }
  return { view, fills };
}

function codexState(cls: ClassDef, discovered: boolean, progress: number, whispered: boolean): CodexState {
  if (discovered) return 'known';
  // Hidden classes stay out of the codex until something explicitly whispers them.
  if (cls.hidden && !whispered) return 'unknown';
  if (progress >= CODEX.nearAt) return 'near';
  if (whispered || progress >= CODEX.whisperAt) return 'whispered';
  return 'unknown';
}

/**
 * Discovery view of a class: per-clause counts (hardened for Tier II/III), distinct elements,
 * parents' Class Ranks, extra requirements, overall progress (mean component fill, 1 once
 * discovered) and the codex state. Hidden classes read 'unknown' until listed in `state.whispered`;
 * other classes are whispered from 25% progress and near from 50%.
 */
export function classProgress(
  reg: Registry,
  state: Readonly<SkillBookState>,
  cls: ClassDef,
  ctx: RequirementContext,
): ClassView {
  const { view, fills } = evaluate(reg, state, cls, ctx);
  const own = state.classes[cls.id];
  const discovered = own !== undefined;
  const progress = discovered ? 1 : fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : 0;
  return {
    ...view,
    discovered,
    rank: own?.rank ?? 0,
    progress,
    codex: codexState(cls, discovered, progress, state.whispered.includes(cls.id)),
  };
}

/**
 * Whether an undiscovered v4 class is waiting on its Trial only: every `discover.requires` entry holds and the
 * Trial quest is not finished ("Trial ready: Glyphwarden" — Begin Trial).
 */
export function trialReady(state: Readonly<SkillBookState>, cls: ClassDef, ctx: RequirementContext): boolean {
  if (state.classes[cls.id] || cls.discover?.trial === undefined) return false;
  return discoveryMet(cls, ctx) && !trialDone(cls, ctx);
}

/**
 * v4 classes (`discover`): every requirement holds and the Trial quest, if any, is finished. v2 classes:
 * whether an undiscovered class's requirements are all met right now: every parent Class Rank,
 * extra requirement, distinct elements and clause count (checked in that order, cheapest first,
 * stopping at the first unmet one). False for discovered classes and for classes with nothing to
 * satisfy (invalid data, reported by Registry.validate). Agrees with classProgress: true exactly
 * when an undiscovered class with at least one component has progress 1.
 */
export function discoverableNow(
  reg: Registry,
  state: Readonly<SkillBookState>,
  cls: ClassDef,
  ctx: RequirementContext,
): boolean {
  if (state.classes[cls.id]) return false;
  if (cls.discover) {
    const components = cls.discover.requires.length + (cls.discover.trial !== undefined ? 1 : 0);
    return components > 0 && discoveryMet(cls, ctx) && trialDone(cls, ctx);
  }
  let components = 0;
  for (const p of cls.parents ?? []) {
    if ((state.classes[p.id]?.rank ?? 0) < p.rank) return false;
    components++;
  }
  for (const req of cls.requires ?? []) {
    if (!meetsRequirement(req, ctx)) return false;
    components++;
  }
  const hardened = isHardened(cls);
  if (cls.distinctElements) {
    if (distinctElementCount(reg, state.skills, hardened) < cls.distinctElements) return false;
    components++;
  }
  for (const clause of cls.clauses ?? []) {
    if (clauseCount(reg, state, clause, hardened) < clause.count) return false;
    components++;
  }
  return components > 0;
}

// ------------------------------------------------------------------ Class XP (only while worn)

/** Adds XP to one class, levelling it up to CLASS.maxLevel (XP is dropped at max). */
function addClassXp(cls: ClassDef, progress: ClassProgress, amount: number): ClassRankUp[] {
  const max = CLASS.maxLevel;
  const ups: ClassRankUp[] = [];
  if (progress.rank >= max) {
    progress.xp = 0;
    return ups;
  }
  progress.xp += amount;
  while (progress.rank < max && progress.xp >= classXpNeed(cls, progress.rank)) {
    progress.xp -= classXpNeed(cls, progress.rank);
    progress.rank++;
    ups.push({ cls, rank: progress.rank });
  }
  if (progress.rank >= max) progress.xp = 0;
  return ups;
}

/**
 * Whether a skill's mastery XP feeds a class while it is worn. v4 (kit) classes: the skill is in the kit (a
 * variant counts as its base) or is usable with the class weapon (free skills always are; an 'any' class takes
 * every skill). v2 classes: classMatchesSkill.
 */
export function classFeeds(reg: Registry, cls: ClassDef, skill: SkillDef): boolean {
  if (!isKitClass(cls)) return classMatchesSkill(cls, skill);
  if (cls.kit.includes(reg.baseOf(skill.id) ?? skill.id)) return true;
  return cls.weapon === undefined || cls.weapon === 'any' || weaponOk(skill, cls.weapon);
}

/**
 * Feeds `xp` mastery XP earned by `skill` into the WORN class only (mutates `state.classes`): it gains
 * `CLASS.wornShare × xp` when classFeeds. Unworn classes gain nothing: mastery must mean you played it. Returns one
 * entry per level gained, never beyond CLASS.maxLevel. Non-positive or non-finite XP is ignored.
 */
export function grantClassXp(reg: Registry, state: SkillBookState, skill: SkillDef, xp: number): ClassRankUp[] {
  if (!Number.isFinite(xp) || xp <= 0) return [];
  const cls = wornClass(reg, state);
  if (!cls || !classFeeds(reg, cls, skill)) return [];
  return addClassXp(cls, state.classes[cls.id], xp * CLASS.wornShare);
}

// ------------------------------------------------------------------ the removed tree (stubs for old screens)

/** @deprecated The class tree is gone (SPEC-v4 §3.4): always 0. */
export function spentPoints(_cls?: unknown, _progress?: unknown): number {
  return 0;
}

/** @deprecated The class tree is gone: always 0. */
export function classPoints(_cls?: unknown, _progress?: unknown): number {
  return 0;
}

/** @deprecated The class tree is gone: always refuses. */
export function canBuyNode(_cls?: unknown, _progress?: unknown, _nodeId?: string): NodeCheck {
  return { ok: false, reason: 'Classes grow by themselves now.' };
}

// ------------------------------------------------------------------ imprints (today's Keepsakes, until Phase 2)

/** Whether a class has an imprint and has reached CLASS.imprintAt (Class Level 5). */
export function imprintUnlocked(cls: ClassDef, progress: ClassProgress): boolean {
  return cls.imprint !== undefined && progress.rank >= CLASS.imprintAt;
}

/**
 * Imprint slots unlocked: 1 once any discovered class reaches CLASS.imprintAt, 2 once any Tier II (rare) class is
 * discovered, 3 once any Tier III (epic or above) class or IMPRINT_THIRD_SLOT_CLASSES classes are discovered (the
 * highest satisfied rule wins). Classes missing from the registry are ignored.
 */
export function imprintSlots(reg: Registry, state: Readonly<SkillBookState>): number {
  let discovered = 0;
  let atImprintRank = false;
  let tier2 = false;
  let tier3 = false;
  for (const [id, progress] of Object.entries(state.classes)) {
    const cls = reg.classDef(id);
    if (!cls) continue;
    discovered++;
    if (progress.rank >= CLASS.imprintAt) atImprintRank = true;
    const tier = classTier(cls);
    if (tier === 2) tier2 = true;
    if (tier === 3) tier3 = true;
  }
  if (tier3 || discovered >= IMPRINT_THIRD_SLOT_CLASSES) return 3;
  if (tier2) return 2;
  return atImprintRank ? 1 : 0;
}

// ------------------------------------------------------------------ worn class

/** The worn class, if it is set, discovered and known to the registry. */
export function wornClass(reg: Registry, state: Readonly<SkillBookState>): ClassDef | undefined {
  return state.worn !== null && state.classes[state.worn] ? reg.classDef(state.worn) : undefined;
}

/** The worn class's whole bonus at its current Class Level (classBonusAt). Empty when nothing is worn. */
export function wornBonus(reg: Registry, state: Readonly<SkillBookState>): StatBonus {
  const cls = wornClass(reg, state);
  return cls ? classBonusAt(cls, state.classes[cls.id].rank) : {};
}

/** The worn class's mechanic at its current Class Level, if it has one. */
export function wornMechanic(reg: Registry, state: Readonly<SkillBookState>): ClassMechanic | undefined {
  const cls = wornClass(reg, state);
  return cls ? classMechanic(cls, state.classes[cls.id].rank) : undefined;
}

/**
 * Percent bonus damage the worn class's `bonus.tagPower` (at its Class Level) gives a skill: the sum over the skill's
 * distinct tags. Display breakdown only — passives.powerPctFor already includes it (under the
 * shared per-skill cap), so never add the two together.
 */
export function classTagPct(reg: Registry, state: Readonly<SkillBookState>, skill: Pick<SkillDef, 'tags'>): number {
  const tagPower = wornBonus(reg, state).tagPower;
  if (!tagPower) return 0;
  let pct = 0;
  for (const tag of new Set(skill.tags)) if (Object.hasOwn(tagPower, tag)) pct += tagPower[tag];
  return pct;
}

/**
 * The worn class's stat bonus at its Class Level (atk, matk, hp, sp, speed, crit, cdr; percentages as authored ×
 * bonusShare), without `tagPower` — skill damage goes through passives.powerPctFor. Empty when nothing is worn.
 */
export function classStatBonus(reg: Registry, state: Readonly<SkillBookState>): StatBonus {
  const { tagPower: _tagPower, ...stats } = wornBonus(reg, state);
  return stats;
}

// ------------------------------------------------------------------ class slots (SPEC-v4 §3.4)

/** Class slots on the skill bar that a class fills automatically. */
export const CLASS_SLOTS = 5;

/** A skill that can sit on the skill bar (not a weapon basic attack, not a monster-only technique). */
export function barEligible(skill: Pick<SkillDef, 'tier' | 'tags'>): boolean {
  return !(skill.tier === 0 && skill.tags.includes('basic')) && !skill.tags.includes('monster');
}

/**
 * A skill that can sit in one of YOUR slots: bar-eligible and not a class skill (`classOf` skills only ever sit in
 * a class slot of their class).
 */
export function ownSlotEligible(skill: Pick<SkillDef, 'tier' | 'tags' | 'classOf'>): boolean {
  return barEligible(skill) && skill.classOf === undefined;
}

/** Whether a skill may sit in a class slot of `cls`: bar-eligible and not another class's own skill. */
export function classSlotEligible(cls: Pick<ClassDef, 'id'>, skill: Pick<SkillDef, 'tier' | 'tags' | 'classOf'>): boolean {
  return barEligible(skill) && (skill.classOf === undefined || skill.classOf === cls.id);
}

/**
 * The tags a class builds on, main tag first. v2 classes: the `tag` of each passive in the old tree data (still
 * read for this theme only — the nodes themselves do nothing) and of the imprint, e.g. Pyroblade → ['fire',
 * 'blade']. v4 classes: the class weapon's grip tag.
 */
export function classTreeTags(reg: Registry, cls: Pick<ClassDef, 'tree' | 'imprint' | 'weapon'>): string[] {
  const tags: string[] = [];
  const add = (passiveId: string | undefined) => {
    const effect = passiveId ? reg.passive(passiveId)?.effect : undefined;
    const tag = effect && 'tag' in effect ? effect.tag : undefined;
    if (tag && !tags.includes(tag)) tags.push(tag);
  };
  for (const node of cls.tree ?? []) if (node.kind !== 'skill') add(node.ref);
  add(cls.imprint);
  if (cls.weapon !== undefined && cls.weapon !== 'any' && !tags.includes(GRIP_TAG[cls.weapon])) tags.push(GRIP_TAG[cls.weapon]);
  return tags;
}

/** What a v2 class is about, for "related" skills: tags (patterns + keepsake) and elements (patterns, requirements, bonus). */
interface ClassTheme {
  tags: ReadonlySet<string>;
  elements: ReadonlySet<string>;
}

function classTheme(reg: Registry, cls: ClassDef): ClassTheme {
  const clauseTags = (cls.clauses ?? []).flatMap((c) => c.tags);
  const named = [
    ...clauseTags,
    ...Object.keys(cls.bonus.tagPower ?? {}),
    ...(cls.requires ?? []).flatMap((r) => (r.type === 'element' ? [r.id] : [])),
  ];
  return {
    tags: new Set([...clauseTags, ...classTreeTags(reg, cls)]),
    elements: new Set(named.filter((t) => reg.element(t as ElementId) !== undefined)),
  };
}

/** How a skill fits a class: 'match' (a kit skill; v2: fits a pattern), 'related' (a fill), else null. */
export type ClassFit = 'match' | 'related';

function fitOf(cls: ClassDef, theme: ClassTheme, skill: Pick<SkillDef, 'tags' | 'element'>): ClassFit | null {
  if (classMatchesSkill(cls, skill)) return 'match';
  if (skill.tags.some((t) => theme.tags.has(t))) return 'related';
  if (skill.element !== undefined && theme.elements.has(skill.element)) return 'related';
  return null;
}

/** Whether a skill is usable with a class's weapon ('any' classes and v2 classes take every weapon). */
export function classWeaponOk(cls: Pick<ClassDef, 'weapon'>, skill: Pick<SkillDef, 'weapons'>): boolean {
  return cls.weapon === undefined || cls.weapon === 'any' || weaponOk(skill, cls.weapon);
}

/** Kit fit of a skill: a kit skill (or a variant of one) is 'match'; anything else its slots may hold is 'related'. */
function kitFit(reg: Registry, cls: ClassDef & { kit: readonly string[] }, skill: SkillDef): ClassFit | null {
  if (cls.kit.includes(reg.baseOf(skill.id) ?? skill.id)) return 'match';
  if (!classSlotEligible(cls, skill) || !classWeaponOk(cls, skill)) return null;
  return 'related';
}

/**
 * How a skill fits a class's slots (pure).
 * - v4 (kit) classes: 'match' for a kit skill (or a variant of one); 'related' for any other skill usable with the
 *   class weapon that is not another class's own skill (the fills of slots whose kit skill is not known yet); null
 *   otherwise. A 'match' never gives its slot to a 'related' skill, whatever their tiers.
 * - v2 classes: 'match' when it fits one of the class's patterns (classMatchesSkill); 'related' when it shares a tag
 *   with the patterns or the keepsake, or carries an element the patterns, requirements or bonus name; else null.
 */
export function classSkillFit(reg: Registry, cls: ClassDef, skill: SkillDef): ClassFit | null {
  if (isKitClass(cls)) return kitFit(reg, cls, skill);
  return classSlotEligible(cls, skill) ? fitOf(cls, classTheme(reg, cls), skill) : null;
}

/** How close a fill is to a kit class, higher first: bound to its weapon and of its element, bound, of its element, free. */
function fillAffinity(cls: ClassDef, skill: SkillDef): number {
  const bound = cls.weapon !== undefined && cls.weapon !== 'any' && (skill.weapons?.includes(cls.weapon as WeaponType) ?? false);
  const element = skill.element !== undefined && skill.element === cls.source;
  return (bound ? 2 : 0) + (element ? 1 : 0);
}

type Known = { p: SkillProgress; s: SkillDef; fit: ClassFit };

/** v4: the kit in kit order; a kit skill not known yet leaves its slot to the best related fill. */
function kitSlots(reg: Registry, state: Readonly<SkillBookState>, cls: ClassDef & { kit: readonly string[] }, n: number): string[] {
  const known: Known[] = [];
  for (const p of Object.values(state.skills)) {
    const s = reg.skill(p.id);
    const fit = s && barEligible(s) ? kitFit(reg, cls, s) : null;
    if (s && fit) known.push({ p, s, fit });
  }
  const baseOf = (id: string) => reg.baseOf(id) ?? id;
  const best = (x: Known) => x.s.tier * 1e6 + x.p.rank * 1e4 + Math.min(4999, x.p.learnedAt / 1e9);
  const byId = (a: Known, b: Known) => (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0);
  // A kit slot holds the kit skill itself, else the best known variant of it.
  const holder = (kitId: string): string | undefined => {
    if (Object.hasOwn(state.skills, kitId)) return kitId;
    return known.filter((x) => x.fit === 'match' && baseOf(x.s.id) === kitId).sort((a, b) => best(b) - best(a) || byId(a, b))[0]?.s.id;
  };
  const held = cls.kit.map(holder);
  const taken = new Set(held.filter((id): id is string => id !== undefined));
  const fills = known
    .filter((x) => x.fit === 'related')
    .sort((a, b) => fillAffinity(cls, b.s) - fillAffinity(cls, a.s) || best(b) - best(a) || byId(a, b));
  // One fill per authored base first (a variant and its base do not both take slots while another skill could).
  const bases = new Set<string>();
  const ordered: string[] = [];
  for (const distinct of [true, false]) {
    for (const x of fills) {
      if (ordered.includes(x.s.id) || (distinct && bases.has(baseOf(x.s.id)))) continue;
      ordered.push(x.s.id);
      bases.add(baseOf(x.s.id));
    }
  }
  const out: string[] = [];
  for (const id of held) {
    const pick = id ?? ordered.shift();
    if (pick !== undefined && out.length < n) out.push(pick);
  }
  // Spare kit variants (a kit skill and its variant both known), then the remaining fills.
  for (const x of known) if (x.fit === 'match' && !taken.has(x.s.id) && !ordered.includes(x.s.id)) ordered.push(x.s.id);
  for (const id of ordered) {
    if (out.length >= n) break;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * The skills a class equips into its class slots, picked from KNOWN bar-eligible skills (pure and deterministic).
 *
 * v4 (kit) classes — SPEC-v4 §3.4: slots 1 – 5 hold the kit, in kit order. A kit skill that is not known yet leaves
 * its slot to the best related skill: one usable with the class weapon that is not another class's own skill —
 * bound to the weapon and of the class's element first, then higher tier, higher rank, most recently learned, id —
 * so a new class never shows empty slots while anything usable is known. Asking for more than CLASS_SLOTS appends
 * the remaining fills (spares for picks that sit elsewhere). Tier never decides between a kit skill and a fill.
 *
 * v2 classes (no kit), most relevant first:
 *   1. enough pattern matches to satisfy each clause's count (in clause order);
 *   2. elemental classes (distinctElements): one matching skill per distinct element;
 *   3. the best remaining pattern matches, then the best RELATED skills (classSkillFit) — one skill per authored
 *      base first, then the rest;
 *   4. nothing related known: fewer ids than `n` (those class slots stay empty).
 * "Best" = higher tier, then higher rank, then the class's own signature skills, then most recently learned, then id.
 */
export function classSkills(reg: Registry, state: Readonly<SkillBookState>, cls: ClassDef, n = CLASS_SLOTS): string[] {
  if (isKitClass(cls)) return kitSlots(reg, state, cls, n);
  const grants = new Set(cls.grants ?? []);
  const theme = classTheme(reg, cls);
  const clauseList = cls.clauses ?? [];
  const known: Known[] = [];
  for (const p of Object.values(state.skills)) {
    const s = reg.skill(p.id);
    const fit = s && barEligible(s) && classSlotEligible(cls, s) ? fitOf(cls, theme, s) : null;
    if (s && fit) known.push({ p, s, fit });
  }
  const score = (x: Known) =>
    x.s.tier * 1e6 + x.p.rank * 1e4 + (grants.has(x.s.id) ? 5e3 : 0) + Math.min(4999, x.p.learnedAt / 1e9);
  known.sort((a, b) => score(b) - score(a) || (a.s.id < b.s.id ? -1 : a.s.id > b.s.id ? 1 : 0));
  const matches = known.filter((x) => x.fit === 'match');
  const related = known.filter((x) => x.fit === 'related');

  const picked: string[] = [];
  const bases = new Set<string>();
  const baseOf = (id: string) => reg.baseOf(id) ?? id;
  const take = (x: Known) => {
    picked.push(x.s.id);
    bases.add(baseOf(x.s.id));
  };
  const free = (x: Known, distinct: boolean) => !picked.includes(x.s.id) && (!distinct || !bases.has(baseOf(x.s.id)));

  // 1) satisfy each clause's own count.
  for (const clause of clauseList) {
    let have = picked.filter((id) => clause.tags.every((t) => reg.skill(id)!.tags.includes(t))).length;
    for (const distinct of [true, false]) {
      for (const x of matches) {
        if (picked.length >= n || have >= clause.count) break;
        if (!free(x, distinct) || !clause.tags.every((t) => x.s.tags.includes(t))) continue;
        take(x);
        have++;
      }
    }
  }
  // 2) elemental classes: one skill per distinct element first.
  if (cls.distinctElements) {
    const els = new Set(picked.map((id) => reg.skill(id)!.element).filter(Boolean));
    for (const x of matches) {
      if (picked.length >= n) break;
      if (!x.s.element || els.has(x.s.element) || !free(x, true)) continue;
      take(x);
      els.add(x.s.element);
    }
  }
  // 3) the best remaining matches, then related skills (distinct bases first).
  for (const distinct of [true, false]) {
    for (const group of [matches, related]) {
      for (const x of group) {
        if (picked.length >= n) break;
        if (free(x, distinct)) take(x);
      }
    }
  }
  return picked;
}
