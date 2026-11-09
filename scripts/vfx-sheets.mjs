// VFX contact sheets (docs/VFX.md §11.2). Bundles the Phaser-free VFX modules with esbuild (already installed with
// vite; no new dependency), bakes every authored recipe and writes PNG sheets (+ grayscale copies) with Node's zlib.
//
//   node scripts/vfx-sheets.mjs [outDir] [--scale=3] [--maxw=720] [--only=family:fire,skills:sword] [--no-gray]
//                               [--compare [--fams=fire,ice]]   (review aid: one component across families)
//
// Output goes outside the repo (default os.tmpdir()/omnipath-vfx-sheets):
// - family-<id>.png: one sheet per family. Each component's frames (unique direction 0 = east) run left to right,
//   aligned on the anchor, once over mid grass (#5f8a3a) and once over a dark dungeon floor (#1e1a24). Frame times
//   are printed under each frame (yellow = a WHITE hero frame). Glow twins are added in the family R4 at the biome
//   gain (grass 0.6, dungeon 1.0).
// - skills-<group>[-<page>].png: one sheet per weapon tree (sword, dagger, staff), The Heart (every element infused
//   into the three weapon basics), monster techniques, monster auto-attacks and the other constellations (pages of
//   14 skills). Each row is one
//   skill: CAST (telegraph / charge / wind-up), PEAK (the carrier's hero frame) and HIT (impact, statuses,
//   aftermath), composited from the recipe at those moments with a simple stand-in for runtime placement, on grass
//   and on the dungeon floor. A grey dummy marks the caster / target feet.
// Every distinct piece of every recipe is baked; bake errors are listed in index.txt and fail the run.
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, def) => {
  const a = args.find((x) => x.startsWith(`--${name}=`));
  return a ? a.slice(name.length + 3) : def;
};
const outDir = path.resolve(args.find((a) => !a.startsWith('--')) ?? path.join(os.tmpdir(), 'omnipath-vfx-sheets'));
const SCALE = Math.max(1, Number(flag('scale', '3')));
const MAXW = Math.max(240, Number(flag('maxw', '720')));
const ONLY = flag('only', '').split(',').filter(Boolean);
const GRAY = !args.includes('--no-gray');
const FAMS = flag('fams', '').split(',').filter(Boolean);
const want = (kind, id) => !ONLY.length || ONLY.includes(`${kind}:${id}`) || ONLY.includes(kind);
fs.mkdirSync(outDir, { recursive: true });

// ---------------------------------------------------------------- bundle
const bundleEntry = `
export { bakePiece, pieceKey } from './src/game/vfx/bake';
export { RAMPS, hexToRgb } from './src/game/vfx/ramps';
export { FAMILY_IDS, pickDir, RING_WHOLE_MAX } from './src/game/vfx/types';
export { deriveVfx, deriveAttackVfx, impactPieces, statusPieces } from './src/game/vfx/recipe';
export { recipePieces } from './src/game/vfx/pieces';
export { LOOKS, elementStatus } from './src/game/vfx/families';
export { createRegistry, GAME_DATA } from './src/data';
export { WEAPONS } from './src/data/weapons';
export { canTakeElement, variantId, MONSTER_TAG } from './src/core/compose';
export { WEAPON_TYPES } from './src/core/types';
`;
const res = await build({ stdin: { contents: bundleEntry, resolveDir: root, loader: 'ts' }, bundle: true, write: false, format: 'esm', platform: 'node', logLevel: 'error' });
const bundlePath = path.join(outDir, `_vfx_bundle_${process.pid}.mjs`);
fs.writeFileSync(bundlePath, res.outputFiles[0].text);
const vfx = await import(pathToFileURL(bundlePath).href);
fs.rmSync(bundlePath);

// ---------------------------------------------------------------- png
const crcT = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = (b) => {
  let c = 0xffffffff;
  for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (t, d) => {
  const l = Buffer.alloc(4);
  l.writeUInt32BE(d.length);
  const td = Buffer.concat([Buffer.from(t), d]);
  const c = Buffer.alloc(4);
  c.writeUInt32BE(crc(td));
  return Buffer.concat([l, td, c]);
};
function writePng(file, w, h, rgb) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3).copy(raw, y * (w * 3 + 1) + 1);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  fs.writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]));
}
function save(name, img) {
  const s = SCALE;
  const W = img.w * s;
  const out = new Uint8Array(W * img.h * s * 3);
  for (let y = 0; y < img.h; y++) {
    const row = new Uint8Array(W * 3);
    for (let x = 0; x < img.w; x++) for (let k = 0; k < s; k++) row.set(img.px.subarray((y * img.w + x) * 3, (y * img.w + x) * 3 + 3), (x * s + k) * 3);
    for (let k = 0; k < s; k++) out.set(row, (y * s + k) * W * 3);
  }
  const file = path.join(outDir, `${name}.png`);
  writePng(file, W, img.h * s, out);
  if (GRAY) {
    for (let i = 0; i < out.length; i += 3) out[i] = out[i + 1] = out[i + 2] = Math.round(0.299 * out[i] + 0.587 * out[i + 1] + 0.114 * out[i + 2]);
    writePng(path.join(outDir, `${name}.gray.png`), W, img.h * s, out);
  }
  return file;
}

// ---------------------------------------------------------------- 3x5 label font (sheet chrome only)
const FONT = {
  A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
  F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
  K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
  P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
  U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
  Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
  4: '101101111001001', 5: '111100110001110', 6: '011100111101111', 7: '111001010010010', 8: '111101111101111',
  9: '111101111001110', ' ': '000000000000000', '-': '000000111000000', _: '000000000000111', '.': '000000000000010',
  ',': '000000000010100', ':': '000010000010000', '/': '001001010100100', '#': '101111101111101', '@': '010101111100011',
  '|': '010010010010010', '~': '000011110000000', '=': '000111000111000', '(': '001010010010001', ')': '100010010010100',
  '+': '000010111010000', "'": '010010000000000', '%': '101001010100101', '?': '110001010000010', '!': '010010010000010',
  '<': '001010100010001', '>': '100010001010100',
};
const textW = (s) => s.length * 4 - 1;

