// Actors seam (actors lane; docs/INTEGRATION-v3.md §2): everything about how characters LOOK and animate —
// NPC sprites + name tags, quest markers over NPC heads, the target chevron, player class looks, animations.
// MapScene calls exactly three things here: createNpcActor() per NPC (buildNpcs), createActors() once in create()
// (after the player, NPCs and monsters exist) with actors.update() each frame and actors.destroy() on shutdown;
// BootScene calls registerActorAnims() once after textures. The game lane never edits this file.
import type Phaser from 'phaser';
import type { WeaponType } from '../../core/types';
import type { NpcDef } from '../../data/npcs';
import { CHAR_ANIMS } from '../art/characters';
import { MONSTER_ANIMS } from '../art/monsters';
import { sceneScope } from '../events';
import { DEPTH, ySort } from '../render/depths';
import { type WorldLabel, worldLabel } from '../render/text';
import type { MapScene } from '../scenes/MapScene';
import { type QuestMarkerKind, opaqueTop, questMarkerKey } from './actorArt';
import { lookPreviewKey, outfitPreviewUrl } from './looks';
import type { Monster } from './Monster';
import { bob, isChasing, monsterAnimKey } from './rules';

export { ensurePlayerLook, outfitPreviewUrl } from './looks';

/** One NPC on the map. `sprite` is what taps hit-test against (feet at the anchor, origin 0.5, 0.95). */
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
    const key = monsterAnimKey(base);
    if (scene.anims.exists(key) || !has(a.frames)) continue;
    scene.anims.create({ key, frames: a.frames.map((k) => ({ key: k })), frameRate: a.fps, repeat: -1 });
  }
}

/**
 * Texture key of the player's look for a weapon and worn class (null = no class): `player_<w>` or
 * `player_<w>__<classId>`. The class look's idle frame is generated lazily here (previews, portrait); the player
 * generates the rest of its frames when it wears the look (entities/looks.ts ensurePlayerLook).
 */
export function playerLookKey(scene: Phaser.Scene, weapon: WeaponType, classId: string | null): string {
  return lookPreviewKey(scene, weapon, classId);
}

/** Outfit preview data URL for the Class screen / discovery card (same as ctrl.outfitUrl). */
export function outfitUrl(scene: Phaser.Scene, weapon: WeaponType, classId: string | null): string {
  return outfitPreviewUrl(scene, weapon, classId);
}

/** Small stable hash (desynchronises NPC idles without Math.random). */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Builds one NPC: shadow, a 2-frame idle sprite and a two-line name tag (name, then title). */
export function createNpcActor(scene: Phaser.Scene, def: NpcDef, x: number, y: number): NpcActor {
  const tex = scene.textures.exists(def.texture) ? def.texture : 'npc_hermit';
  const shadow = scene.add.image(x, y, 'shadow').setDepth(DEPTH.SHADOW);
  const sprite = scene.add.sprite(x, y, tex).setOrigin(0.5, 0.95).setDepth(ySort(y));
  const anim = `${tex}_idle`;
  if (scene.anims.exists(anim)) {
    const h = hash(def.id);
    sprite.play({ key: anim, startFrame: h % 2, timeScale: 0.85 + (h % 7) * 0.05 });
  }
  // The name tag sits just above the head (or the hat / raised prop) of this NPC's art, whichever frame is higher.
  const top = Math.min(opaqueTop(scene, tex), scene.textures.exists(`${tex}_1`) ? opaqueTop(scene, `${tex}_1`) : 99);
  const headY = y - sprite.displayHeight * 0.95 + top;
  const label = worldLabel(scene, x, Math.round(headY - 3), `${def.name}\n${def.title}`, { color: '#ffe9a0' });
  label.setLineSpacing(1);
  return { sprite, shadow, label };
}

// ---------------------------------------------------------------- markers + chevrons

interface Marker {
  npcId: string;
  img: Phaser.GameObjects.Image;
  kind: QuestMarkerKind | null;
  /** Anchor: the marker's bottom centre sits here (above the name tag). */
  x: number;
  y: number;
  phase: number;
}

/** Chaser chevron tint (danger), target chevron stays white-gold. */
const CHASE_TINT = 0xff7058;
/** How often the quest markers re-check without an event (ms): bag, element and flag changes have none. */
const MARKER_POLL_MS = 1000;

/**
 * Per-map actor systems; call after the player, NPCs and monsters exist. Puts the worn class's outfit on the player
 * (load), switches it on every class change, keeps quest markers over NPC heads and chevrons over the target and the
 * monsters chasing the player.
 */
