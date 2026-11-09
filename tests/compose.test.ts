import { describe, expect, it } from 'vitest';
import {
  ESSENCE_BUDGET_BAND,
  MAX_HITS,
  MAX_NAME_WORDS,
  MIN_COOLDOWN,
  SHAPE_PRIORITY,
  budgetDamage,
  canApplyEssence,
  compose,
  essencePowerMul,
  elementSlotState,
  legalEssenceSet,
  mergeBlocker,
  mergeId,
  mergeSkills,
  parseVariantId,
  potentialHits,
  shapeHits,
  variantId,
} from '../src/core/compose';
import { Registry } from '../src/core/registry';
import type { ElementDef, EssenceDef, GameData, SkillDef } from '../src/core/types';
import { createRegistry } from '../src/data';

// ------------------------------------------------------------------ inline fixture

const el = (id: ElementDef['id'], name: string, prefix: string): ElementDef => ({
  id,
  name,
  prefix,
  icon: id,
  color: 0,
  tier: 0,
  desc: name,
  status: 'burn',
  strongVs: [],
});

const ELEMENTS: ElementDef[] = [
  el('fire', 'Fire', 'Blazing'),
  el('water', 'Water', 'Tidal'),
  el('wind', 'Wind', 'Gale'),
  el('earth', 'Earth', 'Stone'),
];

const ess = (e: Partial<EssenceDef> & Pick<EssenceDef, 'id' | 'category' | 'appliesTo'>): EssenceDef => ({
  name: e.id.charAt(0).toUpperCase() + e.id.slice(1),
  icon: e.id,
  desc: e.id,
  affix: { text: e.id.charAt(0).toUpperCase() + e.id.slice(1), pos: 'prefix' },
  powerMul: 1,
  spMul: 1,
  mod: {},
  ...e,
});

/** The SPEC §3 starter essences. */
const ESSENCES: EssenceDef[] = [
  ess({ id: 'split', category: 'multiply', appliesTo: ['projectile'], powerMul: 1.1, spMul: 1.3, mod: { count: 2, spread: 25 } }),
  ess({ id: 'flurry', category: 'multiply', appliesTo: ['strike'], powerMul: 0.7, spMul: 1.3, mod: { hits: 1 }, affix: { text: 'Twin', pos: 'prefix' } }),
  ess({
    id: 'arc',
    category: 'propagate',
    appliesTo: ['projectile', 'strike', 'chain'],
    powerMul: 0.9,
    spMul: 1.3,
    mod: { jumps: 2, arc: { targets: 2, mult: 0.6 } },
    affix: { text: 'of Arcs', pos: 'suffix' },
  }),
  ess({ id: 'pierce', category: 'propagate', appliesTo: ['projectile'], powerMul: 0.9, spMul: 1.2, mod: { pierce: 2 } }),
  ess({ id: 'return', category: 'propagate', appliesTo: ['projectile'], powerMul: 0.9, spMul: 1.3, mod: { returns: true, rangeMul: 0.8 } }),
  ess({
    id: 'reprise',
    category: 'repeat',
    appliesTo: ['strike', 'spin', 'nova', 'projectile'],
    powerMul: 1,
    spMul: 1.4,
    mod: { reprise: { delayMs: 400, mult: 0.5 } },
  }),
  ess({
    id: 'expanse',
    category: 'area',
    appliesTo: ['spin', 'nova', 'strike'],
    powerMul: 0.85,
    spMul: 1.25,
    mod: { radiusMul: 1.35, rangeMul: 1.2, arcAdd: 30 },
    affix: { text: 'Wide', pos: 'prefix' },
  }),
  ess({
    id: 'haste',
    category: 'tempo',
    appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'],
    powerMul: 0.8,
    spMul: 1.2,
    cdMul: 0.7,
    affix: { text: 'Swift', pos: 'prefix' },
  }),
  ess({
    id: 'heavy',
    category: 'tempo',
    appliesTo: ['strike', 'spin', 'dash'],
    powerMul: 1.5,
    spMul: 1.2,
    cdMul: 1.6,
    mod: { knockback: true },
    tag: 'heavy',
  }),
  ess({
    id: 'leech',
    category: 'sustain',
    appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'],
    powerMul: 0.9,
    spMul: 1.2,
    mod: { leech: 0.04 },
    affix: { text: 'Vampiric', pos: 'prefix' },
  }),
];

const sk = (s: Partial<SkillDef> & Pick<SkillDef, 'id' | 'name' | 'shape'>): SkillDef => ({
  desc: `${s.name}.`,
  icon: s.id,
  tier: 1,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 6,
  cooldown: 2000,
  maxRank: 10,
  ...s,
});

