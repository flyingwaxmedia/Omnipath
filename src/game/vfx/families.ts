// VFX families (docs/VFX.md §3.1, §3.3): element / tag -> family, and each family's motif language as data.
// Package R. Phaser-free and pure: no clock, no Math.random.
import type { ElementId, SkillDef, StatusKind } from '../../core/types';
import { GAME_DATA } from '../../data';
import type { CoreKind, DecalKind, FamilyId, MoteKind, OrbForm, PuffKind, RingStyle, TagFamily, UnitKind } from './types';

/** Tag families in Combat.colorFor precedence (arcane > stealth > toxin > spirit), steel otherwise. */
export const TAG_FAMILIES: readonly Exclude<TagFamily, 'steel'>[] = ['arcane', 'stealth', 'toxin', 'spirit'];

/**
 * `skill.element` ?? the first of arcane, stealth, toxin, spirit in the skill's tags ?? 'steel'. Same precedence as
 * Combat.colorFor, so HUD pips, icons and effects agree. Never 'danger' (that family belongs to monster tells).
 */
export function familyOf(skill: SkillDef): FamilyId {
  if (skill.element) return skill.element;
  for (const t of TAG_FAMILIES) if (skill.tags.includes(t)) return t;
  return 'steel';
}

const ELEMENT_STATUS = new Map<ElementId, StatusKind>(GAME_DATA.elements.map((e) => [e.id, e.status]));

/** The status an element applies on hit (data/elements.ts). */
export function elementStatus(el: ElementId): StatusKind | undefined {
  return ELEMENT_STATUS.get(el);
}

export const ELEMENT_IDS: readonly ElementId[] = GAME_DATA.elements.map((e) => e.id);

/** A family overlay on a carrier: motes (and optionally a puff) in the family's grayscale language. */
export interface Overlay {
  mote: MoteKind | null;
  size: 1 | 2 | 3;
  puff?: PuffKind;
}

/** One family's motif language (§3.3): what each shape adds in this family. */
export interface FamilyLook {
  /** Nova core when no shape rule picks one (§6.2 nova). */
  core: CoreKind;
  /** Nova / area unit. */
  unit: UnitKind;
  /** Aftermath decal (null: none). */
  decal: DecalKind | null;
  /** Strike overlay on the arc edge. */
  strike: Overlay;
  /** Spin overlay per pulse. */
  spin: Overlay;
  /** Projectile / dash trail. */
  trail: Overlay;
  /** Hit motes (≤ 8 per hit). */
  hit: MoteKind;
  /** Breath / cone puff (wind streams line motes instead). */
  cone: PuffKind | null;
  /** Ring language for this family's rings and bands. */
  ring: RingStyle;
  /** Energy orb form for charge orbs and family-shaped projectiles. */
  orb: OrbForm;
  /** May use ADD glow pieces (light pools). Shadow, earth, wind, toxin, stealth and steel never do (P8). */
  glow: boolean;
}

const o = (mote: MoteKind | null, size: 1 | 2 | 3 = 1, puff?: PuffKind): Overlay => (puff ? { mote, size, puff } : { mote, size });

