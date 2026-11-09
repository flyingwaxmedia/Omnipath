// Procedural skills (docs/SPEC-v2.md §3): variant ids, essence/element composition, the hit
// clamp and shape merges. Pure functions over SkillDefs; Registry.skill() is the only place that
// turns an id into a composed skill (and caches it), fusion.ts decides what a player may create.
import type { Registry } from './registry';
import type {
  ElementDef,
  ElementId,
  EssenceDef,
  EssenceMod,
  ShapeKind,
  SkillDef,
  SkillRiders,
  SkillShape,
} from './types';

/** Upper bound on potentialHits() for any composed skill. */
export const MAX_HITS = 12;
/** Floor for the cooldown of any composed skill (ms). */
export const MIN_COOLDOWN = 300;
/**
 * Essence budget band (SPEC §3): each essence step keeps damage per SP within ±35% of the skill
 * without that essence. compose() caps hit renormalization at the upper edge.
 */
export const ESSENCE_BUDGET_BAND = 0.35;
/** Composed and merged names never exceed this many words. */
export const MAX_NAME_WORDS = 4;
/** A skill carries at most this many essences (the 2nd slot opens with overmastery). */
export const MAX_ESSENCES = 2;
/** Prefix of shape-merge base ids: `fuse:<a>|<b>`. */
export const MERGE_PREFIX = 'fuse:';
/** Tag of monster-only techniques: never learnable, so never composed or merged. */
export const MONSTER_TAG = 'monster';

/**
 * Shape-merge priority (higher wins): dash > nova > projectile > chain > spin > strike > buff.
 * The higher-priority parent sets the merged shape; the other adds a rider.
 */
export const SHAPE_PRIORITY: Readonly<Record<ShapeKind, number>> = {
  dash: 6,
  nova: 5,
  projectile: 4,
  chain: 3,
  spin: 2,
  strike: 1,
  buff: 0,
};

/** Two skills can shape-merge only if they share at least one of these tags. */
export const MERGE_TAGS: readonly string[] = [
  'blade',
  'pierce',
  'arcane',
  'spin',
  'projectile',
  'dash',
  'aoe',
  'stealth',
  'heavy',
];

/** Element infusion: power ×1.2, spCost = ceil(sp × 1.25 + 2). */
const ELEMENT_POWER = 1.2;
const ELEMENT_SP_MUL = 1.25;
const ELEMENT_SP_ADD = 2;
/**
 * Cooldown a composed skill starts from when its base fires on the weapon's attack delay
 * (cooldown 0): a variant is always a hotbar skill, never the auto-attack (v1 infusion rule).
 */
const VARIANT_BASE_COOLDOWN = 800;
/** SP an essence variant starts from when its base is SP-free (the infusion rule's +2 floor). */
const VARIANT_MIN_SP = 2;
/** Shape merge: per-cast damage = 1.1 × the stronger parent; sp = max + 0.6 × min; maxRank 5. */
const MERGE_POWER = 1.1;
const MERGE_SP_SHARE = 0.6;
const MERGE_MAX_RANK = 5;
/** Rider a merged nova (as the lower parent) adds: each hit arcs to 2 more foes at 50%. */
const NOVA_ARC: Readonly<{ targets: number; mult: number }> = { targets: 2, mult: 0.5 };
/** Rider used when the lower parent's "+1" has no axis on the merged shape (nova, dash). */
const FALLBACK_ARC: Readonly<{ targets: number; mult: number }> = { targets: 1, mult: 0.5 };

/** Noun appended to a merged skill's name, keyed by the LOWER parent's shape. */
const RIDER_NOUN: Readonly<Record<ShapeKind, string>> = {
  spin: 'Cyclone',
  strike: 'Rend',
  chain: 'Arc',
  nova: 'Burst',
  projectile: 'Volley',
  dash: 'Rush',
  buff: 'Aura',
};

const RESERVED = /[@~|:]/;

/** True if `id` contains a character reserved for variant ids (`@ ~ | :`). */
export function hasReservedChar(id: string): boolean {
  return RESERVED.test(id);
}

