// Passives v2 (docs/SPEC-v2.md §4.5): which passives are active for a player and what they add up
// to. Tag passives, class-tree passives, imprints and bestiary bonuses are derived from state on
// demand (never saved); learned passives (trainer lessons, resonances) come from state.passives.
// aggregate() folds everything into PassiveTotals; the readers below apply the per-skill caps.
import { imprintSlots, imprintUnlocked, wornClass } from './classes';
import type { Registry } from './registry';
import { taggedRanks } from './requirements';
import type { SkillBookState, SkillProgress } from './state';
import type {
  ClassTier,
  ElementId,
  Family,
  PassiveDef,
  PassiveEffect,
  PassiveSource,
  PassiveStat,
  SkillDef,
  StatusKind,
} from './types';

/** The 12 tags that drive tag passives (PassiveDef ids `tag_<tag>`). */
export const TAG_PASSIVE_TAGS = [
  'blade',
  'pierce',
  'arcane',
  'spin',
  'projectile',
  'dash',
  'aoe',
  'stealth',
  'heavy',
  'spirit',
  'echo',
  'melee',
] as const;

/** A tag that drives a tag passive. */
export type PassiveTag = (typeof TAG_PASSIVE_TAGS)[number];

/** Tag passive curve: unlocks at a summed rank of 15, +1 rank per 8 more, up to rank 5. */
export const TAG_PASSIVE = { unlockAt: 15, step: 8, maxRank: 5 } as const;

/**
 * Per-skill limits (percent). Power: tag passives add at most `tagPower`; everything (tag, learned,
 * class tree, imprints and the worn class's tagPower bonus) at most `power`. SP cost and cooldown
 * reductions never go below `minSpCost` / `minCooldown` so no skill becomes free or instant.
 */
export const PASSIVE_CAPS = { tagPower: 25, power: 45, minSpCost: -50, minCooldown: -50 } as const;

/** Effect strength of a slotted imprint by the imprinted class's tier (Tier I ×1.0, II/III ×0.6). */
export const IMPRINT_STRENGTH: Readonly<Record<ClassTier, number>> = { 1: 1, 2: 0.6, 3: 0.6 };

/**
 * Bestiary bonuses (§4.5/§4.6): +`familyPct`% damage vs a family per species of it at ≥ `familyKills`
 * kills (cap `familyCap`), and +`hpPct`% max HP per species at ≥ `hpKills` kills (cap `hpCap`).
 * Elites and wardens count as their own species.
 */
export const BESTIARY_BONUS = {
  familyKills: 25,
  familyPct: 1,
  familyCap: 10,
  hpKills: 100,
  hpPct: 1,
  hpCap: 10,
} as const;

/** Where an active passive comes from. */
export type ActivePassiveSource = 'tag' | 'learned' | 'class' | 'imprint';

/** A passive in effect, with its effective rank and strength. */
export interface ActivePassive {
  def: PassiveDef;
  /** Effective rank, 1..def.maxRank. */
  rank: number;
  /** Multiplier on the effect: 1, or IMPRINT_STRENGTH for imprints. */
  strength: number;
  source: ActivePassiveSource;
}

/** Percent sums for an effect that applies to every skill and/or to skills carrying a tag. */
export interface TagScopedPct {
  /** Applies to every skill. */
  all: number;
  /** Applies to skills carrying the key tag. */
  byTag: Record<string, number>;
}

/** Percent bonus damage vs targets with `status` (from attacks of `element`; any attack when unset). */
export interface StatusPct {
  element?: ElementId;
  status: StatusKind;
  pct: number;
}

