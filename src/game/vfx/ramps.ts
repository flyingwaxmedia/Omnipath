// Family and utility ramps (docs/VFX.md §3.2, implemented exactly) and the colour LUTs that turn index frames into
// RGBA (§3.4). Authored for Omnipath from the ART-DIRECTION anchors; no ramp is taken from a pack or from pixelfx.
import { IDX, INDEX_COUNT, OUTLINE_HEX, type Hex, type LutVariant, type Ramp, type RampId } from './types';

const ramp = (R: readonly string[], accent: string, S: readonly string[]): Ramp => ({
  R: R as unknown as Ramp['R'],
  accent: accent as Hex,
  S: S as unknown as Ramp['S'],
});
/** Utility ramps: accent = R5, S = R1..R4. */
const util = (R: readonly string[]): Ramp => ramp(R, R[5], R.slice(1, 5));

export const RAMPS: Readonly<Record<RampId, Ramp>> = {
  fire: ramp(['#4a1408', '#a02a0c', '#e05a18', '#ff9a2a', '#ffd860', '#fff8d8'], '#ffe9a8', ['#2a2420', '#4a403a', '#6a605a', '#8a8278']),
  water: ramp(['#08204a', '#0a3e96', '#0a64e0', '#1aa0ff', '#7ce4ff', '#e8fcff'], '#ffffff', ['#b8e4f8', '#d8f2fc', '#eefaff', '#ffffff']),
  earth: ramp(['#2e1a0c', '#623414', '#a05a18', '#cc8a2c', '#eabc5c', '#f8e8b4'], '#b0c858', ['#3a302c', '#5a4c44', '#7e6c5e', '#a8927c']),
  wind: ramp(['#103a30', '#1a6a56', '#2eaa88', '#6ceac0', '#c4ffec', '#f4fffb'], '#c4d84a', ['#5a7a1a', '#8fae2a', '#c4d84a', '#e8f080']),
  lightning: ramp(['#1a1040', '#3a2c70', '#6a5ab0', '#fff060', '#ffffb0', '#ffffff'], '#ffe14a', ['#2a1e50', '#4a3a8a', '#7a6ac8', '#b0a4f0']),
  shadow: ramp(['#0e0a16', '#24163a', '#4a2a78', '#7446c0', '#a87cff', '#dcc8ff'], '#b8e05a', ['#08060c', '#140e20', '#20162e', '#2e2040']),
  holy: ramp(['#5a3c10', '#9a6a20', '#d8a030', '#f4c850', '#ffe890', '#fffbe8'], '#ffffff', ['#e8dcc0', '#f4ecd8', '#fbf6ea', '#ffffff']),
  ice: ramp(['#20204e', '#40489a', '#7c84e0', '#a8ecff', '#e4fcff', '#ffffff'], '#aee9ff', ['#c8d8e8', '#e0ecf4', '#f0f6fa', '#ffffff']),
  magma: ramp(['#1e0806', '#4e0c06', '#96180a', '#dc3810', '#ff8020', '#ffe070'], '#ffd27a', ['#24180f', '#3a2a24', '#5a4436', '#7a5e48']),
  storm: ramp(['#141826', '#2a3048', '#4e5a84', '#8494c4', '#c8f0ff', '#ffffff'], '#9fd8ff', ['#2a3444', '#4a5c74', '#7a90a8', '#a8b8cc']),
  twilight: ramp(['#1a1030', '#3e2260', '#8a3ea0', '#d870d8', '#ff9ec0', '#fff0e0'], '#fff4d0', ['#2a1a40', '#4a2a5a', '#7a4a7a', '#a86a8a']),
  steel: ramp(['#2a3040', '#56647c', '#8ea4c0', '#c8d8ec', '#f0f6ff', '#ffffff'], '#ffd27a', ['#3d2817', '#5c3d22', '#7d5530', '#9c6d3e']),
  arcane: ramp(['#141850', '#2a2490', '#4a3ce0', '#7c78ff', '#bcc0ff', '#f4f4ff'], '#8ff0ff', ['#1a1440', '#2e2670', '#4a40a0', '#6c64c8']),
  stealth: ramp(['#120e1a', '#26203a', '#403858', '#6a6488', '#a8a4c8', '#e8e6f8'], '#c8b0ff', ['#2a2630', '#3e3848', '#554e60', '#6e6678']),
  toxin: ramp(['#1a2408', '#3a560a', '#8cc800', '#ccff20', '#efff80', '#f8ffd8'], '#b04ad0', ['#22301a', '#3a4a26', '#566a36', '#74884a']),
  spirit: ramp(['#3a2418', '#7a4c34', '#c08a68', '#ecc0a0', '#fbe4d0', '#fffaf4'], '#ffffff', ['#5a4030', '#8a6a50', '#b8987a', '#e0c8a8']),
  danger: ramp(['#3a0820', '#7a0c3c', '#d01060', '#ff3c78', '#ff9ab8', '#fff0f4'], '#fff8f0', ['#24180f', '#3a1420', '#5a1c30', '#7a2440']),
  smoke: util(['#1e1a18', '#2a2420', '#4a403a', '#6a605a', '#8a8278', '#b0a698']),
  dust: util(['#4a3420', '#6a5034', '#8a7050', '#a8906c', '#c8b490', '#e6d8b8']),
  blood: util(['#300612', '#66101e', '#a8142a', '#e83a4e', '#ff8090', '#ffd0d8']),
  heal: util(['#0e3a1e', '#1a6a30', '#2ea848', '#6ae078', '#c0ffc8', '#f0fff2']),
};

