// Actors lane: world text lanes (src/game/entities/lanes.ts, used by render/text.ts WorldText) — what goes where over a
// fight, and that nothing lands on the plate or the body.
import { describe, expect, it } from 'vitest';
import {
  LANE,
  LANE_TIMING,
  type LaneBox,
  floatKind,
  floatRole,
  laneAlpha,
  laneOrigin,
  laneRise,
  laneSpan,
  laneSpot,
  sameColumn,
  sideStep,
  splitCount,
  STACK_MAX_PUSH,
  type StackItem,
  stackPush,
} from '../src/game/entities/lanes';

describe('lane of a floating string', () => {
  it('sorts numbers, heals, crits, words and callouts', () => {
    expect(floatKind('123', 14)).toBe('damage');
    expect(floatKind('-45', 14)).toBe('damage');
    expect(floatKind('-45', 17)).toBe('crit'); // a big hit taken
    expect(floatKind('123!', 18)).toBe('crit');
    expect(floatKind('+12', 11)).toBe('heal');
    for (const w of ['Echo!', 'Resist', 'Stunned!', 'Frozen!', 'Interrupted!', 'ATK ↑', 'Reprise', '+1 jump', '× Firestorm', 'Rested'])
      expect(floatKind(w, 12), w).toBe('status');
    for (const c of ['Thunder Stomp', 'Shatter!', 'ENRAGED!', 'LEVEL 5!', 'Slash ★4', '!']) expect(floatKind(c, 13), c).toBe('callout');
  });

  it("knows whose a string is when the player stands on a monster", () => {
    expect(floatRole('-45', 'damage')).toBe('player');
    expect(floatRole('+12', 'heal')).toBe('player');
    expect(floatRole('45', 'damage')).toBe('foe');
    expect(floatRole('LEVEL 5!', 'callout')).toBe('player');
    expect(floatRole('Slash ★4', 'callout')).toBe('player');
    expect(floatRole('Echo!', 'status')).toBe('foe');
    expect(floatRole('Stunned!', 'status')).toBe('player');
    expect(floatRole('Thunder Stomp', 'callout')).toBeNull();
  });

  it('coalesces "Skill xN"', () => {
    expect(splitCount('Firestorm')).toEqual(['Firestorm', 1]);
    expect(splitCount('Firestorm x2')).toEqual(['Firestorm', 2]);
    expect(splitCount('Echo! x12')).toEqual(['Echo!', 12]);
    expect(splitCount('x2')).toEqual(['x2', 1]);
  });
});

/** A warden: 96 px tall body, plate 110 px wide on top of the stack. */
const warden: LaneBox = { x: 400, y: 500, top: 500 - 96 - 4 - 3 - 11 - 11, bottom: 504, halfW: 56 };
const bodyTop = 500 - 96;

