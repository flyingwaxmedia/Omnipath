// Skill-bar loadout (game lane; docs/SPEC-v2.md §5.1, docs/CLIENT-v3.md §6, docs/INTEGRATION-v3.md §2.3).
//
// The bar has HOTBAR_SIZE (8) slots. While a class is worn, slots 0..4 are CLASS slots: the class fills them by itself
// with its most relevant known skills (SkillBook.classSkills: pattern matches first, then related skills). Slots 5..7
// are YOUR slots. With no class, all 8 slots are yours. New skills drop into an empty slot by themselves ("automatic
// by default").
//
// BECOMING a class (SPEC-v2 §5.1): a class pick that sits in one of your slots moves into the class slots and frees
// your slot (no duplicates, nothing lost); your other picks stay where they are. Every other refresh (a player edit,
// loading) leaves your slots alone: a class skill you put there yourself stays, and the class takes its next pick.
// LEARNING a skill the class relates to fills an empty class slot, or replaces the weakest class skill only when it is
// clearly better (a closer fit, or a higher tier) — the "Pyroblade equipped Flame Spin" toast.
//
// The slot-fill rules are pure functions (unit-tested in tests/loadout.test.ts); the small runtime glue below applies
// them to a Session and announces each change on the game bus (`barChanged` with its reason — src/ui/announce.ts).
import { CLASS_SLOTS, barEligible, classSkillFit } from '../core/classes';
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
  /** Skills that moved from one of your slots into a class slot (becoming a class), freeing that slot. */
  pulled: string[];
  /** Skills that left the bar. */
  dropped: string[];
}

export interface FillOptions {
  /** Class slots at the front of the bar (default CLASS_SLOTS). */
  classSlots?: number;
  /**
   * A refresh (a player edit, loading): a pick that already sits in a class slot keeps its place, only the freed
   * slots are filled, and your slots are never touched (a class pick you put there stays and the class takes its
   * next pick). Off = BECOMING a class: the picks are laid out best first, and a pick that sits in one of your slots
   * moves into the class slots, freeing that slot (SPEC-v2 §5.1).
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
 * pick that sits in one of your slots can be replaced by the next one on a refresh). Becoming a class (not `stable`)
 * pulls the first picks out of your slots; a refresh never changes your slots. `rehome` drops displaced class-slot
 * skills into empty slots of yours. Fewer picks than class slots leave the rest empty.
 */
export function fillClassSlots(bar: Bar, picks: readonly string[], opts: FillOptions = {}): ClassFill {
  const n = Math.min(opts.classSlots ?? CLASS_SLOTS, bar.length);
  const next = [...bar];
  const own = new Set(bar.slice(n).filter((x): x is string => !!x));
  const chosen: string[] = [];
  for (const id of picks) {
    if (chosen.length >= n) break;
    if (opts.stable && own.has(id)) continue; // a refresh leaves your slots alone
    if (!chosen.includes(id)) chosen.push(id);
  }
  const before = bar.slice(0, n);
  const pulled: string[] = [];
  if (opts.stable) {
    for (let i = 0; i < n; i++) if (next[i] !== null && !chosen.includes(next[i]!)) next[i] = null;
    for (const id of chosen) {
      if (next.slice(0, n).includes(id)) continue;
      const at = next.indexOf(null);
      if (at >= 0 && at < n) next[at] = id;
    }
  } else {
    for (let i = 0; i < n; i++) next[i] = chosen[i] ?? null;
    // A pick that sat in one of your slots moved into the class slots: that slot is free now.
    for (let i = n; i < next.length; i++) {
      if (next[i] !== null && chosen.includes(next[i]!)) {
        pulled.push(next[i]!);
        next[i] = null;
      }
    }
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
  return { bar: next, changed, added: after.filter((x): x is string => !!x && !before.includes(x)), pulled, dropped };
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

/** Whether skill `a` is clearly better than skill `b` for the worn class (a closer fit, or a higher tier). */
export type Beats = (a: string, b: string) => boolean;

/**
 * Where a newly learned skill goes. A skill the worn class picks (`picks`, best first) takes an empty class slot, or
 * replaces the weakest class skill (the one latest in `picks`; one the class no longer picks counts as weakest) only
 * when it is clearly better (`beats`; without it, when the class ranks it above that skill). Anything else drops
 * into the first empty slot of yours. Null when it is already on the bar or there is no room.
 */
export function placeLearned(
  bar: Bar,
  skillId: string,
  picks: readonly string[] | null,
  classSlots: number,
  beats?: Beats,
): LearnPlacement | null {
  if (bar.includes(skillId)) return null;
  const n = Math.min(classSlots, bar.length);
  if (picks && n > 0 && picks.includes(skillId)) {
    let slot = bar.slice(0, n).indexOf(null);
    if (slot < 0) {
      let worst = -1;
      for (let i = 0; i < n; i++) {
        const at = picks.indexOf(bar[i]!);
        const pos = at < 0 ? Infinity : at;
        if (pos > worst) {
          worst = pos;
          slot = i;
        }
      }
      const better = beats ? beats(skillId, bar[slot]!) : picks.indexOf(skillId) < worst;
      if (!better) slot = -1;
    }
    if (slot >= 0) {
      const next = [...bar];
      next[slot] = skillId;
      return { bar: next, changed: [slot], reason: 'classLearned', slot };
    }
  }
  const at = firstEmpty(bar, n);
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
 * "Clearly better" for the worn class: a pattern match beats a merely related skill, a related skill beats an
 * unrelated one, and at the same fit a higher tier wins. Null with no class.
 */
export function classBeats(host: LoadoutHost): Beats | null {
  const worn = host.book.state.worn;
  const cls = worn ? host.reg.classDef(worn) : undefined;
  if (!cls) return null;
  const fit = (id: string) => {
    const skill = host.reg.skill(id);
    const f = skill ? classSkillFit(host.reg, cls, skill) : null;
    return f === 'match' ? 2 : f === 'related' ? 1 : 0;
  };
  const tier = (id: string) => host.reg.skill(id)?.tier ?? 0;
  return (a, b) => fit(a) > fit(b) || (fit(a) === fit(b) && tier(a) > tier(b));
}

/**
 * A skill was just learned: the worn class takes it when it relates to it and there is an empty class slot or it is
 * clearly better than the weakest class skill (`classLearned`), else it drops into an empty slot of yours
 * (`learned`). Weapon basics and monster techniques never go on the bar.
 */
export function slotLearned(host: LoadoutHost, skillId: string): LearnPlacement | null {
  const skill = host.reg.skill(skillId);
  if (!skill || !barEligible(skill) || !host.book.has(skillId)) return null;
  const worn = host.book.state.worn;
  const bar = host.player.hotbar;
  const placed = placeLearned(bar, skillId, classPicks(host), classSlotsFor(worn, bar.length), classBeats(host) ?? undefined);
  if (!placed) return null;
  setBar(host, placed.bar);
  emit({ slots: placed.changed, reason: placed.reason, skillId, ...(placed.reason === 'classLearned' && worn ? { classId: worn } : {}) });
  return placed;
}
