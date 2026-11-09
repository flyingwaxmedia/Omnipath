// Star Chart layout (starchart lane; docs/CLIENT-v3.md §3). PURE and deterministic: StarChartData in, positions out
// (sky px around the Heart at (0, 0), y down); no DOM, no randomness — unit-tested in tests/starchart-layout.test.ts.
//
// Every star the sky can hold (data.sky) is placed once per registry, so a star never moves as the player learns:
//  - the three weapon trees (The Edge / The Fang / The Lantern): root at the constellation centre, the three T1
//    branches at r = 120 (one pointing away from the Heart, two swept back), two T2 per branch at r = 240 at ±18°,
//    the T3 capstone at r = 360 behind its T2;
//  - The Heart at the centre: the 7 primal elements in a ring (ordered so fused pairs are neighbours), each fused
//    element just outside the ring between its two parents;
//  - The Craft (one spoke of stars per trainer), universal skills in a little zig-zag near it, The Wild (a cluster per
//    region), The Crown (arcs of class signatures, one per class tier);
//  - fusion results at the weighted midpoint of their ingredients plus a deterministic offset, nudged along a golden
//    spiral until no other star is closer than MIN_GAP (and kept out of the Heart);
//  - generated variants as tiny satellites orbiting their base (added per chart; they never move the others).
import type { ConstellationId, SkyPlan, SkyStar, StarChartData } from './data';

export interface PlacedStar {
  id: string;
  x: number;
  y: number;
  /** Drawn radius in sky px. */
  r: number;
}

export interface SkyLabel {
  text: string;
  x: number;
  y: number;
  kind: 'constellation' | 'group';
  constellation: ConstellationId;
}

