import { Emitter } from './emitter';
import { MASTERY, fusionMinRank, overmasteryCost, xpToNext } from './mastery';
import { canInfuse, type Registry } from './registry';
import { elRef, infusedId, pairKey, parseRef, skillRef } from './refs';
import type {
  ClassClause,
  ClassDef,
  ElementDef,
  ElementId,
  IngredientRef,
  MorphDef,
  Requirement,
  SkillDef,
  StatBonus,
} from './types';

export interface SkillProgress {
  id: string;
  rank: number;
  /** XP into the current rank (or into the overmastery bar at max rank). */
  xp: number;
  /** Unspent morph charges. One is granted at max rank, more via overmastery. */
  charges: number;
  uses: number;
  source: string;
  learnedAt: number;
}

export interface SkillBookState {
  version: 1;
  skills: Record<string, SkillProgress>;
  elements: Partial<Record<ElementId, { source: string; learnedAt: number }>>;
  flags: Record<string, number>;
  /** Fusion pair keys the player has already tried. */
  attempts: string[];
  /** Pair keys that produced something. */
  discoveries: string[];
  classes: string[];
  activeClass: string | null;
  /** Hints the player has been shown, for the journal. */
  hints: string[];
}

export interface SkillBookEvents {
  learned: { skill: SkillDef; source: string };
  element: { element: ElementDef; source: string };
  rankUp: { skill: SkillDef; rank: number };
  mastered: { skill: SkillDef };
  charge: { skill: SkillDef; charges: number };
  morphed: { from: SkillDef; to: SkillDef };
  fused: { a: IngredientRef; b: IngredientRef; result: IngredientRef; isNew: boolean };
  classDiscovered: { cls: ClassDef };
  hint: { text: string };
}

export interface MorphOption {
  morph: MorphDef;
  /** Hidden until requirements are met. */
  skill: SkillDef | null;
  available: boolean;
  owned: boolean;
  hint: string;
}

export type FuseResult =
  | { ok: true; result: IngredientRef; name: string; isNew: boolean; procedural: boolean }
  | { ok: false; reason: 'missing' | 'rank' | 'same' | 'requirement' | 'nothing'; message: string; hint?: string };

export interface ClassProgress {
  cls: ClassDef;
  discovered: boolean;
  /** 0..1 */
  progress: number;
  clauses: { clause: ClassClause; have: number }[];
  elements?: { have: number; need: number };
}

