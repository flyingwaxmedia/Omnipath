// Monster techniques (docs/CLIENT-v2.md §6).
//
// Selection: once a monster is engaged it runs on a technique tempo (commons slowest, wardens fastest, enraged
// wardens faster still). When the tempo slot is open it picks a technique by weight among those whose cooldown is
// ready, whose `hpBelow` holds and whose `range` covers the player (projectiles, chains and dashes also need a clear
// line); otherwise it chases and auto-attacks. Wardens under 50 % HP enrage once (roar, red aura, faster tempo, moves
// and swings faster) and weight their enrage (`hpBelow`) techniques ×3.
//
// Every technique is telegraphed in red with the element's colour filling toward impact (a white rim flashes just
// before it lands): nova = ellipse at the player's position for `delay` ms; projectile = 300 ms wind-up then a real,
// dodgeable projectile; dash = 400 ms lane, then the dash; strike = 300 ms cone; spin = 400 ms ring; chain = 300 ms
// charge then a zap (the range ring shows where it reaches). A technique's own `castMs` adds wind-up on top.
// Fills are ground decals; rims, aim lines and arrow heads are repeated on an overlay layer so trees and bodies never
// hide a zone. Multi-hit techniques (strike `hits`, spin `pulses`, projectile `count`) land each hit separately, with
// a gap between swings / pulses so the player can still step out.
// Damage = monster ATK × skill.power (element neutral vs the player), plus the technique's statuses on the player.
// Commons and elites can be interrupted by stunning or freezing them mid wind-up; wardens cannot.
//
// Echo witness: an echo technique begun at the player within 6 tiles is marked on that instance (a '👁' floater
// the first time per instance); Combat.kill credits the marks with SkillBook.witness.
import Phaser from 'phaser';
import type { MonsterRank, MonsterTechnique, SkillDef, StatusKind } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import { esc } from '../../ui/util';
import type { Monster } from '../entities/Monster';
import type { MapScene } from '../scenes/MapScene';
import { gameBus } from '../events';
import { DEPTH, Y_BIAS, ySort } from '../render/depths';
import { TILE } from '../world/runtime';
import { clearShot, distToSegment, fxStyle } from './SkillSystem';

const WITNESS_RANGE = 6 * TILE;
const DANGER = 0xff3b3b;
const PLAYER_R = 14;
/** Telegraph length (ms) per shape; novas use their own `delay` (at least NOVA_MIN). */
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
  dmg: number;
  from: string;
  statuses: StatusKind[];
  rank: MonsterRank;
  skill: SkillDef;
  color: number;
}

interface Pending {
  m: Monster;
  skill: SkillDef;
  start: number;
  at: number;
  /** Ground decal (under sprites). */
  gfx: Phaser.GameObjects.Graphics;
  /** Overlay rims and aim lines (above sprites and tree canopies, so a zone is never hidden). */
  top: Phaser.GameObjects.Graphics;
  /** Redraws the telegraph at progress t (0..1). */
  draw: (g: Phaser.GameObjects.Graphics, t: number, top: Phaser.GameObjects.Graphics) => void;
  resolve: () => void;
  /** Wind-up (not a follow-up pulse): the monster glows and can be interrupted. */
  windup: boolean;
}

interface Shot {
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
  spin: number;
  trailT: number;
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
  trailT: number;
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

