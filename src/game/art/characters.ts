// Pixel-art humans: the three player builds and every town NPC (docs/ART-DIRECTION.md §4).
//
// Conventions
// - Canvas 40x48, character faces RIGHT (the client mirrors with flipX). Soles sit on row 45, so the
//   sprite origin (0.5, 0.95) puts the ground point under the feet; the body is centred on x = 20.
// - Chibi build (~2.5 heads): head rows 9-24, torso 25-35, legs + boots 36-45 (children are shorter).
// - Every body part is painted flat on a scratch layer, gets its own 1 px outline (PAL.outline) and is
//   stacked back-to-front, so limbs, weapons and props stay readable over the body. Effects (slash
//   smears, sparkles) are painted last without outline. Integer pixels only, no anti-aliasing,
//   fully deterministic.
// - Frame 0 of every idle keeps the legacy key ('player_sword', 'npc_blacksmith', ...).
import type Phaser from 'phaser';
import { PAL, outline, pixelTex, px, rect, shade, type Ctx } from './pixel';

export const CHAR_W = 40;
export const CHAR_H = 48;

const W = CHAR_W;
const H = CHAR_H;
const INK = PAL.outline;

// ---------------------------------------------------------------- colour helpers

function mix(a: string, b: string, t: number): string {
  const na = parseInt(a.slice(1), 16);
  const nb = parseInt(b.slice(1), 16);
  const ch = (s: number) => Math.round(((na >> s) & 255) + (((nb >> s) & 255) - ((na >> s) & 255)) * t);
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`;
}

/** [deep, dark, base, light]: shadows drift toward plum, lights toward warm cream (light from top-left). */
function ramp(base: string): [string, string, string, string] {
  return [mix(shade(base, -58), '#2a1630', 0.22), mix(shade(base, -30), '#3a2440', 0.14), base, mix(shade(base, 34), '#fff2c8', 0.18)];
}

const STEEL = ['#4f5866', '#7d8794', '#bcc6d0', '#eef3f6'] as const;
const GOLD = ['#7a5418', '#b0803a', '#e9c46a', '#fff0b0'] as const;
const LEATHER = PAL.wood;
const EYE = '#2b1b22';
const BLUSH = '#e48a86';

// ---------------------------------------------------------------- pixel primitives

/** Capsule (thick segment) sampled at pixel centres: pixel (x, y) is lit when its distance to the segment <= r. */
function cap(c: Ctx, x0: number, y0: number, x1: number, y1: number, r: number, color: string): void {
  c.fillStyle = color;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  for (let y = Math.floor(Math.min(y0, y1) - r); y <= Math.ceil(Math.max(y0, y1) + r); y++)
    for (let x = Math.floor(Math.min(x0, x1) - r); x <= Math.ceil(Math.max(x0, x1) + r); x++) {
      let t = len2 ? ((x - x0) * dx + (y - y0) * dy) / len2 : 0;
      t = Math.max(0, Math.min(1, t));
      const ex = x - (x0 + dx * t);
      const ey = y - (y0 + dy * t);
      if (ex * ex + ey * ey <= r * r + 0.02) c.fillRect(x, y, 1, 1);
    }
}

/** Trapezoid by rows: inclusive rows y0..y1, inclusive columns interpolated from [l0, r0] to [l1, r1]. */
function trap(c: Ctx, y0: number, y1: number, l0: number, r0: number, l1: number, r1: number, color: string): void {
  c.fillStyle = color;
  for (let y = y0; y <= y1; y++) {
    const t = y1 === y0 ? 0 : (y - y0) / (y1 - y0);
    const l = Math.round(l0 + (l1 - l0) * t);
    const r = Math.round(r0 + (r1 - r0) * t);
    if (r >= l) c.fillRect(l, y, r - l + 1, 1);
  }
}

/** Paints a string template; '.' and ' ' are skipped, other chars map through `pal`. */
function tpl(c: Ctx, x: number, y: number, rows: readonly string[], pal: Record<string, string>): void {
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const col = pal[rows[j][i]];
      if (col) px(c, x + i, y + j, col);
    }
}

/** Samples a shape along an axis from (hx, hy) at angle `ang`: f(t, s) with t along the axis, s across (s < 0 = lit side). */
function along(
  c: Ctx,
  hx: number,
  hy: number,
  ang: number,
  t0: number,
  t1: number,
  half: number,
  f: (t: number, s: number) => string | null,
): void {
  const ux = Math.cos(ang);
  const uy = Math.sin(ang);
  const xs = [hx + ux * t0, hx + ux * t1];
  const ys = [hy + uy * t0, hy + uy * t1];
  const x0 = Math.floor(Math.min(...xs) - half - 1);
  const x1 = Math.ceil(Math.max(...xs) + half + 1);
  const y0 = Math.floor(Math.min(...ys) - half - 1);
  const y1 = Math.ceil(Math.max(...ys) + half + 1);
  for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++)
    for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
      const dx = x - hx;
      const dy = y - hy;
      const t = dx * ux + dy * uy;
      if (t < t0 || t > t1) continue;
      const s = -dx * uy + dy * ux;
      if (Math.abs(s) > half) continue;
      const col = f(t, s);
      if (col) px(c, x, y, col);
    }
}

/** Point on the axis (for attaching tips, glows and trails). */
function axisPt(hx: number, hy: number, ang: number, t: number): [number, number] {
  return [Math.round(hx + Math.cos(ang) * t), Math.round(hy + Math.sin(ang) * t)];
}

// ---------------------------------------------------------------- layers

let scratchCv: HTMLCanvasElement | undefined;

/** Draws one part on a scratch layer, gives it a 1 px outline, and stacks it on `dst`. */
function layer(dst: Ctx, draw: (c: Ctx) => void, outlined = true): void {
  if (!scratchCv) {
    scratchCv = document.createElement('canvas');
    scratchCv.width = W;
    scratchCv.height = H;
  }
  const c = scratchCv.getContext('2d', { willReadFrequently: true })!;
  c.clearRect(0, 0, W, H);
  c.imageSmoothingEnabled = false;
  draw(c);
  if (outlined) outline(c, W, H, INK);
  dst.drawImage(scratchCv, 0, 0);
}

// ---------------------------------------------------------------- looks

type HairStyle = 'tousled' | 'spiky' | 'long' | 'bun' | 'pony' | 'bald' | 'braid' | 'tuft' | 'crop';
type Hat = 'wizard' | 'hood' | 'veil' | 'cowl' | 'straw' | 'shako' | 'cap' | 'miner' | 'feather' | 'goggles' | 'circlet' | 'bandana';
type Prop =
  | 'sword'
  | 'dagger'
  | 'staff'
  | 'hammer'
  | 'sunstaff'
  | 'walkstick'
  | 'rod'
  | 'baton'
  | 'ledger'
  | 'waystaff'
  | 'book'
  | 'scroll'
  | 'compass'
  | 'kite'
  | 'pickaxe'
  | 'bow';

interface Look {
  skin: string;
  hair: string;
  style: HairStyle;
  top: string;
  /** Sleeve colour (defaults to `top`; pass the skin tone for bare arms). */
  sleeves?: string;
  legs: string;
  boots: string;
  /** Robe hem row (absolute, adult rows): 40 = knee-length coat, 44 = floor-length. */
  robe?: number;
  apron?: string;
  belt?: string;
  buckle?: string;
  /** Diagonal strap across the chest. */
  sash?: string;
  /** Collar, placket and hem trim. */
  trim?: string;
  emblem?: string;
  scarf?: string;
  /** Back cape colour. */
  cape?: string;
  /** Shoulder plate on the front shoulder. */
  pauldron?: string;
  hat?: Hat;
  hatColor?: string;
  hatTrim?: string;
  beard?: string;
  mustache?: string;
  glasses?: boolean;
  /** Cloth mask over the lower face. */
  mask?: string;
  back?: 'pack' | 'quiver' | 'scrolls';
  prop?: Prop;
  child?: boolean;
  /** Bent old frame (head forward and down). */
  hunch?: boolean;
  blush?: boolean;
  /** Eye colour (default near-black). */
  eye?: string;
  /** Broad shoulders (smith, drillmaster). */
  broad?: boolean;
}

// ---------------------------------------------------------------- poses

interface Pose {
  /** Upper-body offset: + down. */
  bob: number;
  /** Upper-body offset: + forward. */
  lean: number;
  /** Extra head offset (y). */
  headDy?: number;
  /** Ankle offsets [dx, lift] from the rest stance. */
  backFoot: [number, number];
  frontFoot: [number, number];
  /** Hand offsets [dx, dy] from the rest pose (applied on top of bob/lean). */
  backHand: [number, number];
  frontHand: [number, number];
  /** Weapon angle override (radians, 0 = pointing right, negative = up). */
  ang?: number;
  /** Weapon painted behind the body (wind-ups). */
  behind?: boolean;
  /** Front arm painted behind the head (arm raised behind it). */
  armBehind?: boolean;
  /** How far the hand slides up a staff toward its head (px). */
  grip?: number;
  fx?: 'slash' | 'stab' | 'cast' | 'charge' | 'glint';
  /** Cloth/prop phase (0..3). */
  t: number;
}

const REST: Pose = { bob: 0, lean: 0, backFoot: [0, 0], frontFoot: [0, 0], backHand: [0, 0], frontHand: [0, 0], t: 0 };

/** Resolved skeleton for one frame. */
interface Rig {
  L: Look;
  P: Pose;
  /** Upper-body shift. */
  ox: number;
  oy: number;
  /** Head template origin (abs). */
  hx: number;
  hy: number;
  /** Torso box. */
  tx0: number;
  tx1: number;
  ty0: number;
  ty1: number;
  shB: [number, number];
  shF: [number, number];
  hdB: [number, number];
  hdF: [number, number];
  hipB: [number, number];
  hipF: [number, number];
  ankB: [number, number];
  ankF: [number, number];
}

function rig(L: Look, P: Pose): Rig {
  const k = L.child ? 7 : 0; // children: same head, shorter body
  const ox = P.lean;
  const oy = P.bob;
  const hunchX = L.hunch ? 2 : 0;
  const hunchY = L.hunch ? 2 : 0;
  const broad = L.broad ? 1 : 0;
  const tx0 = 15 - broad + (L.child ? 1 : 0) + ox;
  const tx1 = 24 + broad - (L.child ? 1 : 0) + ox;
  const ty0 = 25 + k + oy + (L.hunch ? 1 : 0);
  const ty1 = 35 + oy + (L.child ? 3 : 0);
  const armDrop = L.child ? 4 : 6;
  const shB: [number, number] = [tx0 + 1, ty0 + 2];
  const shF: [number, number] = [tx1 - 1, ty0 + 2];
  const hdB: [number, number] = [shB[0] - 1 + P.backHand[0], shB[1] + armDrop + P.backHand[1]];
  const hdF: [number, number] = [shF[0] + 2 + P.frontHand[0], shF[1] + armDrop + P.frontHand[1]];
  const hipY = (L.child ? 39 : 36) + Math.max(0, oy);
  return {
    L,
    P,
    ox,
    oy,
    hx: 12 + ox + hunchX,
    hy: 9 + k + oy + hunchY + (P.headDy ?? 0),
    tx0,
    tx1,
    ty0,
    ty1,
    shB,
    shF,
    hdB,
    hdF,
    hipB: [17 + Math.round(ox / 2), hipY],
    hipF: [22 + Math.round(ox / 2), hipY],
    ankB: [17 + P.backFoot[0], 43 - P.backFoot[1]],
    ankF: [22 + P.frontFoot[0], 43 - P.frontFoot[1]],
  };
}

// ---------------------------------------------------------------- head

const FACE: readonly string[] = [
  '.................',
  '.................',
  '.................',
  '.....sssssss.....',
  '...sssssssssss...',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..sssssssssssss..',
  '..ssssssssssssS..',
  '..sssssssssssSS..',
  '...ssssssssSSS...',
  '.....SSSSSSS.....',
];

// Hair templates share the face frame (17 x 16, origin = rig.hx/hy). h = hair, H = shadow, l = highlight,
// d = deep shadow. Eyes sit at template (9, 10..11) and (12, 10..11); fringes stay clear of them.
const HAIR: Record<HairStyle, readonly string[]> = {
  tousled: [
    '.......l.........',
    '.....hhlh.hh.....',
    '...hhhhllhhhhh...',
    '..hhhhllhhhhhhh..',
    '.hhhhllhhhhhhhhh.',
    '.hhhhhhhhhhhhhhhh',
    '.Hhhhhhhhhhhhhhhh',
    '.HHhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhHhhH.',
    '.HHHhhhh.hh..h...',
    '.dHHHh...........',
    '..dHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
  ],
  crop: [
    '.................',
    '.................',
    '....hhhhhhhh.....',
    '...hhllllhhhhh...',
    '..hhllhhhhhhhhh..',
    '..hhhhhhhhhhhhhh.',
    '..Hhhhhhhhhhhhhh.',
    '..HHhhhhhhhhhhh..',
    '..HHhhhh.hh.h....',
    '..HHHh...........',
    '..HHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
  spiky: [
    '...l...h...h.....',
    '...hl.hhh.hhh.h..',
    '..hhhlhhhhhhhhh..',
    '.hhhhllhhhhhhhhhh',
    'hhhhhllhhhhhhhhh.',
    '.hhhhhhhhhhhhhhhh',
    'hHhhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhhhhh.',
    '.HHhhhhhhhhHhhhH.',
    '.HHHhhh.hh..h....',
    '.dHHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
  long: [
    '.................',
    '.....hhhhhhh.....',
    '...hhhllllhhhh...',
    '..hhhllhhhhhhhh..',
    '.hhhllhhhhhhhhhh.',
    '.hhhhhhhhhhhhhhhh',
    '.hhhhhhhhhhhhhhhh',
    '.Hhhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhHhh..',
    '.HHhhhhh.hh..h...',
    '.HHHhhh..........',
    '.HHHhh...........',
    '.dHHHh...........',
    '.dHHHh...........',
    '..dHHH...........',
    '..dHHH...........',
  ],
  braid: [
    '.................',
    '.....hhhhhhh.....',
    '...hhhllllhhhh...',
    '..hhhllhhhhhhhh..',
    '.hhhllhhhhhhhhhh.',
    '.hhhhhhhhhhhhhhhh',
    '.Hhhhhhhhhhhhhhhh',
    '.HHhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhhhh..',
    '.HHHhhhhh.hhh....',
    '.dHHHh...........',
    '..dHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
  ],
  bun: [
    '.....hhhh........',
    '....hllhhh.......',
    '....hhhhhH.......',
    '...hhhhhhhhhh....',
    '..hhhllllhhhhh...',
    '.hhhllhhhhhhhhh..',
    '.Hhhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhhh...',
    '.HHHhh...........',
    '..HHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
  pony: [
    '.................',
    '.....hhhhhhh.....',
    '...hhhllllhhhh...',
    '..hhhllhhhhhhhh..',
    '.hhhllhhhhhhhhhh.',
    '.hhhhhhhhhhhhhhhh',
    '.Hhhhhhhhhhhhhhhh',
    '.HHhhhhhhhhhhhhh.',
    '.HHhhhhhhhhHhhh..',
    '.HHHhhh.hh..h....',
    '..HHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
  tuft: [
    '......ll.........',
    '.......hh........',
    '....hhhhhhhh.....',
    '...hhllllhhhhh...',
    '..hhllhhhhhhhhh..',
    '.hhhhhhhhhhhhhhh.',
    '.Hhhhhhhhhhhhhhh.',
    '.HHhhhhhhhhhhhh..',
    '.HHhhhhh.hhh.h...',
    '.HHHh............',
    '..HHH............',
    '..dH.............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
  bald: [
    '.................',
    '.................',
    '.................',
    '.................',
    '.................',
    '.................',
    '.................',
    '.................',
    '.HH..............',
    '.HHh.............',
    '.HHh.............',
    '..H..............',
    '.................',
    '.................',
    '.................',
    '.................',
  ],
};

function paintHead(c: Ctx, R: Rig): void {
  const L = R.L;
  const { hx, hy } = R;
  const sk = ramp(L.skin);
  const hr = ramp(L.hair);
  const P = R.P;

  // Back-of-head hair that falls behind the shoulders.
  if (L.style === 'pony') {
    const sway = P.t % 2 ? 1 : 0;
    tpl(c, hx - 2 - sway, hy + 6, ['.hh..', 'hhhh.', 'hhhH.', 'hhHH.', '.hHH.', '.HHd.', '..Hd.', '..d..'], { h: hr[2], H: hr[1], d: hr[0] });
    rect(c, hx + 1, hy + 6, 2, 2, PAL.crimson);
  }
  tpl(c, hx, hy, FACE, { s: sk[2], S: sk[1] });
  // Hair (hoods and full hats replace it).
  const hidesHair = L.hat === 'hood' || L.hat === 'cowl' || L.hat === 'veil';
  if (!hidesHair) tpl(c, hx, hy, HAIR[L.style], { h: hr[2], H: hr[1], l: hr[3], d: hr[0] });
  if (L.style === 'bald' && !L.hat) {
    px(c, hx + 6, hy + 4, sk[3]);
    px(c, hx + 7, hy + 4, sk[3]);
    px(c, hx + 5, hy + 5, sk[3]);
  }

  if (L.style === 'braid') {
    // braid draped forward over the shoulder, ribbon at the tip
    const sway = P.t % 2;
    for (let i = 0; i < 5; i++) {
      const bx = hx + 4 + (i > 2 ? sway : 0);
      const by = hy + 13 + i * 2;
      rect(c, bx, by, 3, 2, i % 2 ? hr[1] : hr[2]);
      px(c, bx, by, hr[3]);
    }
    rect(c, hx + 4 + sway, hy + 23, 3, 1, PAL.crimson);
    px(c, hx + 5 + sway, hy + 24, hr[1]);
  }

  // Ear (3/4 view: behind the cheek, at the hair line).
  if (!hidesHair) {
    px(c, hx + 5, hy + 10, sk[2]);
    px(c, hx + 5, hy + 11, sk[1]);
    px(c, hx + 6, hy + 11, sk[2]);
  }

  // Face.
  const eye = L.eye ?? EYE;
  rect(c, hx + 9, hy + 10, 1, 2, eye);
  rect(c, hx + 12, hy + 10, 1, 2, eye);
  if (L.blush ?? true) {
    px(c, hx + 8, hy + 12, BLUSH);
    px(c, hx + 13, hy + 12, BLUSH);
  }
  if (!L.beard && !L.mask) px(c, hx + 11, hy + 13, sk[1]);

  if (L.glasses) {
    const g = GOLD[1];
    rect(c, hx + 8, hy + 9, 3, 1, g);
    rect(c, hx + 11, hy + 9, 3, 1, g);
    px(c, hx + 8, hy + 10, g);
    px(c, hx + 8, hy + 11, g);
    rect(c, hx + 8, hy + 12, 3, 1, g);
    rect(c, hx + 11, hy + 12, 3, 1, g);
    px(c, hx + 14, hy + 10, g);
    px(c, hx + 14, hy + 11, g);
    px(c, hx + 10, hy + 10, '#d8eef6');
    px(c, hx + 13, hy + 10, '#d8eef6');
  }
  if (L.mustache) {
    const m = ramp(L.mustache);
    rect(c, hx + 9, hy + 13, 6, 1, m[2]);
    px(c, hx + 8, hy + 14, m[1]);
    px(c, hx + 14, hy + 14, m[1]);
    px(c, hx + 10, hy + 13, m[3]);
  }
  if (L.beard) {
    const b = ramp(L.beard);
    const sway = P.t % 2;
    const long = L.hunch;
    tpl(
      c,
      hx + 3,
      hy + 12,
      long
        ? ['hh.......hh.', 'hhhhhhhhhhhh', '.hhhhllhhhhh', '..hhhhhhhhH.', '...hhhhhhH..', '....hhhhH...', '.....hhH....', '......H.....']
        : ['hh.......hh.', 'hhh.hhh.hhhh', '.hhhhllhhhhh', '..hhhhhhhhH.', '...hhhhhhH..', '.....HHH....'],
      { h: b[2], H: b[1], l: b[3] },
    );
    if (sway) px(c, hx + (long ? 9 : 8), hy + (long ? 19 : 17), b[1]);
    rect(c, hx + 10, hy + 13, 3, 1, b[1]); // mouth line in the beard
  }
  if (L.mask) {
    const m = ramp(L.mask);
    rect(c, hx + 6, hy + 12, 9, 3, m[2]);
    rect(c, hx + 7, hy + 15, 6, 1, m[1]);
    rect(c, hx + 6, hy + 12, 9, 1, m[3]);
    px(c, hx + 14, hy + 13, m[1]);
    px(c, hx + 14, hy + 14, m[1]);
  }

  paintHat(c, R);
}

function paintHat(c: Ctx, R: Rig): void {
  const L = R.L;
  if (!L.hat) return;
  const { hx, hy } = R;
  const base = L.hatColor ?? '#5a4a6a';
  const h = ramp(base);
  const trim = L.hatTrim ?? GOLD[2];
  const t = R.P.t;
  switch (L.hat) {
    case 'wizard': {
      // Floppy pointed hat: wide brim, cone leaning back, tip flopping behind.
      trap(c, hy + 6, hy + 7, hx - 2, hx + 18, hx - 3, hx + 19, h[2]);
      rect(c, hx - 3, hy + 7, 23, 1, h[1]);
      rect(c, hx - 1, hy + 6, 8, 1, h[3]);
      trap(c, hy - 3, hy + 5, hx + 6, hx + 9, hx + 2, hx + 14, h[2]);
      trap(c, hy - 3, hy + 5, hx + 9, hx + 9, hx + 11, hx + 14, h[1]);
      trap(c, hy - 2, hy + 5, hx + 6, hx + 6, hx + 3, hx + 4, h[3]);
      const flop = t % 2;
      trap(c, hy - 6 + flop, hy - 3, hx + 3 - flop, hx + 6, hx + 5, hx + 9, h[2]);
      rect(c, hx + 1 - flop, hy - 6 + flop, 3, 2, h[2]);
      px(c, hx - flop, hy - 5 + flop, h[1]);
      rect(c, hx + 2, hy + 3, 12, 2, trim);
      px(c, hx + 9, hy + 3, GOLD[3]);
      px(c, hx + 10, hy + 2, '#bfe8ff');
      break;
    }
    case 'hood':
    case 'cowl': {
      // Hood framing the face with a point at the back.
      const cowl = L.hat === 'cowl';
      tpl(
        c,
        hx - 1,
        hy + 1,
        [
          '.....hhhhhhh.......',
          '...hhhhhhhhhhh.....',
          '..hhhllhhhhhhhhh...',
          '.hhhllhhhhhhhhhhh..',
          'hhhlhhhhhhhhhhhhhh.',
          'hhhhhhhhhhhhhhhhhh.',
          'hhhhhhhhhhHHHHHHhh.',
          'Hhhhhhhhhh......Hh.',
          'HHhhhhhhH........H.',
          'HHhhhhhhH..........',
          'HHHhhhhhH..........',
          'dHHhhhhH...........',
          'dHHHhhhH...........',
          '.dHHHHH............',
          '..dddd.............',
        ],
        { h: h[2], H: h[1], l: h[3], d: h[0] },
      );
      if (!cowl) tpl(c, hx - 4, hy + 5, ['.hh', 'hhh', 'hhH', '.HH', '..d'], { h: h[2], H: h[1], d: h[0] });
      // fringe peeking out
      if (L.style !== 'bald') {
        const hr = ramp(L.hair);
        rect(c, hx + 9, hy + 7, 6, 1, hr[1]);
        px(c, hx + 10, hy + 8, hr[1]);
        px(c, hx + 13, hy + 8, hr[1]);
      }
      if (L.hatTrim) rect(c, hx + 8, hy + 6, 8, 1, L.hatTrim);
      break;
    }
    case 'veil': {
      // Priestess: white veil to the shoulders, golden circlet with a sun gem.
      tpl(
        c,
        hx - 1,
        hy + 1,
        [
          '.....hhhhhhh.......',
          '...hhhhhhhhhhh.....',
          '..hhllhhhhhhhhh....',
          '.hhllhhhhhhhhhhh...',
          'hhlhhhhhhhhhhhhhh..',
          'hhhhhhhhhhhhhhhhh..',
          'hhhhhhhhhhhhhhhhh..',
          'hhhhhhhhh.........',
          'hhhhhhhH..........',
          'hhhhhhhH..........',
          'hhhhhhhH..........',
          'Hhhhhhhh..........',
          'HHhhhhhh..........',
          'HHhhhhhhH.........',
          'dHHhhhhhH.........',
          '.dHHHHHH..........',
        ],
        { h: h[2], H: h[1], l: h[3], d: h[0] },
      );
      rect(c, hx + 6, hy + 6, 11, 1, trim);
      px(c, hx + 12, hy + 5, GOLD[3]);
      px(c, hx + 12, hy + 6, PAL.crimson);
      const hr = ramp(L.hair);
      rect(c, hx + 8, hy + 7, 7, 1, hr[2]);
      px(c, hx + 9, hy + 8, hr[1]);
      px(c, hx + 14, hy + 8, hr[1]);
      break;
    }
    case 'straw': {
      // Fisher: broad flat-topped straw hat with a ribbon, brim tilted down at the front.
      const s = ramp(base);
      rect(c, hx + 3, hy + 1, 11, 5, s[2]);
      rect(c, hx + 3, hy + 1, 11, 1, s[3]);
      rect(c, hx + 11, hy + 2, 3, 4, s[1]);
      rect(c, hx + 3, hy + 4, 11, 2, trim);
      trap(c, hy + 6, hy + 7, hx - 2, hx + 18, hx - 3, hx + 19, s[2]);
      rect(c, hx - 3, hy + 8, 23, 1, s[1]);
      rect(c, hx - 1, hy + 6, 7, 1, s[3]);
      for (let i = 0; i < 5; i++) px(c, hx + i * 4, hy + 7, s[1]);
      break;
    }
    case 'shako': {
      // Drillmaster: tall drill cap, visor, plume.
      rect(c, hx + 3, hy - 1, 11, 7, h[2]);
      rect(c, hx + 3, hy - 1, 3, 7, h[3]);
      rect(c, hx + 11, hy - 1, 3, 7, h[1]);
      rect(c, hx + 3, hy - 1, 11, 1, trim);
      rect(c, hx + 3, hy + 5, 11, 1, trim);
      rect(c, hx + 8, hy + 1, 2, 3, GOLD[2]);
      px(c, hx + 8, hy + 1, GOLD[3]);
      rect(c, hx + 9, hy + 6, 8, 2, '#2e2a30');
      rect(c, hx + 9, hy + 6, 6, 1, '#4a4450');
      const sway = t % 2;
      tpl(c, hx + 4 - sway, hy - 7, ['..rr', '.rRr', 'rRr.', 'rr..', 'rr..', '.r..', '.w..'], { r: PAL.crimson, R: '#e0505a', w: '#efe6c8' });
      break;
    }
    case 'cap': {
      // Quartermaster: soft field cap with a forward visor.
      rect(c, hx + 2, hy + 2, 13, 4, h[2]);
      rect(c, hx + 4, hy + 1, 9, 1, h[2]);
      rect(c, hx + 3, hy + 2, 5, 1, h[3]);
      rect(c, hx + 11, hy + 2, 4, 4, h[1]);
      rect(c, hx + 2, hy + 6, 13, 1, trim);
      rect(c, hx + 12, hy + 6, 6, 2, h[0]);
      rect(c, hx + 12, hy + 6, 5, 1, h[1]);
      break;
    }
    case 'miner': {
      // Dome helmet, brim, lamp (flickers on frame 1).
      const m = ramp(base);
      rect(c, hx + 3, hy + 1, 11, 6, m[2]);
      rect(c, hx + 5, hy, 7, 1, m[2]);
      rect(c, hx + 2, hy + 3, 1, 4, m[2]);
      rect(c, hx + 14, hy + 3, 1, 4, m[1]);
      rect(c, hx + 4, hy + 1, 4, 2, m[3]);
      rect(c, hx + 11, hy + 1, 3, 6, m[1]);
      rect(c, hx, hy + 7, 18, 1, m[0]);
      rect(c, hx + 1, hy + 6, 17, 1, m[1]);
      rect(c, hx + 12, hy + 2, 4, 4, '#4a4d55');
      rect(c, hx + 13, hy + 3, 2, 2, t % 2 ? '#fff6c0' : '#ffe27a');
      break;
    }
    case 'feather': {
      // Scout: slouched cap with a long feather.
      rect(c, hx + 2, hy + 2, 13, 4, h[2]);
      rect(c, hx + 4, hy + 1, 8, 1, h[2]);
      rect(c, hx + 3, hy + 2, 4, 1, h[3]);
      rect(c, hx + 12, hy + 3, 3, 3, h[1]);
      rect(c, hx + 1, hy + 6, 16, 1, h[0]);
      rect(c, hx + 2, hy + 5, 14, 1, trim);
      const f = t % 2;
      tpl(c, hx - 3, hy - 1 + f, ['cc......', '.ccc....', '..cccr..', '....crr.', '......rr'], { c: PAL.cream, r: PAL.crimson });
      break;
    }
    case 'goggles': {
      // Wayfinder: goggles pushed up on the forehead.
      rect(c, hx + 3, hy + 6, 13, 1, '#5c3d22');
      rect(c, hx + 7, hy + 4, 4, 3, GOLD[1]);
      rect(c, hx + 12, hy + 4, 4, 3, GOLD[1]);
      rect(c, hx + 8, hy + 5, 2, 1, t % 2 ? '#bfe8ff' : '#8cc6e6');
      rect(c, hx + 13, hy + 5, 2, 1, t % 2 ? '#bfe8ff' : '#8cc6e6');
      break;
    }
    case 'circlet': {
      rect(c, hx + 4, hy + 6, 12, 1, trim);
      px(c, hx + 11, hy + 5, '#bffcff');
      px(c, hx + 11, hy + 6, t % 2 ? '#ffffff' : '#7ff0ff');
      break;
    }
    case 'bandana': {
      rect(c, hx + 2, hy + 4, 14, 3, h[2]);
      rect(c, hx + 2, hy + 4, 14, 1, h[3]);
      const f = t % 2;
      tpl(c, hx - 2, hy + 5 + f, ['hhh', '.hH', '..H'], { h: h[2], H: h[1] });
      break;
    }
  }
}

// ---------------------------------------------------------------- body

function paintBack(c: Ctx, R: Rig): void {
  const L = R.L;
  const { tx0, ty0 } = R;
  const t = R.P.t;
  if (L.cape) {
    const cp = ramp(L.cape);
    const flow = [0, 1, 2, 1][t % 4];
    const bottom = L.child ? 42 : 41;
    trap(c, ty0 + 1, bottom, tx0 + 1, tx0 + 6, tx0 - 2 - flow, tx0 + 5, cp[1]);
    trap(c, ty0 + 1, bottom - 1, tx0 + 1, tx0 + 3, tx0 - 1 - flow, tx0 + 1, cp[2]);
    rect(c, tx0 - 2 - flow, bottom, 3, 1, cp[0]);
  }
  if (L.scarf) {
    const s = ramp(L.scarf);
    const f = [0, 1, 2, 1][t % 4];
    const sx = tx0 + 1;
    const sy = ty0 + 1;
    // two cloth tails streaming back, fluttering with the phase
    tpl(c, sx - 7, sy - 1 + (f > 1 ? 1 : 0), f % 2 ? ['....lmmm', '.mmmmmmd', 'mmdd.dd.', 'd.......'] : ['.....lmm', '..mmmmmd', 'mmmd.dd.', '.dd.....'], {
      l: s[3],
      m: s[2],
      d: s[1],
    });
  }
  if (L.mask) {
    const m = ramp(L.mask);
    const f = t % 2;
    tpl(c, R.hx - 4, R.hy + 11 + f, f ? ['.mmm', 'mmd.', 'd...'] : ['..mm', 'mmmd', '.dd.'], { m: m[2], d: m[1] });
  }
  if (L.back === 'pack') {
    const p = ramp('#7d5530');
    rect(c, tx0 - 4, ty0 + 1, 6, 9, p[2]);
    rect(c, tx0 - 4, ty0 + 1, 6, 2, p[3]);
    rect(c, tx0 - 4, ty0 + 8, 6, 2, p[1]);
    rect(c, tx0 - 5, ty0 + 4, 2, 4, p[1]);
    // bedroll on top
    rect(c, tx0 - 5, ty0 - 2, 8, 3, '#8a6cc0');
    rect(c, tx0 - 5, ty0 - 2, 8, 1, '#a88ad8');
    px(c, tx0 - 2, ty0 - 1, '#5a4480');
  }
  if (L.back === 'quiver') {
    // hip quiver slung behind, fletchings poking out at the back
    const q = ramp('#7d5530');
    const qx = tx0 - 3;
    const qy = ty0 + 3;
    for (let i = 0; i < 9; i++) rect(c, qx + Math.floor(i / 3), qy + i, 3, 1, i < 1 ? q[3] : i % 4 === 3 ? q[1] : q[2]);
    tpl(c, qx - 3, qy - 3, ['c..r', 'cc.r', '.cbr', '..b.'], { c: PAL.cream, r: PAL.crimson, b: LEATHER[1] });
  }
  if (L.back === 'scrolls') {
    const q = ramp('#5c3d22');
    rect(c, tx0 - 4, ty0 - 3, 5, 14, q[2]);
    rect(c, tx0 - 4, ty0 - 3, 1, 14, q[3]);
    rect(c, tx0 - 4, ty0 + 3, 5, 1, GOLD[1]);
    rect(c, tx0 - 3, ty0 - 6, 2, 3, PAL.cream);
    rect(c, tx0 - 1, ty0 - 5, 2, 2, '#e0d0a8');
    px(c, tx0 - 3, ty0 - 6, '#ffffff');
  }
}

function paintLeg(c: Ctx, R: Rig, front: boolean): void {
  const L = R.L;
  const hip = front ? R.hipF : R.hipB;
  const ank = front ? R.ankF : R.ankB;
  const lg = ramp(L.legs);
  const bt = ramp(L.boots);
  const legCol = front ? lg[2] : lg[1];
  cap(c, hip[0], hip[1], ank[0], ank[1] - 1, 1, legCol);
  if (front) cap(c, hip[0] - 1, hip[1], ank[0] - 1, ank[1] - 2, 0, lg[3]);
  // boot: 5 long, toe pointing right, sole row darker
  const [ax, ay] = ank;
  rect(c, ax - 1, ay, 4, 3, front ? bt[2] : bt[1]);
  rect(c, ax + 3, ay + 1, 1, 2, front ? bt[2] : bt[1]);
  rect(c, ax - 1, ay, 3, 1, front ? bt[3] : bt[2]);
  rect(c, ax - 1, ay + 2, 5, 1, bt[0]);
}

function paintTorso(c: Ctx, R: Rig): void {
  const L = R.L;
  const { tx0, tx1, ty0, ty1 } = R;
  const tp = ramp(L.top);
  const w = tx1 - tx0 + 1;
  if (L.robe) {
    const hem = L.robe + Math.min(0, R.oy);
    const sway = [0, 1, 0, -1][R.P.t % 4];
    trap(c, ty0 + 1, hem, tx0, tx1, tx0 - 2 + Math.min(0, sway), tx1 + 2 + Math.max(0, sway), tp[2]);
    trap(c, ty0 + 1, hem, tx1 - 2, tx1, tx1 - 1 + Math.max(0, sway), tx1 + 2 + Math.max(0, sway), tp[1]);
    trap(c, ty0 + 2, hem - 1, tx0, tx0, tx0 - 1, tx0 - 1, tp[3]);
    rect(c, tx0 + 1, ty0, w - 2, 1, tp[2]);
    // fold lines
    for (let y = ty1 + 1; y <= hem - 1; y++) {
      px(c, tx0 + 3 + Math.round((y - ty1) * -0.3), y, tp[1]);
      px(c, tx0 + 7 + Math.round((y - ty1) * 0.25), y, tp[1]);
    }
    rect(c, tx0 - 2 + Math.min(0, sway), hem, w + 4 + Math.abs(sway), 1, tp[0]);
    if (L.trim) {
      rect(c, tx0 - 1 + Math.min(0, sway), hem - 1, w + 2 + Math.abs(sway), 1, L.trim);
      rect(c, tx0 + 5, ty0 + 1, 1, hem - ty0 - 2, L.trim);
    }
  } else {
    rect(c, tx0 + 1, ty0, w - 2, 1, tp[2]);
    rect(c, tx0, ty0 + 1, w, ty1 - ty0, tp[2]);
    rect(c, tx1 - 1, ty0 + 1, 2, ty1 - ty0, tp[1]);
    rect(c, tx0, ty0 + 2, 1, ty1 - ty0 - 3, tp[3]);
    // tunic skirt flares a touch
    rect(c, tx0 - 1, ty1 - 1, w + 2, 2, tp[2]);
    rect(c, tx1, ty1 - 1, 2, 2, tp[1]);
    rect(c, tx0 - 1, ty1, w + 2, 1, tp[1]);
    if (L.trim) {
      rect(c, tx0 - 1, ty1, w + 2, 1, L.trim);
      rect(c, tx0 + 5, ty0 + 1, 1, ty1 - ty0 - 1, L.trim);
    }
  }
  // collar / neck shadow
  rect(c, tx0 + 3, ty0, w - 5, 1, tp[0]);
  if (L.trim) rect(c, tx0 + 3, ty0 + 1, w - 5, 1, L.trim);

  if (L.apron) {
    const a = ramp(L.apron);
    const bottom = ty1 + 3;
    rect(c, tx0 + 2, ty0 + 3, w - 3, bottom - ty0 - 3, a[2]);
    rect(c, tx0 + 2, ty0 + 3, w - 3, 1, a[3]);
    rect(c, tx1 - 1, ty0 + 3, 1, bottom - ty0 - 3, a[1]);
    rect(c, tx0 + 3, ty0 + 1, 1, 2, a[1]);
    rect(c, tx1 - 2, ty0 + 1, 1, 2, a[1]);
    rect(c, tx0 + 4, ty0 + 7, 4, 3, a[1]); // pocket
    px(c, tx0 + 5, ty0 + 8, GOLD[1]);
  }
  if (L.sash) {
    const s = ramp(L.sash);
    for (let i = 0; i <= ty1 - ty0 - 2; i++) {
      const x = tx0 + Math.round((i * (w - 1)) / (ty1 - ty0 - 2));
      rect(c, x, ty0 + 1 + i, 2, 1, s[2]);
      px(c, x, ty0 + 1 + i, s[3]);
    }
  }
  if (L.belt) {
    const by = ty1 - 3;
    rect(c, tx0, by, w, 2, L.belt);
    rect(c, tx0, by, w, 1, shade(L.belt, 18));
    const bk = L.buckle ?? GOLD[2];
    rect(c, tx0 + 5, by, 2, 2, bk);
    // pouch
    rect(c, tx0 + 1, by + 2, 3, 2, shade(L.belt, -10));
  }
  if (L.emblem) {
    const ex = tx0 + 5;
    const ey = ty0 + 4;
    px(c, ex, ey, L.emblem);
    rect(c, ex - 1, ey + 1, 3, 1, L.emblem);
    px(c, ex, ey + 2, L.emblem);
    px(c, ex, ey + 1, '#ffffff');
  }
  if (L.scarf) {
    const s = ramp(L.scarf);
    rect(c, tx0 + 1, ty0 - 1, w - 2, 3, s[2]);
    rect(c, tx0 + 1, ty0 - 1, w - 2, 1, s[3]);
    rect(c, tx1 - 2, ty0, 2, 2, s[1]);
    rect(c, tx0 + 2, ty0 + 2, 2, 3, s[1]);
    px(c, tx0 + 2, ty0 + 2, s[2]);
  }
  if (L.cape) {
    const cp = ramp(L.cape);
    // mantle over the shoulders
    rect(c, tx0, ty0, w, 3, cp[2]);
    rect(c, tx0, ty0, w, 1, cp[3]);
    rect(c, tx1 - 2, ty0 + 1, 3, 2, cp[1]);
    px(c, tx0 + 5, ty0 + 2, GOLD[2]);
  }
  if (L.back === 'pack') {
    const st = LEATHER[1];
    rect(c, tx0 + 1, ty0 + 1, 2, ty1 - ty0 - 3, st);
    px(c, tx0 + 1, ty0 + 5, GOLD[1]);
  }

}

function paintArm(c: Ctx, R: Rig, front: boolean): void {
  const L = R.L;
  const sh = front ? R.shF : R.shB;
  const hd = front ? R.hdF : R.hdB;
  const sl = ramp(L.sleeves ?? L.top);
  const sk = ramp(L.skin);
  const col = front ? sl[2] : sl[1];
  // sleeve to the wrist, then the fist
  const dx = hd[0] - sh[0];
  const dy = hd[1] - sh[1];
  const len = Math.max(1, Math.hypot(dx, dy));
  const wx = hd[0] - (dx / len) * 1.5;
  const wy = hd[1] - (dy / len) * 1.5;
  cap(c, sh[0], sh[1], wx, wy, 1, col);
  if (front) px(c, sh[0] - 1, sh[1] - 1, sl[3]);
  cap(c, hd[0], hd[1], hd[0], hd[1], 1, front ? sk[2] : sk[1]);
  if (front) px(c, hd[0] - 1, hd[1] - 1, sk[3]);
  if (front && L.pauldron) {
    const p = ramp(L.pauldron);
    tpl(c, sh[0] - 2, sh[1] - 1, ['.llll.', 'lppppP', '.P.P.P'], { l: p[3], p: p[2], P: p[1] });
  }
  if (front && L.broad && !L.pauldron && L.sleeves === L.skin) {
    // bare-armed: a hint of muscle
    px(c, sh[0] + 1, sh[1] + 1, sk[1]);
  }
}

// ---------------------------------------------------------------- props & weapons

/** Where a prop sits relative to the front hand, and whether it is painted over the arm. */
function paintProp(c: Ctx, R: Rig, over: boolean): void {
  const L = R.L;
  const P = R.P;
  const [hx, hy] = R.hdF;
  const t = P.t;
  switch (L.prop) {
    case 'sword': {
      if (over) return;
      const ang = P.ang ?? -1.15;
      const Lb = 16;
      along(c, hx, hy, ang, -4.2, Lb + 0.5, 3.5, (a, s) => {
        if (a < -2.6) return Math.abs(s) <= 1.1 ? (s < 0 ? GOLD[3] : GOLD[1]) : null; // pommel
        if (a < 1.2) return Math.abs(s) <= 0.6 ? (Math.floor(a + 3) % 2 ? LEATHER[2] : LEATHER[1]) : null; // grip
        if (a < 2.4) return Math.abs(s) <= 3.1 ? (s < -0.4 ? GOLD[3] : s > 1.6 ? GOLD[1] : GOLD[2]) : null; // guard
        const hw = a > Lb - 3 ? 0.35 + (Lb + 0.5 - a) * 0.38 : 1.25;
        if (Math.abs(s) > hw) return null;
        if (s < -0.45) return STEEL[3];
        if (s > 0.45) return STEEL[1];
        return a < Lb - 4 && a > 4 ? '#9aa6b4' : STEEL[2]; // fuller
      });
      return;
    }
    case 'dagger': {
      if (over) return;
      const ang = P.ang ?? -0.62;
      along(c, hx, hy, ang, -2.6, 9.5, 2.6, (a, s) => {
        if (a < -1.6) return Math.abs(s) <= 0.9 ? GOLD[2] : null;
        if (a < 1) return Math.abs(s) <= 0.6 ? LEATHER[2] : null;
        if (a < 2) return Math.abs(s) <= 2.2 ? (s < 0 ? '#9c8ad0' : '#5a4480') : null;
        const hw = a > 6 ? 0.3 + (9.5 - a) * 0.3 : 1.1;
        if (Math.abs(s) > hw) return null;
        return s < -0.3 ? STEEL[3] : s > 0.4 ? STEEL[1] : STEEL[2];
      });
      return;
    }
    case 'staff': {
      if (over) return;
      const ang = P.ang ?? -1.42;
      const len = 20 - (P.grip ?? 0);
      along(c, hx, hy, ang, len - 29, len - 3, 1, (a, s) => {
        if (Math.abs(s) > 0.6) return null;
        if (a > len - 6) return GOLD[a > len - 5 ? 2 : 1];
        return Math.floor(a - len) % 6 === 0 ? LEATHER[3] : s < 0 ? LEATHER[2] : LEATHER[1];
      });
      const [ox, oy] = axisPt(hx, hy, ang, len);
      // orb in a claw
      const orb = ['#25507a', '#3f8fd0', '#7fd6ff', '#e8fbff'];
      cap(c, ox, oy, ox, oy, 2.2, orb[1]);
      cap(c, ox - 0.5, oy - 0.5, ox - 0.5, oy - 0.5, 1.3, orb[2]);
      px(c, ox - 1, oy - 1, orb[3]);
      px(c, ox + 1, oy + 2, orb[0]);
      px(c, ox + 2, oy + 1, orb[0]);
      const [cx1, cy1] = axisPt(hx, hy, ang, len - 3);
      px(c, cx1 - 2, cy1, GOLD[2]);
      px(c, cx1 + 2, cy1, GOLD[1]);
      return;
    }
    case 'hammer': {
      if (over) return;
      // smith's hammer held head-up: wooden haft, square steel head with a dark striking face
      const ang = P.ang ?? -1.5;
      along(c, hx, hy, ang, -2, 9, 1, (_a, s) => (Math.abs(s) <= 0.6 ? (s < 0 ? LEATHER[3] : LEATHER[2]) : null));
      const [kx, ky] = axisPt(hx, hy, ang, 11);
      tpl(c, kx - 4, ky - 2, ['.lllllll.', 'SlssssssD', 'SssssssSD', 'SSSSSSSSD', '...bb....'], {
        l: STEEL[3],
        s: STEEL[2],
        S: STEEL[1],
        D: STEEL[0],
        b: LEATHER[1],
      });
      return;
    }
    case 'sunstaff': {
      if (over) return;
      const sx = hx + 1;
      rect(c, sx, hy - 18, 1, 28, '#efe6c8');
      rect(c, sx + 1, hy - 18, 1, 28, '#c2b18a');
      const cy = hy - 21;
      // sun disc + rays
      cap(c, sx + 0.5, cy, sx + 0.5, cy, 2.6, GOLD[2]);
      cap(c, sx + 0.5, cy, sx + 0.5, cy, 1.2, GOLD[3]);
      const rays = t % 2 ? [[0, -5], [0, 5], [-5, 0], [5, 0]] : [[-4, -4], [4, -4], [-4, 4], [4, 4]];
      for (const [dx, dy] of rays) {
        px(c, sx + dx + (dx > 0 ? 1 : 0), cy + dy, GOLD[2]);
        px(c, sx + Math.sign(dx) * 3 + (dx > 0 ? 1 : 0), cy + Math.sign(dy) * 3, GOLD[1]);
      }
      return;
    }
    case 'walkstick': {
      if (over) return;
      const sx = hx + 2;
      // gnarled stick to the ground, knob on top
      for (let y = hy - 6; y <= 45; y++) px(c, sx + (y > hy + 4 ? 1 : 0) + (y === hy - 2 ? -1 : 0), y, y % 4 ? LEATHER[2] : LEATHER[1]);
      rect(c, sx - 1, hy - 9, 3, 3, LEATHER[3]);
      px(c, sx - 1, hy - 9, '#b88a50');
      px(c, sx + 2, hy - 5, '#548540');
      px(c, sx + 3, hy - 6, '#74a655');
      return;
    }
    case 'rod': {
      if (over) return;
      // long rod up and forward, line drooping to a bobber
      const tipX = 37;
      const tipY = 6 + (t % 2);
      cap(c, hx, hy + 1, hx + 4, hy - 8, 0.6, LEATHER[2]);
      cap(c, hx + 4, hy - 8, tipX, tipY, 0, '#9c6d3e');
      px(c, hx + 2, hy - 3, '#c2b18a');
      px(c, hx + 1, hy - 2, '#5c5c64');
      // line (no outline painted later in fx); bobber here
      return;
    }
    case 'baton': {
      if (!over) return;
      const ang = t % 2 ? -0.35 : -0.95;
      along(c, hx, hy, ang, -1.5, 10, 1.4, (a, s) => {
        if (Math.abs(s) > (a > 8.5 ? 1.2 : 0.6)) return null;
        if (a > 8.5) return GOLD[2];
        if (a < 1) return '#2e2a30';
        return s < 0 ? '#d8a868' : '#a87a40';
      });
      return;
    }
    case 'ledger': {
      if (!over) return;
      // clipboard held against the chest; pencil in the other hand moves on frame 1
      const bx = R.tx1 - 5;
      const by = R.ty0 + 3;
      rect(c, bx, by, 8, 10, LEATHER[2]);
      rect(c, bx + 1, by + 1, 6, 8, PAL.cream);
      rect(c, bx + 2, by - 1, 4, 2, STEEL[2]);
      for (let i = 0; i < 3; i++) rect(c, bx + 2, by + 3 + i * 2, i === 2 && t % 2 ? 2 : 4, 1, '#8a7a5a');
      px(c, bx + 6, by + 3 + (t % 2) * 2, PAL.crimson);
      return;
    }
    case 'waystaff': {
      if (over) return;
      const sx = hx + 1;
      rect(c, sx, hy - 16, 2, 28, '#5a4a6a');
      rect(c, sx, hy - 16, 1, 28, '#7a6a8a');
      rect(c, sx - 2, hy - 17, 6, 2, '#3a3040');
      // crystal
      const cy = hy - 22;
      tpl(c, sx - 2, cy - 1, ['..b..', '.bBc.', 'bBBcc', 'bBBcc', '.Bcc.', '..c..'], { b: '#bffcff', B: '#7ff0ff', c: '#3fb8d0' });
      return;
    }
    case 'book': {
      if (!over) return;
      // open book held in both hands
      const bx = R.tx1 - 6;
      const by = R.ty0 + 5;
      rect(c, bx, by, 11, 7, '#6a2a3a');
      rect(c, bx + 1, by, 9, 6, PAL.cream);
      rect(c, bx + 5, by, 1, 6, '#c2b18a');
      for (let i = 0; i < 2; i++) {
        rect(c, bx + 2, by + 2 + i * 2, 2, 1, '#8a7a5a');
        rect(c, bx + 7, by + 2 + i * 2, 2, 1, '#8a7a5a');
      }
      if (t % 2) {
        // page mid-turn
        rect(c, bx + 6, by - 2, 3, 3, '#ffffff');
        px(c, bx + 6, by - 2, '#c2b18a');
      }
      return;
    }
    case 'scroll': {
      if (!over) return;
      const bx = R.tx1 - 4;
      const by = R.ty0 + 4;
      const open = t % 2 ? 9 : 7;
      rect(c, bx, by, 6, open, PAL.cream);
      rect(c, bx, by, 1, open, '#ffffff');
      rect(c, bx - 1, by - 1, 8, 2, '#9c6d3e');
      rect(c, bx - 1, by + open - 1, 8, 2, '#9c6d3e');
      for (let i = 0; i < Math.floor(open / 2) - 1; i++) rect(c, bx + 1, by + 2 + i * 2, 4, 1, '#8a7a5a');
      px(c, bx + 6, by + 3, PAL.crimson);
      return;
    }
    case 'compass': {
      if (!over) return;
      const cx = hx + 1;
      const cy = hy - 3;
      cap(c, cx, cy, cx, cy, 2.3, GOLD[1]);
      cap(c, cx, cy, cx, cy, 1.4, '#2a2440');
      px(c, cx - 2, cy - 2, GOLD[3]);
      if (t % 2) {
        px(c, cx + 1, cy - 1, '#e0788a');
        px(c, cx - 1, cy + 1, '#d8eef6');
      } else {
        px(c, cx, cy - 1, '#e0788a');
        px(c, cx, cy + 1, '#d8eef6');
      }
      px(c, cx, cy, GOLD[3]);
      return;
    }
    case 'kite': {
      if (over) return;
      const kx = 33;
      const ky = 7 - (t % 2);
      tpl(c, kx - 4, ky - 5, ['....y....', '...yyr...', '..yyyrr..', '.yyyyrrr.', 'bbbbsrrrr', '.bbbsrrr.', '..bbsrr..', '...bsr...', '....s....'], {
        y: '#e9c46a',
        r: PAL.crimson,
        b: '#4a92c4',
        s: '#efe6c8',
      });
      return;
    }
    case 'pickaxe': {
      if (over) return;
      // carried over the shoulder: haft runs up behind the head, the pick pokes out at the back
      const ang = -2.42 + (t % 2) * 0.05;
      const len = 18;
      along(c, hx, hy, ang, -2, len, 1, (_a, s) => (Math.abs(s) <= 0.6 ? (s < 0 ? LEATHER[3] : LEATHER[2]) : null));
      const [px0, py0] = axisPt(hx, hy, ang, len);
      tpl(c, px0 - 4, py0 - 3, ['..lsss..', '.sSSSSs.', 'sS.ss.Ss', 'S..bb..S', 'S......S'], {
        l: STEEL[3],
        s: STEEL[2],
        S: STEEL[1],
        b: LEATHER[1],
      });
      return;
    }
    case 'bow': {
      if (over) return;
      // longbow held upright in front, string toward the body
      const bx = hx + 2;
      const top = hy - 13;
      const bot = hy + 9;
      for (let y = top; y <= bot; y++) {
        const d = Math.abs(y - hy) / ((bot - top) / 2);
        const x = bx + Math.round(2.6 * (1 - d * d));
        px(c, x, y, y % 5 === 0 ? LEATHER[3] : LEATHER[2]);
        if (Math.abs(y - hy) > 2) px(c, x + 1, y, LEATHER[1]);
      }
      rect(c, bx - 1, top, 2, 1, PAL.cream);
      rect(c, bx - 1, bot, 2, 1, PAL.cream);
      return;
    }
  }
}

/** Unoutlined effects painted before the body (motion streaks trail behind the character). */
function paintFxBack(c: Ctx, R: Rig): void {
  if (R.P.fx !== 'stab') return;
  const y = R.hdF[1];
  for (const [dy, x0, x1] of [[-4, 2, 11], [-1, 0, 9], [2, 3, 12]] as const)
    for (let x = x0; x <= x1; x++) px(c, x, y + dy, x > x1 - 3 ? '#ffffff' : '#d8eef6');
}

/** Unoutlined finishing touches: lines, smears, glints. */
function paintFx(c: Ctx, R: Rig): void {
  const L = R.L;
  const P = R.P;
  const [hx, hy] = R.hdF;
  if (L.prop === 'rod') {
    const tipX = 37;
    const tipY = 6 + (P.t % 2);
    const bobY = 30 - (P.t % 2);
    for (let y = tipY + 1; y < bobY; y++) px(c, tipX + (y > tipY + 12 ? 1 : 0), y, '#d6ccaa');
    rect(c, tipX, bobY, 2, 2, PAL.crimson);
    px(c, tipX, bobY + 2, '#efe6c8');
  }
  if (L.prop === 'kite') {
    const kx = 33;
    const ky = 7 - (P.t % 2);
    for (let i = 1; i < 12; i++) {
      const yy = ky + 4 + i * 2;
      const xx = kx - Math.round(i * 0.55) + (P.t % 2 && i > 6 ? 1 : 0);
      if (yy < hy - 1) px(c, xx, yy, '#e6dcbc');
    }
    // tail ribbons
    const w = P.t % 2;
    tpl(c, kx - 1, ky + 4, ['.r', 'r.', '.' + (w ? 'r' : '.') + (w ? '' : 'r'), w ? 'b.' : '.b', w ? '.b' : 'b.'], { r: PAL.crimson, b: '#4a92c4' });
  }
  if (L.prop === 'waystaff') {
    const sx = hx + 1;
    const cy = hy - 22;
    const pts = P.t % 2 ? [[-3, -3], [4, 1], [-2, 4]] : [[3, -3], [-3, 1], [3, 4]];
    for (const [dx, dy] of pts) px(c, sx + dx, cy + dy, '#bffcff');
    if (P.t % 2) px(c, sx + 1, cy - 4, '#ffffff');
  }
  if (L.prop === 'sunstaff' && P.t % 2) {
    px(c, hx - 2, hy - 25, '#fff0b0');
    px(c, hx + 5, hy - 18, '#fff0b0');
  }
  if (L.prop === 'staff') {
    const ang = P.ang ?? -1.42;
    const len = 20 - (P.grip ?? 0);
    const [ox, oy] = axisPt(hx, hy, ang, len);
    const pts = P.t % 2 ? [[-3, -2], [3, 2]] : [[3, -3], [-3, 2]];
    if (P.fx !== 'cast') for (const [dx, dy] of pts) px(c, ox + dx, oy + dy, '#e8fbff');
    if (P.fx === 'charge') {
      for (const [dx, dy] of [[0, -4], [4, 0], [0, 4], [-4, 0]]) px(c, ox + dx, oy + dy, '#bfe8ff');
      for (const [dx, dy] of [[-3, -3], [3, -3], [3, 3], [-3, 3]]) px(c, ox + dx, oy + dy, '#7fd6ff');
    }
    if (P.fx === 'cast') {
      // starburst at the orb
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + 0.2;
        const r1 = k % 2 ? 4.5 : 6.5;
        for (let r = 3.5; r <= r1; r += 1) px(c, Math.round(ox + Math.cos(a) * r), Math.round(oy + Math.sin(a) * r), r > r1 - 1.2 ? '#7fd6ff' : '#e8fbff');
      }
      px(c, ox, oy, '#ffffff');
      px(c, ox - 1, oy, '#ffffff');
    }
  }
  if (P.fx === 'slash') {
    // crescent smear: from above the brow, around the front, down to the blade's follow-through
    const cx = R.shF[0] - 1;
    const cy = R.shF[1] + 1;
    const n = 24;
    for (let k = 0; k <= n; k++) {
      const a = -1.25 + (k / n) * 2.05;
      const th = k < 3 ? 1 : k < n - 4 ? 3 : 2;
      for (let d = 0; d < th; d++) {
        const r = 15 - d;
        const x = Math.round(cx + Math.cos(a) * r);
        const y = Math.round(cy + Math.sin(a) * r);
        if (x < 0 || x >= W || y < 0 || y >= H) continue;
        px(c, x, y, d === 0 ? '#ffffff' : d === 1 ? '#d8eef6' : '#8cc6e6');
      }
    }
  }
  if (P.fx === 'stab') {
    const [tx, ty] = axisPt(hx, hy, P.ang ?? 0, 10);
    // tip flash
    px(c, tx + 1, ty, '#ffffff');
    px(c, tx + 2, ty, '#ffffff');
    px(c, tx + 1, ty - 1, '#d8eef6');
    px(c, tx + 1, ty + 1, '#d8eef6');
    px(c, tx + 3, ty - 2, '#d8eef6');
    px(c, tx + 3, ty + 2, '#d8eef6');
  }
  if (P.fx === 'glint') {
    const [gx, gy] = axisPt(hx, hy, P.ang ?? -1.15, 13);
    px(c, gx, gy, '#ffffff');
    px(c, gx - 1, gy, '#ffffff');
    px(c, gx + 1, gy, '#ffffff');
    px(c, gx, gy - 1, '#ffffff');
    px(c, gx, gy + 1, '#ffffff');
  }
}

// ---------------------------------------------------------------- compositing

/** Layer slot of the held prop: over the arm (held against the chest), between torso and head
 *  (carried over the shoulder), or in front of the head (default). */
function propSlot(L: Look): 'over' | 'mid' | 'front' {
  switch (L.prop) {
    case 'baton':
    case 'ledger':
    case 'book':
    case 'scroll':
    case 'compass':
      return 'over';
    case 'pickaxe':
      return 'mid';
    default:
      return 'front';
  }
}

function paintCharacter(c: Ctx, L: Look, P: Pose): void {
  const R = rig(L, P);
  const slot = propSlot(L);
  paintFxBack(c, R);
  layer(c, (l) => paintBack(l, R));
  if (P.behind) layer(c, (l) => paintProp(l, R, false));
  layer(c, (l) => paintArm(l, R, false));
  layer(c, (l) => paintLeg(l, R, false));
  layer(c, (l) => paintLeg(l, R, true));
  layer(c, (l) => paintTorso(l, R));
  if (P.armBehind) layer(c, (l) => paintArm(l, R, true));
  if (!P.behind && slot === 'mid') layer(c, (l) => paintProp(l, R, false));
  layer(c, (l) => paintHead(l, R));
  if (!P.behind && slot === 'front') layer(c, (l) => paintProp(l, R, false));
  if (!P.armBehind) layer(c, (l) => paintArm(l, R, true));
  if (slot === 'over') layer(c, (l) => paintProp(l, R, true));
  paintFx(c, R);
}

function charTex(scene: Phaser.Scene, key: string, L: Look, P: Pose): void {
  pixelTex(scene, key, W, H, (c) => paintCharacter(c, L, P));
}

// ---------------------------------------------------------------- frame sets

type Weapon = 'sword' | 'dagger' | 'staff';

const IDLE: Pose[] = [
  { ...REST, t: 0 },
  { ...REST, bob: 1, frontHand: [0, 0], backHand: [0, 0], t: 1 },
];

/** Contact / passing / contact / passing with opposite arm swing and a 1 px rise on the passing frames. */
const WALK: Pose[] = [
  { ...REST, bob: 0, backFoot: [-3, 0], frontFoot: [3, 0], backHand: [2, -1], frontHand: [-1, 0], t: 0 },
  { ...REST, bob: -1, backFoot: [0, 2], frontFoot: [0, 0], backHand: [0, 0], frontHand: [0, -1], t: 1 },
  { ...REST, bob: 0, backFoot: [3, 0], frontFoot: [-3, 0], backHand: [-2, 0], frontHand: [1, -1], t: 2 },
  { ...REST, bob: -1, backFoot: [0, 0], frontFoot: [0, 2], backHand: [0, 0], frontHand: [0, -1], t: 3 },
];

const ATTACK: Record<Weapon, Pose[]> = {
  sword: [
    // wind-up: weight back, blade cocked over the shoulder
    { ...REST, lean: -1, bob: 1, backFoot: [-2, 0], frontFoot: [3, 0], frontHand: [-10, -11], backHand: [3, -2], ang: -2.2, behind: true, armBehind: true, t: 2 },
    // swing: lunge, blade low and forward, smear arc
    { ...REST, lean: 2, bob: 1, backFoot: [-3, 0], frontFoot: [4, 0], frontHand: [0, -3], backHand: [-3, -1], ang: 0.72, fx: 'slash', t: 0 },
  ],
  dagger: [
    // coil: crouched, blade drawn back
    { ...REST, lean: -1, bob: 2, backFoot: [-2, 0], frontFoot: [2, 0], frontHand: [-4, -2], backHand: [4, -3], ang: -0.2, t: 2 },
    // lunge: arm thrust forward, speed lines
    { ...REST, lean: 3, bob: 1, backFoot: [-4, 0], frontFoot: [5, 0], frontHand: [6, -3], backHand: [-3, 0], ang: 0, fx: 'stab', t: 0 },
  ],
  staff: [
    // raise: staff lifted back, orb charging
    { ...REST, lean: -1, bob: 0, backFoot: [-1, 0], frontFoot: [2, 0], frontHand: [1, -8], backHand: [2, -3], ang: -1.62, fx: 'charge', t: 1 },
    // cast: staff thrust forward, starburst
    { ...REST, lean: 1, bob: 1, backFoot: [-3, 0], frontFoot: [3, 0], frontHand: [0, -4], backHand: [-2, -1], ang: -1.0, grip: 7, fx: 'cast', t: 0 },
  ],
};

const PLAYERS: Record<Weapon, Look> = {
  sword: {
    skin: '#f0c49a',
    hair: '#7a4a26',
    style: 'tousled',
    top: '#3f66a8',
    legs: '#4a3f5c',
    boots: '#5c3d22',
    belt: '#4a3220',
    scarf: '#b8323a',
    sash: '#5c3d22',
    prop: 'sword',
  },
  dagger: {
    skin: '#e8b48c',
    hair: '#2e2a30',
    style: 'crop',
    top: '#3d5a34',
    legs: '#3a3446',
    boots: '#3d2817',
    belt: '#5c3d22',
    buckle: '#a9adb3',
    hat: 'hood',
    hatColor: '#4a6a32',
    mask: '#2f3a2a',
    sash: '#5c3d22',
    prop: 'dagger',
    blush: false,
  },
  staff: {
    skin: '#f2c9a0',
    hair: '#e6dcc8',
    style: 'long',
    top: '#5b3d8f',
    legs: '#3b2e54',
    boots: '#4a3220',
    robe: 40,
    trim: '#e9c46a',
    belt: '#3d2817',
    hat: 'wizard',
    hatColor: '#4a3478',
    prop: 'staff',
  },
};

const NPCS: Record<string, Look> = {
  blacksmith: {
    skin: '#d9a77a',
    hair: '#4a3020',
    style: 'bald',
    top: '#8a6440',
    sleeves: '#d9a77a',
    legs: '#3f3a3a',
    boots: '#3d2817',
    apron: '#5a4436',
    beard: '#6a3a1e',
    broad: true,
    hat: 'bandana',
    hatColor: '#b8323a',
    prop: 'hammer',
    blush: false,
  },
  priestess: {
    skin: '#f6d6b8',
    hair: '#e8d29a',
    style: 'long',
    top: '#ece6d8',
    legs: '#d8d0c0',
    boots: '#c2b18a',
    robe: 44,
    trim: '#d8a84a',
    hat: 'veil',
    hatColor: '#f4f0e6',
    emblem: '#e9c46a',
    prop: 'sunstaff',
  },
  hermit: {
    skin: '#e0b896',
    hair: '#c8c8c8',
    style: 'bald',
    top: '#6b6458',
    legs: '#4a4a4a',
    boots: '#4a3220',
    robe: 44,
    hat: 'cowl',
    hatColor: '#5e574c',
    beard: '#e8e4dc',
    belt: '#9c8a5a',
    hunch: true,
    prop: 'walkstick',
    blush: false,
  },
  fisher: {
    skin: '#e8b88f',
    hair: '#8a5a2a',
    style: 'crop',
    top: '#2f7f8f',
    sleeves: '#d8d0b8',
    legs: '#3b4b5b',
    boots: '#3a4a3a',
    hat: 'straw',
    hatColor: '#d6b866',
    hatTrim: '#2f6fa3',
    belt: '#5c3d22',
    prop: 'rod',
  },
  drillmaster: {
    skin: '#d8a07a',
    hair: '#4a3020',
    style: 'crop',
    mustache: '#4a3020',
    top: '#a8332a',
    legs: '#2e2e3a',
    boots: '#2a2020',
    trim: '#e9c46a',
    belt: '#3a2a1e',
    pauldron: '#b0803a',
    broad: true,
    hat: 'shako',
    hatColor: '#2e3a5a',
    prop: 'baton',
    blush: false,
  },
  quartermaster: {
    skin: '#c98e64',
    hair: '#2a2a2a',
    style: 'crop',
    top: '#6a6a3a',
    legs: '#4a4030',
    boots: '#3d2817',
    scarf: '#d0702a',
    belt: '#4a3020',
    hat: 'cap',
    hatColor: '#55552e',
    hatTrim: '#d0702a',
    prop: 'ledger',
  },
  waykeeper: {
    skin: '#f0c8a0',
    hair: '#3a3050',
    style: 'long',
    top: '#2f5f8f',
    legs: '#2a3a5a',
    boots: '#2a2a3a',
    robe: 44,
    trim: '#7ff0ff',
    cape: '#24486e',
    hat: 'circlet',
    hatTrim: '#a9adb3',
    prop: 'waystaff',
  },
  loremaster: {
    skin: '#e8c0a0',
    hair: '#a05a2a',
    style: 'bun',
    top: '#5a3a7a',
    legs: '#3a2a4a',
    boots: '#3d2817',
    robe: 44,
    trim: '#d8b04a',
    glasses: true,
    prop: 'book',
  },
  archivist: {
    skin: '#c8906a',
    hair: '#2e2440',
    style: 'braid',
    top: '#2f6a5a',
    legs: '#2a4a40',
    boots: '#3d2817',
    robe: 44,
    sash: '#c8a050',
    back: 'scrolls',
    prop: 'scroll',
  },
  wayfinder: {
    skin: '#d8a880',
    hair: '#7a4a2a',
    style: 'spiky',
    top: '#5a4a3a',
    legs: '#3a3a4a',
    boots: '#4a3020',
    cape: '#3a3a6a',
    scarf: '#7a5ab8',
    belt: '#3a2a1e',
    back: 'pack',
    hat: 'goggles',
    prop: 'compass',
  },
  child: {
    skin: '#f2c9a0',
    hair: '#c8783a',
    style: 'tuft',
    top: '#e0a830',
    legs: '#3a5a9a',
    boots: '#8a3a2a',
    child: true,
    prop: 'kite',
  },
  miner: {
    skin: '#d8a07a',
    hair: '#3a2a1e',
    style: 'crop',
    beard: '#6a4a2a',
    top: '#7a8590',
    sleeves: '#7a8590',
    apron: '#3a5a8a',
    legs: '#3a5a8a',
    boots: '#3d2817',
    hat: 'miner',
    hatColor: '#e0b030',
    prop: 'pickaxe',
    blush: false,
  },
  scout: {
    skin: '#e0b088',
    hair: '#b8502a',
    style: 'pony',
    top: '#4a6a3a',
    legs: '#4a3a2a',
    boots: '#4a3020',
    belt: '#4a3020',
    back: 'quiver',
    hat: 'feather',
    hatColor: '#3a5a2e',
    hatTrim: '#9c6d3e',
    prop: 'bow',
  },
};

/** NPC idle poses: frame 1 breathes (upper body down 1) and moves the prop. */
const NPC_IDLE: Pose[] = [
  { ...REST, t: 0 },
  { ...REST, bob: 1, t: 1 },
];

/** Per-NPC hand placement so props sit naturally. */
const NPC_HANDS: Record<string, { front?: [number, number]; back?: [number, number]; front1?: [number, number] }> = {
  hammer: { front: [0, 0], front1: [0, -3] },
  sunstaff: { front: [0, -1] },
  walkstick: { front: [1, 0] },
  rod: { front: [-1, -1] },
  baton: { front: [-1, -2] },
  ledger: { front: [-3, -3], back: [5, -2] },
  waystaff: { front: [0, -1] },
  book: { front: [-2, -2], back: [6, -2] },
  scroll: { front: [-1, -2], back: [5, -1] },
  compass: { front: [1, -4] },
  kite: { front: [1, -3] },
  pickaxe: { front: [-2, -4] },
  bow: { front: [0, -1] },
};

// ---------------------------------------------------------------- public contract

export interface CharAnimDef {
  /** Phaser animation key. */
  key: string;
  /** Texture keys, one per frame, in order. */
  frames: string[];
  frameRate: number;
  /** -1 = loop forever, 0 = play once. */
  repeat: number;
}

const WEAPONS: Weapon[] = ['sword', 'dagger', 'staff'];
const NPC_LOOKS = Object.keys(NPCS);

/** Every character animation: players (idle, walk, attack) and NPC idles. */
export const CHAR_ANIMS: readonly CharAnimDef[] = [
  ...WEAPONS.flatMap((w): CharAnimDef[] => [
    { key: `player_${w}_idle`, frames: [`player_${w}`, `player_${w}_idle_1`], frameRate: 2.5, repeat: -1 },
    { key: `player_${w}_walk`, frames: [0, 1, 2, 3].map((i) => `player_${w}_walk_${i}`), frameRate: 9, repeat: -1 },
    { key: `player_${w}_atk`, frames: [`player_${w}_atk_0`, `player_${w}_atk_1`], frameRate: 12, repeat: 0 },
  ]),
  ...NPC_LOOKS.map((n): CharAnimDef => ({ key: `npc_${n}_idle`, frames: [`npc_${n}`, `npc_${n}_1`], frameRate: 2, repeat: -1 })),
];

/** Registers CHAR_ANIMS with the scene's animation manager (skips keys that already exist). */
export function registerCharAnims(scene: Phaser.Scene): void {
  for (const a of CHAR_ANIMS) {
    if (scene.anims.exists(a.key)) continue;
    scene.anims.create({ key: a.key, frames: a.frames.map((key) => ({ key })), frameRate: a.frameRate, repeat: a.repeat });
  }
}

/** Draws every player and NPC frame (idempotent per key). */
export function drawCharacters(scene: Phaser.Scene): void {
  for (const w of WEAPONS) {
    const L = PLAYERS[w];
    charTex(scene, `player_${w}`, L, IDLE[0]);
    charTex(scene, `player_${w}_idle_1`, L, w === 'sword' ? { ...IDLE[1], fx: 'glint' } : IDLE[1]);
    WALK.forEach((p, i) => charTex(scene, `player_${w}_walk_${i}`, L, p));
    ATTACK[w].forEach((p, i) => charTex(scene, `player_${w}_atk_${i}`, L, p));
  }
  for (const n of NPC_LOOKS) {
    const L = NPCS[n];
    const hands = (L.prop && NPC_HANDS[L.prop]) || {};
    NPC_IDLE.forEach((p, i) => {
      const front = (i && hands.front1) || hands.front || [0, 0];
      const pose: Pose = { ...p, frontHand: front, backHand: hands.back ?? [0, 0] };
      charTex(scene, i ? `npc_${n}_1` : `npc_${n}`, L, pose);
    });
  }
}
