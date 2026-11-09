import { classTreeTemplate, type ClassTreeSpec } from '../core/balance';
import type { ClassDef, PassiveDef, Requirement } from '../core/types';

/**
 * Classes (SPEC-v2 §5 / §8). Classes are never chosen from a menu — they are discovered when the
 * player's skill collection matches a pattern. Element ids and weapon types count as tags.
 *
 * - Tier I (18 + hidden Moonwarden): v1 permissive counting (any known skill, variants included).
 * - Tier II (8 + hidden Echo Sovereign) and Tier III (2): hardened — only distinct authored skills at
 *   rank >= 5 count (a variant counts as its base), every parent at its Class Rank, every `requires` met.
 *
 * Every class gets its tree + imprint from `classTreeTemplate`; all of those PassiveDefs are exported as
 * CLASS_PASSIVES and registered by src/data/index.ts. Signature skills live in skills/signatures.ts.
 *
 * Class power budget (SPEC §5, enforced by tests/class-budget.test.ts): for any single skill, the worn
 * class's bonus (Σ tagPower over the skill's tags + its ATK or MATK %, the tree's atk/matk node included)
 * + its maxed tree power nodes + capstone + the 3 best slottable imprints at their strengths <= 25 points.
 * The template (balance.CLASS_TREE_POWER) takes 15 of them in the worst case (18 with an atk/matk tree
 * node), so a worn `bonus` may add at most 10 damage points to any one skill (7 with an atk/matk node):
 * the hybrid stat is max(atk, matk), and tagPower entries a single skill can carry together add up.
 * Non-damage stats stay within speed <= 12, crit <= 15, cdr <= 10, hp/sp <= 15.
 */

/** A class as authored here: everything but `tree`/`imprint`, plus the template knobs that build them. */
interface ClassSeed extends Omit<ClassDef, 'tree' | 'imprint'> {
  tree: Pick<ClassTreeSpec, 'tag' | 'tag2' | 'stat' | 'skillNode'>;
}

const STORM_RELIC: Requirement = { type: 'flag', id: 'relic_storm', min: 1, label: "Claim Thunderhoof's storm relic" };
const DUSK_RELIC: Requirement = { type: 'flag', id: 'relic_dusk', min: 1, label: "Claim the Hollow Regent's relic" };

