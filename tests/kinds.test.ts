// The four skill kinds and four statuses of SPEC-v4 Phase 1 (§6.1): zone, blink, mend, shield; root, launch,
// expose, lure. Hits for the clamp, what Runes / elements / merges they take, the ±35% damage-per-SP band,
// signatures (§6.2) and how the statuses change a hit.
import { describe, expect, it } from 'vitest';
import { STATUS, computeDamage, exposedPct, statusControl, statusFor, statusMs } from '../src/core/combat';
import {
  ESSENCE_BUDGET_BAND,
  MAX_HITS,
  SUPPORT_KINDS,
  ZONE_MAX_HITS,
  budgetDamage,
  canApplyEssence,
  canTakeElement,
  compose,
  defaultDelivery,
  legalEssenceSet,
  mergeBlocker,
  mergeSkills,
  potentialHits,
  shapeHits,
  signatureKey,
  skillSignature,
} from '../src/core/compose';
import { essenceSlots, resolveFusion, type FusionContext } from '../src/core/fusion';
import { Registry } from '../src/core/registry';
import {
  DELIVERIES,
  LEGACY_SHAPE_KINDS,
  NEW_SHAPE_KINDS,
  NEW_STATUSES,
  SHAPE_KINDS,
  type ElementDef,
  type EssenceDef,
  type GameData,
  type SkillDef,
  type SkillShape,
} from '../src/core/types';

const sk = (s: Pick<SkillDef, 'id' | 'shape'> & Partial<SkillDef>): SkillDef => ({
  name: s.id,
  desc: `${s.id}.`,
  icon: 'i',
  tier: 1,
  tags: ['arcane'],
  power: 1,
  spCost: 10,
  cooldown: 4000,
  maxRank: 8,
  ...s,
});

const ZONE: SkillShape = { kind: 'zone', radius: 60, range: 160, durationMs: 4000, tickMs: 1000 };
const SCORED_GROUND = sk({ id: 'scored_ground', tags: ['blade', 'aoe'], weapons: ['sword'], shape: { ...ZONE, line: { length: 120 } }, power: 0.4, status: 'bleed' });
const FROST_GARDEN = sk({ id: 'frost_garden', element: 'fire', shape: { ...ZONE, range: 0 }, power: 0.3 });
const STATIC_FIELD = sk({ id: 'static_field', shape: { ...ZONE, range: 0, follow: true, durationMs: 5000 }, power: 0.3 });
const RIFT_STRIDE = sk({ id: 'rift_stride', tags: ['rod', 'arcane'], weapons: ['staff'], shape: { kind: 'blink', distance: 160, to: 'point', arrive: { radius: 50 } }, power: 0.8, status: 'knockback' });
const BACKTRACK = sk({ id: 'backtrack', tags: ['pierce'], weapons: ['dagger'], shape: { kind: 'blink', distance: 120, to: 'self' }, power: 0 });
const SECOND_WIND = sk({ id: 'second_wind', tags: ['fist'], weapons: ['fists'], shape: { kind: 'mend', pct: 20, overMs: 4000 }, power: 0 });
const GUARD_UP = sk({ id: 'guard_up', tags: ['fist'], weapons: ['fists'], shape: { kind: 'shield', pct: 15, durationMs: 5000 }, power: 0 });
const PARRYING_WALL = sk({ id: 'parrying_wall', tags: ['blade'], weapons: ['sword'], shape: { kind: 'shield', pct: 12, durationMs: 4000, burst: { radius: 60 } }, power: 0.9, status: 'knockback' });
const WHIRLWIND = sk({ id: 'whirlwind', tags: ['blade', 'spin', 'aoe'], weapons: ['sword'], shape: { kind: 'spin', radius: 70, pulses: 3 } });
const CLASS_CUT = sk({ id: 'bellows_cut', tags: ['blade'], weapons: ['sword'], shape: { kind: 'strike', range: 50, arc: 100 }, classOf: 'pyroblade' });

