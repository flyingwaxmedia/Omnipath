// World bridge (docs/VFX.md §8.9): the bus events the player-skill bridge (bridge.ts) leaves alone — monster
// techniques and auto-attacks, the player's statuses, deaths, spawns, enrage, the Tier III class aura, the hex ward,
// gather / discovery sparkles and the named world extras — turned into plays on the runtime (play.ts VfxStage), plus
// the hit feel on the player (juice). Phaser-free (types only): tests/vfx-world.test.ts drives it with a fake stage.
//
//   monsterTelegraph     the exact live tell (TelegraphFx: event.live geometry, event.phases timing) + the caster cue
//                        (converge motes, danger ring under the feet), the mouth charge orb (shots), the aura
//                        activation (buffs) and, for elites / wardens, a charge glow pool under the body
//   monsterTelegraphEnd  cancel: the cue ends, the tell dissolves (TelegraphFx), a fizzle at the caster
//   skillPulse           each monster swing / pulse / volley release: the technique's cast phase at its true reach
//                        (spin + strike geometry scaled by the caster's radius), spin floor bands, heavy landings
//   projectileSpawn/End  monster shot bodies + trails (quota 0.5), fizzle / dust ends
//   chainHop / chainLaunch  the zap to the player (cast-time bolt) / a fizzle when nothing was in reach
//   novaBlast            the monster area phase (0.65 aspect pieces), warden trauma by proximity
//   dash                 monster dash cast, ghost trail (its own sprite), landing
//   buffApplied          monster buff activation + aura loop until it ends; the player's hex ward is tracked
//   playerHurt           the technique's impact on the player, or the auto-attack (claws / lash / sting / slam /
//                        spark by monster family) from the attacker; hit-stop (halved), a 1-frame white flash
//                        (the juice rig's per-victim flash gate), squash, recoil, a kick along the blow, trauma 0.35
//                        on heavy blows; the ward flares on a hit
//   statusApplied        the player's status overlays (<= 2 loops by priority, never starved), immune glint
//   death                monster: white frames, then the pop (nova blast in the killer's family + chips + puff);
//                        player: a danger puff, overlays end
//   monsterSpawn         spawn pop (white frames, dust puff, ring)
//   enrage               two danger rings + burst, trauma 0.5 by proximity
//   gather / discovery   sparkles at the node / over the player
import { hashSeed } from '../../core/rng';
import type { MonsterDef, SkillDef, StatusKind } from '../../core/types';
import type { Monster } from '../entities/Monster';
import type { EventBus, GameEvents, Scope, TellPhase } from '../events';
import { bodyOf, pulsePieces } from './bridge';
import { holdFor } from './juice';
import type { GhostSource, JuiceHooks, LivePt, PlayCtx, TellPhaseView, VfxGroup, VfxStage } from './play';
import { piece, type Ink } from './pieces';
import { CHIP_RAMP, hexToRgb, RAMPS } from './ramps';
import { deathPieces, deriveAttackVfx, deriveVfx, extraPieces, impactPieces, statusPieces, statusPip } from './recipe';
import { ANCHOR_DY, DECAL_BUCKETS, FAMILY_IDS, VFX_BUDGET, ZONE_ASPECT, floorBucket, type AuraMotif, type FamilyId, type HitOutcome, type RampId, type VfxPiece, type VfxRecipe } from './types';

export interface WorldPlayer extends GhostSource {
  readonly x: number;
  readonly y: number;
}

export interface WorldHost {
  player(): WorldPlayer | null;
  /** Scene time (ms): timing records, untilMs and buff ends are on this clock. */
  sceneNow(): number;
  /** Hit feel on actors and the camera (juice rig), or null (tests, Canvas fallback). */
  juice: JuiceHooks | null;
  /** The worn class's Tier III aura, or null (art/classLooks auraColor). */
  classAura(): { motif: AuraMotif; family: FamilyId } | null;
  /** A monster's hide colour (art/monsters.ts monsterHideColor, elite tint applied), or null. */
  hideColor?(m: Monster): number | null;
}

/** R3 of the hide-chip bake ramp (ramps.ts CHIP_RAMP): the chips' fill stop that lands on the hide colour. */
const CHIP_R3 = hexToRgb(RAMPS[CHIP_RAMP].R[3]);

/**
 * Bob multiply tint that turns the death chips into the monster's hide colour: each channel is the hide channel over
 * the CHIP_RAMP R3 channel (capped at 255), so the chips' fill lands on the hide colour and their R5 glint stays a
 * lighter shade of it. The runtime bakes tinted chips from CHIP_RAMP (WebGL only: Canvas bobs take no tint and keep
 * the dust chips).
 */
export function chipTint(hide: number): number {
  const ch = (v: number, base: number) => Math.min(255, Math.round((v * 255) / Math.max(1, base)));
  return (ch((hide >> 16) & 255, CHIP_R3[0]) << 16) | (ch((hide >> 8) & 255, CHIP_R3[1]) << 8) | ch(hide & 255, CHIP_R3[2]);
}

const DANGER: Ink = { ramp: 'danger', motif: 'danger', lut: 'base' };
const STATUS_PRIORITY: readonly StatusKind[] = ['freeze', 'stun', 'shock', 'burn', 'poison', 'bleed', 'soak', 'slow'];
const ONE_SHOT: ReadonlySet<StatusKind> = new Set<StatusKind>(['knockback', 'smite', 'pull']);
const inkOf = (f: FamilyId, lut: Ink['lut'] = 'base'): Ink => ({ ramp: f as RampId, motif: f, lut });
const feet = (dy = 0) => ({ to: 'body' as const, dy });

