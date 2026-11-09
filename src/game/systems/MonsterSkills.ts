// Monster techniques (docs/CLIENT-v2.md §6) — minimal working version for the combat-depth stage to deepen.
// Monsters with techniques sometimes cast one instead of an auto-attack: weighted pick among techniques whose
// cooldown is ready, whose `hpBelow` holds and whose `range` covers the player. Every technique is telegraphed
// (nova ellipse, projectile wind-up, dash line, strike cone, spin ring, chain spark) before it resolves.
// Echo techniques begun at the player within 6 tiles are marked witnessed on the instance (credited on kill).
import Phaser from 'phaser';
import type { MonsterTechnique, SkillDef } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { Monster } from '../entities/Monster';
import type { MapScene } from '../scenes/MapScene';
import { TILE } from '../world/runtime';
import { distToSegment } from './SkillSystem';

const WITNESS_RANGE = 6 * TILE;
const TELEGRAPH = 0xff3b3b;
const PLAYER_R = 14;

interface Active {
  m: Monster;
  skill: SkillDef;
  at: number;
  gfx: Phaser.GameObjects.Graphics;
  resolve: () => void;
}

interface Shot {
  img: Phaser.GameObjects.Image;
  x: number;
  y: number;
  vx: number;
  vy: number;
  traveled: number;
  range: number;
  size: number;
  dmg: number;
  from: string;
  slow: boolean;
}

export class MonsterSkills {
  private active: Active[] = [];
  private shots: Shot[] = [];

  constructor(private s: MapScene) {}

  /** A hostile monster at distance `dist` may start a technique. True when it did (skip the auto-attack). */
  tryStart(m: Monster, now: number, dist: number): boolean {
    const techs = m.def.techniques;
    if (!techs?.length || now < m.nextTechRoll || now < m.busyUntil) return false;
    m.nextTechRoll = now + (m.warden ? 700 : 1100);
    const hpFrac = m.hp / m.maxHp;
    const ready = techs.filter(
      (t) =>
        (m.techReadyAt.get(t.skill) ?? 0) <= now &&
        (t.hpBelow === undefined || hpFrac < t.hpBelow) &&
        dist <= t.range &&
        !!this.s.reg.skill(t.skill),
    );
    if (!ready.length) return false;
    const chance = m.warden ? 0.75 : m.elite ? 0.5 : 0.35;
    if (Math.random() > chance) return false;
    const enraged = m.warden && hpFrac < 0.5;
    const weight = (t: MonsterTechnique) => t.weight * (t.hpBelow !== undefined ? (enraged ? 3 : 2) : 1);
    let roll = Math.random() * ready.reduce((a, t) => a + weight(t), 0);
    let pick = ready[0];
    for (const t of ready) {
      roll -= weight(t);
      if (roll <= 0) {
        pick = t;
        break;
      }
    }
    m.techReadyAt.set(pick.skill, now + pick.cooldown);
    this.start(m, pick, this.s.reg.skill(pick.skill)!, now, dist);
    return true;
  }

