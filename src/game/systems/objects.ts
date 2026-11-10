// World objects (docs/SPEC-v4.md §6.1): everything a player skill PLACES in the world — zones today; traps, summons,
// walls and class objects later — is one record kept by one helper, capped at 12 at once (the oldest goes first).
// Phaser-free and clock-free (the caller passes scene time), so the placing rules, lifetimes, tick schedule and hit
// tests are unit-tested (tests/game-objects.test.ts). SkillSystem owns the instance for a map; the VFX and audio
// draw the objects from the bus events SkillSystem emits (objectSpawn / objectTick / objectEnd).
import type { SkillDef } from '../../core/types';
import { distToSegment } from './tellhit';

/** Most player objects alive at once (SPEC-v4 §6.1, [T]); placing one more expires the oldest. */
export const OBJECT_CAP = 12;
/** Most ticks one zone may land (core compose.ZONE_MAX_HITS: duration ÷ tick, max 8). */
export const ZONE_TICKS = 8;

export type ObjectKind = 'zone';
export type ObjectEndReason = 'expire' | 'cap' | 'replaced' | 'consumed' | 'clear';

/** A placed thing. Live record: read x / y / radius / level every frame while `alive`. */
export interface WorldObject {
  /** Unique for the whole run (objectSpawn / objectTick / objectEnd carry it). */
  readonly id: number;
  readonly kind: ObjectKind;
  /** The skill that placed it. */
  readonly skill: SkillDef;
  /** Centre (world px, ground). A line's centre is its middle. */
  x: number;
  y: number;
  radius: number;
  /** A lane instead of a circle: from (x0, y0) to (x1, y1), `radius` each side. */
  line?: { x0: number; y0: number; x1: number; y1: number };
  /** Follows its owner (the caller moves it with `moveTo`). */
  follow: boolean;
  bornAt: number;
  /** Scene time it ends (Infinity = until replaced, consumed or the map changes). */
  until: number;
  /** Ms between ticks, the next tick's scene time, and ticks still to land (0 = it only stands there). */
  tickMs: number;
  nextTick: number;
  ticksLeft: number;
  /** Ticks landed so far. */
  ticks: number;
  /** The class mechanic's object id this is (mechanics.ts ZoneObjectState.id), when a kit skill placed it. */
  mech?: number;
  /** Mechanic object level (1 when it has none). */
  level: number;
  alive: boolean;
}

export interface ObjectSpec {
  kind: ObjectKind;
  skill: SkillDef;
  x: number;
  y: number;
  radius: number;
  line?: { x0: number; y0: number; x1: number; y1: number };
  follow?: boolean;
  /** How long it lasts (ms); 0 or Infinity = until removed. */
  lifeMs: number;
  tickMs: number;
  /** How many ticks it lands in all. */
  ticks: number;
  mech?: number;
}

/** Ticks a zone lands: duration ÷ tick, at most ZONE_TICKS, at least 1 (a zone that never ticks would do nothing). */
export function zoneTicks(durationMs: number, tickMs: number): number {
  if (!(tickMs > 0) || !(durationMs > 0)) return 1;
  return Math.max(1, Math.min(ZONE_TICKS, Math.floor(durationMs / tickMs)));
}

/** Whether a body of radius `r` at (x, y) stands in the object (circle, or the lane of a line). */
export function objectCovers(o: Pick<WorldObject, 'x' | 'y' | 'radius' | 'line'>, x: number, y: number, r = 0): boolean {
  if (o.line) return distToSegment(x, y, o.line.x0, o.line.y0, o.line.x1, o.line.y1) <= o.radius + r;
  return Math.hypot(x - o.x, y - o.y) <= o.radius + r;
}

/** Distance from a point to the object's centre (a line: to its segment). */
export function objectDistance(o: Pick<WorldObject, 'x' | 'y' | 'line'>, x: number, y: number): number {
  if (o.line) return distToSegment(x, y, o.line.x0, o.line.y0, o.line.x1, o.line.y1);
  return Math.hypot(x - o.x, y - o.y);
}

let objectSeq = 1;

export class WorldObjects {
  private list: WorldObject[] = [];

  constructor(
    /** Called once for every object that ends, whatever the reason (the emitter of objectEnd). */
    private readonly onEnd: (o: WorldObject, reason: ObjectEndReason) => void = () => undefined,
    readonly cap = OBJECT_CAP,
  ) {}