/**
 * Ramps whose glow twin is never baked (docs/VFX.md §3.3 glow column "none" / "never"). Matter missiles keep their
 * imbue rim regardless (the runtime shows it only when the body carries an element).
 */
export const NO_GLOW: ReadonlySet<RampId> = new Set<RampId>(['earth', 'wind', 'stealth', 'toxin', 'danger', 'smoke', 'dust', 'blood']);

export type Rgb = readonly [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.slice(1), 16);
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255];
}

/** fit(ramp, n): resample the main ramp to n steps by nearest index, keeping both ends. */
export function fit(r: Ramp, n: number): Hex[] {
  if (n <= 1) return [r.R[5]];
  const out: Hex[] = [];
  for (let k = 0; k < n; k++) out.push(r.R[Math.round((k * 5) / (n - 1))]);
  return out;
}

/** True on little-endian platforms (checked once): the LUT is packed so a Uint32 view writes R, G, B, A bytes. */
export const LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

export function pack(r: number, g: number, b: number, a = 255): number {
  return LITTLE_ENDIAN ? ((a << 24) | (b << 16) | (g << 8) | r) >>> 0 : ((r << 24) | (g << 16) | (b << 8) | a) >>> 0;
}

export function unpack(v: number): [number, number, number, number] {
  return LITTLE_ENDIAN
    ? [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, v >>> 24]
    : [v >>> 24, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
}

/** Desaturate toward luma (monster LUT: saturation x0.85). */
function desat([r, g, b]: Rgb, k: number): Rgb {
  const l = 0.299 * r + 0.587 * g + 0.114 * b;
  const f = (c: number) => Math.round(l + (c - l) * k);
  return [f(r), f(g), f(b)];
}

/** The 14 colours (index 0 unused) of a ramp + variant, as RGB triples. */
export function lutColours(id: RampId, variant: LutVariant = 'base'): Rgb[] {
  const r = RAMPS[id];
  const R = r.R.map(hexToRgb);
  const S = r.S.map(hexToRgb);
  const out: Rgb[] = new Array(INDEX_COUNT).fill([0, 0, 0] as Rgb);
  for (let k = 0; k < 6; k++) out[IDX.R0 + k] = R[k];
  for (let k = 0; k < 4; k++) out[IDX.S0 + k] = S[k];
  out[IDX.OUTLINE] = hexToRgb(OUTLINE_HEX);
  out[IDX.ACCENT] = hexToRgb(r.accent);
  out[IDX.WHITE] = [255, 255, 255];
  if (variant === 'shift') {
    for (let k = 0; k < 6; k++) out[IDX.R0 + k] = R[Math.max(0, k - 1)];
    for (let k = 0; k < 4; k++) out[IDX.S0 + k] = S[Math.max(0, k - 1)];
    out[IDX.WHITE] = R[5];
  } else if (variant === 'monster') {
    for (let k = 1; k < INDEX_COUNT; k++) if (k !== IDX.OUTLINE) out[k] = desat(out[k], 0.85);
    out[IDX.WHITE] = desat(R[5], 0.85);
    out[IDX.ACCENT] = hexToRgb(RAMPS.danger.R[3]);
  } else if (variant === 'reduceFlash') {
    out[IDX.WHITE] = R[5];
  }
  return out;
}

const cache = new Map<string, Uint32Array>();

/** INDEX_COUNT packed RGBA entries; entry 0 is transparent. Cached per (ramp, variant); treat as read-only. */
export function lut(id: RampId, variant: LutVariant = 'base'): Uint32Array {
  const key = `${id}|${variant}`;
  let t = cache.get(key);
  if (!t) {
    const cols = lutColours(id, variant);
    t = new Uint32Array(INDEX_COUNT);
    for (let k = 1; k < INDEX_COUNT; k++) t[k] = pack(cols[k][0], cols[k][1], cols[k][2], 255);
    t[0] = 0;
    cache.set(key, t);
  }
  return t;
}
