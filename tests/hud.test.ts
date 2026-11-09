// HUD v3 pure helpers (HUD lane): layout maths and HTML builders (docs/CLIENT-v3.md §2, docs/UX-SIMPLE.md).
import { describe, expect, it } from 'vitest';
import type { BarSlotView, PursuitView, SlotPickerView, WornClassView, ZoneView } from '../src/ui/controller';
import {
  HUD_WORDS,
  barTabsHtml,
  digits,
  pickerHtml,
  pursuitHtml,
  slotChooserHtml,
  slotHtml,
  statsHtml,
  zonePlateHtml,
  zoneStripHtml,
  type HudArt,
} from '../src/ui/hud/html';
import {
  barLeft,
  barRows,
  barWidth,
  cooldownText,
  countText,
  expPercent,
  fitSnap,
  placeCentred,
  rowsThatFit,
  splitCount,
} from '../src/ui/hud/layout';

const art: HudArt = {
  skill: (id) => `data:skill/${id}`,
  pip: (el) => `data:pip/${el}`,
  cls: (id) => `data:cls/${id}`,
};

const slot = (over: Partial<BarSlotView>): BarSlotView => ({ index: 0, skillId: null, kind: 'own', key: '1', ...over });

describe('layout maths', () => {
  it('snaps icon sizes to whole device pixels and never exceeds the room', () => {
    expect(fitSnap(40, 32, 1)).toBe(32);
    expect(fitSnap(46, 32, 2)).toBe(32);
    expect(fitSnap(48, 32, 2)).toBe(48);
    expect(fitSnap(42, 32, 3)).toBeCloseTo(32);
    expect(fitSnap(10, 32, 1)).toBe(32); // at least one art pixel per device pixel
    for (const dpr of [1, 1.5, 2, 2.625, 3]) {
      const v = fitSnap(44, 32, dpr);
      expect(v).toBeLessThanOrEqual(44 + 1e-9);
      expect(Number.isInteger(Math.round((v * dpr) / 32 * 1e6) / 1e6)).toBe(true);
    }
  });

  it('splits the bar into two even rows only when asked (portrait phones)', () => {
    expect(barRows(8, false)).toEqual([8]);
    expect(barRows(8, true)).toEqual([4, 4]);
    expect(barRows(6, true)).toEqual([3, 3]);
    expect(barRows(7, true)).toEqual([4, 3]);
    expect(barRows(4, true)).toEqual([4]);
    expect(barRows(0, true)).toEqual([]);
    expect(barWidth(8, 46, 3)).toBe(8 * 46 + 7 * 3);
    expect(barWidth(0, 46, 3)).toBe(0);
  });

  it('centres the zone plate in the free span, or reports that it does not fit', () => {
    expect(placeCentred(200, 1000, 0, 1000)).toBe(400);
    expect(placeCentred(200, 1000, 520, 900)).toBe(520); // pushed right of a left block
    expect(placeCentred(200, 1000, 100, 450)).toBe(250); // pushed left of the buttons
    expect(placeCentred(200, 1000, 300, 450)).toBeNull();
  });

  it('keeps the skill bar clear of the attack cluster', () => {
    expect(barLeft(400, 1180, 1000, 10, 8)).toBe(390); // centred
    expect(barLeft(400, 844, 690, 10, 8)).toBe(222); // centred still fits
    expect(barLeft(476, 820, 650, 10, 8)).toBe(164); // pushed left
    expect(barLeft(476, 500, 300, 10, 8)).toBe(8); // never past the margin
  });

  it('formats EXP, cooldowns, counts and tracker counts', () => {
    expect(expPercent(0, 100)).toBe('0.0%');
    expect(expPercent(42.37, 100)).toBe('42.3%');
    expect(expPercent(100, 100)).toBe('99.9%');
    expect(expPercent(5, 0)).toBe('0%');
    expect(cooldownText(0)).toBe('');
    expect(cooldownText(30)).toBe('');
    expect(cooldownText(640)).toBe('0.7');
    expect(cooldownText(1000)).toBe('1');
    expect(cooldownText(2300)).toBe('3');
    expect(countText(-2)).toBe('0');
    expect(countText(7)).toBe('7');
    expect(countText(250)).toBe('99+');
    expect(splitCount('Defeat Jellops 3/8')).toEqual({ text: 'Defeat Jellops', count: '3/8' });
    expect(splitCount('Mine ore: 3 / 10')).toEqual({ text: 'Mine ore', count: '3/10' });
    expect(splitCount('Return to Brann')).toEqual({ text: 'Return to Brann', count: '' });
    expect(splitCount('3/8')).toEqual({ text: '3/8', count: '' });
  });

  it('shows only the Pursuits rows that fit above a limit (the first always)', () => {
    const rows = [
      { top: 100, bottom: 144 },
      { top: 148, bottom: 192 },
      { top: 196, bottom: 240 },
    ];
    expect(rowsThatFit(rows, 1000)).toBe(3);
    expect(rowsThatFit(rows, 200)).toBe(2);
    expect(rowsThatFit(rows, 50)).toBe(1);
    expect(rowsThatFit([], 50)).toBe(0);
  });
});

