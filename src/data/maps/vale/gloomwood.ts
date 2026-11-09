import type { MapDef } from '../../../core/world/types';

// Gloomwood — the dark wood south of Hearthvale. The vale road squeezes between two mossy crags into a lantern-less
// crossing; from there trails fork west through the trees to the Umbral Obelisk in its ring of menhirs, east over a
// plank boardwalk across the Blackwater bog to the Cinder Fields road, and south to the Hollow Barrow, its door cut
// into the face of a grassed-over mound between two guardian stones. A fungal hollow festers in the south-east where
// the Gloomcap Matriarch roots, and behind a cleft in the rocks west of the stone ring a glyph-carved face hides the
// way to the Moonlit Glade.
const map: MapDef = {
  id: 'vale.gloomwood',
  name: 'Gloomwood',
  kind: 'field',
  region: 'vale',
  biome: 'grove',
  seed: 41387,
  levelBand: [5, 7],
  safety: 'pve',
  worldCell: { x: 2, y: 3 },
  landmark: 'The Umbral Obelisk: a black needle of stone in a ring of mossy menhirs, drinking what little light reaches the wood.',
  layout: [
    'TTTTTTTT#..#TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTT#..#TTTTTTTTTTTTTTTTTTTT',
    'TTTTTTTt,..,tTTTTTTTTTTTTTTTTTTT',
    'TTTTTt,,....,,tTTTTTTTTttTTTTTTT',
    'TTTTt,.,m......,tTTTTt,,,,tTTTTT',
    'TTTt,..mmm.......tTTt,,--,,,tTTT',
    'TTTt,...m.........,,,,-~~-,,,tTT',
    'TTTTt,......,....,,,,-~~~~-,,tTT',
    'TTTTTTt,,,,tTTTTTt,,,-~~~~--,tTT',
    'TTTt,,tTTTTTTTTTTTt,,,-~~~-,,,tT',
    'TTt,,.C.C..tTTTTTTTt,,,---,,o,t#',
    'Tt,..C...C,,tTTTTTTTt,,,,,,,oo,,',
    'T,,...........tTTTTTt,,.......,,',
    'Tt,..C...C.,,,tTTTTTt,,ttt,o,,,#',
    'TT,,..C.C..,..........,tTTTt,,tT',
    'TTt,,.....,,...C...C..,tTTTTt,tT',
    'TTt,,,,,,,tt,,.......,tTTTt,,m,T',
    'T#,tTTt,,tTTTt,C###C,,tTt,,mmm,T',
    '#,,#TTTTttTTTTt#####t,,,,mmmmmmT',
    ',,,#TTTTTTTTTT#######tt,,,mmmm,T',
    '#,,#TTTTTTTTTT#########t,,,mm,tT',
    'T##TTTTTTTTTTTT#######TTt,,,,tTT',
    'TTTTTTTTTTTTTTTTT####TTTTttTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  paths: [
    // Hearthvale crags -> crossing -> Blackwater boardwalk -> east trail to the Cinder Fields
    [
      [19, 0],
      [19, 6],
      [24, 10],
      [32, 12],
      [38, 14],
      [44, 15],
      [52, 16],
      [56, 20],
      [60, 23],
      [62, 23],
    ],
    // crossing -> through the old wood -> barrow lawn, ending at the door
    [
      [24, 10],
      [26, 16],
      [28, 22],
      [32, 27],
      [34, 32],
    ],
    // crossing -> stone ring (stops short of the north gap so the menhirs stand)
    [
      [19, 6],
      [14, 12],
      [14, 17],
    ],
    // ring's east gap -> barrow lawn
    [
      [21, 24],
      [26, 26],
      [32, 27],
    ],
    // east trail -> fungal hollow
    [
      [58, 24],
      [56, 30],
      [54, 33],
    ],
  ],
  portals: [
    { id: 'north', tx: 18, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'vale.hearthvale', portal: 'south' } },
    { id: 'east', tx: 62, ty: 22, w: 2, h: 4, facing: 'e', kind: 'edge', to: { map: 'vale.cinder_fields', portal: 'west' } },
    {
      id: 'barrow',
      tx: 34,
      ty: 34,
      w: 2,
      h: 2,
      facing: 's',
      kind: 'door',
      to: { map: 'vale.hollow_barrow.1', portal: 'entrance' },
      label: 'Into the Hollow Barrow',
    },
    {
      id: 'glade',
      tx: 0,
      ty: 38,
      w: 2,
      h: 2,
      facing: 'w',
      kind: 'hidden',
      to: { map: 'vale.moonlit_glade', portal: 'path' },
      reveal: {
        element: 'shadow',
        elements: ['holy'],
        look: 'glyph',
        hint: 'Glyphs crawl across this mossy rock face, swallowing the light around them. Shadow might wake them, or holy light.',
      },
    },
  ],
  spawns: [
    { monster: 'gloomcap', count: 8, cx: 22, cy: 12, r: 5 },
    { monster: 'gloomcap', count: 7, cx: 10, cy: 30, r: 4 },
    { monster: 'hollowshade', count: 7, cx: 26, cy: 28, r: 4 },
    { monster: 'hollowshade', count: 6, cx: 39, cy: 17, r: 3 },
    { monster: 'gloomcap', count: 6, cx: 56, cy: 18, r: 3 },
    { monster: 'gloom_matriarch', count: 1, cx: 54, cy: 36, r: 3 },
  ],
  nodes: [
    { id: 'spore_crossing', kind: 'shadow_fungus', tx: 15, ty: 10 },
    { id: 'spore_ring', kind: 'shadow_fungus', tx: 4, ty: 22 },
    { id: 'spore_bog', kind: 'shadow_fungus', tx: 44, ty: 9 },
    { id: 'spore_barrow', kind: 'shadow_fungus', tx: 26, ty: 33 },
    { id: 'spore_hollow_n', kind: 'shadow_fungus', tx: 58, ty: 34 },
    { id: 'spore_hollow_s', kind: 'shadow_fungus', tx: 50, ty: 40 },
  ],
  objects: [
    {
      id: 'obelisk',
      kind: 'obelisk',
      tx: 14,
      ty: 24,
      text: 'The Umbral Obelisk. Its surface swallows your reflection. The Gloomcaps that root around it seem to guard it.',
    },
  ],
};

export default map;
