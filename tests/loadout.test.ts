// Skill-bar loadout (src/game/loadout.ts, src/game/session.ts; docs/SPEC-v2.md §5.1): 8 slots, class slots 1-5 filled
// by the worn class, your slots 6-8 never touched by it, padded old saves, SkillBook.unwear().
import { afterEach, describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import { gameBus, type BarChangedEvent } from '../src/game/events';
import { classSlotsFor, fillClassSlots, firstEmpty, padBar, placeLearned, refillClassSlots, slotLearned } from '../src/game/loadout';
import { HOTBAR_SIZE, Session } from '../src/game/session';

const reg = createRegistry();
const E = null;

describe('padBar (saves)', () => {
  it('pads an old 6-slot bar to 8, keeping every skill in place', () => {
    expect(HOTBAR_SIZE).toBe(8);
    expect(padBar(['a', null, 'b', null, null, 'c'], 8)).toEqual(['a', E, 'b', E, E, 'c', E, E]);
  });
  it('drops junk and duplicates, and moves overflow into empty slots', () => {
    expect(padBar(['a', 3, 'a', null, '', 'b'], 4)).toEqual(['a', 'b', E, E]);
    expect(padBar(['a', null, 'b', 'c', 'd'], 3)).toEqual(['a', 'c', 'b']);
    expect(padBar(undefined, 3)).toEqual([E, E, E]);
  });
});

describe('fillClassSlots (pure)', () => {
  it('lays the picks out best first into the 5 class slots and leaves your slots alone', () => {
    const bar = ['x', 'y', E, E, E, 'mine', E, E];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3'], { classSlots: 5 });
    expect(r.bar).toEqual(['p1', 'p2', 'p3', E, E, 'mine', E, E]);
    expect(r.dropped).toEqual(['x', 'y']);
    expect(r.changed).toEqual([0, 1, 2]);
    expect(r.added).toEqual(['p1', 'p2', 'p3']);
  });

  it('a pick already in one of your slots stays there; the class takes its next pick', () => {
    const bar = [E, E, E, E, E, 'p2', E, 'p6'];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], { classSlots: 5 });
    expect(r.bar).toEqual(['p1', 'p3', 'p4', 'p5', 'p7', 'p2', E, 'p6']);
  });

  it('stable: picks keep their slot, new picks fill the freed ones', () => {
    const bar = ['old', 'p2', E, 'p1', E, E, E, E];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3'], { classSlots: 5, stable: true });
    expect(r.bar).toEqual(['p3', 'p2', E, 'p1', E, E, E, E]);
    expect(r.changed).toEqual([0]);
  });

  it('rehome: skills pushed out of the class slots move into your empty slots (none lost while room)', () => {
    const bar = ['a', 'b', 'c', 'd', 'e', 'f', E, E];
    const r = fillClassSlots(bar, ['a', 'p1', 'p2', 'p3'], { classSlots: 5, rehome: true });
    expect(r.bar).toEqual(['a', 'p1', 'p2', 'p3', E, 'f', 'b', 'c']);
    expect(r.dropped).toEqual(['d', 'e']);
  });

  it('fewer matches than class slots leave the rest empty; nothing to do changes nothing', () => {
    expect(fillClassSlots([E, E, E, E, E, E, E, E], [], { classSlots: 5 }).changed).toEqual([]);
    const same = fillClassSlots(['p1', E, E, E, E, E, E, E], ['p1'], { classSlots: 5, stable: true });
    expect(same.changed).toEqual([]);
  });
});

describe('placeLearned (pure)', () => {
  const picks = (ids: string[]) => ids;
  it('no class: a new skill drops into the first empty slot of all 8', () => {
    expect(placeLearned(['a', E, E, E, E, E, E, E], 'n', null, 0)).toMatchObject({ slot: 1, reason: 'learned' });
  });
  it('class worn: a skill the class would pick goes into an empty class slot', () => {
    const r = placeLearned(['p1', E, E, E, E, E, E, E], 'n', picks(['n', 'p1']), 5)!;
    expect(r.reason).toBe('classLearned');
    expect(r.bar.slice(0, 2)).toEqual(['p1', 'n']);
  });
  it('class full: it replaces the weakest class skill it beats (the one the class no longer picks)', () => {
    const r = placeLearned(['a', 'b', 'c', 'd', 'weak', E, E, E], 'n', picks(['n', 'a', 'b', 'c', 'd', 'weak']), 5)!;
    expect(r).toMatchObject({ reason: 'classLearned', slot: 4 });
    expect(r.bar).toEqual(['a', 'b', 'c', 'd', 'n', E, E, E]);
  });
  it('a skill the class does not pick drops into your slots, never a class slot', () => {
    const r = placeLearned([E, E, E, E, E, E, E, E], 'n', picks(['p1']), 5)!;
    expect(r).toMatchObject({ reason: 'learned', slot: 5 });
    expect(placeLearned([E, E, E, E, E, 'x', 'y', 'z'], 'n', picks([]), 5)).toBeNull();
    expect(placeLearned(['n', E], 'n', null, 0)).toBeNull();
  });
  it('helpers', () => {
    expect(classSlotsFor(null, 8)).toBe(0);
    expect(classSlotsFor('pyroblade', 8)).toBe(5);
    expect(firstEmpty(['a', E, E], 2)).toBe(2);
    expect(firstEmpty(['a'], 0)).toBe(-1);
  });
});