export const LOOKS: Readonly<Record<Exclude<FamilyId, 'danger'>, FamilyLook>> = {
  fire: { core: 'blast', unit: 'flame-column', decal: 'scorch', strike: o('ember', 2), spin: o('ember', 2), trail: o('ember', 1, 'smoke'), hit: 'ember', cone: 'smoke', ring: 'solid', orb: 'fireball', glow: true },
  water: { core: 'ripple', unit: 'splash-crown', decal: 'wet', strike: o('droplet', 2), spin: o('droplet', 1), trail: o('droplet', 1, 'vapour'), hit: 'droplet', cone: 'vapour', ring: 'solid', orb: 'droplet', glow: true },
  earth: { core: 'blast', unit: 'rock-spike', decal: 'cracks', strike: o('chip', 2, 'dust'), spin: o('chip', 2), trail: o('chip', 1, 'dust'), hit: 'chip', cone: 'dust', ring: 'jagged', orb: 'orb', glow: false },
  wind: { core: 'ripple', unit: 'gust-swirl', decal: null, strike: o('streak', 2), spin: o('leaf', 2), trail: o('streak', 1), hit: 'leaf', cone: null, ring: 'gapped', orb: 'gust', glow: false },
  lightning: { core: 'sky', unit: 'sky-bolt', decal: 'scorch', strike: o('spark', 2), spin: o('spark', 2), trail: o('spark', 1), hit: 'spark', cone: 'cloud', ring: 'solid', orb: 'spark', glow: true },
  shadow: { core: 'implode', unit: 'tendril', decal: 'ink', strike: o('wisp', 2), spin: o('wisp', 2), trail: o('wisp', 1), hit: 'wisp', cone: 'veil', ring: 'solid', orb: 'shade', glow: false },
  holy: { core: 'radiant', unit: 'light-pillar', decal: 'rune', strike: o('glint', 2), spin: o('glint', 1), trail: o('glint', 1), hit: 'glint', cone: 'cloud', ring: 'double', orb: 'lightbolt', glow: true },
  ice: { core: 'blast', unit: 'ice-spike', decal: 'frost', strike: o('chip', 1), spin: o('flake', 2), trail: o('glint', 1), hit: 'flake', cone: 'vapour', ring: 'solid', orb: 'orb', glow: true },
  magma: { core: 'blast', unit: 'lava-geyser', decal: 'pool', strike: o('chip', 2), spin: o('ember', 2), trail: o('droplet', 1, 'smoke'), hit: 'ember', cone: 'smoke', ring: 'jagged', orb: 'fireball', glow: true },
  storm: { core: 'sky', unit: 'sky-bolt', decal: 'wet', strike: o('spark', 1), spin: o('line', 2), trail: o('line', 1), hit: 'spark', cone: 'cloud', ring: 'solid', orb: 'storm', glow: true },
  twilight: { core: 'implode', unit: 'moon-mote', decal: 'ink', strike: o('star', 1), spin: o('star', 1), trail: o('star', 1), hit: 'star', cone: 'veil', ring: 'solid', orb: 'moon', glow: true },
  steel: { core: 'blast', unit: 'debris', decal: null, strike: o('glint', 1), spin: o(null), trail: o(null), hit: 'spark', cone: 'dust', ring: 'solid', orb: 'orb', glow: false },
  arcane: { core: 'rune', unit: 'star-shard', decal: 'rune', strike: o('glyph', 1), spin: o('glyph', 1), trail: o('glyph', 1), hit: 'glyph', cone: 'cloud', ring: 'solid', orb: 'orb', glow: true },
  stealth: { core: 'cloud', unit: 'smoke-sheet', decal: null, strike: o('glint', 1), spin: o(null, 1, 'veil'), trail: o(null), hit: 'glint', cone: 'veil', ring: 'solid', orb: 'orb', glow: false },
  toxin: { core: 'cloud', unit: 'spore-puff', decal: null, strike: o('droplet', 1), spin: o(null, 1, 'gas'), trail: o('bubble', 1), hit: 'bubble', cone: 'gas', ring: 'solid', orb: 'orb', glow: false },
  spirit: { core: 'ripple', unit: 'ki-ripple', decal: null, strike: o('disc', 1), spin: o('disc', 1), trail: o('disc', 1), hit: 'disc', cone: 'vapour', ring: 'double', orb: 'orb', glow: true },
};

/** A player family's look ('danger' reads as steel: it never shapes a body). */
export function lookOf(f: FamilyId): FamilyLook {
  return LOOKS[f === 'danger' ? 'steel' : f];
}

/** Families whose pieces may use the ADD blend (glow / light layers). */
export function mayGlow(f: FamilyId): boolean {
  return f !== 'danger' && LOOKS[f].glow;
}
