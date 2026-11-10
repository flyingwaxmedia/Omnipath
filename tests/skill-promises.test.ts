// No skill or Gift may promise something that does nothing (SPEC-v4 §6.2, §3.6). Every `extra` word a player skill
// declares must be backed by a run-time rule (src/game/systems/extras.ts), every trigger passive by an implemented
// `when` → `do` pair (src/game/systems/gifts.ts) — and the Gift rules are exercised here on the real data.
import { describe, expect, it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import type { ActiveTrigger } from '../src/core/passives';
import type { SkillDef } from '../src/core/types';
import { GAME_DATA, createRegistry } from '../src/data';
import { REBUILT } from '../src/data/classes';
import { EXTRA, extraHonoured, isSelfCast, isStatusWord } from '../src/game/systems/extras';
import { GIFT, GIFT_RULES, GIFT_WHEN_DO, GiftRuntime, doKey, giftImplemented } from '../src/game/systems/gifts';

const reg = createRegistry();
const playerSkills = GAME_DATA.skills.filter((s) => !s.tags.includes('monster'));
const elementStatus = (s: SkillDef) => (s.element ? reg.element(s.element)?.status : undefined);

describe('skill `extra` words', () => {
  it('every declared word has a real run-time effect', () => {
    const empty: string[] = [];
    const words = new Set<string>();
    for (const s of playerSkills) {
      if (s.extra === undefined || s.extra === 'none') continue;
      words.add(s.extra);
      if (extraHonoured(s, elementStatus(s)) === null) empty.push(`${s.id}: "${s.extra}" does nothing on a ${s.shape.kind}`);
    }
    expect(empty).toEqual([]);
    // The words the content lane called "declared only" are all in use, so this test is looking at them.
    for (const w of ['crit', 'execute', 'mark', 'heal', 'shield', 'haste', 'interrupt', 'reposition', 'cleanse']) expect(words, w).toContain(w);
  });

  it('generated variants keep a backed word too (an infusion never empties a promise)', () => {
    const empty: string[] = [];
    for (const base of playerSkills) {
      for (const el of ['fire', 'water', 'holy'] as const) {
        const v = reg.skill(`${base.id}@${el}`);
        if (v && v.extra !== undefined && extraHonoured(v, elementStatus(v)) === null) empty.push(`${v.id}: ${v.extra}`);
      }
    }
    expect(empty).toEqual([]);
  });

  it('refuses a word nothing backs', () => {
    const sk = (over: Partial<SkillDef>): SkillDef => ({ ...reg.skill('whirlwind')!, extra: undefined, status: undefined, critBonus: undefined, riders: undefined, element: undefined, ...over });
    expect(extraHonoured(sk({}))).toBe('none');
    expect(extraHonoured(sk({ extra: 'crit' }))).toBeNull(); // a spin with no crit chance of its own
    expect(extraHonoured(sk({ extra: 'crit', critBonus: 20 }))).toBe('crit chance');
    expect(extraHonoured(sk({ extra: 'heal' }))).toBeNull();
    expect(extraHonoured(sk({ extra: 'heal', riders: { leech: 0.1 } }))).toBe('heal on hit');
    expect(extraHonoured(sk({ extra: 'heal', element: 'holy' }), 'smite')).toBe('heal on hit');
    expect(extraHonoured(sk({ extra: 'leech' }))).toBeNull();
    expect(extraHonoured(sk({ extra: 'haste' }))).toBeNull(); // only on yourself or on a dash
    expect(extraHonoured(sk({ extra: 'cleanse' }))).toBeNull();
    expect(extraHonoured(sk({ extra: 'reposition' }))).toBeNull();
    expect(extraHonoured(sk({ extra: 'shield' }))).toBeNull();
    expect(extraHonoured(sk({ extra: 'root' }))).toBe('status on hit');
    expect(extraHonoured(sk({ extra: 'root', power: 0 }))).toBeNull(); // it never hits anything
    expect(extraHonoured(sk({ extra: 'mark', power: 0 }))).toBeNull();
    const buff = reg.skill('focus')!;
    expect(isSelfCast(buff)).toBe(true);
    for (const w of ['haste', 'cleanse', 'reposition', 'shield', 'crit'] as const) expect(extraHonoured({ ...buff, extra: w }), w).not.toBeNull();
    expect(extraHonoured({ ...buff, extra: 'execute' })).toBeNull();
    expect(isStatusWord('expose')).toBe(true);
    expect(isStatusWord('crit')).toBe(false);
    expect(EXTRA.shieldPct).toBeGreaterThan(0);
  });
});

describe('Gifts (trigger passives)', () => {
  const triggers = GAME_DATA.passives.filter((p) => p.effect.kind === 'trigger');

  it('every declared trigger is one the game implements', () => {
    expect(triggers.length).toBeGreaterThanOrEqual(7);
    for (const p of triggers) {
      const e = p.effect as Extract<typeof p.effect, { kind: 'trigger' }>;
      expect(giftImplemented(e), `${p.id}: when ${e.when} do ${doKey(e.do)}`).toBe(true);
      if ('rule' in e.do) expect(GIFT_RULES, p.id).toContain(e.do.rule);
    }
    // …and nothing is listed as implemented that the runtime below does not exercise.
    expect(Object.values(GIFT_WHEN_DO).flat().sort()).toEqual(['arc', 'burst', 'freeCast', 'guaranteeCrit', 'rule:ebbAndFlow', 'rule:fromBehind', 'rule:nearFireSp']);
  });

  it('every rebuilt class has a Gift, and the book lists its trigger while the class is worn', () => {
    for (const id of REBUILT) {
      const cls = reg.classDef(id)!;
      expect(cls.passive, id).toBeDefined();
      const book = new SkillBook(reg);
      book.state.classes[id] = { rank: 1, xp: 0 };
      expect(book.wear(id).ok).toBe(true);
      const def = reg.passive(cls.passive!)!;
      if (def.effect.kind === 'trigger') expect(book.totals().triggers.map((t) => t.id), id).toContain(def.id);
      else expect(book.passives().map((p) => p.def.id), id).toContain(def.id);
      book.unwear();
      expect(book.totals().triggers).toEqual([]);
    }
  });

  const gift = (classId: string): GiftRuntime => {
    const def = reg.passive(reg.classDef(classId)!.passive!)!;
    const e = def.effect as Extract<typeof def.effect, { kind: 'trigger' }>;
    const { kind: _kind, ...rule } = e;
    const t: ActiveTrigger = { id: def.id, source: 'class', ...rule };
    return new GiftRuntime(() => [t]);
  };
  const blow = { basic: false, weapon: 'sword' as const, behind: false, direct: true };

  it('Clean Edge: the 3rd hit in a row on the same foe crits, at most once every 6 s', () => {
    const g = gift('blademaster');
    expect(g.hit({ ...blow, foe: 'a', now: 0 }).crit).toBe(false);
    expect(g.hit({ ...blow, foe: 'a', now: 100 }).crit).toBe(false);
    const third = g.hit({ ...blow, foe: 'a', now: 200 });
    expect(third).toMatchObject({ crit: true, fired: ['clean_edge'] });
    // The cooldown holds the next one back; the streak waits at two.
    for (const now of [300, 400, 500]) expect(g.hit({ ...blow, foe: 'a', now }).crit).toBe(false);
    expect(g.hit({ ...blow, foe: 'a', now: 6300 }).crit).toBe(true);
    // Another foe breaks the row.
    g.hit({ ...blow, foe: 'a', now: 13000 });
    g.hit({ ...blow, foe: 'b', now: 13100 });
    expect(g.hit({ ...blow, foe: 'a', now: 13200 }).crit).toBe(false);
    // A thrown copy never counts.
    const h = gift('blademaster');
    for (const now of [0, 1, 2, 3]) expect(h.hit({ ...blow, foe: 'a', now, direct: false }).crit).toBe(false);
  });

  it('Spare Knife: every 4th basic attack with a dagger is thrown at a second foe', () => {
    const g = gift('knife_juggler');
    const basic = { ...blow, basic: true, weapon: 'dagger' as const };
    const arcs = [0, 1, 2, 3, 4, 5, 6, 7].map((i) => g.hit({ ...basic, foe: 'a', now: i * 400 }).arc);
    expect(arcs).toEqual([0, 0, 0, 1, 0, 0, 0, 1]);
    expect(g.hit({ ...basic, foe: 'a', now: 9000, basic: false }).arc).toBe(0); // skills do not count
    const sword = gift('knife_juggler');
    for (let i = 0; i < 8; i++) expect(sword.hit({ ...basic, weapon: 'sword', foe: 'a', now: i }).arc).toBe(0);
  });

  it('Tidy Weave: every 4th skill costs no SP; basic attacks do not count', () => {
    const g = gift('arcanist');
    const free: boolean[] = [];
    for (let i = 0; i < 8; i++) {
      expect(g.cast({ basic: true, now: i }).free).toBe(false);
      expect(g.nextFree(false)).toBe(i % 4 === 3);
      free.push(g.cast({ basic: false, now: i }).free);
    }
    expect(free).toEqual([false, false, false, true, false, false, false, true]);
    expect(g.nextFree(true)).toBe(false);
  });

  it('Banked Coals: a burn that runs out pops, at most once a second', () => {
    const g = gift('pyroblade');
    expect(g.statusEnds('burn', 0)).toBeCloseTo(0.4);
    expect(g.statusEnds('burn', 500)).toBe(0);
    expect(g.statusEnds('poison', 5000)).toBe(0);
    expect(g.statusEnds('burn', 1000)).toBeCloseTo(0.4);
    expect(GIFT.burstRadius).toBeGreaterThan(0);
  });

  it('From Nowhere: only hits on a foe\'s back deal more, thrown copies included', () => {
    const g = gift('shadowstalker');
    expect(g.hit({ ...blow, foe: 'a', now: 0 }).pct).toBe(0);
    expect(g.hit({ ...blow, foe: 'a', now: 0, behind: true }).pct).toBe(GIFT.behindPct);
    expect(g.hit({ ...blow, foe: 'a', now: 0, behind: true, direct: false }).pct).toBe(GIFT.behindPct);
    expect(gift('blademaster').hit({ ...blow, foe: 'a', now: 0, behind: true }).pct).toBe(0);
  });

  it('Warm Hands: SP comes back only near a fire', () => {
    const g = gift('pyromancer');
    expect(g.fireSp(true)).toBe(GIFT.fireSpPct);
    expect(g.fireSp(false)).toBe(0);
    expect(gift('tidecaller').fireSp(true)).toBe(0);
  });

  it('Ebb and Flow: every 6 s the next skill is bigger, the time after stronger, in turn', () => {
    const g = gift('tidecaller');
    expect(g.cast({ basic: true, now: 0 }).boost).toBeNull();
    expect(g.cast({ basic: false, now: 0 }).boost).toEqual({ sizePct: GIFT.ebbPct });
    expect(g.cast({ basic: false, now: 3000 }).boost).toBeNull();
    expect(g.cast({ basic: false, now: 6000 }).boost).toEqual({ powerPct: GIFT.ebbPct });
    expect(g.cast({ basic: false, now: 12000 }).boost).toEqual({ sizePct: GIFT.ebbPct });
    g.shiftTime(1000); // a pause moves the turn with the clock
    expect(g.cast({ basic: false, now: 18500 }).boost).toBeNull();
    expect(g.cast({ basic: false, now: 19000 }).boost).toEqual({ powerPct: GIFT.ebbPct });
    g.reset();
    expect(g.cast({ basic: false, now: 19001 }).boost).toEqual({ sizePct: GIFT.ebbPct });
  });
});
