import Phaser from 'phaser';
import { MASTERY } from './core/mastery';
import type { ElementId } from './core/types';
import { createRegistry } from './data';
import { mapById } from './data/world';
import { BootScene } from './game/scenes/BootScene';
import { MapScene } from './game/scenes/MapScene';
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

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  backgroundColor: '#16261a',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 3 },
  scene: [BootScene, MapScene],
});

interface OmnipathHandle {
  game: Phaser.Game;
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
    /** Targets the nearest monster (auto-attack engages). Returns its id or null. */
    fight: () => {
      const m = scene.combat.nearestMonster(4000);
      if (m) {
        scene.combat.lastInput = scene.time.now;
        scene.combat.setTarget(m);
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
      return { book, resize: game.scale.listenerCount('resize'), sceneEvents: scene.events.eventNames().reduce((a, n) => a + scene.events.listenerCount(n), 0) };
    },
  };
});