// ------------------------------------------------------------------ with the real registry and SkillBook

const bars: BarChangedEvent[] = [];
const offBar = gameBus.on('barChanged', (e) => bars.push(e));
afterEach(() => {
  bars.length = 0;
});

function fresh(weapon: 'sword' | 'dagger' | 'staff' = 'sword'): Session {
  const s = Session.create(reg, 'Tester', weapon, 7);
  bars.length = 0;
  return s;
}

describe('Session bar (class auto-equip)', () => {
  it('a fresh character has 8 empty slots; learned skills drop into them (no class: all 8 are yours)', () => {
    const s = fresh();
    expect(s.player.hotbar).toEqual(Array(8).fill(null));
    s.book.learn('whirlwind', 'test');
    expect(s.player.hotbar[0]).toBe('whirlwind');
    expect(bars.at(-1)).toMatchObject({ slots: [0], reason: 'learned', skillId: 'whirlwind' });
    s.book.learn(reg.skill('slash') ? 'slash' : 'whirlwind', 'test'); // basics never take a slot
    expect(s.player.hotbar.filter(Boolean)).toEqual(['whirlwind']);
  });

  it('discovering the first class wears it and fills its class slots; your slots are kept', () => {
    const s = fresh();
    const classes: string[] = [];
    const off = gameBus.on('classChanged', (e) => classes.push(`${e.classId}:${e.reason}`));
    s.book.learn('whirlwind', 'test');
    expect(s.book.state.worn).toBeNull();
    // Something of the player's own in slot 6.
    s.player.hotbar.splice(0, 8, E, E, E, E, E, 'whirlwind', E, E);
    for (const id of ['sword_throw', 'heavy_cleave', 'flame_spin', 'spinning_assault']) s.book.learn(id, 'test');
    off();
    const worn = s.book.state.worn;
    expect(worn).not.toBeNull();
    expect(classes[0]).toBe(`${worn}:discovered`);
    const picks = s.book.classSkills(worn!, 8).filter((id) => id !== 'whirlwind').slice(0, 5);
    expect(s.player.hotbar.slice(0, 5).filter(Boolean).sort()).toEqual([...picks].sort());
    expect(s.player.hotbar[5]).toBe('whirlwind'); // never moved by the class
    expect(new Set(s.player.hotbar.filter(Boolean)).size).toBe(s.player.hotbar.filter(Boolean).length); // no duplicates
  });

  it('becoming another class refills the class slots; unwear keeps them as your slots', () => {
    const s = fresh('staff');
    for (const id of ['arcane_orb', 'arcane_nova', 'firebolt', 'meteor', 'flame_spin', 'whirlwind']) s.book.learn(id, 'test');
    const unlocked = Object.keys(s.book.state.classes);
    expect(unlocked.length).toBeGreaterThan(0);
    const other = unlocked.find((c) => c !== s.book.state.worn);
    if (other) {
      expect(s.book.wear(other).ok).toBe(true);
      bars.length = 0;
      refillClassSlots(s, 'class');
      const picks = s.book.classSkills(other, 8).filter((id) => !s.player.hotbar.slice(5).includes(id)).slice(0, 5);
      expect(s.player.hotbar.slice(0, picks.length)).toEqual(picks);
      if (bars.length) expect(bars[0]).toMatchObject({ reason: 'class', classId: other });
    }
    const before = [...s.player.hotbar];
    expect(s.book.unwear()).toMatchObject({ ok: true });
    expect(s.book.state.worn).toBeNull();
    expect(s.book.unwear()).toMatchObject({ ok: true });
    expect(s.player.hotbar).toEqual(before);
    // With no class, a new skill takes the first empty slot anywhere (slot 2 here).
    s.player.hotbar.splice(0, 8, 'arcane_orb', E, E, E, E, E, E, E);
    s.book.state.skills.sword_throw = { ...s.book.state.skills.arcane_orb, id: 'sword_throw' };
    expect(slotLearned(s, 'sword_throw')).toMatchObject({ slot: 1, reason: 'learned' });
    expect(slotLearned(s, 'sword_throw')).toBeNull(); // already on the bar
  });

  it('a newly learned skill the worn class picks joins the class slots (classLearned)', () => {
    const s = fresh();
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin', 'searing_edge']) if (reg.skill(id)) s.book.learn(id, 'test');
    const worn = s.book.state.worn;
    expect(worn).not.toBeNull();
    bars.length = 0;
    // A tier-2 blade skill: every blade class prefers it over the tier-1 ones.
    s.book.learn('spinning_assault', 'test');
    const picks = s.book.classSkills(s.book.state.worn!, 8);
    expect(picks.slice(0, 5)).toContain('spinning_assault');
    expect(s.player.hotbar.indexOf('spinning_assault')).toBeLessThan(5);
    expect(bars.find((b) => b.skillId === 'spinning_assault')).toMatchObject({ reason: 'classLearned' });
    expect(new Set(s.player.hotbar.filter(Boolean)).size).toBe(s.player.hotbar.filter(Boolean).length);
  });
});

