// VFX bus bridge (docs/VFX.md §8.2): subscribes to the game bus and turns the PLAYER's skill events into piece plays
// on the runtime (play.ts VfxStage). Phaser-free (types only): tests drive it with a fake stage.
//
//   castStart        charge phase (hand orb + orbiting motes + the friendly wind-up preview), until the wind-up ends
//   castFire         ends the charge; chain casts play their muzzle
//   skillPulse       each strike swing / spin pulse / volley launch / nova release: the cast phase (+ spin floor bands,
//                    heavy ground impact on the last swing); odd swings sweep back; the merge accent replaces the
//                    carrier on the final swing
//   projectileSpawn  body (follows the mover, heading from its velocity) + distance trails; returns rider tether
//   projectileEnd    expire -> grey fizzle, wall -> dust, caught -> catch glint (hit: the hit draws it)
//   chainLaunch      bolt hop (cast-time bake) / knife flight on a bow, arrival glint, shock node
//   novaTelegraph    the player's friendly landing marker (family rim + 12.5 % fill, hot rim in the last 117 ms)
//   novaBlast        the area phase (core, units popping with the wavefront, shock rings, aftermath decal)
//   dash             cast (afterimage + dust), trail (ghosts by distance, speed lines), landing (charge / dive / spin)
//   buffApplied      activation + aura loop until the buff ends (a refresh replaces it)
//   hit              impact by class (tick sparks for later hits within 100 ms, crit, strong, weak, immune, pierce),
//                    victim hit-stop on the spark, trauma on the cast's first hit; arc-rider zaps; leech streams
//   statusApplied    status units on monsters (<= 2 loops per target by priority; one-shots exempt)
//   combo / spark / levelUp   combo pieces, the spark star, the level-up pillar
// Monster techniques, auto-attacks, telegraphs, player statuses and death pops are the World lane's (open items).
import type { ComboId } from '../../core/combat';
import { hashSeed } from '../../core/rng';
import type { SkillDef, StatusKind } from '../../core/types';
import type { Monster } from '../entities/Monster';
import type { EventBus, GameEvents, Pt, Scope } from '../events';
import type { GhostSource, LivePt, PlayCtx, VfxGroup, VfxStage } from './play';
import { piece, recipePieces } from './pieces';
import { comboPieces, deriveVfx, extraPieces, impactPieces, statusPieces } from './recipe';
import { ANCHOR_DY, VFX_BUDGET, type BodySize, type FamilyId, type HitOutcome, type HitRelation, type VfxPiece, type VfxRecipe } from './types';

/** The live player view the bridge needs (entities/Player satisfies it). */
export interface BridgePlayer extends GhostSource {
  readonly x: number;
  readonly y: number;
}

export interface BridgeHost {
  player(): BridgePlayer | null;
  /** Scene time (ms): statusApplied.untilMs and buff ends are on this clock. */
  sceneNow(): number;
  /** Cast id of the wind-up in progress (Combat.windup.castId), or null. */
  windupId(): number | null;
}

interface CastState {
  recipe: VfxRecipe;
  lastHitAt: number;
  reprised: boolean;
  juiced: boolean;
  charge: VfxGroup | null;
  seen: number;
}

/** Status loop priority (docs/VFX.md §6.4): at most two loops per target, highest first. */
const STATUS_PRIORITY: readonly StatusKind[] = ['freeze', 'stun', 'shock', 'burn', 'poison', 'bleed', 'soak', 'slow'];
const ONE_SHOT: ReadonlySet<StatusKind> = new Set<StatusKind>(['knockback', 'smite', 'pull']);
const COMBOS: Readonly<Partial<Record<StatusKind, ComboId>>> = { freeze: 'shatter', soak: 'conduct', burn: 'fan' };

const has = (p: VfxPiece, t: string): boolean => (p.tags ?? []).includes(t as never);

/** Body bucket of a monster from its sprite height. */
export function bodyOf(m: Monster): BodySize {
  const h = m.sprite.displayHeight;
  return m.def.rank === 'warden' || h > 80 ? 'W' : m.def.rank === 'elite' || h > 50 ? 'L' : h > 34 ? 'M' : 'S';
}

