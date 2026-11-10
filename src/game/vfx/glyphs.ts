// 5x5 element and status glyphs (docs/VFX.md §3.3) for 'strong' sparks and status pips, plus seeded rune glyphs.
// Original bitmasks drawn for Omnipath ('#' = on). Each glyph keeps a distinct silhouette so elements and statuses
// stay readable in grayscale.
import type { ElementId, StatusKind } from '../../core/types';
import { mulberry32 } from '../../core/rng';

export type Glyph = readonly string[];

export const ELEMENT_GLYPHS: Readonly<Record<ElementId, Glyph>> = {
  fire: ['..#..', '.##..', '.###.', '##.##', '.###.'],
  water: ['..#..', '.#.#.', '#...#', '#...#', '.###.'],
  earth: ['.....', '..#..', '.###.', '##.##', '#####'],
  wind: ['###..', '...#.', '####.', '....#', '..##.'],
  lightning: ['..###', '.##..', '####.', '..##.', '.##..'],
  shadow: ['.###.', '##...', '#....', '##...', '.###.'],
  holy: ['..#..', '#####', '..#..', '..#..', '.###.'],
  ice: ['#.#.#', '.###.', '##.##', '.###.', '#.#.#'],
  magma: ['.###.', '#####', '#.#.#', '..#..', '..#..'],
  storm: ['.##..', '#####', '...#.', '..#..', '.#...'],
  twilight: ['.##.#', '#...#', '#....', '#...#', '.##..'],
};

export const STATUS_GLYPHS: Readonly<Record<StatusKind, Glyph>> = {
  burn: ['..#..', '.##..', '.###.', '#####', '.###.'],
  slow: ['#...#', '.#.#.', '..#..', '#...#', '.#.#.'],
  soak: ['..#..', '.###.', '#####', '#####', '.###.'],
  stun: ['#.#.#', '.....', '#.#.#', '.....', '#.#.#'],
  knockback: ['..#..', '...#.', '#####', '...#.', '..#..'],
  shock: ['...#.', '..#..', '.###.', '..#..', '.#...'],
  bleed: ['..#..', '..#..', '.###.', '.###.', '..#..'],
  smite: ['..#..', '..#..', '#####', '.###.', '#.#.#'],
  freeze: ['#####', '#.#.#', '#####', '#.#.#', '#####'],
  poison: ['.###.', '#.#.#', '#####', '.#.#.', '.#.#.'],
  pull: ['#...#', '.#.#.', '..#..', '.#.#.', '#...#'],
  root: ['..#..', '..#..', '.###.', '#.#.#', '#.#.#'],
  launch: ['..#..', '.###.', '#.#.#', '..#..', '..#..'],
  expose: ['#####', '#...#', '#.#.#', '#...#', '#####'],
  lure: ['.###.', '#...#', '#.#.#', '#...#', '.###.'],
};

/** A 3-wide rune of `h` rows (3 or 5) from a seed: a fixed stem plus seeded strokes, never empty. */
export function rune(seed: number, h: 3 | 5 = 5): Glyph {
  const rnd = mulberry32(seed);
  const rows: string[] = [];
  for (let y = 0; y < h; y++) {
    let row = '';
    for (let x = 0; x < 3; x++) {
      const stem = x === 1 && (y === 0 || y === h - 1 || rnd() < 0.6);
      row += stem || rnd() < 0.42 ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}
