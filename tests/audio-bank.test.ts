// The SFX bank's loudness table (docs/QUALITY-PLAN.md §6): every sound is offline-rendered (the engine's own
// buildSound, every cached variation), sent through a model of the engine's output chain at default settings, and
// measured with an independent K-weighted loudness. This guards the mix: categories sit at consistent levels
// (footsteps, ticks and UI taps quiet, hits mid, fanfares on top), nothing is starved by its peak ceiling, and the
// signals are clean (no DC, no clicks at the edges, no sub-bass or hiss eating a phone speaker's headroom).
import { describe, expect, it } from 'vitest';
import { GROUP_DB, GROUPS, HIT_GAIN, SOUNDS, TARGET_LOUDNESS, buildSound, gainOf, soundNames, type GroupId } from '../src/game/audio/bank';
import { BUILD_RATE, MAKEUP } from '../src/game/audio/engine';
import { AUDIO_DEFAULTS, busGains } from '../src/game/audio/settings';

const SR = BUILD_RATE;

// ------------------------------------------------------------------ an independent measurement (not bank.ts's)

/** RBJ biquad, Q linear. */
function biquad(x: Float32Array, type: 'lowpass' | 'highpass' | 'highshelf', f0: number, q: number, gainDb = 0): Float32Array {
  const w = (2 * Math.PI * f0) / SR;
  const c = Math.cos(w);
  const al = Math.sin(w) / (2 * q);
  const A = 10 ** (gainDb / 40);
  let b: [number, number, number];
  let a: [number, number, number];
  if (type === 'lowpass') {
    b = [(1 - c) / 2, 1 - c, (1 - c) / 2];
    a = [1 + al, -2 * c, 1 - al];
  } else if (type === 'highpass') {
    b = [(1 + c) / 2, -(1 + c), (1 + c) / 2];
    a = [1 + al, -2 * c, 1 - al];
  } else {
    const sq = 2 * Math.sqrt(A) * al;
    b = [A * (A + 1 + (A - 1) * c + sq), -2 * A * (A - 1 + (A + 1) * c), A * (A + 1 + (A - 1) * c - sq)];
    a = [A + 1 - (A - 1) * c + sq, 2 * (A - 1 - (A + 1) * c), A + 1 - (A - 1) * c - sq];
  }
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b[0] * x[i] + b[1] * x1 + b[2] * x2 - a[1] * y1 - a[2] * y2) / a[0];
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/** What the speakers get from one voice: the SFX bus low-pass (8 kHz) for SFX, the master high-pass (110 Hz). */
const engineChain = (x: Float32Array, ambience: boolean) => biquad(ambience ? x : biquad(x, 'lowpass', 8000, Math.SQRT1_2), 'highpass', 110, Math.SQRT1_2);
/** BS.1770 K-weighting (stage 1 shelf; stage 2's 38 Hz high-pass is below the engine's 110 Hz one). */
const kWeight = (x: Float32Array) => biquad(x, 'highshelf', 1681, Math.SQRT1_2, 4);

/** Loudest 100 ms (5 ms hop) RMS, zero-padded. */
function loudest(x: Float32Array, ms = 100): number {
  const win = Math.round((SR * ms) / 1000);
  const hop = Math.round(SR * 0.005);
  let best = 0;
  for (let st = 0; st < Math.max(1, x.length - win + 1); st += hop) {
    let s = 0;
    for (let i = st; i < Math.min(x.length, st + win); i++) s += x[i] * x[i];
    best = Math.max(best, s / win);
  }
  return Math.sqrt(best);
}

/** Energy fractions below 80 Hz and above 8 kHz (Hann-windowed 2048-point FFT frames). */
function extremes(x: Float32Array): { sub: number; air: number } {
  const N = 2048;
  const spec = new Float64Array(N / 2);
  for (let off = 0; off < Math.max(1, x.length - N / 2); off += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[off + i] ?? 0) * (0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const ang = (-2 * Math.PI) / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const cr = Math.cos(ang * k);
          const ci = Math.sin(ang * k);
          const p = i + k;
          const q = p + len / 2;
          const vr = re[q] * cr - im[q] * ci;
          const vi = re[q] * ci + im[q] * cr;
          re[q] = re[p] - vr;
          im[q] = im[p] - vi;
          re[p] += vr;
          im[p] += vi;
        }
      }
    }
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  let tot = 0;
  let sub = 0;
  let air = 0;
  for (let k = 1; k < N / 2; k++) {
    const f = (k * SR) / N;
    tot += spec[k];
    if (f < 80) sub += spec[k];
    else if (f > 8000) air += spec[k];
  }
  return { sub: sub / (tot || 1), air: air / (tot || 1) };
}

