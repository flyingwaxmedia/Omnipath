import { describe, expect, it } from 'vitest';
import { T } from '../src/core/world/tiles';
import type { NodeKind } from '../src/core/world/types';
import { MONSTERS } from '../src/data/monsters';
import { SKILLS } from '../src/data/skills';
import { MAPS } from '../src/data/world';
import {
  CAST_SHAPES,
  ELEMENT_KEYS,
  GROUPS,
  PEAK_CEILING,
  SOUNDS,
  TARGET_LOUDNESS,
  buildSound,
  castSound,
  chargeSound,
  comboSound,
  deathSound,
  discoverySound,
  gatherSound,
  gainOf,
  hitSound,
  novaSound,
  perceivedLoudness,
  soundDuration,
  soundNames,
  statusSound,
  stepSound,
  swingSound,
  tickSound,
} from '../src/game/audio/bank';
import { BEDS, REVERBS, bedFor, makeImpulse, makeNoise, reverbFor } from '../src/game/audio/ambience';
import { AUDIO_DEFAULTS, AUDIO_STORE_KEY, SettingsStore, busGains, isSilent, sanitizeSettings, type KeyStore } from '../src/game/audio/settings';
import { MIN_SPATIAL_GAIN, PAN_WIDTH, spatialize } from '../src/game/audio/spatial';
import { SURFACES, surfaceAt, surfaceOf } from '../src/game/audio/surfaces';
import { VoiceLimiter } from '../src/game/audio/voices';
import { zzfxBuild, zzfxLength } from '../src/game/audio/zzfx';

const SR = 32000;

/** Power spectrum (Hann-windowed 2048-point frames, averaged) → energy fractions by band. */
const N = 2048;
const COS = new Float64Array(N / 2).map((_, k) => Math.cos((-2 * Math.PI * k) / N));
const SIN = new Float64Array(N / 2).map((_, k) => Math.sin((-2 * Math.PI * k) / N));

function bands(x: Float32Array, sampleRate: number): { low: number; mid: number; high: number } {
  const spec = new Float64Array(N / 2);
  const w = new Float64Array(N).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1)));
  for (let off = 0; off < Math.max(1, x.length - N / 2); off += N / 2) {
    const re = new Float64Array(N);
    const im = new Float64Array(N);
    for (let i = 0; i < N; i++) re[i] = (x[off + i] ?? 0) * w[i];
    for (let i = 1, j = 0; i < N; i++) {
      let bit = N >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        [re[i], re[j]] = [re[j], re[i]];
        [im[i], im[j]] = [im[j], im[i]];
      }
    }
    for (let len = 2; len <= N; len <<= 1) {
      const step = N / len;
      for (let i = 0; i < N; i += len) {
        for (let k = 0; k < len / 2; k++) {
          const cr = COS[k * step];
          const ci = SIN[k * step];
          const a = i + k;
          const b = a + len / 2;
          const vr = re[b] * cr - im[b] * ci;
          const vi = re[b] * ci + im[b] * cr;
          re[b] = re[a] - vr;
          im[b] = im[a] - vi;
          re[a] += vr;
          im[a] += vi;
        }
      }
    }
    for (let k = 0; k < N / 2; k++) spec[k] += re[k] * re[k] + im[k] * im[k];
  }
  const bin = sampleRate / N;
  let tot = 0;
  let low = 0;
  let mid = 0;
  let high = 0;
  for (let k = 1; k < spec.length; k++) {
    const f = k * bin;
    tot += spec[k];
    if (f < 150) low += spec[k];
    else if (f > 7000) high += spec[k];
    else if (f >= 200 && f <= 6000) mid += spec[k];
  }
  return { low: low / tot, mid: mid / tot, high: high / tot };
}

