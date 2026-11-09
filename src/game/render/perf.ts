// ?perf overlay (quality lane; docs/QUALITY-PLAN.md Phase D item 15).
//
// A small pixel-font panel in the bottom-left corner (lifted above the skill bar where the bar reaches that corner,
// phone portrait; pointer-events none): fps, frame time p50 / p95 (frame-to-frame) and CPU time p50 /
// p95 (step → render), WebGL draw calls per frame, texture count and an estimated texture memory, the renderer and
// pixel scale, the VFX runtime's live sprites / bobs / particles / atlas pages and quality, audio voices, and the
// quality tier with the battery saver's frame cap.
//
// Off by default and free when off: nothing is hooked until the overlay is shown. Show it with `?perf` in the URL
// or window.omnipath.perf.show() / omnipath.debug.perf(true); omnipath.perf.sample() returns the numbers without the
// panel (Playwright). Draw calls are counted by wrapping gl.drawArrays / drawElements while the overlay is up.
import type Phaser from 'phaser';
import { audioEngine } from '../audio';
import { qualityState } from './quality';

/** Ring buffer of the last `size` samples with percentiles (frame times). */
export class FrameStats {
  private readonly buf: Float64Array;
  private n = 0;
  private i = 0;

  constructor(readonly size = 240) {
    this.buf = new Float64Array(size);
  }

  push(v: number): void {
    this.buf[this.i] = v;
    this.i = (this.i + 1) % this.size;
    if (this.n < this.size) this.n++;
  }

  get count(): number {
    return this.n;
  }

  /** Nearest-rank percentile (0..100) of the samples held; 0 when empty. */
  p(q: number): number {
    if (!this.n) return 0;
    const a = Array.from(this.buf.subarray(0, this.n)).sort((x, y) => x - y);
    return percentile(a, q);
  }

  clear(): void {
    this.n = 0;
    this.i = 0;
  }
}

/** Nearest-rank percentile of an ascending array (q in 0..100). */
export function percentile(sorted: readonly number[], q: number): number {
  if (!sorted.length) return 0;
  const rank = Math.ceil((Math.max(0, Math.min(100, q)) / 100) * sorted.length);
  return sorted[Math.max(0, Math.min(sorted.length - 1, rank - 1))];
}

/** A texture manager read structurally (Phaser.Textures.TextureManager). */
interface TextureListLike {
  list: Record<string, { source?: readonly { width: number; height: number; isRenderTexture?: boolean }[] } | undefined>;
}

/**
 * Textures and an estimate of their GPU memory: width × height × 4 bytes per source (RGBA8, no mipmaps under
 * pixelArt), each source counted once. Phaser's own 1-4 px placeholders ('__DEFAULT', '__MISSING', …) are skipped.
 * `targets`: render targets outside the manager (RenderTexture game objects: the baked ground, the light map).
 */
export function textureBudget(tm: TextureListLike, targets: readonly { width: number; height: number }[] = []): { count: number; bytes: number; renderTargets: number } {
  let count = 0;
  let bytes = 0;
  let renderTargets = targets.length;
  for (const t of targets) bytes += Math.max(0, t.width | 0) * Math.max(0, t.height | 0) * 4;
  const seen = new Set<object>();
  for (const key in tm.list) {
    if (key.startsWith('__')) continue;
    const t = tm.list[key];
    if (!t) continue;
    count++;
    for (const s of t.source ?? []) {
      if (seen.has(s)) continue;
      seen.add(s);
      bytes += Math.max(0, s.width | 0) * Math.max(0, s.height | 0) * 4;
      if (s.isRenderTexture) renderTargets++;
    }
  }
  return { count, bytes, renderTargets };
}