/** The family whose R3 is nearest a legacy colour (legacy fxRing / fxBurst adapters). */
export function familyOfColor(color: number): FamilyId {
  const r = (color >> 16) & 255,
    g = (color >> 8) & 255,
    b = color & 255;
  let best: FamilyId = 'holy';
  let bd = Infinity;
  for (const f of FAMILY_IDS) {
    if (f === 'danger') continue;
    const [R, G, B] = hexToRgb(RAMPS[f as RampId].R[3]);
    const d = (R - r) ** 2 + (G - g) ** 2 + (B - b) ** 2;
    if (d < bd) {
      bd = d;
      best = f;
    }
  }
  return best;
}

/** The named world extras (Interactions, Combat.rest, SkillSystem's legacy fx adapters). */
export type WorldExtra = 'chest' | 'waystone' | 'campfire' | 'meditate' | 'rest' | 'reveal' | 'blink';

interface TellRec {
  group: VfxGroup;
  cues: VfxGroup[];
  m: Monster;
}

export class WorldBridge {
  private recipes = new Map<string, VfxRecipe | null>();
  private attacks = new Map<string, VfxRecipe | null>();
  private tells = new Map<number, TellRec>();
  private movers = new Map<number, VfxGroup>();
  private playerStatus = new Map<StatusKind, VfxGroup>();
  private auras = new WeakMap<Monster, Map<string, VfxGroup>>();
  /** The hex ward: its end on the world clock (stage.now) and family, so a blow on the player flares it. */
  private ward: { until: number; family: FamilyId } | null = null;
  private classAuraKey = '';
  private classAuraGroup: VfxGroup | null = null;
  private seq = 0;

  constructor(
    private readonly stage: VfxStage,
    private readonly host: WorldHost,
  ) {}

  attach(scope: Scope<GameEvents>): this {
    for (const [k, fn] of this.handlers()) scope.on(k as keyof GameEvents, fn as never);
    return this;
  }

  /** For tests: subscribe straight to a bus. */
  attachBus(bus: EventBus<GameEvents>): () => void {
    const offs = this.handlers().map(([k, fn]) => bus.on(k as keyof GameEvents, fn as never));
    return () => offs.forEach((o) => o());
  }

  private handlers(): [string, (e: never) => void][] {
    return [
      ['monsterTelegraph', (e: GameEvents['monsterTelegraph']) => this.monsterTelegraph(e)],
      ['monsterTelegraphEnd', (e: GameEvents['monsterTelegraphEnd']) => this.monsterTelegraphEnd(e)],
      ['skillPulse', (e: GameEvents['skillPulse']) => this.skillPulse(e)],
      ['projectileSpawn', (e: GameEvents['projectileSpawn']) => this.projectileSpawn(e)],
      ['projectileEnd', (e: GameEvents['projectileEnd']) => this.projectileEnd(e)],
      ['chainHop', (e: GameEvents['chainHop']) => this.chainHop(e)],
      ['chainLaunch', (e: GameEvents['chainLaunch']) => this.chainLaunch(e)],
      ['novaBlast', (e: GameEvents['novaBlast']) => this.novaBlast(e)],
      ['dash', (e: GameEvents['dash']) => this.dash(e)],
      ['buffApplied', (e: GameEvents['buffApplied']) => this.buffApplied(e)],
      ['playerHurt', (e: GameEvents['playerHurt']) => this.playerHurt(e)],
      ['statusApplied', (e: GameEvents['statusApplied']) => this.statusApplied(e)],
      ['death', (e: GameEvents['death']) => this.death(e)],
      ['monsterSpawn', (e: GameEvents['monsterSpawn']) => this.monsterSpawn(e)],
      ['enrage', (e: GameEvents['enrage']) => this.enrage(e)],
      ['gather', (e: GameEvents['gather']) => this.gather(e)],
      ['discovery', (e: GameEvents['discovery']) => this.discovery(e)],
      ['classChanged', () => this.refreshClassAura()],
      ['mapEnter', () => this.refreshClassAura()],
    ] as [string, (e: never) => void][];
  }

  // ---------------------------------------------------------------- recipes & warm set

  private mrecipe(skill: SkillDef): VfxRecipe | null {
    let r = this.recipes.get(skill.id);
    if (r === undefined) {
      try {
        r = deriveVfx(skill, 'monster');
      } catch (err) {
        console.error('[omnipath] vfx monster recipe failed', skill.id, err);
        r = null;
      }
      this.recipes.set(skill.id, r);
    }
    return r;
  }

  private attackRecipe(m: Monster): VfxRecipe | null {
    const d = m.def;
    let r = this.attacks.get(d.id);
    if (r === undefined) {
      try {
        r = deriveAttackVfx({ id: d.id, family: d.family, element: d.element, rank: d.rank, size: d.size });
      } catch (err) {
        console.error('[omnipath] vfx attack recipe failed', d.id, err);
        r = null;
      }
      this.attacks.set(d.id, r);
    }
    return r;
  }

