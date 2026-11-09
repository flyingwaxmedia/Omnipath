// Piece constructors, nominal strip timings and the piece validity rules (docs/VFX.md §5, §10.3). Package R.
// Phaser-free and pure. P never imports this file; the joint tests and the later runtime may.
import type { StatusKind } from '../../core/types';
import {
  ARC_BUCKETS,
  CELL_BUCKETS,
  COMPONENT_IDS,
  CORE_BUCKETS,
  DECAL_BUCKETS,
  FAMILY_IDS,
  PHASE_IDS,
  REACH_BUCKETS,
  SIGIL_BUCKETS,
  UTILITY_RAMP_IDS,
  VFX_BUDGET,
  floorBucket,
  type ComponentId,
  type ComponentParams,
  type FamilyId,
  type LutVariant,
  type RampId,
  type VfxOwner,
  type VfxPiece,
  type VfxPieceOf,
  type VfxRecipe,
} from './types';

/** Colour source of a piece: LUT ramp, geometry motif and LUT variant. */
export interface Ink {
  ramp: RampId;
  motif: FamilyId;
  lut: LutVariant;
}

export type PieceOpts<C extends ComponentId> = Partial<Omit<VfxPieceOf<C>, 'component' | 'params' | 'ramp' | 'motif' | 'lut'>>;

/** A piece with the defaults: NORMAL blend, body layer, anchored on the target at its feet. */
export function piece<C extends ComponentId>(component: C, params: ComponentParams[C], ink: Ink, opts: PieceOpts<C> = {}): VfxPiece {
  const p: VfxPieceOf<C> = {
    component,
    params,
    ramp: ink.ramp,
    motif: ink.motif,
    lut: ink.lut,
    blend: 'normal',
    layer: 'body',
    anchor: { to: 'target', dy: 0 },
    ...opts,
  };
  return p as unknown as VfxPiece;
}

/** The same piece in another ink (echo family, infusion palette, monster LUT). */
export function reink(p: VfxPiece, ink: Partial<Ink>): VfxPiece {
  return { ...p, ...ink } as VfxPiece;
}

/** The same piece with extra tags (deduplicated). */
export function tag(p: VfxPiece, ...tags: NonNullable<VfxPiece['tags']>): VfxPiece {
  return { ...p, tags: [...new Set([...(p.tags ?? []), ...tags])] } as VfxPiece;
}

const VSYNC = 1000 / 60;
/** A duration rounded to whole 60 Hz vsyncs (total animation times, ring `ms`). At least one vsync. */
export function vsync(ms: number): number {
  return Math.round(Math.max(1, Math.round(ms / VSYNC)) * VSYNC);
}

/**
 * Aftermath decals (scorch, wet, frost, ink, rune, cracks, pool) mark the core of a blast, not its whole area: the
 * rim, the rings and the units carry the true radius. Capping them keeps the warm atlas set of a busy fight inside
 * VFX_BUDGET.maxPages (a full-radius r168 decal alone is 3 x 300² px).
 */
export const AFTERMATH_MAX_R = 96;
/** Aftermath sizes (DECAL_BUCKETS values): coarse, so novas of similar size share one decal bake. */
const AFTERMATH_R: readonly number[] = [16, 32, 48, 64, AFTERMATH_MAX_R];
export function aftermathR(radius: number): number {
  return floorBucket(Math.min(radius, AFTERMATH_MAX_R), AFTERMATH_R);
}

/** Projectile cell for a hit-test size: ≤ 9 → 16, ≤ 14 → 24, ≤ 22 → 32, else 48; `up` buckets larger (monsters). */
export function cellFor(size: number, up = 0): 16 | 24 | 32 | 48 {
  const i = size <= 9 ? 0 : size <= 14 ? 1 : size <= 22 ? 2 : 3;
  return CELL_BUCKETS[Math.min(CELL_BUCKETS.length - 1, i + up)] as 16 | 24 | 32 | 48;
}

/**
 * Nominal strip length (ms) of a piece per docs/VFX.md §5, used for timing checks. Loops and held pieces use
 * `lifeMs`; runtime-driven bodies (orbs, missiles in flight) report one loop.
 */
