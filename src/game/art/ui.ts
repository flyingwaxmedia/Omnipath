import type Phaser from 'phaser';
import { UI_GLYPHS, paintUiGlyph } from './icons';
import { PAL, outline, pixelTex, px, rect, textureDataUrl, type Ctx } from './pixel';

// Procedural UI art (docs/ART-DIRECTION.md §2 / §5): bronze-and-dark-wood frames with our own ornament motif —
// notched (chamfered) corners and small diamond rune studs with a teal gem. Everything is painted on integer
// pixels and meant to be scaled by whole numbers (CSS `image-rendering: pixelated`, Phaser nearest filter).
//
// 9-slice frames (use with CSS border-image, slice values in UI_SLICES):
//   ui_frame_panel   big panels / dialogs           ui_frame_plate   name plates, zone plate, stat strip
//   ui_frame_banner  light parchment header plate   ui_frame_slot    skill-bar slot (recessed)
//   ui_frame_card    tracker / list cards           ui_frame_button  square HUD button (+ ui_frame_button_down)
//   ui_bar_frame     HP / SP / EXP bar housing      ui_pill(_safe|_hunt|_dungeon|_warden)  small tag pills
// Fixed-size pieces: ui_round_big (96, attack button), ui_round_small (52), ui_medallion (76 ring, transparent
//   centre) + ui_medallion_bg (its inner disc), ui_badge_level (30x20), ui_joy_base (120), ui_joy_knob (48),
//   ui_chevron (13x9, white-gold, tintable), ui_bar_fill_hp|sp|exp (1x8 vertical ramps, stretch them),
//   ui_ico_<name> (24x24 HUD button glyphs, see UI_GLYPHS in ./icons).

const OUT = PAL.outline;
const U = {
  gold: PAL.ui.gold,
  goldHi: '#fff1c0',
  bronze: PAL.ui.bronze,
  bronzeLo: '#8a5e2a',
  bevel: PAL.ui.bevel,
  wood: PAL.ui.wood,
  woodHi: '#5c3d22',
  woodLo: '#3a2616',
  deep: '#1c140e',
  deeper: '#120c08',
  gem: '#5aa8b4',
  gemHi: '#b0e6ec',
};

/** 9-slice insets (art pixels) per frame texture; CSS border-width should be slice × the pixel scale. */
export const UI_SLICES = {
  ui_frame_panel: 12,
  ui_frame_plate: 6,
  ui_frame_banner: 6,
  ui_frame_slot: 7,
  ui_frame_card: 5,
  ui_frame_button: 7,
  ui_frame_button_down: 7,
  // v4 frame weights (SPEC-v4 §11.7): heavy = things you tap that matter most, light = slots, strip = no frame.
  ui_frame_heavy: 8,
  ui_frame_light: 3,
  ui_frame_light_on: 3,
  ui_strip: 4,
  ui_bar_frame: 3,
  ui_pill: 4,
  ui_pill_safe: 4,
  ui_pill_hunt: 4,
  ui_pill_dungeon: 4,
  ui_pill_warden: 4,
} as const;
export type UiFrameKey = keyof typeof UI_SLICES;

/** Fixed-size UI textures and their sizes in art pixels. */
export const UI_SIZES = {
  ui_round_big: [96, 96],
  ui_round_small: [52, 52],
  ui_medallion: [76, 76],
  ui_medallion_bg: [76, 76],
  ui_badge_level: [30, 20],
  ui_joy_base: [120, 120],
  ui_joy_knob: [48, 48],
  ui_chevron: [13, 9],
  ui_bar_fill_hp: [1, 8],
  ui_bar_fill_sp: [1, 8],
  ui_bar_fill_exp: [1, 8],
} as const;

// ------------------------------------------------------------------ painters

type Painter = (x: number, y: number) => string | null | undefined | false;

function paint(c: Ctx, w: number, h: number, fn: Painter): void {
  let last = '';
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const col = fn(x, y);
      if (!col) continue;
      if (col !== last) {
        c.fillStyle = col;
        last = col;
      }
      c.fillRect(x, y, 1, 1);
    }
}

const chk = (x: number, y: number): number => (x + y) & 1;

