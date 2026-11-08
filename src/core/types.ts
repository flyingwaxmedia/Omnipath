// Core, engine-agnostic types for the Omnipath skill system.
// Nothing in /core may import Phaser or touch the DOM so it can run
// on a future authoritative game server unchanged.

export type WeaponType = 'sword' | 'dagger' | 'staff';
export const WEAPON_TYPES: readonly WeaponType[] = ['sword', 'dagger', 'staff'];

export type ElementId =
  | 'fire'
  | 'water'
  | 'earth'
  | 'wind'
  | 'lightning'
  | 'shadow'
  | 'holy'
  | 'ice'
  | 'magma'
  | 'storm'
  | 'twilight';

export type StatusKind =
  | 'burn'
  | 'slow'
  | 'stun'
  | 'knockback'
  | 'shock'
  | 'bleed'
  | 'smite'
  | 'freeze'
  | 'poison'
  | 'pull';

export interface ElementDef {
  id: ElementId;
  name: string;
  /** Adjective used when procedurally naming infused skills, e.g. "Blazing". */
  prefix: string;
  icon: string;
  color: number;
  /** 0 = primal element, 1 = element created by fusing two others. */
  tier: 0 | 1;
  desc: string;
  status: StatusKind;
  strongVs: ElementId[];
}

export type BuffStat = 'atk' | 'matk' | 'speed' | 'crit' | 'regen' | 'def';

export type SkillShape =
  | { kind: 'strike'; range: number; arc: number; hits?: number }
  | { kind: 'spin'; radius: number; pulses?: number }
  | {
      kind: 'projectile';
      speed: number;
      range: number;
      count?: number;
      spread?: number;
      pierce?: number;
      size?: number;
      radial?: boolean;
    }
  | { kind: 'dash'; distance: number; width: number; spin?: boolean }
  | { kind: 'nova'; radius: number; range: number; delay?: number }
  | { kind: 'chain'; range: number; jumps: number }
  | { kind: 'buff'; stat: BuffStat; amount: number; duration: number };

export interface SkillDef {
  id: string;
  name: string;
  desc: string;
  icon: string;
  /** 0 = basic weapon attack, 1 = first morph / simple fusion, 2+ = deeper. */
  tier: number;
  /** Weapons that can use this skill. Undefined = any weapon. */
  weapons?: WeaponType[];
  tags: string[];
  element?: ElementId;
  /** Damage multiplier applied to ATK (or MATK for arcane skills). */
  power: number;
  spCost: number;
  /** Cooldown in ms. 0 = use the weapon's attack delay. */
  cooldown: number;
  shape: SkillShape;
  maxRank: number;
  /** Extra on-hit effect in addition to the element's own status. */
  status?: StatusKind;
  /** Additional crit chance (percentage points). */
  critBonus?: number;
  /** True for skills created procedurally (e.g. element infusions). */
  generated?: boolean;
}

export type Requirement =
  | { type: 'element'; id: ElementId }
  | { type: 'skill'; id: string; rank?: number }
  | { type: 'flag'; id: string; min: number; label?: string }
  | { type: 'level'; min: number }
  | { type: 'class'; id: string };

export interface MorphDef {
  from: string;
  to: string;
  requires?: Requirement[];
  /** Shown while the morph is still locked. */
  hint?: string;
}

/** Fusion ingredient reference: `skill:<id>` or `el:<id>`. */
export type IngredientRef = string;

export interface FusionRecipe {
  a: IngredientRef;
  b: IngredientRef;
  result: IngredientRef;
  requires?: Requirement[];
  /** Whispered when the player experiments with one half of this recipe. */
  hint?: string;
}

export interface ClassClause {
  /** A skill counts if it has every tag listed (element ids count as tags). */
  tags: string[];
  count: number;
}

export interface StatBonus {
  atk?: number;
  matk?: number;
  hp?: number;
  sp?: number;
  speed?: number;
  crit?: number;
  cdr?: number;
  /** Percent bonus damage for skills carrying the tag. */
  tagPower?: Record<string, number>;
}

export interface ClassDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Riddle shown before the class is discovered. */
  hint: string;
  clauses: ClassClause[];
  distinctElements?: number;
  bonus: StatBonus;
  /** Signature skills granted on discovery. */
  grants?: string[];
}

export interface GameData {
  elements: ElementDef[];
  skills: SkillDef[];
  morphs: MorphDef[];
  recipes: FusionRecipe[];
  classes: ClassDef[];
}