export function nominalMs(p: VfxPiece): number {
  switch (p.component) {
    case 'slash': {
      const heavy = p.params.weight === 'heavy' || p.params.weight === 'ultimate';
      return heavy ? 600 : 400;
    }
    case 'thrust':
      return 250;
    case 'orb':
      return p.params.orbit ? 664 : 268;
    case 'missile':
      return 400;
    case 'bolt':
      return p.params.seq === 'chain' ? 233 : 100;
    case 'burst':
      return p.params.cls === 'tick' ? 133 : p.params.cls === 'star' ? 600 : 300;
    case 'motes':
      return 400;
    case 'puff':
      return 664;
    case 'ring':
      return p.params.ms;
    case 'decal':
      return VFX_BUDGET.decals.lifeMs;
    case 'sigil':
      return 400;
    case 'nova':
      return p.params.heavy ? 585 : 552;
    case 'erupt':
      return 600;
    case 'status':
      return 800;
    case 'aura':
      return p.params.phase === 'activate' ? 498 : p.params.phase === 'break' ? 300 : 1600;
    case 'tell':
      return 50;
    case 'afterimage':
      return p.params.steps.length * 50;
  }
}

/** When a piece is done, relative to its phase trigger (ms). */
export function pieceEndMs(p: VfxPiece): number {
  return (p.delayMs ?? 0) + (p.lifeMs ?? nominalMs(p));
}

// ------------------------------------------------------------------ validity (docs/VFX.md §10.3)

const RAMP_IDS: readonly string[] = [...FAMILY_IDS, ...UTILITY_RAMP_IDS];
const LUTS: readonly string[] = ['base', 'shift', 'monster', 'reduceFlash'];
const BLENDS: readonly string[] = ['normal', 'add', 'multiply'];
const LAYERS: readonly string[] = ['ground', 'preview', 'tell', 'body', 'rim', 'glow', 'light'];
const ANCHORS: readonly string[] = ['caster', 'target', 'aim', 'body', 'path', 'hop'];
const PATTERNS: readonly string[] = ['single', 'burst', 'converge', 'spiral', 'orbit', 'trail', 'rise', 'fall', 'poisson', 'rim', 'lattice', 'line', 'stack', 'path'];
const TAGS: readonly string[] = ['hero', 'firstHitOnly', 'laterHits', 'lastHit', 'echo', 'neverGoverned', 'geometryFromEvent'];
const NO_ADD: readonly FamilyId[] = ['shadow', 'earth', 'wind', 'toxin', 'stealth', 'steel', 'danger'];
const STATUS_KINDS: readonly StatusKind[] = ['burn', 'slow', 'soak', 'stun', 'knockback', 'shock', 'bleed', 'smite', 'freeze', 'poison', 'pull'];
const ELEMENTS: readonly string[] = ['fire', 'water', 'earth', 'wind', 'lightning', 'shadow', 'holy', 'ice', 'magma', 'storm', 'twilight'];

const ENUMS = {
  weight: ['light', 'normal', 'heavy', 'ultimate'],
  orb: ['orb', 'fireball', 'shade', 'spark', 'storm', 'lightbolt', 'moon', 'prism', 'lance', 'wave', 'gust', 'spellblade', 'bubble', 'droplet'],
  orbit: ['glyphs', 'shards', 'spiral', 'vines', 'motes'],
  missile: ['blade', 'cleaver', 'hammer', 'knife', 'needle', 'dart', 'feather', 'shard', 'thorn', 'rock', 'glob', 'net', 'hook'],
  burst: ['slash', 'pierce', 'blunt', 'magic', 'ki', 'crit', 'tick', 'strong', 'resist', 'immune', 'muzzle', 'split', 'glint', 'fizzle', 'star'],
  mote: ['spark', 'ember', 'mote', 'streak', 'flake', 'droplet', 'chip', 'bubble', 'leaf', 'glint', 'glyph', 'wisp', 'line', 'bead', 'disc', 'star'],
  puff: ['smoke', 'dust', 'vapour', 'veil', 'gas', 'cloud', 'steam'],
  ringStyle: ['solid', 'double', 'gapped', 'jagged', 'dashed', 'inverted'],
  ringInk: ['hot', 'lit', 'mid', 'dim'],
  ringAnim: ['expand', 'contract', 'sweep', 'march', 'static'],
  decal: ['fill', 'scorch', 'frost', 'wet', 'ink', 'rune', 'cracks', 'pool', 'rift', 'shadow'],
  core: ['blast', 'ripple', 'implode', 'radiant', 'sky', 'rune', 'cloud', 'goo'],
  unit: ['flame-column', 'lava-geyser', 'rock-spike', 'crystal-spike', 'ice-spike', 'splash-crown', 'gust-swirl', 'sky-bolt', 'light-pillar', 'tendril', 'moon-mote', 'star-shard', 'spore-puff', 'smoke-sheet', 'debris', 'ki-ripple'],
  statusUnit: ['tongue', 'drip', 'puddle', 'chevron', 'star', 'microarc', 'crystal', 'icicle', 'bubble', 'drop', 'splash', 'beam', 'speedline', 'spiral', 'pip'],
  auraMotif: ['edge', 'runes', 'gust', 'glint', 'bloom', 'ward', 'blades', 'veil'],
  activation: ['ring', 'pillar', 'sigil', 'shout'],
  body: ['S', 'M', 'L', 'W'],
  tell: ['chevron', 'arrow', 'bead', 'lock', 'edge', 'fizzle'],
} as const;

