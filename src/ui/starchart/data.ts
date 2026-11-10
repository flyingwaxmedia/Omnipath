// Star Chart data (docs/CLIENT-v3.md §3) — owned by the starchart lane. PURE: reads only the registry, the book and
// static world data (no DOM, no Phaser), so the game serves it through GameController.starChartData() and tests call
// it in node. layout.ts turns it into positions; panels/starchart.ts + sky.ts draw it.
//
// Two layers:
//  - the SKY PLAN (static, one per registry, cached): every star the sky can ever hold with its constellation, group
//    and tree slot — so a star's place never moves as the player learns things;
//  - the CHART (per call): which of those stars the player can see right now, in which state, and the lines between.
// Visibility rules ("one-step fog"): known stars are bright; the next transforms of a known star are revealed (dim,
// named) or fog ('?', hidden by a world secret); every weapon tree shows its root; skills a visible quest teaches,
// echoes the player has seen and signatures of whispered classes are revealed; a whispered fusion shows a faint '?'
// between its ingredients; recipe lines appear once the recipe is discovered; every element of The Heart is drawn.
import type { Registry } from '../../core/registry';
import type { SkillBook } from '../../core/skillbook';
import { classTier } from '../../core/classes';
import type { ClassDef, ElementId, WeaponType } from '../../core/types';
import { WEAPON_TYPES } from '../../core/types';
import { NPCS } from '../../data/npcs';
import { WEAPONS } from '../../data/weapons';
import { MAPS, REGIONS } from '../../data/world';

/** The constellations of the sky ('universal' sits near The Craft, 'fusion' results float between ingredients). */
export type ConstellationId = 'edge' | 'fang' | 'lantern' | 'heart' | 'craft' | 'wild' | 'crown' | 'universal' | 'fusion';

/** The seven named constellations (the chips), in chip order. */
export const CONSTELLATIONS: readonly { id: ConstellationId; name: string }[] = [
  { id: 'edge', name: 'The Edge' },
  { id: 'fang', name: 'The Fang' },
  { id: 'lantern', name: 'The Lantern' },
  { id: 'heart', name: 'The Heart' },
  { id: 'craft', name: 'The Craft' },
  { id: 'wild', name: 'The Wild' },
  { id: 'crown', name: 'The Crown' },
];

/**
 * Star state, brightest first. 'fog' = an unknown star shown as a faint "?" (one step from a known star);
 * 'whisper' = a fusion result the player heard a hint about (a faint "?" between its ingredients).
 */
export type StarState = 'mastered' | 'morphReady' | 'known' | 'revealed' | 'fog' | 'whisper';

/** One place in the sky (static: from the registry only). */
export interface SkyStar {
  /** Skill id, or 'el:<id>' for element stars. */
  id: string;
  kind: 'skill' | 'element';
  constellation: ConstellationId;
  /** Sub-group inside the constellation (a trainer, a region, a class tier…); stars of a group sit together. */
  group: string;
  /** Index inside its group (registry order). */
  order: number;
  /** Size class only (never shown as a "tier"). */
  size: 0 | 1 | 2 | 3;
  element?: ElementId;
  /** Weapon trees: which weapon, the depth (0 root … 3 capstone), the T1 branch and the index among siblings. */
  weapon?: WeaponType;
  depth?: number;
  branch?: number;
  twig?: number;
  /** The morph parent (trees, technique chains). */
  parent?: string;
  /** Recipe results: the two ingredient star ids of the first recipe (placement + whispers). */
  ingredients?: [string, string];
  /** Fused elements: their two parent element star ids. */
  parents?: [string, string];
}

export interface SkyGroup {
  id: string;
  constellation: ConstellationId;
  /** Plain label drawn in the sky ('Hearth Vale', 'Hale'); '' = none. */
  name: string;
}

export interface SkyPlan {
  stars: SkyStar[];
  byId: ReadonlyMap<string, SkyStar>;
  groups: SkyGroup[];
}

