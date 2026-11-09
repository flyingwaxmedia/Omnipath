// A monster's body in the world (actors lane): an animated sprite (MONSTER_ANIMS — walk frames while it moves, a slow
// idle otherwise), shadow, elite / warden aura, HP bar and a name plate in the bitmap pixel font. Game systems drive
// it through the members below (position, timers, statuses, stepToward, moveTo, flash, sync, reset…).
// Hit feel (vfx/juice.ts JuiceActor): hold (victim-local hit-stop: the sprite and its frame freeze, gameplay does
// not), impactFlash (tint-fill frames, one per rendered frame), a 1-frame squash and a whole-pixel recoil. The wind-up
// glow, buff auras and status overlays (stun stars…) are the VFX runtime's.
// Pixel rule (docs/QUALITY-PLAN.md §1): the sprite is never scaled except the 1-frame squash — elites show textures
// painted natively at their size with the tint baked in (art/monsters.ts monsterTexture), shadows are drawn at their
// width, flyers hover by a whole pixel and walkers breathe through their idle frames. Floating text over a monster
// goes in its lanes (render/text.ts TextAnchor).
import Phaser from 'phaser';
import type { BuffStat, ElementDef, MonsterDef, StatusKind } from '../../core/types';
import { isBlockedPx } from '../../core/world/compile';
import type { CompiledMap } from '../../core/world/types';
import { monsterTexture } from '../art/monsters';
import { DEPTH, ySort } from '../render/depths';
import { type TextAnchor, type WorldLabel, textAnchors, trackTextAnchor, untrackTextAnchor, worldLabel } from '../render/text';
import { monsterShadowW, shadowKey } from './actorArt';
import { HOVER_MONSTERS, monsterAnimKey, monsterAnimRate } from './rules';

export interface Dot {
  until: number;
  next: number;
  dmg: number;
  color: number;
  kind: StatusKind;
}

export interface StatusState {
  stunUntil: number;
  slowUntil: number;
  slowMult: number;
  dots: Dot[];
  vx: number;
  vy: number;
  /** Status markers (combos, vsStatus passives): kind -> until (scene time). */
  marks: Partial<Record<StatusKind, number>>;
}

/** A buff a monster technique put on its caster (`amount` is % for atk/speed/regen, flat for def). */
export interface MonsterBuff {
  stat: BuffStat;
  amount: number;
  until: number;
  color: number;
}

export const freshStatus = (): StatusState => ({
  stunUntil: 0,
  slowUntil: 0,
  slowMult: 1,
  dots: [],
  vx: 0,
  vy: 0,
  marks: {},
});

/** Warden enrage (HP < 50 %): moves and swings faster. Technique tempo lives in MonsterSkills. */
export const ENRAGE = { at: 0.5, speed: 1.15, attackDelay: 0.85 } as const;

/** Space kept between the HP bar and the name plate for the target chevron (art px; always kept, so the plate never
 *  jumps when the chevron comes and goes). */
export const CHEVRON_ROOM = 11;

/** Name plate alpha while it covers the player's body. */
const PLATE_SEE_THROUGH = 0.45;

/** HP bar width per rank (art px). */
const BAR_W = { warden: 64, elite: 40, common: 28 } as const;

let nextUid = 1;

