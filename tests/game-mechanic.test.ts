// The class mechanic at run time (src/game/systems/mechanic.ts, boost.ts; docs/SPEC-v4.md §3.3, §3.6): the game
// layer keeps the MechanicState, calls core useSkill for every skill use (basic attacks included), feeds hits,
// kills and ticks, and gets effects and boosts back. Driven here exactly as Combat drives it, on the fixture classes
// (tests/fixtures/game-v4.ts): a gauge, two combos, marks, a stance and a zone.
import { describe, expect, it } from 'vitest';
import type { MechanicEffect } from '../src/core/mechanics';
import type { SkillShape, WeaponType } from '../src/core/types';
import { boostShape, boostSkill, withSize } from '../src/game/systems/boost';
import { MechanicRuntime } from '../src/game/systems/mechanic';
import { Session } from '../src/game/session';
import { fixtureRegistry } from './fixtures/game-v4';

const reg = fixtureRegistry();

/** A character wearing fixture class `cls` at Class Level `level`, holding its weapon, with its kit known. */
function wearing(cls: string, level = 10): { s: Session; rt: MechanicRuntime; fx: MechanicEffect[]; weapon: WeaponType } {
  const def = reg.classDef(cls)!;
  const weapon = def.weapon as WeaponType;
  const s = Session.create(reg, 'T', weapon, 3);
  s.book.incFlag(`fx:${cls}`);
  s.book.state.classes[cls] = { rank: level, xp: 0 };
  for (const id of def.kit!) if (!s.book.has(id)) s.book.learn(id, 'test');
  const fx: MechanicEffect[] = [];
  s.mechanic.onEffects = (e) => void fx.push(...e);
  return { s, rt: s.mechanic, fx, weapon };
}

/** One cast as Combat.fire makes it: resolve, use, then a hit on `target`. Returns the boost. */
function cast(w: ReturnType<typeof wearing>, barId: string, target = 'a', hit = true, damage = 10) {
  const skill = reg.skill(w.rt.resolve(barId))!;
  const use = w.rt.useOf(barId, skill);
  const out = w.rt.use(use, { weapon: w.weapon, target });
  if (hit && !out.locked) w.rt.step({ type: 'hit', use, weapon: w.weapon, target, damage });
  return out;
}

describe('MechanicRuntime: the state lives in the game layer', () => {
  it('is on the Session (never saved), empty with no class, and fresh for every class', () => {
    const s = Session.create(reg, 'T', 'sword', 1);
    expect(s.mechanic.state).toEqual({ kind: 'none' });
    expect(s.mechanic.view()).toBeNull();
    expect(JSON.stringify(s.book.serialize())).not.toContain('"mechanic"');
    s.book.incFlag('fx:fx_heat');
    expect(s.mechanic.view()).toMatchObject({ kind: 'gauge', name: 'Heat', widget: 'bar', value: 0, max: 10 });
    s.book.unwear();
    expect(s.mechanic.view()).toBeNull();
  });

  it('a class change, the Level 8 upgrade and reset() each start it over', () => {
    const w = wearing('fx_heat', 1);
    for (let i = 0; i < 4; i++) cast(w, 'slash');
    expect(w.rt.view()).toMatchObject({ value: 4, max: 10 });
    w.rt.reset();
    expect(w.rt.view()!.value).toBe(0);
    for (let i = 0; i < 4; i++) cast(w, 'slash');
    // Class Level 8: the upgraded mechanic (max 12) with a fresh state.
    w.s.book.state.classes.fx_heat.rank = 8;
    expect(w.rt.view()).toMatchObject({ value: 0, max: 12 });
    // Another class: its own mechanic.
    w.s.book.incFlag('fx:fx_blade');
    w.s.book.wear('fx_blade');
    expect(w.rt.view()).toMatchObject({ kind: 'combo', name: 'Cadence' });
  });

  it('useOf: the use keeps the bar skill id; kit membership comes from the bar skill (variants count as their base)', () => {
    const w = wearing('fx_blade');
    expect(w.rt.useOf('fx_cut', reg.skill('fx_cut')!)).toMatchObject({ id: 'fx_cut', kit: true, basic: false, kind: 'strike' });
    expect(w.rt.useOf('slash', reg.skill('slash')!)).toMatchObject({ id: 'slash', kit: false, basic: true });
    expect(w.rt.useOf('fx_spin', reg.skill('fx_spin')!)).toMatchObject({ kit: false, basic: false });
  });
});

