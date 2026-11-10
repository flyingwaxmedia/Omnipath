// "All feel different" (docs/SPEC-v4.md §6.3): no two player skills work the same way. Over the real data:
//   1. no two player skills share kind + element + delivery + extra (tier-0 basics included);
//   2. no two skills of one weapon tree or one class kit share kind + delivery + extra, whatever their element;
//   3. a Transform never leads to a skill with its parent's signature;
//   4. no two skills of the same kind and element have every shape number and their power within ±20%
//      (the audit's "tight pair" check, kept as a second net);
//   5. at most one plain buff per stat (Focus MATK, Rally Cry ATK, Quicken speed, Meditation regen, Shade Cloak
//      crit): every other buff does something more than "+X% of one stat".
// There are no waivers. Two groups are out of scope, each for a stated reason:
//   - monster-only moves (tag `monster`): players never own them;
//   - the 17 Echo moves of src/data/skills/echoes.ts: they are monster moves a player can still copy in Phase 1, and
//     Phase 2 takes them out of the player's hands altogether (§5.4: tag `monster`, Echoes become augments).
import { describe, expect, it } from 'vitest';
import { isKitClass } from '../src/core/classes';
import { signatureKey, skillSignature } from '../src/core/compose';
import { WEAPON_TYPES, type SkillDef, type SkillShape } from '../src/core/types';
import { createRegistry } from '../src/data';
import { ECHO_SKILLS } from '../src/data/skills/echoes';
import { WEAPONS } from '../src/data/weapons';

const reg = createRegistry();
const ECHO_IDS = new Set(ECHO_SKILLS.map((s) => s.id));
const PLAYER: SkillDef[] = reg.authoredSkills().filter((s) => !s.tags.includes('monster') && !ECHO_IDS.has(s.id));

const sigOf = (s: SkillDef) => skillSignature(s, s.element ? reg.element(s.element)?.status : undefined);
/** A buff that only raises one stat: no extra beyond the stat itself (a crit buff that "crits", a speed buff that "hastes"). */
const isPlainBuff = (s: SkillDef): boolean => {
  if (s.shape.kind !== 'buff') return false;
  const extra = sigOf(s).extra;
  return extra === 'none' || (extra === 'crit' && s.shape.stat === 'crit') || (extra === 'haste' && s.shape.stat === 'speed');
};
/** kind·element·delivery·extra; the plain buffs differ by their stat (rule 5 holds them to one per stat). */
const fullKey = (s: SkillDef): string => signatureKey(sigOf(s)) + (s.shape.kind === 'buff' && isPlainBuff(s) ? `·${s.shape.stat}` : '');
/** kind·delivery·extra: the signature without its element. */
const looseKey = (s: SkillDef): string => {
  const sig = sigOf(s);
  return `${sig.kind}·${sig.delivery}·${sig.extra}` + (s.shape.kind === 'buff' && isPlainBuff(s) ? `·${s.shape.stat}` : '');
};

function clashes(skills: readonly SkillDef[], key: (s: SkillDef) => string): string[] {
  const groups = new Map<string, string[]>();
  for (const s of skills) groups.set(key(s), [...(groups.get(key(s)) ?? []), s.id]);
  return [...groups].filter(([, ids]) => ids.length > 1).map(([k, ids]) => `${k}: ${ids.join(', ')}`);
}

/** The weapon tree: the basic attack and every skill reachable from it by Transforms. */
function weaponTree(basic: string): SkillDef[] {
  const seen = new Set([basic]);
  const queue = [basic];
  while (queue.length > 0) {
    for (const m of reg.morphsFrom(queue.shift()!)) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      queue.push(m.to);
    }
  }
  return [...seen].map((id) => reg.skill(id)!);
}

// ------------------------------------------------------------------ rule 4: tight pairs

const close = (a: number, b: number): boolean => a === b || Math.abs(a - b) / Math.max(Math.abs(a), Math.abs(b)) <= 0.2;
/** Numbers that are how a shape looks in flight, not what it does. */
const COSMETIC = new Set(['kind', 'speed', 'size', 'delay']);
/** Whole-number parameters: a different count is a different skill. */
const COUNTS = new Set(['hits', 'count', 'pulses', 'jumps', 'pierce']);
const COUNT_DEFAULT: Record<string, number> = { hits: 1, count: 1, pulses: 1, jumps: 0, pierce: 0 };

