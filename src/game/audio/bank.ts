// The SFX bank (docs/QUALITY-PLAN.md §6): every sound in the game, as ORIGINAL ZzFX recipes generated in code.
// Pure data + pure builders (no Web Audio here): src/game/audio/engine.ts turns a recipe into cached AudioBuffers.
//
// Mixing rules for mobile speakers first: energy lives between ~200 Hz and ~6 kHz (no sub-bass thumps, no hiss
// above), attacks are short but never clicky (≥ 1 ms), and nothing in combat is longer than ~0.4 s except the big
// moments (level-up, discoveries, warden roars). Every sound has a voice group (src/game/audio/voices.ts) that limits
// how often it can stack; ticks and footsteps have the lowest priority, fanfares the highest.
import { hashSeed, mulberry32 } from '../../core/rng';
import type { ElementId, Family, ShapeKind, StatusKind, WeaponType } from '../../core/types';
import type { NodeKind } from '../../core/world/types';
import type { Surface } from './surfaces';
import { type ZzfxParams, zzfxBuild } from './zzfx';
import type { VoicePolicy } from './voices';

// ------------------------------------------------------------------ recipe model

/** One ZzFX voice inside a sound, started `at` seconds in, scaled by `gain`. */
export interface Layer {
  p: ZzfxParams;
  at?: number;
  gain?: number;
}

export type Bus = 'sfx' | 'ambience';

export interface SoundDef {
  layers: readonly Layer[];
  group: GroupId;
  /**
   * dB above / below the group's mix level (GROUP_DB). Buffers are loudness-normalised when built (`buildSound`),
   * so the group level + trim IS how loud the sound is heard relative to the others (tests/audio-bank.test.ts).
   */
  trim?: number;
  /** ± playback-rate jitter per play (fraction, default 0.04). Fanfares use 0 (they stay in tune). */
  pitchVar?: number;
  /** ± gain jitter per play (fraction, default 0.1). */
  volVar?: number;
  /** Cached variations, each built with a different seeded ZzFX randomness roll (default 2). */
  variations?: number;
  /** Overrides the group's priority. */
  priority?: number;
  bus?: Bus;
}

/** Voice groups: max concurrent, min retrigger gap (ms), priority (src/game/audio/voices.ts). */
export const GROUPS = {
  step: { max: 2, gap: 70, priority: 0 },
  tick: { max: 2, gap: 240, priority: 0 },
  amb: { max: 6, gap: 0, priority: 0 },
  status: { max: 2, gap: 160, priority: 1 },
  proj: { max: 4, gap: 45, priority: 2 },
  monster: { max: 4, gap: 70, priority: 2 },
  swing: { max: 3, gap: 55, priority: 3 },
  impact: { max: 3, gap: 50, priority: 3 },
  zap: { max: 4, gap: 45, priority: 3 },
  coin: { max: 3, gap: 70, priority: 3 },
  hit: { max: 5, gap: 28, priority: 4 },
  gather: { max: 2, gap: 120, priority: 4 },
  cast: { max: 3, gap: 50, priority: 5 },
  ui: { max: 3, gap: 45, priority: 5 },
  death: { max: 3, gap: 60, priority: 5 },
  nova: { max: 2, gap: 80, priority: 6 },
  hurt: { max: 2, gap: 90, priority: 6 },
  warp: { max: 2, gap: 300, priority: 6 },
  crit: { max: 2, gap: 60, priority: 7 },
  combo: { max: 2, gap: 120, priority: 7 },
  telegraph: { max: 3, gap: 140, priority: 7 },
  quest: { max: 2, gap: 200, priority: 8 },
  boss: { max: 2, gap: 500, priority: 8 },
  fanfare: { max: 1, gap: 250, priority: 10 },
} as const satisfies Record<string, VoicePolicy>;

export type GroupId = keyof typeof GROUPS;

/**
 * Mix level per group, in dB relative to a hit (on loudness-normalised buffers, so these ARE the perceived levels):
 * footsteps, ticks and UI taps well under everything, swings under hits, fanfares on top. At default settings a hit
 * is heard at ≈ −21 dBFS (K-weighted, loudest 100 ms, before the master compressor); `amb` plays on the ambience
 * bus (−7 dB further down at default settings). The loudness table in tests/audio-bank.test.ts guards all of it.
 */
export const GROUP_DB: Readonly<Record<GroupId, number>> = {
  step: -13,
  tick: -12.5,
  amb: -12,
  ui: -7,
  impact: -7.5,
  proj: -7,
  status: -5,
  monster: -4.5,
  swing: -4,
  coin: -3,
  zap: -3,
  warp: -1.5,
  crit: -1.5,
  gather: -1,
  cast: -1,
  telegraph: -1,
  quest: -0.5,
  hit: 0,
  hurt: 0,
  death: 0,
  nova: 2,
  combo: 2.5,
  boss: 3,
  fanfare: 4,
};

/** A hit's linear gain on a normalised buffer (the mix reference, 0 dB in GROUP_DB). */
export const HIT_GAIN = 0.39;

const dbToGain = (db: number): number => 10 ** (db / 20);

/** Linear mix gain per group (from GROUP_DB). */
export const GROUP_GAIN: Readonly<Record<GroupId, number>> = Object.fromEntries(
  Object.entries(GROUP_DB).map(([g, db]) => [g, HIT_GAIN * dbToGain(db)]),
) as Record<GroupId, number>;

/** A sound's linear mix gain: its group's level plus its trim. */
export const gainOf = (def: SoundDef): number => GROUP_GAIN[def.group] * dbToGain(def.trim ?? 0);

/** Readable ZzFX parameters (mapped 1:1 onto the ZzFX array; see src/game/audio/zzfx.ts). */
interface Z {
  /** volume */ v?: number;
  /** frequency randomness (fraction) */ rnd?: number;
  /** frequency (Hz) */ f?: number;
  /** attack / sustain / release / decay (s) */ a?: number;
  s?: number;
  r?: number;
  d?: number;
  /** 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square (curve = duty) */ sh?: number;
  curve?: number;
  /** pitch slide (≈ 500 Hz/s per unit) and its acceleration */ slide?: number;
  dslide?: number;
  /** pitch jump (Hz) after jumpT (s) */ jump?: number;
  jumpT?: number;
  /** repeat period (s): resets pitch; with trem, the tremolo period */ rep?: number;
  /** noise amount (band-limited noise around f) */ noise?: number;
  /** frequency modulation rate (Hz, full depth) */ mod?: number;
  crush?: number;
  /** echo delay (s) */ delay?: number;
  /** sustain volume */ sv?: number;
  trem?: number;
  /** > 0 high-pass, < 0 low-pass (cutoff ≈ 2·|filt| Hz) */ filt?: number;
}

const z = (o: Z): ZzfxParams => [
  o.v ?? 1,
  o.rnd ?? 0,
  o.f ?? 220,
  o.a ?? 0,
  o.s ?? 0,
  o.r ?? 0.1,
  o.sh ?? 0,
  o.curve ?? 1,
  o.slide ?? 0,
  o.dslide ?? 0,
  o.jump ?? 0,
  o.jumpT ?? 0,
  o.rep ?? 0,
  o.noise ?? 0,
  o.mod ?? 0,
  o.crush ?? 0,
  o.delay ?? 0,
  o.sv ?? 1,
  o.d ?? 0,
  o.trem ?? 0,
  o.filt ?? 0,
];

const L = (o: Z, at = 0, gain = 1): Layer => ({ p: z(o), at, gain });

// Small reusable layers.
/** A soft low "thump" that reads as weight on phone speakers (starts ≥ 200 Hz). */
const thump = (f = 260, at = 0, v = 0.4, r = 0.06): Layer => L({ f, sh: 1, a: 0.002, r, slide: -(f * 0.35) / (500 * (r + 0.002)), v }, at);
/** A short bright noise tick (contact / crack). */
const crack = (f = 1800, at = 0, v = 0.3, r = 0.04): Layer => L({ f, noise: 3, a: 0.001, r, filt: 700, v }, at);
/** Fire crackle: gated high noise. */
const crackle = (at = 0, v = 0.3, s = 0.03): Layer => L({ f: 1800, noise: 2.5, a: 0.002, s, r: 0.05, rep: 0.012, trem: 0.7, filt: 700, v }, at);
/** A small reward "plink" at the end of gathers. */
const plink = (at = 0.12, f = 1046.5, v = 0.2): Layer => L({ f, sh: 1, a: 0.002, r: 0.12, v }, at);
/** A musical note (triangle body + a quiet octave sparkle). */
const note = (f: number, at: number, r = 0.16, v = 0.42, s = 0.03): Layer[] => [
  L({ f, sh: 1, a: 0.004, s, r, v }, at),
  L({ f: f * 2, a: 0.004, s: s * 0.5, r: r * 0.7, v: v * 0.22 }, at),
];
/** A soft chiptune "brass" note (low-passed square) for fanfare bodies. */
const brass = (f: number, at: number, r = 0.18, v = 0.11, s = 0.04): Layer => L({ f, sh: 5, curve: 1, a: 0.006, s, r, filt: -1500, v }, at);
/** A rising sparkle tail. */
const sparkle = (at: number, v = 0.12, base = 2093): Layer[] => [
  L({ f: base, a: 0.005, r: 0.18, v, rep: 0.05, trem: 0.5 }, at),
  L({ f: base * 1.26, a: 0.005, r: 0.2, v: v * 0.8, rep: 0.045, trem: 0.5 }, at + 0.06),
  L({ f: base * 1.5, a: 0.005, r: 0.26, v: v * 0.7, rep: 0.04, trem: 0.5 }, at + 0.12),
];
/** A dust / smoke poof. */
const poof = (at = 0, v = 0.3, r = 0.14): Layer => L({ f: 900, noise: 4, a: 0.01, r, slide: -2, filt: -1300, v }, at);

