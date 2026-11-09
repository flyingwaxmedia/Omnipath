// Skill-bar loadout (game lane; docs/SPEC-v2.md §5.1, docs/CLIENT-v3.md §6, docs/INTEGRATION-v3.md §2.3).
//
// The bar has HOTBAR_SIZE (8) slots. While a class is worn, slots 0..4 are CLASS slots: the class fills them by itself
// with its most relevant known skills (SkillBook.classSkills: pattern matches first, then related skills). Slots 5..7
// are YOUR slots. With no class, all 8 slots are yours. New skills drop into an empty slot by themselves ("automatic
// by default").
//
// BECOMING a class (SPEC-v2 §5.1): a class pick that sits in one of your slots moves into the class slots and frees
// your slot (no duplicates); the skills the new class pushes out of the class slots move into your empty slots, and
// any of your slots still empty takes your most recently used skills that are not on the bar (nothing lost while
// there is room, no empty slot while unused skills are known). Every other refresh (a player edit, loading) only
// fills EMPTY class slots: a filled class slot keeps its skill while the class still relates to it, and your slots
// are never touched (a class skill you put there yourself stays, and the class takes its next pick).
// LEARNING a skill the class relates to fills an empty class slot, or replaces the weakest class skill only when it is
// clearly better (a closer fit, or a higher tier) — the "Pyroblade equipped Flame Spin" toast; the skill it replaces
// moves into an empty slot of yours when there is one. A skill an active quest asks you to use is picked first and
// never swapped out.
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
   * A refresh (a player edit, loading): every class-slot skill the class still picks keeps its slot (wherever it
   * ranks), only EMPTY class slots (or ones holding a skill the class no longer relates to) take the best picks that
   * are not on the bar yet, and your slots are never touched (a class pick you put there stays and the class takes
   * its next pick). A refresh never replaces a filled class slot. Off = BECOMING a class: the picks are laid out best
   * first, and a pick that sits in one of your slots moves into the class slots, freeing that slot (SPEC-v2 §5.1).
   */
  stable?: boolean;
  /**
   * A skill pushed out of a class slot moves into an empty one of your slots instead of leaving the bar (becoming a
   * class; converting an old 6-slot save).
   */
  rehome?: boolean;
  /** Skills an active quest asks the player to use: they win a class slot ahead of the class's other picks. */
  prefer?: ReadonlySet<string>;
}

/**
 * `list` (best first) reordered so that the skills in `prefer` it holds are among its first `n` (at most `n` of
 * them), keeping best-first order otherwise.
 */
export function preferFirst(list: readonly string[], n: number, prefer?: ReadonlySet<string>): string[] {
  if (!prefer?.size) return [...list];
  const want = new Set(list.filter((id) => prefer.has(id)).slice(0, n));
  const rest = list.filter((id) => !want.has(id));
  const top = new Set([...want, ...rest.slice(0, Math.max(0, n - want.size))]);
  return [...list.filter((id) => top.has(id)), ...list.filter((id) => !top.has(id))];
}

/**
 * Fills the class slots from `picks` (the class's choices, best first — pass every skill the class relates to, so
 * a pick that sits in one of your slots can be replaced by the next one and a filled class slot is recognised
 * wherever it ranks). Becoming a class (not `stable`) pulls the first picks out of your slots; a refresh only fills
 * empty class slots and never changes your slots. `rehome` drops displaced class-slot skills into empty slots of
 * yours. Fewer picks than class slots leave the rest empty.
 */
