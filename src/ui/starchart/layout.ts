// Star Chart layout (starchart lane; docs/CLIENT-v3.md §3). PURE and deterministic: StarChartData in, positions out
// (sky px around (0, 0)); no DOM, no randomness — unit-tested in tests/starchart*.test.ts.
//
// Skeleton: constellation centres + a simple ring per constellation. LANE starchart: the real layout (weapon trees
// r≈120/240/360 ±18°, The Heart ring, fusion midpoints with deterministic offsets, variant satellites).
import type { ConstellationId, StarChartData } from './data';

export interface PlacedStar {
  id: string;
  x: number;
  y: number;
  /** Drawn radius in sky px. */
  r: number;
}

export interface StarLayout {
  stars: Map<string, PlacedStar>;
  /** Constellation centres (chips centre the view on these). */
  centres: Record<ConstellationId, { x: number; y: number }>;
}

export const CENTRES: Record<ConstellationId, { x: number; y: number }> = {
  heart: { x: 0, y: 0 },
  edge: { x: -900, y: -500 },
  fang: { x: 900, y: -500 },
  lantern: { x: 0, y: 1000 },
  craft: { x: -1100, y: 600 },
  universal: { x: -1300, y: 1100 },
  wild: { x: 1100, y: 600 },
  crown: { x: 0, y: -1100 },
  fusion: { x: 0, y: 400 },
};

export function layoutStarChart(data: StarChartData): StarLayout {
  const groups = new Map<ConstellationId, string[]>();
  for (const s of data.stars) {
    const g = groups.get(s.constellation) ?? [];
    g.push(s.id);
    groups.set(s.constellation, g);
  }
  const stars = new Map<string, PlacedStar>();
  for (const [c, ids] of groups) {
    const o = CENTRES[c];
    ids.forEach((id, i) => {
      const a = (i / Math.max(1, ids.length)) * Math.PI * 2;
      const r = i === 0 ? 0 : 120 + 40 * Math.floor(i / 12);
      stars.set(id, { id, x: Math.round(o.x + Math.cos(a) * r), y: Math.round(o.y + Math.sin(a) * r), r: 6 });
    });
  }
  return { stars, centres: CENTRES };
}
