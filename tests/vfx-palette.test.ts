// Palette lint (docs/VFX.md §3.2, package P): family separation (CIEDE2000), distance from the world tiles, and the
// danger ramp under Machado-2009 colour-vision-deficiency simulation (severity 1).
import { describe, expect, it } from 'vitest';
import { RAMPS, hexToRgb } from '../src/game/vfx/ramps';
import { FAMILY_IDS, type FamilyId } from '../src/game/vfx/types';

const lin = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
const gam = (c: number) => { c = Math.max(0, Math.min(1, c)); return 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055); };
/** sRGB -> CIELAB (D65). */
function lab([r, g, b]: readonly number[]): number[] {
  const R = lin(r), G = lin(g), B = lin(b);
  let x = (0.4124 * R + 0.3576 * G + 0.1805 * B) / 0.95047, y = 0.2126 * R + 0.7152 * G + 0.0722 * B, z = (0.0193 * R + 0.1192 * G + 0.9505 * B) / 1.08883;
  const f = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : (24389 / 27 * t + 16) / 116);
  x = f(x); y = f(y); z = f(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
/** CIEDE2000 (Sharma, Wu & Dalal 2005). */
function de2000(a: number[], b: number[]): number {
  const [L1, a1, b1] = a, [L2, a2, b2] = b;
  const C1 = Math.hypot(a1, b1), C2 = Math.hypot(a2, b2), Cb = (C1 + C2) / 2;
  const G = 0.5 * (1 - Math.sqrt(Cb ** 7 / (Cb ** 7 + 25 ** 7)));
  const a1p = a1 * (1 + G), a2p = a2 * (1 + G);
  const C1p = Math.hypot(a1p, b1), C2p = Math.hypot(a2p, b2);
  const h = (x: number, y: number) => { if (x === 0 && y === 0) return 0; const v = (Math.atan2(y, x) * 180) / Math.PI; return v < 0 ? v + 360 : v; };
  const h1p = h(a1p, b1), h2p = h(a2p, b2);
  const dL = L2 - L1, dC = C2p - C1p;
  let dh = 0; if (C1p * C2p !== 0) { dh = h2p - h1p; if (dh > 180) dh -= 360; else if (dh < -180) dh += 360; }
  const dH = 2 * Math.sqrt(C1p * C2p) * Math.sin((dh * Math.PI) / 360);
  const Lb = (L1 + L2) / 2, Cbp = (C1p + C2p) / 2;
  let hb = h1p + h2p; if (C1p * C2p !== 0) { if (Math.abs(h1p - h2p) > 180) hb += h1p + h2p < 360 ? 360 : -360; hb /= 2; }
  const T = 1 - 0.17 * Math.cos(((hb - 30) * Math.PI) / 180) + 0.24 * Math.cos((2 * hb * Math.PI) / 180) + 0.32 * Math.cos(((3 * hb + 6) * Math.PI) / 180) - 0.2 * Math.cos(((4 * hb - 63) * Math.PI) / 180);
  const dTh = 30 * Math.exp(-(((hb - 275) / 25) ** 2));
  const RC = 2 * Math.sqrt(Cbp ** 7 / (Cbp ** 7 + 25 ** 7));
  const SL = 1 + (0.015 * (Lb - 50) ** 2) / Math.sqrt(20 + (Lb - 50) ** 2), SC = 1 + 0.045 * Cbp, SH = 1 + 0.015 * Cbp * T;
  const RT = -Math.sin((2 * dTh * Math.PI) / 180) * RC;
  return Math.sqrt((dL / SL) ** 2 + (dC / SC) ** 2 + (dH / SH) ** 2 + RT * (dC / SC) * (dH / SH));
}
/** Machado, Oliveira & Fernandes (2009) simulation matrices, severity 1.0, applied in linear RGB. */
const M: Record<string, number[][]> = {
  protan: [[0.152286, 1.052583, -0.204868], [0.114503, 0.786281, 0.099216], [-0.003882, -0.048116, 1.051998]],
  deutan: [[0.367322, 0.860646, -0.227968], [0.280085, 0.672501, 0.047413], [-0.01182, 0.04294, 0.968881]],
  tritan: [[1.255528, -0.076749, -0.178779], [-0.078411, 0.930809, 0.147602], [0.004733, 0.691367, 0.3039]],
};
const cvd = (rgb: readonly number[], m: number[][]) => { const l = rgb.map(lin); return m.map((row) => gam(row[0] * l[0] + row[1] * l[1] + row[2] * l[2])); };

const L = (f: FamilyId, i: number) => lab(hexToRgb(RAMPS[f].R[i]));

/** ART-DIRECTION world anchors (grass, dirt, foliage, wood, stone, water, foam, flowers). */
const WORLD = [
  '#3f5a26', '#56772f', '#6c8f3a', '#86a64a', '#a2bd62', '#7a6446', '#96805c', '#ad9a74', '#c2b18a', '#2b4a22', '#3d6630',
  '#548540', '#74a655', '#3d2817', '#5c3d22', '#7d5530', '#9c6d3e', '#4a4d55', '#666a73', '#878b93', '#a9adb3', '#25507a',
  '#2f6fa3', '#4a92c4', '#8cc6e6', '#d8eef6', '#b8323a', '#e0788a', '#efe6c8', '#8a6cc0',
];

describe('vfx palette lint', () => {
  it('matches a known CIEDE2000 reference pair', () => {
    // Sharma et al. test data, pair 1: 2.0425.
    expect(de2000([50, 2.6772, -79.7751], [50, 0, -82.7485])).toBeCloseTo(2.0425, 3);
  });

  it('separates every pair of families (mean dE2000 of R2-R4 >= 10)', () => {
    const low: string[] = [];
    for (let i = 0; i < FAMILY_IDS.length; i++)
      for (let j = i + 1; j < FAMILY_IDS.length; j++) {
        const a = FAMILY_IDS[i],
          b = FAMILY_IDS[j];
        const m = ([2, 3, 4].map((k) => de2000(L(a, k), L(b, k))).reduce((s, v) => s + v, 0)) / 3;
        if (m < 10) low.push(`${a}~${b} ${m.toFixed(1)}`);
      }
    expect(low).toEqual([]);
  });

  it('keeps every family R3 >= dE 7 from the world tiles', () => {
    const near: string[] = [];
    for (const f of FAMILY_IDS)
      for (const w of WORLD) {
        const d = de2000(L(f, 3), lab(hexToRgb(w)));
        if (d < 7) near.push(`${f} ${d.toFixed(1)} vs ${w}`);
      }
    expect(near).toEqual([]);
  });

  it('keeps danger R3 apart from every player family under CVD simulation', () => {
    const min: Record<string, number> = { protan: 10, deutan: 10, tritan: 8 };
    for (const [name, m] of Object.entries(M)) {
      const d0 = lab(cvd(hexToRgb(RAMPS.danger.R[3]), m));
      for (const f of FAMILY_IDS) {
        if (f === 'danger') continue;
        const d = de2000(d0, lab(cvd(hexToRgb(RAMPS[f].R[3]), m)));
        expect(d, `${name}: danger vs ${f}`).toBeGreaterThanOrEqual(min[name]);
      }
    }
  });
});
