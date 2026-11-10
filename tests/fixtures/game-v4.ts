// Game-lane v4 fixture (tests/loadout.test.ts, game-mechanic.test.ts, game-weapons.test.ts): the real content plus
// a handful of TEMPORARY skills and kit classes, so the bar rules, weapon rules and mechanic wiring are tested
// against data that does not move while the content lane tunes the real classes. Every fixture id starts with `fx_`.
// Fixture classes are discovered by a flag (`fx:<class>`), never by play.
import { Registry } from '../../src/core/registry';
import type { ClassDefV4, ClassMechanic, GameData, SkillDef, SkillShape, WeaponType } from '../../src/core/types';
import { GAME_DATA } from '../../src/data';

const GRIP: Record<WeaponType, string> = { sword: 'blade', dagger: 'pierce', staff: 'rod', fists: 'fist' };

function skill(id: string, shape: SkillShape, over: Partial<SkillDef> = {}): SkillDef {
  return { id, name: id, desc: id, icon: '·', tier: 1, maxRank: 5, tags: [], power: shape.kind === 'buff' || shape.kind === 'mend' ? 0 : 1, spCost: 5, cooldown: 2000, shape, ...over };
}

/** A weapon-bound skill (grip tag + `weapons`). */
function bound(id: string, weapon: WeaponType, shape: SkillShape, over: Partial<SkillDef> = {}): SkillDef {
  return skill(id, shape, { weapons: [weapon], ...over, tags: [GRIP[weapon], ...(over.tags ?? [])] });
}

/** A class-only kit skill of `cls`, bound to its weapon. */
function kit(cls: string, id: string, weapon: WeaponType, shape: SkillShape, over: Partial<SkillDef> = {}): SkillDef {
  return bound(id, weapon, shape, { tier: 2, classOf: cls, ...over });
}

const STRIKE: SkillShape = { kind: 'strike', range: 60, arc: 100 };
const SPIN: SkillShape = { kind: 'spin', radius: 70 };
const DASH: SkillShape = { kind: 'dash', distance: 150, width: 40 };
const SHOT: SkillShape = { kind: 'projectile', speed: 400, range: 260 };
const NOVA: SkillShape = { kind: 'nova', radius: 70, range: 200 };
const ZONE: SkillShape = { kind: 'zone', radius: 60, range: 160, durationMs: 4000, tickMs: 500 };
const SHIELD: SkillShape = { kind: 'shield', pct: 20, durationMs: 5000 };
const MEND: SkillShape = { kind: 'mend', pct: 20 };
const BLINK: SkillShape = { kind: 'blink', distance: 200, to: 'target' };
const BUFF: SkillShape = { kind: 'buff', stat: 'atk', amount: 10, duration: 8000 };

export const FX_SKILLS: SkillDef[] = [
  // ---- general skills anyone may learn (your slots)
  bound('fx_spin', 'sword', SPIN),
  bound('fx_throw', 'sword', SHOT, { tier: 2 }),
  bound('fx_cleave', 'sword', STRIKE, { tier: 3 }),
  bound('fx_flurry', 'sword', STRIKE),
  bound('fx_knife', 'dagger', SHOT, { tags: ['throw'] }),
  bound('fx_orb', 'staff', SHOT, { tags: ['arcane'] }),
  bound('fx_hook', 'fists', STRIKE),
  skill('fx_dart', SHOT, { tags: ['spell', 'arcane'], element: 'fire' }),
  skill('fx_hop', DASH, { tags: ['mobility'], power: 0 }),
  skill('fx_focus', BUFF, { tags: ['buff'] }),
  skill('fx_patch', MEND, { tags: ['buff'] }),
  skill('fx_meteor', NOVA, { tags: ['spell', 'arcane'], element: 'fire', tier: 3 }),
  // ---- fx_blade (sword, combo): 3 different sword skills, the 3rd is a Finisher
  kit('fx_blade', 'fx_guard', 'sword', SHIELD, { power: 0 }),
  kit('fx_blade', 'fx_cut', 'sword', STRIKE),
  kit('fx_blade', 'fx_turn', 'sword', SPIN),
  kit('fx_blade', 'fx_step', 'sword', DASH),
  kit('fx_blade', 'fx_word', 'sword', STRIKE),
  // ---- fx_heat (sword, fire, gauge): +1 per sword hit, at 10 the next class skill costs HP and is twice the size
  kit('fx_heat', 'fx_edge', 'sword', BUFF, { element: 'fire' }),
  kit('fx_heat', 'fx_bellows', 'sword', STRIKE, { element: 'fire' }),
  kit('fx_heat', 'fx_cinder', 'sword', { ...ZONE, range: 0, line: { length: 200 } }, { element: 'fire', power: 0.4 }),
  kit('fx_heat', 'fx_slag', 'sword', SHOT, { element: 'fire' }),
  kit('fx_heat', 'fx_white', 'sword', STRIKE, { element: 'fire' }),
  // ---- fx_way (fists, lead-basic combo): Jab, Jab, then a class skill
  kit('fx_way', 'fx_roadhouse', 'fists', STRIKE),
  kit('fx_way', 'fx_dust', 'fists', STRIKE),
  kit('fx_way', 'fx_walk', 'fists', MEND),
  kit('fx_way', 'fx_stride', 'fists', DASH),
  kit('fx_way', 'fx_roll', 'fists', DASH),
  // ---- fx_pin (dagger, marks): mark skills pin a foe; fx_second cashes the marks in
  kit('fx_pin', 'fx_cloak', 'dagger', BUFF),
  kit('fx_pin', 'fx_pinshot', 'dagger', SHOT, { tags: ['mark'] }),
  kit('fx_pin', 'fx_second', 'dagger', BLINK, { power: 0 }),
  kit('fx_pin', 'fx_stitch', 'dagger', STRIKE, { tags: ['mark'] }),
  kit('fx_pin', 'fx_lights', 'dagger', ZONE),
  // ---- fx_tide (staff, stance): the tide turns by hand here (tap); Low Tide casts another skill from fx_hand
  kit('fx_tide', 'fx_hand', 'staff', SHOT),
  kit('fx_tide', 'fx_break', 'staff', SHIELD, { power: 0 }),
  kit('fx_tide', 'fx_pool', 'staff', ZONE),
  kit('fx_tide', 'fx_under', 'staff', NOVA),
  kit('fx_tide', 'fx_moon', 'staff', BUFF),
  bound('fx_hand_low', 'staff', { ...SHOT, range: 140 }, { tier: 2, classOf: 'fx_tide', power: 1.5 }),
  // ---- fx_hearth (staff, zone): one Hearth; kills near it feed it; fx_hurl throws it
  kit('fx_hearth', 'fx_kindle', 'staff', { ...ZONE, range: 0 }, { power: 0.3 }),
  kit('fx_hearth', 'fx_hurl', 'staff', NOVA),
  kit('fx_hearth', 'fx_stoke', 'staff', BUFF),
  kit('fx_hearth', 'fx_flock', 'staff', SHOT),
  kit('fx_hearth', 'fx_back', 'staff', NOVA),
];

