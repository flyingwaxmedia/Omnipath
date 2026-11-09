import { describe, expect, it } from 'vitest';
import {
  CAP_HEIGHT,
  GLYPH_ROWS,
  glyphMasks,
  hasGlyph,
  measurePixelText,
  parseColor,
  pixelSafe,
  tierAtlas,
  tierFor,
  tierGlyph,
  tierMetrics,
} from '../src/game/render/glyphs';
import { artStep, chooseK, clampScroll, cssToArt, pixelScale, SHORT_SIDE_MAX, SHORT_SIDE_MIN } from '../src/game/render/pixelscale';
import { titleSvg } from '../src/game/render/splash';
import indexHtml from '../index.html?raw';

// Render lane (docs/INTEGRATION-v3.md §2.1, docs/QUALITY-PLAN.md §1 + §4): the pixel-perfect scale maths and the
// in-world pixel font are pure and tested here; the browser side is checked with window.omnipath.render.check().

describe('pixel scale (low-res backbuffer + integer upscale)', () => {
  const cases: [string, number, number, number, number][] = [
    // name, css w, css h, dpr, expected k
    ['phone portrait DPR 3', 390, 844, 3, 3],
    ['phone landscape DPR 3', 844, 390, 3, 3],
    ['iPad landscape DPR 2', 1180, 820, 2, 3],
    ['iPad portrait DPR 2', 820, 1180, 2, 3],
    ['phone DPR 2', 375, 667, 2, 2],
    ['desktop 1080p', 1920, 1080, 1, 2],
    ['phone DPR 1 (playtest)', 390, 844, 1, 1],
  ];
  for (const [name, w, h, dpr, k] of cases) {
    it(`${name}: k = ${k}, short side in range, canvas covers the screen`, () => {
      const s = pixelScale(w, h, dpr);
      expect(s.k).toBe(k);
      expect(Number.isInteger(s.k)).toBe(true);
      const short = Math.min(s.artW, s.artH);
      expect(short).toBeGreaterThanOrEqual(SHORT_SIDE_MIN);
      expect(short).toBeLessThanOrEqual(SHORT_SIDE_MAX);
      // canvas = ceil(device px / k): covers the viewport, overflowing by less than one art px
      expect(s.artW * s.k).toBeGreaterThanOrEqual(Math.round(w * dpr));
      expect(s.artW * s.k - Math.round(w * dpr)).toBeLessThan(s.k * 2);
      // whole CSS px (Chromium seams a canvas with a fractional CSS size)
      expect(Number.isInteger(s.cssW) && Number.isInteger(s.cssH)).toBe(true);
      expect(s.artH * s.k).toBeGreaterThanOrEqual(Math.round(h * dpr));
      // every art px is exactly k device px
      expect(s.cssW * dpr).toBeCloseTo(s.artW * s.k, 3);
      expect(s.cssPerArt).toBeCloseTo(k / dpr, 9);
    });
  }

  it('shows at least as much world as v2 on phones and iPads (ART-DIRECTION §7)', () => {
    // v2: zoom = clamp(short / 380, 1, 1.7) in CSS px → the short side showed short / zoom world px
    const v2 = (w: number, h: number) => Math.min(w, h) / Math.min(1.7, Math.max(1, Math.min(w, h) / 380));
    for (const [w, h, dpr] of [
      [390, 844, 3],
      [844, 390, 3],
      [1180, 820, 2],
    ] as const) {
      const s = pixelScale(w, h, dpr);
      expect(Math.min(s.artW, s.artH)).toBeGreaterThanOrEqual(Math.floor(v2(w, h)));
    }
  });

  it('a forced k wins (QA ?k=) and is clamped', () => {
    expect(chooseK(1170, 2)).toBe(2);
    expect(chooseK(1170, 0.4)).toBe(1);
    expect(chooseK(1170, 99)).toBe(8);
    expect(chooseK(0)).toBe(1);
  });

  it('snaps the art size so the CSS size is whole at integer DPRs', () => {
    expect(artStep(3, 2)).toBe(2);
    expect(artStep(3, 3)).toBe(1);
    expect(artStep(4, 2)).toBe(1);
    const s = pixelScale(1180, 820, 2);
    expect([s.artW, s.artH]).toEqual([788, 548]);
    expect([s.cssW, s.cssH]).toEqual([1182, 822]);
  });

  it('snaps at fractional DPRs too (Android 2.625 / 2.75 / 1.75, browser zoom 110 %): whole CSS px, exact k', () => {
    // 2.625 = 21/8: art × 2 × 8 / 21 is whole when art is a multiple of 21
    expect(artStep(2, 2.625)).toBe(21);
    expect(artStep(3, 2.625)).toBe(7);
    expect(artStep(3, 1.5)).toBe(1);
    expect(artStep(2, 1.75)).toBe(7);
    expect(artStep(2, Math.PI)).toBe(1); // no simple fraction: nothing to snap
    for (const [w, h, dpr] of [
      [411, 731, 2.625],
      [412, 915, 2.625],
      [393, 851, 2.75],
      [360, 780, 1.75],
      [1745, 982, 1.100000023841858],
    ] as const) {
      const s = pixelScale(w, h, dpr);
      expect(Number.isInteger(s.cssW) && Number.isInteger(s.cssH), `${w}x${h}@${dpr}`).toBe(true);
      expect(s.cssW * dpr).toBeCloseTo(s.artW * s.k, 3);
      expect(s.cssW).toBeGreaterThanOrEqual(w);
      expect(s.cssH).toBeGreaterThanOrEqual(h);
      // the cropped overflow stays small (< one step), and the visible viewport is reported
      expect(s.artW - (w * dpr) / s.k).toBeLessThan(artStep(s.k, dpr) + 1);
      expect([s.viewW, s.viewH]).toEqual([w, h]);
    }
  });

  it('keeps the k in use through small size changes (mobile address bars) instead of flipping the zoom', () => {
    // iPhone landscape, DPR 3: 390 CSS px tall with the bars hidden, ~340 with them shown
    const full = pixelScale(844, 390, 3);
    expect(full.k).toBe(3);
    expect(pixelScale(844, 340, 3, undefined, full.k).k).toBe(3);
    // fresh, the 340 px view would pick k = 2 (510 art px) — and keep it when the bars hide again
    const bars = pixelScale(844, 340, 3);
    expect(bars.k).toBe(2);
    expect(pixelScale(844, 390, 3, undefined, bars.k).k).toBe(2);
    // a big change still re-chooses (desktop window maximised: 1280×720 → 2560×1440)
    expect(pixelScale(2560, 1440, 1, undefined, pixelScale(1280, 720, 1).k).k).toBe(3);
    // a forced k always wins
    expect(pixelScale(844, 390, 3, 2, 3).k).toBe(2);
  });

  it('converts CSS px to art px', () => {
    const s = pixelScale(1180, 820, 2);
    expect(cssToArt(150, s)).toBeCloseTo(100, 9);
  });

  it('clamps and rounds the camera scroll to whole art px', () => {
    expect(clampScroll(500.4, 390, 0, 2000)).toBe(305);
    expect(clampScroll(10, 390, 0, 2000)).toBe(0);
    expect(clampScroll(5000, 390, -20, 1650)).toBe(1650);
    // a map narrower than the view (min > max) is centred
    expect(clampScroll(100, 800, 0, -160)).toBe(-80);
    for (const c of [0.5, 10.25, 99.75, 333.5]) expect(Number.isInteger(clampScroll(c, 391, -50, 999))).toBe(true);
  });
});

