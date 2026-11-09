// Phaser game configuration (render lane; docs/QUALITY-PLAN.md §1): pixel-perfect low-res backbuffer — Scale.NONE,
// canvas = ceil(device px / k) art px, camera zoom 1, integer CSS upscale k (`image-rendering: pixelated`, see
// src/ui/styles/render.css), re-fitted on resize / orientation / DPR changes. main.ts calls createGame() once and
// never touches the config itself.
//
// Also here: the game loop sleeps while a full-screen panel hides the world (gameBus uiOpen.fullscreen → sleep,
// uiClose / a windowed panel → wake), and `window.omnipath.render` (debug: the scale, and `check()` which asserts
// cameras.main.renderRoundPixels === true, zoom 1, whole-pixel scroll and the canvas' CSS size).
//
// The content registry rides in the game's data registry (`REGISTRY_KEY`) so BootScene can draw the icons
// (`drawIcons(this, bootRegistry(this)!)`) without main.ts and the render lane sharing a file.
//
// Quality hook (light lane): setRenderFeatures({ lighting, grade }) turns the pixel-banded light map
// (render/lighting.ts; off = the flat darkness overlay) and OmniGrade (render/grade.ts) on or off, live. The settings
// UI (quality lane) calls it for Low / Medium / High; both are off by themselves on the Canvas renderer.
import Phaser from 'phaser';
import type { Registry } from '../../core/registry';
import { gameBus } from '../events';
import './fonts';
import '../../ui/styles/render.css';
import { applyLut, bakeLut, GRADE_LOOKS, type GradeLookId, gradeSettings, setGradeEnabled, setGradeStrength } from './grade';
import { lightSettings, setLightingEnabled } from './lighting';
import { type PixelScale, pixelScale } from './pixelscale';

/** World render features the quality settings switch (light lane). */
export interface RenderFeatures {
  /** Pixel-banded light map on dark / night maps (false: the flat overlay on dark maps, nothing on night maps). */
  lighting: boolean;
  /** OmniGrade colour grade on the world camera. */
  grade: boolean;
}

/** Quality hook: turns world lighting and / or the grade on or off (applies to the running map at once). */
export function setRenderFeatures(f: Partial<RenderFeatures>): void {
  if (typeof f.lighting === 'boolean') setLightingEnabled(f.lighting);
  if (typeof f.grade === 'boolean') setGradeEnabled(f.grade);
}

/** The requested features (a Canvas renderer runs neither, whatever these say). */
export function renderFeatures(): RenderFeatures {
  return { lighting: lightSettings.enabled, grade: gradeSettings.enabled };
}

/** Key of the content Registry in `game.registry` (read it in any scene: `this.registry.get(REGISTRY_KEY)`). */
export const REGISTRY_KEY = 'omnipath.reg';
/** Key of the current PixelScale in `game.registry` (the stage converts HUD insets with it). */
export const SCALE_KEY = 'omnipath.pixelScale';

/** The content registry stored by createGame (BootScene: icons need it). */
export function bootRegistry(scene: Phaser.Scene): Registry | undefined {
  return scene.registry.get(REGISTRY_KEY) as Registry | undefined;
}

/** The current pixel scale (CSS px per art px etc.). */
export function currentScale(scene: Phaser.Scene): PixelScale | undefined {
  return scene.registry.get(SCALE_KEY) as PixelScale | undefined;
}

/** `?k=3` forces the device-px-per-art-px factor (QA). */
function forcedK(): number | undefined {
  if (typeof location === 'undefined') return undefined;
  const v = Number(new URLSearchParams(location.search).get('k'));
  return v > 0 ? v : undefined;
}

function viewport(parent: HTMLElement | null): { w: number; h: number } {
  const w = parent?.clientWidth || window.innerWidth || document.documentElement.clientWidth || 1;
  const h = parent?.clientHeight || window.innerHeight || document.documentElement.clientHeight || 1;
  return { w, h };
}

/** The scale for the current viewport. `prev`: the scale in use — its k is kept through small size changes (mobile
 *  address bars) as long as the DPR is unchanged. */
function measure(parent: HTMLElement | null, prev?: PixelScale): PixelScale {
  const { w, h } = viewport(parent);
  const dpr = window.devicePixelRatio || 1;
  return pixelScale(w, h, dpr, forcedK(), prev && prev.dpr === dpr ? prev.k : undefined);
}

