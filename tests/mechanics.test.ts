// Class mechanics (SPEC-v4 §3.3, §3.6): each kind as a pure state machine — fills, decay, thresholds, spends, the
// combo buffer, mark cash-ins, stance remaps, zone objects — and its AUTO rule. The eight mechanics below are the
// Phase 1 classes' signatures written as data (the content lane authors the real ones the same way), and each test
// scripts how the mechanic changes what the bar does.
import { describe, expect, it } from 'vitest';
import {
  MECHANIC,
  autoAdvice,
  initMechanic,
  isEmptyBoost,
  mechanicProblems,
  mechanicStats,
  mechanicView,
  mergeBoost,
  previewBoost,
  resolveSkill,
  scaleBoost,
  skillLocked,
  skillUse,
  stepMechanic,
  useSkill,
  type MechanicEffect,
  type MechanicEvent,
  type MechanicState,
  type SkillUse,
} from '../src/core/mechanics';
import type { ClassMechanic, SkillDef, WeaponType } from '../src/core/types';

// ------------------------------------------------------------------ the eight Phase 1 mechanics, as data

/** Blademaster — Cadence: 3 different sword skills in a row make the 3rd a Finisher (always crits, +30% size). */
const CADENCE: ClassMechanic = {
  kind: 'combo',
  name: 'Cadence',
  length: 3,
  distinct: true,
  filter: { weapon: 'sword' },
  finisher: { name: 'Finisher', boost: { crit: true, sizePct: 30 } },
  autoRule: { spend: 'atMax' },
};

/** Spellwright — Weave: 3 different Rod spells in a row and the 4th is a Weave: free and 50% bigger. */
const WEAVE: ClassMechanic = {
  kind: 'combo',
  name: 'Weave',
  length: 4,
  distinct: true,
  filter: { weapon: 'staff' },
  finisher: { name: 'Weave', boost: { free: true, sizePct: 50 } },
  autoRule: { spend: 'atMax' },
};

/** Wayfarer — Road Rhythm: Jab, Jab, then any class skill makes that skill a Roadhouse hit. */
const ROAD_RHYTHM: ClassMechanic = {
  kind: 'combo',
  name: 'Road Rhythm',
  length: 3,
  distinct: false,
  lead: 'basic',
  finisher: { name: 'Roadhouse', boost: { sizePct: 40, status: 'knockback' } },
  autoRule: { spend: 'atMax' },
};

/** Pyroblade — Heat: +1 per sword hit (max 10), fades after 3 s idle; at 10 the next class skill costs HP and is twice the size. */
const HEAT: ClassMechanic = {
  kind: 'gauge',
  name: 'Heat',
  max: 10,
  fill: [{ on: 'hit', weapon: 'sword', amount: 1 }],
  decay: { afterMs: 3000, perSec: 2 },
  effects: [{ do: 'nextSkill', at: 'max', filter: { of: 'kit' }, boost: { hpCostPct: 6, sizePct: 100 } }],
  autoRule: { spend: 'atMax' },
};

/** Knife Juggler — Juggle: +1 per thrown knife that hits (max 5), lost after 4 s; +6% throw speed each; at 5 knives pierce. */
const JUGGLE: ClassMechanic = {
  kind: 'gauge',
  name: 'Juggle',
  max: 5,
  fill: [{ on: 'hit', tag: 'throw', amount: 1 }],
  decay: { afterMs: 4000, perSec: 1000 },
  effects: [
    { do: 'perPoint', filter: { tag: 'throw' }, boost: { speedPct: 6 } },
    { do: 'threshold', at: 'max', filter: { tag: 'throw' }, boost: { pierce: 1 } },
  ],
  autoRule: { spend: 'atMax' },
};

/** Shadowstalker — Pinned Shadow: pin a foe (root 2 s); half the damage dealt meanwhile lands when the pin ends. */
const PINNED: ClassMechanic = {
  kind: 'marks',
  name: 'Pinned Shadow',
  max: 1,
  applyOn: 'skillTag',
  perMark: { store: 0.5, status: 'root', statusMs: 2000, lifeMs: 2000 },
  spendWith: 'second_shadow',
  autoRule: { spend: 'atMax' },
};

/** Tidereader — Tide: turns by itself every 6 s; High Tide wide and pushing, Low Tide narrow, pulling, 25% harder. */
const TIDE: ClassMechanic = {
  kind: 'stance',
  names: ['High Tide', 'Low Tide'],
  swap: { everyMs: 6000 },
  remap: { tidal_hand: 'tidal_hand_low' },
  boosts: [{ sizePct: 30, status: 'knockback' }, { sizePct: -20, powerPct: 25, status: 'pull' }],
  autoRule: { swap: 'never' },
};

/** Pyromancer — Hearth: one Hearth; kills near it feed it (5 levels); +3% MATK per level near it; Hurl Hearth throws it. */
const HEARTH: ClassMechanic = {
  kind: 'zone',
  name: 'Hearth',
  object: 'hearth',
  max: 1,
  lifeMs: 0,
  levels: 5,
  placeWith: ['kindle_hearth'],
  consumeWith: 'hurl_hearth',
  perLevel: { sizePct: 20, powerPct: 20 },
  near: { tiles: 3, effects: [{ do: 'perPoint', stat: 'matk', pct: 3 }] },
  autoRule: { place: 'atFeet', keep: 1 },
};

// ------------------------------------------------------------------ helpers

function use(id: string, over: Partial<SkillUse> = {}): SkillUse {
  return { id, tags: [], kind: 'strike', basic: false, kit: true, ...over };
}
const sword = (id: string, over: Partial<SkillUse> = {}): SkillUse => use(id, { weapons: ['sword'], tags: ['blade'], ...over });
const rod = (id: string, over: Partial<SkillUse> = {}): SkillUse => use(id, { weapons: ['staff'], tags: ['rod'], ...over });
const slash = sword('slash', { basic: true, kit: false });
const jab = use('jab', { weapons: ['fists'], tags: ['fist', 'basic'], basic: true, kit: false });
const knife = (id: string): SkillUse => use(id, { weapons: ['dagger'], tags: ['pierce', 'throw'], kind: 'projectile' });