// ---------------------------------------------------------------- image
const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const C = {
  sheet: hex('#121216'),
  label: hex('#26262e'),
  text: hex('#d8d8e0'),
  dim: hex('#7a7a88'),
  hero: hex('#ffe14a'),
  grass: hex('#5f8a3a'),
  dungeon: hex('#1e1a24'),
  dummy: [hex('#7a7a80'), hex('#9a9aa0'), hex('#24180f')],
  err: hex('#ff40ff'),
};

class Img {
  constructor(w, h, bg = C.sheet) {
    this.w = Math.max(1, Math.ceil(w));
    this.h = Math.max(1, Math.ceil(h));
    this.px = new Uint8Array(this.w * this.h * 3);
    this.rect(0, 0, this.w, this.h, bg);
  }
  rect(x, y, w, h, c) {
    for (let yy = Math.max(0, y); yy < Math.min(this.h, y + h); yy++)
      for (let xx = Math.max(0, x); xx < Math.min(this.w, x + w); xx++) this.px.set(c, (yy * this.w + xx) * 3);
  }
  set(x, y, c) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    this.px.set(c, (y * this.w + x) * 3);
  }
  add(x, y, c, k) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    for (let i = 0; i < 3; i++) this.px[o + i] = Math.min(255, this.px[o + i] + c[i] * k);
  }
  /** Draw an RgbaFrame with its anchor at (ax, ay); flips mirror about the anchor. Clipped to [clip]. */
  /** mode: 'normal' (opaque), 'add' (glow / light layers) or 'multiply' (scorch and ink decals). */
  frame(f, ax, ay, flipX = false, flipY = false, clip = null, mode = 'normal') {
    for (let fy = 0; fy < f.h; fy++)
      for (let fx = 0; fx < f.w; fx++) {
        const s = (fy * f.w + fx) * 4;
        if (!f.data[s + 3]) continue;
        const x = ax + (flipX ? f.ox - fx : fx - f.ox);
        const y = ay + (flipY ? f.oy - fy : fy - f.oy);
        if (clip && (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3])) continue;
        const c = [f.data[s], f.data[s + 1], f.data[s + 2]];
        if (mode === 'add') this.add(x, y, c, 1);
        else if (mode === 'multiply') {
          if (x < 0 || y < 0 || x >= this.w || y >= this.h) continue;
          const o = (y * this.w + x) * 3;
          for (let i = 0; i < 3; i++) this.px[o + i] = Math.round((this.px[o + i] * c[i]) / 255);
        } else this.set(x, y, c);
      }
  }
  glow(g, ax, ay, tint, gain, flipX = false, flipY = false, clip = null) {
    for (let fy = 0; fy < g.h; fy++)
      for (let fx = 0; fx < g.w; fx++) {
        if (!g.data[(fy * g.w + fx) * 4 + 3]) continue;
        const x = ax + (flipX ? g.ox - fx : fx - g.ox);
        const y = ay + (flipY ? g.oy - fy : fy - g.oy);
        if (clip && (x < clip[0] || y < clip[1] || x >= clip[2] || y >= clip[3])) continue;
        this.add(x, y, tint, gain);
      }
  }
  text(x, y, s, c = C.text) {
    let cx = x;
    for (const ch of s.toUpperCase()) {
      const g = FONT[ch] ?? FONT['?'];
      for (let r = 0; r < 5; r++) for (let k = 0; k < 3; k++) if (g[r * 3 + k] === '1') this.set(cx + k, y + r, c);
      cx += 4;
    }
  }
  /** A neutral stand-in actor the size of the player (BODY_PX M = 40: feet at x, y; head top at y - 36). */
  dummy(x, y) {
    const [body, lit, ol] = C.dummy;
    const inside = (a, b) => (b < -24 ? a * a + (b + 30) * (b + 30) <= 30 : b <= -1 && Math.abs(a) <= (b > -6 ? 5 : 6));
    for (let yy = -37; yy <= 0; yy++)
      for (let xx = -8; xx <= 8; xx++) {
        if (inside(xx, yy)) this.set(x + xx, y + yy, xx < -1 && yy < -14 ? lit : body);
        else if (inside(xx + 1, yy) || inside(xx - 1, yy) || inside(xx, yy + 1) || inside(xx, yy - 1)) this.set(x + xx, y + yy, ol);
      }
  }
}

// ---------------------------------------------------------------- bake cache
const cache = new Map();
const errors = [];
let bakedPx = 0;
function bake(p) {
  let k;
  try {
    k = vfx.pieceKey(p);
  } catch (e) {
    errors.push(`${p.component} ${JSON.stringify(p.params)}: key: ${e.message}`);
    return null;
  }
  if (cache.has(k)) return cache.get(k);
  let b = null;
  try {
    b = vfx.bakePiece(p);
    bakedPx += b.px;
  } catch (e) {
    errors.push(`${p.component} ${JSON.stringify(p.params)} ${p.ramp}: ${e.message}`);
  }
  cache.set(k, b);
  return b;
}
const stripMs = (strip) => strip.reduce((a, f) => a + f.ms, 0);
const glowTint = (ramp) => hex(vfx.RAMPS[ramp].R[4]);

// ---------------------------------------------------------------- family sheets
const NATIVE_MISSILE = { earth: 'rock', ice: 'shard', magma: 'glob', wind: 'feather', toxin: 'thorn', steel: 'knife', stealth: 'needle' };
const UNIT_OF_STATUS = { burn: 'tongue', soak: 'drip', slow: 'chevron', stun: 'star', shock: 'microarc', freeze: 'crystal', poison: 'bubble', bleed: 'drop', smite: 'beam', knockback: 'speedline', pull: 'spiral' };
const ELEMENT_IDS = vfx.GAME_DATA.elements.map((e) => e.id);

