import { describe, expect, it } from 'vitest';
import { CLASS_SLOTS, barEligible, classSkills } from '../src/core/classes';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';

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
  it('fills up to 5 slots with skills that match the class', () => {
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
