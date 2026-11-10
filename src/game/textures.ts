import type Phaser from 'phaser';
import type { Registry } from '../core/registry';
import { drawCharacters } from './art/characters';
import { drawDressing } from './art/dressing';
import { drawIcons } from './art/icons';
import { drawMonsters } from './art/monsters';
import { disc, line, PAL, pixelTex, rect, type Ctx } from './art/pixel';
import { drawTiles } from './art/tiles';
import { drawUi, uiCss } from './art/ui';
import { drawObjects, drawNodes, drawPortals, drawProps, drawStructures } from './art/world';
import { bakePixelFont } from './render/fonts';

// All art is generated at boot so the game ships with zero binary assets (docs/CLIENT-v3.md §1, in this order):
//   tiles       art/tiles.ts      'tiles' (2D atlas + variants), 'tiles_decal', 'tiles_edge' (autotile pieces)
//   world       art/world.ts      props, struct_*, obj_*, node_*, portal_*, gate_*, hide_*, legacy aliases
//   dressing    art/dressing.ts   dr_* ground dressing
//   characters  art/characters.ts player_<w> (+ idle / walk / atk frames), npc_<look> (+ _1)
//   monsters    art/monsters.ts   mon_<id> (+ _1)
//   ui          art/ui.ts         ui_* frames, rounds, glyphs (and the uiCss() custom properties for the DOM)
//   icons       art/icons.ts      icon_* (skills lazily), pips
//   effects     this file         fx_dot, fx_orb, fx_blade, fx_knife, shadow, target_ring, move_marker
//   font        render/fonts.ts   the in-world bitmap pixel font
// The tile atlas MUST come before the world sprites: both modules used to create 'tiles' and the first one wins.
// BootScene runs these steps time-sliced behind the boot splash; generateTextures() runs them all at once.

export { TILE_MARGIN, TILE_SPACING, PRISM_SOCKETS, PRISM_GATE_SIZE } from './art/world';

// ---------------------------------------------------------------- effects (pixel versions of the v2 keys)

/** Radial glow in flat alpha bands (pixel-art light: hard steps, no smooth gradient). */
function bandedGlow(c: Ctx, size: number, bands: readonly number[]): void {
  const r = size / 2;
  const n = bands.length;
  for (let i = 0; i < n; i++) {
    const rr = r * (1 - i / n);
    c.fillStyle = `rgba(255,255,255,${bands[i]})`;
    for (let y = 0; y < size; y++) {
      const dy = (y + 0.5 - r) / rr;
      if (Math.abs(dy) >= 1) continue;
      const half = rr * Math.sqrt(1 - dy * dy);
      const x0 = Math.round(r - half);
      const x1 = Math.round(r + half);
      if (x1 > x0) c.fillRect(x0, y, x1 - x0, 1);
    }
  }
}

/** A 1–2 px pixel ellipse ring (rasterised, no anti-aliasing). */
function ring(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, thick = 1): void {
  c.fillStyle = color;
  const inside = (x: number, y: number, ax: number, ay: number) => ((x + 0.5 - cx) / ax) ** 2 + ((y + 0.5 - cy) / ay) ** 2 <= 1;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
      if (inside(x, y, rx, ry) && !inside(x, y, rx - thick, ry - thick)) c.fillRect(x, y, 1, 1);
}

