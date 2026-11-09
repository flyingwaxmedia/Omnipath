import type { MapDef } from '../../../core/world/types';

// Falls Hollow — a cliff-walled pocket behind the Windcrest falls. The cascade pours into a mossy pool at the
// north end; dusk willows hung with old wind chimes lean over it, and the only way out is the narrow mouth south.
const map: MapDef = {
  id: 'vale.falls_hollow',
  name: 'Falls Hollow',
  kind: 'secret',
  region: 'vale',
  biome: 'glade',
  seed: 37759,
  levelBand: [6, 6],
  safety: 'pve',
  worldCell: { x: 4, y: 0 },
  landmark: 'A hidden cascade spilling into a mossy pool, its willows strung with chimes nobody remembers hanging.',
  layout: [
    '####~#####',
    '##t-~-tT##',
    '#t,-~~-,t#',
    '#,.,---,.#',
    '#..,..,..#',
    '#t,....,t#',
    '#,......,#',
    '##t....t##',
    '###....###',
    '####..####',
  ],
  portals: [
    { id: 'mouth', tx: 8, ty: 18, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.windcrest_hill', portal: 'falls' } },
  ],
  spawns: [
    { monster: 'gustling', count: 2, cx: 5, cy: 10, r: 3 },
    { monster: 'gustling', count: 2, cx: 14, cy: 10, r: 3 },
  ],
  nodes: [
    { id: 'chime_west', kind: 'wind_chime', tx: 4, ty: 6 },
    { id: 'chime_east', kind: 'wind_chime', tx: 15, ty: 6 },
    { id: 'chime_low', kind: 'wind_chime', tx: 4, ty: 13 },
  ],
  objects: [
    {
      id: 'chest',
      kind: 'chest',
      tx: 14,
      ty: 4,
      loot: {
        coins: 60,
        items: { chime_feather: 2 },
        essences: { split: 1 },
        hint: 'Scratched inside the lid: "The fog gave way to the wind. Down in the quarry, cracked stone waits for a heavier hand — or a blast from within."',
      },
    },
  ],
};

export default map;