export class Monster implements TextAnchor {
  readonly sprite: Phaser.GameObjects.Sprite;
  readonly shadow: Phaser.GameObjects.Image;
  readonly bar: Phaser.GameObjects.Graphics;
  /** Elites and wardens: soft coloured ring under the body (red pulse once a warden is enraged). */
  readonly aura: Phaser.GameObjects.Graphics | null;
  /** Instance id (new on every respawn): per-instance mastery caps and echo witness marks. */
  uid = nextUid++;
  x: number;
  y: number;
  hp: number;
  alive = true;
  provoked = false;
  respawnAt = 0;
  facing = 1;
  nextAttack = 0;
  nextWander = 0;
  wanderTo: { x: number; y: number } | null = null;
  returning = false;
  lastHitAt = 0;
  status: StatusState = freshStatus();
  /** Hit-XP grants per skill id earned on this instance (SkillBook.recordHit instanceHits). */
  hitGrants = new Map<string, number>();
  /** Echo technique ids witnessed on this instance (credited on kill). */
  witnessed = new Set<string>();
  /** The '👁' floater was shown for this instance. */
  eyeShown = false;
  /** Technique skill id -> ready time (scene time). */
  techReadyAt = new Map<string, number>();
  /** Technique tempo: earliest time the next technique may start (0 = not engaged yet). */
  nextTechAt = 0;
  /** While > now the monster is performing a technique (no moving / auto-attacks). */
  busyUntil = 0;
  /** Warden below 50 % HP. */
  enraged = false;
  buffs: MonsterBuff[] = [];
  /** Technique wind-up glow (0 = none, 0..1 = charging), drawn under the body. */
  charge = 0;
  chargeColor = 0xff3b3b;
  /** Next status mote (scene time). */
  fxAt = 0;
  /** Chase waypoints around walls (A*), refreshed at `chaseAt`. Empty = straight line. */
  chase: { x: number; y: number }[] = [];
  chaseAt = 0;
  /** Moved since the last sync (walk frames play while true). */
  moving = false;
  /** A chevron is shown over this monster (entities/actors.ts): the name plate makes room above the HP bar. */
  chevron = false;
  private bob = Math.random() * Math.PI * 2;
  /** Juice: tint-fill frames still to show, a flash on screen, squash frames, recoil offsets, the hold. */
  private flashQ: number[] = [];
  private flashing = false;
  private squashF = 0;
  private recoilQ: { x: number; y: number }[] = [];
  private holdUntil = 0;
  private held: { x: number; y: number } | null = null;
  /** After a hold the sprite catches up with the body over a few frames (no one-frame snap after a knockback). */
  private lag = { x: 0, y: 0 };
  private _label: WorldLabel | null = null;
  private lastX: number;
  private lastY: number;
  private stillFor = 0;
  /** Texture of frame 0 (its 2-frame loop is `<tex>_anim`). */
  readonly texture: string;
  private readonly hover: boolean;
  private readonly animKey: string | null;
  /** Always 1: the size (and an elite's tint) is painted into the texture (kept for older readers). */
  readonly baseScale = 1;
  /** The texture carries the def's size and tint (no runtime tint for it). */
  private readonly baked: boolean;
  readonly textRole = 'foe' as const;

  constructor(
    readonly scene: Phaser.Scene,
    readonly def: MonsterDef,
    readonly spawn: { x: number; y: number; r: number },
    readonly element: ElementDef | undefined,
    /** Spawn slot id (elite respawn timers survive map changes). */
    readonly slot: string,
  ) {
    this.x = spawn.x;
    this.y = spawn.y;
    this.hp = def.hp;
    const look = monsterTexture(scene, def);
    const tex = look.key;
    this.baked = look.baked;
    this.shadow = scene.add.image(this.x, this.y, shadowKey(scene, monsterShadowW(def.rank, def.scale ?? 1))).setDepth(DEPTH.SHADOW);
    this.aura = def.rank !== 'common' ? scene.add.graphics().setBlendMode(Phaser.BlendModes.ADD).setDepth(DEPTH.AURA) : null;
    this.texture = tex;
    this.hover = HOVER_MONSTERS.has(look.species);
    this.lastX = this.x;
    this.lastY = this.y;
    this.sprite = scene.add.sprite(this.x, this.y, tex).setOrigin(0.5, 0.9);
    this.animKey = this.ensureAnim(tex, look.species);
    // Start on a random frame so a crowd never moves in lockstep.
    if (this.animKey) this.sprite.play({ key: this.animKey, startFrame: Math.random() < 0.5 ? 0 : 1 });
    this.bar = scene.add.graphics().setDepth(DEPTH.HP_BAR);
    // Name labels are created lazily (only targeted monsters and wardens show one): up to 60 monsters per map.
    if (this.warden) this.label.setVisible(true);
    this.restoreTint();
    trackTextAnchor(scene, this);
    this.sync(0);
  }

