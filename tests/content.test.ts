// Content integrity over the real data bundle (docs/SPEC-v2.md §4, §8; docs/SPEC-v4.md §2, §3, §14; docs/CLIENT-v2.md §5/§6):
// - the registry: Registry.validate with the weapon rule on (every bound skill has its grip, SPEC-v4 §2.2) is clean;
// - reachability: every authored skill except monster-only techniques (tag 'monster') can be obtained — weapon
//   basics, class kits, lessons, echoes, tomes, Transforms and fusions;
// - weapon trees: 13 nodes each (sword, dagger, rod and Bare Hands), tiers 0/1/2/3 = 1/3/6/3, 2 T2 per T1 branch and
//   1 capstone per branch;
// - class skills: every `classOf` skill is in exactly its class's kit, bound to the class weapon, and no recipe or
//   Transform touches it;
// - sparks: never on capstones (tier 3) nor on morphs whose parent is a buff (a buff never lands a hit);
// - flags: every flag a Requirement (morph, recipe, lesson, class) or portal gate reads is one the game sets;
// - hybrids: an any-weapon attack built only from techniques/echoes keeps max(ATK, MATK) scaling.
import { describe, expect, it } from 'vitest';
import { isHybrid } from '../src/core/combat';
import { parseRef } from '../src/core/refs';
import { GRIP_TAGS, VISITED_FLAG_PREFIX, gripWeapons, weaponOk } from '../src/core/requirements';
import { GRIP_TAG, WEAPON_TYPES, type Requirement, type SkillDef } from '../src/core/types';
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
 * Every skill id a player can obtain, with the first source found. Seeds: weapon basics, class kits (a class
 * teaches its 5 skills as its Class Level rises), lesson grants of trainers placed on a map, echo techniques of spawned monsters,
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
  for (const c of reg.classes) for (const id of c.kit ?? []) add(id, `kit of class ${c.id}`);
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

// ------------------------------------------------------------------ the registry, weapons and grips

describe('the registry', () => {
  it('validates with the weapon rule on: no errors', () => {
    expect(reg.validate({ grip: true })).toEqual([]);
  });

  it('the retag pass landed: rod spells, fist skills, free elemental spells and body moves (SPEC-v4 §2.2)', () => {
    const tagged = (tag: string): string[] => reg.authoredSkills().filter((s) => s.tags.includes(tag)).map((s) => s.id);
    // Thrown through the rod.
    for (const id of ['bolt', 'arcane_orb', 'arcane_nova', 'singularity', 'prism_orb', 'arcane_barrage', 'resonant_pulse', 'starfall_lattice', 'arcane_deluge']) {
      expect(reg.skill(id)!.tags, id).toContain(GRIP_TAG.staff);
      expect(reg.skill(id)!.weapons, id).toEqual(['staff']);
    }
    // Free: elemental spells keep `arcane` (MATK), gain `spell`, and work with any weapon.
    const spells = ['firebolt', 'meteor', 'aqua_lance', 'lightning_bolt', 'wind_cutter', 'holy_light', 'quake', 'inferno_ring', 'glacial_orb', 'thunderstorm', 'plasma_lance', 'tidal_ripple', 'dawn_prism', 'featherstorm', 'geode_maw', 'thunder_peal', 'tangle_orb', 'cinder_blink'];
    for (const id of spells) {
      const s = reg.skill(id)!;
      expect(s.weapons, id).toBeUndefined();
      expect(s.tags, id).toEqual(expect.arrayContaining(['arcane', 'spell']));
      for (const w of WEAPON_TYPES) expect(weaponOk(s, w), `${id} with ${w}`).toBe(true);
    }
    for (const id of ['focus', 'quicken', 'arcane_ward', 'astral_form', 'smoke_veil', 'gloom_shroud', 'moonveil']) expect(reg.skill(id)!.weapons, id).toBeUndefined();
    expect(reg.skill('shadowstep')!.tags).toContain(GRIP_TAG.dagger);
    // A Rod cannot Whirlwind; Ember Dart casts with a sword (acceptance check 2).
    expect(weaponOk(reg.skill('whirlwind')!, 'staff')).toBe(false);
    expect(weaponOk(reg.skill('firebolt')!, 'sword')).toBe(true);
    // Body moves: free, stronger bare-handed.
    expect(tagged('body').sort()).toEqual(
      ['crown_slam', 'palm_strike', 'pressure_point', 'quakestride', 'rippling_palm', 'rising_kick', 'shoulder_charge', 'soaring_heel', 'static_palm'],
    );
    for (const id of tagged('body')) expect(reg.skill(id)!.weapons, id).toBeUndefined();
    // Every fist skill is for bare hands only.
    for (const id of tagged(GRIP_TAG.fists)) expect(reg.skill(id)!.weapons, id).toEqual(['fists']);
    expect(tagged(GRIP_TAG.fists).length).toBeGreaterThanOrEqual(13 + 5);
  });

  it('a bound skill lists exactly the weapons whose grip it carries (tier-0 basics included)', () => {
    for (const s of reg.authoredSkills()) {
      if (s.tags.includes(MONSTER_TAG)) continue;
      const grips = gripWeapons(s);
      if (s.weapons) expect([...s.weapons].sort(), s.id).toEqual([...grips].sort());
      else expect(s.tags.filter((t) => GRIP_TAGS.includes(t)), s.id).toEqual([]);
    }
  });
});

