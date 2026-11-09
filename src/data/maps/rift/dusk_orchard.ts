import type { MapDef } from '../../../core/world/types';

// Dusk Orchard — an abandoned estate south of Riftmarch where it is always the last minute of sunset. Row upon row
// of duskwillows still stand in their planted lines either side of the old carriage lane; past the south hedge lie
// the Gloaming Mere (sun springs bubble on its banks), the broken manor on its cobbled court, and the Gloaming Bower —
// a hedged, moss-edged garden where the Dusk Sovereign holds court. A dead end: the only way out is back north.
const map: MapDef = {
  id: 'rift.dusk_orchard',
  name: 'Dusk Orchard',
  kind: 'field',
  region: 'rift',
  biome: 'dusk',
  seed: 382659,
  levelBand: [18, 21],
  safety: 'pve',
  worldCell: { x: 1, y: 2 },
  landmark: 'The Gloaming Bower — a hedged garden behind the broken manor where the Dusk Sovereign holds court at eternal sunset.',
  layout: [
    'TTTTTTTTTTTTTTT..TTTTTTTTTTTTTTT',
    'TTTTTTTTTTTTTt...tTTTTTTTTTTTTTT',
    'TTTTTtt,,,,,,t.....t,,,,,,ttTTTT',
    'TTt,........................,tTT',
    'Tt.T..T..t..T......T..T..T..T.tT',
    'T.,,,,,,,,,,,,....,,,,,,,,,,,,.T',
    'Tt............................tT',
    'T..T..T..T..T......T..,..T..T..T',
    'T.,,,,,,,,,,,,....,,,,,,,,,,,,.T',
    'Tt............................tT',
    'Tt.T..t..T..T......T..T..o..T.tT',
    'T.,,,,,,,,,,,,....,,,,,,,,,,,,.T',
    'T.............................tT',
    'TTtt....tTTT........TTTt....ttTT',
    'T,......,,.................,,.tT',
    'T..----....++++++++.TTTTTTTTT..T',
    'T.-~~~~-...++++++++.TmmmmmmmT..T',
    'T.-~~~~-...++++++++.Tm.....mT..T',
    'T.-~~~--...++++++++.........T..T',
    'T..----....++++++++.Tm.....mT..T',
    'T,.........,,,,,,,,.TmmmmmmmT..T',
    'TT.....tt...........TTTTTTTTT.TT',
    'TTTTtt..tTTTTt......tTTTTTTTTTTT',
    'TTTTTTTTTTTTTTTTTTTTTTTTTTTTTTTT',
  ],
  paths: [
    // the old carriage lane from Riftmarch down to the manor court
    [[31, 0], [31, 10], [32, 20], [31, 29]],
    // footpath west to the Gloaming Mere
    [[30, 28], [21, 29], [17, 30]],
    // garden walk from the court to the Bower gate
    [[37, 37], [42, 37]],
  ],
  structures: [
    { kind: 'ruin', tx: 23, ty: 31 },
    { kind: 'tower', tx: 28, ty: 30 },
    { kind: 'ruin', tx: 33, ty: 31 },
    { kind: 'well', tx: 30, ty: 36 },
  ],
  portals: [{ id: 'north', tx: 30, ty: 0, w: 4, h: 2, facing: 'n', kind: 'edge', to: { map: 'rift.riftmarch', portal: 'south' } }],
  spawns: [
    { monster: 'duskhound', count: 8, cx: 14, cy: 14, r: 5 },
    { monster: 'duskhound', count: 5, cx: 30, cy: 22, r: 4 },
    { monster: 'duskhound', count: 6, cx: 12, cy: 42, r: 4 },
    { monster: 'gloamthorn', count: 8, cx: 48, cy: 14, r: 5 },
    { monster: 'gloamthorn', count: 6, cx: 12, cy: 28, r: 4 },
    { monster: 'dusk_sovereign', count: 1, cx: 50, cy: 37, r: 2 },
  ],
  nodes: [
    { id: 'shadow_fungus_1', kind: 'shadow_fungus', tx: 8, ty: 26 },
    { id: 'shadow_fungus_2', kind: 'shadow_fungus', tx: 54, ty: 26 },
    { id: 'shadow_fungus_3', kind: 'shadow_fungus', tx: 4, ty: 40 },
    { id: 'shadow_fungus_4', kind: 'shadow_fungus', tx: 59, ty: 40 },
    { id: 'sun_spring_1', kind: 'sun_spring', tx: 16, ty: 33 },
    { id: 'sun_spring_2', kind: 'sun_spring', tx: 8, ty: 40 },
    { id: 'sun_spring_3', kind: 'sun_spring', tx: 46, ty: 38 },
  ],
};

export default map;
