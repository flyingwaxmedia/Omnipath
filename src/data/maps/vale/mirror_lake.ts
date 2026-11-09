import type { MapDef } from '../../../core/world/types';

// Mirror Lake — a wide still lake filling the north of the map, with Pell's plank pier reaching into it, a creek
// spilling east under the shore road, reed beds for puddlewisps and, in the far north-west, a sandy cove where the
// light on the water never quite sits still (the hidden way to the islet).
const map: MapDef = {
  id: 'vale.mirror_lake',
  name: 'Mirror Lake',
  kind: 'field',
  region: 'vale',
  biome: 'lake',
  seed: 63349,
  levelBand: [2, 4],
  safety: 'pve',
  worldCell: { x: 2, y: 1 },
  landmark: "Pell's pier — weathered planks running out over the glassy lake, the best fishing in the vale.",
  layout: [
    'TTT::~~~~~~~~~~~~~~~~~~~-tTTTTTT',
    'TTt::-~~~~~~~~~~~~~~~~~~-ttTTTTT',
    'TTt,:-~~~~~~~~~~~~~~~~~~--,tTTTT',
    'TTt,.--~~~~~~~~~~~~~~~~~~-,..tTT',
    'Tt.,..-~~~~~~~~~~~~~~~~~~-,.....',
    'Tt....--~~~~~~~~~~~~~~~~--......',
    'T,.....-~~~~~~~~~~~~~~~~-,...tTT',
    'Tt.....--~~~~~~~~~~~~~~--....tTT',
    'Tt.,....--~~~~bbbb~~~~-,.....tTT',
    'T,,......--~~~bb~~~~~-,.......tT',
    'Tt,........---bb----------....tT',
    'TT,,..........bb......,,----...T',
    'TTt,.......,,..........,...-----',
    'TTt,,.....,,,,.........tt.....tT',
    'Tt,,.......,...........ttt....tT',
    'Tt,......tt..............t....TT',
    'T,......tTTt.................,TT',
    'Tt.....tTTTt...,,.........,,,.tT',
    'TT,.....tTt....,,,,.......,,..TT',
    'TTt.............,,,...........TT',
    'TTTt.....tt.........,,.....ttTTT',
    'TTTT..TTTTTTTTT..TTTTTTTTTTTTTTT',
  ],
  paths: [
    // shore road: Hearthvale gate -> creek bridge -> east shore -> Windcrest
    [[32, 43], [31, 36], [34, 30], [40, 26], [48, 24], [52, 20], [54, 14], [60, 10], [63, 10]],
    // Greenmeadow trail joining the shore road
    [[10, 43], [11, 36], [16, 31], [24, 29], [33, 30]],
    // pier spur
    [[31, 30], [30, 25], [30, 22]],
    // west shore footpath to the reed beds
    [[16, 31], [10, 23], [8, 15]],
  ],
  portals: [
    { id: 'south', tx: 30, ty: 42, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.hearthvale', portal: 'north' } },
    { id: 'southwest', tx: 8, ty: 42, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.greenmeadow', portal: 'north' } },
    { id: 'northeast', tx: 62, ty: 8, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'vale.windcrest_hill', portal: 'southwest' } },
    {
      id: 'islet',
      tx: 6,
      ty: 0,
      w: 2,
      h: 2,
      facing: 'n',
      kind: 'hidden',
      to: { map: 'vale.lake_islet', portal: 'shore' },
      label: 'To the Islet',
      reveal: {
        shape: 'dash',
        look: 'shimmer',
        hint: 'Light skips across the water beyond the cove, as if something quick could follow it.',
      },
    },
  ],
  spawns: [
    { monster: 'puddlewisp', count: 9, cx: 10, cy: 18, r: 5 },
    { monster: 'puddlewisp', count: 8, cx: 53, cy: 16, r: 4 },
    { monster: 'jellop', count: 7, cx: 24, cy: 38, r: 5 },
    { monster: 'jellop', count: 6, cx: 46, cy: 33, r: 5 },
    { monster: 'brinewisp', count: 1, cx: 57, cy: 29, r: 3 },
  ],
  nodes: [
    { id: 'fish_pier_w', kind: 'fishing', tx: 28, ty: 16 },
    { id: 'fish_pier_e', kind: 'fishing', tx: 35, ty: 16 },
    { id: 'fish_reeds', kind: 'fishing', tx: 11, ty: 10 },
    { id: 'fish_east', kind: 'fishing', tx: 50, ty: 12 },
    { id: 'herb_1', kind: 'herb', tx: 6, ty: 30 },
    { id: 'herb_2', kind: 'herb', tx: 14, ty: 33 },
    { id: 'herb_3', kind: 'herb', tx: 54, ty: 7 },
  ],
  npcs: [{ npc: 'pell', tx: 33, ty: 24 }],
};

export default map;
