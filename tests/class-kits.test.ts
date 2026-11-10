// Class kits (docs/SPEC-v4.md §3.4): "the 5 class skills are the class's own". Over every class in the data,
// legacy kits included:
//   1. every class has exactly 5 kit skills;
//   2. no two classes share more than 1 kit skill;
//   3. a rebuilt class (one with a Gift) owns its whole kit: all 5 skills carry `classOf` = that class — the spec
//      asks for at least 4, the data goes further; a legacy kit (§3.7) is made of today's shared skills and owns none;
//   4. no skill sits in more than 2 kits;
//   5. every kit skill works with the class weapon ('any' classes hold only free skills);
//   6. a kit never repeats a kind + delivery + extra;
// plus the bookkeeping that keeps kits honest: a `classOf` skill sits in exactly its own class's kit, the four merged
// classes are gone, and every class has a rarity, a mechanic and a way to be found.
import { describe, expect, it } from 'vitest';
import { CLASS, isKitClass, kitSkillsAt } from '../src/core/classes';
import { skillSignature } from '../src/core/compose';
import { weaponOk } from '../src/core/requirements';
import { MERGED_CLASSES } from '../src/core/save';
import { RARITIES, type ClassDef, type SkillDef } from '../src/core/types';
import { createRegistry } from '../src/data';
import { REBUILT } from '../src/data/classes';

const reg = createRegistry();
const classes = reg.classes;
const kitOf = (c: ClassDef): string[] => [...(c.kit ?? [])];
const looseKey = (s: SkillDef): string => {
  const sig = skillSignature(s, s.element ? reg.element(s.element)?.status : undefined);
  return `${sig.kind}·${sig.delivery}·${sig.extra}`;
};

