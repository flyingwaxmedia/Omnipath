// Actors seam (actors lane; docs/INTEGRATION-v3.md §2): everything about how characters LOOK and animate —
// NPC sprites + name tags, quest markers over NPC heads, the target chevron, player class looks, animations.
// MapScene calls exactly three things here: createNpcActor() per NPC (buildNpcs), createActors() once in create()
// (after the player, NPCs and monsters exist) with actors.update() each frame and actors.destroy() on shutdown;
// BootScene calls registerActorAnims() once after textures. The game lane never edits this file.
//
// Skeleton: the v2 behaviour (static NPC image with a breathing tween, no markers, no chevron, weapon looks only).
import type Phaser from 'phaser';
import type { WeaponType } from '../../core/types';
import type { NpcDef } from '../../data/npcs';
import { CHAR_ANIMS } from '../art/characters';
import { MONSTER_ANIMS } from '../art/monsters';
import { DEPTH, ySort } from '../render/depths';
import { type WorldLabel, worldLabel } from '../render/text';
import type { MapScene } from '../scenes/MapScene';

/** One NPC on the map. `sprite` is what taps hit-test against (origin 0.5, 1). */
export interface NpcActor {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  label: WorldLabel;
}

/** Per-map actor systems (markers, chevrons, look switching, animation driving). */
export interface Actors {
  update(dt: number, now: number): void;
  destroy(): void;
}

/** Registers every character / monster animation whose frames exist (idempotent; once at boot). */
export function registerActorAnims(scene: Phaser.Scene): void {
  const has = (keys: readonly string[]) => keys.every((k) => scene.textures.exists(k));
  for (const a of CHAR_ANIMS) {
    if (scene.anims.exists(a.key) || !has(a.frames)) continue;
    scene.anims.create({ key: a.key, frames: a.frames.map((key) => ({ key })), frameRate: a.frameRate, repeat: a.repeat });
  }
  for (const [base, a] of Object.entries(MONSTER_ANIMS)) {
    const key = `${base}_anim`;
    if (scene.anims.exists(key) || !has(a.frames)) continue;
    scene.anims.create({ key, frames: a.frames.map((k) => ({ key: k })), frameRate: a.fps, repeat: -1 });
  }
}

/**
 * Texture key of the player's look for a weapon and worn class (null = no class). Actors lane: generate
 * `player_<w>__<classId>` (+ its frames) lazily from src/game/art/classLooks.ts. Skeleton: the weapon look.
 */
export function playerLookKey(scene: Phaser.Scene, weapon: WeaponType, _classId: string | null): string {
  const key = `player_${weapon}`;
  return scene.textures.exists(key) ? key : 'player_sword';
}

/** Builds one NPC: shadow, sprite and name tag (v2 look). */
export function createNpcActor(scene: Phaser.Scene, def: NpcDef, x: number, y: number): NpcActor {
  const shadow = scene.add.image(x, y, 'shadow').setDepth(DEPTH.SHADOW);
  const sprite = scene.add
    .sprite(x, y + 2, scene.textures.exists(def.texture) ? def.texture : 'npc_hermit')
    .setOrigin(0.5, 1)
    .setDepth(ySort(y));
  const label = worldLabel(scene, x, y - sprite.displayHeight - 2, `${def.name}\n${def.title}`, { color: '#ffe9a0' });
  label.setLineSpacing(-2);
  scene.tweens.add({ targets: sprite, scaleY: 1.03, yoyo: true, repeat: -1, duration: 1100 + Math.random() * 300, ease: 'Sine.inOut' });
  return { sprite, shadow, label };
}

/** Per-map actor systems; call after the player, NPCs and monsters exist. Skeleton: nothing yet. */
export function createActors(_scene: MapScene): Actors {
  return {
    update() {},
    destroy() {},
  };
}
