import { beforeEach, describe, expect, it } from 'vitest';
import { computeDamage, elementMultiplier } from '../src/core/combat';
import { MASTERY, xpToNext } from '../src/core/mastery';
import { SkillBook } from '../src/core/skillbook';
import type { Registry } from '../src/core/registry';
import { createRegistry } from '../src/data';

let reg: Registry;
let book: SkillBook;

/** Trains a skill until it reaches the given rank. */
function trainTo(b: SkillBook, id: string, rank: number) {
  let guard = 0;
  while (b.rank(id) < rank) {
    b.recordUse(id);
    b.recordHit(id, false);
    if (++guard > 10_000) throw new Error('training never converged');
  }
}

beforeEach(() => {
  reg = createRegistry();
  book = new SkillBook(reg);
  MASTERY.rate = 1;
});

describe('content data', () => {
  it('passes integrity validation', () => {
    expect(reg.validate()).toEqual([]);
  });

  it('every non-basic authored skill is reachable from a morph, recipe, class, tome, or NPC', () => {
    const reachable = new Set<string>(['slash', 'stab', 'bolt', 'meditation', 'quickstep', 'static_field']);
    for (const m of reg.morphs) reachable.add(m.to);
    for (const r of reg.recipeList) if (r.result.startsWith('skill:')) reachable.add(r.result.slice(6));
    for (const c of reg.classes) for (const g of c.grants ?? []) reachable.add(g);
    const orphans = reg.authoredSkills().filter((s) => !reachable.has(s.id)).map((s) => s.id);
    expect(orphans).toEqual([]);
  });
});

describe('mastery', () => {
  it('ranks up with use and grants a morph charge at max rank', () => {
    book.learn('slash', 'start');
    expect(book.rank('slash')).toBe(1);
    book.addMastery('slash', xpToNext(1));
    expect(book.rank('slash')).toBe(2);
    trainTo(book, 'slash', 10);
    expect(book.isMaxed('slash')).toBe(true);
    expect(book.progress('slash')!.charges).toBe(1);
  });

  it('overmastery keeps granting charges after max rank', () => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 10);
    book.addMastery('slash', book.barSize('slash'));
    expect(book.progress('slash')!.charges).toBe(2);
  });

  it('caps banked morph charges', () => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 10);
    let events = 0;
    book.events.on('charge', () => events++);
    book.addMastery('slash', book.barSize('slash') * 20);
    expect(book.progress('slash')!.charges).toBe(MASTERY.maxCharges);
    expect(events).toBe(1);
  });

  it('caps hit XP per use', () => {
    book.learn('slash', 'start');
    const total = () => {
      const p = book.progress('slash')!;
      let sum = p.xp;
      for (let r = 1; r < p.rank; r++) sum += xpToNext(r);
      return sum;
    };
    for (let i = 0; i < 10; i++) book.recordHit('slash', false, i);
    expect(total()).toBe(MASTERY.maxHitsPerUse * MASTERY.hitXp);
  });
});

describe('morphing', () => {
  it('morphs a mastered Slash into Whirlwind and keeps Slash', () => {
    book.learn('slash', 'start');
    expect(book.morph('slash', 'whirlwind').ok).toBe(false);
    trainTo(book, 'slash', 10);
    const res = book.morph('slash', 'whirlwind');
    expect(res.ok).toBe(true);
    expect(book.has('slash')).toBe(true);
    expect(book.has('whirlwind')).toBe(true);
    expect(book.progress('slash')!.charges).toBe(0);
    // No charge left for the second branch.
    expect(book.morph('slash', 'sword_throw').ok).toBe(false);
  });

  it('hides locked morphs until requirements are met', () => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 10);
    const cleave = book.morphOptions('slash').find((o) => o.morph.to === 'heavy_cleave')!;
    expect(cleave.available).toBe(false);
    expect(cleave.skill).toBeNull();
    expect(cleave.hint).toMatch(/stone/);
    book.incFlag('ore_mined', 6);
    const unlocked = book.morphOptions('slash').find((o) => o.morph.to === 'heavy_cleave')!;
    expect(unlocked.available).toBe(true);
    expect(unlocked.skill?.name).toBe('Heavy Cleave');
  });
});