const Hz = { C4: 261.63, D4: 293.66, E4: 329.63, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, Gs5: 830.61, A5: 880, B5: 987.77, C6: 1046.5, D6: 1174.66, E6: 1318.51, G6: 1567.98, A6: 1760, B6: 1975.53, C7: 2093, E7: 2637.02 };

// ------------------------------------------------------------------ elements

export type ElementKey = ElementId | 'physical';
export const ELEMENT_KEYS: readonly ElementKey[] = ['physical', 'fire', 'water', 'earth', 'wind', 'lightning', 'shadow', 'holy', 'ice', 'magma', 'storm', 'twilight'];

/** An element's voice: the ZzFX timbre every spell of that element is built from, plus a musical root for buffs. */
interface Timbre {
  f: number;
  sh: number;
  noise: number;
  filt: number;
  mod?: number;
  crush?: number;
  /** Crackle / grain gating period (s). */
  rep?: number;
  trem?: number;
  root: number;
}

const TIMBRE: Readonly<Record<ElementKey, Timbre>> = {
  physical: { f: 620, sh: 0, noise: 2.4, filt: 260, root: Hz.B4 },
  fire: { f: 760, sh: 0, noise: 3, filt: -2200, rep: 0.013, trem: 0.45, root: Hz.C5 },
  water: { f: 540, sh: 0, noise: 3.4, filt: -1500, root: Hz.A4 },
  earth: { f: 320, sh: 1, noise: 1.4, filt: -1200, crush: 0.02, root: Hz.E4 },
  wind: { f: 1050, sh: 0, noise: 2.6, filt: 450, root: Hz.E5 },
  lightning: { f: 1050, sh: 2, noise: 0.5, filt: -1700, rep: 0.021, root: Hz.G5 },
  shadow: { f: 380, sh: 0, noise: 1.3, filt: -1000, rep: 0.07, trem: 0.35, root: Hz.D4 },
  holy: { f: 1046.5, sh: 1, noise: 0, filt: 0, root: Hz.A5 },
  ice: { f: 1900, sh: 1, noise: 0.4, filt: 650, root: Hz.B5 },
  magma: { f: 340, sh: 0, noise: 2.2, filt: -1300, rep: 0.016, trem: 0.5, root: Hz.G4 },
  storm: { f: 920, sh: 2, noise: 1.2, filt: -1600, rep: 0.026, root: Hz.F5 },
  twilight: { f: 640, sh: 0, noise: 0.8, filt: -1500, rep: 0.09, trem: 0.3, root: Hz.D5 },
};

/** Timbre → ZzFX fields (the shape template adds the envelope and motion). */
const tz = (t: Timbre, o: Z): Z => ({ sh: t.sh, noise: t.noise, filt: t.filt, mod: t.mod, crush: t.crush, rep: t.rep, trem: t.trem, rnd: 0.04, ...o, f: o.f ?? t.f });

export type CastShape = ShapeKind | 'ward';
export const CAST_SHAPES: readonly CastShape[] = ['strike', 'spin', 'projectile', 'nova', 'chain', 'dash', 'buff', 'ward'];

/** Spell casts by shape × element: one shape template (envelope, motion) voiced by the element's timbre. */
function castDef(shape: CastShape, el: ElementKey): SoundDef {
  const t = TIMBRE[el];
  const tonal = t.noise < 0.6;
  // v4 kinds borrow the nearest v2 template until the audio lane voices them.
  if (shape === 'zone') return castDef('nova', el);
  if (shape === 'blink') return castDef('dash', el);
  if (shape === 'mend' || shape === 'shield') return castDef('buff', el);
  switch (shape) {
    case 'strike': // the element's sheen on a weapon swing
      return { group: 'cast', trim: -5, layers: [L(tz(t, { f: t.f * 1.1, a: 0.005, s: 0.02, r: 0.09, slide: 1, v: 0.55 }))] };
    case 'spin': // a whirl: gated in a rotating rhythm
      return {
        group: 'cast',
        layers: [L(tz(t, { a: 0.03, s: 0.12, r: 0.12, rep: 0.05, trem: 0.55, slide: 0.6, v: 0.6 })), L({ f: 520, noise: 2.4, a: 0.03, s: 0.1, r: 0.1, rep: 0.05, trem: 0.5, filt: 230, v: 0.35 })],
      };
    case 'projectile': // launch "fwoom" with a tonal tail for tonal elements
      return {
        group: 'cast',
        layers: [L(tz(t, { a: 0.008, s: 0.03, r: 0.14, slide: -2, v: 0.6 })), ...(tonal ? [L({ f: t.root * 2, sh: 1, a: 0.004, r: 0.12, slide: -1, v: 0.2 })] : [L({ f: 900, noise: 2.5, a: 0.01, r: 0.1, slide: -2, filt: 400, v: 0.3 })])],
      };
    case 'nova': // rising gather toward the landing point
      return { group: 'cast', layers: [L(tz(t, { f: t.f * 0.7, a: 0.07, s: 0.05, r: 0.12, slide: 3, v: 0.6 })), L({ f: t.root, sh: 1, a: 0.06, s: 0.04, r: 0.12, slide: 1.5, v: 0.18 })] };
    case 'chain': // crackling charge
      return {
        group: 'cast',
        layers: [L(tz(t, { f: t.f * 1.3, a: 0.004, s: 0.05, r: 0.1, rep: 0.022, jump: t.f * 0.3, jumpT: 0.011, v: 0.5 })), L({ f: 1400, sh: 2, s: 0.03, r: 0.05, rep: 0.017, jump: 300, jumpT: 0.008, filt: -1800, v: 0.25 })],
      };
    case 'dash': // fast rush of air
      return { group: 'cast', layers: [L(tz(t, { f: t.f * 1.2, noise: t.noise + 1, a: 0.006, s: 0.03, r: 0.16, slide: -5, v: 0.6 })), L({ f: 700, noise: 3, a: 0.006, s: 0.02, r: 0.14, slide: -4, filt: 300, v: 0.35 })] };
    case 'buff': {
      // a rising major arpeggio on the element's root, with its timbre underneath
      const r = t.root;
      return {
        group: 'cast',
        pitchVar: 0,
        variations: 1,
        layers: [...note(r, 0, 0.16, 0.36), ...note(r * 1.26, 0.07, 0.16, 0.34), ...note(r * 1.5, 0.14, 0.24, 0.34), L(tz(t, { a: 0.04, s: 0.06, r: 0.16, slide: 2, v: 0.25 }))],
      };
    }
    case 'ward': {
      // a held root + fifth with a shield "clink"
      const r = t.root;
      return {
        group: 'cast',
        pitchVar: 0,
        variations: 1,
        layers: [L({ f: r, sh: 1, a: 0.03, s: 0.14, r: 0.26, rep: 0.09, trem: 0.25, v: 0.35 }), L({ f: r * 1.5, sh: 1, a: 0.04, s: 0.12, r: 0.26, rep: 0.11, trem: 0.25, v: 0.25 }, 0.03), L({ f: r * 4, sh: 1, a: 0.001, r: 0.1, v: 0.18 }, 0.02), L(tz(t, { a: 0.02, s: 0.05, r: 0.12, v: 0.18 }))],
      };
    }
  }
}

/** The wind-up hum of a skill with a cast time (castStart). */
function chargeDef(el: ElementKey): SoundDef {
  const t = TIMBRE[el];
  return { group: 'cast', trim: -3, layers: [L(tz(t, { f: t.f * 0.6, a: 0.12, s: 0.08, r: 0.08, slide: 2, v: 0.55 })), L({ f: t.root, sh: 1, a: 0.1, s: 0.08, r: 0.08, slide: 1, v: 0.15 })] };
}

