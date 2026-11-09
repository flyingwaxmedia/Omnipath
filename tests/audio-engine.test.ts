import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SkillDef } from '../src/core/types';
import { GROUPS, SOUNDS, perceivedLoudness } from '../src/game/audio/bank';
import { type AudioScene, createAudioBridge } from '../src/game/audio/bridge';
import { BUILD_RATE, IDLE_MS, MAKEUP, MAX_VOICES, UNLOCK_EVENTS, AudioEngine, type PlayOptions, type PlayResult, panCompensation, softClipCurve } from '../src/game/audio/engine';
import { AUDIO_DEFAULTS, busGains, type KeyStore } from '../src/game/audio/settings';
import { EventBus, type GameEvents } from '../src/game/events';

// ------------------------------------------------------------------ a tiny fake Web Audio (node has none)

/** Records every automation call (method, value, time) so tests can check the schedules. */
class FakeParam {
  readonly calls: [string, number, number][] = [];
  constructor(public value = 0) {}
  setValueAtTime(v: number, t = 0) {
    this.calls.push(['set', v, t]);
    this.value = v;
    return this;
  }
  linearRampToValueAtTime(v: number, t = 0) {
    this.calls.push(['linear', v, t]);
    this.value = v;
    return this;
  }
  exponentialRampToValueAtTime(v: number, t = 0) {
    this.calls.push(['exp', v, t]);
    this.value = v;
    return this;
  }
  setTargetAtTime(v: number, t = 0) {
    this.calls.push(['target', v, t]);
    this.value = v;
    return this;
  }
  cancelScheduledValues(t = 0) {
    this.calls.push(['cancel', 0, t]);
    return this;
  }
}

/** Every fake node ever created, and how many are wired into the graph now (leak checks). */
const NODES = new Set<FakeNode>();
const wired = () => [...NODES].filter((n) => n.out.size > 0).length;

class FakeNode {
  readonly out = new Set<FakeNode>();
  constructor() {
    NODES.add(this);
  }
  connect<T extends FakeNode>(n: T): T {
    this.out.add(n);
    return n;
  }
  disconnect(n?: FakeNode) {
    if (n) {
      if (!this.out.has(n)) throw new Error('InvalidAccessError: not connected');
      this.out.delete(n);
    } else this.out.clear();
  }
}

