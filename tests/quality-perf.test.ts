// ?perf overlay numbers (src/game/render/perf.ts) and the WebGL context-loss re-bake (src/game/render/contextloss.ts).
import { describe, expect, it, vi } from 'vitest';

vi.mock('../src/game/audio', () => ({ audioEngine: () => ({ state: () => ({ voices: 0, context: 'none' }) }) }));

import { repairTextures, rebakeMap } from '../src/game/render/contextloss';
import { FrameStats, hotbarLift, percentile, perfLines, textureBudget, type PerfSample } from '../src/game/render/perf';

describe('perf numbers', () => {
  it('nearest-rank percentiles', () => {
    expect(percentile([], 50)).toBe(0);
    expect(percentile([5], 95)).toBe(5);
    const a = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(a, 50)).toBe(50);
    expect(percentile(a, 95)).toBe(95);
    expect(percentile(a, 100)).toBe(100);
    expect(percentile(a, 0)).toBe(1);
  });

  it('a ring buffer of frame times keeps the latest samples', () => {
    const f = new FrameStats(4);
    for (const v of [100, 100, 100, 100, 16, 17, 18, 40]) f.push(v);
    expect(f.count).toBe(4);
    expect(f.p(50)).toBe(17);
    expect(f.p(95)).toBe(40);
    f.clear();
    expect(f.p(50)).toBe(0);
  });

  it('texture memory counts every source once and skips Phaser placeholders', () => {
    const shared = { width: 1024, height: 1024 };
    const tm = {
      list: {
        __DEFAULT: { source: [{ width: 32, height: 32 }] },
        __WHITE: { source: [{ width: 4, height: 4 }] },
        tiles: { source: [{ width: 512, height: 256 }] },
        alias: { source: [shared] },
        alias2: { source: [shared] },
        rt: { source: [{ width: 100, height: 50, isRenderTexture: true }] },
      },
    };
    const b = textureBudget(tm);
    expect(b.count).toBe(4);
    expect(b.bytes).toBe((512 * 256 + 1024 * 1024 + 100 * 50) * 4);
    expect(b.renderTargets).toBe(1);
    // RenderTexture game objects (baked ground, light map) live outside the manager.
    const withRt = textureBudget(tm, [{ width: 1024, height: 512 }]);
    expect(withRt.bytes - b.bytes).toBe(1024 * 512 * 4);
    expect(withRt.renderTargets).toBe(2);
  });

  it('the panel lifts above the skill bar only where the bar reaches its corner', () => {
    const panel = { left: 2, right: 160 };
    // phone portrait: the bar starts near the left edge
    expect(hotbarLift(panel, { left: 40, right: 280, top: 744, width: 240, height: 90 }, 844)).toBe(100);
    // iPad / landscape: the bar is centred, clear of the corner
    expect(hotbarLift(panel, { left: 283, right: 900, top: 740, width: 617, height: 60 }, 820)).toBe(0);
    // hidden bar (full-screen panel) or none
    expect(hotbarLift(panel, { left: 0, right: 0, top: 0, width: 0, height: 0 }, 844)).toBe(0);
    expect(hotbarLift(panel, null, 844)).toBe(0);
  });

  it('the panel lines say the essentials', () => {
    const s: PerfSample = {
      fps: 59.6,
      frame: { p50: 16.66, p95: 18.21 },
      cpu: { p50: 3.24, p95: 6.01 },
      drawCalls: 42,
      textures: { count: 1834, mb: 41.25, renderTargets: 4 },
      renderer: 'WebGL',
      scale: { k: 3, w: 394, h: 274 },
      vfx: { quality: 1, sprites: 12, bobs: 30, particles: 40, pages: 2, updateMs: 0.4 },
      audio: { voices: 3, context: 'running' },
      quality: { tier: 'medium', battery: true, fps: 30 },
    };
    const lines = perfLines(s);
    expect(lines[0]).toBe('FPS 60 (cap 30)');
    expect(lines[1]).toBe('FRAME 16.7 / 18.2 ms');
    expect(lines[2]).toBe('CPU 3.2 / 6 ms');
    expect(lines[3]).toBe('DRAW 42  WebGL k3 394x274');
    expect(lines[4]).toBe('TEX 1834  41.3 MB  RT 4');
    expect(lines[5]).toBe('VFX q1 SPR 12 BOB 30 PRT 40 PG 2');
    expect(lines[6]).toBe('AUDIO 3 voices (running)');
    expect(lines[7]).toBe('MEDIUM + BATTERY');
    expect(perfLines({ ...s, drawCalls: null, vfx: null, audio: null, renderer: 'Canvas' })).toHaveLength(6);
  });
});

describe('context restore', () => {
  it('re-uploads only canvas / image sources whose GL texture did not come back, never render targets', () => {
    const live = {} as WebGLTexture;
    const dead = {} as WebGLTexture;
    let updates = 0;
    let inits = 0;
    const canvas = (t: WebGLTexture | null) => ({ image: {}, isCanvas: true, glTexture: { webGLTexture: t }, update: () => void updates++ });
    const okSrc = canvas(live);
    const tm = {
      list: {
        a: { source: [okSrc] },
        b: { source: [canvas(dead)] },
        c: { source: [canvas(null)] },
        d: { source: [{ image: {}, isCanvas: false, glTexture: null, init: () => void inits++ }] },
        rt: { source: [{ image: {}, isRenderTexture: true, glTexture: { webGLTexture: null }, update: () => void updates++ }] },
        alias: { source: [okSrc] },
        empty: { source: [{ image: null }] },
      },
    };
    const r = repairTextures(tm, (t) => t === live);
    expect(r).toEqual({ checked: 4, repaired: 3 });
    expect(updates).toBe(2);
    expect(inits).toBe(1);
  });

  it('re-bakes the ground of the running map (or lets the stage do it when it can)', () => {
    let destroyed = 0;
    const cm = { w: 10, h: 10 } as never;
    const scene = { cm, stage: { ground: { apron: { x: 0, y: 0 }, destroy: () => void destroyed++ } as unknown } } as Parameters<typeof rebakeMap>[0] & { stage: { ground: unknown } };
    const fresh = { apron: { x: 0, y: 0 }, destroy: () => undefined };
    const baked: unknown[] = [];
    expect(rebakeMap(scene, (_s, m) => (baked.push(m), fresh))).toEqual(['ground']);
    expect(destroyed).toBe(1);
    expect(baked).toEqual([cm]);
    expect(scene.stage.ground).toBe(fresh);
    let own = 0;
    expect(rebakeMap({ cm, stage: { restoreContext: () => void own++, ground: fresh } }, () => fresh)).toEqual(['stage']);
    expect(own).toBe(1);
    expect(rebakeMap(undefined)).toEqual([]);
    expect(rebakeMap({ cm, stage: {} })).toEqual([]);
  });
});
