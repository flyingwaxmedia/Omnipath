// Ambient soundscape (docs/QUALITY-PLAN.md §13): a procedural looping bed per biome — filtered noise and slow
// seeded variation (wind swells, water lapping, room tone, lava rumble) plus scheduled one-shots from the bank
// (birds, drips, thunder, town hints) — cross-faded on every mapEnter, and a light room echo (a convolver fed a
// generated impulse) for caves and crypts.
//
// The data and generators at the top are pure (node tests cover them); AmbiencePlayer drives Web Audio and is only
// ever constructed by the engine (src/game/audio/engine.ts).
import { hashSeed, mulberry32 } from '../../core/rng';
import type { Biome, MapKind } from '../../core/world/types';

// ------------------------------------------------------------------ beds (pure data)

export type BedId =
  | 'meadow'
  | 'lake'
  | 'hill'
  | 'quarry'
  | 'forest'
  | 'glade'
  | 'ember'
  | 'basalt'
  | 'plateau'
  | 'storm'
  | 'town'
  | 'cave'
  | 'crypt'
  | 'frost'
  | 'dusk';

export type NoiseColor = 'white' | 'pink' | 'brown';

/** Slow random motion of a parameter: every segment (min..max s) ramps to base × (1 − depth … 1) (gain) or
 *  base × (1 ± depth) (frequency). */
export interface Wander {
  depth: number;
  min: number;
  max: number;
}

export interface NoiseLayer {
  color: NoiseColor;
  filter: 'lowpass' | 'bandpass' | 'highpass';
  freq: number;
  q: number;
  gain: number;
  swell?: Wander;
  drift?: Wander;
}

export interface BedEvent {
  /** A bank sound (bus: 'ambience'). */
  sound: string;
  /** Seconds between bursts. */
  every: [number, number];
  /** Per-play gain range. */
  gain: [number, number];
  /** Max |pan|. */
  pan: number;
  /** Plays per burst and the gap between them (s). */
  burst?: [number, number];
  gap?: [number, number];
  /** Playback-rate range (pitch). */
  rate?: [number, number];
}

export interface BedDef {
  id: BedId;
  /**
   * Bed output level (before the ambience bus). Set from an offline render of each bed with its one-shots (K-weighted,
   * after the master high-pass, 3 s windows): open-air beds land within ±1 dB of each other (≈ −39 dBFS at default
   * settings), caves / crypts ~3 dB under before their echo, so a warp's cross-fade never jumps in level.
   */
  gain: number;
  layers: NoiseLayer[];
  events: BedEvent[];
  /** Feed the room echo (caves, crypts). */
  echo?: boolean;
}

const W = (depth: number, min: number, max: number): Wander => ({ depth, min, max });
const birds = (every: [number, number], gain = 1): BedEvent[] => [
  { sound: 'amb_bird_a', every, gain: [0.5 * gain, 1 * gain], pan: 0.85, burst: [1, 3], gap: [0.25, 0.7], rate: [0.9, 1.15] },
  { sound: 'amb_bird_b', every: [every[0] * 1.6, every[1] * 1.8], gain: [0.4 * gain, 0.9 * gain], pan: 0.85, burst: [1, 2], gap: [0.3, 0.6], rate: [0.9, 1.1] },
  { sound: 'amb_bird_c', every: [every[0] * 2.5, every[1] * 3], gain: [0.4 * gain, 0.8 * gain], pan: 0.8 },
];

