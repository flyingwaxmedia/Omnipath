// HUD v4 pure helpers (docs/SPEC-v4.md §11.7: HUD diet, one mechanic widget, the weapon lock line) — on top of the
// HUD v3 pure helpers (HUD lane): layout maths and HTML builders (docs/CLIENT-v3.md §2, docs/UX-SIMPLE.md).
import { describe, expect, it } from 'vitest';
import { becomeSwapLine, classRewards, kitRows, nextRewardLine, weaponLock } from '../src/ui/classinfo';
import type { BarSlotView, PursuitView, SlotPickerView, ZoneView } from '../src/ui/controller';
import { GAME_DATA, createRegistry } from '../src/data';
import { LOG_QUIET_MS, TEXT_MIN_PX, textPixel } from '../src/ui/hud';
// @ts-expect-error node's own types are not in this project's tsconfig (vitest runs in node: the stylesheet as text)
import { readFileSync } from 'node:fs';
import hudSource from '../src/ui/hud.ts?raw';
import { asMechView, mechanicHint, mechanicHtml, mechanicLabel, type MechWidgetView } from '../src/ui/hud/mechanic';
import {
  HUD_WORDS,
  digits,
  pickerHtml,
  pursuitHtml,
  pursuitLineHtml,
  slotChooserHtml,
  slotHtml,
  weaponGlyph,
  zonePlateHtml,
  type HudArt,
} from '../src/ui/hud/html';
import {
  PURSUIT_ROWS,
  barLeft,
  barPlan,
  barRows,
  barWidth,
  crossesMiddle,
  freeSpan,
  placeZone,
  cooldownText,
  countText,
  expPercent,
  fitSnap,
  hudFits,
  hudLayoutClasses,
  hudScale,
  placeCentred,
  rowsThatFit,
  splitCount,
} from '../src/ui/hud/layout';
import { pixelScale } from '../src/game/render/pixelscale';

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

  it('splits a two-row bar by group (5 class slots, then your 3) when it fits, never under the touch floor', () => {
    // iPad portrait (1.5 CSS px per art px): 5 × 72 px slots fit left of the cluster.
    expect(barPlan({ n: 8, classSlots: 5, twoRows: true, room: 517, slot: 72, minSlot: 66, gap: 6, unit: 1.5 })).toEqual({ rows: [5, 3], slot: 72, split: true, ownCol: 2 });
    // 390 px phone: the slots shrink from 48 to 44 to fit.
    const phone = barPlan({ n: 8, classSlots: 5, twoRows: true, room: 237, slot: 48, minSlot: 44, gap: 4, unit: 1 });
    expect(phone.rows).toEqual([5, 3]);
    expect(phone.slot).toBe(44);
    // 360 px phone: 44 does not fit → two even rows at full size.
    expect(barPlan({ n: 8, classSlots: 5, twoRows: true, room: 207, slot: 48, minSlot: 44, gap: 4, unit: 1 })).toEqual({ rows: [4, 4], slot: 48, split: false, ownCol: 0 });
    // No class (every slot yours) or one row: as before.
    expect(barPlan({ n: 8, classSlots: 0, twoRows: true, room: 999, slot: 48, minSlot: 44, gap: 4 }).rows).toEqual([4, 4]);
    expect(barPlan({ n: 8, classSlots: 5, twoRows: false, room: 999, slot: 48, minSlot: 44, gap: 4 }).rows).toEqual([8]);
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

  it('tints the icon ground by element and never names the groups over the bar (fewer floating labels)', () => {
    const v = slotHtml(slot({ skillId: 'ember_dart', name: 'Ember Dart', rank: 1, maxRank: 10, element: 'fire' }), art, { auto: false, elementColor: '#e8604e' });
    expect(v).toContain('--el:#e8604e');
    expect(v).toContain(' tint');
    expect(slotHtml(slot({}), art, { auto: false, elementColor: '#e8604e' })).not.toContain('--el'); // empty slots stay plain
  });

  it('a skill that needs another weapon: dimmed, wearing that weapon, "Needs a sword — Equip" as its name', () => {
    const v = slotHtml(slot({ skillId: 'whirlwind', name: 'Whirlwind', rank: 3, maxRank: 10 }), art, { auto: false, lock: { need: 'sword', line: 'Needs a sword', owned: true } });
    expect(v).toContain('wlocked');
    expect(v).toContain('data-need="sword"');
    expect(v).toContain('aria-label="Whirlwind: Needs a sword — Equip"');
    expect(v).toContain('class="wlock can"');
    expect(v).toContain('<svg class="wi ');
    // Not owned: the line alone (no Equip to offer).
    const no = slotHtml(slot({ skillId: 'knife_fan', name: 'Knife Fan' }), art, { auto: false, lock: { need: 'dagger', line: 'Needs a dagger', owned: false } });
    expect(no).toContain('aria-label="Knife Fan: Needs a dagger"');
    expect(no).toContain('class="wlock"');
    for (const w of ['sword', 'dagger', 'staff', 'fists']) expect(weaponGlyph(w)).toContain('<path');
    expect(weaponGlyph('spoon')).toBe('');
  });
});

