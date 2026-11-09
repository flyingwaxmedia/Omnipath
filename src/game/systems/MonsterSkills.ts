// Monster techniques (docs/CLIENT-v2.md §6).
//
// Selection: once a monster is engaged it runs on a technique tempo (commons slowest, wardens fastest, enraged
// wardens faster still). When the tempo slot is open it picks a technique by weight among those whose cooldown is
// ready, whose `hpBelow` holds and whose `range` covers the player (projectiles, chains and dashes also need a clear
// line); otherwise it chases and auto-attacks. Wardens under 50 % HP enrage once (roar, red aura, faster tempo, moves
// and swings faster) and weight their enrage (`hpBelow`) techniques ×3.
//
// Every technique is telegraphed: nova = ellipse at the player's position for `delay` ms; projectile = 300 ms
// wind-up then a real, dodgeable projectile; dash = 400 ms lane, then the dash; strike = 300 ms cone; spin = 400 ms
// ring; chain = 300 ms charge then a zap (the range ring shows where it reaches). A technique's own `castMs` adds
// wind-up on top. Zone, ring and cone tells last at least the fair minimum for their size (vfx/recipe fairTellMs:
// max(tell, min(900, 350 + 2.5 r)) ms, docs/VFX.md §13), so a wide zone can still be walked out of. Hit tests use the
// one player body radius (SkillSystem.PLAYER_R).
// Each tell has ONE live geometry function (`geom`): the VFX telegraph draws it every frame (monsterTelegraph.live,
// docs/VFX.md §6.5) and the hit test reads the very same shape when the tell lands, so the drawn rim is the hit area
// by construction. This file draws nothing itself: tells, bodies, impacts and trails are the VFX runtime's (bus
// events). Multi-hit techniques (strike `hits`, spin `pulses`, projectile `count`) land each hit separately, with a gap
// between swings / pulses so the player can still step out; the follow-ups are the tell's later `phases`.
// Damage = monster ATK × skill.power (element neutral vs the player), plus the technique's statuses on the player.
// Commons and elites can be interrupted by stunning or freezing them mid wind-up; wardens cannot.
//
// Echo witness: an echo technique begun at the player within 6 tiles is marked on that instance (an 'Echo!' floater
// the first time per instance); Combat.kill credits the marks with SkillBook.witness.
import type Phaser from 'phaser';
import type { MonsterRank, MonsterTechnique, SkillDef, StatusKind } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import { esc } from '../../ui/util';
import type { Monster } from '../entities/Monster';
import type { MapScene } from '../scenes/MapScene';
import { gameBus, type TellShape } from '../events';
import { Y_BIAS, ySort } from '../render/depths';
import { TILE } from '../world/runtime';
import { fairTellMs } from '../vfx/recipe';
import { PLAYER_R, clearShot, distToSegment, nextProjectileId } from './SkillSystem';

const WITNESS_RANGE = 6 * TILE;
/**
 * Telegraph length (ms) per shape; novas use their own `delay` (at least NOVA_MIN). Zone, ring and cone tells get
 * the fair minimum for their size (fairTellMs: max(tell, min(900, 350 + 2.5 r))), so a big zone can be walked out of.
 */
const TELL = { projectile: 300, dash: 400, strike: 300, spin: 400, chain: 300, buff: 400 } as const;
const NOVA_MIN = 500;
/** Gap between a technique's pulses / swings so a later one can still be escaped. */
const PULSE_GAP = 260;
const SWING_GAP = 220;
/** Recovery after a technique (a short punish window). */
const RECOVERY = 220;
/** Ms between techniques once engaged (min, max). */
const TEMPO: Record<MonsterRank, [number, number]> = { common: [3200, 4800], elite: [2300, 3300], warden: [1500, 2200] };
const ENRAGED_TEMPO = 0.75;
/** First technique after engaging. */
const OPENING: Record<MonsterRank, [number, number]> = { common: [900, 1800], elite: [700, 1400], warden: [600, 1000] };
const ENRAGE_WEIGHT = 3;

