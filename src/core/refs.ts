import type { ElementId, IngredientRef } from './types';

export const skillRef = (id: string): IngredientRef => `skill:${id}`;
export const elRef = (id: ElementId): IngredientRef => `el:${id}`;

export type ParsedRef = { kind: 'skill'; id: string } | { kind: 'el'; id: ElementId };

export function parseRef(ref: IngredientRef): ParsedRef {
  const i = ref.indexOf(':');
  if (i < 0) throw new Error(`Bad ingredient ref "${ref}"`);
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  if (kind === 'skill') return { kind, id };
  if (kind === 'el') return { kind, id: id as ElementId };
  throw new Error(`Bad ingredient kind "${kind}"`);
}

/** Order-independent key for a pair of ingredients. */
export function pairKey(a: IngredientRef, b: IngredientRef): string {
  return a < b ? `${a}+${b}` : `${b}+${a}`;
}

/** Id of a procedurally infused skill. */
export const infusedId = (skillId: string, el: ElementId): string => `${skillId}@${el}`;