describe('zone plate and the tracker (HUD diet)', () => {
  const zone: ZoneView = { name: 'Greenmeadow', tag: 'Hunting', band: 'Lv 1–3', explored: 42.4, sources: ['earth'], warden: 'alive' };

  it('builds the zone plate with the name in <b>, the safety pill and the level band', () => {
    const html = zonePlateHtml(zone);
    expect(html).toMatch(/<b class="zn">Greenmeadow<\/b>/);
    expect(html).toContain('class="zt hunt"');
    expect(html).toContain('Lv <span class="num">1–3</span>');
    expect(zonePlateHtml({ name: 'Hearthvale', tag: 'Safe', band: '' })).toContain('zt safe');
    expect(zonePlateHtml({ name: 'Hearthvale', tag: 'Safe', band: '' })).not.toContain('zb');
  });

  it('draws the name in the display face on arrival (an image) and keeps the plain name for the small tag', () => {
    const html = zonePlateHtml(zone, { url: 'data:title', w: 96, h: 21 });
    expect(html).toContain('class="zn-d" src="data:title"');
    expect(html).toContain('--w:96;--h:21');
    expect(html).toMatch(/<b class="zn">Greenmeadow<\/b>/);
    // The stat strip and the "Explored %" strip left the HUD (they live in the Class screen and the Map).
    expect(html).not.toMatch(/Explored|ATK|MATK/);
    expect(zonePlateHtml(zone, null)).not.toContain('zn-d');
  });

  it('collapses the tracker to ONE line: the first next step, its count, and "+N" for the rest', () => {
    const a: PursuitView = { key: 'quest:jelly', kind: 'quest', title: 'Jelly Trouble', line: 'Defeat Jellops 3/8', open: { panel: 'codex' } };
    const b: PursuitView = { key: 'goal:x', kind: 'goal', title: 'Pyroblade', line: 'Know Fire.', open: { panel: 'classes' } };
    const one = pursuitLineHtml([a, b, b]);
    expect(one).toContain('Defeat Jellops');
    expect(one).toContain('<em class="num">3/8</em>');
    expect(one).toContain('+2');
    expect(one).not.toContain('Jelly Trouble'); // one line: the step, not a card
    expect(pursuitLineHtml([a])).not.toContain('pz-rest');
    expect(pursuitLineHtml([])).toBe('');
  });

  it('renders a tracked quest with its count right-aligned and a goal as one line', () => {
    const q: PursuitView = { key: 'quest:jelly', kind: 'quest', title: 'Jelly Trouble', line: 'Defeat Jellops 3/8', progress: 0.375, open: { panel: 'codex', arg: 'quests:jelly' } };
    const html = pursuitHtml(q, 0, '');
    expect(html).toContain('data-i="0"');
    expect(html).toContain('Defeat Jellops');
    expect(html).toContain('<em class="num">3/8</em>');
    expect(html).toContain('width:38%');
    // The NPC marker set (docs/UX-SIMPLE.md rule 10): '…' in progress, '?' ready; '!' (new quest) never in the tracker.
    expect(html).not.toContain('g-quest');
    expect(html).toContain('>…<');
    const ready = pursuitHtml({ ...q, line: 'Return to Brann', ready: true, progress: undefined }, 1, '');
    expect(ready).toContain('pz-row quest ready');
    expect(ready).not.toContain('pz-bar');
    expect(ready).toContain('>?<');
    const art = pursuitHtml(q, 0, '', { url: 'data:mark/busy', w: 15, h: 12 });
    expect(art).toContain('class="qm" src="data:mark/busy"');
    expect(art).toContain('--w:15;--h:12');
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
    expect(html).toContain('Slot 8'); // already in another slot of yours: equipping moves it
    // A skill in a class slot is no choice: not a tile, only dimmed in the "Already in your class slots" row.
    expect(html).not.toContain('data-skill="slash_up"');
    expect(html).toContain('Already in your class slots');
    expect(html).toContain('class="inclass"');
    expect(pickerHtml({ ...view, current: null }, () => '', 5)).not.toContain('pk-empty');
    expect(pickerHtml({ slot: 6, current: null, choices: [] }, () => '', 5)).toContain('pk-none');
  });

  it('says what to do when nothing can go in the slot: one line, one button to the quests', () => {
    const allInClass: SlotPickerView = { slot: 6, current: null, choices: [{ skillId: 'slash_up', name: 'Rising Slash', fresh: false, slot: 1 }] };
    const html = pickerHtml(allInClass, (id) => `data:skill/${id}`, 5);
    expect(html).toContain('Learn a new skill to fill this slot.');
    expect(html).toContain('pk-quests');
    expect(html).not.toContain('pk-grid');
    expect(html).toContain('Already in your class slots');
    expect(pickerHtml({ slot: 6, current: null, choices: [] }, () => '', 5)).toContain('pk-quests');
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

describe('HUD pixel size (the HUD draws its art pixels the size of the world\'s)', () => {
  /** The HUD scale for a screen, with the world's k from the render lane's pixelScale. */
  const at = (w: number, h: number, dpr: number) => hudScale(w, h, dpr, pixelScale(w, h, dpr).k);

  it('matches the world: 1 HUD art px = k device px on phones, iPads and desktops', () => {
    for (const [w, h, dpr] of [
      [390, 844, 3],
      [844, 390, 3],
      [1180, 820, 2],
      [820, 1180, 2],
      [1440, 900, 1],
      [1920, 1080, 1],
      [744, 1133, 2],
    ] as const) {
      const k = pixelScale(w, h, dpr).k;
      const s = at(w, h, dpr);
      expect(s.n, `${w}x${h}@${dpr}`).toBe(k);
      expect(s.px).toBeCloseTo(k / dpr, 9);
      expect(s.fits).toBe(true);
    }
    expect(at(1180, 820, 2).px).toBe(1.5); // the owner's iPad
    expect(at(1440, 900, 1).px).toBe(2);
    expect(at(390, 844, 3).px).toBe(1);
  });

  it('is always a whole number of device px and at least 1 CSS px (44-art-px buttons stay ≥ 44 CSS px)', () => {
    for (const [w, h] of [
      [360, 740],
      [412, 915],
      [280, 653],
      [1024, 600],
      [2560, 1440],
    ] as const)
      for (const dpr of [1, 1.25, 1.5, 2, 2.625, 3]) {
        const s = at(w, h, dpr);
        expect(Number.isInteger(s.n), `${w}x${h}@${dpr}`).toBe(true);
        expect(s.px * dpr).toBeCloseTo(s.n, 9);
        expect(s.px).toBeGreaterThanOrEqual(1 - 1e-9);
      }
  });

  it('steps down to the largest whole-device-pixel scale whose layout fits', () => {
    // k = 3 at DPR 2 would leave a 300 × 400 art-px screen (too small): 1 CSS px (2 device px) fits.
    const s = hudScale(450, 600, 2, 3);
    expect(s.n).toBe(2);
    expect(s.px).toBe(1);
    expect(hudFits(s.w, s.h)).toBe(true);
    // Nothing ≥ 1 CSS px fits (a folded phone): the smallest crisp scale ≥ 1 CSS px, flagged.
    const f = hudScale(280, 653, 3, 2);
    expect(f.px).toBe(1);
    expect(f.fits).toBe(false);
    // DPR 2.625 (Android): k = 2 would be < 1 CSS px — 3 device px (8/7 CSS px) instead.
    expect(hudScale(412, 915, 2.625, 2).n).toBe(3);
  });

  it('measures the screen-size variants in art px, like the old CSS-px media queries', () => {
    expect(hudLayoutClasses(390, 844)).toEqual({ port: true, narrow: false, short: false, big: false });
    expect(hudLayoutClasses(360, 740)).toEqual({ port: true, narrow: true, short: false, big: false });
    expect(hudLayoutClasses(844, 390)).toEqual({ port: false, narrow: false, short: true, big: false });
    // The iPad at 1.5 CSS px per art px: 787 × 547 art px landscape (the base sizes), 547 × 787 portrait.
    expect(hudLayoutClasses(1180 / 1.5, 820 / 1.5)).toEqual({ port: false, narrow: false, short: false, big: false });
    expect(hudLayoutClasses(820 / 1.5, 1180 / 1.5).port).toBe(true);
    expect(hudLayoutClasses(1440, 900).big).toBe(true);
  });
});

describe('HUD placement keeps the field clear', () => {
  const R = (left: number, top: number, w: number, h: number) => ({ left, top, right: left + w, bottom: top + h });

  it('finds the free span of a band between the blocks on either side', () => {
    expect(freeSpan([R(0, 0, 200, 100), R(800, 50, 200, 100), R(300, 500, 100, 100)], 60, 120, 1000, 6, 8)).toEqual({ lo: 208, hi: 792 });
    expect(freeSpan([R(0, 0, 200, 40)], 60, 120, 1000, 6, 8)).toEqual({ lo: 6, hi: 994 });
  });

  // Phone portrait 390 × 844 at 1 CSS px per art px (measured in the browser).
  const phone = {
    W: 390, m: 6, u: 1, zh: 44, below: 0, portrait: true,
    plate: R(51, 10, 132, 63), me: R(6, 10, 201, 103), stats: R(64, 75, 143, 38), menu: R(199, 6, 185, 92),
    minimap: R(296, 104, 88, 88), pursuits: R(136, 198, 248, 102), quick: R(6, 371, 46, 170),
  };

  it('portrait: the zone plate stays in the top band beside the minimap, never under the Pursuits', () => {
    const p = placeZone({ ...phone, zw: 150, zwCompact: 120 });
    expect(p.top).toBeLessThan(phone.pursuits.top);
    expect(p.x + 150).toBeLessThanOrEqual(phone.minimap.left);
    // A name too long for the band: compact, then capped — still in the band.
    const long = placeZone({ ...phone, zw: 400, zwCompact: 360 });
    expect(long.top).toBeLessThan(phone.pursuits.top);
    expect(long.compact).toBe(true);
    expect(long.maxW).toBeLessThanOrEqual(phone.minimap.left - long.x);
  });

  it('iPad landscape: a long place name takes the row under the buttons, not a spot down in the field', () => {
    const ipad = {
      W: 1180, m: 9, u: 1.5, zh: 79, below: 72, portrait: false,
      plate: R(78, 15, 246, 98), me: R(9, 15, 315, 158), stats: R(99, 116, 225, 57), menu: R(682, 9, 489, 66),
      minimap: R(1033, 84, 138, 138), pursuits: R(835, 231, 336, 151), quick: R(9, 150, 69, 255),
    };
    expect(placeZone({ ...ipad, zw: 223, zwCompact: 180 }).top).toBe(9); // fits beside the buttons
    const long = placeZone({ ...ipad, zw: 420, zwCompact: 340 });
    expect(long.top).toBe(ipad.menu.bottom + 6 * 1.5);
    expect(long.x).toBeGreaterThanOrEqual(ipad.stats.right);
    expect(long.x + 420).toBeLessThanOrEqual(ipad.minimap.left);
  });

  it('names the boxes crossing the middle band (40–60 % of the height)', () => {
    expect(crossesMiddle({ pursuits: R(136, 198, 248, 102), zone: R(121, 104, 149, 44) }, 844)).toEqual([]);
    expect(crossesMiddle({ pursuits: R(136, 198, 248, 200), zone: R(88, 402, 213, 49) }, 844)).toEqual(['pursuits', 'zone']);
    expect(PURSUIT_ROWS).toBe(2);
  });
});

describe('HUD diet defaults (docs/SPEC-v4.md §11.7)', () => {
  const src: string = hudSource;
  const css: string = readFileSync(new URL('../src/ui/styles/hud.css', import.meta.url), 'utf8');

  it('no stat strip, no "Explored" strip, no tip banner and no group labels in the HUD markup', () => {
    for (const gone of ['me-stats', 'zone-strip', 'class="grps"', 'tip-banner', 'Explored']) expect(src).not.toContain(gone);
  });

  it('exactly one mechanic widget dock, above the slots', () => {
    expect(src.match(/class="mech-dock"/g)).toHaveLength(1);
    expect(src.indexOf('class="mech-dock"')).toBeLessThan(src.indexOf('class="slots"'));
  });

  it('the tracker starts collapsed and the log fades 4 s after its last line', () => {
    expect(LOG_QUIET_MS).toBe(4000);
    expect(src).toMatch(/pursuitsOpen\(\): boolean \{[^}]*return false;/s);
  });

  it('one body face and three text sizes; frames in three weights', () => {
    const hud = css.slice(0, css.indexOf('\n.sheet.hud-sheet'));
    // Every HUD font-size is a token (--fs-s / --fs-m and their aliases), never a loose number.
    const sizes = [...hud.matchAll(/font-size:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => !/^var\(--fs[\w-]*\)$/.test(v) && v !== 'inherit');
    expect(sizes.filter((v) => !/var\(--glyph\)/.test(v))).toEqual([]);
    expect([...hud.matchAll(/font-family:\s*([^;]+);/g)].map((m) => m[1].trim()).filter((v) => v !== 'var(--font-body)' && v !== 'inherit')).toEqual([]);
    expect(hud).toContain('--ui-frame-light');
    expect(hud).toContain('--ui-strip');
    // Read-only plates wear no gold frame.
    expect(hud).not.toMatch(/\.me-plate[^{]*\{[^}]*--ui-frame-plate/);
  });

  it('body text sits on whole device pixels and never under TEXT_MIN_PX CSS px per font pixel', () => {
    expect(textPixel(2, 2)).toBe(2); // the HUD's own pixel where it reads well
    expect(textPixel(1.5, 2)).toBe(2); // iPad at 3 device px per art px: 4 device px
    expect(textPixel(1, 3)).toBeCloseTo(5 / 3); // phone: 5 device px
    for (const [px, dpr] of [[1, 1], [1, 2], [1, 3], [1.5, 2], [2, 2], [3, 1], [2 / 3, 3]] as const) {
      const t = textPixel(px, dpr);
      expect(Math.abs(t * dpr - Math.round(t * dpr))).toBeLessThan(1e-9);
      expect(t).toBeGreaterThanOrEqual(TEXT_MIN_PX - 1e-9);
    }
  });
});

describe('the class mechanic widget', () => {
  const base: MechWidgetView = { kind: 'gauge', name: 'Heat', widget: 'bar', value: 3, max: 10, ready: false };

  it('one look per kind, labelled only by the mechanic\'s own name', () => {
    const gauge = mechanicHtml(base, '#d8433f');
    expect(gauge).toContain('mech mech-gauge');
    expect(gauge).toContain('width:30%');
    expect(gauge).toContain('<b class="mech-n">Heat</b>');
    expect(gauge).toContain('aria-label="Heat 3 of 10"');
    const combo = mechanicHtml({ kind: 'combo', name: 'Flow', widget: 'pips', value: 2, max: 3, ready: true });
    expect(combo).toContain('mech-combo ready');
    expect(combo.match(/<i class="on">/g)).toHaveLength(2);
    expect(combo.match(/<i class="/g)).toHaveLength(3);
    const marks = mechanicHtml({ kind: 'marks', name: 'Pinned Shadow', widget: 'pips', value: 1, max: 5, ready: false });
    expect(marks).toContain('mech-pips marks');
    expect(marks).toContain('<em class="num">1</em>');
    const zone = mechanicHtml({ kind: 'zone', name: 'Hearths', widget: 'count', value: 2, max: 3, ready: false });
    expect(zone).toContain('mech-cells');
    expect(zone.match(/<i class="on">/g)).toHaveLength(2);
    const stance = mechanicHtml({ kind: 'stance', name: 'Ebb', widget: 'sides', value: 0, max: 1, ready: false, stance: 0, names: ['Ebb', 'Flow'], tap: true });
    expect(stance.startsWith('<button class="mech mech-stance tap"')).toBe(true);
    expect(stance).toContain('Flow'); // the side you would switch to
    // No other label: no "gauge", "combo", "mechanic", "stacks".
    for (const h of [gauge, combo, marks, zone, stance]) expect(h).not.toMatch(/gauge<|combo<|mechanic|stacks|meter</i);
    // Every kind has its own shape.
    expect(new Set([gauge, combo, marks, zone, stance].map((h) => /mech-(bar|pips marks|pips|cells|sides)/.exec(h)?.[1])).size).toBe(5);
  });

  it('an open-ended gauge shows its number; values are clamped; names are escaped', () => {
    expect(mechanicHtml({ ...base, max: null, value: 14 })).toContain('<em class="num">14</em>');
    expect(mechanicHtml({ ...base, value: 99 })).toContain('width:100%');
    expect(mechanicHtml({ ...base, name: '<b>x' })).toContain('&lt;b&gt;x');
    expect(mechanicLabel({ ...base, ready: true })).toBe('Heat 3 of 10, ready');
  });

  it('hides for anything that is not a mechanic view (older controllers, no class)', () => {
    expect(asMechView(null)).toBeNull();
    expect(asMechView({ kind: 'form', name: 'Dragon' })).toBeNull();
    expect(asMechView({ kind: 'gauge' })).toBeNull();
    expect(asMechView({ kind: 'gauge', name: 'Heat', widget: 'bar', value: 2, max: 10, ready: true })).toEqual({ ...base, value: 2, ready: true });
    expect(asMechView({ kind: 'combo', name: 'Flow', value: 1, max: 2 })?.widget).toBe('pips');
  });

  it('has a one-line first-time hint for every kind', () => {
    for (const kind of ['gauge', 'combo', 'marks', 'stance', 'zone'] as const) {
      const hint = mechanicHint({ ...base, kind }).replace(/<[^>]+>/g, '');
      expect(hint.length).toBeLessThanOrEqual(70);
      expect(hint).toContain('Heat');
    }
    expect(mechanicHint({ ...base, hint: 'Hits build Heat.' })).toBe('Hits build Heat.');
  });
});

describe('weapon lock and class rewards (docs/SPEC-v4.md §2.2, §3.4)', () => {
  const reg = createRegistry();
  const bound = GAME_DATA.skills.find((s) => s.weapons?.length === 1 && s.weapons[0] === 'sword' && s.tier > 0);

  it('a weapon-bound skill shows "Needs a sword" with another weapon in hand, and nothing with the sword', () => {
    expect(bound).toBeDefined();
    const lock = weaponLock(reg, bound!.id, { weapon: 'staff', ownedWeapons: ['staff', 'sword'] });
    expect(lock).toEqual({ need: 'sword', line: 'Needs a sword', owned: true });
    expect(weaponLock(reg, bound!.id, { weapon: 'staff', ownedWeapons: ['staff'] })?.owned).toBe(false);
    expect(weaponLock(reg, bound!.id, { weapon: 'sword', ownedWeapons: ['sword'] })).toBeNull();
  });

  it('a free skill is never locked; Bare Hands are always owned', () => {
    const free = GAME_DATA.skills.find((s) => !s.weapons && s.tier > 0)!;
    expect(weaponLock(reg, free.id, { weapon: 'fists', ownedWeapons: [] })).toBeNull();
    const fist = GAME_DATA.skills.find((s) => s.weapons?.length === 1 && s.weapons[0] === 'fists');
    if (fist) expect(weaponLock(reg, fist.id, { weapon: 'sword', ownedWeapons: ['sword'] })).toEqual({ need: 'fists', line: 'Needs bare hands', owned: true });
  });

  it('Become says in one short line when it also swaps the weapon', () => {
    const me = { weapon: 'sword' as const, ownedWeapons: ['sword' as const, 'dagger' as const] };
    expect(becomeSwapLine({ weapon: 'sword' }, me)).toBeNull();
    expect(becomeSwapLine({ weapon: 'any' }, me)).toBeNull();
    expect(becomeSwapLine({}, me)).toBeNull();
    expect(becomeSwapLine({ weapon: 'dagger' }, me)).toEqual({ line: 'Also equips your Rogue Dagger.', missing: false });
    expect(becomeSwapLine({ weapon: 'fists' }, me)).toEqual({ line: 'Also puts your weapon away.', missing: false });
    expect(becomeSwapLine({ weapon: 'staff' }, me)?.missing).toBe(true);
    expect(becomeSwapLine({ weapon: 'staff' }, me)?.line).not.toMatch(/staff/i); // a Rod, never a "staff"
  });

  it('Class Levels give fixed rewards: one "next" line, and the five class skills with their levels', () => {
    for (const cls of reg.classes) {
      const rewards = classRewards(reg, cls);
      expect(rewards.at(-1)?.level).toBe(10);
      for (const r of rewards) expect(r.text).not.toMatch(/perk|point|node|tree/i);
      expect(nextRewardLine(reg, cls, 10)).toBeNull();
      expect(nextRewardLine(reg, cls, 1)).toMatch(/^Class Level \d+ — /);
      const kit = kitRows(reg, cls, 1);
      if (cls.kit) {
        expect(kit.map((k) => k.at)).toEqual([1, 1, 2, 4, 6]);
        expect(kit.filter((k) => k.open)).toHaveLength(2);
        expect(kitRows(reg, cls, 6).every((k) => k.open)).toBe(true);
        expect(kit.every((k) => k.name)).toBe(true);
      } else expect(kit).toEqual([]);
    }
  });
});
