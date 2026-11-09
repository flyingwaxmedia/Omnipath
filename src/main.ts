import { MASTERY } from './core/mastery';
import type { ElementId } from './core/types';
import { createRegistry } from './data';
import { mapById } from './data/world';
import { gameBus } from './game/events';
import { createGame } from './game/render/config';
import { BootScene } from './game/scenes/BootScene';
import { MapScene } from './game/scenes/MapScene';
import { wireQuestHooks } from './game/quests';
import { Session } from './game/session';
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
}
const handle: OmnipathHandle = { game, reg };
(window as unknown as { omnipath: OmnipathHandle }).omnipath = handle;

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
      if (classId && force && !session.book.state.classes[classId] && reg.classDef(classId)) {
        session.book.state.classes[classId] = { rank: 1, xp: 0, spent: {} };
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
    /** The rest button (sit and recover until you move, cast or are hit). */
    rest: () => scene.useQuick('rest'),
    /** Counts game-bus events by name until called again with false (sound / VFX / quest hook checks). */
    tapBus: (on = true) => {
      const w = window as unknown as { __busTap?: { counts: Record<string, number>; off: () => void } };
      w.__busTap?.off();
      delete w.__busTap;
      if (!on) return null;
      const counts: Record<string, number> = {};
      const names = ['hit', 'kill', 'castStart', 'castFire', 'projectileSpawn', 'projectileEnd', 'chainHop', 'novaTelegraph', 'novaBlast', 'dash', 'buffApplied', 'statusApplied', 'combo', 'heal', 'playerHurt', 'death', 'levelUp', 'gather', 'mapEnter', 'warp', 'talk', 'interact', 'questChanged', 'uiOpen', 'uiClose', 'discovery', 'classChanged', 'skillLearned', 'barChanged', 'spark', 'monsterTelegraph', 'dotTick', 'skillPulse', 'monsterTelegraphEnd', 'enrage'] as const;
      const offs = names.map((n) => gameBus.on(n, () => (counts[n] = (counts[n] ?? 0) + 1)));
      w.__busTap = { counts, off: () => offs.forEach((o) => o()) };
      return counts;
    },
  };
});
