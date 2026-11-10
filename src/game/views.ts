// GameController v3 views (game lane; docs/INTEGRATION-v3.md §5). MapScene delegates every v3 controller method
// here in one line, so the scene stays a thin host. Everything returned is plain data in plain words
// (docs/UX-SIMPLE.md): ids only as keys. The one-step wording lives in ./steps.ts, the bar rules in ./loadout.ts.
import { CLASS_SLOTS, barEligible, canBuyNode, classMaxRank, classXpNeed } from '../core/classes';
import type { QuestView } from '../core/skillbook';
import type { ElementId, QuestDef, QuestReward, Requirement } from '../core/types';
import { NPCS } from '../data/npcs';
import { QUEST_LORE } from '../data/quests';
import { WEAPONS } from '../data/weapons';
import { MAPS, mapById } from '../data/world';
import type {
  BarSlotView,
  ChangeKind,
  ClassCardView,
  MenuBadgesView,
  ClassScreenView,
  NpcQuestView,
  NpcQuestsView,
  Outcome,
  PursuitView,
  QuestCardView,
  QuestLogView,
  QuestRewardView,
  QuestTurnInView,
  QuickSlotsView,
  SkillCardAction,
  SkillCardView,
  SlotPickerView,
  UnlocksView,
  WornClassView,
  ZoneView,
} from '../ui/controller';
import { bandText, shapeText } from '../ui/util';
import { article, objectiveWords, seen } from '../ui/words';
import { classColor } from './art/icons';
import { gameBus } from './events';
import { becomeRefill, classSlotsFor, noteWorn, refillClassSlots, wornFlag } from './loadout';
import { classGoal, elementStep, firstStep, learnStep, tagWords, transformStep } from './steps';
import type { MapScene } from './scenes/MapScene';
import { cellExplored, compiled, fogBits, fogDims, FOG_CELL } from './world/runtime';
import { COLL } from '../core/world/types';

const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));
/** NPC id -> the map it stands in. */
const NPC_MAP = new Map<string, string>();
for (const m of MAPS) for (const p of m.npcs ?? []) if (!NPC_MAP.has(p.npc)) NPC_MAP.set(p.npc, m.id);

/** Learned within this much play time and not on the bar: "new" in the picker. */
const FRESH_MS = 5 * 60 * 1000;

const firstSentence = (s: string): string => {
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return (m ? m[1] : s).trim();
};

// ====================================================================== change feed

/** Run-wide change feed for the UI (bar / class / quests / skills). */
export function onChange(s: MapScene, fn: (what: ChangeKind) => void): () => void {
  const offs = [
    gameBus.on('barChanged', () => fn('bar')),
    gameBus.on('classChanged', () => fn('class')),
    gameBus.on('questChanged', () => fn('quests')),
    gameBus.on('skillLearned', () => fn('skills')),
    s.book.events.on('rankUp', () => fn('skills')),
    s.book.events.on('morphed', () => fn('skills')),
    s.book.events.on('fused', () => fn('skills')),
    s.book.events.on('charge', () => fn('skills')),
  ];
  return () => offs.forEach((off) => off());
}

// ====================================================================== skill bar

/** Class slots on the bar right now (0 with no class worn). */
export function classSlotCount(s: MapScene): number {
  return s.book.state.worn ? Math.min(CLASS_SLOTS, s.session.player.hotbar.length) : 0;
}

export function barSlots(s: MapScene): BarSlotView[] {
  const worn = s.book.state.worn;
  const n = classSlotCount(s);
  return s.session.player.hotbar.map((skillId, index) => {
    const sk = skillId ? s.reg.skill(skillId) : undefined;
    return {
      index,
      skillId,
      kind: index < n ? 'class' : 'own',
      ...(index < n && worn ? { classId: worn } : {}),
      key: String(index + 1),
      ...(sk
        ? {
            name: sk.name,
            rank: s.book.rank(sk.id),
            maxRank: sk.maxRank,
            ...(sk.element ? { element: sk.element } : {}),
            transformReady: s.book.has(sk.id) && s.book.canMorph(sk.id),
          }
        : {}),
    };
  });
}

