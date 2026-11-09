// VFX contract (docs/VFX.md). Phaser-free types, constants and a few pure helpers shared by every VFX module.
//
// Two work packages meet here and nowhere else (docs/VFX.md §10):
//   P  painter + ramps + glyphs + components/* + bake.ts   -> consumes VfxPiece, produces IndexFrame / BakedPiece
//   R  families.ts + recipe.ts + signatures.ts (+ pieces.ts) -> consumes SkillDef, produces VfxRecipe (made of VfxPiece)
// Neither package imports the other. This file is frozen for both; change it only through docs/VFX.md.
//
// Rules for everything under src/game/vfx except the later Phaser runtime: no Phaser import, no DOM, no Math.random,
// no Date.now, no ctx.rotate. Randomness comes from mulberry32(hashSeed(...)) in src/core/rng.ts.
import type { ComboId } from '../../core/combat';
import type { BuffStat, ElementId, Family, MonsterRank, ShapeKind, Size, SkillDef, StatusKind } from '../../core/types';

/** Bump when a template or recipe rule changes output (cache keys, gallery captures). */
export const VFX_VERSION = 2;

// ------------------------------------------------------------------ index frames

/**
 * Pixel indices written by templates. A per-ramp LUT turns them into colours at bake time, so one geometry serves
 * every family. 1-6 are the main ramp dark -> light (R0..R5), 9-12 the secondary ramp (S0..S3).
 */
export const IDX = {
  CLEAR: 0,
  R0: 1,
  R1: 2,
  R2: 3,
  R3: 4,
  R4: 5,
  R5: 6,
  /** Matter outline #24180f. Only on matter (rocks, blades, shards, chips, crust, keylines). */
  OUTLINE: 7,
  ACCENT: 8,
  S0: 9,
  S1: 10,
  S2: 11,
  S3: 12,
  /** Pure white. Hero frames only (declared in Template output); reduce-flash maps it to R5. */
  WHITE: 13,
} as const;

export type PixelIndex = (typeof IDX)[keyof typeof IDX];
/** Number of body indices (LUT length). */
export const INDEX_COUNT = 14;
/** Glow levels 0..3 (0 = none). Glow is baked white and tinted by the runtime in the ADD layer. */
export const GLOW_MAX = 3;
/** Matter outline colour (docs/ART-DIRECTION.md: never pure black). */
export const OUTLINE_HEX = '#24180f';

/**
 * One baked frame as indices. `ox/oy` is the anchor inside the frame (feet, impact point, muzzle or arc centre);
 * the runtime places the anchor on the world point. `body` and `glow` are w*h, row-major.
 */
export interface IndexFrame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  /** PixelIndex per pixel. */
  body: Uint8Array;
  /** Glow level 0..GLOW_MAX per pixel (all zero when the frame has no glow twin). */
  glow: Uint8Array;
  /** Display time; always a VSYNC_MS value. The last frame of a one-shot is empty (all CLEAR). */
  ms: number;
}

/** A colourised frame, ready for ImageData / putImageData. `data` is w*h*4 RGBA. */
export interface RgbaFrame {
  w: number;
  h: number;
  ox: number;
  oy: number;
  ms: number;
  data: Uint8ClampedArray;
}

// ------------------------------------------------------------------ families & ramps

export type Hex = `#${string}`;

/** A family palette: 6-step main ramp (dark -> light), one accent, 4-step secondary ramp. */
export interface Ramp {
  R: readonly [Hex, Hex, Hex, Hex, Hex, Hex];
  accent: Hex;
  S: readonly [Hex, Hex, Hex, Hex];
}

/** Tag families for skills without an element (same precedence as Combat.colorFor). */
export type TagFamily = 'steel' | 'arcane' | 'stealth' | 'toxin' | 'spirit';

/**
 * The 17 VFX families: 11 elements, 5 tag families and 'danger'. 'danger' is reserved for monster telegraphs and
 * never appears in a player recipe (tests/vfx-recipe.test.ts).
 */
export type FamilyId = ElementId | TagFamily | 'danger';

export const FAMILY_IDS: readonly FamilyId[] = [
  'fire',
  'water',
  'earth',
  'wind',
  'lightning',
  'shadow',
  'holy',
  'ice',
  'magma',
  'storm',
  'twilight',
  'steel',
  'arcane',
  'stealth',
  'toxin',
  'spirit',
  'danger',
];

/** Utility ramps shared by all families (smoke, dust, blood stains and drips, heal motes). */
export type UtilityRampId = 'smoke' | 'dust' | 'blood' | 'heal';
export const UTILITY_RAMP_IDS: readonly UtilityRampId[] = ['smoke', 'dust', 'blood', 'heal'];

/** Anything a LUT can be built from. */
export type RampId = FamilyId | UtilityRampId;

/**
 * LUT variants (colour only, no new geometry):
 * - base: as authored
 * - shift: one ramp step darker (reprise replays, far-half units, weak hits)
 * - monster: saturation x0.85, WHITE -> R5, ACCENT -> danger R3 (monster bodies' halo)
 * - reduceFlash: WHITE -> R5 (the 'Reduce shake & flashes' setting)
 */
export type LutVariant = 'base' | 'shift' | 'monster' | 'reduceFlash';

// ------------------------------------------------------------------ geometry & timing helpers

export type Aspect = 1 | 0.65;
/** Ground ellipse aspect MonsterSkills uses for zones (ry = 0.65 rx). Player hit tests are circles (aspect 1). */
export const ZONE_ASPECT = 0.65;

export interface Pt {
  x: number;
  y: number;
}

/** Display times allowed for any frame: multiples of one 60 Hz vsync (1000/60 ms), rounded. */
export const VSYNC_MS: readonly number[] = [17, 33, 50, 67, 83, 100, 117, 133, 150, 167, 183, 200];

