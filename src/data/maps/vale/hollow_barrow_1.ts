import type { MapDef } from '../../../core/world/types';

// Hollow Barrow I — the Barrow Halls. The stair from Gloomwood drops into a long entry hall where the barrow's first
// waystone glows. West lies the Hall of Tombs, three ranks of grave plots; east, the Root Gallery, where the wood above
// has burst through the vault in mossy tangles and shadow fungus thrives. Both wings wind down to the ossuary, with a
// fungus-choked reliquary niche off its north wall and a side crypt off its west end, and the stair to the second
// floor waits in the south-east chamber.
const map: MapDef = {
  id: 'vale.hollow_barrow.1',
  name: 'Hollow Barrow I',
  kind: 'dungeon',
  region: 'vale',
  biome: 'crypt',
  seed: 33461,
  levelBand: [7, 8],
  safety: 'pve',
  worldCell: { x: 2, y: 4 },
  landmark: 'The Hall of Tombs: three ranks of grave plots under the barrow roots, the first waystone of the deep glowing at the stair.',
  flags: ['dark', 'indoor'],
  layout: [
    '      ########      ',
    '      #xxxxxx####   ',
    '  #####xxxxxxxxx#   ',
    '  #xxxxxxxxxxxxx##  ',
    '###xxxxxxxxxx##xx###',
    '#xxxxxx######mmmmmm#',
    '#xxxxxx#    #m,mmm,#',
    '#xTxTxx#    #mmC,mm#',
    '#xxxxxx#    #,mmmmm#',
    '#xTxTxx#    #mm,mCm#',
    '#xxxxxx######mmmm,m#',
    '#xTxTxx##xxxx###mm##',
    '#xxxxxx##xmmx###mm# ',
    '#####xxxxxxxxx##mm##',
    '#####xtxtxtxtx#xxxx#',
    '#xxx#xxxxxxxxx#xxxx#',
    '#xxxxxxxxxxxxxxxxxx#',
    '#xxx#xtxtxtxtx#xxxx#',
    '#xxx###########xxxx#',
    '#####         ######',
  ],
  portals: [
    {
      id: 'entrance',
      tx: 18,
      ty: 2,
      w: 2,
      h: 2,
      facing: 'n',
      kind: 'stairs',
      to: { map: 'vale.gloomwood', portal: 'barrow' },
      label: 'Up to Gloomwood',
    },
    {
      id: 'down',
      tx: 34,
      ty: 36,
      w: 2,
      h: 2,
      facing: 's',
      kind: 'stairs',
      to: { map: 'vale.hollow_barrow.2', portal: 'up' },
      label: 'Down to Hollow Barrow II',
    },
  ],
  spawns: [
    { monster: 'hollowshade', count: 7, cx: 11, cy: 17, r: 4 },
    { monster: 'cairn_wraith', count: 6, cx: 30, cy: 16, r: 4 },
    { monster: 'hollowshade', count: 6, cx: 18, cy: 31, r: 4 },
    { monster: 'cairn_wraith', count: 5, cx: 5, cy: 32, r: 3 },
    { monster: 'cairn_wraith', count: 4, cx: 33, cy: 24, r: 3 },
  ],
  nodes: [
    { id: 'spore_reliquary', kind: 'shadow_fungus', tx: 21, ty: 24 },
    { id: 'spore_gallery', kind: 'shadow_fungus', tx: 34, ty: 12 },
    { id: 'spore_crypt', kind: 'shadow_fungus', tx: 3, ty: 35 },
  ],
  objects: [{ id: 'waystone', kind: 'waystone', tx: 23, ty: 5 }],
};

export default map;
