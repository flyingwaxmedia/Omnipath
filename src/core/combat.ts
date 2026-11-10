// Combat v2 (docs/SPEC-v2.md §2): element relations by defender element level, size modifiers,
// status combos and the damage stacking formula. Pure apart from the documented fallback roll counter.
import { WEAPON_SIZE } from './balance';
import { rankPower } from './mastery';
import { bodyBonusPct } from './requirements';
import { hashSeed, mulberry32 } from './rng';
import type { ElementDef, ElementId, Family, MonsterRank, Size, SkillDef, StatusKind, WeaponType } from './types';

// ------------------------------------------------------------------ skill classification

/** Arcane skills scale off MATK and ignore target size. */
export function isMagic(skill: SkillDef): boolean {
  return skill.tags.includes('arcane');
}

/**
 * Tags of any-weapon skills (trainer techniques, spirit arts, monster echoes) that scale off the
 * better of ATK/MATK, so a staff user is never crippled by a technique learned outside the tree. v4 adds `fist`
 * (Bare Hands skills), so elemental fist classes need no second stat line; `echo` leaves in Phase 2.
 */
export const HYBRID_TAGS: readonly string[] = ['spirit', 'technique', 'echo', 'fist'];

/**
 * Hybrid skills scale off whichever of ATK/MATK is higher: arcane + blade/pierce techniques, and
 * any skill tagged spirit, technique or echo (HYBRID_TAGS; variants and merges keep the tag).
 * Size handling is unchanged: only `arcane` ignores size.
 */
export function isHybrid(skill: SkillDef): boolean {
  if (HYBRID_TAGS.some((t) => skill.tags.includes(t))) return true;
  return isMagic(skill) && (skill.tags.includes('blade') || skill.tags.includes('pierce'));
}

// ------------------------------------------------------------------ elements

/** How an attacking element relates to a defending one. */
export type ElementRelation = 'strong' | 'weak' | 'same' | 'neutral';

/** Defender element level (monsters default to 1). */
export type ElementLevel = 1 | 2 | 3;

/** Element multiplier by relation and defender element level. Same-element Lv3 is a full resist (0). */
export const ELEMENT_TABLE: Readonly<Record<ElementRelation, Readonly<Record<ElementLevel, number>>>> = {
  strong: { 1: 1.5, 2: 1.75, 3: 2.0 },
  weak: { 1: 0.6, 2: 0.5, 3: 0.4 },
  same: { 1: 0.5, 2: 0.25, 3: 0.0 },
  neutral: { 1: 1, 2: 1, 3: 1 },
};

/**
 * Relation of `attack` vs `defend`: `strong` if the attacker's `strongVs` lists the defender (this wins
 * for mutual pairs such as holy/shadow, which are strong both ways); else `weak` if the defender lists
 * the attacker; `same` if equal; else `neutral`. Unaligned attacks or defenders are `neutral`.
 * Fused-element defenders use their own authored `strongVs`.
 */
export function elementRelation(
  elements: ReadonlyMap<ElementId, ElementDef>,
  attack: ElementId | undefined,
  defend: ElementId | undefined,
): ElementRelation {
  if (!attack || !defend) return 'neutral';
  if (elements.get(attack)?.strongVs.includes(defend)) return 'strong';
  if (elements.get(defend)?.strongVs.includes(attack)) return 'weak';
  if (attack === defend) return 'same';
  return 'neutral';
}

/** Element multiplier for `attack` vs `defend` at the defender's element `level` (default 1). Never negative. */
export function elementMultiplier(
  elements: ReadonlyMap<ElementId, ElementDef>,
  attack: ElementId | undefined,
  defend: ElementId | undefined,
  level: ElementLevel = 1,
): number {
  return ELEMENT_TABLE[elementRelation(elements, attack, defend)][level];
}

// ------------------------------------------------------------------ size

/** Size multipliers (S/M/L) per weapon, plus the `heavy` row that overrides the weapon. */
export const SIZE_TABLE: Readonly<Record<WeaponType | 'heavy', Readonly<Record<Size, number>>>> = {
  ...WEAPON_SIZE,
  heavy: { S: 0.7, M: 0.9, L: 1.15 },
};

/**
 * Size multiplier for `skill` used with `weapon` against a target of `size`. Precedence: skills tagged
 * `heavy` use the heavy row regardless of weapon (even when also `arcane`); otherwise `arcane` skills
 * ignore size (1.0); otherwise the weapon's row. No size, or no weapon on a plain skill, is 1.0.
 */
export function sizeMultiplier(skill: SkillDef, weapon?: WeaponType, size?: Size): number {
  if (!size) return 1;
  if (skill.tags.includes('heavy')) return SIZE_TABLE.heavy[size];
  if (isMagic(skill) || !weapon) return 1;
  return SIZE_TABLE[weapon][size];
}

// ------------------------------------------------------------------ statuses (SPEC-v4 §6.1)

