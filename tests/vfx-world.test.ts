// World lane (docs/VFX.md §8.9): the Phaser-free World bridge (monster techniques, auto-attacks, the player's statuses,
// deaths, spawns, enrage, sparkles, the class aura), the juice rig (coalesced victim-local hit-stop, impact frames)
// and the camera rig (whole-pixel trauma shake, kicks, the governed flash, the warden pan, reduce-motion), driven
// headlessly with a fake stage, fake actors and a fake scene.
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/data';
import { EventBus, type GameEvents, type TellPhase, type TellShape } from '../src/game/events';
import type { Monster } from '../src/game/entities/Monster';
import { CameraRig, FLASH, IntroWatch } from '../src/game/render/camera';
import { JuiceRig, holdFor, type JuiceActor } from '../src/game/vfx/juice';
import { CHIP_RAMP, RAMPS, hexToRgb } from '../src/game/vfx/ramps';
import type { JuiceHooks, PlayCtx, TellSpec, VfxGroup, VfxStage } from '../src/game/vfx/play';
import { deriveVfx } from '../src/game/vfx/recipe';
import { VFX_BUDGET, type VfxPiece } from '../src/game/vfx/types';
import { WorldBridge, chipTint, familyOfColor, type WorldPlayer } from '../src/game/vfx/world';

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
  const tells: { spec: TellSpec; group: { ended: boolean } }[] = [];
  const warmed: VfxPiece[] = [];
  let trauma = 0;
  const mk = () => ({
    ended: false,
    end() {
      this.ended = true;
    },
    get done() {
      return this.ended;
    },
  });
  const stage: VfxStage = {
    now: () => now,
    play(pieces, ctx) {
      const group = mk();
      plays.push({ pieces, ctx, group });
      return group;
    },
    warm: (ps) => void warmed.push(...ps),
    trauma: (t) => void (trauma += t),
    tick: () => {},
    reduceFlash: false,
    telegraph(spec) {
      const group = mk();
      tells.push({ spec, group });
      return group;
    },
  };
  return { stage, plays, tells, warmed, advance: (ms: number) => (now += ms), trauma: () => trauma, now: () => now };
}

