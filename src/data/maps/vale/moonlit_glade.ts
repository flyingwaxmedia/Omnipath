import type { MapDef } from '../../../core/world/types';

// Moonlit Glade — a hidden hollow west of Gloomwood, reached through the glyph stone. Duskwillows ring a silver pool
// that holds a full moon whatever the hour; a rill spills from its southern lip under a plank footbridge. A stone warden
// kneels on the west shore, three sun springs well up around the water, and rare Moonmoths drift above it all.
const map: MapDef = {
  id: 'vale.moonlit_glade',
  name: 'Moonlit Glade',
  kind: 'secret',
  region: 'vale',
  biome: 'glade',
  seed: 60719,
  levelBand: [7, 7],
  safety: 'pve',
  worldCell: { x: 1, y: 3 },
  landmark: 'A silver pool that always holds a full moon, a kneeling stone warden keeping vigil on its western shore.',
  decor: 1.5,
  layout: [
    'TTTTTTTTT###',
    'TTTt,,,tTT##',
    'TTt,.,..,tT#',
    'Tt,..---.,t#',
    'T,..-~~~-.,#',
    'T,.-~~~~-..,',
    'T,.-~~~~~-.,',
    'Tt,.-~~~-.,#',
    'TT,..-~-..,#',
    'TTt,,.-.,t##',
    'TTTTt,,,,T##',
    'TTTTTTTTT###',
  ],
  paths: [
    // pilgrims' path: from the cleft round the south shore and over the rill to the warden
    [
      [21, 11],
      [19, 14],
      [17, 17],
      [10, 18],
      [6, 17],
      [4, 14],
    ],
  ],
  portals: [
    {
      id: 'path',
      tx: 22,
      ty: 10,
      w: 2,
      h: 4,
      facing: 'e',
      kind: 'edge',
      to: { map: 'vale.gloomwood', portal: 'glade' },
      label: 'Back to Gloomwood',
    },
  ],
  spawns: [
    { monster: 'moonmoth', count: 1, cx: 7, cy: 4, r: 3 },
    { monster: 'moonmoth', count: 1, cx: 4, cy: 18, r: 3 },
    { monster: 'moonmoth', count: 1, cx: 17, cy: 20, r: 3 },
  ],
  nodes: [
    { id: 'spring_north', kind: 'sun_spring', tx: 13, ty: 4 },
    { id: 'spring_east', kind: 'sun_spring', tx: 18, ty: 7 },
    { id: 'spring_south', kind: 'sun_spring', tx: 13, ty: 21 },
  ],
  objects: [
    {
      id: 'statue',
      kind: 'statue',
      tx: 4,
      ty: 11,
      text: 'A hooded warden kneels at the water, a crescent moon cupped in stone hands. The plinth reads: "I kept the night so the dawn could find its way. Bring the holy light here, and keep the watch with me."',
    },
  ],
};

export default map;
