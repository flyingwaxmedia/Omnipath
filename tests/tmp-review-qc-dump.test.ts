import { it } from 'vitest';
import { MAPS } from '../src/data/world';
import { createRegistry } from '../src/data';
const reg = createRegistry();
it('dump', () => {
  const out: string[] = [];
  for (const m of MAPS) {
    out.push(`== ${m.id} (${m.name}) kind=${m.kind} band=${JSON.stringify(m.levelBand)}`);
    for (const s of m.spawns) {
      const md = reg.monster(s.monster);
      out.push(`  spawn ${s.monster} x${s.count} lvl=${(md as any)?.level} rank=${md?.rank} fam=${md?.family} drops=${JSON.stringify(md?.drops)}`);
    }
    const nodes: Record<string, number> = {};
    for (const n of m.nodes ?? []) nodes[n.kind] = (nodes[n.kind] ?? 0) + 1;
    out.push(`  nodes ${JSON.stringify(nodes)}`);
    out.push(`  npcs ${(m.npcs ?? []).map((n) => n.npc).join(',')}`);
    for (const o of m.objects ?? []) if (o.kind !== 'signpost' && o.kind !== 'statue') out.push(`  obj ${o.kind} ${o.id} ${o.loot ? JSON.stringify(o.loot) : ''}`);
    for (const p of m.portals) out.push(`  portal ${p.id} -> ${p.to.map} ${p.kind}${p.gate ? ' GATE ' + JSON.stringify(p.gate) : ''}${p.reveal ? ' REVEAL ' + JSON.stringify(p.reveal) : ''}${p.oneWay ? ' oneway' : ''}`);
  }
  console.log(out.join('\n'));
});