  /** The 2-frame loop of a texture (a variant painted after boot registers its own, at its species' speed). */
  private ensureAnim(tex: string, species: string): string | null {
    const key = monsterAnimKey(tex);
    const anims = this.scene.anims;
    if (anims.exists(key)) return key;
    if (tex === species || !this.scene.textures.exists(`${tex}_1`)) return null;
    const base = anims.get(monsterAnimKey(species));
    anims.create({ key, frames: [{ key: tex }, { key: `${tex}_1` }], frameRate: base?.frameRate ?? 4, repeat: -1 });
    return key;
  }

  /** Name plate in the bitmap pixel font (created on first use: only targeted monsters and wardens show one). */
  get label(): WorldLabel {
    if (!this._label) {
      const e = this.element;
      const color = e ? `#${e.color.toString(16).padStart(6, '0')}` : this.warden ? '#ffd0c0' : '#ffffff';
      this._label = worldLabel(this.scene, this.x, this.y, `${this.def.name} Lv ${this.def.level}`, {
        color,
        size: this.warden ? 13 : 10,
        bold: this.warden || this.elite,
      }).setVisible(false);
    }
    return this._label;
  }

  /** Top of the body (world y) — where the HP bar sits; plates and chevrons go above it. */
  get top(): number {
    return this.y - this.sprite.displayHeight * 0.9 - 4;
  }

  /** Bottom of the name plate (world y): fixed above the HP bar and the chevron's room. */
  private get plateY(): number {
    return Math.round(this.top) - 3 - CHEVRON_ROOM;
  }

  // ---------------------------------------------------------------- TextAnchor (floating text lanes)

  textTop(): number {
    const top = Math.round(this.top);
    if (this._label?.visible) return this.plateY - this._label.height;
    if (this.chevron) return top - CHEVRON_ROOM;
    if (this.hp < this.maxHp || this.warden) return top - 2;
    return top + 3;
  }

  textBottom(): number {
    return Math.round(this.y) + 4;
  }

  textHalfW(): number {
    const bar = BAR_W[this.def.rank] / 2 + 1;
    return Math.ceil(Math.max(this.radius, bar, this._label?.visible ? this._label.width / 2 : 0));
  }

  textLive(): boolean {
    return this.alive && this.sprite.active && this.sprite.visible;
  }

  textBody(): { x0: number; y0: number; x1: number; y1: number } {
    const half = Math.round(this.sprite.displayWidth / 2);
    const x = Math.round(this.x);
    return { x0: x - half, y0: Math.round(this.top) + 4, x1: x + half, y1: Math.round(this.y) };
  }

  get radius(): number {
    return this.def.radius;
  }

  get maxHp(): number {
    return this.def.hp;
  }

  get warden(): boolean {
    return this.def.rank === 'warden';
  }

  get elite(): boolean {
    return this.def.rank === 'elite';
  }

  get stunned(): boolean {
    return this.scene.time.now < this.status.stunUntil;
  }

  get frozen(): boolean {
    return this.stunned && (this.status.marks.freeze ?? 0) > this.scene.time.now;
  }

  private buffSum(stat: BuffStat, now: number): number {
    let n = 0;
    for (const b of this.buffs) if (b.stat === stat && b.until > now) n += b.amount;
    return n;
  }

  speedMult(now: number): number {
    const slow = now < this.status.slowUntil ? this.status.slowMult : 1;
    return slow * (1 + this.buffSum('speed', now) / 100) * (this.enraged ? ENRAGE.speed : 1);
  }

