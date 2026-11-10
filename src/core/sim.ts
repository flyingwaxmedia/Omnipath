// Class rotation simulation (docs/SPEC-v4.md §3.5): a core-only, deterministic harness that plays one class for
// 60 s against a standard dummy pack and reports its sustained damage. tests/class-sim.test.ts uses it to hold
// every class to the same band ("rarity = more involved, not stronger"): AUTO within ±10% of the median of the four
// Commons, a manual script at most +25%.
//
// It is a model, not the game: there is no map. Positions are replaced by a target count per shape (TARGETS below),
// travel and animation by the skill's own cast times and cooldowns, and the pack hits back at a flat rate so that
// shields, heals and "damage taken" meters have something to work with. Everything else is the real rules:
// computeDamage, the mechanic engine with its AUTO rules, the class bonus at its level, the hit clamp.
import { CLASS_SIM, baseStats, monsterStats } from './balance';
import { CLASS, classBonusAt, classMechanic, classRarity, isKitClass, kitSkillsAt } from './classes';
import { STATUS, computeDamage, statusFor, type Attacker } from './combat';
import { shapeHits } from './compose';
import {
  autoAdvice,
  initMechanic,
  isEmptyBoost,
  mechanicStats,
  mechanicView,
  previewBoost,
  resolveSkill,
  skillLocked,
  skillUse,
  stepMechanic,
  useSkill,
  type MechanicEffect,
  type MechanicEvent,
  type MechanicState,
  type MechanicView,
  type SkillUse,
} from './mechanics';
import type { Registry } from './registry';
import { weaponOk } from './requirements';
import { mulberry32 } from './rng';
import type { CastBoost, ClassDef, ClassMechanic, MonsterRank, Rarity, SkillDef, SkillShape, StatusKind, WeaponType } from './types';

/** The weapon numbers the simulation needs (src/data/weapons.ts WeaponDef has them all). */
export interface SimWeapon {
  id: WeaponType;
  atk: number;
  matk: number;
  crit: number;
  /** Basic attack delay (ms). */
  delay: number;
  /** Basic attack SkillDef id. */
  basic: string;
}

/** Simulation tuning. All [T]; a balance pass changes these, never the loop. */
export const SIM = {
  stepMs: 50,
  /** Rank of every skill on the bar (clamped to the skill's maxRank). */
  skillRank: 5,
  /** The pack hits the player for this much of max HP per second (shields soak it first). */
  incomingPctPerSec: 1.5,
  /** SP regained per second in combat: maxSp × spRegenPct / 100 + spRegenFlat (the game's combat regen). */
  spRegenPct: 2,
  spRegenFlat: 0.5,
  /** The player walks during the first `moveShare` of every `moveCycleMs`, at `tilesPerSec`. */
  moveShare: 0.25,
  moveCycleMs: 2000,
  tilesPerSec: 4,
  /** Default lockout after a cast when the skill names none (ms), as in the game. */
  afterCastMs: 250,
  /** How long a status the simulation applies lasts when it has no own length (ms). */
  statusMs: 3000,
  /** A size boost of at least this many percent reaches one more foe with an area skill. */
  sizePerTarget: 30,
  /** AUTO heals below this HP percent (SPEC-v4 §6.1). */
  mendBelowPct: 60,
} as const;

/** The standard dummy pack: 1 elite + 4 commons, neutral element, medium size. Index 0 is the main target. */
export const SIM_PACK: readonly MonsterRank[] = ['elite', 'common', 'common', 'common', 'common'];

/** What a policy sees each time the player may act. */
export interface SimView {
  /** ms since the fight began. */
  now: number;
  /** Bar skills castable this instant, in bar order, with what each would gain from the mechanic. */
  castable: readonly { use: SkillUse; skill: SkillDef; boost: CastBoost; expected: number }[];
  /** The mechanic's AUTO advice for this instant. */
  advice: ReturnType<typeof autoAdvice>;
  hpPct: number;
  mechanic: MechanicView | null;
}

