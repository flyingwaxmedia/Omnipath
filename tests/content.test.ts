// Content integrity over the real data bundle (docs/SPEC-v2.md §4, §8; docs/CLIENT-v2.md §5/§6):
// - reachability: every authored skill except monster-only techniques (tag 'monster') can be obtained;
// - weapon trees: 13 nodes each, tiers 0/1/2/3 = 1/3/6/3, 2 T2 per T1 branch and 1 capstone per branch;
// - sparks: never on capstones (tier 3) nor on morphs whose parent is a buff (a buff never lands a hit);
// - flags: every flag a Requirement (morph, recipe, lesson, class) or portal gate reads is one the game sets;
// - hybrids: an any-weapon attack built only from techniques/echoes keeps max(ATK, MATK) scaling.
import { describe, expect, it } from 'vitest';
import { isHybrid } from '../src/core/combat';
import { parseRef } from '../src/core/refs';
import { VISITED_FLAG_PREFIX } from '../src/core/requirements';
import { WEAPON_TYPES, type Requirement, type SkillDef } from '../src/core/types';
import { GAME_DATA, createRegistry } from '../src/data';
import { NPCS } from '../src/data/npcs';
import { WEAPONS } from '../src/data/weapons';
import { MAPS } from '../src/data/world';

const reg = createRegistry();
const MONSTER_TAG = 'monster';
const MONSTER_LIST = [...reg.monsters.values()];

const isAttack = (s: SkillDef): boolean => s.shape.kind !== 'buff' && s.power > 0;

// ------------------------------------------------------------------ world facts

/** Monster ids that appear in some map's spawn table. */
const SPAWNED = new Set(MAPS.flatMap((m) => m.spawns.map((s) => s.monster)));
/** NPC ids placed on some map. */
const PLACED_NPCS = new Set(MAPS.flatMap((m) => (m.npcs ?? []).map((n) => n.npc)));
/** Items found in chests, and essences found in chests. */
const CHEST_ITEMS = new Set<string>();
const CHEST_ESSENCES = new Set<string>();
for (const m of MAPS) {
  for (const o of m.objects ?? []) {
    if (o.kind !== 'chest') continue;
    for (const id of Object.keys(o.loot?.items ?? {})) CHEST_ITEMS.add(id);
    for (const id of Object.keys(o.loot?.essences ?? {})) CHEST_ESSENCES.add(id);
  }
}
/** Items a spawned monster can drop. */
const DROPPED = new Set(MONSTER_LIST.filter((m) => SPAWNED.has(m.id)).flatMap((m) => (m.drops ?? []).map((d) => d.item)));
/** Trainers whose NPC is placed on a map. */
const REACHABLE_TRAINERS = GAME_DATA.trainers.filter((t) => PLACED_NPCS.has(t.npc));

/** Essences a player can obtain: species drops, chests and trainer lessons. */
function obtainableEssences(): Set<string> {
  const out = new Set<string>(CHEST_ESSENCES);
  for (const m of MONSTER_LIST) if (m.essence && SPAWNED.has(m.id)) out.add(m.essence);
  for (const t of REACHABLE_TRAINERS) for (const l of t.lessons) if ('essence' in l.grants) out.add(l.grants.essence);
  return out;
}

// ------------------------------------------------------------------ reachability

/**
 * Every skill id a player can obtain, with the first source found. Seeds: weapon basics, class grants
 * and tree skill nodes, lesson grants of trainers placed on a map, echo techniques of spawned monsters,
 * tomes that drop or sit in a chest. Closure: a morph target once its parent is obtainable; a recipe
 * result once every skill ingredient is obtainable (element ingredients must exist, essence
 * ingredients must be obtainable).
 */
function obtainableSkills(): Map<string, string> {
  const got = new Map<string, string>();
  const add = (id: string, why: string): boolean => {
    if (got.has(id) || !reg.isAuthored(id)) return false;
    got.set(id, why);
    return true;
  };
  for (const w of WEAPON_TYPES) add(WEAPONS[w].basic, `basic attack of the ${w}`);
  for (const c of reg.classes) {
    for (const g of c.grants ?? []) add(g, `granted by class ${c.id}`);
    for (const n of c.tree ?? []) if (n.kind === 'skill') add(n.ref, `tree node of class ${c.id}`);
  }
  for (const t of REACHABLE_TRAINERS) for (const l of t.lessons) if ('skill' in l.grants) add(l.grants.skill, `lesson ${l.id}`);
  for (const m of MONSTER_LIST) {
    if (!SPAWNED.has(m.id)) continue;
    for (const t of m.techniques ?? []) if (t.echo) add(t.skill, `echo of ${m.id}`);
  }
  for (const i of reg.items.values()) {
    if (i.kind === 'tome' && (DROPPED.has(i.id) || CHEST_ITEMS.has(i.id))) add(i.skill, `tome ${i.id}`);
  }
  const essences = obtainableEssences();
  const ingredientOk = (ref: string): boolean => {
    const p = parseRef(ref);
    if (p.kind === 'skill') return got.has(p.id);
    if (p.kind === 'el') return reg.elements.has(p.id);
    if (p.kind === 'mod') return essences.has(p.id);
    return false;
  };
  for (let changed = true; changed; ) {
    changed = false;
    for (const m of reg.morphs) if (got.has(m.from) && add(m.to, `morph from ${m.from}`)) changed = true;
    for (const r of reg.recipeList) {
      const res = parseRef(r.result);
      if (res.kind === 'skill' && ingredientOk(r.a) && ingredientOk(r.b) && add(res.id, `recipe ${r.a} + ${r.b}`)) changed = true;
    }
  }
  return got;
}

