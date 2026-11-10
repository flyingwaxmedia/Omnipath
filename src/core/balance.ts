// Shared balance helpers for content authors. Pure functions.
import type { ClassNode, ClassTier, MonsterRank, PassiveDef, PassiveStat, WeaponType } from './types';

const RANK_MULT: Record<MonsterRank, { hp: number; atk: number; def: number; exp: number; coins: number }> = {
  common: { hp: 1, atk: 1, def: 1, exp: 1, coins: 1 },
  elite: { hp: 4, atk: 1.3, def: 1.3, exp: 4, coins: 3 },
  warden: { hp: 15, atk: 1.6, def: 1.8, exp: 30, coins: 15 },
};

/**
 * Baseline monster stats by level and rank. Targets: a common dies in 3-5 basic hits from a
 * player of the same level, an elite in ~20-30 s, a warden in ~1-2 min solo.
 * Content may deviate by +-20% for flavour (tanky constructs, fragile sprites).
 */
export function monsterStats(level: number, rank: MonsterRank = 'common') {
  const m = RANK_MULT[rank];
  return {
    hp: Math.round((30 + 14 * Math.pow(level, 1.25)) * m.hp),
    atk: Math.round((4 + 2.5 * level) * m.atk),
    def: Math.round(level * 0.7 * m.def),
    exp: Math.round((5 + 4 * Math.pow(level, 1.3)) * m.exp),
    coins: [Math.round(level * 1.2 * m.coins), Math.round(level * 2.4 * m.coins) + 1] as [number, number],
  };
}

export interface ClassTreeSpec {
  classId: string;
  className: string;
  tier?: ClassTier;
  /** Primary tag (power + SP nodes) and secondary tag (cooldown node; defaults to primary). */
  tag: string;
  tag2?: string;
  /** Stat for the 4th node. */
  stat: PassiveStat;
  icon: string;
  /** Optional class signature/skill node (SkillDef id) costing 2 points. */
  skillNode?: string;
}

/**
 * Damage numbers of templated class trees and imprints per tier, sized for the SPEC §5 class power
 * budget (worst case ≤ CLASS_POWER_BUDGET on any single skill). The budget is flat across tiers, so
 * damage is too; higher tiers grow in SP economy, tempo, non-damage stats and points per rank.
 * - `power`: % damage per rank of the primary-tag node (3 ranks → 6);
 * - `capstone`: % damage with every skill (1 rank);
 * - `imprint`: % damage to the primary tag (× IMPRINT_STRENGTH when slotted: Tier II/III 3 × 0.6 =
 *   1.8, so no slotted imprint is worth more than a Tier I one's 2 and three are worth ≤ 6);
 * - `damageStat`: % ATK or MATK per rank when the 4th node's stat is atk/matk (3 ranks → 3). Other
 *   stats (hp, sp, speed, crit, def) keep `round(3 × tierScale)` per rank.
 * Worst case without the worn bonus: 6 + 3 + 6 = 15 (+3 with an atk/matk node), leaving 10 (7) for
 * the worn class's `bonus` (Σ tagPower over a skill's tags + its ATK or MATK).
 */
export const CLASS_TREE_POWER: Readonly<
  Record<ClassTier, { readonly power: number; readonly capstone: number; readonly imprint: number; readonly damageStat: number }>
> = {
  1: { power: 2, capstone: 3, imprint: 2, damageStat: 1 },
  2: { power: 2, capstone: 3, imprint: 3, damageStat: 1 },
  3: { power: 2, capstone: 3, imprint: 3, damageStat: 1 },
};

/**
 * SPEC §5 class power budget (percentage points): for any single skill, the worn class's bonus
 * (Σ tagPower over the skill's tags + its ATK or MATK %, tree atk/matk node maxed included) + its
 * maxed tree power nodes + capstone + the 3 best slottable imprints at their strengths.
 */
export const CLASS_POWER_BUDGET = 25;

/**
 * SPEC-v4 §3.5 flat power budget: a worn class `bonus` adds at most this many damage points to any one skill
 * (ATK or MATK %, plus the `tagPower` entries the skill can carry together), at Class Level 10.
 */
export const CLASS_BONUS_BUDGET = 10;

/** Each class passive declares `budget` (its worst-case damage points on one skill) ≤ this. Three Keepsakes ⇒ ≤ 15. */
export const KEEPSAKE_BUDGET = 5;

/** The class rotation simulation's bands (SPEC-v4 §3.5; sim.ts, tests/class-sim.test.ts). All [T]. */
export const CLASS_SIM = {
  /** Fight length (s). */
  seconds: 60,
  /** Character and pack level. */
  level: 10,
  /** AUTO sustained damage must land within this share of the median of the Commons. */
  autoBand: 0.1,
  /** A manual script may beat that median by at most this share. */
  manualCap: 0.25,
} as const;

/**
 * Player stats before bonuses and buffs, by level and weapon (the same numbers as the game's computeStats; a test
 * keeps the two in step). Used by the class simulation.
 */
export function baseStats(level: number, weapon: { atk: number; matk: number; crit: number }) {
  return {
    maxHp: 110 + 20 * (level - 1),
    maxSp: 40 + 7 * (level - 1),
    atk: 10 + 3 * (level - 1) + weapon.atk,
    matk: 8 + 3 * (level - 1) + weapon.matk,
    def: 2 + level * 0.8,
    crit: weapon.crit,
  };
}

