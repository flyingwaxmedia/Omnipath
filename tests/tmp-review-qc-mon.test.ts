import { it } from 'vitest';
import { createRegistry } from '../src/data';
const reg = createRegistry();
it('mon', () => {
  const out: string[] = [];
  for (const m of reg.monsters.values()) {
    out.push(`${m.id} "${m.name}" lvl=${m.level} ${m.rank} el=${m.element ?? '-'} base=${m.base ?? '-'} aggr=${(m as any).aggressive} tech=${(m.techniques ?? []).map((t) => t.skill + (t.echo ? '*' : '') + '(' + reg.skill(t.skill)?.shape.kind + ')').join(',')}`);
  }
  console.log(out.join('\n'));
});
