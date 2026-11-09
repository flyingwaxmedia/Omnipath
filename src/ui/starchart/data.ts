// Star Chart data (docs/CLIENT-v3.md §3) — owned by the starchart lane. PURE: reads only the registry and the
// book (no DOM, no Phaser), so the game can serve it through GameController.starChartData() and tests can call it
// in node. layout.ts turns it into positions; starchart.ts draws it.
//
// First version (integration skeleton): every authored skill grouped into its constellation, element stars for
// The Heart, morph links, discovered recipe links, generated variants as satellites, and the one-step fog
// (unknown stars appear only as "?" when directly linked to a known star). The starchart lane refines it.
import type { Registry } from '../../core/registry';
import type { SkillBook } from '../../core/skillbook';
import type { ElementId, WeaponType } from '../../core/types';
import { WEAPON_TYPES } from '../../core/types';
import { WEAPONS } from '../../data/weapons';

/** The constellations of the sky. */
export type ConstellationId = 'edge' | 'fang' | 'lantern' | 'heart' | 'craft' | 'wild' | 'crown' | 'universal' | 'fusion';

/** Star state, brightest first. 'fog' = an unknown star shown as a faint "?" (one step from a known star). */
export type StarState = 'mastered' | 'morphReady' | 'known' | 'revealed' | 'fog';

export interface StarView {
  /** Skill id, or 'el:<id>' for element stars. */
  id: string;
  kind: 'skill' | 'element' | 'variant';
  /** Display name ('?' for fog stars). */
  name: string;
  constellation: ConstellationId;
  state: StarState;
  /** Size class only (never shown as a "tier"). */
  size: 0 | 1 | 2 | 3;
  element?: ElementId;
  rank: number;
  maxRank: number;
  /** Weapon trees: the morph parent (the root has none). */
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
}

const TREE: Record<WeaponType, ConstellationId> = { sword: 'edge', dagger: 'fang', staff: 'lantern' };

/** Star id for an ingredient ref ('skill:x' → 'x', 'el:fire' → 'el:fire'); null for essences / passives. */
function refStar(ref: string): string | null {
  if (ref.startsWith('skill:')) return ref.slice(6);
  if (ref.startsWith('el:')) return ref;
  return null;
}

/** Everything the Star Chart shows for this book. Deterministic (data order). */
export function buildStarChartData(reg: Registry, book: SkillBook): StarChartData {
  const stars = new Map<string, StarView>();
  const links: StarLinkView[] = [];
  const known = (id: string) => (id.startsWith('el:') ? book.hasElement(id.slice(3) as ElementId) : book.has(id));

  // Which constellation each authored skill belongs to.
  const home = new Map<string, { c: ConstellationId; weapon?: WeaponType; parent?: string }>();
  for (const w of WEAPON_TYPES) {
    const root = WEAPONS[w].basic;
    home.set(root, { c: TREE[w], weapon: w });
    const queue = [root];
    while (queue.length) {
      const from = queue.shift()!;
      for (const m of reg.morphsFrom(from)) {
        if (home.has(m.to)) continue;
        home.set(m.to, { c: TREE[w], weapon: w, parent: from });
        queue.push(m.to);
      }
    }
  }
  const signatures = new Set(reg.classes.flatMap((c) => c.grants ?? []));
  const recipeResult = new Map<string, [string, string]>();
  for (const r of reg.recipeList) {
    const res = refStar(r.result);
    const a = refStar(r.a);
    const b = refStar(r.b);
    if (res && a && b && !res.startsWith('el:')) recipeResult.set(res, [a, b]);
  }
  for (const s of reg.authoredSkills()) {
    if (home.has(s.id) || s.tags.includes('monster')) continue;
    if (signatures.has(s.id)) home.set(s.id, { c: 'crown' });
    else if (s.tags.includes('echo')) home.set(s.id, { c: 'wild' });
    else if (s.tags.includes('technique')) home.set(s.id, { c: 'craft' });
    else if (recipeResult.has(s.id)) home.set(s.id, { c: 'fusion' });
    else home.set(s.id, { c: 'universal' });
  }

  // Known and revealed skills (one-step fog along morph links).
  const skillStar = (id: string, state: StarState) => {
    const s = reg.skill(id);
    const h = home.get(id);
    if (!s || !h || stars.has(id)) return;
    const prog = book.progress(id);
    stars.set(id, {
      id,
      kind: 'skill',
      name: state === 'fog' ? '?' : s.name,
      constellation: h.c,
      state,
      size: Math.max(0, Math.min(3, s.tier)) as StarView['size'],
      element: s.element,
      rank: prog?.rank ?? 0,
      maxRank: s.maxRank,
      parent: h.parent,
      weapon: h.weapon,
      ingredients: recipeResult.get(id),
    });
  };
  for (const s of reg.authoredSkills()) {
    if (!book.has(s.id) || !home.has(s.id)) continue;
    skillStar(s.id, book.isMaxed(s.id) ? 'mastered' : book.canMorph(s.id) ? 'morphReady' : 'known');
  }
  for (const s of [...stars.values()]) {
    for (const opt of book.morphOptions(s.id)) {
      const to = opt.morph.to;
      if (!stars.has(to)) skillStar(to, opt.skill ? 'revealed' : 'fog');
      links.push({ from: s.id, to, kind: 'morph', known: book.has(to) });
    }
  }
  // Morph links between two known stars reached from the other side (tree parents).
  for (const s of stars.values()) {
    if (s.parent && stars.has(s.parent) && !links.some((l) => l.from === s.parent && l.to === s.id))
      links.push({ from: s.parent, to: s.id, kind: 'morph', known: known(s.parent) && known(s.id) });
  }

  // The Heart: elements (known bright, unknown as fog).
  for (const el of reg.elements.values()) {
    const id = `el:${el.id}`;
    const has = book.hasElement(el.id);
    stars.set(id, { id, kind: 'element', name: has ? el.name : '?', constellation: 'heart', state: has ? 'known' : 'fog', size: 1, element: el.id, rank: 0, maxRank: 0 });
  }

  // Recipe links, only once the recipe is discovered.
  for (const r of reg.recipeList) {
    const res = refStar(r.result);
    const a = refStar(r.a);
    const b = refStar(r.b);
    if (!res || !a || !b || book.rememberedPair(r.a, r.b) !== 'discovered') continue;
    if (!stars.has(res) && !res.startsWith('el:')) skillStar(res, known(res) ? 'known' : 'revealed');
    links.push({ from: a, to: res, kind: 'recipe', known: known(a) && known(res) });
    links.push({ from: b, to: res, kind: 'recipe', known: known(b) && known(res) });
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
      state: book.isMaxed(s.id) ? 'mastered' : 'known',
      size: 0,
      element: s.element,
      rank: prog?.rank ?? 0,
      maxRank: s.maxRank,
      base,
    });
  }

  const authored = [...home.keys()];
  const charted = authored.filter((id) => book.has(id)).length + book.knownElements().length;
  return { stars: [...stars.values()], links, charted, total: authored.length + reg.elements.size };
}