/** Whether a skill may sit on the bar at all. */
function eligible(s: MapScene, id: string): boolean {
  const sk = s.reg.skill(id);
  return !!sk && s.book.has(id) && barEligible(sk);
}

export function equipSkill(s: MapScene, skillId: string, slot?: number): Outcome {
  const sk = s.reg.skill(skillId);
  if (!sk || !eligible(s, skillId)) return { ok: false, message: sk ? `${sk.name} can't go on the bar.` : 'Unknown skill.' };
  const bar = s.session.player.hotbar;
  const first = classSlotCount(s);
  const at = bar.indexOf(skillId);
  if (slot === undefined && at >= 0) return { ok: true, message: `${sk.name} is already equipped.` };
  let target = slot;
  if (target === undefined) {
    target = -1;
    for (let i = first; i < bar.length; i++) {
      if (bar[i] === null) {
        target = i;
        break;
      }
    }
    if (target < 0) return { ok: false, message: 'Your slots are full. Pick one to replace.' };
  }
  if (target < first || target >= bar.length) return { ok: false, message: 'Your class fills that slot.' };
  s.assignSlot(target, skillId);
  // Taken out of a class slot? The class fills the gap with its next pick.
  if (refillClassSlots(s.session, 'assign', { stable: true }).length) s.save();
  return { ok: true, message: `Equipped ${sk.name}.` };
}

export function clearSlot(s: MapScene, slot: number): void {
  if (slot < classSlotCount(s) || slot >= s.session.player.hotbar.length) return;
  const id = s.session.player.hotbar[slot];
  if (!id) return;
  s.assignSlot(slot, null, 'clear');
  // A class skill freed from your slot goes back to the class when it would pick it.
  if (refillClassSlots(s.session, 'assign', { stable: true }).length) s.save();
}

export function slotPicker(s: MapScene, slot: number): SlotPickerView {
  const bar = s.session.player.hotbar;
  const now = s.book.now();
  const choices = s.book
    .known()
    .filter((sk) => barEligible(sk))
    .map((sk) => ({ sk, at: s.book.progress(sk.id)?.learnedAt ?? 0 }))
    .sort((a, b) => b.at - a.at || (a.sk.name < b.sk.name ? -1 : 1))
    .map(({ sk, at }) => {
      const where = bar.indexOf(sk.id);
      return { skillId: sk.id, name: sk.name, fresh: where < 0 && now - at < FRESH_MS, slot: where >= 0 ? where : null };
    });
  return { slot, current: bar[slot] ?? null, choices };
}

// ====================================================================== skill card

/** The card of an element star ('el:<id>', The Heart). */
function elementCard(s: MapScene, id: string): SkillCardView {
  const el = s.reg.element(id.slice(3) as ElementId);
  const known = !!el && s.book.hasElement(el.id);
  const base = { id, kind: 'element' as const, rank: 0, maxRank: 0, progress: 0, cooldown: 0, sp: 0, transformReady: false, details: [] };
  if (!el) return { ...base, name: '?', line: 'An unknown element.', known: false, action: { kind: 'none' } };
  return {
    ...base,
    name: known ? el.name : '?',
    line: known ? firstSentence(el.desc) : 'An element you have not found yet.',
    element: el.id,
    known,
    action: known ? { kind: 'none' } : { kind: 'step', text: elementStep(s.reg, el.id) },
  };
}

