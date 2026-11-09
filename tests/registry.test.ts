import { describe, expect, it } from 'vitest';
import { Registry } from '../src/core/registry';
import { countTagged, describeRequirement, meetsRequirement, type RequirementContext } from '../src/core/requirements';
import { elRef, modRef, parseRef, passiveRef, skillRef } from '../src/core/refs';
import type { SkillProgress } from '../src/core/state';
import type { ClassDef, ElementDef, ElementId, EssenceDef, GameData, ItemDef, MonsterDef, PassiveDef, Requirement, SkillDef, TrainerDef } from '../src/core/types';

// ------------------------------------------------------------------ the real content

describe('content (src/data)', () => {
  it('passes integrity validation', async () => {
    // Imported lazily so a half-written data bundle fails only this test.
    const { createRegistry } = await import('../src/data');
    expect(createRegistry().validate()).toEqual([]);
  });
});

// ------------------------------------------------------------------ inline fixture

const el = (id: ElementId, name: string, prefix: string): ElementDef => ({
  id,
  name,
  prefix,
  icon: `i_${id}`,
  color: 0,
  tier: 0,
  desc: name,
  status: 'burn',
  strongVs: [],
});

const sk = (s: Pick<SkillDef, 'id' | 'name' | 'shape'> & Partial<SkillDef>): SkillDef => ({
  desc: `${s.name}.`,
  icon: `i_${s.id}`,
  tier: 1,
  weapons: ['sword'],
  tags: ['blade'],
  power: 1,
  spCost: 8,
  cooldown: 3000,
  maxRank: 10,
  ...s,
});

const passive = (id: string, source: PassiveDef['source'] = 'trainer'): PassiveDef => ({
  id,
  name: id
    .split('_')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' '),
  icon: `i_${id}`,
  desc: '',
  source,
  maxRank: 3,
  effect: { kind: 'power', pct: 3 },
});

const monster = (m: Pick<MonsterDef, 'id' | 'name'> & Partial<MonsterDef>): MonsterDef => ({
  level: 5,
  hp: 100,
  atk: 10,
  def: 2,
  family: 'construct',
  size: 'L',
  rank: 'elite',
  exp: 10,
  coins: [1, 2],
  speed: 50,
  aggressive: true,
  radius: 16,
  attackRange: 40,
  attackDelay: 1000,
  respawn: 30000,
  ...m,
});

const SPLIT: EssenceDef = {
  id: 'split',
  name: 'Split',
  icon: 'i_split',
  desc: '',
  affix: { text: 'Split', pos: 'prefix' },
  category: 'multiply',
  appliesTo: ['projectile'],
  powerMul: 0.55,
  spMul: 1.3,
  mod: { count: 2 },
};

const CLASSES: ClassDef[] = [
  {
    id: 'pyroblade',
    name: 'Pyroblade',
    icon: 'P',
    desc: '',
    hint: '',
    tier: 1,
    clauses: [{ tags: ['blade', 'fire'], count: 2 }],
    bonus: {},
    imprint: 'imprint_pyroblade',
    tree: [
      { id: 'n1', kind: 'passive', ref: 'forgehand', cost: 1, maxRank: 3 },
      { id: 'n5', kind: 'skill', ref: 'whirlwind', cost: 2, maxRank: 1, requires: [{ node: 'n1', rank: 1 }] },
    ],
  },
  {
    id: 'magma_knight',
    name: 'Magma Knight',
    icon: 'M',
    desc: '',
    hint: '',
    tier: 2,
    clauses: [],
    parents: [{ id: 'pyroblade', rank: 10 }],
    bonus: {},
    grants: ['boulder_roll'],
  },
];

const TRAINERS: TrainerDef[] = [
  {
    id: 'hale',
    npc: 'hale',
    title: 'Drillmaster',
    lessons: [
      { id: 'rising_kick', name: 'Rising Kick', blurb: '', grants: { skill: 'boulder_roll' }, requires: [] },
      {
        id: 'forgehand',
        name: 'Forgehand',
        blurb: '',
        grants: { passive: 'forgehand' },
        requires: [{ type: 'lesson', id: 'rising_kick' }],
        cost: { items: { ore: 20 } },
      },
      { id: 'buy_split', name: 'Split essence', blurb: '', grants: { essence: 'split', count: 1 }, requires: [], repeatable: true },
    ],
  },
];