/** The point an impact anchored `target dy -10` should land on: ~45 % up the body (Combat's old hit point). */
function hitPoint(m: Monster): LivePt {
  return {
    get x() {
      return m.x;
    },
    get y() {
      return m.y - Math.min(24, m.sprite.displayHeight * 0.45) - ANCHOR_DY.strike;
    },
  };
}

/** Strike / spin pulse pieces for swing `index` of `count` (first / last / later tags, merge accent). */
export function pulsePieces(r: VfxRecipe, phase: 'cast' | 'area', index: number, count: number): VfxPiece[] {
  const last = count > 1 && index === count - 1;
  let out = (r.phases[phase] ?? []).filter((p) => {
    if (has(p, 'firstHitOnly') && index !== 0) return false;
    if (has(p, 'laterHits') && index === 0) return false;
    if (has(p, 'lastHit') && !last) return false;
    return true;
  });
  const merge = r.riders.merge;
  if (phase === 'cast' && last && merge?.accent === 'extra' && merge.pieces.length) {
    // The merge's extra swing / pulse replaces the plain carrier piece (drawn once, in the echo family).
    const main = out.findIndex((p) => !has(p, 'echo') && (p.component === 'slash' || p.component === 'thrust' || p.component === 'ring' || p.component === 'burst'));
    if (main >= 0) out = [...out.slice(0, main), ...merge.pieces, ...out.slice(main + 1)];
  }
  return out;
}

export class VfxBridge {
  private casts = new Map<number, CastState>();
  private movers = new Map<number, VfxGroup>();
  private auras = new Map<string, VfxGroup>();
  private statuses = new Map<Monster, Map<StatusKind, VfxGroup>>();
  private leech: { from: Pt; at: number } | null = null;
  private recipes = new Map<string, VfxRecipe | null>();

  constructor(
    private readonly stage: VfxStage,
    private readonly host: BridgeHost,
  ) {}

  /** Subscribes through a scope (MapScene: sceneScope(this), cleared on shutdown). */
  attach(scope: Scope<GameEvents>): this {
    scope
      .on('castStart', (e) => this.castStart(e))
      .on('castFire', (e) => this.castFire(e))
      .on('skillPulse', (e) => this.skillPulse(e))
      .on('projectileSpawn', (e) => this.projectileSpawn(e))
      .on('projectileEnd', (e) => this.projectileEnd(e))
      .on('chainLaunch', (e) => this.chainLaunch(e))
      .on('novaTelegraph', (e) => this.novaTelegraph(e))
      .on('novaBlast', (e) => this.novaBlast(e))
      .on('dash', (e) => this.dash(e))
      .on('buffApplied', (e) => this.buffApplied(e))
      .on('hit', (e) => this.hit(e))
      .on('heal', (e) => this.heal(e))
      .on('statusApplied', (e) => this.statusApplied(e))
      .on('combo', (e) => this.combo(e))
      .on('spark', (e) => this.spark(e))
      .on('levelUp', (e) => this.levelUp(e));
    return this;
  }

  /** For tests: subscribe straight to a bus. */
  attachBus(bus: EventBus<GameEvents>): () => void {
    const offs = [
      bus.on('castStart', (e) => this.castStart(e)),
      bus.on('castFire', (e) => this.castFire(e)),
      bus.on('skillPulse', (e) => this.skillPulse(e)),
      bus.on('projectileSpawn', (e) => this.projectileSpawn(e)),
      bus.on('projectileEnd', (e) => this.projectileEnd(e)),
      bus.on('chainLaunch', (e) => this.chainLaunch(e)),
      bus.on('novaTelegraph', (e) => this.novaTelegraph(e)),
      bus.on('novaBlast', (e) => this.novaBlast(e)),
      bus.on('dash', (e) => this.dash(e)),
      bus.on('buffApplied', (e) => this.buffApplied(e)),
      bus.on('hit', (e) => this.hit(e)),
      bus.on('heal', (e) => this.heal(e)),
      bus.on('statusApplied', (e) => this.statusApplied(e)),
      bus.on('combo', (e) => this.combo(e)),
      bus.on('spark', (e) => this.spark(e)),
      bus.on('levelUp', (e) => this.levelUp(e)),
    ];
    return () => offs.forEach((o) => o());
  }

