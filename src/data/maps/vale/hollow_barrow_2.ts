import type { MapDef } from '../../../core/world/types';

// Hollow Barrow II — the Wailing Galleries. Three long galleries coil down the floor like a serpent: the upper one
// lined with sarcophagus niches, the middle one half-collapsed into rubble, and between them and the lowest a flooded
// crypt crossed by a plank bridge. Off the flooded crypt's east side a narrow neck opens into the heaved, cracked den
// of the Crypt Keeper. The lowest gallery is a hall of sarcophagi that ends at the stair down to the Still Hall.
const map: MapDef = {
  id: 'vale.hollow_barrow.2',
  name: 'Hollow Barrow II',
  kind: 'dungeon',
  region: 'vale',
  biome: 'crypt',
  seed: 33479,
  levelBand: [8, 9],
  safety: 'pve',
  worldCell: { x: 2, y: 4 },
  landmark: 'The Wailing Galleries: niche-lined crypt halls coiling past a flooded ossuary to the den of the Crypt Keeper.',
  flags: ['dark', 'indoor'],
  layout: [
    '#####T###T###T##### ',
    '#xxxxxxxxxxxxxxxxx# ',
    '#xxxxxxxxxxxxxxxxx# ',
    '#x,xxxxx,xxxxx,xxx# ',
    '###############xxx# ',
    ' #xxxxxxxxxxxxxxxx# ',
    ' #xx,,xxxxC,,xxxxx# ',
    ' #xxxxxxxxxxxxxxx## ',
    ' #xxx#############  ',
    '##xxx#########,x,###',
    '#xxxxxxxxxxxx#,,x,,#',
    '#xxx-~~~~~-xxx,,x,,#',
    '#xxx-~~~~~-xxx,x,,,#',
    '#xxx-------xx#,,,x,#',
    '#xxx##########,,,###',
    '#xxxxxxxxxxxxxxxxx##',
    '#xxTxxTxxTxxTxxxxxx#',
    '#xxxxxxxxxxxxxxxxxx#',
    '#xxTxxTxxTxxTxxxxxx#',
    '####################',
  ],
  paths: [
    // plank bridge across the flooded crypt
    [
      [6, 24],
      [22, 24],
    ],
  ],
  portals: [
    {
      id: 'up',
      tx: 4,
      ty: 2,
      w: 2,
      h: 2,
      facing: 'n',
      kind: 'stairs',
      to: { map: 'vale.hollow_barrow.1', portal: 'down' },
      label: 'Up to Hollow Barrow I',
    },
    {
      id: 'down',
      tx: 36,
      ty: 34,
      w: 2,
      h: 2,
      facing: 'e',
      kind: 'stairs',
      to: { map: 'vale.hollow_barrow.3', portal: 'up' },
      label: 'Down to the Still Hall',
    },
  ],
  spawns: [
    { monster: 'cairn_wraith', count: 6, cx: 20, cy: 5, r: 4 },
    { monster: 'hollowshade', count: 6, cx: 18, cy: 13, r: 3 },
    { monster: 'cairn_wraith', count: 6, cx: 4, cy: 23, r: 3 },
    { monster: 'hollowshade', count: 6, cx: 9, cy: 34, r: 4 },
    { monster: 'cairn_wraith', count: 5, cx: 21, cy: 30, r: 4 },
    { monster: 'crypt_keeper', count: 1, cx: 33, cy: 23, r: 3 },
  ],
};

export default map;