export const BEDS: Readonly<Record<BedId, BedDef>> = {
  meadow: {
    id: 'meadow',
    gain: 0.43,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 700, q: 0.6, gain: 0.5, swell: W(0.6, 4, 9), drift: W(0.3, 5, 10) },
      { color: 'white', filter: 'bandpass', freq: 3200, q: 1.2, gain: 0.06, swell: W(0.8, 3, 7) },
    ],
    events: [...birds([2.5, 7]), { sound: 'amb_hawk', every: [25, 50], gain: [0.5, 0.9], pan: 0.7 }],
  },
  lake: {
    id: 'lake',
    gain: 0.41,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 600, q: 0.6, gain: 0.3, swell: W(0.5, 4, 9) },
      { color: 'pink', filter: 'bandpass', freq: 460, q: 0.8, gain: 0.66, swell: W(0.75, 1.5, 3.5), drift: W(0.25, 2, 5) },
    ],
    events: [
      { sound: 'amb_water_lap', every: [2, 5], gain: [0.5, 1], pan: 0.7, rate: [0.85, 1.15] },
      { sound: 'amb_plop', every: [6, 15], gain: [0.5, 1], pan: 0.8, rate: [0.9, 1.2] },
      ...birds([5, 12], 0.8),
    ],
  },
  hill: {
    id: 'hill',
    gain: 0.66,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 900, q: 0.8, gain: 0.34, swell: W(0.7, 2, 6), drift: W(0.4, 3, 7) },
      { color: 'brown', filter: 'lowpass', freq: 450, q: 0.7, gain: 0.15, swell: W(0.5, 3, 8) },
    ],
    events: [
      { sound: 'amb_gust', every: [5, 12], gain: [0.6, 1], pan: 0.6, rate: [0.85, 1.15] },
      { sound: 'amb_hawk', every: [15, 30], gain: [0.6, 1], pan: 0.8 },
      ...birds([9, 20], 0.6),
    ],
  },
  quarry: {
    id: 'quarry',
    gain: 0.5,
    layers: [{ color: 'pink', filter: 'bandpass', freq: 650, q: 0.7, gain: 0.5, swell: W(0.6, 3, 8), drift: W(0.3, 4, 9) }],
    events: [
      { sound: 'amb_pebble', every: [4, 10], gain: [0.5, 1], pan: 0.8, rate: [0.8, 1.2] },
      { sound: 'amb_hammer', every: [7, 16], gain: [0.4, 0.8], pan: 0.7, burst: [2, 4], gap: [0.5, 0.7], rate: [0.9, 1.05] },
      ...birds([10, 22], 0.5),
    ],
  },
  forest: {
    id: 'forest',
    gain: 1.0,
    layers: [
      { color: 'white', filter: 'bandpass', freq: 2400, q: 0.7, gain: 0.05, swell: W(0.8, 2, 6) },
      { color: 'brown', filter: 'lowpass', freq: 420, q: 0.7, gain: 0.18, swell: W(0.5, 4, 9) },
    ],
    events: [
      { sound: 'amb_leaves', every: [4, 9], gain: [0.5, 1], pan: 0.8 },
      { sound: 'amb_creak', every: [6, 15], gain: [0.5, 1], pan: 0.8, rate: [0.8, 1.2] },
      { sound: 'amb_owl', every: [12, 25], gain: [0.5, 0.9], pan: 0.8, rate: [0.95, 1.05] },
      { sound: 'amb_bird_c', every: [10, 20], gain: [0.3, 0.6], pan: 0.8 },
    ],
  },
  glade: {
    id: 'glade',
    gain: 0.5,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 1200, q: 0.7, gain: 0.5, swell: W(0.6, 3, 8) },
      { color: 'white', filter: 'bandpass', freq: 1800, q: 2, gain: 0.22, swell: W(0.5, 0.5, 1.5), drift: W(0.2, 0.4, 1.2) },
    ],
    events: [
      { sound: 'amb_chime', every: [6, 14], gain: [0.5, 1], pan: 0.7, rate: [0.94, 1.06] },
      { sound: 'amb_cricket', every: [2, 5], gain: [0.5, 1], pan: 0.9, burst: [2, 5], gap: [0.25, 0.4] },
      { sound: 'amb_drip', every: [3, 7], gain: [0.4, 0.8], pan: 0.8, rate: [0.8, 1.3] },
    ],
  },
  ember: {
    id: 'ember',
    gain: 0.63,
    layers: [
      { color: 'brown', filter: 'lowpass', freq: 280, q: 0.8, gain: 0.3, swell: W(0.5, 2, 5) },
      { color: 'pink', filter: 'bandpass', freq: 800, q: 0.7, gain: 0.12, swell: W(0.6, 3, 7), drift: W(0.3, 3, 7) },
    ],
    events: [
      { sound: 'amb_crackle', every: [0.6, 2], gain: [0.4, 1], pan: 0.9, burst: [1, 3], gap: [0.08, 0.25] },
      { sound: 'amb_lava_bubble', every: [2, 6], gain: [0.5, 1], pan: 0.8, rate: [0.8, 1.2] },
    ],
  },
  basalt: {
    id: 'basalt',
    gain: 0.78,
    layers: [
      { color: 'brown', filter: 'lowpass', freq: 300, q: 0.8, gain: 0.23, swell: W(0.5, 3, 7) },
      { color: 'pink', filter: 'bandpass', freq: 850, q: 0.8, gain: 0.2, swell: W(0.7, 2, 6), drift: W(0.35, 3, 7) },
    ],
    events: [
      { sound: 'amb_crackle', every: [1.5, 4], gain: [0.4, 0.8], pan: 0.9, burst: [1, 2], gap: [0.1, 0.3] },
      { sound: 'amb_gust', every: [6, 14], gain: [0.5, 0.9], pan: 0.6 },
      { sound: 'amb_lava_bubble', every: [5, 12], gain: [0.4, 0.8], pan: 0.8, rate: [0.8, 1.1] },
    ],
  },
  plateau: {
    id: 'plateau',
    gain: 0.55,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 750, q: 0.7, gain: 0.38, swell: W(0.7, 1.5, 5), drift: W(0.5, 2, 6) },
      { color: 'brown', filter: 'lowpass', freq: 400, q: 0.7, gain: 0.17, swell: W(0.5, 3, 7) },
    ],
    events: [
      { sound: 'amb_thunder', every: [14, 30], gain: [0.5, 1], pan: 0.7, rate: [0.85, 1.1] },
      { sound: 'amb_gust', every: [6, 12], gain: [0.6, 1], pan: 0.6 },
    ],
  },
  storm: {
    id: 'storm',
    gain: 0.53,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 900, q: 0.7, gain: 0.53, swell: W(0.7, 1.5, 4.5), drift: W(0.5, 2, 5) },
      { color: 'white', filter: 'bandpass', freq: 3000, q: 0.4, gain: 0.04, swell: W(0.4, 3, 7) },
    ],
    events: [
      { sound: 'amb_thunder', every: [8, 20], gain: [0.6, 1], pan: 0.7, rate: [0.85, 1.15] },
      { sound: 'amb_gust', every: [4, 9], gain: [0.6, 1], pan: 0.6 },
    ],
  },
  town: {
    id: 'town',
    gain: 0.43,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 450, q: 1.3, gain: 0.5, swell: W(0.6, 1, 3), drift: W(0.35, 0.4, 1.2) },
      { color: 'pink', filter: 'bandpass', freq: 650, q: 0.6, gain: 0.44, swell: W(0.5, 4, 9) },
    ],
    events: [
      ...birds([3, 8]),
      { sound: 'amb_murmur', every: [4, 9], gain: [0.5, 1], pan: 0.7, rate: [0.9, 1.1] },
      { sound: 'amb_hammer', every: [10, 20], gain: [0.5, 0.9], pan: 0.7, burst: [3, 5], gap: [0.45, 0.6], rate: [0.95, 1.05] },
    ],
  },
  cave: {
    id: 'cave',
    gain: 0.75,
    echo: true,
    layers: [
      { color: 'brown', filter: 'lowpass', freq: 320, q: 0.7, gain: 0.18, swell: W(0.3, 6, 12) },
      { color: 'pink', filter: 'bandpass', freq: 1500, q: 3, gain: 0.03, swell: W(0.7, 3, 8), drift: W(0.2, 4, 9) },
    ],
    events: [
      { sound: 'amb_drip', every: [1.5, 4.5], gain: [0.4, 1], pan: 0.9, burst: [1, 2], gap: [0.2, 0.5], rate: [0.8, 1.3] },
      { sound: 'amb_pebble', every: [10, 20], gain: [0.4, 0.8], pan: 0.8, rate: [0.8, 1.2] },
    ],
  },
  crypt: {
    id: 'crypt',
    gain: 0.82,
    echo: true,
    layers: [
      { color: 'brown', filter: 'lowpass', freq: 260, q: 0.7, gain: 0.18, swell: W(0.3, 6, 12) },
      { color: 'pink', filter: 'bandpass', freq: 420, q: 4, gain: 0.06, swell: W(0.8, 4, 9), drift: W(0.2, 4, 9) },
    ],
    events: [
      { sound: 'amb_moan', every: [12, 25], gain: [0.5, 1], pan: 0.8, rate: [0.85, 1.1] },
      { sound: 'amb_chain', every: [15, 30], gain: [0.5, 1], pan: 0.8, rate: [0.9, 1.1] },
      { sound: 'amb_drip', every: [4, 9], gain: [0.3, 0.7], pan: 0.9, rate: [0.7, 1.1] },
    ],
  },
  frost: {
    id: 'frost',
    gain: 0.8,
    layers: [
      { color: 'pink', filter: 'bandpass', freq: 1300, q: 3, gain: 0.13, swell: W(0.8, 2, 5), drift: W(0.3, 2, 5) },
      { color: 'pink', filter: 'lowpass', freq: 700, q: 0.7, gain: 0.28, swell: W(0.6, 3, 8) },
    ],
    events: [
      { sound: 'amb_ice_creak', every: [5, 12], gain: [0.5, 1], pan: 0.8, rate: [0.8, 1.2] },
      { sound: 'amb_gust', every: [6, 12], gain: [0.5, 0.9], pan: 0.6, rate: [1, 1.2] },
    ],
  },
  dusk: {
    id: 'dusk',
    gain: 0.5,
    layers: [{ color: 'pink', filter: 'bandpass', freq: 600, q: 0.6, gain: 0.45, swell: W(0.6, 4, 9) }],
    events: [
      { sound: 'amb_cricket', every: [1.2, 3.5], gain: [0.5, 1], pan: 0.9, burst: [2, 5], gap: [0.25, 0.4], rate: [0.95, 1.05] },
      { sound: 'amb_owl', every: [15, 30], gain: [0.5, 0.9], pan: 0.8 },
      { sound: 'amb_bird_c', every: [8, 16], gain: [0.3, 0.6], pan: 0.8 },
    ],
  },
};