/** Picks the next action: a castable skill id, 'swap' (the stance button), or null for a basic attack / waiting. */
export type SimPolicy = (view: SimView) => string | 'swap' | null;

export interface SimOptions {
  reg: Registry;
  /** The class to wear (omit for a bare weapon with `bar` skills only). */
  cls?: ClassDef;
  weapon: SimWeapon;
  /** Character and pack level (default CLASS_SIM.level). */
  level?: number;
  /** Class Level (default CLASS.maxLevel). */
  classLevel?: number;
  seconds?: number;
  seed?: number;
  /** 'auto' (default): the mechanic's AUTO rule; 'manual': the greedy script; or your own policy. */
  policy?: 'auto' | 'manual' | SimPolicy;
  /** Skills on the bar besides the basic attack (default: the kit skills the class level has unlocked). */
  bar?: readonly string[];
}

export interface SimResult {
  /** Total damage dealt to the pack. */
  damage: number;
  /** damage ÷ seconds. */
  dps: number;
  seconds: number;
  casts: Record<string, number>;
  hits: number;
  kills: number;
  /** How often each mechanic effect fired (finisher, spent, cashIn, stance, placed, …). */
  effects: Partial<Record<MechanicEffect['type'], number>>;
  /** The mechanic widget as the fight ended. */
  mechanic: MechanicView | null;
}

// ------------------------------------------------------------------ the model

/** Foes one hit instance of a shape reaches in the pack, before size boosts. */
function baseTargets(shape: SkillShape): number {
  const byRadius = (r: number): number => (r >= 90 ? 5 : r >= 60 ? 4 : 3);
  switch (shape.kind) {
    case 'strike':
      return shape.arc >= 150 ? 3 : shape.arc >= 90 ? 2 : 1;
    case 'spin':
      return byRadius(shape.radius + 10);
    case 'projectile':
      return shape.radial ? Math.min(5, shape.count ?? 1) : 1 + Math.min(4, shape.pierce ?? 0);
    case 'dash':
      return shape.width >= 40 ? 3 : 2;
    case 'nova':
    case 'zone':
      return byRadius(shape.radius);
    case 'chain':
      return 1 + shape.jumps;
    case 'blink':
      return shape.arrive ? byRadius(shape.arrive.radius) - 1 : 0;
    case 'shield':
      return shape.burst ? byRadius(shape.burst.radius) - 1 : 0;
    case 'buff':
    case 'mend':
      return 0;
  }
}

/** [hit instances on each reached foe, foes reached] of one cast with a boost. */
function castPattern(skill: SkillDef, boost: CastBoost): { rounds: number; targets: number } {
  const shape = skill.shape;
  let targets = baseTargets(shape);
  if (targets > 0 && shape.kind !== 'strike' && shape.kind !== 'chain' && (boost.sizePct ?? 0) >= SIM.sizePerTarget) targets++;
  if (shape.kind === 'projectile' && !shape.radial) targets += boost.pierce ?? 0;
  targets = Math.min(SIM_PACK.length, targets);
  let rounds = shape.kind === 'chain' || (shape.kind === 'projectile' && shape.radial) ? 1 : shapeHits(shape);
  if (shape.kind === 'strike' || shape.kind === 'spin') rounds += boost.pulses ?? 0;
  if (skill.riders?.reprise) rounds *= 2;
  return { rounds: targets > 0 ? rounds : 0, targets };
}

/** Rough damage of a cast, for the manual script's ranking only. */
function expectedDamage(skill: SkillDef, boost: CastBoost): number {
  const { rounds, targets } = castPattern(skill, boost);
  return skill.power * rounds * targets * (1 + (boost.powerPct ?? 0) / 100) * (boost.crit ? 1.5 : 1) * (1 + (boost.repeat ?? 0));
}

interface Foe {
  id: string;
  rank: MonsterRank;
  hp: number;
  maxHp: number;
  def: number;
  /** Status -> the time it ends. */
  statuses: Map<StatusKind, number>;
}

