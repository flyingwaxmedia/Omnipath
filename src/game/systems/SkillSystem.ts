// Shape timing, hit tests, projectiles and riders (docs/CLIENT-v2.md §6): turns SkillDef shapes into gameplay and
// calls the host for every hit. Damage, statuses and XP live in Combat.ts.
//
// Riders implemented here: `returns` (projectiles fly back once, hit set cleared once) and `reprise` (the whole cast
// re-executes once after delayMs at `mult`). `arc`, `leech` and `knockback` are per-hit and live in Combat.hit.
// Chain shapes tagged projectile/pierce are bouncing knives (blades when tagged blade), not lightning.
//
// Visuals: every player effect is drawn by the VFX runtime (src/game/vfx/runtime, docs/VFX.md §8) from the bus
// events emitted here (skillPulse, projectileSpawn/End, chainLaunch, novaTelegraph/Blast, dash): this file never
// draws a player skill. A projectile's Image stays as its bus identity but is invisible. fxBurst / fxRing remain as
// thin adapters onto the VFX runtime for MapScene's portal reveal and blink (docs/VFX.md §8.7); every other legacy
// fx helper and the client `cfx_*` textures are gone (monsters, statuses and world moments are vfx/world.ts's).
//
// v4 kinds (docs/SPEC-v4.md §6.1): `zone` places a WorldObject (./objects.ts — the one helper for everything a skill
// places; cap 12, oldest first) that ticks on a timer through the ordinary hit test (objectSpawn / objectTick /
// objectEnd); `blink` moves the caster at once and may hit where it lands (blink); `mend` and `shield` are the
// host's (Combat.applyMend / applyShield: mend, shieldUp / shieldHit / shieldEnd), the shield's burst comes back
// here (burst). A class mechanic's boost arrives on the Cast (`skill` already carries the boosted shape).
import Phaser from 'phaser';
import type { DamageRoll } from '../../core/combat';
import type { SkillUse } from '../../core/mechanics';
import type { CastBoost, SkillDef, SkillShape, StatusKind, WeaponType } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { CompiledMap } from '../../core/world/types';
import type { Monster } from '../entities/Monster';
import type { Player } from '../entities/Player';
import { gameBus, type Pt, type SkillRef } from '../events';
import { Y_BIAS, ySort } from '../render/depths';
import { type ObjectEndReason, type WorldObject, WorldObjects, objectCovers, zoneTicks } from './objects';
import { SELF_KINDS, isSelfCast } from './extras';
import { distToSegment } from './tellhit';

export interface Cast {
  id: number;
  skill: SkillDef;
  rank: number;
  origin: { x: number; y: number };
  /** Shared across copies of the cast (pulses, projectiles, reprise) for the mastery hit cap. */
  tally: { hits: number };
  /** Shared: recordUse has been granted (lazily, on the cast's first hit). */
  used: { v: boolean };
  /** Shared: HP leeched by this cast (capped at 8% max HP). */
  leech: { healed: number };
  /** Power multiplier of this copy (reprise). */
  mult: number;
  /** True for the reprised copy (never reprises again). */
  reprise: boolean;
  /** Arc rider zaps never arc again. */
  arcZap?: boolean;
  /** Arc rider: where the zap leaves from (hit.from). */
  arcFrom?: Pt;
  /** How this copy's blow arrives when not directly (hit.via): an arc zap, a pierce, a returning projectile. */
  via?: 'arc' | 'pierce' | 'return';
  // ---- v4: the class mechanic on this cast (Combat.fire fills these; `skill` already has the boosted shape)
  /** The bar skill pressed (the book's records and the cooldown use it; a stance may cast another skill from it). */
  barId?: string;
  /** The facts the mechanic engine reads about this use (fed back with every hit). */
  use?: SkillUse;
  /** What the mechanic added to this cast. */
  boost?: CastBoost;
  /** Every hit of this cast crits (a finisher). */
  crit?: boolean;
  /** A status every hit of this cast also applies. */
  status?: StatusKind;
  /** A combo finisher: its name. */
  finisher?: string;
  /** Marks cashed in by this cast: foe id -> percent damage bonus against that foe. */
  markPct?: ReadonlyMap<string, number>;
  /** The whole cast runs once more at this multiplier (CastBoost.repeat). */
  repeat?: number;
  /** The class mechanic's object this cast places (mechanics.ts object id) and how long it stands (ms; 0 = until
   *  replaced or used up). */
  mechObject?: number;
  mechLifeMs?: number;
  /** The placed object (objectSpawn id) whose tick lands this copy's hits. */
  objectId?: number;
}

