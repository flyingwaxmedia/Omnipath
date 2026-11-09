// World v2 content: every authored map and the two regions (SPEC §7.3). One file per map under src/data/maps/<region>/,
// named after the map id with dots turned into underscores (vale.quarry_depths.1 -> vale/quarry_depths_1.ts).
import type { MapDef, RegionDef } from '../core/world/types';

import valeHearthvale from './maps/vale/hearthvale';
import valeGreenmeadow from './maps/vale/greenmeadow';
import valeMirrorLake from './maps/vale/mirror_lake';
import valeLakeIslet from './maps/vale/lake_islet';
import valeWindcrestHill from './maps/vale/windcrest_hill';
import valeFallsHollow from './maps/vale/falls_hollow';
import valeGreystoneQuarry from './maps/vale/greystone_quarry';
import valeCollapsedShaft from './maps/vale/collapsed_shaft';
import valeQuarryDepths1 from './maps/vale/quarry_depths_1';
import valeQuarryDepths2 from './maps/vale/quarry_depths_2';
import valeQuarryDepths3 from './maps/vale/quarry_depths_3';
import valeGloomwood from './maps/vale/gloomwood';
import valeMoonlitGlade from './maps/vale/moonlit_glade';
import valeHollowBarrow1 from './maps/vale/hollow_barrow_1';
import valeHollowBarrow2 from './maps/vale/hollow_barrow_2';
import valeHollowBarrow3 from './maps/vale/hollow_barrow_3';
import valeBarrowVault from './maps/vale/barrow_vault';
import valeHollowBarrow4 from './maps/vale/hollow_barrow_4';
import valeCinderFields from './maps/vale/cinder_fields';
import valeEmberwatch from './maps/vale/emberwatch';
import valeStormbreakApproach from './maps/vale/stormbreak_approach';
import valeStormbreak from './maps/vale/stormbreak';

import riftRiftgateRoad from './maps/rift/riftgate_road';
import riftRiftmarch from './maps/rift/riftmarch';
import riftFrostShelf from './maps/rift/frost_shelf';
import riftBasaltSteps from './maps/rift/basalt_steps';
import riftThunderheadRidge from './maps/rift/thunderhead_ridge';
import riftDuskOrchard from './maps/rift/dusk_orchard';

/** Map ids per region, in SPEC §7.3 order. */
const VALE_MAPS = [
  'vale.hearthvale',
  'vale.greenmeadow',
  'vale.mirror_lake',
  'vale.lake_islet',
  'vale.windcrest_hill',
  'vale.falls_hollow',
  'vale.greystone_quarry',
  'vale.collapsed_shaft',
  'vale.quarry_depths.1',
  'vale.quarry_depths.2',
  'vale.quarry_depths.3',
  'vale.gloomwood',
  'vale.moonlit_glade',
  'vale.hollow_barrow.1',
  'vale.hollow_barrow.2',
  'vale.hollow_barrow.3',
  'vale.barrow_vault',
  'vale.hollow_barrow.4',
  'vale.cinder_fields',
  'vale.emberwatch',
  'vale.stormbreak_approach',
  'vale.stormbreak',
];

const RIFT_MAPS = [
  'rift.riftgate_road',
  'rift.riftmarch',
  'rift.frost_shelf',
  'rift.basalt_steps',
  'rift.thunderhead_ridge',
  'rift.dusk_orchard',
];

export const REGIONS: RegionDef[] = [
  { id: 'vale', name: 'Hearth Vale', levelBand: [1, 12], hub: 'vale.hearthvale', maps: VALE_MAPS },
  { id: 'rift', name: 'Riftmarch', levelBand: [11, 21], hub: 'rift.riftmarch', maps: RIFT_MAPS },
];

/** Every authored map (28), in SPEC §7.3 order. */
export const MAPS: MapDef[] = [
  valeHearthvale,
  valeGreenmeadow,
  valeMirrorLake,
  valeLakeIslet,
  valeWindcrestHill,
  valeFallsHollow,
  valeGreystoneQuarry,
  valeCollapsedShaft,
  valeQuarryDepths1,
  valeQuarryDepths2,
  valeQuarryDepths3,
  valeGloomwood,
  valeMoonlitGlade,
  valeHollowBarrow1,
  valeHollowBarrow2,
  valeHollowBarrow3,
  valeBarrowVault,
  valeHollowBarrow4,
  valeCinderFields,
  valeEmberwatch,
  valeStormbreakApproach,
  valeStormbreak,
  riftRiftgateRoad,
  riftRiftmarch,
  riftFrostShelf,
  riftBasaltSteps,
  riftThunderheadRidge,
  riftDuskOrchard,
];

const MAP_BY_ID: ReadonlyMap<string, MapDef> = new Map(MAPS.map((m) => [m.id, m]));

/** The authored map with this id, or undefined. */
export function mapById(id: string): MapDef | undefined {
  return MAP_BY_ID.get(id);
}