const SKILLS: SkillDef[] = [
  sk({ id: 'slash', name: 'Slash', tier: 0, tags: ['blade', 'melee', 'basic'], spCost: 0, cooldown: 0, shape: { kind: 'strike', range: 56, arc: 110 } }),
  sk({ id: 'whirlwind', name: 'Whirlwind', tags: ['blade', 'spin', 'aoe'], power: 0.9, spCost: 8, cooldown: 3000, shape: { kind: 'spin', radius: 84, pulses: 2 } }),
  sk({
    id: 'sword_throw',
    name: 'Sword Throw',
    tags: ['blade', 'projectile', 'ranged'],
    power: 1.3,
    spCost: 6,
    cooldown: 2200,
    shape: { kind: 'projectile', speed: 520, range: 300, pierce: 1, size: 14 },
  }),
  sk({
    id: 'heavy_cleave',
    name: 'Heavy Cleave',
    tags: ['blade', 'heavy', 'melee'],
    power: 2,
    spCost: 10,
    cooldown: 4500,
    status: 'stun',
    shape: { kind: 'strike', range: 70, arc: 160 },
  }),
  sk({ id: 'guillotine', name: 'Guillotine', tier: 2, tags: ['blade', 'heavy'], power: 3.6, spCost: 18, cooldown: 8000, maxRank: 8, critBonus: 15, shape: { kind: 'strike', range: 64, arc: 60 } }),
  sk({ id: 'flame_spin', name: 'Flame Spin', tier: 2, tags: ['blade', 'spin', 'aoe'], element: 'fire', power: 1.25, spCost: 14, cooldown: 3500, maxRank: 8, shape: { kind: 'spin', radius: 96, pulses: 3 } }),
  sk({ id: 'spinning_assault', name: 'Spinning Assault', tier: 2, tags: ['blade', 'spin', 'dash'], power: 1.2, spCost: 14, cooldown: 5000, maxRank: 8, shape: { kind: 'dash', distance: 180, width: 60, spin: true } }),
  sk({ id: 'lunge', name: 'Lunge', tags: ['blade', 'dash'], power: 1.4, spCost: 9, cooldown: 4000, shape: { kind: 'dash', distance: 150, width: 40 } }),
  sk({ id: 'earthsplitter', name: 'Earthsplitter', tier: 2, tags: ['blade', 'heavy', 'aoe'], element: 'earth', power: 2.4, spCost: 20, cooldown: 6000, maxRank: 8, shape: { kind: 'nova', radius: 80, range: 140, delay: 150 } }),
  sk({ id: 'quake', name: 'Quake', weapons: ['staff'], tags: ['arcane', 'aoe'], power: 1.6, spCost: 12, cooldown: 5000, shape: { kind: 'nova', radius: 90, range: 260, delay: 250 } }),
  sk({ id: 'chain_bolt', name: 'Chain Bolt', weapons: ['staff'], tags: ['arcane', 'projectile'], power: 1.1, spCost: 10, cooldown: 3000, shape: { kind: 'chain', range: 300, jumps: 6 } }),
  sk({ id: 'knife_ring', name: 'Knife Ring', weapons: undefined, tags: ['pierce', 'projectile', 'aoe'], power: 0.5, spCost: 12, cooldown: 4000, shape: { kind: 'projectile', speed: 480, range: 260, count: 12, radial: true, size: 10 } }),
  sk({ id: 'fan', name: 'Fan', weapons: ['dagger'], tags: ['pierce', 'projectile'], power: 0.6, spCost: 9, cooldown: 2500, shape: { kind: 'projectile', speed: 560, range: 240, count: 5, spread: 70, size: 10 } }),
  sk({ id: 'thousand_cuts', name: 'Thousand Cuts', tags: ['blade', 'melee'], power: 0.5, spCost: 12, cooldown: 4000, shape: { kind: 'strike', range: 50, arc: 60, hits: 5 } }),
  sk({ id: 'jab', name: 'Jab', tags: ['blade', 'melee'], power: 0.8, spCost: 3, cooldown: 400, shape: { kind: 'strike', range: 40, arc: 40 } }),
  sk({ id: 'edge_of_the_moon', name: 'Edge of the Moon', tags: ['blade', 'melee'], shape: { kind: 'strike', range: 60, arc: 90 } }),
  sk({ id: 'focus', name: 'Focus', weapons: ['staff'], tags: ['arcane', 'buff'], power: 0, spCost: 10, cooldown: 20000, shape: { kind: 'buff', stat: 'matk', amount: 30, duration: 12000 } }),
  sk({ id: 'guard', name: 'Guard', tags: ['blade', 'buff'], power: 0, spCost: 8, cooldown: 15000, shape: { kind: 'buff', stat: 'def', amount: 20, duration: 8000 } }),
  sk({ id: 'mon_zap', name: 'Zap', weapons: undefined, tags: ['monster', 'projectile'], shape: { kind: 'chain', range: 200, jumps: 2 } }),
];

