// Class mechanics (docs/SPEC-v4.md §3.3, §3.6 "AUTO and each mechanic kind"): one signature mechanic per class,
// run as a pure, deterministic state machine. The game layer feeds events in (hits, kills, ticks, skill uses) and
// applies what comes out (boosts on a cast, effects to show, stat changes); nothing here reads the clock, rolls
// dice or knows about positions. Phase 1 runs gauge, combo, marks, stance and zone; `form` (Phase 5) is inert.
//
// Call order for one skill use (basic attacks included):
//   1. skillLocked(m, state, id)          — a gauge `unlock` skill below its threshold cannot be cast;
//   2. resolveSkill(m, state, id)         — the SkillDef id to actually cast (stance remap);
//   3. useSkill(m, state, use, ctx)       — commits the use: returns the new state, the CastBoost to apply to this
//                                           cast and the effects to show (finisher, spend, cash-in, placed);
//   4. stepMechanic(m, state, { type: 'hit', ... }) for every hit the cast lands, 'kill' for kills, and
//      { type: 'tick', dtMs } every frame or fixed step.
// previewBoost() answers "what would this skill gain right now" without changing anything (HUD glow, AUTO).
import type {
  AutoRule,
  CastBoost,
  ClassDef,
  ClassMechanic,
  ElementId,
  GaugeEffect,
  GaugeFill,
  MechanicStat,
  ShapeKind,
  SkillDef,
  SkillFilter,
  StatusKind,
  WeaponType,
} from './types';

/** Mechanic tuning shared by every class. All [T]. */
export const MECHANIC = {
  /** Combo steps must follow each other within this long unless the mechanic says otherwise (ms). */
  comboWindowMs: 4000,
  /** Tag a skill carries (or `extra: 'mark'`) to plant a mark with `applyOn: 'skillTag'`. */
  markTag: 'mark',
  /** How long an Opening stays on a foe after its own attack (ms). */
  openingMs: 1200,
} as const;

type Gauge = Extract<ClassMechanic, { kind: 'gauge' }>;
type Combo = Extract<ClassMechanic, { kind: 'combo' }>;
type Marks = Extract<ClassMechanic, { kind: 'marks' }>;
type Stance = Extract<ClassMechanic, { kind: 'stance' }>;
type Zone = Extract<ClassMechanic, { kind: 'zone' }>;

// ------------------------------------------------------------------ what the engine knows about a skill use

/** The facts about one skill use that mechanics read. Build it with skillUse(). */
export interface SkillUse {
  id: string;
  tags: readonly string[];
  kind: ShapeKind;
  element?: ElementId;
  /** The skill's `weapons` (undefined = free). */
  weapons?: readonly WeaponType[];
  /** A tier-0 basic attack. */
  basic: boolean;
  /** One of the worn class's kit skills. */
  kit: boolean;
}

/** SkillUse of `skill` for the worn class `cls` (kit membership; `extra: 'mark'` reads as the mark tag). */
export function skillUse(cls: Pick<ClassDef, 'kit'> | undefined, skill: SkillDef): SkillUse {
  const tags = skill.extra === 'mark' && !skill.tags.includes(MECHANIC.markTag) ? [...skill.tags, MECHANIC.markTag] : skill.tags;
  const use: SkillUse = {
    id: skill.id,
    tags,
    kind: skill.shape.kind,
    basic: skill.tier === 0 && skill.tags.includes('basic'),
    kit: cls?.kit?.includes(skill.baseId ?? skill.id) ?? false,
  };
  if (skill.element) use.element = skill.element;
  if (skill.weapons) use.weapons = skill.weapons;
  return use;
}

function matches(filter: SkillFilter | undefined, use: SkillUse): boolean {
  if (!filter) return true;
  if (filter.of === 'kit' && !use.kit) return false;
  if (filter.of === 'basic' && !use.basic) return false;
  if (filter.weapon !== undefined && !use.weapons?.includes(filter.weapon)) return false;
  if (filter.tag !== undefined && !use.tags.includes(filter.tag)) return false;
  if (filter.kind !== undefined && use.kind !== filter.kind) return false;
  return true;
}

// ------------------------------------------------------------------ boosts

/** Two boosts on one cast: percentages and counts add, flags OR, the larger HP cost and repeat win. */
export function mergeBoost(a: CastBoost, b: CastBoost | undefined): CastBoost {
  if (!b) return a;
  const out: CastBoost = { ...a };
  for (const k of ['powerPct', 'sizePct', 'speedPct', 'pierce', 'pulses'] as const) {
    if (b[k] !== undefined) out[k] = (a[k] ?? 0) + b[k];
  }
  if (b.crit) out.crit = true;
  if (b.free) out.free = true;
  if (b.hpCostPct !== undefined) out.hpCostPct = Math.max(a.hpCostPct ?? 0, b.hpCostPct);
  if (b.repeat !== undefined) out.repeat = Math.max(a.repeat ?? 0, b.repeat);
  if (b.status) out.status = b.status;
  return out;
}

/** A per-point boost times `n` points (numbers scale; flags hold while n > 0). */
export function scaleBoost(b: CastBoost, n: number): CastBoost {
  if (n <= 0) return {};
  const out: CastBoost = { ...b };
  for (const k of ['powerPct', 'sizePct', 'speedPct', 'pierce', 'pulses'] as const) {
    if (b[k] !== undefined) out[k] = b[k] * n;
  }
  return out;
}

/** True when a boost changes nothing. */
export function isEmptyBoost(b: CastBoost): boolean {
  return Object.keys(b).length === 0;
}

// ------------------------------------------------------------------ state

export interface MarkState {
  /** Marks on the foe. */
  n: number;
  /** Time since the last mark landed (ms). */
  ageMs: number;
  /** Damage stored by `perMark.store`, paid out on cash-in or when the marks end. */
  stored: number;
}

export interface ZoneObjectState {
  id: number;
  ageMs: number;
  /** 1..mechanic.levels (1 when the mechanic has no levels). */
  level: number;
}

