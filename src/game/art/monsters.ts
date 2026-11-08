import type Phaser from 'phaser';

// Monster sprites, generated at boot like the rest of the art (zero binary assets).
//
// Conventions shared by every texture here:
// - Creatures face RIGHT; the game mirrors the sprite when it walks left.
// - Feet / base sit on the line at ~90% of the texture height (sprite origin is 0.5, 0.9).
//   Floaters hover above that line; the game draws the ground shadow separately.
// - Light comes from the upper left: base tone, darker lower-right, a small top-left highlight.
// - A finishing pass hardens the silhouette and adds a 1px selective dark outline so even
//   32px sprites read on grass, sand and dark ground. Glows and sparks are painted after it.
// - Tinted elites reuse their base species' texture (multiply tint), so the commons they
//   derive from (jellop, puddlewisp, gustling, cragling, gloomcap, emberkit, ...) keep
//   mid-to-light bodies for the tint to show.

type Ctx = CanvasRenderingContext2D;
type Fill = string | CanvasGradient;

const TAU = Math.PI * 2;
const INK = '#1b1b2a';

interface Finish {
  /** Keep partial transparency (revenants). Otherwise the silhouette is made fully opaque. */
  ghost?: boolean;
  /** 1px selective outline around the silhouette (default on). */
  outline?: boolean;
  /** Painted after hardening + outline: glows, sparks, ripples. */
  post?: (c: Ctx) => void;
}

interface Spec {
  w: number;
  h: number;
  /** Whole-pixel vertical nudge applied to draw + post, to seat feet on the anchor line. */
  dy?: number;
  draw: (c: Ctx) => void;
  fx?: Finish;
}

// ---------------------------------------------------------------- helpers

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function rgbOf(color: string): [number, number, number] {
  const n = parseInt(color.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function shade(color: string, amt: number): string {
  const [r, g, b] = rgbOf(color);
  const k = (v: number) => Math.max(0, Math.min(255, v + amt));
  return hex((k(r) << 16) | (k(g) << 8) | k(b));
}

function rgba(color: string, a: number): string {
  const [r, g, b] = rgbOf(color);
  return `rgba(${r},${g},${b},${a})`;
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: Fill, rot = 0) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, Math.max(0.1, rx), Math.max(0.1, ry), rot, 0, TAU);
  c.fill();
}

function circle(c: Ctx, x: number, y: number, r: number, fill: Fill) {
  ellipse(c, x, y, r, r, fill);
}

function rect(c: Ctx, x: number, y: number, w: number, h: number, fill: Fill) {
  c.fillStyle = fill;
  c.fillRect(x, y, w, h);
}

/** Filled polygon from a flat [x0, y0, x1, y1, ...] list. */
function poly(c: Ctx, pts: number[], fill: Fill) {
  c.fillStyle = fill;
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fill();
}

/** Round-capped polyline from a flat point list. */
function line(c: Ctx, pts: number[], color: Fill, w = 1) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.lineJoin = 'round';
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.stroke();
}

/** Quadratic-curve stroke: start, control, end. */
function curve(c: Ctx, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, color: Fill, w = 1) {
  c.strokeStyle = color;
  c.lineWidth = w;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(x0, y0);
  c.quadraticCurveTo(cx, cy, x1, y1);
  c.stroke();
}

function path(c: Ctx, fill: Fill, shape: (c: Ctx) => void) {
  c.fillStyle = fill;
  c.beginPath();
  shape(c);
  c.fill();
}

function clipTo(c: Ctx, shape: (c: Ctx) => void, inner: () => void) {
  c.save();
  c.beginPath();
  shape(c);
  c.clip();
  inner();
  c.restore();
}

function vgrad(c: Ctx, y0: number, y1: number, stops: [number, string][]): CanvasGradient {
  const g = c.createLinearGradient(0, y0, 0, y1);
  for (const [t, col] of stops) g.addColorStop(t, col);
  return g;
}

/** Three-tone shaded ellipse: dark rim lower-right, base, top-left highlight. */
function ball(c: Ctx, x: number, y: number, rx: number, ry: number, col: string, dark = -34, light = 26) {
  ellipse(c, x, y, rx, ry, shade(col, dark));
  c.save();
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, TAU);
  c.clip();
  ellipse(c, x - rx * 0.14, y - ry * 0.2, rx * 0.93, ry * 0.86, col);
  if (light) ellipse(c, x - rx * 0.4, y - ry * 0.46, rx * 0.34, ry * 0.24, shade(col, light));
  c.restore();
}

/** Cute oval eye with a highlight pixel (shine null = no highlight). */
function eye(c: Ctx, x: number, y: number, r: number, color = INK, shine: string | null = '#ffffff') {
  ellipse(c, x, y, r, r * 1.3, color);
  if (shine) {
    const s = r >= 2.4 ? 2 : 1;
    rect(c, Math.round(x - r * 0.55), Math.round(y - r * 0.85), s, s, shine);
  }
}

/** Soft radial glow. behind=true paints it underneath what is already drawn. */
function glow(c: Ctx, x: number, y: number, r: number, color: string, a = 0.55, behind = false) {
  const g = c.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(color, a));
  g.addColorStop(1, rgba(color, 0));
  c.save();
  c.globalCompositeOperation = behind ? 'destination-over' : 'lighter';
  c.fillStyle = g;
  c.fillRect(x - r, y - r, r * 2, r * 2);
  c.restore();
}

/** Tiny plus-shaped twinkle. */
function twinkle(c: Ctx, x: number, y: number, color: string, arm = 1) {
  rect(c, x, y - arm, 1, arm * 2 + 1, color);
  rect(c, x - arm, y, arm * 2 + 1, 1, color);
}

/** Zigzag lightning bolt with a bright core. */
function bolt(c: Ctx, pts: number[], color = '#ffe14a', w = 1.6, core = '#fffbe0') {
  line(c, pts, color, w);
  if (core && w >= 1.6) line(c, pts, core, Math.max(0.6, w - 1.2));
}

/** Faceted ice / crystal shard: tip, two base corners; lit on its left half. */
function shard(c: Ctx, tx: number, ty: number, lx: number, ly: number, rx: number, ry: number, base: string, lit: string, dark: string) {
  poly(c, [tx, ty, lx, ly, rx, ry], base);
  const mx = (lx + rx) / 2;
  const my = (ly + ry) / 2;
  poly(c, [tx, ty, lx, ly, mx, my], lit);
  line(c, [tx, ty, rx, ry], dark, 0.8);
}

const N4 = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
] as const;

function finish(c: Ctx, w: number, h: number, fx: Finish, dy = 0) {
  const img = c.getImageData(0, 0, w, h);
  const d = img.data;
  const ghost = !!fx.ghost;
  const cut = ghost ? 22 : 100;
  for (let i = 3; i < d.length; i += 4) {
    if (d[i] < cut) d[i] = 0;
    else if (!ghost) d[i] = 255;
  }
  if (fx.outline !== false) {
    const a = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) a[p] = d[p * 4 + 3];
    const need = ghost ? 70 : 128;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (a[p] !== 0) continue;
        let r = 0;
        let g = 0;
        let b = 0;
        let al = 0;
        let n = 0;
        for (const [dx, dy] of N4) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const q = ny * w + nx;
          if (a[q] < need) continue;
          r += d[q * 4];
          g += d[q * 4 + 1];
          b += d[q * 4 + 2];
          al += a[q];
          n++;
        }
        if (!n) continue;
        const o = p * 4;
        d[o] = (r / n) * 0.3 + 14;
        d[o + 1] = (g / n) * 0.26 + 9;
        d[o + 2] = (b / n) * 0.34 + 24;
        d[o + 3] = ghost ? (al / n) * 0.75 : 235;
      }
    }
  }
  c.putImageData(img, 0, 0);
  if (fx.post) {
    c.save();
    c.translate(0, dy);
    fx.post(c);
    c.restore();
  }
}

function make(scene: Phaser.Scene, key: string, spec: Spec) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, spec.w, spec.h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  ctx.save();
  ctx.translate(0, spec.dy ?? 0);
  spec.draw(ctx);
  ctx.restore();
  finish(ctx, spec.w, spec.h, spec.fx ?? {}, spec.dy ?? 0);
  tex.refresh();
}

// ---------------------------------------------------------------- vale commons

const jellop: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const G = '#5cc962';
    const body = (c: Ctx) => {
      c.moveTo(3, 26);
      c.bezierCurveTo(3, 14, 9, 10, 16, 10);
      c.bezierCurveTo(23, 10, 29, 14, 29, 26);
      c.quadraticCurveTo(29, 30, 25, 30);
      c.lineTo(7, 30);
      c.quadraticCurveTo(3, 30, 3, 26);
      c.closePath();
    };
    // soft-serve curl on top
    path(c, G, (c) => {
      c.moveTo(12, 12);
      c.quadraticCurveTo(13, 4, 20, 4);
      c.quadraticCurveTo(22, 4, 22, 6);
      c.quadraticCurveTo(17, 6, 19, 11);
      c.closePath();
    });
    path(c, G, body);
    clipTo(c, body, () => {
      ellipse(c, 18, 33, 17, 7, shade(G, -34));
      ellipse(c, 28, 21, 4, 11, shade(G, -16));
      ellipse(c, 16, 27.5, 9, 1.4, shade(G, 22)); // jelly rim light
      ellipse(c, 9.5, 15.5, 3.6, 2.6, '#c9ffc4', -0.5);
      rect(c, 14, 12, 2, 1, '#e6ffe0');
      ellipse(c, 23, 25, 2.2, 1.6, shade(G, -22)); // inner nucleus
    });
    eye(c, 14, 19.5, 2);
    eye(c, 21.5, 19.5, 2);
    rect(c, 16.5, 23, 3, 1, INK);
    rect(c, 16, 22, 1, 1, INK);
    rect(c, 19.5, 22, 1, 1, INK);
    rect(c, 9, 22, 3, 1.5, rgba('#ff7a9a', 0.55));
    rect(c, 24, 22, 3, 1.5, rgba('#ff7a9a', 0.55));
  },
};

const puddlewisp: Spec = {
  w: 32,
  h: 34,
  draw: (c) => {
    const B = '#4aa8f0';
    // crest curling over like a little wave
    path(c, B, (c) => {
      c.moveTo(12, 12);
      c.quadraticCurveTo(12, 3, 21, 2);
      c.quadraticCurveTo(25, 2, 25, 5);
      c.quadraticCurveTo(19, 4, 19, 11);
      c.closePath();
    });
    ellipse(c, 4.5, 20, 2.8, 1.8, shade(B, -14), -0.6);
    ellipse(c, 27.5, 20, 2.8, 1.8, shade(B, -14), 0.6);
    const body = (c: Ctx) => {
      c.moveTo(16, 7);
      c.bezierCurveTo(22, 11, 27, 15, 27, 20);
      c.bezierCurveTo(27, 25, 22, 28, 16, 28);
      c.bezierCurveTo(10, 28, 5, 25, 5, 20);
      c.bezierCurveTo(5, 15, 10, 11, 16, 7);
      c.closePath();
    };
    path(c, B, body);
    clipTo(c, body, () => {
      ellipse(c, 20, 31, 14, 7, shade(B, -34));
      ellipse(c, 16.5, 20.5, 7.5, 6.2, '#a8dcff');
      ellipse(c, 10, 14.5, 1.8, 3.4, '#eaf7ff', -0.5);
    });
    eye(c, 14, 19.5, 1.8, '#10305a');
    eye(c, 20, 19.5, 1.8, '#10305a');
    ellipse(c, 17, 23.5, 1.3, 1, '#10305a');
  },
  fx: {
    post: (c) => {
      c.strokeStyle = 'rgba(190,230,255,0.55)';
      c.lineWidth = 1;
      c.beginPath();
      c.ellipse(16, 31.5, 9, 2, 0, 0, TAU);
      c.stroke();
      rect(c, 26, 9, 1, 2, '#bfe6ff');
      rect(c, 5, 12, 1, 1, '#bfe6ff');
    },
  },
};