const ITEMS: ItemDef[] = [
  { id: 'ore', name: 'Ore', icon: 'o', kind: 'material', desc: '' },
  { id: 'tome_boulder', name: 'Tome', icon: 't', kind: 'tome', skill: 'boulder_roll', desc: '' },
  { id: 'fire_shard', name: 'Fire Shard', icon: 's', kind: 'shard', element: 'fire', desc: '' },
];

const CLEAN: GameData = {
  dataVersion: 2,
  elements: [el('fire', 'Fire', 'Blazing'), el('water', 'Water', 'Tidal'), el('wind', 'Wind', 'Gale')],
  skills: [
    sk({ id: 'slash', name: 'Slash', tier: 0, tags: ['blade', 'basic'], spCost: 0, cooldown: 0, shape: { kind: 'strike', range: 56, arc: 110 } }),
    sk({ id: 'whirlwind', name: 'Whirlwind', tags: ['blade', 'spin', 'aoe'], power: 0.9, shape: { kind: 'spin', radius: 84, pulses: 2 } }),
    sk({ id: 'sword_throw', name: 'Sword Throw', tags: ['blade', 'projectile'], power: 1.3, shape: { kind: 'projectile', speed: 520, range: 300 } }),
    sk({ id: 'guillotine', name: 'Guillotine', tier: 2, tags: ['blade', 'heavy'], power: 3.6, maxRank: 8, shape: { kind: 'strike', range: 64, arc: 60 } }),
    sk({ id: 'flame_spin', name: 'Flame Spin', tier: 2, maxRank: 8, tags: ['blade', 'spin'], element: 'fire', shape: { kind: 'spin', radius: 96, pulses: 3 } }),
    sk({ id: 'boulder_roll', name: 'Boulder Roll', weapons: undefined, tags: ['echo', 'dash', 'heavy'], shape: { kind: 'dash', distance: 160, width: 50 } }),
  ],
  morphs: [
    { from: 'slash', to: 'whirlwind', tier: 1, spark: { threat: 3 } },
    { from: 'slash', to: 'sword_throw', tier: 1, requires: [{ type: 'flag', id: 'ore_mined', min: 6 }] },
    { from: 'whirlwind', to: 'flame_spin', tier: 2 },
    { from: 'sword_throw', to: 'flame_spin', tier: 2 },
  ],
  recipes: [
    { a: 'el:fire', b: 'skill:whirlwind', result: 'skill:flame_spin', hint: 'A spinning blade could carry flame.' },
    {
      a: 'el:fire',
      b: 'el:water',
      result: 'passive:res_fire_water',
      requires: [
        { type: 'tagCount', tags: ['fire'], count: 2 },
        { type: 'tagCount', tags: ['water'], count: 1 },
      ],
    },
    { a: 'skill:sword_throw', b: 'mod:split', result: 'skill:guillotine', requires: [{ type: 'witness', skill: 'boulder_roll', count: 3 }] },
  ],
  classes: CLASSES,
  essences: [SPLIT],
  passives: [passive('forgehand'), passive('res_fire_water', 'resonance'), passive('imprint_pyroblade', 'imprint')],
  trainers: TRAINERS,
  monsters: [
    monster({
      id: 'boulderback',
      name: 'Boulderback',
      essence: 'split',
      drops: [{ item: 'tome_boulder', chance: 0.1, once: true }],
      techniques: [{ skill: 'boulder_roll', weight: 1, cooldown: 4000, range: 120, echo: { marks: 3 } }],
    }),
    monster({ id: 'pebble', name: 'Pebble', base: 'boulderback', techniques: [{ skill: 'boulder_roll', weight: 1, cooldown: 4000, range: 120 }] }),
  ],
  items: ITEMS,
};

const reg = new Registry(CLEAN);

// ------------------------------------------------------------------ validate