/** A band colour: one colour, or [lit, shaded] picked by which side of the frame the pixel is on. */
type Band = string | readonly [string, string];

/**
 * Chamfered rectangular frame painted by depth from the edge. `bands[d]` colours the pixels at depth d
 * (0 = outermost); deeper pixels get `fill` (or stay transparent). Top / left edges take the lit tone.
 */
function frameRect(c: Ctx, w: number, h: number, bands: readonly Band[], chamfer: number, fill?: Painter | string): void {
  paint(c, w, h, (x, y) => {
    const dx = Math.min(x, w - 1 - x);
    const dy = Math.min(y, h - 1 - y);
    const e = Math.min(dx, dy, dx + dy - chamfer);
    if (e < 0) return null;
    if (e < bands.length) {
      const b = bands[e];
      if (typeof b === 'string') return b;
      let lit: boolean;
      if (dx + dy - chamfer === e && e < Math.min(dx, dy)) lit = x + y < (w + h) / 2 - 1 && !(x > w / 2 && y > h / 2);
      else if (dy <= dx) lit = y < h / 2;
      else lit = x < w / 2;
      return lit ? b[0] : b[1];
    }
    if (!fill) return null;
    return typeof fill === 'string' ? fill : fill(x, y);
  });
}

/** Diamond rune stud (7x7) centred at (cx, cy): outline, bronze body, teal gem. */
function stud(c: Ctx, cx: number, cy: number, big = true): void {
  if (big) {
    for (const [ox, oy] of [[0, -3], [-1, -2], [1, -2], [-2, -1], [2, -1], [-3, 0], [3, 0], [-2, 1], [2, 1], [-1, 2], [1, 2], [0, 3]]) px(c, cx + ox, cy + oy, OUT);
    for (const [ox, oy] of [[0, -2], [-1, -1], [-2, 0], [-1, 1]]) px(c, cx + ox, cy + oy, U.gold);
    for (const [ox, oy] of [[1, -1], [2, 0], [1, 1], [0, 2]]) px(c, cx + ox, cy + oy, U.bronzeLo);
    px(c, cx, cy - 1, U.gemHi);
    px(c, cx - 1, cy, U.gem);
    px(c, cx + 1, cy, U.gem);
    px(c, cx, cy + 1, U.gem);
    px(c, cx, cy, U.gemHi);
    px(c, cx - 1, cy - 2, U.goldHi);
  } else {
    for (const [ox, oy] of [[0, -2], [-1, -1], [1, -1], [-2, 0], [2, 0], [-1, 1], [1, 1], [0, 2]]) px(c, cx + ox, cy + oy, OUT);
    px(c, cx, cy - 1, U.gold);
    px(c, cx - 1, cy, U.gold);
    px(c, cx + 1, cy, U.bronzeLo);
    px(c, cx, cy + 1, U.bronzeLo);
    px(c, cx, cy, U.gem);
  }
}

