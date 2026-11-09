// Bolt strip pool (src/game/vfx/boltpool.ts, docs/VFX.md §8.12) and long ring chunks (components/ring.ts chunkLayout):
// - a hop composed from the pool keeps the bolt template's frame grammar (frames, times, reduce-flash, keyline), lands
//   on both ends, and matches the template's look statistically (trunk, fork and glow pixels per frame);
// - composition is deterministic per seed and touches no clock;
// - the fused RGBA pass equals colourise() / glowTwin();
// - big solid rims place 20 px chunks along their gentle stretches (about half the chunks) and never stray > 0.5 px.
import { describe, expect, it } from 'vitest';
import { colourise, glowTwin, indexFrames } from '../src/game/vfx/bake';
import { BoltPool, boltRgba, composeBolt } from '../src/game/vfx/boltpool';
import { chunkLayout, perimeter } from '../src/game/vfx/components/ring';
import { lut } from '../src/game/vfx/ramps';
import { IDX, RING_LONG, type BakeOptions, type BoltParams, type IndexFrame, type VfxPiece } from '../src/game/vfx/types';

const OPTS: BakeOptions = { lut: 'base', reduceFlash: false, keyline: false };
const pool = new BoltPool();
pool.want('lightning', 1);
pool.want('lightning', 0.7);
pool.want('shadow', 1);
pool.flush();

const prmOf = (dx: number, dy: number, seq: 'chain' | 'zap', seed: number): BoltParams => ({
  dx,
  dy,
  jag: seq === 'chain' ? 0.32 : 0.35,
  forks: seq === 'chain' ? 0.35 : 0.3,
  strength: seq === 'chain' ? 1 : 0.7,
  seq,
  seed,
});
const pieceOf = (prm: BoltParams, motif: 'lightning' | 'shadow' = 'lightning'): VfxPiece =>
  ({ component: 'bolt', params: prm, ramp: motif, motif, anchor: { to: 'caster', dy: 0 } }) as unknown as VfxPiece;
const lit = (f: IndexFrame, pred: (v: number) => boolean = (v) => v > 0) => f.body.reduce((a, v) => a + (pred(v) ? 1 : 0), 0);
/** Lit pixels within `r` px of a local point. */
const near = (f: IndexFrame, x: number, y: number, r = 2) => {
  let n = 0;
  for (let j = 0; j < f.h; j++) for (let i = 0; i < f.w; i++) if (f.body[j * f.w + i] && Math.hypot(i - f.ox - x, j - f.oy - y) <= r) n++;
  return n;
};