export function skillCard(s: MapScene, id: string): SkillCardView {
  if (id.startsWith('el:')) return elementCard(s, id);
  const sk = s.reg.skill(id);
  if (!sk) {
    return { id, kind: 'skill', name: '?', line: 'An unknown skill.', known: false, rank: 0, maxRank: 0, progress: 0, cooldown: 0, sp: 0, transformReady: false, action: { kind: 'none' }, details: [] };
  }
  const book = s.book;
  const known = book.has(id);
  const prog = book.progress(id);
  const rank = prog?.rank ?? 0;
  const bar = s.session.player.hotbar;
  const slot = bar.indexOf(id);
  const worn = book.state.worn ? s.reg.classDef(book.state.worn) : undefined;
  const opts = known ? book.morphOptions(id) : [];
  const ready = known && book.canMorph(id);
  let action: SkillCardAction;
  let next: string | undefined;
  if (!known) action = { kind: 'step', text: learnStep(s.reg, book, id) };
  else if (ready) {
    const to = opts.find((o) => o.available && !o.owned && o.skill)!;
    action = { kind: 'transform', to: to.morph.to, toName: to.skill!.name };
  } else if (slot >= 0) action = { kind: 'equipped', slot, ...(slot < classSlotCount(s) && worn ? { byClass: worn.name } : {}) };
  else if (barEligible(sk)) action = { kind: 'equip' };
  else action = { kind: 'step', text: 'Your weapon swings this by itself.' };
  // The one next step toward a transform ("Reach rank 10 to transform.").
  if (known && !ready) next = transformStep(s.reg, book, id) ?? undefined;
  const w = WEAPONS[s.session.player.weapon];
  const spCost = s.combat ? s.combat.spCost(sk) : sk.spCost;
  const el = sk.element ? s.reg.element(sk.element) : undefined;
  const details: { label: string; value: string }[] = [
    { label: 'How it hits', value: shapeText(sk.shape) },
    { label: 'Power', value: `${Math.round(sk.power * 100)}%` },
  ];
  if (el) details.push({ label: 'Element', value: el.name });
  return {
    id,
    kind: 'skill',
    name: sk.name,
    line: firstSentence(sk.desc),
    element: sk.element,
    known,
    rank,
    maxRank: sk.maxRank,
    progress: prog ? Math.min(1, prog.xp / Math.max(1, book.barSize(id))) : 0,
    cooldown: Math.round((sk.cooldown || w.delay) / 100) / 10,
    sp: spCost,
    transformReady: ready,
    action,
    ...(next ? { next } : {}),
    details,
  };
}

// ====================================================================== classes

function classCard(s: MapScene, id: string): ClassCardView | null {
  const cls = s.reg.classDef(id);
  if (!cls) return null;
  const book = s.book;
  const prog = book.state.classes[id];
  const worn = book.state.worn === id;
  const max = classMaxRank(cls);
  const card: ClassCardView = {
    id,
    name: cls.name,
    line: firstSentence(cls.desc),
    state: worn ? 'current' : prog ? 'unlocked' : 'locked',
    level: prog?.rank ?? 0,
    maxLevel: max,
    levelProgress: prog ? (prog.rank >= max ? 1 : Math.min(1, prog.xp / classXpNeed(cls, prog.rank))) : 0,
    color: classColor(id),
    skills: book.classSkills(id, CLASS_SLOTS),
  };
  if (!prog) {
    card.hint = classHint(s, id);
    // Until it is close its name stays a mystery ('???'): only the one step shows, the riddle lives in the Codex.
    card.mystery = book.classProgress(cls).codex !== 'near';
  }
  return card;
}

/**
 * ONE short hint line for a locked class (docs/UX-SIMPLE.md rules 1 / 4): its first unmet goal ("Learn 2 more
 * spinning skills.") — close or not. The riddle itself only lives in Codex > Whispers.
 */