const BED_BY_BIOME: Readonly<Record<Biome, BedId>> = {
  meadow: 'meadow',
  lake: 'lake',
  hill: 'hill',
  quarry: 'quarry',
  grove: 'forest',
  glade: 'glade',
  ember: 'ember',
  plateau: 'plateau',
  town: 'town',
  cave: 'cave',
  crypt: 'crypt',
  frost: 'frost',
  basalt: 'basalt',
  storm: 'storm',
  dusk: 'dusk',
};

/** What the engine needs to know about a map (from MapDef). */
export interface MapInfo {
  id: string;
  biome: Biome;
  kind: MapKind;
  flags?: readonly string[];
}

export function bedFor(map: MapInfo): BedId {
  return BED_BY_BIOME[map.biome] ?? 'meadow';
}

// ------------------------------------------------------------------ room echo (pure)

export interface ReverbPreset {
  id: 'cave' | 'crypt' | 'hall';
  /** RT60-ish decay (s). */
  seconds: number;
  /** Send level. */
  wet: number;
  /** High-frequency damping (Hz) at the start of the tail (falls to a third by the end). */
  damp: number;
  /** Pre-delay (s). */
  predelay: number;
}

export const REVERBS: Readonly<Record<ReverbPreset['id'], ReverbPreset>> = {
  cave: { id: 'cave', seconds: 1.6, wet: 0.22, damp: 3200, predelay: 0.018 },
  crypt: { id: 'crypt', seconds: 2.1, wet: 0.26, damp: 2400, predelay: 0.025 },
  hall: { id: 'hall', seconds: 1.0, wet: 0.14, damp: 4000, predelay: 0.012 },
};