/** Every passive effect for a player, summed (percent values, already × rank × strength). */
export interface PassiveTotals {
  /** Power from tag passives (powerPctFor caps it at PASSIVE_CAPS.tagPower per skill). */
  tagPower: TagScopedPct;
  /** Power from learned, class-tree and imprint passives. */
  power: TagScopedPct;
  /** The worn class's `bonus.tagPower` (shares PASSIVE_CAPS.power with the passives). */
  classTagPower: Record<string, number>;
  /** SP cost change (negative = cheaper). */
  spCost: TagScopedPct;
  /** Cooldown change (negative = faster). */
  cooldown: TagScopedPct;
  /** Mastery XP bonus on hit and kill XP. */
  masteryXp: TagScopedPct;
  /** Stat bonuses from passives and bestiary stars (the worn class's stats: classes.classStatBonus). */
  stat: Partial<Record<PassiveStat, number>>;
  /** Damage vs monster families, bestiary bonus included. */
  vsFamily: Partial<Record<Family, number>>;
  /** Damage vs status-afflicted targets, one entry per (element, status). */
  vsStatus: StatusPct[];
  /** Regeneration bonus while standing still. */
  regenStill: number;
}

/** Passive sources that are derived from state and never saved in `state.passives`. */
const DERIVED_SOURCES: readonly PassiveSource[] = ['tag', 'class', 'imprint'];

// ------------------------------------------------------------------ tag passives

/** PassiveDef id of a tag's passive: `tag_<tag>`. */
export function tagPassiveId(tag: string): string {
  return `tag_${tag}`;
}

/**
 * Summed mastery per tag passive tag: the ranks of distinct authored skills carrying the tag, a
 * generated variant counting toward its base (max rank of the base and its variants that carry the
 * tag; see taggedRanks). Every tag is present (0 when nothing carries it).
 */
export function tagTotals(reg: Registry, skills: Readonly<Record<string, SkillProgress>>): Record<PassiveTag, number> {
  const out = {} as Record<PassiveTag, number>;
  for (const tag of TAG_PASSIVE_TAGS) {
    let total = 0;
    for (const rank of taggedRanks(reg, skills, [tag]).values()) total += rank;
    out[tag] = total;
  }
  return out;
}

/** Tag passive rank for a summed total: 0 below 15, else min(5, 1 + floor((total - 15) / 8)). */
export function tagPassiveRank(total: number): number {
  if (total < TAG_PASSIVE.unlockAt) return 0;
  return Math.min(TAG_PASSIVE.maxRank, 1 + Math.floor((total - TAG_PASSIVE.unlockAt) / TAG_PASSIVE.step));
}

/** Summed total a tag needs for tag passive `rank` (1..TAG_PASSIVE.maxRank): 15, 23, 31, 39, 47. */
export function tagPassiveTotalFor(rank: number): number {
  return TAG_PASSIVE.unlockAt + (rank - 1) * TAG_PASSIVE.step;
}

// ------------------------------------------------------------------ active passives

/**
 * Every passive in effect, in source order:
 * - tag: `tag_<tag>` defs present in the registry, ranked by tagPassiveRank(tagTotals);
 * - learned: `state.passives` (unknown ids and derived-source defs — tag/class/imprint — ignored);
 * - class: passive and capstone nodes bought in the worn class's tree (rank = ranks bought);
 * - imprint: the first imprintSlots() entries of `state.imprints` that are discovered, unlocked and
 *   not the worn class (strength IMPRINT_STRENGTH by tier).
 * Ranks are clamped to the def's (and node's) maxRank; rank-0 entries are omitted.
 */
export function activePassives(reg: Registry, state: Readonly<SkillBookState>): ActivePassive[] {
  const out: ActivePassive[] = [];

  const totals = tagTotals(reg, state.skills);
  for (const tag of TAG_PASSIVE_TAGS) {
    const def = reg.passive(tagPassiveId(tag));
    const rank = tagPassiveRank(totals[tag]);
    if (def && rank > 0) out.push({ def, rank: Math.min(rank, def.maxRank), strength: 1, source: 'tag' });
  }

  for (const [id, rank] of Object.entries(state.passives)) {
    const def = reg.passive(id);
    if (!def || DERIVED_SOURCES.includes(def.source) || rank <= 0) continue;
    out.push({ def, rank: Math.min(rank, def.maxRank), strength: 1, source: 'learned' });
  }

  const worn = wornClass(reg, state);
  if (worn) {
    const progress = state.classes[worn.id];
    for (const node of worn.tree ?? []) {
      if (node.kind === 'skill') continue;
      const bought = progress.spent[node.id] ?? 0;
      const def = reg.passive(node.ref);
      if (!def || bought <= 0) continue;
      out.push({ def, rank: Math.min(bought, node.maxRank, def.maxRank), strength: 1, source: 'class' });
    }
  }

  const seen = new Set<string>();
  for (const id of state.imprints.slice(0, imprintSlots(reg, state))) {
    if (seen.has(id) || id === state.worn) continue;
    seen.add(id);
    const cls = reg.classDef(id);
    const progress = state.classes[id];
    if (!cls?.imprint || !progress || !imprintUnlocked(cls, progress)) continue;
    const def = reg.passive(cls.imprint);
    if (def) out.push({ def, rank: 1, strength: IMPRINT_STRENGTH[cls.tier], source: 'imprint' });
  }

  return out;
}

