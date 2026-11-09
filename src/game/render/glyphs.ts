// The in-world pixel font (render lane; docs/QUALITY-PLAN.md §4): hand-authored glyphs in the spirit of Pixelify Sans
// (rounded corners, open counters, 1 px stems), cap height 7, x-height 5, descenders 2. PURE (no Phaser / DOM): the
// glyph masks, the three baked tiers (small / bold / big), the outline pass and the text sanitiser that keeps emoji
// and other glyphs the font lacks out of the world. render/fonts.ts turns these masks into Phaser bitmap fonts.
//
// Why hand-authored: Pixelify Sans is not drawn on a strict pixel grid (stems 101 units, counters 80), so a canvas
// rasterisation of it is never crisp at small sizes. These glyphs are crisp by construction.

/** Rows of a glyph cell: 0..6 cap height (baseline under row 6), 7..8 descenders. */
export const GLYPH_ROWS = 9;
/** Cap height in px (rows 0..6). */
export const CAP_HEIGHT = 7;
/** Outline colour of every in-world glyph (docs/ART-DIRECTION.md: outline, never pure black). */
export const FONT_OUTLINE = '#24180f';

/** [first row, rows joined by '|' ('#' = ink)]. */
type GlyphDef = readonly [top: number, rows: string];

const G: Record<string, GlyphDef> = {
  ' ': [0, '..'],
  // ---------------------------------------------------------------- uppercase (rows 0..6)
  A: [0, '.###.|#...#|#...#|#####|#...#|#...#|#...#'],
  B: [0, '####.|#...#|#...#|####.|#...#|#...#|####.'],
  C: [0, '.###.|#...#|#....|#....|#....|#...#|.###.'],
  D: [0, '####.|#...#|#...#|#...#|#...#|#...#|####.'],
  E: [0, '####|#...|#...|###.|#...|#...|####'],
  F: [0, '####|#...|#...|###.|#...|#...|#...'],
  G: [0, '.###.|#...#|#....|#.###|#...#|#...#|.###.'],
  H: [0, '#...#|#...#|#...#|#####|#...#|#...#|#...#'],
  I: [0, '###|.#.|.#.|.#.|.#.|.#.|###'],
  J: [0, '...#|...#|...#|...#|#..#|#..#|.##.'],
  K: [0, '#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#'],
  L: [0, '#...|#...|#...|#...|#...|#...|####'],
  M: [0, '#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#'],
  N: [0, '#...#|##..#|##..#|#.#.#|#..##|#..##|#...#'],
  O: [0, '.###.|#...#|#...#|#...#|#...#|#...#|.###.'],
  P: [0, '####.|#...#|#...#|####.|#....|#....|#....'],
  Q: [0, '.###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#'],
  R: [0, '####.|#...#|#...#|####.|#.#..|#..#.|#...#'],
  S: [0, '.###.|#...#|#....|.###.|....#|#...#|.###.'],
  T: [0, '#####|..#..|..#..|..#..|..#..|..#..|..#..'],
  U: [0, '#...#|#...#|#...#|#...#|#...#|#...#|.###.'],
  V: [0, '#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..'],
  W: [0, '#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#'],
  X: [0, '#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#'],
  Y: [0, '#...#|#...#|.#.#.|..#..|..#..|..#..|..#..'],
  Z: [0, '#####|....#|...#.|..#..|.#...|#....|#####'],
  // ---------------------------------------------------------------- lowercase (x-height rows 2..6)
  a: [2, '.##.|...#|.###|#..#|.###'],
  b: [0, '#...|#...|###.|#..#|#..#|#..#|###.'],
  c: [2, '.###|#...|#...|#...|.###'],
  d: [0, '...#|...#|.###|#..#|#..#|#..#|.###'],
  e: [2, '.##.|#..#|####|#...|.###'],
  f: [0, '.##|#..|###|#..|#..|#..|#..'],
  g: [2, '.###|#..#|#..#|#..#|.###|...#|.##.'],
  h: [0, '#...|#...|###.|#..#|#..#|#..#|#..#'],
  i: [0, '#|.|#|#|#|#|#'],
  j: [0, '.#|..|.#|.#|.#|.#|.#|.#|#.'],
  k: [0, '#...|#...|#..#|#.#.|##..|#.#.|#..#'],
  l: [0, '#.|#.|#.|#.|#.|#.|.#'],
  m: [2, '####.|#.#.#|#.#.#|#.#.#|#.#.#'],
  n: [2, '###.|#..#|#..#|#..#|#..#'],
  o: [2, '.##.|#..#|#..#|#..#|.##.'],
  p: [2, '###.|#..#|#..#|#..#|###.|#...|#...'],
  q: [2, '.###|#..#|#..#|#..#|.###|...#|...#'],
  r: [2, '#.##|##..|#...|#...|#...'],
  s: [2, '.###|#...|.##.|...#|###.'],
  t: [1, '.#.|###|.#.|.#.|.#.|..#'],
  u: [2, '#..#|#..#|#..#|#..#|.###'],
  v: [2, '#...#|#...#|.#.#.|.#.#.|..#..'],
  w: [2, '#...#|#...#|#.#.#|#.#.#|.#.#.'],
  x: [2, '#..#|#..#|.##.|#..#|#..#'],
  y: [2, '#..#|#..#|#..#|#..#|.###|...#|.##.'],
  z: [2, '####|...#|.##.|#...|####'],
  // ---------------------------------------------------------------- digits (rows 0..6)
  '0': [0, '.###.|#...#|#..##|#.#.#|##..#|#...#|.###.'],
  '1': [0, '.#.|##.|.#.|.#.|.#.|.#.|###'],
  '2': [0, '.###.|#...#|....#|..##.|.#...|#....|#####'],
  '3': [0, '.###.|#...#|....#|..##.|....#|#...#|.###.'],
  '4': [0, '...#.|..##.|.#.#.|#..#.|#####|...#.|...#.'],
  '5': [0, '#####|#....|####.|....#|....#|#...#|.###.'],
  '6': [0, '.###.|#....|#....|####.|#...#|#...#|.###.'],
  '7': [0, '#####|....#|...#.|..#..|..#..|..#..|..#..'],
  '8': [0, '.###.|#...#|#...#|.###.|#...#|#...#|.###.'],
  '9': [0, '.###.|#...#|#...#|.####|....#|....#|.###.'],
  // ---------------------------------------------------------------- punctuation
  '!': [0, '#|#|#|#|#|.|#'],
  '"': [0, '#.#|#.#'],
  '#': [1, '.#.#.|#####|.#.#.|#####|.#.#.'],
  $: [0, '..#..|.####|#.#..|.###.|..#.#|####.|..#..'],
  '%': [0, '##..#|##.#.|...#.|..#..|.#...|.#.##|#..##'],
  '&': [0, '.##..|#..#.|#.#..|.#...|#.#.#|#..#.|.##.#'],
  "'": [0, '#|#'],
  '(': [0, '.#|#.|#.|#.|#.|#.|.#'],
  ')': [0, '#.|.#|.#|.#|.#|.#|#.'],
  '*': [1, '#.#|.#.|#.#'],
  '+': [1, '..#..|..#..|#####|..#..|..#..'],
  ',': [6, '.#|#.'],
  '-': [3, '###'],
  '.': [6, '#'],
  '/': [0, '..#|..#|.#.|.#.|.#.|#..|#..'],
  ':': [2, '#|.|.|.|#'],
  ';': [2, '.#|..|..|..|.#|#.'],
  '<': [1, '..#|.#.|#..|.#.|..#'],
  '=': [2, '####|....|####'],
  '>': [1, '#..|.#.|..#|.#.|#..'],
  '?': [0, '.##.|#..#|...#|..#.|.#..|....|.#..'],
  '@': [0, '.###.|#...#|#.###|#.#.#|#.###|#....|.###.'],
  '[': [0, '##|#.|#.|#.|#.|#.|##'],
  '\\': [0, '#..|#..|.#.|.#.|.#.|..#|..#'],
  ']': [0, '##|.#|.#|.#|.#|.#|##'],
  '^': [0, '.#.|#.#'],
  _: [7, '####'],
  '`': [0, '#.|.#'],
  '{': [0, '.##|.#.|.#.|#..|.#.|.#.|.##'],
  '|': [0, '#|#|#|#|#|#|#|#'],
  '}': [0, '##.|.#.|.#.|..#|.#.|.#.|##.'],
  '~': [2, '.#.#|#.#.'],
  // ---------------------------------------------------------------- a few symbols the game's words use
  '·': [3, '#'],
  '…': [6, '#.#.#'],
  '×': [2, '#...#|.#.#.|..#..|.#.#.|#...#'],
  '↑': [0, '..#..|.###.|#.#.#|..#..|..#..|..#..|..#..'],
  '↓': [0, '..#..|..#..|..#..|..#..|#.#.#|.###.|..#..'],
  '→': [1, '..#..|...#.|#####|...#.|..#..'],
  '←': [1, '..#..|.#...|#####|.#...|..#..'],
  '★': [0, '..#..|..#..|#####|.###.|.###.|##.##|#...#'],
  '♥': [1, '##.##|#####|#####|.###.|..#..'],
};

