// Content index over a GameData bundle: lookups, deterministic procedural skills (variants and
// shape merges, composed on demand and cached) and data validation. Every core module codes
// against this class; it never mutates the data it was built from.
import { canTakeElement, compose, hasReservedChar, legalEssenceSet, mergeSkills, parseVariantId } from './compose';
import { mechanicProblems } from './mechanics';
import { QUEST_NODE_KINDS, killCounts } from './quests';
import { gripProblems } from './requirements';
import { pairKey, parseRef, type ParsedRef } from './refs';
import {
  DELIVERIES,
  RARITIES,
  SHAPE_KINDS,
  WEAPON_TYPES,
  type ClassDef,
  type ElementDef,
  type ElementId,
  type EssenceDef,
  type FusionRecipe,
  type GameData,
  type IngredientRef,
  type ItemDef,
  type LessonDef,
  type MonsterDef,
  type MonsterTechnique,
  type MorphDef,
  type PassiveDef,
  type QuestDef,
  type QuestObjective,
  type Requirement,
  type SkillDef,
  type TrainerDef,
} from './types';

/** A monster that uses a technique, and how. */
export interface TechniqueSource {
  monster: MonsterDef;
  technique: MonsterTechnique;
}

/** A trainer lesson and the trainer teaching it. */
export interface LessonEntry {
  trainer: TrainerDef;
  lesson: LessonDef;
}

const uniq = <T>(xs: readonly T[]): T[] => [...new Set(xs)];

/** Element and weapon ids become tags so class clauses and tag counts can match on them (v1 rule). */
function normalize(s: SkillDef): SkillDef {
  const tags = [...s.tags];
  if (s.element) tags.push(s.element);
  if (s.weapons) tags.push(...s.weapons);
  return { ...s, tags: uniq(tags) };
}

/** Indexes `items` by key, keeping the FIRST entry for duplicate keys (validate() reports them). */
function indexFirst<K, T>(items: readonly T[], key: (t: T) => K): Map<K, T> {
  const m = new Map<K, T>();
  for (const t of items) if (!m.has(key(t))) m.set(key(t), t);
  return m;
}

function pushTo<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const list = m.get(k);
  if (list) list.push(v);
  else m.set(k, [v]);
}

function tryParseRef(ref: IngredientRef): ParsedRef | null {
  try {
    return parseRef(ref);
  } catch {
    return null;
  }
}

/** Map ids are `<region>.<name>` with an optional `.<n>` floor (vale.quarry_depths.1). */
const MAP_ID = /^[a-z][a-z0-9_]*\.[a-z0-9_]+(\.[0-9]+)?$/;

/**
 * SkillBook flag ids: lower-case words, optionally with `:<part>` segments (visited:vale.hearthvale, hits:sword,
 * kills:sword:fire).
 */
const FLAG_ID = /^[a-z0-9_]+(:[a-z0-9_.]+)*$/;

/** What Registry.validate checks beyond the always-on rules. */
export interface ValidateOptions {
  /**
   * Also apply the SPEC-v4 §2.2 grip rules to every authored skill (requirements.gripProblems). Off by default
   * until the content lane's retag pass has landed; content tests turn it on.
   */
  grip?: boolean;
}

const isCount = (n: unknown): boolean => typeof n === 'number' && Number.isInteger(n) && n >= 1;

/** Ids that occur more than once, in first-seen order. */
function duplicates(ids: readonly string[]): string[] {
  const seen = new Set<string>();
  const dup = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) dup.add(id);
    seen.add(id);
  }
  return [...dup];
}

export class Registry {
  readonly elements: Map<ElementId, ElementDef>;
  readonly classes: ClassDef[];
  readonly morphs: MorphDef[];
  readonly recipeList: FusionRecipe[];
  readonly essences: Map<string, EssenceDef>;
  readonly passives: Map<string, PassiveDef>;
  readonly trainers: TrainerDef[];
  readonly monsters: Map<string, MonsterDef>;
  readonly items: Map<string, ItemDef>;
  /** Quests by id, in data order (docs/QUESTS.md). Empty when the bundle has none. */
  readonly quests: Map<string, QuestDef>;
  readonly dataVersion: number;

