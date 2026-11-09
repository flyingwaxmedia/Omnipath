// Shape FX, hit tests, projectiles and riders (docs/CLIENT-v2.md §6): turns SkillDef shapes into on-screen
// effects and calls the host for every hit. Damage, statuses and XP live in Combat.ts.
import Phaser from 'phaser';
import type { DamageRoll } from '../../core/combat';
import type { SkillDef } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { CompiledMap } from '../../core/world/types';
import type { Monster } from '../entities/Monster';
import type { Player } from '../entities/Player';

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
}

export interface CombatHost {
  world: Phaser.Scene;
  cm: CompiledMap;
  player: Player;
  liveMonsters(): Monster[];
  /** Applies one hit; returns the roll, or null when nothing happened (target already dead). */
  hit(m: Monster, cast: Cast, falloff?: number): DamageRoll | null;
  applyBuff(skill: SkillDef, rank: number): void;
  colorFor(skill: SkillDef): number;
}

interface Projectile {
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
  color: number;
  trailT: number;
  returning: boolean;
}

const DEG = Math.PI / 180;

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

/** Chain-shaped knife skills render as bouncing knives, not lightning. */
export function isKnifeChain(skill: SkillDef): boolean {
  return skill.shape.kind === 'chain' && (skill.tags.includes('projectile') || skill.tags.includes('pierce'));
}

export class SkillSystem {
  private projectiles: Projectile[] = [];
  private nextId = 1;

  constructor(private host: CombatHost) {}