describe('vendored ZzFX', () => {
  it('is deterministic for a given roll and sample rate, and scales length with the rate', () => {
    const p = [1, 0.1, 440, 0.01, 0.05, 0.1, 1, 1, 2, 0, 0, 0, 0, 0.5];
    const a = zzfxBuild(p, SR, 0.3);
    expect(zzfxBuild(p, SR, 0.3)).toEqual(a);
    expect(zzfxBuild(p, SR, 0.9)).not.toEqual(a);
    expect(a.length).toBe(Math.floor((0.01 + 0.05 + 0.1) * SR));
    expect(zzfxBuild(p, 44100, 0.3).length).toBe(Math.floor((0.01 + 0.05 + 0.1) * 44100));
    expect(zzfxLength(p)).toBeCloseTo(0.16, 5);
    expect(a.every(Number.isFinite)).toBe(true);
  });

  it('does not touch Math.random', () => {
    const real = Math.random;
    Math.random = () => {
      throw new Error('Math.random called');
    };
    try {
      expect(() => zzfxBuild([1, 0.5, 300, 0, 0.1, 0.1, 4, 1, 0, 0, 0, 0, 0, 1], SR, 0.7)).not.toThrow();
      expect(() => buildSound('hit_fire', SOUNDS.hit_fire, SR, 2)).not.toThrow();
    } finally {
      Math.random = real;
    }
  });
});

