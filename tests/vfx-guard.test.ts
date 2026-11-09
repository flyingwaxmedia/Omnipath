// Joint guard (docs/VFX.md §11.1 vfx-guard, §12): the VFX core stays deterministic, Phaser-free and original.
// - no Math.random, Date.now, performance.now, ctx.rotate, DOM globals or Phaser import under src/game/vfx
//   (the Phaser runtime lives in src/game/vfx/runtime/ and is exempt; it still never uses Math.random or emitter
//   {min, max} ops: every random choice comes from a per-cast mulberry32 stream)
// - no image or font files under src/ or public/ (public/icon.svg is the one allowed vector icon)
// - no pixelfx 'Patch Pixel' font or DoomFire code, and the painter and docs keep their technique credits
import { describe, expect, it } from 'vitest';
import vfxDoc from '../docs/VFX.md?raw';

const VFX_SOURCES = import.meta.glob<string>('../src/game/vfx/**/*.ts', { query: '?raw', import: 'default', eager: true });
const ALL_SOURCES = import.meta.glob<string>('../src/**/*.{ts,css}', { query: '?raw', import: 'default', eager: true });
// Keys only (lazy globs import nothing): every binary art or font file the build could ship.
const BINARIES = Object.keys(
  import.meta.glob(['../src/**/*.{png,gif,jpg,jpeg,webp,bmp,ase,aseprite,ttf,otf,woff,woff2,svg}', '../public/**/*.{png,gif,jpg,jpeg,webp,bmp,ase,aseprite,ttf,otf,woff,woff2,svg}']),
);

/** Source text without comments, so a rule may be named in a comment (as this file's header does). */
const code = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('vfx guard', () => {
  const core = Object.entries(VFX_SOURCES).filter(([p]) => !p.includes('/vfx/runtime/'));

  it('keeps the VFX core deterministic and Phaser-free', () => {
    expect(core.length).toBeGreaterThan(10);
    const banned: [RegExp, string][] = [
      [/Math\.random\s*\(/, 'Math.random'],
      [/Date\.now\s*\(/, 'Date.now'],
      [/performance\.now\s*\(/, 'performance.now'],
      [/\.rotate\s*\(/, 'ctx.rotate'],
      [/from\s+['"]phaser['"]|import\(\s*['"]phaser['"]\s*\)/, 'phaser import'],
      [/\b(document|window)\./, 'DOM global'],
    ];
    const bad: string[] = [];
    for (const [p, src] of core) for (const [re, what] of banned) if (re.test(code(src))) bad.push(`${p}: ${what}`);
    expect(bad).toEqual([]);
  });

  it('keeps the runtime off Phaser randomness: no Math.random, no emitter {min, max} ops (per-cast streams only)', () => {
    const runtime = Object.entries(VFX_SOURCES).filter(([p]) => p.includes('/vfx/runtime/'));
    expect(runtime.length).toBeGreaterThan(3);
    const bad: string[] = [];
    for (const [p, src] of runtime) {
      const c = code(src);
      if (/Math\.random\s*\(/.test(c)) bad.push(`${p}: Math.random`);
      if (/\{\s*min\s*:[^}]*max\s*:/.test(c)) bad.push(`${p}: {min, max} op`);
      if (/\.particles\s*\(/.test(c)) bad.push(`${p}: Phaser particle emitter (motes are runtime particles)`);
    }
    expect(bad).toEqual([]);
  });

  it('ships no image or font files: all art is procedural', () => {
    expect(BINARIES.filter((p) => p !== '../public/icon.svg')).toEqual([]);
  });

  it('uses no pixelfx font or DoomFire code and keeps the technique credits', () => {
    expect(Object.entries(ALL_SOURCES).filter(([, src]) => /Patch Pixel|DoomFire/i.test(src)).map(([p]) => p)).toEqual([]);
    const painter = VFX_SOURCES['../src/game/vfx/painter.ts'];
    expect(painter).toMatch(/Sprite Fusion/);
    expect(painter).toMatch(/pixelfx/);
    expect(painter).toMatch(/no code or pixels ported/);
    expect(vfxDoc).toMatch(/## 12\. Credits and licensing/);
    expect(vfxDoc).toMatch(/Pedro Medeiros \(Saint11\), CC BY 4\.0/);
  });
});