describe('gauge (Heat): every sword hit — basic attacks included — fills it; full, the next class skill takes it', () => {
  it('basic attacks go through useSkill and their hits fill the meter', () => {
    const w = wearing('fx_heat', 1);
    for (let i = 0; i < 9; i++) expect(cast(w, 'slash').boost).toEqual({});
    expect(w.rt.view()).toMatchObject({ value: 9, ready: false });
    expect(w.fx).toEqual([]);
    cast(w, 'slash');
    expect(w.rt.view()).toMatchObject({ value: 10, ready: true });
    expect(w.fx).toEqual([{ type: 'full', name: 'Heat' }]); // "meter full"
  });

  it('at full Heat the next CLASS skill costs HP, is twice the size, and spends the meter; other skills do not', () => {
    const w = wearing('fx_heat', 1);
    for (let i = 0; i < 10; i++) cast(w, 'slash');
    expect(w.rt.preview(w.rt.useOf('fx_spin', reg.skill('fx_spin')!), { weapon: 'sword' })).toEqual({});
    expect(w.rt.preview(w.rt.useOf('fx_bellows', reg.skill('fx_bellows')!), { weapon: 'sword' })).toEqual({ hpCostPct: 6, sizePct: 100 });
    w.fx.length = 0;
    const out = cast(w, 'fx_bellows', 'a', false);
    expect(out.boost).toEqual({ hpCostPct: 6, sizePct: 100 });
    expect(w.fx).toEqual([{ type: 'spent', name: 'Heat', amount: 10, skill: 'fx_bellows' }]);
    expect(w.rt.view()!.value).toBe(0);
  });

  it('a hit with another weapon in hand, or a free spell, does not fill it; idle time drains it', () => {
    const w = wearing('fx_heat', 1);
    const dart = reg.skill('fx_dart')!;
    w.rt.step({ type: 'hit', use: w.rt.useOf('fx_dart', dart), weapon: 'sword', target: 'a', damage: 5 });
    w.rt.step({ type: 'hit', use: w.rt.useOf('slash', reg.skill('slash')!), weapon: 'fists', target: 'a', damage: 5 });
    expect(w.rt.view()!.value).toBe(0);
    for (let i = 0; i < 6; i++) cast(w, 'slash');
    for (let t = 0; t < 5000; t += 100) w.rt.step({ type: 'tick', dtMs: 100 });
    expect(w.rt.view()!.value).toBeLessThan(6);
  });

  it("AUTO spends at the rule's threshold: nothing below, the first castable class skill at max", () => {
    const w = wearing('fx_heat', 1);
    const uses = ['fx_spin', 'fx_bellows', 'fx_white'].map((id) => w.rt.useOf(id, reg.skill(id)!));
    expect(w.rt.advice({ castable: uses, weapon: 'sword', hpPct: 100 })).toEqual({ hold: [] });
    for (let i = 0; i < 10; i++) cast(w, 'slash');
    expect(w.rt.advice({ castable: uses, weapon: 'sword', hpPct: 100 }).do).toEqual({ type: 'cast', skill: 'fx_bellows' });
  });
});

describe('combo (Cadence): three different sword skills, the third is the Finisher', () => {
  it('steps, then a finisher that always crits and is 30% bigger; the bar shows it one step ahead', () => {
    const w = wearing('fx_blade');
    expect(cast(w, 'fx_cut').boost).toEqual({});
    expect(cast(w, 'fx_turn').boost).toEqual({});
    expect(w.rt.view()).toMatchObject({ kind: 'combo', widget: 'pips', value: 2, max: 2, ready: true });
    expect(w.rt.preview(w.rt.useOf('fx_word', reg.skill('fx_word')!), { weapon: 'sword' })).toEqual({ crit: true, sizePct: 30 });
    const out = cast(w, 'fx_word');
    expect(out.boost).toEqual({ crit: true, sizePct: 30 });
    expect(w.fx.map((e) => e.type)).toEqual(['comboStep', 'comboStep', 'finisher']);
    expect(w.fx[2]).toEqual({ type: 'finisher', name: 'Finisher', skill: 'fx_word' });
    expect(w.rt.view()!.value).toBe(0);
  });

  it('basic attacks neither count nor break it; a skill of another grip breaks it; so does waiting', () => {
    const w = wearing('fx_blade');
    cast(w, 'fx_cut');
    cast(w, 'slash');
    expect(w.rt.view()!.value).toBe(1);
    cast(w, 'fx_dart'); // a free spell is not a sword skill
    expect(w.rt.view()!.value).toBe(0);
    expect(w.fx.at(-1)).toEqual({ type: 'comboBreak', name: 'Cadence' });
    cast(w, 'fx_cut');
    for (let t = 0; t < 4200; t += 100) w.rt.step({ type: 'tick', dtMs: 100 });
    expect(w.rt.view()!.value).toBe(0);
  });

  it('a general sword skill on the bar counts as a step too (the combo is about the weapon, not the kit)', () => {
    const w = wearing('fx_blade');
    cast(w, 'fx_spin');
    cast(w, 'fx_throw');
    expect(cast(w, 'fx_cleave').boost).toEqual({ crit: true, sizePct: 30 });
  });
});