describe('SFX bank', () => {
  const names = soundNames();

  it('has the full catalogue', () => {
    expect(names.length).toBeGreaterThan(200);
    for (const el of ELEMENT_KEYS) {
      expect(SOUNDS[`hit_${el}`]).toBeDefined();
      expect(SOUNDS[chargeSound(el === 'physical' ? undefined : el)]).toBeDefined();
      for (const shape of CAST_SHAPES) expect(SOUNDS[`cast_${shape}_${el}`], `cast_${shape}_${el}`).toBeDefined();
    }
    for (const w of ['sword', 'dagger', 'staff'] as const) for (const heavy of [false, true]) expect(SOUNDS[swingSound(w, heavy)]).toBeDefined();
    for (const s of SURFACES) expect(SOUNDS[stepSound(s)], s).toBeDefined();
    const nodes: NodeKind[] = ['ore', 'fishing', 'herb', 'ember_vent', 'wind_chime', 'storm_tree', 'shadow_fungus', 'sun_spring', 'frost_crystal'];
    for (const n of nodes) expect(gatherSound(n), n).toBe(`gather_${n}`);
    for (const k of ['skill', 'spark', 'echo', 'witness', 'passive', 'essence', 'class', 'element', 'mastered', 'bestiary', 'quest', 'reward']) {
      const s = discoverySound(k);
      if (s) expect(SOUNDS[s], k).toBeDefined();
    }
    expect(new Set(['skill', 'element', 'class', 'spark'].map(discoverySound)).size).toBe(4);
    for (const s of ['burn', 'soak', 'stun', 'shock', 'freeze', 'bleed', 'smite', 'slow', 'knockback', 'poison', 'pull'] as const) {
      expect(SOUNDS[statusSound(s)!], s).toBeDefined();
      expect(SOUNDS[tickSound(s)], s).toBeDefined();
    }
    expect(comboSound('Shatter')).toBe('combo_shatter');
    expect(comboSound('Conduct')).toBe('combo_conduct');
    expect(comboSound('Fan the Flames')).toBe('combo_fan');
    expect([novaSound(40), novaSound(80), novaSound(140)]).toEqual(['nova_s', 'nova_m', 'nova_l']);
    for (const n of ['level_up', 'quest_accept', 'quest_ready', 'quest_complete', 'coin', 'ui_open', 'ui_close', 'ui_confirm', 'ui_nope', 'warp_out', 'warp_in', 'boss_roar', 'boss_enrage', 'tell', 'tell_big', 'crit', 'zap_chain', 'proj_whoosh', 'combo_shatter']) {
      expect(SOUNDS[n], n).toBeDefined();
    }
  });

  it('covers every authored skill, element and monster family', () => {
    for (const s of SKILLS) {
      expect(SOUNDS[castSound(s.shape.kind, s.element)], s.id).toBeDefined();
      expect(SOUNDS[hitSound(s.element)], s.id).toBeDefined();
    }
    for (const m of MONSTERS) expect(SOUNDS[deathSound(m.family)], m.id).toBeDefined();
  });

  it('every recipe builds clean, normalised, short and in the phone-speaker band', () => {
    for (const name of names) {
      const def = SOUNDS[name];
      expect(GROUPS[def.group], name).toBeDefined();
      expect(gainOf(def), name).toBeGreaterThan(0);
      expect(gainOf(def), name).toBeLessThanOrEqual(0.8); // the level table: tests/audio-bank.test.ts
      const x = buildSound(name, def, SR, 1);
      expect(x.length, name).toBeGreaterThan(0);
      let peak = 0;
      let finite = true;
      for (const v of x) {
        if (!Number.isFinite(v)) finite = false;
        else if (Math.abs(v) > peak) peak = Math.abs(v);
      }
      expect(finite, name).toBe(true);
      expect(peak, name).toBeLessThanOrEqual(PEAK_CEILING + 1e-6);
      expect(perceivedLoudness(x, SR), name).toBeLessThanOrEqual(TARGET_LOUDNESS + 1e-6);
      // reaches its target unless the peak ceiling held it back (tests/audio-bank.test.ts bounds that at 1 dB)
      expect(perceivedLoudness(x, SR), name).toBeGreaterThan(TARGET_LOUDNESS * 0.89);
      expect(soundDuration(def, SR), name).toBeCloseTo(x.length / SR, 2);
      const limit = def.bus === 'ambience' ? 2.6 : def.group === 'fanfare' || def.group === 'boss' ? 1.5 : def.group === 'quest' || def.group === 'gather' ? 1.1 : 0.7;
      expect(x.length / SR, name).toBeLessThanOrEqual(limit);
      const b = bands(x, SR);
      expect(b.low, `${name} sub-bass`).toBeLessThan(0.12);
      expect(b.high, `${name} hiss`).toBeLessThan(0.08);
      expect(b.mid, `${name} body`).toBeGreaterThan(0.6);
    }
  }, 30000);

  it('combat sounds are short and footsteps are tiny', () => {
    for (const name of names.filter((n) => n.startsWith('hit_'))) expect(soundDuration(SOUNDS[name]), name).toBeLessThan(0.25);
    for (const name of names.filter((n) => n.startsWith('step_'))) expect(soundDuration(SOUNDS[name]), name).toBeLessThan(0.12);
    for (const name of names.filter((n) => n.startsWith('swing_'))) expect(soundDuration(SOUNDS[name]), name).toBeLessThan(0.3);
  });

  it('variations are seeded: same variation = same samples, others differ for noisy sounds', () => {
    const a = buildSound('hit_physical', SOUNDS.hit_physical, SR, 1);
    expect(buildSound('hit_physical', SOUNDS.hit_physical, SR, 1)).toEqual(a);
    expect(buildSound('hit_physical', SOUNDS.hit_physical, SR, 2)).not.toEqual(a);
  });

  it('the mix keeps its hierarchy: ticks < footsteps < swings < hits < fanfares', () => {
    const g = (n: string) => gainOf(SOUNDS[n]);
    expect(g('tick_burn')).toBeLessThan(g('swing_sword_light'));
    expect(g('step_grass')).toBeLessThan(g('swing_sword_light'));
    expect(g('swing_sword_light')).toBeLessThan(g('hit_fire'));
    expect(g('swing_sword_light')).toBeLessThan(g('swing_sword_heavy'));
    expect(GROUPS.fanfare.priority).toBeGreaterThan(GROUPS.tick.priority);
    expect(GROUPS.crit.priority).toBeGreaterThan(GROUPS.hit.priority);
    expect(GROUPS.telegraph.priority).toBeGreaterThan(GROUPS.swing.priority);
  });

  it('normalises by perceived loudness: a short tap and a long swell of equal level measure alike', () => {
    const tone = (ms: number, f: number) => Float32Array.from({ length: Math.round((SR * ms) / 1000) }, (_, i) => 0.5 * Math.sin((2 * Math.PI * f * i) / SR));
    // longer than the 100 ms window: duration no longer matters
    expect(perceivedLoudness(tone(400, 500), SR)).toBeCloseTo(perceivedLoudness(tone(200, 500), SR), 2);
    // a 25 ms burst counts as quieter than a 200 ms tone (the ear integrates ≈ 100 ms)
    expect(perceivedLoudness(tone(25, 500), SR)).toBeLessThan(perceivedLoudness(tone(200, 500), SR) * 0.6);
    // the K-weighting shelf: 3 kHz counts louder than 500 Hz; the master high-pass: 60 Hz barely counts
    expect(perceivedLoudness(tone(200, 3000), SR)).toBeGreaterThan(perceivedLoudness(tone(200, 500), SR) * 1.4);
    expect(perceivedLoudness(tone(200, 60), SR)).toBeLessThan(perceivedLoudness(tone(200, 500), SR) * 0.35);
  });
});