/** Caves and crypts echo; other indoor maps / dungeons get a short hall; open maps none. */
export function reverbFor(map: MapInfo): ReverbPreset | null {
  if (map.biome === 'cave') return REVERBS.cave;
  if (map.biome === 'crypt') return REVERBS.crypt;
  if (map.flags?.includes('indoor') || map.kind === 'dungeon') return REVERBS.hall;
  return null;
}

/** A stereo room impulse: decaying noise, darker as it fades, with a few early reflections. Pure. */
export function makeImpulse(p: ReverbPreset, sampleRate: number, seed: number): [Float32Array, Float32Array] {
  const len = Math.max(1, Math.round((p.seconds + p.predelay) * sampleRate));
  const pre = Math.round(p.predelay * sampleRate);
  const out: [Float32Array, Float32Array] = [new Float32Array(len), new Float32Array(len)];
  for (let ch = 0; ch < 2; ch++) {
    const rng = mulberry32(hashSeed(seed, ch));
    const data = out[ch];
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / sampleRate;
      const env = Math.exp((-6.9 * t) / p.seconds);
      const cutoff = p.damp * (1 - (2 / 3) * Math.min(1, t / p.seconds));
      const a = 1 - Math.exp((-2 * Math.PI * cutoff) / sampleRate);
      lp += a * (rng() * 2 - 1 - lp);
      data[i] = lp * env;
    }
    // Early reflections: a handful of taps in the first ~60 ms, different per ear.
    for (let k = 0; k < 6; k++) {
      const at = pre + Math.round((0.006 + rng() * 0.055) * sampleRate);
      if (at < len) data[at] += (rng() < 0.5 ? -1 : 1) * (0.5 - k * 0.06);
    }
  }
  return out;
}

