import type { MapDef } from '../../../core/world/types';

// Quarry Depths III — the Rootbound Hall, the Ironroot Colossus's arena. One round chamber: the stairs come up at the
// south rim, four stalagmite pillars give cover near the walls, and a ring of moss marks where the Colossus's iron
// roots have broken through the floor around the spot where it stands.
const map: MapDef = {
  id: 'vale.quarry_depths.3',
  name: 'Rootbound Hall',
  kind: 'arena',
  region: 'vale',
  biome: 'cave',
  seed: 52933,
  levelBand: [9, 9],
  safety: 'pve',
  worldCell: { x: 4, y: 2 },
  landmark: 'The Rootbound Hall: a round chamber split by iron-hard roots, where the Ironroot Colossus stands at the heart.',
  flags: ['dark', 'indoor'],
  decor: 0.4,
  layout: [
    '  ########  ',
    ' ##.,oo,.## ',
    '##.,....,.##',
    '#.T......T.#',
    '#,..,,,,..,#',
    '#..,,..,,..#',
    '#..,,..,,..#',
    '#,..,,,,..,#',
    '#.T......T.#',
    '##.,....,.##',
    ' ##,....,## ',
    '  ########  ',
  ],
  portals: [
    { id: 'up', tx: 11, ty: 20, w: 2, h: 2, facing: 's', kind: 'stairs', to: { map: 'vale.quarry_depths.2', portal: 'down' }, label: 'Up to Quarry Depths II' },
  ],
  spawns: [{ monster: 'ironroot_colossus', count: 1, cx: 12, cy: 11, r: 3 }],
};

export default map;
