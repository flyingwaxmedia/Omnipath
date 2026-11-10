// Weapons and weapon gating (SPEC-v4 §2): the four weapons, grip tags, weaponOk and its lock line, the grip rules
// Registry.validate enforces, Bare Hands' numbers, and body moves (free with any weapon, stronger with none).
import { describe, expect, it } from 'vitest';
import { baseStats } from '../src/core/balance';
import { HYBRID_TAGS, SIZE_TABLE, computeDamage, isHybrid, sizeMultiplier } from '../src/core/combat';
import { Registry } from '../src/core/registry';
import {
  GRIP_TAGS,
  WEAPON,
  bodyBonusPct,
  gripProblems,
  gripWeapons,
  isWeaponBound,
  weaponLockLine,
  weaponNeeded,
  weaponOk,
} from '../src/core/requirements';
import { emptyState, emptyWeaponLevels } from '../src/core/state';
import { GRIP_TAG, WEAPON_TYPES, type GameData, type SkillDef, type WeaponType } from '../src/core/types';
import { createRegistry } from '../src/data';
import { SOLD_WEAPONS, WEAPONS } from '../src/data/weapons';
import { computeStats, type PlayerSave } from '../src/game/session';

const sk = (s: Pick<SkillDef, 'id' | 'tags'> & Partial<SkillDef>): SkillDef => ({
  name: s.id,
  desc: `${s.id}.`,
  icon: 'i',
  tier: 1,
  power: 1,
  spCost: 5,
  cooldown: 2000,
  shape: { kind: 'strike', range: 40, arc: 90 },
  maxRank: 5,
  ...s,
});

/** The examples of the §2.2 table. */
const WHIRLWIND = sk({ id: 'whirlwind', tags: ['blade', 'spin'], weapons: ['sword'] });
const KNIFE_FAN = sk({ id: 'knife_fan', tags: ['pierce', 'projectile'], weapons: ['dagger'] });
const ARCANE_ORB = sk({ id: 'arcane_orb', tags: ['rod', 'arcane'], weapons: ['staff'] });
const HAYMAKER = sk({ id: 'haymaker', tags: ['fist'], weapons: ['fists'] });
const EMBER_DART = sk({ id: 'ember_dart', tags: ['arcane', 'spell'], element: 'fire' });
const FOCUS = sk({ id: 'focus', tags: ['buff'], shape: { kind: 'buff', stat: 'matk', amount: 10, duration: 5000 } });
const RISING_KICK = sk({ id: 'rising_kick', tags: ['body', 'technique'] });
const TWIN_FANG = sk({ id: 'twin_fang', tags: ['blade', 'pierce'], weapons: ['sword', 'dagger'] });
const SLASH = sk({ id: 'slash', tier: 0, tags: ['blade', 'basic'], weapons: ['sword'] });
const JAB = sk({ id: 'jab', tier: 0, tags: ['fist', 'basic'], weapons: ['fists'] });

describe('the four weapons', () => {
  it('are sword, dagger, staff (Rod) and fists (Bare Hands), each with its grip tag', () => {
    expect(WEAPON_TYPES).toEqual(['sword', 'dagger', 'staff', 'fists']);
    expect(GRIP_TAG).toEqual({ sword: 'blade', dagger: 'pierce', staff: 'rod', fists: 'fist' });
    expect(GRIP_TAGS).toEqual(['blade', 'pierce', 'rod', 'fist']);
    expect(emptyWeaponLevels()).toEqual({ sword: 0, dagger: 0, staff: 0, fists: 0 });
    expect(emptyState().weaponLevel).toEqual(emptyWeaponLevels());
  });

  it('Bare Hands has its stats and its own size row (SPEC-v4 §2.1)', () => {
    expect(WEAPONS.fists).toMatchObject({ id: 'fists', name: 'Bare Hands', basic: 'jab', atk: 8, matk: 8, crit: 8, delay: 450, range: 36, price: 0 });
    expect(Object.keys(WEAPONS).sort()).toEqual([...WEAPON_TYPES].sort());
    expect(SIZE_TABLE.fists).toEqual({ S: 1.0, M: 0.95, L: 0.8 });
    expect(sizeMultiplier(HAYMAKER, 'fists', 'L')).toBe(0.8);
    // It is "nothing equipped": never for sale.
    expect(SOLD_WEAPONS).not.toContain('fists');
  });

  it('fist skills use the higher of ATK and MATK', () => {
    expect(HYBRID_TAGS).toContain('fist');
    expect(isHybrid(HAYMAKER)).toBe(true);
    const elements = new Map();
    const hit = (atk: number, matk: number) =>
      computeDamage(elements, HAYMAKER, 1, { atk, matk, crit: 0, weapon: 'fists' }, { def: 0 }, { rng: () => 0.5 }).amount;
    expect(hit(40, 90)).toBe(hit(90, 40));
    expect(hit(40, 90)).toBe(90);
  });

  it("core's base stats are the game's (the class simulation stands on them)", () => {
    for (const w of WEAPON_TYPES) {
      for (const level of [1, 10, 24]) {
        const p = { weapon: w, level } as PlayerSave;
        const game = computeStats(p, {}, []);
        const core = baseStats(level, WEAPONS[w]);
        expect({ maxHp: game.maxHp, maxSp: game.maxSp, atk: game.atk, matk: game.matk, crit: game.crit }).toEqual({
          maxHp: core.maxHp,
          maxSp: core.maxSp,
          atk: core.atk,
          matk: core.matk,
          crit: core.crit,
        });
        expect(game.def).toBe(Math.round(core.def));
      }
    }
  });
});