function classHint(s: MapScene, id: string): string {
  const cls = s.reg.classDef(id);
  const goal = classGoal(s.reg, s.book, id);
  if (!cls || goal !== cls.hint) return goal;
  // classGoal answers with the riddle until the class is close: take the same first step it gives once close.
  const v = s.book.classProgress(cls);
  const clause = v.clauses.find((c) => c.have < c.clause.count);
  if (clause) {
    const more = clause.clause.count - clause.have;
    return `Learn ${more} more ${tagWords(clause.clause.tags)} skill${more === 1 ? '' : 's'}.`;
  }
  const parent = v.parents?.find((p) => p.have < p.need);
  if (parent) return `Reach Class Level ${parent.need} as ${article(s.reg.classDef(parent.id)?.name ?? 'its parent')}.`;
  if (v.elements && v.elements.have < v.elements.need) {
    const more = v.elements.need - v.elements.have;
    return `Learn skills of ${more} more element${more === 1 ? '' : 's'}.`;
  }
  return firstStep(s.reg, s.book, cls.requires ?? []) || goal;
}

export function classCards(s: MapScene): ClassScreenView {
  const book = s.book;
  const cards = s.reg.classes
    .filter((c) => !c.hidden || book.state.classes[c.id])
    .map((c) => classCard(s, c.id)!)
    .filter(Boolean);
  const current = cards.find((c) => c.state === 'current') ?? null;
  const unlocked = cards.filter((c) => c.state === 'unlocked');
  // Still to find: only classes whose parent classes you already have (a Tier III riddle means nothing at level 1).
  const locked = s.reg.classes
    .filter((c) => !book.state.classes[c.id] && !c.hidden && (c.parents ?? []).every((p) => !!book.state.classes[p.id]))
    .map((c) => ({ c, v: book.classProgress(c) }))
    .filter(({ v }) => v.codex !== 'unknown')
    .sort((a, b) => b.v.progress - a.v.progress)
    .map(({ c }) => cards.find((x) => x.id === c.id)!)
    .filter(Boolean);
  // SPEC-v2 §5.1 v3.1: becoming a class works any time, anywhere — only a fight or being knocked out blocks it.
  const block = classChangeBlock(s);
  return { current, unlocked, locked, canChange: !block, ...(block ? { changeHint: block } : {}) };
}

/** Why the class cannot change right now (one line), or null: only mid-fight or while knocked out. */
export function classChangeBlock(s: MapScene): string | null {
  if (s.combat?.dead) return 'Not while you are down.';
  if (s.inCombat()) return 'Finish the fight first.';
  return null;
}

/**
 * Becomes a class (or "No class" with null) — the ONE path for becomeClass and wearClass. Becoming a class refills
 * the 5 class slots with its most relevant known skills (a class pick sitting in one of your slots moves in and frees
 * that slot; your other picks stay; the skills it pushes out move into your empty slots, and a slot of yours still
 * empty takes your most recently used skill that is not on the bar) and emits classChanged (the "You are now a Pyroblade" headline, the outfit
 * change). "No class" turns the class slots into your own slots, keeping their skills.
 */
export function becomeClass(s: MapScene, id: string | null): Outcome {
  const block = classChangeBlock(s);
  if (block) return { ok: false, message: block };
  const book = s.book;
  const prev = book.state.worn;
  if (id === null) {
    if (prev === null) return { ok: true, message: 'You have no class.' };
    book.unwear();
    s.afterClassChange();
    // A class that became discoverable just now is worn at once (the book's own rule): its discovery path ran.
    const now = book.state.worn ? s.reg.classDef(book.state.worn) : undefined;
    if (now) return { ok: true, message: `You are now ${article(now.name)}.` };
    gameBus.emit('barChanged', { slots: [...Array(classSlotsFor(prev, s.session.player.hotbar.length)).keys()], reason: 'class' });
    gameBus.emit('classChanged', { classId: null, prev, reason: 'wear' });
    return { ok: true, message: `No class: all ${s.session.player.hotbar.length} slots are yours.` };
  }
  const cls = s.reg.classDef(id);
  if (!cls || !book.state.classes[id]) return { ok: false, message: 'You have not unlocked that class yet.' };
  if (prev === id) return { ok: true, message: `You are already ${article(cls.name)}.` };
  const r = book.wear(id);
  if (!r.ok) return r;
  // Skills the class pushes out of the class slots move to your empty slots, and any slot of yours still empty takes
  // your most recently used skills that are not on the bar (auto-equip on every change of class).
  becomeRefill(s.session);
  noteWorn(book);
  gameBus.emit('classChanged', { classId: id, prev, reason: 'wear' });
  s.afterClassChange();
  return { ok: true, message: `You are now ${article(cls.name)}.` };
}

