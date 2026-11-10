// Save migration for the SkillBook (docs/SPEC-v4.md §13 "book state v2 → v3"; SPEC-v2 §6 for v1 → v2).
// migrateBookState() turns any stored book — a v1 or v2 save, a v3 save written by an older build, or garbage —
// into a complete, valid v3 SkillBookState. It is total (never throws), deterministic, idempotent and never shares
// objects with its input, so the SkillBook also uses it as its defensive copy. Storage keys and I/O belong to the
// game layer (session save key `omnipath.save.v3`; an older key is never deleted before a v3 write succeeded).
//
// Phase 1 implements §13 rules 1 – 4, 8, 9 (the book's half: clearLostSlots), 15 and 16:
//   1  weaponLevel 0 for all four weapons (owning `fists` is the session's PlayerSave);
//   2  class levels 10 / 8 / 5 → 10, XP scaled between the curves, tree points dropped;
//   3  merged classes fold into their targets once the registry no longer has them;
//   4  discovered classes stay discovered whatever their new requirements;
//   8  class-only skills of undiscovered classes are shelved (rank kept) and pay 3 Motes each;
//   15 tree / imprint / derived passive ids are dropped from the learned list;
//   16 the new v3 fields are filled with empties.
import { CLASS, classXpNeed, classXpToNext, imprintSlots, imprintUnlocked, kitSkillsAt } from './classes';
import { MASTERY, overmasteryCost, xpToNext } from './mastery';
import { QUEST_TRACK_LIMIT, counterNeed, creditLessonQuests } from './quests';
import type { Registry } from './registry';
import { hashSeed } from './rng';
import { SPARK } from './spark';
import {
  emptyPouch,
  emptyState,
  emptyWeaponLevels,
  type ClassProgress,
  type QuestState,
  type SkillBookState,
  type SkillProgress,
  type SparkState,
} from './state';
import { MATERIAL_IDS, WEAPON_TYPES, type ElementId } from './types';

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
  /** `trial_ready:<classId>`: the "Trial ready" card for that class was announced. */
  trialReadyPrefix: 'trial_ready:',
} as const;

/** Rule 2: the v2 max Class Rank of the classes that were Tier II (8) and Tier III (5). Every other class had 10. */
export const LEGACY_CLASS_MAX: Readonly<Record<string, number>> = {
  sword_saint: 8,
  magma_knight: 8,
  phantom: 8,
  archmage: 8,
  prism_sage: 8,
  vortex_dancer: 8,
  runeknight: 8,
  stormreaver: 8,
  echo_sovereign: 8,
  ascendant: 5,
  eclipse_walker: 5,
};

/** v2 Class Rank curve multiplier by that class's old max rank (Tier I ×1, II ×1.8, III ×3). */
const LEGACY_XP_MULT: Readonly<Record<number, number>> = { 10: 1, 8: 1.8, 5: 3 };

/** Rule 3: classes merged into another (source → target). */
export const MERGED_CLASSES: Readonly<Record<string, string>> = {
  phantom: 'shadowstalker',
  vortex_dancer: 'tempest_dancer',
  prism_sage: 'elementalist',
  echo_sovereign: 'mimic',
};

/** Rule 8: Motes paid for each skill that is shelved. */
export const SHELVE_PAY_MOTES = 3;

/** Cap of each Pouch counter. */
export const POUCH_CAP = 9999;

/** Rule 15: learned-passive ids that are never saved any more (tree nodes, imprints, the echo tag passive). */
const DROPPED_PASSIVE = /^(cls_|imprint_)|^tag_echo$/;

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

/** XP progress (0..1, below 1) of each class inside its level, as read from a pre-v3 save (rule 2). */
type ClassFractions = Map<string, number>;

/**
 * Discovered classes. v1 stored ids (`string[]`, each becomes Class Level 1); v2 and v3 store ClassProgress by id.
 * A pre-v3 book (`legacy`) is rescaled by rule 2: `level = max(1, round(old × 10 / oldMax))` with oldMax from
 * LEGACY_CLASS_MAX (10 / 8 / 5), and the share of the old level's bar that was filled is kept in `fractions` so the
 * XP can be set on the new curve. `spent` (tree points) is dropped.
 */
