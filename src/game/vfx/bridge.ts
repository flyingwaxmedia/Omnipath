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
//                    + the hit feel through the juice rig (host.juice): coalesced victim-local hit-stop scaled by the damage,
//                    a 1-frame white impact frame on the cast's first hit per monster (the rig's flash gate: later
//                    ticks spark-only, <= 1 flash per 220 ms / 8 frames), squash, recoil, a camera kick on heavy casts
// v4 kinds and class mechanics (docs/VFX.md §6.9, §6.10; payloads: src/game/events.ts "v4 Phase 1 payloads"):
//   objectSpawn      a zone is placed: the field opens (area) and stands (aura: exact rim, tint, living units) at the
//                    LIVE object (follow zones move with it) until objectEnd or its time runs out
//   objectTick       each tick re-lights the field (riders.zone.tick; first / later tick pieces by index)
//   objectEnd        the field lets go (riders.zone.end; nothing on a map clear)
//   blink            vanish where the caster stood (their own frame slices away), streaks to where they land, arrive
//   mend             the bloom on the first pulse, the trickle loop and resting circle for a heal over time, a small
//                    lift on each later pulse
//   shieldUp / shieldHit / shieldEnd   the shell forms and holds; each soaked blow flashes it; it breaks (and bursts)
//   mechanic         the worn class's mechanic: meter full, finisher, combo step, stance swap on the player; mark
//                    pips, cash-in and stored-damage pops on the marked foes; class objects placed / grown / used.
//                    Under 'Reduce shake & flashes' only the readable mark plays (no rings, no motes).
// A mechanic boost may scale a skill's shape without changing its id: recipes are derived from the skill AS CAST.
// Monster techniques, auto-attacks, telegraphs, player statuses, deaths, spawns and world moments are world.ts's.
import type { ComboId } from '../../core/combat';
import { hashSeed } from '../../core/rng';
import type { SkillDef, SkillShape, StatusKind } from '../../core/types';
import { GAME_DATA } from '../../data';
import type { Monster } from '../entities/Monster';
import type { EventBus, GameEvents, Pt, Scope } from '../events';
import { holdFor } from './juice';
import type { GhostSource, JuiceHooks, LivePt, PlayCtx, VfxGroup, VfxStage } from './play';
import { piece, recipePieces } from './pieces';
import { RAMPS } from './ramps';
import { comboPieces, deriveVfx, deriveVfxAsCast, extraPieces, impactPieces, mechanicPieces, statusPieces, statusPip, type MechanicFx } from './recipe';
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
  /** Hit feel on the struck monster and the camera (juice rig); absent in tests that only check plays. */
  juice?: JuiceHooks | null;
}

/** Recoil (art px) of a struck monster by the cast's weight; the player's light hits barely move anything. */
const RECOIL = { light: 1, normal: 1, heavy: 2, ultimate: 3 } as const;
/** Camera kick (art px) on the first hit of the player's own cast: none for light / normal blows. */
const KICK = { light: 0, normal: 0, heavy: 2, ultimate: 3 } as const;

interface CastState {
  recipe: VfxRecipe;
  lastHitAt: number;
  reprised: boolean;
  juiced: boolean;
  charge: VfxGroup | null;
  seen: number;
}

/** Status loop priority (docs/VFX.md §6.4): at most two loops per target, highest first. */
const STATUS_PRIORITY: readonly StatusKind[] = ['freeze', 'stun', 'launch', 'root', 'shock', 'burn', 'poison', 'bleed', 'expose', 'lure', 'soak', 'slow'];
const ONE_SHOT: ReadonlySet<StatusKind> = new Set<StatusKind>(['knockback', 'smite', 'pull']);
const COMBOS: Readonly<Partial<Record<StatusKind, ComboId>>> = { freeze: 'shatter', soak: 'conduct', burn: 'fan' };

const has = (p: VfxPiece, t: string): boolean => (p.tags ?? []).includes(t as never);

const CLASSES = new Map(GAME_DATA.classes.map((c) => [c.id, c]));
const ELEMENT_FAMILIES: readonly FamilyId[] = GAME_DATA.elements.map((el) => el.id);

/**
 * The family a class's mechanic feedback is drawn in: its element; an element-less class reads by its weapon (bare
 * hands warm spirit, a rod arcane, steel otherwise).
 */
export function classFamily(classId: string): FamilyId {
  const c = CLASSES.get(classId);
  if (!c) return 'steel';
  // Off-grid sources (none, prism) read by the weapon like the physical classes.
  if (c.source && (ELEMENT_FAMILIES as readonly string[]).includes(c.source)) return c.source as FamilyId;
  return c.weapon === 'fists' ? 'spirit' : c.weapon === 'staff' ? 'arcane' : 'steel';
}

