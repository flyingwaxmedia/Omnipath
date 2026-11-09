// Class looks (actors lane; docs/CLIENT-v3.md §5, docs/ART-DIRECTION.md §4): an ORIGINAL outfit for each of the 30
// classes in src/data/classes.ts. The player's sprite wears the outfit of the worn class; "No class" (Novice) is the
// plain weapon look (`player_<w>`).
//
// This module is pure data (no Phaser, no DOM) so tests can check it in node. art/characters.ts turns an outfit into
// pixels (`drawPlayerLook`), entities/actors.ts generates the textures lazily as `player_<w>__<classId>` with the same
// frame set as the base player (`_idle_1`, `_walk_0..3`, `_atk_0..1`).
//
// Every outfit keeps the player's own face, hair style and weapon; it changes the clothes:
// - palette: primary (tunic / robe / breastplate), secondary (legs, under-sleeves, default headgear), trim (collar,
//   hems, crest, emblem);
// - armour: cloth (tunic), leather (jerkin over a shirt, strap and buckle), plate (breastplate, greaves, steel boots),
//   robe (long robe; `hem` 40 = knee coat … 44 = floor);
// - headgear, shoulder pieces, a chest emblem;
// - a cape from Tier II; an aura particle colour at Tier III.
import type { WeaponType } from '../../core/types';

export type Armour = 'cloth' | 'leather' | 'plate' | 'robe';

/** Headgear shapes (art/characters.ts paints each). `wizard` is the floppy pointed hat, `tallhat` a top hat. */
export type Headgear =
  | 'none'
  | 'hood'
  | 'widehat'
  | 'tallhat'
  | 'wizard'
  | 'helm'
  | 'winghelm'
  | 'circlet'
  | 'crown'
  | 'horns'
  | 'antlers'
  | 'bandana';

export type Shoulders = 'none' | 'pad' | 'plate' | 'spiked' | 'fur' | 'crystal';

/** 5x5 chest emblems. */
export type Emblem =
  | 'swords'
  | 'spiral'
  | 'flame'
  | 'eye'
  | 'knives'
  | 'star'
  | 'gem'
  | 'rune'
  | 'drop'
  | 'bolt'
  | 'mountain'
  | 'prism'
  | 'feather'
  | 'sun'
  | 'dusk'
  | 'leaf'
  | 'mask'
  | 'moon'
  | 'wisp'
  | 'crown';

export interface ClassOutfit {
  /** Tunic / robe / breastplate colour (#rrggbb). */
  primary: string;
  /** Legs, under-sleeves and the default headgear colour. */
  secondary: string;
  /** Collar, hems, crest, band and the chest emblem. */
  trim: string;
  armour: Armour;
  headgear: Headgear;
  /** Headgear colour (default `secondary`). */
  headColor?: string;
  /** Plume, hat band, horn tips or brow gem (default `trim`). */
  headAccent?: string;
  /** A plume on a helm (colour). */
  plume?: string;
  shoulders: Shoulders;
  /** Shoulder piece colour (default: steel for plate armour, else `secondary`). */
  shoulderColor?: string;
  emblem: Emblem;
  /** Cape colour (every Tier II and Tier III class has one; Tier I never does). */
  cape?: string;
  /** Aura particle colour (Tier III only). */
  aura?: string;
  /** Hair colour override (the hair style stays the player's). */
  hair?: string;
  scarf?: string;
  /** Cloth mask over the lower face. */
  mask?: string;
  /** Diagonal strap across the chest. */
  sash?: string;
  sleeves?: string;
  legs?: string;
  boots?: string;
  belt?: string;
  /** Robe hem row (robe armour): 40 = knee coat, 44 = floor length. */
  hem?: number;
  /** Something on the back. */
  back?: 'pack' | 'quiver' | 'scrolls';
}

// Shared colours (kept in the warm-light / plum-shadow family of ART-DIRECTION §2).
const STEEL = '#a4aebb';
const STEEL_DARK = '#5f6874';
const GOLD = '#e9c46a';
const LEATHER = '#5c3d22';
const LEATHER_DARK = '#3d2817';
const CREAM = '#efe6c8';

/**
 * The 30 outfits, keyed by class id. Tier I: no cape. Tier II: a cape. Tier III: a cape and an aura.
 * Evolutions echo their parents (Blademaster → Sword Saint, Arcanist → Archmage, …) without copying them.
 */
