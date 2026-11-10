// Class rotation simulation (SPEC-v4 §3.5): the core-only, deterministic harness that holds every class to one
// power band — AUTO within ±10% of the median of the four Commons, a manual script at most +25%.
//
// The first half tests the harness itself on four small classes written here (one per mechanic the Phase 1 classes
// use). The second half runs the real content: it switches on by itself once the data has kit classes and all
// four Commons (content lane, SPEC-v4 §15.2), and is the acceptance check "class-sim.test passes for them".
import { describe, expect, it } from 'vitest';
import { CLASS_SIM, monsterStats } from '../src/core/balance';
import { isKitClass } from '../src/core/classes';
import { Registry } from '../src/core/registry';
import { SIM, SIM_PACK, classSimBand, simulateClass, simulateClasses, type SimPolicy, type SimWeapon } from '../src/core/sim';
import type { ClassDefV4, ClassMechanic, ElementDef, GameData, SkillDef, WeaponType } from '../src/core/types';
import { createRegistry } from '../src/data';
import { WEAPONS } from '../src/data/weapons';

const SIM_WEAPONS = WEAPONS as Readonly<Record<WeaponType, SimWeapon>>;

// ------------------------------------------------------------------ a small fixture: four classes, one per weapon

const sk = (s: Pick<SkillDef, 'id' | 'shape' | 'tags'> & Partial<SkillDef>): SkillDef => ({
  name: s.id,
  desc: `${s.id}.`,
  icon: 'i',
  tier: 1,
  power: 1.2,
  spCost: 6,
  cooldown: 4000,
  maxRank: 5,
  ...s,
});
const strike = (range = 50, arc = 100): SkillDef['shape'] => ({ kind: 'strike', range, arc });

const kitOf = (cls: string, weapon: WeaponType, grip: string, n = 5, over: (i: number) => Partial<SkillDef> = () => ({})): SkillDef[] =>
  Array.from({ length: n }, (_, i) =>
    sk({ id: `${cls}_${i + 1}`, tags: [grip], weapons: [weapon], classOf: cls, shape: strike(), cooldown: 3000 + i * 500, ...over(i) }),
  );

const klass = (id: string, weapon: WeaponType, mechanic: ClassMechanic, extra: Partial<ClassDefV4> = {}): ClassDefV4 => ({
  id,
  name: id,
  icon: 'i',
  desc: `${id}.`,
  hint: `riddle of ${id}`,
  rarity: 'common',
  weapon,
  source: 'physical',
  mechanic,
  kit: [1, 2, 3, 4, 5].map((i) => `${id}_${i}`) as ClassDefV4['kit'],
  discover: { requires: [{ type: 'flag', id: `hits:${weapon}`, min: 60 }] },
  bonus: {},
  ...extra,
});

const CADENCE: ClassMechanic = { kind: 'combo', name: 'Cadence', length: 3, distinct: true, filter: { weapon: 'sword' }, finisher: { name: 'Finisher', boost: { crit: true, sizePct: 30 } }, autoRule: { spend: 'atMax' } };
const JUGGLE: ClassMechanic = {
  kind: 'gauge',
  name: 'Juggle',
  max: 5,
  fill: [{ on: 'hit', tag: 'throw', amount: 1 }],
  decay: { afterMs: 4000, perSec: 1000 },
  effects: [{ do: 'perPoint', filter: { tag: 'throw' }, boost: { powerPct: 3 } }, { do: 'threshold', at: 'max', filter: { tag: 'throw' }, boost: { pierce: 1 } }],
  autoRule: { spend: 'atMax' },
};
const WEAVE: ClassMechanic = { kind: 'combo', name: 'Weave', length: 4, distinct: true, filter: { weapon: 'staff' }, finisher: { name: 'Weave', boost: { free: true, sizePct: 50 } }, autoRule: { spend: 'atMax' } };
const ROAD: ClassMechanic = { kind: 'combo', name: 'Road Rhythm', length: 3, distinct: false, lead: 'basic', finisher: { name: 'Roadhouse', boost: { powerPct: 40, status: 'knockback' } }, autoRule: { spend: 'atMax' } };
const PINNED: ClassMechanic = { kind: 'marks', name: 'Pinned Shadow', max: 1, applyOn: 'skillTag', perMark: { store: 0.5, status: 'root', statusMs: 2000, lifeMs: 2000 }, spendWith: 'stalker_3', autoRule: { spend: 'atMax' } };
const HEARTH: ClassMechanic = {
  kind: 'zone',
  name: 'Hearth',
  object: 'hearth',
  max: 1,
  lifeMs: 0,
  levels: 5,
  placeWith: ['pyro_1'],
  consumeWith: 'pyro_2',
  perLevel: { powerPct: 20 },
  near: { tiles: 3, effects: [{ do: 'perPoint', stat: 'matk', pct: 3 }] },
  autoRule: { place: 'atFeet', keep: 1 },
};
const TIDE: ClassMechanic = { kind: 'stance', names: ['High Tide', 'Low Tide'], swap: { everyMs: 6000 }, remap: {}, boosts: [{ sizePct: 30 }, { powerPct: 25 }], autoRule: { swap: 'never' } };

