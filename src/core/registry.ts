// Content index over a GameData bundle: lookups, deterministic procedural skills (variants and
// shape merges, composed on demand and cached) and data validation. Every core module codes
// against this class; it never mutates the data it was built from.
import { canTakeElement, compose, hasReservedChar, legalEssenceSet, mergeSkills, parseVariantId } from './compose';
import { pairKey, parseRef, type ParsedRef } from './refs';
import type {
  ClassDef,
  ElementDef,
  ElementId,
  EssenceDef,
  FusionRecipe,
  GameData,
  IngredientRef,
  ItemDef,
  LessonDef,
  MonsterDef,
  MonsterTechnique,
  MorphDef,
  PassiveDef,
  Requirement,
  SkillDef,
  TrainerDef,
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

  /** Data integrity check. Returns human-readable problems; [] means the bundle is consistent. */
  validate(): string[] {
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
      if (c.clauses.length === 0 && !c.distinctElements && !c.parents?.length && !c.requires?.length) {
        errs.push(`${where}: no requirements`);
      }
      for (const g of c.grants ?? []) if (!skillOk(g)) errs.push(`${where}: unknown granted skill ${g}`);
      if (c.imprint && !this.passives.has(c.imprint)) errs.push(`${where}: unknown imprint passive ${c.imprint}`);
      if (c.tier >= 2 && !c.parents?.length) errs.push(`${where}: Tier ${c.tier} class without parents`);
      for (const parent of c.parents ?? []) {
        const pc = this.classIndex.get(parent.id);
        if (!pc) errs.push(`${where}: unknown parent class ${parent.id}`);
        else if (pc.tier >= c.tier) errs.push(`${where}: parent ${parent.id} (tier ${pc.tier}) is not below tier ${c.tier}`);
      }
      const nodeIds = (c.tree ?? []).map((n) => n.id);
      for (const id of duplicates(nodeIds)) errs.push(`${where}: duplicate tree node ${id}`);
      for (const n of c.tree ?? []) {
        if (n.kind === 'skill' ? !skillOk(n.ref) : !this.passives.has(n.ref)) {
          errs.push(`${where}: tree node ${n.id} has unknown ${n.kind === 'skill' ? 'skill' : 'passive'} ${n.ref}`);
        }
        for (const req of n.requires ?? []) {
          if (!nodeIds.includes(req.node)) errs.push(`${where}: tree node ${n.id} requires unknown node ${req.node}`);
        }
      }
      checkReqs(where, c.requires);
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

    return errs;
  }
}
