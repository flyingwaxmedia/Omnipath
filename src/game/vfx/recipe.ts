// deriveVfx: SkillDef -> VfxRecipe (docs/VFX.md §6-§7). Package R.
//
// One data-driven pipeline: the carrier (what the effect is made of) comes from the skill's ROOT (the authored base,
// or a shape merge's primary parent), so element infusions only repaint it and essences only tune it; numbers come
// from the composed shape, so every effect is as big as its hit test. Signature patches run last (signatures.ts).
// Phaser-free and pure: no clock, no Math.random, no ctx.rotate.
import type { ComboId } from '../../core/combat';
import { mergeSkills, parseVariantId, SHAPE_PRIORITY, shapeHits } from '../../core/compose';
import { hashSeed } from '../../core/rng';
import type { BuffStat, ElementId, SkillDef, SkillShape, StatusKind } from '../../core/types';
import { GAME_DATA } from '../../data';
import { elementStatus, familyOf, lookOf, mayGlow, type FamilyLook, type Overlay } from './families';
import { cellFor, piece, reink, tag, vsync, type Ink } from './pieces';
import { SIGNATURES } from './signatures';
import {
  ANCHOR_DY,
  ARC_BUCKETS,
  CORE_BUCKETS,
  DECAL_BUCKETS,
  REACH_BUCKETS,
  SIGIL_BUCKETS,
  VFX_BUDGET,
  VFX_VERSION,
  ZONE_ASPECT,
  floorBucket,
  nearestBucket,
  type AnchorTo,
  type Aspect,
  type AttackerLook,
  type AuraActivation,
  type AuraMotif,
  type BodySize,
  type BurstClass,
  type Carrier,
  type ChainMode,
  type DashMode,
  type FamilyId,
  type HitGeometry,
  type HitOutcome,
  type LutVariant,
  type MergeAccent,
  type MissileForm,
  type OrbForm,
  type OrbitMotif,
  type PhaseId,
  type PieceTag,
  type RampId,
  type RiderFx,
  type SpinStyle,
  type StrikeStyle,
  type UnitKind,
  type VfxAnchor,
  type VfxExtraEvents,
  type VfxJuice,
  type VfxOwner,
  type VfxPiece,
  type VfxRecipe,
  type VfxTier,
  type VfxWeight,
} from './types';

export { familyOf };

// ------------------------------------------------------------------ ground truth (docs/VFX.md §8.1)

/** Gameplay numbers the effects must match (SkillSystem / MonsterSkills / Combat). */
export const GROUND_TRUTH = {
  swingMs: { player: 130, monster: 220 },
  pulseMs: { player: 170, monster: 260 },
  /** Player nova delay when the shape has none. */
  novaDelayMs: 200,
  monsterNovaMinMs: 500,
  /** Monster telegraph length per shape (novas: max(500, delay)); a technique's castMs adds to it. */
  tellMs: { strike: 300, spin: 400, projectile: 300, dash: 400, chain: 300, buff: 400 },
  /** Player dash time; the hit resolves at 60 %. Monster dashes take max(140, len / 1.1) ms. */
  dashMs: 170,
  chainHopPx: 150,
  chainStepMs: { bolt: 60, knife: 90 },
  arcRiderPx: 120,
  /** Status durations (ms); knockback and pull are one-shots. */
  statusMs: { burn: 1600, poison: 4000, bleed: 2000, slow: 2200, soak: 2200, freeze: 2200, stun: 650, shock: 1200, smite: 1000, knockback: 300, pull: 400 },
  /** Monster dashes are at least this wide (MonsterSkills). */
  monsterLaneMinPx: 24,
} as const;

/** Monster telegraph length (ms) for a technique, wind-up included (MonsterSkills.begin). */
export function monsterTellMs(skill: SkillDef): number {
  const sh = skill.shape;
  const base = sh.kind === 'nova' ? Math.max(GROUND_TRUTH.monsterNovaMinMs, sh.delay ?? 0) : GROUND_TRUTH.tellMs[sh.kind];
  return base + (skill.castMs ?? 0);
}

/** Exact hit-test geometry of a skill for an owner (docs/VFX.md §8.1). */
export function hitGeometry(skill: SkillDef, owner: VfxOwner): HitGeometry {
  const sh = skill.shape;
  const monster = owner === 'monster';
  switch (sh.kind) {
    case 'strike':
      return { kind: 'sector', r: sh.range, arcDeg: sh.arc, addCasterRadius: monster };
    case 'spin':
      return { kind: 'disc', r: sh.radius, aspect: monster ? ZONE_ASPECT : 1, at: 'caster', addCasterRadius: monster };
    case 'nova':
      return { kind: 'disc', r: sh.radius, aspect: monster ? ZONE_ASPECT : 1, at: 'aim', addCasterRadius: false };
    case 'projectile': {
      const count = sh.count ?? 1;
      return {
        kind: 'shot',
        size: sh.size ?? 12,
        range: sh.range,
        speed: sh.speed,
        count,
        spreadDeg: sh.spread ?? (monster && count > 1 ? 30 : 0),
        radial: !monster && !!sh.radial,
        pierce: sh.pierce ?? 0,
      };
    }
    case 'dash':
      return { kind: 'lane', length: sh.distance, width: monster ? Math.max(GROUND_TRUTH.monsterLaneMinPx, sh.width) : sh.width };
    case 'chain':
      // MonsterSkills zaps the player once (no hops); SkillSystem hops up to `jumps` times within 150 px.
      return monster ? { kind: 'chain', range: sh.range, hop: 0, jumps: 0 } : { kind: 'chain', range: sh.range, hop: GROUND_TRUTH.chainHopPx, jumps: sh.jumps };
    case 'buff':
      return { kind: 'self' };
  }
}

/** Statuses a hit applies: Combat.hit for players (element, own, knockback rider), MonsterSkills.statusesOf for monsters. */
export function statusesFor(skill: SkillDef, owner: VfxOwner): StatusKind[] {
  const out: StatusKind[] = [];
  const add = (k: StatusKind | undefined): void => {
    if (k && !out.includes(k) && !(owner === 'monster' && k === 'smite')) out.push(k);
  };
  if (skill.element) add(elementStatus(skill.element));
  add(skill.status);
  if (owner === 'player' && skill.riders?.knockback) add('knockback');
  return out;
}

// ------------------------------------------------------------------ helpers

const AUTHORED = new Map<string, SkillDef>(GAME_DATA.skills.map((s) => [s.id, s]));
const MONSTERS = new Map(GAME_DATA.monsters.map((m) => [m.id, m]));
const authoredLookup = (id: string): SkillDef | undefined => AUTHORED.get(id);

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));
const round = Math.round;
/** Strike / thrust reach bucket for a true range (40..128). */
export const reachBucket = (range: number): number => nearestBucket(clamp(range, REACH_BUCKETS[0], REACH_BUCKETS[REACH_BUCKETS.length - 1]), REACH_BUCKETS);
/** Arc bucket for a true arc (60..360). */
export const arcBucket = (arc: number): number => nearestBucket(clamp(arc, ARC_BUCKETS[0], ARC_BUCKETS[ARC_BUCKETS.length - 1]), ARC_BUCKETS);
const decalR = (r: number): number => floorBucket(r, DECAL_BUCKETS);
const coreC = (r: number): 24 | 40 | 56 => floorBucket(Math.min(r, 56), CORE_BUCKETS) as 24 | 40 | 56;
const sigilR = (r: number): 16 | 24 | 32 | 48 => floorBucket(r, SIGIL_BUCKETS) as 16 | 24 | 32 | 48;
const halfArc = (arc: number): readonly [number, number] => {
  const h = round(Math.min(360, arc) / 2);
  return [-h, h];
};
const STEPS3: readonly number[] = [0.6, 0.4, 0.2];
const MIRROR_STEPS: readonly number[] = [0.75, 0.5, 0.25];
const BLUNT_BODIES: ReadonlySet<string> = new Set(['hammer', 'cleaver', 'rock', 'net', 'glob']);
const NATIVE_MATTER: ReadonlySet<string> = new Set(['shard', 'glob', 'rock', 'feather']);

/** Merge parents in compose.mergeOrder order: higher SHAPE_PRIORITY, then higher tier, then the lower id. */
export function mergeParents(a: SkillDef, b: SkillDef): [SkillDef, SkillDef] {
  const d = SHAPE_PRIORITY[b.shape.kind] - SHAPE_PRIORITY[a.shape.kind] || b.tier - a.tier || (a.id < b.id ? -1 : 1);
  return d < 0 ? [a, b] : [b, a];
}

interface Root {
  root: SkillDef;
  rootId: string;
  /** Shape merges: the raw merge (no element / essences) and its secondary parent. */
  merge?: { raw: SkillDef; secondary: SkillDef };
}

/** The skill a variant's carrier comes from: authored base, or a merge's primary parent (docs/VFX.md §6.1 step 1). */
export function rootOf(skill: SkillDef, lookup: (id: string) => SkillDef | undefined = authoredLookup): Root {
  const parts = parseVariantId(skill.id);
  if (!parts) return { root: skill, rootId: skill.id };
  if (parts.merge) {
    const a = lookup(parts.merge[0]);
    const b = lookup(parts.merge[1]);
    const raw = a && b ? mergeSkills(a, b) : null;
    if (!a || !b || !raw) return { root: skill, rootId: skill.id };
    const [primary, secondary] = mergeParents(a, b);
    return { root: primary, rootId: primary.id, merge: { raw, secondary } };
  }
  const base = parts.base === skill.id ? skill : (lookup(parts.base) ?? skill);
  return { root: base, rootId: base.id };
}

// ------------------------------------------------------------------ context