function drawEffects(scene: Phaser.Scene): void {
  // Particles / glows (tinted, often additive): alpha bands sum to the v2 brightness.
  pixelTex(scene, 'fx_dot', 16, 16, (c) => bandedGlow(c, 16, [0.22, 0.22, 0.3, 0.26]));
  pixelTex(scene, 'fx_orb', 32, 32, (c) => bandedGlow(c, 32, [0.16, 0.18, 0.22, 0.2, 0.24]));
  pixelTex(scene, 'fx_blade', 32, 10, (c) => {
    // a short straight blade pointing right (+x), guard at the hilt
    rect(c, 9, 4, 20, 2, '#ffffff');
    rect(c, 29, 4, 2, 1, '#ffffff');
    rect(c, 9, 3, 18, 1, '#e8eef6');
    rect(c, 9, 6, 18, 1, '#c8d0dc');
    rect(c, 2, 4, 5, 2, '#8a5a2a');
    rect(c, 6, 1, 3, 8, '#c9a03a');
    rect(c, 6, 1, 3, 1, '#f0d070');
  });
  pixelTex(scene, 'fx_knife', 18, 6, (c) => {
    rect(c, 4, 2, 11, 2, '#ffffff');
    rect(c, 15, 2, 2, 1, '#ffffff');
    rect(c, 4, 1, 9, 1, '#e8eef6');
    rect(c, 0, 2, 4, 2, '#9aa4b4');
  });
  // Ground marks: flat, hard-edged.
  // fallback blob only (render/shadows.ts gives every actor its real cast shadow): the shadow violet, never black
  pixelTex(scene, 'shadow', 32, 12, (c) => disc(c, 16, 6, 13, 4, 'rgba(58,53,96,0.4)'));
  pixelTex(scene, 'target_ring', 48, 20, (c) => {
    ring(c, 24, 10, 22, 9, PAL.outline, 1);
    ring(c, 24, 10, 21, 8, '#ffdd55', 2);
    // brighter front arc
    c.fillStyle = '#fff3b0';
    for (let x = 14; x < 34; x++) c.fillRect(x, 17, 1, 1);
  });
  pixelTex(scene, 'move_marker', 24, 12, (c) => {
    ring(c, 12, 6, 11, 5, 'rgba(36,24,15,0.6)', 1);
    ring(c, 12, 6, 10, 4, '#ffffff', 1);
    line(c, 12, 4, 12, 7, 'rgba(255,255,255,0.75)');
  });
}

// ---------------------------------------------------------------- the boot steps

export interface TextureStep {
  /** Short id for timing logs ('tiles', 'world.props', …). */
  name: string;
  run(): void;
}

/** Injects uiCss(scene) once into the DOM (the 9-slice frames and glyphs as CSS custom properties). */
export function injectUiCss(scene: Phaser.Scene): void {
  if (typeof document === 'undefined' || document.getElementById('omnipath-ui-art')) return;
  const st = document.createElement('style');
  st.id = 'omnipath-ui-art';
  st.textContent = uiCss(scene);
  document.head.append(st);
}

/**
 * Every texture step in CLIENT-v3 §1 order. `reg` is the content registry (icons need it; without one the icon step
 * is skipped). Each step is idempotent per key.
 */
export function textureSteps(scene: Phaser.Scene, reg?: Registry): TextureStep[] {
  return [
    { name: 'tiles', run: () => drawTiles(scene) },
    { name: 'world.props', run: () => drawProps(scene) },
    { name: 'world.structures', run: () => drawStructures(scene) },
    { name: 'world.objects', run: () => drawObjects(scene) },
    { name: 'world.nodes', run: () => drawNodes(scene) },
    { name: 'world.portals', run: () => drawPortals(scene) },
    { name: 'dressing', run: () => drawDressing(scene) },
    { name: 'characters', run: () => drawCharacters(scene) },
    { name: 'monsters', run: () => drawMonsters(scene) },
    { name: 'ui', run: () => drawUi(scene) },
    { name: 'icons', run: () => reg && drawIcons(scene, reg, { lazySkills: true }) },
    { name: 'effects', run: () => drawEffects(scene) },
    { name: 'font', run: () => bakePixelFont(scene) },
    { name: 'ui.css', run: () => injectUiCss(scene) },
  ];
}

/** Single entry point: generate every texture the game uses at once (idempotent per key). */
export function generateTextures(scene: Phaser.Scene, reg?: Registry): void {
  for (const s of textureSteps(scene, reg)) s.run();
}