const isPlainId = (s: string): boolean => s.length > 0 && !RESERVED.test(s);

// ------------------------------------------------------------------ ids

/** Structure of a skill id: `<base>[@<element>][~<mod>[~<mod>]]`, base possibly `fuse:<a>|<b>`. */
export interface VariantParts {
  /** Authored skill id, or the merge base `fuse:<a>|<b>`. */
  base: string;
  element?: ElementId;
  /** Essence ids, sorted. */
  mods: string[];
  /** The two authored parents (sorted) when `base` is a shape merge. */
  merge?: [string, string];
}

/**
 * Parses any skill id: a plain authored id, a v1 infusion (`slash@fire`), an essence variant or a
 * shape merge. Returns null unless the id is in canonical form (≤ 2 mods, mods strictly sorted,
 * merge parents strictly sorted, no empty or reserved segments). This is a syntactic parse only:
 * whether the referenced skill, element and essences exist is the Registry's concern.
 */
export function parseVariantId(id: string): VariantParts | null {
  const [head, ...mods] = id.split('~');
  if (mods.length > MAX_ESSENCES) return null;
  for (let i = 0; i < mods.length; i++) {
    if (!isPlainId(mods[i]) || (i > 0 && mods[i - 1] >= mods[i])) return null;
  }
  const at = head.split('@');
  if (at.length > 2) return null;
  const [base, element] = at;
  if (element !== undefined && !isPlainId(element)) return null;
  const parts: VariantParts = { base, mods };
  if (base.startsWith(MERGE_PREFIX)) {
    const pair = base.slice(MERGE_PREFIX.length).split('|');
    if (pair.length !== 2 || !isPlainId(pair[0]) || !isPlainId(pair[1]) || pair[0] >= pair[1]) return null;
    parts.merge = [pair[0], pair[1]];
  } else if (!isPlainId(base)) {
    return null;
  }
  if (element !== undefined) parts.element = element as ElementId;
  return parts;
}

/** Canonical id of a variant of `base` (an authored id or a merge id); mods are sorted. */
export function variantId(base: string, element?: ElementId, mods: readonly string[] = []): string {
  const tail = [...mods]
    .sort()
    .map((m) => `~${m}`)
    .join('');
  return `${base}${element ? `@${element}` : ''}${tail}`;
}

/** Canonical id of the shape merge of two authored skills (order-independent). */
export function mergeId(a: string, b: string): string {
  return a < b ? `${MERGE_PREFIX}${a}|${b}` : `${MERGE_PREFIX}${b}|${a}`;
}

// ------------------------------------------------------------------ hits

/** Hits one cast deals before riders: count × pulses × hits × (1 + jumps). 0 for buffs. */
export function shapeHits(shape: SkillShape): number {
  switch (shape.kind) {
    case 'strike':
      return shape.hits ?? 1;
    case 'spin':
      return shape.pulses ?? 1;
    case 'projectile':
      return shape.count ?? 1;
    case 'chain':
      return 1 + shape.jumps;
    case 'nova':
    case 'dash':
      return 1;
    case 'buff':
      return 0;
  }
}

function hitsWith(shape: SkillShape, riders: SkillRiders | undefined): number {
  const r = riders ?? {};
  return shapeHits(shape) * (r.reprise ? 2 : 1) * (r.returns ? 2 : 1) * (r.arc ? 1 + r.arc.targets : 1);
}

/**
 * Most hits one cast can deal: count × pulses × hits × (1 + jumps) × (reprise ? 2 : 1) ×
 * (returns ? 2 : 1) × (arc ? 1 + arc.targets : 1). Buffs deal 0.
 */
export function potentialHits(skill: Pick<SkillDef, 'shape' | 'riders'>): number {
  return hitsWith(skill.shape, skill.riders);
}

/**
 * Trims a shape + riders until potentialHits ≤ MAX_HITS, in the spec order
 * jumps → pulses → count → arc.targets, then strike hits as a last resort (the spec order alone
 * cannot always reach the cap, e.g. a 7-hit strike with reprise).
 */