/** Element hits (the most played sounds in the game: short, punchy, never harsh). */
const HITS: Readonly<Record<ElementKey, Layer[]>> = {
  physical: [L({ f: 290, sh: 1, a: 0.002, r: 0.07, slide: -2.5, v: 0.8, rnd: 0.08 }), L({ f: 1500, noise: 3, a: 0.001, r: 0.055, filt: -2400, v: 0.5, rnd: 0.1 })],
  fire: [L({ f: 900, noise: 3, a: 0.004, s: 0.02, r: 0.12, slide: -3, filt: -2200, v: 0.6, rnd: 0.08 }), crackle(0.01, 0.28), thump(220, 0, 0.4)],
  water: [L({ f: 700, noise: 4, a: 0.003, r: 0.1, filt: -1800, v: 0.55, rnd: 0.08 }), L({ f: 380, a: 0.002, r: 0.07, slide: 18, v: 0.35, rnd: 0.06 }, 0.005), thump(230, 0, 0.3)],
  earth: [L({ f: 260, sh: 1, a: 0.002, r: 0.1, slide: -1.5, v: 0.85, rnd: 0.06 }), L({ f: 800, noise: 3, a: 0.002, s: 0.02, r: 0.08, crush: 0.03, filt: -1600, v: 0.4, rnd: 0.08 })],
  wind: [L({ f: 1400, noise: 3.5, a: 0.004, r: 0.1, slide: -6, filt: 500, v: 0.6, rnd: 0.08 }), thump(300, 0, 0.3, 0.05)],
  lightning: [L({ f: 1300, sh: 2, a: 0.001, s: 0.02, r: 0.07, rep: 0.021, jump: -500, jumpT: 0.01, noise: 0.6, filt: -1700, v: 0.45, rnd: 0.08 }), thump(250, 0, 0.35, 0.05)],
  shadow: [L({ f: 380, noise: 1.5, a: 0.006, s: 0.03, r: 0.14, slide: -1.2, rep: 0.06, trem: 0.35, filt: -1100, v: 0.7, rnd: 0.06 }), L({ f: 1200, noise: 3, r: 0.05, filt: -1800, v: 0.25 })],
  holy: [L({ f: Hz.E6, sh: 1, a: 0.002, r: 0.18, v: 0.42 }), L({ f: Hz.B6, a: 0.002, r: 0.14, v: 0.22 }), thump(280, 0, 0.35, 0.05)],
  ice: [L({ f: 2350, sh: 1, a: 0.001, r: 0.06, jump: 700, jumpT: 0.015, v: 0.33, rnd: 0.05 }), L({ f: 1800, noise: 1.5, a: 0.001, r: 0.05, filt: 900, v: 0.35 }), thump(260, 0, 0.35, 0.05)],
  magma: [L({ f: 250, sh: 1, a: 0.002, r: 0.12, slide: -1.3, v: 0.85, rnd: 0.06 }), L({ f: 800, noise: 3, s: 0.03, r: 0.1, rep: 0.013, trem: 0.6, filt: -2000, v: 0.4, rnd: 0.08 })],
  storm: [L({ f: 1150, sh: 2, a: 0.001, s: 0.02, r: 0.07, rep: 0.024, jump: -400, jumpT: 0.012, noise: 0.8, filt: -1600, v: 0.4, rnd: 0.08 }), L({ f: 900, noise: 3.5, a: 0.006, r: 0.12, slide: -4, filt: 350, v: 0.4 }), thump(240, 0, 0.3)],
  twilight: [L({ f: 560, noise: 0.8, a: 0.004, s: 0.03, r: 0.16, slide: -1.2, rep: 0.07, trem: 0.35, filt: -1600, v: 0.5, rnd: 0.05 }), L({ f: Hz.G6, sh: 1, a: 0.003, r: 0.12, v: 0.2 }), thump(250, 0, 0.35)],
};

// ------------------------------------------------------------------ the bank

