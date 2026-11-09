// Shape FX, hit tests, projectiles and riders (docs/CLIENT-v2.md §6): turns SkillDef shapes into on-screen
// effects and calls the host for every hit. Damage, statuses and XP live in Combat.ts.
//
// Riders implemented here: `returns` (projectiles fly back once, hit set cleared once, with a tether / glint on the
// way home) and `reprise` (the whole cast re-executes once after delayMs at `mult`, shown by a ghost of the caster).
// `arc`, `leech` and `knockback` are per-hit and live in Combat.hit (their FX helpers are here).
// Chain shapes tagged projectile/pierce render as bouncing knives (blades when tagged blade), not lightning.
//
// FX use the art team's fx_* textures plus a few client-generated `cfx_*` motes (flame, drop, rock, shard, spark,
// streak, knife, feather, thorn, bubble, ray, cracked-star rune) so each element reads differently.
import Phaser from 'phaser';
import type { DamageRoll } from '../../core/combat';
import type { ElementId, SkillDef, WeaponType } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { CompiledMap } from '../../core/world/types';
import type { Monster } from '../entities/Monster';
import type { Player } from '../entities/Player';
import { gameBus, type Pt, type SkillRef } from '../events';
import { DEPTH, Y_BIAS, ySort } from '../render/depths';

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
}

/** The SkillRef of a player cast for bus payloads (castId links its parts; `reprise` marks the reprised copy). */
export function castRef(cast: Cast): SkillRef {
  const sk = cast.skill;
  return { skillId: sk.id, skill: sk, element: sk.element, castId: cast.id, ...(cast.reprise ? { reprise: true } : {}) };
}

/** The player's body radius (px) for separation and every monster hit test (Combat and MonsterSkills share it). */
export const PLAYER_R = 12;

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

/** How a projectile looks: texture, scale, spin (rad/s), additive or not, rotation offset. */
export interface ProjectileLook {
  key: string;
  scale: number;
  spin: number;
  add: boolean;
}

export type StrikeStyle = 'sword' | 'dagger' | 'staff' | 'cone' | 'claw';

const DEG = Math.PI / 180;
const ADD = Phaser.BlendModes.ADD;
const NORMAL = Phaser.BlendModes.NORMAL;
/** Particle budget (mid phones): extra motes are skipped beyond this. */
const MAX_PARTICLES = 240;

export const hex = (c: number): string => `#${c.toString(16).padStart(6, '0')}`;

function angleDiff(a: number, b: number): number {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return Math.abs(d);
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
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

// ------------------------------------------------------------------ client FX textures

export const CFX = {
  flame: 'cfx_flame',
  drop: 'cfx_drop',
  rock: 'cfx_rock',
  shard: 'cfx_shard',
  spark: 'cfx_spark',
  streak: 'cfx_streak',
  star: 'cfx_star',
  knife: 'cfx_knife',
  ray: 'cfx_ray',
  bubble: 'cfx_bubble',
  feather: 'cfx_feather',
  thorn: 'cfx_thorn',
} as const;

function canvasTex(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: CanvasRenderingContext2D) => void): void {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  draw(tex.getContext());
  tex.refresh();
}

function path(c: CanvasRenderingContext2D, pts: number[], fill: string | CanvasGradient): void {
  c.beginPath();
  c.moveTo(pts[0], pts[1]);
  for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
  c.closePath();
  c.fillStyle = fill;
  c.fill();
}