describe('bolt strip pool', () => {
  it('bakes a look once (no clock in the core) and serves it only when complete', () => {
    const p = new BoltPool();
    expect(p.look('lightning', 1)).toBeNull();
    p.want('lightning', 1);
    expect(p.pending).toBe(true);
    let t = 0;
    p.step(5, () => (t += 1)); // a slice of 5 clock units
    expect(p.look('lightning', 1)).toBeNull();
    p.flush();
    const look = p.look('lightning', 1)!;
    expect(look.trunk.length).toBeGreaterThan(100);
    expect(look.fork.length).toBeGreaterThan(100);
    expect(look.trunkMicro.size).toBeGreaterThan(20);
  });

  it('keeps the template frame grammar: frames, times, reduce-flash and keyline', () => {
    for (const seq of ['chain', 'zap'] as const) {
      for (const opts of [OPTS, { ...OPTS, reduceFlash: true }, { ...OPTS, keyline: true }]) {
        const prm = prmOf(130, -40, seq, 17);
        const tmpl = indexFrames(pieceOf(prm), 0, opts);
        const comp = composeBolt(prm, pool.look('lightning', prm.strength)!, opts);
        expect(comp.map((f) => f.ms)).toEqual(tmpl.map((f) => f.ms));
        expect(comp.map((f) => lit(f) > 0)).toEqual(tmpl.map((f) => lit(f) > 0));
        if (opts.reduceFlash) for (const f of comp) expect(lit(f, (v) => v === IDX.WHITE)).toBe(0);
        if (opts.keyline) expect(lit(comp[0], (v) => v === IDX.OUTLINE)).toBeGreaterThan(0);
      }
    }
  });

  it('lands on both ends of every hop', () => {
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      for (const L of [24, 90, 200]) {
        const prm = prmOf(Math.round(Math.cos(a) * L), Math.round(Math.sin(a) * L), k % 2 ? 'zap' : 'chain', 100 + k);
        const f = composeBolt(prm, pool.look('lightning', prm.strength)!, OPTS)[0];
        expect(near(f, 0, 0)).toBeGreaterThan(0);
        expect(near(f, prm.dx, prm.dy)).toBeGreaterThan(0);
      }
    }
  });

  it('matches the template look: trunk, fork and glow pixels per frame within 30 %', () => {
    const thin = (v: number) => v === IDX.R3 || v === IDX.R2;
    for (const [L, seq] of [
      [60, 'chain'],
      [150, 'chain'],
      [120, 'zap'],
    ] as const) {
      const sum = { t: [0, 0, 0, 0], p: [0, 0, 0, 0] };
      for (let i = 0; i < 40; i++) {
        const a = (i / 40) * Math.PI * 2;
        const prm = prmOf(Math.round(Math.cos(a) * L), Math.round(Math.sin(a) * L), seq, 900 + i);
        const T = indexFrames(pieceOf(prm), 0, OPTS);
        const P = composeBolt(prm, pool.look('lightning', prm.strength)!, OPTS);
        for (const [fr, o] of [
          [T, sum.t],
          [P, sum.p],
        ] as const) {
          o[0] += lit(fr[0]);
          o[1] += lit(fr[1]);
          o[2] += lit(fr[0], thin) + lit(fr[1], thin);
          o[3] += fr[0].glow.reduce((s, v) => s + (v ? 1 : 0), 0);
        }
      }
      sum.p.forEach((v, k) => {
        expect(v / sum.t[k]).toBeGreaterThan(0.7);
        expect(v / sum.t[k]).toBeLessThan(1.3);
      });
    }
  });

  it('is deterministic per seed, varies between seeds, and serves the inverted (shadow) look', () => {
    const look = pool.look('lightning', 1)!;
    const a = composeBolt(prmOf(120, 30, 'chain', 5), look, OPTS);
    const b = composeBolt(prmOf(120, 30, 'chain', 5), look, OPTS);
    const c = composeBolt(prmOf(120, 30, 'chain', 6), look, OPTS);
    expect(a.map((f) => [...f.body].join())).toEqual(b.map((f) => [...f.body].join()));
    expect(a[0].body.join()).not.toEqual(c[0].body.join());
    const inv = composeBolt(prmOf(120, 30, 'chain', 5), pool.look('shadow', 1)!, OPTS);
    expect(lit(inv[0], (v) => v === IDX.R4)).toBeGreaterThan(0);
  });

  it('turns frames into RGBA exactly as colourise() / glowTwin() do', () => {
    const table = lut('lightning', 'base');
    const fr = composeBolt(prmOf(140, 60, 'chain', 77), pool.look('lightning', 1)!, OPTS);
    for (const f of fr) {
      const { body, glow } = boltRgba(f, table);
      const b = colourise(f, table);
      const g = glowTwin(f);
      expect([body.w, body.h, body.ox, body.oy]).toEqual([b.w, b.h, b.ox, b.oy]);
      expect([glow.w, glow.h, glow.ox, glow.oy]).toEqual([g.w, g.h, g.ox, g.oy]);
      expect([...body.data].join()).toBe([...b.data].join());
      expect([...glow.data].join()).toBe([...g.data].join());
    }
  });
});

describe('long ring chunks', () => {
  /** Max distance (px) between a straight chunk tangent at th (half-length l) and the ellipse. */
  const stray = (rx: number, ry: number, th: number, l: number) => {
    const sp = Math.hypot(rx * Math.sin(th), ry * Math.cos(th));
    const curve = (sp * sp * sp) / (rx * ry);
    return (l * l) / (2 * curve);
  };

  it('halves the chunks of a big circle and stays within 0.5 px of the rim', () => {
    for (const r of [140, 200, 300]) {
      const { ths, long } = chunkLayout(r, r);
      expect(long.every(Boolean)).toBe(true);
      expect(ths.length).toBeLessThanOrEqual(Math.ceil(perimeter(r, r) / 20) + 1);
      expect(ths.length).toBeGreaterThanOrEqual(Math.floor(perimeter(r, r) / 20) - 1);
      for (const th of ths) expect(stray(r, r, th, 10)).toBeLessThanOrEqual(0.5);
    }
  });

  it('keeps 10 px chunks where a wide ellipse curves tightly, long ones elsewhere, with no gaps', () => {
    const rx = 180,
      ry = 180 * 0.65;
    const { ths, long } = chunkLayout(rx, ry);
    expect(long.some(Boolean)).toBe(true);
    expect(long.some((v) => !v)).toBe(true);
    ths.forEach((th, k) => {
      expect(stray(rx, ry, th, long[k] ? 10 : 5)).toBeLessThanOrEqual(long[k] ? 0.5 : 0.6);
      // Neighbouring centres sit one chunk length apart along the rim (never a gap wider than a chunk).
      const nx = ths[(k + 1) % ths.length];
      const d = Math.hypot(rx * (Math.cos(nx) - Math.cos(th)), ry * (Math.sin(nx) - Math.sin(th)));
      expect(d).toBeLessThanOrEqual((long[k] ? 20 : 10) + 1.5);
    });
    // Fewer chunks than the 10 px layout of the same rim.
    expect(ths.length).toBeLessThan(Math.ceil(perimeter(rx, ry) / 10) * 0.75);
    expect(RING_LONG.fromR).toBe(128);
  });
});
