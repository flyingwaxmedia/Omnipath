// Boot (render lane): generates every texture, then announces 'omnipath:ready'. LANE render: boot splash and
// time-sliced generation (hundreds of canvases), the bitmap pixel font (render/fonts.ts) and the UI art CSS
// (inject uiCss(scene) once, before 'omnipath:ready'). Keep the registerActorAnims() call after the textures.
import Phaser from 'phaser';
import { registerActorAnims } from '../entities/actors';
import { generateTextures } from '../textures';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateTextures(this);
    // Actors lane seam: character / monster animations, once the frames exist.
    registerActorAnims(this);
    this.game.events.emit('omnipath:ready');
  }
}
