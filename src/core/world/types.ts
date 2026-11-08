// World data model (v2). Pure data — shared by the Phaser client and a future server.
// Authoring rules live in docs/SPEC-v2.md §World.
import type { ElementId, ShapeKind } from '../types';

export type MapKind = 'town' | 'outpost' | 'field' | 'dungeon' | 'arena' | 'secret';

/** Sets what the macro chars '.' and ',' mean, the default tree kind and decor palette. */
export type Biome =
  | 'meadow'
  | 'lake'
  | 'hill'
  | 'quarry'
  | 'grove'
  | 'ember'
  | 'plateau'
  | 'town'
  | 'cave'
  | 'crypt'
  | 'glade'
  | 'frost'
  | 'basalt'
  | 'storm'
  | 'dusk';

export type Facing = 'n' | 's' | 'e' | 'w';

export interface PortalGate {
  /** Number of PRIMAL elements the player must have attuned. */
  elementsKnown?: number;
  /** Every listed element must be attuned. */
  elements?: ElementId[];
  /** SkillBook flag that must be >= 1. */
  flag?: string;
  /** Shown on the gate and the world map while closed. */
  hint: string;
}

/** Hidden portals stay invisible until the player casts a matching skill within 3 tiles. */
export interface PortalReveal {
  tag?: string;
  element?: ElementId;
  shape?: ShapeKind;
  /** Flavour of the blocker drawn on top until revealed. */
  look: 'shimmer' | 'cracked_rock' | 'brambles' | 'fog' | 'glyph' | 'rift';
  hint: string;
}

export interface PortalDef {
  /** Unique within the map, e.g. 'east'. Global id is `<mapId>#<id>`. */
  id: string;
  /** Top-left tile of the trigger rect. */
  tx: number;
  ty: number;
  w: number;
  h: number;
  /** Direction the portal leads OUT of this map. Arrivals land 2 tiles inward (opposite direction). */
  facing: Facing;
  kind: 'edge' | 'door' | 'stairs' | 'hidden';
  to: { map: string; portal: string };
  /** Floating label override; default "To <dest name>". */
  label?: string;
  gate?: PortalGate;
  reveal?: PortalReveal;
  /** One-way portals have no return link (e.g. drops). */
  oneWay?: boolean;
}

export interface SpawnDef {
  monster: string;
  count: number;
  /** Centre tile and radius in tiles. */
  cx: number;
  cy: number;
  r: number;
}

export type NodeKind =
  | 'ore'
  | 'fishing'
  | 'herb'
  | 'ember_vent'
  | 'wind_chime'
  | 'storm_tree'
  | 'shadow_fungus'
  | 'sun_spring'
  | 'frost_crystal';

export interface NodeDef {
  id: string;
  kind: NodeKind;
  tx: number;
  ty: number;
}

export interface NpcPlacement {
  npc: string;
  tx: number;
  ty: number;
}

export type ObjectKind =
  | 'waystone'
  | 'altar'
  | 'wind_shrine'
  | 'obelisk'
  | 'signpost'
  | 'chest'
  | 'statue'
  | 'campfire';

export interface ObjectDef {
  /** Unique within the map. */
  id: string;
  kind: ObjectKind;
  tx: number;
  ty: number;
  /** Signposts / statues: text shown. */
  text?: string;
  /** Chests: one-time loot. */
  loot?: { coins?: number; items?: Record<string, number>; essences?: Record<string, number>; hint?: string };
}

export type StructureKind = 'smithy' | 'chapel' | 'hut' | 'hall' | 'house' | 'tent' | 'ruin' | 'tower' | 'well';

export interface StructureDef {
  kind: StructureKind;
  /** Top-left tile of the footprint. Footprints: smithy 4x3, chapel 4x4, hut 3x3, hall 6x4, house 3x3, tent 3x2, ruin 4x3, tower 2x3, well 1x1. */
  tx: number;
  ty: number;
}

export interface MapDef {
  /** Dotted slug '<region>.<place>[.<floor>]'. */
  id: string;
  name: string;
  kind: MapKind;
  region: string;
  biome: Biome;
  seed: number;
  /** Monster level band, null for safe maps. */
  levelBand: [number, number] | null;
  safety: 'safe' | 'pve';
  /** Position on the region's world-map grid. */
  worldCell: { x: number; y: number };
  /**
   * Macro grid. Each character is a 2x2 tile block, so a map is
   * (layout[0].length * 2) x (layout.length * 2) tiles. All rows must be equal length.
   * Legend in docs/SPEC-v2.md (MACRO_LEGEND in src/core/world/compile.ts).
   */
  layout: string[];
  /** Tile-coordinate polylines painted as 2-wide dirt paths (never over walls/water; water becomes bridge). */
  paths?: [number, number][][];
  structures?: StructureDef[];
  portals: PortalDef[];
  spawns: SpawnDef[];
  nodes?: NodeDef[];
  npcs?: NpcPlacement[];
  objects?: ObjectDef[];
  /** One-line description of the flag landmark (shown in the world map). */
  landmark?: string;
  /** Multiplier on biome decor density (default 1). */
  decor?: number;
  /** Optional flags: 'dark' (dim lighting), 'night'. */
  flags?: ('dark' | 'indoor')[];
}

export interface RegionDef {
  id: string;
  name: string;
  levelBand: [number, number];
  hub: string;
  maps: string[];
}

export type TileId = number;

export type PropKind =
  | 'tree'
  | 'darktree'
  | 'deadtree'
  | 'pine'
  | 'frostpine'
  | 'bush'
  | 'rock'
  | 'boulder'
  | 'crystal'
  | 'stalagmite'
  | 'tombstone'
  | 'mushroom'
  | 'duskwillow'
  | 'basalt_spire'
  | 'reeds';

export interface PropInst {
  kind: PropKind;
  tx: number;
  ty: number;
}

/** Collision bitflags on CompiledMap.coll. */
export const COLL = {
  BLOCK: 1,
  WATER: 2,
  PORTAL: 4,
  SAFE: 8,
} as const;

export interface CompiledMap {
  def: MapDef;
  w: number;
  h: number;
  /** Tile index per cell (row-major). */
  ground: Uint8Array;
  /** COLL bitflags per cell. */
  coll: Uint8Array;
  props: PropInst[];
  /** Arrival position (px) for each portal id in THIS map. */
  arrivals: Record<string, { x: number; y: number }>;
  /** Default spawn (px): first waystone, else the map centre's nearest walkable tile. */
  spawn: { x: number; y: number };
}