export function wornClass(s: MapScene): WornClassView | null {
  const id = s.book.state.worn;
  const cls = id ? s.reg.classDef(id) : undefined;
  const prog = id ? s.book.state.classes[id] : undefined;
  if (!cls || !prog) return null;
  const max = classMaxRank(cls);
  return {
    id: cls.id,
    name: cls.name,
    level: prog.rank,
    maxLevel: max,
    progress: prog.rank >= max ? 1 : Math.min(1, prog.xp / classXpNeed(cls, prog.rank)),
    color: classColor(cls.id),
  };
}

// ====================================================================== quests

const npcName = (id: string) => NPC_BY_ID.get(id)?.name ?? id;

export function rewardView(s: MapScene, r: QuestReward): QuestRewardView {
  const learn: QuestRewardView['learn'] = [];
  const add = (kind: QuestRewardView['learn'][number]['kind'], id: string, name?: string) => learn.push({ kind, id, name: name ?? id });
  if (r.lesson) {
    const g = s.reg.lesson(r.lesson)?.lesson.grants;
    if (g && 'skill' in g) add('skill', g.skill, s.reg.skill(g.skill)?.name);
    else if (g && 'passive' in g) add('passive', g.passive, s.reg.passive(g.passive)?.name);
    else if (g && 'element' in g) add('element', g.element, s.reg.element(g.element)?.name);
    else if (g && 'essence' in g) add('essence', g.essence, s.reg.essence(g.essence)?.name);
  }
  if (r.skill) add('skill', r.skill, s.reg.skill(r.skill)?.name);
  if (r.passive) add('passive', r.passive, s.reg.passive(r.passive)?.name);
  if (r.element) add('element', r.element, s.reg.element(r.element as ElementId)?.name);
  for (const e of Object.keys(r.essences ?? {})) add('essence', e, s.reg.essence(e)?.name);
  return {
    coins: r.coins ?? 0,
    exp: r.exp ?? 0,
    items: Object.entries(r.items ?? {}).map(([id, count]) => ({ id, name: s.reg.item(id)?.name ?? id, count })),
    learn,
    secret: !!r.whisper,
  };
}

export function questCard(s: MapScene, v: QuestView): QuestCardView {
  const q: QuestDef = v.quest;
  const where = NPC_MAP.get(q.giver);
  return {
    id: q.id,
    name: q.name,
    summary: q.summary,
    status: v.status,
    giverId: q.giver,
    giverName: npcName(q.giver),
    turnInId: v.turnIn,
    turnInName: npcName(v.turnIn),
    ...(where ? { where: mapById(where)?.name ?? where } : {}),
    ...(q.chain ? { chain: q.chain } : {}),
    objectives: s.book.questProgress(q.id).map((o) => ({ text: objectiveWords(o.text), have: o.have, need: o.need, done: o.done })),
    rewards: rewardView(s, q.rewards),
    tracked: (s.book.state.quests?.tracked ?? []).includes(q.id),
    repeatable: !!q.repeatable,
  };
}

/** One quest's card by id (null for unknown ids). */
export function questCardById(s: MapScene, id: string): QuestCardView | null {
  const quest = s.reg.quest(id);
  if (!quest) return null;
  return questCard(s, { quest, status: s.book.questStatus(id), turnIn: quest.turnIn ?? quest.giver });
}