/** Round bronze frame (ring) of `size`, optional dark recessed disc inside and rune studs on the ring. */
function roundFrame(c: Ctx, size: number, ring: number, studs: number, opts: { fill?: boolean; spikes?: boolean; margin?: number } = {}): void {
  const m = opts.margin ?? 0;
  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - m;
  const inner = R - 1 - ring;
  paint(c, size, size, (x, y) => {
    const dx = x + 0.5 - cx;
    const dy = y + 0.5 - cy;
    const d = Math.hypot(dx, dy);
    if (d > R) return null;
    if (d > R - 1) return OUT;
    const lit = -(dx + dy) / (Math.max(d, 0.01) * Math.SQRT2);
    if (d > inner) {
      const u = (d - inner) / ring;
      if (u > 0.78) return lit > 0.25 ? U.gold : lit < -0.3 ? U.bevel : U.bronze;
      if (u > 0.3) return lit > 0.6 ? U.goldHi : lit > -0.5 ? U.bronze : U.bronzeLo;
      return lit > 0.2 ? U.bevel : lit < -0.3 ? U.gold : U.bronzeLo;
    }
    if (d > inner - 1) return OUT;
    if (!opts.fill) return null;
    const v = d / inner;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    if (v > 0.86) return U.deeper;
    if (v > 0.8) return chk(ix, iy) ? U.deeper : U.deep;
    if (v > 0.5) return U.deep;
    if (v > 0.44) return chk(ix, iy) ? U.deep : '#2a1c12';
    return '#2a1c12';
  });
  if (opts.spikes) {
    // four small outward notched points (N/E/S/W) — our own ornament
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2 - Math.PI / 2;
      const bx = Math.round(cx + Math.cos(a) * (R - 1)) - (Math.cos(a) > 0.5 ? 1 : 0);
      const by = Math.round(cy + Math.sin(a) * (R - 1)) - (Math.sin(a) > 0.5 ? 1 : 0);
      const ux = Math.round(Math.cos(a));
      const uy = Math.round(Math.sin(a));
      for (let i = 0; i <= 3; i++) {
        const w = 3 - i;
        for (let j = -w; j <= w; j++) {
          const X = bx + ux * i + (uy !== 0 ? j : 0);
          const Y = by + uy * i + (ux !== 0 ? j : 0);
          px(c, X, Y, Math.abs(j) === w ? OUT : i === 0 ? U.bronze : j < 0 ? U.gold : U.bronzeLo);
        }
      }
      px(c, bx + ux * 4, by + uy * 4, OUT);
    }
  }
  for (let k = 0; k < studs; k++) {
    const a = (k / studs) * Math.PI * 2 - Math.PI / 2 + (studs === 4 ? Math.PI / 4 : 0);
    const rr = inner + ring / 2 + 0.5;
    stud(c, Math.round(cx + Math.cos(a) * rr - 0.5), Math.round(cy + Math.sin(a) * rr - 0.5), ring >= 5);
  }
}

// ------------------------------------------------------------------ frames

const PANEL_BANDS: readonly Band[] = [OUT, [U.gold, U.bronzeLo], U.bronze, [U.bronze, U.bevel], OUT, [U.woodHi, U.woodLo], U.wood, OUT];

