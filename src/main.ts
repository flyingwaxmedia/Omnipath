import Phaser from 'phaser';
import { MASTERY } from './core/mastery';
import { createRegistry } from './data';
import { BootScene } from './game/scenes/BootScene';
import { WorldScene } from './game/scenes/WorldScene';
import { Session } from './game/session';
import { generateWorld } from './game/world/map';
import { showTitle } from './ui/title';
import './ui/styles.css';

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
  backgroundColor: '#1b2a1b',
  pixelArt: true,
  roundPixels: true,
  scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
  input: { activePointers: 3 },
  scene: [BootScene, WorldScene],
});

game.events.once('omnipath:ready', async () => {
  const uiRoot = document.getElementById('ui')!;
  const existing = Session.load(reg);
  const choice = await showTitle(uiRoot, !!existing, existing?.player.name);
  let session: Session;
  if (choice.kind === 'continue' && existing) session = existing;
  else {
    Session.clear();
    Session.locked = false;
    session = Session.create(reg, choice.name!, choice.weapon!, generateWorld().spawnPoint);
    session.save();
  }
  game.scene.start('World', { session });
  const save = () => {
    const world = game.scene.getScene('World') as WorldScene | null;
    world?.save?.();
  };
  document.addEventListener('visibilitychange', () => document.hidden && save());
  window.addEventListener('pagehide', save);
  (window as unknown as { omnipath: unknown }).omnipath = { game, session, reg };
});
