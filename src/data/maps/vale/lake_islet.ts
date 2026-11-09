import type { MapDef } from '../../../core/world/types';

// Lake Islet — a scrap of sand and grass far out on Mirror Lake, reached only by dashing over the shimmer.
// A lone stand of trees shades a sun-warmed spring; a sandbar runs south back toward the cove.
const map: MapDef = {
  id: 'vale.lake_islet',
  name: 'Lake Islet',
  kind: 'secret',
  region: 'vale',
  biome: 'lake',
  seed: 28817,
  levelBand: [3, 3],
  safety: 'pve',
  worldCell: { x: 2, y: 0 },
  landmark: 'A sun-warmed spring bubbling under a lone stand of trees, far out on the open lake.',
  layout: [
    '~~~~--~~',
    '~-tTTt-~',
    '-t,..,t-',
    '-,....,-',
    '-......-',
    '~-....--',
    '~~-..:-~',
    '~~~-::-~',
  ],
  portals: [
    { id: 'shore', tx: 8, ty: 14, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.mirror_lake', portal: 'islet' } },
  ],
  spawns: [{ monster: 'puddlewisp', count: 3, cx: 6, cy: 7, r: 3 }],
  nodes: [
    { id: 'fish_west', kind: 'fishing', tx: 2, ty: 8 },
    { id: 'fish_east', kind: 'fishing', tx: 13, ty: 7 },
    { id: 'spring', kind: 'sun_spring', tx: 8, ty: 5 },
  ],
  objects: [
    {
      id: 'chest',
      kind: 'chest',
      tx: 10,
      ty: 4,
      loot: {
        coins: 45,
        items: { fish: 2 },
        essences: { return: 1 },
        hint: 'A waterlogged journal, one page still legible: "East on Windcrest the falls breathe a fog no lantern parts. Bring the wind, and the mist will step aside."',
      },
    },
  ],
};

export default map;
