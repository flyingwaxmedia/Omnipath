import type { MorphDef, Requirement } from '../../core/types';

// Staff morph tree: 13 nodes (SPEC-v2 §4.1).
//   T1: parent at max rank + 1 charge.
//   T2: + one sibling-branch staff skill at rank 5.
//   T3: + two other staff-tree skills at rank 5, one element, and the storm relic.
// Sparks: bolt→arcane_nova, arcane_orb→prism_orb, arcane_nova→resonant_pulse
//   (focus-branch nodes cannot spark: focus is a buff and never lands a hit).
// World flags: focus (meditation), prism_orb (glowmite kills), resonant_pulse (chime feathers).
// Alternate: firebolt → meteor (v1), now tier 2 with the nova as its sibling requirement.

const r5 = (id: string): Requirement => ({ type: 'skill', id, rank: 5 });
const STORM_RELIC: Requirement = { type: 'flag', id: 'relic_storm', min: 1, label: "Claim Thunderhoof's storm relic" };

export const STAFF_MORPHS: MorphDef[] = [
  // ---------------------------------------------------------------- tier 1 (from bolt)
  { from: 'bolt', to: 'arcane_orb', tier: 1 },
  {
    from: 'bolt',
    to: 'arcane_nova',
    tier: 1,
    hint: 'Wisps and jellies crowd a caster. Strike into the thick of them and your bolt may learn to burst.',
    // Being mobbed by soft meadow and lake sprites teaches a bolt to go off all at once.
    spark: { threat: 3, minParentRank: 5, families: ['sprite'] },
  },
  {
    from: 'bolt',
    to: 'focus',
    tier: 1,
    requires: [{ type: 'flag', id: 'meditations', min: 1, label: 'Meditate at a shrine' }],
    hint: 'A still mind sharpens magic. Seek a place of meditation high in the hills.',
  },

  // ---------------------------------------------------------------- tier 2: arcane_orb branch
  {
    from: 'arcane_orb',
    to: 'singularity',
    tier: 2,
    requires: [r5('focus')],
    hint: 'A mind held perfectly still could crush an orb down to a single, hungry point.',
  },
  {
    from: 'arcane_orb',
    to: 'prism_orb',
    tier: 2,
    requires: [r5('arcane_nova'), { type: 'flag', id: 'kill_glowmite', min: 10, label: 'Defeat 10 Glowmites' }],
    hint: 'Deep in the quarry, glowmites split lamplight into colours. An orb that knows how to burst could do the same.',
    // Glowing swarms scatter the orb's light mid-flight.
    spark: { threat: 6, minParentRank: 4, families: ['swarm'] },
  },

  // ---------------------------------------------------------------- tier 2: arcane_nova branch
  {
    from: 'arcane_nova',
    to: 'arcane_barrage',
    tier: 2,
    requires: [r5('arcane_orb')],
    hint: 'Learn how an orb flies, and your burst could scatter into darts that each find their mark.',
  },
  {
    from: 'arcane_nova',
    to: 'resonant_pulse',
    tier: 2,
    requires: [r5('focus'), { type: 'flag', id: 'chime_gathered', min: 6, label: 'Gather 6 chime feathers' }],
    hint: 'On Windcrest Hill the chimes ring on long after the wind has gone. Listen with a still mind, and your nova could ring too.',
    // The hill's wind-sprites hum like struck chimes when a nova bursts among them.
    spark: { threat: 5, minParentRank: 4, families: ['sprite'] },
  },

  // ---------------------------------------------------------------- tier 2: focus branch
  {
    from: 'focus',
    to: 'arcane_ward',
    tier: 2,
    requires: [r5('arcane_orb')],
    hint: 'An orb is only a shell of force. Turn one inside out and you could wear it.',
  },
  {
    from: 'focus',
    to: 'quicken',
    tier: 2,
    requires: [r5('arcane_nova')],
    hint: "Spend a nova's burst on your own two feet instead of on your foes.",
  },

  // ---------------------------------------------------------------- tier 3 capstones
  {
    from: 'singularity',
    to: 'starfall_lattice',
    tier: 3,
    requires: [r5('prism_orb'), r5('arcane_barrage'), { type: 'element', id: 'holy' }, STORM_RELIC],
    hint: 'Stars are points of light held in a net. Split the light, scatter the darts, know the holy, and bring down the storm relic.',
  },
  {
    from: 'arcane_barrage',
    to: 'arcane_deluge',
    tier: 3,
    requires: [r5('resonant_pulse'), r5('quicken'), { type: 'element', id: 'water' }, STORM_RELIC],
    hint: "A true downpour needs quick hands and a mind that rings like a bell. Know the water, and take the storm warden's relic.",
  },
  {
    from: 'arcane_ward',
    to: 'astral_form',
    tier: 3,
    requires: [r5('singularity'), r5('quicken'), { type: 'element', id: 'shadow' }, STORM_RELIC],
    hint: 'Weightless as a quickened step, dense as a collapsed star. Know the dark between the stars, and carry the storm relic.',
  },

  // ---------------------------------------------------------------- alternate (v1)
  {
    from: 'firebolt',
    to: 'meteor',
    tier: 2,
    requires: [{ type: 'level', min: 8 }, r5('arcane_nova')],
    hint: 'Fire that falls from the sky answers only to the experienced, and only to those who can make magic burst far away.',
  },
];
