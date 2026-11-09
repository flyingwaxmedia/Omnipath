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

/** Which rows of a stacked list fit above `limit` (CSS px): rows are [top, bottom] pairs; the first always shows. */
export function rowsThatFit(rows: readonly { top: number; bottom: number }[], limit: number): number {
  let n = 0;
  for (const r of rows) {
    if (n > 0 && r.bottom > limit) break;
    n++;
  }
  return n;
}