const db = (v: number) => 20 * Math.log10(v);

// ------------------------------------------------------------------ the table

interface Row {
  name: string;
  group: GroupId;
  ambience: boolean;
  /** dBFS heard at default settings (K-weighted, loudest 100 ms), before the master compressor. */
  heard: number;
  /** What GROUP_DB + trim promise. */
  expected: number;
  /** Peak dBFS at default settings, before the compressor. */
  peak: number;
  /** Loudness spread between the cached variations (dB). */
  spread: number;
  dc: number;
  edge: number;
  sub: number;
  air: number;
}

const bg = busGains(AUDIO_DEFAULTS);
const out = bg.master * MAKEUP;
/** A hit with GROUP_DB 0 and no trim, as heard (the reference every expectation hangs from). */
const HIT_HEARD = db(TARGET_LOUDNESS * HIT_GAIN * bg.sfx * out);

const ROWS: Row[] = soundNames().map((name) => {
  const def = SOUNDS[name];
  const ambience = def.bus === 'ambience';
  const k = gainOf(def) * (ambience ? bg.ambience : bg.sfx) * out;
  const levels: number[] = [];
  let peak = 0;
  let dc = 0;
  let edge = 0;
  let sub = 0;
  let air = 0;
  for (let v = 0; v < Math.max(1, def.variations ?? 2); v++) {
    const x = buildSound(name, def, SR, v);
    let sum = 0;
    for (const s of x) {
      peak = Math.max(peak, Math.abs(s));
      sum += s;
    }
    dc = Math.max(dc, Math.abs(sum / x.length));
    edge = Math.max(edge, Math.abs(x[0]), Math.abs(x[x.length - 1]));
    levels.push(db(loudest(kWeight(engineChain(x, ambience))) * k));
    const e = extremes(x);
    sub = Math.max(sub, e.sub);
    air = Math.max(air, e.air);
  }
  const busOffset = ambience ? db(bg.ambience / bg.sfx) : 0;
  return {
    name,
    group: def.group,
    ambience,
    heard: levels.reduce((a, b) => a + b, 0) / levels.length,
    expected: HIT_HEARD + GROUP_DB[def.group] + (def.trim ?? 0) + busOffset,
    peak: db(peak * k),
    spread: Math.max(...levels) - Math.min(...levels),
    dc,
    edge,
    sub,
    air,
  };
});

/** Category windows (dBFS heard at default settings, before the compressor). */
const TABLE: { cat: string; pick: (r: Row) => boolean; min: number; max: number }[] = [
  { cat: 'ambience one-shots', pick: (r) => r.ambience, min: -47, max: -32 },
  { cat: 'footsteps', pick: (r) => r.group === 'step', min: -37, max: -33 },
  { cat: 'status ticks', pick: (r) => r.group === 'tick', min: -36, max: -31 },
  { cat: 'UI taps', pick: (r) => r.group === 'ui', min: -34, max: -28.5 },
  { cat: 'swings', pick: (r) => r.group === 'swing', min: -29, max: -24.5 },
  { cat: 'statuses', pick: (r) => r.group === 'status', min: -29, max: -25 },
  { cat: 'casts (sheen / charge / spells)', pick: (r) => r.group === 'cast', min: -30, max: -22.5 },
  { cat: 'hits', pick: (r) => r.group === 'hit' && r.name !== 'hit_resist', min: -23.5, max: -21.5 },
  { cat: 'crit layer', pick: (r) => r.group === 'crit', min: -25, max: -21.5 },
  { cat: 'player hurt', pick: (r) => r.group === 'hurt', min: -30, max: -21.5 },
  { cat: 'deaths', pick: (r) => r.group === 'death', min: -23.5, max: -21.5 },
  { cat: 'novas / combos / bosses', pick: (r) => ['nova', 'combo', 'boss'].includes(r.group), min: -23, max: -18 },
  { cat: 'fanfares', pick: (r) => r.group === 'fanfare', min: -22.5, max: -17.5 },
];

