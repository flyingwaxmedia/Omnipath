import type { ItemDef } from '../core/types';

export type { ItemDef } from '../core/types';

// Items (SPEC-v2 §8). Bag counts live in PlayerSave.bag (item id -> count).
// - material: gathered from nodes (SPEC §7.4); `price` is what a Waykeeper pays per unit. Trainer lessons spend them.
// - relic: warden drops; obtaining one sets the flag of the same id (gates the weapon capstones / Tier III classes).
// - shard: grants its element on pickup. tome: teaches its skill on pickup.
// - consumable: `amount` for heal / sp is a percentage of max HP / SP; `price` is the shop price.
export const ITEMS: ItemDef[] = [
  // ---------------------------------------------------------------- materials (Hearth Vale)
  {
    id: 'ore',
    name: 'Iron Ore',
    icon: '🪨',
    kind: 'material',
    desc: 'Rough ore from Greystone Quarry. Brann forges with it; the earth itself seems to notice who digs.',
    price: 3,
  },
  {
    id: 'fish',
    name: 'Lake Fish',
    icon: '🐟',
    kind: 'material',
    desc: 'A silver fish from Mirror Lake. Fisher Pell trades lessons for them.',
    price: 4,
  },
  {
    id: 'herb',
    name: 'Meadow Herb',
    icon: '🌿',
    kind: 'material',
    desc: 'A bitter, healing leaf. Grows in the meadow, by the lake and along the rift roads.',
    price: 2,
  },
  {
    id: 'chime_feather',
    name: 'Chime Feather',
    icon: '🪶',
    kind: 'material',
    desc: 'A feather caught in the wind chimes of Windcrest. It still hums faintly.',
    price: 5,
  },
  {
    id: 'umbral_spore',
    name: 'Umbral Spore',
    icon: '🍄',
    kind: 'material',
    desc: 'A dark spore cap from the shadowed groves. Cold to the touch.',
    price: 6,
  },
  {
    id: 'ember_shard',
    name: 'Ember Shard',
    icon: '🔸',
    kind: 'material',
    desc: 'A glowing chip from an ember vent. Quartermaster Vey trades for them.',
    price: 6,
  },
  {
    id: 'sun_water',
    name: 'Sun Water',
    icon: '🏺',
    kind: 'material',
    desc: 'Warm water from a sun spring. Springs hide in quiet, out-of-the-way places.',
    price: 8,
  },

  // ---------------------------------------------------------------- materials (Riftmarch)
  {
    id: 'storm_wood',
    name: 'Stormwood',
    icon: '🪵',
    kind: 'material',
    desc: 'Wood from a lightning-struck tree. The grain crackles. Korrin trades essences for it.',
    price: 8,
  },
  {
    id: 'frost_crystal',
    name: 'Frost Crystal',
    icon: '🧊',
    kind: 'material',
    desc: 'A crystal from the Frost Shelf that never quite melts. Prized by traders.',
    price: 10,
  },

  // ---------------------------------------------------------------- relics (warden drops; flag = id)
  {
    id: 'relic_stone',
    name: 'Ironroot Heartstone',
    icon: '🗿',
    kind: 'relic',
    flag: 'relic_stone',
    desc: 'Torn from the Ironroot Colossus. The deepest sword arts answer to its weight.',
  },
  {
    id: 'relic_dusk',
    name: "Regent's Dusk Seal",
    icon: '🌒',
    kind: 'relic',
    flag: 'relic_dusk',
    desc: "The Hollow Regent's seal, cold as a grave. The deepest dagger arts answer to its shadow.",
  },
  {
    id: 'relic_storm',
    name: 'Thunderhoof Horn',
    icon: '🌩️',
    kind: 'relic',
    flag: 'relic_storm',
    desc: "A horn still crackling with Thunderhoof's storm. The deepest staff arts answer to its charge.",
  },

  // ---------------------------------------------------------------- shard
  {
    id: 'storm_shard',
    name: 'Storm Shard',
    icon: '💎',
    kind: 'shard',
    element: 'lightning',
    desc: 'A crystal of trapped lightning from the heart of Thunderhoof. Holding it teaches you lightning.',
  },

  // ---------------------------------------------------------------- tomes
  {
    id: 'tome_quickstep',
    name: 'Tome of Quickstep',
    icon: '📘',
    kind: 'tome',
    skill: 'quickstep',
    desc: 'A wind-worn booklet of footwork drills. Reading it teaches Quickstep.',
  },
  {
    id: 'tome_static_field',
    name: 'Tome of Static Field',
    icon: '📙',
    kind: 'tome',
    skill: 'static_field',
    desc: 'Pages that crackle when turned. Reading it teaches Static Field.',
  },

  // ---------------------------------------------------------------- consumables
  {
    id: 'healing_draught',
    name: 'Healing Draught',
    icon: '🧪',
    kind: 'consumable',
    effect: 'heal',
    amount: 40,
    desc: 'A bitter herbal brew. Restores 40% of your max HP.',
    price: 25,
  },
  {
    id: 'mana_draught',
    name: 'Mana Draught',
    icon: '⚗️',
    kind: 'consumable',
    effect: 'sp',
    amount: 40,
    desc: 'A fizzing blue tonic. Restores 40% of your max SP.',
    price: 25,
  },
  {
    id: 'waystone_shard',
    name: 'Waystone Shard',
    icon: '🧿',
    kind: 'consumable',
    effect: 'recall',
    desc: 'A chip of waystone. Crush it to return to your last save point.',
    price: 40,
  },
  {
    id: 'blink_seed',
    name: 'Blink Seed',
    icon: '🌰',
    kind: 'consumable',
    effect: 'blink',
    desc: 'Crack it to blink a short way in the direction you are facing.',
    price: 30,
  },
];

/** Lookup by id (the bag stores ids). */
export const ITEM_BY_ID: Readonly<Record<string, ItemDef>> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));