/** Nearest VSYNC_MS value (frames longer than 200 ms are split by the template). */
export function quantMs(ms: number): number {
  let best = VSYNC_MS[0];
  for (const v of VSYNC_MS) if (Math.abs(v - ms) < Math.abs(best - ms)) best = v;
  return best;
}

/** Nearest bucket value (ties go to the larger bucket). */
export function nearestBucket(v: number, buckets: readonly number[]): number {
  let best = buckets[0];
  for (const b of buckets) if (Math.abs(b - v) <= Math.abs(best - v)) best = b;
  return best;
}

/** Largest bucket <= v (the smallest bucket when v is below all). Fills never exceed the true radius. */
export function floorBucket(v: number, buckets: readonly number[]): number {
  let best = buckets[0];
  for (const b of buckets) if (b <= v) best = b;
  return best;
}

const range = (from: number, to: number, step: number): number[] => {
  const out: number[] = [];
  for (let v = from; v <= to; v += step) out.push(v);
  return out;
};

/** Outer radius of strike smears and thrust lengths (px), 8 px steps: drawn reach within 4 px of the true range. */
export const REACH_BUCKETS: readonly number[] = range(40, 128, 8);
/** Visual arc buckets (deg), 30 deg steps: drawn arc within 15 deg of the true arc. */
export const ARC_BUCKETS: readonly number[] = range(60, 360, 30);
/** Projectile body cells (px): size <= 9 -> 16, <= 14 -> 24, <= 22 -> 32, else 48. */
export const CELL_BUCKETS: readonly number[] = [16, 24, 32, 48];
/** Nova core radius (px) = floorBucket(min(R, 56)). The rim, units and rings carry the real radius. */
export const CORE_BUCKETS: readonly number[] = [24, 40, 56];
/** Sigil (rune circle) radius (px). */
export const SIGIL_BUCKETS: readonly number[] = [16, 24, 32, 48];
/** Ground decal / fill radius (px), 8 px steps; fills use floorBucket, the exact rim is always a ring. */
export const DECAL_BUCKETS: readonly number[] = range(16, 176, 8);
/** Rings up to this radius bake as whole frames; larger rings are placed from baked arc pieces. */
export const RING_WHOLE_MAX = 64;

/** Actor body buckets by sprite height (px): player = M, commons S/M, elites L, wardens W. */
export type BodySize = 'S' | 'M' | 'L' | 'W';
export const BODY_PX: Readonly<Record<BodySize, number>> = { S: 32, M: 40, L: 64, W: 96 };

/** Vertical anchor offsets (px, negative = up) matching SkillSystem / MonsterSkills draw points. */
export const ANCHOR_DY = {
  feet: 0,
  /** Monster strike arcs (MonsterSkills: m.y - 10) and chain hop targets (m.y - 10). */
  strike: -10,
  /** Player strike arcs. */
  swing: -12,
  /** Projectiles fly at y - 14 (SkillSystem / MonsterSkills shots). */
  hand: -14,
  /** Chain origin (o.y - 16). */
  chest: -16,
} as const;

/** Directions a template bakes: 1 (radial or spinning), 8 (3 unique angles + flips) or 16 (5 unique + flips). */
export type DirCount = 1 | 8 | 16;
/** Unique bakes per DirCount. */
export const UNIQUE_DIRS: Readonly<Record<DirCount, number>> = { 1: 1, 8: 3, 16: 5 };

/** How a baked heading is shown: unique bake index `u` plus flips. */
export interface DirPick {
  u: number;
  flipX: boolean;
  flipY: boolean;
}

/**
 * Heading for an angle (radians, screen space: 0 = east, +PI/2 = south). The unique bakes cover 0..90 deg
 * (east -> south); flips cover the other quadrants. Flipping mirrors a sweep's sense, so the runtime asks for the
 * baked sense that reads correctly after the flip (docs/VFX.md §5).
 */
export function pickDir(angle: number, dirs: DirCount): DirPick {
  if (dirs === 1) return { u: 0, flipX: false, flipY: false };
  const n = dirs;
  const quarter = n / 4;
  const i = ((Math.round((angle / (Math.PI * 2)) * n) % n) + n) % n;
  if (i <= quarter) return { u: i, flipX: false, flipY: false };
  if (i <= 2 * quarter) return { u: 2 * quarter - i, flipX: true, flipY: false };
  if (i <= 3 * quarter) return { u: i - 2 * quarter, flipX: true, flipY: true };
  return { u: n - i, flipX: false, flipY: true };
}

// ------------------------------------------------------------------ components & params

export type VfxWeight = 'light' | 'normal' | 'heavy' | 'ultimate';
/** Visual escalation by authored tier: 0 plain, 1 + echo arc, 2 + family accent, 3 + flourish ring. */
export type VfxTier = 0 | 1 | 2 | 3;

/** Melee smear (sword / blade strikes, claws, execute chops). */
export interface SlashParams {
  /** Outer radius = REACH_BUCKETS nearest to the true range. */
  r: number;
  /** ARC_BUCKETS nearest to the true arc (deg). */
  arc: number;
  /** 1 = crescent; 3 = claw rakes (monster melee). */
  rakes: 1 | 3;
  /** 'arc' sweeps round the caster; 'chop' falls top -> bottom over the target (execute). */
  form: 'arc' | 'chop';
  weight: VfxWeight;
  tier: VfxTier;
  /** Sweep sense as baked (+1 clockwise on screen). Multi-hit alternates. */
  sense: 1 | -1;
  /** Arcane blade: glyphs on the leading edge (runic_blade). */
  rune: boolean;
}

/** Pierce lunge streak + X-cut (daggers, stabs). */
export interface ThrustParams {
  /** Streak length = REACH_BUCKETS nearest to the range. */
  len: number;
  weight: VfxWeight;
  tier: VfxTier;
  /** Stealth: a dark slit contrast frame before the hero frame (dropped under reduceFlash). */
  slit: boolean;
}

