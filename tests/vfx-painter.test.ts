// Package P (docs/VFX.md §10, §11.1): painter, ramps, components and bake over the template grid.
// Determinism, frame budgets, index discipline, alpha discipline, timing grammar and bake cost.
import { describe, expect, it } from 'vitest';
import * as bake from '../src/game/vfx/bake';
import * as ramps from '../src/game/vfx/ramps';
import { ORPHAN_CHECKED, TEMPLATES, outlineAllowed } from '../src/game/vfx/components';
import { DEFAULTS, GRID_MOTIFS, gridPieces, piece } from '../src/game/vfx/grid';
import { Painter, countOrphans, type PFrame } from '../src/game/vfx/painter';
import { hashSeed, mulberry32 } from '../src/core/rng';
import {
  BODY_PX,
  COMPONENT_IDS,
  FAMILY_IDS,
  IDX,
  INDEX_COUNT,
  RING_WHOLE_MAX,
  UNIQUE_DIRS,
  UTILITY_RAMP_IDS,
  VSYNC_MS,
  type BakedPiece,
  type RampId,
  type VfxBakeApi,
  type VfxPiece,
  type VfxRampApi,
} from '../src/game/vfx/types';

// Compile-time pins to the module contract (docs/VFX.md §10.2).
const bakeApi: VfxBakeApi = bake;
const rampApi: VfxRampApi = ramps;

const ALL_RAMPS: readonly RampId[] = [...FAMILY_IDS, ...UTILITY_RAMP_IDS];