export interface StarView {
  /** Skill id, or 'el:<id>' for element stars. */
  id: string;
  kind: 'skill' | 'element' | 'variant';
  /** Display name ('?' for fog / whisper stars). */
  name: string;
  constellation: ConstellationId;
  state: StarState;
  /** At max rank (gold halo) — also true for a mastered star that can transform. */
  mastered: boolean;
  /** Size class only (never shown as a "tier"). */
  size: 0 | 1 | 2 | 3;
  element?: ElementId;
  rank: number;
  maxRank: number;
  /** Morph parent (trees, technique chains). */
  parent?: string;
  /** Weapon trees: which weapon. */
  weapon?: WeaponType;
  /** Fusion results: the two ingredient star ids. */
  ingredients?: [string, string];
  /** Variants: the base star id they orbit. */
  base?: string;
}

export interface StarLinkView {
  from: string;
  to: string;
  kind: 'morph' | 'recipe';
  /** Solid when both ends are known, faint dotted toward a revealed / fog star. */
  known: boolean;
}

export interface StarChartData {
  stars: StarView[];
  links: StarLinkView[];
  /** "Stars charted N / M": known authored skills and elements / all of them. */
  charted: number;
  total: number;
  /** The static sky every chart is laid out on (same object for the same registry). */
  sky: SkyPlan;
}

/**
 * The skills only this class has: the class skills made for it (v4: `classOf`), and its old signature skills. A
 * class not rebuilt yet borrows ordinary skills for its five — those stay where they are in the sky.
 */
export function classOwnSkills(reg: Registry, cl: ClassDef): readonly string[] {
  const own = (cl.kit ?? []).filter((id) => reg.skill(id)?.classOf === cl.id);
  return [...new Set([...own, ...(cl.grants ?? [])])];
}

const TREE: Record<WeaponType, ConstellationId> = { sword: 'edge', dagger: 'fang', staff: 'lantern', fists: 'craft' };

/** Star id for an ingredient ref ('skill:x' → 'x', 'el:fire' → 'el:fire'); null for essences / passives. */
function refStar(ref: string): string | null {
  if (ref.startsWith('skill:')) return ref.slice(6);
  if (ref.startsWith('el:')) return ref;
  return null;
}

const size = (n: number): SkyStar['size'] => Math.max(0, Math.min(3, n)) as SkyStar['size'];

// ====================================================================== the static sky

const PLANS = new WeakMap<Registry, SkyPlan>();

