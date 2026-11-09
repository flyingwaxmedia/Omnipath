// Monster telegraphs = hit areas (docs/VFX.md §6.5, §8.1, §11.2 hitbox check, §13 items 1 and 3). Every authored
// monster technique's tell is rasterised as MonsterSkills builds it, and checked against MonsterSkills' own hit tests
// (src/game/systems/tellhit.ts — the same functions it calls when the tell lands):
// - the fill area is exactly the shape (pixel centres), and the hit test agrees with it (zones: the feet inside;
//   cones, lanes, ranges: the player's body overlapping the shape),
// - the rim's outer edge lies within 2 px of the hit-test boundary in 16 directions,
// - the rim is tinted per state, marches (ranges stay still), dissolves in two frames and re-rasterises at most on
//   67 ms ticks (the upload budget).
import { describe, expect, it } from 'vitest';
import { GAME_DATA } from '../src/data';
import type { TellShape } from '../src/game/events';
import { PLAYER_R, inCone, inLane, inRange, inZone, shotHits, shotReach } from '../src/game/systems/tellhit';
import { fairTellMs, GROUND_TRUTH } from '../src/game/vfx/recipe';
import { TellRaster, localTell, rimTint, sdLocal, type LocalTell } from '../src/game/vfx/tellraster';

const SKILLS = new Map(GAME_DATA.skills.map((s) => [s.id, s]));

interface Case {
  name: string;
  g: TellShape;
  casterR: number;
}

