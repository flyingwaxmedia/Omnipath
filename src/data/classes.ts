import { classTreeTemplate, type ClassTreeSpec } from '../core/balance';
import type { ClassDef, ClassDefV4, ClassMechanic, PassiveDef, Requirement, WeaponType } from '../core/types';

/**
 * Classes (SPEC-v4 §3). A class is a weapon plus a power source, with ONE mechanic only it has, 5 class skills of
 * its own (the kit, unlocked at Class Levels 1, 1, 2, 4, 6), a Gift (its passive, on while worn) and a rarity.
 * Rarity says how hard a class is to find and how much there is to manage — never how strong it is: every class
 * is held to the same band by tests/class-sim.test.ts and tests/class-budget.test.ts.
 *
 * Phase 1 state of the 26 classes:
 * - 8 are REBUILT (REBUILT below): Blademaster, Knife Juggler, Spellwright, Wayfarer (the four Commons), Pyroblade,
 *   Shadowstalker, Pyromancer, Tidereader. Their class skills live in skills/classes/<id>.ts.
 * - 18 run on a LEGACY KIT until their phase (§3.7): 5 of today's skills (own signature first), the plain combo
 *   "Rhythm" (3 different skills in a row, the 3rd hits 20% harder), their old bonus and no Gift yet.
 * - Phantom, Vortex Dancer, Prism Sage and Echo Sovereign are gone: they merged into Shadowstalker, Tempest
 *   Dancer, Prismcaller (`elementalist`) and Mimic. The save migration folds them (core/save.ts MERGED_CLASSES).
 *
 * Kit rules (tests/class-kits.test.ts): no two classes share more than 1 kit skill, no skill sits in more than 2
 * kits, every kit skill works with the class weapon, and a kit never repeats a kind + delivery + extra.
 *
 * Discovery (`discover.requires`): Commons — land 60 hits with the weapon; Uncommons — know the element and defeat
 * 20 foes with it while holding the weapon; the rest — what the spec asks, as far as today's counters reach (their
 * deeds and Trials arrive with their phases). Counters the game keeps: `hits:<weapon>`, `kills:<weapon>:<element>`.
 *
 * Until Phase 2 turns Keepsakes into mastered Gifts, every class still gets its old Keepsake (`imprint_<id>`) from
 * `classTreeTemplate`, built with the v2 `tier` and `tree` knobs kept here for that purpose only; the tree nodes
 * themselves do nothing any more. All of those PassiveDefs are exported as CLASS_PASSIVES.
 *
 * Power budget (SPEC-v4 §3.5): a worn `bonus` adds at most 10 damage points to any one skill.
 */

/** A class as authored here: everything but `tree`/`imprint`, plus the template knobs that build the Keepsake. */
interface ClassSeed extends Omit<ClassDefV4, 'tree' | 'imprint'> {
  tree: Pick<ClassTreeSpec, 'tag' | 'tag2' | 'stat' | 'skillNode'>;
}

// ------------------------------------------------------------------ discovery helpers

const WEAPON_WORD: Record<WeaponType, string> = { sword: 'a sword', dagger: 'a dagger', staff: 'a rod', fists: 'bare hands' };
const HOLDING: Record<WeaponType, string> = { sword: 'holding a sword', dagger: 'holding a dagger', staff: 'holding a rod', fists: 'bare-handed' };

/** Common: use the weapon. */
const hits = (weapon: WeaponType, min = 60): Requirement => ({
  type: 'flag',
  id: `hits:${weapon}`,
  min,
  label: `Land ${min} hits with ${WEAPON_WORD[weapon]}`,
});
/** Uncommon: know the element and defeat foes with it while holding the weapon. */
const kills = (weapon: WeaponType, element: string, min = 20): Requirement => ({
  type: 'flag',
  id: `kills:${weapon}:${element}`,
  min,
  label: `Defeat ${min} foes with ${element} while ${HOLDING[weapon]}`,
});
const know = (id: Extract<Requirement, { type: 'element' }>['id']): Requirement => ({ type: 'element', id });
const master = (id: string): Requirement => ({ type: 'class', id, rank: 10 });

const STORM_RELIC: Requirement = { type: 'flag', id: 'relic_storm', min: 1, label: "Claim Thunderhoof's storm relic" };
const DUSK_RELIC: Requirement = { type: 'flag', id: 'relic_dusk', min: 1, label: "Claim the Hollow Regent's relic" };

