import { describe, expect, it } from 'vitest';
import { Registry } from '../src/core/registry';
import { countTagged } from '../src/core/requirements';
import type { SkillProgress } from '../src/core/state';
import { lessonState, lessonsFor, type TrainerContext } from '../src/core/trainers';
import type { ElementDef, ElementId, EssenceDef, GameData, ItemDef, LessonDef, PassiveDef, SkillDef } from '../src/core/types';

// ------------------------------------------------------------------ inline fixture

const sk = (id: string, name: string, shape: SkillDef['shape'], tags: string[] = []): SkillDef => ({
  id,
  name,
  desc: name,
  icon: id,
  tier: 1,
  tags,
  power: 1,
  spCost: 6,
  cooldown: 2500,
  maxRank: 5,
  shape,
});

const el = (id: ElementId, name: string): ElementDef => ({
  id,
  name,
  prefix: name,
  icon: id,
  color: 0,
  tier: 0,
  desc: name,
  status: 'smite',
  strongVs: [],
});

const passive = (id: string, name: string, maxRank = 3): PassiveDef => ({
  id,
  name,
  icon: id,
  desc: name,
  source: 'trainer',
  maxRank,
  effect: { kind: 'stat', stat: 'speed', pct: 3 },
});

const HEAVY: EssenceDef = {
  id: 'heavy',
  name: 'Heavy',
  icon: 'heavy',
  desc: 'Heavy',
  affix: { text: 'Heavy', pos: 'prefix' },
  category: 'tempo',
  appliesTo: ['strike', 'spin', 'dash'],
  powerMul: 1.5,
  spMul: 1.2,
  cdMul: 1.6,
  mod: { knockback: true },
  tag: 'heavy',
};

const ITEMS: ItemDef[] = [
  { id: 'ore', name: 'Ore', icon: 'ore', kind: 'material', desc: 'Ore' },
  { id: 'herb', name: 'Herb', icon: 'herb', kind: 'material', desc: 'Herb' },
];

const STRIKE: SkillDef['shape'] = { kind: 'strike', range: 56, arc: 90 };

const lesson = (l: Pick<LessonDef, 'id' | 'grants'> & Partial<LessonDef>): LessonDef => ({
  name: l.id,
  blurb: '',
  requires: [],
  ...l,
});

const DATA: GameData = {
  dataVersion: 2,
  elements: [el('holy', 'Holy'), el('fire', 'Fire'), el('water', 'Water')],
  skills: [
    sk('slash', 'Slash', STRIKE, ['blade', 'basic']),
    sk('rising_kick', 'Rising Kick', STRIKE),
    sk('shoulder_charge', 'Shoulder Charge', { kind: 'dash', distance: 120, width: 40 }, ['heavy']),
  ],
  morphs: [],
  recipes: [],
  classes: [],
  essences: [HEAVY],
  passives: [passive('sure_footing', 'Sure Footing'), passive('devotion', 'Devotion')],
  trainers: [
    {
      id: 'hale',
      npc: 'hale',
      title: 'Drill Yard',
      lessons: [
        lesson({ id: 'hale_rising_kick', name: 'Rising Kick', grants: { skill: 'rising_kick' }, cost: { coins: 20 } }),
        lesson({
          id: 'hale_shoulder_charge',
          grants: { skill: 'shoulder_charge' },
          requires: [{ type: 'tagCount', tags: [], count: 1, minRank: 3 }],
          cost: { coins: 60, items: { herb: 3 } },
        }),
        lesson({
          id: 'hale_sure_footing',
          grants: { passive: 'sure_footing' },
          requires: [{ type: 'lesson', id: 'hale_rising_kick' }],
          cost: { coins: 80, items: { herb: 4 } },
          repeatable: true,
        }),
      ],
    },
    {
      id: 'hale_evening',
      npc: 'hale',
      title: 'Evening Drills',
      lessons: [lesson({ id: 'hale_devotion', grants: { passive: 'devotion' } })],
    },
    {
      id: 'brann',
      npc: 'brann',
      title: 'Forge',
      lessons: [
        lesson({
          id: 'brann_heavy',
          grants: { essence: 'heavy', count: 1 },
          requires: [{ type: 'flag', id: 'forge_success', min: 3 }],
          cost: { coins: 50, items: { ore: 2 } },
          repeatable: true,
        }),
      ],
    },
    {
      id: 'alba',
      npc: 'alba',
      title: 'Chapel',
      lessons: [
        lesson({
          id: 'alba_holy',
          grants: { element: 'holy' },
          requires: [
            { type: 'elementsKnown', count: 3 },
            { type: 'level', min: 4 },
            { type: 'flag', id: 'prayers', min: 2, label: 'Pray twice' },
          ],
        }),
      ],
    },
  ],
  monsters: [],
  items: ITEMS,
};

