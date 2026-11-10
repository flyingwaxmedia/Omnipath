// Gifts at run time (docs/SPEC-v4.md §3.6 "Mastery passive", §4): the worn class's passive is usually a RULE, a
// `trigger` passive effect (core PassiveTotals.triggers), and this is where those rules happen. Pure state machine:
// no clock, no scene — Combat tells it what happened (a cast, a hit, a status ending, a second passing) and applies
// what it answers (a free cast, a forced crit, a thrown knife, a burst, SP back).
//
// What is implemented is listed in GIFT_WHEN_DO and GIFT_RULES; tests/skill-promises.test.ts fails when the content
// declares a trigger that is not in them, so a Gift can never promise something that does nothing.
//
//   when        do              meaning here
//   nthHit      guaranteeCrit   the n-th hit IN A ROW ON THE SAME FOE is a critical hit (icdMs between two of them)
//   nthHit      arc             every n-th BASIC ATTACK that lands (with `weapon`, when named) is also thrown at
//                               `arc` other foes near the one struck
//   skillCast   freeCast        every n-th skill you cast (basic attacks do not count) costs no SP
//   statusEnds  burst           a burn that runs its full time on a living foe pops: `burst` × your attack to every foe
//                               within GIFT.burstRadius (icdMs between two pops)
//   always      rule            a named rule (GIFT_RULES)
//   skillCast   rule ebbAndFlow every `ms` the next skill is 15% bigger, the time after 15% stronger, in turn
import type { ActiveTrigger } from '../../core/passives';
import type { CastBoost, TriggerDo, TriggerWhen, WeaponType } from '../../core/types';

export const GIFT = {
  /** fromBehind: extra damage (percent) of a hit that lands on a foe's back. */
  behindPct: 15,
  /** nearFireSp: SP restored each second (percent of max SP) while near a fire, and how near (tiles). */
  fireSpPct: 3,
  fireTiles: 3,
  /** ebbAndFlow: the size, then the damage, the next skill gains (percent). */
  ebbPct: 15,
  /** statusEnds burst: how far the pop reaches (px). */
  burstRadius: 72,
  /** arc: how far the extra throw reaches from the struck foe (px). */
  arcRadius: 170,
} as const;

/** The named rules the game implements (`do: { rule }`). */
export const GIFT_RULES = ['fromBehind', 'nearFireSp', 'ebbAndFlow'] as const;
export type GiftRule = (typeof GIFT_RULES)[number];

/** Every `when` → `do` pair the game implements (the key of `do`; rules by name). */
export const GIFT_WHEN_DO: Readonly<Partial<Record<TriggerWhen, readonly string[]>>> = {
  nthHit: ['guaranteeCrit', 'arc'],
  skillCast: ['freeCast', 'rule:ebbAndFlow'],
  statusEnds: ['burst'],
  always: ['rule:fromBehind', 'rule:nearFireSp'],
};

/** The key a trigger's `do` is known by in GIFT_WHEN_DO ('guaranteeCrit', 'rule:fromBehind'…). */
export function doKey(d: TriggerDo): string {
  const k = Object.keys(d)[0] ?? '';
  return k === 'rule' ? `rule:${(d as { rule: string }).rule}` : k;
}

/** Whether the game implements a trigger (its `when` with its `do`). */
export function giftImplemented(t: Pick<ActiveTrigger, 'when' | 'do'>): boolean {
  return GIFT_WHEN_DO[t.when]?.includes(doKey(t.do)) ?? false;
}

export interface GiftCast {
  /** This cast costs no SP. */
  free: boolean;
  /** What the Gift adds to this cast (size / power), or null. */
  boost: CastBoost | null;
  /** Ids of the passives that did something (for feedback). */
  fired: string[];
}

export interface GiftHit {
  /** This hit is a critical hit. */
  crit: boolean;
  /** Extra damage, percent. */
  pct: number;
  /** Other foes this blow is also thrown at. */
  arc: number;
  fired: string[];
}

interface Streak {
  foe: string;
  count: number;
}

/** The trigger passives of the worn class, running. `triggers` is read fresh on every call (the book caches it). */
export class GiftRuntime {
  /** Per passive id: hits in a row on one foe. */
  private streak = new Map<string, Streak>();
  /** Per passive id: a plain counter (basic hits, casts). */
  private count = new Map<string, number>();
  /** Per passive id: the time (ms) it may fire again. */
  private readyAt = new Map<string, number>();
  /** ebbAndFlow: 0 = the next one is size, 1 = damage. */
  private ebb = new Map<string, 0 | 1>();

  constructor(private readonly triggers: () => readonly ActiveTrigger[]) {}

  private list(when: TriggerWhen): ActiveTrigger[] {
    return this.triggers().filter((t) => t.when === when && giftImplemented(t));
  }