export type OrbForm =
  | 'orb'
  | 'fireball'
  | 'shade'
  | 'spark'
  | 'storm'
  | 'lightbolt'
  | 'moon'
  | 'prism'
  | 'lance'
  | 'wave'
  | 'gust'
  | 'spellblade'
  | 'bubble'
  | 'droplet';
export type OrbitMotif = 'glyphs' | 'shards' | 'spiral' | 'vines' | 'motes';

/** Energy projectile body; also the charge orb at a caster's hand (mode 'charge'). */
export interface OrbParams {
  form: OrbForm;
  cell: 16 | 24 | 32 | 48;
  /** Big slow piercing orbs (pierce >= 99, size >= 22): 3 orbiting units, 8-frame loop. */
  orbit?: OrbitMotif;
  /** Monster shots: 1 px ACCENT halo (LUT 'monster' maps it to danger R3). */
  halo: boolean;
  mode: 'fly' | 'charge';
}

export type MissileForm =
  | 'blade'
  | 'cleaver'
  | 'hammer'
  | 'knife'
  | 'needle'
  | 'dart'
  | 'feather'
  | 'shard'
  | 'thorn'
  | 'rock'
  | 'glob'
  | 'net'
  | 'hook';

/** Solid thrown object: always outlined #24180f, material ramp, elements arrive as an imbue. */
export interface MissileParams {
  form: MissileForm;
  cell: 16 | 24 | 32 | 48;
  halo: boolean;
  /** 'fly' = in flight; 'wrap' = held on a target (net wrap, hook bite). */
  pose: 'fly' | 'wrap';
}

/** Midpoint-displaced bolt between two points. The only template baked at cast time (docs/VFX.md §5). */
export interface BoltParams {
  /** End point relative to the start (px). Length <= VFX_BUDGET.boltMaxLen; longer hops split. */
  dx: number;
  dy: number;
  /** Displacement as a fraction of length (chain 0.32, zap 0.35). */
  jag: number;
  /** Fork chance scale 0..1 (chain 0.35, zap 0.3). */
  forks: number;
  /** 1 = chain trunk, 0.7 = arc zap. */
  strength: number;
  /** 'chain': 6 steps with blank frames; 'zap': 3 frames. */
  seq: 'chain' | 'zap';
  /** Per-cast seed (hashSeed(recipe.variety, castId, hop)): every hop differs, replays are exact. */
  seed: number;
}

export type BurstClass =
  | 'slash'
  | 'pierce'
  | 'blunt'
  | 'magic'
  | 'ki'
  | 'crit'
  | 'tick'
  | 'strong'
  | 'resist'
  | 'immune'
  | 'muzzle'
  | 'split'
  | 'glint'
  | 'fizzle'
  | 'star';

/** Radial one-shot: hit sparks, muzzle flashes, glints, fizzles, the spark-moment star. */
export interface BurstParams {
  cls: BurstClass;
  size: 's' | 'm' | 'l';
  /** Element glyph shown by 'strong' (5x5, docs/VFX.md §5). */
  glyph?: ElementId;
}

export type MoteKind =
  | 'spark'
  | 'ember'
  | 'mote'
  | 'streak'
  | 'flake'
  | 'droplet'
  | 'chip'
  | 'bubble'
  | 'leaf'
  | 'glint'
  | 'glyph'
  | 'wisp'
  | 'line'
  | 'bead'
  | 'disc'
  | 'star';

/** Tiny particle frames (the mote kit). Emission (count, pattern, speed) lives in VfxPiece.place. */
export interface MotesParams {
  kind: MoteKind;
  /** 1..3: frame size step (sparks: streak length; discs: radius). */
  size: 1 | 2 | 3;
}

export type PuffKind = 'smoke' | 'dust' | 'vapour' | 'veil' | 'gas' | 'cloud' | 'steam';

/** Soft volume with hard pixels: flat discs at opaque Bayer coverage, crescent erosion. */
export interface PuffParams {
  kind: PuffKind;
  r: 3 | 5 | 7 | 10;
}

export type RingStyle = 'solid' | 'double' | 'gapped' | 'jagged' | 'dashed' | 'inverted';
export type RingInk = 'hot' | 'lit' | 'mid' | 'dim';
export type RingAnim = 'expand' | 'contract' | 'sweep' | 'march' | 'static';

/** Rings and bands at an exact radius: shockwaves, spin bands, rims, fill fronts. */
export interface RingParams {
  /** Final radius (px), exact (the hit-test radius for rims). */
  r: number;
  /** Start radius for expand / contract. */
  r0?: number;
  aspect: Aspect;
  /** 1..4 px; gameplay cues (rims, fronts) are >= 2. */
  thick: 1 | 2 | 3 | 4;
  style: RingStyle;
  ink: RingInk;
  anim: RingAnim;
  /** Partial ring, degrees on screen [from, to] (cone rims and bands, accretion arcs). */
  arc?: readonly [number, number];
  /** Sweep heads (spin bands): 1-3, 360/heads apart. */
  heads?: 1 | 2 | 3;
  /** Total animation time (ms). */
  ms: number;
}

export type DecalKind = 'fill' | 'scorch' | 'frost' | 'wet' | 'ink' | 'rune' | 'cracks' | 'pool' | 'rift' | 'shadow';

/** Ground decals and fills (no rim: a decal must never resemble a hazard telegraph). */
export interface DecalParams {
  kind: DecalKind;
  /** DECAL_BUCKETS floorBucket of the true radius (fills) or the aftermath size. */
  r: number;
  aspect: Aspect;
  /** Ordered-dither coverage of 'fill' and disc-based kinds. */
  density: 0.125 | 0.25 | 0.5;
  /** 'disc' area, or a 'line' along the aim (crack line). */
  shape: 'disc' | 'line';
}