function familyRows(fam) {
  const P = (component, params, label, extra = {}) => ({ label, piece: { component, params, ramp: fam, motif: fam, lut: 'base', blend: 'normal', layer: 'body', anchor: { to: 'caster', dy: 0 }, ...extra } });
  if (fam === 'danger') {
    return [
      P('tell', { piece: 'chevron', danger: true }, 'tell chevron'),
      P('tell', { piece: 'arrow', danger: true }, 'tell arrow'),
      P('tell', { piece: 'bead', danger: true }, 'tell bead'),
      P('tell', { piece: 'lock', danger: true }, 'tell lock'),
      P('tell', { piece: 'edge', danger: true }, 'tell edge'),
      P('tell', { piece: 'fizzle', danger: true }, 'tell fizzle'),
      P('ring', { r: 40, aspect: 0.65, thick: 2, style: 'dashed', ink: 'lit', anim: 'march', ms: 333 }, 'ring dashed march'),
      P('ring', { r: 40, aspect: 0.65, thick: 2, style: 'solid', ink: 'lit', anim: 'static', ms: 200 }, 'ring solid static'),
      P('ring', { r: 64, aspect: 1, thick: 2, style: 'dashed', ink: 'lit', anim: 'march', ms: 333, arc: [-35, 35] }, 'ring cone rim'),
      P('decal', { kind: 'fill', r: 40, aspect: 0.65, density: 0.25, shape: 'disc' }, 'decal fill 25%'),
      P('decal', { kind: 'fill', r: 40, aspect: 0.65, density: 0.5, shape: 'disc' }, 'decal fill 50%'),
      P('motes', { kind: 'streak', size: 2 }, 'motes streak'),
      P('burst', { cls: 'blunt', size: 's' }, 'burst blunt s'),
    ];
  }
  const L = vfx.LOOKS[fam];
  const el = ELEMENT_IDS.includes(fam) ? fam : undefined;
  const st = el ? vfx.elementStatus(el) : fam === 'toxin' ? 'poison' : fam === 'stealth' ? 'bleed' : fam === 'spirit' ? 'stun' : 'bleed';
  const rows = [
    P('slash', { r: 48, arc: 120, rakes: 1, form: 'arc', weight: 'normal', tier: 1, sense: 1, rune: fam === 'arcane' }, 'slash r48 t1'),
    P('slash', { r: 56, arc: 180, rakes: 1, form: 'arc', weight: 'heavy', tier: 2, sense: 1, rune: false }, 'slash heavy t2'),
    P('thrust', { len: 56, weight: 'normal', tier: 0, slit: fam === 'stealth' }, 'thrust'),
    P('orb', { form: L.orb, cell: 24, halo: false, mode: 'fly' }, `orb ${L.orb}`),
    P('orb', { form: L.orb, cell: 24, halo: false, mode: 'charge' }, 'orb charge'),
    P('missile', { form: NATIVE_MISSILE[fam] ?? 'blade', cell: 24, halo: false, pose: 'fly' }, `missile ${NATIVE_MISSILE[fam] ?? 'blade'}`),
    P('bolt', { dx: 80, dy: 16, jag: 0.32, forks: 0.35, strength: 1, seq: 'chain', seed: 7 }, 'bolt chain'),
    P('burst', { cls: 'magic', size: 'm' }, 'burst magic'),
    P('burst', { cls: el ? 'strong' : 'crit', size: 'm', ...(el ? { glyph: el } : {}) }, el ? 'burst strong' : 'burst crit'),
    P('motes', { kind: L.hit, size: 2 }, `motes ${L.hit}`),
    ...(L.trail.mote && L.trail.mote !== L.hit ? [P('motes', { kind: L.trail.mote, size: 2 }, `motes ${L.trail.mote}`)] : []),
    P('puff', { kind: L.cone ?? L.trail.puff ?? 'smoke', r: 7 }, `puff ${L.cone ?? L.trail.puff ?? 'smoke'}`),
    P('ring', { r: 40, r0: 12, aspect: 1, thick: 2, style: L.ring, ink: 'hot', anim: 'expand', ms: 333 }, `ring ${L.ring}`),
    P('decal', { kind: L.decal ?? 'fill', r: 32, aspect: 1, density: 0.5, shape: 'disc' }, `decal ${L.decal ?? 'fill'}`),
    P('sigil', { r: 24, points: 5, glyphs: 4, anim: 'draw' }, 'sigil'),
    P('nova', { core: L.core, c: 40, heavy: false }, `nova ${L.core}`),
    P('erupt', { unit: L.unit, scale: 'm' }, `erupt ${L.unit}`),
    P('status', { kind: st, unit: UNIT_OF_STATUS[st], body: 'M' }, `status ${st}`),
    P('aura', { motif: 'edge', phase: 'activate', activation: fam === 'holy' ? 'pillar' : fam === 'arcane' ? 'sigil' : 'ring', body: 'M', halo: false }, 'aura activate'),
    P('aura', { motif: 'edge', phase: 'loop', activation: 'ring', body: 'M', halo: false }, 'aura edge loop'),
  ];
  return rows;
}

const LABEL_W = 84;
const GAP = 3;

/** Lay out one strip (frames of unique dir 0) as wrapped lines of cells over a background. */
function stripBlock(baked, bg, gain, showMs) {
  const strip = baked.frames[0];
  const glow = baked.glow[0];
  let L = 2,
    R = 2,
    U = 2,
    D = 2;
  for (const f of strip) {
    if (!f.w) continue;
    L = Math.max(L, f.ox);
    R = Math.max(R, f.w - f.ox);
    U = Math.max(U, f.oy);
    D = Math.max(D, f.h - f.oy);
  }
  const cw = L + R + GAP;
  const ch = U + D + (showMs ? 7 : 0);
  const perLine = Math.max(1, Math.floor((MAXW - LABEL_W) / cw));
  const lines = Math.ceil(strip.length / perLine);
  return {
    w: Math.min(strip.length, perLine) * cw,
    h: lines * (ch + GAP),
    draw(img, x0, y0, tint) {
      strip.forEach((f, k) => {
        const cx = x0 + (k % perLine) * cw;
        const cy = y0 + Math.floor(k / perLine) * (ch + GAP);
        img.rect(cx, cy, cw - GAP, U + D, bg);
        const clip = [cx, cy, cx + cw - GAP, cy + U + D];
        if (tint) img.glow(glow[k], cx + L, cy + U, tint, gain, false, false, clip);
        img.frame(f, cx + L, cy + U, false, false, clip);
        if (!f.w) img.set(cx + L, cy + U, C.dim);
        if (showMs) img.text(cx, cy + U + D + 1, String(f.ms), baked.heroFrames.includes(k) ? C.hero : C.dim);
      });
    },
  };
}

