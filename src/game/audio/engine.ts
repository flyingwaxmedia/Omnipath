// The audio engine (docs/QUALITY-PLAN.md §6): ONE AudioContext, created inside the first user gesture (iOS Safari
// unlock), with master → (sfx, ambience, music) buses, a gentle compressor on the master, voice limiting per sound
// group, seeded pitch / volume variation, stereo pan and cached ZzFX buffers (per recipe + variation).
//
// Lifecycle: nothing is created before the first touchend / click / keydown, and every call before that is a silent
// no-op (play() returns { ok: false, reason: 'locked' }). The context is suspended while the page is hidden, while
// muted (or the master volume is 0) and after IDLE_MS without input or sound; any input resumes it.
// Phaser's own sound manager is not used for anything (all sound lives here).
import { hashSeed, mulberry32 } from '../../core/rng';
import { type Bus, GROUPS, SOUNDS, type SoundDef, buildSound, gainOf, soundDuration } from './bank';
import { type AudioSettings, SettingsStore, browserStore, busGains, isSilent } from './settings';
import { VoiceLimiter } from './voices';
import { AmbiencePlayer, type MapInfo, type ReverbPreset, makeImpulse, reverbFor } from './ambience';

/** Sample rate the SFX buffers are built at (energy stays under 6 kHz; saves memory vs 44.1 / 48 kHz). */
export const BUILD_RATE = 32000;
/** Max voices sounding at once (SFX + ambience one-shots). */
export const MAX_VOICES = 24;
/** No input and no sound for this long suspends the context (battery). */
export const IDLE_MS = 90_000;
/** Cached samples before the oldest buffers are dropped (~10 MB of float32). */
export const CACHE_SAMPLES = 2_500_000;

export interface PlayOptions {
  /** Extra linear gain (spatial attenuation, multi-hit restraint). */
  gain?: number;
  /** Stereo pan -1..1. */
  pan?: number;
  /** Playback-rate multiplier (size / pitch). */
  rate?: number;
  /** Start this many seconds from now. */
  delay?: number;
  /** Absolute AudioContext time to start at (ambience scheduling); overrides `delay`. */
  when?: number;
  /** Overrides the sound's priority. */
  priority?: number;
}

export type PlayRefusal = 'unknown' | 'locked' | 'muted' | 'suspended' | 'quiet' | 'gap' | 'group' | 'global';
export type PlayResult = { ok: true; voice: number } | { ok: false; reason: PlayRefusal };

type SuspendReason = 'hidden' | 'muted' | 'idle';

interface LiveVoice {
  src: AudioBufferSourceNode;
  gain: GainNode;
  pan: StereoPannerNode | null;
  bus: Bus;
}

interface Graph {
  master: GainNode;
  sfx: GainNode;
  ambience: GainNode;
  /** Ducks the ambience under fanfares. */
  duck: GainNode;
  music: GainNode;
  reverbSend: GainNode;
  convolver: ConvolverNode;
  reverbOut: GainNode;
  meter: AnalyserNode | null;
}

