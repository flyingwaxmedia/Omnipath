// Package R (docs/VFX.md §6, §7, §11.1 vfx-recipe): every skill the game can produce derives a complete, valid,
// deterministic effect recipe whose geometry and timing match the real hit tests.
import { describe, expect, it } from 'vitest';
import { canTakeElement, legalEssenceSet, mergeBlocker, mergeId, MONSTER_TAG, variantId } from '../src/core/compose';
import { mulberry32 } from '../src/core/rng';
import type { EssenceDef, SkillDef, StatusKind } from '../src/core/types';
import { createRegistry, GAME_DATA } from '../src/data';
import { WEAPONS } from '../src/data/weapons';
import * as families from '../src/game/vfx/families';
import { AFTERMATH_MAX_R, cellFor, nominalMs, pieceEndMs, pieceProblems, recipePieces } from '../src/game/vfx/pieces';
import * as recipeApi from '../src/game/vfx/recipe';
import { arcBucket, deriveAttackVfx, deriveVfx, GROUND_TRUTH, hitGeometry, impactPieces, monsterTellMs, reachBucket, statusPieces } from '../src/game/vfx/recipe';
import * as signatureApi from '../src/game/vfx/signatures';
import { SIGNATURES } from '../src/game/vfx/signatures';
import {
  COMPONENT_IDS,
  FAMILY_IDS,
  PHASE_IDS,
  VFX_BUDGET,
  type Carrier,
  type PhaseId,
  type VfxOwner,
  type VfxPiece,
  type VfxRecipe,
  type VfxRecipeApi,
  type VfxSignatureApi,
} from '../src/game/vfx/types';

// Pin the modules to the contract at compile time (docs/VFX.md §10.2).
const recipeContract: VfxRecipeApi = recipeApi;
const signatureContract: VfxSignatureApi = signatureApi;
void recipeContract;
void signatureContract;

const reg = createRegistry();
const AUTHORED = reg.authoredSkills();
const byId = new Map(GAME_DATA.skills.map((s) => [s.id, s]));
const lookup = (id: string): SkillDef | undefined => byId.get(id);
const ELEMENTS = GAME_DATA.elements;
const ESSENCES = GAME_DATA.essences;
const isMonsterOnly = (s: SkillDef): boolean => s.tags.includes(MONSTER_TAG);
const PLAYER_SKILLS = AUTHORED.filter((s) => !isMonsterOnly(s));
const TECHNIQUE_IDS = [...new Set(GAME_DATA.monsters.flatMap((m) => (m.techniques ?? []).map((t) => t.skill)))];
const TECHNIQUES = TECHNIQUE_IDS.map((id) => reg.skill(id)!);
const ROOTS = AUTHORED.filter((s) => !isMonsterOnly(s));

/** Every element infusion of every root that has an element slot. */
const INFUSIONS: [SkillDef, SkillDef][] = ROOTS.filter(canTakeElement).flatMap((root) =>
  ELEMENTS.map((el): [SkillDef, SkillDef] => [root, reg.skill(variantId(root.id, el.id))!]),
);

/** Every legal essence set (1 or 2 essences) of every root. */
function essenceSets(root: SkillDef): EssenceDef[][] {
  const out: EssenceDef[][] = [];
  for (let i = 0; i < ESSENCES.length; i++) {
    if (legalEssenceSet(root, [ESSENCES[i]])) out.push([ESSENCES[i]]);
    for (let j = i + 1; j < ESSENCES.length; j++) if (legalEssenceSet(root, [ESSENCES[i], ESSENCES[j]])) out.push([ESSENCES[i], ESSENCES[j]]);
  }
  return out;
}
const ESSENCE_VARIANTS: [SkillDef, SkillDef][] = ROOTS.flatMap((root) =>
  essenceSets(root).map((mods): [SkillDef, SkillDef] => [root, reg.skill(variantId(root.id, undefined, mods.map((m) => m.id)))!]),
);

/** Every legal shape merge, with its primary parent. */
const MERGES: [SkillDef, SkillDef, SkillDef][] = [];
for (let i = 0; i < ROOTS.length; i++) {
  for (let j = i + 1; j < ROOTS.length; j++) {
    const [a, b] = [ROOTS[i], ROOTS[j]];
    if (mergeBlocker(a, b)) continue;
    const [primary] = recipeApi.mergeParents(a, b);
    MERGES.push([reg.skill(mergeId(a.id, b.id))!, primary, primary === a ? b : a]);
  }
}
/** A spread of merge variants (infused and essence-shaped merges). */
const MERGE_VARIANTS: SkillDef[] = MERGES.filter((_, i) => i % 37 === 0).flatMap(([m]) => {
  const out: SkillDef[] = [];
  if (canTakeElement(m)) out.push(reg.skill(variantId(m.id, 'fire'))!);
  const sets = essenceSets(m);
  if (sets.length) out.push(reg.skill(variantId(m.id, undefined, sets[0].map((e) => e.id)))!);
  return out.filter(Boolean);
});

const ALL_PLAYER: SkillDef[] = [...AUTHORED, ...INFUSIONS.map(([, v]) => v), ...ESSENCE_VARIANTS.map(([, v]) => v), ...MERGES.map(([m]) => m), ...MERGE_VARIANTS];

const ofPhase = (r: VfxRecipe, ph: PhaseId): readonly VfxPiece[] => r.phases[ph] ?? [];
const comps = (ps: readonly VfxPiece[]): Set<string> => new Set(ps.map((p) => p.component));
const rings = (ps: readonly VfxPiece[]) => ps.filter((p): p is Extract<VfxPiece, { component: 'ring' }> => p.component === 'ring');
const isEcho = (p: VfxPiece): boolean => (p.tags ?? []).includes('echo');