interface HitSpec {
  /** The monster striking (playerHurt.attacker). */
  m: Monster;
  dmg: number;
  from: string;
  statuses: StatusKind[];
  rank: MonsterRank;
  skill: SkillDef;
}

interface Pending {
  /** monsterTelegraph / monsterTelegraphEnd id (announced only for wind-ups). */
  id: number;
  m: Monster;
  skill: SkillDef;
  start: number;
  at: number;
  /** The tell's exact live geometry: drawn by the VFX every frame, hit-tested on resolve. */
  geom: () => TellShape;
  /** pending -> resolved (its hits ran) | cancelled (death, leash, interrupt). Read live by the VFX telegraph. */
  state: 'pending' | 'resolved' | 'cancelled';
  resolve: () => void;
  /** Wind-up (not a follow-up pulse): the monster glows and can be interrupted. */
  windup: boolean;
}

interface Shot {
  /** projectileSpawn / projectileEnd id. */
  id: number;
  /** The monster that fired it (event payloads). */
  m: Monster;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  traveled: number;
  range: number;
  size: number;
  hit: HitSpec;
}

interface Sweep {
  m: Monster;
  sx: number;
  sy: number;
  ex: number;
  ey: number;
  w: number;
  t: number;
  dur: number;
  done: boolean;
  hit: HitSpec;
}

const between = ([a, b]: [number, number]) => a + Math.random() * (b - a);

/** Statuses a technique puts on the player: its element's status, then its own (holy smite only heals casters). */
function statusesOf(s: MapScene, skill: SkillDef): StatusKind[] {
  const out: StatusKind[] = [];
  const el = skill.element ? s.reg.element(skill.element) : undefined;
  if (el && el.status !== 'smite') out.push(el.status);
  if (skill.status && skill.status !== 'smite' && !out.includes(skill.status)) out.push(skill.status);
  return out;
}

/** Telegraph ids (unique per tell for the whole run). */
let tellSeq = 1;

export class MonsterSkills {
  private active: Pending[] = [];
  private shots: Shot[] = [];
  private sweeps: Sweep[] = [];

  constructor(private s: MapScene) {}

  // ---------------------------------------------------------------- selection

  /** A hostile monster at distance `dist` may start a technique. True when it did (skip the auto-attack). */
  tryStart(m: Monster, now: number, dist: number): boolean {
    const techs = m.def.techniques;
    if (!techs?.length || now < m.busyUntil) return false;
    if (!m.nextTechAt) {
      m.nextTechAt = now + between(OPENING[m.def.rank]);
      return false;
    }
    if (now < m.nextTechAt) return false;
    const s = this.s;
    const p = s.player;
    const hpFrac = m.hp / m.maxHp;
    let clear: boolean | null = null;
    const los = () => (clear ??= clearShot(s.cm, m.x, m.y, p.x, p.y));
    const ready: { t: MonsterTechnique; skill: SkillDef }[] = [];
    for (const t of techs) {
      if ((m.techReadyAt.get(t.skill) ?? 0) > now) continue;
      if (t.hpBelow !== undefined && hpFrac >= t.hpBelow) continue;
      if (dist > t.range) continue;
      const skill = s.reg.skill(t.skill);
      if (!skill) continue;
      const k = skill.shape.kind;
      if ((k === 'projectile' || k === 'chain' || k === 'dash') && !los()) continue;
      if (k === 'dash' && dist < m.radius + 30) continue;
      ready.push({ t, skill });
    }
    if (!ready.length) {
      m.nextTechAt = now + 350;
      return false;
    }
    const weight = (t: MonsterTechnique) => t.weight * (m.enraged && t.hpBelow !== undefined ? ENRAGE_WEIGHT : 1);
    let roll = Math.random() * ready.reduce((a, r) => a + weight(r.t), 0);
    let pick = ready[0];
    for (const r of ready) {
      roll -= weight(r.t);
      if (roll <= 0) {
        pick = r;
        break;
      }
    }
    m.techReadyAt.set(pick.t.skill, now + pick.t.cooldown);
    const dur = this.start(m, pick.t, pick.skill, now, dist);
    m.nextTechAt = now + dur + between(TEMPO[m.def.rank]) * (m.enraged ? ENRAGED_TEMPO : 1);
    return true;
  }