describe('weaponOk: "If a move uses a weapon, you need that weapon."', () => {
  const table: [SkillDef, Record<WeaponType, boolean>][] = [
    [WHIRLWIND, { sword: true, dagger: false, staff: false, fists: false }],
    [KNIFE_FAN, { sword: false, dagger: true, staff: false, fists: false }],
    [ARCANE_ORB, { sword: false, dagger: false, staff: true, fists: false }],
    [HAYMAKER, { sword: false, dagger: false, staff: false, fists: true }],
    [TWIN_FANG, { sword: true, dagger: true, staff: false, fists: false }],
    [EMBER_DART, { sword: true, dagger: true, staff: true, fists: true }],
    [FOCUS, { sword: true, dagger: true, staff: true, fists: true }],
    [RISING_KICK, { sword: true, dagger: true, staff: true, fists: true }],
  ];

  it.each(table)('$id', (skill, want) => {
    for (const w of WEAPON_TYPES) expect(weaponOk(skill, w), w).toBe(want[w]);
  });

  it('consults `weapons` and nothing else', () => {
    // A grip tag without `weapons` is a data error (validate reports it), but the rule itself only reads `weapons`.
    expect(weaponOk({ weapons: undefined }, 'staff')).toBe(true);
    expect(weaponOk({ weapons: [] }, 'staff')).toBe(false);
    expect(isWeaponBound(WHIRLWIND)).toBe(true);
    expect(isWeaponBound(EMBER_DART)).toBe(false);
  });

  it('a Rod cannot Whirlwind; Ember Dart casts with a sword (acceptance 2)', () => {
    expect(weaponOk(WHIRLWIND, 'staff')).toBe(false);
    expect(weaponLockLine(WHIRLWIND, 'staff')).toBe('Needs a sword');
    expect(weaponNeeded(WHIRLWIND, 'staff')).toBe('sword');
    expect(weaponOk(EMBER_DART, 'sword')).toBe(true);
    expect(weaponLockLine(EMBER_DART, 'sword')).toBeNull();
    expect(weaponNeeded(WHIRLWIND, 'sword')).toBeNull();
  });

  it('the lock line names the weapon in plain words, one line, no internals', () => {
    expect(weaponLockLine(KNIFE_FAN, 'sword')).toBe('Needs a dagger');
    expect(weaponLockLine(ARCANE_ORB, 'sword')).toBe('Needs a rod');
    expect(weaponLockLine(HAYMAKER, 'sword')).toBe('Needs bare hands');
    expect(weaponLockLine(TWIN_FANG, 'staff')).toBe('Needs a sword'); // the first weapon it lists
    for (const s of [WHIRLWIND, KNIFE_FAN, ARCANE_ORB, HAYMAKER]) {
      const line = weaponLockLine(s, s.weapons![0] === 'sword' ? 'staff' : 'sword')!;
      expect(line).not.toMatch(/staff|fists|weapons|grip|tag/i);
      expect(line.length).toBeLessThanOrEqual(60);
    }
  });
});