describe('voice limiter', () => {
  const pol = { max: 2, gap: 30, priority: 3 };

  it('enforces the retrigger gap and the group maximum, stealing the weakest when allowed', () => {
    const v = new VoiceLimiter(10);
    expect(v.admit('hit', pol, 0, 200)).not.toBeNull();
    expect(v.admit('hit', pol, 10, 200)).toBeNull();
    expect(v.lastRefusal).toBe('gap');
    expect(v.admit('hit', pol, 40, 200)).not.toBeNull();
    // Full group: an equal-priority newcomer steals the oldest.
    const third = v.admit('hit', pol, 80, 200);
    expect(third?.evict.map((e) => e.start)).toEqual([0]);
    expect(v.active(81, 'hit')).toBe(2);
    // A weaker one is dropped; a stronger one steals.
    expect(v.admit('hit', pol, 120, 200, 1)).toBeNull();
    expect(v.lastRefusal).toBe('group');
    expect(v.admit('hit', pol, 160, 200, 9)?.evict.length).toBe(1);
    // Expired voices free their slots.
    expect(v.active(1000)).toBe(0);
  });

  it('measures the gap of a delayed voice at its own start, and counts it from now on', () => {
    const v = new VoiceLimiter(10);
    const warp = { max: 2, gap: 300, priority: 6 };
    expect(v.admit('warp', warp, 0, 380)).not.toBeNull();
    expect(v.admit('warp', warp, 0, 380, 6, 340)).not.toBeNull(); // warp_in 340 ms later
    expect(v.active(1, 'warp')).toBe(2);
    expect(v.admit('warp', warp, 100, 380)).toBeNull(); // too close to warp_out
    // an immediate sound is not blocked by a scheduled one far enough ahead of it
    const hurt = { max: 2, gap: 90, priority: 6 };
    expect(v.admit('hurt', hurt, 0, 90, 6, 250)).not.toBeNull();
    expect(v.admit('hurt', hurt, 100, 90)).not.toBeNull();
    expect(v.admit('hurt', hurt, 200, 90)).toBeNull(); // within 90 ms of the delayed one at 250
  });

  it('a high-priority sound beats ticks at the global cap, never the reverse', () => {
    const v = new VoiceLimiter(3);
    const tick = { max: 5, gap: 0, priority: 0 };
    for (let i = 0; i < 3; i++) expect(v.admit('tick', tick, i, 1000)).not.toBeNull();
    expect(v.admit('tick', tick, 5, 1000)?.evict.length).toBe(1); // equal priority: oldest goes
    const fan = v.admit('fanfare', { max: 1, gap: 0, priority: 10 }, 6, 1000);
    expect(fan?.evict[0].group).toBe('tick');
    expect(v.admit('tick', { ...tick, priority: -1 }, 7, 1000, -1)).toBeNull();
    expect(v.lastRefusal).toBe('global');
    v.release(fan!.id);
    expect(v.active(8)).toBe(2);
  });
});