const basic = (id: string, weapon: WeaponType, grip: string, shape: SkillDef['shape'] = strike()): SkillDef =>
  sk({ id, tier: 0, tags: [grip, 'basic'], weapons: [weapon], shape, power: 1, spCost: 0, cooldown: 0, maxRank: 10 });

const FIRE: ElementDef = { id: 'fire', name: 'Fire', prefix: 'Blazing', icon: 'f', color: 0, tier: 0, desc: '', status: 'burn', strongVs: [] };

const FIXTURE: GameData = {
  dataVersion: 2,
  elements: [FIRE],
  skills: [
    basic('slash', 'sword', 'blade'),
    basic('stab', 'dagger', 'pierce', strike(40, 60)),
    basic('bolt', 'staff', 'rod', { kind: 'projectile', speed: 400, range: 260 }),
    basic('jab', 'fists', 'fist', strike(36, 60)),
    ...kitOf('blade', 'sword', 'blade'),
    ...kitOf('juggler', 'dagger', 'pierce', 5, () => ({ tags: ['pierce', 'throw'], shape: { kind: 'projectile', speed: 400, range: 240 } })),
    ...kitOf('wright', 'staff', 'rod', 5, () => ({ tags: ['rod', 'arcane'], shape: { kind: 'projectile', speed: 400, range: 260 } })),
    ...kitOf('wayfarer', 'fists', 'fist'),
    ...kitOf('stalker', 'dagger', 'pierce', 5, (i) => (i === 0 ? { extra: 'mark' } : {})),
    ...kitOf('pyro', 'staff', 'rod', 5, (i) =>
      i === 0
        ? { tags: ['rod', 'arcane'], shape: { kind: 'zone', radius: 60, range: 0, durationMs: 4000, tickMs: 1000 }, power: 0.2, element: 'fire' }
        : { tags: ['rod', 'arcane'], shape: { kind: 'nova', radius: 70, range: 200 }, element: 'fire' },
    ),
    ...kitOf('tide', 'staff', 'rod', 5, (i) => ({ tags: ['rod', 'arcane'], shape: i === 1 ? { kind: 'shield', pct: 15, durationMs: 4000 } : i === 2 ? { kind: 'mend', pct: 20 } : { kind: 'projectile', speed: 400, range: 260 }, power: i === 1 || i === 2 ? 0 : 1.2 })),
  ],
  morphs: [],
  recipes: [],
  classes: [
    klass('blade', 'sword', CADENCE),
    klass('juggler', 'dagger', JUGGLE),
    klass('wright', 'staff', WEAVE),
    klass('wayfarer', 'fists', ROAD),
    klass('stalker', 'dagger', PINNED, { rarity: 'uncommon', source: 'shadow' }),
    klass('pyro', 'staff', HEARTH, { rarity: 'uncommon', source: 'fire', bonus: { matk: 4 } }),
    klass('tide', 'staff', TIDE, { rarity: 'uncommon', source: 'water' }),
  ],
  essences: [],
  passives: [],
  trainers: [],
  monsters: [],
  items: [],
};
const reg = new Registry(FIXTURE);
const cls = (id: string): ClassDefV4 => reg.classDef(id) as ClassDefV4;
const run = (id: string, over: Partial<Parameters<typeof simulateClass>[0]> = {}) =>
  simulateClass({ reg, cls: cls(id), weapon: SIM_WEAPONS[cls(id).weapon as WeaponType], ...over });

