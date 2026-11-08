import Phaser from 'phaser';
import type { WeaponType } from '../../core/types';

export class Player {
  readonly sprite: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly nameText: Phaser.GameObjects.Text;
  readonly aura: Phaser.GameObjects.Graphics;
  path: { x: number; y: number }[] = [];
  facing = 1;
  aimAngle = 0;
  moving = false;
  /** While > now, input movement is locked (dashes, channels). */
  lockedUntil = 0;
  private walkT = 0;
  private lunge = 0;

  constructor(
    readonly scene: Phaser.Scene,
    public x: number,
    public y: number,
    name: string,
    weapon: WeaponType,
  ) {
    this.shadow = scene.add.image(x, y, 'shadow');
    this.aura = scene.add.graphics();
    this.sprite = scene.add.image(x, y, `player_${weapon}`).setOrigin(0.45, 0.95);
    this.nameText = scene.add
      .text(x, y, name, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: '11px',
        color: '#ffffff',
        stroke: '#1a2244',
        strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setResolution(2);
  }

  setWeapon(w: WeaponType): void {
    this.sprite.setTexture(`player_${w}`);
  }

  face(tx: number, ty: number): void {
    this.aimAngle = Math.atan2(ty - this.y, tx - this.x);
    if (Math.abs(tx - this.x) > 2) this.facing = tx > this.x ? 1 : -1;
  }

  attackAnim(): void {
    this.lunge = 1;
  }

  sync(dt: number, auraColors: number[]): void {
    if (this.moving) this.walkT += dt * 12;
    else this.walkT = 0;
    this.lunge = Math.max(0, this.lunge - dt * 6);
    const bob = this.moving ? Math.abs(Math.sin(this.walkT)) * 3 : 0;
    const lx = Math.cos(this.aimAngle) * this.lunge * 5;
    const ly = Math.sin(this.aimAngle) * this.lunge * 5;
    this.sprite.setPosition(this.x + lx, this.y - bob + ly);
    this.sprite.setFlipX(this.facing < 0);
    this.sprite.setDepth(this.y);
    this.shadow.setPosition(this.x, this.y + 1).setDepth(this.y - 1000);
    this.nameText.setPosition(this.x, this.y + 4).setDepth(100000);
    this.aura.clear();
    auraColors.forEach((col, i) => {
      const t = this.scene.time.now / 300 + i;
      this.aura.lineStyle(2, col, 0.55 + Math.sin(t) * 0.25);
      this.aura.strokeEllipse(this.x, this.y, 30 + i * 6, 12 + i * 3);
    });
    this.aura.setDepth(this.y - 999);
  }

  hurt(): void {
    this.sprite.setTintFill(0xff4444);
    this.scene.time.delayedCall(90, () => this.sprite.clearTint());
  }
}
