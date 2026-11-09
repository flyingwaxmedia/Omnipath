import type { MapDef } from '../../../core/world/types';

// Collapsed Shaft — a caved-in gallery under the quarry's cracked face. The ladder drops onto a plank landing; rubble
// heaps split the chamber into a little loop of side bays, ore glints in every wall, and a miner's strongbox was left
// behind in the far corner when the roof came down.
const map: MapDef = {
  id: 'vale.collapsed_shaft',
  name: 'Collapsed Shaft',
  kind: 'secret',
  region: 'vale',
  biome: 'cave',
  seed: 41377,
  levelBand: [5, 5],
  safety: 'pve',
  worldCell: { x: 4, y: 1 },
  landmark: 'A caved-in mine gallery: rubble heaps under split pit-props, raw ore glinting in the broken walls.',
  flags: ['dark', 'indoor'],
  layout: [
    ' ###### ',
    '##.bb.##',
    '#,.bb.,#',
    '#.C..C.#',
    '#,..,..#',
    '##.C..,#',
    '#,.....#',
    ' ###### ',
  ],
  portals: [
    { id: 'ladder', tx: 7, ty: 2, w: 2, h: 2, facing: 'n', kind: 'stairs', to: { map: 'vale.greystone_quarry', portal: 'shaft' }, label: 'Climb to Greystone Quarry' },
  ],
  spawns: [
    { monster: 'cragling', count: 2, cx: 4, cy: 11, r: 3 },
    { monster: 'cragling', count: 2, cx: 11, cy: 11, r: 3 },
  ],
  nodes: [
    { id: 'ore_nw', kind: 'ore', tx: 2, ty: 4 },
    { id: 'ore_ne', kind: 'ore', tx: 13, ty: 5 },
    { id: 'ore_w', kind: 'ore', tx: 2, ty: 9 },
    { id: 'ore_e', kind: 'ore', tx: 13, ty: 9 },
    { id: 'ore_s', kind: 'ore', tx: 8, ty: 13 },
  ],
  objects: [
    {
      id: 'chest_strongbox',
      kind: 'chest',
      tx: 2,
      ty: 13,
      loot: {
        coins: 45,
        items: { ore: 4 },
        essences: { heavy: 1 },
        hint: 'Scratched inside the lid: "Stone things crack under fire; wind and lightning just scatter off them. And swing heavy: the bigger the brute, the deeper a heavy blow bites."',
      },
    },
  ],
};

export default map;