/** Every star the sky can hold, with its constellation, group and tree slot. Cached per registry. */
export function skyPlan(reg: Registry): SkyPlan {
  const hit = PLANS.get(reg);
  if (hit) return hit;
  const stars: SkyStar[] = [];
  const byId = new Map<string, SkyStar>();
  const groups: SkyGroup[] = [];
  const groupSize = new Map<string, number>();
  const group = (id: string, c: ConstellationId, name: string) => {
    if (!groupSize.has(id)) {
      groupSize.set(id, 0);
      groups.push({ id, constellation: c, name });
    }
    return id;
  };
  const add = (s: Omit<SkyStar, 'order'>) => {
    if (byId.has(s.id)) return;
    const order = groupSize.get(s.group) ?? 0;
    groupSize.set(s.group, order + 1);
    const star = { ...s, order };
    stars.push(star);
    byId.set(s.id, star);
  };

  // Recipe results (first recipe wins) — any constellation can hold one.
  const recipeOf = new Map<string, [string, string]>();
  for (const r of reg.recipeList) {
    const res = refStar(r.result);
    const a = refStar(r.a);
    const b = refStar(r.b);
    if (res && a && b && !recipeOf.has(res)) recipeOf.set(res, [a, b]);
  }

  // The Heart: primal elements, then fused ones (between their parents).
  for (const el of reg.elements.values()) {
    const id = `el:${el.id}`;
    const g = group(el.tier === 0 ? 'heart:primal' : 'heart:fused', 'heart', '');
    add({ id, kind: 'element', constellation: 'heart', group: g, size: el.tier === 0 ? 2 : 1, element: el.id, ...(el.tier > 0 && recipeOf.get(id) ? { parents: recipeOf.get(id) } : {}) });
  }

  // Weapon trees: root, T1 branches, two T2 per branch, T3 under its T2 (breadth-first, data order).
  for (const w of WEAPON_TYPES) {
    const c = TREE[w];
    const g = group(`tree:${w}`, c, '');
    const root = WEAPONS[w].basic;
    const sk = reg.skill(root);
    if (!sk) continue;
    add({ id: root, kind: 'skill', constellation: c, group: g, size: 1, element: sk.element, weapon: w, depth: 0 });
    const walk = (from: string, depth: number, branch: number | undefined) => {
      reg.morphsFrom(from).forEach((m, i) => {
        const to = reg.skill(m.to);
        if (!to || byId.has(m.to) || to.tags.includes('monster')) return;
        const b = depth === 0 ? i : branch!;
        add({ id: m.to, kind: 'skill', constellation: c, group: g, size: size(depth + 1), element: to.element, weapon: w, depth: depth + 1, branch: b, twig: i, parent: from, ...(recipeOf.get(m.to) ? { ingredients: recipeOf.get(m.to) } : {}) });
        walk(m.to, depth + 1, b);
      });
    };
    walk(root, 0, undefined);
  }

  // Everyone who teaches a technique (trainer lessons) → that trainer's group.
  const teacher = new Map<string, string>();
  for (const t of reg.trainers) for (const l of t.lessons) if ('skill' in l.grants && !teacher.has(l.grants.skill)) teacher.set(l.grants.skill, t.npc);
  const npcName = new Map(NPCS.map((n) => [n.id, n.name]));
  // Where each echo is first seen (map order) → its region.
  const regionOf = new Map<string, string>();
  for (const m of MAPS) for (const sp of m.spawns ?? []) if (!regionOf.has(sp.monster)) regionOf.set(sp.monster, m.region);
  const regionName = new Map(REGIONS.map((r) => [r.id, r.name]));
  const signature = new Map<string, number>();
  // v4: a class's own skills are its five class skills (the old signature list for classes not rebuilt yet).
  for (const cl of reg.classes) for (const g of classOwnSkills(reg, cl)) if (!signature.has(g)) signature.set(g, classTier(cl));

  const rest = reg.authoredSkills().filter((s) => !byId.has(s.id) && !s.tags.includes('monster'));
  // Parents before children so a technique chain follows its first link.
  const parentOf = (id: string) => reg.morphsTo(id)[0]?.from;
  const ordered: typeof rest = [];
  const seen = new Set<string>();
  const visit = (s: (typeof rest)[number]) => {
    if (seen.has(s.id)) return;
    seen.add(s.id);
    const p = parentOf(s.id);
    const ps = p ? rest.find((x) => x.id === p) : undefined;
    if (ps) visit(ps);
    ordered.push(s);
  };
  rest.forEach(visit);
  for (const s of ordered) {
    const parent = parentOf(s.id);
    const ingredients = recipeOf.get(s.id);
    const base = { id: s.id, kind: 'skill' as const, size: size(s.tier), element: s.element, ...(parent ? { parent } : {}), ...(ingredients ? { ingredients } : {}) };
    if (signature.has(s.id)) {
      const tier = signature.get(s.id)!;
      add({ ...base, constellation: 'crown', group: group(`crown:${tier}`, 'crown', '') });
    } else if (s.tags.includes('echo')) {
      const src = reg.techniqueSources(s.id).find((t) => t.technique.echo) ?? reg.techniqueSources(s.id)[0];
      const region = (src && regionOf.get(src.monster.id)) ?? 'far';
      add({ ...base, constellation: 'wild', group: group(`wild:${region}`, 'wild', regionName.get(region) ?? 'Far lands') });
    } else if (s.tags.includes('technique')) {
      const npc = teacher.get(s.id);
      const pstar = parent ? byId.get(parent) : undefined;
      // Nobody teaches it and it transforms from a star elsewhere (Jelly Slam → Crown Slam): it sits by its parent.
      if (!npc && pstar && pstar.constellation !== 'craft' && pstar.depth === undefined && pstar.kind === 'skill') {
        add({ ...base, constellation: pstar.constellation, group: pstar.group });
        continue;
      }
      const g = npc ? `craft:${npc}` : pstar?.constellation === 'craft' ? pstar.group : 'craft:more';
      add({ ...base, constellation: 'craft', group: group(g, 'craft', npc ? (npcName.get(npc) ?? '') : '') });
    } else if (ingredients) {
      add({ ...base, constellation: 'fusion', group: group('fusion', 'fusion', '') });
    } else {
      add({ ...base, constellation: 'universal', group: group('universal', 'universal', '') });
    }
  }

  const plan: SkyPlan = { stars, byId, groups };
  PLANS.set(reg, plan);
  return plan;
}