const nowMs = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export class AudioEngine {
  ctx: AudioContext | null = null;
  readonly settings: SettingsStore;
  readonly ambience: AmbiencePlayer;
  private g: Graph | null = null;
  private readonly limiter = new VoiceLimiter(MAX_VOICES);
  private readonly cache = new Map<string, AudioBuffer>();
  private cachedSamples = 0;
  private readonly live = new Map<number, LiveVoice>();
  private readonly rng = mulberry32(hashSeed('omnipath-audio-play'));
  private readonly reasons = new Set<SuspendReason>();
  private lastActive = nowMs();
  private installed = false;
  private unlocked = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private reverb: ReverbPreset | null = null;
  private readonly impulses = new Map<string, AudioBuffer>();
  private readonly offs: (() => void)[] = [];
  readonly stats = { played: 0, dropped: 0, built: 0, errors: 0 };

  constructor(store = browserStore()) {
    this.settings = new SettingsStore(store);
    this.ambience = new AmbiencePlayer({
      ctx: () => this.ctx,
      out: () => this.g?.ambience ?? null,
      send: () => this.g?.reverbSend ?? null,
      play: (name, opts) => this.play(name, opts),
      enabled: () => this.settings.get().ambience > 0,
    });
    if (isSilent(this.settings.get())) this.reasons.add('muted');
    this.settings.onChange((s) => this.onSettings(s));
  }

  // ---------------------------------------------------------------- lifecycle

  /** Installs the gesture unlock and the page-visibility / idle handlers (once per page). */
  install(): void {
    if (this.installed || typeof window === 'undefined') return;
    this.installed = true;
    const opts: AddEventListenerOptions = { capture: true, passive: true };
    const listen = (target: EventTarget, type: string, fn: () => void) => {
      target.addEventListener(type, fn, opts);
      this.offs.push(() => target.removeEventListener(type, fn, opts));
    };
    const gesture = () => this.gesture();
    // iOS Safari only unlocks audio inside touchend / click / keydown handlers (not touchstart / pointerdown).
    for (const type of ['touchend', 'click', 'keydown', 'pointerup']) listen(window, type, gesture);
    const activity = () => this.activity();
    for (const type of ['pointerdown', 'touchstart', 'wheel']) listen(window, type, activity);
    if (typeof document !== 'undefined') {
      const vis = () => this.setReason('hidden', document.hidden);
      listen(document, 'visibilitychange', vis);
      listen(window, 'pagehide', () => this.setReason('hidden', true));
      listen(window, 'pageshow', () => this.setReason('hidden', !!document.hidden));
      if (document.hidden) this.reasons.add('hidden');
    }
  }

  /** Removes every page listener and closes the context (tests / teardown; the game never calls it). */
  dispose(): void {
    for (const off of this.offs.splice(0)) off();
    this.installed = false;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.stopAll();
    this.ambience.stop(0);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.g = null;
    this.unlocked = false;
  }

  /** A user gesture: create / resume the context inside it (the only place iOS allows the first start). */
  gesture(): void {
    this.activity();
    if (!this.ctx && !this.create()) return;
    const ctx = this.ctx!;
    if (this.reasons.size === 0 && ctx.state !== 'running') void ctx.resume().catch(() => undefined);
    if (!this.unlocked) {
      // Old iOS also wants a buffer started inside the gesture.
      try {
        const b = ctx.createBuffer(1, 1, ctx.sampleRate);
        const s = ctx.createBufferSource();
        s.buffer = b;
        s.connect(ctx.destination);
        s.start(0);
        s.onended = () => s.disconnect();
      } catch {
        // ignore
      }
    }
  }

  /** Input happened: wake from idle. */
  activity(): void {
    this.lastActive = nowMs();
    if (this.reasons.has('idle')) this.setReason('idle', false);
  }

  private create(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
    const AC = w.AudioContext ?? w.webkitAudioContext;
    if (!AC) return false;
    let ctx: AudioContext;
    try {
      ctx = new AC({ latencyHint: 'interactive' });
    } catch {
      try {
        ctx = new AC();
      } catch {
        return false;
      }
    }
    try {
      // Mix with the player's own music and respect the ring / silent switch (Safari 16.4+).
      const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
      if (session) session.type = 'ambient';
    } catch {
      // ignore
    }
    this.ctx = ctx;
    this.g = this.buildGraph(ctx);
    this.applyGains(true);
    ctx.addEventListener('statechange', () => this.onState());
    this.timer = setInterval(() => this.tick(), 250);
    this.ambience.attach();
    if (this.reverb) this.connectReverb(this.reverb, true);
    return true;
  }

  private buildGraph(ctx: AudioContext): Graph {
    const gain = (v = 1) => {
      const n = ctx.createGain();
      n.gain.value = v;
      return n;
    };
    const master = gain();
    const sfx = gain();
    const ambience = gain();
    const duck = gain();
    const music = gain();
    // Mobile speakers first: nothing below ~110 Hz reaches them, it only eats headroom.
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 110;
    hp.Q.value = 0.6;
    // Takes the edge off the naive ZzFX waveforms (aliasing above ~8 kHz).
    const tone = ctx.createBiquadFilter();
    tone.type = 'lowpass';
    tone.frequency.value = 8000;
    tone.Q.value = 0.5;
    // A gentle limiter: catches stacked hits without pumping.
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 10;
    comp.ratio.value = 3.5;
    comp.attack.value = 0.004;
    comp.release.value = 0.2;
    sfx.connect(tone).connect(master);
    ambience.connect(duck).connect(master);
    music.connect(master);
    master.connect(hp).connect(comp).connect(ctx.destination);
    const reverbSend = gain(0);
    const convolver = ctx.createConvolver();
    const reverbOut = gain(1);
    convolver.connect(reverbOut).connect(master);
    return { master, sfx, ambience, duck, music, reverbSend, convolver, reverbOut, meter: null };
  }

  private onState(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    if (ctx.state === 'running') this.unlocked = true;
    // A suspension asked for while the context was still starting: re-assert it.
    if (ctx.state === 'running' && this.reasons.size > 0) this.applyRunState();
  }

  private setReason(r: SuspendReason, on: boolean): void {
    const had = this.reasons.has(r);
    if (on === had) return;
    if (on) this.reasons.add(r);
    else this.reasons.delete(r);
    if (!on && r === 'idle') this.lastActive = nowMs();
    this.applyRunState();
  }

  private applyRunState(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state === 'closed') return;
    if (this.reasons.size === 0) {
      if (ctx.state !== 'running') {
        // iOS 17+: a context coming back from the background sometimes needs a suspend → resume nudge.
        const resume = () => void ctx.resume().catch(() => undefined);
        if (ctx.state === 'suspended' && this.unlocked) setTimeout(resume, 60);
        else resume();
      }
    } else if (ctx.state === 'running') {
      this.stopAll();
      void ctx.suspend().catch(() => undefined);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (nowMs() - this.lastActive > IDLE_MS) {
      this.setReason('idle', true);
      return;
    }
    this.ambience.tick();
  }

  // ---------------------------------------------------------------- settings

  private onSettings(s: Readonly<AudioSettings>): void {
    this.applyGains(false);
    this.setReason('muted', isSilent(s));
    this.ambience.refresh();
  }

  private applyGains(instant: boolean): void {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return;
    const b = busGains(this.settings.get());
    const set = (p: AudioParam, v: number) => {
      if (instant) p.value = v;
      else p.setTargetAtTime(v, ctx.currentTime, 0.03);
    };
    set(g.master.gain, b.master);
    set(g.sfx.gain, b.sfx);
    set(g.ambience.gain, b.ambience);
    set(g.music.gain, b.music);
  }

  // ---------------------------------------------------------------- playing

  /** Plays a bank sound. Never throws; before the first gesture it does nothing. */
  play(name: string, opts: PlayOptions = {}): PlayResult {
    const def = SOUNDS[name];
    if (!def) return { ok: false, reason: 'unknown' };
    const bus: Bus = def.bus ?? 'sfx';
    if (bus === 'sfx') this.lastActive = Math.max(this.lastActive, nowMs());
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g) return this.refuse('locked');
    if (this.reasons.has('muted')) return this.refuse('muted');
    if (this.reasons.has('idle') && bus === 'sfx') this.setReason('idle', false);
    if (this.reasons.size > 0 || ctx.state === 'closed') return this.refuse('suspended');
    const level = gainOf(def) * (opts.gain ?? 1);
    if (!(level > 0.002)) return this.refuse('quiet');
    const rate = Math.max(0.25, Math.min(4, (opts.rate ?? 1) * (1 + (this.rng() * 2 - 1) * (def.pitchVar ?? 0.04))));
    const dur = soundDuration(def, BUILD_RATE) / rate;
    const delay = opts.when !== undefined ? Math.max(0, opts.when - ctx.currentTime) : Math.max(0, opts.delay ?? 0);
    const policy = GROUPS[def.group];
    const adm = this.limiter.admit(def.group, policy, nowMs() + delay * 1000, dur * 1000, opts.priority ?? def.priority ?? policy.priority);
    if (!adm) return this.refuse(this.limiter.lastRefusal ?? 'group');
    for (const v of adm.evict) this.stopVoice(v.id, 0.02);
    try {
      const variation = Math.floor(this.rng() * Math.max(1, def.variations ?? 2));
      const buffer = this.buffer(name, def, variation);
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.playbackRate.value = rate;
      const gn = ctx.createGain();
      gn.gain.value = level * (1 + (this.rng() * 2 - 1) * (def.volVar ?? 0.1));
      let pan: StereoPannerNode | null = null;
      const p = Math.max(-1, Math.min(1, opts.pan ?? 0));
      if (Math.abs(p) > 0.01 && typeof ctx.createStereoPanner === 'function') {
        pan = ctx.createStereoPanner();
        pan.pan.value = p;
      }
      src.connect(gn);
      (pan ? gn.connect(pan) : gn).connect(bus === 'ambience' ? g.ambience : g.sfx);
      const id = adm.id;
      src.onended = () => this.cleanup(id);
      this.live.set(id, { src, gain: gn, pan, bus });
      src.start(ctx.currentTime + delay);
      if ((def.priority ?? policy.priority) >= 9) this.duck(ctx.currentTime + delay, dur);
      this.stats.played++;
      return { ok: true, voice: id };
    } catch (error) {
      this.limiter.release(adm.id);
      this.stats.errors++;
      if (this.stats.errors <= 3) console.warn('[omnipath] audio play failed:', name, error);
      return this.refuse('suspended');
    }
  }

  private refuse(reason: PlayRefusal): PlayResult {
    this.stats.dropped++;
    return { ok: false, reason };
  }

  /** The cached AudioBuffer of one variation (built on first use, LRU-bounded). */
  private buffer(name: string, def: SoundDef, variation: number): AudioBuffer {
    const key = `${name}#${variation}`;
    const hit = this.cache.get(key);
    if (hit) {
      this.cache.delete(key);
      this.cache.set(key, hit);
      return hit;
    }
    const samples = buildSound(name, def, BUILD_RATE, variation);
    const buf = this.ctx!.createBuffer(1, Math.max(1, samples.length), BUILD_RATE);
    buf.getChannelData(0).set(samples);
    this.cache.set(key, buf);
    this.cachedSamples += buf.length;
    this.stats.built++;
    for (const [k, b] of this.cache) {
      if (this.cachedSamples <= CACHE_SAMPLES || k === key) break;
      this.cache.delete(k);
      this.cachedSamples -= b.length;
    }
    return buf;
  }

  private duck(at: number, dur: number): void {
    const p = this.g?.duck.gain;
    if (!p) return;
    p.cancelScheduledValues(at);
    p.setTargetAtTime(0.55, at, 0.05);
    p.setTargetAtTime(1, at + Math.min(2, dur), 0.4);
  }

  private stopVoice(id: number, fade: number): void {
    const v = this.live.get(id);
    const ctx = this.ctx;
    if (!v || !ctx) return;
    try {
      const t = ctx.currentTime;
      v.gain.gain.cancelScheduledValues(t);
      v.gain.gain.setValueAtTime(v.gain.gain.value, t);
      v.gain.gain.linearRampToValueAtTime(0, t + fade);
      v.src.stop(t + fade + 0.005);
    } catch {
      this.cleanup(id);
    }
  }

  private cleanup(id: number): void {
    const v = this.live.get(id);
    this.limiter.release(id);
    if (!v) return;
    this.live.delete(id);
    try {
      v.src.disconnect();
      v.gain.disconnect();
      v.pan?.disconnect();
    } catch {
      // already gone
    }
  }

  /** Stops every one-shot (suspending, muting). Ambience beds keep their state. */
  stopAll(): void {
    for (const id of [...this.live.keys()]) {
      const v = this.live.get(id)!;
      try {
        v.src.stop();
      } catch {
        // not started / already stopped
      }
      this.cleanup(id);
    }
    this.limiter.reset();
  }

  // ---------------------------------------------------------------- maps: ambience bed + room echo

  /** A map was entered: cross-fade its ambience bed and set its room echo. */
  setMap(info: MapInfo): void {
    this.ambience.setMap(info);
    const preset = reverbFor(info);
    if (preset?.id !== this.reverb?.id) {
      this.reverb = preset;
      this.connectReverb(preset, false);
    }
  }

  private connectReverb(preset: ReverbPreset | null, instant: boolean): void {
    const ctx = this.ctx;
    const g = this.g;
    if (!ctx || !g) return;
    const t = ctx.currentTime;
    const send = g.reverbSend.gain;
    send.cancelScheduledValues(t);
    if (!preset) {
      send.setTargetAtTime(0, t, instant ? 0.001 : 0.3);
      // Disconnect once faded: a convolver fed silence still costs CPU.
      setTimeout(() => {
        if (this.reverb) return;
        try {
          g.sfx.disconnect(g.reverbSend);
          g.reverbSend.disconnect();
        } catch {
          // not connected
        }
      }, 1500);
      return;
    }
    let ir = this.impulses.get(preset.id);
    if (!ir) {
      const [l, r] = makeImpulse(preset, ctx.sampleRate, hashSeed('omnipath-room', preset.id));
      ir = ctx.createBuffer(2, l.length, ctx.sampleRate);
      ir.getChannelData(0).set(l);
      ir.getChannelData(1).set(r);
      this.impulses.set(preset.id, ir);
    }
    if (g.convolver.buffer !== ir) g.convolver.buffer = ir;
    try {
      g.sfx.disconnect(g.reverbSend);
    } catch {
      // not connected yet
    }
    g.sfx.connect(g.reverbSend);
    g.reverbSend.disconnect();
    g.reverbSend.connect(g.convolver);
    send.setTargetAtTime(preset.wet, t, instant ? 0.001 : 0.4);
  }

  // ---------------------------------------------------------------- debug / state

  /** RMS of the master output over the last ~20 ms (creates a meter on first use; debug only). */
  level(): number {
    const g = this.g;
    const ctx = this.ctx;
    if (!g || !ctx) return 0;
    if (!g.meter) {
      g.meter = ctx.createAnalyser();
      g.meter.fftSize = 1024;
      g.master.connect(g.meter);
    }
    const data = new Float32Array(g.meter.fftSize);
    g.meter.getFloatTimeDomainData(data);
    let sum = 0;
    for (const v of data) sum += v * v;
    return Math.sqrt(sum / data.length);
  }

  state(): {
    context: string;
    unlocked: boolean;
    suspendedFor: SuspendReason[];
    voices: number;
    live: number;
    cached: number;
    cachedSamples: number;
    reverb: string | null;
    bed: string | null;
    sampleRate: number;
    stats: { played: number; dropped: number; built: number; errors: number };
    settingsListeners: number;
  } {
    return {
      context: this.ctx?.state ?? 'none',
      unlocked: this.unlocked,
      suspendedFor: [...this.reasons],
      voices: this.limiter.active(nowMs()),
      live: this.live.size,
      cached: this.cache.size,
      cachedSamples: this.cachedSamples,
      reverb: this.reverb?.id ?? null,
      bed: this.ambience.current(),
      sampleRate: this.ctx?.sampleRate ?? 0,
      stats: { ...this.stats },
      settingsListeners: this.settings.listenerCount(),
    };
  }
}