describe('spatial', () => {
  const view = { cx: 500, cy: 300, halfW: 200, halfH: 150 };
  it('pans by horizontal offset (never hard) and fades off-screen', () => {
    expect(spatialize(500, 300, view)).toEqual({ pan: 0, gain: 1 });
    const right = spatialize(700, 300, view);
    expect(right.pan).toBeGreaterThan(0.5);
    expect(right.pan).toBeLessThanOrEqual(PAN_WIDTH);
    expect(right.gain).toBe(1);
    expect(spatialize(300, 300, view).pan).toBeCloseTo(-right.pan, 6);
    expect(spatialize(5000, 300, view).pan).toBeCloseTo(PAN_WIDTH, 6);
    const near = spatialize(820, 300, view).gain;
    const far = spatialize(900, 300, view).gain;
    expect(near).toBeLessThan(1);
    expect(far).toBeLessThan(near);
    expect(spatialize(1400, 300, view).gain).toBeLessThan(MIN_SPATIAL_GAIN);
    expect(spatialize(500, 300, { cx: 500, cy: 300, halfW: 0, halfH: 0 }).gain).toBe(1);
  });
});

describe('audio settings', () => {
  const memStore = (): KeyStore & { data: Map<string, string> } => {
    const data = new Map<string, string>();
    return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
  };

  it('defaults, sanitises, persists and notifies', () => {
    const store = memStore();
    const s = new SettingsStore(store);
    expect(s.get()).toEqual(AUDIO_DEFAULTS);
    const seen: boolean[] = [];
    const off = s.onChange((v) => seen.push(v.muted));
    s.set({ muted: true, sfx: 2, ambience: -1 });
    expect(s.get()).toMatchObject({ muted: true, sfx: 1, ambience: 0 });
    expect(JSON.parse(store.data.get(AUDIO_STORE_KEY)!)).toMatchObject({ muted: true, sfx: 1 });
    s.set({ muted: true }); // no change → no notification
    off();
    s.set({ muted: false });
    expect(seen).toEqual([true]);
    expect(new SettingsStore(store).get()).toMatchObject({ muted: false, sfx: 1, ambience: 0 });
  });

  it('survives broken or throwing storage', () => {
    const bad: KeyStore = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const s = new SettingsStore(bad);
    expect(s.get()).toEqual(AUDIO_DEFAULTS);
    expect(() => s.set({ master: 0.3 })).not.toThrow();
    expect(s.get().master).toBe(0.3);
    const junk = memStore();
    junk.setItem(AUDIO_STORE_KEY, '{not json');
    expect(new SettingsStore(junk).get()).toEqual(AUDIO_DEFAULTS);
    expect(new SettingsStore(null).get()).toEqual(AUDIO_DEFAULTS);
    expect(sanitizeSettings({ master: 'x', music: '0.5', muted: 1 })).toMatchObject({ master: AUDIO_DEFAULTS.master, music: 0.5, muted: false });
  });

  it('bus gains follow a perceptual curve and mute folds into master', () => {
    expect(busGains({ ...AUDIO_DEFAULTS, master: 0.5 }).master).toBeCloseTo(0.25, 6);
    expect(busGains({ ...AUDIO_DEFAULTS, muted: true }).master).toBe(0);
    expect(isSilent({ ...AUDIO_DEFAULTS, master: 0 })).toBe(true);
    expect(isSilent(AUDIO_DEFAULTS)).toBe(false);
  });
});

describe('footstep surfaces', () => {
  it('maps every tile to a surface with a sound', () => {
    for (const t of Object.values(T)) expect(SURFACES).toContain(surfaceOf(t));
    expect(surfaceOf(T.GRASS)).toBe('grass');
    expect(surfaceOf(T.PATH)).toBe('dirt');
    expect(surfaceOf(T.COBBLE)).toBe('stone');
    expect(surfaceOf(T.BRIDGE)).toBe('wood');
    expect(surfaceOf(T.SAND)).toBe('sand');
    expect(surfaceOf(T.SNOW)).toBe('snow');
    expect(surfaceOf(T.WATER)).toBe('water');
    expect(surfaceOf(T.CAVE)).toBe('cave');
    expect(surfaceOf(undefined)).toBe('dirt');
  });

  it('reads the tile under a world position', () => {
    const grid = { w: 2, h: 2, ground: [T.GRASS, T.BRIDGE, T.SAND, T.SNOW] };
    expect(surfaceAt(grid, 10, 10)).toBe('grass');
    expect(surfaceAt(grid, 40, 10)).toBe('wood');
    expect(surfaceAt(grid, 10, 40)).toBe('sand');
    expect(surfaceAt(grid, 63, 63)).toBe('snow');
    expect(surfaceAt(grid, -5, 10)).toBe('dirt');
    expect(surfaceAt(undefined, 0, 0)).toBe('dirt');
  });
});

