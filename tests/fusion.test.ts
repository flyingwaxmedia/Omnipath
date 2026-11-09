import { describe, expect, it } from 'vitest';
import { essenceSlots, hintCandidates, resolveFusion, type FusionContext, type FusionOutcome } from '../src/core/fusion';
import { pairKey } from '../src/core/refs';
import { Registry } from '../src/core/registry';
import { countTagged, meetsRequirement, type RequirementContext } from '../src/core/requirements';
import type { SkillProgress } from '../src/core/state';
import type { ElementDef, ElementId, EssenceDef, GameData, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const el = (id: ElementId, name: string, prefix: string, tier: 0 | 1 = 0): ElementDef => ({
  id,
  name,
  prefix,
  icon: id,
  color: 0,
  tier,
  desc: name,
  status: 'burn',
  strongVs: [],
});

const ess = (e: Pick<EssenceDef, 'id' | 'category' | 'appliesTo'> & Partial<EssenceDef>): EssenceDef => ({
  name: e.id.charAt(0).toUpperCase() + e.id.slice(1),
  icon: e.id,
  desc: e.id,
  affix: { text: e.id.charAt(0).toUpperCase() + e.id.slice(1), pos: 'prefix' },
  powerMul: 0.9,
  spMul: 1.2,
  mod: {},
  ...e,
});

const sk = (s: Pick<SkillDef, 'id' | 'name' | 'shape'> & Partial<SkillDef>): SkillDef => ({
  desc: `${s.name}.`,
  icon: s.id,
  tier: 1,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 8,
  cooldown: 3000,
  maxRank: 10,
  ...s,
});

const DATA: GameData = {
  dataVersion: 2,
  elements: [
    el('fire', 'Fire', 'Blazing'),
    el('water', 'Water', 'Tidal'),
    el('wind', 'Wind', 'Gale'),
    el('earth', 'Earth', 'Stone'),
    el('ice', 'Ice', 'Frost', 1),
  ],
  skills: [
    sk({ id: 'slash', name: 'Slash', tier: 0, tags: ['blade', 'basic'], spCost: 0, cooldown: 0, shape: { kind: 'strike', range: 56, arc: 110 } }),
    sk({ id: 'whirlwind', name: 'Whirlwind', tags: ['blade', 'spin', 'aoe'], power: 0.9, shape: { kind: 'spin', radius: 84, pulses: 2 } }),
    sk({ id: 'sword_throw', name: 'Sword Throw', tags: ['blade', 'projectile'], power: 1.3, spCost: 6, shape: { kind: 'projectile', speed: 520, range: 300 } }),
    sk({ id: 'heavy_cleave', name: 'Heavy Cleave', tags: ['blade', 'heavy'], power: 2, spCost: 10, shape: { kind: 'strike', range: 70, arc: 160 } }),
    sk({ id: 'flame_spin', name: 'Flame Spin', tier: 2, maxRank: 8, tags: ['blade', 'spin', 'aoe'], element: 'fire', shape: { kind: 'spin', radius: 96, pulses: 3 } }),
    sk({ id: 'earthsplitter', name: 'Earthsplitter', tier: 2, maxRank: 8, tags: ['blade', 'heavy'], element: 'earth', shape: { kind: 'nova', radius: 80, range: 140 } }),
    sk({ id: 'cyclone_blades', name: 'Cyclone Blades', tier: 2, maxRank: 8, tags: ['blade', 'spin', 'projectile'], shape: { kind: 'projectile', speed: 380, range: 220, count: 8, radial: true } }),
    sk({ id: 'bolt', name: 'Bolt', weapons: ['staff'], tags: ['arcane', 'projectile'], shape: { kind: 'projectile', speed: 460, range: 280 } }),
    sk({ id: 'mend', name: 'Mend', weapons: undefined, tier: 1, maxRank: 3, tags: ['holy'], power: 0, shape: { kind: 'buff', stat: 'regen', amount: 3, duration: 8000 } }),
    sk({ id: 'focus', name: 'Focus', weapons: ['staff'], tags: ['arcane'], power: 0, shape: { kind: 'buff', stat: 'matk', amount: 30, duration: 12000 } }),
  ],
  morphs: [],
  recipes: [
    { a: 'el:fire', b: 'skill:whirlwind', result: 'skill:flame_spin', hint: 'A spinning blade could carry flame.' },
    { a: 'skill:sword_throw', b: 'skill:whirlwind', result: 'skill:cyclone_blades', hint: 'What if a spin released thrown blades?' },
    {
      a: 'el:earth',
      b: 'skill:heavy_cleave',
      result: 'skill:earthsplitter',
      requires: [{ type: 'flag', id: 'ore_mined', min: 10, label: 'Mine 10 ore' }],
      hint: 'A heavy blow could split the earth.',
    },
    { a: 'el:water', b: 'el:wind', result: 'el:ice' },
    {
      a: 'el:fire',
      b: 'el:water',
      result: 'passive:res_fire_water',
      requires: [
        { type: 'tagCount', tags: ['fire'], count: 2 },
        { type: 'tagCount', tags: ['water'], count: 1 },
      ],
      hint: 'Steam remembers both fire and water.',
    },
  ],
  classes: [],
  essences: [
    ess({ id: 'split', category: 'multiply', appliesTo: ['projectile'], powerMul: 1.1, spMul: 1.3, mod: { count: 2, spread: 25 } }),
    ess({ id: 'flurry', category: 'multiply', appliesTo: ['strike'], mod: { hits: 1 } }),
    ess({ id: 'pierce', category: 'propagate', appliesTo: ['projectile'], mod: { pierce: 2 } }),
    ess({ id: 'return', category: 'propagate', appliesTo: ['projectile'], mod: { returns: true } }),
    ess({ id: 'haste', category: 'tempo', appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'], cdMul: 0.7 }),
    ess({ id: 'leech', category: 'sustain', appliesTo: ['strike', 'spin', 'projectile', 'dash', 'nova', 'chain'], mod: { leech: 0.04 } }),
  ],
  passives: [
    { id: 'res_fire_water', name: 'Steam Resonance', icon: 'R', desc: '', source: 'resonance', maxRank: 1, effect: { kind: 'power', pct: 5 } },
  ],
  trainers: [],
  monsters: [],
  items: [],
};

const reg = new Registry(DATA);

interface Player {
  /** skill id -> rank (and overmastery bars). */
  skills?: Record<string, number | { rank: number; overBars: number }>;
  elements?: ElementId[];
  essences?: Record<string, number>;
  flags?: Record<string, number>;
}

/** A FusionContext over a plain player description (what the SkillBook implements for real). */
function ctxFor(p: Player): FusionContext {
  const skills: Record<string, SkillProgress> = {};
  for (const [id, v] of Object.entries(p.skills ?? {})) {
    const { rank, overBars } = typeof v === 'number' ? { rank: v, overBars: 0 } : v;
    skills[id] = { id, rank, xp: 0, charges: 0, uses: 0, source: 'test', learnedAt: 0, overBars, study: {} };
  }
  const elements = p.elements ?? [];
  const req: RequirementContext = {
    level: 1,
    hasElement: (id) => elements.includes(id),
    elementsKnown: () => elements.length,
    rank: (id) => skills[id]?.rank ?? 0,
    flag: (id) => p.flags?.[id] ?? 0,
    classRank: () => 0,
    worn: null,
    tagCount: (tags, minRank) => countTagged(reg, skills, tags, minRank),
    itemCount: () => 0,
    lessons: [],
    witness: () => 0,
  };
  return {
    has: (id) => id in skills,
    rank: (id) => skills[id]?.rank ?? 0,
    hasElement: (id) => elements.includes(id),
    essenceCount: (id) => p.essences?.[id] ?? 0,
    overBars: (id) => skills[id]?.overBars ?? 0,
    meets: (r) => meetsRequirement(r, req),
  };
}

const ALL_ELEMENTS: ElementId[] = ['fire', 'water', 'wind', 'earth', 'ice'];
const ALL_ESSENCES = { split: 1, flurry: 1, pierce: 1, return: 1, haste: 1, leech: 1 };

/** A player who owns everything listed at rank 5 with every element and one of each essence. */
const veteran = (skills: Player['skills'], extra: Omit<Player, 'skills'> = {}): FusionContext =>
  ctxFor({ elements: ALL_ELEMENTS, essences: ALL_ESSENCES, ...extra, skills });

const failure = (o: FusionOutcome) => {
  if (o.ok) throw new Error(`expected a failure, got ${o.result}`);
  return o;
};

// ------------------------------------------------------------------ pre-checks

describe('ingredient checks', () => {
  const ctx = veteran({ sword_throw: 5, whirlwind: 4 });

  it('same ingredient twice', () => {
    expect(resolveFusion(reg, ctx, 'skill:sword_throw', 'skill:sword_throw')).toMatchObject({ ok: false, reason: 'same' });
  });

  it('unknown, unowned or malformed ingredients are missing', () => {
    expect(failure(resolveFusion(reg, ctx, 'skill:bolt', 'el:fire')).reason).toBe('missing');
    expect(failure(resolveFusion(reg, ctxFor({ skills: { sword_throw: 5 } }), 'skill:sword_throw', 'el:fire')).reason).toBe('missing');
    expect(failure(resolveFusion(reg, ctxFor({ skills: { sword_throw: 5 } }), 'skill:sword_throw', 'mod:split')).message).toMatch(/no Split essence/);
    expect(failure(resolveFusion(reg, ctx, 'skill:sword_throw', 'passive:res_fire_water')).reason).toBe('missing');
    expect(failure(resolveFusion(reg, ctx, 'skill:sword_throw', 'garbage')).reason).toBe('missing');
    expect(failure(resolveFusion(reg, ctx, 'skill:nope', 'el:fire')).reason).toBe('missing');
  });

  it('skills must reach fusionMinRank (capped by maxRank)', () => {
    const o = failure(resolveFusion(reg, ctx, 'skill:whirlwind', 'el:wind'));
    expect(o.reason).toBe('rank');
    expect(o.message).toMatch(/rank 5/);
    // maxRank 3 -> rank 3 suffices; the buff then fails on its slot instead.
    expect(failure(resolveFusion(reg, veteran({ mend: 3 }), 'skill:mend', 'el:fire')).reason).toBe('bound');
  });
});

// ------------------------------------------------------------------ step 1

describe('step 1: authored recipes', () => {
  it('a recipe wins over the procedural steps', () => {
    expect(resolveFusion(reg, veteran({ whirlwind: 5 }), 'skill:whirlwind', 'el:fire')).toEqual({
      ok: true,
      result: 'skill:flame_spin',
      kind: 'authored',
    });
    expect(resolveFusion(reg, veteran({ whirlwind: 5, sword_throw: 5 }), 'skill:whirlwind', 'skill:sword_throw')).toMatchObject({
      ok: true,
      result: 'skill:cyclone_blades',
      kind: 'authored',
    });
  });

  it('unmet recipe requirements are reported', () => {
    const o = failure(resolveFusion(reg, veteran({ heavy_cleave: 5 }), 'el:earth', 'skill:heavy_cleave'));
    expect(o.reason).toBe('requirement');
    expect(o.unmet).toEqual([{ type: 'flag', id: 'ore_mined', min: 10, label: 'Mine 10 ore' }]);
    expect(o.message).toMatch(/Mine 10 ore/);
    const met = resolveFusion(reg, veteran({ heavy_cleave: 5 }, { flags: { ore_mined: 10 } }), 'el:earth', 'skill:heavy_cleave');
    expect(met).toMatchObject({ ok: true, result: 'skill:earthsplitter', kind: 'authored' });
  });

  it('element + element: fused element recipe', () => {
    expect(resolveFusion(reg, veteran({}), 'el:wind', 'el:water')).toEqual({ ok: true, result: 'el:ice', kind: 'authored' });
  });

  it('element + element: resonance gated by tag counts (variants count toward their base once)', () => {
    const none = failure(resolveFusion(reg, veteran({}), 'el:fire', 'el:water'));
    expect(none.reason).toBe('requirement');
    expect(none.unmet).toHaveLength(2);
    // Two fire variants of the same base still count as one fire skill.
    const one = veteran({ 'sword_throw@fire': 1, 'sword_throw@fire~split': 1, 'whirlwind@water': 1 });
    expect(failure(resolveFusion(reg, one, 'el:fire', 'el:water')).unmet).toEqual([{ type: 'tagCount', tags: ['fire'], count: 2 }]);
    const two = veteran({ 'sword_throw@fire': 1, flame_spin: 1, 'whirlwind@water': 1 });
    expect(resolveFusion(reg, two, 'el:fire', 'el:water')).toEqual({ ok: true, result: 'passive:res_fire_water', kind: 'authored' });
  });
});

// ------------------------------------------------------------------ step 2

describe('step 2: essences', () => {
  it('composes the variant and consumes the essence', () => {
    const o = resolveFusion(reg, veteran({ sword_throw: 5 }), 'skill:sword_throw', 'mod:split');
    expect(o).toEqual({ ok: true, result: 'skill:sword_throw~split', kind: 'essence', consumes: 'split' });
    expect(resolveFusion(reg, veteran({ sword_throw: 5 }), 'mod:split', 'skill:sword_throw')).toEqual(o);
  });

  it('works on element variants and merges', () => {
    expect(resolveFusion(reg, veteran({ 'sword_throw@fire': 5 }), 'skill:sword_throw@fire', 'mod:split')).toMatchObject({
      ok: true,
      result: 'skill:sword_throw@fire~split',
    });
    const merge = 'fuse:heavy_cleave|whirlwind';
    expect(resolveFusion(reg, veteran({ [merge]: 5 }), `skill:${merge}`, 'mod:haste')).toMatchObject({
      ok: true,
      result: `skill:${merge}~haste`,
      consumes: 'haste',
    });
  });

  it('does not consume an essence for a variant the player already knows', () => {
    const o = resolveFusion(reg, veteran({ sword_throw: 5, 'sword_throw~split': 1 }), 'skill:sword_throw', 'mod:split');
    expect(o).toEqual({ ok: true, result: 'skill:sword_throw~split', kind: 'essence' });
  });

  it('shape: appliesTo must include the shape kind; buffs take none', () => {
    expect(failure(resolveFusion(reg, veteran({ sword_throw: 5 }), 'skill:sword_throw', 'mod:flurry')).reason).toBe('shape');
    expect(failure(resolveFusion(reg, veteran({ focus: 5 }), 'skill:focus', 'mod:haste')).reason).toBe('shape');
  });

  it('category: same-category essences never stack', () => {
    const o = failure(resolveFusion(reg, veteran({ 'sword_throw~pierce': 5 }, { essences: ALL_ESSENCES }), 'skill:sword_throw~pierce', 'mod:return'));
    expect(o.reason).toBe('category');
    expect(o.message).toMatch(/Pierce/);
  });

  it('slot: the 2nd slot opens at 3 overmastery bars', () => {
    const id = 'sword_throw~split';
    expect(failure(resolveFusion(reg, veteran({ [id]: { rank: 8, overBars: 2 } }), `skill:${id}`, 'mod:haste')).reason).toBe('slot');
    expect(resolveFusion(reg, veteran({ [id]: { rank: 8, overBars: 3 } }), `skill:${id}`, 'mod:haste')).toEqual({
      ok: true,
      result: 'skill:sword_throw~haste~split',
      kind: 'essence',
      consumes: 'haste',
    });
    const full = 'sword_throw~haste~split';
    expect(failure(resolveFusion(reg, veteran({ [full]: { rank: 8, overBars: 5 } }), `skill:${full}`, 'mod:leech')).reason).toBe('slot');
  });

  it('essenceSlots', () => {
    expect(essenceSlots(reg.skill('focus')!, 9)).toBe(0);
    expect(essenceSlots(reg.skill('whirlwind')!, 2)).toBe(1);
    expect(essenceSlots(reg.skill('whirlwind')!, 3)).toBe(2);
  });
});

// ------------------------------------------------------------------ step 3

describe('step 3: elements', () => {
  it('infuses an unaligned attack (including basic attacks)', () => {
    expect(resolveFusion(reg, veteran({ sword_throw: 5 }), 'el:water', 'skill:sword_throw')).toEqual({
      ok: true,
      result: 'skill:sword_throw@water',
      kind: 'element',
    });
    expect(resolveFusion(reg, veteran({ slash: 5 }), 'skill:slash', 'el:fire')).toMatchObject({ ok: true, result: 'skill:slash@fire' });
  });

  it('swaps a variant element, keeping essences and consuming nothing', () => {
    const o = resolveFusion(reg, veteran({ 'sword_throw@fire~split': 5 }), 'skill:sword_throw@fire~split', 'el:water');
    expect(o).toEqual({ ok: true, result: 'skill:sword_throw@water~split', kind: 'element' });
    expect(resolveFusion(reg, veteran({ 'sword_throw~split': 5 }), 'skill:sword_throw~split', 'el:ice')).toMatchObject({
      ok: true,
      result: 'skill:sword_throw@ice~split',
    });
  });

  it('merges take an element', () => {
    const merge = 'fuse:heavy_cleave|whirlwind';
    expect(resolveFusion(reg, veteran({ [merge]: 5 }), `skill:${merge}`, 'el:fire')).toMatchObject({
      ok: true,
      result: `skill:${merge}@fire`,
    });
  });

  it('bound: authored aligned skills, buffs and same-element swaps', () => {
    const aligned = failure(resolveFusion(reg, veteran({ flame_spin: 5 }), 'skill:flame_spin', 'el:water'));
    expect(aligned.reason).toBe('bound');
    expect(aligned.message).toMatch(/already bound to fire/);
    const buff = failure(resolveFusion(reg, veteran({ focus: 5 }), 'skill:focus', 'el:fire'));
    expect(buff.reason).toBe('bound');
    expect(buff.message).toMatch(/no edge/);
    expect(failure(resolveFusion(reg, veteran({ 'sword_throw@fire': 5 }), 'skill:sword_throw@fire', 'el:fire')).reason).toBe('bound');
  });
});

// ------------------------------------------------------------------ step 5

describe('step 5: shape merges', () => {
  it('merges two authored skills sharing a tag', () => {
    expect(resolveFusion(reg, veteran({ heavy_cleave: 5, whirlwind: 5 }), 'skill:whirlwind', 'skill:heavy_cleave')).toEqual({
      ok: true,
      result: 'skill:fuse:heavy_cleave|whirlwind',
      kind: 'merge',
    });
    expect(reg.skill('fuse:heavy_cleave|whirlwind')).toBeDefined();
  });

  it('merges and variants are never merged again', () => {
    const merge = 'fuse:heavy_cleave|whirlwind';
    const o = failure(resolveFusion(reg, veteran({ [merge]: 5, sword_throw: 5 }), `skill:${merge}`, 'skill:sword_throw'));
    expect(o.reason).toBe('nothing');
    expect(o.message).toMatch(/cannot be merged again/);
    expect(failure(resolveFusion(reg, veteran({ 'sword_throw@fire': 5, heavy_cleave: 5 }), 'skill:sword_throw@fire', 'skill:heavy_cleave')).reason).toBe(
      'nothing',
    );
  });

  it('tier-0 skills and skills without a shared tag do not merge', () => {
    expect(failure(resolveFusion(reg, veteran({ slash: 5, whirlwind: 5 }), 'skill:slash', 'skill:whirlwind')).message).toMatch(/too simple/);
    expect(failure(resolveFusion(reg, veteran({ heavy_cleave: 5, bolt: 5 }), 'skill:heavy_cleave', 'skill:bolt')).message).toMatch(
      /share no common thread/,
    );
  });

  it('a buff parent never merges: nothing, with a clear message', () => {
    // focus shares the arcane thread with bolt, yet a stance has no rider to give.
    for (const [a, b] of [
      ['skill:bolt', 'skill:focus'],
      ['skill:focus', 'skill:bolt'],
      ['skill:mend', 'skill:whirlwind'],
    ]) {
      const o = failure(resolveFusion(reg, veteran({ bolt: 5, focus: 5, mend: 3, whirlwind: 5 }), a, b));
      expect(o.reason).toBe('nothing');
      expect(o.message).toMatch(/is a stance, not a strike; stances cannot be shape-merged/);
    }
  });
});

// ------------------------------------------------------------------ step 6

describe('step 6: nothing', () => {
  it('element pairs without a recipe drift apart', () => {
    const o = failure(resolveFusion(reg, veteran({}), 'el:fire', 'el:earth'));
    expect(o.reason).toBe('nothing');
    expect(o.message).toMatch(/drift apart/);
  });

  it('an essence needs a skill', () => {
    expect(failure(resolveFusion(reg, veteran({}), 'mod:split', 'el:fire')).reason).toBe('nothing');
    expect(failure(resolveFusion(reg, veteran({}), 'mod:split', 'mod:haste')).reason).toBe('nothing');
  });

  it('hintCandidates lists undiscovered hinted recipes using either ingredient', () => {
    const all = hintCandidates(reg, 'skill:whirlwind', 'el:earth', []);
    expect(all.map((r) => r.result)).toEqual(['skill:flame_spin', 'skill:cyclone_blades', 'skill:earthsplitter']);
    const some = hintCandidates(reg, 'skill:whirlwind', 'el:earth', [pairKey('el:fire', 'skill:whirlwind')]);
    expect(some.map((r) => r.result)).toEqual(['skill:cyclone_blades', 'skill:earthsplitter']);
    // A recipe using both ingredients is listed once; recipes without hints are skipped.
    expect(hintCandidates(reg, 'skill:sword_throw', 'skill:whirlwind', []).map((r) => r.result)).toEqual([
      'skill:cyclone_blades',
      'skill:flame_spin',
    ]);
    expect(hintCandidates(reg, 'el:water', 'el:wind', [])).toEqual([DATA.recipes[4]]);
  });
});

describe('purity', () => {
  it('resolveFusion is deterministic and leaves the data untouched', () => {
    const before = JSON.stringify(DATA);
    const ctx = veteran({ sword_throw: 5, whirlwind: 5, heavy_cleave: 5 });
    const pairs: [string, string][] = [
      ['skill:sword_throw', 'mod:split'],
      ['skill:whirlwind', 'skill:heavy_cleave'],
      ['skill:sword_throw', 'el:fire'],
      ['el:fire', 'el:water'],
    ];
    for (const [a, b] of pairs) expect(resolveFusion(reg, ctx, a, b)).toEqual(resolveFusion(reg, ctx, b, a));
    expect(JSON.stringify(DATA)).toBe(before);
  });
});