const autoPolicy: SimPolicy = (view) => {
  const d = view.advice.do;
  if (d?.type === 'swap') return 'swap';
  if (d?.type === 'cast' && view.castable.some((c) => c.use.id === d.skill)) return d.skill;
  if (d?.type === 'basic') return null;
  // "AUTO casts every equipped skill when in reach": the first castable bar skill the mechanic does not hold back.
  return view.castable.find((c) => !view.advice.hold.includes(c.use.id))?.use.id ?? null;
};

/** The manual script: follows the mechanic's must-dos, otherwise casts whatever is worth most right now. */
const manualPolicy: SimPolicy = (view) => {
  const d = view.advice.do;
  if (d?.type === 'swap') return 'swap';
  const free = view.castable.filter((c) => !view.advice.hold.includes(c.use.id));
  if (free.length === 0) return d?.type === 'cast' && view.castable.some((c) => c.use.id === d.skill) ? d.skill : null;
  // A boost is on offer: spend it on the best skill it fits, not the first.
  const boosted = free.filter((c) => !isEmptyBoost(c.boost));
  const pool = boosted.length > 0 ? boosted : free;
  let best = pool[0];
  for (const c of pool) if (c.expected > best.expected) best = c;
  if (d?.type === 'basic' && boosted.length === 0) return null;
  return best.use.id;
};

/**
 * Plays one class (or a bare bar) against SIM_PACK and returns its sustained damage. Deterministic for a seed;
 * never touches the registry or the class data.
 */