  /** Warden below 50 % HP: a roar (stagger; the VFX shakes and rings it), then faster tempo and enrage techniques. */
  enrage(m: Monster, now: number): void {
    const s = this.s;
    m.enraged = true;
    gameBus.emit('enrage', { monster: m, x: m.x, y: m.y });
    s.floatText(m.x, this.headY(m, 22), 'ENRAGED!', '#ff6a4a', 17);
    s.ui.toast(`💢 <b>${esc(m.def.name)}</b> is enraged!`);
    s.ui.log(`💢 <b>${esc(m.def.name)}</b> is enraged — it moves, swings and casts faster. Watch the red.`, 'warn');
    // The roar's rings, burst and camera trauma are the VFX runtime's (enrage).
    m.chargeColor = 0xff3b1a;
    if (now >= m.busyUntil) {
      m.busyUntil = now + 600;
      s.tweens.addCounter({ from: 1, to: 0, duration: 600, onUpdate: (tw) => (m.charge = tw.getValue() ?? 0) });
    }
    m.nextTechAt = Math.min(m.nextTechAt || now + 700, now + 700);
    s.combat.updateTargetUi();
  }

  // ---------------------------------------------------------------- techniques

  /** Starts a technique; returns how long it runs (telegraphs + follow-ups) in ms. */
  private start(m: Monster, tech: MonsterTechnique, skill: SkillDef, now: number, dist: number): number {
    const s = this.s;
    const p = s.player;
    m.facing = p.x > m.x ? 1 : -1;
    // Echo witness: the technique begins at the player within 6 tiles.
    if (tech.echo && dist <= WITNESS_RANGE && !s.book.has(skill.id) && !m.witnessed.has(skill.id)) {
      m.witnessed.add(skill.id);
      if (!m.eyeShown) {
        m.eyeShown = true;
        s.floatText(m.x, this.headY(m, 18), 'Echo!', '#e8f4ff', 13);
      }
    }
    const color = skill.element ? (s.reg.element(skill.element)?.color ?? 0xff3b3b) : 0xff3b3b;
    const hit: HitSpec = {
      m,
      dmg: Math.max(1, Math.round(m.atk(now) * skill.power)),
      from: `${m.def.name}'s ${skill.name}`,
      statuses: statusesOf(s, skill),
      rank: m.def.rank,
      skill,
    };
    m.chargeColor = color;
    s.floatText(m.x, this.headY(m, 2), skill.name, '#ffc8b8', 12);
    const wind = skill.castMs ?? 0;
    const sh = skill.shape;
    let total = 0;
    // The wind-up tell and its follow-up phases (later swings / pulses), all on ONE live geometry.
    let main: Pending | null = null;
    const follow: Pending[] = [];
    const ref = { skillId: skill.id, skill, element: skill.element };
    switch (sh.kind) {
      case 'nova': {
        const cx = p.x;
        const cy = p.y;
        const r = sh.radius;
        total = fairTellMs(Math.max(NOVA_MIN, sh.delay ?? 0) + wind, r);
        const geom = (): TellShape => ({ kind: 'zone', x: cx, y: cy, rx: r, ry: r * 0.65 });
        main = this.tell(m, skill, now, total, true, geom, () => {
          gameBus.emit('novaBlast', { owner: m, skillId: skill.id, skill, element: skill.element, x: cx, y: cy, radius: r, heavy: skill.power >= 2 || skill.tags.includes('heavy') });
          if (inZone(geom(), p)) this.hitPlayer(hit, { x: cx, y: cy });
        });
        break;
      }
      case 'projectile': {
        total = TELL.projectile + wind;
        const count = sh.count ?? 1;
        const spread = ((sh.spread ?? (count > 1 ? 30 : 0)) * Math.PI) / 180;
        const angsAt = (base: number) => Array.from({ length: count }, (_, i) => (count > 1 ? base - spread / 2 + (spread * i) / (count - 1) : base));
        // The aim follows the player through the wind-up; the volley leaves along the aim it shows on release.
        const geom = (): TellShape => ({
          kind: 'aim',
          x: m.x,
          y: m.y - Math.min(30, m.sprite.displayHeight * 0.5),
          angs: angsAt(Math.atan2(p.y - m.y, p.x - m.x)),
          len: Math.min(sh.range, Math.hypot(p.x - m.x, p.y - m.y) + 30),
        });
        main = this.tell(m, skill, now, total, true, geom, () => {
          const base = Math.atan2(p.y - m.y, p.x - m.x);
          gameBus.emit('skillPulse', { ...ref, owner: m, index: 0, count: 1, ang: base, aim: { x: p.x, y: p.y }, x: m.x, y: m.y });
          angsAt(base).forEach((a, i) => this.shoot(m, a, sh.speed, sh.range, sh.size ?? 12, hit, i, count));
        });
        break;
      }
      case 'dash': {
        total = TELL.dash + wind;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const w = Math.max(24, sh.width);
        const geom = (): TellShape => {
          const [ex, ey] = this.dashEnd(m.x, m.y, a, sh.distance);
          return { kind: 'lane', x0: m.x, y0: m.y, x1: ex, y1: ey, width: w };
        };
        main = this.tell(m, skill, now, total, true, geom, () => {
          const g = geom() as Extract<TellShape, { kind: 'lane' }>;
          const dur = Math.max(140, Math.hypot(g.x1 - g.x0, g.y1 - g.y0) / 1.1);
          this.sweeps.push({ m, sx: g.x0, sy: g.y0, ex: g.x1, ey: g.y1, w, t: 0, dur, done: false, hit });
          gameBus.emit('dash', { owner: m, skillId: skill.id, skill, element: skill.element, from: { x: g.x0, y: g.y0 }, to: { x: g.x1, y: g.y1 }, durationMs: dur, width: w, spin: false });
        });
        total += Math.max(140, sh.distance / 1.1);
        break;
      }
      case 'strike': {
        const hits = sh.hits ?? 1;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const arc = (sh.arc * Math.PI) / 180;
        const range = sh.range + m.radius;
        const geom = (): TellShape => ({ kind: 'cone', x: m.x, y: m.y, r: range, ang: a, arc });
        let swingN = 0;
        const swing = () => {
          gameBus.emit('skillPulse', { ...ref, owner: m, index: swingN++, count: hits, ang: a, aim: { x: p.x, y: p.y }, x: m.x, y: m.y });
          if (inCone(geom(), p, m.radius)) this.hitPlayer(hit, { x: m.x, y: m.y });
        };
        total = fairTellMs(TELL.strike + wind, range);
        main = this.tell(m, skill, now, total, true, geom, swing);
        for (let h = 1; h < hits; h++) follow.push(this.tell(m, skill, now + total + (h - 1) * SWING_GAP, SWING_GAP, false, geom, swing));
        total += (hits - 1) * SWING_GAP;
        break;
      }
      case 'spin': {
        const pulses = sh.pulses ?? 1;
        const r = sh.radius + m.radius;
        const geom = (): TellShape => ({ kind: 'zone', x: m.x, y: m.y, rx: r, ry: r * 0.65 });
        let pulseN = 0;
        const pulse = () => {
          gameBus.emit('skillPulse', { ...ref, owner: m, index: pulseN++, count: pulses, ang: Math.atan2(p.y - m.y, p.x - m.x), x: m.x, y: m.y });
          if (inZone(geom(), p)) this.hitPlayer(hit, { x: m.x, y: m.y });
        };
        total = fairTellMs(TELL.spin + wind, r);
        main = this.tell(m, skill, now, total, true, geom, pulse);
        for (let i = 1; i < pulses; i++) follow.push(this.tell(m, skill, now + total + (i - 1) * PULSE_GAP, PULSE_GAP, false, geom, pulse));
        total += (pulses - 1) * PULSE_GAP;
        break;
      }
      case 'chain': {
        total = TELL.chain + wind;
        const range = sh.range;
        const geom = (): TellShape => ({ kind: 'range', x: m.x, y: m.y, r: range });
        main = this.tell(m, skill, now, total, true, geom, () => {
          const my = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
          const from = { x: m.x, y: my };
          const to = { x: p.x, y: p.y - 18 };
          if (inRange(geom(), p) && clearShot(s.cm, m.x, m.y, p.x, p.y)) {
            gameBus.emit('chainHop', { owner: m, skillId: skill.id, skill, element: skill.element, from, to, index: 0, target: 'player', knives: false });
            this.hitPlayer(hit, { x: m.x, y: m.y });
          } else {
            // Out of reach or blocked: the charge fizzles at the caster (the VFX draws it).
            gameBus.emit('chainLaunch', { owner: m, skillId: skill.id, skill, element: skill.element, from, to: from, index: 0, target: null, knives: false, flightMs: 0 });
          }
        });
        break;
      }
      case 'buff': {
        total = TELL.buff + wind;
        const bs = sh;
        const bc = s.combat.buffColor(bs.stat);
        const geom = (): TellShape => ({ kind: 'aura', x: m.x, y: m.y, rx: m.radius + 10, ry: (m.radius + 10) / 2 });
        main = this.tell(m, skill, now, total, true, geom, () => {
          const until = s.time.now + bs.duration;
          m.buffs = m.buffs.filter((b) => b.stat !== bs.stat);
          m.buffs.push({ stat: bs.stat, amount: bs.amount, until, color: bc });
          gameBus.emit('buffApplied', { target: m, skillId: skill.id, skill, element: skill.element, stat: bs.stat, amount: bs.amount, durationMs: bs.duration, untilMs: until, x: m.x, y: m.y });
          s.floatText(m.x, this.headY(m, 14), `${bs.stat.toUpperCase()} ↑`, '#ffe9a0', 12);
        });
        break;
      }
    }
    const aimed = sh.kind !== 'spin' && sh.kind !== 'buff';
    const radius = sh.kind === 'nova' ? sh.radius : sh.kind === 'spin' ? sh.radius + m.radius : sh.kind === 'chain' ? sh.range : undefined;
    // The wind-up tell's real length (the fair minimum included).
    const windMs = main ? main.at - main.start : total;
    gameBus.emit('monsterTelegraph', {
      ...ref,
      monster: m,
      shape: sh.kind,
      x: m.x,
      y: m.y,
      at: aimed ? { x: p.x, y: p.y } : { x: m.x, y: m.y },
      durationMs: windMs,
      radius,
      echo: !!tech.echo,
      rank: m.def.rank,
      ...(main ? { id: main.id, timing: main, tell: main.geom(), live: main.geom, phases: [main, ...follow] } : {}),
    });
    m.busyUntil = now + total + RECOVERY;
    m.nextAttack = Math.max(m.nextAttack, now + total + 400);
    return total;
  }