const DATA: GameData = {
  dataVersion: 2,
  elements: ELEMENTS,
  skills: SKILLS,
  morphs: [],
  recipes: [],
  classes: [],
  essences: ESSENCES,
  passives: [],
  trainers: [],
  monsters: [],
  items: [],
};

const reg = new Registry(DATA);
const E = (id: string): EssenceDef => reg.essence(id)!;
const S = (id: string): SkillDef => {
  const s = reg.skill(id);
  if (!s) throw new Error(`fixture: no skill ${id}`);
  return s;
};
const FIRE = reg.element('fire')!;

const wordCount = (name: string): number => name.split(/\s+/).length;
const r2 = (n: number): number => Math.round(n * 100) / 100;

// ------------------------------------------------------------------ ids

describe('variant ids', () => {
  const canonical = [
    'slash',
    'slash@fire',
    'sword_throw@fire~split',
    'sword_throw~haste~split',
    'fuse:sword_throw|whirlwind',
    'fuse:sword_throw|whirlwind@fire~split',
    'fuse:heavy_cleave|whirlwind~haste~leech',
  ];

  it.each(canonical)('round-trips %s', (id) => {
    const p = parseVariantId(id);
    expect(p).not.toBeNull();
    expect(variantId(p!.base, p!.element, p!.mods)).toBe(id);
  });

  it('parses the parts', () => {
    expect(parseVariantId('slash')).toEqual({ base: 'slash', mods: [] });
    expect(parseVariantId('sword_throw@fire~split')).toEqual({ base: 'sword_throw', element: 'fire', mods: ['split'] });
    expect(parseVariantId('fuse:sword_throw|whirlwind@fire~split')).toEqual({
      base: 'fuse:sword_throw|whirlwind',
      element: 'fire',
      mods: ['split'],
      merge: ['sword_throw', 'whirlwind'],
    });
  });

  it.each([
    '',
    '@fire',
    'slash@',
    'slash@fire@water',
    'slash~',
    'slash~split@fire',
    'sword_throw~split~haste',
    'sword_throw~split~split',
    'sword_throw~a~b~c',
    'fuse:whirlwind|sword_throw',
    'fuse:whirlwind',
    'fuse:a|a',
    'fuse:a|b|c',
    'fuse:|a',
    'fuse:fuse:a|b|c',
    'skill:slash',
  ])('rejects non-canonical id %j', (id) => {
    expect(parseVariantId(id)).toBeNull();
  });

  it('variantId sorts mods; mergeId sorts parents', () => {
    expect(variantId('sword_throw', 'fire', ['split', 'haste'])).toBe('sword_throw@fire~haste~split');
    expect(variantId('slash')).toBe('slash');
    expect(mergeId('whirlwind', 'sword_throw')).toBe('fuse:sword_throw|whirlwind');
    expect(mergeId('sword_throw', 'whirlwind')).toBe('fuse:sword_throw|whirlwind');
  });
});

// ------------------------------------------------------------------ compose

describe('compose: element', () => {
  it('infuses an unaligned attack (v1 rules)', () => {
    const s = compose(S('sword_throw'), FIRE, []);
    expect(s.id).toBe('sword_throw@fire');
    expect(s.name).toBe('Blazing Sword Throw');
    expect(s.element).toBe('fire');
    expect(s.power).toBeCloseTo(1.56, 5);
    expect(s.spCost).toBe(Math.ceil(6 * 1.25 + 2));
    expect(s.cooldown).toBe(2200);
    expect(s.tier).toBe(2);
    expect(s.maxRank).toBe(8);
    expect(s.tags).toEqual(expect.arrayContaining(['blade', 'projectile', 'sword', 'fire', 'infused']));
    expect(s.generated).toBe(true);
    expect(s.baseId).toBe('sword_throw');
    expect(s.essences).toEqual([]);
  });

  it('turns a basic auto-attack into a hotbar skill', () => {
    const s = compose(S('slash'), FIRE, []);
    expect(s.cooldown).toBe(800);
    expect(s.spCost).toBe(2);
    expect(s.tier).toBe(1);
    expect(s.tags).not.toContain('basic');
  });

  it('returns the base unchanged when nothing is applied', () => {
    expect(compose(S('slash'), undefined, [])).toBe(S('slash'));
  });

  it('refuses to compose from an existing variant', () => {
    expect(() => compose(S('sword_throw@fire'), undefined, [E('split')])).toThrow();
  });
});

