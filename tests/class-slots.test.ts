import { describe, expect, it } from 'vitest';
import { CLASS_SLOTS, barEligible, classSkillFit, classSkills, classTreeTags } from '../src/core/classes';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import { CLASSES } from '../src/data/classes';
import { classSkillWord, classSlotsLine } from '../src/ui/announce';

const reg = createRegistry();

function bookWith(ids: string[], ranks: Record<string, number> = {}): SkillBook {
  const b = new SkillBook(reg);
  for (const id of ids) {
    b.learn(id, 'test');
    const p = b.progress(id)!;
    p.rank = ranks[id] ?? 1;
  }
  return b;
}

describe('class slots: classSkills', () => {
  it('fills up to 5 slots with skills that fit the class (pattern matches, then related skills)', () => {
    const b = bookWith(['slash', 'whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin', 'tornado', 'focus']);
    const pick = b.classSkills('blademaster');
    expect(pick.length).toBeLessThanOrEqual(CLASS_SLOTS);
    for (const id of pick) expect(reg.skill(id)!.tags).toContain('blade');
    expect(pick).not.toContain('slash'); // basic attacks never take bar slots
    expect(pick).not.toContain('focus');
  });

  it('satisfies each clause count before filling (assassin: execute + stealth)', () => {
    const b = bookWith(['backstab', 'shadowstep', 'assassinate', 'fan_of_knives', 'smoke_veil', 'venom_edge'], {
      fan_of_knives: 10,
      venom_edge: 9,
    });
    const cls = reg.classDef('assassin')!;
    const pick = classSkills(reg, b.state, cls);
    expect(pick).toContain('assassinate');
    const stealth = pick.filter((id) => reg.skill(id)!.tags.includes('stealth')).length;
    expect(stealth).toBeGreaterThanOrEqual(2);
  });

  it('prefers higher tier and rank, and is deterministic', () => {
    const b = bookWith(['whirlwind', 'sword_throw', 'heavy_cleave', 'spinning_assault', 'boomerang_blade', 'guillotine'], {
      whirlwind: 10,
    });
    const a = b.classSkills('blademaster');
    expect(a.slice(0, 3).every((id) => reg.skill(id)!.tier === 2)).toBe(true);
    expect(b.classSkills('blademaster')).toEqual(a);
  });

  it('takes one skill per base before doubling up on variants', () => {
    const b = bookWith(['whirlwind', 'whirlwind@fire', 'sword_throw', 'heavy_cleave']);
    // Knowing 4 blade skills also unlocks Blademaster, whose signature (Blade Aura) is a blade skill too.
    const pick = b.classSkills('blademaster');
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave']) expect(pick).toContain(id);
    expect(b.classSkills('blademaster', 4).filter((id) => id.startsWith('whirlwind')).length).toBe(1);
  });

  it('elemental classes spread across elements first', () => {
    const b = bookWith(['firebolt', 'meteor', 'aqua_lance', 'wind_cutter', 'inferno_ring']);
    const pick = b.classSkills('elementalist', 3);
    const els = new Set(pick.map((id) => reg.skill(id)!.element));
    expect(els.size).toBe(3);
  });

  it('barEligible excludes basics and monster-only attacks', () => {
    expect(barEligible(reg.skill('slash')!)).toBe(false);
    expect(barEligible(reg.skill('mon_zap')!)).toBe(false);
    expect(barEligible(reg.skill('whirlwind')!)).toBe(true);
  });
});

const cls = (id: string) => reg.classDef(id)!;
const SWORD = [
  'whirlwind', 'sword_throw', 'heavy_cleave', 'spinning_assault', 'crescent_sweep', 'boomerang_blade', 'blade_volley',
  'guillotine', 'sundering_blow', 'tempest_waltz', 'hundredfold_edge', 'worldbreaker', 'cyclone_blades', 'cleaver_toss',
];

