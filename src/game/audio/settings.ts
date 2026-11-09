// Audio settings (docs/QUALITY-PLAN.md §6): master / SFX / ambience / music volumes + mute, persisted in
// localStorage. Pure apart from the injected storage, so node tests drive it with a fake store. The ☰ menu toggle
// (HUD lane) calls getAudioSettings / setAudioSettings / onChange from src/game/audio/index.ts.

export interface AudioSettings {
  /** 0..1, scales everything. */
  master: number;
  /** 0..1: combat, UI, footsteps, fanfares. */
  sfx: number;
  /** 0..1: the biome beds and their one-shots (birds, drips, thunder). */
  ambience: number;
  /** 0..1: reserved for the music step (docs/QUALITY-PLAN.md §14); stored and applied to the music bus. */
  music: number;
  /** Silences everything (the AudioContext is suspended while muted). */
  muted: boolean;
}

export const AUDIO_DEFAULTS: Readonly<AudioSettings> = Object.freeze({
  master: 0.8,
  sfx: 0.9,
  ambience: 0.6,
  music: 0.6,
  muted: false,
});

export const AUDIO_STORE_KEY = 'omnipath.audio.v1';

/** The subset of Storage the settings need (tests pass a Map-backed fake). */
export interface KeyStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp01 = (v: unknown, d: number): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : d;
};

/** Repairs any value (old saves, hand edits, partial patches) into valid settings. */
export function sanitizeSettings(raw: unknown, base: Readonly<AudioSettings> = AUDIO_DEFAULTS): AudioSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof AudioSettings, unknown>>;
  return {
    master: clamp01(r.master, base.master),
    sfx: clamp01(r.sfx, base.sfx),
    ambience: clamp01(r.ambience, base.ambience),
    music: clamp01(r.music, base.music),
    muted: typeof r.muted === 'boolean' ? r.muted : base.muted,
  };
}

/** The effective linear gain of each bus (mute folds into master). */
export function busGains(s: Readonly<AudioSettings>): { master: number; sfx: number; ambience: number; music: number } {
  // Perceptual curve: a slider at 50 % sounds about half as loud (≈ −10 dB), not barely quieter.
  const curve = (v: number) => v * v;
  return {
    master: s.muted ? 0 : curve(s.master),
    sfx: curve(s.sfx),
    ambience: curve(s.ambience),
    music: curve(s.music),
  };
}

/** True when nothing can be heard (the engine suspends the AudioContext). */
export function isSilent(s: Readonly<AudioSettings>): boolean {
  return s.muted || s.master <= 0;
}

/** Settings with persistence and change listeners. */
export class SettingsStore {
  private value: AudioSettings;
  private readonly fns = new Set<(s: Readonly<AudioSettings>) => void>();

  constructor(private readonly store: KeyStore | null) {
    this.value = sanitizeSettings(this.read());
  }

  get(): AudioSettings {
    return { ...this.value };
  }

  /** Applies a partial change, persists it and notifies listeners (only when something changed). */
  set(patch: Partial<AudioSettings>): AudioSettings {
    const next = sanitizeSettings({ ...this.value, ...patch }, this.value);
    const changed = (Object.keys(next) as (keyof AudioSettings)[]).some((k) => next[k] !== this.value[k]);
    if (!changed) return this.get();
    this.value = next;
    this.write();
    for (const fn of [...this.fns]) {
      try {
        fn(this.get());
      } catch (error) {
        console.error('[omnipath] audio settings listener failed:', error);
      }
    }
    return this.get();
  }

  onChange(fn: (s: Readonly<AudioSettings>) => void): () => void {
    this.fns.add(fn);
    return () => this.fns.delete(fn);
  }

  listenerCount(): number {
    return this.fns.size;
  }

  private read(): unknown {
    try {
      const raw = this.store?.getItem(AUDIO_STORE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  private write(): void {
    try {
      this.store?.setItem(AUDIO_STORE_KEY, JSON.stringify(this.value));
    } catch {
      // Private mode / quota / blocked storage: settings still apply for this run.
    }
  }
}

/** window.localStorage when it exists and is usable, else null (node, sandboxed iframes, blocked storage). */
export function browserStore(): KeyStore | null {
  try {
    const ls = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!ls) return null;
    const probe = `${AUDIO_STORE_KEY}.probe`;
    ls.setItem(probe, '1');
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}
