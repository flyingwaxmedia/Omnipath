// The shared world-object helper (src/game/systems/objects.ts; docs/SPEC-v4.md §6.1): everything a skill places is
// one record with one cap, one lifetime rule, one tick schedule and one hit test.
import { describe, expect, it } from 'vitest';
import type { SkillDef } from '../src/core/types';
import { OBJECT_CAP, type ObjectEndReason, type ObjectSpec, WorldObjects, ZONE_TICKS, objectCovers, objectDistance, zoneTicks } from '../src/game/systems/objects';

const skill = (id: string): SkillDef => ({ id, name: id, desc: '', icon: '', tier: 1, maxRank: 5, tags: [], power: 1, spCost: 0, cooldown: 0, shape: { kind: 'zone', radius: 50, range: 100, durationMs: 4000, tickMs: 500 } });
const spec = (over: Partial<ObjectSpec> = {}): ObjectSpec => ({ kind: 'zone', skill: skill('z'), x: 100, y: 100, radius: 50, lifeMs: 4000, tickMs: 500, ticks: 8, ...over });

function world(cap?: number) {
  const ended: { id: number; reason: ObjectEndReason }[] = [];
  const objs = new WorldObjects((o, reason) => ended.push({ id: o.id, reason }), cap);
  return { objs, ended };
}

describe('zone ticks', () => {
  it('duration ÷ tick, at most 8, at least 1', () => {
    expect(ZONE_TICKS).toBe(8);
    expect(zoneTicks(4000, 500)).toBe(8);
    expect(zoneTicks(4000, 800)).toBe(5);
    expect(zoneTicks(10000, 500)).toBe(8);
    expect(zoneTicks(300, 500)).toBe(1);
    expect(zoneTicks(4000, 0)).toBe(1);
  });

  it('a zone lands exactly its ticks, one per tick time, and its last tick lands before it ends', () => {
    const { objs, ended } = world();
    const o = objs.add(spec(), 1000);
    const ticks: number[] = [];
    for (let now = 1000; now <= 6000; now += 16) objs.update(now, (_o, i) => ticks.push(i));
    expect(ticks).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(o.alive).toBe(false);
    expect(ended).toEqual([{ id: o.id, reason: 'expire' }]);
  });

  it('a long frame never lands a burst of ticks', () => {
    const { objs } = world();
    objs.add(spec(), 0);
    let n = 0;
    objs.update(3000, () => n++); // one frame, 3 s late
    expect(n).toBe(1);
    objs.update(3016, () => n++);
    expect(n).toBe(1); // the schedule restarts from now
    objs.update(3600, () => n++);
    expect(n).toBe(2);
  });
});

describe('lifetimes', () => {
  it('lifeMs 0 stands until removed (a class object); it may still tick its few ticks', () => {
    const { objs, ended } = world();
    const o = objs.add(spec({ lifeMs: 0, ticks: 2, mech: 7 }), 0);
    let n = 0;
    for (let now = 0; now <= 60_000; now += 100) objs.update(now, () => n++);
    expect(n).toBe(2);
    expect(o.alive).toBe(true);
    expect(objs.byMech(7)).toBe(o);
    expect(objs.end(o, 'consumed')).toBe(true);
    expect(objs.end(o, 'consumed')).toBe(false);
    expect(ended).toEqual([{ id: o.id, reason: 'consumed' }]);
  });

  it('a frozen world (pause, hit-stop) shifts lifetimes and ticks', () => {
    const { objs } = world();
    const o = objs.add(spec(), 0);
    objs.shiftTime(10_000);
    let n = 0;
    objs.update(5000, () => n++);
    expect(n).toBe(0);
    expect(o.alive).toBe(true);
    objs.update(10_500, () => n++);
    expect(n).toBe(1);
  });

  it('clear ends everything (map change, death)', () => {
    const { objs, ended } = world();
    objs.add(spec(), 0);
    objs.add(spec(), 0);
    objs.clear();
    expect(objs.count).toBe(0);
    expect(ended.map((e) => e.reason)).toEqual(['clear', 'clear']);
  });
});

describe('the cap', () => {
  it('12 player objects at once: one more ends the oldest', () => {
    expect(OBJECT_CAP).toBe(12);
    const { objs, ended } = world();
    const first = objs.add(spec(), 0);
    for (let i = 1; i < 12; i++) objs.add(spec(), i);
    expect(objs.count).toBe(12);
    expect(ended).toEqual([]);
    const extra = objs.add(spec(), 20);
    expect(objs.count).toBe(12);
    expect(ended).toEqual([{ id: first.id, reason: 'cap' }]);
    expect(objs.all()[11]).toBe(extra);
  });

  it('ids are unique for the run, across helpers (events from two maps never clash)', () => {
    const a = world().objs.add(spec(), 0);
    const b = world().objs.add(spec(), 0);
    expect(b.id).toBeGreaterThan(a.id);
  });
});

describe('hit tests and lookups', () => {
  it('a disc covers bodies that touch it', () => {
    const o = { x: 100, y: 100, radius: 50 };
    expect(objectCovers(o, 149, 100)).toBe(true);
    expect(objectCovers(o, 151, 100)).toBe(false);
    expect(objectCovers(o, 160, 100, 12)).toBe(true); // a body of radius 12
    expect(objectCovers(o, 163, 100, 12)).toBe(false);
  });

  it('a line is a lane: `radius` each side of the segment, ends rounded', () => {
    const o = { x: 100, y: 0, radius: 20, line: { x0: 0, y0: 0, x1: 200, y1: 0 } };
    expect(objectCovers(o, 100, 19)).toBe(true);
    expect(objectCovers(o, 100, 21)).toBe(false);
    expect(objectCovers(o, 215, 0)).toBe(true);
    expect(objectCovers(o, 225, 0)).toBe(false);
    expect(objectDistance(o, 100, 30)).toBe(30);
  });

  it('hasOf (AUTO: never two of the same up), nearest (within reach, class objects only on request)', () => {
    const { objs } = world();
    const a = objs.add(spec({ skill: skill('a'), x: 0, y: 0 }), 0);
    const b = objs.add(spec({ skill: skill('b'), x: 300, y: 0, mech: 1 }), 0);
    expect(objs.hasOf('a')).toBe(true);
    expect(objs.hasOf('c')).toBe(false);
    expect(objs.nearest(10, 0)).toBe(a);
    expect(objs.nearest(10, 0, 5)).toBeNull();
    expect(objs.nearest(10, 0, Infinity, true)).toBe(b);
    expect(objs.nearest(10, 0, 100, true)).toBeNull();
    objs.end(a, 'expire');
    expect(objs.hasOf('a')).toBe(false);
  });

  it('a following object moves with its owner, its lane with it', () => {
    const { objs } = world();
    const o = objs.add(spec({ follow: true, x: 10, y: 10, line: { x0: 0, y0: 10, x1: 20, y1: 10 } }), 0);
    objs.moveTo(o, 110, 60);
    expect([o.x, o.y]).toEqual([110, 60]);
    expect(o.line).toEqual({ x0: 100, y0: 60, x1: 120, y1: 60 });
  });
});
