// Pure actor rules (actors lane): animation keys and rates, "is this monster hunting the player", layout of the
// status icons. No Phaser, no DOM — tested in node (tests/actors.test.ts).
import type { MonsterRank } from '../../core/types';

/** Animation key registered for a monster texture (registerActorAnims). */
export const monsterAnimKey = (tex: string): string => `${tex}_anim`;

/** Species that fly or float: their 2-frame loop always runs (wings, hover) and they never squash. */
export const HOVER_MONSTERS: ReadonlySet<string> = new Set([
  'mon_gustling',
  'mon_sparkbug',
  'mon_ashfly',
  'mon_moonmoth',
  'mon_cloudray',
  'mon_thunderwing',
  'mon_tempest_drake',
  'mon_hollowshade',
  'mon_cairn_wraith',
  'mon_puddlewisp',
  'mon_frostling',
  'mon_hollow_regent',
  'mon_dusk_sovereign',
]);

/**
 * Playback speed of a monster's 2-frame loop: walk frames at full speed while it moves (faster while it chases the
 * player, faster still when a warden is enraged), a slow breath when it stands still — except flyers, whose wings
 * never stop.
 */
export function monsterAnimRate(s: { moving: boolean; chasing: boolean; enraged: boolean; hover: boolean }): number {
  if (!s.moving) return s.hover ? 1 : 0.45;
  return (s.chasing ? 1.5 : 1) * (s.enraged ? 1.25 : 1);
}

/** Aggro radius per rank (mirrors Combat.updateMonster): an aggressive monster inside it hunts the player. */
export const AGGRO_RADIUS: Readonly<Record<MonsterRank, number>> = { warden: 220, elite: 170, common: 140 };

/** True when a monster is actively hunting the player (it gets a chaser chevron). */
export function isChasing(m: {
  alive: boolean;
  returning: boolean;
  provoked: boolean;
  aggressive: boolean;
  rank: MonsterRank;
  /** Distance to the player (px). */
  dist: number;
  /** The player is dead or still under spawn protection. */
  safe: boolean;
}): boolean {
  if (!m.alive || m.returning || m.safe) return false;
  return m.provoked || (m.aggressive && m.dist < AGGRO_RADIUS[m.rank]);
}

/** Left x of each icon in a centred row of `n` icons of width `size` with `gap` between them. */
export function iconRow(cx: number, n: number, size: number, gap: number): number[] {
  const total = n * size + Math.max(0, n - 1) * gap;
  const x0 = Math.round(cx - total / 2);
  return Array.from({ length: n }, (_, i) => x0 + i * (size + gap));
}

/** Whole-pixel bob offset (art px) for a floating marker: amplitude `amp`, period `periodMs`. */
export function bob(now: number, periodMs: number, amp: number, phase = 0): number {
  return Math.round(Math.sin((now / periodMs) * Math.PI * 2 + phase) * amp);
}