function clampHits(shape: SkillShape, riders: SkillRiders | undefined): { shape: SkillShape; riders?: SkillRiders } {
  const s: SkillShape = { ...shape };
  const r: SkillRiders | undefined = riders && { ...riders, ...(riders.arc ? { arc: { ...riders.arc } } : {}) };
  const over = (): boolean => hitsWith(s, r) > MAX_HITS;
  if (s.kind === 'chain') while (over() && s.jumps > 0) s.jumps--;
  if (s.kind === 'spin') while (over() && (s.pulses ?? 1) > 1) s.pulses = (s.pulses ?? 1) - 1;
  if (s.kind === 'projectile') while (over() && (s.count ?? 1) > 1) s.count = (s.count ?? 1) - 1;
  if (r?.arc) {
    const arc = r.arc;
    while (over() && arc.targets > 0) arc.targets--;
    if (arc.targets === 0) delete r.arc;
  }
  if (s.kind === 'strike') while (over() && (s.hits ?? 1) > 1) s.hits = (s.hits ?? 1) - 1;
  return r && Object.keys(r).length > 0 ? { shape: s, riders: r } : { shape: s };
}

/**
 * Power multiplier `ess` applies to a skill whose shape is `shape` (the shape BEFORE this essence's
 * own mod). A multiply essence that adds projectiles (`mod.count`, e.g. split) budgets the whole
 * volley: its `powerMul` multiplies the volley's total damage, spread over the new count, so each
 * projectile deals `powerMul × c / (c + count)` (c = the projectile count before the essence; split:
 * 1.1 × c / (c + 2)). Every other essence multiplies power by `powerMul`.
 */
export function essencePowerMul(ess: Pick<EssenceDef, 'category' | 'powerMul' | 'mod'>, shape: SkillShape): number {
  const added = ess.mod.count ?? 0;
  if (ess.category === 'multiply' && added > 0 && shape.kind === 'projectile') {
    const c = shape.count ?? 1;
    return (ess.powerMul * c) / (c + added);
  }
  return ess.powerMul;
}

// ------------------------------------------------------------------ riders & shape mods

/**
 * Combines two rider sets: flags OR, leech adds, arc targets add (weaker mult wins), and the
 * stronger reprise is kept.
 */
function combineRiders(a: SkillRiders | undefined, b: SkillRiders | undefined): SkillRiders | undefined {
  if (!a) return b && { ...b };
  if (!b) return { ...a };
  const out: SkillRiders = { ...a };
  if (b.returns) out.returns = true;
  if (b.knockback) out.knockback = true;
  if (b.leech) out.leech = round4((a.leech ?? 0) + b.leech);
  if (b.arc) {
    out.arc = a.arc
      ? { targets: a.arc.targets + b.arc.targets, mult: Math.min(a.arc.mult, b.arc.mult) }
      : { ...b.arc };
  }
  if (b.reprise && (!a.reprise || b.reprise.mult > a.reprise.mult)) out.reprise = { ...b.reprise };
  return out;
}

/** Riders an essence mod adds on a given shape (`returns` only flies on projectiles; on a chain the
 * `arc` rider is replaced by the mod's extra `jumps`). */
function essenceRiders(kind: ShapeKind, mod: EssenceMod): SkillRiders | undefined {
  const r: SkillRiders = {};
  if (mod.returns && kind === 'projectile') r.returns = true;
  if (mod.reprise) r.reprise = { ...mod.reprise };
  if (mod.arc && !(kind === 'chain' && mod.jumps)) r.arc = { ...mod.arc };
  if (mod.leech) r.leech = mod.leech;
  if (mod.knockback) r.knockback = true;
  return Object.keys(r).length > 0 ? r : undefined;
}

const scaleLen = (v: number, mul: number | undefined): number => (mul === undefined ? v : Math.round(v * mul));