export interface StarLayout {
  stars: Map<string, PlacedStar>;
  /** Constellation centres (chips centre the view on these). */
  centres: Record<ConstellationId, { x: number; y: number }>;
  /** Constellation names and group names drawn faintly in the sky. */
  labels: SkyLabel[];
  /** Box around every star the sky can hold (+ margin): the camera stays inside it. */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

/** Weapon tree radii by depth (root, T1, T2, T3). */
export const TREE_R = [0, 120, 240, 360] as const;
/** Angle between a T1 branch and each of its T2 stars (degrees). */
export const T2_SPREAD = 18;
/** Smallest centre-to-centre distance between two stars (variants excepted). */
export const MIN_GAP = 60;
/** The Heart: primal ring radius, fused elements' radius, and the keep-out radius for other constellations. */
export const HEART_R = 140;
export const FUSED_R = 225;
export const HEART_CLEAR = 330;
/** Other stars keep this far from a weapon tree's root, so each tree reads as one clean figure. */
export const TREE_CLEAR = 300;
/** Variant satellites: orbit distance beyond their base's radius, and their own radius. */
export const ORBIT = 16;
export const VARIANT_R = 3.5;

const DEG = Math.PI / 180;

/** Outward direction of each constellation from the Heart (degrees, y down: -90 = up). */
const DIR: Record<ConstellationId, number> = {
  heart: -90,
  edge: -90,
  fang: 30,
  lantern: 150,
  crown: -30,
  craft: -150,
  wild: 90,
  universal: -172,
  fusion: 0,
};
/** Distance of each constellation centre from the Heart. */
const DIST: Record<ConstellationId, number> = {
  heart: 0,
  edge: 1080,
  fang: 1080,
  lantern: 1080,
  crown: 1500,
  craft: 1500,
  wild: 1500,
  universal: 1150,
  fusion: 0,
};

const polar = (c: { x: number; y: number }, r: number, a: number) => ({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
const round = (v: number) => Math.round(v * 10) / 10;

export const CENTRES: Record<ConstellationId, { x: number; y: number }> = Object.fromEntries(
  (Object.keys(DIR) as ConstellationId[]).map((c) => {
    const p = polar({ x: 0, y: 0 }, DIST[c], DIR[c] * DEG);
    return [c, { x: round(p.x), y: round(p.y) }];
  }),
) as Record<ConstellationId, { x: number; y: number }>;

/** Stable 32-bit hash (FNV-1a) of a string. */
export function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Drawn radius of a sky star (sky px): elements and capstones are the biggest, roots stand out from their T1. */
export function starRadius(s: Pick<SkyStar, 'kind' | 'size' | 'depth'>): number {
  if (s.kind === 'element') return s.size >= 2 ? 10 : 8.5;
  if (s.depth === 0) return 9.5;
  return [6.5, 7.5, 9, 11][s.size];
}

/** Ring order of the primal elements: keep data order, but make as many fused pairs neighbours as possible. */
export function heartRing(primal: readonly string[], pairs: readonly [string, string][]): string[] {
  if (primal.length <= 3) return [...primal];
  const score = (ring: string[]) => {
    let n = 0;
    for (const [a, b] of pairs) {
      const i = ring.indexOf(a);
      const j = ring.indexOf(b);
      if (i < 0 || j < 0) continue;
      const d = Math.abs(i - j);
      if (d === 1 || d === ring.length - 1) n++;
    }
    return n;
  };
  // Permutations with the first element fixed (lexicographic in data order, so the first best one is stable).
  const [first, ...others] = primal;
  let best = [...primal];
  let bestScore = score(best);
  if (others.length > 7) return best;
  const perm = (left: string[], acc: string[]) => {
    if (bestScore === pairs.length) return;
    if (!left.length) {
      const ring = [first, ...acc];
      const sc = score(ring);
      if (sc > bestScore) {
        best = ring;
        bestScore = sc;
      }
      return;
    }
    for (let i = 0; i < left.length; i++) perm([...left.slice(0, i), ...left.slice(i + 1)], [...acc, left[i]]);
  };
  perm(others, []);
  return best;
}

/** Mean angle of two angles (radians), the short way round. */
function meanAngle(a: number, b: number): number {
  return Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
}

// ====================================================================== the static sky

const SKY = new WeakMap<SkyPlan, StarLayout>();

/** Positions of every star the sky can hold. Cached per plan (the same plan object for the same registry). */
export function layoutSky(plan: SkyPlan): StarLayout {
  const hit = SKY.get(plan);
  if (hit) return hit;
  const stars = new Map<string, PlacedStar>();
  const labels: SkyLabel[] = [];
  const placed: PlacedStar[] = [];
  const put = (s: SkyStar, x: number, y: number) => {
    const p = { id: s.id, x: round(x), y: round(y), r: starRadius(s) };
    stars.set(s.id, p);
    placed.push(p);
    return p;
  };
  const free = (x: number, y: number) => {
    for (const p of placed) if ((p.x - x) ** 2 + (p.y - y) ** 2 < MIN_GAP * MIN_GAP) return false;
    return true;
  };
  /** Keep-out discs: the Heart, and each weapon tree's interior (for stars of other constellations). */
  const zones = [
    { c: 'heart' as ConstellationId, ...CENTRES.heart, r: HEART_CLEAR },
    ...(['edge', 'fang', 'lantern'] as const).map((c) => ({ c, ...CENTRES[c], r: TREE_CLEAR })),
  ];
  /** The nearest free spot to (x, y) along a golden spiral (deterministic per star), outside the keep-out discs. */
  const settle = (s: SkyStar, x: number, y: number) => {
    const out = (px: number, py: number) => {
      for (const z of zones) {
        if (z.c === s.constellation) continue;
        const d = Math.hypot(px - z.x, py - z.y);
        if (d >= z.r) continue;
        const a = d > 1 ? Math.atan2(py - z.y, px - z.x) : (hash(s.id) % 360) * DEG;
        return { x: z.x + Math.cos(a) * z.r, y: z.y + Math.sin(a) * z.r };
      }
      return { x: px, y: py };
    };
    let p = out(x, y);
    if (free(p.x, p.y)) return put(s, p.x, p.y);
    const a0 = (hash(s.id) % 360) * DEG;
    for (let i = 1; i < 2000; i++) {
      const c = polar({ x, y }, 9 * Math.sqrt(i), a0 + i * 137.508 * DEG);
      p = out(c.x, c.y);
      if (free(p.x, p.y)) return put(s, p.x, p.y);
    }
    return put(s, p.x, p.y);
  };
  const byGroup = new Map<string, SkyStar[]>();
  for (const s of plan.stars) {
    const g = byGroup.get(s.group) ?? [];
    g.push(s);
    byGroup.set(s.group, g);
  }
  const groupsOf = (c: ConstellationId) => plan.groups.filter((g) => g.constellation === c && byGroup.get(g.id)?.length);

  // ---- The Heart: primal ring + fused elements between their parents.
  const primal = byGroup.get('heart:primal') ?? [];
  const fused = byGroup.get('heart:fused') ?? [];
  const ring = heartRing(
    primal.map((s) => s.id),
    fused.flatMap((f) => (f.parents ? [f.parents] : [])),
  );
  ring.forEach((id, i) => {
    const s = plan.byId.get(id)!;
    const p = polar(CENTRES.heart, HEART_R, -Math.PI / 2 + (i / ring.length) * Math.PI * 2);
    put(s, p.x, p.y);
  });
  for (const f of fused) {
    const pa = f.parents && stars.get(f.parents[0]);
    const pb = f.parents && stars.get(f.parents[1]);
    const a = pa && pb ? meanAngle(Math.atan2(pa.y, pa.x), Math.atan2(pb.y, pb.x)) : (hash(f.id) % 360) * DEG;
    const p = polar(CENTRES.heart, FUSED_R, a);
    if (free(p.x, p.y)) put(f, p.x, p.y);
    else settle(f, p.x, p.y);
  }
  labels.push({ text: 'The Heart', x: CENTRES.heart.x, y: CENTRES.heart.y, kind: 'constellation', constellation: 'heart' });

  // ---- Weapon trees.
  for (const c of ['edge', 'fang', 'lantern'] as const) {
    const centre = CENTRES[c];
    const out = DIR[c] * DEG;
    const tree = plan.stars.filter((s) => s.constellation === c && s.depth !== undefined);
    const branchAngle = (b: number) => out + (b - 1) * 120 * DEG;
    const angle = new Map<string, number>();
    for (const s of tree) {
      if (s.depth === 0) {
        put(s, centre.x, centre.y);
        continue;
      }
      const sibs = tree.filter((x) => x.parent === s.parent);
      const k = sibs.indexOf(s);
      let a: number;
      if (s.depth === 1) a = branchAngle(s.branch ?? k);
      else if (s.depth === 2) a = branchAngle(s.branch ?? 0) + (k - (sibs.length - 1) / 2) * 2 * T2_SPREAD * DEG;
      else a = (angle.get(s.parent!) ?? out) + (k - (sibs.length - 1) / 2) * 10 * DEG;
      angle.set(s.id, a);
      const p = polar(centre, TREE_R[Math.min(3, s.depth ?? 1)], a);
      put(s, p.x, p.y);
    }
    const name = c === 'edge' ? 'The Edge' : c === 'fang' ? 'The Fang' : 'The Lantern';
    const lp = polar(centre, 150, out + Math.PI);
    labels.push({ text: name, x: round(lp.x), y: round(lp.y), kind: 'constellation', constellation: c });
  }

  // ---- The Crown: one arc per class tier, facing away from the Heart.
  {
    const centre = CENTRES.crown;
    const out = DIR.crown * DEG;
    const span = 240 * DEG;
    let r = 0;
    for (const g of groupsOf('crown').sort((a, b) => (a.id < b.id ? -1 : 1))) {
      const list = byGroup.get(g.id)!;
      r = Math.max(r ? r + 92 : 110, ((list.length - 1) * (MIN_GAP + 6)) / span);
      list.forEach((s, i) => {
        const t = list.length === 1 ? 0 : i / (list.length - 1) - 0.5;
        const p = polar(centre, r, out + t * Math.min(span, ((list.length - 1) * (MIN_GAP + 6)) / r));
        settle(s, p.x, p.y);
      });
    }
    labels.push({ text: 'The Crown', x: centre.x, y: centre.y, kind: 'constellation', constellation: 'crown' });
  }

  // ---- The Craft: one spoke per trainer (their techniques, then what those transform into).
  {
    const centre = CENTRES.craft;
    const out = DIR.craft * DEG;
    const gs = groupsOf('craft');
    gs.forEach((g, gi) => {
      const list = byGroup.get(g.id)!;
      const a = out + ((gi + 0.5) / gs.length) * Math.PI * 2;
      let last = { x: centre.x, y: centre.y };
      list.forEach((s, j) => {
        const p = polar(centre, 100 + 80 * j, a + j * 9 * DEG);
        last = settle(s, p.x, p.y);
      });
      if (g.name) {
        const lp = polar(last, 34, a + list.length * 9 * DEG);
        labels.push({ text: g.name, x: round(lp.x), y: round(lp.y), kind: 'group', constellation: 'craft' });
      }
    });
    labels.push({ text: 'The Craft', x: centre.x, y: centre.y, kind: 'constellation', constellation: 'craft' });
  }

  // ---- Universal skills: a small zig-zag near The Craft.
  {
    const centre = CENTRES.universal;
    const along = (DIR.universal + 90) * DEG;
    for (const g of groupsOf('universal')) {
      const list = byGroup.get(g.id)!;
      list.forEach((s, j) => {
        const t = (j - (list.length - 1) / 2) * 72;
        const p = polar(polar(centre, t, along), j % 2 ? 34 : -34, along - Math.PI / 2);
        settle(s, p.x, p.y);
      });
    }
  }

  // ---- The Wild: a cluster per region, side by side across the constellation.
  {
    const centre = CENTRES.wild;
    const out = DIR.wild * DEG;
    const tangent = out + Math.PI / 2;
    const gs = groupsOf('wild');
    gs.forEach((g, gi) => {
      const list = byGroup.get(g.id)!;
      const gc = polar(centre, (gi - (gs.length - 1) / 2) * 440, tangent);
      let far = 0;
      list.forEach((s, j) => {
        const r = j === 0 ? 0 : 64 * Math.sqrt(j + 0.4);
        const jit = ((hash(s.id) % 21) - 10) * DEG;
        const p = polar(gc, r, out + j * 137.508 * DEG + jit);
        const q = settle(s, p.x, p.y);
        far = Math.max(far, Math.hypot(q.x - gc.x, q.y - gc.y));
      });
      if (g.name) {
        const lp = polar(gc, far + 40, out);
        labels.push({ text: g.name, x: round(lp.x), y: round(lp.y), kind: 'group', constellation: 'wild' });
      }
    });
    const lp = polar(centre, -300, out);
    labels.push({ text: 'The Wild', x: round(lp.x), y: round(lp.y), kind: 'constellation', constellation: 'wild' });
  }

  // ---- Fusion results: between their ingredients (ingredients first), then nudged free.
  const pending = plan.stars.filter((s) => !stars.has(s.id));
  const weight = (id: string) => (id.startsWith('el:') ? 1 : 2);
  let guard = pending.length + 1;
  while (pending.length && guard-- > 0) {
    for (let i = 0; i < pending.length; i++) {
      const s = pending[i];
      const ing = s.ingredients ?? (s.parent ? ([s.parent, s.parent] as [string, string]) : undefined);
      const ready = !ing || ing.every((id) => stars.has(id) || !plan.byId.has(id)) || guard === 0;
      if (!ready) continue;
      const pts = (ing ?? []).filter((id) => stars.has(id)).map((id) => ({ p: stars.get(id)!, w: weight(id) }));
      const w = pts.reduce((n, q) => n + q.w, 0);
      let x = w ? pts.reduce((n, q) => n + q.p.x * q.w, 0) / w : CENTRES[s.constellation].x;
      let y = w ? pts.reduce((n, q) => n + q.p.y * q.w, 0) / w : CENTRES[s.constellation].y;
      const off = polar({ x, y }, 14 + (hash(s.id) % 17), (hash(`${s.id}#`) % 360) * DEG);
      x = off.x;
      y = off.y;
      settle(s, x, y);
      pending.splice(i, 1);
      i--;
    }
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of placed) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (!placed.length) minX = minY = maxX = maxY = 0;
  const M = 220;
  const layout: StarLayout = {
    stars,
    centres: CENTRES,
    labels,
    bounds: { minX: minX - M, minY: minY - M, maxX: maxX + M, maxY: maxY + M },
  };
  SKY.set(plan, layout);
  return layout;
}

// ====================================================================== one chart

/** The sky laid out for this chart: every static star plus this player's variant satellites. */
export function layoutStarChart(data: StarChartData): StarLayout {
  const sky = layoutSky(data.sky);
  const variants = data.stars.filter((s) => s.kind === 'variant' && s.base && sky.stars.has(s.base));
  if (!variants.length) return sky;
  const stars = new Map(sky.stars);
  const byBase = new Map<string, string[]>();
  for (const v of variants) byBase.set(v.base!, [...(byBase.get(v.base!) ?? []), v.id]);
  for (const [base, ids] of byBase) {
    const b = sky.stars.get(base)!;
    ids.sort();
    const n = Math.max(5, ids.length);
    const a0 = (hash(base) % 360) * DEG;
    ids.forEach((id, k) => {
      const ring = Math.floor(k / n);
      const p = polar(b, b.r + ORBIT + ring * 9, a0 + ((k % n) / n) * Math.PI * 2 + ring * 0.4);
      stars.set(id, { id, x: round(p.x), y: round(p.y), r: VARIANT_R });
    });
  }
  return { ...sky, stars };
}

/** Box around a set of placed stars (or a constellation's centre when none), at least `minHalf` from its centre. */
export function boxOf(points: readonly { x: number; y: number }[], fallback: { x: number; y: number }, minHalf = 200): { minX: number; minY: number; maxX: number; maxY: number } {
  if (!points.length) return { minX: fallback.x - minHalf, minY: fallback.y - minHalf, maxX: fallback.x + minHalf, maxY: fallback.y + minHalf };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const hx = Math.max(minHalf, (maxX - minX) / 2);
  const hy = Math.max(minHalf, (maxY - minY) / 2);
  return { minX: cx - hx, minY: cy - hy, maxX: cx + hx, maxY: cy + hy };
}
