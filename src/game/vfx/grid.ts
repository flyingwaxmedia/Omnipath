// The template QA grid (docs/VFX.md §10.4, §11.1): for every component, each value of each bucketed param and every
// enum value with the other params at defaults. Used by tests/vfx-painter.test.ts and scripts/vfx-sheets.mjs.
// Package P only; recipes (package R) build their own pieces.
import type { ElementId } from '../../core/types';
import {
  ARC_BUCKETS,
  CELL_BUCKETS,
  CORE_BUCKETS,
  DECAL_BUCKETS,
  REACH_BUCKETS,
  SIGIL_BUCKETS,
  type ComponentId,
  type ComponentParams,
  type FamilyId,
  type VfxPiece,
  type VfxPieceOf,
} from './types';

/** A piece with neutral placement (bake-relevant fields only). */
export function piece<C extends ComponentId>(component: C, params: ComponentParams[C], family: FamilyId = 'steel', extra?: Partial<VfxPieceOf<C>>): VfxPiece {
  return {
    component,
    params,
    ramp: family,
    motif: family,
    lut: 'base',
    blend: 'normal',
    layer: 'body',
    anchor: { to: 'caster', dy: 0 },
    ...extra,
  } as VfxPiece;
}

export const DEFAULTS: { readonly [C in ComponentId]: ComponentParams[C] } = {
  slash: { r: 56, arc: 120, rakes: 1, form: 'arc', weight: 'normal', tier: 0, sense: 1, rune: false },
  thrust: { len: 56, weight: 'normal', tier: 0, slit: false },
  orb: { form: 'orb', cell: 24, halo: false, mode: 'fly' },
  missile: { form: 'knife', cell: 24, halo: false, pose: 'fly' },
  bolt: { dx: 96, dy: 24, jag: 0.32, forks: 0.35, strength: 1, seq: 'chain', seed: 1 },
  burst: { cls: 'slash', size: 'm' },
  motes: { kind: 'spark', size: 2 },
  puff: { kind: 'smoke', r: 5 },
  ring: { r: 40, aspect: 1, thick: 2, style: 'solid', ink: 'hot', anim: 'expand', ms: 333 },
  decal: { kind: 'fill', r: 48, aspect: 1, density: 0.25, shape: 'disc' },
  sigil: { r: 24, points: 5, glyphs: 4, anim: 'draw' },
  nova: { core: 'blast', c: 40, heavy: false },
  erupt: { unit: 'flame-column', scale: 'm' },
  status: { kind: 'burn', unit: 'tongue', body: 'M' },
  aura: { motif: 'edge', phase: 'loop', activation: 'ring', body: 'M', halo: false },
  tell: { piece: 'chevron', danger: true },
  afterimage: { mode: 'ghost', steps: [0.6, 0.4, 0.2] },
  field: { size: 's' },
  warp: { phase: 'out', body: 'M' },
  mend: { phase: 'pulse', body: 'M' },
  shell: { phase: 'loop', body: 'M' },
  emblem: { kind: 'full', n: 1 },
};

const ELEMENTS: readonly ElementId[] = ['fire', 'water', 'earth', 'wind', 'lightning', 'shadow', 'holy', 'ice', 'magma', 'storm', 'twilight'];