export function fillClassSlots(bar: Bar, picks: readonly string[], opts: FillOptions = {}): ClassFill {
  const n = Math.min(opts.classSlots ?? CLASS_SLOTS, bar.length);
  const next = [...bar];
  const unique = [...new Set(picks)];
  const before = bar.slice(0, n);
  const pulled: string[] = [];
  if (opts.stable) {
    // Keep every filled class slot the class still relates to; clear only skills it no longer picks at all.
    const picked = new Set(unique);
    for (let i = 0; i < n; i++) if (next[i] !== null && !picked.has(next[i]!)) next[i] = null;
    // Empty class slots take the best picks that are not on the bar anywhere (your slots are left alone).
    const onBar = new Set(next.filter((x): x is string => !!x));
    const empty = next.slice(0, n).filter((x) => x === null).length;
    const fresh = preferFirst(
      unique.filter((id) => !onBar.has(id)),
      empty,
      opts.prefer,
    );
    let k = 0;
    for (let i = 0; i < n && k < fresh.length; i++) if (next[i] === null) next[i] = fresh[k++];
  } else {
    const chosen = preferFirst(unique, n, opts.prefer).slice(0, n);
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
  return { bar: next, changed: diffSlots(bar, next), added: after.filter((x): x is string => !!x && !before.includes(x)), pulled, dropped };
}

/** Slot indexes whose content differs between two bars of the same length. */
function diffSlots(a: Bar, b: Bar): number[] {
  const changed: number[] = [];
  for (let i = 0; i < b.length; i++) if (b[i] !== a[i]) changed.push(i);
  return changed;
}

/**
 * Your empty slots (from `from` on) take `spares` in order (best first), skipping skills already on the bar — after
 * becoming a class, so no slot of yours stays empty while known skills sit unused.
 */
export function backfillOwn(bar: Bar, from: number, spares: readonly string[]): (string | null)[] {
  const next = [...bar];
  const on = new Set(next.filter((x): x is string => !!x));
  const queue = [...new Set(spares)].filter((id) => !on.has(id));
  let k = 0;
  for (let i = Math.max(0, from); i < next.length && k < queue.length; i++) if (next[i] === null) next[i] = queue[k++];
  return next;
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
 * replaces the weakest class skill (the one latest in `picks`; one the class no longer picks counts as weakest; a
 * skill in `keep` — one an active quest asks for — is never replaced) only when it is clearly better (`beats`;
 * without it, when the class ranks it above that skill). The replaced skill moves into the first empty slot of
 * yours when there is one. Anything else drops into the first empty slot of yours. Null when it is already on the
 * bar or there is no room. The result is stable: a refresh (fillClassSlots `stable`) right after leaves it as it is.
 */
export function placeLearned(
  bar: Bar,
  skillId: string,
  picks: readonly string[] | null,
  classSlots: number,
  beats?: Beats,
  keep?: ReadonlySet<string>,
): LearnPlacement | null {
  if (bar.includes(skillId)) return null;
  const n = Math.min(classSlots, bar.length);
  if (picks && n > 0 && picks.includes(skillId)) {
    let slot = bar.slice(0, n).indexOf(null);
    if (slot < 0) {
      let worst = -1;
      for (let i = 0; i < n; i++) {
        if (keep?.has(bar[i]!)) continue;
        const at = picks.indexOf(bar[i]!);
        const pos = at < 0 ? Infinity : at;
        if (pos > worst) {
          worst = pos;
          slot = i;
        }
      }
      const better = slot >= 0 && (beats ? beats(skillId, bar[slot]!) : picks.indexOf(skillId) < worst);
      if (!better) slot = -1;
    }
    if (slot >= 0) {
      const next = [...bar];
      const out = next[slot];
      next[slot] = skillId;
      const changed = [slot];
      const home = out ? firstEmpty(next, n) : -1;
      if (home >= 0) {
        next[home] = out;
        changed.push(home);
      }
      return { bar: next, changed, reason: 'classLearned', slot };
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

/**
 * The worn class's picks for the class slots, best first: every known skill it relates to (SkillBook.classSkills),
 * so a pick that sits in one of your slots has spares behind it and a class-slot skill counts wherever it ranks.
 */
export function classPicks(host: LoadoutHost): string[] | null {
  const worn = host.book.state.worn;
  return worn ? host.book.classSkills(worn, Infinity) : null;
}

/** Skills an active quest asks the player to use (a `use` objective that names the skill and is not met yet). */
export function questSkills(host: LoadoutHost): Set<string> {
  const out = new Set<string>();
  for (const [id, active] of Object.entries(host.book.state.quests?.active ?? {})) {
    host.reg.quest(id)?.objectives.forEach((o, i) => {
      if (o.kind === 'use' && o.skill && (active.progress[i] ?? 0) < o.count) out.add(o.skill);
    });
  }
  return out;
}

/** Run-wide cast order of the player's skills (castFire), for "most recently used". Not saved. */
const castOrder = new Map<string, number>();
let castSeq = 0;
gameBus.on('castFire', ({ skillId }) => void castOrder.set(skillId, ++castSeq));

/**
 * Known skills that may go on the bar but are not on `bar`: most recently used first (this run), then most used,
 * highest rank, newest.
 */
export function spareSkills(host: LoadoutHost, bar: Bar = host.player.hotbar): string[] {
  const on = new Set(bar.filter((x): x is string => !!x));
  return Object.values(host.book.state.skills)
    .filter((p) => {
      const s = host.reg.skill(p.id);
      return !on.has(p.id) && !!s && barEligible(s);
    })
    .sort(
      (a, b) =>
        (castOrder.get(b.id) ?? 0) - (castOrder.get(a.id) ?? 0) ||
        b.uses - a.uses ||
        b.rank - a.rank ||
        b.learnedAt - a.learnedAt ||
        (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
    )
    .map((p) => p.id);
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

export interface RefillOptions {
  /** fillClassSlots `stable`: a refresh (a player edit, loading) — only empty class slots are filled. */
  stable?: boolean;
  /** fillClassSlots `rehome`: skills pushed out of the class slots move into your empty slots. */
  rehome?: boolean;
  /** Your slots still empty afterwards take your most recently used skills that are not on the bar (becoming). */
  backfill?: boolean;
}

/**
 * Re-fills the class slots of the worn class (become / wear / discovered-and-worn / load / after a player edit);
 * skills an active quest asks for are picked first. Emits `barChanged` with `reason` when anything moved and
 * returns the changed slots; a player edit that made the class take one skill names it (`skillId`, the "Blademaster
 * equipped Blindside" toast). With no class it does nothing.
 */
export function refillClassSlots(
  host: LoadoutHost,
  reason: NonNullable<BarChangedEvent['reason']>,
  opts: RefillOptions = {},
): number[] {
  const worn = host.book.state.worn;
  const bar = host.player.hotbar;
  if (!worn) return [];
  const n = classSlotsFor(worn, bar.length);
  const fill = fillClassSlots(bar, classPicks(host) ?? [], {
    classSlots: n,
    stable: opts.stable,
    rehome: opts.rehome,
    prefer: questSkills(host),
  });
  const next = opts.backfill ? backfillOwn(fill.bar, n, spareSkills(host, fill.bar)) : fill.bar;
  const changed = diffSlots(bar, next);
  if (!changed.length) return [];
  setBar(host, next);
  const named = reason === 'assign' && fill.added.length === 1 ? { skillId: fill.added[0] } : {};
  emit({ slots: changed, reason, classId: worn, ...named });
  return changed;
}

/**
 * The bar after BECOMING a class (views.becomeClass, a class discovered and worn at once): the class lays out its
 * picks, the skills it pushes out move into your empty slots, and any slot of yours still empty takes your most
 * recently used skill that is not on the bar (SPEC-v2 §5.1 auto-equip; UX-SIMPLE rule 6).
 */
export function becomeRefill(host: LoadoutHost): number[] {
  return refillClassSlots(host, 'class', { rehome: true, backfill: true });
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
 * clearly better than the weakest class skill that no active quest asks for (`classLearned`; the replaced skill
 * moves into an empty slot of yours when there is one), else it drops into an empty slot of yours (`learned`).
 * Weapon basics and monster techniques never go on the bar. Uses the same rule as a refresh: a stable refill right
 * after changes nothing.
 */
export function slotLearned(host: LoadoutHost, skillId: string): LearnPlacement | null {
  const skill = host.reg.skill(skillId);
  if (!skill || !barEligible(skill) || !host.book.has(skillId)) return null;
  const worn = host.book.state.worn;
  const bar = host.player.hotbar;
  const placed = placeLearned(
    bar,
    skillId,
    classPicks(host),
    classSlotsFor(worn, bar.length),
    classBeats(host) ?? undefined,
    questSkills(host),
  );
  if (!placed) return null;
  setBar(host, placed.bar);
  emit({ slots: placed.changed, reason: placed.reason, skillId, ...(placed.reason === 'classLearned' && worn ? { classId: worn } : {}) });
  return placed;
}
