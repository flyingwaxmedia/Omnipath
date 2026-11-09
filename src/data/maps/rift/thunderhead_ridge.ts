import type { MapDef } from '../../../core/world/types';

// Thunderhead Ridge — the storm-lashed high country above the Frost Shelf and the Basalt Steps. A wind-combed crest
// runs along the north (wind chimes hang from its cairns) above a cold tarn in the saddle; on the south slopes two
// ravines split the storm grass into long terraces. In the north-east, ringed by sheer cliffs, rises the Eyrie: a
// summit circle of storm-split boulders where the Tempest Drake perches, reached only by the switchback from the east.
const map: MapDef = {
  id: 'rift.thunderhead_ridge',
  name: 'Thunderhead Ridge',
  kind: 'field',
  region: 'rift',
  biome: 'storm',
  seed: 755092,
  levelBand: [16, 19],
  safety: 'pve',
  worldCell: { x: 2, y: 0 },
  landmark: 'The Eyrie — a cliff-ringed summit circle of storm-split boulders where the Tempest Drake waits for lightning.',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTT########TTT',
    'TTTt,,,,..,,,..,,tTT##..C...##TT',
    'TT,,..,,,,.,,,,..tTT#,C....C.#TT',
    'TT,.........,,....T#..,,,,,,..#T',
    'T##..########..#####.C......C.#T',
    'T,....,,##....,,##.#,........,#T',
    '##o....o...........#.........##T',
    '..........,,........#.C....C.#TT',
    '...........,........##..C....#TT',
    '##..o.......----.....######..#tT',
    'T,.........-~~~~-..,...,,.....tT',
    'Tt........-~~~~~-.....o.....,tTT',
    'T.........-~~~~-.....oo....,,tTT',
    'T#.........----.......o....,,,tT',
    'T##......,,..........,,......,tT',
    'T#......#.....,,,....,,,.......T',
    'T,......##.........##.....o....T',
    'T,..o....#.........#...,,,.....T',
    'T.........#..,,....##.........tT',
    'T#.,,.....#.........#......o..tT',
    'T#.......##..........#.......tTT',
    'TT#..........,,.....##....,..tTT',
    'TTT#tt....tt.......tt.....ttTTTT',
    'TTTTTTTTTTTTTTTTTTTTTT..TTTTTTTT',
  ],
  paths: [
    // the pass road: in from the Frost Shelf, round the tarn and down the east terrace to the Basalt Steps
    [[0, 15], [8, 17], [14, 22], [18, 28], [30, 29], [40, 30], [46, 32], [45, 40], [45, 47]],
    // switchback up the east slope to the Eyrie gate
    [[40, 30], [48, 26], [52, 22], [55, 19], [55, 14]],
    // goat track up to the crest ramp
    [[8, 17], [7, 12], [7, 7]],
  ],
  portals: [
    { id: 'west', tx: 0, ty: 14, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'rift.frost_shelf', portal: 'east' } },
    { id: 'south', tx: 44, ty: 46, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'rift.basalt_steps', portal: 'north' } },
  ],
  spawns: [
    { monster: 'tempest_drake', count: 1, cx: 49, cy: 9, r: 2 },
    { monster: 'cloudray', count: 6, cx: 22, cy: 4, r: 4 },
    { monster: 'cloudray', count: 8, cx: 26, cy: 12, r: 5 },
    { monster: 'cloudray', count: 6, cx: 28, cy: 38, r: 4 },
    { monster: 'thunderwing', count: 7, cx: 50, cy: 24, r: 5 },
    { monster: 'thunderwing', count: 7, cx: 10, cy: 38, r: 5 },
  ],
  nodes: [
    { id: 'storm_tree_1', kind: 'storm_tree', tx: 8, ty: 24 },
    { id: 'storm_tree_2', kind: 'storm_tree', tx: 34, ty: 36 },
    { id: 'storm_tree_3', kind: 'storm_tree', tx: 56, ty: 28 },
    { id: 'storm_tree_4', kind: 'storm_tree', tx: 16, ty: 42 },
    { id: 'storm_tree_5', kind: 'storm_tree', tx: 36, ty: 10 },
    { id: 'wind_chime_1', kind: 'wind_chime', tx: 12, ty: 2 },
    { id: 'wind_chime_2', kind: 'wind_chime', tx: 30, ty: 4 },
    { id: 'wind_chime_3', kind: 'wind_chime', tx: 57, ty: 11 },
  ],
};

export default map;
