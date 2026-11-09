// Actors lane: world text lanes (src/game/entities/lanes.ts, used by render/text.ts WorldText) — what goes where over a
// fight, and that nothing lands on the plate or the body.
import { describe, expect, it } from 'vitest';
import {
  LANE,
  LANE_TIMING,
  type LaneBox,
  floatKind,
  floatRole,
  freeRow,
  laneAlpha,
  laneOrigin,
  laneRise,
  laneSpan,
  laneSpot,
  sameColumn,
  sideStep,
  splitCount,
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

  it('frees rows bottom-up and caps the stack', () => {
    expect(freeRow(new Set())).toBe(0);
    expect(freeRow(new Set([0]))).toBe(1);
    expect(freeRow(new Set([1]))).toBe(0);
    expect(freeRow(new Set([0, 1, 2, 3, 4, 5]))).toBe(LANE.maxRows - 1);
  });

  it('keeps numbers and crits in one column, a crit taking two rows', () => {
    expect(sameColumn('damage', 'crit')).toBe(true);
    expect(sameColumn('crit', 'damage')).toBe(true);
    expect(sameColumn('damage', 'status')).toBe(false);
    expect(sameColumn('heal', 'heal')).toBe(true);
    expect(laneSpan('crit')).toBe(2);
    expect(laneSpan('damage')).toBe(1);
    // a crit over a number at row 0 goes to rows 1-2; a number after that crit goes to row 3
    expect(freeRow(new Set([0]), 2)).toBe(1);
    expect(freeRow(new Set([0, 1, 2]))).toBe(3);
    // a crit needs two free rows in a row
    expect(freeRow(new Set([1]), 2)).toBe(2);
    expect(freeRow(new Set([0, 1, 2, 3, 4]), 2)).toBe(LANE.maxRows - 2);
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
