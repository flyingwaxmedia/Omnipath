// v4 Phase 1 VFX (docs/VFX.md §6.9, §6.10; docs/SPEC-v4.md §14 vfx row): the four new skill kinds for every element
// family through deriveVfx with no borrowed carrier, the fist impact set, the new status overlays, the class mechanic
// feedback, and the bus bridge for the v4 events (objectSpawn / objectTick / objectEnd, blink, mend, shieldUp /
// shieldHit / shieldEnd, mechanic).
import { describe, expect, it } from 'vitest';
import type { MechanicEffect } from '../src/core/mechanics';
import type { ElementId, SkillDef, SkillShape, StatusKind } from '../src/core/types';
import { NEW_SHAPE_KINDS, NEW_STATUSES } from '../src/core/types';
import { GAME_DATA } from '../src/data';
import { fistBlow } from '../src/game/audio/bridge';
import { EventBus, type GameEvents } from '../src/game/events';
import type { Monster } from '../src/game/entities/Monster';
import { bakePiece } from '../src/game/vfx/bake';
import { VfxBridge, classFamily, type BridgePlayer } from '../src/game/vfx/bridge';
import { SHELL_SKIN } from '../src/game/vfx/components/shell';
import { pieceProblems, recipePieces } from '../src/game/vfx/pieces';
import type { PlayCtx, VfxGroup, VfxStage } from '../src/game/vfx/play';
import { deriveVfx, deriveVfxAsCast, fistClassOf, GROUND_TRUTH, hitGeometry, MARK_LIFE_MS, MECHANIC_FX, mechanicPieces, statusPieces, statusPip } from '../src/game/vfx/recipe';
import { FAMILY_IDS, FIST_CLASSES, VFX_BUDGET, type FamilyId, type VfxPiece, type VfxRecipe } from '../src/game/vfx/types';

const ELEMENTS = GAME_DATA.elements.map((e) => e.id);
const TAG_FAMILY: Record<string, string[]> = { steel: ['blade'], arcane: ['arcane'], stealth: ['stealth'], toxin: ['toxin'], spirit: ['spirit'] };
const PLAYER_FAMILIES = FAMILY_IDS.filter((f) => f !== 'danger');

/** A synthetic skill of a shape in a family (elements by `element`, tag families by their tag). */
function mk(id: string, shape: SkillShape, fam: FamilyId, extra: Partial<SkillDef> = {}): SkillDef {
  const el = (ELEMENTS as readonly string[]).includes(fam) ? (fam as ElementId) : undefined;
  return { id: `t_${id}_${fam}`, name: id, desc: '', icon: '', tier: 2, tags: el ? ['aoe'] : [...TAG_FAMILY[fam], 'aoe'], power: 1, spCost: 5, cooldown: 6000, shape, maxRank: 5, ...(el ? { element: el } : {}), ...extra } as SkillDef;
}
const SHAPES: Record<string, SkillShape> = {
  zone: { kind: 'zone', radius: 90, range: 240, durationMs: 4000, tickMs: 800 },
  zoneSmall: { kind: 'zone', radius: 48, range: 0, durationMs: 3000, tickMs: 500, follow: true },
  lane: { kind: 'zone', radius: 40, range: 0, durationMs: 4000, tickMs: 800, line: { length: 220 } },
  blink: { kind: 'blink', distance: 200, to: 'point' },
  blinkHit: { kind: 'blink', distance: 220, to: 'target', arrive: { radius: 50 } },
  mend: { kind: 'mend', pct: 20 },
  mendOver: { kind: 'mend', pct: 30, overMs: 4000, radius: 80 },
  shield: { kind: 'shield', pct: 15, durationMs: 5000 },
  shieldBurst: { kind: 'shield', pct: 15, durationMs: 5000, burst: { radius: 80 } },
};
const hitless = (k: string): boolean => k === 'blink' || k === 'mend' || k === 'mendOver' || k === 'shield';
const all = (r: VfxRecipe): VfxPiece[] => recipePieces(r);
const ph = (r: VfxRecipe, id: keyof VfxRecipe['phases']): readonly VfxPiece[] => r.phases[id] ?? [];
const ring = (ps: readonly VfxPiece[], f: (p: Extract<VfxPiece, { component: 'ring' }>) => boolean) => ps.find((p): p is Extract<VfxPiece, { component: 'ring' }> => p.component === 'ring' && f(p));

