// GameController v2 (docs/CLIENT-v2.md §7): the only API the DOM may call. Implemented by MapScene; the same scene
// instance survives map restarts, so the UI holds it once. Feature engineers may ADD methods only by asking.
import type { Registry } from '../core/registry';
import type { FuseResult, SkillBook } from '../core/skillbook';
import type { MonsterRank, WeaponType } from '../core/types';
import type { CompiledMap, MapDef } from '../core/world/types';
import type { Session, Stats, WorldState } from '../game/session';

export type Outcome = { ok: boolean; message?: string };

export interface MinimapView {
  px: number;
  py: number;
  monsters: { x: number; y: number; rank: MonsterRank }[];
  npcs: { x: number; y: number }[];
  portals: { x: number; y: number; open: boolean; label: string }[];
  nodes: { x: number; y: number; ready: boolean }[];
  objects: { x: number; y: number; kind: string }[];
}

export interface TravelTargetView {
  key: string;
  mapId: string;
  name: string;
  region: string;
  cost: number;
}

export interface GameController {
  readonly session: Session;
  readonly reg: Registry;
  readonly book: SkillBook;
  stats(): Stats;
  /** -1 = basic attack. */
  castSlot(i: number): void;
  assignSlot(i: number, id: string | null): void;
  cooldown(id: string): { remain: number; total: number };
  usable(id: string): { ok: boolean; reason?: string };
  sparkWindow(id: string): 'none' | 'low' | 'good' | 'peak';
  /** AUTO battle switch: on = hunt the nearest monster and cast every equipped skill when in reach. */
  autoCastOn(): boolean;
  setAutoCastOn(on: boolean): void;
  morph(from: string, to: string): void;
  fuse(a: string, b: string): FuseResult;
  atAltar(): boolean;
  wearClass(id: string): Outcome;
  buyClassNode(classId: string, nodeId: string): Outcome;
  respecClass(classId: string): Outcome;
  setImprints(ids: string[]): Outcome;
  takeLesson(lessonId: string): Outcome;
  buyWeapon(w: WeaponType): Outcome;
  equipWeapon(w: WeaponType): Outcome;
  useItem(itemId: string): Outcome;
  sellItem(itemId: string, count: number): Outcome;
  isSafe(): boolean;
  map(): { def: MapDef; compiled: CompiledMap };
  world(): WorldState;
  minimap(): MinimapView;
  travelTargets(): TravelTargetView[];
  travel(key: string): Outcome;
  /** BFS over discovered portals + auto-walk, resumes after warps. */
  navigateTo(mapId: string): Outcome;
  setPaused(paused: boolean): void;
  newGame(): void;
}
