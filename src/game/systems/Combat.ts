// Combat (docs/CLIENT-v2.md §6): casting (wind-up, after-cast lock, SP/cooldown passives), hits through the core
// damage formula, combos, statuses and riders, mastery XP via the SkillBook v2 API, sparks, kills, drops, monster AI,
// player damage and statuses, death and respawn. Shape FX live in SkillSystem; monster techniques in MonsterSkills.
//
// Timers use scene time. The scene clock keeps running while the world is paused (panels) or hit-stopped, so every
// combat timer — cooldowns, the after-cast lock, statuses, monster techniques and telegraphs — is shifted forward by
// such gaps (syncClock): nothing recharges, expires or lands while the player cannot act.
import Phaser from 'phaser';
import { BURN_SPREAD_RADIUS, computeDamage, type DamageRoll } from '../../core/combat';
import { MASTERY, monsterThreat } from '../../core/mastery';
import { cooldownPctFor, regenStillPct, spCostPctFor, vsFamilyPct, vsStatusPct } from '../../core/passives';
import type { Family, MonsterRank, SkillDef, StatusKind, WeaponType } from '../../core/types';
import { isBlocked, isBlockedPx } from '../../core/world/compile';
import { findPath } from '../../core/world/pathfinding';
import { COLL } from '../../core/world/types';
import { WEAPONS } from '../../data/weapons';
import { esc } from '../../ui/util';
import { ENRAGE, Monster } from '../entities/Monster';
import type { PlayerDot } from '../entities/Player';
import type { MapScene } from '../scenes/MapScene';
import { type Buff, type Stats, expToNext } from '../session';
import { TILE } from '../world/runtime';
import { CFX, type Cast, type CombatHost, SkillSystem, clearShot, fxStyle, hex } from './SkillSystem';

const GLOOMCAPS_FOR_SHADOW = 5;
/** Dealt or took damage within this window = in combat (buff use XP). */
const COMBAT_WINDOW = 5000;
/** AUTO battle re-checks at most this often (ms). */
const AUTO_TICK_MS = 150;
/** AUTO waits this long after a manual move / interaction tap before hunting again (ms). */
const AUTO_HOLD_MS = 4000;
/** Buffs auto-cast only while the target is this close (px). */
const AUTO_BUFF_RANGE = 192;
/** A monster AUTO could not path to is skipped for this long (ms). */
const AUTO_UNREACHABLE_MS = 15000;
/** Auto-attack chains stop after this long without player input. */
const AFK_MS = 30000;
const LEECH_CAP = 0.08;
/** Arc rider: zaps the N nearest other monsters within this radius. */
const ARC_RADIUS = 120;
/** Player body radius for separation and monster hit tests. */
const PLAYER_R = 12;
/** Pack animals: hitting one pulls same-species neighbours within ASSIST_RADIUS. */
const PACK_FAMILIES: ReadonlySet<Family> = new Set<Family>(['beast', 'swarm', 'fiend']);
const ASSIST_RADIUS = 110;
/** Status motes spawn at most this often per monster / for the player. */
const STATUS_FX_MS = 260;
/** Gaps (ms) beyond a normal frame that count as the world being frozen. */
const FREEZE_GAP = 120;

export interface HurtOpts {
  /** Legacy: a plain slow. */
  slow?: boolean;
  /** Statuses the hit applies to the player (technique element status + skill status). */
  statuses?: StatusKind[];
  /** Where the hit came from (knockback / pull direction). */
  source?: { x: number; y: number };
  /** Attacker rank (stronger crowd control from elites and wardens). */
  rank?: MonsterRank;
}

interface WindUp {
  skill: SkillDef;
  start: number;
  until: number;
  target: Monster | null;
  aim: { x: number; y: number };
  preview: Phaser.GameObjects.Graphics | null;
}

export class Combat implements CombatHost {
  monsters: Monster[] = [];
  target: Monster | null = null;
  readonly cooldowns = new Map<string, { readyAt: number; total: number }>();
  buffs: Buff[] = [];
  dead = false;
  /** Spawn protection (no damage, no aggro) until this scene time. */
  protectUntil = 0;
  lastHurt = -1e9;
  lastDealt = -1e9;
  lastInput = 0;
  /** Next time AUTO battle may act. */
  private autoAt = 0;
  /** AUTO does not pick new targets before this time (manual move / interaction override). */
  private autoHoldUntil = 0;
  /** Monsters AUTO could not reach, with the time they become eligible again. */
  private autoSkip = new Map<Monster, number>();
  /** Global skill lock after a cast (afterCastMs); walking and auto-attacks stay allowed. */
  lockUntil = 0;
  private lockTotal = 0;
  windup: WindUp | null = null;
  private repathAt = 0;
  private regenT = 0;
  private toastGate = 0;
  private clockAt = -1;
  private playerFxAt = 0;
  private pushDest: { x: number; y: number } | null = null;
  private readonly sparkable = new Map<string, boolean>();

  constructor(readonly scene: MapScene) {}

  // ---------------------------------------------------------------- CombatHost

  get world(): Phaser.Scene {
    return this.scene;
  }

  get cm() {
    return this.scene.cm;
  }

  get player() {
    return this.scene.player;
  }

  liveMonsters(): Monster[] {
    return this.monsters.filter((m) => m.alive);
  }

  colorFor(skill: SkillDef): number {
    if (skill.element) return this.scene.reg.element(skill.element)?.color ?? 0xffffff;
    if (skill.tags.includes('arcane')) return 0x9fd0ff;
    if (skill.tags.includes('stealth')) return 0xc8b0ff;
    if (skill.tags.includes('toxin')) return 0x8be04a;
    if (skill.tags.includes('spirit')) return 0xfff0b0;
    return 0xffffff;
  }

  weapon(): WeaponType {
    return this.scene.session.player.weapon;
  }

  canAct(): boolean {
    return !this.dead;
  }

  float(x: number, y: number, text: string, color: string, size: number): void {
    this.scene.floatText(x, y, text, color, size);
  }

  // ---------------------------------------------------------------- clock

  /** Shifts every combat timer by gaps where the world was frozen (panel pause, hit-stop). Once per frame. */
  private syncClock(now: number): void {
    if (now === this.clockAt) return;
    if (this.clockAt >= 0) {
      const gap = now - this.clockAt - Math.min(this.scene.game.loop.delta, 50);
      if (gap > FREEZE_GAP) this.shiftTime(gap);
    }
    this.clockAt = now;
  }

  shiftTime(ms: number): void {
    for (const c of this.cooldowns.values()) c.readyAt += ms;
    this.lockUntil += ms;
    this.protectUntil += ms;
    this.lastHurt += ms;
    this.lastDealt += ms;
    this.lastInput += ms;
    this.repathAt += ms;
    this.playerFxAt += ms;
    if (this.windup) {
      this.windup.start += ms;
      this.windup.until += ms;
    }
    for (const b of this.buffs) b.until += ms;
    this.player?.shiftTime(ms);
    for (const m of this.monsters) m.shiftTime(ms);
    this.scene.monsterSkills.shiftTime(ms);
  }