export function createGame(scenes: Phaser.Types.Scenes.SceneType[], reg?: Registry): Phaser.Game {
  const parent = document.getElementById('game');
  let ps = measure(parent);
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: '#16261a',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    scale: {
      mode: Phaser.Scale.NONE,
      width: ps.artW,
      height: ps.artH,
      zoom: ps.cssPerArt,
      autoRound: false,
      autoCenter: Phaser.Scale.NO_CENTER,
    },
    input: { activePointers: 3 },
    // All sound comes from src/game/audio (one AudioContext); Phaser's own sound manager stays off.
    audio: { noAudio: true },
    scene: scenes,
  });
  if (reg) game.registry.set(REGISTRY_KEY, reg);
  game.registry.set(SCALE_KEY, ps);

  let asleep = false;
  /** Applies a scale: canvas size in art px, CSS size = art × k / dpr, then Phaser re-reads the canvas bounds. */
  const apply = (next: PixelScale) => {
    ps = next;
    game.registry.set(SCALE_KEY, ps);
    const sm = game.scale;
    sm.zoom = ps.cssPerArt;
    if (sm.width !== ps.artW || sm.height !== ps.artH) sm.resize(ps.artW, ps.artH);
    const canvas = game.canvas;
    if (canvas) {
      canvas.style.width = `${ps.cssW}px`;
      canvas.style.height = `${ps.cssH}px`;
    }
    document.documentElement.style.setProperty('--art-px', `${ps.cssPerArt}px`);
    sm.refresh();
    // Resizing the canvas clears it: while the loop sleeps, draw the (paused) world once at the new size.
    if (asleep) game.step(game.loop.time, 0);
  };

  let pending = 0;
  const onViewport = () => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      const next = measure(parent, ps);
      // (the visible viewport alone may change too: the stage re-fits its camera to the uncropped part)
      const same = next.k === ps.k && next.artW === ps.artW && next.artH === ps.artH && next.dpr === ps.dpr;
      if (!same || next.viewW !== ps.viewW || next.viewH !== ps.viewH) apply(next);
    });
  };
  window.addEventListener('resize', onViewport);
  window.addEventListener('orientationchange', onViewport);
  window.visualViewport?.addEventListener('resize', onViewport);
  // DPR changes (browser zoom, dragging the window to another screen): re-arm a resolution query each time.
  const watchDpr = () => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    const on = () => {
      mq.removeEventListener?.('change', on);
      onViewport();
      watchDpr();
    };
    mq.addEventListener?.('change', on);
  };
  watchDpr();
  game.events.once(Phaser.Core.Events.READY, () => apply(measure(parent, ps)));

  // Loop sleep: nothing of the world is visible under a full-screen panel (the Star Chart), so stop rendering it.
  const sleep = (on: boolean) => {
    if (on === asleep) return;
    asleep = on;
    if (on) game.loop.sleep();
    else {
      game.loop.resetDelta();
      game.loop.wake();
    }
  };
  gameBus.on('uiOpen', (e) => sleep(e.fullscreen));
  gameBus.on('uiClose', () => sleep(false));
  gameBus.on('discovery', () => sleep(false));

  installDebug(game, () => ps, () => asleep);
  return game;
}