/** Applies an essence mod to a shape: counts add, multipliers multiply, arcAdd widens strikes. */
function applyShapeMod(shape: SkillShape, mod: EssenceMod): SkillShape {
  switch (shape.kind) {
    case 'strike': {
      const s = { ...shape, range: scaleLen(shape.range, mod.rangeMul), arc: Math.min(360, shape.arc + (mod.arcAdd ?? 0)) };
      if (mod.hits) s.hits = (shape.hits ?? 1) + mod.hits;
      return s;
    }
    case 'spin': {
      const s = { ...shape, radius: scaleLen(shape.radius, mod.radiusMul) };
      if (mod.pulses) s.pulses = (shape.pulses ?? 1) + mod.pulses;
      return s;
    }
    case 'projectile': {
      const s = { ...shape, range: scaleLen(shape.range, mod.rangeMul) };
      if (mod.count) s.count = (shape.count ?? 1) + mod.count;
      if (mod.spread) s.spread = (shape.spread ?? 0) + mod.spread;
      if (mod.pierce) s.pierce = (shape.pierce ?? 0) + mod.pierce;
      return s;
    }
    case 'dash':
      return { ...shape, distance: scaleLen(shape.distance, mod.rangeMul) };
    case 'nova':
      return { ...shape, radius: scaleLen(shape.radius, mod.radiusMul), range: scaleLen(shape.range, mod.rangeMul) };
    case 'chain':
      return { ...shape, range: scaleLen(shape.range, mod.rangeMul), jumps: shape.jumps + (mod.jumps ?? 0) };
    case 'buff':
      return shape;
  }
}

// ------------------------------------------------------------------ legality

/**
 * Whether a skill has an element slot of its own: an unaligned, non-buff attack with power > 0
 * (monster-only techniques never do). Call it on an authored skill or a raw shape merge.
 */
export function canTakeElement(root: SkillDef): boolean {
  return !root.element && root.shape.kind !== 'buff' && root.power > 0 && !root.tags.includes(MONSTER_TAG);
}

/**
 * Whether `mods` may sit together on `root` (an authored skill or raw merge): not a buff or a
 * monster technique, at most MAX_ESSENCES, each essence applies to the root's shape kind, and no
 * two share a category. Slot count (overmastery) is a per-player check; see canApplyEssence.
 */
export function legalEssenceSet(root: SkillDef, mods: readonly EssenceDef[]): boolean {
  if (mods.length === 0) return true;
  if (root.shape.kind === 'buff' || root.tags.includes(MONSTER_TAG) || mods.length > MAX_ESSENCES) return false;
  const categories = new Set(mods.map((m) => m.category));
  return categories.size === mods.length && mods.every((m) => m.appliesTo.includes(root.shape.kind));
}

/** Result of checking one more essence on a skill. */
export type EssenceCheck =
  | { ok: true }
  | { ok: false; reason: 'shape' | 'slot' | 'category' | 'buff'; message: string };

/**
 * Can `ess` be added to `skill` (authored, variant or merge) with `slotCount` essence slots?
 * Checks, in order: buffs take no essences, `appliesTo` must include the shape kind, same-category
 * essences never stack, a free slot is needed. Pass the EssenceDefs already on the skill as
 * `applied` (resolve `skill.essences` through the registry) — without them only a repeat of the
 * same essence is caught as a category clash.
 */
export function canApplyEssence(
  skill: SkillDef,
  ess: EssenceDef,
  slotCount: number,
  applied: readonly EssenceDef[] = [],
): EssenceCheck {
  if (skill.shape.kind === 'buff') {
    return { ok: false, reason: 'buff', message: `${skill.name} has no edge for an essence to cling to.` };
  }
  if (!ess.appliesTo.includes(skill.shape.kind)) {
    return { ok: false, reason: 'shape', message: `${ess.name} only shapes ${listText(ess.appliesTo)} skills.` };
  }
  const current = skill.essences ?? [];
  const clash = current.includes(ess.id) ? ess : applied.find((e) => e.category === ess.category);
  if (clash) {
    return {
      ok: false,
      reason: 'category',
      message: `${skill.name} already carries ${clash.name}; ${ess.category} essences never stack.`,
    };
  }
  if (current.length >= Math.min(slotCount, MAX_ESSENCES)) {
    return {
      ok: false,
      reason: 'slot',
      message:
        slotCount < MAX_ESSENCES
          ? `${skill.name} has no free essence slot. Overmaster it to open a second.`
          : `${skill.name}'s essence slots are full.`,
    };
  }
  return { ok: true };
}