  // ---------------------------------------------------------------- spawning

  spawn(): void {
    const s = this.scene;
    const world = s.session.world;
    const rnd = Phaser.Math.RND;
    s.def.spawns.forEach((z, zi) => {
      const def = s.reg.monster(z.monster);
      if (!def) return;
      if (def.rank === 'warden') {
        const at = world.wardens[def.id];
        if (at !== undefined && Date.now() - at < def.respawn) return;
      }
      for (let i = 0; i < z.count; i++) {
        const slot = `${s.mapId}#${zi}#${i}`;
        let tx = z.cx;
        let ty = z.cy;
        for (let k = 0; k < 30; k++) {
          const cx = Math.round(z.cx + rnd.between(-z.r, z.r));
          const cy = Math.round(z.cy + rnd.between(-z.r, z.r));
          if (!isBlocked(s.cm, cx, cy) && !(s.cm.coll[cy * s.cm.w + cx] & COLL.PORTAL)) {
            tx = cx;
            ty = cy;
            break;
          }
        }
        const m = new Monster(
          s,
          def,
          { x: tx * TILE + TILE / 2, y: ty * TILE + TILE / 2, r: z.r * TILE },
          def.element ? s.reg.element(def.element) : undefined,
          slot,
        );
        m.nextWander = s.time.now + rnd.between(500, 4000);
        const eliteBack = s.session.eliteDeaths.get(slot);
        if (def.rank === 'elite' && eliteBack !== undefined && Date.now() < eliteBack) {
          m.alive = false;
          m.hp = 0;
          m.setVisible(false);
          m.respawnAt = s.time.now + (eliteBack - Date.now());
        }
        this.monsters.push(m);
      }
    });
  }

  // ---------------------------------------------------------------- targeting

  setTarget(m: Monster | null): void {
    if (this.target && this.target !== m) this.target.label.setVisible(this.target.warden && this.target.alive);
    this.target = m;
    if (m) {
      m.label.setVisible(true);
      this.repathAt = 0;
    }
    this.scene.targetRing.setVisible(!!m);
    this.updateTargetUi();
  }

  /** Engaged warden (boss mode pill) or the current target. */
  updateTargetUi(): void {
    const m = this.target?.alive ? this.target : this.monsters.find((x) => x.alive && x.warden && x.provoked) ?? null;
    this.scene.ui.setTarget(
      m
        ? { name: m.enraged ? `${m.def.name} (enraged)` : m.def.name, level: m.def.level, hp: m.hp, maxHp: m.maxHp, element: m.element, boss: m.warden, elite: m.elite }
        : null,
    );
  }

