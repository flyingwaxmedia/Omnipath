// VFX runtime entry (docs/VFX.md §8): MapScene's one seam. attachVfx() builds the per-map runtime (pools, layers,
// governor, telegraphs) on the run-wide atlas, wires the bus bridges through sceneScope (cleared on shutdown) — the
// player-skill bridge (../bridge.ts) and the World bridge (../world.ts: monster techniques, auto-attacks, statuses,
// deaths, spawns, auras, sparkles) — plus the juice rig (../juice.ts: hit-stop, impact frames, squash, recoil, kicks)
// on the real actors and the stage's camera rig (render/camera.ts), warms the loadout and the map's spawns behind
// the fade, and runs the warden intro pan / manual-play lead. The runtime tears itself down on the scene's SHUTDOWN.
//
// QA (Playwright): window.omnipath.scene.vfx.stats() — live sprites, bobs, particles, pages, bake queue, update ms,
// tells; .resetPeaks(); .setReduceFlash(on); .setQuality(q); .juice / .world for counters.
import type { SkillDef } from '../../../core/types';
import { auraColor } from '../../art/classLooks';
import { monsterHideColor } from '../../art/monsters';
import type { Monster } from '../../entities/Monster';
import { sceneScope } from '../../events';
import type { MapScene } from '../../scenes/MapScene';
import { VfxBridge } from '../bridge';
import { IntroWatch } from '../../render/camera';
import { JuiceRig, type JuiceActor } from '../juice';
import type { AuraMotif, FamilyId, VfxQuality } from '../types';
import { WorldBridge, familyOfColor, type WorldExtra } from '../world';
import { VfxRuntime, type VfxStats } from './runtime';
import { onReduceFlash, setReduceFlash, vfxSettings } from './settings';

export interface VfxHandle {
  readonly runtime: VfxRuntime;
  readonly bridge: VfxBridge;
  readonly world: WorldBridge;
  readonly juice: JuiceRig;
  stats(): VfxStats & { juice: { granted: number; trimmed: number; flashes: JuiceRig['flashes'] }; camera: { flashes: number; flashesRefused: number; kicks: number; pans: number } };
  resetPeaks(): void;
  /** "Reduce shake & flashes" (the ☰ menu's toggle calls this). */
  setReduceFlash(on: boolean): void;
  readonly reduceFlash: boolean;
  /** Pins the quality tier (QA); null hands it back to the governor. */
  setQuality(q: VfxQuality | null): void;
  /** A named world moment (Interactions, Combat.rest). */
  extra(kind: WorldExtra, x: number, y: number): void;
}

/** Tier III class auras (art/classLooks aura colour -> motif + family). */
const CLASS_AURA: Readonly<Record<string, { motif: AuraMotif; family: FamilyId }>> = {
  ascendant: { motif: 'glint', family: 'holy' },
  eclipse_walker: { motif: 'veil', family: 'twilight' },
};

/**
 * A monster's hide colour (art/monsters.ts `monsterHideColor`: the species' body tone, an elite's tint applied): death
 * chips take it. Null when the art has none for this id.
 */
function hideColorOf(m: Monster): number | null {
  try {
    const c = monsterHideColor(m.def.id);
    return Number.isFinite(c) ? c & 0xffffff : null;
  } catch {
    return null;
  }
}

export function attachVfx(scene: MapScene): VfxHandle {
  const dark = !!scene.def.flags?.includes('dark');
  const runtime = new VfxRuntime(scene, { dark, biome: scene.def.biome, trauma: (t) => scene.stage.addTrauma(t) });
  const juice = new JuiceRig({
    now: () => scene.time.now,
    reduceFlash: () => vfxSettings.reduceFlash,
    actor: (v): JuiceActor | null => {
      if (v === 'player') return scene.combat.dead ? null : scene.player;
      const m = v as Monster;
      return typeof (m as Partial<Monster>).hold === 'function' ? m : null;
    },
    camera: () => scene.stage.rig,
    frame: () => scene.game.loop.frame,
  });
  const bridge = new VfxBridge(runtime, {
    player: () => scene.player ?? null,
    sceneNow: () => scene.time.now,
    windupId: () => scene.combat.windup?.castId ?? null,
    juice,
  });
  const world = new WorldBridge(runtime, {
    player: () => scene.player ?? null,
    sceneNow: () => scene.time.now,
    juice,
    classAura: () => {
      const id = scene.player?.classId ?? null;
      if (!id) return null;
      const known = CLASS_AURA[id];
      if (known) return known;
      const c = auraColor(id);
      return c === null ? null : { motif: 'glint', family: familyOfColor(c) };
    },
    hideColor: hideColorOf,
  });
  const scope = sceneScope(scene);
  bridge.attach(scope);
  world.attach(scope);
  const loadout = (): SkillDef[] => {
    const out: SkillDef[] = [];
    for (const id of scene.session.player.hotbar) {
      const s = id ? scene.reg.skill(id) : undefined;
      if (s) out.push(s);
    }
    return out;
  };
  // Warm set: the equipped skills (every phase, impact variant and status) and the map's spawns, behind the fade.
  const warmAll = () => {
    bridge.warmLoadout(loadout());
    world.warmMap(
      scene.combat.monsters.map((m) => m.def),
      (id) => scene.reg.skill(id),
    );
  };
  warmAll();
  scope.on('barChanged', () => bridge.warmLoadout(loadout()));
  scope.on('skillLearned', (e) => bridge.warmLoadout([e.skill]));
  // "Reduce shake & flashes" flipped (the ☰ menu pauses the world): bake the set again in the new variant meanwhile.
  scene.events.once('shutdown', onReduceFlash(warmAll));
  world.refreshClassAura();

  // Warden intro pan (once per warden per visit, on first sight or aggro: render/camera.ts IntroWatch) and the
  // manual-play lead toward a warden / elite target.
  const intro = new IntroWatch<Monster>();
  let nextCheck = 0;
  runtime.tick(() => {
    const now = scene.time.now;
    if (now < nextCheck) return true;
    nextCheck = now + 250;
    const p = scene.player;
    if (!p || scene.combat.dead) return true;
    const rig = scene.stage.rig;
    const arriving = now < scene.combat.protectUntil;
    const wv = scene.cameras.main.worldView;
    for (const m of scene.combat.monsters) {
      if (!m.warden || !m.alive || m.returning) continue;
      const inView = m.x > wv.x + 16 && m.x < wv.right - 16 && m.y > wv.y + 24 && m.y < wv.bottom;
      if (intro.due(m, { arriving, inView, aggro: scene.combat.hostile(m, now) })) rig.intro(() => (m.alive ? { x: m.x, y: m.y - 24 } : null));
    }
    const t = scene.combat.target;
    const lead = !scene.session.player.autoOn && t && t.alive && (t.warden || t.elite) ? t : null;
    rig.lead(lead ? () => (lead.alive ? { x: lead.x, y: lead.y } : null) : null);
    return true;
  });

  return {
    runtime,
    bridge,
    world,
    juice,
    stats: () => ({ ...runtime.stats(), juice: { granted: juice.granted, trimmed: juice.trimmed, flashes: { ...juice.flashes } }, camera: { ...scene.stage.rig.stats } }),
    resetPeaks: () => runtime.resetPeaks(),
    setReduceFlash: (on) => setReduceFlash(on),
    get reduceFlash() {
      return vfxSettings.reduceFlash;
    },
    setQuality: (q) => runtime.setQuality(q),
    extra: (kind, x, y) => world.extra(kind, x, y),
  };
}