export const CLASS_OUTFITS: Readonly<Record<string, ClassOutfit>> = {
  // ================================================================ Tier I
  blademaster: {
    primary: '#8d98a8',
    secondary: '#2e3a5a',
    trim: '#c0373f',
    armour: 'plate',
    headgear: 'helm',
    headColor: STEEL,
    plume: '#c0373f',
    shoulders: 'plate',
    emblem: 'swords',
    belt: '#4a3220',
  },
  tempest_dancer: {
    primary: '#2f9a8a',
    secondary: '#e4ecdc',
    trim: GOLD,
    armour: 'cloth',
    headgear: 'bandana',
    headColor: '#bff0e4',
    shoulders: 'none',
    emblem: 'spiral',
    scarf: '#bff0e4',
    legs: '#3b5a6a',
    sash: '#e9c46a',
  },
  pyroblade: {
    primary: '#8a2a1e',
    secondary: '#2e2626',
    trim: '#ff9a3a',
    armour: 'leather',
    headgear: 'none',
    hair: '#d8502a',
    shoulders: 'spiked',
    shoulderColor: '#4a3a36',
    emblem: 'flame',
    sleeves: '#3a2a2a',
  },
  shadowstalker: {
    primary: '#3a3448',
    secondary: '#24222e',
    trim: '#9a7cd0',
    armour: 'leather',
    headgear: 'hood',
    headColor: '#463e58',
    shoulders: 'none',
    emblem: 'eye',
    mask: '#1e1c26',
    sleeves: '#2c2838',
  },
  knife_juggler: {
    primary: '#c0443a',
    secondary: '#e9b640',
    trim: CREAM,
    armour: 'cloth',
    headgear: 'tallhat',
    headColor: '#2e2a3a',
    headAccent: '#c0443a',
    shoulders: 'pad',
    shoulderColor: '#e9b640',
    emblem: 'knives',
    legs: '#2e2a3a',
    sash: '#4a3220',
  },
  assassin: {
    primary: '#232a42',
    secondary: '#1b2034',
    trim: '#c8d0e8',
    armour: 'leather',
    headgear: 'widehat',
    headColor: '#2a2a36',
    headAccent: '#9c2a34',
    shoulders: 'pad',
    shoulderColor: '#343c5a',
    emblem: 'star',
    mask: '#151826',
    sleeves: '#2a3250',
  },
  arcanist: {
    primary: '#3a4a9a',
    secondary: '#262a58',
    trim: '#bfe8ff',
    armour: 'robe',
    headgear: 'wizard',
    headColor: '#2e3a80',
    headAccent: '#bfe8ff',
    shoulders: 'none',
    emblem: 'gem',
    hem: 44,
  },
  pyromancer: {
    primary: '#a8322a',
    secondary: '#5a1e1a',
    trim: '#ffb84a',
    armour: 'robe',
    headgear: 'hood',
    headColor: '#8a2620',
    headAccent: '#ffb84a',
    shoulders: 'none',
    emblem: 'flame',
    belt: '#3d2817',
    hem: 43,
  },
  tidecaller: {
    primary: '#2f6fa3',
    secondary: '#1f4a6a',
    trim: '#9fe8ff',
    armour: 'robe',
    headgear: 'circlet',
    headColor: '#d8eef6',
    headAccent: '#7ff0ff',
    shoulders: 'crystal',
    shoulderColor: '#d8eef6',
    emblem: 'drop',
    sash: '#d8eef6',
    hem: 44,
  },
  stormcaller: {
    primary: '#4a5470',
    secondary: '#2a3044',
    trim: '#ffe066',
    armour: 'robe',
    headgear: 'widehat',
    headColor: '#3a4258',
    headAccent: '#ffe066',
    shoulders: 'pad',
    shoulderColor: '#5c6884',
    emblem: 'bolt',
    belt: '#2a2030',
    hem: 40,
  },
  earthshaper: {
    primary: '#7a5a36',
    secondary: '#4a6a32',
    trim: '#d8b060',
    armour: 'leather',
    headgear: 'bandana',
    headColor: '#5a7a3a',
    shoulders: 'fur',
    shoulderColor: '#b89a70',
    emblem: 'mountain',
    sleeves: '#5a7a3a',
    legs: '#4a3a2a',
  },
  elementalist: {
    primary: '#ece4d0',
    secondary: '#5a4a7a',
    trim: GOLD,
    armour: 'robe',
    headgear: 'circlet',
    headColor: GOLD,
    headAccent: '#ff7a5a',
    shoulders: 'none',
    emblem: 'prism',
    sash: '#5a4a7a',
    hem: 44,
  },
  spellblade: {
    primary: '#6a6a9a',
    secondary: '#2e2a4a',
    trim: '#7ff0ff',
    armour: 'plate',
    headgear: 'none',
    shoulders: 'crystal',
    shoulderColor: '#8a8ab8',
    emblem: 'rune',
    scarf: '#4a3a7a',
  },
  wayfarer: {
    primary: '#8a6a42',
    secondary: '#3f5a7a',
    trim: GOLD,
    armour: 'leather',
    headgear: 'widehat',
    headColor: '#6a4a2a',
    headAccent: '#b8323a',
    shoulders: 'none',
    emblem: 'feather',
    scarf: '#b8323a',
    sleeves: '#d8c8a0',
    back: 'pack',
  },
  paladin: {
    primary: '#dcd8cc',
    secondary: '#3a5aa8',
    trim: GOLD,
    armour: 'plate',
    headgear: 'helm',
    headColor: '#dcd8cc',
    headAccent: GOLD,
    plume: '#f4f0e6',
    shoulders: 'plate',
    shoulderColor: GOLD,
    emblem: 'sun',
  },
  twilight_sage: {
    primary: '#5a3a7a',
    secondary: '#d87a4a',
    trim: '#ffd08a',
    armour: 'robe',
    headgear: 'hood',
    headColor: '#4a2e66',
    headAccent: '#ffd08a',
    shoulders: 'none',
    emblem: 'dusk',
    sash: '#d87a4a',
    hem: 44,
  },
  windblade: {
    primary: '#dfe8e0',
    secondary: '#3a7a6a',
    trim: '#4fb894',
    armour: 'cloth',
    headgear: 'none',
    shoulders: 'pad',
    shoulderColor: '#3a7a6a',
    emblem: 'leaf',
    scarf: '#6fd0b0',
    belt: '#3a5a4a',
  },
  mimic: {
    primary: '#6a7a3a',
    secondary: '#8a4a6a',
    trim: '#f0a0b0',
    armour: 'leather',
    headgear: 'horns',
    headColor: '#e8dcc0',
    headAccent: '#8a4a6a',
    shoulders: 'fur',
    shoulderColor: '#8a6a4a',
    emblem: 'mask',
    sleeves: '#8a4a6a',
  },
  moonwarden: {
    primary: '#2a3a6a',
    secondary: '#1e2848',
    trim: '#e8f0ff',
    armour: 'robe',
    headgear: 'antlers',
    headColor: '#d8ccb0',
    headAccent: '#bfe8ff',
    shoulders: 'none',
    emblem: 'moon',
    sash: '#9ab0d8',
    hem: 44,
  },

  // ================================================================ Tier II (cape)
  sword_saint: {
    primary: '#ece8de',
    secondary: '#2e3a6a',
    trim: GOLD,
    armour: 'cloth',
    headgear: 'none',
    hair: '#e8e4dc',
    shoulders: 'plate',
    shoulderColor: '#d8b04a',
    emblem: 'swords',
    cape: '#2e3a6a',
    belt: '#2e3a6a',
    legs: '#2e3a6a',
  },
  magma_knight: {
    primary: '#3e3434',
    secondary: '#5a2a1e',
    trim: '#ff7a2a',
    armour: 'plate',
    headgear: 'helm',
    headColor: '#4a3e3e',
    headAccent: '#ff7a2a',
    shoulders: 'spiked',
    shoulderColor: '#4a3e3e',
    emblem: 'flame',
    cape: '#8a2a1e',
  },
  phantom: {
    primary: '#4a4a6a',
    secondary: '#2a2a3e',
    trim: '#c0b0ff',
    armour: 'cloth',
    headgear: 'hood',
    headColor: '#5a5a7e',
    headAccent: '#c0b0ff',
    shoulders: 'none',
    emblem: 'wisp',
    cape: '#34344e',
    mask: '#22222e',
  },
  archmage: {
    primary: '#4a2e8a',
    secondary: '#1e2250',
    trim: GOLD,
    armour: 'robe',
    headgear: 'wizard',
    headColor: '#3a2470',
    headAccent: GOLD,
    shoulders: 'crystal',
    shoulderColor: '#bfe8ff',
    emblem: 'star',
    cape: '#1e2250',
    hem: 44,
  },
  prism_sage: {
    primary: '#f2eee4',
    secondary: '#8ab8e8',
    trim: '#b08aff',
    armour: 'robe',
    headgear: 'circlet',
    headColor: '#d8e0f0',
    headAccent: '#ff8ad0',
    shoulders: 'crystal',
    shoulderColor: '#bff0ff',
    emblem: 'prism',
    cape: '#7a5ab8',
    hem: 44,
  },
  vortex_dancer: {
    primary: '#1f7a8a',
    secondary: '#d8f0ec',
    trim: '#9ff0e0',
    armour: 'cloth',
    headgear: 'bandana',
    headColor: '#e8fff8',
    shoulders: 'pad',
    shoulderColor: '#9ff0e0',
    emblem: 'spiral',
    cape: '#2fb0a0',
    scarf: '#e8fff8',
    legs: '#24485a',
  },
  runeknight: {
    primary: '#6e7a7a',
    secondary: '#2e3a3a',
    trim: '#5ff0c0',
    armour: 'plate',
    headgear: 'helm',
    headColor: '#7a8686',
    headAccent: '#5ff0c0',
    shoulders: 'plate',
    shoulderColor: '#5a6666',
    emblem: 'rune',
    cape: '#2e4a40',
  },
  stormreaver: {
    primary: '#2e4a7a',
    secondary: '#1e2a44',
    trim: '#ffe066',
    armour: 'leather',
    headgear: 'winghelm',
    headColor: '#b8c4d8',
    headAccent: '#ffe066',
    shoulders: 'spiked',
    shoulderColor: '#7a88a8',
    emblem: 'bolt',
    cape: '#3a5a9a',
    sleeves: '#3a4a6a',
  },
  echo_sovereign: {
    primary: '#3a2a4a',
    secondary: '#24182e',
    trim: '#c88aff',
    armour: 'robe',
    headgear: 'crown',
    headColor: '#6a6070',
    headAccent: '#c88aff',
    shoulders: 'fur',
    shoulderColor: '#5a4a6a',
    emblem: 'mask',
    cape: '#5a2a6a',
    hem: 43,
  },

  // ================================================================ Tier III (cape + aura)
  ascendant: {
    primary: '#f0ece0',
    secondary: '#3a5aa8',
    trim: GOLD,
    armour: 'plate',
    headgear: 'crown',
    headColor: GOLD,
    headAccent: '#7ff0ff',
    shoulders: 'plate',
    shoulderColor: GOLD,
    emblem: 'crown',
    cape: '#3a5aa8',
    aura: '#fff0b0',
  },
  eclipse_walker: {
    primary: '#2a2234',
    secondary: '#18141e',
    trim: '#e9c46a',
    armour: 'leather',
    headgear: 'horns',
    headColor: '#6a5a7a',
    headAccent: GOLD,
    shoulders: 'spiked',
    shoulderColor: '#3a3048',
    emblem: 'dusk',
    cape: '#3a2450',
    aura: '#c88aff',
    scarf: '#6a3a8a',
    sleeves: '#3a2e48',
  },
};

