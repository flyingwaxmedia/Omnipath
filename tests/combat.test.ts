import { describe, expect, it } from 'vitest';
import {
  BURN_SPREAD_RADIUS,
  ELEMENT_TABLE,
  SIZE_TABLE,
  type Attacker,
  type DamageMods,
  type Defender,
  type ElementLevel,
  type ElementRelation,
  comboFor,
  computeDamage,
  elementMultiplier,
  elementRelation,
  HYBRID_TAGS,
  isHybrid,
  isMagic,
  sizeMultiplier,
} from '../src/core/combat';
import { Registry } from '../src/core/registry';
import type { ElementDef, ElementId, GameData, Size, SkillDef, StatusKind, WeaponType } from '../src/core/types';

// ------------------------------------------------------------------ inline fixtures

function element(id: ElementId, status: StatusKind, strongVs: ElementId[], tier: 0 | 1 = 0): ElementDef {
  return { id, name: id, prefix: id, icon: '*', color: 0, tier, desc: '', status, strongVs };
}

const data: GameData = {
  dataVersion: 2,
  elements: [
    element('fire', 'burn', ['earth', 'ice']),
    element('water', 'soak', ['fire', 'magma']),
    element('earth', 'stun', ['wind', 'lightning', 'storm']),
    element('wind', 'knockback', ['water']),
    element('lightning', 'shock', ['water', 'wind']),
    element('shadow', 'bleed', ['holy']),
    element('holy', 'smite', ['shadow', 'twilight']),
    element('ice', 'freeze', ['wind', 'water'], 1),
    element('magma', 'burn', ['earth', 'ice'], 1),
    element('storm', 'shock', ['water', 'wind'], 1),
    element('twilight', 'bleed', ['holy', 'shadow'], 1),
  ],
  skills: [],
  morphs: [],
  recipes: [],
  classes: [],
  essences: [],
  passives: [],
  trainers: [],
  monsters: [],
  items: [],
};
const elements = new Registry(data).elements;

function skill(over: Partial<SkillDef> = {}): SkillDef {
  return {
    id: 'test_strike',
    name: 'Test Strike',
    desc: '',
    icon: '*',
    tier: 0,
    tags: ['blade'],
    power: 1,
    spCost: 0,
    cooldown: 0,
    shape: { kind: 'strike', range: 40, arc: 90 },
    maxRank: 10,
    ...over,
  };
}