/** Tuning of the four v4 statuses. All [T]. */
export const STATUS = {
  /** Exposed: the target takes this much more damage (percent)… */
  exposePct: 15,
  /** …for this long (ms). */
  exposeMs: 4000,
  /** Airborne: helpless for this long (ms), then the landing hit. */
  launchMs: 1200,
  /** Landing hit of a launch, as a share of the hit that launched. */
  launchLandingMult: 0.3,
  /** Default length of a root and of a lure when the skill names none (ms). */
  rootMs: 2000,
  lureMs: 3000,
  /** Wardens: root and launch become a slow of this strength (percent) instead. */
  wardenSlowPct: 40,
} as const;

/** What a status does to how a monster may move and act. */
export interface StatusControl {
  /** Cannot move. */
  rooted: boolean;
  /** Cannot act (attack or cast). */
  helpless: boolean;
  /** Walks toward the source of the status instead of its own target. */
  lured: boolean;
}

/** Movement and action control of one status: root holds, launch holds and silences, lure pulls. */
export function statusControl(status: StatusKind): StatusControl {
  return { rooted: status === 'root' || status === 'launch', helpless: status === 'launch' || status === 'stun', lured: status === 'lure' };
}

/**
 * The status a target of `rank` actually takes when `status` is applied: wardens turn root and launch into a
 * (STATUS.wardenSlowPct) slow and ignore lure (null). Everything else is taken as it is.
 */
export function statusFor(status: StatusKind, rank: MonsterRank | undefined): StatusKind | null {
  if (rank !== 'warden') return status;
  if (status === 'root' || status === 'launch') return 'slow';
  return status === 'lure' ? null : status;
}

/** Default duration (ms) of a v4 status; undefined for the v2 statuses (the game keeps its own table for those). */
export function statusMs(status: StatusKind): number | undefined {
  switch (status) {
    case 'root':
      return STATUS.rootMs;
    case 'launch':
      return STATUS.launchMs;
    case 'expose':
      return STATUS.exposeMs;
    case 'lure':
      return STATUS.lureMs;
    default:
      return undefined;
  }
}

/** Percent more damage a target takes for the statuses on it: STATUS.exposePct while exposed. */
export function exposedPct(statuses: readonly StatusKind[] | undefined): number {
  return statuses?.includes('expose') ? STATUS.exposePct : 0;
}

// ------------------------------------------------------------------ status combos

/** Status combo identifiers. */
export type ComboId = 'shatter' | 'conduct' | 'fan';

/** A status combo triggered by a hit. The game removes `consumes` from the target. */
export interface ComboResult {
  id: ComboId;
  /** Display name for the floating combo text. */
  name: string;
  /** Damage multiplier for this hit. */
  mult: number;
  /** Status the combo ends on the target. */
  consumes: StatusKind;
  /** Conduct: +1 chain jump when the casting shape is a chain (the game checks the shape). */
  extraJump?: boolean;
  /** Fan the Flames: spread burn to enemies within {@link BURN_SPREAD_RADIUS} px of the target. */
  spreadBurn?: boolean;
}

/** Radius (px) within which Fan the Flames spreads burn from the struck target. */
export const BURN_SPREAD_RADIUS = 48;

/** Combo rules in priority order: when several match (storm on a soaked, burning target), the first wins. */
const COMBO_RULES: readonly { readonly elements: readonly ElementId[]; readonly combo: Readonly<ComboResult> }[] = [
  { elements: ['earth', 'magma'], combo: { id: 'shatter', name: 'Shatter', mult: 1.75, consumes: 'freeze' } },
  {
    elements: ['lightning', 'storm'],
    combo: { id: 'conduct', name: 'Conduct', mult: 1.5, consumes: 'soak', extraJump: true },
  },
  {
    elements: ['wind', 'storm'],
    combo: { id: 'fan', name: 'Fan the Flames', mult: 1.25, consumes: 'burn', spreadBurn: true },
  },
];

/**
 * The combo a hit of `attackElement` triggers on a target carrying `statuses`, or null:
 * Shatter (earth/magma on `freeze`, ×1.75), Conduct (lightning/storm on `soak`, ×1.5, extra chain jump),
 * Fan the Flames (wind/storm on `burn`, ×1.25, spreads burn). Each consumes its status. Returns a fresh object.
 */
export function comboFor(attackElement: ElementId | undefined, statuses: readonly StatusKind[]): ComboResult | null {
  if (!attackElement) return null;
  for (const rule of COMBO_RULES) {
    if (rule.elements.includes(attackElement) && statuses.includes(rule.combo.consumes)) return { ...rule.combo };
  }
  return null;
}

// ------------------------------------------------------------------ damage

/** Attacker stats for one hit. `crit` is a percentage chance. */
export interface Attacker {
  atk: number;
  matk: number;
  crit: number;
  /** Equipped weapon (size row). Omit for attackers without one (size then only matters for `heavy` skills). */
  weapon?: WeaponType;
}

/** Defender stats for one hit. */
export interface Defender {
  def: number;
  element?: ElementId;
  /** Defender element level (default 1). */
  elementLevel?: ElementLevel;
  size?: Size;
  /** Monster family; callers derive `DamageMods.familyPct` from it (vsFamily passives). */
  family?: Family;
  /** Statuses currently on the target (combos). */
  statuses?: readonly StatusKind[];
}

