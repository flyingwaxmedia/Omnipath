import type { MapDef } from '../../../core/world/types';

// Barrow Vault — the Regent's sealed treasury below the Still Hall, opened only by shadow and holy light together.
// A small cobbled chamber between four sarcophagi; violet dusk-moss creeps from the foot of a twin-faced statue of sun
// and moon toward the chest set before it.
const map: MapDef = {
  id: 'vale.barrow_vault',
  name: 'Barrow Vault',
  kind: 'secret',
  region: 'vale',
  biome: 'crypt',
  seed: 33527,
  levelBand: null,
  safety: 'pve',
  worldCell: { x: 2, y: 4 },
  landmark: 'A sealed treasury where violet dusk-moss creeps from the foot of a twin-faced statue of sun and moon.',
  flags: ['dark', 'indoor'],
  decor: 0.3,
  layout: [
    ' ###### ',
    '##xllx##',
    '#x+ll+x#',
    '#T++++T#',
    '#x++++x#',
    '#T++++T#',
    '##x++x##',
    ' ###### ',
  ],
  portals: [
    {
      id: 'door',
      tx: 7,
      ty: 14,
      w: 2,
      h: 2,
      facing: 's',
      kind: 'door',
      to: { map: 'vale.hollow_barrow.3', portal: 'vault' },
      label: 'Back to the Still Hall',
    },
  ],
  spawns: [],
  objects: [
    {
      id: 'statue',
      kind: 'statue',
      tx: 8,
      ty: 3,
      text: 'A twin-faced figure: one face a blazing sun, the other a hooded moon, their hands joined over a single violet stone. "We were two, and became the hour between."',
    },
    {
      id: 'chest',
      kind: 'chest',
      tx: 8,
      ty: 7,
      loot: {
        coins: 90,
        items: { umbral_spore: 2, sun_water: 2 },
        hint: 'Painted in violet on the lid: "Neither night nor day, but the hour that holds both. Lay shadow beside holy light upon an altar, and twilight will answer."',
      },
    },
  ],
};

export default map;
