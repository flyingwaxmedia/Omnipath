import { it } from 'vitest';
import { createRegistry } from '../src/data';
const reg = createRegistry();
it('classes', () => {
  const out: string[] = [];
  for (const c of reg.classes) {
    out.push(`${c.id} "${c.name}" tier=${(c as any).tier} hidden=${(c as any).hidden ?? ''} parents=${JSON.stringify((c as any).parents ?? '')} req=${JSON.stringify((c as any).requires ?? (c as any).discover ?? '')} hint=${JSON.stringify((c as any).hint ?? '')}`);
  }
  console.log(out.join('\n'));
});