describe('v4 kinds: a real recipe for every kind in every family', () => {
  it('derives valid, family-coloured recipes with their own carriers (no nova / dash / buff stand-in)', () => {
    const bad: string[] = [];
    for (const fam of PLAYER_FAMILIES) {
      for (const [name, shape] of Object.entries(SHAPES)) {
        const s = mk(name, shape, fam, hitless(name) ? { power: 0 } : {});
        const r = deriveVfx(s, 'player', () => undefined);
        expect(r.carrier.kind, s.id).toBe(shape.kind);
        expect(r.family, s.id).toBe(fam);
        expect(r.geometry, s.id).toEqual(hitGeometry(s, 'player'));
        for (const p of all(r)) for (const why of pieceProblems(p, 'player')) bad.push(`${s.id} ${p.component}: ${why}`);
        // Family colour: every piece is in the family, or a shared utility ramp (heal, dust, smoke).
        // (Status units keep their status ramps: burn is fire, stun holy, bleed blood.)
        const status = new Set(ph(r, 'status'));
        for (const p of all(r)) if (!status.has(p) && ![fam, 'heal', 'dust', 'smoke'].includes(p.ramp)) bad.push(`${s.id} ${p.component} in ${p.ramp}`);
        expect(ph(r, 'impact').length > 0, s.id).toBe(!hitless(name));
      }
    }
    expect(bad.slice(0, 20)).toEqual([]);
    expect(NEW_SHAPE_KINDS.slice().sort()).toEqual(['blink', 'mend', 'shield', 'zone']);
  });

  it('zone: the rim is the hit test (a circle at the radius; a lane with bead edges and half-ring caps) and stands for the duration', () => {
    for (const fam of PLAYER_FAMILIES) {
      const r = deriveVfx(mk('zone', SHAPES.zone, fam), 'player', () => undefined);
      const rim = ring(ph(r, 'aura'), (p) => p.layer === 'preview' && p.params.anim === 'static')!;
      expect(rim.params).toMatchObject({ r: 90, aspect: 1, style: 'solid' });
      expect(rim.params.thick).toBeGreaterThanOrEqual(VFX_BUDGET.cueMinPx);
      expect(rim.lifeMs).toBe(4000);
      const unit = ph(r, 'aura').find((p) => p.component === 'field')!;
      // The living interior speaks the family's language and stays inside the rim, on the ground.
      expect(unit).toMatchObject({ motif: fam, ramp: fam, layer: 'body', lifeMs: 4000 });
      expect(unit.place!.radius!).toBeLessThan(90);
      expect(unit.place!.count!).toBeGreaterThanOrEqual(4);
      const z = r.riders.zone!;
      expect(z.tick.some((p) => p.component === 'ring') && z.end.some((p) => p.component === 'ring')).toBe(true);
      // Opening and tick rings never pass the rim.
      for (const p of [...ph(r, 'area'), ...z.tick, ...z.end]) if (p.component === 'ring') expect(Math.max(p.params.r, p.params.r0 ?? 0)).toBeLessThanOrEqual(90);
      expect(r.juice).toEqual({ hitstopMs: 0, trauma: 0, flash: 'none' });
    }
    const lane = deriveVfx(mk('lane', SHAPES.lane, 'fire'), 'player', () => undefined);
    expect(lane.geometry).toEqual({ kind: 'capsule', length: 220, halfWidth: 40 });
    expect(lane.carrier).toEqual({ kind: 'zone', line: true, follow: false });
    const caps = ph(lane, 'aura').filter((p) => p.component === 'ring');
    expect(caps.map((p) => [p.anchor.along ?? 0, (p as Extract<VfxPiece, { component: 'ring' }>).params.arc, (p as Extract<VfxPiece, { component: 'ring' }>).params.r])).toEqual([
      [0, [90, 270], 40],
      [220, [-90, 90], 40],
    ]);
    const edges = ph(lane, 'aura').filter((p) => p.component === 'tell');
    // Two bead rows 2 x radius apart, covering both halves of the lane: a bead at least every 12 px.
    expect(edges.map((p) => [p.anchor.along ?? 0, p.place!.radius, p.place!.spacing])).toEqual([
      [0, 110, 80],
      [110, 110, 80],
    ]);
    for (const p of edges) expect(110 / (p.place!.count! / 2)).toBeLessThanOrEqual(12);
    // A pulling field breathes inward on its ticks.
    const pull = deriveVfx(mk('zone', SHAPES.zone, 'wind', { status: 'pull' }), 'player', () => undefined);
    expect(ring(pull.riders.zone!.tick, () => true)!.params.anim).toBe('contract');
  });

  it('blink: vanish where the caster stood, arrive where they land; an arrival hit rings at its true radius', () => {
    for (const fam of PLAYER_FAMILIES) {
      const r = deriveVfx(mk('blinkHit', SHAPES.blinkHit, fam), 'player', () => undefined);
      expect(ph(r, 'cast').find((p) => p.component === 'warp')).toMatchObject({ params: { phase: 'out' }, anchor: { to: 'caster' }, motif: fam });
      expect(ph(r, 'cast').some((p) => p.component === 'afterimage' && p.params.mode === 'blink')).toBe(true);
      expect(ph(r, 'area').find((p) => p.component === 'warp')).toMatchObject({ params: { phase: 'in' }, anchor: { to: 'aim' } });
      expect(ring(ph(r, 'area'), (p) => (p.tags ?? []).includes('geometryFromEvent'))!.params.r).toBe(50);
      expect(r.geometry).toEqual({ kind: 'disc', r: 50, aspect: 1, at: 'aim', addCasterRadius: false });
    }
    const plain = deriveVfx(mk('blink', SHAPES.blink, 'shadow', { power: 0 }), 'player', () => undefined);
    expect(plain.geometry).toEqual({ kind: 'self' });
    expect(ph(plain, 'area').some((p) => p.component === 'nova')).toBe(false);
  });

  it('mend: the green heal bloom every family shares inside the family ring; the trickle and resting circle for a heal over time', () => {
    for (const fam of PLAYER_FAMILIES) {
      const r = deriveVfx(mk('mendOver', SHAPES.mendOver, fam, { power: 0 }), 'player', () => undefined);
      expect(ph(r, 'cast').find((p) => p.component === 'mend')).toMatchObject({ params: { phase: 'pulse' }, ramp: 'heal' });
      expect(ph(r, 'cast').some((p) => p.component === 'ring' && p.ramp === fam)).toBe(true);
      const loop = ph(r, 'aura').find((p) => p.component === 'mend')!;
      expect((loop.delayMs ?? 0) + loop.lifeMs!).toBe(4000);
      expect(ring(ph(r, 'aura'), (p) => p.layer === 'preview')!).toMatchObject({ params: { r: 80 }, lifeMs: 4000, ramp: 'heal' });
      expect(ph(r, 'trail').length).toBeGreaterThan(0);
      expect(r.statuses).toEqual([]);
    }
    const plain = deriveVfx(mk('mend', SHAPES.mend, 'water', { power: 0 }), 'player', () => undefined);
    expect(plain.phases.aura).toBeUndefined();
  });

  it('shield: forms, holds for its duration, absorbs and breaks in the family skin; a burst rings at its true radius', () => {
    const skins = new Set<string>();
    for (const fam of PLAYER_FAMILIES) {
      const r = deriveVfx(mk('shieldBurst', SHAPES.shieldBurst, fam), 'player', () => undefined);
      skins.add(SHELL_SKIN[fam]);
      const loop = ph(r, 'aura').find((p) => p.component === 'shell')!;
      expect(loop).toMatchObject({ params: { phase: 'loop' }, motif: fam });
      expect((loop.delayMs ?? 0) + loop.lifeMs!).toBe(5000);
      const sh = r.riders.shield!;
      expect(sh.absorb[0]).toMatchObject({ component: 'shell', params: { phase: 'absorb' } });
      expect(sh.break[0]).toMatchObject({ component: 'shell', params: { phase: 'break' } });
      expect(ring(sh.burst, (p) => (p.tags ?? []).includes('geometryFromEvent'))!.params.r).toBe(80);
      // Nothing about a shield flashes the screen or carries white except the burst core.
      for (const p of [...ph(r, 'cast'), ...ph(r, 'aura'), ...sh.absorb, ...sh.break]) expect((p.tags ?? []).includes('hero'), `${fam} ${p.component}`).toBe(false);
    }
    expect(skins.size).toBeGreaterThanOrEqual(11);
    expect(deriveVfx(mk('shield', SHAPES.shield, 'ice', { power: 0 }), 'player', () => undefined).riders.shield!.burst).toEqual([]);
  });

  it('every authored zone / blink / mend / shield skill gets its own carrier, and a boosted cast is drawn as cast', () => {
    const fresh = GAME_DATA.skills.filter((s) => (NEW_SHAPE_KINDS as readonly string[]).includes(s.shape.kind));
    expect(fresh.length).toBeGreaterThan(0);
    for (const s of fresh) {
      const r = deriveVfx(s);
      expect(r.carrier.kind, s.id).toBe(s.shape.kind);
      expect(all(r).flatMap((p) => pieceProblems(p, 'player')), s.id).toEqual([]);
    }
    // A class mechanic's boost scales the shape under the same id (systems/boost.ts): the rim follows the cast.
    const zone = fresh.find((s) => s.shape.kind === 'zone' && !s.shape.line)!;
    const sh = zone.shape as Extract<SkillShape, { kind: 'zone' }>;
    const boosted = { ...zone, shape: { ...sh, radius: sh.radius * 2 } };
    const rim = (r: VfxRecipe) => ring(ph(r, 'aura'), (p) => p.layer === 'preview' && p.params.anim === 'static')!.params.r;
    expect(rim(deriveVfxAsCast(boosted))).toBe(sh.radius * 2);
    expect(rim(deriveVfx(zone))).toBe(sh.radius);
  });

  it('bakes the new components for every family: frames, loops and one-shots', () => {
    for (const fam of PLAYER_FAMILIES) {
      const r = [deriveVfx(mk('zone', SHAPES.zone, fam), 'player', () => undefined), deriveVfx(mk('blinkHit', SHAPES.blinkHit, fam), 'player', () => undefined), deriveVfx(mk('shieldBurst', SHAPES.shieldBurst, fam), 'player', () => undefined)];
      for (const p of r.flatMap(all)) {
        if (!['field', 'warp', 'shell'].includes(p.component)) continue;
        const b = bakePiece(p);
        expect(b.frames[0].some((f) => f.w > 0), `${fam} ${p.component}`).toBe(true);
        expect(b.heroFrames, `${fam} ${p.component}: no white`).toEqual([]);
      }
    }
  });
});

