// Combat (docs/CLIENT-v2.md §6): casting (wind-up, after-cast lock, SP/cooldown passives), hits through the core
// damage formula, combos, statuses and riders, mastery XP via the SkillBook v2 API, sparks, kills, drops, monster AI,
// player damage, death and respawn. Shape FX live in SkillSystem; monster techniques in MonsterSkills.
import Phaser from 'phaser';
import { BURN_SPREAD_RADIUS, computeDamage, type DamageRoll } from '../../core/combat';
import { MASTERY, monsterThreat } from '../../core/mastery';
import { cooldownPctFor, regenStillPct, spCostPctFor, vsFamilyPct, vsStatusPct } from '../../core/passives';
import type { SkillDef, StatusKind } from '../../core/types';
import { isBlocked } from '../../core/world/compile';
import { COLL } from '../../core/world/types';
import { WEAPONS } from '../../data/weapons';
import { esc } from '../../ui/util';
import { Monster } from '../entities/Monster';
import type { MapScene } from '../scenes/MapScene';
import { type Buff, type Stats, expToNext } from '../session';
import { TILE } from '../world/runtime';
import { type Cast, type CombatHost, SkillSystem } from './SkillSystem';

const GLOOMCAPS_FOR_SHADOW = 5;
/** Dealt or took damage within this window = in combat (buff use XP). */
const COMBAT_WINDOW = 5000;
/** Auto-attack chains stop after this long without player input. */
const AFK_MS = 30000;
const LEECH_CAP = 0.08;