/** A shell flashes for a soaked blow at most this often (a swarm's hits would strobe it otherwise). */
const ABSORB_GAP_MS = 120;

interface ZoneState {
  group: VfxGroup;
  recipe: VfxRecipe;
  ctx: PlayCtx;
}

/** Body bucket of a monster from its sprite height. */
export function bodyOf(m: Monster): BodySize {
  const h = m.sprite.displayHeight;
  return m.def.rank === 'warden' || h > 76 ? 'W' : h > 50 ? 'L' : h > 30 ? 'M' : 'S';
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
  private recipes = new Map<string, { shape: SkillShape; recipe: VfxRecipe | null }>();
  /** Recipes of boosted casts (same id, a scaled shape), by the shape object the cast carries. */
  private asCast = new WeakMap<SkillShape, VfxRecipe | null>();
  private zones = new Map<number, ZoneState>();
  private mends = new Map<string, VfxGroup>();
  private shield: { group: VfxGroup; recipe: VfxRecipe; up: boolean; lastAbsorb: number } | null = null;
  private marks = new Map<Monster, VfxGroup>();

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
      .on('levelUp', (e) => this.levelUp(e))
      .on('objectSpawn', (e) => this.objectSpawn(e))
      .on('objectTick', (e) => this.objectTick(e))
      .on('objectEnd', (e) => this.objectEnd(e))
      .on('blink', (e) => this.blink(e))
      .on('mend', (e) => this.mend(e))
      .on('shieldUp', (e) => this.shieldUp(e))
      .on('shieldHit', (e) => this.shieldHit(e))
      .on('shieldEnd', (e) => this.shieldEnd(e))
      .on('mechanic', (e) => this.mechanic(e));
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
      bus.on('objectSpawn', (e) => this.objectSpawn(e)),
      bus.on('objectTick', (e) => this.objectTick(e)),
      bus.on('objectEnd', (e) => this.objectEnd(e)),
      bus.on('blink', (e) => this.blink(e)),
      bus.on('mend', (e) => this.mend(e)),
      bus.on('shieldUp', (e) => this.shieldUp(e)),
      bus.on('shieldHit', (e) => this.shieldHit(e)),
      bus.on('shieldEnd', (e) => this.shieldEnd(e)),
      bus.on('mechanic', (e) => this.mechanic(e)),
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
      // Multi-hit strikes sweep back on odd swings: warm the reversed smear too.
      if (s.shape.kind === 'strike' && ((s.shape.hits ?? 1) > 1 || r.riders.merge?.accent === 'extra')) {
        for (const p of r.phases.cast ?? []) if (p.component === 'slash' && p.params.form !== 'chop') out.push({ ...p, params: { ...p.params, sense: (-p.params.sense) as 1 | -1 } });
      }
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

  /**
   * The recipe of a skill as it is cast. The first shape seen for an id is its plain recipe (cached by id); a cast
   * whose shape object differs was scaled by a class mechanic (systems/boost.ts keeps the id) and gets its own recipe,
   * derived once per cast: every effect is as big as its hit test.
   */
  private recipe(skill: SkillDef): VfxRecipe | null {
    const derive = (asCast: boolean): VfxRecipe | null => {
      try {
        return asCast ? deriveVfxAsCast(skill, 'player') : deriveVfx(skill, 'player');
      } catch (err) {
        console.error('[omnipath] vfx recipe failed', skill.id, err);
        return null;
      }
    };
    const known = this.recipes.get(skill.id);
    if (!known) {
      const recipe = derive(false);
      this.recipes.set(skill.id, { shape: skill.shape, recipe });
      return recipe;
    }
    if (known.shape === skill.shape) return known.recipe;
    let r = this.asCast.get(skill.shape);
    if (r === undefined) {
      // Equal numbers under a new object (a re-composed skill) share the plain recipe.
      r = JSON.stringify(known.shape) === JSON.stringify(skill.shape) ? known.recipe : derive(true);
      this.asCast.set(skill.shape, r);
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

  /**
   * A scene-time end (statusApplied.untilMs, a buff's end) as a deadline on the runtime's world clock. Combat shifts
   * its own timers over panel pauses, loop sleeps and hit-stops; the world clock stands still through the same gaps,
   * so the effect ends with the status / buff instead of early after a pause (a captured scene-time `until` does not
   * move when Combat shifts the real one).
   */
  private deadline(untilMs: number): number {
    return this.stage.now() + Math.max(0, untilMs - this.host.sceneNow());
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
    // Chains play their muzzle here; a zone thrown to a spot flicks from the hand (its field is objectSpawn's).
    if ((e.shape !== 'chain' && e.shape !== 'zone') || !p) return;
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
    this.auras.delete(e.skillId);
    // At most two buff aura loops on the player, like status loops: the oldest gives way (the buff itself stays).
    for (const [k, g] of this.auras) if (g.done) this.auras.delete(k);
    while (this.auras.size >= VFX_BUDGET.perEvent.statusLoopsPerTarget) {
      const [k, g] = this.auras.entries().next().value as [string, VfxGroup];
      g.end();
      this.auras.delete(k);
    }
    const end = this.deadline(e.untilMs ?? this.host.sceneNow() + e.durationMs);
    const ctx: PlayCtx = { owner: 'player', caster: p, ang: 0, seed: this.seed(r, e.castId, 'buff'), alive: () => this.stage.now() < end };
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
    // Victim-local hit-stop (coalesced, budgeted by the juice rig), scaled by how much of the health the blow took;
    // the impact spark holds its hero frame exactly as long as the body does.
    const want = !e.reprise && !e.resisted ? holdFor(r.juice.hitstopMs, e.crit, e.damage, m.maxHp ?? m.def?.hp ?? 1, first) : 0;
    const juice = this.host.juice;
    const hold = juice ? juice.hold(m, want) : want;
    if (juice && !e.resisted) {
      const el = (r.imbue ?? r.family) as keyof typeof RAMPS;
      // The flash gate keys the cast record: only its first hit on this monster may flash the body (docs/VFX.md §6.6).
      juice.impact(m, parseInt((RAMPS[el] ?? RAMPS.steel).R[4].slice(1), 16), e.ang, e.reprise ? 0 : RECOIL[r.weight], c);
      if (first && !e.reprise && KICK[r.weight]) juice.kick(e.ang, KICK[r.weight]);
    }
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
    const end = until === undefined ? undefined : this.deadline(until);
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
      // Ends with the monster (a kill mid-poison) or the status, whichever comes first.
      alive: () => m.alive && (end === undefined || this.stage.now() < end),
      low: true,
    };
    if (ONE_SHOT.has(e.kind)) {
      this.stage.play(pieces, ctx);
      return;
    }
    // Beyond 8 affected targets, newcomers show the 7x7 pip only (docs/VFX.md §6.4).
    for (const [t, map] of this.statuses) {
      for (const [k, g] of map) if (g.done) map.delete(k);
      if (!map.size || !t.alive) this.statuses.delete(t);
    }
    if (!this.statuses.has(m) && this.statuses.size >= 8) {
      const life = until === undefined ? undefined : Math.max(1, Math.round(until - this.host.sceneNow()));
      const pip = statusPip(e.kind, src, 'player');
      this.stage.play([life ? ({ ...pip, lifeMs: life } as VfxPiece) : pip], ctx);
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

  // ---------------------------------------------------------------- v4: zones, blinks, mends, shields

  objectSpawn(e: GameEvents['objectSpawn']): void {
    if (e.owner !== 'player' || e.kind !== 'zone') return;
    const c = this.cast(e.castId, e.skill);
    if (!c || c.recipe.carrier.kind !== 'zone') return;
    const r = c.recipe;
    const obj = e.obj;
    this.zones.get(e.id)?.group.end();
    // The live record: a follow zone moves with its owner, a class object stands until it is used up.
    const centre: LivePt = {
      get x() {
        return obj.x;
      },
      get y() {
        return obj.y;
      },
    };
    const line = e.line;
    const p = this.host.player();
    const from: LivePt = line ? { x: line.x0, y: line.y0 } : centre;
    const ang = line ? Math.atan2(line.y1 - line.y0, line.x1 - line.x0) : p ? Math.atan2(e.y - p.y, e.x - p.x) : 0;
    const timed = Number.isFinite(e.untilMs);
    const end = timed ? this.deadline(e.untilMs) : Infinity;
    const ctx: PlayCtx = { owner: 'player', caster: from, aim: centre, target: centre, ang, seed: this.seed(r, e.castId, `z${e.id}`), r: e.radius, shift: !!e.reprise };
    this.stage.play(r.phases.area ?? [], ctx);
    // Standing pieces carry the zone's own duration; the event's is the truth (a class object stands until removed).
    const life = timed ? Math.max(1, Math.round(e.durationMs)) : undefined;
    const standing = (r.phases.aura ?? []).map((q) => (q.lifeMs === undefined ? q : ({ ...q, lifeMs: life } as VfxPiece)));
    const group = this.stage.play(standing, { ...ctx, alive: () => obj.alive && this.stage.now() < end });
    this.zones.set(e.id, { group, recipe: r, ctx });
  }

  objectTick(e: GameEvents['objectTick']): void {
    const z = this.zones.get(e.id);
    const tick = z?.recipe.riders.zone?.tick;
    if (!z || !tick) return;
    const pieces = tick.filter((q) => !(has(q, 'firstHitOnly') && e.index !== 0) && !(has(q, 'laterHits') && e.index === 0));
    this.stage.play(pieces, { ...z.ctx, r: e.radius, seed: hashSeed(z.ctx.seed, e.index) });
  }

  objectEnd(e: GameEvents['objectEnd']): void {
    const z = this.zones.get(e.id);
    if (!z) return;
    this.zones.delete(e.id);
    z.group.end();
    // A map change clears every object at once: nothing to show.
    if (e.reason === 'clear') return;
    const end = z.recipe.riders.zone?.end;
    // The live record is gone after this event: the goodbye plays at fixed points.
    const at = { x: e.x, y: e.y };
    const from = z.ctx.caster ? { x: z.ctx.caster.x, y: z.ctx.caster.y } : at;
    if (end) this.stage.play(end, { ...z.ctx, caster: from, aim: at, target: at, seed: hashSeed(z.ctx.seed, 'end') });
  }

  blink(e: GameEvents['blink']): void {
    if (e.owner !== 'player') return;
    const c = this.cast(e.castId, e.skill);
    const p = this.host.player();
    if (!c || !p) return;
    this.reprise(c, e.reprise, e.castId);
    const r = c.recipe;
    const from = { x: e.from.x, y: e.from.y };
    const to = { x: e.to.x, y: e.to.y };
    const dist = Math.hypot(to.x - from.x, to.y - from.y);
    const ang = dist > 1 ? Math.atan2(to.y - from.y, to.x - from.x) : 0;
    const seed = this.seed(r, e.castId, 'blink');
    // The player already stands at `to`: the vanish snapshots their frame where they WERE.
    const ghostOf: GhostSource = { x: from.x, y: from.y, sprite: p.sprite };
    const base: PlayCtx = { owner: 'player', ang, seed, shift: !!e.reprise };
    this.stage.play(r.phases.cast ?? [], { ...base, caster: from, ghostOf });
    // The streaks between the two ends span the real jump (a blink to a near target is shorter than its reach).
    if (dist >= 24) {
      const trail = (r.phases.trail ?? []).map((q) => (q.place?.pattern === 'line' ? ({ ...q, place: { ...q.place, radius: Math.round(dist) } } as VfxPiece) : q));
      this.stage.play(trail, { ...base, caster: from, aim: to });
    }
    this.stage.play(r.phases.area ?? [], { ...base, caster: p, aim: to, target: to, r: e.radius });
  }

  mend(e: GameEvents['mend']): void {
    const r = this.recipe(e.skill);
    const p = this.host.player();
    if (!r || !p) return;
    const base: PlayCtx = { owner: 'player', caster: p, ang: 0, seed: this.seed(r, e.castId, e.first ? 'mend' : `m${Math.round(this.stage.now())}`) };
    if (!e.first) {
      this.stage.play(r.phases.trail ?? [], base);
      return;
    }
    const at = { x: e.x, y: e.y };
    this.stage.play(r.phases.cast ?? [], base);
    this.stage.play(r.phases.area ?? [], { ...base, aim: at, target: at, r: e.radius });
    this.mends.get(e.skillId)?.end();
    this.mends.delete(e.skillId);
    for (const [k, g] of this.mends) if (g.done) this.mends.delete(k);
    const aura = r.phases.aura ?? [];
    if (!aura.length || !e.overMs) return;
    const end = this.stage.now() + e.overMs;
    this.mends.set(e.skillId, this.stage.play(aura, { ...base, aim: at, target: at, r: e.radius, alive: () => this.stage.now() < end }));
  }

  shieldUp(e: GameEvents['shieldUp']): void {
    const r = this.recipe(e.skill);
    const p = this.host.player();
    if (!r || !p) return;
    if (this.shield) {
      this.shield.up = false;
      this.shield.group.end();
    }
    const end = this.deadline(e.untilMs);
    const ctx: PlayCtx = { owner: 'player', caster: p, ang: 0, seed: this.seed(r, e.castId, 'shield') };
    this.stage.play(r.phases.cast ?? [], ctx);
    const st = { group: null as unknown as VfxGroup, recipe: r, up: true, lastAbsorb: -1e9 };
    // The loop's own life is the authored duration; the event's end is the truth.
    const left = Math.max(1, Math.round(e.untilMs - this.host.sceneNow()));
    const aura = (r.phases.aura ?? []).map((q) => (q.lifeMs === undefined ? q : ({ ...q, lifeMs: Math.max(1, left - (q.delayMs ?? 0)) } as VfxPiece)));
    st.group = this.stage.play(aura, { ...ctx, alive: () => st.up && this.stage.now() < end });
    this.shield = st;
  }

  shieldHit(e: GameEvents['shieldHit']): void {
    const st = this.shield;
    const p = this.host.player();
    const absorb = st?.recipe.riders.shield?.absorb;
    if (!st || !st.up || !p || !absorb) return;
    const now = this.stage.now();
    if (now - st.lastAbsorb < ABSORB_GAP_MS) return;
    st.lastAbsorb = now;
    const ang = e.origin ? Math.atan2(p.y - e.origin.y, p.x - e.origin.x) : 0;
    this.stage.play(absorb, { owner: 'player', caster: p, ang, seed: hashSeed('absorb', Math.round(now)) });
  }

  shieldEnd(e: GameEvents['shieldEnd']): void {
    const st = this.shield;
    this.shield = null;
    if (st) {
      st.up = false;
      st.group.end();
    }
    const p = this.host.player();
    const sh = (st?.recipe ?? this.recipe(e.skill))?.riders.shield;
    if (!p || !sh || (e.reason !== 'broken' && e.reason !== 'expired')) return;
    const ctx: PlayCtx = { owner: 'player', caster: p, aim: p, ang: 0, seed: hashSeed('shieldEnd', Math.round(this.stage.now())) };
    this.stage.play(sh.break, ctx);
    if (e.burst) this.stage.play(sh.burst, { ...ctx, r: e.burst });
  }

  // ---------------------------------------------------------------- v4: class mechanic feedback

  mechanic(e: GameEvents['mechanic']): void {
    const p = this.host.player();
    if (!p) return;
    const fam = classFamily(e.classId);
    const calm = this.stage.reduceFlash;
    const type = e.type as MechanicFx;
    const seed = hashSeed('mech', type, Math.round(this.stage.now()));
    const onPlayer: PlayCtx = { owner: 'player', caster: p, ang: 0, seed };
    const fx = e.effect;
    switch (fx.type) {
      case 'full':
      case 'spent':
      case 'comboBreak':
      case 'finisher':
        this.stage.play(mechanicPieces(type, fam, { calm }), onPlayer);
        return;
      case 'comboStep':
        this.stage.play(mechanicPieces(type, fam, { calm, n: fx.step, of: fx.length }), onPlayer);
        return;
      case 'stance':
        this.stage.play(mechanicPieces(type, fam, { calm, n: fx.stance + 1 }), onPlayer);
        return;
      case 'marked': {
        const m = e.target;
        if (!m) return;
        // One pip per foe, replaced as its marks grow; it goes with the foe, the cash-in or the marks running out.
        this.endMark(m);
        for (const [t, g] of this.marks) if (g.done || !t.alive) this.marks.delete(t);
        this.marks.set(m, this.stage.play(mechanicPieces(type, fam, { n: fx.marks, body: bodyOf(m) }), { owner: 'player', target: m, caster: p, ang: 0, seed, alive: () => m.alive, low: true }));
        return;
      }
      case 'cashIn':
        for (const t of e.targets ?? []) {
          this.endMark(t.target);
          const at = { x: t.target.x, y: t.target.y };
          this.stage.play(mechanicPieces(type, fam, { calm, body: bodyOf(t.target) }), { owner: 'player', target: at, caster: p, ang: 0, seed: seed + Math.round(at.x) });
        }
        return;
      case 'markEnd': {
        const m = e.target;
        if (!m) return;
        this.endMark(m);
        const at = { x: m.x, y: m.y };
        this.stage.play(mechanicPieces(type, fam, { calm, body: bodyOf(m) }), { owner: 'player', target: at, caster: p, ang: 0, seed });
        return;
      }
      case 'placed':
      case 'expired':
      case 'levelUp':
      case 'consumed': {
        const at = e.at ? { x: e.at.x, y: e.at.y } : { x: p.x, y: p.y };
        this.stage.play(mechanicPieces(type, fam, { calm }), { owner: 'player', target: at, caster: p, ang: 0, seed });
        return;
      }
    }
  }

  private endMark(m: Monster): void {
    this.marks.get(m)?.end();
    this.marks.delete(m);
  }
}
