// Game event bus (docs/QUALITY-PLAN.md §3, docs/INTEGRATION-v3.md §4): the world announces what happened, and
// quests, audio, hit feel, VFX, actors and the HUD subscribe — without editing Combat, SkillSystem or MapScene.
// Emitters are one-line calls in the existing code paths and never change behaviour; a listener that throws is
// reported and skipped, so a broken VFX / audio listener can never break combat.
//
// Scopes: `gameBus` lives for the whole run (created once, like the UI and the SkillBook). Anything that belongs
// to ONE map (scene objects, per-map systems) subscribes through `sceneScope(scene)`, which removes its listeners on
// the scene's SHUTDOWN. Payloads may carry scene objects (Monster, images): never keep them past that map.
// Positions are world px (feet / body centre as noted). `owner` / `target` / `source` are 'player' or the Monster.
//
// Events (when each fires):
//   hit              a PLAYER skill hit a monster (Combat.hit, after damage; resisted hits too, damage 0)
//   dotTick          a damage-over-time tick hurt a monster (burn / poison / bleed) (Combat.damageMonsterRaw)
//   kill             a monster died to the player (Combat.kill, before rewards are logged)
//   castStart        the player began a wind-up (castMs > 0) (Combat.castSkill)
//   castFire         a player skill's effect fires: SP paid, cooldown started (Combat.fire), basics included
//   projectileSpawn  a projectile left its owner (SkillSystem.spawnProjectile, MonsterSkills.shoot)
//   projectileEnd    a projectile was removed: hit (pierce spent / struck the player), range, wall, or caught on return
//   chainHop         one hop of a chain landed on a monster (SkillSystem.chain), before its hit
//   novaTelegraph    the player's nova landing marker appears (SkillSystem nova; lasts delayMs)
//   novaBlast        a nova detonates (player: SkillSystem; monster: MonsterSkills), before its hits
//   dash             a dash starts (player: SkillSystem.dash; monster: MonsterSkills sweep)
//   buffApplied      a buff started on the player (Combat.applyBuff) or on a monster (MonsterSkills buff)
//   statusApplied    a status was put on a monster (Combat.applyStatus) or on the player (Combat.applyPlayerStatus;
//                    `blocked` when crowd-control immunity stopped a stun / freeze)
//   combo            a status combo landed: Shatter / Conduct / Fan the Flames (Combat.applyCombo)
//   heal             the player healed from a hit rider (leech, smite) (Combat)
//   playerHurt       the player lost HP: a monster hit or a damage-over-time tick (Combat.hurtPlayer / tickPlayer)
//   death            the player fell (Combat.die)
//   levelUp          the player reached a new base level (Combat.gainExp, once per level gained)
//   gather           a gather node paid out (Interactions.node: mining, herbs, shards, fishing…)
//   mapEnter         the player entered a map (MapScene.create → enterMap), every entry, `first` on discovery
//   warp             the player is leaving the map through a portal / travel / respawn (MapScene.warp)
//   talk             the player started talking to an NPC (Interactions.npc), before the dialog opens
//   interact         the player reached something tapped and acts on it: npc / object / node / portal (Interactions.act)
//   questChanged     a quest moved: accepted / progress / ready / completed (book events) / abandoned / tracked
//   uiOpen / uiClose a modal panel, dialog, discovery card or minigame opened / closed (src/ui/ui.ts)
//   discovery        a discovery card is shown to the player (src/ui/ui.ts)
//   classChanged     the worn class changed (wear / become / first class discovered and worn)
//   skillLearned     the book learned a skill (forwarded from SkillBook 'learned' by the Session)
//   barChanged       the skill bar's contents changed (assign, auto-slot, class refill)
//   spark            Sudden insight: a skill cracked open into a new form mid-fight (forwarded from SkillBook 'spark')
//   monsterTelegraph a monster began a technique wind-up (MonsterSkills.start): shape, where it lands, how long
import type Phaser from 'phaser';
import type { BuffStat, ElementId, MonsterDef, ShapeKind, SkillDef, StatusKind } from '../core/types';
import type { NodeKind } from '../core/world/types';
import type { Monster } from './entities/Monster';