  /**
   * Warm set for a map's spawns (docs/VFX.md §8.5): every technique phase (monster owner), each auto-attack, the
   * statuses they put on the player, death pops and the spawn pop. Baked behind the fade / in idle slices.
   */
  warmMap(monsters: readonly MonsterDef[], skill: (id: string) => SkillDef | undefined): void {
    const out: VfxPiece[] = [];
    const seen = new Set<string>();
    for (const d of monsters) {
      if (seen.has(d.id)) continue;
      seen.add(d.id);
      try {
        const a = deriveAttackVfx({ id: d.id, family: d.family, element: d.element, rank: d.rank, size: d.size });
        out.push(...(a.phases.cast ?? []), ...(a.phases.impact ?? []));
      } catch {
        /* reported when used */
      }
      for (const t of d.techniques ?? []) {
        const s = skill(t.skill);
        const r = s && this.mrecipe(s);
        if (!r) continue;
        // Tell rims, fills and beads are TelegraphFx rasters (no atlas strips); everything else is warmed.
        for (const [ph, list] of Object.entries(r.phases)) out.push(...(list ?? []).filter((p) => p.component !== 'tell' && !(ph === 'telegraph' && (p.component === 'decal' || p.component === 'ring'))));
        out.push(...impactPieces(r, { index: 0, sincePrevMs: 1000, crit: false, relation: 'neutral', killed: false, target: 'player' }));
      }
      out.push(...deathPieces(d.rank === 'warden' ? 'W' : d.size === 'L' ? 'L' : d.size === 'M' ? 'M' : 'S', 'steel', 'monster'));
    }
    out.push(...this.spawnPieces('M'), ...extraPieces('enrage'));
    this.stage.warm(out);
  }

  // ---------------------------------------------------------------- helpers

  private seed(...k: (number | string)[]): number {
    return hashSeed('world', ++this.seq, ...k);
  }

  private isMonster(a: unknown): a is Monster {
    return !!a && a !== 'player' && typeof a === 'object';
  }

  /** Where a monster's shots, chains and mouth charge leave from (MonsterSkills: m.y - min(30, h / 2)). */
  private mouth(m: Monster): LivePt {
    return {
      get x() {
        return m.x;
      },
      get y() {
        // Anchors at caster dy -14 (hand) land on the mouth.
        return m.y - Math.min(30, m.sprite.displayHeight * 0.5) + 14;
      },
    };
  }

  private playerPt(dy = 0): LivePt | undefined {
    const p = this.host.player();
    if (!p) return undefined;
    return {
      get x() {
        return p.x;
      },
      get y() {
        return p.y + dy;
      },
    };
  }

  /** Monster blasts shake the camera only near the player (full within r + 40, none past r + 200). */
  private near(x: number, y: number, r: number): number {
    const p = this.host.player();
    if (!p) return 0;
    const d = Math.hypot(p.x - x, p.y - y) - r;
    return d <= 40 ? 1 : d >= 200 ? 0 : 1 - (d - 40) / 160;
  }

  /**
   * A scene-time end (untilMs) as a deadline on the runtime's world clock, which stands still through the panel
   * pauses, loop sleeps and hit-stops Combat shifts its timers over (a captured scene-time end would not move).
   */
  private deadline(untilMs: number): number {
    return this.stage.now() + Math.max(0, untilMs - this.host.sceneNow());
  }

  /** Recipe pieces re-timed to the real tell (charge cues): loops live for the wind-up. */
  private retime(pieces: readonly VfxPiece[], ms: number): VfxPiece[] {
    return pieces.map((p) => ({ ...p, lifeMs: Math.max(1, Math.round(ms)) }) as VfxPiece);
  }

  // ---------------------------------------------------------------- monster techniques

