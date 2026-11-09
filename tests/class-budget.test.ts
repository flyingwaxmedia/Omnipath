// Class power budget (docs/SPEC-v2.md §5), over the real content.
//
// For every class worn, and every tag set a damaging skill can carry, the worst-case extra damage in
// percentage points is:
//   worn bonus  = Σ bonus.tagPower over the skill's distinct tags
//               + its stat: ATK % (physical), MATK % (arcane) or max of both (hybrids, combat.isHybrid) —
//                 the class bonus plus the tree's atk/matk stat node at max rank
//   + tree      = every power node of the worn tree whose tag the skill has (or untagged), at max rank
//   + capstone  (an untagged power node, counted by the line above)
//   + imprints  = the 3 best imprints of OTHER classes that apply to the skill, × IMPRINT_STRENGTH
// and must stay ≤ CLASS_POWER_BUDGET (25).
//
// Tag sets: every authored attack (non-buff, power > 0, not monster-only) and every legal shape merge
// (pairs without an authored recipe), each also with any element it can take (+ element + 'infused')
// and any legal set of tag-adding essences (heavy) — 'basic' is dropped from variants, as compose does.
import { beforeAll, describe, expect, it } from 'vitest';
import { CLASS_POWER_BUDGET, CLASS_TREE_POWER } from '../src/core/balance';
import { isHybrid, isMagic } from '../src/core/combat';
import { canTakeElement, legalEssenceSet, mergeSkills } from '../src/core/compose';
import { IMPRINT_STRENGTH } from '../src/core/passives';
import { skillRef } from '../src/core/refs';
import type { Registry } from '../src/core/registry';
import type { ClassDef, ClassTier, EssenceDef, SkillDef } from '../src/core/types';

/** Imprint slots at most (SPEC §5: 3 at the first Tier III or 12 classes discovered). */
const MAX_IMPRINTS = 3;

let reg: Registry;
let tagSets: string[][];

const isAttack = (s: SkillDef): boolean => s.shape.kind !== 'buff' && s.power > 0 && !s.tags.includes('monster');

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
  total: number;
  bonusTags: number;
  stat: number;
  tree: number;
  imprints: number[];
}

/** Worst-case class damage points for `cls` worn, on a skill with `tags`. */
function classPower(r: Registry, cls: ClassDef, tags: readonly string[]): Breakdown {
  const has = (tag: string | undefined): boolean => tag === undefined || tags.includes(tag);
  const skill = { tags: [...tags] } as SkillDef;

  let bonusTags = 0;
  for (const [tag, pct] of Object.entries(cls.bonus.tagPower ?? {})) if (tags.includes(tag)) bonusTags += pct;

  let atk = cls.bonus.atk ?? 0;
  let matk = cls.bonus.matk ?? 0;
  let tree = 0;
  for (const node of cls.tree ?? []) {
    if (node.kind === 'skill') continue;
    const def = r.passive(node.ref);
    if (!def) continue;
    const ranks = Math.min(node.maxRank, def.maxRank);
    const e = def.effect;
    if (e.kind === 'power' && has(e.tag)) tree += e.pct * ranks;
    if (e.kind === 'stat' && e.stat === 'atk') atk += e.pct * ranks;
    if (e.kind === 'stat' && e.stat === 'matk') matk += e.pct * ranks;
  }
  const stat = isHybrid(skill) ? Math.max(atk, matk) : isMagic(skill) ? matk : atk;

  const candidates: number[] = [];
  for (const other of r.classes) {
    if (other.id === cls.id || !other.imprint) continue;
    const def = r.passive(other.imprint);
    if (def?.effect.kind === 'power' && has(def.effect.tag)) candidates.push(def.effect.pct * IMPRINT_STRENGTH[other.tier]);
  }
  const imprints = candidates.sort((a, b) => b - a).slice(0, MAX_IMPRINTS);

  const total = bonusTags + stat + tree + imprints.reduce((a, b) => a + b, 0);
  return { total, bonusTags, stat, tree, imprints };
}

describe('class power budget (SPEC §5)', () => {
  beforeAll(async () => {
    const { createRegistry } = await import('../src/data');
    reg = createRegistry();
    tagSets = reachableTagSets(reg);
  }, 120_000);

  it('the budget is 25 points and the template leaves room for a worn bonus', () => {
    expect(CLASS_POWER_BUDGET).toBe(25);
    for (const tier of [1, 2, 3] as ClassTier[]) {
      const t = CLASS_TREE_POWER[tier];
      const imprint = Math.max(...([1, 2, 3] as ClassTier[]).map((k) => CLASS_TREE_POWER[k].imprint * IMPRINT_STRENGTH[k]));
      const base = 3 * t.power + t.capstone + MAX_IMPRINTS * imprint + 3 * t.damageStat;
      expect(base, `tier ${tier}`).toBeLessThanOrEqual(CLASS_POWER_BUDGET - 7);
    }
  });

  it('enumerates real content', () => {
    expect(reg.classes.length).toBe(30);
    expect(tagSets.length).toBeGreaterThan(100);
  });

  it('no class gives any single skill more than 25 points of extra damage', () => {
    const over: string[] = [];
    for (const cls of reg.classes) {
      let worst: (Breakdown & { tags: string[] }) | undefined;
      for (const tags of tagSets) {
        const b = classPower(reg, cls, tags);
        if (!worst || b.total > worst.total) worst = { ...b, tags };
      }
      expect(worst!.total, cls.id).toBeGreaterThan(0);
      if (worst!.total > CLASS_POWER_BUDGET + 1e-9) {
        over.push(
          `${cls.id}: ${worst!.total.toFixed(1)} on [${worst!.tags.join(', ')}] ` +
            `(tagPower ${worst!.bonusTags}, stat ${worst!.stat}, tree ${worst!.tree}, imprints ${worst!.imprints.join('+')})`,
        );
      }
    }
    expect(over, over.join('\n')).toEqual([]);
  });

  it('the worst case counts every component (a known skill, by hand)', () => {
    // Tempest Dancer worn on Firestorm (blade, spin, aoe, wind, fire): spin 10 + Spin Focus 3×2 + capstone 3
    // + the 3 best imprints among blade/spin/aoe/wind/fire/... (Tier I 2 each) = 25.
    const td = reg.classDef('tempest_dancer')!;
    const firestorm = reg.skill('firestorm')!;
    const b = classPower(reg, td, firestorm.tags);
    expect(b.bonusTags).toBe(10);
    expect(b.tree).toBe(3 * CLASS_TREE_POWER[1].power + CLASS_TREE_POWER[1].capstone);
    expect(b.imprints).toEqual([2, 2, 2]);
    expect(b.total).toBe(25);
  });
});