/** Rune circle: rings + star polygon + glyphs drawn on in sequence (arcane tells, rune cores, staff strikes). */
export interface SigilParams {
  r: 16 | 24 | 32 | 48;
  points: 5 | 6 | 7 | 8;
  glyphs: 0 | 4 | 8;
  anim: 'draw' | 'flash' | 'static';
}

export type CoreKind = 'blast' | 'ripple' | 'implode' | 'radiant' | 'sky' | 'rune' | 'cloud' | 'goo';

/** Layered release at a nova centre (and death pops, charge/dive landings). Small whatever the nova radius. */
export interface NovaParams {
  core: CoreKind;
  c: 24 | 40 | 56;
  heavy: boolean;
}

export type UnitKind =
  | 'flame-column'
  | 'lava-geyser'
  | 'rock-spike'
  | 'crystal-spike'
  | 'ice-spike'
  | 'splash-crown'
  | 'gust-swirl'
  | 'sky-bolt'
  | 'light-pillar'
  | 'tendril'
  | 'moon-mote'
  | 'star-shard'
  | 'spore-puff'
  | 'smoke-sheet'
  | 'debris'
  | 'ki-ripple';

/** Area eruption unit; the runtime scatters `place.count` of them inside the hit area. */
export interface EruptParams {
  unit: UnitKind;
  scale: 's' | 'm' | 'l';
}

export type StatusUnit =
  | 'tongue'
  | 'drip'
  | 'puddle'
  | 'chevron'
  | 'star'
  | 'microarc'
  | 'crystal'
  | 'icicle'
  | 'bubble'
  | 'drop'
  | 'splash'
  | 'beam'
  | 'speedline'
  | 'spiral'
  | 'pip';

/** Character-anchored status units (small loops placed at silhouette anchor points). */
export interface StatusParams {
  kind: StatusKind;
  unit: StatusUnit;
  body: BodySize;
}

export type AuraMotif = 'edge' | 'runes' | 'gust' | 'glint' | 'bloom' | 'ward' | 'blades' | 'veil';
export type AuraActivation = 'ring' | 'pillar' | 'sigil' | 'shout';

/** Buff activation one-shot and sustained loop (back/front halves). */
export interface AuraParams {
  motif: AuraMotif;
  phase: 'activate' | 'loop' | 'break';
  activation: AuraActivation;
  body: BodySize;
  /** Holy halo over the head (halo_ward). */
  halo: boolean;
}

export type TellPiece = 'chevron' | 'arrow' | 'bead' | 'lock' | 'edge' | 'fizzle';

/** Telegraph pieces not covered by ring / decal: lane chevrons, arrowheads, aim beads, lock flash, edge indicator. */
export interface TellParams {
  piece: TellPiece;
  /** 'danger' pieces carry the #fff8f0 contrast line + #24180f keyline. */
  danger: boolean;
}

/** Runtime-only: snapshots of the actor's own frame (dash ghosts, blinks, reprise mirror). No bake. */
export interface AfterimageParams {
  mode: 'ghost' | 'blink' | 'mirror';
  /** Stepped alpha per step (never tweened). */
  steps: readonly number[];
}

/** Every component and its bake parameters. */
export interface ComponentParams {
  slash: SlashParams;
  thrust: ThrustParams;
  orb: OrbParams;
  missile: MissileParams;
  bolt: BoltParams;
  burst: BurstParams;
  motes: MotesParams;
  puff: PuffParams;
  ring: RingParams;
  decal: DecalParams;
  sigil: SigilParams;
  nova: NovaParams;
  erupt: EruptParams;
  status: StatusParams;
  aura: AuraParams;
  tell: TellParams;
  afterimage: AfterimageParams;
}

export type ComponentId = keyof ComponentParams;

export const COMPONENT_IDS: readonly ComponentId[] = [
  'slash',
  'thrust',
  'orb',
  'missile',
  'bolt',
  'burst',
  'motes',
  'puff',
  'ring',
  'decal',
  'sigil',
  'nova',
  'erupt',
  'status',
  'aura',
  'tell',
  'afterimage',
];

/** Components the runtime draws without baked frames. */
export const RUNTIME_ONLY: readonly ComponentId[] = ['afterimage'];

// ------------------------------------------------------------------ pieces & recipes

export type VfxBlend = 'normal' | 'add' | 'multiply';

/**
 * Render layers. The runtime maps them to src/game/render/depths.ts:
 * ground -> DEPTH.FX_GROUND, preview -> DEPTH.AIM_PREVIEW, tell -> DEPTH.TELEGRAPH, body -> ySort(y, bias),
 * rim -> DEPTH.TELL_TOP (above glow and darkness), glow -> DEPTH.FX_GLOW, light -> DEPTH.LIGHT.
 */
export type VfxLayer = 'ground' | 'preview' | 'tell' | 'body' | 'rim' | 'glow' | 'light';

export type AnchorTo = 'caster' | 'target' | 'aim' | 'body' | 'path' | 'hop';

export interface VfxAnchor {
  to: AnchorTo;
  /** Vertical offset (px, ANCHOR_DY values). */
  dy: number;
  /** Extra offset along the aim (px), e.g. a thrust's X-cut at the tip. */
  along?: number;
  /** 'back' pieces sit at anchorY - 1 (behind the actor), 'front' at anchorY + 1. */
  half?: 'back' | 'front';
}

export type PlacePattern =
  | 'single'
  | 'burst'
  | 'converge'
  | 'spiral'
  | 'orbit'
  | 'trail'
  | 'rise'
  | 'fall'
  | 'poisson'
  | 'rim'
  | 'lattice'
  | 'line'
  | 'stack'
  | 'path';

