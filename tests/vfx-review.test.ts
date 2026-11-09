// Adversarial review of the VFX runtime integration (docs/VFX.md §8.11): regressions for the Phaser-free halves.
// - Status / buff loops end with their gameplay state (a dead monster, a status run out) and NOT early after a panel
//   pause: their deadlines live on the runtime's world clock (VfxStage.now), which stands still through the pauses,
//   loop sleeps and hit-stops that Combat shifts its own timers over. Scene time (sceneNow) jumps there.
// - "Reduce shake & flashes" follows prefers-reduced-motion on a fresh install; a stored choice wins; a change is
//   announced (the runtime re-warms its bakes in the new variant).
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createRegistry } from '../src/data';
import type { Monster } from '../src/game/entities/Monster';
import { EventBus, type GameEvents } from '../src/game/events';
import { VfxBridge, type BridgePlayer } from '../src/game/vfx/bridge';
import type { PlayCtx, VfxStage } from '../src/game/vfx/play';
import { WorldBridge } from '../src/game/vfx/world';

const reg = createRegistry();
const skill = (id: string) => reg.skill(id)!;

/** A fake stage whose world clock (now) and the scene clock move separately, like the game's. */
function clocks() {
  let world = 0;
  let scene = 0;
  const plays: { ctx: PlayCtx }[] = [];
  const stage: VfxStage = {
    now: () => world,
    play(_pieces, ctx) {
      plays.push({ ctx });
      return { end() {}, done: false };
    },
    warm: () => {},
    trauma: () => {},
    tick: () => {},
    reduceFlash: false,
    telegraph: () => ({ end() {}, done: true }),
  };
  return {
    stage,
    plays,
    sceneNow: () => scene,
    /** A normal frame: both clocks move. */
    run: (ms: number) => {
      world += ms;
      scene += ms;
    },
    /** A panel pause / loop sleep: scene time jumps, the world clock stands still (Combat shifts its timers). */
    pause: (ms: number) => {
      scene += ms;
    },
  };
}

const player: BridgePlayer = {
  x: 100,
  y: 100,
  sprite: { texture: { key: 'player_sword' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.95, scaleX: 1, scaleY: 1, visible: true },
};
const monster = (): Monster => ({ x: 160, y: 100, alive: true, radius: 12, maxHp: 100, def: { rank: 'common', element: undefined, id: 'slime' }, sprite: { displayHeight: 30 } }) as unknown as Monster;

describe('vfx review: loops end with their gameplay state, never early after a pause', () => {
  it('a monster status loop survives a panel pause, then ends on time', () => {
    const c = clocks();
    const bus = new EventBus<GameEvents>();
    new VfxBridge(c.stage, { player: () => player, sceneNow: c.sceneNow, windupId: () => null }).attachBus(bus);
    const m = monster();
    bus.emit('statusApplied', { target: m, kind: 'poison', x: m.x, y: m.y, untilMs: c.sceneNow() + 4000, source: skill('firebolt') });
    const alive = c.plays[c.plays.length - 1].ctx.alive!;
    c.run(1000);
    c.pause(10000); // the bag was open for 10 s: Combat shifted the poison by 10 s too
    c.run(2000);
    expect(alive()).toBe(true); // 3 s of world time into a 4 s poison
    c.run(1100);
    expect(alive()).toBe(false);
  });

  it("a dead monster's status loops end at once", () => {
    const c = clocks();
    const bus = new EventBus<GameEvents>();
    new VfxBridge(c.stage, { player: () => player, sceneNow: c.sceneNow, windupId: () => null }).attachBus(bus);
    const m = monster();
    bus.emit('statusApplied', { target: m, kind: 'burn', x: m.x, y: m.y, untilMs: c.sceneNow() + 1600, source: skill('firebolt') });
    const alive = c.plays[c.plays.length - 1].ctx.alive!;
    expect(alive()).toBe(true);
    (m as { alive: boolean }).alive = false;
    expect(alive()).toBe(false);
  });

  it("the player's buff aura and a monster's buff aura keep their length through a pause", () => {
    const c = clocks();
    const bus = new EventBus<GameEvents>();
    new VfxBridge(c.stage, { player: () => player, sceneNow: c.sceneNow, windupId: () => null }).attachBus(bus);
    new WorldBridge(c.stage, { player: () => player, sceneNow: c.sceneNow, juice: null, classAura: () => null }).attachBus(bus);
    const b = skill('arcane_ward');
    bus.emit('buffApplied', { skillId: b.id, skill: b, element: b.element, castId: 1, target: 'player', x: 100, y: 100, stat: 'def', amount: 10, durationMs: 5000, untilMs: c.sceneNow() + 5000 });
    const mine = c.plays.filter((p) => p.ctx.alive).map((p) => p.ctx.alive!);
    const m = monster();
    bus.emit('buffApplied', { skillId: b.id, skill: b, element: b.element, target: m, x: m.x, y: m.y, stat: 'def', amount: 10, durationMs: 5000, untilMs: c.sceneNow() + 5000 });
    const theirs = c.plays.filter((p) => p.ctx.alive && !mine.includes(p.ctx.alive)).map((p) => p.ctx.alive!);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    c.run(2000);
    c.pause(30000);
    c.run(2900);
    for (const a of [...mine, ...theirs]) expect(a()).toBe(true);
    c.run(200);
    for (const a of [...mine, ...theirs]) expect(a()).toBe(false);
  });

  it("the player's status overlay keeps its length through a pause", () => {
    const c = clocks();
    const bus = new EventBus<GameEvents>();
    new WorldBridge(c.stage, { player: () => player, sceneNow: c.sceneNow, juice: null, classAura: () => null }).attachBus(bus);
    bus.emit('statusApplied', { target: 'player', kind: 'burn', x: 100, y: 100, untilMs: c.sceneNow() + 1600, source: skill('mon_ember_spit') });
    const alive = c.plays[c.plays.length - 1].ctx.alive!;
    c.run(800);
    c.pause(5000);
    c.run(700);
    expect(alive()).toBe(true);
    c.run(200);
    expect(alive()).toBe(false);
  });
});

describe('vfx review: "Reduce shake & flashes" default and changes', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  const store = (v: string | null) => {
    const m = new Map<string, string>();
    if (v !== null) m.set('omnipath.vfx.reduceFlash', v);
    return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, x: string) => void m.set(k, x), map: m };
  };
  const motion = (reduce: boolean) => () => ({ matches: reduce });

  it('follows prefers-reduced-motion until the player chooses', async () => {
    vi.stubGlobal('localStorage', store(null));
    vi.stubGlobal('matchMedia', motion(true));
    expect((await import('../src/game/vfx/runtime/settings')).vfxSettings.reduceFlash).toBe(true);
    vi.resetModules();
    vi.stubGlobal('localStorage', store(null));
    vi.stubGlobal('matchMedia', motion(false));
    expect((await import('../src/game/vfx/runtime/settings')).vfxSettings.reduceFlash).toBe(false);
  });

  it('a stored choice wins over the device default, and a change is announced once', async () => {
    vi.stubGlobal('localStorage', store('0'));
    vi.stubGlobal('matchMedia', motion(true));
    const s = await import('../src/game/vfx/runtime/settings');
    expect(s.vfxSettings.reduceFlash).toBe(false);
    const seen: boolean[] = [];
    const off = s.onReduceFlash((on) => seen.push(on));
    s.setReduceFlash(true);
    s.setReduceFlash(true); // no change: not announced again
    off();
    s.setReduceFlash(false); // unsubscribed
    expect(seen).toEqual([true]);
  });
});
