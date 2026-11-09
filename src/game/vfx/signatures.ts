// Signature patches (docs/VFX.md §6.7): 40 bespoke tunings keyed by the authored ROOT id, so every infusion, essence
// variant and merge whose root is the signature skill inherits it. Each patch reuses the §5 components with tuned
// params and compositions and runs last in deriveVfx. Package R; Phaser-free and pure.
import type { SkillDef, SkillShape } from '../../core/types';
import { familyOf, lookOf } from './families';
import { aftermathR, cellFor, piece, reink, type Ink } from './pieces';
import {
  DECAL_BUCKETS,
  floorBucket,
  type Aspect,
  type Carrier,
  type FamilyId,
  type LutVariant,
  type PhaseId,
  type PieceTag,
  type SignatureDef,
  type SignaturePatch,
  type UnitKind,
  type VfxAnchor,
  type VfxPiece,
  type VfxRecipe,
} from './types';

// ------------------------------------------------------------------ helpers

const round = Math.round;
const lutOf = (r: VfxRecipe): LutVariant => (r.owner === 'monster' ? 'monster' : 'base');
const inkOf = (r: VfxRecipe, f: FamilyId = r.family): Ink => ({ ramp: f, motif: f, lut: lutOf(r) });
const at = (to: VfxAnchor['to'], dy = 0, along?: number): VfxAnchor => (along === undefined ? { to, dy } : { to, dy, along: round(along) });
const geoTags = (r: VfxRecipe): readonly PieceTag[] => (r.owner === 'monster' ? ['geometryFromEvent'] : []);
const aspectOf = (r: VfxRecipe): Aspect => (r.geometry.kind === 'disc' ? r.geometry.aspect : 1);
const radiusOf = (r: VfxRecipe): number => (r.geometry.kind === 'disc' ? r.geometry.r : r.geometry.kind === 'sector' ? r.geometry.r : 48);
const decalR = (v: number): number => floorBucket(v, DECAL_BUCKETS);
type Nova = Extract<SkillShape, { kind: 'nova' }>;
/** Time from novaTelegraph to novaBlast (player: shape delay; monster: the tell window, wind-up included). */
const novaDelay = (r: VfxRecipe, s: SkillDef): number => {
  const d = (s.shape as Nova).delay;
  return r.owner === 'monster' ? Math.max(500, d ?? 0) + (s.castMs ?? 0) : (d ?? 200);
};

