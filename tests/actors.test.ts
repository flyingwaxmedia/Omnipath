// Actors lane (docs/INTEGRATION-v3.md §2.2): the pure rules behind animated actors, chevrons and quest markers.
import { describe, expect, it } from 'vitest';
import { CHAR_ANIMS } from '../src/game/art/characters';
import { MONSTER_ANIMS, MONSTER_VARIANTS, monsterHideColor, monsterPixels, monsterVariant } from '../src/game/art/monsters';
import { MARKER_ART, MARKER_KEYS, PLAYER_STATUS_ICONS, STATUS_ART, TARGET_RING_W, monsterShadowW } from '../src/game/entities/actorArt';
import { AGGRO_RADIUS, HOVER_MONSTERS, bob, iconRow, isChasing, monsterAnimKey, monsterAnimRate } from '../src/game/entities/rules';
import { NPCS } from '../src/data/npcs';
import { MONSTERS } from '../src/data/monsters';

describe('animations', () => {
  it('has a 2-frame idle for every NPC texture', () => {
    for (const n of NPCS) {
      const a = CHAR_ANIMS.find((x) => x.key === `${n.texture}_idle`);
      expect(a, n.id).toBeDefined();
      expect(a!.frames).toEqual([n.texture, `${n.texture}_1`]);
    }
  });

  it('has a monster loop for every monster texture, and flyers are real species', () => {
    for (const m of MONSTERS) {
      const tex = m.texture ?? `mon_${m.id}`;
      const fallback = m.base ? `mon_${m.base}` : 'mon_jellop';
      expect(MONSTER_ANIMS[tex] ?? MONSTER_ANIMS[fallback], m.id).toBeDefined();
    }
    for (const t of HOVER_MONSTERS) expect(MONSTER_ANIMS[t], t).toBeDefined();
    expect(monsterAnimKey('mon_jellop')).toBe('mon_jellop_anim');
  });

  it('walks while moving, breathes slowly when still, and flyers never stop', () => {
    const still = monsterAnimRate({ moving: false, chasing: false, enraged: false, hover: false });
    const walk = monsterAnimRate({ moving: true, chasing: false, enraged: false, hover: false });
    const chase = monsterAnimRate({ moving: true, chasing: true, enraged: false, hover: false });
    const rage = monsterAnimRate({ moving: true, chasing: true, enraged: true, hover: false });
    expect(still).toBeLessThan(walk);
    expect(walk).toBeLessThan(chase);
    expect(chase).toBeLessThan(rage);
    expect(monsterAnimRate({ moving: false, chasing: false, enraged: false, hover: true })).toBe(1);
  });
});

describe('chevrons', () => {
  const base = { alive: true, returning: false, provoked: false, aggressive: false, rank: 'common' as const, dist: 50, safe: false };
  it('marks provoked monsters and aggressive ones inside their aggro radius', () => {
    expect(isChasing(base)).toBe(false);
    expect(isChasing({ ...base, provoked: true, dist: 999 })).toBe(true);
    expect(isChasing({ ...base, aggressive: true, dist: AGGRO_RADIUS.common - 1 })).toBe(true);
    expect(isChasing({ ...base, aggressive: true, dist: AGGRO_RADIUS.common + 1 })).toBe(false);
    expect(isChasing({ ...base, aggressive: true, rank: 'warden', dist: AGGRO_RADIUS.common + 1 })).toBe(true);
  });
  it('never marks dead, leashed-home monsters, or while the player is safe', () => {
    expect(isChasing({ ...base, provoked: true, alive: false })).toBe(false);
    expect(isChasing({ ...base, provoked: true, returning: true })).toBe(false);
    expect(isChasing({ ...base, provoked: true, safe: true })).toBe(false);
  });
});

describe('quest markers and status icons', () => {
  it('has a pixel marker for each quest state', () => {
    expect(Object.keys(MARKER_KEYS).sort()).toEqual(['!', '?', '…'].sort());
    for (const [k, a] of Object.entries(MARKER_ART)) {
      expect(a.rows.length, k).toBeLessThanOrEqual(a.h - 2);
      for (const r of a.rows) {
        expect(r.length, k).toBeLessThanOrEqual(a.w - 2);
        for (const ch of r) if (ch !== '.') expect(a.pal[ch], `${k} '${ch}'`).toBeDefined();
      }
    }
  });
  it('draws every player status as a 7x7 icon (no emoji in-world)', () => {
    for (const k of PLAYER_STATUS_ICONS) {
      const a = STATUS_ART[k];
      expect(a, k).toBeDefined();
      expect(a!.rows).toHaveLength(7);
      for (const r of a!.rows) {
        expect(r).toHaveLength(7);
        for (const ch of r) if (ch !== '.') expect(a!.pal[ch], `${k} '${ch}'`).toBeDefined();
      }
    }
  });
  it('lays status icons out centred on whole pixels', () => {
    expect(iconRow(100, 1, 9, 1)).toEqual([96]);
    expect(iconRow(100, 2, 9, 1)).toEqual([91, 101]);
    expect(iconRow(100, 0, 9, 1)).toEqual([]);
  });
  it('bobs by whole pixels within the amplitude', () => {
    for (let t = 0; t < 3000; t += 37) {
      const b = bob(t, 1000, 1.5);
      expect(Number.isInteger(b)).toBe(true);
      expect(Math.abs(b)).toBeLessThanOrEqual(2);
    }
  });
});

