import { it } from 'vitest';
import { QUESTS } from '../src/data/quests';
import { MAPS } from '../src/data/world';
import { TRAINERS } from '../src/data/trainers';
const region = new Map<string, string>();
for (const m of MAPS) for (const n of m.npcs ?? []) region.set(n.npc, m.region);
it('econ', () => {
  const sum: Record<string, { coins: number; exp: number; n: number }> = {};
  for (const q of QUESTS) {
    const k = `${region.get(q.giver)}:${q.repeatable ? 'bounty' : 'story'}`;
    sum[k] ??= { coins: 0, exp: 0, n: 0 };
    sum[k].coins += q.rewards.coins ?? 0; sum[k].exp += q.rewards.exp ?? 0; sum[k].n++;
  }
  console.log(JSON.stringify(sum));
  let lessonCoins = 0;
  for (const t of TRAINERS) for (const l of t.lessons) lessonCoins += (l.cost?.coins ?? 0) * (l.repeatable ? ('passive' in l.grants ? 3 : 1) : 1);
  console.log('old lesson coin cost (passives x3, essences x1):', lessonCoins);
  console.log('questOnly set on lessons:', TRAINERS.flatMap((t) => t.lessons).filter((l: any) => l.questOnly).length, '/', TRAINERS.flatMap((t) => t.lessons).length);
  // per NPC: count of quests available at fresh/arrival with no after
  const byNpc: Record<string, string[]> = {};
  for (const q of QUESTS) if (!(q.after ?? []).length) (byNpc[q.giver] ??= []).push(q.id + (q.requires?.length ? '[req]' : ''));
  console.log(JSON.stringify(byNpc, null, 1));
});
