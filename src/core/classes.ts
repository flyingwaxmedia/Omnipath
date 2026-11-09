// Classes v2 (docs/SPEC-v2.md §5): discovery (permissive Tier I, hardened Tier II/III), Class Rank
// XP fed by skill mastery, the class tree (points, node purchase, respec), imprint unlocks and
// slots, and the worn class's bonus. Pure functions over the Registry and SkillBookState; the
// SkillBook orchestrates (events, signature grants, wearing, whispers) and owns every mutation
// made through grantClassXp / buyNode / respec.
import type { Registry } from './registry';
import { countTagged, describeRequirement, meetsRequirement, type RequirementContext } from './requirements';
import type { ClassProgress, SkillBookState, SkillProgress } from './state';
import type { ClassClause, ClassDef, ClassTier, SkillDef, StatBonus } from './types';

/** Class tuning (SPEC §5). */
export const CLASS: {
  /** Highest Class Rank per tier. */
  readonly maxRank: Readonly<Record<ClassTier, number>>;
  /** Share of a skill's mastery XP the worn class gains when the skill matches one of its clauses. */
  readonly wornShare: number;
  /** Share every other discovered, matching class gains. */
  readonly bleedShare: number;
  /** Class Rank at which a class's imprint unlocks, per tier. */
  readonly imprintAt: Readonly<Record<ClassTier, number>>;
} = {
  maxRank: { 1: 10, 2: 8, 3: 5 },
  wornShare: 0.5,
  bleedShare: 0.15,
  imprintAt: { 1: 5, 2: 4, 3: 3 },
};

/** Hardened discovery (Tier II/III) counts only skills at this rank or above. */
export const HARDENED_RANK = 5;

/** Codex thresholds on discovery progress: whispered from 25%, near (clause bars shown) from 50%. */
export const CODEX = { whisperAt: 0.25, nearAt: 0.5 } as const;

/** Discovered classes that open the third imprint slot (any Tier III class also does). */
export const IMPRINT_THIRD_SLOT_CLASSES = 12;

/** Class Rank curve multiplier per tier. */
const TIER_XP_MULT: Readonly<Record<ClassTier, number>> = { 1: 1, 2: 1.8, 3: 3 };

/** StatBonus fields that are plain stats (everything except `tagPower`). */
const STAT_KEYS = ['atk', 'matk', 'hp', 'sp', 'speed', 'crit', 'cdr'] as const satisfies readonly Exclude<
  keyof StatBonus,
  'tagPower'
>[];

/** Codex state of a class: hidden riddle → riddle shown → clause bars → discovered. */
export type CodexState = 'unknown' | 'whispered' | 'near' | 'known';

/** Everything the class panel and codex show about one class. */
export interface ClassView {
  cls: ClassDef;
  discovered: boolean;
  /** Class Rank (0 while undiscovered). */
  rank: number;
  /** Discovery progress 0..1: the mean fill of every component below (1 once discovered). */
  progress: number;
  /** Matching skills per clause (hardened counting for Tier II/III). */
  clauses: { clause: ClassClause; have: number }[];
  /** Distinct skill elements, when the class asks for them. */
  elements?: { have: number; need: number };
  /** Parent classes and their current Class Rank (0 if undiscovered), when the class has parents. */
  parents?: { id: string; need: number; have: number }[];
  /** Extra requirements with display text, when the class has any. */
  requires?: { text: string; ok: boolean }[];
  codex: CodexState;
}

/** One Class Rank gained by a class (grantClassXp reports one entry per rank). */
export interface ClassRankUp {
  cls: ClassDef;
  /** The rank just reached. */
  rank: number;
}

/** Outcome of a tree purchase check; `reason` is player-facing text when `ok` is false. */
export interface NodeCheck {
  ok: boolean;
  reason?: string;
}

// ------------------------------------------------------------------ ranks

/** XP to go from Class Rank `rank` to `rank + 1`: round(60 × 1.22^(rank-1) × [1, 1.8, 3][tier-1]). */
export function classXpToNext(rank: number, tier: ClassTier): number {
  return Math.round(60 * Math.pow(1.22, rank - 1) * TIER_XP_MULT[tier]);
}

