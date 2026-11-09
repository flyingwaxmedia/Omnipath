// World text lanes (actors lane; pure — no Phaser, tested in node by tests/actors-lanes.test.ts). render/text.ts
// WorldText lays every floating string over an actor out with these rules so nothing piles up over a fight:
//
//        numbers (fan out ±, stack upward)          — damage, crits, damage taken, DoT ticks
//        callout (centred, one at a time)           — technique / combo names, rank-ups, "LEVEL 5!", "ENRAGED!", "!"
//   words ◂ name plate (fixed) ▸ heals                — "Echo!", "Resist", "Stunned!", "ATK ↑" | "+12"
//        HP bar / chevron
//        body                                       — never covered
//
// Repeated words / callouts on the same actor coalesce into "Text xN" instead of stacking. When a caller drops a
// callout under the feet (the head is under the top HUD), it goes under the feet / name tag instead. The player's text
// side-steps off the body of a foe it would cover (standing in front of a warden), and a foe's off the player's.

/** The lane a floating string goes in. */
export type FloatKind = 'damage' | 'crit' | 'heal' | 'status' | 'callout';

/** Short status words (the side lane); anything else that is not a number is a callout. */
const STATUS_WORDS = /^(echo!|interrupted!|resist|resisted|immune|miss|blocked|stunned!|frozen!|reprise|rested|resting|\+\d+ jumps?)$/i;

/** Which lane a string floats in, from its text and requested size (callers pass free text). */
export function floatKind(text: string, size: number): FloatKind {
  const t = text.trim();
  if (/^[-+]?\d+!?$/.test(t)) return t.startsWith('+') ? 'heal' : t.endsWith('!') || size >= 16 ? 'crit' : 'damage';
  if (STATUS_WORDS.test(t) || /[↑↓]/.test(t) || t.startsWith('×')) return 'status';
  return 'callout';
}

/** Whose string it is when two actors overlap: signed numbers and level / rank-ups are the player's (null = either). */
export function floatRole(text: string, kind: FloatKind): 'player' | 'foe' | null {
  const t = text.trim();
  if (kind === 'heal' || /^-\d/.test(t) || /★|^LEVEL\b/.test(t)) return 'player';
  if (kind === 'damage' || kind === 'crit') return 'foe';
  if (/^(stunned!|frozen!|reprise|rested|resting)$/i.test(t) || t.startsWith('×')) return 'player';
  if (/^(echo!|interrupted!|resist|resisted)$/i.test(t) || /[↑↓]/.test(t)) return 'foe';
  return null;
}

/** "Firestorm x3" → ["Firestorm", 3]; "Firestorm" → ["Firestorm", 1]. */
export function splitCount(text: string): [string, number] {
  const m = /^(.*\S) x(\d+)$/.exec(text);
  return m ? [m[1], Number(m[2])] : [text, 1];
}

/** Lane spacing (art px) and timing (ms). */
export const LANE = {
  /** Rows of a stack are this far apart (7 px digits + 1 px outline each side + 1 px air). */
  row: 10,
  /** A number keeps its row this long (it has risen about a row by then). */
  rowHoldMs: 300,
  /** Most rows a stack uses before it reuses the top one. */
  maxRows: 5,
  /** Horizontal fan of consecutive numbers on one actor (art px from the centre). */
  fan: [0, -8, 8, -13, 13, -4, 4, -11, 11] as readonly number[],
  /** Gap between the side lanes and the plate / body. */
  sideGap: 3,
  /** Side words sit level with the plate: their bottom is this far under the stack top. */
  sideDrop: 9,
} as const;

export interface LaneTiming {
  /** Rise (art px) over `riseMs`, ease-out. */
  rise: number;
  riseMs: number;
  /** Fades from `fadeAt` to `life` (ms after it appeared). */
  fadeAt: number;
  life: number;
}

export const LANE_TIMING: Readonly<Record<FloatKind | 'free', LaneTiming>> = {
  damage: { rise: 14, riseMs: 450, fadeAt: 500, life: 850 },
  crit: { rise: 18, riseMs: 500, fadeAt: 650, life: 1050 },
  heal: { rise: 8, riseMs: 450, fadeAt: 650, life: 1000 },
  status: { rise: 6, riseMs: 400, fadeAt: 750, life: 1100 },
  callout: { rise: 2, riseMs: 150, fadeAt: 1100, life: 1400 },
  free: { rise: 26, riseMs: 300, fadeAt: 450, life: 850 },
};

