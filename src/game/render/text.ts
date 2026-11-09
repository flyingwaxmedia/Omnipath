// In-world text (render lane; docs/QUALITY-PLAN.md §4, docs/INTEGRATION-v3.md §2): floating combat numbers and
// world labels (NPC / portal / object names, name tags). Every in-world string goes through here so the render
// lane can switch it to the boot-baked bitmap pixel font (1 px #24180f outline) in ONE place. No emoji in-world:
// callers pass plain text (icons are `icon_*` textures).
//
// Today: Phaser Text with the v2 styles (unchanged look). Render lane: bake the bitmap font in BootScene, then return
// BitmapText here — callers only use what both types share (position, origin, visibility, depth, text, destroy,
// setText, setLineSpacing), so nothing else changes.
import type Phaser from 'phaser';
import { DEPTH } from './depths';

/** What game code may hold for an in-world label (Phaser Text today; BitmapText once the pixel font lands). */
export type WorldLabel = Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText;

export interface LabelStyle {
  /** CSS colour, e.g. '#ffe9a0'. */
  color: string;
  /** Size in art px. */
  size?: number;
  bold?: boolean;
  /** Outline colour (default black; the pixel font uses #24180f). */
  stroke?: string;
  /** Origin (default 0.5, 1: centred above the anchor). */
  originX?: number;
  originY?: number;
  depth?: number;
}

/**
 * A static in-world label at (x, y): NPC / portal / object names, monster plates, the player's name.
 * Default origin (0.5, 1) and depth NAME_TAG.
 */
export function worldLabel(scene: Phaser.Scene, x: number, y: number, text: string, style: LabelStyle): WorldLabel {
  return scene.add
    .text(x, y, text, {
      fontFamily: 'system-ui, sans-serif',
      fontSize: `${style.size ?? 10}px`,
      fontStyle: style.bold ? 'bold' : 'normal',
      color: style.color,
      stroke: style.stroke ?? '#000',
      strokeThickness: 3,
      align: 'center',
    })
    .setOrigin(style.originX ?? 0.5, style.originY ?? 1)
    .setResolution(2)
    .setDepth(style.depth ?? DEPTH.NAME_TAG);
}

/** Pooled floating combat text for one map (create in MapScene.create, destroy on shutdown). */
export class WorldText {
  private pool: Phaser.GameObjects.Text[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Floats `text` up from (x, y) and fades it (damage numbers, heals, "LEVEL 5!"). */
  float(x: number, y: number, text: string, color: string, size: number): void {
    const scene = this.scene;
    let t = this.pool.pop();
    if (!t || !t.active) {
      t = scene.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, sans-serif',
          fontStyle: 'bold',
          fontSize: '14px',
          color: '#fff',
          stroke: '#000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(DEPTH.WORLD_TEXT);
    }
    const txt = t;
    txt.setText(text).setColor(color).setFontSize(size).setPosition(x, y).setAlpha(1).setVisible(true);
    scene.tweens.add({ targets: txt, y: y - 26, duration: 300, ease: 'Quad.out' });
    scene.tweens.add({
      targets: txt,
      alpha: 0,
      delay: 450,
      duration: 400,
      onComplete: () => {
        txt.setVisible(false);
        if (this.pool.length < 40) this.pool.push(txt);
        else txt.destroy();
      },
    });
  }

  /** Drops the pool (the scene destroys its game objects itself on shutdown). */
  destroy(): void {
    this.pool = [];
  }
}
