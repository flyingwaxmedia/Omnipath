// Player-facing words (src/ui/words.ts, panels lane): friendly names and helpers per docs/UX-SIMPLE.md.
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/data';
import { sourceText } from '../src/ui/util';
import { FRIENDLY, article, classLevel, effectLine, familyName, fraction, more, oneLine, originText, plainText, plural, seen, shapeWord, stars } from '../src/ui/words';

/** Internals that must never reach a player (docs/UX-SIMPLE.md rule 2). */
const INTERNAL = /\b(tier|tags?|threat|clause|tagPower|propagate|hardened|variant|merge|CR\b|per rank|essence slot)/i;

describe('friendly names', () => {
  it('maps the internal concepts to the UX-SIMPLE table', () => {
    expect(FRIENDLY.classRank).toBe('Class Level');
    expect(FRIENDLY.morph).toBe('Transform');
    expect(FRIENDLY.imprint).toBe('Keepsake');
    expect(FRIENDLY.spark).toBe('Sudden insight');
    expect(FRIENDLY.essenceSlot).toBe('Rune socket');
    expect(FRIENDLY.tagPassive).toBe('Mastery bonus');
    expect(FRIENDLY.resonance).toBe('Element bond');
    expect(FRIENDLY.becomeClass).toBe('Become');
  });

  it('formats stars, Seen, articles, plurals, levels and fractions', () => {
    expect(stars(3, 5)).toBe('★★★☆☆');
    expect(stars(0, 3)).toBe('☆☆☆');
    expect(stars(20, 20)).toBe('★★★★★★★★★★');
    expect(seen(5, 3)).toBe('Seen 3/3');
    expect(article('Pyroblade')).toBe('a Pyroblade');
    expect(article('Earthshaper')).toBe('an Earthshaper');
    expect(plural(1, 'skill')).toBe('1 skill');
    expect(plural(3, 'class', 'classes')).toBe('3 classes');
    expect(more(1, 'fire skill')).toBe('1 more fire skill');
    expect(classLevel(4)).toBe('Class Level 4');
    expect(classLevel(10, 10)).toBe('Class Level 10 · Mastered');
    expect(fraction(9, 8)).toBe('8/8');
    expect(oneLine('Spin and slash. Then more words.')).toBe('Spin and slash.');
    expect(plainText('<b>Flame</b>  Spin')).toBe('Flame Spin');
    expect(shapeWord('projectile')).toBe('ranged');
    expect(shapeWord('nova')).toBe('burst');
  });
});

describe('origins in plain words', () => {
  const name = (kind: string, id: string) => (kind === 'skill' ? `S(${id})` : kind === 'monster' ? 'Jellop' : kind === 'class' ? 'Pyroblade' : undefined);
  it('never says morph / spark / lesson', () => {
    expect(originText('morph:slash', name)).toBe('Transformed from S(slash)');
    expect(originText('spark:slash', name)).toBe('Sudden insight from S(slash)');
    expect(originText('echo:jellop', name)).toBe('Learned from the Jellop');
    expect(originText('lesson:hale_rising_kick', name)).toBe('Quest reward');
    expect(originText('quest:hale_first_drill', name)).toBe('Quest reward');
    expect(originText('class:pyroblade', name)).toBe('Pyroblade skill');
    expect(originText('fusion:skill:a+el:fire', name)).toBe('Made at a Fusion Altar');
    expect(originText("Sister Alba's blessing", name)).toBe("Sister Alba's blessing");
  });

  it('sourceText reads names from the registry', () => {
    const reg = createRegistry();
    const skill = reg.authoredSkills()[0];
    expect(sourceText(`morph:${skill.id}`, reg)).toBe(`Transformed from ${skill.name}`);
  });
});

describe('effectLine', () => {
  it('turns bonus formulas into one plain effect', () => {
    expect(effectLine('+3% blade damage per rank. Grows with the total mastery of your blade skills.')).toBe('Blade skills hit harder.');
    expect(effectLine('-4% dash cooldown per rank. Grows with the total mastery of your dash skills.')).toBe('Dash skills come back faster.');
    expect(effectLine('-4% SP cost for fire skills per rank.')).toBe('Fire skills cost less SP.');
    expect(effectLine('-4% cooldown for aoe skills per rank.')).toBe('Area skills come back faster.');
    expect(effectLine('Fire is the oldest prayer: +12% holy damage against burning foes.')).toBe('Holy hits harder on burning foes.');
    expect(effectLine('+15% regeneration while standing still, per rank.')).toBe('Heal faster while standing still.');
    expect(effectLine('+3% damage with every skill.')).toBe('Every skill hits harder.');
    expect(effectLine('+3% SPEED per rank.')).toBe('Move faster.');
    expect(effectLine('+4% max HP per rank. Laps of Emberwatch.')).toBe('More max HP.');
    expect(effectLine('A quiet line with no numbers. And more.')).toBe('A quiet line with no numbers.');
  });

  it('leaves no formula or internal word in any passive of the game', () => {
    const reg = createRegistry();
    for (const p of reg.passives.values()) {
      const line = effectLine(p.desc);
      expect(line, p.id).not.toMatch(/\d+%/);
      expect(line, p.id).not.toMatch(INTERNAL);
      expect(line.length, p.id).toBeLessThanOrEqual(60);
    }
  });
});

describe('monster families', () => {
  it('reads every family of the game in plain words (the Bestiary and its cards agree)', () => {
    expect(familyName('revenant')).toBe('Spirits');
    expect(familyName('sylvan')).toBe('Forest folk');
    const reg = createRegistry();
    for (const m of reg.monsters.values()) {
      const name = familyName(m.family);
      expect(name, m.id).toMatch(/^[A-Z]/);
      expect(name.toLowerCase(), m.id).not.toBe(m.family);
    }
  });
});