  private tell(m: Monster, skill: SkillDef, start: number, dur: number, windup: boolean, geom: () => TellShape, resolve: () => void): Pending {
    const p: Pending = { id: tellSeq++, m, skill, start, at: start + dur, geom, state: 'pending', resolve, windup };
    this.active.push(p);
    return p;
  }

  /** Where a dash from (x, y) toward `a` stops (walls and closed gates end it early). */
  private dashEnd(x: number, y: number, a: number, distance: number): [number, number] {
    let ex = x;
    let ey = y;
    for (let d = 8; d <= distance; d += 8) {
      const nx = x + Math.cos(a) * d;
      const ny = y + Math.sin(a) * d;
      if (isBlockedPx(this.s.cm, nx, ny)) break;
      ex = nx;
      ey = ny;
    }
    return [ex, ey];
  }

  // ---------------------------------------------------------------- hits

  private hitPlayer(hit: HitSpec, source: { x: number; y: number }): void {
    // The impact on the player is the VFX runtime's (playerHurt carries attacker + technique).
    this.s.combat.hurtPlayer(hit.dmg, hit.from, { statuses: hit.statuses, source, rank: hit.rank, attacker: hit.m, skill: hit.skill });
  }

  private shoot(m: Monster, a: number, speed: number, range: number, size: number, hit: HitSpec, index = 0, count = 1): void {
    const s = this.s;
    const y = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
    // The Image is the shot's identity on the bus (projectileSpawn.obj); the VFX runtime draws its body and trail.
    const img = s.add.image(m.x, y, '__DEFAULT').setVisible(false).setRotation(a).setDepth(ySort(m.y, Y_BIAS.PROJECTILE));
    const shot: Shot = { id: nextProjectileId(), m, img, x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, traveled: 0, range, size, hit };
    this.shots.push(shot);
    gameBus.emit('projectileSpawn', { owner: m, obj: img, mover: shot, id: shot.id, index, count, skillId: hit.skill.id, skill: hit.skill, element: hit.skill.element, x: m.x, y: m.y, angle: a, speed, range, size });
  }

