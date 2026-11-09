// Quest content rules (docs/QUESTS.md §4) over the real data bundle (src/data/quests.ts):
// - every NPC gives quests; every trainer lesson is the reward of exactly one quest by its trainer;
// - every reference resolves, and every target exists where the player can reach it (kill targets
//   spawn, gather nodes are placed, visit/cast maps exist, delivered items can be obtained), region by
//   region: Hearth Vale quests stay completable inside Hearth Vale;
// - flags come only from the client flag contract (docs/CLIENT-v2.md §5);
// - `after` chains are acyclic, start from a fresh Hearth Vale save (Riftmarch chains from arriving there);
// - ids are unique '<giver>_<slug>'; dialog is short; bounties cool down 10-20 minutes and cost fresh effort.
import { describe, expect, it } from 'vitest';
import { SkillBook, type Inventory } from '../src/core/skillbook';
import { VISITED_FLAG_PREFIX } from '../src/core/requirements';
import type { MonsterDef, QuestDef, QuestNodeKind, QuestObjective, Requirement } from '../src/core/types';
import { GAME_DATA, createRegistry } from '../src/data';
import { NPCS } from '../src/data/npcs';
import { QUESTS } from '../src/data/quests';
import { WEAPONS } from '../src/data/weapons';
import { MAPS } from '../src/data/world';
import { FUSED_ELEMENT_RECIPES } from '../src/data/recipes/elements';

const reg = createRegistry();
const QUEST_BY_ID = new Map(QUESTS.map((q) => [q.id, q]));
const NPC_IDS = new Set(NPCS.map((n) => n.id));

// ------------------------------------------------------------------ world facts, per region

type Region = 'vale' | 'rift';
const REGION_IDS: readonly Region[] = ['vale', 'rift'];

const MAP_REGION = new Map(MAPS.map((m) => [m.id, m.region as Region]));
/** Region of the map an NPC stands on. */
const NPC_REGION = new Map<string, Region>();
for (const m of MAPS) for (const n of m.npcs ?? []) NPC_REGION.set(n.npc, m.region as Region);

/** Node kind → the bag item and the flag a gather of it gives (SPEC §7.4). */
const NODE_ITEM: Record<QuestNodeKind, string> = {
  ore: 'ore',
  fishing: 'fish',
  herb: 'herb',
  ember_vent: 'ember_shard',
  wind_chime: 'chime_feather',
  storm_tree: 'storm_wood',
  shadow_fungus: 'umbral_spore',
  sun_spring: 'sun_water',
  frost_crystal: 'frost_crystal',
};
const NODE_FLAG: Record<QuestNodeKind, string> = {
  ore: 'ore_mined',
  fishing: 'fish_caught',
  herb: 'herb_gathered',
  ember_vent: 'ember_gathered',
  wind_chime: 'chime_gathered',
  storm_tree: 'storm_gathered',
  shadow_fungus: 'spore_gathered',
  sun_spring: 'sun_gathered',
  frost_crystal: 'frost_gathered',
};

interface RegionFacts {
  maps: Set<string>;
  monsters: MonsterDef[];
  nodes: Set<QuestNodeKind>;
  /** Items obtainable there: node items, drops of monsters spawned there, chest loot. */
  items: Set<string>;
  /** Echo techniques of monsters spawned there. */
  echoes: Set<string>;
  npcs: Set<string>;
}

function factsFor(regions: readonly Region[]): RegionFacts {
  const maps = MAPS.filter((m) => regions.includes(m.region as Region));
  const spawned = new Set(maps.flatMap((m) => m.spawns.map((s) => s.monster)));
  const monsters = [...reg.monsters.values()].filter((m) => spawned.has(m.id));
  const nodes = new Set(maps.flatMap((m) => (m.nodes ?? []).map((n) => n.kind as QuestNodeKind)));
  const items = new Set<string>([...nodes].map((k) => NODE_ITEM[k]));
  for (const m of monsters) for (const d of m.drops ?? []) items.add(d.item);
  for (const m of maps) for (const o of m.objects ?? []) for (const id of Object.keys(o.loot?.items ?? {})) items.add(id);
  const echoes = new Set(monsters.flatMap((m) => (m.techniques ?? []).filter((t) => t.echo).map((t) => t.skill)));
  const npcs = new Set(maps.flatMap((m) => (m.npcs ?? []).map((n) => n.npc)));
  return { maps: new Set(maps.map((m) => m.id)), monsters, nodes, items, echoes, npcs };
}

const VALE = factsFor(['vale']);
const ANYWHERE = factsFor(REGION_IDS);

/** Hearth Vale givers must be completable in Hearth Vale; Riftmarch givers may send the player anywhere. */
const giverRegion = (q: QuestDef): Region | undefined => NPC_REGION.get(q.giver);
const factsOf = (q: QuestDef): RegionFacts => (giverRegion(q) === 'vale' ? VALE : ANYWHERE);

// ------------------------------------------------------------------ flag contract (docs/CLIENT-v2.md §5)

const STATIC_FLAGS = new Set([
  'kills',
  ...Object.values(NODE_FLAG),
  'meditations',
  'forge_success',
  'brann_gift',
  'mastered_any',
  'class_worn',
]);

