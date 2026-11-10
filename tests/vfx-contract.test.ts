// The shared VFX contract (src/game/vfx/types.ts, docs/VFX.md §10): helpers and invariants both work packages rely on.
import { describe, expect, it } from 'vitest';
import { SKILLS } from '../src/data/skills';
import {
  ARC_BUCKETS,
  COMPONENT_IDS,
  DECAL_BUCKETS,
  FAMILY_IDS,
  PHASE_IDS,
  REACH_BUCKETS,
  UNIQUE_DIRS,
  VFX_BUDGET,
  VSYNC_MS,
  floorBucket,
  nearestBucket,
  pickDir,
  quantMs,
  type DirCount,
} from '../src/game/vfx/types';

describe('vfx contract', () => {
  it('has 17 families with danger, and 22 components (17 of v1 + field, warp, mend, shell, emblem)', () => {
    expect(FAMILY_IDS).toHaveLength(17);
    expect(new Set(FAMILY_IDS).size).toBe(17);
    expect(FAMILY_IDS).toContain('danger');
    expect(COMPONENT_IDS).toHaveLength(22);
    expect(new Set(COMPONENT_IDS).size).toBe(22);
    expect(PHASE_IDS).toEqual(['telegraph', 'charge', 'cast', 'body', 'trail', 'impact', 'area', 'status', 'aura']);
  });

  it('quantises frame times to 60 Hz vsync multiples', () => {
    for (const v of VSYNC_MS) expect(Math.abs(v - (Math.round(v / (1000 / 60)) * 1000) / 60)).toBeLessThan(0.5);
    expect(quantMs(40)).toBe(33);
    expect(quantMs(45)).toBe(50);
    expect(quantMs(1000)).toBe(200);
  });

  it('buckets reach, arc and decal radii', () => {
    expect(REACH_BUCKETS[0]).toBe(40);
    expect(REACH_BUCKETS[REACH_BUCKETS.length - 1]).toBe(128);
    expect(ARC_BUCKETS).toContain(360);
    expect(nearestBucket(56, REACH_BUCKETS)).toBe(56);
    expect(nearestBucket(110, ARC_BUCKETS)).toBe(120);
    expect(floorBucket(130, DECAL_BUCKETS)).toBe(128);
    // Every authored strike's range and arc land within 4 px / 15 deg of a bucket (expanse included).
    for (const s of SKILLS) {
      if (s.shape.kind !== 'strike') continue;
      for (const [range, arc] of [
        [s.shape.range, s.shape.arc],
        [Math.round(s.shape.range * 1.2), Math.min(360, s.shape.arc + 30)],
      ]) {
        expect(Math.abs(nearestBucket(Math.min(128, range), REACH_BUCKETS) - Math.min(128, range))).toBeLessThanOrEqual(4);
        expect(Math.abs(nearestBucket(Math.max(60, arc), ARC_BUCKETS) - Math.max(60, arc))).toBeLessThanOrEqual(15);
      }
    }
  });

  it('maps every heading to a unique bake plus flips', () => {
    for (const dirs of [8, 16] as DirCount[]) {
      const step = (Math.PI * 2) / dirs;
      for (let i = 0; i < dirs; i++) {
        const p = pickDir(i * step, dirs);
        expect(p.u).toBeGreaterThanOrEqual(0);
        expect(p.u).toBeLessThan(UNIQUE_DIRS[dirs]);
        // Reconstruct the heading from the unique angle and the flips.
        let a = p.u * step;
        if (p.flipX) a = Math.PI - a;
        if (p.flipY) a = -a;
        const d = (((a - i * step) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2) - Math.PI;
        expect(Math.abs(d)).toBeLessThan(1e-9);
      }
    }
    expect(pickDir(1.234, 1)).toEqual({ u: 0, flipX: false, flipY: false });
  });

  it('keeps budget caps consistent', () => {
    const sprites = Object.values(VFX_BUDGET.sprites).reduce((a, b) => a + b, 0);
    expect(sprites).toBeLessThanOrEqual(260);
    expect(VFX_BUDGET.bobsReservedForTells).toBeLessThan(VFX_BUDGET.bobs);
    expect(VFX_BUDGET.perEvent.novaUnits).toBeLessThanOrEqual(14);
    expect(VFX_BUDGET.cpuMs.update + VFX_BUDGET.cpuMs.bakeSlice).toBeLessThanOrEqual(VFX_BUDGET.cpuMs.total + 0.5);
    expect(VFX_BUDGET.cueMinPx).toBeGreaterThanOrEqual(2);
  });
});
