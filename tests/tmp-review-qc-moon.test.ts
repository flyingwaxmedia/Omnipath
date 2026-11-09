import { it } from 'vitest';
import { SkillBook } from '../src/core/skillbook';
import { createRegistry } from '../src/data';
const reg = createRegistry();
it('moonwarden with holy-infused skill', () => {
  const book = new SkillBook(reg);
  book.learn('slash', 'start');
  for (let i = 0; book.rank('slash') < 5 && i < 5000; i++) book.addMastery('slash', 50);
  book.learnElement('holy', 'x');
  console.log(JSON.stringify(book.fuse('skill:slash', 'el:holy')));
  book.incFlag('visited:vale.moonlit_glade');
  book.evaluateClasses();
  console.log('moonwarden discovered:', (book as any).discovered('moonwarden'), 'whisper ok:', book.whisperClass('moonwarden'));
  const cls = reg.classDef('moonwarden')!;
  console.log(JSON.stringify((cls as any).requires), JSON.stringify((cls as any).discovery ?? (cls as any).needs ?? ''));
});
