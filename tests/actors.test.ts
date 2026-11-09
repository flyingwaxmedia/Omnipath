// Actors lane (docs/INTEGRATION-v3.md §2.2): the pure rules behind animated actors, chevrons and quest markers.
import { describe, expect, it } from 'vitest';
import { CHAR_ANIMS } from '../src/game/art/characters';
import { MONSTER_ANIMS } from '../src/game/art/monsters';
import { MARKER_ART, MARKER_KEYS, PLAYER_STATUS_ICONS, STATUS_ART } from '../src/game/entities/actorArt';
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
