// Weapon rules of the game layer (src/game/systems/weapons.ts; docs/SPEC-v4.md §2.1, §2.2): Bare Hands is a weapon
// that is always owned, swapping has a cooldown and waits for a wind-up, becoming a class equips its weapon, and the
// lock line's Equip action knows what to equip.
import { describe, expect, it } from 'vitest';
import { WEAPON, weaponLockLine, weaponOk } from '../src/core/requirements';
import type { SkillDef, WeaponType } from '../src/core/types';
import { WEAPONS } from '../src/data/weapons';
import { BARE, type SwapState, canSwap, classWeapon, equipFor, nextSwapAt, ownedWeapons } from '../src/game/systems/weapons';
import { Session } from '../src/game/session';
import { fixtureRegistry } from './fixtures/game-v4';

const reg = fixtureRegistry();
const state = (over: Partial<SwapState> = {}): SwapState => ({ owned: ['sword', 'fists'], held: 'sword', now: 10_000, readyAt: 0, windup: false, dead: false, ...over });

describe('Bare Hands is a weapon you always own', () => {
  it('ownedWeapons: known types only, no duplicates, the held weapon and Bare Hands always in', () => {
    expect(BARE).toBe('fists');
    expect(ownedWeapons(['sword', 'sword', 'axe', 7], 'dagger')).toEqual(['sword', 'dagger', 'fists']);
    expect(ownedWeapons(undefined)).toEqual(['fists']);
    expect(ownedWeapons(['fists', 'staff'], 'staff')).toEqual(['fists', 'staff']);
  });

  it('a new character owns Bare Hands beside the weapon picked; a bare-handed start owns just the hands', () => {
    expect(Session.create(reg, 'A', 'sword', 1).player.ownedWeapons).toEqual(['sword', 'fists']);
    const bare = Session.create(reg, 'B', 'fists', 1);
    expect(bare.player.ownedWeapons).toEqual(['fists']);
    expect(bare.player.weapon).toBe('fists');
    // Its basic attack is known from the first minute (when the content has it).
    if (reg.skill(WEAPONS.fists.basic)) expect(bare.book.has(WEAPONS.fists.basic)).toBe(true);
  });

  it('Bare Hands can be equipped even when the owned list was never told about it', () => {
    expect(canSwap(state({ owned: ['sword'] }), 'fists')).toEqual({ ok: true });
  });
});

describe('weapon swap', () => {
  it('needs the weapon, a different one, a living hero, no wind-up, and the cooldown over', () => {
    expect(canSwap(state(), 'dagger')).toMatchObject({ ok: false, reason: 'notOwned' });
    expect(canSwap(state(), 'sword')).toMatchObject({ ok: false, reason: 'same' });
    expect(canSwap(state({ dead: true }), 'fists')).toMatchObject({ ok: false, reason: 'dead' });
    expect(canSwap(state({ windup: true }), 'fists')).toMatchObject({ ok: false, reason: 'windup' });
    expect(canSwap(state({ readyAt: 10_001 }), 'fists')).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(canSwap(state({ readyAt: 10_000 }), 'fists')).toEqual({ ok: true });
  });

  it("the cooldown is the spec's (WEAPON.swapCooldownMs = 3 s) and starts at the swap", () => {
    expect(WEAPON.swapCooldownMs).toBe(3000);
    const readyAt = nextSwapAt(10_000);
    expect(readyAt).toBe(13_000);
    expect(canSwap(state({ held: 'fists', readyAt, now: 12_999 }), 'sword')).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(canSwap(state({ held: 'fists', readyAt, now: 13_000 }), 'sword')).toEqual({ ok: true });
  });

  it('becoming a class is free: no cooldown, not held back by a wind-up (but never for a weapon not owned)', () => {
    expect(canSwap(state({ readyAt: 99_999, windup: true }), 'fists', true)).toEqual({ ok: true });
    expect(canSwap(state({ readyAt: 99_999 }), 'staff', true)).toMatchObject({ ok: false, reason: 'notOwned' });
    expect(canSwap(state({ dead: true }), 'fists', true)).toMatchObject({ ok: false, reason: 'dead' });
  });

  it('every refusal has one short plain line', () => {
    for (const s of [state({ dead: true }), state({ windup: true }), state({ readyAt: 1e9 })]) {
      const r = canSwap(s, 'fists');
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('"Become <class>" equips the class weapon when the player owns it', () => {
  const owned: WeaponType[] = ['sword', 'fists'];
  it('equips an owned class weapon that is not in hand', () => {
    expect(classWeapon(reg.classDef('fx_blade'), owned, 'fists')).toBe('sword');
    expect(classWeapon(reg.classDef('fx_way'), owned, 'sword')).toBe('fists'); // Bare Hands is always owned
  });
  it('does nothing when it is already held, not owned, or the class has no weapon of its own', () => {
    expect(classWeapon(reg.classDef('fx_blade'), owned, 'sword')).toBeNull();
    expect(classWeapon(reg.classDef('fx_tide'), owned, 'sword')).toBeNull(); // a Rod class, no rod owned
    expect(classWeapon({ weapon: 'any' }, owned, 'sword')).toBeNull();
    expect(classWeapon({}, owned, 'sword')).toBeNull();
    expect(classWeapon(undefined, owned, 'sword')).toBeNull();
  });
});

describe('the lock line and its Equip action', () => {
  const skill = (weapons?: WeaponType[]): Pick<SkillDef, 'weapons'> => ({ weapons });
  it('a free skill is never locked; a bound skill is locked by any other weapon', () => {
    expect(equipFor(skill(), ['fists'], 'sword')).toBeNull();
    expect(equipFor(skill(['sword']), ['sword', 'fists'], 'sword')).toBeNull();
    expect(equipFor(skill(['sword']), ['sword', 'fists'], 'staff')).toEqual({ weapon: 'sword', owned: true });
  });
  it('Equip picks a weapon the player owns among those the skill lists; else names the first (not owned)', () => {
    expect(equipFor(skill(['sword', 'dagger']), ['dagger', 'fists'], 'staff')).toEqual({ weapon: 'dagger', owned: true });
    expect(equipFor(skill(['sword', 'dagger']), ['staff', 'fists'], 'staff')).toEqual({ weapon: 'sword', owned: false });
    expect(equipFor(skill(['fists']), ['sword'], 'sword')).toEqual({ weapon: 'fists', owned: true });
  });
  it('the fixture content locks as the spec says: a Rod cannot swing a sword skill; a free spell works with anything', () => {
    const spin = reg.skill('fx_spin')!;
    const dart = reg.skill('fx_dart')!;
    expect(weaponOk(spin, 'staff')).toBe(false);
    expect(weaponLockLine(spin, 'staff')).toBe('Needs a sword');
    expect(weaponLockLine(reg.skill('fx_hook')!, 'sword')).toBe('Needs bare hands');
    for (const w of ['sword', 'dagger', 'staff', 'fists'] as const) expect(weaponOk(dart, w)).toBe(true);
  });
});