const mossling: Spec = {
  w: 38,
  h: 38,
  draw: (c) => {
    const S = '#8a6e4a';
    const M = '#4f8a3a';
    ellipse(c, 12, 33, 4, 2.6, shade(S, -42));
    ellipse(c, 25, 33.5, 4.5, 2.6, shade(S, -42));
    ball(c, 18, 24, 14, 10.5, S);
    // dark face hollow under the moss
    ellipse(c, 22, 28, 9, 4.8, shade(S, -40));
    // moss cap: drips, cap, highlights
    for (const [x, y, r] of [
      [6, 21, 3.2],
      [11, 23, 3.4],
      [17, 23.5, 3],
      [23, 23, 3.4],
      [29, 21.5, 3.2],
      [32, 18, 2.6],
    ] as const)
      ellipse(c, x, y, r, r * 0.9, shade(M, -20));
    ellipse(c, 18, 15.5, 15, 8.5, M);
    ellipse(c, 13, 12.5, 6.5, 3.6, '#66a84a');
    ellipse(c, 11, 11.5, 3, 1.7, '#8fcf62');
    for (const [x, y] of [
      [20, 18],
      [26, 14],
      [9, 17],
      [15, 20],
      [29, 18],
    ] as const)
      rect(c, x, y, 1, 1, shade(M, -26));
    // sprout
    line(c, [18, 8, 18.5, 3.5], '#3f7a2a', 1.4);
    ellipse(c, 15, 3.5, 3.4, 1.6, '#6cc04a', 0.35);
    ellipse(c, 22.5, 3, 3.6, 1.7, '#86d45a', -0.4);
    // little flower
    rect(c, 26, 11, 3, 3, '#ff9fc0');
    rect(c, 27, 12, 1, 1, '#ffe46a');
    // glowing eyes peeking out
    ellipse(c, 19, 28, 1.8, 2, '#f5f0c0');
    ellipse(c, 25.5, 28, 1.8, 2, '#f5f0c0');
  },
  fx: {
    post: (c) => {
      glow(c, 19, 28, 4, '#f5f0c0', 0.3);
      glow(c, 25.5, 28, 4, '#f5f0c0', 0.3);
    },
  },
};

const gustling: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const W = '#f6faff';
    const S = '#c4d8e8';
    // tail feathers + wings
    ellipse(c, 5.5, 21, 4, 1.8, S, 0.5);
    ellipse(c, 5, 13, 5.5, 3, S, -0.7);
    ellipse(c, 27, 13, 5.5, 3, S, 0.7);
    ellipse(c, 6, 13.5, 4.5, 2.2, W, -0.7);
    ellipse(c, 26, 13.5, 4.5, 2.2, W, 0.7);
    ellipse(c, 2.8, 10.4, 1.8, 1.2, '#9be8c8', -0.7);
    ellipse(c, 29.2, 10.4, 1.8, 1.2, '#9be8c8', 0.7);
    // crest tufts (wind-teal middle curl)
    ellipse(c, 13, 6.5, 2, 3, W, -0.5);
    ellipse(c, 16.5, 5.5, 2, 3.4, '#9be8c8', 0.1);
    ellipse(c, 16.2, 6.2, 1.2, 2.2, '#d8fff0', 0.1);
    ellipse(c, 20, 7, 1.8, 2.6, W, 0.6);
    // body
    ellipse(c, 16, 16, 10, 9.5, S);
    clipTo(
      c,
      (c) => c.ellipse(16, 16, 10, 9.5, 0, 0, TAU),
      () => {
        ellipse(c, 14.8, 14.4, 9.4, 8.4, W);
        ellipse(c, 12, 11, 3.5, 2.2, '#ffffff');
      },
    );
    eye(c, 16, 15, 1.6);
    eye(c, 21.5, 15, 1.6);
    poly(c, [17.5, 18, 21.5, 18, 19.5, 20.5], '#f0a030');
    rect(c, 13, 18, 2, 1, rgba('#ff8aa8', 0.6));
    rect(c, 23, 18, 2, 1, rgba('#ff8aa8', 0.6));
    rect(c, 14, 25, 1, 2, '#f0a030');
    rect(c, 18, 25, 1, 2, '#f0a030');
  },
  fx: {
    post: (c) => {
      c.strokeStyle = '#9be8c8';
      c.lineWidth = 1.5;
      c.beginPath();
      c.arc(16, 17, 13, 0.15, 1.25);
      c.stroke();
      c.beginPath();
      c.arc(9, 28, 3, -2.2, 0.6);
      c.stroke();
      rect(c, 29, 12, 1, 3, '#9be8c8');
    },
  },
};

const sparkbug: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const Y = '#ffd23a';
    const K = '#2b2b40';
    line(c, [13, 9, 11, 5, 8, 3], K, 1.2);
    line(c, [19, 9, 21, 5, 24, 3], K, 1.2);
    // stubby legs
    line(c, [8, 20, 5, 23, 5.5, 26], K, 1.6);
    line(c, [24, 20, 27, 23, 26.5, 26], K, 1.6);
    line(c, [11, 24, 10, 28.5], K, 1.8);
    line(c, [21, 24, 22, 28.5], K, 1.8);
    // shell (a wing edge peeks out underneath)
    ellipse(c, 16, 17.5, 11.5, 6, rgba('#e8f4ff', 0.9));
    ball(c, 16, 15, 11, 8.5, Y, -40, 30);
    // bolt-shaped split down the shell
    poly(c, [16.5, 6.5, 13.5, 12, 16.5, 13, 14, 19, 16, 22, 18.5, 16, 15.8, 15, 18.5, 9], K);
    circle(c, 10, 13.5, 1.8, K);
    circle(c, 22.5, 13, 1.8, K);
    circle(c, 10.5, 18.5, 1.2, K);
    circle(c, 21.8, 18, 1.2, K);
    // small navy head with cute eyes
    ball(c, 16, 22.5, 5.6, 4.2, '#3a4678', -18, 24);
    ellipse(c, 14, 22.6, 1.5, 1.8, '#ffffff');
    ellipse(c, 18.4, 22.6, 1.5, 1.8, '#ffffff');
    rect(c, 14.2, 22.4, 1, 1.5, K);
    rect(c, 18.6, 22.4, 1, 1.5, K);
    rect(c, 15.5, 25.2, 2, 1, '#ffe14a');
    circle(c, 8, 3, 1.8, '#ffe14a');
    circle(c, 24, 3, 1.8, '#ffe14a');
  },
  fx: {
    post: (c) => {
      glow(c, 8, 3, 4, '#ffe14a', 0.6);
      glow(c, 24, 3, 4, '#ffe14a', 0.6);
      rect(c, 8, 3, 1, 1, '#ffffff');
      rect(c, 24, 3, 1, 1, '#ffffff');
      bolt(c, [27, 8, 29, 10, 28, 11, 30, 13], '#ffe14a', 1);
      bolt(c, [3, 9, 2, 11, 3, 12, 2, 14], '#ffe14a', 1);
    },
  },
};

const emberkit: Spec = {
  w: 40,
  h: 36,
  draw: (c) => {
    const O = '#ff7a2a';
    const D = shade(O, -60);
    const C = '#ffe2b4';
    const P = '#5a2a1a';
    // flame tail
    path(c, '#ff8a2a', (c) => {
      c.moveTo(14, 25);
      c.bezierCurveTo(4, 25, 1, 15, 5, 6);
      c.quadraticCurveTo(7, 11, 10, 12);
      c.quadraticCurveTo(9, 5, 13, 1);
      c.quadraticCurveTo(13, 9, 17, 13);
      c.quadraticCurveTo(19, 20, 14, 25);
      c.closePath();
    });
    path(c, '#ffc040', (c) => {
      c.moveTo(13, 23);
      c.bezierCurveTo(7, 22, 5, 16, 7, 11);
      c.quadraticCurveTo(9, 14, 12, 14);
      c.quadraticCurveTo(12, 9, 13, 6);
      c.quadraticCurveTo(14, 12, 16, 15);
      c.quadraticCurveTo(17, 20, 13, 23);
      c.closePath();
    });
    ellipse(c, 12, 19, 2.2, 3.4, '#fff0b0', 0.2);
    // far legs
    rect(c, 11, 27, 3, 6, D);
    rect(c, 24, 28, 3, 5, D);
    // body
    ball(c, 19, 24, 10, 6.5, O, -40, 22);
    // near legs + paws
    rect(c, 14, 27, 3.5, 6, O);
    rect(c, 27, 27, 3.5, 6, O);
    rect(c, 13.5, 31, 4.5, 2, P);
    rect(c, 26.5, 31, 4.5, 2, P);
    ellipse(c, 25, 24.5, 3.5, 3.5, C);
    // ears
    poly(c, [22.5, 12, 23.5, 2.5, 28.5, 10], shade(O, -18));
    poly(c, [29, 10, 34, 1.5, 35.5, 12], O);
    poly(c, [30.5, 10, 33.5, 4.5, 34.3, 11], '#ffd060');
    // head
    ball(c, 29, 16, 7.5, 6.5, O, -40, 22);
    ellipse(c, 34, 19.2, 4.2, 3, C);
    rect(c, 37, 17.5, 2, 1.5, INK);
    eye(c, 28.5, 15, 1.6);
    eye(c, 33.5, 15, 1.6);
    rect(c, 33.5, 21, 2, 1, INK);
    rect(c, 23.5, 18, 2, 1, rgba('#ffe060', 0.8));
  },
  fx: {
    post: (c) => {
      glow(c, 11, 12, 7, '#ffb040', 0.35);
      rect(c, 3, 3, 1, 1, '#ffd060');
      rect(c, 16, 3, 1, 1, '#ff8a2a');
      rect(c, 8, 0, 1, 1, '#ffe090');
    },
  },
};

const gloomcap: Spec = {
  w: 36,
  h: 40,
  dy: -2,
  draw: (c) => {
    const P = '#6b3a9a';
    const St = '#e8dcc8';
    ellipse(c, 13, 36, 3.6, 2, shade(St, -60));
    ellipse(c, 23, 36.5, 3.6, 2, shade(St, -60));
    ball(c, 18, 29.5, 8, 7.5, St, -40, 14);
    // cap
    const cap = (c: Ctx) => {
      c.moveTo(2, 20);
      c.bezierCurveTo(2, 7, 10, 3, 18, 3);
      c.bezierCurveTo(26, 3, 34, 7, 34, 20);
      c.quadraticCurveTo(18, 26, 2, 20);
      c.closePath();
    };
    path(c, P, cap);
    clipTo(c, cap, () => {
      ellipse(c, 21, 25, 18, 7, '#3e2160');
      ellipse(c, 30, 14, 5, 9, shade(P, -16));
      ellipse(c, 11, 8, 6, 3, '#8a55c0', -0.3);
    });
    for (const [x, y, r] of [
      [9, 13, 2.6],
      [19, 8, 3],
      [27, 14, 2.2],
      [14, 5.5, 1.4],
      [30, 9, 1.3],
    ] as const)
      circle(c, x, y, r, '#dcc6ff');
    // sleepy, slightly sinister eyes
    eye(c, 16.5, 30, 1.7, '#3a1e4a', null);
    eye(c, 21.5, 30, 1.7, '#3a1e4a', null);
    rect(c, 14.5, 27.5, 9, 1.6, St);
    rect(c, 15, 30, 1, 1, '#ffffff');
    rect(c, 20, 30, 1, 1, '#ffffff');
    rect(c, 18, 33, 2, 1, '#3a1e4a');
  },
  fx: {
    post: (c) => {
      glow(c, 19, 8, 6, '#c8a0ff', 0.35);
      glow(c, 9, 13, 5, '#c8a0ff', 0.3);
      for (const [x, y] of [
        [3, 5],
        [33, 4],
        [32, 26],
        [4, 27],
      ] as const)
        rect(c, x, y, 1, 1, '#d8c0ff');
    },
  },
};

const pipsprout: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const B = '#d4a464';
    const L = '#6cc04a';
    line(c, [12, 26, 10, 30], '#7a5230', 1.6);
    line(c, [16, 27, 16, 30.5], '#7a5230', 1.6);
    line(c, [20, 26, 22, 30], '#7a5230', 1.6);
    const bulb = (c: Ctx) => {
      c.moveTo(16, 9);
      c.bezierCurveTo(19, 12, 25, 14, 25, 20.5);
      c.bezierCurveTo(25, 26, 21, 28.5, 16, 28.5);
      c.bezierCurveTo(11, 28.5, 7, 26, 7, 20.5);
      c.bezierCurveTo(7, 14, 13, 12, 16, 9);
      c.closePath();
    };
    path(c, B, bulb);
    clipTo(c, bulb, () => {
      ellipse(c, 20, 30, 12, 7, shade(B, -38));
      ellipse(c, 26, 19, 3, 9, shade(B, -18));
      ellipse(c, 11, 15.5, 2.4, 3.6, '#f2cf96', -0.4);
      curve(c, 12, 13, 9, 20, 11, 27, shade(B, -20), 1);
    });
    // leaves
    line(c, [16, 10, 16, 6], '#3f8a2a', 1.5);
    ellipse(c, 11.2, 5.8, 5, 2.4, L, -0.45);
    ellipse(c, 21, 4.6, 5.6, 2.6, '#86d45a', 0.45);
    line(c, [15, 7, 8, 4.5], '#3f8a2a', 0.8);
    line(c, [17, 6.5, 25, 3], '#4f9a32', 0.8);
    eye(c, 14, 19.5, 1.6);
    eye(c, 19.5, 19.5, 1.6);
    rect(c, 16, 23, 2, 1, INK);
    rect(c, 10.5, 21.5, 2, 1, rgba('#ff7a7a', 0.6));
    rect(c, 21.5, 21.5, 2, 1, rgba('#ff7a7a', 0.6));
  },
};