/** Element slot of a skill: 'free' (can take one), 'swap' (variant may change it), 'bound' (never). */
export type ElementSlot = 'free' | 'swap' | 'bound';

/**
 * Element slot rules: an authored unaligned attack (or unaligned merge) has a free slot; a
 * generated variant of one carrying an element may swap it (essences kept); authored aligned
 * skills, buffs and their variants are 'bound'.
 */
export function elementSlotState(reg: Pick<Registry, 'skill'>, skill: SkillDef): ElementSlot {
  const root = rootOf(reg, skill);
  if (!root || !canTakeElement(root)) return 'bound';
  return skill.element ? 'swap' : 'free';
}

/** The authored skill or raw merge a skill was composed from (itself if it is one). */
function rootOf(reg: Pick<Registry, 'skill'>, skill: SkillDef): SkillDef | undefined {
  if (!skill.generated) return skill;
  const parts = parseVariantId(skill.id);
  if (!parts) return undefined;
  return parts.base === skill.id ? skill : reg.skill(parts.base);
}

// ------------------------------------------------------------------ compose

/**
 * Builds the variant of `base` with an element and/or essences (SPEC §3). `base` must be an
 * authored skill or a raw shape merge (never an element/essence variant); legality is the caller's
 * job (Registry.skill checks canTakeElement / legalEssenceSet). With nothing applied, returns `base`.
 *
 * - id `variantId(base.id, el, mods)`; tier = min(3, tier + 1); maxRank = min(maxRank, 8);
 *   `generated`, `baseId` (the authored base; a merge's higher-tier parent) and sorted `essences`.
 * - name: `[element prefix] [1st essence prefix] <base> [1st essence suffix]` (1st = alphabetical);
 *   over MAX_NAME_WORDS the essence affix is dropped, then the element prefix, then leading words.
 * - tags: base tags − 'basic' + element + essence tags + 'infused' (with an element).
 * - element: power ×1.2, sp = ceil(sp × 1.25 + 2). Cooldown starts at `base.cooldown || 800`.
 * - essences (alphabetical order): power × essencePowerMul (split spreads 1.1 × the volley over the
 *   new count), sp ×spMul (an SP-free base starts at 2), cooldown ×cdMul; shape mods and riders
 *   applied; then the hit clamp (≤ MAX_HITS) and cooldown ≥ MIN_COOLDOWN.
 * - hit renormalization: when the clamp trims hits, power × (hits before / hits after) so the
 *   cast's total potential damage is kept — capped so that no essence step gains more than
 *   ESSENCE_BUDGET_BAND (+35%) damage per SP over the same skill with that essence removed (see
 *   budgetDamage), and never lowered below the unrenormalized power.
 */