export function emptyState(): SkillBookState {
  return {
    version: 1,
    skills: {},
    elements: {},
    flags: {},
    attempts: [],
    discoveries: [],
    classes: [],
    activeClass: null,
    hints: [],
  };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/**
 * The player's living grimoire: what they know, how well they know it,
 * and every experiment they've tried. All discovery rules live here.
 */
export class SkillBook {
  readonly events = new Emitter<SkillBookEvents>();
  state: SkillBookState;
  /** Player base level, supplied by the game layer for level requirements. */
  level = 1;
  now: () => number = () => Date.now();

  constructor(
    readonly reg: Registry,
    state?: SkillBookState,
  ) {
    this.state = state ? structuredClone(state) : emptyState();
  }

  // ---------- queries ----------

  has(id: string): boolean {
    return id in this.state.skills;
  }

  hasElement(id: ElementId): boolean {
    return !!this.state.elements[id];
  }

  progress(id: string): SkillProgress | undefined {
    return this.state.skills[id];
  }

  rank(id: string): number {
    return this.state.skills[id]?.rank ?? 0;
  }

  known(): SkillDef[] {
    return Object.keys(this.state.skills)
      .map((id) => this.reg.skill(id))
      .filter((s): s is SkillDef => !!s);
  }

  knownElements(): ElementDef[] {
    return (Object.keys(this.state.elements) as ElementId[])
      .map((id) => this.reg.element(id))
      .filter((e): e is ElementDef => !!e);
  }

  flag(id: string): number {
    return this.state.flags[id] ?? 0;
  }

  isMaxed(id: string): boolean {
    const s = this.reg.skill(id);
    const p = this.progress(id);
    return !!s && !!p && p.rank >= s.maxRank;
  }

  /** XP needed to fill the current bar (rank or overmastery). */
  barSize(id: string): number {
    const s = this.reg.skill(id);
    const p = this.progress(id);
    if (!s || !p) return 1;
    return p.rank >= s.maxRank ? overmasteryCost(s.maxRank, s.tier) : xpToNext(p.rank, s.tier);
  }

  // ---------- learning ----------

  learn(id: string, source: string): boolean {
    const skill = this.reg.skill(id);
    if (!skill) throw new Error(`Unknown skill ${id}`);
    if (this.has(id)) return false;
    this.state.skills[id] = { id, rank: 1, xp: 0, charges: 0, uses: 0, source, learnedAt: this.now() };
    this.events.emit('learned', { skill, source });
    this.evaluateClasses();
    return true;
  }

  learnElement(id: ElementId, source: string): boolean {
    const element = this.reg.element(id);
    if (!element) throw new Error(`Unknown element ${id}`);
    if (this.hasElement(id)) return false;
    this.state.elements[id] = { source, learnedAt: this.now() };
    this.events.emit('element', { element, source });
    this.evaluateClasses();
    return true;
  }

  incFlag(id: string, n = 1): number {
    this.state.flags[id] = this.flag(id) + n;
    return this.state.flags[id];
  }

  // ---------- mastery ----------

  addMastery(id: string, amount: number): void {
    const skill = this.reg.skill(id);
    const p = this.progress(id);
    if (!skill || !p || amount <= 0) return;
    const startCharges = p.charges;
    p.xp += amount * MASTERY.rate;
    // Rank ups.
    while (p.rank < skill.maxRank && p.xp >= xpToNext(p.rank, skill.tier)) {
      p.xp -= xpToNext(p.rank, skill.tier);
      p.rank++;
      this.events.emit('rankUp', { skill, rank: p.rank });
      if (p.rank >= skill.maxRank) {
        p.charges = Math.min(MASTERY.maxCharges, p.charges + 1);
        this.events.emit('mastered', { skill });
      }
    }
    // Overmastery: keep training a maxed skill to bank extra morph charges.
    if (p.rank >= skill.maxRank) {
      const cost = overmasteryCost(skill.maxRank, skill.tier);
      while (p.xp >= cost) {
        if (p.charges >= MASTERY.maxCharges) {
          p.xp = cost;
          break;
        }
        p.xp -= cost;
        p.charges++;
      }
    }
    if (p.charges > startCharges) this.events.emit('charge', { skill, charges: p.charges });
  }

  recordUse(id: string): void {
    const p = this.progress(id);
    if (!p) return;
    p.uses++;
    this.addMastery(id, MASTERY.useXp);
  }

  /** Call once per enemy struck. `hitIndex` is the n-th target hit by this use (0-based). */
  recordHit(id: string, killed: boolean, hitIndex = 0): void {
    if (hitIndex >= MASTERY.maxHitsPerUse) return;
    this.addMastery(id, MASTERY.hitXp + (killed ? MASTERY.killXp : 0));
  }

  // ---------- requirements ----------

  meets(r: Requirement): boolean {
    switch (r.type) {
      case 'element':
        return this.hasElement(r.id);
      case 'skill':
        return this.rank(r.id) >= (r.rank ?? 1);
      case 'flag':
        return this.flag(r.id) >= r.min;
      case 'level':
        return this.level >= r.min;
      case 'class':
        return this.state.classes.includes(r.id);
    }
  }

  describe(r: Requirement): string {
    switch (r.type) {
      case 'element':
        return `Attune ${this.reg.element(r.id)?.name ?? r.id}`;
      case 'skill':
        return `${this.reg.skill(r.id)?.name ?? r.id} rank ${r.rank ?? 1}`;
      case 'flag':
        return r.label ?? `${r.id} ${this.flag(r.id)}/${r.min}`;
      case 'level':
        return `Base level ${r.min}`;
      case 'class':
        return `Discover ${this.reg.classDef(r.id)?.name ?? r.id}`;
    }
  }

  // ---------- morphing ----------

  morphOptions(id: string): MorphOption[] {
    return this.reg.morphsFrom(id).map((morph) => {
      const available = (morph.requires ?? []).every((r) => this.meets(r));
      const owned = this.has(morph.to);
      const skill = this.reg.skill(morph.to)!;
      return {
        morph,
        skill: available || owned ? skill : null,
        available,
        owned,
        hint: morph.hint ?? 'Something stirs within this technique...',
      };
    });
  }

  canMorph(from: string): boolean {
    const p = this.progress(from);
    return !!p && p.charges > 0 && this.morphOptions(from).some((o) => o.available && !o.owned);
  }

  morph(from: string, to: string): { ok: true; skill: SkillDef } | { ok: false; message: string } {
    const p = this.progress(from);
    const src = this.reg.skill(from);
    if (!p || !src) return { ok: false, message: 'You do not know that skill.' };
    if (p.charges <= 0) return { ok: false, message: `${src.name} has no morph charges. Master it further.` };
    const opt = this.morphOptions(from).find((o) => o.morph.to === to);
    if (!opt) return { ok: false, message: 'That is not a form this skill can take.' };
    if (opt.owned) return { ok: false, message: 'You already know that form.' };
    if (!opt.available) return { ok: false, message: opt.hint };
    p.charges--;
    const target = this.reg.skill(to)!;
    this.learn(to, `morph:${from}`);
    this.events.emit('morphed', { from: src, to: target });
    return { ok: true, skill: target };
  }

  // ---------- fusion ----------

  /** Whether the player may put this ingredient on the fusion altar. */
  ingredientReady(ref: IngredientRef): { ok: boolean; message?: string } {
    const p = parseRef(ref);
    if (p.kind === 'el') return this.hasElement(p.id) ? { ok: true } : { ok: false, message: 'Element not attuned.' };
    const s = this.reg.skill(p.id);
    const prog = this.progress(p.id);
    if (!s || !prog) return { ok: false, message: 'Skill not known.' };
    const need = fusionMinRank(s.maxRank);
    if (prog.rank < need) return { ok: false, message: `${s.name} must reach rank ${need} to be fused.` };
    return { ok: true };
  }

  /** Every ingredient the player owns, with readiness. */
  ingredients(): { ref: IngredientRef; ready: boolean; message?: string }[] {
    const refs = [
      ...this.knownElements().map((e) => elRef(e.id)),
      ...this.known()
        .filter((s) => s.shape.kind !== 'buff' || this.reg.recipesWith(skillRef(s.id)).length > 0)
        .map((s) => skillRef(s.id)),
    ];
    return refs.map((ref) => {
      const r = this.ingredientReady(ref);
      return { ref, ready: r.ok, message: r.message };
    });
  }

  /** What the journal remembers about a pair, without performing it. */
  rememberedPair(a: IngredientRef, b: IngredientRef): 'unknown' | 'nothing' | 'discovered' {
    const k = pairKey(a, b);
    if (this.state.discoveries.includes(k)) return 'discovered';
    if (this.state.attempts.includes(k)) return 'nothing';
    return 'unknown';
  }

  fuse(a: IngredientRef, b: IngredientRef): FuseResult {
    if (a === b) return { ok: false, reason: 'same', message: 'An essence cannot be fused with itself.' };
    for (const ref of [a, b]) {
      const ready = this.ingredientReady(ref);
      if (!ready.ok) {
        return { ok: false, reason: ready.message?.includes('rank') ? 'rank' : 'missing', message: ready.message! };
      }
    }
    const key = pairKey(a, b);
    const recipe = this.reg.recipe(a, b);

    let result: IngredientRef | null = null;
    let procedural = false;

    if (recipe) {
      const unmet = (recipe.requires ?? []).filter((r) => !this.meets(r));
      if (unmet.length) {
        return {
          ok: false,
          reason: 'requirement',
          message: `The essences resonate, but something is missing: ${unmet.map((r) => this.describe(r)).join(', ')}.`,
        };
      }
      result = recipe.result;
    } else {
      result = this.proceduralResult(a, b);
      procedural = !!result;
    }

    if (!this.state.attempts.includes(key)) this.state.attempts.push(key);

    if (!result) {
      const hint = this.hintFor(a, b);
      if (hint && !this.state.hints.includes(hint)) {
        this.state.hints.push(hint);
        this.events.emit('hint', { text: hint });
      }
      return { ok: false, reason: 'nothing', message: this.failureFlavor(a, b), hint };
    }

    if (!this.state.discoveries.includes(key)) this.state.discoveries.push(key);
    const parsed = parseRef(result);
    let isNew: boolean;
    if (parsed.kind === 'el') isNew = this.learnElement(parsed.id, `fusion:${key}`);
    else isNew = this.learn(parsed.id, `fusion:${key}`);
    this.events.emit('fused', { a, b, result, isNew });
    return { ok: true, result, name: this.reg.refName(result), isNew, procedural };
  }

  private proceduralResult(a: IngredientRef, b: IngredientRef): IngredientRef | null {
    const pa = parseRef(a);
    const pb = parseRef(b);
    const el = pa.kind === 'el' ? pa : pb.kind === 'el' ? pb : null;
    const sk = pa.kind === 'skill' ? pa : pb.kind === 'skill' ? pb : null;
    if (!el || !sk) return null;
    const base = this.reg.skill(sk.id);
    if (!base || !canInfuse(base)) return null;
    return skillRef(infusedId(base.id, el.id));
  }

  /** Points the player toward an undiscovered recipe that uses one of their ingredients. */
  private hintFor(a: IngredientRef, b: IngredientRef): string | undefined {
    const candidates = [...this.reg.recipesWith(a), ...this.reg.recipesWith(b)].filter(
      (r) => r.hint && !this.state.discoveries.includes(pairKey(r.a, r.b)),
    );
    if (!candidates.length) return undefined;
    const pick = candidates[hash(pairKey(a, b)) % candidates.length];
    return pick.hint;
  }

  private failureFlavor(a: IngredientRef, b: IngredientRef): string {
    const pa = parseRef(a);
    const pb = parseRef(b);
    if (pa.kind === 'el' && pb.kind === 'el') return 'The two elements swirl together, then drift apart.';
    const skillPart = pa.kind === 'skill' ? pa : pb.kind === 'skill' ? pb : null;
    if (skillPart && (pa.kind === 'el' || pb.kind === 'el')) {
      const s = this.reg.skill(skillPart.id);
      if (s?.element) return `${s.name} is already bound to ${this.reg.element(s.element)?.name}. The new element is repelled.`;
      if (s?.shape.kind === 'buff') return `${s.name} has no edge for the element to cling to.`;
    }
    return 'The essences flicker... and nothing happens.';
  }

  // ---------- classes ----------

  private countClause(c: ClassClause, known: SkillDef[]): number {
    return known.filter((s) => c.tags.every((t) => s.tags.includes(t))).length;
  }

  classProgress(cls: ClassDef): ClassProgress {
    const known = this.known();
    const clauses = cls.clauses.map((clause) => ({ clause, have: this.countClause(clause, known) }));
    let total = 0;
    let have = 0;
    for (const c of clauses) {
      total += c.clause.count;
      have += Math.min(c.have, c.clause.count);
    }
    let elements: ClassProgress['elements'];
    if (cls.distinctElements) {
      const n = new Set(known.map((s) => s.element).filter(Boolean)).size;
      elements = { have: n, need: cls.distinctElements };
      total += cls.distinctElements;
      have += Math.min(n, cls.distinctElements);
    }
    return {
      cls,
      discovered: this.state.classes.includes(cls.id),
      progress: total ? have / total : 0,
      clauses,
      elements,
    };
  }

  /** Discovers every class whose requirements are now satisfied. */
  evaluateClasses(): ClassDef[] {
    const found: ClassDef[] = [];
    for (const cls of this.reg.classes) {
      if (this.state.classes.includes(cls.id)) continue;
      if (this.classProgress(cls).progress < 1) continue;
      this.state.classes.push(cls.id);
      if (!this.state.activeClass) this.state.activeClass = cls.id;
      found.push(cls);
      this.events.emit('classDiscovered', { cls });
      for (const g of cls.grants ?? []) this.learn(g, `class:${cls.id}`);
    }
    return found;
  }

  setActiveClass(id: string | null): boolean {
    if (id !== null && !this.state.classes.includes(id)) return false;
    this.state.activeClass = id;
    return true;
  }

  activeBonus(): StatBonus {
    const cls = this.state.activeClass ? this.reg.classDef(this.state.activeClass) : undefined;
    return cls?.bonus ?? {};
  }

  /** Percent bonus damage for a skill from the active class. */
  tagPowerFor(skill: SkillDef): number {
    const tp = this.activeBonus().tagPower ?? {};
    return skill.tags.reduce((sum, t) => sum + (tp[t] ?? 0), 0);
  }

  // ---------- journal ----------

  stats() {
    const authored = this.reg.authoredSkills();
    const known = this.known();
    return {
      skillsKnown: known.length,
      authoredKnown: known.filter((s) => !s.generated).length,
      authoredTotal: authored.length,
      infusions: known.filter((s) => s.generated).length,
      elementsKnown: this.knownElements().length,
      elementsTotal: this.reg.elements.size,
      classesKnown: this.state.classes.length,
      classesTotal: this.reg.classes.length,
      experiments: this.state.attempts.length,
      discoveries: this.state.discoveries.length,
    };
  }

  serialize(): SkillBookState {
    return structuredClone(this.state);
  }
}