describe('ambience', () => {
  it('every map has a bed and caves / crypts echo', () => {
    for (const m of MAPS) {
      const bed = BEDS[bedFor(m)];
      expect(bed, m.id).toBeDefined();
      const r = reverbFor(m);
      if (m.biome === 'cave' || m.biome === 'crypt') {
        expect(r?.id, m.id).toBe(m.biome);
        expect(bed.echo, m.id).toBe(true);
      }
      if (!m.flags?.includes('indoor') && m.kind !== 'dungeon' && m.biome !== 'cave' && m.biome !== 'crypt') expect(r, m.id).toBeNull();
    }
    expect(bedFor({ id: 'x', biome: 'grove', kind: 'field' })).toBe('forest');
  });

  it('bed one-shots are ambience-bus bank sounds with sane timing', () => {
    for (const bed of Object.values(BEDS)) {
      expect(bed.layers.length, bed.id).toBeGreaterThan(0);
      // (bed gains are set from an offline render of every bed: outdoor beds within ±1 dB, caves / crypts ~3 dB under)
      expect(bed.gain, bed.id).toBeLessThanOrEqual(1);
      for (const l of bed.layers) {
        expect(l.freq, bed.id).toBeGreaterThanOrEqual(200);
        expect(l.freq, bed.id).toBeLessThanOrEqual(6000);
      }
      for (const e of bed.events) {
        expect(SOUNDS[e.sound]?.bus, `${bed.id}: ${e.sound}`).toBe('ambience');
        expect(e.every[0], e.sound).toBeGreaterThan(0.3);
        expect(e.every[1]).toBeGreaterThanOrEqual(e.every[0]);
        expect(e.gain[1]).toBeLessThanOrEqual(1);
      }
    }
  });

  it('noise loops are seamless, normalised and seeded', () => {
    for (const color of ['white', 'pink', 'brown'] as const) {
      const x = makeNoise(color, 1, 8000, 42);
      expect(x.length).toBe(8000);
      let sum = 0;
      for (const v of x) sum += v * v;
      expect(Math.sqrt(sum / x.length)).toBeCloseTo(0.3, 3);
      expect(makeNoise(color, 1, 8000, 42)).toEqual(x);
      expect(makeNoise(color, 1, 8000, 43)).not.toEqual(x);
      // The wrap-around step is no bigger than a typical step inside the loop.
      let typical = 0;
      for (let i = 1; i < x.length; i++) typical += Math.abs(x[i] - x[i - 1]);
      typical /= x.length - 1;
      expect(Math.abs(x[0] - x[x.length - 1])).toBeLessThan(typical * 6 + 1e-3);
    }
  });

  it('room impulses decay and differ per ear', () => {
    const p = REVERBS.cave;
    const [l, r] = makeImpulse(p, 16000, 7);
    expect(l.length).toBe(Math.round((p.seconds + p.predelay) * 16000));
    const energy = (a: Float32Array, from: number, to: number) => {
      let s = 0;
      for (let i = Math.floor(from * a.length); i < Math.floor(to * a.length); i++) s += a[i] * a[i];
      return s;
    };
    expect(energy(l, 0.85, 1)).toBeLessThan(energy(l, 0, 0.15) * 0.01);
    expect(l).not.toEqual(r);
    expect(makeImpulse(p, 16000, 7)[0]).toEqual(l);
    for (let i = 0; i < Math.round(p.predelay * 16000) - 1; i++) expect(l[i]).toBe(0);
  });
});