  // ---------------------------------------------------------------- update

  update(dt: number, now: number): void {
    const s = this.s;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (!a.m.alive) {
        this.active.splice(i, 1);
        this.ended(a, 'cancel');
        continue;
      }
      // Stunning or freezing a common or elite mid wind-up interrupts it (wardens push through).
      if (a.windup && !a.m.warden && a.m.stunned && now < a.at) {
        this.interrupt(a.m);
        continue;
      }
      if (now < a.start) continue;
      const t = Math.min(1, (now - a.start) / Math.max(1, a.at - a.start));
      if (a.windup) a.m.charge = t;
      if (now >= a.at) {
        const idx = this.active.indexOf(a);
        if (idx >= 0) this.active.splice(idx, 1);
        if (a.windup) a.m.charge = 0;
        a.state = 'resolved';
        a.resolve();
        this.ended(a, 'resolve');
      }
    }
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const w = this.sweeps[i];
      const m = w.m;
      if (!m.alive) {
        this.sweeps.splice(i, 1);
        continue;
      }
      w.t = Math.min(1, w.t + (dt * 1000) / w.dur);
      m.x = w.sx + (w.ex - w.sx) * w.t;
      m.y = w.sy + (w.ey - w.sy) * w.t;
      const p = s.player;
      if (!w.done && distToSegment(p.x, p.y, w.sx, w.sy, m.x, m.y) <= w.w / 2 + PLAYER_R) {
        w.done = true;
        this.hitPlayer(w.hit, { x: m.x, y: m.y });
      }
      if (w.t >= 1) this.sweeps.splice(i, 1);
    }
    const p = s.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      const sx = sh.vx * dt;
      const sy = sh.vy * dt;
      sh.x += sx;
      sh.y += sy;
      sh.traveled += Math.hypot(sx, sy);
      sh.img.setPosition(sh.x, sh.y - 14).setDepth(ySort(sh.y, Y_BIAS.PROJECTILE));
      let dead = sh.traveled >= sh.range || isBlockedPx(s.cm, sh.x, sh.y);
      if (!dead && Math.hypot(p.x - sh.x, p.y - sh.y) <= PLAYER_R + sh.size / 2) {
        this.hitPlayer(sh.hit, { x: sh.x - sh.vx * 0.05, y: sh.y - sh.vy * 0.05 });
        dead = true;
      }
      if (dead) {
        const sk = sh.hit.skill;
        gameBus.emit('projectileEnd', { owner: sh.m, obj: sh.img, mover: sh, id: sh.id, skillId: sk.id, skill: sk, element: sk.element, x: sh.x, y: sh.y, reason: sh.traveled >= sh.range ? 'expire' : isBlockedPx(s.cm, sh.x, sh.y) ? 'wall' : 'hit' });
        sh.img.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  /**
   * Where a floater over monster `m` goes: above its head, or under its feet when the head is near the top of the
   * view (the warden pill and top HUD would cover it on phones).
   */
  private headY(m: Monster, lift: number): number {
    const above = m.y - m.sprite.displayHeight - lift;
    const view = this.s.cameras.main.worldView;
    return above - view.y < 120 / this.s.cameras.main.zoom ? m.y + 22 + lift * 0.6 : above;
  }

  private interrupt(m: Monster): void {
    this.cancel(m);
    this.s.floatText(m.x, this.headY(m, 16), 'Interrupted!', '#9fe0ff', 12);
  }

  /** monsterTelegraphEnd for an announced (wind-up) tell. */
  private ended(a: Pending, reason: 'resolve' | 'cancel'): void {
    if (reason === 'cancel') a.state = 'cancelled';
    if (a.windup) gameBus.emit('monsterTelegraphEnd', { id: a.id, monster: a.m, reason });
  }

  /** Drops a monster's pending technique and dash (death, leash, interrupt). Fired projectiles keep flying. */
  cancel(m: Monster): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (a.m !== m) continue;
      this.active.splice(i, 1);
      this.ended(a, 'cancel');
    }
    this.sweeps = this.sweeps.filter((w) => w.m !== m);
    m.busyUntil = 0;
    m.charge = 0;
  }

  /** The world was frozen for `ms` (panel pause, hit-stop): telegraphs resume where they were. */
  shiftTime(ms: number): void {
    for (const a of this.active) {
      a.start += ms;
      a.at += ms;
    }
  }

  clear(): void {
    for (const a of this.active) a.state = 'cancelled';
    for (const s of this.shots) s.img.destroy();
    this.active = [];
    this.shots = [];
    this.sweeps = [];
  }
}

