// Power budget for procedural skills (docs/SPEC-v2.md §3 "Budget test"), over the real content.
//
// Enumerates every authored non-buff attack × (no element + every element it can take) × every
// legal essence set of size 0–2, plus every legal shape merge (± element ± 1 essence; pairs with an
// authored recipe never merge), and checks:
// - potentialHits ≤ MAX_HITS, cooldown ≥ 300 ms (authored skills may use 0 = weapon delay), name ≤ 4 words
//   whose first word starts with an uppercase letter (a trimmed name never opens on 'of', 'the'…);
// - damage per SP within ±35%, with NO waivers:
//   · essence variants: every essence step is budgeted — a 1-essence variant against base (or
//     base@element), a 2-essence variant against each of its 1-essence subsets. Damage is `power`,
//     or `power × hits per cast` once a multiply essence (split/flurry) is on the skill;
//   · merges: within [0.65 × the weaker, 1.35 × the stronger] attacking parent, damage = power × hits
//     per cast (a merge changes shape);
//   · references that cost 0 SP (auto-attacks) have no SP budget and are skipped.
// The rules that make this hold (SPEC §3): split spreads 1.1 × the volley over the new projectile
// count; a hit-trimmed variant is renormalized (capped at +35% per step); buff parents never merge.
import { beforeAll, describe, expect, it } from 'vitest';
import {
  MAX_HITS,
  MAX_NAME_WORDS,
  MIN_COOLDOWN,
  canTakeElement,
  compose,
  legalEssenceSet,
  mergeSkills,
  potentialHits,
  shapeHits,
} from '../src/core/compose';
import { skillRef } from '../src/core/refs';
import type { Registry } from '../src/core/registry';
import type { ElementDef, EssenceDef, SkillDef } from '../src/core/types';

const BAND = 0.35;
/** Violations printed per failing assertion (the count is always reported). */
const SHOW = 40;

let reg: Registry;
let elements: ElementDef[];
let essences: EssenceDef[];

const isAttack = (s: SkillDef): boolean => s.shape.kind !== 'buff' && s.power > 0 && !s.tags.includes('monster');
const words = (name: string): number => name.split(/\s+/).filter(Boolean).length;
const pct = (r: number): string => `${r >= 1 ? '+' : ''}${Math.round((r - 1) * 100)}%`;
const elementOptions = (root: SkillDef): (ElementDef | undefined)[] => [undefined, ...(canTakeElement(root) ? elements : [])];
const multiplies = (s: SkillDef): boolean => (s.essences ?? []).some((id) => reg.essence(id)?.category === 'multiply');
const totalDamage = (s: SkillDef): number => s.power * shapeHits(s.shape);

interface Report {
  /** Hit cap, cooldown floor and name length. */
  invariants: string[];
  /** Above +35%: never waived. */
  ceiling: string[];
  /** Below −35%: never waived either. */
  floor: string[];
  checked: number;
}

const emptyReport = (): Report => ({ invariants: [], ceiling: [], floor: [], checked: 0 });

function checkInvariants(s: SkillDef, out: Report): void {
  out.checked++;
  const hits = potentialHits(s);
  if (hits > MAX_HITS) out.invariants.push(`${s.id}: ${hits} potential hits > ${MAX_HITS}`);
  const cdOk = s.generated ? s.cooldown >= MIN_COOLDOWN : s.cooldown === 0 || s.cooldown >= MIN_COOLDOWN;
  if (!cdOk) out.invariants.push(`${s.id}: cooldown ${s.cooldown} ms < ${MIN_COOLDOWN}`);
  if (words(s.name) > MAX_NAME_WORDS) out.invariants.push(`${s.id}: name "${s.name}" has ${words(s.name)} words`);
  if (!/^[A-Z]/.test(s.name)) out.invariants.push(`${s.id}: name "${s.name}" does not start with an uppercase word`);
}

/** One essence step: `v` is `ref` plus one more essence. */
function checkStep(v: SkillDef, ref: SkillDef, out: Report): void {
  if (ref.spCost <= 0) return;
  const total = multiplies(v);
  const dmg = (s: SkillDef): number => (total ? totalDamage(s) : s.power);
  const ratio = dmg(v) / v.spCost / (dmg(ref) / ref.spCost);
  const msg = `${v.id}: damage/SP ${pct(ratio)} vs ${ref.id}`;
  if (ratio > 1 + BAND) out.ceiling.push(msg);
  if (ratio < 1 - BAND) out.floor.push(msg);
}

function checkMerge(m: SkillDef, a: SkillDef, b: SkillDef, out: Report): void {
  const rates = [a, b].filter((p) => isAttack(p) && p.spCost > 0).map((p) => totalDamage(p) / p.spCost);
  if (rates.length === 0 || m.spCost <= 0) return;
  const r = totalDamage(m) / m.spCost;
  const lo = Math.min(...rates) * (1 - BAND);
  const hi = Math.max(...rates) * (1 + BAND);
  const msg = `${m.id}: damage/SP ${r.toFixed(3)} outside [${lo.toFixed(3)}, ${hi.toFixed(3)}] of ${a.id} / ${b.id}`;
  if (r > hi) out.ceiling.push(msg);
  if (r < lo) out.floor.push(msg);
}

