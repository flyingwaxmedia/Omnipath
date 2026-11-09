import type { MapDef } from '../../../core/world/types';

// Stormbreak Approach — a windswept plateau east of the Cinder Fields that climbs in three cliff-bound terraces. The road
// enters the low meadow from the west, where Voltcalves graze around a toppled watchtower and Sparkbugs swarm over a rain
// tarn in the north-west hollow; a ramp in the cliff leads up to the middle shelf, which doubles back west to a stony
// spur the Voltmane holds; a cleft at its head opens onto the top terrace, the paved plaza of the Prism Gate on the
// eastern edge, with the last waystone of the vale beside it.
const map: MapDef = {
  id: 'vale.stormbreak_approach',
  name: 'Stormbreak Approach',
  kind: 'field',
  region: 'vale',
  biome: 'plateau',
  seed: 58243,
  levelBand: [8, 10],
  safety: 'pve',
  worldCell: { x: 4, y: 3 },
  landmark: 'The Prism Gate: two crystal pillars on a paved terrace at the top of the climb, dark until three elements answer them.',
  layout: [
    '####################',
    '##,,o,,##,o,,##.C.##',
    '#,,,,,t#,,,,,..+++.#',
    '#,--,,,#,,h,,..+++++',
    '#,-~-,o#,hh,,#..C+++',
    '#,,-,,,#,,h,,#######',
    '#,o,,,,#,,,,,,,,o,,#',
    '#,,,,t,#,,,h,,,,,,,#',
    '##,,,,,#,,,,,,,,,,o#',
    '##,,,,,#########..##',
    '#,,....o.........o.#',
    '.,,......,,,.....C.#',
    '.,......,,,,,..o...#',
    '#..o....,,,,....,,,#',
    '##......C......,,###',
    '####################',
  ],
  paths: [
    // west road -> low meadow -> ramp -> middle shelf (doubling back west) -> cleft -> edge of the gate plaza
    [
      [0, 23],
      [8, 23],
      [16, 25],
      [26, 24],
      [32, 22],
      [33, 18],
      [30, 15],
      [22, 14],
      [18, 12],
      [18, 6],
      [22, 5],
      [28, 5],
    ],
  ],
  structures: [{ kind: 'tower', tx: 34, ty: 25 }],
  portals: [
    { id: 'west', tx: 0, ty: 22, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'vale.cinder_fields', portal: 'east' } },
    {
      id: 'gate',
      tx: 38,
      ty: 6,
      w: 2,
      h: 4,
      facing: 'e',
      kind: 'edge',
      to: { map: 'vale.stormbreak', portal: 'entrance' },
      label: 'The Prism Gate',
      gate: {
        elementsKnown: 3,
        hint: 'The Prism Gate stays dark until three primal elements answer it. Attune to three, then return.',
      },
    },
  ],
  spawns: [
    { monster: 'sparkbug', count: 6, cx: 8, cy: 15, r: 4 },
    { monster: 'voltcalf', count: 7, cx: 18, cy: 24, r: 5 },
    { monster: 'sparkbug', count: 5, cx: 30, cy: 26, r: 3 },
    { monster: 'voltcalf', count: 6, cx: 28, cy: 14, r: 3 },
    { monster: 'voltmane', count: 1, cx: 19, cy: 6, r: 3 },
  ],
  nodes: [
    { id: 'storm_tree_tarn', kind: 'storm_tree', tx: 11, ty: 6 },
    { id: 'storm_tree_hollow', kind: 'storm_tree', tx: 4, ty: 17 },
    { id: 'storm_tree_column', kind: 'storm_tree', tx: 23, ty: 4 },
    { id: 'storm_tree_ledge', kind: 'storm_tree', tx: 34, ty: 13 },
  ],
  objects: [{ id: 'waystone', kind: 'waystone', tx: 30, ty: 4 }],
};

export default map;