/** Highest Class Rank of a class (CLASS.maxRank by tier). */
export function classMaxRank(cls: Pick<ClassDef, 'tier'>): number {
  return CLASS.maxRank[cls.tier];
}

/** Tier II/III classes use hardened discovery counting. */
function isHardened(cls: Pick<ClassDef, 'tier'>): boolean {
  return cls.tier >= 2;
}

// ------------------------------------------------------------------ matching & counting

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
  if (cls.clauses.length === 0 && !cls.distinctElements) return true;
  if (cls.distinctElements && skill.element !== undefined) return true;
  return cls.clauses.some((c) => clauseMatches(c, skill));
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

function evaluate(reg: Registry, state: Readonly<SkillBookState>, cls: ClassDef, ctx: RequirementContext): Evaluation {
  const hardened = isHardened(cls);
  const fills: number[] = [];
  const clauses = cls.clauses.map((clause) => {
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
 * Whether an undiscovered class's requirements are all met right now: every parent Class Rank,
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
  for (const clause of cls.clauses) {
    if (clauseCount(reg, state, clause, hardened) < clause.count) return false;
    components++;
  }
  return components > 0;
}

// ------------------------------------------------------------------ Class Rank XP

/** Adds XP to one class, levelling it up to its max rank (XP is dropped at max). */
function addClassXp(cls: ClassDef, progress: ClassProgress, amount: number): ClassRankUp[] {
  const max = classMaxRank(cls);
  const ups: ClassRankUp[] = [];
  if (progress.rank >= max) {
    progress.xp = 0;
    return ups;
  }
  progress.xp += amount;
  while (progress.rank < max && progress.xp >= classXpToNext(progress.rank, cls.tier)) {
    progress.xp -= classXpToNext(progress.rank, cls.tier);
    progress.rank++;
    ups.push({ cls, rank: progress.rank });
  }
  if (progress.rank >= max) progress.xp = 0;
  return ups;
}

/**
 * Feeds `xp` mastery XP earned by `skill` into Class Ranks (mutates `state.classes`): the worn
 * class gains `CLASS.wornShare × xp` and every other discovered class `CLASS.bleedShare × xp`,
 * each only if classMatchesSkill. Returns one entry per rank gained (worn class first), never
 * beyond a class's max rank. Non-positive or non-finite XP is ignored.
 */
export function grantClassXp(reg: Registry, state: SkillBookState, skill: SkillDef, xp: number): ClassRankUp[] {
  if (!Number.isFinite(xp) || xp <= 0) return [];
  const ids = Object.keys(state.classes);
  const ordered = state.worn && ids.includes(state.worn) ? [state.worn, ...ids.filter((id) => id !== state.worn)] : ids;
  const ups: ClassRankUp[] = [];
  for (const id of ordered) {
    const cls = reg.classDef(id);
    if (!cls || !classMatchesSkill(cls, skill)) continue;
    const share = id === state.worn ? CLASS.wornShare : CLASS.bleedShare;
    ups.push(...addClassXp(cls, state.classes[id], xp * share));
  }
  return ups;
}

// ------------------------------------------------------------------ tree

/** Points spent in a class tree: Σ ranks bought × node cost (unknown node ids are ignored). */
export function spentPoints(cls: ClassDef, progress: ClassProgress): number {
  let spent = 0;
  for (const node of cls.tree ?? []) spent += (progress.spent[node.id] ?? 0) * node.cost;
  return spent;
}

/** Unspent tree points: Class Rank × tier − spentPoints. */
export function classPoints(cls: ClassDef, progress: ClassProgress): number {
  return progress.rank * cls.tier - spentPoints(cls, progress);
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Whether one more rank of a tree node can be bought. Checked in order: the node exists, it is not
 * at max rank, its prerequisite nodes have the required ranks, `minSpent` points are already in the
 * tree, and enough unspent points remain for its cost.
 */
export function canBuyNode(cls: ClassDef, progress: ClassProgress, nodeId: string): NodeCheck {
  const node = cls.tree?.find((n) => n.id === nodeId);
  if (!node) return { ok: false, reason: `${cls.name} has no such tree node.` };
  if ((progress.spent[node.id] ?? 0) >= node.maxRank) return { ok: false, reason: 'Already at max rank.' };
  for (const req of node.requires ?? []) {
    if ((progress.spent[req.node] ?? 0) < req.rank) {
      return { ok: false, reason: `Requires node ${req.node} at rank ${req.rank}.` };
    }
  }
  if (node.minSpent !== undefined && spentPoints(cls, progress) < node.minSpent) {
    return { ok: false, reason: `Spend ${plural(node.minSpent, 'point', 'points')} in the ${cls.name} tree first.` };
  }
  const points = classPoints(cls, progress);
  if (points < node.cost) {
    return { ok: false, reason: `Needs ${plural(node.cost, 'point', 'points')} (${points} available).` };
  }
  return { ok: true };
}

/**
 * Buys one rank of a tree node when canBuyNode allows it (mutates `progress.spent`) and returns
 * that check. Learning a skill node's skill is the SkillBook's job.
 */
export function buyNode(cls: ClassDef, progress: ClassProgress, nodeId: string): NodeCheck {
  const check = canBuyNode(cls, progress, nodeId);
  if (check.ok) progress.spent[nodeId] = (progress.spent[nodeId] ?? 0) + 1;
  return check;
}

/**
 * Refunds a class tree (mutates `progress`). Safe maps only — the game enforces where. With `cls`,
 * every passive and capstone node is refunded but `kind: 'skill'` nodes stay bought, since the skill
 * they taught is kept (refunding them would make the skill free). Without `cls`, every node rank
 * is refunded.
 */
export function respec(progress: ClassProgress, cls?: ClassDef): void {
  const kept: Record<string, number> = {};
  for (const node of cls?.tree ?? []) {
    if (node.kind !== 'skill' || !Object.hasOwn(progress.spent, node.id)) continue;
    const rank = progress.spent[node.id];
    if (rank > 0) kept[node.id] = rank;
  }
  progress.spent = kept;
}

// ------------------------------------------------------------------ imprints

/** Whether a class has an imprint and has reached its imprint Class Rank (CLASS.imprintAt by tier). */
export function imprintUnlocked(cls: ClassDef, progress: ClassProgress): boolean {
  return cls.imprint !== undefined && progress.rank >= CLASS.imprintAt[cls.tier];
}

/**
 * Imprint slots unlocked: 1 once any discovered class reaches its imprint Class Rank, 2 once any
 * Tier II class is discovered, 3 once any Tier III class or IMPRINT_THIRD_SLOT_CLASSES classes are
 * discovered (the highest satisfied rule wins). Classes missing from the registry are ignored.
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
    if (progress.rank >= CLASS.imprintAt[cls.tier]) atImprintRank = true;
    if (cls.tier === 2) tier2 = true;
    if (cls.tier === 3) tier3 = true;
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

/**
 * Percent bonus damage the worn class's `bonus.tagPower` gives a skill: the sum over the skill's
 * distinct tags. Display breakdown only — passives.powerPctFor already includes it (under the
 * shared per-skill cap), so never add the two together.
 */
export function classTagPct(reg: Registry, state: Readonly<SkillBookState>, skill: Pick<SkillDef, 'tags'>): number {
  const tagPower = wornClass(reg, state)?.bonus.tagPower;
  if (!tagPower) return 0;
  let pct = 0;
  for (const tag of new Set(skill.tags)) if (Object.hasOwn(tagPower, tag)) pct += tagPower[tag];
  return pct;
}

/**
 * The worn class's stat bonus (atk, matk, hp, sp, speed, crit, cdr; percentages as authored),
 * without `tagPower` — skill damage goes through passives.powerPctFor. Empty when nothing is worn.
 */
export function classStatBonus(reg: Registry, state: Readonly<SkillBookState>): StatBonus {
  const bonus = wornClass(reg, state)?.bonus;
  const out: StatBonus = {};
  if (!bonus) return out;
  for (const key of STAT_KEYS) {
    const v = bonus[key];
    if (v !== undefined) out[key] = v;
  }
  return out;
}