  /** Live objects, oldest first. */
  all(): readonly WorldObject[] {
    return this.list;
  }

  get count(): number {
    return this.list.length;
  }

  /** Places an object at scene time `now`. Over the cap the oldest ends first (reason 'cap'). */
  add(spec: ObjectSpec, now: number): WorldObject {
    while (this.list.length >= Math.max(1, this.cap)) this.end(this.list[0], 'cap');
    const forever = !(spec.lifeMs > 0) || !Number.isFinite(spec.lifeMs);
    const o: WorldObject = {
      id: objectSeq++,
      kind: spec.kind,
      skill: spec.skill,
      x: spec.x,
      y: spec.y,
      radius: spec.radius,
      ...(spec.line ? { line: { ...spec.line } } : {}),
      follow: !!spec.follow,
      bornAt: now,
      until: forever ? Infinity : now + spec.lifeMs,
      tickMs: spec.tickMs,
      nextTick: now + Math.max(0, spec.tickMs),
      ticksLeft: Math.max(0, Math.floor(spec.ticks)),
      ticks: 0,
      ...(spec.mech !== undefined ? { mech: spec.mech } : {}),
      level: 1,
      alive: true,
    };
    this.list.push(o);
    return o;
  }

  /** Whether an object placed by this skill is still up (AUTO: never two of the same). */
  hasOf(skillId: string): boolean {
    return this.list.some((o) => o.skill.id === skillId || o.skill.baseId === skillId);
  }

  byMech(mech: number): WorldObject | undefined {
    return this.list.find((o) => o.mech === mech);
  }

  /** The nearest object to a point within `maxD` px (centre distance), optionally only class-mechanic objects. */
  nearest(x: number, y: number, maxD = Infinity, mechOnly = false): WorldObject | null {
    let best: WorldObject | null = null;
    let bestD = maxD;
    for (const o of this.list) {
      if (mechOnly && o.mech === undefined) continue;
      const d = objectDistance(o, x, y);
      if (d <= bestD) {
        bestD = d;
        best = o;
      }
    }
    return best;
  }

  /** Moves a following object (its line, if any, moves with it). */
  moveTo(o: WorldObject, x: number, y: number): void {
    const dx = x - o.x;
    const dy = y - o.y;
    o.x = x;
    o.y = y;
    if (o.line) o.line = { x0: o.line.x0 + dx, y0: o.line.y0 + dy, x1: o.line.x1 + dx, y1: o.line.y1 + dy };
  }

  /**
   * Advances to scene time `now`: every due tick calls `onTick` (at most one per object per call, so a long frame
   * never lands a burst), then objects past their time end ('expire'). An object's last tick always lands before it
   * expires.
   */
  update(now: number, onTick: (o: WorldObject, index: number) => void): void {
    for (const o of [...this.list]) {
      if (!o.alive) continue;
      if (o.ticksLeft > 0 && now >= o.nextTick) {
        o.ticksLeft--;
        o.nextTick += Math.max(1, o.tickMs);
        // A stalled clock (tab hidden) must not queue a burst of ticks.
        if (o.nextTick < now) o.nextTick = now + Math.max(1, o.tickMs);
        onTick(o, o.ticks++);
      }
      if (o.alive && now >= o.until && o.ticksLeft <= 0) this.end(o, 'expire');
      else if (o.alive && now >= o.until + Math.max(1, o.tickMs)) this.end(o, 'expire');
    }
  }

  /** Ends one object now. False when it was already gone. */
  end(o: WorldObject, reason: ObjectEndReason): boolean {
    const at = this.list.indexOf(o);
    if (at < 0) return false;
    this.list.splice(at, 1);
    o.alive = false;
    this.onEnd(o, reason);
    return true;
  }

  /** The world was frozen for `ms` (panel pause, hit-stop): lifetimes and ticks resume where they were. */
  shiftTime(ms: number): void {
    for (const o of this.list) {
      o.bornAt += ms;
      o.nextTick += ms;
      if (Number.isFinite(o.until)) o.until += ms;
    }
  }

  /** Ends everything (map change, death). */
  clear(reason: ObjectEndReason = 'clear'): void {
    for (const o of [...this.list]) this.end(o, reason);
  }
}
