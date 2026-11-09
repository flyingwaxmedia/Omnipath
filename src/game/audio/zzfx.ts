/*
  ZzFX - Zuper Zmall Zound Zynth v1.4.0 by Frank Force
  https://github.com/KilledByAPixel/ZzFX

  ZzFX MIT License

  Copyright (c) 2019 - Frank Force

  Permission is hereby granted, free of charge, to any person obtaining a copy
  of this software and associated documentation files (the "Software"), to deal
  in the Software without restriction, including without limitation the rights
  to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
  copies of the Software, and to permit persons to whom the Software is
  furnished to do so, subject to the following conditions:

  The above copyright notice and this permission notice shall be included in all
  copies or substantial portions of the Software.

  THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
  IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
  FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
  AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
  LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
  OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
  SOFTWARE.
*/
// Vendored from the `zzfx` npm package 1.4.0 (ZzFX.js, `ZZFX.buildSamples`) — see THIRD-PARTY-NOTICES.md.
// Omnipath changes (the synthesis maths is unchanged):
//   - TypeScript, sample generation only: no AudioContext is created at import (src/game/audio/engine.ts owns the
//     one context, created inside the first user gesture), so this module loads in node tests;
//   - the frequency `randomness` takes its roll from the caller (`rand01`, a seeded value) instead of Math.random,
//     so every cached variation is reproducible;
//   - the sample rate is a parameter (buffers are built at a reduced rate to save memory).

/**
 * ZzFX parameters, in ZzFX order (holes = defaults):
 * [volume, randomness, frequency, attack, sustain, release, shape, shapeCurve, slide, deltaSlide, pitchJump,
 *  pitchJumpTime, repeatTime, noise, modulation, bitCrush, delay, sustainVolume, decay, tremolo, filter]
 * shape: 0 sine, 1 triangle, 2 saw, 3 tan, 4 noise, 5 square (shapeCurve = duty).
 * filter: > 0 high-pass, < 0 low-pass (biquad, cutoff ≈ 2·|filter| Hz). Times in seconds, frequencies in Hz.
 */
export type ZzfxParams = readonly (number | undefined)[];

/** Default sample rate of the original (the engine builds at `BUILD_RATE`, src/game/audio/engine.ts). */
export const ZZFX_SAMPLE_RATE = 44100;

/** Total length in seconds of a ZzFX sound (attack + decay + sustain + release + delay). */
export function zzfxLength(p: ZzfxParams): number {
  const attack = p[3] ?? 0;
  return (attack || 9 / ZZFX_SAMPLE_RATE) + (p[18] ?? 0) + (p[4] ?? 0) + (p[5] ?? 0.1) + (p[16] ?? 0);
}

/**
 * Builds the samples of one ZzFX sound. `rand01` is the roll in [0, 1) applied to the frequency randomness
 * (0.5 = no detune). Pure and deterministic.
 */