// ------------------------------------------------------------------ payload types

export interface Pt {
  x: number;
  y: number;
}

/** Who did / suffered something: the player, or a monster instance (valid only while its map is loaded). */
export type Actor = 'player' | Monster;

/** Fields every skill event carries. `def` is the composed SkillDef (cheap: already in hand at every emitter). */
export interface SkillRef {
  skillId: string;
  skill: SkillDef;
  element?: ElementId;
}

export interface HitEvent extends SkillRef, Pt {
  /** Always 'player' (monster hits on the player are playerHurt). */
  source: 'player';
  target: Monster;
  /** Damage dealt (0 when resisted). */
  damage: number;
  crit: boolean;
  resisted: boolean;
  /** Element × size × combo multiplier (> 1 strong, < 1 weak). */
  multiplier: number;
  /** Combo name when one landed (Shatter / Conduct / Fan the Flames). */
  combo?: string;
  /** The target died from this hit. */
  killed: boolean;
  /** Index of this hit within its cast (0 = the cast's first hit: an "engaged" cast). */
  hitIndex: number;
}

export interface DotTickEvent extends Pt {
  target: Monster;
  damage: number;
  kind: StatusKind;
}

export interface KillEvent extends Pt {
  monster: Monster;
  def: MonsterDef;
  exp: number;
  coins: number;
  elite: boolean;
  warden: boolean;
}

export interface CastStartEvent extends SkillRef, Pt {
  aim: Pt;
  target: Monster | null;
  durationMs: number;
  /** Cast by AUTO battle. */
  auto: boolean;
}

export interface CastFireEvent extends SkillRef, Pt {
  shape: ShapeKind;
  aim: Pt;
  target: Monster | null;
  rank: number;
  /** The weapon's basic attack. */
  basic: boolean;
  /** Map id the cast happened in (quest `cast` objectives). */
  map: string;
}

export interface ProjectileSpawnEvent extends SkillRef, Pt {
  owner: Actor;
  /** The projectile's image (attach trails to it; it is destroyed by its owner system). */
  obj: Phaser.GameObjects.Image;
  angle: number;
  speed: number;
  range: number;
  size: number;
}

export interface ProjectileEndEvent extends SkillRef, Pt {
  owner: Actor;
  obj: Phaser.GameObjects.Image;
  reason: 'hit' | 'range' | 'wall' | 'return';
}

export interface ChainHopEvent extends SkillRef {
  owner: Actor;
  from: Pt;
  to: Pt;
  /** 0 = first link. */
  index: number;
  /** A monster for the player's chains; 'player' when a monster's chain zaps the player. */
  target: Actor;
  /** Bouncing knives rather than lightning. */
  knives: boolean;
}

export interface NovaTelegraphEvent extends SkillRef, Pt {
  owner: Actor;
  radius: number;
  delayMs: number;
}

export interface NovaBlastEvent extends SkillRef, Pt {
  owner: Actor;
  radius: number;
  heavy: boolean;
}

export interface DashEvent extends SkillRef {
  owner: Actor;
  from: Pt;
  to: Pt;
  durationMs: number;
  width: number;
}

export interface BuffAppliedEvent extends SkillRef, Pt {
  target: Actor;
  stat: BuffStat;
  amount: number;
  durationMs: number;
}

export interface StatusAppliedEvent extends Pt {
  target: Actor;
  kind: StatusKind;
  /** Crowd-control immunity stopped it (player stuns / freezes only). */
  blocked?: boolean;
}

export interface ComboEvent extends SkillRef, Pt {
  target: Monster;
  name: string;
  consumes: StatusKind;
}

export interface HealEvent extends Pt {
  amount: number;
  source: 'leech' | 'smite';
}