function problems(r: VfxRecipe): string[] {
  const out: string[] = [];
  for (const p of recipePieces(r)) for (const why of pieceProblems(p, r.owner)) out.push(`${r.key} ${p.component}: ${why}`);
  if (!FAMILY_IDS.includes(r.family)) out.push(`${r.key} family ${r.family}`);
  if (r.owner === 'player' && r.family === 'danger') out.push(`${r.key} player family danger`);
  if (ofPhase(r, 'cast').length + ofPhase(r, 'body').length + ofPhase(r, 'area').length === 0) out.push(`${r.key} has no cast/body/area piece`);
  return out;
}

describe('vfx recipes: coverage and validity', () => {
  it('derives a valid recipe for every authored skill, technique, infusion, essence set, merge and auto-attack', () => {
    const bad: string[] = [];
    const recipes: VfxRecipe[] = [];
    for (const s of ALL_PLAYER) recipes.push(deriveVfx(s, 'player'));
    for (const s of TECHNIQUES) recipes.push(deriveVfx(s, 'monster'));
    for (const m of GAME_DATA.monsters) recipes.push(deriveAttackVfx({ id: m.id, family: m.family, element: m.element, rank: m.rank, size: m.size }));
    for (const r of recipes) bad.push(...problems(r));
    expect(bad.slice(0, 25)).toEqual([]);
    // Coverage summary (counts come from the data, never hard-coded).
    console.log(
      `vfx coverage: ${AUTHORED.length} authored (${PLAYER_SKILLS.length} player), ${TECHNIQUES.length} techniques, ${INFUSIONS.length} infusions, ${ESSENCE_VARIANTS.length} essence variants, ${MERGES.length} merges (+${MERGE_VARIANTS.length} merge variants), ${GAME_DATA.monsters.length} auto-attacks, ${Object.keys(SIGNATURES).length} signatures; ${recipes.length} recipes, ${recipes.reduce((n, r) => n + recipePieces(r).length, 0)} pieces`,
    );
  });

  it('references only existing components and every component is used somewhere', () => {
    const used = new Set<string>();
    for (const s of [...AUTHORED, ...MERGES.map(([m]) => m)]) for (const p of recipePieces(deriveVfx(s))) used.add(p.component);
    for (const s of TECHNIQUES) for (const p of recipePieces(deriveVfx(s, 'monster'))) used.add(p.component);
    for (const c of used) expect(COMPONENT_IDS).toContain(c);
    expect([...used].sort()).toEqual([...COMPONENT_IDS].sort());
  });

  it('never uses the danger family, the monster LUT, marching dashed rims or converging motes in player recipes', () => {
    const bad: string[] = [];
    for (const s of ALL_PLAYER) {
      const r = deriveVfx(s, 'player');
      if (r.family === 'danger') bad.push(`${r.key} family`);
      for (const p of recipePieces(r)) {
        if (p.ramp === 'danger' || p.motif === 'danger') bad.push(`${r.key} ${p.component} danger`);
        if (p.lut === 'monster') bad.push(`${r.key} ${p.component} monster lut`);
        if (p.component === 'ring' && p.params.style === 'dashed' && p.params.anim === 'march') bad.push(`${r.key} marching rim`);
        if (p.place?.pattern === 'converge') bad.push(`${r.key} converge`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });

  it('gives every skill a full shape-specific carrier, never a generic tinted circle', () => {
    const need: Record<Carrier['kind'], (r: VfxRecipe) => boolean> = {
      strike: (r) =>
        ofPhase(r, 'cast').some(
          (p) => p.component === 'slash' || p.component === 'thrust' || (p.component === 'burst' && p.params.cls === 'ki') || (p.component === 'ring' && !!p.params.arc), // cone edge
        ),
      spin: (r) => rings(ofPhase(r, 'cast')).length >= 1 && ofPhase(r, 'area').length >= 1,
      projectile: (r) => comps(ofPhase(r, 'body')).has('orb') || comps(ofPhase(r, 'body')).has('missile'),
      dash: (r) => ofPhase(r, 'trail').length >= 2 && (comps(ofPhase(r, 'cast')).has('afterimage') || comps(ofPhase(r, 'body')).has('missile')),
      nova: (r) => ['nova', 'erupt', 'ring'].every((c) => comps(ofPhase(r, 'area')).has(c)),
      chain: (r) => comps(ofPhase(r, 'body')).has('bolt') || comps(ofPhase(r, 'body')).has('missile'),
      buff: (r) => ofPhase(r, 'aura').some((p) => p.component === 'aura' && p.params.phase === 'loop') && comps(ofPhase(r, 'cast')).has('aura'),
    };
    for (const [s, owner] of [...ALL_PLAYER.map((x) => [x, 'player'] as const), ...TECHNIQUES.map((x) => [x, 'monster'] as const)]) {
      const r = deriveVfx(s, owner);
      expect(r.carrier.kind, r.key).toBe(s.shape.kind);
      expect(need[r.carrier.kind](r), `${r.key} carrier ${JSON.stringify(r.carrier)}`).toBe(true);
      expect(new Set(recipePieces(r).map((p) => p.component)).size, r.key).toBeGreaterThanOrEqual(3);
      const canHit = s.shape.kind !== 'buff' && s.power > 0 && !(s.shape.kind === 'dash' && s.shape.width <= 0);
      expect(ofPhase(r, 'impact').length > 0, r.key).toBe(canHit);
    }
  });

  it('distinctness: at most 2 authored player skills share an identical signature-phase piece set', () => {
    const PH: Record<Carrier['kind'], PhaseId[]> = {
      strike: ['cast'],
      spin: ['cast'],
      projectile: ['cast', 'body', 'trail'],
      chain: ['cast', 'body'],
      dash: ['cast', 'body', 'trail', 'area'],
      nova: ['telegraph', 'area'],
      buff: ['cast', 'aura'],
    };
    const groups = new Map<string, string[]>();
    for (const s of PLAYER_SKILLS) {
      const r = deriveVfx(s);
      const k = JSON.stringify(PH[r.carrier.kind].map((ph) => ofPhase(r, ph)));
      groups.set(k, [...(groups.get(k) ?? []), s.id]);
    }
    const crowded = [...groups.values()].filter((ids) => ids.length > 2);
    expect(crowded).toEqual([]);
  });
});

describe('vfx recipes: determinism', () => {
  it('derives identical recipes with and without the cache, and in shuffled order', () => {
    const sample = [...AUTHORED, ...INFUSIONS.filter((_, i) => i % 7 === 0).map(([, v]) => v), ...MERGES.filter((_, i) => i % 23 === 0).map(([m]) => m)];
    const ordered = sample.map((s) => JSON.stringify(deriveVfx(s, 'player', lookup)));
    const rnd = mulberry32(1234);
    const idx = sample.map((_, i) => i);
    for (let i = idx.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    const shuffled: string[] = [];
    for (const i of idx) shuffled[i] = JSON.stringify(deriveVfx(sample[i], 'player', lookup));
    expect(shuffled).toEqual(ordered);
    for (let i = 0; i < sample.length; i++) expect(JSON.stringify(deriveVfx(sample[i])), sample[i].id).toBe(ordered[i]);
    for (const s of TECHNIQUES) expect(JSON.stringify(deriveVfx(s, 'monster', lookup))).toBe(JSON.stringify(deriveVfx(s, 'monster')));
  });

  it('seeds variety from the root id', () => {
    for (const [root, v] of INFUSIONS.slice(0, 40)) expect(deriveVfx(v).variety).toBe(deriveVfx(root).variety);
  });
});

describe('vfx recipes: game truth', () => {
  it('statuses equal Combat.hit (player) and MonsterSkills.statusesOf (monster)', () => {
    const elStatus = new Map(ELEMENTS.map((e) => [e.id, e.status]));
    const expected = (s: SkillDef, owner: VfxOwner): StatusKind[] => {
      const out: StatusKind[] = [];
      if (s.shape.kind === 'buff' || s.power <= 0) return out; // never reaches Combat.hit
      const el = s.element ? elStatus.get(s.element) : undefined;
      if (el && !(owner === 'monster' && el === 'smite')) out.push(el);
      if (s.status && !out.includes(s.status) && !(owner === 'monster' && s.status === 'smite')) out.push(s.status);
      if (owner === 'player' && s.riders?.knockback && !out.includes('knockback')) out.push('knockback');
      return out;
    };
    for (const s of ALL_PLAYER) expect(deriveVfx(s).statuses, s.id).toEqual(expected(s, 'player'));
    for (const s of TECHNIQUES) expect(deriveVfx(s, 'monster').statuses, s.id).toEqual(expected(s, 'monster'));
  });

  it('geometry equals the hit tests (docs/VFX.md §8.1)', () => {
    for (const owner of ['player', 'monster'] as const) {
      for (const s of owner === 'player' ? ALL_PLAYER : TECHNIQUES) {
        const g = deriveVfx(s, owner).geometry;
        expect(g, s.id).toEqual(hitGeometry(s, owner));
        const sh = s.shape;
        if (sh.kind === 'strike') expect(g).toEqual({ kind: 'sector', r: sh.range, arcDeg: sh.arc, addCasterRadius: owner === 'monster' });
        if (sh.kind === 'spin') expect(g).toEqual({ kind: 'disc', r: sh.radius, aspect: owner === 'monster' ? 0.65 : 1, at: 'caster', addCasterRadius: owner === 'monster' });
        if (sh.kind === 'nova') expect(g).toEqual({ kind: 'disc', r: sh.radius, aspect: owner === 'monster' ? 0.65 : 1, at: 'aim', addCasterRadius: false });
        if (sh.kind === 'dash') expect(g).toEqual({ kind: 'lane', length: sh.distance, width: owner === 'monster' ? Math.max(24, sh.width) : sh.width });
        if (sh.kind === 'projectile') expect(g).toMatchObject({ kind: 'shot', size: sh.size ?? 12, range: sh.range, count: sh.count ?? 1, pierce: sh.pierce ?? 0 });
        if (sh.kind === 'chain') expect(g).toEqual(owner === 'monster' ? { kind: 'chain', range: sh.range, hop: 0, jumps: 0 } : { kind: 'chain', range: sh.range, hop: 150, jumps: sh.jumps });
        if (sh.kind === 'buff') expect(g).toEqual({ kind: 'self' });
      }
    }
  });

  it('sizes match the hit tests: reach, arcs, radii, cells and lanes', () => {
    const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
    for (const owner of ['player', 'monster'] as const) {
      for (const s of owner === 'player' ? ALL_PLAYER : TECHNIQUES) {
        const r = deriveVfx(s, owner);
        const sh = s.shape;
        const cast = ofPhase(r, 'cast');
        if (sh.kind === 'strike' && r.carrier.kind === 'strike') {
          const range = Math.min(128, Math.max(40, sh.range));
          const main = cast.find((p) => p.component === 'slash' || p.component === 'thrust' || p.component === 'burst' || p.component === 'ring');
          const style = r.carrier.style;
          if (style === 'crescent' || style === 'execute') {
            const sl = cast.find((p): p is Extract<VfxPiece, { component: 'slash' }> => p.component === 'slash')!;
            expect(sl.params.r, r.key).toBe(reachBucket(sh.range));
            expect(near(sl.params.r, range, 4), r.key).toBe(true);
            if (style === 'crescent') expect(near(sl.params.arc, Math.min(360, Math.max(60, sh.arc)), 15), r.key).toBe(true);
          }
          if (style === 'thrust') expect(main?.component === 'thrust' && near(main.params.len, range, 4), r.key).toBe(true);
          if (style === 'staff') expect(cast.some((p) => p.component === 'sigil' && p.anchor.along === Math.round(sh.range)), r.key).toBe(true);
          if (style === 'fist') expect(cast.some((p) => p.component === 'burst' && p.params.cls === 'ki' && p.anchor.along === Math.round(sh.range * 0.8)), r.key).toBe(true);
          if (style === 'cone') expect(rings(cast).some((p) => p.params.r === sh.range && p.params.arc && p.params.arc[1] - p.params.arc[0] === 2 * Math.round(sh.arc / 2)), r.key).toBe(true);
          if (owner === 'monster') expect(rings(ofPhase(r, 'telegraph')).some((p) => p.params.r === sh.range && !!p.params.arc), r.key).toBe(true);
          // A monster strike reaches range + its own radius: the smear takes its reach from the event (the cone).
          if (owner === 'monster') for (const p of cast) if (p.component === 'slash' || p.component === 'thrust') expect(p.tags ?? [], r.key).toContain('geometryFromEvent');
        }
        if (sh.kind === 'spin') {
          const R = sh.radius;
          const rs = rings(cast).filter((p) => p.params.ink !== 'dim');
          expect(rs.some((p) => p.params.r === R || p.params.r0 === R), r.key).toBe(true);
          for (const p of rs) expect(Math.max(p.params.r, p.params.r0 ?? 0), r.key).toBeLessThanOrEqual(R);
          for (const p of rs) expect(p.params.aspect, r.key).toBe(owner === 'monster' ? 0.65 : 1);
          if (owner === 'monster') for (const p of rs) expect(p.tags ?? [], r.key).toContain('geometryFromEvent');
        }
        if (sh.kind === 'nova') {
          const R = sh.radius;
          const area = ofPhase(r, 'area');
          expect(rings(area).some((p) => p.params.r === R || (p.params.anim === 'contract' && p.params.r0 === R)), r.key).toBe(true);
          for (const p of rings(area)) if (p.params.ink !== 'dim') expect(Math.max(p.params.r, p.params.r0 ?? 0), r.key).toBeLessThanOrEqual(R);
          for (const p of area) if (p.component === 'decal' && p.params.shape === 'disc') expect(p.params.r, r.key).toBeLessThanOrEqual(Math.max(16, R));
          // Aftermath marks the core only (atlas budget); the rim, rings and units carry the true radius.
          for (const p of area) if (p.component === 'decal' && p.layer === 'ground') expect(p.params.r, r.key).toBeLessThanOrEqual(AFTERMATH_MAX_R);
          for (const p of area) if (p.component === 'erupt' && p.place?.radius !== undefined && p.place.pattern !== 'line') expect(p.place.radius, r.key).toBeLessThanOrEqual(R);
          const tellRim = rings(ofPhase(r, 'telegraph')).filter((p) => p.params.r === R);
          expect(tellRim.length, r.key).toBeGreaterThan(0);
          for (const p of tellRim) expect(p.params.aspect).toBe(owner === 'monster' ? 0.65 : 1);
        }
        if (sh.kind === 'projectile') {
          const body = ofPhase(r, 'body').find((p) => p.component === 'orb' || p.component === 'missile')!;
          const up = owner === 'monster' && !s.tags.includes('echo') ? 1 : 0;
          const cell = body.component === 'orb' || body.component === 'missile' ? body.params.cell : 0;
          expect(cell, r.key).toBeGreaterThanOrEqual(cellFor(sh.size ?? 12, up));
          if (!r.signature) expect(cell, r.key).toBe(cellFor(sh.size ?? 12, up));
        }
        if (sh.kind === 'dash') {
          const lines = ofPhase(r, 'trail').filter((p) => p.place?.pattern === 'line');
          for (const p of lines) expect(p.place?.radius, r.key).toBe(sh.distance);
          if (owner === 'monster') expect(ofPhase(r, 'telegraph').some((p) => p.component === 'tell' && p.params.piece === 'arrow' && p.anchor.along === sh.distance), r.key).toBe(true);
        }
        if (sh.kind === 'chain') {
          for (const p of ofPhase(r, 'body')) if (p.component === 'bolt') expect(Math.hypot(p.params.dx, p.params.dy), r.key).toBeLessThanOrEqual(Math.min(sh.range, VFX_BUDGET.boltMaxLen));
          if (owner === 'monster') expect(rings(ofPhase(r, 'telegraph')).some((p) => p.params.r === sh.range && p.params.aspect === 1), r.key).toBe(true);
        }
      }
    }
  });

  it('timings fit the real cast, telegraph, cooldown, status and buff windows', () => {
    const weaponDelay = (s: SkillDef): number => Math.min(...(s.weapons ?? (Object.keys(WEAPONS) as (keyof typeof WEAPONS)[])).map((w) => WEAPONS[w].delay));
    const techCd = new Map<string, number>();
    for (const m of GAME_DATA.monsters) for (const t of m.techniques ?? []) techCd.set(t.skill, Math.min(techCd.get(t.skill) ?? Infinity, t.cooldown));
    const bad: string[] = [];
    const check = (ok: boolean, what: string) => {
      if (!ok) bad.push(what);
    };
    for (const owner of ['player', 'monster'] as const) {
      for (const s of owner === 'player' ? ALL_PLAYER : TECHNIQUES) {
        const r = deriveVfx(s, owner);
        const castMs = s.castMs ?? 0;
        const charge = ofPhase(r, 'charge');
        const window = owner === 'player' ? s.cooldown || weaponDelay(s) : (techCd.get(s.id) ?? s.cooldown);
        if (owner === 'player') {
          check(castMs > 0 ? charge.length > 0 : charge.length === 0, `${r.key} charge presence`);
          for (const p of charge) check(pieceEndMs(p) <= castMs, `${r.key} charge ${p.component} ends ${pieceEndMs(p)} > cast ${castMs}`);
          if (castMs > 0) check(charge.some((p) => p.lifeMs === castMs), `${r.key} no charge piece spans the wind-up`);
          if (s.shape.kind === 'nova') {
            const delay = s.shape.delay ?? GROUND_TRUTH.novaDelayMs;
            for (const p of ofPhase(r, 'telegraph')) check(pieceEndMs(p) <= delay, `${r.key} telegraph ${p.component} ends after the blast`);
            check(ofPhase(r, 'telegraph').some((p) => p.component === 'ring' && p.lifeMs === delay), `${r.key} nova rim does not span the delay`);
          }
        } else {
          const T = monsterTellMs(s);
          const tell = ofPhase(r, 'telegraph');
          check(tell.length > 0, `${r.key} no telegraph`);
          for (const p of [...tell, ...charge]) check(pieceEndMs(p) <= T, `${r.key} tell ${p.component} ends ${pieceEndMs(p)} > ${T}`);
          check(tell.some((p) => p.lifeMs === T && (p.tags ?? []).includes('neverGoverned')), `${r.key} no tell spans the window`);
        }
        for (const ph of ['cast', 'impact', 'area'] as const) {
          for (const p of ofPhase(r, ph)) check(pieceEndMs(p) <= window, `${r.key} ${ph} ${p.component} ends ${pieceEndMs(p)} > window ${window}`);
        }
        // Swings / pulses are their own events: cast pieces start before the next one (130 / 170 ms player).
        if (owner === 'player' && (s.shape.kind === 'strike' || s.shape.kind === 'spin')) {
          for (const p of ofPhase(r, 'cast')) check((p.delayMs ?? 0) < GROUND_TRUTH.swingMs.player, `${r.key} cast delay ${p.delayMs}`);
        }
        if (s.shape.kind === 'buff') {
          const loop = ofPhase(r, 'aura').find((p) => p.component === 'aura' && p.params.phase === 'loop');
          const brk = ofPhase(r, 'aura').find((p) => p.component === 'aura' && p.params.phase === 'break');
          check(loop?.lifeMs === s.shape.duration && brk?.delayMs === s.shape.duration, `${r.key} aura loop/break vs duration`);
        }
        for (const p of ofPhase(r, 'status')) {
          if (p.component === 'status' && p.params.kind !== 'smite' && p.params.kind !== 'knockback' && p.params.kind !== 'pull' && p.params.unit !== 'splash') {
            check(p.lifeMs === GROUND_TRUTH.statusMs[p.params.kind], `${r.key} status ${p.params.kind} life ${p.lifeMs}`);
          }
        }
        for (const p of recipePieces(r)) check(Number.isFinite(nominalMs(p)) && nominalMs(p) > 0, `${r.key} nominal ${p.component}`);
      }
    }
    expect(bad.slice(0, 25)).toEqual([]);
  });

  it('monster telegraphs match the shape (zone / cone / lane / aim / range / aura) and are never governed', () => {
    for (const s of TECHNIQUES) {
      const r = deriveVfx(s, 'monster');
      const tell = ofPhase(r, 'telegraph');
      for (const p of tell) if (p.layer === 'tell' || p.layer === 'rim') expect(p.tags ?? []).toContain('neverGoverned');
      const k = s.shape.kind;
      const marching = rings(tell).filter((p) => p.params.style === 'dashed' && p.params.anim === 'march');
      if (k === 'nova' || k === 'spin') {
        expect(marching.some((p) => p.params.aspect === 0.65), s.id).toBe(true);
        expect(tell.some((p) => p.component === 'decal' && p.ramp === 'danger'), s.id).toBe(true);
      }
      if (k === 'strike') expect(marching.some((p) => !!p.params.arc), s.id).toBe(true);
      if (k === 'dash') expect(['chevron', 'arrow', 'bead'].every((t) => tell.some((p) => p.component === 'tell' && p.params.piece === t)), s.id).toBe(true);
      if (k === 'projectile') expect(tell.some((p) => p.component === 'tell' && p.params.piece === 'bead') && tell.some((p) => p.component === 'orb' && p.params.mode === 'charge'), s.id).toBe(true);
      if (k === 'chain') expect(marching.some((p) => p.params.aspect === 1), s.id).toBe(true);
      expect(tell.some((p) => p.component === 'tell' && p.params.piece === 'edge'), s.id).toBe(true);
      expect(r.quota).toBe(0.5);
      for (const p of recipePieces(r)) if (p.ramp !== 'danger') expect(p.lut, s.id).toBe('monster');
      expect(r.juice.flash).not.toBe('screen');
    }
  });

  it('echo techniques keep one silhouette for both owners', () => {
    for (const s of TECHNIQUES.filter((t) => t.tags.includes('echo'))) {
      // Same pieces and params; only the LUT, the tells, the quota and the hit-test aspect (0.65 zones) differ.
      const strip = (r: VfxRecipe) =>
        (r.phases.body ?? r.phases.cast ?? []).filter((p) => !isEcho(p)).map((p) => ({ component: p.component, params: { ...p.params, aspect: undefined } }));
      expect(strip(deriveVfx(s, 'monster')), s.id).toEqual(strip(deriveVfx(s, 'player')));
      expect(deriveVfx(s, 'monster').carrier, s.id).toEqual(deriveVfx(s, 'player').carrier);
    }
  });
});

describe('vfx recipes: variants', () => {
  const CARRIER_COMPONENTS = new Set(['slash', 'thrust', 'orb', 'missile', 'bolt', 'ring', 'nova', 'sigil', 'aura', 'afterimage']);
  /** Geometry of the carrier pieces (palette and tier stripped). */
  const silhouette = (r: VfxRecipe): string[] =>
    (['cast', 'body', 'area'] as const)
      .flatMap((ph) => ofPhase(r, ph).filter((p) => CARRIER_COMPONENTS.has(p.component) && !isEcho(p)).map((p) => [ph, p] as const))
      .map(([ph, p]) => {
        const { tier: _t, ...params } = p.params as unknown as Record<string, unknown>;
        void _t;
        return JSON.stringify({ ph, component: p.component, params, anchor: p.anchor, layer: p.layer, place: p.place, delayMs: p.delayMs, lifeMs: p.lifeMs });
      })
      .sort();
  const carrierKey = (c: Carrier) => JSON.stringify(c.kind === 'nova' ? { ...c, unit: null } : c);

  it('an element infusion only repaints: same carrier and carrier geometry, family = element or imbue', () => {
    for (const [root, v] of INFUSIONS) {
      const a = deriveVfx(root);
      const b = deriveVfx(v);
      expect(carrierKey(b.carrier), v.id).toBe(carrierKey(a.carrier));
      expect(silhouette(b), v.id).toEqual(silhouette(a));
      expect(b.geometry, v.id).toEqual(a.geometry);
      expect(b.rootId).toBe(root.id);
      if (b.imbue) {
        expect(b.family, v.id).toBe(a.family);
        expect(b.imbue, v.id).toBe(v.element);
      } else expect(b.family, v.id).toBe(v.element);
      // The element arrives as overlays: some piece wears the element ramp.
      expect(recipePieces(b).some((p) => p.ramp === v.element), v.id).toBe(true);
      expect(b.tier).toBeGreaterThanOrEqual(a.tier);
    }
  });

  it('essence variants keep the root carrier; geometry follows the composed shape', () => {
    for (const [root, v] of ESSENCE_VARIANTS) {
      const a = deriveVfx(root);
      const b = deriveVfx(v);
      const kindOk = carrierKey(b.carrier) === carrierKey(a.carrier) || (b.carrier.kind === 'dash' && b.carrier.mode === 'spin');
      expect(kindOk, v.id).toBe(true);
      expect(b.geometry, v.id).toEqual(hitGeometry(v, 'player'));
      expect(b.family).toBe(a.family);
      const mods = v.essences ?? [];
      if (mods.includes('split')) expect(ofPhase(b, 'cast').some((p) => p.component === 'burst' && p.params.cls === 'split'), v.id).toBe(true);
      if (mods.includes('return')) expect(b.riders.returns, v.id).toBeTruthy();
      if (mods.includes('reprise')) expect(b.riders.reprise, v.id).toBeTruthy();
      if (mods.includes('leech')) expect(b.riders.leech, v.id).toBeTruthy();
      if (mods.includes('pierce')) expect(b.riders.pierce, v.id).toBeTruthy();
      if (mods.includes('arc') && v.shape.kind !== 'chain') expect(b.riders.arc, v.id).toBeTruthy();
      // The heavy essence's knockback arrives as a status (statusApplied), drawn once by the status phase.
      if (mods.includes('heavy') && v.power > 0) {
        expect(['normal', 'heavy', 'ultimate'].includes(b.weight), v.id).toBe(true);
        expect(ofPhase(b, 'status').some((p) => p.component === 'status' && p.params.kind === 'knockback'), v.id).toBe(true);
      }
      expect(b.riders.knockback, v.id).toBeUndefined();
      if (mods.includes('haste')) expect(ofPhase(b, 'cast').some((p) => p.component === 'motes' && p.params.kind === 'line'), v.id).toBe(true);
      if (mods.includes('expanse') && v.shape.kind !== 'strike') expect(recipePieces(b).some((p) => p.component === 'ring' && p.params.ink === 'dim'), v.id).toBe(true);
      if (v.shape.kind === 'strike') {
        const sl = ofPhase(b, 'cast').find((p) => p.component === 'slash');
        if (sl && sl.component === 'slash' && b.carrier.kind === 'strike' && b.carrier.style === 'crescent') {
          expect(sl.params.r, v.id).toBe(reachBucket(v.shape.range));
          expect(sl.params.arc, v.id).toBe(arcBucket(v.shape.arc));
        }
      }
    }
  });

  it('every legal merge derives with the primary parent carrier and an echo accent', () => {
    expect(MERGES.length).toBeGreaterThan(1000);
    for (const [m, primary, secondary] of MERGES) {
      const r = deriveVfx(m);
      const p = deriveVfx(primary);
      expect(r.rootId, m.id).toBe(primary.id);
      const same = carrierKey(r.carrier) === carrierKey(p.carrier) || r.riders.merge?.accent === 'spinDash';
      expect(same, `${m.id} ${JSON.stringify(r.carrier)} vs ${JSON.stringify(p.carrier)}`).toBe(true);
      expect(r.riders.merge, m.id).toBeTruthy();
      const echo = families.familyOf(secondary);
      if (echo !== r.family) expect(r.echo, m.id).toBe(echo);
      else expect(r.echo, m.id).toBeUndefined();
      for (const piece of r.riders.merge!.pieces) expect(piece.tags ?? [], m.id).toContain('echo');
    }
    for (const v of MERGE_VARIANTS) expect(problems(deriveVfx(v)), v.id).toEqual([]);
  });

  it('draws each merge accent once, in the echo family, on the finished (signature-patched) carrier', () => {
    const bad: string[] = [];
    for (const [m] of MERGES) {
      const r = deriveVfx(m);
      const mg = r.riders.merge!;
      const echo = r.echo;
      if (mg.accent === 'extra') {
        // The extra hit repeats what the player sees, after any signature swapped the body or the rings.
        const main = (r.carrier.kind === 'projectile' || r.carrier.kind === 'chain' ? ofPhase(r, 'body') : ofPhase(r, 'cast')).find((p) => !isEcho(p));
        const ex = mg.pieces[0];
        if (!main || !ex || ex.component !== main.component || JSON.stringify(ex.params) !== JSON.stringify(main.params)) bad.push(`${m.id} extra != carrier`);
      }
      if (mg.accent !== 'extra' && mg.accent !== 'radial' && mg.pieces.length) bad.push(`${m.id} ${mg.accent} has duplicate accent pieces`);
      if (mg.accent === 'arc' && echo && !r.riders.arc?.zap.every((p) => p.ramp === echo && isEcho(p))) bad.push(`${m.id} arc zap not echo`);
      if (mg.accent === 'knockback' && echo && !ofPhase(r, 'status').some((p) => p.component === 'status' && p.params.kind === 'knockback' && p.ramp === echo)) bad.push(`${m.id} knockback not echo`);
      if (mg.accent === 'spinDash') {
        const bands = ofPhase(r, 'area').filter((p) => p.component === 'ring' && p.params.anim === 'sweep');
        if (bands.length !== 1 || (echo && bands[0].ramp !== echo)) bad.push(`${m.id} spin band ${bands.length}`);
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
  });
});

describe('vfx recipes: signatures', () => {
  it('has 40 signatures keyed by authored root ids, each applied to its root and inherited by variants', () => {
    const ids = Object.keys(SIGNATURES);
    expect(ids).toHaveLength(40);
    for (const id of ids) {
      expect(SIGNATURES[id].id).toBe(id);
      expect(reg.isAuthored(id), id).toBe(true);
      expect(reg.skill(id)!.generated, id).toBeFalsy();
      const s = reg.skill(id)!;
      const owner: VfxOwner = isMonsterOnly(s) ? 'monster' : 'player';
      const r = deriveVfx(s, owner);
      expect(r.signature, id).toBe(id);
      expect(problems(r), id).toEqual([]);
      if (canTakeElement(s)) expect(deriveVfx(reg.skill(variantId(id, 'ice'))!).signature, id).toBe(id);
    }
  });

  it('applies the bespoke shapes the doc lists', () => {
    const r = (id: string, owner: VfxOwner = 'player') => deriveVfx(reg.skill(id)!, owner);
    expect(r('glacial_orb').carrier).toEqual({ kind: 'projectile', body: 'orb', matter: false });
    expect(ofPhase(r('glacial_orb'), 'body')[0]).toMatchObject({ component: 'orb', params: { orbit: 'shards', cell: 48 } });
    expect(r('aqua_lance').carrier).toMatchObject({ body: 'lance' });
    expect(r('featherstorm').carrier).toMatchObject({ body: 'feather', matter: true });
    expect(r('spirit_crescent').family).toBe('spirit');
    expect(r('spirit_crescent').carrier).toMatchObject({ body: 'wave' });
    expect(r('boulder_roll').carrier).toEqual({ kind: 'dash', mode: 'roll' });
    expect(r('gloom_shroud').carrier).toMatchObject({ core: 'cloud', unit: 'smoke-sheet' });
    expect(r('jelly_slam').family).toBe('water');
    expect(r('worldbreaker').juice.trauma).toBe(0.3);
    expect(r('tremor_stomp', 'monster').juice.trauma).toBe(0.5);
    expect(rings(ofPhase(r('tornado'), 'cast')).filter((p) => p.params.anim === 'sweep').map((p) => p.anchor.dy)).toEqual([0, -12, -24]);
    const bolts = ofPhase(r('thunderstorm'), 'area').filter((p) => p.component === 'erupt');
    expect(bolts.map((p) => p.delayMs)).toEqual([0, 117, 233]);
    expect(bolts.filter((p) => (p.tags ?? []).includes('hero'))).toHaveLength(1);
    expect(ofPhase(r('meteor'), 'telegraph').some((p) => p.component === 'missile' && p.move?.from.y === -160)).toBe(true);
  });
});

describe('vfx recipes: selectors', () => {
  const slash = deriveVfx(reg.skill('slash')!);
  const fire = deriveVfx(reg.skill('firebolt')!);
  const hit = { index: 0, sincePrevMs: 1e9, crit: false, relation: 'neutral' as const, killed: false, target: 'monster' as const };

  it('picks impact variants: tick, crit, strong, weak, immune, resist and hits on the player', () => {
    expect(impactPieces(slash, { ...hit, index: 1, sincePrevMs: 60 })).toMatchObject([{ component: 'burst', params: { cls: 'tick' } }]);
    expect(impactPieces(slash, { ...hit, crit: true }).some((p) => p.component === 'burst' && p.params.cls === 'crit')).toBe(true);
    const strong = impactPieces(fire, { ...hit, relation: 'strong' }).find((p) => p.component === 'burst' && p.params.cls === 'strong');
    expect(strong && strong.component === 'burst' && strong.params.glyph).toBe('fire');
    expect(impactPieces(slash, { ...hit, relation: 'weak' }).some((p) => p.lut === 'shift')).toBe(true);
    expect(impactPieces(slash, { ...hit, relation: 'immune' })).toMatchObject([{ params: { cls: 'immune' } }]);
    expect(impactPieces(slash, { ...hit, relation: 'same' }).some((p) => p.component === 'burst' && p.params.cls === 'resist')).toBe(true);
    const mon = deriveVfx(reg.skill('mon_ember_spit')!, 'monster');
    expect(impactPieces(mon, { ...hit, target: 'player' })).toMatchObject([{ ramp: 'danger', params: { cls: 'blunt', size: 's' } }]);
    for (const s of PLAYER_SKILLS.slice(0, 60)) {
      const r = deriveVfx(s);
      for (const h of [hit, { ...hit, crit: true }, { ...hit, relation: 'strong' as const }, { ...hit, relation: 'weak' as const }]) {
        for (const p of impactPieces(r, h)) expect(pieceProblems(p, 'player'), s.id).toEqual([]);
      }
    }
  });

  it('builds valid status, combo, death and extra pieces', () => {
    const kinds: StatusKind[] = ['burn', 'slow', 'soak', 'stun', 'knockback', 'shock', 'bleed', 'smite', 'freeze', 'poison', 'pull'];
    for (const owner of ['player', 'monster'] as const) {
      for (const k of kinds) {
        for (const body of ['S', 'M', 'L', 'W'] as const) {
          for (const src of ['fire', 'magma', 'shadow', 'steel', 'storm'] as const) {
            const ps = statusPieces(k, src, body, owner);
            expect(ps.length, k).toBeGreaterThan(0);
            for (const p of ps) expect(pieceProblems(p, owner), `${k} ${body} ${src}`).toEqual([]);
          }
        }
      }
      for (const body of ['S', 'M', 'L', 'W'] as const) {
        for (const p of recipeApi.deathPieces(body, 'fire', owner)) expect(pieceProblems(p, owner === 'player' ? 'monster' : 'player')).toEqual([]);
      }
    }
    for (const combo of ['shatter', 'conduct', 'fan'] as const) for (const p of recipeApi.comboPieces(combo, 'M')) expect(pieceProblems(p, 'player'), combo).toEqual([]);
    for (const e of ['spark', 'levelUp'] as const) for (const p of recipeApi.extraPieces(e)) expect(pieceProblems(p, 'player'), e).toEqual([]);
    for (const p of recipeApi.extraPieces('enrage')) expect(pieceProblems(p, 'monster')).toEqual([]);
    expect(statusPieces('burn', 'magma', 'M', 'player')[0].ramp).toBe('magma');
    expect(statusPieces('stun', 'earth', 'M', 'player')[0].ramp).toBe('holy');
  });

  it('auto-attacks follow the monster family', () => {
    for (const m of GAME_DATA.monsters) {
      const r = deriveAttackVfx({ id: m.id, family: m.family, element: m.element, rank: m.rank, size: m.size });
      const c = ofPhase(r, 'cast')[0];
      if (m.family === 'beast' || m.family === 'fiend' || m.family === 'wyrm') expect(c).toMatchObject({ component: 'slash', params: { rakes: 3 } });
      if (m.family === 'sylvan' || m.family === 'swarm') expect(c.component).toBe('thrust');
      if (m.family === 'construct') expect(c).toMatchObject({ component: 'burst', params: { cls: 'blunt', size: 'l' } });
      if (m.family === 'sprite') expect(c).toMatchObject({ component: 'burst', params: { cls: 'magic' } });
      expect(r.family).toBe(m.element ?? 'steel');
      expect(r.geometry).toMatchObject({ kind: 'sector', r: m.attackRange + 8 });
      expect(problems(r), m.id).toEqual([]);
    }
  });

  it('familyOf follows Combat.colorFor precedence', () => {
    expect(families.familyOf(reg.skill('slash')!)).toBe('steel');
    expect(families.familyOf(reg.skill('bolt')!)).toBe('arcane');
    expect(families.familyOf(reg.skill('hex_blade')!)).toBe('arcane');
    expect(families.familyOf(reg.skill('shadowstep')!)).toBe('stealth');
    expect(families.familyOf(reg.skill('venom_edge')!)).toBe('toxin');
    expect(families.familyOf(reg.skill('palm_strike')!)).toBe('spirit');
    expect(families.familyOf(reg.skill('firebolt')!)).toBe('fire');
    for (const s of AUTHORED) expect(families.familyOf(s)).not.toBe('danger');
    expect(recipeApi.familyOf).toBe(families.familyOf);
  });

  it('phase ids are the contract phases', () => {
    for (const s of AUTHORED.slice(0, 40)) for (const k of Object.keys(deriveVfx(s).phases)) expect(PHASE_IDS).toContain(k);
  });
});