/** Characters typed or pasted that have a direct look-alike glyph. */
const ALIAS: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '−': '-',
  '•': '·',
  '✕': '×',
  '✖': '×',
  '✗': '×',
  '☆': '★',
  '❤': '♥',
  ' ': ' ',
};

/** One glyph as a mask: `w` columns × GLYPH_ROWS rows, row-major, 1 = ink. */
export interface GlyphMask {
  ch: string;
  w: number;
  bits: Uint8Array;
}

let masks: Map<string, GlyphMask> | null = null;

/** Every authored glyph (built once). */
export function glyphMasks(): ReadonlyMap<string, GlyphMask> {
  if (masks) return masks;
  masks = new Map();
  for (const [ch, [top, rows]] of Object.entries(G)) {
    const lines = rows.split('|');
    const w = lines[0].length;
    const bits = new Uint8Array(w * GLYPH_ROWS);
    lines.forEach((line, r) => {
      if (line.length !== w) throw new Error(`glyph ${ch}: row ${r} is ${line.length} wide, expected ${w}`);
      if (top + r >= GLYPH_ROWS) throw new Error(`glyph ${ch}: row ${top + r} below the cell`);
      for (let x = 0; x < w; x++) if (line[x] === '#') bits[(top + r) * w + x] = 1;
    });
    masks.set(ch, { ch, w, bits });
  }
  return masks;
}

