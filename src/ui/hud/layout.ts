// HUD layout maths (HUD lane; docs/CLIENT-v3.md §2). Pure functions only — no DOM, no Phaser — so they run in the
// node test environment (tests/hud.test.ts). The Hud measures the screen and feeds these.

/** Long-press time (ms) that turns a press on a slot into "edit" (own slot → picker, class slot → skill card). */
export const HOLD_MS = 430;

/** A press that wanders further than this (CSS px) is a drag, not a long-press. */
export const HOLD_SLOP = 14;

/**
 * Largest CSS size ≤ `maxCss` at which `artPx` art pixels land on a whole number of device pixels (crisp pixel art at
 * any devicePixelRatio). Never below one art pixel per device pixel… unless that does not fit either, then the
 * smallest whole step (k = 1).
 */
export function fitSnap(maxCss: number, artPx: number, dpr: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const k = Math.max(1, Math.floor((maxCss * d + 1e-6) / artPx));
  return (k * artPx) / d;
}

/** Smallest viewport (HUD art px) the HUD layout fits: portrait (height ≥ width) and landscape. */
export const HUD_FIT = { portW: 360, portH: 560, landW: 640, landH: 340 } as const;

/** True when the HUD layout fits a viewport of `w` × `h` HUD art px. */
export function hudFits(w: number, h: number): boolean {
  return h >= w ? w >= HUD_FIT.portW && h >= HUD_FIT.portH : w >= HUD_FIT.landW && h >= HUD_FIT.landH;
}

export interface HudScale {
  /** CSS px per HUD art px (`--ui-px`): n / dpr, so one HUD art pixel is exactly n device pixels (crisp). */
  px: number;
  /** Device px per HUD art px. */
  n: number;
  /** The viewport in HUD art px. */
  w: number;
  h: number;
  /** False only for the last resort (nothing ≥ 1 CSS px fits; the smallest crisp scale ≥ 1 CSS px is used). */
  fits: boolean;
}

/**
 * The HUD's pixel size. The world draws `k` device px per art px; the HUD draws its art the same size (n = k, so
 * `--ui-px` = k / dpr CSS px) when its layout fits the screen at that size, else the largest n < k that fits. n / dpr
 * never drops below 1 CSS px: every HUD touch target is ≥ 44 art px, so it stays ≥ 44 CSS px. Re-evaluated on every
 * resize / orientation / DPR change.
 */
export function hudScale(cssW: number, cssH: number, dpr: number, k: number): HudScale {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  const top = Math.max(1, Math.round(k) || 1);
  const minN = Math.max(1, Math.ceil(d - 1e-6));
  const at = (n: number): HudScale => {
    const px = n / d;
    const w = cssW / px;
    const h = cssH / px;
    return { px, n, w, h, fits: hudFits(w, h) };
  };
  for (let n = top; n >= minN; n--) {
    const s = at(n);
    if (s.fits) return s;
  }
  return at(minN);
}

/** The screen-size variants of the HUD (classes on #hud-root), measured in HUD art px. */
export interface HudLayoutClasses {
  /** Portrait phone layout: two rows of buttons and slots, folded Pursuits. */
  port: boolean;
  /** Very narrow portrait (360 / 375 art px). */
  narrow: boolean;
  /** Short landscape: one tight row of everything. */
  short: boolean;
  /** Very large screens. */
  big: boolean;
}

export function hudLayoutClasses(w: number, h: number): HudLayoutClasses {
  const portrait = h >= w;
  return { port: portrait && w <= 599, narrow: portrait && w <= 379, short: h <= 499, big: w >= 1360 && h >= 820 };
}

/** How many slots go in each row of the skill bar: one row, or two even rows (portrait phones: 8 → 4 + 4). */
export function barRows(n: number, twoRows: boolean): number[] {
  if (n <= 0) return [];
  if (!twoRows || n <= 4) return [n];
  const top = Math.ceil(n / 2);
  return [top, n - top];
}

/** How the skill bar is laid out: its rows, the slot size (CSS px) and whether the rows follow the two groups. */
export interface BarPlan {
  rows: number[];
  slot: number;
  /** Row 1 = the class slots, row 2 = your slots (centred under them, from grid column `ownCol`). */
  split: boolean;
  ownCol: number;
}

/**
 * The bar's rows. One row unless `twoRows` (portrait). Two rows follow the groups when they can: the class slots on
 * row 1 and your slots on row 2 (5 + 3), so the two kinds never share a row — the slots shrink to fit `room` (CSS px
 * left of the attack cluster) but never below `minSlot` (the touch-target floor), and stay whole multiples of `unit`
 * (one HUD art px). If that does not fit (very narrow phones) or there is no class, two even rows (barRows).
 */
