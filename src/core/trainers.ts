// Trainer lessons (docs/SPEC-v2.md §4.4). Lessons grant a technique, a passive rank, essences or an
// element; costs are paid from the game inventory (SkillBook.inv). lessonState() is pure: it reports
// what the trainer panel shows and what takeLesson must check; the SkillBook applies the grant.
import type { Registry } from './registry';
import { describeRequirement, meetsRequirement, type RequirementContext } from './requirements';
import type { LessonDef } from './types';

/** What lesson rules may ask about the player. Implemented by the SkillBook. */
export interface TrainerContext extends RequirementContext {
  /** Knows this skill id. */
  has(id: string): boolean;
  /** Rank of a learned passive (state.passives; 0 if not learned). */
  passiveRank(id: string): number;
  /** Coins in the game inventory. */
  coins(): number;
}

/** A lesson's state for the player. The flags are independent: an owned lesson may also be available. */
export interface LessonState {
  /** Nothing left to gain: a non-repeatable lesson already taken, or its grant already fully owned. */
  owned: boolean;
  /** Every `requires` entry is met. */
  available: boolean;
  /** The inventory covers the cost's coins and items. */
  affordable: boolean;
  /** describeRequirement text (with progress) for each unmet requirement, in authored order. */
  missing: string[];
  /** Taught only as a quest reward (LessonDef.questOnly): takeLesson refuses it. */
  questOnly: boolean;
  /** Id of the quest whose reward this lesson is (docs/QUESTS.md: exactly one), if any. */
  quest?: string;
}

/**
 * Whether the grant itself is already fully owned: the skill is known, the element attuned, or the
 * passive at the rank this lesson can raise it to (its maxRank when repeatable, else rank 1).
 * Essence purchases never are.
 */
function grantOwned(reg: Registry, ctx: TrainerContext, lesson: LessonDef): boolean {
  const grant = lesson.grants;
  if ('skill' in grant) return ctx.has(grant.skill);
  if ('element' in grant) return ctx.hasElement(grant.element);
  if ('passive' in grant) {
    const cap = lesson.repeatable ? (reg.passive(grant.passive)?.maxRank ?? 1) : 1;
    return ctx.passiveRank(grant.passive) >= cap;
  }
  return false;
}

/** Whether the inventory covers a lesson's cost (no cost = free). */
function canAfford(ctx: TrainerContext, cost: LessonDef['cost']): boolean {
  if (!cost) return true;
  if (ctx.coins() < (cost.coins ?? 0)) return false;
  return Object.entries(cost.items ?? {}).every(([item, n]) => ctx.itemCount(item) >= n);
}

/**
 * State of lesson `lessonId` for the player: `owned` (non-repeatable and in `ctx.lessons`, or its
 * skill known, element attuned, or passive already at the rank the lesson raises it to — maxRank
 * when repeatable), `available` (all requires met), `affordable` (coins and items cover the cost),
 * `missing` (texts of unmet requirements), `questOnly` and the `quest` that teaches it (a trainer
 * panel shows 'Learned through <quest>' for questOnly lessons). A lesson can be taken when it is available,
 * affordable and not owned. An unknown id yields a state that can never be taken.
 */
export function lessonState(reg: Registry, ctx: TrainerContext, lessonId: string): LessonState {
  const lesson = reg.lesson(lessonId)?.lesson;
  if (!lesson) {
    return { owned: false, available: false, affordable: false, missing: [`Unknown lesson ${lessonId}`], questOnly: false };
  }
  const unmet = lesson.requires.filter((r) => !meetsRequirement(r, ctx));
  const out: LessonState = {
    owned: lessonOwned(reg, ctx, lesson.id),
    available: unmet.length === 0,
    affordable: canAfford(ctx, lesson.cost),
    missing: unmet.map((r) => describeRequirement(reg, r, ctx)),
    questOnly: lesson.questOnly === true,
  };
  const quest = reg.questsForLesson(lesson.id)[0];
  if (quest) out.quest = quest.id;
  return out;
}

/**
 * Whether lesson `lessonId` has nothing left to give the player — `lessonState(...).owned` without the
 * requirement and price checks (cheap; quests ask it for every repeatable lesson bounty). Unknown ids
 * are never owned.
 */
export function lessonOwned(reg: Registry, ctx: TrainerContext, lessonId: string): boolean {
  const lesson = reg.lesson(lessonId)?.lesson;
  if (!lesson) return false;
  return (!lesson.repeatable && ctx.lessons.includes(lesson.id)) || grantOwned(reg, ctx, lesson);
}

/** Every lesson taught at NPC `npcId` (all trainers living on that NPC), in data order. */
export function lessonsFor(reg: Registry, npcId: string): LessonDef[] {
  return reg.trainers.filter((t) => t.npc === npcId).flatMap((t) => t.lessons);
}
