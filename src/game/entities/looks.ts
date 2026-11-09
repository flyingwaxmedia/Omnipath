// Player looks (actors lane; docs/CLIENT-v3.md §5): which textures and animations show the player for a weapon and
// a worn class. Class looks are generated lazily — the idle frame alone for previews (Class screen, discovery card,
// HUD portrait), the whole frame set + animations the first time the player wears it — and pre-baked one frame per
// idle slice for every discovered class (prebakeLooks), so Become does not stall a frame.
import type Phaser from 'phaser';
import type { WeaponType } from '../../core/types';
import { LOOK_FRAMES, drawPlayerLook, drawPlayerLookFrame, lookAnimDefs, lookFrameKey } from '../art/characters';
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

// ---------------------------------------------------------------- time-sliced pre-bake

interface BakeJob {
  scene: Phaser.Scene;
  base: string;
  weapon: WeaponType;
  classId: string;
}

const queue: BakeJob[] = [];
let pending = false;
/** Budget per idle slice (ms): one ~10 ms frame always fits, a second only with real idle time left. */
const SLICE_MS = 8;
/** Without requestIdleCallback: one frame per this many ms (a short task between game frames, never a burst). */
const FALLBACK_MS = 100;
/** A busy game loop leaves little idle time: run a slice at least this often anyway (one frame, ~10 ms). */
const IDLE_TIMEOUT_MS = 150;

type IdleDeadline = { timeRemaining(): number };
const idle = (fn: (d?: IdleDeadline) => void): void => {
  const w = globalThis as unknown as { requestIdleCallback?: (cb: (d: IdleDeadline) => void, o?: { timeout: number }) => number };
  if (typeof w.requestIdleCallback === 'function') w.requestIdleCallback(fn, { timeout: IDLE_TIMEOUT_MS });
  else setTimeout(() => fn(), FALLBACK_MS); // Safari (iPad) has no requestIdleCallback: a frame now and then
};

/** The frames of a job still missing (in draw order). */
function missing(j: BakeJob): number[] {
  const out: number[] = [];
  for (let i = 0; i < LOOK_FRAMES; i++) if (!j.scene.textures.exists(lookFrameKey(j.base, i))) out.push(i);
  return out;
}

function slice(d?: IdleDeadline): void {
  pending = false;
  const t0 = performance.now();
  while (queue.length) {
    const j = queue[0];
    const outfit = classOutfit(j.classId);
    const todo = !j.scene.sys?.game || !outfit ? [] : missing(j);
    if (!todo.length) {
      queue.shift();
      continue;
    }
    try {
      drawPlayerLookFrame(j.scene, j.base, j.weapon, outfit!, todo[0]);
    } catch (e) {
      console.error(`[omnipath] pre-bake ${j.base} failed`, e);
      dropLook(j.scene, j.base);
      queue.shift();
      continue;
    }
    if (todo.length === 1) {
      queue.shift();
      ensurePlayerLook(j.scene, j.weapon, j.classId); // all frames exist: just registers the animations
    }
    const left = d ? d.timeRemaining() : SLICE_MS - (performance.now() - t0);
    if (left < SLICE_MS) break;
  }
  if (queue.length) schedule();
}

function schedule(): void {
  if (pending) return;
  pending = true;
  idle(slice);
}

/**
 * Draws the full frame sets of these class looks for a weapon in the background, one frame per idle slice (load: every
 * discovered class; a class discovery: that class). Wearing one afterwards is instant. Skips looks already drawn.
 */
export function prebakeLooks(scene: Phaser.Scene, weapon: WeaponType, classIds: readonly string[], urgent = false): void {
  for (const classId of classIds) {
    if (!classOutfit(classId)) continue;
    const base = lookBase(weapon, classId);
    const at = queue.findIndex((j) => j.base === base);
    if (at >= 0 && !urgent) continue;
    const job = at >= 0 ? queue.splice(at, 1)[0] : { scene, base, weapon, classId };
    if (!missing(job).length) continue;
    // a class just discovered goes first: its Become button is one tap away
    if (urgent) queue.unshift(job);
    else queue.push(job);
  }
  if (queue.length) schedule();
}

/** Looks still waiting to be pre-baked (tests / debug). */
export function prebakePending(): string[] {
  return queue.map((j) => j.base);
}
