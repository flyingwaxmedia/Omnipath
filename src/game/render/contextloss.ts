// WebGL context loss and restore (quality lane; docs/QUALITY-PLAN.md Phase D item 15).
//
// Mobile browsers drop the WebGL context under memory pressure (iOS when the app goes to the background, a GPU
// reset, too many tabs). Phaser 3.90 then stops rendering and, on `webglcontextrestored`, rebuilds every GL object
// it wraps: textures whose pixels live in a canvas or an image come back from that CPU copy — every procedural
// texture (textures.ts drawers, icons, the bitmap font, the grade LUT, the VFX atlas pages, telegraph and bolt
// canvases all keep their canvas). What only ever lived on the GPU comes back EMPTY: RenderTexture contents.
// Measured in Chromium with WEBGL_lose_context: after a restore the whole baked ground (render/ground.ts chunks)
// was black while every sprite was fine.
//
// The handler (installed once by main.ts):
//   lost      → the game loop sleeps (nothing would be drawn; a fight must not go on unseen), stats count it.
//   restored  → 1. checks every canvas / image texture's GL handle and re-uploads (re-bakes from its canvas) any
//                  that did not come back (repairTextures);
//               2. re-bakes the GPU-only content of the running map: the stage's own `restoreContext()` when it has
//                  one, else the baked ground (stage.ground re-baked with render/ground.ts bakeGround);
//               3. runs the re-bake hooks other systems registered with onContextRestored() and emits
//                  'omnipath:contextrestored' on game.events;
//               4. wakes the loop if it slept for the loss — unless a full-screen panel is up: the render lane's loop
//                  sleep (render/config.ts) wakes it when that panel closes. A panel closed while the context is still
//                  lost puts the loop back to sleep until the restore.
// The light map (render/lighting.ts) redraws its RenderTexture every frame, so it needs nothing.
//
// QA: window.omnipath.context — stats(), lose() / restore() (WEBGL_lose_context), and restoreNow() (runs the
// re-bake without a real loss).
import type Phaser from 'phaser';
import { gameBus } from '../events';
import { type BakedGround, bakeGround } from './ground';
import type { CompiledMap } from '../../core/world/types';

export interface RestoreReport {
  /** Canvas / image texture sources checked, and how many had to be uploaded again. */
  checked: number;
  repaired: number;
  /** What was re-baked ('stage', 'ground', hook names). */
  rebaked: string[];
  ms: number;
}

export interface ContextLossStats {
  lost: number;
  restored: number;
  lostNow: boolean;
  last: RestoreReport | null;
}

type Hook = { name: string; fn: (game: Phaser.Game) => void };
const hooks: Hook[] = [];

/** Registers a re-bake to run after every context restore (GPU-only textures); returns the unregister. */
export function onContextRestored(name: string, fn: (game: Phaser.Game) => void): () => void {
  const h = { name, fn };
  hooks.push(h);
  return () => {
    const i = hooks.indexOf(h);
    if (i >= 0) hooks.splice(i, 1);
  };
}

/** A texture source read structurally (Phaser.Textures.TextureSource). */
interface SourceLike {
  image?: unknown;
  isCanvas?: boolean;
  isRenderTexture?: boolean;
  glTexture?: { webGLTexture?: WebGLTexture | null } | null;
  update?: () => void;
  init?: (game: unknown) => void;
}

interface TexturesLike {
  list: Record<string, { source?: readonly SourceLike[] } | undefined>;
}

/**
 * Re-uploads every canvas / image texture source whose GL texture is missing after a restore (Phaser normally
 * restores them itself; this catches any wrapper that did not). Render targets are skipped: their content is gone
 * and only a re-bake brings it back. `isTexture` is the GL check (gl.isTexture).
 */
export function repairTextures(tm: TexturesLike, isTexture: (t: WebGLTexture) => boolean, game?: unknown): { checked: number; repaired: number } {
  let checked = 0;
  let repaired = 0;
  const seen = new Set<SourceLike>();
  for (const key in tm.list) {
    for (const s of tm.list[key]?.source ?? []) {
      if (seen.has(s) || s.isRenderTexture || !s.image) continue;
      seen.add(s);
      checked++;
      const t = s.glTexture?.webGLTexture ?? null;
      if (t && isTexture(t)) continue;
      try {
        if (s.isCanvas && typeof s.update === 'function') s.update();
        else if (typeof s.init === 'function') s.init(game);
        else continue;
        repaired++;
      } catch {
        /* a texture that cannot be uploaded stays as it is */
      }
    }
  }
  return { checked, repaired };
}

/** The map scene's stage, read structurally (render/stage.ts PixelStage keeps its ground in a private field). */
interface StageLike {
  restoreContext?: () => void;
  ground?: BakedGround | null;
}

interface MapSceneLike {
  stage?: StageLike;
  cm?: CompiledMap;
  sys?: { isActive(): boolean; isPaused(): boolean; isSleeping?(): boolean };
}