const S: Record<string, SoundDef> = {
  // ---------------------------------------------------------------- footsteps (synced to the walk frames)
  step_grass: { group: 'step', variations: 4, pitchVar: 0.08, layers: [L({ f: 1600, noise: 3, a: 0.004, s: 0.008, r: 0.045, filt: 650, v: 0.55, rnd: 0.15 }), L({ f: 260, sh: 1, a: 0.002, r: 0.03, slide: -4, v: 0.3 })] },
  step_dirt: { group: 'step', variations: 4, pitchVar: 0.08, layers: [L({ f: 310, sh: 1, a: 0.003, r: 0.06, slide: -1.6, v: 0.6, rnd: 0.1 }), L({ f: 1000, noise: 3, a: 0.002, r: 0.05, filt: -1700, v: 0.55, rnd: 0.15 }, 0.003)] },
  step_stone: { group: 'step', variations: 4, pitchVar: 0.07, layers: [L({ f: 720, sh: 1, a: 0.003, r: 0.05, slide: -3.5, v: 0.45, rnd: 0.1 }), L({ f: 2600, noise: 2, a: 0.002, r: 0.045, filt: 900, v: 0.32, rnd: 0.1 }, 0.007)] },
  step_wood: { group: 'step', variations: 4, pitchVar: 0.06, layers: [L({ f: 340, a: 0.002, r: 0.07, slide: -1, v: 0.55, rnd: 0.08 }), L({ f: 620, sh: 1, a: 0.001, r: 0.04, v: 0.22, rnd: 0.08 }), crack(1500, 0, 0.12, 0.02)] },
  step_sand: { group: 'step', variations: 4, pitchVar: 0.08, layers: [L({ f: 1300, noise: 4, a: 0.01, r: 0.07, rep: 0.006, trem: 0.4, filt: -2200, v: 0.5, rnd: 0.15 })] },
  step_snow: { group: 'step', variations: 4, pitchVar: 0.08, layers: [L({ f: 1100, noise: 4, a: 0.008, s: 0.02, r: 0.07, rep: 0.009, trem: 0.55, filt: -2600, v: 0.5, rnd: 0.15 }), thump(260, 0, 0.18, 0.03)] },
  step_water: { group: 'step', variations: 4, pitchVar: 0.08, layers: [L({ f: 650, noise: 4, a: 0.004, r: 0.09, filt: -1400, v: 0.45, rnd: 0.12 }), L({ f: 500, a: 0.002, r: 0.05, slide: 25, v: 0.2, rnd: 0.1 }, 0.01)] },
  step_cave: { group: 'step', variations: 4, pitchVar: 0.07, layers: [L({ f: 540, sh: 1, a: 0.001, r: 0.045, slide: -3.5, v: 0.45, rnd: 0.1 }), L({ f: 1800, noise: 2, a: 0.001, r: 0.035, filt: 600, v: 0.28, rnd: 0.1 })] },

  // ---------------------------------------------------------------- weapon swings
  swing_sword_light: { group: 'swing', trim: -1, variations: 3, pitchVar: 0.06, layers: [L({ f: 700, noise: 2.2, a: 0.02, s: 0.015, r: 0.08, slide: 2, filt: 300, v: 0.7, rnd: 0.1 })] },
  swing_sword_heavy: { group: 'swing', trim: 1.5, variations: 3, pitchVar: 0.05, layers: [L({ f: 430, noise: 2.6, a: 0.035, s: 0.03, r: 0.14, slide: -1.5, filt: 180, v: 0.8, rnd: 0.08 }), L({ f: 230, sh: 1, a: 0.03, r: 0.12, slide: -1, v: 0.22 })] },
  swing_dagger_light: { group: 'swing', trim: -1.5, variations: 3, pitchVar: 0.07, layers: [L({ f: 1100, noise: 1.8, a: 0.008, s: 0.005, r: 0.05, slide: 4, filt: 500, v: 0.6, rnd: 0.1 })] },
  swing_dagger_heavy: { group: 'swing', trim: 0.5, variations: 3, pitchVar: 0.06, layers: [L({ f: 1000, noise: 2, a: 0.008, r: 0.05, slide: 4, filt: 500, v: 0.6, rnd: 0.1 }), L({ f: 1250, noise: 2, a: 0.008, r: 0.06, slide: 4, filt: 500, v: 0.55, rnd: 0.1 }, 0.065)] },
  swing_staff_light: { group: 'swing', trim: -1, variations: 3, pitchVar: 0.06, layers: [L({ f: 470, noise: 2, a: 0.025, s: 0.02, r: 0.1, slide: -0.8, filt: 150, v: 0.7, rnd: 0.08 })] },
  swing_staff_heavy: { group: 'swing', trim: 1.5, variations: 3, pitchVar: 0.05, layers: [L({ f: 390, noise: 2.4, a: 0.04, s: 0.04, r: 0.16, slide: -0.8, filt: 150, v: 0.8, rnd: 0.08 }), L({ f: 260, sh: 1, a: 0.04, r: 0.14, v: 0.2 })] },
  swing_spin: { group: 'swing', trim: -1.5, variations: 2, layers: [L({ f: 600, noise: 2.4, a: 0.03, s: 0.08, r: 0.1, rep: 0.045, trem: 0.55, slide: 1, filt: 250, v: 0.7, rnd: 0.08 })] },
  mon_swing: { group: 'monster', variations: 3, layers: [L({ f: 420, noise: 2.6, a: 0.03, s: 0.02, r: 0.12, slide: -1.2, filt: 150, v: 0.6, rnd: 0.1 })] },

  // ---------------------------------------------------------------- hits (+ the crit layer and a resisted tunk)
  crit: { group: 'crit', variations: 2, layers: [L({ f: Hz.A6, sh: 1, a: 0.001, r: 0.12, jump: 440, jumpT: 0.03, v: 0.33 }), L({ f: Hz.E7, a: 0.001, r: 0.1, v: 0.16 }), thump(300, 0, 0.5, 0.07), crack(2200, 0, 0.28)] },
  hit_resist: { group: 'hit', trim: -4, layers: [L({ f: 900, sh: 1, a: 0.001, r: 0.05, slide: -2, v: 0.35 }), thump(260, 0, 0.35, 0.04)] },

  // ---------------------------------------------------------------- projectiles, chains, novas
  proj_whoosh: { group: 'proj', variations: 3, layers: [L({ f: 950, noise: 2.5, a: 0.012, s: 0.02, r: 0.11, slide: -2, filt: 400, v: 0.6, rnd: 0.1 })] },
  proj_wall: { group: 'impact', variations: 2, layers: [thump(260, 0, 0.6), L({ f: 1200, noise: 3, r: 0.05, crush: 0.02, filt: -2000, v: 0.4, rnd: 0.1 })] },
  proj_fizzle: { group: 'impact', trim: -2.5, layers: [L({ f: 1400, noise: 3, a: 0.005, r: 0.09, slide: -4, filt: 700, v: 0.35, rnd: 0.1 })] },
  proj_catch: { group: 'impact', layers: [L({ f: Hz.A6, sh: 1, a: 0.001, r: 0.07, jump: 300, jumpT: 0.02, v: 0.35 }), thump(400, 0, 0.3, 0.04)] },
  mon_shot: { group: 'monster', variations: 2, layers: [L({ f: 600, noise: 2.2, a: 0.015, s: 0.02, r: 0.12, slide: -1.5, filt: 250, v: 0.6, rnd: 0.1 })] },
  zap_chain: { group: 'zap', variations: 3, layers: [L({ f: 1150, sh: 2, a: 0.001, s: 0.03, r: 0.07, rep: 0.018, jump: 350, jumpT: 0.009, noise: 0.5, filt: -1800, v: 0.45, rnd: 0.08 }), crack(2400, 0, 0.18, 0.03)] },
  knife_ricochet: { group: 'zap', variations: 3, layers: [L({ f: 2600, sh: 1, a: 0.001, r: 0.07, jump: -700, jumpT: 0.012, v: 0.33, rnd: 0.05 }), crack(1800, 0, 0.18, 0.02)] },
  nova_s: { group: 'nova', trim: -1.5, variations: 2, layers: [L({ f: 300, noise: 3, a: 0.005, s: 0.03, r: 0.2, slide: -0.5, filt: -1100, v: 0.8, rnd: 0.06 }), crack(1600, 0, 0.3, 0.07)] },
  nova_m: { group: 'nova', variations: 2, layers: [L({ f: 280, noise: 3, a: 0.006, s: 0.05, r: 0.32, slide: -0.3, filt: -1050, v: 0.85, rnd: 0.06 }), crack(1500, 0, 0.32, 0.09), thump(240, 0, 0.5, 0.1)] },
  nova_l: { group: 'nova', trim: 1.5, variations: 2, layers: [L({ f: 270, noise: 3, a: 0.008, s: 0.07, r: 0.5, slide: -0.15, filt: -1000, delay: 0.07, v: 0.9, rnd: 0.06 }), crack(1400, 0, 0.35, 0.12), thump(220, 0, 0.55, 0.14), poof(0.08, 0.3, 0.3)] },

  // ---------------------------------------------------------------- statuses applied and their ticks
  status_burn: { group: 'status', layers: [L({ f: 500, noise: 3, a: 0.03, s: 0.04, r: 0.12, slide: 3, filt: -2000, v: 0.6, rnd: 0.08 }), crackle(0.04, 0.25)] },
  status_soak: { group: 'status', layers: [L({ f: 600, noise: 4, a: 0.005, r: 0.12, filt: -1500, v: 0.5, rnd: 0.1 }), L({ f: 420, r: 0.06, slide: 12, v: 0.25 })] },
  status_stun: { group: 'status', layers: [L({ f: 1250, sh: 1, a: 0.002, s: 0.05, r: 0.2, rep: 0.06, trem: 0.5, v: 0.3 }), L({ f: 1500, sh: 1, a: 0.002, s: 0.05, r: 0.2, rep: 0.07, trem: 0.5, v: 0.2 }, 0.02), thump(300, 0, 0.5)] },
  status_shock: { group: 'status', variations: 2, layers: [L({ f: 1500, sh: 2, s: 0.04, r: 0.06, rep: 0.016, jump: 400, jumpT: 0.008, noise: 0.6, filt: -2000, v: 0.35, rnd: 0.08 })] },
  status_freeze: { group: 'status', layers: [L({ f: 2100, sh: 1, a: 0.001, r: 0.1, jump: 500, jumpT: 0.03, v: 0.3 }), L({ f: 2800, sh: 1, a: 0.001, r: 0.12, v: 0.18 }, 0.04), L({ f: 1500, noise: 2, a: 0.02, r: 0.15, slide: 2, filt: 800, v: 0.3 })] },
  status_bleed: { group: 'status', layers: [L({ f: 1200, noise: 2, a: 0.002, r: 0.06, slide: -6, filt: 400, v: 0.45, rnd: 0.08 }), L({ f: 900, r: 0.05, slide: -12, v: 0.2 }, 0.04)] },
  status_smite: { group: 'status', layers: [L({ f: Hz.G6, sh: 1, r: 0.25, v: 0.3 }), L({ f: Hz.C7, r: 0.2, v: 0.18 }, 0.03)] },
  status_slow: { group: 'status', layers: [L({ f: 500, sh: 1, a: 0.01, s: 0.05, r: 0.15, slide: -2.5, v: 0.3 })] },
  status_knockback: { group: 'status', layers: [thump(220, 0, 0.5, 0.08), L({ f: 800, noise: 3, a: 0.005, r: 0.1, slide: -3, filt: 300, v: 0.4, rnd: 0.08 })] },
  status_poison: { group: 'status', layers: [L({ f: 330, a: 0.003, r: 0.05, slide: 10, v: 0.35 }), L({ f: 420, r: 0.05, slide: 10, v: 0.3 }, 0.07)] },
  status_pull: { group: 'status', layers: [L({ f: 500, noise: 2.5, a: 0.12, r: 0.03, slide: 4, filt: 250, v: 0.6, rnd: 0.08 })] },
  status_blocked: { group: 'status', trim: 1.5, priority: 4, layers: [L({ f: Hz.B6, sh: 1, r: 0.12, v: 0.3 }), thump(300, 0, 0.3, 0.04)] },
  tick_burn: { group: 'tick', variations: 3, layers: [L({ f: 1700, noise: 2.5, s: 0.02, r: 0.05, rep: 0.01, trem: 0.6, filt: 600, v: 0.4, rnd: 0.1 })] },
  tick_poison: { group: 'tick', variations: 3, layers: [L({ f: 300, r: 0.05, slide: 9, v: 0.35, rnd: 0.1 })] },
  tick_bleed: { group: 'tick', variations: 3, layers: [L({ f: 850, r: 0.05, slide: -10, v: 0.35, rnd: 0.1 })] },
  tick_shock: { group: 'tick', variations: 3, layers: [L({ f: 1600, sh: 2, s: 0.015, r: 0.03, rep: 0.012, jump: 300, jumpT: 0.006, filt: -2000, v: 0.25, rnd: 0.1 })] },
  tick: { group: 'tick', layers: [L({ f: 700, sh: 1, r: 0.04, v: 0.25 })] },

  // ---------------------------------------------------------------- combos
  combo_shatter: { group: 'combo', layers: [L({ f: 2200, noise: 3, a: 0.001, r: 0.12, filt: 900, v: 0.45 }), L({ f: Hz.E7, sh: 1, r: 0.14, jump: -400, jumpT: 0.02, v: 0.22 }), L({ f: 3136, sh: 1, r: 0.12, v: 0.16 }, 0.03), L({ f: 2349, sh: 1, r: 0.16, v: 0.18 }, 0.06), L({ f: 3520, sh: 1, r: 0.1, v: 0.12 }, 0.09), thump(260, 0, 0.5, 0.08)] },
  combo_conduct: { group: 'combo', layers: [L({ f: 900, sh: 2, s: 0.12, r: 0.12, rep: 0.02, jump: 300, jumpT: 0.01, slide: 6, noise: 0.5, filt: -2000, v: 0.4 }), L({ f: 600, noise: 4, r: 0.12, filt: -1600, v: 0.4 }), crack(2600, 0.1, 0.2, 0.05)] },
  combo_fan: { group: 'combo', layers: [L({ f: 400, noise: 3, a: 0.04, s: 0.1, r: 0.25, slide: 4, filt: -2200, v: 0.7 }), crackle(0.05, 0.3, 0.12), thump(230, 0, 0.4)] },
  combo: { group: 'combo', layers: [...note(Hz.E6, 0, 0.12, 0.3), ...note(Hz.A6, 0.05, 0.16, 0.28), thump(260, 0, 0.45)] },
  heal: { group: 'status', trim: 1, priority: 3, layers: [L({ f: Hz.A5, sh: 1, a: 0.02, r: 0.2, slide: 2, v: 0.3 }), L({ f: Hz.E6, a: 0.02, r: 0.18, slide: 2, v: 0.2 }, 0.05)] },

  // ---------------------------------------------------------------- the player getting hurt
  hurt: { group: 'hurt', variations: 3, layers: [L({ f: 330, sh: 1, a: 0.002, r: 0.09, slide: -2.5, v: 0.7, rnd: 0.06 }), L({ f: 1000, noise: 3, r: 0.05, filt: -1800, v: 0.35, rnd: 0.1 })] },
  hurt_heavy: { group: 'hurt', variations: 2, priority: 7, layers: [L({ f: 280, sh: 1, a: 0.002, s: 0.02, r: 0.16, slide: -1, v: 0.85, rnd: 0.05 }), L({ f: 700, noise: 3, s: 0.02, r: 0.12, crush: 0.02, filt: -1500, v: 0.45, rnd: 0.1 }), L({ f: 900, sh: 1, r: 0.12, slide: -3, v: 0.2 }, 0.02)] },
  hurt_dot: { group: 'tick', trim: 2, variations: 2, layers: [L({ f: 520, sh: 1, r: 0.05, slide: -4, v: 0.35, rnd: 0.05 })] },
  hurt_low: { group: 'hurt', trim: -6, priority: 5, layers: [L({ f: 280, sh: 1, a: 0.01, r: 0.08, slide: -0.6, v: 0.5 }), L({ f: 260, sh: 1, a: 0.01, r: 0.1, slide: -0.6, v: 0.4 }, 0.18)] },
  player_death: { group: 'fanfare', trim: -1.5, pitchVar: 0, variations: 1, layers: [thump(250, 0, 0.6, 0.12), ...note(Hz.C5, 0.05, 0.3, 0.35, 0.1), ...note(Hz.G4, 0.3, 0.4, 0.32, 0.1), ...note(Hz.E4, 0.6, 0.6, 0.32, 0.2)] },

  // ---------------------------------------------------------------- monsters: deaths by family (size = playback rate), wardens, tells
  death_beast: { group: 'death', variations: 2, layers: [L({ f: 520, sh: 2, a: 0.005, s: 0.03, r: 0.15, slide: -4, filt: -1300, v: 0.4, rnd: 0.06 }), thump(210, 0.08, 0.5, 0.1), poof(0.08, 0.25)] },
  death_sprite: { group: 'death', variations: 2, layers: [L({ f: 1200, a: 0.005, r: 0.15, slide: 10, v: 0.3 }), L({ f: Hz.C7, sh: 1, r: 0.2, v: 0.18 }, 0.05), L({ f: Hz.E7, sh: 1, r: 0.2, v: 0.13 }, 0.1), poof(0, 0.25)] },
  death_construct: { group: 'death', variations: 2, layers: [L({ f: 380, sh: 1, a: 0.001, r: 0.12, jump: -120, jumpT: 0.03, crush: 0.04, v: 0.5 }), L({ f: 1500, noise: 2.5, s: 0.1, r: 0.15, rep: 0.035, trem: 0.55, filt: -2600, v: 0.3 }, 0.05), thump(220, 0.12, 0.45, 0.1)] },
  death_revenant: { group: 'death', variations: 2, layers: [L({ f: 760, a: 0.03, s: 0.1, r: 0.35, slide: -1.6, mod: 5, noise: 0.2, filt: 180, v: 0.3 }), L({ f: 1200, noise: 4, a: 0.05, r: 0.3, filt: 600, v: 0.25 })] },
  death_fiend: { group: 'death', variations: 2, layers: [L({ f: 250, sh: 2, a: 0.01, s: 0.08, r: 0.2, slide: -1.5, noise: 0.4, filt: -1000, v: 0.5, rnd: 0.05 }), L({ f: 600, noise: 3, r: 0.2, slide: -2, filt: -1600, v: 0.4 })] },
  death_sylvan: { group: 'death', variations: 2, layers: [L({ f: 380, sh: 1, a: 0.02, s: 0.1, r: 0.15, rep: 0.03, trem: 0.5, slide: -0.5, filt: -1400, v: 0.35 }), L({ f: 2000, noise: 2.5, a: 0.03, s: 0.1, r: 0.2, filt: 700, v: 0.3 })] },
  death_swarm: { group: 'death', variations: 2, layers: [L({ f: 270, sh: 2, a: 0.005, s: 0.1, r: 0.25, rep: 0.012, trem: 0.5, slide: 1.5, filt: -1500, v: 0.3 }), poof(0.05, 0.22)] },
  death_wyrm: { group: 'death', variations: 2, layers: [L({ f: 320, sh: 2, a: 0.03, s: 0.15, r: 0.4, slide: -0.3, mod: 28, noise: 0.3, filt: 160, v: 0.4 }), thump(260, 0.3, 0.6, 0.2), poof(0.3, 0.3, 0.25)] },
  death_warden: { group: 'boss', variations: 1, pitchVar: 0, priority: 9, layers: [L({ f: 280, noise: 3, a: 0.005, s: 0.1, r: 0.7, slide: -0.12, filt: -1000, delay: 0.09, v: 0.7 }), L({ f: 320, sh: 2, a: 0.03, s: 0.2, r: 0.4, slide: -0.3, mod: 30, filt: 160, v: 0.32 }), ...note(Hz.G5, 0.45, 0.3, 0.22), ...note(Hz.C6, 0.55, 0.3, 0.22), ...note(Hz.G6, 0.65, 0.5, 0.2)] },
  boss_roar: { group: 'boss', variations: 1, layers: [L({ f: 300, sh: 2, a: 0.06, s: 0.35, r: 0.4, slide: -0.2, mod: 32, noise: 0.4, filt: 170, v: 0.45 }), L({ f: 700, noise: 4, a: 0.08, s: 0.3, r: 0.4, filt: -1400, v: 0.3 })] },
  boss_enrage: { group: 'boss', variations: 1, priority: 9, layers: [L({ f: 340, sh: 2, a: 0.05, s: 0.3, r: 0.35, slide: 0.3, mod: 36, noise: 0.4, filt: 170, v: 0.45 }), L({ f: 300, noise: 2.5, a: 0.2, s: 0.2, r: 0.3, slide: 3, filt: -2000, v: 0.45 }), crackle(0.2, 0.25, 0.2)] },
  tell: { group: 'telegraph', layers: [L({ f: Hz.A5, sh: 1, a: 0.005, s: 0.04, r: 0.06, v: 0.35 }), L({ f: Hz.D6, sh: 1, a: 0.005, s: 0.04, r: 0.08, v: 0.35 }, 0.09)] },
  tell_big: { group: 'telegraph', priority: 8, layers: [L({ f: Hz.D5, sh: 1, a: 0.01, s: 0.08, r: 0.1, rep: 0.1, trem: 0.4, v: 0.4 }), L({ f: Hz.G5, sh: 1, s: 0.1, r: 0.14, v: 0.4 }, 0.14), L({ f: 300, sh: 2, a: 0.03, s: 0.15, r: 0.1, mod: 25, filt: 170, v: 0.18 })] },
  tell_echo: { group: 'telegraph', trim: -3.5, priority: 6, layers: [L({ f: Hz.G6, a: 0.05, s: 0.1, r: 0.3, rep: 0.08, trem: 0.4, v: 0.15 }), L({ f: 2349, a: 0.05, r: 0.3, rep: 0.07, trem: 0.4, v: 0.1 }, 0.05)] },
  tell_cancel: { group: 'impact', trim: -2, layers: [L({ f: 900, sh: 1, r: 0.1, slide: -4, v: 0.25 })] },
  mon_dash: { group: 'monster', variations: 2, layers: [L({ f: 500, noise: 2.6, a: 0.01, s: 0.04, r: 0.15, slide: -3, filt: 250, v: 0.6, rnd: 0.08 })] },
  mon_buff: { group: 'monster', layers: [L({ f: 300, sh: 2, a: 0.04, s: 0.1, r: 0.15, mod: 20, filt: 170, v: 0.3 }), L({ f: 600, a: 0.05, r: 0.2, slide: 3, v: 0.15 })] },
  kill_elite: { group: 'coin', trim: -1, layers: [L({ f: Hz.E6, sh: 1, r: 0.15, v: 0.25 }), L({ f: Hz.A6, sh: 1, r: 0.2, v: 0.2 }, 0.06)] },

  // ---------------------------------------------------------------- big moments
  level_up: {
    group: 'fanfare',
    pitchVar: 0,
    variations: 1,
    layers: [
      L({ f: 400, noise: 1.5, a: 0.25, r: 0.1, slide: 6, filt: -2400, v: 0.25 }),
      ...note(Hz.C5, 0, 0.14),
      brass(Hz.C5, 0),
      ...note(Hz.E5, 0.09, 0.14),
      brass(Hz.E5, 0.09),
      ...note(Hz.G5, 0.18, 0.14),
      brass(Hz.G5, 0.18),
      ...note(Hz.C6, 0.3, 0.7, 0.4, 0.12),
      ...note(Hz.E6, 0.3, 0.7, 0.24, 0.12),
      ...note(Hz.G6, 0.3, 0.7, 0.18, 0.12),
      brass(Hz.C6, 0.3, 0.5, 0.1, 0.12),
      ...sparkle(0.42, 0.1),
    ],
  },
  discover_skill: { group: 'fanfare', pitchVar: 0, variations: 1, layers: [...note(Hz.G5, 0, 0.12, 0.38), ...note(Hz.B5, 0.07, 0.12, 0.36), ...note(Hz.D6, 0.14, 0.12, 0.36), ...note(Hz.G6, 0.21, 0.5, 0.34, 0.08), brass(Hz.G5, 0.21, 0.4, 0.08, 0.08), ...sparkle(0.3, 0.1)] },
  discover_element: {
    group: 'fanfare',
    pitchVar: 0,
    variations: 1,
    layers: [
      L({ f: 500, noise: 1.2, a: 0.4, s: 0.2, r: 0.5, filt: -1800, v: 0.18 }),
      ...note(Hz.C5, 0, 0.3, 0.3),
      ...note(Hz.D5, 0.1, 0.3, 0.3),
      ...note(Hz.E5, 0.2, 0.3, 0.3),
      ...note(Hz.Fs5, 0.3, 0.3, 0.3),
      ...note(Hz.Gs5 * 2, 0.42, 0.8, 0.26, 0.15),
      L({ f: Hz.Gs5, a: 0.1, s: 0.3, r: 0.6, rep: 0.11, trem: 0.35, v: 0.22 }, 0.4),
      ...sparkle(0.5, 0.1, 2349),
    ],
  },
  discover_class: {
    group: 'fanfare',
    pitchVar: 0,
    variations: 1,
    layers: [
      thump(260, 0, 0.5, 0.1),
      ...note(Hz.G4, 0, 0.14, 0.4),
      brass(Hz.G4, 0, 0.14, 0.13),
      ...note(Hz.D5, 0.12, 0.14, 0.4),
      brass(Hz.D5, 0.12, 0.14, 0.13),
      ...note(Hz.G5, 0.24, 0.14, 0.4),
      brass(Hz.G5, 0.24, 0.14, 0.13),
      thump(240, 0.38, 0.45, 0.12),
      ...note(Hz.B5, 0.38, 0.8, 0.3, 0.15),
      ...note(Hz.D6, 0.38, 0.8, 0.24, 0.15),
      ...note(Hz.G6, 0.38, 0.8, 0.2, 0.15),
      brass(Hz.G5, 0.38, 0.6, 0.12, 0.15),
      ...sparkle(0.52, 0.1),
    ],
  },
  discover_spark: { group: 'fanfare', pitchVar: 0, variations: 1, layers: [L({ f: 600, sh: 1, a: 0.01, s: 0.1, r: 0.06, slide: 12, v: 0.3 }), L({ f: 1800, noise: 2, r: 0.05, filt: 1000, v: 0.25 }, 0.16), ...note(Hz.E6, 0.17, 0.5, 0.36, 0.05), ...note(Hz.B6, 0.24, 0.45, 0.2, 0.05), ...sparkle(0.25, 0.12)] },
  discover_minor: { group: 'fanfare', trim: -3, pitchVar: 0, variations: 1, priority: 9, layers: [...note(Hz.E5, 0, 0.14, 0.36), ...note(Hz.A5, 0.09, 0.4, 0.34, 0.06), ...sparkle(0.16, 0.08)] },
  spark_crack: { group: 'crit', trim: 1.5, layers: [crack(2400, 0, 0.35, 0.05), L({ f: Hz.A6, sh: 1, r: 0.25, jump: 440, jumpT: 0.05, v: 0.25 }), L({ f: Hz.E7, sh: 1, r: 0.2, v: 0.16 }, 0.06)] },
  map_new: { group: 'quest', trim: -2, pitchVar: 0, variations: 1, layers: [...note(Hz.D5, 0, 0.3, 0.3, 0.05), ...note(Hz.Fs5, 0.16, 0.3, 0.3, 0.05), ...note(Hz.A5, 0.32, 0.6, 0.3, 0.1)] },

  // ---------------------------------------------------------------- quests
  quest_accept: { group: 'quest', pitchVar: 0, variations: 1, layers: [...note(Hz.A4, 0, 0.1, 0.4), ...note(Hz.D5, 0.08, 0.3, 0.4, 0.05)] },
  quest_ready: { group: 'quest', pitchVar: 0, variations: 1, layers: [...note(Hz.E5, 0, 0.1, 0.38), ...note(Hz.G5, 0.07, 0.1, 0.38), ...note(Hz.C6, 0.14, 0.35, 0.38, 0.05)] },
  quest_complete: {
    group: 'fanfare',
    pitchVar: 0,
    variations: 1,
    priority: 9,
    layers: [...note(Hz.C5, 0, 0.12), brass(Hz.C5, 0), ...note(Hz.E5, 0.08, 0.12), ...note(Hz.G5, 0.16, 0.12), brass(Hz.G5, 0.16), ...note(Hz.C6, 0.26, 0.55, 0.4, 0.1), ...note(Hz.G6, 0.26, 0.5, 0.18, 0.1), L({ f: Hz.B5, sh: 5, curve: 1, s: 0.03, r: 0.15, jump: 330, jumpT: 0.05, filt: -1700, v: 0.16 }, 0.4)],
  },
  quest_tick: { group: 'quest', trim: -9.5, layers: [L({ f: Hz.E6, sh: 1, r: 0.05, v: 0.3 })] },
  quest_abandon: { group: 'quest', pitchVar: 0, variations: 1, layers: [...note(Hz.D5, 0, 0.1, 0.35), ...note(Hz.A4, 0.09, 0.2, 0.35)] },

  // ---------------------------------------------------------------- gathering, coins, world objects
  gather_start: { group: 'gather', trim: -9, layers: [L({ f: 1200, sh: 1, r: 0.03, v: 0.3 })] },
  gather_ore: { group: 'gather', variations: 2, layers: [L({ f: 1900, sh: 1, a: 0.001, r: 0.09, jump: -600, jumpT: 0.012, v: 0.4, rnd: 0.04 }), crack(2600, 0, 0.25, 0.03), L({ f: 700, noise: 3, s: 0.03, r: 0.08, rep: 0.02, trem: 0.5, crush: 0.02, filt: -1800, v: 0.3 }, 0.05), plink()] },
  gather_fishing: { group: 'gather', variations: 2, layers: [L({ f: 650, noise: 4, a: 0.003, s: 0.03, r: 0.18, filt: -1600, v: 0.5, rnd: 0.08 }), L({ f: 350, r: 0.07, slide: 20, v: 0.3 }, 0.02), L({ f: 1200, r: 0.04, slide: 25, v: 0.15 }, 0.15), plink(0.2)] },
  gather_herb: { group: 'gather', variations: 2, layers: [L({ f: 2000, noise: 2.5, a: 0.02, s: 0.05, r: 0.12, rep: 0.03, trem: 0.5, filt: 700, v: 0.4, rnd: 0.1 }), L({ f: 1300, sh: 1, r: 0.03, v: 0.25 }, 0.1), plink(0.14)] },
  gather_ember_vent: { group: 'gather', variations: 2, layers: [L({ f: 450, noise: 3, a: 0.04, s: 0.05, r: 0.15, slide: 3, filt: -2000, v: 0.5 }), crackle(0.06, 0.3, 0.06), plink(0.18, Hz.C6)] },
  gather_wind_chime: { group: 'gather', pitchVar: 0.02, variations: 2, layers: [L({ f: Hz.E6, a: 0.002, r: 0.5, v: 0.3 }), L({ f: Hz.G6, a: 0.002, r: 0.5, v: 0.26 }, 0.08), L({ f: Hz.B6, a: 0.002, r: 0.5, v: 0.22 }, 0.16), L({ f: Hz.E7, a: 0.002, r: 0.6, v: 0.16 }, 0.26)] },
  gather_storm_tree: { group: 'gather', variations: 2, layers: [L({ f: 1300, sh: 2, s: 0.05, r: 0.08, rep: 0.02, jump: -400, jumpT: 0.01, noise: 0.6, filt: -1700, v: 0.4 }), L({ f: 340, sh: 1, a: 0.02, s: 0.06, r: 0.1, rep: 0.03, trem: 0.5, filt: -1200, v: 0.3 }, 0.08), plink(0.2)] },
  gather_shadow_fungus: { group: 'gather', variations: 2, layers: [L({ f: 380, a: 0.01, r: 0.08, slide: 7, noise: 0.4, filt: -1500, v: 0.45 }), L({ f: 700, r: 0.03, slide: 20, v: 0.3 }, 0.08), plink(0.16, Hz.A5)] },
  gather_sun_spring: { group: 'gather', variations: 2, layers: [L({ f: 1500, a: 0.03, s: 0.1, r: 0.3, rep: 0.06, trem: 0.4, v: 0.2 }), L({ f: 380, r: 0.07, slide: 18, v: 0.3 }), plink(0.18, Hz.E6)] },
  gather_frost_crystal: { group: 'gather', variations: 2, layers: [L({ f: Hz.E7, sh: 1, r: 0.1, v: 0.25 }), L({ f: 3136, sh: 1, r: 0.12, v: 0.2 }, 0.05), L({ f: 2349, sh: 1, r: 0.15, v: 0.2 }, 0.1), crack(2000, 0, 0.25, 0.04)] },
  coin: { group: 'coin', variations: 2, pitchVar: 0.02, layers: [L({ f: Hz.B5, sh: 5, curve: 1, a: 0.001, s: 0.03, r: 0.15, jump: 330, jumpT: 0.05, filt: -1700, v: 0.25 })] },
  chest_open: { group: 'gather', variations: 1, layers: [L({ f: 340, sh: 1, a: 0.02, s: 0.08, r: 0.1, rep: 0.035, trem: 0.5, slide: 1, filt: -1200, v: 0.4 }), thump(260, 0.18, 0.45), L({ f: Hz.B5, sh: 5, curve: 1, s: 0.03, r: 0.12, jump: 330, jumpT: 0.04, filt: -1700, v: 0.2 }, 0.25), L({ f: Hz.E6, sh: 5, curve: 1, s: 0.03, r: 0.12, jump: 440, jumpT: 0.04, filt: -1700, v: 0.18 }, 0.33), ...sparkle(0.36, 0.08)] },
  waystone: { group: 'gather', pitchVar: 0, variations: 1, layers: [L({ f: Hz.C5, a: 0.05, s: 0.2, r: 0.4, rep: 0.12, trem: 0.3, v: 0.22 }), L({ f: Hz.G5, a: 0.05, s: 0.2, r: 0.4, v: 0.15 }, 0.04), ...sparkle(0.2, 0.07)] },
  altar: { group: 'gather', pitchVar: 0, variations: 1, layers: [L({ f: Hz.G4, a: 0.08, s: 0.2, r: 0.5, rep: 0.15, trem: 0.3, v: 0.25 }), L({ f: Hz.D5, a: 0.08, s: 0.2, r: 0.5, rep: 0.13, trem: 0.3, v: 0.18 }, 0.05), L({ f: 600, noise: 1, a: 0.2, r: 0.4, filt: -1500, v: 0.12 })] },
  campfire: { group: 'gather', layers: [crackle(0, 0.35, 0.15), L({ f: 380, noise: 3, a: 0.05, r: 0.2, filt: -1400, v: 0.3 })] },

  // ---------------------------------------------------------------- UI taps, talk, warps
  ui_open: { group: 'ui', pitchVar: 0.02, layers: [L({ f: 660, sh: 1, a: 0.002, r: 0.05, v: 0.35 }), L({ f: 990, sh: 1, a: 0.002, r: 0.06, v: 0.3 }, 0.035)] },
  ui_close: { group: 'ui', pitchVar: 0.02, layers: [L({ f: 990, sh: 1, a: 0.002, r: 0.045, v: 0.3 }), L({ f: 660, sh: 1, a: 0.002, r: 0.06, v: 0.3 }, 0.03)] },
  ui_confirm: { group: 'ui', pitchVar: 0, layers: [L({ f: Hz.G5, sh: 1, a: 0.002, r: 0.06, v: 0.3 }), L({ f: Hz.D6, sh: 1, a: 0.002, r: 0.1, v: 0.3 }, 0.05)] },
  ui_nope: { group: 'ui', pitchVar: 0, layers: [L({ f: 262, sh: 5, curve: 1, a: 0.002, s: 0.03, r: 0.04, filt: -1100, v: 0.3 }), L({ f: 233, sh: 5, curve: 1, a: 0.002, s: 0.03, r: 0.06, filt: -1100, v: 0.3 }, 0.08)] },
  ui_tap: { group: 'ui', trim: -3, layers: [L({ f: 1500, sh: 1, a: 0.001, r: 0.03, v: 0.25 })] },
  ui_talk: { group: 'ui', variations: 2, layers: [L({ f: 620, sh: 5, curve: 1, s: 0.015, r: 0.03, filt: -1400, v: 0.2, rnd: 0.06 }), L({ f: 820, sh: 5, curve: 1, s: 0.015, r: 0.04, filt: -1400, v: 0.2, rnd: 0.06 }, 0.05)] },
  slot_set: { group: 'ui', pitchVar: 0.02, layers: [L({ f: 900, sh: 1, a: 0.001, r: 0.03, v: 0.3 }), L({ f: 1350, sh: 1, a: 0.001, r: 0.05, v: 0.25 }, 0.025)] },
  class_wear: { group: 'cast', trim: -1, pitchVar: 0, variations: 1, layers: [L({ f: 500, noise: 1.6, a: 0.06, r: 0.18, slide: 4, filt: -2200, v: 0.35 }), ...note(Hz.D5, 0.08, 0.2, 0.3), ...note(Hz.A5, 0.16, 0.3, 0.3)] },
  warp_out: { group: 'warp', pitchVar: 0.02, layers: [L({ f: 300, noise: 1.6, a: 0.12, s: 0.06, r: 0.2, slide: 6, filt: -2400, v: 0.5 }), L({ f: Hz.C6, a: 0.1, r: 0.3, slide: 4, rep: 0.06, trem: 0.4, v: 0.15 })] },
  warp_in: { group: 'warp', pitchVar: 0.02, layers: [L({ f: 900, noise: 1.2, a: 0.02, r: 0.35, slide: -3, filt: -2400, v: 0.35 }), L({ f: Hz.G6, a: 0.01, r: 0.3, slide: -2, v: 0.12 })] },

  // ---------------------------------------------------------------- ambience one-shots (scheduled by src/game/audio/ambience.ts)
  amb_bird_a: { group: 'amb', bus: 'ambience', trim: 2, variations: 3, pitchVar: 0.08, layers: [L({ f: 2700, a: 0.01, s: 0.18, r: 0.05, slide: 28, rep: 0.085, trem: 0.5, v: 0.3, rnd: 0.08 })] },
  amb_bird_b: { group: 'amb', bus: 'ambience', trim: 1, variations: 3, pitchVar: 0.08, layers: [L({ f: 3300, a: 0.005, s: 0.1, r: 0.06, slide: -25, rep: 0.05, trem: 0.5, v: 0.25, rnd: 0.08 })] },
  amb_bird_c: { group: 'amb', bus: 'ambience', trim: 1, variations: 2, pitchVar: 0.05, layers: [L({ f: 3950, a: 0.02, s: 0.1, r: 0.05, v: 0.25 }), L({ f: 3300, a: 0.02, s: 0.14, r: 0.06, v: 0.22 }, 0.2)] },
  amb_hawk: { group: 'amb', bus: 'ambience', trim: -2.5, variations: 2, layers: [L({ f: 2300, a: 0.03, s: 0.1, r: 0.4, slide: -3, v: 0.2, rnd: 0.05 })] },
  amb_cricket: { group: 'amb', bus: 'ambience', trim: -4, variations: 3, pitchVar: 0.03, layers: [L({ f: 4200, a: 0.01, s: 0.14, r: 0.03, rep: 0.02, trem: 0.5, v: 0.12, rnd: 0.03 })] },
  amb_owl: { group: 'amb', bus: 'ambience', trim: 1, variations: 2, pitchVar: 0.04, layers: [L({ f: 380, a: 0.04, s: 0.12, r: 0.15, slide: -0.3, v: 0.3 }), L({ f: 340, a: 0.05, s: 0.2, r: 0.25, slide: -0.3, v: 0.3 }, 0.35)] },
  amb_leaves: { group: 'amb', bus: 'ambience', trim: -1, variations: 3, layers: [L({ f: 2200, noise: 2, a: 0.3, s: 0.3, r: 0.6, rep: 0.05, trem: 0.3, filt: 600, v: 0.25, rnd: 0.1 })] },
  amb_gust: { group: 'amb', bus: 'ambience', trim: 2, variations: 3, layers: [L({ f: 520, noise: 5, a: 0.5, s: 0.4, r: 0.9, slide: 0.4, filt: -900, v: 0.35, rnd: 0.1 })] },
  amb_water_lap: { group: 'amb', bus: 'ambience', trim: 3.5, variations: 3, layers: [L({ f: 480, noise: 4, a: 0.3, s: 0.2, r: 0.6, filt: -800, v: 0.35, rnd: 0.1 })] },
  amb_plop: { group: 'amb', bus: 'ambience', variations: 3, layers: [L({ f: 420, r: 0.08, slide: 22, v: 0.3, rnd: 0.1 }), L({ f: 800, noise: 4, r: 0.06, filt: -1500, v: 0.15 })] },
  amb_drip: { group: 'amb', bus: 'ambience', trim: 2, variations: 4, pitchVar: 0.12, layers: [L({ f: 1100, a: 0.001, r: 0.07, slide: 35, v: 0.3, rnd: 0.1 })] },
  amb_pebble: { group: 'amb', bus: 'ambience', trim: -2.5, variations: 2, layers: [L({ f: 1700, sh: 1, r: 0.02, v: 0.2 }), L({ f: 1500, sh: 1, r: 0.02, v: 0.15 }, 0.07), L({ f: 1900, sh: 1, r: 0.015, v: 0.1 }, 0.12)] },
  amb_thunder: { group: 'amb', bus: 'ambience', trim: 7, variations: 3, layers: [L({ f: 230, noise: 5, a: 0.25, s: 0.5, r: 1.6, rep: 0.11, trem: 0.3, filt: -500, v: 0.6, rnd: 0.1 }), L({ f: 400, noise: 5, a: 0.05, s: 0.2, r: 0.9, filt: -800, v: 0.3 }, 0.1)] },
  amb_crackle: { group: 'amb', bus: 'ambience', trim: -1, variations: 3, layers: [L({ f: 1800, noise: 2.5, s: 0.08, r: 0.05, rep: 0.017, trem: 0.6, filt: 800, v: 0.2, rnd: 0.1 })] },
  amb_lava_bubble: { group: 'amb', bus: 'ambience', trim: 2, variations: 3, layers: [L({ f: 240, a: 0.02, r: 0.1, slide: 6, noise: 0.2, v: 0.4, rnd: 0.1 }), L({ f: 600, r: 0.03, slide: 15, v: 0.2 }, 0.1)] },
  amb_creak: { group: 'amb', bus: 'ambience', trim: -1, variations: 2, layers: [L({ f: 330, sh: 1, a: 0.08, s: 0.25, r: 0.2, rep: 0.04, trem: 0.5, slide: 0.4, filt: -1200, v: 0.25, rnd: 0.06 })] },
  amb_chime: { group: 'amb', bus: 'ambience', trim: -1, variations: 2, pitchVar: 0, layers: [L({ f: Hz.G6, a: 0.01, r: 0.9, v: 0.14 }), L({ f: Hz.C7, a: 0.01, r: 0.9, v: 0.1 }, 0.2), L({ f: Hz.E7, a: 0.01, r: 1, v: 0.08 }, 0.45)] },
  amb_moan: { group: 'amb', bus: 'ambience', variations: 2, layers: [L({ f: 230, sh: 1, a: 0.7, s: 0.5, r: 1.3, slide: 0.12, rep: 0.25, trem: 0.3, filt: -900, v: 0.25 })] },
  amb_chain: { group: 'amb', bus: 'ambience', trim: -4, variations: 2, layers: [L({ f: 2100, sh: 1, s: 0.12, r: 0.06, rep: 0.035, trem: 0.5, noise: 0.5, v: 0.15, rnd: 0.08 })] },
  amb_hammer: { group: 'amb', bus: 'ambience', trim: -4, variations: 2, layers: [L({ f: 1500, sh: 1, r: 0.08, jump: -500, jumpT: 0.01, delay: 0.11, v: 0.25, rnd: 0.04 })] },
  amb_murmur: { group: 'amb', bus: 'ambience', trim: -2.5, variations: 3, layers: [L({ f: 280, noise: 1.6, a: 0.3, s: 0.6, r: 0.5, rep: 0.17, trem: 0.4, filt: -700, v: 0.3, rnd: 0.1 })] },
  amb_ice_creak: { group: 'amb', bus: 'ambience', trim: -2.5, variations: 2, layers: [L({ f: 900, sh: 1, a: 0.05, s: 0.1, r: 0.15, rep: 0.025, trem: 0.5, slide: -0.5, filt: -2000, v: 0.15 })] },
};