/** Runtime placement (never part of a bake key). */
export interface VfxPlacement {
  pattern: PlacePattern;
  /** Instances (motes, units, ghosts). Multiplied by recipe.quota and the governor quality. */
  count?: number;
  /** Pattern radius (px): converge distance, poisson / rim radius, orbit radius. */
  radius?: number;
  aspect?: Aspect;
  /** px/s */
  speed?: number;
  spreadDeg?: number;
  /** Trails: one instance per this many px travelled. */
  everyPx?: number;
  /** Stagger between instances (ms). */
  staggerMs?: number;
  /** Units pop as the nova wavefront reaches them: t0 = 150 ms * (1 - cbrt(1 - d/R)). */
  wave?: boolean;
  /** Minimum spacing for poisson placement (px). */
  spacing?: number;
}

/** Optional travel of a piece over its life (signature drops, lobbed globs). Offsets are px from the anchor. */
export interface VfxMove {
  from: Pt;
  ms: number;
  ease: 'linear' | 'in' | 'out' | 'arc';
}

/** Tags the runtime acts on. */
export type PieceTag =
  /** Contains WHITE frames: dropped from reprise replays, counted by the flash budget. */
  | 'hero'
  | 'firstHitOnly'
  | 'laterHits'
  /** Final swing / pulse of a multi-hit cast (tier flourish). */
  | 'lastHit'
  /** Uses the merge's echo family instead of the recipe family. */
  | 'echo'
  /** Telegraph pieces: never dropped, culled or governed. */
  | 'neverGoverned'
  /** Radius / arc / length come from the event geometry (TellGeometry, novaTelegraph.r, caster radius). */
  | 'geometryFromEvent';

export interface VfxPieceOf<C extends ComponentId> {
  component: C;
  params: ComponentParams[C];
  /** Colour LUT source. */
  ramp: RampId;
  /** Geometry language for family-dependent templates (burst spokes, unit kinds). Usually equals the ramp's family. */
  motif: FamilyId;
  lut: LutVariant;
  blend: VfxBlend;
  layer: VfxLayer;
  anchor: VfxAnchor;
  place?: VfxPlacement;
  move?: VfxMove;
  /** Start after the phase trigger (ms). */
  delayMs?: number;
  /** Keep a loop / held piece alive this long (ms); default = strip length. */
  lifeMs?: number;
  tags?: readonly PieceTag[];
}

/** A component instance in a recipe phase (discriminated by `component`). */
export type VfxPiece = { [C in ComponentId]: VfxPieceOf<C> }[ComponentId];

/**
 * Phases. Each fires on a VfxEvents event (docs/VFX.md §8.2):
 * telegraph novaTelegraph / monsterTelegraph | charge castStart | cast pulse (strike swings, spin pulses), castFire
 * (muzzles), dash, buffApplied | body projectileSpawn, chainHop | trail follows a body or dash | impact hit |
 * area novaBlast, heavy landings, spin floor bands | status statusApplied | aura buffApplied.
 */
export type PhaseId = 'telegraph' | 'charge' | 'cast' | 'body' | 'trail' | 'impact' | 'area' | 'status' | 'aura';

export const PHASE_IDS: readonly PhaseId[] = ['telegraph', 'charge', 'cast', 'body', 'trail', 'impact', 'area', 'status', 'aura'];

export type VfxPhases = Partial<Record<PhaseId, readonly VfxPiece[]>>;

export type VfxOwner = 'player' | 'monster';

/** Exact hit-test geometry (from SkillSystem / MonsterSkills); telegraphs and the gallery hitbox check use it. */
export type HitGeometry =
  | { kind: 'sector'; r: number; arcDeg: number; addCasterRadius: boolean }
  | { kind: 'disc'; r: number; aspect: Aspect; at: 'caster' | 'aim'; addCasterRadius: boolean }
  | { kind: 'lane'; length: number; width: number }
  | {
      kind: 'shot';
      size: number;
      range: number;
      speed: number;
      count: number;
      spreadDeg: number;
      radial: boolean;
      pierce: number;
    }
  | { kind: 'chain'; range: number; hop: number; jumps: number }
  | { kind: 'self' };

export type StrikeStyle = 'crescent' | 'thrust' | 'staff' | 'fist' | 'cone' | 'execute' | 'claw';
export type SpinStyle = 'blades' | 'ring' | 'vortex' | 'halo' | 'wail' | 'ripple';
export type DashMode = 'ghost' | 'blink' | 'spin' | 'charge' | 'dive' | 'roll';
export type ChainMode = 'bolt' | 'knife' | 'blade' | 'palm';

/** The carrier deriveVfx chose (gallery labels, coverage tests). */
export type Carrier =
  | { kind: 'strike'; style: StrikeStyle }
  | { kind: 'spin'; style: SpinStyle }
  | { kind: 'projectile'; body: OrbForm | MissileForm; matter: boolean }
  | { kind: 'dash'; mode: DashMode }
  | { kind: 'nova'; core: CoreKind; unit: UnitKind | null }
  | { kind: 'chain'; mode: ChainMode }
  | { kind: 'buff'; motif: AuraMotif };

/** Accent a shape merge's secondary parent adds, from the mechanical difference compose() made. */
export type MergeAccent = 'extra' | 'radial' | 'spinDash' | 'knockback' | 'arc' | 'none';

/** Rider and essence effects outside the main phases (knockback is a status: phases.status draws it). */
export interface RiderFx {
  returns?: { turn: readonly VfxPiece[]; tether: readonly VfxPiece[]; catch: readonly VfxPiece[] };
  /** Replay: same geometry and buckets, LUT 'shift', no hero frames, no juice. */
  reprise?: { ghost: readonly VfxPiece[] };
  arc?: { zap: readonly VfxPiece[] };
  leech?: { stream: readonly VfxPiece[]; arrive: readonly VfxPiece[] };
  /** Pass-through marks (pierce essence or authored pierce > 0). */
  pierce?: { mark: readonly VfxPiece[] };
  /**
   * Shape merge accent. `pieces` holds the extra hit's carrier ('extra') or the echo muzzle ring ('radial'); the
   * other accents re-ink pieces already in the recipe (spin band, knockback status, arc zap) in the echo family.
   */
  merge?: { accent: MergeAccent; family: FamilyId; pieces: readonly VfxPiece[] };
}