export function createActors(scene: MapScene): Actors {
  const scope = sceneScope(scene);
  const player = scene.player;
  player.setLook(scene.book.state.worn);

  // ---- quest markers
  const markers: Marker[] = scene.npcs.map((n, i) => {
    const lbl = n.label;
    const top = lbl.y - lbl.displayHeight * lbl.originY;
    return {
      npcId: n.def.id,
      img: scene.add.image(n.x, top, '__DEFAULT').setOrigin(0.5, 1).setDepth(DEPTH.MARKER).setVisible(false),
      kind: null,
      x: Math.round(n.x),
      y: Math.round(top - 2),
      phase: (i * 0.9) % (Math.PI * 2),
    };
  });
  let dirty = true;
  let pollAt = 0;
  const refreshMarkers = (pop: boolean): void => {
    for (const m of markers) {
      let kind: QuestMarkerKind | null = null;
      try {
        kind = scene.book.questMarker(m.npcId);
      } catch {
        kind = null;
      }
      if (kind === m.kind) continue;
      m.kind = kind;
      if (!kind) {
        m.img.setVisible(false);
        continue;
      }
      m.img.setTexture(questMarkerKey(scene, kind)).setVisible(true);
      if (pop) {
        // fade in when a marker appears or changes mid-visit, so the eye catches it
        scene.tweens.killTweensOf(m.img);
        m.img.setAlpha(0);
        scene.tweens.add({ targets: m.img, alpha: 1, duration: 200 });
      }
    }
  };
  const markDirty = (): void => {
    dirty = true;
  };
  scope
    .on('questChanged', markDirty)
    .on('levelUp', markDirty)
    .on('skillLearned', markDirty)
    .on('classChanged', (e) => {
      player.setLook(e.classId);
      dirty = true;
    })
    .on('mapEnter', markDirty)
    .on('talk', markDirty)
    // Every player cast plays the attack pose (Combat.fire also calls attackAnim; the second call is ignored).
    .on('castFire', () => player.attackAnim());

  // ---- chevrons
  const chevrons: Phaser.GameObjects.Image[] = [];
  const hasChevron = scene.textures.exists('ui_chevron');
  const chevron = (i: number): Phaser.GameObjects.Image => {
    let c = chevrons[i];
    if (!c) {
      c = scene.add.image(0, 0, 'ui_chevron').setOrigin(0.5, 1).setDepth(DEPTH.CHEVRON).setVisible(false);
      chevrons[i] = c;
    }
    return c;
  };
  const chasing = (m: Monster, now: number): boolean =>
    isChasing({
      alive: m.alive,
      returning: m.returning,
      provoked: m.provoked,
      aggressive: m.def.aggressive,
      rank: m.def.rank,
      dist: Math.hypot(m.x - player.x, m.y - player.y),
      safe: scene.combat.dead || now < scene.combat.protectUntil,
    });
  const placeChevron = (img: Phaser.GameObjects.Image, m: Monster, now: number, target: boolean): void => {
    // right above the HP bar, pointing down at the body (the name plate moves up to make room)
    m.chevron = true;
    img.setPosition(Math.round(m.x), Math.round(m.top) - 2 + bob(now, 1000, 1.5, m.uid));
    if (target) img.clearTint().setAlpha(1);
    else img.setTint(CHASE_TINT).setAlpha(0.95);
    img.setVisible(true);
  };

  return {
    update(_dt: number, now: number) {
      // markers: on events (next frame) and a slow poll
      if (dirty || now >= pollAt) {
        refreshMarkers(pollAt > 0);
        dirty = false;
        pollAt = now + MARKER_POLL_MS;
      }
      for (const m of markers) {
        if (!m.kind) continue;
        m.img.setPosition(m.x, m.y + bob(now, 2600, 1.5, m.phase));
      }
      // chevrons: the current target first, then every monster hunting the player
      if (!hasChevron) return;
      for (const m of scene.combat.monsters) m.chevron = false;
      let n = 0;
      const t = scene.combat.target;
      if (t?.alive && t.sprite.visible) placeChevron(chevron(n++), t, now, true);
      for (const m of scene.combat.monsters) {
        if (m === t || !m.sprite.visible || !chasing(m, now)) continue;
        placeChevron(chevron(n++), m, now, false);
      }
      for (let i = n; i < chevrons.length; i++) chevrons[i].setVisible(false);
    },
    destroy() {
      scope.clear();
      for (const m of markers) m.img.destroy();
      for (const c of chevrons) c.destroy();
      markers.length = 0;
      chevrons.length = 0;
    },
  };
}
