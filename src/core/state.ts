// Persisted SkillBook state (v2). Every core module reads/writes this shape;
// only src/core/skillbook.ts orchestrates mutations and events.
import type { ElementId } from './types';

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
  rank: number;
  xp: number;
  /** Tree node id -> ranks bought. */
  spent: Record<string, number>;
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
  version: 2;
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
}

export function emptyState(seed = 1): SkillBookState {
  return {
    version: 2,
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
  };
}