class FakeBuffer {
  private readonly data: Float32Array[];
  constructor(
    public numberOfChannels: number,
    public length: number,
    public sampleRate: number,
  ) {
    this.data = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  getChannelData(i: number) {
    return this.data[i];
  }
  get duration() {
    return this.length / this.sampleRate;
  }
}

class FakeSource extends FakeNode {
  buffer: FakeBuffer | null = null;
  loop = false;
  playbackRate = new FakeParam(1);
  onended: (() => void) | null = null;
  startedAt = -1;
  stoppedAt = -1;
  /** The voice gain when it started (the engine fades it to 0 when it steals the voice). */
  gainAtStart = 1;
  /** The voice's stereo pan when it started (null: no panner). */
  panAtStart: number | null = null;
  ended = false;
  constructor(private readonly ctx: FakeCtx) {
    super();
  }
  start(t = 0) {
    this.startedAt = t;
    const g = [...this.out][0] as unknown as (FakeNode & { gain?: FakeParam }) | undefined;
    this.gainAtStart = g?.gain?.value ?? 1;
    const pn = g ? ([...g.out][0] as unknown as { pan?: FakeParam } | undefined) : undefined;
    this.panAtStart = pn?.pan?.value ?? null;
    this.ctx.started.push(this);
  }
  stop(t = 0) {
    this.stoppedAt = t;
  }
}

class FakeCtx {
  static last: FakeCtx | null = null;
  /** Constructor options seen (webkit fallback checks). */
  static options: unknown[] = [];
  state: 'suspended' | 'running' | 'closed' | 'interrupted' = 'suspended';
  private manualTime: number | null = null;
  /** Follows the (fake) clock unless a test sets it. */
  get currentTime(): number {
    return this.manualTime ?? performance.now() / 1000;
  }
  set currentTime(v: number) {
    this.manualTime = v;
  }
  sampleRate = 48000;
  destination = new FakeNode();
  started: FakeSource[] = [];
  gains: (FakeNode & { gain: FakeParam })[] = [];
  convolvers: (FakeNode & { buffer: FakeBuffer | null })[] = [];
  resumes = 0;
  suspends = 0;
  private fns: Record<string, (() => void)[]> = {};
  constructor(opts?: unknown) {
    FakeCtx.last = this;
    FakeCtx.options.push(opts);
  }
  addEventListener(type: string, fn: () => void) {
    (this.fns[type] ??= []).push(fn);
  }
  set(state: FakeCtx['state']) {
    this.state = state;
    for (const fn of this.fns.statechange ?? []) fn();
  }
  resume() {
    this.resumes++;
    if (this.state !== 'closed') this.set('running');
    return Promise.resolve();
  }
  suspend() {
    this.suspends++;
    if (this.state !== 'closed') this.set('suspended');
    return Promise.resolve();
  }
  close() {
    this.set('closed');
    return Promise.resolve();
  }
  createGain() {
    const n = Object.assign(new FakeNode(), { gain: new FakeParam(1) });
    this.gains.push(n);
    return n;
  }
  filters: (FakeNode & { type: string; frequency: FakeParam; Q: FakeParam })[] = [];
  createBiquadFilter() {
    const n = Object.assign(new FakeNode(), { type: 'lowpass', frequency: new FakeParam(350), Q: new FakeParam(1) });
    this.filters.push(n);
    return n;
  }
  createDynamicsCompressor() {
    return Object.assign(new FakeNode(), { threshold: new FakeParam(), knee: new FakeParam(), ratio: new FakeParam(), attack: new FakeParam(), release: new FakeParam() });
  }
  createConvolver() {
    const n = Object.assign(new FakeNode(), { buffer: null as FakeBuffer | null });
    this.convolvers.push(n);
    return n;
  }
  createStereoPanner() {
    return Object.assign(new FakeNode(), { pan: new FakeParam(0) });
  }
  createAnalyser() {
    return Object.assign(new FakeNode(), { fftSize: 1024, getFloatTimeDomainData: (a: Float32Array) => a.fill(0.1) });
  }
  createWaveShaper() {
    return Object.assign(new FakeNode(), { curve: null as Float32Array | null, oversample: 'none' });
  }
  createBuffer(ch: number, len: number, rate: number) {
    return new FakeBuffer(ch, len, rate);
  }
  createBufferSource() {
    return new FakeSource(this);
  }
}

class FakeTarget {
  private fns: Record<string, Set<(ev?: unknown) => void>> = {};
  hidden = false;
  addEventListener(type: string, fn: (ev?: unknown) => void) {
    (this.fns[type] ??= new Set()).add(fn);
  }
  removeEventListener(type: string, fn: (ev?: unknown) => void) {
    this.fns[type]?.delete(fn);
  }
  dispatch(type: string, ev?: { isTrusted: boolean }) {
    for (const fn of [...(this.fns[type] ?? [])]) fn(ev);
  }
  count() {
    return Object.values(this.fns).reduce((a, s) => a + s.size, 0);
  }
}

const memStore = (): KeyStore => {
  const m = new Map<string, string>();
  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v) };
};

const g = globalThis as unknown as Record<string, unknown>;
let win: FakeTarget & { AudioContext?: unknown };
let doc: FakeTarget;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
  win = Object.assign(new FakeTarget(), { AudioContext: FakeCtx });
  doc = new FakeTarget();
  g.window = win;
  g.document = doc;
  FakeCtx.last = null;
  FakeCtx.options = [];
  NODES.clear();
});

afterEach(() => {
  vi.useRealTimers();
  delete g.window;
  delete g.document;
});

const ctx = () => FakeCtx.last!;

