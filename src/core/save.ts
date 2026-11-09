// Save migration for the SkillBook (docs/SPEC-v2.md §6 "Save v2"). migrateBookState() turns any
// stored book — a v1 save, a v2 save written by an older build, or garbage — into a complete, valid
// v2 SkillBookState. It is total (never throws) and never shares objects with its input, so the
// SkillBook also uses it as its defensive copy. Storage keys and I/O belong to the game layer.
import { classMaxRank, classXpToNext, imprintSlots, imprintUnlocked } from './classes';
import { MASTERY, overmasteryCost, xpToNext } from './mastery';
import { QUEST_TRACK_LIMIT, counterNeed, creditLessonQuests } from './quests';
import type { Registry } from './registry';
import { hashSeed } from './rng';
import { SPARK } from './spark';
import {
  emptyState,
  type ClassProgress,
  type QuestState,
  type SkillBookState,
  type SkillProgress,
  type SparkState,
} from './state';
import type { ElementId } from './types';

/**
 * Flag keys the SkillBook itself maintains in `state.flags` (content requirements read the first two;
 * the rest are internal bookkeeping for deterministic essence drops).
 */
export const BOOK_FLAGS = {
  /** Set to 1 the first time any class is worn (the first discovered class is worn automatically). */
  classWorn: 'class_worn',
  /** Set to 1 the first time any skill reaches its max rank. */
  masteredAny: 'mastered_any',
  /** `essdrop:<species>`: essences that species has dropped (the 25th-kill guarantee reads it). */
  essenceDropPrefix: 'essdrop:',
  /** Counter of the essence-drop roll stream (seeded from `state.spark.seed`). */
  essenceRolls: 'rng:essence',
} as const;

type Raw = Record<string, unknown>;

const isRecord = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Keys that would hit Object.prototype setters when copied onto a plain object. */
const isSafeKey = (k: string): boolean => k.length > 0 && k !== '__proto__';

const finite = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

/** A whole number ≥ `min`, or undefined when `v` is not a finite number. */
const whole = (v: unknown, min = 0): number | undefined => {
  const n = finite(v);
  return n === undefined ? undefined : Math.max(min, Math.floor(n));
};

const text = (v: unknown, fallback: string): string => (typeof v === 'string' ? v : fallback);

/** Distinct strings of an array (anything else → []). */
function strings(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return [...new Set(v.filter((x): x is string => typeof x === 'string'))];
}

/** Own entries of a record with safe keys. */
function entries(v: unknown): [string, unknown][] {
  return isRecord(v) ? Object.entries(v).filter(([k]) => isSafeKey(k)) : [];
}

/** Finite numbers by key (flags). */
function numbers(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of entries(v)) {
    const n = finite(x);
    if (n !== undefined) out[k] = n;
  }
  return out;
}

/** Positive whole counts by key; zero and invalid entries are dropped (absent means 0). */
function counts(v: unknown): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [k, x] of entries(v)) {
    const n = whole(x);
    if (n !== undefined && n > 0) out[k] = n;
  }
  return out;
}

function readSkills(v: unknown): Record<string, SkillProgress> {
  const out: Record<string, SkillProgress> = {};
  for (const [id, p] of entries(v)) {
    if (!isRecord(p)) continue;
    out[id] = {
      id,
      rank: whole(p.rank, 1) ?? 1,
      xp: Math.max(0, finite(p.xp) ?? 0),
      charges: Math.min(MASTERY.maxCharges, whole(p.charges) ?? 0),
      uses: whole(p.uses) ?? 0,
      source: text(p.source, 'unknown'),
      learnedAt: finite(p.learnedAt) ?? 0,
      overBars: whole(p.overBars) ?? 0,
      study: counts(p.study),
    };
  }
  return out;
}

function readElements(v: unknown): SkillBookState['elements'] {
  const out: SkillBookState['elements'] = {};
  for (const [id, e] of entries(v)) {
    if (!isRecord(e)) continue;
    out[id as ElementId] = { source: text(e.source, 'unknown'), learnedAt: finite(e.learnedAt) ?? 0 };
  }
  return out;
}

