// Persisted SkillBook state (v3, SPEC-v4 §13). Every core module reads/writes this shape;
// only src/core/skillbook.ts orchestrates mutations and events. save.migrateBookState turns any older book into it.
import type { ElementId, MaterialId, WeaponType } from './types';

/** Version of the persisted SkillBookState. */
export const BOOK_VERSION = 3;

export interface SkillProgress {
  id: string;
  rank: number;
  /** XP into the current rank (or into the overmastery bar at max rank). */
  xp: number;
  /** Unspent morph charges (cap MASTERY.maxCharges). */
  charges: number;
  uses: number;
  source: string;
  learnedAt: number;
  /** Overmastery bars filled in total (opens the 2nd essence slot at 3). */
  overBars: number;
  /** Kills per species with this skill (first 10 per species get the study bonus). */
  study: Record<string, number>;
}

export interface ClassProgress {
  /** Class Level, 1..CLASS.maxLevel (10). The field keeps its v2 name. */
  rank: number;
  /** XP into the current level (0 at the max level). */
  xp: number;
}

export interface SparkState {
  /** Morph key `${from}>${to}` -> accumulated pity in percentage points. */
  pity: Record<string, number>;
  /** Timestamp (ms, game clock) of the last spark — one spark per SPARK.cooldownMs. */
  lastAt: number;
  /** Seed + counter for the deterministic roll stream. */
  seed: number;
  counter: number;
}

export interface SkillBookState {
  version: 3;
  skills: Record<string, SkillProgress>;
  elements: Partial<Record<ElementId, { source: string; learnedAt: number }>>;
  flags: Record<string, number>;
  /** Fusion pair keys the player has already tried. */
  attempts: string[];
  /** Pair keys that produced something. */
  discoveries: string[];
  /** Hints the player has been shown (fusion whispers, spark whispers). */
  hints: string[];
  /** Essence inventory. */
  essences: Record<string, number>;
  /** Explicitly learned passives (trainer, resonance, bestiary) -> rank. Tag/class/imprint passives are derived. */
  passives: Record<string, number>;
  /** Trainer lesson ids completed. */
  lessons: string[];
  /** Discovered classes and their progress. */
  classes: Record<string, ClassProgress>;
  /** The class currently worn. */
  worn: string | null;
  /** Class ids whose imprint is slotted (max = unlocked slots). */
  imprints: string[];
  /** Echo skill id -> witness marks earned. */
  witness: Record<string, number>;
  spark: SparkState;
  /** Species id -> kills (bestiary). */
  bestiary: Record<string, number>;
  /** Class ids whose riddle has been revealed (codex 'whispered' state). */
  whispered: string[];
  /** Quest progress (docs/QUESTS.md §2). Optional for older saves; migrateBookState fills it. */
  quests?: QuestState;

  // ---- v3 (SPEC-v4 §13). Phase 1 only keeps `shelved`, `weaponLevel` and `pouch.mote` (shelving pay) in use;
  // the rest are the skeleton the Phase 2 systems fill.
  /**
   * Class-only skills (`SkillDef.classOf`) whose class is not discovered yet: out of `skills`, rank kept. They
   * return to `skills` when that class is discovered.
   */
  shelved: Record<string, SkillProgress>;
  /** Weapon upgrade level, 0..5 (Phase 2 sink). */
  weaponLevel: Record<WeaponType, number>;
  /** Material counters (the Pouch). */
  pouch: Record<MaterialId, number>;
  /** Material drop pity: misses in a row by material or `sigil:<species>`. */
  matPity: Record<string, number>;
  /** Skill id -> the Echo id sitting on it. */
  echoOn: Record<string, string>;
  /** Deed id -> tiers reached. */
  deeds: Record<string, number>;
  titles: string[];
  title: string | null;
}

export function emptyPouch(): Record<MaterialId, number> {
  return { fang: 0, mote: 0, core: 0, sap: 0, dust: 0, sigil: 0 };
}

export function emptyWeaponLevels(): Record<WeaponType, number> {
  return { sword: 0, dagger: 0, staff: 0, fists: 0 };
}

export interface QuestState {
  active: Record<string, { progress: number[]; acceptedAt: number }>;
  done: Record<string, number>;
  cooldown: Record<string, number>;
  tracked: string[];
}

export function emptyQuestState(): QuestState {
  return { active: {}, done: {}, cooldown: {}, tracked: [] };
}

export function emptyState(seed = 1): SkillBookState {
  return {
    version: 3,
    skills: {},
    elements: {},
    flags: {},
    attempts: [],
    discoveries: [],
    hints: [],
    essences: {},
    passives: {},
    lessons: [],
    classes: {},
    worn: null,
    imprints: [],
    witness: {},
    spark: { pity: {}, lastAt: -1e12, seed, counter: 0 },
    bestiary: {},
    whispered: [],
    quests: emptyQuestState(),
    shelved: {},
    weaponLevel: emptyWeaponLevels(),
    pouch: emptyPouch(),
    matPity: {},
    echoOn: {},
    deeds: {},
    titles: [],
    title: null,
  };
}