const reg = new Registry(DATA);

interface Player {
  level?: number;
  ranks?: Record<string, number>;
  elements?: ElementId[];
  flags?: Record<string, number>;
  lessons?: string[];
  passives?: Record<string, number>;
  coins?: number;
  items?: Record<string, number>;
}

const progress = (id: string, rank: number): SkillProgress => ({
  id,
  rank,
  xp: 0,
  charges: 0,
  uses: 0,
  source: 'test',
  learnedAt: 0,
  overBars: 0,
  study: {},
});

/** A TrainerContext over plain maps; tag counts use the real countTagged rules. */
function ctxOf(p: Player = {}): TrainerContext {
  const ranks = p.ranks ?? {};
  const skills = Object.fromEntries(Object.entries(ranks).map(([id, r]) => [id, progress(id, r)]));
  const elements = p.elements ?? [];
  return {
    level: p.level ?? 1,
    hasElement: (id) => elements.includes(id),
    elementsKnown: () => elements.length,
    rank: (id) => ranks[id] ?? 0,
    flag: (id) => p.flags?.[id] ?? 0,
    classRank: () => 0,
    worn: null,
    tagCount: (tags, minRank) => countTagged(reg, skills, tags, minRank),
    itemCount: (id) => p.items?.[id] ?? 0,
    lessons: p.lessons ?? [],
    witness: () => 0,
    has: (id) => id in ranks,
    passiveRank: (id) => p.passives?.[id] ?? 0,
    coins: () => p.coins ?? 0,
  };
}

// ------------------------------------------------------------------ tests

describe('fixture', () => {
  it('is a consistent bundle', () => {
    expect(reg.validate()).toEqual([]);
  });
});

describe('lessonsFor', () => {
  it('lists every lesson of every trainer on the NPC, in data order', () => {
    expect(lessonsFor(reg, 'hale').map((l) => l.id)).toEqual([
      'hale_rising_kick',
      'hale_shoulder_charge',
      'hale_sure_footing',
      'hale_devotion',
    ]);
    expect(lessonsFor(reg, 'brann').map((l) => l.id)).toEqual(['brann_heavy']);
  });

  it('is empty for NPCs that teach nothing', () => {
    expect(lessonsFor(reg, 'child_lio')).toEqual([]);
  });
});

