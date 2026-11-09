// Light lane (docs/QUALITY-PLAN.md §10): OmniGrade's pure parts — the per-biome 16³ LUTs generated in code, the CPU
// reference of the shader's lookup (the browser check compares GPU pixels against it), the low-HP desaturation and
// the ungraded depth band. "Strength tuned so the art keeps its palette": the art-direction palette anchors move by
// a bounded amount and keep their hue family under every look.
import { describe, expect, it } from 'vitest';
import type { Biome } from '../src/core/world/types';
import {
  applyLut,
  bakeLut,
  BIOME_LOOK,
  DESAT_MAX,
  GRADE_LOOKS,
  type GradeLookId,
  gradeColor,
  gradeEnabled,
  gradeSettings,
  LOW_HP,
  LUT_H,
  LUT_SIZE,
  LUT_W,
  lookFor,
  lowHpDesat,
  onGradeChange,
  setGradeEnabled,
  setGradeStrength,
  UNGRADED_MIN,
} from '../src/game/render/grade';
import { DEPTH } from '../src/game/render/depths';

const hex = (s: string): [number, number, number] => [parseInt(s.slice(1, 3), 16) / 255, parseInt(s.slice(3, 5), 16) / 255, parseInt(s.slice(5, 7), 16) / 255];
const LOOKS = Object.keys(GRADE_LOOKS).filter((k) => k !== 'identity') as GradeLookId[];

// docs/ART-DIRECTION.md §2 anchors, with the channel that must stay dominant (null: a neutral, no hue to keep).
const PALETTE: [string, 'r' | 'g' | 'b' | null][] = [
  ['#24180f', null],
  ['#3f5a26', 'g'],
  ['#56772f', 'g'],
  ['#86a64a', 'g'],
  ['#a2bd62', 'g'],
  ['#7a6446', 'r'],
  ['#ad9a74', 'r'],
  ['#3d6630', 'g'],
  ['#74a655', 'g'],
  ['#5c3d22', 'r'],
  ['#9c6d3e', 'r'],
  ['#4a4d55', null],
  ['#a9adb3', null],
  ['#25507a', 'b'],
  ['#2f6fa3', 'b'],
  ['#8cc6e6', 'b'],
  ['#b8323a', 'r'],
  ['#e0788a', 'r'],
  ['#efe6c8', null],
  ['#8a6cc0', 'b'],
  ['#d8433f', 'r'],
  ['#3f7fd8', 'b'],
  ['#e9c46a', 'r'],
];

describe('LUTs generated in code', () => {
  it('bakes a 16³ strip (16 slices of 16×16 side by side), opaque', () => {
    const lut = bakeLut(GRADE_LOOKS.meadow);
    expect([LUT_W, LUT_H]).toEqual([LUT_SIZE * LUT_SIZE, LUT_SIZE]);
    expect(lut.length).toBe(LUT_W * LUT_H * 4);
    for (let i = 3; i < lut.length; i += 4) expect(lut[i]).toBe(255);
  });

  it('the identity look bakes the identity grid, and the lookup returns its input', () => {
    const lut = bakeLut(GRADE_LOOKS.identity);
    for (let g = 0; g < LUT_SIZE; g++)
      for (let b = 0; b < LUT_SIZE; b++)
        for (let r = 0; r < LUT_SIZE; r++) {
          const i = (g * LUT_W + b * LUT_SIZE + r) * 4;
          expect([lut[i], lut[i + 1], lut[i + 2]]).toEqual([r, g, b].map((v) => Math.round((v / 15) * 255)));
        }
    for (const c of [[0.13, 0.52, 0.91], [0.5, 0.5, 0.5], [1, 0, 0.33]] as [number, number, number][]) {
      const out = applyLut(lut, 1, ...c);
      for (let k = 0; k < 3; k++) expect(Math.abs(out[k] - c[k])).toBeLessThan(1 / 255);
    }
  });

  it('every biome has one of the seven looks, and every look is used', () => {
    const biomes: Biome[] = ['meadow', 'lake', 'hill', 'quarry', 'grove', 'ember', 'plateau', 'town', 'cave', 'crypt', 'glade', 'frost', 'basalt', 'storm', 'dusk'];
    for (const b of biomes) expect(LOOKS, b).toContain(BIOME_LOOK[b]);
    expect(new Set(Object.values(BIOME_LOOK))).toEqual(new Set(['meadow', 'lake', 'forest', 'ember', 'storm', 'crypt', 'dusk']));
    expect(lookFor('nowhere')).toBe('meadow');
  });

  it('matches the trilinear lookup at the LUT entries exactly (the shader samples entry centres)', () => {
    for (const id of LOOKS) {
      const look = GRADE_LOOKS[id];
      const lut = bakeLut(look);
      for (const [r, g, b] of [[0, 0, 0], [15, 15, 15], [3, 9, 12], [10, 4, 1]]) {
        const want = gradeColor(look, r / 15, g / 15, b / 15);
        const got = applyLut(lut, 1, r / 15, g / 15, b / 15);
        for (let k = 0; k < 3; k++) expect(Math.abs(got[k] - want[k]), `${id} ${r},${g},${b}`).toBeLessThanOrEqual(0.5 / 255 + 1e-9);
      }
    }
  });
});