/** `window.omnipath.render`: the pixel scale, and `check()` — every pixel-perfect invariant, with the failures. */
function installDebug(game: Phaser.Game, scale: () => PixelScale, asleep: () => boolean): void {
  /** The running map's stage (light map / grade stats), read structurally. */
  const stage = () => {
    const sc = game.scene.getScenes(false).find((x) => x.sys.settings.key === 'Map') as
      | { stage?: { lighting: string; lightMap: { stats: object; profile: object } | null; grade: { stats: object; uniforms: object | null } | null } }
      | undefined;
    return sc?.stage;
  };
  const luts: Partial<Record<GradeLookId, Uint8ClampedArray>> = {};
  const api = {
    scale: () => ({ ...scale() }),
    asleep,
    /** Light lane: requested features, and setFeatures({ lighting, grade }) (the quality hook). */
    features: renderFeatures,
    setFeatures: (f: Partial<RenderFeatures>) => {
      setRenderFeatures(f);
      return renderFeatures();
    },
    /** QA: the grade's LUT mix multiplier (0 = identity, 1 = tuned). */
    gradeStrength: (k?: number) => {
      if (typeof k === 'number') setGradeStrength(k);
      return gradeSettings.strength;
    },
    /** QA: what the grade should make of an sRGB colour (0..255) at the running look and strength, before the
     *  vignette / dither (the CPU reference of the shader's LUT lookup; compare with renderer.snapshot pixels). */
    gradeExpect: (r: number, g: number, b: number) => {
      const gr = stage()?.grade as { stats: { look: GradeLookId; strength: number } } | null | undefined;
      if (!gr) return [r, g, b];
      const lut = (luts[gr.stats.look] ??= bakeLut(GRADE_LOOKS[gr.stats.look]));
      return applyLut(lut, gr.stats.strength, r / 255, g / 255, b / 255).map((v) => Math.round(v * 255));
    },
    /** How the running map is lit, with the light map's and the grade's stats. */
    light: () => {
      const st = stage();
      if (!st) return null;
      return {
        mode: st.lighting,
        renderer: game.renderer?.type === Phaser.WEBGL ? 'webgl' : 'canvas',
        cameras: game.scene.getScenes(false).find((x) => x.sys.settings.key === 'Map')?.cameras?.cameras.length ?? 0,
        lightMap: st.lightMap ? { ...st.lightMap.stats, profile: st.lightMap.profile } : null,
        grade: st.grade ? { ...st.grade.stats, uniforms: st.grade.uniforms } : null,
      };
    },
    check: () => {
      const ps = scale();
      const problems: string[] = [];
      const scenes = game.scene.getScenes(false);
      const scene = scenes.find((s) => s.sys.settings.key === 'Map' && s.sys.settings.status >= Phaser.Scenes.RUNNING && s.sys.settings.status <= Phaser.Scenes.SLEEPING) ?? scenes[0];
      const cam = scene?.cameras?.main;
      if (!cam) problems.push('no camera');
      else {
        if (cam.renderRoundPixels !== true) problems.push(`renderRoundPixels ${cam.renderRoundPixels}`);
        if (cam.zoom !== 1) problems.push(`zoom ${cam.zoom}`);
        if (!Number.isInteger(cam.scrollX) || !Number.isInteger(cam.scrollY)) problems.push(`scroll ${cam.scrollX},${cam.scrollY}`);
        if (cam.width !== ps.artW || cam.height !== ps.artH) problems.push(`camera ${cam.width}x${cam.height} vs ${ps.artW}x${ps.artH}`);
      }
      if (!Number.isInteger(ps.k) || ps.k < 1) problems.push(`k ${ps.k}`);
      const c = game.canvas;
      if (c.width !== ps.artW || c.height !== ps.artH) problems.push(`canvas ${c.width}x${c.height} vs ${ps.artW}x${ps.artH}`);
      const r = c.getBoundingClientRect();
      if (Math.abs(r.width - ps.cssW) > 0.5 || Math.abs(r.height - ps.cssH) > 0.5) problems.push(`css ${r.width}x${r.height} vs ${ps.cssW}x${ps.cssH}`);
      const ir = getComputedStyle(c).imageRendering;
      if (!/pixelated|crisp-edges|optimize-contrast/.test(ir)) problems.push(`image-rendering ${ir}`);
      const short = Math.min(ps.artW, ps.artH);
      return {
        ok: problems.length === 0,
        problems,
        k: ps.k,
        dpr: ps.dpr,
        art: [ps.artW, ps.artH],
        short,
        renderRoundPixels: cam?.renderRoundPixels ?? null,
        zoom: cam?.zoom ?? null,
        scroll: cam ? [cam.scrollX, cam.scrollY] : null,
        asleep: asleep(),
      };
    },
  };
  const w = window as unknown as { omnipath?: Record<string, unknown>; __omnipathRender?: typeof api };
  w.__omnipathRender = api;
  // main.ts assigns window.omnipath right after createGame() returns: attach once it exists.
  queueMicrotask(() => {
    if (w.omnipath && typeof w.omnipath === 'object') w.omnipath.render = api;
  });
}