for (const el of ELEMENT_KEYS) {
  S[`hit_${el}`] = { group: 'hit', variations: 3, pitchVar: 0.05, layers: HITS[el] };
  S[`charge_${el}`] = chargeDef(el);
  for (const shape of CAST_SHAPES) S[`cast_${shape}_${el}`] = castDef(shape, el);
}

/** Every sound by name. */
export const SOUNDS: Readonly<Record<string, SoundDef>> = S;

export function soundNames(): string[] {
  return Object.keys(SOUNDS).sort();
}

// ------------------------------------------------------------------ name helpers (what the bridge asks for)

const elKey = (el: ElementId | undefined): ElementKey => el ?? 'physical';

export const swingSound = (weapon: WeaponType, heavy: boolean): string => `swing_${weapon}_${heavy ? 'heavy' : 'light'}`;
export const hitSound = (el?: ElementId): string => `hit_${elKey(el)}`;
export const castSound = (shape: CastShape, el?: ElementId): string => `cast_${shape}_${elKey(el)}`;
export const chargeSound = (el?: ElementId): string => `charge_${elKey(el)}`;
export const stepSound = (surface: Surface): string => `step_${surface}`;
export const gatherSound = (node: NodeKind): string => (SOUNDS[`gather_${node}`] ? `gather_${node}` : 'gather_herb');

