import type { MapDef } from '../../../core/world/types';

// Windcrest Hill — three terraces stacked by cliff bands. The road climbs east from the lowland meadows,
// up a ramp to the waystone ledge, back west along the middle terrace and up again to the summit, where the
// wind shrine stands in a ring of stones and Old Oru keeps his hut by the stream. The stream drops off the
// summit as a waterfall into a basin; in a notch of the cliff right beside the falls the mist never lifts.
const map: MapDef = {
  id: 'vale.windcrest_hill',
  name: 'Windcrest Hill',
  kind: 'field',
  region: 'vale',
  biome: 'hill',
  seed: 90413,
  levelBand: [4, 6],
  safety: 'pve',
  worldCell: { x: 3, y: 1 },
  landmark: 'The Wind Shrine on the summit, ringed by standing stones that hum whenever the gale picks up.',
  layout: [
    'TTTTTTTTTTTTTTTTTTTTT-~-TTTT',
    'TTTt,C...C..,,oo.tTTt-~-TTTT',
    'Tt,..........,,o...,.-~-TTTT',
    'T,.C.......C......,,.-~-TTTT',
    'Tt...............,...-~-TTTT',
    'Tt,..C...C.......,,..-~-TTTT',
    'TT..,,..........,,.###~#####',
    'TT....###############.~#####',
    'Tt...,,......o........-~~-##',
    'T,......t.....,,.....,-~~~-#',
    'Tt.....ttt..........,,-~~~--',
    'T,....tt.........o....------',
    'Tt,.....,,..........,,.....T',
    'Tt.,..o###########...#######',
    '########......,,.......,,..T',
    'TTt.....oo.......t.....,..tT',
    'Tt.....oCo.......tt.......tT',
    '.......,,.........tt.......T',
    '.....,,,,..............,,.tT',
    'Tt...,,,..........o.......tT',
    'Tt..........ooo.........,tTT',
    'TTt,......................TT',
    'TTTt,,.......,,.........tTTT',
    'TTTTTTTTTTTTTTT..TTTTTTTTTTT',
  ],
  paths: [
    // lowland road from Mirror Lake, east to the ramp foot
    [[0, 35], [10, 36], [20, 34], [28, 32], [37, 30], [38, 26]],
    // quarry road joining at the ramp foot
    [[32, 47], [31, 40], [34, 33], [37, 30]],
    // first ramp up to the waystone ledge, then west along the middle terrace to the second ramp
    [[38, 26], [37, 22], [30, 21], [20, 19], [10, 20], [6, 17], [6, 14]],
    // summit: second ramp, along the south side of the stone ring (spur in through its south gap), on to Oru's hut
    [[6, 14], [8, 13], [13, 13], [16, 13], [24, 12], [33, 9]],
    [[13, 13], [14, 11]],
  ],
  structures: [{ kind: 'hut', tx: 34, ty: 4 }],
  portals: [
    { id: 'southwest', tx: 0, ty: 34, w: 2, h: 4, facing: 'w', kind: 'edge', to: { map: 'vale.mirror_lake', portal: 'northeast' } },
    { id: 'south', tx: 30, ty: 46, w: 4, h: 2, facing: 's', kind: 'edge', to: { map: 'vale.greystone_quarry', portal: 'north' } },
    {
      id: 'falls',
      tx: 42,
      ty: 14,
      w: 2,
      h: 2,
      facing: 'n',
      kind: 'hidden',
      to: { map: 'vale.falls_hollow', portal: 'mouth' },
      label: 'Behind the Falls',
      reveal: {
        element: 'wind',
        look: 'fog',
        hint: 'A wall of mist hangs in the notch beside the falls. It sways when the breeze rises, but never thins.',
      },
    },
  ],
  spawns: [
    { monster: 'sparkbug', count: 9, cx: 14, cy: 40, r: 5 },
    { monster: 'sparkbug', count: 8, cx: 44, cy: 34, r: 5 },
    { monster: 'gustling', count: 8, cx: 14, cy: 22, r: 5 },
    { monster: 'gustling', count: 7, cx: 27, cy: 18, r: 4 },
    { monster: 'galeplume', count: 1, cx: 27, cy: 5, r: 3 },
  ],
  nodes: [
    { id: 'chime_ramp', kind: 'wind_chime', tx: 30, ty: 30 },
    { id: 'chime_terrace', kind: 'wind_chime', tx: 6, ty: 22 },
    { id: 'chime_basin', kind: 'wind_chime', tx: 40, ty: 18 },
    { id: 'chime_summit', kind: 'wind_chime', tx: 4, ty: 10 },
    { id: 'chime_hut', kind: 'wind_chime', tx: 32, ty: 6 },
  ],
  npcs: [{ npc: 'oru', tx: 36, ty: 8 }],
  objects: [
    { id: 'waystone', kind: 'waystone', tx: 33, ty: 24 },
    { id: 'wind_shrine', kind: 'wind_shrine', tx: 14, ty: 6, text: 'Sit, breathe, and let the wind pass through you.' },
  ],
};

export default map;
