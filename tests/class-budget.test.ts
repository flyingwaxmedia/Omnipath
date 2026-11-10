// Class power budget (docs/SPEC-v4.md §3.5 "Flat power budget"), over the real content.
//
// Rarity never adds damage, so every class is held to the same three numbers:
//   1. worn bonus ≤ CLASS_BONUS_BUDGET (10): for any tag set a damaging skill can carry, Σ bonus.tagPower over
//      the skill's distinct tags + its stat (ATK % physical, MATK % arcane, the larger for hybrids), at Class
//      Level 10 (the bonus is smaller below);
//   2. every class passive declares `budget` ≤ KEEPSAKE_BUDGET (5); until Phase 2 turns Keepsakes into mastered
//      class passives, today's imprints are held to the same 5 each (× IMPRINT_STRENGTH), so three add ≤ 15;
//   3. worn bonus + the worn class's passive budget + the 3 best Keepsakes ≤ PASSIVE_CAPS.power (45).
// The class tree is gone, so nothing else adds class damage.
//
// Tag sets: every authored attack (power > 0, not a support kind, not monster-only) and every legal shape merge
// (pairs without an authored recipe), each also with any element it can take (+ element + 'infused')
// and any legal set of tag-adding essences (heavy) — 'basic' is dropped from variants, as compose does.
import { beforeAll, describe, expect, it } from 'vitest';
import { CLASS_BONUS_BUDGET, KEEPSAKE_BUDGET } from '../src/core/balance';
import { classBonusAt, classTier } from '../src/core/classes';
import { isHybrid, isMagic } from '../src/core/combat';
import { SUPPORT_KINDS, canTakeElement, legalEssenceSet, mergeSkills } from '../src/core/compose';
import { IMPRINT_STRENGTH, PASSIVE_CAPS } from '../src/core/passives';
import { skillRef } from '../src/core/refs';
import type { Registry } from '../src/core/registry';
import type { ClassDef, EssenceDef, SkillDef } from '../src/core/types';

/** Imprint slots at most (SPEC §5: 3 at the first Tier III or 12 classes discovered). */
const MAX_IMPRINTS = 3;

let reg: Registry;
let tagSets: string[][];

const isAttack = (s: SkillDef): boolean => !SUPPORT_KINDS.includes(s.shape.kind) && s.power > 0 && !s.tags.includes('monster');

/** Every tag set a damaging skill (authored, variant, merge or merge variant) can carry. */
function reachableTagSets(r: Registry): string[][] {
  const roots: SkillDef[] = r.authoredSkills().filter(isAttack);
  const all = r.authoredSkills();
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      if (r.recipe(skillRef(all[i].id), skillRef(all[j].id))) continue;
      const m = mergeSkills(all[i], all[j]);
      if (m && isAttack(m)) roots.push(m);
    }
  }
  const tagged = [...r.essences.values()].filter((e) => e.tag);
  const essenceSets: EssenceDef[][] = [[]];
  for (let i = 0; i < tagged.length; i++) {
    essenceSets.push([tagged[i]]);
    for (let j = i + 1; j < tagged.length; j++) essenceSets.push([tagged[i], tagged[j]]);
  }
  const sets = new Map<string, string[]>();
  for (const root of roots) {
    const elements = canTakeElement(root) ? [undefined, ...r.elements.keys()] : [undefined];
    for (const el of elements) {
      for (const ess of essenceSets) {
        if (ess.length > 0 && !legalEssenceSet(root, ess)) continue;
        const variant = el !== undefined || ess.length > 0;
        const tags = new Set(variant ? root.tags.filter((t) => t !== 'basic') : root.tags);
        if (el) tags.add(el).add('infused');
        for (const e of ess) tags.add(e.tag!);
        const sorted = [...tags].sort();
        sets.set(sorted.join(','), sorted);
      }
    }
  }
  return [...sets.values()];
}

interface Breakdown {
  /** Worn bonus: tagPower + stat. */
  bonus: number;
  bonusTags: number;
  stat: number;
  /** The worn class's own passive, as declared. */
  passive: number;
  imprints: number[];
  total: number;
}

/** Damage points one Keepsake (today: an imprint) adds to a skill with `tags`. */
function keepsakePoints(r: Registry, other: ClassDef, tags: readonly string[]): number {
  const def = other.imprint ? r.passive(other.imprint) : undefined;
  if (def?.effect.kind !== 'power') return 0;
  if (def.effect.tag !== undefined && !tags.includes(def.effect.tag)) return 0;
  return def.effect.pct * IMPRINT_STRENGTH[classTier(other)];
}