  nearestMonster(maxD: number): Monster | null {
    const p = this.player;
    let best: Monster | null = null;
    let bestD = maxD;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bestD) {
        bestD = d;
        best = m;
      }
    }
    return best;
  }

  inCombat(now = this.scene.time.now): boolean {
    return now - Math.max(this.lastHurt, this.lastDealt) < COMBAT_WINDOW;
  }

  /** Highest threat among engaged (provoked) monsters, for buff use XP. */
  maxEngagedThreat(): number {
    let t = 0;
    for (const m of this.monsters) if (m.alive && m.provoked) t = Math.max(t, monsterThreat(m.def));
    return t;
  }

  // ---------------------------------------------------------------- player update

  /** Auto-attack / chase, wind-up, AFK stop. */
  updatePlayer(now: number): void {
    this.syncClock(now);
    const s = this.scene;
    const p = this.player;
    if (this.windup) {
      const w = this.windup;
      if (p.path.length || p.stunned(now)) {
        this.cancelWindup(true);
      } else {
        const t = (now - w.start) / (w.until - w.start);
        p.setCast(t, this.colorFor(w.skill));
        this.drawPreview(w, Math.min(1, t));
        if (now >= w.until) {
          this.windup = null;
          w.preview?.destroy();
          p.setCast(null);
          const tg = w.target && w.target.alive ? w.target : null;
          const aim = tg ? { x: tg.x, y: tg.y } : w.aim;
          if (tg) p.face(tg.x, tg.y);
          this.fire(w.skill, tg, aim);
        }
      }
      return;
    }
    if (s.interactions.channel) return;
    this.autoBattle(now);
    if (this.windup) return;
    const t = this.target;
    if (!t || !t.alive) return;
    if (!s.session.player.autoOn && now - this.lastInput > AFK_MS) {
      this.setTarget(null);
      s.ui.log('You lower your weapon. (Tap an enemy to fight again.)', 'info');
      return;
    }
    if (p.stunned(now) || this.pushDest) return;
    const w = WEAPONS[s.session.player.weapon];
    const reach = w.range + t.radius;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d > reach) {
      if (now >= this.repathAt) {
        this.repathAt = now + 350;
        p.path = s.pathTo(t.x, t.y) ?? [];
      }
    } else {
      p.path = [];
      const cd = this.ownCooldown(w.basic);
      if (cd.remain <= 0 && now >= p.lockedUntil) this.castSkill(w.basic, true);
    }
  }

  /** Pauses AUTO target hunting after a manual move or interaction tap (combat casts continue). */
  holdAuto(ms = AUTO_HOLD_MS): void {
    this.autoHoldUntil = Math.max(this.autoHoldUntil, this.scene.time.now + ms);
  }

  /**
   * AUTO battle (one global switch, docs/CLIENT-v2.md §6.1). While on:
   * 1. with no live target, pick the nearest reachable monster (monsters already chasing the player first; wardens only
   *    once they are engaged) — the normal engage logic then walks there and auto-attacks;
   * 2. cast EVERY equipped skill as soon as it is ready, in skill-bar order, but only when the target is within that
   *    skill's reach (buffs: target within ~6 tiles and the buff not already running). Pure-movement skills
   *    (power 0) never auto-fire.
   * Manual taps win: a ground move or an NPC/object tap holds target hunting for a few seconds after the player
   * stops; tapping a monster simply retargets. Disables the 30 s AFK stop while on.
   */
  private autoBattle(now: number): void {
    const s = this.scene;
    const pl = s.session.player;
    if (!pl.autoOn || this.dead || now < this.autoAt) return;
    this.autoAt = now + AUTO_TICK_MS;
    const p = this.player;
    if (p.stunned(now)) return;
    let t = this.target && this.target.alive ? this.target : null;
    if (!t) {
      if (now < this.autoHoldUntil || p.path.length || s.interactions.pending || s.session.nav) return;
      t = this.pickAutoTarget(now);
      if (!t) return;
      this.setTarget(t);
    }
    if (this.windup || now < this.lockUntil) return;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    for (const id of pl.hotbar) {
      if (!id) continue;
      const skill = s.reg.skill(id);
      if (!skill || !s.usable(id).ok || this.ownCooldown(id).remain > 0) continue;
      if (skill.shape.kind === 'buff') {
        if (d > AUTO_BUFF_RANGE || this.buffs.some((b) => b.source === id && b.until > now + 1000)) continue;
      } else {
        if (skill.power <= 0) continue;
        if (d > SkillSystem.reach(skill) + t.radius + 8) continue;
      }
      if (pl.sp < this.spCost(skill)) continue;
      if (this.castSkill(id, true)) {
        s.ui.pulseSlot(id);
        return;
      }
    }
  }

  /** Nearest monster AUTO should hunt: chasers first, then by distance; skips unreachable ones and idle wardens. */
  private pickAutoTarget(now: number): Monster | null {
    const p = this.player;
    const cands: { m: Monster; score: number }[] = [];
    for (const m of this.monsters) {
      if (!m.alive) continue;
      if ((this.autoSkip.get(m) ?? 0) > now) continue;
      if (m.warden && !m.provoked) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      cands.push({ m, score: d - (m.provoked ? 10000 : 0) });
    }
    cands.sort((a, b) => a.score - b.score);
    for (const { m } of cands.slice(0, 5)) {
      const close = Math.hypot(m.x - p.x, m.y - p.y) <= WEAPONS[this.scene.session.player.weapon].range + m.radius;
      if (close || this.scene.pathTo(m.x, m.y)) return m;
      this.autoSkip.set(m, now + AUTO_UNREACHABLE_MS);
    }
    return null;
  }

  /** Drops the wind-up (no cost). `show` floats a small "cancelled" note (moved / stunned). */
  cancelWindup(show = false): void {
    const w = this.windup;
    if (!w) return;
    this.windup = null;
    w.preview?.destroy();
    this.player.setCast(null);
    if (show) this.scene.floatText(this.player.x, this.player.y - 66, `✕ ${w.skill.name}`, '#b8c0d0', 11);
  }

  /** Ground preview of a winding-up skill: where a nova lands, a dash's lane, a spin's ring, a strike's cone. */
  private drawPreview(w: WindUp, t: number): void {
    const p = this.player;
    const sh = w.skill.shape;
    if (!w.preview) {
      if (sh.kind === 'buff') return;
      w.preview = this.scene.add.graphics().setDepth(-40000);
    }
    const g = w.preview;
    g.clear();
    const color = this.colorFor(w.skill);
    const tg = w.target?.alive ? w.target : null;
    const ax = tg ? tg.x : w.aim.x;
    const ay = tg ? tg.y : w.aim.y;
    const ang = Math.atan2(ay - p.y, ax - p.x);
    const a = 0.35 + 0.45 * t;
    switch (sh.kind) {
      case 'nova': {
        const d = Math.min(sh.range, Math.hypot(ax - p.x, ay - p.y));
        const cx = p.x + Math.cos(ang) * d;
        const cy = p.y + Math.sin(ang) * d;
        g.fillStyle(color, 0.1 + 0.12 * t).fillEllipse(cx, cy, sh.radius * 2 * t, sh.radius * 1.3 * t);
        g.lineStyle(2, color, a).strokeEllipse(cx, cy, sh.radius * 2, sh.radius * 1.3);
        break;
      }
      case 'dash': {
        const ex = p.x + Math.cos(ang) * sh.distance;
        const ey = p.y + Math.sin(ang) * sh.distance;
        g.lineStyle(Math.max(8, sh.width), color, 0.08 + 0.1 * t).lineBetween(p.x, p.y, ex, ey);
        g.lineStyle(2, color, a).lineBetween(p.x, p.y, p.x + (ex - p.x) * t, p.y + (ey - p.y) * t);
        break;
      }
      case 'spin':
        g.fillStyle(color, 0.06 + 0.1 * t).fillEllipse(p.x, p.y, sh.radius * 2, sh.radius * 1.3);
        g.lineStyle(2, color, a).strokeEllipse(p.x, p.y, sh.radius * 2, sh.radius * 1.3);
        break;
      case 'strike': {
        const arc = (sh.arc * Math.PI) / 180;
        g.fillStyle(color, 0.08 + 0.12 * t);
        g.slice(p.x, p.y, sh.range, ang - arc / 2, ang + arc / 2, false).fillPath();
        break;
      }
      default:
        g.lineStyle(2, color, a * 0.7).lineBetween(p.x, p.y - 12, ax, ay - 12);
    }
  }

  // ---------------------------------------------------------------- casting

  /** Cooldown for the hotbar: the skill's own cooldown, or the after-cast lock while it is longer (not the basic). */
  cooldown(id: string): { remain: number; total: number } {
    const own = this.ownCooldown(id);
    const now = this.scene.time.now;
    const lock = this.lockUntil - now;
    if (lock > own.remain && id !== WEAPONS[this.scene.session.player.weapon].basic) return { remain: lock, total: this.lockTotal || lock };
    return own;
  }

  private ownCooldown(id: string): { remain: number; total: number } {
    const c = this.cooldowns.get(id);
    if (!c) return { remain: 0, total: 0 };
    return { remain: Math.max(0, c.readyAt - this.scene.time.now), total: c.total };
  }

  spCost(skill: SkillDef): number {
    return Math.max(0, Math.round(skill.spCost * (1 + spCostPctFor(this.scene.book.totals(), skill) / 100)));
  }

  private gateToast(msg: string): void {
    if (this.scene.time.now < this.toastGate) return;
    this.toastGate = this.scene.time.now + 800;
    this.scene.ui.toast(esc(msg));
  }

  castSkill(id: string, auto = false): boolean {
    const s = this.scene;
    const skill = s.reg.skill(id);
    if (!skill || this.dead) return false;
    const u = s.usable(id);
    if (!u.ok) {
      if (!auto) this.gateToast(u.reason!);
      return false;
    }
    const now = s.time.now;
    const p = this.player;
    if (p.stunned(now)) {
      if (!auto) this.gateToast(now < p.frozenUntil ? 'Frozen solid!' : 'Stunned!');
      return false;
    }
    const basic = id === WEAPONS[s.session.player.weapon].basic;
    if (this.windup) {
      if (!auto) this.gateToast(`Still channelling ${this.windup.skill.name}.`);
      return false;
    }
    if (!basic && now < this.lockUntil) return false;
    const cd = this.ownCooldown(id);
    if (cd.remain > 0) {
      if (!auto) this.gateToast(`${skill.name} is recharging.`);
      return false;
    }
    if (s.session.player.sp < this.spCost(skill)) {
      if (!auto) this.gateToast('Not enough SP.');
      return false;
    }
    s.interactions.cancelChannel();
    let target: Monster | null = null;
    let aim = { x: p.x + Math.cos(p.aimAngle) * 80, y: p.y + Math.sin(p.aimAngle) * 80 };
    if (skill.shape.kind !== 'buff') {
      const reach = SkillSystem.reach(skill);
      const t = this.target;
      if (t && t.alive && Math.hypot(t.x - p.x, t.y - p.y) <= reach * 1.4 + t.radius + 30) target = t;
      else {
        let best = Infinity;
        for (const m of this.monsters) {
          if (!m.alive) continue;
          const d = Math.hypot(m.x - p.x, m.y - p.y);
          if (d <= reach + m.radius + 40 && d < best) {
            best = d;
            target = m;
          }
        }
      }
      if (target) {
        aim = { x: target.x, y: target.y };
        p.face(aim.x, aim.y);
      }
      if (auto && !target) return false;
    }
    if ((skill.castMs ?? 0) > 0) {
      p.path = [];
      this.windup = { skill, start: now, until: now + skill.castMs!, target, aim, preview: null };
      p.setCast(0, this.colorFor(skill));
      return true;
    }
    this.fire(skill, target, aim);
    return true;
  }

  /** The effect fires: pay SP, start cooldown and after-cast lock, run the shape. */
  private fire(skill: SkillDef, target: Monster | null, aim: { x: number; y: number }): void {
    const s = this.scene;
    const pl = s.session.player;
    const cost = this.spCost(skill);
    if (pl.sp < cost) {
      this.gateToast('Not enough SP.');
      return;
    }
    const now = s.time.now;
    const p = this.player;
    const w = WEAPONS[pl.weapon];
    const basic = skill.id === w.basic;
    p.attackAnim();
    pl.sp -= cost;
    const st = s.stats();
    const cdPct = cooldownPctFor(s.book.totals(), skill);
    const total = (skill.cooldown || w.delay) * (1 + cdPct / 100) * (1 - st.cdr / 100);
    this.cooldowns.set(skill.id, { readyAt: now + total, total });
    if (!basic) {
      this.lockTotal = skill.afterCastMs ?? 250;
      this.lockUntil = now + this.lockTotal;
    }
    const rank = Math.max(1, s.book.rank(skill.id));
    const cast = s.skills.newCast(skill, rank, { x: p.x, y: p.y });
    if (skill.shape.kind === 'buff' && this.inCombat(now)) s.book.recordBuffUse(skill.id, this.maxEngagedThreat());
    s.skills.execute(cast, aim, target);
    s.onCast(skill, aim);
    if (target && !this.target && skill.shape.kind !== 'dash') this.setTarget(target);
  }

  applyBuff(skill: SkillDef, rank: number): void {
    if (skill.shape.kind !== 'buff') return;
    const sh = skill.shape;
    const amount = sh.amount * (1 + 0.08 * (rank - 1));
    this.buffs = this.buffs.filter((b) => b.source !== skill.id);
    this.buffs.push({ stat: sh.stat, amount, until: this.scene.time.now + sh.duration, source: skill.id });
    this.scene.ui.log(`${skill.icon} <b>${esc(skill.name)}</b> active for ${sh.duration / 1000}s.`, 'good');
  }

  buffColor(stat: Buff['stat']): number {
    return { atk: 0xff7a5a, matk: 0x8fb8ff, speed: 0x9be8c8, crit: 0xc8a0ff, regen: 0x7fff9f, def: 0xd0d0d0 }[stat];
  }

  // ---------------------------------------------------------------- hits

  private canSpark(skillId: string): boolean {
    let v = this.sparkable.get(skillId);
    if (v === undefined) {
      const book = this.scene.book;
      v = this.scene.reg.morphsFrom(skillId).some((mm) => !!mm.spark && !book.has(mm.to));
      this.sparkable.set(skillId, v);
    }
    return v;
  }

  /** Call when the set of known skills changes. */
  invalidateSparks(): void {
    this.sparkable.clear();
  }

  /** A hit provokes the monster; pack animals pull their same-species neighbours along. */
  private provoke(m: Monster, now: number): void {
    m.lastHitAt = now;
    if (m.provoked) return;
    m.provoked = true;
    if (m.warden || !PACK_FAMILIES.has(m.def.family)) return;
    const kin = m.def.base ?? m.def.id;
    for (const o of this.monsters) {
      if (o === m || !o.alive || o.provoked || o.returning || o.warden) continue;
      if ((o.def.base ?? o.def.id) !== kin) continue;
      if (Math.hypot(o.x - m.x, o.y - m.y) > ASSIST_RADIUS) continue;
      o.provoked = true;
      this.scene.floatText(o.x, o.y - o.sprite.displayHeight - 4, '!', '#ffb0a0', 15);
    }
  }

  hit(m: Monster, cast: Cast, falloff = 1): DamageRoll | null {
    if (!m.alive) return null;
    const s = this.scene;
    const { book, reg } = s;
    const skill = cast.skill;
    const now = s.time.now;
    const st = s.stats();
    const statuses = m.statuses(now);
    const totals = book.totals();
    const roll = computeDamage(
      reg.elements,
      skill,
      cast.rank,
      { atk: st.atk, matk: st.matk, crit: st.crit, weapon: s.session.player.weapon },
      {
        def: m.defense(now),
        element: m.def.element,
        elementLevel: m.def.elementLevel,
        size: m.def.size,
        family: m.def.family,
        statuses,
      },
      {
        tagPct: book.tagPowerFor(skill),
        familyPct: vsFamilyPct(totals, m.def.family),
        statusPct: vsStatusPct(totals, skill.element, statuses),
        falloff: falloff * cast.mult,
      },
    );
    this.provoke(m, now);
    this.lastDealt = now;
    // Use XP is granted lazily on the cast's first hit (any copy: pulses, returns, reprises).
    if (!cast.used.v) {
      cast.used.v = true;
      book.recordUse(skill.id, monsterThreat(m.def));
    }
    const top = m.y - m.sprite.displayHeight;
    const color = this.colorFor(skill);
    if (roll.resisted) {
      s.floatText(m.x, top, 'Resist', '#9aa0aa', 12);
      if (!this.target && m.alive) this.setTarget(m);
      return roll;
    }
    m.flash(roll.crit ? 0xffff80 : 0xffffff);
    const tc = roll.crit ? '#ffe14a' : roll.multiplier > 1 ? '#ff9a3a' : roll.multiplier < 1 ? '#a8b0c0' : '#ffffff';
    s.floatText(m.x + Phaser.Math.Between(-8, 8), top, `${roll.amount}${roll.crit ? '!' : ''}`, tc, roll.crit ? 18 : 14);
    m.hp -= roll.amount;
    s.skills.fxImpact(m, skill, color, roll.crit);

    if (roll.combo) this.applyCombo(m, roll, cast, top, now);

    const kinds: StatusKind[] = [];
    if (skill.element) {
      const el = reg.element(skill.element);
      if (el) kinds.push(el.status);
    }
    if (skill.status && !kinds.includes(skill.status)) kinds.push(skill.status);
    if (skill.riders?.knockback && !kinds.includes('knockback')) kinds.push('knockback');
    for (const k of kinds) this.applyStatus(m, k, roll.amount, cast.origin);

    const leech = skill.riders?.leech;
    if (leech) {
      const pl = s.session.player;
      const room = st.maxHp * LEECH_CAP - cast.leech.healed;
      const heal = Math.min(room, roll.amount * leech, st.maxHp - pl.hp);
      if (heal >= 1) {
        cast.leech.healed += heal;
        pl.hp = Math.min(st.maxHp, pl.hp + heal);
        s.floatText(this.player.x, this.player.y - 40, `+${Math.round(heal)}`, '#7fff9f', 11);
        s.skills.fxStream({ x: m.x, y: m.y - 14 }, { x: this.player.x, y: this.player.y - 20 }, 0x7fff9f, 3);
      }
    }

    const killed = m.hp <= 0;
    const hitIndex = cast.tally.hits++;
    const instanceHits = m.hitGrants.get(skill.id) ?? 0;
    book.recordHit(skill.id, { monster: m.def, killed, hitIndex, instanceHits });
    if (hitIndex < MASTERY.maxHitsPerUse) m.hitGrants.set(skill.id, instanceHits + 1);
    if (this.canSpark(skill.id)) {
      // Spark moment: the 'spark' event (MapScene) runs the 250 ms hit-stop, banner and vibration; the radial
      // flash bursts from the struck foe.
      const learned = book.trySpark(skill.id, m.def, book.now());
      if (learned) s.skills.fxSpark(m.x, m.y - Math.min(30, m.sprite.displayHeight * 0.5));
    }

    const arc = skill.riders?.arc;
    if (arc && !cast.arcZap) {
      const from = { x: m.x, y: m.y - 10 };
      const others = this.monsters
        .filter((o) => o !== m && o.alive && Math.hypot(o.x - m.x, o.y - m.y) <= ARC_RADIUS)
        .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))
        .slice(0, arc.targets);
      const zap: Cast = { ...cast, arcZap: true, mult: cast.mult * arc.mult };
      others.forEach((o, i) =>
        s.time.delayedCall(50 + i * 40, () => {
          if (!o.alive || this.dead) return;
          s.skills.fxArcZap(from, { x: o.x, y: o.y - 10 }, color);
          this.hit(o, zap, falloff);
        }),
      );
    }

    if (killed) this.kill(m);
    else if (!this.target && m.alive && skill.shape.kind !== 'dash') this.setTarget(m);
    return roll;
  }

  /** Ends the consumed status, floats the combo name and plays its FX (Shatter / Conduct / Fan the Flames). */
  private applyCombo(m: Monster, roll: DamageRoll, cast: Cast, top: number, now: number): void {
    const s = this.scene;
    const c = roll.combo!;
    delete m.status.marks[c.consumes];
    const y = m.y - Math.min(24, m.sprite.displayHeight * 0.45);
    if (c.consumes === 'freeze') {
      m.status.stunUntil = Math.min(m.status.stunUntil, now);
      s.skills.fxShatter(m.x, y, m.radius + 12);
    }
    if (c.consumes === 'soak') {
      m.status.slowUntil = Math.min(m.status.slowUntil, now);
      s.skills.fxRing(m.x, m.y - 8, m.radius + 16, 0xffe14a, false);
      s.skills.fxArcZap({ x: m.x - m.radius, y }, { x: m.x + m.radius, y: y - 6 }, 0x9fd8ff);
    }
    if (c.consumes === 'burn') {
      m.status.dots = m.status.dots.filter((d) => d.kind !== 'burn');
      s.skills.fxSpin(m.x, m.y - 8, m.radius + 12, 0xff8a3a, 'fire');
    }
    s.floatText(m.x, top - 18, `${c.name}!`, '#ffd76a', 15);
    if (c.spreadBurn) {
      for (const o of this.monsters) {
        if (o === m || !o.alive) continue;
        if (Math.hypot(o.x - m.x, o.y - m.y) > BURN_SPREAD_RADIUS + o.radius) continue;
        this.applyStatus(o, 'burn', roll.amount, cast.origin);
        s.skills.fxStream({ x: m.x, y }, { x: o.x, y: o.y - 12 }, 0xff6a2b, 4, CFX.flame);
      }
    }
  }

  applyStatus(m: Monster, kind: StatusKind, dmg: number, origin: { x: number; y: number }): void {
    const now = this.scene.time.now;
    const boss = m.warden;
    const st = m.status;
    const mark = (k: StatusKind, ms: number) => (st.marks[k] = Math.max(st.marks[k] ?? 0, now + ms));
    const dot = (dur: number, pct: number, color: number) => {
      st.dots = st.dots.filter((d) => d.kind !== kind);
      st.dots.push({ until: now + dur, next: now + 500, dmg: Math.max(1, Math.round(dmg * pct)), color, kind });
      mark(kind, dur);
    };
    const push = (sign: number, force: number) => {
      const a = Math.atan2(m.y - origin.y, m.x - origin.x);
      const f = force * (boss ? 0.15 : m.elite ? 0.5 : 1);
      st.vx = Math.cos(a) * f * sign;
      st.vy = Math.sin(a) * f * sign;
    };
    switch (kind) {
      case 'burn':
        dot(1600, 0.18, 0xff6a2b);
        break;
      case 'poison':
        dot(4000, 0.12, 0x8be04a);
        break;
      case 'bleed':
        dot(2000, 0.15, 0xc04060);
        break;
      case 'slow':
        st.slowUntil = now + 2200;
        st.slowMult = 0.45;
        mark('slow', 2200);
        break;
      case 'soak':
        st.slowUntil = now + 2200;
        st.slowMult = 0.55;
        mark('soak', 2200);
        break;
      case 'freeze':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 400 : 1200));
        st.slowUntil = now + 2200;
        st.slowMult = 0.5;
        mark('freeze', 2200);
        break;
      case 'stun':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 200 : 650));
        mark('stun', boss ? 200 : 650);
        break;
      case 'shock':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 100 : 300));
        mark('shock', 1200);
        break;
      case 'knockback':
        push(1, 320);
        if (!boss) this.scene.skills.fxDust(m.x, m.y);
        break;
      case 'pull':
        if (Math.hypot(m.x - origin.x, m.y - origin.y) > 24) push(-1, 240);
        break;
      case 'smite': {
        const pl = this.scene.session.player;
        const heal = Math.max(1, Math.round(dmg * 0.12));
        pl.hp = Math.min(this.scene.stats().maxHp, pl.hp + heal);
        this.scene.floatText(this.player.x, this.player.y - 40, `+${heal}`, '#7fff9f', 12);
        mark('smite', 1000);
        break;
      }
    }
  }

  private damageMonsterRaw(m: Monster, amount: number, color: number): void {
    m.hp -= amount;
    m.flash(color);
    this.scene.floatText(m.x, m.y - m.sprite.displayHeight, `${amount}`, hex(color), 11);
    if (m.hp <= 0) this.kill(m);
  }

  // ---------------------------------------------------------------- kills & rewards

  kill(m: Monster): void {
    if (!m.alive) return;
    const s = this.scene;
    const { book } = s;
    const now = s.time.now;
    m.alive = false;
    m.hp = 0;
    m.charge = 0;
    s.monsterSkills.cancel(m);
    if (m.warden) m.respawnAt = Infinity;
    else if (m.elite) {
      m.respawnAt = now + m.def.respawn;
      s.session.eliteDeaths.set(m.slot, Date.now() + m.def.respawn);
    } else m.respawnAt = now + m.def.respawn;
    s.skills.fxBurst(m.x, m.y - 10, m.element?.color ?? 0xffffff, m.warden ? 30 : 12);
    s.tweens.add({
      targets: m.sprite,
      alpha: 0,
      scaleY: 0.2,
      duration: 220,
      onComplete: () => {
        m.setVisible(false);
        m.sprite.setAlpha(1);
      },
    });
    m.bar.clear();
    m.aura?.clear();
    if (this.target === m) this.setTarget(null);
    else this.updateTargetUi();

    const pl = s.session.player;
    const coins = Phaser.Math.Between(m.def.coins[0], m.def.coins[1]);
    pl.coins += coins;
    book.incFlag('kills');
    const kc = book.incFlag(`kill_${m.def.id}`);
    book.recordKill(m.def);
    s.ui.log(`Defeated <b>${esc(m.def.name)}</b> · +${m.def.exp} EXP · 🪙${coins}`, 'info');
    this.gainExp(m.def.exp);
    if (m.def.id === 'gloomcap' && kc === GLOOMCAPS_FOR_SHADOW && !book.hasElement('shadow'))
      s.ui.log('🌑 Somewhere in Gloomwood, the obelisk stirs...', 'rare');
    if (m.warden) {
      book.incFlag(`warden_${m.def.id}`);
      s.session.world.wardens[m.def.id] = Date.now();
      s.ui.toast(`⚔️ <b>${esc(m.def.name)}</b> has fallen!`);
      s.cameras.main.flash(300, 255, 240, 160);
      s.refreshPortals();
    }
    for (const d of m.def.drops ?? []) {
      if (d.once && s.alreadyHas(d.item)) continue;
      if (Math.random() < d.chance) s.obtain(d.item, 1, `drop:${m.def.id}`);
    }
    // Echo witness: every echo technique this instance began at the player earns a mark (toasts via 'witness').
    for (const skillId of m.witnessed) {
      try {
        book.witness(skillId);
      } catch {
        /* not an echo technique */
      }
    }
    m.witnessed.clear();
    s.requestSave();
  }

  gainExp(n: number): void {
    const s = this.scene;
    const pl = s.session.player;
    pl.exp += n;
    let leveled = false;
    while (pl.exp >= expToNext(pl.level)) {
      pl.exp -= expToNext(pl.level);
      s.session.setLevel(pl.level + 1);
      leveled = true;
    }
    if (leveled) {
      const st = s.stats();
      pl.hp = st.maxHp;
      pl.sp = st.maxSp;
      s.floatText(this.player.x, this.player.y - 60, `LEVEL ${pl.level}!`, '#ffe14a', 18);
      s.skills.fxRing(this.player.x, this.player.y, 60, 0xffe14a, false);
      s.ui.toast(`🎉 Base level <b>${pl.level}</b>`);
      s.ui.log(`🎉 Reached base level <b>${pl.level}</b>. HP and SP restored.`, 'good');
      s.markHotbarDirty();
    }
  }

  // ---------------------------------------------------------------- player damage & statuses

  /**
   * Damage to the player from `atk` (monster ATK × power, element neutral) minus half DEF. Respects spawn protection.
   * Technique hits pass their statuses (burn, poison, bleed, slow/soak, freeze, stun, shock, knockback, pull).
   */
  hurtPlayer(atk: number, from: string, opts: HurtOpts = {}): number {
    const s = this.scene;
    if (this.dead) return 0;
    const now = s.time.now;
    if (now < this.protectUntil) return 0;
    const st = s.stats();
    const dmg = Math.max(1, Math.round(atk * Phaser.Math.FloatBetween(0.9, 1.1) - st.def * 0.5));
    const pl = s.session.player;
    pl.hp -= dmg;
    this.lastHurt = now;
    this.player.hurt();
    s.floatText(this.player.x, this.player.y - 44, `-${dmg}`, '#ff5a5a', dmg >= st.maxHp * 0.15 ? 17 : 14);
    if (dmg >= st.maxHp * 0.15) s.cameras.main.shake(130, 0.005);
    s.interactions.onDamaged();
    if (pl.hp <= 0) {
      this.die(from);
      return dmg;
    }
    if (opts.slow) this.applyPlayerStatus('slow', dmg, from, opts);
    for (const k of opts.statuses ?? []) this.applyPlayerStatus(k, dmg, from, opts);
    return dmg;
  }

  /** One status from a monster technique on the player. Stuns/freezes grant 1.5 s of crowd-control immunity. */
  applyPlayerStatus(kind: StatusKind, dmg: number, from: string, opts: HurtOpts = {}): void {
    const s = this.scene;
    const p = this.player;
    const now = s.time.now;
    const tier = opts.rank === 'warden' ? 2 : opts.rank === 'elite' ? 1 : 0;
    const mark = (k: StatusKind, ms: number) => (p.marks[k] = Math.max(p.marks[k] ?? 0, now + ms));
    const dot = (dur: number, every: number, pct: number, color: number) => {
      p.dots = p.dots.filter((d) => d.kind !== kind);
      p.dots.push({ kind, until: now + dur, next: now + every, every, dmg: Math.max(1, Math.round(dmg * pct)), color, from });
      mark(kind, dur);
    };
    const slow = (mult: number, ms: number, k: StatusKind) => {
      p.slowUntil = Math.max(p.slowUntil, now + ms);
      p.slowMult = mult;
      mark(k, ms);
    };
    const cc = (ms: number, frozen: boolean): boolean => {
      if (now < p.ccImmuneUntil) return false;
      p.stunUntil = Math.max(p.stunUntil, now + ms);
      if (frozen) p.frozenUntil = Math.max(p.frozenUntil, now + ms);
      p.ccImmuneUntil = p.stunUntil + 1500;
      p.lockedUntil = Math.max(p.lockedUntil, p.stunUntil);
      mark(frozen ? 'freeze' : 'stun', ms);
      this.cancelWindup(true);
      s.floatText(p.x, p.y - 72, frozen ? 'Frozen!' : 'Stunned!', frozen ? '#bfefff' : '#fff3a0', 13);
      if (frozen) s.skills.fxShatter(p.x, p.y - 20, 10);
      return true;
    };
    const push = (force: number, sign: number) => {
      const src = opts.source;
      if (!src) return;
      const a = Math.atan2(p.y - src.y, p.x - src.x);
      p.pushVx = Math.cos(a) * force * sign;
      p.pushVy = Math.sin(a) * force * sign;
      if (p.path.length) this.pushDest = p.path[p.path.length - 1];
      else this.pushDest = this.pushDest ?? { x: Number.NaN, y: Number.NaN };
      p.path = [];
    };
    switch (kind) {
      case 'burn':
        dot(1500, 500, 0.12, 0xff6a2b);
        break;
      case 'poison':
        dot(4000, 1000, 0.08, 0x8be04a);
        break;
      case 'bleed':
        dot(1800, 600, 0.1, 0xd04a6a);
        break;
      case 'slow':
        slow(0.6, 1800, 'slow');
        break;
      case 'soak':
        slow(0.65, 2000, 'soak');
        break;
      case 'freeze':
        slow(0.6, 1800, 'slow');
        if (Math.random() < 0.4 + 0.15 * tier) cc(500 + 150 * tier, true);
        break;
      case 'stun':
        cc(300 + 120 * tier, false);
        break;
      case 'shock':
        p.lockedUntil = Math.max(p.lockedUntil, now + 220);
        mark('shock', 450);
        break;
      case 'knockback':
        push(260 + 60 * tier, 1);
        break;
      case 'pull':
        push(220, -1);
        break;
      default:
        break;
    }
  }

  /** Player DoT ticks, status motes and knockback travel. */
  private updatePlayerStatus(dt: number, now: number): void {
    const s = this.scene;
    const p = this.player;
    if (this.dead || !p) return;
    if (p.dots.length) {
      for (const d of p.dots) {
        if (now >= d.next && d.next <= d.until + 10) {
          d.next += d.every;
          if (now >= this.protectUntil) this.tickPlayer(d, now);
          if (this.dead) return;
        }
      }
      p.dots = p.dots.filter((d) => d.until > now);
    }
    if (now >= this.playerFxAt) {
      this.playerFxAt = now + STATUS_FX_MS;
      this.statusMotes(p.x, p.y - 26, p.marks, now);
    }
    if (p.pushVx || p.pushVy) {
      const nx = p.x + p.pushVx * dt;
      const ny = p.y + p.pushVy * dt;
      if (this.canStand(nx, ny)) {
        p.x = nx;
        p.y = ny;
      } else if (this.canStand(nx, p.y)) p.x = nx;
      else if (this.canStand(p.x, ny)) p.y = ny;
      const decay = Math.pow(0.015, dt);
      p.pushVx *= decay;
      p.pushVy *= decay;
      if (Math.hypot(p.pushVx, p.pushVy) < 10) {
        p.pushVx = p.pushVy = 0;
        const dest = this.pushDest;
        this.pushDest = null;
        if (dest && Number.isFinite(dest.x) && !p.path.length) p.path = s.pathTo(dest.x, dest.y) ?? [];
      }
    }
  }

  private tickPlayer(d: PlayerDot, now: number): void {
    const s = this.scene;
    const pl = s.session.player;
    pl.hp -= d.dmg;
    this.lastHurt = now;
    s.floatText(this.player.x + Phaser.Math.Between(-6, 6), this.player.y - 44, `-${d.dmg}`, hex(d.color), 11);
    s.interactions.onDamaged();
    if (pl.hp <= 0) this.die(d.from);
  }

  /** Walkable and not a portal tile (knockback never shoves the player through a portal). */
  private canStand(x: number, y: number): boolean {
    const cm = this.cm;
    if (isBlockedPx(cm, x, y)) return false;
    return !(cm.coll[Math.floor(y / TILE) * cm.w + Math.floor(x / TILE)] & COLL.PORTAL);
  }

  /** Status motes over a body: flames, bubbles, drops, frost glints, sparks. */
  private statusMotes(x: number, y: number, marks: Partial<Record<StatusKind, number>>, now: number): void {
    const sk = this.scene.skills;
    const on = (k: StatusKind) => (marks[k] ?? 0) > now;
    if (on('burn')) sk.mote(x + Phaser.Math.Between(-8, 8), y, 0xff6a2b, fxStyle('fire'), 0.7);
    if (on('poison')) sk.particle(x + Phaser.Math.Between(-8, 8), y, 0x8be04a, 0, -28, 520, 0.45, { tex: CFX.bubble, add: false });
    if (on('bleed')) sk.particle(x + Phaser.Math.Between(-6, 6), y + 6, 0xd04a6a, 0, 30, 420, 0.7, { tex: CFX.drop, add: false, easeY: 'Quad.in' });
    if (on('soak')) sk.particle(x + Phaser.Math.Between(-8, 8), y - 4, 0x3fa9ff, 0, 34, 380, 0.6, { tex: CFX.drop, add: false, easeY: 'Quad.in' });
    if (on('freeze')) sk.particle(x + Phaser.Math.Between(-10, 10), y + Phaser.Math.Between(-6, 6), 0xdff6ff, 0, 0, 260, 0.8, { tex: CFX.spark, endScale: 1.2 });
    if (on('shock')) sk.mote(x, y, 0xffe14a, fxStyle('lightning'), 0.7);
  }

  private die(from: string): void {
    const s = this.scene;
    const pl = s.session.player;
    pl.hp = 0;
    this.dead = true;
    this.setTarget(null);
    this.cancelWindup();
    s.interactions.cancelChannel();
    s.session.nav = null;
    this.player.path = [];
    this.player.clearStatuses();
    this.pushDest = null;
    const lost = Math.floor(pl.exp * 0.05);
    pl.exp -= lost;
    s.ui.log(`💀 You were defeated by ${esc(from)}. Lost ${lost} EXP.`, 'warn');
    this.player.sprite.setAngle(90).setAlpha(0.7);
    for (const m of this.monsters) m.provoked = false;
    s.time.delayedCall(1800, () => {
      const st = s.stats();
      pl.hp = Math.round(st.maxHp * 0.5);
      pl.sp = Math.round(st.maxSp * 0.5);
      s.respawnAtSavePoint();
    });
  }

  // ---------------------------------------------------------------- monsters

  updateMonsters(dt: number, now: number): void {
    this.syncClock(now);
    for (const m of this.monsters) this.updateMonster(m, dt, now);
    this.separate();
  }

  private updateMonster(m: Monster, dt: number, now: number): void {
    const s = this.scene;
    if (!m.alive) {
      if (now >= m.respawnAt) this.respawn(m);
      return;
    }
    const map = s.cm;
    const p = this.player;
    if (m.status.dots.length) {
      for (const dot of m.status.dots) {
        if (now >= dot.next && now <= dot.until + 10) {
          dot.next += 500;
          this.damageMonsterRaw(m, dot.dmg, dot.color);
          if (!m.alive) return;
        }
      }
      m.status.dots = m.status.dots.filter((d) => d.until > now);
    }
    if (now >= m.fxAt) {
      m.fxAt = now + STATUS_FX_MS;
      this.statusMotes(m.x, m.y - Math.min(30, m.sprite.displayHeight * 0.55), m.status.marks, now);
    }
    if (m.buffs.length) {
      const regen = m.regenPct(now);
      if (regen > 0) m.hp = Math.min(m.maxHp, m.hp + (m.maxHp * regen * dt) / 100);
      if (m.buffs.some((b) => b.until <= now)) m.buffs = m.buffs.filter((b) => b.until > now);
    }
    if (m.warden && !m.enraged && m.hp < m.maxHp * ENRAGE.at) s.monsterSkills.enrage(m, now);
    if (m.status.vx || m.status.vy) {
      m.moveTo(map, m.x + m.status.vx * dt, m.y + m.status.vy * dt);
      const decay = Math.pow(0.02, dt);
      m.status.vx *= decay;
      m.status.vy *= decay;
      if (Math.hypot(m.status.vx, m.status.vy) < 6) m.status.vx = m.status.vy = 0;
    }
    if (now < m.busyUntil) return;
    m.restoreTint();
    if (m.stunned) return;

    const speed = m.def.speed * m.speedMult(now);
    const fromSpawn = Math.hypot(m.x - m.spawn.x, m.y - m.spawn.y);
    if (m.returning) {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * 0.5);
      if (m.stepToward(map, m.spawn.x, m.spawn.y, speed * 1.6, dt) || fromSpawn < 8) m.returning = false;
      return;
    }
    const leash = m.warden ? TILE * 9 : TILE * 10;
    if (fromSpawn > leash) {
      m.returning = true;
      m.provoked = false;
      m.nextTechAt = 0;
      s.monsterSkills.cancel(m);
      if (this.target === m) this.setTarget(null);
      return;
    }
    const dp = Math.hypot(m.x - p.x, m.y - p.y);
    const protectedNow = now < this.protectUntil;
    const aggroR = m.warden ? 220 : m.elite ? 170 : 140;
    const hostile = !this.dead && !protectedNow && (m.provoked || (m.def.aggressive && dp < aggroR));
    if (hostile) {
      if (s.monsterSkills.tryStart(m, now, dp)) return;
      if (dp > m.def.attackRange + 8) this.chase(m, speed * 1.15, dt, now);
      else if (now >= m.nextAttack) {
        m.nextAttack = now + m.attackDelay();
        m.facing = p.x > m.x ? 1 : -1;
        s.tweens.add({ targets: m.sprite, y: m.y - 6, yoyo: true, duration: 90 });
        this.hurtPlayer(m.atk(now), m.def.name, { source: { x: m.x, y: m.y }, rank: m.def.rank });
      }
    } else {
      // Not engaged: the next engagement starts with the opening beat again (MonsterSkills.tryStart).
      m.nextTechAt = 0;
      if (now >= m.nextWander) {
        m.nextWander = now + Phaser.Math.Between(2000, 5000);
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * m.spawn.r;
        const wx = m.spawn.x + Math.cos(a) * r;
        const wy = m.spawn.y + Math.sin(a) * r;
        m.wanderTo = isBlocked(map, Math.floor(wx / TILE), Math.floor(wy / TILE)) ? null : { x: wx, y: wy };
      }
      if (m.wanderTo && m.stepToward(map, m.wanderTo.x, m.wanderTo.y, speed * 0.5, dt)) m.wanderTo = null;
    }
  }

  /** Chase the player: a straight line when nothing is in the way, else A* around walls (refreshed every 700 ms). */
  private chase(m: Monster, speed: number, dt: number, now: number): void {
    const map = this.cm;
    const p = this.player;
    if (now >= m.chaseAt) {
      m.chaseAt = now + 700;
      m.chase = clearShot(map, m.x, m.y, p.x, p.y) ? [] : (findPath(map, m.x, m.y, p.x, p.y, 2500) ?? []);
    }
    const wp = m.chase[0];
    if (wp) {
      if (m.stepToward(map, wp.x, wp.y, speed, dt)) m.chase.shift();
    } else m.stepToward(map, p.x, p.y, speed, dt);
  }

  /**
   * Soft separation: monsters never stand on the player or stack on each other. Light monsters yield; elites and
   * wardens shove the player aside instead.
   */
  private separate(): void {
    const map = this.cm;
    const p = this.player;
    const live = this.monsters.filter((m) => m.alive);
    for (let i = 0; i < live.length; i++) {
      const a = live[i];
      if (!this.dead && p) {
        const dx = a.x - p.x;
        const dy = a.y - p.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + PLAYER_R;
        if (d < min) {
          const ux = d > 0.01 ? dx / d : Math.cos(a.uid);
          const uy = d > 0.01 ? dy / d : Math.sin(a.uid);
          const push = Math.min(6, min - d);
          if (a.warden || a.elite) {
            const nx = p.x - ux * push;
            const ny = p.y - uy * push;
            if (this.canStand(nx, ny)) {
              p.x = nx;
              p.y = ny;
            }
          } else a.moveTo(map, a.x + ux * push, a.y + uy * push);
        }
      }
      for (let j = i + 1; j < live.length; j++) {
        const b = live[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        if (Math.abs(dx) > 80 || Math.abs(dy) > 80) continue;
        const d = Math.hypot(dx, dy);
        const min = (a.radius + b.radius) * 0.9;
        if (d >= min) continue;
        const ux = d > 0.01 ? dx / d : 1;
        const uy = d > 0.01 ? dy / d : 0;
        const push = Math.min(4, (min - d) * 0.5);
        // Heavier bodies move less.
        const wa = a.warden ? 0.1 : a.elite ? 0.4 : 1;
        const wb = b.warden ? 0.1 : b.elite ? 0.4 : 1;
        a.moveTo(map, a.x - ux * push * wa, a.y - uy * push * wa);
        b.moveTo(map, b.x + ux * push * wb, b.y + uy * push * wb);
      }
    }
  }

  private respawn(m: Monster): void {
    m.reset();
    m.setVisible(true);
    m.sprite.setAlpha(0);
    this.scene.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
    if (m.elite) this.scene.session.eliteDeaths.delete(m.slot);
  }

  // ---------------------------------------------------------------- regen & buffs

  updateVitals(dt: number, now: number, st: Stats): void {
    this.updatePlayerStatus(dt, now);
    if (this.buffs.length && this.buffs.some((b) => b.until <= now)) this.buffs = this.buffs.filter((b) => b.until > now);
    this.regenT += dt;
    if (this.regenT < 1 || this.dead) return;
    this.regenT -= 1;
    const pl = this.scene.session.player;
    const calm = now - this.lastHurt > 5000;
    const still = this.player.moving ? 1 : 1 + regenStillPct(this.scene.book.totals()) / 100;
    pl.hp = Math.min(st.maxHp, pl.hp + st.maxHp * ((calm ? 0.02 : 0.005) * still + st.regen / 100));
    pl.sp = Math.min(st.maxSp, pl.sp + (st.maxSp * (calm ? 0.05 : 0.02) + 0.5) * still);
  }

  clear(): void {
    for (const m of this.monsters) m.destroy();
    this.monsters = [];
    this.target = null;
    this.windup?.preview?.destroy();
    this.windup = null;
  }
}
