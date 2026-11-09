import type { MapDef } from '../../../core/world/types';

// Cinder Fields — a scorched ember plain split from the north border to the south by the Smoulder Scar, a glowing
// lava fissure. The rock held in two places: the Quarry road threads the northern break to a crossroads and on east
// to the plateau; an old trail takes the southern break. Ember vents hiss along the lips, a ring of standing cinder
// stones in the east is the Emberkit Alpha's lair, and two watchtowers guard the Emberwatch gate in the southern bluff.
const map: MapDef = {
  id: 'vale.cinder_fields',
  name: 'Cinder Fields',
  kind: 'field',
  region: 'vale',
  biome: 'ember',
  seed: 66841,
  levelBand: [6, 9],
  safety: 'pve',
  worldCell: { x: 3, y: 3 },
  landmark: 'The Smoulder Scar: a lava fissure splitting the plain from bluff to bluff, crossed only where the rock held.',
  layout: [
    '##TTT####,,####TTT###TTT####',
    '#t...,............t..L..tTT#',
    '#..o....,.....,.....LL...,T#',
    'T..##......,........L..,...#',
    'T.t.##.......,.....LL...C..#',
    '#....,.........,..LL..,....#',
    'T..,......,......LL...,.....',
    'T.......t.....,.......,.....',
    '#..,..........,........,...#',
    'T.....,........LL.....,....#',
    '......,.......LL..o..CC...,#',
    '........,....LL.....C...C..#',
    'T..,........LL....,.C...C..#',
    'T.t........LL,..........C.t#',
    '#..........,..,......CCC..T#',
    '#.,..........o.......,.....#',
    '#....,..LL........LL....,..#',
    '#.o....LL....,....LL.....tt#',
    '#.....LL,..........,....tTT#',
    '#..t.LL...,.........,...TTT#',
    '##TTLLTTT###############TTT#',
    '############################',
  ],
  paths: [
    // Quarry road: north gate -> crossroads -> through the northern break -> east to the plateau
    [
      [19, 0],
      [19, 8],
      [20, 14],
      [30, 16],
      [42, 15],
      [54, 14],
    ],
    // Gloomwood road: west gate -> crossroads
    [
      [0, 21],
      [8, 20],
      [14, 17],
      [20, 14],
    ],
    // Outpost road: from the break south between the towers to the Emberwatch gate
    [
      [30, 16],
      [34, 21],
      [35, 28],
      [33, 34],
      [32, 38],
    ],
    // Old trail through the southern break
    [
      [8, 20],
      [12, 24],
      [18, 28],
      [24, 31],
      [33, 34],
    ],
  ],
  structures: [
    { kind: 'tower', tx: 29, ty: 37 },
    { kind: 'tower', tx: 35, ty: 37 },
    { kind: 'ruin', tx: 4, ty: 30 },
  ],
  portals: [
    { id: 'west', tx: 0, ty: 20, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'vale.gloomwood', portal: 'east' } },
    { id: 'north', tx: 18, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'vale.greystone_quarry', portal: 'south' } },
    { id: 'east', tx: 54, ty: 12, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'vale.stormbreak_approach', portal: 'west' } },
    {
      id: 'outpost',
      tx: 32,
      ty: 40,
      w: 2,
      h: 2,
      facing: 's',
      kind: 'door',
      to: { map: 'vale.emberwatch', portal: 'gate' },
      label: 'Emberwatch Gate',
    },
  ],
  spawns: [
    { monster: 'emberkit', count: 8, cx: 8, cy: 10, r: 5 },
    { monster: 'ashfly', count: 7, cx: 34, cy: 8, r: 4 },
    { monster: 'ashfly', count: 7, cx: 20, cy: 30, r: 4 },
    { monster: 'emberkit', count: 7, cx: 44, cy: 34, r: 5 },
    { monster: 'emberkit', count: 4, cx: 37, cy: 27, r: 4 },
    { monster: 'emberkit_alpha', count: 1, cx: 45, cy: 25, r: 3 },
  ],
  nodes: [
    { id: 'vent_scar_n', kind: 'ember_vent', tx: 39, ty: 6 },
    { id: 'vent_scar_ne', kind: 'ember_vent', tx: 40, ty: 10 },
    { id: 'vent_scar_mid', kind: 'ember_vent', tx: 30, ty: 22 },
    { id: 'vent_scar_w', kind: 'ember_vent', tx: 23, ty: 24 },
    { id: 'vent_scar_sw', kind: 'ember_vent', tx: 18, ty: 34 },
    { id: 'vent_pit', kind: 'ember_vent', tx: 40, ty: 33 },
  ],
  npcs: [{ npc: 'scout_rhea', tx: 26, ty: 12 }],
  objects: [
    {
      id: 'sign_crossroads',
      kind: 'signpost',
      tx: 23,
      ty: 12,
      text: 'CINDER FIELDS. North: Greystone Quarry. West: Gloomwood. East: Stormbreak Approach. South: Emberwatch outpost. Cross the Scar only where the rock holds.',
    },
  ],
};

export default map;