describe('validate', () => {
  it('a consistent bundle has no problems', () => {
    expect(reg.validate()).toEqual([]);
  });

  it('reports every class of problem', () => {
    const bad: GameData = {
      ...CLEAN,
      skills: [
        ...CLEAN.skills,
        sk({ id: 'bad@id', name: 'Bad', shape: { kind: 'strike', range: 1, arc: 1 } }),
        sk({ id: 'odd|id', name: 'Odd', shape: { kind: 'strike', range: 1, arc: 1 } }),
        sk({ id: 'whirlwind', name: 'Whirlwind Again', shape: { kind: 'spin', radius: 1 } }),
        sk({ id: 'storm_slash', name: 'Storm Slash', element: 'storm', shape: { kind: 'strike', range: 1, arc: 1 } }),
        sk({ id: 'zero', name: 'Zero', maxRank: 0, shape: { kind: 'strike', range: 1, arc: 1 } }),
      ],
      essences: [SPLIT, { ...SPLIT, id: 'split' }, { ...SPLIT, id: 'bad~ess', appliesTo: [] }],
      morphs: [
        ...CLEAN.morphs,
        { from: 'slash', to: 'whirlwind' },
        { from: 'ghost', to: 'phantom' },
        { from: 'flame_spin', to: 'guillotine', tier: 3, spark: { threat: 9 } },
        { from: 'slash', to: 'slash' },
        { from: 'whirlwind', to: 'guillotine', requires: [{ type: 'skill', id: 'nope', rank: 5 }] },
      ],
      recipes: [
        ...CLEAN.recipes,
        { a: 'skill:whirlwind', b: 'el:fire', result: 'skill:guillotine' },
        { a: 'el:fire', b: 'el:wind', result: 'passive:forgehand' },
        { a: 'mod:ghost', b: 'skill:slash', result: 'passive:nothing_here' },
        { a: 'passive:forgehand', b: 'skill:slash', result: 'skill:whirlwind' },
        { a: 'el:water', b: 'el:water', result: 'el:fire' },
        { a: 'skill:slash', b: 'el:wind', result: 'skill:whirlwind', requires: [{ type: 'element', id: 'storm' }] },
      ],
      classes: [
        ...CLASSES,
        { ...CLASSES[0] },
        {
          id: 'orphan',
          name: 'Orphan',
          icon: 'O',
          desc: '',
          hint: '',
          tier: 3,
          clauses: [{ tags: ['blade'], count: 1 }],
          bonus: {},
          grants: ['ghost_sig'],
          imprint: 'imprint_ghost',
          tree: [
            { id: 'n1', kind: 'passive', ref: 'ghost_passive', cost: 1, maxRank: 3 },
            { id: 'n1', kind: 'skill', ref: 'ghost_skill', cost: 1, maxRank: 1, requires: [{ node: 'n9', rank: 1 }] },
          ],
          requires: [{ type: 'class', id: 'ghost_class' }],
        },
        {
          id: 'inverted',
          name: 'Inverted',
          icon: 'I',
          desc: '',
          hint: '',
          tier: 2,
          clauses: [],
          parents: [
            { id: 'magma_knight', rank: 4 },
            { id: 'ghost_class', rank: 4 },
          ],
          bonus: {},
        },
        { id: 'empty', name: 'Empty', icon: 'E', desc: '', hint: '', tier: 1, clauses: [], bonus: {} },
      ],
      passives: [...CLEAN.passives, passive('forgehand')],
      trainers: [
        ...TRAINERS,
        {
          id: 'vey',
          npc: 'vey',
          title: 'Quartermaster',
          lessons: [
            { id: 'rising_kick', name: 'Dup', blurb: '', grants: { skill: 'ghost_tech' }, requires: [] },
            { id: 'l_passive', name: 'P', blurb: '', grants: { passive: 'ghost_passive' }, requires: [{ type: 'lesson', id: 'ghost_lesson' }] },
            { id: 'l_essence', name: 'E', blurb: '', grants: { essence: 'ghost_ess', count: 1 }, requires: [{ type: 'witness', skill: 'ghost_echo', count: 3 }] },
            {
              id: 'l_element',
              name: 'El',
              blurb: '',
              grants: { element: 'twilight' },
              requires: [{ type: 'class', id: 'ghost_class', worn: true }],
              cost: { items: { ghost_item: 3 } },
            },
          ],
        },
      ],
      monsters: [
        ...CLEAN.monsters,
        monster({ id: 'pebble', name: 'Pebble Again' }),
        monster({
          id: 'wisp',
          name: 'Wisp',
          essence: 'ghost_ess',
          drops: [{ item: 'ghost_item', chance: 1 }],
          techniques: [{ skill: 'ghost_tech', weight: 1, cooldown: 1, range: 1 }],
          base: 'ghost_species',
        }),
      ],
      items: [
        ...ITEMS,
        { id: 'ore', name: 'Ore Again', icon: 'o', kind: 'material', desc: '' },
        { id: 'tome_ghost', name: 'Tome', icon: 't', kind: 'tome', skill: 'ghost_tome', desc: '' },
        { id: 'storm_shard', name: 'Storm Shard', icon: 's', kind: 'shard', element: 'storm', desc: '' },
      ],
    };
    const errs = new Registry(bad).validate();
    const expected = [
      'skill bad@id: id uses a reserved character',
      'skill odd|id: id uses a reserved character',
      'skill whirlwind: duplicate id',
      'skill storm_slash: unknown element storm',
      'skill zero: maxRank < 1',
      'essence split: duplicate id',
      'essence bad~ess: id uses a reserved character',
      'essence bad~ess: empty appliesTo',
      'morph slash>whirlwind: duplicate edge',
      'morph ghost>phantom: unknown source ghost',
      'morph ghost>phantom: unknown result phantom',
      'morph flame_spin>guillotine: capstone (tier 3) morphs cannot spark',
      'morph slash>slash: morphs into itself',
      'morph whirlwind>guillotine: unknown skill nope',
      'recipe el:fire+skill:whirlwind: duplicate pair',
      'recipe el:fire+el:wind: element pair result passive:forgehand is not a resonance passive',
      'recipe mod:ghost+skill:slash: unknown ref mod:ghost',
      'recipe mod:ghost+skill:slash: unknown ref passive:nothing_here',
      'recipe passive:forgehand+skill:slash: passive passive:forgehand cannot be an ingredient',
      'recipe el:water+el:water: same ingredient twice',
      'recipe el:wind+skill:slash: unknown element storm',
      'class pyroblade: duplicate id',
      'class orphan: unknown granted skill ghost_sig',
      'class orphan: unknown imprint passive imprint_ghost',
      'class orphan: Tier 3 class without parents',
      'class orphan: duplicate tree node n1',
      'class orphan: tree node n1 has unknown passive ghost_passive',
      'class orphan: tree node n1 has unknown skill ghost_skill',
      'class orphan: tree node n1 requires unknown node n9',
      'class orphan: unknown class ghost_class',
      'class inverted: parent magma_knight (tier 2) is not below tier 2',
      'class inverted: unknown parent class ghost_class',
      'class empty: no requirements',
      'passive forgehand: duplicate id',
      'lesson rising_kick: duplicate id',
      'lesson vey/rising_kick: unknown skill ghost_tech',
      'lesson vey/l_passive: unknown passive ghost_passive',
      'lesson vey/l_passive: unknown lesson ghost_lesson',
      'lesson vey/l_essence: unknown essence ghost_ess',
      'lesson vey/l_essence: unknown witness skill ghost_echo',
      'lesson vey/l_element: unknown element twilight',
      'lesson vey/l_element: unknown class ghost_class',
      'lesson vey/l_element: unknown cost item ghost_item',
      'monster pebble: duplicate id',
      'monster wisp: unknown technique ghost_tech',
      'monster wisp: unknown essence ghost_ess',
      'monster wisp: unknown drop ghost_item',
      'monster wisp: unknown base species ghost_species',
      'item ore: duplicate id',
      'item tome_ghost: unknown tome skill ghost_tome',
      'item storm_shard: unknown shard element storm',
    ];
    for (const e of expected) expect(errs.some((x) => x.startsWith(e)), `missing: ${e}\n${errs.join('\n')}`).toBe(true);
    expect(errs).toHaveLength(expected.length);
  });
});