/** Situational modifiers for one hit. Percentages are additive bonuses (10 = +10%). */
export interface DamageMods {
  /** Tag/class power bonus for this skill. */
  tagPct?: number;
  /** Bonus vs the defender's family. */
  familyPct?: number;
  /** Bonus vs the defender's current statuses. */
  statusPct?: number;
  /** Distance/target falloff multiplier (default 1). */
  falloff?: number;
  /** The hit always crits (CastBoost.crit). The crit roll is still drawn, so roll streams stay aligned. */
  forceCrit?: boolean;
  /** Roll source in [0, 1): first draw = crit, second = variance. See {@link computeDamage} for the fallback. */
  rng?: () => number;
}

/** Outcome of one hit. */
export interface DamageRoll {
  /** Damage dealt: at least 1, or exactly 0 when resisted. Never negative (nothing heals the target). */
  amount: number;
  crit: boolean;
  /** Element multiplier applied (UI colours strong/weak hits by it). */
  multiplier: number;
  /** True when the element multiplier is 0 (grey "Resist"). */
  resisted: boolean;
  /** Combo triggered by this hit; the game ends `combo.consumes` on the target. */
  combo: ComboResult | null;
}

const CRIT_MULT = 1.5;
/** Fraction of defense that still applies on a crit. */
const CRIT_DEF_FACTOR = 0.5;
const VARIANCE_MIN = 0.9;
const VARIANCE_SPAN = 0.2;

/** Salt for the fallback roll streams used when no `rng` is passed. */
const FALLBACK_SALT = 'omnipath.combat';
/** Number of fallback roll streams handed out by this module instance. */
let fallbackCounter = 0;

/** The n-th fallback stream: `mulberry32(hashSeed(FALLBACK_SALT, n))`. */
function fallbackRng(): () => number {
  return mulberry32(hashSeed(FALLBACK_SALT, fallbackCounter++));
}

/**
 * Damage of one hit:
 * `base * power * rankPower * (1+tagPct/100) * (1+familyPct/100) * (1+statusPct/100) * (1+bodyPct/100) *
 * (1+exposePct/100) * size * element * combo * falloff * variance(0.9..1.1) * (crit ? 1.5 : 1) -
 * def * (crit ? 0.5 : 1)`, rounded, min 1. `bodyPct` is WEAPON.bodyBonus for `body` moves bare-handed, `exposePct`
 * STATUS.exposePct while the defender is exposed; both are read here, so callers never add them.
 * `base` is ATK, MATK for arcane skills, or max(ATK, MATK) for hybrids (isHybrid). Crit chance is
 * `attacker.crit + skill.critBonus` percent, or certain with `mods.forceCrit` (a mechanic's finisher).
 *
 * When the element multiplier is 0 the hit is resisted: amount 0, no crit, no combo (statuses are kept)
 * and no rolls are drawn.
 *
 * Rolls come from `mods.rng`. Without it, the n-th call of this module instance that needs rolls uses
 * `mulberry32(hashSeed('omnipath.combat', n))`: every hit varies, and a fresh process replays the same
 * sequence. Authoritative code should always pass its own seeded `rng`.
 */
export function computeDamage(
  elements: ReadonlyMap<ElementId, ElementDef>,
  skill: SkillDef,
  rank: number,
  attacker: Attacker,
  defender: Defender,
  mods: DamageMods = {},
): DamageRoll {
  const element = elementMultiplier(elements, skill.element, defender.element, defender.elementLevel ?? 1);
  if (element === 0) return { amount: 0, crit: false, multiplier: 0, resisted: true, combo: null };

  const rng = mods.rng ?? fallbackRng();
  const critRoll = rng() * 100 < attacker.crit + (skill.critBonus ?? 0);
  const crit = critRoll || mods.forceCrit === true;
  const variance = VARIANCE_MIN + rng() * VARIANCE_SPAN;
  const combo = comboFor(skill.element, defender.statuses ?? []);
  const base = isHybrid(skill) ? Math.max(attacker.atk, attacker.matk) : isMagic(skill) ? attacker.matk : attacker.atk;

  const raw =
    base *
    skill.power *
    rankPower(rank) *
    (1 + (mods.tagPct ?? 0) / 100) *
    (1 + (mods.familyPct ?? 0) / 100) *
    (1 + (mods.statusPct ?? 0) / 100) *
    (1 + bodyBonusPct(skill, attacker.weapon) / 100) *
    (1 + exposedPct(defender.statuses) / 100) *
    sizeMultiplier(skill, attacker.weapon, defender.size) *
    element *
    (combo?.mult ?? 1) *
    (mods.falloff ?? 1) *
    variance *
    (crit ? CRIT_MULT : 1);
  const amount = Math.max(1, Math.round(raw - defender.def * (crit ? CRIT_DEF_FACTOR : 1)));
  return { amount, crit, multiplier: element, resisted: false, combo };
}