/** Runs a script of events / skill uses, collecting effects. */
class Run {
  state: MechanicState;
  effects: MechanicEffect[] = [];
  constructor(
    readonly m: ClassMechanic,
    readonly weapon: WeaponType = 'sword',
  ) {
    this.state = initMechanic(m);
  }
  ev(e: MechanicEvent): this {
    const out = stepMechanic(this.m, this.state, e);
    this.state = out.state;
    this.effects.push(...out.effects);
    return this;
  }
  tick(ms: number, extra: Partial<Extract<MechanicEvent, { type: 'tick' }>> = {}): this {
    for (let left = ms; left > 0; left -= 100) this.ev({ type: 'tick', dtMs: Math.min(100, left), ...extra });
    return this;
  }
  hit(u: SkillUse, target = 'a', damage = 0): this {
    return this.ev({ type: 'hit', use: u, weapon: this.weapon, target, damage });
  }
  cast(u: SkillUse, target?: string, nearLevel?: number | null) {
    const out = useSkill(this.m, this.state, u, { weapon: this.weapon, target, nearLevel });
    this.state = out.state;
    this.effects.push(...out.effects);
    return out;
  }
  kinds(): string[] {
    return this.effects.map((e) => e.type);
  }
  view() {
    return mechanicView(this.m, this.state)!;
  }
}

const frozen = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

// ------------------------------------------------------------------ the engine in general

describe('mechanic engine', () => {
  it('is pure: a step or a use never mutates the state it was given', () => {
    for (const m of [CADENCE, WEAVE, ROAD_RHYTHM, HEAT, JUGGLE, PINNED, TIDE, HEARTH]) {
      let state = initMechanic(m);
      const script: MechanicEvent[] = [
        { type: 'hit', use: sword('a', { tags: ['blade', 'throw', 'mark'] }), weapon: 'sword', target: 'x', damage: 10 },
        { type: 'tick', dtMs: 7000 },
        { type: 'kill', target: 'x', object: 1 },
        { type: 'swap' },
        { type: 'place' },
        { type: 'damageTaken', pct: 5 },
      ];
      for (const ev of script) {
        const before = frozen(state);
        const out = stepMechanic(m, state, ev);
        expect(state, `${m.kind} ${ev.type}`).toEqual(before);
        const used = useSkill(m, out.state, sword('k_a'), { weapon: 'sword' });
        expect(out.state).toEqual(stepMechanic(m, state, ev).state); // deterministic
        state = used.state;
      }
      expect(JSON.parse(JSON.stringify(state))).toEqual(state); // plain data
    }
  });

  it('no mechanic (and a form, until Phase 5) does nothing', () => {
    const form: ClassMechanic = { kind: 'form', gauge: HEAT as Extract<ClassMechanic, { kind: 'gauge' }>, formKit: ['a', 'b', 'c', 'd', 'e'], stages: [], aftermath: { name: 'Molt', ms: 5000, effects: [] } };
    for (const m of [undefined, form]) {
      expect(initMechanic(m)).toEqual({ kind: 'none' });
      expect(stepMechanic(m, { kind: 'none' }, { type: 'tick', dtMs: 100 })).toEqual({ state: { kind: 'none' }, effects: [] });
      expect(useSkill(m, { kind: 'none' }, slash, { weapon: 'sword' })).toEqual({ state: { kind: 'none' }, effects: [], boost: {}, locked: false });
      expect(mechanicView(m, { kind: 'none' })).toBeNull();
      expect(autoAdvice(m, { kind: 'none' }, { castable: [slash], weapon: 'sword', hpPct: 100 })).toEqual({ hold: [] });
    }
  });

  it('a state from another class is replaced by a fresh one', () => {
    const heat = new Run(HEAT);
    for (let i = 0; i < 4; i++) heat.hit(slash);
    const out = stepMechanic(CADENCE, heat.state, { type: 'tick', dtMs: 100 });
    expect(out.state).toEqual(initMechanic(CADENCE));
    expect(mechanicView(TIDE, heat.state)).toMatchObject({ kind: 'stance', name: 'High Tide' });
  });

  it('reset returns to the initial state', () => {
    for (const m of [CADENCE, HEAT, PINNED, TIDE, HEARTH]) {
      const r = new Run(m).hit(sword('a', { tags: ['mark'] })).ev({ type: 'place' }).tick(7000).ev({ type: 'reset' });
      expect(r.state).toEqual(initMechanic(m));
    }
  });

  it('boosts merge and scale', () => {
    expect(mergeBoost({ powerPct: 10, crit: true }, { powerPct: 5, sizePct: 30, free: true, hpCostPct: 4, repeat: 0.5 })).toEqual({
      powerPct: 15,
      sizePct: 30,
      crit: true,
      free: true,
      hpCostPct: 4,
      repeat: 0.5,
    });
    expect(scaleBoost({ powerPct: 8, pierce: 1, crit: true }, 3)).toEqual({ powerPct: 24, pierce: 3, crit: true });
    expect(scaleBoost({ powerPct: 8 }, 0)).toEqual({});
    expect(isEmptyBoost({})).toBe(true);
    expect(isEmptyBoost({ crit: true })).toBe(false);
  });

  it('skillUse reads kit membership, basics and the mark extra from the data', () => {
    const def = (over: Partial<SkillDef>): SkillDef => ({ id: 'x', name: 'X', desc: '', icon: 'i', tier: 1, tags: ['blade'], power: 1, spCost: 1, cooldown: 1, shape: { kind: 'strike', range: 40, arc: 90 }, maxRank: 5, ...over });
    const cls = { kit: ['x', 'b', 'c', 'd', 'e'] as [string, string, string, string, string] };
    expect(skillUse(cls, def({ weapons: ['sword'], element: 'fire' }))).toEqual({ id: 'x', tags: ['blade'], kind: 'strike', basic: false, kit: true, element: 'fire', weapons: ['sword'] });
    expect(skillUse(cls, def({ id: 'x@fire', baseId: 'x' })).kit).toBe(true);
    expect(skillUse(undefined, def({})).kit).toBe(false);
    expect(skillUse(cls, def({ id: 'slash', tier: 0, tags: ['blade', 'basic'] }))).toMatchObject({ basic: true, kit: false });
    expect(skillUse(cls, def({ extra: 'mark' })).tags).toEqual(['blade', MECHANIC.markTag]);
  });
});

// ------------------------------------------------------------------ gauge

