// Player-facing words (panels lane; docs/UX-SIMPLE.md §1 rule 8). Every UI lane imports these instead of writing
// internal names: the table maps an internal concept to what players read. Ids never change — only the words.
// Other lanes import read-only; ask the panels lane (in your report) for a new entry.

/** Internal concept → shown as. */
export const FRIENDLY = {
  classRank: 'Class Level',
  morph: 'Transform',
  morphReady: 'Transform ready ✨',
  overmastery: 'Mastery bar',
  imprint: 'Keepsake',
  witness: 'Seen',
  spark: 'Sudden insight',
  essenceSlot: 'Rune socket',
  tagPassive: 'Mastery bonus',
  resonance: 'Element bond',
  grey: 'Too weak to learn from',
  classSlot: 'Class slot',
  ownSlot: 'Your slot',
  quest: 'Quest',
  pursuits: 'Pursuits',
  starChart: 'Star Chart',
} as const;

/** "★★★☆☆" for rank 3 of 5 (max ranks above 10 are shown as 10 stars, filled proportionally). */
export function stars(rank: number, max: number): string {
  if (max <= 0) return '';
  const n = Math.min(10, max);
  const on = Math.max(0, Math.min(n, Math.round((rank / max) * n)));
  return '★'.repeat(on) + '☆'.repeat(n - on);
}

/** "Seen 2/3" (witness marks). */
export function seen(marks: number, need: number): string {
  return `${FRIENDLY.witness} ${Math.min(marks, need)}/${need}`;
}

/** "a Pyroblade" / "an Earthshaper". */
export function article(name: string): string {
  return `${/^[aeiou]/i.test(name) ? 'an' : 'a'} ${name}`;
}

/** "1 skill" / "3 skills". */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** The first sentence of a description (UX-SIMPLE rule 1: one short line). */
export function oneLine(text: string): string {
  const m = /^(.+?[.!?])(\s|$)/.exec(text.trim());
  return (m ? m[1] : text).trim();
}
