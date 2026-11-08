import { rankPower } from './mastery';
import type { ElementDef, ElementId, SkillDef } from './types';

export const ELEMENT_STRONG = 1.5;
export const ELEMENT_WEAK = 0.6;
export const ELEMENT_SAME = 0.5;

/** Elemental matchup multiplier, attacker element vs defender element. */
export function elementMultiplier(
  elements: Map<ElementId, ElementDef>,
  attack: ElementId | undefined,
  defend: ElementId | undefined,
): number {
  if (!attack || !defend) return 1;
  if (attack === defend) return ELEMENT_SAME;
  if (elements.get(attack)?.strongVs.includes(defend)) return ELEMENT_STRONG;
  if (elements.get(defend)?.strongVs.includes(attack)) return ELEMENT_WEAK;
  return 1;
}

export interface Attacker {
  atk: number;
  matk: number;
  crit: number;
}

export interface Defender {
  def: number;
  element?: ElementId;
}

export interface DamageRoll {
  amount: number;
  crit: boolean;
  multiplier: number;
}

export function isMagic(skill: SkillDef): boolean {
  return skill.tags.includes('arcane');
}

/** Hybrid techniques (arcane + weapon) scale off whichever stat is higher. */
export function isHybrid(skill: SkillDef): boolean {
  return isMagic(skill) && (skill.tags.includes('blade') || skill.tags.includes('pierce'));
}

export function computeDamage(
  elements: Map<ElementId, ElementDef>,
  skill: SkillDef,
  rank: number,
  attacker: Attacker,
  defender: Defender,
  opts: { tagPower?: number; rng?: () => number; falloff?: number } = {},
): DamageRoll {
  const rng = opts.rng ?? Math.random;
  const base = isHybrid(skill)
    ? Math.max(attacker.atk, attacker.matk)
    : isMagic(skill)
      ? attacker.matk
      : attacker.atk;
  const mult = elementMultiplier(elements, skill.element, defender.element);
  const critChance = attacker.crit + (skill.critBonus ?? 0);
  const crit = rng() * 100 < critChance;
  const variance = 0.9 + rng() * 0.2;
  let dmg =
    base *
    skill.power *
    rankPower(rank) *
    mult *
    (1 + (opts.tagPower ?? 0) / 100) *
    (opts.falloff ?? 1) *
    variance;
  if (crit) dmg *= 1.5;
  // Flat defense, but never below 1.
  dmg = Math.max(1, Math.round(dmg - defender.def * (crit ? 0.5 : 1)));
  return { amount: dmg, crit, multiplier: mult };
}