const ess = (e: Pick<EssenceDef, 'id' | 'category' | 'appliesTo'> & Partial<EssenceDef>): EssenceDef => ({
  name: e.id,
  icon: e.id,
  desc: e.id,
  affix: { text: e.id, pos: 'prefix' },
  powerMul: 1,
  spMul: 1,
  mod: {},
  ...e,
});
/** The Runes §6.1 names for a zone: expanse, haste, leech (and reprise, to push the hit clamp). */
const EXPANSE = ess({ id: 'expanse', category: 'area', appliesTo: ['spin', 'nova', 'strike', 'zone'], powerMul: 0.85, spMul: 1.25, mod: { radiusMul: 1.35, rangeMul: 1.2 } });
const HASTE = ess({ id: 'haste', category: 'tempo', appliesTo: ['strike', 'spin', 'zone'], powerMul: 0.8, spMul: 1.2, cdMul: 0.7 });
const LEECH = ess({ id: 'leech', category: 'sustain', appliesTo: ['strike', 'zone'], powerMul: 0.9, spMul: 1.2, mod: { leech: 0.05 } });
const REPRISE = ess({ id: 'reprise', category: 'repeat', appliesTo: ['strike', 'zone'], spMul: 1.4, mod: { reprise: { delayMs: 400, mult: 0.5 } } });
const ESSENCES = [EXPANSE, HASTE, LEECH, REPRISE];

const FIRE: ElementDef = { id: 'fire', name: 'Fire', prefix: 'Blazing', icon: 'f', color: 0, tier: 0, desc: '', status: 'burn', strongVs: [] };
const DATA: GameData = {
  dataVersion: 2,
  elements: [FIRE],
  skills: [SCORED_GROUND, FROST_GARDEN, STATIC_FIELD, RIFT_STRIDE, BACKTRACK, SECOND_WIND, GUARD_UP, PARRYING_WALL, WHIRLWIND, CLASS_CUT],
  morphs: [],
  recipes: [],
  classes: [],
  essences: ESSENCES,
  passives: [],
  trainers: [],
  monsters: [],
  items: [],
};
const reg = new Registry(DATA);

describe('the kinds', () => {
  it('are the seven v2 kinds plus zone, blink, mend and shield', () => {
    expect(LEGACY_SHAPE_KINDS).toEqual(['strike', 'spin', 'projectile', 'dash', 'nova', 'chain', 'buff']);
    expect(NEW_SHAPE_KINDS).toEqual(['zone', 'blink', 'mend', 'shield']);
    expect(SHAPE_KINDS).toEqual([...LEGACY_SHAPE_KINDS, ...NEW_SHAPE_KINDS]);
    expect(SUPPORT_KINDS).toEqual(['buff', 'blink', 'mend', 'shield']);
  });

  it('the fixture validates, and bad shape numbers are reported', () => {
    // The one class skill of the fixture has no class to belong to: reported, nothing else is.
    expect(reg.validate({ grip: true })).toEqual(['skill bellows_cut: unknown classOf pyroblade']);
    const bad = new Registry({
      ...DATA,
      skills: [
        sk({ id: 'z', shape: { ...ZONE, tickMs: 0 } }),
        sk({ id: 'b', shape: { kind: 'blink', distance: 0, to: 'point' } }),
        sk({ id: 'm', shape: { kind: 'mend', pct: 0 }, power: 0 }),
        sk({ id: 's', shape: { kind: 'shield', pct: 10, durationMs: 0 } }),
        sk({ id: 'd', shape: ZONE, delivery: 'sideways' as never, hpCost: 120, classOf: 'nobody' }),
      ],
    });
    expect(bad.validate()).toEqual([
      'skill z: zone tickMs must be > 0',
      'skill b: blink distance must be > 0',
      'skill b: a blink with power needs arrive',
      'skill m: mend pct must be > 0',
      'skill s: shield durationMs must be > 0',
      'skill s: a shield with power needs burst',
      'skill d: unknown delivery sideways',
      'skill d: unknown classOf nobody',
      'skill d: hpCost must be between 0 and 100',
    ]);
  });
});

