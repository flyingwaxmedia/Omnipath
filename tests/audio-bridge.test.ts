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

  it('v4: voices zones, blinks, mends and shields by their own events, in the element', () => {
    const r = rig();
    const ref = { skillId: 'x', element: 'water' as const };
    const zone = skill({ element: 'water', shape: { kind: 'zone', radius: 80, range: 100, durationMs: 4000, tickMs: 1000 } });
    const obj = { x: 60, y: 16, radius: 80, level: 1, alive: true };
    r.bus.emit('castFire', { ...ref, skill: zone, x: 48, y: 16, shape: 'zone', aim: { x: 60, y: 16 }, target: null, rank: 1, basic: false, map: 'm' });
    r.bus.emit('objectTick', { ...ref, skill: zone, id: 1, kind: 'zone', obj, x: 60, y: 16, radius: 80, index: 0, ticks: 4 });
    r.bus.emit('objectTick', { ...ref, skill: zone, id: 1, kind: 'zone', obj, x: 60, y: 16, radius: 80, index: 1, ticks: 4 });
    r.bus.emit('objectEnd', { ...ref, skill: zone, id: 1, kind: 'zone', obj, x: 60, y: 16, reason: 'expire' });
    r.bus.emit('objectEnd', { ...ref, skill: zone, id: 2, kind: 'zone', obj, x: 60, y: 16, reason: 'clear' });
    r.bus.emit('objectEnd', { ...ref, skill: zone, id: 3, kind: 'zone', obj, x: 60, y: 16, reason: 'consumed' });
    expect(r.take()).toEqual(['cast_zone_water', 'zone_tick', 'zone_tick', 'zone_end']);
    const blink = skill({ element: 'water', shape: { kind: 'blink', distance: 100, to: 'point' } });
    r.bus.emit('castFire', { ...ref, skill: blink, x: 48, y: 16, shape: 'blink', aim: { x: 60, y: 16 }, target: null, rank: 1, basic: false, map: 'm' });
    r.bus.emit('blink', { ...ref, skill: blink, owner: 'player', from: { x: 48, y: 16 }, to: { x: 148, y: 16 }, mode: 'point' });
    expect(r.take()).toEqual(['cast_blink_water']);
    const mend = skill({ element: 'water', power: 0, shape: { kind: 'mend', pct: 20, overMs: 3000 } });
    r.bus.emit('mend', { ...ref, skill: mend, x: 48, y: 16, amount: 10, first: true, overMs: 3000 });
    r.bus.emit('mend', { ...ref, skill: mend, x: 48, y: 16, amount: 3, first: false });
    // A mend's heal event does not double the sound; leech still chimes.
    r.bus.emit('heal', { x: 48, y: 16, amount: 3, source: 'mend' as never });
    r.bus.emit('heal', { x: 48, y: 16, amount: 3, source: 'leech' });
    expect(r.take()).toEqual(['cast_mend_water', 'mend_tick', 'heal']);
    const shield = skill({ element: 'water', shape: { kind: 'shield', pct: 15, durationMs: 5000, burst: { radius: 80 } } });
    r.bus.emit('shieldUp', { ...ref, skill: shield, x: 48, y: 16, amount: 20, durationMs: 5000, untilMs: 5000, burst: 80 });
    r.bus.emit('shieldHit', { x: 48, y: 16, absorbed: 5, left: 15, origin: { x: 200, y: 16 } });
    expect(r.plays[1].o.pan!).toBeGreaterThan(0);
    r.bus.emit('shieldEnd', { ...ref, skill: shield, x: 48, y: 16, reason: 'broken', burst: 80 });
    r.bus.emit('shieldEnd', { ...ref, skill: shield, x: 48, y: 16, reason: 'replaced' });
    expect(r.take()).toEqual(['cast_shield_water', 'shield_absorb', 'shield_break', 'nova_m']);
    for (const n of ['cast_zone_water', 'zone_tick', 'zone_end', 'cast_blink_water', 'cast_mend_water', 'mend_tick', 'cast_shield_water', 'shield_absorb', 'shield_break']) expect(SOUNDS[n], n).toBeDefined();
  });

  it('v4: bare hands swing and land by the blow (jab, hook, palm, kick, slam), new statuses speak', () => {
    const r = rig();
    (r.scene.session.player as { weapon: string }).weapon = 'fists';
    const base = { skillId: 'x', owner: 'player' as const, count: 1, ang: 0, x: 48, y: 16, index: 0 };
    const jab = skill({ tags: ['fist', 'melee', 'basic'], shape: { kind: 'strike', range: 40, arc: 70 }, delivery: 'punch' });
    const hay = skill({ tags: ['fist', 'melee', 'heavy'], power: 2.1, shape: { kind: 'strike', range: 46, arc: 90 }, delivery: 'punch' });
    r.bus.emit('skillPulse', { ...base, skill: jab });
    r.bus.emit('skillPulse', { ...base, skill: hay });
    expect(r.take()).toEqual(['swing_fists_light', 'swing_fists_heavy']);
    const blows: [SkillDef, string][] = [
      [jab, 'fist_jab'],
      [hay, 'fist_hook'],
      [skill({ tags: ['fist', 'spirit'], shape: { kind: 'strike', range: 40, arc: 70 } }), 'fist_palm'],
      [skill({ tags: ['fist', 'spin'], shape: { kind: 'spin', radius: 70 }, delivery: 'kick' }), 'fist_kick'],
      [skill({ tags: ['fist', 'dash', 'heavy', 'aoe'], power: 3, shape: { kind: 'dash', distance: 200, width: 80 } }), 'fist_slam'],
    ];
    for (const [s, name] of blows) {
      r.bus.emit('hit', hit({ skill: s, element: undefined }));
      expect(r.take(), name).toEqual(['hit_physical', name]);
      expect(SOUNDS[name], name).toBeDefined();
    }
    for (const kind of ['root', 'launch', 'expose', 'lure'] as const) r.bus.emit('statusApplied', { target: monster(), kind, x: 60, y: 20 });
    expect(r.take()).toEqual(['status_root', 'status_launch', 'status_expose', 'status_lure']);
  });

  it('v4: class mechanics speak once per effect: full, finisher, cash-in, stance; steps climb in pitch', () => {
    const r = rig();
    const ev = (type: GameEvents['mechanic']['type'], effect: GameEvents['mechanic']['effect'], extra: Partial<GameEvents['mechanic']> = {}): GameEvents['mechanic'] => ({ classId: 'c', kind: 'gauge', name: 'n', type, effect, view: null, x: 48, y: 16, ...extra });
    r.bus.emit('mechanic', ev('full', { type: 'full', name: 'Heat' }));
    r.bus.emit('mechanic', ev('finisher', { type: 'finisher', name: 'Finisher', skill: 'x' }));
    r.bus.emit('mechanic', ev('cashIn', { type: 'cashIn', name: 'Pin', skill: 'x', targets: [], resetCooldown: false }));
    r.bus.emit('mechanic', ev('stance', { type: 'stance', name: 'Low Tide', stance: 1 }));
    r.bus.emit('mechanic', ev('comboStep', { type: 'comboStep', name: 'Cadence', step: 1, length: 3 }));
    r.bus.emit('mechanic', ev('comboStep', { type: 'comboStep', name: 'Cadence', step: 2, length: 3 }));
    r.bus.emit('mechanic', ev('comboBreak', { type: 'comboBreak', name: 'Cadence' }));
    r.bus.emit('mechanic', ev('marked', { type: 'marked', name: 'Pin', target: 'a', marks: 2 }, { target: monster() }));
    r.bus.emit('mechanic', ev('levelUp', { type: 'levelUp', name: 'Hearth', object: 1, level: 2 }, { at: { x: 60, y: 16 } }));
    // Silent: the cast or the object already spoke.
    r.bus.emit('mechanic', ev('spent', { type: 'spent', name: 'Heat', amount: 10, skill: 'x' }));
    r.bus.emit('mechanic', ev('placed', { type: 'placed', name: 'Hearth', object: 1, count: 1 }));
    r.bus.emit('mechanic', ev('expired', { type: 'expired', name: 'Hearth', object: 1, level: 1 }));
    r.bus.emit('mechanic', ev('consumed', { type: 'consumed', name: 'Hearth', skill: 'x', objects: [1] } as never));
    expect(r.names()).toEqual(['mech_full', 'mech_finisher', 'mech_cashin', 'mech_stance', 'mech_step', 'mech_step', 'mech_break', 'mech_mark', 'mech_grow']);
    expect(r.plays[5].o.rate!).toBeGreaterThan(r.plays[4].o.rate!);
    for (const n of new Set(r.names())) expect(SOUNDS[n], n).toBeDefined();
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
