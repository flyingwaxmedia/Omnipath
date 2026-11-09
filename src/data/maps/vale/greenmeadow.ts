import type { MapDef } from '../../../core/world/types';

// Greenmeadow — the gentle first field west of town. Wide open grass for learning to fight, a lily pond,
// flower banks full of pipsprouts and, to the west, the Old Ring of standing stones where the Jellop Monarch holds court.
const map: MapDef = {
  id: 'vale.greenmeadow',
  name: 'Greenmeadow',
  kind: 'field',
  region: 'vale',
  biome: 'meadow',
  seed: 51807,
  levelBand: [1, 3],
  safety: 'pve',
  worldCell: { x: 1, y: 2 },
  landmark: 'The Old Ring — eight mossy standing stones in the west meadow where the Jellop Monarch wobbles in state.',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTT..TTTTT',
    'TTTTTt,,tTTTTTTTTTtt,..,tTTT',
    'TTTt,,...ttTTTTTt,.......tTT',
    'TTt,.....,.,ttt,.........,tT',
    'Tt.......C.......,,........T',
    'Tt.....C...C....,,,,.......T',
    'T,..........,,...,,......ttT',
    'T.....C.....C......t....tTTT',
    'Tt..........,.....ttt....tTT',
    'T,.....C...C.......t.......T',
    'Tt.......C..................',
    'TT,.........................',
    'TTt,,..........,,.......tTTT',
    'TTt,,,....----..........tTTT',
    'Tt,,.....-~~~~-.........,tTT',
    'Tt,,,....-~~~~-......,,,..TT',
    'TTt,......----......,,,,,..T',
    'TTTt.......................T',
    'TTTTt,,....ooo.....tt.....TT',
    'TTTTTt,..ooCCoo...tTTt...tTT',
    'TTTTTTTtt,......ttTTTTTttTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  paths: [
    // town road from the east gate, bending past Hale's drill yard into the Old Ring
    [[55, 21], [47, 21], [40, 19], [32, 18], [24, 16]],
    // north trail up to Mirror Lake
    [[42, 19], [44, 12], [41, 6], [43, 0]],
    // footpath down to the pond
    [[34, 19], [31, 24]],
  ],
  portals: [
    { id: 'east', tx: 54, ty: 20, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'vale.hearthvale', portal: 'west' } },
    { id: 'north', tx: 42, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'vale.mirror_lake', portal: 'southwest' } },
  ],
  spawns: [
    { monster: 'jellop', count: 10, cx: 34, cy: 11, r: 5 },
    { monster: 'jellop', count: 8, cx: 42, cy: 31, r: 5 },
    { monster: 'pipsprout', count: 7, cx: 8, cy: 30, r: 4 },
    { monster: 'pipsprout', count: 6, cx: 30, cy: 34, r: 4 },
    { monster: 'jellop_monarch', count: 1, cx: 19, cy: 15, r: 3 },
  ],
  nodes: [
    { id: 'herb_1', kind: 'herb', tx: 7, ty: 24 },
    { id: 'herb_2', kind: 'herb', tx: 37, ty: 26 },
    { id: 'herb_3', kind: 'herb', tx: 11, ty: 6 },
    { id: 'herb_4', kind: 'herb', tx: 27, ty: 9 },
    { id: 'herb_5', kind: 'herb', tx: 49, ty: 30 },
    { id: 'herb_6', kind: 'herb', tx: 20, ty: 35 },
  ],
  npcs: [
    { npc: 'hale', tx: 47, ty: 18 },
    { npc: 'child_lio', tx: 16, ty: 29 },
  ],
  objects: [
    {
      id: 'signpost',
      kind: 'signpost',
      tx: 40,
      ty: 22,
      text: 'Greenmeadow — East: Hearthvale · North: Mirror Lake. Jellops bounce back; mind the big one by the Old Ring.',
    },
  ],
};

export default map;
