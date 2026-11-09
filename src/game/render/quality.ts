// Quality tiers and battery saver (quality lane; docs/QUALITY-PLAN.md Phase D item 15).
//
// One place decides how much the game draws. The ☰ menu shows two rows (src/ui/hud/settings.ts):
//   Quality        Low / Medium / High — picked automatically from the device until the player taps one
//                  (Canvas renderer or a low-memory device → Low, else High);
//   Battery saver  On / Off — caps the game loop at 30 fps and lowers the quality one step.
// What a tier switches (TIER_SPECS), each through the owning module's exported setter, live:
//   lighting  render/lighting.ts setLightingEnabled  (off: the flat darkness overlay on dark maps)
//   grade     render/grade.ts    setGradeEnabled     (OmniGrade on the world camera)
//   ambient   render/ambient.ts  setAmbientQuality   (weather / air particle density, clouds, water, smoke)
//   VFX       the map's VFX runtime: a governor ceiling (`setMaxQuality` when the runtime has it) or, until then, a
//             pinned quality below High (`setQuality`); re-applied on every map entry (each map has its own runtime).
// The setters are looked up by name on the module namespaces, so this file compiles and runs whatever those
// modules export at the moment (a missing setter is skipped). A URL flag that pins one of them for QA (?light=0,
// ?grade=0, ?ambient=low) wins over the tier. Other systems read the tier with the getters below (qualityTier(),
// vfxMaxQuality(), …) and onQualityChange().
//
// Also here: persistStorageOnce() — navigator.storage.persist(), asked once after the first save (main.ts).
//
// QA: ?quality=low|medium|high and ?battery=1 (this session only, not saved); window.omnipath.quality — state(),
// set(tier | null), battery(on).
import type Phaser from 'phaser';
import { gameBus } from '../events';
import * as ambientModule from './ambient';
import * as gradeModule from './grade';
import * as lightingModule from './lighting';

export type QualityTier = 'low' | 'medium' | 'high';
export const QUALITY_TIERS: readonly QualityTier[] = ['low', 'medium', 'high'];

/** The VFX runtime's quality steps (src/game/vfx/types.ts VfxQuality). */
export type VfxCap = 1 | 0.5 | 0.25;
export type AmbientLevel = 'low' | 'med' | 'high';

export interface TierSpec {
  /** Highest VFX quality the governor may use (1 = everything, 0.5 / 0.25 = fewer motes, chunks, trails, glow). */
  vfxMax: VfxCap;
  /** Pixel-banded light map on dark and night maps. */
  lighting: boolean;
  /** OmniGrade colour grade. */
  grade: boolean;
  /** Ambient particle density and extras (render/ambient.ts tiers). */
  ambient: AmbientLevel;
}

export const TIER_SPECS: Readonly<Record<QualityTier, TierSpec>> = {
  high: { vfxMax: 1, lighting: true, grade: true, ambient: 'high' },
  medium: { vfxMax: 0.5, lighting: true, grade: true, ambient: 'med' },
  low: { vfxMax: 0.25, lighting: false, grade: false, ambient: 'low' },
};

/** Battery saver frame cap. */
export const BATTERY_FPS = 30;
/**
 * Phaser's limiter runs a frame once the summed delta reaches its rate; a hair under 1000 / 30 keeps a steady 30 fps
 * on 60, 90 and 120 Hz screens (two 16.6 ms frames always pass, one never does).
 */
export const LIMIT_SLACK_MS = 1000 / 240;

export interface DeviceInfo {
  /** The WebGL renderer runs (false: Canvas). */
  webgl: boolean;
  /** navigator.deviceMemory (GB; missing on Safari). */
  memoryGB?: number;
  /** navigator.hardwareConcurrency. */
  cores?: number;
}

/** The automatic tier: Canvas, ≤ 2 GB or ≤ 2 cores → Low; everything else (the iPad included) → High. */
export function autoTier(d: DeviceInfo): QualityTier {
  if (!d.webgl) return 'low';
  if (typeof d.memoryGB === 'number' && d.memoryGB > 0 && d.memoryGB <= 2) return 'low';
  if (typeof d.cores === 'number' && d.cores > 0 && d.cores <= 2) return 'low';
  return 'high';
}