describe('audio engine', () => {
  it('does nothing (and never throws) before the first gesture', () => {
    const e = new AudioEngine(memStore());
    e.install();
    expect(e.play('hit_fire')).toEqual({ ok: false, reason: 'locked' });
    e.setMap({ id: 'vale.quarry_depths.1', biome: 'cave', kind: 'dungeon', flags: ['dark', 'indoor'] });
    expect(FakeCtx.last).toBeNull();
    expect(e.state()).toMatchObject({ context: 'none', unlocked: false, voices: 0 });
    expect(e.level()).toBe(0);
    e.dispose();
  });

  it('unlocks inside a gesture, then plays cached, rate-reduced buffers through the voice limiter', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    expect(ctx().state).toBe('running');
    expect(e.state().unlocked).toBe(true);
    // the silent unlock buffer
    expect(ctx().started.length).toBe(1);
    const r = e.play('hit_fire', { pan: 0.4 });
    expect(r.ok).toBe(true);
    const src = ctx().started.at(-1)!;
    expect(src.buffer!.sampleRate).toBe(BUILD_RATE);
    expect(src.buffer!.length).toBeGreaterThan(1000);
    // a second hit in the same instant collapses (group gap)
    expect(e.play('hit_fire')).toEqual({ ok: false, reason: 'gap' });
    vi.advanceTimersByTime(100);
    expect(e.play('hit_fire').ok).toBe(true);
    expect(e.state().cached).toBeGreaterThanOrEqual(1);
    expect(e.play('nope_not_a_sound')).toEqual({ ok: false, reason: 'unknown' });
    // finished voices are released
    for (const s of ctx().started) s.onended?.();
    expect(e.state().live).toBe(0);
    e.dispose();
    expect(win.count()).toBe(0);
    expect(doc.count()).toBe(0);
  });

  it('suspends when muted, hidden or idle and resumes on unmute / visible / input', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('click');
    expect(ctx().state).toBe('running');

    e.settings.set({ muted: true });
    expect(ctx().state).toBe('suspended');
    expect(e.play('ui_tap')).toEqual({ ok: false, reason: 'muted' });
    e.settings.set({ muted: false });
    vi.advanceTimersByTime(100);
    expect(ctx().state).toBe('running');

    doc.hidden = true;
    doc.dispatch('visibilitychange');
    expect(ctx().state).toBe('suspended');
    expect(e.state().suspendedFor).toEqual(['hidden']);
    doc.hidden = false;
    doc.dispatch('visibilitychange');
    vi.advanceTimersByTime(100);
    expect(ctx().state).toBe('running');

    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(ctx().state).toBe('suspended');
    expect(e.state().suspendedFor).toEqual(['idle']);
    win.dispatch('pointerdown');
    vi.advanceTimersByTime(100);
    expect(ctx().state).toBe('running');

    // master at 0 counts as muted
    e.settings.set({ master: 0 });
    expect(ctx().state).toBe('suspended');
    e.dispose();
  });

  it('a sound request wakes an idle context, but not a hidden one', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('keydown');
    vi.advanceTimersByTime(IDLE_MS + 1000);
    expect(e.state().suspendedFor).toEqual(['idle']);
    e.play('hit_physical');
    vi.advanceTimersByTime(100);
    expect(ctx().state).toBe('running');
    doc.hidden = true;
    doc.dispatch('visibilitychange');
    expect(e.play('hit_physical')).toEqual({ ok: false, reason: 'suspended' });
    e.dispose();
  });

  it('cross-fades ambience beds and switches the room echo per map', () => {
    const e = new AudioEngine(memStore());
    e.install();
    e.setMap({ id: 'vale.quarry_depths.1', biome: 'cave', kind: 'dungeon', flags: ['dark', 'indoor'] });
    expect(e.state().bed).toBe('cave'); // wanted while locked
    win.dispatch('touchend');
    const c = ctx();
    const loops = c.started.filter((s) => s.loop);
    expect(loops.length).toBeGreaterThanOrEqual(2);
    expect(e.state()).toMatchObject({ bed: 'cave', reverb: 'cave' });
    // the impulse is built at the context's rate (a convolver requirement)
    expect(c.convolvers[0].buffer?.sampleRate).toBe(c.sampleRate);
    expect(c.convolvers[0].buffer?.numberOfChannels).toBe(2);

    // one-shots get scheduled ahead as time passes
    const before = e.stats.played;
    for (let t = 1; t <= 40; t++) {
      c.currentTime = t * 0.5;
      e.ambience.tick();
    }
    expect(e.stats.played).toBeGreaterThan(before);

    e.setMap({ id: 'vale.greenmeadow', biome: 'meadow', kind: 'field' });
    expect(e.state()).toMatchObject({ bed: 'meadow', reverb: null });
    for (const s of loops) expect(s.stoppedAt).toBeGreaterThan(0);
    // the same bed again keeps playing (no restart)
    const n = c.started.length;
    e.setMap({ id: 'vale.hearthvale.other', biome: 'meadow', kind: 'field' });
    expect(c.started.length).toBe(n);
    // ambience at 0 stops the bed
    e.settings.set({ ambience: 0 });
    expect(e.state().bed).toBeNull();
    e.dispose();
  });

  it('caps live voices and lets high priority steal from low', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    let ok = 0;
    for (let i = 0; i < 60; i++) {
      vi.advanceTimersByTime(5);
      if (e.play(i % 2 ? 'tick_burn' : 'step_grass').ok) ok++;
    }
    // 300 ms: footsteps every ≥ 70 ms, burn ticks every ≥ 240 ms, never more than 2 + 2 at once
    expect(ok).toBeLessThanOrEqual(7);
    expect(e.state().voices).toBeLessThanOrEqual(4);
    expect(e.play('level_up').ok).toBe(true);
    expect(e.play('discover_skill').ok).toBe(false); // one fanfare at a time (gap)
    e.dispose();
  });
});

