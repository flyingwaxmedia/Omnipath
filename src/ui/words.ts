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
  // v3 additions (panels lane): every name a player reads for a system.
  classTree: 'Perks',
  classPoint: 'perk point',
  keepsakeSlot: 'Keepsake slot',
  fusion: 'Fuse',
  altar: 'Fusion Altar',
  element: 'Element',
  essence: 'Essence',
  echo: 'Echo',
  bestiary: 'Bestiary',
  whisper: 'Whisper',
  lesson: 'Lesson',
  noClass: 'No class',
  becomeClass: 'Become',
  changeClass: 'Change class',
  questAccept: 'Accept',
  questLater: 'Later',
  questComplete: 'Complete',
  questTrack: 'Track',
  questGiveUp: 'Give up',
} as const;

/** "Class Level 4" (or "Class Level 10 · max"). */
export function classLevel(level: number, max?: number): string {
  return `${FRIENDLY.classRank} ${level}${max !== undefined && level >= max ? ' · max' : ''}`;
}

/** "3 more" style counts in hints: "1 more fire skill". */
export function more(n: number, one: string, many = `${one}s`): string {
  return `${n} more ${n === 1 ? one : many}`;
}

/** Where a skill or element came from, in plain words ("Transformed from Whirlwind", "Quest reward"). */
export function originText(src: string, name: (kind: 'skill' | 'monster' | 'class' | 'item', id: string) => string | undefined): string {
  const i = src.indexOf(':');
  const kind = i < 0 ? src : src.slice(0, i);
  const rest = i < 0 ? '' : src.slice(i + 1);
  switch (kind) {
    case 'morph':
      return `Transformed from ${name('skill', rest) ?? 'a skill'}`;
    case 'spark':
      return `Sudden insight from ${name('skill', rest) ?? 'a skill'}`;
    case 'echo':
      return `Learned from the ${name('monster', rest) ?? 'monsters'}`;
    case 'fusion':
      return 'Made at a Fusion Altar';
    case 'class':
      return `${name('class', rest) ?? 'Class'} skill`;
    case 'lesson':
    case 'quest':
      return 'Quest reward';
    case 'tome':
      return `Read from ${name('item', rest) ?? 'a tome'}`;
    case 'start':
      return 'Known from the start';
    case 'debug':
      return 'Learned';
    default:
      return src ? src.charAt(0).toUpperCase() + src.slice(1) : '';
  }
}

/** Coins as players read them: "🪙 25". */
export function coinsText(n: number): string {
  return `🪙 ${n}`;
}

/** Strips tags from an HTML-ish line (for aria-labels and titles). */
export function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

/** Short reading of a fraction for progress lines: "3/8" (clamped). */
export function fraction(have: number, need: number): string {
  return `${Math.max(0, Math.min(have, need))}/${need}`;
}

/** "★★★☆☆" for rank 3 of 5 (max ranks above 10 are shown as 10 stars, filled proportionally). */
export function stars(rank: number, max: number): string {
  if (max <= 0) return '';
  const n = Math.min(10, max);
  const on = Math.max(0, Math.min(n, Math.round((rank / max) * n)));
  return '★'.repeat(on) + '☆'.repeat(n - on);
}

/**
 * A quest objective line in player words (the core writes 'Use basic skills 3/12', 'Witness Boulder Roll 1/3',
 * 'Cast dash at Greenmeadow 0/3'): the weapon's basic attack is "your attack", a witness mark is "seen".
 */
export function objectiveWords(text: string): string {
  return text
    .replace(/^Use basic skills\b/, 'Use your attack')
    .replace(/^Witness\b/, 'See')
    .replace(/^Cast dash at\b/, 'Dash in');
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

/** A skill shape in plain words ("a spin skill"): melee, spin, ranged, dash, burst, chain, buff. */
export function shapeWord(kind: string): string {
  return (
    ({ strike: 'melee', spin: 'spin', projectile: 'ranged', dash: 'dash', nova: 'burst', chain: 'chain', buff: 'buff' } as Record<string, string>)[
      kind
    ] ?? kind
  );
}

/** Monster families as players read them (the Bestiary's headings and its cards). */
const FAMILY_NAMES: Record<string, string> = {
  beast: 'Beasts',
  sprite: 'Sprites',
  construct: 'Constructs',
  revenant: 'Spirits',
  fiend: 'Fiends',
  sylvan: 'Forest folk',
  swarm: 'Swarms',
  wyrm: 'Wyrms',
};

/** "Spirits" for the revenant family ("Beasts", "Forest folk", …). */
export function familyName(family: string): string {
  return FAMILY_NAMES[family] ?? `${family.charAt(0).toUpperCase()}${family.slice(1)}s`;
}

/** Skill tags as players read them in effect lines ("Area skills hit harder."). */
const TAG_WORD: Record<string, string> = {
  aoe: 'area',
  area: 'area',
  pierce: 'piercing',
  spin: 'spinning',
  projectile: 'ranged',
  execute: 'finishing',
  infused: 'fused',
  melee: 'close-range',
  buff: 'boost',
  dot: 'lingering',
};

function capital(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * A bonus's effect in plain words (docs/UX-SIMPLE.md §2: "Blade Mastery ★★☆☆☆ — blade skills hit harder"): the
 * numbers and "per rank" go away, the effect stays. Unknown shapes fall back to the first sentence.
 */
export function effectLine(desc: string): string {
  const d = desc.trim();
  const tag = (w: string) => capital(TAG_WORD[w.toLowerCase()] ?? w.toLowerCase());
  let m: RegExpExecArray | null;
  if ((m = /\+\d+% (\w+) damage against (\w+) foes/i.exec(d))) return `${capital(m[1].toLowerCase())} hits harder on ${m[2].toLowerCase()} foes.`;
  if (/\+\d+% damage with every skill/i.test(d)) return 'Every skill hits harder.';
  if ((m = /-\d+% SP cost for (\w+) skills/i.exec(d))) return `${tag(m[1])} skills cost less SP.`;
  if ((m = /-\d+% cooldowns? for (\w+) skills/i.exec(d)) || (m = /-\d+% (\w+) cooldown/i.exec(d))) return `${tag(m[1])} skills come back faster.`;
  if ((m = /\+\d+% (\w+) damage/i.exec(d))) return `${tag(m[1])} skills hit harder.`;
  if (/regeneration while standing still/i.test(d)) return 'Heal faster while standing still.';
  if (/mastery XP for every skill/i.test(d)) return 'Every skill learns faster.';
  if ((m = /mastery XP for (\w+) skills/i.exec(d))) return `${tag(m[1])} skills learn faster.`;
  if (/\+\d+% (movement speed|SPEED)\b/.test(d)) return 'Move faster.';
  if (/\+\d+% (ATK|attack)\b/.test(d)) return 'Hit harder.';
  if (/\+\d+% MATK\b/.test(d)) return 'Stronger magic.';
  if (/\+\d+% DEF\b/.test(d)) return 'Take less damage.';
  if (/\+\d+% CRIT\b/i.test(d)) return 'Land more critical hits.';
  if (/\+\d+% (max )?HP\b/.test(d)) return 'More max HP.';
  if (/\+\d+% (max )?SP\b/.test(d)) return 'More max SP.';
  return oneLine(d);
}
