// Boot (render lane; docs/QUALITY-PLAN.md §5): shows the boot splash, waits for the OFL pixel fonts, then generates
// every texture in CLIENT-v3 §1 order in small time slices (the splash bar moves and the page stays responsive
// instead of one long freeze), registers the animations, injects the UI art CSS and announces 'omnipath:ready'.
import Phaser from 'phaser';
import { registerCharAnims } from '../art/characters';
import { registerActorAnims } from '../entities/actors';
import { bootRegistry } from '../render/config';
import { loadFonts } from '../render/fonts';
import { ensureSplash, removeSplash, splashProgress } from '../render/splash';
import { textureSteps } from '../textures';

/** Waits for the next painted frame (falls back to a timeout in a hidden tab, where rAF never fires). */
function nextFrame(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const go = () => {
      if (done) return;
      done = true;
      resolve();
    };
    requestAnimationFrame(() => setTimeout(go, 0));
    setTimeout(go, 50);
  });
}

/** Steps cheaper than this (ms) run back to back without yielding a frame. */
const SLICE_MS = 24;

export class BootScene extends Phaser.Scene {
  /** Per-step timings (ms) of the last boot, for perf checks: `game.scene.getScene('Boot').timings`. */
  timings: Record<string, number> = {};

  constructor() {
    super('Boot');
  }

  create(): void {
    ensureSplash();
    void this.boot();
  }

  private async boot(): Promise<void> {
    const t0 = performance.now();
    splashProgress(0.04);
    await loadFonts();
    this.timings.fonts = performance.now() - t0;
    const steps = textureSteps(this, bootRegistry(this));
    let sliceStart = performance.now();
    for (let i = 0; i < steps.length; i++) {
      const s = steps[i];
      const t = performance.now();
      try {
        s.run();
      } catch (e) {
        // One broken drawer must not keep the game from starting (its keys fall back where callers check).
        console.error(`[omnipath] texture step ${s.name} failed`, e);
      }
      this.timings[s.name] = performance.now() - t;
      splashProgress(0.08 + (0.88 * (i + 1)) / steps.length);
      if (performance.now() - sliceStart > SLICE_MS) {
        await nextFrame();
        sliceStart = performance.now();
      }
    }
    // Animations once their frames exist (the actors lane's registry covers characters and monsters).
    registerCharAnims(this);
    registerActorAnims(this);
    this.timings.total = performance.now() - t0;
    splashProgress(1);
    await nextFrame();
    removeSplash();
    this.game.events.emit('omnipath:ready');
  }
}
