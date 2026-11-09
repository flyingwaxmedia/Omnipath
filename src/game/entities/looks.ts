// Player looks (actors lane; docs/CLIENT-v3.md §5): which textures and animations show the player for a weapon and
// a worn class. Class looks are generated lazily — the idle frame alone for previews (Class screen, discovery card,
// HUD portrait), the whole frame set + animations the first time the player wears it.
import type Phaser from 'phaser';
import type { WeaponType } from '../../core/types';
import { drawPlayerLook, lookAnimDefs } from '../art/characters';
import { classOutfit, lookAnims, lookBase, lookFrames } from '../art/classLooks';
import { textureDataUrl } from '../art/pixel';

/** Removes a class look's frames after a failed draw (a half-painted canvas must not be reused as the look). */
function dropLook(scene: Phaser.Scene, base: string): void {
  if (!base.includes('__')) return; // never the weapon looks drawn at boot
  for (const k of lookFrames(base)) if (scene.textures.exists(k)) scene.textures.remove(k);
}

/** Base key of the look (`player_<w>` or `player_<w>__<classId>`), with at least its idle frame 0 drawn. */
export function lookPreviewKey(scene: Phaser.Scene, weapon: WeaponType, classId: string | null): string {
  const outfit = classOutfit(classId);
  const base = lookBase(weapon, classId);
  if (outfit && !scene.textures.exists(base)) {
    try {
      drawPlayerLook(scene, base, weapon, outfit, false);
    } catch (e) {
      // a preview must never break the Class screen / portrait: fall back to the weapon look below
      console.error(`[omnipath] class look preview ${base} failed`, e);
      dropLook(scene, base);
    }
  }
  if (scene.textures.exists(base)) return base;
  return scene.textures.exists(`player_${weapon}`) ? `player_${weapon}` : 'player_sword';
}

/**
 * Makes sure every frame and animation of the look exists and returns its base key. Falls back to the weapon look
 * (then the sword look) when a texture cannot be made, so the player is never invisible.
 */
export function ensurePlayerLook(scene: Phaser.Scene, weapon: WeaponType, classId: string | null): string {
  const outfit = classOutfit(classId);
  let base = lookBase(weapon, classId);
  if (outfit) {
    try {
      drawPlayerLook(scene, base, weapon, outfit, true);
    } catch (e) {
      console.error(`[omnipath] class look ${base} failed`, e);
      dropLook(scene, base);
      base = `player_${weapon}`;
    }
  }
  if (!scene.textures.exists(base)) base = scene.textures.exists(`player_${weapon}`) ? `player_${weapon}` : 'player_sword';
  for (const a of lookAnimDefs(base)) {
    if (scene.anims.exists(a.key) || !a.frames.every((k) => scene.textures.exists(k))) continue;
    scene.anims.create({ key: a.key, frames: a.frames.map((key) => ({ key })), frameRate: a.frameRate, repeat: a.repeat });
  }
  return base;
}

/** Animation keys of a look whose frames exist (null members when an animation is missing). */
export function playerAnims(scene: Phaser.Scene, base: string): { idle: string | null; walk: string | null; atk: string | null } {
  const k = lookAnims(base);
  const has = (key: string) => (scene.anims.exists(key) ? key : null);
  return { idle: has(k.idle), walk: has(k.walk), atk: has(k.atk) };
}

/**
 * Outfit preview for the Class screen / class discovery card / portrait: a PNG data URL of the look's idle frame
 * (40x48 art px — show it at whole multiples with `image-rendering: pixelated`). '' when it cannot be made.
 */
export function outfitPreviewUrl(scene: Phaser.Scene, weapon: WeaponType, classId: string | null): string {
  return textureDataUrl(scene, lookPreviewKey(scene, weapon, classId));
}