describe('fusion', () => {
  beforeEach(() => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 10);
    book.morph('slash', 'whirlwind');
  });

  it('requires the skill to be trained before fusing', () => {
    book.learnElement('fire', 'blacksmith');
    const res = book.fuse('el:fire', 'skill:whirlwind');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('rank');
  });

  it('requires owning the element', () => {
    trainTo(book, 'whirlwind', 5);
    const res = book.fuse('el:fire', 'skill:whirlwind');
    expect(res.ok).toBe(false);
  });

  it('fuses Fire + Whirlwind into Flame Spin (order independent)', () => {
    book.learnElement('fire', 'blacksmith');
    trainTo(book, 'whirlwind', 5);
    const res = book.fuse('skill:whirlwind', 'el:fire');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe('skill:flame_spin');
      expect(res.isNew).toBe(true);
      expect(res.procedural).toBe(false);
    }
    expect(book.has('whirlwind')).toBe(true);
    expect(book.reg.skill('flame_spin')!.tags).toContain('fire');
    expect(book.rememberedPair('el:fire', 'skill:whirlwind')).toBe('discovered');
  });

  it('procedurally infuses unaligned skills with no authored recipe', () => {
    book.learnElement('fire', 'blacksmith');
    trainTo(book, 'slash', 10);
    const res = book.fuse('el:fire', 'skill:slash');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.result).toBe('skill:slash@fire');
      expect(res.name).toBe('Blazing Slash');
      expect(res.procedural).toBe(true);
    }
    const s = reg.skill('slash@fire')!;
    expect(s.element).toBe('fire');
    expect(s.tags).not.toContain('basic');
    expect(s.weapons).toEqual(['sword']);
  });

  it('fuses two elements into a new element', () => {
    book.learnElement('water', 'fishing');
    book.learnElement('wind', 'shrine');
    const res = book.fuse('el:water', 'el:wind');
    expect(res.ok).toBe(true);
    expect(book.hasElement('ice')).toBe(true);
  });

  it('remembers failed experiments and offers a hint', () => {
    book.learnElement('water', 'fishing');
    book.learnElement('fire', 'forge');
    const res = book.fuse('el:water', 'el:fire');
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.reason).toBe('nothing');
      expect(res.hint).toBeTruthy();
    }
    expect(book.rememberedPair('el:fire', 'el:water')).toBe('nothing');
  });

  it('rejects infusing an already-elemental skill', () => {
    book.learnElement('fire', 'forge');
    book.learnElement('water', 'fishing');
    trainTo(book, 'whirlwind', 5);
    book.fuse('el:fire', 'skill:whirlwind');
    trainTo(book, 'flame_spin', 5);
    const res = book.fuse('el:water', 'skill:flame_spin');
    expect(res.ok).toBe(false);
  });
});

describe('class discovery', () => {
  it('discovers Pyroblade from two fire blade skills and grants its signature', () => {
    book.learn('slash', 'start');
    trainTo(book, 'slash', 10);
    book.morph('slash', 'whirlwind');
    book.learnElement('fire', 'forge');
    trainTo(book, 'whirlwind', 5);
    book.fuse('el:fire', 'skill:whirlwind');
    expect(book.state.classes).not.toContain('pyroblade');
    book.fuse('el:fire', 'skill:slash');
    expect(book.state.classes).toContain('pyroblade');
    expect(book.has('searing_edge')).toBe(true);
    // Four blade skills also reveal Blademaster; the first discovery becomes active.
    expect(book.state.classes).toContain('blademaster');
    expect(book.state.activeClass).toBe('blademaster');
    expect(book.setActiveClass('pyroblade')).toBe(true);
    expect(book.tagPowerFor(reg.skill('flame_spin')!)).toBe(15);
  });

  it('discovers Elementalist from three distinct elements', () => {
    book.learn('bolt', 'start');
    trainTo(book, 'bolt', 5);
    for (const el of ['fire', 'water', 'wind'] as const) {
      book.learnElement(el, 'test');
      book.fuse(`el:${el}`, 'skill:bolt');
    }
    expect(book.state.classes).toContain('elementalist');
    expect(book.has('prism_burst')).toBe(true);
  });

  it('reports partial progress', () => {
    book.learn('slash', 'start');
    const bm = book.classProgress(reg.classDef('blademaster')!);
    expect(bm.progress).toBeCloseTo(0.25);
    expect(bm.discovered).toBe(false);
  });
});

describe('persistence', () => {
  it('round-trips through serialize()', () => {
    book.learn('stab', 'start');
    trainTo(book, 'stab', 4);
    book.learnElement('shadow', 'obelisk');
    book.incFlag('kills', 3);
    const copy = new SkillBook(reg, JSON.parse(JSON.stringify(book.serialize())));
    expect(copy.rank('stab')).toBe(4);
    expect(copy.hasElement('shadow')).toBe(true);
    expect(copy.flag('kills')).toBe(3);
  });

  it('restores generated skills by id', () => {
    const copy = new SkillBook(reg);
    copy.learn('sword_throw@lightning', 'test');
    expect(copy.known()[0].name).toBe('Thunder Sword Throw');
  });
});

describe('combat', () => {
  it('applies the elemental chart', () => {
    expect(elementMultiplier(reg.elements, 'water', 'fire')).toBe(1.5);
    expect(elementMultiplier(reg.elements, 'fire', 'water')).toBe(0.6);
    expect(elementMultiplier(reg.elements, 'fire', 'fire')).toBe(0.5);
    expect(elementMultiplier(reg.elements, undefined, 'fire')).toBe(1);
  });

  it('scales damage with rank', () => {
    const skill = reg.skill('slash')!;
    const rng = () => 0.5;
    const low = computeDamage(reg.elements, skill, 1, { atk: 50, matk: 0, crit: 0 }, { def: 0 }, { rng });
    const high = computeDamage(reg.elements, skill, 10, { atk: 50, matk: 0, crit: 0 }, { def: 0 }, { rng });
    expect(high.amount).toBeGreaterThan(low.amount);
  });
});
