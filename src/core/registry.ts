import { infusedId, pairKey, parseRef } from './refs';
import type {
  ClassDef,
  ElementDef,
  ElementId,
  FusionRecipe,
  GameData,
  IngredientRef,
  MorphDef,
  Requirement,
  SkillDef,
} from './types';

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

/** Adds element and weapon tags so class clauses can match on them. */
function normalize(s: SkillDef): SkillDef {
  const tags = [...s.tags];
  if (s.element) tags.push(s.element);
  if (s.weapons) tags.push(...s.weapons);
  return { ...s, tags: uniq(tags) };
}

/**
 * Element infusion: the procedural fallback that lets any unaligned
 * technique be fused with any element, so the combination space stays
 * vast even where no hand-authored recipe exists.
 */
export function infuse(base: SkillDef, el: ElementDef): SkillDef {
  const weaponTags: string[] = base.weapons ?? [];
  return normalize({
    id: infusedId(base.id, el.id),
    name: `${el.prefix} ${base.name}`,
    desc: `${base.desc} Infused with ${el.name.toLowerCase()}.`,
    icon: base.icon,
    tier: base.tier + 1,
    weapons: base.weapons,
    tags: uniq([...base.tags.filter((t) => t !== 'basic' && !weaponTags.includes(t)), 'infused']),
    element: el.id,
    power: Math.round(base.power * 1.2 * 100) / 100,
    spCost: Math.ceil(base.spCost * 1.25 + 2),
    cooldown: base.cooldown || 800,
    shape: base.shape,
    maxRank: 8,
    status: base.status,
    critBonus: base.critBonus,
    generated: true,
  });
}

export function canInfuse(base: SkillDef): boolean {
  return !base.element && base.shape.kind !== 'buff' && base.power > 0 && !base.generated;
}

export class Registry {
  readonly elements = new Map<ElementId, ElementDef>();
  private readonly skills = new Map<string, SkillDef>();
  private readonly generated = new Map<string, SkillDef>();
  private readonly morphIndex = new Map<string, MorphDef[]>();
  private readonly recipes = new Map<string, FusionRecipe>();
  private readonly byIngredient = new Map<IngredientRef, FusionRecipe[]>();
  readonly classes: ClassDef[];
  readonly morphs: MorphDef[];
  readonly recipeList: FusionRecipe[];

  constructor(data: GameData) {
    for (const e of data.elements) this.elements.set(e.id, e);
    for (const s of data.skills) this.skills.set(s.id, normalize(s));
    this.morphs = data.morphs;
    for (const m of data.morphs) {
      const list = this.morphIndex.get(m.from) ?? [];
      list.push(m);
      this.morphIndex.set(m.from, list);
    }
    this.recipeList = data.recipes;
    for (const r of data.recipes) {
      this.recipes.set(pairKey(r.a, r.b), r);
      for (const ref of [r.a, r.b]) {
        const list = this.byIngredient.get(ref) ?? [];
        list.push(r);
        this.byIngredient.set(ref, list);
      }
    }
    this.classes = data.classes;
  }

  /** Resolves authored and procedurally generated skills. */
  skill(id: string): SkillDef | undefined {
    const authored = this.skills.get(id);
    if (authored) return authored;
    const cached = this.generated.get(id);
    if (cached) return cached;
    const at = id.lastIndexOf('@');
    if (at < 0) return undefined;
    const base = this.skills.get(id.slice(0, at));
    const el = this.elements.get(id.slice(at + 1) as ElementId);
    if (!base || !el || !canInfuse(base)) return undefined;
    const s = infuse(base, el);
    this.generated.set(id, s);
    return s;
  }

  element(id: ElementId): ElementDef | undefined {
    return this.elements.get(id);
  }

  classDef(id: string): ClassDef | undefined {
    return this.classes.find((c) => c.id === id);
  }

  authoredSkills(): SkillDef[] {
    return [...this.skills.values()];
  }

  morphsFrom(id: string): MorphDef[] {
    return this.morphIndex.get(id) ?? [];
  }

  recipe(a: IngredientRef, b: IngredientRef): FusionRecipe | undefined {
    return this.recipes.get(pairKey(a, b));
  }

  recipesWith(ref: IngredientRef): FusionRecipe[] {
    return this.byIngredient.get(ref) ?? [];
  }

  refExists(ref: IngredientRef): boolean {
    const p = parseRef(ref);
    return p.kind === 'skill' ? !!this.skill(p.id) : this.elements.has(p.id);
  }

  refName(ref: IngredientRef): string {
    const p = parseRef(ref);
    if (p.kind === 'skill') return this.skill(p.id)?.name ?? p.id;
    return this.elements.get(p.id)?.name ?? p.id;
  }

  refIcon(ref: IngredientRef): string {
    const p = parseRef(ref);
    if (p.kind === 'skill') return this.skill(p.id)?.icon ?? '?';
    return this.elements.get(p.id)?.icon ?? '?';
  }

  /** Data integrity check. Returns a list of human-readable problems. */
  validate(): string[] {
    const errs: string[] = [];
    const checkReq = (where: string, reqs?: Requirement[]) => {
      for (const r of reqs ?? []) {
        if (r.type === 'element' && !this.elements.has(r.id)) errs.push(`${where}: unknown element ${r.id}`);
        if (r.type === 'skill' && !this.skill(r.id)) errs.push(`${where}: unknown skill ${r.id}`);
        if (r.type === 'class' && !this.classDef(r.id)) errs.push(`${where}: unknown class ${r.id}`);
      }
    };
    for (const s of this.skills.values()) {
      if (s.id.includes('@')) errs.push(`skill ${s.id}: '@' is reserved for infusions`);
      if (s.element && !this.elements.has(s.element)) errs.push(`skill ${s.id}: unknown element ${s.element}`);
      if (s.maxRank < 1) errs.push(`skill ${s.id}: maxRank < 1`);
    }
    const morphSeen = new Set<string>();
    for (const m of this.morphs) {
      const k = `${m.from}>${m.to}`;
      if (morphSeen.has(k)) errs.push(`morph ${k}: duplicate`);
      morphSeen.add(k);
      if (!this.skill(m.from)) errs.push(`morph ${k}: unknown source`);
      if (!this.skill(m.to)) errs.push(`morph ${k}: unknown result`);
      if (m.from === m.to) errs.push(`morph ${k}: morphs into itself`);
      checkReq(`morph ${k}`, m.requires);
    }
    const recipeSeen = new Set<string>();
    for (const r of this.recipeList) {
      const k = pairKey(r.a, r.b);
      if (recipeSeen.has(k)) errs.push(`recipe ${k}: duplicate pair`);
      recipeSeen.add(k);
      for (const ref of [r.a, r.b, r.result]) {
        try {
          if (!this.refExists(ref)) errs.push(`recipe ${k}: unknown ingredient ${ref}`);
        } catch (e) {
          errs.push(`recipe ${k}: ${(e as Error).message}`);
        }
      }
      if (r.a === r.b) errs.push(`recipe ${k}: same ingredient twice`);
      checkReq(`recipe ${k}`, r.requires);
    }
    const classSeen = new Set<string>();
    for (const c of this.classes) {
      if (classSeen.has(c.id)) errs.push(`class ${c.id}: duplicate`);
      classSeen.add(c.id);
      if (c.clauses.length === 0 && !c.distinctElements) errs.push(`class ${c.id}: no requirements`);
      for (const g of c.grants ?? []) if (!this.skill(g)) errs.push(`class ${c.id}: unknown granted skill ${g}`);
    }
    return errs;
  }
}