// ---------------------------------------------------------------- integer-pixel rule (docs/QUALITY-PLAN.md §1)

const opaque = (d: Uint8ClampedArray) => {
  let n = 0;
  for (let i = 3; i < d.length; i += 4) if (d[i] >= 128) n++;
  return n;
};

describe('monsters drawn at their size (no fractional sprite scale)', () => {
  it('bakes every scaled or tinted monster into its own native texture with a 2-frame loop', () => {
    for (const m of MONSTERS) {
      if ((m.scale ?? 1) === 1 && m.tint === undefined) continue;
      const v = monsterVariant(m);
      expect(v, m.id).not.toBeNull();
      expect(v!.key).toBe(`mon_${m.id}`);
      expect(MONSTER_VARIANTS[v!.key], m.id).toBeDefined();
      expect(MONSTER_ANIMS[v!.key]?.frames, m.id).toEqual([v!.key, `${v!.key}_1`]);
      expect(MONSTER_ANIMS[v!.key].fps).toBe(MONSTER_ANIMS[`mon_${v!.species}`].fps);
    }
    // commons and wardens show their own species texture as painted
    for (const m of MONSTERS.filter((d) => d.rank === 'warden')) expect(monsterVariant(m), m.id).toBeNull();
  });

  it('paints a variant natively at round(size x k), keeping the silhouette (area ~ k^2)', () => {
    for (const v of Object.values(MONSTER_VARIANTS)) {
      const one = monsterPixels(v.species, 0, 1)!;
      const big = monsterPixels(v.species, 0, v.k)!;
      expect(big.w, v.key).toBe(Math.round(one.w * v.k));
      expect(big.h, v.key).toBe(Math.round(one.h * v.k));
      const ratio = opaque(big.data) / opaque(one.data);
      expect(ratio, v.key).toBeGreaterThan(v.k * v.k * 0.8);
      expect(ratio, v.key).toBeLessThan(v.k * v.k * 1.25);
      // only fully opaque or fully clear body pixels (no anti-aliasing from the re-raster)
      for (let i = 3; i < big.data.length; i += 4) expect(big.data[i] === 0 || big.data[i] === 255, v.key).toBe(true);
    }
  });

  it('draws shadows and target rings at whole-pixel sizes per rank', () => {
    expect(monsterShadowW('common')).toBe(32);
    expect(monsterShadowW('elite', 1.4)).toBe(64);
    expect(monsterShadowW('warden')).toBe(73);
    for (const w of Object.values(TARGET_RING_W)) expect(Number.isInteger(w)).toBe(true);
    expect(TARGET_RING_W.common).toBeLessThan(TARGET_RING_W.elite);
    expect(TARGET_RING_W.elite).toBeLessThan(TARGET_RING_W.warden);
  });
});

describe('death chip colours', () => {
  it('gives every monster a hide colour, an elite its tinted one', () => {
    for (const m of MONSTERS) {
      const c = monsterHideColor(m.id);
      expect(Number.isInteger(c) && c >= 0 && c <= 0xffffff, m.id).toBe(true);
      expect(c, m.id).not.toBe(0x24180f);
      expect(monsterHideColor(`mon_${m.id}`), m.id).toBe(c);
    }
    const boulder = MONSTERS.find((m) => m.id === 'boulderback')!;
    expect(monsterHideColor('boulderback')).not.toBe(monsterHideColor('cragling'));
    expect(monsterHideColor('mon_boulderback_1')).toBe(monsterHideColor('boulderback'));
    expect(boulder.tint).toBeDefined();
    expect(monsterHideColor('gloomcap')).toBe(0x9a6cc4); // the purple cap, not the pale stem
  });
});

describe('quest marker contrast', () => {
  const luma = (c: string) => {
    const n = parseInt(c.slice(1), 16);
    return (((n >> 16) & 255) * 0.299 + ((n >> 8) & 255) * 0.587 + (n & 255) * 0.114) / 255;
  };
  it('draws the "in progress" bubble with a light core, ink dots and a dark rim (reads on grey cobble)', () => {
    const { pal } = MARKER_ART['…'];
    const cobble = luma('#878b93');
    expect(luma(pal.w) - cobble).toBeGreaterThan(0.35);
    expect(luma(pal.w) - luma(pal.d)).toBeGreaterThan(0.6);
    expect(luma(pal.r)).toBeLessThan(cobble);
  });
});
