import Phaser from 'phaser';
import { computeDamage } from '../../core/combat';
import type { Registry } from '../../core/registry';
import type { FuseResult, SkillBook } from '../../core/skillbook';
import type { SkillDef, StatusKind, WeaponType } from '../../core/types';
import { ITEMS } from '../../data/items';
import { MONSTERS } from '../../data/monsters';
import { WEAPONS } from '../../data/weapons';
import type { GameController } from '../../ui/controller';
import { UI, esc } from '../../ui/ui';
import { Monster } from '../entities/Monster';
import { Player } from '../entities/Player';
import { type Buff, Session, type Stats, computeStats, expToNext } from '../session';
import { type Cast, type CombatHost, SkillSystem } from '../systems/SkillSystem';
import { TILE, type InteractDef, type WorldMap, generateWorld, isWalkable, regionAt } from '../world/map';
import { findPath, nearestWalkable } from '../world/pathfinding';

interface InteractView {
  def: InteractDef;
  sprite: Phaser.GameObjects.Image | null;
  label: Phaser.GameObjects.Text;
  depletedUntil: number;
}

interface Channel {
  label: string;
  start: number;
  until: number;
  done: () => void;
  interruptOnHit: boolean;
}

const NPC_TEX: Partial<Record<InteractDef['kind'], string>> = {
  blacksmith: 'npc_blacksmith',
  priestess: 'npc_priestess',
  hermit: 'npc_hermit',
  fisher: 'npc_fisher',
  ore: 'ore',
  wind_shrine: 'shrine',
  obelisk: 'obelisk',
  signpost: 'signpost',
};

const ORE_FOR_EARTH = 10;
const FORGES_FOR_FIRE = 3;
const FISH_FOR_WATER = 3;
const GLOOMCAPS_FOR_SHADOW = 5;

export class WorldScene extends Phaser.Scene implements GameController, CombatHost {
  session!: Session;
  reg!: Registry;
  book!: SkillBook;
  ui!: UI;
  map!: WorldMap;
  player!: Player;
  monsters: Monster[] = [];
  skills!: SkillSystem;
  private views: InteractView[] = [];
  private cooldowns = new Map<string, { readyAt: number; total: number }>();
  private buffs: Buff[] = [];
  private target: Monster | null = null;
  private pending: InteractView | null = null;
  private channel: Channel | null = null;
  private targetRing!: Phaser.GameObjects.Image;
  private moveMarker!: Phaser.GameObjects.Image;
  private bobber!: Phaser.GameObjects.Image;
  private repathAt = 0;
  private uiT = 0;
  private regenT = 0;
  private saveT = 0;
  private zoneT = 0;
  private lastHurt = 0;
  private dead = false;
  private toastGate = 0;
  private hotbarDirty = false;

  constructor() {
    super('World');
  }

  get world(): Phaser.Scene {
    return this;
  }

  init(data: { session: Session }): void {
    this.session = data.session;
    this.reg = data.session.reg;
    this.book = data.session.book;
    this.monsters = [];
    this.views = [];
  }

  // =================================================================== create