export interface PerfSample {
  fps: number;
  frame: { p50: number; p95: number };
  cpu: { p50: number; p95: number };
  drawCalls: number | null;
  textures: { count: number; mb: number; renderTargets: number };
  renderer: 'WebGL' | 'Canvas' | 'none';
  /** Device px per art px and the backbuffer size in art px. */
  scale: { k: number; w: number; h: number } | null;
  vfx: { quality: number; sprites: number; bobs: number; particles: number; pages: number; updateMs: number } | null;
  audio: { voices: number; context: string } | null;
  quality: { tier: string; battery: boolean; fps: number };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The panel's lines (plain, short: the overlay is for testers). */
export function perfLines(s: PerfSample): string[] {
  const lines = [
    `FPS ${Math.round(s.fps)}${s.quality.fps ? ` (cap ${s.quality.fps})` : ''}`,
    `FRAME ${r1(s.frame.p50)} / ${r1(s.frame.p95)} ms`,
    `CPU ${r1(s.cpu.p50)} / ${r1(s.cpu.p95)} ms`,
    `DRAW ${s.drawCalls ?? '-'}  ${s.renderer}${s.scale ? ` k${s.scale.k} ${s.scale.w}x${s.scale.h}` : ''}`,
    `TEX ${s.textures.count}  ${r1(s.textures.mb)} MB  RT ${s.textures.renderTargets}`,
  ];
  if (s.vfx) lines.push(`VFX q${s.vfx.quality} SPR ${s.vfx.sprites} BOB ${s.vfx.bobs} PRT ${s.vfx.particles} PG ${s.vfx.pages}`);
  if (s.audio) lines.push(`AUDIO ${s.audio.voices} voices (${s.audio.context})`);
  lines.push(`${s.quality.tier.toUpperCase()}${s.quality.battery ? ' + BATTERY' : ''}`);
  return lines;
}

export interface PerfHandle {
  show(): void;
  hide(): void;
  toggle(on?: boolean): boolean;
  readonly shown: boolean;
  /** The numbers right now (draw calls and frame times only while the overlay runs). */
  sample(): PerfSample;
}

const PANEL_ID = 'omni-perf';
const STYLE_ID = 'omni-perf-css';
/** Frame-to-frame gaps this long are a sleeping loop, left out of the frame times. */
const MAX_FRAME_GAP_MS = 1000;
/** The HUD's skill bar (src/ui/ui.ts safeInsets reads the same element). */
const HOTBAR_SEL = '.hotbar .slots';

/**
 * How far (CSS px from the bottom of the window) the panel must sit to clear the skill bar: the bar's height when it
 * reaches into the panel's columns (phone portrait: the bar starts at the left edge), else 0 (iPad, landscape).
 */
export function hotbarLift(panel: { left: number; right: number }, bar: { left: number; right: number; top: number; width: number; height: number } | null, viewH: number): number {
  if (!bar || bar.width < 1 || bar.height < 1) return 0;
  if (bar.left >= panel.right || bar.right <= panel.left) return 0;
  return Math.max(0, Math.round(viewH - bar.top));
}

/** Tiny5 at 8 art px (pixel-exact at whole art px), dark plate with the 1 art px #24180f outline. */
const CSS = `
#${PANEL_ID} {
  position: fixed;
  left: calc(env(safe-area-inset-left, 0px) + 2 * var(--art-px, 1px));
  bottom: calc(env(safe-area-inset-bottom, 0px) + 12 * var(--art-px, 1px));
  z-index: 9000;
  margin: 0;
  padding: calc(2 * var(--art-px, 1px)) calc(3 * var(--art-px, 1px));
  font: calc(8 * var(--art-px, 1px)) / calc(9 * var(--art-px, 1px)) var(--font-small, 'Tiny5', monospace);
  color: #f2e6c8;
  background: rgba(20, 14, 9, 0.94);
  border: var(--art-px, 1px) solid #24180f;
  box-shadow: inset 0 0 0 var(--art-px, 1px) rgba(233, 196, 106, 0.35);
  white-space: pre;
  pointer-events: none;
  -webkit-font-smoothing: none;
  font-smooth: never;
  text-rendering: optimizeSpeed;
}
#${PANEL_ID} b { color: #ffe6a0; font-weight: 400; }
#${PANEL_ID} .warn { color: #ff9a7a; }
`;

/** Wraps gl.drawArrays / drawElements to count calls; returns the restore function. */
function hookDraws(gl: WebGLRenderingContext, onDraw: () => void): () => void {
  const g = gl as unknown as Record<string, unknown>;
  const names = ['drawArrays', 'drawElements'] as const;
  const orig = names.map((n) => g[n] as (...a: unknown[]) => unknown);
  names.forEach((n, i) => {
    const f = orig[i];
    g[n] = function (this: unknown, ...a: unknown[]) {
      onDraw();
      return f.apply(this, a);
    };
  });
  return () => names.forEach((n, i) => (g[n] = orig[i]));
}

export function installPerf(game: Phaser.Game, opts: { show?: boolean } = {}): PerfHandle {
  const frames = new FrameStats();
  const cpu = new FrameStats();
  let shown = false;
  let lastPost = 0;
  let stepAt = 0;
  let draws = 0;
  let lastDraws: number | null = null;
  let fps = 0;
  let fpsCount = 0;
  let fpsAt = 0;
  let unhook: (() => void) | null = null;
  let panel: HTMLElement | null = null;
  let timer = 0;
  let tex = { count: 0, mb: 0, renderTargets: 0 };
  let texAt = 0;

  // Draw calls are counted over the whole frame (step → render): render-texture draws made in update or pre-render
  // (the light map) count whatever order the listeners were added in.
  const onPreStep = () => {
    stepAt = performance.now();
    draws = 0;
  };
  const onPostRender = () => {
    const now = performance.now();
    if (stepAt) cpu.push(now - stepAt);
    // A gap of a second or more is the loop sleeping (full-screen panel, hidden tab, context loss), not a slow frame.
    if (lastPost && now - lastPost < MAX_FRAME_GAP_MS) frames.push(now - lastPost);
    lastPost = now;
    lastDraws = unhook ? draws : null;
    fpsCount++;
    if (now - fpsAt >= 1000) {
      fps = fpsAt ? (fpsCount * 1000) / (now - fpsAt) : fpsCount;
      fpsCount = 0;
      fpsAt = now;
    }
  };

  const webgl = () => (game.renderer as { type?: number } | null)?.type === 2;

  const mapScene = () =>
    game.scene.getScenes(false).find((s) => s.sys.settings.key === 'Map') as
      | (Phaser.Scene & { vfx?: { stats?: () => { quality: number; sprites: { body: number; glow: number; ground: number }; bobs: number; particles: number; pages: number; updateMs: number } } })
      | undefined;

  const sample = (): PerfSample => {
    const now = performance.now();
    if (now - texAt > 1000 || !texAt) {
      // RenderTexture game objects (baked ground chunks, the light map) keep their targets outside the manager; a
      // paused map (a panel is up) still holds them, so every scene is read, running or not.
      const targets: { width: number; height: number }[] = [];
      for (const sc of game.scene.getScenes(false))
        for (const go of sc.children?.list ?? []) if (go.type === 'RenderTexture') targets.push(go as unknown as { width: number; height: number });
      const b = textureBudget(game.textures as unknown as TextureListLike, targets);
      tex = { count: b.count, mb: b.bytes / (1024 * 1024), renderTargets: b.renderTargets };
      texAt = now;
    }
    let vfx: PerfSample['vfx'] = null;
    try {
      const st = mapScene()?.vfx?.stats?.();
      if (st) vfx = { quality: st.quality, sprites: st.sprites.body + st.sprites.glow + st.sprites.ground, bobs: st.bobs, particles: st.particles, pages: st.pages, updateMs: st.updateMs };
    } catch {
      /* map not running */
    }
    let audio: PerfSample['audio'] = null;
    try {
      const a = audioEngine().state();
      audio = { voices: a.voices, context: a.context };
    } catch {
      /* audio unavailable */
    }
    const ps = game.registry?.get('omnipath.pixelScale') as { k: number; artW: number; artH: number } | undefined;
    const q = qualityState();
    return {
      // (hidden: Phaser's actualFps counts animation frames, not capped game frames — clamp it to the battery cap)
      fps: shown ? fps : Math.min(game.loop?.actualFps ?? 0, q.fps || Infinity),
      frame: { p50: frames.p(50), p95: frames.p(95) },
      cpu: { p50: cpu.p(50), p95: cpu.p(95) },
      drawCalls: lastDraws,
      textures: tex,
      renderer: !game.renderer ? 'none' : webgl() ? 'WebGL' : 'Canvas',
      scale: ps ? { k: ps.k, w: ps.artW, h: ps.artH } : null,
      vfx,
      audio,
      quality: { tier: q.tier, battery: q.battery, fps: q.fps },
    };
  };

  const paint = () => {
    if (!panel) return;
    const s = sample();
    const lines = perfLines(s);
    // The fps line turns orange below 55 (or below the cap), the frame line when p95 is over 20 ms.
    const slow = s.fps < (s.quality.fps ? s.quality.fps - 3 : 55);
    const html = lines.map((l, i) => {
      const t = l.replace(/[&<>]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : '&gt;'));
      if (i === 0 && slow) return `<span class="warn">${t}</span>`;
      if (i === 1 && s.frame.p95 > (s.quality.fps ? 40 : 20)) return `<span class="warn">${t}</span>`;
      if (i === lines.length - 1) return `<b>${t}</b>`;
      return t;
    });
    panel.innerHTML = html.join('\n');
    // Clear of the skill bar where it reaches the left corner (phone portrait); the CSS corner elsewhere.
    const bar = document.querySelector<HTMLElement>(HOTBAR_SEL)?.getBoundingClientRect() ?? null;
    const lift = hotbarLift(panel.getBoundingClientRect(), bar, window.innerHeight);
    panel.style.bottom = lift ? `calc(${lift}px + 2 * var(--art-px, 1px))` : '';
  };