const SEEDS: ClassSeed[] = [
  // ================================================================ Tier I (v1 ids, clauses, grants)
  {
    id: 'blademaster',
    name: 'Blademaster',
    icon: '⚔️',
    desc: 'A student of every way of the sword.',
    hint: 'One hand, four edges: learn four different ways a blade can cut.',
    tier: 1,
    clauses: [{ tags: ['blade'], count: 4 }],
    bonus: { atk: 7, crit: 3 },
    grants: ['blade_aura'],
    tree: { tag: 'blade', tag2: 'melee', stat: 'atk' },
  },
  {
    id: 'tempest_dancer',
    name: 'Tempest Dancer',
    icon: '🌪️',
    desc: 'Never still. Always spinning.',
    hint: 'Turn once and it is a step; turn twice, a dance. Know three ways to turn, and become the storm.',
    tier: 1,
    clauses: [{ tags: ['spin'], count: 3 }],
    bonus: { speed: 8, tagPower: { spin: 10 } },
    grants: ['eye_of_the_storm'],
    tree: { tag: 'spin', tag2: 'aoe', stat: 'speed' },
  },
  {
    id: 'pyroblade',
    name: 'Pyroblade',
    icon: '🔥',
    desc: 'A swordsman whose edge is always burning.',
    hint: "The forge's fire need not stay in the forge. Carry it on an edge — then on a second.",
    tier: 1,
    clauses: [{ tags: ['blade', 'fire'], count: 2 }],
    bonus: { atk: 3, hp: 5, tagPower: { fire: 4 } },
    grants: ['searing_edge'],
    tree: { tag: 'fire', tag2: 'blade', stat: 'atk' },
  },
  {
    id: 'shadowstalker',
    name: 'Shadowstalker',
    icon: '🦇',
    desc: 'Moves unseen, strikes unseen, leaves unseen.',
    hint: 'Three times unseen: in the approach, in the strike, and in the leaving.',
    tier: 1,
    clauses: [{ tags: ['stealth'], count: 3 }],
    bonus: { crit: 10 },
    grants: ['shade_cloak'],
    tree: { tag: 'stealth', tag2: 'dash', stat: 'crit' },
  },
  {
    id: 'knife_juggler',
    name: 'Knife Juggler',
    icon: '🃏',
    desc: 'There is always another knife.',
    hint: 'Three sharp points that leave your hand and fly. Keep them all in the air at once.',
    tier: 1,
    clauses: [{ tags: ['pierce', 'projectile'], count: 3 }],
    bonus: { tagPower: { projectile: 10 }, speed: 5 },
    tree: { tag: 'projectile', tag2: 'pierce', stat: 'crit' },
  },
  {
    id: 'assassin',
    name: 'Nightblade',
    icon: '☠️',
    desc: 'One perfect strike ends a fight.',
    hint: 'Hide twice, then end it once. The final blow should come from nowhere.',
    tier: 1,
    clauses: [
      { tags: ['execute'], count: 1 },
      { tags: ['stealth'], count: 2 },
    ],
    bonus: { crit: 15, tagPower: { execute: 10 } },
    tree: { tag: 'execute', tag2: 'stealth', stat: 'crit', skillNode: 'shade_cloak' },
  },
  {
    id: 'arcanist',
    name: 'Arcanist',
    icon: '🔮',
    desc: 'A scholar of pure, unaligned magic.',
    hint: 'Four spells that wear no colour but their own.',
    tier: 1,
    clauses: [{ tags: ['arcane'], count: 4 }],
    bonus: { matk: 7, sp: 10 },
    grants: ['mana_surge'],
    tree: { tag: 'arcane', tag2: 'aoe', stat: 'matk' },
  },
  {
    id: 'pyromancer',
    name: 'Pyromancer',
    icon: '🌋',
    desc: 'Magic that burns.',
    hint: 'Speak a spell and set it alight. Then speak another, and burn that one too.',
    tier: 1,
    clauses: [{ tags: ['arcane', 'fire'], count: 2 }],
    bonus: { matk: 3, sp: 5, tagPower: { fire: 4 } },
    tree: { tag: 'fire', tag2: 'arcane', stat: 'matk', skillNode: 'mana_surge' },
  },
  {
    id: 'tidecaller',
    name: 'Tidecaller',
    icon: '🌊',
    desc: 'The tide answers when called.',
    hint: 'Call the water once and it ripples. Call it twice and the tide learns your name.',
    tier: 1,
    clauses: [{ tags: ['water'], count: 2 }],
    bonus: { hp: 10, sp: 10, tagPower: { water: 10 } },
    tree: { tag: 'water', stat: 'sp' },
  },
  {
    id: 'stormcaller',
    name: 'Stormcaller',
    icon: '⛈️',
    desc: 'Thunder and gale obey.',
    hint: 'Two claps of thunder, and one breath of wind to carry them.',
    tier: 1,
    clauses: [
      { tags: ['lightning'], count: 2 },
      { tags: ['wind'], count: 1 },
    ],
    bonus: { sp: 5, speed: 4, tagPower: { lightning: 5, wind: 2 } },
    tree: { tag: 'lightning', tag2: 'wind', stat: 'matk', skillNode: 'eye_of_the_storm' },
  },
  {
    id: 'earthshaper',
    name: 'Earthshaper',
    icon: '⛰️',
    desc: 'The ground remembers you.',
    hint: 'Strike the ground twice in its own tongue, and it will remember you.',
    tier: 1,
    clauses: [{ tags: ['earth'], count: 2 }],
    bonus: { hp: 15, tagPower: { earth: 10 } },
    tree: { tag: 'earth', tag2: 'heavy', stat: 'hp' },
  },
  {
    id: 'elementalist',
    name: 'Elementalist',
    icon: '🌈',
    desc: 'Commands many elements at once.',
    hint: 'Three elements, each a different colour, answering a single voice.',
    tier: 1,
    clauses: [],
    distinctElements: 3,
    bonus: { atk: 8, matk: 8 },
    grants: ['prism_burst'],
    tree: { tag: 'infused', tag2: 'aoe', stat: 'sp' },
  },
  {
    id: 'spellblade',
    name: 'Spellblade',
    icon: '🔱',
    desc: 'Steel and sorcery, joined.',
    hint: 'Two edges and two incantations: let steel and sorcery share one hand.',
    tier: 1,
    clauses: [
      { tags: ['blade'], count: 2 },
      { tags: ['arcane'], count: 2 },
    ],
    bonus: { atk: 7, matk: 7 },
    grants: ['runic_blade'],
    tree: { tag: 'arcane', tag2: 'blade', stat: 'atk' },
  },
  {
    id: 'wayfarer',
    name: 'Wayfarer',
    icon: '🥾',
    desc: 'Always moving, never tiring.',
    hint: 'Two ways to cross the ground in a blink, and one way to steady yourself between.',
    tier: 1,
    clauses: [
      { tags: ['dash'], count: 2 },
      { tags: ['buff'], count: 1 },
    ],
    bonus: { speed: 12, cdr: 5 },
    tree: { tag: 'dash', tag2: 'buff', stat: 'speed', skillNode: 'windblade_sig' },
  },
  {
    id: 'paladin',
    name: 'Oathsworn',
    icon: '🛡️',
    desc: 'A holy oath sworn upon many blades.',
    hint: 'Swear one holy oath, then seal it upon three edges.',
    tier: 1,
    clauses: [
      { tags: ['holy'], count: 1 },
      { tags: ['blade'], count: 3 },
    ],
    bonus: { hp: 15, atk: 4, tagPower: { holy: 6 } },
    tree: { tag: 'holy', tag2: 'blade', stat: 'def', skillNode: 'blade_aura' },
  },
  {
    id: 'twilight_sage',
    name: 'Twilight Sage',
    icon: '🌗',
    desc: 'Walks the hidden path between light and dark.',
    hint: 'Neither dawn nor dusk but the hour between them — hold it, and three spells to light the way.',
    tier: 1,
    clauses: [
      { tags: ['twilight'], count: 1 },
      { tags: ['arcane'], count: 3 },
    ],
    bonus: { matk: 4, cdr: 10, tagPower: { twilight: 3 } },
    tree: { tag: 'twilight', tag2: 'arcane', stat: 'matk' },
  },

  // ================================================================ Tier I (v2)
  {
    id: 'windblade',
    name: 'Windblade',
    icon: '🍃',
    desc: 'A fencer who lets the wind do half the cutting.',
    hint: 'Two edges that ride the wind instead of cutting through it.',
    tier: 1,
    clauses: [{ tags: ['blade', 'wind'], count: 2 }],
    bonus: { atk: 4, speed: 6, tagPower: { wind: 6 } },
    grants: ['windblade_sig'],
    tree: { tag: 'wind', tag2: 'blade', stat: 'speed' },
  },
  {
    id: 'mimic',
    name: 'Mimic',
    icon: '🎭',
    desc: 'Answers every monster in its own voice.',
    hint: 'Listen to three monsters long enough, and you will start answering in their voices.',
    tier: 1,
    clauses: [{ tags: ['echo'], count: 3 }],
    bonus: { sp: 10, tagPower: { echo: 10 } },
    grants: ['mimic_sig'],
    tree: { tag: 'echo', tag2: 'aoe', stat: 'sp' },
  },
  {
    id: 'moonwarden',
    name: 'Moonwarden',
    icon: '🌕',
    desc: 'Keeper of the glade the moonlight never leaves.',
    hint: 'Beyond the gloom, moths drink moonlight in a glade no map shows. Stand there holding one holy light.',
    tier: 1,
    clauses: [{ tags: ['holy'], count: 1 }],
    requires: [{ type: 'mapVisited', id: 'vale.moonlit_glade' }],
    bonus: { hp: 10, sp: 10, cdr: 5, tagPower: { holy: 10 } },
    grants: ['moonwarden_sig'],
    tree: { tag: 'holy', tag2: 'spirit', stat: 'hp' },
    hidden: true,
  },

  // ================================================================ Tier II
  {
    id: 'sword_saint',
    name: 'Sword Saint',
    icon: '🗡️',
    desc: 'The sword is no longer held. It is simply part of the arm.',
    hint: "When a Blademaster has climbed every level, five edges trained to rank five open the saint's road.",
    tier: 2,
    clauses: [{ tags: ['blade'], count: 5 }],
    parents: [{ id: 'blademaster', rank: 10 }],
    bonus: { atk: 5, crit: 12, tagPower: { blade: 5 } },
    grants: ['sword_saint_sig'],
    tree: { tag: 'blade', tag2: 'melee', stat: 'crit' },
  },
  {
    id: 'magma_knight',
    name: 'Magma Knight',
    icon: '☄️',
    desc: 'Armoured in cooling stone, swinging a blade that never stops burning.',
    hint: 'A Pyroblade at the top of the climb who learns how stone melts: three burning edges, two blows with weight.',
    tier: 2,
    clauses: [
      { tags: ['blade', 'fire'], count: 3 },
      { tags: ['heavy'], count: 2 },
    ],
    parents: [{ id: 'pyroblade', rank: 10 }],
    requires: [{ type: 'element', id: 'magma' }],
    bonus: { atk: 4, hp: 15, tagPower: { fire: 3, magma: 3 } },
    grants: ['magma_knight_sig'],
    tree: { tag: 'heavy', tag2: 'fire', stat: 'hp' },
  },
  {
    id: 'phantom',
    name: 'Phantom',
    icon: '👻',
    desc: 'Not hidden. Simply not there, until it is too late.',
    hint: 'A Shadowstalker who has walked unseen to the end of the path, with four vanishings perfected, becomes no one.',
    tier: 2,
    clauses: [{ tags: ['stealth'], count: 4 }],
    parents: [{ id: 'shadowstalker', rank: 10 }],
    bonus: { crit: 15, speed: 8, tagPower: { stealth: 10 } },
    grants: ['phantom_sig'],
    tree: { tag: 'stealth', tag2: 'dash', stat: 'crit' },
  },
  {
    id: 'archmage',
    name: 'Archmage',
    icon: '🧙',
    desc: 'Has read every book on pure magic, and written the rest.',
    hint: 'An Arcanist at the end of study, holding five pure workings trained to rank five.',
    tier: 2,
    clauses: [{ tags: ['arcane'], count: 5 }],
    parents: [{ id: 'arcanist', rank: 10 }],
    bonus: { matk: 5, sp: 15, cdr: 5, tagPower: { arcane: 2 } },
    grants: ['archmage_sig'],
    tree: { tag: 'arcane', tag2: 'aoe', stat: 'matk' },
  },
  {
    id: 'prism_sage',
    name: 'Prism Sage',
    icon: '💎',
    desc: 'Bends one light into every colour, and every colour back into one.',
    hint: 'A seasoned Elementalist who bends five elements, as glass bends light into its colours.',
    tier: 2,
    clauses: [],
    distinctElements: 5,
    parents: [{ id: 'elementalist', rank: 10 }],
    bonus: { atk: 4, matk: 4, sp: 10, tagPower: { infused: 3 } },
    grants: ['prism_sage_sig'],
    tree: { tag: 'infused', tag2: 'arcane', stat: 'matk' },
  },
  {
    id: 'vortex_dancer',
    name: 'Vortex Dancer',
    icon: '🌀',
    desc: 'The dance no longer stops. The world spins around the dancer.',
    hint: 'A Tempest Dancer who has danced every step: four turns trained until the floor itself spins.',
    tier: 2,
    clauses: [{ tags: ['spin'], count: 4 }],
    parents: [{ id: 'tempest_dancer', rank: 10 }],
    bonus: { speed: 10, tagPower: { spin: 10 } },
    grants: ['vortex_dancer_sig'],
    tree: { tag: 'spin', tag2: 'dash', stat: 'speed' },
  },
  {
    id: 'runeknight',
    name: 'Glyphwarden',
    icon: '⚜️',
    desc: 'Carves runes into steel, and the steel into the ground.',
    hint: 'Etch spells onto steel and drive the steel into stone: a tried Spellblade who is also a tried Earthshaper.',
    tier: 2,
    clauses: [
      { tags: ['blade', 'arcane'], count: 2 },
      { tags: ['earth'], count: 2 },
    ],
    parents: [
      { id: 'spellblade', rank: 6 },
      { id: 'earthshaper', rank: 6 },
    ],
    bonus: { atk: 4, matk: 4, hp: 15, tagPower: { earth: 6 } },
    grants: ['runeknight_sig'],
    tree: { tag: 'earth', tag2: 'blade', stat: 'def' },
  },
  {
    id: 'stormreaver',
    name: 'Stormwhirl',
    icon: '⚡',
    desc: 'Catches the lightning mid-air and spins it into a wheel.',
    hint: 'Catch the thunder and spin it: a tried Stormcaller who also dances the tempest.',
    tier: 2,
    clauses: [
      { tags: ['lightning'], count: 2 },
      { tags: ['spin'], count: 3 },
    ],
    parents: [
      { id: 'stormcaller', rank: 6 },
      { id: 'tempest_dancer', rank: 6 },
    ],
    bonus: { speed: 6, sp: 10, tagPower: { lightning: 6, spin: 4 } },
    grants: ['stormreaver_sig'],
    tree: { tag: 'lightning', tag2: 'spin', stat: 'speed' },
  },
  {
    id: 'echo_sovereign',
    name: 'Echo Sovereign',
    icon: '👑',
    desc: 'No longer copies the monsters. The monsters echo it.',
    hint: 'A Mimic who has borrowed six voices to the full no longer copies the choir. It conducts it.',
    tier: 2,
    clauses: [{ tags: ['echo'], count: 6 }],
    parents: [{ id: 'mimic', rank: 8 }],
    bonus: { hp: 10, sp: 15, tagPower: { echo: 10 } },
    grants: ['echo_sovereign_sig'],
    tree: { tag: 'echo', tag2: 'aoe', stat: 'hp' },
    hidden: true,
  },

  // ================================================================ Tier III
  {
    id: 'ascendant',
    name: 'Ascendant',
    icon: '🌟',
    desc: 'Sword and spell are one motion, and the storm itself bends the knee.',
    hint: 'A saint of the sword who is also master of the arcane, swinging spells as steel — the storm\'s horn crowns them.',
    tier: 3,
    clauses: [
      { tags: ['blade', 'arcane'], count: 2 },
      { tags: ['blade'], count: 6 },
      { tags: ['arcane'], count: 6 },
    ],
    parents: [
      { id: 'sword_saint', rank: 6 },
      { id: 'archmage', rank: 6 },
    ],
    requires: [STORM_RELIC],
    bonus: { atk: 4, matk: 7, crit: 10, cdr: 8, tagPower: { arcane: 3 } },
    grants: ['ascendant_sig'],
    tree: { tag: 'arcane', tag2: 'blade', stat: 'atk', skillNode: 'runic_blade' },
  },
  {
    id: 'eclipse_walker',
    name: 'Eclipse Walker',
    icon: '🌑',
    desc: 'Steps between light and shadow at the moment they cover each other.',
    hint: "When the Phantom's shadow crosses the Prism's light and the Regent's seal is held, the eclipse can be walked.",
    tier: 3,
    clauses: [
      { tags: ['stealth'], count: 5 },
      { tags: ['shadow'], count: 2 },
      { tags: ['holy'], count: 2 },
    ],
    parents: [
      { id: 'phantom', rank: 6 },
      { id: 'prism_sage', rank: 6 },
    ],
    requires: [DUSK_RELIC],
    bonus: { crit: 15, speed: 10, cdr: 8, tagPower: { twilight: 6, stealth: 4 } },
    grants: ['eclipse_walker_sig'],
    tree: { tag: 'twilight', tag2: 'stealth', stat: 'crit', skillNode: 'moonwarden_sig' },
  },
];

const BUILT = SEEDS.map(({ tree, ...def }) => {
  const t = classTreeTemplate({ classId: def.id, className: def.name, tier: def.tier, icon: def.icon, ...tree });
  const cls: ClassDef = { ...def, tree: t.nodes, imprint: t.imprint.id };
  return { cls, passives: [...t.passives, t.imprint] };
});

export const CLASSES: ClassDef[] = BUILT.map((b) => b.cls);

/** Every class tree passive (`cls_<classId>_<n>`) and imprint (`imprint_<classId>`). */
export const CLASS_PASSIVES: PassiveDef[] = BUILT.flatMap((b) => b.passives);
