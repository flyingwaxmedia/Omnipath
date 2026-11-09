// ☰ menu settings (src/ui/hud/settings.ts): Sound On/Off + Volume (audio settings) and "Reduce shake & flashes"
// (VFX runtime setting), in plain words (docs/UX-SIMPLE.md).
import { beforeEach, describe, expect, it, vi } from 'vitest';

const audio = vi.hoisted(() => ({ master: 0.8, muted: false }));
vi.mock('../src/game/audio', () => ({
  getAudioSettings: () => ({ master: audio.master, sfx: 0.9, ambience: 0.6, music: 0.6, muted: audio.muted }),
  setAudioSettings: (p: Partial<typeof audio>) => Object.assign(audio, p),
  playSound: () => ({ ok: true }),
}));

import { SETTINGS_WORDS, applyCalm, menuSettingsHtml, readMenuSettings } from '../src/ui/hud/settings';
import { setReduceFlash, vfxSettings } from '../src/game/vfx/runtime/settings';

describe('menu settings', () => {
  beforeEach(() => {
    audio.master = 0.8;
    audio.muted = false;
    setReduceFlash(false);
  });

  it('reads sound, volume (0..100 in tens) and the reduce setting', () => {
    expect(readMenuSettings()).toEqual({ sound: true, volume: 80, calm: false });
    audio.muted = true;
    audio.master = 0.47;
    setReduceFlash(true);
    expect(readMenuSettings()).toEqual({ sound: false, volume: 50, calm: true });
    expect(vfxSettings.reduceFlash).toBe(true);
  });

  it('renders three plain rows: two On/Off switches and one slider', () => {
    const html = menuSettingsHtml({ sound: true, volume: 60, calm: false });
    expect(html.match(/class="mn-row/g)).toHaveLength(3);
    expect(html).toContain('>Sound<');
    expect(html).toContain('>Volume<');
    expect(html).toContain('Reduce shake &amp; flashes');
    expect(html).toMatch(/data-set="sound" role="switch" aria-checked="true"[^>]*>On</);
    expect(html).toMatch(/data-set="calm" role="switch" aria-checked="false"[^>]*>Off</);
    expect(html).toContain('type="range" min="0" max="100" step="10" value="60"');
    // Muted: the volume row dims.
    expect(menuSettingsHtml({ sound: false, volume: 60, calm: true })).toContain('mn-vol off');
    // No numbers, tags or internals in the words.
    for (const w of Object.values(SETTINGS_WORDS)) expect(w).not.toMatch(/\d|%|flash budget|trauma/i);
  });

  it('applyCalm toggles .reduce-flash on the HUD root', () => {
    const cls = new Set<string>();
    const root = { classList: { toggle: (c: string, on: boolean) => (on ? cls.add(c) : cls.delete(c)) } } as unknown as Element;
    applyCalm(true, root);
    expect(cls.has('reduce-flash')).toBe(true);
    applyCalm(false, root);
    expect(cls.has('reduce-flash')).toBe(false);
    expect(() => applyCalm(true, null)).not.toThrow();
  });
});
