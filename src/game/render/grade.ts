// OmniGrade (light lane; docs/QUALITY-PLAN.md §10): ONE custom PostFX pass on the world camera — a per-biome 16³
// colour LUT generated in code, a subtle vignette, low-HP desaturation, a soft flash channel for the camera rig and
// ordered-dither anti-banding. Never on the DOM HUD (it is not in the canvas), never per sprite, no Phaser Bloom.
//
// In-world readouts stay UNGRADED: an overlay camera with the same scroll draws everything at depth >= UNGRADED_MIN
// (DEPTH.TELL_TOP: telegraph rims and aim beads, floating combat text, screen FX) after the graded world camera, so
// danger colours are never regraded or desaturated (docs/VFX.md §8.3). The split is by depth and the band is the top
// of the depth stack, so draw order is exactly what it was with one camera. The overlay camera mirrors the world
// camera's fade (warps) and takes no input.
//
// Strength is tuned so the art keeps its palette: every look is mild (white balance, split tone, a little contrast /
// saturation) and mixed in at `strength` (0.55–0.75); tests/render-grade.test.ts bounds the shift of the art-direction
// palette anchors. Off on the Canvas renderer, on Low quality (setGradeEnabled(false)) and with `?grade=0`.
//
// This module never imports Phaser at runtime (types only): the stage passes the PostFXPipeline base class in, so the
// LUT maths is unit-tested in node.
import type Phaser from 'phaser';
import type { Biome } from '../../core/world/types';
import { LIGHT_DEPTH } from './depths';

// ------------------------------------------------------------------ settings (quality hook)

function urlFlag(name: string, dflt: boolean): boolean {
  try {
    if (typeof location === 'undefined') return dflt;
    const v = new URLSearchParams(location.search).get(name);
    if (v === null) return dflt;
    return !(v === '0' || v === 'off' || v === 'false');
  } catch {
    return dflt;
  }
}

/** OmniGrade on / off and a QA strength multiplier (1 = the tuned look). */
export const gradeSettings = { enabled: urlFlag('grade', true), strength: 1 };

const gradeListeners = new Set<(on: boolean) => void>();

/** Quality hook: turns the grade on or off (live: the stage attaches / detaches it). */
export function setGradeEnabled(on: boolean): void {
  if (gradeSettings.enabled === on) return;
  gradeSettings.enabled = on;
  for (const fn of [...gradeListeners]) {
    try {
      fn(on);
    } catch {
      /* a listener's failure never blocks the setting */
    }
  }
}

export function gradeEnabled(): boolean {
  return gradeSettings.enabled;
}

/** QA: scales every look's LUT mix (0 = identity, 1 = tuned, up to 2). */
export function setGradeStrength(k: number): void {
  gradeSettings.strength = Math.max(0, Math.min(2, Number.isFinite(k) ? k : 1));
}

/** Called when the setting changes; returns the unsubscribe. */
export function onGradeChange(fn: (on: boolean) => void): () => void {
  gradeListeners.add(fn);
  return () => gradeListeners.delete(fn);
}

// ------------------------------------------------------------------ looks (pure)

export type GradeLookId = 'meadow' | 'lake' | 'forest' | 'ember' | 'storm' | 'crypt' | 'dusk' | 'identity';

export interface GradeLook {
  /** LUT mix over the source (0..1) at gradeSettings.strength 1. */
  strength: number;
  /** White balance: + warm (red up, blue down), tint + magenta / - green. */
  temp: number;
  tint: number;
  /** Black lift and white gain (out = lift + in · (gain - lift)). */
  lift: number;
  gain: number;
  /** Contrast around mid grey (1 = none) and saturation (1 = none). */
  contrast: number;
  sat: number;
  /** Split toning: rgb offsets weighted by (1 - luma)² for shadows and luma² for highlights. */
  shadow: readonly [number, number, number];
  highlight: readonly [number, number, number];
  /** Pulls green-dominant colours toward olive (the reference's muted foliage). */
  olive: number;
  /** Vignette darkening at the corners (0..1). */
  vignette: number;
}

const NONE: readonly [number, number, number] = [0, 0, 0];