const cragling: Spec = {
  w: 40,
  h: 44,
  draw: (c) => {
    const S = '#a69479';
    const L = shade(S, 26);
    const D = shade(S, -36);
    const DD = shade(S, -58);
    // legs
    poly(c, [12, 32, 19, 32, 19, 41, 11, 41], DD);
    poly(c, [22, 32, 29, 32, 30, 41, 22, 41], D);
    rect(c, 22, 32, 7, 2, DD);
    // back arm (left)
    poly(c, [10, 19, 4, 23, 3, 32, 8, 35, 12, 28], DD);
    poly(c, [4, 23, 7, 22, 7, 30, 3, 31], D);
    // torso
    poly(c, [8, 33, 6, 23, 10, 15, 20, 12, 30, 14, 34, 23, 32, 33, 20, 36], S);
    poly(c, [10, 15, 20, 12, 23, 18, 13, 22, 7, 23], L);
    poly(c, [34, 23, 32, 33, 20, 36, 22, 29, 30, 26], D);
    line(c, [13, 26, 16, 29, 15, 32], DD, 1);
    // head
    poly(c, [14, 14, 15, 7, 22, 4, 29, 7, 29, 14, 22, 17], S);
    poly(c, [15, 7, 22, 4, 24, 8, 17, 11], L);
    poly(c, [29, 7, 29, 14, 22, 17, 25, 12], D);
    rect(c, 18, 8.5, 10, 4, DD);
    rect(c, 19, 9.5, 3, 2, '#ffcf5a');
    rect(c, 24.5, 9.5, 3, 2, '#ffcf5a');
    // front arm
    poly(c, [28, 17, 35, 18, 38, 29, 34, 34, 29, 30], S);
    poly(c, [28, 17, 35, 18, 34, 23, 29, 22], L);
    poly(c, [38, 29, 34, 34, 31, 31, 36, 27], D);
    // core crystal
    poly(c, [20, 20.5, 23.5, 25, 20, 29.5, 16.5, 25], '#f0b43c');
    poly(c, [20, 20.5, 20, 29.5, 16.5, 25], '#ffd870');
    rect(c, 19, 23, 1, 2, '#fff4c0');
    // moss tufts
    ellipse(c, 13.5, 14.5, 3.4, 1.6, '#5f9a3e');
    ellipse(c, 25, 5.4, 3, 1.4, '#6aaa44');
    ellipse(c, 33, 18, 2.4, 1.2, '#5f9a3e');
  },
  fx: {
    post: (c) => {
      glow(c, 20, 25, 7, '#ffb43c', 0.4);
      glow(c, 23, 10.5, 6, '#ffcf5a', 0.3);
    },
  },
};

function mite(c: Ctx, x: number, y: number, s: number) {
  const K = '#4a4470';
  const legs = '#2a2438';
  for (const dx of [-2, 0.5, 3]) {
    line(c, [x + dx * s, y + 1 * s, x + (dx - 1.5) * s, y + 4.5 * s], legs, 1);
  }
  ellipse(c, x - 3 * s, y, 4.2 * s, 3.4 * s, '#2fbf96');
  ellipse(c, x - 3.4 * s, y - 0.5 * s, 3.4 * s, 2.6 * s, '#5af0c8');
  ellipse(c, x - 4 * s, y - 1.2 * s, 1.6 * s, 1 * s, '#d4fff2');
  line(c, [x - 3 * s, y - 3 * s, x - 3 * s, y + 3 * s], rgba('#1f8a6c', 0.8), 0.8);
  ball(c, x + 2.5 * s, y - 0.4 * s, 3.2 * s, 2.8 * s, K, -16, 28);
  line(c, [x + 4 * s, y - 2.5 * s, x + 6 * s, y - 5.5 * s], legs, 0.9);
  line(c, [x + 3 * s, y - 2.8 * s, x + 3.5 * s, y - 6 * s], legs, 0.9);
  rect(c, Math.round(x + 4 * s), Math.round(y - 1 * s), 1, 1, '#e8fff8');
}

const glowmite: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    mite(c, 9, 14, 0.85);
    mite(c, 24, 9, 0.7);
    mite(c, 18, 23, 1.15);
  },
  fx: {
    post: (c) => {
      glow(c, 14.5, 23, 8, '#5af0c8', 0.45);
      glow(c, 6.5, 14, 6, '#5af0c8', 0.4);
      glow(c, 22, 9, 5, '#5af0c8', 0.35);
      rect(c, 28, 18, 1, 1, '#aaffe6');
      rect(c, 3, 25, 1, 1, '#aaffe6');
      rect(c, 15, 4, 1, 1, '#aaffe6');
    },
  },
};

const hollowshade: Spec = {
  w: 40,
  h: 44,
  draw: (c) => {
    const shroud = (c: Ctx) => {
      c.moveTo(20, 4);
      c.bezierCurveTo(28, 4, 31, 11, 31, 19);
      c.bezierCurveTo(31, 25, 34, 29, 33, 34);
      c.lineTo(29, 30);
      c.lineTo(26, 37);
      c.lineTo(22, 31);
      c.lineTo(17, 38);
      c.lineTo(14, 31);
      c.lineTo(8, 35);
      c.lineTo(9, 28);
      c.bezierCurveTo(7, 22, 9, 10, 20, 4);
      c.closePath();
    };
    path(
      c,
      vgrad(c, 4, 38, [
        [0, 'rgba(160,140,210,0.95)'],
        [0.5, 'rgba(118,98,178,0.82)'],
        [1, 'rgba(92,72,156,0.3)'],
      ]),
      shroud,
    );
    clipTo(c, shroud, () => {
      ellipse(c, 13, 13, 4, 7, 'rgba(210,200,240,0.35)', 0.3);
      ellipse(c, 30, 24, 4, 12, 'rgba(50,30,90,0.35)');
    });
    // hood opening + void face
    ellipse(c, 22.5, 15.5, 7.5, 7, 'rgba(70,50,120,0.95)');
    ellipse(c, 23, 16, 6.2, 5.8, '#140c22');
    ellipse(c, 20.5, 15.5, 1.5, 2.2, '#efe6ff');
    ellipse(c, 26, 15.5, 1.5, 2.2, '#efe6ff');
    // reaching wisp arm
    path(c, 'rgba(150,130,205,0.9)', (c) => {
      c.moveTo(27, 21);
      c.quadraticCurveTo(33, 20, 37, 25);
      c.lineTo(34, 25);
      c.lineTo(35, 29);
      c.lineTo(32, 26.5);
      c.quadraticCurveTo(29, 25.5, 26, 26);
      c.closePath();
    });
  },
  fx: {
    ghost: true,
    post: (c) => {
      glow(c, 20.5, 15.5, 4, '#c8a8ff', 0.5);
      glow(c, 26, 15.5, 4, '#c8a8ff', 0.5);
      rect(c, 5, 22, 1, 1, 'rgba(200,180,255,0.7)');
      rect(c, 34, 12, 1, 1, 'rgba(200,180,255,0.7)');
      rect(c, 12, 40, 1, 1, 'rgba(200,180,255,0.5)');
    },
  },
};

function cairnStone(c: Ctx, x: number, y: number, rx: number, ry: number) {
  ellipse(c, x, y + 0.6, rx, ry, '#6e6a60');
  ellipse(c, x - 0.3, y - 0.3, rx * 0.9, ry * 0.75, '#a9a395');
  ellipse(c, x - rx * 0.35, y - ry * 0.35, rx * 0.35, ry * 0.25, '#cdc8ba');
  rect(c, Math.round(x), Math.round(y), 1, 1, '#b08cff');
}

const cairnWraith: Spec = {
  w: 40,
  h: 46,
  draw: (c) => {
    const body = (c: Ctx) => {
      c.moveTo(21, 3);
      c.bezierCurveTo(29, 3, 32, 10, 32, 17);
      c.bezierCurveTo(33, 24, 33, 30, 31, 36);
      c.lineTo(27, 32);
      c.lineTo(24, 40);
      c.lineTo(20, 33);
      c.lineTo(16, 39);
      c.lineTo(14, 32);
      c.lineTo(10, 35);
      c.bezierCurveTo(9, 26, 9, 18, 10, 14);
      c.bezierCurveTo(11, 7, 15, 3, 21, 3);
      c.closePath();
    };
    path(
      c,
      vgrad(c, 3, 40, [
        [0, 'rgba(78,72,100,1)'],
        [0.45, 'rgba(66,60,92,0.9)'],
        [1, 'rgba(70,60,110,0.28)'],
      ]),
      body,
    );
    clipTo(c, body, () => {
      ellipse(c, 13, 16, 3, 9, 'rgba(140,130,170,0.35)', 0.2);
      // tattered ghost-light seams
      line(c, [15, 22, 14, 31], 'rgba(176,140,255,0.35)', 1);
      line(c, [26, 21, 27, 30], 'rgba(176,140,255,0.35)', 1);
    });
    // stone mask
    poly(c, [15, 8, 28, 8, 29, 17, 22, 24, 14, 17], '#c9c3b4');
    poly(c, [15, 8, 22, 8, 22, 24, 14, 17], '#ddd8ca');
    poly(c, [28, 8, 29, 17, 22, 24, 23, 15], '#a39d8e');
    rect(c, 16.5, 12, 4, 2.5, '#1a1028');
    rect(c, 23, 12, 4, 2.5, '#1a1028');
    rect(c, 18, 12.5, 1.5, 1.5, '#d8c0ff');
    rect(c, 24.5, 12.5, 1.5, 1.5, '#d8c0ff');
    line(c, [19.5, 17, 21.7, 20.5, 23.9, 17], '#5a5468', 1);
    rect(c, 21.2, 21.5, 1, 1.5, '#5a5468');
    // bony hand reaching forward
    line(c, [29, 24, 33, 26], '#4a4460', 2.4);
    line(c, [33, 26, 36.5, 25], '#d9d3c4', 1);
    line(c, [33, 26, 36.5, 27.5], '#d9d3c4', 1);
    line(c, [33, 26, 35.5, 29.5], '#d9d3c4', 1);
    // orbiting cairn stones
    cairnStone(c, 5.5, 26, 3.6, 2.4);
    cairnStone(c, 36, 15, 3, 2);
    cairnStone(c, 33.5, 37, 3.2, 2.1);
  },
  fx: {
    ghost: true,
    post: (c) => {
      glow(c, 18.5, 13, 4, '#b08cff', 0.6);
      glow(c, 25, 13, 4, '#b08cff', 0.6);
      glow(c, 5.5, 26, 4, '#b08cff', 0.25);
    },
  },
};

const ashfly: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    // ash-flake wings
    ellipse(c, 11.5, 8.5, 6, 3, '#857870', -0.8);
    ellipse(c, 16.5, 7, 6.8, 3.2, '#c8bab0', -0.4);
    line(c, [14, 11, 19, 4], '#9a8c84', 0.8);
    // glowing abdomen
    ellipse(c, 9, 17, 5.8, 3.8, '#e85a1a', 0.35);
    ellipse(c, 8.6, 16.6, 4, 2.5, '#ff9a30', 0.35);
    ellipse(c, 8, 16.2, 2.2, 1.4, '#ffe080', 0.35);
    line(c, [7, 13.5, 5, 19], rgba('#7a2a10', 0.8), 0.8);
    line(c, [10.5, 14.5, 9, 20.5], rgba('#7a2a10', 0.8), 0.8);
    // legs
    line(c, [15, 18, 13.5, 22], '#2a1e1e', 1);
    line(c, [17, 18.5, 17.5, 22.5], '#2a1e1e', 1);
    line(c, [19, 17.5, 21, 21], '#2a1e1e', 1);
    // thorax + head
    ball(c, 15.5, 15.5, 4.2, 3.6, '#4a3838', -14, 26);
    ball(c, 21, 14, 3.5, 3.2, '#5a4040', -16, 28);
    line(c, [22, 11.5, 25, 7.5, 27.5, 6.5], '#2a1e1e', 0.9);
    ellipse(c, 22.6, 13.6, 1.5, 1.6, '#ffb040');
    rect(c, 22, 13, 1, 1, '#fff0b0');
  },
  fx: {
    post: (c) => {
      glow(c, 8.5, 16.5, 9, '#ff8a2a', 0.5);
      rect(c, 3, 23, 1, 1, '#ffb040');
      rect(c, 6, 26, 1, 1, '#ff7a2a');
      rect(c, 2, 12, 1, 1, '#ffd060');
    },
  },
};