describe('the simulation harness', () => {
  it('the fixture is valid, and the standard fight is 60 s at level 10 against 1 elite + 4 commons', () => {
    expect(reg.validate({ grip: true })).toEqual([]);
    expect(CLASS_SIM).toEqual({ seconds: 60, level: 10, autoBand: 0.1, manualCap: 0.25 });
    expect(SIM_PACK).toEqual(['elite', 'common', 'common', 'common', 'common']);
    expect(monsterStats(CLASS_SIM.level, 'elite').hp).toBeGreaterThan(monsterStats(CLASS_SIM.level, 'common').hp);
  });

  it('is deterministic for a seed and differs between seeds', () => {
    const a = run('blade', { seed: 7 });
    expect(run('blade', { seed: 7 })).toEqual(a);
    expect(run('blade', { seed: 8 }).damage).not.toBe(a.damage);
    expect(a.seconds).toBe(60);
    expect(a.dps).toBeCloseTo(a.damage / 60, 10);
  });

  it('never changes the registry or the class it plays', () => {
    const before = JSON.stringify(FIXTURE);
    for (const c of reg.classes) run(c.id);
    expect(JSON.stringify(FIXTURE)).toBe(before);
  });

  it('a class deals more than its bare weapon, and longer fights deal more', () => {
    const bare = simulateClass({ reg, weapon: SIM_WEAPONS.sword });
    expect(Object.keys(bare.casts)).toEqual(['slash']);
    expect(bare.damage).toBeGreaterThan(0);
    expect(bare.mechanic).toBeNull();
    expect(run('blade').damage).toBeGreaterThan(bare.damage);
    expect(run('blade', { seconds: 120 }).damage).toBeGreaterThan(run('blade').damage * 1.6);
  });

  it('a class below level 6 plays only the kit it has unlocked', () => {
    const low = run('blade', { classLevel: 1 });
    expect(Object.keys(low.casts).sort()).toEqual(['blade_1', 'blade_2', 'slash']);
    expect(Object.keys(run('blade').casts).sort()).toEqual(['blade_1', 'blade_2', 'blade_3', 'blade_4', 'blade_5', 'slash']);
  });

  it('respects the weapon rule: a class skill for another weapon is never cast', () => {
    const wrong = simulateClass({ reg, cls: cls('blade'), weapon: SIM_WEAPONS.staff });
    expect(Object.keys(wrong.casts)).toEqual(['bolt']);
  });
});

describe('AUTO runs each mechanic by its rule', () => {
  it('combo (Cadence): finishers land, and nothing breaks the combo', () => {
    const r = run('blade');
    expect(r.effects.finisher).toBeGreaterThan(5);
    expect(r.effects.comboBreak ?? 0).toBe(0);
    expect(r.mechanic).toMatchObject({ kind: 'combo', name: 'Cadence' });
  });

  it('combo with a basic lead (Road Rhythm): jabs build it, a class skill cashes it', () => {
    const r = run('wayfarer');
    expect(r.effects.finisher).toBeGreaterThan(5);
    expect(r.casts.jab).toBeGreaterThan(r.effects.finisher! * 2 - 1);
    expect(r.effects.comboBreak ?? 0).toBe(0);
  });

  it('combo (Weave): every 4th spell is free', () => {
    const r = run('wright');
    expect(r.effects.finisher).toBeGreaterThan(3);
  });

  it('gauge (Juggle): fills from thrown hits and stays up', () => {
    const r = run('juggler');
    expect(r.effects.full).toBeGreaterThanOrEqual(1);
    expect(r.mechanic).toMatchObject({ kind: 'gauge', name: 'Juggle' });
  });

  it('marks (Pinned Shadow): pins, then cashes in or lets the pin end, paying the stored damage', () => {
    const r = run('stalker');
    expect(r.effects.marked).toBeGreaterThan(3);
    expect((r.effects.cashIn ?? 0) + (r.effects.markEnd ?? 0)).toBeGreaterThan(3);
  });

  it('zone (Hearth): keeps one up, feeds it with kills, and hurls it', () => {
    const r = run('pyro');
    expect(r.effects.placed).toBeGreaterThanOrEqual(1);
    expect(r.casts.pyro_1).toBe(r.effects.placed);
    expect(r.kills).toBeGreaterThan(0);
    expect(r.effects.levelUp).toBeGreaterThan(0);
    expect(r.effects.consumed).toBeGreaterThanOrEqual(1);
  });

  it('stance (Tide): turns by itself every 6 s; shields and heals are used when they make sense', () => {
    const r = run('tide');
    expect(r.effects.stance).toBe(10); // 6 s, 12 s, … 60 s
    expect(r.casts.tide_2).toBeGreaterThan(3); // the shield, whenever it is down
    expect(r.casts.tide_3 ?? 0).toBeLessThan(r.casts.tide_2); // the heal only below 60% HP
  });
});

