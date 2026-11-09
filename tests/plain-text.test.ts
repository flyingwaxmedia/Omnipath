// Plain words in player-facing data text (docs/UX-SIMPLE.md rules 2, 8 and 9): quest names, summaries, dialog beats,
// objective labels and flavour (src/data/quests.ts), class names, lines and hints (src/data/classes.ts) and NPC lines
// (src/data/npcs.ts) never show internal terms, and every quest dialog beat is short — at most 160 characters and 3
// sentences (the authoring target is 2 sentences, about 140 characters; flavour goes behind "More": QUEST_LORE).
// Ids, tags and code are not checked, only text a player reads. Class tree perks and Keepsakes (named by the core
// template in src/core/balance.ts) are covered too: their names and the one line the panels show for them.
import { describe, expect, it } from 'vitest';
import { perkWord } from '../src/core/balance';
import { CLASSES, CLASS_PASSIVES } from '../src/data/classes';
import { NPCS } from '../src/data/npcs';
import { QUESTS, QUEST_LORE } from '../src/data/quests';
import { passiveLine } from '../src/ui/panels/skills';
import { effectLine, objectiveWords } from '../src/ui/words';

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

/** Class tree perks + Keepsakes: names, and the lines the class screen (effectLine) and Passives tab show. */
function perkTexts(): Text[] {
  return CLASS_PASSIVES.flatMap((p) => [
    { where: `${p.id}.name`, text: p.name },
    { where: `${p.id}.effectLine`, text: effectLine(p.desc) },
    { where: `${p.id}.passiveLine`, text: passiveLine(p) },
  ]);
}

/** Raw skill tags and template words a perk must never show (UX-SIMPLE rules 2 and 8): tag ids and manual words. */
const PERK_JARGON: [RegExp, string][] = [
  [/\baoe\b/i, 'Area'],
  [/\binfused\b/i, 'Fused'],
  [/\bexecute\b/i, 'Finisher'],
  [/\bprojectile\b/i, 'Ranged'],
  [/\bmelee\b/i, 'Close-range'],
  [/\b(buff|dot|cc|basic)\b/i, 'say it plainly'],
  [/\b(focus|economy|tempo)\b/i, 'Power / Thrift / Haste'],
  [/\bmastery\b/i, '"Mastery" is the Mastery bar and Mastery bonus: say "True <Class>"'],
  [/\d|%|per rank/i, 'no numbers in perk names and lines: stars show the rank'],
];

function jargon(texts: Text[]): string[] {
  const bad: string[] = [];
  for (const { where, text } of texts) for (const [re, say] of PERK_JARGON) if (re.test(text)) bad.push(`${where}: "${text}" (say: ${say})`);
  return bad;
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
  it('class perks and Keepsakes: plain names and lines, no tags, template words or numbers', () => {
    const texts = perkTexts();
    expect(texts.length).toBeGreaterThan(CLASSES.length * 5);
    expect(internalWords(texts)).toEqual([]);
    expect(jargon(texts)).toEqual([]);
    // Short: a perk name fits its tile (one line, ideally under 24 characters).
    expect(CLASS_PASSIVES.filter((p) => p.name.length > 24).map((p) => p.name)).toEqual([]);
    // Every perk line says what it does in words (never the raw description).
    expect(CLASS_PASSIVES.filter((p) => effectLine(p.desc) === p.desc).map((p) => p.id)).toEqual([]);
  });
  it('perk tag words: plain for the tags trees use; ids unchanged', () => {
    expect(['aoe', 'infused', 'execute', 'projectile', 'blade'].map(perkWord)).toEqual(['Area', 'Fused', 'Finisher', 'Ranged', 'Blade']);
    const ids = CLASS_PASSIVES.map((p) => p.id);
    expect(ids.every((id) => /^(cls_[a-z_]+_[1-5]|imprint_[a-z_]+)$/.test(id))).toBe(true);
    expect(CLASS_PASSIVES.find((p) => p.id === 'cls_elementalist_1')?.name).toBe('Fused Power');
    expect(CLASS_PASSIVES.find((p) => p.id === 'imprint_blademaster')?.name).toBe('Blademaster Keepsake');
    // The perk lint catches the old template names.
    const old = ['Infused Focus', 'Aoe Tempo', 'Execute Economy', 'Blademaster Mastery', 'Blademaster Imprint', '+2% blade damage per rank.'];
    expect(old.map((text) => jargon([{ where: 'x', text }]).length + internalWords([{ where: 'x', text }]).length > 0)).toEqual(old.map(() => true));
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