  /** Warden below 50 % HP: a roar (stagger, shake, red rings), then faster tempo and enrage techniques. */
  enrage(m: Monster, now: number): void {
    const s = this.s;
    m.enraged = true;
    s.floatText(m.x, this.headY(m, 22), '💢 ENRAGED', '#ff6a4a', 17);
    s.ui.toast(`💢 <b>${esc(m.def.name)}</b> is enraged!`);
    s.ui.log(`💢 <b>${esc(m.def.name)}</b> is enraged — it moves, swings and casts faster. Watch the red.`, 'warn');
    s.cameras.main.shake(260, 0.008);
    s.skills.fxRing(m.x, m.y - 8, m.radius * 2.4, 0xff3b1a, false);
    s.time.delayedCall(160, () => m.alive && s.skills.fxRing(m.x, m.y - 8, m.radius * 3.2, 0xff6a2a, false));
    s.skills.fxBurst(m.x, m.y - 20, 0xff5a3a, 24);
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
        s.floatText(m.x, this.headY(m, 18), '👁', '#e8f4ff', 17);
      }
    }
    const color = skill.element ? (s.reg.element(skill.element)?.color ?? DANGER) : DANGER;
    const hit: HitSpec = {
      dmg: Math.max(1, Math.round(m.atk(now) * skill.power)),
      from: `${m.def.name}'s ${skill.name}`,
      statuses: statusesOf(s, skill),
      rank: m.def.rank,
      skill,
      color,
    };
    m.chargeColor = color;
    s.floatText(m.x, this.headY(m, 2), `${skill.icon} ${skill.name}`, '#ffc8b8', 12);
    const wind = skill.castMs ?? 0;
    const sh = skill.shape;
    let total = 0;
    switch (sh.kind) {
      case 'nova': {
        const cx = p.x;
        const cy = p.y;
        const r = sh.radius;
        total = Math.max(NOVA_MIN, sh.delay ?? 0) + wind;
        this.tell(m, skill, now, total, true, (g, t, top) => this.zone(g, top, cx, cy, r, r * 0.65, t, color), () => {
          gameBus.emit('novaBlast', { owner: m, skillId: skill.id, skill, element: skill.element, x: cx, y: cy, radius: r, heavy: skill.power >= 2 || skill.tags.includes('heavy') });
          s.skills.fxNova(cx, cy, r, color, skill.element, skill.power >= 2 || skill.tags.includes('heavy'));
          if (m.warden) s.cameras.main.shake(160, 0.007);
          if (Math.hypot((p.x - cx) / r, (p.y - cy) / (r * 0.65)) <= 1) this.hitPlayer(hit, { x: cx, y: cy });
        });
        break;
      }
      case 'projectile': {
        total = TELL.projectile + wind;
        const count = sh.count ?? 1;
        const spread = ((sh.spread ?? (count > 1 ? 30 : 0)) * Math.PI) / 180;
        this.tell(
          m,
          skill,
          now,
          total,
          true,
          (g, t, top) => {
            const mx = m.x;
            const my = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
            const base = Math.atan2(p.y - m.y, p.x - m.x);
            const len = Math.min(sh.range, Math.hypot(p.x - m.x, p.y - m.y) + 30);
            for (let i = 0; i < count; i++) {
              const a = count > 1 ? base - spread / 2 + (spread * i) / (count - 1) : base;
              this.dashed(top, mx, my, mx + Math.cos(a) * len, my + Math.sin(a) * len, t > 0.8 ? 0xffffff : DANGER, 0.35 + 0.5 * t);
            }
            top.fillStyle(color, 0.35 + 0.45 * t).fillCircle(mx, my, 6 + 8 * t);
            top.fillStyle(0xffffff, 0.8 * t).fillCircle(mx, my, 2 + 4 * t);
            g.fillStyle(DANGER, 0.08 + 0.1 * t).fillCircle(p.x, p.y, PLAYER_R + 8);
          },
          () => {
            const base = Math.atan2(p.y - m.y, p.x - m.x);
            for (let i = 0; i < count; i++) {
              const a = count > 1 ? base - spread / 2 + (spread * i) / (count - 1) : base;
              this.shoot(m, a, sh.speed, sh.range, sh.size ?? 12, hit);
            }
          },
        );
        break;
      }
      case 'dash': {
        total = TELL.dash + wind;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const w = Math.max(24, sh.width);
        this.tell(
          m,
          skill,
          now,
          total,
          true,
          (g, t, top) => {
            const [ex, ey] = this.dashEnd(m.x, m.y, a, sh.distance);
            g.lineStyle(w, DANGER, 0.12 + 0.12 * t).lineBetween(m.x, m.y, ex, ey);
            g.lineStyle(w * 0.55, color, 0.18 + 0.2 * t).lineBetween(m.x, m.y, m.x + (ex - m.x) * t, m.y + (ey - m.y) * t);
            const nx = -Math.sin(a) * (w / 2);
            const ny = Math.cos(a) * (w / 2);
            g.lineStyle(2, DANGER, 0.85);
            g.lineBetween(m.x + nx, m.y + ny, ex + nx, ey + ny);
            g.lineBetween(m.x - nx, m.y - ny, ex - nx, ey - ny);
            top.lineStyle(2, t > 0.8 ? 0xffffff : DANGER, 0.55);
            top.lineBetween(m.x + nx, m.y + ny, ex + nx, ey + ny);
            top.lineBetween(m.x - nx, m.y - ny, ex - nx, ey - ny);
            // Arrow head at the far end.
            const hx = ex + Math.cos(a) * 12;
            const hy = ey + Math.sin(a) * 12;
            top.fillStyle(t > 0.8 ? 0xffffff : DANGER, 0.85).fillTriangle(hx, hy, ex + nx * 0.8, ey + ny * 0.8, ex - nx * 0.8, ey - ny * 0.8);
          },
          () => {
            const [ex, ey] = this.dashEnd(m.x, m.y, a, sh.distance);
            const len = Math.hypot(ex - m.x, ey - m.y);
            this.sweeps.push({ m, sx: m.x, sy: m.y, ex, ey, w, t: 0, dur: Math.max(140, len / 1.1), done: false, trailT: 0, hit });
            gameBus.emit('dash', { owner: m, skillId: skill.id, skill, element: skill.element, from: { x: m.x, y: m.y }, to: { x: ex, y: ey }, durationMs: Math.max(140, len / 1.1), width: w, spin: false });
          },
        );
        total += Math.max(140, sh.distance / 1.1);
        break;
      }
      case 'strike': {
        const hits = sh.hits ?? 1;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const arc = (sh.arc * Math.PI) / 180;
        const range = sh.range + m.radius;
        const style = s.skills.strikeStyle(skill, true);
        const swing = () => {
          s.skills.fxStrike(m.x, m.y - 10, a, arc, range, color, false, style, skill.element);
          const d = Math.hypot(p.x - m.x, p.y - m.y);
          let diff = Math.atan2(p.y - m.y, p.x - m.x) - a;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (d <= range + PLAYER_R && (Math.abs(diff) <= arc / 2 + Math.atan2(PLAYER_R, Math.max(1, d)) || d < m.radius + PLAYER_R)) this.hitPlayer(hit, { x: m.x, y: m.y });
        };
        total = TELL.strike + wind;
        this.tell(m, skill, now, total, true, (g, t, top) => this.cone(g, top, m.x, m.y, range, a, arc, t, color), swing);
        for (let h = 1; h < hits; h++) {
          this.tell(m, skill, now + total + (h - 1) * SWING_GAP, SWING_GAP, false, (g, t, top) => this.cone(g, top, m.x, m.y, range, a, arc, 0.5 + t * 0.5, color), swing);
        }
        total += (hits - 1) * SWING_GAP;
        break;
      }
      case 'spin': {
        const pulses = sh.pulses ?? 1;
        const r = sh.radius + m.radius;
        const pulse = () => {
          s.skills.fxSpin(m.x, m.y - 6, r, color, skill.element);
          if (Math.hypot((p.x - m.x) / r, (p.y - m.y) / (r * 0.65)) <= 1) this.hitPlayer(hit, { x: m.x, y: m.y });
        };
        total = TELL.spin + wind;
        this.tell(m, skill, now, total, true, (g, t, top) => this.zone(g, top, m.x, m.y, r, r * 0.65, t, color), pulse);
        for (let i = 1; i < pulses; i++) {
          this.tell(m, skill, now + total + (i - 1) * PULSE_GAP, PULSE_GAP, false, (g, t, top) => this.zone(g, top, m.x, m.y, r, r * 0.65, 0.4 + 0.6 * t, color), pulse);
        }
        total += (pulses - 1) * PULSE_GAP;
        break;
      }
      case 'chain': {
        total = TELL.chain + wind;
        const range = sh.range;
        this.tell(
          m,
          skill,
          now,
          total,
          true,
          (g, t, top) => {
            const my = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
            g.lineStyle(2, DANGER, 0.2 + 0.3 * t).strokeEllipse(m.x, m.y, range * 2, range * 1.3);
            top.fillStyle(color, 0.35 + 0.5 * t).fillCircle(m.x, my, 4 + 7 * t);
            for (let k = 0; k < 3; k++) {
              const ka = Math.random() * Math.PI * 2;
              top.lineStyle(1.5, 0xffffff, 0.8 * t).lineBetween(m.x, my, m.x + Math.cos(ka) * (8 + 12 * t), my + Math.sin(ka) * (8 + 12 * t));
            }
            if (Math.hypot(p.x - m.x, p.y - m.y) <= range + PLAYER_R) this.dashed(top, m.x, my, p.x, p.y - 18, color, 0.2 + 0.5 * t);
          },
          () => {
            const my = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
            if (Math.hypot(p.x - m.x, p.y - m.y) <= range + PLAYER_R && clearShot(s.cm, m.x, m.y, p.x, p.y)) {
              s.skills.fxLightning([{ x: m.x, y: my }, { x: p.x, y: p.y - 18 }], color);
              gameBus.emit('chainHop', { owner: m, skillId: skill.id, skill, element: skill.element, from: { x: m.x, y: my }, to: { x: p.x, y: p.y - 18 }, index: 0, target: 'player', knives: false });
              this.hitPlayer(hit, { x: m.x, y: m.y });
            } else s.skills.fxBurst(m.x, my, color, 6);
          },
        );
        break;
      }
      case 'buff': {
        total = TELL.buff + wind;
        const bs = sh;
        const bc = s.combat.buffColor(bs.stat);
        this.tell(
          m,
          skill,
          now,
          total,
          true,
          (g, t, top) => {
            g.fillStyle(bc, 0.12 + 0.12 * t).fillEllipse(m.x, m.y, (m.radius * 2 + 20) * (1 + 0.3 * t), (m.radius + 10) * (1 + 0.3 * t));
            top.lineStyle(3, bc, 0.5 + 0.4 * t).strokeEllipse(m.x, m.y, (m.radius * 2 + 20) * (1 + 0.3 * t), (m.radius + 10) * (1 + 0.3 * t));
          },
          () => {
            const until = s.time.now + bs.duration;
            m.buffs = m.buffs.filter((b) => b.stat !== bs.stat);
            m.buffs.push({ stat: bs.stat, amount: bs.amount, until, color: bc });
            gameBus.emit('buffApplied', { target: m, skillId: skill.id, skill, element: skill.element, stat: bs.stat, amount: bs.amount, durationMs: bs.duration, x: m.x, y: m.y });
            s.skills.fxRing(m.x, m.y, m.radius * 2 + 10, bc, false);
            s.floatText(m.x, this.headY(m, 14), `${skill.icon} ${bs.stat.toUpperCase()} ↑`, '#ffe9a0', 12);
          },
        );
        break;
      }
    }
    const aimed = sh.kind !== 'spin' && sh.kind !== 'buff';
    const radius = sh.kind === 'nova' ? sh.radius : sh.kind === 'spin' ? sh.radius + m.radius : sh.kind === 'chain' ? sh.range : undefined;
    const windMs = (sh.kind === 'nova' ? Math.max(NOVA_MIN, sh.delay ?? 0) : TELL[sh.kind]) + wind;
    gameBus.emit('monsterTelegraph', { monster: m, skillId: skill.id, skill, element: skill.element, shape: sh.kind, x: m.x, y: m.y, at: aimed ? { x: p.x, y: p.y } : { x: m.x, y: m.y }, durationMs: windMs, radius, echo: !!tech.echo });
    m.busyUntil = now + total + RECOVERY;
    m.nextAttack = Math.max(m.nextAttack, now + total + 400);
    return total;
  }

  private tell(m: Monster, skill: SkillDef, start: number, dur: number, windup: boolean, draw: Pending['draw'], resolve: () => void): void {
    // Fills are ground decals (DEPTH.TELEGRAPH, under every y-sorted sprite); rims sit on DEPTH.RIM, above sprites,
    // props and canopies but under name tags and floating text.
    const gfx = this.s.add.graphics().setDepth(DEPTH.TELEGRAPH);
    const top = this.s.add.graphics().setDepth(DEPTH.RIM);
    const at = start + dur;
    const p: Pending = { m, skill, start, at, gfx, top, draw, resolve, windup };
    if (start <= this.s.time.now) draw(gfx, 0, top);
    this.active.push(p);
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

  // ---------------------------------------------------------------- telegraph drawing

  /** Danger ellipse: red rim, element fill growing to the rim at impact, a white rim in the last 20 %. */
  private zone(g: Phaser.GameObjects.Graphics, top: Phaser.GameObjects.Graphics, x: number, y: number, rx: number, ry: number, t: number, color: number): void {
    g.fillStyle(DANGER, 0.1 + 0.1 * t).fillEllipse(x, y, rx * 2, ry * 2);
    g.fillStyle(color, 0.2 + 0.2 * t).fillEllipse(x, y, rx * 2 * t, ry * 2 * t);
    g.lineStyle(3, DANGER, 0.9).strokeEllipse(x, y, rx * 2, ry * 2);
    top.lineStyle(2, t > 0.8 ? 0xffffff : DANGER, t > 0.8 ? 0.9 : 0.5).strokeEllipse(x, y, rx * 2, ry * 2);
    if (t > 0.8) g.lineStyle(2, 0xffffff, Math.min(1, (t - 0.8) * 5)).strokeEllipse(x, y, rx * 2 - 5, ry * 2 - 4);
  }

  /** Danger cone from (x, y) toward `a`. */
  private cone(g: Phaser.GameObjects.Graphics, top: Phaser.GameObjects.Graphics, x: number, y: number, range: number, a: number, arc: number, t: number, color: number): void {
    g.fillStyle(DANGER, 0.12 + 0.1 * t);
    g.slice(x, y, range, a - arc / 2, a + arc / 2, false);
    g.fillPath();
    g.fillStyle(color, 0.2 + 0.2 * t);
    g.slice(x, y, Math.max(1, range * t), a - arc / 2, a + arc / 2, false);
    g.fillPath();
    g.lineStyle(3, t > 0.8 ? 0xffffff : DANGER, 0.9);
    g.slice(x, y, range, a - arc / 2, a + arc / 2, false);
    g.strokePath();
    top.lineStyle(2, t > 0.8 ? 0xffffff : DANGER, t > 0.8 ? 0.9 : 0.5);
    top.slice(x, y, range, a - arc / 2, a + arc / 2, false);
    top.strokePath();
  }

  private dashed(g: Phaser.GameObjects.Graphics, x0: number, y0: number, x1: number, y1: number, color: number, alpha: number): void {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.floor(len / 14));
    g.lineStyle(2, color, alpha);
    for (let i = 0; i < n; i++) {
      const t0 = i / n;
      const t1 = (i + 0.55) / n;
      g.lineBetween(x0 + (x1 - x0) * t0, y0 + (y1 - y0) * t0, x0 + (x1 - x0) * t1, y0 + (y1 - y0) * t1);
    }
  }

  // ---------------------------------------------------------------- hits

  private hitPlayer(hit: HitSpec, source: { x: number; y: number }): void {
    const s = this.s;
    const dealt = s.combat.hurtPlayer(hit.dmg, hit.from, { statuses: hit.statuses, source, rank: hit.rank });
    if (dealt > 0) s.skills.fxImpactAt(s.player.x, s.player.y - 20, hit.skill, hit.color, 5);
  }

  private shoot(m: Monster, a: number, speed: number, range: number, size: number, hit: HitSpec): void {
    const s = this.s;
    const look = s.skills.lookFor(hit.skill, size);
    const y = m.y - Math.min(30, m.sprite.displayHeight * 0.5);
    const img = s.add
      .image(m.x, y, look.key)
      .setTint(hit.color)
      .setScale(look.scale)
      .setRotation(a)
      .setBlendMode(look.add ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL)
      .setDepth(ySort(m.y, Y_BIAS.PROJECTILE));
    const shot: Shot = { m, img, x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, traveled: 0, range, size, spin: look.spin, trailT: 0, hit };
    this.shots.push(shot);
    gameBus.emit('projectileSpawn', { owner: m, obj: img, mover: shot, skillId: hit.skill.id, skill: hit.skill, element: hit.skill.element, x: m.x, y: m.y, angle: a, speed, range, size });
  }

  // ---------------------------------------------------------------- update

  update(dt: number, now: number): void {
    const s = this.s;
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (!a.m.alive) {
        a.gfx.destroy();
        a.top.destroy();
        this.active.splice(i, 1);
        continue;
      }
      // Stunning or freezing a common or elite mid wind-up interrupts it (wardens push through).
      if (a.windup && !a.m.warden && a.m.stunned && now < a.at) {
        this.interrupt(a.m);
        continue;
      }
      if (now < a.start) continue;
      const t = Math.min(1, (now - a.start) / Math.max(1, a.at - a.start));
      a.gfx.clear();
      a.top.clear();
      a.draw(a.gfx, t, a.top);
      if (a.windup) a.m.charge = t;
      if (now >= a.at) {
        a.gfx.destroy();
        a.top.destroy();
        const idx = this.active.indexOf(a);
        if (idx >= 0) this.active.splice(idx, 1);
        if (a.windup) a.m.charge = 0;
        a.resolve();
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
      w.trailT -= dt;
      if (w.trailT <= 0) {
        w.trailT = 0.025;
        if (w.hit.skill.element) s.skills.mote(m.x, m.y - 10, w.hit.color, fxStyle(w.hit.skill.element), 0.7);
        else s.skills.particle(m.x, m.y - 6, 0xd8c8b0, 0, -10, 300, 0.7, { add: false, endScale: 1.4 });
      }
      const p = s.player;
      if (!w.done && distToSegment(p.x, p.y, w.sx, w.sy, m.x, m.y) <= w.w / 2 + PLAYER_R) {
        w.done = true;
        this.hitPlayer(w.hit, { x: m.x, y: m.y });
      }
      if (w.t >= 1) {
        s.skills.fxDust(m.x, m.y);
        this.sweeps.splice(i, 1);
      }
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
      if (sh.spin) sh.img.rotation += sh.spin * dt;
      sh.trailT -= dt;
      if (sh.trailT <= 0) {
        sh.trailT = 0.035;
        s.skills.trail(sh.x, sh.y - 14, sh.hit.skill, sh.hit.color, sh.size);
      }
      let dead = sh.traveled >= sh.range || isBlockedPx(s.cm, sh.x, sh.y);
      if (!dead && Math.hypot(p.x - sh.x, p.y - sh.y) <= PLAYER_R + sh.size / 2) {
        this.hitPlayer(sh.hit, { x: sh.x - sh.vx * 0.05, y: sh.y - sh.vy * 0.05 });
        dead = true;
      }
      if (dead) {
        const sk = sh.hit.skill;
        gameBus.emit('projectileEnd', { owner: sh.m, obj: sh.img, mover: sh, skillId: sk.id, skill: sk, element: sk.element, x: sh.x, y: sh.y, reason: sh.traveled >= sh.range ? 'expire' : isBlockedPx(s.cm, sh.x, sh.y) ? 'wall' : 'hit' });
        s.skills.fxImpactAt(sh.x, sh.y - 14, sh.hit.skill, sh.hit.color, 3);
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

  /** Drops a monster's pending technique and dash (death, leash, interrupt). Fired projectiles keep flying. */
  cancel(m: Monster): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].m !== m) continue;
      this.active[i].gfx.destroy();
      this.active[i].top.destroy();
      this.active.splice(i, 1);
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
    for (const a of this.active) {
      a.gfx.destroy();
      a.top.destroy();
    }
    for (const s of this.shots) s.img.destroy();
    this.active = [];
    this.shots = [];
    this.sweeps = [];
  }
}
