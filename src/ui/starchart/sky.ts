// The Star Chart sky (starchart lane; docs/CLIENT-v3.md §3): a full-screen night-sky DOM canvas, DPR-aware, with
// faint star dust and constellation nebulae. Drag to pan (with a little glide), pinch / wheel to zoom 0.5–2.5,
// double-tap to zoom in, tap a star to pick it. Draws only what is in view and only when something changes (a
// gesture, a camera flight, a pulsing ✨ star in view, a burst) — the frame cost is measured (perf()).
//
// One SkyView lives for the whole run: the panel re-mounts the same canvas on every re-render, so the camera, the
// pixels and the listeners survive taps, equips and transforms. It stops drawing as soon as the canvas is detached.
import {
  type Box,
  type Camera,
  type Insets,
  NO_INSETS,
  type ViewSize,
  clampCam,
  clampZoom,
  centreOn,
  fitBox,
  inBox,
  lerpCam,
  pickStar,
  segmentInBox,
  starScreenRadius,
  toScreen,
  toSky,
  visibleBox,
  zoomAt,
} from './camera';
import type { ConstellationId, StarChartData, StarView } from './data';
import { type PlacedStar, type StarLayout, boxOf } from './layout';

export interface SkyHost {
  /** A star was tapped (null: empty sky). */
  tap(id: string | null): void;
  /** Pixel icon (data URL) of a star, '' for none. */
  icon(star: StarView): string;
  /** '#rrggbb' of an element id. */
  elementColor(id: string): string;
  /** The constellation nearest the middle of the view changed (null: open sky). */
  centred?(c: ConstellationId | null): void;
}

/** Constellation tints: unaligned stars, lines, nebulae and names take their constellation's colour. */
export const TINT: Record<ConstellationId, string> = {
  edge: '#9cc3ff',
  fang: '#c7a2ff',
  lantern: '#79e2ff',
  heart: '#ffd76a',
  craft: '#ffb46b',
  wild: '#8fe388',
  crown: '#ffe08a',
  universal: '#e8ecff',
  fusion: '#ff9fe0',
};
const GOLD = '#ffd76a';
const MUTE = '#9aa6c6';
const INK = '#e9eefb';

/** Zoom from which known stars show their pixel icon in a round plate. */
const ICON_ZOOM = 1.35;
/** Zoom from which star names are written under the stars (they never overlap: the brightest win). */
const NAME_ZOOM = 0.5;
const DUST_TILE = 320;