// ------------------------------------------------------------------ bestiary

/**
 * Bestiary damage bonus per family: +1% per species of that family with ≥ 25 kills, capped at 10%.
 * Species unknown to the registry are ignored. Families with no qualifying species are absent.
 */
export function bestiaryFamilyPct(
  reg: Registry,
  state: Pick<SkillBookState, 'bestiary'>,
): Partial<Record<Family, number>> {
  const out: Partial<Record<Family, number>> = {};
  for (const [species, kills] of Object.entries(state.bestiary)) {
    const monster = reg.monster(species);
    if (!monster || kills < BESTIARY_BONUS.familyKills) continue;
    out[monster.family] = Math.min(BESTIARY_BONUS.familyCap, (out[monster.family] ?? 0) + BESTIARY_BONUS.familyPct);
  }
  return out;
}

/** Bestiary max-HP bonus: +1% per known species with ≥ 100 kills (3 stars), capped at 10%. */
export function bestiaryHpPct(reg: Registry, state: Pick<SkillBookState, 'bestiary'>): number {
  let n = 0;
  for (const [species, kills] of Object.entries(state.bestiary)) {
    if (kills >= BESTIARY_BONUS.hpKills && reg.monster(species)) n++;
  }
  return Math.min(BESTIARY_BONUS.hpCap, n * BESTIARY_BONUS.hpPct);
}

// ------------------------------------------------------------------ aggregate

const scoped = (): TagScopedPct => ({ all: 0, byTag: {} });

function addKeyed<K extends string>(into: Partial<Record<K, number>>, key: K, pct: number): void {
  into[key] = (into[key] ?? 0) + pct;
}

function addScoped(into: TagScopedPct, tag: string | undefined, pct: number): void {
  if (tag === undefined) into.all += pct;
  else addKeyed(into.byTag, tag, pct);
}

function addEffect(t: PassiveTotals, effect: PassiveEffect, pct: number, fromTag: boolean): void {
  switch (effect.kind) {
    case 'power':
      addScoped(fromTag ? t.tagPower : t.power, effect.tag, pct);
      return;
    case 'spCost':
      addScoped(t.spCost, effect.tag, pct);
      return;
    case 'cooldown':
      addScoped(t.cooldown, effect.tag, pct);
      return;
    case 'masteryXp':
      addScoped(t.masteryXp, effect.tag, pct);
      return;
    case 'vsFamily':
      addKeyed(t.vsFamily, effect.family, pct);
      return;
    case 'vsStatus': {
      const entry = t.vsStatus.find((s) => s.element === effect.element && s.status === effect.status);
      if (entry) entry.pct += pct;
      else if (effect.element) t.vsStatus.push({ element: effect.element, status: effect.status, pct });
      else t.vsStatus.push({ status: effect.status, pct });
      return;
    }
    case 'stat':
      addKeyed(t.stat, effect.stat, pct);
      return;
    case 'regenStill':
      t.regenStill += pct;
      return;
  }
}

/**
 * Folds every active passive (pct × rank × strength), the bestiary family and HP bonuses and the
 * worn class's tagPower bonus into PassiveTotals. Pure; the SkillBook caches the result. `active`
 * defaults to activePassives(reg, state); pass a list already built for the same state to skip
 * rebuilding it.
 */