const isIn = (v: unknown, xs: readonly unknown[]): boolean => xs.includes(v);
const isInt = (v: unknown): boolean => typeof v === 'number' && Number.isInteger(v);
const isVsyncTotal = (ms: number): boolean => ms > 0 && Math.abs(ms - Math.round(ms / VSYNC) * VSYNC) <= 0.5;

function paramProblems(p: VfxPiece): string[] {
  const bad: string[] = [];
  const need = (ok: boolean, what: string): void => {
    if (!ok) bad.push(what);
  };
  switch (p.component) {
    case 'slash': {
      const q = p.params;
      need(isIn(q.r, REACH_BUCKETS), `slash.r ${q.r}`);
      need(isIn(q.arc, ARC_BUCKETS), `slash.arc ${q.arc}`);
      need(q.rakes === 1 || q.rakes === 3, 'slash.rakes');
      need(q.form === 'arc' || q.form === 'chop', 'slash.form');
      need(isIn(q.weight, ENUMS.weight), 'slash.weight');
      need(isIn(q.tier, [0, 1, 2, 3]), 'slash.tier');
      need(q.sense === 1 || q.sense === -1, 'slash.sense');
      need(typeof q.rune === 'boolean', 'slash.rune');
      break;
    }
    case 'thrust': {
      const q = p.params;
      need(isIn(q.len, REACH_BUCKETS), `thrust.len ${q.len}`);
      need(isIn(q.weight, ENUMS.weight), 'thrust.weight');
      need(isIn(q.tier, [0, 1, 2, 3]), 'thrust.tier');
      need(typeof q.slit === 'boolean', 'thrust.slit');
      break;
    }
    case 'orb': {
      const q = p.params;
      need(isIn(q.form, ENUMS.orb), `orb.form ${q.form}`);
      need(isIn(q.cell, CELL_BUCKETS), 'orb.cell');
      need(q.orbit === undefined || isIn(q.orbit, ENUMS.orbit), 'orb.orbit');
      need(typeof q.halo === 'boolean', 'orb.halo');
      need(q.mode === 'fly' || q.mode === 'charge', 'orb.mode');
      break;
    }
    case 'missile': {
      const q = p.params;
      need(isIn(q.form, ENUMS.missile), `missile.form ${q.form}`);
      need(isIn(q.cell, CELL_BUCKETS), 'missile.cell');
      need(typeof q.halo === 'boolean', 'missile.halo');
      need(q.pose === 'fly' || q.pose === 'wrap', 'missile.pose');
      break;
    }
    case 'bolt': {
      const q = p.params;
      need(Number.isFinite(q.dx) && Number.isFinite(q.dy) && Math.hypot(q.dx, q.dy) <= VFX_BUDGET.boltMaxLen, 'bolt.len');
      need(Math.hypot(q.dx, q.dy) >= 4, 'bolt.len>=4');
      need(q.jag > 0 && q.jag <= 1 && q.forks >= 0 && q.forks <= 1, 'bolt.jag/forks');
      need(q.strength > 0 && q.strength <= 1, 'bolt.strength');
      need(q.seq === 'chain' || q.seq === 'zap', 'bolt.seq');
      need(isInt(q.seed) && q.seed >= 0, 'bolt.seed');
      break;
    }
    case 'burst': {
      const q = p.params;
      need(isIn(q.cls, ENUMS.burst), `burst.cls ${q.cls}`);
      need(q.size === 's' || q.size === 'm' || q.size === 'l', 'burst.size');
      need(q.glyph === undefined || isIn(q.glyph, ELEMENTS), 'burst.glyph');
      need(q.glyph === undefined || q.cls === 'strong', 'burst.glyph only on strong');
      break;
    }
    case 'motes':
      need(isIn(p.params.kind, ENUMS.mote), `motes.kind ${p.params.kind}`);
      need(isIn(p.params.size, [1, 2, 3]), 'motes.size');
      break;
    case 'puff':
      need(isIn(p.params.kind, ENUMS.puff), 'puff.kind');
      need(isIn(p.params.r, [3, 5, 7, 10]), 'puff.r');
      break;
    case 'ring': {
      const q = p.params;
      need(isInt(q.r) && q.r >= 2 && q.r <= 512, `ring.r ${q.r}`);
      need(q.r0 === undefined || (isInt(q.r0) && q.r0 >= 0 && q.r0 <= 512), `ring.r0 ${q.r0}`);
      need(q.anim === 'expand' ? (q.r0 ?? 0) < q.r : q.anim === 'contract' ? (q.r0 ?? 0) > q.r : true, 'ring.r0 vs anim');
      need(q.aspect === 1 || q.aspect === 0.65, 'ring.aspect');
      need(isIn(q.thick, [1, 2, 3, 4]), 'ring.thick');
      need(isIn(q.style, ENUMS.ringStyle), 'ring.style');
      need(isIn(q.ink, ENUMS.ringInk), 'ring.ink');
      need(isIn(q.anim, ENUMS.ringAnim), 'ring.anim');
      need(q.arc === undefined || (q.arc[0] < q.arc[1] && q.arc[1] - q.arc[0] <= 360 && isInt(q.arc[0]) && isInt(q.arc[1])), 'ring.arc');
      need(q.heads === undefined || isIn(q.heads, [1, 2, 3]), 'ring.heads');
      need(isVsyncTotal(q.ms), `ring.ms ${q.ms}`);
      break;
    }
    case 'decal': {
      const q = p.params;
      need(isIn(q.kind, ENUMS.decal), 'decal.kind');
      need(isIn(q.r, DECAL_BUCKETS), `decal.r ${q.r}`);
      need(q.aspect === 1 || q.aspect === 0.65, 'decal.aspect');
      need(isIn(q.density, [0.125, 0.25, 0.5]), 'decal.density');
      need(q.shape === 'disc' || q.shape === 'line', 'decal.shape');
      need((p.lifeMs ?? 0) <= (q.kind === 'pool' ? VFX_BUDGET.decals.poolLifeMs : VFX_BUDGET.decals.lifeMs) || p.layer === 'tell' || p.layer === 'preview', 'decal.life');
      break;
    }
    case 'sigil': {
      const q = p.params;
      need(isIn(q.r, SIGIL_BUCKETS), 'sigil.r');
      need(isIn(q.points, [5, 6, 7, 8]), 'sigil.points');
      need(isIn(q.glyphs, [0, 4, 8]), 'sigil.glyphs');
      need(isIn(q.anim, ['draw', 'flash', 'static']), 'sigil.anim');
      break;
    }
    case 'nova':
      need(isIn(p.params.core, ENUMS.core), 'nova.core');
      need(isIn(p.params.c, CORE_BUCKETS), 'nova.c');
      need(typeof p.params.heavy === 'boolean', 'nova.heavy');
      break;
    case 'erupt':
      need(isIn(p.params.unit, ENUMS.unit), 'erupt.unit');
      need(isIn(p.params.scale, ['s', 'm', 'l']), 'erupt.scale');
      break;
    case 'status':
      need(isIn(p.params.kind, STATUS_KINDS), 'status.kind');
      need(isIn(p.params.unit, ENUMS.statusUnit), 'status.unit');
      need(isIn(p.params.body, ENUMS.body), 'status.body');
      break;
    case 'aura': {
      const q = p.params;
      need(isIn(q.motif, ENUMS.auraMotif), 'aura.motif');
      need(isIn(q.phase, ['activate', 'loop', 'break']), 'aura.phase');
      need(isIn(q.activation, ENUMS.activation), 'aura.activation');
      need(isIn(q.body, ENUMS.body), 'aura.body');
      need(typeof q.halo === 'boolean', 'aura.halo');
      break;
    }
    case 'tell':
      need(isIn(p.params.piece, ENUMS.tell), 'tell.piece');
      need(typeof p.params.danger === 'boolean', 'tell.danger');
      break;
    case 'afterimage':
      need(p.params.mode === 'ghost' || p.params.mode === 'blink' || p.params.mode === 'mirror', 'afterimage.mode');
      need(p.params.steps.length > 0 && p.params.steps.every((a, i, xs) => a > 0 && a < 1 && (i === 0 || a < xs[i - 1])), 'afterimage.steps');
      break;
  }
  return bad;
}

