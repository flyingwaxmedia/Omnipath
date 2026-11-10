import type { MorphDef, Requirement } from '../../core/types';

// Bare Hands morph tree (SPEC-v4 §2.4): 13 nodes — jab, 3×T1, 6×T2 (2 per branch), 3×T3 capstones.
// T2: + one sibling-branch skill at rank 5. T3: + 2 other tree skills at rank 5, 1 element, and a warden beaten
// bare-handed (the flag `warden_bare`, which replaces the other trees' warden relic).
// Until the deed engine lands (Phase 2) the two deed gates read plain counters the game already keeps:
// Guard Up — hits landed bare-handed; Flying Knee — foes beaten bare-handed.

const r5 = (id: string): Requirement => ({ type: 'skill', id, rank: 5 });
const WARDEN_BARE: Requirement = { type: 'flag', id: 'warden_bare', min: 1, label: 'Defeat a warden with bare hands' };

export const FIST_MORPHS: MorphDef[] = [
  // ---------------------------------------------------------------- T1 (from jab)
  { from: 'jab', to: 'haymaker', tier: 1 },
  {
    from: 'jab',
    to: 'sweep_kick',
    tier: 1,
    hint: 'When they crowd you, one fist is not enough. Try a leg.',
    spark: { threat: 3, minParentRank: 5 },
  },
  {
    from: 'jab',
    to: 'guard_up',
    tier: 1,
    requires: [{ type: 'flag', id: 'hits:fists', min: 150, label: 'Land 150 hits with bare hands' }],
    hint: 'Trade enough blows and your arms learn where to be.',
  },

  // ---------------------------------------------------------------- T2 · haymaker branch
  {
    from: 'haymaker',
    to: 'one_two',
    tier: 2,
    requires: [r5('sweep_kick')],
    hint: 'A big swing leaves you open. Quick feet would let you throw two.',
    spark: { threat: 6, minParentRank: 4 },
  },
  {
    from: 'haymaker',
    to: 'body_blow',
    tier: 2,
    requires: [r5('guard_up')],
    hint: 'From behind a good guard you can see where the ribs are.',
  },

  // ---------------------------------------------------------------- T2 · sweep_kick branch
  {
    from: 'sweep_kick',
    to: 'windmill',
    tier: 2,
    requires: [r5('haymaker')],
    hint: 'Put the weight of a haymaker into the leg and keep turning.',
    spark: { threat: 8, minParentRank: 4 },
  },
  {
    from: 'sweep_kick',
    to: 'flying_knee',
    tier: 2,
    requires: [r5('guard_up'), { type: 'flag', id: 'kills:fists', min: 50, label: 'Defeat 50 foes with bare hands' }],
    hint: 'Win enough fights by hand and you stop waiting for them to come to you.',
  },

  // ---------------------------------------------------------------- T2 · guard_up branch
  {
    from: 'guard_up',
    to: 'second_wind',
    tier: 2,
    requires: [r5('haymaker')],
    hint: 'Hit hard, then breathe. The breath is half the fight.',
  },
  {
    from: 'guard_up',
    to: 'shove',
    tier: 2,
    requires: [r5('sweep_kick')],
    hint: 'A guard can push as well as hold. Make room.',
  },

  // ---------------------------------------------------------------- T3 capstones
  {
    from: 'one_two',
    to: 'drumroll',
    tier: 3,
    requires: [r5('body_blow'), r5('windmill'), { type: 'element', id: 'lightning' }, WARDEN_BARE],
    hint: 'Two punches become twenty when lightning is in the arms. A warden must fall to your bare hands first.',
  },
  {
    from: 'flying_knee',
    to: 'comet_heel',
    tier: 3,
    requires: [r5('windmill'), r5('shove'), { type: 'element', id: 'earth' }, WARDEN_BARE],
    hint: 'Jump higher and let the earth pull you down. A warden must fall to your bare hands first.',
  },
  {
    from: 'second_wind',
    to: 'unbroken',
    tier: 3,
    requires: [r5('shove'), r5('body_blow'), { type: 'element', id: 'holy' }, WARDEN_BARE],
    hint: 'Breath, guard and a little holy light. A warden must fall to your bare hands first.',
  },
];
