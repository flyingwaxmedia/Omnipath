// The fusion altar pipeline (docs/SPEC-v2.md §3). resolveFusion() is pure: it reads the player
// through a FusionContext and returns what the pair WOULD make; the SkillBook applies the outcome
// (learning, consuming `consumes`, remembering the attempt) and picks whispers via hintCandidates().
import {
  SUPPORT_KINDS,
  canApplyEssence,
  elementSlotState,
  mergeBlocker,
  mergeId,
  parseVariantId,
  variantId,
} from './compose';
import { fusionMinRank } from './mastery';
import { pairKey, parseRef, skillRef, type ParsedRef } from './refs';
import type { Registry } from './registry';
import { describeRequirement } from './requirements';
import type { ElementDef, ElementId, EssenceDef, FusionRecipe, IngredientRef, Requirement, SkillDef } from './types';

/** Overmastery bars that open a skill's 2nd essence slot. */
export const SECOND_SLOT_OVERBARS = 3;

/** What the pipeline may ask about the player. Implemented by the SkillBook. */
export interface FusionContext {
  /** Knows this skill id (authored, variant or merge). */
  has(id: string): boolean;
  rank(id: string): number;
  hasElement(id: ElementId): boolean;
  /** Essences of this id in the inventory. */
  essenceCount(id: string): number;
  /** Overmastery bars filled on this skill id. */
  overBars(id: string): number;
  meets(req: Requirement): boolean;
}

export type FusionOutcome =
  | {
      ok: true;
      result: IngredientRef;
      /** Which pipeline step produced it: authored recipe (incl. fused elements and resonances),
       * essence applied, element applied/swapped, or shape merge. */
      kind: 'authored' | 'essence' | 'element' | 'merge';
      /** Essence id to remove from the inventory. Absent when nothing is consumed, including
       * when the player already knows the resulting variant. */
      consumes?: string;
    }
  | {
      ok: false;
      reason: 'missing' | 'rank' | 'same' | 'requirement' | 'slot' | 'category' | 'shape' | 'bound' | 'nothing';
      message: string;
      /** For 'requirement': the recipe requirements the player does not meet. */
      unmet?: Requirement[];
    };

type FusionFailure = Extract<FusionOutcome, { ok: false }>;

const fail = (reason: FusionFailure['reason'], message: string): FusionFailure => ({ ok: false, reason, message });
const nothing = (message: string): FusionFailure => fail('nothing', message);

/** Essence slots of a skill: 0 for support kinds (buff, blink, mend, shield) and class skills, 1 otherwise, 2 once the skill has ≥ 3 overmastery bars. */
export function essenceSlots(skill: SkillDef, overBars: number): number {
  if (SUPPORT_KINDS.includes(skill.shape.kind) || skill.classOf !== undefined) return 0;
  return overBars >= SECOND_SLOT_OVERBARS ? 2 : 1;
}

/** A parsed, owned, ready ingredient. */
type Ingredient =
  | { kind: 'skill'; ref: IngredientRef; id: string; def: SkillDef }
  | { kind: 'el'; ref: IngredientRef; def: ElementDef }
  | { kind: 'mod'; ref: IngredientRef; def: EssenceDef };

function tryParseRef(ref: IngredientRef): ParsedRef | null {
  try {
    return parseRef(ref);
  } catch {
    return null;
  }
}

/** Resolves an ingredient and checks the player owns it (skills: at fusion rank). */
function ingredient(reg: Registry, ctx: FusionContext, ref: IngredientRef): Ingredient | FusionFailure {
  const p = tryParseRef(ref);
  if (!p) return fail('missing', 'That is not something the altar recognises.');
  switch (p.kind) {
    case 'skill': {
      const def = reg.skill(p.id);
      if (!def || !ctx.has(p.id)) return fail('missing', `You do not know ${def?.name ?? 'that skill'}.`);
      // A class skill (classOf) is never a fusion ingredient (SPEC-v4 §3.3).
      if (def.classOf !== undefined) return fail('bound', `${def.name} is a class skill and cannot be fused.`);
      const need = fusionMinRank(def.maxRank);
      if (ctx.rank(p.id) < need) return fail('rank', `${def.name} must reach rank ${need} to be fused.`);
      return { kind: 'skill', ref, id: p.id, def };
    }
    case 'el': {
      const def = reg.element(p.id);
      if (!def || !ctx.hasElement(p.id)) return fail('missing', `${def?.name ?? 'That element'} is not attuned.`);
      return { kind: 'el', ref, def };
    }
    case 'mod': {
      const def = reg.essence(p.id);
      if (!def || ctx.essenceCount(p.id) < 1) return fail('missing', `You carry no ${def?.name ?? 'such'} essence.`);
      return { kind: 'mod', ref, def };
    }
    case 'passive':
      return fail('missing', 'Passives cannot be placed on the altar.');
  }
}

const isFailure = (x: Ingredient | FusionFailure): x is FusionFailure => 'ok' in x;