const voltcalf: Spec = {
  w: 42,
  h: 40,
  draw: (c) => {
    const N = '#3c548e';
    const D = shade(N, -26);
    const H = '#141c34';
    const Y = '#ffe14a';
    const Cl = '#d6e0f4';
    // tail with bolt tuft
    line(c, [9, 22, 5, 24, 4, 28], D, 2);
    poly(c, [2, 27, 6, 26, 4.5, 29, 7, 29, 3, 34, 4, 30.5, 1.5, 30.5], Y);
    // far legs
    rect(c, 10.5, 27, 4, 9, D);
    rect(c, 24.5, 27, 4, 9, D);
    rect(c, 10.5, 34, 4, 2, H);
    rect(c, 24.5, 34, 4, 2, H);
    // body
    ball(c, 19, 24.5, 12, 7.5, N, -30, 24);
    // near legs
    rect(c, 14.5, 28, 4.5, 9, N);
    rect(c, 28.5, 28, 4.5, 9, N);
    rect(c, 14.5, 34, 4.5, 3, H);
    rect(c, 28.5, 34, 4.5, 3, H);
    rect(c, 14.5, 33, 4.5, 1, Y);
    rect(c, 28.5, 33, 4.5, 1, Y);
    // cloud puffs along the back
    for (const [x, y, r] of [
      [11, 19, 3],
      [15, 17.3, 3.6],
      [20, 17.5, 3.4],
      [24, 18.8, 2.6],
    ] as const) {
      circle(c, x, y + 0.8, r, '#9aaacc');
      circle(c, x - 0.3, y, r * 0.9, Cl);
    }
    // ear
    ellipse(c, 24.5, 15, 3.3, 1.6, D, -0.4);
    // head
    ball(c, 31, 18, 8.5, 8, N, -30, 24);
    ellipse(c, 35.8, 22.6, 5, 3.6, '#6a84c4');
    rect(c, 37, 22, 1, 1, H);
    rect(c, 39, 22, 1, 1, H);
    // nub horns + cloud tuft
    poly(c, [27, 11.5, 25.5, 6, 28, 7.5, 28, 4, 30.5, 10.5], Y);
    poly(c, [33, 10.5, 34, 5, 35.5, 7, 37.5, 4, 36.5, 11.5], Y);
    circle(c, 31.5, 10.5, 2.6, '#9aaacc');
    circle(c, 31, 9.8, 2.3, Cl);
    circle(c, 29, 11.3, 1.6, Cl);
    eye(c, 30, 17.5, 1.8);
    eye(c, 35.5, 17.5, 1.6);
  },
  fx: {
    post: (c) => {
      bolt(c, [17, 12, 19, 10, 18, 9, 21, 6], '#ffe14a', 1);
      glow(c, 4, 30, 5, '#ffe14a', 0.35);
    },
  },
};

const moonmoth: Spec = {
  w: 36,
  h: 34,
  draw: (c) => {
    const W = '#fff6d8';
    const G = '#f0d890';
    const E = '#d8b860';
    // lower wings
    ellipse(c, 11.5, 20.5, 5.6, 4.2, E, 0.55);
    ellipse(c, 24.5, 20.5, 5.6, 4.2, E, -0.55);
    ellipse(c, 11.8, 20, 4.4, 3.2, G, 0.55);
    ellipse(c, 24.2, 20, 4.4, 3.2, G, -0.55);
    // upper wings
    ellipse(c, 9, 11, 8.5, 6.5, E, -0.35);
    ellipse(c, 27, 11, 8.5, 6.5, E, 0.35);
    ellipse(c, 9.6, 10.8, 7.2, 5.3, W, -0.35);
    ellipse(c, 26.4, 10.8, 7.2, 5.3, W, 0.35);
    // crescent moons on the wings
    circle(c, 8.5, 11, 2.8, '#9fb2f0');
    circle(c, 9.6, 10.2, 2.4, W);
    circle(c, 27.5, 11, 2.8, '#9fb2f0');
    circle(c, 26.4, 10.2, 2.4, W);
    // body
    ellipse(c, 18, 18.5, 3.2, 6.5, '#efe0b8');
    rect(c, 15.5, 19, 5, 1, '#d8c490');
    rect(c, 16, 21.5, 4, 1, '#d8c490');
    ellipse(c, 18, 12, 4.6, 3, '#ffffff');
    ball(c, 18, 8.7, 3.3, 3, '#fffbe8', -20, 0);
    eye(c, 16.6, 8.8, 1.2, '#2a2050');
    eye(c, 19.6, 8.8, 1.2, '#2a2050');
    // feathery antennae
    line(c, [17, 6, 15, 3, 12, 1.5], E, 1);
    line(c, [19, 6, 21, 3, 24, 1.5], E, 1);
    rect(c, 13, 3, 1, 1, E);
    rect(c, 22, 3, 1, 1, E);
  },
  fx: {
    post: (c) => {
      glow(c, 18, 13, 17, '#fff3b0', 0.4, true);
      twinkle(c, 3, 21, '#fffbe0');
      twinkle(c, 33, 4, '#fffbe0');
      rect(c, 30, 24, 1, 1, '#fff3b0');
      rect(c, 6, 3, 1, 1, '#fff3b0');
    },
  },
};

// ---------------------------------------------------------------- rift + highland commons

const riftling: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const S = '#6a4ab0';
    const D = shade(S, -40);
    const R = '#7ff6ff';
    // tail with crystal tip
    curve(c, 11, 25, 4, 26, 4, 19, D, 1.6);
    poly(c, [4, 13, 6.5, 17, 4, 21, 1.5, 17], R);
    poly(c, [4, 13, 4, 21, 1.5, 17], '#c8fbff');
    // bat wing
    poly(c, [12, 15, 4, 8, 6, 12.5, 2.5, 13.5, 6.5, 16, 4, 18, 11, 20], D);
    // feet
    rect(c, 12.5, 27, 3.5, 3, D);
    rect(c, 18, 27, 3.5, 3, D);
    // body
    ball(c, 16.5, 23, 6, 5.5, S, -34, 20);
    line(c, [15.5, 19.5, 17.5, 22, 15.5, 24, 17.5, 26.5], '#ff7ae8', 1.3);
    // head + ears + horns
    poly(c, [11, 12, 4.5, 9, 10.5, 16], S);
    poly(c, [25, 11.5, 31, 8.5, 26.5, 16], S);
    ball(c, 18, 14, 8.5, 7.5, S, -34, 22);
    poly(c, [13.5, 8, 12.5, 2.5, 17, 7], '#efe3ff');
    poly(c, [20.5, 7, 23.5, 1.5, 23.5, 8.5], '#efe3ff');
    // big glowing eyes
    ellipse(c, 16, 14, 2.3, 2.7, R);
    ellipse(c, 21.8, 14, 2.3, 2.7, R);
    rect(c, 16.5, 13, 1, 2.5, '#1b1030');
    rect(c, 22.3, 13, 1, 2.5, '#1b1030');
    // grin + fang
    line(c, [15.5, 18.5, 19, 19.6, 22.5, 18.2], '#1b1030', 1);
    rect(c, 20, 19.4, 1, 1.4, '#ffffff');
  },
  fx: {
    post: (c) => {
      glow(c, 16.5, 23, 5, '#ff7ae8', 0.4);
      glow(c, 4, 17, 5, '#7ff6ff', 0.4);
      glow(c, 19, 14, 7, '#7ff6ff', 0.25);
    },
  },
};

const riftStalker: Spec = {
  w: 40,
  h: 48,
  dy: -2,
  draw: (c) => {
    const S = '#4c3a78';
    const D = shade(S, -22);
    const L = shade(S, 34);
    const Cl = '#e8d8ff';
    const R = '#7ff6ff';
    // far leg (digitigrade: hip, knee forward, ankle back, toes)
    line(c, [16, 28, 19.5, 35, 13.5, 40.5, 16.5, 44], D, 2.4);
    line(c, [14.5, 44, 19, 44], D, 1.6);
    // far arm, long enough to scrape the ground
    line(c, [21, 16, 26.5, 24, 28.5, 33], D, 2.2);
    line(c, [28.5, 33, 30, 37], Cl, 1);
    line(c, [28.5, 33, 27.5, 37], Cl, 1);
    // hunched torso
    const torso = (c: Ctx) => {
      c.moveTo(14, 30);
      c.bezierCurveTo(9, 23, 12, 13, 21, 12);
      c.lineTo(27, 15);
      c.bezierCurveTo(27, 21, 23, 26, 21, 30);
      c.closePath();
    };
    path(c, S, torso);
    clipTo(c, torso, () => {
      ellipse(c, 14, 19, 3, 7, L, 0.5);
      ellipse(c, 24, 26, 5, 6, D);
    });
    // spine spikes
    poly(c, [11.5, 23, 7, 20, 11.5, 19], L);
    poly(c, [12.5, 17, 9, 12, 15, 14], L);
    poly(c, [16.5, 13, 15, 7.5, 20, 12], L);
    // near leg
    line(c, [19, 28, 24.5, 35, 19, 41, 22.5, 44], S, 2.8);
    line(c, [20.5, 44, 26, 44], S, 1.8);
    rect(c, 24, 34.5, 1, 1, L);
    // head thrust forward
    poly(c, [27, 10.5, 19, 3.5, 23.5, 4.5, 31, 9.5], '#cbbce8');
    ellipse(c, 30, 13, 6.4, 4.2, S, 0.2);
    ellipse(c, 28.5, 11.4, 3.4, 1.4, L, 0.2);
    poly(c, [32, 15, 37.5, 16, 33.5, 18.5], D);
    rect(c, 34, 15.6, 1, 1.4, '#ffffff');
    line(c, [31, 12.4, 35, 13.6], '#ff5ad8', 1.6);
    // near arm with claws
    line(c, [23.5, 17, 31, 23, 34.5, 32], S, 2.6);
    line(c, [34.5, 32, 37.5, 35.5], Cl, 1.1);
    line(c, [34.5, 32, 35.5, 37], Cl, 1.1);
    line(c, [34.5, 32, 33, 36.5], Cl, 1.1);
    // rift cracks
    line(c, [17, 14, 15, 18.5, 18, 21.5, 16, 26], R, 1);
    line(c, [26.5, 20, 29.5, 22.5], R, 0.9);
  },
  fx: {
    post: (c) => {
      glow(c, 33, 13, 5, '#ff5ad8', 0.6);
      glow(c, 16.5, 20, 6, '#7ff6ff', 0.3);
    },
  },
};

const frostling: Spec = {
  w: 32,
  h: 32,
  draw: (c) => {
    const I = '#dff6ff';
    const B = '#8fcdee';
    shard(c, 9, 4.5, 9.5, 13, 14, 11, '#aee9ff', '#e6faff', '#5aaee0');
    shard(c, 16.5, 1, 14, 11, 19, 11, '#bdefff', '#f2fdff', '#5aaee0');
    shard(c, 24, 5, 18.5, 11, 22.5, 13, '#aee9ff', '#e6faff', '#5aaee0');
    poly(c, [8, 18, 3.5, 21.5, 9, 21], B);
    poly(c, [24, 18, 28.5, 21.5, 23, 21], B);
    poly(c, [12.5, 23, 19.5, 23, 16, 28.5], B);
    ball(c, 16, 18, 8, 7.4, I, -50, 0);
    ellipse(c, 12.5, 14.5, 2.6, 1.6, '#ffffff', -0.4);
    eye(c, 14, 18.5, 1.6, '#1a3a6a');
    eye(c, 19.5, 18.5, 1.6, '#1a3a6a');
    rect(c, 16.5, 22, 1, 1, '#1a3a6a');
    rect(c, 10.5, 20.5, 2, 1, rgba('#7ab8ff', 0.7));
    rect(c, 21.5, 20.5, 2, 1, rgba('#7ab8ff', 0.7));
  },
  fx: {
    post: (c) => {
      glow(c, 16, 16, 15, '#aee9ff', 0.35, true);
      twinkle(c, 4, 8, '#ffffff');
      twinkle(c, 28, 15, '#ffffff');
      rect(c, 6, 26, 1, 1, '#e6faff');
      rect(c, 26, 26, 1, 1, '#e6faff');
    },
  },
};