// ------------------------------------------------------------------ lifecycle (iOS Safari rules, leaks)

const MAPS = {
  cave: { id: 'vale.quarry_depths.1', biome: 'cave', kind: 'dungeon', flags: ['dark', 'indoor'] },
  meadow: { id: 'vale.greenmeadow', biome: 'meadow', kind: 'field' },
  crypt: { id: 'vale.hollow_barrow.1', biome: 'crypt', kind: 'dungeon', flags: ['indoor'] },
  town: { id: 'vale.hearthvale', biome: 'town', kind: 'town' },
  lake: { id: 'vale.mirror_lake', biome: 'lake', kind: 'field' },
  storm: { id: 'rift.thunderhead_ridge', biome: 'storm', kind: 'field' },
  ember: { id: 'vale.cinder_fields', biome: 'ember', kind: 'field' },
  frost: { id: 'rift.frost_shelf', biome: 'frost', kind: 'field' },
  dusk: { id: 'rift.dusk_orchard', biome: 'dusk', kind: 'field' },
  quarry: { id: 'vale.greystone_quarry', biome: 'quarry', kind: 'field' },
} as const;

/** Lets the fake "audio thread" finish every one-shot whose time is up (fires `ended`, like a browser). */
function finishSources(c: FakeCtx, all = false): void {
  for (const s of c.started) {
    if (s.ended || s.loop || !s.buffer) continue;
    const end = s.stoppedAt >= 0 ? s.stoppedAt : s.startedAt + s.buffer.duration / (s.playbackRate.value || 1);
    if (all || c.currentTime >= end) {
      s.ended = true;
      s.onended?.();
    }
  }
}

