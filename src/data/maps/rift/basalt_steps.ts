import type { MapDef } from '../../../core/world/types';

// Basalt Steps — three black basalt terraces climbing from Riftmarch's east gate towards the Thunderhead Ridge.
// A lava river pours off the north rim and falls over each cliff step into the Caldera, a molten lake whose basalt
// island — the Anvil — is the Magma Brute's ground, reached by a single causeway from the lower east ledge.
// The road climbs ramp by ramp: across the lower step, up to the middle step, over the lava on a rock causeway and up
// again to the high step and the ridge pass. Ember vents breathe on the red ground; ore shows in the stony patches.
const map: MapDef = {
  id: 'rift.basalt_steps',
  name: 'Basalt Steps',
  kind: 'field',
  region: 'rift',
  biome: 'basalt',
  seed: 417260,
  levelBand: [14, 17],
  safety: 'pve',
  worldCell: { x: 2, y: 1 },
  landmark: 'The Caldera — a lava lake fed by a molten fall over three basalt steps, with the Anvil island at its heart.',
  layout: [
    'TTTTTTTTT###TTTTLL####..##TTTTTT',
    'TTTTt,,....tT...LL..#.....,,.tTT',
    'TTt.,ee,...o....LL....o...e,..tT',
    'T#.......oo..............oo....T',
    'T#..,e,.....t....LL...,ee,....tT',
    'T#...............LL.........tTTT',
    'T#..o....##......LL........#..tT',
    'T####..##########LL#####..####TT',
    'T#.......,,.###..LL....,,.##...T',
    'T.....o..,ee,....LL...,ee,..o..T',
    'T#...............LL............T',
    'T#.....o.................o.....T',
    'T#................LL......o....T',
    'T#..,e,....###....LL..,e,......T',
    'T#######..########LL#######..##T',
    '#,.....o..,ee....LLLL##...,ee..T',
    '..............LLLLLLLLLL.......T',
    '.....o.......LLLL...LLLL.,e,...T',
    '##...........LLL.........o.....T',
    'T#..o.,e,....LLLL...LLLL.......T',
    'T#............LLLLLLLLL.....tTTT',
    'TT#.....o.......LLLLL....ttTTTTT',
    'TTT##tt......####T####..tTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  paths: [
    // the road: along the lower step, up the west ramp, over the lava causeway, up the east ramp to the ridge pass
    [[0, 33], [10, 33], [16, 31], [17, 28], [18, 25], [26, 23], [34, 22], [42, 22], [48, 18], [49, 14], [48, 9], [45, 4], [45, 0]],
    // spur: down the east ramp to the lower ledge and across the causeway onto the Anvil
    [[42, 22], [50, 25], [55, 28], [55, 31], [50, 36], [38, 36]],
  ],
  portals: [
    { id: 'west', tx: 0, ty: 32, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'rift.riftmarch', portal: 'east' } },
    { id: 'north', tx: 44, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'rift.thunderhead_ridge', portal: 'south' } },
  ],
  spawns: [
    { monster: 'basalt_crawler', count: 8, cx: 16, cy: 8, r: 5 },
    { monster: 'basalt_crawler', count: 5, cx: 56, cy: 8, r: 4 },
    { monster: 'basalt_crawler', count: 7, cx: 52, cy: 22, r: 5 },
    { monster: 'cinder_toad', count: 7, cx: 16, cy: 20, r: 5 },
    { monster: 'cinder_toad', count: 8, cx: 16, cy: 40, r: 5 },
    { monster: 'cinder_toad', count: 4, cx: 56, cy: 36, r: 3 },
    { monster: 'magma_brute', count: 1, cx: 36, cy: 37, r: 2 },
  ],
  nodes: [
    { id: 'ember_vent_1', kind: 'ember_vent', tx: 10, ty: 4 },
    { id: 'ember_vent_2', kind: 'ember_vent', tx: 54, ty: 4 },
    { id: 'ember_vent_3', kind: 'ember_vent', tx: 22, ty: 18 },
    { id: 'ember_vent_4', kind: 'ember_vent', tx: 46, ty: 26 },
    { id: 'ember_vent_5', kind: 'ember_vent', tx: 52, ty: 34 },
    { id: 'ore_1', kind: 'ore', tx: 19, ty: 6 },
    { id: 'ore_2', kind: 'ore', tx: 51, ty: 6 },
    { id: 'ore_3', kind: 'ore', tx: 56, ty: 18 },
    { id: 'ore_4', kind: 'ore', tx: 8, ty: 38 },
  ],
};

export default map;