  monsterTelegraph(e: GameEvents['monsterTelegraph']): void {
    const m = e.monster;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const host = this.host;
    const id = e.id ?? hashSeed('tell', e.skillId, Math.round(host.sceneNow()));
    const timing = e.timing;
    const phases: readonly TellPhase[] = e.phases ?? (timing ? [{ get start() { return timing.start; }, get at() { return timing.at; }, get state() { return host.sceneNow() < timing.at ? 'pending' as const : 'resolved' as const; } }] : []);
    const live = e.live ?? (e.tell ? () => e.tell! : null);
    let group: VfxGroup = { end() {}, done: true };
    if (live && phases.length) {
      const phase = (): TellPhaseView | null => {
        if (!m.alive) return { start: 0, at: 1, state: 'cancelled' };
        for (let i = 0; i < phases.length; i++) {
          const p = phases[i];
          if (p.state === 'cancelled') return p;
          if (p.state !== 'pending') continue;
          // A follow-up swing / pulse starts half full: the area is already known, only the beat is new.
          return i === 0 ? p : { start: p.start - (p.at - p.start), at: p.at, state: 'pending' };
        }
        return null;
      };
      group = this.stage.telegraph({ geom: () => (m.alive ? live() : null), phase, look: { family: (r.imbue ?? r.family) as RampId, danger: e.shape !== 'buff' } });
    }
    // The caster cue for the wind-up: converge motes + the danger ring under the feet (the ring scaled to the body).
    const windup = phases[0];
    const alive = () => m.alive && (!windup || windup.state === 'pending');
    const ms = e.durationMs;
    const cues: VfxGroup[] = [];
    const ctx: PlayCtx = { owner: 'monster', caster: m, body: m, target: m, ang: () => Math.atan2((host.player()?.y ?? m.y) - m.y, (host.player()?.x ?? m.x) - m.x), seed: this.seed(e.skillId, 'cue'), quota: r.quota, alive, rScale: (m.radius + 4) / 16 };
    cues.push(this.stage.play(this.retime(r.phases.charge ?? [], ms), ctx));
    const tellExtras = (r.phases.telegraph ?? []).filter((p) => p.component === 'orb' || p.component === 'aura' || p.component === 'missile');
    if (tellExtras.length) {
      const body = bodyOf(m);
      const ex = this.retime(
        tellExtras.map((p) => (p.component === 'aura' ? ({ ...p, params: { ...p.params, body } } as VfxPiece) : p)),
        ms,
      );
      cues.push(this.stage.play(ex, { ...ctx, caster: e.shape === 'projectile' ? this.mouth(m) : m, aim: { x: e.at.x, y: e.at.y }, rScale: undefined }));
    }
    // A chain's charge links the caster to the player while the player stands in reach (beads every 6 px).
    if (e.shape === 'chain' && live) {
      const p = host.player();
      const reach = (): boolean => {
        const g = live();
        const pp = host.player();
        return !!pp && g.kind === 'range' && Math.hypot(pp.x - g.x, pp.y - g.y) <= g.r + 12;
      };
      if (p) cues.push(this.stage.play([piece('motes', { kind: 'bead', size: 2 }, DANGER, { anchor: { to: 'path', dy: 0 }, place: { pattern: 'path', everyPx: 6 } })], { ...ctx, caster: this.mouth(m), body: this.playerPt(-18), alive: () => alive() && reach(), rScale: undefined }));
    }
    // Elites and wardens gather light under the body while they charge.
    if (e.rank && e.rank !== 'common') {
      const fam = (r.imbue ?? r.family) as FamilyId;
      const glow = piece('decal', { kind: 'fill', r: floorBucket(Math.max(16, m.radius + 10), DECAL_BUCKETS), aspect: ZONE_ASPECT, density: 0.5, shape: 'disc' }, inkOf(fam === 'danger' ? 'steel' : fam, 'monster'), { anchor: { to: 'caster', dy: 0 }, layer: 'glow', blend: 'add', lifeMs: Math.max(1, Math.round(ms)) });
      cues.push(this.stage.play([glow], { ...ctx, rScale: undefined }));
    }
    this.tells.set(id, { group, cues, m });
  }

  monsterTelegraphEnd(e: GameEvents['monsterTelegraphEnd']): void {
    const t = this.tells.get(e.id);
    if (!t) return;
    for (const g of t.cues) g.end();
    this.tells.delete(e.id);
    if (e.reason !== 'cancel' || !e.monster.alive) return;
    // Interrupted: the charge fizzles at the caster (the tell itself dissolves in TelegraphFx).
    const m = e.monster;
    this.stage.play(
      [piece('tell', { piece: 'fizzle', danger: true }, DANGER, { anchor: { to: 'caster', dy: ANCHOR_DY.chest }, layer: 'rim' }), piece('burst', { cls: 'fizzle', size: 's' }, { ramp: 'smoke', motif: 'steel', lut: 'base' }, { anchor: { to: 'caster', dy: ANCHOR_DY.chest } })],
      { owner: 'monster', caster: { x: m.x, y: m.y }, ang: 0, seed: this.seed('fizzle') },
    );
  }

  skillPulse(e: GameEvents['skillPulse']): void {
    if (!this.isMonster(e.owner)) return;
    const m = e.owner;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const sh = e.skill.shape;
    const nominal = sh.kind === 'strike' ? sh.range : sh.kind === 'spin' ? sh.radius : 0;
    const evR = sh.kind === 'strike' ? sh.range + m.radius : sh.kind === 'spin' ? sh.radius + m.radius : undefined;
    const ctx: PlayCtx = {
      owner: 'monster',
      caster: sh.kind === 'projectile' ? this.mouth(m) : { x: e.x, y: e.y },
      aim: e.aim,
      target: e.aim,
      ang: e.ang,
      seed: this.seed(e.skillId, e.index),
      sense: e.index % 2 === 1 ? -1 : 1,
      quota: r.quota,
      ghostOf: m,
      ...(evR !== undefined ? { r: evR, rScale: nominal > 0 ? evR / nominal : 1 } : {}),
    };
    this.stage.play(pulsePieces(r, 'cast', e.index, e.count), ctx);
    if (r.shape === 'spin') this.stage.play(pulsePieces(r, 'area', e.index, e.count), ctx);
    if (r.shape === 'strike' && e.index === e.count - 1) this.stage.play(r.phases.area ?? [], ctx);
  }

  projectileSpawn(e: GameEvents['projectileSpawn']): void {
    if (!this.isMonster(e.owner)) return;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const mv = e.mover;
    const id = e.id ?? hashSeed(e.skillId, e.x, e.y, e.angle);
    const index = e.index ?? 0;
    const count = e.count ?? 1;
    let flying = true;
    const body: LivePt = {
      get x() {
        return mv.x;
      },
      get y() {
        return mv.y - 14;
      },
    };
    const g = this.stage.play([...(r.phases.body ?? []), ...(r.phases.trail ?? [])], {
      owner: 'monster',
      body,
      bodySortDy: 14,
      caster: this.mouth(e.owner),
      ang: () => Math.atan2(mv.vy, mv.vx),
      seed: this.seed(e.skillId, 's', index),
      quota: r.quota,
      alive: () => flying,
      noTrail: count > VFX_BUDGET.perEvent.volleyTrailsFull && index % 2 === 1,
    });
    this.movers.set(id, {
      end: () => {
        flying = false;
        g.end();
      },
      get done() {
        return g.done;
      },
    });
  }