function familySheet(fam) {
  const rows = [];
  for (const r of familyRows(fam)) {
    const b = bake(r.piece);
    if (!b || b.use === 'runtime') continue;
    rows.push({ ...r, b, g: stripBlock(b, C.grass, 0.6, true), d: stripBlock(b, C.dungeon, 1.0, false) });
  }
  const title = `${fam} family - grass #5f8a3a / dungeon #1e1a24 - ms per frame, yellow = hero`;
  let H = 12;
  let W = Math.max(textW(title) + 8, 200);
  for (const r of rows) {
    W = Math.max(W, LABEL_W + Math.max(r.g.w, r.d.w));
    H += r.g.h + r.d.h + 4;
  }
  const img = new Img(W, H);
  img.text(4, 3, title);
  let y = 12;
  const tint = glowTint(fam);
  for (const r of rows) {
    const h = r.g.h + r.d.h;
    img.rect(0, y, LABEL_W - 2, h, C.label);
    img.text(3, y + 3, r.label);
    img.text(3, y + 11, `${r.b.use} ${r.b.frames[0].length}f ${stripMs(r.b.frames[0])}ms`, C.dim);
    if (r.b.dirs > 1) img.text(3, y + 19, `${r.b.dirs} dirs`, C.dim);
    r.g.draw(img, LABEL_W, y, tint);
    r.d.draw(img, LABEL_W, y + r.g.h, tint);
    y += h + 4;
  }
  return img;
}

/** Review aid (--compare): one component across every family (grass strip, then dungeon strip). */
function compareSheet(component) {
  const rows = [];
  for (const fam of vfx.FAMILY_IDS)
    for (const r of familyRows(fam)) {
      if (r.piece.component !== component || (FAMS.length && !FAMS.includes(fam))) continue;
      const b = bake(r.piece);
      if (!b || b.use === 'runtime') continue;
      rows.push({ label: `${fam} ${r.label}`, b, g: stripBlock(b, C.grass, 0.6, true), d: stripBlock(b, C.dungeon, 1.0, false), tint: glowTint(fam) });
    }
  if (!rows.length) return null;
  const side = (r) => r.g.w + r.d.w + 8 <= MAXW - LABEL_W;
  let W = 200,
    H = 12;
  for (const r of rows) {
    W = Math.max(W, LABEL_W + (side(r) ? r.g.w + r.d.w + 8 : Math.max(r.g.w, r.d.w)));
    H += (side(r) ? Math.max(r.g.h, r.d.h) : r.g.h + r.d.h) + 4;
  }
  const img = new Img(W, H);
  img.text(4, 3, `${component} across families`);
  let y = 12;
  for (const r of rows) {
    const h = side(r) ? Math.max(r.g.h, r.d.h) : r.g.h + r.d.h;
    img.rect(0, y, LABEL_W - 2, h, C.label);
    img.text(3, y + 3, r.label.slice(0, 20));
    r.g.draw(img, LABEL_W, y, r.tint);
    if (side(r)) r.d.draw(img, LABEL_W + r.g.w + 8, y, r.tint);
    else r.d.draw(img, LABEL_W, y + r.g.h, r.tint);
    y += h + 4;
  }
  return img;
}

// ---------------------------------------------------------------- recipe compositor (sheet stand-in for the runtime)
const outCubic = (t) => 1 - Math.pow(1 - Math.min(1, Math.max(0, t)), 3);

function frameAt(b, p, t, u = 0) {
  const strip = b.frames[u];
  if (!strip?.length || t < 0) return -1;
  const total = stripMs(strip);
  if (b.use === 'pieces') {
    if (p.component === 'motes') return Math.min(strip.length - 1, Math.floor((t / (p.lifeMs ?? 400)) * strip.length));
    if (p.lifeMs !== undefined && t >= p.lifeMs) return -1;
    return Math.floor(t / 67) % strip.length;
  }
  if (b.use === 'loop') {
    if (p.lifeMs !== undefined && t >= p.lifeMs) return -1;
    t %= total;
  } else if (t >= total) return -1;
  let acc = 0;
  for (let k = 0; k < strip.length; k++) {
    acc += strip[k].ms;
    if (t < acc) return k;
  }
  return strip.length - 1;
}

/** Ms from strip start to the middle of its peak frame: the first hero frame, else the fullest frame of the first half. */
function peakMs(b) {
  const strip = b.frames[0];
  if (!strip?.length) return 0;
  let k = b.heroFrames.length ? b.heroFrames[0] : -1;
  if (k < 0) {
    let best = -1;
    const half = b.use === 'once' ? Math.max(1, Math.ceil(strip.length * 0.5)) : strip.length;
    for (let i = 0; i < half; i++) {
      const n = strip[i].w * strip[i].h;
      if (n > best) {
        best = n;
        k = i;
      }
    }
  }
  let acc = 0;
  for (let i = 0; i < k; i++) acc += strip[i].ms;
  return acc + Math.floor(strip[k].ms / 2);
}

function hash(i, j) {
  let h = Math.imul(i * 374761393 + j * 668265263, 2246822519) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 3266489917) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Instance offsets for a placement pattern (aim = east). */