export const GRADE_LOOKS: Readonly<Record<GradeLookId, GradeLook>> = {
  identity: { strength: 0, temp: 0, tint: 0, lift: 0, gain: 1, contrast: 1, sat: 1, shadow: NONE, highlight: NONE, olive: 0, vignette: 0 },
  // Warm meadow: sunlit and soft — a warm white balance, gently lifted, slightly muted shadows with a cool touch
  // (fitted toward the reference look: our grass 114,124,72 -> 119,126,79 vs its 121,129,81; road 145,133,101 ->
  // 148,136,107 vs 149,133,110; the #24180f outline only lifts to 42,31,25).
  meadow: { strength: 0.7, temp: 0.15, tint: 0, lift: 0.03, gain: 1, contrast: 0.98, sat: 0.9, shadow: [0.006, 0.004, 0.02], highlight: [0.012, 0.01, 0], olive: 0.08, vignette: 0.13 },
  // Cool lake: blue-cool shadows, clean neutral highlights.
  lake: { strength: 0.65, temp: -0.25, tint: 0, lift: 0.012, gain: 1, contrast: 1.03, sat: 1, shadow: [-0.01, 0.004, 0.03], highlight: [0, 0.008, 0.01], olive: 0.08, vignette: 0.13 },
  // Misty forest: lifted teal-green shadows, softer contrast, damped saturation.
  forest: { strength: 0.7, temp: -0.06, tint: -0.12, lift: 0.03, gain: 0.99, contrast: 0.93, sat: 0.88, shadow: [-0.004, 0.018, 0.024], highlight: [0.008, 0.014, 0.004], olive: 0.12, vignette: 0.18 },
  // Ember: orange highlights, red-brown shadows, a little punch.
  ember: { strength: 0.65, temp: 0.5, tint: 0.04, lift: 0.008, gain: 1, contrast: 1.06, sat: 1.02, shadow: [0.026, -0.004, -0.018], highlight: [0.028, 0.01, -0.02], olive: 0, vignette: 0.16 },
  // Storm: cold blue-grey, desaturated, firmer contrast.
  storm: { strength: 0.65, temp: -0.3, tint: 0, lift: 0.01, gain: 1, contrast: 1.06, sat: 0.8, shadow: [-0.01, 0, 0.026], highlight: [0, 0.006, 0.016], olive: 0.05, vignette: 0.18 },
  // Crypt / cave: cold violet shadows, drained colour.
  crypt: { strength: 0.7, temp: -0.32, tint: 0.1, lift: 0.006, gain: 1, contrast: 1.04, sat: 0.84, shadow: [0.004, -0.006, 0.034], highlight: [0, 0, 0.01], olive: 0.05, vignette: 0.22 },
  // Dusk: purple shadows, orange-pink highlights (the last minute of sunset).
  dusk: { strength: 0.7, temp: 0.16, tint: 0.24, lift: 0.012, gain: 1, contrast: 1.03, sat: 0.98, shadow: [0.018, -0.01, 0.038], highlight: [0.036, 0.012, -0.016], olive: 0, vignette: 0.16 },
};

/** Biome -> look (docs: warm meadow, cool lake, misty forest, ember, storm, crypt, dusk). */
export const BIOME_LOOK: Readonly<Record<Biome, GradeLookId>> = {
  meadow: 'meadow',
  town: 'meadow',
  hill: 'meadow',
  quarry: 'meadow',
  lake: 'lake',
  frost: 'lake',
  grove: 'forest',
  glade: 'forest',
  ember: 'ember',
  basalt: 'ember',
  storm: 'storm',
  plateau: 'storm',
  crypt: 'crypt',
  cave: 'crypt',
  dusk: 'dusk',
};

export function lookFor(biome: Biome | string): GradeLookId {
  return BIOME_LOOK[biome as Biome] ?? 'meadow';
}

const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const luma = (r: number, g: number, b: number) => 0.299 * r + 0.587 * g + 0.114 * b;