function knownFlag(id: string): boolean {
  if (STATIC_FLAGS.has(id)) return true;
  if (id.startsWith('kill_')) return reg.monster(id.slice('kill_'.length)) !== undefined;
  if (id.startsWith(VISITED_FLAG_PREFIX)) return MAP_REGION.has(id.slice(VISITED_FLAG_PREFIX.length));
  if (id.startsWith('warden_')) return reg.monster(id.slice('warden_'.length))?.rank === 'warden';
  return [...reg.items.values()].some((i) => i.kind === 'relic' && i.flag === id);
}

/** Every requirement a quest reads: `requires` plus its state objectives. */
function questRequirements(q: QuestDef): Requirement[] {
  return [
    ...(q.requires ?? []),
    ...q.objectives.flatMap((o) => (o.kind === 'state' ? [o.requires] : [])),
  ];
}

/** Whether a requirement can be met by play inside the given region facts. */
function reachableIn(req: Requirement, facts: RegionFacts): boolean {
  switch (req.type) {
    case 'mapVisited':
      return facts.maps.has(req.id);
    case 'flag': {
      if (req.id.startsWith(VISITED_FLAG_PREFIX)) return facts.maps.has(req.id.slice(VISITED_FLAG_PREFIX.length));
      if (req.id.startsWith('kill_') || req.id.startsWith('warden_')) {
        const id = req.id.slice(req.id.indexOf('_') + 1);
        return facts.monsters.some((m) => m.id === id);
      }
      const node = (Object.keys(NODE_FLAG) as QuestNodeKind[]).find((k) => NODE_FLAG[k] === req.id);
      if (node) return facts.nodes.has(node);
      const relic = [...reg.items.values()].find((i) => i.kind === 'relic' && i.flag === req.id);
      if (relic) return facts.items.has(relic.id);
      return STATIC_FLAGS.has(req.id);
    }
    case 'item':
      return facts.items.has(req.id);
    case 'witness':
      return facts.echoes.has(req.skill);
    case 'skill': {
      const def = reg.skill(req.id);
      if (!def) return false;
      return !def.tags.includes('echo') || facts.echoes.has(req.id);
    }
    case 'lesson': {
      const npc = reg.lesson(req.id)?.trainer.npc;
      return npc !== undefined && facts.npcs.has(npc);
    }
    case 'element':
    case 'elementsKnown':
    case 'level':
    case 'class':
    case 'tagCount':
      return true;
  }
}

/** Ids a requirement references resolve. */
function requirementResolves(req: Requirement): boolean {
  switch (req.type) {
    case 'element':
      return reg.element(req.id) !== undefined;
    case 'skill':
      return reg.skill(req.id) !== undefined;
    case 'class':
      return reg.classDef(req.id) !== undefined;
    case 'item':
      return reg.item(req.id) !== undefined;
    case 'lesson':
      return reg.lesson(req.id) !== undefined;
    case 'mapVisited':
      return MAP_REGION.has(req.id);
    case 'witness':
      return reg.skill(req.skill) !== undefined;
    case 'flag':
      return knownFlag(req.id);
    case 'elementsKnown':
    case 'level':
    case 'tagCount':
      return true;
  }
}

const COUNTED: ReadonlySet<QuestObjective['kind']> = new Set(['kill', 'gather', 'deliver', 'visit', 'talk', 'use', 'cast', 'witness']);

// ------------------------------------------------------------------ tests

