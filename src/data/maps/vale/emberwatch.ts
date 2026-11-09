import type { MapDef } from '../../../core/world/types';

// Emberwatch — the Vale's last outpost before the plateau. A stockade of dead trunks backed by a basalt bluff; the gate
// opens north onto the Cinder Fields between two watchtowers. Tents ring a cobbled yard with the campfire at its heart,
// the waystone and altar either side, Mirelle keeping the stone and Quartermaster Vey drilling recruits on the south
// yard.
const map: MapDef = {
  id: 'vale.emberwatch',
  name: 'Emberwatch',
  kind: 'outpost',
  region: 'vale',
  biome: 'ember',
  seed: 66859,
  levelBand: null,
  safety: 'safe',
  worldCell: { x: 3, y: 4 },
  landmark: 'Emberwatch: a dead-wood stockade round a campfire, its twin watchtowers keeping the gate to the Cinder Fields.',
  decor: 0.5,
  layout: [
    'TTTTT..TTTTT',
    'T,........,T',
    'T..........T',
    'T..++++++..T',
    'T.++++++++.T',
    'T.++++++++.T',
    'T..++++++..T',
    'T..........T',
    '##...,,...##',
    '############',
  ],
  paths: [
    [
      [11, 0],
      [11, 5],
    ],
  ],
  structures: [
    { kind: 'tower', tx: 7, ty: 2 },
    { kind: 'tower', tx: 15, ty: 2 },
    { kind: 'tent', tx: 3, ty: 6 },
    { kind: 'tent', tx: 18, ty: 6 },
    { kind: 'tent', tx: 3, ty: 14 },
    { kind: 'tent', tx: 18, ty: 14 },
  ],
  portals: [
    { id: 'gate', tx: 10, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'vale.cinder_fields', portal: 'outpost' }, label: 'To the Cinder Fields' },
  ],
  spawns: [],
  npcs: [
    { npc: 'mirelle_2', tx: 6, ty: 11 },
    { npc: 'vey', tx: 12, ty: 15 },
  ],
  objects: [
    { id: 'waystone_camp', kind: 'waystone', tx: 8, ty: 8 },
    { id: 'altar_camp', kind: 'altar', tx: 15, ty: 8 },
    { id: 'campfire_camp', kind: 'campfire', tx: 12, ty: 11 },
  ],
};

export default map;
