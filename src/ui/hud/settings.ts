// ☰ menu settings (docs/UX-SIMPLE.md: one short line each, a switch or a slider, nothing to read):
//   Sound On/Off + Volume  -> src/game/audio (getAudioSettings / setAudioSettings: mute + master volume, saved on the
//                             device by the audio engine);
//   Reduce shake & flashes -> src/game/vfx/runtime/settings (the VFX runtime and the camera rig read it live: softer
//                             shake, no screen flash, calmer effect frames) + `.reduce-flash` on #hud-root, which stops
//                             the HUD's own flash pulses (hud.css).
import { getAudioSettings, playSound, setAudioSettings } from '../../game/audio';
import { setReduceFlash, vfxSettings } from '../../game/vfx/runtime/settings';
import { $, esc } from '../util';

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

const sw = (key: 'sound' | 'calm', on: boolean, label: string) =>
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
