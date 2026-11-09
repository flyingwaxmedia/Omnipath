import type { MapDef } from '../../../core/world/types';

// Hollow Barrow IV — the Regent's Hall, the Hollow Regent's arena. One round crypt: the stair comes down at the north
// rim, four sarcophagi stand near the walls as cover, and a ring of cracked flagstones marks where the Regent waits at
// the centre, risen from the open tomb at the south rim.
const map: MapDef = {
  id: 'vale.hollow_barrow.4',
  name: "Regent's Hall",
  kind: 'arena',
  region: 'vale',
  biome: 'crypt',
  seed: 33511,
  levelBand: [11, 11],
  safety: 'pve',
  worldCell: { x: 2, y: 4 },
  landmark: "The Regent's Hall: a ring of cracked flagstones among four sarcophagi, the Regent's own tomb lying open at the foot.",
  flags: ['dark', 'indoor'],
  decor: 0.4,
  layout: [
    '  ########  ',
    ' ##xxxxxx## ',
    '##TxxxxxxT##',
    '#xxx++++xxx#',
    '#xx++xx++xx#',
    '#xx+xxxx+xx#',
    '#xx+xxxx+xx#',
    '#xx++xx++xx#',
    '#xxx++++xxx#',
    '##TxxxxxxT##',
    ' ##xxTTxx## ',
    '  ########  ',
  ],
  portals: [
    {
      id: 'up',
      tx: 11,
      ty: 2,
      w: 2,
      h: 2,
      facing: 'n',
      kind: 'stairs',
      to: { map: 'vale.hollow_barrow.3', portal: 'down' },
      label: 'Up to the Still Hall',
    },
  ],
  spawns: [{ monster: 'hollow_regent', count: 1, cx: 12, cy: 12, r: 3 }],
};

export default map;
