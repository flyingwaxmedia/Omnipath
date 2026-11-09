import type { MapDef } from '../../../core/world/types';

// Riftmarch — the second hub, a frontier town built on the lip of the Rift. A jagged crack of starry nothing runs in
// from the north-east and ends at the cobbled plaza, where the Rift Altar stands on its very edge. Ione's Archive (the
// long hall, NW) faces the plaza; Dask keeps the Rift Waystone at its centre. A plank footbridge crosses the crack to
// the old watchtower; cottages, a well and a reed pond fill the south. Four roads: west to the Riftgate Road, north to
// the Frost Shelf, east to the Basalt Steps, south to the Dusk Orchard.
const map: MapDef = {
  id: 'rift.riftmarch',
  name: 'Riftmarch',
  kind: 'town',
  region: 'rift',
  biome: 'town',
  seed: 228841,
  levelBand: null,
  safety: 'safe',
  worldCell: { x: 1, y: 1 },
  landmark: 'The Rift Altar stands at the tip of a crack of starry void that splits the plaza of Riftmarch.',
  layout: [
    'TTTTTTTTT..TTTTTT TT',
    'TTTt,,...,.,..t#  #T',
    'Tt,...........#  #tT',
    'T,...........#  #..T',
    'T.............bb...T',
    'Tt......++++.# #...T',
    'T,.....++++++ ....,T',
    '......++++++++......',
    '......++++++++......',
    'T,.....++++++.....,T',
    'Tt......++++......tT',
    'T,................,T',
    'Tt.............--.tT',
    'T,,...........-~~-tT',
    'TTt,.....,..,..--..T',
    'TTTTTTTTT..TTTTTTTTT',
  ],
  paths: [
    // west road from the Riftgate Road
    [[0, 15], [8, 15], [13, 15]],
    // east road to the Basalt Steps
    [[26, 15], [33, 15], [39, 15]],
    // north road to the Frost Shelf
    [[19, 0], [19, 10]],
    // south road to the Dusk Orchard
    [[19, 21], [18, 26], [19, 31]],
    // spurs: Archive steps, the footbridge lane to the watchtower, cottage lanes
    [[14, 13], [10, 10], [7, 9]],
    [[21, 8], [33, 8]],
    [[17, 23], [12, 23], [8, 24]],
    [[20, 22], [26, 23], [30, 22], [34, 22]],
  ],
  structures: [
    { kind: 'hall', tx: 3, ty: 3 },
    { kind: 'house', tx: 12, ty: 3 },
    { kind: 'tower', tx: 34, ty: 6 },
    { kind: 'tent', tx: 3, ty: 10 },
    { kind: 'house', tx: 4, ty: 21 },
    { kind: 'house', tx: 9, ty: 25 },
    { kind: 'house', tx: 23, ty: 3 },
    { kind: 'house', tx: 27, ty: 19 },
    { kind: 'house', tx: 33, ty: 18 },
    { kind: 'well', tx: 13, ty: 20 },
  ],
  portals: [
    { id: 'west', tx: 0, ty: 14, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'rift.riftgate_road', portal: 'town' } },
    { id: 'north', tx: 18, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'rift.frost_shelf', portal: 'south' } },
    { id: 'east', tx: 38, ty: 14, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'rift.basalt_steps', portal: 'west' } },
    { id: 'south', tx: 18, ty: 30, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'rift.dusk_orchard', portal: 'north' } },
  ],
  spawns: [],
  npcs: [
    { npc: 'ione', tx: 6, ty: 8 },
    { npc: 'dask', tx: 21, ty: 14 },
  ],
  objects: [
    { id: 'waystone', kind: 'waystone', tx: 19, ty: 14 },
    { id: 'altar', kind: 'altar', tx: 25, ty: 12 },
    {
      id: 'signpost',
      kind: 'signpost',
      tx: 15,
      ty: 18,
      text: 'Riftmarch — West: Riftgate Road · North: Frost Shelf · East: Basalt Steps · South: Dusk Orchard',
    },
  ],
};

export default map;
