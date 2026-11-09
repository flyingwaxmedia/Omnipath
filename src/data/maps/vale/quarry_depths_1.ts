import type { MapDef } from '../../../core/world/types';

// Quarry Depths I — the Old Workings. The adit opens into a timbered hall (waystone); a plank haulage way runs east to
// the great central cavern. Dead-end side workings branch north-west (the old stope) and north-east (a glimmering
// gallery), while the south working loops round over a plank bridge across an underground stream to the stairs down.
const map: MapDef = {
  id: 'vale.quarry_depths.1',
  name: 'Quarry Depths I',
  kind: 'dungeon',
  region: 'vale',
  biome: 'cave',
  seed: 52901,
  levelBand: [5, 7],
  safety: 'pve',
  worldCell: { x: 4, y: 2 },
  landmark: 'The Old Workings: a plank haulage way and a bridge over an underground stream, cut by miners long gone.',
  flags: ['dark', 'indoor'],
  decor: 1.5,
  layout: [
    '   ######    ###### ',
    '  ##.,o.##  ##.,..##',
    '  #..C...#  #.....o#',
    '  #.....,#  #..C...#',
    '  ##,..###  ##....##',
    '   #..##     ##..## ',
    '  ##..#      #..##  ',
    ' ##...###  ###...###',
    ' #.....,####.....,.#',
    ' #.o....bbbb.......#',
    ' #......bbbb..T....#',
    ' #...,..####.,....o#',
    ' ##...###  ##.....##',
    '  ##..#     ##...## ',
    ' ##...#########...##',
    ' #..o.,..-~-###....#',
    ' #.,....,bbbb......#',
    ' #......,bbbb.,..o.#',
    ' ##...,.-~~-##.....#',
    '  ##################',
  ],
  portals: [
    { id: 'entrance', tx: 2, ty: 18, w: 2, h: 2, facing: 'w', kind: 'door', to: { map: 'vale.greystone_quarry', portal: 'depths' }, label: 'Out to Greystone Quarry' },
    { id: 'down', tx: 36, ty: 32, w: 2, h: 2, facing: 'e', kind: 'stairs', to: { map: 'vale.quarry_depths.2', portal: 'up' }, label: 'Down to Quarry Depths II' },
  ],
  spawns: [
    { monster: 'cragling', count: 6, cx: 10, cy: 7, r: 4 },
    { monster: 'glowmite', count: 6, cx: 33, cy: 4, r: 4 },
    { monster: 'cragling', count: 7, cx: 32, cy: 22, r: 5 },
    { monster: 'glowmite', count: 6, cx: 9, cy: 33, r: 4 },
  ],
  nodes: [
    { id: 'ore_stope', kind: 'ore', tx: 8, ty: 2 },
    { id: 'ore_gallery', kind: 'ore', tx: 37, ty: 6 },
    { id: 'ore_stream', kind: 'ore', tx: 4, ty: 30 },
    { id: 'ore_stairs', kind: 'ore', tx: 33, ty: 37 },
  ],
  objects: [{ id: 'waystone_adit', kind: 'waystone', tx: 9, ty: 17 }],
};

export default map;