/** The look applied to one colour (0..1 channels) at full LUT strength. Pure. */
export function gradeColor(look: GradeLook, r: number, g: number, b: number): [number, number, number] {
  // 1) white balance
  const wt = look.temp * 0.08;
  const wn = look.tint * 0.06;
  r *= 1 + wt;
  b *= 1 - wt;
  g *= 1 - wn;
  // 2) lift / gain
  const span = look.gain - look.lift;
  r = look.lift + r * span;
  g = look.lift + g * span;
  b = look.lift + b * span;
  // 3) contrast around mid grey
  r = 0.5 + (r - 0.5) * look.contrast;
  g = 0.5 + (g - 0.5) * look.contrast;
  b = 0.5 + (b - 0.5) * look.contrast;
  // 4) saturation (luma kept)
  let l = luma(r, g, b);
  r = l + (r - l) * look.sat;
  g = l + (g - l) * look.sat;
  b = l + (b - l) * look.sat;
  // 5) olive: green-dominant colours lean yellow, lose a little blue
  if (look.olive > 0) {
    const k = look.olive * Math.max(0, g - Math.max(r, b));
    r += k * 0.5;
    b -= k * 0.25;
  }
  // 6) split toning by luma
  l = clamp01(luma(r, g, b));
  const ws = (1 - l) * (1 - l);
  const wh = l * l;
  r += look.shadow[0] * ws + look.highlight[0] * wh;
  g += look.shadow[1] * ws + look.highlight[1] * wh;
  b += look.shadow[2] * ws + look.highlight[2] * wh;
  return [clamp01(r), clamp01(g), clamp01(b)];
}

/** LUT edge (entries per channel). */
export const LUT_SIZE = 16;
/** LUT texture: LUT_SIZE slices of LUT_SIZE×LUT_SIZE side by side (x = b·16 + r, y = g). */
export const LUT_W = LUT_SIZE * LUT_SIZE;
export const LUT_H = LUT_SIZE;

/** Bakes a look into a 16³ LUT strip (RGBA, LUT_W × LUT_H). Pure. */
export function bakeLut(look: GradeLook): Uint8ClampedArray {
  const n = LUT_SIZE;
  const out = new Uint8ClampedArray(LUT_W * LUT_H * 4);
  for (let gi = 0; gi < n; gi++) {
    for (let bi = 0; bi < n; bi++) {
      for (let ri = 0; ri < n; ri++) {
        const [r, g, b] = gradeColor(look, ri / (n - 1), gi / (n - 1), bi / (n - 1));
        const i = (gi * LUT_W + bi * n + ri) * 4;
        out[i] = Math.round(r * 255);
        out[i + 1] = Math.round(g * 255);
        out[i + 2] = Math.round(b * 255);
        out[i + 3] = 255;
      }
    }
  }
  return out;
}

/**
 * What the shader computes for one colour (CPU reference, 0..1 in and out): trilinear LUT lookup, mixed in at
 * `strength`. Used by the tests to bound the palette shift exactly as the GPU applies it.
 */
export function applyLut(lut: Uint8ClampedArray, strength: number, r: number, g: number, b: number): [number, number, number] {
  const n = LUT_SIZE;
  const at = (ri: number, gi: number, bi: number, c: number) => lut[(gi * LUT_W + bi * n + ri) * 4 + c] / 255;
  const fr = clamp01(r) * (n - 1);
  const fg = clamp01(g) * (n - 1);
  const fb = clamp01(b) * (n - 1);
  const r0 = Math.floor(fr);
  const g0 = Math.floor(fg);
  const b0 = Math.floor(fb);
  const r1 = Math.min(n - 1, r0 + 1);
  const g1 = Math.min(n - 1, g0 + 1);
  const b1 = Math.min(n - 1, b0 + 1);
  const tr = fr - r0;
  const tg = fg - g0;
  const tb = fb - b0;
  const out: [number, number, number] = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const lerp = (a: number, z: number, t: number) => a + (z - a) * t;
    const s0 = lerp(lerp(at(r0, g0, b0, c), at(r1, g0, b0, c), tr), lerp(at(r0, g1, b0, c), at(r1, g1, b0, c), tr), tg);
    const s1 = lerp(lerp(at(r0, g0, b1, c), at(r1, g0, b1, c), tr), lerp(at(r0, g1, b1, c), at(r1, g1, b1, c), tr), tg);
    const v = lerp(s0, s1, tb);
    const src = c === 0 ? r : c === 1 ? g : b;
    out[c] = src + (v - src) * strength;
  }
  return out;
}

