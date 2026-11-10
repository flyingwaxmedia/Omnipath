// What a skill's `extra` word does at run time (docs/SPEC-v4.md §6.2: "the one effect a skill has beyond its
// element's own status"). Pure: no Phaser, no scene. Combat applies these rules; `extraHonoured` says, for any skill,
// which rule backs its declared word — tests/skill-promises.test.ts fails when a skill declares a word nothing backs,
// so no skill can promise something that does nothing.
//
//   a status word   the hit applies that status (the skill's `status`, its element's status, or the word itself)
//   crit            a higher crit chance (`critBonus`), a crit buff (buff stat), or — on a skill cast on yourself —
//                   EXTRA.critPct crit chance for as long as its effect lasts
//   execute         hits EXTRA.executePct harder against a foe below EXTRA.executeBelow of its HP
//   interrupt       its hit stops a common or elite mid wind-up
//   haste           a self-cast skill or a dash also quickens your step (EXTRA.hastePct for EXTRA.hasteMs)
//   cleanse         a self-cast skill also shakes off what ails you
//   heal            its hits give HP back (the `leech` rider, or holy's own smite); a mend heals by itself
//   leech           the `leech` rider
//   shield          a shield skill; a buff also raises a thin shell (EXTRA.shieldPct of max HP while the buff lasts);
//                   a zone keeps that shell on you while you stand in it
//   reposition      a dash or a blink moves you; a self-cast skill also breaks you free (Held, slowed)
//   mark            the foe is marked for EXTRA.markMs: your next hit with another skill on it is a critical hit
//                   (a class whose mechanic counts marks spends them its own way instead)
import type { SkillDef, SkillShape, StatusKind } from '../../core/types';

/** All [T]. */
export const EXTRA = {
  hastePct: 25,
  hasteMs: 4000,
  executeBelow: 0.3,
  executePct: 40,
  /** `crit` on a skill cast on yourself that is not a crit buff already (percentage points). */
  critPct: 25,
  /** `shield` on a buff or a zone: the thin shell (percent of max HP). */
  shieldPct: 8,
  /** `mark`: how long the foe stays marked (ms). */
  markMs: 4000,
} as const;

const STATUS_WORDS: ReadonlySet<string> = new Set<StatusKind>([
  'burn', 'slow', 'soak', 'stun', 'knockback', 'shock', 'bleed', 'smite', 'freeze', 'poison', 'pull', 'root', 'launch', 'expose', 'lure',
]);

/** Whether an `extra` word is a status (the hit applies it). */
export function isStatusWord(extra: string | undefined): extra is StatusKind {
  return extra !== undefined && STATUS_WORDS.has(extra);
}

/** Kinds that hit nothing by themselves and need no foe to be worth casting. */
export const SELF_KINDS: ReadonlySet<SkillShape['kind']> = new Set(['buff', 'mend', 'shield']);

/** Whether a skill is cast on yourself (no target is looked for, AUTO needs none). */
export function isSelfCast(skill: Pick<SkillDef, 'shape'>): boolean {
  const s = skill.shape;
  return SELF_KINDS.has(s.kind) || (s.kind === 'blink' && s.to === 'self') || (s.kind === 'zone' && s.range <= 0 && !!s.follow);
}

/** Whether a skill lands hits on foes (the per-hit words need one). */
function strikes(skill: Pick<SkillDef, 'shape' | 'power'>): boolean {
  const s = skill.shape;
  if (skill.power <= 0) return false;
  if (s.kind === 'buff' || s.kind === 'mend') return false;
  if (s.kind === 'shield') return s.burst !== undefined;
  if (s.kind === 'blink') return s.arrive !== undefined;
  return true;
}

type Promise = Pick<SkillDef, 'shape' | 'power' | 'extra' | 'status' | 'critBonus' | 'riders'>;

/**
 * The run-time rule behind a skill's declared `extra` (a short name of it), or null when nothing would happen.
 * `elementStatus` is the status of the skill's element (ElementDef.status).
 */
export function extraHonoured(skill: Promise, elementStatus?: StatusKind): string | null {
  const e = skill.extra;
  const k = skill.shape.kind;
  if (e === undefined || e === 'none') return 'none';
  if (isStatusWord(e)) return e === elementStatus ? 'element status' : strikes(skill) ? 'status on hit' : null;
  switch (e) {
    case 'crit':
      if ((skill.critBonus ?? 0) > 0 && strikes(skill)) return 'crit chance';
      if (skill.shape.kind === 'buff' && skill.shape.stat === 'crit') return 'crit buff';
      return isSelfCast(skill) ? 'crit while it lasts' : null;
    case 'execute':
      return strikes(skill) ? 'execute' : null;
    case 'interrupt':
      return strikes(skill) ? 'interrupt' : null;
    case 'mark':
      return strikes(skill) ? 'mark' : null;
    case 'haste':
      return isSelfCast(skill) || k === 'dash' ? 'haste' : null;
    case 'cleanse':
      return isSelfCast(skill) ? 'cleanse' : null;
    case 'heal':
      if (k === 'mend') return 'mend';
      return strikes(skill) && ((skill.riders?.leech ?? 0) > 0 || elementStatus === 'smite') ? 'heal on hit' : null;
    case 'leech':
      return strikes(skill) && (skill.riders?.leech ?? 0) > 0 ? 'leech' : null;
    case 'shield':
      return k === 'shield' || k === 'buff' || k === 'zone' ? 'shell' : null;
    case 'reposition':
      return k === 'dash' || k === 'blink' ? 'moves you' : isSelfCast(skill) ? 'breaks free' : null;
    default:
      return null;
  }
}

/** How long a self-cast skill's effect lasts (ms): what `crit` and `shield` on it last for. */
export function selfEffectMs(shape: SkillShape): number {
  if (shape.kind === 'buff') return shape.duration;
  if (shape.kind === 'shield' || shape.kind === 'zone') return shape.durationMs;
  if (shape.kind === 'mend') return shape.overMs ?? EXTRA.hasteMs;
  return EXTRA.hasteMs;
}
