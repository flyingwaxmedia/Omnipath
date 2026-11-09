// ☰ menu settings (docs/UX-SIMPLE.md: one short line each, a switch or a slider, nothing to read):
//   Sound On/Off + Volume  -> src/game/audio (getAudioSettings / setAudioSettings: mute + master volume, saved on the
//                             device by the audio engine);
//   Reduce shake & flashes -> src/game/vfx/runtime/settings (the VFX runtime and the camera rig read it live: softer
//                             shake, no screen flash, calmer effect frames) + `.reduce-flash` on #hud-root, which stops
//                             the HUD's own flash pulses (hud.css).
//   Quality Low/Medium/High -> src/game/render/quality.ts (lighting, grade, ambient density, VFX ceiling; the device's
//                             automatic pick shows selected until the player taps one);
//   Battery saver          -> quality.ts as well (30 fps, one quality step lower).
// The quality rows are a second block (menuQualityHtml) so the sound block keeps its three rows.
import { getAudioSettings, playSound, setAudioSettings } from '../../game/audio';
import { type QualityTier, QUALITY_TIERS, qualityState, setBatterySaver, setQualityTier } from '../../game/render/quality';
import { setReduceFlash, vfxSettings } from '../../game/vfx/runtime/settings';
import { $, $$, esc } from '../util';

export interface MenuSettings {
  /** Sound on (not muted). */
  sound: boolean;
  /** Master volume, 0..100 in steps of 10. */
  volume: number;
  /** "Reduce shake & flashes". */
  calm: boolean;
}

/** Plain words for the menu rows. */
export const SETTINGS_WORDS = {
  sound: 'Sound',
  volume: 'Volume',
  calm: 'Reduce shake & flashes',
  on: 'On',
  off: 'Off',
} as const;

const toStep = (v: number) => Math.max(0, Math.min(100, Math.round(v * 10) * 10));

/** The current values (safe before the audio engine starts: it never touches Web Audio until the first tap). */
export function readMenuSettings(): MenuSettings {
  let sound = true;
  let volume = 80;
  try {
    const a = getAudioSettings();
    sound = !a.muted;
    volume = toStep(a.master);
  } catch {
    /* audio unavailable: show the defaults */
  }
  return { sound, volume, calm: vfxSettings.reduceFlash };
}

const sw = (key: 'sound' | 'calm' | 'battery', on: boolean, label: string) =>
  `<button class="mn-sw${on ? ' on' : ''}" data-set="${key}" role="switch" aria-checked="${on}" aria-label="${label}">${on ? SETTINGS_WORDS.on : SETTINGS_WORDS.off}</button>`;

/** Three rows: Sound [On], Volume slider, Reduce shake & flashes [Off]. */
export function menuSettingsHtml(s: MenuSettings): string {
  const calm = esc(SETTINGS_WORDS.calm);
  return `<div class="mn-set">
    <div class="mn-row"><span>${SETTINGS_WORDS.sound}</span>${sw('sound', s.sound, SETTINGS_WORDS.sound)}</div>
    <label class="mn-row mn-vol${s.sound ? '' : ' off'}"><span>${SETTINGS_WORDS.volume}</span><input type="range" min="0" max="100" step="10" value="${s.volume}" style="--v:${s.volume}%" aria-label="${SETTINGS_WORDS.volume}"></label>
    <div class="mn-row"><span>${calm}</span>${sw('calm', s.calm, calm)}</div>
  </div>`;
}

/** Puts `.reduce-flash` on the HUD root (or removes it) so the HUD's flash pulses follow the setting. */
export function applyCalm(on: boolean, root: Element | null = typeof document === 'undefined' ? null : document.getElementById('hud-root')): void {
  root?.classList.toggle('reduce-flash', on);
}

function setSwitch(b: HTMLElement, on: boolean): void {
  b.classList.toggle('on', on);
  b.setAttribute('aria-checked', String(on));
  b.textContent = on ? SETTINGS_WORDS.on : SETTINGS_WORDS.off;
}