/** v1 stored discovered class ids (`string[]`, each becomes CR 1); v2 stores ClassProgress by id. */
function readClasses(v: unknown): Record<string, ClassProgress> {
  const out: Record<string, ClassProgress> = {};
  if (Array.isArray(v)) {
    for (const id of strings(v)) if (isSafeKey(id)) out[id] = { rank: 1, xp: 0, spent: {} };
    return out;
  }
  for (const [id, c] of entries(v)) {
    if (!isRecord(c)) continue;
    out[id] = { rank: whole(c.rank, 1) ?? 1, xp: Math.max(0, finite(c.xp) ?? 0), spent: counts(c.spent) };
  }
  return out;
}

/**
 * Spark state; a save without one (v1) gets a seed derived from its skills' learn timestamps so
 * migrated players do not all share one roll stream (emptyState's seed when there are none).
 */
function readSpark(v: unknown, skills: Readonly<Record<string, SkillProgress>>): SparkState {
  const fresh = emptyState().spark;
  const s = isRecord(v) ? v : {};
  const pity: Record<string, number> = {};
  for (const [k, x] of Object.entries(numbers(s.pity))) if (x > 0) pity[k] = Math.min(SPARK.pityCap, x);
  const seed = finite(s.seed);
  const stamps = Object.values(skills).map((p) => p.learnedAt);
  return {
    pity,
    lastAt: finite(s.lastAt) ?? fresh.lastAt,
    seed: seed !== undefined ? seed >>> 0 : stamps.length > 0 ? hashSeed('omnipath.book', ...stamps) : fresh.seed,
    counter: whole(s.counter) ?? 0,
  };
}

/**
 * Quest state (docs/QUESTS.md §2); a save without one gets emptyQuestState(). Active entries keep whole,
 * non-negative counters; tracked ids must be active (newest first, at most QUEST_TRACK_LIMIT).
 */
function readQuests(v: unknown): QuestState {
  const q = isRecord(v) ? v : {};
  const active: QuestState['active'] = {};
  for (const [id, a] of entries(q.active)) {
    if (!isRecord(a)) continue;
    const progress = Array.isArray(a.progress) ? a.progress.map((x) => whole(x) ?? 0) : [];
    active[id] = { progress, acceptedAt: finite(a.acceptedAt) ?? 0 };
  }
  const cooldown = numbers(q.cooldown);
  const tracked = strings(q.tracked)
    .filter((id) => Object.hasOwn(active, id))
    .slice(0, QUEST_TRACK_LIMIT);
  return { active, done: counts(q.done), cooldown, tracked };
}

/** Structural read of any object; no registry needed. */
function readState(r: Raw): SkillBookState {
  const skills = readSkills(r.skills);
  const classes = readClasses(r.classes);
  const wantWorn = typeof r.worn === 'string' ? r.worn : typeof r.activeClass === 'string' ? r.activeClass : null;
  // v2 never un-wears: a book with discovered classes always wears one (the first, if none is set).
  const worn =
    wantWorn !== null && Object.hasOwn(classes, wantWorn) ? wantWorn : (Object.keys(classes)[0] ?? null);
  const flags = numbers(r.flags);
  if (worn !== null) flags[BOOK_FLAGS.classWorn] = Math.max(1, flags[BOOK_FLAGS.classWorn] ?? 0);
  return {
    version: 2,
    skills,
    elements: readElements(r.elements),
    flags,
    attempts: strings(r.attempts),
    discoveries: strings(r.discoveries),
    hints: strings(r.hints),
    essences: counts(r.essences),
    passives: counts(r.passives),
    lessons: strings(r.lessons),
    classes,
    worn,
    imprints: strings(r.imprints).filter((id) => id !== worn && Object.hasOwn(classes, id)),
    witness: counts(r.witness),
    spark: readSpark(r.spark, skills),
    bestiary: counts(r.bestiary),
    whispered: strings(r.whispered),
    quests: readQuests(r.quests),
  };
}

/** XP kept strictly inside a bar of `size` (a migrated skill never ranks up from stale XP alone). */
const insideBar = (xp: number, size: number): number => (xp < size ? xp : Math.max(0, size - 1));

