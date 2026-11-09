// One clear next step, in plain words (docs/UX-SIMPLE.md rule 4, docs/INTEGRATION-v3.md §7): the game lane's wording
// for requirements, transforms, unknown skills, unknown elements and locked classes. Each function returns ONE short
// sentence — the first unmet thing only, never a checklist, never tags / tiers / ids / "CR".
// Pure over the registry and the book (unit-tested in tests/game-steps.test.ts).
import { countTagged } from '../core/requirements';
import type { Registry } from '../core/registry';
import type { SkillBook } from '../core/skillbook';
import type { ElementId, Requirement } from '../core/types';
import { NPCS } from '../data/npcs';
import { WEAPONS } from '../data/weapons';
import { mapById } from '../data/world';
import { article, seen } from '../ui/words';

const NPC_NAME = new Map(NPCS.map((n) => [n.id, n.name]));

/** Where each primal element is found (one line). Fused elements come from the altar. */
const ELEMENT_WHERE: Partial<Record<ElementId, string>> = {
  fire: "Forge 3 fine pieces at Brann's anvil in Hearthvale.",
  water: 'Catch 3 fish at Mirror Lake.',
  earth: 'Mine 10 ore at Greystone Quarry.',
  wind: 'Meditate at the Shrine of Winds on Windcrest Hill.',
  shadow: 'Defeat 5 Gloomcaps, then touch the obelisk in Gloomwood.',
  holy: 'Find 3 elements, then visit Sister Alba.',
  lightning: 'Defeat Thunderhoof at Stormbreak.',
};

/** Tag words that describe a skill's form go last: "fire blade skill", "piercing projectile skill". */
const FORM_TAGS = ['blade', 'projectile', 'spin', 'dash', 'strike', 'nova', 'chain'];
const TAG_WORD: Record<string, string> = { pierce: 'piercing', execute: 'finishing', buff: 'boost', spin: 'spinning' };

/** "fire blade" for ['blade', 'fire']. */
export function tagWords(tags: readonly string[]): string {
  const sorted = [...tags].sort((a, b) => Number(FORM_TAGS.includes(a)) - Number(FORM_TAGS.includes(b)));
  return sorted.map((t) => TAG_WORD[t] ?? t.replace(/_/g, ' ')).join(' ');
}

const sentence = (s: string): string => (/[.!?)]$/.test(s) ? s : `${s}.`);
const skills = (n: number) => (n === 1 ? 'skill' : 'skills');

/**
 * One requirement as a short imperative, without a final period: "Reach Whirlwind rank 5", "Find the Wind element",
 * "Learn 1 more fire skill", "Reach Class Level 6 as Spellblade", "Visit Moonlit Glade". `selfId` = the skill the
 * step is about ("Reach rank 10" instead of "Reach Whirlwind rank 10").
 */
export function reqStep(reg: Registry, book: SkillBook, req: Requirement, selfId?: string): string {
  switch (req.type) {
    case 'element':
      return `Find the ${reg.element(req.id)?.name ?? 'missing'} element`;
    case 'elementsKnown': {
      const have = book.knownElements().filter((e) => !req.primalOnly || e.tier === 0).length;
      const more = Math.max(1, req.count - have);
      return `Find ${more} more element${more === 1 ? '' : 's'}`;
    }
    case 'skill': {
      const name = reg.skill(req.id)?.name ?? 'that skill';
      const rank = req.rank ?? 1;
      if (!book.has(req.id)) return `Learn ${name}`;
      return req.id === selfId ? `Reach rank ${rank}` : `Reach ${name} rank ${rank}`;
    }
    case 'flag':
      return req.label ?? 'Keep exploring';
    case 'level':
      return `Reach level ${req.min}`;
    case 'class': {
      const name = reg.classDef(req.id)?.name ?? 'that class';
      const have = book.state.classes[req.id]?.rank ?? 0;
      if (!have) return `Unlock the ${name} class`;
      if (req.rank && have < req.rank) return `Reach Class Level ${req.rank} as ${article(name)}`;
      return `Become ${article(name)}`;
    }
    case 'tagCount': {
      const min = req.minRank ?? 1;
      const have = countTagged(reg, book.state.skills, req.tags, min);
      const more = Math.max(1, req.count - have);
      if (!req.tags.length) return min > 1 ? `Get ${more === 1 ? 'any skill' : `${more} more skills`} to rank ${min}` : `Learn ${more} more ${skills(more)}`;
      const what = `${more} more ${tagWords(req.tags)} ${skills(more)}`;
      return min > 1 ? `Get ${what} to rank ${min}` : `Learn ${what}`;
    }
    case 'item':
      return `Collect ${req.count} ${reg.item(req.id)?.name ?? 'of them'}`;
    case 'lesson': {
      const quest = book.lessonState(req.id).quest;
      const q = quest ? reg.quest(quest) : undefined;
      return q ? `Finish the quest ${q.name}` : `Learn ${reg.lesson(req.id)?.lesson.name ?? 'that lesson'}`;
    }
    case 'mapVisited':
      return `Visit ${mapById(req.id)?.name ?? 'a hidden place'}`;
    case 'witness': {
      const name = reg.skill(req.skill)?.name ?? 'it';
      return `Watch a monster use ${name} (${seen(book.state.witness[req.skill] ?? 0, req.count)})`;
    }
  }
}