function spots(p, t) {
  const pl = p.place;
  if (!pl) return [[0, 0]];
  const n = Math.min(pl.count ?? (pl.pattern === 'trail' ? 5 : 1), 14);
  const R = pl.radius ?? 12;
  const asp = pl.aspect ?? 1;
  const out = [];
  const sun = (k, rad) => {
    const r = rad * Math.sqrt((k + 0.5) / n);
    const a = k * 2.39996;
    return [Math.round(r * Math.cos(a)), Math.round(r * Math.sin(a) * asp)];
  };
  switch (pl.pattern) {
    case 'burst': {
      const spread = pl.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : Math.PI * 2;
      const dist = pl.speed ? Math.min(R, (pl.speed * Math.max(t, 60)) / 1000) : Math.min(R, 6 + t / 25);
      for (let k = 0; k < n; k++) {
        const a = pl.spreadDeg ? -spread / 2 + (spread * (k + 0.5)) / n : (k / n) * spread + 0.4;
        const d = dist * (0.55 + 0.45 * hash(k, 3));
        out.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d * asp)]);
      }
      return out;
    }
    case 'orbit':
    case 'converge':
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2 + t / 300;
        const rr = pl.pattern === 'converge' ? R * (1 - Math.min(0.8, t / 600)) : R;
        out.push([Math.round(Math.cos(a) * rr), Math.round(Math.sin(a) * rr * (pl.pattern === 'orbit' ? asp * 0.5 : 1))]);
      }
      return out;
    case 'rim':
      if (pl.radius) {
        // Points on the rim of a circle / ellipse (strike arc edges, geode closings), within the spread around the aim.
        const spread = pl.spreadDeg ? (pl.spreadDeg * Math.PI) / 180 : Math.PI * 2;
        for (let k = 0; k < n; k++) {
          const a = pl.spreadDeg ? -spread / 2 + (spread * (k + 0.5)) / n : (k / n) * spread;
          out.push([Math.round(Math.cos(a) * R), Math.round(Math.sin(a) * R * asp)]);
        }
        return out;
      }
      // Status units on the silhouette's top edge.
      for (let k = 0; k < n; k++) out.push([Math.round((k - (n - 1) / 2) * 7), Math.abs(k - (n - 1) / 2) * 2]);
      return out;
    case 'poisson':
    case 'lattice':
      for (let k = 0; k < n; k++) out.push(sun(k, R));
      return out;
    case 'fall':
      for (let k = 0; k < n; k++) {
        const [x, y] = sun(k, R);
        out.push([x, y - 8]);
      }
      return out;
    case 'trail':
      for (let k = 1; k <= Math.min(n, 6); k++) out.push([-k * (pl.everyPx ?? 8), 0]);
      return out;
    case 'rise':
      for (let k = 0; k < Math.min(n, 3); k++) out.push([((k * 5) % 9) - 4, -k * 7]);
      return out;
    case 'spiral':
      for (let k = 0; k < n; k++) {
        const a = k * 0.9 + t / 200;
        const r = R * (1 - k / (n + 1));
        out.push([Math.round(Math.cos(a) * r), Math.round(Math.sin(a) * r * asp)]);
      }
      return out;
    case 'path':
      if (!pl.radius) {
        // A stream back to the caster (heal / leech): spread up and to the left of the target.
        for (let k = 0; k < n; k++) out.push([-6 - k * 9, -k * 3]);
        return out;
      }
    // falls through
    case 'line': {
      const edges = pl.spreadDeg ? [-pl.spreadDeg / 2, pl.spreadDeg / 2] : [0];
      const per = Math.max(1, Math.ceil(n / edges.length));
      for (const e of edges) {
        const a = (e * Math.PI) / 180;
        for (let k = 0; k < per; k++) {
          const d = (R * (k + 0.5)) / per;
          out.push([Math.round(Math.cos(a) * d), Math.round(Math.sin(a) * d)]);
        }
      }
      return out;
    }
    case 'stack':
      // A piled cluster (cloud caps): side by side, alternate ones raised.
      for (let k = 0; k < n; k++) out.push([Math.round((k - (n - 1) / 2) * (R ? Math.min(12, (2 * R) / n) : 9)), -(k % 2) * 5]);
      return out;
    case 'single':
    default:
      return [[0, 0]];
  }
}

/** Ring chunk placement for r > RING_WHOLE_MAX rings (outward-normal tile sets, docs/VFX.md §4.1). */
function ringOps(p, b, t, ops) {
  const prm = p.params;
  const life = p.lifeMs ?? prm.ms;
  if (t < 0 || t >= Math.max(life, prm.ms + (prm.anim === 'sweep' ? 200 : 0))) return;
  let r = prm.r;
  if (prm.anim === 'expand') r = (prm.r0 ?? prm.r * 0.3) + (prm.r - (prm.r0 ?? prm.r * 0.3)) * outCubic(t / prm.ms);
  if (prm.anim === 'contract') r = (prm.r0 ?? prm.r * 1.6) + (prm.r - (prm.r0 ?? prm.r * 1.6)) * outCubic(t / prm.ms);
  const rx = Math.max(4, r);
  const ry = rx * prm.aspect;
  const h = ((rx - ry) * (rx - ry)) / ((rx + ry) * (rx + ry));
  const per = Math.PI * (rx + ry) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
  const N = Math.ceil(per / 10);
  const march = Math.floor(t / 67);
  for (let k = 0; k < N; k++) {
    const th = (k / N) * Math.PI * 2;
    const deg = ((th * 180) / Math.PI + 360) % 360;
    if (prm.arc) {
      const [a0, a1] = prm.arc;
      const rel = (((deg - a0) % 360) + 360) % 360;
      if (rel > (((a1 - a0) % 360) + 360) % 360) continue;
    }
    if (prm.style === 'dashed' && (k + (prm.anim === 'march' ? march : 0)) % 5 >= 3) continue;
    if (prm.style === 'gapped' && k % 4 === 3) continue;
    if (prm.anim === 'sweep') {
      const heads = prm.heads ?? 1;
      let near = false;
      for (let j = 0; j < heads; j++) {
        const head = ((t / prm.ms) * 360 + (360 * j) / heads + 270) % 360;
        const behind = (((head - deg) % 360) + 360) % 360;
        if (behind < 110) near = true;
      }
      if (!near) continue;
    }
    const nAng = Math.atan2(Math.sin(th) / ry, Math.cos(th) / rx);
    const pick = vfx.pickDir(nAng, 16);
    const f = b.frames[pick.u]?.[0];
    if (!f) continue;
    ops.push({ f, g: b.glow[pick.u][0], x: Math.round(Math.cos(th) * rx), y: Math.round(Math.sin(th) * ry), fx: pick.flipX, fy: pick.flipY, ramp: p.ramp, back: p.layer === 'ground' || Math.sin(th) < 0 });
  }
}

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const ghosts = new Map();
/** The dummy's silhouette in a ramp's R3 at ordered coverage `a` (afterimage stand-in). */
function ghostFrame(ramp, a) {
  const k = `${ramp}|${a}`;
  if (ghosts.has(k)) return ghosts.get(k);
  const w = 15,
    h = 38;
  const data = new Uint8ClampedArray(w * h * 4);
  const col = hex(vfx.RAMPS[ramp].R[3]);
  const inside = (x, y) => (y < -24 ? x * x + (y + 30) * (y + 30) <= 30 : y <= -1 && Math.abs(x) <= (y > -6 ? 5 : 6));
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!inside(x - 7, y - 37) || a <= (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16) continue;
      data.set([...col, 255], (y * w + x) * 4);
    }
  const f = { w, h, ox: 7, oy: 37, ms: 50, data };
  ghosts.set(k, f);
  return f;
}