  private readonly data: GameData;
  private readonly skills: Map<string, SkillDef>;
  /** Composed variants and merges by id (successful compositions only). */
  private readonly composed = new Map<string, SkillDef>();
  private readonly classIndex: Map<string, ClassDef>;
  private readonly trainerIndex: Map<string, TrainerDef>;
  private readonly lessonIndex = new Map<string, LessonEntry>();
  private readonly morphFrom = new Map<string, MorphDef[]>();
  private readonly morphTo = new Map<string, MorphDef[]>();
  private readonly recipes = new Map<string, FusionRecipe>();
  private readonly byIngredient = new Map<IngredientRef, FusionRecipe[]>();
  private readonly techniques = new Map<string, TechniqueSource[]>();
  private readonly questGiven = new Map<string, QuestDef[]>();
  private readonly questTurnIns = new Map<string, QuestDef[]>();
  private readonly lessonQuests = new Map<string, QuestDef[]>();

  constructor(data: GameData) {
    this.data = data;
    this.dataVersion = data.dataVersion;
    this.elements = indexFirst(data.elements, (e) => e.id);
    this.skills = new Map([...indexFirst(data.skills, (s) => s.id)].map(([id, s]) => [id, normalize(s)]));
    this.classes = data.classes;
    this.classIndex = indexFirst(data.classes, (c) => c.id);
    this.morphs = data.morphs;
    for (const m of data.morphs) {
      pushTo(this.morphFrom, m.from, m);
      pushTo(this.morphTo, m.to, m);
    }
    this.recipeList = data.recipes;
    for (const r of data.recipes) {
      const k = pairKey(r.a, r.b);
      if (!this.recipes.has(k)) this.recipes.set(k, r);
      pushTo(this.byIngredient, r.a, r);
      if (r.b !== r.a) pushTo(this.byIngredient, r.b, r);
    }
    this.essences = indexFirst(data.essences, (e) => e.id);
    this.passives = indexFirst(data.passives, (p) => p.id);
    this.trainers = data.trainers;
    this.trainerIndex = indexFirst(data.trainers, (t) => t.id);
    for (const trainer of data.trainers) {
      for (const lesson of trainer.lessons) {
        if (!this.lessonIndex.has(lesson.id)) this.lessonIndex.set(lesson.id, { trainer, lesson });
      }
    }
    this.monsters = indexFirst(data.monsters, (m) => m.id);
    for (const monster of data.monsters) {
      for (const technique of monster.techniques ?? []) pushTo(this.techniques, technique.skill, { monster, technique });
    }
    this.items = indexFirst(data.items, (i) => i.id);
    this.quests = indexFirst(data.quests ?? [], (q) => q.id);
    for (const quest of this.quests.values()) {
      pushTo(this.questGiven, quest.giver, quest);
      pushTo(this.questTurnIns, quest.turnIn ?? quest.giver, quest);
      if (quest.rewards.lesson !== undefined) pushTo(this.lessonQuests, quest.rewards.lesson, quest);
    }
  }

  // ---------------------------------------------------------------- skills

  /**
   * Resolves any skill id: authored (normalized), v1 infusion (`slash@fire`), essence variant
   * (`sword_throw@fire~split`) or shape merge (`fuse:a|b[@el][~mods]`). Procedural skills are
   * composed deterministically on first request and cached. Returns undefined for unknown or
   * illegal ids (non-canonical form, element on a bound skill, essences that do not fit).
   */
  skill(id: string): SkillDef | undefined {
    return this.skills.get(id) ?? this.composed.get(id) ?? this.build(id);
  }

  private build(id: string): SkillDef | undefined {
    const parts = parseVariantId(id);
    if (!parts) return undefined;
    const root = parts.merge ? this.mergeOf(parts.merge, parts.base) : this.skills.get(parts.base);
    if (!root) return undefined;
    if (root.id === id) return root;
    let el: ElementDef | undefined;
    if (parts.element) {
      el = this.elements.get(parts.element);
      if (!el || !canTakeElement(root)) return undefined;
    }
    const mods: EssenceDef[] = [];
    for (const m of parts.mods) {
      const e = this.essences.get(m);
      if (!e) return undefined;
      mods.push(e);
    }
    if (!legalEssenceSet(root, mods)) return undefined;
    const skill = compose(root, el, mods);
    this.composed.set(id, skill);
    return skill;
  }