describe('gauge: Heat (Pyroblade)', () => {
  it('fills by one per sword hit up to 10, announcing "full" once', () => {
    const r = new Run(HEAT);
    for (let i = 0; i < 9; i++) r.hit(slash);
    expect(r.view()).toMatchObject({ widget: 'bar', name: 'Heat', value: 9, max: 10, ready: false });
    expect(r.kinds()).toEqual([]);
    r.hit(slash).hit(slash).hit(slash);
    expect(r.view()).toMatchObject({ value: 10, ready: true });
    expect(r.effects).toEqual([{ type: 'full', name: 'Heat' }]);
  });

  it('only sword hits made with a sword count', () => {
    const r = new Run(HEAT);
    r.hit(use('ember_dart', { tags: ['spell'] })); // a free spell cast with a sword in hand
    r.hit(knife('knife_fan'));
    expect(r.view().value).toBe(0);
    const staff = new Run(HEAT, 'staff').hit(slash);
    expect(staff.view().value).toBe(0);
  });

  it('holds for 3 s, then fades at 2 a second; a hit stops the fade', () => {
    const r = new Run(HEAT);
    for (let i = 0; i < 6; i++) r.hit(slash);
    r.tick(3000);
    expect(r.view().value).toBe(6);
    r.tick(1000);
    expect((r.state as { value: number }).value).toBeCloseTo(4, 6);
    r.hit(slash).tick(2900);
    expect((r.state as { value: number }).value).toBeCloseTo(5, 6);
    r.tick(60_000);
    expect(r.view().value).toBe(0);
  });

  it('at 10 the next class skill costs HP instead of SP, is twice the size, and spends the gauge', () => {
    const r = new Run(HEAT);
    const cut = sword('bellows_cut');
    for (let i = 0; i < 9; i++) r.hit(slash);
    expect(r.cast(cut).boost).toEqual({});
    expect(r.view().value).toBe(9); // nothing spent below the threshold
    r.hit(slash);
    expect(previewBoost(HEAT, r.state, cut, { weapon: 'sword' })).toEqual({ hpCostPct: 6, sizePct: 100 });
    // Not a class skill: the boost waits.
    expect(r.cast(sword('whirlwind', { kit: false })).boost).toEqual({});
    expect(r.view().value).toBe(10);
    const out = r.cast(cut);
    expect(out.boost).toEqual({ hpCostPct: 6, sizePct: 100 });
    expect(out.effects).toEqual([{ type: 'spent', name: 'Heat', amount: 10, skill: 'bellows_cut' }]);
    expect(r.view()).toMatchObject({ value: 0, ready: false });
    expect(r.cast(cut).boost).toEqual({});
  });

  it('AUTO spends at max: it casts a class skill as soon as one is castable', () => {
    const r = new Run(HEAT);
    const view = { castable: [sword('whirlwind', { kit: false }), sword('bellows_cut'), sword('white_heat')], weapon: 'sword' as const, hpPct: 100 };
    for (let i = 0; i < 9; i++) r.hit(slash);
    expect(autoAdvice(HEAT, r.state, view)).toEqual({ hold: [] });
    r.hit(slash);
    expect(autoAdvice(HEAT, r.state, view)).toEqual({ do: { type: 'cast', skill: 'bellows_cut' }, hold: [] });
    expect(autoAdvice(HEAT, r.state, { ...view, castable: [view.castable[0]] })).toEqual({ hold: [] });
  });
});

describe('gauge: Juggle (Knife Juggler)', () => {
  it('each point speeds throws up by 6%; at 5 knives pierce; nothing is spent', () => {
    const r = new Run(JUGGLE, 'dagger');
    const cascade = knife('cascade');
    r.hit(cascade).hit(cascade).hit(use('stab', { basic: true, kit: false, weapons: ['dagger'], tags: ['pierce'] }));
    expect(r.view().value).toBe(2);
    expect(r.cast(cascade).boost).toEqual({ speedPct: 12 });
    expect(r.cast(use('smoke_veil', { tags: ['stealth'] })).boost).toEqual({});
    r.hit(cascade).hit(cascade).hit(cascade).hit(cascade);
    expect(r.view()).toMatchObject({ value: 5, ready: true });
    expect(r.cast(cascade).boost).toEqual({ speedPct: 30, pierce: 1 });
    expect(r.view().value).toBe(5);
  });

  it('is lost after 4 s without a throw landing', () => {
    const r = new Run(JUGGLE, 'dagger');
    for (let i = 0; i < 5; i++) r.hit(knife('cascade'));
    r.tick(3900);
    expect(r.view().value).toBe(5);
    r.tick(200);
    expect(r.view().value).toBe(0);
  });
});