const rimefang: Spec = {
  w: 44,
  h: 40,
  draw: (c) => {
    const F = '#e2eef8';
    const D = '#9fbcd6';
    const DD = '#7290b0';
    const I = '#8fd8ff';
    // bushy tail
    path(c, D, (c) => {
      c.moveTo(11, 21);
      c.quadraticCurveTo(2, 20, 2, 30);
      c.quadraticCurveTo(5, 27, 8, 28);
      c.quadraticCurveTo(7, 25, 13, 25);
      c.closePath();
    });
    poly(c, [2, 30, 1, 34, 4, 29], I);
    // far legs
    line(c, [12, 26, 11, 36], DD, 3);
    line(c, [27, 26, 28, 36], DD, 3);
    // back spines
    shard(c, 9, 10, 9, 19, 14, 18, I, '#e6faff', '#4aa8e0');
    shard(c, 15, 7, 13, 18, 19, 17, I, '#e6faff', '#4aa8e0');
    shard(c, 21.5, 7.5, 18.5, 17, 24, 17.5, I, '#e6faff', '#4aa8e0');
    // body
    ball(c, 20, 24, 13, 7.5, F, -44, 0);
    // chest ruff
    poly(c, [26, 18, 33, 21, 31, 28, 29, 26, 27.5, 29, 26, 26], F);
    // near legs
    line(c, [16, 27, 15, 36.5], F, 3.2);
    line(c, [29.5, 26, 31, 36.5], F, 3.2);
    rect(c, 13.5, 35.5, 4, 1.6, DD);
    rect(c, 29.5, 35.5, 4, 1.6, DD);
    // head
    poly(c, [27, 14, 31, 10, 37, 11, 43, 16, 42, 19.5, 35, 21, 29, 21.5], F);
    poly(c, [35, 18.5, 42, 19.5, 35, 21, 30, 21], D);
    poly(c, [30, 11, 30.5, 3.5, 34.5, 10.5], F);
    poly(c, [31, 10, 31.3, 6, 33.4, 10], '#b8d0e8');
    rect(c, 42, 15, 2, 2, '#2a3448');
    // fangs
    poly(c, [37.5, 19.5, 38.5, 24, 39.5, 19.5], '#ffffff');
    poly(c, [34.5, 20, 35.3, 23.4, 36.3, 20], '#f0faff');
    ellipse(c, 35.5, 14.5, 1.7, 1.2, '#2ab0ff');
    rect(c, 35, 14, 1, 1, '#ffffff');
  },
  fx: {
    post: (c) => {
      glow(c, 35.5, 14.5, 4, '#5ad0ff', 0.5);
      twinkle(c, 16, 3, '#ffffff');
    },
  },
};

const basaltCrawler: Spec = {
  w: 44,
  h: 36,
  draw: (c) => {
    const R = '#3c3538';
    const L = '#5e5458';
    const LL = '#7a6e70';
    const M = '#ff6a1a';
    const MY = '#ffc040';
    // legs
    for (const s of [-1, 1]) {
      const X = (x: number) => 22 + s * x;
      line(c, [X(8), 22, X(14), 21, X(18), 29], R, 2);
      line(c, [X(8), 24, X(12), 26, X(14), 32], R, 2);
      line(c, [X(6), 26, X(8), 29, X(9), 33], R, 2);
    }
    // claws
    line(c, [12, 20, 8, 15], R, 3);
    line(c, [32, 20, 36, 15], R, 3);
    for (const [x, s] of [
      [6, -1],
      [38, 1],
    ] as const) {
      ellipse(c, x, 11, 5, 4.2, L, s * 0.5);
      ellipse(c, x - s * 1, 10, 3, 2, LL, s * 0.5);
      // carve the pincer gap
      c.save();
      c.globalCompositeOperation = 'destination-out';
      poly(c, [x, 11.5, x + s * 6, 5, x + s * 6.5, 9.5], '#000');
      c.restore();
      line(c, [x - s * 1, 12, x + s * 2, 9], M, 0.8);
    }
    // shell
    ball(c, 22, 21, 12.5, 8, L, -26, 18);
    poly(c, [12, 18, 18, 14, 22, 18, 17, 23], LL);
    poly(c, [22, 18, 27, 14, 32, 18, 27, 22], L);
    poly(c, [17, 23, 22, 18, 27, 22, 25, 27, 19, 27], R);
    line(c, [12, 18, 17, 23, 22, 18, 27, 22, 32, 18], M, 1.1);
    line(c, [17, 23, 19, 27], M, 1);
    line(c, [27, 22, 25, 27], M, 1);
    line(c, [22, 18, 22, 14], M, 0.9);
    // eyestalks
    line(c, [19, 14, 18, 8], R, 1.6);
    line(c, [25, 14, 26, 8], R, 1.6);
    circle(c, 18, 7.5, 1.9, MY);
    circle(c, 26, 7.5, 1.9, MY);
    rect(c, 18, 7, 1, 1.5, '#2a1a10');
    rect(c, 26, 7, 1, 1.5, '#2a1a10');
    // mouth glow
    rect(c, 20, 27.5, 4, 1, M);
  },
  fx: {
    post: (c) => {
      glow(c, 22, 21, 10, '#ff6a1a', 0.3);
      glow(c, 18, 7.5, 3.5, '#ffc040', 0.5);
      glow(c, 26, 7.5, 3.5, '#ffc040', 0.5);
    },
  },
};

const cinderToad: Spec = {
  w: 32,
  h: 32,
  dy: -1,
  draw: (c) => {
    const K = '#5a3a34';
    const KL = '#7a5046';
    const B = '#ffa040';
    const M = '#ff5a1a';
    ellipse(c, 8.5, 29, 5, 1.8, shade(K, -24));
    ball(c, 9, 23, 6, 5.5, K, -24, 20);
    const body = (c: Ctx) => c.ellipse(17, 21, 11.5, 8, 0, 0, TAU);
    ellipse(c, 17, 21, 11.5, 8, shade(K, -24));
    clipTo(c, body, () => {
      ellipse(c, 15.5, 19.5, 10.8, 6.8, K);
      ellipse(c, 21, 28, 10, 5, B);
      ellipse(c, 22, 27, 6, 2.4, '#ffc870');
    });
    for (const [x, y, r] of [
      [10, 17, 1.7],
      [14, 14.5, 1.3],
      [7.5, 21, 1.2],
      [12.5, 19.5, 1],
      [17, 17, 0.9],
    ] as const)
      circle(c, x, y, r, M);
    // bulging eyes on top
    ball(c, 18, 12.5, 3.6, 3.3, KL, -20, 0);
    ball(c, 24.5, 13.5, 3.3, 3, KL, -20, 0);
    ellipse(c, 18.6, 12.3, 2.1, 2, '#ffd040');
    ellipse(c, 25, 13.3, 1.9, 1.8, '#ffd040');
    rect(c, 18.5, 11.3, 1, 2.2, '#2a1a10');
    rect(c, 25, 12.4, 1, 2, '#2a1a10');
    // glowing mouth seam
    line(c, [18.5, 20.5, 23, 21.3, 28, 19.5], '#ff7a2a', 1);
    // front leg
    line(c, [23, 24, 24.5, 29], K, 2.6);
    ellipse(c, 25, 29.5, 3, 1.4, shade(K, -20));
  },
  fx: {
    post: (c) => {
      glow(c, 11, 18, 7, '#ff5a1a', 0.35);
      glow(c, 23, 21, 4, '#ff7a2a', 0.3);
      rect(c, 6, 9, 1, 1, '#ffb040');
      rect(c, 3, 13, 1, 1, '#ff7a2a');
    },
  },
};

const cloudray: Spec = {
  w: 44,
  h: 40,
  draw: (c) => {
    const S = '#6a88c8';
    const D = '#46619c';
    const L = '#a6bfee';
    const W = '#eaf1fd';
    const Y = '#ffe14a';
    // whip tail rising behind, ending in a bolt
    curve(c, 22, 12, 27, 7, 24, 3, D, 1.4);
    poly(c, [24, 4, 21.5, 1.5, 23.5, 2.2, 23.2, 0.5, 26.5, 3.5], Y);
    // manta wings gliding toward the viewer, tips drooping
    const wings = (c: Ctx) => {
      c.moveTo(22, 8.5);
      c.bezierCurveTo(30, 8, 38, 11, 43, 21);
      c.quadraticCurveTo(38.5, 19.5, 34, 21);
      c.quadraticCurveTo(30, 22.5, 27.5, 26);
      c.lineTo(16.5, 26);
      c.quadraticCurveTo(14, 22.5, 10, 21);
      c.quadraticCurveTo(5.5, 19.5, 1, 21);
      c.bezierCurveTo(6, 11, 14, 8, 22, 8.5);
      c.closePath();
    };
    path(c, S, wings);
    clipTo(c, wings, () => {
      ellipse(c, 22, 31, 25, 10, D);
      ellipse(c, 12, 13, 8, 2.6, L, -0.25);
      ellipse(c, 32, 13, 8, 2.6, shade(L, -12), 0.25);
      line(c, [16, 15, 11, 17.5, 8, 16.5, 3, 19.5], Y, 1);
      line(c, [28, 15, 33, 17.5, 36, 16.5, 41, 19.5], Y, 1);
    });
    // storm clouds riding on its back
    for (const [x, y, r] of [
      [17.5, 10.5, 2.6],
      [22, 9, 3.2],
      [26.5, 10.5, 2.6],
    ] as const) {
      circle(c, x, y + 0.8, r, '#9aaacc');
      circle(c, x - 0.3, y, r * 0.88, W);
    }
    // head with cephalic lobes curling forward
    ellipse(c, 22, 21.5, 6.5, 4.6, L);
    ellipse(c, 22, 23.5, 5, 2.4, shade(L, -16));
    ellipse(c, 15.8, 25, 1.6, 3.4, D, 0.35);
    ellipse(c, 28.2, 25, 1.6, 3.4, D, -0.35);
    ellipse(c, 19, 20.5, 1.6, 1.8, '#fff3a0');
    ellipse(c, 25, 20.5, 1.6, 1.8, '#fff3a0');
    rect(c, 19, 20.5, 1, 1, INK);
    rect(c, 25, 20.5, 1, 1, INK);
    rect(c, 20.5, 24, 3, 1, D);
  },
  fx: {
    post: (c) => {
      glow(c, 24, 1.5, 4, '#ffe14a', 0.5);
      bolt(c, [2, 24, 4, 26, 3, 27, 5, 29], '#ffe14a', 1);
      bolt(c, [42, 24, 40, 26, 41, 27, 39, 29], '#ffe14a', 1);
    },
  },
};

function drakeWing(c: Ctx, sx: number, sy: number, s: number, bone: string, skin: string, edge: string) {
  // shoulder at (sx, sy); wing sweeps up and back (left)
  const P = (x: number, y: number) => [sx + x * s, sy + y * s];
  const tip = P(-11, -17);
  const f1 = P(-15, -8);
  const f2 = P(-13, -1);
  const f3 = P(-6, 2);
  poly(c, [sx, sy, ...tip, ...f1, ...P(-11, -5), ...f2, ...P(-7.5, -1), ...f3], skin);
  line(c, [sx, sy, ...P(-4, -11), ...tip], bone, 1.6 * s);
  line(c, [...P(-4, -11), ...f1], bone, 0.9 * s);
  line(c, [...P(-4, -11), ...f2], bone, 0.9 * s);
  line(c, [...P(-1, -12), ...P(-11.5, -17.5)], edge, 0.8 * s);
}

const thunderwing: Spec = {
  w: 44,
  h: 40,
  draw: (c) => {
    const B = '#4466cc';
    const D = '#2c4390';
    const Y = '#ffe14a';
    const Bel = '#f2e6b0';
    // far wing
    drakeWing(c, 23, 19, 0.9, D, '#5470b8', Y);
    // tail
    path(c, B, (c) => {
      c.moveTo(16, 24);
      c.quadraticCurveTo(8, 30, 3, 26);
      c.quadraticCurveTo(7, 33, 17, 30);
      c.closePath();
    });
    poly(c, [3, 26, 1, 22, 3, 23.5, 3.5, 20, 6, 27], Y);
    // legs
    ellipse(c, 17.5, 30, 4.4, 4, D);
    line(c, [17, 32, 16, 36], D, 2.4);
    line(c, [25, 31, 26, 36], B, 2.4);
    rect(c, 13.5, 35.5, 5, 1.5, D);
    rect(c, 24.5, 35.5, 5, 1.5, D);
    // body
    ball(c, 21.5, 26, 8, 7, B, -30, 26);
    ellipse(c, 25, 28, 3.6, 5, Bel, -0.3);
    // neck + head
    ellipse(c, 28, 19.5, 4, 5.5, B, 0.5);
    ellipse(c, 29.5, 21.5, 2, 3.5, Bel, 0.5);
    poly(c, [29, 10, 23, 6, 28, 8.5, 26, 4, 31, 9], Y);
    ball(c, 33, 13, 5.6, 4.6, B, -30, 26);
    ellipse(c, 38.5, 14.8, 4.2, 2.8, B);
    ellipse(c, 38, 16.6, 3.6, 1.2, D);
    rect(c, 41, 13.5, 1, 1, D);
    ellipse(c, 34, 12, 1.6, 1.4, Y);
    rect(c, 34, 11.5, 1, 1.4, INK);
    // spine fins
    poly(c, [25, 15, 23, 13, 26, 13.5], Y);
    poly(c, [20, 19.5, 17, 18, 20.5, 17.5], Y);
    poly(c, [16, 22.5, 13, 22, 16, 20.5], Y);
    // near wing
    drakeWing(c, 22, 20, 1.05, D, '#8fb4f4', Y);
    // little arm
    line(c, [27, 24, 30, 26.5], D, 1.6);
  },
  fx: {
    post: (c) => {
      glow(c, 34, 12, 3, '#ffe14a', 0.6);
      bolt(c, [41, 20, 39, 23, 41, 23.5, 39, 27], '#ffe14a', 1);
    },
  },
};