export function barPlan(o: {
  n: number;
  classSlots: number;
  twoRows: boolean;
  room: number;
  slot: number;
  minSlot: number;
  gap: number;
  unit?: number;
}): BarPlan {
  const even: BarPlan = { rows: barRows(o.n, o.twoRows), slot: o.slot, split: false, ownCol: 0 };
  const c = o.classSlots;
  const own = o.n - c;
  if (!o.twoRows || o.n <= 4 || c <= 0 || own <= 0) return even;
  const per = Math.max(c, own);
  const u = o.unit && o.unit > 0 ? o.unit : 1;
  const fit = Math.floor((o.room - (per - 1) * o.gap) / per / u + 1e-6) * u;
  const slot = Math.min(o.slot, fit);
  if (slot < o.minSlot - 1e-6) return even;
  return { rows: [c, own], slot, split: true, ownCol: c > own ? Math.floor((c - own) / 2) + 1 : 0 };
}

/** Bar width (CSS px) for `perRow` slots of size `slot` with `gap` between them. */
export function barWidth(perRow: number, slot: number, gap: number): number {
  return perRow <= 0 ? 0 : perRow * slot + (perRow - 1) * gap;
}

/**
 * Left edge (CSS px) of a box `w` wide that should sit as close to the screen centre as possible inside the free
 * range [lo, hi]. Returns null when it does not fit in the range.
 */
export function placeCentred(w: number, screenW: number, lo: number, hi: number): number | null {
  if (hi - lo < w) return null;
  const ideal = screenW / 2 - w / 2;
  return Math.max(lo, Math.min(hi - w, ideal));
}

/**
 * Left edge of the skill bar: centred on screen, but pushed left so it keeps `gap` px clear of the attack cluster
 * (`clusterLeft`), and never past the left margin.
 */
export function barLeft(barW: number, screenW: number, clusterLeft: number, gap: number, margin: number): number {
  const centred = (screenW - barW) / 2;
  const maxLeft = clusterLeft - gap - barW;
  return Math.max(margin, Math.min(centred, maxLeft));
}

/** "42.3%" — the EXP bar's text (one decimal; never shows 100% before the level-up lands). */
export function expPercent(exp: number, next: number): string {
  if (!(next > 0)) return '0%';
  const p = Math.max(0, Math.min(99.9, (100 * exp) / next));
  return `${(Math.floor(p * 10) / 10).toFixed(1)}%`;
}

/** Seconds left on a cooldown as the slot shows them: "12", "3", "0.6"; '' once it is (nearly) ready. */
export function cooldownText(remainMs: number): string {
  if (!(remainMs > 50)) return '';
  if (remainMs < 1000) return (Math.ceil(remainMs / 100) / 10).toFixed(1);
  return String(Math.ceil(remainMs / 1000));
}

/** Item counts on round buttons: "0".."99", then "99+". */
export function countText(n: number): string {
  const v = Math.max(0, Math.floor(n));
  return v > 99 ? '99+' : String(v);
}

/** Splits a trailing "3/8" (or "3 / 8") off a tracker line so the count can sit right-aligned. */
export function splitCount(line: string): { text: string; count: string } {
  const m = /^(.*?)[\s:]+(\d+\s*\/\s*\d+)\s*$/.exec(line);
  if (!m || !m[1].trim()) return { text: line, count: '' };
  return { text: m[1].trim(), count: m[2].replace(/\s+/g, '') };
}

/** Rows the open Pursuits tracker shows at most; the rest wait behind a "+N" button that opens the quest log. */
export const PURSUIT_ROWS = 2;

/** A screen box (CSS px). */
export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const live = (r: Rect | null | undefined): r is Rect => !!r && r.right - r.left >= 1 && r.bottom - r.top >= 1;

/**
 * The free span [lo, hi] (CSS px) of the horizontal band [top, bottom]: every box overlapping the band blocks it — a
 * box on the left half pushes `lo` past its right edge, one on the right half pulls `hi` before its left edge (`pad`
 * px clear of both).
 */
export function freeSpan(boxes: readonly (Rect | null | undefined)[], top: number, bottom: number, screenW: number, margin: number, pad: number): { lo: number; hi: number } {
  let lo = margin;
  let hi = screenW - margin;
  for (const b of boxes) {
    if (!live(b) || b.top >= bottom || b.bottom <= top) continue;
    if ((b.left + b.right) / 2 < screenW / 2) lo = Math.max(lo, b.right + pad);
    else hi = Math.min(hi, b.left - pad);
  }
  return { lo, hi };
}