// ------------------------------------------------------------------ lookups

describe('registry lookups', () => {
  it('normalizes authored skills (element and weapons become tags)', () => {
    expect(reg.skill('flame_spin')!.tags).toEqual(['blade', 'spin', 'fire', 'sword']);
    expect(reg.dataVersion).toBe(2);
    expect(reg.authoredSkills().map((s) => s.id)).toEqual(CLEAN.skills.map((s) => s.id));
    expect(reg.isAuthored('slash')).toBe(true);
    expect(reg.isAuthored('slash@fire')).toBe(false);
  });

  it('composes v1, variant and merge ids deterministically and caches them', () => {
    const a = reg.skill('slash@fire')!;
    expect(a.name).toBe('Blazing Slash');
    expect(reg.skill('slash@fire')).toBe(a);
    expect(new Registry(CLEAN).skill('slash@fire')).toEqual(a);
    expect(reg.skill('sword_throw@water~split')!.essences).toEqual(['split']);
    expect(reg.skill('fuse:guillotine|whirlwind')!.mergedFrom).toEqual(['guillotine', 'whirlwind']);
    expect(reg.skill('fuse:guillotine|whirlwind@wind')!.element).toBe('wind');
  });

  it('rejects illegal ids', () => {
    expect(reg.skill('fuse:flame_spin|whirlwind')?.element).toBe('fire');
    for (const id of [
      'nope',
      'flame_spin@water', // aligned
      'slash@storm', // unknown element
      'whirlwind~split', // split is projectile-only
      'sword_throw~ghost',
      'sword_throw~split~split',
      'fuse:whirlwind|sword_throw', // not canonical
      'fuse:slash|whirlwind', // tier 0
      'fuse:ghost|whirlwind',
      'fuse:boulder_roll|flame_spin', // no shared merge tag
      'fuse:flame_spin|whirlwind@water', // the merge inherits fire: bound
    ]) {
      expect(reg.skill(id), id).toBeUndefined();
    }
  });

  it('baseOf rolls variants up to their base and merges to the higher-tier parent', () => {
    expect(reg.baseOf('slash')).toBe('slash');
    expect(reg.baseOf('sword_throw@water~split')).toBe('sword_throw');
    expect(reg.baseOf('fuse:guillotine|whirlwind')).toBe('guillotine');
    expect(reg.baseOf('fuse:guillotine|whirlwind@wind')).toBe('guillotine');
    expect(reg.baseOf('nope@fire')).toBeUndefined();
  });

  it('indexes morphs, recipes, lessons, trainers and techniques', () => {
    expect(reg.morphsFrom('slash').map((m) => m.to)).toEqual(['whirlwind', 'sword_throw']);
    expect(reg.morphsTo('flame_spin').map((m) => m.from)).toEqual(['whirlwind', 'sword_throw']);
    expect(reg.recipe('skill:whirlwind', 'el:fire')?.result).toBe('skill:flame_spin');
    expect(reg.recipe('el:fire', 'skill:whirlwind')?.result).toBe('skill:flame_spin');
    expect(reg.recipesWith('el:fire').map((r) => r.result)).toEqual(['skill:flame_spin', 'passive:res_fire_water']);
    expect(reg.lesson('forgehand')?.trainer.id).toBe('hale');
    expect(reg.lesson('forgehand')?.lesson.grants).toEqual({ passive: 'forgehand' });
    expect(reg.lesson('nope')).toBeUndefined();
    expect(reg.trainer('hale')?.title).toBe('Drillmaster');
    expect(reg.techniqueSources('boulder_roll').map((t) => [t.monster.id, t.technique.echo?.marks])).toEqual([
      ['boulderback', 3],
      ['pebble', undefined],
    ]);
    expect(reg.classDef('magma_knight')?.tier).toBe(2);
    expect(reg.essence('split')?.category).toBe('multiply');
    expect(reg.passive('forgehand')?.source).toBe('trainer');
    expect(reg.monster('pebble')?.base).toBe('boulderback');
    expect(reg.item('ore')?.kind).toBe('material');
    expect(reg.element('wind')?.prefix).toBe('Gale');
  });

  it('refs of every kind', () => {
    expect(parseRef(modRef('split'))).toEqual({ kind: 'mod', id: 'split' });
    expect(parseRef(passiveRef('forgehand'))).toEqual({ kind: 'passive', id: 'forgehand' });
    expect(parseRef(skillRef('fuse:guillotine|whirlwind'))).toEqual({ kind: 'skill', id: 'fuse:guillotine|whirlwind' });
    expect(() => parseRef('bogus:x')).toThrow();
    expect(() => parseRef('skill:')).toThrow();
    for (const [ref, name, icon] of [
      [skillRef('sword_throw@fire'), 'Blazing Sword Throw', 'i_sword_throw'],
      [elRef('water'), 'Water', 'i_water'],
      [modRef('split'), 'Split', 'i_split'],
      [passiveRef('res_fire_water'), 'Res Fire Water', 'i_res_fire_water'],
    ]) {
      expect(reg.refExists(ref)).toBe(true);
      expect(reg.refName(ref)).toBe(name);
      expect(reg.refIcon(ref)).toBe(icon);
    }
    expect(reg.refExists('mod:ghost')).toBe(false);
    expect(reg.refExists('garbage')).toBe(false);
    expect(reg.refName('mod:ghost')).toBe('ghost');
    expect(reg.refName('garbage')).toBe('garbage');
    expect(reg.refIcon('passive:ghost')).toBe('?');
  });
});