  private mergeOf(pair: readonly [string, string], id: string): SkillDef | undefined {
    const cached = this.composed.get(id);
    if (cached) return cached;
    const a = this.skills.get(pair[0]);
    const b = this.skills.get(pair[1]);
    const merged = a && b ? mergeSkills(a, b) : null;
    if (!merged) return undefined;
    this.composed.set(id, merged);
    return merged;
  }

  /** Every authored skill (normalized), in data order. */
  authoredSkills(): SkillDef[] {
    return [...this.skills.values()];
  }

  /** True for hand-authored skill ids (not variants or merges). */
  isAuthored(id: string): boolean {
    return this.skills.has(id);
  }

  /**
   * The authored skill any skill id rolls up to: itself if authored, `baseId` for variants, and the
   * higher-tier parent for shape merges (and their variants). Undefined for unknown ids.
   */
  baseOf(id: string): string | undefined {
    const s = this.skill(id);
    if (!s) return undefined;
    return s.generated ? (s.baseId ?? s.id) : s.id;
  }

  // ---------------------------------------------------------------- lookups

  element(id: ElementId): ElementDef | undefined {
    return this.elements.get(id);
  }

  classDef(id: string): ClassDef | undefined {
    return this.classIndex.get(id);
  }

  essence(id: string): EssenceDef | undefined {
    return this.essences.get(id);
  }

  passive(id: string): PassiveDef | undefined {
    return this.passives.get(id);
  }

  monster(id: string): MonsterDef | undefined {
    return this.monsters.get(id);
  }

  item(id: string): ItemDef | undefined {
    return this.items.get(id);
  }

  trainer(id: string): TrainerDef | undefined {
    return this.trainerIndex.get(id);
  }

  /** A lesson by its (globally unique) id, with the trainer that teaches it. */
  lesson(id: string): LessonEntry | undefined {
    return this.lessonIndex.get(id);
  }

  /** A quest by id. */
  quest(id: string): QuestDef | undefined {
    return this.quests.get(id);
  }

  /** Quests NPC `npcId` gives (QuestDef.giver), in data order. */
  questsBy(npcId: string): QuestDef[] {
    return this.questGiven.get(npcId) ?? [];
  }

  /** Quests turned in to NPC `npcId` (`turnIn`, else the giver), in data order. */
  questsTurnedInAt(npcId: string): QuestDef[] {
    return this.questTurnIns.get(npcId) ?? [];
  }

  /** Quests whose reward is lesson `lessonId`, in data order (content rule: exactly one). */
  questsForLesson(lessonId: string): QuestDef[] {
    return this.lessonQuests.get(lessonId) ?? [];
  }

  /** Morphs whose source is `id`. */
  morphsFrom(id: string): MorphDef[] {
    return this.morphFrom.get(id) ?? [];
  }

  /** Morphs that lead to `id` (several paths may reach the same skill). */
  morphsTo(id: string): MorphDef[] {
    return this.morphTo.get(id) ?? [];
  }

  /** The authored recipe for an unordered ingredient pair. */
  recipe(a: IngredientRef, b: IngredientRef): FusionRecipe | undefined {
    return this.recipes.get(pairKey(a, b));
  }

  /** Every recipe using `ref` as an ingredient. */
  recipesWith(ref: IngredientRef): FusionRecipe[] {
    return this.byIngredient.get(ref) ?? [];
  }

  /** Monsters that use `skillId` as a technique (echo sources). */
  techniqueSources(skillId: string): TechniqueSource[] {
    return this.techniques.get(skillId) ?? [];
  }

  // ---------------------------------------------------------------- refs

  /** Whether a ref (`skill:`, `el:`, `mod:`, `passive:`) names something that exists. False if malformed. */
  refExists(ref: IngredientRef): boolean {
    const p = tryParseRef(ref);
    if (!p) return false;
    switch (p.kind) {
      case 'skill':
        return !!this.skill(p.id);
      case 'el':
        return this.elements.has(p.id);
      case 'mod':
        return this.essences.has(p.id);
      case 'passive':
        return this.passives.has(p.id);
    }
  }

  /** Display name of a ref (falls back to the raw id, or the ref itself if malformed). */
  refName(ref: IngredientRef): string {
    const p = tryParseRef(ref);
    if (!p) return ref;
    return this.refDef(p)?.name ?? p.id;
  }