export function aggregate(
  reg: Registry,
  state: Readonly<SkillBookState>,
  active: readonly ActivePassive[] = activePassives(reg, state),
): PassiveTotals {
  const t: PassiveTotals = {
    tagPower: scoped(),
    power: scoped(),
    classTagPower: {},
    spCost: scoped(),
    cooldown: scoped(),
    masteryXp: scoped(),
    stat: {},
    vsFamily: {},
    vsStatus: [],
    regenStill: 0,
  };
  for (const p of active) {
    addEffect(t, p.def.effect, p.def.effect.pct * p.rank * p.strength, p.source === 'tag');
  }
  const family = bestiaryFamilyPct(reg, state);
  for (const f of Object.keys(family) as Family[]) addKeyed(t.vsFamily, f, family[f] ?? 0);
  const hp = bestiaryHpPct(reg, state);
  if (hp > 0) addKeyed(t.stat, 'hp', hp);
  const tagPower = wornClass(reg, state)?.bonus.tagPower ?? {};
  for (const [tag, pct] of Object.entries(tagPower)) addKeyed(t.classTagPower, tag, pct);
  return t;
}

// ------------------------------------------------------------------ readers

/** Sum of `byTag` over a skill's distinct tags. */
function tagSum(byTag: Readonly<Record<string, number>>, tags: readonly string[]): number {
  let sum = 0;
  for (const tag of new Set(tags)) if (Object.hasOwn(byTag, tag)) sum += byTag[tag];
  return sum;
}

const scopedFor = (s: TagScopedPct, tags: readonly string[]): number => s.all + tagSum(s.byTag, tags);

/**
 * Percent bonus damage for a skill from passives and the worn class's tagPower bonus:
 * min(PASSIVE_CAPS.power, min(PASSIVE_CAPS.tagPower, tag passives) + other passives + class bonus).
 * This is the whole `tagPct` combat modifier — do not add classes.classTagPct on top.
 */
export function powerPctFor(totals: PassiveTotals, skill: Pick<SkillDef, 'tags'>): number {
  const fromTags = Math.min(PASSIVE_CAPS.tagPower, scopedFor(totals.tagPower, skill.tags));
  const rest = scopedFor(totals.power, skill.tags) + tagSum(totals.classTagPower, skill.tags);
  return Math.min(PASSIVE_CAPS.power, fromTags + rest);
}

/** Percent SP cost change for a skill (negative = cheaper), never below PASSIVE_CAPS.minSpCost. */
export function spCostPctFor(totals: PassiveTotals, skill: Pick<SkillDef, 'tags'>): number {
  return Math.max(PASSIVE_CAPS.minSpCost, scopedFor(totals.spCost, skill.tags));
}

/** Percent cooldown change for a skill (negative = faster), never below PASSIVE_CAPS.minCooldown. */
export function cooldownPctFor(totals: PassiveTotals, skill: Pick<SkillDef, 'tags'>): number {
  return Math.max(PASSIVE_CAPS.minCooldown, scopedFor(totals.cooldown, skill.tags));
}

/** Percent bonus to a stat from passives and bestiary stars (0 if none). */
export function statPct(totals: PassiveTotals, stat: PassiveStat): number {
  return totals.stat[stat] ?? 0;
}

/** Percent bonus damage against a monster family (passives + bestiary). */
export function vsFamilyPct(totals: PassiveTotals, family: Family): number {
  return totals.vsFamily[family] ?? 0;
}

/**
 * Percent bonus damage for an attack of `element` (undefined = unaligned) against a target with
 * `statuses`: every entry whose status the target has and whose element is unset or matches.
 */
export function vsStatusPct(
  totals: PassiveTotals,
  element: ElementId | undefined,
  statuses: readonly StatusKind[],
): number {
  let pct = 0;
  for (const s of totals.vsStatus) {
    if (statuses.includes(s.status) && (s.element === undefined || s.element === element)) pct += s.pct;
  }
  return pct;
}

/** Percent mastery XP bonus for a skill (pass to mastery.xpForHit as `masteryPct`). */
export function masteryXpPct(totals: PassiveTotals, skill: Pick<SkillDef, 'tags'>): number {
  return scopedFor(totals.masteryXp, skill.tags);
}

/** Percent regeneration bonus while standing still. */
export function regenStillPct(totals: PassiveTotals): number {
  return totals.regenStill;
}