describe('gauge: every fill, the closed set of effects', () => {
  const gauge = (over: Partial<Extract<ClassMechanic, { kind: 'gauge' }>>): ClassMechanic => ({ kind: 'gauge', name: 'G', max: 100, fill: [], effects: [], autoRule: { spend: 'atMax' }, ...over });
  const value = (r: Run): number => (r.state as { value: number }).value;

  it('hitDistinct counts each different foe once per window (Stormwhirl)', () => {
    const r = new Run(gauge({ max: 6, fill: [{ on: 'hitDistinct', windowMs: 3000, amount: 1 }] }));
    r.hit(slash, 'a').hit(slash, 'a').hit(slash, 'b');
    expect(value(r)).toBe(2);
    r.tick(2000).hit(slash, 'a'); // still inside a's window
    expect(value(r)).toBe(2);
    r.tick(3100).hit(slash, 'a');
    expect(value(r)).toBe(3);
  });

  it('kills, damage taken, damage prevented, HP spent and pickups', () => {
    const r = new Run(
      gauge({
        fill: [
          { on: 'kill', amount: 5 },
          { on: 'kill', lowHpBelow: 30, amount: 10 },
          { on: 'damageTaken', perPct: 2 },
          { on: 'prevented', perPct: 3 },
          { on: 'hpSpent', perPct: 1 },
          { on: 'pickup', item: 'ember', amount: 4 },
        ],
      }),
    );
    r.ev({ type: 'kill', target: 'a', hpPct: 80 });
    expect(value(r)).toBe(5);
    r.ev({ type: 'kill', target: 'b', hpPct: 20 });
    expect(value(r)).toBe(20);
    r.ev({ type: 'damageTaken', pct: 5 }).ev({ type: 'prevented', pct: 5 }).ev({ type: 'hpSpent', pct: 5 }).ev({ type: 'pickup', item: 'ember' });
    expect(value(r)).toBe(20 + 10 + 15 + 5 + 4);
    r.ev({ type: 'damageTaken', pct: 1000 });
    expect(value(r)).toBe(100);
  });

  it('time, standing still, not attacking and walking; a negative fill drains (Tidefencer, Archmage, Slag)', () => {
    const flow = new Run(gauge({ max: 8, fill: [{ on: 'move', perTile: 1 }, { on: 'still', perSec: -2 }] }));
    flow.ev({ type: 'tick', dtMs: 1000, moving: true, tiles: 5 });
    expect(value(flow)).toBe(5);
    flow.ev({ type: 'tick', dtMs: 1000, moving: false });
    expect(value(flow)).toBe(3);
    flow.ev({ type: 'tick', dtMs: 5000, moving: false });
    expect(value(flow)).toBe(0);

    const reservoir = new Run(gauge({ fill: [{ on: 'idleAttack', perSec: 10 }] }));
    reservoir.ev({ type: 'tick', dtMs: 2000, attacking: true }).ev({ type: 'tick', dtMs: 3000, attacking: false });
    expect(value(reservoir)).toBe(30);

    const slag = new Run(gauge({ max: 10, fill: [{ on: 'time', perSec: 1 }] }));
    slag.ev({ type: 'tick', dtMs: 4000, inCombat: false }).ev({ type: 'tick', dtMs: 4000 });
    expect(value(slag)).toBe(4);
  });

  it('casts: by tag, by element, and alternating two elements (Twilight Sage, Eclipse Walker)', () => {
    const holy = use('dawn', { element: 'holy', tags: ['spell'] });
    const shadow = use('dusk', { element: 'shadow', tags: ['spell'] });
    const tagged = new Run(gauge({ fill: [{ on: 'cast', tag: 'spell', amount: 1 }, { on: 'cast', element: 'holy', amount: 10 }] }));
    tagged.cast(holy);
    tagged.cast(shadow);
    tagged.cast(sword('cut'));
    tagged.cast(use('bolt', { basic: true, kit: false, tags: ['spell'] })); // basic attacks are not casts
    expect(value(tagged)).toBe(12);

    const gloaming = new Run(gauge({ max: 4, fill: [{ on: 'cast', alternate: ['holy', 'shadow'], amount: 1 }] }));
    gloaming.cast(holy);
    gloaming.cast(holy);
    gloaming.cast(shadow);
    gloaming.cast(use('ember', { element: 'fire' }));
    gloaming.cast(holy);
    expect(value(gloaming)).toBe(3);
  });

  it('an open-ended gauge (max null) never fills up', () => {
    const r = new Run(gauge({ max: null, fill: [{ on: 'hit', amount: 7 }] }));
    for (let i = 0; i < 100; i++) r.hit(slash);
    expect(value(r)).toBe(700);
    expect(r.kinds()).toEqual([]);
    expect(r.view().max).toBeNull();
  });

  it('spendAll: a class skill drinks the whole gauge for a per-point bonus (Tidefencer)', () => {
    const m = gauge({ max: 8, fill: [{ on: 'move', perTile: 1 }], effects: [{ do: 'spendAll', filter: { of: 'kit' }, perPoint: { powerPct: 8 } }], autoRule: { spend: 'atPct', pct: 50 } });
    const r = new Run(m).ev({ type: 'tick', dtMs: 100, tiles: 3.5 });
    expect(r.cast(sword('whirlwind', { kit: false })).boost).toEqual({});
    // AUTO waits for half a meter before letting a class skill drink it.
    const view = { castable: [sword('running_cut')], weapon: 'sword' as const, hpPct: 100 };
    expect(autoAdvice(m, r.state, view)).toEqual({ hold: ['running_cut'] });
    r.ev({ type: 'tick', dtMs: 100, tiles: 1 });
    expect(autoAdvice(m, r.state, view)).toEqual({ do: { type: 'cast', skill: 'running_cut' }, hold: [] });
    const out = r.cast(sword('running_cut'));
    expect(out.boost).toEqual({ powerPct: 32 });
    expect(out.effects).toEqual([{ type: 'spent', name: 'G', amount: 4.5, skill: 'running_cut' }]);
    expect(value(r)).toBe(0);
  });

  it('unlock: a kit skill is locked until the gauge is there, then spends it (Oathsworn, Moonwarden)', () => {
    const m = gauge({ fill: [{ on: 'damageTaken', perPct: 10 }], effects: [{ do: 'unlock', at: 'max', skill: 'dawn_verdict' }] });
    const r = new Run(m).ev({ type: 'damageTaken', pct: 9 });
    expect(skillLocked(m, r.state, 'dawn_verdict')).toBe(true);
    expect(skillLocked(m, r.state, 'hallowed_cut')).toBe(false);
    const refused = r.cast(sword('dawn_verdict'));
    expect(refused).toMatchObject({ locked: true, boost: {}, effects: [] });
    expect(value(r)).toBe(90);
    expect(autoAdvice(m, r.state, { castable: [sword('hallowed_cut')], weapon: 'sword', hpPct: 50 })).toEqual({ hold: ['dawn_verdict'] });
    r.ev({ type: 'damageTaken', pct: 1 });
    expect(skillLocked(m, r.state, 'dawn_verdict')).toBe(false);
    expect(r.view().ready).toBe(true);
    expect(autoAdvice(m, r.state, { castable: [sword('hallowed_cut'), sword('dawn_verdict')], weapon: 'sword', hpPct: 50 }).do).toEqual({ type: 'cast', skill: 'dawn_verdict' });
    expect(r.cast(sword('dawn_verdict')).locked).toBe(false);
    expect(value(r)).toBe(0);
  });

  it('perPoint and threshold stats (Magma Knight: +4% damage and size, −2% attack speed per point)', () => {
    const m = gauge({
      max: 10,
      fill: [{ on: 'time', perSec: 1 }],
      effects: [
        { do: 'perPoint', stat: 'damage', pct: 4 },
        { do: 'perPoint', stat: 'size', pct: 4 },
        { do: 'perPoint', stat: 'attackSpeed', pct: -2 },
        { do: 'threshold', at: 8, stat: { stat: 'def', pct: 10 } },
      ],
    });
    const r = new Run(m).tick(5500);
    expect(mechanicStats(m, r.state)).toEqual({ damage: 20, size: 20, attackSpeed: -10 });
    r.tick(3000);
    expect(mechanicStats(m, r.state)).toEqual({ damage: 32, size: 32, attackSpeed: -16, def: 10 });
    expect(mechanicStats(undefined, r.state)).toEqual({});
  });
});

// ------------------------------------------------------------------ combo

