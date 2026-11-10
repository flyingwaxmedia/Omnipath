// Requirement evaluation and display (morphs, recipes, classes, trainer lessons, portal gates).
// Evaluation is pure over a RequirementContext the SkillBook implements; nothing here reads state
// directly, so a server can evaluate the same requirements against its own copy of the player.
import type { Registry } from './registry';
import type { SkillProgress } from './state';
import { GRIP_TAG, WEAPON_TYPES, type ElementId, type Requirement, type SkillDef, type WeaponType } from './types';

// ------------------------------------------------------------------ weapon gating (SPEC-v4 §2.2)

/** Weapon tuning. All [T]. */
export const WEAPON = {
  /** Percent bonus power of `body` moves (WEAPON.bodyTag) while bare-handed. */
  bodyBonus: 20,
  /** Tag of body moves: free with any weapon, stronger with none. */
  bodyTag: 'body',
  /** Cooldown between weapon swaps (ms); the game also refuses a swap during a wind-up. */
  swapCooldownMs: 3000,
} as const;

/** Every grip tag: blade, pierce, rod, fist. */
export const GRIP_TAGS: readonly string[] = WEAPON_TYPES.map((w) => GRIP_TAG[w]);

/** How a weapon reads in "Needs …" (docs/UX-SIMPLE.md; 'staff' is shown as "Rod", 'fists' as "Bare Hands"). */
export const WEAPON_NEED_WORD: Readonly<Record<WeaponType, string>> = {
  sword: 'a sword',
  dagger: 'a dagger',
  staff: 'a rod',
  fists: 'bare hands',
};

/**
 * "If a move uses a weapon, you need that weapon": true when `skill.weapons` is undefined (a free skill) or lists
 * the held weapon. Nothing else is consulted.
 */
export function weaponOk(skill: Pick<SkillDef, 'weapons'>, weapon: WeaponType): boolean {
  return skill.weapons === undefined || skill.weapons.includes(weapon);
}

/** Whether a skill is weapon-bound (it lists weapons). */
export function isWeaponBound(skill: Pick<SkillDef, 'weapons'>): boolean {
  return skill.weapons !== undefined;
}

/** The weapons whose grip tag a skill carries, in WEAPON_TYPES order. */
export function gripWeapons(skill: Pick<SkillDef, 'tags'>): WeaponType[] {
  return WEAPON_TYPES.filter((w) => skill.tags.includes(GRIP_TAG[w]));
}

/**
 * The weapon to equip so a locked skill works (the first it lists), or null when the held weapon is fine.
 * The lock line's one action ("Equip") equips it.
 */
export function weaponNeeded(skill: Pick<SkillDef, 'weapons'>, weapon: WeaponType): WeaponType | null {
  return weaponOk(skill, weapon) ? null : (skill.weapons?.[0] ?? null);
}

/** The one line a locked skill shows: "Needs a sword" (null when usable). The UI adds the Equip action. */
export function weaponLockLine(skill: Pick<SkillDef, 'weapons'>, weapon: WeaponType): string | null {
  const need = weaponNeeded(skill, weapon);
  return need ? `Needs ${WEAPON_NEED_WORD[need]}` : null;
}

/** Percent bonus power a skill gets from the held weapon alone: WEAPON.bodyBonus for body moves bare-handed. */
export function bodyBonusPct(skill: Pick<SkillDef, 'tags'>, weapon: WeaponType | undefined): number {
  return weapon === 'fists' && skill.tags.includes(WEAPON.bodyTag) ? WEAPON.bodyBonus : 0;
}

/**
 * Grip-rule problems of one authored skill (Registry.validate({ grip: true }) reports them):
 * a grip tag without `weapons`; `weapons` without a grip tag (tier-0 basics excepted); a grip tag whose weapon is
 * missing from `weapons` (cross-weapon skills carry both tags and list both weapons).
 */
