// Skill-bar loadout (game lane; docs/SPEC-v2.md §5.1, docs/CLIENT-v3.md §6, docs/INTEGRATION-v3.md §2.3).
//
// The bar has HOTBAR_SIZE (8) slots. While a class is worn, slots 0..4 are CLASS slots: the class fills them by itself
// with its best known skills (SkillBook.classSkills). Slots 5..7 are YOUR slots and the class never touches them —
// a class skill you already put in one of your slots stays there, and the class takes its next pick instead. With no
// class, all 8 slots are yours. New skills drop into an empty slot by themselves ("automatic by default").
//
// The invariant every helper keeps: class slots = the class's best skills that are not in your slots. The slot-fill
// rules are pure functions (unit-tested in tests/loadout.test.ts); the small runtime glue below applies them to a
// Session and announces each change on the game bus (`barChanged` with its reason — src/ui/announce.ts words it).
import { CLASS_SLOTS, barEligible } from '../core/classes';
import type { SkillBook } from '../core/skillbook';
import type { Registry } from '../core/registry';
import { gameBus, type BarChangedEvent } from './events';

export type Bar = readonly (string | null)[];

/** Class slots on a bar of `size` while a class is worn (0 with no class). */
export function classSlotsFor(worn: string | null, size: number): number {
  return worn ? Math.min(CLASS_SLOTS, size) : 0;
}

/**
 * A saved bar as exactly `size` slots: non-strings become empty, a skill sits in one slot only (first wins), short
 * bars (v2 saves had 6 slots) are padded with empty slots, and skills beyond `size` move into empty slots while room
 * is left (never silently lost if they fit).
 */
export function padBar(raw: unknown, size: number): (string | null)[] {
  const list = Array.isArray(raw) ? raw : [];
  const out: (string | null)[] = Array<string | null>(size).fill(null);
  const seen = new Set<string>();
  const overflow: string[] = [];
  list.forEach((x, i) => {
    if (typeof x !== 'string' || !x || seen.has(x)) return;
    seen.add(x);
    if (i < size) out[i] = x;
    else overflow.push(x);
  });
  for (const id of overflow) {
    const at = out.indexOf(null);
    if (at < 0) break;
    out[at] = id;
  }
  return out;
}

export interface ClassFill {
  bar: (string | null)[];
  /** Slot indexes whose content changed. */
  changed: number[];
  /** Skills that entered a class slot. */
  added: string[];
  /** Skills that left the bar. */
  dropped: string[];
}

export interface FillOptions {
  /** Class slots at the front of the bar (default CLASS_SLOTS). */
  classSlots?: number;
  /**
   * Keep a pick that already sits in a class slot where it is and fill only the freed slots (refreshes, learning a
   * skill). Off (becoming a class): the picks are laid out best first.
   */
  stable?: boolean;
  /**
   * A skill pushed out of a class slot moves into an empty one of your slots instead of leaving the bar (becoming a
   * class from "no class", where those slots held the player's own picks; converting an old 6-slot save).
   */
  rehome?: boolean;
}

/**
 * Fills the class slots from `picks` (the class's choices, best first — ask for more than the class-slot count so a
 * pick that sits in one of your slots can be replaced by the next one). Your slots are never changed, except that
 * `rehome` drops displaced class-slot skills into empty ones. Fewer picks than class slots leave the rest empty.
 */
export function fillClassSlots(bar: Bar, picks: readonly string[], opts: FillOptions = {}): ClassFill {
  const n = Math.min(opts.classSlots ?? CLASS_SLOTS, bar.length);
  const next = [...bar];
  const own = new Set(bar.slice(n).filter((x): x is string => !!x));
  const chosen: string[] = [];
  for (const id of picks) {
    if (chosen.length >= n) break;
    if (!own.has(id) && !chosen.includes(id)) chosen.push(id);
  }
  const before = bar.slice(0, n);
  if (opts.stable) {
    for (let i = 0; i < n; i++) if (next[i] !== null && !chosen.includes(next[i]!)) next[i] = null;
    for (const id of chosen) {
      if (next.slice(0, n).includes(id)) continue;
      const at = next.indexOf(null);
      if (at >= 0 && at < n) next[at] = id;
    }
  } else {
    for (let i = 0; i < n; i++) next[i] = chosen[i] ?? null;
  }
  const after = next.slice(0, n);
  const displaced = before.filter((x): x is string => !!x && !after.includes(x));
  const dropped: string[] = [];
  for (const id of displaced) {
    const at = opts.rehome ? next.indexOf(null, n) : -1;
    if (at >= n) next[at] = id;
    else dropped.push(id);
  }
  const changed: number[] = [];
  for (let i = 0; i < next.length; i++) if (next[i] !== bar[i]) changed.push(i);
  return { bar: next, changed, added: after.filter((x): x is string => !!x && !before.includes(x)), dropped };
}