/** One step down (battery saver). */
export function lowerTier(t: QualityTier): QualityTier {
  return t === 'high' ? 'medium' : 'low';
}

export const isTier = (v: unknown): v is QualityTier => v === 'low' || v === 'medium' || v === 'high';

// ------------------------------------------------------------------ state

const TIER_KEY = 'omnipath.quality';
const BATTERY_KEY = 'omnipath.batterySaver';

function stored(key: string): string | null {
  try {
    return typeof localStorage !== 'undefined' ? localStorage.getItem(key) : null;
  } catch {
    return null;
  }
}

function store(key: string, v: string | null): void {
  try {
    if (v === null) localStorage.removeItem(key);
    else localStorage.setItem(key, v);
  } catch {
    /* storage blocked: the choice lasts this session */
  }
}

function urlParam(name: string): string | null {
  try {
    return typeof location === 'undefined' ? null : new URLSearchParams(location.search).get(name);
  } catch {
    return null;
  }
}

/** A URL flag that pins this feature for QA (?light / ?grade / ?ambient) wins over the tier. */
const urlPins = (): { lighting: boolean; grade: boolean; ambient: boolean } => ({
  lighting: urlParam('light') !== null,
  grade: urlParam('grade') !== null,
  ambient: urlParam('ambient') !== null,
});

const state = {
  /** The player's pick (null = automatic). */
  chosen: ((): QualityTier | null => {
    const u = urlParam('quality');
    if (isTier(u)) return u;
    const s = stored(TIER_KEY);
    return isTier(s) ? s : null;
  })(),
  battery: ((): boolean => {
    const u = urlParam('battery');
    if (u !== null) return !(u === '0' || u === 'off' || u === 'false');
    return stored(BATTERY_KEY) === '1';
  })(),
  device: { webgl: true } as DeviceInfo,
};

export interface QualityState {
  /** The tier in effect (after the battery saver). */
  tier: QualityTier;
  /** The player's pick (null = automatic). */
  chosen: QualityTier | null;
  /** The device's automatic tier. */
  auto: QualityTier;
  /** The tier the menu shows selected (the pick, else the automatic one). */
  shown: QualityTier;
  battery: boolean;
  /** Frame cap (0 = none). */
  fps: number;
  spec: TierSpec;
  webgl: boolean;
}

export function qualityState(): QualityState {
  const auto = autoTier(state.device);
  const shown = state.chosen ?? auto;
  const tier = state.battery ? lowerTier(shown) : shown;
  return { tier, chosen: state.chosen, auto, shown, battery: state.battery, fps: state.battery ? BATTERY_FPS : 0, spec: TIER_SPECS[tier], webgl: state.device.webgl };
}

/** The tier in effect. */
export const qualityTier = (): QualityTier => qualityState().tier;
/** The tier the ☰ menu shows selected. */
export const shownTier = (): QualityTier => qualityState().shown;
/** Highest VFX quality allowed now (the VFX governor's ceiling). */
export const vfxMaxQuality = (): VfxCap => qualityState().spec.vfxMax;
export const lightingAllowed = (): boolean => qualityState().spec.lighting;
export const gradeAllowed = (): boolean => qualityState().spec.grade;
export const ambientLevel = (): AmbientLevel => qualityState().spec.ambient;
export const batterySaver = (): boolean => state.battery;
/** The frame cap in effect (0 = none). */
export const fpsCap = (): number => (state.battery ? BATTERY_FPS : 0);

const listeners = new Set<(s: QualityState) => void>();