export interface VfxJuice {
  /** Local hit-stop of the victim (ms, VSYNC_MS); later hits of a multi-hit cast get 0. */
  hitstopMs: number;
  /** Trauma added to the camera rig (0..1). */
  trauma: number;
  flash: 'none' | 'local' | 'screen';
}

export interface VfxRecipe {
  version: number;
  /** `${skill.id}#${owner}`: recipes are cached by it. */
  key: string;
  skillId: string;
  /** Root used for seeds and signature lookup: the authored base, or a merge's primary parent. */
  rootId: string;
  owner: VfxOwner;
  shape: ShapeKind;
  family: FamilyId;
  /** Element carried by a matter body (material family kept). */
  imbue?: ElementId;
  /** Secondary family of a shape merge (overlays alternate with it). */
  echo?: FamilyId;
  weight: VfxWeight;
  tier: VfxTier;
  carrier: Carrier;
  geometry: HitGeometry;
  phases: VfxPhases;
  riders: RiderFx;
  /** Exactly the kinds Combat.hit / MonsterSkills.statusesOf apply. */
  statuses: readonly StatusKind[];
  juice: VfxJuice;
  /** 1 player, 0.5 monster (counts are multiplied by it and by the governor quality). */
  quota: number;
  /** hashSeed(rootId): runtime choices only (accent index, spark angle offset); never part of a bake key. */
  variety: number;
  /** Signature patch id (= rootId) when one applied. */
  signature?: string;
}

/** Outcome of one damage event, for impact selection. */
export type HitRelation = 'strong' | 'weak' | 'same' | 'neutral' | 'immune';

export interface HitOutcome {
  /** Hit index within the cast (cast.tally); 0 = first. */
  index: number;
  /** Ms since the cast's previous hit on any target (tick sparks under VFX_BUDGET.multiHitTickWindowMs). */
  sincePrevMs: number;
  crit: boolean;
  relation: HitRelation;
  killed: boolean;
  via?: 'arc' | 'pierce' | 'return';
  /** Who was hit. */
  target: VfxOwner;
}

/** What a monster's auto-attack looks like (no SkillDef). */
export interface AttackerLook {
  id: string;
  family: Family;
  element?: ElementId;
  rank: MonsterRank;
  size: Size;
}

export type SignaturePatch = (recipe: VfxRecipe, skill: SkillDef) => VfxRecipe;

export interface SignatureDef {
  /** Authored root id (variants and merges whose root is this id inherit it). */
  id: string;
  /** One line for the gallery. */
  note: string;
  patch: SignaturePatch;
}

// ------------------------------------------------------------------ bake output

/** 'once' plays and ends empty; 'loop' repeats seamlessly; 'pieces' is a tile set the runtime places (ring arcs). */
export type StripUse = 'once' | 'loop' | 'pieces' | 'runtime';

export interface BakeOptions {
  lut: LutVariant;
  /** Remove blank and contrast frames, WHITE -> R5 (bake-time half of 'Reduce shake & flashes'). */
  reduceFlash: boolean;
  /** 50% Bayer #24180f keyline under energy shapes (light biomes: frost, snow, cream sand). */
  keyline: boolean;
}

export const DEFAULT_BAKE: BakeOptions = { lut: 'base', reduceFlash: false, keyline: false };

export interface BakedPiece {
  /** geometryKey + ramp + lut: the atlas / animation key. */
  key: string;
  /** Template geometry key (shared across ramps). Seeds derive from it, so output never depends on bake order. */
  geometryKey: string;
  component: ComponentId;
  use: StripUse;
  dirs: DirCount;
  /** [uniqueDir][frame]. */
  frames: RgbaFrame[][];
  /** White glow twins [uniqueDir][frame] (0x0 frames where a frame has no glow); tinted by the runtime. */
  glow: RgbaFrame[][];
  /** Frame indices that contain WHITE. */
  heroFrames: readonly number[];
  /** Per frame: WHITE + R5 + contrast (R0 silhouette) pixel count, for the flash budget. */
  flashPx: readonly number[];
  /** Total stored pixels (atlas budget). */
  px: number;
}

/** One template per component (package P, src/game/vfx/components/<id>.ts). */
export interface Template<C extends ComponentId> {
  readonly id: C;
  use(params: ComponentParams[C]): StripUse;
  dirs(params: ComponentParams[C]): DirCount;
  /** Stable geometry key: only fields that change pixels; omits `motif` when the template ignores it. */
  key(params: ComponentParams[C], motif: FamilyId, opts: BakeOptions): string;
  /**
   * Index frames for unique direction `u` (0..UNIQUE_DIRS[dirs]-1). Deterministic: seeded by
   * hashSeed('vfx', key, u); never reads a clock or Math.random.
   */
  frames(params: ComponentParams[C], motif: FamilyId, u: number, opts: BakeOptions): IndexFrame[];
}

export type TemplateMap = { readonly [C in ComponentId]: Template<C> };

// ------------------------------------------------------------------ module contract (docs/VFX.md §10)

/** P · ramps.ts */
export type LutFor = (ramp: RampId, variant?: LutVariant) => Uint32Array;
export interface VfxRampApi {
  RAMPS: Readonly<Record<RampId, Ramp>>;
  /** 14 entries (INDEX_COUNT), RGBA packed for the platform's endianness; entry 0 is transparent. */
  lut: LutFor;
}

/** P · bake.ts */
export type IndexFramesFor = (piece: VfxPiece, u: number, opts?: Partial<BakeOptions>) => IndexFrame[];
export type BakePiece = (piece: VfxPiece, opts?: Partial<BakeOptions>) => BakedPiece;
export type BakePhase = (pieces: readonly VfxPiece[], opts?: Partial<BakeOptions>) => BakedPiece[];
export type PieceKey = (piece: VfxPiece, opts?: Partial<BakeOptions>) => string;
export interface VfxBakeApi {
  indexFrames: IndexFramesFor;
  bakePiece: BakePiece;
  bakePhase: BakePhase;
  pieceKey: PieceKey;
}

