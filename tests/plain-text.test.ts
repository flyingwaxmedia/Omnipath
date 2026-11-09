// Plain words in player-facing data text (docs/UX-SIMPLE.md rules 2, 8 and 9): quest names, summaries, dialog beats,
// objective labels and flavour (src/data/quests.ts), class names, lines and hints (src/data/classes.ts) and NPC lines
// (src/data/npcs.ts) never show internal terms, and every quest dialog beat is short — at most 160 characters and 3
// sentences (the authoring target is 2 sentences, about 140 characters; flavour goes behind "More": QUEST_LORE).
// Ids, tags and code are not checked, only text a player reads. (Class tree passives are named by the core template in
// src/core/balance.ts and are not covered here.)
import { describe, expect, it } from 'vitest';
import { CLASSES } from '../src/data/classes';
import { NPCS } from '../src/data/npcs';
import { QUESTS, QUEST_LORE } from '../src/data/quests';
import { objectiveWords } from '../src/ui/words';

/** Internal term → what the player sees instead (UX-SIMPLE §1.2 / §1.8). */
const INTERNAL: [RegExp, string][] = [
  [/class rank|\bCR\b/i, 'Class Level'],
  [/\bimprints?\b/i, 'Keepsake'],
  [/\bwitness/i, '"Seen 2/3"'],
  [/\bcallings?\b/i, 'class'],
  [/\bhon(e|ed|es|ing)\b/i, 'train / raise'],
  [/\battun/i, 'find / gain an element'],
  [/\binfus/i, 'Fuse'],
  [/\btiers?\b/i, 'say it plainly'],
  [/\bmorphs?\b/i, 'Transform'],
  [/\bvariants?\b/i, 'say it plainly'],
  [/\bsparks?\b/i, 'Sudden insight'],
  [/overmaster/i, 'Mastery bar'],
  [/\bhotbar\b/i, 'bar'],
];

type Text = { where: string; text: string };

function questTexts(): Text[] {
  const out: Text[] = [];
  for (const q of QUESTS) {
    const at = (k: string) => `${q.id}.${k}`;
    out.push({ where: at('name'), text: q.name }, { where: at('summary'), text: q.summary });
    if (q.chain) out.push({ where: at('chain'), text: q.chain });
    for (const [k, v] of Object.entries(q.dialog)) out.push({ where: at(k), text: v });
    q.objectives.forEach((o, i) => o.kind === 'state' && out.push({ where: at(`objectives.${i}`), text: o.label }));
    (q.requires ?? []).forEach((r, i) => {
      const label = (r as { label?: unknown }).label;
      if (typeof label === 'string') out.push({ where: at(`requires.${i}`), text: label });
    });
  }
  for (const [id, text] of Object.entries(QUEST_LORE)) out.push({ where: `QUEST_LORE.${id}`, text });
  return out;
}

function classTexts(): Text[] {
  return CLASSES.flatMap((c) =>
    (['name', 'desc', 'hint'] as const).flatMap((k) => (typeof c[k] === 'string' ? [{ where: `${c.id}.${k}`, text: c[k] as string }] : [])),
  );
}

function npcTexts(): Text[] {
  return NPCS.flatMap((n) => [
    { where: `${n.id}.name`, text: n.name },
    ...(n.title ? [{ where: `${n.id}.title`, text: n.title }] : []),
    ...(n.lines ?? []).map((text, i) => ({ where: `${n.id}.lines.${i}`, text })),
  ]);
}

function internalWords(texts: Text[]): string[] {
  const bad: string[] = [];
  for (const { where, text } of texts)
    for (const [re, say] of INTERNAL) if (re.test(text)) bad.push(`${where}: "${text}" (say: ${say})`);
  return bad;
}

const sentences = (s: string): number => s.trim().split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe('player-facing data text uses player words', () => {
  it('quests: no internal terms in names, summaries, dialogs, objective labels or flavour', () => {
    expect(internalWords(questTexts())).toEqual([]);
  });
  it('classes and NPCs: no internal terms in names, lines or hints', () => {
    expect(internalWords([...classTexts(), ...npcTexts()])).toEqual([]);
  });
  it('the lint catches every listed term', () => {
    const samples = ['Class Rank 5', 'an Imprint', '3 witness marks', 'Wear a calling', 'Hone four', 'Attune fire', 'Infuse it', 'First Tier', 'a morph', 'a variant', 'a Spark', 'overmastery', 'your hotbar'];
    expect(samples.map((text) => internalWords([{ where: 'x', text }]).length)).toEqual(samples.map(() => 1));
    expect(internalWords([{ where: 'x', text: 'Sparkbugs at Class Level 5 with a Keepsake' }])).toEqual([]);
  });
});

describe('quest dialogs are short (UX-SIMPLE rule 9)', () => {
  it('every offer / progress / complete beat and flavour line: at most 160 characters and 3 sentences', () => {
    const long: string[] = [];
    for (const q of QUESTS)
      for (const [k, v] of Object.entries(q.dialog)) if (v.length > 160 || sentences(v) > 3) long.push(`${q.id}.${k} (${v.length} chars, ${sentences(v)} sentences)`);
    for (const [id, v] of Object.entries(QUEST_LORE)) if (v.length > 160 || sentences(v) > 3) long.push(`QUEST_LORE.${id} (${v.length})`);
    expect(long).toEqual([]);
  });
  it('flavour belongs to real quests', () => {
    const ids = new Set(QUESTS.map((q) => q.id));
    expect(Object.keys(QUEST_LORE).filter((id) => !ids.has(id))).toEqual([]);
  });
});

describe('objectiveWords', () => {
  it('rewrites the core objective lines the player would not understand', () => {
    expect(objectiveWords('Use basic skills 3/12')).toBe('Use your attack 3/12');
    expect(objectiveWords('Witness Boulder Roll 1/3 ✓')).toBe('See Boulder Roll 1/3 ✓');
    expect(objectiveWords('Cast dash at Greenmeadow 0/3')).toBe('Dash in Greenmeadow 0/3');
    expect(objectiveWords('Use heavy skills 2/20')).toBe('Use heavy skills 2/20');
  });
});