function readClasses(v: unknown, legacy: boolean, fractions: ClassFractions): Record<string, ClassProgress> {
  const out: Record<string, ClassProgress> = {};
  if (Array.isArray(v)) {
    for (const id of strings(v)) if (isSafeKey(id)) out[id] = { rank: 1, xp: 0 };
    return out;
  }
  for (const [id, c] of entries(v)) {
    if (!isRecord(c)) continue;
    const rank = whole(c.rank, 1) ?? 1;
    const xp = Math.max(0, finite(c.xp) ?? 0);
    if (!legacy) {
      out[id] = { rank, xp };
      continue;
    }
    const oldMax = Object.hasOwn(LEGACY_CLASS_MAX, id) ? LEGACY_CLASS_MAX[id] : CLASS.maxLevel;
    const old = Math.min(rank, oldMax);
    const level = Math.min(CLASS.maxLevel, Math.max(1, Math.round((old * CLASS.maxLevel) / oldMax)));
    const oldNeed = Math.round(60 * Math.pow(1.22, old - 1) * (LEGACY_XP_MULT[oldMax] ?? 1));
    const fraction = level >= CLASS.maxLevel ? 0 : Math.min(xp / oldNeed, 1 - 1e-9);
    fractions.set(id, fraction);
    out[id] = { rank: level, xp: Math.floor(fraction * classXpToNext(level)) };
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

/**
 * The worn class. A v2 book stores `worn`, and `worn: null` is an explicit "No class" (SkillBook.unwear): kept, so a
 * reload never puts a class back on (its class slots would overwrite the player's own picks). A v1 book stores
 * `activeClass` instead; v1 could not wear nothing, so a null or missing one there only means "not set yet". Any
 * other book with discovered classes but no valid choice (a missing `worn`, an unknown or undiscovered id) wears the
 * first discovered class.
 */
function readWorn(r: Raw, classes: Readonly<Record<string, ClassProgress>>): string | null {
  const first = Object.keys(classes)[0] ?? null;
  const pick = (id: unknown): string | null => (typeof id === 'string' && Object.hasOwn(classes, id) ? id : first);
  if (typeof r.worn === 'string') return pick(r.worn);
  if (r.worn === null && r.version !== 1) return null;
  return pick(r.activeClass);
}

/** Weapon upgrade levels: 0..5 for each of the four weapons (rule 1: a pre-v3 book has none, so all 0). */
function readWeaponLevels(v: unknown): SkillBookState['weaponLevel'] {
  const out = emptyWeaponLevels();
  const r = isRecord(v) ? v : {};
  for (const w of WEAPON_TYPES) out[w] = Math.min(5, whole(r[w]) ?? 0);
  return out;
}

function readPouch(v: unknown): SkillBookState['pouch'] {
  const out = emptyPouch();
  const r = isRecord(v) ? v : {};
  for (const m of MATERIAL_IDS) out[m] = Math.min(POUCH_CAP, whole(r[m]) ?? 0);
  return out;
}

/** String values by safe key (echoOn). */
function texts(v: unknown): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, x] of entries(v)) if (typeof x === 'string' && x.length > 0) out[k] = x;
  return out;
}

/** Structural read of any object; no registry needed. Pre-v3 class levels are rescaled here (rule 2). */
function readState(r: Raw, fractions: ClassFractions): SkillBookState {
  const skills = readSkills(r.skills);
  const classes = readClasses(r.classes, r.version !== 3, fractions);
  const shelved = readSkills(r.shelved);
  for (const id of Object.keys(shelved)) if (Object.hasOwn(skills, id)) delete shelved[id];
  const titles = strings(r.titles);
  const worn = readWorn(r, classes);
  const flags = numbers(r.flags);
  if (worn !== null) flags[BOOK_FLAGS.classWorn] = Math.max(1, flags[BOOK_FLAGS.classWorn] ?? 0);
  const passives = counts(r.passives);
  for (const id of Object.keys(passives)) if (DROPPED_PASSIVE.test(id)) delete passives[id];
  return {
    version: 3,
    skills,
    elements: readElements(r.elements),
    flags,
    attempts: strings(r.attempts),
    discoveries: strings(r.discoveries),
    hints: strings(r.hints),
    essences: counts(r.essences),
    passives,
    lessons: strings(r.lessons),
    classes,
    worn,
    imprints: strings(r.imprints).filter((id) => id !== worn && Object.hasOwn(classes, id)),
    witness: counts(r.witness),
    spark: readSpark(r.spark, skills),
    bestiary: counts(r.bestiary),
    whispered: strings(r.whispered),
    quests: readQuests(r.quests),
    shelved,
    weaponLevel: readWeaponLevels(r.weaponLevel),
    pouch: readPouch(r.pouch),
    matPity: counts(r.matPity),
    echoOn: texts(r.echoOn),
    deeds: counts(r.deeds),
    titles,
    title: typeof r.title === 'string' && titles.includes(r.title) ? r.title : null,
  };
}

