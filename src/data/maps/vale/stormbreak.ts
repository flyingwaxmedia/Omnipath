import type { MapDef } from '../../../core/world/types';

// Stormbreak — Thunderhoof's arena: a round, storm-scoured mesa top above the clouds. The way in climbs over the western
// lip from the Prism Gate; four lightning stones stand around the ring where Thunderhoof paces; across the far, eastern
// lip the rift to the Riftmarch churns behind a wall of living storm until the warden falls.
const map: MapDef = {
  id: 'vale.stormbreak',
  name: 'Stormbreak',
  kind: 'arena',
  region: 'vale',
  biome: 'plateau',
  seed: 58261,
  levelBand: [12, 12],
  safety: 'pve',
  worldCell: { x: 5, y: 3 },
  landmark: "Thunderhoof's mesa: a ring of lightning stones above the clouds, the Riftmarch rift churning past its eastern lip.",
  decor: 0.5,
  layout: [
    '############',
    '###,,o,,o###',
    '##,,,..,,,##',
    '#,,C....C,,#',
    '#,,......,,#',
    '.o........o.',
    '.,........,.',
    '#,,......,,#',
    '#o,C....C,o#',
    '##,,,..,,o##',
    '###,,o,,o###',
    '############',
  ],
  portals: [
    {
      id: 'entrance',
      tx: 0,
      ty: 10,
      w: 2,
      h: 4,
      facing: 'w',
      kind: 'edge',
      to: { map: 'vale.stormbreak_approach', portal: 'gate' },
      label: 'Back through the Prism Gate',
    },
    {
      id: 'rift',
      tx: 22,
      ty: 10,
      w: 2,
      h: 4,
      facing: 'e',
      kind: 'edge',
      to: { map: 'rift.riftgate_road', portal: 'vale' },
      label: 'The Rift to the Riftmarch',
      gate: {
        flag: 'warden_thunderhoof',
        hint: 'The rift churns behind a wall of living storm. While Thunderhoof stands, it will not part.',
      },
    },
  ],
  spawns: [{ monster: 'thunderhoof', count: 1, cx: 12, cy: 12, r: 3 }],
};

export default map;
