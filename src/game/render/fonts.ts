// Pixel fonts (render lane; docs/QUALITY-PLAN.md §4): Pixelify Sans (UI) + Tiny5 (small labels / numbers), SIL OFL
// 1.1 via npm `@fontsource/pixelify-sans` and `@fontsource/tiny5` (ship their LICENSE files), imported here so Vite
// bundles them; plus the boot-baked bitmap font for ALL in-world text (render/text.ts), 1 px #24180f outline.
//
// CSS contract for the HUD / panels lanes: use `font-family: var(--font-ui)` (body text) and `var(--font-small)`
// (tiny labels, numbers). base.css defines both with system fallbacks; once the fonts are installed this module
// imports a stylesheet that redefines them (`:root:root { --font-ui: 'Pixelify Sans', …; }`).
//
// Skeleton: nothing installed yet. LANE render: npm install the two packages, import their CSS here, bake the bitmap
// font in BootScene (bakePixelFont) and switch render/text.ts to BitmapText.
import type Phaser from 'phaser';

export const PIXEL_FONT_KEY = 'omni-pixel';

/** Bakes the in-world bitmap font into the texture manager (BootScene). Skeleton: no-op. */
export function bakePixelFont(_scene: Phaser.Scene): void {}