interface Ctx {
  skill: SkillDef;
  root: SkillDef;
  rootId: string;
  owner: VfxOwner;
  monster: boolean;
  /** Echo techniques keep one silhouette for both owners (no monster cell bump or halo). */
  echoSkill: boolean;
  has: (tag: string) => boolean;
  /** familyOf(root): carrier rules read it. */
  rootFamily: FamilyId;
  /** Palette family of the recipe (material family for matter carriers). */
  family: FamilyId;
  imbue?: ElementId;
  /** imbue ?? family: overlays, trails, impact spokes and statuses. */
  accent: FamilyId;
  echo?: FamilyId;
  weight: VfxWeight;
  tier: VfxTier;
  lut: LutVariant;
  ink: Ink;
  acc: Ink;
  /** Carrier language: the ROOT family's look (ring styles, cores), so infusions never change bake keys. */
  look: FamilyLook;
  /** Overlay language: the accent family's look (motes, trails, units, decals). */
  accLook: FamilyLook;
  geometry: HitGeometry;
  castMs: number;
  mods: ReadonlySet<string>;
  aspect: Aspect;
  /** Tags for pieces whose radius the event fixes (monster rims around the caster). */
  geoTags: readonly PieceTag[];
}

const inkOf = (family: FamilyId, lut: LutVariant): Ink => ({ ramp: family, motif: family, lut });
const utilInk = (c: Pick<Ctx, 'accent' | 'lut'>, ramp: RampId): Ink => ({ ramp, motif: c.accent, lut: c.lut });
const DANGER: Ink = { ramp: 'danger', motif: 'danger', lut: 'base' };

function weightOf(root: SkillDef, mods: ReadonlySet<string>): VfxWeight {
  const castMs = root.castMs ?? 0;
  let w: VfxWeight =
    root.tier >= 3 && (root.power >= 3 || castMs >= 500)
      ? 'ultimate'
      : root.tags.includes('heavy') || root.tags.includes('execute') || root.power >= 2
        ? 'heavy'
        : root.tags.includes('basic') || (root.tags.includes('monster') && root.power < 1)
          ? 'light'
          : 'normal';
  if (mods.has('heavy') && (w === 'light' || w === 'normal')) w = w === 'light' ? 'normal' : 'heavy';
  return w;
}

const isHeavy = (w: VfxWeight): boolean => w === 'heavy' || w === 'ultimate';

// ------------------------------------------------------------------ carriers (docs/VFX.md §6.2)

function strikeStyle(c: Pick<Ctx, 'has' | 'root'>): StrikeStyle {
  const h = c.has;
  if (h('execute')) return 'execute';
  if (h('aoe') && c.root.element && !h('melee')) return 'cone';
  if (h('arcane') && !h('blade')) return 'staff';
  if (h('pierce') && !h('blade')) return 'thrust';
  if (!h('blade') && !h('pierce') && (h('technique') || h('spirit'))) return 'fist';
  return 'crescent';
}

function spinStyle(c: Pick<Ctx, 'has' | 'root' | 'rootFamily' | 'monster'>): SpinStyle {
  const h = c.has;
  if (c.root.status === 'pull') return 'vortex';
  if (c.rootFamily === 'holy') return 'halo';
  if (c.monster && c.rootFamily === 'shadow') return 'wail';
  if (h('spirit') && !h('blade')) return 'ripple';
  if (!h('blade') && !h('pierce')) return 'ring';
  return 'blades';
}

interface Body {
  form: OrbForm | MissileForm;
  matter: boolean;
}

function projectileBody(c: Pick<Ctx, 'has' | 'root' | 'rootFamily'>, size: number): Body {
  const h = c.has;
  const el = c.root.element;
  const st = c.root.status;
  const m = (form: MissileForm): Body => ({ form, matter: true });
  const e = (form: OrbForm): Body => ({ form, matter: false });
  if (h('blade') && h('heavy')) return m('cleaver');
  if (h('blade') && h('arcane')) return e('spellblade');
  if (h('blade')) return m('blade');
  if (h('pierce') && !h('arcane')) return m(h('stealth') ? 'needle' : el === 'wind' ? 'dart' : 'knife');
  if (h('heavy')) return m('hammer');
  if (st === 'pull' && !h('arcane')) return m('hook');
  if (st === 'slow' && !h('arcane') && size >= 24) return m('net');
  if (!el && st === 'bleed') return m('thorn');
  if (el === 'ice') return m('shard');
  if (el === 'magma') return m('glob');
  if (el === 'earth') return m('rock');
  if (el === 'wind') return h('echo') ? m('feather') : e('gust');
  if (el === 'water') return e(size >= 14 ? 'bubble' : 'droplet');
  return e(lookOf(c.rootFamily).orb);
}

function dashMode(c: Pick<Ctx, 'has' | 'skill' | 'rootFamily' | 'monster'>): DashMode {
  const sh = c.skill.shape;
  if (sh.kind === 'dash' && sh.spin) return 'spin';
  if (c.has('stealth') || c.has('arcane')) return 'blink';
  if (c.has('heavy')) return 'charge';
  if (c.rootFamily === 'storm' || (c.monster && c.rootFamily === 'shadow')) return 'dive';
  return 'ghost';
}

function chainMode(c: Pick<Ctx, 'has'>): ChainMode {
  if (c.has('projectile') || c.has('pierce')) return c.has('blade') ? 'blade' : 'knife';
  if (c.has('spirit') && c.has('melee')) return 'palm';
  return 'bolt';
}

const BUFF_MOTIF: Readonly<Record<BuffStat, AuraMotif>> = { atk: 'edge', matk: 'runes', speed: 'gust', crit: 'glint', regen: 'bloom', def: 'ward' };

function buffActivation(c: Pick<Ctx, 'has' | 'rootFamily'>, stat: BuffStat): AuraActivation {
  if (c.rootFamily === 'holy') return 'pillar';
  if (c.has('arcane')) return 'sigil';
  if (c.has('technique') && stat === 'atk') return 'shout';
  return 'ring';
}

function novaUnit(rootId: string, family: FamilyId): UnitKind {
  const unit = lookOf(family).unit;
  return unit === 'rock-spike' && /geode|crystal/.test(rootId) ? 'crystal-spike' : unit;
}

function carrierOf(c: Ctx): Carrier {
  const sh = c.skill.shape;
  switch (sh.kind) {
    case 'strike':
      return { kind: 'strike', style: strikeStyle(c) };
    case 'spin':
      return { kind: 'spin', style: spinStyle(c) };
    case 'projectile': {
      const b = projectileBody(c, sh.size ?? 12);
      return { kind: 'projectile', body: b.form, matter: b.matter };
    }
    case 'dash':
      return { kind: 'dash', mode: dashMode(c) };
    case 'nova':
      return { kind: 'nova', core: c.root.status === 'pull' || c.has('gravity') ? 'implode' : lookOf(c.rootFamily).core, unit: novaUnit(c.rootId, c.family) };
    case 'chain':
      return { kind: 'chain', mode: chainMode(c) };
    case 'buff':
      return { kind: 'buff', motif: BUFF_MOTIF[sh.stat] };
  }
}

/** True when the carrier is solid matter that keeps its material ramp (steel) and carries the element as imbue. */
function carrierMatter(car: Carrier): { matter: boolean; native: boolean } {
  if (car.kind === 'projectile') return { matter: car.matter, native: NATIVE_MATTER.has(car.body) };
  if (car.kind === 'chain') return { matter: car.mode === 'knife' || car.mode === 'blade', native: false };
  return { matter: false, native: false };
}

// ------------------------------------------------------------------ phase builders

type Phases = { [K in PhaseId]?: VfxPiece[] };

const push = (ph: Phases, id: PhaseId, ...ps: VfxPiece[]): void => {
  (ph[id] ??= []).push(...ps);
};

const at = (to: AnchorTo, dy = 0, along?: number): VfxAnchor => (along === undefined ? { to, dy } : { to, dy, along: round(along) });

/** Family overlay motes / puff placed along a pattern. */
function overlay(ink: Ink, ov: Overlay, anchor: VfxAnchor, place: VfxPiece['place'], delayMs?: number): VfxPiece[] {
  const out: VfxPiece[] = [];
  if (ov.mote) out.push(piece('motes', { kind: ov.mote, size: ov.size }, ink, { anchor, place, delayMs }));
  if (ov.puff) out.push(piece('puff', { kind: ov.puff, r: 3 }, ink, { anchor, place: place && { ...place, count: Math.min(3, place.count ?? 3) }, delayMs }));
  return out;
}

function chargePieces(c: Ctx, carrier: Carrier): VfxPiece[] {
  const life = c.castMs;
  const hand = at('caster', ANCHOR_DY.hand);
  const cell = c.weight === 'ultimate' ? 32 : c.weight === 'heavy' ? 24 : 16;
  const out: VfxPiece[] = [
    piece('orb', { form: c.accLook.orb, cell, halo: false, mode: 'charge' }, c.acc, { anchor: hand, lifeMs: life }),
    piece('motes', { kind: c.accLook.trail.mote ?? 'mote', size: 1 }, c.acc, { anchor: hand, place: { pattern: 'orbit', count: isHeavy(c.weight) ? 3 : 2, radius: 10 }, lifeMs: life }),
  ];
  const sh = c.skill.shape;
  const preview = (p: VfxPiece): VfxPiece => tag({ ...p, layer: 'preview', lifeMs: life } as VfxPiece, 'geometryFromEvent');
  const rim = (r: number, arc?: readonly [number, number]) =>
    piece('ring', { r, aspect: 1, thick: 2, style: 'solid', ink: 'mid', anim: 'static', ms: vsync(life), ...(arc ? { arc } : {}) }, c.ink, { anchor: at(sh.kind === 'nova' ? 'aim' : 'caster') });
  if (sh.kind === 'strike' && carrier.kind === 'strike') out.push(preview(rim(sh.range, halfArc(sh.arc))));
  if (sh.kind === 'spin') out.push(preview(rim(sh.radius)));
  if (sh.kind === 'nova') out.push(preview(rim(sh.radius)));
  if (sh.kind === 'dash' && sh.width > 0) {
    out.push(preview(piece('tell', { piece: 'bead', danger: false }, c.ink, { anchor: at('caster'), place: { pattern: 'line', count: clamp(round(sh.distance / 12), 4, 24), radius: sh.distance, spacing: round(sh.width) } })));
  }
  return out;
}