/** Nova boom by radius (px). */
export const novaSound = (radius: number): string => (radius >= 100 ? 'nova_l' : radius >= 64 ? 'nova_m' : 'nova_s');

const DEATH_BY_FAMILY: Readonly<Record<Family, string>> = {
  beast: 'death_beast',
  sprite: 'death_sprite',
  construct: 'death_construct',
  revenant: 'death_revenant',
  fiend: 'death_fiend',
  sylvan: 'death_sylvan',
  swarm: 'death_swarm',
  wyrm: 'death_wyrm',
};
export const deathSound = (family: Family): string => DEATH_BY_FAMILY[family] ?? 'death_beast';

const STATUS_SOUND: Readonly<Partial<Record<StatusKind, string>>> = {
  burn: 'status_burn',
  soak: 'status_soak',
  slow: 'status_slow',
  stun: 'status_stun',
  knockback: 'status_knockback',
  shock: 'status_shock',
  bleed: 'status_bleed',
  smite: 'status_smite',
  freeze: 'status_freeze',
  poison: 'status_poison',
  pull: 'status_pull',
};
export const statusSound = (kind: StatusKind): string | null => STATUS_SOUND[kind] ?? null;

const TICK_SOUND: Readonly<Partial<Record<StatusKind, string>>> = { burn: 'tick_burn', poison: 'tick_poison', bleed: 'tick_bleed', shock: 'tick_shock' };
export const tickSound = (kind: StatusKind): string => TICK_SOUND[kind] ?? 'tick';