describe('compose: essences', () => {
  it('essencePowerMul: split spreads 1.1x the volley over the new count; others use powerMul', () => {
    const proj = (count?: number): SkillDef['shape'] => ({ kind: 'projectile', speed: 1, range: 1, ...(count ? { count } : {}) });
    expect(essencePowerMul(E('split'), proj())).toBeCloseTo(1.1 / 3, 10);
    expect(essencePowerMul(E('split'), proj(4))).toBeCloseTo((1.1 * 4) / 6, 10);
    expect(essencePowerMul(E('split'), proj(10))).toBeCloseTo((1.1 * 10) / 12, 10);
    expect(essencePowerMul(E('flurry'), { kind: 'strike', range: 1, arc: 1 })).toBe(0.7);
    expect(essencePowerMul(E('haste'), proj(5))).toBe(E('haste').powerMul);
  });

  it('split keeps the volley at 1.1x for any base count', () => {
    for (const id of ['sword_throw', 'fan']) {
      const base = S(id);
      const v = compose(base, undefined, [E('split')]);
      expect(shapeHits(v.shape)).toBe(shapeHits(base.shape) + 2);
      expect((v.power * shapeHits(v.shape)) / (base.power * shapeHits(base.shape))).toBeCloseTo(1.1, 1);
    }
  });

  it('split adds projectiles and scales power/sp', () => {
    const s = compose(S('sword_throw'), undefined, [E('split')]);
    expect(s.id).toBe('sword_throw~split');
    expect(s.name).toBe('Split Sword Throw');
    expect(s.shape).toMatchObject({ kind: 'projectile', count: 3, spread: 25, pierce: 1 });
    // The volley deals 1.1x the original, spread over 3 projectiles: 1.1 × 1 / (1 + 2) each.
    expect(s.power).toBe(r2((1.3 * 1.1) / 3));
    expect(s.spCost).toBeCloseTo(6 * 1.3, 5);
    expect(s.tier).toBe(2);
    expect(s.essences).toEqual(['split']);
    expect(s.element).toBeUndefined();
    expect(s.tags).not.toContain('infused');
  });

  it('applies element first, then essences', () => {
    const s = compose(S('sword_throw'), FIRE, [E('split')]);
    expect(s.id).toBe('sword_throw@fire~split');
    expect(s.name).toBe('Blazing Split Sword Throw');
    expect(s.power).toBe(r2((1.3 * 1.2 * 1.1) / 3));
    expect(s.spCost).toBeCloseTo(Math.ceil(6 * 1.25 + 2) * 1.3, 5);
  });

  it('an SP-free base starts essence variants at 2 SP and 800 ms', () => {
    const s = compose(S('slash'), undefined, [E('flurry')]);
    expect(s.spCost).toBeCloseTo(2 * 1.3, 5);
    expect(s.cooldown).toBe(800);
    expect(s.shape).toMatchObject({ kind: 'strike', hits: 2 });
  });

  it('names after the alphabetically first essence only', () => {
    const s = compose(S('sword_throw'), undefined, [E('split'), E('haste')]);
    expect(s.id).toBe('sword_throw~haste~split');
    expect(s.name).toBe('Swift Sword Throw');
    expect(s.essences).toEqual(['haste', 'split']);
    expect(s.cooldown).toBe(Math.round(2200 * 0.7));
  });

  it('suffix affixes and the 4-word limit', () => {
    expect(compose(S('jab'), undefined, [E('arc')]).name).toBe('Jab of Arcs');
    // "Blazing Sword Throw of Arcs" is 5 words: the essence affix is dropped.
    expect(compose(S('sword_throw'), FIRE, [E('arc')]).name).toBe('Blazing Sword Throw');
    // A 4-word base cannot take the element prefix either.
    const long = compose(S('edge_of_the_moon'), FIRE, [E('flurry')]);
    expect(long.name).toBe('Edge of the Moon');
    expect(wordCount(long.name)).toBeLessThanOrEqual(4);
  });

  it('arc: extra jumps on chains, an arc rider elsewhere', () => {
    const chain = compose(S('chain_bolt'), undefined, [E('arc')]);
    expect(chain.shape).toMatchObject({ kind: 'chain', jumps: 8 });
    expect(chain.riders?.arc).toBeUndefined();
    // 9 hits is under the cap.
    expect(potentialHits(chain)).toBe(9);
    const proj = compose(S('sword_throw'), undefined, [E('arc')]);
    expect(proj.riders?.arc).toEqual({ targets: 2, mult: 0.6 });
    expect(proj.shape).toMatchObject({ kind: 'projectile' });
    expect('jumps' in proj.shape).toBe(false);
  });

  it('expanse scales strikes, spins and novas', () => {
    expect(compose(S('jab'), undefined, [E('expanse')]).shape).toMatchObject({ kind: 'strike', range: 48, arc: 70 });
    expect(compose(S('whirlwind'), undefined, [E('expanse')]).shape).toMatchObject({ kind: 'spin', radius: Math.round(84 * 1.35) });
    expect(compose(S('quake'), undefined, [E('expanse')]).shape).toMatchObject({
      kind: 'nova',
      radius: Math.round(90 * 1.35),
      range: Math.round(260 * 1.2),
    });
  });

  it('return, reprise, leech and heavy add riders', () => {
    const ret = compose(S('sword_throw'), undefined, [E('return')]);
    expect(ret.riders).toEqual({ returns: true });
    expect(ret.shape).toMatchObject({ range: 240 });
    expect(compose(S('whirlwind'), undefined, [E('reprise')]).riders).toEqual({ reprise: { delayMs: 400, mult: 0.5 } });
    expect(compose(S('lunge'), undefined, [E('leech')]).riders).toEqual({ leech: 0.04 });
    const heavy = compose(S('whirlwind'), undefined, [E('heavy')]);
    expect(heavy.riders).toEqual({ knockback: true });
    expect(heavy.tags).toContain('heavy');
    expect(heavy.power).toBeCloseTo(0.9 * 1.5, 5);
    expect(heavy.cooldown).toBe(Math.round(3000 * 1.6));
  });

  it('cooldown never drops below 300 ms', () => {
    const s = compose(S('jab'), undefined, [E('haste')]);
    expect(s.cooldown).toBe(MIN_COOLDOWN);
  });
});