  create(): void {
    this.map = generateWorld();
    this.buildWorld();

    const p = this.session.player;
    const start = isWalkable(this.map, Math.floor(p.x / TILE), Math.floor(p.y / TILE)) ? p : this.map.spawnPoint;
    this.player = new Player(this, start.x, start.y, p.name, p.weapon);
    this.skills = new SkillSystem(this);

    this.targetRing = this.add.image(0, 0, 'target_ring').setVisible(false);
    this.moveMarker = this.add.image(0, 0, 'move_marker').setVisible(false).setDepth(-50000);

    this.spawnMonsters();

    const cam = this.cameras.main;
    cam.setBounds(0, 0, this.map.w * TILE, this.map.h * TILE);
    cam.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.fitCamera();
    this.scale.on('resize', () => this.fitCamera());

    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      const wp = ptr.positionToCamera(cam) as Phaser.Math.Vector2;
      this.handleTap(wp.x, wp.y);
    });

    this.ui = new UI(document.getElementById('ui')!, this);
    this.wireEvents();
    this.ui.updateVitals();
    this.ui.setZone(regionAt(this.map, this.player.x, this.player.y));

    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => this.book.events.clear());

    if (!this.book.flag('intro')) {
      this.book.incFlag('intro');
      const w = WEAPONS[p.weapon];
      const basic = this.reg.skill(w.basic)!;
      this.time.delayedCall(300, () =>
        this.ui.dialog(
          'Old Hermit Oru',
          '🧙',
          `Welcome to Hearthvale, ${esc(p.name)}. You carry a <b>${w.name}</b> and know only <b>${basic.name}</b>.<br><br>
          Tap the ground to walk. Tap a monster to fight it — every strike trains <b>${basic.name}</b>.
          Master it and it will <b>morph</b> into something new.<br><br>
          Elements hide in ordinary work: the forge, the lake, the quarry, the hills. Find them, then <b>fuse</b> them with your skills.`,
          [{ label: 'Begin' }],
        ),
      );
    } else {
      this.ui.log(`Welcome back, <b>${esc(p.name)}</b>.`, 'good');
    }
  }

  private fitCamera(): void {
    const { width, height } = this.scale;
    const short = Math.min(width, height);
    this.cameras.main.setZoom(Phaser.Math.Clamp(short / 380, 1, 1.7));
  }

  private buildWorld(): void {
    const m = this.map;
    const tm = this.make.tilemap({ data: m.tiles as number[][], tileWidth: TILE, tileHeight: TILE });
    const ts = tm.addTilesetImage('tiles', 'tiles', TILE, TILE, 0, 0)!;
    tm.createLayer(0, ts, 0, 0)!.setDepth(-100000);

    for (const b of m.buildings) {
      const x = b.tx * TILE + (b.w * TILE) / 2;
      const y = (b.ty + b.h) * TILE;
      this.add.image(x, y + 4, b.kind).setOrigin(0.5, 1).setDepth(y);
    }
    for (const pr of m.props) {
      const x = pr.tx * TILE + TILE / 2;
      const y = pr.ty * TILE + TILE - 4;
      this.add.image(x, y + 4, pr.kind).setOrigin(0.5, 1).setDepth(y);
    }
    for (const def of m.interactables) {
      const tex = NPC_TEX[def.kind];
      const isNpc = ['blacksmith', 'priestess', 'hermit', 'fisher'].includes(def.kind);
      const sprite = tex
        ? this.add
            .image(def.x, def.y + (isNpc ? 10 : 12), tex)
            .setOrigin(0.5, 1)
            .setDepth(def.y + 10)
        : null;
      if (isNpc) this.add.image(def.x, def.y + 10, 'shadow').setDepth(def.y - 1000);
      const showLabel = def.kind !== 'ore';
      const label = this.add
        .text(def.x, def.y - (sprite ? sprite.displayHeight - 4 : 18), def.kind === 'fishing_spot' ? '🎣 Fishing Spot' : def.name, {
          fontFamily: 'system-ui, sans-serif',
          fontSize: '10px',
          color: isNpc ? '#ffe9a0' : '#d8f0ff',
          stroke: '#000',
          strokeThickness: 3,
        })
        .setOrigin(0.5, 1)
        .setResolution(2)
        .setDepth(100000)
        .setVisible(showLabel);
      this.views.push({ def, sprite, label, depletedUntil: 0 });
      if (def.kind === 'fishing_spot') {
        this.bobber = this.add.image(def.x + 4, def.y - 18, 'bobber').setDepth(def.y);
        this.tweens.add({ targets: this.bobber, y: def.y - 15, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
      }
      if (sprite && isNpc) this.tweens.add({ targets: sprite, scaleY: 1.03, yoyo: true, repeat: -1, duration: 1100, ease: 'Sine.inOut' });
    }
  }

  private spawnMonsters(): void {
    const rnd = Phaser.Math.RND;
    for (const z of this.map.spawns) {
      const def = MONSTERS[z.monster];
      for (let i = 0; i < z.count; i++) {
        let tx = z.cx;
        let ty = z.cy;
        for (let k = 0; k < 30; k++) {
          const cx = Math.round(z.cx + rnd.between(-z.r, z.r));
          const cy = Math.round(z.cy + rnd.between(-z.r, z.r));
          if (isWalkable(this.map, cx, cy)) {
            tx = cx;
            ty = cy;
            break;
          }
        }
        const spot = nearestWalkable(this.map, tx, ty) ?? [z.cx, z.cy];
        const m = new Monster(
          this,
          def,
          { x: spot[0] * TILE + TILE / 2, y: spot[1] * TILE + TILE / 2, r: z.r * TILE },
          def.element ? this.reg.element(def.element) : undefined,
        );
        m.nextWander = this.time.now + rnd.between(500, 4000);
        this.monsters.push(m);
      }
    }
  }

  // =================================================================== events

  private wireEvents(): void {
    const ev = this.book.events;
    const ui = this.ui;
    ev.on('learned', ({ skill, source }) => {
      this.session.autoSlot(skill.id);
      this.hotbarDirty = true;
      const origin = this.describeSource(source);
      ui.log(`📖 Learned <b>${esc(skill.name)}</b> <small>(${esc(origin)})</small>`, 'rare');
      const el = skill.element ? this.reg.element(skill.element) : undefined;
      ui.discovery({
        icon: skill.icon,
        kicker: source.startsWith('class:') ? 'SIGNATURE SKILL' : skill.generated ? 'NEW INFUSION' : 'NEW SKILL',
        title: skill.name,
        body: `${esc(skill.desc)}<br><small>${esc(origin)}</small>`,
        accent: el ? `#${el.color.toString(16).padStart(6, '0')}` : undefined,
      });
      this.save();
    });
    ev.on('element', ({ element, source }) => {
      ui.log(`${element.icon} Attuned to <b>${element.name}</b>!`, 'rare');
      ui.discovery({
        icon: element.icon,
        kicker: 'ELEMENT ATTUNED',
        title: element.name,
        body: `${esc(element.desc)}<br><small>${esc(this.describeSource(source))}</small><br><br>Combine it with a skill at the <b>⚗️ Fusion Altar</b>.`,
        accent: `#${element.color.toString(16).padStart(6, '0')}`,
      });
      this.save();
    });
    ev.on('rankUp', ({ skill, rank }) => {
      this.floatText(this.player.x, this.player.y - 50, `${skill.icon} ${skill.name} R${rank}`, '#9fe0ff', 13);
      ui.log(`⬆ <b>${esc(skill.name)}</b> reached rank ${rank}.`, 'good');
      this.hotbarDirty = true;
    });
    ev.on('mastered', ({ skill }) => {
      const opts = this.book.morphOptions(skill.id);
      const avail = opts.filter((o) => o.available && !o.owned).length;
      ui.discovery({
        icon: skill.icon,
        kicker: '★ MASTERED',
        title: skill.name,
        body: opts.length
          ? `${avail} form${avail === 1 ? '' : 's'} revealed${opts.length > avail ? `, ${opts.length - avail} still hidden` : ''}.
             Open the <b>📖 Grimoire</b> to morph it — you keep ${esc(skill.name)}.`
          : 'Its future lies in fusion. Keep training it to raise its power.',
      });
    });
    ev.on('charge', ({ skill, charges }) => {
      if (charges > 1 || this.book.rank(skill.id) >= skill.maxRank) this.hotbarDirty = true;
      if (charges > 1) ui.toast(`✨ ${esc(skill.name)}: another morph charge (${charges})`);
    });
    ev.on('classDiscovered', ({ cls }) => {
      ui.log(`🏛️ Class discovered: <b>${esc(cls.name)}</b>`, 'rare');
      ui.discovery({
        icon: cls.icon,
        kicker: 'CLASS DISCOVERED',
        title: cls.name,
        body: `${esc(cls.desc)}<br><small>Wear it from the 🏛️ Classes menu.</small>`,
        accent: '#c9a0ff',
      });
      this.ui.updateVitals();
    });
    ev.on('hint', ({ text }) => ui.log(`🌫️ <i>“${esc(text)}”</i>`, 'info'));
  }

  private describeSource(src: string): string {
    if (src.startsWith('morph:')) return `Morphed from ${this.reg.skill(src.slice(6))?.name}`;
    if (src.startsWith('fusion:')) {
      const [a, b] = src.slice(7).split('+');
      return `Fusion: ${this.reg.refName(a)} + ${this.reg.refName(b)}`;
    }
    if (src.startsWith('class:')) return `Granted by the ${this.reg.classDef(src.slice(6))?.name} class`;
    return src;
  }

  // =================================================================== input

  private handleTap(x: number, y: number): void {
    if (this.dead) return;
    // Monsters first (tap the body, which sits above the feet).
    let best: Monster | null = null;
    let bestD = Infinity;
    for (const m of this.monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - x, m.y - m.radius - y);
      if (d < m.radius + 20 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    if (best) {
      this.pending = null;
      this.cancelChannel();
      this.setTarget(best);
      return;
    }
    for (const v of this.views) {
      const h = v.sprite ? v.sprite.displayHeight / 2 : 10;
      if (Math.hypot(v.def.x - x, v.def.y - h + 10 - y) < Math.max(26, h)) {
        this.setTarget(null);
        this.cancelChannel();
        this.pending = v;
        this.walkTo(v.def.x, v.def.y + TILE * 0.6);
        return;
      }
    }
    this.cancelChannel();
    this.pending = null;
    this.setTarget(null);
    this.walkTo(x, y);
    this.moveMarker.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
    this.tweens.add({ targets: this.moveMarker, alpha: 0, scale: 0.6, duration: 500 });
  }

  private walkTo(x: number, y: number): void {
    const path = findPath(this.map, this.player.x, this.player.y, x, y);
    this.player.path = path ?? [];
  }

  private setTarget(m: Monster | null): void {
    if (this.target && this.target !== m) this.target.label.setVisible(!!this.target.def.boss);
    this.target = m;
    if (m) {
      m.label.setVisible(true);
      this.repathAt = 0;
    }
    this.targetRing.setVisible(!!m);
    this.updateTargetUi();
  }

  private updateTargetUi(): void {
    const m = this.target;
    this.ui.setTarget(
      m && m.alive
        ? { name: m.def.name, level: m.def.level, hp: m.hp, maxHp: m.maxHp, element: m.element, boss: m.def.boss }
        : null,
    );
  }

  // =================================================================== update

  update(_time: number, delta: number): void {
    const dt = Math.min(delta, 50) / 1000;
    const now = this.time.now;
    const p = this.player;
    const st = this.stats();

    if (!this.dead) {
      this.updateChannel(now);
      this.updateEngage(now, st);
      this.followPath(dt, st);
    }

    for (const m of this.monsters) this.updateMonster(m, dt, now);
    this.skills.update(dt);

    // Expire buffs.
    if (this.buffs.length && this.buffs.some((b) => b.until <= now)) {
      this.buffs = this.buffs.filter((b) => b.until > now);
    }

    // Regen.
    this.regenT += dt;
    if (this.regenT >= 1 && !this.dead) {
      this.regenT -= 1;
      const pl = this.session.player;
      const calm = now - this.lastHurt > 5000;
      pl.hp = Math.min(st.maxHp, pl.hp + st.maxHp * ((calm ? 0.02 : 0.005) + st.regen / 100));
      pl.sp = Math.min(st.maxSp, pl.sp + st.maxSp * (calm ? 0.05 : 0.02) + 0.5);
    }

    // Visual sync.
    const auraColors = this.buffs.map((b) => this.buffColor(b.stat));
    p.sync(dt, auraColors);
    for (const m of this.monsters) if (m.alive) m.sync(dt);
    if (this.target?.alive) {
      this.targetRing.setPosition(this.target.x, this.target.y + 2).setDepth(this.target.y - 999);
      this.targetRing.setScale(this.target.def.boss ? 2.4 : 1);
    } else if (this.target) this.setTarget(null);
    for (const v of this.views) if (v.def.kind === 'ore' && v.sprite) v.sprite.setAlpha(now < v.depletedUntil ? 0.35 : 1);

    // Throttled UI.
    this.uiT += dt;
    if (this.uiT > 0.1) {
      this.uiT = 0;
      this.ui.updateVitals();
      this.ui.updateCooldowns();
      if (this.target) this.updateTargetUi();
      if (this.hotbarDirty && !this.ui.isOpen) {
        this.hotbarDirty = false;
        this.ui.renderHotbar();
      }
    }
    this.zoneT += dt;
    if (this.zoneT > 0.5) {
      this.zoneT = 0;
      this.ui.setZone(regionAt(this.map, p.x, p.y));
      this.session.player.x = p.x;
      this.session.player.y = p.y;
    }
    this.saveT += dt;
    if (this.saveT > 10) {
      this.saveT = 0;
      this.save();
    }
  }

  private followPath(dt: number, st: Stats): void {
    const p = this.player;
    if (this.time.now < p.lockedUntil) {
      p.moving = false;
      return;
    }
    if (!p.path.length) {
      p.moving = false;
      return;
    }
    const wp = p.path[0];
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    const d = Math.hypot(dx, dy);
    const step = st.speed * dt;
    if (d <= step) {
      p.x = wp.x;
      p.y = wp.y;
      p.path.shift();
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
    if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
    p.aimAngle = Math.atan2(dy, dx);
    p.moving = true;
  }

  private updateEngage(now: number, _st: Stats): void {
    const p = this.player;
    const pl = this.session.player;
    if (this.channel) return;
    const t = this.target;
    if (t && t.alive) {
      const w = WEAPONS[pl.weapon];
      const reach = w.range + t.radius;
      const d = Math.hypot(t.x - p.x, t.y - p.y);
      if (d > reach) {
        if (now >= this.repathAt) {
          this.repathAt = now + 350;
          const path = findPath(this.map, p.x, p.y, t.x, t.y);
          p.path = path ?? [];
        }
      } else {
        p.path = [];
        const cd = this.cooldown(w.basic);
        if (cd.remain <= 0 && now >= p.lockedUntil) this.castSkill(w.basic, true);
      }
    }
    if (this.pending) {
      const v = this.pending;
      if (Math.hypot(v.def.x - p.x, v.def.y - p.y) < TILE * 1.6) {
        p.path = [];
        this.pending = null;
        p.face(v.def.x, v.def.y);
        this.interact(v);
      } else if (!p.path.length) {
        this.pending = null;
      }
    }
  }

  // =================================================================== monsters

  private updateMonster(m: Monster, dt: number, now: number): void {
    if (!m.alive) {
      if (now >= m.respawnAt) this.respawn(m);
      return;
    }
    const map = this.map;
    const p = this.player;
    // Damage over time.
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
    // Knockback / pull velocity.
    if (m.status.vx || m.status.vy) {
      m.moveTo(map, m.x + m.status.vx * dt, m.y + m.status.vy * dt);
      const decay = Math.pow(0.02, dt);
      m.status.vx *= decay;
      m.status.vy *= decay;
      if (Math.hypot(m.status.vx, m.status.vy) < 6) m.status.vx = m.status.vy = 0;
    }
    if (m.slam && now >= m.slam.at) this.resolveSlam(m);
    if (m.stunned) {
      m.sprite.setTint(now < m.status.slowUntil ? 0x9fd8ff : 0xdddddd);
      return;
    }
    m.sprite.clearTint();
    if (now < m.status.slowUntil) m.sprite.setTint(0x9fd8ff);

    const speed = m.def.speed * m.speedMult(now);
    const fromSpawn = Math.hypot(m.x - m.spawn.x, m.y - m.spawn.y);
    if (m.returning) {
      m.hp = Math.min(m.maxHp, m.hp + m.maxHp * dt * 0.5);
      if (m.stepToward(map, m.spawn.x, m.spawn.y, speed * 1.6, dt) || fromSpawn < 8) m.returning = false;
      return;
    }
    const leash = m.def.boss ? TILE * 7 : TILE * 10;
    if (fromSpawn > leash) {
      m.returning = true;
      m.provoked = false;
      m.slam?.gfx.destroy();
      m.slam = null;
      if (this.target === m) this.setTarget(null);
      return;
    }
    const dp = Math.hypot(m.x - p.x, m.y - p.y);
    const hostile = !this.dead && (m.provoked || (m.def.aggressive && dp < (m.def.boss ? 220 : 140)));
    if (hostile) {
      if (dp > m.def.attackRange + 8) m.stepToward(map, p.x, p.y, speed * 1.15, dt);
      else if (now >= m.nextAttack) {
        m.nextAttack = now + m.def.attackDelay;
        m.facing = p.x > m.x ? 1 : -1;
        this.tweens.add({ targets: m.sprite, y: m.y - 6, yoyo: true, duration: 90 });
        this.hurtPlayer(m.def.atk, m.def.name);
      }
      if (m.def.boss && !m.slam && now >= m.nextSlam && dp < 260) this.startSlam(m, now);
    } else {
      if (now >= m.nextWander) {
        m.nextWander = now + Phaser.Math.Between(2000, 5000);
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * m.spawn.r;
        const wx = m.spawn.x + Math.cos(a) * r;
        const wy = m.spawn.y + Math.sin(a) * r;
        m.wanderTo = isWalkable(map, Math.floor(wx / TILE), Math.floor(wy / TILE)) ? { x: wx, y: wy } : null;
      }
      if (m.wanderTo && m.stepToward(map, m.wanderTo.x, m.wanderTo.y, speed * 0.5, dt)) m.wanderTo = null;
    }
  }

  private startSlam(m: Monster, now: number): void {
    const p = this.player;
    const g = this.add.graphics({ x: p.x, y: p.y }).setDepth(p.y - 900);
    m.slam = { x: p.x, y: p.y, at: now + 1100, gfx: g };
    m.nextSlam = now + 5200;
    const r = 78;
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: 1100,
      onUpdate: (tw) => {
        const t = tw.getValue() ?? 0;
        g.clear();
        g.fillStyle(0xff3030, 0.12 + t * 0.15).fillEllipse(0, 0, r * 2, r * 1.3);
        g.lineStyle(2, 0xff6060, 0.9).strokeEllipse(0, 0, r * 2, r * 1.3);
        g.fillStyle(0xffe14a, 0.35).fillEllipse(0, 0, r * 2 * t, r * 1.3 * t);
      },
    });
  }

  private resolveSlam(m: Monster): void {
    const s = m.slam!;
    m.slam = null;
    s.gfx.destroy();
    this.skills.fxRing(s.x, s.y, 78, 0xffe14a, false);
    this.skills.fxBurst(s.x, s.y, 0xffe14a, 18);
    this.cameras.main.shake(160, 0.008);
    const p = this.player;
    if (!this.dead && Math.hypot((p.x - s.x) / 78, (p.y - s.y) / (78 * 0.65)) <= 1) {
      this.hurtPlayer(Math.round(m.def.atk * 1.7), `${m.def.name}'s Thunder Stomp`);
    }
  }

  private respawn(m: Monster): void {
    m.alive = true;
    m.hp = m.maxHp;
    m.provoked = false;
    m.returning = false;
    m.status = { stunUntil: 0, slowUntil: 0, slowMult: 1, dots: [], vx: 0, vy: 0 };
    m.x = m.spawn.x;
    m.y = m.spawn.y;
    m.setVisible(true);
    m.sprite.setAlpha(0);
    this.tweens.add({ targets: m.sprite, alpha: 1, duration: 400 });
    if (m.def.boss) this.ui.log(`⚡ <b>${m.def.name}</b> has returned to Stormbreak Plateau.`, 'warn');
  }

  // =================================================================== combat

  liveMonsters(): Monster[] {
    return this.monsters.filter((m) => m.alive);
  }

  colorFor(skill: SkillDef): number {
    if (skill.element) return this.reg.element(skill.element)!.color;
    if (skill.tags.includes('arcane')) return 0x9fd0ff;
    if (skill.tags.includes('stealth')) return 0xc8b0ff;
    if (skill.tags.includes('toxin')) return 0x8be04a;
    return 0xffffff;
  }

  private buffColor(stat: Buff['stat']): number {
    return { atk: 0xff7a5a, matk: 0x8fb8ff, speed: 0x9be8c8, crit: 0xc8a0ff, regen: 0x7fff9f, def: 0xd0d0d0 }[stat];
  }

  hit(m: Monster, cast: Cast, falloff = 1): void {
    if (!m.alive) return;
    const skill = cast.skill;
    const st = this.stats();
    const roll = computeDamage(
      this.reg.elements,
      skill,
      cast.rank,
      st,
      { def: m.def.def, element: m.def.element },
      { tagPower: this.book.tagPowerFor(skill), falloff },
    );
    m.provoked = true;
    m.lastHitAt = this.time.now;
    m.flash(roll.crit ? 0xffff80 : 0xffffff);
    const color = roll.crit ? '#ffe14a' : roll.multiplier > 1 ? '#ff9a3a' : roll.multiplier < 1 ? '#a8b0c0' : '#ffffff';
    this.floatText(m.x + Phaser.Math.Between(-8, 8), m.y - m.sprite.displayHeight, `${roll.amount}${roll.crit ? '!' : ''}`, color, roll.crit ? 18 : 14);
    m.hp -= roll.amount;
    const statuses: StatusKind[] = [];
    if (skill.element) statuses.push(this.reg.element(skill.element)!.status);
    if (skill.status) statuses.push(skill.status);
    for (const s of statuses) this.applyStatus(m, s, roll.amount, cast.origin);
    const killed = m.hp <= 0;
    this.book.recordHit(skill.id, killed, cast.tally.hits++);
    if (killed) this.kill(m);
    if (!this.target && !killed && m.alive) this.setTarget(m);
  }

  private applyStatus(m: Monster, kind: StatusKind, dmg: number, origin: { x: number; y: number }): void {
    const now = this.time.now;
    const boss = !!m.def.boss;
    const st = m.status;
    const dot = (dur: number, pct: number, color: number) =>
      st.dots.push({ until: now + dur, next: now + 500, dmg: Math.max(1, Math.round(dmg * pct)), color, kind });
    const push = (sign: number, force: number) => {
      const a = Math.atan2(m.y - origin.y, m.x - origin.x);
      const f = force * (boss ? 0.15 : 1);
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
        break;
      case 'freeze':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 400 : 1200));
        st.slowUntil = now + 2200;
        st.slowMult = 0.5;
        break;
      case 'stun':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 200 : 650));
        break;
      case 'shock':
        st.stunUntil = Math.max(st.stunUntil, now + (boss ? 100 : 300));
        break;
      case 'knockback':
        push(1, 320);
        break;
      case 'pull':
        if (Math.hypot(m.x - origin.x, m.y - origin.y) > 24) push(-1, 240);
        break;
      case 'smite': {
        const pl = this.session.player;
        const heal = Math.max(1, Math.round(dmg * 0.12));
        pl.hp = Math.min(this.stats().maxHp, pl.hp + heal);
        this.floatText(this.player.x, this.player.y - 40, `+${heal}`, '#7fff9f', 12);
        break;
      }
    }
  }

  private damageMonsterRaw(m: Monster, amount: number, color: number): void {
    m.hp -= amount;
    m.flash(color);
    this.floatText(m.x, m.y - m.sprite.displayHeight, `${amount}`, `#${color.toString(16).padStart(6, '0')}`, 11);
    if (m.hp <= 0) this.kill(m);
  }

  private kill(m: Monster): void {
    if (!m.alive) return;
    m.alive = false;
    m.hp = 0;
    m.slam?.gfx.destroy();
    m.slam = null;
    m.respawnAt = this.time.now + m.def.respawn;
    this.skills.fxBurst(m.x, m.y - 10, m.element?.color ?? 0xffffff, 12);
    this.tweens.add({
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
    if (this.target === m) this.setTarget(null);

    const pl = this.session.player;
    const coins = Phaser.Math.Between(m.def.coins[0], m.def.coins[1]);
    pl.coins += coins;
    this.book.incFlag('kills');
    const kc = this.book.incFlag(`kill_${m.def.id}`);
    this.ui.log(`Defeated <b>${m.def.name}</b> · +${m.def.exp} EXP · 🪙${coins}`, 'info');
    this.gainExp(m.def.exp);
    if (m.def.id === 'gloomcap' && kc === GLOOMCAPS_FOR_SHADOW && !this.book.hasElement('shadow'))
      this.ui.log('🌑 Somewhere in Gloomwood, the obelisk stirs...', 'rare');
    for (const d of m.def.drops ?? []) {
      if (d.once && this.alreadyHas(d.item)) continue;
      if (Math.random() < d.chance) this.obtain(d.item);
    }
    if (m.def.boss) {
      this.ui.toast(`⚡ <b>${m.def.name}</b> has fallen!`);
      this.cameras.main.flash(300, 255, 240, 160);
    }
  }

  private alreadyHas(itemId: string): boolean {
    const it = ITEMS[itemId];
    if (!it) return true;
    return it.kind === 'tome' ? this.book.has(it.skill) : this.book.hasElement(it.element);
  }

  private obtain(itemId: string): void {
    const it = ITEMS[itemId];
    if (!it) return;
    this.ui.log(`${it.icon} Obtained <b>${it.name}</b>!`, 'loot');
    const pl = this.session.player;
    if (!pl.items.includes(it.name)) pl.items.push(`${it.icon} ${it.name}`);
    if (it.kind === 'tome') this.book.learn(it.skill, `Read from the ${it.name}`);
    else this.book.learnElement(it.element, `Absorbed from the ${it.name}`);
  }

  private gainExp(n: number): void {
    const pl = this.session.player;
    pl.exp += n;
    let leveled = false;
    while (pl.exp >= expToNext(pl.level)) {
      pl.exp -= expToNext(pl.level);
      pl.level++;
      leveled = true;
    }
    if (leveled) {
      this.book.level = pl.level;
      const st = this.stats();
      pl.hp = st.maxHp;
      pl.sp = st.maxSp;
      this.floatText(this.player.x, this.player.y - 60, `LEVEL ${pl.level}!`, '#ffe14a', 18);
      this.skills.fxRing(this.player.x, this.player.y, 60, 0xffe14a, false);
      this.ui.toast(`🎉 Base level <b>${pl.level}</b>`);
      this.ui.log(`🎉 Reached base level <b>${pl.level}</b>. HP and SP restored.`, 'good');
      this.hotbarDirty = true;
    }
  }

  private hurtPlayer(atk: number, from: string): void {
    if (this.dead) return;
    const st = this.stats();
    const dmg = Math.max(1, Math.round(atk * Phaser.Math.FloatBetween(0.9, 1.1) - st.def * 0.5));
    const pl = this.session.player;
    pl.hp -= dmg;
    this.lastHurt = this.time.now;
    this.player.hurt();
    this.floatText(this.player.x, this.player.y - 44, `-${dmg}`, '#ff5a5a', 14);
    if (this.channel?.interruptOnHit) {
      this.ui.toast('Interrupted!');
      this.cancelChannel();
    }
    if (pl.hp <= 0) this.die(from);
  }

  private die(from: string): void {
    const pl = this.session.player;
    pl.hp = 0;
    this.dead = true;
    this.setTarget(null);
    this.cancelChannel();
    this.player.path = [];
    const lost = Math.floor(pl.exp * 0.05);
    pl.exp -= lost;
    this.ui.log(`💀 You were defeated by ${esc(from)}. Lost ${lost} EXP.`, 'warn');
    this.player.sprite.setAngle(90).setAlpha(0.7);
    for (const m of this.monsters) m.provoked = false;
    this.time.delayedCall(1800, () => {
      const st = this.stats();
      this.dead = false;
      pl.hp = Math.round(st.maxHp * 0.5);
      pl.sp = Math.round(st.maxSp * 0.5);
      this.player.x = this.map.spawnPoint.x;
      this.player.y = this.map.spawnPoint.y;
      this.player.sprite.setAngle(0).setAlpha(1);
      this.ui.toast('You awaken in Hearthvale.');
    });
  }

  applyBuff(skill: SkillDef, rank: number): void {
    if (skill.shape.kind !== 'buff') return;
    const s = skill.shape;
    const amount = s.amount * (1 + 0.08 * (rank - 1));
    this.buffs = this.buffs.filter((b) => b.source !== skill.id);
    this.buffs.push({ stat: s.stat, amount, until: this.time.now + s.duration, source: skill.id });
    this.ui.log(`${skill.icon} <b>${esc(skill.name)}</b> active for ${s.duration / 1000}s.`, 'good');
  }

  // =================================================================== skills

  private castSkill(id: string, auto = false): boolean {
    const skill = this.reg.skill(id);
    if (!skill || this.dead) return false;
    const u = this.usable(id);
    if (!u.ok) {
      if (!auto) this.gateToast(u.reason!);
      return false;
    }
    const cd = this.cooldown(id);
    if (cd.remain > 0) {
      if (!auto) this.gateToast(`${skill.name} is recharging.`);
      return false;
    }
    const pl = this.session.player;
    if (pl.sp < skill.spCost) {
      if (!auto) this.gateToast('Not enough SP.');
      return false;
    }
    this.cancelChannel();
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
      // A basic melee swing with nothing in reach is pointless.
      if (auto && !target) return false;
    }
    p.attackAnim();
    pl.sp -= skill.spCost;
    const w = WEAPONS[pl.weapon];
    const total = (skill.cooldown || w.delay) * (1 - this.stats().cdr / 100);
    this.cooldowns.set(id, { readyAt: this.time.now + total, total });
    const rank = Math.max(1, this.book.rank(id));
    const cast = this.skills.newCast(skill, rank, { x: p.x, y: p.y });
    this.book.recordUse(id);
    this.skills.execute(cast, aim, target);
    if (target && !this.target && skill.shape.kind !== 'dash') this.setTarget(target);
    return true;
  }

  private gateToast(msg: string): void {
    if (this.time.now < this.toastGate) return;
    this.toastGate = this.time.now + 800;
    this.ui.toast(esc(msg));
  }

  // =================================================================== interactions

  private interact(v: InteractView): void {
    const book = this.book;
    const pl = this.session.player;
    const d = v.def;
    switch (d.kind) {
      case 'blacksmith': {
        const forged = book.flag('forge_success');
        const fireLine = book.hasElement('fire')
          ? 'The forge-fire lives in you now. Bring it to the altar and see what it does to your techniques.'
          : `Work the forge with me. Do it right ${FORGES_FOR_FIRE} times and the heat will get into your bones. <small>(${forged}/${FORGES_FOR_FIRE})</small>`;
        const forSale = (Object.keys(WEAPONS) as WeaponType[]).filter((w) => !pl.ownedWeapons.includes(w));
        this.ui.dialog('Brann the Smith', '🔨', `${fireLine}<br><br>Each forging takes <b>2 ore</b> from the quarry. You have <b>${pl.bag.ore}</b>.`, [
          { label: '🔥 Forge', action: () => this.doForge(), disabled: pl.bag.ore < 2 },
          ...forSale.map((w) => ({
            label: `${WEAPONS[w].icon} Buy ${WEAPONS[w].name} (🪙${WEAPONS[w].price})`,
            action: () => this.buyWeapon(w),
            disabled: pl.coins < WEAPONS[w].price,
          })),
          { label: 'Leave' },
        ]);
        break;
      }
      case 'priestess': {
        const st = this.stats();
        pl.hp = st.maxHp;
        pl.sp = st.maxSp;
        const n = book.knownElements().length;
        let text = 'Be healed, traveler. <i>(HP and SP restored.)</i><br><br>';
        if (!book.hasElement('holy') && n >= 3) {
          text += 'Three elements dwell within you, in balance. Then you are ready for the light.';
          this.ui.dialog('Sister Alba', '🕊️', text, [{ label: 'Receive the light', action: () => book.learnElement('holy', "Sister Alba's blessing") }]);
          return;
        }
        text += book.hasElement('holy')
          ? 'The light is with you. I have heard that light and shadow, joined, become something rarer still.'
          : `When <b>three elements</b> dwell in you, return to me. <small>(${n}/3)</small>`;
        this.ui.dialog('Sister Alba', '🕊️', text, [{ label: 'Thank you' }]);
        break;
      }
      case 'hermit': {
        const mastered = book.known().some((s) => book.isMaxed(s.id));
        if (!book.has('meditation') && mastered) {
          this.ui.dialog(
            'Old Hermit Oru',
            '🧙',
            'You have mastered a technique. Then you have learned to repeat — now learn to be still.',
            [{ label: 'Learn Meditation', action: () => book.learn('meditation', 'Taught by Old Hermit Oru') }],
          );
          return;
        }
        const tips = [
          'A mastered skill keeps growing. Use it past its limit and it will earn another morph.',
          'At the altar, a failed experiment is never wasted. Listen to what the essences whisper.',
          'Any element can cling to any honest attack. But the old forms — those must be found.',
          'I have seen swordsmen pick up a staff and discover things no pure mage ever could.',
          'Your class is not something you choose. It is something you become.',
          'Thunderhoof roams the plateau to the east. What lives in its heart might be worth the risk.',
        ];
        this.ui.dialog('Old Hermit Oru', '🧙', tips[Math.floor(Math.random() * tips.length)] + (mastered ? '' : '<br><br><small>Master a skill and I will teach you something.</small>'), [
          { label: 'Hm.' },
        ]);
        break;
      }
      case 'fisher':
        this.ui.dialog(
          'Fisher Pell',
          '🎣',
          `The end of the pier is the best spot. Wait for the bite, then reel in quick.${
            book.hasElement('water') ? ' You fish like the lake itself taught you.' : ` Folks say if you land enough, the lake sort of... gets into you. <small>(${book.flag('fish_caught')}/${FISH_FOR_WATER})</small>`
          }`,
          [{ label: 'Got it' }],
        );
        break;
      case 'fishing_spot':
        this.ui.fishingMinigame().then((ok) => {
          if (!ok) return;
          pl.bag.fish++;
          const n = book.incFlag('fish_caught');
          this.ui.log(`🐟 Caught a fish! (${pl.bag.fish} in bag)`, 'loot');
          if (n >= FISH_FOR_WATER) book.learnElement('water', 'Fishing at Mirror Lake');
        });
        break;
      case 'ore': {
        if (this.time.now < v.depletedUntil) {
          this.ui.toast('This vein is spent. It will recover soon.');
          return;
        }
        this.startChannel('⛏️ Mining...', 1200, false, () => {
          v.depletedUntil = this.time.now + 20000;
          pl.bag.ore++;
          const n = book.incFlag('ore_mined');
          this.skills.fxBurst(d.x, d.y, 0xf0b43c, 8);
          this.ui.log(`🪨 Mined ore (${pl.bag.ore} in bag)`, 'loot');
          if (n === 6) this.ui.log('Your arms feel heavier — your swing has learned something from the stone.', 'rare');
          if (n >= ORE_FOR_EARTH) book.learnElement('earth', 'Mining at Greystone Quarry');
        });
        break;
      }
      case 'wind_shrine':
        this.startChannel('🧘 Meditating...', 4000, true, () => {
          const n = book.incFlag('meditations');
          this.skills.fxRing(this.player.x, this.player.y, 80, 0x9be8c8, true);
          if (!book.learnElement('wind', 'Meditation at the Shrine of Winds'))
            this.ui.log(`🍃 Your mind clears. (${n} meditations)`, 'good');
        });
        break;
      case 'obelisk': {
        const n = book.flag('kill_gloomcap');
        if (book.hasElement('shadow')) {
          this.ui.dialog('Umbral Obelisk', '🌑', 'The obelisk is silent. Its darkness already lives in you.', [{ label: 'Leave' }]);
        } else if (n >= GLOOMCAPS_FOR_SHADOW) {
          this.ui.dialog('Umbral Obelisk', '🌑', 'With its guardians fallen, the obelisk opens. Shadow pours out — and into you.', [
            { label: 'Embrace it', action: () => book.learnElement('shadow', 'The Umbral Obelisk') },
          ]);
        } else {
          this.ui.dialog('Umbral Obelisk', '🌑', `A dark stone hums. Its guardians still lurk in the wood. <small>(${n}/${GLOOMCAPS_FOR_SHADOW} Gloomcaps)</small>`, [
            { label: 'Leave' },
          ]);
        }
        break;
      }
      case 'signpost':
        this.ui.dialog(
          'Signpost',
          '🪧',
          `<b>Hearthvale</b> — you are here.<br>
          ↑ <b>Mirror Lake</b> (fishing) · ↗ <b>Windcrest Hill</b> (shrine)<br>
          → <b>Greystone Quarry</b> (ore) · ↘ <b>Cinder Fields</b>, <b>Stormbreak Plateau</b> ⚠<br>
          ↙ <b>Gloomwood</b> ⚠ · ← <b>Hermit's hut</b>`,
          [{ label: 'OK' }],
        );
        break;
    }
  }

  private doForge(): void {
    const pl = this.session.player;
    if (pl.bag.ore < 2) return;
    pl.bag.ore -= 2;
    this.ui.forgeMinigame().then((good) => {
      if (good >= 2) {
        const n = this.book.incFlag('forge_success');
        const pay = 10 + good * 5;
        pl.coins += pay;
        this.ui.log(`🔨 A fine piece! Brann buys it for 🪙${pay}. (${n}/${FORGES_FOR_FIRE})`, 'good');
        if (n >= FORGES_FOR_FIRE) this.book.learnElement('fire', "Brann's forge in Hearthvale");
      } else {
        this.ui.log('🔨 The metal cracked. Brann shakes his head. Try again.', 'warn');
      }
    });
  }

  private startChannel(label: string, ms: number, interruptOnHit: boolean, done: () => void): void {
    this.player.path = [];
    this.channel = { label, start: this.time.now, until: this.time.now + ms, done, interruptOnHit };
  }

  private updateChannel(now: number): void {
    const c = this.channel;
    if (!c) return;
    this.ui.setChannel(c.label, (now - c.start) / (c.until - c.start));
    if (now >= c.until) {
      this.channel = null;
      this.ui.setChannel(null);
      c.done();
    }
  }

  private cancelChannel(): void {
    if (!this.channel) return;
    this.channel = null;
    this.ui.setChannel(null);
  }

  // =================================================================== fx

  private floatText(x: number, y: number, text: string, color: string, size: number): void {
    const t = this.add
      .text(x, y, text, {
        fontFamily: 'system-ui, sans-serif',
        fontStyle: 'bold',
        fontSize: `${size}px`,
        color,
        stroke: '#000',
        strokeThickness: 3,
      })
      .setOrigin(0.5)
      .setResolution(2)
      .setDepth(200000);
    this.tweens.add({ targets: t, y: y - 26, duration: 300, ease: 'Quad.out' });
    this.tweens.add({ targets: t, alpha: 0, delay: 450, duration: 400, onComplete: () => t.destroy() });
  }

  // =================================================================== GameController

  stats(): Stats {
    return computeStats(this.session.player, this.book.activeBonus(), this.buffs);
  }

  castSlot(i: number): void {
    if (this.dead) return;
    const pl = this.session.player;
    if (i < 0) {
      const w = WEAPONS[pl.weapon];
      if (!this.target || !this.target.alive) {
        let best: Monster | null = null;
        let bestD = 320;
        for (const m of this.monsters) {
          if (!m.alive) continue;
          const d = Math.hypot(m.x - this.player.x, m.y - this.player.y);
          if (d < bestD) {
            bestD = d;
            best = m;
          }
        }
        if (best) this.setTarget(best);
        else this.gateToast('No enemies nearby.');
      }
      if (this.target) this.castSkill(w.basic);
      return;
    }
    const id = pl.hotbar[i];
    if (id) this.castSkill(id);
  }

  assignSlot(i: number, id: string | null): void {
    const bar = this.session.player.hotbar;
    if (id) {
      const at = bar.indexOf(id);
      if (at >= 0) bar[at] = null;
    }
    bar[i] = id;
    this.ui.renderHotbar();
    this.save();
  }

  cooldown(id: string): { remain: number; total: number } {
    const c = this.cooldowns.get(id);
    if (!c) return { remain: 0, total: 0 };
    return { remain: Math.max(0, c.readyAt - this.time.now), total: c.total };
  }

  usable(id: string): { ok: boolean; reason?: string } {
    const s = this.reg.skill(id);
    if (!s || !this.book.has(id)) return { ok: false, reason: 'Unknown skill.' };
    const w = this.session.player.weapon;
    if (s.weapons && !s.weapons.includes(w))
      return { ok: false, reason: `Requires ${s.weapons.map((x) => WEAPONS[x].name).join(' or ')}.` };
    return { ok: true };
  }

  morph(from: string, to: string): void {
    const res = this.book.morph(from, to);
    if (!res.ok) this.ui.toast(esc(res.message));
    this.save();
    this.ui.refresh();
  }

  fuse(a: string, b: string): FuseResult {
    const res = this.book.fuse(a, b);
    this.save();
    this.hotbarDirty = true;
    return res;
  }

  setActiveClass(id: string | null): void {
    this.book.setActiveClass(id);
    const st = this.stats();
    const pl = this.session.player;
    pl.hp = Math.min(pl.hp, st.maxHp);
    pl.sp = Math.min(pl.sp, st.maxSp);
    this.ui.updateVitals();
    this.save();
  }

  buyWeapon(w: WeaponType): void {
    const pl = this.session.player;
    const def = WEAPONS[w];
    if (pl.ownedWeapons.includes(w) || pl.coins < def.price) return;
    pl.coins -= def.price;
    pl.ownedWeapons.push(w);
    this.ui.log(`Bought a <b>${def.name}</b>.`, 'loot');
    this.equipWeapon(w);
  }

  equipWeapon(w: WeaponType): void {
    const pl = this.session.player;
    if (!pl.ownedWeapons.includes(w)) return;
    pl.weapon = w;
    this.player.setWeapon(w);
    const def = WEAPONS[w];
    if (!this.book.has(def.basic)) this.book.learn(def.basic, `Picked up the ${def.name}`);
    this.ui.log(`${def.icon} Equipped <b>${def.name}</b>.`, 'info');
    this.ui.renderHotbar();
    this.save();
  }

  eatFish(): void {
    const pl = this.session.player;
    if (pl.bag.fish <= 0) return;
    pl.bag.fish--;
    const st = this.stats();
    pl.hp = Math.min(st.maxHp, pl.hp + st.maxHp * 0.4);
    this.ui.log('🐟 Delicious. HP restored.', 'good');
  }

  setPaused(paused: boolean): void {
    if (paused && this.scene.isActive()) this.scene.pause();
    else if (!paused && this.scene.isPaused()) this.scene.resume();
  }

  newGame(): void {
    Session.clear();
    location.reload();
  }

  save(): void {
    this.session.player.x = this.player?.x ?? this.session.player.x;
    this.session.player.y = this.player?.y ?? this.session.player.y;
    this.session.save();
  }
}