describe('combo: Cadence (Blademaster)', () => {
  const [a, b, c, d] = ['three_beat_cut', 'turning_edge', 'closing_step', 'last_word'].map((id) => sword(id));

  it('3 different sword skills in a row: the 3rd is the Finisher, then the count starts over', () => {
    const r = new Run(CADENCE);
    expect(r.cast(a).boost).toEqual({});
    expect(r.view()).toMatchObject({ widget: 'pips', name: 'Cadence', value: 1, max: 2, ready: false });
    expect(r.cast(b).boost).toEqual({});
    expect(r.view()).toMatchObject({ value: 2, ready: true });
    expect(previewBoost(CADENCE, r.state, c, { weapon: 'sword' })).toEqual({ crit: true, sizePct: 30 });
    const fin = r.cast(c);
    expect(fin.boost).toEqual({ crit: true, sizePct: 30 });
    expect(fin.effects).toEqual([{ type: 'finisher', name: 'Finisher', skill: 'closing_step' }]);
    expect(r.view()).toMatchObject({ value: 0, ready: false });
    expect(r.kinds()).toEqual(['comboStep', 'comboStep', 'finisher']);
    expect(r.cast(d).boost).toEqual({});
  });

  it('the player chooses which skill lands as the Finisher', () => {
    for (const last of [c, d]) {
      const r = new Run(CADENCE);
      r.cast(a);
      r.cast(b);
      expect(r.cast(last).effects).toEqual([{ type: 'finisher', name: 'Finisher', skill: last.id }]);
    }
  });

  it('a repeat restarts the count from that skill; basic attacks neither count nor break', () => {
    const r = new Run(CADENCE);
    r.cast(a);
    r.cast(slash);
    r.cast(b);
    expect(r.view().value).toBe(2);
    expect(r.cast(a).boost).toEqual({}); // a again: not three different
    expect(r.view().value).toBe(1);
    expect(r.kinds()).toEqual(['comboStep', 'comboStep', 'comboBreak', 'comboStep']);
  });

  it('a skill that is not a sword skill breaks it, and so does waiting too long', () => {
    const r = new Run(CADENCE);
    r.cast(a);
    r.cast(use('ember_dart', { kit: false, tags: ['spell'] }));
    expect(r.view().value).toBe(0);
    r.cast(a);
    r.cast(b);
    r.tick(MECHANIC.comboWindowMs);
    expect(r.view().ready).toBe(true);
    r.tick(100);
    expect(r.view().value).toBe(0);
    expect(r.kinds().filter((k) => k === 'comboBreak')).toHaveLength(2);
    expect(r.cast(c).boost).toEqual({});
  });

  it('AUTO plays the shortest legal sequence: the first castable skill that advances, never one that breaks', () => {
    const r = new Run(CADENCE);
    const dart = use('ember_dart', { kit: false, tags: ['spell'] });
    const view = (castable: SkillUse[]) => ({ castable, weapon: 'sword' as const, hpPct: 100 });
    expect(autoAdvice(CADENCE, r.state, view([dart, a, b]))).toEqual({ do: { type: 'cast', skill: 'three_beat_cut' }, hold: [] });
    r.cast(a);
    expect(autoAdvice(CADENCE, r.state, view([a, dart, b, c]))).toEqual({ do: { type: 'cast', skill: 'turning_edge' }, hold: ['three_beat_cut', 'ember_dart'] });
    r.cast(b);
    // The finisher is whatever comes first, not the best one.
    expect(autoAdvice(CADENCE, r.state, view([c, d])).do).toEqual({ type: 'cast', skill: 'closing_step' });
    expect(autoAdvice(CADENCE, r.state, view([a, b]))).toEqual({ hold: ['three_beat_cut', 'turning_edge'] });
  });
});

describe('combo: Weave (Spellwright)', () => {
  it('3 different Rod spells, and the 4th is a Weave: free and 50% bigger', () => {
    const r = new Run(WEAVE, 'staff');
    const spells = ['thread_bolt', 'loom', 'knot', 'unravel'].map((id) => rod(id));
    for (const s of spells.slice(0, 3)) expect(r.cast(s).boost).toEqual({});
    expect(r.view()).toMatchObject({ value: 3, max: 3, ready: true });
    expect(r.cast(spells[3])).toMatchObject({ boost: { free: true, sizePct: 50 }, effects: [{ type: 'finisher', name: 'Weave', skill: 'unravel' }] });
    // A sword skill is not a Rod spell.
    r.cast(spells[0]);
    r.cast(sword('whirlwind', { kit: false }));
    expect(r.view().value).toBe(0);
  });
});

describe('combo: Road Rhythm (Wayfarer)', () => {
  const roadhouse = use('roadhouse', { weapons: ['fists'], tags: ['fist'] });

  it('Jab, Jab, then any class skill makes that skill a Roadhouse hit', () => {
    const r = new Run(ROAD_RHYTHM, 'fists');
    r.cast(jab);
    expect(r.view()).toMatchObject({ value: 1, max: 2, ready: false });
    r.cast(jab);
    expect(r.view().ready).toBe(true);
    r.cast(jab); // a third jab keeps it ready
    expect(r.view()).toMatchObject({ value: 2, ready: true });
    const out = r.cast(roadhouse);
    expect(out.boost).toEqual({ sizePct: 40, status: 'knockback' });
    expect(out.effects).toEqual([{ type: 'finisher', name: 'Roadhouse', skill: 'roadhouse' }]);
    expect(r.view().value).toBe(0);
  });

  it('a class skill thrown too early, or any other skill, breaks the rhythm', () => {
    const r = new Run(ROAD_RHYTHM, 'fists');
    r.cast(jab);
    expect(r.cast(roadhouse).boost).toEqual({});
    expect(r.view().value).toBe(0);
    r.cast(jab);
    r.cast(jab);
    r.cast(use('quickstep', { kit: false, tags: ['mobility'] }));
    expect(r.cast(roadhouse).boost).toEqual({});
  });

  it('AUTO jabs until the rhythm is ready, then throws the first class skill', () => {
    const r = new Run(ROAD_RHYTHM, 'fists');
    const view = { castable: [roadhouse, use('dust_kick'), use('quickstep', { kit: false })], weapon: 'fists' as const, hpPct: 100 };
    expect(autoAdvice(ROAD_RHYTHM, r.state, view)).toEqual({ do: { type: 'basic' }, hold: ['roadhouse', 'dust_kick', 'quickstep'] });
    r.cast(jab);
    r.cast(jab);
    expect(autoAdvice(ROAD_RHYTHM, r.state, view)).toEqual({ do: { type: 'cast', skill: 'roadhouse' }, hold: [] });
  });
});

// ------------------------------------------------------------------ marks