/** True when the pixel font can draw `ch` (after aliasing). */
export function hasGlyph(ch: string): boolean {
  return glyphMasks().has(ALIAS[ch] ?? ch);
}

/**
 * Makes `text` drawable by the pixel font: smart quotes / dashes become their plain look-alikes, accented letters fall
 * back to their base letter (é → e), and anything else the font lacks — emoji, arrows it has no glyph for, variation
 * selectors — is dropped instead of drawing a box. Spaces left over are collapsed; line breaks are kept.
 */
export function pixelSafe(text: string): string {
  const gl = glyphMasks();
  const lines = text.split('\n').map((line) => {
    let out = '';
    for (const raw of line) {
      const ch = ALIAS[raw] ?? raw;
      if (gl.has(ch)) {
        out += ch;
        continue;
      }
      // accented latin → base letter(s)
      const base = ch.normalize('NFD').replace(/[̀-ͯ]/g, '');
      if (base !== ch) for (const b of base) if (gl.has(b)) out += b;
    }
    return out.replace(/ {2,}/g, ' ').trim();
  });
  return lines.join('\n');
}

// ------------------------------------------------------------------ baked tiers

/** The three in-world font tiers: small labels, bold numbers, big emphasis (crits, level up). */
export type FontTier = 'small' | 'bold' | 'big';

/** Requested size in px (the v2 Text sizes callers pass) → the tier that reads like it. */
export function tierFor(size: number, bold = false): FontTier {
  if (size >= 16) return 'big';
  if (size >= 13 || bold) return 'bold';
  return 'small';
}