  /**
   * Warm set for a loadout (docs/VFX.md §8.5): every piece of each skill's recipe, its impact variants (first, tick,
   * crit, strong, weak, immune) and status units, plus the extras. Baked behind the fade / in idle slices.
   */
  warmLoadout(skills: readonly SkillDef[]): void {
    const out: VfxPiece[] = [];
    for (const s of skills) {
      const r = this.recipe(s);
      if (!r) continue;
      out.push(...recipePieces(r));
      const base: HitOutcome = { index: 0, sincePrevMs: 1000, crit: false, relation: 'neutral', killed: false, target: 'monster' };
      for (const o of [{}, { crit: true }, { relation: 'strong' as const }, { relation: 'weak' as const }, { relation: 'immune' as const }, { index: 1, sincePrevMs: 40 }]) {
        out.push(...impactPieces(r, { ...base, ...o }));
      }
      for (const k of r.statuses) out.push(...statusPieces(k, r.imbue ?? r.family, 'M', 'player'));
    }
    out.push(...extraPieces('spark'), ...extraPieces('levelUp'));
    this.stage.warm(out);
  }

  // ---------------------------------------------------------------- helpers

  private recipe(skill: SkillDef): VfxRecipe | null {
    let r = this.recipes.get(skill.id);
    if (r === undefined) {
      try {
        r = deriveVfx(skill, 'player');
      } catch (err) {
        console.error('[omnipath] vfx recipe failed', skill.id, err);
        r = null;
      }
      this.recipes.set(skill.id, r);
    }
    return r;
  }

  private cast(castId: number | undefined, skill: SkillDef): CastState | null {
    const r = this.recipe(skill);
    if (!r) return null;
    const id = castId ?? hashSeed(skill.id, Math.round(this.stage.now()));
    let c = this.casts.get(id);
    if (!c) {
      c = { recipe: r, lastHitAt: -1e9, reprised: false, juiced: false, charge: null, seen: this.stage.now() };
      this.casts.set(id, c);
      this.gc();
    }
    c.seen = this.stage.now();
    return c;
  }

  /** Forgets casts idle for 8 s (their hits, reprises and projectiles are long over). */
  private gc(): void {
    if (this.casts.size < 64) return;
    const now = this.stage.now();
    for (const [id, c] of this.casts) if (now - c.seen > 8000) this.casts.delete(id);
  }

  private seed(r: VfxRecipe, castId: number | undefined, k: number | string = 0): number {
    return hashSeed(r.variety, castId ?? 0, k);
  }

  /** The reprised copy's first event plays the caster's mirror ghost once. */
  private reprise(c: CastState, reprise: boolean | undefined, castId: number | undefined): void {
    if (!reprise || c.reprised) return;
    c.reprised = true;
    const ghost = c.recipe.riders.reprise?.ghost;
    const p = this.host.player();
    if (!ghost || !p) return;
    this.stage.play(ghost, { owner: 'player', caster: { x: p.x, y: p.y }, ghostOf: p, ang: 0, seed: this.seed(c.recipe, castId, 'rep') });
  }

  private playerPt(): LivePt | undefined {
    const p = this.host.player();
    return p ?? undefined;
  }

  // ---------------------------------------------------------------- handlers

  castStart(e: GameEvents['castStart']): void {
    const c = this.cast(e.castId, e.skill);
    const p = this.host.player();
    if (!c || !p) return;
    const sh = e.skill.shape;
    const tg = e.target;
    const aimAt = (): Pt => (tg && tg.alive ? { x: tg.x, y: tg.y } : e.aim);
    const ang = () => {
      const a = aimAt();
      return Math.atan2(a.y - p.y, a.x - p.x);
    };
    // The wind-up preview lands where the cast will (a nova: the aim clamped to its range).
    const aim: LivePt = {
      get x() {
        const a = aimAt();
        if (sh.kind !== 'nova') return a.x;
        const d = Math.min(sh.range, Math.hypot(a.x - p.x, a.y - p.y));
        return p.x + Math.cos(ang()) * d;
      },
      get y() {
        const a = aimAt();
        if (sh.kind !== 'nova') return a.y;
        const d = Math.min(sh.range, Math.hypot(a.x - p.x, a.y - p.y));
        return p.y + Math.sin(ang()) * d;
      },
    };
    const id = e.castId;
    const charge = c.recipe.phases.charge ?? [];
    if (!charge.length) return;
    c.charge = this.stage.play(charge, {
      owner: 'player',
      caster: p,
      aim,
      target: aim,
      ang,
      seed: this.seed(c.recipe, id, 'charge'),
      alive: () => this.host.windupId() === id,
      r: sh.kind === 'strike' ? sh.range : sh.kind === 'spin' || sh.kind === 'nova' ? sh.radius : undefined,
    });
  }