describe('hit clamp', () => {
  it('potentialHits multiplies every axis and rider', () => {
    expect(potentialHits(S('whirlwind'))).toBe(2);
    expect(potentialHits(S('chain_bolt'))).toBe(7);
    expect(potentialHits(S('focus'))).toBe(0);
    expect(
      potentialHits({
        shape: { kind: 'projectile', speed: 1, range: 1, count: 2 },
        riders: { returns: true, reprise: { delayMs: 1, mult: 1 }, arc: { targets: 2, mult: 0.5 } },
      }),
    ).toBe(2 * 2 * 2 * 3);
    expect(shapeHits({ kind: 'strike', range: 1, arc: 1, hits: 3 })).toBe(3);
  });

  it('trims jumps first', () => {
    // A repeat essence that fits chains: (1 + 6 + 2 jumps) x2 reprise = 18 -> jumps trimmed to 5 => 12.
    const repeat: EssenceDef = { ...E('reprise'), id: 'echo_test', appliesTo: ['chain'] };
    const s = compose(S('chain_bolt'), undefined, [E('arc'), repeat]);
    expect(s.shape).toMatchObject({ kind: 'chain', jumps: 5 });
    expect(s.riders?.reprise).toBeDefined();
    expect(potentialHits(s)).toBe(12);
  });

  it('trims count before arc targets', () => {
    // 5 projectiles x (1 + 2 arcs) = 15 -> count 4 => 12, arc kept.
    const s = compose(S('fan'), undefined, [E('arc')]);
    expect(s.shape).toMatchObject({ kind: 'projectile', count: 4 });
    expect(s.riders?.arc).toEqual({ targets: 2, mult: 0.6 });
    expect(potentialHits(s)).toBe(12);
    // Renormalized: power × 15/12 keeps the cast's total potential damage (well under the cap).
    expect(s.power).toBe(r2(0.6 * 0.9 * (15 / 12)));
    expect(Math.abs(s.power * potentialHits(s) - 0.6 * 0.9 * 15)).toBeLessThanOrEqual(0.005 * 12 + 1e-9); // 0.01 rounding
  });

  it('renormalizes trimmed jumps fully when the step stays in budget', () => {
    // (1 + 6 + 2) x2 = 18 hits -> 12: power x1.5 (vs chain_bolt~arc: +4% damage per SP).
    const repeat: EssenceDef = { ...E('reprise'), id: 'echo_test', appliesTo: ['chain'] };
    const s = compose(S('chain_bolt'), undefined, [E('arc'), repeat]);
    expect(s.power).toBe(r2(1.1 * 0.9 * 1.5));
  });

  it('caps renormalization so no essence step gains more than +35% damage per SP', () => {
    // fan~arc~reprise: 5 x 3 x 2 = 30 hits -> count 2 => 12; a full x2.5 would make the arc step
    // vs fan~reprise worth +92% per SP, so the power stops at the +35% line instead.
    const v = compose(S('fan'), undefined, [E('arc'), E('reprise')]);
    expect(v.shape).toMatchObject({ kind: 'projectile', count: 2 });
    const full = 0.6 * 0.9 * 2.5;
    expect(v.power).toBeLessThan(full);
    const rate = (s: SkillDef): number => budgetDamage(s, false) / s.spCost;
    const refs = [compose(S('fan'), undefined, [E('reprise')]), compose(S('fan'), undefined, [E('arc')])];
    const steps = refs.map((r) => rate(v) / rate(r));
    expect(Math.max(...steps)).toBeLessThanOrEqual(1 + ESSENCE_BUDGET_BAND);
    expect(Math.max(...steps)).toBeGreaterThan(1 + ESSENCE_BUDGET_BAND - 0.02);
    // Never below the unrenormalized power.
    expect(v.power).toBeGreaterThanOrEqual(r2(0.6 * 0.9));
  });

  it('split cannot push a 12-projectile ring past the cap', () => {
    const s = compose(S('knife_ring'), undefined, [E('split')]);
    expect(s.shape).toMatchObject({ kind: 'projectile', count: 12 });
    expect(potentialHits(s)).toBe(12);
    // 14 projectiles at 1.1 × 12/14 each, trimmed to 12 and renormalized: the ring still deals 1.1x.
    expect(s.power).toBe(r2(0.5 * 1.1));
    expect(budgetDamage(s, true) / budgetDamage(S('knife_ring'), true)).toBeCloseTo(1.1, 2);
  });

  it('trims arc targets before strike hits', () => {
    // 5 hits x (1 + 2) = 15 -> arc targets 1 => 10, hits untouched.
    const s = compose(S('thousand_cuts'), undefined, [E('arc')]);
    expect(s.shape).toMatchObject({ kind: 'strike', hits: 5 });
    expect(s.riders?.arc).toEqual({ targets: 1, mult: 0.6 });
    expect(potentialHits(s)).toBe(10);
  });

  it('trims strike hits as a last resort', () => {
    // 6 hits x2 reprise = 12 OK; a 7th hit would exceed.
    const s = compose(S('thousand_cuts'), undefined, [E('flurry'), E('reprise')]);
    expect(s.shape).toMatchObject({ kind: 'strike', hits: 6 });
    expect(potentialHits(s)).toBe(12);
    const twice: EssenceDef = { ...E('flurry'), id: 'flurry_b', category: 'area', mod: { hits: 2 } };
    const capped = compose(S('thousand_cuts'), undefined, [twice, E('reprise')]);
    expect(potentialHits(capped)).toBeLessThanOrEqual(MAX_HITS);
    expect(capped.riders?.reprise).toBeDefined();
  });
});