function strikePieces(c: Ctx, style: StrikeStyle, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'strike' }>;
  const r = reachBucket(sh.range);
  const arc = arcBucket(sh.arc);
  const anchor = at('caster', c.monster ? ANCHOR_DY.strike : ANCHOR_DY.swing);
  const slash = (rr: number, aa: number, extra: Partial<{ form: 'arc' | 'chop'; rune: boolean; sense: 1 | -1; weight: VfxWeight }> = {}, along?: number): VfxPiece =>
    piece('slash', { r: rr, arc: aa, rakes: 1, form: 'arc', weight: c.weight, tier: c.tier, sense: 1, rune: false, ...extra }, c.ink, { anchor: along === undefined ? anchor : { ...anchor, along: round(along) }, tags: ['hero'] });
  const edge = (radius: number, spread: number): VfxPiece[] =>
    c.accent !== 'steel' || c.tier >= 2 ? overlay(c.acc, c.accLook.strike, anchor, { pattern: 'rim', count: Math.min(8, 3 + c.tier), radius, spreadDeg: spread }, 33) : [];
  switch (style) {
    case 'execute':
      push(ph, 'cast', slash(r, ARC_BUCKETS[0], { form: 'chop', weight: c.weight === 'ultimate' ? 'ultimate' : 'heavy' }, sh.range * 0.6), ...edge(round(sh.range * 0.6), 60));
      break;
    case 'cone': {
      const n = clamp(round(sh.arc / 7), 8, 14);
      const stream = { pattern: 'burst' as const, count: n, radius: sh.range, spreadDeg: sh.arc, speed: round(sh.range / 0.3) };
      const feet = at('caster', 0);
      if (c.look.cone) push(ph, 'cast', piece('puff', { kind: c.look.cone, r: 5 }, c.ink, { anchor: feet, place: stream }));
      else push(ph, 'cast', piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: feet, place: stream }));
      if (c.accLook.trail.mote) push(ph, 'cast', piece('motes', { kind: c.accLook.trail.mote, size: 1 }, c.acc, { anchor: feet, place: { ...stream, count: Math.min(8, n) } }));
      push(ph, 'cast', piece('ring', { r: sh.range, aspect: 1, thick: 2, style: c.look.ring === 'double' ? 'double' : 'solid', ink: 'lit', anim: 'static', arc: halfArc(sh.arc), ms: 150 }, c.ink, { anchor: feet, layer: 'ground', delayMs: 100, tags: ['geometryFromEvent'] }));
      break;
    }
    case 'staff':
      push(
        ph,
        'cast',
        slash(reachBucket(sh.range * 0.8), arcBucket(sh.arc * 0.6)),
        piece('sigil', { r: 16, points: 5, glyphs: 0, anim: 'flash' }, c.ink, { anchor: { ...anchor, along: round(sh.range) } }),
        ...edge(round(sh.range * 0.8), round(sh.arc * 0.6)),
      );
      break;
    case 'thrust':
      push(ph, 'cast', piece('thrust', { len: r, weight: c.weight, tier: c.tier, slit: c.has('stealth') }, c.ink, { anchor, tags: ['hero'] }));
      if (c.has('toxin')) push(ph, 'cast', piece('motes', { kind: 'droplet', size: 1 }, utilInk(c, 'toxin'), { anchor: { ...anchor, along: round(sh.range) }, place: { pattern: 'fall', count: 2 }, delayMs: 50 }));
      if (c.accent !== 'steel' && c.accent !== 'toxin') push(ph, 'cast', ...overlay(c.acc, c.accLook.strike, { ...anchor, along: round(sh.range) }, { pattern: 'burst', count: 3, spreadDeg: 40 }, 33));
      break;
    case 'fist': {
      const tip = { ...anchor, along: round(sh.range * 0.8) };
      push(
        ph,
        'cast',
        piece('burst', { cls: 'ki', size: isHeavy(c.weight) ? 'l' : 'm' }, c.ink, { anchor: tip }),
        piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: tip, place: { pattern: 'burst', count: 3, spreadDeg: 30 } }),
      );
      if (c.root.status === 'knockback' || c.root.riders?.knockback) push(ph, 'cast', slash(40, 90, { sense: -1 }, sh.range * 0.5));
      if (c.accent !== 'steel') push(ph, 'cast', ...overlay(c.acc, c.accLook.strike, tip, { pattern: 'burst', count: 4, spreadDeg: 60 }, 33));
      break;
    }
    case 'claw':
    case 'crescent':
      push(ph, 'cast', slash(r, arc, { rune: c.has('arcane') && c.has('blade') }), ...edge(sh.range, sh.arc));
      break;
  }
  // The final swing of a multi-hit cast gets the tier flourish (docs/VFX.md §5 slash).
  if ((sh.hits ?? 1) > 1 && style !== 'cone') {
    push(ph, 'cast', piece('burst', { cls: 'glint', size: 's' }, c.acc, { anchor: { ...anchor, along: round(sh.range) }, delayMs: 33, tags: ['lastHit'] }));
  }
  if (isHeavy(c.weight) && style !== 'cone') {
    const tip = { to: 'caster' as const, dy: 0, along: round(sh.range * 0.6) };
    push(
      ph,
      'area',
      piece('ring', { r: 24, r0: 8, aspect: 1, thick: 2, style: c.look.ring === 'jagged' ? 'jagged' : 'solid', ink: 'lit', anim: 'expand', ms: 200 }, c.ink, { anchor: tip, layer: 'ground' }),
      piece('decal', { kind: 'cracks', r: 16, aspect: 1, density: 0.5, shape: 'disc' }, utilInk(c, 'dust'), { anchor: tip, layer: 'ground', lifeMs: 800 }),
      piece('motes', { kind: 'chip', size: 2 }, utilInk(c, 'dust'), { anchor: tip, place: { pattern: 'burst', count: 5, spreadDeg: 140 } }),
    );
  }
}

