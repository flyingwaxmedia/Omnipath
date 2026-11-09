import { describe, expect, it } from 'vitest';
import { EventBus, Scope, gameBus, sceneScope, type GameEvents } from '../src/game/events';

describe('game event bus', () => {
  it('delivers typed payloads in subscription order and unsubscribes', () => {
    const bus = new EventBus<GameEvents>();
    const seen: string[] = [];
    const off = bus.on('warp', (e) => seen.push(`a:${e.from}>${e.to}`));
    bus.on('warp', (e) => seen.push(`b:${e.to}`));
    bus.emit('warp', { from: 'x', to: 'y' });
    off();
    bus.emit('warp', { from: 'y', to: 'z' });
    expect(seen).toEqual(['a:x>y', 'b:y', 'b:z']);
    expect(bus.count('warp')).toBe(1);
  });

  it('once fires a single time; off and clear remove listeners', () => {
    const bus = new EventBus<GameEvents>();
    let n = 0;
    bus.once('levelUp', () => n++);
    bus.emit('levelUp', { level: 2, x: 0, y: 0 });
    bus.emit('levelUp', { level: 3, x: 0, y: 0 });
    expect(n).toBe(1);
    const fn = () => n++;
    bus.on('levelUp', fn);
    bus.off('levelUp', fn);
    bus.emit('levelUp', { level: 4, x: 0, y: 0 });
    expect(n).toBe(1);
    bus.on('levelUp', fn);
    bus.on('warp', fn);
    expect(bus.count()).toBe(2);
    bus.clear('warp');
    expect(bus.has('warp')).toBe(false);
    bus.clear();
    expect(bus.count()).toBe(0);
  });

  it('a throwing listener is reported and does not stop the others', () => {
    const bus = new EventBus<GameEvents>();
    const errors: unknown[] = [];
    bus.onError = (e) => errors.push(e);
    let reached = false;
    bus.on('talk', () => {
      throw new Error('boom');
    });
    bus.on('talk', () => (reached = true));
    bus.emit('talk', { npcId: 'brann', map: 'vale.hearthvale', x: 1, y: 2 });
    expect(reached).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('listeners added or removed during an emit do not disturb it', () => {
    const bus = new EventBus<GameEvents>();
    const order: string[] = [];
    const late = () => order.push('late');
    bus.on('mapEnter', () => {
      order.push('first');
      bus.on('mapEnter', late);
    });
    bus.emit('mapEnter', { map: 'm', first: true, x: 0, y: 0 });
    expect(order).toEqual(['first']);
  });

  it('scopes clear together; sceneScope clears on shutdown', () => {
    const bus = new EventBus<GameEvents>();
    const scope = new Scope(bus).on('warp', () => undefined).on('kill', () => undefined);
    expect(bus.count()).toBe(2);
    scope.clear();
    scope.clear();
    expect(bus.count()).toBe(0);

    let shutdown: (() => void) | null = null;
    const scene = { events: { once: (ev: string, fn: () => void) => (ev === 'shutdown' ? (shutdown = fn) : null) } };
    const s = sceneScope(scene, bus);
    s.on('uiOpen', () => undefined);
    expect(bus.count('uiOpen')).toBe(1);
    shutdown!();
    expect(bus.count('uiOpen')).toBe(0);
  });

  it('the run-wide bus starts empty', () => {
    expect(gameBus.count()).toBe(0);
  });
});