/** Values to sweep per param (bucket values or enum members). */
const AXES: { readonly [C in ComponentId]: { readonly [K in keyof ComponentParams[C]]?: readonly ComponentParams[C][K][] } } = {
  slash: {
    r: REACH_BUCKETS,
    arc: ARC_BUCKETS,
    rakes: [1, 3],
    form: ['arc', 'chop'],
    weight: ['light', 'normal', 'heavy', 'ultimate'],
    tier: [0, 1, 2, 3],
    sense: [1, -1],
    rune: [false, true],
  },
  thrust: { len: REACH_BUCKETS, weight: ['light', 'normal', 'heavy', 'ultimate'], tier: [0, 1, 2, 3], slit: [false, true] },
  orb: {
    form: ['orb', 'fireball', 'shade', 'spark', 'storm', 'lightbolt', 'moon', 'prism', 'lance', 'wave', 'gust', 'spellblade', 'bubble', 'droplet'],
    cell: CELL_BUCKETS as readonly (16 | 24 | 32 | 48)[],
    orbit: [undefined, 'glyphs', 'shards', 'spiral', 'vines', 'motes'],
    halo: [false, true],
    mode: ['fly', 'charge'],
  },
  missile: {
    form: ['blade', 'cleaver', 'hammer', 'knife', 'needle', 'dart', 'feather', 'shard', 'thorn', 'rock', 'glob', 'net', 'hook'],
    cell: CELL_BUCKETS as readonly (16 | 24 | 32 | 48)[],
    halo: [false, true],
    pose: ['fly', 'wrap'],
  },
  bolt: { dx: [24, 96, 240, 470], dy: [0, -60, 90], strength: [1, 0.7], seq: ['chain', 'zap'], seed: [1, 2, 3] },
  burst: {
    cls: ['slash', 'pierce', 'blunt', 'magic', 'ki', 'crit', 'tick', 'strong', 'resist', 'immune', 'muzzle', 'split', 'glint', 'fizzle', 'star', 'jab', 'hook', 'palm', 'kick', 'slam'],
    size: ['s', 'm', 'l'],
  },
  motes: {
    kind: ['spark', 'ember', 'mote', 'streak', 'flake', 'droplet', 'chip', 'bubble', 'leaf', 'glint', 'glyph', 'wisp', 'line', 'bead', 'disc', 'star'],
    size: [1, 2, 3],
  },
  puff: { kind: ['smoke', 'dust', 'vapour', 'veil', 'gas', 'cloud', 'steam'], r: [3, 5, 7, 10] },
  ring: {
    r: [8, 24, 40, 64, 96, 176],
    aspect: [1, 0.65],
    thick: [1, 2, 3, 4],
    style: ['solid', 'double', 'gapped', 'jagged', 'dashed', 'inverted'],
    ink: ['hot', 'lit', 'mid', 'dim'],
    anim: ['expand', 'contract', 'sweep', 'march', 'static'],
    arc: [undefined, [-60, 60], [200, 340]],
    heads: [1, 2, 3],
    smear: [4, 6, 8],
  },
  decal: {
    kind: ['fill', 'scorch', 'frost', 'wet', 'ink', 'rune', 'cracks', 'pool', 'rift', 'shadow'],
    r: DECAL_BUCKETS,
    aspect: [1, 0.65],
    density: [0.125, 0.25, 0.5],
    shape: ['disc', 'line'],
  },
  sigil: { r: SIGIL_BUCKETS as readonly (16 | 24 | 32 | 48)[], points: [5, 6, 7, 8], glyphs: [0, 4, 8], anim: ['draw', 'flash', 'static'] },
  nova: { core: ['blast', 'ripple', 'implode', 'radiant', 'sky', 'rune', 'cloud', 'goo'], c: CORE_BUCKETS as readonly (24 | 40 | 56)[], heavy: [false, true] },
  erupt: {
    unit: [
      'flame-column',
      'lava-geyser',
      'rock-spike',
      'crystal-spike',
      'ice-spike',
      'splash-crown',
      'gust-swirl',
      'sky-bolt',
      'light-pillar',
      'tendril',
      'moon-mote',
      'star-shard',
      'spore-puff',
      'smoke-sheet',
      'debris',
      'ki-ripple',
    ],
    scale: ['s', 'm', 'l'],
  },
  status: {
    kind: ['burn', 'slow', 'soak', 'stun', 'knockback', 'shock', 'bleed', 'smite', 'freeze', 'poison', 'pull', 'root', 'launch', 'expose', 'lure'],
    unit: ['tongue', 'drip', 'puddle', 'chevron', 'star', 'microarc', 'crystal', 'icicle', 'bubble', 'drop', 'splash', 'beam', 'speedline', 'spiral', 'pip', 'shackle', 'updraft', 'breach', 'beckon'],
    body: ['S', 'M', 'L', 'W'],
  },
  aura: {
    motif: ['edge', 'runes', 'gust', 'glint', 'bloom', 'ward', 'blades', 'veil'],
    phase: ['activate', 'loop', 'break'],
    activation: ['ring', 'pillar', 'sigil', 'shout'],
    body: ['S', 'M', 'L', 'W'],
    halo: [false, true],
  },
  tell: { piece: ['chevron', 'arrow', 'bead', 'lock', 'edge', 'fizzle'], danger: [false, true] },
  afterimage: { mode: ['ghost', 'blink', 'mirror'] },
  field: { size: ['s', 'm'] },
  warp: { phase: ['out', 'in'], body: ['S', 'M', 'L', 'W'] },
  mend: { phase: ['pulse', 'loop'], body: ['S', 'M', 'L', 'W'] },
  shell: { phase: ['form', 'loop', 'absorb', 'break'], body: ['S', 'M', 'L', 'W'] },
  emblem: { kind: ['full', 'finisher', 'cashIn', 'stance', 'step', 'mark'], n: [1, 2, 3, 4, 5] },
};

/** Grid params for one component (defaults first, then one axis at a time; duplicates removed). */
export function gridParams<C extends ComponentId>(c: C): ComponentParams[C][] {
  const base = DEFAULTS[c];
  const out: ComponentParams[C][] = [base];
  const seen = new Set([JSON.stringify(base)]);
  const axes = AXES[c] as Record<string, readonly unknown[] | undefined>;
  for (const k of Object.keys(axes)) {
    for (const v of axes[k] ?? []) {
      const p = { ...base, [k]: v } as ComponentParams[C];
      if (c === 'ring' && (k === 'heads' || k === 'smear')) (p as ComponentParams['ring']).anim = 'sweep';
      if (c === 'ring' && k === 'smear') (p as ComponentParams['ring']).heads = 2;
      if (c === 'burst' && k === 'cls' && v === 'strong') (p as ComponentParams['burst']).glyph = 'fire';
      const s = JSON.stringify(p);
      if (seen.has(s)) continue;
      seen.add(s);
      out.push(p);
    }
  }
  if (c === 'burst')
    for (const g of ELEMENTS) out.push({ cls: 'strong', size: 'm', glyph: g } as ComponentParams[C]);
  return out;
}

/** The grid as pieces for one family (the motif equals the family). Aura and ring add back / front halves. */
export function gridPieces(c: ComponentId, family: FamilyId): VfxPiece[] {
  const out: VfxPiece[] = gridParams(c).map((p) => piece(c, p as never, family));
  if (c === 'ring' || c === 'aura' || c === 'mend' || c === 'shell')
    for (const half of ['back', 'front'] as const) out.push(piece(c, DEFAULTS[c] as never, family, { anchor: { to: 'caster', dy: 0, half } }));
  return out;
}

/** Families a component is used with. Everything bakes for every family; tells and dashed rims are also danger. */
export const GRID_MOTIFS: readonly FamilyId[] = ['fire', 'ice', 'steel'];
