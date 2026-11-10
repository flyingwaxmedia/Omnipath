import type { WeaponType } from '../core/types';

export interface WeaponDef {
  id: WeaponType;
  name: string;
  icon: string;
  basic: string;
  atk: number;
  matk: number;
  crit: number;
  /** Auto-attack delay in ms. */
  delay: number;
  /** Auto-attack engage range in px. */
  range: number;
  price: number;
  blurb: string;
}

/**
 * Weapons a new hero may pick and the smith sells today. Bare Hands is never sold (it is always owned, SPEC-v4
 * §2.1) and joins the picker when its tree lands (content lane).
 */
export const SOLD_WEAPONS: readonly WeaponType[] = ['sword', 'dagger', 'staff'];

export const WEAPONS: Record<WeaponType, WeaponDef> = {
  sword: {
    id: 'sword',
    name: 'Iron Sword',
    icon: '⚔️',
    basic: 'slash',
    atk: 10,
    matk: 4,
    crit: 3,
    delay: 800,
    range: 50,
    price: 60,
    blurb: 'Balanced and sturdy. Morphs toward spins, throws, and crushing blows.',
  },
  dagger: {
    id: 'dagger',
    name: 'Rogue Dagger',
    icon: '🔪',
    basic: 'stab',
    atk: 8,
    matk: 4,
    crit: 12,
    delay: 520,
    range: 40,
    price: 60,
    blurb: 'Fast and deadly. Morphs toward stealth, knives, and critical strikes.',
  },
  staff: {
    id: 'staff',
    name: 'Oak Staff',
    icon: '🪄',
    basic: 'bolt',
    atk: 5,
    matk: 13,
    crit: 2,
    delay: 900,
    range: 260,
    price: 60,
    blurb: 'Ranged magic. Morphs toward orbs, novas, and elemental spells.',
  },
  // SPEC-v4 §2.1: "nothing equipped". Always owned, price 0. Its basic `jab` and tree land with the content lane.
  fists: {
    id: 'fists',
    name: 'Bare Hands',
    icon: '👊',
    basic: 'jab',
    atk: 8,
    matk: 8,
    crit: 8,
    delay: 450,
    range: 36,
    price: 0,
    blurb: 'Nothing but your hands. Fast, close, and always with you.',
  },
};