export function npcQuests(s: MapScene, npcId: string): NpcQuestsView {
  const npc = NPC_BY_ID.get(npcId);
  const quests: NpcQuestView[] = s.book
    .quests(npcId)
    .filter((v) => v.status !== 'locked')
    .map((v) => {
      const d = v.quest.dialog;
      const dialog = v.status === 'available' ? d.offer : v.status === 'active' ? d.progress : v.status === 'ready' ? d.complete : '';
      const more = v.status === 'available' || v.status === 'ready' ? QUEST_LORE[v.quest.id] : undefined;
      return { ...questCard(s, v), dialog, ...(more ? { more } : {}) };
    });
  return { npcId, name: npc?.name ?? npcId, title: npc?.title ?? '', portrait: npc?.portrait ?? '', quests };
}

export function acceptQuest(s: MapScene, id: string, npcId: string): Outcome {
  const r = s.book.acceptQuest(id, npcId);
  s.save();
  return r;
}

export function turnInQuest(s: MapScene, id: string, npcId: string): QuestTurnInView {
  const r = s.book.turnInQuest(id, npcId);
  if (!r.ok) return { ok: false, message: r.message };
  const g = r.gameRewards;
  if (g.coins) s.session.player.coins += g.coins;
  for (const [item, n] of Object.entries(g.items)) s.obtain(item, n, `quest:${id}`);
  if (g.exp) s.combat.gainExp(g.exp);
  s.book.refreshQuests();
  if (r.listenerError) console.error('[omnipath] quest listener failed:', r.listenerError);
  s.save();
  return { ok: true, message: r.message, rewards: rewardView(s, r.rewards) };
}

export function abandonQuest(s: MapScene, id: string): Outcome {
  const r = s.book.abandonQuest(id);
  if (r.ok) gameBus.emit('questChanged', { questId: id, reason: 'abandoned' });
  s.save();
  return r;
}

export function trackQuest(s: MapScene, id: string, on: boolean): Outcome {
  const r = s.book.trackQuest(id, on);
  if (r.ok) gameBus.emit('questChanged', { questId: id, reason: 'tracked' });
  return r;
}

export function questLog(s: MapScene): QuestLogView {
  const all = s.book.quests().filter((v) => v.status !== 'locked');
  const cards = all.map((v) => questCard(s, v));
  return {
    active: cards.filter((c) => c.status === 'active' || c.status === 'ready'),
    available: cards.filter((c) => c.status === 'available'),
    done: cards.filter((c) => c.status === 'done' || c.status === 'cooldown'),
  };
}