describe('numbers in the pixel font', () => {
  it('wraps digit runs but leaves HTML entities alone', () => {
    expect(digits('Lv 12')).toBe('Lv <span class="num">12</span>');
    expect(digits('3/8 · 42%')).toBe('<span class="num">3/8</span> · <span class="num">42%</span>');
    expect(digits('Brann&#39;s 2 anvils')).toBe('Brann&#39;s <span class="num">2</span> anvils');
    expect(digits('Lv 3–6')).toBe('Lv <span class="num">3–6</span>');
    expect(digits('no numbers')).toBe('no numbers');
  });
});

describe('skill bar slots', () => {
  it('frames class slots in the class colour with the emblem; your slots stay plain with an edit corner', () => {
    const cls = slotHtml(slot({ index: 0, kind: 'class', classId: 'pyroblade', skillId: 'flame_spin', name: 'Flame Spin', rank: 3, maxRank: 10, element: 'fire' }), art, {
      auto: true,
      classColor: '#d8433f',
      className: 'Pyroblade',
    });
    expect(cls).toContain('class="slot by-class auto"');
    expect(cls).toContain('--cc:#d8433f');
    expect(cls).toContain('data:cls/pyroblade');
    expect(cls).toContain('data:pip/fire');
    expect(cls).toContain('data:skill/flame_spin');
    expect(cls).toContain('>3</span>');
    expect(cls).not.toContain('class="edit"');
    const own = slotHtml(slot({ index: 6, key: '7', skillId: 'whirlwind', name: 'Whirlwind', rank: 10, maxRank: 10 }), art, { auto: false });
    expect(own).toContain('class="slot own maxed"');
    expect(own).toContain('class="edit"');
    expect(own).toContain('★');
    expect(own).not.toContain('--cc');
  });

  it('shows a faint emblem in an empty class slot and a plus in an empty slot of yours', () => {
    const emptyCls = slotHtml(slot({ index: 2, kind: 'class', classId: 'pyroblade' }), art, { auto: true, className: 'Pyroblade' });
    expect(emptyCls).toContain('class="slot by-class empty"');
    expect(emptyCls).toContain('class="ghost"');
    expect(emptyCls).not.toContain('auto');
    const emptyOwn = slotHtml(slot({ index: 7, key: '8' }), art, { auto: true });
    expect(emptyOwn).toContain('class="plus"');
    expect(emptyOwn).toContain('tap to pick a skill');
  });

  it('marks a skill that can transform (✨) and the spark rune', () => {
    const v = slotHtml(slot({ skillId: 'slash', name: 'Slash', rank: 10, maxRank: 10, transformReady: true }), art, { auto: false, spark: true });
    expect(v).toContain('rk ready');
    expect(v).toContain('✨');
    expect(v).toContain('class="spk"');
    expect(v).toContain('class="slot own maxed ready"');
  });

  it('escapes names and ids', () => {
    const v = slotHtml(slot({ skillId: 'x"y', name: '<script>' }), art, { auto: false });
    expect(v).not.toContain('<script>');
    expect(v).toContain('&lt;script&gt;');
    expect(v).toContain('data-skill="x&quot;y"');
  });

  it('names the two groups over the bar only when a class is worn and fills part of it', () => {
    const worn: WornClassView = { id: 'pyroblade', name: 'Pyroblade', level: 3, maxLevel: 10, progress: 0.4, color: '#d8433f' };
    expect(barTabsHtml(5, 8, worn, 'data:cls')).toContain('Pyroblade');
    expect(barTabsHtml(5, 8, worn, '')).toContain('Yours');
    expect(barTabsHtml(0, 8, worn, '')).toBe('');
    expect(barTabsHtml(5, 8, null, '')).toBe('');
  });
});