describe('fists: the impact set and bare-handed swings', () => {
  const fist = (id: string, shape: SkillShape, extra: Partial<SkillDef> = {}): SkillDef =>
    ({ id, name: id, desc: '', icon: '', tier: 1, tags: ['fist', 'melee'], weapons: ['fists'], power: 1, spCost: 0, cooldown: 0, shape, maxRank: 5, delivery: 'punch', ...extra }) as SkillDef;
  const strike: SkillShape = { kind: 'strike', range: 44, arc: 70 };
  const impact = (s: SkillDef) => ph(deriveVfx(s, 'player', () => undefined), 'impact').find((p) => p.component === 'burst') as Extract<VfxPiece, { component: 'burst' }>;

  it('lands jab, hook, palm, kick and slam by the kind of blow, in the warm spirit ramp, never smaller than m', () => {
    const cases: [SkillDef, string][] = [
      [fist('t_jab', strike, { tags: ['fist', 'melee', 'basic'] }), 'jab'],
      [fist('t_hook', strike, { tags: ['fist', 'melee', 'heavy'], power: 2.1 }), 'hook'],
      [fist('t_palm', strike, { tags: ['fist', 'melee', 'spirit'] }), 'palm'],
      [fist('t_kick', { kind: 'strike', range: 52, arc: 120 }, { delivery: 'kick' }), 'kick'],
      [fist('t_spin', { kind: 'spin', radius: 72, pulses: 1 }, { delivery: 'kick', tags: ['fist', 'spin', 'aoe'] }), 'kick'],
      [fist('t_slam', { kind: 'dash', distance: 200, width: 80 }, { tags: ['fist', 'dash', 'heavy', 'aoe'], power: 3 }), 'slam'],
      [fist('t_exec', strike, { tags: ['fist', 'melee', 'execute'] }), 'slam'],
    ];
    const seen = new Set<string>();
    for (const [s, cls] of cases) {
      const b = impact(s);
      expect(b.params.cls, s.id).toBe(cls);
      expect(b.ramp, s.id).toBe('spirit');
      expect(b.params.size, s.id).not.toBe('s');
      seen.add(b.params.cls);
      expect(all(deriveVfx(s, 'player', () => undefined)).flatMap((p) => pieceProblems(p, 'player')), s.id).toEqual([]);
    }
    expect([...seen].sort()).toEqual([...FIST_CLASSES].sort());
    // An elemental fist class keeps its element's ramp.
    expect(impact(fist('t_fire', strike, { element: 'fire' })).ramp).toBe('fire');
  });

  it('the bare-hands basic (auto-attack) swings a jab and every authored fist skill reads as a punch, kick or shield', () => {
    const jab = GAME_DATA.skills.find((s) => s.id === 'jab');
    if (jab) {
      const r = deriveVfx(jab);
      expect(r.carrier).toEqual({ kind: 'strike', style: 'punch' });
      expect(r.weight).toBe('light');
      expect(ph(r, 'cast').find((p) => p.component === 'burst')).toMatchObject({ params: { cls: 'jab', size: 's' }, ramp: 'spirit' });
      expect(impact(jab).params.cls).toBe('jab');
    }
    for (const s of GAME_DATA.skills.filter((x) => x.tags.includes('fist'))) {
      const r = deriveVfx(s);
      if (r.carrier.kind === 'strike') expect(['punch', 'kick'], s.id).toContain(r.carrier.style);
      if (r.carrier.kind === 'spin') expect(r.carrier.style, s.id).toBe('kick');
      if (ph(r, 'impact').length) expect(FIST_CLASSES, s.id).toContain(fistClassOf(s, r.weight));
    }
  });

  it('the sound of a blow is the blow drawn (audio fistBlow = VFX fistClassOf for every authored fist skill)', () => {
    for (const s of GAME_DATA.skills.filter((x) => x.tags.includes('fist'))) expect(fistBlow(s), s.id).toBe(fistClassOf(s, deriveVfx(s).weight));
  });

  it('bakes the five blows as distinct strips with one white hero frame up front', () => {
    const hashes = new Set<string>();
    for (const cls of FIST_CLASSES) {
      const b = bakePiece({ component: 'burst', params: { cls, size: 'm' }, ramp: 'spirit', motif: 'steel', lut: 'base', blend: 'normal', layer: 'body', anchor: { to: 'target', dy: 0 } });
      expect(b.heroFrames[0], cls).toBe(0);
      expect(b.dirs, cls).toBe(cls === 'palm' || cls === 'slam' ? 1 : 8);
      hashes.add(b.frames[0].map((f) => `${f.w}x${f.h}:${f.data.reduce((a, v) => (a * 31 + v) >>> 0, 7)}`).join('|'));
    }
    expect(hashes.size).toBe(5);
  });
});