// ------------------------------------------------------------------ mechanics

/** Legacy kits (§3.7): 3 different class-weapon skills in a row, the 3rd hits 20% harder. */
const RHYTHM: ClassMechanic = {
  kind: 'combo',
  name: 'Rhythm',
  length: 3,
  distinct: true,
  finisher: { name: 'Finisher', boost: { powerPct: 20 } },
  autoRule: { spend: 'atMax' },
};

/** Blademaster — 3 different sword skills in a row make the 3rd a Finisher: it always crits and reaches further. */
const CADENCE: ClassMechanic = {
  kind: 'combo',
  name: 'Cadence',
  length: 3,
  distinct: true,
  filter: { weapon: 'sword' },
  finisher: { name: 'Finisher', boost: { crit: true, sizePct: 30 } },
  autoRule: { spend: 'atMax' },
};

/** Knife Juggler — +1 per thrown knife that hits (max 5), lost after 4 s without one; faster throws, piercing at 5. */
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

/** Spellwright — 3 different Rod spells in a row and the 4th is a Weave: free and half again as big. */
const WEAVE: ClassMechanic = {
  kind: 'combo',
  name: 'Weave',
  length: 4,
  distinct: true,
  filter: { weapon: 'staff' },
  finisher: { name: 'Weave', boost: { free: true, sizePct: 50 } },
  autoRule: { spend: 'atMax' },
};

/** Wayfarer — Jab, Jab, then any class skill lands as a Roadhouse hit: bigger, and it knocks the foe back. */
const ROAD_RHYTHM: ClassMechanic = {
  kind: 'combo',
  name: 'Road Rhythm',
  length: 3,
  distinct: false,
  lead: 'basic',
  finisher: { name: 'Roadhouse', boost: { sizePct: 40, status: 'knockback' } },
  autoRule: { spend: 'atMax' },
};

/** Pyroblade — +1 per sword hit (max 10), fades after 3 s idle; at 10 the next class skill costs HP and is twice the size. */
const HEAT: ClassMechanic = {
  kind: 'gauge',
  name: 'Heat',
  max: 10,
  fill: [{ on: 'hit', weapon: 'sword', amount: 1 }],
  decay: { afterMs: 3000, perSec: 2 },
  effects: [{ do: 'nextSkill', at: 'max', filter: { of: 'kit' }, boost: { hpCostPct: 6, sizePct: 100 } }],
  autoRule: { spend: 'atMax' },
};

/** Shadowstalker — Shadow Pin and Stitch pin a foe (held 2 s); half the damage dealt meanwhile lands when the pin ends. */
const PINNED: ClassMechanic = {
  kind: 'marks',
  name: 'Pinned Shadow',
  max: 1,
  applyOn: 'skillTag',
  perMark: { store: 0.5, status: 'root', statusMs: 2000, lifeMs: 2000 },
  spendWith: 'second_shadow',
  autoRule: { spend: 'atMax' },
};

/** Pyromancer — one Hearth; kills near it feed it (5 levels); +3% MATK per level near it; Hurl Hearth throws it. */
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

/** Tidereader — the tide turns by itself every 6 s: High Tide wide and pushing, Low Tide narrow, pulling, 25% harder. */
const TIDE: ClassMechanic = {
  kind: 'stance',
  names: ['High Tide', 'Low Tide'],
  swap: { everyMs: 6000 },
  remap: {},
  boosts: [
    { sizePct: 30, status: 'knockback' },
    { sizePct: -20, powerPct: 25, status: 'pull' },
  ],
  autoRule: { swap: 'never' },
};

/**
 * The one line the HUD says the first time a class's widget shows (docs/UX-SIMPLE.md rule 9: plain words, at most 60
 * characters, the mechanic's own name is put in front by the HUD). Legacy kits share RHYTHM_HINT.
 */
export const RHYTHM_HINT = 'Three different skills in a row. The third hits harder.';
export const MECHANIC_HINTS: Readonly<Record<string, string>> = {
  blademaster: 'Three different sword skills. The third always crits.',
  knife_juggler: 'Each thrown knife that hits makes the next one faster.',
  arcanist: 'Three different rod spells. The fourth is free and bigger.',
  wayfarer: 'Jab, Jab, then a class skill lands a Roadhouse hit.',
  pyroblade: 'Sword hits build Heat. Full, your next class skill is huge.',
  shadowstalker: 'Pin a foe. Half your damage lands again when the pin ends.',
  pyromancer: 'Fight near your Hearth. Kills beside it make it grow.',
  tidecaller: 'The tide turns by itself. High pushes, Low pulls harder.',
};