/** The first unmet requirement of a list as a sentence ('' when all are met). */
export function firstStep(reg: Registry, book: SkillBook, reqs: readonly Requirement[], selfId?: string): string {
  const r = reqs.find((x) => !book.meets(x));
  return r ? sentence(reqStep(reg, book, r, selfId)) : '';
}

/**
 * The one step toward this known skill's next transform ("Reach rank 10 to transform.", "Mine 6 ore to
 * transform."), or null when it has nothing left to transform into or can transform right now.
 */
export function transformStep(reg: Registry, book: SkillBook, skillId: string): string | null {
  const sk = reg.skill(skillId);
  const p = book.progress(skillId);
  if (!sk || !p) return null;
  const open = book.morphOptions(skillId).filter((o) => !o.owned);
  if (!open.length || book.canMorph(skillId)) return null;
  if (p.rank < sk.maxRank) return `Reach rank ${sk.maxRank} to transform.`;
  // The nearest branch: fewest unmet requirements.
  const near = [...open].sort((a, b) => a.requirements.filter((r) => !r.ok).length - b.requirements.filter((r) => !r.ok).length)[0];
  const miss = (near.morph.requires ?? []).find((r) => !book.meets(r));
  if (miss) return `${reqStep(reg, book, miss, skillId)} to transform.`;
  if (p.charges <= 0) return 'Fill the Mastery bar to transform again.';
  return null;
}

/** How to learn a skill the player does not know yet — the one way, in plain words. */
export function learnStep(reg: Registry, book: SkillBook, skillId: string): string {
  const sk = reg.skill(skillId);
  if (!sk) return 'Keep exploring to find it.';
  const weapon = Object.values(WEAPONS).find((w) => w.basic === skillId);
  if (weapon) return `Comes with the ${weapon.name}.`;
  if (sk.tags.includes('monster')) return 'Only monsters use this.';
  // Quests (trainer lessons are quest rewards).
  for (const q of reg.quests.values()) {
    const g = q.rewards.lesson ? reg.lesson(q.rewards.lesson)?.lesson.grants : undefined;
    if (q.rewards.skill === skillId || (g && 'skill' in g && g.skill === skillId)) {
      return `A quest from ${NPC_NAME.get(q.giver) ?? 'someone in town'} teaches it.`;
    }
  }
  for (const it of reg.items.values()) if (it.kind === 'tome' && it.skill === skillId) return `Find the ${it.name}.`;
  const morph = reg.morphsTo(skillId)[0];
  if (morph) {
    const parent = reg.skill(morph.from);
    const pname = parent?.name ?? 'another skill';
    if (!book.has(morph.from)) return `Transform ${pname} to learn it.`;
    const p = book.progress(morph.from)!;
    if (parent && p.rank < parent.maxRank) return `Reach ${pname} rank ${parent.maxRank}, then transform it.`;
    const miss = (morph.requires ?? []).find((r) => !book.meets(r));
    if (miss) return `${reqStep(reg, book, miss, morph.from)}, then transform ${pname}.`;
    return `Transform ${pname} to learn it.`;
  }
  const teacher = reg.techniqueSources(skillId).find((t) => t.technique.echo);
  if (teacher) {
    const need = teacher.technique.echo!.marks;
    return `Let ${article(teacher.monster.name)} use it on you, then defeat it (${seen(book.state.witness[skillId] ?? 0, need)}).`;
  }
  const sig = reg.classes.find((c) => c.grants?.includes(skillId));
  if (sig) return `Unlock the ${sig.name} class.`;
  const tree = reg.classes.find((c) => (c.tree ?? []).some((n) => n.kind === 'skill' && n.ref === skillId));
  if (tree) return `Earn it as ${article(tree.name)}.`;
  if (reg.recipeList.some((r) => r.result === `skill:${skillId}`)) return 'Discover it by fusing at an altar.';
  if (sk.generated || skillId.includes('@')) {
    const base = reg.baseOf(skillId);
    const bname = base && base !== skillId ? reg.skill(base)?.name : undefined;
    return bname ? `Fuse ${bname} with an element at an altar.` : 'Discover it by fusing at an altar.';
  }
  return 'Keep exploring to find it.';
}

/** How to find an element the player has not attuned yet. */
export function elementStep(reg: Registry, id: ElementId): string {
  const el = reg.element(id);
  if (!el) return 'Keep exploring.';
  return ELEMENT_WHERE[id] ?? (el.tier === 1 ? 'Fuse two elements at an altar.' : 'Keep exploring.');
}

/** ONE hint for a locked class: the riddle until it is close, then its first unmet goal. */
export function classGoal(reg: Registry, book: SkillBook, classId: string): string {
  const cls = reg.classDef(classId);
  if (!cls) return '';
  const v = book.classProgress(cls);
  if (v.codex !== 'near') return cls.hint;
  const clause = v.clauses.find((c) => c.have < c.clause.count);
  if (clause) {
    const more = clause.clause.count - clause.have;
    return `Learn ${more} more ${tagWords(clause.clause.tags)} ${skills(more)}.`;
  }
  const parent = v.parents?.find((p) => p.have < p.need);
  if (parent) return `Reach Class Level ${parent.need} as ${article(reg.classDef(parent.id)?.name ?? 'its parent')}.`;
  if (v.elements && v.elements.have < v.elements.need) {
    const more = v.elements.need - v.elements.have;
    return `Learn skills of ${more} more element${more === 1 ? '' : 's'}.`;
  }
  return firstStep(reg, book, cls.requires ?? []) || cls.hint;
}