// ------------------------------------------------------------------ legality

describe('essence legality', () => {
  it('legalEssenceSet: shape, category, count, buffs, monsters', () => {
    expect(legalEssenceSet(S('sword_throw'), [E('split'), E('haste')])).toBe(true);
    expect(legalEssenceSet(S('sword_throw'), [E('flurry')])).toBe(false);
    expect(legalEssenceSet(S('sword_throw'), [E('pierce'), E('return')])).toBe(false);
    expect(legalEssenceSet(S('sword_throw'), [E('split'), E('haste'), E('leech')])).toBe(false);
    expect(legalEssenceSet(S('focus'), [E('haste')])).toBe(false);
    expect(legalEssenceSet(S('mon_zap'), [E('haste')])).toBe(false);
    expect(legalEssenceSet(S('focus'), [])).toBe(true);
  });

  it('canApplyEssence reasons', () => {
    expect(canApplyEssence(S('focus'), E('haste'), 1)).toMatchObject({ ok: false, reason: 'buff' });
    expect(canApplyEssence(S('sword_throw'), E('flurry'), 1)).toMatchObject({ ok: false, reason: 'shape' });
    const pierced = S('sword_throw~pierce');
    expect(canApplyEssence(pierced, E('return'), 2, [E('pierce')])).toMatchObject({ ok: false, reason: 'category' });
    expect(canApplyEssence(pierced, E('pierce'), 2)).toMatchObject({ ok: false, reason: 'category' });
    expect(canApplyEssence(pierced, E('haste'), 1, [E('pierce')])).toMatchObject({ ok: false, reason: 'slot' });
    expect(canApplyEssence(pierced, E('haste'), 2, [E('pierce')])).toEqual({ ok: true });
    expect(canApplyEssence(S('sword_throw~haste~pierce'), E('leech'), 2, [E('haste'), E('pierce')])).toMatchObject({
      ok: false,
      reason: 'slot',
    });
    expect(canApplyEssence(S('sword_throw'), E('split'), 1)).toEqual({ ok: true });
  });

  it('elementSlotState', () => {
    expect(elementSlotState(reg, S('sword_throw'))).toBe('free');
    expect(elementSlotState(reg, S('slash'))).toBe('free');
    expect(elementSlotState(reg, S('sword_throw~split'))).toBe('free');
    expect(elementSlotState(reg, S('sword_throw@fire~split'))).toBe('swap');
    expect(elementSlotState(reg, S('flame_spin'))).toBe('bound');
    expect(elementSlotState(reg, S('flame_spin~haste'))).toBe('bound');
    expect(elementSlotState(reg, S('focus'))).toBe('bound');
    expect(elementSlotState(reg, S('mon_zap'))).toBe('bound');
    expect(elementSlotState(reg, S('fuse:heavy_cleave|whirlwind'))).toBe('free');
    expect(elementSlotState(reg, S('fuse:heavy_cleave|whirlwind@water~haste'))).toBe('swap');
    expect(elementSlotState(reg, S('fuse:flame_spin|sword_throw'))).toBe('bound');
  });
});