describe('marks: Pinned Shadow (Shadowstalker)', () => {
  const pin = knife('shadow_pin');
  const pinUse: SkillUse = { ...pin, tags: [...pin.tags, 'mark'] };
  const stab = use('stab', { basic: true, kit: false, weapons: ['dagger'], tags: ['pierce', 'basic'] });
  const cash = use('second_shadow', { weapons: ['dagger'], tags: ['pierce'], kind: 'blink' });

  it('a marking skill pins the foe (root 2 s); half the damage dealt meanwhile is stored and lands when the pin ends', () => {
    const r = new Run(PINNED, 'dagger');
    r.hit(stab, 'a', 100); // not pinned yet: nothing stored
    r.hit(pinUse, 'a', 40);
    expect(r.effects).toEqual([{ type: 'marked', name: 'Pinned Shadow', target: 'a', marks: 1, status: 'root', statusMs: 2000 }]);
    expect(mechanicView(PINNED, r.state, 'a')).toMatchObject({ widget: 'pips', value: 1, max: 1, ready: true });
    expect(mechanicView(PINNED, r.state, 'b')!.value).toBe(0);
    r.hit(stab, 'a', 100).hit(stab, 'a', 60).hit(stab, 'b', 500);
    r.tick(1900);
    expect(r.kinds()).toEqual(['marked']);
    r.tick(100);
    expect(r.effects.at(-1)).toEqual({ type: 'markEnd', name: 'Pinned Shadow', target: 'a', stored: 80 });
    expect(r.view().value).toBe(0);
  });

  it('the cash-in skill ends the pin at once and pays the stored damage', () => {
    const r = new Run(PINNED, 'dagger');
    expect(r.cast(cash, 'a')).toMatchObject({ boost: {}, effects: [] }); // nothing pinned: an ordinary blink
    r.hit(pinUse, 'a', 40).hit(stab, 'a', 100);
    const out = r.cast(cash, 'a');
    expect(out.effects).toEqual([{ type: 'cashIn', name: 'Pinned Shadow', skill: 'second_shadow', targets: [{ target: 'a', marks: 1, powerPct: 0, stored: 50 }], resetCooldown: false }]);
    r.hit(cash, 'a', 30); // the cash-in's own hit never re-pins
    expect(r.view().value).toBe(0);
    r.tick(5000);
    expect(r.kinds().filter((k) => k === 'markEnd')).toEqual([]);
  });

  it('a dead or departed foe takes its pin with it', () => {
    const r = new Run(PINNED, 'dagger').hit(pinUse, 'a', 10).hit(pinUse, 'b', 10);
    r.ev({ type: 'kill', target: 'a' }).ev({ type: 'gone', target: 'b' }).tick(3000);
    expect(r.kinds()).toEqual(['marked', 'marked']);
  });

  it('AUTO cashes in at max marks and holds the cash-in until then', () => {
    const r = new Run(PINNED, 'dagger');
    const view = { castable: [pinUse, cash], weapon: 'dagger' as const, hpPct: 100 };
    expect(autoAdvice(PINNED, r.state, view)).toEqual({ hold: ['second_shadow'] });
    r.hit(pinUse, 'a', 10);
    expect(autoAdvice(PINNED, r.state, view)).toEqual({ do: { type: 'cast', skill: 'second_shadow' }, hold: [] });
    expect(autoAdvice(PINNED, r.state, { ...view, castable: [pinUse] })).toEqual({ hold: ['second_shadow'] });
  });
});

describe('marks: the other ways to mark', () => {
  const marks = (over: Partial<Extract<ClassMechanic, { kind: 'marks' }>>): ClassMechanic => ({ kind: 'marks', name: 'M', max: 3, applyOn: 'weaponHit', perMark: { powerPct: 35 }, spendWith: 'quietus', autoRule: { spend: 'atMax' }, ...over });
  const stab = use('stab', { basic: true, kit: false, weapons: ['dagger'], tags: ['pierce', 'basic'] });
  const quietus = use('quietus', { weapons: ['dagger'], tags: ['pierce'] });

  it('weaponHit: every hit of a skill bound to the held weapon marks, up to max (Windblade)', () => {
    const m = marks({});
    const r = new Run(m, 'dagger');
    r.hit(stab).hit(stab).hit(use('ember_dart', { tags: ['spell'] })).hit(stab).hit(stab);
    expect(r.view()).toMatchObject({ value: 3, ready: true });
    expect(r.kinds()).toEqual(['marked', 'marked', 'marked']);
  });

  it('cash-in: +35% per mark on the target, and the cooldown resets at max marks (Hushblade)', () => {
    const m = marks({ applyOn: 'opening', perMark: { powerPct: 35, resetAtMax: true } });
    const r = new Run(m, 'dagger');
    r.hit(stab, 'a'); // no Opening shown: no mark
    expect(r.view().value).toBe(0);
    for (let i = 0; i < 2; i++) r.ev({ type: 'opening', target: 'a' }).hit(stab, 'a').hit(stab, 'a'); // one mark per Opening
    r.ev({ type: 'opening', target: 'b' }).tick(MECHANIC.openingMs).hit(stab, 'b'); // too late
    expect(mechanicView(m, r.state, 'a')!.value).toBe(2);
    expect(mechanicView(m, r.state, 'b')!.value).toBe(0);
    const two = useSkill(m, r.state, quietus, { weapon: 'dagger', target: 'a' });
    expect(two.boost).toEqual({ powerPct: 70 });
    expect(two.effects[0]).toMatchObject({ type: 'cashIn', resetCooldown: false, targets: [{ target: 'a', marks: 2, powerPct: 70, stored: 0 }] });
    r.ev({ type: 'opening', target: 'a' }).hit(stab, 'a');
    const three = r.cast(quietus, 'a');
    expect(three.boost).toEqual({ powerPct: 105 });
    expect(three.effects[0]).toMatchObject({ type: 'cashIn', resetCooldown: true });
    expect(r.view().value).toBe(0);
  });

  it('launch: hits on an airborne foe mark it; AUTO can cash in early by rule', () => {
    const m = marks({ applyOn: 'launch', autoRule: { spend: 'atPct', pct: 60 } });
    let state = initMechanic(m);
    state = stepMechanic(m, state, { type: 'hit', use: stab, weapon: 'dagger', target: 'a', statuses: ['slow'] }).state;
    expect(mechanicView(m, state)!.value).toBe(0);
    state = stepMechanic(m, state, { type: 'hit', use: stab, weapon: 'dagger', target: 'a', statuses: ['launch'] }).state;
    const view = { castable: [quietus], weapon: 'dagger' as const, hpPct: 100 };
    expect(autoAdvice(m, state, view).do).toBeUndefined(); // 1 of 3: below 60%
    state = stepMechanic(m, state, { type: 'hit', use: stab, weapon: 'dagger', target: 'a', statuses: ['launch'] }).state;
    expect(autoAdvice(m, state, view).do).toEqual({ type: 'cast', skill: 'quietus' }); // 2 of 3
  });
});

// ------------------------------------------------------------------ stance