/** Every grid piece over the QA motifs, plus danger for telegraph-only pieces. */
function grid(): VfxPiece[] {
  const out: VfxPiece[] = [];
  for (const c of COMPONENT_IDS) for (const fam of GRID_MOTIFS) out.push(...gridPieces(c, fam));
  out.push(...gridPieces('tell', 'danger'), ...gridPieces('ring', 'danger').filter((p) => p.component === 'ring' && p.params.style === 'dashed'));
  // Motif-dependent templates in every family (family marks, bolt inks, smear languages).
  for (const fam of FAMILY_IDS)
    out.push(
      piece('burst', { cls: 'magic', size: 'm' }, fam),
      piece('slash', { ...DEFAULTS.slash, tier: 2 }, fam),
      piece('slash', { ...DEFAULTS.slash, form: 'chop' }, fam),
      piece('bolt', DEFAULTS.bolt, fam),
    );
  // Dedupe by bake key: motif-free templates share geometry across families.
  const seen = new Set<string>();
  return out.filter((p) => {
    const k = bake.pieceKey(p);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const GRID = grid();
/** First bake of every grid piece (filled by the determinism test, reused by the grammar test). */
const BAKED = new Map<string, BakedPiece>();
const baked = (p: VfxPiece): BakedPiece => {
  const k = bake.pieceKey(p);
  let b = BAKED.get(k);
  if (!b) BAKED.set(k, (b = bake.bakePiece(p)));
  return b;
};

function fnv(h: number, data: ArrayLike<number>): number {
  for (let i = 0; i < data.length; i++) h = Math.imul(h ^ data[i], 16777619) >>> 0;
  return h;
}

function hashBaked(b: BakedPiece): number {
  let h = 2166136261;
  for (const strip of [...b.frames, ...b.glow])
    for (const f of strip) h = fnv(fnv(h, [f.w, f.h, f.ox, f.oy, f.ms]), f.data);
  return h;
}

/** Index frames of every unique direction. */
function allIndexFrames(p: VfxPiece, opts?: Parameters<typeof bake.indexFrames>[2]): PFrame[][] {
  const t = TEMPLATES[p.component] as unknown as { dirs(x: unknown): 1 | 8 | 16 };
  const out: PFrame[][] = [];
  for (let u = 0; u < UNIQUE_DIRS[t.dirs(p.params)]; u++) out.push(bake.indexFrames(p, u, opts) as PFrame[]);
  return out;
}

const empty = (f: { body: Uint8Array }) => f.body.every((v) => v === 0);

/** Content bounds budget per piece (docs/VFX.md §5 cells), checked on trimmed baked frames. */
function budget(p: VfxPiece): [number, number] {
  switch (p.component) {
    case 'slash': {
      const s = p.params;
      if (s.form === 'chop') return [48, Math.ceil(1.4 * s.r) + 10];
      return [2 * s.r + 16, 2 * s.r + 16];
    }
    case 'thrust':
      return [2 * p.params.len + 24, 2 * p.params.len + 24];
    case 'orb':
    case 'missile':
      return [p.params.cell, p.params.cell];
    case 'bolt':
      return [512, 512];
    case 'burst':
      return p.params.cls === 'star' ? [64, 64] : p.params.cls === 'tick' ? [16, 16] : [{ s: 16, m: 24, l: 32 }[p.params.size], { s: 16, m: 24, l: 32 }[p.params.size]];
    case 'motes':
      return [32, 32];
    case 'puff':
      return p.params.r <= 7 ? [24, 24] : [32, 32];
    case 'ring': {
      const r = p.params;
      if (Math.max(r.r, r.anim === 'expand' || r.anim === 'contract' ? (r.r0 ?? 0) : 0) > RING_WHOLE_MAX) return [16, 16];
      const m = Math.max(r.r, r.r0 ?? (r.anim === 'contract' ? Math.min(RING_WHOLE_MAX, r.r * 1.6) : 0));
      return [2 * m + 2 * r.thick + 6, 2 * m + 2 * r.thick + 6];
    }
    case 'decal':
      return p.params.shape === 'line' ? [2 * p.params.r + 21, 2 * p.params.r + 21] : [2 * p.params.r + 5, 2 * p.params.r + 5];
    case 'sigil':
      return [2 * p.params.r + 5, 2 * p.params.r + 5];
    case 'nova':
      return [2 * p.params.c + 16, 2 * p.params.c + 16];
    case 'erupt': {
      // Doc unit sizes (w, h at scale m), x scale, + 10 px slack for embers, smoke caps and chips.
      const doc: Record<string, [number, number]> = {
        'flame-column': [16, 32],
        'lava-geyser': [16, 28],
        'rock-spike': [12, 24],
        'crystal-spike': [12, 24],
        'ice-spike': [10, 22],
        'splash-crown': [24, 16],
        'gust-swirl': [24, 16],
        'sky-bolt': [24, 220],
        'light-pillar': [14, 120],
        tendril: [12, 28],
        'moon-mote': [12, 12],
        'star-shard': [8, 14],
        'spore-puff': [16, 16],
        'smoke-sheet': [32, 12],
        debris: [16, 16],
        'ki-ripple': [24, 16],
      };
      const k = { s: 0.75, m: 1, l: 1.25 }[p.params.scale];
      const [w, h] = doc[p.params.unit];
      return [Math.ceil(w * k) + 10, Math.ceil(h * k) + 10];
    }
    case 'status': {
      if (p.params.unit === 'pip') return [9, 9];
      const s = { S: 1, M: 1, L: 1.4, W: 1.8 }[p.params.body];
      if (p.params.unit === 'beam') return [Math.ceil(9 * s), Math.ceil(48 * s) + 8];
      return [BODY_PX[p.params.body] + 16, BODY_PX[p.params.body] + 16];
    }
    case 'aura': {
      const bh = BODY_PX[p.params.body];
      return [Math.round(bh * 0.8) + 24, bh + 24];
    }
    case 'tell':
      return [17, 17];
    case 'afterimage':
      return [0, 0];
    // v4 components (docs/VFX.md §5): cells as their templates document them.
    case 'field':
      return p.params.size === 'm' ? [31, 26] : [22, 18];
    case 'warp': {
      const bh = BODY_PX[p.params.body];
      return [Math.round(bh * 0.8) + 28, bh + 16];
    }
    case 'mend': {
      const bh = BODY_PX[p.params.body];
      return [Math.round(bh * 0.8) + 24, bh + 26];
    }
    case 'shell': {
      const bh = BODY_PX[p.params.body];
      return [Math.round(bh * 0.8) + 30, bh + 30];
    }
    case 'emblem':
      return ({ full: [27, 40], finisher: [45, 45], cashIn: [41, 41], stance: [51, 23], step: [41, 11], mark: [21, 21] } as const)[p.params.kind] as [number, number];
  }
}

describe('vfx ramps', () => {
  it('implements the §3.2 palettes exactly and packs LUTs for this platform', () => {
    expect(Object.keys(rampApi.RAMPS).sort()).toEqual([...ALL_RAMPS].sort());
    expect(ramps.RAMPS.fire.R).toEqual(['#4a1408', '#a02a0c', '#e05a18', '#ff9a2a', '#ffd860', '#fff8d8']);
    expect(ramps.RAMPS.danger.accent).toBe('#fff8f0');
    expect(ramps.RAMPS.arcane.S[3]).toBe('#6c64c8');
    expect(ramps.RAMPS.heal.R[5]).toBe('#f0fff2');
    expect(ramps.RAMPS.smoke.accent).toBe(ramps.RAMPS.smoke.R[5]);
    for (const id of ALL_RAMPS)
      for (const v of ['base', 'shift', 'monster', 'reduceFlash'] as const) {
        const t = rampApi.lut(id, v);
        expect(t).toHaveLength(INDEX_COUNT);
        expect(t[0]).toBe(0);
        for (let i = 1; i < INDEX_COUNT; i++) {
          const [r, g, b, a] = ramps.unpack(t[i]);
          expect(a).toBe(255);
          expect(r + g + b).toBeGreaterThan(0); // never pure black
        }
      }
    // Byte order: a Uint32 view over RGBA bytes reproduces the hex.
    const bytes = new Uint8ClampedArray(4);
    new Uint32Array(bytes.buffer)[0] = ramps.lut('fire')[IDX.R0];
    expect([...bytes]).toEqual([0x4a, 0x14, 0x08, 255]);
    expect(ramps.unpack(ramps.lut('fire', 'reduceFlash')[IDX.WHITE])).toEqual([...ramps.hexToRgb('#fff8d8'), 255]);
    expect(ramps.unpack(ramps.lut('ice', 'monster')[IDX.ACCENT])).toEqual([...ramps.hexToRgb(ramps.RAMPS.danger.R[3]), 255]);
    expect(ramps.fit(ramps.RAMPS.fire, 3)).toEqual(['#4a1408', ramps.RAMPS.fire.R[3], '#fff8d8']);
  });
});

describe('vfx painter', () => {
  it('fills by inverse mapping: a rotated shape is a pixel-exact transpose at 90 degrees', () => {
    const a = new Painter(21, 21, 10, 10).heading(0);
    const b = new Painter(21, 21, 10, 10).heading(Math.PI / 2);
    for (const p of [a, b]) {
      p.stroke(0, 0, 8, 0, (t) => 3 * (1 - t) + 1, IDX.R4);
      p.disc(3, -2, 1.5, IDX.R5);
    }
    for (let y = 0; y < 21; y++) for (let x = 0; x < 21; x++) expect(b.body[x * 21 + (20 - y)]).toBe(a.body[y * 21 + x]);
  });

  it('dithers by Bayer coverage: 50% is a checkerboard, 25% every other pixel of every other row', () => {
    const p = new Painter(8, 8, 0, 0);
    p.fill(0, 0, 7, 7, () => IDX.R3, 0.5);
    expect(p.count()).toBe(32);
    const q = new Painter(8, 8, 0, 0);
    q.fill(0, 0, 7, 7, () => IDX.R3, 0.25);
    expect(q.count()).toBe(16);
    expect(countOrphans(q.frame(17))).toBe(16);
  });

  it('outlines matter on transparent 4-neighbours only and removes lone pixels', () => {
    const p = new Painter(9, 9, 4, 4);
    p.disc(0, 0, 2, IDX.R3);
    p.outline();
    expect(p.get(4, 4)).toBe(IDX.R3);
    expect(p.get(4, 1)).toBe(IDX.OUTLINE);
    expect(p.get(1, 1)).toBe(0);
    p.set(8, 8, IDX.R5);
    expect(p.orphans()).toBe(1);
    expect(p.get(8, 8)).toBe(0);
  });
});

describe('vfx templates', () => {
  it('registers one template per component and pins the bake API', () => {
    for (const c of COMPONENT_IDS) expect(TEMPLATES[c].id).toBe(c);
    expect(typeof bakeApi.bakePhase).toBe('function');
    expect(GRID.length).toBeGreaterThan(300);
  });

  it('is deterministic: equal hashes across two bakes and in shuffled bake order', () => {
    const order = GRID.map((_, i) => i);
    const rnd = mulberry32(hashSeed('vfx-test-shuffle'));
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rnd() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    const a = new Map<string, number>();
    for (const p of GRID) a.set(bake.pieceKey(p), hashBaked(baked(p)));
    for (const i of order) {
      const p = GRID[i];
      expect(hashBaked(bake.bakePiece(p)), bake.pieceKey(p)).toBe(a.get(bake.pieceKey(p)));
    }
  }, 120_000);

  it('keeps frame grammar, budgets and index discipline over the whole grid', () => {
    const problems: string[] = [];
    const bad = (p: VfxPiece, msg: string) => {
      if (problems.length < 40) problems.push(`${bake.pieceKey(p)}: ${msg}`);
    };
    for (const p of GRID) {
      const t = TEMPLATES[p.component] as unknown as { use(x: unknown): string };
      const use = t.use(p.params);
      const dirs = allIndexFrames(p);
      if (use === 'runtime') {
        if (dirs.some((d) => d.length)) bad(p, 'runtime template baked frames');
        continue;
      }
      const b = baked(p);
      const [bw, bh] = budget(p);
      for (const strip of b.frames)
        for (const f of strip) {
          if (f.w > bw || f.h > bh) bad(p, `frame ${f.w}x${f.h} over budget ${bw}x${bh}`);
          for (let i = 0; i < f.data.length; i += 4) {
            const a = f.data[i + 3];
            if (a !== 0 && a !== 255) {
              bad(p, `alpha ${a}`);
              break;
            }
            if (a === 255 && f.data[i] + f.data[i + 1] + f.data[i + 2] === 0) {
              bad(p, 'pure black');
              break;
            }
          }
        }
      for (const strip of b.glow) for (const f of strip) if (f.w > bw + 8 || f.h > bh + 8) bad(p, `glow ${f.w}x${f.h} over budget`);
      dirs.forEach((frames, u) => {
        if (!frames.length) return bad(p, `u${u}: no frames`);
        const total = frames.reduce((s, f) => s + f.ms, 0);
        let at = 0;
        const nonEmpty = frames.map((f, k) => (empty(f) ? -1 : k)).filter((k) => k >= 0);
        if (!nonEmpty.length) bad(p, `u${u}: every frame is empty`);
        const tail = new Set(use === 'once' ? nonEmpty.slice(-2) : []);
        frames.forEach((f, k) => {
          if (!VSYNC_MS.includes(f.ms)) bad(p, `u${u} f${k}: ${f.ms} ms is not a VSYNC_MS value`);
          if (f.body.length !== f.w * f.h || f.glow.length !== f.w * f.h) bad(p, 'buffer size');
          let white = 0,
            outline = 0;
          for (const v of f.body) {
            if (v >= INDEX_COUNT) bad(p, `index ${v}`);
            if (v === IDX.WHITE) white++;
            if (v === IDX.OUTLINE) outline++;
          }
          for (const g of f.glow) if (g > 3) bad(p, `glow level ${g}`);
          if (white) {
            if (use !== 'once') bad(p, `u${u} f${k}: WHITE in a ${use} strip`);
            else if (f.kind !== 'hero') bad(p, `u${u} f${k}: WHITE on an undeclared (${f.kind}) frame`);
            else if (at >= total * 0.3) bad(p, `u${u} f${k}: hero frame at ${at}/${total} ms (after the first 30%)`);
          }
          if (outline && !outlineAllowed(p)) bad(p, `u${u} f${k}: OUTLINE in a non-matter piece`);
          if (ORPHAN_CHECKED.includes(p.component) && !tail.has(k) && !empty(f)) {
            const n = countOrphans(f);
            if (n > 2) bad(p, `u${u} f${k}: ${n} orphan pixels`);
          }
          at += f.ms;
        });
        if (use === 'once' && !empty(frames[frames.length - 1])) bad(p, `u${u}: one-shot does not end empty`);
        if (use === 'loop' && empty(frames[0])) bad(p, `u${u}: loop starts empty`);
      });
      if (b.heroFrames.some((k) => k >= (b.frames[0]?.length ?? 0))) bad(p, 'hero index out of range');
    }
    expect(problems).toEqual([]);
  }, 180_000);

  it('bakes every component for every family it supports (17 families + utility ramps)', () => {
    for (const c of COMPONENT_IDS) {
      for (const ramp of ALL_RAMPS) {
        const motif = (FAMILY_IDS as readonly string[]).includes(ramp) ? (ramp as VfxPiece['motif']) : 'steel';
        const p = piece(c, DEFAULTS[c] as never, motif, { ramp });
        const b = bake.bakePiece(p);
        expect(b.key.endsWith(`|${ramp}|base`)).toBe(true);
        if (b.use === 'runtime') continue;
        expect(b.frames).toHaveLength(UNIQUE_DIRS[b.dirs]);
        expect(b.frames[0].some((f) => f.w > 0), `${c} in ${ramp}`).toBe(true);
        expect(b.glow[0]).toHaveLength(b.frames[0].length);
        if (ramps.NO_GLOW.has(ramp) && c !== 'missile') expect(b.glow.flat().every((g) => g.w === 0)).toBe(true);
      }
    }
  }, 60_000);

  it('honours bake options: reduce-flash, keyline, monster LUT and anchor halves', () => {
    const hero = piece('slash', { ...DEFAULTS.slash, weight: 'heavy' }, 'fire');
    const plain = allIndexFrames(hero);
    const calm = allIndexFrames(hero, { reduceFlash: true });
    expect(plain[0].some((f) => f.kind === 'contrast')).toBe(true);
    for (const strip of calm)
      for (const f of strip) {
        expect(f.kind === 'contrast' || f.kind === 'blank').toBe(false);
        expect(f.body.includes(IDX.WHITE)).toBe(false);
      }
    // Same total time after dropping contrast frames (merged times re-snap to VSYNC_MS: +-2 ms).
    const ms = (s: PFrame[]) => s.reduce((a, f) => a + f.ms, 0);
    expect(Math.abs(ms(calm[0]) - ms(plain[0]))).toBeLessThanOrEqual(2);
    expect(bake.bakePiece(hero).heroFrames.length).toBeGreaterThan(0);
    expect(bake.bakePiece(hero, { lut: 'monster' }).heroFrames).toEqual([]);
    expect(bake.pieceKey(hero, { reduceFlash: true })).not.toBe(bake.pieceKey(hero));

    const keyed = allIndexFrames(piece('orb', DEFAULTS.orb, 'ice'), { keyline: true });
    expect(keyed.flat().some((f) => f.body.includes(IDX.OUTLINE))).toBe(true);

    const bolt = piece('bolt', DEFAULTS.bolt, 'lightning');
    expect(allIndexFrames(bolt)[0].filter((f) => f.kind === 'blank')).toHaveLength(2);
    expect(allIndexFrames(bolt, { reduceFlash: true })[0].some((f) => f.kind === 'blank')).toBe(false);

    for (const c of ['ring', 'aura'] as const) {
      const back = piece(c, DEFAULTS[c] as never, 'holy', { anchor: { to: 'caster', dy: 0, half: 'back' } });
      const front = piece(c, DEFAULTS[c] as never, 'holy', { anchor: { to: 'caster', dy: 0, half: 'front' } });
      expect(bake.pieceKey(back)).not.toBe(bake.pieceKey(front));
      for (const f of allIndexFrames(back)[0])
        for (let y = f.oy; y < f.h; y++) for (let x = 0; x < f.w; x++) expect(f.body[y * f.w + x], `${c} back half below the anchor`).toBe(0);
      for (const f of allIndexFrames(front)[0])
        for (let y = 0; y < f.oy - 1; y++) for (let x = 0; x < f.w; x++) if (c === 'ring') expect(f.body[y * f.w + x]).toBe(0);
    }
  });

  it('bakes big ring pieces by outward normal: u = 0 has its bright rim on the east side', () => {
    const p = piece('ring', { ...DEFAULTS.ring, r: 120 }, 'fire');
    const [f] = bake.indexFrames(p, 0);
    let hot = -Infinity,
      cool = Infinity;
    for (let y = 0; y < f.h; y++)
      for (let x = 0; x < f.w; x++) {
        const v = f.body[y * f.w + x];
        if (v === IDX.R5) hot = Math.max(hot, x);
        if (v === IDX.R3) cool = Math.min(cool, x);
      }
    expect(hot).toBeGreaterThan(cool);
    expect(bake.bakePiece(p).use).toBe('pieces');
  });

  it('bakes within the time budget', () => {
    // Boot set (docs/VFX.md §8.5): motes, puffs, danger + steel ring pieces, steel bursts, tell pieces.
    const boot: VfxPiece[] = [
      ...gridPieces('motes', 'steel'),
      ...gridPieces('puff', 'steel').map((p) => ({ ...p, ramp: 'smoke' as const })),
      ...(['solid', 'dashed'] as const).flatMap((style) =>
        ([1, 2, 3] as const).flatMap((thick) => (['hot', 'lit', 'mid', 'dim'] as const).map((ink) => piece('ring', { ...DEFAULTS.ring, r: 96, style, thick, ink }, 'danger'))),
      ),
      ...gridPieces('burst', 'steel').filter((p) => p.component === 'burst' && p.params.cls !== 'strong'),
      ...gridPieces('tell', 'danger'),
    ];
    const t0 = performance.now();
    bake.bakePhase(boot);
    const bootMs = performance.now() - t0;
    // Per-frame cost on 48 px frames (target <= 0.5 ms per 48^2 frame on device).
    const orbs = gridPieces('orb', 'arcane').filter((p) => p.component === 'orb' && p.params.cell === 24).map((p) => piece('orb', { ...(p.params as typeof DEFAULTS.orb), cell: 48 }, 'arcane'));
    let frames = 0;
    const t1 = performance.now();
    for (const p of orbs) for (const s of bake.bakePiece(p).frames) frames += s.length;
    const perFrame = (performance.now() - t1) / frames;
    console.log(`vfx bake: boot set ${boot.length} pieces in ${bootMs.toFixed(1)} ms; ${perFrame.toFixed(3)} ms per 48px frame`);
    expect(bootMs).toBeLessThan(600);
    expect(perFrame).toBeLessThan(1);
  });
});