const phase = (r: VfxRecipe, id: PhaseId): readonly VfxPiece[] => r.phases[id] ?? [];
const setPhase = (r: VfxRecipe, id: PhaseId, pieces: readonly VfxPiece[]): VfxRecipe => ({ ...r, phases: { ...r.phases, [id]: pieces } });
const add = (r: VfxRecipe, id: PhaseId, ...pieces: VfxPiece[]): VfxRecipe => setPhase(r, id, [...phase(r, id), ...pieces]);
const isEcho = (p: VfxPiece): boolean => (p.tags ?? []).includes('echo');
/** Replaces the non-echo pieces matching `match` with `next` (inserted where the first match was). */
function swap(r: VfxRecipe, id: PhaseId, match: (p: VfxPiece) => boolean, next: readonly VfxPiece[]): VfxRecipe {
  const cur = phase(r, id);
  const i = cur.findIndex((p) => match(p) && !isEcho(p));
  const kept = cur.filter((p) => !(match(p) && !isEcho(p)));
  const at0 = i < 0 ? kept.length : cur.slice(0, i).filter((p) => !(match(p) && !isEcho(p))).length;
  return setPhase(r, id, [...kept.slice(0, at0), ...next, ...kept.slice(at0)]);
}
/** Edits the params of the non-echo pieces of one component in a phase. */
function edit<C extends VfxPiece['component']>(r: VfxRecipe, id: PhaseId, component: C, f: (p: Extract<VfxPiece, { component: C }>) => VfxPiece): VfxRecipe {
  return setPhase(
    r,
    id,
    phase(r, id).map((p) => (p.component === component && !isEcho(p) ? f(p as Extract<VfxPiece, { component: C }>) : p)),
  );
}
/** Repaints every piece of one ramp to another family (a signature that changes the carrier's material). */
function repaint(r: VfxRecipe, from: FamilyId, to: FamilyId): VfxRecipe {
  const fix = (p: VfxPiece): VfxPiece => (p.ramp === from ? reink(p, { ramp: to, motif: p.motif === from ? to : p.motif }) : p);
  const phases: VfxRecipe['phases'] = {};
  for (const [k, ps] of Object.entries(r.phases) as [PhaseId, readonly VfxPiece[]][]) phases[k] = ps.map(fix);
  const rd = r.riders;
  return {
    ...r,
    family: to,
    phases,
    riders: {
      ...rd,
      ...(rd.returns ? { returns: { turn: rd.returns.turn.map(fix), tether: rd.returns.tether.map(fix), catch: rd.returns.catch.map(fix) } } : {}),
      ...(rd.reprise ? { reprise: { ghost: rd.reprise.ghost.map(fix) } } : {}),
      ...(rd.pierce ? { pierce: { mark: rd.pierce.mark.map(fix) } } : {}),
      ...(rd.arc ? { arc: { zap: rd.arc.zap.map(fix) } } : {}),
    },
  };
}
const withCarrier = (r: VfxRecipe, carrier: Carrier): VfxRecipe => ({ ...r, carrier });
/** Turns a matter body into an energy body: the palette follows the skill again and the imbue goes. */
function energize(r: VfxRecipe, s: SkillDef): VfxRecipe {
  const fam = familyOf(s);
  const out = r.family === fam ? r : repaint(r, r.family, fam);
  const { imbue: _imbue, ...rest } = out;
  void _imbue;
  return rest;
}
/** Swaps the projectile body for an orb (form, cell, orbit) and records it on the carrier. */
function orbBody(r: VfxRecipe, s: SkillDef, form: Extract<VfxPiece, { component: 'orb' }>['params']['form'], opts: { cell?: 16 | 24 | 32 | 48; orbit?: 'glyphs' | 'shards' | 'spiral' | 'vines' | 'motes'; ramp?: FamilyId } = {}): VfxRecipe {
  const base = energize(r, s);
  const size = (s.shape as Extract<SkillShape, { kind: 'projectile' }>).size ?? 12;
  const halo = r.owner === 'monster' && !s.tags.includes('echo');
  const body = piece('orb', { form, cell: opts.cell ?? cellFor(size, halo ? 1 : 0), halo, mode: 'fly', ...(opts.orbit ? { orbit: opts.orbit } : {}) }, inkOf(base, opts.ramp ?? base.family), { anchor: at('body', 0) });
  const swapped = swap(base, 'body', (p) => p.component === 'orb' || p.component === 'missile', [body]);
  // Matter-only trail pieces (afterimages) give way to the orb's ghost discs.
  const trail = phase(swapped, 'trail').filter((p) => p.component !== 'afterimage');
  const ghosts = trail.some((p) => p.component === 'motes' && p.params.kind === 'disc') ? [] : [piece('motes', { kind: 'disc', size: 2 }, inkOf(base), { anchor: at('body', 0), place: { pattern: 'trail', count: 5, everyPx: 4 } })];
  return withCarrier(setPhase(swapped, 'trail', [...trail, ...ghosts]), { kind: 'projectile', body: form, matter: false });
}

// ------------------------------------------------------------------ shared compositions

/** Vortex funnel: 3 stacked sweep smears (dy 0 / -12 / -24, r x1 / 0.7 / 0.45), the lower ones wider. */
function funnel(r: VfxRecipe, lift = 1): VfxPiece[] {
  const R = radiusOf(r);
  const ink = inkOf(r);
  return [1, 0.7, 0.45].map((k, i) =>
    piece('ring', { r: round(R * k), aspect: aspectOf(r), thick: i === 0 ? 3 : 2, style: 'solid', ink: i === 0 ? 'hot' : 'lit', anim: 'sweep', heads: 2, ms: [117, 133, 150][i], smear: i === 0 ? 6 : 4 }, ink, {
      anchor: at('caster', i === 0 ? 0 : -round(12 * i * lift)),
      tags: geoTags(r),
    }),
  );
}
/** The funnel replaces the vortex's swirl; its collapsing pull rings stay. */
const vortex = (r: VfxRecipe, lift = 1): VfxRecipe => swap(r, 'cast', (p) => p.component === 'ring' && p.params.anim === 'sweep', funnel(r, lift));