describe('the art keeps its palette', () => {
  for (const id of LOOKS) {
    it(`${id}: anchors move a little and keep their hue; black stays dark, white stays light, greys stay ordered`, () => {
      const look = GRADE_LOOKS[id];
      expect(look.strength).toBeGreaterThan(0.4);
      expect(look.strength).toBeLessThanOrEqual(0.8);
      expect(look.vignette).toBeLessThanOrEqual(0.25);
      const lut = bakeLut(look);
      for (const [h, dom] of PALETTE) {
        const src = hex(h);
        const out = applyLut(lut, look.strength, ...src);
        for (let k = 0; k < 3; k++) expect(Math.abs(out[k] - src[k]) * 255, `${id} ${h} ch${k}`).toBeLessThanOrEqual(26);
        if (dom) {
          const i = { r: 0, g: 1, b: 2 }[dom];
          const others = [0, 1, 2].filter((k) => k !== i);
          // the dominant channel stays on top whenever it led by a clear margin
          for (const k of others) if (src[i] - src[k] > 0.06) expect(out[i], `${id} ${h}`).toBeGreaterThan(out[k]);
        }
      }
      const black = applyLut(lut, look.strength, 0, 0, 0);
      const white = applyLut(lut, look.strength, 1, 1, 1);
      for (let k = 0; k < 3; k++) {
        expect(black[k] * 255, `${id} black`).toBeLessThanOrEqual(16);
        expect(white[k] * 255, `${id} white`).toBeGreaterThanOrEqual(230);
      }
      let prev = -1;
      for (let v = 0; v <= 1.0001; v += 1 / 32) {
        const o = applyLut(lut, look.strength, v, v, v);
        const l = 0.299 * o[0] + 0.587 * o[1] + 0.114 * o[2];
        expect(l, `${id} grey ${v}`).toBeGreaterThan(prev);
        prev = l;
      }
    });
  }

  it('meadow leans toward the reference look (softer, a touch lighter and less yellow)', () => {
    // Measured on captures: our grass / road vs the reference's (docs/QUALITY-PLAN.md §10 tuning).
    const lut = bakeLut(GRADE_LOOKS.meadow);
    const s = GRADE_LOOKS.meadow.strength;
    const dist = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    for (const [ours, ref] of [
      [[114.5, 123.7, 71.5], [120.6, 129.1, 81.2]],
      [[145.2, 132.5, 101.2], [149, 133, 110]],
    ]) {
      const out = applyLut(lut, s, ours[0] / 255, ours[1] / 255, ours[2] / 255).map((v) => v * 255);
      expect(dist(out, ref)).toBeLessThan(dist(ours, ref) * 0.5);
    }
  });
});

describe('low-HP desaturation', () => {
  it('is off above LOW_HP and rises to DESAT_MAX at 0, monotonically', () => {
    expect(lowHpDesat(1)).toBe(0);
    expect(lowHpDesat(LOW_HP)).toBe(0);
    expect(lowHpDesat(null)).toBe(0);
    expect(lowHpDesat(Number.NaN)).toBe(0);
    expect(lowHpDesat(0)).toBeCloseTo(DESAT_MAX);
    expect(DESAT_MAX).toBeLessThanOrEqual(0.6); // the world stays readable at 1 HP
    let prev = -1;
    for (let s = 1; s >= 0; s -= 0.01) {
      const d = lowHpDesat(s);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe('ungraded band', () => {
  it('starts at the telegraph rims: rims, combat text and screen FX are never graded; the world, glow and light map are', () => {
    expect(UNGRADED_MIN).toBe(DEPTH.TELL_TOP);
    for (const d of [DEPTH.TELL_TOP, DEPTH.WORLD_TEXT, DEPTH.SCREEN_FX]) expect(d).toBeGreaterThanOrEqual(UNGRADED_MIN);
    for (const d of [DEPTH.GROUND, DEPTH.TELEGRAPH, DEPTH.FX_GLOW, DEPTH.NAME_TAG, DEPTH.DARKNESS, DEPTH.LIGHT, DEPTH.LIGHT_TOP]) expect(d).toBeLessThan(UNGRADED_MIN);
  });
});

describe('quality hook', () => {
  it('turns the grade on and off, tells listeners once per change, and clamps the QA strength', () => {
    const was = gradeEnabled();
    const calls: boolean[] = [];
    const off = onGradeChange((on) => calls.push(on));
    setGradeEnabled(false);
    setGradeEnabled(false);
    setGradeEnabled(true);
    off();
    expect(calls).toEqual([false, true]);
    setGradeEnabled(was);
    setGradeStrength(5);
    expect(gradeSettings.strength).toBe(2);
    setGradeStrength(-1);
    expect(gradeSettings.strength).toBe(0);
    setGradeStrength(Number.NaN);
    expect(gradeSettings.strength).toBe(1);
  });
});