describe('quest coverage', () => {
  it('ships ~50 quests in the data bundle and the registry indexes them', () => {
    expect(GAME_DATA.quests).toBe(QUESTS);
    expect(QUESTS.length).toBeGreaterThanOrEqual(40);
    expect(QUESTS.length).toBeLessThanOrEqual(60);
    expect(reg.quests.size).toBe(QUESTS.length);
  });

  it('every NPC gives at least one quest, and every giver / turn-in NPC exists and stands on a map', () => {
    const silent = NPCS.filter((n) => !QUESTS.some((q) => q.giver === n.id)).map((n) => n.id);
    expect(silent).toEqual([]);
    const bad = QUESTS.flatMap((q) =>
      [q.giver, q.turnIn ?? q.giver].filter((id) => !NPC_IDS.has(id) || !NPC_REGION.has(id)).map((id) => `${q.id}: ${id}`),
    );
    expect(bad).toEqual([]);
  });

  it('every trainer lesson is the reward of exactly one quest, given by that trainer', () => {
    const problems: string[] = [];
    for (const t of GAME_DATA.trainers) {
      for (const l of t.lessons) {
        const by = QUESTS.filter((q) => q.rewards.lesson === l.id);
        if (by.length !== 1) problems.push(`${l.id}: rewarded by ${by.length} quests`);
        for (const q of by) if (q.giver !== t.npc) problems.push(`${l.id}: given by ${q.giver}, not ${t.npc}`);
      }
    }
    for (const q of QUESTS) {
      if (q.rewards.lesson !== undefined && !reg.lesson(q.rewards.lesson)) problems.push(`${q.id}: unknown lesson ${q.rewards.lesson}`);
    }
    expect(problems).toEqual([]);
  });

  it('lesson blurbs describe what a lesson teaches, never its price (lessons are quest rewards)', () => {
    const priced = GAME_DATA.trainers.flatMap((t) => t.lessons).filter((l) => /purchase|traded?\b|barter|coin|bring /i.test(l.blurb));
    expect(priced.map((l) => l.id)).toEqual([]);
  });

  it('repeatable lessons (essence trades, passive ranks) are repeatable bounties; one-off lessons are one-off quests', () => {
    const problems: string[] = [];
    for (const q of QUESTS) {
      const lesson = q.rewards.lesson !== undefined ? reg.lesson(q.rewards.lesson)?.lesson : undefined;
      if (!lesson) continue;
      if (!!q.repeatable !== !!lesson.repeatable) problems.push(`${q.id}: repeatable ${!!q.repeatable}, lesson ${!!lesson.repeatable}`);
      if ('essence' in lesson.grants && !q.repeatable) problems.push(`${q.id}: essence lesson behind a one-off quest`);
    }
    expect(problems).toEqual([]);
  });

  it('every bounty cools down 10-20 minutes of play and asks for fresh effort each time', () => {
    const problems: string[] = [];
    for (const q of QUESTS) {
      if (!q.repeatable) continue;
      const ms = q.repeatable.cooldownMs;
      if (ms < 10 * 60_000 || ms > 20 * 60_000) problems.push(`${q.id}: cooldown ${ms} ms`);
      if (!q.objectives.some((o) => COUNTED.has(o.kind))) problems.push(`${q.id}: only live-state objectives`);
    }
    expect(problems).toEqual([]);
    expect(QUESTS.filter((q) => q.repeatable).length).toBeGreaterThan(10);
  });
});

describe('quest references', () => {
  it('passes Registry.validate() with no quest or lesson errors', () => {
    const errs = reg.validate().filter((e) => e.startsWith('quest ') || e.startsWith('lesson '));
    expect(errs).toEqual([]);
  });

  it("ids are unique and read '<giver>_<slug>'", () => {
    const ids = QUESTS.map((q) => q.id);
    expect(new Set(ids).size).toBe(ids.length);
    const bad = QUESTS.filter((q) => !q.id.startsWith(`${q.giver}_`) || !/^[a-z0-9_]+$/.test(q.id.slice(q.giver.length + 1)))
      .map((q) => q.id);
    expect(bad).toEqual([]);
  });

  it('every reward resolves (lesson, skill, passive, element, essences, items, whisper, flag)', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      const r = q.rewards;
      if (r.skill !== undefined && !reg.skill(r.skill)) bad.push(`${q.id}: skill ${r.skill}`);
      if (r.passive !== undefined && !reg.passive(r.passive)) bad.push(`${q.id}: passive ${r.passive}`);
      if (r.element !== undefined && !reg.element(r.element)) bad.push(`${q.id}: element ${r.element}`);
      if (r.whisper !== undefined && !reg.classDef(r.whisper)) bad.push(`${q.id}: whisper ${r.whisper}`);
      if (r.flag !== undefined && !knownFlag(r.flag)) bad.push(`${q.id}: flag ${r.flag}`);
      for (const e of Object.keys(r.essences ?? {})) if (!reg.essence(e)) bad.push(`${q.id}: essence ${e}`);
      for (const i of Object.keys(r.items ?? {})) if (!reg.item(i)) bad.push(`${q.id}: item ${i}`);
      const any = r.lesson ?? r.skill ?? r.passive ?? r.element ?? r.whisper ?? r.flag;
      const amounts = (r.coins ?? 0) + (r.exp ?? 0) + Object.keys(r.essences ?? {}).length + Object.keys(r.items ?? {}).length;
      if (any === undefined && amounts === 0) bad.push(`${q.id}: rewards nothing`);
    }
    expect(bad).toEqual([]);
  });

  it('every requirement (requires + state objectives) resolves and reads only contract flags', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      for (const req of questRequirements(q)) if (!requirementResolves(req)) bad.push(`${q.id}: ${JSON.stringify(req)}`);
      for (const o of q.objectives) if (o.kind === 'state' && o.label.trim().length === 0) bad.push(`${q.id}: unlabeled state`);
    }
    expect(bad).toEqual([]);
  });

  it('kill targets spawn, gather nodes are placed, visit/cast maps exist, deliveries can be obtained — in the giver\'s region', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      const f = factsOf(q);
      for (const o of q.objectives) {
        const at = `${q.id} ${o.kind}`;
        switch (o.kind) {
          case 'kill': {
            if (o.count < 1) bad.push(`${at}: count`);
            if (o.monster !== undefined && !reg.monster(o.monster)) bad.push(`${at}: unknown monster ${o.monster}`);
            const match = f.monsters.some(
              (m) =>
                (o.monster === undefined || m.id === o.monster || m.base === o.monster) &&
                (o.family === undefined || m.family === o.family) &&
                (o.rank === undefined || m.rank === o.rank),
            );
            if (!match) bad.push(`${at}: no matching monster spawns`);
            break;
          }
          case 'gather':
            if (!f.nodes.has(o.node)) bad.push(`${at}: no ${o.node} node`);
            break;
          case 'deliver':
            if (!reg.item(o.item)) bad.push(`${at}: unknown item ${o.item}`);
            else if (!f.items.has(o.item)) bad.push(`${at}: ${o.item} cannot be obtained`);
            break;
          case 'visit':
          case 'cast':
            if (!f.maps.has(o.map)) bad.push(`${at}: map ${o.map}`);
            if (o.kind === 'cast' && o.element !== undefined && !reg.element(o.element)) bad.push(`${at}: element ${o.element}`);
            break;
          case 'talk':
            if (!f.npcs.has(o.npc)) bad.push(`${at}: npc ${o.npc} not reachable`);
            break;
          case 'use':
            if (o.skill !== undefined && (!reg.skill(o.skill) || reg.skill(o.skill)!.tags.includes('monster'))) {
              bad.push(`${at}: skill ${o.skill}`);
            }
            if (o.skill === undefined && o.tag === undefined) break;
            if (o.tag !== undefined && !reg.authoredSkills().some((s) => s.tags.includes(o.tag!) && !s.tags.includes('monster'))) {
              bad.push(`${at}: no player skill tagged ${o.tag}`);
            }
            break;
          case 'witness':
            if (o.skill !== undefined && !f.echoes.has(o.skill)) bad.push(`${at}: ${o.skill} is not an echo spawned here`);
            break;
          case 'state':
            break;
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('Hearth Vale quests only ask for things reachable in Hearth Vale', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      if (giverRegion(q) !== 'vale') continue;
      for (const req of questRequirements(q)) if (!reachableIn(req, VALE)) bad.push(`${q.id}: ${JSON.stringify(req)}`);
      if (q.turnIn !== undefined && NPC_REGION.get(q.turnIn) !== 'vale') bad.push(`${q.id}: turn-in outside the Vale`);
    }
    expect(bad).toEqual([]);
  });
});