// ------------------------------------------------------------------ the classes

const SEEDS: ClassSeed[] = [
  // ================================================================ the four Commons (rebuilt)
  {
    id: 'blademaster',
    name: 'Blademaster',
    icon: '⚔️',
    desc: 'Wins by never wasting a swing.',
    hint: 'Sixty honest swings, and the sword starts keeping count.',
    rarity: 'common',
    weapon: 'sword',
    source: 'physical',
    mechanic: CADENCE,
    mechanicUpgrade: { line: 'Finishers reach even further.', mechanic: { ...CADENCE, finisher: { name: 'Finisher', boost: { crit: true, sizePct: 50 } } } },
    kit: ['blade_aura', 'three_beat_cut', 'turning_edge', 'closing_step', 'last_word'],
    passive: 'clean_edge',
    discover: { requires: [hits('sword')] },
    bonus: { atk: 7, crit: 3 },
    tier: 1,
    tree: { tag: 'blade', tag2: 'melee', stat: 'atk' },
  },
  {
    id: 'knife_juggler',
    name: 'Knife Juggler',
    icon: '🃏',
    desc: 'There is always another knife.',
    hint: 'Sixty quick stabs, and your hand wants a second knife.',
    rarity: 'common',
    weapon: 'dagger',
    source: 'physical',
    mechanic: JUGGLE,
    mechanicUpgrade: { line: 'You can keep six knives in the air.', mechanic: { ...JUGGLE, max: 6 } },
    kit: ['cascade', 'behind_the_back', 'caltrop_scatter', 'encore', 'high_toss'],
    passive: 'spare_knife',
    discover: { requires: [hits('dagger')] },
    bonus: { tagPower: { projectile: 10 }, speed: 5 },
    tier: 1,
    tree: { tag: 'projectile', tag2: 'pierce', stat: 'crit' },
  },
  {
    id: 'arcanist',
    name: 'Spellwright',
    icon: '🔮',
    desc: 'A scholar who weaves plain magic well.',
    hint: 'Sixty bolts from a rod, and the threads between them show.',
    rarity: 'common',
    weapon: 'staff',
    source: 'physical',
    mechanic: WEAVE,
    mechanicUpgrade: { line: 'A Weave is bigger still.', mechanic: { ...WEAVE, finisher: { name: 'Weave', boost: { free: true, sizePct: 75 } } } },
    kit: ['mana_surge', 'thread_bolt', 'loom', 'knot', 'unravel'],
    passive: 'tidy_weave',
    discover: { requires: [hits('staff')] },
    bonus: { matk: 7, sp: 10 },
    tier: 1,
    tree: { tag: 'arcane', tag2: 'aoe', stat: 'matk' },
  },
  {
    id: 'wayfarer',
    name: 'Wayfarer',
    icon: '🥾',
    desc: 'A traveller who settles things by hand.',
    hint: 'Put the weapon down. Sixty blows by hand teach the rest.',
    rarity: 'common',
    weapon: 'fists',
    source: 'physical',
    mechanic: ROAD_RHYTHM,
    mechanicUpgrade: {
      line: 'A Roadhouse hit lands harder.',
      mechanic: { ...ROAD_RHYTHM, finisher: { name: 'Roadhouse', boost: { sizePct: 40, powerPct: 15, status: 'knockback' } } },
    },
    kit: ['roadhouse', 'dust_kick', 'walk_it_off', 'long_stride', 'shoulder_roll'],
    passive: 'road_legs',
    discover: { requires: [hits('fists')] },
    bonus: { speed: 12, cdr: 5 },
    tier: 1,
    tree: { tag: 'dash', tag2: 'buff', stat: 'speed' },
  },

  // ================================================================ the four rebuilt Uncommons
  {
    id: 'pyroblade',
    name: 'Pyroblade',
    icon: '🔥',
    desc: 'Sword forms that breathe like a bellows.',
    hint: 'Carry the forge fire on a sword through twenty fights.',
    rarity: 'uncommon',
    weapon: 'sword',
    source: 'fire',
    mechanic: HEAT,
    mechanicUpgrade: { line: 'Heat fades more slowly.', mechanic: { ...HEAT, decay: { afterMs: 5000, perSec: 2 } } },
    kit: ['searing_edge', 'bellows_cut', 'cinder_line', 'slag_arc', 'white_heat'],
    passive: 'banked_coals',
    discover: { requires: [know('fire'), kills('sword', 'fire')] },
    bonus: { atk: 3, hp: 5, tagPower: { fire: 4 } },
    tier: 1,
    tree: { tag: 'fire', tag2: 'blade', stat: 'atk' },
  },
  {
    id: 'shadowstalker',
    name: 'Shadowstalker',
    icon: '🦇',
    desc: "Sews an enemy's shadow to the floor.",
    hint: 'A dagger, the dark, and twenty foes who saw neither.',
    rarity: 'uncommon',
    weapon: 'dagger',
    source: 'shadow',
    mechanic: PINNED,
    mechanicUpgrade: {
      line: 'A pinned shadow holds a second longer.',
      mechanic: { ...PINNED, perMark: { store: 0.5, status: 'root', statusMs: 3000, lifeMs: 3000 } },
    },
    kit: ['shade_cloak', 'shadow_pin', 'second_shadow', 'stitch', 'lights_out'],
    passive: 'from_nowhere',
    discover: { requires: [know('shadow'), kills('dagger', 'shadow')] },
    bonus: { crit: 10, atk: 6 },
    tier: 1,
    tree: { tag: 'stealth', tag2: 'dash', stat: 'crit' },
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    icon: '🌋',
    desc: 'Tends a fire that must not go out.',
    hint: 'Burn twenty foes through a rod. Then give the fire a home.',
    rarity: 'uncommon',
    weapon: 'staff',
    source: 'fire',
    mechanic: HEARTH,
    mechanicUpgrade: {
      line: 'Your Hearth warms your magic more.',
      mechanic: { ...HEARTH, near: { tiles: 3, effects: [{ do: 'perPoint', stat: 'matk', pct: 4 }] } },
    },
    kit: ['kindle_hearth', 'hurl_hearth', 'stoke', 'ember_flock', 'backdraft'],
    passive: 'warm_hands',
    discover: { requires: [know('fire'), kills('staff', 'fire')] },
    bonus: { matk: 3, sp: 5, tagPower: { fire: 4 } },
    tier: 1,
    tree: { tag: 'fire', tag2: 'arcane', stat: 'matk' },
  },
  {
    id: 'tidecaller',
    name: 'Tidereader',
    icon: '🌊',
    desc: 'The tide turns whether you are ready or not.',
    hint: 'Call the water through a rod until you feel it turn.',
    rarity: 'uncommon',
    weapon: 'staff',
    source: 'water',
    mechanic: TIDE,
    mechanicUpgrade: { line: 'The tide turns faster.', mechanic: { ...TIDE, swap: { everyMs: 5000 } } },
    kit: ['tidal_hand', 'breakwater', 'tide_pool', 'undertow', 'moon_pull'],
    passive: 'ebb_and_flow',
    discover: { requires: [know('water'), kills('staff', 'water')] },
    bonus: { hp: 10, sp: 10, tagPower: { water: 10 } },
    tier: 1,
    tree: { tag: 'water', stat: 'sp' },
  },

  // ================================================================ legacy kits · sword
  {
    id: 'windblade',
    name: 'Windblade',
    icon: '🍃',
    desc: 'Lets the wind do half the cutting.',
    hint: 'A sword that rides the wind instead of cutting through it.',
    rarity: 'uncommon',
    weapon: 'sword',
    source: 'wind',
    mechanic: RHYTHM,
    kit: ['windblade_sig', 'tornado', 'wind_cutter', 'crescent_sweep', 'whirlwind'],
    discover: { requires: [know('wind'), kills('sword', 'wind')] },
    bonus: { atk: 4, speed: 6, tagPower: { wind: 6 } },
    tier: 1,
    tree: { tag: 'wind', tag2: 'blade', stat: 'speed' },
  },
  {
    id: 'paladin',
    name: 'Oathsworn',
    icon: '🛡️',
    desc: 'Names a vow before the fight and keeps it.',
    hint: 'Swear one holy oath and keep it on a sword.',
    rarity: 'uncommon',
    weapon: 'sword',
    source: 'holy',
    mechanic: RHYTHM,
    kit: ['radiant_burst', 'halo_ward', 'heavy_cleave', 'holy_light', 'sanctuary'],
    discover: { requires: [know('holy'), kills('sword', 'holy')] },
    bonus: { hp: 15, atk: 4, tagPower: { holy: 6 } },
    tier: 1,
    tree: { tag: 'holy', tag2: 'blade', stat: 'def' },
  },
  {
    id: 'runeknight',
    name: 'Glyphwarden',
    icon: '⚜️',
    desc: 'Carves runes into steel, and the steel into the ground.',
    hint: 'Drive a sword into stone until the stone answers.',
    rarity: 'rare',
    weapon: 'sword',
    source: 'earth',
    mechanic: RHYTHM,
    kit: ['runeknight_sig', 'earthsplitter', 'rockslide_charge', 'millstone_whirl', 'crystal_mallet'],
    discover: {
      requires: [know('earth'), kills('sword', 'earth'), { type: 'flag', id: 'ore_mined', min: 10, label: 'Mine 10 ore' }],
    },
    bonus: { atk: 4, matk: 4, hp: 15, tagPower: { earth: 6 } },
    tier: 2,
    tree: { tag: 'earth', tag2: 'blade', stat: 'def' },
  },
  {
    id: 'stormreaver',
    name: 'Stormwhirl',
    icon: '⚡',
    desc: 'Catches lightning mid-air and spins it into a wheel.',
    hint: 'Catch the thunder on a sword and learn to spin it.',
    rarity: 'rare',
    weapon: 'sword',
    source: 'lightning',
    mechanic: RHYTHM,
    kit: ['stormreaver_sig', 'thunder_javelin', 'thunder_tether', 'static_field', 'cyclone_blades'],
    discover: { requires: [know('lightning'), kills('sword', 'lightning', 30)] },
    bonus: { speed: 6, sp: 10, tagPower: { lightning: 6, spin: 4 } },
    tier: 2,
    tree: { tag: 'lightning', tag2: 'spin', stat: 'speed' },
  },
  {
    id: 'magma_knight',
    name: 'Magma Knight',
    icon: '☄️',
    desc: 'A blade half molten that keeps getting heavier.',
    hint: 'A master Pyroblade who learns how stone melts.',
    rarity: 'rare',
    weapon: 'sword',
    source: 'magma',
    mechanic: RHYTHM,
    kit: ['magma_knight_sig', 'flame_spin', 'firestorm', 'cleaver_toss', 'guillotine'],
    discover: { requires: [master('pyroblade'), know('magma')] },
    bonus: { atk: 4, hp: 15, tagPower: { fire: 3, magma: 3 } },
    tier: 2,
    tree: { tag: 'heavy', tag2: 'fire', stat: 'hp' },
  },
  {
    id: 'spellblade',
    name: 'Spellblade',
    icon: '🔱',
    desc: 'Steel and sorcery in one hand.',
    hint: 'Hold a sword and cast anyway. Three elements will do.',
    rarity: 'rare',
    weapon: 'sword',
    source: 'none',
    mechanic: RHYTHM,
    kit: ['runic_blade', 'spell_sabre', 'focus', 'lightning_bolt', 'meteor'],
    discover: { requires: [{ type: 'elementsKnown', count: 3 }, hits('sword', 300)] },
    bonus: { atk: 7, matk: 7 },
    tier: 1,
    tree: { tag: 'arcane', tag2: 'blade', stat: 'atk' },
  },
  {
    id: 'sword_saint',
    name: 'Sword Saint',
    icon: '🗡️',
    desc: 'The sword is no longer held. It is part of the arm.',
    hint: 'When a Blademaster has nothing left to learn.',
    rarity: 'epic',
    weapon: 'sword',
    source: 'physical',
    mechanic: RHYTHM,
    kit: ['sword_saint_sig', 'tempest_waltz', 'hundredfold_edge', 'worldbreaker', 'spirit_crescent'],
    discover: { requires: [master('blademaster'), hits('sword', 1000)] },
    bonus: { atk: 5, crit: 12, tagPower: { blade: 5 } },
    tier: 2,
    tree: { tag: 'blade', tag2: 'melee', stat: 'crit' },
  },
  {
    id: 'ascendant',
    name: 'Ascendant',
    icon: '🌟',
    desc: 'Stands in the eye of the storm and waits.',
    hint: "A master of the Stormwhirl, crowned with the storm's horn.",
    rarity: 'epic',
    weapon: 'sword',
    source: 'storm',
    mechanic: RHYTHM,
    kit: ['ascendant_sig', 'thunderstorm', 'arcane_cyclone', 'plasma_lance', 'boomerang_blade'],
    discover: { requires: [master('stormreaver'), STORM_RELIC] },
    bonus: { atk: 4, matk: 7, crit: 10, cdr: 8, tagPower: { arcane: 3 } },
    tier: 3,
    tree: { tag: 'arcane', tag2: 'blade', stat: 'atk' },
  },

  // ================================================================ legacy kits · dagger
  {
    id: 'tempest_dancer',
    name: 'Tempest Dancer',
    icon: '🌪️',
    desc: 'Never still. Always spinning.',
    hint: 'Turn with a dagger and the wind until it is a dance.',
    rarity: 'uncommon',
    weapon: 'dagger',
    source: 'wind',
    mechanic: RHYTHM,
    kit: ['eye_of_the_storm', 'vortex_dancer_sig', 'gyre_knives', 'fletched_fan', 'blade_storm'],
    discover: { requires: [know('wind'), kills('dagger', 'wind')] },
    bonus: { speed: 8, tagPower: { spin: 10 } },
    tier: 1,
    tree: { tag: 'spin', tag2: 'aoe', stat: 'speed' },
  },
  {
    id: 'assassin',
    name: 'Hushblade',
    icon: '☠️',
    desc: 'One perfect strike ends the fight.',
    hint: 'Learn the strike that ends a fight. Then make it quiet.',
    rarity: 'rare',
    weapon: 'dagger',
    source: 'physical',
    mechanic: RHYTHM,
    kit: ['backstab', 'assassinate', 'phantom_sig', 'smoke_veil', 'venom_edge'],
    discover: { requires: [{ type: 'skill', id: 'assassinate' }, hits('dagger', 300)] },
    bonus: { crit: 15, tagPower: { execute: 10 } },
    tier: 1,
    tree: { tag: 'execute', tag2: 'stealth', stat: 'crit' },
  },
  {
    id: 'eclipse_walker',
    name: 'Eclipse Walker',
    icon: '🌑',
    desc: 'Works in the minute between sunset and night.',
    hint: "A master Shadowstalker with the Regent's seal, at dusk.",
    rarity: 'epic',
    weapon: 'dagger',
    source: 'twilight',
    mechanic: RHYTHM,
    kit: ['eclipse_walker_sig', 'umbral_strike', 'moonveil', 'gloom_shroud', 'coffin_nail'],
    discover: { requires: [master('shadowstalker'), know('twilight'), DUSK_RELIC] },
    bonus: { crit: 15, speed: 10, cdr: 8, tagPower: { twilight: 6, stealth: 4 } },
    tier: 3,
    tree: { tag: 'twilight', tag2: 'stealth', stat: 'crit' },
  },

  // ================================================================ legacy kits · rod
  {
    id: 'stormcaller',
    name: 'Stormcaller',
    icon: '⛈️',
    desc: 'Carries a lantern that bottles strikes.',
    hint: 'Twenty claps of thunder through a rod, and it answers.',
    rarity: 'uncommon',
    weapon: 'staff',
    source: 'lightning',
    mechanic: RHYTHM,
    kit: ['thunder_peal', 'static_palm', 'featherstorm', 'singularity', 'resonant_pulse'],
    discover: { requires: [know('lightning'), kills('staff', 'lightning')] },
    bonus: { sp: 5, speed: 4, tagPower: { lightning: 5, wind: 2 } },
    tier: 1,
    tree: { tag: 'lightning', tag2: 'wind', stat: 'matk' },
  },
  {
    id: 'earthshaper',
    name: 'Earthshaper',
    icon: '⛰️',
    desc: 'Gardens the battlefield in stone.',
    hint: 'Strike the ground in its own tongue until it knows you.',
    rarity: 'uncommon',
    weapon: 'staff',
    source: 'earth',
    mechanic: RHYTHM,
    kit: ['quake', 'geode_maw', 'quakestride', 'crown_slam', 'tangle_orb'],
    discover: { requires: [know('earth'), kills('staff', 'earth')] },
    bonus: { hp: 15, tagPower: { earth: 10 } },
    tier: 1,
    tree: { tag: 'earth', tag2: 'heavy', stat: 'hp' },
  },
  {
    id: 'elementalist',
    name: 'Prismcaller',
    icon: '🌈',
    desc: 'One voice, every colour.',
    hint: 'Three elements, three colours, answering one rod.',
    rarity: 'rare',
    weapon: 'staff',
    source: 'prism',
    mechanic: RHYTHM,
    kit: ['prism_burst', 'prism_sage_sig', 'glacial_orb', 'inferno_ring', 'tidal_ripple'],
    discover: { requires: [{ type: 'elementsKnown', count: 3 }, hits('staff', 150)] },
    bonus: { atk: 8, matk: 8 },
    tier: 1,
    tree: { tag: 'infused', tag2: 'aoe', stat: 'sp' },
  },
  {
    id: 'twilight_sage',
    name: 'Twilight Sage',
    icon: '🌗',
    desc: 'Holds a scale between day and night.',
    hint: 'Neither dawn nor dusk. Hold the hour between them.',
    rarity: 'rare',
    weapon: 'staff',
    source: 'twilight',
    mechanic: RHYTHM,
    kit: ['grave_hook', 'astral_form', 'starfall_lattice', 'arcane_barrage', 'dawn_prism'],
    discover: { requires: [know('twilight'), hits('staff', 150)] },
    bonus: { matk: 4, cdr: 10, tagPower: { twilight: 3 } },
    tier: 1,
    tree: { tag: 'twilight', tag2: 'arcane', stat: 'matk' },
  },
  {
    id: 'moonwarden',
    name: 'Moonwarden',
    icon: '🌕',
    desc: 'Keeps watch so others may rest.',
    hint: 'Stand in the glade no map shows, holding one holy light.',
    rarity: 'rare',
    weapon: 'staff',
    source: 'holy',
    mechanic: RHYTHM,
    kit: ['moonwarden_sig', 'mending_light', 'arcane_ward', 'arcane_orb', 'arcane_nova'],
    discover: { requires: [know('holy'), { type: 'mapVisited', id: 'vale.moonlit_glade' }] },
    bonus: { hp: 10, sp: 10, cdr: 5, tagPower: { holy: 10 } },
    tier: 1,
    tree: { tag: 'holy', tag2: 'spirit', stat: 'hp' },
    hidden: true,
  },
  {
    id: 'archmage',
    name: 'Archmage',
    icon: '🧙',
    desc: 'Has read every book on magic and written the rest.',
    hint: 'A Spellwright at the very end of study.',
    rarity: 'epic',
    weapon: 'staff',
    source: 'physical',
    mechanic: RHYTHM,
    kit: ['archmage_sig', 'arcane_deluge', 'prism_orb', 'quicken', 'hex_blade'],
    discover: { requires: [master('arcanist'), hits('staff', 1000)] },
    bonus: { matk: 5, sp: 15, cdr: 5, tagPower: { arcane: 2 } },
    tier: 2,
    tree: { tag: 'arcane', tag2: 'aoe', stat: 'matk' },
  },

  // ================================================================ legacy kit · any weapon
  {
    id: 'mimic',
    name: 'Mimic',
    icon: '🎭',
    desc: 'Answers every monster in its own voice.',
    hint: 'Listen to five monsters until you answer in their voices.',
    rarity: 'epic',
    weapon: 'any',
    source: 'none',
    mechanic: RHYTHM,
    kit: ['mimic_sig', 'echo_sovereign_sig', 'hook_pull', 'net_throw', 'hammer_toss'],
    discover: { requires: [{ type: 'tagCount', tags: ['echo'], count: 5 }] },
    bonus: { sp: 10, tagPower: { echo: 10 } },
    tier: 1,
    tree: { tag: 'echo', tag2: 'aoe', stat: 'sp' },
  },
];

const BUILT = SEEDS.map(({ tree, ...def }) => {
  const t = classTreeTemplate({ classId: def.id, className: def.name, tier: def.tier, icon: def.icon, ...tree });
  const cls: ClassDefV4 = { ...def, tree: t.nodes, imprint: t.imprint.id };
  return { cls, passives: [...t.passives, t.imprint] };
});

export const CLASSES: ClassDef[] = BUILT.map((b) => b.cls);

/** The classes that have their own mechanic, class skills and Gift already (the rest run on legacy kits). */
export const REBUILT: readonly string[] = SEEDS.filter((c) => c.passive !== undefined).map((c) => c.id);

/** Every old class tree passive (`cls_<classId>_<n>`, unused by the rules) and today's Keepsake (`imprint_<classId>`). */
export const CLASS_PASSIVES: PassiveDef[] = BUILT.flatMap((b) => b.passives);