function flat(shape: SkillShape): Record<string, number | string | boolean> {
  const out: Record<string, number | string | boolean> = {};
  for (const [k, v] of Object.entries(shape)) {
    if (COSMETIC.has(k)) continue;
    if (v !== null && typeof v === 'object') {
      out[k] = true;
      for (const [k2, v2] of Object.entries(v as Record<string, number>)) out[`${k}.${k2}`] = v2;
    } else if (v !== undefined) {
      out[k] = v as number | string | boolean;
    }
  }
  return out;
}

function tight(a: SkillDef, b: SkillDef): boolean {
  if (a.shape.kind !== b.shape.kind || (a.element ?? 'none') !== (b.element ?? 'none')) return false;
  if (!close(a.power, b.power)) return false;
  const x = flat(a.shape);
  const y = flat(b.shape);
  for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) {
    const u = x[k] ?? (COUNTS.has(k) ? COUNT_DEFAULT[k] : typeof y[k] === 'number' ? 0 : false);
    const v = y[k] ?? (COUNTS.has(k) ? COUNT_DEFAULT[k] : typeof x[k] === 'number' ? 0 : false);
    if (typeof u === 'number' && typeof v === 'number' && !COUNTS.has(k)) {
      if (!close(u, v)) return false;
    } else if (u !== v) {
      return false;
    }
  }
  return true;
}

// ------------------------------------------------------------------ the tests

describe('every player skill is its own thing (SPEC-v4 §6.3)', () => {
  it('covers the whole player skill list, and every skill declares how it is delivered', () => {
    expect(PLAYER.length).toBeGreaterThan(180);
    expect(PLAYER.filter((s) => s.delivery === undefined).map((s) => s.id)).toEqual([]);
    // Tier-0 basics are in: they differ by delivery (cut, thrust, bolt, punch).
    expect(WEAPON_TYPES.map((w) => sigOf(reg.skill(WEAPONS[w].basic)!).delivery)).toEqual(['cut', 'thrust', 'bolt', 'punch']);
  });

  it('rule 1: no two skills share kind + element + delivery + extra', () => {
    const bad = clashes(PLAYER, fullKey);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 2: inside one weapon tree or one class kit, no two share kind + delivery + extra', () => {
    const bad: string[] = [];
    for (const w of WEAPON_TYPES) for (const c of clashes(weaponTree(WEAPONS[w].basic), looseKey)) bad.push(`${w} tree — ${c}`);
    for (const cls of reg.classes.filter(isKitClass)) {
      for (const c of clashes(cls.kit.map((id) => reg.skill(id)!), looseKey)) bad.push(`${cls.id} kit — ${c}`);
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 3: a Transform never keeps its parent signature', () => {
    const bad = reg.morphs
      .filter((m) => reg.skill(m.from) && reg.skill(m.to) && fullKey(reg.skill(m.from)!) === fullKey(reg.skill(m.to)!))
      .map((m) => `${m.from} > ${m.to}: ${fullKey(reg.skill(m.to)!)}`);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 4: no two skills of one kind and element are the same numbers within ±20%', () => {
    const bad: string[] = [];
    for (let i = 0; i < PLAYER.length; i++) {
      for (let j = i + 1; j < PLAYER.length; j++) {
        if (tight(PLAYER[i], PLAYER[j])) bad.push(`${PLAYER[i].id} ≈ ${PLAYER[j].id}`);
      }
    }
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('rule 5: at most one plain buff per stat', () => {
    const plain = PLAYER.filter(isPlainBuff);
    const bad = clashes(plain, (s) => (s.shape.kind === 'buff' ? s.shape.stat : ''));
    expect(bad, bad.join('\n')).toEqual([]);
    expect(plain.map((s) => s.id).sort()).toEqual(['focus', 'meditation', 'quicken', 'rally_cry', 'shade_cloak']);
  });

  it('the checks themselves catch a copy', () => {
    const whirl = reg.skill('whirlwind')!;
    const copy: SkillDef = { ...whirl, id: 'whirlwind_copy', name: 'Whirlwind Copy' };
    expect(clashes([whirl, copy], fullKey)).toHaveLength(1);
    expect(tight(whirl, copy)).toBe(true);
    expect(tight(whirl, { ...copy, power: whirl.power * 1.3 })).toBe(false);
    expect(tight(whirl, { ...copy, element: 'fire' })).toBe(false);
    expect(tight(whirl, { ...copy, shape: { kind: 'spin', radius: 84, pulses: 3 } })).toBe(false);
    // An extra equal to the element's own status counts as none (fire already burns).
    expect(signatureKey(sigOf({ ...whirl, element: 'fire', extra: 'burn' }))).toBe('spin·fire·ring·none');
  });
});