/**
 * Rule 3: folds each merged class (MERGED_CLASSES) that the player discovered into its target. The target takes
 * the higher level of the two, +1 (max 10) if both were discovered, and the higher one's XP (0 after a +1);
 * `worn`, whispers and slotted imprints follow the target. With a registry, a class is merged only once the
 * registry no longer has it (and has its target), so the rule waits for the content that removes the class and then
 * applies to any save, v3 included; without a registry it applies to pre-v3 books by the table alone.
 */
function mergeClasses(state: SkillBookState, legacy: boolean, reg: Registry | undefined, fractions: ClassFractions): void {
  for (const [from, to] of Object.entries(MERGED_CLASSES)) {
    const gone = reg ? reg.classDef(from) === undefined && reg.classDef(to) !== undefined : legacy;
    const follow = (ids: readonly string[]): string[] => [...new Set(ids.map((id) => (id === from ? to : id)))];
    if (!gone) continue;
    state.whispered = follow(state.whispered);
    const source = Object.hasOwn(state.classes, from) ? state.classes[from] : undefined;
    if (!source) continue;
    const target = Object.hasOwn(state.classes, to) ? state.classes[to] : undefined;
    delete state.classes[from];
    const sourceFraction = fractions.get(from);
    fractions.delete(from);
    const carry = (fraction: number | undefined): void => {
      if (fraction === undefined) fractions.delete(to);
      else fractions.set(to, fraction);
    };
    if (!target) {
      state.classes[to] = source;
      carry(sourceFraction);
    } else {
      const sourceWins = source.rank > target.rank || (source.rank === target.rank && source.xp > target.xp);
      const higher = sourceWins ? source : target;
      const rank = Math.min(CLASS.maxLevel, higher.rank + 1);
      // Both were discovered: one level up, starting that level from 0.
      state.classes[to] = { rank, xp: rank > higher.rank ? 0 : higher.xp };
      if (rank > higher.rank) carry(0);
      else if (sourceWins) carry(sourceFraction);
    }
    if (state.worn === from) state.worn = to;
    state.imprints = follow(state.imprints).filter((id) => id !== state.worn);
  }
}

/**
 * Rules 8 and 9, class skills (needs the registry; safe to run on every load):
 * - a shelved skill comes back when its class is discovered, or when it is no longer a class skill;
 * - a known skill with `classOf` whose class the registry knows and the player has not discovered moves to
 *   `shelved` (rank kept) and pays SHELVE_PAY_MOTES Motes into the Pouch;
 * - every discovered class with a kit knows the kit skills its Class Level has unlocked (rank 1, source
 *   `class:<id>`), so its class slots can be rebuilt from the kit.
 */
function settleClassSkills(state: SkillBookState, reg: Registry): void {
  const discovered = (classId: string): boolean => Object.hasOwn(state.classes, classId);
  for (const [id, p] of Object.entries(state.shelved)) {
    const def = reg.skill(id);
    if (!def) continue;
    if (def.classOf !== undefined && !discovered(def.classOf)) continue;
    delete state.shelved[id];
    if (!Object.hasOwn(state.skills, id)) state.skills[id] = p;
  }
  for (const [id, p] of Object.entries(state.skills)) {
    const classOf = reg.skill(id)?.classOf;
    if (classOf === undefined || discovered(classOf) || !reg.classDef(classOf)) continue;
    delete state.skills[id];
    state.shelved[id] = p;
    state.pouch.mote = Math.min(POUCH_CAP, state.pouch.mote + SHELVE_PAY_MOTES);
  }
  for (const [classId, progress] of Object.entries(state.classes)) {
    const cls = reg.classDef(classId);
    if (!cls) continue;
    for (const id of kitSkillsAt(cls, progress.rank)) {
      if (Object.hasOwn(state.skills, id) || !reg.skill(id)) continue;
      state.skills[id] = { id, rank: 1, xp: 0, charges: 0, uses: 0, source: `class:${classId}`, learnedAt: 0, overBars: 0, study: {} };
    }
  }
}