describe('hits for the clamp (§6.1)', () => {
  it('zone: duration ÷ tick, at most 8; blink: its arrival; mend: none; shield: its burst', () => {
    expect(ZONE_MAX_HITS).toBe(8);
    expect(shapeHits(ZONE)).toBe(4);
    expect(shapeHits({ ...ZONE, durationMs: 60_000 })).toBe(8);
    expect(shapeHits({ ...ZONE, durationMs: 500 })).toBe(1);
    expect(shapeHits(RIFT_STRIDE.shape)).toBe(1);
    expect(shapeHits(BACKTRACK.shape)).toBe(0);
    expect(shapeHits(SECOND_WIND.shape)).toBe(0);
    expect(shapeHits(GUARD_UP.shape)).toBe(0);
    expect(shapeHits(PARRYING_WALL.shape)).toBe(1);
    for (const s of DATA.skills) expect(potentialHits(s), s.id).toBeLessThanOrEqual(MAX_HITS);
  });

  it('a Rune that doubles a long zone is clamped to 12 hits by shortening it, and power is renormalized inside the band', () => {
    const long = sk({ id: 'long_zone', shape: { ...ZONE, durationMs: 8000 }, power: 0.4 });
    const doubled = compose(long, undefined, [REPRISE]);
    expect(potentialHits(doubled)).toBeLessThanOrEqual(MAX_HITS);
    expect(doubled.shape).toMatchObject({ kind: 'zone', durationMs: 6000, tickMs: 1000 });
    expect(doubled.power).toBeGreaterThanOrEqual(long.power);
  });
});

describe('Runes, elements and merges', () => {
  it('a zone takes the Runes that list it; expanse widens it', () => {
    for (const e of [EXPANSE, HASTE, LEECH]) expect(legalEssenceSet(SCORED_GROUND, [e]), e.id).toBe(true);
    const wide = reg.skill('scored_ground~expanse')!;
    expect(wide.shape).toMatchObject({ kind: 'zone', radius: 81, range: 192, line: { length: 144 } });
    expect(reg.skill('scored_ground~haste')!.cooldown).toBe(2800);
    expect(reg.skill('scored_ground~leech')!.riders).toEqual({ leech: 0.05 });
    expect(essenceSlots(SCORED_GROUND, 0)).toBe(1);
  });

  it('blink, mend and shield take no Rune at all, like buffs', () => {
    const any = ess({ id: 'any', category: 'tempo', appliesTo: [...SHAPE_KINDS] });
    for (const s of [RIFT_STRIDE, BACKTRACK, SECOND_WIND, GUARD_UP, PARRYING_WALL]) {
      expect(legalEssenceSet(s, [any]), s.id).toBe(false);
      expect(canApplyEssence(s, any, 2)).toMatchObject({ ok: false, reason: 'buff' });
      expect(essenceSlots(s, 9), s.id).toBe(0);
      expect(reg.skill(`${s.id}~haste`), s.id).toBeUndefined();
    }
  });

  it('only an unaligned zone with power takes an element; support kinds never do', () => {
    expect(canTakeElement(SCORED_GROUND)).toBe(true);
    expect(reg.skill('scored_ground@fire')).toMatchObject({ element: 'fire', shape: { kind: 'zone' } });
    expect(canTakeElement(FROST_GARDEN)).toBe(false); // already aligned
    for (const s of [RIFT_STRIDE, SECOND_WIND, GUARD_UP, PARRYING_WALL]) expect(canTakeElement(s), s.id).toBe(false);
  });

  it('the new kinds never shape-merge', () => {
    for (const s of [SCORED_GROUND, RIFT_STRIDE, SECOND_WIND, PARRYING_WALL]) {
      expect(mergeBlocker(WHIRLWIND, s), s.id).toBe(`${s.name} cannot be shape-merged.`);
      expect(mergeSkills(s, WHIRLWIND)).toBeNull();
    }
  });

  it('a class skill is never a fusion ingredient: no Rune, no element, no merge', () => {
    const any = ess({ id: 'any', category: 'tempo', appliesTo: [...SHAPE_KINDS] });
    expect(legalEssenceSet(CLASS_CUT, [any])).toBe(false);
    expect(canApplyEssence(CLASS_CUT, any, 2)).toMatchObject({ ok: false, message: 'bellows_cut is a class skill and takes no Rune.' });
    expect(canTakeElement(CLASS_CUT)).toBe(false);
    expect(mergeBlocker(CLASS_CUT, WHIRLWIND)).toBe('bellows_cut is a class skill and cannot be fused.');
    expect(essenceSlots(CLASS_CUT, 9)).toBe(0);
    const ctx: FusionContext = { has: () => true, rank: () => 10, hasElement: () => true, essenceCount: () => 5, overBars: () => 9, meets: () => true };
    for (const other of ['el:fire', 'mod:haste', 'skill:whirlwind']) {
      expect(resolveFusion(reg, ctx, 'skill:bellows_cut', other)).toMatchObject({ ok: false, reason: 'bound' });
    }
    expect(resolveFusion(reg, ctx, 'skill:whirlwind', 'el:fire')).toMatchObject({ ok: true });
  });
});