/** Low-HP desaturation: none above LOW_HP of max HP, rising to DESAT_MAX at 0. */
export const LOW_HP = 0.35;
export const DESAT_MAX = 0.55;

export function lowHpDesat(hpShare: number | null): number {
  if (hpShare === null || !Number.isFinite(hpShare)) return 0;
  const s = clamp01(hpShare);
  return s >= LOW_HP ? 0 : ((LOW_HP - s) / LOW_HP) * DESAT_MAX;
}

/** The depth from which objects draw on the ungraded overlay camera (telegraph rims, combat text, screen FX). */
export const UNGRADED_MIN = LIGHT_DEPTH.UNGRADED_MIN;

// ------------------------------------------------------------------ the pipeline (Phaser, injected)

export const GRADE_PIPELINE = 'OmniGrade';

const FRAG = `
#define SHADER_NAME OMNIPATH_GRADE_FS
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
uniform sampler2D uMainSampler;
uniform sampler2D uLut;
uniform vec2 uResolution;
uniform float uStrength;
uniform float uVignette;
uniform float uDesat;
uniform vec4 uFlash;
uniform float uDither;
varying vec2 outTexCoord;

vec3 lut(vec3 c) {
  c = clamp(c, 0.0, 1.0);
  float b = c.b * 15.0;
  float b0 = floor(b);
  float b1 = min(b0 + 1.0, 15.0);
  vec2 uv = vec2((c.r * 15.0 + 0.5) / 256.0, (c.g * 15.0 + 0.5) / 16.0);
  vec3 s0 = texture2D(uLut, uv + vec2(b0 / 16.0, 0.0)).rgb;
  vec3 s1 = texture2D(uLut, uv + vec2(b1 / 16.0, 0.0)).rgb;
  return mix(s0, s1, b - b0);
}

// 4x4 ordered dither threshold in [0, 15/16] (small operands: safe in mediump).
float bayer4(vec2 p) {
  vec2 a = mod(floor(p), 4.0);
  vec2 h = floor(a * 0.5);
  vec2 l = a - 2.0 * h;
  float lo = fract(dot(l, vec2(0.5, l.y * 0.75)));
  float hi = fract(dot(h, vec2(0.5, h.y * 0.75)));
  return lo + hi * 0.25;
}

void main() {
  vec4 src = texture2D(uMainSampler, outTexCoord);
  vec3 c = src.rgb;
  c = mix(c, lut(c), uStrength);
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(c, vec3(l) * vec3(0.97, 0.99, 1.05), uDesat);
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (gl_FragCoord.xy / uResolution - 0.5) * vec2(aspect, 1.0);
  float d = length(p) / length(vec2(0.5 * aspect, 0.5));
  c *= 1.0 - uVignette * smoothstep(0.45, 1.0, d);
  // Soft flash: a screen blend toward the flash colour, fullest at the centre.
  float fa = uFlash.a * (1.0 - 0.45 * d);
  c = mix(c, 1.0 - (1.0 - c) * (1.0 - uFlash.rgb), fa);
  c += (bayer4(gl_FragCoord.xy) - 0.46875) * uDither / 255.0;
  gl_FragColor = vec4(clamp(c, 0.0, 1.0), src.a);
}
`;

export interface GradeUniforms {
  strength: number;
  vignette: number;
  desat: number;
  flash: [number, number, number, number];
  dither: number;
}

type PostFXBase = typeof Phaser.Renderer.WebGL.Pipelines.PostFXPipeline;
type GradePipeline = Phaser.Renderer.WebGL.Pipelines.PostFXPipeline & {
  lut: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null;
  uniforms: GradeUniforms;
};

let pipelineClass: { base: PostFXBase; cls: new (game: Phaser.Game) => GradePipeline } | null = null;

