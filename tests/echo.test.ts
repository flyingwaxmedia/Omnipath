import { describe, expect, it } from 'vitest';
import { ECHO_ANCHOR_RANK, anchorFor, echoNeed, witnessOutcome, type EchoContext } from '../src/core/echo';
import { Registry } from '../src/core/registry';
import type { ElementDef, GameData, MonsterDef, MonsterTechnique, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const sk = (id: string, shape: SkillDef['shape'], extra: Partial<SkillDef> = {}): SkillDef => ({
  id,
  name: id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
  desc: id,
  icon: id,
  tier: 1,
  tags: ['echo'],
  power: 1.2,
  spCost: 8,
  cooldown: 3000,
  maxRank: 5,
  shape,
  ...extra,
});

const DASH: SkillDef['shape'] = { kind: 'dash', distance: 160, width: 50 };
const NOVA: SkillDef['shape'] = { kind: 'nova', radius: 70, range: 200 };

const tech = (skill: string, marks?: number): MonsterTechnique => ({
  skill,
  weight: 1,
  cooldown: 4000,
  range: 160,
  ...(marks === undefined ? {} : { echo: { marks } }),
});

const mon = (id: string, rank: MonsterDef['rank'], techniques: MonsterTechnique[]): MonsterDef => ({
  id,
  name: id,
  level: 5,
  hp: 200,
  atk: 12,
  def: 3,
  family: 'construct',
  size: 'L',
  rank,
  exp: 20,
  coins: [2, 5],
  speed: 40,
  aggressive: true,
  radius: 16,
  attackRange: 40,
  attackDelay: 1200,
  respawn: 60000,
  techniques,
});

const FIRE: ElementDef = {
  id: 'fire',
  name: 'Fire',
  prefix: 'Blazing',
  icon: 'fire',
  color: 0,
  tier: 0,
  desc: 'Fire',
  status: 'burn',
  strongVs: [],
};

const DATA: GameData = {
  dataVersion: 2,
  elements: [FIRE],
  skills: [
    sk('boulder_roll', DASH, { tags: ['echo', 'heavy'] }),
    sk('jelly_slam', NOVA),
    sk('mon_zap', { kind: 'chain', range: 160, jumps: 1 }, { tags: ['monster'] }),
    sk('shoulder_charge', DASH, { tags: ['heavy'] }),
    sk('flare_dash', DASH, { tags: ['dash'] }),
    sk('lunge', DASH, { tags: ['dash'], weapons: ['sword'] }),
    sk('arcane_nova', NOVA, { tags: ['arcane'], weapons: ['staff'] }),
  ],
  morphs: [],
  recipes: [],
  classes: [],
  essences: [],
  passives: [],
  trainers: [],
  monsters: [
    mon('boulderback', 'elite', [tech('boulder_roll', 3)]),
    mon('ironroot', 'warden', [tech('boulder_roll', 1), tech('mon_zap')]),
    mon('jellop_monarch', 'elite', [tech('jelly_slam', 3)]),
    mon('moon_jellop', 'elite', [tech('jelly_slam', 5)]),
    mon('sparkbug', 'common', [tech('mon_zap')]),
  ],
  items: [],
};

const reg = new Registry(DATA);

/** An EchoContext over a plain id → rank map (insertion order = known() order). */
const ctxOf = (ranks: Record<string, number>): EchoContext => ({
  rank: (id) => ranks[id] ?? 0,
  known: () => Object.keys(ranks),
});

// ------------------------------------------------------------------ tests

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('echoNeed', () => {
  it('is the lowest mark count among monsters teaching the echo', () => {
    expect(echoNeed(reg, 'jelly_slam')).toBe(3);
    // The warden teaches it in one mark even though the elite needs three.
    expect(echoNeed(reg, 'boulder_roll')).toBe(1);
  });

  it('is null for techniques nobody teaches and for unknown skills', () => {
    expect(echoNeed(reg, 'mon_zap')).toBeNull();
    expect(echoNeed(reg, 'shoulder_charge')).toBeNull();
    expect(echoNeed(reg, 'nope')).toBeNull();
  });
});

describe('anchorFor', () => {
  it('needs a known skill of the same shape kind at the anchor rank', () => {
    expect(ECHO_ANCHOR_RANK).toBe(3);
    expect(anchorFor(reg, ctxOf({}), 'boulder_roll')).toBeNull();
    expect(anchorFor(reg, ctxOf({ shoulder_charge: 2 }), 'boulder_roll')).toBeNull();
    expect(anchorFor(reg, ctxOf({ shoulder_charge: 3 }), 'boulder_roll')).toBe('shoulder_charge');
  });

  it('ignores skills of other shape kinds', () => {
    expect(anchorFor(reg, ctxOf({ arcane_nova: 10 }), 'boulder_roll')).toBeNull();
    expect(anchorFor(reg, ctxOf({ arcane_nova: 10 }), 'jelly_slam')).toBe('arcane_nova');
  });

  it('picks the highest-ranked candidate, ties broken by lowest id', () => {
    expect(anchorFor(reg, ctxOf({ shoulder_charge: 3, lunge: 7, flare_dash: 4 }), 'boulder_roll')).toBe('lunge');
    expect(anchorFor(reg, ctxOf({ shoulder_charge: 5, lunge: 5, flare_dash: 5 }), 'boulder_roll')).toBe('flare_dash');
  });

  it('counts variants of other skills', () => {
    expect(reg.skill('lunge@fire')?.shape.kind).toBe('dash');
    expect(anchorFor(reg, ctxOf({ lunge: 2, 'lunge@fire': 4 }), 'boulder_roll')).toBe('lunge@fire');
  });

  it('never lets the echo (or its variants) anchor itself', () => {
    expect(reg.skill('boulder_roll@fire')).toBeDefined();
    expect(anchorFor(reg, ctxOf({ boulder_roll: 5, 'boulder_roll@fire': 5 }), 'boulder_roll')).toBeNull();
    expect(anchorFor(reg, ctxOf({ boulder_roll: 5, flare_dash: 3 }), 'boulder_roll')).toBe('flare_dash');
  });

  it('skips unknown ids and unknown echoes', () => {
    expect(anchorFor(reg, ctxOf({ ghost: 9, lunge: 3 }), 'boulder_roll')).toBe('lunge');
    expect(anchorFor(reg, ctxOf({ lunge: 9 }), 'nope')).toBeNull();
  });
});

describe('witnessOutcome', () => {
  const anchored = ctxOf({ arcane_nova: 4 });

  it('is progress below the need', () => {
    expect(witnessOutcome(reg, anchored, 'jelly_slam', 1)).toEqual({ status: 'progress', need: 3, anchorShape: 'nova' });
    expect(witnessOutcome(reg, ctxOf({}), 'jelly_slam', 2)).toEqual({ status: 'progress', need: 3, anchorShape: 'nova' });
  });

  it('is learned at (or past) the need with an anchor', () => {
    expect(witnessOutcome(reg, anchored, 'jelly_slam', 3)).toEqual({ status: 'learned', need: 3, anchorShape: 'nova' });
    expect(witnessOutcome(reg, anchored, 'jelly_slam', 7).status).toBe('learned');
    expect(witnessOutcome(reg, ctxOf({ lunge: 3 }), 'boulder_roll', 1)).toEqual({
      status: 'learned',
      need: 1,
      anchorShape: 'dash',
    });
  });

  it('is blocked at the need without an anchor, naming the needed shape', () => {
    expect(witnessOutcome(reg, ctxOf({ lunge: 9, arcane_nova: 2 }), 'jelly_slam', 3)).toEqual({
      status: 'blocked',
      need: 3,
      anchorShape: 'nova',
    });
    expect(witnessOutcome(reg, ctxOf({ arcane_nova: 9 }), 'boulder_roll', 4)).toEqual({
      status: 'blocked',
      need: 1,
      anchorShape: 'dash',
    });
  });

  it('becomes learned once an anchor is trained, with the same marks', () => {
    const ranks: Record<string, number> = { shoulder_charge: 2 };
    expect(witnessOutcome(reg, ctxOf(ranks), 'boulder_roll', 1).status).toBe('blocked');
    ranks.shoulder_charge = 3;
    expect(witnessOutcome(reg, ctxOf(ranks), 'boulder_roll', 1).status).toBe('learned');
  });

  it('throws for skills that are not echoes', () => {
    expect(() => witnessOutcome(reg, anchored, 'mon_zap', 3)).toThrow(/not taught as an echo/);
    expect(() => witnessOutcome(reg, anchored, 'nope', 3)).toThrow(/unknown skill/);
  });
});
