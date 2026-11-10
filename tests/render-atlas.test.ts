// The stage atlas packer (src/game/render/atlas.ts): every rectangle placed once, inside the sheet, never touching.
import { describe, expect, it } from 'vitest';
import { packAtlas, shelfPack } from '../src/game/render/atlas';

describe('shelfPack', () => {
  const items = Array.from({ length: 90 }, (_, i) => ({ key: `k${i}`, w: 8 + ((i * 37) % 120), h: 8 + ((i * 53) % 150) }));

  it('places every rectangle inside the sheet with a gap around it', () => {
    const p = shelfPack(items, 512)!;
    expect(p.rects.map((r) => r.key).sort()).toEqual(items.map((i) => i.key).sort());
    expect(p.w).toBeLessThanOrEqual(512);
    for (const r of p.rects) {
      expect(r.x).toBeGreaterThanOrEqual(1);
      expect(r.y).toBeGreaterThanOrEqual(1);
      expect(r.x + r.w).toBeLessThan(p.w + 1);
      expect(r.y + r.h).toBeLessThan(p.h);
      const src = items.find((i) => i.key === r.key)!;
      expect([r.w, r.h]).toEqual([src.w, src.h]); // same pixels: nothing is scaled
    }
    for (let a = 0; a < p.rects.length; a++) {
      for (let b = a + 1; b < p.rects.length; b++) {
        const A = p.rects[a];
        const B = p.rects[b];
        const apart = A.x + A.w + 1 <= B.x || B.x + B.w + 1 <= A.x || A.y + A.h + 1 <= B.y || B.y + B.h + 1 <= A.y;
        expect(apart, `${A.key} / ${B.key}`).toBe(true);
      }
    }
  });

  it('is deterministic and refuses a rectangle wider than the sheet', () => {
    expect(shelfPack(items, 512)).toEqual(shelfPack([...items].reverse(), 512));
    expect(shelfPack([{ key: 'wide', w: 600, h: 4 }], 512)).toBeNull();
  });

  it('packAtlas leaves a scene without a canvas alone (the stage then keeps the separate textures)', () => {
    expect(packAtlas({ textures: {} } as never, ['a', 'b']).size).toBe(0);
  });
});