describe('reachability', () => {
  const got = obtainableSkills();

  it('every authored skill except monster-only techniques can be obtained', () => {
    const orphans = reg
      .authoredSkills()
      .filter((s) => !s.tags.includes(MONSTER_TAG) && !got.has(s.id))
      .map((s) => s.id);
    expect(orphans).toEqual([]);
    expect(got.size).toBe(reg.authoredSkills().filter((s) => !s.tags.includes(MONSTER_TAG)).length);
  });

  it('monster-only techniques are never handed to the player', () => {
    const leaked = [...got.keys()].filter((id) => reg.skill(id)!.tags.includes(MONSTER_TAG));
    expect(leaked).toEqual([]);
    // Every echo technique is a learnable (non-monster) skill.
    const bad = MONSTER_LIST.flatMap((m) => (m.techniques ?? []).filter((t) => t.echo && reg.skill(t.skill)?.tags.includes(MONSTER_TAG)))
      .map((t) => t.skill);
    expect(bad).toEqual([]);
  });

  it('every trainer stands on a map, every echo monster spawns, every tome can be found', () => {
    expect(GAME_DATA.trainers.filter((t) => !PLACED_NPCS.has(t.npc)).map((t) => t.id)).toEqual([]);
    expect(GAME_DATA.trainers.filter((t) => !NPCS.some((n) => n.id === t.npc)).map((t) => t.id)).toEqual([]);
    const silentEchoes = MONSTER_LIST.filter((m) => (m.techniques ?? []).some((t) => t.echo) && !SPAWNED.has(m.id))
      .map((m) => m.id);
    expect(silentEchoes).toEqual([]);
    const lostTomes = [...reg.items.values()].filter((i) => i.kind === 'tome' && !DROPPED.has(i.id) && !CHEST_ITEMS.has(i.id));
    expect(lostTomes.map((i) => i.id)).toEqual([]);
  });
});

// ------------------------------------------------------------------ weapon trees

/** The weapon tree: the basic attack and every skill reachable from it by morphs. */
function weaponTree(basic: string): string[] {
  const seen = new Set([basic]);
  const queue = [basic];
  while (queue.length > 0) {
    for (const m of reg.morphsFrom(queue.shift()!)) {
      if (seen.has(m.to)) continue;
      seen.add(m.to);
      queue.push(m.to);
    }
  }
  return [...seen];
}

describe('weapon trees', () => {
  for (const w of WEAPON_TYPES) {
    // A weapon whose basic attack is not authored yet (Bare Hands until its tree lands) is skipped, not failed.
    it.skipIf(!reg.skill(WEAPONS[w].basic))(`${w}: 13 nodes, tiers 0/1/2/3 = 1/3/6/3, 2 T2 per T1 branch, 1 capstone per branch`, () => {
      const basic = WEAPONS[w].basic;
      const tree = weaponTree(basic);
      expect(tree).toHaveLength(13);
      const counts = [0, 0, 0, 0];
      for (const id of tree) counts[reg.skill(id)!.tier]++;
      expect(counts).toEqual([1, 3, 6, 3]);
      expect(reg.skill(basic)!.tier).toBe(0);

      const children = (id: string): string[] => reg.morphsFrom(id).map((m) => m.to).filter((to) => tree.includes(to));
      const t1 = children(basic);
      expect(t1).toHaveLength(3);
      for (const branch of t1) {
        expect(reg.skill(branch)!.tier, branch).toBe(1);
        const t2 = children(branch);
        expect(t2.map((id) => reg.skill(id)!.tier), branch).toEqual([2, 2]);
        const caps = t2.flatMap(children);
        expect(caps.map((id) => reg.skill(id)!.tier), branch).toEqual([3]);
      }
      // MorphDef.tier, when given, matches the result skill.
      for (const id of tree) {
        for (const m of reg.morphsFrom(id)) if (m.tier !== undefined) expect(m.tier, `${m.from}>${m.to}`).toBe(reg.skill(m.to)!.tier);
      }
    });
  }
});

// ------------------------------------------------------------------ sparks

describe('sparks', () => {
  it('no spark on a capstone (tier 3) or on a morph whose parent is a buff', () => {
    const bad: string[] = [];
    for (const m of reg.morphs) {
      if (!m.spark) continue;
      const tier = m.tier ?? reg.skill(m.to)?.tier;
      if (tier === 3) bad.push(`${m.from}>${m.to}: tier-3 morph sparks`);
      if (reg.skill(m.from)?.shape.kind === 'buff') bad.push(`${m.from}>${m.to}: parent is a buff`);
    }
    expect(bad).toEqual([]);
    expect(reg.morphs.some((m) => m.spark)).toBe(true);
  });
});