describe('stance: Tide (Tidereader)', () => {
  it('turns by itself every 6 s; the button does nothing', () => {
    const r = new Run(TIDE, 'staff');
    expect(r.view()).toMatchObject({ widget: 'sides', name: 'High Tide', stance: 0 });
    r.ev({ type: 'swap' }).tick(5900);
    expect(r.view().stance).toBe(0);
    r.tick(100);
    expect(r.view()).toMatchObject({ name: 'Low Tide', stance: 1 });
    expect(r.effects).toEqual([{ type: 'stance', stance: 1, name: 'Low Tide' }]);
    r.tick(6000);
    expect(r.view().stance).toBe(0);
    r.tick(60_000);
    expect(r.kinds().filter((k) => k === 'stance')).toHaveLength(12);
  });

  it('the bar changes with the tide: class skills are wide and push, then narrow, pull and hit 25% harder', () => {
    const r = new Run(TIDE, 'staff');
    const hand = rod('tidal_hand');
    expect(resolveSkill(TIDE, r.state, 'tidal_hand')).toBe('tidal_hand');
    expect(r.cast(hand).boost).toEqual({ sizePct: 30, status: 'knockback' });
    expect(r.cast(rod('firebolt', { kit: false })).boost).toEqual({});
    r.tick(6000);
    expect(resolveSkill(TIDE, r.state, 'tidal_hand')).toBe('tidal_hand_low'); // remapped in Low Tide
    expect(resolveSkill(TIDE, r.state, 'undertow')).toBe('undertow'); // unlisted: unchanged
    expect(r.cast(hand).boost).toEqual({ sizePct: -20, powerPct: 25, status: 'pull' });
    expect(autoAdvice(TIDE, r.state, { castable: [hand], weapon: 'staff', hpPct: 10 })).toEqual({ hold: [] });
  });
});

describe('stance: tap and hold', () => {
  const steel: ClassMechanic = { kind: 'stance', names: ['Steel', 'Spell'], swap: 'tap', remap: { runic_blade: 'runic_blade_spell' }, lockMs: 1000, autoRule: { swap: 'hpBelow', pct: 40 } };

  it('one tap swaps, not faster than the lock; AUTO swaps by HP', () => {
    const r = new Run(steel);
    r.tick(500).ev({ type: 'swap' });
    expect(r.view().stance).toBe(0); // still locked
    r.tick(500).ev({ type: 'swap' });
    expect(r.view()).toMatchObject({ stance: 1, name: 'Spell' });
    expect(resolveSkill(steel, r.state, 'runic_blade')).toBe('runic_blade_spell');
    expect(resolveSkill(steel, initMechanic(steel), 'runic_blade')).toBe('runic_blade');
    const view = (hpPct: number) => ({ castable: [], weapon: 'sword' as const, hpPct });
    expect(autoAdvice(steel, r.state, view(30))).toEqual({ hold: [] }); // already in the low-HP stance
    r.tick(1000);
    expect(autoAdvice(steel, r.state, view(80))).toEqual({ do: { type: 'swap' }, hold: [] });
    r.ev({ type: 'swap' });
    expect(autoAdvice(steel, r.state, view(30))).toEqual({ hold: [] }); // locked for a second
    r.tick(1000);
    expect(autoAdvice(steel, r.state, view(30))).toEqual({ do: { type: 'swap' }, hold: [] });
    const never: ClassMechanic = { ...steel, autoRule: { swap: 'never' } };
    expect(autoAdvice(never, r.state, view(1))).toEqual({ hold: [] });
  });

  it('a held stance lets go by itself after its longest hold (Burrowfang)', () => {
    const dive: ClassMechanic = { kind: 'stance', names: ['Above', 'Below'], swap: { hold: true }, remap: {}, lockMs: 3000, autoRule: { swap: 'never' } };
    const r = new Run(dive).ev({ type: 'swap', on: true });
    expect(r.view().name).toBe('Below');
    r.ev({ type: 'swap', on: true }).tick(2900);
    expect(r.view().stance).toBe(1);
    r.tick(100);
    expect(r.view().name).toBe('Above');
    r.ev({ type: 'swap', on: true }).ev({ type: 'swap', on: false });
    expect(r.view().stance).toBe(0);
    expect(r.kinds()).toEqual(['stance', 'stance', 'stance', 'stance']);
  });
});

// ------------------------------------------------------------------ zone

describe('zone: Hearth (Pyromancer)', () => {
  const kindle = rod('kindle_hearth', { kind: 'zone' });
  const hurl = rod('hurl_hearth', { kind: 'nova' });
  const flock = rod('ember_flock', { kind: 'projectile' });

  it('place one Hearth; kills near it feed it up to level 5; near it you gain +3% MATK per level', () => {
    const r = new Run(HEARTH, 'staff');
    expect(r.view()).toMatchObject({ widget: 'count', name: 'Hearth', value: 0, max: 1 });
    expect(r.cast(kindle).effects).toEqual([{ type: 'placed', name: 'Hearth', object: 1, count: 1 }]);
    expect(mechanicStats(HEARTH, r.state, 1)).toEqual({ matk: 3 });
    expect(mechanicStats(HEARTH, r.state, null)).toEqual({}); // too far from it
    r.ev({ type: 'kill', target: 'a' }); // not near it
    for (let i = 0; i < 6; i++) r.ev({ type: 'kill', target: `k${i}`, object: 1 });
    expect((r.state as { objects: { level: number }[] }).objects[0].level).toBe(5);
    expect(r.kinds().filter((k) => k === 'levelUp')).toHaveLength(4);
    expect(mechanicStats(HEARTH, r.state, 5)).toEqual({ matk: 15 });
    r.tick(600_000); // lifeMs 0: a Hearth does not burn out
    expect(r.view().value).toBe(1);
  });

  it('Hurl Hearth throws it: sized by its level, and the Hearth is gone', () => {
    const r = new Run(HEARTH, 'staff');
    expect(r.cast(hurl)).toMatchObject({ boost: {}, effects: [] }); // nothing to throw
    r.cast(kindle);
    for (let i = 0; i < 2; i++) r.ev({ type: 'kill', target: `k${i}`, object: 1 });
    expect(r.cast(flock).boost).toEqual({});
    const out = r.cast(hurl);
    expect(out.boost).toEqual({ sizePct: 60, powerPct: 60 });
    expect(out.effects).toEqual([{ type: 'consumed', name: 'Hearth', skill: 'hurl_hearth', objects: [{ id: 1, ageMs: 0, level: 3 }] }]);
    expect(r.view().value).toBe(0);
  });

  it('placing a second one replaces the first (max 1)', () => {
    const r = new Run(HEARTH, 'staff');
    r.cast(kindle);
    r.ev({ type: 'kill', target: 'a', object: 1 });
    r.cast(kindle);
    expect(r.kinds()).toEqual(['placed', 'levelUp', 'expired', 'placed']);
    expect(r.state).toMatchObject({ objects: [{ id: 2, level: 1 }] });
  });

  it('AUTO keeps one up, never stacks a second, and hurls it only once it is full-grown', () => {
    const r = new Run(HEARTH, 'staff');
    const view = { castable: [flock, hurl, kindle], weapon: 'staff' as const, hpPct: 100 };
    expect(autoAdvice(HEARTH, r.state, view)).toEqual({ do: { type: 'cast', skill: 'kindle_hearth', place: 'atFeet' }, hold: ['hurl_hearth'] });
    r.cast(kindle);
    // One is up: no second Hearth, and the Hearth is not thrown away while it can still grow.
    expect(autoAdvice(HEARTH, r.state, view)).toEqual({ hold: ['kindle_hearth', 'hurl_hearth'] });
    for (let i = 0; i < 4; i++) r.ev({ type: 'kill', target: `k${i}`, object: 1 });
    expect(autoAdvice(HEARTH, r.state, view)).toEqual({ do: { type: 'cast', skill: 'hurl_hearth' }, hold: ['kindle_hearth'] });
    // A zone without levels is used up once the set is full.
    const seeds: ClassMechanic = { ...(HEARTH as Extract<ClassMechanic, { kind: 'zone' }>), levels: undefined, max: 2, autoRule: { place: 'atFeet', keep: 2 } };
    let s = initMechanic(seeds);
    s = useSkill(seeds, s, kindle, { weapon: 'staff' }).state;
    expect(autoAdvice(seeds, s, view)).toEqual({ do: { type: 'cast', skill: 'kindle_hearth', place: 'atFeet' }, hold: ['hurl_hearth'] });
    s = useSkill(seeds, s, kindle, { weapon: 'staff' }).state;
    expect(autoAdvice(seeds, s, view)).toEqual({ do: { type: 'cast', skill: 'hurl_hearth' }, hold: ['kindle_hearth'] });
  });
});