/** Called after every change (tier, battery saver, device); returns the unsubscribe. */
export function onQualityChange(fn: (s: QualityState) => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function changed(): void {
  applyAll();
  const s = qualityState();
  for (const fn of [...listeners]) {
    try {
      fn(s);
    } catch {
      /* a listener's failure never blocks the setting */
    }
  }
}

/** The player's pick (null: automatic again). Saved on this device. */
export function setQualityTier(t: QualityTier | null): void {
  if (t !== null && !isTier(t)) return;
  if (state.chosen === t) return;
  state.chosen = t;
  store(TIER_KEY, t);
  changed();
}

/** Battery saver on / off (30 fps, one quality step lower). Saved on this device. */
export function setBatterySaver(on: boolean): void {
  if (state.battery === on) return;
  state.battery = on;
  store(BATTERY_KEY, on ? '1' : '0');
  changed();
}

/** What the device can do (installQuality reads it from the game; tests call it directly). */
export function setDevice(d: DeviceInfo): void {
  state.device = { ...d };
  changed();
}

// ------------------------------------------------------------------ applying a tier

type Setter<T> = (v: T) => void;

/** An exported function of a module namespace, or null while that module does not have it. */
function exported<T>(mod: object, name: string): Setter<T> | null {
  const fn = (mod as Record<string, unknown>)[name];
  return typeof fn === 'function' ? (fn as Setter<T>) : null;
}

/** What applyAll last did (QA). */
export const applied = { lighting: null as boolean | null, grade: null as boolean | null, ambient: null as AmbientLevel | null, vfx: null as VfxCap | 'free' | null, fps: 0 };

/** The VFX handle of a map scene (src/game/vfx/runtime/index.ts VfxHandle; read structurally). */
interface VfxQualityHandle {
  setQuality?: (q: VfxCap | null) => void;
  setMaxQuality?: (q: VfxCap) => void;
}

/** The running game (installQuality). */
let game: Phaser.Game | null = null;

function mapVfx(): VfxQualityHandle | null {
  if (!game) return null;
  try {
    const sc = game.scene.getScenes(false).find((s) => s.sys.settings.key === 'Map') as unknown as { vfx?: VfxQualityHandle } | undefined;
    return sc?.vfx ?? null;
  } catch {
    return null;
  }
}

/**
 * The VFX tier for the running map. Below High (or under the battery saver, whose 33 ms frames the governor would
 * read as slow) the quality is pinned at the tier's ceiling; at High the governor runs free. A runtime that offers
 * setMaxQuality gets the ceiling and keeps its governor except under the battery saver. The Canvas renderer keeps
 * the runtime's own Canvas tier.
 */
export function applyVfx(vfx: VfxQualityHandle | null, fresh = false): VfxCap | 'free' | null {
  const s = qualityState();
  if (!vfx || !s.webgl) return null;
  const cap = s.spec.vfxMax;
  const pin: VfxCap | null = s.battery || cap < 1 ? cap : null;
  if (typeof vfx.setMaxQuality === 'function') {
    vfx.setMaxQuality(cap);
    if (pin !== null && s.battery) vfx.setQuality?.(pin);
    else if (!fresh) vfx.setQuality?.(null);
    return s.battery ? cap : 'free';
  }
  if (pin !== null) vfx.setQuality?.(pin);
  else if (!fresh) {
    // Released at the tier's ceiling (as a fresh map starts), not left at the old pin until the governor recovers.
    vfx.setQuality?.(cap);
    vfx.setQuality?.(null);
  }
  return pin ?? 'free';
}

/** Phaser TimeStep fields the frame cap uses (3.90: the limiter is picked when the loop starts / wakes). */
interface LoopLike {
  running: boolean;
  fpsLimit: number;
  hasFpsLimit: boolean;
  _limitRate: number;
  sleep(): void;
  wake(seamless?: boolean): void;
}

/** Sets (fps > 0) or clears the frame cap on a Phaser loop; a running loop restarts its timer with the right step. */
export function applyFpsCap(loop: LoopLike, fps: number): boolean {
  const rate = fps > 0 ? 1000 / fps - LIMIT_SLACK_MS : 0;
  if (loop.hasFpsLimit === fps > 0 && loop.fpsLimit === fps && Math.abs(loop._limitRate - rate) < 1e-6) return false;
  loop.fpsLimit = fps;
  loop.hasFpsLimit = fps > 0;
  loop._limitRate = rate;
  // A sleeping loop (a full-screen panel) picks the limiter up when it wakes.
  if (loop.running) {
    loop.sleep();
    loop.wake(true);
  }
  return true;
}

function applyAll(): void {
  const s = qualityState();
  const pins = urlPins();
  if (!pins.lighting) {
    const set = exported<boolean>(lightingModule, 'setLightingEnabled');
    if (set) {
      set(s.spec.lighting);
      applied.lighting = s.spec.lighting;
    }
  }
  if (!pins.grade) {
    const set = exported<boolean>(gradeModule, 'setGradeEnabled');
    if (set) {
      set(s.spec.grade);
      applied.grade = s.spec.grade;
    }
  }
  if (!pins.ambient) {
    const set = exported<AmbientLevel>(ambientModule, 'setAmbientQuality');
    if (set) {
      set(s.spec.ambient);
      applied.ambient = s.spec.ambient;
    }
  }
  if (game) {
    applied.vfx = applyVfx(mapVfx());
    const loop = game.loop as unknown as LoopLike | undefined;
    if (loop && typeof loop.sleep === 'function') {
      applyFpsCap(loop, s.fps);
      applied.fps = s.fps;
    }
  }
}

export interface QualityDebug {
  state(): QualityState & { applied: typeof applied };
  /** Picks a tier (null = automatic). */
  set(t: QualityTier | null): QualityState;
  battery(on?: boolean): QualityState;
}

/**
 * Connects the tiers to the running game once (main.ts): reads the renderer and the device, applies the tier,
 * re-applies the VFX tier on every map entry. main.ts publishes the returned API as window.omnipath.quality.
 */
export function installQuality(g: Phaser.Game): QualityDebug {
  game = g;
  const nav = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }) : undefined;
  const readDevice = () => {
    // Phaser.WEBGL = 2 (read as a number: no runtime Phaser import here)
    const webgl = (g.renderer as { type?: number } | null)?.type === 2;
    setDevice({ webgl, memoryGB: nav?.deviceMemory, cores: nav?.hardwareConcurrency });
  };
  if (g.renderer) readDevice();
  else g.events.once('ready', readDevice);
  // Each map builds its own VFX runtime (MapScene.create → attachVfx, before mapEnter).
  gameBus.on('mapEnter', () => {
    applied.vfx = applyVfx(mapVfx(), true);
  });
  const api: QualityDebug = {
    state: () => ({ ...qualityState(), applied: { ...applied } }),
    set: (t) => {
      setQualityTier(t);
      return qualityState();
    },
    battery: (on) => {
      setBatterySaver(on ?? !state.battery);
      return qualityState();
    },
  };
  return api;
}

// ------------------------------------------------------------------ persistent storage

const PERSIST_KEY = 'omnipath.persistAsked';

export type PersistResult = 'granted' | 'denied' | 'already' | 'asked-before' | 'unsupported' | 'error';

/**
 * Asks the browser once to keep this site's storage (the save lives in localStorage), after the first save: skipped
 * when storage is already persistent, when it was asked before on this device, or when the API is missing.
 */
export async function persistStorageOnce(
  storage: Pick<StorageManager, 'persist' | 'persisted'> | undefined = typeof navigator !== 'undefined' ? navigator.storage : undefined,
  local: Pick<Storage, 'getItem' | 'setItem'> | undefined = typeof localStorage !== 'undefined' ? localStorage : undefined,
): Promise<PersistResult> {
  if (!storage || typeof storage.persist !== 'function') return 'unsupported';
  try {
    if (typeof storage.persisted === 'function' && (await storage.persisted())) return 'already';
    try {
      if (local?.getItem(PERSIST_KEY)) return 'asked-before';
      local?.setItem(PERSIST_KEY, '1');
    } catch {
      /* storage blocked: ask anyway (the browser remembers its answer) */
    }
    return (await storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'error';
  }
}