  const show = () => {
    if (shown || typeof document === 'undefined') return;
    shown = true;
    if (!document.getElementById(STYLE_ID)) {
      const st = document.createElement('style');
      st.id = STYLE_ID;
      st.textContent = CSS;
      document.head.append(st);
    }
    panel = document.createElement('pre');
    panel.id = PANEL_ID;
    panel.setAttribute('aria-hidden', 'true');
    document.body.append(panel);
    frames.clear();
    cpu.clear();
    lastPost = 0;
    fpsAt = 0;
    fpsCount = 0;
    game.events.on('prestep', onPreStep);
    game.events.on('postrender', onPostRender);
    const gl = webgl() ? (game.renderer as unknown as { gl?: WebGLRenderingContext }).gl : undefined;
    if (gl) unhook = hookDraws(gl, () => draws++);
    timer = window.setInterval(paint, 250);
    paint();
  };

  const hide = () => {
    if (!shown) return;
    shown = false;
    game.events.off('prestep', onPreStep);
    game.events.off('postrender', onPostRender);
    unhook?.();
    unhook = null;
    lastDraws = null;
    clearInterval(timer);
    panel?.remove();
    panel = null;
  };

  const handle: PerfHandle = {
    show,
    hide,
    toggle: (on) => {
      if (on ?? !shown) show();
      else hide();
      return shown;
    },
    get shown() {
      return shown;
    },
    sample,
  };

  const wanted = opts.show ?? (typeof location !== 'undefined' && new URLSearchParams(location.search).has('perf'));
  if (wanted) {
    // The renderer exists once the game booted (main.ts runs after the DOM is ready, so usually at once).
    if (game.renderer) show();
    else game.events.once('ready', show);
  }
  return handle;
}
