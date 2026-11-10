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
    // v4: knowing blade skills no longer makes a Blademaster (60 sword hits do), so no kit skill is known here
    // and every slot is a fill.
    expect(b.state.classes.blademaster).toBeUndefined();
    const pick = b.classSkills('blademaster');
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave']) expect(pick).toContain(id);
    const three = b.classSkills('blademaster', 3);
    expect(three.filter((id) => id.startsWith('whirlwind')).length).toBe(1);
    expect(new Set(three.map((id) => reg.baseOf(id) ?? id)).size).toBe(3);
    // The variant only takes a slot once every base has one.
    expect(b.classSkills('blademaster', 4).filter((id) => id.startsWith('whirlwind')).length).toBe(2);
  });

  it('a kit skill keeps its own slot; unknown kit slots take fills usable with the class weapon (§3.4)', () => {
    // Prismcaller's kit: prism_burst, prism_sage_sig, glacial_orb, inferno_ring, tidal_ripple.
    const b = bookWith(['firebolt', 'meteor', 'aqua_lance', 'wind_cutter', 'inferno_ring', 'whirlwind']);
    const pick = b.classSkills('elementalist');
    expect(pick.length).toBe(CLASS_SLOTS);
    expect(pick[3]).toBe('inferno_ring'); // kit slot 4, whatever the fills' tiers
    expect(pick).not.toContain('whirlwind'); // needs a sword: a rod class never equips it
    expect([...pick].sort()).toEqual(['aqua_lance', 'firebolt', 'inferno_ring', 'meteor', 'wind_cutter']);
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
    // v4: the class weapon's grip tag joins the theme (once).
    expect(classTreeTags(reg, cls('arcanist'))).toEqual(['arcane', 'aoe', 'rod']);
    expect(classTreeTags(reg, cls('tidecaller'))).toEqual(['water', 'rod']);
    expect(classTreeTags(reg, cls('wayfarer'))).toEqual(['dash', 'buff', 'fist']);
  });

  it('classSkillFit: a kit skill is a match, anything else the class weapon can cast is related, the rest is nothing', () => {
    const fit = (c: string, id: string) => classSkillFit(reg, cls(c), reg.skill(id)!);
    for (const id of cls('pyroblade').kit!) expect(fit('pyroblade', id), id).toBe('match');
    expect(fit('magma_knight', 'flame_spin')).toBe('match'); // a legacy kit skill
    expect(fit('magma_knight', 'guillotine@fire')).toBe('match'); // and a variant of one
    expect(fit('pyroblade', 'flame_spin')).toBe('related'); // sword skill, not in the kit
    expect(fit('pyroblade', 'whirlwind')).toBe('related');
    expect(fit('pyroblade', 'firebolt')).toBe('related'); // free of a weapon: any class may hold it
    expect(fit('pyroblade', 'focus')).toBe('related');
    expect(fit('pyroblade', 'slash')).toBeNull(); // basic attacks never sit on the bar
    expect(fit('pyroblade', 'backstab')).toBeNull(); // needs a dagger
    expect(fit('pyroblade', 'last_word')).toBeNull(); // Blademaster's own skill
    expect(fit('arcanist', 'whirlwind')).toBeNull(); // needs a sword
    expect(fit('tidecaller', 'whirlwind')).toBeNull();
    expect(fit('mimic', 'whirlwind')).toBe('related'); // any weapon
    expect(fit('mimic', 'last_word')).toBeNull();
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
    // v4: sixty rod hits make a Spellwright; Class Level 1 teaches kit skills 1 and 2. The basic Bolt never takes a slot.
    const b = bookWith(['bolt', 'arcane_orb', 'arcane_nova', 'focus']);
    expect(b.state.classes.arcanist).toBeUndefined();
    b.incFlag('hits:staff', 60);
    expect(b.state.classes.arcanist).toBeDefined();
    const pick = classSkills(reg, b.state, cls('arcanist'));
    expect([...pick].sort()).toEqual(['arcane_nova', 'arcane_orb', 'focus', 'mana_surge', 'thread_bolt']);
    expect(pick.slice(0, 2)).toEqual(['mana_surge', 'thread_bolt']); // the kit, in kit order
    for (const id of pick.slice(2)) expect(classSkillFit(reg, cls('arcanist'), reg.skill(id)!)).toBe('related');
  });

  it('a Spellwright who knows only sword skills equips none of them: a rod cannot cast them', () => {
    const b = bookWith(SWORD);
    expect(classSkills(reg, b.state, cls('arcanist'))).toEqual([]);
  });

  it('a class with nothing related known leaves its slots empty', () => {
    const b = bookWith(SWORD);
    expect(classSkills(reg, b.state, cls('tidecaller'))).toEqual([]);
  });

  it('one skill per base first, across kit skills and fills', () => {
    const b = bookWith(['guillotine', 'guillotine@fire', 'whirlwind', 'whirlwind@fire', 'sword_throw', 'heavy_cleave']);
    // Magma Knight's kit holds guillotine in slot 5; the other slots are fills, one per base first.
    const four = classSkills(reg, b.state, cls('magma_knight'), 4);
    expect(four.at(-1)).toBe('guillotine'); // the kit skill itself, never its variant; seated even on a short bar
    expect(four.filter((id) => id.startsWith('whirlwind')).length).toBe(1);
    expect(four).toContain('sword_throw');
    expect(four).toContain('heavy_cleave');
    const five = classSkills(reg, b.state, cls('magma_knight'), 5);
    expect(five[4]).toBe('guillotine');
    expect(new Set(five.map((id) => reg.baseOf(id) ?? id)).size).toBe(4); // one double, only once nothing else fits
    expect(new Set(five).size).toBe(5);
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