const duskhound: Spec = {
  w: 44,
  h: 40,
  draw: (c) => {
    const F = '#4f3d84';
    const D = '#2f2458';
    const L = '#6a54a8';
    const O = '#ff9a6a';
    // plume tail: violet base to sunset tip
    path(
      c,
      vgrad(c, 6, 22, [
        [0, '#ffb07a'],
        [0.45, '#d38cff'],
        [1, F],
      ]),
      (c) => {
        c.moveTo(11, 21);
        c.bezierCurveTo(4, 20, 1, 14, 3, 6);
        c.quadraticCurveTo(6, 12, 10, 13);
        c.quadraticCurveTo(13, 16, 13, 21);
        c.closePath();
      },
    );
    // far legs
    line(c, [12, 25, 11, 36], D, 2.8);
    line(c, [28, 25, 29, 36], D, 2.8);
    // body
    const body = (c: Ctx) => c.ellipse(20, 23, 12, 6.5, 0, 0, TAU);
    path(c, F, body);
    clipTo(c, body, () => {
      ellipse(c, 21, 30, 12, 4.5, '#c86a8a');
      ellipse(c, 21, 31, 10, 3, O);
      ellipse(c, 15, 18.5, 6, 2, L);
    });
    // near legs
    line(c, [16, 26, 15, 36.5], F, 3);
    line(c, [30, 25, 31.5, 36.5], F, 3);
    rect(c, 13, 35.5, 4, 1.6, D);
    rect(c, 30, 35.5, 4, 1.6, D);
    // starry mane
    path(c, D, (c) => {
      c.moveTo(24, 17);
      c.quadraticCurveTo(28, 10, 33, 11);
      c.lineTo(32, 22);
      c.quadraticCurveTo(27, 24, 24, 21);
      c.closePath();
    });
    // crescent ears swept back
    path(c, L, (c) => {
      c.moveTo(31, 11);
      c.quadraticCurveTo(26, 4, 22, 5);
      c.quadraticCurveTo(27, 6, 29, 13);
      c.closePath();
    });
    // head
    ball(c, 34, 15.5, 6.2, 5.4, F, -26, 22);
    poly(c, [36, 13, 43.5, 16, 42.5, 18.5, 36, 19.5], F);
    poly(c, [36, 18, 42.5, 18.5, 36, 20], D);
    rect(c, 42.5, 15.3, 1.5, 1.5, INK);
    line(c, [33.5, 14, 36.5, 14.6], '#ffc8ff', 1.6);
    for (const [x, y] of [
      [26, 14],
      [29, 18],
      [27, 20],
      [31, 13],
      [14, 21],
      [20, 20],
    ] as const)
      rect(c, x, y, 1, 1, '#fff3d0');
  },
  fx: {
    post: (c) => {
      glow(c, 35.5, 14.5, 4, '#e8a0ff', 0.6);
      twinkle(c, 3, 6, '#fff3d0');
    },
  },
};

const gloamthorn: Spec = {
  w: 40,
  h: 44,
  dy: -1,
  draw: (c) => {
    const V = '#4a3a5a';
    const T = '#f0d0f4';
    const P = '#6a2a8a';
    // roots + base leaves
    ellipse(c, 20, 39, 9, 3, '#3a2a3a');
    line(c, [14, 39, 10, 41], '#3a2a3a', 1.6);
    line(c, [26, 39, 30, 41], '#3a2a3a', 1.6);
    ellipse(c, 11.5, 35.5, 6.5, 2.6, '#4a6a5e', -0.35);
    ellipse(c, 28.5, 35.5, 6.5, 2.6, '#5a7a6a', 0.35);
    // whip vines
    c.strokeStyle = V;
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.moveTo(18, 32);
    c.bezierCurveTo(10, 30, 3, 26, 5, 20);
    c.quadraticCurveTo(7, 16, 9, 19);
    c.stroke();
    c.beginPath();
    c.moveTo(22, 28);
    c.bezierCurveTo(30, 27, 37, 23, 35, 16);
    c.quadraticCurveTo(33, 13, 31, 16);
    c.stroke();
    for (const [x, y, dx, dy] of [
      [8, 28, -2, 2],
      [4, 22, -2.5, 0],
      [29, 26, 1, 2.5],
      [35, 21, 2.5, 0.5],
    ] as const)
      poly(c, [x - 1, y, x + dx, y + dy, x + 1, y - 1], T);
    // main stalk
    c.strokeStyle = V;
    c.lineWidth = 4;
    c.beginPath();
    c.moveTo(20, 39);
    c.bezierCurveTo(17, 32, 24, 28, 21, 20);
    c.stroke();
    poly(c, [18, 33, 14.5, 32, 18, 31], T);
    poly(c, [22.5, 27, 26, 25.5, 22, 25], T);
    // bud: back petals, front petals with sunset edges
    ellipse(c, 21.5, 13, 10, 9, '#3e1a56');
    path(c, P, (c) => {
      c.moveTo(21, 22);
      c.bezierCurveTo(11, 21, 9, 10, 15, 4);
      c.quadraticCurveTo(17, 10, 21, 12);
      c.closePath();
    });
    path(c, '#7a3aa0', (c) => {
      c.moveTo(22, 22);
      c.bezierCurveTo(33, 21, 34, 10, 28, 3);
      c.quadraticCurveTo(26, 10, 22, 12);
      c.closePath();
    });
    line(c, [15, 4.5, 12, 12, 15, 19], '#ff9a8a', 1);
    line(c, [28, 3.5, 31.5, 11, 28, 19], '#ffb08a', 1);
    // glowing slit eye
    ellipse(c, 21.6, 13.5, 2, 5, '#ffd8ff');
    ellipse(c, 21.6, 13.5, 0.7, 3.4, '#3a0a4a');
  },
  fx: {
    post: (c) => {
      glow(c, 21.6, 13.5, 7, '#e8a0ff', 0.5);
    },
  },
};

// ---------------------------------------------------------------- elites (large)

const glacierMatron: Spec = {
  w: 64,
  h: 60,
  draw: (c) => {
    const F = '#dbe8f4';
    const D = '#97b0cc';
    const DD = '#6f89a8';
    const I = '#9fe0ff';
    const IL = '#e6faff';
    const ID = '#4aa0d8';
    // far legs
    rect(c, 13, 40, 9, 15, DD);
    rect(c, 39, 41, 9, 14, DD);
    // body
    ball(c, 30, 35, 24, 14, F, -44, 0);
    // shaggy fringe
    const fr: number[] = [7, 40];
    for (let x = 8; x <= 52; x += 4) fr.push(x + 2, 49 + ((x / 4) % 2), x + 4, 44);
    fr.push(53, 38);
    poly(c, fr, D);
    // near legs + toes
    rect(c, 19, 42, 10, 13, F);
    rect(c, 44, 42, 10, 13, F);
    rect(c, 26, 42, 3, 13, D);
    rect(c, 51, 42, 3, 13, D);
    for (const x of [19, 22.5, 26, 44, 47.5, 51]) rect(c, x, 53.5, 2.5, 1.6, '#3c4c66');
    // glacier on the back
    shard(c, 10, 18, 7, 31, 16, 29, I, IL, ID);
    shard(c, 18, 9, 14, 27, 24, 25, I, IL, ID);
    shard(c, 28, 3, 22, 25, 34, 24, '#b6ecff', IL, ID);
    shard(c, 37, 9, 32, 25, 42, 26, I, IL, ID);
    shard(c, 45, 16, 40, 27, 48, 28, I, IL, ID);
    ellipse(c, 28, 25.5, 19, 2.5, rgba('#ffffff', 0.85));
    // head
    ball(c, 51, 35, 10, 9, F, -40, 0);
    ellipse(c, 47, 28, 6, 3, '#ffffff', -0.3);
    ellipse(c, 57.5, 39, 5, 4, '#c6d6ea');
    rect(c, 61, 37.5, 2, 2, '#2a3448');
    // tusks
    path(c, '#f4fbff', (c) => {
      c.moveTo(52, 41);
      c.quadraticCurveTo(52, 50, 58, 50.5);
      c.quadraticCurveTo(62, 50, 63, 45);
      c.quadraticCurveTo(60, 48, 57.5, 47);
      c.quadraticCurveTo(55, 45, 55.5, 41);
      c.closePath();
    });
    line(c, [53, 43, 55, 48], '#b8d0e8', 0.8);
    // eye + brow
    ellipse(c, 53.5, 33, 1.7, 1.5, '#1e5a9a');
    rect(c, 53, 32.4, 1, 1, '#ffffff');
    line(c, [50.5, 30.5, 56, 31.5], D, 1.2);
  },
  fx: {
    post: (c) => {
      glow(c, 28, 14, 14, '#aee9ff', 0.25);
      twinkle(c, 28, 6, '#ffffff', 2);
      twinkle(c, 12, 22, '#ffffff');
      twinkle(c, 45, 19, '#ffffff');
    },
  },
};

const magmaBrute: Spec = {
  w: 64,
  h: 60,
  draw: (c) => {
    const R = '#423838';
    const RD = '#2e2628';
    const L = '#62565a';
    const LL = '#80747a';
    const M = '#ff5a14';
    const MY = '#ffb43c';
    const MW = '#fff0a0';
    // back arm (left)
    poly(c, [14, 18, 5, 27, 3, 42, 9, 48, 16, 42, 19, 26], RD);
    line(c, [6, 36, 10, 40, 8, 45], M, 1);
    // legs
    poly(c, [17, 42, 28, 42, 29, 55, 15, 55], RD);
    poly(c, [32, 42, 43, 42, 45, 55, 31, 55], R);
    rect(c, 31, 51, 14, 4, RD);
    line(c, [36, 45, 38, 50], M, 1);
    // torso
    poly(c, [12, 44, 9, 26, 18, 13, 34, 9, 48, 14, 54, 26, 50, 44, 32, 48], R);
    poly(c, [18, 13, 34, 9, 36, 17, 22, 23, 11, 27], L);
    poly(c, [20, 13.5, 30, 11, 30, 14, 22, 17], LL);
    poly(c, [54, 26, 50, 44, 32, 48, 40, 38, 48, 30], RD);
    // magma cracks
    line(c, [22, 23, 26, 29, 23, 35, 27, 41], M, 1.6);
    line(c, [36, 17, 40, 21, 44, 20], M, 1.4);
    line(c, [14, 33, 18, 36, 16, 41], M, 1.2);
    line(c, [22, 23, 26, 29, 23, 35, 27, 41], MY, 0.6);
    // molten core
    circle(c, 34, 29, 6, '#c23a0a');
    circle(c, 34, 29, 4.6, M);
    circle(c, 34, 29, 3, MY);
    circle(c, 33.2, 28.2, 1.5, MW);
    // head sunk between the shoulders
    poly(c, [31, 13, 33, 5, 43, 4, 47, 10, 43, 15, 34, 15], L);
    poly(c, [33, 5, 43, 4, 42, 7, 35, 8], LL);
    rect(c, 36, 8.5, 9, 3.5, RD);
    rect(c, 37, 9.5, 3, 1.6, MY);
    rect(c, 42, 9.5, 2.5, 1.6, MY);
    // front arm + fist
    poly(c, [42, 15, 52, 13, 59, 24, 55, 32, 46, 28], R);
    poly(c, [42, 15, 52, 13, 54, 18, 45, 20], L);
    poly(c, [49, 31, 61, 31, 62, 43, 57.5, 50, 49, 48, 47, 38], L);
    poly(c, [61, 31, 62, 43, 57.5, 50, 56, 40], R);
    poly(c, [49, 31, 61, 31, 60, 34, 50, 35], LL);
    line(c, [51, 39, 55, 40, 59, 38], M, 1.2);
    line(c, [52, 44, 56, 45], M, 1);
    // lava drip
    poly(c, [55, 49, 57, 49, 56.5, 53.5, 55.5, 53.5], M);
    circle(c, 56, 55.5, 1, MY);
  },
  fx: {
    post: (c) => {
      glow(c, 34, 29, 14, '#ff7a1a', 0.45);
      glow(c, 40, 10.5, 6, '#ffb43c', 0.4);
      glow(c, 25, 32, 6, '#ff5a14', 0.25);
      rect(c, 46, 3, 1, 1, '#ffb43c');
      rect(c, 26, 5, 1, 1, '#ff7a1a');
    },
  },
};