describe('Session save repair', () => {
  it('an old 6-slot save is padded to 8 and the worn class refreshes slots 1-5 without losing skills', () => {
    const s = fresh();
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin']) s.book.learn(id, 'test');
    const worn = s.book.state.worn;
    expect(worn).not.toBeNull();
    // A v2 bar: 6 slots, the player's own order.
    s.player.hotbar.splice(0, 8, 'heavy_cleave', E, 'sword_throw', E, 'whirlwind', 'flame_spin');
    s.player.hotbar.push(...padBar([], 2));
    s.repairBar(6);
    const bar = s.player.hotbar;
    expect(bar.length).toBe(8);
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin']) expect(bar).toContain(id);
    const picks = s.book.classSkills(worn!, 8).filter((id) => !bar.slice(5).includes(id)).slice(0, 5);
    expect(bar.slice(0, 5).filter(Boolean).sort()).toEqual([...picks].sort());
  });

  it('converting a 6-slot bar: a class skill in old slot 6 joins the class slots, a non-class skill moves to yours', () => {
    const s = fresh();
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin', 'quickstep']) s.book.learn(id, 'test');
    const worn = s.book.state.worn!;
    const best = s.book.classSkills(worn, 8).slice(0, 5);
    expect(best).toContain('heavy_cleave');
    expect(best).not.toContain('quickstep');
    s.player.hotbar.splice(0, 8, 'quickstep', E, E, E, E, 'heavy_cleave', E, E);
    s.repairBar(6);
    const bar = s.player.hotbar;
    expect(bar.slice(0, 5).sort()).toEqual([...best].sort()); // no empty class slot beside a class skill in yours
    expect(bar.slice(5)).toEqual(['quickstep', E, E]);
    // A current 8-slot save keeps your slots as they are.
    s.player.hotbar.splice(0, 8, E, E, E, E, E, 'heavy_cleave', E, E);
    s.repairBar(8);
    expect(s.player.hotbar[5]).toBe('heavy_cleave');
    expect(s.player.hotbar.slice(0, 5)).not.toContain('heavy_cleave');
  });

  it('"No class" survives a save and reload (core migration would wear the first class again)', () => {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    try {
      const s = fresh();
      for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin']) s.book.learn(id, 'test');
      expect(s.book.state.worn).not.toBeNull();
      s.book.unwear();
      s.player.hotbar.splice(0, 8, 'flame_spin', E, E, E, E, E, E, 'whirlwind');
      s.save();
      const back = Session.load(reg)!;
      expect(back.book.state.worn).toBeNull();
      expect(back.player.hotbar).toEqual(['flame_spin', E, E, E, E, E, E, 'whirlwind']);
      // A save that wears a class keeps it.
      back.book.wear(Object.keys(back.book.state.classes)[0]);
      back.save();
      expect(Session.load(reg)!.book.state.worn).toBe(back.book.state.worn);
    } finally {
      g.localStorage = had;
    }
  });

  it('skills the book no longer knows leave the bar on load', () => {
    const s = fresh();
    s.player.hotbar[6] = 'not_a_skill';
    s.repairBar(8);
    expect(s.player.hotbar[6]).toBeNull();
  });
});

describe('SkillBook.unwear', () => {
  it('takes the class off, invalidates caches and re-evaluates classes', () => {
    const b = new SkillBook(reg);
    for (const id of ['whirlwind', 'sword_throw', 'heavy_cleave', 'flame_spin']) b.learn(id, 'test');
    const worn = b.state.worn!;
    expect(worn).toBeTruthy();
    const withClass = b.activeBonus();
    expect(b.unwear()).toEqual({ ok: true, message: `You set ${reg.classDef(worn)!.name} aside.` });
    expect(b.state.worn).toBeNull();
    expect(b.state.classes[worn]).toBeDefined(); // still unlocked
    expect(b.activeBonus()).not.toEqual(withClass); // cache dropped: the class bonus is gone
    expect(b.wear(worn).ok).toBe(true);
    expect(b.state.worn).toBe(worn);
  });
});

afterEach(() => void offBar);
