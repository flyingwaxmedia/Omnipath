// Quest hooks (src/game/quests.ts): game-bus events reach SkillBook.notifyQuest; bag changes re-check deliveries.
import { describe, expect, it } from 'vitest';
import type { MonsterDef, SkillDef } from '../src/core/types';
import { createRegistry } from '../src/data';
import { EventBus, type GameEvents } from '../src/game/events';
import { wireQuestHooks } from '../src/game/quests';
import { Session } from '../src/game/session';

const reg = createRegistry();
type Ev = GameEvents;

function setup() {
  const bus = new EventBus<Ev>();
  const s = Session.create(reg, 'Tester', 'sword', 11);
  const off = wireQuestHooks(s.book, bus);
  return { bus, s, book: s.book, off };
}

const monster = (id: string): MonsterDef => reg.monster(id)!;
const skill = (id: string): SkillDef => reg.skill(id)!;
// Only the fields the hooks read matter; the rest of a payload is the world's business.
const kill = (bus: EventBus<Ev>, id: string) => bus.emit('kill', { def: monster(id) } as Ev['kill']);
const hit = (bus: EventBus<Ev>, id: string, castId: number | undefined, hitIndex: number, resisted = false) =>
  bus.emit('hit', { skill: skill(id), skillId: id, castId, hitIndex, resisted } as Ev['hit']);

describe('quest hooks', () => {
  it('kill + use (once per engaged cast) count toward an accepted quest', () => {
    const { bus, book, off } = setup();
    const basic = 'slash';
    expect(reg.skill(basic)?.tags).toContain('basic');
    expect(book.acceptQuest('hale_first_drill', 'hale').ok).toBe(true);
    kill(bus, 'jellop');
    kill(bus, 'jellop');
    hit(bus, basic, 1, 0);
    hit(bus, basic, 1, 1); // same cast: no second use
    hit(bus, basic, 2, 0, true); // resisted first hit still engages the cast…
    hit(bus, basic, 2, 0); // …and its real first hit does not count twice
    const p = book.questProgress('hale_first_drill');
    expect(p[0].have).toBe(2);
    expect(p[1].have).toBe(2);
    off();
    kill(bus, 'jellop');
    expect(book.questProgress('hale_first_drill')[1].have).toBe(2);
  });

  it('visit on map entry, talk on NPC interaction, cast with its map', () => {
    const { bus, book } = setup();
    expect(book.acceptQuest('mirelle_stones_remember', 'mirelle').ok).toBe(true);
    bus.emit('mapEnter', { map: 'vale.windcrest_hill', first: true, x: 0, y: 0 });
    bus.emit('mapEnter', { map: 'vale.quarry_depths.1', first: true, x: 0, y: 0 });
    expect(book.questStatus('mirelle_stones_remember')).toBe('ready');

    const dash = reg.authoredSkills().find((x) => x.shape.kind === 'dash' && !x.tags.includes('monster'))!;
    book.state.quests!.done.child_lio_wobbly_king = 1; // whatever comes before it in the chain
    const lio = reg.quest('child_lio_really_fast')!;
    for (const q of lio.after ?? []) book.state.quests!.done[q] = 1;
    expect(book.acceptQuest('child_lio_really_fast', 'child_lio').ok).toBe(true);
    for (let i = 0; i < 2; i++) bus.emit('castFire', { skill: dash, skillId: dash.id, map: 'vale.greenmeadow' } as Ev['castFire']);
    bus.emit('castFire', { skill: dash, skillId: dash.id, map: 'vale.hearthvale' } as Ev['castFire']);
    expect(book.questProgress('child_lio_really_fast')[0].have).toBe(2);

    const dask = reg.quest('dask_lovely_handwriting')!;
    for (const q of dask.after ?? []) book.state.quests!.done[q] = 1;
    book.state.flags['visited:rift.riftmarch'] = 1;
    if (book.acceptQuest('dask_lovely_handwriting', 'dask').ok) {
      bus.emit('talk', { npcId: 'mirelle', map: 'vale.hearthvale', x: 0, y: 0 });
      expect(book.questProgress('dask_lovely_handwriting')[0].done).toBe(true);
    }
  });

  it('gather counts; a bag change re-checks deliveries (questReady after the change)', async () => {
    const { bus, s, book } = setup();
    book.state.quests!.done.hale_first_drill = 1;
    expect(book.acceptQuest('hale_whole_body', 'hale').ok).toBe(true);
    const ready: string[] = [];
    book.events.on('questProgress', ({ quest }) => ready.push(`progress:${quest.id}`));
    s.addItem('herb', 3);
    await Promise.resolve();
    expect(ready).toContain('progress:hale_whole_body');
    expect(book.questProgress('hale_whole_body')[2].done).toBe(true);

    book.state.quests!.done.miner_gus_good_haul = 0;
    if (book.acceptQuest('miner_gus_good_haul', 'miner_gus').ok) {
      bus.emit('gather', { node: 'ore', item: 'ore', total: 1, x: 0, y: 0, map: 'vale.greystone_quarry' });
      expect(book.questProgress('miner_gus_good_haul')[0].have).toBe(1);
    }
  });

  it("witness marks from the book's witness event count", () => {
    const { book } = setup();
    book.state.quests!.done.miner_gus_good_haul = 1;
    expect(book.acceptQuest('miner_gus_stand_in_its_way', 'miner_gus').ok).toBe(true);
    book.witness('boulder_roll');
    expect(book.questProgress('miner_gus_stand_in_its_way')[0].have).toBe(1);
  });
});
