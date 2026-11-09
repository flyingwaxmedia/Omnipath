import type { MapDef } from '../../../core/world/types';

// Frost Shelf — a high snowfield north of Riftmarch, walled by a glacier. Its heart is the Glass Lake: a sheet of
// walkable ice around the Eye, a pool of black water that never freezes, with two ice-fishing holes cut nearby.
// Frost crystals grow in the bays of the glacier wall; the Glacier Matron dens in an ice hollow carved into the NW
// glacier, reached through a narrow mouth. Tundra grass still shows through the snow along the town road.
const map: MapDef = {
  id: 'rift.frost_shelf',
  name: 'Frost Shelf',
  kind: 'field',
  region: 'rift',
  biome: 'frost',
  seed: 903114,
  levelBand: [12, 15],
  safety: 'pve',
  worldCell: { x: 1, y: 0 },
  landmark: 'The Glass Lake — a frozen sheet around the Eye, a pool of black water that never freezes.',
  layout: [
    '##########TTTT###########TTTTTTT',
    '##iii#####TTT#*..*##*.*##TTTTTTT',
    '#ii,ii##Tt.......*.....**.tTTTTT',
    '#i,iiii#.....oo.....*......tTTTT',
    '##iiii,#..***......o.......,tTTT',
    '###ii,ii.....*.......C*......tTT',
    'T######....,,,,,,.......*.....t#',
    'TT#....,,iiiiiiii,,,....C....*..',
    'TT....,iiiiiiiiiiiiii,..tTt.....',
    'Tt...,iii-iiiiiiiiiiii,..tt.tTT#',
    'T....,iiiiiiii--iiiiiii,...tTTTT',
    'T....,iiiiiii-~~-iiiiiii,..tTTTT',
    'T...,iiiiiiii-~~-iiiiiii,...ttTT',
    'T....,iiiiiiii--iiiiiii,......tT',
    'Tt...,,iiiiiiiiiii-iii,........T',
    'TTt...,,iiiiiiiiiiiii,....**...T',
    'TTt....,,,iiiiiiii,,,....****..T',
    'TT#.......,,,,,,,,.......***...T',
    'T##..hh.................o......T',
    'T#..hhh.oo.....h......ooCo..tTTT',
    'T#...hh.oCo....hh.....oo..tTTTTT',
    'TT#.....o......hh.........tTTTTT',
    'TTT##tt........h.......ttTTTTTTT',
    'TTTTTTTTTTTTTTT..TTTTTTTTTTTTTTT',
  ],
  paths: [
    // town road up from Riftmarch, forking at the tundra
    [[31, 47], [31, 40], [30, 36]],
    // west fork: down to the south shore of the Glass Lake
    [[30, 36], [24, 35], [20, 34]],
    // east fork: across the snowfield to the Thunderhead Ridge
    [[30, 36], [38, 32], [46, 28], [52, 22], [56, 17], [63, 15]],
  ],
  portals: [
    { id: 'south', tx: 30, ty: 46, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'rift.riftmarch', portal: 'north' } },
    { id: 'east', tx: 62, ty: 14, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'rift.thunderhead_ridge', portal: 'west' } },
  ],
  spawns: [
    { monster: 'glacier_matron', count: 1, cx: 7, cy: 6, r: 3 },
    { monster: 'frostling', count: 9, cx: 18, cy: 24, r: 5 },
    { monster: 'frostling', count: 8, cx: 40, cy: 22, r: 5 },
    { monster: 'frostling', count: 5, cx: 14, cy: 38, r: 4 },
    { monster: 'rimefang', count: 7, cx: 44, cy: 8, r: 5 },
    { monster: 'rimefang', count: 6, cx: 50, cy: 32, r: 5 },
  ],
  nodes: [
    { id: 'frost_crystal_1', kind: 'frost_crystal', tx: 31, ty: 2 },
    { id: 'frost_crystal_2', kind: 'frost_crystal', tx: 42, ty: 2 },
    { id: 'frost_crystal_3', kind: 'frost_crystal', tx: 5, ty: 3 },
    { id: 'frost_crystal_4', kind: 'frost_crystal', tx: 52, ty: 22 },
    { id: 'frost_crystal_5', kind: 'frost_crystal', tx: 14, ty: 42 },
    { id: 'frost_crystal_6', kind: 'frost_crystal', tx: 10, ty: 22 },
    { id: 'fishing_1', kind: 'fishing', tx: 20, ty: 19 },
    { id: 'fishing_2', kind: 'fishing', tx: 29, ty: 28 },
    { id: 'fishing_3', kind: 'fishing', tx: 38, ty: 28 },
  ],
};

export default map;
