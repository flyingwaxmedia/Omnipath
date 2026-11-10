// Weapon rules of the game layer (docs/SPEC-v4.md §2.1, §2.2). Bare Hands IS "nothing equipped": a weapon like the
// others, always owned, never bought or sold. Swapping weapons has a short cooldown and never happens during a
// wind-up; becoming a class equips its weapon in the same tap (no cooldown) when the player owns it. Pure functions,
// unit-tested in tests/game-weapons.test.ts; MapScene.equipWeapon applies them.
import { WEAPON, weaponNeeded } from '../../core/requirements';
import { WEAPON_TYPES, type ClassDef, type SkillDef, type WeaponType } from '../../core/types';

/** The weapon that is always owned and can never be unequipped: it is what you hold with nothing equipped. */
export const BARE: WeaponType = 'fists';

/** Owned weapons as saved data should hold them: known weapon types only, no duplicates, Bare Hands always in. */
export function ownedWeapons(raw: readonly unknown[] | undefined, held?: WeaponType): WeaponType[] {
  const out = (raw ?? []).filter((x): x is WeaponType => WEAPON_TYPES.includes(x as WeaponType));
  if (held && !out.includes(held)) out.push(held);
  if (!out.includes(BARE)) out.push(BARE);
  return [...new Set(out)];
}

export interface SwapState {
  owned: readonly WeaponType[];
  held: WeaponType;
  /** Clock time now and the time the next swap is allowed (same clock; ms). */
  now: number;
  readyAt: number;
  /** A skill is winding up. */
  windup: boolean;
  /** Knocked out. */
  dead: boolean;
}

export type SwapCheck = { ok: true } | { ok: false; reason: 'same' | 'notOwned' | 'dead' | 'windup' | 'cooldown'; message: string };

/**
 * Whether the player may change to weapon `to` right now. `free` skips the cooldown and the wind-up rule (becoming
 * a class equips its weapon in the same tap).
 */
export function canSwap(s: SwapState, to: WeaponType, free = false): SwapCheck {
  if (to !== BARE && !s.owned.includes(to)) return { ok: false, reason: 'notOwned', message: 'You do not own that weapon.' };
  if (to === s.held) return { ok: false, reason: 'same', message: 'You are already holding that.' };
  if (s.dead) return { ok: false, reason: 'dead', message: 'Not while you are down.' };
  if (free) return { ok: true };
  if (s.windup) return { ok: false, reason: 'windup', message: 'Finish your move first.' };
  if (s.now < s.readyAt) return { ok: false, reason: 'cooldown', message: 'Wait a moment to change weapons again.' };
  return { ok: true };
}

/** When the next swap is allowed after one at `now`. */
export function nextSwapAt(now: number): number {
  return now + WEAPON.swapCooldownMs;
}

/**
 * The weapon to equip when becoming `cls`: the class weapon, when it has one, the player owns it and does not hold
 * it already. Null otherwise (legacy classes and 'any' classes never change the weapon).
 */
export function classWeapon(cls: Pick<ClassDef, 'weapon'> | undefined, owned: readonly WeaponType[], held: WeaponType): WeaponType | null {
  const w = cls?.weapon;
  if (!w || w === 'any' || w === held) return null;
  return w === BARE || owned.includes(w) ? w : null;
}

/**
 * The weapon the lock line's "Equip" action should equip for a skill: the first weapon it lists that the player
 * owns (Bare Hands is always owned), else the first it lists (the UI then says where to get one). Null when the
 * held weapon is fine.
 */
export function equipFor(skill: Pick<SkillDef, 'weapons'>, owned: readonly WeaponType[], held: WeaponType): { weapon: WeaponType; owned: boolean } | null {
  const first = weaponNeeded(skill, held);
  if (!first) return null;
  const have = skill.weapons?.find((w) => w === BARE || owned.includes(w));
  return have ? { weapon: have, owned: true } : { weapon: first, owned: false };
}