describe('budget: every zone × fitting Rune stays within ±35% damage per SP', () => {
  const zones = [SCORED_GROUND, STATIC_FIELD, sk({ id: 'long_zone', shape: { ...ZONE, durationMs: 9000 }, power: 0.35 })];
  for (const base of zones) {
    for (const e of ESSENCES) {
      it(`${base.id} + ${e.id}`, () => {
        expect(legalEssenceSet(base, [e])).toBe(true);
        const variant = compose(base, undefined, [e]);
        expect(potentialHits(variant)).toBeLessThanOrEqual(MAX_HITS);
        const multiply = e.category === 'multiply';
        const ratio = budgetDamage(variant, multiply) / variant.spCost / (budgetDamage(base, multiply) / base.spCost);
        expect(ratio).toBeLessThanOrEqual(1 + ESSENCE_BUDGET_BAND + 1e-9);
        expect(ratio).toBeGreaterThanOrEqual(1 - ESSENCE_BUDGET_BAND - 1e-9);
      });
    }
  }
});

describe('signatures (§6.2)', () => {
  it('kind · element · delivery · extra, with defaults while the data names no delivery', () => {
    expect(DELIVERIES).toHaveLength(16);
    expect(signatureKey(skillSignature(SCORED_GROUND))).toBe('zone·none·line·bleed');
    expect(signatureKey(skillSignature(STATIC_FIELD))).toBe('zone·none·self·none');
    expect(signatureKey(skillSignature(FROST_GARDEN))).toBe('zone·fire·ground·none');
    expect(signatureKey(skillSignature(RIFT_STRIDE))).toBe('blink·none·point·knockback');
    expect(signatureKey(skillSignature({ ...SECOND_WIND, extra: 'haste' }))).toBe('mend·none·self·haste');
    expect(signatureKey(skillSignature(GUARD_UP))).toBe('shield·none·self·none');
    expect(defaultDelivery(WHIRLWIND)).toBe('ring');
    expect(defaultDelivery(sk({ id: 'p', tags: ['fist'], shape: { kind: 'strike', range: 30, arc: 60 } }))).toBe('punch');
    expect(defaultDelivery(sk({ id: 't', tags: ['pierce'], shape: { kind: 'projectile', speed: 300, range: 200 } }))).toBe('throw');
    expect(defaultDelivery(sk({ id: 'n', shape: { kind: 'nova', radius: 50, range: 0 } }))).toBe('ring');
  });

  it('`delivery` and `extra` win over the defaults; the element\'s own status counts as none', () => {
    const cinder = sk({ id: 'cinder_line', element: 'fire', shape: { ...ZONE, line: { length: 100 } }, delivery: 'path', status: 'burn' });
    expect(skillSignature(cinder)).toEqual({ kind: 'zone', element: 'fire', delivery: 'path', extra: 'burn' });
    expect(signatureKey(skillSignature(cinder, FIRE.status))).toBe('zone·fire·path·none');
    expect(skillSignature({ ...cinder, extra: 'pull' }, FIRE.status).extra).toBe('pull');
  });
});

