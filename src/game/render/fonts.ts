// Pixel fonts (render lane; docs/QUALITY-PLAN.md §4).
//
// 1. DOM fonts: Pixelify Sans (UI, 400 + 700) and Tiny5 (small labels / numbers), SIL OFL 1.1, from the npm packages
//    `@fontsource/pixelify-sans` and `@fontsource/tiny5` (licences shipped in public/licenses/). The woff2 files are
//    imported `?inline` and registered with the FontFace API instead of importing the packages' CSS: the CSS route
//    emits separate font files that the single-file build (scripts/build-single.mjs) cannot carry, so the title
//    screen and HUD would silently fall back to system fonts there. Same faces, same descriptors (latin subset).
//    src/ui/styles/fonts.css redefines `--font-ui` / `--font-small` for every lane.
// 2. The in-world bitmap font: hand-authored pixel glyphs (render/glyphs.ts) baked into Phaser bitmap fonts with a
//    1 px #24180f outline, one small texture per (tier, colour) — exact colours under both WebGL and Canvas, no tint
//    multiplying the outline. render/text.ts is the only user.
import type Phaser from 'phaser';
import pixelify400 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-400-normal.woff2?inline';
import pixelify700 from '@fontsource/pixelify-sans/files/pixelify-sans-latin-700-normal.woff2?inline';
import tiny5 from '@fontsource/tiny5/files/tiny5-latin-400-normal.woff2?inline';
import '../../ui/styles/fonts.css';
import { FONT_OUTLINE, type FontTier, parseColor, tierAtlas, type TierAtlas } from './glyphs';

export const PIXEL_FONT_KEY = 'omni-pixel';

/** fontsource's latin subset range (the faces only claim these code points; others fall through the stack). */
const LATIN =
  'U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD';

let fontsPromise: Promise<void> | null = null;

/**
 * Registers the OFL pixel fonts and resolves once they are decoded (or after `timeoutMs`, so a broken font never
 * blocks the boot). Idempotent. BootScene awaits it before baking anything and before the title screen.
 */
export function loadFonts(timeoutMs = 2500): Promise<void> {
  if (fontsPromise) return fontsPromise;
  if (typeof document === 'undefined' || typeof FontFace === 'undefined' || !document.fonts) {
    fontsPromise = Promise.resolve();
    return fontsPromise;
  }
  const faces = [
    new FontFace('Pixelify Sans', `url(${pixelify400}) format('woff2')`, { weight: '400', style: 'normal', display: 'swap', unicodeRange: LATIN }),
    new FontFace('Pixelify Sans', `url(${pixelify700}) format('woff2')`, { weight: '700', style: 'normal', display: 'swap', unicodeRange: LATIN }),
    new FontFace('Tiny5', `url(${tiny5}) format('woff2')`, { weight: '400', style: 'normal', display: 'swap', unicodeRange: LATIN }),
  ];
  for (const f of faces) document.fonts.add(f);
  const all = Promise.all(faces.map((f) => f.load().catch(() => undefined))).then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, timeoutMs));
  fontsPromise = Promise.race([all, timeout]);
  return fontsPromise;
}

// ------------------------------------------------------------------ bitmap font

const atlases = new Map<FontTier, TierAtlas>();
function atlasFor(tier: FontTier): TierAtlas {
  let a = atlases.get(tier);
  if (!a) atlases.set(tier, (a = tierAtlas(tier)));
  return a;
}

/** Colours the game's in-world text uses most (baked at boot; any other colour is baked on first use). */
const BOOT_COLOURS: readonly (readonly [FontTier, string])[] = [
  ['small', '#ffe9a0'],
  ['small', '#d8f0ff'],
  ['small', '#ffb0a0'],
  ['small', '#7fff9f'],
  ['bold', '#ffffff'],
  ['bold', '#ff5a5a'],
  ['bold', '#9fe0ff'],
  ['bold', '#ffc8b8'],
  ['big', '#ffd76a'],
  ['big', '#ffe14a'],
];

let colourCanvas: CanvasRenderingContext2D | null = null;
/** Any CSS colour → [r, g, b] (white when the browser cannot parse it either). */
function rgbOf(color: string): [number, number, number] {
  const direct = parseColor(color);
  if (direct) return direct;
  if (typeof document === 'undefined') return [255, 255, 255];
  colourCanvas ??= document.createElement('canvas').getContext('2d');
  if (!colourCanvas) return [255, 255, 255];
  colourCanvas.fillStyle = '#ffffff';
  colourCanvas.fillStyle = color;
  return parseColor(String(colourCanvas.fillStyle)) ?? [255, 255, 255];
}

const toHex = (rgb: readonly number[]) => rgb.map((v) => v.toString(16).padStart(2, '0')).join('');

/**
 * Key of the baked bitmap font for a tier and colour, baking it on first use (a few hundred bytes of canvas). The
 * fonts live in the game-wide texture manager / cache, so every map restart reuses them.
 */
export function pixelFontKey(scene: Phaser.Scene, tier: FontTier, color: string): string {
  const rgb = rgbOf(color);
  const key = `${PIXEL_FONT_KEY}-${tier}-${toHex(rgb)}`;
  if (scene.cache.bitmapFont.exists(key)) return key;
  const atlas = atlasFor(tier);
  const canvas = document.createElement('canvas');
  canvas.width = atlas.width;
  canvas.height = atlas.height;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(atlas.width, atlas.height);
  const out = parseColor(FONT_OUTLINE)!;
  const chars: Record<number, unknown> = {};
  for (const { g, x, y } of atlas.glyphs) {
    for (let gy = 0; gy < g.h; gy++)
      for (let gx = 0; gx < g.w; gx++) {
        const v = g.cells[gy * g.w + gx];
        if (!v) continue;
        const c = v === 1 ? rgb : out;
        const i = ((y + gy) * atlas.width + x + gx) * 4;
        img.data[i] = c[0];
        img.data[i + 1] = c[1];
        img.data[i + 2] = c[2];
        img.data[i + 3] = 255;
      }
    chars[g.ch.codePointAt(0)!] = {
      x,
      y,
      width: g.w,
      height: g.h,
      centerX: Math.floor(g.w / 2),
      centerY: Math.floor(g.h / 2),
      xOffset: 0,
      yOffset: 0,
      xAdvance: g.adv,
      data: {},
      kerning: {},
      u0: x / atlas.width,
      v0: y / atlas.height,
      u1: (x + g.w) / atlas.width,
      v1: (y + g.h) / atlas.height,
    };
  }
  ctx.putImageData(img, 0, 0);
  if (scene.textures.exists(key)) scene.textures.remove(key);
  scene.textures.addCanvas(key, canvas);
  const data = { font: key, size: atlas.metrics.cellH, lineHeight: atlas.metrics.lineHeight, chars };
  scene.cache.bitmapFont.add(key, { data, texture: key, frame: null });
  return key;
}

/** Native size of a baked font (BitmapText must keep it: any other size scales the pixels unevenly). */
export function pixelFontSize(scene: Phaser.Scene, key: string): number {
  const entry = scene.cache.bitmapFont.get(key) as { data?: { size?: number } } | undefined;
  return entry?.data?.size ?? 11;
}

/** Bakes the in-world bitmap fonts the game uses most (BootScene; the rest are baked on first use). */
export function bakePixelFont(scene: Phaser.Scene): void {
  for (const [tier, color] of BOOT_COLOURS) pixelFontKey(scene, tier, color);
}