/** Runtime state of a mechanic. Plain data: safe to copy, compare and (if ever needed) save. */
export type MechanicState =
  | { kind: 'none' }
  | {
      kind: 'gauge';
      value: number;
      /** Time since the gauge last gained anything (ms): decay starts after `decay.afterMs`. */
      idleMs: number;
      /** Foe id -> time since it was last hit (ms), for `hitDistinct` fills. */
      recent: Record<string, number>;
      /** Element of the last cast counted by an `alternate` fill. */
      lastAlt?: ElementId;
    }
  | { kind: 'combo'; steps: string[]; sinceMs: number }
  | { kind: 'marks'; marks: Record<string, MarkState>; openings: Record<string, number> }
  | { kind: 'stance'; stance: 0 | 1; sinceMs: number }
  | { kind: 'zone'; objects: ZoneObjectState[]; nextId: number };

/** A fresh state for a mechanic (`{ kind: 'none' }` for no mechanic and for forms). */
export function initMechanic(m: ClassMechanic | undefined): MechanicState {
  switch (m?.kind) {
    case 'gauge':
      return { kind: 'gauge', value: 0, idleMs: 0, recent: {} };
    case 'combo':
      return { kind: 'combo', steps: [], sinceMs: 0 };
    case 'marks':
      return { kind: 'marks', marks: {}, openings: {} };
    case 'stance':
      return { kind: 'stance', stance: 0, sinceMs: 0 };
    case 'zone':
      return { kind: 'zone', objects: [], nextId: 1 };
    default:
      return { kind: 'none' };
  }
}

// ------------------------------------------------------------------ events in, effects out

export type MechanicEvent =
  /** Time passes. `moving` / `attacking` default false, `inCombat` true; `tiles` = tiles walked this step. */
  | { type: 'tick'; dtMs: number; moving?: boolean; attacking?: boolean; inCombat?: boolean; tiles?: number }
  /** A hit landed on `target` (a foe id) while holding `weapon`. `statuses`: what the foe carried when hit. */
  | { type: 'hit'; use: SkillUse; weapon: WeaponType; target: string; damage?: number; statuses?: readonly StatusKind[] }
  /** A foe died. `hpPct`: the player's HP percent; `object`: the zone object it died near, if any. */
  | { type: 'kill'; target: string; hpPct?: number; object?: number }
  /** The player lost / shielded-or-healed / paid `pct` percent of max HP. */
  | { type: 'damageTaken'; pct: number }
  | { type: 'prevented'; pct: number }
  | { type: 'hpSpent'; pct: number }
  | { type: 'pickup'; item: 'ember' }
  /** A foe finished its own attack: it shows an Opening for `ms` (default MECHANIC.openingMs). */
  | { type: 'opening'; target: string; ms?: number }
  /** The stance button. `on` sets the stance (hold-to-stance); without it the stance flips. */
  | { type: 'swap'; on?: boolean }
  /** A zone object was placed by something other than a placing kit skill. */
  | { type: 'place' }
  /** A zone object was used up or destroyed (default: the oldest). */
  | { type: 'remove'; object?: number }
  /** A foe left the fight without dying (leashed, despawned). */
  | { type: 'gone'; target: string }
  /** Fight over, death or class change: back to the initial state. */
  | { type: 'reset' };

export type MechanicEffect =
  /** The gauge just reached its max ("meter full"). */
  | { type: 'full'; name: string }
  /** A skill spent gauge points. */
  | { type: 'spent'; name: string; amount: number; skill: string }
  /** A combo advanced to `step` of `length`. */
  | { type: 'comboStep'; name: string; step: number; length: number }
  /** A combo was dropped. */
  | { type: 'comboBreak'; name: string }
  /** This skill use is the combo's finisher. */
  | { type: 'finisher'; name: string; skill: string }
  | { type: 'marked'; name: string; target: string; marks: number; status?: StatusKind; statusMs?: number }
  /**
   * Marks were cashed in. Per foe: its marks, the percent damage bonus of the cash-in against it and the stored
   * damage to deal at once. `resetCooldown`: the cash-in skill's cooldown resets.
   */
  | { type: 'cashIn'; name: string; skill: string; targets: { target: string; marks: number; powerPct: number; stored: number }[]; resetCooldown: boolean }
  /** Marks ran out on a foe: deal `stored` to it now. */
  | { type: 'markEnd'; name: string; target: string; stored: number }
  | { type: 'stance'; stance: 0 | 1; name: string }
  | { type: 'placed'; name: string; object: number; count: number }
  | { type: 'expired'; name: string; object: number; level: number }
  | { type: 'levelUp'; name: string; object: number; level: number }
  /** A kit skill used the objects up (Hurl Hearth, Shatter). */
  | { type: 'consumed'; name: string; skill: string; objects: ZoneObjectState[] };

export interface StepResult {
  state: MechanicState;
  effects: MechanicEffect[];
}

export interface UseResult extends StepResult {
  /** What this cast gains. Empty when the mechanic does not touch it. */
  boost: CastBoost;
  /** The use was refused: a gauge `unlock` skill below its threshold. State is unchanged. */
  locked: boolean;
}

/** What the game knows at the moment of a skill use. */
export interface UseContext {
  weapon: WeaponType;
  /** The cast's main target (marks: whose marks boost the cash-in when it is not an area skill). */
  target?: string;
  /** Level of the zone object the caster stands near (zone `near` effects), or null / undefined when none. */
  nearLevel?: number | null;
}

const NONE: StepResult = { state: { kind: 'none' }, effects: [] };

function atValue(at: number | 'max', max: number | null): number {
  return at === 'max' ? (max ?? Infinity) : at;
}

function clampGauge(value: number, max: number | null): number {
  return Math.max(0, max === null ? value : Math.min(max, value));
}

// ------------------------------------------------------------------ gauge

