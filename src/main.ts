import { CLASS, kitSkillsAt } from './core/classes';
import { MASTERY } from './core/mastery';
import type { ClassDef, ElementId, SkillDef, SkillShape, StatusKind, WeaponType } from './core/types';
import { createRegistry } from './data';
import { mapById } from './data/world';
import { gameBus } from './game/events';
import { initAudio } from './game/audio';
import { createGame } from './game/render/config';
import { type ContextLossHandle, installContextLoss } from './game/render/contextloss';
import { type PerfHandle, installPerf } from './game/render/perf';
import { type QualityDebug, installQuality, persistStorageOnce } from './game/render/quality';
import { BootScene } from './game/scenes/BootScene';
import { MapScene } from './game/scenes/MapScene';
import { wireQuestHooks } from './game/quests';
import { SAVE_KEY, SAVE_KEY_V1, SAVE_KEY_V2, Session } from './game/session';
import { ownedWeapons } from './game/systems/weapons';
import { showTitle } from './ui/title';
import { UI } from './ui/ui';
import './ui/styles/base.css';
import './ui/styles/hud.css';
import './ui/styles/panels.css';
import './ui/styles/dialogs.css';
import './ui/styles/maps.css';

const params = new URLSearchParams(location.search);
if (params.has('fast')) MASTERY.rate = Number(params.get('fast')) || 6;

const reg = createRegistry();
if (import.meta.env.DEV) {
  const errs = reg.validate();
  if (errs.length) console.warn('[omnipath] data problems:', errs);
}

// Phaser config, pixel-perfect scaling and fonts: src/game/render/config.ts (render lane).
const game = createGame([BootScene, MapScene], reg);

interface OmnipathHandle {
  game: ReturnType<typeof createGame>;
  session?: Session;
  reg: typeof reg;
  scene?: MapScene;
  ui?: UI;
  debug?: Record<string, (...args: never[]) => unknown>;
  /** Quality lane: tiers + battery saver, the ?perf overlay, WebGL context-loss re-bake (QA hooks). */
  quality?: QualityDebug;
  perf?: PerfHandle;
  context?: ContextLossHandle;
}
const handle: OmnipathHandle = { game, reg };
(window as unknown as { omnipath: OmnipathHandle }).omnipath = handle;
initAudio(handle); // sound: unlock on the first tap, suspend when hidden / muted / idle; omnipath.debug.audio hooks
// Quality tiers / battery saver (☰ menu), WebGL context-loss re-bake, and the ?perf overlay (src/game/render/*).
handle.quality = installQuality(game);
handle.context = installContextLoss(game);
handle.perf = installPerf(game);