// ------------------------------------------------------------------ flags

/**
 * Flags the game sets (docs/CLIENT-v2.md §5/§6, SPEC §7.4; mastered_any / class_worn by the core
 * SkillBook): counters, per-monster kills, map visits, warden defeats and relic pickups.
 */
const STATIC_FLAGS = new Set([
  'kills',
  'ore_mined',
  'fish_caught',
  'herb_gathered',
  'ember_gathered',
  'chime_gathered',
  'storm_gathered',
  'spore_gathered',
  'sun_gathered',
  'frost_gathered',
  'meditations',
  'forge_success',
  'mastered_any',
  'class_worn',
  'brann_gift',
]);

function knownFlag(id: string): boolean {
  if (STATIC_FLAGS.has(id)) return true;
  if (id.startsWith('kill_')) return reg.monster(id.slice('kill_'.length)) !== undefined;
  if (id.startsWith(VISITED_FLAG_PREFIX)) return MAPS.some((m) => m.id === id.slice(VISITED_FLAG_PREFIX.length));
  if (id.startsWith('warden_')) return reg.monster(id.slice('warden_'.length))?.rank === 'warden';
  return [...reg.items.values()].some((i) => i.kind === 'relic' && i.flag === id);
}

/** Every Requirement in the data with where it lives. */
function allRequirements(): { where: string; req: Requirement }[] {
  const out: { where: string; req: Requirement }[] = [];
  const push = (where: string, reqs: readonly Requirement[] | undefined): void => {
    for (const req of reqs ?? []) out.push({ where, req });
  };
  for (const m of reg.morphs) push(`morph ${m.from}>${m.to}`, m.requires);
  for (const r of reg.recipeList) push(`recipe ${r.a} + ${r.b}`, r.requires);
  for (const t of GAME_DATA.trainers) for (const l of t.lessons) push(`lesson ${l.id}`, l.requires);
  for (const c of reg.classes) push(`class ${c.id}`, c.requires);
  return out;
}

describe('flags', () => {
  it('the whitelist itself is consistent (relic flags, wardens and maps exist)', () => {
    expect(knownFlag('relic_stone') && knownFlag('relic_dusk') && knownFlag('relic_storm')).toBe(true);
    expect(knownFlag('warden_thunderhoof')).toBe(true);
    expect(knownFlag('warden_cragling')).toBe(false); // not a warden
    expect(knownFlag('kill_ghost')).toBe(false);
    expect(knownFlag(`${VISITED_FLAG_PREFIX}vale.moonlit_glade`)).toBe(true);
    expect(knownFlag(`${VISITED_FLAG_PREFIX}vale.nowhere`)).toBe(false);
    expect(knownFlag('ore_minned')).toBe(false);
  });

  it('every flag a requirement reads is one the game sets', () => {
    const reqs = allRequirements();
    const flags = reqs.filter((r) => r.req.type === 'flag');
    expect(flags.length).toBeGreaterThan(10);
    const unknown = flags
      .filter(({ req }) => req.type === 'flag' && !knownFlag(req.id))
      .map(({ where, req }) => `${where}: ${req.type === 'flag' ? req.id : ''}`);
    expect(unknown).toEqual([]);
  });

  it('every mapVisited requirement names an existing map, every portal gate flag is known', () => {
    const maps = new Set(MAPS.map((m) => m.id));
    const badMaps = allRequirements()
      .filter(({ req }) => req.type === 'mapVisited' && !maps.has(req.id))
      .map(({ where }) => where);
    expect(badMaps).toEqual([]);
    const gates = MAPS.flatMap((m) => m.portals.filter((p) => p.gate?.flag).map((p) => ({ at: `${m.id}#${p.id}`, flag: p.gate!.flag! })));
    expect(gates.filter((g) => !knownFlag(g.flag)).map((g) => `${g.at}: ${g.flag}`)).toEqual([]);
  });
});

// ------------------------------------------------------------------ hybrids

describe('hybrid scaling', () => {
  it('an any-weapon attack made only from technique/echo/spirit skills is a hybrid too', () => {
    const parentsOf = (id: string): string[][] => [
      ...reg.morphsTo(id).map((m) => [m.from]),
      ...reg.recipeList
        .filter((r) => r.result === `skill:${id}`)
        .map((r) => [r.a, r.b].map(parseRef).flatMap((p) => (p.kind === 'skill' ? [p.id] : []))),
    ];
    const bad: string[] = [];
    for (const s of reg.authoredSkills()) {
      if (s.weapons || !isAttack(s) || s.tags.includes(MONSTER_TAG) || isHybrid(s)) continue;
      const sources = parentsOf(s.id).filter((ps) => ps.length > 0);
      const fromHybrids = sources.length > 0 && sources.every((ps) => ps.every((p) => isHybrid(reg.skill(p)!)));
      if (fromHybrids) bad.push(s.id);
    }
    expect(bad).toEqual([]);
  });
});
