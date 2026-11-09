// Light lane (polish audit): repeated map props are mirrored and jittered per tile so forests and rock fields stop
// reading as one stamp on a grid (render/stage.ts propPlacement). Phaser is stubbed: only the pure placement runs.
import { describe, expect, it, vi } from 'vitest';

vi.mock('phaser', () => ({ default: {} }));

const { propPlacement, PROP_JX, PROP_JY_DOWN, PROP_JY_UP, PROP_NO_FLIP } = await import('../src/game/render/stage');
const { compileMap, TILE } = await import('../src/core/world/compile');
const { MAPS } = await import('../src/data/world');

describe('prop placement (flip + jitter)', () => {
  it('stays within ±4 px across and -4..+2 px down of the tile foot, in whole pixels, deterministically', () => {
    expect(PROP_JX).toBe(4);
    for (let ty = 0; ty < 40; ty++)
      for (let tx = 0; tx < 40; tx++) {
        const a = propPlacement(tx, ty, 1234, 'tree', 3);
        expect(a).toEqual(propPlacement(tx, ty, 1234, 'tree', 3));
        const dx = a.x - (tx * TILE + TILE / 2);
        const dy = a.y - (ty + 1) * TILE;
        expect(Number.isInteger(a.x) && Number.isInteger(a.y)).toBe(true);
        expect(Math.abs(dx)).toBeLessThanOrEqual(PROP_JX);
        expect(dy).toBeGreaterThanOrEqual(-PROP_JY_UP);
        expect(dy).toBeLessThanOrEqual(PROP_JY_DOWN);
        expect(a.look).toBeGreaterThanOrEqual(0);
        expect(a.look).toBeLessThan(3);
      }
  });

  it('mirrors about half of a real forest and uses the whole jitter range', () => {
    const cm = compileMap(MAPS.find((m) => m.id === 'vale.gloomwood')!);
    const seed = cm.def.seed;
    const all = cm.props.map((p) => ({ p, at: propPlacement(p.tx, p.ty, seed, p.kind, 3) }));
    expect(all.length).toBeGreaterThan(100);
    const flipped = all.filter((a) => a.at.flip && !PROP_NO_FLIP.has(a.p.kind)).length / all.length;
    expect(flipped).toBeGreaterThan(0.35);
    expect(flipped).toBeLessThan(0.65);
    const xs = new Set(all.map((a) => a.at.x - (a.p.tx * TILE + TILE / 2)));
    const ys = new Set(all.map((a) => a.at.y - (a.p.ty + 1) * TILE));
    expect(xs.size).toBe(2 * PROP_JX + 1);
    expect(ys.size).toBe(PROP_JY_UP + PROP_JY_DOWN + 1);
    // neighbours do not move together (independent bits for x, y, flip)
    let sameDx = 0;
    for (let i = 1; i < all.length; i++) if (all[i].at.x - all[i].p.tx * TILE === all[i - 1].at.x - all[i - 1].p.tx * TILE) sameDx++;
    expect(sameDx / all.length).toBeLessThan(0.3);
  });

  it('never mirrors a prop lit from the top-left (rocks, crystals, spires, tombstones, two-tone pines), but still jitters it', () => {
    for (const kind of ['rock', 'boulder', 'crystal', 'stalagmite', 'tombstone', 'basalt_spire', 'pine', 'frostpine'] as const) {
      expect(PROP_NO_FLIP.has(kind), kind).toBe(true);
      const xs = new Set<number>();
      for (let ty = 0; ty < 20; ty++)
        for (let tx = 0; tx < 20; tx++) {
          const at = propPlacement(tx, ty, 777, kind, 2);
          expect(at.flip, `${kind} ${tx},${ty}`).toBe(false);
          xs.add(at.x - (tx * TILE + TILE / 2));
        }
      expect(xs.size, kind).toBe(2 * PROP_JX + 1);
    }
    for (const kind of ['tree', 'darktree', 'bush', 'reeds'] as const) expect(PROP_NO_FLIP.has(kind), kind).toBe(false);
  });
});