  newCast(skill: SkillDef, rank: number, origin: { x: number; y: number }): Cast {
    return {
      id: this.nextId++,
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

  /** Executes a cast (and schedules its reprise rider). */
  execute(cast: Cast, aim: { x: number; y: number }, target: Monster | null): void {
    this.run(cast, aim, target);
    const rep = cast.skill.riders?.reprise;
    if (rep && !cast.reprise && cast.skill.shape.kind !== 'buff') {
      this.host.world.time.delayedCall(rep.delayMs, () => {
        const p = this.host.player;
        const t = target && target.alive ? target : null;
        const a = t ? { x: t.x, y: t.y } : { x: p.x + (aim.x - cast.origin.x), y: p.y + (aim.y - cast.origin.y) };
        this.fxRing(p.x, p.y - 6, 26, this.host.colorFor(cast.skill), false);
        this.run({ ...cast, origin: { x: p.x, y: p.y }, mult: cast.mult * rep.mult, reprise: true }, a, t);
      });
    }
  }

  private run(cast: Cast, aim: { x: number; y: number }, target: Monster | null): void {
    const { skill } = cast;
    const s = skill.shape;
    const o = cast.origin;
    const ang = Math.atan2(aim.y - o.y, aim.x - o.x);
    const color = this.host.colorFor(skill);
    const scene = this.host.world;
    switch (s.kind) {
      case 'strike': {
        const hits = s.hits ?? 1;
        for (let h = 0; h < hits; h++) {
          scene.time.delayedCall(h * 130, () => {
            const p = this.host.player;
            this.fxArc(p.x, p.y - 12, ang, s.arc * DEG, s.range, color, h % 2 === 1);
            for (const m of this.host.liveMonsters()) {
              const d = Math.hypot(m.x - p.x, m.y - p.y);
              if (d > s.range + m.radius) continue;
              const a = Math.atan2(m.y - p.y, m.x - p.x);
              if (d > m.radius + 8 && angleDiff(a, ang) > (s.arc * DEG) / 2) continue;
              this.host.hit(m, { ...cast, origin: { x: p.x, y: p.y } });
            }
          });
        }
        if (skill.power >= 2) scene.cameras.main.shake(90, 0.004);
        break;
      }
      case 'spin': {
        const pulses = s.pulses ?? 1;
        for (let i = 0; i < pulses; i++) {
          scene.time.delayedCall(i * 170, () => {
            const p = this.host.player;
            this.fxRing(p.x, p.y - 6, s.radius, color, true);
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
        for (let i = 0; i < count; i++) {
          let a = ang;
          if (s.radial) a = ang + (i / count) * Math.PI * 2;
          else if (count > 1) a = ang - spread / 2 + (spread * i) / (count - 1);
          this.spawnProjectile(cast, a, s.speed, s.range, s.pierce ?? 0, s.size ?? 12, color);
        }
        break;
      }
      case 'dash':
        this.dash(cast, ang, s.distance, s.width, !!s.spin, color);
        break;
      case 'nova': {
        const d = Math.min(s.range, Math.hypot(aim.x - o.x, aim.y - o.y));
        const cx = o.x + Math.cos(ang) * d;
        const cy = o.y + Math.sin(ang) * d;
        const delay = s.delay ?? 200;
        this.fxTelegraph(cx, cy, s.radius, color, delay);
        scene.time.delayedCall(delay, () => {
          this.fxRing(cx, cy, s.radius, color, false);
          this.fxBurst(cx, cy, color, 14);
          for (const m of this.host.liveMonsters()) {
            if (Math.hypot(m.x - cx, m.y - cy) <= s.radius + m.radius) this.host.hit(m, { ...cast, origin: { x: cx, y: cy } });
          }
          if (skill.power >= 2) scene.cameras.main.shake(120, 0.006);
        });
        break;
      }
      case 'chain':
        this.chain(cast, s.range, s.jumps, ang, target, color);
        break;
      case 'buff': {
        this.host.applyBuff(skill, cast.rank);
        const p = this.host.player;
        this.fxRing(p.x, p.y, 40, color, false);
        for (let i = 0; i < 12; i++) {
          const a = (i / 12) * Math.PI * 2;
          this.particle(p.x + Math.cos(a) * 18, p.y + Math.sin(a) * 8, color, 0, -40 - Math.random() * 30, 600);
        }
        break;
      }
    }
  }

  private chain(cast: Cast, range: number, jumps: number, ang: number, target: Monster | null, color: number): void {
    const o = cast.origin;
    const live = this.host.liveMonsters();
    const knives = isKnifeChain(cast.skill);
    let first: Monster | null = target && target.alive && Math.hypot(target.x - o.x, target.y - o.y) <= range + target.radius ? target : null;
    if (!first) {
      let best = Infinity;
      for (const m of live) {
        const dd = Math.hypot(m.x - o.x, m.y - o.y);
        if (dd <= range + m.radius && dd < best) {
          best = dd;
          first = m;
        }
      }
    }
    const start = { x: o.x, y: o.y - 16 };
    if (!first) {
      const end = { x: o.x + Math.cos(ang) * range * 0.6, y: o.y + Math.sin(ang) * range * 0.6 };
      if (knives) this.fxKnife(start, end, color, 0);
      else this.fxLightning([start, end], color);
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
    const step = knives ? 90 : 60;
    let extended = false;
    const strike = (m: Monster, i: number, from: { x: number; y: number }) => {
      const to = { x: m.x, y: m.y - 10 };
      if (knives) this.fxKnife(from, to, color, i * step);
      this.host.world.time.delayedCall(i * step + (knives ? step : 0), () => {
        if (!m.alive) return;
        const roll = this.host.hit(m, cast, Math.pow(0.85, i));
        // Conduct: one extra jump on chain shapes.
        if (roll?.combo?.extraJump && !extended) {
          extended = true;
          const extra = nextFrom(chain[chain.length - 1]);
          if (extra) {
            const last = chain[chain.length - 1];
            chain.push(extra);
            if (!knives) this.fxLightning([{ x: last.x, y: last.y - 10 }, { x: extra.x, y: extra.y - 10 }], color);
            strike(extra, chain.length - 1, { x: last.x, y: last.y - 10 });
          }
        }
      });
    };
    const pts: { x: number; y: number }[] = [start];
    chain.forEach((m, i) => {
      strike(m, i, pts[pts.length - 1]);
      pts.push({ x: m.x, y: m.y - 10 });
    });
    if (!knives) this.fxLightning(pts, color);
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
      if (pr.spin) pr.img.rotation += pr.spin * dt;
      else pr.img.rotation = Math.atan2(pr.vy, pr.vx);
      pr.img.setDepth(pr.y + 20);
      pr.trailT -= dt;
      if (pr.trailT <= 0) {
        pr.trailT = 0.03;
        this.particle(pr.x, pr.y - 14, pr.color, 0, 0, 220, pr.size / 20);
      }
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
            this.host.hit(m, { ...pr.cast, origin: { x: pr.x - pr.vx * 0.05, y: pr.y - pr.vy * 0.05 } });
            if (pr.pierce-- <= 0) {
              dead = !this.turnBack(pr);
              break;
            }
          }
        }
      }
      if (dead) {
        this.fxBurst(pr.x, pr.y - 14, pr.color, 5);
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
    return true;
  }

  // ------------------------------------------------------------ helpers

  private spawnProjectile(cast: Cast, a: number, speed: number, range: number, pierce: number, size: number, color: number) {
    const tags = cast.skill.tags;
    const key = tags.includes('blade') && !tags.includes('arcane') ? 'fx_blade' : tags.includes('pierce') ? 'fx_knife' : 'fx_orb';
    const img = this.host.world.add.image(cast.origin.x, cast.origin.y - 14, key).setTint(color);
    img.setBlendMode(key === 'fx_orb' ? Phaser.BlendModes.ADD : Phaser.BlendModes.NORMAL);
    if (key === 'fx_orb') img.setScale(size / 16);
    else img.setScale(size / 14);
    img.rotation = a;
    this.projectiles.push({
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
      spin: key === 'fx_blade' ? 18 : 0,
      color,
      trailT: 0,
      returning: false,
    });
  }

  private dash(cast: Cast, ang: number, distance: number, width: number, spin: boolean, color: number) {
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
    p.path = [];
    p.lockedUntil = scene.time.now + dur + 30;
    for (let i = 0; i < 5; i++) {
      const t = i / 5;
      const ghost = scene.add
        .image(sx + (ex - sx) * t, sy + (ey - sy) * t, p.sprite.texture.key)
        .setOrigin(0.45, 0.95)
        .setFlipX(p.facing < 0)
        .setTint(color)
        .setAlpha(0.5)
        .setDepth(sy + (ey - sy) * t);
      scene.tweens.add({ targets: ghost, alpha: 0, duration: 350, delay: i * 25, onComplete: () => ghost.destroy() });
    }
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
      if (spin) this.fxRing(ex, ey - 6, width, color, true);
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

  // ------------------------------------------------------------ fx

  particle(x: number, y: number, color: number, vx: number, vy: number, life: number, scale = 0.6) {
    const scene = this.host.world;
    const img = scene.add.image(x, y, 'fx_dot').setTint(color).setScale(scale).setBlendMode(Phaser.BlendModes.ADD).setDepth(y + 30);
    scene.tweens.add({
      targets: img,
      x: x + (vx * life) / 1000,
      y: y + (vy * life) / 1000,
      alpha: 0,
      scale: scale * 0.3,
      duration: life,
      onComplete: () => img.destroy(),
    });
  }

  fxBurst(x: number, y: number, color: number, n: number) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 40 + Math.random() * 90;
      this.particle(x, y, color, Math.cos(a) * sp, Math.sin(a) * sp, 300 + Math.random() * 200);
    }
  }

  fxArc(x: number, y: number, ang: number, arc: number, range: number, color: number, flip: boolean) {
    const scene = this.host.world;
    const g = scene.add.graphics({ x, y }).setDepth(y + 40).setBlendMode(Phaser.BlendModes.ADD);
    const r = range * 0.75;
    g.lineStyle(7, color, 0.9);
    g.beginPath();
    g.arc(0, 0, r, ang - arc / 2, ang + arc / 2, flip);
    g.strokePath();
    g.lineStyle(2, 0xffffff, 0.9);
    g.beginPath();
    g.arc(0, 0, r + 3, ang - arc / 2.4, ang + arc / 2.4, flip);
    g.strokePath();
    g.setScale(0.7);
    scene.tweens.add({ targets: g, scale: 1.1, alpha: 0, duration: 200, onComplete: () => g.destroy() });
  }

  fxRing(x: number, y: number, radius: number, color: number, blades: boolean) {
    const scene = this.host.world;
    const g = scene.add.graphics({ x, y }).setDepth(y + 40).setBlendMode(Phaser.BlendModes.ADD);
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

  fxTelegraph(x: number, y: number, radius: number, color: number, delay: number) {
    const scene = this.host.world;
    const g = scene.add.graphics({ x, y }).setDepth(y - 900);
    g.lineStyle(2, color, 0.8);
    g.strokeEllipse(0, 0, radius * 2, radius * 1.3);
    g.fillStyle(color, 0.12);
    g.fillEllipse(0, 0, radius * 2, radius * 1.3);
    scene.tweens.add({ targets: g, alpha: 0.3, duration: delay, onComplete: () => g.destroy() });
  }

  /** A knife flying from a to b (bouncing chain knives). */
  fxKnife(a: { x: number; y: number }, b: { x: number; y: number }, color: number, delay: number) {
    const scene = this.host.world;
    const img = scene.add
      .image(a.x, a.y, 'fx_knife')
      .setTint(color)
      .setScale(1.1)
      .setRotation(Math.atan2(b.y - a.y, b.x - a.x))
      .setDepth(100000)
      .setAlpha(0);
    scene.tweens.add({
      targets: img,
      x: b.x,
      y: b.y,
      alpha: { from: 1, to: 1 },
      delay,
      duration: 90,
      onComplete: () => {
        this.fxBurst(b.x, b.y, color, 3);
        img.destroy();
      },
    });
  }

  fxLightning(pts: { x: number; y: number }[], color: number) {
    const scene = this.host.world;
    const g = scene.add.graphics().setDepth(100000).setBlendMode(Phaser.BlendModes.ADD);
    const draw = (w: number, c: number, a: number) => {
      g.lineStyle(w, c, a);
      g.beginPath();
      g.moveTo(pts[0].x, pts[0].y);
      for (let i = 1; i < pts.length; i++) {
        const a0 = pts[i - 1];
        const a1 = pts[i];
        const segs = 5;
        for (let k = 1; k <= segs; k++) {
          const t = k / segs;
          const jitter = k === segs ? 0 : (Math.random() - 0.5) * 18;
          g.lineTo(a0.x + (a1.x - a0.x) * t + jitter, a0.y + (a1.y - a0.y) * t + jitter);
        }
      }
      g.strokePath();
    };
    draw(5, color, 0.6);
    draw(2, 0xffffff, 1);
    scene.tweens.add({ targets: g, alpha: 0, duration: 260, onComplete: () => g.destroy() });
    for (const p of pts.slice(1)) this.fxBurst(p.x, p.y, color, 4);
  }

  clear(): void {
    for (const p of this.projectiles) p.img.destroy();
    this.projectiles = [];
  }
}