  private start(m: Monster, tech: MonsterTechnique, skill: SkillDef, now: number, dist: number): void {
    const s = this.s;
    const p = s.player;
    m.facing = p.x > m.x ? 1 : -1;
    // Echo witness: the technique begins at the player within 6 tiles.
    if (tech.echo && dist <= WITNESS_RANGE && !s.book.has(skill.id) && !m.witnessed.has(skill.id)) {
      m.witnessed.add(skill.id);
      s.floatText(m.x, m.y - m.sprite.displayHeight - 14, '👁', '#e8f4ff', 14);
    }
    const dmg = Math.max(1, Math.round(m.def.atk * skill.power));
    const from = `${m.def.name}'s ${skill.name}`;
    const slow =
      skill.element === 'water' || skill.element === 'ice' || skill.status === 'slow' || skill.status === 'freeze' || skill.status === 'soak';
    const color = skill.element ? (s.reg.element(skill.element)?.color ?? TELEGRAPH) : TELEGRAPH;
    const gfx = s.add.graphics().setDepth(-40000);
    const sh = skill.shape;
    const hitPlayer = () => s.combat.hurtPlayer(dmg, from, { slow });
    let delay = 400;
    let resolve: () => void = () => undefined;
    s.floatText(m.x, m.y - m.sprite.displayHeight - 2, skill.name, '#ffb0a0', 11);

    switch (sh.kind) {
      case 'nova': {
        const cx = p.x;
        const cy = p.y;
        const r = sh.radius;
        delay = Math.max(600, sh.delay ?? 0);
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.fillStyle(TELEGRAPH, 0.12 + t * 0.15).fillEllipse(cx, cy, r * 2, r * 1.3);
          gfx.lineStyle(2, TELEGRAPH, 0.9).strokeEllipse(cx, cy, r * 2, r * 1.3);
          gfx.fillStyle(color, 0.3).fillEllipse(cx, cy, r * 2 * t, r * 1.3 * t);
        });
        resolve = () => {
          s.skills.fxRing(cx, cy, r, color, false);
          s.skills.fxBurst(cx, cy, color, 14);
          if (m.warden) s.cameras.main.shake(150, 0.007);
          if (Math.hypot((p.x - cx) / r, (p.y - cy) / (r * 0.65)) <= 1) hitPlayer();
        };
        break;
      }
      case 'projectile': {
        delay = 300;
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.fillStyle(color, 0.25 + 0.4 * t).fillCircle(m.x, m.y - 16, 6 + 6 * t);
        });
        resolve = () => {
          const count = sh.count ?? 1;
          const spread = ((sh.spread ?? (count > 1 ? 30 : 0)) * Math.PI) / 180;
          const base = Math.atan2(p.y - m.y, p.x - m.x);
          for (let i = 0; i < count; i++) {
            const a = count > 1 ? base - spread / 2 + (spread * i) / (count - 1) : base;
            this.shoot(m, a, sh.speed, sh.range, sh.size ?? 12, dmg, from, slow, color);
          }
        };
        break;
      }
      case 'dash': {
        delay = 400;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const sx = m.x;
        const sy = m.y;
        let ex = sx;
        let ey = sy;
        for (let d = 8; d <= sh.distance; d += 8) {
          const nx = sx + Math.cos(a) * d;
          const ny = sy + Math.sin(a) * d;
          if (isBlockedPx(s.cm, nx, ny)) break;
          ex = nx;
          ey = ny;
        }
        const w = Math.max(24, sh.width);
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.lineStyle(w, TELEGRAPH, 0.12 + 0.18 * t).lineBetween(sx, sy, ex, ey);
          gfx.lineStyle(2, TELEGRAPH, 0.8).lineBetween(sx, sy, ex, ey);
        });
        resolve = () => {
          s.tweens.addCounter({
            from: 0,
            to: 1,
            duration: 180,
            onUpdate: (tw) => {
              const t = tw.getValue() ?? 0;
              m.x = sx + (ex - sx) * t;
              m.y = sy + (ey - sy) * t;
            },
          });
          s.time.delayedCall(110, () => {
            if (m.alive && distToSegment(p.x, p.y, sx, sy, ex, ey) <= w / 2 + PLAYER_R) hitPlayer();
          });
        };
        break;
      }
      case 'strike': {
        delay = 300;
        const a = Math.atan2(p.y - m.y, p.x - m.x);
        const arc = (sh.arc * Math.PI) / 180;
        const range = sh.range + m.radius;
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.fillStyle(TELEGRAPH, 0.12 + 0.2 * t);
          gfx.slice(m.x, m.y, range, a - arc / 2, a + arc / 2, false).fillPath();
        });
        resolve = () => {
          s.skills.fxArc(m.x, m.y - 10, a, arc, range, color, false);
          const d = Math.hypot(p.x - m.x, p.y - m.y);
          let diff = Math.atan2(p.y - m.y, p.x - m.x) - a;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          if (d <= range + PLAYER_R && (Math.abs(diff) <= arc / 2 || d < m.radius + PLAYER_R)) hitPlayer();
        };
        break;
      }
      case 'spin': {
        delay = 400;
        const r = sh.radius + m.radius;
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.lineStyle(3, TELEGRAPH, 0.5 + 0.4 * t).strokeEllipse(m.x, m.y, r * 2, r * 1.3);
          gfx.fillStyle(TELEGRAPH, 0.1 + 0.15 * t).fillEllipse(m.x, m.y, r * 2, r * 1.3);
        });
        resolve = () => {
          s.skills.fxRing(m.x, m.y - 6, r, color, true);
          if (Math.hypot((p.x - m.x) / r, (p.y - m.y) / (r * 0.65)) <= 1) hitPlayer();
        };
        break;
      }
      case 'chain': {
        delay = 300;
        const range = sh.range;
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.fillStyle(color, 0.3 + 0.5 * t).fillCircle(m.x, m.y - 18, 4 + 5 * t);
        });
        resolve = () => {
          if (Math.hypot(p.x - m.x, p.y - m.y) <= range + PLAYER_R) {
            s.skills.fxLightning(
              [
                { x: m.x, y: m.y - 18 },
                { x: p.x, y: p.y - 16 },
              ],
              color,
            );
            hitPlayer();
          }
        };
        break;
      }
      case 'buff':
        delay = 400;
        this.pulse(gfx, delay, (t) => {
          gfx.clear();
          gfx.lineStyle(2, color, 0.8).strokeEllipse(m.x, m.y, 40 + 20 * t, 16 + 8 * t);
        });
        resolve = () => s.skills.fxRing(m.x, m.y, 40, color, false);
        break;
    }
    m.busyUntil = now + delay + 220;
    m.nextAttack = Math.max(m.nextAttack, now + delay + 400);
    this.active.push({ m, skill, at: now + delay, gfx, resolve });
  }

  /** Redraws a telegraph with progress 0..1 every frame until it resolves. */
  private pulse(gfx: Phaser.GameObjects.Graphics, duration: number, draw: (t: number) => void): void {
    draw(0);
    this.s.tweens.addCounter({
      from: 0,
      to: 1,
      duration,
      onUpdate: (tw) => {
        if (gfx.active) draw(tw.getValue() ?? 0);
      },
    });
  }

  private shoot(m: Monster, a: number, speed: number, range: number, size: number, dmg: number, from: string, slow: boolean, color: number) {
    const img = this.s.add
      .image(m.x, m.y - 14, 'fx_orb')
      .setTint(color)
      .setScale(size / 16)
      .setBlendMode(Phaser.BlendModes.ADD);
    this.shots.push({ img, x: m.x, y: m.y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, traveled: 0, range, size, dmg, from, slow });
  }

  update(dt: number, now: number): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const a = this.active[i];
      if (!a.m.alive) {
        a.gfx.destroy();
        this.active.splice(i, 1);
        continue;
      }
      if (now >= a.at) {
        a.gfx.destroy();
        this.active.splice(i, 1);
        a.resolve();
      }
    }
    const p = this.s.player;
    for (let i = this.shots.length - 1; i >= 0; i--) {
      const sh = this.shots[i];
      const sx = sh.vx * dt;
      const sy = sh.vy * dt;
      sh.x += sx;
      sh.y += sy;
      sh.traveled += Math.hypot(sx, sy);
      sh.img.setPosition(sh.x, sh.y - 14).setDepth(sh.y + 20);
      let dead = sh.traveled >= sh.range || isBlockedPx(this.s.cm, sh.x, sh.y);
      if (!dead && Math.hypot(p.x - sh.x, p.y - sh.y) <= PLAYER_R + sh.size / 2) {
        this.s.combat.hurtPlayer(sh.dmg, sh.from, { slow: sh.slow });
        dead = true;
      }
      if (dead) {
        sh.img.destroy();
        this.shots.splice(i, 1);
      }
    }
  }

  /** Drops a monster's pending technique (death, leash). */
  cancel(m: Monster): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      if (this.active[i].m !== m) continue;
      this.active[i].gfx.destroy();
      this.active.splice(i, 1);
    }
    m.busyUntil = 0;
  }

  clear(): void {
    for (const a of this.active) a.gfx.destroy();
    for (const s of this.shots) s.img.destroy();
    this.active = [];
    this.shots = [];
  }
}