describe('quest chains', () => {
  it("'after' references exist and the graph is acyclic", () => {
    const unknown = QUESTS.flatMap((q) => (q.after ?? []).filter((a) => !QUEST_BY_ID.has(a)).map((a) => `${q.id} -> ${a}`));
    expect(unknown).toEqual([]);
    // Kahn's algorithm: every quest must come out of a topological order.
    const indeg = new Map(QUESTS.map((q) => [q.id, (q.after ?? []).length]));
    const ready = QUESTS.filter((q) => (q.after ?? []).length === 0).map((q) => q.id);
    const order: string[] = [];
    while (ready.length > 0) {
      const id = ready.shift()!;
      order.push(id);
      for (const q of QUESTS) {
        if (!(q.after ?? []).includes(id)) continue;
        const n = indeg.get(q.id)! - 1;
        indeg.set(q.id, n);
        if (n === 0) ready.push(q.id);
      }
    }
    expect(QUESTS.map((q) => q.id).filter((id) => !order.includes(id))).toEqual([]);
  });

  it('Hearth Vale chains never wait on a Riftmarch quest', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      if (giverRegion(q) !== 'vale') continue;
      const stack = [...(q.after ?? [])];
      const seen = new Set<string>();
      while (stack.length > 0) {
        const id = stack.pop()!;
        if (seen.has(id)) continue;
        seen.add(id);
        const prev = QUEST_BY_ID.get(id);
        if (!prev) continue;
        if (giverRegion(prev) !== 'vale') bad.push(`${q.id} waits on ${id}`);
        stack.push(...(prev.after ?? []));
      }
    }
    expect(bad).toEqual([]);
  });

  it('every chain start is offerable in its region: Hearth Vale from a fresh save, Riftmarch on arrival', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      if ((q.after ?? []).length > 0) continue;
      const region = giverRegion(q);
      if (region === 'vale') {
        for (const req of q.requires ?? []) if (!reachableIn(req, VALE)) bad.push(`${q.id}: ${JSON.stringify(req)}`);
      } else {
        const arrives = (q.requires ?? []).some((r) => r.type === 'mapVisited' && MAP_REGION.get(r.id) === 'rift');
        if (!arrives) bad.push(`${q.id}: Riftmarch chain start does not require reaching the rift`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('every Hearth Vale NPC offers a quest on a fresh save; every Riftmarch NPC on arrival', () => {
    // A brand-new character: knows the sword basic and has entered Hearthvale.
    const fresh = new SkillBook(reg);
    fresh.learn(WEAPONS.sword.basic, 'starting weapon');
    fresh.incFlag(`${VISITED_FLAG_PREFIX}vale.hearthvale`);
    // Arriving in the rift: the Stormbreak gate opens on Thunderhoof's defeat (relic and storm shard drop).
    const arrived = new SkillBook(reg);
    arrived.learn(WEAPONS.sword.basic, 'starting weapon');
    for (const f of ['warden_thunderhoof', 'relic_storm', 'visited:vale.stormbreak', 'visited:rift.riftgate_road', 'visited:rift.riftmarch']) {
      arrived.incFlag(f);
    }
    const offered = (book: SkillBook, q: QuestDef): boolean => (q.after ?? []).length === 0 && (q.requires ?? []).every((r) => book.meets(r));
    const missing: string[] = [];
    for (const npc of NPCS) {
      const region = NPC_REGION.get(npc.id);
      const book = region === 'vale' ? fresh : arrived;
      if (!QUESTS.some((q) => q.giver === npc.id && offered(book, q))) missing.push(`${npc.id} (${region})`);
    }
    expect(missing).toEqual([]);
  });

  it('Riftmarch pacing: Korrin opens one trade at a time and the far roads wait for the level they ask', () => {
    const korrinStarts = QUESTS.filter((q) => q.giver === 'korrin' && (q.after ?? []).length === 0).map((q) => q.id);
    expect(korrinStarts).toEqual(['korrin_split_grain']);
    const minLevel = (id: string): number =>
      Math.max(0, ...(QUEST_BY_ID.get(id)!.requires ?? []).flatMap((r) => (r.type === 'level' ? [r.min] : [])));
    // Gated at (or within two levels of) the bottom of the band of the hardest map they send the player to.
    expect(minLevel('korrin_far_roads')).toBeGreaterThanOrEqual(14);
    expect(minLevel('korrin_walk_the_roads')).toBeGreaterThanOrEqual(15);
    expect(minLevel('dask_dusk_bloom')).toBeGreaterThanOrEqual(18);
    expect(QUEST_BY_ID.get('dask_dusk_bloom')!.after).toContain('dask_lovely_handwriting');
  });

  it('every Tier I class with a single-parent Tier II child (not hidden) has a Tamsin quest whispering it', () => {
    const missing: string[] = [];
    for (const child of reg.classes) {
      if (child.tier !== 2 || child.hidden || (child.parents ?? []).length !== 1) continue;
      const parent = child.parents![0].id;
      const quest = QUESTS.find(
        (q) => q.giver === 'tamsin' && q.rewards.whisper === child.id && (q.requires ?? []).some((r) => r.type === 'class' && r.id === parent),
      );
      if (!quest) missing.push(`${parent} -> ${child.id}`);
    }
    expect(missing).toEqual([]);
  });

  it("follow-up quests come from the same NPC's chain, or from a waykeeper handing over to another stone", () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      for (const a of q.after ?? []) {
        const prev = QUEST_BY_ID.get(a);
        if (!prev) continue;
        const sameNpc = prev.giver === q.giver;
        const handOver = (prev.turnIn ?? prev.giver) === q.giver;
        if (!sameNpc && !handOver) bad.push(`${q.id} after ${a}`);
      }
    }
    expect(bad).toEqual([]);
  });
});

