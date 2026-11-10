// The class mechanic at run time (docs/SPEC-v4.md §3.3, §3.6; core engine: src/core/mechanics.ts). The MechanicState
// lives here, in the game layer (it is not saved): Combat feeds what happens (every skill use, basic attacks
// included, hits, kills, ticks, damage taken …) and applies what comes out (boosts on the cast, statuses, stored
// damage, cooldown resets, placed and removed objects). Phaser-free, so the wiring is unit-tested
// (tests/game-mechanic.test.ts). One instance lives for the whole run (the Session owns it): the state survives a
// panel pause and resets on a map change, on death and whenever the worn class (or its Level 8 upgrade) changes.
import { CLASS } from '../../core/classes';
import {
  type AutoAdvice,
  type AutoView,
  type MechanicEffect,
  type MechanicEvent,
  type MechanicState,
  type MechanicView,
  type SkillUse,
  type UseContext,
  type UseResult,
  autoAdvice,
  initMechanic,
  mechanicStats,
  mechanicView,
  previewBoost,
  resolveSkill,
  skillLocked,
  skillUse,
  stepMechanic,
  useSkill,
} from '../../core/mechanics';
import type { Registry } from '../../core/registry';
import type { SkillBook } from '../../core/skillbook';
import type { CastBoost, ClassDef, ClassMechanic, MechanicStat, SkillDef } from '../../core/types';

/** What the runtime needs from the session (structural, so tests pass a plain object). */
export interface MechanicHost {
  readonly reg: Registry;
  readonly book: SkillBook;
}

/** Stat changes of the mechanic right now, with every key present (percent; crit in points). */
export type MechanicStats = Record<MechanicStat, number>;

const NO_STATS: MechanicStats = { hp: 0, sp: 0, atk: 0, matk: 0, crit: 0, speed: 0, def: 0, attackSpeed: 0, damage: 0, size: 0 };

export class MechanicRuntime {
  state: MechanicState = { kind: 'none' };
  /** Identity of the mechanic the state belongs to: `<classId>@<base | upgraded>`. */
  private key = '';
  /** Every effect the engine reports, in order (Combat applies them; the bus announces them). */
  onEffects: (effects: readonly MechanicEffect[]) => void = () => undefined;

  constructor(private readonly host: MechanicHost) {}

  /** The worn class, when it has a mechanic. */
  cls(): ClassDef | undefined {
    const id = this.host.book.state.worn;
    return id ? this.host.reg.classDef(id) : undefined;
  }

  /** The worn class's mechanic at its Class Level (undefined: no class, a class without one, or a form). */
  mech(): ClassMechanic | undefined {
    const m = this.host.book.mechanic();
    this.sync(m);
    return m;
  }

  /** A fresh state whenever the mechanic's identity changed (class change, Level 8 upgrade). */
  private sync(m: ClassMechanic | undefined): void {
    const id = this.host.book.state.worn;
    const rank = id ? (this.host.book.state.classes[id]?.rank ?? 0) : 0;
    const key = m && id ? `${id}@${rank >= CLASS.mechanicUpgradeAt ? 'up' : 'base'}` : '';
    if (key === this.key) return;
    this.key = key;
    this.state = initMechanic(m);
  }

  /** Back to the initial state (map change, death, class change). No effects are reported. */
  reset(): void {
    this.state = initMechanic(this.mech());
  }

  /**
   * The facts the engine reads about one use of bar skill `barId` that casts `skill` right now (a stance may remap
   * it): the use keeps the bar slot's id, and counts as a kit skill when the bar skill (or the authored skill it is
   * a variant of) is in the worn class's kit.
   */
  useOf(barId: string, skill: SkillDef): SkillUse {
    const cls = this.cls();
    const base = this.host.reg.baseOf(barId) ?? barId;
    const kit = !!cls?.kit && (cls.kit.includes(barId) || cls.kit.includes(base));
    return { ...skillUse(cls, skill), id: kit && !cls!.kit!.includes(barId) ? base : barId, kit };
  }

  /** Feeds one event; returns the effects (already handed to onEffects). */
  step(ev: MechanicEvent): MechanicEffect[] {
    const m = this.mech();
    if (!m) return [];
    const out = stepMechanic(m, this.state, ev);
    this.state = out.state;
    if (out.effects.length) this.onEffects(out.effects);
    return out.effects;
  }

  /** Commits one skill use (basic attacks included). A locked use changes nothing. */
  use(use: SkillUse, ctx: UseContext): UseResult {
    const m = this.mech();
    const out = useSkill(m, this.state, use, ctx);
    if (!m || out.locked) return out;
    this.state = out.state;
    if (out.effects.length) this.onEffects(out.effects);
    return out;
  }

  /** What `use` would gain right now, without committing anything. */
  preview(use: SkillUse, ctx: UseContext): CastBoost {
    return previewBoost(this.mech(), this.state, use, ctx);
  }

  /** A kit skill whose gauge is not there yet. */
  locked(skillId: string): boolean {
    return skillLocked(this.mech(), this.state, skillId);
  }

  /** The SkillDef id a bar skill casts right now (stance B remap), else itself. */
  resolve(skillId: string): string {
    return resolveSkill(this.mech(), this.state, skillId);
  }

  /** The stance button: flips the stance (a held stance turns on). False when nothing changed. */
  swap(): boolean {
    const m = this.mech();
    if (m?.kind !== 'stance') return false;
    return this.step({ type: 'swap' }).some((e) => e.type === 'stance');
  }

  /** Whether the stance button does anything (a tap or hold stance; self-turning stances have none). */
  canSwap(): boolean {
    const m = this.mech();
    return m?.kind === 'stance' && (m.swap === 'tap' || 'hold' in m.swap);
  }

  stats(nearLevel?: number | null): MechanicStats {
    const m = this.mech();
    return m ? { ...NO_STATS, ...mechanicStats(m, this.state, nearLevel) } : NO_STATS;
  }

  view(target?: string): MechanicView | null {
    return mechanicView(this.mech(), this.state, target);
  }

  advice(view: AutoView): AutoAdvice {
    return autoAdvice(this.mech(), this.state, view);
  }

  /** The level of the mechanic object `mech` (zone mechanics), or 0 when it is gone. */
  objectLevel(mech: number): number {
    return this.state.kind === 'zone' ? (this.state.objects.find((o) => o.id === mech)?.level ?? 0) : 0;
  }

  /** How far "near" reaches for a zone mechanic (tiles), or 0. */
  nearTiles(): number {
    const m = this.mech();
    return m?.kind === 'zone' ? m.near.tiles : 0;
  }

  /** How long a zone mechanic's objects stand (ms; 0 = until replaced or used up), or null for other mechanics. */
  objectLifeMs(): number | null {
    const m = this.mech();
    return m?.kind === 'zone' ? m.lifeMs : null;
  }
}
