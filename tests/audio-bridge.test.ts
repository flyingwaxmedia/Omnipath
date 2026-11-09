import { afterEach, describe, expect, it, vi } from 'vitest';
import { T } from '../src/core/world/tiles';
import type { SkillDef } from '../src/core/types';
import { EventBus, type GameEvents } from '../src/game/events';
import type { MapInfo } from '../src/game/audio/ambience';
import { type AudioScene, EMITTERS, createAudioBridge, hitRestraint } from '../src/game/audio/bridge';
import { SOUNDS } from '../src/game/audio/bank';
import type { PlayOptions } from '../src/game/audio/engine';

type Play = { name: string; o: PlayOptions };

function rig() {
  const fns = new Map<string, Set<(...a: never[]) => void>>();
  const anims = { currentAnim: { key: 'player_dagger_walk' } as { key: string } | null, currentFrame: { index: 1 } as { index: number } | null };
  const player = { x: 48, y: 16, moving: false, sprite: { anims } };
  const scene = {
    events: {
      on: (e: string, fn: (...a: never[]) => void) => (fns.get(e) ?? fns.set(e, new Set()).get(e)!).add(fn),
      off: (e: string, fn: (...a: never[]) => void) => fns.get(e)?.delete(fn),
    },
    cameras: { main: { worldView: { centerX: 48, centerY: 16, width: 400, height: 300 } } },
    player,
    cm: { w: 6, h: 1, ground: [T.GRASS, T.BRIDGE, T.SNOW, T.SNOW, T.SNOW, T.SNOW] },
    def: { id: 'vale.greenmeadow', biome: 'meadow', kind: 'field', objects: [{ id: 'chest_a', kind: 'chest', tx: 0, ty: 0 }, { id: 'chest_old', kind: 'chest', tx: 0, ty: 0 }, { id: 'waystone', kind: 'waystone', tx: 0, ty: 0 }], nodes: [] as { id: string; kind: string; tx: number; ty: number }[] },
    session: { player: { weapon: 'dagger' as const }, world: { chests: ['vale.greenmeadow#chest_old'] } },
  } satisfies AudioScene;
  const plays: Play[] = [];
  const maps: MapInfo[] = [];
  const sink = { play: (name: string, o: PlayOptions = {}) => plays.push({ name, o }), setMap: (m: MapInfo) => maps.push(m) };
  const bus = new EventBus<GameEvents>();
  const off = createAudioBridge(scene, sink, bus);
  const update = () => fns.get('update')?.forEach((fn) => (fn as () => void)());
  const names = () => plays.map((p) => p.name);
  const take = () => names().splice(0) && plays.splice(0).map((p) => p.name);
  return { scene, player, anims, plays, maps, bus, off, update, names, take, fns };
}

const skill = (o: Partial<SkillDef> & { shape: SkillDef['shape'] }): SkillDef =>
  ({ id: 'x', name: 'X', desc: '', icon: '', tier: 0, tags: [], power: 1, spCost: 0, cooldown: 0, maxRank: 5, ...o }) as SkillDef;
const monster = (x = 60, y = 20, rank: 'common' | 'elite' | 'warden' = 'common') =>
  ({ x, y, def: { family: 'beast', size: 'L', rank } }) as unknown as GameEvents['hit']['target'];
const fire = skill({ element: 'fire', shape: { kind: 'strike', range: 30, arc: 90 } });

const hit = (o: Partial<GameEvents['hit']> = {}): GameEvents['hit'] => ({
  skillId: 'x',
  skill: fire,
  element: 'fire',
  source: 'player',
  target: monster(),
  x: 60,
  y: 20,
  damage: 5,
  crit: false,
  resisted: false,
  multiplier: 1,
  killed: false,
  hitIndex: 0,
  ang: 0,
  ...o,
});