function gaugeAdd(m: Gauge, s: Extract<MechanicState, { kind: 'gauge' }>, amount: number, effects: MechanicEffect[]): void {
  if (amount === 0) return;
  const before = s.value;
  s.value = clampGauge(s.value + amount, m.max);
  if (amount > 0) s.idleMs = 0;
  if (m.max !== null && before < m.max && s.value >= m.max) effects.push({ type: 'full', name: m.name });
}

function fillOnHit(fill: GaugeFill, ev: Extract<MechanicEvent, { type: 'hit' }>, s: Extract<MechanicState, { kind: 'gauge' }>): number {
  if (fill.on === 'hit') {
    if (fill.weapon !== undefined && !(ev.weapon === fill.weapon && ev.use.weapons?.includes(fill.weapon))) return 0;
    if (fill.tag !== undefined && !ev.use.tags.includes(fill.tag)) return 0;
    if (fill.basic !== undefined && fill.basic !== ev.use.basic) return 0;
    return fill.amount;
  }
  if (fill.on === 'hitDistinct') {
    const since = Object.hasOwn(s.recent, ev.target) ? s.recent[ev.target] : Infinity;
    return since > fill.windowMs ? fill.amount : 0;
  }
  return 0;
}

function stepGauge(m: Gauge, prev: Extract<MechanicState, { kind: 'gauge' }>, ev: MechanicEvent): StepResult {
  const s = { ...prev, recent: { ...prev.recent } };
  const effects: MechanicEffect[] = [];
  switch (ev.type) {
    case 'reset':
      return { state: initMechanic(m), effects };
    case 'tick': {
      const sec = ev.dtMs / 1000;
      let gained = 0;
      for (const f of m.fill) {
        if (f.on === 'time' && ev.inCombat !== false) gained += f.perSec * sec;
        else if (f.on === 'still' && !ev.moving) gained += f.perSec * sec;
        else if (f.on === 'idleAttack' && !ev.attacking) gained += f.perSec * sec;
        else if (f.on === 'move' && ev.tiles) gained += f.perTile * ev.tiles;
      }
      const window = Math.max(0, ...m.fill.map((f) => (f.on === 'hitDistinct' ? f.windowMs : 0)));
      for (const id of Object.keys(s.recent)) {
        s.recent[id] += ev.dtMs;
        if (s.recent[id] > window) delete s.recent[id];
      }
      s.idleMs += ev.dtMs;
      gaugeAdd(m, s, gained, effects);
      if (m.decay && s.idleMs >= m.decay.afterMs && s.value > 0) {
        // Only the part of this step past the idle threshold decays.
        const over = Math.min(ev.dtMs, s.idleMs - m.decay.afterMs);
        s.value = clampGauge(s.value - (m.decay.perSec * over) / 1000, m.max);
      }
      return { state: s, effects };
    }
    case 'hit': {
      let gained = 0;
      for (const f of m.fill) gained += fillOnHit(f, ev, s);
      if (m.fill.some((f) => f.on === 'hitDistinct')) s.recent[ev.target] = 0;
      gaugeAdd(m, s, gained, effects);
      return { state: s, effects };
    }
    case 'kill': {
      let gained = 0;
      for (const f of m.fill) {
        if (f.on === 'kill' && (f.lowHpBelow === undefined || (ev.hpPct ?? 100) < f.lowHpBelow)) gained += f.amount;
      }
      delete s.recent[ev.target];
      gaugeAdd(m, s, gained, effects);
      return { state: s, effects };
    }
    case 'damageTaken':
    case 'prevented':
    case 'hpSpent': {
      let gained = 0;
      for (const f of m.fill) if (f.on === ev.type) gained += f.perPct * ev.pct;
      gaugeAdd(m, s, gained, effects);
      return { state: s, effects };
    }
    case 'pickup': {
      let gained = 0;
      for (const f of m.fill) if (f.on === 'pickup' && f.item === ev.item) gained += f.amount;
      gaugeAdd(m, s, gained, effects);
      return { state: s, effects };
    }
    case 'gone':
      delete s.recent[ev.target];
      return { state: s, effects };
    default:
      return { state: prev, effects };
  }
}

/** Boost and points a gauge would give/spend on a skill use right now. */
function gaugeUse(m: Gauge, value: number, use: SkillUse): { boost: CastBoost; spend: number; locked: boolean } {
  const points = Math.floor(value + 1e-9);
  let boost: CastBoost = {};
  let spend = 0;
  let locked = false;
  const spendOf = (e: { spend?: number | 'all' }): number => (e.spend === undefined || e.spend === 'all' ? value : Math.min(value, e.spend));
  for (const e of m.effects) {
    switch (e.do) {
      case 'perPoint':
        if (e.boost && matches(e.filter, use)) boost = mergeBoost(boost, scaleBoost(e.boost, points));
        break;
      case 'threshold':
        if (e.boost && value >= atValue(e.at, m.max) && matches(e.filter, use)) boost = mergeBoost(boost, e.boost);
        break;
      case 'nextSkill':
        if (value >= atValue(e.at, m.max) && matches(e.filter, use)) {
          boost = mergeBoost(boost, e.boost);
          spend = Math.max(spend, spendOf(e));
        }
        break;
      case 'spendAll':
        if (points >= 1 && matches(e.filter, use)) {
          boost = mergeBoost(boost, scaleBoost(e.perPoint, points));
          spend = value;
        }
        break;
      case 'unlock':
        if (use.id === e.skill) {
          if (value >= atValue(e.at, m.max)) spend = Math.max(spend, spendOf(e));
          else locked = true;
        }
        break;
      case 'stat':
        break;
    }
  }
  return { boost, spend, locked };
}