function gradePipelineClass(Base: PostFXBase): new (game: Phaser.Game) => GradePipeline {
  if (pipelineClass && pipelineClass.base === Base) return pipelineClass.cls;
  class OmniGradePipeline extends Base {
    lut: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null = null;
    uniforms: GradeUniforms = { strength: 0, vignette: 0, desat: 0, flash: [1, 1, 1, 0], dither: 1 };

    constructor(game: Phaser.Game) {
      super({ game, name: GRADE_PIPELINE, fragShader: FRAG });
    }

    onDraw(target: Phaser.Renderer.WebGL.RenderTarget): void {
      const u = this.uniforms;
      const lut = this.lut;
      this.set2f('uResolution', target.width, target.height);
      this.set1f('uStrength', lut ? u.strength : 0);
      this.set1f('uVignette', u.vignette);
      this.set1f('uDesat', u.desat);
      this.set4f('uFlash', u.flash[0], u.flash[1], u.flash[2], u.flash[3]);
      this.set1f('uDither', u.dither);
      this.set1i('uLut', 1);
      this.bindTexture(lut ?? this.renderer.whiteTexture, 1);
      this.bindAndDraw(target);
    }
  }
  pipelineClass = { base: Base, cls: OmniGradePipeline as unknown as new (game: Phaser.Game) => GradePipeline };
  return pipelineClass.cls;
}

/** Bakes (once per game) the LUT texture of a look; linear filtering (the LUT is sampled between entries). */
function lutTexture(scene: Phaser.Scene, id: GradeLookId): Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null {
  const key = `grade_lut_${id}`;
  const textures = scene.textures;
  if (!textures.exists(key)) {
    const tex = textures.createCanvas(key, LUT_W, LUT_H);
    if (!tex) return null;
    const g = tex.getContext();
    const img = g.createImageData(LUT_W, LUT_H);
    img.data.set(bakeLut(GRADE_LOOKS[id]));
    g.putImageData(img, 0, 0);
    tex.refresh();
    tex.setFilter(0 /* Phaser.Textures.FilterMode.LINEAR */);
  }
  const src = textures.get(key).source[0] as { glTexture?: Phaser.Renderer.WebGL.Wrappers.WebGLTextureWrapper | null };
  return src.glTexture ?? null;
}

/** Whether the grade can run on this scene's renderer (WebGL only). */
export function gradeSupported(scene: Phaser.Scene): boolean {
  const r = scene.sys.renderer as { gl?: unknown; pipelines?: unknown } | null;
  return !!r && !!r.gl && !!r.pipelines;
}

/** What the grade reads every frame from its host (the stage). */
export interface GradeHost {
  readonly biome: Biome | string;
  /** The player's HP share 0..1 (null: unknown — no desaturation). */
  hp(): number | null;
  /** The camera rig's flash this frame (the stage forwards the rig's overlay; null: none). */
  flash(): { color: number; alpha: number } | null;
}

export interface GradeStats {
  look: GradeLookId;
  strength: number;
  vignette: number;
  desat: number;
  flash: number;
  ungraded: number;
}

/**
 * OmniGrade on a map scene: the post pipeline on cameras.main and the ungraded overlay camera. Updates its uniforms
 * and the camera split at the game's PRE_RENDER (after every update: the scroll and the flash are final).
 */
export class Grade {
  readonly look: GradeLookId;
  private readonly cam: Phaser.Cameras.Scene2D.Camera;
  private ui: Phaser.Cameras.Scene2D.Camera | null;
  private pipe: GradePipeline | null;
  private desat = 0;
  private last = 0;
  private alive = true;
  readonly stats: GradeStats;
  private readonly onPreRender = () => this.frame();

  constructor(
    private readonly scene: Phaser.Scene,
    Base: PostFXBase,
    private readonly host: GradeHost,
  ) {
    this.look = lookFor(host.biome);
    const renderer = scene.sys.renderer as Phaser.Renderer.WebGL.WebGLRenderer;
    renderer.pipelines.addPostPipeline(GRADE_PIPELINE, gradePipelineClass(Base));
    const cam = scene.cameras.main;
    this.cam = cam;
    cam.setPostPipeline(GRADE_PIPELINE);
    const list = cam.postPipelines as GradePipeline[];
    this.pipe = list.find((p) => p.name === GRADE_PIPELINE) ?? null;
    if (this.pipe) this.pipe.lut = lutTexture(scene, this.look);
    const ui = scene.cameras.add(0, 0, cam.width, cam.height, false, 'ungraded');
    ui.setRoundPixels(true);
    ui.inputEnabled = false;
    this.ui = ui;
    const L = GRADE_LOOKS[this.look];
    this.stats = { look: this.look, strength: L.strength, vignette: L.vignette, desat: 0, flash: 0, ungraded: 0 };
    scene.game.events.on('prerender', this.onPreRender);
    this.frame();
  }