function spinPieces(c: Ctx, style: SpinStyle, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'spin' }>;
  const R = sh.radius;
  const anchor = at('caster', 0);
  const ring = (p: Partial<Extract<VfxPiece, { component: 'ring' }>['params']>, opts: Parameters<typeof piece>[3] = {}) =>
    piece('ring', { r: R, aspect: c.aspect, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', r0: round(R * 0.3), ms: 200, ...p }, c.ink, { anchor, tags: c.geoTags, ...opts });
  const famStyle = c.look.ring === 'dashed' ? 'solid' : c.look.ring;
  switch (style) {
    case 'blades':
      push(ph, 'cast', ring({ r0: undefined, thick: isHeavy(c.weight) ? 4 : 3, ink: 'hot', anim: 'sweep', heads: c.has('pierce') ? 3 : 2, ms: 117 }, { tags: [...c.geoTags, 'hero'] }));
      break;
    case 'ring':
      push(ph, 'cast', ring({ style: famStyle }), ring({ r: round(R * 0.7), r0: round(R * 0.15), thick: 1, ms: 167 }, { delayMs: 33 }));
      break;
    case 'vortex':
      for (let i = 0; i < 3; i++) {
        push(ph, 'cast', ring({ r: R - 5 - 4 * i, r0: R - 4 * i, anim: 'contract', style: famStyle, ms: 167 }, { delayMs: i * 33 }));
      }
      push(ph, 'cast', piece('motes', { kind: c.accLook.spin.mote ?? 'chip', size: 2 }, c.acc, { anchor, place: { pattern: 'spiral', count: 12, radius: R } }));
      break;
    case 'halo':
      push(ph, 'cast', ring({ style: 'double' }), piece('motes', { kind: 'glint', size: 1 }, c.ink, { anchor, place: { pattern: 'rise', count: 8, radius: R } }));
      break;
    case 'wail':
      push(ph, 'cast', ring({ style: 'inverted', thick: 3, ms: 250 }), piece('motes', { kind: 'wisp', size: 2 }, c.ink, { anchor, place: { pattern: 'burst', count: 8, radius: R } }));
      break;
    case 'ripple':
      push(ph, 'cast', ring({ style: 'double' }));
      break;
  }
  if (style !== 'vortex' && style !== 'halo') {
    push(ph, 'cast', ...overlay(c.acc, c.accLook.spin, anchor, { pattern: 'orbit', count: clamp(round(R / 10), 4, VFX_BUDGET.perEvent.spinPulseMotes), radius: R }));
  }
  // Floor band (0 -> R over 300 ms, ink mid -> dim); it flares on the first and last pulse only.
  const band = (ink: 'mid' | 'hot', tags: readonly PieceTag[]) =>
    piece('ring', { r: R, r0: 0, aspect: c.aspect, thick: 1, style: 'solid', ink, anim: 'expand', ms: 300 }, c.ink, { anchor, layer: 'ground', tags: [...c.geoTags, ...tags] });
  push(ph, 'area', band('mid', []));
  if ((sh.pulses ?? 1) > 1) push(ph, 'area', band('hot', ['firstHitOnly']), band('hot', ['lastHit']));
}

function projectilePieces(c: Ctx, body: Body, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'projectile' }>;
  const size = sh.size ?? 12;
  const count = sh.count ?? 1;
  const hand = at('caster', ANCHOR_DY.hand);
  if (count >= 5 || sh.radial) push(ph, 'cast', piece('ring', { r: 28, r0: 12, aspect: 1, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', ms: 200 }, c.acc, { anchor: hand }));
  if (c.mods.has('split')) push(ph, 'cast', piece('burst', { cls: 'split', size: 's' }, c.acc, { anchor: hand, tags: ['hero'] }));
  else if (count < 5 && !sh.radial) push(ph, 'cast', piece('burst', { cls: 'muzzle', size: 's' }, c.acc, { anchor: hand }));
  const up = c.monster && !c.echoSkill ? 1 : 0;
  const halo = c.monster && !c.echoSkill;
  const bodyAt = at('body', 0);
  if (body.matter) {
    push(ph, 'body', piece('missile', { form: body.form as MissileForm, cell: cellFor(size, up), halo, pose: 'fly' }, c.ink, { anchor: bodyAt }));
  } else {
    const big = (sh.pierce ?? 0) >= 99 && size >= 22;
    const orbit: OrbitMotif | undefined = big ? (c.rootFamily === 'arcane' ? 'glyphs' : c.rootFamily === 'ice' ? 'shards' : c.rootFamily === 'water' ? 'spiral' : 'motes') : undefined;
    push(ph, 'body', piece('orb', { form: body.form as OrbForm, cell: cellFor(size, up), halo, mode: 'fly', ...(orbit ? { orbit } : {}) }, c.ink, { anchor: bodyAt }));
  }
  // Trail: family motes by distance; orbs leave ghost discs, knives and plain steel leave afterimages.
  const fast = body.form === 'blade' && sh.speed >= 500;
  const tr = c.accLook.trail;
  if (tr.mote) push(ph, 'trail', piece('motes', { kind: tr.mote, size: tr.size }, c.acc, { anchor: bodyAt, place: { pattern: 'trail', everyPx: fast ? 3 : 5 } }));
  if (tr.puff) push(ph, 'trail', piece('puff', { kind: tr.puff, r: 3 }, c.acc, { anchor: bodyAt, place: { pattern: 'trail', everyPx: 16 } }));
  if (!body.matter) push(ph, 'trail', piece('motes', { kind: 'disc', size: size >= 20 ? 2 : 1 }, c.ink, { anchor: bodyAt, place: { pattern: 'trail', count: 5, everyPx: 4 } }));
  if (body.form === 'knife' || body.form === 'needle' || body.form === 'dart' || (body.matter && !tr.mote)) {
    push(ph, 'trail', piece('afterimage', { mode: 'ghost', steps: STEPS3 }, c.ink, { anchor: bodyAt, place: { pattern: 'trail', count: 3, everyPx: 8 } }));
  }
}

function dashPieces(c: Ctx, mode: DashMode, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'dash' }>;
  const g = c.geometry as Extract<HitGeometry, { kind: 'lane' }>;
  const durMs = c.monster ? Math.max(140, round(sh.distance / 1.1)) : GROUND_TRUTH.dashMs;
  const feet = at('caster', 0);
  const blink = mode === 'blink';
  push(
    ph,
    'cast',
    piece('afterimage', { mode: blink ? 'blink' : 'ghost', steps: STEPS3 }, c.ink, { anchor: at('caster', -1) }),
    blink
      ? piece('puff', { kind: 'veil', r: 5 }, c.ink, { anchor: feet, layer: 'ground', place: { pattern: 'burst', count: 3, radius: 8 } })
      : piece('puff', { kind: 'dust', r: 5 }, utilInk(c, 'dust'), { anchor: feet, layer: 'ground', place: { pattern: 'burst', count: 3, radius: 8 } }),
  );
  if (c.mods.has('haste')) push(ph, 'cast', piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: feet, place: { pattern: 'burst', count: 4, spreadDeg: 30 } }));
  const path = at('path', ANCHOR_DY.swing);
  push(
    ph,
    'trail',
    piece('afterimage', { mode: blink ? 'blink' : 'ghost', steps: STEPS3 }, c.ink, { anchor: at('path', -1), place: { pattern: 'trail', count: 6, everyPx: Math.max(10, Math.ceil(sh.distance / 6)) } }),
    piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: path, place: { pattern: 'line', count: clamp(round(sh.distance / 40), 4, 6), radius: sh.distance, spacing: Math.max(4, round(g.width / 2)) } }),
  );
  if (c.accLook.trail.mote) push(ph, 'trail', piece('motes', { kind: c.accLook.trail.mote, size: 1 }, c.acc, { anchor: path, place: { pattern: 'trail', everyPx: 18 } }));
  const end = at('aim', 0);
  const landR = Math.max(8, round(g.width / 2));
  if (mode === 'charge' || mode === 'dive') {
    push(
      ph,
      'area',
      piece('nova', { core: mode === 'charge' ? 'blast' : c.look.core, c: 24, heavy: mode === 'charge' }, c.ink, { anchor: end, delayMs: durMs, tags: ['hero'] }),
      piece('ring', { r: Math.max(16, landR), r0: 4, aspect: c.aspect, thick: 2, style: c.look.ring === 'dashed' ? 'solid' : c.look.ring, ink: 'lit', anim: 'expand', ms: 217 }, c.ink, { anchor: end, layer: 'ground', delayMs: durMs }),
    );
    if (mode === 'charge') push(ph, 'area', piece('decal', { kind: 'cracks', r: 16, aspect: c.aspect, density: 0.5, shape: 'disc' }, utilInk(c, 'dust'), { anchor: end, layer: 'ground', delayMs: durMs, lifeMs: 800 }));
  }
  if (mode === 'spin') {
    push(ph, 'area', piece('ring', { r: landR, aspect: c.aspect, thick: 3, style: 'solid', ink: 'hot', anim: 'sweep', heads: 2, ms: 117 }, c.ink, { anchor: at('path', 0), place: { pattern: 'path', staggerMs: 67 } }));
  }
}

function novaPieces(c: Ctx, carrier: Extract<Carrier, { kind: 'nova' }>, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'nova' }>;
  const R = sh.radius;
  const aim = at('aim', 0);
  const asp = c.aspect;
  const unit = carrier.unit ?? 'debris';
  const count =
    unit === 'sky-bolt' ? (R < 100 ? 1 : R < 150 ? 2 : 3) : unit === 'light-pillar' ? 1 : Math.min(14, round(clamp(round((Math.PI * R * asp * R) / 1400), 3, 14) * (c.mods.has('expanse') ? 1.3 : 1)));
  const scale = R < 90 ? 's' : R < 140 ? 'm' : 'l';
  const heavy = isHeavy(c.weight);
  push(
    ph,
    'area',
    piece('nova', { core: carrier.core, c: coreC(R), heavy }, c.ink, { anchor: aim, tags: ['hero'] }),
    piece('erupt', { unit, scale }, c.acc, { anchor: aim, place: unit === 'light-pillar' ? { pattern: 'single', count: 1 } : { pattern: 'poisson', count, radius: R, aspect: asp, spacing: 18, wave: true } }),
    piece('ring', { r: R, r0: round(R * 0.45), aspect: asp, thick: 3, style: c.look.ring === 'dashed' ? 'solid' : c.look.ring, ink: 'lit', anim: 'expand', ms: 333 }, c.ink, { anchor: aim, layer: 'ground' }),
    piece('ring', { r: round(R * 0.6), r0: round(R * 0.3), aspect: asp, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 217 }, c.ink, { anchor: aim, layer: 'ground' }),
  );
  if (heavy) push(ph, 'area', piece('ring', { r: round(R * 0.35), r0: round(R * 0.15), aspect: asp, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 150 }, c.ink, { anchor: aim, layer: 'ground' }));
  if (c.mods.has('expanse')) push(ph, 'area', piece('ring', { r: R + 4, r0: R, aspect: asp, thick: 1, style: 'solid', ink: 'dim', anim: 'expand', ms: 333 }, c.ink, { anchor: aim, layer: 'ground' }));
  const decal = c.accLook.decal;
  if (decal) {
    push(
      ph,
      'area',
      piece('decal', { kind: decal, r: decalR(R), aspect: asp, density: 0.5, shape: 'disc' }, c.acc, {
        anchor: aim,
        layer: 'ground',
        blend: decal === 'scorch' || decal === 'ink' ? 'multiply' : 'normal',
        lifeMs: decal === 'pool' ? VFX_BUDGET.decals.poolLifeMs : VFX_BUDGET.decals.lifeMs,
      }),
    );
  }
  if (mayGlow(c.accent)) push(ph, 'area', piece('decal', { kind: 'fill', r: decalR(Math.min(R, 64)), aspect: asp, density: 0.25, shape: 'disc' }, c.acc, { anchor: aim, layer: 'glow', blend: 'add', lifeMs: 100 }));
  if (!c.monster) {
    // Player marker: a 2 px family rim at R + a 12.5 % fill; the rim inks hot in the last 117 ms. Never danger.
    const delay = sh.delay ?? GROUND_TRUTH.novaDelayMs;
    push(
      ph,
      'telegraph',
      piece('ring', { r: R, aspect: 1, thick: 2, style: 'solid', ink: 'lit', anim: 'static', ms: vsync(delay) }, c.ink, { anchor: aim, layer: 'preview', lifeMs: delay }),
      piece('decal', { kind: 'fill', r: decalR(R), aspect: 1, density: 0.125, shape: 'disc' }, c.ink, { anchor: aim, layer: 'preview', lifeMs: delay }),
    );
    if (delay > 117) push(ph, 'telegraph', piece('ring', { r: R, aspect: 1, thick: 2, style: 'solid', ink: 'hot', anim: 'static', ms: 117 }, c.ink, { anchor: aim, layer: 'preview', delayMs: delay - 117, lifeMs: 117 }));
    if (c.has('arcane')) push(ph, 'telegraph', piece('sigil', { r: sigilR(Math.min(48, R / 2)), points: 6, glyphs: 8, anim: 'draw' }, c.ink, { anchor: aim, layer: 'preview', lifeMs: delay }));
  }
}

function chainPieces(c: Ctx, mode: ChainMode, ph: Phases, variety: number): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'chain' }>;
  const hop = at('hop', 0);
  push(ph, 'cast', piece('burst', { cls: 'muzzle', size: 's' }, c.acc, { anchor: at('caster', ANCHOR_DY.chest) }));
  const len = Math.min(sh.range, VFX_BUDGET.boltMaxLen);
  if (mode === 'bolt') {
    push(
      ph,
      'body',
      piece('bolt', { dx: len, dy: 0, jag: 0.32, forks: 0.35, strength: 1, seq: 'chain', seed: variety }, c.ink, { anchor: hop, tags: ['geometryFromEvent', 'hero'] }),
      piece('status', { kind: 'shock', unit: 'microarc', body: 'M' }, c.ink, { anchor: at('target', ANCHOR_DY.strike), lifeMs: 150 }),
    );
  } else if (mode === 'palm') {
    push(
      ph,
      'body',
      piece('bolt', { dx: Math.min(len, GROUND_TRUTH.chainHopPx), dy: 0, jag: 0.35, forks: 0.3, strength: 0.7, seq: 'zap', seed: variety }, c.ink, { anchor: hop, tags: ['geometryFromEvent'] }),
      piece('burst', { cls: 'ki', size: 's' }, c.ink, { anchor: at('target', ANCHOR_DY.strike) }),
    );
  } else {
    push(ph, 'body', piece('missile', { form: mode === 'blade' ? 'blade' : 'knife', cell: mode === 'blade' ? 24 : 16, halo: c.monster && !c.echoSkill, pose: 'fly' }, c.ink, { anchor: hop }));
    push(
      ph,
      'trail',
      piece('afterimage', { mode: 'ghost', steps: [0.5, 0.25] }, c.ink, { anchor: hop, place: { pattern: 'trail', count: 2, everyPx: 10 } }),
      piece('burst', { cls: 'glint', size: 's' }, c.acc, { anchor: at('target', ANCHOR_DY.strike), delayMs: GROUND_TRUTH.chainStepMs.knife }),
    );
    if (c.accLook.trail.mote) push(ph, 'trail', piece('motes', { kind: c.accLook.trail.mote, size: 1 }, c.acc, { anchor: hop, place: { pattern: 'trail', everyPx: 6 } }));
  }
}