/** A glyph cell in a tier: ink 1, outline 2, empty 0; the pen advances `adv` px. */
export interface TierGlyph {
  ch: string;
  /** Cell size including the 1 px outline on every side. */
  w: number;
  h: number;
  /** Pen advance in px (the next glyph's outline overlaps this one's by design). */
  adv: number;
  cells: Uint8Array;
}

export interface TierMetrics {
  /** Line height in px (BitmapText lineHeight). */
  lineHeight: number;
  /** Cell height (every glyph cell is this tall). */
  cellH: number;
  /** Pixel scale of the ink (1 or 2). */
  scale: number;
}

export function tierMetrics(tier: FontTier): TierMetrics {
  const scale = tier === 'big' ? 2 : 1;
  const cellH = GLYPH_ROWS * scale + 2;
  return { scale, cellH, lineHeight: cellH + 1 };
}

/** Builds one tier's glyph cells: ink scaled (big) or widened by 1 px (bold), then a 1 px 8-neighbour outline. */
export function tierGlyph(mask: GlyphMask, tier: FontTier): TierGlyph {
  const { scale, cellH } = tierMetrics(tier);
  const boldW = tier === 'bold' && mask.ch !== ' ' ? 1 : 0;
  const inkW = mask.w * scale + boldW;
  const w = inkW + 2;
  const h = cellH;
  const cells = new Uint8Array(w * h);
  for (let y = 0; y < GLYPH_ROWS; y++)
    for (let x = 0; x < mask.w; x++) {
      if (!mask.bits[y * mask.w + x]) continue;
      for (let sy = 0; sy < scale; sy++)
        for (let sx = 0; sx < scale + boldW; sx++) cells[(1 + y * scale + sy) * w + 1 + x * scale + sx] = 1;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (cells[y * w + x]) continue;
      let near = false;
      for (let dy = -1; dy <= 1 && !near; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          const X = x + dx;
          const Y = y + dy;
          if (X >= 0 && Y >= 0 && X < w && Y < h && cells[Y * w + X] === 1) {
            near = true;
            break;
          }
        }
      if (near) cells[y * w + x] = 2;
    }
  return { ch: mask.ch, w, h, adv: inkW + (tier === 'big' ? 2 : 1), cells };
}

/** Atlas layout for one tier: every glyph placed in rows ≤ maxW px wide (1 px apart so nothing bleeds). */
export interface TierAtlas {
  tier: FontTier;
  width: number;
  height: number;
  glyphs: { g: TierGlyph; x: number; y: number }[];
  metrics: TierMetrics;
}

export function tierAtlas(tier: FontTier, maxW = 256): TierAtlas {
  const metrics = tierMetrics(tier);
  const glyphs: TierAtlas['glyphs'] = [];
  let x = 0;
  let y = 0;
  let width = 0;
  for (const m of glyphMasks().values()) {
    const g = tierGlyph(m, tier);
    if (x + g.w > maxW) {
      x = 0;
      y += metrics.cellH + 1;
    }
    glyphs.push({ g, x, y });
    width = Math.max(width, x + g.w);
    x += g.w + 1;
  }
  return { tier, width, height: y + metrics.cellH, glyphs, metrics };
}

/** Pixel width of `text` (one line, already pixelSafe) in a tier, including the outline. */
export function measurePixelText(text: string, tier: FontTier): number {
  const gl = glyphMasks();
  let w = 0;
  let last = 0;
  for (const ch of text) {
    const m = gl.get(ch);
    if (!m) continue;
    const g = tierGlyph(m, tier);
    last = g.w - g.adv;
    w += g.adv;
  }
  return w ? w + last : 0;
}

/** '#rgb' / '#rrggbb' / 'rgb(r,g,b)' → [r, g, b] (null when it is some other CSS colour). */
export function parseColor(color: string): [number, number, number] | null {
  const c = color.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(c);
  if (m) return [0, 1, 2].map((i) => parseInt(m![1][i] + m![1][i], 16)) as [number, number, number];
  m = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(c);
  if (m) return [0, 2, 4].map((i) => parseInt(m![1].slice(i, i + 2), 16)) as [number, number, number];
  m = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(c);
  if (m) return [+m[1], +m[2], +m[3]].map((v) => Math.min(255, v)) as [number, number, number];
  return null;
}