describe('class slots: related skills (owner: "auto equip RELATED skills")', () => {
  it('reads the tree tags from the class tree (main tag first)', () => {
    expect(classTreeTags(reg, cls('pyroblade'))).toEqual(['fire', 'blade']);
    expect(classTreeTags(reg, cls('arcanist'))).toEqual(['arcane', 'aoe']);
    expect(classTreeTags(reg, cls('tidecaller'))).toEqual(['water']);
  });

  it('classSkillFit: pattern match, related (shared tag or named element), or nothing', () => {
    const fit = (c: string, id: string) => classSkillFit(reg, cls(c), reg.skill(id)!);
    expect(fit('pyroblade', 'flame_spin')).toBe('match'); // blade + fire
    expect(fit('pyroblade', 'whirlwind')).toBe('related'); // blade
    expect(fit('pyroblade', 'firebolt')).toBe('related'); // fire
    expect(fit('pyroblade', 'focus')).toBeNull();
    expect(fit('arcanist', 'whirlwind')).toBe('related'); // area: the Arcanist tree's second tag
    expect(fit('arcanist', 'sword_throw')).toBeNull();
    expect(fit('earthshaper', 'crack_armor')).toBe('related'); // heavy
    expect(fit('magma_knight', 'magma_spit')).toBe('related'); // magma: named by its requirement and bonus
    expect(fit('tidecaller', 'whirlwind')).toBeNull();
  });

  it('a Pyroblade who knows only sword skills fills all 5 class slots with them, best first', () => {
    const b = bookWith(SWORD);
    const pick = classSkills(reg, b.state, cls('pyroblade'));
    expect(pick.length).toBe(CLASS_SLOTS);
    for (const id of pick) expect(reg.skill(id)!.tags).toContain('blade');
    // Tier III first (the related skills keep the usual "best" order).
    expect(pick.slice(0, 3).every((id) => reg.skill(id)!.tier === 3)).toBe(true);
    expect(classSkills(reg, b.state, cls('pyroblade'))).toEqual(pick); // deterministic
  });

  it('pattern matches come before related skills, whatever their tier', () => {
    const b = bookWith([...SWORD, 'flame_spin', 'firebolt']);
    const pick = classSkills(reg, b.state, cls('pyroblade'), 8);
    expect(pick[0]).toBe('flame_spin'); // tier 2, but the only blade + fire skill
    expect(pick.slice(1, 4).every((id) => reg.skill(id)!.tier === 3)).toBe(true);
    expect(pick).not.toContain('firebolt'); // tier 1: plenty of better related skills
  });

  it('an Arcanist with only the staff basic attack has nothing to equip (slots stay empty)', () => {
    const b = bookWith(['bolt']);
    expect(classSkills(reg, b.state, cls('arcanist'))).toEqual([]);
  });

  it('an Arcanist with the staff starters equips all of them (plus its Mana Surge) and leaves the rest empty', () => {
    // The basic Bolt counts toward unlocking Arcanist (4 arcane skills) but never takes a slot.
    const b = bookWith(['bolt', 'arcane_orb', 'arcane_nova', 'focus']);
    expect(b.state.classes.arcanist).toBeDefined();
    const pick = classSkills(reg, b.state, cls('arcanist'));
    expect([...pick].sort()).toEqual(['arcane_nova', 'arcane_orb', 'focus', 'mana_surge']);
    expect(pick[0]).toBe('mana_surge'); // tier 2 signature first
  });

  it('an Arcanist who knows only sword skills takes the area ones (its tree) and nothing unrelated', () => {
    const b = bookWith(SWORD);
    const pick = classSkills(reg, b.state, cls('arcanist'));
    expect(pick.length).toBe(CLASS_SLOTS);
    for (const id of pick) expect(reg.skill(id)!.tags).toContain('aoe');
  });

  it('a class with nothing related known leaves its slots empty', () => {
    const b = bookWith(SWORD);
    expect(classSkills(reg, b.state, cls('tidecaller'))).toEqual([]);
  });

  it('one skill per base first, across pattern matches and related skills', () => {
    const b = bookWith(['whirlwind', 'whirlwind@fire', 'sword_throw', 'heavy_cleave']);
    // whirlwind@fire is a blade + fire match; plain Whirlwind shares its base, so the other blades come first
    // (4 blade skills also unlock Blademaster, whose Blade Aura is a related blade skill too).
    const four = classSkills(reg, b.state, cls('pyroblade'), 4);
    expect(four[0]).toBe('whirlwind@fire');
    expect([...four].sort()).toEqual(['blade_aura', 'heavy_cleave', 'sword_throw', 'whirlwind@fire']);
    expect(classSkills(reg, b.state, cls('pyroblade'), 5).at(-1)).toBe('whirlwind'); // only when nothing else fits
  });
});

describe('class slots: the "You are now a …" line', () => {
  it('counts the filled class slots, or names the one next step when none were filled', () => {
    // Every class slot filled: no digit (the pixel font's 5 reads like an S).
    expect(classSlotsLine(reg, cls('pyroblade'), 5)).toBe('All class slots filled');
    expect(classSlotsLine(reg, cls('pyroblade'), 3)).toBe('3 class skills equipped');
    expect(classSlotsLine(reg, cls('pyroblade'), 1)).toBe('1 class skill equipped');
    expect(classSlotsLine(reg, cls('pyroblade'), 3, 3)).toBe('All class slots filled'); // a shorter bar
    expect(classSlotsLine(reg, cls('pyroblade'), 0)).toBe('Learn fire skills to fill your class slots');
    expect(classSlotsLine(reg, cls('tidecaller'), 0)).toBe('Learn water skills to fill your class slots');
    expect(classSlotsLine(reg, cls('elementalist'), 0)).toBe('Learn elemental skills to fill your class slots');
    for (const c of CLASSES) {
      const line = classSlotsLine(reg, c, 0);
      expect(line.length).toBeLessThanOrEqual(60);
      expect(classSkillWord(reg, c)).toMatch(/^[a-z]+$/); // a plain word, never an id
      expect(line).not.toMatch(/equipped/);
    }
  });
});