/** Generates the client FX motes once per game (idempotent per key). All white so they tint per element. */
export function ensureFxTextures(scene: Phaser.Scene): void {
  canvasTex(scene, CFX.flame, 12, 16, (c) => {
    const g = c.createRadialGradient(6, 11, 0, 6, 11, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.55, 'rgba(255,255,255,0.75)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(6, 0);
    c.quadraticCurveTo(11.5, 7, 10.5, 11);
    c.arc(6, 11, 4.6, 0.1, Math.PI - 0.1);
    c.quadraticCurveTo(0.5, 7, 6, 0);
    c.fill();
  });
  canvasTex(scene, CFX.drop, 8, 11, (c) => {
    c.fillStyle = 'rgba(255,255,255,0.95)';
    c.beginPath();
    c.moveTo(4, 0);
    c.quadraticCurveTo(8, 5, 7.5, 7.5);
    c.arc(4, 7.5, 3.5, 0, Math.PI);
    c.quadraticCurveTo(0, 5, 4, 0);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,1)';
    c.fillRect(2.5, 6, 1.5, 2);
  });
  canvasTex(scene, CFX.rock, 9, 8, (c) => {
    path(c, [1, 3, 4, 0, 8, 2, 9, 6, 5, 8, 1, 7], '#ffffff');
    path(c, [1, 7, 5, 8, 9, 6, 8, 4.5, 4.5, 5.5, 1, 5], 'rgba(0,0,0,0.35)');
  });
  canvasTex(scene, CFX.shard, 14, 6, (c) => {
    path(c, [0, 3, 5, 0, 14, 3, 5, 6], 'rgba(255,255,255,0.9)');
    path(c, [3, 3, 6, 1.4, 12, 3, 6, 4.2], '#ffffff');
  });
  canvasTex(scene, CFX.spark, 12, 12, (c) => {
    path(c, [6, 0, 7, 5, 12, 6, 7, 7, 6, 12, 5, 7, 0, 6, 5, 5], '#ffffff');
    const g = c.createRadialGradient(6, 6, 0, 6, 6, 4);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(2, 2, 8, 8);
  });
  canvasTex(scene, CFX.streak, 16, 6, (c) => {
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 2;
    c.lineCap = 'round';
    c.beginPath();
    c.arc(8, 14, 12, -Math.PI * 0.78, -Math.PI * 0.22);
    c.stroke();
  });
  canvasTex(scene, CFX.knife, 22, 8, (c) => {
    // Handle (dark, stays dark under tint), gold guard, bright blade pointing +x.
    c.fillStyle = '#4a2e1a';
    c.fillRect(0, 3, 6, 2);
    c.fillStyle = '#d8b04a';
    c.fillRect(6, 1, 2, 6);
    path(c, [8, 2, 19, 3, 22, 4, 19, 5, 8, 6], '#ffffff');
    path(c, [8, 4, 22, 4, 19, 5, 8, 6], 'rgba(150,170,200,0.55)');
  });
  canvasTex(scene, CFX.ray, 64, 6, (c) => {
    const g = c.createLinearGradient(0, 0, 64, 0);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.6, 'rgba(255,255,255,0.5)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    path(c, [0, 1, 64, 3, 0, 5], g);
  });
  canvasTex(scene, CFX.bubble, 16, 16, (c) => {
    c.fillStyle = 'rgba(255,255,255,0.22)';
    c.beginPath();
    c.arc(8, 8, 7, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 1.5;
    c.stroke();
    c.fillStyle = '#ffffff';
    c.fillRect(4, 4, 2.5, 2.5);
  });
  canvasTex(scene, CFX.feather, 16, 6, (c) => {
    path(c, [0, 3, 4, 0.5, 12, 1, 16, 3, 12, 5, 4, 5.5], 'rgba(255,255,255,0.95)');
    c.strokeStyle = 'rgba(0,0,0,0.3)';
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(1, 3);
    c.lineTo(15, 3);
    c.stroke();
  });
  canvasTex(scene, CFX.thorn, 14, 6, (c) => {
    path(c, [0, 1, 6, 1.5, 14, 3, 6, 4.5, 0, 5], '#ffffff');
    path(c, [0, 3, 14, 3, 6, 4.5, 0, 5], 'rgba(0,0,0,0.3)');
  });
  canvasTex(scene, CFX.star, 64, 64, (c) => {
    // Cracked-star rune (the spark moment): eight-point star, inner ring, a crack running through it.
    const cx = 32;
    const cy = 32;
    const pts: number[] = [];
    for (let i = 0; i < 16; i++) {
      const r = i % 2 === 0 ? 30 : 12;
      const a = -Math.PI / 2 + (i / 16) * Math.PI * 2;
      pts.push(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    }
    const g = c.createRadialGradient(cx, cy, 0, cx, cy, 30);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0.35)');
    path(c, pts, g);
    c.strokeStyle = 'rgba(255,255,255,1)';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(cx, cy, 16, 0, Math.PI * 2);
    c.stroke();
    c.strokeStyle = 'rgba(40,20,0,0.85)';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(18, 6);
    c.lineTo(27, 22);
    c.lineTo(23, 30);
    c.lineTo(36, 38);
    c.lineTo(33, 46);
    c.lineTo(44, 60);
    c.stroke();
  });
}

// ------------------------------------------------------------------ element styles

type Motion = 'rise' | 'fall' | 'swirl' | 'jitter' | 'drift' | 'sink';

export interface FxStyle {
  tex: string;
  add: boolean;
  motion: Motion;
  /** Secondary colour (cores, glints). */
  accent: number;
  scale: number;
}

const PLAIN: FxStyle = { tex: 'fx_dot', add: true, motion: 'drift', accent: 0xffffff, scale: 0.55 };

const STYLES: Record<ElementId, FxStyle> = {
  fire: { tex: CFX.flame, add: true, motion: 'rise', accent: 0xffd27a, scale: 0.9 },
  magma: { tex: CFX.rock, add: false, motion: 'fall', accent: 0xffa040, scale: 0.9 },
  water: { tex: CFX.drop, add: false, motion: 'fall', accent: 0xe0f4ff, scale: 0.9 },
  earth: { tex: CFX.rock, add: false, motion: 'fall', accent: 0xf0dcb0, scale: 0.9 },
  wind: { tex: CFX.streak, add: true, motion: 'swirl', accent: 0xf0fff8, scale: 0.9 },
  lightning: { tex: CFX.spark, add: true, motion: 'jitter', accent: 0xffffff, scale: 0.85 },
  shadow: { tex: 'fx_dot', add: false, motion: 'sink', accent: 0xd8c0ff, scale: 0.7 },
  holy: { tex: CFX.spark, add: true, motion: 'rise', accent: 0xffffff, scale: 0.8 },
  ice: { tex: CFX.shard, add: true, motion: 'fall', accent: 0xffffff, scale: 0.8 },
  storm: { tex: CFX.spark, add: true, motion: 'swirl', accent: 0xe0ecff, scale: 0.85 },
  twilight: { tex: CFX.spark, add: true, motion: 'drift', accent: 0xffe0a0, scale: 0.8 },
};

export function fxStyle(el?: ElementId): FxStyle {
  return el ? STYLES[el] : PLAIN;
}

interface PartOpts {
  tex?: string;
  add?: boolean;
  easeY?: string;
  rot?: number;
  spin?: number;
  endScale?: number;
  depth?: number;
  delay?: number;
}

export class SkillSystem {
  private projectiles: Projectile[] = [];
  private pool: Phaser.GameObjects.Image[] = [];
  private live = 0;

  constructor(private host: CombatHost) {
    ensureFxTextures(host.world);
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
        return 0;
    }
  }

  /** Executes a cast (and schedules its reprise rider: the whole cast once more after delayMs at `mult`). */
  execute(cast: Cast, aim: { x: number; y: number }, target: Monster | null): void {
    this.run(cast, aim, target);
    const rep = cast.skill.riders?.reprise;
    if (rep && !cast.reprise && cast.skill.shape.kind !== 'buff') {
      const color = this.host.colorFor(cast.skill);
      this.host.world.time.delayedCall(rep.delayMs, () => {
        if (!this.host.canAct()) return;
        const p = this.host.player;
        const t = target && target.alive ? target : null;
        const a = t ? { x: t.x, y: t.y } : { x: p.x + (aim.x - cast.origin.x), y: p.y + (aim.y - cast.origin.y) };
        if (t) p.face(t.x, t.y);
        // The caster's mirror ghost is the VFX runtime's (riders.reprise on the reprised copy's first event).
        this.host.float(p.x, p.y - 66, 'Reprise', hex(color), 10);
        this.run({ ...cast, origin: { x: p.x, y: p.y }, mult: cast.mult * rep.mult, reprise: true }, a, t);
      });
    }
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
    }
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

  /** Projectile art: blades spin, knives/thorns/feathers/shards point along the flight, magic flies as orbs. */
  lookFor(skill: SkillDef, size: number): ProjectileLook {
    const tags = skill.tags;
    const el = skill.element;
    if (tags.includes('blade') && !tags.includes('arcane')) return { key: 'fx_blade', scale: size / 14, spin: 18, add: false };
    if (tags.includes('pierce') && !tags.includes('arcane')) return { key: CFX.knife, scale: size / 13, spin: 0, add: false };
    if (el === 'ice') return { key: CFX.shard, scale: size / 8, spin: 0, add: true };
    if (el === 'wind' && tags.includes('echo')) return { key: CFX.feather, scale: size / 8, spin: 0, add: false };
    if (el === 'earth' || el === 'magma') return { key: el === 'earth' ? CFX.rock : 'fx_orb', scale: el === 'earth' ? size / 6 : size / 14, spin: el === 'earth' ? 10 : 0, add: el !== 'earth' };
    if (el === 'water' && size >= 14) return { key: CFX.bubble, scale: size / 13, spin: 0, add: false };
    if (!el && skill.status === 'bleed') return { key: CFX.thorn, scale: size / 7, spin: 0, add: false };
    return { key: 'fx_orb', scale: size / 16, spin: 0, add: true };
  }

  /** One trail mote behind a projectile (element styled). */
  trail(x: number, y: number, skill: SkillDef, color: number, size: number): void {
    const st = fxStyle(skill.element);
    const s = Math.max(0.35, size / 22);
    if (!skill.element) {
      this.particle(x, y, color, 0, 0, 200, size / 20);
      return;
    }
    switch (st.motion) {
      case 'rise':
        this.particle(x, y, color, (Math.random() - 0.5) * 20, -30, 300, s * st.scale, { tex: st.tex, add: st.add });
        break;
      case 'fall':
        this.particle(x, y, Math.random() < 0.3 ? st.accent : color, (Math.random() - 0.5) * 20, 26, 260, s * st.scale, {
          tex: st.tex,
          add: st.add,
          rot: Math.random() * Math.PI,
        });
        break;
      case 'jitter':
        this.particle(x + (Math.random() - 0.5) * 10, y + (Math.random() - 0.5) * 10, Math.random() < 0.5 ? st.accent : color, 0, 0, 140, s * st.scale, {
          tex: st.tex,
          add: true,
          rot: Math.random() * Math.PI,
        });
        break;
      case 'sink':
        this.particle(x, y, 0x2a1640, 0, 10, 320, s * 1.1, { add: false });
        this.particle(x, y, color, 0, 0, 200, s * 0.7);
        break;
      default:
        this.particle(x, y, color, 0, 0, 220, s * st.scale, { tex: st.tex, add: st.add, rot: Math.random() * Math.PI });
    }
  }

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

  /** Strike arc style: weapon-specific for the player, claws for monsters, cones for elemental breaths. */
  strikeStyle(skill: SkillDef, monster: boolean): StrikeStyle {
    const tags = skill.tags;
    if (tags.includes('aoe') && skill.element && !tags.includes('melee')) return 'cone';
    if (monster || tags.includes('monster')) return 'claw';
    if (tags.includes('arcane')) return 'staff';
    const w = skill.weapons?.length === 1 ? skill.weapons[0] : this.host.weapon();
    return w === 'dagger' ? 'dagger' : w === 'staff' ? 'staff' : 'sword';
  }

  // ------------------------------------------------------------ particles

  particle(x: number, y: number, color: number, vx: number, vy: number, life: number, scale = 0.6, o: PartOpts = {}): void {
    if (this.live >= MAX_PARTICLES) return;
    const scene = this.host.world;
    const tex = o.tex ?? 'fx_dot';
    let img = this.pool.pop();
    if (img && img.active) img.setTexture(tex).setVisible(true);
    else img = scene.add.image(x, y, tex);
    const rot = o.rot ?? 0;
    img
      .setPosition(x, y)
      .setTint(color)
      .setScale(scale)
      .setAlpha(1)
      .setRotation(rot)
      .setBlendMode(o.add === false ? NORMAL : ADD)
      .setDepth(o.depth ?? ySort(y, Y_BIAS.PARTICLE));
    if (o.delay) img.setVisible(false);
    this.live++;
    const target = img;
    scene.tweens.add({
      targets: target,
      x: x + (vx * life) / 1000,
      y: { value: y + (vy * life) / 1000, ease: o.easeY ?? 'Linear' },
      alpha: 0,
      scale: scale * (o.endScale ?? 0.3),
      rotation: rot + (o.spin ?? 0),
      duration: life,
      delay: o.delay ?? 0,
      onStart: () => target.setVisible(true),
      onComplete: () => {
        this.live--;
        if (target.active) {
          target.setVisible(false);
          if (this.pool.length < 300) this.pool.push(target);
          else target.destroy();
        }
      },
    });
  }

  /** One element-styled mote at (x, y). `power` scales speed and size. */
  mote(x: number, y: number, color: number, st: FxStyle, power = 1, delay = 0): void {
    const sc = st.scale * (0.7 + Math.random() * 0.5) * power;
    const tint = Math.random() < 0.3 ? st.accent : color;
    const a = Math.random() * Math.PI * 2;
    const o: PartOpts = { tex: st.tex, add: st.add, delay };
    switch (st.motion) {
      case 'rise':
        this.particle(x + (Math.random() - 0.5) * 12, y, tint, Math.cos(a) * 25 * power, -(50 + Math.random() * 50) * power, 420 + Math.random() * 220, sc, {
          ...o,
          easeY: 'Quad.out',
        });
        break;
      case 'fall': {
        const sp = (50 + Math.random() * 70) * power;
        this.particle(x, y, tint, Math.cos(a) * sp, 40 + Math.random() * 50, 380 + Math.random() * 200, sc, {
          ...o,
          easeY: 'Back.in',
          rot: Math.random() * Math.PI,
          spin: (Math.random() - 0.5) * 6,
          endScale: 0.6,
        });
        break;
      }
      case 'swirl':
        this.particle(x, y, tint, Math.cos(a) * 70 * power, Math.sin(a) * 40 * power - 20, 360 + Math.random() * 160, sc, {
          ...o,
          rot: a + Math.PI / 2,
          spin: 4,
          endScale: 0.8,
        });
        break;
      case 'jitter':
        this.particle(x + Math.cos(a) * 14 * power, y + Math.sin(a) * 10 * power, tint, 0, 0, 120 + Math.random() * 140, sc, {
          ...o,
          rot: Math.random() * Math.PI,
          endScale: 1.4,
        });
        break;
      case 'sink':
        this.particle(x + Math.cos(a) * 10, y, 0x2a1640, Math.cos(a) * 20, 18, 460, sc * 1.4, { ...o, add: false, endScale: 1.2 });
        this.particle(x, y, tint, Math.cos(a) * 40 * power, Math.sin(a) * 30 * power, 340, sc, { ...o, add: true });
        break;
      default:
        this.particle(x, y, tint, Math.cos(a) * 45 * power, Math.sin(a) * 30 * power - 12, 420 + Math.random() * 200, sc, o);
    }
  }

  fxBurst(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      this.particle(x, y, color, Math.cos(a) * sp, Math.sin(a) * sp, 300 + Math.random() * 200);
    }
  }

  /** A soft additive flash disc (crits, glints, turn points). */
  fxFlash(x: number, y: number, r: number, color: number) {
    const scene = this.host.world;
    const img = scene.add.image(x, y, 'fx_orb').setTint(color).setBlendMode(ADD).setDepth(DEPTH.FX_GLOW).setScale((r * 2) / 32);
    scene.tweens.add({ targets: img, scale: (r * 3.2) / 32, alpha: 0, duration: 180, onComplete: () => img.destroy() });
  }

  fxImpactAt(x: number, y: number, skill: SkillDef, color: number, n: number): void {
    const st = fxStyle(skill.element);
    for (let i = 0; i < n; i++) this.mote(x, y, color, st, 1);
    const tags = skill.tags;
    if (!skill.element && (tags.includes('blade') || tags.includes('pierce'))) {
      this.particle(x, y, 0xffffff, 0, 0, 160, 1.1, { tex: CFX.spark, rot: Math.random(), endScale: 0.2 });
    }
    if (tags.includes('heavy')) this.fxDust(x, y + 10);
  }

  /** Low dust puff (heavy hits, knockback, dashes landing). */
  fxDust(x: number, y: number) {
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.particle(x + Math.cos(a) * 6, y, 0xc8b8a0, Math.cos(a) * 60, Math.sin(a) * 18 - 8, 380, 0.9, { add: false, endScale: 1.6 });
    }
  }

  // ------------------------------------------------------------ shapes

  fxStrike(x: number, y: number, ang: number, arc: number, range: number, color: number, flip: boolean, style: StrikeStyle, el?: ElementId) {
    const scene = this.host.world;
    const g = scene.add.graphics({ x, y }).setDepth(ySort(y, Y_BIAS.ARC)).setBlendMode(ADD);
    const r = range * 0.75;
    let dur = 200;
    switch (style) {
      case 'sword': {
        g.lineStyle(16, color, 0.16);
        g.beginPath();
        g.arc(0, 0, r - 6, ang - arc / 2, ang + arc / 2, flip);
        g.strokePath();
        g.lineStyle(7, color, 0.9);
        g.beginPath();
        g.arc(0, 0, r, ang - arc / 2, ang + arc / 2, flip);
        g.strokePath();
        g.lineStyle(2, 0xffffff, 0.9);
        g.beginPath();
        g.arc(0, 0, r + 3, ang - arc / 2.4, ang + arc / 2.4, flip);
        g.strokePath();
        break;
      }
      case 'dagger': {
        // Two quick crossing cuts at the point of the stab.
        const px = Math.cos(ang) * range * 0.55;
        const py = Math.sin(ang) * range * 0.55;
        const L = Math.max(16, range * 0.45);
        const tilt = flip ? 0.35 : 0;
        for (const da of [Math.PI / 4 + tilt, -Math.PI / 4 + tilt]) {
          const a = ang + da;
          const dx = Math.cos(a) * L * 0.5;
          const dy = Math.sin(a) * L * 0.5;
          g.lineStyle(6, color, 0.5).lineBetween(px - dx, py - dy, px + dx, py + dy);
          g.lineStyle(2, 0xffffff, 1).lineBetween(px - dx, py - dy, px + dx, py + dy);
        }
        g.lineStyle(2, color, 0.7).lineBetween(Math.cos(ang) * 10, Math.sin(ang) * 10, px, py);
        dur = 150;
        break;
      }
      case 'staff': {
        // Arcane bash: a short glowing arc and a rune-ring shock at the point of impact.
        g.lineStyle(10, color, 0.35);
        g.beginPath();
        g.arc(0, 0, r * 0.8, ang - arc / 3, ang + arc / 3, flip);
        g.strokePath();
        g.lineStyle(2, 0xffffff, 0.9);
        g.beginPath();
        g.arc(0, 0, r * 0.8, ang - arc / 4, ang + arc / 4, flip);
        g.strokePath();
        const px = Math.cos(ang) * r;
        const py = Math.sin(ang) * r;
        g.lineStyle(2, color, 0.9).strokeCircle(px, py, 12);
        for (let i = 0; i < 4; i++) {
          const a = (i / 4) * Math.PI * 2 + 0.4;
          g.fillStyle(0xffffff, 0.9).fillCircle(px + Math.cos(a) * 12, py + Math.sin(a) * 12, 1.8);
        }
        break;
      }
      case 'cone': {
        // Elemental breath: a soft filled cone with motes streaming out of it.
        for (let k = 1; k <= 3; k++) {
          g.fillStyle(color, 0.22 / k);
          g.slice(0, 0, (range * k) / 3 + 6, ang - arc / 2, ang + arc / 2, false);
          g.fillPath();
        }
        g.lineStyle(2, 0xffffff, 0.5);
        g.beginPath();
        g.arc(0, 0, range, ang - arc / 2, ang + arc / 2, false);
        g.strokePath();
        const st = fxStyle(el);
        for (let i = 0; i < 8; i++) {
          const a = ang + (Math.random() - 0.5) * arc;
          const d = range * (0.3 + Math.random() * 0.6);
          this.particle(x + Math.cos(a) * 10, y + Math.sin(a) * 10, color, (Math.cos(a) * d) / 0.3, (Math.sin(a) * d) / 0.3, 300, 0.7 * st.scale, {
            tex: st.tex,
            add: st.add,
            rot: a,
            endScale: 1.2,
          });
        }
        dur = 280;
        break;
      }
      case 'claw': {
        // Three parallel rakes.
        for (let k = 0; k < 3; k++) {
          const rr = r * (0.55 + k * 0.17);
          g.lineStyle(5, color, 0.55);
          g.beginPath();
          g.arc(0, 0, rr, ang - arc * 0.3, ang + arc * 0.3, flip);
          g.strokePath();
          g.lineStyle(2, 0xffffff, 0.9);
          g.beginPath();
          g.arc(0, 0, rr, ang - arc * 0.26, ang + arc * 0.26, flip);
          g.strokePath();
        }
        break;
      }
    }
    g.setScale(style === 'cone' ? 0.85 : 0.7);
    scene.tweens.add({ targets: g, scale: style === 'cone' ? 1 : 1.1, alpha: 0, duration: dur, onComplete: () => g.destroy() });
  }

  fxRing(x: number, y: number, radius: number, color: number, blades: boolean) {
    const scene = this.host.world;
    const g = scene.add.graphics({ x, y }).setDepth(ySort(y, Y_BIAS.ARC)).setBlendMode(ADD);
    g.fillStyle(color, 0.16);
    g.fillEllipse(0, 0, radius * 2, radius * 1.3);
    g.lineStyle(3, color, 0.9);
    g.strokeEllipse(0, 0, radius * 2, radius * 1.3);
    if (blades) {
      g.lineStyle(5, 0xffffff, 0.8);
      for (let i = 0; i < 3; i++) {
        const a = (i / 3) * Math.PI * 2;
        g.beginPath();
        g.arc(0, 0, radius * 0.8, a, a + 0.9);
        g.strokePath();
      }
    }
    g.setScale(0.35);
    scene.tweens.add({
      targets: g,
      scale: 1,
      alpha: 0,
      rotation: blades ? Math.PI : 0,
      duration: 260,
      onComplete: () => g.destroy(),
    });
  }

  /** Spin pulse: bladed ring plus element motes around the rim. */
  fxSpin(x: number, y: number, radius: number, color: number, el?: ElementId) {
    this.fxRing(x, y, radius, color, true);
    if (!el) return;
    const st = fxStyle(el);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.random() * 0.4;
      this.mote(x + Math.cos(a) * radius * 0.85, y + Math.sin(a) * radius * 0.55, color, st, 0.8);
    }
  }

  /** Nova landing: ring + burst, plus an element signature (sky bolt, flame column, splash, rubble, shards...). */
  fxNova(cx: number, cy: number, r: number, color: number, el: ElementId | undefined, heavy: boolean) {
    this.fxRing(cx, cy, r, color, false);
    const st = fxStyle(el);
    const n = Math.min(18, 8 + Math.round(r / 10));
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * r * 0.8;
      this.mote(cx + Math.cos(a) * d, cy + Math.sin(a) * d * 0.6, color, st, 1);
    }
    switch (el) {
      case 'lightning':
      case 'storm':
        this.fxBolt(cx, cy, color);
        break;
      case 'holy': {
        const scene = this.host.world;
        const pillar = scene.add.image(cx, cy - 60, 'fx_orb').setTint(color).setBlendMode(ADD).setDepth(ySort(cy, Y_BIAS.PILLAR)).setScale(r / 22, 140 / 32).setAlpha(0.9);
        scene.tweens.add({ targets: pillar, scaleX: 0.2, alpha: 0, duration: 380, onComplete: () => pillar.destroy() });
        break;
      }
      case 'earth':
      case 'magma':
        this.fxCracks(cx, cy, r, el === 'magma' ? 0xff6a20 : 0x6a4a2a);
        break;
      default:
        break;
    }
    if (heavy) this.fxDust(cx, cy);
  }

  /** Ground cracks radiating from an impact (earth/magma novas). */
  private fxCracks(cx: number, cy: number, r: number, color: number) {
    const scene = this.host.world;
    const g = scene.add.graphics().setDepth(DEPTH.FX_GROUND);
    g.lineStyle(2, color, 0.9);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + Math.random() * 0.5;
      g.beginPath();
      g.moveTo(cx, cy);
      let x = cx;
      let y = cy;
      for (let k = 1; k <= 3; k++) {
        x = cx + Math.cos(a + (Math.random() - 0.5) * 0.5) * r * 0.28 * k;
        y = cy + Math.sin(a + (Math.random() - 0.5) * 0.5) * r * 0.18 * k;
        g.lineTo(x, y);
      }
      g.strokePath();
    }
    scene.tweens.add({ targets: g, alpha: 0, delay: 250, duration: 500, onComplete: () => g.destroy() });
  }

  /** A bolt from the sky onto (x, y). */
  fxBolt(x: number, y: number, color: number) {
    const pts: { x: number; y: number }[] = [];
    const top = y - 240;
    for (let i = 0; i <= 6; i++) {
      const t = i / 6;
      pts.push({ x: x + (i === 0 || i === 6 ? 0 : (Math.random() - 0.5) * 30), y: top + (y - top) * t });
    }
    this.fxLightning(pts, color, 1.4);
    this.fxFlash(x, y - 6, 26, 0xffffff);
  }

  /** Jagged lightning through `pts`, with a few short forks. `weight` scales the stroke. */
  fxLightning(pts: { x: number; y: number }[], color: number, weight = 1) {
    const scene = this.host.world;
    const g = scene.add.graphics().setDepth(DEPTH.FX_GLOW).setBlendMode(ADD);
    const forks: [number, number, number, number][] = [];
    const nodes: { x: number; y: number }[] = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a0 = pts[i - 1];
      const a1 = pts[i];
      const segs = 5;
      for (let k = 1; k <= segs; k++) {
        const t = k / segs;
        const jitter = k === segs ? 0 : (Math.random() - 0.5) * 18;
        const n = { x: a0.x + (a1.x - a0.x) * t + jitter, y: a0.y + (a1.y - a0.y) * t + jitter };
        nodes.push(n);
        if (k < segs && Math.random() < 0.22 * weight) {
          const fa = Math.atan2(a1.y - a0.y, a1.x - a0.x) + (Math.random() < 0.5 ? 0.8 : -0.8);
          const fl = 10 + Math.random() * 14;
          forks.push([n.x, n.y, n.x + Math.cos(fa) * fl, n.y + Math.sin(fa) * fl]);
        }
      }
    }
    const draw = (w: number, c: number, a: number) => {
      g.lineStyle(w * weight, c, a);
      g.beginPath();
      g.moveTo(nodes[0].x, nodes[0].y);
      for (let i = 1; i < nodes.length; i++) g.lineTo(nodes[i].x, nodes[i].y);
      g.strokePath();
      for (const [x0, y0, x1, y1] of forks) g.lineBetween(x0, y0, x1, y1);
    };
    draw(5, color, 0.6);
    draw(2, 0xffffff, 1);
    scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
    for (const p of pts.slice(1)) this.fxBurst(p.x, p.y, color, weight < 1 ? 2 : 4);
  }

  /** Shatter combo: ice bursts into shards. */
  fxShatter(x: number, y: number, r: number) {
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2 + Math.random() * 0.3;
      const sp = 90 + Math.random() * 90;
      this.particle(x, y, i % 3 === 0 ? 0xffffff : 0xaee9ff, Math.cos(a) * sp, Math.sin(a) * sp * 0.7, 420, 1, {
        tex: CFX.shard,
        rot: a,
        endScale: 0.6,
      });
    }
    this.fxFlash(x, y, r, 0xdff6ff);
  }

  clear(): void {
    for (const p of this.projectiles) p.img.destroy();
    this.projectiles = [];
    this.pool = [];
    this.live = 0;
  }
}