function useGauge(m: Gauge, prev: Extract<MechanicState, { kind: 'gauge' }>, use: SkillUse): UseResult {
  const { boost, spend, locked } = gaugeUse(m, prev.value, use);
  if (locked) return { state: prev, effects: [], boost: {}, locked: true };
  const s = { ...prev, recent: { ...prev.recent } };
  const effects: MechanicEffect[] = [];
  if (spend > 0) {
    s.value = clampGauge(s.value - spend, m.max);
    effects.push({ type: 'spent', name: m.name, amount: spend, skill: use.id });
  }
  let gained = 0;
  for (const f of m.fill) {
    if (f.on !== 'cast' || use.basic) continue;
    if (f.tag !== undefined && !use.tags.includes(f.tag)) continue;
    if (f.element !== undefined && use.element !== f.element) continue;
    if (f.alternate) {
      if (!use.element || !f.alternate.includes(use.element) || use.element === s.lastAlt) continue;
      s.lastAlt = use.element;
    }
    gained += f.amount;
  }
  gaugeAdd(m, s, gained, effects);
  return { state: s, effects, boost, locked: false };
}

// ------------------------------------------------------------------ combo

function comboCounts(m: Combo, use: SkillUse): boolean {
  if (m.filter?.weapon !== undefined && !use.weapons?.includes(m.filter.weapon)) return false;
  if (m.filter?.tag !== undefined && !use.tags.includes(m.filter.tag)) return false;
  return true;
}

/** What a skill use does to a combo: 'ignore' (does not count, does not break), a builder step, the finisher, or a break. */
function comboRole(m: Combo, steps: readonly string[], use: SkillUse): 'ignore' | 'step' | 'restart' | 'finisher' | 'break' {
  const ready = steps.length >= m.length - 1;
  if (m.lead === 'basic') {
    if (use.basic) return comboCounts(m, use) ? 'step' : 'break';
    if (use.kit) return ready ? 'finisher' : 'break';
    return 'break';
  }
  if (use.basic) return 'ignore';
  if (!comboCounts(m, use)) return 'break';
  if (m.distinct && steps.includes(use.id)) return 'restart';
  return ready ? 'finisher' : 'step';
}

function useCombo(m: Combo, prev: Extract<MechanicState, { kind: 'combo' }>, use: SkillUse): UseResult {
  const role = comboRole(m, prev.steps, use);
  const effects: MechanicEffect[] = [];
  const had = prev.steps.length > 0;
  switch (role) {
    case 'ignore':
      return { state: prev, effects, boost: {}, locked: false };
    case 'break':
      if (had) effects.push({ type: 'comboBreak', name: m.name });
      return { state: { kind: 'combo', steps: [], sinceMs: 0 }, effects, boost: {}, locked: false };
    case 'restart':
      if (had) effects.push({ type: 'comboBreak', name: m.name });
      effects.push({ type: 'comboStep', name: m.name, step: 1, length: m.length });
      return { state: { kind: 'combo', steps: [use.id], sinceMs: 0 }, effects, boost: {}, locked: false };
    case 'finisher':
      effects.push({ type: 'finisher', name: m.finisher.name, skill: use.id });
      return { state: { kind: 'combo', steps: [], sinceMs: 0 }, effects, boost: { ...m.finisher.boost }, locked: false };
    case 'step': {
      // Lead basics saturate at "ready": more jabs keep the combo alive without adding steps.
      const steps = prev.steps.length >= m.length - 1 ? prev.steps : [...prev.steps, use.id];
      if (steps !== prev.steps) effects.push({ type: 'comboStep', name: m.name, step: steps.length, length: m.length });
      return { state: { kind: 'combo', steps, sinceMs: 0 }, effects, boost: {}, locked: false };
    }
  }
}

function stepCombo(m: Combo, prev: Extract<MechanicState, { kind: 'combo' }>, ev: MechanicEvent): StepResult {
  if (ev.type === 'reset') return { state: initMechanic(m), effects: [] };
  if (ev.type !== 'tick' || prev.steps.length === 0) return { state: prev, effects: [] };
  const sinceMs = prev.sinceMs + ev.dtMs;
  if (sinceMs > (m.windowMs ?? MECHANIC.comboWindowMs)) {
    return { state: { kind: 'combo', steps: [], sinceMs: 0 }, effects: [{ type: 'comboBreak', name: m.name }] };
  }
  return { state: { ...prev, sinceMs }, effects: [] };
}

// ------------------------------------------------------------------ marks

function copyMarks(prev: Extract<MechanicState, { kind: 'marks' }>): Extract<MechanicState, { kind: 'marks' }> {
  const marks: Record<string, MarkState> = {};
  for (const [id, x] of Object.entries(prev.marks)) marks[id] = { ...x };
  return { kind: 'marks', marks, openings: { ...prev.openings } };
}

function marksOnHit(m: Marks, s: Extract<MechanicState, { kind: 'marks' }>, ev: Extract<MechanicEvent, { type: 'hit' }>): boolean {
  if (ev.use.id === m.spendWith) return false;
  switch (m.applyOn) {
    case 'weaponHit':
      return ev.use.weapons?.includes(ev.weapon) ?? false;
    case 'skillTag':
      return ev.use.tags.includes(m.tag ?? MECHANIC.markTag);
    case 'opening':
      return Object.hasOwn(s.openings, ev.target);
    case 'launch':
      return ev.statuses?.includes('launch') ?? false;
  }
}