if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AUDIO_TABLE) {
  const rows = TABLE.map((t) => {
    const rs = ROWS.filter(t.pick);
    const h = rs.map((r) => r.heard);
    return { category: t.cat, n: rs.length, min: +Math.min(...h).toFixed(1), mean: +(h.reduce((a, b) => a + b, 0) / h.length).toFixed(1), max: +Math.max(...h).toFixed(1), window: `${t.min}..${t.max}`, peak: +Math.max(...rs.map((r) => r.peak)).toFixed(1) };
  });
  console.log(JSON.stringify({ hitHeard: +HIT_HEARD.toFixed(2), rows, worst: { sub: Math.max(...ROWS.map((r) => r.sub)), air: Math.max(...ROWS.map((r) => r.air)), dc: Math.max(...ROWS.map((r) => r.dc)), edge: Math.max(...ROWS.map((r) => r.edge)), dev: Math.max(...ROWS.map((r) => Math.abs(r.heard - r.expected))), spread: Math.max(...ROWS.map((r) => r.spread)) } }));
}

describe('SFX bank loudness table', () => {
  it('every sound is heard where GROUP_DB + its trim put it (normalisation works; no sound is peak-starved)', () => {
    expect(HIT_HEARD).toBeGreaterThan(-24);
    expect(HIT_HEARD).toBeLessThan(-21);
    for (const r of ROWS) {
      expect(Math.abs(r.heard - r.expected), `${r.name}: heard ${r.heard.toFixed(1)} dB, expected ${r.expected.toFixed(1)}`).toBeLessThanOrEqual(1);
      expect(r.spread, `${r.name}: variations differ`).toBeLessThanOrEqual(0.6);
      expect(Math.abs(SOUNDS[r.name].trim ?? 0), `${r.name}: trim`).toBeLessThanOrEqual(10);
    }
  }, 60000);

  it('categories sit in their windows, in order: quiet taps and steps, hits mid, fanfares on top', () => {
    const mean = (rs: Row[]) => rs.reduce((a, r) => a + r.heard, 0) / rs.length;
    for (const row of TABLE) {
      const rs = ROWS.filter(row.pick);
      expect(rs.length, row.cat).toBeGreaterThan(0);
      for (const r of rs) {
        expect(r.heard, `${row.cat}: ${r.name}`).toBeGreaterThanOrEqual(row.min);
        expect(r.heard, `${row.cat}: ${r.name}`).toBeLessThanOrEqual(row.max);
      }
    }
    const of = (g: GroupId) => ROWS.filter((r) => r.group === g);
    const quiet = Math.max(...[...of('step'), ...of('tick'), ...of('ui')].map((r) => r.heard));
    expect(quiet).toBeLessThan(Math.min(...of('swing').map((r) => r.heard)));
    expect(mean(of('swing'))).toBeLessThan(mean(of('hit')) - 2);
    expect(mean(of('hit'))).toBeLessThan(mean(of('fanfare')) - 2);
    // the fanfare group is the loudest group of all
    const groups = Object.keys(GROUPS) as GroupId[];
    const loudest = groups.reduce((best, g) => (mean(of(g)) > mean(of(best)) ? g : best), groups[0]);
    expect(loudest).toBe('fanfare');
  }, 60000);

  it('no single sound comes near clipping, and every signal is clean', () => {
    for (const r of ROWS) {
      // ≥ 6 dB of headroom before the compressor (its own makeup gain and stacking live there)
      expect(r.peak, `${r.name} peak`).toBeLessThanOrEqual(-6);
      expect(r.dc, `${r.name} DC offset`).toBeLessThan(0.012);
      expect(r.edge, `${r.name} click at an edge`).toBeLessThan(0.01);
      expect(r.sub, `${r.name} sub-bass < 80 Hz`).toBeLessThan(0.06);
      expect(r.air, `${r.name} harsh energy > 8 kHz`).toBeLessThan(0.06);
    }
  }, 60000);
});