/** Re-bakes the running map's GPU-only content; returns what it re-baked. `bake` is injectable for tests. */
export function rebakeMap(scene: MapSceneLike | undefined, bake: (scene: MapSceneLike, cm: CompiledMap) => BakedGround = (s, cm) => bakeGround(s as unknown as Phaser.Scene, cm)): string[] {
  const st = scene?.stage;
  if (!scene || !st) return [];
  if (typeof st.restoreContext === 'function') {
    st.restoreContext();
    return ['stage'];
  }
  if (st.ground && typeof st.ground.destroy === 'function' && scene.cm) {
    st.ground.destroy();
    st.ground = bake(scene, scene.cm);
    return ['ground'];
  }
  return [];
}

export interface ContextLossHandle {
  stats(): ContextLossStats;
  /** QA: WEBGL_lose_context.loseContext() / restoreContext(). False when the extension is missing. */
  lose(): boolean;
  restore(): boolean;
  /** QA: runs the restore re-bake now (no real loss). */
  restoreNow(): RestoreReport;
}

export function installContextLoss(game: Phaser.Game): ContextLossHandle {
  const stats: ContextLossStats = { lost: 0, restored: 0, lostNow: false, last: null };
  let slept = false;
  let ext: WEBGL_lose_context | null = null;

  const renderer = () => game.renderer as unknown as (Phaser.Renderer.WebGL.WebGLRenderer & { type: number }) | null;
  const gl = (): WebGLRenderingContext | null => (renderer()?.type === 2 ? (renderer() as { gl?: WebGLRenderingContext }).gl ?? null : null);
  const mapScene = () => game.scene.getScenes(false).find((s) => s.sys.settings.key === 'Map') as unknown as MapSceneLike | undefined;

  const restoreNow = (): RestoreReport => {
    const t0 = performance.now();
    const g = gl();
    const rep = g ? repairTextures(game.textures as unknown as TexturesLike, (t) => g.isTexture(t), game) : { checked: 0, repaired: 0 };
    const rebaked: string[] = [];
    try {
      rebaked.push(...rebakeMap(mapScene()));
    } catch (e) {
      console.warn('[omnipath] ground re-bake after context restore failed', e);
    }
    for (const h of [...hooks]) {
      try {
        h.fn(game);
        rebaked.push(h.name);
      } catch (e) {
        console.warn(`[omnipath] re-bake '${h.name}' after context restore failed`, e);
      }
    }
    game.events.emit('omnipath:contextrestored', game);
    const report: RestoreReport = { checked: rep.checked, repaired: rep.repaired, rebaked, ms: Math.round((performance.now() - t0) * 10) / 10 };
    stats.last = report;
    return report;
  };

  const onLost = () => {
    stats.lost++;
    stats.lostNow = true;
    // Nothing can be drawn until the restore: freeze the world rather than let it run unseen.
    if (game.loop.running) {
      game.loop.sleep();
      slept = true;
    }
  };

  // Mirrors render/config.ts's loop sleep: under a full-screen panel nothing of the world is visible.
  let covered = false;
  const onCover = (on: boolean) => {
    covered = on;
    // The panel closed (config woke the loop) while the context is still lost: keep the world frozen.
    if (!on && stats.lostNow && game.loop.running) {
      game.loop.sleep();
      slept = true;
    }
  };
  gameBus.on('uiOpen', (e) => onCover(e.fullscreen));
  gameBus.on('uiClose', () => onCover(false));
  gameBus.on('discovery', () => onCover(false));

  const onRestored = () => {
    stats.restored++;
    stats.lostNow = false;
    restoreNow();
    if (slept) {
      slept = false;
      // Under a full-screen panel the loop stays asleep: closing the panel wakes it (render/config.ts).
      if (!covered) {
        game.loop.resetDelta();
        game.loop.wake();
      }
    } else {
      // A sleeping loop (a full-screen panel) still shows the world once at the restored state.
      game.step(game.loop.time, 0);
    }
  };

  const attach = () => {
    const r = renderer();
    if (!r || r.type !== 2) return;
    // Phaser's own handlers run first (they rebuild the GL objects, then emit these events).
    r.on('losewebgl', onLost);
    r.on('restorewebgl', onRestored);
  };
  if (game.renderer) attach();
  else game.events.once('ready', attach);

  const extension = (): WEBGL_lose_context | null => {
    if (ext) return ext;
    ext = gl()?.getExtension('WEBGL_lose_context') ?? null;
    return ext;
  };

  const handle: ContextLossHandle = {
    stats: () => ({ ...stats, last: stats.last ? { ...stats.last, rebaked: [...stats.last.rebaked] } : null }),
    lose: () => {
      const e = extension();
      if (!e) return false;
      e.loseContext();
      return true;
    },
    restore: () => {
      const e = extension();
      if (!e) return false;
      e.restoreContext();
      return true;
    },
    restoreNow,
  };
  return handle;
}
