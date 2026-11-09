// VFX runtime entry (docs/VFX.md §8): MapScene's one seam. attachVfx() builds the per-map runtime (pools, layers,
// governor) on the run-wide atlas, wires the bus bridge through sceneScope (cleared on shutdown) and warms the
// loadout behind the map fade; the runtime tears itself down on the scene's SHUTDOWN.
//
// QA (Playwright): window.omnipath.scene.vfx.stats() — live sprites, bobs, particles, pages, bake queue, update ms;
// .resetPeaks(); .setReduceFlash(on); .setQuality(q).
import type { SkillDef } from '../../../core/types';
import { sceneScope } from '../../events';
import type { MapScene } from '../../scenes/MapScene';
import { VfxBridge } from '../bridge';
import type { VfxQuality } from '../types';
import { VfxRuntime, type VfxStats } from './runtime';
import { setReduceFlash, vfxSettings } from './settings';

export interface VfxHandle {
  readonly runtime: VfxRuntime;
  readonly bridge: VfxBridge;
  stats(): VfxStats;
  resetPeaks(): void;
  /** "Reduce shake & flashes" (the settings UI toggle comes later). */
  setReduceFlash(on: boolean): void;
  readonly reduceFlash: boolean;
  /** Pins the quality tier (QA). */
  setQuality(q: VfxQuality): void;
}

export function attachVfx(scene: MapScene): VfxHandle {
  const dark = !!scene.def.flags?.includes('dark');
  const runtime = new VfxRuntime(scene, { dark, biome: scene.def.biome, trauma: (t) => scene.stage.addTrauma(t) });
  const bridge = new VfxBridge(runtime, {
    player: () => scene.player ?? null,
    sceneNow: () => scene.time.now,
    windupId: () => scene.combat.windup?.castId ?? null,
  });
  const scope = sceneScope(scene);
  bridge.attach(scope);
  const loadout = (): SkillDef[] => {
    const out: SkillDef[] = [];
    for (const id of scene.session.player.hotbar) {
      const s = id ? scene.reg.skill(id) : undefined;
      if (s) out.push(s);
    }
    return out;
  };
  // Warm set: the equipped skills (every phase, impact variant and status), baked behind the fade.
  bridge.warmLoadout(loadout());
  scope.on('barChanged', () => bridge.warmLoadout(loadout()));
  scope.on('skillLearned', (e) => bridge.warmLoadout([e.skill]));
  return {
    runtime,
    bridge,
    stats: () => runtime.stats(),
    resetPeaks: () => runtime.resetPeaks(),
    setReduceFlash: (on) => setReduceFlash(on),
    get reduceFlash() {
      return vfxSettings.reduceFlash;
    },
    setQuality: (q) => runtime.setQuality(q),
  };
}
