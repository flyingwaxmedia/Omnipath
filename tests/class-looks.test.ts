// Actors lane (docs/INTEGRATION-v3.md §2.2, docs/CLIENT-v3.md §5): every class wears an original outfit.
import { describe, expect, it } from 'vitest';
import { WEAPON_TYPES } from '../src/core/types';
import { CHAR_ANIMS, lookAnimDefs } from '../src/game/art/characters';
import { CLASS_OUTFITS, LOOK_FRAMES, auraColor, classOutfit, lookAnims, lookBase, lookFrames } from '../src/game/art/classLooks';
import { CLASSES } from '../src/data/classes';

const HEX = /^#[0-9a-f]{6}$/i;

describe('class outfits', () => {
  it('covers all 30 classes and nothing else', () => {
    expect(CLASSES).toHaveLength(30);
    expect(Object.keys(CLASS_OUTFITS).sort()).toEqual(CLASSES.map((c) => c.id).sort());
  });

  it('gives a cape from Tier II and an aura only at Tier III', () => {
    for (const c of CLASSES) {
      const o = CLASS_OUTFITS[c.id];
      expect(!!o.cape, `${c.id} cape`).toBe((c.tier ?? 1) >= 2);
      expect(!!o.aura, `${c.id} aura`).toBe((c.tier ?? 1) >= 3);
    }
  });

  it('uses valid #rrggbb colours everywhere', () => {
    for (const [id, o] of Object.entries(CLASS_OUTFITS))
      for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.startsWith('#')) expect(v, `${id}.${k}`).toMatch(HEX);
  });

  it('makes every outfit different (palette + armour + headgear + emblem)', () => {
    const sig = Object.values(CLASS_OUTFITS).map((o) => [o.primary, o.secondary, o.trim, o.armour, o.headgear, o.emblem, o.shoulders].join('|'));
    expect(new Set(sig).size).toBe(sig.length);
    const looks = Object.values(CLASS_OUTFITS).map((o) => `${o.armour}|${o.headgear}|${o.primary}`);
    expect(new Set(looks).size).toBe(looks.length);
  });

  it('uses every armour type and a wide range of headgear', () => {
    const armour = new Set(Object.values(CLASS_OUTFITS).map((o) => o.armour));
    expect([...armour].sort()).toEqual(['cloth', 'leather', 'plate', 'robe']);
    const heads = new Set(Object.values(CLASS_OUTFITS).map((o) => o.headgear));
    for (const h of ['none', 'hood', 'widehat', 'tallhat', 'helm', 'circlet', 'crown', 'horns', 'bandana']) expect(heads.has(h as never), h).toBe(true);
  });

  it('keeps the plain weapon look for "No class" and unknown ids', () => {
    expect(classOutfit(null)).toBeNull();
    expect(classOutfit('nope')).toBeNull();
    expect(lookBase('staff', null)).toBe('player_staff');
    expect(lookBase('staff', 'nope')).toBe('player_staff');
    expect(lookBase('dagger', 'pyroblade')).toBe('player_dagger__pyroblade');
  });

  it('names the same frame set as the base player and its animations', () => {
    expect(lookFrames('player_sword__phantom')).toEqual([
      'player_sword__phantom',
      'player_sword__phantom_idle_1',
      'player_sword__phantom_walk_0',
      'player_sword__phantom_walk_1',
      'player_sword__phantom_walk_2',
      'player_sword__phantom_walk_3',
      'player_sword__phantom_atk_0',
      'player_sword__phantom_atk_1',
    ]);
    expect(LOOK_FRAMES).toHaveLength(8);
    const base = 'player_staff__archmage';
    const defs = lookAnimDefs(base);
    const keys = lookAnims(base);
    expect(defs.map((d) => d.key)).toEqual([keys.idle, keys.walk, keys.atk]);
    expect(defs.flatMap((d) => d.frames).sort()).toEqual(lookFrames(base).sort());
    expect(defs.find((d) => d.key === keys.atk)!.repeat).toBe(0);
  });

  it('keeps the v2 player animations in CHAR_ANIMS (same shape as a class look)', () => {
    // Bare Hands borrows the dagger frames until the art lane draws its look (SPEC-v4 §11.8).
    for (const w of WEAPON_TYPES.filter((x) => x !== 'fists')) for (const d of lookAnimDefs(`player_${w}`)) expect(CHAR_ANIMS).toContainEqual(d);
  });

  it('turns Tier III aura colours into numbers', () => {
    expect(auraColor('ascendant')).toBe(0xfff0b0);
    expect(auraColor('blademaster')).toBeNull();
    expect(auraColor(null)).toBeNull();
  });
});