// ------------------------------------------------------------------ requirements

const progress = (ranks: Record<string, number>): Record<string, SkillProgress> =>
  Object.fromEntries(
    Object.entries(ranks).map(([id, rank]) => [
      id,
      { id, rank, xp: 0, charges: 0, uses: 0, source: 'test', learnedAt: 0, overBars: 0, study: {} },
    ]),
  );

describe('countTagged', () => {
  it('counts distinct authored skills; variants roll up to their base at the max rank', () => {
    const skills = progress({ whirlwind: 3, 'whirlwind@fire': 6, 'sword_throw@fire~split': 2, flame_spin: 5, guillotine: 7 });
    expect(countTagged(reg, skills, ['blade'])).toBe(4);
    expect(countTagged(reg, skills, ['blade'], 5)).toBe(3); // whirlwind (via @fire r6), flame_spin, guillotine
    expect(countTagged(reg, skills, ['fire'])).toBe(3); // whirlwind@fire, sword_throw@fire~split, flame_spin
    expect(countTagged(reg, skills, ['fire'], 5)).toBe(2); // the fire variant of sword_throw is only rank 2
    expect(countTagged(reg, skills, ['blade', 'fire'], 6)).toBe(1);
    expect(countTagged(reg, skills, ['infused'])).toBe(2);
  });

  it('a merge counts toward its higher-tier parent', () => {
    const skills = progress({ 'fuse:guillotine|whirlwind': 4, whirlwind: 2 });
    expect(countTagged(reg, skills, ['spin'])).toBe(2); // guillotine (via the merge) + whirlwind
    expect(countTagged(reg, skills, ['heavy'], 4)).toBe(1);
    expect(countTagged(reg, skills, ['spin'], 3)).toBe(1);
  });

  it('an empty tag list matches every skill', () => {
    const skills = progress({ whirlwind: 3, 'whirlwind@fire': 6, slash: 2, 'fuse:guillotine|whirlwind': 1 });
    expect(countTagged(reg, skills, [])).toBe(3); // whirlwind, slash, guillotine (via the merge)
    expect(countTagged(reg, skills, [], 3)).toBe(1);
  });

  it('ignores unknown ids', () => {
    expect(countTagged(reg, progress({ ghost: 9 }), [])).toBe(0);
  });
});