/**
 * What fusing `a` with `b` would produce (SPEC §3), first match wins:
 * 0. same ingredient → 'same'; unknown/unowned → 'missing'; skill below fusionMinRank → 'rank'.
 * 1. authored recipe for the pair (incl. fused elements and Resonances); unmet → 'requirement'.
 * 2. skill + essence → variant with the essence ('buff'/'shape', 'category', 'slot'); consumes it.
 * 3. skill + element → apply or swap the element, keeping essences ('bound' if not allowed).
 * 4. element + element without a recipe falls through to 6.
 * 5. two authored skills → shape merge `fuse:a|b` (see mergeBlocker).
 * 6. otherwise 'nothing' (pick a whisper with hintCandidates).
 * Pure: never mutates the context or the registry's data.
 */
export function resolveFusion(reg: Registry, ctx: FusionContext, a: IngredientRef, b: IngredientRef): FusionOutcome {
  if (a === b) return fail('same', 'An ingredient cannot be fused with itself.');
  const ia = ingredient(reg, ctx, a);
  if (isFailure(ia)) return ia;
  const ib = ingredient(reg, ctx, b);
  if (isFailure(ib)) return ib;

  const recipe = reg.recipe(a, b);
  if (recipe) {
    const unmet = (recipe.requires ?? []).filter((r) => !ctx.meets(r));
    if (unmet.length > 0) {
      return {
        ok: false,
        reason: 'requirement',
        message: `The ingredients resonate, but something is missing: ${unmet.map((r) => describeRequirement(reg, r)).join(', ')}.`,
        unmet,
      };
    }
    return { ok: true, result: recipe.result, kind: 'authored' };
  }

  const [x, y] = ia.kind === 'skill' ? [ia, ib] : [ib, ia];
  if (x.kind === 'skill') {
    if (y.kind === 'mod') return applyEssence(reg, ctx, x.id, x.def, y.def);
    if (y.kind === 'el') return applyElement(reg, x.id, x.def, y.def);
    return mergePair(reg, x, y);
  }
  return nothing(
    x.kind === 'el' && y.kind === 'el'
      ? 'The two elements swirl together, then drift apart.'
      : 'The essence finds no technique to shape.',
  );
}

function applyEssence(reg: Registry, ctx: FusionContext, id: string, skill: SkillDef, ess: EssenceDef): FusionOutcome {
  const parts = parseVariantId(id);
  if (!parts) return nothing('The essence finds no technique to shape.');
  const applied = (skill.essences ?? []).flatMap((e) => reg.essence(e) ?? []);
  const check = canApplyEssence(skill, ess, essenceSlots(skill, ctx.overBars(id)), applied);
  if (!check.ok) return fail(check.reason === 'buff' ? 'shape' : check.reason, check.message);
  const resultId = variantId(parts.base, parts.element, [...parts.mods, ess.id]);
  if (!reg.skill(resultId)) return fail('shape', `${ess.name} cannot shape ${skill.name}.`);
  return ctx.has(resultId)
    ? { ok: true, result: skillRef(resultId), kind: 'essence' }
    : { ok: true, result: skillRef(resultId), kind: 'essence', consumes: ess.id };
}

function applyElement(reg: Registry, id: string, skill: SkillDef, el: ElementDef): FusionOutcome {
  if (elementSlotState(reg, skill) === 'bound') {
    const isAttack = skill.shape.kind !== 'buff' && skill.power > 0;
    const bound = isAttack && skill.element ? reg.element(skill.element) : undefined;
    return fail(
      'bound',
      bound
        ? `${skill.name} is already bound to ${bound.name.toLowerCase()}. The new element is repelled.`
        : `${skill.name} has no edge for the element to cling to.`,
    );
  }
  if (skill.element === el.id) return fail('bound', `${skill.name} already carries ${el.name.toLowerCase()}.`);
  const parts = parseVariantId(id);
  const resultId = parts && variantId(parts.base, el.id, parts.mods);
  if (!resultId || !reg.skill(resultId)) return fail('bound', `${skill.name} cannot hold ${el.name.toLowerCase()}.`);
  return { ok: true, result: skillRef(resultId), kind: 'element' };
}

function mergePair(
  reg: Registry,
  x: Extract<Ingredient, { kind: 'skill' }>,
  y: Extract<Ingredient, { kind: 'skill' }>,
): FusionOutcome {
  for (const s of [x, y]) {
    if (!reg.isAuthored(s.id)) return nothing(`${s.def.name} is already a composed technique and cannot be merged again.`);
  }
  const blocker = mergeBlocker(x.def, y.def);
  if (blocker) return nothing(blocker);
  return { ok: true, result: skillRef(mergeId(x.id, y.id)), kind: 'merge' };
}

/**
 * Undiscovered authored recipes (by pair key, not in `discovered`) that use `a` or `b` and carry a
 * hint — the whispers a failed fusion may reveal. Deduplicated, `a`'s recipes first.
 */
export function hintCandidates(
  reg: Registry,
  a: IngredientRef,
  b: IngredientRef,
  discovered: readonly string[],
): FusionRecipe[] {
  const known = new Set(discovered);
  const seen = new Set<string>();
  const out: FusionRecipe[] = [];
  for (const r of [...reg.recipesWith(a), ...reg.recipesWith(b)]) {
    const k = pairKey(r.a, r.b);
    if (!r.hint || known.has(k) || seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