  /** Technique / auto-attack ATK after buffs. */
  atk(now: number): number {
    return this.def.atk * (1 + this.buffSum('atk', now) / 100);
  }

  /** DEF after buffs (flat). */
  defense(now: number): number {
    return this.def.def + this.buffSum('def', now);
  }

  /** HP regenerated per second from buffs (% of max HP). */
  regenPct(now: number): number {
    return this.buffSum('regen', now);
  }

  attackDelay(): number {
    return this.def.attackDelay * (this.enraged ? ENRAGE.attackDelay : 1);
  }

  /** Active status kinds (read BEFORE a combo consumes them). */
  statuses(now: number): StatusKind[] {
    const out: StatusKind[] = [];
    for (const [k, until] of Object.entries(this.status.marks) as [StatusKind, number][]) if (until > now) out.push(k);
    return out;
  }

  /** Moves toward (tx, ty) with axis-sliding collision. True when arrived. */
  stepToward(map: CompiledMap, tx: number, ty: number, speed: number, dt: number): boolean {
    const dx = tx - this.x;
    const dy = ty - this.y;
    const d = Math.hypot(dx, dy);
    if (d < 2) return true;
    const step = Math.min(d, speed * dt);
    this.moveTo(map, this.x + (dx / d) * step, this.y + (dy / d) * step);
    if (Math.abs(dx) > 1) this.facing = dx > 0 ? 1 : -1;
    return false;
  }

  moveTo(map: CompiledMap, nx: number, ny: number): void {
    if (!isBlockedPx(map, nx, ny)) {
      this.x = nx;
      this.y = ny;
    } else if (!isBlockedPx(map, nx, this.y)) this.x = nx;
    else if (!isBlockedPx(map, this.x, ny)) this.y = ny;
  }

  /** The resting tint (TintArbiter order: impact flash frames > frozen > stunned > slowed > elite / def tint). */
  restoreTint(): void {
    if (this.flashQ.length || this.flashing) return;
    if (this.frozen) this.sprite.setTint(0xaee9ff);
    else if (this.stunned) this.sprite.setTint(0xdddddd);
    else if (this.scene.time.now < this.status.slowUntil) this.sprite.setTint(0x9fd8ff);
    else if (this.def.tint !== undefined && !this.baked) this.sprite.setTint(this.def.tint);
    else this.sprite.clearTint();
  }