describe('grip rules (Registry.validate({ grip: true }))', () => {
  const data = (skills: SkillDef[]): GameData => ({
    dataVersion: 2,
    elements: [{ id: 'fire', name: 'Fire', prefix: 'Blazing', icon: 'f', color: 0, tier: 0, desc: '', status: 'burn', strongVs: [] }],
    skills,
    morphs: [],
    recipes: [],
    classes: [],
    essences: [],
    passives: [],
    trainers: [],
    monsters: [],
    items: [],
  });

  it('accepts bound skills with their grip, free skills without one, cross-weapon skills and tier-0 basics', () => {
    const all = [WHIRLWIND, KNIFE_FAN, ARCANE_ORB, HAYMAKER, EMBER_DART, FOCUS, RISING_KICK, TWIN_FANG, SLASH, JAB];
    expect(new Registry(data(all)).validate({ grip: true })).toEqual([]);
    for (const s of all) expect(gripProblems(s), s.id).toEqual([]);
    expect(gripWeapons(TWIN_FANG)).toEqual(['sword', 'dagger']);
    expect(gripWeapons(EMBER_DART)).toEqual([]);
    // A basic may list its weapon without a grip tag (today's `bolt`).
    expect(gripProblems(sk({ id: 'bolt', tier: 0, tags: ['arcane', 'basic'], weapons: ['staff'] }))).toEqual([]);
  });

  it('reports a grip tag without weapons, weapons without a grip tag, and a grip whose weapon is not listed', () => {
    const bad = [
      sk({ id: 'loose_blade', tags: ['blade'] }),
      sk({ id: 'meteor', tags: ['arcane'], weapons: ['staff'] }),
      sk({ id: 'half_fang', tags: ['blade', 'pierce'], weapons: ['sword'] }),
    ];
    const reg = new Registry(data(bad));
    expect(reg.validate({ grip: true })).toEqual([
      'skill loose_blade: grip tag blade without weapons',
      'skill meteor: weapons without a grip tag',
      'skill half_fang: grip tag pierce but weapons does not list dagger',
    ]);
    // Off by default until the content lane's retag pass has landed.
    expect(reg.validate()).toEqual([]);
  });
});

describe('body moves: free with any weapon, +20% bare-handed', () => {
  it('get WEAPON.bodyBonus only with bare hands', () => {
    expect(WEAPON.bodyBonus).toBe(20);
    for (const w of WEAPON_TYPES) {
      expect(weaponOk(RISING_KICK, w)).toBe(true);
      expect(bodyBonusPct(RISING_KICK, w)).toBe(w === 'fists' ? 20 : 0);
      expect(bodyBonusPct(WHIRLWIND, w)).toBe(0);
    }
    expect(bodyBonusPct(RISING_KICK, undefined)).toBe(0);
  });

  it('computeDamage applies it by itself', () => {
    const elements = new Map();
    const hit = (weapon: WeaponType, skill: SkillDef) =>
      computeDamage(elements, skill, 1, { atk: 100, matk: 100, crit: 0, weapon }, { def: 0 }, { rng: () => 0.5 }).amount;
    expect(hit('sword', RISING_KICK)).toBe(100);
    expect(hit('fists', RISING_KICK)).toBe(120);
    expect(hit('fists', HAYMAKER)).toBe(100); // a fist skill is not a body move
  });
});

describe('the content (src/data)', () => {
  const reg = createRegistry();
  const authored = reg.authoredSkills();
  const retagged = authored.some((s) => s.tags.includes(GRIP_TAG.staff) || s.tags.includes(GRIP_TAG.fists));

  it('every weapon whose basic attack is authored has a tier-0 basic bound to it', () => {
    for (const w of WEAPON_TYPES) {
      const basic = reg.skill(WEAPONS[w].basic);
      if (!basic) continue;
      expect(basic.tier, w).toBe(0);
      expect(basic.tags, w).toContain('basic');
      expect(weaponOk(basic, w), w).toBe(true);
    }
    for (const w of SOLD_WEAPONS) expect(reg.skill(WEAPONS[w].basic), w).toBeDefined();
  });

  // The two checks below switch on by themselves when the content lane lands its part (SPEC-v4 §15.2 lane B).
  it.skipIf(!reg.skill(WEAPONS.fists.basic))('Bare Hands has its basic attack: Jab, a fist skill for bare hands only', () => {
    const jab = reg.skill(WEAPONS.fists.basic)!;
    expect(jab.tags).toEqual(expect.arrayContaining(['fist', 'basic']));
    expect(jab.weapons).toEqual(['fists']);
  });

  it.skipIf(!retagged)('every grip-tagged skill has weapons and vice versa (after the retag pass)', () => {
    expect(reg.validate({ grip: true })).toEqual([]);
  });

  it('weapons listed on skills are real weapons, and every bound sword / dagger skill already carries its grip', () => {
    for (const s of authored) for (const w of s.weapons ?? []) expect(WEAPON_TYPES, s.id).toContain(w);
    // "blade ⇒ sword and pierce ⇒ dagger already line up for all bound skills" (SPEC-v4 §2.2).
    for (const s of authored) {
      if (!s.weapons || s.tags.includes('monster')) continue;
      for (const w of ['sword', 'dagger'] as const) {
        if (s.tags.includes(GRIP_TAG[w])) expect(s.weapons, `${s.id} carries ${GRIP_TAG[w]}`).toContain(w);
      }
    }
  });

  it.skipIf(!authored.some((s) => s.tags.includes(WEAPON.bodyTag)))('body moves are free', () => {
    for (const s of authored.filter((x) => x.tags.includes(WEAPON.bodyTag))) expect(s.weapons, s.id).toBeUndefined();
  });
});