export function pursuits(s: MapScene): PursuitView[] {
  const out: PursuitView[] = [];
  for (const t of s.book.trackedQuests()) {
    const ready = t.status === 'ready';
    const open = t.progress.find((p) => !p.done);
    out.push({
      key: `quest:${t.quest.id}`,
      kind: 'quest',
      title: t.quest.name,
      line: ready ? `Return to ${npcName(t.turnIn)}` : open ? objectiveWords(open.text) : t.quest.summary,
      ...(open && !ready && open.need > 0 ? { progress: Math.min(1, open.have / open.need) } : {}),
      ready,
      open: { panel: 'codex', arg: `quests:${t.quest.id}` },
    });
  }
  // Goals (at most 2), most exciting first: a transform ready now, an echo being learned ("Seen 2/3"), the nearest
  // class, then the next transform's one step.
  const book = s.book;
  const goals: PursuitView[] = [];
  const known = book.known();
  const morph = known.find((sk) => book.canMorph(sk.id));
  if (morph) goals.push({ key: `goal:transform:${morph.id}`, kind: 'goal', title: morph.name, line: 'Ready to transform ✨', icon: { kind: 'skill', id: morph.id }, open: { panel: 'skill', arg: morph.id } });
  const echo = Object.entries(book.state.witness)
    .filter(([id, marks]) => marks > 0 && !book.has(id) && !!s.reg.skill(id))
    .map(([id, marks]) => ({ id, marks, need: s.reg.techniqueSources(id).find((t) => t.technique.echo)?.technique.echo?.marks ?? 0 }))
    .filter((e) => e.need > 0)
    .sort((a, b) => b.marks / b.need - a.marks / a.need)[0];
  if (echo) {
    goals.push({
      key: `goal:echo:${echo.id}`,
      kind: 'goal',
      title: s.reg.skill(echo.id)!.name,
      line: seen(echo.marks, echo.need),
      progress: Math.min(1, echo.marks / echo.need),
      icon: { kind: 'skill', id: echo.id },
      open: { panel: 'skill', arg: echo.id },
    });
  }
  const near = s.reg.classes
    .filter((c) => !c.hidden && !book.state.classes[c.id])
    .map((c) => ({ c, v: book.classProgress(c) }))
    .filter(({ v }) => v.codex === 'near')
    .sort((a, b) => b.v.progress - a.v.progress)[0];
  if (near) goals.push({ key: `goal:class:${near.c.id}`, kind: 'goal', title: near.c.name, line: classHint(s, near.c.id), progress: near.v.progress, icon: { kind: 'cls', id: near.c.id }, open: { panel: 'classes', arg: near.c.id } });
  if (goals.length < 2) {
    // The skill closest to its next transform (highest rank share among those with a form left to take).
    const next = known
      .filter((sk) => barEligible(sk) && book.morphOptions(sk.id).some((o) => !o.owned))
      .map((sk) => ({ sk, step: transformStep(s.reg, book, sk.id), share: book.rank(sk.id) / Math.max(1, sk.maxRank) }))
      .filter((x): x is { sk: typeof x.sk; step: string; share: number } => !!x.step)
      .sort((a, b) => b.share - a.share)[0];
    if (next) goals.push({ key: `goal:next:${next.sk.id}`, kind: 'goal', title: next.sk.name, line: next.step, progress: next.share, icon: { kind: 'skill', id: next.sk.id }, open: { panel: 'skill', arg: next.sk.id } });
  }
  return [...out, ...goals.slice(0, 2)];
}

// ====================================================================== HUD helpers

/** Element sources the map offers, read from what stands in it. */
function mapSources(s: MapScene): ElementId[] {
  const def = s.def;
  const out = new Set<ElementId>();
  for (const p of def.npcs ?? []) {
    const role = NPC_BY_ID.get(p.npc)?.role;
    if (role === 'smith') out.add('fire');
    if (role === 'priestess') out.add('holy');
  }
  for (const n of def.nodes ?? []) {
    if (n.kind === 'fishing') out.add('water');
    if (n.kind === 'ore') out.add('earth');
  }
  for (const o of def.objects ?? []) {
    if (o.kind === 'wind_shrine') out.add('wind');
    if (o.kind === 'obelisk') out.add('shadow');
  }
  return [...out];
}

/** Explored share of the current map (0..100), over walkable fog cells. */
function explored(s: MapScene): number {
  const cm = compiled(s.mapId);
  const bits = fogBits(s.session.world, s.mapId, cm);
  const { cw, ch } = fogDims(cm);
  let total = 0;
  let seen = 0;
  for (let cy = 0; cy < ch; cy++) {
    for (let cx = 0; cx < cw; cx++) {
      let walk = false;
      for (let y = cy * FOG_CELL; y < Math.min(cm.h, (cy + 1) * FOG_CELL) && !walk; y++)
        for (let x = cx * FOG_CELL; x < Math.min(cm.w, (cx + 1) * FOG_CELL); x++)
          if (!(cm.coll[y * cm.w + x] & COLL.BLOCK)) {
            walk = true;
            break;
          }
      if (!walk) continue;
      total++;
      if (cellExplored(bits, cw, cx, cy)) seen++;
    }
  }
  return total ? Math.round((100 * seen) / total) : 100;
}