  /** Icon of a ref ('?' when unknown). */
  refIcon(ref: IngredientRef): string {
    const p = tryParseRef(ref);
    return (p && this.refDef(p)?.icon) || '?';
  }

  private refDef(p: ParsedRef): { name: string; icon: string } | undefined {
    switch (p.kind) {
      case 'skill':
        return this.skill(p.id);
      case 'el':
        return this.elements.get(p.id);
      case 'mod':
        return this.essences.get(p.id);
      case 'passive':
        return this.passives.get(p.id);
    }
  }

  // ---------------------------------------------------------------- validation

  /**
   * Data integrity check. Returns human-readable problems; [] means the bundle is consistent.
   * Covers duplicate ids, reserved characters, unknown references in every table and requirement,
   * morph edges (self-morphs; sparks on capstones or from buff parents), recipe shapes, class
   * parents/trees, lessons, monsters, items and quests (objective targets, rewards, `after` chains,
   * flag and map id formats — NPC ids and map existence live in the world data and are not checked here —
   * and that a lesson is the reward of at most one non-repeatable quest). v4: shape numbers of the new kinds,
   * `delivery`, `classOf`, `hpCost`; kit classes (5 distinct known kit skills, mechanic data, passive, discovery
   * requirements, Trial quest); with `opts.grip`, the grip rules too.
   */
  validate(opts: ValidateOptions = {}): string[] {
    const errs: string[] = [];
    const d = this.data;
    const skillOk = (id: string): boolean => !!this.skill(id);

    const checkReqs = (where: string, reqs: readonly Requirement[] | undefined): void => {
      for (const r of reqs ?? []) {
        switch (r.type) {
          case 'element':
            if (!this.elements.has(r.id)) errs.push(`${where}: unknown element ${r.id}`);
            break;
          case 'skill':
            if (!skillOk(r.id)) errs.push(`${where}: unknown skill ${r.id}`);
            break;
          case 'class':
            if (!this.classIndex.has(r.id)) errs.push(`${where}: unknown class ${r.id}`);
            break;
          case 'lesson':
            if (!this.lessonIndex.has(r.id)) errs.push(`${where}: unknown lesson ${r.id}`);
            break;
          case 'witness':
            if (!skillOk(r.skill)) errs.push(`${where}: unknown witness skill ${r.skill}`);
            break;
          case 'item':
            if (!this.items.has(r.id)) errs.push(`${where}: unknown item ${r.id}`);
            break;
          case 'quest':
            if (!this.quests.has(r.id)) errs.push(`${where}: unknown quest ${r.id}`);
            break;
          case 'deed':
          case 'tagCount':
          case 'elementsKnown':
          case 'flag':
          case 'level':
          case 'mapVisited':
            break;
        }
      }
    };
    const reportDuplicates = (what: string, ids: readonly string[]): void => {
      for (const id of duplicates(ids)) errs.push(`${what} ${id}: duplicate id`);
    };

    reportDuplicates('element', d.elements.map((e) => e.id));
    reportDuplicates('skill', d.skills.map((s) => s.id));
    reportDuplicates('class', d.classes.map((c) => c.id));
    reportDuplicates('essence', d.essences.map((e) => e.id));
    reportDuplicates('passive', d.passives.map((p) => p.id));
    reportDuplicates('monster', d.monsters.map((m) => m.id));
    reportDuplicates('item', d.items.map((i) => i.id));
    reportDuplicates('trainer', d.trainers.map((t) => t.id));
    reportDuplicates('lesson', d.trainers.flatMap((t) => t.lessons.map((l) => l.id)));

    for (const s of this.skills.values()) {
      if (hasReservedChar(s.id)) errs.push(`skill ${s.id}: id uses a reserved character (@ ~ | :)`);
      if (s.element && !this.elements.has(s.element)) errs.push(`skill ${s.id}: unknown element ${s.element}`);
      if (s.maxRank < 1) errs.push(`skill ${s.id}: maxRank < 1`);
      if (s.delivery !== undefined && !DELIVERIES.includes(s.delivery)) errs.push(`skill ${s.id}: unknown delivery ${s.delivery}`);
      if (s.classOf !== undefined && !this.classIndex.has(s.classOf)) errs.push(`skill ${s.id}: unknown classOf ${s.classOf}`);
      if (s.hpCost !== undefined && !(s.hpCost > 0 && s.hpCost < 100)) errs.push(`skill ${s.id}: hpCost must be between 0 and 100`);
      for (const w of s.weapons ?? []) if (!WEAPON_TYPES.includes(w)) errs.push(`skill ${s.id}: unknown weapon ${w}`);
      const shape = s.shape;
      const positive = (name: string, n: number): void => {
        if (!(Number.isFinite(n) && n > 0)) errs.push(`skill ${s.id}: ${shape.kind} ${name} must be > 0`);
      };
      if (shape.kind === 'zone') {
        positive('durationMs', shape.durationMs);
        positive('tickMs', shape.tickMs);
        positive('radius', shape.radius);
      } else if (shape.kind === 'blink') {
        positive('distance', shape.distance);
        if (shape.arrive) positive('arrive.radius', shape.arrive.radius);
        else if (s.power > 0) errs.push(`skill ${s.id}: a blink with power needs arrive`);
      } else if (shape.kind === 'mend') {
        positive('pct', shape.pct);
      } else if (shape.kind === 'shield') {
        positive('pct', shape.pct);
        positive('durationMs', shape.durationMs);
        if (!shape.burst && s.power > 0) errs.push(`skill ${s.id}: a shield with power needs burst`);
      }
      if (opts.grip) errs.push(...gripProblems(s));
    }

    for (const e of d.essences) {
      if (hasReservedChar(e.id)) errs.push(`essence ${e.id}: id uses a reserved character (@ ~ | :)`);
      if (e.appliesTo.length === 0) errs.push(`essence ${e.id}: empty appliesTo`);
    }

    const morphSeen = new Set<string>();
    for (const m of d.morphs) {
      const k = `${m.from}>${m.to}`;
      if (morphSeen.has(k)) errs.push(`morph ${k}: duplicate edge`);
      morphSeen.add(k);
      if (!skillOk(m.from)) errs.push(`morph ${k}: unknown source ${m.from}`);
      const target = this.skill(m.to);
      if (!target) errs.push(`morph ${k}: unknown result ${m.to}`);
      if (m.from === m.to) errs.push(`morph ${k}: morphs into itself`);
      if (m.spark && (m.tier ?? target?.tier) === 3) errs.push(`morph ${k}: capstone (tier 3) morphs cannot spark`);
      // Sparks roll on the parent's hits; a buff never lands one, so its morphs could never spark.
      if (m.spark && this.skill(m.from)?.shape.kind === 'buff') {
        errs.push(`morph ${k}: buff parent ${m.from} never hits, so the morph cannot spark`);
      }
      checkReqs(`morph ${k}`, m.requires);
    }

    const recipeSeen = new Set<string>();
    for (const r of d.recipes) {
      const k = pairKey(r.a, r.b);
      if (recipeSeen.has(k)) errs.push(`recipe ${k}: duplicate pair`);
      recipeSeen.add(k);
      if (r.a === r.b) errs.push(`recipe ${k}: same ingredient twice`);
      for (const ref of [r.a, r.b]) {
        const p = tryParseRef(ref);
        if (p?.kind === 'passive') errs.push(`recipe ${k}: passive ${ref} cannot be an ingredient`);
      }
      for (const ref of [r.a, r.b, r.result]) {
        if (!this.refExists(ref)) errs.push(`recipe ${k}: unknown ref ${ref}`);
      }
      const result = tryParseRef(r.result);
      if (result?.kind === 'passive' && tryParseRef(r.a)?.kind === 'el' && tryParseRef(r.b)?.kind === 'el') {
        const p = this.passives.get(result.id);
        if (p && p.source !== 'resonance') errs.push(`recipe ${k}: element pair result ${r.result} is not a resonance passive`);
      }
      checkReqs(`recipe ${k}`, r.requires);
    }

    for (const c of d.classes) {
      const where = `class ${c.id}`;
      const v2 = (c.clauses?.length ?? 0) > 0 || !!c.distinctElements || !!c.parents?.length || !!c.requires?.length;
      if (!c.discover && !v2) errs.push(`${where}: no requirements`);
      if (c.discover && c.discover.requires.length === 0 && c.discover.trial === undefined) errs.push(`${where}: no requirements`);
      for (const g of c.grants ?? []) if (!skillOk(g)) errs.push(`${where}: unknown granted skill ${g}`);
      if (c.imprint && !this.passives.has(c.imprint)) errs.push(`${where}: unknown imprint passive ${c.imprint}`);
      if (c.passive !== undefined && !this.passives.has(c.passive)) errs.push(`${where}: unknown passive ${c.passive}`);
      if (c.rarity !== undefined && !RARITIES.includes(c.rarity)) errs.push(`${where}: unknown rarity ${c.rarity}`);
      if (c.weapon !== undefined && c.weapon !== 'any' && !WEAPON_TYPES.includes(c.weapon)) errs.push(`${where}: unknown weapon ${c.weapon}`);
      if (c.kit) {
        if (c.kit.length !== 5) errs.push(`${where}: a kit has exactly 5 skills`);
        for (const id of duplicates(c.kit)) errs.push(`${where}: kit lists ${id} twice`);
        for (const id of c.kit) {
          const skill = this.skills.get(id);
          if (!skill) errs.push(`${where}: unknown kit skill ${id}`);
          else if (skill.classOf !== undefined && skill.classOf !== c.id) errs.push(`${where}: kit skill ${id} belongs to ${skill.classOf}`);
          else if (skill.tier === 0 && skill.tags.includes('basic')) errs.push(`${where}: kit skill ${id} is a basic attack`);
        }
        for (const key of ['rarity', 'weapon', 'source', 'mechanic', 'discover'] as const) {
          if (c[key] === undefined) errs.push(`${where}: a class with a kit needs ${key}`);
        }
      }
      for (const m of [c.mechanic, c.mechanicUpgrade?.mechanic]) {
        if (!m) continue;
        for (const problem of mechanicProblems(m, c.kit ?? [])) errs.push(`${where}: mechanic: ${problem}`);
        if (m.kind === 'stance') for (const to of Object.values(m.remap)) if (!skillOk(to)) errs.push(`${where}: mechanic: unknown remap skill ${to}`);
      }
      if (c.mechanicUpgrade && c.mechanic && c.mechanicUpgrade.mechanic.kind !== c.mechanic.kind) {
        errs.push(`${where}: the mechanic upgrade changes the mechanic kind`);
      }
      if (c.discover?.trial !== undefined) {
        const trial = this.quests.get(c.discover.trial);
        if (!trial) errs.push(`${where}: unknown Trial quest ${c.discover.trial}`);
        else if (trial.trialOf !== c.id) errs.push(`${where}: Trial quest ${trial.id} is not marked trialOf ${c.id}`);
      }
      checkReqs(where, c.discover?.requires);
      if (!c.discover) {
        const tier = c.tier ?? 1;
        if (tier >= 2 && !c.parents?.length) errs.push(`${where}: Tier ${tier} class without parents`);
        for (const parent of c.parents ?? []) {
          const pc = this.classIndex.get(parent.id);
          if (!pc) errs.push(`${where}: unknown parent class ${parent.id}`);
          else if ((pc.tier ?? 1) >= tier) errs.push(`${where}: parent ${parent.id} (tier ${pc.tier ?? 1}) is not below tier ${tier}`);
        }
        checkReqs(where, c.requires);
      }
    }

    for (const t of d.trainers) {
      for (const l of t.lessons) {
        const where = `lesson ${t.id}/${l.id}`;
        const g = l.grants;
        if ('skill' in g && !skillOk(g.skill)) errs.push(`${where}: unknown skill ${g.skill}`);
        if ('passive' in g && !this.passives.has(g.passive)) errs.push(`${where}: unknown passive ${g.passive}`);
        if ('essence' in g && !this.essences.has(g.essence)) errs.push(`${where}: unknown essence ${g.essence}`);
        if ('element' in g && !this.elements.has(g.element)) errs.push(`${where}: unknown element ${g.element}`);
        for (const item of Object.keys(l.cost?.items ?? {})) {
          if (!this.items.has(item)) errs.push(`${where}: unknown cost item ${item}`);
        }
        checkReqs(where, l.requires);
      }
    }

    for (const m of d.monsters) {
      const where = `monster ${m.id}`;
      for (const t of m.techniques ?? []) if (!skillOk(t.skill)) errs.push(`${where}: unknown technique ${t.skill}`);
      if (m.essence && !this.essences.has(m.essence)) errs.push(`${where}: unknown essence ${m.essence}`);
      for (const drop of m.drops ?? []) if (!this.items.has(drop.item)) errs.push(`${where}: unknown drop ${drop.item}`);
      if (m.base && !this.monsters.has(m.base)) errs.push(`${where}: unknown base species ${m.base}`);
    }

    for (const i of d.items) {
      if (i.kind === 'tome' && !skillOk(i.skill)) errs.push(`item ${i.id}: unknown tome skill ${i.skill}`);
      if (i.kind === 'shard' && !this.elements.has(i.element)) errs.push(`item ${i.id}: unknown shard element ${i.element}`);
    }

    this.validateQuests(errs, checkReqs);
    return errs;
  }