function stepMarks(m: Marks, prev: Extract<MechanicState, { kind: 'marks' }>, ev: MechanicEvent): StepResult {
  const effects: MechanicEffect[] = [];
  switch (ev.type) {
    case 'reset':
      return { state: initMechanic(m), effects };
    case 'tick': {
      const s = copyMarks(prev);
      for (const id of Object.keys(s.openings)) {
        s.openings[id] -= ev.dtMs;
        if (s.openings[id] <= 0) delete s.openings[id];
      }
      for (const [id, x] of Object.entries(s.marks)) {
        x.ageMs += ev.dtMs;
        if (m.perMark.lifeMs !== undefined && x.ageMs >= m.perMark.lifeMs) {
          delete s.marks[id];
          effects.push({ type: 'markEnd', name: m.name, target: id, stored: x.stored });
        }
      }
      return { state: s, effects };
    }
    case 'opening': {
      const s = copyMarks(prev);
      s.openings[ev.target] = ev.ms ?? MECHANIC.openingMs;
      return { state: s, effects };
    }
    case 'hit': {
      const s = copyMarks(prev);
      const had = Object.hasOwn(s.marks, ev.target) ? s.marks[ev.target] : undefined;
      // Damage dealt to a marked foe is banked first (the marking hit itself is not).
      if (had && m.perMark.store && ev.damage) had.stored += ev.damage * m.perMark.store;
      if (marksOnHit(m, s, ev)) {
        const mark = had ?? (s.marks[ev.target] = { n: 0, ageMs: 0, stored: 0 });
        if (mark.n < m.max) {
          mark.n++;
          mark.ageMs = 0;
          const fx: MechanicEffect = { type: 'marked', name: m.name, target: ev.target, marks: mark.n };
          if (m.perMark.status) {
            fx.status = m.perMark.status;
            if (m.perMark.statusMs !== undefined) fx.statusMs = m.perMark.statusMs;
          }
          effects.push(fx);
        }
        if (m.applyOn === 'opening') delete s.openings[ev.target];
      }
      return { state: s, effects };
    }
    case 'kill':
    case 'gone': {
      if (!Object.hasOwn(prev.marks, ev.target) && !Object.hasOwn(prev.openings, ev.target)) return { state: prev, effects };
      const s = copyMarks(prev);
      delete s.marks[ev.target];
      delete s.openings[ev.target];
      return { state: s, effects };
    }
    default:
      return { state: prev, effects };
  }
}

function useMarks(m: Marks, prev: Extract<MechanicState, { kind: 'marks' }>, use: SkillUse, ctx: UseContext): UseResult {
  const ids = Object.keys(prev.marks);
  if (use.id !== m.spendWith || ids.length === 0) return { state: prev, effects: [], boost: {}, locked: false };
  const per = m.perMark.powerPct ?? 0;
  const targets = ids.map((target) => {
    const x = prev.marks[target];
    return { target, marks: x.n, powerPct: per * x.n, stored: x.stored };
  });
  const main = ctx.target !== undefined && Object.hasOwn(prev.marks, ctx.target) ? prev.marks[ctx.target].n : Math.max(...targets.map((t) => t.marks));
  const resetCooldown = !!m.perMark.resetAtMax && targets.some((t) => t.marks >= m.max);
  const boost: CastBoost = per * main > 0 ? { powerPct: per * main } : {};
  return {
    state: { kind: 'marks', marks: {}, openings: { ...prev.openings } },
    effects: [{ type: 'cashIn', name: m.name, skill: use.id, targets, resetCooldown }],
    boost,
    locked: false,
  };
}

// ------------------------------------------------------------------ stance

function stepStance(m: Stance, prev: Extract<MechanicState, { kind: 'stance' }>, ev: MechanicEvent): StepResult {
  const flip = (to: 0 | 1): StepResult => ({
    state: { kind: 'stance', stance: to, sinceMs: 0 },
    effects: [{ type: 'stance', stance: to, name: m.names[to] }],
  });
  switch (ev.type) {
    case 'reset':
      return { state: initMechanic(m), effects: [] };
    case 'tick': {
      const sinceMs = prev.sinceMs + ev.dtMs;
      if (typeof m.swap === 'object' && 'everyMs' in m.swap && sinceMs >= m.swap.everyMs) {
        const next = flip(prev.stance === 0 ? 1 : 0);
        (next.state as Extract<MechanicState, { kind: 'stance' }>).sinceMs = sinceMs - m.swap.everyMs;
        return next;
      }
      // A held stance (Dive) lets go by itself after lockMs.
      if (typeof m.swap === 'object' && 'hold' in m.swap && prev.stance === 1 && m.lockMs !== undefined && sinceMs >= m.lockMs) {
        return flip(0);
      }
      return { state: { ...prev, sinceMs }, effects: [] };
    }
    case 'swap': {
      if (typeof m.swap === 'object' && 'everyMs' in m.swap) return { state: prev, effects: [] };
      const to: 0 | 1 = ev.on === undefined ? (prev.stance === 0 ? 1 : 0) : ev.on ? 1 : 0;
      if (to === prev.stance) return { state: prev, effects: [] };
      // The lock only delays tapped swaps; a held stance uses lockMs as its longest hold.
      if (m.swap === 'tap' && m.lockMs !== undefined && prev.sinceMs < m.lockMs) return { state: prev, effects: [] };
      return flip(to);
    }
    default:
      return { state: prev, effects: [] };
  }
}

// ------------------------------------------------------------------ zone

/** Kit skills that plant a zone mechanic's object: `placeWith`, else the kit's `zone` skills. */
function zonePlaces(m: Zone, use: SkillUse): boolean {
  if (use.id === m.consumeWith) return false;
  return m.placeWith ? m.placeWith.includes(use.id) : use.kit && use.kind === 'zone';
}

function zonePlace(m: Zone, s: Extract<MechanicState, { kind: 'zone' }>, effects: MechanicEffect[]): void {
  while (s.objects.length >= Math.max(1, m.max)) {
    const old = s.objects.shift()!;
    effects.push({ type: 'expired', name: m.name, object: old.id, level: old.level });
  }
  const id = s.nextId++;
  s.objects.push({ id, ageMs: 0, level: 1 });
  effects.push({ type: 'placed', name: m.name, object: id, count: s.objects.length });
}