/** R · families.ts + recipe.ts + signatures.ts */
export type SkillLookup = (id: string) => SkillDef | undefined;
export type FamilyOf = (skill: SkillDef) => FamilyId;
export type DeriveVfx = (skill: SkillDef, owner?: VfxOwner, lookup?: SkillLookup) => VfxRecipe;
export type HitGeometryFor = (skill: SkillDef, owner: VfxOwner) => HitGeometry;
export type ImpactPieces = (recipe: VfxRecipe, hit: HitOutcome) => readonly VfxPiece[];
export type StatusPieces = (kind: StatusKind, source: FamilyId, body: BodySize, owner: VfxOwner) => readonly VfxPiece[];
export type DeriveAttackVfx = (attacker: AttackerLook) => VfxRecipe;
export type ComboPieces = (combo: ComboId, body: BodySize) => readonly VfxPiece[];
export type DeathPieces = (body: BodySize, killer: FamilyId, owner: VfxOwner) => readonly VfxPiece[];
export type ExtraPieces = (event: keyof VfxExtraEvents) => readonly VfxPiece[];
export interface VfxRecipeApi {
  familyOf: FamilyOf;
  deriveVfx: DeriveVfx;
  hitGeometry: HitGeometryFor;
  impactPieces: ImpactPieces;
  statusPieces: StatusPieces;
  deriveAttackVfx: DeriveAttackVfx;
  comboPieces: ComboPieces;
  deathPieces: DeathPieces;
  extraPieces: ExtraPieces;
}
export interface VfxSignatureApi {
  SIGNATURES: Readonly<Record<string, SignatureDef>>;
}

// ------------------------------------------------------------------ runtime contract (events the runtime consumes)

/** Live actor view. The runtime reads it every frame (overlays follow it). Monster / Player adapters satisfy it. */
export interface VfxActor {
  readonly x: number;
  readonly y: number;
  readonly alive: boolean;
  readonly radius: number;
  readonly body: BodySize;
  /** Sprite display height (px) for head / hit anchors. */
  readonly height: number;
}

/**
 * Live projectile view, read every frame. GameEvents.projectileSpawn's `obj` (the Image SkillSystem / MonsterSkills
 * move) supplies x/y; `angle` comes from the spawn payload until the mover reports `returning`.
 */
export interface VfxMover {
  readonly x: number;
  readonly y: number;
  readonly active?: boolean;
  readonly returning?: boolean;
}

export interface VfxCastRef {
  /**
   * Unique per cast (SkillSystem cast.id; MonsterSkills its own counter). Until the bus carries it, the bridge uses
   * hashSeed(skillId, castFire time) so tick sparks and per-cast seeds still work (docs/VFX.md §8.2).
   */
  castId: number;
  skill: SkillDef;
  owner: VfxOwner;
  /** The reprised copy. */
  reprise?: boolean;
}

/** Exact telegraph geometry as MonsterSkills draws and hit-tests it (angles in radians). */
export type TellGeometry =
  | { kind: 'zone'; x: number; y: number; rx: number; ry: number }
  | { kind: 'cone'; x: number; y: number; r: number; ang: number; arc: number }
  | { kind: 'lane'; x0: number; y0: number; x1: number; y1: number; width: number }
  | { kind: 'aim'; x: number; y: number; angs: readonly number[]; len: number }
  | { kind: 'range'; x: number; y: number; r: number }
  | { kind: 'aura'; x: number; y: number; rx: number; ry: number };

/**
 * The normalized stream the VFX runtime consumes. `runtime/bridge.ts` (later step) subscribes to the game bus
 * (src/game/events.ts GameEvents) and emits these, deriving what the bus does not carry yet (docs/VFX.md §8.2 maps
 * every field). Times are scene (gameplay) ms.
 */
