// Combat (docs/CLIENT-v2.md §6): casting (wind-up, after-cast lock, SP/cooldown passives), hits through the core
// damage formula, combos, statuses and riders, mastery XP via the SkillBook v2 API, sparks, kills, drops, monster AI,
// player damage and statuses, death and respawn. Shape FX live in SkillSystem; monster techniques in MonsterSkills.
//
// v4 (docs/SPEC-v4.md §2.2, §3.3, §6.1): every skill use — basic attacks included — goes through the worn class's
// mechanic (Session.mechanic, systems/mechanic.ts): castSkill asks it what the bar skill casts right now (stance) and
// whether it is locked, fire commits the use and puts the boost on the cast, every hit / kill / tick / blow taken is
// fed back, and applyMech turns the effects into game consequences (statuses, stored damage, cooldown resets, placed
// and removed objects) and `mechanic` bus events. mend and shield skills resolve here (applyMend / applyShield); the
// statuses root / launch / expose / lure work on monsters and on the player; deed-style counters are flags
// (`hits:<weapon>`, `kills:<weapon>`, `kills:<weapon>:<element>`, `warden_bare`).
//
// Timers use scene time. The scene clock keeps running while the world is paused (panels) or hit-stopped, so every
// combat timer — cooldowns, the after-cast lock, statuses, monster techniques and telegraphs — is shifted forward by
// such gaps (syncClock): nothing recharges, expires or lands while the player cannot act.
import Phaser from 'phaser';
import { BURN_SPREAD_RADIUS, STATUS, computeDamage, exposedPct, statusFor, statusMs, type DamageRoll } from '../../core/combat';
import type { MechanicEffect, SkillUse } from '../../core/mechanics';
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
import { gameBus } from '../events';
import { TILE } from '../world/runtime';
import { type Cast, type CombatHost, PLAYER_R, SkillSystem, castRef, clearShot, hex, isSelfCast } from './SkillSystem';
import { boostSkill, withSize } from './boost';
import type { MechanicRuntime } from './mechanic';
import type { ObjectEndReason, WorldObject } from './objects';

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
const LEECH_CAP = 0.08;
/** Arc rider: zaps the N nearest other monsters within this radius. */
const ARC_RADIUS = 120;
/** Pack animals: hitting one pulls same-species neighbours within ASSIST_RADIUS. */
const PACK_FAMILIES: ReadonlySet<Family> = new Set<Family>(['beast', 'swarm', 'fiend']);
const ASSIST_RADIUS = 110;
/** Aggressive monsters engage a player inside this radius (px). */
const AGGRO_R = { warden: 220, elite: 170, common: 140 } as const;
/** Gaps (ms) beyond a normal frame that count as the world being frozen. */
const FREEZE_GAP = 120;
/** AUTO (SPEC-v4 §6.1): mends below this share of HP; shields before a pack of this many within this far (px). */
const AUTO_MEND_BELOW = 0.6;
const AUTO_PACK = 3;
const AUTO_PACK_RANGE = 5 * TILE;
/** AUTO blinks out when this many foes stand this close (px). */
const AUTO_SURROUNDED = 3;
const AUTO_SURROUNDED_RANGE = 70;
/** A heal over time lands a pulse this often (ms). */
const MEND_PULSE_MS = 500;
/**
 * What a skill's `extra` word does at run time when no other field already says it (SPEC-v4 §6.2). All [T]:
 * `haste` — a self-cast skill also quickens your step; `cleanse` — it also shakes off what ails you; `interrupt` —
 * its hit stops a common or elite mid wind-up; `execute` — it hits harder against a foe that is nearly down.
 */
export const EXTRA = { hastePct: 25, hasteMs: 4000, executeBelow: 0.3, executePct: 40 } as const;
/** In-world words for the v4 statuses (SPEC-v4 §12). */
const STATUS_WORD: Partial<Record<StatusKind, string>> = { root: 'Held', launch: 'Airborne', expose: 'Exposed', lure: 'Lured' };

export interface HurtOpts {
  /** Legacy: a plain slow. */
  slow?: boolean;
  /** Statuses the hit applies to the player (technique element status + skill status). */
  statuses?: StatusKind[];
  /** Where the hit came from (knockback / pull direction). */
  source?: { x: number; y: number };
  /** Attacker rank (stronger crowd control from elites and wardens). */
  rank?: MonsterRank;
  /** The monster that struck and its technique, when known (playerHurt / statusApplied payloads). */
  attacker?: Monster;
  skill?: SkillDef;
}

interface WindUp {
  skill: SkillDef;
  start: number;
  until: number;
  target: Monster | null;
  aim: { x: number; y: number };
  /** Reserved at wind-up: castStart and every later part of this cast carry it. */
  castId: number;
  /** The bar skill pressed (a stance may cast another skill from it). */
  barId: string;
  /** AUTO asked for it at the caster's feet (a class object). */
  atFeet?: boolean;
}

/** A shell raised by a shield skill: it soaks blows until it is spent or its time is up. */
interface Shield {
  cast: Cast;
  left: number;
  total: number;
  until: number;
  /** Burst radius when it breaks or ends (px). */
  burst?: number;
}

/** A heal over time from a mend skill. */
interface Hot {
  cast: Cast;
  per: number;
  left: number;
  next: number;
  /** Resting circle: the heal stops when the player leaves it. */
  origin: { x: number; y: number };
  radius?: number;
  overMs: number;
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
  /**
   * Manual attack (AUTO off — nothing is automatic, basic attack included):
   * `approaching` walks into reach after tapping a monster; `swingQueued` is one basic attack from a tap of the attack
   * button; `attackHeld` keeps swinging while the attack button (or Space) is held; `sticky` swings until the current
   * target dies (debug/test helper and explicit "attack" commands).
   */
  private approaching = false;
  private swingQueued = false;
  private sticky = false;
  attackHeld = false;
  /** Global skill lock after a cast (afterCastMs); walking and auto-attacks stay allowed. */
  lockUntil = 0;
  private lockTotal = 0;
  windup: WindUp | null = null;
  private repathAt = 0;
  private regenT = 0;
  private toastGate = 0;
  private clockAt = -1;
  private pushDest: { x: number; y: number } | null = null;
  private readonly sparkable = new Map<string, boolean>();
  /** Resting (the rest button): HP and SP come back four times faster until the player moves, casts or is hit. */
  resting = false;
  /** v4: the shell a shield skill raised (null: none). */
  shield: Shield | null = null;
  private hots: Hot[] = [];
  /** v4: the worn class's mechanic (run-wide state, Session.mechanic). */
  readonly rt: MechanicRuntime;
  /** Last cast or swing (the mechanic's `attacking`). */
  private lastAttackAt = -1e9;
  private lastPos: { x: number; y: number } | null = null;
  /** `placed` effects of the cast being fired, announced once its object stands. */
  private placedNow: Extract<MechanicEffect, { type: 'placed' }>[] | null = null;

  constructor(readonly scene: MapScene) {
    this.rt = scene.session.mechanic;
    // A new map: the mechanic starts over, and this map's Combat applies what it reports.
    this.rt.onEffects = (effects) => this.applyMech(effects);
    this.rt.reset();
  }

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

