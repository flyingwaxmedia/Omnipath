// Names and words of the content (docs/SPEC-v4.md §3.9, §12; docs/SPEC-v2.md §9; docs/UX-SIMPLE.md rules 1, 2, 8):
//   - originality: no banned proper noun or borrowed term in any name, line, hint or dialog of src/data;
//   - no two skills, classes, Gifts or class meters share a name, and a skill is never called what a class is;
//   - plain text: v4 content (the Bare Hands tree, class skills, Gifts, meter names and upgrade lines) is one short
//     line — at most 60 characters — and never shows an internal word; every other skill line stays within 120.
// Ids are not checked: `arcanist`, `tidecaller`, `elementalist` and `staff` stay as ids, only their shown names changed.
import { describe, expect, it } from 'vitest';
import type { ClassMechanic, SkillDef } from '../src/core/types';
import { GAME_DATA, createRegistry } from '../src/data';
import { NPCS } from '../src/data/npcs';
import { QUEST_LORE } from '../src/data/quests';
import { CLASS_SKILLS } from '../src/data/skills/classes';
import { FIST_SKILLS } from '../src/data/skills/fists';
import { WEAPONS } from '../src/data/weapons';

const reg = createRegistry();

type Text = { where: string; text: string; name?: boolean };

const PLAYER_SKILLS: SkillDef[] = reg.authoredSkills().filter((s) => !s.tags.includes('monster'));

function mechanicNames(m: ClassMechanic): string[] {
  switch (m.kind) {
    case 'stance':
      return [...m.names];
    case 'combo':
      return [m.name, m.finisher.name];
    case 'form':
      return [m.gauge.name, m.aftermath.name, ...m.stages.map((s) => s.name)];
    default:
      return [m.name];
  }
}

/** Every string of src/data a player can read. `name: true` marks names (some rules apply to names only). */
function allTexts(): Text[] {
  const out: Text[] = [];
  const add = (where: string, text: string | undefined, name = false): void => {
    if (text !== undefined && text.length > 0) out.push({ where, text, name });
  };
  for (const s of reg.authoredSkills()) {
    add(`skill ${s.id}.name`, s.name, true);
    add(`skill ${s.id}.desc`, s.desc);
    add(`skill ${s.id}.origin`, s.origin);
  }
  for (const c of reg.classes) {
    add(`class ${c.id}.name`, c.name, true);
    add(`class ${c.id}.desc`, c.desc);
    add(`class ${c.id}.hint`, c.hint);
    for (const m of [c.mechanic, c.mechanicUpgrade?.mechanic]) if (m) for (const n of mechanicNames(m)) add(`class ${c.id}.mechanic`, n, true);
    add(`class ${c.id}.upgrade`, c.mechanicUpgrade?.line);
    for (const r of c.discover?.requires ?? []) if (r.type === 'flag') add(`class ${c.id}.discover`, r.label);
  }
  for (const p of GAME_DATA.passives) {
    add(`passive ${p.id}.name`, p.name, true);
    add(`passive ${p.id}.desc`, p.desc);
  }
  for (const e of GAME_DATA.elements) {
    add(`element ${e.id}.name`, e.name, true);
    add(`element ${e.id}.desc`, e.desc);
  }
  for (const e of GAME_DATA.essences) {
    add(`essence ${e.id}.name`, e.name, true);
    add(`essence ${e.id}.desc`, e.desc);
  }
  for (const m of GAME_DATA.monsters) {
    add(`monster ${m.id}.name`, m.name, true);
    add(`monster ${m.id}.note`, m.note);
  }
  for (const i of GAME_DATA.items) {
    add(`item ${i.id}.name`, i.name, true);
    add(`item ${i.id}.desc`, i.desc);
  }
  for (const w of Object.values(WEAPONS)) {
    add(`weapon ${w.id}.name`, w.name, true);
    add(`weapon ${w.id}.blurb`, w.blurb);
  }
  for (const m of GAME_DATA.morphs) {
    add(`morph ${m.from}>${m.to}.hint`, m.hint);
    for (const r of m.requires ?? []) if (r.type === 'flag') add(`morph ${m.from}>${m.to}.requires`, r.label);
  }
  for (const r of GAME_DATA.recipes) add(`recipe ${r.a}+${r.b}.hint`, r.hint);
  for (const t of GAME_DATA.trainers) {
    add(`trainer ${t.id}.title`, t.title, true);
    for (const l of t.lessons) {
      add(`lesson ${l.id}.name`, l.name, true);
      add(`lesson ${l.id}.blurb`, l.blurb);
    }
  }
  for (const q of GAME_DATA.quests ?? []) {
    add(`quest ${q.id}.name`, q.name, true);
    add(`quest ${q.id}.summary`, q.summary);
    for (const [k, v] of Object.entries(q.dialog)) add(`quest ${q.id}.${k}`, v);
    for (const o of q.objectives) if (o.kind === 'state') add(`quest ${q.id}.objective`, o.label);
  }
  for (const [id, text] of Object.entries(QUEST_LORE)) add(`lore ${id}`, text);
  for (const n of NPCS) {
    add(`npc ${n.id}.name`, n.name, true);
    add(`npc ${n.id}.title`, n.title);
    for (const line of n.lines ?? []) add(`npc ${n.id}.line`, line);
  }
  return out;
}

