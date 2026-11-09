// Requirement evaluation and display (morphs, recipes, classes, trainer lessons, portal gates).
// Evaluation is pure over a RequirementContext the SkillBook implements; nothing here reads state
// directly, so a server can evaluate the same requirements against its own copy of the player.
import type { Registry } from './registry';
import type { SkillProgress } from './state';
import type { ElementId, Requirement } from './types';

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
  }
}

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
 * 'Ore Mined ×6', or 'Ore Mined 3/6' when `ctx` is given), 'Base level 6', 'Pyroblade CR 10' /
 * 'Discover Pyroblade' / 'Wear Pyroblade', '3 elements attuned', '2 skills tagged blade + fire
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
      if (req.worn) return req.rank ? `Wear ${name} (CR ${req.rank})` : `Wear ${name}`;
      return req.rank ? `${name} CR ${req.rank}` : `Discover ${name}`;
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