/**
 * Why a piece is invalid for an owner (empty when valid): bucket values, enums, frame-time totals, blend and
 * layer policy (P8), and the readability rule that danger, dashed marching rims and converging motes belong to
 * monsters only (P10).
 */
export function pieceProblems(p: VfxPiece, owner: VfxOwner): string[] {
  const bad: string[] = [];
  const need = (ok: boolean, what: string): void => {
    if (!ok) bad.push(what);
  };
  need(isIn(p.component, COMPONENT_IDS), `component ${p.component}`);
  need(isIn(p.ramp, RAMP_IDS), `ramp ${p.ramp}`);
  need(isIn(p.motif, FAMILY_IDS), `motif ${p.motif}`);
  need(isIn(p.lut, LUTS), `lut ${p.lut}`);
  need(isIn(p.blend, BLENDS), `blend ${p.blend}`);
  need(isIn(p.layer, LAYERS), `layer ${p.layer}`);
  need(isIn(p.anchor.to, ANCHORS) && isInt(p.anchor.dy) && (p.anchor.along === undefined || isInt(p.anchor.along)), 'anchor');
  need(p.delayMs === undefined || (isInt(p.delayMs) && p.delayMs >= 0), `delayMs ${p.delayMs}`);
  need(p.lifeMs === undefined || (isInt(p.lifeMs) && p.lifeMs > 0), `lifeMs ${p.lifeMs}`);
  for (const t of p.tags ?? []) need(isIn(t, TAGS), `tag ${t}`);
  if (p.place) {
    const pl = p.place;
    need(isIn(pl.pattern, PATTERNS), `place.pattern ${pl.pattern}`);
    need(pl.count === undefined || (isInt(pl.count) && pl.count >= 1 && pl.count <= 24), `place.count ${pl.count}`);
    need(pl.radius === undefined || (isInt(pl.radius) && pl.radius >= 0), `place.radius ${pl.radius}`);
    need(pl.everyPx === undefined || (isInt(pl.everyPx) && pl.everyPx >= 1), 'place.everyPx');
    need(pl.staggerMs === undefined || (isInt(pl.staggerMs) && pl.staggerMs >= 0), 'place.staggerMs');
    if (p.component === 'erupt') need((pl.count ?? 1) <= VFX_BUDGET.perEvent.novaUnits, 'erupt count > novaUnits');
  }
  if (p.move) need(isInt(p.move.from.x) && isInt(p.move.from.y) && isInt(p.move.ms) && p.move.ms > 0, 'move');
  // Blend policy (P8): ADD only for glow twins / light pools of glowing families; MULTIPLY only for scorch and ink.
  if (p.blend === 'add') {
    need(p.layer === 'glow' || p.layer === 'light', 'add outside glow/light');
    need(!isIn(p.ramp, NO_ADD), `add in ${p.ramp}`);
  }
  if (p.blend === 'multiply') need(p.component === 'decal' && (p.params.kind === 'scorch' || p.params.kind === 'ink'), 'multiply on non scorch/ink');
  // Gameplay cues are >= 2 px (rims, fronts).
  if (p.component === 'ring' && (p.layer === 'tell' || p.layer === 'rim' || p.layer === 'preview')) need(p.params.thick >= VFX_BUDGET.cueMinPx, 'cue ring thinner than 2 px');
  // Telegraph pieces are never governed.
  if (p.layer === 'tell' || p.layer === 'rim') need((p.tags ?? []).includes('neverGoverned'), 'tell piece not neverGoverned');
  if (owner === 'player') {
    need(p.ramp !== 'danger' && p.motif !== 'danger', 'danger in a player piece');
    need(p.lut !== 'monster', 'monster LUT in a player piece');
    need(!(p.component === 'ring' && p.params.style === 'dashed' && p.params.anim === 'march'), 'dashed march ring in a player piece');
    need(p.place?.pattern !== 'converge', 'converge motes in a player piece');
    need(!(p.component === 'tell' && p.params.danger), 'danger tell in a player piece');
    need(p.layer !== 'tell' && p.layer !== 'rim', 'telegraph layer in a player piece');
  } else {
    need(p.ramp === 'danger' || p.motif !== 'danger', 'danger motif on a non-danger ramp');
  }
  return [...bad, ...paramProblems(p)];
}

/** Every piece of a recipe (phases and riders), for checks. */
export function recipePieces(r: VfxRecipe): VfxPiece[] {
  const out: VfxPiece[] = [];
  for (const ph of PHASE_IDS) out.push(...(r.phases[ph] ?? []));
  const rd = r.riders;
  if (rd.returns) out.push(...rd.returns.turn, ...rd.returns.tether, ...rd.returns.catch);
  if (rd.reprise) out.push(...rd.reprise.ghost);
  if (rd.arc) out.push(...rd.arc.zap);
  if (rd.leech) out.push(...rd.leech.stream, ...rd.leech.arrive);
  if (rd.knockback) out.push(...rd.knockback.push);
  if (rd.pierce) out.push(...rd.pierce.mark);
  if (rd.merge) out.push(...rd.merge.pieces);
  return out;
}