/** Worst-case class damage points for `cls` worn at Class Level 10, on a skill with `tags`. */
function classPower(r: Registry, cls: ClassDef, tags: readonly string[]): Breakdown {
  const skill = { tags: [...tags] } as SkillDef;
  const bonus = classBonusAt(cls, 10);
  let bonusTags = 0;
  for (const [tag, pct] of Object.entries(bonus.tagPower ?? {})) if (tags.includes(tag)) bonusTags += pct;
  const atk = bonus.atk ?? 0;
  const matk = bonus.matk ?? 0;
  const stat = isHybrid(skill) ? Math.max(atk, matk) : isMagic(skill) ? matk : atk;
  const passive = cls.passive ? (r.passive(cls.passive)?.budget ?? 0) : 0;
  const imprints = r.classes
    .filter((other) => other.id !== cls.id)
    .map((other) => keepsakePoints(r, other, tags))
    .filter((n) => n > 0)
    .sort((a, b) => b - a)
    .slice(0, MAX_IMPRINTS);
  const total = bonusTags + stat + passive + imprints.reduce((a, b) => a + b, 0);
  return { bonus: bonusTags + stat, bonusTags, stat, passive, imprints, total };
}

describe('class power budget (SPEC-v4 §3.5)', () => {
  beforeAll(async () => {
    const { createRegistry } = await import('../src/data');
    reg = createRegistry();
    tagSets = reachableTagSets(reg);
  }, 120_000);

  it('the numbers are 10 for a worn bonus, 5 per Keepsake, 45 in all', () => {
    expect(CLASS_BONUS_BUDGET).toBe(10);
    expect(KEEPSAKE_BUDGET).toBe(5);
    expect(PASSIVE_CAPS.power).toBe(45);
    expect(CLASS_BONUS_BUDGET + KEEPSAKE_BUDGET + MAX_IMPRINTS * KEEPSAKE_BUDGET).toBeLessThanOrEqual(PASSIVE_CAPS.power);
  });

  it('enumerates real content', () => {
    expect(reg.classes.length).toBeGreaterThanOrEqual(26);
    expect(tagSets.length).toBeGreaterThan(100);
  });

  it('no worn class bonus adds more than 10 damage points to any single skill', () => {
    const over: string[] = [];
    for (const cls of reg.classes) {
      let worst: (Breakdown & { tags: string[] }) | undefined;
      for (const tags of tagSets) {
        const b = classPower(reg, cls, tags);
        if (!worst || b.bonus > worst.bonus) worst = { ...b, tags };
      }
      if (worst!.bonus > CLASS_BONUS_BUDGET + 1e-9) {
        over.push(`${cls.id}: ${worst!.bonus.toFixed(1)} on [${worst!.tags.join(', ')}] (tagPower ${worst!.bonusTags}, stat ${worst!.stat})`);
      }
    }
    expect(over, over.join('\n')).toEqual([]);
  });

  it('every class passive declares a budget of at most 5, and every Keepsake stays within 5', () => {
    const bad: string[] = [];
    for (const cls of reg.classes) {
      if (cls.passive !== undefined) {
        const def = reg.passive(cls.passive);
        if (!def) bad.push(`${cls.id}: unknown passive ${cls.passive}`);
        else if (def.budget === undefined) bad.push(`${cls.id}: passive ${def.id} declares no budget`);
        else if (!(def.budget >= 0 && def.budget <= KEEPSAKE_BUDGET)) bad.push(`${cls.id}: passive ${def.id} budget ${def.budget}`);
      }
      const def = cls.imprint ? reg.passive(cls.imprint) : undefined;
      if (def?.effect.kind === 'power') {
        const points = def.effect.pct * IMPRINT_STRENGTH[classTier(cls)];
        if (points > KEEPSAKE_BUDGET + 1e-9) bad.push(`${cls.id}: Keepsake ${def.id} adds ${points}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('bonus + own passive + the 3 best Keepsakes never pass 45 on any single skill', () => {
    const over: string[] = [];
    for (const cls of reg.classes) {
      for (const tags of tagSets) {
        const b = classPower(reg, cls, tags);
        if (b.total > PASSIVE_CAPS.power + 1e-9) over.push(`${cls.id}: ${b.total.toFixed(1)} on [${tags.join(', ')}]`);
      }
    }
    expect(over.slice(0, 10), over.slice(0, 10).join('\n')).toEqual([]);
  });

  it('the worst case counts every component (a known skill, by hand)', () => {
    // Blademaster (atk 7) worn on a plain blade skill, with three blade/melee Keepsakes slotted.
    const cls = reg.classes.find((c) => (c.bonus.atk ?? 0) > 0 && !c.bonus.tagPower)!;
    const b = classPower(reg, cls, ['blade', 'melee', 'sword']);
    expect(b.stat).toBe(cls.bonus.atk);
    expect(b.bonusTags).toBe(0);
    expect(b.imprints.length).toBeLessThanOrEqual(MAX_IMPRINTS);
    expect(b.total).toBeCloseTo(b.stat + b.passive + b.imprints.reduce((x, y) => x + y, 0), 10);
  });
});