export function comboSound(name: string): string {
  const n = name.toLowerCase();
  if (n.includes('shatter')) return 'combo_shatter';
  if (n.includes('conduct')) return 'combo_conduct';
  if (n.includes('flame') || n.includes('fan')) return 'combo_fan';
  return 'combo';
}

/** The fanfare of a discovery card kind (src/ui/dialogs.ts DiscoveryKind); null = the card has its own sound. */
export function discoverySound(kind: string): string | null {
  switch (kind) {
    case 'skill':
    case 'echo':
    case 'mastered':
      return 'discover_skill';
    case 'element':
      return 'discover_element';
    case 'class':
      return 'discover_class';
    case 'spark':
      return 'discover_spark';
    case 'quest':
    case 'reward':
      return null; // questChanged 'completed' already played quest_complete
    default:
      return 'discover_minor';
  }
}

// ------------------------------------------------------------------ building samples (pure)

/** Seconds a sound lasts (the longest layer end). */
export function soundDuration(def: SoundDef, sampleRate = 32000): number {
  let end = 0;
  for (const l of def.layers) end = Math.max(end, (l.at ?? 0) + zzfxSamples(l.p, sampleRate) / sampleRate);
  return end;
}

function zzfxSamples(p: ZzfxParams, sampleRate: number): number {
  const attack = (p[3] ?? 0) * sampleRate || 9;
  return Math.max(0, (attack + ((p[18] ?? 0) + (p[4] ?? 0) + (p[5] ?? 0.1) + (p[16] ?? 0)) * sampleRate) | 0);
}

