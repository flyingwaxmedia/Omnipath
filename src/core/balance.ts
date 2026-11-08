// Shared balance helpers for content authors. Pure functions.
import type { ClassNode, ClassTier, MonsterRank, PassiveDef, PassiveStat } from './types';

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
  tier: ClassTier;
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
 * Templated class tree: 4 passive nodes (3 ranks each) + optional skill node + capstone, and the
 * class imprint. Returns the nodes and the PassiveDefs they reference (ids `cls_<classId>_<n>`,
 * imprint `imprint_<classId>`). Register the passives in src/data/passives.ts via CLASS_PASSIVES.
 */
export function classTreeTemplate(spec: ClassTreeSpec): { nodes: ClassNode[]; passives: PassiveDef[]; imprint: PassiveDef } {
  const scale = [0, 1, 1.25, 1.5][spec.tier];
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
  const pw = Math.round(3 * scale);
  const sp = Math.round(4 * scale);
  const cd = Math.round(4 * scale);
  const st = Math.round(3 * scale);
  const cap = Math.round(8 * scale);
  const passives: PassiveDef[] = [
    p(1, `${cap1(spec.tag)} Focus`, `+${pw}% ${spec.tag} damage per rank.`, { kind: 'power', tag: spec.tag, pct: pw }),
    p(2, `${cap1(spec.tag)} Economy`, `-${sp}% SP cost for ${spec.tag} skills per rank.`, { kind: 'spCost', tag: spec.tag, pct: -sp }),
    p(3, `${cap1(t2)} Tempo`, `-${cd}% cooldown for ${t2} skills per rank.`, { kind: 'cooldown', tag: t2, pct: -cd }),
    p(4, `${spec.className} Training`, `+${st}% ${spec.stat.toUpperCase()} per rank.`, { kind: 'stat', stat: spec.stat, pct: st }),
    p(5, `${spec.className} Mastery`, `+${cap}% damage with every skill.`, { kind: 'power', pct: cap }, 1),
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
    name: `${spec.className} Imprint`,
    icon: spec.icon,
    desc: `+${Math.round(5 * scale)}% ${spec.tag} damage, even while wearing another class.`,
    source: 'imprint',
    maxRank: 1,
    effect: { kind: 'power', tag: spec.tag, pct: Math.round(5 * scale) },
  };
  return { nodes, passives, imprint };
}

function cap1(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
