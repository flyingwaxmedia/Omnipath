import type { MapDef } from '../../../core/world/types';

// Quarry Depths II — the Glittering Deep. Natural caverns, not mine-work: the stairs land on a mossy north-west ledge
// (waystone) above a great round cavern holding a still black lake. Shores curve round both sides of the water to the
// south-east stair chamber; a narrow neck off the north shore opens into the geode-lined den where the Geode Sentinel
// keeps its watch, and a quiet grotto hides in the south-west.
const map: MapDef = {
  id: 'vale.quarry_depths.2',
  name: 'Quarry Depths II',
  kind: 'dungeon',
  region: 'vale',
  biome: 'cave',
  seed: 52917,
  levelBand: [6, 8],
  safety: 'pve',
  worldCell: { x: 4, y: 2 },
  landmark: 'The Glittering Deep: a still black lake ringed by crystal-studded moss, a geode den gleaming beyond its north shore.',
  flags: ['dark', 'indoor'],
  decor: 1.8,
  layout: [
    '                ####',
    ' ######       ##,,##',
    '##,,.,##     ##.,..#',
    '#,.....#     #..,o.#',
    '#,....########,,..,#',
    '##...,##........####',
    ' ###.,....,.,.,###  ',
    '   #,.T.,,,,....,#  ',
    '  ##...,----,....## ',
    '  #.,.,--~~~--.,T.# ',
    '  #,,.-~~~~~~-....# ',
    '  #..,--~~~~~-,,..# ',
    '  #.T..-------....# ',
    '  ##.....--...,..## ',
    '  ###....,.,.C,.### ',
    ' ##......,,......,##',
    '##.,,,########.....#',
    '#,....#      #,o,..#',
    '##....#      #....##',
    ' ######      ###### ',
  ],
  portals: [
    { id: 'up', tx: 6, ty: 4, w: 2, h: 2, facing: 'n', kind: 'stairs', to: { map: 'vale.quarry_depths.1', portal: 'down' }, label: 'Up to Quarry Depths I' },
    { id: 'down', tx: 30, ty: 36, w: 2, h: 2, facing: 's', kind: 'stairs', to: { map: 'vale.quarry_depths.3', portal: 'up' }, label: 'Down to the Rootbound Hall' },
  ],
  spawns: [
    { monster: 'glowmite', count: 8, cx: 20, cy: 14, r: 5 },
    { monster: 'cragling', count: 6, cx: 18, cy: 28, r: 5 },
    { monster: 'cragling', count: 5, cx: 31, cy: 21, r: 4 },
    { monster: 'glowmite', count: 5, cx: 7, cy: 34, r: 3 },
    { monster: 'geode_sentinel', count: 1, cx: 33, cy: 5, r: 3 },
  ],
  nodes: [
    { id: 'ore_den', kind: 'ore', tx: 37, ty: 6 },
    { id: 'ore_shore', kind: 'ore', tx: 35, ty: 20 },
    { id: 'ore_grotto', kind: 'ore', tx: 2, ty: 34 },
  ],
  objects: [{ id: 'waystone_ledge', kind: 'waystone', tx: 4, ty: 8 }],
};

export default map;