export function gripProblems(skill: Pick<SkillDef, 'id' | 'tags' | 'weapons' | 'tier'>): string[] {
  const grips = gripWeapons(skill);
  const out: string[] = [];
  if (grips.length > 0 && !skill.weapons) out.push(`skill ${skill.id}: grip tag ${GRIP_TAG[grips[0]]} without weapons`);
  if (skill.weapons && grips.length === 0 && !(skill.tier === 0 && skill.tags.includes('basic'))) {
    out.push(`skill ${skill.id}: weapons without a grip tag`);
  }
  if (skill.weapons) {
    for (const w of grips) {
      if (!skill.weapons.includes(w)) out.push(`skill ${skill.id}: grip tag ${GRIP_TAG[w]} but weapons does not list ${w}`);
    }
  }
  return out;
}

/** What a requirement may ask about the player. Implemented by the SkillBook. */
export interface RequirementContext {
  /** Player base level. */
  level: number;
  hasElement(id: ElementId): boolean;
  /** Number of attuned elements (primal elements only when `primalOnly`). */
  elementsKnown(primalOnly?: boolean): number;
  /** Rank of a known skill (0 if unknown). */
  rank(skillId: string): number;
  flag(id: string): number;
  /** Class Rank of a discovered class (0 if undiscovered). */
  classRank(id: string): number;
  /** The worn class id. */
  worn: string | null;
  /** Distinct authored skills carrying every tag at rank ≥ minRank (see countTagged). */
  tagCount(tags: string[], minRank?: number): number;
  /** Bag count of an item. */
  itemCount(id: string): number;
  /** Completed trainer lesson ids. */
  lessons: readonly string[];
  /** Witness marks earned toward an echo skill. */
  witness(skillId: string): number;
  /** Tiers reached of a deed (0 if none). Optional: contexts without deeds read 0. */
  deed?(id: string): number;
  /** Times a quest was completed (0 if never). Optional: contexts without quests read 0. */
  questDone?(id: string): number;
}

/** Flag prefix the game sets (to 1) when the player first enters a map: `visited:<mapId>`. */
export const VISITED_FLAG_PREFIX = 'visited:';

/** Whether the context satisfies one requirement. */
export function meetsRequirement(req: Requirement, ctx: RequirementContext): boolean {
  switch (req.type) {
    case 'element':
      return ctx.hasElement(req.id);
    case 'elementsKnown':
      return ctx.elementsKnown(req.primalOnly) >= req.count;
    case 'skill':
      return ctx.rank(req.id) >= (req.rank ?? 1);
    case 'flag':
      return ctx.flag(req.id) >= req.min;
    case 'level':
      return ctx.level >= req.min;
    case 'class':
      return ctx.classRank(req.id) >= (req.rank ?? 1) && (!req.worn || ctx.worn === req.id);
    case 'tagCount':
      return ctx.tagCount(req.tags, req.minRank) >= req.count;
    case 'item':
      return ctx.itemCount(req.id) >= req.count;
    case 'lesson':
      return ctx.lessons.includes(req.id);
    case 'mapVisited':
      return ctx.flag(VISITED_FLAG_PREFIX + req.id) >= 1;
    case 'witness':
      return ctx.witness(req.skill) >= req.count;
    case 'deed':
      return (ctx.deed?.(req.id) ?? 0) >= (req.tier ?? 1);
    case 'quest':
      return (ctx.questDone?.(req.id) ?? 0) >= 1;
  }
}

/** Class Level that reads as "Master <class>" (CLASS.maxLevel; kept here so this module stays free of classes.ts). */
const MASTER_LEVEL = 10;