export function zone(s: MapScene): ZoneView {
  const def = s.def;
  const wardenId = def.spawns.map((z) => s.reg.monster(z.monster)).find((m) => m?.rank === 'warden')?.id;
  const tag: ZoneView['tag'] = def.safety === 'safe' ? 'Safe' : def.kind === 'arena' ? 'Warden' : def.kind === 'dungeon' ? 'Dungeon' : 'Hunting';
  const alive = wardenId ? s.combat?.monsters.some((m) => m.def.id === wardenId && m.alive) : false;
  return {
    name: def.name,
    tag,
    band: bandText(def),
    explored: explored(s),
    sources: mapSources(s),
    warden: wardenId ? (alive ? 'alive' : 'defeated') : null,
  };
}

export function quickSlots(s: MapScene): QuickSlotsView {
  const pick = (effect: 'heal' | 'sp' | 'recall') => {
    let best: { itemId: string; count: number } | null = null;
    for (const it of s.reg.items.values()) {
      if (it.kind !== 'consumable' || it.effect !== effect) continue;
      const count = s.session.count(it.id);
      if (!best || count > best.count) best = { itemId: it.id, count };
    }
    return best;
  };
  return { heal: pick('heal'), recall: pick('recall'), potion: pick('sp') };
}

export function useQuick(s: MapScene, kind: 'heal' | 'recall' | 'potion' | 'rest'): Outcome {
  if (kind === 'rest') return s.combat.rest();
  const slot = quickSlots(s)[kind];
  if (!slot || slot.count <= 0) return { ok: false, message: 'You have none.' };
  const r = s.useItem(slot.itemId);
  s.ui.updateVitals();
  return r;
}

export function cycleTarget(s: MapScene): void {
  const p = s.player;
  const live = s.combat.monsters
    .filter((m) => m.alive && Math.hypot(m.x - p.x, m.y - p.y) <= 400)
    .sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y));
  if (!live.length) {
    s.ui.toast('No enemies nearby.');
    return;
  }
  const at = s.combat.target ? live.indexOf(s.combat.target) : -1;
  s.combat.lastInput = s.time.now;
  s.combat.setTarget(live[(at + 1) % live.length]);
}

// ====================================================================== progressive disclosure, badges, tips

export function unlocks(s: MapScene): UnlocksView {
  const st = s.book.state;
  const q = st.quests;
  return {
    fusion: Object.keys(st.elements).length > 0,
    essences: Object.values(st.essences).some((n) => n > 0),
    passives: s.book.passives().length > 0,
    classes: Object.keys(st.classes).length > 0,
    keepsakes: s.book.imprintSlots() > 0,
    quests: !!q && (Object.keys(q.active).length > 0 || Object.keys(q.done).length > 0),
  };
}

export function badges(s: MapScene): MenuBadgesView {
  const book = s.book;
  const st = book.state;
  const worn = st.worn ? s.reg.classDef(st.worn) : undefined;
  const prog = worn ? st.classes[worn.id] : undefined;
  const node = !!worn && !!prog && (worn.tree ?? []).some((n) => canBuyNode(worn, prog, n.id).ok);
  // A class unlocked but never worn (flag `worn_class:<id>`, set whenever a class is worn — loadout.noteWorn).
  const unworn = Object.keys(st.classes).some((id) => book.flag(wornFlag(id)) < 1);
  return {
    skills: book.known().some((sk) => book.canMorph(sk.id)),
    classes: node || unworn,
    codex: Object.keys(st.quests?.active ?? {}).some((id) => book.questStatus(id) === 'ready'),
    altar: s.atAltar() && Object.keys(st.elements).length > 0,
  };
}

/** True exactly once per save for `key` (the flag `tip_<key>` remembers it). */
export function firstTime(s: MapScene, key: string): boolean {
  const flag = `tip_${key}`;
  if (s.book.flag(flag) > 0) return false;
  s.book.incFlag(flag);
  s.requestSave();
  return true;
}

/** First unmet requirement of a list as one plain sentence ('' when all are met). */
export function firstUnmet(s: MapScene, reqs: readonly Requirement[]): string {
  return firstStep(s.reg, s.book, reqs);
}