describe('the four statuses', () => {
  it('root holds, launch holds and silences, lure pulls; expose only makes hits land harder', () => {
    expect(NEW_STATUSES).toEqual(['root', 'launch', 'expose', 'lure']);
    expect(statusControl('root')).toEqual({ rooted: true, helpless: false, lured: false });
    expect(statusControl('launch')).toEqual({ rooted: true, helpless: true, lured: false });
    expect(statusControl('lure')).toEqual({ rooted: false, helpless: false, lured: true });
    expect(statusControl('expose')).toEqual({ rooted: false, helpless: false, lured: false });
    expect(statusControl('slow')).toEqual({ rooted: false, helpless: false, lured: false });
  });

  it('have their lengths: airborne 1.2 s, exposed 4 s', () => {
    expect(STATUS).toMatchObject({ exposePct: 15, exposeMs: 4000, launchMs: 1200, wardenSlowPct: 40 });
    expect(statusMs('launch')).toBe(1200);
    expect(statusMs('expose')).toBe(4000);
    expect(statusMs('root')).toBe(STATUS.rootMs);
    expect(statusMs('lure')).toBe(STATUS.lureMs);
    expect(statusMs('burn')).toBeUndefined();
  });

  it('wardens: root and launch become a slow, lure is ignored', () => {
    for (const rank of ['common', 'elite', undefined] as const) {
      for (const s of NEW_STATUSES) expect(statusFor(s, rank)).toBe(s);
    }
    expect(statusFor('root', 'warden')).toBe('slow');
    expect(statusFor('launch', 'warden')).toBe('slow');
    expect(statusFor('lure', 'warden')).toBeNull();
    expect(statusFor('expose', 'warden')).toBe('expose');
    expect(statusFor('burn', 'warden')).toBe('burn');
  });

  it('an exposed target takes +15%, from every hit, on top of everything else', () => {
    expect(exposedPct(['slow', 'expose'])).toBe(15);
    expect(exposedPct(['slow'])).toBe(0);
    expect(exposedPct(undefined)).toBe(0);
    const hit = (statuses: ('expose' | 'burn')[], tagPct = 0) =>
      computeDamage(reg.elements, WHIRLWIND, 1, { atk: 200, matk: 200, crit: 0 }, { def: 0, statuses }, { rng: () => 0.5, tagPct }).amount;
    expect(hit([])).toBe(200);
    expect(hit(['expose'])).toBe(230);
    expect(hit(['expose', 'burn'], 10)).toBe(253);
  });

  it('a forced crit (a finisher) crits without changing the roll stream', () => {
    const rolls = (forceCrit: boolean): number[] => {
      const seen: number[] = [];
      let n = 0;
      const rng = (): number => {
        const v = [0.99, 0.5, 0.99, 0.5][n++];
        seen.push(v);
        return v;
      };
      const a = computeDamage(reg.elements, WHIRLWIND, 1, { atk: 100, matk: 100, crit: 5 }, { def: 0 }, { rng, forceCrit });
      expect(a.crit).toBe(forceCrit);
      expect(a.amount).toBe(forceCrit ? 150 : 100);
      return seen;
    };
    expect(rolls(true)).toEqual(rolls(false));
  });
});