// ---------------------------------------------------------------- hit tests on the tell geometry

type Shape<K extends TellShape['kind']> = Extract<TellShape, { kind: K }>;

/** Zone (nova, spin): the player's feet inside the 0.65 ellipse. */
function inZone(g: TellShape, p: { x: number; y: number }): boolean {
  const z = g as Shape<'zone'>;
  return Math.hypot((p.x - z.x) / z.rx, (p.y - z.y) / z.ry) <= 1;
}

/** Cone (strike): the player's body overlaps the sector, or touches the caster. */
function inCone(g: TellShape, p: { x: number; y: number }, casterR: number): boolean {
  const c = g as Shape<'cone'>;
  const d = Math.hypot(p.x - c.x, p.y - c.y);
  let diff = Math.atan2(p.y - c.y, p.x - c.x) - c.ang;
  while (diff > Math.PI) diff -= Math.PI * 2;
  while (diff < -Math.PI) diff += Math.PI * 2;
  return d <= c.r + PLAYER_R && (Math.abs(diff) <= c.arc / 2 + Math.atan2(PLAYER_R, Math.max(1, d)) || d < casterR + PLAYER_R);
}

/** Range (chain): the player's body within reach. */
function inRange(g: TellShape, p: { x: number; y: number }): boolean {
  const r = g as Shape<'range'>;
  return Math.hypot(p.x - r.x, p.y - r.y) <= r.r + PLAYER_R;
}

/** The hit tests above, for tests and the VFX hitbox check (docs/VFX.md §11.2). */
export const TELL_HIT = { inZone, inCone, inRange } as const;