export interface VfxEvents {
  /** GameEvents.castStart. */
  castStart: { cast: VfxCastRef; caster: VfxActor; aim: Pt; durationMs: number };
  /** GameEvents.castFire: once per cast when its effect fires (monster techniques: at resolve). */
  castFire: { cast: VfxCastRef; caster: VfxActor; at: Pt; aim: Pt };
  /** Each strike swing / spin pulse (bus addition requested: GameEvents.skillPulse). */
  pulse: { cast: VfxCastRef; caster: VfxActor; at: Pt; ang: number; index: number; count: number };
  /** GameEvents.projectileSpawn (`id` = a bridge counter keyed by the payload's obj). */
  projectileSpawn: { cast: VfxCastRef; id: number; mover: VfxMover; angle: number; size: number };
  /** GameEvents.projectileEnd: range -> 'expire', return -> 'caught'. */
  projectileEnd: { cast: VfxCastRef; id: number; at: Pt; reason: 'hit' | 'expire' | 'wall' | 'caught' };
  /** GameEvents.chainHop. */
  chainHop: { cast: VfxCastRef; from: Pt; to: Pt; index: number; knife: boolean };
  /** GameEvents.novaTelegraph; timing = { start: now, at: now + delayMs } on the world clock. */
  novaTelegraph: { cast: VfxCastRef; at: Pt; r: number; aspect: Aspect; timing: { readonly start: number; readonly at: number } };
  /** GameEvents.novaBlast: the area phase. */
  novaBlast: { cast: VfxCastRef; at: Pt; r: number; aspect: Aspect; heavy: boolean };
  /** GameEvents.dash (spin from skill.shape). */
  dash: { cast: VfxCastRef; actor: VfxActor; from: Pt; to: Pt; width: number; durationMs: number; spin: boolean };
  /** GameEvents.buffApplied. */
  buffApplied: { cast?: VfxCastRef; actor: VfxActor; skill: SkillDef; stat: BuffStat; untilMs: number; owner: VfxOwner };
  /** GameEvents.statusApplied (blocked ones are dropped); untilMs from the bus, else Combat's fixed durations. */
  statusApplied: { target: VfxActor; targetOwner: VfxOwner; kind: StatusKind; untilMs: number; source?: SkillDef };
  /** GameEvents.hit (monster targets) and GameEvents.playerHurt (player target; dot ticks are dropped). */
  hit: {
    /** Absent for monster auto-attacks (then `attacker` is set when known). */
    cast?: VfxCastRef;
    attacker?: AttackerLook;
    target: VfxActor;
    targetOwner: VfxOwner;
    at: Pt;
    /** Blow direction (radians): from the cast origin / caster to the target. */
    ang: number;
    index: number;
    amount: number;
    crit: boolean;
    relation: HitRelation;
    killed: boolean;
    via?: 'arc' | 'pierce' | 'return';
    /** Arc rider: where the zap came from. */
    from?: Pt;
  };
  /** GameEvents.heal (leech / smite): stream from the struck target to the player. */
  heal: { amount: number; at: Pt; from?: Pt; source: 'leech' | 'smite' };
  /** GameEvents.combo (consumes -> combo id: freeze shatter, soak conduct, burn fan). */
  combo: { cast: VfxCastRef; target: VfxActor; combo: ComboId; spreadTo: readonly Pt[] };
  /** GameEvents.kill (monster) and GameEvents.death (player). */
  death: { target: VfxActor; owner: VfxOwner; rank?: MonsterRank; killer?: VfxCastRef };
  /**
   * GameEvents.monsterTelegraph (+ requested monsterTelegraphEnd). Until the bus carries `tell` and `timing`, the
   * bridge derives them from skill.shape, monster.radius, `at` and durationMs with MonsterSkills' rules (§8.1).
   */
  monsterTelegraph: {
    /** Pending technique id (unique per tell). */
    id: number;
    monster: VfxActor;
    skill: SkillDef;
    rank: MonsterRank;
    tell: TellGeometry;
    /** The live Pending record (MonsterSkills.shiftTime moves it); progress is read from it every frame. */
    timing: { readonly start: number; readonly at: number };
    windup: boolean;
    state: 'start' | 'cancel' | 'resolve';
  };
}

/** Bus events the VFX also uses, beyond the stream above (GameEvents.spark, levelUp; enrage requested). */
export interface VfxExtraEvents {
  spark: { at: Pt; skill: SkillDef };
  levelUp: { actor: VfxActor };
  enrage: { monster: VfxActor };
}

export type VfxEventName = keyof VfxEvents;

/** Structural view of the normalized stream (src/core/emitter.ts Emitter<VfxEvents> satisfies it). */
export interface VfxBus {
  on<K extends VfxEventName>(type: K, fn: (payload: VfxEvents[K]) => void): () => void;
}

/** Per-map look adjustments (docs/VFX.md §9). */
export interface VfxBiomeProfile {
  /** Families that get the 50% keyline on this biome (same-hue ground). */
  keyline: readonly FamilyId[];
  /** Glow layer gain (0.6 day, 1.0 dark / indoor). */
  glowGain: number;
  dark: boolean;
}

export type VfxQuality = 1 | 0.5 | 0.25;

// ------------------------------------------------------------------ budgets (hard caps, docs/VFX.md §9)

export const VFX_BUDGET = {
  atlasPage: 1024,
  maxPages: 4,
  gutterPx: 2,
  /** Pooled sprite caps per tier; total 224. Telegraph sprites are reserved and never starved. */
  sprites: { body: 96, glow: 64, ground: 40, tell: 24 },
  /** Blitter bobs for ring arcs, beads, chips; 120 reserved for telegraphs. */
  bobs: 400,
  bobsReservedForTells: 120,
  particles: 250,
  emitters: 6,
  /** Concurrent effect instances (casts, novas, statuses count one each). */
  instances: 24,
  perEvent: {
    hitMotes: 8,
    spinPulseMotes: 12,
    novaMotes: 24,
    novaUnits: 14,
    volleyBodies: 12,
    /** Beyond this many shots in a volley only every 2nd shot has a trail. */
    volleyTrailsFull: 6,
    chainHops: 6,
    statusLoopsPerTarget: 2,
    sparksPerTarget: 6,
  },
  monsterQuota: 0.5,
  /** Later hits of one cast inside this window get tick sparks. */
  multiHitTickWindowMs: 100,
  cpuMs: { update: 1.5, bakeSlice: 2, total: 3 },
  uploadBytesPerFrame: 1048576,
  /** Pooled live-bolt textures (side px -> count). */
  boltCanvases: { 256: 8, 512: 2 },
  boltMaxLen: 480,
  flash: { areaPx: 19000, perSecond: 3, minGapMs: 333, periodicHzMax: 2, screenAlphaMax: 0.35 },
  hitStop: { budgetMsPerSecond: 150, localMaxMs: 100, globalMinGapMs: 250 },
  decals: { live: 48, lifeMs: 1000, poolLifeMs: 1600, maxDensityAfterMs: 600 },
  /** Minimum width (art px) of any gameplay cue: rims, fronts, tethers, aim lines. */
  cueMinPx: 2,
  statusPipPx: 7,
  bootBakeMs: 150,
  /**
   * Map warm set (8 equipped skills + the map's techniques, statuses, sparks), baked behind the map fade one strip
   * direction at a time. Measured in Node for the worst loadout + densest map: about 0.45 s (tests/vfx-pipeline).
   */
  mapBakeMs: 600,
} as const;

/** Quality governor thresholds on an EMA of the frame delta (docs/VFX.md §9). */
export const VFX_GOVERNOR = {
  half: { overMs: 20, frames: 30 },
  quarter: { overMs: 26, frames: 30 },
  recover: { underMs: 15, frames: 120 },
} as const;
