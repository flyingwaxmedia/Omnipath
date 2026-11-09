// Echoes (docs/SPEC-v2.md §4.3): monster techniques with `echo: { marks }` the player learns by
// witnessing them. The game marks a technique witnessed on a monster instance; killing that instance
// adds a mark (SkillBook.witness). Once marks reach the need, the echo is learned if the player owns
// an *anchor* — a skill of the same shape kind at rank >= 3 — else it is blocked and the marks kept.
// Pure rules over the Registry and a small read-only context; the SkillBook owns the marks.
import type { Registry } from './registry';
import type { ShapeKind } from './types';

/** Rank an owned skill needs to anchor an echo of the same shape kind. */
export const ECHO_ANCHOR_RANK = 3;

/** What echo rules may ask about the player. Implemented by the SkillBook. */
export interface EchoContext {
  /** Rank of a known skill (0 if unknown). */
  rank(id: string): number;
  /** Every known skill id (authored, variants and merges). */
  known(): string[];
}

/** Result of adding witness marks toward an echo. */
export interface WitnessOutcome {
  /**
   * 'learned': marks reached the need and an anchor is owned — learn the echo now.
   * 'progress': more marks are needed.
   * 'blocked': marks reached the need but no anchor is owned; marks are kept (whisper `anchorShape`).
   */
  status: 'learned' | 'progress' | 'blocked';
  /** Marks needed to learn the echo (see echoNeed). */
  need: number;
  /** Shape kind an anchor must have (the echo's own shape kind). */
  anchorShape: ShapeKind;
}

/**
 * Witness marks needed to learn `skillId` as an echo: the lowest `echo.marks` among the monsters
 * using it as a technique, so the easiest teacher sets the bar. Null when no monster teaches it.
 */
export function echoNeed(reg: Registry, skillId: string): number | null {
  let need: number | null = null;
  for (const { technique } of reg.techniqueSources(skillId)) {
    if (technique.echo) need = need === null ? technique.echo.marks : Math.min(need, technique.echo.marks);
  }
  return need;
}

/**
 * The owned skill anchoring echo `skillId`: among known skills with the echo's shape kind at rank
 * >= ECHO_ANCHOR_RANK, the highest-ranked one (ties: lowest id). The echo itself and its variants
 * never anchor it. Null when none qualifies or `skillId` is not a skill.
 */
export function anchorFor(reg: Registry, ctx: EchoContext, skillId: string): string | null {
  const shape = reg.skill(skillId)?.shape.kind;
  if (!shape) return null;
  let best: { id: string; rank: number } | null = null;
  for (const id of ctx.known()) {
    const def = reg.skill(id);
    if (!def || def.shape.kind !== shape || reg.baseOf(id) === skillId) continue;
    const rank = ctx.rank(id);
    if (rank < ECHO_ANCHOR_RANK) continue;
    if (!best || rank > best.rank || (rank === best.rank && id < best.id)) best = { id, rank };
  }
  return best?.id ?? null;
}

/**
 * What `marks` total witness marks (including the one just earned) mean for echo `skillId`:
 * 'progress' below the need; at or above it, 'learned' if anchorFor finds an anchor, else 'blocked'.
 * Does not check whether the echo is already known (callers skip known echoes).
 * @throws Error if `skillId` is not a skill, or no monster teaches it as an echo.
 */
export function witnessOutcome(reg: Registry, ctx: EchoContext, skillId: string, marks: number): WitnessOutcome {
  const def = reg.skill(skillId);
  if (!def) throw new Error(`witnessOutcome: unknown skill "${skillId}"`);
  const need = echoNeed(reg, skillId);
  if (need === null) throw new Error(`witnessOutcome: "${skillId}" is not taught as an echo by any monster`);
  const anchorShape = def.shape.kind;
  if (marks < need) return { status: 'progress', need, anchorShape };
  return { status: anchorFor(reg, ctx, skillId) !== null ? 'learned' : 'blocked', need, anchorShape };
}