/** Deterministic roll source cycling through `values`. */
function rolls(...values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

/** No crit (first draw high) and variance exactly 1.0 (second draw 0.5). */
const flat = () => rolls(0.99, 0.5);

const attacker: Attacker = { atk: 100, matk: 40, crit: 0 };
const LEVELS: ElementLevel[] = [1, 2, 3];

// ------------------------------------------------------------------ elements

describe('ELEMENT_TABLE', () => {
  it('holds every spec value by defender element level', () => {
    expect(ELEMENT_TABLE).toEqual({
      strong: { 1: 1.5, 2: 1.75, 3: 2.0 },
      weak: { 1: 0.6, 2: 0.5, 3: 0.4 },
      same: { 1: 0.5, 2: 0.25, 3: 0 },
      neutral: { 1: 1, 2: 1, 3: 1 },
    });
  });
});

describe('elementRelation', () => {
  it('is strong when the attacker lists the defender', () => {
    expect(elementRelation(elements, 'water', 'fire')).toBe('strong');
    expect(elementRelation(elements, 'earth', 'lightning')).toBe('strong');
  });

  it('is weak when only the defender lists the attacker', () => {
    expect(elementRelation(elements, 'fire', 'water')).toBe('weak');
    expect(elementRelation(elements, 'lightning', 'earth')).toBe('weak');
  });

  it('is same for equal elements and neutral otherwise', () => {
    expect(elementRelation(elements, 'fire', 'fire')).toBe('same');
    expect(elementRelation(elements, 'twilight', 'twilight')).toBe('same');
    expect(elementRelation(elements, 'fire', 'shadow')).toBe('neutral');
    expect(elementRelation(elements, 'holy', 'earth')).toBe('neutral');
  });

  it('makes mutual pairs strong both ways (holy vs shadow)', () => {
    expect(elementRelation(elements, 'holy', 'shadow')).toBe('strong');
    expect(elementRelation(elements, 'shadow', 'holy')).toBe('strong');
    expect(elementRelation(elements, 'holy', 'twilight')).toBe('strong');
    expect(elementRelation(elements, 'twilight', 'holy')).toBe('strong');
  });

  it("uses a fused defender's own authored strongVs", () => {
    // twilight lists shadow; shadow does not list twilight.
    expect(elementRelation(elements, 'shadow', 'twilight')).toBe('weak');
    expect(elementRelation(elements, 'twilight', 'shadow')).toBe('strong');
    // storm lists wind; earth lists storm.
    expect(elementRelation(elements, 'wind', 'storm')).toBe('weak');
    expect(elementRelation(elements, 'earth', 'storm')).toBe('strong');
  });

  it('is neutral when either side is unaligned', () => {
    expect(elementRelation(elements, undefined, 'fire')).toBe('neutral');
    expect(elementRelation(elements, 'fire', undefined)).toBe('neutral');
    expect(elementRelation(elements, undefined, undefined)).toBe('neutral');
  });
});

describe('elementMultiplier', () => {
  const pairs: Record<ElementRelation, [ElementId, ElementId]> = {
    strong: ['water', 'fire'],
    weak: ['fire', 'water'],
    same: ['earth', 'earth'],
    neutral: ['fire', 'shadow'],
  };
  const expected: Record<ElementRelation, [number, number, number]> = {
    strong: [1.5, 1.75, 2.0],
    weak: [0.6, 0.5, 0.4],
    same: [0.5, 0.25, 0],
    neutral: [1, 1, 1],
  };

  it('returns every table value for each relation and defender level', () => {
    for (const rel of Object.keys(pairs) as ElementRelation[]) {
      const [atk, def] = pairs[rel];
      for (const level of LEVELS) {
        expect(elementMultiplier(elements, atk, def, level), `${rel} Lv${level}`).toBe(expected[rel][level - 1]);
      }
    }
  });

  it('defaults to defender level 1', () => {
    expect(elementMultiplier(elements, 'water', 'fire')).toBe(1.5);
    expect(elementMultiplier(elements, 'fire', 'water')).toBe(0.6);
    expect(elementMultiplier(elements, 'fire', 'fire')).toBe(0.5);
  });

  it('is always 1.0 for unaligned attacks, at every level, against every element', () => {
    for (const def of [...elements.keys(), undefined]) {
      for (const level of LEVELS) expect(elementMultiplier(elements, undefined, def, level)).toBe(1);
    }
  });

  it('is 1.0 against unaligned defenders', () => {
    for (const atk of elements.keys()) expect(elementMultiplier(elements, atk, undefined, 3)).toBe(1);
  });

  it('applies the mutual-strong rule at every level', () => {
    for (const level of LEVELS) {
      expect(elementMultiplier(elements, 'holy', 'shadow', level)).toBe(expected.strong[level - 1]);
      expect(elementMultiplier(elements, 'shadow', 'holy', level)).toBe(expected.strong[level - 1]);
    }
  });
});

// ------------------------------------------------------------------ size

describe('SIZE_TABLE / sizeMultiplier', () => {
  const sizes: Size[] = ['S', 'M', 'L'];
  const rows: Record<WeaponType | 'heavy', [number, number, number]> = {
    dagger: [1.0, 0.85, 0.65],
    sword: [0.85, 1.0, 0.9],
    staff: [1.0, 1.0, 1.0],
    fists: [1.0, 0.95, 0.8],
    heavy: [0.7, 0.9, 1.15],
  };

  it('holds every spec value', () => {
    expect(SIZE_TABLE).toEqual({
      dagger: { S: 1.0, M: 0.85, L: 0.65 },
      sword: { S: 0.85, M: 1.0, L: 0.9 },
      staff: { S: 1.0, M: 1.0, L: 1.0 },
      fists: { S: 1.0, M: 0.95, L: 0.8 },
      heavy: { S: 0.7, M: 0.9, L: 1.15 },
    });
  });

  it("uses the weapon's row for ordinary skills", () => {
    const s = skill();
    for (const w of ['dagger', 'sword', 'staff'] as WeaponType[]) {
      sizes.forEach((size, i) => expect(sizeMultiplier(s, w, size), `${w} ${size}`).toBe(rows[w][i]));
    }
  });

  it('uses the heavy row regardless of weapon (or no weapon)', () => {
    const s = skill({ tags: ['blade', 'heavy'] });
    for (const w of ['dagger', 'sword', 'staff', undefined] as (WeaponType | undefined)[]) {
      sizes.forEach((size, i) => expect(sizeMultiplier(s, w, size), `${w} ${size}`).toBe(rows.heavy[i]));
    }
  });

  it('ignores size for arcane skills (including hybrids)', () => {
    for (const tags of [['arcane'], ['arcane', 'blade'], ['arcane', 'pierce']]) {
      const s = skill({ tags });
      for (const w of ['dagger', 'sword', 'staff'] as WeaponType[]) {
        for (const size of sizes) expect(sizeMultiplier(s, w, size)).toBe(1);
      }
    }
  });

  it('lets heavy take precedence over arcane', () => {
    const s = skill({ tags: ['arcane', 'heavy'] });
    sizes.forEach((size, i) => expect(sizeMultiplier(s, 'dagger', size)).toBe(rows.heavy[i]));
  });

  it('is 1.0 without a target size, or without a weapon for ordinary skills', () => {
    expect(sizeMultiplier(skill(), 'dagger')).toBe(1);
    expect(sizeMultiplier(skill({ tags: ['heavy'] }), 'sword')).toBe(1);
    for (const size of sizes) expect(sizeMultiplier(skill(), undefined, size)).toBe(1);
  });
});

// ------------------------------------------------------------------ combos

describe('comboFor', () => {
  it('Shatter: earth or magma on a frozen target, x1.75, consumes freeze', () => {
    for (const el of ['earth', 'magma'] as ElementId[]) {
      expect(comboFor(el, ['freeze'])).toEqual({ id: 'shatter', name: 'Shatter', mult: 1.75, consumes: 'freeze' });
    }
  });

  it('Conduct: lightning or storm on a soaked target, x1.5, consumes soak, +1 chain jump', () => {
    for (const el of ['lightning', 'storm'] as ElementId[]) {
      expect(comboFor(el, ['soak'])).toEqual({
        id: 'conduct',
        name: 'Conduct',
        mult: 1.5,
        consumes: 'soak',
        extraJump: true,
      });
    }
  });

  it('Fan the Flames: wind or storm on a burning target, x1.25, consumes burn, spreads burn', () => {
    for (const el of ['wind', 'storm'] as ElementId[]) {
      expect(comboFor(el, ['burn'])).toEqual({
        id: 'fan',
        name: 'Fan the Flames',
        mult: 1.25,
        consumes: 'burn',
        spreadBurn: true,
      });
    }
    expect(BURN_SPREAD_RADIUS).toBe(48);
  });

  it('finds the triggering status among others and names only that one to consume', () => {
    const statuses: StatusKind[] = ['slow', 'freeze', 'bleed'];
    const combo = comboFor('earth', statuses)!;
    expect(combo.consumes).toBe('freeze');
    expect(statuses.filter((s) => s !== combo.consumes)).toEqual(['slow', 'bleed']);
    expect(statuses).toEqual(['slow', 'freeze', 'bleed']);
  });

  it('prefers Conduct over Fan the Flames for storm on a soaked, burning target', () => {
    expect(comboFor('storm', ['burn', 'soak'])?.id).toBe('conduct');
    expect(comboFor('wind', ['burn', 'soak'])?.id).toBe('fan');
    expect(comboFor('lightning', ['burn', 'soak'])?.id).toBe('conduct');
  });

  it('returns null without a matching element/status pair', () => {
    expect(comboFor(undefined, ['freeze', 'soak', 'burn'])).toBeNull();
    expect(comboFor('fire', ['freeze', 'soak', 'burn'])).toBeNull();
    expect(comboFor('water', ['freeze', 'soak', 'burn'])).toBeNull();
    expect(comboFor('earth', ['soak', 'burn'])).toBeNull();
    expect(comboFor('lightning', ['freeze', 'burn'])).toBeNull();
    expect(comboFor('wind', ['freeze', 'soak'])).toBeNull();
    expect(comboFor('storm', [])).toBeNull();
    // The plain slow status is not a soak.
    expect(comboFor('lightning', ['slow'])).toBeNull();
  });

  it('returns a fresh object each call', () => {
    const a = comboFor('earth', ['freeze'])!;
    a.mult = 99;
    expect(comboFor('earth', ['freeze'])!.mult).toBe(1.75);
  });
});

// ------------------------------------------------------------------ damage

describe('isMagic / isHybrid', () => {
  it('classifies by tags', () => {
    expect(isMagic(skill({ tags: ['arcane'] }))).toBe(true);
    expect(isMagic(skill({ tags: ['blade'] }))).toBe(false);
    expect(isHybrid(skill({ tags: ['arcane', 'blade'] }))).toBe(true);
    expect(isHybrid(skill({ tags: ['arcane', 'pierce'] }))).toBe(true);
    expect(isHybrid(skill({ tags: ['arcane', 'spin'] }))).toBe(false);
    expect(isHybrid(skill({ tags: ['blade', 'pierce'] }))).toBe(false);
  });

  it('any-weapon skills tagged spirit, technique or echo are hybrids', () => {
    expect(HYBRID_TAGS).toEqual(['spirit', 'technique', 'echo', 'fist']);
    expect(isHybrid(skill({ tags: ['fist', 'melee'] }))).toBe(true);
    expect(isHybrid(skill({ tags: ['spirit', 'melee'] }))).toBe(true);
    expect(isHybrid(skill({ tags: ['melee', 'technique'] }))).toBe(true);
    expect(isHybrid(skill({ tags: ['echo', 'aoe'] }))).toBe(true);
    // A variant or merge keeps its base tags, so it stays hybrid.
    expect(isHybrid(skill({ tags: ['echo', 'projectile', 'water', 'infused'], generated: true }))).toBe(true);
    // Not magic: only arcane ignores size and forces MATK.
    expect(isMagic(skill({ tags: ['spirit'] }))).toBe(false);
    expect(isHybrid(skill({ tags: ['melee', 'heavy'] }))).toBe(false);
  });
});

describe('computeDamage', () => {
  it('stacks every factor in the spec order (worked example)', () => {
    // 100 atk * 1.5 power * rankPower(3)=1.12 * tag 1.10 * family 1.05 * status 1.20 * dagger vs M 0.85
    // * earth vs lightning Lv2 strong 1.75 * Shatter 1.75 * falloff 0.8 * variance 1.0 = 484.906 - def 10 => 475.
    const s = skill({ tags: ['pierce'], element: 'earth', power: 1.5 });
    const defender: Defender = { def: 10, element: 'lightning', elementLevel: 2, size: 'M', statuses: ['freeze'] };
    const mods = { tagPct: 10, familyPct: 5, statusPct: 20, falloff: 0.8 };
    const dagger: Attacker = { atk: 100, matk: 0, crit: 5, weapon: 'dagger' };

    const normal = computeDamage(elements, s, 3, dagger, defender, { ...mods, rng: rolls(0.99, 0.5) });
    expect(normal.amount).toBe(475);
    expect(normal.crit).toBe(false);
    expect(normal.multiplier).toBe(1.75);
    expect(normal.resisted).toBe(false);
    expect(normal.combo?.id).toBe('shatter');

    // Crit (first draw 0.0 < 5%): x1.5 and only half the defense => 727.359 - 5 => 722.
    const crit = computeDamage(elements, s, 3, dagger, defender, { ...mods, rng: rolls(0, 0.5) });
    expect(crit.amount).toBe(722);
    expect(crit.crit).toBe(true);
  });

  it('scales linearly with each percentage mod and falloff', () => {
    const s = skill();
    const d: Defender = { def: 0 };
    const at = (mods: DamageMods) => computeDamage(elements, s, 1, attacker, d, { ...mods, rng: flat() }).amount;
    expect(at({})).toBe(100);
    expect(at({ tagPct: 25 })).toBe(125);
    expect(at({ familyPct: 10 })).toBe(110);
    expect(at({ statusPct: -20 })).toBe(80);
    expect(at({ falloff: 0.5 })).toBe(50);
    expect(at({ tagPct: 100, familyPct: 50 })).toBe(300);
  });

  it('scales with rank via rankPower', () => {
    const s = skill();
    expect(computeDamage(elements, s, 1, attacker, { def: 0 }, { rng: flat() }).amount).toBe(100);
    expect(computeDamage(elements, s, 10, attacker, { def: 0 }, { rng: flat() }).amount).toBe(154);
  });

  it('uses ATK for physical, MATK for arcane and max(ATK, MATK) for hybrids', () => {
    const d: Defender = { def: 0 };
    const physical = skill({ tags: ['blade'] });
    const arcane = skill({ tags: ['arcane'] });
    const hybrid = skill({ tags: ['arcane', 'blade'] });
    const atkHeavy: Attacker = { atk: 100, matk: 40, crit: 0 };
    const matkHeavy: Attacker = { atk: 30, matk: 80, crit: 0 };
    expect(computeDamage(elements, physical, 1, atkHeavy, d, { rng: flat() }).amount).toBe(100);
    expect(computeDamage(elements, arcane, 1, atkHeavy, d, { rng: flat() }).amount).toBe(40);
    expect(computeDamage(elements, hybrid, 1, atkHeavy, d, { rng: flat() }).amount).toBe(100);
    expect(computeDamage(elements, hybrid, 1, matkHeavy, d, { rng: flat() }).amount).toBe(80);
  });

  it('spirit / technique / echo skills use max(ATK, MATK): a staff user is not crippled', () => {
    const d: Defender = { def: 0, size: 'L' };
    // Oak Staff stats (atk 3, matk 13) scaled up; a sword user for comparison.
    const staff: Attacker = { atk: 30, matk: 130, crit: 0, weapon: 'staff' };
    const sword: Attacker = { atk: 100, matk: 0, crit: 0, weapon: 'sword' };
    for (const tags of [['spirit', 'melee'], ['technique', 'melee'], ['echo', 'aoe']]) {
      const s = skill({ tags });
      expect(computeDamage(elements, s, 1, staff, d, { rng: flat() }).amount).toBe(130); // staff row L = 1.0
      expect(computeDamage(elements, s, 1, sword, d, { rng: flat() }).amount).toBe(90); // sword row L = 0.9
    }
    // A plain physical skill on the same staff still uses ATK.
    expect(computeDamage(elements, skill({ tags: ['melee'] }), 1, staff, d, { rng: flat() }).amount).toBe(30);
  });

  it('applies size from the attacker weapon and defender size', () => {
    const s = skill();
    const sword: Attacker = { ...attacker, weapon: 'sword' };
    expect(computeDamage(elements, s, 1, sword, { def: 0, size: 'S' }, { rng: flat() }).amount).toBe(85);
    const heavy = skill({ tags: ['heavy'] });
    expect(computeDamage(elements, heavy, 1, sword, { def: 0, size: 'L' }, { rng: flat() }).amount).toBe(115);
  });

  it('applies the element multiplier at the defender element level', () => {
    const s = skill({ element: 'fire' });
    const amount = (element: ElementId, elementLevel?: ElementLevel) =>
      computeDamage(elements, s, 1, attacker, { def: 0, element, elementLevel }, { rng: flat() });
    expect(amount('earth').amount).toBe(150);
    expect(amount('earth', 3).amount).toBe(200);
    expect(amount('water', 2).amount).toBe(50);
    expect(amount('fire', 2).amount).toBe(25);
    expect(amount('fire', 2).multiplier).toBe(0.25);
    expect(amount('shadow', 3).amount).toBe(100);
  });

  it('keeps unaligned attacks at x1.0 against any element and level', () => {
    const s = skill();
    for (const element of elements.keys()) {
      for (const elementLevel of LEVELS) {
        const roll = computeDamage(elements, s, 1, attacker, { def: 0, element, elementLevel }, { rng: flat() });
        expect(roll.amount).toBe(100);
        expect(roll.multiplier).toBe(1);
      }
    }
  });

  it('fully resists a same-element Lv3 defender: amount 0, resisted, no crit, no combo', () => {
    const s = skill({ element: 'earth', power: 50 });
    const d: Defender = { def: 0, element: 'earth', elementLevel: 3, statuses: ['freeze'] };
    let draws = 0;
    const rng = () => {
      draws++;
      return 0;
    };
    const roll = computeDamage(elements, s, 10, { atk: 9999, matk: 0, crit: 100 }, d, { rng, tagPct: 500 });
    expect(roll).toEqual({ amount: 0, crit: false, multiplier: 0, resisted: true, combo: null });
    expect(draws).toBe(0);
  });

  it('never resists a weak Lv3 hit: it still deals at least 1', () => {
    const s = skill({ element: 'fire', power: 0.01 });
    const roll = computeDamage(elements, s, 1, attacker, { def: 50, element: 'water', elementLevel: 3 }, { rng: flat() });
    expect(roll).toMatchObject({ amount: 1, resisted: false, multiplier: 0.4 });
  });

  it('applies combo multipliers and reports the combo', () => {
    const at = (element: ElementId, statuses: StatusKind[]) =>
      computeDamage(elements, skill({ element }), 1, attacker, { def: 0, statuses }, { rng: flat() });
    expect(at('magma', ['freeze'])).toMatchObject({ amount: 175, combo: { id: 'shatter', consumes: 'freeze' } });
    expect(at('lightning', ['soak'])).toMatchObject({ amount: 150, combo: { id: 'conduct', extraJump: true } });
    expect(at('wind', ['burn'])).toMatchObject({ amount: 125, combo: { id: 'fan', spreadBurn: true } });
    expect(at('fire', ['burn'])).toMatchObject({ amount: 100, combo: null });
    expect(computeDamage(elements, skill(), 1, attacker, { def: 0 }, { rng: flat() }).combo).toBeNull();
  });

  it('rolls crit from attacker.crit + skill.critBonus percent on the first draw', () => {
    const s = skill({ critBonus: 30 });
    const d: Defender = { def: 0 };
    const crit20: Attacker = { ...attacker, crit: 20 };
    expect(computeDamage(elements, s, 1, crit20, d, { rng: rolls(0.49, 0.5) }).crit).toBe(true);
    expect(computeDamage(elements, s, 1, crit20, d, { rng: rolls(0.5, 0.5) }).crit).toBe(false);
    expect(computeDamage(elements, skill(), 1, crit20, d, { rng: rolls(0.25, 0.5) }).crit).toBe(false);
    expect(computeDamage(elements, s, 1, crit20, d, { rng: rolls(0, 0.5) }).amount).toBe(150);
  });

  it('halves defense on a crit', () => {
    const s = skill();
    const d: Defender = { def: 40 };
    const sure: Attacker = { ...attacker, crit: 100 };
    expect(computeDamage(elements, s, 1, attacker, d, { rng: flat() }).amount).toBe(60);
    expect(computeDamage(elements, s, 1, sure, d, { rng: rolls(0, 0.5) }).amount).toBe(150 - 20);
  });

  it('draws variance in [0.9, 1.1) from the second roll', () => {
    const s = skill();
    expect(computeDamage(elements, s, 1, attacker, { def: 0 }, { rng: rolls(0.99, 0) }).amount).toBe(90);
    expect(computeDamage(elements, s, 1, attacker, { def: 0 }, { rng: rolls(0.99, 0.999999) }).amount).toBe(110);
  });

  it('never deals less than 1 when not resisted', () => {
    const roll = computeDamage(elements, skill(), 1, attacker, { def: 10000 }, { rng: flat() });
    expect(roll.amount).toBe(1);
    expect(roll.resisted).toBe(false);
  });

  it('varies deterministically without an rng', () => {
    const s = skill();
    const amounts = Array.from({ length: 40 }, () => computeDamage(elements, s, 1, attacker, { def: 0 }).amount);
    for (const a of amounts) {
      expect(a).toBeGreaterThanOrEqual(90);
      expect(a).toBeLessThanOrEqual(110);
    }
    expect(new Set(amounts).size).toBeGreaterThan(5);
  });
});