  /** Whether a named rule is on. */
  has(rule: GiftRule): boolean {
    return this.triggers().some((t) => 'rule' in t.do && t.do.rule === rule && giftImplemented(t));
  }

  private ready(id: string, now: number): boolean {
    return now >= (this.readyAt.get(id) ?? -Infinity);
  }

  private arm(t: ActiveTrigger, now: number): void {
    if (t.icdMs) this.readyAt.set(t.id, now + t.icdMs);
  }

  /** Would the next cast of a skill be free? (the "Not enough SP" gate asks before the cast commits) */
  nextFree(basic: boolean): boolean {
    if (basic) return false;
    return this.list('skillCast').some((t) => 'freeCast' in t.do && (this.count.get(t.id) ?? 0) + 1 >= (t.n ?? 1));
  }

  /** A skill fires. Basic attacks never count as a skill cast. */
  cast(e: { basic: boolean; now: number }): GiftCast {
    const out: GiftCast = { free: false, boost: null, fired: [] };
    if (e.basic) return out;
    for (const t of this.list('skillCast')) {
      if ('freeCast' in t.do) {
        const n = (this.count.get(t.id) ?? 0) + 1;
        if (n >= (t.n ?? 1)) {
          this.count.set(t.id, 0);
          out.free = true;
          out.fired.push(t.id);
        } else this.count.set(t.id, n);
      } else if ('rule' in t.do && t.do.rule === 'ebbAndFlow') {
        if (!this.ready(t.id, e.now)) continue;
        const side = this.ebb.get(t.id) ?? 0;
        this.ebb.set(t.id, side === 0 ? 1 : 0);
        // the turn of the tide: `ms` (else icdMs) until the next one
        this.readyAt.set(t.id, e.now + (t.ms ?? t.icdMs ?? 6000));
        out.boost = { ...(out.boost ?? {}), ...(side === 0 ? { sizePct: GIFT.ebbPct } : { powerPct: GIFT.ebbPct }) };
        out.fired.push(t.id);
      }
    }
    return out;
  }

  /**
   * A blow is about to land on `foe`. `direct` is false for copies a Gift or rider threw itself (arc zaps): they
   * never count toward a streak or start another throw.
   */
  hit(e: { foe: string; basic: boolean; weapon: WeaponType; behind: boolean; now: number; direct: boolean }): GiftHit {
    const out: GiftHit = { crit: false, pct: 0, arc: 0, fired: [] };
    if (e.behind && this.has('fromBehind')) {
      out.pct += GIFT.behindPct;
      out.fired.push(this.triggers().find((t) => 'rule' in t.do && t.do.rule === 'fromBehind')!.id);
    }
    if (!e.direct) return out;
    for (const t of this.list('nthHit')) {
      if (t.weapon && t.weapon !== e.weapon) continue;
      const n = t.n ?? 1;
      if ('guaranteeCrit' in t.do) {
        const s = this.streak.get(t.id);
        const count = s && s.foe === e.foe ? s.count + 1 : 1;
        if (count >= n && this.ready(t.id, e.now)) {
          this.streak.set(t.id, { foe: e.foe, count: 0 });
          this.arm(t, e.now);
          out.crit = true;
          out.fired.push(t.id);
        } else this.streak.set(t.id, { foe: e.foe, count: Math.min(count, n - 1) });
      } else if ('arc' in t.do) {
        if (!e.basic) continue;
        const c = (this.count.get(t.id) ?? 0) + 1;
        if (c >= n && this.ready(t.id, e.now)) {
          this.count.set(t.id, 0);
          this.arm(t, e.now);
          out.arc += t.do.arc;
          out.fired.push(t.id);
        } else this.count.set(t.id, Math.min(c, n - 1));
      }
    }
    return out;
  }

  /** A status the player caused ran its full time on a living foe: the burst multiplier to pop for, or 0. */
  statusEnds(kind: string, now: number): number {
    if (kind !== 'burn') return 0;
    let mult = 0;
    for (const t of this.list('statusEnds')) {
      if (!('burst' in t.do) || !this.ready(t.id, now)) continue;
      this.arm(t, now);
      mult += t.do.burst;
    }
    return mult;
  }

  /** SP restored this second (percent of max SP) when the player stands near a fire. */
  fireSp(nearFire: boolean): number {
    return nearFire && this.has('nearFireSp') ? GIFT.fireSpPct : 0;
  }

  /** A new fight, a new map, a new class: counters start over (cooldowns too). */
  reset(): void {
    this.streak.clear();
    this.count.clear();
    this.readyAt.clear();
    this.ebb.clear();
  }

  /** The world clock jumped (pause, hit-stop). */
  shiftTime(ms: number): void {
    for (const [k, v] of this.readyAt) this.readyAt.set(k, v + ms);
  }
}
