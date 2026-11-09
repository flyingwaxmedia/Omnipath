// Monster technique hit tests on the telegraph geometry (docs/VFX.md §8.1, §13 items 1 and 4). Phaser-free, so the
// VFX hitbox check (tests/vfx-tell.test.ts) runs the very predicates MonsterSkills uses: the drawn tell and the hit
// area cannot drift apart.
import type { TellShape } from '../events';

/** The one player body radius for every hit test (SkillSystem re-exports it; Combat separation uses it too). */
export const PLAYER_R = 12;

type Shape<K extends TellShape['kind']> = Extract<TellShape, { kind: K }>;
type P = { x: number; y: number };

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Zone (nova, spin): the player's feet inside the 0.65 ellipse. */
export function inZone(g: TellShape, p: P): boolean {
  const z = g as Shape<'zone'>;
  return Math.hypot((p.x - z.x) / z.rx, (p.y - z.y) / z.ry) <= 1;
}

/** Cone (strike): the player's body overlaps the sector, or touches the caster (radius `casterR`). */
export function inCone(g: TellShape, p: P, casterR: number): boolean {
  const c = g as Shape<'cone'>;
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  let diff = Math.atan2(p.y - c.y, p.x - c.x) - c.ang;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return d <= c.r + PLAYER_R && (Math.abs(diff) <= c.arc / 2 + Math.atan2(PLAYER_R, Math.max(1, d)) || d < casterR + PLAYER_R);
}

/** Range (chain): the player's body within reach. */
export function inRange(g: TellShape, p: P): boolean {
  const r = g as Shape<'range'>;
  return Math.hypot(p.x - r.x, p.y - r.y) <= r.r + PLAYER_R;
}

/** Lane (dash): the player's body overlaps the swept capsule (MonsterSkills tests the part swept so far). */
export function inLane(g: TellShape, p: P): boolean {
  const l = g as Shape<'lane'>;
  return distToSegment(p.x, p.y, l.x0, l.y0, l.x1, l.y1) <= l.width / 2 + PLAYER_R;
}