  castFire(e: GameEvents['castFire']): void {
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    c.charge?.end();
    c.charge = null;
    const p = this.host.player();
    if (e.shape !== 'chain' || !p) return;
    const ang = Math.atan2(e.aim.y - e.y, e.aim.x - e.x);
    this.stage.play(c.recipe.phases.cast ?? [], { owner: 'player', caster: { x: e.x, y: e.y }, ang, seed: this.seed(c.recipe, e.castId, 'cast') });
  }

  skillPulse(e: GameEvents['skillPulse']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    this.reprise(c, e.reprise, e.castId);
    const r = c.recipe;
    const at = { x: e.x, y: e.y };
    const ctx: PlayCtx = {
      owner: 'player',
      caster: r.shape === 'projectile' || r.shape === 'nova' ? (this.playerPt() ?? at) : at,
      aim: e.aim,
      ang: e.ang,
      seed: this.seed(r, e.castId, `p${e.index}`),
      sense: e.index % 2 === 1 ? -1 : 1,
      shift: !!e.reprise,
      ghostOf: this.host.player() ?? undefined,
    };
    const cast = pulsePieces(r, 'cast', e.index, e.count);
    if (r.shape === 'projectile' && r.riders.merge?.accent === 'radial') cast.push(...r.riders.merge.pieces);
    this.stage.play(cast, ctx);
    // Spin floor bands every pulse (hot on the first and last); a heavy strike's ground impact on its last swing.
    if (r.shape === 'spin') this.stage.play(pulsePieces(r, 'area', e.index, e.count), ctx);
    if (r.shape === 'strike' && e.index === e.count - 1) this.stage.play(r.phases.area ?? [], ctx);
  }

