// A mechanic's CastBoost applied to a skill's shape (docs/SPEC-v4.md §3.3; core/types.ts CastBoost): size (radius,
// range, arc, projectile size), speed (projectiles), extra pierce, extra pulses / hits. Power, crit, cost, status and
// repeat are per cast and live on the Cast (SkillSystem / Combat). Pure; tests/game-mechanic.test.ts.
import type { CastBoost, SkillDef, SkillShape } from '../../core/types';

const scale = (n: number, pct: number): number => Math.max(1, Math.round(n * (1 + pct / 100)));

/** `shape` with a boost's size / speed / pierce / pulses applied. The same object when nothing changes. */
export function boostShape(shape: SkillShape, boost: CastBoost): SkillShape {
  const size = boost.sizePct ?? 0;
  const speed = boost.speedPct ?? 0;
  const pierce = boost.pierce ?? 0;
  const pulses = Math.round(boost.pulses ?? 0);
  if (!size && !speed && !pierce && !pulses) return shape;
  switch (shape.kind) {
    case 'strike':
      return { ...shape, range: scale(shape.range, size), arc: Math.min(360, scale(shape.arc, size)), ...(pulses ? { hits: Math.max(1, (shape.hits ?? 1) + pulses) } : {}) };
    case 'spin':
      return { ...shape, radius: scale(shape.radius, size), ...(pulses ? { pulses: Math.max(1, (shape.pulses ?? 1) + pulses) } : {}) };
    case 'projectile':
      return {
        ...shape,
        range: scale(shape.range, size),
        speed: scale(shape.speed, speed),
        ...(size ? { size: scale(shape.size ?? 12, size) } : {}),
        ...(pierce ? { pierce: Math.max(0, (shape.pierce ?? 0) + pierce) } : {}),
      };
    case 'dash':
      return { ...shape, width: shape.width > 0 ? scale(shape.width, size) : shape.width };
    case 'nova':
      return { ...shape, radius: scale(shape.radius, size) };
    case 'chain':
      return { ...shape, range: scale(shape.range, size) };
    case 'zone':
      return { ...shape, radius: scale(shape.radius, size), ...(shape.line ? { line: { length: scale(shape.line.length, size) } } : {}) };
    case 'blink':
      return shape.arrive ? { ...shape, arrive: { radius: scale(shape.arrive.radius, size) } } : shape;
    case 'shield':
      return shape.burst ? { ...shape, burst: { radius: scale(shape.burst.radius, size) } } : shape;
    case 'buff':
    case 'mend':
      return shape;
  }
}

/** The skill a boosted cast runs: same id, tags and numbers, the boosted shape. The same object when unchanged. */
export function boostSkill(skill: SkillDef, boost: CastBoost): SkillDef {
  const shape = boostShape(skill.shape, boost);
  return shape === skill.shape ? skill : { ...skill, shape };
}

/** A boost with a mechanic's standing size bonus (mechanicStats `size`, percent) folded in. */
export function withSize(boost: CastBoost, sizePct: number): CastBoost {
  return sizePct ? { ...boost, sizePct: (boost.sizePct ?? 0) + sizePct } : boost;
}