  projectileEnd(e: GameEvents['projectileEnd']): void {
    if (!this.isMonster(e.owner)) return;
    const id = e.id ?? -1;
    this.movers.get(id)?.end();
    this.movers.delete(id);
    const at = { x: e.x, y: e.y - 14 };
    const ctx: PlayCtx = { owner: 'monster', target: at, ang: Math.atan2(e.mover.vy, e.mover.vx), seed: this.seed('end') };
    const ink: Ink = { ramp: 'smoke', motif: 'steel', lut: 'base' };
    if (e.reason === 'expire') this.stage.play([piece('burst', { cls: 'fizzle', size: 's' }, ink, { anchor: { to: 'target', dy: 0 } })], ctx);
    else if (e.reason === 'wall') this.stage.play([piece('puff', { kind: 'dust', r: 5 }, { ...ink, ramp: 'dust' }, { anchor: { to: 'target', dy: 0 } })], ctx);
  }

  chainHop(e: GameEvents['chainHop']): void {
    if (!this.isMonster(e.owner)) return;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
    this.stage.play(r.phases.body ?? [], { owner: 'monster', hop: { from: e.from, to: e.to }, target: { x: e.to.x, y: e.to.y + 10 }, ang, seed: this.seed(e.skillId, 'hop'), quota: r.quota });
  }

  chainLaunch(e: GameEvents['chainLaunch']): void {
    if (!this.isMonster(e.owner) || e.target) return;
    this.stage.play([piece('burst', { cls: 'fizzle', size: 's' }, { ramp: 'smoke', motif: 'steel', lut: 'base' }, { anchor: { to: 'caster', dy: 0 } })], { owner: 'monster', caster: e.from, ang: 0, seed: this.seed('cfizzle') });
  }

  novaBlast(e: GameEvents['novaBlast']): void {
    if (!this.isMonster(e.owner)) return;
    const m = e.owner;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const p = this.host.player();
    const ang = p ? Math.atan2(e.y - m.y, e.x - m.x) : 0;
    this.stage.play(r.phases.area ?? [], { owner: 'monster', aim: { x: e.x, y: e.y }, target: { x: e.x, y: e.y }, caster: m, ang, r: e.radius, seed: this.seed(e.skillId, 'area'), quota: r.quota });
    // Warden slams shake (docs/VFX.md §6.6: 0.5), elites' heavy blasts a little; only near the player.
    const k = this.near(e.x, e.y, e.radius);
    if (m.warden) this.stage.trauma(0.5 * k * (e.heavy ? 1 : 0.6));
    else if (m.elite && e.heavy) this.stage.trauma(0.15 * k);
  }

  dash(e: GameEvents['dash']): void {
    if (!this.isMonster(e.owner)) return;
    const m = e.owner;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
    const start = this.stage.now();
    const base: PlayCtx = { owner: 'monster', ang, seed: this.seed(e.skillId, 'dash'), ghostOf: m, path: { from: e.from, to: e.to, ms: e.durationMs }, quota: r.quota };
    this.stage.play(r.phases.cast ?? [], { ...base, caster: { x: e.from.x, y: e.from.y } });
    this.stage.play(r.phases.trail ?? [], { ...base, caster: m, alive: () => m.alive && this.stage.now() - start <= e.durationMs + 17 });
    this.stage.play(r.phases.area ?? [], { ...base, caster: m, aim: { x: e.to.x, y: e.to.y } });
  }

  buffApplied(e: GameEvents['buffApplied']): void {
    if (e.target === 'player') {
      // The hex ward (def buffs draw the 'ward' aura): remembered so a blow on the player flares it.
      try {
        const r = deriveVfx(e.skill, 'player');
        if (r.carrier.kind === 'buff' && (r.carrier.motif === 'ward' || e.stat === 'def')) this.ward = { until: this.deadline(e.untilMs ?? this.host.sceneNow() + e.durationMs), family: (r.imbue ?? r.family) as FamilyId };
      } catch {
        /* the player bridge reports it */
      }
      return;
    }
    const m = e.target;
    const r = this.mrecipe(e.skill);
    if (!r) return;
    let per = this.auras.get(m);
    if (!per) this.auras.set(m, (per = new Map()));
    per.get(e.skillId)?.end();
    const end = this.deadline(e.untilMs ?? this.host.sceneNow() + e.durationMs);
    const body = bodyOf(m);
    const sized = (ps: readonly VfxPiece[]) => ps.map((p) => (p.component === 'aura' ? ({ ...p, params: { ...p.params, body } } as VfxPiece) : p));
    const ctx: PlayCtx = { owner: 'monster', caster: m, body: m, ang: 0, seed: this.seed(e.skillId, 'buff'), quota: r.quota, alive: () => m.alive && this.stage.now() < end };
    this.stage.play(sized(r.phases.cast ?? []), ctx);
    per.set(e.skillId, this.stage.play(sized(r.phases.aura ?? []), ctx));
  }

