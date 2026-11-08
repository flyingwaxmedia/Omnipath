// Ingredient references used by the fusion altar, recipes and save data.
// A ref is `<kind>:<id>`; the id is everything after the FIRST colon, so merge ids such as
// `skill:fuse:sword_throw|whirlwind` parse correctly.
import type { ElementId, IngredientRef } from './types';

/** Ref to a skill (authored, variant or merge id). */
export const skillRef = (id: string): IngredientRef => `skill:${id}`;
/** Ref to an element. */
export const elRef = (id: ElementId): IngredientRef => `el:${id}`;
/** Ref to an essence (fusion ingredient that reshapes a skill). */
export const modRef = (id: string): IngredientRef => `mod:${id}`;
/** Ref to a passive (recipe results only, e.g. resonances). */
export const passiveRef = (id: string): IngredientRef => `passive:${id}`;

export type ParsedRef =
  | { kind: 'skill'; id: string }
  | { kind: 'el'; id: ElementId }
  | { kind: 'mod'; id: string }
  | { kind: 'passive'; id: string };

/** Splits a ref into kind and id. Throws on a malformed ref or an unknown kind. */
export function parseRef(ref: IngredientRef): ParsedRef {
  const i = ref.indexOf(':');
  if (i <= 0 || i === ref.length - 1) throw new Error(`Bad ingredient ref "${ref}"`);
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  switch (kind) {
    case 'skill':
    case 'mod':
    case 'passive':
      return { kind, id };
    case 'el':
      return { kind, id: id as ElementId };
    default:
      throw new Error(`Bad ingredient kind "${kind}"`);
  }
}

/** Order-independent key for a pair of ingredients (attempts, discoveries, recipe lookup). */
export function pairKey(a: IngredientRef, b: IngredientRef): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

/** Id of a skill infused with an element (v1 form; still valid in v2 variant ids). */
export const infusedId = (skillId: string, el: ElementId): string => `${skillId}@${el}`;