/**
 * Registry-aware clamps: skill ranks to their maxRank and XP to the v2 curve (into the current rank's
 * bar, or at most one full overmastery bar at max rank, which may hold full), class ranks to their
 * tier cap and XP to the Class Rank curve (0 at max), unknown elements dropped, imprints limited to
 * discovered, unlocked classes within the unlocked slots, and `mastered_any` set when a skill is maxed.
 * Quests: counters fit the current objectives, a completed non-repeatable quest loses a stale active
 * entry, tracked ids must be known quests, and quests teaching lessons already in `state.lessons` count
 * as completed (quests.creditLessonQuests). Ids the registry does not know are kept untouched (content
 * may come back).
 */
function settle(state: SkillBookState, reg: Registry): void {
  for (const p of Object.values(state.skills)) {
    const def = reg.skill(p.id);
    if (!def) continue;
    p.rank = Math.min(p.rank, def.maxRank);
    if (p.rank < def.maxRank) {
      p.xp = insideBar(p.xp, xpToNext(p.rank, def.tier));
    } else {
      p.xp = Math.min(p.xp, overmasteryCost(def.maxRank, def.tier));
      state.flags[BOOK_FLAGS.masteredAny] = Math.max(1, state.flags[BOOK_FLAGS.masteredAny] ?? 0);
    }
  }
  for (const id of Object.keys(state.elements) as ElementId[]) {
    if (!reg.element(id)) delete state.elements[id];
  }
  for (const [id, c] of Object.entries(state.classes)) {
    const cls = reg.classDef(id);
    if (!cls) continue;
    const max = classMaxRank(cls);
    c.rank = Math.min(c.rank, max);
    c.xp = c.rank >= max ? 0 : insideBar(c.xp, classXpToNext(c.rank, cls.tier));
  }
  state.imprints = state.imprints
    .filter((id) => {
      const cls = reg.classDef(id);
      return cls !== undefined && imprintUnlocked(cls, state.classes[id]);
    })
    .slice(0, imprintSlots(reg, state));
  // Quest counters follow the current objectives: one per objective, capped at its need (live
  // objectives — deliver, state — keep 0). A non-repeatable quest already completed cannot be active
  // again (it would pay twice).
  const quests = state.quests;
  if (quests) {
    for (const [id, entry] of Object.entries(quests.active)) {
      const quest = reg.quest(id);
      if (!quest) continue;
      if (!quest.repeatable && (quests.done[id] ?? 0) >= 1) {
        delete quests.active[id];
        continue;
      }
      entry.progress = quest.objectives.map((o, i) => Math.min(counterNeed(o), entry.progress[i] ?? 0));
    }
    // Tracker slots only for quests the content knows (an unknown active entry is kept, untracked, in
    // case the content comes back).
    quests.tracked = quests.tracked.filter((id) => Object.hasOwn(quests.active, id) && reg.quest(id) !== undefined);
    // Lessons taken before quests taught them credit the quest that now teaches each one.
    creditLessonQuests(reg, state, state.lessons);
  }
}

/**
 * Normalizes any stored SkillBook state into a complete v2 SkillBookState (never throws):
 * - v1 (`version: 1`): `classes: string[]` → `{ rank: 1, xp: 0, spent: {} }` each, `activeClass` →
 *   `worn`, skills gain `overBars: 0` and `study: {}`, and every v2-only field is added.
 * - v2: any missing or malformed field is filled with its emptyState() default (a save from before
 *   quests gets emptyQuestState()); malformed entries (non-numeric ranks, negative counts, non-string
 *   ids) are repaired or dropped.
 * - Both: a book with discovered classes always wears one (the saved one when valid, else the
 *   first), `class_worn` is set while a class is worn, charges are capped at MASTERY.maxCharges, and
 *   the copy shares no objects with `raw`.
 * - With `reg`: ranks and XP are clamped to the v2 curves and quest counters to their objectives (see
 *   settle above). The SkillBook
 *   constructor always passes its registry, so callers may omit it.
 * Anything that is not an object (or throws while being read) yields emptyState().
 */
export function migrateBookState(raw: unknown, reg?: Registry): SkillBookState {
  try {
    if (!isRecord(raw)) return emptyState();
    const state = readState(raw);
    if (reg) settle(state, reg);
    return state;
  } catch {
    return emptyState();
  }
}