describe('manual play', () => {
  it('the manual script never does worse than AUTO by much, and can pick where a boost lands', () => {
    for (const c of reg.classes) {
      const auto = run(c.id).damage;
      const manual = run(c.id, { policy: 'manual' }).damage;
      expect(manual, c.id).toBeGreaterThan(auto * 0.9);
    }
  });

  it('takes any policy: a script that only basic-attacks deals bare-weapon damage', () => {
    const idle: SimPolicy = () => null;
    const r = run('blade', { policy: idle });
    expect(Object.keys(r.casts)).toEqual(['slash']);
    const seen: number[] = [];
    const first: SimPolicy = (view) => {
      seen.push(view.castable.length);
      expect(view.hpPct).toBeGreaterThan(0);
      return view.castable[0]?.use.id ?? null;
    };
    expect(run('blade', { policy: first }).damage).toBeGreaterThan(r.damage);
    expect(Math.max(...seen)).toBe(5);
  });
});

describe('the band (classSimBand)', () => {
  it('judges every class against the median of the Commons', () => {
    const rows = [
      { id: 'a', rarity: 'common' as const, auto: 90, manual: 100 },
      { id: 'b', rarity: 'common' as const, auto: 100, manual: 120 },
      { id: 'c', rarity: 'common' as const, auto: 110, manual: 140 },
      { id: 'd', rarity: 'common' as const, auto: 120, manual: 125 },
      { id: 'e', rarity: 'epic' as const, auto: 116, manual: 131.25 },
      { id: 'f', rarity: 'rare' as const, auto: 94, manual: 132 },
    ];
    const band = classSimBand(rows);
    expect(band.median).toBe(105);
    const verdict = Object.fromEntries(band.rows.map((r) => [r.id, [r.autoOk, r.manualOk]]));
    expect(verdict).toEqual({
      a: [false, true], // 90 / 105 = −14%
      b: [true, true],
      c: [true, false], // manual +33%
      d: [false, true], // +14%
      e: [false, true], // +10.5% on AUTO; manual exactly +25%
      f: [false, false],
    });
    expect(band.rows[1]).toMatchObject({ autoRatio: 100 / 105, manualRatio: 120 / 105 });
    expect(classSimBand(rows.filter((r) => r.rarity !== 'common'))).toMatchObject({ median: 0 });
    expect(classSimBand([rows[0], rows[1], rows[2]]).median).toBe(100);
  });

  it('simulateClasses plays every kit class with the weapon of its row', () => {
    const rows = simulateClasses(reg, SIM_WEAPONS, { seconds: 20 });
    expect(rows.map((r) => r.id)).toEqual(reg.classes.map((c) => c.id));
    for (const r of rows) {
      expect(r.auto, r.id).toBeGreaterThan(0);
      expect(r.manual, r.id).toBeGreaterThan(0);
    }
    expect(rows.filter((r) => r.rarity === 'common')).toHaveLength(4);
  });

  it('uses the same numbers the game does', () => {
    expect(SIM.spRegenPct).toBe(2);
    expect(SIM.afterCastMs).toBe(250);
    expect(SIM.mendBelowPct).toBe(60);
  });
});

// ------------------------------------------------------------------ the real content

describe('the classes in src/data (SPEC-v4 §3.5)', () => {
  const real = createRegistry();
  const kitClasses = real.classes.filter(isKitClass);
  const commons = kitClasses.filter((c) => c.rarity === 'common');
  // Rebuilt classes have a mechanic of their own; legacy kits (a plain +20% combo, §3.7) are held to the band when
  // their phase rebuilds them.
  const ready = commons.length >= 4;

  it('says what it is checking', () => {
    expect(kitClasses.length).toBeLessThanOrEqual(real.classes.length);
    if (!ready) expect(commons.length).toBeLessThan(4); // until the content lane lands: nothing to judge yet
  });

  it.skipIf(!ready)('every class with a kit plays: AUTO lands hits and uses its class skills', () => {
    for (const c of kitClasses) {
      const weapon = SIM_WEAPONS[c.weapon === undefined || c.weapon === 'any' ? 'sword' : c.weapon];
      const r = simulateClass({ reg: real, cls: c, weapon });
      expect(r.damage, c.id).toBeGreaterThan(0);
      expect(Object.keys(r.casts).filter((id) => c.kit.includes(id)).length, `${c.id} casts its kit`).toBeGreaterThanOrEqual(3);
    }
  });

  it.skipIf(!ready)('AUTO lands within ±10% of the Common median; the manual script at most +25%', () => {
    const band = classSimBand(simulateClasses(real, SIM_WEAPONS));
    const judged = band.rows.filter((r) => real.classDef(r.id)?.passive !== undefined || r.rarity === 'common');
    const off = judged
      .filter((r) => !r.autoOk || !r.manualOk)
      .map((r) => `${r.id}: AUTO ${(r.autoRatio * 100).toFixed(0)}%, manual ${(r.manualRatio * 100).toFixed(0)}% of the Common median ${band.median.toFixed(0)}`);
    expect(off, off.join('\n')).toEqual([]);
  });
});