export { isSelfCast };

/** The SkillRef of a player cast for bus payloads (castId links its parts; `reprise` marks the reprised copy). */
export function castRef(cast: Cast): SkillRef {
  const sk = cast.skill;
  return { skillId: sk.id, skill: sk, element: sk.element, castId: cast.id, ...(cast.reprise ? { reprise: true } : {}) };
}

/** The player's body radius (px) for separation and every monster hit test (Combat and MonsterSkills share it). */
export { PLAYER_R, distToSegment } from './tellhit';

/** Unique projectile ids for projectileSpawn / projectileEnd (player and monster projectiles share the counter). */
let projectileSeq = 1;
export function nextProjectileId(): number {
  return projectileSeq++;
}

/**
 * Player cast ids, unique for the whole run (a new SkillSystem is built for every map): run-wide listeners such as
 * the quest hooks (one 'use' per cast id) must never see a cast id again after a warp.
 */
let castSeq = 1;

export interface CombatHost {
  world: Phaser.Scene;
  cm: CompiledMap;
  player: Player;
  liveMonsters(): Monster[];
  /** Applies one hit; returns the roll, or null when nothing happened (target already dead). */
  hit(m: Monster, cast: Cast, falloff?: number): DamageRoll | null;
  applyBuff(skill: SkillDef, rank: number): void;
  colorFor(skill: SkillDef): number;
  /** Equipped weapon (strike arc style). */
  weapon(): WeaponType;
  /** False while the player is dead (pending reprises fizzle). */
  canAct(): boolean;
  /** Pooled floating text. */
  float(x: number, y: number, text: string, color: string, size: number): void;
  /** v4: a mend skill heals the player (Combat: heal now or over time; `mend` events). */
  applyMend(cast: Cast): void;
  /** v4: a shield skill raises a shell (Combat: soak pool, `shieldUp` / `shieldHit` / `shieldEnd`). */
  applyShield(cast: Cast): void;
  /** v4: a spot the player may stand on (walkable, not a portal tile): where a blink may land. */
  canStand(x: number, y: number): boolean;
  /** v4: a placed object ended (the class mechanic forgets its object). */
  objectEnded(o: WorldObject, reason: ObjectEndReason): void;
  /** v4: a zone ticked (a zone whose extra is `shield` keeps its shell on the player standing in it). */
  zoneTicked?(o: WorldObject, cast: Cast): void;
}

interface Projectile {
  /** projectileSpawn / projectileEnd id. */
  id: number;
  cast: Cast;
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  traveled: number;
  range: number;
  pierce: number;
  pierceMax: number;
  size: number;
  hitSet: Set<Monster>;
  spin: number;
  rotOffset: number;
  returning: boolean;
}


const DEG = Math.PI / 180;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}


/**
 * Thin line of sight (sampled every 8 px): shots and chasing. pathfinding.lineClear checks a body-sized box, which
 * would refuse a shot whenever either end hugs a wall.
 */
