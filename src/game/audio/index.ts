// Omnipath audio (docs/QUALITY-PLAN.md §6, §13): the public API.
//
//   initAudio(handle)            main.ts, once: gesture unlock + hidden / idle suspend; retires Phaser's unused
//                                AudioContext; publishes the debug hooks as `handle.debug.audio` (also after
//                                main.ts replaces `handle.debug`)
//   attachAudio(scene)           MapScene.create(), per map: subscribes the scene's sounds; returns the disposer
//   getAudioSettings()           { master, sfx, ambience, music, muted } (copies; 0..1)
//   setAudioSettings(patch)      applies + persists (localStorage 'omnipath.audio.v1'); returns the new settings
//   onChange(fn)                 settings listener; returns the unsubscribe function
//   playSound(name, opts?)       any bank sound (UI lanes: 'ui_confirm', 'ui_nope', 'ui_tap', 'ui_open', 'ui_close')
//
// The ☰ menu's sound toggle / sliders (HUD lane) only need getAudioSettings / setAudioSettings / onChange.
import type Phaser from 'phaser';
import { EventBus, type GameEvents } from '../events';
import { SOUNDS, soundNames } from './bank';
import { type AudioScene, createAudioBridge } from './bridge';
import { AudioEngine, type PlayOptions, type PlayResult } from './engine';
import { retirePhaserSound } from './phaser';
import type { AudioSettings } from './settings';

export type { AudioSettings } from './settings';
export type { PlayOptions, PlayResult } from './engine';

let engine: AudioEngine | null = null;

/** The one engine (created lazily; nothing touches Web Audio until the first gesture). */
export function audioEngine(): AudioEngine {
  return (engine ??= new AudioEngine());
}

export function getAudioSettings(): AudioSettings {
  return audioEngine().settings.get();
}

export function setAudioSettings(patch: Partial<AudioSettings>): AudioSettings {
  return audioEngine().settings.set(patch);
}

export function onChange(fn: (settings: Readonly<AudioSettings>) => void): () => void {
  return audioEngine().settings.onChange(fn);
}

export function playSound(name: string, opts?: PlayOptions): PlayResult {
  return audioEngine().play(name, opts);
}

/** The map scene whose sounds are attached now (debug sandbox). */
let currentScene: AudioScene | null = null;

/** Subscribes one map's sounds (MapScene.create); the returned disposer runs on the scene's SHUTDOWN. */
export function attachAudio(scene: AudioScene): () => void {
  const e = audioEngine();
  e.install();
  const off = createAudioBridge(scene, e);
  currentScene = scene;
  return () => {
    off();
    if (currentScene === scene) currentScene = null;
  };
}

/** A private bus wired to the current map's bridge logic (debug: drives sounds without touching the game). */
export interface AudioSandbox {
  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void;
  dispose(): void;
}

/** window.omnipath.debug.audio: call it for the state; its members drive the engine from the console / Playwright. */
export interface AudioDebug {
  (): ReturnType<AudioEngine['state']>;
  state(): ReturnType<AudioEngine['state']>;
  /** Plays a bank sound (after the first tap; before it the result says 'locked'). */
  play(name: string, opts?: PlayOptions): PlayResult;
  /** Sound names, optionally filtered by a prefix ('hit_', 'cast_', 'step_', 'amb_'…). */
  list(prefix?: string): string[];
  /** The current settings (a copy). */
  readonly settings: AudioSettings;
  set(patch: Partial<AudioSettings>): AudioSettings;
  /** Mutes / unmutes (toggles without an argument); returns the muted state. */
  mute(on?: boolean): boolean;
  /** RMS of the speaker feed right now (after the compressor and the soft clipper; debug meter). */
  level(): number;
  /** Stops every playing one-shot. */
  stop(): void;
  /** Names of the last sounds started (oldest first). */
  recent(): string[];
  /** The speaker feed now: RMS, peak (linear) and the compressor's gain reduction (dB). */
  meter(): { rms: number; peak: number; reduction: number };
  /**
   * A private event bus bridged like the current map (no footsteps / emitters): emitting on it plays exactly what the
   * game's events would, and nothing else in the game hears it. Null before a map is attached.
   */
  sandbox(): AudioSandbox | null;
}

let hooks: AudioDebug | null = null;

export function audioDebug(): AudioDebug {
  if (hooks) return hooks;
  const e = audioEngine();
  const fn = Object.assign(() => e.state(), {
    state: () => e.state(),
    play: (name: string, opts?: PlayOptions) => e.play(name, opts),
    list: (prefix = '') => soundNames().filter((n) => n.startsWith(prefix)),
    set: (patch: Partial<AudioSettings>) => e.settings.set(patch),
    mute: (on?: boolean) => e.settings.set({ muted: on ?? !e.settings.get().muted }).muted,
    level: () => e.level(),
    stop: () => e.stopAll(),
    recent: () => e.recent(),
    meter: () => e.meter(),
    sandbox: (): AudioSandbox | null => {
      const scene = currentScene;
      if (!scene) return null;
      const bus = new EventBus<GameEvents>();
      // The scene's per-frame hook (footsteps, emitters) stays with the real bridge.
      const quiet: AudioScene = Object.create(scene, { events: { value: { on: () => undefined, off: () => undefined } } });
      const off = createAudioBridge(quiet, e, bus);
      return { emit: (type, payload) => bus.emit(type, payload), dispose: off };
    },
  });
  Object.defineProperty(fn, 'settings', { get: () => e.settings.get(), enumerable: true });
  hooks = fn as AudioDebug;
  return hooks;
}

/**
 * Starts the audio system once (main.ts): installs the gesture unlock (touchend / click / keydown) and the
 * hidden / idle suspension, and publishes the debug hooks on `host.debug.audio` — including after main.ts assigns
 * a new `host.debug` object (an accessor keeps re-attaching them).
 */
export function initAudio(host?: { debug?: object; game?: Phaser.Game }): AudioDebug {
  audioEngine().install();
  retirePhaserSound(host?.game);
  const h = audioDebug();
  if (host) {
    let current = host.debug;
    const attach = (d: unknown) => {
      if (d && typeof d === 'object') (d as Record<string, unknown>).audio = h;
    };
    attach(current);
    Object.defineProperty(host, 'debug', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (v: object | undefined) => {
        current = v;
        attach(v);
      },
    });
  }
  return h;
}

/** Every sound name in the bank (sorted). */
export const SOUND_NAMES: readonly string[] = soundNames();
export { SOUNDS };
