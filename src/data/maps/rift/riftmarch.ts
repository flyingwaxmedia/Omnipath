import type { MapDef } from '../../../core/world/types';

// Riftmarch — the second hub, a frontier town on the lip of the Rift. A crack of starry void runs in from the
// north-east rim and cuts diagonally across the town to the south-west, splitting its plaza in two: the Archive
// Court (NW), where Ione keeps the long hall of records, and the Waystone Court (SE), where Dask tends the Rift
// Waystone. Two plank footbridges cross the crack — the north road from the Frost Shelf, and the Archive lane down
// to the Waystone Court — and the Rift Altar stands on the stony lip where that lane lands. A watchtower guards the
// NE rim; cottages, a well and the frontier camp fill the south and west, with dusk grass creeping in along the
// road to the orchard. Four gates: west to the Riftgate Road, north to the Frost Shelf, east to the Basalt Steps,
// south to the Dusk Orchard. The Waystone Court's centrepiece is the statue of the Pathfinder, at the head of the
// orchard road, between the frontier market's two striped tents; the Archive Court has its old well.
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
  landmark: 'The Rift Altar stands on the lip of a crack of starry void that splits the plaza of Riftmarch in two.',
  layout: [
    'TTTT#########..#  #T',
    'Tt,hhhhh,hhhh.o  oCC',
    'Tt....hhhhhh.o  ohhC',
    'T,..........ob ohhtC',
    'T.....++++.o bo.hhtC',
    'T....+++++.o o.hhhhC',
    '....+++++.o  o.h,hhT',
    '...+++++.obbo..hhhhT',
    'T.......o  o++++.,.T',
    'T,.....o  o+++++....',
    'T..,..o  o+++++.....',
    'Tt....o o+++++.....T',
    'Tt...,......llll..,T',
    'Tt,....llllllllllltT',
    'T.ttllllllllllll.ttT',
    'TTTTTTTTTTT..TTTTTTT',
  ],
  paths: [
    // west road from the Riftgate Road into the Archive Court
    [[0, 14], [7, 14]],
    // the Archive lane: over the west footbridge, down to the Waystone Court
    [[15, 14], [25, 14], [26, 16]],
    // north road from the Frost Shelf, over the north footbridge
    [[26, 0], [26, 15]],
    // east road to the Basalt Steps
    [[31, 19], [39, 19]],
    // south road to the Dusk Orchard
    [[23, 23], [23, 27], [23, 31]],
    // spurs: Archive steps, the watchtower, the south-west cottages, the south-east cottages
    [[7, 7], [10, 10]],
    [[28, 11], [32, 10]],
    [[19, 23], [13, 24], [8, 24]],
    [[36, 20], [36, 26]],
  ],
  structures: [
    { kind: 'hall', tx: 4, ty: 3 },
    { kind: 'house', tx: 14, ty: 2 },
    { kind: 'tower', tx: 32, ty: 6 },
    { kind: 'house', tx: 34, ty: 12 },
    { kind: 'tent', tx: 3, ty: 18 },
    { kind: 'house', tx: 4, ty: 22 },
    { kind: 'house', tx: 9, ty: 26 },
    { kind: 'house', tx: 28, ty: 25 },
    { kind: 'house', tx: 33, ty: 23 },
    { kind: 'well', tx: 16, ty: 27 },
    // the Archive Court's well, and the frontier market's tents on the Waystone Court's south and east edges
    { kind: 'well', tx: 12, ty: 12 },
    { kind: 'tent', tx: 19, ty: 21 },
    { kind: 'tent', tx: 29, ty: 21 },
  ],
  portals: [
    { id: 'west', tx: 0, ty: 12, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'rift.riftgate_road', portal: 'town' } },
    { id: 'north', tx: 26, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'rift.frost_shelf', portal: 'south' } },
    { id: 'east', tx: 38, ty: 18, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'rift.basalt_steps', portal: 'west' } },
    { id: 'south', tx: 22, ty: 30, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'rift.dusk_orchard', portal: 'north' } },
  ],
  spawns: [],
  npcs: [
    { npc: 'ione', tx: 13, ty: 10 },
    { npc: 'dask', tx: 28, ty: 18 },
  ],
  objects: [
    { id: 'waystone', kind: 'waystone', tx: 26, ty: 19 },
    { id: 'pathfinder', kind: 'statue', tx: 23, ty: 20, text: 'The Pathfinder, who first crossed the Rift. Her staff still points home.' },
    { id: 'altar', kind: 'altar', tx: 22, ty: 17 },
    {
      id: 'signpost',
      kind: 'signpost',
      tx: 21,
      ty: 25,
      text: 'Riftmarch — West: Riftgate Road · North: Frost Shelf · East: Basalt Steps · South: Dusk Orchard',
    },
  ],
};

export default map;