function buffPieces(c: Ctx, motif: AuraMotif, ph: Phases): void {
  const sh = c.skill.shape as Extract<SkillShape, { kind: 'buff' }>;
  const activation = buffActivation(c, sh.stat);
  const feet = at('caster', 0);
  const aura = (phase: 'activate' | 'loop' | 'break', opts: Parameters<typeof piece>[3] = {}) =>
    piece('aura', { motif, phase, activation, body: 'M', halo: false }, c.ink, { anchor: feet, tags: c.monster ? ['geometryFromEvent'] : [], ...opts });
  push(ph, 'cast', aura('activate'));
  switch (activation) {
    case 'pillar':
      push(ph, 'cast', piece('erupt', { unit: 'light-pillar', scale: 'm' }, c.ink, { anchor: feet, place: { pattern: 'single', count: 1 } }));
      break;
    case 'sigil':
      push(ph, 'cast', piece('sigil', { r: 24, points: 6, glyphs: 4, anim: 'draw' }, c.ink, { anchor: feet, layer: 'ground' }));
      break;
    case 'shout':
      push(
        ph,
        'cast',
        piece('ring', { r: 40, r0: 8, aspect: 1, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 217 }, c.ink, { anchor: feet, layer: 'ground' }),
        piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: at('caster', ANCHOR_DY.chest), place: { pattern: 'burst', count: 6 } }),
      );
      break;
    case 'ring':
      push(ph, 'cast', piece('ring', { r: 40, r0: 8, aspect: 1, thick: 2, style: c.look.ring === 'dashed' ? 'solid' : c.look.ring, ink: 'lit', anim: 'expand', ms: 250 }, c.ink, { anchor: feet, layer: 'ground' }));
      break;
  }
  push(ph, 'aura', aura('loop', { lifeMs: sh.duration }), aura('break', { delayMs: sh.duration }));
}

// ------------------------------------------------------------------ impact, statuses, riders

function impactClass(c: Ctx, car: Carrier): BurstClass {
  if ((car.kind === 'strike' && car.style === 'fist') || (car.kind === 'chain' && car.mode === 'palm')) return 'ki';
  if (car.kind === 'projectile' && car.matter && BLUNT_BODIES.has(car.body)) return 'blunt';
  if (c.has('blade')) return 'slash';
  if (c.has('pierce')) return 'pierce';
  if (c.has('heavy')) return 'blunt';
  if ((c.has('technique') || c.has('spirit')) && (car.kind === 'strike' || car.kind === 'dash')) return 'blunt';
  return 'magic';
}

function impactSize(c: Ctx): 's' | 'm' | 'l' {
  if (isHeavy(c.weight)) return 'l';
  if (c.weight === 'light' || shapeHits(c.skill.shape) > 1) return 's';
  return 'm';
}

function impactPhase(c: Ctx, car: Carrier): VfxPiece[] {
  const hit = at('target', ANCHOR_DY.strike);
  const cls = impactClass(c, car);
  const out: VfxPiece[] = [piece('burst', { cls, size: impactSize(c) }, cls === 'magic' ? c.acc : c.ink, { anchor: hit })];
  if (c.imbue) out.push(piece('burst', { cls: 'magic', size: 's' }, c.acc, { anchor: hit }));
  out.push(piece('motes', { kind: c.accLook.hit, size: 1 }, c.acc, { anchor: hit, place: { pattern: 'burst', count: c.weight === 'light' ? 4 : 6 } }));
  if (c.echo) out.push(piece('motes', { kind: lookOf(c.echo).hit, size: 1 }, inkOf(c.echo, c.lut), { anchor: hit, place: { pattern: 'burst', count: 2 }, tags: ['echo'] }));
  return out;
}

const STATUS_RAMP: Readonly<Partial<Record<StatusKind, RampId>>> = { soak: 'water', stun: 'holy', freeze: 'ice', poison: 'toxin', bleed: 'blood', smite: 'holy' };

/**
 * Status units for one status on one target (docs/VFX.md §6.4). Loops carry the status duration as `lifeMs`;
 * one-shots (smite, knockback, pull) end on their own. `source` is the family of the skill that applied it;
 * `owner` is the side whose skill applied it (monster sources use the monster LUT).
 */
export function statusPieces(kind: StatusKind, source: FamilyId, body: BodySize, owner: VfxOwner): readonly VfxPiece[] {
  const lut: LutVariant = owner === 'monster' ? 'monster' : 'base';
  const src: FamilyId = source === 'danger' ? 'steel' : source;
  const ramp: RampId =
    kind === 'burn' ? (src === 'magma' ? 'magma' : 'fire') : kind === 'shock' ? (src === 'storm' ? 'storm' : 'lightning') : kind === 'slow' || kind === 'knockback' || kind === 'pull' ? src : (STATUS_RAMP[kind] ?? src);
  const ink: Ink = { ramp, motif: src, lut };
  const life = GROUND_TRUTH.statusMs[kind];
  const u = (unit: Extract<VfxPiece, { component: 'status' }>['params']['unit'], anchor: VfxAnchor, opts: Parameters<typeof piece>[3] = {}): VfxPiece =>
    piece('status', { kind, unit, body }, ink, { anchor, lifeMs: life, ...opts });
  const top = at('body', -BODYTOP[body]);
  const mid = at('body', -round(BODYTOP[body] / 2));
  const feet = at('body', 0);
  switch (kind) {
    case 'burn':
      return [u('tongue', top, { place: { pattern: 'rim', count: body === 'S' ? 2 : 3 } }), piece('motes', { kind: 'ember', size: 1 }, ink, { anchor: top, place: { pattern: 'rise', count: 1, staggerMs: 300 }, lifeMs: life })];
    case 'soak':
      return [u('drip', mid, { place: { pattern: 'fall', count: 1, staggerMs: 400 } }), u('puddle', feet, { layer: 'ground' })];
    case 'slow':
      return [u('chevron', feet, { place: { pattern: 'single', count: 2 } })];
    case 'stun':
      return [u('star', at('body', -BODYTOP[body] - 4), { place: { pattern: 'orbit', count: 3, radius: 7 } })];
    case 'shock':
      return [u('microarc', mid, { place: { pattern: 'rim', count: 2, staggerMs: 500 } })];
    case 'freeze':
      return [u('crystal', feet), u('icicle', top, { place: { pattern: 'rim', count: 2 } })];
    case 'poison':
      return [u('bubble', mid, { place: { pattern: 'rise', count: 1, staggerMs: 350 } })];
    case 'bleed':
      return [u('splash', mid, { lifeMs: undefined }), u('drop', mid, { place: { pattern: 'fall', count: 1, staggerMs: 500 } })];
    case 'smite':
      return [
        u('beam', feet, { lifeMs: 800 }),
        piece('ring', { r: 16, r0: 4, aspect: 1, thick: 1, style: 'double', ink: 'lit', anim: 'expand', ms: 200 }, ink, { anchor: feet, layer: 'ground' }),
        piece('motes', { kind: 'disc', size: 1 }, { ...ink, ramp: 'heal' }, { anchor: mid, place: { pattern: 'path', count: 4, staggerMs: 60 }, delayMs: 200 }),
      ];
    case 'knockback':
      return [
        u('speedline', mid, { place: { pattern: 'single', count: 3 } }),
        piece('puff', { kind: 'dust', r: 3 }, { ...ink, ramp: 'dust' }, { anchor: feet, layer: 'ground', place: { pattern: 'burst', count: 3, radius: 6 } }),
        piece('ring', { r: 16, r0: 4, aspect: 1, thick: 1, style: 'solid', ink: 'lit', anim: 'expand', ms: 167 }, ink, { anchor: feet, layer: 'ground' }),
      ];
    case 'pull':
      return [
        u('spiral', mid, { place: { pattern: 'spiral', count: 1 } }),
        piece('motes', { kind: 'streak', size: 2 }, ink, { anchor: mid, place: { pattern: 'spiral', count: 6, radius: 24 } }),
        piece('ring', { r: 20, aspect: 1, thick: 1, style: 'solid', ink: 'mid', anim: 'static', arc: [0, 120], ms: 300 }, ink, { anchor: feet, layer: 'ground', place: { pattern: 'single', count: 3 } }),
      ];
  }
}

/** Body bucket -> head height above the feet (px). */
const BODYTOP: Readonly<Record<BodySize, number>> = { S: 26, M: 34, L: 54, W: 82 };

/** The 7×7 pip shown for a status loop over the per-target cap (§6.4). */
export function statusPip(kind: StatusKind, source: FamilyId, owner: VfxOwner): VfxPiece {
  const p = statusPieces(kind, source, 'S', owner)[0];
  return piece('status', { kind, unit: 'pip', body: 'S' }, { ramp: p.ramp, motif: p.motif, lut: p.lut }, { anchor: at('body', -40), lifeMs: GROUND_TRUTH.statusMs[kind] });
}