// ------------------------------------------------------------------ noise (pure)

/**
 * A seamless loop of coloured noise (`seconds` long), normalised to ~0.3 RMS. The loop point is cross-faded so
 * brown noise does not click when it wraps.
 */
export function makeNoise(color: NoiseColor, seconds: number, sampleRate: number, seed: number): Float32Array {
  const n = Math.max(2, Math.round(seconds * sampleRate));
  const fade = Math.min(Math.round(sampleRate * 0.08), n >> 2);
  const raw = new Float32Array(n + fade);
  const rng = mulberry32(seed);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let brown = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rng() * 2 - 1;
    if (color === 'white') raw[i] = w;
    else if (color === 'pink') {
      // Paul Kellet's refined pink filter.
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      raw[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      raw[i] = brown;
    }
  }
  // Remove DC, then cross-fade the tail into the head.
  let mean = 0;
  for (const v of raw) mean += v;
  mean /= raw.length;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = raw[i] - mean;
  for (let i = 0; i < fade; i++) {
    const k = i / fade;
    out[i] = out[i] * k + (raw[n + i] - mean) * (1 - k);
  }
  let sum = 0;
  for (const v of out) sum += v * v;
  const rms = Math.sqrt(sum / n) || 1;
  for (let i = 0; i < n; i++) out[i] *= 0.3 / rms;
  return out;
}

// ------------------------------------------------------------------ the player (Web Audio)

export interface AmbienceHost {
  ctx(): AudioContext | null;
  /** The ambience bus. */
  out(): AudioNode | null;
  /** The room-echo send. */
  send(): AudioNode | null;
  play(name: string, opts: { when?: number; gain?: number; pan?: number; rate?: number }): unknown;
  enabled(): boolean;
}

interface Mod {
  param: AudioParam;
  base: number;
  w: Wander;
  /** 'gain' swells down from base; 'freq' drifts around it. */
  kind: 'gain' | 'freq';
  /** Context time the scheduled ramp ends at, and the value it ends on. */
  next: number;
  value: number;
}