// ------------------------------------------------------------------ merges

describe('shape merges', () => {
  it('SHAPE_PRIORITY orders dash > nova > projectile > chain > spin > strike > buff', () => {
    const order = Object.entries(SHAPE_PRIORITY)
      .sort((a, b) => b[1] - a[1])
      .map(([k]) => k);
    expect(order).toEqual(['dash', 'nova', 'projectile', 'chain', 'spin', 'strike', 'buff']);
  });

  it('trims a long primary name from the front without opening on a lowercase word (real data)', () => {
    const real = createRegistry();
    const eye = real.skill('eye_of_the_storm')!;
    expect(eye.name).toBe('Eye of the Storm');
    expect(mergeSkills(eye, real.skill('whirlwind')!)?.name).toBe('Storm Cyclone');
    expect(mergeSkills(real.skill('crescent_sweep')!, eye)?.name).toBe('Storm Rend');
    // Every legal merge over the real registry: ≤ 4 words, first word capitalized.
    const attacks = real.authoredSkills().filter((s) => s.shape.kind !== 'buff');
    const bad: string[] = [];
    let n = 0;
    for (let i = 0; i < attacks.length; i++) {
      for (let j = i + 1; j < attacks.length; j++) {
        const m = mergeSkills(attacks[i], attacks[j]);
        if (!m) continue;
        n++;
        const w = m.name.split(/\s+/);
        if (w.length > MAX_NAME_WORDS || !/^[A-Z]/.test(w[0])) bad.push(`${m.id}: ${m.name}`);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('the higher-priority parent sets the shape; a spin makes projectiles radial', () => {
    const m = mergeSkills(S('whirlwind'), S('sword_throw'))!;
    expect(m).not.toBeNull();
    expect(m.id).toBe('fuse:sword_throw|whirlwind');
    expect(m.name).toBe('Sword Throw Cyclone');
    expect(m.shape).toMatchObject({ kind: 'projectile', radial: true, pierce: 1 });
    expect(m.icon).toBe('sword_throw');
    expect(m.tier).toBe(2);
    expect(m.maxRank).toBe(5);
    expect(m.generated).toBe(true);
    expect(m.mergedFrom).toEqual(['sword_throw', 'whirlwind']);
    expect(m.tags).toEqual(expect.arrayContaining(['blade', 'spin', 'aoe', 'projectile', 'ranged', 'sword']));
    expect(m.weapons).toEqual(['sword']);
    expect(m.spCost).toBeCloseTo(8 + 0.6 * 6, 5);
    expect(m.cooldown).toBe(3000);
    // Per-cast damage is 1.1x the stronger parent: whirlwind deals 0.9 x 2 pulses = 1.8 > 1.3.
    expect(m.power).toBe(r2(1.1 * 1.8));
    expect(mergeSkills(S('sword_throw'), S('whirlwind'))).toEqual(m);
  });

  it('strike riders add a hit/pulse and the heavy parent cannot multiply', () => {
    const m = mergeSkills(S('heavy_cleave'), S('whirlwind'))!;
    expect(m.name).toBe('Whirlwind Rend');
    expect(m.shape).toMatchObject({ kind: 'spin', pulses: 3 });
    // 1.1 x max(2.0 x 1, 0.9 x 2) = 2.2 total, spread over 3 pulses.
    expect(m.power).toBe(r2(2.2 / 3));
    expect(m.power * shapeHits(m.shape)).toBeCloseTo(2.2, 1);
    expect(m.status).toBe('stun');
    // Both tier 1: the primary (spin) is the base it counts toward.
    expect(m.baseId).toBe('whirlwind');
  });

  it('strike + strike: +1 hit; ties broken by tier, baseId = higher tier', () => {
    const m = mergeSkills(S('heavy_cleave'), S('guillotine'))!;
    expect(m.name).toBe('Guillotine Rend');
    expect(m.shape).toMatchObject({ kind: 'strike', hits: 2, arc: 60 });
    expect(m.power).toBe(r2((1.1 * 3.6) / 2));
    expect(m.tier).toBe(3);
    expect(m.baseId).toBe('guillotine');
    expect(m.critBonus).toBe(15);
  });

  it('nova lower adds arc {2, 0.5}; an element passes over from the lower parent', () => {
    const m = mergeSkills(S('earthsplitter'), S('lunge'))!;
    expect(m.shape).toMatchObject({ kind: 'dash', distance: 150 });
    expect(m.riders).toEqual({ arc: { targets: 2, mult: 0.5 } });
    expect(m.name).toBe('Lunge Burst');
    expect(m.element).toBe('earth');
    // Earthsplitter is tier 2: the merge counts toward it.
    expect(m.baseId).toBe('earthsplitter');
  });

  it('a "+1" with no axis on the merged shape becomes arc {1, 0.5}', () => {
    const n = mergeSkills(S('quake'), S('chain_bolt'))!;
    expect(n.shape.kind).toBe('nova');
    expect(n.name).toBe('Quake Arc');
    expect(n.riders).toEqual({ arc: { targets: 1, mult: 0.5 } });
  });

  it('dash lower adds knockback', () => {
    const k = mergeSkills(S('lunge'), S('spinning_assault'))!;
    expect(k.shape).toMatchObject({ kind: 'dash', spin: true, distance: 180 });
    expect(k.riders).toEqual({ knockback: true });
    expect(k.name).toBe('Spinning Assault Rush');
  });

  it('spin lower on a dash makes it spin (or arcs if it already spins)', () => {
    const m = mergeSkills(S('lunge'), S('whirlwind'))!;
    expect(m.shape).toMatchObject({ kind: 'dash', spin: true });
    const already = mergeSkills(S('spinning_assault'), S('whirlwind'))!;
    expect(already.riders?.arc).toEqual({ targets: 1, mult: 0.5 });
  });

  it('projectile + projectile: +1 count, clamped', () => {
    const m = mergeSkills(S('fan'), S('knife_ring'))!;
    expect(m.shape.kind).toBe('projectile');
    expect(potentialHits(m)).toBeLessThanOrEqual(MAX_HITS);
    expect(m.weapons).toBeUndefined(); // knife_ring is any-weapon
  });

  it('a buff parent never merges (it adds no rider, so it could only dilute the SP budget)', () => {
    // guard and jab share the blade thread, yet the stance blocks the merge either way round.
    expect(mergeSkills(S('guard'), S('jab'))).toBeNull();
    expect(mergeSkills(S('jab'), S('guard'))).toBeNull();
    expect(mergeBlocker(S('guard'), S('jab'))).toMatch(/Guard is a stance, not a strike/);
    expect(mergeBlocker(S('jab'), S('guard'))).toMatch(/Guard is a stance, not a strike/);
  });

  it('aligned parents pass their element on', () => {
    const m = mergeSkills(S('flame_spin'), S('sword_throw'))!;
    expect(m.element).toBe('fire');
    expect(m.shape.kind).toBe('projectile');
  });

  it('refuses illegal merges', () => {
    expect(mergeSkills(S('slash'), S('whirlwind'))).toBeNull(); // tier 0
    expect(mergeSkills(S('whirlwind'), S('whirlwind'))).toBeNull();
    expect(mergeSkills(S('sword_throw@fire'), S('whirlwind'))).toBeNull(); // generated
    expect(mergeSkills(S('fuse:heavy_cleave|whirlwind'), S('sword_throw'))).toBeNull(); // never re-merged
    expect(mergeSkills(S('focus'), S('guard'))).toBeNull(); // two buffs
    expect(mergeSkills(S('focus'), S('quake'))).toBeNull(); // one buff (they share arcane)
    expect(mergeSkills(S('mon_zap'), S('sword_throw'))).toBeNull(); // monster-only
    expect(mergeSkills(S('lunge'), S('quake'))).toBeNull(); // no shared merge tag
  });

  it('mergeBlocker explains why', () => {
    expect(mergeBlocker(S('whirlwind'), S('sword_throw'))).toBeNull();
    expect(mergeBlocker(S('slash'), S('whirlwind'))).toMatch(/too simple/);
    expect(mergeBlocker(S('lunge'), S('quake'))).toMatch(/share no common thread/);
  });

  it('merges take an element and essences', () => {
    const v = S('fuse:sword_throw|whirlwind@fire~split');
    expect(v.id).toBe('fuse:sword_throw|whirlwind@fire~split');
    expect(v.name).toBe('Blazing Sword Throw Cyclone');
    expect(v.tier).toBe(3);
    expect(v.maxRank).toBe(5);
    expect(v.mergedFrom).toEqual(['sword_throw', 'whirlwind']);
    expect(v.baseId).toBe('sword_throw');
    expect(v.shape).toMatchObject({ kind: 'projectile', radial: true, count: 3 });
    expect(v.essences).toEqual(['split']);
  });
});