function riderFx(c: Ctx, merge: Root['merge'], variety: number): RiderFx {
  const rd = c.skill.riders ?? {};
  const out: RiderFx = {};
  const body = at('body', 0);
  const hand = at('caster', ANCHOR_DY.hand);
  if (rd.returns) {
    out.returns = {
      turn: [piece('burst', { cls: 'glint', size: 's' }, c.acc, { anchor: body }), piece('ring', { r: 16, r0: 8, aspect: 1, thick: 1, style: 'solid', ink: 'lit', anim: 'expand', ms: 167 }, c.acc, { anchor: body })],
      tether: [piece('motes', { kind: 'bead', size: 2 }, c.acc, { anchor: at('path', 0), place: { pattern: 'path', everyPx: 6 } })],
      catch: [piece('burst', { cls: 'glint', size: 's' }, c.acc, { anchor: hand })],
    };
  }
  if (rd.reprise) {
    out.reprise = {
      ghost: [
        piece('afterimage', { mode: 'mirror', steps: MIRROR_STEPS }, c.ink, { anchor: at('caster', -1) }),
        piece('ring', { r: 16, r0: 6, aspect: 1, thick: 1, style: 'solid', ink: 'mid', anim: 'expand', ms: 167 }, c.ink, { anchor: at('caster', 0), layer: 'ground' }),
      ],
    };
  }
  if (rd.arc) out.arc = { zap: [arcZap(c.acc, variety)] };
  if (rd.leech) {
    const hit = at('target', ANCHOR_DY.strike);
    out.leech = {
      stream: [
        piece('motes', { kind: 'disc', size: 1 }, utilInk(c, 'blood'), { anchor: hit, place: { pattern: 'path', count: 6, staggerMs: 60, radius: 16 }, lifeMs: 280 }),
        piece('motes', { kind: 'disc', size: 1 }, utilInk(c, 'heal'), { anchor: hit, place: { pattern: 'path', count: 6, staggerMs: 60, radius: 16 }, delayMs: 280, lifeMs: 120 }),
      ],
      arrive: [piece('burst', { cls: 'glint', size: 's' }, utilInk(c, 'heal'), { anchor: at('caster', ANCHOR_DY.chest), delayMs: 400 })],
    };
  }
  const kb = statusesFor(c.skill, c.owner).includes('knockback');
  if (kb) out.knockback = { push: statusPieces('knockback', c.accent, 'M', c.owner) };
  const sh = c.skill.shape;
  if (sh.kind === 'projectile' && (sh.pierce ?? 0) > 0) {
    out.pierce = {
      mark: [
        piece('burst', { cls: 'pierce', size: 's' }, c.acc, { anchor: at('target', ANCHOR_DY.strike) }),
        piece('motes', { kind: 'spark', size: 1 }, c.acc, { anchor: at('target', ANCHOR_DY.strike), place: { pattern: 'burst', count: 6, spreadDeg: 40 } }),
      ],
    };
  }
  if (merge) out.merge = mergeFx(c, merge, variety);
  return out;
}

function arcZap(ink: Ink, variety: number): VfxPiece {
  return piece('bolt', { dx: GROUND_TRUTH.arcRiderPx, dy: 0, jag: 0.35, forks: 0.3, strength: 0.7, seq: 'zap', seed: variety }, ink, { anchor: at('target', ANCHOR_DY.strike), tags: ['geometryFromEvent'] });
}

/** The mechanical difference a shape merge's secondary parent made (docs/VFX.md §7.3). */
export function mergeAccent(raw: SkillDef, primary: SkillDef): MergeAccent {
  const a = raw.shape;
  const b = primary.shape;
  if (a.kind === 'projectile' && b.kind === 'projectile' && a.radial && !b.radial) return 'radial';
  if (a.kind === 'dash' && b.kind === 'dash' && a.spin && !b.spin) return 'spinDash';
  if (shapeHits(a) > shapeHits(b)) return 'extra';
  if (raw.riders?.knockback && !primary.riders?.knockback) return 'knockback';
  if (raw.riders?.arc && !primary.riders?.arc) return 'arc';
  return 'none';
}