export function simulateClass(opts: SimOptions): SimResult {
  const { reg, cls, weapon } = opts;
  const level = opts.level ?? CLASS_SIM.level;
  const classLevel = opts.classLevel ?? CLASS.maxLevel;
  const seconds = opts.seconds ?? CLASS_SIM.seconds;
  const rng = mulberry32(opts.seed ?? 1);
  const policy: SimPolicy = typeof opts.policy === 'function' ? opts.policy : opts.policy === 'manual' ? manualPolicy : autoPolicy;
  const mech: ClassMechanic | undefined = cls ? classMechanic(cls, classLevel) : undefined;
  const bonus = cls ? classBonusAt(cls, classLevel) : {};
  const base = baseStats(level, weapon);
  const pct = (n: number | undefined): number => 1 + (n ?? 0) / 100;
  const maxHp = base.maxHp * pct(bonus.hp);
  const maxSp = base.maxSp * pct(bonus.sp);
  const cdr = pct(-(bonus.cdr ?? 0));

  const barIds = [...(opts.bar ?? (cls ? kitSkillsAt(cls, classLevel) : []))];
  const basic = reg.skill(weapon.basic);
  const skillOf = (id: string): SkillDef | undefined => reg.skill(resolveSkill(mech, state, id));
  /** The use of a bar slot: the skill it casts right now (a stance may remap it) under the slot's own id. */
  const useOf = (barId: string, skill: SkillDef): SkillUse => ({ ...skillUse(cls, skill), id: barId, kit: cls?.kit?.includes(barId) ?? false });
  const foes: Foe[] = SIM_PACK.map((rank, i) => {
    const m = monsterStats(level, rank);
    return { id: `foe${i}`, rank, hp: m.hp, maxHp: m.hp, def: m.def, statuses: new Map() };
  });

  let state: MechanicState = initMechanic(mech);
  let now = 0;
  let hp = maxHp;
  let sp = maxSp;
  let shield = 0;
  let shieldUntil = 0;
  let busyUntil = 0;
  let basicAt = 0;
  let lastAttack = -1e9;
  const readyAt = new Map<string, number>();
  const buffs: { stat: string; amount: number; until: number; id: string }[] = [];
  const zonesUntil = new Map<string, number>();
  const result: SimResult = { damage: 0, dps: 0, seconds, casts: {}, hits: 0, kills: 0, effects: {}, mechanic: null };

  const note = (effects: readonly MechanicEffect[]): void => {
    for (const e of effects) {
      result.effects[e.type] = (result.effects[e.type] ?? 0) + 1;
      // Stored damage lands at once when marks are cashed in or run out.
      if (e.type === 'markEnd' && e.stored > 0) deal(e.target, e.stored);
      if (e.type === 'cashIn') for (const t of e.targets) if (t.stored > 0) deal(t.target, t.stored);
    }
  };
  const feed = (ev: MechanicEvent): void => {
    const out = stepMechanic(mech, state, ev);
    state = out.state;
    note(out.effects);
  };
  const nearLevel = (): number | null =>
    state.kind === 'zone' && state.objects.length > 0 ? Math.max(...state.objects.map((o) => o.level)) : null;
  const nearObject = (): number | undefined => (state.kind === 'zone' ? state.objects[0]?.id : undefined);

  function deal(foeId: string, amount: number): void {
    const foe = foes.find((f) => f.id === foeId);
    if (!foe || amount <= 0) return;
    result.damage += amount;
    foe.hp -= amount;
    if (foe.hp > 0) return;
    // A dummy that drops gets straight back up: the kill counts, its statuses and marks are gone.
    result.kills++;
    foe.hp = foe.maxHp;
    foe.statuses.clear();
    const kill: MechanicEvent = { type: 'kill', target: foe.id, hpPct: (hp / maxHp) * 100 };
    const object = nearObject();
    if (object !== undefined) kill.object = object;
    feed(kill);
  }

  const statsNow = (): { attacker: Attacker; damagePct: number; attackSpeed: number } => {
    const ms = mechanicStats(mech, state, nearLevel());
    const buff = (stat: string): number => buffs.reduce((sum, b) => (b.stat === stat && b.until > now ? sum + b.amount : sum), 0);
    return {
      attacker: {
        atk: base.atk * pct(bonus.atk) * pct(ms.atk) * pct(buff('atk')),
        matk: base.matk * pct(bonus.matk) * pct(ms.matk) * pct(buff('matk')),
        crit: base.crit + (bonus.crit ?? 0) + (ms.crit ?? 0) + buff('crit'),
        weapon: weapon.id,
      },
      damagePct: ms.damage ?? 0,
      attackSpeed: pct(ms.attackSpeed) * pct(ms.speed),
    };
  };

  const tagPct = (skill: SkillDef): number => {
    let sum = 0;
    for (const tag of new Set(skill.tags)) sum += bonus.tagPower?.[tag] ?? 0;
    return sum;
  };

  const applyStatus = (foe: Foe, status: StatusKind | undefined, ms?: number): void => {
    const taken = status ? statusFor(status, foe.rank) : null;
    if (!taken) return;
    foe.statuses.set(taken, now + (ms ?? (taken === 'expose' ? STATUS.exposeMs : SIM.statusMs)));
  };

  function strike(skill: SkillDef, use: SkillUse, boost: CastBoost, mult = 1): void {
    const { rounds, targets } = castPattern(skill, boost);
    const { attacker, damagePct } = statsNow();
    const elementStatus = skill.element ? reg.element(skill.element)?.status : undefined;
    const rank = Math.min(SIM.skillRank, skill.maxRank);
    for (let r = 0; r < rounds; r++) {
      for (let t = 0; t < targets; t++) {
        const foe = foes[t];
        const statuses = [...foe.statuses].filter(([, until]) => until > now).map(([s]) => s);
        const roll = computeDamage(reg.elements, skill, rank, attacker, { def: foe.def, size: 'M', statuses }, {
          tagPct: tagPct(skill),
          falloff: (1 + (boost.powerPct ?? 0) / 100) * (1 + damagePct / 100) * mult,
          forceCrit: boost.crit === true,
          rng,
        });
        if (roll.combo) foe.statuses.delete(roll.combo.consumes);
        result.hits++;
        feed({ type: 'hit', use, weapon: weapon.id, target: foe.id, damage: roll.amount, statuses });
        applyStatus(foe, elementStatus);
        applyStatus(foe, skill.status);
        applyStatus(foe, boost.status);
        deal(foe.id, roll.amount);
      }
    }
  }

  function cast(barId: string, skill: SkillDef): void {
    const use = useOf(barId, skill);
    const used = useSkill(mech, state, use, { weapon: weapon.id, target: foes[0].id, nearLevel: nearLevel() });
    if (used.locked) return;
    state = used.state;
    const boost = used.boost;
    note(used.effects);
    if (used.effects.some((e) => e.type === 'cashIn' && e.resetCooldown)) readyAt.delete(barId);
    else readyAt.set(barId, now + (skill.cooldown || weapon.delay) * cdr);
    result.casts[skill.id] = (result.casts[skill.id] ?? 0) + 1;
    if (boost.hpCostPct !== undefined) {
      hp = Math.max(1, hp - (maxHp * boost.hpCostPct) / 100);
      feed({ type: 'hpSpent', pct: boost.hpCostPct });
    } else if (!boost.free) {
      sp -= skill.spCost;
    }
    if (skill.hpCost) {
      hp = Math.max(1, hp - (maxHp * skill.hpCost) / 100);
      feed({ type: 'hpSpent', pct: skill.hpCost });
    }
    busyUntil = now + (skill.castMs ?? 0) + (skill.afterCastMs ?? SIM.afterCastMs);
    lastAttack = now;
    const shape = skill.shape;
    if (shape.kind === 'buff') buffs.push({ stat: shape.stat, amount: shape.amount, until: now + shape.duration, id: skill.id });
    if (shape.kind === 'mend') {
      const healed = Math.min(maxHp - hp, (maxHp * shape.pct) / 100);
      hp += healed;
      if (healed > 0) feed({ type: 'prevented', pct: (healed / maxHp) * 100 });
    }
    if (shape.kind === 'shield') {
      shield = (maxHp * shape.pct) / 100;
      shieldUntil = now + shape.durationMs;
    }
    if (shape.kind === 'zone') zonesUntil.set(skill.id, now + shape.durationMs);
    if (skill.power > 0) {
      strike(skill, use, boost);
      if (boost.repeat) strike(skill, use, boost, boost.repeat);
    }
  }

  /** Whether AUTO-style common sense allows casting this kind right now (SPEC-v4 §6.1 "AUTO uses it when"). */
  const sensible = (skill: SkillDef): boolean => {
    const shape = skill.shape;
    if (shape.kind === 'mend') return (hp / maxHp) * 100 < SIM.mendBelowPct;
    if (shape.kind === 'shield') return shieldUntil <= now;
    if (shape.kind === 'zone') return (zonesUntil.get(skill.id) ?? 0) <= now;
    if (shape.kind === 'buff') return !buffs.some((b) => b.id === skill.id && b.until > now);
    if (shape.kind === 'blink') return skill.power > 0;
    return true;
  };

  const steps = Math.round((seconds * 1000) / SIM.stepMs);
  for (let i = 0; i < steps; i++) {
    now = i * SIM.stepMs;
    const dt = SIM.stepMs;
    const moving = now % SIM.moveCycleMs < SIM.moveCycleMs * SIM.moveShare;
    feed({ type: 'tick', dtMs: dt, moving, attacking: now - lastAttack < 1000, inCombat: true, tiles: moving ? (SIM.tilesPerSec * dt) / 1000 : 0 });
    sp = Math.min(maxSp, sp + ((maxSp * SIM.spRegenPct) / 100 + SIM.spRegenFlat) * (dt / 1000));
    // The pack hits back at a flat rate; a live shield soaks it.
    const incoming = (maxHp * SIM.incomingPctPerSec * dt) / 100000;
    if (shieldUntil > now && shield > 0) {
      const soaked = Math.min(shield, incoming);
      shield -= soaked;
      feed({ type: 'prevented', pct: (soaked / maxHp) * 100 });
    } else {
      hp = Math.max(1, hp - incoming);
      feed({ type: 'damageTaken', pct: (incoming / maxHp) * 100 });
    }
    if (now < busyUntil) continue;

    const castable: SimView['castable'][number][] = [];
    for (const id of barIds) {
      if ((readyAt.get(id) ?? 0) > now || skillLocked(mech, state, id)) continue;
      const skill = skillOf(id);
      if (!skill || !weaponOk(skill, weapon.id) || !sensible(skill)) continue;
      const use = useOf(id, skill);
      const boost = previewBoost(mech, state, use, { weapon: weapon.id, target: foes[0].id, nearLevel: nearLevel() });
      if (!boost.free && boost.hpCostPct === undefined && skill.spCost > sp) continue;
      castable.push({ use, skill, boost, expected: expectedDamage(skill, boost) });
    }
    const advice = autoAdvice(mech, state, {
      castable: castable.map((c) => c.use),
      weapon: weapon.id,
      hpPct: (hp / maxHp) * 100,
      target: foes[0].id,
      nearLevel: nearLevel(),
    });
    const pick = policy({ now, castable, advice, hpPct: (hp / maxHp) * 100, mechanic: mechanicView(mech, state, foes[0].id) });
    if (pick === 'swap') {
      feed({ type: 'swap' });
      continue;
    }
    const chosen = pick === null ? undefined : castable.find((c) => c.use.id === pick);
    if (chosen) {
      cast(chosen.use.id, chosen.skill);
      continue;
    }
    if (basic && now >= basicAt) {
      const use = skillUse(cls, basic);
      const used = useSkill(mech, state, use, { weapon: weapon.id, target: foes[0].id, nearLevel: nearLevel() });
      state = used.state;
      note(used.effects);
      result.casts[basic.id] = (result.casts[basic.id] ?? 0) + 1;
      basicAt = now + weapon.delay / statsNow().attackSpeed;
      lastAttack = now;
      strike(basic, use, used.boost);
    }
  }
  result.dps = result.damage / seconds;
  result.mechanic = mechanicView(mech, state, foes[0].id);
  return result;
}