/** Any frame recoloured to a ramp's R3 at ordered coverage `a` (afterimages of projectile bodies). */
function tintGhost(src, ramp, a) {
  const k = `${ramp}|${a}|${src.w}x${src.h}|${src.data.length}`;
  if (ghosts.has(k)) return ghosts.get(k);
  const col = hex(vfx.RAMPS[ramp].R[3]);
  const data = new Uint8ClampedArray(src.data.length);
  for (let y = 0; y < src.h; y++)
    for (let x = 0; x < src.w; x++) {
      const i = (y * src.w + x) * 4;
      if (src.data[i + 3] && a > (BAYER4[(y & 3) * 4 + (x & 3)] + 0.5) / 16) data.set([...col, 255], i);
    }
  const f = { ...src, data };
  ghosts.set(k, f);
  return f;
}

const blendOf = (p) => (p.blend === 'add' || p.layer === 'glow' || p.layer === 'light' ? 'add' : p.blend === 'multiply' ? 'multiply' : 'normal');

/** Draw ops for a list of pieces at time t (ms since the phase trigger). */
function composite(pieces, t, ops = [], opts = {}) {
  for (const p of pieces) {
    if (p.component === 'afterimage') {
      // Runtime-only (a tinted snapshot of the actor); the sheet shows the dummy silhouette in the family R3 at the
      // stepped alpha as ordered coverage, one ghost per placement spot.
      const lt = t - (p.delayMs ?? 0);
      if (lt < 0) continue;
      const pts = spots(p, lt);
      pts.forEach(([sx, sy], i) => {
        const a = p.params.steps[Math.min(i, p.params.steps.length - 1)] ?? 0.5;
        const f = opts.ghostOf ? tintGhost(opts.ghostOf, p.ramp, a) : ghostFrame(p.ramp, a);
        ops.push({ f, g: null, x: sx + (p.anchor.along ?? 0), y: sy + p.anchor.dy + 1 + (opts.mover && opts.ghostOf ? -14 : 0), fx: false, fy: false, ramp: p.ramp, back: true, mode: 'normal' });
      });
      continue;
    }
    if (p.component === 'tell' && p.params.piece === 'edge') continue; // placed at the screen edge by the runtime
    const b = bake(p);
    if (!b) continue;
    const lt = t - (p.delayMs ?? 0);
    const ax = p.anchor.along ?? 0;
    // Movers are drawn at y - 14 (projectiles); a 'body' anchor in flight follows the mover.
    const ay = p.anchor.dy + (opts.mover && (p.anchor.to === 'body' || p.anchor.to === 'path') ? -14 : 0);
    let mx = 0,
      my = 0;
    if (p.move && lt >= 0) {
      const k = Math.min(1, lt / p.move.ms);
      const e = p.move.ease === 'in' ? k * k : p.move.ease === 'out' ? 1 - (1 - k) * (1 - k) : k;
      mx = Math.round(p.move.from.x * (1 - e));
      my = Math.round(p.move.from.y * (1 - e) - (p.move.ease === 'arc' ? Math.sin(Math.PI * k) * 24 : 0));
    }
    if (b.use === 'pieces' && p.component === 'ring') {
      const sub = [];
      ringOps(p, b, lt, sub);
      for (const o of sub) ops.push({ ...o, x: o.x + ax + mx, y: o.y + ay + my, mode: blendOf(p) });
      continue;
    }
    const k = frameAt(b, p, lt);
    if (k < 0) continue;
    const f = b.frames[0][k];
    if (!f.w) continue;
    const back = p.anchor.half === 'back' || p.layer === 'ground';
    for (const [sx, sy] of spots(p, lt)) ops.push({ f, g: b.glow[0][k], x: sx + ax + mx, y: sy + ay + my, fx: false, fy: false, ramp: p.ramp, back, mode: blendOf(p) });
  }
  return ops;
}

function opsBox(ops) {
  let x0 = -12,
    y0 = -40,
    x1 = 12,
    y1 = 4;
  for (const o of ops) {
    const ax = o.fx ? -1 : 1;
    const ay = o.fy ? -1 : 1;
    const xa = o.x + ax * (0 - o.f.ox),
      xb = o.x + ax * (o.f.w - 1 - o.f.ox);
    const ya = o.y + ay * (0 - o.f.oy),
      yb = o.y + ay * (o.f.h - 1 - o.f.oy);
    x0 = Math.min(x0, xa, xb);
    x1 = Math.max(x1, xa, xb);
    y0 = Math.min(y0, ya, yb);
    y1 = Math.max(y1, ya, yb);
  }
  return [x0, y0, x1 + 1, y1 + 1];
}

function drawOps(img, ops, ox, oy, clip, gain, dummy) {
  for (const o of ops) if (o.back) img.frame(o.f, ox + o.x, oy + o.y, o.fx, o.fy, clip, o.mode);
  if (dummy) img.dummy(ox, oy);
  for (const o of ops) if (!o.back && o.mode !== 'add') img.frame(o.f, ox + o.x, oy + o.y, o.fx, o.fy, clip, o.mode);
  for (const o of ops) if (!o.back && o.mode === 'add') img.frame(o.f, ox + o.x, oy + o.y, o.fx, o.fy, clip, 'add');
  for (const o of ops) if (o.g?.w && !o.back) img.glow(o.g, ox + o.x, oy + o.y, glowTint(o.ramp), gain, o.fx, o.fy, clip);
}