export function compose(base: SkillDef, el: ElementDef | undefined, mods: readonly EssenceDef[]): SkillDef {
  if (!el && mods.length === 0) return base;
  if (base.generated && parseVariantId(base.id)?.base !== base.id) {
    throw new Error(`compose(): "${base.id}" is already a variant; compose from its root`);
  }
  const essences = [...mods].sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  let power = base.power;
  let sp = base.spCost;
  let cooldown = base.cooldown || VARIANT_BASE_COOLDOWN;
  if (el) {
    power *= ELEMENT_POWER;
    sp = Math.ceil(sp * ELEMENT_SP_MUL + ELEMENT_SP_ADD);
  }
  if (essences.length > 0 && sp === 0) sp = VARIANT_MIN_SP;
  let shape: SkillShape = base.shape;
  let riders: SkillRiders | undefined = base.riders;
  for (const e of essences) {
    power *= essencePowerMul(e, shape);
    sp *= e.spMul;
    cooldown *= e.cdMul ?? 1;
    shape = applyShapeMod(shape, e.mod);
    riders = combineRiders(riders, essenceRiders(shape.kind, e.mod));
  }
  const rawHits = hitsWith(shape, riders);
  const clamped = clampHits(shape, riders);
  const keptHits = hitsWith(clamped.shape, clamped.riders);
  const spCost = round2(sp);
  let finalPower = round2(power);
  if (keptHits > 0 && keptHits < rawHits) {
    const ceiling = renormCeiling(base, el, essences, clamped.shape, spCost);
    finalPower = Math.max(finalPower, Math.min(round2((power * rawHits) / keptHits), ceiling));
  }
  const extraTags: string[] = [];
  if (el) extraTags.push(el.id);
  for (const e of essences) if (e.tag) extraTags.push(e.tag);
  if (el) extraTags.push('infused');

  return {
    ...base,
    id: variantId(base.id, el?.id, essences.map((e) => e.id)),
    name: composeName(base.name, el?.prefix, essences[0]?.affix),
    desc: composeDesc(base.desc, el, essences),
    tier: Math.min(3, base.tier + 1),
    maxRank: Math.min(base.maxRank, 8),
    tags: uniq([...base.tags.filter((t) => t !== 'basic'), ...extraTags]),
    element: el?.id ?? base.element,
    power: finalPower,
    spCost,
    cooldown: Math.max(MIN_COOLDOWN, Math.round(cooldown)),
    shape: clamped.shape,
    riders: clamped.riders,
    generated: true,
    baseId: base.generated ? (base.baseId ?? base.id) : base.id,
    essences: essences.map((e) => e.id),
  };
}

/**
 * Damage of one cast as the essence budget measures it (SPEC §3 budget): `power`, or
 * `power × shapeHits` once a multiply essence (split, flurry) is on the skill — multiply hits land
 * on the same target, while propagate/repeat riders spread to other targets or later moments.
 * `multiply` says whether the skill being judged carries a multiply essence; compare a variant and
 * its reference with the same flag.
 */
export function budgetDamage(skill: Pick<SkillDef, 'power' | 'shape'>, multiply: boolean): number {
  return multiply ? skill.power * shapeHits(skill.shape) : skill.power;
}

/**
 * Highest power a hit-trimmed variant may be renormalized to: for every reference composition
 * with one essence removed (same base and element; SP-free references are skipped, as in the
 * budget test), its budgetDamage per SP × (1 + ESSENCE_BUDGET_BAND), rounded down to 0.01.
 */
function renormCeiling(
  base: SkillDef,
  el: ElementDef | undefined,
  essences: readonly EssenceDef[],
  shape: SkillShape,
  spCost: number,
): number {
  const multiply = essences.some((e) => e.category === 'multiply');
  const hits = multiply ? shapeHits(shape) : 1;
  let ceiling = Infinity;
  for (let i = 0; i < essences.length; i++) {
    const ref = compose(base, el, essences.filter((_, j) => j !== i));
    if (ref.spCost <= 0) continue;
    const rate = budgetDamage(ref, multiply) / ref.spCost;
    ceiling = Math.min(ceiling, ((1 + ESSENCE_BUDGET_BAND) * rate * spCost) / hits);
  }
  // A hair under the band so float noise in a ratio check can never read as > +35%.
  return Number.isFinite(ceiling) ? Math.floor(ceiling * (1 - 1e-9) * 100) / 100 : Infinity;
}

function composeName(baseName: string, elPrefix: string | undefined, affix: EssenceDef['affix'] | undefined): string {
  const baseWords = words(baseName);
  const pre = elPrefix ? words(elPrefix) : [];
  if (affix) {
    const a = words(affix.text);
    const full = affix.pos === 'prefix' ? [...pre, ...a, ...baseWords] : [...pre, ...baseWords, ...a];
    if (full.length <= MAX_NAME_WORDS) return full.join(' ');
  }
  const plain = [...pre, ...baseWords];
  if (plain.length <= MAX_NAME_WORDS) return plain.join(' ');
  return baseWords.slice(-MAX_NAME_WORDS).join(' ');
}

