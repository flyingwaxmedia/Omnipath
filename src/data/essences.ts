import type { EssenceDef } from '../core/types';

// Starter essences (SPEC-v2 §3). Category / appliesTo / mod / power-SP-cooldown multipliers are fixed by the
// spec table; names, icons, affixes and descriptions are flavour.
// Affixes are single words so composed names stay within the 4-word limit as often as possible
// ("Blazing Forked Sword Throw", "Whirlwind Reprise").
// Essences drop from monster species (see `essence` in monsters.ts) and are sold by some trainers.
export const ESSENCES: EssenceDef[] = [
  // ---------------------------------------------------------------- multiply
  {
    id: 'split',
    name: 'Splitting',
    icon: '🔀',
    desc: 'Projectiles fork: 2 extra shots in a wider fan. Each hits a bit over half as hard. More SP.',
    affix: { text: 'Forked', pos: 'prefix' },
    category: 'multiply',
    appliesTo: ['projectile'],
    powerMul: 0.55,
    spMul: 1.3,
    cdMul: 1,
    mod: { count: 2, spread: 25 },
  },
  {
    id: 'flurry',
    name: 'Flurry',
    icon: '✳️',
    desc: 'Strikes land one extra hit, each a little lighter. More SP.',
    affix: { text: 'Flurry', pos: 'prefix' },
    category: 'multiply',
    appliesTo: ['strike'],
    powerMul: 0.7,
    spMul: 1.3,
    cdMul: 1,
    mod: { hits: 1 },
  },

  // ---------------------------------------------------------------- propagate
  {
    id: 'arc',
    name: 'Arcing',
    icon: '🔗',
    desc: 'Chains leap to 2 more foes. Other skills arc each hit to 2 nearby foes at 60% power.',
    affix: { text: 'Arcing', pos: 'prefix' },
    category: 'propagate',
    appliesTo: ['projectile', 'strike', 'chain'],
    powerMul: 0.9,
    spMul: 1.3,
    cdMul: 1,
    // compose(): `jumps` applies to chain shapes; every other shape gets the `arc` rider instead.
    mod: { jumps: 2, arc: { targets: 2, mult: 0.6 } },
  },
  {
    id: 'pierce',
    name: 'Piercing',
    icon: '🪡',
    desc: 'Projectiles pass through 2 more foes before stopping.',
    affix: { text: 'Piercing', pos: 'prefix' },
    category: 'propagate',
    appliesTo: ['projectile'],
    powerMul: 0.9,
    spMul: 1.2,
    cdMul: 1,
    mod: { pierce: 2 },
  },
  {
    id: 'return',
    name: 'Returning',
    icon: '🪃',
    desc: 'Projectiles fly back to your hand and can hit each foe again. Slightly shorter range.',
    affix: { text: 'Returning', pos: 'prefix' },
    category: 'propagate',
    appliesTo: ['projectile'],
    powerMul: 0.9,
    spMul: 1.3,
    cdMul: 1,
    mod: { returns: true, rangeMul: 0.8 },
  },

  // ---------------------------------------------------------------- repeat
  {
    id: 'reprise',
    name: 'Reprise',
    icon: '🔁',
    desc: 'The skill recasts itself 0.4 s later at half power. More SP.',
    affix: { text: 'Reprise', pos: 'suffix' },
    category: 'repeat',
    appliesTo: ['strike', 'spin', 'nova', 'projectile'],
    powerMul: 1,
    spMul: 1.4,
    cdMul: 1,
    mod: { reprise: { delayMs: 400, mult: 0.5 } },
  },

  // ---------------------------------------------------------------- area
  {
    id: 'expanse',
    name: 'Expanse',
    icon: '🌐',
    desc: 'Wider spins and novas, longer reach, broader swings. Slightly less power per hit.',
    affix: { text: 'Vast', pos: 'prefix' },
    category: 'area',
    appliesTo: ['spin', 'nova', 'strike'],
    powerMul: 0.85,
    spMul: 1.25,
    cdMul: 1,
    mod: { radiusMul: 1.35, rangeMul: 1.2, arcAdd: 30 },
  },

  // ---------------------------------------------------------------- tempo
  {
    id: 'haste',
    name: 'Haste',
    icon: '⏩',
    desc: 'Cooldown cut by 30% for a little less power per cast.',
    affix: { text: 'Swift', pos: 'prefix' },
    category: 'tempo',
    appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'],
    powerMul: 0.8,
    spMul: 1.2,
    cdMul: 0.7,
    mod: {},
  },
  {
    id: 'heavy',
    name: 'Weight',
    icon: '⚓',
    desc: 'Slower but far harder blows that knock foes back. Counts as heavy: best against large foes.',
    affix: { text: 'Crushing', pos: 'prefix' },
    category: 'tempo',
    appliesTo: ['strike', 'spin', 'dash'],
    powerMul: 1.5,
    spMul: 1.2,
    cdMul: 1.6,
    mod: { knockback: true },
    tag: 'heavy',
  },

  // ---------------------------------------------------------------- sustain
  {
    id: 'leech',
    name: 'Thirst',
    icon: '🩸',
    desc: 'Heals you for 4% of the damage dealt (up to 8% of max HP per cast).',
    affix: { text: 'Leeching', pos: 'prefix' },
    category: 'sustain',
    appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'],
    powerMul: 0.9,
    spMul: 1.2,
    cdMul: 1,
    mod: { leech: 0.04 },
  },
];