describe('audio lifecycle', () => {
  it('unlocks only inside touchend / click / keydown (iOS Safari), never on touchstart / pointer events', () => {
    expect(UNLOCK_EVENTS).toEqual(['touchend', 'click', 'keydown']);
    const e = new AudioEngine(memStore());
    e.install();
    for (const t of ['pointerdown', 'pointerup', 'touchstart', 'wheel']) win.dispatch(t);
    expect(FakeCtx.last).toBeNull();
    // a scripted element.click() is not a gesture: no context the browser would only keep suspended
    win.dispatch('click', { isTrusted: false });
    expect(FakeCtx.last).toBeNull();
    expect(e.play('ui_tap')).toEqual({ ok: false, reason: 'locked' });
    win.dispatch('keydown');
    expect(ctx().state).toBe('running');
    expect(FakeCtx.options).toEqual([{ latencyHint: 'interactive' }]);
    e.dispose();
  });

  it('resumes synchronously inside the gesture: after an iOS interruption, and when a tap unmutes', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    const c = ctx();
    // iOS: a phone call / Siri leaves the context 'interrupted'; the next tap must resume it in its own handler.
    c.set('interrupted');
    const before = c.resumes;
    win.dispatch('touchend');
    expect(c.resumes).toBe(before + 1);
    expect(c.state).toBe('running');
    // A settings tap that unmutes resumes in the same call stack (no timer in between).
    e.settings.set({ muted: true });
    expect(c.state).toBe('suspended');
    const r0 = c.resumes;
    e.settings.set({ muted: false });
    expect(c.resumes).toBe(r0 + 1);
    expect(c.state).toBe('running');
    e.dispose();
  });

  it('falls back to webkitAudioContext (old iOS Safari) and plays without StereoPannerNode', () => {
    class OldWebkit extends FakeCtx {
      constructor(opts?: unknown) {
        if (opts !== undefined) throw new TypeError('webkitAudioContext takes no options');
        super();
      }
    }
    (OldWebkit.prototype as unknown as { createStereoPanner?: unknown }).createStereoPanner = undefined;
    win = Object.assign(new FakeTarget(), { webkitAudioContext: OldWebkit });
    g.window = win;
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('click');
    expect(ctx()).toBeInstanceOf(OldWebkit);
    expect(ctx().state).toBe('running');
    expect(e.play('hit_fire', { pan: 0.6 }).ok).toBe(true);
    expect(e.state().nodes.voices).toBe(2); // source + gain, no panner
    e.dispose();
  });

  it('a delayed sound keeps its own slot: warp_in follows warp_out, hurt_low does not block the next hurt', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    expect(e.play('warp_out').ok).toBe(true);
    expect(e.play('warp_in', { delay: 0.34 }).ok).toBe(true);
    expect(e.play('hurt').ok).toBe(true);
    expect(e.play('hurt_low', { delay: 0.25 }).ok).toBe(true);
    vi.advanceTimersByTime(130);
    expect(e.play('hurt').ok).toBe(true);
    // but two sounds of a group still collapse at the same start, delayed or not
    expect(e.play('coin', { delay: 0.14 }).ok).toBe(true);
    expect(e.play('coin', { delay: 0.15 })).toEqual({ ok: false, reason: 'gap' });
    e.dispose();
  });

  it('pans at the unpanned level (equal-power compensation) and the soft clipper never reaches full scale', () => {
    expect(panCompensation(0)).toBeCloseTo(Math.SQRT2, 6);
    expect(panCompensation(1)).toBeCloseTo(1, 6);
    expect(panCompensation(-1)).toBeCloseTo(1, 6);
    expect(panCompensation(0.7)).toBeGreaterThan(1);
    expect(panCompensation(0.7)).toBeLessThan(1.1);
    // the near speaker of a panned voice plays at the unpanned level
    for (const p of [-0.7, -0.2, 0.05, 0.4]) {
      const x = ((p + 1) / 2) * (Math.PI / 2);
      expect(Math.max(Math.cos(x), Math.sin(x)) * panCompensation(p)).toBeCloseTo(1, 6);
    }
    const curve = softClipCurve(0.7);
    const at = (x: number) => curve[Math.round(((x + 1) / 2) * (curve.length - 1))];
    expect(at(0.5)).toBeCloseTo(0.5, 2);
    expect(at(-0.5)).toBeCloseTo(-0.5, 2);
    expect(Math.max(...curve)).toBeLessThan(0.95);
    for (let i = 1; i < curve.length; i++) expect(curve[i]).toBeGreaterThanOrEqual(curve[i - 1]);
  });

  it('ambience swells chain onto the scheduled ramp (never cancel one mid-flight) and filters do not resonate', () => {
    const e = new AudioEngine(memStore());
    e.install();
    e.setMap(MAPS.lake);
    win.dispatch('touchend');
    const c = ctx();
    for (let t = 1; t <= 160; t++) {
      c.currentTime = t * 0.25;
      e.ambience.tick();
    }
    const swells = c.gains.filter((n) => n.gain.calls.filter((k) => k[0] === 'linear').length >= 3 && !n.gain.calls.some((k) => k[0] === 'target'));
    expect(swells.length).toBeGreaterThanOrEqual(2);
    for (const n of swells) {
      expect(n.gain.calls.some((k) => k[0] === 'cancel')).toBe(false);
      const ramps = n.gain.calls.filter((k) => k[0] === 'linear').map((k) => k[2]);
      for (let i = 1; i < ramps.length; i++) expect(ramps[i]).toBeGreaterThan(ramps[i - 1]);
    }
    const drifts = c.filters.filter((f) => f.frequency.calls.some((k) => k[0] === 'exp'));
    expect(drifts.length).toBeGreaterThanOrEqual(1);
    for (const f of drifts) expect(f.frequency.calls.some((k) => k[0] === 'cancel')).toBe(false);
    // Web Audio reads a low- / high-pass Q in dB: ≤ 0 dB means no resonant bump (Butterworth is −3 dB)
    for (const f of c.filters) if (f.type === 'lowpass' || f.type === 'highpass') expect(f.Q.value, f.type).toBeLessThanOrEqual(0);
    e.dispose();
  });

  it('ten warps leave no nodes, timers or listeners behind (cross-fade, then release)', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    const c = ctx();
    finishSources(c, true); // the silent unlock buffer
    const graph = wired();
    const listeners = win.count() + doc.count();
    const tour = [MAPS.cave, MAPS.meadow, MAPS.crypt, MAPS.town, MAPS.lake, MAPS.storm, MAPS.ember, MAPS.frost, MAPS.dusk, MAPS.quarry];
    for (const m of tour) {
      e.play('warp_out');
      e.play('warp_in', { delay: 0.34 });
      e.setMap(m);
      // mid cross-fade: the old bed fades out while the new one fades in
      expect(e.ambience.nodeCount()).toBeGreaterThan(0);
      for (let i = 0; i < 12; i++) {
        vi.advanceTimersByTime(250);
        e.play(i % 2 ? 'hit_fire' : 'step_grass');
        finishSources(c);
      }
    }
    vi.advanceTimersByTime(5000);
    finishSources(c, true);
    const s = e.state();
    expect(s.nodes.voices).toBe(0);
    expect(s.live).toBe(0);
    expect(s.bed).toBe('quarry');
    // only the quarry bed is left: one source + filter + gain per layer, and its output gain
    expect(s.nodes.ambience).toBe(1 * 3 + 1);
    expect(wired()).toBe(graph + s.nodes.ambience);
    expect(win.count() + doc.count()).toBe(listeners);
    expect(s.settingsListeners).toBe(1);
    expect(vi.getTimerCount()).toBe(1); // the engine's 250 ms tick, nothing else pending
    e.dispose();
    expect(win.count() + doc.count()).toBe(0);
  });
});

