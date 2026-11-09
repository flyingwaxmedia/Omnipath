// Quality tiers, battery saver and persistent storage (src/game/render/quality.ts) and the ☰ menu's quality rows
// (src/ui/hud/settings.ts): docs/QUALITY-PLAN.md Phase D item 15.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({
  getAudioSettings: () => ({ master: 0.8, sfx: 0.9, ambience: 0.6, music: 0.6, muted: false }),
  setAudioSettings: () => undefined,
  playSound: () => ({ ok: true }),
}));

import { ambientQuality, setAmbientQuality } from '../src/game/render/ambient';
import { gradeEnabled, setGradeEnabled } from '../src/game/render/grade';
import { lightingEnabled, setLightingEnabled } from '../src/game/render/lighting';
import {
  BATTERY_FPS,
  LIMIT_SLACK_MS,
  TIER_SPECS,
  applyFpsCap,
  applyVfx,
  autoTier,
  batterySaver,
  fpsCap,
  lowerTier,
  onQualityChange,
  persistStorageOnce,
  qualityState,
  setBatterySaver,
  setDevice,
  setQualityTier,
  vfxMaxQuality,
} from '../src/game/render/quality';
import { QUALITY_WORDS, menuQualityHtml, menuSettingsHtml, readQualitySettings } from '../src/ui/hud/settings';

describe('automatic tier', () => {
  it('Canvas or a low-memory device starts on Low, everything else on High', () => {
    expect(autoTier({ webgl: false })).toBe('low');
    expect(autoTier({ webgl: false, memoryGB: 8, cores: 8 })).toBe('low');
    expect(autoTier({ webgl: true, memoryGB: 2 })).toBe('low');
    expect(autoTier({ webgl: true, memoryGB: 1, cores: 8 })).toBe('low');
    expect(autoTier({ webgl: true, cores: 2 })).toBe('low');
    expect(autoTier({ webgl: true, memoryGB: 4, cores: 6 })).toBe('high');
    // Safari (the iPad) reports no deviceMemory.
    expect(autoTier({ webgl: true, cores: 8 })).toBe('high');
    expect(autoTier({ webgl: true })).toBe('high');
  });

  it('the battery saver goes one step down', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBe('low');
  });

  it('tiers get monotonically cheaper', () => {
    const rank = { low: 0, med: 1, high: 2 } as const;
    expect(TIER_SPECS.high.vfxMax).toBeGreaterThan(TIER_SPECS.medium.vfxMax);
    expect(TIER_SPECS.medium.vfxMax).toBeGreaterThan(TIER_SPECS.low.vfxMax);
    expect(rank[TIER_SPECS.high.ambient]).toBeGreaterThan(rank[TIER_SPECS.medium.ambient]);
    expect(rank[TIER_SPECS.medium.ambient]).toBeGreaterThan(rank[TIER_SPECS.low.ambient]);
    expect(TIER_SPECS.low.lighting || TIER_SPECS.low.grade).toBe(false);
    expect(TIER_SPECS.high.lighting && TIER_SPECS.high.grade).toBe(true);
  });
});

describe('picking a tier', () => {
  beforeEach(() => {
    setBatterySaver(false);
    setQualityTier(null);
    setDevice({ webgl: true, memoryGB: 8, cores: 8 });
  });
  afterEach(() => {
    setBatterySaver(false);
    setQualityTier(null);
    setLightingEnabled(true);
    setGradeEnabled(true);
    setAmbientQuality(null);
  });

  it('switches lighting, grade and ambient density through their modules, live', () => {
    expect(qualityState()).toMatchObject({ tier: 'high', chosen: null, auto: 'high', shown: 'high', fps: 0 });
    expect(lightingEnabled()).toBe(true);
    expect(gradeEnabled()).toBe(true);
    expect(ambientQuality()).toBe('high');
    setQualityTier('low');
    expect(qualityState().tier).toBe('low');
    expect(lightingEnabled()).toBe(false);
    expect(gradeEnabled()).toBe(false);
    expect(ambientQuality()).toBe('low');
    expect(vfxMaxQuality()).toBe(0.25);
    setQualityTier('medium');
    expect(lightingEnabled()).toBe(true);
    expect(gradeEnabled()).toBe(true);
    expect(ambientQuality()).toBe('med');
    expect(vfxMaxQuality()).toBe(0.5);
  });

  it('a Canvas device follows its automatic Low until the player picks', () => {
    setDevice({ webgl: false });
    expect(qualityState()).toMatchObject({ tier: 'low', auto: 'low', shown: 'low', webgl: false });
    setQualityTier('high');
    expect(qualityState()).toMatchObject({ tier: 'high', chosen: 'high' });
  });

  it('the battery saver caps at 30 fps and lowers the tier one step, the menu keeps showing the pick', () => {
    setQualityTier('high');
    setBatterySaver(true);
    expect(batterySaver()).toBe(true);
    expect(fpsCap()).toBe(BATTERY_FPS);
    expect(qualityState()).toMatchObject({ tier: 'medium', shown: 'high', battery: true, fps: 30 });
    expect(readQualitySettings()).toEqual({ tier: 'high', battery: true });
    setBatterySaver(false);
    expect(qualityState()).toMatchObject({ tier: 'high', fps: 0 });
  });

  it('notifies subscribers once per change', () => {
    const seen: string[] = [];
    const off = onQualityChange((s) => seen.push(`${s.tier}${s.battery ? '+b' : ''}`));
    setQualityTier('medium');
    setQualityTier('medium');
    setBatterySaver(true);
    off();
    setQualityTier('low');
    expect(seen).toEqual(['medium', 'low+b']);
  });
});