  /** The world camera's pipeline uniforms (debug / QA). */
  get uniforms(): GradeUniforms | null {
    return this.pipe?.uniforms ?? null;
  }

  destroy(): void {
    if (!this.alive) return;
    this.alive = false;
    this.scene.game.events.off('prerender', this.onPreRender);
    const ui = this.ui;
    const mainBit = this.cam.id;
    const uiBit = ui?.id ?? 0;
    // The camera manager may already have destroyed both cameras (scene shutdown): only touch live objects.
    const list = this.scene.children?.list ?? [];
    for (const go of list) go.cameraFilter &= ~(mainBit | uiBit);
    if (ui && this.scene.cameras?.cameras?.includes(ui)) this.scene.cameras.remove(ui, true);
    this.ui = null;
    // Camera.destroy never drops its post pipelines: remove ours explicitly (its render target is freed).
    if (this.pipe) this.cam.removePostPipeline(this.pipe);
    this.pipe = null;
  }

  private frame(): void {
    if (!this.alive || !this.pipe || !this.ui) return;
    const scene = this.scene;
    const sys = scene.sys;
    if (!sys.settings.visible || !(sys.isActive() || sys.isPaused())) return;
    const now = scene.game.loop.time;
    const dt = this.last ? Math.min(0.1, Math.max(0, (now - this.last) / 1000)) : 0;
    this.last = now;
    // Low-HP desaturation eases toward its target (no pop when a potion lands).
    const want = lowHpDesat(this.host.hp());
    this.desat += (want - this.desat) * (dt > 0 ? 1 - Math.exp(-dt / 0.35) : 1);
    if (Math.abs(this.desat - want) < 0.002) this.desat = want;
    const L = GRADE_LOOKS[this.look];
    const u = this.pipe.uniforms;
    u.strength = Math.min(1, L.strength * gradeSettings.strength);
    u.vignette = L.vignette + this.desat * 0.12;
    u.desat = this.desat;
    const f = this.host.flash();
    if (f && f.alpha > 0) {
      u.flash[0] = ((f.color >> 16) & 255) / 255;
      u.flash[1] = ((f.color >> 8) & 255) / 255;
      u.flash[2] = (f.color & 255) / 255;
      u.flash[3] = Math.min(0.35, f.alpha);
    } else u.flash[3] = 0;
    this.stats.strength = u.strength;
    this.stats.vignette = u.vignette;
    this.stats.desat = this.desat;
    this.stats.flash = u.flash[3];
    // The ungraded overlay camera: same view as the world camera, the world camera's fade mirrored as its alpha.
    const cam = this.cam;
    const ui = this.ui;
    if (ui.width !== cam.width || ui.height !== cam.height) ui.setSize(cam.width, cam.height);
    if (ui.scrollX !== cam.scrollX || ui.scrollY !== cam.scrollY) ui.setScroll(cam.scrollX, cam.scrollY);
    const fe = cam.fadeEffect as Phaser.Cameras.Scene2D.Effects.Fade & { alpha?: number };
    const fade = fe.isRunning || fe.isComplete ? (fe.alpha ?? 0) : 0;
    const a = 1 - Math.max(0, Math.min(1, fade));
    if (ui.alpha !== a) ui.setAlpha(a);
    // Split by depth: the top band (>= UNGRADED_MIN) draws on the overlay only, everything else on the world camera.
    const mainBit = cam.id;
    const uiBit = ui.id;
    let top = 0;
    for (const go of scene.children.list) {
      const f0 = go.cameraFilter;
      const up = (go as unknown as { depth: number }).depth >= UNGRADED_MIN;
      const want2 = up ? (f0 | mainBit) & ~uiBit : (f0 | uiBit) & ~mainBit;
      if (up) top++;
      if (f0 !== want2) go.cameraFilter = want2;
    }
    this.stats.ungraded = top;
  }
}