function composeDesc(baseDesc: string, el: ElementDef | undefined, essences: readonly EssenceDef[]): string {
  let desc = baseDesc;
  if (el) desc += ` Infused with ${el.name.toLowerCase()}.`;
  if (essences.length > 0) {
    desc += ` Shaped by ${listText(essences.map((e) => e.name))} essence${essences.length > 1 ? 's' : ''}.`;
  }
  return desc;
}

// ------------------------------------------------------------------ shape merges

/**
 * Why two skills cannot shape-merge, or null if they can: both authored (not generated) and
 * distinct, tier ≥ 1, not monster techniques, neither a buff (a buff adds no rider, so it could
 * only dilute the attack's SP budget), sharing ≥ 1 of MERGE_TAGS. Fusion rank requirements are
 * checked by resolveFusion, not here.
 */
export function mergeBlocker(a: SkillDef, b: SkillDef): string | null {
  if (a.id === b.id) return `${a.name} cannot be merged with itself.`;
  for (const s of [a, b]) {
    if (s.generated) return `${s.name} is already a composed technique and cannot be merged again.`;
    if (s.tags.includes(MONSTER_TAG)) return `${s.name} belongs to monsters alone.`;
    if (s.tier < 1) return `${s.name} is too simple a form to merge.`;
  }
  for (const s of [a, b]) {
    if (s.shape.kind === 'buff') return `${s.name} is a stance, not a strike; stances cannot be shape-merged.`;
  }
  if (!MERGE_TAGS.some((t) => a.tags.includes(t) && b.tags.includes(t))) {
    return `${a.name} and ${b.name} share no common thread to bind them.`;
  }
  return null;
}

/** Orders merge parents: higher SHAPE_PRIORITY first, then higher tier, then id. */
function mergeOrder(a: SkillDef, b: SkillDef): [SkillDef, SkillDef] {
  const d = SHAPE_PRIORITY[b.shape.kind] - SHAPE_PRIORITY[a.shape.kind] || b.tier - a.tier || (a.id < b.id ? -1 : 1);
  return d < 0 ? [a, b] : [b, a];
}

interface MergeRider {
  shape: SkillShape;
  riders?: SkillRiders;
  /** Finishes "Merged with X, it …". Empty when the lower parent adds nothing. */
  text: string;
}

/** The lower parent's "+1": hits on strikes, pulses on spins, count on projectiles, jumps on chains. */
function bumpAxis(shape: SkillShape): MergeRider {
  switch (shape.kind) {
    case 'strike':
      return { shape: { ...shape, hits: (shape.hits ?? 1) + 1 }, text: 'strikes one extra time' };
    case 'spin':
      return { shape: { ...shape, pulses: (shape.pulses ?? 1) + 1 }, text: 'spins one extra time' };
    case 'projectile':
      return { shape: { ...shape, count: (shape.count ?? 1) + 1 }, text: 'looses one extra projectile' };
    case 'chain':
      return { shape: { ...shape, jumps: shape.jumps + 1 }, text: 'leaps to one more foe' };
    case 'nova':
    case 'dash':
    case 'buff':
      return { shape, riders: { arc: { ...FALLBACK_ARC } }, text: 'arcs each hit to one more foe' };
  }
}

/** Rider the lower parent (by its shape kind) adds to the primary's shape. */
function mergeRider(primary: SkillShape, lower: ShapeKind): MergeRider {
  switch (lower) {
    case 'buff':
      return { shape: primary, text: '' };
    case 'dash':
      return { shape: primary, riders: { knockback: true }, text: 'knocks foes back with every hit' };
    case 'nova':
      return { shape: primary, riders: { arc: { ...NOVA_ARC } }, text: 'arcs each hit to two more foes' };
    case 'spin':
      if (primary.kind === 'projectile' && !primary.radial) {
        return { shape: { ...primary, radial: true }, text: 'flies out in every direction' };
      }
      if (primary.kind === 'dash' && !primary.spin) {
        return { shape: { ...primary, spin: true }, text: 'spins as it dashes' };
      }
      return bumpAxis(primary);
    case 'strike':
    case 'chain':
    case 'projectile':
      return bumpAxis(primary);
  }
}

const castDamage = (s: SkillDef): number => s.power * shapeHits(s.shape);

