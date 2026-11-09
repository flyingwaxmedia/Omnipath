// VFX bus bridge (docs/VFX.md §8.2): the Phaser-free half of the runtime step. A fake stage records every play, so
// the event -> phase mapping, the multi-hit restraint, the status-loop cap and the warm set are checked headlessly.
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/data';
import { EventBus, type GameEvents } from '../src/game/events';
import type { Monster } from '../src/game/entities/Monster';
import { VfxBridge, pulsePieces, type BridgePlayer } from '../src/game/vfx/bridge';
import type { PlayCtx, VfxGroup, VfxStage } from '../src/game/vfx/play';
import { deriveVfx, fairTellMs, monsterTellMs } from '../src/game/vfx/recipe';
import type { VfxPiece } from '../src/game/vfx/types';

const reg = createRegistry();
const skill = (id: string) => reg.skill(id)!;

interface Play {
  pieces: readonly VfxPiece[];
  ctx: PlayCtx;
  group: VfxGroup & { ended: boolean };
}

function fakeStage() {
  let now = 0;
  const plays: Play[] = [];
  const warmed: VfxPiece[] = [];
  const ticks: (() => boolean)[] = [];
  let trauma = 0;
  const stage: VfxStage = {
    now: () => now,
    play(pieces, ctx) {
      const group = {
        ended: false,
        end() {
          this.ended = true;
        },
        get done() {
          return this.ended;
        },
      };
      plays.push({ pieces, ctx, group });
      return group;
    },
    warm: (ps) => void warmed.push(...ps),
    trauma: (t) => void (trauma += t),
    tick: (fn) => void ticks.push(fn),
    reduceFlash: false,
    telegraph: () => ({ end() {}, done: true }),
  };
  return {
    stage,
    plays,
    warmed,
    ticks,
    advance: (ms: number) => (now += ms),
    trauma: () => trauma,
  };
}