const tempestDrake: Spec = {
  w: 64,
  h: 60,
  draw: (c) => {
    // A heavier, four-legged storm drake rearing its neck, jaws crackling.
    const B = '#33479e';
    const D = '#212f6c';
    const Y = '#ffe14a';
    const YD = '#c9a028';
    const Bel = '#e6d8a0';
    const Cl = '#d6e0f4';
    const Claw = '#eef2ff';
    // far wing
    drakeWing(c, 30, 27, 1.5, D, '#41569c', Y);
    // tail sweeping back with a bolt fin
    path(c, B, (c) => {
      c.moveTo(18, 35);
      c.bezierCurveTo(9, 38, 5, 46, 2, 40);
      c.quadraticCurveTo(3, 50, 18, 43);
      c.closePath();
    });
    poly(c, [2.5, 41, 0.5, 33, 3.5, 36, 4.5, 30, 6.5, 41], Y);
    // far legs
    line(c, [18, 40, 16, 48, 18, 53], D, 4);
    line(c, [38, 40, 40, 48, 38.5, 53], D, 4);
    rect(c, 15, 52.5, 6, 2, D);
    rect(c, 36, 52.5, 6, 2, D);
    // body
    ball(c, 28, 38, 15, 8.5, B, -26, 26);
    clipTo(
      c,
      (c) => c.ellipse(28, 38, 15, 8.5, 0, 0, TAU),
      () => {
        ellipse(c, 30, 46, 13, 4, Bel);
        for (const x of [22, 27, 32, 37]) rect(c, x, 42.5, 1, 4, '#c8b880');
      },
    );
    bolt(c, [17, 35, 22, 33, 24, 36, 30, 33, 33, 36, 38, 33], Y, 1.4, '');
    // near legs with pale claws
    ellipse(c, 20, 42, 5.5, 5.5, B);
    line(c, [20, 44, 19, 49, 21.5, 53], B, 4.2);
    ellipse(c, 40, 42, 4.6, 5, B);
    line(c, [40.5, 44, 43, 49, 42, 53], B, 4.2);
    for (const x of [18, 20.5, 23, 40, 42.5, 45]) rect(c, x, 54, 1.5, 1.2, Claw);
    // neck rising to the head
    ellipse(c, 44.5, 27, 5.8, 11, B, 0.45);
    ellipse(c, 47, 30, 2.6, 7, Bel, 0.45);
    // storm-cloud mane along the neck
    for (const [x, y, r] of [
      [38, 30, 3.2],
      [40.5, 25, 3.4],
      [44, 20, 3.2],
    ] as const) {
      circle(c, x, y + 0.8, r, '#8e9cc0');
      circle(c, x - 0.3, y, r * 0.88, Cl);
    }
    // swept-back horns: far, then near
    poly(c, [46, 11, 40, 4, 35, 0.5, 42, 2.5, 49, 8.5], YD);
    poly(c, [49, 12.5, 42, 7, 35.5, 4.5, 43, 5, 51.5, 10], Y);
    // head with open, crackling jaws
    ball(c, 51, 15.5, 6.5, 5.5, B, -26, 26);
    poly(c, [52, 11.5, 63, 15, 62.5, 17.5, 53, 18.5], B);
    poly(c, [53, 17, 62.5, 17.5, 61.5, 18.8, 53, 19], D);
    poly(c, [53, 19, 61.5, 19.5, 60, 23.5, 53, 22], '#fff3a0');
    poly(c, [52, 22, 60.5, 22.5, 59, 25, 51.5, 24.5], B);
    poly(c, [55, 18.6, 56, 21, 57, 18.8], '#ffffff');
    rect(c, 61, 14.6, 1.4, 1.4, D);
    line(c, [49.5, 12, 55.5, 13.2], D, 1.4);
    ellipse(c, 53.5, 14.4, 1.8, 1.3, Y);
    rect(c, 53.5, 13.6, 1, 1.6, INK);
    // near wing
    drakeWing(c, 31, 29, 1.65, D, '#86acf0', Y);
  },
  fx: {
    post: (c) => {
      glow(c, 57, 21, 7, '#ffe14a', 0.55);
      glow(c, 53.5, 14.4, 3.5, '#ffe14a', 0.5);
      bolt(c, [60, 26, 57.5, 30, 60, 31, 57, 36], '#ffe14a', 1.4);
      bolt(c, [9, 46, 11, 49, 9, 50, 12, 54], '#ffe14a', 1.2);
    },
  },
};

const duskSovereign: Spec = {
  w: 64,
  h: 60,
  draw: (c) => {
    const A = '#3a2a5e';
    const AD = '#241a40';
    const AL = '#58448a';
    const Gd = '#e0a84a';
    const E = '#ffe0ff';
    const P = '#d38cff';
    const Bone = '#ecdcc2';
    // setting-sun halo
    c.save();
    c.strokeStyle = '#ffb060';
    c.lineWidth = 2.6;
    c.beginPath();
    c.arc(35, 15, 12, Math.PI * 0.95, Math.PI * 2.05);
    c.stroke();
    c.strokeStyle = '#ff7a5a';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(35, 15, 14.6, Math.PI * 1.05, Math.PI * 1.95);
    c.stroke();
    c.restore();
    // cape
    path(
      c,
      vgrad(c, 14, 55, [
        [0, AD],
        [0.6, '#5a2a6a'],
        [1, '#ff8a5a'],
      ]),
      (c) => {
        c.moveTo(26, 17);
        c.bezierCurveTo(16, 27, 10, 40, 5, 54);
        c.lineTo(12, 51);
        c.lineTo(16, 55);
        c.lineTo(22, 51);
        c.lineTo(27, 55);
        c.lineTo(32, 50);
        c.lineTo(40, 22);
        c.closePath();
      },
    );
    // legs (digitigrade, armored)
    line(c, [32, 40, 29, 47, 31, 54], AD, 4);
    line(c, [40, 40, 44, 47, 42, 54], A, 4.4);
    rect(c, 27, 53.5, 7, 2, AD);
    rect(c, 39.5, 53.5, 8, 2, AD);
    rect(c, 42.5, 46, 2, 2, Gd);
    // torso
    poly(c, [27, 19, 44, 19, 46, 30, 42, 42, 30, 42, 26, 30], A);
    poly(c, [27, 19, 36, 19, 34, 30, 26, 30], AL);
    line(c, [30, 42, 42, 42], Gd, 1.4);
    line(c, [36, 21, 36, 41], Gd, 1);
    poly(c, [36, 27, 39, 30, 36, 33, 33, 30], P);
    // pauldrons
    poly(c, [22, 22, 25, 16, 31, 17, 31, 23], AL);
    poly(c, [22, 22, 19, 16.5, 25, 18], Gd);
    poly(c, [40, 17, 46, 16, 50, 22, 42, 23], A);
    poly(c, [46, 16, 50, 11, 49, 18], Gd);
    // great curling horns: far, then head, then near
    path(c, '#bfae94', (c) => {
      c.moveTo(34, 9);
      c.quadraticCurveTo(28, 1, 20, 3);
      c.quadraticCurveTo(25, 2, 29, 7);
      c.quadraticCurveTo(31, 10, 33, 12);
      c.closePath();
    });
    ball(c, 37, 12, 6, 6, AL, -24, 24);
    path(c, Bone, (c) => {
      c.moveTo(38, 8);
      c.quadraticCurveTo(37, -1, 27, 0.5);
      c.quadraticCurveTo(34, 2, 35, 7);
      c.quadraticCurveTo(35.5, 9, 36, 10);
      c.closePath();
    });
    // visor face with burning eyes
    poly(c, [36.5, 10, 43.5, 10.5, 42.5, 15, 38.5, 16.5, 36, 14], AD);
    line(c, [37.5, 12, 42, 12.3], E, 1.6);
    poly(c, [39, 16, 42.5, 15, 41, 18], A);
    // raised arm holding a dusk orb
    line(c, [43, 22, 49, 27, 53, 24], A, 3.4);
    line(c, [53, 24, 55, 21], Bone, 1);
    line(c, [53, 24, 56, 23.5], Bone, 1);
    circle(c, 56, 19, 4, P);
    circle(c, 55, 18, 2, '#f8e0ff');
    // back arm
    line(c, [27, 23, 24, 32, 27, 38], AD, 3);
  },
  fx: {
    post: (c) => {
      glow(c, 56, 19, 9, '#d38cff', 0.55);
      glow(c, 40, 12.2, 4, '#ffd0ff', 0.6);
      glow(c, 35, 15, 16, '#ff9a5a', 0.22, true);
    },
  },
};

// ---------------------------------------------------------------- wardens (huge)

const thunderhoof: Spec = {
  w: 96,
  h: 88,
  draw: (c) => {
    const N = '#2c3c6a';
    const ND = '#1c2748';
    const H = '#0f1628';
    const Y = '#ffe14a';
    const YD = '#c99a1a';
    const Cl = '#cdd7ee';
    const ClD = '#8e9cc0';
    // tail with bolt tuft
    line(c, [19, 42, 13, 46, 11, 55], ND, 3);
    poly(c, [6, 54, 13, 52, 10, 57, 15, 57, 7, 67, 9, 60, 4, 60], Y);
    // far legs
    poly(c, [24, 54, 33, 54, 32, 80, 25, 80], ND);
    poly(c, [62, 56, 71, 56, 70, 80, 63, 80], ND);
    rect(c, 25, 76, 7, 4, H);
    rect(c, 63, 76, 7, 4, H);
    // body + hump
    ball(c, 46, 52, 28, 15, N, -26, 0);
    ball(c, 62, 44, 18, 17, N, -26, 20);
    // near legs
    poly(c, [32, 56, 42, 56, 41, 80, 33, 80], N);
    poly(c, [70, 58, 80, 58, 79, 80, 71, 80], N);
    rect(c, 39, 58, 2, 18, ND);
    rect(c, 77, 60, 2, 16, ND);
    rect(c, 33, 75, 8, 5, H);
    rect(c, 71, 75, 8, 5, H);
    rect(c, 33, 74, 8, 1.6, Y);
    rect(c, 71, 74, 8, 1.6, Y);
    // storm-cloud mane over the hump and neck
    const puffs: [number, number, number][] = [
      [36, 38, 6],
      [44, 33, 7.5],
      [53, 29, 8.5],
      [63, 28, 9],
      [72, 32, 8],
      [77, 39, 6],
      [50, 37, 6],
      [68, 39, 6],
      [58, 36, 6],
    ];
    for (const [x, y, r] of puffs) circle(c, x + 1, y + 2, r, ClD);
    for (const [x, y, r] of puffs) circle(c, x, y, r * 0.9, Cl);
    for (const [x, y, r] of puffs) circle(c, x - r * 0.3, y - r * 0.35, r * 0.35, '#f2f6ff');
    // head (lowered, charging)
    ball(c, 80, 52, 11, 10, N, -26, 20);
    ellipse(c, 86.5, 58, 7.5, 6, '#4a5e9a');
    ellipse(c, 85, 56, 4, 2, '#6074b0');
    rect(c, 89, 57, 2, 2, H);
    rect(c, 92, 57, 1.5, 2, H);
    // beard cloud
    circle(c, 79, 63, 4, ClD);
    circle(c, 78.5, 62.4, 3.4, Cl);
    // horns: far then near, bolt-shaped
    poly(c, [72, 43, 69, 31, 72.5, 32, 70, 20, 76, 33, 73.5, 33.5, 76.5, 43], YD);
    poly(c, [79, 44, 83, 33, 80.5, 32.5, 88, 20, 86.5, 30.5, 90, 30.5, 85, 45], Y);
    line(c, [83, 33, 88, 21], '#fff6b0', 1);
    // brow + eyes
    line(c, [76, 46, 86, 47.5], H, 2);
    ellipse(c, 82.5, 50, 2.4, 2, Y);
    ellipse(c, 75.5, 49.5, 1.8, 1.6, YD);
    rect(c, 82, 49, 1.5, 1.5, '#ffffff');
  },
  fx: {
    post: (c) => {
      glow(c, 82.5, 50, 6, '#ffe14a', 0.55);
      bolt(c, [40, 31, 46, 26, 49, 31, 55, 24, 61, 30, 67, 25], '#bfe4ff', 1.8, '#ffffff');
      bolt(c, [62, 40, 66, 36, 64, 34, 70, 30], '#ffe14a', 1.2);
      glow(c, 54, 28, 14, '#9fd0ff', 0.25);
      bolt(c, [6, 70, 9, 73, 7, 74, 10, 78], '#ffe14a', 1);
    },
  },
};