/** Shadow-cloud nova: cloud core + drifting smoke sheets instead of the implode. */
function shroud(r: VfxRecipe, f: FamilyId): VfxRecipe {
  const R = radiusOf(r);
  let out = edit(r, 'area', 'nova', (p) => reink({ ...p, params: { ...p.params, core: 'cloud' } } as VfxPiece, { ramp: f, motif: f }));
  out = swap(out, 'area', (p) => p.component === 'erupt', [
    piece('erupt', { unit: 'smoke-sheet', scale: 'm' }, inkOf(r, f), { anchor: at('aim', 0), place: { pattern: 'poisson', count: 6, radius: R, aspect: aspectOf(r), spacing: 18, wave: true }, lifeMs: 1000 }),
  ]);
  return withCarrier(out, { kind: 'nova', core: 'cloud', unit: 'smoke-sheet' });
}

/** Gravity well: the implode core held through the delay with 2 accretion arcs; release contracts a ring. */
function well(r: VfxRecipe, s: SkillDef): VfxRecipe {
  const R = radiusOf(r);
  const delay = novaDelay(r, s);
  const aim = at('aim', 0);
  const ink = inkOf(r);
  const arc = (from: number) =>
    piece('ring', { r: round(R * 0.5), aspect: aspectOf(r), thick: 2, style: 'solid', ink: 'lit', anim: 'sweep', heads: 1, arc: [from, from + 90], ms: 117 }, ink, { anchor: aim, layer: 'ground', lifeMs: delay });
  const out = add(r, 'telegraph', piece('nova', { core: 'implode', c: 24, heavy: false }, ink, { anchor: aim, lifeMs: delay }), arc(0), arc(180));
  return swap(out, 'area', (p) => p.component === 'ring' && p.params.r === R && p.params.anim === 'expand', [
    piece('ring', { r: round(R * 0.15), r0: R, aspect: aspectOf(r), thick: 3, style: 'solid', ink: 'hot', anim: 'contract', ms: 217 }, ink, { anchor: aim, layer: 'ground', tags: geoTags(r) }),
  ]);
}

/** Storm head: 4 stacked cloud puffs over the zone during the delay, 3 staggered sky-bolts with one flash, rain. */
function storm(r: VfxRecipe, s: SkillDef): VfxRecipe {
  const R = radiusOf(r);
  const delay = novaDelay(r, s);
  const aim = at('aim', 0);
  const ink = inkOf(r);
  let out = add(r, 'telegraph', piece('puff', { kind: 'cloud', r: 10 }, ink, { anchor: at('aim', -64), place: { pattern: 'stack', count: 4, radius: round(R * 0.5) }, lifeMs: delay }));
  const later: LutVariant = lutOf(r) === 'base' ? 'reduceFlash' : lutOf(r);
  out = swap(
    out,
    'area',
    (p) => p.component === 'erupt',
    [0, 117, 233].map((d, i) =>
      piece('erupt', { unit: 'sky-bolt', scale: 'l' }, { ...ink, lut: i === 0 ? ink.lut : later }, { anchor: aim, place: { pattern: 'poisson', count: 1, radius: round(R * 0.6), aspect: aspectOf(r) }, delayMs: d, tags: i === 0 ? ['hero'] : [] }),
    ),
  );
  return add(withCarrier(out, { kind: 'nova', core: 'sky', unit: 'sky-bolt' }), 'area', piece('motes', { kind: 'line', size: 2 }, inkOf(r, 'storm'), { anchor: at('aim', -48), place: { pattern: 'fall', count: 12, radius: R, aspect: aspectOf(r) } }));
}

/** Crust chips (magma, outlined) and a crack decal on every swing. */
function crust(r: VfxRecipe): VfxRecipe {
  const tip = r.geometry.kind === 'sector' ? round(r.geometry.r * 0.6) : 32;
  return add(
    r,
    'cast',
    piece('motes', { kind: 'chip', size: 2 }, inkOf(r, 'magma'), { anchor: at('caster', -12, tip), place: { pattern: 'burst', count: 5, spreadDeg: 90 }, delayMs: 33 }),
    piece('decal', { kind: 'cracks', r: 16, aspect: 1, density: 0.5, shape: 'disc' }, inkOf(r, 'magma'), { anchor: at('caster', 0, tip), layer: 'ground', lifeMs: 800 }),
  );
}