/** Perceived loudness every buffer is normalised to (see `perceivedLoudness`). */
export const TARGET_LOUDNESS = 0.2;
/** Normalised buffers never peak above this (a sound limited by it lands under its level; the bank test flags it). */
export const PEAK_CEILING = 0.98;

/** Max RMS over windows of `ms` (10 ms hop), zero-padded: a sound shorter than the window counts as quieter. */
export function windowedLoudness(x: Float32Array, sampleRate: number, ms: number): number {
  const win = Math.max(1, Math.round((sampleRate * ms) / 1000));
  const hop = Math.max(1, Math.round(sampleRate * 0.01));
  let best = 0;
  for (let start = 0; start < Math.max(1, x.length - win + 1); start += hop) {
    let sum = 0;
    const end = Math.min(x.length, start + win);
    for (let i = start; i < end; i++) sum += x[i] * x[i];
    best = Math.max(best, sum / win);
  }
  return Math.sqrt(best);
}

/** Max RMS over 30 ms windows: the raw short-term level (kept for diagnostics). */
export function shortTermLoudness(x: Float32Array, sampleRate: number): number {
  return windowedLoudness(x, sampleRate, 30);
}

/** One RBJ biquad pass (Web Audio BiquadFilterNode maths; Q linear). */
function biquad(x: Float32Array, type: 'highpass' | 'highshelf', f0: number, q: number, sampleRate: number, gainDb = 0): Float32Array {
  const w = (2 * Math.PI * Math.min(f0, sampleRate * 0.45)) / sampleRate;
  const c = Math.cos(w);
  const alpha = Math.sin(w) / (2 * q);
  let b0: number, b1: number, b2: number, a0: number, a1: number, a2: number;
  if (type === 'highpass') {
    b0 = (1 + c) / 2;
    b1 = -(1 + c);
    b2 = (1 + c) / 2;
    a0 = 1 + alpha;
    a1 = -2 * c;
    a2 = 1 - alpha;
  } else {
    const A = 10 ** (gainDb / 40);
    const sq = 2 * Math.sqrt(A) * alpha;
    b0 = A * (A + 1 + (A - 1) * c + sq);
    b1 = -2 * A * (A - 1 + (A + 1) * c);
    b2 = A * (A + 1 + (A - 1) * c - sq);
    a0 = A + 1 - (A - 1) * c + sq;
    a1 = 2 * (A - 1 - (A + 1) * c);
    a2 = A + 1 - (A - 1) * c - sq;
  }
  const y = new Float32Array(x.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const v = (b0 * x[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
    x2 = x1;
    x1 = x[i];
    y2 = y1;
    y1 = v;
    y[i] = v;
  }
  return y;
}

/**
 * How loud a sound is heard (the normalisation measure): the engine's master high-pass (110 Hz), the BS.1770
 * K-weighting shelf (+4 dB above ~1.7 kHz, where the ear is most sensitive), then the loudest 100 ms. 100 ms is about
 * the ear's integration time, so a 20 ms tap counts quieter than a 200 ms swell of the same peak, as it sounds.
 */
export function perceivedLoudness(x: Float32Array, sampleRate: number): number {
  const weighted = biquad(biquad(x, 'highpass', 110, Math.SQRT1_2, sampleRate), 'highshelf', 1681, Math.SQRT1_2, sampleRate, 4);
  return windowedLoudness(weighted, sampleRate, 100);
}

/**
 * Mixes a sound's layers into one buffer and normalises its perceived loudness to TARGET_LOUDNESS (never peaking
 * above PEAK_CEILING), so the group level + trim alone set the mix. `variation` seeds the ZzFX randomness rolls
 * (each cached variation is a slightly different take; the same name + variation always builds the same samples).
 */
export function buildSound(name: string, def: SoundDef, sampleRate: number, variation = 0): Float32Array {
  const rng = mulberry32(hashSeed('omnipath-sfx', name, variation));
  const parts = def.layers.map((l) => ({ at: Math.round((l.at ?? 0) * sampleRate), gain: l.gain ?? 1, s: zzfxBuild(l.p, sampleRate, variation === 0 ? 0.5 : rng()) }));
  let len = 0;
  for (const p of parts) len = Math.max(len, p.at + p.s.length);
  const out = new Float32Array(len);
  for (const p of parts) for (let i = 0; i < p.s.length; i++) out[p.at + i] += p.s[i] * p.gain;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const a = Math.abs(out[i]);
    if (a > peak) peak = a;
  }
  const loud = perceivedLoudness(out, sampleRate);
  if (peak > 0 && loud > 0) {
    const k = Math.min(TARGET_LOUDNESS / loud, PEAK_CEILING / peak);
    for (let i = 0; i < len; i++) out[i] *= k;
  }
  return out;
}