describe('lessonState', () => {
  it('a free-of-requirements lesson is available; affordability follows coins', () => {
    expect(lessonState(reg, ctxOf(), 'hale_rising_kick')).toMatchObject({
      owned: false,
      available: true,
      affordable: false,
      missing: [],
    });
    expect(lessonState(reg, ctxOf({ coins: 19 }), 'hale_rising_kick').affordable).toBe(false);
    expect(lessonState(reg, ctxOf({ coins: 20 }), 'hale_rising_kick').affordable).toBe(true);
  });

  it('a lesson without a cost is always affordable', () => {
    expect(lessonState(reg, ctxOf(), 'hale_devotion').affordable).toBe(true);
  });

  it('needs every cost item as well as the coins', () => {
    const id = 'hale_shoulder_charge';
    expect(lessonState(reg, ctxOf({ coins: 100, items: { herb: 2 } }), id).affordable).toBe(false);
    expect(lessonState(reg, ctxOf({ coins: 59, items: { herb: 3 } }), id).affordable).toBe(false);
    expect(lessonState(reg, ctxOf({ coins: 60, items: { herb: 3 } }), id).affordable).toBe(true);
  });

  it('gates on requirements and describes the unmet ones', () => {
    const id = 'hale_shoulder_charge';
    expect(lessonState(reg, ctxOf({ ranks: { slash: 2 } }), id)).toMatchObject({
      available: false,
      missing: ['Any skill rank 3'],
    });
    expect(lessonState(reg, ctxOf({ ranks: { slash: 3 } }), id)).toMatchObject({ available: true, missing: [] });
  });

  it('lists every unmet requirement in authored order, with progress', () => {
    expect(lessonState(reg, ctxOf({ elements: ['fire'], flags: { prayers: 1 } }), 'alba_holy').missing).toEqual([
      '3 elements attuned',
      'Base level 4',
      'Pray twice',
    ]);
    expect(lessonState(reg, ctxOf({ flags: { forge_success: 1 } }), 'brann_heavy').missing).toEqual(['Forge Success 1/3']);
    expect(lessonState(reg, ctxOf({ level: 4, elements: ['fire', 'water', 'holy'], flags: { prayers: 2 } }), 'alba_holy')).toMatchObject({
      available: true,
      missing: [],
    });
  });

  it('a skill lesson is owned once taken or once the skill is known any other way', () => {
    expect(lessonState(reg, ctxOf({ lessons: ['hale_rising_kick'] }), 'hale_rising_kick').owned).toBe(true);
    expect(lessonState(reg, ctxOf({ ranks: { rising_kick: 1 } }), 'hale_rising_kick').owned).toBe(true);
    expect(lessonState(reg, ctxOf({ ranks: { slash: 5 } }), 'hale_rising_kick').owned).toBe(false);
  });

  it('a repeatable passive lesson stays open until the passive reaches max rank', () => {
    const id = 'hale_sure_footing';
    const taken = { lessons: ['hale_rising_kick', id], coins: 999, items: { herb: 99 } };
    expect(lessonState(reg, ctxOf({ ...taken, passives: { sure_footing: 1 } }), id)).toMatchObject({
      owned: false,
      available: true,
      affordable: true,
      missing: [],
    });
    expect(lessonState(reg, ctxOf({ ...taken, passives: { sure_footing: 2 } }), id).owned).toBe(false);
    expect(lessonState(reg, ctxOf({ ...taken, passives: { sure_footing: 3 } }), id).owned).toBe(true);
  });

  it('a non-repeatable passive lesson is owned once taken or once the passive is learned', () => {
    expect(lessonState(reg, ctxOf({ lessons: ['hale_devotion'] }), 'hale_devotion').owned).toBe(true);
    expect(lessonState(reg, ctxOf({ passives: { devotion: 1 } }), 'hale_devotion').owned).toBe(true);
    expect(lessonState(reg, ctxOf(), 'hale_devotion').owned).toBe(false);
  });

  it('a repeatable essence purchase is never owned', () => {
    const p = ctxOf({ lessons: ['brann_heavy'], flags: { forge_success: 3 }, coins: 50, items: { ore: 2 } });
    expect(lessonState(reg, p, 'brann_heavy')).toMatchObject({ owned: false, available: true, affordable: true, missing: [] });
  });

  it('an element lesson is owned once the element is attuned', () => {
    expect(lessonState(reg, ctxOf({ elements: ['holy'] }), 'alba_holy').owned).toBe(true);
    expect(lessonState(reg, ctxOf({ elements: ['fire'] }), 'alba_holy').owned).toBe(false);
  });

  it('an unknown lesson can never be taken', () => {
    expect(lessonState(reg, ctxOf({ coins: 999 }), 'nope')).toMatchObject({
      owned: false,
      available: false,
      affordable: false,
      missing: ['Unknown lesson nope'],
    });
  });
});
