import { it, expect } from 'vitest';
import { SkillBook, type Inventory } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
import { WEAPONS } from '../src/data/weapons';
const reg = createRegistry();
function bagOf(items: Record<string, number>): Inventory {
  return {
    count: (id) => items[id] ?? 0,
    coins: () => 0,
    spend: (cost) => {
      const want = Object.entries(cost.items ?? {});
      if ((cost.coins ?? 0) > 0 || want.some(([id, n]) => (items[id] ?? 0) < n)) return false;
      for (const [id, n] of want) items[id] = (items[id] ?? 0) - n;
      return true;
    },
  };
}
function newBook() {
  const book = new SkillBook(reg);
  const bag: Record<string, number> = {};
  const clock = { t: 0 };
  book.inv = bagOf(bag);
  book.now = () => clock.t;
  book.learn(WEAPONS.sword.basic, 'start');
  return { book, bag, clock };
}
const raise = (book: SkillBook, id: string, rank: number) => { for (let i = 0; book.rank(id) < rank && i < 5000; i++) book.addMastery(id, 50); };

it('passive bounty after max rank', () => {
  const { book, bag, clock } = newBook();
  book.state.quests!.done.hale_first_drill = 1;
  const cd = reg.quest('hale_footwork')!.repeatable!.cooldownMs;
  const log: string[] = [];
  for (let round = 1; round <= 5; round++) {
    const acc = book.acceptQuest('hale_footwork');
    for (let i = 0; i < 10; i++) { const m = reg.monster('jellop')!; book.recordKill(m); book.notifyQuest({ type: 'kill', monster: m }); }
    bag.herb = 4;
    const r = book.turnInQuest('hale_footwork', 'hale');
    log.push(`round ${round}: accept=${acc.ok} turnIn=${r.ok} rank=${book.state.passives.sure_footing} herbsLeft=${bag.herb} lessonState=${JSON.stringify(book.lessonState('hale_sure_footing'))}`);
    clock.t += cd;
  }
  console.log(log.join('\n'));
});

it('gus witness after echo already learned', () => {
  const { book } = newBook();
  book.learn('shoulder_charge', 'x'); raise(book, 'shoulder_charge', 3);
  for (let i = 0; i < 3; i++) book.witness('boulder_roll');
  console.log('knows boulder_roll', book.has('boulder_roll'), 'marks', book.state.witness.boulder_roll);
  book.state.quests!.done.miner_gus_good_haul = 1;
  console.log('accept', book.acceptQuest('miner_gus_stand_in_its_way').ok);
  const r = book.witness('boulder_roll');
  console.log('witness after learned', JSON.stringify(r), 'marks now', book.state.witness.boulder_roll);
  console.log('whispered mimic already?', book.state.whispered.includes('mimic'));
});

it('moonwarden discovered on entering glade with holy', () => {
  const { book } = newBook();
  book.learnElement('holy', 'x');
  book.incFlag('visited:vale.moonlit_glade');
  book.evaluateClasses();
  console.log('moonwarden discovered:', (book as any).discovered('moonwarden'), 'classes:', Object.keys(book.state.classes));
  console.log('whisper on turn-in would succeed:', book.whisperClass('moonwarden'));
});

it('infused basic loses basic tag for use objective', () => {
  const { book } = newBook();
  raise(book, 'slash', 5);
  book.learnElement('fire', 'x');
  const r = book.fuse('skill:slash', 'el:fire');
  console.log('fuse', JSON.stringify(r));
  const v = reg.skill((r as any).result.replace('skill:', ''))!;
  console.log('variant', v.id, v.tags, v.element);
  book.state.quests!.done.hale_first_drill = 1;
  console.log('accept crack', book.acceptQuest('hale_crack_it_open').ok);
  book.notifyQuest({ type: 'use', skill: v });
  console.log(JSON.stringify(book.questProgress('hale_crack_it_open').map((p) => p.text)));
});

it('lio ice via fused element + infused skill', () => {
  const { book } = newBook();
  raise(book, 'slash', 5);
  book.learnElement('water', 'x'); book.learnElement('wind', 'x');
  const e = book.fuse('el:water', 'el:wind');
  const r = book.fuse('skill:slash', 'el:ice');
  const v = reg.skill((r as any).result.replace('skill:', ''))!;
  book.state.quests!.done.child_lio_really_fast = 1;
  book.acceptQuest('child_lio_frozen_lake');
  for (let i = 0; i < 3; i++) book.notifyQuest({ type: 'cast', skill: v, map: 'vale.mirror_lake' });
  console.log('el', e.ok, 'variant', v.id, v.element, 'status', book.questStatus('child_lio_frozen_lake'));
});

it('altar hums infused', () => {
  const { book } = newBook();
  book.acceptQuest('mirelle_altar_hums');
  raise(book, 'slash', 5);
  book.learnElement('fire', 'x');
  book.fuse('skill:slash', 'el:fire');
  console.log('altar hums', book.questStatus('mirelle_altar_hums'));
});

it('pale glade completes and twilight', () => {
  const { book } = newBook();
  book.learnElement('holy', 'x'); book.learnElement('shadow', 'x');
  const t = book.fuse('el:holy', 'el:shadow');
  book.evaluateClasses();
  console.log('twilight', t.ok, 'twilight_sage discovered', (book as any).discovered('twilight_sage'), 'eclipse whisper ok', book.whisperClass('eclipse_walker'));
});