describe('lead-basic combo (Road Rhythm): Jab, Jab, then a class skill', () => {
  it('two basic attacks ready it; the class skill that follows is the Roadhouse hit', () => {
    const w = wearing('fx_way');
    const basic = 'jab';
    if (!reg.skill(basic)) return; // the fists basic lands with the content lane
    expect(cast(w, 'fx_dust').boost).toEqual({}); // not ready: an ordinary hit
    cast(w, basic);
    cast(w, basic);
    expect(w.rt.view()).toMatchObject({ value: 2, ready: true });
    expect(cast(w, 'fx_roadhouse').boost).toEqual({ sizePct: 40, status: 'knockback' });
    expect(w.fx.at(-1)).toEqual({ type: 'finisher', name: 'Roadhouse', skill: 'fx_roadhouse' });
  });

  it('AUTO keeps to basic attacks while the lead builds, then casts a class skill', () => {
    const w = wearing('fx_way');
    if (!reg.skill('jab')) return;
    const uses = ['fx_roadhouse', 'fx_dust'].map((id) => w.rt.useOf(id, reg.skill(id)!));
    expect(w.rt.advice({ castable: uses, weapon: 'fists', hpPct: 100 })).toEqual({ do: { type: 'basic' }, hold: ['fx_roadhouse', 'fx_dust'] });
    cast(w, 'jab');
    cast(w, 'jab');
    expect(w.rt.advice({ castable: uses, weapon: 'fists', hpPct: 100 }).do).toEqual({ type: 'cast', skill: 'fx_roadhouse' });
  });
});

describe('marks (Pinned Shadow): pin, bank half the damage, cash in', () => {
  it('a mark skill pins the foe (root 2 s); damage meanwhile is banked; the cash-in skill pays it out', () => {
    const w = wearing('fx_pin');
    cast(w, 'fx_pinshot', 'foe1', true, 40);
    expect(w.fx).toEqual([{ type: 'marked', name: 'Pinned Shadow', target: 'foe1', marks: 1, status: 'root', statusMs: 2000 }]);
    expect(w.rt.view('foe1')).toMatchObject({ kind: 'marks', value: 1, max: 1, ready: true });
    expect(w.rt.view('other')!.value).toBe(0);
    cast(w, 'stab', 'foe1', true, 30);
    cast(w, 'stab', 'foe1', true, 30);
    w.fx.length = 0;
    const out = cast(w, 'fx_second', 'foe1', false);
    expect(w.fx).toEqual([{ type: 'cashIn', name: 'Pinned Shadow', skill: 'fx_second', targets: [{ target: 'foe1', marks: 1, powerPct: 0, stored: 30 }], resetCooldown: false }]);
    expect(out.locked).toBe(false);
    expect(w.rt.view('foe1')!.value).toBe(0);
  });

  it('left alone the pin ends by itself and the banked damage lands then; a kill or a foe leaving clears it', () => {
    const w = wearing('fx_pin');
    cast(w, 'fx_stitch', 'foe1', true, 10);
    cast(w, 'stab', 'foe1', true, 50);
    w.fx.length = 0;
    for (let t = 0; t < 2100; t += 100) w.rt.step({ type: 'tick', dtMs: 100 });
    expect(w.fx).toEqual([{ type: 'markEnd', name: 'Pinned Shadow', target: 'foe1', stored: 25 }]);
    cast(w, 'fx_pinshot', 'foe2');
    w.rt.step({ type: 'kill', target: 'foe2' });
    expect(w.rt.view('foe2')!.value).toBe(0);
    cast(w, 'fx_pinshot', 'foe3');
    w.rt.step({ type: 'gone', target: 'foe3' });
    expect(w.rt.view('foe3')!.value).toBe(0);
  });

  it('AUTO holds the cash-in until a foe is pinned', () => {
    const w = wearing('fx_pin');
    const uses = ['fx_pinshot', 'fx_second'].map((id) => w.rt.useOf(id, reg.skill(id)!));
    expect(w.rt.advice({ castable: uses, weapon: 'dagger', hpPct: 100 })).toEqual({ hold: ['fx_second'] });
    cast(w, 'fx_pinshot', 'foe1');
    expect(w.rt.advice({ castable: uses, weapon: 'dagger', hpPct: 100, target: 'foe1' }).do).toEqual({ type: 'cast', skill: 'fx_second' });
  });
});

