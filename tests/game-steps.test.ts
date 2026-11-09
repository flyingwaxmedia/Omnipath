// Plain-language next steps (src/game/steps.ts; docs/UX-SIMPLE.md rule 4): one short sentence, never internals.
import { describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import { classGoal, elementStep, firstStep, learnStep, reqStep, tagWords, transformStep } from '../src/game/steps';

const reg = createRegistry();
const INTERNAL = /tagged|\bCR\b|tier|_|undefined|NaN|\bmorph\b/i;

function book(skills: Record<string, number> = {}): SkillBook {
  const b = new SkillBook(reg);
  for (const [id, rank] of Object.entries(skills)) {
    b.learn(id, 'test');
    b.state.skills[id].rank = rank;
  }
  return b;
}

describe('steps', () => {
  it('requirements read as one plain imperative', () => {
    const b = book({ whirlwind: 2 });
    expect(reqStep(reg, b, { type: 'skill', id: 'whirlwind', rank: 5 })).toBe('Reach Whirlwind rank 5');
    expect(reqStep(reg, b, { type: 'skill', id: 'whirlwind', rank: 5 }, 'whirlwind')).toBe('Reach rank 5');
    expect(reqStep(reg, b, { type: 'skill', id: 'sword_throw', rank: 5 })).toBe('Learn Sword Throw');
    expect(reqStep(reg, b, { type: 'element', id: 'wind' })).toBe('Find the Wind element');
    expect(reqStep(reg, b, { type: 'tagCount', tags: ['blade', 'fire'], count: 2 })).toBe('Learn 2 more fire blade skills');
    expect(reqStep(reg, b, { type: 'tagCount', tags: [], count: 1, minRank: 3 })).toBe('Get any skill to rank 3');
    expect(reqStep(reg, b, { type: 'flag', id: 'ore_mined', min: 6, label: 'Mine 6 ore' })).toBe('Mine 6 ore');
    expect(reqStep(reg, b, { type: 'class', id: 'spellblade', rank: 6 })).toBe('Unlock the Spellblade class');
    expect(reqStep(reg, b, { type: 'level', min: 8 })).toBe('Reach level 8');
    expect(reqStep(reg, b, { type: 'mapVisited', id: 'vale.moonlit_glade' })).toBe('Visit Moonlit Glade');
    expect(reqStep(reg, b, { type: 'witness', skill: 'boulder_roll', count: 3 })).toBe('Watch a monster use Boulder Roll (Seen 0/3)');
    expect(firstStep(reg, b, [{ type: 'level', min: 1 }, { type: 'element', id: 'fire' }])).toBe('Find the Fire element.');
    expect(firstStep(reg, b, [])).toBe('');
    expect(tagWords(['pierce', 'projectile'])).toBe('piercing projectile');
  });

  it('a known skill names its one step toward the next transform', () => {
    const b = book({ whirlwind: 2 });
    const max = reg.skill('whirlwind')!.maxRank;
    expect(transformStep(reg, b, 'whirlwind')).toBe(`Reach rank ${max} to transform.`);
    b.state.skills.whirlwind.rank = max;
    b.state.skills.whirlwind.charges = 1;
    const step = transformStep(reg, b, 'whirlwind');
    expect(step).toMatch(/ to transform\.$/);
    expect(step).not.toMatch(INTERNAL);
  });

  it('an unknown skill names the one way to learn it', () => {
    const b = book();
    expect(learnStep(reg, b, 'rising_kick')).toBe('A quest from Drillmaster Hale teaches it.');
    expect(learnStep(reg, b, 'spinning_assault')).toBe('Transform Whirlwind to learn it.');
    expect(learnStep(reg, b, 'slash')).toBe('Comes with the Iron Sword.');
    expect(learnStep(reg, b, 'boulder_roll')).toBe('Let a Boulderback use it on you, then defeat it (Seen 0/3).');
    const w = book({ whirlwind: 1 });
    expect(learnStep(reg, w, 'spinning_assault')).toBe(`Reach Whirlwind rank ${reg.skill('whirlwind')!.maxRank}, then transform it.`);
    for (const sk of reg.authoredSkills()) expect(learnStep(reg, b, sk.id), sk.id).not.toMatch(INTERNAL);
  });

  it('elements and locked classes get one plain line', () => {
    expect(elementStep(reg, 'fire')).toMatch(/Brann/);
    expect(elementStep(reg, 'magma')).toBe('Fuse two elements at an altar.');
    const b = book({ whirlwind: 1, sword_throw: 1 });
    for (const cls of reg.classes) {
      const line = classGoal(reg, b, cls.id);
      expect(line.length, cls.id).toBeGreaterThan(0);
      expect(line, cls.id).not.toMatch(/tagged|\bCR\b|tier|undefined/i);
    }
  });
});