/** Banned everywhere: another game's proper nouns and terms (SPEC-v2 §9), the "never take" column of SPEC-v4 §3.9. */
const BANNED: [RegExp, string][] = [
  [/\b(ragnarok|prontera|payon|geffen|morroc|izlude|aldebaran|poring|poporing|kafra|zeny|baphomet)\b/i, 'SPEC-v2 §9'],
  [/\bMVP\b/, 'SPEC-v2 §9'],
  [/\bblue magic\b|\bglimmer\b/i, 'SPEC-v2 §9'],
  [/\bsymbiote|\bshadow priest\b|\bvoidform\b|\binsanity\b/i, 'SPEC-v4 §3.9'],
  [/\bjutsu\b|\bmudra\b|\bhand[- ]signs?\b|\bshinobi\b|\bninjas?\b/i, 'SPEC-v4 §3.9'],
  [/\bdemon slayer\b|\bhaori\b|\bcorps\b|\bhashira\b/i, 'SPEC-v4 §3.9'],
  [/\b(first|second|third|fourth|fifth|sixth|seventh|\d+(st|nd|rd|th))\s+(form|breath)\b|\bbreathing style\b/i, 'SPEC-v4 §3.9: numbered forms'],
  // Names this game renamed or rejected for colliding with well-known ones.
  [/\b(nightblade|arcanist|tidecaller|elementalist|echo blade|mistveil|emberheart|umbral host|hundred hands)\b/i, 'SPEC-v4 §3.9: renamed'],
  [/\b(flash cut|hearthstone|homestone|shadow step|chidori)\b/i, 'SPEC-v4 §3.9: rejected'],
];
/** Banned in names only: words that are fine in a sentence but not as what something is called. */
const BANNED_NAMES: [RegExp, string][] = [
  [/^venom$/i, 'SPEC-v4 §3.9'],
  [/\bvoid\b/i, 'SPEC-v4 §3.9'],
  [/^mind[- ]?\w/i, 'SPEC-v4 §3.9: "mind"-prefixed names'],
  [/\bbreathing\b|\bcrucible\b|\bsymbiotic\b/i, 'SPEC-v4 §3.9'],
];

/** Internal word → what the player sees instead (SPEC-v4 §12, UX-SIMPLE §1.2 / §1.8). */
const INTERNAL: [RegExp, string][] = [
  [/\bstaff\b|\bstaves\b/i, 'Rod'],
  [/\bfists weapon\b|\bfist skill/i, 'Bare Hands'],
  [/\bgrip\b|weapon-bound|\bclassOf\b|\bautoRule\b/i, 'never shown'],
  [/\bkit skills?\b|\bclass kit\b/i, 'Class skills'],
  [/\bsignature\b/i, 'Class skills'],
  [/\b(mechanic|gauge|delivery|hpCost)\b/i, 'never shown'],
  [/class rank|\bCR\b/i, 'Class Level'],
  [/\bimprints?\b/i, 'Keepsake'],
  [/\battun/i, 'know / find an element'],
  [/\binfus/i, 'Fuse'],
  [/\btiers?\b/i, 'say it plainly'],
  [/\bmorphs?\b/i, 'Transform'],
  [/\bvariants?\b/i, 'say it plainly'],
  [/overmaster/i, 'Mastery bar'],
  [/\bhotbar\b/i, 'bar'],
];