interface WindUp {
  skill: SkillDef;
  start: number;
  until: number;
  target: Monster | null;
  aim: { x: number; y: number };
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
  /** Global skill lock after a cast (afterCastMs); walking and auto-attacks stay allowed. */
  lockUntil = 0;
  windup: WindUp | null = null;
  private repathAt = 0;
  private regenT = 0;
  private toastGate = 0;
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
        ? { name: m.def.name, level: m.def.level, hp: m.hp, maxHp: m.maxHp, element: m.element, boss: m.warden, elite: m.elite }
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
    const s = this.scene;
    const p = this.player;
    if (this.windup) {
      const w = this.windup;
      if (p.path.length) {
        this.cancelWindup();
      } else {
        p.setCast((now - w.start) / (w.until - w.start), this.colorFor(w.skill));
        if (now >= w.until) {
          this.windup = null;
          p.setCast(null);
          const t = w.target && w.target.alive ? w.target : null;
          const aim = t ? { x: t.x, y: t.y } : w.aim;
          if (t) p.face(t.x, t.y);
          this.fire(w.skill, t, aim);
        }
      }
      return;
    }
    if (s.interactions.channel) return;
    const t = this.target;
    if (!t || !t.alive) return;
    if (now - this.lastInput > AFK_MS) {
      this.setTarget(null);
      s.ui.log('You lower your weapon. (Tap an enemy to fight again.)', 'info');
      return;
    }
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
      const cd = this.cooldown(w.basic);
      if (cd.remain <= 0 && now >= p.lockedUntil) this.castSkill(w.basic, true);
    }
  }

  cancelWindup(): void {
    if (!this.windup) return;
    this.windup = null;
    this.player.setCast(null);
  }

  // ---------------------------------------------------------------- casting

  cooldown(id: string): { remain: number; total: number } {
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
    const basic = id === WEAPONS[s.session.player.weapon].basic;
    if (this.windup) {
      if (!auto) this.gateToast(`Still channelling ${this.windup.skill.name}.`);
      return false;
    }
    if (!basic && now < this.lockUntil) return false;
    const cd = this.cooldown(id);
    if (cd.remain > 0) {
      if (!auto) this.gateToast(`${skill.name} is recharging.`);
      return false;
    }
    if (s.session.player.sp < this.spCost(skill)) {
      if (!auto) this.gateToast('Not enough SP.');
      return false;
    }
    s.interactions.cancelChannel();
    const p = this.player;
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
      this.windup = { skill, start: now, until: now + skill.castMs!, target, aim };
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
    if (!basic) this.lockUntil = now + (skill.afterCastMs ?? 250);
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
        def: m.def.def,
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
    m.provoked = true;
    m.lastHitAt = now;
    this.lastDealt = now;
    // Use XP is granted lazily on the cast's first hit (any copy: pulses, returns, reprises).
    if (!cast.used.v) {
      cast.used.v = true;
      book.recordUse(skill.id, monsterThreat(m.def));
    }
    const top = m.y - m.sprite.displayHeight;
    if (roll.resisted) {
      s.floatText(m.x, top, 'Resist', '#9aa0aa', 12);
      if (!this.target && m.alive) this.setTarget(m);
      return roll;
    }
    m.flash(roll.crit ? 0xffff80 : 0xffffff);
    const color = roll.crit ? '#ffe14a' : roll.multiplier > 1 ? '#ff9a3a' : roll.multiplier < 1 ? '#a8b0c0' : '#ffffff';
    s.floatText(m.x + Phaser.Math.Between(-8, 8), top, `${roll.amount}${roll.crit ? '!' : ''}`, color, roll.crit ? 18 : 14);
    m.hp -= roll.amount;

    if (roll.combo) {
      const c = roll.combo;
      delete m.status.marks[c.consumes];
      if (c.consumes === 'freeze') m.status.stunUntil = Math.min(m.status.stunUntil, now);
      if (c.consumes === 'soak') m.status.slowUntil = Math.min(m.status.slowUntil, now);
      if (c.consumes === 'burn') m.status.dots = m.status.dots.filter((d) => d.kind !== 'burn');
      s.floatText(m.x, top - 18, `${c.name}!`, '#ffd76a', 15);
      s.skills.fxRing(m.x, m.y - 8, m.radius + 14, 0xffd76a, false);
      if (c.spreadBurn) {
        for (const o of this.monsters) {
          if (o === m || !o.alive) continue;
          if (Math.hypot(o.x - m.x, o.y - m.y) <= BURN_SPREAD_RADIUS + o.radius) this.applyStatus(o, 'burn', roll.amount, cast.origin);
        }
      }
    }

    const kinds: StatusKind[] = [];
    if (skill.element) {
      const el = reg.element(skill.element);
      if (el) kinds.push(el.status);
    }
    if (skill.status) kinds.push(skill.status);
    if (skill.riders?.knockback && !kinds.includes('knockback')) kinds.push('knockback');
    for (const k of kinds) this.applyStatus(m, k, roll.amount, cast.origin);

    const leech = skill.riders?.leech;
    if (leech) {
      const pl = s.session.player;
      const room = st.maxHp * LEECH_CAP - cast.leech.healed;
      const heal = Math.min(room, roll.amount * leech);
      if (heal >= 1) {
        cast.leech.healed += heal;
        pl.hp = Math.min(st.maxHp, pl.hp + heal);
        s.floatText(this.player.x, this.player.y - 40, `+${Math.round(heal)}`, '#7fff9f', 11);
      }
    }

    const killed = m.hp <= 0;
    const hitIndex = cast.tally.hits++;
    const instanceHits = m.hitGrants.get(skill.id) ?? 0;
    book.recordHit(skill.id, { monster: m.def, killed, hitIndex, instanceHits });
    if (hitIndex < MASTERY.maxHitsPerUse) m.hitGrants.set(skill.id, instanceHits + 1);
    if (this.canSpark(skill.id)) book.trySpark(skill.id, m.def, book.now());

    const arc = skill.riders?.arc;
    if (arc && !cast.arcZap) {
      const others = this.monsters
        .filter((o) => o !== m && o.alive && Math.hypot(o.x - m.x, o.y - m.y) <= 120)
        .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))
        .slice(0, arc.targets);
      const zap = { ...cast, arcZap: true, mult: cast.mult * arc.mult };
      for (const o of others) {
        s.skills.fxLightning([{ x: m.x, y: m.y - 10 }, { x: o.x, y: o.y - 10 }], this.colorFor(skill));
        this.hit(o, zap, falloff);
      }
    }

    if (killed) this.kill(m);
    else if (!this.target && m.alive && skill.shape.kind !== 'dash') this.setTarget(m);
    return roll;
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
    this.scene.floatText(m.x, m.y - m.sprite.displayHeight, `${amount}`, `#${color.toString(16).padStart(6, '0')}`, 11);
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
    // Echo witness: every technique this instance used on the player earns a mark.
    for (const skillId of m.witnessed) {
      try {
        book.witness(skillId);
      } catch {
        /* not an echo technique */
      }
    }
    m.witnessed.clear();
    s.save();
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

  // ---------------------------------------------------------------- player damage

  /** Damage to the player from `atk` (monster ATK × power). Respects spawn protection. */
  hurtPlayer(atk: number, from: string, opts: { slow?: boolean } = {}): void {
    const s = this.scene;
    if (this.dead) return;
    const now = s.time.now;
    if (now < this.protectUntil) return;
    const st = s.stats();
    const dmg = Math.max(1, Math.round(atk * Phaser.Math.FloatBetween(0.9, 1.1) - st.def * 0.5));
    const pl = s.session.player;
    pl.hp -= dmg;
    this.lastHurt = now;
    this.player.hurt();
    s.floatText(this.player.x, this.player.y - 44, `-${dmg}`, '#ff5a5a', 14);
    if (opts.slow) {
      this.player.slowUntil = now + 1800;
      this.player.slowMult = 0.6;
    }
    s.interactions.onDamaged();
    if (pl.hp <= 0) this.die(from);
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
    for (const m of this.monsters) this.updateMonster(m, dt, now);
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
      if (dp > m.def.attackRange + 8) m.stepToward(map, p.x, p.y, speed * 1.15, dt);
      else if (now >= m.nextAttack) {
        m.nextAttack = now + m.def.attackDelay;
        m.facing = p.x > m.x ? 1 : -1;
        s.tweens.add({ targets: m.sprite, y: m.y - 6, yoyo: true, duration: 90 });
        this.hurtPlayer(m.def.atk, m.def.name);
      }
    } else {
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

  private respawn(m: Monster): void {
    m.reset();
    m.setVisible(true);
    m.sprite.setAlpha(0);
    this.scene.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
    if (m.elite) this.scene.session.eliteDeaths.delete(m.slot);
  }

  // ---------------------------------------------------------------- regen & buffs

  updateVitals(dt: number, now: number, st: Stats): void {
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
    this.windup = null;
  }
}