describe('stance (the Tide, tapped here): the button swaps, and the bar casts other skills', () => {
  it('High Tide boosts the kit one way, Low Tide the other, and remaps a slot to another skill', () => {
    const w = wearing('fx_tide');
    expect(w.rt.canSwap()).toBe(true);
    expect(w.rt.view()).toMatchObject({ kind: 'stance', name: 'High Tide', widget: 'sides', stance: 0 });
    expect(w.rt.resolve('fx_hand')).toBe('fx_hand');
    expect(cast(w, 'fx_hand').boost).toEqual({ sizePct: 30, status: 'knockback' });
    expect(w.rt.swap()).toBe(true);
    expect(w.fx).toEqual([{ type: 'stance', stance: 1, name: 'Low Tide' }]);
    expect(w.rt.view()).toMatchObject({ name: 'Low Tide', stance: 1 });
    expect(w.rt.resolve('fx_hand')).toBe('fx_hand_low'); // the slot casts another skill now
    expect(w.rt.resolve('fx_pool')).toBe('fx_pool');
    const low = cast(w, 'fx_hand');
    expect(low.boost).toEqual({ sizePct: -20, powerPct: 25, status: 'pull' });
    // The use is still the bar slot's: the remapped skill counts as the kit skill it stands in for.
    expect(w.rt.useOf('fx_hand', reg.skill('fx_hand_low')!)).toMatchObject({ id: 'fx_hand', kit: true });
    // A skill that is not in the kit gets nothing from the stance.
    expect(cast(w, 'fx_orb').boost).toEqual({});
  });

  it('classes without a stance have no button', () => {
    const w = wearing('fx_heat');
    expect(w.rt.canSwap()).toBe(false);
    expect(w.rt.swap()).toBe(false);
  });
});

describe('zone (Hearth): one class object, fed by kills near it, thrown by another skill', () => {
  it('the placing skill reports a placed object; standing near it gives stats per level; kills near it grow it', () => {
    const w = wearing('fx_hearth');
    cast(w, 'fx_kindle', 'a', false);
    expect(w.fx).toEqual([{ type: 'placed', name: 'Hearth', object: 1, count: 1 }]);
    expect(w.rt.view()).toMatchObject({ kind: 'zone', widget: 'count', value: 1, max: 1 });
    expect(w.rt.nearTiles()).toBe(3);
    expect(w.rt.objectLifeMs()).toBe(0); // it stands until replaced or used up
    expect(w.rt.objectLevel(1)).toBe(1);
    expect(w.rt.stats(null).matk).toBe(0);
    expect(w.rt.stats(1).matk).toBe(3);
    w.rt.step({ type: 'kill', target: 'x', object: 1 });
    w.rt.step({ type: 'kill', target: 'y', object: 1 });
    expect(w.rt.objectLevel(1)).toBe(3);
    expect(w.rt.stats(3).matk).toBe(9);
    expect(w.fx.filter((e) => e.type === 'levelUp')).toHaveLength(2);
    w.rt.step({ type: 'kill', target: 'z' }); // not near it: nothing
    expect(w.rt.objectLevel(1)).toBe(3);
  });

  it('placing again replaces it (max 1); the consuming skill uses it up, boosted by its level', () => {
    const w = wearing('fx_hearth');
    cast(w, 'fx_kindle', 'a', false);
    w.rt.step({ type: 'kill', target: 'x', object: 1 });
    w.fx.length = 0;
    cast(w, 'fx_kindle', 'a', false);
    expect(w.fx.map((e) => e.type)).toEqual(['expired', 'placed']);
    expect(w.fx[1]).toMatchObject({ object: 2, count: 1 });
    w.rt.step({ type: 'kill', target: 'x', object: 2 });
    w.fx.length = 0;
    const out = cast(w, 'fx_hurl', 'a', false);
    expect(out.boost).toEqual({ sizePct: 40, powerPct: 40 });
    expect(w.fx).toEqual([{ type: 'consumed', name: 'Hearth', skill: 'fx_hurl', objects: [{ id: 2, ageMs: 0, level: 2 }] }]);
    expect(w.rt.view()!.value).toBe(0);
  });

  it('an object that ends in the world is forgotten by the mechanic (remove); AUTO then places a new one at the feet', () => {
    const w = wearing('fx_hearth');
    const uses = ['fx_kindle', 'fx_hurl', 'fx_flock'].map((id) => w.rt.useOf(id, reg.skill(id)!));
    expect(w.rt.advice({ castable: uses, weapon: 'staff', hpPct: 100 })).toEqual({ do: { type: 'cast', skill: 'fx_kindle', place: 'atFeet' }, hold: ['fx_hurl'] });
    cast(w, 'fx_kindle', 'a', false);
    // One Hearth up: no second one, and no throwing it before it has grown.
    expect(w.rt.advice({ castable: uses, weapon: 'staff', hpPct: 100 })).toEqual({ hold: ['fx_kindle', 'fx_hurl'] });
    w.rt.step({ type: 'remove', object: 1 });
    expect(w.rt.view()!.value).toBe(0);
    expect(w.rt.advice({ castable: uses, weapon: 'staff', hpPct: 100 }).do).toMatchObject({ type: 'cast', skill: 'fx_kindle' });
  });
});