describe('VFX ceiling', () => {
  beforeEach(() => {
    setBatterySaver(false);
    setQualityTier(null);
    setDevice({ webgl: true });
  });

  it('pins the runtime below High and frees the governor at High', () => {
    const calls: (number | null)[] = [];
    const vfx = { setQuality: (q: 1 | 0.5 | 0.25 | null) => calls.push(q) };
    expect(applyVfx(vfx, true)).toBe('free');
    expect(calls).toEqual([]); // a fresh runtime at High: nothing to undo
    setQualityTier('medium');
    expect(applyVfx(vfx)).toBe(0.5);
    setQualityTier('high');
    expect(applyVfx(vfx)).toBe('free');
    setBatterySaver(true); // High + battery → Medium, pinned (30 fps frames would read as slow to the governor)
    expect(applyVfx(vfx)).toBe(0.5);
    // (released at the ceiling, then handed back to the governor)
    expect(calls).toEqual([0.5, 1, null, 0.5]);
    setBatterySaver(false);
  });

  it('uses a runtime ceiling when the VFX lane offers one, and never touches the Canvas tier', () => {
    const log: string[] = [];
    const vfx = { setQuality: (q: number | null) => log.push(`pin ${q}`), setMaxQuality: (q: number) => log.push(`max ${q}`) };
    setQualityTier('medium');
    expect(applyVfx(vfx, true)).toBe('free');
    expect(log).toEqual(['max 0.5']);
    setDevice({ webgl: false });
    expect(applyVfx(vfx)).toBeNull();
    expect(log).toEqual(['max 0.5']);
  });
});

describe('frame cap', () => {
  const loop = () => {
    const l = { running: true, fpsLimit: 0, hasFpsLimit: false, _limitRate: 0, sleeps: 0, wakes: 0, sleep: () => void l.sleeps++, wake: () => void l.wakes++ };
    return l;
  };

  it('sets Phaser’s limiter just under 1000/30 and restarts a running loop once', () => {
    const l = loop();
    expect(applyFpsCap(l, 30)).toBe(true);
    expect(l).toMatchObject({ fpsLimit: 30, hasFpsLimit: true, sleeps: 1, wakes: 1 });
    expect(l._limitRate).toBeCloseTo(1000 / 30 - LIMIT_SLACK_MS, 6);
    expect(applyFpsCap(l, 30)).toBe(false);
    expect(l.wakes).toBe(1);
    expect(applyFpsCap(l, 0)).toBe(true);
    expect(l).toMatchObject({ fpsLimit: 0, hasFpsLimit: false, _limitRate: 0, wakes: 2 });
  });

  it('keeps 30 fps on 60, 90 and 120 Hz screens (frames per callback)', () => {
    const rate = 1000 / 30 - LIMIT_SLACK_MS;
    for (const hz of [60, 90, 120]) {
      const dt = 1000 / hz;
      // Phaser's stepLimitFPS: delta accumulates until it reaches the rate, then the game steps and it resets.
      let acc = 0;
      let steps = 0;
      for (let i = 0; i < hz * 2; i++) {
        acc += dt + (i % 2 ? 0.3 : -0.3); // vsync jitter
        if (acc >= rate) {
          steps++;
          acc = 0;
        }
      }
      expect(steps / 2).toBeCloseTo(30, 0);
    }
  });

  it('a sleeping loop (full-screen panel) is left asleep', () => {
    const l = loop();
    l.running = false;
    applyFpsCap(l, 30);
    expect(l.hasFpsLimit).toBe(true);
    expect(l.sleeps + l.wakes).toBe(0);
  });
});

describe('persistent storage', () => {
  const local = () => {
    const m = new Map<string, string>();
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  };

  it('asks once, and not when storage is already persistent', async () => {
    const ls = local();
    let asked = 0;
    const storage = { persisted: async () => false, persist: async () => (asked++, true) };
    expect(await persistStorageOnce(storage, ls)).toBe('granted');
    expect(await persistStorageOnce(storage, ls)).toBe('asked-before');
    expect(asked).toBe(1);
    expect(await persistStorageOnce({ persisted: async () => true, persist: async () => (asked++, true) }, local())).toBe('already');
    expect(asked).toBe(1);
    expect(await persistStorageOnce({ persisted: async () => false, persist: async () => false }, local())).toBe('denied');
    expect(await persistStorageOnce(undefined, local())).toBe('unsupported');
    expect(await persistStorageOnce({ persisted: async () => false, persist: () => Promise.reject(new Error('no')) }, local())).toBe('error');
  });
});

describe('menu rows', () => {
  it('Quality is one row of three plain words, Battery saver a switch; the sound block keeps three rows', () => {
    const html = menuQualityHtml({ tier: 'medium', battery: false });
    expect(html.match(/class="mn-row/g)).toHaveLength(2);
    expect(html).toContain('>Quality<');
    expect(html).toContain('>Battery saver<');
    expect(html).toMatch(/data-tier="low" role="radio" aria-checked="false">Low</);
    expect(html).toMatch(/class="mn-sw on" data-tier="medium" role="radio" aria-checked="true">Medium</);
    expect(html).toMatch(/data-tier="high" role="radio" aria-checked="false">High</);
    expect(html).toMatch(/data-set="battery" role="switch" aria-checked="false"[^>]*>Off</);
    expect(menuQualityHtml({ tier: 'low', battery: true })).toMatch(/data-set="battery" role="switch" aria-checked="true"[^>]*>On</);
    expect(menuSettingsHtml({ sound: true, volume: 60, calm: false }).match(/class="mn-row/g)).toHaveLength(3);
    for (const w of Object.values(QUALITY_WORDS)) expect(w).not.toMatch(/\d|%|fps|tier|governor|lut|vfx/i);
  });
});