/** First empty slot at or after `from` (-1 when full). */
export function firstEmpty(bar: Bar, from = 0): number {
  for (let i = Math.max(0, from); i < bar.length; i++) if (bar[i] === null) return i;
  return -1;
}

export interface LearnPlacement {
  bar: (string | null)[];
  changed: number[];
  /** 'classLearned': the worn class took it into a class slot; 'learned': it dropped into an empty slot of yours. */
  reason: 'classLearned' | 'learned';
  slot: number;
}

/**
 * Where a newly learned skill goes: into the class slots when the worn class would pick it now (an empty class slot,
 * or the place of the weakest class skill it beats), else into the first empty slot of yours. Null when it is
 * already on the bar or there is no room.
 */
export function placeLearned(bar: Bar, skillId: string, picks: readonly string[] | null, classSlots: number): LearnPlacement | null {
  if (bar.includes(skillId)) return null;
  if (picks && classSlots > 0) {
    const fill = fillClassSlots(bar, picks, { classSlots, stable: true });
    const slot = fill.bar.indexOf(skillId);
    if (slot >= 0 && slot < classSlots) return { bar: fill.bar, changed: fill.changed, reason: 'classLearned', slot };
  }
  const at = firstEmpty(bar, classSlots);
  if (at < 0) return null;
  const next = [...bar];
  next[at] = skillId;
  return { bar: next, changed: [at], reason: 'learned', slot: at };
}

// ====================================================================== runtime glue (Session-level, run-wide)

/** What the glue needs: the player's bar and the book (structural, so tests can pass a plain object). */
export interface LoadoutHost {
  readonly reg: Registry;
  readonly book: SkillBook;
  readonly player: { hotbar: (string | null)[] };
}

/** The worn class's picks for the class slots, best first, with spares for picks that sit in your slots. */
export function classPicks(host: LoadoutHost): string[] | null {
  const worn = host.book.state.worn;
  return worn ? host.book.classSkills(worn, host.player.hotbar.length) : null;
}

/** Flag set once a class has been worn (the Class button's "never worn" dot reads it). */
export const wornFlag = (classId: string): string => `worn_class:${classId}`;

/**
 * Remembers that the worn class has been worn (no-op with no class). Written straight into the flags: nothing reads
 * it but the badge, and SkillBook.incFlag would run its load catch-up discovery here.
 */
export function noteWorn(book: SkillBook): void {
  const id = book.state.worn;
  if (id) book.state.flags[wornFlag(id)] = 1;
}

function emit(e: BarChangedEvent): void {
  gameBus.emit('barChanged', e);
}

/** Writes a new bar in place (callers may hold the array). */
function setBar(host: LoadoutHost, next: readonly (string | null)[]): void {
  host.player.hotbar.splice(0, host.player.hotbar.length, ...next);
}

/**
 * Re-fills the class slots of the worn class (become / wear / discovered-and-worn / load / after a player edit).
 * Emits `barChanged` with `reason` when anything moved and returns the changed slots. With no class it does nothing.
 */
export function refillClassSlots(
  host: LoadoutHost,
  reason: NonNullable<BarChangedEvent['reason']>,
  opts: Omit<FillOptions, 'classSlots'> = {},
): number[] {
  const worn = host.book.state.worn;
  const bar = host.player.hotbar;
  if (!worn) return [];
  const fill = fillClassSlots(bar, classPicks(host) ?? [], { ...opts, classSlots: classSlotsFor(worn, bar.length) });
  if (!fill.changed.length) return [];
  setBar(host, fill.bar);
  emit({ slots: fill.changed, reason, classId: worn });
  return fill.changed;
}

/**
 * A skill was just learned: the worn class takes it when it would pick it (`classLearned`), else it drops into an
 * empty slot of yours (`learned`). Weapon basics and monster techniques never go on the bar.
 */
export function slotLearned(host: LoadoutHost, skillId: string): LearnPlacement | null {
  const skill = host.reg.skill(skillId);
  if (!skill || !barEligible(skill) || !host.book.has(skillId)) return null;
  const worn = host.book.state.worn;
  const bar = host.player.hotbar;
  const placed = placeLearned(bar, skillId, classPicks(host), classSlotsFor(worn, bar.length));
  if (!placed) return null;
  setBar(host, placed.bar);
  emit({ slots: placed.changed, reason: placed.reason, skillId, ...(placed.reason === 'classLearned' && worn ? { classId: worn } : {}) });
  return placed;
}
