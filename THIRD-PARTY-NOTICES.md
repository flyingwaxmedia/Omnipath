# Third-party notices

Omnipath's art and sound are generated in code and are original. The third-party code and fonts it ships are
listed here with their licences.

## ZzFX — Zuper Zmall Zound Zynth (MIT)

- Version: 1.4.0 (npm package `zzfx`), by Frank Force — https://github.com/KilledByAPixel/ZzFX
- Where: `src/game/audio/zzfx.ts` (vendored, not an npm dependency). Only the sample generator (`buildSamples`) is
  used, ported to TypeScript; changes: no AudioContext is created at import, the frequency randomness takes a seeded
  roll from the caller instead of `Math.random`, and the sample rate is a parameter. The synthesis maths is
  unchanged.
- Every sound recipe in `src/game/audio/bank.ts` and every ambience bed in `src/game/audio/ambience.ts` is original
  to Omnipath; no audio files, samples or third-party recipes are included.

```
MIT License

Copyright (c) 2019 Frank Force

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
```

## Other components

- Phaser 3 (MIT) — npm dependency `phaser`; its licence ships in `node_modules/phaser/LICENSE.md`.
- Pixelify Sans and Tiny5 fonts (SIL Open Font License 1.1) — npm dependencies `@fontsource/pixelify-sans` and
  `@fontsource/tiny5`; their licence texts ship in `public/licenses/`.