// ------------------------------------------------------------------ a busy AUTO fight through the bridge

const skillDef = (o: Partial<SkillDef> & { shape: SkillDef['shape'] }): SkillDef =>
  ({ id: 'x', name: 'X', desc: '', icon: '', tier: 0, tags: [], power: 1, spCost: 0, cooldown: 0, maxRank: 5, ...o }) as SkillDef;

describe('busy AUTO fight (stress)', () => {
  it('keeps voices and the master level in budget, and never loses a crit or the level-up', () => {
    const e = new AudioEngine(memStore());
    e.install();
    win.dispatch('touchend');
    const c = ctx();
    const log: { name: string; t: number; r: PlayResult }[] = [];
    const sink = {
      play: (name: string, o?: PlayOptions) => {
        const r = e.play(name, o);
        log.push({ name, t: performance.now(), r });
        return r;
      },
      setMap: () => undefined,
    };
    const scene: AudioScene = {
      events: { on: () => undefined, off: () => undefined },
      cameras: { main: { worldView: { centerX: 0, centerY: 0, width: 480, height: 270 } } },
      player: { x: 0, y: 0, moving: false },
      session: { player: { weapon: 'sword' } },
    };
    const bus = new EventBus<GameEvents>();
    const off = createAudioBridge(scene, sink, bus);

    const FAM = ['beast', 'sprite', 'construct', 'fiend'] as const;
    const mons = Array.from({ length: 8 }, (_, i) => ({
      x: Math.round(Math.cos(i * 0.785) * (60 + 12 * i)),
      y: Math.round(Math.sin(i * 0.785) * (40 + 9 * i)),
      def: { id: `m${i}`, family: FAM[i % 4], size: (['S', 'M', 'L'] as const)[i % 3], rank: 'common' as const },
    })) as unknown as GameEvents['hit']['target'][];
    const ELS = ['fire', 'lightning', 'ice', undefined, 'storm', 'water'] as const;
    const volley = skillDef({ shape: { kind: 'projectile', speed: 200, range: 200 } });
    const strike = skillDef({ element: 'fire', shape: { kind: 'strike', range: 30, arc: 90 } });
    const spin = skillDef({ shape: { kind: 'spin', radius: 60 } } as never);
    const chain = skillDef({ element: 'lightning', shape: { kind: 'chain', range: 1, jumps: 4 } });
    const ref = (sk: SkillDef) => ({ skillId: sk.id, skill: sk, element: sk.element });
    const hitEv = (m: (typeof mons)[number], el: (typeof ELS)[number], crit: boolean, hitIndex: number, via?: 'arc'): GameEvents['hit'] => ({
      ...ref(volley),
      element: el,
      source: 'player',
      target: m,
      x: m.x,
      y: m.y,
      damage: 9,
      crit,
      resisted: false,
      multiplier: 1,
      killed: false,
      hitIndex,
      ang: 0,
      via,
    });
    const sched: { t: number; fn: () => void }[] = [];
    const at = (t: number, fn: () => void) => sched.push({ t, fn });
    const critTimes: number[] = [];
    let hits = 0;
    const hit = (m: (typeof mons)[number], el: (typeof ELS)[number], crit: boolean, i: number, via?: 'arc') => {
      hits++;
      if (crit) critTimes.push(performance.now());
      bus.emit('hit', hitEv(m, el, crit, i, via));
    };
    const END = 8000;
    // 20 single-target hits / s (AUTO volley), every 4th a crit, statuses on every 3rd
    for (let t = 0, i = 0; t < END; t += 50, i++) {
      const m = mons[i % 8];
      at(t, () => {
        hit(m, ELS[i % ELS.length], i % 4 === 1, 0);
        if (i % 3 === 0) bus.emit('statusApplied', { target: m, kind: (['burn', 'shock', 'freeze', 'poison'] as const)[i % 4], x: m.x, y: m.y });
      });
    }
    // basic strikes, volleys, chains, spins (8 targets at once)
    for (let t = 20; t < END; t += 500) at(t, () => bus.emit('skillPulse', { ...ref(strike), owner: 'player', index: 0, count: 1, ang: 0, x: 0, y: 0 }));
    for (let t = 100; t < END; t += 500)
      for (let k = 0; k < 3; k++) at(t + k * 30, () => bus.emit('projectileSpawn', { ...ref(volley), owner: 'player', obj: null as never, mover: { x: 0, y: 0, vx: 1, vy: 0 }, angle: 0, speed: 1, range: 1, size: 1, x: 0, y: 0, index: k, count: 3 }));
    for (let t = 300; t < END; t += 1500) {
      at(t, () => bus.emit('castFire', { ...ref(chain), x: 0, y: 0, shape: 'chain', aim: { x: 0, y: 0 }, target: null, rank: 1, basic: false, map: 'm' }));
      for (let k = 0; k < 4; k++) {
        const m = mons[(k * 3) % 8];
        at(t + 60 * k, () => {
          bus.emit('chainHop', { ...ref(chain), owner: 'player', from: { x: 0, y: 0 }, to: { x: m.x, y: m.y }, index: k, target: m, knives: false });
          hit(m, 'lightning', k === 2, k, 'arc');
        });
      }
    }
    for (let t = 700; t < END; t += 2000) {
      at(t, () => {
        bus.emit('skillPulse', { ...ref(spin), owner: 'player', index: 0, count: 2, ang: 0, x: 0, y: 0 });
        mons.forEach((m, k) => hit(m, undefined, k === 3, k));
      });
    }
    // damage-over-time ticks: every monster every 0.5 s (16 ticks / s)
    mons.forEach((m, j) => {
      for (let t = j * 60; t < END; t += 500) at(t, () => bus.emit('dotTick', { target: m, damage: 2, kind: (['burn', 'poison', 'bleed', 'shock'] as const)[j % 4], x: m.x, y: m.y }));
    });
    // every monster attacks every 1.6 s: a tell, then the swing and the player's hurt
    let hp = 100;
    mons.forEach((m, j) => {
      for (let t = 200 + j * 190; t < END; t += 1600) {
        at(t, () => bus.emit('monsterTelegraph', { ...ref(strike), monster: m, shape: 'strike', x: m.x, y: m.y, at: { x: 0, y: 0 }, durationMs: 400, echo: false, rank: 'common' }));
        at(t + 400, () => {
          bus.emit('skillPulse', { ...ref(strike), owner: m, index: 0, count: 1, ang: 0, x: m.x, y: m.y });
          hp = Math.max(5, hp - 1.5);
          bus.emit('playerHurt', { damage: 2, hp, maxHp: 100, from: 'm', origin: { x: m.x, y: m.y }, heavy: j === 7, x: 0, y: 0 });
        });
      }
    });
    // kills, a combo, a nova, a level-up, quest ticks, a discovery
    for (let t = 900, k = 0; t < END; t += 1200, k++) {
      const m = mons[k % 8];
      at(t, () => {
        bus.emit('kill', { monster: m, def: (m as unknown as { def: never }).def, x: m.x, y: m.y, exp: 3, coins: 2, elite: false, warden: false });
        bus.emit('death', { target: m, rank: 'common', x: m.x, y: m.y });
      });
    }
    at(2500, () => bus.emit('combo', { ...ref(strike), target: mons[1], name: 'Shatter', consumes: 'freeze', x: mons[1].x, y: mons[1].y }));
    at(3500, () => bus.emit('novaBlast', { ...ref(strike), owner: 'player', x: 30, y: 10, radius: 120, heavy: true }));
    at(4000, () => bus.emit('levelUp', { level: 9, x: 0, y: 0 }));
    for (const t of [3000, 5000]) at(t, () => bus.emit('questChanged', { questId: 'q', reason: 'progress' }));
    at(6000, () => bus.emit('discovery', { kind: 'skill', title: 'Ember Arc' }));

    sched.sort((a, b) => a.t - b.t);
    let k = 0;
    let maxVoices = 0;
    const start = performance.now();
    for (let now = 0; now <= END + 600; now += 16) {
      vi.advanceTimersByTime(16);
      while (k < sched.length && sched[k].t <= now) sched[k++].fn();
      maxVoices = Math.max(maxVoices, e.state().voices);
      finishSources(c);
    }
    off();
    expect(hits / (END / 1000)).toBeGreaterThanOrEqual(20);

    // ---- voices: the limiter's own count, and the real overlap of what was started
    expect(maxVoices).toBeLessThanOrEqual(MAX_VOICES);
    const sources = c.started.filter((s) => s.buffer?.sampleRate === BUILD_RATE);
    const ok = log.filter((l) => l.r.ok);
    expect(sources.length).toBe(ok.length);
    const span = (s: FakeSource) => [s.startedAt, s.stoppedAt >= 0 ? s.stoppedAt : s.startedAt + s.buffer!.duration / s.playbackRate.value] as const;
    const overlap = (list: FakeSource[]) => {
      const edges = list.flatMap((s) => [[span(s)[0], 1] as const, [span(s)[1], -1] as const]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      let n = 0;
      let max = 0;
      for (const [, d] of edges) max = Math.max(max, (n += d));
      return max;
    };
    expect(overlap(sources)).toBeLessThanOrEqual(MAX_VOICES);
    const byGroup = new Map<string, FakeSource[]>();
    ok.forEach((l, i) => {
      const grp = SOUNDS[l.name].group;
      byGroup.set(grp, [...(byGroup.get(grp) ?? []), sources[i]]);
    });
    for (const [grp, list] of byGroup) expect(overlap(list), grp).toBeLessThanOrEqual(GROUPS[grp as keyof typeof GROUPS].max);

    // ---- priorities: every crit is heard (simultaneous ones collapse into one), the level-up and the fanfare play,
    // and nothing important is ever pushed out by the global cap
    const critPlays = ok.filter((l) => l.name === 'crit').map((l) => l.t);
    for (const t of critTimes) expect(critPlays.some((p) => Math.abs(p - t) <= GROUPS.crit.gap), `crit at ${t - start} ms`).toBe(true);
    expect(ok.some((l) => l.name === 'level_up')).toBe(true);
    expect(ok.some((l) => l.name === 'discover_skill')).toBe(true);
    expect(ok.some((l) => l.name === 'combo_shatter')).toBe(true);
    const lost = log.filter((l) => !l.r.ok && (l.r as { reason: string }).reason === 'global');
    for (const l of lost) expect(SOUNDS[l.name].priority ?? GROUPS[SOUNDS[l.name].group].priority, l.name).toBeLessThan(7);

    // ---- the master mix before the compressor (both speakers, the panner law included)
    const SR = BUILD_RATE;
    const len = Math.ceil(((END + 1200) / 1000) * SR);
    const L = new Float32Array(len);
    const R = new Float32Array(len);
    const bg = busGains(AUDIO_DEFAULTS);
    const master = bg.master * MAKEUP * bg.sfx;
    for (const s of sources) {
      const data = s.buffer!.getChannelData(0);
      const x = s.panAtStart === null ? null : ((s.panAtStart + 1) / 2) * (Math.PI / 2);
      const gl = (x === null ? 1 : Math.cos(x)) * s.gainAtStart * master;
      const gr = (x === null ? 1 : Math.sin(x)) * s.gainAtStart * master;
      const [t0, t1] = span(s);
      const rate = s.playbackRate.value;
      for (let i = Math.max(0, Math.floor(t0 * SR)); i < Math.min(len, Math.ceil(t1 * SR)); i++) {
        const pos = (i / SR - t0) * SR * rate;
        const j = Math.floor(pos);
        if (j < 0 || j >= data.length - 1) continue;
        const v = data[j] + (data[j + 1] - data[j]) * (pos - j);
        L[i] += v * gl;
        R[i] += v * gr;
      }
    }
    let peak = 0;
    for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
    const db = (v: number) => 20 * Math.log10(v);
    const peakDb = db(peak);
    const loud = db(Math.max(perceivedLoudness(L, SR), perceivedLoudness(R, SR)));
    if ((globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.AUDIO_STRESS_LOG) {
      const refused: Record<string, number> = {};
      for (const l of log) if (!l.r.ok) refused[`${l.name}:${(l.r as { reason: string }).reason}`] = (refused[`${l.name}:${(l.r as { reason: string }).reason}`] ?? 0) + 1;
      console.log({ hitsPerSecond: hits / 8, plays: log.length, started: ok.length, maxVoices, overlap: overlap(sources), peakDb: peakDb.toFixed(2), loudK100: loud.toFixed(2), refused });
    }
    // In budget before the compressor: no clipping even without it, a busy-fight loudness that sits well above a
    // single hit (≈ −22.5) but leaves the compressor only the stacking to ride.
    expect(peakDb).toBeLessThanOrEqual(-1);
    expect(loud).toBeGreaterThan(-20);
    expect(loud).toBeLessThan(-9);
    e.dispose();
  });
});