describe('audio bridge', () => {
  it('plays element hits with a crit layer and quiets later hits of the same cast', () => {
    const r = rig();
    r.bus.emit('hit', hit({ crit: true }));
    expect(r.names()).toEqual(['hit_fire', 'crit']);
    expect(r.plays[0].o.gain).toBeCloseTo(1, 6);
    r.plays.length = 0;
    r.bus.emit('hit', hit({ hitIndex: 3 }));
    expect(r.plays[0].o.gain).toBeCloseTo(hitRestraint(3), 6);
    expect(hitRestraint(3)).toBeLessThan(0.5);
    expect(hitRestraint(20)).toBe(0.35);
    r.plays.length = 0;
    r.bus.emit('hit', hit({ resisted: true, damage: 0 }));
    r.bus.emit('hit', hit({ element: undefined, skill: skill({ shape: { kind: 'strike', range: 30, arc: 90 } }) }));
    expect(r.names()).toEqual(['hit_resist', 'hit_physical']);
  });

  it('spatialises by the camera: pans toward the source and skips far off-screen sounds', () => {
    const r = rig();
    r.bus.emit('hit', hit({ x: 230, y: 16 }));
    expect(r.plays[0].o.pan!).toBeGreaterThan(0.5);
    r.plays.length = 0;
    r.bus.emit('hit', hit({ x: 4000, y: 16 }));
    expect(r.plays).toEqual([]);
  });

  it('voices swings by weapon and weight, with the element sheen on the first swing', () => {
    const r = rig();
    const base = { skillId: 'x', owner: 'player' as const, count: 2, ang: 0, x: 48, y: 16 };
    r.bus.emit('skillPulse', { ...base, skill: skill({ shape: { kind: 'strike', range: 30, arc: 90 } }), index: 0 });
    r.bus.emit('skillPulse', { ...base, skill: skill({ element: 'ice', tier: 2, shape: { kind: 'strike', range: 30, arc: 90 } }), element: 'ice', index: 0 });
    r.bus.emit('skillPulse', { ...base, skill: skill({ element: 'ice', tier: 2, shape: { kind: 'strike', range: 30, arc: 90 } }), element: 'ice', index: 1 });
    expect(r.names()).toEqual(['swing_dagger_light', 'swing_dagger_heavy', 'cast_strike_ice', 'swing_dagger_heavy']);
    expect(r.plays[3].o.gain).toBeLessThan(1);
    r.plays.length = 0;
    r.bus.emit('skillPulse', { ...base, skill: skill({ element: 'water', shape: { kind: 'projectile', speed: 1, range: 1 } }), element: 'water', index: 0 });
    r.bus.emit('skillPulse', { ...base, owner: monster() as never, skill: skill({ shape: { kind: 'strike', range: 30, arc: 90 } }), index: 0 });
    expect(r.names()).toEqual(['cast_projectile_water', 'mon_swing']);
    expect(r.plays[1].o.rate).toBeLessThan(1); // a large monster swings lower
  });

  it('maps buffs, wards, dashes, chains and novas to their cast sounds', () => {
    const r = rig();
    const ref = { skillId: 'x', element: 'holy' as const };
    r.bus.emit('buffApplied', { ...ref, skill: skill({ shape: { kind: 'buff', stat: 'def', amount: 1, duration: 1 } }), target: 'player', stat: 'def', amount: 1, durationMs: 1, x: 0, y: 0 });
    r.bus.emit('buffApplied', { ...ref, skill: skill({ shape: { kind: 'buff', stat: 'atk', amount: 1, duration: 1 } }), target: 'player', stat: 'atk', amount: 1, durationMs: 1, x: 0, y: 0 });
    r.bus.emit('dash', { ...ref, skill: skill({ shape: { kind: 'dash', distance: 1, width: 1 } }), owner: 'player', from: { x: 48, y: 16 }, to: { x: 90, y: 16 }, durationMs: 100, width: 10, spin: false });
    r.bus.emit('castFire', { ...ref, skill: skill({ shape: { kind: 'chain', range: 1, jumps: 2 } }), x: 48, y: 16, shape: 'chain', aim: { x: 0, y: 0 }, target: null, rank: 1, basic: false, map: 'm' });
    r.bus.emit('chainHop', { ...ref, skill: skill({ shape: { kind: 'chain', range: 1, jumps: 2 } }), owner: 'player', from: { x: 48, y: 16 }, to: { x: 60, y: 16 }, index: 2, target: monster(), knives: false });
    r.bus.emit('novaBlast', { ...ref, skill: skill({ shape: { kind: 'nova', radius: 120, range: 1 } }), owner: 'player', x: 60, y: 16, radius: 120, heavy: true });
    expect(r.names()).toEqual(['cast_ward_holy', 'cast_buff_holy', 'cast_dash_holy', 'cast_chain_holy', 'zap_chain', 'nova_l']);
    expect(r.plays[4].o.rate).toBeGreaterThan(1); // hops climb in pitch
  });

  it('warns on telegraphs, roars once per warden, and sizes monster deaths', () => {
    const r = rig();
    const w = monster(60, 20, 'warden');
    const tell = { skillId: 'x', skill: fire, monster: w as never, shape: 'nova' as const, x: 60, y: 20, at: { x: 0, y: 0 }, durationMs: 800, echo: true, rank: 'warden' as const };
    r.bus.emit('monsterTelegraph', tell);
    r.bus.emit('monsterTelegraph', tell);
    expect(r.names()).toEqual(['boss_roar', 'tell_big', 'tell_echo', 'tell_big', 'tell_echo']);
    r.plays.length = 0;
    r.bus.emit('kill', { monster: w as never, def: (w as unknown as { def: never }).def, x: 60, y: 20, exp: 1, coins: 3, elite: false, warden: true });
    r.bus.emit('death', { target: w as never, rank: 'warden', x: 60, y: 20 });
    r.bus.emit('death', { target: monster() as never, rank: 'common', x: 60, y: 20 });
    r.bus.emit('death', { target: 'player', x: 0, y: 0, from: 'x', expLost: 1 });
    expect(r.names()).toEqual(['coin', 'kill_elite', 'death_warden', 'death_beast', 'player_death']);
    expect(r.plays[0].o.delay).toBeGreaterThan(0);
    expect(r.plays[3].o.rate).toBeLessThan(1);
  });

  it('plays footsteps on the walk contact frames, by the surface under the feet', () => {
    const r = rig();
    r.update();
    expect(r.plays).toEqual([]); // standing still
    r.player.moving = true;
    for (const idx of [1, 1, 2, 3, 4, 1]) {
      r.anims.currentFrame = { index: idx };
      r.update();
    }
    expect(r.names()).toEqual(['step_wood', 'step_wood', 'step_wood']); // x=48 is the bridge tile
    expect(Math.sign(r.plays[0].o.pan!)).toBe(-Math.sign(r.plays[1].o.pan!)); // left, right
    r.plays.length = 0;
    // No walk animation (e.g. a look without one): fall back to distance.
    r.anims.currentAnim = null;
    r.player.x = 80;
    r.update();
    for (let i = 0; i < 4; i++) {
      r.player.x += 10;
      r.update();
    }
    // 32 px, then every 20 px (stride 18)
    expect(r.names()).toEqual(['step_snow', 'step_snow', 'step_snow']);
    r.player.moving = false;
    r.update();
    expect(r.plays.length).toBe(3);
  });

  it('handles maps, warps, quests, discoveries, objects and UI without doubling up', () => {
    const r = rig();
    r.bus.emit('mapEnter', { map: 'vale.greenmeadow', first: true, x: 0, y: 0 });
    expect(r.maps).toEqual([{ id: 'vale.greenmeadow', biome: 'meadow', kind: 'field', flags: undefined }]);
    r.bus.emit('warp', { from: 'a', to: 'b' });
    expect(r.names()).toEqual(['map_new', 'warp_out', 'warp_in']);
    expect(r.plays[2].o.delay).toBeGreaterThan(0.2);
    r.plays.length = 0;
    r.bus.emit('questChanged', { questId: 'q', reason: 'accepted' });
    r.bus.emit('questChanged', { questId: 'q', reason: 'completed' });
    r.bus.emit('discovery', { kind: 'reward', title: 'Done' }); // the reward card: quest_complete already played
    r.bus.emit('discovery', { kind: 'class', title: 'Pyroblade' });
    r.bus.emit('discovery', { kind: 'essence', title: 'E' });
    r.bus.emit('uiOpen', { panel: 'discovery', fullscreen: false });
    r.bus.emit('uiOpen', { panel: 'skills', fullscreen: true });
    r.bus.emit('uiClose', { panel: 'skills' });
    r.bus.emit('interact', { kind: 'object', id: 'chest_a', x: 0, y: 0, map: 'vale.greenmeadow' });
    r.bus.emit('interact', { kind: 'object', id: 'chest_old', x: 0, y: 0, map: 'vale.greenmeadow' });
    r.bus.emit('interact', { kind: 'object', id: 'waystone', x: 0, y: 0, map: 'vale.greenmeadow' });
    r.bus.emit('gather', { node: 'ore', item: 'ore', total: 3, x: 50, y: 16, map: 'vale.greenmeadow' });
    r.bus.emit('levelUp', { level: 2, x: 0, y: 0 });
    r.bus.emit('barChanged', { slots: [6], reason: 'assign' });
    r.bus.emit('barChanged', { slots: [], reason: 'load' });
    expect(r.names()).toEqual([
      'quest_accept',
      'quest_complete',
      'discover_class',
      'discover_minor',
      'ui_open',
      'ui_close',
      'chest_open',
      'ui_nope',
      'waystone',
      'gather_ore',
      'level_up',
      'slot_set',
    ]);
  });

  it('player hurt leans toward the attacker and warns once at low HP', () => {
    const r = rig();
    const base = { damage: 5, maxHp: 100, from: 'Jellop', heavy: false, x: 48, y: 16 };
    r.bus.emit('playerHurt', { ...base, hp: 80, origin: { x: 248, y: 16 } });
    r.bus.emit('playerHurt', { ...base, hp: 20, heavy: true });
    r.bus.emit('playerHurt', { ...base, hp: 15, dot: 'burn' });
    expect(r.names()).toEqual(['hurt', 'hurt_heavy', 'hurt_low', 'hurt_dot']);
    expect(r.plays[0].o.pan!).toBeGreaterThan(0.1);
  });

  it('map objects and nodes sound by themselves near the player (positional emitters)', () => {
    vi.useFakeTimers({ toFake: ['performance'] });
    const r = rig();
    r.off();
    r.scene.def.objects.push({ id: 'fire', kind: 'campfire', tx: 2, ty: 0 }, { id: 'far', kind: 'campfire', tx: 400, ty: 0 });
    r.scene.def.nodes.push({ id: 'chime', kind: 'wind_chime', tx: 3, ty: 0 });
    const plays: Play[] = [];
    const bus = new EventBus<GameEvents>();
    const off = createAudioBridge(r.scene, { play: (name, o = {}) => plays.push({ name, o }), setMap: () => 0 }, bus);
    for (let i = 0; i < 100; i++) {
      vi.advanceTimersByTime(100);
      r.update();
    }
    const crackles = plays.filter((p) => p.name === 'amb_crackle');
    // 10 s of one nearby campfire (every 0.5–1.4 s); the far one is never heard
    expect(crackles.length).toBeGreaterThanOrEqual(6);
    expect(crackles.length).toBeLessThanOrEqual(21);
    expect(crackles.every((p) => (p.o.pan ?? 0) > 0)).toBe(true); // to the right of the player
    expect(plays.some((p) => p.name === 'amb_chime')).toBe(true);
    off();
    expect(bus.count()).toBe(0);
    for (const [kind, defs] of Object.entries(EMITTERS)) for (const d of defs) expect(SOUNDS[d.sound]?.bus, `${kind}: ${d.sound}`).toBe('ambience');
  });

  it('its disposer removes every listener (warps keep the counts flat)', () => {
    const r = rig();
    expect(r.bus.count()).toBeGreaterThan(30);
    expect(r.fns.get('update')?.size).toBe(1);
    r.off();
    r.off();
    expect(r.bus.count()).toBe(0);
    expect(r.fns.get('update')?.size).toBe(0);
    for (let i = 0; i < 5; i++) createAudioBridge(r.scene, { play: () => 0, setMap: () => 0 }, r.bus)();
    expect(r.bus.count()).toBe(0);
  });
});

afterEach(() => {
  vi.useRealTimers();
});