const player: WorldPlayer = {
  x: 100,
  y: 100,
  sprite: { texture: { key: 'player_sword' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.95, scaleX: 1, scaleY: 1, visible: true },
};

function monster(id = 'gustling', x = 160, y = 100, rank: 'common' | 'elite' | 'warden' = 'common'): Monster {
  const def = reg.monster(id)!;
  return {
    x,
    y,
    alive: true,
    radius: def.radius,
    warden: rank === 'warden',
    elite: rank === 'elite',
    maxHp: def.hp,
    def: { ...def, rank },
    sprite: { displayHeight: 30, texture: { key: 'm' }, frame: { name: '0' }, flipX: false, originX: 0.5, originY: 0.9, scaleX: 1, scaleY: 1, visible: true },
  } as unknown as Monster;
}

function setup(juice: JuiceHooks | null = null, aura: ReturnType<WorldBridge['host']['classAura']> = null) {
  const f = fakeStage();
  const bus = new EventBus<GameEvents>();
  let now = 0;
  const world = new WorldBridge(f.stage, { player: () => player, sceneNow: () => now, juice, classAura: () => aura });
  world.attachBus(bus);
  return { ...f, bus, world, setNow: (v: number) => (now = v) };
}

/** A recording juice rig. */
function spyJuice() {
  const calls: string[] = [];
  const j: JuiceHooks = {
    hold: (v, ms) => {
      calls.push(`hold ${v === 'player' ? 'player' : 'monster'} ${ms}`);
      return ms;
    },
    impact: (v, c, _a, px) => void calls.push(`impact ${v === 'player' ? 'player' : 'monster'} ${c.toString(16)} ${px}`),
    pop: (v) => void calls.push(`pop ${v === 'player' ? 'player' : 'monster'}`),
    kick: (_a, px) => void calls.push(`kick ${px}`),
    flash: () => true,
  };
  return { j, calls };
}

const ref = (id: string) => ({ skillId: id, skill: skill(id), element: skill(id).element });

describe('world bridge: monster techniques', () => {
  it('draws the telegraph at the live geometry, through every phase, and cancels it when the caster dies', () => {
    const t = setup();
    const m = monster('hollow_regent', 160, 100, 'warden');
    const geom = (): TellShape => ({ kind: 'cone', x: m.x, y: m.y, r: 124, ang: 0, arc: 2.4 });
    const phases: { start: number; at: number; state: TellPhase['state'] }[] = [
      { start: 0, at: 880, state: 'pending' },
      { start: 880, at: 1100, state: 'pending' },
    ];
    t.bus.emit('monsterTelegraph', { ...ref('umbral_rend'), monster: m, shape: 'strike', x: m.x, y: m.y, at: { x: 100, y: 100 }, durationMs: 880, echo: false, id: 1, timing: phases[0], tell: geom(), live: geom, phases, rank: 'warden' });
    expect(t.tells).toHaveLength(1);
    const spec = t.tells[0].spec;
    expect(spec.look.danger).toBe(true);
    expect(spec.geom()).toEqual(geom());
    // A pushed caster moves the tell with it (the hit test reads the same function).
    (m as { x: number }).x = 170;
    expect((spec.geom() as Extract<TellShape, { kind: 'cone' }>).x).toBe(170);
    expect(spec.phase()).toEqual(phases[0]);
    phases[0].state = 'resolved';
    // The follow-up swing shows half full: its window is stretched back by its own length.
    expect(spec.phase()).toEqual({ start: 660, at: 1100, state: 'pending' });
    phases[1].state = 'resolved';
    expect(spec.phase()).toBeNull();
    phases[1].state = 'cancelled';
    expect(spec.phase()!.state).toBe('cancelled');
    (m as { alive: boolean }).alive = false;
    expect(spec.geom()).toBeNull();
  });

  it('plays the caster cue for the real wind-up, a charge glow for elites and wardens, and fizzles an interrupt', () => {
    const t = setup();
    const m = monster('voltmane', 160, 100, 'elite');
    const timing = { start: 0, at: 300, state: 'pending' as TellPhase['state'] };
    const geom = (): TellShape => ({ kind: 'range', x: m.x, y: m.y, r: 220 });
    t.bus.emit('monsterTelegraph', { ...ref('static_charge'), monster: m, shape: 'chain', x: m.x, y: m.y, at: { x: 100, y: 100 }, durationMs: 300, echo: false, id: 7, timing, live: geom, phases: [timing], rank: 'elite' });
    const cue = t.plays[0];
    expect(cue.pieces.length).toBeGreaterThan(0);
    expect(cue.pieces.every((p) => p.lifeMs === 300)).toBe(true);
    expect(cue.ctx.quota).toBe(VFX_BUDGET.monsterQuota);
    expect(cue.ctx.alive?.()).toBe(true);
    expect(t.plays.some((p) => p.pieces.some((x) => x.component === 'decal' && x.layer === 'glow'))).toBe(true);
    // The chain links to the player while in reach.
    expect(t.plays.some((p) => p.pieces.some((x) => x.component === 'motes' && x.anchor.to === 'path'))).toBe(true);
    timing.state = 'cancelled';
    expect(cue.ctx.alive?.()).toBe(false);
    const n = t.plays.length;
    t.bus.emit('monsterTelegraphEnd', { id: 7, monster: m, reason: 'cancel' });
    expect(cue.group.ended).toBe(true);
    expect(t.plays.length).toBe(n + 1);
    expect(t.plays[n].pieces.some((p) => p.component === 'tell' && p.params.piece === 'fizzle')).toBe(true);
  });

  it('plays monster swings and pulses at their true reach (the caster radius scales event geometry)', () => {
    const t = setup();
    const m = monster('cairn_wraith');
    t.bus.emit('skillPulse', { ...ref('mon_wail'), owner: m, index: 0, count: 1, ang: 0, x: m.x, y: m.y });
    const sh = skill('mon_wail').shape as { radius: number };
    const cast = t.plays[0];
    expect(cast.ctx.r).toBe(sh.radius + m.radius);
    expect(cast.ctx.rScale).toBeCloseTo((sh.radius + m.radius) / sh.radius);
    expect(cast.pieces).toEqual(deriveVfx(skill('mon_wail'), 'monster').phases.cast);
    // The spin's floor band plays every pulse.
    expect(t.plays.length).toBe(2);
  });

  it('follows monster shots and ends them; draws monster novas, zaps and dashes with the monster LUT', () => {
    const t = setup();
    const m = monster('ashfly');
    const mover = { x: 160, y: 100, vx: -300, vy: 0 };
    t.bus.emit('projectileSpawn', { ...ref('mon_ember_spit'), owner: m, obj: {} as never, mover, id: 9, angle: Math.PI, speed: 300, range: 200, size: 8, x: 160, y: 100 });
    const body = t.plays[0];
    expect(body.pieces.every((p) => p.lut === 'monster' || p.ramp === 'danger')).toBe(true);
    expect(body.ctx.alive?.()).toBe(true);
    t.bus.emit('projectileEnd', { ...ref('mon_ember_spit'), owner: m, obj: {} as never, mover, id: 9, reason: 'hit', x: 110, y: 100 });
    expect(body.ctx.alive?.()).toBe(false);
    const w = monster('thunderhoof', 160, 100, 'warden');
    t.bus.emit('novaBlast', { ...ref('thunder_stomp'), owner: w, x: 110, y: 100, radius: 104, heavy: true });
    expect(t.plays[t.plays.length - 1].ctx.r).toBe(104);
    expect(t.trauma()).toBeCloseTo(0.5);
    const z = monster('sparkbug');
    t.bus.emit('chainHop', { ...ref('mon_zap'), owner: z, from: { x: 160, y: 85 }, to: { x: 100, y: 82 }, index: 0, target: 'player', knives: false });
    expect(t.plays[t.plays.length - 1].ctx.hop).toBeDefined();
    const before = t.plays.length;
    t.bus.emit('dash', { ...ref('ember_pounce'), owner: monster('emberkit_alpha', 160, 100, 'elite'), from: { x: 160, y: 100 }, to: { x: 60, y: 100 }, durationMs: 140, width: 40, spin: false });
    expect(t.plays.length).toBe(before + 3);
  });
});

describe('world bridge: the player takes hits and statuses', () => {
  it('draws a technique impact on the player, holds half as long, flashes, recoils and kicks; heavy blows shake', () => {
    const { j, calls } = spyJuice();
    const t = setup(j);
    const m = monster('gustling', 160, 100);
    t.bus.emit('playerHurt', { damage: 200, hp: 500, maxHp: 800, from: 'Gust', origin: { x: 160, y: 100 }, heavy: true, x: 100, y: 100, attacker: m, skillId: 'mon_gust', skill: skill('mon_gust') });
    const hit = t.plays[0];
    expect(hit.pieces.every((p) => p.ramp === 'danger')).toBe(true);
    expect(calls[0]).toMatch(/^hold player \d+$/);
    expect(Number(calls[0].split(' ')[2])).toBeLessThanOrEqual(VFX_BUDGET.hitStop.localMaxMs / 2);
    expect(calls).toContain('impact player ff4466 3');
    expect(calls).toContain('kick 4');
    expect(t.trauma()).toBeCloseTo(0.35);
  });

  it('draws an auto-attack (claws / lash / slam by family) from the attacker, no impact for DoT ticks', () => {
    const t = setup();
    const m = monster('rimefang', 140, 100);
    t.bus.emit('playerHurt', { damage: 10, hp: 790, maxHp: 800, from: 'Rimefang', origin: { x: 140, y: 100 }, heavy: false, x: 100, y: 100, attacker: m });
    expect(t.plays).toHaveLength(2);
    expect(t.plays[0].pieces.some((p) => p.component === 'slash' || p.component === 'thrust' || p.component === 'burst')).toBe(true);
    t.bus.emit('playerHurt', { damage: 5, hp: 785, maxHp: 800, from: 'Burn', heavy: false, x: 100, y: 100, dot: 'burn' });
    expect(t.plays).toHaveLength(2);
  });

  it('keeps two status loops on the player by priority (pips for the rest) and glints a blocked stun', () => {
    const t = setup();
    const apply = (kind: GameEvents['statusApplied']['kind'], blocked = false) => t.bus.emit('statusApplied', { target: 'player', kind, x: 100, y: 100, untilMs: 2000, source: skill('mon_ember_spit'), blocked });
    apply('slow');
    apply('burn');
    const [slow, burn] = t.plays;
    expect(slow.ctx.low).toBeFalsy();
    apply('freeze');
    expect(slow.group.ended).toBe(true);
    expect(burn.group.ended).toBe(false);
    apply('soak'); // outranked: its pip shows
    const pip = t.plays[t.plays.length - 1].pieces[0];
    expect(pip.component === 'status' && pip.params.unit).toBe('pip');
    apply('stun', true);
    const last = t.plays[t.plays.length - 1].pieces[0];
    expect(last.component === 'burst' && last.params.cls).toBe('immune');
  });
});

describe('world bridge: deaths, spawns, enrage, sparkles, auras', () => {
  it('pops a dead monster (white frames on the sprite, then the pop in the killer family) and pops a respawn', () => {
    const { j, calls } = spyJuice();
    const t = setup(j);
    const m = monster('jellop');
    t.bus.emit('death', { target: m, rank: 'common', x: m.x, y: m.y, killer: ref('firebolt') });
    expect(calls).toContain('pop monster');
    const pop = t.plays[0].pieces;
    expect(pop.some((p) => p.component === 'nova' && p.ramp === 'fire')).toBe(true);
    expect(pop.every((p) => (p.delayMs ?? 0) >= 33)).toBe(true);
    // No hide colour from the art (the export is the actors lane's): the chips keep their dust bake.
    expect(t.plays[0].ctx.chipTint).toBeUndefined();
    t.bus.emit('monsterSpawn', { monster: m, rank: 'common', x: m.x, y: m.y });
    expect(t.plays[1].pieces.some((p) => p.component === 'puff')).toBe(true);
  });

  it('roars an enrage (two danger rings, a burst) and shakes only near the player', () => {
    const t = setup();
    t.bus.emit('enrage', { monster: monster('thunderhoof', 130, 100, 'warden'), x: 130, y: 100 });
    expect(t.plays[0].pieces.filter((p) => p.component === 'ring')).toHaveLength(2);
    expect(t.trauma()).toBeCloseTo(0.5);
    t.bus.emit('enrage', { monster: monster('thunderhoof', 2000, 100, 'warden'), x: 2000, y: 100 });
    expect(t.trauma()).toBeCloseTo(0.5);
  });

  it('sparkles gathers and discoveries, plays named extras, adapts legacy colours to families', () => {
    const t = setup();
    t.bus.emit('gather', { node: 'ore', item: 'ore', total: 1, x: 50, y: 50, map: 'm' });
    t.bus.emit('discovery', { kind: 'skill', title: 'x' });
    t.world.extra('chest', 10, 10);
    t.world.legacyRing(0, 0, 60, 0xe8d8ff);
    expect(t.plays).toHaveLength(4);
    expect(t.plays[0].pieces.some((p) => p.component === 'motes' && p.ramp === 'earth')).toBe(true);
    expect(familyOfColor(0xff6a2b)).toBe('fire');
    expect(familyOfColor(0x3fa9ff)).toBe('water');
  });

  it('keeps one Tier III class aura loop on the player, replaced only when the class changes', () => {
    const t = setup(null, { motif: 'glint', family: 'holy' });
    t.bus.emit('classChanged', { classId: 'ascendant', prev: null, reason: 'wear' });
    expect(t.plays).toHaveLength(1);
    expect(t.plays[0].pieces[0].component === 'aura' && t.plays[0].pieces[0].params.phase).toBe('loop');
    t.bus.emit('mapEnter', { map: 'm', first: false, x: 0, y: 0 });
    expect(t.plays).toHaveLength(1);
  });

  it('warms a map: every technique phase, auto-attacks, the player-side impacts and the death pops', () => {
    const t = setup();
    t.world.warmMap([reg.monster('thunderhoof')!, reg.monster('gustling')!], (id) => reg.skill(id));
    const comps = new Set(t.warmed.map((p) => p.component));
    for (const c of ['nova', 'burst', 'motes', 'puff', 'ring']) expect(comps.has(c as VfxPiece['component'])).toBe(true);
    expect(t.warmed.some((p) => p.component === 'tell')).toBe(false);
  });
});

describe('juice rig', () => {
  function rig(reduce = false) {
    let now = 0;
    const log: string[] = [];
    const actor: JuiceActor = {
      hold: (ms) => void log.push(`hold ${ms}`),
      impactFlash: (f) => void log.push(`flash ${f.map((c) => c.toString(16)).join(',')}`),
      squash: () => void log.push('squash'),
      recoil: (_a, px) => void log.push(`recoil ${px}`),
    };
    const kicks: number[] = [];
    const j = new JuiceRig({ now: () => now, reduceFlash: () => reduce, actor: () => actor, camera: () => ({ kick: (_a, px) => void kicks.push(px), flash: () => true }) });
    return { j, log, kicks, advance: (ms: number) => (now += ms) };
  }

  it('coalesces overlapping holds and keeps every victim inside 150 ms of hit-stop per second', () => {
    const { j, advance } = rig();
    const v = {};
    expect(j.hold(v, 67)).toBe(67);
    advance(20);
    // Overlapping: the hold extends to the later end; only the extension costs budget.
    expect(j.hold(v, 67)).toBe(67);
    // A whole second of back-to-back requests never grants more than the budget.
    const w = {};
    let granted = 0;
    let until = 0;
    for (let t = 0; t < 1000; t += 25) {
      const g = j.hold(w, 100);
      granted += Math.max(0, t + g - Math.max(t, until));
      until = Math.max(until, t + g);
      advance(25);
    }
    expect(granted).toBeLessThanOrEqual(VFX_BUDGET.hitStop.budgetMsPerSecond + 1);
    expect(j.trimmed).toBeGreaterThan(0);
  });

  it('caps one hold at 100 ms and scales the weight hold by the damage taken', () => {
    const { j } = rig();
    expect(j.hold({}, 500)).toBe(VFX_BUDGET.hitStop.localMaxMs);
    expect(holdFor(67, false, 5, 1000, true)).toBeLessThan(holdFor(67, false, 400, 1000, true));
    expect(holdFor(100, true, 1000, 1000, true)).toBe(VFX_BUDGET.hitStop.localMaxMs);
    expect(holdFor(67, false, 400, 1000, false)).toBe(0);
  });

  it('flashes ONE white frame (the hit colour under reduce-flash), squashes and recoils whole pixels', () => {
    const a = rig();
    expect(a.j.impact({}, 0xff8020, 0, 2.4)).toBe('flash');
    expect(a.log).toEqual(['flash ffffff', 'squash', 'recoil 2']);
    const b = rig(true);
    b.j.impact({}, 0xff8020, 0, 2);
    expect(b.log[0]).toBe('flash ff8020');
  });

  it('gates body flashes: first hit of a cast only, same-cast ticks spark-only, a per-victim cooldown', () => {
    const { j, log, advance } = rig();
    const v = {};
    const castA = {};
    const castB = {};
    expect(j.impact(v, 0xffd040, 0, 1, castA)).toBe('flash');
    advance(60);
    // A tick of the same cast 60 ms later: spark only (no flash, squash or recoil).
    expect(j.impact(v, 0xffd040, 0, 1, castA)).toBe('quiet');
    advance(200);
    // A later beat of the same cast: a recoil, never a second flash.
    expect(j.impact(v, 0xffd040, 0, 1, castA)).toBe('beat');
    // Another cast's first hit 260 ms after the flash (past the 220 ms cooldown; this rig has no frame counter, so
    // time only) flashes; a third cast's first hit 100 ms later is cooled.
    expect(j.impact(v, 0xffd040, 0, 1, castB)).toBe('flash');
    advance(100);
    expect(j.impact(v, 0xffd040, 0, 1, {})).toBe('cooled');
    expect(log.filter((l) => l.startsWith('flash'))).toEqual(['flash ffffff', 'flash ffffff']);
    // Other victims have their own gate; DoT ticks share it (one frame of the tick colour).
    expect(j.impact({}, 0xffd040, 0, 1, castA)).toBe('flash');
    expect(j.tick(v, 0x80ff40)).toBe(false);
    advance(220);
    expect(j.tick(v, 0x80ff40)).toBe(true);
    expect(log.at(-1)).toBe('flash 80ff40');
    // Death / spawn pops are never gated: two white frames.
    j.pop(v);
    expect(log.slice(-2)).toEqual(['flash ffffff,ffffff', 'squash']);
  });

  it('keeps a full-body flash under 15 % of the frames in a busy fight at any frame rate', () => {
    for (const fps of [60, 30, 20, 12]) {
      let now = 0;
      let frame = 0;
      let lit = 0;
      let queued: number[] = [];
      const actor: JuiceActor = { hold: () => {}, impactFlash: (f) => void (queued = [...f]), squash: () => {}, recoil: () => {} };
      const j = new JuiceRig({ now: () => now, reduceFlash: () => false, actor: () => actor, camera: () => null, frame: () => frame });
      const v = {};
      // 6 casts landing every 40 ms (multi-hit spins, chains, storms, DoT ticks) for 10 s.
      let next = 0;
      let castN = 0;
      const frames = fps * 10;
      for (; frame < frames; frame++, now += 1000 / fps) {
        while (next <= now) {
          if (castN % 5 === 4) j.tick(v, 0xff8020);
          else j.impact(v, 0xffd040, 0, 1, Math.floor(castN / 3));
          castN++;
          next += 40;
        }
        // The actor shows one queued frame per rendered frame.
        if (queued.length) {
          queued.shift();
          lit++;
        }
      }
      expect(lit / frames).toBeLessThanOrEqual(0.15);
      expect(lit).toBeGreaterThan(0);
    }
  });
});

describe('death chips in the hide colour', () => {
  it('tints the chips so their fill stop lands on the hide colour, when the art has one', () => {
    // CHIP_RAMP R3 x tint / 255 = the hide colour (channels that would need > 255 cap there).
    const r3 = hexToRgb(RAMPS[CHIP_RAMP].R[3]);
    const lands = (hex: number) => {
      const t = chipTint(hex);
      const hide = [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
      const ch = [(t >> 16) & 255, (t >> 8) & 255, t & 255];
      return ch.every((c, i) => Math.abs(Math.round((r3[i] * c) / 255) - hide[i]) <= 1);
    };
    // Bright greens and blues (jellop, puddlewisp, thunderhoof, voltmane): the dust R3 (#a8906c) capped them to olive
    // and teal-grey; the light chip ramp reaches them.
    for (const hide of [0x5a8a3c, 0x78c25a, 0x8cc6e6, 0x3a4c84, 0x4761b0, 0x9a6cc4]) expect(lands(hide)).toBe(true);
    expect(chipTint(0xffffff)).toBe(0xffffff);
    // The bridge passes it to the death pop when the host knows the colour.
    const f = setup();
    const w = new WorldBridge(f.stage, { player: () => player, sceneNow: () => 0, juice: null, classAura: () => null, hideColor: () => 0x5a8a3c });
    const bus = new EventBus<GameEvents>();
    w.attachBus(bus);
    const m = monster('jellop');
    bus.emit('death', { target: m, rank: 'common', x: m.x, y: m.y });
    const play = f.plays.at(-1)!;
    expect(play.ctx.chipTint).toBe(chipTint(0x5a8a3c));
    expect(play.pieces.some((p) => p.component === 'motes' && (p.params as { kind: string }).kind === 'chip')).toBe(true);
  });
});

describe('warden intro pan trigger', () => {
  it('pans once per warden per visit on first sight or aggro, never on the arrival', () => {
    // Arriving in the warden's arena with it in view (Stormbreak: 288 px away): no pan during the arrival beat, none
    // after it while the warden only paces; the pan starts when it turns on the player (aggro), and only once.
    const w = new IntroWatch<object>();
    const hoof = {};
    expect(w.due(hoof, { arriving: true, inView: true, aggro: false })).toBe(false);
    expect(w.due(hoof, { arriving: false, inView: true, aggro: false })).toBe(false);
    expect(w.due(hoof, { arriving: false, inView: true, aggro: true })).toBe(true);
    expect(w.due(hoof, { arriving: false, inView: true, aggro: true })).toBe(false);
    // A warden out of view at arrival pans on first sight (or on aggro from off-screen), once.
    const regent = {};
    expect(w.due(regent, { arriving: true, inView: false, aggro: false })).toBe(false);
    expect(w.due(regent, { arriving: false, inView: false, aggro: false })).toBe(false);
    expect(w.due(regent, { arriving: false, inView: true, aggro: false })).toBe(true);
    expect(w.due(regent, { arriving: false, inView: true, aggro: true })).toBe(false);
    const far = {};
    expect(w.due(far, { arriving: false, inView: false, aggro: true })).toBe(true);
    // Aggro is never read during the arrival beat (spawn protection): a new visit is a new watch.
    const again = new IntroWatch<object>();
    expect(again.due(hoof, { arriving: true, inView: true, aggro: true })).toBe(false);
    expect(again.due(hoof, { arriving: false, inView: true, aggro: true })).toBe(true);
  });
});

describe('camera rig', () => {
  function fakeScene() {
    const rect = {
      visible: false,
      alpha: 0,
      setOrigin() {
        return this;
      },
      setScrollFactor() {
        return this;
      },
      setDepth() {
        return this;
      },
      setSize() {
        return this;
      },
      setFillStyle() {
        return this;
      },
      setAlpha(a: number) {
        this.alpha = a;
        return this;
      },
      setVisible(v: boolean) {
        this.visible = v;
        return this;
      },
      destroy() {},
    };
    return { scene: { cameras: { main: { width: 400, height: 300 } }, add: { rectangle: () => rect } } as never, rect };
  }

  it('shakes in whole art pixels from trauma², decays it, and never more than 6 px', () => {
    const r = new CameraRig(null);
    r.addTrauma(1);
    const seen = new Set<number>();
    for (let i = 0; i < 60; i++) {
      r.update(1 / 60, { x: 0, y: 0 }, { w: 400, h: 300 });
      expect(Number.isInteger(r.jolt.x) && Number.isInteger(r.jolt.y)).toBe(true);
      expect(Math.abs(r.jolt.x)).toBeLessThanOrEqual(6);
      seen.add(r.jolt.x);
    }
    expect(seen.size).toBeGreaterThan(2);
    expect(r.trauma).toBe(0);
  });

  it('kicks along the blow and springs home', () => {
    const r = new CameraRig(null);
    r.kick(0, 4);
    let peak = 0;
    for (let i = 0; i < 30; i++) {
      r.update(1 / 60, { x: 0, y: 0 }, { w: 400, h: 300 });
      peak = Math.max(peak, r.jolt.x);
    }
    expect(peak).toBeGreaterThanOrEqual(3);
    expect(peak).toBeLessThanOrEqual(6);
    expect(r.jolt.x).toBe(0);
  });

  it('governs flashes: alpha <= 0.35, >= 333 ms apart, <= 3 per second, stepped down over 3 frames', () => {
    const { scene, rect } = fakeScene();
    const r = new CameraRig(scene);
    expect(r.flash(0xffffff, 1)).toBe(true);
    expect(rect.alpha).toBeLessThanOrEqual(FLASH.alphaMax);
    expect(r.flash(0xffffff, 0.3)).toBe(false); // too soon
    let shown = 1;
    for (let t = 0; t < 60; t++) {
      r.update(1 / 60, { x: 0, y: 0 }, { w: 400, h: 300 });
      if (r.flash(0xffffff, 0.3)) shown++;
    }
    expect(shown).toBeLessThanOrEqual(FLASH.perSecond);
    expect(rect.visible).toBe(false);
  });

  it('honours "Reduce shake & flashes": trauma x0.3, no flashes, no pans', () => {
    const { scene } = fakeScene();
    const r = new CameraRig(scene, () => true);
    r.addTrauma(1);
    expect(r.trauma).toBeCloseTo(0.3);
    expect(r.flash(0xffffff, 0.3)).toBe(false);
    expect(r.intro(() => ({ x: 200, y: 0 }))).toBe(false);
  });

  it('pans toward a warden and back, keeping the player in view, then leads toward a target', () => {
    const r = new CameraRig(null);
    expect(r.intro(() => ({ x: 300, y: 0 }))).toBe(true);
    let far = 0;
    for (let i = 0; i < 120; i++) {
      r.update(1 / 60, { x: 0, y: 0 }, { w: 400, h: 300 });
      far = Math.max(far, r.look.x);
    }
    expect(far).toBeGreaterThan(80);
    expect(far).toBeLessThanOrEqual(400 * 0.32 + 1);
    expect(r.look.x).toBe(0);
    expect(r.panning).toBe(false);
    r.lead(() => ({ x: 300, y: 0 }));
    for (let i = 0; i < 120; i++) r.update(1 / 60, { x: 0, y: 0 }, { w: 400, h: 300 });
    expect(r.look.x).toBeGreaterThan(10);
    expect(r.look.x).toBeLessThanOrEqual(24);
  });
});