  projectileSpawn(e: GameEvents['projectileSpawn']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    this.reprise(c, e.reprise, e.castId);
    const r = c.recipe;
    const m = e.mover;
    const id = e.id ?? hashSeed(e.skillId, e.x, e.y, e.angle);
    const count = e.count ?? 1;
    const index = e.index ?? 0;
    let flying = true;
    const body: LivePt = {
      get x() {
        return m.x;
      },
      get y() {
        return m.y - 14;
      },
    };
    const merge = r.riders.merge;
    let pieces = [...(r.phases.body ?? [])];
    if (merge?.accent === 'extra' && count > 1 && index === count - 1 && merge.pieces.length) pieces = [...merge.pieces];
    pieces.push(...(r.phases.trail ?? []));
    const g = this.stage.play(pieces, {
      owner: 'player',
      caster: this.playerPt(),
      body,
      bodySortDy: 14,
      ang: () => Math.atan2(m.vy, m.vx),
      seed: this.seed(r, e.castId, `s${index}`),
      alive: () => flying,
      shift: !!e.reprise,
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
    // Returns rider: a turn glint where it turns, then a bead tether home while it flies back.
    const ret = r.riders.returns;
    if (ret) {
      let turned = false;
      this.stage.tick(() => {
        if (!flying) return false;
        if (!turned && m.returning) {
          turned = true;
          this.stage.play(ret.turn, { owner: 'player', body: { x: m.x, y: m.y - 14 }, ang: 0, seed: this.seed(r, e.castId, `t${index}`) });
          this.stage.play(ret.tether, { owner: 'player', caster: this.playerPt(), body, ang: 0, seed: 0, alive: () => flying });
          return false;
        }
        return true;
      });
    }
  }

  projectileEnd(e: GameEvents['projectileEnd']): void {
    if (e.owner !== 'player') return;
    const id = e.id ?? -1;
    this.movers.get(id)?.end();
    this.movers.delete(id);
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    const r = c.recipe;
    const at = { x: e.x, y: e.y - 14 };
    const ink = { ramp: 'smoke' as const, motif: r.family, lut: 'base' as const };
    const ctx: PlayCtx = { owner: 'player', target: at, caster: this.playerPt(), ang: Math.atan2(e.mover.vy, e.mover.vx), seed: this.seed(r, e.castId, 'end') };
    if (e.reason === 'expire') this.stage.play([piece('burst', { cls: 'fizzle', size: 's' }, ink, { anchor: { to: 'target', dy: 0 } })], ctx);
    else if (e.reason === 'wall') this.stage.play([piece('puff', { kind: 'dust', r: 5 }, { ...ink, ramp: 'dust' }, { anchor: { to: 'target', dy: 0 } })], ctx);
    else if (e.reason === 'caught' && r.riders.returns) this.stage.play(r.riders.returns.catch, ctx);
  }

  chainLaunch(e: GameEvents['chainLaunch']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    this.reprise(c, e.reprise, e.castId);
    const r = c.recipe;
    const from = e.from;
    const to = e.to;
    const ang = Math.atan2(to.y - from.y, to.x - from.x);
    const seed = this.seed(r, e.castId, `h${e.index}`);
    const merge = r.riders.merge;
    let body = r.phases.body ?? [];
    if (merge?.accent === 'extra' && merge.pieces.length && e.index > 0 && e.index === (e.skill.shape.kind === 'chain' ? e.skill.shape.jumps : 0)) body = merge.pieces;
    const target = { x: to.x, y: to.y - ANCHOR_DY.strike };
    if (!e.knives) {
      // Lightning: the hop bakes at cast time; the shock node marks each target.
      this.stage.play(e.target ? body : body.filter((p) => p.component === 'bolt'), { owner: 'player', hop: { from, to }, target, ang, seed, shift: !!e.reprise });
      return;
    }
    // Knives fly the hop on a shallow bow, spinning / pointing along it, then glint on arrival.
    const start = this.stage.now();
    const flight = Math.max(1, e.flightMs);
    const len = Math.hypot(to.x - from.x, to.y - from.y) || 1;
    const bow = Math.min(26, len * 0.2) * (hashSeed(seed) % 2 ? -1 : 1);
    const cx = (from.x + to.x) / 2 + (-(to.y - from.y) / len) * bow;
    const cy = (from.y + to.y) / 2 + ((to.x - from.x) / len) * bow - len * 0.08;
    const stage = this.stage;
    const at = (): Pt => {
      const t = Math.min(1, (stage.now() - start) / flight);
      const u = 1 - t;
      return { x: u * u * from.x + 2 * u * t * cx + t * t * to.x, y: u * u * from.y + 2 * u * t * cy + t * t * to.y };
    };
    const mover: LivePt = {
      get x() {
        return at().x;
      },
      get y() {
        return at().y;
      },
    };
    const heading = () => {
      const t = Math.min(1, (stage.now() - start) / flight);
      return Math.atan2(2 * (1 - t) * (cy - from.y) + 2 * t * (to.y - cy), 2 * (1 - t) * (cx - from.x) + 2 * t * (to.x - cx));
    };
    const pieces = [...body, ...(r.phases.trail ?? [])].filter((p) => e.target || p.anchor.to !== 'target');
    this.stage.play(pieces, { owner: 'player', hop: { from, to }, body: mover, target, ang: heading, seed, shift: !!e.reprise, alive: () => stage.now() - start < flight });
  }

  novaTelegraph(e: GameEvents['novaTelegraph']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    this.reprise(c, e.reprise, e.castId);
    const p = this.host.player();
    const ang = p ? Math.atan2(e.y - p.y, e.x - p.x) : 0;
    this.stage.play(c.recipe.phases.telegraph ?? [], { owner: 'player', aim: { x: e.x, y: e.y }, caster: p ?? undefined, ang, r: e.radius, seed: this.seed(c.recipe, e.castId, 'tell'), shift: !!e.reprise });
  }

  novaBlast(e: GameEvents['novaBlast']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    const r = c.recipe;
    const p = this.host.player();
    const ang = p ? Math.atan2(e.y - p.y, e.x - p.x) : 0;
    this.stage.play(r.phases.area ?? [], { owner: 'player', aim: { x: e.x, y: e.y }, target: { x: e.x, y: e.y }, caster: p ?? undefined, ang, r: e.radius, seed: this.seed(r, e.castId, 'area'), shift: !!e.reprise });
    if (!e.reprise && !c.juiced) {
      c.juiced = true;
      this.stage.trauma(r.juice.trauma);
    }
  }

  dash(e: GameEvents['dash']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    const p = this.host.player();
    if (!c || !p) return;
    this.reprise(c, e.reprise, e.castId);
    const r = c.recipe;
    const ang = Math.atan2(e.to.y - e.from.y, e.to.x - e.from.x);
    const start = this.stage.now();
    const seed = this.seed(r, e.castId, 'dash');
    const base: PlayCtx = { owner: 'player', ang, seed, ghostOf: p, path: { from: e.from, to: e.to, ms: e.durationMs }, shift: !!e.reprise };
    this.stage.play(r.phases.cast ?? [], { ...base, caster: { x: e.from.x, y: e.from.y } });
    this.stage.play(r.phases.trail ?? [], { ...base, caster: p, alive: () => this.stage.now() - start <= e.durationMs + 17 });
    this.stage.play(r.phases.area ?? [], { ...base, caster: p, aim: { x: e.to.x, y: e.to.y } });
  }

  buffApplied(e: GameEvents['buffApplied']): void {
    if (e.target !== 'player') return;
    const r = this.recipe(e.skill);
    const p = this.host.player();
    if (!r || !p) return;
    this.auras.get(e.skillId)?.end();
    const until = e.untilMs ?? this.host.sceneNow() + e.durationMs;
    const ctx: PlayCtx = { owner: 'player', caster: p, ang: 0, seed: this.seed(r, e.castId, 'buff'), alive: () => this.host.sceneNow() < until };
    this.stage.play(r.phases.cast ?? [], ctx);
    this.auras.set(e.skillId, this.stage.play(r.phases.aura ?? [], ctx));
  }

  heal(e: GameEvents['heal']): void {
    if (e.source === 'leech' && e.from) this.leech = { from: e.from, at: this.stage.now() };
  }

  hit(e: GameEvents['hit']): void {
    const c = this.cast(e.castId, e.skill);
    if (!c) return;
    const r = c.recipe;
    const m = e.target;
    const now = this.stage.now();
    const relation: HitRelation = e.resisted
      ? 'immune'
      : e.multiplier > 1.05
        ? 'strong'
        : e.multiplier < 0.95
          ? e.skill.element && m.def.element === e.skill.element
            ? 'same'
            : 'weak'
          : 'neutral';
    const out: HitOutcome = { index: e.hitIndex, sincePrevMs: now - c.lastHitAt, crit: e.crit, relation, killed: e.killed, ...(e.via ? { via: e.via } : {}), target: 'monster' };
    if (!e.resisted) c.lastHitAt = now;
    const pieces = impactPieces(r, out);
    const first = e.hitIndex === 0;
    const hold = first && !e.reprise ? Math.min(VFX_BUDGET.hitStop.localMaxMs, r.juice.hitstopMs + (e.crit ? 17 : 0)) : 0;
    const target = hitPoint(m);
    const seed = this.seed(r, e.castId, `x${e.hitIndex}`);
    this.stage.play(pieces, { owner: 'player', target, body: m, caster: this.playerPt(), ang: e.ang, seed, victim: m, holdMs: hold, shift: !!e.reprise });
    if (first && !e.reprise && !c.juiced && r.shape !== 'nova') {
      c.juiced = true;
      this.stage.trauma(r.juice.trauma);
    }
    // Arc rider: a zap from the struck target to this one.
    if (e.via === 'arc' && e.from && r.riders.arc) {
      const to = { x: m.x, y: m.y - Math.min(24, m.sprite.displayHeight * 0.45) };
      this.stage.play(r.riders.arc.zap, { owner: 'player', hop: { from: e.from, to }, target: to, ang: Math.atan2(to.y - e.from.y, to.x - e.from.x), seed: seed + 1 });
    }
    // Leech: blood motes stream from the struck target to the caster, turning to heal.
    const l = this.leech;
    if (l && r.riders.leech && now - l.at < 50 && Math.hypot(l.from.x - m.x, l.from.y - m.y) < 2) {
      this.leech = null;
      const p = this.playerPt();
      this.stage.play([...r.riders.leech.stream, ...r.riders.leech.arrive], { owner: 'player', target, caster: p, ang: 0, seed: seed + 2 });
    }
  }

  statusApplied(e: GameEvents['statusApplied']): void {
    if (e.target === 'player' || e.blocked) return;
    const m = e.target;
    const src: FamilyId = e.source ? (this.recipe(e.source)?.imbue ?? this.recipe(e.source)?.family ?? 'steel') : 'steel';
    const until = e.untilMs;
    const pieces = statusPieces(e.kind, src, bodyOf(m), 'player');
    const ctx: PlayCtx = {
      owner: 'player',
      body: m,
      target: m,
      caster: this.playerPt(),
      ang: (() => {
        const p = this.host.player();
        return p ? Math.atan2(m.y - p.y, m.x - p.x) : 0;
      })(),
      seed: hashSeed('status', e.kind, Math.round(this.stage.now())),
      alive: () => m.alive && (until === undefined || this.host.sceneNow() < until),
    };
    if (ONE_SHOT.has(e.kind)) {
      this.stage.play(pieces, ctx);
      return;
    }
    let per = this.statuses.get(m);
    if (!per) this.statuses.set(m, (per = new Map()));
    for (const [k, g] of per) if (g.done) per.delete(k);
    per.get(e.kind)?.end();
    per.delete(e.kind);
    // At most two loops per target, by priority: a lower-priority newcomer is dropped, a higher one evicts the lowest.
    if (per.size >= VFX_BUDGET.perEvent.statusLoopsPerTarget) {
      const rank = (k: StatusKind) => STATUS_PRIORITY.indexOf(k);
      const worst = [...per.keys()].sort((a, b) => rank(b) - rank(a))[0];
      if (rank(e.kind) > rank(worst)) return;
      per.get(worst)?.end();
      per.delete(worst);
    }
    // Loops live as long as the status (pieces carry Combat's fixed durations as lifeMs).
    const loops = pieces.map((p) => (p.lifeMs !== undefined && until !== undefined ? ({ ...p, lifeMs: Math.max(1, Math.round(until - this.host.sceneNow())) } as VfxPiece) : p));
    per.set(e.kind, this.stage.play(loops, ctx));
  }

  combo(e: GameEvents['combo']): void {
    const id = COMBOS[e.consumes];
    if (!id) return;
    const m = e.target;
    const pieces = comboPieces(id, bodyOf(m));
    const seed = hashSeed('combo', id, e.castId ?? 0);
    // The status the combo consumed ends now.
    this.statuses.get(m)?.get(e.consumes)?.end();
    const stream = pieces.filter((p) => p.place?.pattern === 'path');
    this.stage.play(
      pieces.filter((p) => !stream.includes(p)),
      { owner: 'player', body: m, target: m, ang: 0, seed },
    );
    // Fan the Flames: ember streams to every monster the burn spread to.
    for (const to of e.spreadTo ?? []) this.stage.play(stream, { owner: 'player', body: m, caster: { x: to.x, y: to.y + 8 }, ang: 0, seed: seed + Math.round(to.x) });
  }

  spark(e: GameEvents['spark']): void {
    if (e.x === undefined || e.y === undefined) return;
    this.stage.play(extraPieces('spark'), { owner: 'player', body: { x: e.x, y: e.y }, ang: 0, seed: hashSeed('spark', e.to.id) });
  }

  levelUp(_e: GameEvents['levelUp']): void {
    const p = this.host.player();
    if (p) this.stage.play(extraPieces('levelUp'), { owner: 'player', body: p, ang: 0, seed: hashSeed('level', Math.round(this.stage.now())) });
  }
}