type Rect = { x0: number; y0: number; x1: number; y1: number };
const rectOf = (p: { x: number; y: number }, origin: [number, number], w: number, h: number): Rect => ({
  x0: p.x - origin[0] * w,
  y0: p.y - origin[1] * h,
  x1: p.x - origin[0] * w + w,
  y1: p.y - origin[1] * h + h,
});
const overlaps = (a: Rect, b: Rect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

describe('lane layout', () => {
  const body: Rect = { x0: warden.x - 48, y0: bodyTop, x1: warden.x + 48, y1: warden.y };
  const plate: Rect = { x0: warden.x - 55, y0: warden.top, x1: warden.x + 55, y1: warden.top + 11 };
  const calloutH = 11;

  it('puts the callout right above the plate, centred', () => {
    const p = laneSpot('callout', false, warden, { row: 0, dx: 0, lift: 0 }, 0);
    const r = rectOf(p, laneOrigin('callout', false), 70, calloutH);
    expect(r.y1).toBe(warden.top - 1);
    expect(overlaps(r, plate)).toBe(false);
    expect(overlaps(r, body)).toBe(false);
  });

  it('fans numbers out and stacks them upward, above the callout, never on the plate or the body', () => {
    const lift = warden.y - (warden.top - 1 - (calloutH + 1));
    const seen = new Set<string>();
    for (let row = 0; row < LANE.maxRows; row++)
      for (const dx of LANE.fan) {
        for (const age of [0, 100, 300, 600]) {
          const p = laneSpot('damage', false, warden, { row, dx, lift }, laneRise(LANE_TIMING.damage, age));
          const r = rectOf(p, laneOrigin('damage', false), 18, 11);
          expect(overlaps(r, body)).toBe(false);
          expect(overlaps(r, plate)).toBe(false);
          expect(r.y1).toBeLessThanOrEqual(warden.top - 1 - calloutH);
          seen.add(`${p.x},${row}`);
        }
      }
    // consecutive rows are a full text row apart
    const a = laneSpot('damage', false, warden, { row: 0, dx: 0, lift }, 0);
    const b = laneSpot('damage', false, warden, { row: 1, dx: 0, lift }, 0);
    expect(a.y - b.y).toBe(LANE.row);
    expect(new Set(LANE.fan).size).toBe(LANE.fan.length);
  });

  it('keeps words and heals beside the plate, on opposite sides', () => {
    const w = laneSpot('status', false, warden, { row: 0, dx: 0, lift: 0 }, 0);
    const h = laneSpot('heal', false, warden, { row: 0, dx: 0, lift: 0 }, 0);
    const wr = rectOf(w, laneOrigin('status', false), 40, 11);
    const hr = rectOf(h, laneOrigin('heal', false), 20, 11);
    expect(overlaps(wr, plate)).toBe(false);
    expect(overlaps(hr, plate)).toBe(false);
    expect(overlaps(wr, body)).toBe(false);
    expect(overlaps(hr, body)).toBe(false);
    expect(wr.x1).toBeLessThan(warden.x);
    expect(hr.x0).toBeGreaterThan(warden.x);
  });

  it('hangs below-the-feet callouts under the feet and stacks them downward', () => {
    const p0 = laneSpot('callout', true, warden, { row: 0, dx: 0, lift: 0 }, 0);
    const p1 = laneSpot('status', true, warden, { row: 1, dx: 0, lift: 0 }, 0);
    expect(laneOrigin('callout', true)).toEqual([0.5, 0]);
    expect(p0.y).toBeGreaterThan(warden.y);
    expect(p1.y - p0.y).toBe(LANE.row);
  });

  it('keeps numbers and crits in one column, a crit lifting two rows', () => {
    expect(sameColumn('damage', 'crit')).toBe(true);
    expect(sameColumn('crit', 'damage')).toBe(true);
    expect(sameColumn('damage', 'status')).toBe(false);
    expect(sameColumn('heal', 'heal')).toBe(true);
    expect(laneSpan('crit')).toBe(2);
    expect(laneSpan('damage')).toBe(1);
  });

  it('rises by whole pixels and fades out by the end of its life', () => {
    for (const t of Object.values(LANE_TIMING)) {
      for (let age = 0; age <= t.life; age += 25) expect(Number.isInteger(laneRise(t, age))).toBe(true);
      expect(laneRise(t, t.riseMs * 2)).toBe(t.rise);
      expect(laneAlpha(t, 0)).toBe(1);
      expect(laneAlpha(t, t.life)).toBe(0);
      expect(t.fadeAt).toBeLessThan(t.life);
    }
    // a callout outlives numbers (it names what is coming)
    expect(LANE_TIMING.callout.life).toBeGreaterThan(LANE_TIMING.damage.life);
  });
});

describe('side-step off other bodies', () => {
  const wardenBody = { x0: 360, y0: 404, x1: 440, y1: 500 };
  it("moves the player's text off a warden's body toward the player's side", () => {
    // the player stands at x 350, in front of the warden's left flank: its callout box overlaps the body
    const r = { x0: 330, y0: 440, x1: 370, y1: 451 };
    const dx = sideStep(r, [wardenBody], 350);
    expect(dx).toBe(360 - 370 - 1);
    expect(r.x1 + dx).toBeLessThanOrEqual(wardenBody.x0);
    // on the right flank it goes right
    const r2 = { x0: 430, y0: 440, x1: 470, y1: 451 };
    expect(r2.x0 + sideStep(r2, [wardenBody], 450)).toBeGreaterThanOrEqual(wardenBody.x1);
  });
  it('leaves text alone when nothing is under it, or when clearing would fling it away', () => {
    expect(sideStep({ x0: 300, y0: 300, x1: 330, y1: 311 }, [wardenBody], 315)).toBe(0);
    // dead centre over a wide body: more than 48 px to clear
    expect(sideStep({ x0: 385, y0: 440, x1: 415, y1: 451 }, [wardenBody], 400)).toBe(0);
  });
  it('clears two neighbouring bodies in one go', () => {
    const a = { x0: 300, y0: 400, x1: 330, y1: 500 };
    const b = { x0: 330, y0: 400, x1: 350, y1: 500 };
    const r = { x0: 335, y0: 420, x1: 355, y1: 431 };
    const dx = sideStep(r, [a, b], 360);
    expect(r.x0 + dx).toBeGreaterThanOrEqual(350);
  });
});

describe('stacking (newest at the base, older strings pushed up)', () => {
  const H = 12;
  /** A string `w` wide centred on `x`, its natural bottom at `y1`. */
  const item = (x: number, y1: number, w = 14, push = 0): StackItem => ({ x0: x - w / 2, x1: x + w / 2, y1, h: H, push });
  const box = (it: StackItem, push: number) => ({ x0: it.x0, x1: it.x1, y0: it.y1 - push - it.h, y1: it.y1 - push });
  const clear = (items: StackItem[], pushes: number[]) => {
    for (let i = 0; i < items.length; i++)
      for (let j = i + 1; j < items.length; j++) {
        const a = box(items[i], pushes[i]);
        const b = box(items[j], pushes[j]);
        const xs = a.x0 < b.x1 + 1 && b.x0 < a.x1 + 1;
        const ys = a.y0 < b.y1 + 1 && b.y0 < a.y1 + 1;
        if (xs && ys) return false;
      }
    return true;
  };

  it('pushes an older number that a newer one would touch right above it, with 1 px air', () => {
    // the ease-out rise let a newer number catch up with an older one in the same spot
    const items = [item(400, 300), item(402, 296)];
    const p = stackPush(items);
    expect(p[0]).toBe(0);
    expect(items[1].y1 - p[1]).toBe(300 - H - 1);
    expect(clear(items, p)).toBe(true);
  });

  it('leaves strings alone that are already clear (side by side, or above)', () => {
    expect(stackPush([item(400, 300), item(430, 300)])).toEqual([0, 0]);
    expect(stackPush([item(400, 300), item(400, 280)])).toEqual([0, 0]);
    // wholly below a newer one (a world message far down the screen): never flung above it
    expect(stackPush([item(400, 100), item(400, 300)])).toEqual([0, 0]);
  });

  it('settles a burst into one clear column, every string above the floor', () => {
    const items = Array.from({ length: 6 }, (_, i) => item(400 + ((i * 5) % 9) - 4, 300 - i));
    const p = stackPush(items, 296);
    expect(clear(items, p)).toBe(true);
    for (let i = 0; i < items.length; i++) expect(items[i].y1 - p[i]).toBeLessThanOrEqual(296);
    for (const v of p) expect(Number.isInteger(v)).toBe(true);
    // the column grows upward in age order
    for (let i = 1; i < items.length; i++) expect(items[i].y1 - p[i]).toBeLessThan(items[i - 1].y1 - p[i - 1]);
  });

  it('keeps a crit (taller) and a small number apart and never lets a push shrink', () => {
    const crit: StackItem = { x0: 390, x1: 412, y1: 300, h: 21, push: 0 };
    const small = item(404, 297, 8, 30);
    const p = stackPush([crit, small]);
    expect(p[1]).toBeGreaterThanOrEqual(30);
    expect(clear([crit, small], p)).toBe(true);
  });

  it('clears a second newer string it lands on after the first push', () => {
    // newest at the base, a crit already pushed above it, the oldest touching the newest
    const newest = item(400, 300);
    const crit: StackItem = { x0: 392, x1: 408, y1: 300, h: 21, push: 13 };
    const oldest = item(400, 299);
    const p = stackPush([newest, crit, oldest]);
    expect(clear([newest, crit, oldest], p)).toBe(true);
  });

  it('caps the column about maxRows high (pushed past it, a string fades early)', () => {
    expect(STACK_MAX_PUSH).toBe(LANE.maxRows * LANE.row);
  });

  it('lifts a callout by whole rows (clear of a neighbour plate)', () => {
    const a = laneSpot('callout', false, warden, { row: 0, dx: 0, lift: 0 }, 0);
    const b = laneSpot('callout', false, warden, { row: 2, dx: 0, lift: 0 }, 0);
    expect(a.y - b.y).toBe(2 * LANE.row);
  });
});