export function zzfxBuild(p: ZzfxParams, sampleRate = ZZFX_SAMPLE_RATE, rand01 = 0.5): Float32Array {
  const volume = p[0] ?? 1;
  const randomness = p[1] ?? 0.05;
  let frequency = p[2] ?? 220;
  let attack = p[3] ?? 0;
  let sustain = p[4] ?? 0;
  let release = p[5] ?? 0.1;
  const shape = p[6] ?? 0;
  const shapeCurve = p[7] ?? 1;
  let slide = p[8] ?? 0;
  let deltaSlide = p[9] ?? 0;
  let pitchJump = p[10] ?? 0;
  let pitchJumpTime = p[11] ?? 0;
  let repeatTime = p[12] ?? 0;
  const noise = p[13] ?? 0;
  let modulation = p[14] ?? 0;
  const bitCrush = p[15] ?? 0;
  let delay = p[16] ?? 0;
  const sustainVolume = p[17] ?? 1;
  let decay = p[18] ?? 0;
  const tremolo = p[19] ?? 0;
  const filter = p[20] ?? 0;

  const PI2 = Math.PI * 2;
  const abs = Math.abs;
  const sign = (v: number) => (v < 0 ? -1 : 1);
  const startSlide = (slide *= (500 * PI2) / sampleRate / sampleRate);
  let startFrequency = (frequency *= ((1 + randomness * 2 * rand01 - randomness) * PI2) / sampleRate);
  let modOffset = 0;
  let repeat = 0;
  let crush = 0;
  let jump = 1;
  let t = 0;
  let i = 0;
  let s = 0;
  let f: number;

  // biquad LP/HP filter
  const quality = 2;
  const w = (PI2 * abs(filter) * 2) / sampleRate;
  const cos = Math.cos(w);
  const alpha = Math.sin(w) / 2 / quality;
  const a0 = 1 + alpha;
  const a1 = (-2 * cos) / a0;
  const a2 = (1 - alpha) / a0;
  const b0 = (1 + sign(filter) * cos) / 2 / a0;
  const b1 = -(sign(filter) + cos) / a0;
  const b2 = b0;
  let x2 = 0;
  let x1 = 0;
  let y2 = 0;
  let y1 = 0;

  // scale by sample rate
  const minAttack = 9; // prevent pop if attack is 0
  attack = attack * sampleRate || minAttack;
  decay *= sampleRate;
  sustain *= sampleRate;
  release *= sampleRate;
  delay *= sampleRate;
  deltaSlide *= (500 * PI2) / sampleRate ** 3;
  modulation *= PI2 / sampleRate;
  pitchJump *= PI2 / sampleRate;
  pitchJumpTime *= sampleRate;
  repeatTime = (repeatTime * sampleRate) | 0;

  const length = (attack + decay + sustain + release + delay) | 0;
  const b = new Float32Array(length > 0 ? length : 0);

  for (; i < length; b[i++] = s * volume) {
    if (!(++crush % ((bitCrush * 100) | 0))) {
      s = shape
        ? shape > 1
          ? shape > 2
            ? shape > 3
              ? shape > 4
                ? (t / PI2) % 1 < shapeCurve / 2
                  ? 1
                  : -1 // 5 square duty
                : Math.sin(t ** 3) // 4 noise
              : Math.max(Math.min(Math.tan(t), 1), -1) // 3 tan
            : 1 - (((((2 * t) / PI2) % 2) + 2) % 2) // 2 saw
          : 1 - 4 * abs(Math.round(t / PI2) - t / PI2) // 1 triangle
        : Math.sin(t); // 0 sin

      s =
        (repeatTime ? 1 - tremolo + tremolo * Math.sin((PI2 * i) / repeatTime) : 1) *
        (shape > 4 ? s : sign(s) * abs(s) ** shapeCurve) *
        (i < attack
          ? i / attack
          : i < attack + decay
            ? 1 - ((i - attack) / decay) * (1 - sustainVolume)
            : i < attack + decay + sustain
              ? sustainVolume
              : i < length - delay
                ? ((length - i - delay) / release) * sustainVolume
                : 0);

      s = delay ? s / 2 + (delay > i ? 0 : ((i < length - delay ? 1 : (length - i) / delay) * b[(i - delay) | 0]) / 2 / volume) : s;

      if (filter) s = y1 = b2 * x2 + b1 * (x2 = x1) + b0 * (x1 = s) - a2 * y2 - a1 * (y2 = y1);
    }

    f = (frequency += slide += deltaSlide) * Math.cos(modulation * modOffset++);
    t += f + f * noise * (((i * i * PI2) % 2) - 1);

    if (jump && ++jump > pitchJumpTime) {
      frequency += pitchJump;
      startFrequency += pitchJump;
      jump = 0;
    }

    if (repeatTime && !(++repeat % repeatTime)) {
      frequency = startFrequency;
      slide = startSlide;
      jump ||= 1;
    }
  }
  return b;
}