const hitsOf = (texts: readonly Text[], rules: readonly [RegExp, string][]): string[] =>
  texts.flatMap(({ where, text }) => rules.filter(([re]) => re.test(text)).map(([, why]) => `${where}: "${text}" (${why})`));

describe('originality (SPEC-v2 §9, SPEC-v4 §3.9)', () => {
  const texts = allTexts();

  it('reads every player-facing string of the data', () => {
    expect(texts.length).toBeGreaterThan(1500);
    expect(texts.filter((t) => t.name).length).toBeGreaterThan(450);
  });

  it('no banned proper noun or borrowed term anywhere', () => {
    const bad = hitsOf(texts, BANNED);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('no banned word in a name', () => {
    const bad = hitsOf(texts.filter((t) => t.name), BANNED_NAMES);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('the renamed classes show their new names', () => {
    const shown = Object.fromEntries(['assassin', 'arcanist', 'tidecaller', 'elementalist'].map((id) => [id, reg.classDef(id)!.name]));
    expect(shown).toEqual({ assassin: 'Hushblade', arcanist: 'Spellwright', tidecaller: 'Tidereader', elementalist: 'Prismcaller' });
    expect(WEAPONS.staff.name).toBe('Oak Rod');
    expect(WEAPONS.fists.name).toBe('Bare Hands');
  });

  it('the lint catches what it bans', () => {
    const t = (text: string, name = false): Text[] => [{ where: 'x', text, name }];
    for (const s of ['A Kafra', 'the Nightblade', 'Third Form', 'a secret jutsu', 'Shadow Step', 'the survey corps', '2nd form']) {
      expect(hitsOf(t(s), BANNED), s).toHaveLength(1);
    }
    for (const s of ['Venom', 'Void Bolt', 'Mind Flay', 'Total Concentration Breathing']) expect(hitsOf(t(s, true), BANNED_NAMES), s).toHaveLength(1);
    expect(hitsOf(t('Venom Edge', true), BANNED_NAMES)).toEqual([]);
    expect(hitsOf(t('Sword forms that breathe like a bellows.'), BANNED)).toEqual([]);
    expect(hitsOf(t('Umbral Step', true), [...BANNED, ...BANNED_NAMES])).toEqual([]);
  });
});

describe('no two things share a name', () => {
  const dup = (names: readonly { id: string; name: string }[]): string[] => {
    const seen = new Map<string, string[]>();
    for (const n of names) seen.set(n.name.trim().toLowerCase(), [...(seen.get(n.name.trim().toLowerCase()) ?? []), n.id]);
    return [...seen].filter(([, ids]) => ids.length > 1).map(([name, ids]) => `"${name}": ${ids.join(', ')}`);
  };

  it('skills (monster moves included)', () => {
    const bad = dup(reg.authoredSkills());
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('classes, and no skill is called what a class is', () => {
    expect(dup(reg.classes)).toEqual([]);
    const classNames = new Set(reg.classes.map((c) => c.name.toLowerCase()));
    expect(reg.authoredSkills().filter((s) => classNames.has(s.name.toLowerCase())).map((s) => s.id)).toEqual([]);
  });

  it('Gifts and other passives; class meters', () => {
    // The old class tree perks share their template names ("Fire Power"); the rules no longer use them.
    expect(dup(GAME_DATA.passives.filter((p) => !p.id.startsWith('cls_')))).toEqual([]);
    const skillNames = new Set(reg.authoredSkills().map((s) => s.name.toLowerCase()));
    const gifts = reg.classes.flatMap((c) => (c.passive ? [reg.passive(c.passive)!] : []));
    expect(gifts.filter((p) => skillNames.has(p.name.toLowerCase())).map((p) => p.id)).toEqual([]);
    // A meter is never called what a skill of ANOTHER class is called (Roadhouse is both the Wayfarer's hit and skill).
    for (const c of reg.classes) {
      if (!c.mechanic) continue;
      for (const n of mechanicNames(c.mechanic)) {
        const clash = PLAYER_SKILLS.find((s) => s.name.toLowerCase() === n.toLowerCase() && !((c.kit ?? []) as readonly string[]).includes(s.id));
        expect(clash?.id, `${c.id}: ${n}`).toBeUndefined();
      }
    }
  });
});

describe('plain text (UX-SIMPLE rules 1 and 2, SPEC-v4 §12)', () => {
  const v4Skills = [...FIST_SKILLS, ...CLASS_SKILLS];
  const gifts = reg.classes.flatMap((c) => (c.passive ? [reg.passive(c.passive)!] : []));

  it('v4 skills and Gifts: one line of at most 60 characters, a name of at most 3 words', () => {
    expect(v4Skills).toHaveLength(13 + 40);
    const long = [...v4Skills, ...gifts].filter((x) => x.desc.length > 60).map((x) => `${x.id} (${x.desc.length}): ${x.desc}`);
    expect(long, long.join('\n')).toEqual([]);
    expect([...v4Skills, ...gifts].filter((x) => x.name.split(/\s+/).length > 3).map((x) => x.name)).toEqual([]);
    expect([...v4Skills, ...gifts].filter((x) => !/[.!?]$/.test(x.desc)).map((x) => x.id)).toEqual([]);
  });

  it('every other skill line fits its card: at most 120 characters', () => {
    const long = PLAYER_SKILLS.filter((s) => s.desc.length > 120).map((s) => `${s.id} (${s.desc.length})`);
    expect(long, long.join('\n')).toEqual([]);
  });

  it('skills, Gifts, weapons and class lines never show an internal word', () => {
    const texts: Text[] = [
      ...PLAYER_SKILLS.flatMap((s) => [
        { where: `skill ${s.id}.name`, text: s.name },
        { where: `skill ${s.id}.desc`, text: s.desc },
      ]),
      ...gifts.flatMap((p) => [
        { where: `gift ${p.id}.name`, text: p.name },
        { where: `gift ${p.id}.desc`, text: p.desc },
      ]),
      ...Object.values(WEAPONS).flatMap((w) => [
        { where: `weapon ${w.id}.name`, text: w.name },
        { where: `weapon ${w.id}.blurb`, text: w.blurb },
      ]),
      ...reg.classes.flatMap((c) => [
        { where: `class ${c.id}.desc`, text: c.desc },
        { where: `class ${c.id}.hint`, text: c.hint },
        ...(c.mechanicUpgrade ? [{ where: `class ${c.id}.upgrade`, text: c.mechanicUpgrade.line }] : []),
        ...(c.discover?.requires ?? []).flatMap((r) => (r.type === 'flag' && r.label ? [{ where: `class ${c.id}.discover`, text: r.label }] : [])),
      ]),
      ...GAME_DATA.morphs.flatMap((m) => (m.hint ? [{ where: `morph ${m.from}>${m.to}`, text: m.hint }] : [])),
      ...GAME_DATA.recipes.flatMap((r) => (r.hint ? [{ where: `recipe ${r.a}+${r.b}`, text: r.hint }] : [])),
      ...GAME_DATA.items.map((i) => ({ where: `item ${i.id}`, text: i.desc })),
    ];
    const bad = hitsOf(texts, INTERNAL);
    expect(bad, bad.join('\n')).toEqual([]);
  });

  it('every requirement counter a class or Transform shows has a plain label', () => {
    const bare: string[] = [];
    for (const c of reg.classes) for (const r of c.discover?.requires ?? []) if (r.type === 'flag' && !r.label) bare.push(`class ${c.id}: ${r.id}`);
    for (const m of GAME_DATA.morphs) for (const r of m.requires ?? []) if (r.type === 'flag' && !r.label) bare.push(`morph ${m.to}: ${r.id}`);
    expect(bare).toEqual([]);
  });

  it('the lint catches the internal words', () => {
    for (const s of ['Swing your staff', 'a grip tag', 'Class signature.', 'First Tier', 'a morph', 'Infuse it', 'the gauge fills']) {
      expect(hitsOf([{ where: 'x', text: s }], INTERNAL).length, s).toBeGreaterThan(0);
    }
    expect(hitsOf([{ where: 'x', text: 'Raise your rod and throw a bolt.' }], INTERNAL)).toEqual([]);
  });
});
