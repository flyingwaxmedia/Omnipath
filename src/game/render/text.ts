// In-world text (render lane; docs/QUALITY-PLAN.md §4, docs/INTEGRATION-v3.md §2): floating combat numbers and
// world labels (NPC / portal / object names, name tags). Every in-world string goes through here and is drawn with
// the boot-baked bitmap pixel font (render/fonts.ts + render/glyphs.ts, 1 px #24180f outline) at its native size —
// never scaled, so every glyph pixel is one art pixel.
//
// No emoji in-world: the font has no such glyphs, and PixelText.setText drops anything it cannot draw (accented
// letters fall back to their base letter) instead of drawing boxes — also for text set later through `.text`.
import Phaser from 'phaser';
import { DEPTH } from './depths';
import { pixelFontKey, pixelFontSize } from './fonts';
import { type FontTier, pixelSafe, tierFor } from './glyphs';

/** What game code may hold for an in-world label (always a BitmapText now; the union keeps v2 callers compiling). */
export type WorldLabel = Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText;

export interface LabelStyle {
  /** CSS colour, e.g. '#ffe9a0'. */
  color: string;
  /** Size in art px (v2 Text sizes: ≤ 12 small, 13–15 bold, ≥ 16 big pixel font). */
  size?: number;
  bold?: boolean;
  /** Ignored: the pixel font always has its 1 px #24180f outline. */
  stroke?: string;
  /** Origin (default 0.5, 1: centred above the anchor). */
  originX?: number;
  originY?: number;
  depth?: number;
}

/** A BitmapText that only ever holds text the pixel font can draw. */
export class PixelText extends Phaser.GameObjects.BitmapText {
  override setText(value: string | string[]): this {
    const raw = Array.isArray(value) ? value.join('\n') : value === undefined || value === null ? '' : String(value);
    return super.setText(pixelSafe(raw));
  }

  /** Switches tier / colour, keeping the font's native size (pixel-exact). */
  setPixelFont(tier: FontTier, color: string): this {
    const key = pixelFontKey(this.scene, tier, color);
    if (key !== this.font) this.setFont(key, pixelFontSize(this.scene, key));
    return this;
  }
}

function pixelText(scene: Phaser.Scene, x: number, y: number, text: string, tier: FontTier, color: string): PixelText {
  const key = pixelFontKey(scene, tier, color);
  const t = new PixelText(scene, x, y, key, text, pixelFontSize(scene, key), Phaser.GameObjects.BitmapText.ALIGN_CENTER);
  scene.add.existing(t);
  return t;
}

/**
 * A static in-world label at (x, y): NPC / portal / object names, monster plates, the player's name.
 * Default origin (0.5, 1) and depth NAME_TAG.
 */
export function worldLabel(scene: Phaser.Scene, x: number, y: number, text: string, style: LabelStyle): WorldLabel {
  return pixelText(scene, x, y, text, tierFor(style.size ?? 10, style.bold), style.color)
    .setOrigin(style.originX ?? 0.5, style.originY ?? 1)
    .setDepth(style.depth ?? DEPTH.NAME_TAG);
}

/** Pooled floating combat text for one map (create in MapScene.create, destroy on shutdown). */
export class WorldText {
  private pool: PixelText[] = [];

  constructor(private readonly scene: Phaser.Scene) {}

  /** Floats `text` up from (x, y) and fades it (damage numbers, heals, "LEVEL 5!"). */
  float(x: number, y: number, text: string, color: string, size: number): void {
    const scene = this.scene;
    const tier = tierFor(size);
    let t = this.pool.pop();
    if (!t || !t.active) t = pixelText(scene, 0, 0, '', tier, color).setOrigin(0.5).setDepth(DEPTH.WORLD_TEXT);
    const txt = t.setPixelFont(tier, color);
    txt.setText(text);
    if (!txt.text) {
      this.recycle(txt);
      return;
    }
    // Start on a whole art pixel; the tween's in-between positions are rounded by the camera (roundPixels).
    const sx = Math.round(x);
    const sy = Math.round(y);
    txt.setPosition(sx, sy).setAlpha(1).setVisible(true);
    scene.tweens.add({ targets: txt, y: sy - 26, duration: 300, ease: 'Quad.out' });
    scene.tweens.add({
      targets: txt,
      alpha: 0,
      delay: 450,
      duration: 400,
      onComplete: () => this.recycle(txt),
    });
  }

  private recycle(txt: PixelText): void {
    txt.setVisible(false);
    if (this.pool.length < 40) this.pool.push(txt);
    else txt.destroy();
  }

  /** Drops the pool (the scene destroys its game objects itself on shutdown). */
  destroy(): void {
    this.pool = [];
  }
}