function mergeFx(c: Ctx, merge: NonNullable<Root['merge']>, variety: number): NonNullable<RiderFx['merge']> {
  const accent = mergeAccent(merge.raw, c.root);
  const family = c.echo ?? c.family;
  const ink = inkOf(family, c.lut);
  const look = lookOf(family);
  const caster = at('caster', ANCHOR_DY.hand);
  const echoMotes = (): VfxPiece[] => (look.trail.mote ? [piece('motes', { kind: look.trail.mote, size: 1 }, ink, { anchor: caster, place: { pattern: 'burst', count: 4 } })] : []);
  let pieces: VfxPiece[] = [];
  switch (accent) {
    case 'extra':
      // The extra swing / pulse / shot / hop wears the echo family: build() re-inks the carrier piece (mergeExtra).
      break;
    case 'radial':
      pieces = [piece('ring', { r: 28, r0: 12, aspect: 1, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', ms: 200 }, ink, { anchor: caster }), ...echoMotes()];
      break;
    case 'spinDash':
      pieces = [piece('ring', { r: Math.max(8, round((c.geometry as Extract<HitGeometry, { kind: 'lane' }>).width / 2)), aspect: c.aspect, thick: 3, style: 'solid', ink: 'hot', anim: 'sweep', heads: 2, ms: 117 }, ink, { anchor: at('path', 0), place: { pattern: 'path', staggerMs: 67 } })];
      break;
    case 'knockback':
      pieces = [...statusPieces('knockback', family, 'M', c.owner)];
      break;
    case 'arc':
      pieces = [arcZap(ink, variety)];
      break;
    case 'none':
      pieces = echoMotes();
      break;
  }
  return { accent, family, pieces: pieces.map((p) => tag(p, 'echo')) };
}

// ------------------------------------------------------------------ owner monster (docs/VFX.md §6.5)

function tellPieces(c: Ctx): VfxPiece[] {
  const sh = c.skill.shape;
  const T = monsterTellMs(c.skill);
  const tv = ['neverGoverned'] as const;
  const geo = ['neverGoverned', 'geometryFromEvent'] as const;
  const famInk: Ink = { ramp: c.family, motif: c.family, lut: 'monster' };
  const out: VfxPiece[] = [];
  const lock = (anchor: VfxAnchor) => piece('tell', { piece: 'lock', danger: true }, DANGER, { anchor, layer: 'rim', delayMs: T - 50, lifeMs: 50, tags: tv });
  const edge = (anchor: VfxAnchor) => piece('tell', { piece: 'edge', danger: true }, DANGER, { anchor, layer: 'rim', lifeMs: T, tags: tv });
  const marching = (r: number, aspect: Aspect, anchor: VfxAnchor, arc?: readonly [number, number]): VfxPiece[] => [
    piece('ring', { r, aspect, thick: 2, style: 'dashed', ink: 'lit', anim: 'march', ms: vsync(T), ...(arc ? { arc } : {}) }, DANGER, { anchor, layer: 'rim', lifeMs: T, tags: geo }),
    piece('ring', { r, aspect, thick: 2, style: 'dashed', ink: 'hot', anim: 'march', ms: vsync(T * 0.15), ...(arc ? { arc } : {}) }, DANGER, { anchor, layer: 'rim', delayMs: round(T * 0.85), lifeMs: T - round(T * 0.85), tags: geo }),
  ];
  switch (sh.kind) {
    case 'nova':
    case 'spin': {
      const r = sh.radius;
      const anchor = at(sh.kind === 'nova' ? 'aim' : 'caster', 0);
      const fill = (density: 0.125 | 0.25 | 0.5, delayMs: number, ink: Ink = DANGER): VfxPiece =>
        piece('decal', { kind: 'fill', r: decalR(r), aspect: ZONE_ASPECT, density, shape: 'disc' }, ink, { anchor, layer: 'tell', delayMs, lifeMs: T - delayMs, tags: geo });
      out.push(fill(0.125, 0), fill(0.25, round(T * 0.33)), fill(0.5, round(T * 0.66)), fill(0.25, 0, famInk), ...marching(r, ZONE_ASPECT, anchor), lock(anchor), edge(anchor));
      break;
    }
    case 'strike': {
      const anchor = at('caster', 0);
      out.push(...marching(sh.range, 1, anchor, halfArc(sh.arc)));
      for (let k = 1; k <= 4; k++) {
        out.push(piece('ring', { r: Math.max(8, round((sh.range * k) / 4)), aspect: 1, thick: 2, style: 'solid', ink: 'mid', anim: 'static', arc: halfArc(sh.arc), ms: vsync(T / 4) }, DANGER, { anchor, layer: 'tell', delayMs: round(((k - 1) * T) / 4), lifeMs: T - round(((k - 1) * T) / 4), tags: geo }));
      }
      out.push(piece('tell', { piece: 'bead', danger: true }, DANGER, { anchor, layer: 'rim', place: { pattern: 'line', count: clamp(round(sh.range / 8), 4, 16), radius: sh.range, spreadDeg: sh.arc }, lifeMs: T, tags: geo }), lock(anchor), edge(anchor));
      break;
    }
    case 'dash': {
      const g = c.geometry as Extract<HitGeometry, { kind: 'lane' }>;
      const anchor = at('caster', 0);
      out.push(
        piece('tell', { piece: 'chevron', danger: true }, DANGER, { anchor, layer: 'tell', place: { pattern: 'line', count: clamp(round(sh.distance / 16), 3, 20), radius: sh.distance }, lifeMs: T, tags: geo }),
        piece('tell', { piece: 'bead', danger: true }, DANGER, { anchor, layer: 'rim', place: { pattern: 'line', count: clamp(round(sh.distance / 8), 4, 24), radius: sh.distance, spacing: g.width }, lifeMs: T, tags: geo }),
        piece('tell', { piece: 'arrow', danger: true }, DANGER, { anchor: { ...anchor, along: sh.distance }, layer: 'rim', lifeMs: T, tags: geo }),
        lock(anchor),
        edge(anchor),
      );
      break;
    }
    case 'projectile': {
      const mouth = at('caster', ANCHOR_DY.hand);
      const count = sh.count ?? 1;
      out.push(
        piece('tell', { piece: 'bead', danger: true }, DANGER, { anchor: mouth, layer: 'rim', place: { pattern: 'line', count: Math.min(24, count * 6), radius: sh.range, spreadDeg: count > 1 ? (sh.spread ?? 30) : 0 }, lifeMs: T, tags: geo }),
        piece('orb', { form: c.accLook.orb, cell: 16, halo: true, mode: 'charge' }, famInk, { anchor: mouth, lifeMs: T, tags: geo }),
        lock(mouth),
        edge(mouth),
      );
      break;
    }
    case 'chain': {
      const anchor = at('caster', 0);
      out.push(
        ...marching(sh.range, 1, anchor),
        piece('tell', { piece: 'bead', danger: true }, DANGER, { anchor: at('caster', ANCHOR_DY.chest), layer: 'rim', place: { pattern: 'line', count: 12, radius: sh.range }, lifeMs: T, tags: geo }),
        lock(anchor),
        edge(anchor),
      );
      break;
    }
    case 'buff': {
      const anchor = at('caster', 0);
      out.push(
        piece('aura', { motif: BUFF_MOTIF[sh.stat], phase: 'activate', activation: 'ring', body: 'M', halo: false }, famInk, { anchor, layer: 'tell', lifeMs: T, tags: geo }),
        piece('ring', { r: 24, aspect: ZONE_ASPECT, thick: 2, style: 'dashed', ink: 'lit', anim: 'march', ms: vsync(T) }, DANGER, { anchor, layer: 'rim', lifeMs: T, tags: geo }),
        edge(anchor),
      );
      break;
    }
  }
  return out;
}

function casterCue(c: Ctx): VfxPiece[] {
  const T = monsterTellMs(c.skill);
  return [
    piece('motes', { kind: 'streak', size: 2 }, c.acc, { anchor: at('caster', ANCHOR_DY.hand), place: { pattern: 'converge', count: 6, radius: 24 }, lifeMs: T }),
    piece('ring', { r: 16, aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink: 'lit', anim: 'static', ms: vsync(T) }, DANGER, { anchor: at('caster', 0), layer: 'tell', lifeMs: T, tags: ['neverGoverned', 'geometryFromEvent'] }),
  ];
}

// ------------------------------------------------------------------ juice (docs/VFX.md §6.6)

const JUICE: Readonly<Record<VfxWeight, VfxJuice>> = {
  light: { hitstopMs: 0, trauma: 0, flash: 'none' },
  normal: { hitstopMs: 33, trauma: 0, flash: 'none' },
  heavy: { hitstopMs: 67, trauma: 0.1, flash: 'local' },
  ultimate: { hitstopMs: 100, trauma: 0.25, flash: 'local' },
};

function juiceOf(c: Ctx): VfxJuice {
  const j = { ...JUICE[c.weight] };
  if (c.monster) return { ...j, trauma: 0, flash: j.flash === 'none' ? 'none' : 'local' };
  if (c.weight === 'ultimate' && c.skill.shape.kind === 'nova') j.flash = 'screen';
  return j;
}

// ------------------------------------------------------------------ deriveVfx

const cache = new Map<string, VfxRecipe>();

/**
 * The effect recipe of any skill (authored, `base@el`, `~mod`, `fuse:a|b`) for an owner. Pure; memoised by
 * `${skill.id}#${owner}` when the default authored lookup is used. `lookup` resolves a variant's authored root and
 * a merge's parents (default: the authored skills in GAME_DATA).
 */
export function deriveVfx(skill: SkillDef, owner: VfxOwner = 'player', lookup?: (id: string) => SkillDef | undefined): VfxRecipe {
  const key = `${skill.id}#${owner}`;
  if (!lookup) {
    const hit = cache.get(key);
    if (hit) return hit;
  }
  const recipe = build(skill, owner, lookup ?? authoredLookup);
  if (!lookup) cache.set(key, recipe);
  return recipe;
}

function build(skill: SkillDef, owner: VfxOwner, lookup: (id: string) => SkillDef | undefined): VfxRecipe {
  const { root, rootId, merge } = rootOf(skill, lookup);
  const monster = owner === 'monster';
  const mods = new Set(skill.essences ?? []);
  const rootTags = new Set(root.tags);
  const lut: LutVariant = monster ? 'monster' : 'base';
  const variety = hashSeed(rootId);
  const geometry = hitGeometry(skill, owner);
  const pre = {
    skill,
    root,
    rootId,
    owner,
    monster,
    echoSkill: rootTags.has('echo'),
    has: (t: string) => rootTags.has(t),
    rootFamily: familyOf(root),
    family: familyOf(skill),
    weight: weightOf(root, mods),
    tier: clamp(skill.tier, 0, 3) as VfxTier,
    lut,
    geometry,
    castMs: skill.castMs ?? 0,
    mods,
    aspect: (monster ? ZONE_ASPECT : 1) as Aspect,
    geoTags: (monster ? ['geometryFromEvent'] : []) as readonly PieceTag[],
  };
  // Carrier first (root rules), then the palette: matter keeps steel and carries the element as imbue.
  const draft = { ...pre, accent: pre.family, ink: inkOf(pre.family, lut), acc: inkOf(pre.family, lut), look: lookOf(pre.rootFamily), accLook: lookOf(pre.family) } as Ctx;
  const carrier = carrierOf(draft);
  const { matter, native } = carrierMatter(carrier);
  const family: FamilyId = matter && !native ? 'steel' : pre.family;
  const imbue = matter && !native ? skill.element : undefined;
  const accent: FamilyId = imbue ?? family;
  const echoFam = merge ? familyOf(merge.secondary) : undefined;
  const c: Ctx = {
    ...pre,
    family,
    imbue,
    accent,
    echo: echoFam && echoFam !== family ? echoFam : undefined,
    ink: inkOf(family, lut),
    acc: inkOf(accent, lut),
    look: lookOf(pre.rootFamily),
    accLook: lookOf(accent),
  };
  if (carrier.kind === 'nova') carrier.unit = novaUnit(rootId, accent);

  const ph: Phases = {};
  switch (carrier.kind) {
    case 'strike':
      strikePieces(c, carrier.style, ph);
      break;
    case 'spin':
      spinPieces(c, carrier.style, ph);
      break;
    case 'projectile':
      projectilePieces(c, { form: carrier.body, matter: carrier.matter }, ph);
      break;
    case 'dash':
      dashPieces(c, carrier.mode, ph);
      break;
    case 'nova':
      novaPieces(c, carrier, ph);
      break;
    case 'chain':
      chainPieces(c, carrier.mode, ph, variety);
      break;
    case 'buff':
      buffPieces(c, carrier.motif, ph);
      break;
  }
  if (carrier.kind !== 'buff') push(ph, 'impact', ...impactPhase(c, carrier));
  if (c.mods.has('haste') && carrier.kind !== 'dash') push(ph, 'cast', piece('motes', { kind: 'line', size: 2 }, c.ink, { anchor: at('caster', 0), place: { pattern: 'burst', count: 4, spreadDeg: 30 } }));
  if (c.mods.has('expanse') && carrier.kind === 'spin') {
    const R = (skill.shape as Extract<SkillShape, { kind: 'spin' }>).radius;
    push(ph, 'cast', piece('ring', { r: R + 4, r0: R, aspect: c.aspect, thick: 1, style: 'solid', ink: 'dim', anim: 'expand', ms: 200 }, c.ink, { anchor: at('caster', 0), layer: 'ground', tags: c.geoTags }));
  }
  if (c.echo) {
    const ov = lookOf(c.echo).spin.mote ?? lookOf(c.echo).trail.mote;
    if (ov) push(ph, 'cast', piece('motes', { kind: ov, size: 1 }, inkOf(c.echo, lut), { anchor: at('caster', ANCHOR_DY.swing), place: { pattern: 'burst', count: 4 }, delayMs: 33, tags: ['echo'] }));
  }
  if (monster) {
    push(ph, 'telegraph', ...tellPieces(c));
    push(ph, 'charge', ...casterCue(c));
  } else if (c.castMs > 0) {
    push(ph, 'charge', ...chargePieces(c, carrier));
  }
  const statuses = statusesFor(skill, owner);
  for (const k of statuses) push(ph, 'status', ...statusPieces(k, accent, 'M', owner));

  const riders = riderFx(c, merge, variety);
  if (riders.merge?.accent === 'extra') riders.merge = { ...riders.merge, pieces: mergeExtra(ph, carrier, riders.merge.family, lut) };

  let recipe: VfxRecipe = {
    version: VFX_VERSION,
    key: `${skill.id}#${owner}`,
    skillId: skill.id,
    rootId,
    owner,
    shape: skill.shape.kind,
    family,
    ...(imbue ? { imbue } : {}),
    ...(c.echo ? { echo: c.echo } : {}),
    weight: c.weight,
    tier: c.tier,
    carrier,
    geometry,
    phases: ph,
    riders,
    statuses,
    juice: juiceOf(c),
    quota: monster ? VFX_BUDGET.monsterQuota : 1,
    variety,
  };
  const sig = SIGNATURES[rootId];
  if (sig) recipe = { ...sig.patch(recipe, skill), signature: rootId };
  return recipe;
}

/** The merge 'extra' accent: the main carrier piece of the extra swing / pulse / shot / hop in the echo family. */
function mergeExtra(ph: Phases, car: Carrier, family: FamilyId, lut: LutVariant): VfxPiece[] {
  const main = car.kind === 'projectile' || car.kind === 'chain' ? ph.body : ph.cast;
  const first = main?.[0];
  if (!first) return [];
  return [tag(reink(first, inkOf(family, lut)), 'echo', 'lastHit')];
}

// ------------------------------------------------------------------ impact selection (docs/VFX.md §6.3)

/** Impact pieces for one damage event: tick / crit / strong / weak / immune / resist / hits on the player. */
export function impactPieces(recipe: VfxRecipe, hit: HitOutcome): readonly VfxPiece[] {
  const base = recipe.phases.impact ?? [];
  const main = base.find((p) => p.component === 'burst' && !(p.tags ?? []).includes('echo'));
  const anchor = main?.anchor ?? at('target', ANCHOR_DY.strike);
  const ink: Ink = main ? { ramp: main.ramp, motif: main.motif, lut: main.lut } : inkOf(recipe.family, recipe.owner === 'monster' ? 'monster' : 'base');
  const size = main?.component === 'burst' ? main.params.size : 'm';
  const extras = base.filter((p) => p !== main);
  if (hit.target === 'player') return [piece('burst', { cls: 'blunt', size: 's' }, DANGER, { anchor })];
  if (hit.relation === 'immune') return [piece('burst', { cls: 'immune', size }, { ...ink, ramp: 'smoke' }, { anchor })];
  if (hit.index > 0 && hit.sincePrevMs < VFX_BUDGET.multiHitTickWindowMs) return [piece('burst', { cls: 'tick', size: 's' }, ink, { anchor })];
  const out: VfxPiece[] = [];
  if (hit.crit) out.push(piece('burst', { cls: 'crit', size }, ink, { anchor, tags: ['hero'] }));
  const el = recipe.imbue ?? (isElement(recipe.family) ? recipe.family : undefined);
  if (hit.relation === 'strong' && el) out.push(piece('burst', { cls: 'strong', size, glyph: el }, inkOf(el, ink.lut), { anchor, tags: ['hero'] }));
  if (hit.relation === 'same') out.push(piece('burst', { cls: 'resist', size }, { ...ink, ramp: 'smoke' }, { anchor }));
  else if (main) out.push(hit.relation === 'weak' && ink.lut === 'base' ? reink(main, { lut: 'shift' }) : main);
  out.push(...extras);
  if (hit.via === 'pierce' && recipe.riders.pierce) out.push(...recipe.riders.pierce.mark);
  return out;
}

const isElement = (f: FamilyId): f is ElementId => elementStatus(f as ElementId) !== undefined;

// ------------------------------------------------------------------ monster auto-attacks (docs/VFX.md §6.5)

/** A monster auto-attack's recipe: claws / lash / sting / slam / spark by monster family. */
export function deriveAttackVfx(a: AttackerLook): VfxRecipe {
  const def = MONSTERS.get(a.id);
  const reachPx = def ? def.attackRange + 8 : a.size === 'S' ? 32 : a.size === 'M' ? 40 : 56;
  const family: FamilyId = a.element ?? 'steel';
  const lut: LutVariant = 'monster';
  const ink = inkOf(family, lut);
  const weight: VfxWeight = a.rank === 'warden' ? 'heavy' : 'normal';
  const strike = at('caster', ANCHOR_DY.strike);
  const hit = at('target', ANCHOR_DY.strike);
  const r = reachBucket(reachPx);
  let style: StrikeStyle = 'claw';
  let cast: VfxPiece[];
  switch (a.family) {
    case 'beast':
    case 'fiend':
    case 'wyrm':
      cast = [piece('slash', { r, arc: 120, rakes: 3, form: 'arc', weight, tier: 0, sense: 1, rune: false }, ink, { anchor: strike, tags: ['hero'] })];
      break;
    case 'revenant':
      // Inverted ink: the shadow motif (dark core, bright rim) in the monster's own ramp.
      cast = [piece('slash', { r, arc: 120, rakes: 1, form: 'arc', weight, tier: 0, sense: 1, rune: false }, { ...ink, motif: 'shadow' }, { anchor: strike, tags: ['hero'] })];
      break;
    case 'sylvan':
    case 'swarm':
      style = 'thrust';
      cast = [piece('thrust', { len: r, weight, tier: 0, slit: false }, ink, { anchor: strike, tags: ['hero'] })];
      break;
    case 'construct':
      style = 'fist';
      cast = [piece('burst', { cls: 'blunt', size: 'l' }, ink, { anchor: { ...strike, along: round(reachPx * 0.8) } }), piece('puff', { kind: 'dust', r: 5 }, { ...ink, ramp: 'dust' }, { anchor: at('caster', 0), layer: 'ground', place: { pattern: 'burst', count: 3, radius: 8 } })];
      break;
    case 'sprite':
      style = 'staff';
      cast = [piece('burst', { cls: 'magic', size: 'm' }, ink, { anchor: { ...strike, along: round(reachPx * 0.8) } })];
      break;
  }
  const id = `attack:${a.id}`;
  return {
    version: VFX_VERSION,
    key: `${id}#monster`,
    skillId: id,
    rootId: id,
    owner: 'monster',
    shape: 'strike',
    family,
    weight,
    tier: 0,
    carrier: { kind: 'strike', style },
    geometry: { kind: 'sector', r: reachPx, arcDeg: 360, addCasterRadius: false },
    phases: { cast, impact: [piece('burst', { cls: style === 'thrust' ? 'pierce' : style === 'claw' ? 'slash' : style === 'fist' ? 'blunt' : 'magic', size: 's' }, ink, { anchor: hit })] },
    riders: {},
    statuses: [],
    juice: { hitstopMs: weight === 'heavy' ? 67 : 33, trauma: 0, flash: 'none' },
    quota: VFX_BUDGET.monsterQuota,
    variety: hashSeed(id),
  };
}

// ------------------------------------------------------------------ combos, deaths, extras (docs/VFX.md §8.2)

/** Combo pieces: Shatter (freeze), Conduct (soak), Fan the Flames (burn). */
export function comboPieces(combo: ComboId, body: BodySize): readonly VfxPiece[] {
  const mid = at('body', -round(BODYTOP[body] / 2));
  const feet = at('body', 0);
  const ink = (f: FamilyId): Ink => inkOf(f, 'base');
  switch (combo) {
    case 'shatter':
      return [
        piece('motes', { kind: 'chip', size: 2 }, ink('ice'), { anchor: mid, place: { pattern: 'burst', count: 8 } }),
        piece('burst', { cls: 'crit', size: body === 'S' || body === 'M' ? 'm' : 'l' }, ink('ice'), { anchor: mid, tags: ['hero'] }),
        piece('ring', { r: 24, r0: 6, aspect: 1, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 200 }, ink('ice'), { anchor: feet, layer: 'ground' }),
      ];
    case 'conduct':
      return [
        piece('ring', { r: 24, r0: 6, aspect: 1, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 200 }, ink('lightning'), { anchor: feet, layer: 'ground' }),
        piece('bolt', { dx: BODY_W[body], dy: 0, jag: 0.35, forks: 0.3, strength: 0.7, seq: 'zap', seed: hashSeed('conduct', body) }, ink('lightning'), { anchor: { ...mid, along: -round(BODY_W[body] / 2) } }),
        piece('puff', { kind: 'steam', r: 5 }, ink('water'), { anchor: mid, place: { pattern: 'rise', count: 3, radius: 8 } }),
      ];
    case 'fan':
      return [
        piece('ring', { r: 48, r0: 8, aspect: 1, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', ms: 217 }, ink('fire'), { anchor: feet, layer: 'ground' }),
        piece('motes', { kind: 'ember', size: 2 }, ink('fire'), { anchor: mid, place: { pattern: 'path', count: 6, staggerMs: 40 } }),
      ];
  }
}

const BODY_W: Readonly<Record<BodySize, number>> = { S: 20, M: 24, L: 40, W: 60 };

/** Death pop: nova blast one bucket below the body (killer family) + hide-colour chips + puff (§8.2). */
export function deathPieces(body: BodySize, killer: FamilyId, owner: VfxOwner): readonly VfxPiece[] {
  const fam: FamilyId = killer === 'danger' ? 'steel' : killer;
  // `owner` is the side that died; a player death was dealt by a monster (its LUT).
  const lut: LutVariant = owner === 'player' ? 'monster' : 'base';
  const c: 24 | 40 | 56 = body === 'W' ? 56 : body === 'L' ? 40 : 24;
  const feet = at('body', 0);
  const mid = at('body', -round(BODYTOP[body] / 2));
  return [
    piece('nova', { core: 'blast', c, heavy: body === 'L' || body === 'W' }, inkOf(fam, lut), { anchor: mid, tags: ['hero'] }),
    // Chips take the hide colour at runtime (art/monsters.ts exports it); 'dust' is the bake ramp.
    piece('motes', { kind: 'chip', size: 2 }, { ramp: 'dust', motif: fam, lut }, { anchor: mid, place: { pattern: 'burst', count: body === 'S' ? 4 : body === 'W' ? 8 : 6 } }),
    piece('puff', { kind: 'dust', r: body === 'S' ? 5 : body === 'W' ? 10 : 7 }, { ramp: 'smoke', motif: fam, lut }, { anchor: feet, layer: 'ground' }),
  ];
}

/** Spark moment, level-up and warden enrage. */
export function extraPieces(event: keyof VfxExtraEvents): readonly VfxPiece[] {
  const feet = at('body', 0);
  const chest = at('body', ANCHOR_DY.chest);
  switch (event) {
    case 'spark':
      return [
        piece('burst', { cls: 'star', size: 'l' }, inkOf('holy', 'base'), { anchor: chest, tags: ['hero'] }),
        piece('motes', { kind: 'streak', size: 3 }, inkOf('holy', 'base'), { anchor: chest, place: { pattern: 'burst', count: 14, radius: 48 } }),
        piece('decal', { kind: 'fill', r: 32, aspect: 1, density: 0.25, shape: 'disc' }, inkOf('holy', 'base'), { anchor: feet, layer: 'glow', blend: 'add', lifeMs: 250 }),
      ];
    case 'levelUp':
      return [
        piece('erupt', { unit: 'light-pillar', scale: 'l' }, inkOf('holy', 'base'), { anchor: feet, place: { pattern: 'single', count: 1 } }),
        piece('ring', { r: 32, r0: 8, aspect: 1, thick: 2, style: 'double', ink: 'lit', anim: 'expand', ms: 333 }, inkOf('holy', 'base'), { anchor: feet, layer: 'ground' }),
      ];
    case 'enrage':
      return [
        piece('ring', { r: 48, r0: 12, aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 250 }, DANGER, { anchor: feet, layer: 'ground' }),
        piece('ring', { r: 72, r0: 24, aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', ms: 333 }, DANGER, { anchor: feet, layer: 'ground', delayMs: 83 }),
        piece('burst', { cls: 'blunt', size: 'l' }, DANGER, { anchor: chest }),
      ];
  }
}