  sync(dt: number): void {
    const now = this.scene.time.now;
    const step = Math.hypot(this.x - this.lastX, this.y - this.lastY);
    this.lastX = this.x;
    this.lastY = this.y;
    // Moving = covering ground at a walking pace (knockback slides and separation nudges count too, briefly).
    if (dt > 0 && step / dt > 8) {
      this.moving = true;
      this.stillFor = 0;
    } else if ((this.stillFor += dt) > 0.12) this.moving = false;
    const held = now < this.holdUntil && this.held !== null;
    if (!held && this.held) {
      this.lag = { x: this.held.x - this.x, y: this.held.y - this.y };
      this.held = null;
    }
    if (!held) this.bob += dt * (this.stunned ? 0 : this.enraged ? 9 : 6);
    if (!held && (this.lag.x || this.lag.y)) {
      this.lag.x = Math.abs(this.lag.x) < 1 ? 0 : this.lag.x * 0.45;
      this.lag.y = Math.abs(this.lag.y) < 1 ? 0 : this.lag.y * 0.45;
    }
    // The frames carry the motion (walkers breathe through their slow idle frames); flyers hover by one whole pixel.
    const hoverDy = this.hover && !held && !this.stunned && Math.sin(this.bob * 0.5) > 0 ? -1 : 0;
    // Recoil: whole pixels along the blow, held through the hit-stop, then home one step per frame.
    const rc = this.recoilQ[0];
    if (rc && !held) this.recoilQ.shift();
    const bx = held ? this.held!.x : this.x + this.lag.x;
    const by = held ? this.held!.y : this.y + this.lag.y;
    this.sprite.setPosition(Math.round(bx) + (rc?.x ?? 0), Math.round(by) + (rc?.y ?? 0) + hoverDy);
    this.sprite.setFlipX(this.facing < 0);
    if (this.squashF > 0) {
      // 1-frame squash (the one scale the pixel rule allows): 2 px wider, 2 px shorter.
      this.squashF--;
      const w = Math.max(8, this.sprite.width);
      const h = Math.max(8, this.sprite.height);
      this.sprite.setScale((w + 2) / w, (h - 2) / h);
    } else if (this.sprite.scaleX !== 1 || this.sprite.scaleY !== 1) this.sprite.setScale(1);
    this.shadow.setPosition(Math.round(this.x), Math.round(this.y) + 1);
    this.sprite.setDepth(ySort(this.y));
    // Impact flash frames (white -> colour), then the normal tint.
    if (this.flashQ.length) {
      this.sprite.setTintFill(this.flashQ.shift()!);
      this.flashing = true;
    } else if (this.flashing) {
      this.flashing = false;
      this.restoreTint();
    }
    if (held) {
      if (this.sprite.anims.isPlaying) this.sprite.anims.pause();
    } else this.syncAnim();
    if (this.aura) this.drawAura(now);
    const top = this.top;
    if (this._label?.visible) {
      const lb = this._label.setPosition(Math.round(this.x), this.plateY);
      // a plate that lands on the player's body (the monster stands just below them) turns see-through
      const x0 = lb.x - lb.width / 2;
      const y0 = lb.y - lb.height;
      const over = textAnchors(this.scene, 'player').some((p) => {
        const b = p.textBody();
        return x0 < b.x1 && b.x0 < x0 + lb.width && y0 < b.y1 && b.y0 < lb.y;
      });
      lb.setAlpha(over ? PLATE_SEE_THROUGH : 1);
    }
    const g = this.bar;
    g.clear();
    if (this.hp < this.maxHp || this.warden) {
      // whole pixels, so the bar sits still under the plate
      const w = BAR_W[this.def.rank];
      const x0 = Math.round(this.x) - w / 2;
      const y0 = Math.round(top);
      g.fillStyle(0x000000, 0.6).fillRect(x0 - 1, y0 - 1, w + 2, 5);
      g.fillStyle(this.warden ? (this.enraged ? 0xff2a2a : 0xff4d6d) : 0xe84d4d, 1).fillRect(x0, y0, Math.round((w * Math.max(0, this.hp)) / this.maxHp), 3);
      if (this.warden) g.fillStyle(0xffffff, 0.5).fillRect(x0 + w / 2, y0 - 1, 1, 5);
    }
  }

  /** Walk frames while moving (faster while chasing), a slow idle otherwise; frozen while stunned. */
  private syncAnim(): void {
    const a = this.sprite.anims;
    if (!this.animKey) return;
    if (this.stunned) {
      if (a.isPlaying) a.pause();
      return;
    }
    if (a.isPaused) a.resume();
    if (!a.isPlaying) this.sprite.play(this.animKey);
    a.timeScale = monsterAnimRate({ moving: this.moving, chasing: this.provoked, enraged: this.enraged, hover: this.hover });
  }

  private drawAura(now: number): void {
    const a = this.aura!;
    a.clear();
    const rx = this.radius * (this.warden ? 1.25 : 1.5);
    const t = now / 400 + this.uid;
    if (this.enraged) {
      const k = 0.5 + 0.5 * Math.sin(now / 120);
      a.fillStyle(0xff2a1a, 0.16 + 0.12 * k).fillEllipse(this.x, this.y, rx * 2.3, rx * 0.95);
      a.lineStyle(3, 0xff4a2a, 0.55 + 0.35 * k).strokeEllipse(this.x, this.y, rx * 2.3 + 6 * k, rx * 0.95 + 3 * k);
    } else {
      const col = this.element?.color ?? 0xffd76a;
      const base = this.warden ? 0.08 : 0.14;
      a.fillStyle(col, base + Math.sin(t) * 0.05).fillEllipse(this.x, this.y, rx * 2, rx * 0.8);
      a.lineStyle(2, col, (this.warden ? 0.3 : 0.45) + Math.sin(t) * 0.15).strokeEllipse(this.x, this.y, rx * 2, rx * 0.8);
    }
    // Buff auras and the technique wind-up glow are the VFX runtime's (buffApplied, monsterTelegraph).
  }

