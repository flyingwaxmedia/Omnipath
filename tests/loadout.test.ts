// Skill-bar loadout (src/game/loadout.ts, src/game/session.ts; docs/SPEC-v2.md §5.1, docs/SPEC-v4.md §3.4, §13):
// 8 slots, class slots 1-5 filled by the worn class; becoming a class pulls its picks out of your slots 6-8 (freeing
// them), refreshes never touch them; learning a related skill fills an empty class slot. v4: a kit class lays its
// slots out in classSkills() order (kit skill i in slot i, fills where a kit skill is not known yet), a kit skill
// never loses its slot to a fill, class-only skills never sit in your slots; saves load from v3, v2 or v1.
// The Session tests run on the fixture registry (tests/fixtures/game-v4.ts): real content + temporary kit classes.
import { afterEach, describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { fixtureRegistry } from './fixtures/game-v4';
import SAVE_V2_LATE from './fixtures/save-v2-late.json';
import { gameBus, type BarChangedEvent } from '../src/game/events';
import { barEligible } from '../src/core/classes';
import {
  backfillOwn,
  becomeRefill,
  classBeats,
  classSlotsFor,
  fillClassSlots,
  firstEmpty,
  kitFixed,
  ownOk,
  padBar,
  placeLearned,
  preferFirst,
  purgeOwn,
  refillClassSlots,
  slotLearned,
  spareSkills,
} from '../src/game/loadout';
import { HOTBAR_SIZE, SAVE_KEY, SAVE_KEY_V1, SAVE_KEY_V2, Session } from '../src/game/session';

const reg = fixtureRegistry();
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

  it('becoming a class: a pick in one of your slots moves into the class slots and frees yours; others stay', () => {
    const bar = [E, E, E, E, E, 'p2', 'mine', 'p6'];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], { classSlots: 5 });
    // p2 is one of the class's five: it moves (no duplicate, nothing lost). p6 is a spare pick: it stays yours.
    expect(r.bar).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', E, 'mine', 'p6']);
    expect(r.pulled).toEqual(['p2']);
    expect(r.changed).toEqual([0, 1, 2, 3, 4, 5]);
    expect(new Set(r.bar.filter(Boolean)).size).toBe(r.bar.filter(Boolean).length);
  });

  it('becoming from "no class" (rehome): your old front picks take the freed and empty slots of yours', () => {
    const bar = ['a', 'b', 'c', 'd', 'e', 'p2', E, 'x'];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3', 'p4', 'p5'], { classSlots: 5, rehome: true });
    expect(r.bar).toEqual(['p1', 'p2', 'p3', 'p4', 'p5', 'a', 'b', 'x']);
    expect(r.pulled).toEqual(['p2']);
    expect(r.dropped).toEqual(['c', 'd', 'e']);
  });

  it('a refresh (stable): a pick in one of your slots stays there; the class takes its next pick', () => {
    const bar = [E, E, E, E, E, 'p2', E, 'p6'];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], { classSlots: 5, stable: true });
    expect(r.bar).toEqual(['p1', 'p3', 'p4', 'p5', 'p7', 'p2', E, 'p6']);
    expect(r.pulled).toEqual([]);
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

  it('stable: a filled class slot keeps its skill wherever it ranks (an edit of your slot never swaps one)', () => {
    // p5 just left your slot 8 (you put "mine" there): the class keeps p6 instead of swapping it for p5.
    const bar = ['p1', 'p2', 'p3', 'p6', 'p4', E, E, 'mine'];
    const r = fillClassSlots(bar, ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'p7'], { classSlots: 5, stable: true });
    expect(r.changed).toEqual([]);
    expect(r.bar).toEqual(bar);
    // Only an EMPTY class slot takes a pick: the best one that is not on the bar.
    const gap = fillClassSlots(['p1', E, 'p3', 'p6', 'p4', 'p2', E, E], ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'], { classSlots: 5, stable: true });
    expect(gap.bar).toEqual(['p1', 'p5', 'p3', 'p6', 'p4', 'p2', E, E]);
    expect(gap.changed).toEqual([1]);
  });

  it('quest skills: picked ahead of the class\'s other picks (become and refresh)', () => {
    expect(preferFirst(['a', 'b', 'c', 'd'], 2, new Set(['d']))).toEqual(['a', 'd', 'b', 'c']);
    expect(preferFirst(['a', 'b'], 2, new Set())).toEqual(['a', 'b']);
    const become = fillClassSlots(Array(8).fill(E), ['p1', 'p2', 'p3', 'p4', 'p5', 'p6', 'quest'], { classSlots: 5, prefer: new Set(['quest']) });
    expect(become.bar.slice(0, 5)).toEqual(['p1', 'p2', 'p3', 'p4', 'quest']);
    const refresh = fillClassSlots(['p1', E, E, E, E, E, E, E], ['p1', 'p2', 'p3', 'quest'], { classSlots: 2, stable: true, prefer: new Set(['quest']) });
    expect(refresh.bar.slice(0, 2)).toEqual(['p1', 'quest']);
  });

  it('backfillOwn: your empty slots take spare skills in order, never a class slot, never a duplicate', () => {
    expect(backfillOwn(['a', E, E, 'b', E], 2, ['b', 'c', 'c', 'd', 'e'])).toEqual(['a', E, 'c', 'b', 'd']);
    expect(backfillOwn(['a', E, 'x'], 2, [])).toEqual(['a', E, 'x']);
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
    expect(r.bar).toEqual(['a', 'b', 'c', 'd', 'n', 'weak', E, E]); // the replaced skill moves into your empty slot
  });
  it('class full: with a "clearly better" test, only a clearly better skill replaces the weakest', () => {
    const bar = ['a', 'b', 'c', 'd', 'weak', E, E, E];
    const order = ['n', 'a', 'b', 'c', 'd', 'weak'];
    const no = placeLearned(bar, 'n', order, 5, () => false)!;
    expect(no).toMatchObject({ reason: 'learned', slot: 5 }); // ranked higher, but not clearly better: yours
    expect(no.bar.slice(0, 5)).toEqual(['a', 'b', 'c', 'd', 'weak']);
    const seen: string[] = [];
    const yes = placeLearned(bar, 'n', order, 5, (x, y) => (seen.push(`${x}>${y}`), true))!;
    expect(yes).toMatchObject({ reason: 'classLearned', slot: 4, changed: [4, 5] });
    expect(seen).toEqual(['n>weak']); // compared with the weakest class skill only
  });
  it('an empty class slot takes any skill the class picks, better or not', () => {
    const r = placeLearned(['a', 'b', E, E, E, E, E, E], 'n', ['a', 'b', 'n'], 5, () => false)!;
    expect(r).toMatchObject({ reason: 'classLearned', slot: 2 });
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

describe('fillClassSlots: kit slots (v4)', () => {
  const picks = ['k1', 'k2', 'f1', 'f2', 'f3', 'f4'];
  const fixed = ['k1', 'k2', E, E, E];
  it('becoming: kit skills take their own slots in kit order, fills take the rest best first', () => {
    const r = fillClassSlots([E, E, E, E, E, E, E, E], picks, { classSlots: 5, fixed });
    expect(r.bar).toEqual(['k1', 'k2', 'f1', 'f2', 'f3', E, E, E]);
  });
  it('a kit skill not known yet leaves its slot to a fill; once known it takes the slot back and the fill moves out', () => {
    // kit skill 3 (k3) is not known: slot 3 holds the fill f1.
    const before = ['k1', 'k2', 'f1', 'f2', 'f3', E, E, E];
    const r = fillClassSlots(before, ['k1', 'k2', 'k3', 'f1', 'f2', 'f3'], { classSlots: 5, stable: true, rehome: true, fixed: ['k1', 'k2', 'k3', E, E] });
    expect(r.bar.slice(0, 5)).toEqual(['k1', 'k2', 'k3', 'f2', 'f3']);
    expect(r.bar[5]).toBe('f1'); // nothing lost while there is room
    expect(r.added).toEqual(['k3']);
  });
  it('a kit skill never loses its slot to a fill, whatever the fill ranks (quest skills included)', () => {
    const r = fillClassSlots(['k1', 'k2', 'f1', E, E, E, E, E], ['f9', ...picks], { classSlots: 5, stable: true, fixed, prefer: new Set(['f9']) });
    expect(r.bar.slice(0, 2)).toEqual(['k1', 'k2']);
    expect(r.bar.slice(0, 5)).toContain('f9');
    const b = fillClassSlots([E, E, E, E, E, E, E, E], ['f9', ...picks], { classSlots: 5, fixed, prefer: new Set(['f9', 'f4']) });
    expect(b.bar.slice(0, 2)).toEqual(['k1', 'k2']);
    expect(b.bar.slice(2, 5).sort()).toEqual(['f1', 'f4', 'f9']);
  });
  it('a refresh puts a kit skill found in the wrong slot (or in one of yours) back where it belongs', () => {
    const r = fillClassSlots(['k2', 'f1', E, E, E, 'k1', E, E], picks, { classSlots: 5, stable: true, fixed });
    expect(r.bar.slice(0, 2)).toEqual(['k1', 'k2']);
    expect(r.bar[5]).toBeNull();
    expect(r.pulled).toEqual(['k1']);
    // The fill that stood in slot 2 is no longer on the bar unless rehomed: it comes back as a fill.
    expect(r.bar.slice(0, 5)).toContain('f1');
  });
  it('rehome respects ownOk: a class-only skill pushed out never lands in your slots', () => {
    const r = fillClassSlots(['old1', 'old2', E, E, E, E, E, E], picks, { classSlots: 5, rehome: true, fixed, ownOk: (id) => id !== 'old1' });
    expect(r.bar.slice(5)).toEqual(['old2', E, E]);
    expect(r.dropped).toEqual(['old1']);
  });
  it('purgeOwn empties only your slots that hold something that may not sit there', () => {
    expect(purgeOwn(['c1', 'c2', E, 'c1x', 'own', 'c3'], 3, (id) => !id.startsWith('c'))).toEqual(['c1', 'c2', E, E, 'own', E]);
  });
});

// ====================================================================== Session glue (fixture registry)

const bars: BarChangedEvent[] = [];
const offBar = gameBus.on('barChanged', (e) => bars.push(e));

/** A fresh sword character (no class: fixture classes are found only by their flag). */
function fresh(weapon: 'sword' | 'dagger' | 'staff' | 'fists' = 'sword'): Session {
  bars.length = 0;
  return Session.create(reg, 'Tester', weapon, 7);
}

/** Unlocks a fixture class the way the book does (its flag), which wears it when nothing is worn. */
function find(s: Session, cls: string): void {
  s.book.incFlag(`fx:${cls}`);
}

const learn = (s: Session, ...ids: string[]) => ids.forEach((id) => s.book.learn(id, 'test'));

describe('Session bar: no class', () => {
  it('a fresh character has 8 empty slots; learned skills drop into them (no class: all 8 are yours)', () => {
    const s = fresh();
    expect(s.player.hotbar).toEqual(Array(8).fill(E));
    learn(s, 'fx_spin', 'fx_dart');
    expect(s.player.hotbar.slice(0, 3)).toEqual(['fx_spin', 'fx_dart', E]);
    expect(bars.map((b) => b.reason)).toEqual(['learned', 'learned']);
    expect(classSlotsFor(s.book.state.worn, 8)).toBe(0);
    // Basics never go on the bar.
    expect(slotLearned(s, 'slash')).toBeNull();
    expect(slotLearned(s, 'fx_spin')).toBeNull(); // already there
  });
});

describe('Session bar: a kit class (v4)', () => {
  it('discovering the first class wears it: kit skills 1 and 2 take slots 1 and 2, usable fills take the rest', () => {
    const s = fresh();
    learn(s, 'fx_spin', 'fx_throw', 'fx_cleave', 'fx_dart', 'fx_knife');
    find(s, 'fx_blade');
    expect(s.book.state.worn).toBe('fx_blade');
    const bar = s.player.hotbar;
    expect(bar.slice(0, 2)).toEqual(['fx_guard', 'fx_cut']); // kit order
    expect(bar.slice(0, 5)).toEqual(s.book.classSkills('fx_blade', 5)); // slot order is classSkills() order
    // Fills are skills usable with the class weapon; the dagger knife is not one, and nothing is lost.
    expect(bar.slice(0, 5)).not.toContain('fx_knife');
    for (const id of ['fx_spin', 'fx_throw', 'fx_cleave', 'fx_dart', 'fx_knife']) expect(bar).toContain(id);
    expect(new Set(bar.filter(Boolean)).size).toBe(bar.filter(Boolean).length);
    expect(kitFixed(s)).toEqual(['fx_guard', 'fx_cut', E, E, E]);
  });

  it('a Class Level that unlocks a kit skill puts it in ITS slot; the fill there moves to an empty slot of yours', () => {
    const s = fresh();
    learn(s, 'fx_spin', 'fx_throw', 'fx_cleave');
    find(s, 'fx_blade');
    const fill = s.player.hotbar[2]!;
    expect(reg.skill(fill)!.classOf).toBeUndefined();
    bars.length = 0;
    learn(s, 'fx_turn'); // kit skill 3 (Class Level 2)
    expect(s.player.hotbar[2]).toBe('fx_turn');
    expect(s.player.hotbar).toContain(fill);
    expect(s.player.hotbar.indexOf(fill)).toBeGreaterThanOrEqual(3);
    expect(bars).toHaveLength(1);
    expect(bars[0]).toMatchObject({ reason: 'classLearned', skillId: 'fx_turn', classId: 'fx_blade' });
    // …and so on for kit skills 4 and 5: the five slots end up as the kit, in kit order.
    learn(s, 'fx_word', 'fx_step');
    expect(s.player.hotbar.slice(0, 5)).toEqual(['fx_guard', 'fx_cut', 'fx_turn', 'fx_step', 'fx_word']);
    for (const id of ['fx_spin', 'fx_throw', 'fx_cleave']) expect(s.player.hotbar.slice(5)).toContain(id);
  });

  it('a fill never pushes anything out: a newly learned skill fills an empty class slot, else one of yours', () => {
    const s = fresh();
    find(s, 'fx_blade'); // only the two kit skills known
    expect(s.player.hotbar.slice(0, 5)).toEqual(['fx_guard', 'fx_cut', E, E, E]);
    bars.length = 0;
    learn(s, 'fx_spin');
    expect(s.player.hotbar[2]).toBe('fx_spin');
    expect(bars[0]).toMatchObject({ reason: 'classLearned', skillId: 'fx_spin' });
    learn(s, 'fx_throw', 'fx_flurry');
    expect(s.player.hotbar.slice(0, 5)).toEqual(['fx_guard', 'fx_cut', 'fx_spin', 'fx_throw', 'fx_flurry']);
    bars.length = 0;
    learn(s, 'fx_cleave'); // tier 3, but the class slots are full: it goes to your slots, nothing is swapped
    expect(s.player.hotbar.slice(0, 5)).toEqual(['fx_guard', 'fx_cut', 'fx_spin', 'fx_throw', 'fx_flurry']);
    expect(s.player.hotbar[5]).toBe('fx_cleave');
    expect(bars[0]).toMatchObject({ reason: 'learned', skillId: 'fx_cleave' });
    // A skill the class cannot use (a dagger skill) never takes a class slot.
    learn(s, 'fx_knife');
    expect(s.player.hotbar.indexOf('fx_knife')).toBeGreaterThanOrEqual(5);
  });

  it('class-only skills never go in your slots: not by learning, not by rehoming, not by backfill', () => {
    const s = fresh();
    learn(s, 'fx_spin');
    find(s, 'fx_blade');
    find(s, 'fx_heat'); // found while wearing fx_blade: its kit skills are learned but have no slot to go to
    expect(s.book.has('fx_edge')).toBe(true);
    expect(s.player.hotbar).not.toContain('fx_edge');
    expect(ownOk(s, 'fx_edge')).toBe(false);
    expect(ownOk(s, 'fx_spin')).toBe(true);
    expect(spareSkills(s)).not.toContain('fx_edge');
    // Becoming the other class: its kit comes in, the old class's own skills leave the bar entirely.
    expect(s.book.wear('fx_heat').ok).toBe(true);
    becomeRefill(s);
    const bar = s.player.hotbar;
    expect(bar.slice(0, 2)).toEqual(['fx_edge', 'fx_bellows']);
    expect(bar).not.toContain('fx_guard');
    expect(bar).not.toContain('fx_cut');
    expect(bar).toContain('fx_spin');
    // "No class": the class slots become yours, and the class's own skills leave with it.
    s.book.unwear();
    refillClassSlots(s, 'class');
    expect(s.player.hotbar).not.toContain('fx_edge');
    expect(s.player.hotbar).not.toContain('fx_bellows');
    expect(s.player.hotbar).toContain('fx_spin');
    // With no class a class-only skill has nowhere to go.
    expect(slotLearned(s, 'fx_guard')).toBeNull();
  });

  it('becoming a class: your own picks stay, displaced skills move to your empty slots, empty ones are backfilled', () => {
    const s = fresh();
    learn(s, 'fx_spin', 'fx_throw', 'fx_cleave', 'fx_flurry', 'fx_dart', 'fx_hop', 'fx_focus');
    s.book.state.classes.fx_blade = { rank: 1, xp: 0 };
    learn(s, 'fx_guard', 'fx_cut');
    // No class: the two class-only skills found no slot.
    expect(s.player.hotbar).toEqual(['fx_spin', 'fx_throw', 'fx_cleave', 'fx_flurry', 'fx_dart', 'fx_hop', 'fx_focus', E]);
    expect(s.book.wear('fx_blade').ok).toBe(true);
    bars.length = 0;
    becomeRefill(s);
    const bar = s.player.hotbar;
    expect(bar.slice(0, 2)).toEqual(['fx_guard', 'fx_cut']);
    expect(bar.slice(0, 5)).toEqual(s.book.classSkills('fx_blade', 5));
    expect(bar[5]).toBe('fx_hop'); // your picks are untouched
    expect(bar[6]).toBe('fx_focus');
    expect(bar.every(Boolean)).toBe(true); // no slot of yours stays empty while unused skills are known
    expect(new Set(bar).size).toBe(8);
    expect(bars[0]).toMatchObject({ reason: 'class', classId: 'fx_blade' });
  });

  it('a skill an active quest asks for wins a FILL slot, never a kit slot', () => {
    const s = fresh();
    learn(s, 'fx_spin', 'fx_throw', 'fx_cleave', 'fx_flurry', 'fx_dart');
    const quest = [...reg.quests.values()].find((q) => q.objectives.some((o) => o.kind === 'use' && !!o.skill))!;
    const use = quest.objectives.find((o) => o.kind === 'use' && !!o.skill) as { skill: string };
    // Point the quest's wish at a fixture fill by learning under the quest: fake it through the active record.
    s.book.state.quests!.active[quest.id] = { progress: quest.objectives.map(() => 0), acceptedAt: 0 };
    const wanted = reg.skill(use.skill);
    find(s, 'fx_blade');
    expect(s.player.hotbar.slice(0, 2)).toEqual(['fx_guard', 'fx_cut']);
    if (wanted && s.book.has(use.skill)) expect(s.player.hotbar.slice(2, 5)).toContain(use.skill);
  });

  it('learning uses the refresh rule: a stable refill right after any learn changes nothing', () => {
    const pool = reg.authoredSkills().filter((k) => barEligible(k) && k.tier > 0).map((k) => k.id);
    let seed = 12345;
    const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    for (const cls of ['fx_blade', 'fx_heat', 'fx_way', 'fx_pin', 'fx_tide', 'fx_hearth']) {
      const s = fresh();
      find(s, cls);
      expect(s.book.state.worn).toBe(cls);
      for (let k = 0; k < 40; k++) {
        const id = pool[Math.floor(rnd() * pool.length)];
        if (s.book.has(id)) continue;
        s.book.learn(id, 'test');
        const before = [...s.player.hotbar];
        expect(refillClassSlots(s, 'load', { stable: true }), `${cls} after ${id}`).toEqual([]);
        expect(s.player.hotbar).toEqual(before);
        // Invariants: kit skills sit in their own slots; your slots hold nothing class-only; no duplicates.
        const fixed = kitFixed(s)!;
        fixed.forEach((kid, i) => kid && expect(s.player.hotbar[i], `${cls} slot ${i}`).toBe(kid));
        for (const own of s.player.hotbar.slice(5)) if (own) expect(reg.skill(own)!.classOf, own).toBeUndefined();
        const on = s.player.hotbar.filter(Boolean);
        expect(new Set(on).size).toBe(on.length);
      }
    }
  });

  it('classBeats: a kit skill beats a fill, whatever their tiers', () => {
    const s = fresh();
    find(s, 'fx_blade');
    const beats = classBeats(s)!;
    expect(beats('fx_cut', 'fx_cleave')).toBe(true); // kit (tier 2) vs a tier-3 fill
    expect(beats('fx_cleave', 'fx_cut')).toBe(false);
    expect(beats('fx_cleave', 'fx_spin')).toBe(true); // among fills the higher tier wins
  });
});

describe('Session saves (v3 key; v2 and v1 are read and migrated)', () => {
  function withStore<T>(run: (store: Map<string, string>) => T): T {
    const store = new Map<string, string>();
    const g = globalThis as unknown as { localStorage?: unknown };
    const had = g.localStorage;
    g.localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) };
    const lockedWas = Session.locked;
    Session.locked = false;
    try {
      return run(store);
    } finally {
      g.localStorage = had;
      Session.locked = lockedWas;
    }
  }

  it('saves under omnipath.save.v3 and loads it back, bar and class as they were', () => {
    withStore((store) => {
      expect(SAVE_KEY).toBe('omnipath.save.v3');
      const s = fresh();
      learn(s, 'fx_spin', 'fx_dart');
      find(s, 'fx_blade');
      learn(s, 'fx_turn');
      s.save();
      expect([...store.keys()]).toEqual([SAVE_KEY]);
      expect(JSON.parse(store.get(SAVE_KEY)!).v).toBe(3);
      const back = Session.load(reg)!;
      expect(back.book.state.worn).toBe('fx_blade');
      expect(back.player.hotbar).toEqual(s.player.hotbar);
      expect(back.player.ownedWeapons).toContain('fists');
      expect(back.book.state.version).toBe(3);
    });
  });

  it('"No class" survives a save and reload (core migration keeps worn: null)', () => {
    withStore(() => {
      const s = fresh();
      learn(s, 'fx_spin', 'fx_throw');
      find(s, 'fx_blade');
      s.book.unwear();
      refillClassSlots(s, 'class');
      s.player.hotbar.splice(0, 8, 'fx_spin', E, E, E, E, E, E, 'fx_throw');
      s.save();
      const back = Session.load(reg)!;
      expect(back.book.state.worn).toBeNull();
      expect(back.player.hotbar).toEqual(['fx_spin', E, E, E, E, E, E, 'fx_throw']);
    });
  });

  it('a v2 save is read, migrated and written as v3; the v2 key is left alone', () => {
    withStore((store) => {
      const old = fresh();
      learn(old, 'fx_spin', 'fx_throw', 'fx_dart');
      const book = { ...old.book.serialize(), version: 2 };
      const player = { ...old.player, ownedWeapons: ['sword'], hotbar: ['fx_spin', 'gone_skill', 'fx_throw', null, null, 'fx_dart'] };
      const v2 = JSON.stringify({ v: 2, player, book, world: old.world });
      store.set(SAVE_KEY_V2, v2);
      expect(Session.hasSave()).toBe(true);
      const s = Session.load(reg)!;
      expect(s).not.toBeNull();
      expect(s.book.state.version).toBe(3);
      expect(s.player.weapon).toBe('sword'); // the held weapon is unchanged…
      expect(s.player.ownedWeapons).toEqual(['sword', 'fists']); // …and Bare Hands is owned (rule 1)
      expect(s.player.hotbar.length).toBe(8);
      expect(s.player.hotbar).not.toContain('gone_skill'); // lost slots are cleared before the refill (rule 9)
      for (const id of ['fx_spin', 'fx_throw', 'fx_dart']) expect(s.player.hotbar).toContain(id);
      expect(store.get(SAVE_KEY_V2)).toBe(v2); // never deleted
      expect(JSON.parse(store.get(SAVE_KEY)!).v).toBe(3); // a v3 write has happened
      // From now on the v3 save is the one read.
      store.set(SAVE_KEY_V2, 'garbage');
      expect(Session.load(reg)!.player.hotbar).toEqual(s.player.hotbar);
    });
  });

  it('a migrated save that wears a kit class has its class slots rebuilt from the kit', () => {
    withStore((store) => {
      const old = fresh();
      learn(old, 'fx_spin', 'fx_throw', 'fx_cleave', 'fx_dart');
      find(old, 'fx_blade');
      // The bar as an old save might hold it: fills in the kit's slots, a class-only skill in one of yours.
      const hotbar = ['fx_spin', 'fx_throw', 'fx_cleave', null, null, 'fx_cut', 'fx_dart', null];
      store.set(SAVE_KEY_V2, JSON.stringify({ v: 2, player: { ...old.player, hotbar }, book: old.book.serialize(), world: old.world }));
      const s = Session.load(reg)!;
      const bar = s.player.hotbar;
      expect(bar.slice(0, 2)).toEqual(['fx_guard', 'fx_cut']);
      expect(bar.slice(0, 5)).toEqual(s.book.classSkills('fx_blade', 5));
      expect(bar.slice(5)).not.toContain('fx_cut');
      for (const id of ['fx_spin', 'fx_throw', 'fx_cleave', 'fx_dart']) expect(bar).toContain(id); // nothing lost
    });
  });

  it('a v1 save still loads (v1 → v3) and is written as v3; a corrupt save loads as nothing', () => {
    withStore((store) => {
      store.set(SAVE_KEY_V1, JSON.stringify({ v: 1, player: { name: 'Old', weapon: 'dagger', level: 4, hotbar: ['stab', null] }, skills: {} }));
      const s = Session.load(reg)!;
      expect(s.player.name).toBe('Old');
      expect(s.player.weapon).toBe('dagger');
      expect(s.player.ownedWeapons).toEqual(['dagger', 'fists']);
      expect(s.book.has('stab')).toBe(true);
      expect(store.has(SAVE_KEY)).toBe(true);
      expect(store.has(SAVE_KEY_V1)).toBe(true);
    });
    withStore((store) => {
      store.set(SAVE_KEY, '{not json');
      expect(Session.load(reg)).toBeNull();
    });
  });

  it('the late v2 fixture save loads on the real content: version 3, 8 slots, nothing unknown on the bar', async () => {
    const raw = JSON.stringify(SAVE_V2_LATE);
    const { createRegistry } = await import('../src/data');
    const real = createRegistry();
    withStore((store) => {
      const data = JSON.parse(raw) as Record<string, unknown>;
      // The fixture may be a whole save or a book state: wrap a bare book in a v2 save.
      const save = data.v === 2 && data.book ? data : { v: 2, player: { name: 'Late', weapon: 'sword', hotbar: [] }, book: data, world: {} };
      store.set(SAVE_KEY_V2, JSON.stringify(save));
      const s = Session.load(real)!;
      expect(s).not.toBeNull();
      expect(s.book.state.version).toBe(3);
      expect(s.player.hotbar.length).toBe(8);
      expect(s.player.ownedWeapons).toContain('fists');
      for (const id of s.player.hotbar) if (id) expect(s.book.has(id), id).toBe(true);
      const worn = s.book.state.worn;
      const n = classSlotsFor(worn, 8);
      for (const id of s.player.hotbar.slice(n)) if (id) expect(real.skill(id)!.classOf, `${id} in your slots`).toBeUndefined();
      if (worn) expect(s.player.hotbar.slice(0, 5).filter(Boolean)).toEqual(s.book.classSkills(worn, 5).filter((id) => !s.player.hotbar.slice(5).includes(id)).slice(0, s.player.hotbar.slice(0, 5).filter(Boolean).length));
      expect(JSON.parse(store.get(SAVE_KEY)!).v).toBe(3);
    });
  });

  it('skills the book no longer knows leave the bar on load; an old 6-slot bar is padded to 8', () => {
    const s = fresh();
    s.player.hotbar[6] = 'not_a_skill';
    s.repairBar(8);
    expect(s.player.hotbar[6]).toBeNull();
    learn(s, 'fx_spin', 'fx_throw', 'fx_dart');
    find(s, 'fx_blade');
    s.player.hotbar.splice(0, 8, ...padBar(['fx_dart', E, 'fx_throw', E, 'fx_spin', E], 8));
    s.repairBar(6);
    expect(s.player.hotbar.length).toBe(8);
    expect(s.player.hotbar.slice(0, 2)).toEqual(['fx_guard', 'fx_cut']);
    for (const id of ['fx_spin', 'fx_throw', 'fx_dart']) expect(s.player.hotbar).toContain(id);
  });
});

describe('SkillBook.unwear', () => {
  it('takes the class off, invalidates caches and re-evaluates classes', () => {
    const b = new SkillBook(reg);
    b.incFlag('fx:fx_blade');
    const worn = b.state.worn!;
    expect(worn).toBe('fx_blade');
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