describe('zone plate, stat strip, Pursuits', () => {
  const zone: ZoneView = { name: 'Greenmeadow', tag: 'Hunting', band: 'Lv 1–3', explored: 42.4, sources: ['earth'], warden: 'alive' };

  it('builds the zone plate with the name in <b>, the safety pill and the level band', () => {
    const html = zonePlateHtml(zone);
    expect(html).toMatch(/<b class="zn">Greenmeadow<\/b>/);
    expect(html).toContain('class="zt hunt"');
    expect(html).toContain('Lv <span class="num">1–3</span>');
    expect(zonePlateHtml({ name: 'Hearthvale', tag: 'Safe', band: '' })).toContain('zt safe');
    expect(zonePlateHtml({ name: 'Hearthvale', tag: 'Safe', band: '' })).not.toContain('zb');
  });

  it('builds the strip: explored, sources, warden — in plain words', () => {
    const html = zoneStripHtml(zone, (e) => `data:el/${e}`);
    expect(html).toContain(`${HUD_WORDS.explored} <span class="num">42%</span>`);
    expect(html).toContain('data:el/earth');
    expect(html).toContain(HUD_WORDS.warden);
    expect(zoneStripHtml({ ...zone, band: '', sources: [], warden: 'defeated' }, () => '')).toContain(HUD_WORDS.wardenDown);
  });

  it('shows ATK · MATK · DEF and the worn class with its Class Level (never "CR")', () => {
    const worn: WornClassView = { id: 'pyroblade', name: 'Pyroblade', level: 4, maxLevel: 10, progress: 0.5, color: '#d8433f' };
    const html = statsHtml({ atk: 104.4, matk: 61, def: 48 }, worn, 'data:cls', true);
    expect(html).toContain('ATK');
    expect(html).toContain('>104<');
    expect(html).toContain('Pyroblade');
    expect(html).toContain('Class Level 4');
    expect(html).toContain('width:50%');
    expect(html).not.toMatch(/\bCR\b/);
    expect(statsHtml({ atk: 1, matk: 1, def: 1 }, null, '', true)).toContain(HUD_WORDS.noClass);
    expect(statsHtml({ atk: 1, matk: 1, def: 1 }, null, '', false)).not.toContain(HUD_WORDS.noClass);
  });

  it('renders a tracked quest with its count right-aligned and a goal as one line', () => {
    const q: PursuitView = { key: 'quest:jelly', kind: 'quest', title: 'Jelly Trouble', line: 'Defeat Jellops 3/8', progress: 0.375, open: { panel: 'codex', arg: 'quests:jelly' } };
    const html = pursuitHtml(q, 0, '');
    expect(html).toContain('data-i="0"');
    expect(html).toContain('Defeat Jellops');
    expect(html).toContain('<em class="num">3/8</em>');
    expect(html).toContain('width:38%');
    expect(html).toContain('g-quest');
    const ready = pursuitHtml({ ...q, line: 'Return to Brann', ready: true, progress: undefined }, 1, '');
    expect(ready).toContain('pz-row quest ready');
    expect(ready).not.toContain('pz-bar');
    const goal: PursuitView = { key: 'goal:class:pyro', kind: 'goal', title: 'Pyroblade', line: 'Learn 1 more fire skill.', icon: { kind: 'cls', id: 'pyroblade' }, open: { panel: 'classes', arg: 'pyroblade' } };
    const g = pursuitHtml(goal, 2, 'data:cls/pyroblade');
    expect(g).toContain('pz-row goal');
    expect(g).toContain('data:cls/pyroblade');
  });
});

describe('the own-slot picker', () => {
  const view: SlotPickerView = {
    slot: 6,
    current: 'whirlwind',
    choices: [
      { skillId: 'flame_spin', name: 'Flame Spin', fresh: true, slot: null },
      { skillId: 'whirlwind', name: 'Whirlwind', fresh: false, slot: 6 },
      { skillId: 'slash_up', name: 'Rising Slash', fresh: false, slot: 1 },
      { skillId: 'throw', name: 'Sword Throw', fresh: false, slot: 7 },
    ],
  };

  it('lists icons with names newest first, "Empty" first when the slot holds a skill', () => {
    const html = pickerHtml(view, (id) => `data:skill/${id}`, 5);
    expect(html.indexOf('pk-empty')).toBeLessThan(html.indexOf('Flame Spin'));
    expect(html.indexOf('Flame Spin')).toBeLessThan(html.indexOf('Whirlwind'));
    expect(html).toContain('>New<');
    expect(html).toContain('Equipped'); // the slot's own skill
    expect(html).toContain('inclass'); // sits in a class slot: managed by the class
    expect(html).toContain('Slot 8'); // already in another slot of yours: equipping moves it
    expect(pickerHtml({ ...view, current: null }, () => '', 5)).not.toContain('pk-empty');
    expect(pickerHtml({ slot: 6, current: null, choices: [] }, () => '', 5)).toContain('pk-none');
  });

  it('offers your slots when a skill needs a place', () => {
    const own = [slot({ index: 5, key: '6', skillId: 'a', name: 'Alpha' }), slot({ index: 6, key: '7' })];
    const html = slotChooserHtml(own, (id) => `data:skill/${id}`);
    expect(html).toContain('data-slot="5"');
    expect(html).toContain('Alpha');
    expect(html).toContain(HUD_WORDS.empty);
    expect(slotChooserHtml([], () => '')).toContain('pk-none');
  });
});