const ph = (r, id) => r.phases[id] ?? [];
const span = (ps) => ps.reduce((m, p) => Math.max(m, (p.delayMs ?? 0) + (p.lifeMs ?? (bake(p) ? stripMs(bake(p).frames[0] ?? []) : 0))), 0);

/** The three moments of a recipe: CAST (telegraph / charge / wind-up), PEAK and HIT. */
function moments(r) {
  const shape = r.shape;
  const mainPhase = shape === 'projectile' || shape === 'chain' ? 'body' : shape === 'nova' ? 'area' : shape === 'buff' ? 'aura' : 'cast';
  const main = ph(r, mainPhase);
  const lead = main.find((p) => (p.tags ?? []).includes('hero')) ?? main.find((p) => p.component !== 'motes' && p.component !== 'afterimage') ?? main[0];
  const lb = lead ? bake(lead) : null;
  const tPeak = lead && lb ? (lead.delayMs ?? 0) + (lb.use === 'once' ? peakMs(lb) : 0) : 0;
  const pre = [...ph(r, 'telegraph'), ...ph(r, 'charge')];
  const cast = [];
  if (pre.length) composite(pre, Math.round(span(pre) * 0.7), cast);
  else if (shape !== 'buff') composite(ph(r, 'cast'), tPeak > 40 ? 17 : 0, cast);
  if (shape === 'projectile' || shape === 'chain' || shape === 'nova') composite(ph(r, 'cast'), 25, cast);
  if (shape === 'buff') composite(ph(r, 'cast'), 120, cast);
  const peak = composite(main, tPeak, [], { mover: mainPhase === 'body' });
  if (mainPhase === 'body') {
    const body = main.find((p) => p.component === 'orb' || p.component === 'missile');
    const bf = body && bake(body)?.frames[0]?.[0];
    composite(ph(r, 'trail'), 120, peak, { mover: true, ghostOf: bf?.w ? bf : null });
  }
  if (shape === 'dash') composite(ph(r, 'trail'), 100, peak);
  if (shape === 'nova' && !pre.length) composite(ph(r, 'cast'), tPeak, peak);
  const hit = [];
  const imp = ph(r, 'impact');
  const ib = imp[0] ? bake(imp[0]) : null;
  composite(imp, ib ? peakMs(ib) : 0, hit);
  composite(ph(r, 'status'), 250, hit);
  if (shape === 'nova') composite(main, tPeak + 420, hit);
  else if (shape !== 'buff') {
    const area = ph(r, 'area');
    const al = area.find((p) => (p.tags ?? []).includes('hero')) ?? area[0];
    if (al && bake(al)) composite(area, (al.delayMs ?? 0) + peakMs(bake(al)), hit);
  } else composite(main, 900, hit);
  return [
    { name: pre.length ? (r.owner === 'monster' ? 'tell' : 'charge') : 'cast', ops: cast },
    { name: 'peak', ops: peak },
    { name: 'hit', ops: hit },
  ];
}

const NAME_W = 104;
function skillSheet(title, entries) {
  // entries: { name, sub, recipe }
  const rows = entries.map((e) => {
    const ms = moments(e.recipe);
    const boxes = ms.map((m) => opsBox(m.ops));
    const cw = Math.min(260, Math.max(...boxes.map((b) => b[2] - b[0]))) + 2;
    const ch = Math.min(200, Math.max(...boxes.map((b) => b[3] - b[1]))) + 2;
    return { ...e, ms, boxes, cw, ch };
  });
  const rowW = (r) => NAME_W + 2 * 3 * (r.cw + GAP) + 6;
  let W = textW(title) + 8;
  let H = 12;
  for (const r of rows) {
    const two = rowW(r) > MAXW * 1.5;
    r.two = two;
    W = Math.max(W, two ? NAME_W + 3 * (r.cw + GAP) : rowW(r));
    H += (two ? 2 : 1) * (r.ch + 8) + 4;
  }
  const img = new Img(W, H);
  img.text(4, 3, title);
  let y = 12;
  for (const r of rows) {
    const h = (r.two ? 2 : 1) * (r.ch + 8);
    img.rect(0, y, NAME_W - 2, h, C.label);
    const words = r.name.split(' ');
    let line = '',
      ly = y + 3;
    for (const w of words) {
      if (textW(`${line} ${w}`.trim()) > NAME_W - 6) {
        img.text(3, ly, line);
        ly += 7;
        line = w;
      } else line = `${line} ${w}`.trim();
    }
    img.text(3, ly, line);
    ly += 8;
    for (const s of r.sub) {
      img.text(3, ly, s, C.dim);
      ly += 7;
    }
    [C.grass, C.dungeon].forEach((bg, bi) => {
      r.ms.forEach((m, mi) => {
        const col = r.two ? mi : bi * 3 + mi;
        const cx = NAME_W + col * (r.cw + GAP) + (r.two ? 0 : bi * 6);
        const cy = y + (r.two ? bi * (r.ch + 8) : 0);
        img.rect(cx, cy, r.cw, r.ch, bg);
        const [bx0, by0, bx1, by1] = r.boxes[mi];
        // Centre the content box in the cell (clipped when larger).
        const ox = cx + 1 + Math.floor((r.cw - 2 - (bx1 - bx0)) / 2) - bx0;
        const oy = cy + 1 + Math.floor((r.ch - 2 - (by1 - by0)) / 2) - by0;
        drawOps(img, m.ops, ox, oy, [cx, cy, cx + r.cw, cy + r.ch], bg === C.grass ? 0.6 : 1.0, true);
        img.text(cx + 1, cy + r.ch + 1, m.name, C.dim);
      });
    });
    y += h + 4;
  }
  return img;
}