/** Size multipliers (S / M / L) of each weapon; combat.SIZE_TABLE adds the `heavy` row. Bare Hands is [T]. */
export const WEAPON_SIZE: Readonly<Record<WeaponType, Readonly<Record<'S' | 'M' | 'L', number>>>> = {
  dagger: { S: 1.0, M: 0.85, L: 0.65 },
  sword: { S: 0.85, M: 1.0, L: 0.9 },
  staff: { S: 1.0, M: 1.0, L: 1.0 },
  fists: { S: 1.0, M: 0.95, L: 0.8 },
};

/**
 * @deprecated v2 content helper. The rules ignore tree nodes since v4 Phase 1; only the `imprint` it builds is still
 * in use (until Phase 2). Kept so today's src/data/classes.ts compiles; `spec.tier` defaults to 1.
 *
 * Templated class tree: 4 passive nodes (3 ranks each) + optional skill node + capstone, and the
 * class imprint. Player-facing names are plain (docs/UX-SIMPLE.md): "<Tag> Power" (damage), "<Tag>
 * Thrift" (SP cost), "<Tag2> Haste" (cooldown), "<Class> Training" (stat), "True <Class>" (capstone)
 * and "<Class> Keepsake" (the imprint); tags read through perkWord(). Returns the nodes and the PassiveDefs they reference (ids `cls_<classId>_<n>`,
 * imprint `imprint_<classId>`). Register the passives in src/data/passives.ts via CLASS_PASSIVES.
 * Damage values come from CLASS_TREE_POWER[tier]; SP economy, tempo and non-damage stats scale with
 * tier (×1 / ×1.25 / ×1.5). The template signature and passive ids are stable (the client codes
 * against them); only the numbers are tuned.
 */
export function classTreeTemplate(spec: ClassTreeSpec): { nodes: ClassNode[]; passives: PassiveDef[]; imprint: PassiveDef } {
  const scale = [0, 1, 1.25, 1.5][spec.tier ?? 1];
  const dmg = CLASS_TREE_POWER[spec.tier ?? 1];
  const p = (n: number, name: string, desc: string, effect: PassiveDef['effect'], maxRank = 3): PassiveDef => ({
    id: `cls_${spec.classId}_${n}`,
    name,
    icon: spec.icon,
    desc,
    source: 'class',
    maxRank,
    effect,
  });
  const t2 = spec.tag2 ?? spec.tag;
  const pw = dmg.power;
  const sp = Math.round(4 * scale);
  const cd = Math.round(4 * scale);
  const st = spec.stat === 'atk' || spec.stat === 'matk' ? dmg.damageStat : Math.round(3 * scale);
  const cap = dmg.capstone;
  const passives: PassiveDef[] = [
    p(1, `${perkWord(spec.tag)} Power`, `+${pw}% ${spec.tag} damage per rank.`, { kind: 'power', tag: spec.tag, pct: pw }),
    p(2, `${perkWord(spec.tag)} Thrift`, `-${sp}% SP cost for ${spec.tag} skills per rank.`, { kind: 'spCost', tag: spec.tag, pct: -sp }),
    p(3, `${perkWord(t2)} Haste`, `-${cd}% cooldown for ${t2} skills per rank.`, { kind: 'cooldown', tag: t2, pct: -cd }),
    p(4, `${spec.className} Training`, `+${st}% ${spec.stat.toUpperCase()} per rank.`, { kind: 'stat', stat: spec.stat, pct: st }),
    p(5, `True ${spec.className}`, `+${cap}% damage with every skill.`, { kind: 'power', pct: cap }, 1),
  ];
  const nodes: ClassNode[] = [
    { id: 'n1', kind: 'passive', ref: passives[0].id, cost: 1, maxRank: 3 },
    { id: 'n2', kind: 'passive', ref: passives[1].id, cost: 1, maxRank: 3 },
    { id: 'n3', kind: 'passive', ref: passives[2].id, cost: 1, maxRank: 3, requires: [{ node: 'n1', rank: 1 }] },
    { id: 'n4', kind: 'passive', ref: passives[3].id, cost: 1, maxRank: 3, requires: [{ node: 'n2', rank: 1 }] },
  ];
  if (spec.skillNode) nodes.push({ id: 'n5', kind: 'skill', ref: spec.skillNode, cost: 2, maxRank: 1, minSpent: 3 });
  nodes.push({ id: 'cap', kind: 'capstone', ref: passives[4].id, cost: 3, maxRank: 1, minSpent: 6 });
  const imprint: PassiveDef = {
    id: `imprint_${spec.classId}`,
    name: `${spec.className} Keepsake`,
    icon: spec.icon,
    desc: `+${dmg.imprint}% ${spec.tag} damage, even while wearing another class.`,
    source: 'imprint',
    maxRank: 1,
    effect: { kind: 'power', tag: spec.tag, pct: dmg.imprint },
  };
  return { nodes, passives, imprint };
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Tags as they read in a perk's name (docs/UX-SIMPLE.md rules 2 and 8: names only, ids and tags unchanged) — "Area
 * Power", not "Aoe Focus"; "Fused Power", not "Infused Focus". Other tags are plain words already ("Fire", "Blade").
 */
const PERK_WORDS: Readonly<Record<string, string>> = {
  aoe: 'Area',
  projectile: 'Ranged',
  pierce: 'Piercing',
  execute: 'Finisher',
  infused: 'Fused',
  melee: 'Close-range',
  buff: 'Boost',
  dot: 'Lingering',
  cc: 'Control',
  basic: 'Attack',
};

/** A tag as a perk-name word ("Area", "Fused", "Blade"). */
export function perkWord(tag: string): string {
  return PERK_WORDS[tag] ?? cap1(tag);
}