/**
 * Shape merge of two authored skills (SPEC §3 step 5), or null if they cannot merge (see
 * mergeBlocker; buff parents never merge). The higher-priority parent sets the shape and the lower
 * adds a rider (spin: +1 pulse / radial projectiles / spinning dash; strike: +1 hit; chain: +1
 * jump; nova: arc {2, 0.5}; projectile: +1 count; dash: knockback). A "+1" the primary's shape has
 * no axis for (nova, dash) becomes arc {1, 0.5}.
 *
 * Damage: per-cast damage (power × shapeHits) = 1.1 × the stronger parent's, spread over the merged
 * hits — equal to max(power) × 1.1 when both parents hit once, and never letting a heavy single hit
 * multiply across a multi-pulse shape. sp = max + 0.6 × min, cooldown = max (≥ 300), tier =
 * min(3, max + 1), maxRank 5, tags and weapons unioned (any-weapon if either parent is), element and
 * status from the primary (else the other parent). Name = primary name + rider noun (≤ 4 words: the
 * primary's last 3 words, then leading lowercase words dropped — 'Eye of the Storm' → 'Storm Cyclone').
 * `baseId` is the higher-tier parent (ties: the primary), `mergedFrom` the sorted parents.
 */
export function mergeSkills(a: SkillDef, b: SkillDef): SkillDef | null {
  if (mergeBlocker(a, b)) return null;
  const [x, y] = a.id < b.id ? [a, b] : [b, a];
  const [primary, secondary] = mergeOrder(a, b);
  const rider = mergeRider(primary.shape, secondary.shape.kind);
  const clamped = clampHits(rider.shape, combineRiders(primary.riders, rider.riders));
  const power = round2((MERGE_POWER * Math.max(castDamage(a), castDamage(b))) / shapeHits(clamped.shape));
  const heir = secondary.tier > primary.tier ? secondary : primary;
  // Keep the primary's last words, never starting on a lowercase joiner ('of the Storm' → 'Storm').
  let kept = words(primary.name).slice(-(MAX_NAME_WORDS - 1));
  while (kept.length > 1 && /^[a-z]/.test(kept[0])) kept = kept.slice(1);
  const noun = RIDER_NOUN[secondary.shape.kind];

  const merged: SkillDef = {
    id: mergeId(a.id, b.id),
    name: [...kept, noun].join(' '),
    desc: `${primary.desc} Merged with ${secondary.name}${rider.text ? `, it ${rider.text}` : ''}.`,
    icon: primary.icon,
    tier: Math.min(3, Math.max(a.tier, b.tier) + 1),
    tags: uniq([...x.tags, ...y.tags]),
    power,
    spCost: round2(Math.max(a.spCost, b.spCost) + MERGE_SP_SHARE * Math.min(a.spCost, b.spCost)),
    cooldown: Math.max(MIN_COOLDOWN, Math.max(a.cooldown, b.cooldown) || VARIANT_BASE_COOLDOWN),
    shape: clamped.shape,
    maxRank: MERGE_MAX_RANK,
    generated: true,
    baseId: heir.id,
    mergedFrom: [x.id, y.id],
  };
  if (x.weapons && y.weapons) merged.weapons = uniq([...x.weapons, ...y.weapons]);
  const element = primary.element ?? secondary.element;
  if (element) merged.element = element;
  const status = primary.status ?? secondary.status;
  if (status) merged.status = status;
  if (primary.critBonus !== undefined) merged.critBonus = primary.critBonus;
  if (primary.castMs !== undefined) merged.castMs = primary.castMs;
  if (primary.afterCastMs !== undefined) merged.afterCastMs = primary.afterCastMs;
  if (clamped.riders) merged.riders = clamped.riders;
  return merged;
}

// ------------------------------------------------------------------ helpers

function uniq<T>(xs: readonly T[]): T[] {
  return [...new Set(xs)];
}

function words(s: string): string[] {
  return s.split(/\s+/).filter((w) => w.length > 0);
}

/** "a", "a and b", "a, b and c". */
function listText(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
