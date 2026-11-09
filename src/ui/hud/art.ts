// UI art for the DOM (HUD lane). The render lane injects `uiCss(scene)` once at boot (docs/INTEGRATION-v3.md §2.1);
// until that lands — or if a build ships without it — this shim builds the same :root custom properties from the
// controller's `uiUrl()` so the HUD frames still work. With no UI art at all the HUD falls back to plain CSS borders
// (`.hud-layer:not(.ui-art)` rules in hud.css). Never paints textures itself.
import type { GameController } from '../controller';

/** 9-slice frame textures and their slices (mirrors UI_SLICES in src/game/art/ui.ts — read-only copy). */
const FRAMES: Record<string, number> = {
  ui_frame_panel: 12,
  ui_frame_plate: 6,
  ui_frame_banner: 6,
  ui_frame_slot: 7,
  ui_frame_card: 5,
  ui_frame_button: 7,
  ui_frame_button_down: 7,
  ui_bar_frame: 3,
  ui_pill: 4,
  ui_pill_safe: 4,
  ui_pill_hunt: 4,
  ui_pill_dungeon: 4,
  ui_pill_warden: 4,
};

/** Fixed pieces the HUD uses. */
const PIECES = ['ui_round_big', 'ui_round_small', 'ui_medallion', 'ui_medallion_bg', 'ui_badge_level', 'ui_chevron', 'ui_bar_fill_hp', 'ui_bar_fill_sp', 'ui_bar_fill_exp'];

/** HUD glyphs (`ui_ico_<name>`). */
const GLYPHS = ['skills', 'fuse', 'class', 'codex', 'bag', 'map', 'menu', 'quest', 'attack', 'auto', 'target', 'potion', 'recall', 'rest', 'close'];

const cssName = (key: string) => `--ui-${key.replace(/^ui_/, '').replace(/_/g, '-')}`;

/** True when the :root carries the UI frame properties (uiCss injected by boot, or by this shim). */
export function hasUiArt(): boolean {
  try {
    return getComputedStyle(document.documentElement).getPropertyValue('--ui-frame-plate').trim() !== '';
  } catch {
    return false;
  }
}

let shimmed = false;

/**
 * Makes sure the UI art custom properties exist. Returns true when they do. Cheap after the first success.
 * LANE render: once BootScene injects uiCss(scene) this only ever takes the first branch.
 */
export function ensureUiArt(ctrl: GameController): boolean {
  if (shimmed || hasUiArt()) return true;
  let probe = '';
  try {
    probe = ctrl.uiUrl('ui_frame_plate');
  } catch {
    return false;
  }
  if (!probe) return false;
  const vars: string[] = [];
  for (const [key, slice] of Object.entries(FRAMES)) {
    const url = ctrl.uiUrl(key);
    if (url) vars.push(`${cssName(key)}:url("${url}");${cssName(key)}-slice:${slice};`);
  }
  for (const key of PIECES) {
    const url = ctrl.uiUrl(key);
    if (url) vars.push(`${cssName(key)}:url("${url}");`);
  }
  for (const g of GLYPHS) {
    const url = ctrl.uiUrl(`ui_ico_${g}`);
    if (url) vars.push(`--ui-ico-${g}:url("${url}");`);
  }
  const st = document.createElement('style');
  st.dataset.owner = 'hud-art-shim';
  st.textContent = `:root{--ui-px:1px;${vars.join('')}}`;
  document.head.append(st);
  shimmed = true;
  return true;
}