// ---------------------------------------------------------------- recipe groups
const reg = vfx.createRegistry();
const AUTHORED = reg.authoredSkills();
const isMonster = (s) => s.tags.includes(vfx.MONSTER_TAG);
const carrierText = (c) => `${c.kind} ${c.style ?? c.mode ?? c.core ?? c.body ?? c.motif ?? ''}`.trim();
const derive = (s, owner = 'player') => {
  try {
    return vfx.deriveVfx(s, owner);
  } catch (e) {
    errors.push(`derive ${s.id}#${owner}: ${e.message}`);
    return null;
  }
};
const entry = (s, owner = 'player', name = s.name) => {
  const r = derive(s, owner);
  return r ? { name, sub: [s.id.length > 24 ? s.id.slice(0, 24) : s.id, `${carrierText(r.carrier)} ${r.family}${r.imbue ? '+' + r.imbue : ''}`], recipe: r } : null;
};

const groups = [];
const placed = new Set();
for (const w of vfx.WEAPON_TYPES) {
  const ids = [];
  const queue = [vfx.WEAPONS[w].basic];
  while (queue.length) {
    const id = queue.shift();
    if (ids.includes(id)) continue;
    ids.push(id);
    for (const m of reg.morphsFrom(id)) queue.push(m.to);
  }
  ids.forEach((id) => placed.add(id));
  groups.push({ id: w, title: `${w} tree (${ids.length} skills) - cast / peak / hit on grass, then dungeon`, entries: ids.map((id) => entry(reg.skill(id))) });
}
{
  const roots = vfx.WEAPON_TYPES.map((w) => reg.skill(vfx.WEAPONS[w].basic)).filter((s) => vfx.canTakeElement(s));
  const entries = [];
  for (const el of ELEMENT_IDS) for (const root of roots) {
    const v = reg.skill(vfx.variantId(root.id, el));
    if (v) entries.push(entry(v, 'player', `${el} - ${root.name}`));
  }
  groups.push({ id: 'heart', title: `The Heart: every element infused into ${roots.map((r) => r.name).join(', ')}`, entries });
}
const techIds = [...new Set(vfx.GAME_DATA.monsters.flatMap((m) => (m.techniques ?? []).map((t) => t.skill)))];
groups.push({ id: 'monster', title: `monster techniques (${techIds.length}, owner monster)`, entries: techIds.map((id) => entry(reg.skill(id), 'monster')) });
{
  const seen = new Set();
  const entries = [];
  for (const m of vfx.GAME_DATA.monsters) {
    const look = { id: m.id, family: m.family, element: m.element, rank: m.rank, size: m.size };
    const k = `${m.family}|${m.element ?? ''}`;
    if (seen.has(k)) continue;
    seen.add(k);
    try {
      const r = vfx.deriveAttackVfx(look);
      entries.push({ name: `${m.name}`, sub: [`${m.family} ${m.element ?? ''}`, carrierText(r.carrier)], recipe: r });
    } catch (e) {
      errors.push(`attack ${m.id}: ${e.message}`);
    }
  }
  groups.push({ id: 'monster-attacks', title: `monster auto-attacks (one per family x element)`, entries });
}
const signatures = new Set(reg.classes.flatMap((c) => c.grants ?? []));
const rest = { crown: [], wild: [], craft: [], universal: [] };
for (const s of AUTHORED) {
  if (placed.has(s.id) || isMonster(s)) continue;
  const g = signatures.has(s.id) ? 'crown' : s.tags.includes('echo') ? 'wild' : s.tags.includes('technique') ? 'craft' : 'universal';
  rest[g].push(s);
}
const REST_TITLE = { crown: 'class signatures', wild: 'echo skills (witness-then-learn)', craft: 'trainer techniques', universal: 'universal and fusion skills' };
for (const [g, list] of Object.entries(rest)) if (list.length) groups.push({ id: g, title: `${REST_TITLE[g]} (${list.length})`, entries: list.map((s) => entry(s)) });

// Every authored recipe (player for player skills, monster for every technique) is baked, sheet or not.
let recipes = 0;
for (const s of AUTHORED) {
  for (const owner of isMonster(s) ? ['monster'] : techIds.includes(s.id) ? ['player', 'monster'] : ['player']) {
    const r = derive(s, owner);
    if (!r) continue;
    recipes++;
    for (const p of vfx.recipePieces(r)) bake(p);
  }
}

// ---------------------------------------------------------------- write
const t0 = performance.now();
const written = [];
for (const fam of vfx.FAMILY_IDS) {
  if (!want('family', fam)) continue;
  written.push(save(`family-${fam}`, familySheet(fam)));
}
if (args.includes('--compare'))
  for (const c of ['slash', 'thrust', 'orb', 'missile', 'bolt', 'burst', 'motes', 'puff', 'ring', 'decal', 'sigil', 'nova', 'erupt', 'status', 'aura', 'tell']) {
    if (!want('compare', c)) continue;
    const img = compareSheet(c);
    if (img) written.push(save(`compare-${c}`, img));
  }
// Long groups are split into pages of PAGE skills so each PNG stays reviewable at 3x.
const PAGE = 14;
for (const g of groups) {
  if (!want('skills', g.id)) continue;
  const list = g.entries.filter(Boolean);
  const pages = Math.ceil(list.length / PAGE);
  for (let i = 0; i < pages; i++) {
    const title = pages > 1 ? `${g.title} - page ${i + 1}/${pages}` : g.title;
    written.push(save(pages > 1 ? `skills-${g.id}-${i + 1}` : `skills-${g.id}`, skillSheet(title, list.slice(i * PAGE, (i + 1) * PAGE))));
  }
}
const summary = [
  `recipes baked: ${recipes} authored (+ ${groups.find((g) => g.id === 'heart').entries.length} infusions, auto-attacks on the sheets)`,
  `distinct pieces baked: ${cache.size}, ${Math.round(bakedPx / 1000)} kpx`,
  `bake errors: ${errors.length}`,
  ...errors.map((e) => `  ${e}`),
  '',
  ...written.map((f) => path.basename(f)),
];
fs.writeFileSync(path.join(outDir, 'index.txt'), summary.join('\n') + '\n');
console.log(summary.slice(0, 3 + Math.min(errors.length, 20)).join('\n'));
console.log(`${written.length} sheets in ${outDir} (${Math.round(performance.now() - t0)} ms)`);
if (errors.length) process.exitCode = 1;
