import type { MapDef } from '../../../core/world/types';

// Riftgate Road — where the rift from Stormbreak spills travellers into the Riftmarch.
// Arrivals land inside the Sundered Ring, a broken circle of storm-black stones around a sliver of the Rift itself.
// The road crosses the Skyfall Brook on a plank bridge, climbs past Korrin's camp under the Stormcrest highland
// (riftlings, lightning-struck storm trees) and drops south-east to the gates of Riftmarch. South-west of the ring the
// ground is torn open — the Rift Scar, where rift stalkers hunt among cracked stone.
const map: MapDef = {
  id: 'rift.riftgate_road',
  name: 'Riftgate Road',
  kind: 'field',
  region: 'rift',
  biome: 'storm',
  seed: 610377,
  levelBand: [11, 13],
  safety: 'pve',
  worldCell: { x: 0, y: 1 },
  landmark: 'The Sundered Ring — nine storm-black standing stones around a sliver of the Rift, where the road from Stormbreak begins.',
  layout: [
    'TTTTTTTTTTTTTTT#--#TTTTTTTTTTTTT',
    'TTTTTTTTTTTTTT#-~-#TTTTTTTTTTTTT',
    'TTTTTTTttTTTTT#-~-,tTTTtttTTTTTT',
    'TTTTt,,,.ttTT#-~-,,,,,,,,,ttTTTT',
    'TTTt,.....,,t.-~-,,,o,,,,,,,,tTT',
    'TT#,.........-~-,,,ooo,,,t,,,,tT',
    'T##..........-~-,,,,o,,,,,,,,,tT',
    'T#..C,,,,C...-~-,,,,,,,,t,,,,,tT',
    'T#.C,,,,,,C...-~-,,,.........tTT',
    '#..,,,  ,,,...-~-............tTT',
    '..,,,,,,,,,...-~-.............TT',
    '..,,,,,,,,,...-~-..............T',
    '#.,,,,,,,,,...-~-..............T',
    'T#.C,,,,,,C....-~-....oo.......T',
    'T#o.C,,,,C.....-~-...oCo.......#',
    'T#oo...C.......-~-....o.........',
    'T#ooo.o......--~~--.............',
    'T#o. o......-~~~~~~-........tTT#',
    'T#.o  .o...--~~~~~~~-.......tTTT',
    'T#.... o....-~~~~~~--........tTT',
    'TT#o... ......------........tTTT',
    'TT###o.....,,,......,,....ttTTTT',
    'TTTT##ooo.tttTTtt....tttTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  paths: [
    // the road: out of the ring, over the Skyfall Brook, up past Korrin's camp and down to Riftmarch
    [[0, 21], [10, 21], [18, 22], [28, 22], [36, 20], [42, 19], [48, 21], [54, 26], [58, 31], [63, 31]],
  ],
  structures: [{ kind: 'tent', tx: 42, ty: 15 }],
  portals: [
    {
      id: 'vale',
      tx: 0,
      ty: 20,
      w: 2,
      h: 4,
      facing: 'w',
      kind: 'edge',
      label: 'To Stormbreak',
      to: { map: 'vale.stormbreak', portal: 'rift' },
    },
    { id: 'town', tx: 62, ty: 30, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'rift.riftmarch', portal: 'west' } },
  ],
  spawns: [
    { monster: 'riftling', count: 9, cx: 50, cy: 8, r: 5 },
    { monster: 'riftling', count: 6, cx: 49, cy: 28, r: 4 },
    { monster: 'riftling', count: 8, cx: 48, cy: 38, r: 5 },
    { monster: 'rift_stalker', count: 6, cx: 14, cy: 9, r: 4 },
    { monster: 'rift_stalker', count: 7, cx: 16, cy: 36, r: 4 },
  ],
  nodes: [
    { id: 'storm_tree_1', kind: 'storm_tree', tx: 40, ty: 8 },
    { id: 'storm_tree_2', kind: 'storm_tree', tx: 56, ty: 12 },
    { id: 'storm_tree_3', kind: 'storm_tree', tx: 36, ty: 13 },
    { id: 'herb_1', kind: 'herb', tx: 38, ty: 30 },
    { id: 'herb_2', kind: 'herb', tx: 23, ty: 40 },
    { id: 'herb_3', kind: 'herb', tx: 44, ty: 42 },
  ],
  npcs: [{ npc: 'korrin', tx: 40, ty: 17 }],
  objects: [{ id: 'waystone', kind: 'waystone', tx: 46, ty: 18 }],
};

export default map;