  // ---------------------------------------------------------------- the player takes a hit

  playerHurt(e: GameEvents['playerHurt']): void {
    if (e.dot) return; // DoT ticks: the status overlay already says it
    const p = this.host.player();
    if (!p) return;
    const m = e.attacker;
    const origin = e.origin ?? (m ? { x: m.x, y: m.y } : null);
    const blow = origin ? Math.atan2(p.y - origin.y, p.x - origin.x) : 0;
    const target = this.playerPt(-10)!;
    const out: HitOutcome = { index: 0, sincePrevMs: 1000, crit: false, relation: 'neutral', killed: e.hp <= 0, target: 'player' };
    let juiceMs = 33;
    if (e.skill && m) {
      const r = this.mrecipe(e.skill);
      if (r) {
        this.stage.play(impactPieces(r, out), { owner: 'monster', target, body: p, ang: blow, seed: this.seed(e.skillId ?? '', 'hurt'), victim: p });
        juiceMs = r.juice.hitstopMs;
      }
    } else if (m) {
      // An auto-attack: the monster's claws / lash / sting / slam / spark toward the player, then the impact.
      const r = this.attackRecipe(m);
      if (r) {
        const ang = Math.atan2(p.y - m.y, p.x - m.x);
        this.stage.play(r.phases.cast ?? [], { owner: 'monster', caster: { x: m.x, y: m.y }, target, aim: { x: p.x, y: p.y }, ang, seed: this.seed(m.def.id, 'claw'), quota: r.quota, ghostOf: m });
        this.stage.play(r.phases.impact ?? [], { owner: 'monster', target, ang, seed: this.seed(m.def.id, 'clawhit'), victim: p });
        juiceMs = r.juice.hitstopMs;
      }
    }
    // Hit feel: hits on the player hold half as long (docs/VFX.md §6.6); a kick along the blow; heavy blows shake.
    const j = this.host.juice;
    if (j) {
      j.hold('player', Math.round(holdFor(juiceMs, false, e.damage, e.maxHp, true) / 2));
      j.impact('player', 0xff4466, blow, e.heavy ? 3 : 2);
      j.kick(blow, e.heavy ? 4 : 2);
    }
    if (e.heavy) this.stage.trauma(0.35);
    // The hex ward flares where the blow lands.
    const w = this.ward;
    if (w && this.stage.now() < w.until) {
      const side = { x: p.x - Math.cos(blow) * 8, y: p.y - 18 - Math.sin(blow) * 4 };
      this.stage.play(
        [
          piece('burst', { cls: 'glint', size: 's' }, inkOf(w.family), { anchor: { to: 'target', dy: 0 } }),
          piece('ring', { r: 20, r0: 10, aspect: ZONE_ASPECT, thick: 1, style: 'gapped', ink: 'lit', anim: 'expand', ms: 167 }, inkOf(w.family), { anchor: { to: 'caster', dy: -18 } }),
        ],
        { owner: 'player', target: side, caster: p, ang: blow, seed: this.seed('ward') },
      );
    }
  }

  statusApplied(e: GameEvents['statusApplied']): void {
    if (e.target !== 'player') return;
    const p = this.host.player();
    if (!p) return;
    const ctx0 = { owner: 'monster' as const, body: p, target: p, caster: p, ang: 0, seed: this.seed('pstatus', e.kind) };
    if (e.blocked) {
      // Crowd-control immunity: a quick grey glint over the head instead of the stun / freeze.
      this.stage.play([piece('burst', { cls: 'immune', size: 's' }, { ramp: 'smoke', motif: 'steel', lut: 'base' }, { anchor: feet(-44) })], ctx0);
      return;
    }
    const src: FamilyId = e.source ? ((this.mrecipe(e.source)?.imbue ?? this.mrecipe(e.source)?.family ?? 'steel') as FamilyId) : 'steel';
    const pieces = statusPieces(e.kind, src, 'M', 'monster');
    if (ONE_SHOT.has(e.kind)) {
      this.stage.play(pieces, ctx0);
      return;
    }
    const until = e.untilMs;
    for (const [k, g] of this.playerStatus) if (g.done) this.playerStatus.delete(k);
    this.playerStatus.get(e.kind)?.end();
    this.playerStatus.delete(e.kind);
    if (this.playerStatus.size >= VFX_BUDGET.perEvent.statusLoopsPerTarget) {
      const rank = (k: StatusKind) => STATUS_PRIORITY.indexOf(k);
      const worst = [...this.playerStatus.keys()].sort((a, b) => rank(b) - rank(a))[0];
      if (rank(e.kind) > rank(worst)) {
        // Hidden loop: its pip shows instead (docs/VFX.md §6.4).
        const life = until === undefined ? undefined : Math.max(1, Math.round(until - this.host.sceneNow()));
        const pip = statusPip(e.kind, src, 'monster');
        this.stage.play([life ? ({ ...pip, lifeMs: life } as VfxPiece) : pip], ctx0);
        return;
      }
      this.playerStatus.get(worst)?.end();
      this.playerStatus.delete(worst);
    }
    const left = until === undefined ? undefined : Math.max(1, Math.round(until - this.host.sceneNow()));
    const loops = pieces.map((q) => (q.lifeMs !== undefined && left !== undefined ? ({ ...q, lifeMs: left } as VfxPiece) : q));
    // The player's own statuses are never low priority: they must always read.
    const end = until === undefined ? undefined : this.deadline(until);
    this.playerStatus.set(e.kind, this.stage.play(loops, { ...ctx0, alive: () => end === undefined || this.stage.now() < end }));
  }