describe('zone: several short-lived objects (Glyphwarden, Mistknife)', () => {
  const stones: ClassMechanic = {
    kind: 'zone',
    name: 'Runestones',
    object: 'runestone',
    max: 3,
    lifeMs: 12_000,
    near: { tiles: 2, effects: [{ do: 'stat', stat: 'def', pct: 15 }, { do: 'threshold', at: 1, filter: { weapon: 'sword' }, boost: { repeat: 0.3 } }] },
    autoRule: { place: 'onTarget', keep: 2 },
  };
  const plant = sword('plant_glyph', { kind: 'zone' });

  it('kit zone skills plant them, the oldest goes first, and each lasts 12 s', () => {
    const r = new Run(stones);
    r.cast(plant);
    r.tick(5000);
    r.cast(plant);
    r.cast(plant);
    r.cast(plant);
    expect(r.state).toMatchObject({ objects: [{ id: 2 }, { id: 3 }, { id: 4 }] });
    expect(r.kinds()).toEqual(['placed', 'placed', 'placed', 'expired', 'placed']);
    r.tick(12_000);
    expect(r.view().value).toBe(0);
    r.ev({ type: 'place' }).ev({ type: 'place' }).ev({ type: 'remove' });
    expect(r.state).toMatchObject({ objects: [{ id: 6 }] });
    r.ev({ type: 'remove', object: 99 });
    expect(r.view().value).toBe(1);
  });

  it('near a stone: +15% DEF and sword skills repeat at 30%', () => {
    const r = new Run(stones);
    r.cast(plant);
    expect(mechanicStats(stones, r.state, 1)).toEqual({ def: 15 });
    expect(r.cast(sword('stonewrit_cut'), undefined, 1).boost).toEqual({ repeat: 0.3 });
    expect(r.cast(sword('stonewrit_cut'), undefined, null).boost).toEqual({});
    expect(r.cast(use('ember_dart', { tags: ['spell'] }), undefined, 1).boost).toEqual({});
  });

  it('AUTO keeps `keep` objects up, placed on the target', () => {
    const r = new Run(stones);
    const view = { castable: [plant], weapon: 'sword' as const, hpPct: 100 };
    expect(autoAdvice(stones, r.state, view).do).toEqual({ type: 'cast', skill: 'plant_glyph', place: 'onTarget' });
    r.cast(plant);
    expect(autoAdvice(stones, r.state, view).do).toEqual({ type: 'cast', skill: 'plant_glyph', place: 'onTarget' });
    r.cast(plant);
    expect(autoAdvice(stones, r.state, view)).toEqual({ hold: [] }); // 2 kept; a third is the player's call
    r.cast(plant);
    expect(autoAdvice(stones, r.state, view)).toEqual({ hold: ['plant_glyph'] });
  });
});

// ------------------------------------------------------------------ data checks

describe('mechanicProblems', () => {
  it('accepts the eight Phase 1 mechanics with their kits', () => {
    expect(mechanicProblems(CADENCE, [])).toEqual([]);
    expect(mechanicProblems(WEAVE, [])).toEqual([]);
    expect(mechanicProblems(ROAD_RHYTHM, [])).toEqual([]);
    expect(mechanicProblems(HEAT, [])).toEqual([]);
    expect(mechanicProblems(JUGGLE, [])).toEqual([]);
    expect(mechanicProblems(PINNED, ['second_shadow'])).toEqual([]);
    expect(mechanicProblems(TIDE, ['tidal_hand'])).toEqual([]);
    expect(mechanicProblems(HEARTH, ['kindle_hearth', 'hurl_hearth'])).toEqual([]);
  });

  it('reports ids outside the kit, impossible thresholds and the wrong kind of AUTO rule', () => {
    expect(mechanicProblems(PINNED, [])).toEqual(['spendWith second_shadow is not a kit skill']);
    expect(mechanicProblems(TIDE, [])).toEqual(['remap source tidal_hand is not a kit skill']);
    expect(mechanicProblems(HEARTH, [])).toEqual(['placeWith kindle_hearth is not a kit skill', 'consumeWith hurl_hearth is not a kit skill']);
    const bad: ClassMechanic = {
      kind: 'gauge',
      name: 'Bad',
      max: null,
      fill: [],
      effects: [{ do: 'nextSkill', at: 'max', boost: {} }, { do: 'unlock', at: 5, skill: 'ghost' }],
      autoRule: { swap: 'never' },
    };
    expect(mechanicProblems(bad, [])).toEqual(['gauge has nothing that fills it', "an effect at 'max' needs a gauge max", 'unlock skill ghost is not a kit skill', 'a gauge needs a spend autoRule']);
    expect(mechanicProblems({ ...(HEAT as Extract<ClassMechanic, { kind: 'gauge' }>), effects: [{ do: 'threshold', at: 11 }] }, [])).toEqual(['an effect at 11 is above the max 10']);
  });
});