function drawFrames(scene: Phaser.Scene): void {
  pixelTex(scene, 'ui_frame_panel', 36, 36, (c) => {
    frameRect(c, 36, 36, PANEL_BANDS, 4, PAL.ui.fill);
    // corner plates: a notched bronze bracket carrying a rune stud, lit from the top-left in every corner
    const inPlate = (lx: number, ly: number): boolean =>
      lx >= 1 && ly >= 1 && lx + ly >= 4 && ((ly <= 3 && lx <= 10) || (lx <= 3 && ly <= 10) || lx + ly <= 9);
    for (const [fx, fy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
      const loc = (x: number, y: number): [number, number] => [fx ? 35 - x : x, fy ? 35 - y : y];
      for (let y = 0; y < 12; y++)
        for (let x = 0; x < 12; x++) {
          const [gx, gy] = loc(x, y);
          if (inPlate(x, y)) {
            const rimTop = y <= 1;
            const rimLeft = x <= 1;
            let col: string = U.bronze;
            if (rimTop) col = fy ? U.bronzeLo : U.gold;
            else if (rimLeft) col = fx ? U.bronzeLo : U.gold;
            else if (x + y >= 8) col = U.bevel;
            px(c, gx, gy, col);
          } else if (x + y >= 3 && (inPlate(x + 1, y) || inPlate(x - 1, y) || inPlate(x, y + 1) || inPlate(x, y - 1))) px(c, gx, gy, OUT);
        }
      const [sx, sy] = loc(5, 5);
      stud(c, sx, sy);
    }
  });
  pixelTex(scene, 'ui_frame_plate', 18, 18, (c) => {
    frameRect(c, 18, 18, [OUT, [U.gold, U.bronzeLo], U.bronze, OUT, ['#3a2818', '#22170f']], 2, '#2a1c12');
    for (const [x, y] of [[3, 3], [14, 3], [3, 14], [14, 14]]) {
      px(c, x, y, U.goldHi);
    }
  });
  pixelTex(scene, 'ui_frame_banner', 18, 18, (c) => {
    frameRect(c, 18, 18, [OUT, [U.gold, U.bronzeLo], U.bronze, OUT, ['#fff4d8', '#cbb48a']], 2, (_x, y) => (y >= 12 ? '#d8c49a' : '#e8d8b0'));
    for (const [x, y] of [[3, 3], [14, 3], [3, 14], [14, 14]]) px(c, x, y, U.goldHi);
  });
  pixelTex(scene, 'ui_frame_slot', 22, 22, (c) => {
    frameRect(c, 22, 22, [OUT, [U.gold, U.bronzeLo], U.bronze, [U.bevel, U.gold], OUT, [U.deeper, '#2a1c12']], 2, U.deep);
    for (const [x, y] of [[2, 2], [19, 2], [2, 19], [19, 19]]) px(c, x, y, U.goldHi);
  });
  pixelTex(scene, 'ui_frame_card', 14, 14, (c) => {
    frameRect(c, 14, 14, [OUT, [U.gold, U.bevel], OUT], 1, 'rgba(28,20,14,0.84)');
    rect(c, 2, 1, 10, 1, U.gold);
    px(c, 1, 2, U.gold);
    px(c, 12, 2, U.bronze);
  });
  const button = (key: string, down: boolean): void =>
    pixelTex(scene, key, 22, 22, (c) => {
      const bands: readonly Band[] = down
        ? [OUT, [U.bronzeLo, U.gold], U.bronze, OUT, [U.woodLo, U.woodHi]]
        : [OUT, [U.gold, U.bronzeLo], U.bronze, OUT, [U.woodHi, U.woodLo]];
      frameRect(c, 22, 22, bands, 3, down ? '#3e2a1a' : U.wood);
      for (const [x, y] of [[3, 3], [18, 3], [3, 18], [18, 18]]) px(c, x, y, down ? U.bronze : U.goldHi);
    });
  button('ui_frame_button', false);
  button('ui_frame_button_down', true);
  pixelTex(scene, 'ui_bar_frame', 10, 10, (c) => {
    frameRect(c, 10, 10, [OUT, [U.gold, U.bevel], OUT], 1, U.deeper);
  });
  // ---- v4 frame weights. Gold only on tappable things: heavy carries the bevel, light is a quiet 1 px bronze line,
  // strip is no frame at all (a soft dark strip whose ends fade in two hard steps: no smooth gradient).
  pixelTex(scene, 'ui_frame_heavy', 26, 26, (c) => {
    frameRect(c, 26, 26, [OUT, [U.goldHi, U.bronzeLo], [U.gold, U.bronzeLo], U.bronze, [U.bevel, U.gold], OUT, [U.deeper, '#2a1c12']], 3, U.deep);
    for (const [x, y] of [[4, 4], [21, 4], [4, 21], [21, 21]]) stud(c, x, y, false);
  });
  const light = (key: string, line: Band, fill: string): void =>
    pixelTex(scene, key, 10, 10, (c) => {
      frameRect(c, 10, 10, [OUT, line, [U.deeper, '#241810']], 1, fill);
    });
  light('ui_frame_light', ['#6a4c2c', '#4a3420'], 'rgba(24,17,12,0.86)');
  light('ui_frame_light_on', [U.gold, U.bronze], 'rgba(34,24,15,0.9)');
  pixelTex(scene, 'ui_strip', 12, 12, (c) => {
    paint(c, 12, 12, (x, y) => {
      const e = Math.min(x, 11 - x, y, 11 - y);
      const corner = Math.min(x, 11 - x) + Math.min(y, 11 - y);
      if (corner < 2) return null;
      return e === 0 ? 'rgba(18,12,10,0.28)' : e === 1 ? 'rgba(18,12,10,0.46)' : 'rgba(18,12,10,0.6)';
    });
  });
  const pill = (key: string, base: string, hi: string): void =>
    pixelTex(scene, key, 12, 10, (c) => {
      frameRect(c, 12, 10, [OUT, [U.gold, U.bevel], OUT], 2, (_x, y) => (y === 3 ? hi : base));
    });
  pill('ui_pill', '#2a1c12', '#3e2a1a');
  pill('ui_pill_safe', '#3c6a2c', '#5a8a3a');
  pill('ui_pill_hunt', '#8a5a1a', '#b07a2a');
  pill('ui_pill_dungeon', '#4a2e6a', '#6a4a8a');
  pill('ui_pill_warden', '#7a1f26', '#a8323a');
}

// ------------------------------------------------------------------ fixed pieces

function drawRounds(scene: Phaser.Scene): void {
  pixelTex(scene, 'ui_round_big', 96, 96, (c) => roundFrame(c, 96, 7, 8, { fill: true, spikes: true, margin: 4 }));
  pixelTex(scene, 'ui_round_small', 52, 52, (c) => roundFrame(c, 52, 4, 4, { fill: true }));
  pixelTex(scene, 'ui_medallion', 76, 76, (c) => {
    roundFrame(c, 76, 6, 0, { fill: false, margin: 3 });
    // crest on top and small studs at the diagonals
    for (const a of [-135, -45, 45, 135]) {
      const r = (Math.PI / 180) * a;
      stud(c, Math.round(38 + Math.cos(r) * 31.5 - 0.5), Math.round(38 + Math.sin(r) * 31.5 - 0.5));
    }
    for (let i = 0; i < 5; i++) {
      const w = 5 - i;
      for (let j = -w; j <= w; j++) px(c, 37 + j + 0.5, 1 + i, Math.abs(j) === w ? OUT : j < 0 ? U.gold : U.bronzeLo);
    }
    px(c, 37, 0, OUT);
    px(c, 37, 3, U.gem);
  });
  pixelTex(scene, 'ui_medallion_bg', 76, 76, (c) => {
    paint(c, 76, 76, (x, y) => {
      const d = Math.hypot(x + 0.5 - 38, y + 0.5 - 38);
      if (d > 29) return null;
      const v = d / 29;
      return v > 0.8 ? (chk(x, y) ? '#22303a' : '#1a242c') : v > 0.55 ? '#22303a' : '#2c3e48';
    });
  });
  pixelTex(scene, 'ui_badge_level', 30, 20, (c) => {
    paint(c, 30, 20, (x, y) => {
      const dx = Math.abs(x + 0.5 - 15);
      const dy = Math.abs(y + 0.5 - 10);
      const e = 15 - dx - dy * 0.55;
      if (dy > 9.5 || e < 0) return null;
      const edge = Math.min(e, 9.5 - dy);
      if (edge < 1) return OUT;
      if (edge < 2) return y < 10 && x < 20 ? U.gold : U.bronzeLo;
      if (edge < 3) return U.bronze;
      if (edge < 4) return OUT;
      return y < 7 ? '#3a2818' : '#2a1c12';
    });
    px(c, 4, 9, U.goldHi);
  });
  pixelTex(scene, 'ui_joy_base', 120, 120, (c) => {
    paint(c, 120, 120, (x, y) => {
      const dx = x + 0.5 - 60;
      const dy = y + 0.5 - 60;
      const d = Math.hypot(dx, dy);
      if (d > 58) return null;
      if (d > 57) return OUT;
      if (d > 54) return -(dx + dy) > 0 ? U.gold : U.bronzeLo;
      if (d > 53) return OUT;
      if (d > 51 && chk(x, y)) return 'rgba(176,128,58,0.5)';
      return 'rgba(18,12,8,0.38)';
    });
    // direction notches
    for (let k = 0; k < 4; k++) {
      const a = (k * Math.PI) / 2;
      const cx = 60 + Math.cos(a) * 45;
      const cy = 60 + Math.sin(a) * 45;
      for (let i = 0; i < 4; i++)
        for (let j = -i; j <= i; j++) {
          const X = Math.round(cx + Math.cos(a) * (3 - i) - Math.sin(a) * j - 0.5);
          const Y = Math.round(cy + Math.sin(a) * (3 - i) + Math.cos(a) * j - 0.5);
          px(c, X, Y, Math.abs(j) === i ? OUT : U.gold);
        }
    }
  });
  pixelTex(scene, 'ui_joy_knob', 48, 48, (c) => {
    roundFrame(c, 48, 4, 0, { fill: false, margin: 1 });
    paint(c, 48, 48, (x, y) => {
      const dx = x + 0.5 - 24;
      const dy = y + 0.5 - 24;
      const d = Math.hypot(dx, dy);
      if (d > 17.5) return null;
      const l = Math.hypot(x + 0.5 - 19, y + 0.5 - 19) / 26;
      return l < 0.2 ? '#7a5a40' : l < 0.45 ? '#5c4030' : l < 0.7 ? U.wood : U.woodLo;
    });
    stud(c, 24, 24);
  });
  pixelTex(scene, 'ui_chevron', 13, 9, (c) => {
    const rows = ['W.........W', 'WW.......WS', '.WW.....WS.', '..WW...WS..', '...WW.WS...', '....WWS....', '.....S.....'];
    rows.forEach((row, j) => {
      for (let i = 0; i < row.length; i++) {
        if (row[i] === 'W') px(c, i + 1, j + 1, '#ffffff');
        if (row[i] === 'S') px(c, i + 1, j + 1, '#f2dc9a');
      }
    });
    outline(c, 13, 9, OUT);
  });
  const fill = (key: string, ramp: readonly string[]): void =>
    pixelTex(scene, key, 1, 8, (c) => ramp.forEach((col, i) => px(c, 0, i, col)));
  fill('ui_bar_fill_hp', ['#f49a84', '#e8604e', '#d8433f', '#d8433f', '#c0363a', '#a82c32', '#8e2228', '#6e1a20']);
  fill('ui_bar_fill_sp', ['#9cc4ff', '#6a9cf0', '#3f7fd8', '#3f7fd8', '#3670c4', '#2c5ea8', '#244e8c', '#1c3e70']);
  fill('ui_bar_fill_exp', ['#fff1c0', '#f4d47a', '#e9c46a', '#e9c46a', '#d8ac4a', '#c0923a', '#a07830', '#7a5a22']);
}

function drawGlyphs(scene: Phaser.Scene): void {
  for (const g of UI_GLYPHS) pixelTex(scene, `ui_ico_${g}`, 24, 24, (c) => paintUiGlyph(c, g));
}

// ------------------------------------------------------------------ entry points

/** Generates every UI texture (idempotent per key). Call once at boot. */
export function drawUi(scene: Phaser.Scene): void {
  drawFrames(scene);
  drawRounds(scene);
  drawGlyphs(scene);
}

/** Data URL of any UI texture ('' if it does not exist). */
export function uiUrl(scene: Phaser.Scene, key: string): string {
  return scene.textures.exists(key) ? textureDataUrl(scene, key) : '';
}

/**
 * CSS size (px) closest to `cssPx` at which `artPx` art pixels map to a whole number of device pixels
 * (keeps pixel art crisp at any devicePixelRatio). Example: pixelSnap(48, 32) → 42.67 on a DPR-3 phone (4×).
 */
export function pixelSnap(cssPx: number, artPx: number, dpr: number = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1): number {
  const k = Math.max(1, Math.round((cssPx * dpr) / artPx));
  return (k * artPx) / dpr;
}

/**
 * Recommended OFL pixel fonts (docs/QUALITY-PLAN.md §4): Pixelify Sans for UI text (`@fontsource/pixelify-sans`,
 * weights 400/700) and Tiny5 for small labels / numbers (`@fontsource/tiny5`). Ship their LICENSE files.
 */
export const UI_FONT_STACK = "'Pixelify Sans', ui-monospace, monospace";
export const UI_FONT_SMALL_STACK = "'Tiny5', 'Pixelify Sans', ui-monospace, monospace";
/**
 * v4 type (SPEC-v4 §11.7): two faces, three sizes.
 *  - BODY: Tiny5, a plain even-stroke pixel face, for numbers and body text. Crisp only at multiples of 8 px.
 *  - DISPLAY: the game's own drawn bitmap face (render/glyphs.ts), painted to an image by render/fonts.ts
 *    displayText() / displayLabel() for zone names and headers. The stack below is only the fallback for display
 *    text that cannot be an image (it must stay rare).
 */
export const UI_FONT_BODY_STACK = "'Tiny5', ui-monospace, monospace";
export const UI_FONT_DISPLAY_STACK = "'Pixelify Sans', 'Tiny5', ui-monospace, monospace";
/** The three text sizes (CSS px): small labels, body and numbers, headers. */
export const UI_TEXT_SIZES = { s: 8, m: 16, l: 24 } as const;

/**
 * A CSS block exposing every UI texture as custom properties on :root plus ready-made helper classes.
 *   --ui-frame-<name>: url(data:…)   --ui-frame-<name>-slice: <n>   (9-slice frames; use with border-image)
 *   --ui-<piece>: url(data:…)                                        (fixed pieces, bar fills, chevron, glyphs)
 *   --ui-px: art-pixel scale (default 1px; set 2px on large tablets / desktop if wanted)
 *   --ui-font / --ui-font-small: pixel font stacks (see UI_FONT_STACK)
 * Classes: .ui-frame-<name> (border-image frame, content sits inside the border), .ui-round-big|small,
 * .ui-medallion, .ui-badge-level, .ui-bar (+ .ui-bar > .ui-bar-fill.hp|sp|exp), .ui-pill(-safe…), .ui-ico-<glyph>.
 * Inject once: `const st = document.createElement('style'); st.textContent = uiCss(scene); document.head.append(st)`.
 */
export function uiCss(scene: Phaser.Scene): string {
  drawUi(scene);
  const vars: string[] = [
    '  --ui-px: 1px;',
    `  --ui-font: ${UI_FONT_STACK};`,
    `  --ui-font-small: ${UI_FONT_SMALL_STACK};`,
    `  --ui-font-body: ${UI_FONT_BODY_STACK};`,
    `  --ui-font-display: ${UI_FONT_DISPLAY_STACK};`,
    `  --ui-text-s: ${UI_TEXT_SIZES.s}px;`,
    `  --ui-text-m: ${UI_TEXT_SIZES.m}px;`,
    `  --ui-text-l: ${UI_TEXT_SIZES.l}px;`,
  ];
  const rules: string[] = [];
  for (const [key, slice] of Object.entries(UI_SLICES)) {
    const name = key.replace(/^ui_/, '').replace(/_/g, '-');
    vars.push(`  --ui-${name}: url("${uiUrl(scene, key)}");`, `  --ui-${name}-slice: ${slice};`);
    rules.push(
      `.ui-${name}{border-style:solid;border-width:calc(var(--ui-px) * ${slice});border-image-source:var(--ui-${name});` +
        `border-image-slice:${slice} fill;border-image-width:calc(var(--ui-px) * ${slice});border-image-repeat:stretch;` +
        `image-rendering:pixelated;background:none;box-sizing:border-box}`,
    );
  }
  for (const [key, [w, h]] of Object.entries(UI_SIZES)) {
    const name = key.replace(/^ui_/, '').replace(/_/g, '-');
    vars.push(`  --ui-${name}: url("${uiUrl(scene, key)}");`);
    if (key.startsWith('ui_bar_fill')) continue;
    rules.push(
      `.ui-${name}{width:calc(var(--ui-px) * ${w});height:calc(var(--ui-px) * ${h});background:var(--ui-${name}) center / 100% 100% no-repeat;image-rendering:pixelated}`,
    );
  }
  for (const g of UI_GLYPHS) {
    vars.push(`  --ui-ico-${g}: url("${uiUrl(scene, `ui_ico_${g}`)}");`);
    rules.push(`.ui-ico-${g}{background:var(--ui-ico-${g}) center / contain no-repeat;image-rendering:pixelated}`);
  }
  rules.push(
    '.ui-bar{position:relative;overflow:hidden}',
    '.ui-bar>.ui-bar-fill{position:absolute;left:0;top:0;bottom:0;background-size:100% 100%;image-rendering:pixelated}',
    '.ui-bar>.ui-bar-fill.hp{background-image:var(--ui-bar-fill-hp)}',
    '.ui-bar>.ui-bar-fill.sp{background-image:var(--ui-bar-fill-sp)}',
    '.ui-bar>.ui-bar-fill.exp{background-image:var(--ui-bar-fill-exp)}',
    '.ui-display{display:inline-block;background:center / 100% 100% no-repeat;image-rendering:pixelated;vertical-align:middle;flex:none}',
    `.ui-body{font-family:var(--ui-font-body);font-size:var(--ui-text-m);line-height:1;color:${PAL.ui.text}}`,
    `.ui-text{font-family:var(--ui-font);color:${PAL.ui.text};text-shadow:1px 0 ${OUT},-1px 0 ${OUT},0 1px ${OUT},0 -1px ${OUT}}`,
  );
  return `:root{\n${vars.join('\n')}\n}\n${rules.join('\n')}\n`;
}