/** Wires the rows rendered by menuSettingsHtml inside `body`. */
export function wireMenuSettings(body: HTMLElement): void {
  const soundBtn = $<HTMLButtonElement>(body, '.mn-sw[data-set="sound"]');
  const calmBtn = $<HTMLButtonElement>(body, '.mn-sw[data-set="calm"]');
  const vol = $<HTMLInputElement>(body, '.mn-vol input');
  const volRow = $(body, '.mn-vol');
  const showSound = (on: boolean) => {
    setSwitch(soundBtn, on);
    volRow.classList.toggle('off', !on);
  };
  soundBtn.addEventListener('click', () => {
    const on = !soundBtn.classList.contains('on');
    setAudioSettings({ muted: !on });
    showSound(on);
    if (on) playSound('ui_confirm');
  });
  // Moving the volume turns the sound back on; letting go plays a tap at the new level.
  vol.addEventListener('input', () => {
    const v = Math.max(0, Math.min(100, Number(vol.value) || 0));
    setAudioSettings({ master: v / 100, muted: false });
    vol.style.setProperty('--v', `${v}%`);
    showSound(true);
  });
  vol.addEventListener('change', () => playSound('ui_tap'));
  calmBtn.addEventListener('click', () => {
    const on = !calmBtn.classList.contains('on');
    setReduceFlash(on);
    applyCalm(on);
    setSwitch(calmBtn, on);
  });
}

// ------------------------------------------------------------------ Quality + Battery saver (second block)

export interface QualitySettings {
  /** The tier shown selected: the player's pick, else the device's automatic one. */
  tier: QualityTier;
  battery: boolean;
}

/** Plain words for the quality rows. */
export const QUALITY_WORDS = {
  quality: 'Quality',
  battery: 'Battery saver',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  credits: 'Credits',
} as const;

export function readQualitySettings(): QualitySettings {
  const s = qualityState();
  return { tier: s.shown, battery: s.battery };
}

/** Two rows: Quality [Low | Medium | High], Battery saver [Off]. */
export function menuQualityHtml(q: QualitySettings): string {
  const seg = QUALITY_TIERS.map((t) => {
    const on = t === q.tier;
    return `<button class="mn-sw${on ? ' on' : ''}" data-tier="${t}" role="radio" aria-checked="${on}">${QUALITY_WORDS[t]}</button>`;
  }).join('');
  return `<div class="mn-set mn-q">
    <div class="mn-row mn-tier"><span>${QUALITY_WORDS.quality}</span><div class="mn-seg" role="radiogroup" aria-label="${QUALITY_WORDS.quality}">${seg}</div></div>
    <div class="mn-row"><span>${QUALITY_WORDS.battery}</span>${sw('battery', q.battery, QUALITY_WORDS.battery)}</div>
  </div>`;
}

const QUALITY_CSS_ID = 'omnipath-menu-quality-css';
/** The second block continues the first (one divider between the sound and the picture rows); a tight segment. */
const QUALITY_CSS = `
.sheet.hud-sheet.menu-sheet .mn-set.mn-q { margin-top: 0; border-top: 0; }
.sheet.hud-sheet.menu-sheet .mn-seg { display: flex; flex: none; gap: 4px; }
.sheet.hud-sheet.menu-sheet .mn-seg .mn-sw { min-width: 0; padding: 0 10px; }
@media (max-width: 380px) { .sheet.hud-sheet.menu-sheet .mn-seg .mn-sw { padding: 0 7px; } }
/* Narrow sheets (phone portrait): "Back to the game" on its own line, Credits and New game side by side under it
   (instead of New game wrapping alone). */
@media (max-width: 480px) {
  .sheet.hud-sheet.menu-sheet .mn-actions > .mn-resume { flex: 1 1 100%; }
  .sheet.hud-sheet.menu-sheet .mn-actions > .mn-credits,
  .sheet.hud-sheet.menu-sheet .mn-actions > .mn-new { flex: 1 1 0; }
}
`;

function ensureQualityCss(): void {
  if (typeof document === 'undefined' || document.getElementById(QUALITY_CSS_ID)) return;
  const st = document.createElement('style');
  st.id = QUALITY_CSS_ID;
  st.textContent = QUALITY_CSS;
  document.head.append(st);
}

/** Wires the rows rendered by menuQualityHtml inside `body` (changes apply at once, behind the menu). */
export function wireQualitySettings(body: HTMLElement): void {
  ensureQualityCss();
  const tiers = $$<HTMLButtonElement>(body, '.mn-seg .mn-sw[data-tier]');
  const battery = $<HTMLButtonElement>(body, '.mn-sw[data-set="battery"]');
  const show = () => {
    const q = readQualitySettings();
    for (const b of tiers) {
      const on = b.dataset.tier === q.tier;
      b.classList.toggle('on', on);
      b.setAttribute('aria-checked', String(on));
    }
    if (battery) setSwitch(battery, q.battery);
  };
  for (const b of tiers)
    b.addEventListener('click', () => {
      setQualityTier(b.dataset.tier as QualityTier);
      show();
      playSound('ui_tap');
    });
  battery?.addEventListener('click', () => {
    setBatterySaver(!battery.classList.contains('on'));
    show();
    playSound('ui_tap');
  });
}