describe('class skills', () => {
  const kitOf = (c: { kit?: readonly string[] }): readonly string[] => c.kit ?? [];
  const own = reg.authoredSkills().filter((s) => s.classOf !== undefined);

  it("every class skill is in exactly its class's kit and bound to the class weapon", () => {
    expect(own.length).toBeGreaterThanOrEqual(40);
    for (const s of own) {
      const cls = reg.classDef(s.classOf!)!;
      expect(cls, s.id).toBeDefined();
      expect(reg.classes.filter((c) => kitOf(c).includes(s.id)).map((c) => c.id), s.id).toEqual([cls.id]);
      expect(s.weapons, s.id).toEqual([cls.weapon]);
      if (cls.source !== 'physical' && cls.source !== 'none' && cls.source !== 'prism') expect(s.element, s.id).toBe(cls.source);
      else expect(s.element, s.id).toBeUndefined();
    }
  });

  it('no Transform or fusion recipe touches a class skill', () => {
    const ids = new Set(own.map((s) => s.id));
    expect(reg.morphs.filter((m) => ids.has(m.from) || ids.has(m.to)).map((m) => `${m.from}>${m.to}`)).toEqual([]);
    const refs = reg.recipeList.flatMap((r) => [r.a, r.b, r.result]).map(parseRef);
    expect(refs.filter((p) => p.kind === 'skill' && ids.has(p.id)).map((p) => p.id)).toEqual([]);
  });

  it('the two old signatures that outlived their classes are ordinary dagger skills, made by fusion', () => {
    for (const [id, a, b] of [['phantom_sig', 'el:shadow', 'skill:phantom_rush'], ['vortex_dancer_sig', 'el:wind', 'skill:blade_storm']] as const) {
      const s = reg.skill(id)!;
      expect(s.classOf, id).toBeUndefined();
      expect(s.weapons, id).toEqual(['dagger']);
      expect(reg.recipe(a, b)?.result, id).toBe(`skill:${id}`);
    }
  });
});

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
    it(`${w}: 13 nodes, tiers 0/1/2/3 = 1/3/6/3, 2 T2 per T1 branch, 1 capstone per branch`, () => {
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
  // SPEC-v4 Phase 1 (game lane): a warden beaten bare-handed.
  'warden_bare',
]);

/** v4 counters (SPEC-v4 §15.2 lane C): `hits:<weapon>`, `kills:<weapon>` and `kills:<weapon>:<element>`. */
function weaponCounter(id: string): boolean {
  const [kind, weapon, element, ...rest] = id.split(':');
  if (rest.length > 0 || !(WEAPON_TYPES as readonly string[]).includes(weapon ?? '')) return false;
  if (kind === 'hits') return element === undefined;
  if (kind === 'kills') return element === undefined || reg.elements.has(element as never);
  return false;
}

function knownFlag(id: string): boolean {
  if (STATIC_FLAGS.has(id)) return true;
  if (id.includes(':') && !id.startsWith(VISITED_FLAG_PREFIX)) return weaponCounter(id);
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
  for (const c of reg.classes) push(`class ${c.id}`, c.discover?.requires ?? c.requires);
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
    expect(knownFlag('hits:sword') && knownFlag('kills:fists') && knownFlag('kills:staff:fire') && knownFlag('warden_bare')).toBe(true);
    expect(knownFlag('hits:bow') || knownFlag('kills:sword:plasma') || knownFlag('hits:sword:fire')).toBe(false);
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