/**
 * Rule 9, the book's half: a skill bar with every slot cleared whose skill the book no longer knows (removed or
 * shelved by the migration). The game then rebuilds the class slots from the worn class's kit and refills "your"
 * slots with its auto-equip rule. Weapon-bound skills for another weapon stay (the bar greys them).
 */
export function clearLostSlots(state: Pick<SkillBookState, 'skills'>, bar: readonly (string | null)[]): (string | null)[] {
  return bar.map((id) => (id !== null && Object.hasOwn(state.skills, id) ? id : null));
}

/** XP kept strictly inside a bar of `size` (a migrated skill never ranks up from stale XP alone). */
const insideBar = (xp: number, size: number): number => (xp < size ? xp : Math.max(0, size - 1));

/**
 * Registry-aware clamps: class skills shelved, returned and granted (settleClassSkills), derived passives dropped
 * from the learned list, skill ranks to their maxRank and XP to the v2 curve (into the current rank's
 * bar, or at most one full overmastery bar at max rank, which may hold full), class levels to
 * CLASS.maxLevel and XP to the class's curve (0 at max), unknown elements dropped, imprints limited to
 * discovered, unlocked classes within the unlocked slots, and `mastered_any` set when a skill is maxed.
 * Quests: counters fit the current objectives, a completed non-repeatable quest loses a stale active
 * entry, tracked ids must be known quests, and quests teaching lessons already in `state.lessons` count
 * as completed (quests.creditLessonQuests). Ids the registry does not know are kept untouched (content
 * may come back).
 */
function settle(state: SkillBookState, reg: Registry, fractions: ClassFractions): void {
  settleClassSkills(state, reg);
  for (const id of Object.keys(state.passives)) {
    const source = reg.passive(id)?.source;
    if (source === 'tag' || source === 'class' || source === 'imprint' || source === 'keepsake') delete state.passives[id];
  }
  for (const p of [...Object.values(state.skills), ...Object.values(state.shelved)]) {
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
    const max = CLASS.maxLevel;
    c.rank = Math.min(c.rank, max);
    const need = classXpNeed(cls, c.rank);
    // A rescaled pre-v3 level keeps the share of its bar that was filled, on this class's own curve.
    const fraction = fractions.get(id);
    if (fraction !== undefined) c.xp = Math.floor(fraction * need);
    c.xp = c.rank >= max ? 0 : insideBar(c.xp, need);
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
 * Normalizes any stored SkillBook state into a complete v3 SkillBookState (never throws):
 * - v1 (`version: 1`): `classes: string[]` → Class Level 1 each, `activeClass` → `worn`, skills gain
 *   `overBars: 0` and `study: {}`, and every later field is added.
 * - v2 → v3 (SPEC-v4 §13, the rules listed at the top of this file): class levels rescaled to the one max of 10,
 *   tree points dropped, merged classes folded, class-only skills shelved for 3 Motes each, stale passive ids
 *   dropped, new fields filled with empties.
 * - v3: any missing or malformed field is filled with its emptyState() default; malformed entries (non-numeric
 *   ranks, negative counts, non-string ids) are repaired or dropped.
 * - Worn class (readWorn): the saved one when it is discovered; an explicit `worn: null` stays "No class";
 *   otherwise (v1 without an active class, a missing or unknown id) the first discovered class. `class_worn` is
 *   set while a class is worn, charges are capped at MASTERY.maxCharges, and the copy shares no objects with `raw`.
 * - With `reg`: the registry-aware rules run (see settle above; merges wait for the registry to drop the merged
 *   class). The SkillBook constructor always passes its registry, so callers may omit it.
 * Idempotent: migrating a migrated state changes nothing. Anything that is not an object (or throws while being
 * read) yields emptyState().
 */
export function migrateBookState(raw: unknown, reg?: Registry): SkillBookState {
  try {
    if (!isRecord(raw)) return emptyState();
    const fractions: ClassFractions = new Map();
    const state = readState(raw, fractions);
    mergeClasses(state, raw.version !== 3, reg, fractions);
    if (reg) settle(state, reg, fractions);
    return state;
  } catch {
    return emptyState();
  }
}