const aura = (motif: Extract<VfxPiece, { component: 'aura' }>['params']['motif'], halo = false, ramp?: FamilyId): SignaturePatch => (r) => {
  const re = (p: Extract<VfxPiece, { component: 'aura' }>): VfxPiece => {
    const q = { ...p, params: { ...p.params, motif, halo } } as VfxPiece;
    return ramp ? reink(q, { ramp, motif: ramp }) : q;
  };
  return withCarrier(edit(edit(r, 'cast', 'aura', re), 'aura', 'aura', re), { kind: 'buff', motif });
};

const units = (r: VfxRecipe, unit: UnitKind, f: FamilyId, count: number, pattern: 'poisson' | 'rim' | 'lattice' | 'line' = 'poisson'): VfxPiece =>
  piece('erupt', { unit, scale: 'm' }, inkOf(r, f), { anchor: at('aim', 0), place: { pattern, count, radius: radiusOf(r), aspect: aspectOf(r), spacing: 18, wave: pattern === 'poisson' } });

// ------------------------------------------------------------------ the 40 signatures

const DEFS: readonly [string, string, SignaturePatch][] = [
  [
    'worldbreaker',
    'a chop r128 falls onto the nova centre over the delay; blast c56 heavy, 12 spikes, cracks',
    (r, s) => {
      const delay = novaDelay(r, s);
      const R = radiusOf(r);
      const rock = r.family === 'steel';
      let out = add(
        r,
        'telegraph',
        piece('slash', { r: 128, arc: 60, rakes: 1, form: 'chop', weight: 'ultimate', tier: r.tier, sense: 1, rune: false }, inkOf(r), { anchor: at('aim', 0), move: { from: { x: 0, y: -120 }, ms: delay, ease: 'in' }, lifeMs: delay, tags: ['hero'] }),
      );
      out = edit(out, 'area', 'nova', (p) => ({ ...p, params: { ...p.params, core: 'blast', c: 56, heavy: true } }) as VfxPiece);
      const unit: UnitKind = rock ? 'rock-spike' : lookOf(r.family).unit;
      out = swap(out, 'area', (p) => p.component === 'erupt', [units(out, unit, rock ? 'earth' : r.family, 12)]);
      out = add(out, 'area', piece('decal', { kind: 'cracks', r: aftermathR(R), aspect: aspectOf(r), density: 0.5, shape: 'disc' }, inkOf(r, rock ? 'earth' : r.family), { anchor: at('aim', 0), layer: 'ground', lifeMs: 1000 }));
      return { ...withCarrier(out, { kind: 'nova', core: 'blast', unit }), juice: { ...out.juice, trauma: 0.3 } };
    },
  ],
  // The vortex style already throws the family's debris (leaves / embers) on a spiral; the funnel replaces its rings.
  ['tornado', 'vortex funnel of 3 stacked gapped sweeps + leaves on a spiral', (r) => vortex(r)],
  ['firestorm', 'the tornado funnel in fire + an ember spiral', (r) => vortex(r)],
  [
    'eye_of_the_storm',
    'a taller funnel + stacked storm clouds + rain',
    (r) =>
      add(
        vortex(r, 1.2),
        'cast',
        piece('puff', { kind: 'cloud', r: 7 }, inkOf(r, 'storm'), { anchor: at('caster', -36), place: { pattern: 'stack', count: 3, radius: 24 } }),
        piece('motes', { kind: 'line', size: 2 }, inkOf(r, 'storm'), { anchor: at('caster', -40), place: { pattern: 'fall', count: 12, radius: radiusOf(r) } }),
      ),
  ],
  [
    'spirit_crescent',
    'a flying ki crescent (orb wave, cell 48) with a dotted bead wake',
    (r, s) => add(orbBody(r, s, 'wave', { cell: 48 }), 'trail', piece('motes', { kind: 'bead', size: 2 }, inkOf(energize(r, s)), { anchor: at('body', 0), place: { pattern: 'trail', everyPx: 6 } })),
  ],
  ['molten_sunder', 'slash in its own family + magma crust chips + a crack decal per swing', (r) => crust(r)],
  ['magma_knight_sig', 'slash in its own family + magma crust chips + a crack decal per swing', (r) => crust(r)],
  ['gloom_shroud', 'cloud core + 6 shadow smoke sheets drifting 1 s (not an implode)', (r) => shroud(r, r.family === 'shadow' ? 'shadow' : r.family)],
  ['moonveil', 'the gloom shroud in the stealth ramp + 4 holy moon motes', (r) => add(shroud(r, 'stealth'), 'area', units(r, 'moon-mote', 'holy', 4))],
  ['arcane_orb', 'orb with orbiting glyphs, cell 48', (r, s) => orbBody(r, s, 'orb', { cell: 48, orbit: 'glyphs' })],
  ['glacial_orb', 'ice orb with orbiting shards, cell 48 (not a missile shard)', (r, s) => orbBody(r, s, 'orb', { cell: 48, orbit: 'shards' })],
  ['undertow_orb', 'water orb with a spiral', (r, s) => orbBody(r, s, 'orb', { orbit: 'spiral' })],
  ['tangle_orb', 'orb with orbiting vines in the wind (leaf) ramp', (r, s) => orbBody(r, s, 'orb', { orbit: 'vines', ramp: 'wind' })],
  ...(['prism_orb', 'dawn_prism', 'prism_sage_sig'] as const).map(
    (id): [string, string, SignaturePatch] => [
      id,
      'prism orbs + tri-glint motes',
      (r, s) => add(orbBody(r, s, 'prism'), 'trail', piece('motes', { kind: 'glint', size: 1 }, inkOf(energize(r, s)), { anchor: at('body', 0), place: { pattern: 'trail', count: 3, everyPx: 10 } })),
    ],
  ),
  [
    'prism_burst',
    'a double ring per pulse + 3 prism glints',
    (r) =>
      add(
        edit(r, 'cast', 'ring', (p) => (p.params.ink === 'dim' ? p : ({ ...p, params: { ...p.params, style: 'double' } } as VfxPiece))),
        'cast',
        piece('motes', { kind: 'glint', size: 2 }, inkOf(r), { anchor: at('caster', -12), place: { pattern: 'orbit', count: 3, radius: radiusOf(r) } }),
      ),
  ],
  ['aqua_lance', 'a water lance', (r, s) => orbBody(r, s, 'lance')],
  [
    'plasma_lance',
    'a fire lance throwing a lightning zap every 3rd trail tick; fire + shock impact spokes',
    (r, s) => {
      let out = orbBody(r, s, 'lance');
      out = add(out, 'trail', piece('bolt', { dx: 16, dy: 0, jag: 0.35, forks: 0.3, strength: 0.7, seq: 'zap', seed: r.variety }, inkOf(out, 'lightning'), { anchor: at('body', 0), place: { pattern: 'trail', everyPx: 15 }, tags: ['geometryFromEvent'] }));
      return add(out, 'impact', piece('burst', { cls: 'magic', size: 's' }, inkOf(out, 'lightning'), { anchor: at('target', -10) }));
    },
  ],
  [
    'featherstorm',
    'a fan of feathers (missile feather, wind, 16 dirs)',
    (r, s) => {
      const size = (s.shape as Extract<SkillShape, { kind: 'projectile' }>).size ?? 10;
      const out = swap(r, 'body', (p) => p.component === 'orb' || p.component === 'missile', [piece('missile', { form: 'feather', cell: cellFor(size), halo: false, pose: 'fly' }, inkOf(r), { anchor: at('body', 0) })]);
      return withCarrier(setPhase(out, 'trail', phase(out, 'trail').filter((p) => !(p.component === 'motes' && p.params.kind === 'disc'))), { kind: 'projectile', body: 'feather', matter: true });
    },
  ],
  ['singularity', 'an implode core held through the delay with accretion arcs; the release contracts', (r, s) => well(r, s)],
  [
    'geode_maw',
    'the singularity + 10 crystal spikes on the rim; release burst blunt l',
    (r, s) => add(swap(well(r, s), 'area', (p) => p.component === 'erupt', [units(r, 'crystal-spike', r.family, 10, 'rim')]), 'area', piece('burst', { cls: 'blunt', size: 'l' }, inkOf(r), { anchor: at('aim', 0) })),
  ],
  [
    'meteor',
    'a burning glob falls from (-60, -160) over the delay with smoke; its shadow grows; blast c56 + flame columns',
    (r, s) => {
      const delay = novaDelay(r, s);
      const fall = { from: { x: -60, y: -160 }, ms: delay, ease: 'in' as const };
      let out = add(
        r,
        'telegraph',
        piece('missile', { form: 'glob', cell: 24, halo: false, pose: 'fly' }, inkOf(r), { anchor: at('aim', 0), move: fall, lifeMs: delay }),
        piece('puff', { kind: 'smoke', r: 3 }, inkOf(r), { anchor: at('aim', 0), move: fall, place: { pattern: 'trail', everyPx: 10 }, lifeMs: delay }),
        piece('decal', { kind: 'shadow', r: 32, aspect: aspectOf(r), density: 0.25, shape: 'disc' }, inkOf(r), { anchor: at('aim', 0), layer: 'ground', lifeMs: delay }),
      );
      out = edit(out, 'area', 'nova', (p) => ({ ...p, params: { ...p.params, c: 56 } }) as VfxPiece);
      return swap(out, 'area', (p) => p.component === 'erupt', [units(out, 'flame-column', r.family === 'magma' ? 'magma' : r.family, 8)]);
    },
  ],
  ['thunderstorm', 'stacked clouds during the delay; 3 sky-bolts at 0 / 117 / 233 ms, one flash; rain', (r, s) => storm(r, s)],
  [
    'ascendant_sig',
    'the thunderstorm + 6 spectral blades on an orbit halo at release',
    (r, s) => add(storm(r, s), 'area', piece('missile', { form: 'blade', cell: 24, halo: false, pose: 'fly' }, inkOf(r, 'steel'), { anchor: at('aim', -16), place: { pattern: 'orbit', count: 6, radius: 32 }, lifeMs: 600 })),
  ],
  [
    'starfall_lattice',
    '10 star shards fall onto lattice points joined by bead lines during the delay, over the r48 rune circle',
    (r, s) => {
      const delay = novaDelay(r, s);
      const R = radiusOf(r);
      return add(
        r,
        'telegraph',
        piece('erupt', { unit: 'star-shard', scale: 'm' }, inkOf(r), { anchor: at('aim', 0), place: { pattern: 'lattice', count: 10, radius: R }, move: { from: { x: 0, y: -48 }, ms: delay, ease: 'in' }, lifeMs: delay }),
        // The r48 rune circle at the centre is the arcane nova marker every staff nova already draws (no second sigil).
        piece('motes', { kind: 'bead', size: 2 }, inkOf(r), { anchor: at('aim', 0), place: { pattern: 'path', count: 20, radius: R }, lifeMs: delay }),
      );
    },
  ],
  ['halo_ward', 'a hex ward aura with a holy halo', aura('ward', true)],
  [
    'astral_form',
    'a runes aura with twinkling star motes',
    (r, s) => {
      const out = aura('runes')(r, s);
      const dur = (s.shape as Extract<SkillShape, { kind: 'buff' }>).duration;
      return add(out, 'aura', piece('motes', { kind: 'star', size: 1 }, inkOf(r), { anchor: at('caster', -20), place: { pattern: 'orbit', count: 4, radius: 16 }, lifeMs: dur }));
    },
  ],
  ['blade_aura', 'three orbiting spectral blades', aura('blades')],
  ['searing_edge', 'a weapon flame (edge aura in the fire ramp)', aura('edge', false, 'fire')],
  ['shade_cloak', 'a veil aura of rising wisps (the actor alpha 0.55 is runtime)', aura('veil')],
  [
    'millstone_whirl',
    'a spinning dash with a jagged earth band + chips',
    (r) =>
      add(
        edit(r, 'area', 'ring', (p) => (p.params.anim === 'sweep' ? ({ ...p, params: { ...p.params, style: 'jagged' } } as VfxPiece) : p)),
        'cast',
        piece('motes', { kind: 'chip', size: 2 }, inkOf(r, 'earth'), { anchor: at('caster', 0), place: { pattern: 'burst', count: 6, spreadDeg: 180 } }),
      ),
  ],
  [
    'boulder_roll',
    'the caster becomes a rolling boulder (missile rock, cell 32) + dust; landing shock + cracks',
    (r) => {
      const dust: Ink = { ramp: 'dust', motif: r.family, lut: lutOf(r) };
      let out = swap(r, 'cast', (p) => p.component === 'afterimage', [piece('missile', { form: 'rock', cell: 32, halo: false, pose: 'fly' }, inkOf(r), { anchor: at('caster', -12), lifeMs: 170 })]);
      out = add(out, 'body', piece('missile', { form: 'rock', cell: 32, halo: false, pose: 'fly' }, inkOf(r), { anchor: at('path', -12) }));
      out = swap(out, 'trail', (p) => p.component === 'afterimage', [piece('puff', { kind: 'dust', r: 5 }, dust, { anchor: at('path', 0), layer: 'ground', place: { pattern: 'trail', everyPx: 12 } })]);
      const end = at('aim', 0);
      const delay = r.owner === 'monster' ? Math.max(140, round(r.geometry.kind === 'lane' ? r.geometry.length / 1.1 : 0)) : 170;
      out = add(
        out,
        'area',
        piece('ring', { r: 28, r0: 6, aspect: r.owner === 'monster' ? 0.65 : 1, thick: 2, style: 'jagged', ink: 'lit', anim: 'expand', ms: 217 }, inkOf(r), { anchor: end, layer: 'ground', delayMs: delay }),
        piece('decal', { kind: 'cracks', r: 24, aspect: 1, density: 0.5, shape: 'disc' }, dust, { anchor: end, layer: 'ground', delayMs: delay, lifeMs: 800 }),
      );
      return withCarrier(out, { kind: 'dash', mode: 'roll' });
    },
  ],
  [
    'earthsplitter',
    'a crack line along the aim (length = range) with rock spikes erupting on it',
    (r, s) => {
      const range = (s.shape as Nova).range;
      const line = { to: 'caster' as const, dy: 0, along: round(range / 2) };
      return add(
        r,
        'area',
        piece('decal', { kind: 'cracks', r: decalR(range / 2), aspect: 1, density: 0.5, shape: 'line' }, inkOf(r), { anchor: line, layer: 'ground', lifeMs: 1000, tags: ['geometryFromEvent'] }),
        piece('erupt', { unit: lookOf(r.family).unit === 'rock-spike' ? 'rock-spike' : lookOf(r.family).unit, scale: 's' }, inkOf(r), { anchor: line, place: { pattern: 'line', count: Math.min(14, Math.max(3, round(range / 18))), radius: round(range / 2) }, tags: ['geometryFromEvent'] }),
      );
    },
  ],
  [
    'net_throw',
    'the net wraps the target for 600 ms',
    (r, s) => {
      const size = (s.shape as Extract<SkillShape, { kind: 'projectile' }>).size ?? 28;
      return add(r, 'impact', piece('missile', { form: 'net', cell: cellFor(size), halo: false, pose: 'wrap' }, inkOf(r), { anchor: at('target', -10), lifeMs: 600 }));
    },
  ],
  [
    'jelly_slam',
    'a goo core (water when unaligned) + its decal',
    (r, s) => {
      const fam: FamilyId = s.element ? r.family : 'water';
      let out = r.family === fam ? r : repaint(r, r.family, fam);
      out = edit(out, 'area', 'nova', (p) => ({ ...p, params: { ...p.params, core: 'goo' } }) as VfxPiece);
      const unit = lookOf(fam).unit;
      out = edit(out, 'area', 'erupt', (p) => ({ ...p, params: { ...p.params, unit } }) as VfxPiece);
      const decal = lookOf(fam).decal ?? 'wet';
      const R = radiusOf(out);
      out = swap(out, 'area', (p) => p.component === 'decal' && p.layer === 'ground', [
        piece('decal', { kind: decal, r: aftermathR(R), aspect: aspectOf(out), density: 0.5, shape: 'disc' }, inkOf(out), { anchor: at('aim', 0), layer: 'ground', lifeMs: 1000, blend: decal === 'scorch' || decal === 'ink' ? 'multiply' : 'normal' }),
      ]);
      return withCarrier(out, { kind: 'nova', core: 'goo', unit });
    },
  ],
  [
    'lunar_dust',
    'holy motes fall inside the zone through the delay; release 6 moon motes instead of a pillar',
    (r, s) => {
      const delay = novaDelay(r, s);
      const out = add(r, 'telegraph', piece('motes', { kind: 'glint', size: 1 }, inkOf(r, 'holy'), { anchor: at('aim', -24), place: { pattern: 'fall', count: 12, radius: radiusOf(r), aspect: aspectOf(r) }, lifeMs: delay }));
      return withCarrier(swap(out, 'area', (p) => p.component === 'erupt', [units(out, 'moon-mote', r.family, 6)]), { kind: 'nova', core: (r.carrier as Extract<Carrier, { kind: 'nova' }>).core, unit: 'moon-mote' });
    },
  ],
  [
    'tremor_stomp',
    'a heavy blast + an extra outer ring + cracks; the warden version shakes 0.5',
    (r) => {
      const R = radiusOf(r);
      let out = edit(r, 'area', 'nova', (p) => ({ ...p, params: { ...p.params, heavy: true } }) as VfxPiece);
      out = add(out, 'area', piece('ring', { r: R, r0: round(R * 0.7), aspect: aspectOf(r), thick: 2, style: 'jagged', ink: 'mid', anim: 'expand', ms: 250 }, inkOf(r), { anchor: at('aim', 0), layer: 'ground', delayMs: 83, tags: geoTags(r) }));
      if (!phase(out, 'area').some((p) => p.component === 'decal' && p.params.kind === 'cracks')) {
        out = add(out, 'area', piece('decal', { kind: 'cracks', r: aftermathR(R), aspect: aspectOf(r), density: 0.5, shape: 'disc' }, inkOf(r), { anchor: at('aim', 0), layer: 'ground', lifeMs: 1000 }));
      }
      return r.owner === 'monster' ? { ...out, juice: { ...out.juice, trauma: 0.5 } } : out;
    },
  ],
  [
    'mon_magma_glob',
    'a magma glob lobbed on an arc over the delay; release burst blunt + a cooling pool',
    (r, s) => {
      const delay = novaDelay(r, s);
      let out = add(r, 'telegraph', piece('missile', { form: 'glob', cell: 24, halo: r.owner === 'monster', pose: 'fly' }, inkOf(r), { anchor: at('aim', 0), move: { from: { x: -80, y: -40 }, ms: delay, ease: 'arc' }, lifeMs: delay, tags: ['geometryFromEvent'] }));
      out = add(out, 'area', piece('burst', { cls: 'blunt', size: 'm' }, inkOf(r), { anchor: at('aim', 0) }));
      if (!phase(out, 'area').some((p) => p.component === 'decal' && p.params.kind === 'pool')) {
        out = add(out, 'area', piece('decal', { kind: 'pool', r: aftermathR(radiusOf(r)), aspect: aspectOf(r), density: 0.5, shape: 'disc' }, inkOf(r), { anchor: at('aim', 0), layer: 'ground', lifeMs: 1600 }));
      }
      return out;
    },
  ],
  [
    'mon_rift_lunge',
    'a shadow dive with a rift opening and closing at both ends',
    (r, s) => {
      const dur = r.owner === 'monster' ? Math.max(140, round((s.shape as Extract<SkillShape, { kind: 'dash' }>).distance / 1.1)) : 170;
      const rift = (to: 'caster' | 'aim', delayMs: number) =>
        piece('decal', { kind: 'rift', r: 16, aspect: 1, density: 0.5, shape: 'line' }, inkOf(r), { anchor: at(to, 0), layer: 'ground', delayMs, lifeMs: 400 });
      return add(add(r, 'cast', rift('caster', 0)), 'area', rift('aim', dur));
    },
  ],
];

/** Signature patches by authored root id (docs/VFX.md §6.7). */
export const SIGNATURES: Readonly<Record<string, SignatureDef>> = Object.fromEntries(DEFS.map(([id, note, patch]) => [id, { id, note, patch }]));
