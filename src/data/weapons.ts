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
 * Weapons the smith sells. Bare Hands is never sold: it is "nothing equipped" and always owned (SPEC-v4 §2.1). Its
 * basic attack `jab` and its tree are in skills/fists.ts.
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
    blurb: 'Balanced and sturdy. Grows toward spins, throws, and crushing blows.',
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
    blurb: 'Fast and deadly. Grows toward stealth, knives, and critical strikes.',
  },
  staff: {
    id: 'staff',
    name: 'Oak Rod',
    icon: '🪄',
    basic: 'bolt',
    atk: 5,
    matk: 13,
    crit: 2,
    delay: 900,
    range: 260,
    price: 60,
    blurb: 'Ranged magic. Grows toward orbs, novas, and plain spells.',
  },
  // SPEC-v4 §2.1: "nothing equipped". Always owned, price 0. Numbers are [T]; the class simulation holds them in band.
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
    blurb: 'Nothing but your hands. Grows toward punches, kicks, and a good guard.',
  },
};