function stepZone(m: Zone, prev: Extract<MechanicState, { kind: 'zone' }>, ev: MechanicEvent): StepResult {
  const effects: MechanicEffect[] = [];
  const s = { kind: 'zone' as const, objects: prev.objects.map((o) => ({ ...o })), nextId: prev.nextId };
  switch (ev.type) {
    case 'reset':
      return { state: initMechanic(m), effects };
    case 'tick':
      if (s.objects.length === 0) return { state: prev, effects };
      s.objects = s.objects.filter((o) => {
        o.ageMs += ev.dtMs;
        if (m.lifeMs > 0 && o.ageMs >= m.lifeMs) {
          effects.push({ type: 'expired', name: m.name, object: o.id, level: o.level });
          return false;
        }
        return true;
      });
      return { state: s, effects };
    case 'place':
      zonePlace(m, s, effects);
      return { state: s, effects };
    case 'remove': {
      const at = ev.object === undefined ? 0 : s.objects.findIndex((o) => o.id === ev.object);
      if (at < 0 || s.objects.length === 0) return { state: prev, effects };
      const [gone] = s.objects.splice(at, 1);
      effects.push({ type: 'expired', name: m.name, object: gone.id, level: gone.level });
      return { state: s, effects };
    }
    case 'kill': {
      const o = ev.object === undefined ? undefined : s.objects.find((x) => x.id === ev.object);
      if (!o || o.level >= (m.levels ?? 1)) return { state: prev, effects };
      o.level++;
      effects.push({ type: 'levelUp', name: m.name, object: o.id, level: o.level });
      return { state: s, effects };
    }
    default:
      return { state: prev, effects };
  }
}

/** Boost a zone's `near` effects give a skill use while the caster stands near an object of `level`. */
function nearBoost(m: Zone, level: number | null | undefined, use: SkillUse): CastBoost {
  if (!level) return {};
  let boost: CastBoost = {};
  for (const e of m.near.effects) {
    if (e.do === 'perPoint' && e.boost && matches(e.filter, use)) boost = mergeBoost(boost, scaleBoost(e.boost, level));
    else if (e.do === 'threshold' && e.boost && level >= atValue(e.at, m.levels ?? 1) && matches(e.filter, use)) {
      boost = mergeBoost(boost, e.boost);
    }
  }
  return boost;
}

function useZone(m: Zone, prev: Extract<MechanicState, { kind: 'zone' }>, use: SkillUse, ctx: UseContext): UseResult {
  const effects: MechanicEffect[] = [];
  let boost = nearBoost(m, ctx.nearLevel, use);
  if (use.id === m.consumeWith && prev.objects.length > 0) {
    const top = Math.max(...prev.objects.map((o) => o.level));
    if (m.perLevel) boost = mergeBoost(boost, scaleBoost(m.perLevel, top));
    effects.push({ type: 'consumed', name: m.name, skill: use.id, objects: prev.objects.map((o) => ({ ...o })) });
    return { state: { kind: 'zone', objects: [], nextId: prev.nextId }, effects, boost, locked: false };
  }
  if (!zonePlaces(m, use)) return { state: prev, effects, boost, locked: false };
  const s = { kind: 'zone' as const, objects: prev.objects.map((o) => ({ ...o })), nextId: prev.nextId };
  zonePlace(m, s, effects);
  return { state: s, effects, boost, locked: false };
}

// ------------------------------------------------------------------ public engine

/** Whether `state` belongs to `m` (a state from another class, or none, is replaced by a fresh one). */
function fits(m: ClassMechanic | undefined, state: MechanicState): boolean {
  return !!m && m.kind !== 'form' && state.kind === m.kind;
}

/**
 * Feeds one event into a mechanic and returns the next state plus the effects to show. Pure: `state` is never
 * mutated. A missing mechanic (or a form, until Phase 5) returns `{ kind: 'none' }`; a state of the wrong kind is
 * replaced by a fresh one first.
 */
export function stepMechanic(m: ClassMechanic | undefined, state: MechanicState, ev: MechanicEvent): StepResult {
  if (!m || m.kind === 'form') return NONE;
  const s = fits(m, state) ? state : initMechanic(m);
  switch (m.kind) {
    case 'gauge':
      return stepGauge(m, s as Extract<MechanicState, { kind: 'gauge' }>, ev);
    case 'combo':
      return stepCombo(m, s as Extract<MechanicState, { kind: 'combo' }>, ev);
    case 'marks':
      return stepMarks(m, s as Extract<MechanicState, { kind: 'marks' }>, ev);
    case 'stance':
      return stepStance(m, s as Extract<MechanicState, { kind: 'stance' }>, ev);
    case 'zone':
      return stepZone(m, s as Extract<MechanicState, { kind: 'zone' }>, ev);
  }
}

/**
 * Commits one skill use (basic attacks included): gauge spends and cast fills, combo steps and finishers, mark
 * cash-ins, stance boosts, zone placement. Returns the boost to apply to this cast. Pure.
 */
export function useSkill(m: ClassMechanic | undefined, state: MechanicState, use: SkillUse, ctx: UseContext): UseResult {
  if (!m || m.kind === 'form') return { ...NONE, boost: {}, locked: false };
  const s = fits(m, state) ? state : initMechanic(m);
  switch (m.kind) {
    case 'gauge':
      return useGauge(m, s as Extract<MechanicState, { kind: 'gauge' }>, use);
    case 'combo':
      return useCombo(m, s as Extract<MechanicState, { kind: 'combo' }>, use);
    case 'marks':
      return useMarks(m, s as Extract<MechanicState, { kind: 'marks' }>, use, ctx);
    case 'stance': {
      const st = s as Extract<MechanicState, { kind: 'stance' }>;
      const boost = use.kit && m.boosts ? { ...m.boosts[st.stance] } : {};
      return { state: st, effects: [], boost, locked: false };
    }
    case 'zone':
      return useZone(m, s as Extract<MechanicState, { kind: 'zone' }>, use, ctx);
  }
}

/** What useSkill would give this use right now, without committing anything (HUD glow, AUTO, the simulation). */
export function previewBoost(m: ClassMechanic | undefined, state: MechanicState, use: SkillUse, ctx: UseContext): CastBoost {
  return useSkill(m, state, use, ctx).boost;
}

/** Whether a kit skill cannot be cast right now because its gauge is not there yet ("Dawn Verdict unlocks at 100"). */
export function skillLocked(m: ClassMechanic | undefined, state: MechanicState, skillId: string): boolean {
  if (m?.kind !== 'gauge') return false;
  const value = state.kind === 'gauge' ? state.value : 0;
  return m.effects.some((e) => e.do === 'unlock' && e.skill === skillId && value < atValue(e.at, m.max));
}

