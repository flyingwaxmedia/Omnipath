import type { Registry } from '../core/registry';
import type { FuseResult, SkillBook } from '../core/skillbook';
import type { WeaponType } from '../core/types';
import type { Session, Stats } from '../game/session';

/** What the DOM UI may ask of the running game. */
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
  morph(from: string, to: string): void;
  fuse(a: string, b: string): FuseResult;
  setActiveClass(id: string | null): void;
  buyWeapon(w: WeaponType): void;
  equipWeapon(w: WeaponType): void;
  eatFish(): void;
  setPaused(paused: boolean): void;
  newGame(): void;
}
