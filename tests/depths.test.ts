import { describe, expect, it } from 'vitest';
import { DEPTH, WORLD_MAX, WORLD_MIN, Y_BIAS, ySort } from '../src/game/render/depths';

// Owned by the render lane (docs/INTEGRATION-v3.md §2.1): new layers go into this list in their place.
describe('depth layers', () => {
  it('keep the documented bottom-to-top order', () => {
    const order: (keyof typeof DEPTH)[] = [
      'BACKDROP',
      'GROUND',
      'GROUND_DECAL',
      'PORTAL_DECAL',
      'HIDDEN_DECAL',
      'DRESSING_FLAT',
      'MOVE_MARKER',
      'AIM_PREVIEW',
      'TELEGRAPH',
      'SHADOW',
      'AURA',
      'TARGET_RING',
      'FX_GROUND',
      'CANOPY',
      'RIM',
      'FX_FRONT',
      'NAME_TAG',
      'HP_BAR',
      'MARKER',
      'FX_GLOW',
      'CAST_BAR',
      'STATUS_ICON',
      'CHEVRON',
      'DARKNESS',
      'LIGHT',
      'LIGHT_TOP',
      'TELL_TOP',
      'WORLD_TEXT',
      'SCREEN_FX',
    ];
    for (let i = 1; i < order.length; i++) expect(DEPTH[order[i]]).toBeGreaterThan(DEPTH[order[i - 1]]);
  });

  it('the y-sorted band sits between the ground layers and the overlays, clamped', () => {
    expect(DEPTH.FX_GROUND).toBeLessThan(WORLD_MIN);
    expect(DEPTH.CANOPY).toBeGreaterThan(WORLD_MAX);
    expect(ySort(100)).toBe(100);
    expect(ySort(100, Y_BIAS.PROP)).toBe(96);
    expect(ySort(-50)).toBe(WORLD_MIN);
    expect(ySort(1e9)).toBe(WORLD_MAX);
    // the biggest bias on the biggest map still stays under the canopy
    expect(ySort(WORLD_MAX, Y_BIAS.PILLAR)).toBeLessThan(DEPTH.CANOPY);
  });
});