export const FX_CADENCE: ClassMechanic = { kind: 'combo', name: 'Cadence', length: 3, distinct: true, filter: { weapon: 'sword' }, finisher: { name: 'Finisher', boost: { crit: true, sizePct: 30 } }, autoRule: { spend: 'atMax' } };
export const FX_HEAT: ClassMechanic = {
  kind: 'gauge',
  name: 'Heat',
  max: 10,
  fill: [{ on: 'hit', weapon: 'sword', amount: 1 }],
  decay: { afterMs: 3000, perSec: 2 },
  effects: [{ do: 'nextSkill', at: 'max', filter: { of: 'kit' }, boost: { hpCostPct: 6, sizePct: 100 } }],
  autoRule: { spend: 'atMax' },
};
export const FX_ROAD: ClassMechanic = { kind: 'combo', name: 'Road Rhythm', length: 3, distinct: false, lead: 'basic', finisher: { name: 'Roadhouse', boost: { sizePct: 40, status: 'knockback' } }, autoRule: { spend: 'atMax' } };
export const FX_PINNED: ClassMechanic = { kind: 'marks', name: 'Pinned Shadow', max: 1, applyOn: 'skillTag', perMark: { store: 0.5, status: 'root', statusMs: 2000, lifeMs: 2000 }, spendWith: 'fx_second', autoRule: { spend: 'atMax' } };
export const FX_TIDE: ClassMechanic = { kind: 'stance', names: ['High Tide', 'Low Tide'], swap: 'tap', remap: { fx_hand: 'fx_hand_low' }, boosts: [{ sizePct: 30, status: 'knockback' }, { sizePct: -20, powerPct: 25, status: 'pull' }], autoRule: { swap: 'never' } };
export const FX_HEARTH: ClassMechanic = {
  kind: 'zone',
  name: 'Hearth',
  object: 'hearth',
  max: 1,
  lifeMs: 0,
  levels: 5,
  placeWith: ['fx_kindle'],
  consumeWith: 'fx_hurl',
  perLevel: { sizePct: 20, powerPct: 20 },
  near: { tiles: 3, effects: [{ do: 'perPoint', stat: 'matk', pct: 3 }] },
  autoRule: { place: 'atFeet', keep: 1 },
};

function cls(id: string, weapon: WeaponType, mechanic: ClassMechanic, kit: [string, string, string, string, string], over: Partial<ClassDefV4> = {}): ClassDefV4 {
  return { id, name: id, icon: '·', desc: id, hint: id, rarity: 'common', weapon, source: 'physical', mechanic, kit, discover: { requires: [{ type: 'flag', id: `fx:${id}`, min: 1 }] }, bonus: { atk: 2 }, ...over };
}

export const FX_CLASSES: ClassDefV4[] = [
  cls('fx_blade', 'sword', FX_CADENCE, ['fx_guard', 'fx_cut', 'fx_turn', 'fx_step', 'fx_word']),
  cls('fx_heat', 'sword', FX_HEAT, ['fx_edge', 'fx_bellows', 'fx_cinder', 'fx_slag', 'fx_white'], {
    source: 'fire',
    rarity: 'uncommon',
    mechanicUpgrade: { line: 'Heat holds 12.', mechanic: { ...(FX_HEAT as Extract<ClassMechanic, { kind: 'gauge' }>), max: 12 } },
  }),
  cls('fx_way', 'fists', FX_ROAD, ['fx_roadhouse', 'fx_dust', 'fx_walk', 'fx_stride', 'fx_roll']),
  cls('fx_pin', 'dagger', FX_PINNED, ['fx_cloak', 'fx_pinshot', 'fx_second', 'fx_stitch', 'fx_lights'], { source: 'shadow' }),
  cls('fx_tide', 'staff', FX_TIDE, ['fx_hand', 'fx_break', 'fx_pool', 'fx_under', 'fx_moon'], { source: 'water' }),
  cls('fx_hearth', 'staff', FX_HEARTH, ['fx_kindle', 'fx_hurl', 'fx_stoke', 'fx_flock', 'fx_back'], { source: 'fire' }),
];

export const FX_DATA: GameData = { ...GAME_DATA, skills: [...GAME_DATA.skills, ...FX_SKILLS], classes: [...GAME_DATA.classes, ...FX_CLASSES] };

/** A registry with the real content plus the fixture skills and classes. */
export function fixtureRegistry(): Registry {
  return new Registry(FX_DATA);
}