interface EventState {
  e: BedEvent;
  next: number;
}

interface Running {
  id: BedId;
  out: GainNode;
  nodes: AudioNode[];
  sources: AudioBufferSourceNode[];
  mods: Mod[];
  events: EventState[];
}

const NOISE_RATE = 22050;
const NOISE_SECONDS: Readonly<Record<NoiseColor, number>> = { white: 3.1, pink: 3.7, brown: 4.3 };
const FADE_IN = 2.5;
const FADE_OUT = 2;
/** How far ahead one-shots are scheduled (s). */
const LOOKAHEAD = 0.35;

export class AmbiencePlayer {
  private wanted: MapInfo | null = null;
  private bed: Running | null = null;
  /** Beds fading out (released once silent). */
  private readonly fading = new Set<Running>();
  private readonly noise = new Map<NoiseColor, AudioBuffer>();
  private rng = mulberry32(hashSeed('omnipath-ambience'));

  constructor(private readonly host: AmbienceHost) {}

  /** The bed playing now (or wanted while locked). */
  current(): BedId | null {
    if (!this.host.enabled()) return null;
    return this.bed?.id ?? (this.wanted ? bedFor(this.wanted) : null);
  }

  /** A map was entered: cross-fade to its bed (deferred until the context exists). */
  setMap(info: MapInfo): void {
    this.wanted = info;
    // Seed the variation per map so a place keeps its character between visits.
    this.rng = mulberry32(hashSeed('omnipath-ambience', info.id));
    this.refresh();
  }

  /** The context was just created: start the wanted bed. */
  attach(): void {
    this.refresh();
  }

  /** Re-evaluates what should play (map change, ambience volume toggled to / from 0). */
  refresh(): void {
    const ctx = this.host.ctx();
    if (!ctx) return;
    const want = this.wanted && this.host.enabled() ? bedFor(this.wanted) : null;
    if (want === (this.bed?.id ?? null)) return;
    this.stop(FADE_OUT);
    if (want) this.bed = this.start(ctx, BEDS[want]);
  }

  /** Fades the current bed out over `fade` s and releases its nodes (the next bed fades in meanwhile). */
  stop(fade = FADE_OUT): void {
    const bed = this.bed;
    this.bed = null;
    const ctx = this.host.ctx();
    if (!bed || !ctx) return;
    const t = ctx.currentTime;
    const end = t + Math.max(0.01, fade);
    try {
      const g = bed.out.gain;
      // Hold the value it has now (mid fade-in too), then ramp down: no jump either way.
      const now = g.value;
      g.cancelScheduledValues(t);
      g.setValueAtTime(now, t);
      g.linearRampToValueAtTime(0, end);
      for (const s of bed.sources) s.stop(end + 0.05);
    } catch {
      // context closing
    }
    this.fading.add(bed);
    const release = () => {
      if (!this.fading.delete(bed)) return;
      for (const n of [...bed.sources, ...bed.nodes, bed.out]) {
        try {
          n.disconnect();
        } catch {
          // already gone
        }
      }
    };
    if (fade <= 0) release();
    else setTimeout(release, (fade + 0.3) * 1000);
  }

  /** Nodes held by the playing bed and the beds still fading out (leak checks). */
  nodeCount(): number {
    let n = 0;
    for (const b of [...(this.bed ? [this.bed] : []), ...this.fading]) n += b.sources.length + b.nodes.length + 1;
    return n;
  }

  private noiseBuffer(ctx: AudioContext, color: NoiseColor): AudioBuffer {
    let b = this.noise.get(color);
    if (!b) {
      const data = makeNoise(color, NOISE_SECONDS[color], NOISE_RATE, hashSeed('omnipath-noise', color));
      b = ctx.createBuffer(1, data.length, NOISE_RATE);
      b.getChannelData(0).set(data);
      this.noise.set(color, b);
    }
    return b;
  }