describe('v4 statuses: root, launch, expose, lure', () => {
  it('each wears its own unit in the source family for exactly its duration, and has a pip', () => {
    const UNIT: Record<string, string> = { root: 'shackle', launch: 'updraft', expose: 'breach', lure: 'beckon' };
    expect([...NEW_STATUSES].sort()).toEqual(Object.keys(UNIT).sort());
    for (const kind of NEW_STATUSES as readonly StatusKind[]) {
      for (const body of ['S', 'M', 'L', 'W'] as const) {
        const ps = statusPieces(kind, 'shadow', body, 'player');
        expect(ps).toHaveLength(1);
        expect(ps[0]).toMatchObject({ component: 'status', params: { kind, unit: UNIT[kind], body }, ramp: 'shadow', lifeMs: GROUND_TRUTH.statusMs[kind] });
        expect(pieceProblems(ps[0], 'player')).toEqual([]);
        const b = bakePiece(ps[0]);
        expect(b.use).toBe('loop');
        expect(b.frames[0].every((f) => f.w > 0)).toBe(true);
      }
      expect(pieceProblems(statusPip(kind, 'steel', 'player'), 'player')).toEqual([]);
      expect(pieceProblems(statusPieces(kind, 'fire', 'M', 'monster')[0], 'monster')).toEqual([]);
    }
    // Distinct silhouettes: no two of the four bake to the same first frame.
    const first = (NEW_STATUSES as readonly StatusKind[]).map((k) => bakePiece(statusPieces(k, 'steel', 'M', 'player')[0]).frames[0][0]);
    expect(new Set(first.map((f) => `${f.w}x${f.h}`)).size).toBe(4);
  });
});