/** What placeZone needs: the zone plate's sizes and the boxes around it (CSS px; `u` = one HUD art px). */
export interface ZoneInput {
  W: number;
  m: number;
  u: number;
  /** Zone plate width, and its width without the level band and the pill (`.compact`). */
  zw: number;
  zwCompact: number;
  zh: number;
  /** Room kept under the plate for the target plate (portrait: 0 — the plate fades and the target takes its place). */
  below: number;
  portrait: boolean;
  /** The player plate (its top row), the whole top-left block (plate + stat strip), the stat strip. */
  plate: Rect;
  me: Rect;
  stats?: Rect | null;
  menu: Rect;
  minimap?: Rect | null;
  pursuits?: Rect | null;
  quick?: Rect | null;
}

export interface ZonePlace {
  /** Left edge and top of the plate (CSS px). */
  x: number;
  top: number;
  /** Hide the level band and the pill. */
  compact: boolean;
  /** Portrait last resort: the plate is capped to this width (its name ellipsised). */
  maxW?: number;
}

/**
 * Where the zone plate goes (the target plate and, in landscape, the toasts stack under it): (1) centred in the top
 * row between the player plate and the buttons; (2) a row right under the buttons, between the top-left block and
 * the minimap — first in full, then compact; (3) portrait: still that band, capped (it never drops below the
 * Pursuits into the middle of the screen, where the player stands and every tap must reach the world); landscape:
 * below the top-left block, stepping past whatever sits beside it.
 */
export function placeZone(i: ZoneInput): ZonePlace {
  const { W, m, u } = i;
  const top1 = Math.max(m, i.menu.top);
  const x1 = placeCentred(i.zw, W, Math.max(i.plate.right, i.me.left + 8 * u) + 8 * u, i.menu.left - 8 * u);
  if (x1 !== null) return { x: x1, top: top1, compact: false };
  // Right under the buttons; then (a tall stat strip beside it) under the whole top-left block too.
  const side = [i.plate, i.stats, i.quick, i.minimap, i.pursuits];
  const tops = [i.menu.bottom + 6 * u, Math.max(i.me.bottom, i.menu.bottom) + 6 * u].filter((t, k, a) => a.indexOf(t) === k);
  let last = { top: tops[0], lo: m, hi: W - m };
  for (const top of tops) {
    const span = freeSpan(side, top, top + i.zh + i.below, W, m, 8 * u);
    last = { top, ...span };
    const x2 = placeCentred(i.zw, W, span.lo, span.hi);
    if (x2 !== null) return { x: x2, top, compact: false };
    const x3 = placeCentred(i.zwCompact, W, span.lo, span.hi);
    if (x3 !== null) return { x: x3, top, compact: true };
  }
  if (i.portrait) return { x: last.lo, top: last.top, compact: true, maxW: Math.max(44 * u, last.hi - last.lo) };
  let top = Math.max(i.me.bottom, i.menu.bottom) + 6 * u;
  const right = [i.minimap, i.pursuits].filter(live);
  let hi = Math.min(W - m, ...right.filter((r) => r.top < top + i.zh + 60 * u && r.bottom > top).map((r) => r.left - 8 * u));
  let x = placeCentred(i.zw, W, m, hi);
  // Still no room beside the minimap (long place names): step down past whatever sits in the plate's own row.
  for (let k = 0; k < 3 && x === null; k++) {
    const row = right.filter((r) => r.top < top + i.zh && r.bottom > top);
    if (!row.length) break;
    top = Math.min(...row.map((r) => r.bottom)) + 6 * u;
    hi = Math.min(W - m, ...right.filter((r) => r.top < top + i.zh && r.bottom > top).map((r) => r.left - 8 * u));
    x = placeCentred(i.zw, W, m, hi);
  }
  return { x: x ?? m, top, compact: false };
}

/**
 * HUD boxes that cross the middle band of the screen (`lo`..`hi` of its height, where the player stands): the names
 * of every box in `boxes` overlapping it. The layout keeps this empty in portrait (the skill bar, the attack cluster,
 * the left-edge quick buttons and the fading toasts / log are not passed in).
 */
export function crossesMiddle(boxes: Readonly<Record<string, Rect | null | undefined>>, H: number, lo = 0.4, hi = 0.6): string[] {
  return Object.entries(boxes)
    .filter(([, r]) => live(r) && r.top < H * hi && r.bottom > H * lo)
    .map(([k]) => k);
}

/** Which rows of a stacked list fit above `limit` (CSS px): rows are [top, bottom] pairs; the first always shows. */
export function rowsThatFit(rows: readonly { top: number; bottom: number }[], limit: number): number {
  let n = 0;
  for (const r of rows) {
    if (n > 0 && r.bottom > limit) break;
    n++;
  }
  return n;
}