export interface PlayerHurtEvent extends Pt {
  damage: number;
  hp: number;
  maxHp: number;
  /** Display name of what hurt the player ("Jellop", "Thunderhoof's Stomp"). */
  from: string;
  /** Where the blow came from, when known (knockback direction, directional kicks). */
  origin?: Pt;
  /** At least 15 % of max HP (a heavy blow). */
  heavy: boolean;
  /** Set for damage-over-time ticks. */
  dot?: StatusKind;
}

export interface DeathEvent extends Pt {
  from: string;
  expLost: number;
}

export interface LevelUpEvent extends Pt {
  level: number;
}

export interface GatherEvent extends Pt {
  node: NodeKind;
  item: string;
  /** Bag count after the gather. */
  total: number;
  map: string;
}

export interface MapEnterEvent extends Pt {
  map: string;
  /** First visit ever. */
  first: boolean;
}

export interface WarpEvent {
  from: string;
  to: string;
}

export interface TalkEvent extends Pt {
  npcId: string;
  map: string;
}

export interface InteractEvent extends Pt {
  kind: 'npc' | 'object' | 'node' | 'portal';
  /** NPC id, object id, node id or portal id (within `map`). */
  id: string;
  map: string;
}

export interface QuestChangedEvent {
  questId: string;
  reason: 'accepted' | 'progress' | 'ready' | 'completed' | 'abandoned' | 'tracked';
}

export interface UiOpenEvent {
  /** Panel name ('skills', 'classes', 'npc', …) or 'dialog' / 'discovery' / 'minigame'. */
  panel: string;
  arg?: string;
  /** Covers the whole screen (the world is fully hidden: the render lane may sleep the game loop). */
  fullscreen: boolean;
}

export interface UiCloseEvent {
  panel: string;
}

export interface DiscoveryEvent {
  /** Card family ('skill', 'spark', 'element', 'class', 'quest', …). */
  kind: string;
  title: string;
}

export interface ClassChangedEvent {
  /** The class now worn, or null for "no class". */
  classId: string | null;
  prev: string | null;
  reason: 'wear' | 'discovered';
}

export interface SkillLearnedEvent extends SkillRef {
  /** SkillBook learn source ('lesson:…', 'quest:…', 'spark:…', 'echo:…', 'class:…', 'debug', …). */
  source: string;
}

export interface BarChangedEvent {
  /** Slot indexes that changed (empty = the whole bar). */
  slots: number[];
}

export interface SparkEvent {
  from: SkillDef;
  to: SkillDef;
}

export interface MonsterTelegraphEvent extends SkillRef, Pt {
  monster: Monster;
  shape: ShapeKind;
  /** Where it will land (nova centre, the player for aimed shapes, the monster for spins / buffs). */
  at: Pt;
  /** Wind-up length until the first hit (ms). */
  durationMs: number;
  /** Nova / spin / chain radius when the shape has one. */
  radius?: number;
  /** An echo technique the player can learn by witnessing. */
  echo: boolean;
}

/** Every game event and its payload. */
export interface GameEvents {
  hit: HitEvent;
  dotTick: DotTickEvent;
  kill: KillEvent;
  castStart: CastStartEvent;
  castFire: CastFireEvent;
  projectileSpawn: ProjectileSpawnEvent;
  projectileEnd: ProjectileEndEvent;
  chainHop: ChainHopEvent;
  novaTelegraph: NovaTelegraphEvent;
  novaBlast: NovaBlastEvent;
  dash: DashEvent;
  buffApplied: BuffAppliedEvent;
  statusApplied: StatusAppliedEvent;
  combo: ComboEvent;
  heal: HealEvent;
  playerHurt: PlayerHurtEvent;
  death: DeathEvent;
  levelUp: LevelUpEvent;
  gather: GatherEvent;
  mapEnter: MapEnterEvent;
  warp: WarpEvent;
  talk: TalkEvent;
  interact: InteractEvent;
  questChanged: QuestChangedEvent;
  uiOpen: UiOpenEvent;
  uiClose: UiCloseEvent;
  discovery: DiscoveryEvent;
  classChanged: ClassChangedEvent;
  skillLearned: SkillLearnedEvent;
  barChanged: BarChangedEvent;
  spark: SparkEvent;
  monsterTelegraph: MonsterTelegraphEvent;
}