describe('class mechanic feedback', () => {
  it('has a flourish for every effect the mechanic engine reports, valid in every family', () => {
    // Compile-time: MECHANIC_FX lists exactly the MechanicEffect types.
    const exhaustive: Record<MechanicEffect['type'], true> = { full: true, spent: true, comboStep: true, comboBreak: true, finisher: true, marked: true, cashIn: true, markEnd: true, stance: true, placed: true, expired: true, levelUp: true, consumed: true };
    expect([...MECHANIC_FX].sort()).toEqual(Object.keys(exhaustive).sort());
    for (const fx of MECHANIC_FX) {
      for (const fam of PLAYER_FAMILIES) {
        const ps = mechanicPieces(fx, fam, { n: 2, of: 3, body: 'L' });
        expect(ps.length, fx).toBeGreaterThan(0);
        expect(ps.flatMap((p) => pieceProblems(p, 'player')), `${fx} ${fam}`).toEqual([]);
        for (const p of ps) expect([fam, 'smoke'], `${fx} ${fam}`).toContain(p.ramp);
      }
      expect(mechanicPieces(fx, 'danger').every((p) => p.ramp !== 'danger')).toBe(true);
    }
  });

  it('is a short mark on the actor: no screen layers, no big rings; white only on the finisher (one small hero piece)', () => {
    for (const fx of MECHANIC_FX) {
      const ps = mechanicPieces(fx, 'fire', { n: 3, of: 4 });
      for (const p of ps) {
        expect(['body', 'ground'], fx).toContain(p.layer);
        expect(p.blend, fx).toBe('normal');
        if (p.component === 'ring') expect(Math.max(p.params.r, p.params.r0 ?? 0), fx).toBeLessThanOrEqual(32);
        expect((p.tags ?? []).includes('hero'), fx).toBe(fx === 'finisher' && p.component === 'emblem');
      }
    }
    // The finisher's white is ~200 px over two frames: far under the 19 000 px flash budget.
    const fin = bakePiece(mechanicPieces('finisher', 'steel')[0]);
    expect(fin.heroFrames.length).toBeGreaterThan(0);
    expect(Math.max(...fin.flashPx)).toBeLessThan(VFX_BUDGET.flash.areaPx / 10);
    // Reduce-flash bake: no white at all.
    expect(bakePiece(mechanicPieces('finisher', 'steel')[0], { reduceFlash: true }).heroFrames).toEqual([]);
    // The four the spec names read by their own emblem.
    const emblem = (fx: (typeof MECHANIC_FX)[number], o = {}) => mechanicPieces(fx, 'water', o).find((p) => p.component === 'emblem') as Extract<VfxPiece, { component: 'emblem' }>;
    expect(emblem('full').params.kind).toBe('full');
    expect(emblem('finisher').params.kind).toBe('finisher');
    expect(emblem('cashIn').params.kind).toBe('cashIn');
    expect([emblem('stance', { n: 1 }).params.n, emblem('stance', { n: 2 }).params.n]).toEqual([1, 2]);
    expect(emblem('comboStep', { n: 2, of: 4 }).params).toMatchObject({ kind: 'step', n: 2, of: 4 });
    expect(emblem('marked', { n: 3 })).toMatchObject({ params: { kind: 'mark', n: 3 }, lifeMs: MARK_LIFE_MS, anchor: { to: 'target' } });
  });

  it('reduce-motion keeps the readable mark alone (no rings, no motes)', () => {
    for (const fx of MECHANIC_FX) {
      const calm = mechanicPieces(fx, 'holy', { calm: true });
      expect(calm.length, fx).toBeGreaterThan(0);
      expect(calm.length, fx).toBeLessThanOrEqual(mechanicPieces(fx, 'holy').length);
      if (['full', 'finisher', 'cashIn', 'stance', 'comboStep', 'marked', 'levelUp'].includes(fx)) expect(calm.map((p) => p.component), fx).toEqual(['emblem']);
    }
  });

  it('draws each class in its element, element-less classes by their weapon', () => {
    for (const c of GAME_DATA.classes) expect(FAMILY_IDS, c.id).toContain(classFamily(c.id));
    expect(classFamily('no_such_class')).toBe('steel');
    const by = (id: string) => GAME_DATA.classes.find((c) => c.id === id);
    if (by('pyroblade')?.source === 'fire') expect(classFamily('pyroblade')).toBe('fire');
    if (by('wayfarer')?.weapon === 'fists') expect(classFamily('wayfarer')).toBe('spirit');
    if (by('arcanist')?.weapon === 'staff') expect(classFamily('arcanist')).toBe('arcane');
  });
});