describe('quest writing', () => {
  /** Sentences in a beat: runs of text ending in . ! or ? followed by a space or the end. */
  const sentences = (text: string): number => text.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0).length;

  it('summaries and dialog beats are present and at most three sentences each', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      if (q.name.trim().length === 0) bad.push(`${q.id}: no name`);
      if (q.summary.trim().length === 0 || q.summary.length > 140) bad.push(`${q.id}: summary length ${q.summary.length}`);
      for (const beat of ['offer', 'progress', 'complete'] as const) {
        const text = q.dialog[beat];
        if (text.trim().length === 0) bad.push(`${q.id}.${beat}: empty`);
        if (sentences(text) > 3) bad.push(`${q.id}.${beat}: ${sentences(text)} sentences`);
        if (text.length > 320) bad.push(`${q.id}.${beat}: ${text.length} chars`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('uses original names only (quests, and the monster / class / item names they show)', () => {
    const banned = /\b(ragnarok|kafra|zeny|prontera|poring|mvp|glimmer|blue magic|rimefang|stormreaver)\b/i;
    const hits = QUESTS.filter((q) => banned.test([q.name, q.summary, q.chain ?? '', ...Object.values(q.dialog)].join(' '))).map((q) => q.id);
    expect(hits).toEqual([]);
    const names = [...reg.monsters.values(), ...reg.classes, ...reg.items.values()].map((d) => d.name);
    expect(names.filter((n) => banned.test(n))).toEqual([]);
  });

  it('never spells out a fusion pair: no beat names both elements of a fused-element recipe beside an altar', () => {
    const elementName = (ref: string): string => reg.element(ref.slice('el:'.length) as never)!.name.toLowerCase();
    const bad: string[] = [];
    for (const q of QUESTS) {
      for (const text of [q.summary, ...Object.values(q.dialog)]) {
        const t = text.toLowerCase();
        if (!/altar|fus/.test(t)) continue;
        for (const r of FUSED_ELEMENT_RECIPES) {
          if (t.includes(elementName(r.a)) && t.includes(elementName(r.b))) bad.push(`${q.id}: ${r.a} + ${r.b}`);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it('rewards stay in scale: bounded coins and exp, bounties pay less than story quests', () => {
    const bad: string[] = [];
    for (const q of QUESTS) {
      const coins = q.rewards.coins ?? 0;
      const exp = q.rewards.exp ?? 0;
      if (coins > 500 || exp > 600) bad.push(`${q.id}: ${coins} coins / ${exp} exp`);
      if (q.repeatable && coins > 150) bad.push(`${q.id}: bounty pays ${coins} coins`);
      // A lesson is the prize (trainer lessons once cost coins): little or no coin on top of it.
      if (q.rewards.lesson !== undefined && coins > (q.repeatable ? 0 : 10)) bad.push(`${q.id}: lesson quest pays ${coins} coins`);
      // Korrin pays in essence, never in coin (his dialog says so).
      if (q.giver === 'korrin' && coins > 0) bad.push(`${q.id}: Korrin pays ${coins} coins`);
    }
    expect(bad).toEqual([]);
  });

  it('Hearth Vale story quests leave a good share of the levelling to fighting (< 60% of the exp to level 12)', () => {
    // Player level curve (src/game/session.ts expToNext): floor(24 * L^1.6) exp from level L to L + 1.
    let toTwelve = 0;
    for (let level = 1; level < 12; level++) toTwelve += Math.floor(24 * Math.pow(level, 1.6));
    // Tamsin's class-imprint quests each need a different class worn: count the best-paying one only.
    const imprint = (q: QuestDef): boolean => q.giver === 'tamsin' && q.id.endsWith('_imprint');
    const story = QUESTS.filter((q) => giverRegion(q) === 'vale' && !q.repeatable);
    const exp = (q: QuestDef): number => q.rewards.exp ?? 0;
    const vale = story.filter((q) => !imprint(q)).reduce((n, q) => n + exp(q), 0) + Math.max(0, ...story.filter(imprint).map(exp));
    expect(vale).toBeLessThan(0.6 * toTwelve);
  });
});

describe('quests teach the systems in-world', () => {
  const find = (pred: (q: QuestDef) => boolean): QuestDef[] => QUESTS.filter(pred);
  const hasObjective = (q: QuestDef, pred: (o: QuestObjective) => boolean): boolean => q.objectives.some(pred);

  it("Hale's first quest is the tutorial: Jellops, the basic attack, rank 3", () => {
    const first = QUESTS.find((q) => q.giver === 'hale' && (q.after ?? []).length === 0 && !q.repeatable && (q.requires ?? []).length === 0);
    expect(first?.id).toBe('hale_first_drill');
    expect(hasObjective(first!, (o) => o.kind === 'kill' && o.monster === 'jellop')).toBe(true);
    expect(hasObjective(first!, (o) => o.kind === 'use' && o.tag === 'basic')).toBe(true);
    expect(
      hasObjective(first!, (o) => o.kind === 'state' && o.requires.type === 'tagCount' && o.requires.tags.includes('basic') && o.requires.minRank === 3),
    ).toBe(true);
  });

  it('forging (Brann), fishing (Pell), stillness and mastery (Oru), classes (Tamsin) and holy light (Alba) each have a quest', () => {
    const stateFlag = (q: QuestDef, id: string): boolean =>
      hasObjective(q, (o) => o.kind === 'state' && o.requires.type === 'flag' && o.requires.id === id);
    expect(find((q) => q.giver === 'brann' && stateFlag(q, 'forge_success')).length).toBeGreaterThan(0);
    expect(find((q) => q.giver === 'pell' && hasObjective(q, (o) => o.kind === 'gather' && o.node === 'fishing')).length).toBeGreaterThan(0);
    const meditation = QUESTS.find((q) => q.rewards.lesson === 'oru_meditation');
    expect(meditation && stateFlag(meditation, 'mastered_any')).toBe(true);
    expect(find((q) => q.giver === 'tamsin' && stateFlag(q, 'class_worn')).length).toBeGreaterThan(0);
    expect(find((q) => q.giver === 'alba' && q.rewards.element === 'holy').length).toBe(1);
  });

  it('fusion (an infused skill), echoes (witness marks) and sparks (worthy fights) each have a quest', () => {
    const infused = find((q) =>
      hasObjective(q, (o) => o.kind === 'state' && o.requires.type === 'tagCount' && o.requires.tags.includes('infused')),
    );
    expect(infused.length).toBeGreaterThan(0);
    expect(find((q) => hasObjective(q, (o) => o.kind === 'witness')).length).toBeGreaterThan(0);
    const spark = find(
      (q) => hasObjective(q, (o) => o.kind === 'use' && o.tag === 'basic' && o.count >= 20) && hasObjective(q, (o) => o.kind === 'kill'),
    );
    expect(spark.length).toBeGreaterThan(0);
  });

  it('Lio asks for a dash first and for ice at Mirror Lake later', () => {
    const dash = QUESTS.find((q) => q.giver === 'child_lio' && hasObjective(q, (o) => o.kind === 'cast' && o.shape === 'dash'));
    const ice = QUESTS.find(
      (q) => q.giver === 'child_lio' && hasObjective(q, (o) => o.kind === 'cast' && o.element === 'ice' && o.map === 'vale.mirror_lake'),
    );
    expect(dash).toBeDefined();
    expect(ice?.after).toContain(dash!.id);
  });
});

// ------------------------------------------------------------------ playthroughs through the SkillBook API

describe('quest playthroughs (SkillBook)', () => {
  /** A bag the SkillBook can read and spend from. */
  function bagOf(items: Record<string, number>): Inventory {
    return {
      count: (id) => items[id] ?? 0,
      coins: () => 0,
      spend: (cost) => {
        const want = Object.entries(cost.items ?? {});
        if ((cost.coins ?? 0) > 0 || want.some(([id, n]) => (items[id] ?? 0) < n)) return false;
        for (const [id, n] of want) items[id] = (items[id] ?? 0) - n;
        return true;
      },
    };
  }

  function newBook(): { book: SkillBook; bag: Record<string, number>; clock: { t: number } } {
    const book = new SkillBook(reg);
    const bag: Record<string, number> = {};
    const clock = { t: 0 };
    book.inv = bagOf(bag);
    book.now = () => clock.t;
    book.learn(WEAPONS.sword.basic, 'starting weapon');
    return { book, bag, clock };
  }

  const kill = (book: SkillBook, id: string, n: number): void => {
    const monster = reg.monster(id)!;
    for (let i = 0; i < n; i++) {
      book.recordKill(monster);
      book.notifyQuest({ type: 'kill', monster });
    }
  };

  it("Hale's tutorial: Jellops and basic-attack ranks teach Rising Kick, then open the next drills", () => {
    const { book } = newBook();
    const slash = reg.skill(WEAPONS.sword.basic)!;
    const jellop = reg.monster('jellop')!;
    expect(book.questStatus('hale_first_drill')).toBe('available');
    expect(book.questStatus('hale_whole_body')).toBe('locked');
    expect(book.acceptQuest('hale_first_drill').ok).toBe(true);
    for (let i = 0; i < 12; i++) {
      book.recordUse(slash.id, 1);
      book.notifyQuest({ type: 'use', skill: slash });
    }
    for (let i = 0; book.rank(slash.id) < 3 && i < 200; i++) {
      book.recordHit(slash.id, { monster: jellop, killed: true, hitIndex: 0, instanceHits: 0 });
    }
    expect(book.questStatus('hale_first_drill')).toBe('active');
    kill(book, 'jellop', 6);
    expect(book.questStatus('hale_first_drill')).toBe('ready');
    const res = book.turnInQuest('hale_first_drill', 'hale');
    expect(res.ok).toBe(true);
    expect(res.gameRewards.coins).toBe(QUEST_BY_ID.get('hale_first_drill')!.rewards.coins);
    expect(book.has('rising_kick')).toBe(true);
    expect(book.questStatus('hale_first_drill')).toBe('done');
    for (const next of ['hale_whole_body', 'hale_footwork', 'hale_crack_it_open']) expect(book.questStatus(next), next).toBe('available');
  });

  it("Brann's forge quest teaches Hammer Toss after three good forges; The Big Hammer waits for five", () => {
    const { book } = newBook();
    book.acceptQuest('brann_heat_in_hands');
    for (let i = 0; i < 3; i++) book.incFlag('forge_success');
    expect(book.questStatus('brann_heat_in_hands')).toBe('ready');
    expect(book.turnInQuest('brann_heat_in_hands', 'brann').ok).toBe(true);
    expect(book.has('hammer_toss')).toBe(true);
    expect(book.questStatus('brann_big_hammer')).toBe('locked');
    book.incFlag('forge_success', 2);
    expect(book.questStatus('brann_big_hammer')).toBe('available');
  });

  it('an essence bounty pays its essence, consumes the delivery and comes back after its cooldown', () => {
    const { book, bag, clock } = newBook();
    expect(book.acceptQuest('brann_anvil_dust').ok).toBe(true);
    kill(book, 'cragling', 10);
    expect(book.questStatus('brann_anvil_dust')).toBe('active'); // no ore yet
    bag.ore = 5;
    expect(book.questStatus('brann_anvil_dust')).toBe('ready');
    const before = book.state.essences.heavy ?? 0;
    expect(book.turnInQuest('brann_anvil_dust', 'brann').ok).toBe(true);
    expect((book.state.essences.heavy ?? 0) - before).toBe(1);
    expect(bag.ore).toBe(1);
    expect(book.questStatus('brann_anvil_dust')).toBe('cooldown');
    clock.t += QUEST_BY_ID.get('brann_anvil_dust')!.repeatable!.cooldownMs;
    expect(book.questStatus('brann_anvil_dust')).toBe('available');
  });

  it('a passive drill raises its passive one rank per completion', () => {
    const { book, bag, clock } = newBook();
    book.state.quests!.done.hale_first_drill = 1;
    const cooldown = QUEST_BY_ID.get('hale_footwork')!.repeatable!.cooldownMs;
    for (let round = 1; round <= 2; round++) {
      expect(book.acceptQuest('hale_footwork').ok, `round ${round}`).toBe(true);
      kill(book, 'jellop', 10);
      bag.herb = 4;
      expect(book.turnInQuest('hale_footwork', 'hale').ok).toBe(true);
      expect(book.state.passives.sure_footing).toBe(round);
      clock.t += cooldown;
    }
  });

  it("Mirelle's hand-over is turned in at Emberwatch, to the other Mirelle", () => {
    const { book } = newBook();
    book.state.quests!.done.mirelle_stones_remember = 1;
    book.acceptQuest('mirelle_same_purse');
    book.notifyQuest({ type: 'visit', map: 'vale.emberwatch' });
    expect(book.questStatus('mirelle_same_purse')).toBe('ready');
    expect(book.turnInQuest('mirelle_same_purse', 'mirelle').ok).toBe(false);
    expect(book.turnInQuest('mirelle_same_purse', 'mirelle_2').ok).toBe(true);
  });
  it('Stand in Its Way cannot soft-lock: marks banked before accepting, or the echo already learned', () => {
    // A rank-3 dash anchors the echo; two marks are banked in the quarry before Gus offers the quest.
    const banked = newBook().book;
    banked.state.quests!.done.miner_gus_good_haul = 1;
    banked.learn('shoulder_charge', 'test');
    banked.state.skills.shoulder_charge.rank = 3;
    const witness = (book: SkillBook): void => {
      const before = book.state.witness.boulder_roll ?? 0;
      book.witness('boulder_roll');
      // The game reports a mark to the quests only when one was earned.
      if ((book.state.witness.boulder_roll ?? 0) > before) book.notifyQuest({ type: 'witness', skill: 'boulder_roll' });
    };
    witness(banked);
    witness(banked);
    expect(banked.acceptQuest('miner_gus_stand_in_its_way').ok).toBe(true);
    witness(banked); // third mark: the echo is learned
    expect(banked.has('boulder_roll')).toBe(true);
    expect(banked.questStatus('miner_gus_stand_in_its_way')).toBe('ready');
    expect(banked.turnInQuest('miner_gus_stand_in_its_way', 'miner_gus').ok).toBe(true);
    // Learned long before Gus asked.
    const early = newBook().book;
    early.state.quests!.done.miner_gus_good_haul = 1;
    early.learn('boulder_roll', 'echo:boulderback');
    early.acceptQuest('miner_gus_stand_in_its_way');
    expect(early.questStatus('miner_gus_stand_in_its_way')).toBe('ready');
  });

  it('a passive drill stops being offered once its passive is at max rank (no fourth round)', () => {
    const { book, bag, clock } = newBook();
    book.state.quests!.done.hale_first_drill = 1;
    const cooldown = QUEST_BY_ID.get('hale_footwork')!.repeatable!.cooldownMs;
    const max = reg.passive('sure_footing')!.maxRank;
    for (let round = 1; round <= max; round++) {
      expect(book.acceptQuest('hale_footwork').ok, `round ${round}`).toBe(true);
      kill(book, 'jellop', 10);
      bag.herb = 4;
      expect(book.turnInQuest('hale_footwork', 'hale').rewards.lesson).toBe('hale_sure_footing');
      clock.t += cooldown;
    }
    expect(book.state.passives.sure_footing).toBe(max);
    expect(book.questStatus('hale_footwork')).toBe('done');
    expect(book.acceptQuest('hale_footwork').ok).toBe(false);
    expect(book.quests('hale').filter((v) => v.status === 'available').map((v) => v.quest.id)).not.toContain('hale_footwork');
  });

  it('every lesson is questOnly: trainers never sell it, its quest teaches it', () => {
    const lessons = GAME_DATA.trainers.flatMap((t) => t.lessons);
    expect(lessons.filter((l) => l.questOnly !== true).map((l) => l.id)).toEqual([]);
    const { book } = newBook();
    book.inv = { count: () => 0, coins: () => 999, spend: () => true };
    expect(book.takeLesson('hale_rising_kick')).toEqual({ ok: false, message: `Learned through ${QUEST_BY_ID.get('hale_first_drill')!.name}` });
    expect(book.has('rising_kick')).toBe(false);
    expect(book.lessonState('hale_rising_kick')).toMatchObject({ questOnly: true, quest: 'hale_first_drill' });
    expect(book.questStatus('hale_first_drill')).toBe('available');
  });

  it("Thin the Pack needs ten Emberkits besides the Alpha", () => {
    const { book } = newBook();
    book.state.quests!.done.scout_rhea_eyes_on_ash = 1;
    book.acceptQuest('scout_rhea_thin_the_pack');
    kill(book, 'emberkit', 9);
    kill(book, 'emberkit_alpha', 1);
    expect(book.questStatus('scout_rhea_thin_the_pack')).toBe('active');
    kill(book, 'emberkit', 1);
    expect(book.questStatus('scout_rhea_thin_the_pack')).toBe('ready');
  });

  it('Crack It Open counts an infused basic attack as the basic attack', () => {
    const { book } = newBook();
    book.state.quests!.done.hale_first_drill = 1;
    book.acceptQuest('hale_crack_it_open');
    const blazing = reg.skill(`${WEAPONS.sword.basic}@fire`)!;
    book.notifyQuest({ type: 'use', skill: blazing });
    expect(book.questProgress('hale_crack_it_open')[1].text).toBe('Use basic skills 1/30');
  });
});