function variantsReport(): Report {
  const out = emptyReport();
  for (const base of reg.authoredSkills().filter(isAttack)) {
    const fit = essences.filter((e) => legalEssenceSet(base, [e]));
    for (const el of elementOptions(base)) {
      const ref = compose(base, el, []);
      checkInvariants(ref, out);
      const singles = fit.map((e) => compose(base, el, [e]));
      fit.forEach((_, i) => {
        checkInvariants(singles[i], out);
        checkStep(singles[i], ref, out);
      });
      for (let i = 0; i < fit.length; i++) {
        for (let j = i + 1; j < fit.length; j++) {
          if (!legalEssenceSet(base, [fit[i], fit[j]])) continue;
          const v = compose(base, el, [fit[i], fit[j]]);
          checkInvariants(v, out);
          checkStep(v, singles[i], out);
          checkStep(v, singles[j], out);
        }
      }
    }
  }
  return out;
}

function mergesReport(): Report {
  const out = emptyReport();
  const authored = reg.authoredSkills();
  for (let i = 0; i < authored.length; i++) {
    for (let j = i + 1; j < authored.length; j++) {
      const [a, b] = [authored[i], authored[j]];
      if (reg.recipe(skillRef(a.id), skillRef(b.id))) continue;
      const m = mergeSkills(a, b);
      if (!m) continue;
      checkMerge(m, a, b, out);
      const fit = essences.filter((e) => legalEssenceSet(m, [e]));
      for (const el of elementOptions(m)) {
        const ref = compose(m, el, []);
        checkInvariants(ref, out);
        for (const e of fit) {
          const v = compose(m, el, [e]);
          checkInvariants(v, out);
          checkStep(v, ref, out);
        }
      }
    }
  }
  return out;
}

const summary = (list: string[]): string => `${list.length} violations:\n${list.slice(0, SHOW).join('\n')}`;

describe('procedural skill budget (src/data)', () => {
  let variants: Report;
  let merges: Report;

  beforeAll(async () => {
    // Imported lazily so a half-written data bundle reports here instead of failing collection.
    const { createRegistry } = await import('../src/data');
    reg = createRegistry();
    elements = [...reg.elements.values()];
    essences = [...reg.essences.values()];
    variants = variantsReport();
    merges = mergesReport();
  }, 120_000);

  it('enumerates real content', () => {
    expect(reg.authoredSkills().filter(isAttack).length).toBeGreaterThan(0);
    expect(essences.length).toBeGreaterThan(0);
    expect(variants.checked).toBeGreaterThan(0);
    expect(merges.checked).toBeGreaterThan(0);
  });

  it('variants: hits ≤ 12, cooldown ≥ 300 ms, names ≤ 4 capitalized words', () => {
    expect(variants.invariants, summary(variants.invariants)).toEqual([]);
  });

  it('variants: no essence step gains more than 35% damage per SP', () => {
    expect(variants.ceiling, summary(variants.ceiling)).toEqual([]);
  });

  it('variants: no essence step loses more than 35% damage per SP', () => {
    expect(variants.floor, summary(variants.floor)).toEqual([]);
  });

  it('merges: hits ≤ 12, cooldown ≥ 300 ms, names ≤ 4 capitalized words', () => {
    expect(merges.invariants, summary(merges.invariants)).toEqual([]);
  });

  it('merges: never more than 35% above the stronger parent (or the merge, per essence)', () => {
    expect(merges.ceiling, summary(merges.ceiling)).toEqual([]);
  });

  it('merges: never more than 35% below the weaker parent', () => {
    expect(merges.floor, summary(merges.floor)).toEqual([]);
  });

  it('split: every untrimmed volley deals 1.1x the base volley (1.1c/(c+2) per projectile) for 1.3x the SP', () => {
    const split = reg.essence('split')!;
    const bad: string[] = [];
    let n = 0;
    for (const base of reg.authoredSkills().filter(isAttack)) {
      if (!legalEssenceSet(base, [split])) continue;
      const v = compose(base, undefined, [split]);
      const c = shapeHits(base.shape);
      if (shapeHits(v.shape) !== c + 2) continue; // trimmed by the hit clamp (renormalized instead)
      n++;
      // Per projectile 1.1 × c / (c + 2) of the base, to the 0.01 power rounding.
      const expected = (1.1 * base.power * c) / (c + 2);
      // An SP-free base (auto-attack) starts essence variants at 2 SP.
      if (Math.abs(v.power - expected) > 0.0051 || v.spCost !== Math.round((base.spCost || 2) * 1.3 * 100) / 100) {
        bad.push(`${v.id}: power ${v.power} (expected ${expected.toFixed(3)}), sp ${v.spCost}`);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(bad).toEqual([]);
  });

  it('merges: no buff parent ever merges', () => {
    const authored = reg.authoredSkills();
    const buffs = authored.filter((s) => s.shape.kind === 'buff');
    expect(buffs.length).toBeGreaterThan(0);
    const merged = buffs.flatMap((buff) =>
      authored.filter((o) => o.id !== buff.id && mergeSkills(buff, o) !== null).map((o) => `${buff.id} + ${o.id}`),
    );
    expect(merged).toEqual([]);
  });
});