  /** Quest checks of validate(), pushed to `errs`; `checkReqs` is validate's requirement checker. */
  private validateQuests(
    errs: string[],
    checkReqs: (where: string, reqs: readonly Requirement[] | undefined) => void,
  ): void {
    const quests = this.data.quests ?? [];
    const skillOk = (id: string): boolean => !!this.skill(id);
    const checkFlags = (where: string, reqs: readonly Requirement[]): void => {
      for (const r of reqs) {
        if (r.type === 'flag' && !FLAG_ID.test(r.id)) errs.push(`${where}: malformed flag id ${r.id}`);
        if (r.type === 'mapVisited' && !MAP_ID.test(r.id)) errs.push(`${where}: malformed map id ${r.id}`);
      }
    };
    const checkObjective = (where: string, o: QuestObjective): void => {
      if ('count' in o && !isCount(o.count)) errs.push(`${where}: count must be a whole number >= 1`);
      switch (o.kind) {
        case 'kill':
          if (o.monster !== undefined && !this.monsters.has(o.monster)) errs.push(`${where}: unknown monster ${o.monster}`);
          break;
        case 'gather':
          if (!QUEST_NODE_KINDS.includes(o.node)) errs.push(`${where}: unknown node kind ${o.node}`);
          break;
        case 'deliver':
          if (!this.items.has(o.item)) errs.push(`${where}: unknown item ${o.item}`);
          break;
        case 'visit':
          if (!MAP_ID.test(o.map)) errs.push(`${where}: malformed map id ${o.map}`);
          break;
        case 'talk':
          if (o.npc.length === 0) errs.push(`${where}: empty npc id`);
          break;
        case 'use':
          if (o.skill !== undefined && !skillOk(o.skill)) errs.push(`${where}: unknown skill ${o.skill}`);
          if (o.tag !== undefined && o.tag.length === 0) errs.push(`${where}: empty tag`);
          break;
        case 'cast':
          if (!MAP_ID.test(o.map)) errs.push(`${where}: malformed map id ${o.map}`);
          if (o.element !== undefined && !this.elements.has(o.element)) errs.push(`${where}: unknown element ${o.element}`);
          if (o.shape !== undefined && !SHAPE_KINDS.includes(o.shape)) errs.push(`${where}: unknown shape ${o.shape}`);
          if (o.tag !== undefined && o.tag.length === 0) errs.push(`${where}: empty tag`);
          break;
        case 'witness':
          if (o.skill !== undefined && !this.techniqueSources(o.skill).some((t) => t.technique.echo !== undefined)) {
            errs.push(`${where}: ${o.skill} is not an echo technique of any monster`);
          }
          break;
        case 'state':
          if (o.label.length === 0) errs.push(`${where}: empty label`);
          checkReqs(where, [o.requires]);
          checkFlags(where, [o.requires]);
          break;
      }
    };

    for (const id of duplicates(quests.map((q) => q.id))) errs.push(`quest ${id}: duplicate id`);
    for (const q of quests) {
      const where = `quest ${q.id}`;
      if (q.giver.length === 0) errs.push(`${where}: empty giver`);
      if (q.objectives.length === 0) errs.push(`${where}: no objectives`);
      for (const prev of q.after ?? []) {
        if (prev === q.id) errs.push(`${where}: comes after itself`);
        else if (!this.quests.has(prev)) errs.push(`${where}: unknown 'after' quest ${prev}`);
      }
      checkReqs(where, q.requires);
      checkFlags(where, q.requires ?? []);
      q.objectives.forEach((o, i) => checkObjective(`${where} objective ${i + 1} (${o.kind})`, o));
      // Two deliveries of one item read the same bag count but turn-in spends their sum.
      const delivered = q.objectives.flatMap((o) => (o.kind === 'deliver' ? [o.item] : []));
      for (const item of duplicates(delivered)) errs.push(`${where}: delivers ${item} in more than one objective`);
      // A named elite or warden also counts toward its base species: asking for both the species and
      // that elite lets one kill fill two objectives ('10 Emberkits and their Alpha' after 9 + 1).
      // Give the species objective `rank: 'common'` to count the pack alone.
      const kills = q.objectives.flatMap((o, i) => (o.kind === 'kill' ? [{ o, i }] : []));
      for (const named of kills) {
        const m = named.o.monster !== undefined ? this.monsters.get(named.o.monster) : undefined;
        if (!m) continue;
        for (const other of kills) {
          if (other.i !== named.i && other.o.monster !== undefined && other.o.monster === m.base && killCounts(other.o, m)) {
            errs.push(`${where}: a ${m.id} kill also counts toward objective ${other.i + 1} (${other.o.monster})`);
          }
        }
      }
      const r = q.rewards;
      if (r.lesson !== undefined && !this.lessonIndex.has(r.lesson)) errs.push(`${where}: unknown reward lesson ${r.lesson}`);
      if (r.skill !== undefined && !skillOk(r.skill)) errs.push(`${where}: unknown reward skill ${r.skill}`);
      if (r.passive !== undefined && !this.passives.has(r.passive)) errs.push(`${where}: unknown reward passive ${r.passive}`);
      if (r.element !== undefined && !this.elements.has(r.element)) errs.push(`${where}: unknown reward element ${r.element}`);
      for (const [e, n] of Object.entries(r.essences ?? {})) {
        if (!this.essences.has(e)) errs.push(`${where}: unknown reward essence ${e}`);
        if (!isCount(n)) errs.push(`${where}: reward essence ${e} count must be a whole number >= 1`);
      }
      for (const [item, n] of Object.entries(r.items ?? {})) {
        if (!this.items.has(item)) errs.push(`${where}: unknown reward item ${item}`);
        if (!isCount(n)) errs.push(`${where}: reward item ${item} count must be a whole number >= 1`);
      }
      if (r.whisper !== undefined && !this.classIndex.has(r.whisper)) errs.push(`${where}: unknown whisper class ${r.whisper}`);
      if (r.flag !== undefined && !FLAG_ID.test(r.flag)) errs.push(`${where}: malformed reward flag ${r.flag}`);
      if (q.trialOf !== undefined) {
        const cls = this.classIndex.get(q.trialOf);
        if (!cls) errs.push(`${where}: trialOf unknown class ${q.trialOf}`);
        else if (cls.discover?.trial !== q.id) errs.push(`${where}: class ${q.trialOf} does not name this quest as its Trial`);
        if (q.repeatable) errs.push(`${where}: a Trial cannot be repeatable`);
      }
      for (const key of ['coins', 'exp'] as const) {
        const n = r[key];
        if (n !== undefined && !(Number.isFinite(n) && n >= 0)) errs.push(`${where}: reward ${key} must be >= 0`);
      }
      if (q.repeatable && !(Number.isFinite(q.repeatable.cooldownMs) && q.repeatable.cooldownMs >= 0)) {
        errs.push(`${where}: repeatable cooldownMs must be >= 0`);
      }
    }

    // `after` chains must not loop (a looping chain can never be offered).
    for (const q of this.quests.values()) {
      const seen = new Set<string>();
      const stack = [...(q.after ?? [])].filter((a) => a !== q.id);
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (id === q.id) {
          errs.push(`quest ${q.id}: 'after' chain loops back to itself`);
          break;
        }
        if (seen.has(id)) continue;
        seen.add(id);
        stack.push(...(this.quests.get(id)?.after ?? []));
      }
    }

    for (const [lesson, list] of this.lessonQuests) {
      const once = list.filter((q) => !q.repeatable);
      if (once.length > 1) {
        errs.push(`lesson ${lesson}: reward of ${once.length} non-repeatable quests (${once.map((q) => q.id).join(', ')})`);
      }
    }
  }
}
