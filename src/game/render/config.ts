// Phaser game configuration (render lane; docs/QUALITY-PLAN.md §1): pixel-perfect low-res backbuffer — Scale.NONE,
// canvas = ceil(device px / k) art px, camera zoom 1, integer CSS upscale k (`image-rendering: pixelated`), resize
// handling. main.ts calls createGame() once and never touches the config itself.
//
// Skeleton: the v2 config (Scale.RESIZE at CSS px). LANE render: the low-res backbuffer + integer upscale.
//
// The content registry rides in the game's data registry (`REGISTRY_KEY`) so BootScene can draw the icons
// (`drawIcons(this, this.registry.get(REGISTRY_KEY))`) without main.ts and the render lane sharing a file.
import Phaser from 'phaser';
import type { Registry } from '../../core/registry';
import './fonts';

/** Key of the content Registry in `game.registry` (read it in any scene: `this.registry.get(REGISTRY_KEY)`). */
export const REGISTRY_KEY = 'omnipath.reg';

/** The content registry stored by createGame (BootScene: icons need it). */
export function bootRegistry(scene: Phaser.Scene): Registry | undefined {
  return scene.registry.get(REGISTRY_KEY) as Registry | undefined;
}

export function createGame(scenes: Phaser.Types.Scenes.SceneType[], reg?: Registry): Phaser.Game {
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#16261a',
    pixelArt: true,
    roundPixels: true,
    scale: { mode: Phaser.Scale.RESIZE, width: window.innerWidth, height: window.innerHeight },
    input: { activePointers: 3 },
    scene: scenes,
  });
  if (reg) game.registry.set(REGISTRY_KEY, reg);
  return game;
}