// ------------------------------------------------------------------ the band

export interface ClassSimRow {
  id: string;
  rarity: Rarity;
  /** Sustained damage on AUTO and with the manual script. */
  auto: number;
  manual: number;
}

/** Simulates every kit class in the registry on AUTO and on the manual script, with the weapon of its row. */
export function simulateClasses(
  reg: Registry,
  weapons: Readonly<Record<WeaponType, SimWeapon>>,
  opts: Pick<SimOptions, 'level' | 'classLevel' | 'seconds' | 'seed'> = {},
): ClassSimRow[] {
  return reg.classes.filter(isKitClass).map((cls) => {
    // 'any' classes are measured with a sword in hand.
    const weapon = weapons[cls.weapon === undefined || cls.weapon === 'any' ? 'sword' : cls.weapon];
    const run = (policy: 'auto' | 'manual'): number => simulateClass({ reg, cls, weapon, policy, ...opts }).damage;
    return { id: cls.id, rarity: classRarity(cls), auto: run('auto'), manual: run('manual') };
  });
}

export interface ClassSimVerdict extends ClassSimRow {
  /** auto ÷ the Common median, manual ÷ the Common median. */
  autoRatio: number;
  manualRatio: number;
  /** AUTO within ±CLASS_SIM.autoBand of the median; manual at most +CLASS_SIM.manualCap. */
  autoOk: boolean;
  manualOk: boolean;
}

/**
 * Judges simulated classes against the median AUTO damage of the Commons (SPEC-v4 §3.5). `median` is 0 (and every
 * verdict false) when no Common is among the rows.
 */
export function classSimBand(rows: readonly ClassSimRow[]): { median: number; rows: ClassSimVerdict[] } {
  const commons = rows.filter((r) => r.rarity === 'common').map((r) => r.auto).sort((a, b) => a - b);
  const mid = commons.length >> 1;
  const median = commons.length === 0 ? 0 : commons.length % 2 ? commons[mid] : (commons[mid - 1] + commons[mid]) / 2;
  return {
    median,
    rows: rows.map((r) => {
      const autoRatio = median > 0 ? r.auto / median : 0;
      const manualRatio = median > 0 ? r.manual / median : 0;
      return {
        ...r,
        autoRatio,
        manualRatio,
        autoOk: median > 0 && Math.abs(autoRatio - 1) <= CLASS_SIM.autoBand,
        manualOk: median > 0 && manualRatio <= 1 + CLASS_SIM.manualCap,
      };
    }),
  };
}