describe('boosts on the shape (boost.ts)', () => {
  const strike: SkillShape = { kind: 'strike', range: 60, arc: 100 };
  it('size scales radius, range, arc and projectile size; nothing set leaves the shape untouched', () => {
    expect(boostShape(strike, {})).toBe(strike);
    expect(boostShape(strike, { crit: true, powerPct: 50 })).toBe(strike);
    expect(boostShape(strike, { sizePct: 30 })).toEqual({ kind: 'strike', range: 78, arc: 130 });
    expect(boostShape({ kind: 'strike', range: 60, arc: 300 }, { sizePct: 100 })).toMatchObject({ arc: 360 });
    expect(boostShape({ kind: 'spin', radius: 70 }, { sizePct: 100 })).toEqual({ kind: 'spin', radius: 140 });
    expect(boostShape({ kind: 'nova', radius: 70, range: 200 }, { sizePct: -20 })).toEqual({ kind: 'nova', radius: 56, range: 200 });
    expect(boostShape({ kind: 'projectile', speed: 400, range: 200 }, { sizePct: 50 })).toEqual({ kind: 'projectile', speed: 400, range: 300, size: 18 });
    expect(boostShape({ kind: 'zone', radius: 40, range: 0, durationMs: 4000, tickMs: 800, line: { length: 200 } }, { sizePct: 100 })).toMatchObject({ radius: 80, line: { length: 400 }, durationMs: 4000 });
    expect(boostShape({ kind: 'shield', pct: 20, durationMs: 5000, burst: { radius: 60 } }, { sizePct: 50 })).toMatchObject({ pct: 20, burst: { radius: 90 } });
    expect(boostShape({ kind: 'blink', distance: 200, to: 'point', arrive: { radius: 50 } }, { sizePct: 100 })).toMatchObject({ distance: 200, arrive: { radius: 100 } });
  });
  it('speed, pierce and pulses reach the shapes that have them', () => {
    expect(boostShape({ kind: 'projectile', speed: 400, range: 200 }, { speedPct: 30, pierce: 1 })).toEqual({ kind: 'projectile', speed: 520, range: 200, pierce: 1 });
    expect(boostShape({ kind: 'spin', radius: 70, pulses: 2 }, { pulses: 1 })).toEqual({ kind: 'spin', radius: 70, pulses: 3 });
    expect(boostShape(strike, { pulses: 2 })).toMatchObject({ hits: 3 });
    const mend: SkillShape = { kind: 'mend', pct: 20 };
    expect(boostShape(mend, { sizePct: 100, pulses: 3 })).toBe(mend);
  });
  it('boostSkill keeps the id and everything but the shape; withSize folds a standing size bonus in', () => {
    const sk = reg.skill('fx_cut')!;
    expect(boostSkill(sk, {})).toBe(sk);
    const big = boostSkill(sk, { sizePct: 100 });
    expect(big).not.toBe(sk);
    expect(big.id).toBe('fx_cut');
    expect(big.power).toBe(sk.power);
    expect(big.shape).toMatchObject({ range: 120 });
    expect(withSize({ crit: true }, 0)).toEqual({ crit: true });
    expect(withSize({ sizePct: 30 }, 20)).toEqual({ sizePct: 50 });
  });
});