/** The SkillDef id a bar skill casts right now: the stance B remap, else itself. */
export function resolveSkill(m: ClassMechanic | undefined, state: MechanicState, skillId: string): string {
  if (m?.kind !== 'stance' || state.kind !== 'stance' || state.stance !== 1) return skillId;
  return Object.hasOwn(m.remap, skillId) ? m.remap[skillId] : skillId;
}

/**
 * Stat changes a mechanic gives right now (percent; crit in points): gauge `perPoint` and `threshold` stats, and
 * a zone's `near` stats while the player stands near an object of `nearLevel`.
 */
export function mechanicStats(
  m: ClassMechanic | undefined,
  state: MechanicState,
  nearLevel?: number | null,
): Partial<Record<MechanicStat, number>> {
  const out: Partial<Record<MechanicStat, number>> = {};
  const add = (stat: MechanicStat | undefined, pct: number | undefined): void => {
    if (stat !== undefined && pct) out[stat] = (out[stat] ?? 0) + pct;
  };
  const read = (effects: readonly GaugeEffect[], points: number, value: number, max: number | null): void => {
    for (const e of effects) {
      if (e.do === 'perPoint') add(e.stat, (e.pct ?? 0) * points);
      else if (e.do === 'threshold' && e.stat && value >= atValue(e.at, max)) add(e.stat.stat, e.stat.pct);
      else if (e.do === 'stat') add(e.stat, e.pct);
    }
  };
  if (m?.kind === 'gauge' && state.kind === 'gauge') read(m.effects, Math.floor(state.value + 1e-9), state.value, m.max);
  else if (m?.kind === 'zone' && nearLevel) read(m.near.effects, nearLevel, nearLevel, m.levels ?? 1);
  return out;
}

// ------------------------------------------------------------------ HUD view

/** What the one mechanic widget shows (SPEC-v4 §3.6 HUD): its only label is `name`. */
export interface MechanicView {
  kind: Exclude<ClassMechanic['kind'], 'form'>;
  /** The mechanic's own name; for a stance, the name of the stance you are in. */
  name: string;
  /** 'bar' (gauge), 'pips' (combo, marks), 'sides' (stance), 'count' (zone objects). */
  widget: 'bar' | 'pips' | 'sides' | 'count';
  value: number;
  /** Null for an open-ended gauge. */
  max: number | null;
  /** The next fitting skill gets something: gauge at a threshold, combo one step from its finisher, marks at max. */
  ready: boolean;
  /** Stance only: 0 or 1. */
  stance?: 0 | 1;
}

/** The widget for a mechanic and its state; null when there is nothing to show. `target`: the foe whose marks to count. */
export function mechanicView(m: ClassMechanic | undefined, state: MechanicState, target?: string): MechanicView | null {
  if (!m || m.kind === 'form') return null;
  const s = fits(m, state) ? state : initMechanic(m);
  switch (s.kind) {
    case 'gauge': {
      const g = m as Gauge;
      const ready = g.effects.some((e) => (e.do === 'nextSkill' || e.do === 'threshold' || e.do === 'unlock') && s.value >= atValue(e.at, g.max));
      return { kind: 'gauge', name: g.name, widget: 'bar', value: Math.floor(s.value + 1e-9), max: g.max, ready };
    }
    case 'combo': {
      const c = m as Combo;
      return { kind: 'combo', name: c.name, widget: 'pips', value: s.steps.length, max: c.length - 1, ready: s.steps.length >= c.length - 1 };
    }
    case 'marks': {
      const k = m as Marks;
      const counts = Object.values(s.marks).map((x) => x.n);
      const value = target !== undefined ? (Object.hasOwn(s.marks, target) ? s.marks[target].n : 0) : Math.max(0, ...counts);
      return { kind: 'marks', name: k.name, widget: 'pips', value, max: k.max, ready: counts.some((n) => n >= k.max) };
    }
    case 'stance': {
      const t = m as Stance;
      return { kind: 'stance', name: t.names[s.stance], widget: 'sides', value: s.stance, max: 1, ready: false, stance: s.stance };
    }
    case 'zone': {
      const z = m as Zone;
      return { kind: 'zone', name: z.name, widget: 'count', value: s.objects.length, max: z.max, ready: false };
    }
    case 'none':
      return null;
  }
}

// ------------------------------------------------------------------ AUTO rules

/** What AUTO can see when it asks a mechanic what to do. */
export interface AutoView {
  /** Bar skills that could be cast this instant (off cooldown, enough SP, usable with the weapon), in bar order. */
  castable: readonly SkillUse[];
  weapon: WeaponType;
  /** Player HP percent (0..100). */
  hpPct: number;
  /** The current target, if any. */
  target?: string;
  nearLevel?: number | null;
}

/**
 * What the mechanic asks of AUTO this instant:
 * - `cast`: cast this skill now (a spend at its threshold, a cash-in, the finisher, a placement);
 * - `basic`: keep to basic attacks for now (a lead combo is being built);
 * - `swap`: press the stance button;
 * and `hold`: skills AUTO must not cast now (a cash-in below its marks, a skill that would break the combo).
 */
export interface AutoAdvice {
  do?: { type: 'cast'; skill: string; place?: 'atFeet' | 'onTarget' } | { type: 'basic' } | { type: 'swap' };
  hold: string[];
}

const NO_ADVICE: AutoAdvice = { hold: [] };

function spendThreshold(rule: AutoRule, max: number): number {
  if ('spend' in rule && rule.spend === 'atPct') return (max * rule.pct) / 100;
  return max;
}

/**
 * The AUTO rule of a mechanic, as one piece of advice (SPEC-v4 §3.6): gauges spend at their rule's threshold,
 * combos play the shortest legal sequence, marks cash in at max, stances never swap (or swap by HP), zones keep
 * `keep` objects up and use them up (`consumeWith`) only once one is full-grown, or — without levels — the set is
 * full. Pure; manual play may always do better.
 */