// ------------------------------------------------------------------ the bridge

interface Play {
  pieces: readonly VfxPiece[];
  ctx: PlayCtx;
  group: VfxGroup & { ended: boolean };
}

function setup(reduceFlash = false) {
  let now = 0;
  const plays: Play[] = [];
  const stage: VfxStage = {
    now: () => now,
    play(pieces, ctx) {
      const group = {
        ended: false,
        end() {
          this.ended = true;
        },
        get done() {
          return this.ended;
        },
      };
      plays.push({ pieces, ctx, group });
      return group;
    },
    warm: () => undefined,
    trauma: () => undefined,
    tick: () => undefined,
    reduceFlash,
    telegraph: () => ({ end() {}, done: true }),
  };
  const player: BridgePlayer = { x: 100, y: 100, sprite: { texture: { key: 'p' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.95, scaleX: 1, scaleY: 1, visible: true } };
  const bus = new EventBus<GameEvents>();
  const bridge = new VfxBridge(stage, { player: () => player, sceneNow: () => now, windupId: () => null });
  bridge.attachBus(bus);
  return { bus, plays, player, advance: (ms: number) => (now += ms), now: () => now };
}
const monster = (x = 160, y = 100): Monster => ({ x, y, alive: true, radius: 12, def: { rank: 'common', element: undefined }, sprite: { displayHeight: 30 } }) as unknown as Monster;
const ref = (s: SkillDef, castId = 7) => ({ skillId: s.id, skill: s, element: s.element, castId });
const comp = (p: Play) => p.pieces.map((q) => q.component);

describe('v4 bridge: zones', () => {
  const zone = mk('zone', SHAPES.zone, 'fire');
  const spawn = (obj: { x: number; y: number; radius: number; level: number; alive: boolean }, extra: Partial<GameEvents['objectSpawn']> = {}): GameEvents['objectSpawn'] => ({
    ...ref(zone),
    owner: 'player',
    id: 3,
    kind: 'zone',
    obj,
    x: obj.x,
    y: obj.y,
    radius: 90,
    follow: false,
    durationMs: 4000,
    untilMs: 4000,
    tickMs: 800,
    ticks: 5,
    ...extra,
  });

  it('opens the field, keeps it at the LIVE object until it ends, re-lights it on ticks and lets it go', () => {
    const t = setup();
    const obj = { x: 300, y: 200, radius: 90, level: 1, alive: true };
    t.bus.emit('objectSpawn', spawn(obj));
    const [open, stand] = t.plays;
    expect(comp(open)).toContain('ring');
    expect(comp(stand).sort()).toEqual(['decal', 'field', 'ring']);
    expect(stand.ctx.r).toBe(90);
    // Follow: the anchor is the live record.
    obj.x = 340;
    expect(stand.ctx.aim!.x).toBe(340);
    expect(stand.ctx.alive!()).toBe(true);
    t.bus.emit('objectTick', { ...ref(zone), id: 3, kind: 'zone', obj, x: 340, y: 200, radius: 90, index: 0, ticks: 5 });
    expect(t.plays).toHaveLength(3);
    expect(comp(t.plays[2])).toContain('ring');
    obj.alive = false;
    expect(stand.ctx.alive!()).toBe(false);
    t.bus.emit('objectEnd', { ...ref(zone), id: 3, kind: 'zone', obj, x: 340, y: 200, reason: 'expire' });
    expect(stand.group.ended).toBe(true);
    expect(t.plays).toHaveLength(4);
    // The goodbye plays at a fixed point (the record is gone).
    expect(t.plays[3].ctx.aim).toEqual({ x: 340, y: 200 });
    // Ticks and ends of an unknown / cleared object draw nothing.
    t.bus.emit('objectTick', { ...ref(zone), id: 3, kind: 'zone', obj, x: 0, y: 0, radius: 90, index: 1, ticks: 5 });
    expect(t.plays).toHaveLength(4);
  });

  it('a class object stands until removed (no time limit), a map clear ends it silently, a lane runs caster -> aim', () => {
    const t = setup();
    const obj = { x: 300, y: 200, radius: 90, level: 1, alive: true };
    t.bus.emit('objectSpawn', spawn(obj, { durationMs: Infinity, untilMs: Infinity, mechanic: 'Hearth' }));
    const stand = t.plays[1];
    expect(stand.pieces.every((p) => p.lifeMs === undefined)).toBe(true);
    t.advance(60000);
    expect(stand.ctx.alive!()).toBe(true);
    t.bus.emit('objectEnd', { ...ref(zone), id: 3, kind: 'zone', obj, x: 300, y: 200, reason: 'clear' });
    expect(stand.group.ended).toBe(true);
    expect(t.plays).toHaveLength(2);

    const lane = mk('lane', SHAPES.lane, 'fire');
    const lobj = { x: 210, y: 100, radius: 40, level: 1, alive: true, line: { x0: 100, y0: 100, x1: 320, y1: 100 } };
    t.bus.emit('objectSpawn', { ...spawn(lobj), ...ref(lane), id: 4, radius: 40, line: lobj.line });
    const ls = t.plays[t.plays.length - 1];
    expect(ls.ctx.caster).toEqual({ x: 100, y: 100 });
    expect(ls.ctx.ang).toBe(0);
    expect(ls.ctx.r).toBe(40);
  });

  it('draws a boosted cast at its boosted size (same id, scaled shape)', () => {
    const t = setup();
    const obj = { x: 300, y: 200, radius: 90, level: 1, alive: true };
    t.bus.emit('objectSpawn', spawn(obj));
    const big = { ...zone, shape: { ...(zone.shape as Extract<SkillShape, { kind: 'zone' }>), radius: 135 } };
    const obj2 = { x: 300, y: 200, radius: 135, level: 1, alive: true };
    t.bus.emit('objectSpawn', { ...spawn(obj2), ...ref(big, 8), id: 5, radius: 135 });
    const rimOf = (p: Play) => (p.pieces.find((q) => q.component === 'ring' && q.layer === 'preview') as Extract<VfxPiece, { component: 'ring' }>).params.r;
    expect([rimOf(t.plays[1]), rimOf(t.plays[3])]).toEqual([90, 135]);
  });
});

describe('v4 bridge: blink, mend, shield', () => {
  it('blink: the vanish snapshots the caster where they stood; the streaks span the real jump', () => {
    const t = setup();
    const s = mk('blinkHit', SHAPES.blinkHit, 'shadow');
    (t.player as { x: number }).x = 260; // already moved
    t.bus.emit('blink', { ...ref(s), owner: 'player', from: { x: 100, y: 100 }, to: { x: 260, y: 100 }, mode: 'target', radius: 50 });
    const [out, trail, inn] = t.plays;
    expect(out.ctx.caster).toEqual({ x: 100, y: 100 });
    expect(out.ctx.ghostOf).toMatchObject({ x: 100, y: 100 });
    expect(trail.pieces.every((p) => p.place?.radius === 160)).toBe(true);
    expect(inn.ctx.aim).toEqual({ x: 260, y: 100 });
    expect(inn.ctx.r).toBe(50);
    expect(comp(inn)).toContain('warp');
    // A blink in place has nothing between its ends.
    const n = t.plays.length;
    t.bus.emit('blink', { ...ref(s, 9), owner: 'player', from: { x: 260, y: 100 }, to: { x: 262, y: 100 }, mode: 'self' });
    expect(t.plays.length).toBe(n + 2);
  });

  it('mend: the bloom on the first pulse, the trickle until the heal over time ends, a lift per later pulse', () => {
    const t = setup();
    const s = mk('mendOver', SHAPES.mendOver, 'holy', { power: 0 });
    t.bus.emit('mend', { ...ref(s), x: 100, y: 100, amount: 20, first: true, overMs: 4000, radius: 80 });
    expect(t.plays.map(comp).map((c) => c.includes('mend'))).toEqual([true, false, true]);
    const loop = t.plays[2];
    expect(loop.ctx.aim).toEqual({ x: 100, y: 100 });
    t.advance(3999);
    expect(loop.ctx.alive!()).toBe(true);
    t.advance(2);
    expect(loop.ctx.alive!()).toBe(false);
    t.bus.emit('mend', { ...ref(s), x: 100, y: 100, amount: 5, first: false });
    expect(comp(t.plays[3])).toEqual(['motes']);
    // A recast replaces the trickle.
    t.bus.emit('mend', { ...ref(s, 8), x: 100, y: 100, amount: 20, first: true, overMs: 4000, radius: 80 });
    expect(loop.group.ended).toBe(true);
  });

  it('shield: forms and holds, flashes per soaked blow (never strobing), breaks and bursts; a replaced shell just ends', () => {
    const t = setup();
    const s = mk('shieldBurst', SHAPES.shieldBurst, 'water');
    t.bus.emit('shieldUp', { ...ref(s), x: 100, y: 100, amount: 30, durationMs: 5000, untilMs: 5000, burst: 80 });
    const [form, hold] = t.plays;
    expect(form.pieces[0]).toMatchObject({ component: 'shell', params: { phase: 'form' } });
    expect(hold.pieces[0]).toMatchObject({ component: 'shell', params: { phase: 'loop' } });
    expect(hold.ctx.alive!()).toBe(true);
    t.bus.emit('shieldHit', { x: 100, y: 100, absorbed: 5, left: 25, origin: { x: 200, y: 100 } });
    t.bus.emit('shieldHit', { x: 100, y: 100, absorbed: 5, left: 20 });
    expect(t.plays).toHaveLength(3);
    expect(t.plays[2].pieces[0]).toMatchObject({ component: 'shell', params: { phase: 'absorb' } });
    t.advance(200);
    t.bus.emit('shieldHit', { x: 100, y: 100, absorbed: 5, left: 15 });
    expect(t.plays).toHaveLength(4);
    t.bus.emit('shieldEnd', { ...ref(s), x: 100, y: 100, reason: 'broken', burst: 80 });
    expect(hold.group.ended).toBe(true);
    expect(hold.ctx.alive!()).toBe(false);
    expect(t.plays[4].pieces[0]).toMatchObject({ component: 'shell', params: { phase: 'break' } });
    expect(t.plays[5].ctx.r).toBe(80);
    // No shell: a stray hit draws nothing; a replaced shell ends without a break.
    t.bus.emit('shieldHit', { x: 100, y: 100, absorbed: 5, left: 0 });
    expect(t.plays).toHaveLength(6);
    t.bus.emit('shieldUp', { ...ref(s, 8), x: 100, y: 100, amount: 30, durationMs: 5000, untilMs: t.now() + 5000 });
    t.bus.emit('shieldEnd', { ...ref(s, 8), x: 100, y: 100, reason: 'replaced' });
    expect(t.plays).toHaveLength(8);
    expect(t.plays[7].group.ended).toBe(true);
  });
});

describe('v4 bridge: class mechanic feedback', () => {
  const cls = GAME_DATA.classes[0].id;
  const base = (type: MechanicEffect['type'], effect: MechanicEffect, extra: Partial<GameEvents['mechanic']> = {}): GameEvents['mechanic'] => ({ classId: cls, kind: 'gauge', name: 'x', type, effect, view: null, x: 100, y: 100, ...extra });

  it('plays meter full, finisher, combo steps and stance swaps on the player', () => {
    const t = setup();
    t.bus.emit('mechanic', base('full', { type: 'full', name: 'Heat' }));
    t.bus.emit('mechanic', base('finisher', { type: 'finisher', name: 'Finisher', skill: 'x' }));
    t.bus.emit('mechanic', base('comboStep', { type: 'comboStep', name: 'Cadence', step: 2, length: 3 }));
    t.bus.emit('mechanic', base('stance', { type: 'stance', name: 'Low Tide', stance: 1 }));
    expect(t.plays).toHaveLength(4);
    for (const p of t.plays) expect(p.ctx.caster).toBe(t.player);
    const em = (p: Play) => (p.pieces.find((q) => q.component === 'emblem') as Extract<VfxPiece, { component: 'emblem' }>).params;
    expect(t.plays.map((p) => em(p).kind)).toEqual(['full', 'finisher', 'step', 'stance']);
    expect(em(t.plays[2])).toMatchObject({ n: 2, of: 3 });
    expect(em(t.plays[3]).n).toBe(2);
  });

  it('keeps one mark pip per foe, cashes it in on the foe and ends it with the marks or the foe', () => {
    const t = setup();
    const m = monster();
    t.bus.emit('mechanic', base('marked', { type: 'marked', name: 'Pin', target: 'a', marks: 1 }, { target: m }));
    t.bus.emit('mechanic', base('marked', { type: 'marked', name: 'Pin', target: 'a', marks: 2 }, { target: m }));
    expect(t.plays[0].group.ended).toBe(true);
    expect(t.plays[1].ctx.target).toBe(m);
    expect(t.plays[1].pieces[0]).toMatchObject({ params: { kind: 'mark', n: 2 } });
    (m as { alive: boolean }).alive = false;
    expect(t.plays[1].ctx.alive!()).toBe(false);
    (m as { alive: boolean }).alive = true;
    t.bus.emit('mechanic', base('cashIn', { type: 'cashIn', name: 'Pin', skill: 's', targets: [], resetCooldown: false }, { targets: [{ target: m, marks: 2, stored: 10 }] }));
    expect(t.plays[1].group.ended).toBe(true);
    expect(t.plays[2].ctx.target).toEqual({ x: 160, y: 100 });
    expect(comp(t.plays[2])).toContain('emblem');
    t.bus.emit('mechanic', base('markEnd', { type: 'markEnd', name: 'Pin', target: 'a', stored: 5 }, { target: m }));
    expect(t.plays).toHaveLength(4);
  });

  it('class objects flourish where they stand; under reduce-flash only the mark plays', () => {
    const t = setup();
    t.bus.emit('mechanic', base('levelUp', { type: 'levelUp', name: 'Hearth', object: 1, level: 2 }, { at: { x: 300, y: 200 }, objectId: 9 }));
    expect(t.plays[0].ctx.target).toEqual({ x: 300, y: 200 });
    expect(t.plays[0].pieces.length).toBeGreaterThan(1);
    const calm = setup(true);
    calm.bus.emit('mechanic', base('full', { type: 'full', name: 'Heat' }));
    calm.bus.emit('mechanic', base('finisher', { type: 'finisher', name: 'Finisher', skill: 'x' }));
    for (const p of calm.plays) expect(comp(p)).toEqual(['emblem']);
  });
});