/** The outfit for a class id (null for "No class" or an unknown id: the plain weapon look). */
export function classOutfit(id: string | null | undefined): ClassOutfit | null {
  return (id && CLASS_OUTFITS[id]) || null;
}

/** Tier III aura particle colour as a number (null when the class has none). */
export function auraColor(id: string | null | undefined): number | null {
  const a = classOutfit(id)?.aura;
  return a ? parseInt(a.slice(1), 16) : null;
}

/** Frame suffixes of every player look, in the base player's order (idle 0 is the bare key). */
export const LOOK_FRAMES = ['', '_idle_1', '_walk_0', '_walk_1', '_walk_2', '_walk_3', '_atk_0', '_atk_1'] as const;

/** Texture key of a look: `player_<w>` for no class, `player_<w>__<classId>` for a class outfit. */
export function lookBase(weapon: WeaponType, classId: string | null | undefined): string {
  return classOutfit(classId) ? `player_${weapon}__${classId}` : `player_${weapon}`;
}

/** Every frame key of a look. */
export function lookFrames(base: string): string[] {
  return LOOK_FRAMES.map((s) => base + s);
}

/** Animation keys of a look (the base player's are in CHAR_ANIMS; class looks are registered lazily). */
export function lookAnims(base: string): { idle: string; walk: string; atk: string } {
  return { idle: `${base}_idle`, walk: `${base}_walk`, atk: `${base}_atk` };
}

// Steel / leather defaults the drawer uses when an outfit leaves a part out.
export const OUTFIT_DEFAULTS = { STEEL, STEEL_DARK, GOLD, LEATHER, LEATHER_DARK } as const;