  private start(ctx: AudioContext, def: BedDef): Running | null {
    const out = this.host.out();
    if (!out) return null;
    const t = ctx.currentTime;
    const bedOut = ctx.createGain();
    bedOut.gain.setValueAtTime(0, t);
    bedOut.gain.linearRampToValueAtTime(def.gain, t + FADE_IN);
    bedOut.connect(out);
    const send = def.echo ? this.host.send() : null;
    if (send) bedOut.connect(send);
    const run: Running = { id: def.id, out: bedOut, nodes: [], sources: [], mods: [], events: [] };
    for (const layer of def.layers) {
      const src = ctx.createBufferSource();
      const buf = this.noiseBuffer(ctx, layer.color);
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = 0.96 + this.rng() * 0.08;
      const filter = ctx.createBiquadFilter();
      filter.type = layer.filter;
      filter.frequency.value = layer.freq;
      // A band-pass Q is a plain Q; Web Audio reads a low- / high-pass Q as a resonance in dB.
      filter.Q.value = layer.filter === 'bandpass' ? layer.q : 20 * Math.log10(Math.max(0.1, layer.q));
      const g = ctx.createGain();
      g.gain.value = layer.gain;
      src.connect(filter).connect(g).connect(bedOut);
      src.start(t, this.rng() * buf.duration);
      run.sources.push(src);
      run.nodes.push(filter, g);
      if (layer.swell) {
        g.gain.setValueAtTime(layer.gain, t);
        run.mods.push({ param: g.gain, base: layer.gain, w: layer.swell, kind: 'gain', next: t, value: layer.gain });
      }
      if (layer.drift) {
        filter.frequency.setValueAtTime(layer.freq, t);
        run.mods.push({ param: filter.frequency, base: layer.freq, w: layer.drift, kind: 'freq', next: t, value: layer.freq });
      }
    }
    for (const e of def.events) run.events.push({ e, next: t + 1 + this.between(e.every) * 0.6 });
    return run;
  }

  private between([a, b]: readonly [number, number]): number {
    return a + this.rng() * (b - a);
  }

  /** Schedules slow parameter motion and one-shots a little ahead (the engine calls this every 250 ms). */
  tick(): void {
    const ctx = this.host.ctx();
    const bed = this.bed;
    if (!ctx || !bed || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    for (const m of bed.mods) {
      if (now < m.next - 0.3) continue;
      // Chain the next segment onto the end of the scheduled one (never cancel a ramp in flight: that snaps the
      // parameter back to the ramp's start and clicks). A late tick re-anchors at the value the ramp ended on.
      const seg = this.between([m.w.min, m.w.max]);
      const target = m.kind === 'gain' ? Math.max(0, m.base * (1 - m.w.depth * this.rng())) : Math.max(20, m.base * (1 + m.w.depth * (this.rng() * 2 - 1)));
      const from = Math.max(now, m.next);
      try {
        if (from > m.next) m.param.setValueAtTime(m.value, from);
        if (m.kind === 'freq') m.param.exponentialRampToValueAtTime(target, from + seg);
        else m.param.linearRampToValueAtTime(target, from + seg);
      } catch {
        // param automation race on a closing context
      }
      m.next = from + seg;
      m.value = target;
    }
    for (const s of bed.events) {
      // After a long suspension, skip the backlog instead of firing it all at once.
      if (s.next < now - 1) s.next = now + this.between(s.e.every) * 0.5;
      if (now < s.next - LOOKAHEAD) continue;
      const n = s.e.burst ? Math.round(this.between(s.e.burst)) : 1;
      let at = s.next;
      for (let i = 0; i < n; i++) {
        this.host.play(s.e.sound, {
          when: at,
          gain: this.between(s.e.gain),
          pan: (this.rng() * 2 - 1) * s.e.pan,
          rate: s.e.rate ? this.between(s.e.rate) : 1,
        });
        at += s.e.gap ? this.between(s.e.gap) : 0.3;
      }
      s.next += this.between(s.e.every);
    }
  }
}