  setVisible(v: boolean): void {
    this.sprite.setVisible(v);
    if (v) {
      this.lastX = this.x;
      this.lastY = this.y;
      this.moving = false;
    } else if (this.sprite.anims.isPlaying) this.sprite.anims.pause(); // dead / not here: no frames to step (sync resumes)
    this.shadow.setVisible(v);
    this.bar.setVisible(v);
    this.aura?.setVisible(v);
    if (this._label || (v && this.warden)) this.label.setVisible(v && this.warden);
  }

  /** A plain 2-frame tint flash (damage-over-time ticks). */
  flash(color = 0xff6666): void {
    this.impactFlash([color, color]);
  }

  // ---------------------------------------------------------------- juice (vfx/juice.ts JuiceActor)

  /** Victim-local hit-stop: the sprite and its frame hold for `ms` (gameplay keeps running underneath). */
  hold(ms: number): void {
    const now = this.scene.time.now;
    if (now >= this.holdUntil || !this.held) this.held = { x: this.x, y: this.y };
    this.holdUntil = Math.max(this.holdUntil, now + ms);
  }

  impactFlash(frames: readonly number[]): void {
    this.flashQ = [...frames];
  }

  squash(): void {
    this.squashF = 1;
  }

  recoil(ang: number, px: number): void {
    const at = (k: number) => ({ x: Math.round(Math.cos(ang) * k), y: Math.round(Math.sin(ang) * k * 0.5) });
    this.recoilQ = [at(px), at(Math.round(px / 2)), at(0)];
  }

  /** Moves every scene-time timer forward by `ms` (the world was paused or hit-stopped). */
  shiftTime(ms: number): void {
    const st = this.status;
    st.stunUntil += ms;
    st.slowUntil += ms;
    for (const d of st.dots) {
      d.until += ms;
      d.next += ms;
    }
    for (const k of Object.keys(st.marks) as StatusKind[]) st.marks[k]! += ms;
    for (const b of this.buffs) b.until += ms;
    for (const [k, v] of this.techReadyAt) this.techReadyAt.set(k, v + ms);
    this.holdUntil += ms;
    this.nextAttack += ms;
    this.nextWander += ms;
    this.busyUntil += ms;
    this.lastHitAt += ms;
    this.fxAt += ms;
    this.chaseAt += ms;
    if (this.nextTechAt) this.nextTechAt += ms;
    if (Number.isFinite(this.respawnAt)) this.respawnAt += ms;
  }

  /** Fresh instance state for a respawn (new uid: per-instance caps and witness marks reset). */
  reset(): void {
    this.uid = nextUid++;
    this.alive = true;
    this.hp = this.maxHp;
    this.provoked = false;
    this.returning = false;
    this.status = freshStatus();
    this.hitGrants.clear();
    this.witnessed.clear();
    this.eyeShown = false;
    this.techReadyAt.clear();
    this.nextTechAt = 0;
    this.busyUntil = 0;
    this.enraged = false;
    this.buffs = [];
    this.charge = 0;
    this.chase = [];
    this.chaseAt = 0;
    this.x = this.spawn.x;
    this.y = this.spawn.y;
  }

  destroy(): void {
    untrackTextAnchor(this.scene, this);
    this.sprite.destroy();
    this.shadow.destroy();
    this.bar.destroy();
    this._label?.destroy();
    this.aura?.destroy();
  }
}