const ironrootColossus: Spec = {
  w: 96,
  h: 88,
  draw: (c) => {
    const S = '#9c8c74';
    const SL = '#bfae90';
    const SD = '#6c5e4c';
    const SDD = '#4e4436';
    const R = '#6b4a2a';
    const RL = '#94703f';
    const M = '#5f9a3e';
    const ML = '#86c25a';
    const A = '#ffbf3a';
    // back arm
    poly(c, [20, 28, 10, 36, 7, 58, 4, 70, 18, 72, 20, 58, 26, 40], SDD);
    poly(c, [4, 70, 18, 72, 17, 76, 6, 76], SDD);
    line(c, [12, 40, 18, 48, 10, 56, 16, 64], shade(R, -16), 2.6);
    // legs
    poly(c, [28, 56, 44, 56, 45, 80, 26, 80], SDD);
    poly(c, [50, 56, 68, 56, 70, 80, 49, 80], S);
    poly(c, [62, 56, 68, 56, 70, 80, 64, 80], SD);
    rect(c, 49, 77, 21, 3, SD);
    line(c, [50, 62, 58, 66, 68, 63], R, 3);
    line(c, [52, 72, 60, 70, 68, 74], R, 2.4);
    line(c, [50, 62, 58, 66], RL, 1);
    line(c, [28, 64, 36, 68, 44, 64], shade(R, -16), 2.6);
    // torso
    poly(c, [16, 58, 12, 36, 22, 18, 46, 11, 68, 15, 78, 30, 74, 56, 46, 63], S);
    poly(c, [22, 18, 46, 11, 50, 24, 30, 34, 13, 37], SL);
    poly(c, [78, 30, 74, 56, 46, 63, 56, 46, 68, 38], SD);
    line(c, [30, 34, 34, 44, 28, 52], SD, 1.2);
    line(c, [56, 46, 60, 54], SDD, 1.2);
    // amber core inside a root cage
    poly(c, [45, 32, 52, 40, 45, 50, 38, 40], A);
    poly(c, [45, 32, 45, 50, 38, 40], '#ffe08a');
    rect(c, 42, 37, 1.5, 3, '#fff6d0');
    // roots wrapping the body
    c.lineCap = 'round';
    for (const [pts, w] of [
      [[14, 44, 26, 40, 38, 34], 4],
      [[52, 30, 62, 34, 76, 34], 3.6],
      [[36, 52, 44, 54, 56, 50, 64, 54, 74, 50], 3.6],
      [[38, 34, 40, 40, 38, 46, 42, 52], 2.4],
      [[52, 30, 51, 38, 53, 46], 2.4],
    ] as [number[], number][]) {
      line(c, pts, R, w);
      line(
        c,
        pts.map((v, i) => (i % 2 ? v - w * 0.25 : v)),
        RL,
        Math.max(1, w * 0.35),
      );
    }
    // moss on the shoulders
    for (const [x, y, rx, ry] of [
      [26, 19, 8, 3.6],
      [40, 13, 9, 3.4],
      [66, 17, 8, 3.4],
      [16, 34, 4, 2.4],
    ] as const) {
      ellipse(c, x, y + 1, rx, ry, M);
      ellipse(c, x - 1, y, rx * 0.7, ry * 0.6, ML);
    }
    // sapling growing from the shoulder
    line(c, [24, 18, 22, 8], R, 2);
    line(c, [22.5, 11, 18, 7], R, 1.2);
    for (const [x, y, r] of [
      [22, 5, 4.2],
      [17, 6.5, 3.2],
      [26.5, 6.5, 3.2],
    ] as const) {
      circle(c, x, y + 0.8, r, M);
      circle(c, x - 0.6, y, r * 0.75, ML);
    }
    // head, set low and forward
    poly(c, [62, 20, 64, 11, 78, 9, 84, 16, 82, 27, 68, 29], S);
    poly(c, [64, 11, 78, 9, 79, 13, 66, 16], SL);
    poly(c, [84, 16, 82, 27, 68, 29, 76, 22], SD);
    rect(c, 69, 16, 13, 5, SDD);
    rect(c, 71, 17.5, 4, 2, A);
    rect(c, 77, 17.5, 3.5, 2, A);
    ellipse(c, 71, 10.5, 6, 2, M);
    ellipse(c, 70, 10, 4, 1.2, ML);
    // front arm: shoulder, forearm, root-bound fist
    poly(c, [68, 22, 82, 26, 86, 44, 80, 50, 72, 44], S);
    poly(c, [68, 22, 82, 26, 80, 32, 70, 30], SL);
    poly(c, [76, 48, 92, 48, 94, 66, 88, 74, 76, 72, 74, 60], S);
    poly(c, [76, 48, 92, 48, 90, 53, 78, 54], SL);
    poly(c, [94, 66, 88, 74, 84, 70, 92, 60], SD);
    line(c, [74, 58, 84, 62, 94, 58], R, 3);
    line(c, [74, 58, 84, 62], RL, 1);
    line(c, [80, 30, 84, 38, 80, 44], R, 2.4);
    line(c, [76, 72, 78, 78, 82, 80], R, 1.6);
    line(c, [88, 73, 90, 79], R, 1.4);
  },
  fx: {
    post: (c) => {
      glow(c, 45, 41, 14, '#ffbf3a', 0.45);
      glow(c, 75.5, 18.5, 8, '#ffbf3a', 0.35);
    },
  },
};

const hollowRegent: Spec = {
  w: 96,
  h: 88,
  draw: (c) => {
    const robe = (c: Ctx) => {
      c.moveTo(34, 26);
      c.bezierCurveTo(26, 34, 20, 50, 14, 70);
      c.lineTo(22, 65);
      c.lineTo(26, 76);
      c.lineTo(34, 67);
      c.lineTo(41, 78);
      c.lineTo(48, 68);
      c.lineTo(56, 77);
      c.lineTo(62, 66);
      c.lineTo(70, 74);
      c.lineTo(72, 64);
      c.lineTo(80, 69);
      c.bezierCurveTo(74, 50, 70, 34, 62, 26);
      c.closePath();
    };
    path(
      c,
      vgrad(c, 26, 78, [
        [0, 'rgba(92,70,150,0.97)'],
        [0.5, 'rgba(84,62,140,0.8)'],
        [1, 'rgba(110,80,180,0.22)'],
      ]),
      robe,
    );
    clipTo(c, robe, () => {
      ellipse(c, 34, 50, 6, 22, 'rgba(190,170,240,0.25)', 0.15);
      ellipse(c, 68, 52, 7, 24, 'rgba(30,16,60,0.35)', -0.1);
      line(c, [48, 34, 48, 70], 'rgba(200,170,255,0.35)', 1.4);
    });
    // spectral sleeves
    path(c, 'rgba(100,78,160,0.9)', (c) => {
      c.moveTo(36, 30);
      c.quadraticCurveTo(22, 34, 14, 46);
      c.lineTo(20, 48);
      c.quadraticCurveTo(26, 42, 34, 40);
      c.closePath();
    });
    path(c, 'rgba(100,78,160,0.92)', (c) => {
      c.moveTo(60, 30);
      c.quadraticCurveTo(72, 32, 78, 42);
      c.lineTo(72, 45);
      c.quadraticCurveTo(68, 40, 62, 39);
      c.closePath();
    });
    // bony hands
    for (const [x, y, s] of [
      [16, 47, -1],
      [76, 43, 1],
    ] as const) {
      line(c, [x, y, x + s * 3, y + 5], '#e4dccb', 1.2);
      line(c, [x, y, x + s * 0.5, y + 6], '#e4dccb', 1.2);
      line(c, [x, y, x - s * 2, y + 5], '#e4dccb', 1.2);
    }
    // scepter
    line(c, [80, 30, 80, 70], '#a8832c', 2.2);
    line(c, [79.5, 30, 79.5, 70], '#e0be5a', 0.8);
    circle(c, 80, 26, 4.2, '#a8832c');
    circle(c, 80, 26, 3.2, '#b08cff');
    circle(c, 79, 25, 1.4, '#efe4ff');
    // pale mantle over the shoulders
    path(c, '#d6cde6', (c) => {
      c.moveTo(30, 30);
      c.quadraticCurveTo(48, 20, 66, 30);
      c.quadraticCurveTo(64, 40, 48, 41);
      c.quadraticCurveTo(32, 40, 30, 30);
      c.closePath();
    });
    path(c, '#aea3c4', (c) => {
      c.moveTo(31, 33);
      c.quadraticCurveTo(48, 44, 65, 33);
      c.quadraticCurveTo(64, 40, 48, 41);
      c.quadraticCurveTo(32, 40, 31, 33);
      c.closePath();
    });
    for (const [x, y] of [
      [36, 33],
      [44, 36],
      [52, 36],
      [60, 33],
    ] as const)
      rect(c, x, y, 1.5, 2, '#5a4a78');
    // hood + void face + bone mask
    ellipse(c, 48, 22, 11, 11, '#4a3880');
    ellipse(c, 49, 23, 8.6, 8.6, '#120a20');
    poly(c, [43, 18, 55, 18, 56, 25, 49, 32, 42, 25], '#e8e0d0');
    poly(c, [43, 18, 49, 18, 49, 32, 42, 25], '#f6f0e4');
    rect(c, 44, 21, 3.5, 2.5, '#120a20');
    rect(c, 51, 21, 3.5, 2.5, '#120a20');
    rect(c, 45, 21.5, 1.5, 1.5, '#d8c0ff');
    rect(c, 52, 21.5, 1.5, 1.5, '#d8c0ff');
    line(c, [49, 26, 49, 30], '#9a90a8', 1);
    // tall jagged crown
    poly(c, [37, 15, 36, 3, 40, 9, 43, 0.5, 46, 8, 49, 1, 52, 8, 55, 0.5, 58, 9, 62, 3, 61, 15], '#c9a03a');
    poly(c, [37, 15, 36, 3, 40, 9, 43, 0.5, 46, 8, 49, 1, 49, 15], '#e8c860');
    rect(c, 37, 12.5, 24, 2.5, '#a8832c');
    circle(c, 49, 10.5, 1.8, '#b08cff');
    circle(c, 42, 11.5, 1.2, '#b08cff');
    circle(c, 56, 11.5, 1.2, '#b08cff');
  },
  fx: {
    ghost: true,
    post: (c) => {
      glow(c, 45.7, 22.2, 4, '#c8a8ff', 0.6);
      glow(c, 52.7, 22.2, 4, '#c8a8ff', 0.6);
      glow(c, 80, 26, 9, '#b08cff', 0.5);
      glow(c, 49, 10.5, 4, '#b08cff', 0.4);
      for (const [x, y] of [
        [10, 60],
        [86, 54],
        [20, 82],
        [74, 84],
        [30, 20],
      ] as const)
        rect(c, x, y, 1, 1, 'rgba(200,180,255,0.75)');
    },
  },
};

// ---------------------------------------------------------------- registry

const SPECS: Record<string, Spec> = {
  mon_jellop: jellop,
  mon_pipsprout: pipsprout,
  mon_puddlewisp: puddlewisp,
  mon_gustling: gustling,
  mon_sparkbug: sparkbug,
  mon_mossling: mossling,
  mon_cragling: cragling,
  mon_glowmite: glowmite,
  mon_gloomcap: gloomcap,
  mon_hollowshade: hollowshade,
  mon_cairn_wraith: cairnWraith,
  mon_emberkit: emberkit,
  mon_ashfly: ashfly,
  mon_voltcalf: voltcalf,
  mon_moonmoth: moonmoth,
  mon_ironroot_colossus: ironrootColossus,
  mon_hollow_regent: hollowRegent,
  mon_thunderhoof: thunderhoof,
  mon_riftling: riftling,
  mon_rift_stalker: riftStalker,
  mon_frostling: frostling,
  mon_rimefang: rimefang,
  mon_glacier_matron: glacierMatron,
  mon_basalt_crawler: basaltCrawler,
  mon_cinder_toad: cinderToad,
  mon_magma_brute: magmaBrute,
  mon_cloudray: cloudray,
  mon_thunderwing: thunderwing,
  mon_tempest_drake: tempestDrake,
  mon_duskhound: duskhound,
  mon_gloamthorn: gloamthorn,
  mon_dusk_sovereign: duskSovereign,
};

/** Draws every `mon_<species>` texture (skips keys that already exist). */
export function drawMonsters(scene: Phaser.Scene): void {
  for (const key of Object.keys(SPECS)) make(scene, key, SPECS[key]);
}