/** Every technique tell as MonsterSkills.start builds it (caster at the origin, the player toward `ang`). */
function cases(): Case[] {
  const out: Case[] = [];
  const angs = [0, 0.7, 2.45, -1.9];
  const seen = new Set<string>();
  for (const m of GAME_DATA.monsters) {
    for (const t of m.techniques ?? []) {
      const s = SKILLS.get(t.skill);
      if (!s) continue;
      const sh = s.shape;
      const key = `${t.skill}|${m.radius}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const at = (k: number): string => `${m.id}:${t.skill}@${k}`;
      switch (sh.kind) {
        case 'nova':
          out.push({ name: at(0), g: { kind: 'zone', x: 0, y: 0, rx: sh.radius, ry: sh.radius * 0.65 }, casterR: m.radius });
          break;
        case 'spin': {
          const r = sh.radius + m.radius;
          out.push({ name: at(0), g: { kind: 'zone', x: 0, y: 0, rx: r, ry: r * 0.65 }, casterR: m.radius });
          break;
        }
        case 'strike':
          angs.forEach((a, k) => out.push({ name: at(k), g: { kind: 'cone', x: 0, y: 0, r: sh.range + m.radius, ang: a, arc: (sh.arc * Math.PI) / 180 }, casterR: m.radius }));
          break;
        case 'dash':
          angs.forEach((a, k) => out.push({ name: at(k), g: { kind: 'lane', x0: 0, y0: 0, x1: Math.cos(a) * sh.distance, y1: Math.sin(a) * sh.distance, width: Math.max(24, sh.width) }, casterR: m.radius }));
          break;
        case 'chain':
          out.push({ name: at(0), g: { kind: 'range', x: 0, y: 0, r: sh.range }, casterR: m.radius });
          break;
        default:
          break;
      }
    }
  }
  return out;
}

const CASES = cases();

/** The hit test MonsterSkills runs for this tell, with the player's centre at (x, y). */
function hit(c: Case, x: number, y: number): boolean {
  const p = { x, y };
  switch (c.g.kind) {
    case 'zone':
      return inZone(c.g, p);
    case 'cone':
      return inCone(c.g, p, c.casterR);
    case 'lane':
      return inLane(c.g, p);
    case 'range':
      return inRange(c.g, p);
    default:
      return false;
  }
}

/** An interior point to cast rays from (cones: half way out along the aim; lanes: the middle). */
function interior(s: LocalTell): { x: number; y: number } {
  if (s.kind === 'cone') return { x: Math.cos(s.ang) * s.r * 0.5, y: Math.sin(s.ang) * s.r * 0.5 };
  if (s.kind === 'lane') return { x: s.dx / 2, y: s.dy / 2 };
  return { x: 0, y: 0 };
}

describe('monster telegraphs match the hit tests', () => {
  it('covers every telegraphed shape of every authored technique', () => {
    const kinds = new Set(CASES.map((c) => c.g.kind));
    expect([...kinds].sort()).toEqual(['cone', 'lane', 'range', 'zone']);
    expect(CASES.length).toBeGreaterThan(30);
  });

  it('fills exactly the shape, and the hit test agrees with it (feet in zones, body overlap elsewhere)', () => {
    const bad: string[] = [];
    for (const c of CASES) {
      const { local } = localTell(c.g);
      const r = new TellRaster(local, { family: 'fire', danger: true });
      if (r.fill) {
        const mask = r.fillMask();
        for (let j = 0; j < r.h; j++)
          for (let i = 0; i < r.w; i++) {
            const x = i - r.ox + 0.5;
            const y = j - r.oy + 0.5;
            const sd = sdLocal(local, x, y);
            if (Math.abs(sd) < 0.02) continue;
            if (!!mask[j * r.w + i] !== sd <= 0) bad.push(`${c.name} fill (${i},${j}) sd ${sd.toFixed(2)}`);
          }
      }
      // The hit test on a grid of player positions around the shape.
      const R = c.g.kind === 'lane' ? Math.hypot(c.g.x1, c.g.y1) + c.g.width : c.g.kind === 'cone' || c.g.kind === 'range' ? c.g.r : c.g.kind === 'zone' ? c.g.rx : 0;
      for (let y = -R - 20; y <= R + 20; y += 3)
        for (let x = -R - 20; x <= R + 20; x += 3) {
          const sd = sdLocal(local, x, y);
          const h = hit(c, x, y);
          if (c.g.kind === 'zone') {
            if (Math.abs(sd) > 0.05 && h !== sd <= 0) bad.push(`${c.name} zone hit (${x},${y}) sd ${sd.toFixed(2)}`);
            continue;
          }
          // Body overlap: hit when the body reaches 2 px into the drawn shape, never when it stays 2 px clear (cones
          // also hit anything touching the caster).
          const core = c.g.kind === 'cone' && Math.hypot(x, y) < c.casterR + PLAYER_R;
          if (sd <= PLAYER_R - 2 && !h) bad.push(`${c.name} miss inside (${x},${y}) sd ${sd.toFixed(2)}`);
          if (sd > PLAYER_R + 2 && h && !core) bad.push(`${c.name} hit outside (${x},${y}) sd ${sd.toFixed(2)}`);
        }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  it('puts the rim on the hit-test boundary (within 2 px) in 16 directions', () => {
    const bad: string[] = [];
    for (const c of CASES) {
      const { local } = localTell(c.g);
      const r = new TellRaster(local, { family: 'storm', danger: true });
      const mask = r.rimMask();
      const o = interior(local);
      for (let k = 0; k < 16; k++) {
        const a = (k / 16) * Math.PI * 2;
        const ux = Math.cos(a),
          uy = Math.sin(a);
        // The exact boundary along the ray (bisection on the signed distance).
        let lo = 0,
          hi = 600;
        if (sdLocal(local, o.x + ux * lo, o.y + uy * lo) > 0) continue;
        for (let it = 0; it < 40; it++) {
          const mid = (lo + hi) / 2;
          if (sdLocal(local, o.x + ux * mid, o.y + uy * mid) <= 0) lo = mid;
          else hi = mid;
        }
        // The outermost rim pixel the ray crosses.
        let far = -1;
        for (let d = 0; d <= lo + 6; d += 0.25) {
          const i = Math.floor(o.x + ux * d + r.ox);
          const j = Math.floor(o.y + uy * d + r.oy);
          if (i < 0 || j < 0 || i >= r.w || j >= r.h) continue;
          if (mask[j * r.w + i]) far = d;
        }
        if (far < 0 || Math.abs(far - lo) > 2) bad.push(`${c.name} dir ${k}: rim ${far.toFixed(1)} vs boundary ${lo.toFixed(1)}`);
      }
    }
    expect(bad.slice(0, 12)).toEqual([]);
  });

  it('times zone and cone tells fairly (docs/VFX.md §13 item 3) and draws aim lines toward the player', () => {
    expect(fairTellMs(GROUND_TRUTH.tellMs.strike, 128)).toBe(Math.min(900, 350 + 320));
    const { local } = localTell({ kind: 'aim', x: 0, y: 0, angs: [-0.3, 0, 0.3], len: 180 });
    const r = new TellRaster(local, { family: 'wind', danger: true });
    r.render({ t: 0.5, ms: 0, dissolve: 0 });
    // Each line has pixels near its far end.
    for (const a of [-0.3, 0, 0.3]) {
      let any = false;
      for (let d = 150; d <= 180 && !any; d++) {
        const i = Math.floor(Math.cos(a) * d + r.ox),
          j = Math.floor(Math.sin(a) * d + r.oy);
        for (const [di, dj] of [
          [0, 0],
          [1, 0],
          [0, 1],
          [-1, 0],
          [0, -1],
        ])
          if (r.rim[(j + dj) * r.w + i + di]) any = true;
      }
      expect(any).toBe(true);
    }
  });
});

describe('monster shots (puddlewisp water spit and every projectile technique)', () => {
  it('hits a player on the shooter\'s ground row at any frame length (swept, not a point test per frame)', () => {
    // A 300 px/s spit (size 10) at a player 100 px east on the same ground row, stepped at 16.7 ms .. 200 ms frames.
    for (const dt of [1 / 60, 0.05, 0.12, 0.2]) {
      const p = { x: 200, y: 100 };
      let x = 100;
      let hit = false;
      for (let t = 0; t < 1 && !hit && x < 100 + 220; t += dt) {
        const nx = Math.min(100 + 220, x + 300 * dt);
        hit = shotHits(p, x, 100, nx, 100, 10);
        x = nx;
      }
      expect(hit).toBe(true);
    }
    // The old point test per frame stepped straight past the same player at 133 ms frames (40 px steps over 34 px of
    // hit width: 180 and 220 are both 20 px away).
    const pointHit = [0, 1, 2, 3, 4, 5].some((k) => Math.hypot(200 - (100 + k * 40), 0) <= PLAYER_R + 5);
    expect(pointHit).toBe(false);
    expect([0, 1, 2, 3, 4].some((k) => shotHits({ x: 200, y: 100 }, 100 + k * 40, 100, 140 + k * 40, 100, 10))).toBe(true);
    // Off the line by more than the body + half the shot: no hit.
    expect(shotHits({ x: 200, y: 118 }, 100, 100, 300, 100, 10)).toBe(false);
    expect(shotHits({ x: 200, y: 116 }, 100, 100, 300, 100, 10)).toBe(true);
  });

  it('draws each aim line only as far as its shot can fly (it dies in the first blocked tile)', () => {
    // A wall from x = 160 on: the shot's centre enters it at 160; its line ends there, not at the player behind it.
    const blocked = (x: number) => x >= 160;
    expect(shotReach(blocked, 100, 100, 0, 200)).toBe(56);
    expect(shotReach(() => false, 100, 100, 0, 200)).toBe(200);
    const { local } = localTell({ kind: 'aim', x: 100, y: 80, angs: [0, 0.3], len: 200, lens: [56, 200] });
    expect(local).toMatchObject({ kind: 'aim', lens: [56, 200] });
  });
});

describe('telegraph states and cadence', () => {
  const zone = localTell({ kind: 'zone', x: 0, y: 0, rx: 100, ry: 65 }).local;

  it('tints the rim: danger R3, hot R4 in the last 15 %, the #fff8f0 lock in the last 50 ms; family for self-buffs', () => {
    const a = rimTint(0.4, 400, true, 'fire');
    const b = rimTint(0.9, 120, true, 'fire');
    const c = rimTint(0.98, 30, true, 'fire');
    expect(a).toBe(0xff3c78);
    expect(b).toBe(0xff9ab8);
    expect(c).toBe(0xfff8f0);
    expect(rimTint(0.5, 300, false, 'holy')).not.toBe(a);
  });

  it('marches the rim on 67 ms ticks (a range ring stays still) and grows the fill-up front', () => {
    const r = new TellRaster(zone, { family: 'fire', danger: true });
    r.render({ t: 0.2, ms: 0, dissolve: 0 });
    const rim0 = r.rim.slice();
    const fill0 = r.fill!.slice();
    expect(r.render({ t: 0.21, ms: 30, dissolve: 0 })).toEqual({ fill: false, rim: false });
    const ch = r.render({ t: 0.5, ms: 140, dissolve: 0 });
    expect(ch.rim).toBe(true);
    expect(ch.fill).toBe(true);
    expect(r.rim).not.toEqual(rim0);
    const count = (a: Uint32Array) => a.reduce((n, v) => n + (v ? 1 : 0), 0);
    expect(count(r.fill!)).toBeGreaterThan(count(fill0));
    const ring = new TellRaster(localTell({ kind: 'range', x: 0, y: 0, r: 180 }).local, { family: 'lightning', danger: true });
    ring.render({ t: 0.1, ms: 0, dissolve: 0 });
    expect(ring.render({ t: 0.6, ms: 200, dissolve: 0 }).rim).toBe(false);
  });

  it('re-rasterises at most ~15 times a second (30 in the last 25 % for the rim)', () => {
    const r = new TellRaster(zone, { family: 'ice', danger: true });
    let fills = 0,
      rims = 0;
    for (let ms = 0; ms <= 1000; ms += 1000 / 60) {
      const ch = r.render({ t: ms / 1000, ms, dissolve: 0 });
      fills += ch.fill ? 1 : 0;
      rims += ch.rim ? 1 : 0;
    }
    expect(fills).toBeLessThanOrEqual(16);
    expect(rims).toBeLessThanOrEqual(16 + 8);
  });

  it('re-uploads a marching rim by small stripes that cover every rim pixel', () => {
    for (const c of CASES) {
      const { local } = localTell(c.g);
      const r = new TellRaster(local, { family: 'fire', danger: true });
      r.render({ t: 0.5, ms: 0, dissolve: 0 });
      const covered = new Uint8Array(r.w * r.h);
      for (const q of r.rimRects) for (let j = q.y; j < q.y + q.h; j++) for (let i = q.x; i < q.x + q.w; i++) covered[j * r.w + i] = 1;
      for (let k = 0; k < r.rim.length; k++) if (r.rim[k]) expect(covered[k], c.name).toBe(1);
      const area = r.rimRects.reduce((a, q) => a + q.w * q.h, 0);
      if (c.g.kind === 'zone' || c.g.kind === 'range') expect(area, c.name).toBeLessThan(r.w * r.h * 0.6);
    }
  });

  it('re-uploads only the fill stripes the front crossed', () => {
    const r = new TellRaster(zone, { family: 'fire', danger: true });
    r.render({ t: 0.3, ms: 0, dissolve: 0 });
    const before = r.fill!.slice();
    r.render({ t: 0.36, ms: 70, dissolve: 0 });
    const covered = new Uint8Array(r.w * r.h);
    for (const q of r.fillDirty) for (let j = q.y; j < q.y + q.h; j++) for (let i = q.x; i < q.x + q.w; i++) covered[j * r.w + i] = 1;
    let diff = 0;
    for (let k = 0; k < before.length; k++)
      if (before[k] !== r.fill![k]) {
        diff++;
        expect(covered[k]).toBe(1);
      }
    expect(diff).toBeGreaterThan(0);
    expect(r.fillDirty.reduce((a, q) => a + q.w * q.h, 0)).toBeLessThan(r.w * r.h * 0.6);
  });

  it('dissolves in two dithered frames (half, then a quarter of the pixels)', () => {
    const r = new TellRaster(zone, { family: 'fire', danger: true });
    r.render({ t: 1, ms: 0, dissolve: 0 });
    const count = (a: Uint32Array) => a.reduce((n, v) => n + (v ? 1 : 0), 0);
    const full = count(r.fill!);
    r.render({ t: 1, ms: 0, dissolve: 1 });
    const half = count(r.fill!);
    r.render({ t: 1, ms: 0, dissolve: 2 });
    const quarter = count(r.fill!);
    expect(half).toBeLessThan(full * 0.75);
    expect(quarter).toBeLessThan(half * 0.75);
  });
});