game.events.once('omnipath:ready', async () => {
  const uiRoot = document.getElementById('ui')!;
  const existing = Session.load(reg);
  const choice = await showTitle(uiRoot, !!existing, existing?.player.name);
  let session: Session;
  if (choice.kind === 'continue' && existing) session = existing;
  else {
    Session.clear();
    Session.locked = false;
    session = Session.create(reg, choice.name!, choice.weapon!);
    session.save();
  }
  const scene = game.scene.getScene('Map') as MapScene;
  scene.bind(session);
  // World events → quest counters (kill, gather, visit, talk, use, cast, witness), once per run.
  wireQuestHooks(session.book);
  // The DOM UI is created once and survives every map restart; the scene instance is its GameController.
  const ui = new UI(uiRoot, scene);
  game.scene.start('Map', { session, ui });

  const save = () => {
    if (scene.sys.isActive() || scene.sys.isPaused()) scene.save();
  };
  document.addEventListener('visibilitychange', () => document.hidden && save());
  window.addEventListener('pagehide', save);

  handle.session = session;
  handle.scene = scene;
  handle.ui = ui;
  // A save exists now (new game: just written; continue: loaded): ask once to keep the site's storage.
  void persistStorageOnce();
  // Dev / test hooks (harmless in production: they only do what the game could already do).
  handle.debug = {
    warp: (mapId: string, portalId?: string) => scene.debugWarp(mapId, portalId),
    give: (itemId: string, n = 1) => {
      scene.obtain(itemId, n, 'debug');
      ui.refresh();
      return session.count(itemId);
    },
    learn: (skillId: string) => session.book.learn(skillId, 'debug'),
    element: (id: string) => session.book.learnElement(id as ElementId, 'debug'),
    setLevel: (n: number) => {
      session.setLevel(n);
      const st = scene.stats();
      session.player.hp = st.maxHp;
      session.player.sp = st.maxSp;
      ui.updateVitals();
      return session.player.level;
    },
    heal: () => {
      const st = scene.stats();
      session.player.hp = st.maxHp;
      session.player.sp = st.maxSp;
    },
    /** Attacks the nearest monster until it dies (manual attack command). Returns its id or null. */
    fight: () => {
      const m = scene.combat.nearestMonster(4000);
      if (m) {
        scene.combat.lastInput = scene.time.now;
        scene.combat.attackUntilDead(m);
      }
      return m?.def.id ?? null;
    },
    info: () => ({
      map: scene.mapId,
      x: Math.round(scene.player?.x ?? 0),
      y: Math.round(scene.player?.y ?? 0),
      hp: Math.round(session.player.hp),
      level: session.player.level,
      kills: session.book.flag('kills'),
      monsters: scene.combat.monsters.filter((m) => m.alive).length,
      target: scene.combat.target?.def.id ?? null,
      panel: ui.current,
      open: ui.isOpen,
      known: session.book.known().length,
      props: scene.visibleProps,
    }),
    mapExists: (id: string) => !!mapById(id),
    /** Walks (real pathfinding + portal contact) to a portal of the current map. */
    walkToPortal: (portalId: string) => {
      const v = scene.portals.find((p) => p.def.id === portalId);
      if (!v) return false;
      scene.combat.setTarget(null);
      scene.player.path = scene.pathTo(v.x, v.y) ?? [];
      return scene.player.path.length > 0;
    },
    /** Teleports within the current map (px). */
    place: (x: number, y: number) => {
      scene.player.x = x;
      scene.player.y = y;
      scene.player.path = [];
      return true;
    },
    portals: () =>
      scene.portals.map((p) => ({ id: p.def.id, to: p.def.to.map, open: p.open, x: p.x, y: p.y, kind: p.def.kind })),
    assign: (slot: number, skillId: string | null) => {
      scene.assignSlot(slot, skillId);
      return session.player.hotbar[slot];
    },
    cast: (slot: number) => {
      scene.combat.lockUntil = 0;
      scene.castSlot(slot);
      return true;
    },
    /** Listener counts (warping must not grow them). */
    listeners: () => {
      const em = session.book.events as unknown as { listeners: Map<string, Set<unknown>> };
      let book = 0;
      for (const set of em.listeners.values()) book += set.size;
      return {
        book,
        bus: gameBus.count(),
        resize: game.scale.listenerCount('resize'),
        sceneEvents: scene.events.eventNames().reduce((a, n) => a + scene.events.listenerCount(n), 0),
      };
    },
    /** v3 views (docs/INTEGRATION-v3.md §8): what the HUD / panels see. */
    bar: () => scene.barSlots(),
    quests: (npcId?: string) => (npcId ? scene.npcQuests(npcId) : scene.questLog()),
    classes: () => scene.classCards(),
    pursuits: () => scene.pursuits(),
    card: (skillId: string) => scene.skillCard(skillId),
    stars: () => {
      const d = scene.starChartData();
      return { stars: d.stars.length, links: d.links.length, charted: d.charted, total: d.total };
    },
    // ---------------------------------------------------------------- v3 game lane: classes, bar, quests
    /** Becomes a class (null = "No class") through the real path; unlocks it first when `force` (QA only). */
    become: (classId: string | null, force = false) => {
      const forced = classId ? reg.classDef(classId) : undefined;
      if (classId && force && !session.book.state.classes[classId] && forced) {
        session.book.state.classes[classId] = { rank: 1, xp: 0 };
        // A forced unlock skips the book's discovery: grant what discovery would (kit skills 1 and 2).
        for (const id of kitSkillsAt(forced, 1)) if (reg.skill(id) && !session.book.has(id)) session.book.learn(id, `class:${classId}`);
      }
      const r = scene.becomeClass(classId);
      ui.refresh();
      return { ...r, worn: session.book.state.worn, bar: [...session.player.hotbar] };
    },
    /** The bar in one line per slot: '1 class whirlwind', '6 own -' (class slots first while a class is worn). */
    slots: () => scene.barSlots().map((v) => `${v.key} ${v.kind} ${v.skillId ?? '-'}`),
    /** What the worn class would put in its slots right now (best first). */
    classPicks: () => (session.book.state.worn ? session.book.classSkills(session.book.state.worn, 8) : []),
    /** Equips into one of your slots (the real path: refills the class slots after). */
    equip: (skillId: string, slot?: number) => scene.equipSkill(skillId, slot),
    /** Accepts a quest at its giver (or `npcId`). */
    accept: (questId: string, npcId?: string) => {
      const q = reg.quest(questId);
      const r = scene.acceptQuest(questId, npcId ?? q?.giver ?? '');
      ui.refresh();
      return { ...r, status: session.book.questStatus(questId) };
    },
    /** Turns a quest in at its turn-in NPC (or `npcId`); returns the reward card view. */
    turnIn: (questId: string, npcId?: string) => {
      const q = reg.quest(questId);
      const r = scene.turnInQuest(questId, npcId ?? q?.turnIn ?? q?.giver ?? '');
      ui.refresh();
      return r;
    },
    /** Completes every objective of an active quest (accepting it first): counters filled, deliveries put in the
     *  bag. `state` objectives stay live. Returns the quest status ('ready' when done). */
    complete: (questId: string) => {
      const q = reg.quest(questId);
      if (!q) return 'unknown';
      if (!session.book.state.quests?.active[questId]) scene.acceptQuest(questId, q.giver);
      const a = session.book.state.quests?.active[questId];
      if (!a) return session.book.questStatus(questId);
      q.objectives.forEach((o, i) => {
        if (o.kind === 'deliver') session.addItem(o.item, Math.max(0, o.count - session.count(o.item)));
        else if (o.kind !== 'state') a.progress[i] = 'count' in o ? o.count : 1;
      });
      session.book.refreshQuests();
      ui.refresh();
      return session.book.questStatus(questId);
    },
    /** An NPC's quests with status, or every quest with status. */
    questStatus: (npcId?: string) =>
      session.book.quests(npcId).map((v) => `${v.quest.id} ${v.status}`),
    /** Simulates talking to an NPC (quest talk objectives) without walking there. */
    talk: (npcId: string) => {
      gameBus.emit('talk', { npcId, map: scene.mapId, x: scene.player.x, y: scene.player.y });
      return session.book.questMarker(npcId);
    },
    /** Opens the real dialog of an NPC on this map (role options + its quests), as if the player tapped it. */
    npc: (npcId: string) => {
      const v = scene.npcs.find((n) => n.def.id === npcId);
      if (!v) return false;
      scene.interactions.act(v);
      return true;
    },
    /** Quality lane: the ?perf overlay on / off (toggles without an argument); returns whether it shows. */
    perf: (on?: boolean) => handle.perf?.toggle(on) ?? false,
    /** Quality lane: picks a quality tier ('low' | 'medium' | 'high', null = automatic); returns the state. */
    quality: (tier?: 'low' | 'medium' | 'high' | null) => (tier === undefined ? handle.quality?.state() : handle.quality?.set(tier)),
    /** The rest button (sit and recover until you move, cast or are hit). */
    rest: () => scene.useQuick('rest'),
    // ---------------------------------------------------------------- v4 game lane: weapons, mechanic, new kinds
    /** Holds a weapon through the real path ('fists' = Bare Hands); `force` owns it first and skips the cooldown. */
    weapon: (w?: WeaponType, force = false) => {
      const pl = session.player;
      if (w) {
        if (force) {
          pl.ownedWeapons = ownedWeapons([...pl.ownedWeapons, w], pl.weapon);
          session.weaponSwapAt = 0;
        }
        const r = scene.equipWeapon(w);
        ui.refresh();
        return { ...r, held: pl.weapon, owned: [...pl.ownedWeapons], swapIn: scene.weaponSwapIn() };
      }
      return { ok: true, held: pl.weapon, owned: [...pl.ownedWeapons], swapIn: scene.weaponSwapIn() };
    },
    /** Bare Hands (the real path; the swap cooldown applies unless `force`). */
    equipFists: (force = false) => {
      if (force) session.weaponSwapAt = 0;
      const r = scene.unequipWeapon();
      ui.refresh();
      return { ...r, held: session.player.weapon };
    },
    /** Whether a skill can be cast now, and the weapon lock line if it cannot ("Needs a sword"). */
    usable: (skillId: string) => ({ ...scene.usable(skillId), lock: scene.weaponLock(skillId) }),
    /** The lock line's Equip action for a skill. */
    equipFor: (skillId: string) => scene.equipFor(skillId),
    /** Sets the Class Level of a class (default: the worn one) and learns the kit skills it unlocks (QA only). */
    classLevel: (n: number, classId?: string) => {
      const id = classId ?? session.book.state.worn;
      const cls = id ? reg.classDef(id) : undefined;
      if (!id || !cls) return null;
      const level = Math.max(1, Math.min(CLASS.maxLevel, Math.floor(n)));
      session.book.state.classes[id] = { rank: level, xp: 0 };
      (session.book as unknown as { invalidate(): void }).invalidate();
      for (const k of kitSkillsAt(cls, level)) if (reg.skill(k) && !session.book.has(k)) session.book.learn(k, `class:${id}`);
      ui.refresh();
      return { classId: id, level, kit: session.book.kitSkills(id), bar: [...session.player.hotbar] };
    },
    /** The mechanic widget, its raw state and the stats it gives right now. */
    mech: () => ({ view: scene.mechanicView(), state: session.mechanic.state, stats: session.mechanic.stats(scene.combat.nearLevel()), near: scene.combat.nearLevel() }),
    /** Fills the worn class's gauge (to `value`, default its max): the "meter full" moment fires when it gets there. */
    fillGauge: (value?: number) => {
      const rt = session.mechanic;
      const m = rt.mech();
      if (m?.kind !== 'gauge' || rt.state.kind !== 'gauge') return null;
      const to = value ?? m.max ?? 10;
      const was = rt.state.value;
      rt.state = { ...rt.state, value: to, idleMs: 0 };
      if (m.max !== null && was < m.max && to >= m.max) rt.onEffects([{ type: 'full', name: m.name }]);
      return scene.mechanicView();
    },
    /** The stance button. */
    stance: () => scene.mechanicTap(),
    /** Casts a known skill by id, on the bar or not (through the real cast path; after-cast lock skipped). */
    castSkill: (skillId: string) => {
      scene.combat.lockUntil = 0;
      return scene.combat.castSkill(skillId);
    },
    /**
     * Places a test zone at the player (or `at`): a plain damaging disc (radius px, lasting ms, ticking every ms)
     * cast as the held weapon's basic attack — no skill needed (QA for the shared world-object helper).
     */
    spawnZone: (radius = 60, durationMs = 4000, tickMs = 500, line = 0) => {
      const base = reg.skill(session.player.hotbar.find((id) => !!id) ?? '') ?? session.book.known()[0];
      if (!base) return null;
      const shape: SkillShape = { kind: 'zone', radius, range: 0, durationMs, tickMs, ...(line > 0 ? { line: { length: line } } : {}) };
      const skill: SkillDef = { ...base, shape, power: 0.4, riders: undefined };
      const p = scene.player;
      const cast = scene.skills.newCast(skill, 1, { x: p.x, y: p.y });
      scene.skills.execute(cast, { x: p.x + Math.cos(p.aimAngle) * 80, y: p.y + Math.sin(p.aimAngle) * 80 }, null);
      return scene.skills.objects.all().map((o) => ({ id: o.id, x: Math.round(o.x), y: Math.round(o.y), radius: o.radius, ticksLeft: o.ticksLeft, mech: o.mech ?? null }));
    },
    /** Everything the player's skills have placed on this map. */
    objects: () => scene.skills.objects.all().map((o) => ({ id: o.id, skill: o.skill.id, x: Math.round(o.x), y: Math.round(o.y), radius: o.radius, level: o.level, ticks: o.ticks, ticksLeft: o.ticksLeft, mech: o.mech ?? null, forever: !Number.isFinite(o.until) })),
    /** Puts a status on the nearest monster ('monster') or on the player ('player'). */
    status: (kind: StatusKind, who: 'monster' | 'player' = 'monster') => {
      const p = scene.player;
      if (who === 'player') {
        scene.combat.applyPlayerStatus(kind, 20, 'debug', { source: { x: p.x + 60, y: p.y }, rank: 'common' });
        return Object.keys(p.marks);
      }
      const m = scene.combat.nearestMonster(4000);
      if (!m) return null;
      scene.combat.applyStatus(m, kind, 20, { x: p.x, y: p.y });
      return { monster: m.def.id, statuses: m.statuses(scene.time.now) };
    },
    /** The shell a shield skill raised (null: none), and the player's statuses. */
    shell: () => ({ shield: scene.combat.shieldLeft(), marks: Object.keys(scene.player.marks).filter((k) => (scene.player.marks[k as StatusKind] ?? 0) > scene.time.now) }),
    /** Hurts the player as a monster blow would (shield / mechanic checks). */
    hurt: (atk = 30) => scene.combat.hurtPlayer(atk, 'debug', { source: { x: scene.player.x + 40, y: scene.player.y } }),
    /** Deed-style counters: flags starting with a prefix ('hits:', 'kills:'). */
    flags: (prefix = '') => Object.fromEntries(Object.entries(session.book.state.flags).filter(([k]) => k.startsWith(prefix))),
    /** Which save keys exist (v3 is written; v2 / v1 are only ever read). */
    saveKeys: () => ({ v3: !!localStorage.getItem(SAVE_KEY), v2: !!localStorage.getItem(SAVE_KEY_V2), v1: !!localStorage.getItem(SAVE_KEY_V1) }),
    /**
     * QA only: adds temporary skills / classes to the running registry (content that has not landed yet), so the
     * runtime can be driven end to end without touching src/data. Never used by the game itself.
     */
    define: (data: { skills?: SkillDef[]; classes?: ClassDef[] }) => {
      const r = reg as unknown as { skills: Map<string, SkillDef>; classIndex: Map<string, ClassDef>; classes: ClassDef[] };
      for (const sk of data.skills ?? []) {
        const tags = [...new Set([...sk.tags, ...(sk.element ? [sk.element] : []), ...(sk.weapons ?? [])])];
        r.skills.set(sk.id, { ...sk, tags });
      }
      for (const c of data.classes ?? []) {
        if (!r.classIndex.has(c.id)) r.classes.push(c);
        else r.classes.splice(r.classes.findIndex((x) => x.id === c.id), 1, c);
        r.classIndex.set(c.id, c);
      }
      return { skills: (data.skills ?? []).map((x) => x.id), classes: (data.classes ?? []).map((x) => x.id) };
    },
    /** Counts game-bus events by name until called again with false (sound / VFX / quest hook checks). */
    tapBus: (on = true) => {
      const w = window as unknown as { __busTap?: { counts: Record<string, number>; off: () => void } };
      w.__busTap?.off();
      delete w.__busTap;
      if (!on) return null;
      const counts: Record<string, number> = {};
      const names = ['hit', 'kill', 'castStart', 'castFire', 'projectileSpawn', 'projectileEnd', 'chainHop', 'novaTelegraph', 'novaBlast', 'dash', 'buffApplied', 'statusApplied', 'combo', 'heal', 'playerHurt', 'death', 'levelUp', 'gather', 'mapEnter', 'warp', 'talk', 'interact', 'questChanged', 'uiOpen', 'uiClose', 'discovery', 'classChanged', 'skillLearned', 'barChanged', 'spark', 'monsterTelegraph', 'dotTick', 'skillPulse', 'monsterTelegraphEnd', 'enrage', 'objectSpawn', 'objectTick', 'objectEnd', 'blink', 'mend', 'shieldUp', 'shieldHit', 'shieldEnd', 'weaponChanged', 'mechanic', 'mendEnd'] as const;
      const offs = names.map((n) =>
        gameBus.on(n, (e) => {
          counts[n] = (counts[n] ?? 0) + 1;
          // the class mechanic by what it did ('mechanic:full', 'mechanic:finisher'…)
          if (n === 'mechanic') counts[`mechanic:${(e as { type: string }).type}`] = (counts[`mechanic:${(e as { type: string }).type}`] ?? 0) + 1;
        }),
      );
      w.__busTap = { counts, off: () => offs.forEach((o) => o()) };
      return counts;
    },
  };
});