describe('meetsRequirement', () => {
  const ctx: RequirementContext = {
    level: 6,
    hasElement: (id) => id === 'fire',
    elementsKnown: (primalOnly) => (primalOnly ? 2 : 3),
    rank: (id) => ({ whirlwind: 5 })[id] ?? 0,
    flag: (id) => ({ ore_mined: 3, 'visited:vale.moonlit_glade': 1 })[id] ?? 0,
    classRank: (id) => ({ pyroblade: 10, magma_knight: 2 })[id] ?? 0,
    worn: 'pyroblade',
    tagCount: (tags, minRank = 1) => (tags.includes('blade') ? (minRank > 3 ? 1 : 2) : 0),
    itemCount: (id) => ({ ore: 20 })[id] ?? 0,
    lessons: ['rising_kick'],
    witness: (id) => ({ boulder_roll: 3 })[id] ?? 0,
  };
  const cases: [Requirement, boolean][] = [
    [{ type: 'element', id: 'fire' }, true],
    [{ type: 'element', id: 'water' }, false],
    [{ type: 'elementsKnown', count: 3 }, true],
    [{ type: 'elementsKnown', count: 3, primalOnly: true }, false],
    [{ type: 'skill', id: 'whirlwind', rank: 5 }, true],
    [{ type: 'skill', id: 'whirlwind', rank: 6 }, false],
    [{ type: 'skill', id: 'whirlwind' }, true],
    [{ type: 'skill', id: 'slash' }, false],
    [{ type: 'flag', id: 'ore_mined', min: 3 }, true],
    [{ type: 'flag', id: 'ore_mined', min: 6 }, false],
    [{ type: 'level', min: 6 }, true],
    [{ type: 'level', min: 7 }, false],
    [{ type: 'class', id: 'pyroblade', rank: 10 }, true],
    [{ type: 'class', id: 'pyroblade', rank: 10, worn: true }, true],
    [{ type: 'class', id: 'magma_knight' }, true],
    [{ type: 'class', id: 'magma_knight', worn: true }, false],
    [{ type: 'class', id: 'magma_knight', rank: 3 }, false],
    [{ type: 'class', id: 'arcanist' }, false],
    [{ type: 'tagCount', tags: ['blade'], count: 2 }, true],
    [{ type: 'tagCount', tags: ['blade'], count: 2, minRank: 5 }, false],
    [{ type: 'item', id: 'ore', count: 20 }, true],
    [{ type: 'item', id: 'ore', count: 21 }, false],
    [{ type: 'lesson', id: 'rising_kick' }, true],
    [{ type: 'lesson', id: 'forgehand' }, false],
    [{ type: 'mapVisited', id: 'vale.moonlit_glade' }, true],
    [{ type: 'mapVisited', id: 'vale.lake_islet' }, false],
    [{ type: 'witness', skill: 'boulder_roll', count: 3 }, true],
    [{ type: 'witness', skill: 'boulder_roll', count: 4 }, false],
  ];
  it.each(cases)('%j -> %s', (req, expected) => {
    expect(meetsRequirement(req, ctx)).toBe(expected);
  });
});