export function clearShot(cm: CompiledMap, x0: number, y0: number, x1: number, y1: number): boolean {
  const n = Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 8);
  for (let i = 1; i < n; i++) {
    const t = i / n;
    if (isBlockedPx(cm, x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
  }
  return true;
}

/** Chain-shaped knife skills render as bouncing knives, not lightning. */
export function isKnifeChain(skill: SkillDef): boolean {
  return skill.shape.kind === 'chain' && (skill.tags.includes('projectile') || skill.tags.includes('pierce'));
}

export class SkillSystem {
  private projectiles: Projectile[] = [];
  /** Everything the player's skills have placed on this map (zones; later traps, summons, walls). */
  readonly objects: WorldObjects;
  /** The cast that placed each live object (its ticks hit through it). */
  private readonly objectCasts = new Map<number, Cast>();

  constructor(private host: CombatHost) {
    this.objects = new WorldObjects((o, reason) => {
      const cast = this.objectCasts.get(o.id);
      this.objectCasts.delete(o.id);
      const sk = cast?.skill ?? o.skill;
      gameBus.emit('objectEnd', { skillId: sk.id, skill: sk, element: sk.element, ...(cast ? { castId: cast.id } : {}), id: o.id, kind: o.kind, obj: o, x: o.x, y: o.y, reason });
      this.host.objectEnded(o, reason);
    });
  }

  /** Reserves a cast id at wind-up (castStart carries it; the cast that fires later reuses it). */
  reserveId(): number {
    return castSeq++;
  }

  newCast(skill: SkillDef, rank: number, origin: { x: number; y: number }, id?: number): Cast {
    return {
      id: id ?? castSeq++,
      skill,
      rank,
      origin: { ...origin },
      tally: { hits: 0 },
      used: { v: false },
      leech: { healed: 0 },
      mult: 1,
      reprise: false,
    };
  }

  /** Range used for auto-targeting this skill. */
  static reach(skill: SkillDef): number {
    const s = skill.shape;
    switch (s.kind) {
      case 'strike':
        return s.range;
      case 'spin':
        return s.radius;
      case 'projectile':
        return s.range;
      case 'dash':
        return s.distance;
      case 'nova':
        return s.range;
      case 'chain':
        return s.range;
      case 'buff':
      case 'mend':
      case 'shield':
        return 0;
      case 'zone':
        return s.line ? Math.max(s.range, s.line.length) : s.range + s.radius;
      case 'blink':
        return s.to === 'self' ? (s.arrive?.radius ?? 0) : s.distance;
    }
  }

  /** Executes a cast (and schedules its reprise rider: the whole cast once more after delayMs at `mult`). */
  execute(cast: Cast, aim: { x: number; y: number }, target: Monster | null): void {
    this.run(cast, aim, target);
    const kind = cast.skill.shape.kind;
    const again = (mult: number, delayMs: number, word: string | null) => {
      const color = this.host.colorFor(cast.skill);
      this.host.world.time.delayedCall(delayMs, () => {
        if (!this.host.canAct()) return;
        const p = this.host.player;
        const t = target && target.alive ? target : null;
        const a = t ? { x: t.x, y: t.y } : { x: p.x + (aim.x - cast.origin.x), y: p.y + (aim.y - cast.origin.y) };
        if (t) p.face(t.x, t.y);
        if (word) this.host.float(p.x, p.y - 66, word, hex(color), 10);
        this.run({ ...cast, origin: { x: p.x, y: p.y }, mult: cast.mult * mult, reprise: true }, a, t);
      });
    };
    // A mechanic's repeat (CastBoost.repeat): the cast lands once more, weaker. Never for things that place or mend.
    if (cast.repeat && !cast.reprise && cast.skill.power > 0 && !SELF_KINDS.has(kind) && kind !== 'zone' && kind !== 'blink') again(cast.repeat, 320, null);
    const rep = cast.skill.riders?.reprise;
    // The caster's mirror ghost is the VFX runtime's (riders.reprise on the reprised copy's first event).
    if (rep && !cast.reprise && !SELF_KINDS.has(kind) && kind !== 'zone' && kind !== 'blink') again(rep.mult, rep.delayMs, 'Reprise');
  }

  private run(cast: Cast, aim: { x: number; y: number }, target: Monster | null): void {
    const { skill } = cast;
    const s = skill.shape;
    const o = cast.origin;
    const ang = Math.atan2(aim.y - o.y, aim.x - o.x);
    const scene = this.host.world;
    // Visuals: the VFX runtime draws every phase from these bus events (src/game/vfx/bridge.ts); this file only
    // times and hit-tests the shapes.
    switch (s.kind) {
      case 'strike': {
        const hits = s.hits ?? 1;
        for (let h = 0; h < hits; h++) {
          scene.time.delayedCall(h * 130, () => {
            const p = this.host.player;
            gameBus.emit('skillPulse', { ...castRef(cast), owner: 'player', index: h, count: hits, ang, aim, x: p.x, y: p.y });
            for (const m of this.host.liveMonsters()) {
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d > s.range + m.radius) continue;
              const a = Math.atan2(m.y - p.y, m.x - p.x);
              if (d > m.radius + 8 && angleDiff(a, ang) > (s.arc * DEG) / 2 + Math.atan2(m.radius, d)) continue;
              this.host.hit(m, { ...cast, origin: { x: p.x, y: p.y } });
            }
          });
        }
        break;
      }
      case 'spin': {
        const pulses = s.pulses ?? 1;
        for (let i = 0; i < pulses; i++) {
          scene.time.delayedCall(i * 170, () => {
            const p = this.host.player;
            gameBus.emit('skillPulse', { ...castRef(cast), owner: 'player', index: i, count: pulses, ang, aim, x: p.x, y: p.y });
            for (const m of this.host.liveMonsters()) {
              if (Math.hypot(m.x - p.x, m.y - p.y) <= s.radius + m.radius)
                this.host.hit(m, { ...cast, origin: { x: p.x, y: p.y } }, i === 0 ? 1 : 0.85);
            }
          });
        }
        this.spinPlayer(pulses * 170 + 100);
        break;
      }
      case 'projectile': {
        const count = s.count ?? 1;
        const spread = (s.spread ?? 0) * DEG;
        // The volley's launch: one pulse for the whole volley.
        gameBus.emit('skillPulse', { ...castRef(cast), owner: 'player', index: 0, count: 1, ang, aim, x: o.x, y: o.y });
        for (let i = 0; i < count; i++) {
          let a = ang;
          if (s.radial) a = ang + (i / count) * Math.PI * 2;
          else if (count > 1) a = ang - spread / 2 + (spread * i) / (count - 1);
          this.spawnProjectile(cast, a, s.speed, s.range, s.pierce ?? 0, s.size ?? 12, i, count);
        }
        break;
      }
      case 'dash':
        this.dash(cast, ang, s.distance, s.width, !!s.spin);
        break;
      case 'nova': {
        const d = Math.min(s.range, Math.hypot(aim.x - o.x, aim.y - o.y));
        const cx = o.x + Math.cos(ang) * d;
        const cy = o.y + Math.sin(ang) * d;
        const delay = s.delay ?? 200;
        // The nova's release toward its landing point.
        gameBus.emit('skillPulse', { ...castRef(cast), owner: 'player', index: 0, count: 1, ang, aim: { x: cx, y: cy }, x: o.x, y: o.y });
        gameBus.emit('novaTelegraph', { ...castRef(cast), owner: 'player', x: cx, y: cy, radius: s.radius, delayMs: delay, timing: { start: scene.time.now, at: scene.time.now + delay } });
        scene.time.delayedCall(delay, () => {
          gameBus.emit('novaBlast', { ...castRef(cast), owner: 'player', x: cx, y: cy, radius: s.radius, heavy: skill.power >= 2 || skill.tags.includes('heavy') });
          for (const m of this.host.liveMonsters()) {
            if (Math.hypot(m.x - cx, m.y - cy) <= s.radius + m.radius) this.host.hit(m, { ...cast, origin: { x: cx, y: cy } });
          }
        });
        break;
      }
      case 'chain':
        this.chain(cast, s.range, s.jumps, ang, target);
        break;
      case 'buff':
        this.host.applyBuff(skill, cast.rank);
        break;
      case 'zone':
        this.placeZone(cast, s, aim, ang);
        break;
      case 'blink':
        this.blink(cast, s, aim, ang, target);
        break;
      case 'mend':
        this.host.applyMend(cast);
        break;
      case 'shield':
        this.host.applyShield(cast);
        break;
    }
  }

  // ------------------------------------------------------------ v4: zone (world objects), blink, burst

  /**
   * Places a zone: a disc at the aim point (at most `range` away; at the feet with range 0), or a lane of
   * `line.length` from the caster toward the aim, `radius` each side. It ticks every `tickMs` (duration ÷ tick
   * ticks, at most 8) and hits every monster standing in it. A class mechanic's object stands for the mechanic's
   * own time (its ticks still end after the zone's duration).
   */
  private placeZone(cast: Cast, s: Extract<SkillShape, { kind: 'zone' }>, aim: Pt, ang: number): WorldObject {
    const o = cast.origin;
    const now = this.host.world.time.now;
    let x = o.x;
    let y = o.y;
    let line: { x0: number; y0: number; x1: number; y1: number } | undefined;
    if (s.line) {
      line = { x0: o.x, y0: o.y, x1: o.x + Math.cos(ang) * s.line.length, y1: o.y + Math.sin(ang) * s.line.length };
      x = (line.x0 + line.x1) / 2;
      y = (line.y0 + line.y1) / 2;
    } else if (s.range > 0) {
      const d = Math.min(s.range, Math.hypot(aim.x - o.x, aim.y - o.y));
      x = o.x + Math.cos(ang) * d;
      y = o.y + Math.sin(ang) * d;
    }
    const ticks = zoneTicks(s.durationMs, s.tickMs);
    const mech = cast.mechObject;
    const lifeMs = mech !== undefined && cast.mechLifeMs !== undefined ? cast.mechLifeMs : s.durationMs;
    const obj = this.objects.add({ kind: 'zone', skill: cast.skill, x, y, radius: s.radius, line, follow: s.follow, lifeMs, tickMs: s.tickMs, ticks: cast.skill.power > 0 ? ticks : 0, ...(mech !== undefined ? { mech } : {}) }, now);
    this.objectCasts.set(obj.id, cast);
    gameBus.emit('objectSpawn', {
      ...castRef(cast),
      owner: 'player',
      id: obj.id,
      kind: 'zone',
      obj,
      x,
      y,
      radius: s.radius,
      ...(line ? { line: { ...line } } : {}),
      follow: !!s.follow,
      durationMs: Number.isFinite(obj.until) ? obj.until - now : Infinity,
      untilMs: obj.until,
      tickMs: s.tickMs,
      ticks,
      ...(mech !== undefined && this.mechName?.() ? { mechanic: this.mechName()! } : {}),
    });
    return obj;
  }

  /**
   * A class object that no zone skill drew (a kit skill of another kind planted it): a bare marker of `radius` at
   * (x, y) that stands for the mechanic's own time and never ticks.
   */
  placeMarker(cast: Cast, x: number, y: number, radius: number): WorldObject {
    const now = this.host.world.time.now;
    const obj = this.objects.add({ kind: 'zone', skill: cast.skill, x, y, radius, lifeMs: cast.mechLifeMs ?? 0, tickMs: 0, ticks: 0, ...(cast.mechObject !== undefined ? { mech: cast.mechObject } : {}) }, now);
    this.objectCasts.set(obj.id, cast);
    gameBus.emit('objectSpawn', { ...castRef(cast), owner: 'player', id: obj.id, kind: 'zone', obj, x, y, radius, follow: false, durationMs: Number.isFinite(obj.until) ? obj.until - now : Infinity, untilMs: obj.until, tickMs: 0, ticks: 0, ...(this.mechName?.() ? { mechanic: this.mechName()! } : {}) });
    return obj;
  }

  /** The worn mechanic's name for objectSpawn.mechanic (set by Combat). */
  mechName?: () => string | null;

  /** One tick of a zone: every monster standing in it takes a hit (the first tick at full power, later ones 85%). */
  private tickObject(o: WorldObject, index: number): void {
    const cast = this.objectCasts.get(o.id);
    if (!cast || !this.host.canAct()) return;
    gameBus.emit('objectTick', { ...castRef(cast), id: o.id, kind: o.kind, obj: o, x: o.x, y: o.y, radius: o.radius, index, ticks: o.ticks + o.ticksLeft });
    for (const m of this.host.liveMonsters()) {
      if (objectCovers(o, m.x, m.y, m.radius)) this.host.hit(m, { ...cast, origin: { x: o.x, y: o.y }, objectId: o.id });
    }
    this.host.zoneTicked?.(o, cast);
  }

  /** Monsters that would stand in a zone of this shape cast now at `aim` (AUTO: 2+ foes). */
  zoneWouldCover(skill: SkillDef, origin: Pt, aim: Pt): number {
    const s = skill.shape;
    if (s.kind !== 'zone') return 0;
    const ang = Math.atan2(aim.y - origin.y, aim.x - origin.x);
    let probe: Pick<WorldObject, 'x' | 'y' | 'radius' | 'line'>;
    if (s.line) probe = { x: origin.x, y: origin.y, radius: s.radius, line: { x0: origin.x, y0: origin.y, x1: origin.x + Math.cos(ang) * s.line.length, y1: origin.y + Math.sin(ang) * s.line.length } };
    else {
      const d = s.range > 0 ? Math.min(s.range, Math.hypot(aim.x - origin.x, aim.y - origin.y)) : 0;
      probe = { x: origin.x + Math.cos(ang) * d, y: origin.y + Math.sin(ang) * d, radius: s.radius };
    }
    let n = 0;
    for (const m of this.host.liveMonsters()) if (objectCovers(probe, m.x, m.y, m.radius)) n++;
    return n;
  }

  /**
   * Blink: the caster vanishes and appears at once — a point ahead (`distance` at most; in front of the target when
   * there is one), next to the target, on one of their own placed objects, or in place. A spot that cannot be stood
   * on is pulled back along the way. `arrive`: everything within that radius of the landing takes a hit.
   */
  private blink(cast: Cast, s: Extract<SkillShape, { kind: 'blink' }>, aim: Pt, ang: number, target: Monster | null): void {
    const p = this.host.player;
    const from = { x: p.x, y: p.y };
    let want = { x: from.x, y: from.y };
    let mode = s.to;
    const ahead = (d: number) => ({ x: from.x + Math.cos(ang) * d, y: from.y + Math.sin(ang) * d });
    if (s.to === 'object') {
      const o = this.objects.nearest(from.x, from.y, s.distance);
      if (o) want = { x: o.x, y: o.y };
      else mode = 'point';
    }
    if (mode === 'target' || mode === 'point') {
      if (target && target.alive) {
        // Land beside the foe, on the caster's side of it (a 'point' blink never passes its target).
        const gap = target.radius + 20;
        const d = Math.hypot(target.x - from.x, target.y - from.y);
        want = ahead(Math.max(0, Math.min(s.distance, d - gap)));
      } else want = ahead(mode === 'point' ? Math.min(s.distance, Math.max(s.distance * 0.5, Math.hypot(aim.x - from.x, aim.y - from.y))) : 0);
    }
    // Pull the landing back toward the caster until it is a spot one can stand on.
    let to = want;
    const span = Math.hypot(want.x - from.x, want.y - from.y);
    if (span > 0 && !this.host.canStand(want.x, want.y)) {
      to = from;
      for (let d = span - 8; d > 0; d -= 8) {
        const q = { x: from.x + ((want.x - from.x) * d) / span, y: from.y + ((want.y - from.y) * d) / span };
        if (this.host.canStand(q.x, q.y)) {
          to = q;
          break;
        }
      }
    }
    p.x = to.x;
    p.y = to.y;
    p.path = [];
    if (target && target.alive) p.face(target.x, target.y);
    const radius = s.arrive && cast.skill.power > 0 ? s.arrive.radius : undefined;
    gameBus.emit('blink', { ...castRef(cast), owner: 'player', from, to: { ...to }, mode, ...(radius !== undefined ? { radius } : {}) });
    if (radius !== undefined) this.burst(cast, to, radius);
  }

  /** One hit on every monster within `radius` of a point (a blink's arrival, a shield's burst). Returns the count. */
  burst(cast: Cast, at: Pt, radius: number): number {
    let n = 0;
    for (const m of this.host.liveMonsters()) {
      if (Math.hypot(m.x - at.x, m.y - at.y) > radius + m.radius) continue;
      this.host.hit(m, { ...cast, origin: { x: at.x, y: at.y } });
      n++;
    }
    return n;
  }

  private chain(cast: Cast, range: number, jumps: number, ang: number, target: Monster | null): void {
    const o = cast.origin;
    const scene = this.host.world;
    const skill = cast.skill;
    const knives = isKnifeChain(skill);
    let first: Monster | null = target && target.alive && Math.hypot(target.x - o.x, target.y - o.y) <= range + target.radius ? target : null;
    if (!first) {
      let best = Infinity;
      for (const m of this.host.liveMonsters()) {
        const dd = Math.hypot(m.x - o.x, m.y - o.y);
        if (dd <= range + m.radius && dd < best) {
          best = dd;
          first = m;
        }
      }
    }
    const start = { x: o.x, y: o.y - 16 };
    if (!first) {
      // No target in reach: the link fizzles 60 % of the way out (drawn by the VFX runtime).
      const end = { x: o.x + Math.cos(ang) * range * 0.6, y: o.y + Math.sin(ang) * range * 0.6 - 16 };
      gameBus.emit('chainLaunch', { ...castRef(cast), owner: 'player', from: start, to: end, index: 0, target: null, knives, flightMs: knives ? 90 : 0 });
      return;
    }
    const chain: Monster[] = [first];
    const nextFrom = (last: Monster): Monster | null => {
      let next: Monster | null = null;
      let best = 150;
      for (const m of this.host.liveMonsters()) {
        if (chain.includes(m)) continue;
        const dd = Math.hypot(m.x - last.x, m.y - last.y);
        if (dd < best) {
          best = dd;
          next = m;
        }
      }
      return next;
    };
    while (chain.length <= jumps) {
      const next = nextFrom(chain[chain.length - 1]);
      if (!next) break;
      chain.push(next);
    }
    // Knives fly one hop per step and hit on arrival; lightning segments appear at the moment each jump lands.
    const step = knives ? 90 : 60;
    let extended = false;
    const strike = (m: Monster, i: number, from: { x: number; y: number }, delay: number) => {
      const to = { x: m.x, y: m.y - 10 };
      scene.time.delayedCall(delay, () => gameBus.emit('chainLaunch', { ...castRef(cast), owner: 'player', from, to, index: i, target: m, knives, flightMs: knives ? step : 0 }));
      scene.time.delayedCall(delay + (knives ? step : 0), () => {
        if (!m.alive) return;
        gameBus.emit('chainHop', { ...castRef(cast), owner: 'player', from, to, index: i, target: m, knives });
        const roll = this.host.hit(m, cast, Math.pow(0.85, i));
        // Conduct: one extra jump on chain shapes (once per cast).
        if (roll?.combo?.extraJump && !extended) {
          extended = true;
          const lastIdx = chain.length - 1;
          const last = chain[lastIdx];
          const extra = nextFrom(last);
          if (extra) {
            chain.push(extra);
            this.host.float(extra.x, extra.y - extra.radius - 26, '+1 jump', '#ffe14a', 11);
            // The extra hop leaves the end of the chain once the chain has reached it.
            strike(extra, lastIdx + 1, { x: last.x, y: last.y - 10 }, (lastIdx - i) * step + (knives ? 0 : step));
          }
        }
      });
    };
    let from = start;
    chain.forEach((m, i) => {
      strike(m, i, from, i * step);
      from = { x: m.x, y: m.y - 10 };
    });
  }

  update(dt: number): void {
    const map = this.host.cm;
    const live = this.host.liveMonsters();
    const p = this.host.player;
    // Placed objects: followers move with the caster, due ticks land, finished ones end.
    if (this.objects.count) {
      for (const o of this.objects.all()) if (o.follow) this.objects.moveTo(o, p.x, p.y);
      this.objects.update(this.host.world.time.now, (o, i) => this.tickObject(o, i));
    }
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      if (pr.returning) {
        // Home back toward the caster.
        const dx = p.x - pr.x;
        const dy = p.y - pr.y;
        const d = Math.hypot(dx, dy) || 1;
        pr.vx = (dx / d) * pr.speed;
        pr.vy = (dy / d) * pr.speed;
      }
      const stepX = pr.vx * dt;
      const stepY = pr.vy * dt;
      pr.x += stepX;
      pr.y += stepY;
      pr.traveled += Math.hypot(stepX, stepY);
      pr.img.setPosition(pr.x, pr.y - 14);
      if (pr.spin) pr.img.rotation += pr.spin * dt * (pr.returning ? 1.6 : 1);
      else pr.img.rotation = Math.atan2(pr.vy, pr.vx) + pr.rotOffset;
      pr.img.setDepth(ySort(pr.y, Y_BIAS.PROJECTILE));
      let dead = false;
      if (pr.returning) {
        dead = Math.hypot(p.x - pr.x, p.y - pr.y) < 18 || pr.traveled > pr.range * 3;
      } else if (pr.traveled >= pr.range || isBlockedPx(map, pr.x, pr.y)) {
        dead = !this.turnBack(pr);
      }
      if (!dead) {
        for (const m of live) {
          if (pr.hitSet.has(m) || !m.alive) continue;
          if (Math.hypot(m.x - pr.x, m.y - pr.y) <= m.radius + pr.size / 2) {
            pr.hitSet.add(m);
            const via = pr.returning ? 'return' : pr.hitSet.size > 1 ? 'pierce' : undefined;
            this.host.hit(m, { ...pr.cast, origin: { x: pr.x - pr.vx * 0.05, y: pr.y - pr.vy * 0.05 }, ...(via ? { via } : {}) });
            if (pr.pierce-- <= 0) {
              dead = !this.turnBack(pr);
              break;
            }
          }
        }
      }
      if (dead) {
        const sk = pr.cast.skill;
        gameBus.emit('projectileEnd', { ...castRef(pr.cast), skillId: sk.id, owner: 'player', obj: pr.img, mover: pr, id: pr.id, x: pr.x, y: pr.y, reason: pr.returning ? 'caught' : pr.traveled >= pr.range ? 'expire' : isBlockedPx(map, pr.x, pr.y) ? 'wall' : 'hit' });
        pr.img.destroy();
        this.projectiles.splice(i, 1);
      }
    }
  }

  /** `returns` rider: the projectile flies back once (hit set cleared once). False if it cannot. */
  private turnBack(pr: Projectile): boolean {
    if (pr.returning || !pr.cast.skill.riders?.returns) return false;
    pr.returning = true;
    pr.hitSet.clear();
    pr.pierce = pr.pierceMax;
    pr.traveled = 0;
    // The turn glint and the tether home are the VFX runtime's (riders.returns, watching `returning`).
    if (!pr.spin) pr.spin = 0;
    return true;
  }

  // ------------------------------------------------------------ helpers

  private spawnProjectile(cast: Cast, a: number, speed: number, range: number, pierce: number, size: number, index = 0, count = 1) {
    // The projectile's Image is its identity on the bus (projectileSpawn.obj); the VFX runtime draws the body and
    // trails, so the Image itself stays invisible.
    const img = this.host.world.add
      .image(cast.origin.x, cast.origin.y - 14, '__DEFAULT')
      .setVisible(false)
      .setDepth(ySort(cast.origin.y, Y_BIAS.PROJECTILE));
    img.rotation = a;
    const pr: Projectile = {
      id: nextProjectileId(),
      cast,
      img,
      x: cast.origin.x,
      y: cast.origin.y,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      speed,
      traveled: 0,
      range,
      pierce,
      pierceMax: pierce,
      size,
      hitSet: new Set(),
      spin: 0,
      rotOffset: 0,
      returning: false,
    };
    this.projectiles.push(pr);
    gameBus.emit('projectileSpawn', { ...castRef(cast), owner: 'player', obj: img, mover: pr, id: pr.id, index, count, x: cast.origin.x, y: cast.origin.y, angle: a, speed, range, size });
  }

  private dash(cast: Cast, ang: number, distance: number, width: number, spin: boolean) {
    const p = this.host.player;
    const sx = p.x;
    const sy = p.y;
    let ex = sx;
    let ey = sy;
    for (let d = 8; d <= distance; d += 8) {
      const nx = sx + Math.cos(ang) * d;
      const ny = sy + Math.sin(ang) * d;
      if (isBlockedPx(this.host.cm, nx, ny)) break;
      ex = nx;
      ey = ny;
    }
    const scene = this.host.world;
    const dur = 170;
    gameBus.emit('dash', { ...castRef(cast), owner: 'player', from: { x: sx, y: sy }, to: { x: ex, y: ey }, durationMs: dur, width, spin });
    p.path = [];
    p.lockedUntil = scene.time.now + dur + 30;
    // Afterimages, dust and the element trail along the lane are the VFX runtime's (dash event).
    scene.tweens.addCounter({
      from: 0,
      to: 1,
      duration: dur,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        p.x = sx + (ex - sx) * t;
        p.y = sy + (ey - sy) * t;
      },
    });
    if (spin) this.spinPlayer(dur + 80);
    if (width <= 0 || cast.skill.power <= 0) return;
    scene.time.delayedCall(dur * 0.6, () => {
      for (const m of this.host.liveMonsters()) {
        if (distToSegment(m.x, m.y, sx, sy, ex, ey) <= width / 2 + m.radius) this.host.hit(m, { ...cast, origin: { x: sx, y: sy } });
      }
    });
  }

  private spinPlayer(ms: number) {
    const p = this.host.player;
    const scene = this.host.world;
    let flips = 0;
    const ev = scene.time.addEvent({
      delay: 60,
      repeat: Math.max(1, Math.floor(ms / 60)),
      callback: () => {
        p.facing *= -1;
        flips++;
      },
    });
    scene.time.delayedCall(ms + 20, () => {
      ev.remove();
      if (flips % 2 === 1) p.facing *= -1;
    });
  }

  // ------------------------------------------------------------ legacy fx adapters

  /**
   * Thin adapters onto the VFX runtime (docs/VFX.md §8.7) for the few callers outside the VFX path (MapScene's
   * portal reveal and blink): a magic burst / a ground ring in the nearest family. Nothing here draws by itself.
   */
  fxBurst(x: number, y: number, color: number, n: number): void {
    (this.host.world as unknown as { vfx?: { world: { legacyBurst(x: number, y: number, c: number, n: number): void } } }).vfx?.world.legacyBurst(x, y, color, n);
  }

  fxRing(x: number, y: number, radius: number, color: number, _blades = false): void {
    (this.host.world as unknown as { vfx?: { world: { legacyRing(x: number, y: number, r: number, c: number): void } } }).vfx?.world.legacyRing(x, y, radius, color);
  }

  /** The world was frozen for `ms` (panel pause, hit-stop): placed objects resume where they were. */
  shiftTime(ms: number): void {
    this.objects.shiftTime(ms);
  }

  clear(): void {
    for (const p of this.projectiles) p.img.destroy();
    this.projectiles = [];
    this.objects.clear();
  }
}