  // ---------------------------------------------------------------- deaths, spawns, enrage

  death(e: GameEvents['death']): void {
    if (e.target === 'player') {
      for (const g of this.playerStatus.values()) g.end();
      this.playerStatus.clear();
      this.stage.play(
        [piece('puff', { kind: 'smoke', r: 7 }, { ramp: 'smoke', motif: 'steel', lut: 'base' }, { anchor: feet(0), layer: 'ground' }), piece('burst', { cls: 'blunt', size: 'm' }, DANGER, { anchor: feet(-20) })],
        { owner: 'player', body: { x: e.x, y: e.y }, ang: 0, seed: this.seed('pdeath') },
      );
      return;
    }
    const m = e.target;
    let killer: FamilyId = 'steel';
    if (e.killer?.skill) {
      try {
        const r = deriveVfx(e.killer.skill, 'player');
        killer = (r.imbue ?? r.family) as FamilyId;
      } catch {
        /* steel */
      }
    }
    // White frames on the real sprite (Combat hides it a beat later), then the pop.
    this.host.juice?.pop(m);
    const pop = deathPieces(bodyOf(m), killer, 'monster').map((p) => ({ ...p, delayMs: (p.delayMs ?? 0) + 33 }) as VfxPiece);
    // Chips in the hide colour when the art exports it (else the dust ramp they bake in).
    const hide = this.host.hideColor?.(m) ?? null;
    this.stage.play(pop, { owner: 'player', body: { x: e.x, y: e.y }, target: { x: e.x, y: e.y }, ang: 0, seed: this.seed('death', m.def.id), ...(hide !== null ? { chipTint: chipTint(hide) } : {}) });
    this.auras.delete(m);
  }

  private spawnPieces(body: ReturnType<typeof bodyOf>): VfxPiece[] {
    const dust: Ink = { ramp: 'dust', motif: 'earth', lut: 'base' };
    const r = body === 'S' ? 5 : body === 'M' ? 7 : 10;
    return [
      piece('puff', { kind: 'dust', r: r as 5 | 7 | 10 }, dust, { anchor: feet(0), layer: 'ground' }),
      piece('ring', { r: body === 'W' ? 40 : 24, r0: 6, aspect: ZONE_ASPECT, thick: 1, style: 'solid', ink: 'mid', anim: 'expand', ms: 200 }, inkOf('spirit'), { anchor: feet(0), layer: 'ground' }),
      piece('motes', { kind: 'glint', size: 1 }, inkOf('spirit'), { anchor: feet(-12), place: { pattern: 'rise', count: 4, radius: 10 } }),
    ];
  }

  monsterSpawn(e: GameEvents['monsterSpawn']): void {
    const m = e.monster;
    this.host.juice?.pop(m);
    this.stage.play(this.spawnPieces(bodyOf(m)), { owner: 'monster', body: { x: e.x, y: e.y }, ang: 0, seed: this.seed('spawn', m.def.id) });
  }

  enrage(e: GameEvents['enrage']): void {
    const m = e.monster;
    this.stage.play(extraPieces('enrage'), { owner: 'monster', body: m, target: m, caster: m, ang: 0, seed: this.seed('enrage') });
    this.stage.trauma(0.5 * this.near(m.x, m.y, m.radius * 2));
  }

  // ---------------------------------------------------------------- sparkles, extras, the class aura

  gather(e: GameEvents['gather']): void {
    const NODE: Record<GameEvents['gather']['node'], [FamilyId, 'chip' | 'droplet' | 'glint' | 'leaf' | 'ember' | 'flake' | 'spark' | 'mote']> = {
      ore: ['earth', 'chip'],
      fishing: ['water', 'droplet'],
      herb: ['wind', 'leaf'],
      ember_vent: ['fire', 'ember'],
      wind_chime: ['wind', 'leaf'],
      storm_tree: ['lightning', 'spark'],
      shadow_fungus: ['shadow', 'mote'],
      sun_spring: ['holy', 'glint'],
      frost_crystal: ['ice', 'flake'],
    };
    const [fam, mote] = NODE[e.node] ?? ['holy', 'glint'];
    this.stage.play(
      [
        piece('burst', { cls: 'glint', size: 's' }, inkOf('holy'), { anchor: feet(-10) }),
        piece('motes', { kind: mote, size: 1 }, inkOf(fam), { anchor: feet(-8), place: { pattern: 'burst', count: 6, radius: 12 } }),
        piece('motes', { kind: 'glint', size: 1 }, inkOf('holy'), { anchor: feet(-12), place: { pattern: 'rise', count: 3, radius: 8 }, delayMs: 50 }),
      ],
      { owner: 'player', body: { x: e.x, y: e.y }, ang: -Math.PI / 2, seed: this.seed('gather', e.node) },
    );
  }

  discovery(_e: GameEvents['discovery']): void {
    const p = this.host.player();
    if (!p) return;
    this.stage.play(
      [piece('burst', { cls: 'star', size: 's' }, inkOf('holy'), { anchor: feet(-50) }), piece('motes', { kind: 'glint', size: 1 }, inkOf('holy'), { anchor: feet(-30), place: { pattern: 'rise', count: 6, radius: 14 } })],
      { owner: 'player', body: p, ang: 0, seed: this.seed('disc') },
    );
  }