const rgb = (hex: string): [number, number, number] => {
  const h = hex.replace('#', '');
  const n = parseInt(h.length === 3 ? h.replace(/./g, (c) => c + c) : h.slice(0, 6), 16) || 0xffffff;
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const rgba = (hex: string, a: number) => {
  const [r, g, b] = rgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

/** Small seeded PRNG (mulberry32) so the dust never shimmers between redraws. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Tween {
  from: Camera;
  to: Camera;
  t0: number;
  ms: number;
}

interface Effect {
  id: string;
  t0: number;
  ms: number;
}

type Gesture =
  | { kind: 'pan'; sx: number; sy: number; cam: Camera; moved: boolean; t0: number }
  | { kind: 'pinch'; d0: number; z0: number; anchor: { x: number; y: number } }
  | null;

export class SkyView {
  readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  cam: Camera = { x: 0, y: 0, z: 1 };
  private view: ViewSize = { w: 0, h: 0 };
  private dpr = 1;
  private insets: Insets = NO_INSETS;
  private data: StarChartData | null = null;
  private layout: StarLayout | null = null;
  private byId = new Map<string, StarView>();
  /** Placed stars of the chart (drawn ones only). */
  private placed: (PlacedStar & { star: StarView })[] = [];
  private selected: string | null = null;
  private selectedAt = 0;
  private host: SkyHost | null = null;
  private raf = 0;
  private lastDraw = 0;
  private tween: Tween | null = null;
  private vel: { x: number; y: number; t: number } | null = null;
  private glide = false;
  private effects: Effect[] = [];
  private pointers = new Map<number, { x: number; y: number }>();
  private gesture: Gesture = null;
  private lastTap = { t: 0, x: 0, y: 0 };
  private resizeObs: ResizeObserver | null = null;
  /** Runs once the canvas has a size (the first fit needs it). */
  private pending: (() => void) | null = null;
  private ready = false;
  private font = 'system-ui, sans-serif';
  private icons = new Map<string, HTMLImageElement>();
  private glows = new Map<string, HTMLCanvasElement>();
  private nebulae = new Map<string, HTMLCanvasElement>();
  private dust: [HTMLCanvasElement, HTMLCanvasElement] | null = null;
  private dustDpr = 0;
  private bg: { h: number; grad: CanvasGradient; vignette: CanvasGradient } | null = null;
  private times: number[] = [];
  private centredOn: ConstellationId | null | undefined = undefined;
  private dirty = false;
  private warm = false;

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'sc-canvas';
    this.canvas.setAttribute('role', 'img');
    this.canvas.setAttribute('aria-label', 'Star Chart: drag to look around, pinch to zoom, tap a star.');
    this.ctx = this.canvas.getContext('2d', { alpha: false })!;
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.down(e));
    c.addEventListener('pointermove', (e) => this.move(e));
    c.addEventListener('pointerup', (e) => this.up(e, true));
    c.addEventListener('pointercancel', (e) => this.up(e, false));
    c.addEventListener('lostpointercapture', (e) => this.up(e, false));
    c.addEventListener('wheel', (e) => this.wheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    // Debug / playtest hook (read-only): document.querySelector('.sc-canvas').__sky.perf()
    (c as unknown as { __sky: SkyView }).__sky = this;
  }

  // ================================================================ wiring

  /** Puts the canvas into `el` (a re-render passes a fresh container; the canvas and its camera carry over). */
  mount(el: HTMLElement, host: SkyHost): void {
    this.host = host;
    if (this.canvas.parentElement !== el) el.appendChild(this.canvas);
    this.resizeObs?.disconnect();
    this.resizeObs = new ResizeObserver(() => this.resize());
    this.resizeObs.observe(el);
    const f = getComputedStyle(document.documentElement).getPropertyValue('--font-ui').trim();
    if (f) this.font = f;
    document.fonts?.ready.then(() => this.requestDraw()).catch(() => undefined);
    this.resize();
  }

  setData(data: StarChartData, layout: StarLayout): void {
    if (!this.warm) {
      // Build the sprite caches up front so the first frames stay cheap.
      this.warm = true;
      for (const c of Object.keys(TINT) as ConstellationId[]) {
        this.glow(TINT[c]);
        this.nebula(c);
      }
      this.glow(GOLD);
    }
    for (const s of data.stars) if (s.element && s.state !== 'fog' && s.state !== 'whisper') this.glow(this.colorOf(s));
    this.centredOn = undefined;
    this.data = data;
    this.layout = layout;
    this.byId = new Map(data.stars.map((s) => [s.id, s]));
    this.placed = [];
    for (const s of data.stars) {
      const p = layout.stars.get(s.id);
      if (p) this.placed.push({ ...p, star: s });
    }
    this.requestDraw();
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
  }

  setSelected(id: string | null): void {
    if (id !== this.selected) this.selectedAt = performance.now();
    this.selected = id;
    this.requestDraw();
  }

  /** Whether the camera has been placed at least once (a reopened chart keeps where the player looked). */
  get placedOnce(): boolean {
    return this.ready;
  }

  /** Runs `fn` now if the canvas has a size, else as soon as it gets one. */
  whenSized(fn: () => void): void {
    if (this.view.w > 0 && this.view.h > 0) fn();
    else this.pending = fn;
  }

  /** Average and worst draw time of the recent frames (ms). */
  perf(): { avg: number; max: number; frames: number } {
    const n = this.times.length;
    return { avg: n ? this.times.reduce((a, b) => a + b, 0) / n : 0, max: n ? Math.max(...this.times) : 0, frames: n };
  }

  // ================================================================ camera moves

  private bounds(): Box {
    return this.layout?.bounds ?? { minX: -2000, minY: -2000, maxX: 2000, maxY: 2000 };
  }

  private setCam(cam: Camera): void {
    this.cam = clampCam(cam, this.bounds());
    this.ready = true;
    this.requestDraw();
  }

  /** Flies (or jumps) to a camera. */
  flyTo(cam: Camera, ms = 520): void {
    const to = clampCam(cam, this.bounds());
    this.glide = false;
    this.ready = true;
    if (ms <= 0 || !this.view.w) {
      this.tween = null;
      this.setCam(to);
      return;
    }
    this.tween = { from: { ...this.cam }, to, t0: performance.now(), ms };
    this.requestDraw();
  }

  /** Centres a star in the part of the sky not under the chips / card, zooming to at least `minZ`. */
  focusStar(id: string, opts: { minZ?: number; fly?: boolean } = {}): boolean {
    const p = this.layout?.stars.get(id);
    if (!p) return false;
    const z = clampZoom(Math.max(this.ready ? this.cam.z : 1, opts.minZ ?? 0.9));
    this.flyTo(centreOn(p, z, this.view, this.insets), opts.fly === false ? 0 : 520);
    return true;
  }

  /** Glides a star into the visible area if the card or the chips cover it (keeps the zoom). */
  ensureVisible(id: string): void {
    const p = this.layout?.stars.get(id);
    if (!p || !this.view.w) return;
    const cam = this.tween?.to ?? this.cam;
    const s = toScreen(cam, this.view, p.x, p.y);
    const mx = Math.min(90, (this.view.w - this.insets.left - this.insets.right) / 4);
    const my = Math.min(60, (this.view.h - this.insets.top - this.insets.bottom) / 4);
    const i = this.insets;
    const hidden = s.x < i.left + mx || s.x > this.view.w - i.right - mx || s.y < i.top + my || s.y > this.view.h - i.bottom - my;
    if (hidden) this.flyTo(centreOn(p, cam.z, this.view, this.insets), 420);
  }

  /** Fits a constellation's drawn stars (or its empty patch of sky) into view. */
  fitConstellation(c: ConstellationId, fly = true): void {
    if (!this.layout) return;
    const centre = this.layout.centres[c];
    const pts: { x: number; y: number }[] = [];
    for (const p of this.placed) {
      const s = p.star;
      const home = s.constellation === c || (c === 'craft' && s.constellation === 'universal');
      if (home && s.kind !== 'variant') pts.push(p);
    }
    const tree = c === 'edge' || c === 'fang' || c === 'lantern';
    const box = boxOf(pts.length ? [...pts, centre] : [], centre, tree ? 200 : c === 'heart' ? 250 : 220);
    this.flyTo(fitBox(box, this.view, this.insets, 28, 1.3), fly ? 560 : 0);
  }

  /** Zoom buttons: by `factor` around the centre of the visible area. */
  zoomBy(factor: number): void {
    const cx = (this.insets.left + this.view.w - this.insets.right) / 2;
    const cy = (this.insets.top + this.view.h - this.insets.bottom) / 2;
    this.flyTo(zoomAt(this.tween?.to ?? this.cam, this.view, factor, cx, cy), 260);
  }

  /** A burst of light on a star (a fresh transform). */
  burst(id: string): void {
    this.effects.push({ id, t0: performance.now(), ms: 1400 });
    this.requestDraw();
  }

  // ================================================================ input

  private local(e: { clientX: number; clientY: number }): { x: number; y: number } {
    const r = this.canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      /* synthetic events */
    }
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    this.tween = null;
    this.glide = false;
    if (this.pointers.size === 1) {
      this.gesture = { kind: 'pan', sx: p.x, sy: p.y, cam: { ...this.cam }, moved: false, t0: performance.now() };
      this.vel = null;
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      this.gesture = { kind: 'pinch', d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), z0: this.cam.z, anchor: toSky(this.cam, this.view, mid.x, mid.y) };
    }
  }

  private move(e: PointerEvent): void {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.set(e.pointerId, p);
    const g = this.gesture;
    if (!g) return;
    if (g.kind === 'pan') {
      const dx = p.x - g.sx;
      const dy = p.y - g.sy;
      if (!g.moved && Math.hypot(dx, dy) < 7) return;
      g.moved = true;
      const now = performance.now();
      const prev = { ...this.cam };
      this.setCam({ x: g.cam.x - dx / g.cam.z, y: g.cam.y - dy / g.cam.z, z: g.cam.z });
      const dt = Math.max(1, now - (this.vel?.t ?? now - 16));
      const vx = ((prev.x - this.cam.x) * this.cam.z) / dt;
      const vy = ((prev.y - this.cam.y) * this.cam.z) / dt;
      this.vel = { x: this.vel ? this.vel.x * 0.3 + vx * 0.7 : vx, y: this.vel ? this.vel.y * 0.3 + vy * 0.7 : vy, t: now };
    } else if (this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const z = clampZoom((g.z0 * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0);
      this.setCam({ x: g.anchor.x - (mid.x - this.view.w / 2) / z, y: g.anchor.y - (mid.y - this.view.h / 2) / z, z });
    }
  }

  private up(e: PointerEvent, real: boolean): void {
    if (!this.pointers.has(e.pointerId)) return;
    const p = this.local(e);
    this.pointers.delete(e.pointerId);
    const g = this.gesture;
    if (g?.kind === 'pinch') {
      // One finger left: keep panning with it (never a tap).
      const rest = [...this.pointers.values()][0];
      this.gesture = rest ? { kind: 'pan', sx: rest.x, sy: rest.y, cam: { ...this.cam }, moved: true, t0: performance.now() } : null;
      this.vel = null;
      return;
    }
    this.gesture = null;
    if (!g || !real) return;
    if (!g.moved) {
      if (performance.now() - g.t0 < 650) this.tapAt(p.x, p.y);
      return;
    }
    // A flick keeps gliding for a moment.
    if (this.vel && performance.now() - this.vel.t < 80 && Math.hypot(this.vel.x, this.vel.y) > 0.15) {
      this.glide = true;
      this.vel.t = performance.now();
      this.requestDraw();
    }
  }

  private tapAt(x: number, y: number): void {
    const now = performance.now();
    const double = now - this.lastTap.t < 330 && Math.hypot(x - this.lastTap.x, y - this.lastTap.y) < 34;
    const vb = visibleBox(this.cam, this.view, 40);
    const id = pickStar(
      this.placed.filter((s) => inBox(vb, s.x, s.y, 30)),
      this.cam,
      this.view,
      x,
      y,
    );
    if (double) {
      this.lastTap = { t: 0, x: 0, y: 0 };
      this.flyTo(zoomAt(this.cam, this.view, 1.8, x, y), 320);
      if (id && id !== this.selected) this.host?.tap(id);
      return;
    }
    this.lastTap = { t: now, x, y };
    this.host?.tap(id);
  }

  private wheel(e: WheelEvent): void {
    e.preventDefault();
    const p = this.local(e);
    const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    const k = e.ctrlKey ? 0.012 : 0.0016;
    this.tween = null;
    this.glide = false;
    this.setCam(zoomAt(this.cam, this.view, Math.exp(-e.deltaY * unit * k), p.x, p.y));
  }

  // ================================================================ frames

  private resize(): void {
    const el = this.canvas.parentElement;
    if (!el) return;
    const w = Math.max(1, Math.round(el.clientWidth));
    const h = Math.max(1, Math.round(el.clientHeight));
    const dpr = Math.min(2.5, Math.max(1, window.devicePixelRatio || 1));
    if (w === this.view.w && h === this.view.h && dpr === this.dpr) return;
    // Keep the same sky point in the middle of the visible area when the canvas changes size.
    this.view = { w, h };
    this.dpr = dpr;
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    this.bg = null;
    if (this.pending) {
      const fn = this.pending;
      this.pending = null;
      fn();
    }
    this.draw(performance.now());
    this.requestDraw();
  }

  /** Something changed (a gesture, data, a selection): draw on the very next frame. */
  requestDraw(): void {
    this.dirty = true;
    if (this.raf || typeof requestAnimationFrame === 'undefined') return;
    this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  private frame(now: number): void {
    this.raf = 0;
    if (!this.canvas.isConnected || !this.view.w) {
      this.tween = null;
      this.glide = false;
      return;
    }
    let moving = false;
    if (this.tween) {
      const t = (now - this.tween.t0) / this.tween.ms;
      if (t >= 1) {
        this.cam = this.tween.to;
        this.tween = null;
      } else {
        this.cam = clampCam(lerpCam(this.tween.from, this.tween.to, t), this.bounds());
        moving = true;
      }
    }
    if (this.glide && this.vel) {
      const dt = Math.min(48, now - this.vel.t);
      this.vel.t = now;
      const before = { ...this.cam };
      this.cam = clampCam({ x: this.cam.x - (this.vel.x * dt) / this.cam.z, y: this.cam.y - (this.vel.y * dt) / this.cam.z, z: this.cam.z }, this.bounds());
      const decay = Math.exp(-dt / 210);
      this.vel.x *= decay;
      this.vel.y *= decay;
      if (Math.hypot(this.vel.x, this.vel.y) < 0.02 || (before.x === this.cam.x && before.y === this.cam.y)) this.glide = false;
      else moving = true;
    }
    this.effects = this.effects.filter((f) => now - f.t0 < f.ms);
    // Only pulsing stars in view (nothing asked for a redraw): ~30 fps is plenty.
    if (!moving && !this.dirty && !this.effects.length && now - this.lastDraw < 30 && this.lastDraw) {
      this.raf = requestAnimationFrame((t) => this.frame(t));
      return;
    }
    const animated = this.draw(now);
    if (moving || animated || this.effects.length) this.raf = requestAnimationFrame((t) => this.frame(t));
  }

  /** Draws one frame; true when something in view is animating (✨ pulses, a fresh selection). */
  private draw(now: number): boolean {
    const { ctx, view, cam } = this;
    if (!view.w || !view.h) return false;
    const t0 = performance.now();
    this.lastDraw = now;
    this.dirty = false;
    const dpr = this.dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
    this.drawBackground();
    const vb = visibleBox(cam, view, 60);
    const layout = this.layout;
    let animated = false;
    if (layout && this.data) {
      this.drawNebulae(layout, vb);
      this.drawDust();
      const rects: number[][] = [];
      this.drawSkyLabels(layout, vb, rects, 'constellation');
      this.drawLines(vb);
      animated = this.drawStars(vb, now, rects);
      // Trainer / region names last: written only where no star name is (star names matter more).
      this.drawSkyLabels(layout, vb, rects, 'group');
    } else this.drawDust();
    // Vignette.
    ctx.fillStyle = this.bg!.vignette;
    ctx.fillRect(0, 0, view.w, view.h);
    if (layout) this.noteCentre(layout);
    const ms = performance.now() - t0;
    this.times.push(ms);
    if (this.times.length > 90) this.times.shift();
    return animated;
  }

  /** Tells the host which constellation the view is on (the chips light up the current one). */
  private noteCentre(layout: StarLayout): void {
    const i = this.insets;
    const mid = toSky(this.cam, this.view, (i.left + this.view.w - i.right) / 2, (i.top + this.view.h - i.bottom) / 2);
    let best: ConstellationId | null = null;
    let bestD = 760;
    for (const c of ['edge', 'fang', 'lantern', 'heart', 'craft', 'wild', 'crown'] as const) {
      const p = layout.centres[c];
      const d = Math.hypot(p.x - mid.x, p.y - mid.y) * (c === 'heart' ? 1.4 : 1);
      if (d < bestD) {
        bestD = d;
        best = c;
      }
    }
    if (best !== this.centredOn) {
      this.centredOn = best;
      this.host?.centred?.(best);
    }
  }

  private drawBackground(): void {
    const { ctx, view } = this;
    if (!this.bg || this.bg.h !== view.h) {
      const grad = ctx.createLinearGradient(0, 0, 0, view.h);
      grad.addColorStop(0, '#05081a');
      grad.addColorStop(0.55, '#0a1030');
      grad.addColorStop(1, '#140f2e');
      const r = Math.hypot(view.w, view.h) / 2;
      const vignette = ctx.createRadialGradient(view.w / 2, view.h / 2, r * 0.45, view.w / 2, view.h / 2, r);
      vignette.addColorStop(0, 'rgba(2,3,10,0)');
      vignette.addColorStop(1, 'rgba(2,3,10,0.55)');
      this.bg = { h: view.h, grad, vignette };
    }
    ctx.fillStyle = this.bg.grad;
    ctx.fillRect(0, 0, view.w, view.h);
  }

  private dustTiles(): [HTMLCanvasElement, HTMLCanvasElement] {
    if (this.dust && this.dustDpr === this.dpr) return this.dust;
    const make = (seed: number, n: number, big: boolean) => {
      const c = document.createElement('canvas');
      c.width = c.height = Math.round(DUST_TILE * this.dpr);
      const g = c.getContext('2d')!;
      g.scale(this.dpr, this.dpr);
      const rnd = prng(seed);
      const tints = ['#ffffff', '#cfe0ff', '#ffe9c7', '#d9ccff'];
      for (let i = 0; i < n; i++) {
        const x = rnd() * DUST_TILE;
        const y = rnd() * DUST_TILE;
        const a = big ? 0.35 + rnd() * 0.5 : 0.12 + rnd() * 0.38;
        const r = big ? 0.7 + rnd() * 0.8 : 0.35 + rnd() * 0.55;
        g.fillStyle = rgba(tints[Math.floor(rnd() * tints.length)], a);
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
        if (big && rnd() < 0.12) {
          g.fillStyle = rgba('#ffffff', a * 0.5);
          g.fillRect(x - 3, y - 0.35, 6, 0.7);
          g.fillRect(x - 0.35, y - 3, 0.7, 6);
        }
      }
      return c;
    };
    this.dust = [make(7, 170, false), make(91, 26, true)];
    this.dustDpr = this.dpr;
    return this.dust;
  }

  private drawDust(): void {
    const { ctx, view, cam } = this;
    const [far, near] = this.dustTiles();
    const layer = (tile: HTMLCanvasElement, k: number) => {
      const T = DUST_TILE;
      const ox = (((-cam.x * cam.z * k) % T) + T) % T;
      const oy = (((-cam.y * cam.z * k) % T) + T) % T;
      for (let x = ox - T; x < view.w; x += T) for (let y = oy - T; y < view.h; y += T) ctx.drawImage(tile, x, y, T, T);
    };
    layer(far, 0.12);
    layer(near, 0.32);
  }

  private nebula(c: ConstellationId): HTMLCanvasElement {
    let n = this.nebulae.get(c);
    if (n) return n;
    n = document.createElement('canvas');
    n.width = n.height = 256;
    const g = n.getContext('2d')!;
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, rgba(TINT[c], 0.2));
    grad.addColorStop(0.45, rgba(TINT[c], 0.075));
    grad.addColorStop(1, rgba(TINT[c], 0));
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    this.nebulae.set(c, n);
    return n;
  }

  private drawNebulae(layout: StarLayout, vb: Box): void {
    const { ctx, view, cam } = this;
    for (const c of ['heart', 'edge', 'fang', 'lantern', 'craft', 'wild', 'crown'] as const) {
      const ctr = layout.centres[c];
      const R = c === 'heart' ? 430 : 560;
      if (!inBox(vb, ctr.x, ctr.y, R)) continue;
      const p = toScreen(cam, view, ctr.x, ctr.y);
      const s = R * cam.z;
      ctx.drawImage(this.nebula(c), p.x - s, p.y - s, s * 2, s * 2);
    }
  }

  /**
   * Constellation names (a faint backdrop drawn first; while zoomed out they are readable and keep star names off
   * them) or group names (trainers, regions; drawn after the star names and skipped where one would overlap a name).
   */
  private drawSkyLabels(layout: StarLayout, vb: Box, rects: number[][], kind: 'constellation' | 'group'): void {
    const { ctx, view, cam } = this;
    const z = cam.z;
    if (kind === 'group' && z < 0.8) return;
    const big = Math.max(0.16, Math.min(0.5, 0.5 - (z - 0.7) * 0.42));
    const size = kind === 'constellation' ? (z < 0.8 ? 17 : 15) : 11;
    ctx.font = `${size}px ${this.font}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of layout.labels) {
      if (l.kind !== kind || !inBox(vb, l.x, l.y, 200)) continue;
      const p = toScreen(cam, view, l.x, l.y);
      const spaced = kind === 'constellation' ? l.text.toUpperCase().split('').join(' ') : l.text;
      const w = ctx.measureText(spaced).width;
      const box = [p.x - w / 2 - 3, p.y - size / 2 - 2, p.x + w / 2 + 3, p.y + size / 2 + 2];
      if (kind === 'group' && rects.some((o) => box[0] < o[2] && box[2] > o[0] && box[1] < o[3] && box[3] > o[1])) continue;
      ctx.fillStyle = rgba(TINT[l.constellation], kind === 'constellation' ? big : 0.42);
      ctx.fillText(spaced, p.x, p.y);
      if (kind === 'group' || big >= 0.3) rects.push(box);
    }
  }

  private drawLines(vb: Box): void {
    const { ctx, view, cam } = this;
    const layout = this.layout!;
    ctx.lineCap = 'round';
    for (const l of this.data!.links) {
      const a = layout.stars.get(l.from);
      const b = layout.stars.get(l.to);
      if (!a || !b || !segmentInBox(vb, a.x, a.y, b.x, b.y)) continue;
      const pa = toScreen(cam, view, a.x, a.y);
      const pb = toScreen(cam, view, b.x, b.y);
      const len = Math.hypot(pb.x - pa.x, pb.y - pa.y);
      const icon = cam.z >= ICON_ZOOM;
      const ra = (icon && this.lit(l.from) ? 22 : starScreenRadius(a.r, cam.z)) + 3;
      const rb = (icon && this.lit(l.to) ? 22 : starScreenRadius(b.r, cam.z)) + 3;
      if (len <= ra + rb + 2) continue;
      const ux = (pb.x - pa.x) / len;
      const uy = (pb.y - pa.y) / len;
      const from = this.byId.get(l.from);
      const tint = l.kind === 'recipe' ? TINT.fusion : TINT[from?.constellation ?? 'edge'];
      ctx.beginPath();
      ctx.moveTo(pa.x + ux * ra, pa.y + uy * ra);
      ctx.lineTo(pb.x - ux * rb, pb.y - uy * rb);
      // A long line (a link across the sky, e.g. Quickstep → Shadowstep) stays faint so the figures stay clear.
      const far = Math.max(0.3, Math.min(1, 520 / Math.hypot(b.x - a.x, b.y - a.y)));
      if (l.known) {
        ctx.setLineDash([]);
        ctx.strokeStyle = rgba(tint, (l.kind === 'recipe' ? 0.4 : 0.55) * far);
        ctx.lineWidth = (cam.z >= 1 ? 1.8 : 1.3) * (far < 1 ? 0.8 : 1);
      } else {
        // Dotted toward a star still to find.
        ctx.setLineDash([1.5, 6]);
        ctx.strokeStyle = rgba(tint, 0.42 * far);
        ctx.lineWidth = 1.4;
      }
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  private lit(id: string): boolean {
    const s = this.byId.get(id);
    return !!s && s.kind !== 'variant' && (s.state === 'known' || s.state === 'mastered' || s.state === 'morphReady');
  }

  private glow(color: string): HTMLCanvasElement {
    let g = this.glows.get(color);
    if (g) return g;
    g = document.createElement('canvas');
    g.width = g.height = 64;
    const c = g.getContext('2d')!;
    const grad = c.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, rgba(color, 0.95));
    grad.addColorStop(0.16, rgba(color, 0.55));
    grad.addColorStop(0.42, rgba(color, 0.13));
    grad.addColorStop(1, rgba(color, 0));
    c.fillStyle = grad;
    c.fillRect(0, 0, 64, 64);
    this.glows.set(color, g);
    return g;
  }

  private colorOf(s: StarView): string {
    if (s.element && s.state !== 'fog' && s.state !== 'whisper') return this.host?.elementColor(s.element) || TINT[s.constellation];
    return TINT[s.constellation];
  }

  private icon(s: StarView): HTMLImageElement | null {
    let img = this.icons.get(s.id);
    if (!img) {
      const url = this.host?.icon(s) ?? '';
      if (!url) return null;
      img = new Image();
      img.onload = () => this.requestDraw();
      img.src = url;
      this.icons.set(s.id, img);
    }
    return img.complete && img.naturalWidth ? img : null;
  }

  private sparkle(x: number, y: number, size: number, color: string, alpha: number): void {
    const { ctx } = this;
    ctx.fillStyle = rgba(color, alpha);
    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.quadraticCurveTo(x, y, x + size, y);
    ctx.quadraticCurveTo(x, y, x, y + size);
    ctx.quadraticCurveTo(x, y, x - size, y);
    ctx.quadraticCurveTo(x, y, x, y - size);
    ctx.fill();
  }

  private drawStars(vb: Box, now: number, rects: number[][]): boolean {
    const { ctx, view, cam } = this;
    const z = cam.z;
    const iconA = Math.max(0, Math.min(1, (z - ICON_ZOOM) / 0.25));
    let animated = false;
    const inView = this.placed.filter((p) => inBox(vb, p.x, p.y, 40));
    const pos = new Map<string, { x: number; y: number; sr: number }>();
    for (const p of inView) {
      const sp = toScreen(cam, view, p.x, p.y);
      pos.set(p.id, { ...sp, sr: starScreenRadius(p.r, z) });
    }
    // Orbit rings of variant satellites (faint), under the stars.
    ctx.lineWidth = 1;
    for (const p of inView) {
      if (p.star.kind !== 'variant' || !p.star.base) continue;
      const b = this.layout!.stars.get(p.star.base);
      if (!b) continue;
      const c = toScreen(cam, view, b.x, b.y);
      ctx.strokeStyle = 'rgba(200,210,255,0.1)';
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.hypot(p.x - b.x, p.y - b.y) * z, 0, Math.PI * 2);
      ctx.stroke();
    }
    // Glows (additive).
    ctx.globalCompositeOperation = 'lighter';
    for (const p of inView) {
      const s = p.star;
      const q = pos.get(p.id)!;
      if (s.state === 'fog' || s.state === 'whisper') continue;
      const col = this.colorOf(s);
      if (s.state === 'revealed') {
        ctx.globalAlpha = 0.35;
        const g = q.sr * 3.2;
        ctx.drawImage(this.glow(col), q.x - g, q.y - g, g * 2, g * 2);
        ctx.globalAlpha = 1;
        continue;
      }
      let g = q.sr * (s.kind === 'variant' ? 3.4 : 4.4);
      if (s.state === 'morphReady') {
        const k = 0.5 + 0.5 * Math.sin(now / 280);
        g *= 1.15 + 0.45 * k;
        animated = true;
      }
      ctx.drawImage(this.glow(col), q.x - g, q.y - g, g * 2, g * 2);
      if (s.mastered || s.state === 'morphReady') {
        const h = q.sr * 6.5;
        ctx.globalAlpha = 0.5;
        ctx.drawImage(this.glow(GOLD), q.x - h, q.y - h, h * 2, h * 2);
        ctx.globalAlpha = 1;
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    // Bodies.
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of inView) {
      const s = p.star;
      const q = pos.get(p.id)!;
      const col = this.colorOf(s);
      const lit = s.state === 'known' || s.state === 'mastered' || s.state === 'morphReady';
      if (s.state === 'fog' || s.state === 'whisper') {
        const pink = s.state === 'whisper';
        ctx.fillStyle = pink ? 'rgba(255,159,224,0.08)' : 'rgba(154,166,198,0.08)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(7, q.sr + 3), 0, Math.PI * 2);
        ctx.fill();
        ctx.font = `bold ${Math.round(Math.max(11, q.sr * 1.5))}px ${this.font}`;
        ctx.fillStyle = pink ? 'rgba(255,159,224,0.5)' : 'rgba(170,182,214,0.5)';
        ctx.fillText('?', q.x, q.y + 0.5);
        continue;
      }
      if (s.state === 'revealed') {
        const r = Math.max(6, q.sr + 1.5);
        ctx.fillStyle = 'rgba(8,11,28,0.9)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.3;
        ctx.strokeStyle = rgba(col, 0.62);
        ctx.stroke();
        ctx.font = `bold ${Math.round(Math.max(9, r * 1.25))}px ${this.font}`;
        ctx.fillStyle = rgba(col, 0.85);
        ctx.fillText('?', q.x, q.y + 0.5);
        continue;
      }
      if (!lit) continue;
      if (s.kind === 'variant') {
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.sr, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      const img = iconA > 0 ? this.icon(s) : null;
      if (img) {
        // Round plate with the pixel icon (crisp: 32 CSS px, nearest neighbour).
        const R = 21;
        ctx.globalAlpha = iconA;
        ctx.fillStyle = 'rgba(10,14,32,0.94)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, R, 0, Math.PI * 2);
        ctx.fill();
        ctx.lineWidth = 1.5;
        ctx.strokeStyle = rgba(col, 0.75);
        ctx.stroke();
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(img, Math.round(q.x - 16), Math.round(q.y - 16), 32, 32);
        ctx.imageSmoothingEnabled = true;
        ctx.globalAlpha = 1;
      }
      if (iconA < 1) {
        ctx.globalAlpha = 1 - iconA;
        ctx.fillStyle = col;
        ctx.beginPath();
        ctx.arc(q.x, q.y, q.sr, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = 'rgba(255,255,255,0.88)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, Math.max(1, q.sr * 0.45), 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      // Mastery ring: rank of max rank as an arc (gold once mastered).
      const ringR = img && iconA > 0.5 ? 24.5 : q.sr + 4;
      if (s.maxRank > 0 && (q.sr >= 3.5 || img)) {
        ctx.lineWidth = img && iconA > 0.5 ? 2.5 : Math.max(1.2, 1.7 * Math.sqrt(z));
        ctx.strokeStyle = 'rgba(255,255,255,0.13)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, ringR, 0, Math.PI * 2);
        ctx.stroke();
        ctx.strokeStyle = s.mastered ? GOLD : 'rgba(240,244,255,0.85)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, ringR, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, s.rank / s.maxRank));
        ctx.stroke();
      }
      if (s.mastered) {
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(255,215,106,0.55)';
        ctx.beginPath();
        ctx.arc(q.x, q.y, ringR + 3.5, 0, Math.PI * 2);
        ctx.stroke();
      }
      if (s.state === 'morphReady') {
        // Transform ready ✨: a pulsing gold ring and a twinkling sparkle.
        const k = 0.5 + 0.5 * Math.sin(now / 280);
        ctx.lineWidth = 1.6;
        ctx.strokeStyle = rgba(GOLD, 0.35 + 0.6 * k);
        ctx.beginPath();
        ctx.arc(q.x, q.y, ringR + 4 + 3 * k, 0, Math.PI * 2);
        ctx.stroke();
        const off = ringR + 5;
        this.sparkle(q.x + off * 0.72, q.y - off * 0.72, 6 + 3 * k, GOLD, 0.7 + 0.3 * k);
        this.sparkle(q.x + off * 0.72 + 8, q.y - off * 0.72 + 6, 2.2 + k, '#ffffff', 0.5 + 0.4 * k);
      }
    }
    // Selection ring (pops in).
    if (this.selected) {
      const q = pos.get(this.selected);
      const s = this.byId.get(this.selected);
      if (q && s) {
        const pop = Math.min(1, (now - this.selectedAt) / 240);
        if (pop < 1) animated = true;
        const base = cam.z >= ICON_ZOOM && this.lit(s.id) ? 29 : q.sr + 10;
        const r = base * (1 + (1 - pop) * 0.7);
        ctx.globalAlpha = 0.4 + 0.6 * pop;
        ctx.lineWidth = 2;
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        ctx.arc(q.x, q.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.lineWidth = 2;
        for (let i = 0; i < 4; i++) {
          const a = Math.PI / 4 + (i * Math.PI) / 2;
          ctx.beginPath();
          ctx.moveTo(q.x + Math.cos(a) * (r + 3), q.y + Math.sin(a) * (r + 3));
          ctx.lineTo(q.x + Math.cos(a) * (r + 8), q.y + Math.sin(a) * (r + 8));
          ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
    }
    // Bursts (a fresh transform).
    for (const f of this.effects) {
      const q = pos.get(f.id);
      if (!q) continue;
      const t = (now - f.t0) / f.ms;
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < 2; i++) {
        const k = Math.max(0, Math.min(1, t * 1.4 - i * 0.25));
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.lineWidth = 3 * (1 - k) + 0.5;
        ctx.strokeStyle = GOLD;
        ctx.beginPath();
        ctx.arc(q.x, q.y, 14 + k * 90, 0, Math.PI * 2);
        ctx.stroke();
      }
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2 + 0.3;
        const d = 18 + t * 70;
        this.sparkle(q.x + Math.cos(a) * d, q.y + Math.sin(a) * d, 5 * (1 - t) + 1, i % 2 ? '#ffffff' : GOLD, 1 - t);
      }
      ctx.globalAlpha = 1;
      ctx.globalCompositeOperation = 'source-over';
    }
    // Names (zoomed in): selected first, then the brightest; never on top of each other.
    if (z >= NAME_ZOOM || this.selected) {
      const order = inView
        .filter((p) => p.star.kind !== 'variant' && p.star.state !== 'fog' && p.star.state !== 'whisper' && (z >= NAME_ZOOM || p.id === this.selected))
        .sort((a, b) => this.labelRank(b.star) - this.labelRank(a.star));
      const size = z >= ICON_ZOOM ? 13 : z >= 0.8 ? 12 : 11;
      ctx.font = `${size}px ${this.font}`;
      ctx.lineJoin = 'round';
      for (const p of order) {
        const q = pos.get(p.id)!;
        const s = p.star;
        const below = (cam.z >= ICON_ZOOM && this.lit(s.id) ? 27 : q.sr + 6) + size * 0.8 + (s.maxRank > 0 && this.lit(s.id) ? 3 : 0);
        const w = ctx.measureText(s.name).width;
        const r = [q.x - w / 2 - 2, q.y + below - size / 2 - 1, q.x + w / 2 + 2, q.y + below + size / 2 + 1];
        if (p.id !== this.selected && rects.some((o) => r[0] < o[2] && r[2] > o[0] && r[1] < o[3] && r[3] > o[1])) continue;
        rects.push(r);
        ctx.lineWidth = 3;
        ctx.strokeStyle = 'rgba(4,6,18,0.9)';
        ctx.strokeText(s.name, q.x, q.y + below);
        ctx.fillStyle = p.id === this.selected ? GOLD : this.lit(s.id) ? INK : MUTE;
        ctx.fillText(s.name, q.x, q.y + below);
      }
    }
    return animated;
  }

  private labelRank(s: StarView): number {
    if (s.id === this.selected) return 100;
    const base = s.state === 'morphReady' ? 40 : s.state === 'mastered' ? 30 : s.state === 'known' ? 20 : 0;
    return base + s.size * 2 + (s.kind === 'element' ? 3 : 0);
  }
}

let shared: SkyView | null = null;

/** The one sky of the run (created on first use). */
export function sharedSky(): SkyView {
  if (!shared) shared = new SkyView();
  return shared;
}