// ====================================================================== the chart for one book

/** Skills that quests teach (directly or through a lesson), by skill id → quest ids. Cached per registry. */
const QUEST_TEACH = new WeakMap<Registry, Map<string, string[]>>();
function questTeachers(reg: Registry): Map<string, string[]> {
  const hit = QUEST_TEACH.get(reg);
  if (hit) return hit;
  const out = new Map<string, string[]>();
  for (const q of reg.quests.values()) {
    const g = q.rewards.lesson ? reg.lesson(q.rewards.lesson)?.lesson.grants : undefined;
    const id = q.rewards.skill ?? (g && 'skill' in g ? g.skill : undefined);
    if (id) out.set(id, [...(out.get(id) ?? []), q.id]);
  }
  QUEST_TEACH.set(reg, out);
  return out;
}

/** Everything the Star Chart shows for this book. Deterministic (data order). */
export function buildStarChartData(reg: Registry, book: SkillBook): StarChartData {
  const sky = skyPlan(reg);
  const stars = new Map<string, StarView>();
  const links: StarLinkView[] = [];

  const put = (s: SkyStar, state: StarState) => {
    if (stars.has(s.id)) return;
    if (s.kind === 'element') {
      const el = reg.element(s.id.slice(3) as ElementId);
      const has = !!el && book.hasElement(el.id);
      stars.set(s.id, { id: s.id, kind: 'element', name: has ? el!.name : '?', constellation: 'heart', state: has ? 'known' : 'fog', mastered: false, size: s.size, ...(has ? { element: s.element } : {}), rank: 0, maxRank: 0, ...(s.parents ? { ingredients: s.parents } : {}) });
      return;
    }
    const sk = reg.skill(s.id);
    if (!sk) return;
    const prog = book.progress(s.id);
    const hidden = state === 'fog' || state === 'whisper';
    stars.set(s.id, {
      id: s.id,
      kind: 'skill',
      name: hidden ? '?' : sk.name,
      constellation: s.constellation,
      state,
      mastered: !!prog && book.isMaxed(s.id),
      size: s.size,
      ...(sk.element && !hidden ? { element: sk.element } : {}),
      rank: prog?.rank ?? 0,
      maxRank: sk.maxRank,
      ...(s.parent ? { parent: s.parent } : {}),
      ...(s.weapon ? { weapon: s.weapon } : {}),
      ...(s.ingredients ? { ingredients: s.ingredients } : {}),
    });
  };
  const knownState = (id: string): StarState => (book.canMorph(id) ? 'morphReady' : book.isMaxed(id) ? 'mastered' : 'known');

  // Known skills (bright), in sky order.
  for (const s of sky.stars) if (s.kind === 'skill' && book.has(s.id)) put(s, knownState(s.id));
  // The next transforms of every known star: revealed (named) or fog (a world secret hides it).
  for (const s of sky.stars) {
    if (s.kind !== 'skill' || !book.has(s.id)) continue;
    for (const opt of book.morphOptions(s.id)) {
      const t = sky.byId.get(opt.morph.to);
      if (t && !stars.has(t.id)) put(t, opt.skill ? 'revealed' : 'fog');
    }
  }
  // Every weapon tree shows its root; skills a visible quest teaches; echoes seen once; whispered class signatures.
  const teach = questTeachers(reg);
  const whispered = new Set(book.state.whispered);
  for (const s of sky.stars) {
    if (s.kind !== 'skill' || stars.has(s.id)) continue;
    const visibleQuest = (teach.get(s.id) ?? []).some((q) => {
      const st = book.questStatus(q);
      return st === 'available' || st === 'active' || st === 'ready';
    });
    const seenEcho = (book.state.witness[s.id] ?? 0) > 0;
    const sig = s.constellation === 'crown' && reg.classes.some((c) => whispered.has(c.id) && classOwnSkills(reg, c).includes(s.id));
    if (s.depth === 0 || visibleQuest || seenEcho || sig) put(s, 'revealed');
  }
  // Recipes: discovered → result + lines; whispered (its hint heard) → a faint '?' between the ingredients.
  const hints = new Set(book.state.hints);
  const discovered: [string, string, string][] = [];
  for (const r of reg.recipeList) {
    const res = refStar(r.result);
    const a = refStar(r.a);
    const b = refStar(r.b);
    if (!res || !a || !b || res.startsWith('el:')) continue;
    const t = sky.byId.get(res);
    if (!t) continue;
    if (book.rememberedPair(r.a, r.b) === 'discovered') {
      put(t, book.has(res) ? knownState(res) : 'revealed');
      discovered.push([a, b, res]);
    } else if (r.hint && hints.has(r.hint) && !stars.has(res)) put(t, 'whisper');
  }
  // The Heart: every element (known bright, unknown as '?').
  for (const s of sky.stars) if (s.kind === 'element') put(s, 'known');

  const lit = (id: string) => {
    const s = stars.get(id);
    return !!s && s.state !== 'revealed' && s.state !== 'fog' && s.state !== 'whisper';
  };
  // Morph lines between drawn stars (trees, technique chains, cross links such as Quickstep → Shadowstep).
  for (const s of stars.values()) {
    if (s.kind !== 'skill' || !lit(s.id)) continue;
    for (const m of reg.morphsFrom(s.id)) if (stars.has(m.to)) links.push({ from: s.id, to: m.to, kind: 'morph', known: lit(m.to) });
  }
  // Recipe lines, only once the recipe is discovered.
  for (const [a, b, res] of discovered) {
    for (const from of [a, b]) if (stars.has(from)) links.push({ from, to: res, kind: 'recipe', known: lit(from) && lit(res) });
  }

  // Generated variants the player knows: tiny satellites of their base.
  for (const s of book.known()) {
    if (!s.generated || stars.has(s.id)) continue;
    const base = reg.baseOf(s.id);
    if (!base || !stars.has(base)) continue;
    const prog = book.progress(s.id);
    stars.set(s.id, {
      id: s.id,
      kind: 'variant',
      name: s.name,
      constellation: stars.get(base)!.constellation,
      state: book.canMorph(s.id) ? 'morphReady' : book.isMaxed(s.id) ? 'mastered' : 'known',
      mastered: book.isMaxed(s.id),
      size: 0,
      ...(s.element ? { element: s.element } : {}),
      rank: prog?.rank ?? 0,
      maxRank: s.maxRank,
      base,
    });
  }

  let charted = 0;
  for (const s of sky.stars) if (s.kind === 'element' ? book.hasElement(s.id.slice(3) as ElementId) : book.has(s.id)) charted++;
  return { stars: [...stars.values()], links, charted, total: sky.stars.length, sky };
}