/** Whole-pixel rise at `age` ms. */
export function laneRise(t: LaneTiming, age: number): number {
  const k = Math.min(1, Math.max(0, age) / t.riseMs);
  return Math.round(t.rise * (1 - (1 - k) * (1 - k)));
}

/** Alpha at `age` ms (1 until fadeAt, then linear to 0 at life). */
export function laneAlpha(t: LaneTiming, age: number): number {
  return age <= t.fadeAt ? 1 : Math.max(0, 1 - (age - t.fadeAt) / (t.life - t.fadeAt));
}

/** An actor's text geometry (world px, whole pixels). */
export interface LaneBox {
  /** Centre x, feet y. */
  x: number;
  y: number;
  /** Top of what stays fixed above the body (plate / chevron / HP bar / head / icons). */
  top: number;
  /** Under the feet / name tag. */
  bottom: number;
  /** Half width to keep clear at the plate's height. */
  halfW: number;
}

/** An axis-aligned box (world px): x0/y0 inclusive top-left, x1/y1 exclusive bottom-right. */
export interface LaneRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const hits = (a: LaneRect, b: LaneRect) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

/**
 * Horizontal whole-pixel shift that moves text box `r` off every body in `bodies` it overlaps, toward the side its own
 * actor (centre x `ax`) is on. 0 when it overlaps nothing, or when clearing would take more than `max` px (the text
 * would drift away from its actor: it stays put).
 */
export function sideStep(r: LaneRect, bodies: readonly LaneRect[], ax: number, max = 48): number {
  let dx = 0;
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const b of bodies) {
      const m = { x0: r.x0 + dx, y0: r.y0, x1: r.x1 + dx, y1: r.y1 };
      if (!hits(m, b)) continue;
      dx += ax < (b.x0 + b.x1) / 2 ? b.x0 - m.x1 - 1 : b.x1 - m.x0 + 1;
      moved = true;
    }
    if (!moved) return Math.abs(dx) > max ? 0 : Math.round(dx);
  }
  return 0;
}

/** Stack rows a string takes: crits (the big font) take two. */
export function laneSpan(kind: FloatKind): number {
  return kind === 'crit' ? 2 : 1;
}

/** Numbers and crits share one column (one set of rows); every other lane stacks on its own. */
export function sameColumn(a: FloatKind | 'free', b: FloatKind | 'free'): boolean {
  const num = (k: FloatKind | 'free') => k === 'damage' || k === 'crit';
  return a === b || (num(a) && num(b));
}

/** The lowest stack row with `span` rows free of young mates (capped so the stack stays maxRows high). */
export function freeRow(held: ReadonlySet<number>, span = 1): number {
  const last = LANE.maxRows - span;
  for (let row = 0; row < last; row++) {
    let ok = true;
    for (let k = 0; k < span && ok; k++) ok = !held.has(row + k);
    if (ok) return row;
  }
  return last;
}

/** Text origin per lane (Phaser setOrigin): numbers / callouts centred on their bottom, words right-aligned left of the
 *  plate, heals left-aligned right of it, below-the-feet text hangs from its top. */
export function laneOrigin(kind: FloatKind | 'free', below: boolean): [number, number] {
  if (kind === 'free') return [0.5, 0.5];
  if (below) return [0.5, 0];
  if (kind === 'status') return [1, 1];
  if (kind === 'heal') return [0, 1];
  return [0.5, 1];
}

/**
 * Where a floater's origin goes now. `lift`: a number's spawn height above the feet (the stack top, above a callout
 * when one was up); `dx`: its fan offset plus any side-step; `row`: its stack row; `up`: its current rise.
 */
export function laneSpot(kind: FloatKind, below: boolean, a: LaneBox, f: { row: number; dx: number; lift: number }, up: number): { x: number; y: number } {
  if (below) return { x: a.x + f.dx, y: a.bottom + 1 + f.row * LANE.row };
  switch (kind) {
    case 'callout':
      return { x: a.x + f.dx, y: a.top - 1 - up };
    case 'status':
    case 'heal': {
      const side = a.halfW + LANE.sideGap;
      return { x: (kind === 'status' ? a.x - side : a.x + side) + f.dx, y: a.top + LANE.sideDrop - f.row * LANE.row - up };
    }
    default:
      return { x: a.x + f.dx, y: a.y - f.lift - f.row * LANE.row - up };
  }
}