  /** A placed object ended by itself, by the cap or on a map change: the class mechanic forgets its object. */
  objectEnded(o: WorldObject, _reason: ObjectEndReason): void {
    if (o.mech !== undefined) this.rt.step({ type: 'remove', object: o.mech });
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
    if (this.windup) {
      this.windup.start += ms;
      this.windup.until += ms;
    }
    for (const b of this.buffs) b.until += ms;
    if (this.shield) this.shield.until += ms;
    for (const h of this.hots) h.next += ms;
    this.lastAttackAt += ms;
    this.scene.skills.shiftTime(ms);
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
    if (this.target !== m) {
      this.swingQueued = false;
      this.sticky = false;
      this.approaching = !!m;
    }
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

  /**
   * The monster is engaging the player now: provoked, or aggressive with the player inside its aggro radius — never
   * while the player is dead or spawn-protected (the arrival beat). Read by the AI and the VFX warden intro pan.
   */
  hostile(m: Monster, now = this.scene.time.now): boolean {
    const p = this.player;
    return !!p && this.hostileAt(m, Math.hypot(m.x - p.x, m.y - p.y), now);
  }

  private hostileAt(m: Monster, dp: number, now: number): boolean {
    if (this.dead || now < this.protectUntil) return false;
    return m.provoked || (!!m.def.aggressive && dp < (m.warden ? AGGRO_R.warden : m.elite ? AGGRO_R.elite : AGGRO_R.common));
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
        // The ground preview (strike cone, spin / nova rim, dash lane) is the VFX charge phase's (castStart).
        p.setCast(t, this.colorFor(w.skill));
        if (now >= w.until) {
          this.windup = null;
          p.setCast(null);
          const tg = w.target && w.target.alive ? w.target : null;
          const aim = tg ? { x: tg.x, y: tg.y } : w.aim;
          if (tg) p.face(tg.x, tg.y);
          this.fire(w.barId, w.skill, tg, aim, w.castId, w.atFeet);
        }
      }
      return;
    }
    if (s.interactions.channel) return;
    this.autoBattle(now);
    if (this.windup) return;
    const auto = s.session.player.autoOn;
    // Holding attack with no target picks the nearest foe in range (like a fresh press).
    if (!auto && this.attackHeld && !(this.target && this.target.alive)) {
      const m = this.nearestMonster(320);
      if (m) this.setTarget(m);
    }
    const t = this.target;
    if (!t || !t.alive) return;
    if (p.stunned(now) || this.pushDest) return;
    const wantSwing = auto || this.attackHeld || this.swingQueued || this.sticky;
    const w = WEAPONS[s.session.player.weapon];
    const reach = w.range + t.radius;
    const d = Math.hypot(t.x - p.x, t.y - p.y);
    if (d > reach) {
      if ((wantSwing || this.approaching) && now >= this.repathAt) {
        this.repathAt = now + 350;
        p.path = s.pathTo(t.x, t.y) ?? [];
      }
    } else {
      if (this.approaching || wantSwing) p.path = [];
      this.approaching = false;
      if (!wantSwing) return;
      const cd = this.ownCooldown(w.basic);
      if (cd.remain <= 0 && now >= p.lockedUntil && this.castSkill(w.basic, true)) this.swingQueued = false;
    }
  }

  /** Attack button / Space press (AUTO off): target the nearest foe if needed and queue one basic attack. */
  pressAttack(): void {
    if (!(this.target && this.target.alive)) {
      const m = this.nearestMonster(320);
      if (!m) {
        this.scene.ui.toast('No enemies nearby.');
        return;
      }
      this.setTarget(m);
    }
    this.swingQueued = true;
  }

  /** Swing at the current target until it dies (manual "attack" command; used by the debug/test hooks). */
  attackUntilDead(m: Monster): void {
    this.setTarget(m);
    this.sticky = true;
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
    const rt = this.rt;
    const mech = rt.mech();
    const st = s.stats();
    // What could be cast this instant, in bar order: usable with the held weapon (AUTO never tries a locked skill),
    // off cooldown, affordable and sensible for its kind (SPEC-v4 §6.1 "AUTO uses it when").
    const ready: { id: string; use: SkillUse }[] = [];
    const ctx = { weapon: this.weapon(), target: String(t.uid), nearLevel: this.nearLevel() };
    for (const id of pl.hotbar) {
      if (!id) continue;
      if (!s.usable(id).ok || this.ownCooldown(id).remain > 0) continue;
      const skill = s.reg.skill(rt.resolve(id)) ?? s.reg.skill(id);
      if (!skill) continue;
      const use = rt.useOf(id, skill);
      // A class object's placer only needs "none of its kind up": the mechanic's own rule decides the rest.
      const placer = mech?.kind === 'zone' && use.kit && skill.shape.kind === 'zone';
      if (!this.autoWants(skill, t, d, now, placer)) continue;
      const pre = rt.preview(use, ctx);
      if (!pre.free && pre.hpCostPct === undefined && pl.sp < this.spCost(skill)) continue;
      if (skill.hpCost && pl.hp <= (st.maxHp * skill.hpCost) / 100) continue;
      ready.push({ id, use });
    }
    // The mechanic's AUTO rule: spend at the threshold, play the combo, cash in at max marks, keep objects up.
    const advice = rt.advice({ castable: ready.map((r) => r.use), weapon: ctx.weapon, hpPct: (pl.hp / st.maxHp) * 100, target: ctx.target, nearLevel: ctx.nearLevel });
    const act = advice.do;
    if (act?.type === 'swap') rt.swap();
    if (act?.type === 'basic') return; // the lead of a combo: basic attacks only (updatePlayer swings them)
    const first = act?.type === 'cast' ? ready.find((r) => r.use.id === act.skill) : undefined;
    const order = first ? [first, ...ready.filter((r) => r !== first)] : ready;
    for (const r of order) {
      if (r !== first && advice.hold.includes(r.use.id)) continue;
      const atFeet = r === first && act?.type === 'cast' && act.place === 'atFeet';
      if (this.castSkill(r.id, true, atFeet)) {
        s.ui.pulseSlot(r.id);
        return;
      }
    }
  }

  /**
   * Whether AUTO would cast this skill at target `t` (distance `d`) right now (SPEC-v4 §6.1): buffs when not
   * running; mends below 60% HP; shields when a wind-up is aimed at you or a pack is close and no shell is up; zones
   * when 2+ foes would stand in them and none of the same is up (`placer`: a class object only needs the latter);
   * blinks when the target is out of reach or you are surrounded; everything else when it hits and the target is in
   * reach. Pure movement (power 0) never auto-fires.
   */
  private autoWants(skill: SkillDef, t: Monster, d: number, now: number, placer = false): boolean {
    const s = this.scene;
    const p = this.player;
    const sh = skill.shape;
    const inReach = d <= SkillSystem.reach(skill) + t.radius + 8;
    switch (sh.kind) {
      case 'buff':
        return d <= AUTO_BUFF_RANGE && !this.buffs.some((b) => b.source === skill.id && b.until > now + 1000);
      case 'mend': {
        const pl = s.session.player;
        return pl.hp < s.stats().maxHp * AUTO_MEND_BELOW && !this.hots.some((h) => h.cast.skill.id === skill.id);
      }
      case 'shield':
        if (this.shield) return false;
        return s.monsterSkills.windingUp() || this.foesWithin(p.x, p.y, AUTO_PACK_RANGE, true) >= AUTO_PACK;
      case 'zone':
        if (s.skills.objects.hasOf(skill.id)) return false;
        // A class object goes down wherever the fight is (the mechanic says where); any other zone needs its foes.
        if (placer) return d <= AUTO_BUFF_RANGE + SkillSystem.reach(skill);
        return inReach && s.skills.zoneWouldCover(skill, p, sh.range > 0 || sh.line ? t : p) >= 2;
      case 'blink': {
        if (sh.to === 'self') return skill.power > 0 && inReach;
        const melee = WEAPONS[this.weapon()].range + t.radius;
        const far = d > melee + 24 && d <= sh.distance + melee;
        return far || this.foesWithin(p.x, p.y, AUTO_SURROUNDED_RANGE) >= AUTO_SURROUNDED;
      }
      default:
        return skill.power > 0 && inReach;
    }
  }

  /** Live monsters within `r` px of a point (`hostileOnly`: only those engaging the player). */
  private foesWithin(x: number, y: number, r: number, hostileOnly = false): number {
    let n = 0;
    for (const m of this.monsters) {
      if (!m.alive || Math.hypot(m.x - x, m.y - y) > r + m.radius) continue;
      if (!hostileOnly || this.hostile(m)) n++;
    }
    return n;
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
    this.player.setCast(null);
    if (show) this.scene.floatText(this.player.x, this.player.y - 66, `× ${w.skill.name}`, '#b8c0d0', 11);
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

  /**
   * Casts bar skill `id` (or a basic attack). The worn class's mechanic decides what the slot casts right now (a
   * stance may put another skill in its place) and whether it is locked; `atFeet` (AUTO placing a class object)
   * aims at the caster's own feet.
   */
  castSkill(id: string, auto = false, atFeet = false): boolean {
    const s = this.scene;
    const barSkill = s.reg.skill(id);
    if (!barSkill || this.dead) return false;
    this.resting = false;
    const u = s.usable(id);
    if (!u.ok) {
      if (!auto) this.gateToast(u.reason!);
      return false;
    }
    const skill = s.reg.skill(this.rt.resolve(id)) ?? barSkill;
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
    s.interactions.cancelChannel();
    let target: Monster | null = null;
    let aim = { x: p.x + Math.cos(p.aimAngle) * 80, y: p.y + Math.sin(p.aimAngle) * 80 };
    if (!isSelfCast(skill)) {
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
      if (auto && !target && !atFeet) return false;
    }
    if (atFeet) aim = { x: p.x, y: p.y };
    if (!this.canPay(id, skill, target, !auto)) return false;
    if ((skill.castMs ?? 0) > 0) {
      p.path = [];
      const castId = s.skills.reserveId();
      this.windup = { skill, start: now, until: now + skill.castMs!, target, aim, castId, barId: id, ...(atFeet ? { atFeet } : {}) };
      p.setCast(0, this.colorFor(skill));
      gameBus.emit('castStart', { skillId: skill.id, skill, element: skill.element, castId, x: p.x, y: p.y, aim, target, durationMs: skill.castMs!, auto });
      return true;
    }
    this.fire(id, skill, target, aim, undefined, atFeet);
    return true;
  }

  /** The id the mechanic engine knows a foe by (its instance id: a respawn is a new foe). */
  private foeId(m: Monster | null | undefined): string | undefined {
    return m && m.alive ? String(m.uid) : undefined;
  }

  private foeById(id: string): Monster | undefined {
    return this.monsters.find((m) => String(m.uid) === id);
  }

  /** Whether the player can pay for a cast of `skill` from bar slot `barId` right now (SP, or HP for an HP cost). */
  private canPay(barId: string, skill: SkillDef, target: Monster | null, say: boolean): boolean {
    const s = this.scene;
    const pl = s.session.player;
    const pre = this.rt.preview(this.rt.useOf(barId, skill), { weapon: this.weapon(), target: this.foeId(target ?? this.target), nearLevel: this.nearLevel() });
    if (!pre.free && pre.hpCostPct === undefined && pl.sp < this.spCost(skill)) {
      if (say) this.gateToast('Not enough SP.');
      return false;
    }
    if (skill.hpCost && pl.hp <= (s.stats().maxHp * skill.hpCost) / 100) {
      if (say) this.gateToast('Not enough HP.');
      return false;
    }
    return true;
  }

  /** Pays `pct` percent of max HP for a cast (never the last point) and tells the mechanic. */
  private spendHp(pct: number): void {
    const s = this.scene;
    const pl = s.session.player;
    const amount = Math.min(pl.hp - 1, Math.round((s.stats().maxHp * pct) / 100));
    if (amount <= 0) return;
    pl.hp -= amount;
    s.floatText(this.player.x, this.player.y - 44, `-${amount}`, '#ff8a8a', 11);
    this.rt.step({ type: 'hpSpent', pct });
  }

  /** The level of the class object the player stands near (zone mechanics), or null. */
  nearLevel(): number | null {
    const tiles = this.rt.nearTiles();
    const p = this.player;
    if (!tiles || !p) return null;
    const o = this.scene.skills.objects.nearest(p.x, p.y, tiles * TILE, true);
    return o && o.mech !== undefined ? this.rt.objectLevel(o.mech) || null : null;
  }

  /**
   * The effect fires: the mechanic commits the use (boost, finisher, cash-in, placement), the cost is paid (SP, or
   * HP when the boost or the skill says so), the cooldown and after-cast lock start, and the shape runs with the
   * boost on it.
   */
  private fire(barId: string, skill: SkillDef, target: Monster | null, aim: { x: number; y: number }, castId?: number, atFeet = false): void {
    const s = this.scene;
    const pl = s.session.player;
    if (!this.canPay(barId, skill, target, true)) return;
    const now = s.time.now;
    const p = this.player;
    const w = WEAPONS[pl.weapon];
    const basic = barId === w.basic;
    const rt = this.rt;
    const use = rt.useOf(barId, skill);
    this.placedNow = [];
    const used = rt.use(use, { weapon: pl.weapon, target: this.foeId(target ?? this.target), nearLevel: this.nearLevel() });
    if (used.locked) {
      this.placedNow = null;
      this.gateToast(`${skill.name} is not ready yet.`);
      return;
    }
    const ms = rt.stats(this.nearLevel());
    const boost = withSize(used.boost, ms.size);
    p.attackAnim();
    const cost = this.spCost(skill);
    if (boost.hpCostPct !== undefined) this.spendHp(boost.hpCostPct);
    else if (!boost.free) pl.sp = Math.max(0, pl.sp - cost);
    if (skill.hpCost) this.spendHp(skill.hpCost);
    const st = s.stats();
    const cdPct = cooldownPctFor(s.book.totals(), skill);
    // A basic attack's delay is the weapon's, quickened by the mechanic's attack speed.
    const base = skill.cooldown || w.delay / (1 + Math.max(-50, ms.attackSpeed) / 100);
    const total = base * (1 + cdPct / 100) * (1 - st.cdr / 100);
    const cash = used.effects.find((e): e is Extract<MechanicEffect, { type: 'cashIn' }> => e.type === 'cashIn');
    if (cash?.resetCooldown) this.cooldowns.delete(barId);
    else this.cooldowns.set(barId, { readyAt: now + total, total });
    if (!basic) {
      this.lockTotal = skill.afterCastMs ?? 250;
      this.lockUntil = now + this.lockTotal;
    }
    this.lastAttackAt = now;
    const rank = Math.max(1, s.book.rank(barId));
    const cast = s.skills.newCast(boostSkill(skill, boost), rank, { x: p.x, y: p.y }, castId);
    cast.barId = barId;
    cast.use = use;
    if (Object.keys(boost).length) cast.boost = boost;
    if (boost.crit) cast.crit = true;
    if (boost.status) cast.status = boost.status;
    if (boost.repeat) cast.repeat = boost.repeat;
    // Marks cashed in: each foe takes the bonus of its own marks; any other boost is the same for every hit.
    if (cash) cast.markPct = new Map(cash.targets.map((t) => [t.target, t.powerPct]));
    else if (boost.powerPct) cast.mult = Math.max(0.1, 1 + boost.powerPct / 100);
    const finisher = used.effects.find((e): e is Extract<MechanicEffect, { type: 'finisher' }> => e.type === 'finisher');
    if (finisher) cast.finisher = finisher.name;
    const placed = this.placedNow;
    this.placedNow = null;
    if (placed.length) {
      cast.mechObject = placed[placed.length - 1].object;
      cast.mechLifeMs = rt.objectLifeMs() ?? 0;
    }
    if (atFeet) aim = { x: p.x, y: p.y };
    if (skill.shape.kind === 'buff' && this.inCombat(now)) s.book.recordBuffUse(barId, this.maxEngagedThreat());
    gameBus.emit('castFire', {
      ...castRef(cast),
      x: p.x,
      y: p.y,
      shape: skill.shape.kind,
      aim,
      target,
      rank,
      basic,
      map: s.mapId,
      ...(cast.boost ? { boost: cast.boost } : {}),
      ...(cast.finisher ? { finisher: cast.finisher } : {}),
      ...(barId !== skill.id ? { barId } : {}),
      ...(boost.hpCostPct !== undefined || skill.hpCost ? { hpCostPct: boost.hpCostPct ?? skill.hpCost } : {}),
    });
    s.skills.execute(cast, aim, target);
    // A class object placed by a skill that is not a zone still stands somewhere: a bare marker at the feet.
    for (const e of placed) {
      let obj = s.skills.objects.byMech(e.object);
      if (!obj && e === placed[placed.length - 1]) obj = s.skills.placeMarker(cast, p.x, p.y, Math.max(TILE / 2, rt.nearTiles() * TILE * 0.25));
      this.emitMech(e, { ...(obj ? { at: { x: obj.x, y: obj.y }, objectId: obj.id } : {}) });
    }
    this.applyExtra(skill, cast);
    s.onCast(skill, aim);
    if (target && !this.target && skill.shape.kind !== 'dash') this.setTarget(target);
  }

  /** What a self-cast skill's `extra` word adds (EXTRA): `haste` quickens your step, `cleanse` shakes statuses off. */
  private applyExtra(skill: SkillDef, _cast: Cast): void {
    if (!isSelfCast(skill)) return;
    const now = this.scene.time.now;
    if (skill.extra === 'haste') {
      const source = `${skill.id}:haste`;
      this.buffs = this.buffs.filter((b) => b.source !== source);
      this.buffs.push({ stat: 'speed', amount: EXTRA.hastePct, until: now + EXTRA.hasteMs, source });
      gameBus.emit('buffApplied', { target: 'player', skillId: skill.id, skill, element: skill.element, stat: 'speed', amount: EXTRA.hastePct, durationMs: EXTRA.hasteMs, untilMs: now + EXTRA.hasteMs, x: this.player.x, y: this.player.y });
    } else if (skill.extra === 'cleanse') {
      const p = this.player;
      if (p.dots.length || Object.values(p.marks).some((u) => (u ?? 0) > now)) this.scene.floatText(p.x, p.y - 72, 'Cleansed', '#d8f4ff', 12);
      p.clearStatuses();
    }
  }

  applyBuff(skill: SkillDef, rank: number): void {
    if (skill.shape.kind !== 'buff') return;
    const sh = skill.shape;
    const amount = sh.amount * (1 + 0.08 * (rank - 1));
    this.buffs = this.buffs.filter((b) => b.source !== skill.id);
    const until = this.scene.time.now + sh.duration;
    this.buffs.push({ stat: sh.stat, amount, until, source: skill.id });
    gameBus.emit('buffApplied', { target: 'player', skillId: skill.id, skill, element: skill.element, stat: sh.stat, amount, durationMs: sh.duration, untilMs: until, x: this.player.x, y: this.player.y });
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
    // The book knows the cast by the bar skill pressed (a stance may have cast another skill in its place).
    const bookId = cast.barId ?? skill.id;
    const foe = String(m.uid);
    const now = s.time.now;
    const st = s.stats();
    const statuses = m.statuses(now);
    const totals = book.totals();
    const weapon = s.session.player.weapon;
    // The mechanic on this cast: marks cashed in against this foe, the standing damage bonus, an execute.
    const mechMult =
      (1 + (cast.markPct?.get(foe) ?? 0) / 100) *
      (1 + this.rt.stats(this.nearLevel()).damage / 100) *
      (skill.extra === 'execute' && m.hp < m.maxHp * EXTRA.executeBelow ? 1 + EXTRA.executePct / 100 : 1);
    const roll = computeDamage(
      reg.elements,
      skill,
      cast.rank,
      { atk: st.atk, matk: st.matk, crit: st.crit, weapon },
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
        falloff: falloff * cast.mult * mechMult,
        forceCrit: cast.crit === true,
      },
    );
    this.provoke(m, now);
    this.lastDealt = now;
    // Use XP is granted lazily on the cast's first hit (any copy: pulses, returns, reprises).
    if (!cast.used.v) {
      cast.used.v = true;
      book.recordUse(bookId, monsterThreat(m.def));
    }
    const mechOn = { ...(cast.boost ? { boost: cast.boost } : {}), ...(cast.finisher ? { finisher: cast.finisher } : {}), ...(cast.objectId !== undefined ? { objectId: cast.objectId } : {}) };
    const top = m.y - m.sprite.displayHeight;
    if (roll.resisted) {
      gameBus.emit('hit', { ...castRef(cast), ...this.via(cast), source: 'player', target: m, x: m.x, y: m.y, damage: 0, crit: false, resisted: true, multiplier: 0, killed: false, hitIndex: cast.tally.hits, ang: Math.atan2(m.y - cast.origin.y, m.x - cast.origin.x), ...mechOn });
      s.floatText(m.x, top, 'Resist', '#9aa0aa', 12);
      if (!this.target && m.alive) this.setTarget(m);
      return roll;
    }
    // The impact frames (white -> element flash, squash, recoil, victim hit-stop) are the VFX juice rig's (hit).
    const tc = roll.crit ? '#ffe14a' : roll.multiplier > 1 ? '#ff9a3a' : roll.multiplier < 1 ? '#a8b0c0' : '#ffffff';
    s.floatText(m.x + Phaser.Math.Between(-8, 8), top, `${roll.amount}${roll.crit ? '!' : ''}`, tc, roll.crit ? 18 : 14);
    m.hp -= roll.amount;
    // Impact sparks, statuses, combos, arc zaps, leech streams and the spark star are drawn by the VFX runtime from
    // the bus (hit / statusApplied / combo / heal / spark); the sprite flash above confirms the hit on this frame.

    if (roll.combo) this.applyCombo(m, roll, cast, top, now);

    const kinds: StatusKind[] = [];
    if (skill.element) {
      const el = reg.element(skill.element);
      if (el) kinds.push(el.status);
    }
    if (skill.status && !kinds.includes(skill.status)) kinds.push(skill.status);
    if (skill.riders?.knockback && !kinds.includes('knockback')) kinds.push('knockback');
    if (cast.status && !kinds.includes(cast.status)) kinds.push(cast.status);
    for (const k of kinds) this.applyStatus(m, k, roll.amount, cast.origin, skill);
    // `interrupt`: the blow stops a common or elite mid wind-up.
    if (skill.extra === 'interrupt' && !m.warden) s.monsterSkills.interruptBy(m);
    // Deed-style counters (SPEC-v4 §8.5): a hit landed while holding this weapon; whose element struck last.
    book.incFlag(`hits:${weapon}`);
    m.lastBlow = { element: skill.element };
    // The class mechanic hears of every hit (fills, marks, banked damage).
    this.rt.step({ type: 'hit', use: cast.use ?? this.rt.useOf(bookId, skill), weapon, target: foe, damage: roll.amount, statuses });

    const leech = skill.riders?.leech;
    if (leech) {
      const pl = s.session.player;
      const room = st.maxHp * LEECH_CAP - cast.leech.healed;
      const heal = Math.min(room, roll.amount * leech, st.maxHp - pl.hp);
      if (heal >= 1) {
        cast.leech.healed += heal;
        pl.hp = Math.min(st.maxHp, pl.hp + heal);
        gameBus.emit('heal', { amount: heal, source: 'leech', x: this.player.x, y: this.player.y, from: { x: m.x, y: m.y } });
        s.floatText(this.player.x, this.player.y - 40, `+${Math.round(heal)}`, '#7fff9f', 11);
      }
    }

    const killed = m.hp <= 0;
    const hitIndex = cast.tally.hits++;
    gameBus.emit('hit', { ...castRef(cast), ...this.via(cast), source: 'player', target: m, x: m.x, y: m.y, damage: roll.amount, crit: roll.crit, resisted: false, multiplier: roll.multiplier, combo: roll.combo?.name, killed, hitIndex, ang: Math.atan2(m.y - cast.origin.y, m.x - cast.origin.x), ...mechOn });
    const instanceHits = m.hitGrants.get(bookId) ?? 0;
    book.recordHit(bookId, { monster: m.def, killed, hitIndex, instanceHits });
    if (hitIndex < MASTERY.maxHitsPerUse) m.hitGrants.set(bookId, instanceHits + 1);
    if (this.canSpark(bookId)) {
      // Spark moment: the 'spark' event (MapScene) runs the 250 ms hit-stop, banner and vibration; the radial
      // flash bursts from the struck foe.
      s.session.sparkAt = { x: m.x, y: m.y };
      book.trySpark(bookId, m.def, book.now());
      s.session.sparkAt = null;
    }

    const arc = skill.riders?.arc;
    if (arc && !cast.arcZap) {
      const from = { x: m.x, y: m.y - 10 };
      const others = this.monsters
        .filter((o) => o !== m && o.alive && Math.hypot(o.x - m.x, o.y - m.y) <= ARC_RADIUS)
        .sort((a, b) => Math.hypot(a.x - m.x, a.y - m.y) - Math.hypot(b.x - m.x, b.y - m.y))
        .slice(0, arc.targets);
      const zap: Cast = { ...cast, arcZap: true, arcFrom: from, via: 'arc', mult: cast.mult * arc.mult };
      others.forEach((o, i) =>
        s.time.delayedCall(50 + i * 40, () => {
          if (!o.alive || this.dead) return;
          this.hit(o, zap, falloff);
        }),
      );
    }

    // (a mechanic effect — banked damage landing — may already have finished it)
    if (killed) this.kill(m, cast);
    else if (!this.target && m.alive && skill.shape.kind !== 'dash') this.setTarget(m);
    return roll;
  }

  /** hit.via / hit.from for a blow that did not land directly (arc zap, pierce, return). */
  private via(cast: Cast): { via?: 'arc' | 'pierce' | 'return'; from?: { x: number; y: number } } {
    if (!cast.via) return {};
    return cast.via === 'arc' && cast.arcFrom ? { via: 'arc', from: { ...cast.arcFrom } } : { via: cast.via };
  }

  /** Ends the consumed status, floats the combo name and plays its FX (Shatter / Conduct / Fan the Flames). */
  private applyCombo(m: Monster, roll: DamageRoll, cast: Cast, top: number, now: number): void {
    const s = this.scene;
    const c = roll.combo!;
    // Fan the Flames: where the burn spreads (computed before the event so the VFX can draw the streams).
    const spread = c.spreadBurn
      ? this.monsters.filter((o) => o !== m && o.alive && Math.hypot(o.x - m.x, o.y - m.y) <= BURN_SPREAD_RADIUS + o.radius)
      : [];
    gameBus.emit('combo', { ...castRef(cast), target: m, name: c.name, consumes: c.consumes, x: m.x, y: m.y, ...(c.spreadBurn ? { spreadTo: spread.map((o) => ({ x: o.x, y: o.y })) } : {}) });
    delete m.status.marks[c.consumes];
    if (c.consumes === 'freeze') m.status.stunUntil = Math.min(m.status.stunUntil, now);
    if (c.consumes === 'soak') m.status.slowUntil = Math.min(m.status.slowUntil, now);
    if (c.consumes === 'burn') m.status.dots = m.status.dots.filter((d) => d.kind !== 'burn');
    s.floatText(m.x, top - 18, `${c.name}!`, '#ffd76a', 15);
    for (const o of spread) this.applyStatus(o, 'burn', roll.amount, cast.origin, cast.skill);
  }

  /**
   * Puts a status on a monster. `ms` overrides the length of the v4 statuses (root, launch, expose, lure). Wardens
   * take a slow instead of a root or a launch and shrug lures off (core statusFor).
   */
  applyStatus(m: Monster, asked: StatusKind, dmg: number, origin: { x: number; y: number }, source?: SkillDef, ms?: number): void {
    const now = this.scene.time.now;
    const boss = m.warden;
    const st = m.status;
    const taken = statusFor(asked, m.def.rank);
    if (!taken) return;
    const kind: StatusKind = taken;
    const len = ms ?? statusMs(asked) ?? 2200;
    if (taken !== asked) {
      // A warden held or thrown: slowed for as long instead.
      st.slowUntil = Math.max(st.slowUntil, now + len);
      st.slowMult = 1 - STATUS.wardenSlowPct / 100;
      st.marks.slow = Math.max(st.marks.slow ?? 0, now + len);
      gameBus.emit('statusApplied', { target: m, kind: 'slow', x: m.x, y: m.y, untilMs: st.marks.slow, ...(source ? { source } : {}) });
      return;
    }
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
        gameBus.emit('heal', { amount: heal, source: 'smite', x: this.player.x, y: this.player.y, from: { x: m.x, y: m.y } });
        this.scene.floatText(this.player.x, this.player.y - 40, `+${heal}`, '#7fff9f', 12);
        mark('smite', 1000);
        break;
      }
      case 'root':
        // Held: it cannot walk, chase or wander; it can still strike what stands next to it.
        st.rootUntil = Math.max(st.rootUntil, now + len);
        mark('root', len);
        this.statusWord(m, 'root');
        break;
      case 'launch':
        // Airborne: helpless until it lands, then a landing blow. A foe already in the air is not thrown again.
        if (now < st.launchUntil) return;
        st.launchStart = now;
        st.launchUntil = now + len;
        st.launchDmg = Math.max(1, Math.round(dmg * STATUS.launchLandingMult));
        st.stunUntil = Math.max(st.stunUntil, st.launchUntil);
        st.vx = st.vy = 0;
        mark('launch', len);
        this.statusWord(m, 'launch');
        break;
      case 'expose':
        mark('expose', len);
        this.statusWord(m, 'expose');
        break;
      case 'lure':
        st.lureUntil = Math.max(st.lureUntil, now + len);
        st.lureTo = { x: origin.x, y: origin.y };
        mark('lure', len);
        this.statusWord(m, 'lure');
        break;
    }
    const until = st.marks[kind];
    gameBus.emit('statusApplied', { target: m, kind, x: m.x, y: m.y, ...(until !== undefined && until > now ? { untilMs: until } : {}), ...(source ? { source } : {}) });
  }

  /** The plain word of a v4 status over a monster's head, once per application. */
  private statusWord(m: Monster, kind: StatusKind): void {
    const word = STATUS_WORD[kind];
    if (word) this.scene.floatText(m.x, m.y - m.sprite.displayHeight - 14, word, '#e8dcff', 11);
  }

  private damageMonsterRaw(m: Monster, amount: number, color: number): void {
    if (!m.alive) return;
    m.hp -= amount;
    // One frame of the tick's colour through the juice rig's per-victim flash gate (no flash spam under DoTs).
    const juice = this.scene.vfx?.juice;
    if (juice) juice.tick(m, color);
    else m.flash(color);
    this.scene.floatText(m.x, m.y - m.sprite.displayHeight, `${amount}`, hex(color), 11);
    if (m.hp <= 0) this.kill(m);
  }

  // ---------------------------------------------------------------- kills & rewards

  /** A monster dies to the player; `killer` = the cast that landed the blow (death.killer), absent for DoT ticks. */
  kill(m: Monster, killer?: Cast): void {
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
    m.bar.clear();
    m.aura?.clear();
    if (this.target === m) this.setTarget(null);
    else this.updateTargetUi();

    const pl = s.session.player;
    const pl0 = pl;
    const coins = Phaser.Math.Between(m.def.coins[0], m.def.coins[1]);
    pl.coins += coins;
    book.incFlag('kills');
    // Deed-style counters: every foe defeated while holding this weapon, and by which element (the killing skill's,
    // or the last blow's when a burn or a landing finished it); a warden beaten bare-handed.
    const held = this.weapon();
    book.incFlag(`kills:${held}`);
    const element = killer ? killer.skill.element : m.lastBlow?.element;
    if (element) book.incFlag(`kills:${held}:${element}`);
    if (m.warden && held === 'fists') book.incFlag('warden_bare');
    // The class mechanic: a kill (near one of its objects, when it has any).
    const near = this.rt.nearTiles() ? s.skills.objects.nearest(m.x, m.y, this.rt.nearTiles() * TILE, true) : null;
    this.rt.step({ type: 'kill', target: String(m.uid), hpPct: (pl0.hp / Math.max(1, s.stats().maxHp)) * 100, ...(near?.mech !== undefined ? { object: near.mech } : {}) });
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
      // A governed warm flash (camera rig: alpha <= 0.35, none under "Reduce shake & flashes").
      s.stage.rig.flash(0xfff0a0, 0.3);
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
    gameBus.emit('kill', { monster: m, def: m.def, x: m.x, y: m.y, exp: m.def.exp, coins, elite: m.elite, warden: m.warden });
    gameBus.emit('death', { target: m, rank: m.def.rank, x: m.x, y: m.y, ...(killer ? { killer: castRef(killer) } : {}) });
    // Death pop (VFX): two white frames on the real sprite, then it is hidden and the pop plays where it stood.
    s.time.delayedCall(34, () => {
      if (!m.alive) m.setVisible(false);
    });
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
      gameBus.emit('levelUp', { level: pl.level, x: this.player.x, y: this.player.y });
    }
    if (leveled) {
      const st = s.stats();
      pl.hp = st.maxHp;
      pl.sp = st.maxSp;
      s.floatText(this.player.x, this.player.y - 60, `LEVEL ${pl.level}!`, '#ffe14a', 18);
      s.ui.toast(`🎉 Level <b>${pl.level}</b>!`);
      s.ui.log(`🎉 Level <b>${pl.level}</b>! HP and SP restored.`, 'good');
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
    const p = this.player;
    // Exposed: the player takes more for a while.
    const exposed = (p.marks.expose ?? 0) > now ? exposedPct(['expose']) : 0;
    let dmg = Math.max(1, Math.round((atk * Phaser.Math.FloatBetween(0.9, 1.1) - st.def * 0.5) * (1 + exposed / 100)));
    const pl = s.session.player;
    this.lastHurt = now;
    // A shell soaks the blow first; what it soaks never reaches the body (no statuses from a blow fully soaked).
    dmg -= this.soak(dmg, opts.source);
    if (dmg <= 0) {
      s.interactions.onDamaged();
      return 0;
    }
    pl.hp -= dmg;
    this.rt.step({ type: 'damageTaken', pct: (dmg / Math.max(1, st.maxHp)) * 100 });
    // The body flash is the VFX juice rig's (playerHurt: one gated white frame, squash, recoil); the plain red flash
    // only plays without the runtime (it stacked a second flash under every rig flash).
    if (!s.vfx?.juice) this.player.hurt();
    gameBus.emit('playerHurt', {
      damage: dmg,
      hp: pl.hp,
      maxHp: st.maxHp,
      from,
      origin: opts.source,
      heavy: dmg >= st.maxHp * 0.15,
      x: this.player.x,
      y: this.player.y,
      ...(opts.attacker ? { attacker: opts.attacker } : {}),
      ...(opts.skill ? { skillId: opts.skill.id, skill: opts.skill } : {}),
    });
    s.floatText(this.player.x, this.player.y - 44, `-${dmg}`, '#ff5a5a', dmg >= st.maxHp * 0.15 ? 17 : 14);
    // Heavy blows shake the camera (trauma 0.35) and kick it along the blow: the VFX juice rig (playerHurt).
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
    const immune = now < p.ccImmuneUntil;
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
      case 'root':
        // Held: no walking; skills still work.
        p.rootUntil = Math.max(p.rootUntil, now + STATUS.rootMs * (0.5 + 0.25 * tier));
        p.path = [];
        mark('root', p.rootUntil - now);
        s.floatText(p.x, p.y - 72, 'Held!', '#d8f0c0', 13);
        break;
      case 'launch':
        // Airborne: helpless (a stun the immunity window covers), then a landing blow.
        if (cc(STATUS.launchMs * (0.5 + 0.15 * tier), false)) {
          p.launchUntil = p.stunUntil;
          p.launchDmg = Math.max(1, Math.round(dmg * STATUS.launchLandingMult));
          p.launchFrom = from;
          mark('launch', p.stunUntil - now);
        }
        break;
      case 'expose':
        mark('expose', STATUS.exposeMs);
        s.floatText(p.x, p.y - 72, 'Exposed!', '#ffc8a0', 13);
        break;
      case 'lure':
        // Lured: the feet walk toward where it came from; taps do not steer meanwhile.
        if (opts.source && !immune) {
          p.lureUntil = now + STATUS.lureMs * (0.4 + 0.15 * tier);
          p.lureTo = { x: opts.source.x, y: opts.source.y };
          p.path = [];
          mark('lure', p.lureUntil - now);
          s.floatText(p.x, p.y - 72, 'Lured!', '#f0b0e8', 13);
        }
        break;
      default:
        break;
    }
    const until = p.marks[kind];
    gameBus.emit('statusApplied', {
      target: 'player',
      kind,
      x: p.x,
      y: p.y,
      blocked: (kind === 'stun' || kind === 'freeze' || kind === 'launch' || kind === 'lure') && immune,
      ...(until !== undefined && until > now ? { untilMs: until } : {}),
      ...(opts.skill ? { source: opts.skill } : {}),
    });
  }

  /** Player DoT ticks and knockback travel (the status overlays are the VFX runtime's: statusApplied). */
  private updatePlayerStatus(dt: number, now: number): void {
    const s = this.scene;
    const p = this.player;
    if (this.dead || !p) return;
    if (p.launchDmg && now >= p.launchUntil) {
      // The landing of a launch: a raw blow (a shell soaks it like any other).
      const dmg = p.launchDmg - this.soak(p.launchDmg);
      p.launchDmg = 0;
      if (dmg > 0 && now >= this.protectUntil) this.tickPlayer({ kind: 'launch', until: now, next: now, every: 0, dmg, color: 0xffffff, from: p.launchFrom }, now);
      if (this.dead) return;
    }
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
    const maxHp = s.stats().maxHp;
    this.rt.step({ type: 'damageTaken', pct: (d.dmg / Math.max(1, maxHp)) * 100 });
    gameBus.emit('playerHurt', { damage: d.dmg, hp: pl.hp, maxHp, from: d.from, heavy: false, dot: d.kind, x: this.player.x, y: this.player.y });
    s.floatText(this.player.x + Phaser.Math.Between(-6, 6), this.player.y - 44, `-${d.dmg}`, hex(d.color), 11);
    s.interactions.onDamaged();
    if (pl.hp <= 0) this.die(d.from);
  }

  /** Walkable and not a portal tile (knockback never shoves the player through a portal; a blink never lands on one). */
  canStand(x: number, y: number): boolean {
    const cm = this.cm;
    if (isBlockedPx(cm, x, y)) return false;
    return !(cm.coll[Math.floor(y / TILE) * cm.w + Math.floor(x / TILE)] & COLL.PORTAL);
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
    // Down: the shell, heals in progress, placed objects and the class mechanic all end.
    this.endShield('clear');
    this.hots = [];
    s.skills.objects.clear();
    this.rt.reset();
    const lost = Math.floor(pl.exp * 0.05);
    pl.exp -= lost;
    gameBus.emit('death', { target: 'player', from, expLost: lost, x: this.player.x, y: this.player.y });
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
          gameBus.emit('dotTick', { target: m, damage: dot.dmg, kind: dot.kind, x: m.x, y: m.y });
          this.damageMonsterRaw(m, dot.dmg, dot.color);
          if (!m.alive) return;
        }
      }
      m.status.dots = m.status.dots.filter((d) => d.until > now);
    }
    // Status units on monsters are the VFX runtime's (statusApplied).
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
    // Airborne (launch): it comes down and takes the landing blow.
    if (m.status.launchDmg && now >= m.status.launchUntil) {
      const landing = m.status.launchDmg;
      m.status.launchDmg = 0;
      this.damageMonsterRaw(m, landing, 0xffffff);
      if (!m.alive) return;
    }
    if (now < m.busyUntil) return;
    m.restoreTint();
    if (m.stunned) return;

    // Held (root): it cannot walk by itself — no chasing, wandering or going home — but it still strikes.
    const held = m.rooted;
    const speed = held ? 0 : m.def.speed * m.speedMult(now);
    const fromSpawn = Math.hypot(m.x - m.spawn.x, m.y - m.spawn.y);
    if (m.returning) {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * 0.5);
      if (held) return;
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
      this.rt.step({ type: 'gone', target: String(m.uid) });
      return;
    }
    const dp = Math.hypot(m.x - p.x, m.y - p.y);
    const swing = () => {
      m.nextAttack = now + m.attackDelay();
      m.facing = p.x > m.x ? 1 : -1;
      // A whole-pixel lunge toward the player (the claw / lash / slam itself is the VFX's: playerHurt).
      m.recoil(Math.atan2(p.y - m.y, p.x - m.x), 3);
      this.hurtPlayer(m.atk(now), m.def.name, { source: { x: m.x, y: m.y }, rank: m.def.rank, attacker: m });
      this.opening(m);
    };
    // Lured: it walks toward the lure instead of its own target (and swings only at what is right next to it).
    const lure = m.lure;
    if (lure) {
      if (!held && Math.hypot(lure.x - m.x, lure.y - m.y) > m.radius) m.stepToward(map, lure.x, lure.y, speed, dt);
      if (this.hostileAt(m, dp, now) && dp <= m.def.attackRange + 8 && now >= m.nextAttack) swing();
      return;
    }
    if (this.hostileAt(m, dp, now)) {
      if (s.monsterSkills.tryStart(m, now, dp)) return;
      if (dp > m.def.attackRange + 8) {
        if (!held) this.chase(m, speed * 1.15, dt, now);
      } else if (now >= m.nextAttack) swing();
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
      if (!held && m.wanderTo && m.stepToward(map, m.wanderTo.x, m.wanderTo.y, speed * 0.5, dt)) m.wanderTo = null;
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
    m.sprite.setAlpha(1);
    // The spawn pop (white frames, dust, ring) is the VFX runtime's.
    gameBus.emit('monsterSpawn', { monster: m, rank: m.def.rank, x: m.x, y: m.y });
    if (m.elite) this.scene.session.eliteDeaths.delete(m.slot);
  }

  // ---------------------------------------------------------------- regen & buffs

  updateVitals(dt: number, now: number, st: Stats): void {
    this.updatePlayerStatus(dt, now);
    this.updateMech(dt, now);
    this.updateShell(now);
    if (this.buffs.length && this.buffs.some((b) => b.until <= now)) this.buffs = this.buffs.filter((b) => b.until > now);
    const pl = this.scene.session.player;
    if (this.resting && (this.dead || this.player.moving || this.player.path.length > 0 || this.windup || now - this.lastHurt < 300)) this.resting = false;
    this.regenT += dt;
    if (this.regenT < 1 || this.dead) return;
    this.regenT -= 1;
    const calm = now - this.lastHurt > 5000;
    const still = (this.player.moving ? 1 : 1 + regenStillPct(this.scene.book.totals()) / 100) * (this.resting ? 4 : 1);
    pl.hp = Math.min(st.maxHp, pl.hp + st.maxHp * ((calm ? 0.02 : 0.005) * still + st.regen / 100));
    pl.sp = Math.min(st.maxSp, pl.sp + (st.maxSp * (calm ? 0.05 : 0.02) + 0.5) * still);
    if (this.resting && pl.hp >= st.maxHp && pl.sp >= st.maxSp) {
      this.resting = false;
      this.scene.floatText(this.player.x, this.player.y - 56, 'Rested', '#9fffb8', 12);
    }
  }

  /** The rest button: sit and recover (four times faster) until moving, casting or being hit. */
  rest(): { ok: boolean; message?: string } {
    const s = this.scene;
    const pl = s.session.player;
    const st = s.stats();
    if (this.dead) return { ok: false, message: 'Not now.' };
    if (this.inCombat()) return { ok: false, message: 'Not during a fight.' };
    if (pl.hp >= st.maxHp && pl.sp >= st.maxSp) return { ok: false, message: 'You are already rested.' };
    this.cancelWindup();
    this.player.path = [];
    this.setTarget(null);
    this.holdAuto(8000);
    this.resting = true;
    s.vfx?.extra('rest', this.player.x, this.player.y);
    s.floatText(this.player.x, this.player.y - 56, 'Resting', '#9fffb8', 12);
    return { ok: true, message: 'You sit and rest. Move to get up.' };
  }

  clear(): void {
    for (const m of this.monsters) m.destroy();
    this.monsters = [];
    this.target = null;
    this.windup = null;
    this.shield = null;
    this.hots = [];
    // The next map binds its own Combat; until then nothing listens.
    this.rt.onEffects = () => undefined;
  }

  // ---------------------------------------------------------------- v4: mend, shield

  /**
   * A mend skill (SPEC-v4 §6.1): `pct` of max HP, at once or in pulses over `overMs`; with `radius` the pulses only
   * keep coming while the player stays inside that resting circle. Healing counts as "prevented" for the mechanic.
   */
  applyMend(cast: Cast): void {
    const sh = cast.skill.shape;
    if (sh.kind !== 'mend') return;
    const p = this.player;
    const total = (this.scene.stats().maxHp * sh.pct) / 100;
    if (!sh.overMs || sh.overMs <= MEND_PULSE_MS) {
      this.healBy(cast, total, true, sh);
      return;
    }
    const pulses = Math.max(2, Math.round(sh.overMs / MEND_PULSE_MS));
    this.hots = this.hots.filter((h) => h.cast.skill.id !== cast.skill.id);
    this.hots.push({ cast, per: total / pulses, left: pulses - 1, next: this.scene.time.now + MEND_PULSE_MS, origin: { x: p.x, y: p.y }, ...(sh.radius ? { radius: sh.radius } : {}), overMs: sh.overMs });
    this.healBy(cast, total / pulses, true, sh);
  }

  private healBy(cast: Cast, amount: number, first: boolean, sh: { overMs?: number; radius?: number }): number {
    const s = this.scene;
    const pl = s.session.player;
    const p = this.player;
    const maxHp = s.stats().maxHp;
    const healed = Math.max(0, Math.min(maxHp - pl.hp, amount));
    pl.hp += healed;
    gameBus.emit('mend', { ...castRef(cast), x: p.x, y: p.y, amount: healed, first, ...(sh.overMs ? { overMs: sh.overMs } : {}), ...(sh.radius ? { radius: sh.radius } : {}) });
    if (healed >= 1) {
      gameBus.emit('heal', { amount: healed, source: 'mend', x: p.x, y: p.y });
      s.floatText(p.x, p.y - 40, `+${Math.round(healed)}`, '#7fff9f', first ? 13 : 11);
      this.rt.step({ type: 'prevented', pct: (healed / Math.max(1, maxHp)) * 100 });
    }
    return healed;
  }

  /** A shield skill: a shell worth `pct` of max HP for `durationMs` (a new shell replaces the old one). */
  applyShield(cast: Cast): void {
    const sh = cast.skill.shape;
    if (sh.kind !== 'shield') return;
    this.endShield('replaced');
    const p = this.player;
    const now = this.scene.time.now;
    const total = Math.max(1, Math.round((this.scene.stats().maxHp * sh.pct) / 100));
    const burst = sh.burst && cast.skill.power > 0 ? sh.burst.radius : undefined;
    this.shield = { cast, left: total, total, until: now + sh.durationMs, ...(burst !== undefined ? { burst } : {}) };
    gameBus.emit('shieldUp', { ...castRef(cast), x: p.x, y: p.y, amount: total, durationMs: sh.durationMs, untilMs: now + sh.durationMs, ...(burst !== undefined ? { burst } : {}) });
    this.scene.floatText(p.x, p.y - 56, cast.skill.name, '#cfe6ff', 11);
  }

  /** The shell soaks up to `dmg`; returns what it soaked (0 without a shell). */
  private soak(dmg: number, origin?: { x: number; y: number }): number {
    const sh = this.shield;
    if (!sh || dmg <= 0) return 0;
    const s = this.scene;
    const p = this.player;
    const absorbed = Math.min(sh.left, dmg);
    sh.left -= absorbed;
    gameBus.emit('shieldHit', { x: p.x, y: p.y, absorbed, left: sh.left, ...(origin ? { origin } : {}) });
    s.floatText(p.x, p.y - 44, `(${Math.round(absorbed)})`, '#cfe6ff', 12);
    this.rt.step({ type: 'prevented', pct: (absorbed / Math.max(1, s.stats().maxHp)) * 100 });
    if (sh.left <= 0) this.endShield('broken');
    return absorbed;
  }

  /** Ends the shell. Broken or timed out, a bursting shell hits everything around the player once. */
  endShield(reason: 'broken' | 'expired' | 'replaced' | 'clear'): void {
    const sh = this.shield;
    if (!sh) return;
    this.shield = null;
    const p = this.player;
    const bursts = sh.burst !== undefined && (reason === 'broken' || reason === 'expired') && !this.dead;
    gameBus.emit('shieldEnd', { ...castRef(sh.cast), x: p.x, y: p.y, reason, ...(bursts ? { burst: sh.burst } : {}) });
    if (bursts) this.scene.skills.burst(sh.cast, { x: p.x, y: p.y }, sh.burst!);
  }

  /** How much the shell still soaks, and of how much (HUD / debug). */
  shieldLeft(): { left: number; total: number } | null {
    return this.shield ? { left: this.shield.left, total: this.shield.total } : null;
  }

  /** Shell timeout and heals over time. */
  private updateShell(now: number): void {
    if (this.shield && now >= this.shield.until) this.endShield('expired');
    if (!this.hots.length || this.dead) return;
    const p = this.player;
    for (const h of this.hots) {
      if (h.radius !== undefined && Math.hypot(p.x - h.origin.x, p.y - h.origin.y) > h.radius) {
        h.left = 0;
        continue;
      }
      if (now < h.next) continue;
      h.next += MEND_PULSE_MS;
      h.left--;
      this.healBy(h.cast, h.per, false, { overMs: h.overMs, ...(h.radius !== undefined ? { radius: h.radius } : {}) });
    }
    this.hots = this.hots.filter((h) => h.left > 0);
  }

  // ---------------------------------------------------------------- v4: the class mechanic

  /** Every frame: time passes for the mechanic (decay, combo windows, stance turns, object lifetimes). */
  private updateMech(dt: number, now: number): void {
    const p = this.player;
    if (!p || this.dead) {
      this.lastPos = null;
      return;
    }
    const last = this.lastPos;
    const step = last ? Math.hypot(p.x - last.x, p.y - last.y) : 0;
    this.lastPos = { x: p.x, y: p.y };
    if (!this.rt.mech()) return;
    // Walking counts tile by tile; a dash, blink or knockback (a jump in one frame) does not.
    const walked = p.moving && step < 40 ? step / TILE : 0;
    this.rt.step({ type: 'tick', dtMs: dt * 1000, moving: p.moving, attacking: now - this.lastAttackAt < 1000, inCombat: this.inCombat(now), tiles: walked });
  }

  /** A monster finished its own attack: for a moment it shows an Opening (marks that land on openings). */
  opening(m: Monster): void {
    if (m.alive) this.rt.step({ type: 'opening', target: String(m.uid) });
  }

  /** The stance button (GameController.mechanicTap). */
  mechTap(): boolean {
    return !this.dead && this.rt.swap();
  }

  /**
   * What the mechanic engine reported: game consequences first (statuses from marks, banked damage landing, class
   * objects placed / grown / removed), then one `mechanic` bus event per effect for VFX, audio and the HUD.
   */
  private applyMech(effects: readonly MechanicEffect[]): void {
    const s = this.scene;
    const p = this.player;
    if (!p) return;
    const objects = s.skills?.objects;
    for (const e of effects) {
      switch (e.type) {
        case 'full':
          s.floatText(p.x, p.y - 66, `${e.name}!`, '#ffe9a0', 13);
          this.emitMech(e);
          break;
        case 'finisher':
          s.floatText(p.x, p.y - 66, `${e.name}!`, '#ffe14a', 14);
          this.emitMech(e, { skillId: e.skill });
          break;
        case 'spent':
          this.emitMech(e, { skillId: e.skill });
          break;
        case 'marked': {
          const m = this.foeById(e.target);
          if (m?.alive && e.status) this.applyStatus(m, e.status, 0, { x: p.x, y: p.y }, undefined, e.statusMs);
          this.emitMech(e, m ? { target: m, at: { x: m.x, y: m.y } } : {});
          break;
        }
        case 'cashIn': {
          const targets = e.targets.flatMap((t) => {
            const m = this.foeById(t.target);
            return m?.alive ? [{ target: m, marks: t.marks, stored: t.stored }] : [];
          });
          this.emitMech(e, { skillId: e.skill, targets });
          // Banked damage lands at once.
          for (const t of targets) if (t.stored >= 1) this.damageMonsterRaw(t.target, Math.round(t.stored), 0xe8dcff);
          break;
        }
        case 'markEnd': {
          const m = this.foeById(e.target);
          this.emitMech(e, m ? { target: m, at: { x: m.x, y: m.y } } : {});
          if (m?.alive && e.stored >= 1) this.damageMonsterRaw(m, Math.round(e.stored), 0xe8dcff);
          break;
        }
        case 'stance':
          s.floatText(p.x, p.y - 66, e.name, '#bfe8ff', 13);
          s.markHotbarDirty();
          this.emitMech(e);
          break;
        case 'placed':
          // Announced by fire() once the object stands (its place and id are known then).
          if (this.placedNow) this.placedNow.push(e);
          else this.emitMech(e);
          break;
        case 'expired': {
          const o = objects?.byMech(e.object);
          this.emitMech(e, o ? { at: { x: o.x, y: o.y }, objectId: o.id } : {});
          if (o) objects!.end(o, this.placedNow ? 'replaced' : 'expire');
          break;
        }
        case 'levelUp': {
          const o = objects?.byMech(e.object);
          if (o) {
            o.level = e.level;
            s.floatText(o.x, o.y - 30, `${e.name} ${e.level}`, '#ffd0a0', 12);
          }
          this.emitMech(e, o ? { at: { x: o.x, y: o.y }, objectId: o.id } : {});
          break;
        }
        case 'consumed': {
          const gone = e.objects.flatMap((x) => objects?.byMech(x.id) ?? []);
          this.emitMech(e, { skillId: e.skill, ...(gone[0] ? { at: { x: gone[0].x, y: gone[0].y }, objectId: gone[0].id } : {}) });
          for (const o of gone) objects!.end(o, 'consumed');
          break;
        }
        default:
          this.emitMech(e);
      }
    }
  }

  /** One `mechanic` bus event for an effect. */
  private emitMech(e: MechanicEffect, extra: Partial<Pick<import('../events').MechanicEventPayload, 'target' | 'targets' | 'skillId' | 'at' | 'objectId'>> = {}): void {
    const rt = this.rt;
    const cls = rt.cls();
    const mech = rt.mech();
    if (!cls || !mech) return;
    const p = this.player;
    gameBus.emit('mechanic', { classId: cls.id, kind: mech.kind, name: e.name, type: e.type, effect: e, view: rt.view(this.foeId(this.target)), x: p?.x ?? 0, y: p?.y ?? 0, ...extra });
  }
}