export function autoAdvice(m: ClassMechanic | undefined, state: MechanicState, view: AutoView): AutoAdvice {
  if (!m || m.kind === 'form') return NO_ADVICE;
  const s = fits(m, state) ? state : initMechanic(m);
  switch (s.kind) {
    case 'gauge': {
      const g = m as Gauge;
      const hold = g.effects.flatMap((e) => (e.do === 'unlock' && s.value < atValue(e.at, g.max) ? [e.skill] : []));
      // The first castable skill that would spend, once the gauge is at the rule's threshold.
      for (const use of view.castable) {
        const { spend, locked } = gaugeUse(g, s.value, use);
        if (locked || spend <= 0) continue;
        const need = g.max === null ? 1 : Math.min(spendThreshold(g.autoRule, g.max), g.max);
        if (s.value >= need) return { do: { type: 'cast', skill: use.id }, hold };
        // Below the threshold a spend-everything skill would waste the meter: wait for it.
        if (g.effects.some((e) => e.do === 'spendAll' && matches(e.filter, use))) hold.push(use.id);
      }
      return { hold };
    }
    case 'combo': {
      const c = m as Combo;
      const ready = s.steps.length >= c.length - 1;
      if (c.lead === 'basic') {
        const kit = view.castable.filter((u) => u.kit);
        if (ready && kit.length > 0) return { do: { type: 'cast', skill: kit[0].id }, hold: [] };
        // Kit skills wait for the lead; everything else on the bar would break it.
        return { do: { type: 'basic' }, hold: view.castable.filter((u) => !u.basic).map((u) => u.id) };
      }
      const hold: string[] = [];
      let next: SkillUse | undefined;
      for (const use of view.castable) {
        const role = comboRole(c, s.steps, use);
        if ((role === 'step' || role === 'finisher') && !next) next = use;
        else if ((role === 'break' || role === 'restart') && s.steps.length > 0) hold.push(use.id);
      }
      return next ? { do: { type: 'cast', skill: next.id }, hold } : { hold };
    }
    case 'marks': {
      const k = m as Marks;
      const need = Math.max(1, Math.ceil(spendThreshold(k.autoRule, k.max)));
      const top = Math.max(0, ...Object.values(s.marks).map((x) => x.n));
      const can = view.castable.some((u) => u.id === k.spendWith);
      if (top >= need && can) return { do: { type: 'cast', skill: k.spendWith }, hold: [] };
      return { hold: [k.spendWith] };
    }
    case 'stance': {
      const t = m as Stance;
      if ('swap' in t.autoRule && t.autoRule.swap === 'hpBelow' && t.swap === 'tap') {
        const want: 0 | 1 = view.hpPct < t.autoRule.pct ? 1 : 0;
        const unlocked = t.lockMs === undefined || s.sinceMs >= t.lockMs;
        if (want !== s.stance && unlocked) return { do: { type: 'swap' }, hold: [] };
      }
      return NO_ADVICE;
    }
    case 'zone': {
      const z = m as Zone;
      const hold: string[] = [];
      if ('place' in z.autoRule && s.objects.length < Math.min(z.autoRule.keep, z.max)) {
        const placer = view.castable.find((u) => zonePlaces(z, u));
        if (placer) return { do: { type: 'cast', skill: placer.id, place: z.autoRule.place }, hold: z.consumeWith !== undefined ? [z.consumeWith] : [] };
      }
      // Never stack another object over a full set (it would only expire the oldest).
      if (s.objects.length >= z.max) hold.push(...view.castable.filter((u) => zonePlaces(z, u)).map((u) => u.id));
      if (z.consumeWith !== undefined) {
        // Use the objects up only when they are worth the most: a full-grown one, or a full set.
        const grown = z.levels !== undefined && z.levels > 1 ? s.objects.some((o) => o.level >= z.levels!) : s.objects.length >= z.max;
        if (!grown) hold.push(z.consumeWith);
        else if (view.castable.some((u) => u.id === z.consumeWith)) return { do: { type: 'cast', skill: z.consumeWith }, hold };
      }
      return { hold };
    }
    case 'none':
      return NO_ADVICE;
  }
}

/** Problems in a mechanic's own data (Registry.validate reports them): thresholds, ids that must be kit skills. */
export function mechanicProblems(m: ClassMechanic, kit: readonly string[]): string[] {
  const errs: string[] = [];
  const inKit = (id: string, what: string): void => {
    if (!kit.includes(id)) errs.push(`${what} ${id} is not a kit skill`);
  };
  switch (m.kind) {
    case 'gauge':
      if (m.max !== null && !(m.max > 0)) errs.push('gauge max must be > 0 or null');
      if (m.fill.length === 0) errs.push('gauge has nothing that fills it');
      for (const e of m.effects) {
        if ('at' in e && e.at === 'max' && m.max === null) errs.push("an effect at 'max' needs a gauge max");
        if ('at' in e && typeof e.at === 'number' && m.max !== null && e.at > m.max) errs.push(`an effect at ${e.at} is above the max ${m.max}`);
        if (e.do === 'unlock') inKit(e.skill, 'unlock skill');
      }
      if (!('spend' in m.autoRule)) errs.push('a gauge needs a spend autoRule');
      break;
    case 'combo':
      if (!('spend' in m.autoRule)) errs.push('a combo needs a spend autoRule');
      break;
    case 'marks':
      if (!(m.max >= 1)) errs.push('marks max must be >= 1');
      inKit(m.spendWith, 'spendWith');
      if (!('spend' in m.autoRule)) errs.push('marks need a spend autoRule');
      break;
    case 'stance':
      for (const id of Object.keys(m.remap)) inKit(id, 'remap source');
      if (!('swap' in m.autoRule)) errs.push('a stance needs a swap autoRule');
      break;
    case 'zone':
      if (!(m.max >= 1)) errs.push('zone max must be >= 1');
      for (const id of m.placeWith ?? []) inKit(id, 'placeWith');
      if (m.consumeWith !== undefined) inKit(m.consumeWith, 'consumeWith');
      if (!('place' in m.autoRule)) errs.push('a zone needs a place autoRule');
      break;
    case 'form':
      break;
  }
  return errs;
}