/** "ore_mined" → "Ore Mined", "quarry_depths.1" → "Quarry Depths 1". */
function prettify(id: string): string {
  return id
    .split(/[_.]/)
    .filter((w) => w.length > 0)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;

/**
 * Short human text for a requirement: 'Whirlwind rank 5', 'Attune Wind', a flag's label (else
 * 'Ore Mined ×6', or 'Ore Mined 3/6' when `ctx` is given), 'Base level 6', 'Pyroblade Class Level 6' /
 * 'Master Pyroblade' (Class Level 10) / 'Discover Pyroblade' / 'Wear Pyroblade', '3 elements attuned', '2 skills tagged blade + fire
 * (rank 5)' (no tags = any skill: 'Any skill rank 3'), '20 Ore', 'Lesson: Rising Kick',
 * 'Visit Moonlit Glade' (map id without its region prefix, prettified), 'Witness Boulder Roll 3 times'.
 */
export function describeRequirement(reg: Registry, req: Requirement, ctx?: RequirementContext): string {
  switch (req.type) {
    case 'element':
      return `Attune ${reg.element(req.id)?.name ?? prettify(req.id)}`;
    case 'elementsKnown':
      return `${plural(req.count, req.primalOnly ? 'primal element' : 'element', req.primalOnly ? 'primal elements' : 'elements')} attuned`;
    case 'skill':
      return `${reg.skill(req.id)?.name ?? prettify(req.id)} rank ${req.rank ?? 1}`;
    case 'flag':
      if (req.label) return req.label;
      return ctx ? `${prettify(req.id)} ${ctx.flag(req.id)}/${req.min}` : `${prettify(req.id)} ×${req.min}`;
    case 'level':
      return `Base level ${req.min}`;
    case 'class': {
      const name = reg.classDef(req.id)?.name ?? prettify(req.id);
      const level = req.rank !== undefined && req.rank >= MASTER_LEVEL ? `Master ${name}` : `${name} Class Level ${req.rank}`;
      if (req.worn) return req.rank ? `Wear ${name} (Class Level ${req.rank})` : `Wear ${name}`;
      return req.rank ? level : `Discover ${name}`;
    }
    case 'tagCount': {
      const min = req.minRank ?? 1;
      if (req.tags.length === 0) {
        const who = req.count === 1 ? 'Any skill' : `${req.count} skills`;
        return min > 1 ? `${who} rank ${min}` : who;
      }
      return `${plural(req.count, 'skill', 'skills')} tagged ${req.tags.join(' + ')}${min > 1 ? ` (rank ${min})` : ''}`;
    }
    case 'item':
      return `${req.count} ${reg.item(req.id)?.name ?? prettify(req.id)}`;
    case 'lesson':
      return `Lesson: ${reg.lesson(req.id)?.lesson.name ?? prettify(req.id)}`;
    case 'mapVisited': {
      const dot = req.id.indexOf('.');
      return `Visit ${prettify(dot >= 0 ? req.id.slice(dot + 1) : req.id)}`;
    }
    case 'witness': {
      const name = reg.skill(req.skill)?.name ?? prettify(req.skill);
      return `Witness ${name} ${req.count === 1 ? 'once' : `${req.count} times`}`;
    }
    case 'deed':
      return `Deed: ${prettify(req.id)}`;
    case 'quest':
      return `Finish ${reg.quest(req.id)?.name ?? prettify(req.id)}`;
  }
}

/**
 * Rank per authored skill for the known skills carrying every tag in `tags`, keyed by the authored
 * id they roll up to (Registry.baseOf: variants → baseId, merges → higher-tier parent). Each entry
 * is the max rank among that skill and its variants that carry the tags. Sum the values for
 * tag-passive totals; count them for tagCount requirements.
 */
export function taggedRanks(
  reg: Registry,
  skills: Readonly<Record<string, SkillProgress>>,
  tags: readonly string[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const [id, progress] of Object.entries(skills)) {
    const def = reg.skill(id);
    if (!def || !tags.every((t) => def.tags.includes(t))) continue;
    const base = reg.baseOf(id);
    if (base === undefined) continue;
    out.set(base, Math.max(out.get(base) ?? 0, progress.rank));
  }
  return out;
}

/**
 * Distinct AUTHORED skills having all `tags` at rank ≥ minRank. A generated variant counts toward
 * its baseId and a shape merge toward its higher-tier parent, each authored skill once, using the
 * max rank among it and its variants that carry the tags.
 */
export function countTagged(
  reg: Registry,
  skills: Readonly<Record<string, SkillProgress>>,
  tags: readonly string[],
  minRank = 1,
): number {
  let n = 0;
  for (const rank of taggedRanks(reg, skills, tags).values()) if (rank >= minRank) n++;
  return n;
}