export type GameEventName = keyof GameEvents;

// ------------------------------------------------------------------ the bus

type Fn<T> = (payload: T) => void;

/** Tiny typed event bus. Listeners run in subscription order; one that throws is reported and skipped. */
export class EventBus<E extends object> {
  private readonly map = new Map<keyof E, Set<Fn<never>>>();
  /** Where listener errors go (default: console.error). Tests may replace it. */
  onError: (error: unknown, type: keyof E) => void = (error, type) => console.error(`[omnipath] '${String(type)}' listener failed:`, error);

  /** Subscribes; returns the unsubscribe function. */
  on<K extends keyof E>(type: K, fn: Fn<E[K]>): () => void {
    let set = this.map.get(type);
    if (!set) {
      set = new Set();
      this.map.set(type, set);
    }
    set.add(fn as Fn<never>);
    return () => this.off(type, fn);
  }

  /** Subscribes for the next emit only. */
  once<K extends keyof E>(type: K, fn: Fn<E[K]>): () => void {
    const off = this.on(type, (p) => {
      off();
      fn(p);
    });
    return off;
  }

  off<K extends keyof E>(type: K, fn: Fn<E[K]>): void {
    const set = this.map.get(type);
    if (!set) return;
    set.delete(fn as Fn<never>);
    if (!set.size) this.map.delete(type);
  }

  emit<K extends keyof E>(type: K, payload: E[K]): void {
    const set = this.map.get(type);
    if (!set) return;
    for (const fn of [...set]) {
      try {
        (fn as Fn<E[K]>)(payload);
      } catch (error) {
        this.onError(error, type);
      }
    }
  }

  /** True when anything listens (emitters may skip building an expensive payload). */
  has(type: keyof E): boolean {
    return !!this.map.get(type)?.size;
  }

  /** Listener count for one event, or for all of them (leak checks: warping must not grow it). */
  count(type?: keyof E): number {
    if (type !== undefined) return this.map.get(type)?.size ?? 0;
    let n = 0;
    for (const set of this.map.values()) n += set.size;
    return n;
  }

  /** Removes the listeners of one event, or every listener. */
  clear(type?: keyof E): void {
    if (type === undefined) this.map.clear();
    else this.map.delete(type);
  }
}

/** A group of subscriptions removed together (a scene, a panel, a system). */
export class Scope<E extends object> {
  private offs: (() => void)[] = [];
  constructor(private readonly bus: EventBus<E>) {}

  on<K extends keyof E>(type: K, fn: Fn<E[K]>): this {
    this.offs.push(this.bus.on(type, fn));
    return this;
  }

  once<K extends keyof E>(type: K, fn: Fn<E[K]>): this {
    this.offs.push(this.bus.once(type, fn));
    return this;
  }

  /** Removes every subscription made through this scope. Safe to call twice. */
  clear(): void {
    for (const off of this.offs.splice(0)) off();
  }
}

/** The run-wide bus (one per page; survives map restarts). */
export const gameBus = new EventBus<GameEvents>();

/** Anything with Phaser's scene event emitter (structural, so this module stays loadable in node tests). */
interface SceneLike {
  events: { once(event: string, fn: () => void): unknown };
}

/**
 * Subscriptions that live as long as ONE map: cleared on the scene's SHUTDOWN (every map change restarts the
 * scene). Call it from create(), never from the constructor.
 */
export function sceneScope(scene: SceneLike, bus: EventBus<GameEvents> = gameBus): Scope<GameEvents> {
  const scope = new Scope(bus);
  scene.events.once('shutdown', () => scope.clear());
  return scope;
}