  /** A named world moment at (x, y) (chests, waystones, campfires, the shrine, resting, reveals, blinks). */
  extra(kind: WorldExtra, x: number, y: number): void {
    const at = { x, y };
    const ring = (r: number, f: FamilyId, ink: 'hot' | 'lit' | 'mid' = 'lit', ms = 300): VfxPiece =>
      piece('ring', { r, r0: Math.round(r * 0.25), aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink, anim: 'expand', ms }, inkOf(f), { anchor: feet(0), layer: 'ground' });
    const motes = (k: 'glint' | 'ember' | 'leaf' | 'mote' | 'star', f: FamilyId, n: number, pattern: 'rise' | 'burst' = 'rise'): VfxPiece =>
      piece('motes', { kind: k, size: 1 }, inkOf(f), { anchor: feet(-10), place: { pattern, count: n, radius: 14 } });
    let pieces: VfxPiece[] = [];
    switch (kind) {
      case 'chest':
        pieces = [piece('burst', { cls: 'star', size: 's' }, inkOf('holy'), { anchor: feet(-12) }), motes('glint', 'holy', 8, 'burst')];
        break;
      case 'waystone':
        pieces = [ring(48, 'arcane'), piece('erupt', { unit: 'light-pillar', scale: 's' }, inkOf('arcane'), { anchor: feet(0), place: { pattern: 'single', count: 1 } }), motes('glint', 'arcane', 6)];
        break;
      case 'campfire':
        pieces = [ring(40, 'fire', 'mid'), motes('ember', 'fire', 6)];
        break;
      case 'meditate':
        pieces = [ring(72, 'wind'), motes('leaf', 'wind', 8, 'burst')];
        break;
      case 'rest': {
        const heal: Ink = { ramp: 'heal', motif: 'holy', lut: 'base' };
        pieces = [
          piece('ring', { r: 32, r0: 8, aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink: 'mid', anim: 'expand', ms: 300 }, heal, { anchor: feet(0), layer: 'ground' }),
          piece('motes', { kind: 'mote', size: 1 }, heal, { anchor: feet(-10), place: { pattern: 'rise', count: 4, radius: 14 } }),
        ];
        break;
      }
      case 'reveal':
        pieces = [ring(56, 'twilight', 'hot'), piece('burst', { cls: 'star', size: 'm' }, inkOf('twilight'), { anchor: feet(-12) }), motes('star', 'twilight', 10, 'burst')];
        break;
      case 'blink':
        pieces = [piece('burst', { cls: 'magic', size: 's' }, inkOf('arcane'), { anchor: feet(-12) }), motes('glint', 'arcane', 6, 'burst')];
        break;
    }
    this.stage.play(pieces, { owner: 'player', body: at, ang: 0, seed: this.seed('extra', kind) });
  }

  /** Legacy SkillSystem.fxRing adapter: a ground ring in the nearest family. */
  legacyRing(x: number, y: number, radius: number, color: number): void {
    const f = familyOfColor(color);
    const r = Math.max(8, Math.round(radius / 2));
    this.stage.play([piece('ring', { r, r0: Math.round(r * 0.3), aspect: ZONE_ASPECT, thick: 2, style: 'solid', ink: 'lit', anim: 'expand', ms: 250 }, inkOf(f), { anchor: feet(0), layer: 'ground' })], { owner: 'player', body: { x, y }, ang: 0, seed: this.seed('lring') });
  }

  /** Legacy SkillSystem.fxBurst adapter: a magic burst + motes in the nearest family. */
  legacyBurst(x: number, y: number, color: number, n: number): void {
    const f = familyOfColor(color);
    this.stage.play(
      [piece('burst', { cls: 'magic', size: n > 16 ? 'm' : 's' }, inkOf(f), { anchor: feet(0) }), piece('motes', { kind: 'spark', size: 1 }, inkOf(f), { anchor: feet(0), place: { pattern: 'burst', count: Math.min(8, Math.max(3, Math.round(n / 3))) } })],
      { owner: 'player', body: { x, y }, ang: 0, seed: this.seed('lburst') },
    );
  }

  /** The Tier III class aura loop on the player (replaces Player's old Graphics ring and motes). */
  refreshClassAura(): void {
    const a = this.host.classAura();
    const key = a ? `${a.motif}|${a.family}` : '';
    if (key === this.classAuraKey && (this.classAuraGroup ? !this.classAuraGroup.done : !a)) return;
    this.classAuraGroup?.end();
    this.classAuraGroup = null;
    this.classAuraKey = key;
    const p = this.host.player();
    if (!a || !p) return;
    const mine = key;
    this.classAuraGroup = this.stage.play([piece('aura', { motif: a.motif, phase: 'loop', activation: 'ring', body: 'M', halo: false }, inkOf(a.family), { anchor: { to: 'caster', dy: 0 } })], {
      owner: 'player',
      caster: p,
      ang: 0,
      seed: this.seed('classAura'),
      alive: () => this.classAuraKey === mine,
      low: true,
    });
  }

  /** Live monster tells (QA). */
  tellCount(): number {
    return this.tells.size;
  }
}
