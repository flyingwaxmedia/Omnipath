import { it } from 'vitest';
import { GAME_DATA as DATA } from '../src/data';
import { Registry } from '../src/core/registry';
it('dump', () => {
  const reg = new Registry(DATA as any);
  const rows: string[] = [];
  for (const q of reg.quests.values()) {
    const l = q.rewards.lesson ? reg.lesson(q.rewards.lesson)?.lesson : undefined;
    if (!l) continue;
    const g: any = l.grants;
    const kind = Object.keys(g)[0];
    const max = g.passive ? reg.passive(g.passive)?.maxRank : '';
    rows.push(`${q.id} rep=${!!q.repeatable} lesson=${l.id} lrep=${!!l.repeatable} qOnly=${!!l.questOnly} ${kind}=${g[kind]} max=${max} req=${JSON.stringify(l.requires)} after=${q.after ?? ''} qreq=${JSON.stringify(q.requires ?? [])}`);
  }
  console.log(rows.join('\n'));
  const lessons = reg.trainers.flatMap((t) => t.lessons);
  console.log('lessons', lessons.length, 'questOnly', lessons.filter((l) => l.questOnly).length);
  // duplicate deliver items per quest
  for (const q of reg.quests.values()) {
    const items = q.objectives.filter((o) => o.kind === 'deliver').map((o: any) => o.item);
    if (new Set(items).size !== items.length) console.log('dup deliver', q.id);
  }
});