describe('class kits (SPEC-v4 §3.4)', () => {
  it('26 classes, each with a kit; the four merged classes are gone and their targets exist', () => {
    expect(classes).toHaveLength(26);
    expect(classes.filter((c) => !isKitClass(c)).map((c) => c.id)).toEqual([]);
    for (const [from, to] of Object.entries(MERGED_CLASSES)) {
      expect(reg.classDef(from), from).toBeUndefined();
      expect(reg.classDef(to), to).toBeDefined();
    }
  });

  it('rule 1: exactly 5 different, known kit skills, none of them a basic attack', () => {
    for (const c of classes) {
      const kit = kitOf(c);
      expect(kit, c.id).toHaveLength(5);
      expect(new Set(kit).size, c.id).toBe(5);
      for (const id of kit) {
        const s = reg.skill(id);
        expect(s, `${c.id}: ${id}`).toBeDefined();
        expect(s!.tier === 0 && s!.tags.includes('basic'), `${c.id}: ${id}`).toBe(false);
        expect(s!.tags.includes('monster'), `${c.id}: ${id}`).toBe(false);
      }
    }
  });

  it('rule 2: no two classes share more than 1 kit skill', () => {
    const bad: string[] = [];
    for (let i = 0; i < classes.length; i++) {
      for (let j = i + 1; j < classes.length; j++) {
        const shared = kitOf(classes[i]).filter((id) => kitOf(classes[j]).includes(id));
        if (shared.length > 1) bad.push(`${classes[i].id} + ${classes[j].id}: ${shared.join(', ')}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 3: a rebuilt class owns all 5 of its skills; the 8 Phase 1 classes are rebuilt', () => {
    expect([...REBUILT].sort()).toEqual(
      ['arcanist', 'blademaster', 'knife_juggler', 'pyroblade', 'pyromancer', 'shadowstalker', 'tidecaller', 'wayfarer'],
    );
    for (const id of REBUILT) {
      const c = reg.classDef(id)!;
      expect(kitOf(c).filter((k) => reg.skill(k)!.classOf === c.id), id).toHaveLength(5);
      expect(c.passive, id).toBeDefined();
      expect(c.mechanicUpgrade, id).toBeDefined();
      expect(c.mechanicUpgrade!.line.length, id).toBeLessThanOrEqual(60);
    }
  });

  it('rule 4: no skill sits in more than 2 kits', () => {
    const count = new Map<string, string[]>();
    for (const c of classes) for (const id of kitOf(c)) count.set(id, [...(count.get(id) ?? []), c.id]);
    const bad = [...count].filter(([, cs]) => cs.length > 2).map(([id, cs]) => `${id}: ${cs.join(', ')}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 5: every kit skill works with the class weapon', () => {
    const bad: string[] = [];
    for (const c of classes) {
      for (const id of kitOf(c)) {
        const s = reg.skill(id)!;
        const ok = c.weapon === 'any' || c.weapon === undefined ? s.weapons === undefined : weaponOk(s, c.weapon);
        if (!ok) bad.push(`${c.id} (${c.weapon}): ${id} needs ${s.weapons?.join(' / ')}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 6: a kit never repeats a kind + delivery + extra', () => {
    const bad: string[] = [];
    for (const c of classes) {
      const seen = new Map<string, string>();
      for (const id of kitOf(c)) {
        const key = looseKey(reg.skill(id)!);
        if (seen.has(key)) bad.push(`${c.id}: ${seen.get(key)} and ${id} are both ${key}`);
        seen.set(key, id);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it("a class's own skill sits in exactly that class's kit", () => {
    const bad: string[] = [];
    for (const s of reg.authoredSkills()) {
      if (s.classOf === undefined) continue;
      const holders = classes.filter((c) => kitOf(c).includes(s.id)).map((c) => c.id);
      if (holders.length !== 1 || holders[0] !== s.classOf) bad.push(`${s.id} (classOf ${s.classOf}) is in: ${holders.join(', ') || 'no kit'}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
    expect(reg.authoredSkills().filter((s) => s.classOf !== undefined)).toHaveLength(REBUILT.length * 5);
  });

  it('every class has a rarity, a weapon, a mechanic and a way to be found; rarities are 4 Commons and up', () => {
    for (const c of classes) {
      expect(RARITIES, c.id).toContain(c.rarity);
      expect(c.weapon, c.id).toBeDefined();
      expect(c.source, c.id).toBeDefined();
      expect(c.mechanic, c.id).toBeDefined();
      expect(c.discover!.requires.length, c.id).toBeGreaterThan(0);
      expect(c.desc.length, `${c.id}: "${c.desc}"`).toBeLessThanOrEqual(60);
    }
    const commons = classes.filter((c) => c.rarity === 'common');
    expect(commons.map((c) => c.weapon).sort()).toEqual(['dagger', 'fists', 'staff', 'sword']);
    // No class requires a Mythic, and none is Mythic or Legendary yet (Phase 5).
    expect(classes.filter((c) => c.rarity === 'mythic' || c.rarity === 'legendary')).toEqual([]);
  });

  it('kit skills unlock at Class Levels 1, 1, 2, 4, 6', () => {
    expect(CLASS.kitAt).toEqual([1, 1, 2, 4, 6]);
    const c = reg.classDef('blademaster')!;
    expect(kitSkillsAt(c, 1)).toEqual(kitOf(c).slice(0, 2));
    expect(kitSkillsAt(c, 3)).toEqual(kitOf(c).slice(0, 3));
    expect(kitSkillsAt(c, 6)).toEqual(kitOf(c));
  });

  it('a legacy kit leads with the class signature where the class has one', () => {
    for (const c of classes) {
      const own = reg.skill(`${c.id}_sig`);
      if (own && !REBUILT.includes(c.id)) expect(kitOf(c)[0], c.id).toBe(own.id);
    }
  });

  it('mechanic names are short, and the same name always means the same mechanic', () => {
    const names = new Map<string, string>();
    for (const c of classes) {
      const m = c.mechanic!;
      const name = m.kind === 'stance' ? m.names.join(' / ') : m.kind === 'form' ? m.gauge.name : m.name;
      expect(name.length, c.id).toBeLessThanOrEqual(24);
      const key = JSON.stringify(m);
      if (names.has(name)) expect(names.get(name), `${c.id}: ${name}`).toBe(key);
      names.set(name, key);
    }
    // Every rebuilt class has a mechanic nobody else has.
    const own = REBUILT.map((id) => JSON.stringify(reg.classDef(id)!.mechanic));
    expect(new Set(own).size).toBe(REBUILT.length);
  });
});