describe('in-world pixel font', () => {
  const gl = glyphMasks();

  it('covers digits, latin letters and ASCII punctuation', () => {
    for (let c = 32; c < 127; c++) expect(gl.has(String.fromCharCode(c)), `glyph ${String.fromCharCode(c)}`).toBe(true);
    for (const ch of '·…×↑↓→←★♥') expect(hasGlyph(ch)).toBe(true);
  });

  it('caps sit on the baseline (cap height 7) and descenders hang below it', () => {
    const rowsOf = (ch: string) => {
      const m = gl.get(ch)!;
      const rows: number[] = [];
      for (let y = 0; y < GLYPH_ROWS; y++) if (m.bits.slice(y * m.w, (y + 1) * m.w).some(Boolean)) rows.push(y);
      return rows;
    };
    for (const ch of 'ABHXZ0123456789') expect(rowsOf(ch)).toEqual([0, 1, 2, 3, 4, 5, 6].slice(0, CAP_HEIGHT));
    for (const ch of 'aceosxz') {
      const r = rowsOf(ch);
      expect(r[0]).toBe(2);
      expect(r[r.length - 1]).toBe(6);
    }
    for (const ch of 'gjpqy') expect(rowsOf(ch).at(-1)).toBe(8);
  });

  it('drops emoji and glyphs it lacks instead of drawing boxes; accents fall back to the base letter', () => {
    expect(pixelSafe('🔥 Fire Bolt R2')).toBe('Fire Bolt R2');
    expect(pixelSafe('💢 ENRAGED')).toBe('ENRAGED');
    expect(pixelSafe('↻ Reprise')).toBe('Reprise');
    expect(pixelSafe('ATK ↑')).toBe('ATK ↑');
    expect(pixelSafe('Zoë Ünal — “hi” ✕')).toBe('Zoe Unal - "hi" ×');
    expect(pixelSafe('Mirelle\nWaykeeper 👁')).toBe('Mirelle\nWaykeeper');
    expect(pixelSafe('🧭')).toBe('');
    for (const ch of pixelSafe('✨ Ünïcödé ⚔ 🗡 straße 😀')) expect(ch === '\n' || hasGlyph(ch)).toBe(true);
  });

  it('maps the v2 Text sizes to tiers', () => {
    expect(tierFor(10)).toBe('small');
    expect(tierFor(12)).toBe('small');
    expect(tierFor(11, true)).toBe('bold');
    expect(tierFor(14)).toBe('bold');
    expect(tierFor(15)).toBe('bold');
    expect(tierFor(17)).toBe('big');
    expect(tierFor(18)).toBe('big');
  });

  it('outlines every glyph with exactly 1 px and keeps ink inside the outline', () => {
    const bad: string[] = [];
    for (const tier of ['small', 'bold', 'big'] as const) {
      const { cellH, scale } = tierMetrics(tier);
      for (const m of gl.values()) {
        const g = tierGlyph(m, tier);
        const at = (x: number, y: number) => g.cells[y * g.w + x];
        if (g.h !== cellH) bad.push(`${tier} ${m.ch} height ${g.h}`);
        if (g.adv <= 0) bad.push(`${tier} ${m.ch} advance ${g.adv}`);
        if (tier === 'big' && g.w !== m.w * scale + 2) bad.push(`${tier} ${m.ch} width ${g.w}`);
        // the border ring of the cell never holds ink (room for the outline)
        for (let x = 0; x < g.w; x++) if (at(x, 0) === 1 || at(x, g.h - 1) === 1) bad.push(`${tier} ${m.ch} ink on the top/bottom edge`);
        for (let y = 0; y < g.h; y++) if (at(0, y) === 1 || at(g.w - 1, y) === 1) bad.push(`${tier} ${m.ch} ink on the side edge`);
        // every ink pixel's 8 neighbours are ink or outline (never empty)
        for (let y = 1; y < g.h - 1; y++)
          for (let x = 1; x < g.w - 1; x++) {
            if (at(x, y) !== 1) continue;
            for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (at(x + dx, y + dy) === 0) bad.push(`${tier} ${m.ch} unoutlined at ${x},${y}`);
          }
      }
    }
    expect(bad).toEqual([]);
  });

  it('packs each tier into a small atlas with no overlapping cells', () => {
    for (const tier of ['small', 'bold', 'big'] as const) {
      const a = tierAtlas(tier);
      expect(a.width).toBeLessThanOrEqual(256);
      expect(a.height).toBeLessThanOrEqual(256);
      expect(a.glyphs.length).toBe(gl.size);
      const rects = a.glyphs.map(({ g, x, y }) => ({ x, y, w: g.w, h: g.h }));
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++) {
          const p = rects[i];
          const q = rects[j];
          const overlap = p.x < q.x + q.w && q.x < p.x + p.w && p.y < q.y + q.h && q.y < p.y + p.h;
          expect(overlap).toBe(false);
        }
    }
  });

  it('measures text', () => {
    expect(measurePixelText('', 'small')).toBe(0);
    expect(measurePixelText('8', 'small')).toBe(7); // 5 ink + 2 outline
    expect(measurePixelText('88', 'small')).toBe(13); // second glyph's outline shares the gap column
    expect(measurePixelText('8', 'big')).toBe(12);
  });

  it('parses the colours callers pass', () => {
    expect(parseColor('#ffe9a0')).toEqual([255, 233, 160]);
    expect(parseColor('#fff')).toEqual([255, 255, 255]);
    expect(parseColor('rgb(10, 20, 300)')).toEqual([10, 20, 255]);
    expect(parseColor('gold')).toBeNull();
  });

  it('draws the splash title from the same glyphs as crisp merged runs', () => {
    const svg = titleSvg();
    expect(svg).toMatch(/^<svg class="boot-title"/);
    expect(svg).toContain('shape-rendering="crispEdges"');
    expect(svg).toContain('viewBox="0 0 48 11"');
    expect(svg.length).toBeLessThan(6000);
  });

  it('index.html shows the same title from the first paint (keep the inline copy in sync with titleSvg())', () => {
    const inline = /<svg class="boot-title"[\s\S]*?<\/svg>/.exec(indexHtml)?.[0];
    expect(inline).toBe(titleSvg().replace(/width="\d+" height="\d+"/, 'width="384" height="88"'));
  });
});
