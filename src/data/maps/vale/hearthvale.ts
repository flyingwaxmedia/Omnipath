import type { MapDef } from '../../../core/world/types';

// Hearthvale — the vale hub. A wooded ring with four roads meeting at a round cobbled plaza:
// Tamsin's hall (NW), Alba's chapel (NE), Brann's smithy (W), cottages (SW) and the duck pond (SE).
const map: MapDef = {
  id: 'vale.hearthvale',
  name: 'Hearthvale',
  kind: 'town',
  region: 'vale',
  biome: 'town',
  seed: 74121,
  levelBand: null,
  safety: 'safe',
  worldCell: { x: 2, y: 2 },
  landmark: 'The Hearth Waystone hums at the centre of a round cobbled plaza where all four vale roads meet.',
  layout: [
    'TTTTTTTTT..TTTTTTTTT',
    'TTTtt,.......,.ttTTT',
    'TTt,..........,..tTT',
    'Tt................tT',
    'T,................,T',
    'Tt......++++......tT',
    'T,.....++++++.....,T',
    '.......++++++.......',
    '.......++++++.......',
    'Tt.....++++++.....tT',
    'T,......++++....,.tT',
    'Tt.............--.tT',
    'Tt.,..........-~~-tT',
    'TT,.,.........,--tTT',
    'TTTt,.,.......,.ttTT',
    'TTTTTTTTT..TTTTTTTTT',
  ],
  paths: [
    // north road to Mirror Lake
    [[19, 0], [19, 10]],
    // south road to Gloomwood
    [[19, 21], [18, 25], [19, 31]],
    // west road to Greenmeadow
    [[0, 15], [6, 15], [10, 14], [14, 15]],
    // east road to Greystone Quarry
    [[26, 15], [31, 16], [39, 15]],
    // spurs: smithy, hall, chapel, cottages
    [[10, 15], [10, 20]],
    [[14, 12], [10, 11]],
    [[21, 9], [25, 10], [29, 11]],
    [[18, 24], [13, 27]],
  ],
  structures: [
    { kind: 'hall', tx: 6, ty: 4 },
    { kind: 'house', tx: 13, ty: 3 },
    { kind: 'chapel', tx: 28, ty: 4 },
    { kind: 'house', tx: 33, ty: 10 },
    { kind: 'smithy', tx: 4, ty: 19 },
    { kind: 'house', tx: 9, ty: 24 },
    { kind: 'house', tx: 4, ty: 25 },
    { kind: 'house', tx: 24, ty: 21 },
    { kind: 'well', tx: 6, ty: 23 },
  ],
  portals: [
    { id: 'west', tx: 0, ty: 14, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'vale.greenmeadow', portal: 'east' } },
    { id: 'north', tx: 18, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'vale.mirror_lake', portal: 'south' } },
    { id: 'east', tx: 38, ty: 14, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'vale.greystone_quarry', portal: 'west' } },
    { id: 'south', tx: 18, ty: 30, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.gloomwood', portal: 'north' } },
  ],
  spawns: [],
  npcs: [
    { npc: 'brann', tx: 8, ty: 21 },
    { npc: 'tamsin', tx: 8, ty: 9 },
    { npc: 'alba', tx: 29, ty: 9 },
    { npc: 'mirelle', tx: 21, ty: 15 },
  ],
  objects: [
    { id: 'waystone', kind: 'waystone', tx: 19, ty: 15 },
    { id: 'altar', kind: 'altar', tx: 23, ty: 12 },
    {
      id: 'signpost',
      kind: 'signpost',
      tx: 16,
      ty: 18,
      text: 'Hearthvale — West: Greenmeadow · North: Mirror Lake · East: Greystone Quarry · South: Gloomwood',
    },
  ],
};

export default map;