const player: BridgePlayer = {
  x: 100,
  y: 100,
  sprite: { texture: { key: 'player_sword' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.95, scaleX: 1, scaleY: 1, visible: true },
};

function monster(x = 160, y = 100): Monster {
  return { x, y, alive: true, radius: 12, def: { rank: 'common', element: undefined }, sprite: { displayHeight: 30 } } as unknown as Monster;
}

function setup(windup: number | null = null) {
  const f = fakeStage();
  const bus = new EventBus<GameEvents>();
  let w = windup;
  const bridge = new VfxBridge(f.stage, { player: () => player, sceneNow: () => f.stage.now(), windupId: () => w });
  bridge.attachBus(bus);
  return { ...f, bus, bridge, setWindup: (v: number | null) => (w = v) };
}

const ref = (id: string, castId = 7) => ({ skillId: id, skill: skill(id), element: skill(id).element, castId });
const hitEvent = (id: string, m: Monster, hitIndex: number, extra: Partial<GameEvents['hit']> = {}): GameEvents['hit'] => ({
  ...ref(id),
  source: 'player',
  target: m,
  x: m.x,
  y: m.y,
  damage: 10,
  crit: false,
  resisted: false,
  multiplier: 1,
  killed: false,
  hitIndex,
  ang: 0,
  ...extra,
});

describe('vfx bridge', () => {
  it('plays the charge on castStart and keeps it alive only while the wind-up lasts', () => {
    const t = setup(7);
    t.bus.emit('castStart', { ...ref('heavy_cleave'), x: 100, y: 100, aim: { x: 160, y: 100 }, target: null, durationMs: 300, auto: false });
    const charge = t.plays[0];
    expect(charge.pieces).toEqual(deriveVfx(skill('heavy_cleave')).phases.charge);
    expect(charge.ctx.alive?.()).toBe(true);
    t.setWindup(null);
    expect(charge.ctx.alive?.()).toBe(false);
    // castFire ends it explicitly too.
    t.bus.emit('castFire', { ...ref('heavy_cleave'), x: 100, y: 100, shape: 'strike', aim: { x: 160, y: 100 }, target: null, rank: 1, basic: false, map: 'm' });
    expect(charge.group.ended).toBe(true);
  });

  it('plays a strike swing per skillPulse, sweeping back on odd swings, the final swing with the tier flourish', () => {
    const t = setup();
    const id = 'twin_fang';
    const hits = skill(id).shape.kind === 'strike' ? (skill(id).shape as { hits?: number }).hits ?? 1 : 1;
    for (let i = 0; i < hits; i++) t.bus.emit('skillPulse', { ...ref(id), owner: 'player', index: i, count: hits, ang: 0, aim: { x: 160, y: 100 }, x: 100, y: 100 });
    const casts = t.plays.filter((p) => p.pieces.some((x) => x.component === 'slash'));
    expect(casts.length).toBe(hits);
    if (hits > 1) {
      expect(casts[1].ctx.sense).toBe(-1);
      expect(casts[hits - 1].pieces.some((p) => (p.tags ?? []).includes('lastHit'))).toBe(true);
      expect(casts[0].pieces.some((p) => (p.tags ?? []).includes('lastHit'))).toBe(false);
    }
  });

  it('replaces the carrier with the merge accent on the final swing only', () => {
    const r = deriveVfx(skill('slash'));
    const merged = { ...r, riders: { ...r.riders, merge: { accent: 'extra' as const, family: 'fire' as const, pieces: [{ ...r.phases.cast![0], ramp: 'fire' as const, tags: ['echo' as const, 'lastHit' as const] }] } } };
    const first = pulsePieces(merged, 'cast', 0, 2);
    const last = pulsePieces(merged, 'cast', 1, 2);
    expect(first.some((p) => p.ramp === 'fire')).toBe(false);
    expect(last.filter((p) => p.component === 'slash')).toHaveLength(1);
    expect(last.find((p) => p.component === 'slash')!.ramp).toBe('fire');
  });

  it('follows a projectile with its body and trail, and ends them on projectileEnd (fizzle on expire)', () => {
    const t = setup();
    const mover = { x: 100, y: 100, vx: 300, vy: 0 };
    t.bus.emit('projectileSpawn', { ...ref('firebolt'), owner: 'player', obj: {} as never, mover, angle: 0, speed: 300, range: 200, size: 10, id: 41, x: 100, y: 100 });
    const body = t.plays[0];
    expect(body.pieces.some((p) => p.component === 'orb')).toBe(true);
    expect(body.ctx.body!.y).toBe(86); // movers fly 14 px above their ground point
    mover.x = 140;
    expect(body.ctx.body!.x).toBe(140);
    expect(body.ctx.alive?.()).toBe(true);
    t.bus.emit('projectileEnd', { ...ref('firebolt'), owner: 'player', obj: {} as never, mover, reason: 'expire', id: 41, x: 140, y: 100 });
    expect(body.ctx.alive?.()).toBe(false);
    const fizzle = t.plays[t.plays.length - 1].pieces[0];
    expect(fizzle.component === 'burst' && fizzle.params.cls).toBe('fizzle');
  });

  it('turns later hits of one cast within 100 ms into tick sparks, holds the first spark and adds trauma once', () => {
    const t = setup();
    const m = monster();
    t.bus.emit('hit', hitEvent('heavy_cleave', m, 0));
    t.advance(40);
    t.bus.emit('hit', hitEvent('heavy_cleave', monster(170, 110), 1));
    const [first, second] = t.plays.filter((p) => p.ctx.victim);
    expect(first.pieces.some((p) => p.component === 'burst' && p.params.cls !== 'tick')).toBe(true);
    expect(second.pieces.every((p) => p.component === 'burst' && p.params.cls === 'tick')).toBe(true);
    expect(first.ctx.holdMs).toBeGreaterThan(0);
    expect(second.ctx.holdMs).toBe(0);
    expect(t.trauma()).toBeCloseTo(deriveVfx(skill('heavy_cleave')).juice.trauma);
  });

  it('keeps at most two status loops per target, by priority; one-shots are exempt', () => {
    const t = setup();
    const m = monster();
    const apply = (kind: GameEvents['statusApplied']['kind']) => t.bus.emit('statusApplied', { target: m, kind, x: m.x, y: m.y, untilMs: 5000, source: skill('firebolt') });
    apply('slow');
    apply('burn');
    const [slow, burn] = t.plays;
    apply('freeze'); // outranks slow: slow ends
    expect(slow.group.ended).toBe(true);
    expect(burn.group.ended).toBe(false);
    const n = t.plays.length;
    apply('soak'); // lower than burn and freeze: dropped
    expect(t.plays.length).toBe(n);
    apply('knockback'); // one-shot: always plays
    expect(t.plays.length).toBe(n + 1);
  });

  it('warms every phase, impact variant and status of a loadout', () => {
    const t = setup();
    t.bridge.warmLoadout([skill('slash'), skill('firebolt'), skill('arcane_nova')]);
    const comps = new Set(t.warmed.map((p) => p.component));
    for (const c of ['slash', 'orb', 'nova', 'burst', 'motes', 'status']) expect(comps.has(c as VfxPiece['component'])).toBe(true);
    expect(t.warmed.some((p) => p.component === 'burst' && p.params.cls === 'crit')).toBe(true);
    expect(t.warmed.some((p) => p.component === 'burst' && p.params.cls === 'tick')).toBe(true);
  });

  it('ignores monster-owned events (the World lane draws them)', () => {
    const t = setup();
    const m = monster();
    t.bus.emit('skillPulse', { skillId: 'mon_gust', skill: skill('slash'), owner: m, index: 0, count: 1, ang: 0, x: 0, y: 0 });
    t.bus.emit('novaBlast', { skillId: 'mon_gust', skill: skill('arcane_nova'), owner: m, x: 0, y: 0, radius: 40, heavy: false });
    expect(t.plays).toHaveLength(0);
  });
});

describe('monster telegraph fairness (docs/VFX.md §13)', () => {
  it('gives zone, ring and cone tells at least 350 + 2.5 r ms, capped at 900 by this rule', () => {
    expect(fairTellMs(300, 40)).toBe(450);
    expect(fairTellMs(300, 400)).toBe(900);
    expect(fairTellMs(1200, 400)).toBe(1200);
    for (const s of reg.authoredSkills()) {
      const sh = s.shape;
      const T = monsterTellMs(s, 14);
      if (sh.kind === 'nova') expect(T).toBeGreaterThanOrEqual(Math.min(900, 350 + 2.5 * sh.radius));
      if (sh.kind === 'spin') expect(T).toBeGreaterThanOrEqual(Math.min(900, 350 + 2.5 * (sh.radius + 14)));
      if (sh.kind === 'strike') expect(T).toBeGreaterThanOrEqual(Math.min(900, 350 + 2.5 * (sh.range + 14)));
    }
  });
});