describe('describeRequirement', () => {
  const cases: [Requirement, string][] = [
    [{ type: 'skill', id: 'whirlwind', rank: 5 }, 'Whirlwind rank 5'],
    [{ type: 'skill', id: 'sword_throw@fire' }, 'Blazing Sword Throw rank 1'],
    [{ type: 'element', id: 'wind' }, 'Attune Wind'],
    [{ type: 'flag', id: 'ore_mined', min: 6, label: 'Mine 6 ore' }, 'Mine 6 ore'],
    [{ type: 'flag', id: 'ore_mined', min: 6 }, 'Ore Mined ×6'],
    [{ type: 'level', min: 6 }, 'Base level 6'],
    [{ type: 'class', id: 'pyroblade', rank: 10 }, 'Pyroblade CR 10'],
    [{ type: 'class', id: 'pyroblade' }, 'Discover Pyroblade'],
    [{ type: 'class', id: 'pyroblade', worn: true }, 'Wear Pyroblade'],
    [{ type: 'class', id: 'magma_knight', rank: 4, worn: true }, 'Wear Magma Knight (CR 4)'],
    [{ type: 'elementsKnown', count: 3 }, '3 elements attuned'],
    [{ type: 'elementsKnown', count: 1, primalOnly: true }, '1 primal element attuned'],
    [{ type: 'tagCount', tags: ['blade', 'fire'], count: 2, minRank: 5 }, '2 skills tagged blade + fire (rank 5)'],
    [{ type: 'tagCount', tags: ['water'], count: 1 }, '1 skill tagged water'],
    [{ type: 'tagCount', tags: [], count: 1, minRank: 3 }, 'Any skill rank 3'],
    [{ type: 'tagCount', tags: [], count: 2 }, '2 skills'],
    [{ type: 'mapVisited', id: 'vale.moonlit_glade' }, 'Visit Moonlit Glade'],
    [{ type: 'mapVisited', id: 'vale.quarry_depths.1' }, 'Visit Quarry Depths 1'],
    [{ type: 'item', id: 'ore', count: 20 }, '20 Ore'],
    [{ type: 'lesson', id: 'rising_kick' }, 'Lesson: Rising Kick'],
    [{ type: 'witness', skill: 'boulder_roll', count: 3 }, 'Witness Boulder Roll 3 times'],
    [{ type: 'witness', skill: 'boulder_roll', count: 1 }, 'Witness Boulder Roll once'],
    [{ type: 'item', id: 'mystery_dust', count: 2 }, '2 Mystery Dust'],
  ];
  it.each(cases)('%j -> %s', (req, text) => {
    expect(describeRequirement(reg, req)).toBe(text);
  });

  it('shows flag progress when given a context', () => {
    const ctx = { flag: () => 3 } as unknown as RequirementContext;
    expect(describeRequirement(reg, { type: 'flag', id: 'ore_mined', min: 6 }, ctx)).toBe('Ore Mined 3/6');
  });
});
