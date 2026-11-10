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
//   dotTick          a damage-over-time tick hurt a monster (burn / poison / bleed) (Combat.updateMonster)
//   kill             a monster died to the player (Combat.kill, after exp / coins / drops): rewards & quests
//   castStart        the player began a wind-up (castMs > 0) (Combat.castSkill)
//   castFire         a player skill's effect fires: SP paid, cooldown started (Combat.fire), basics included
//   projectileSpawn  a projectile left its owner (SkillSystem.spawnProjectile, MonsterSkills.shoot)
//   projectileEnd    a projectile was removed: hit (pierce spent / struck the player), expire (range), wall, or caught
//                    (a returning projectile back in the caster's hand)
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
//   death            an actor died — a monster (Combat.kill, right after `kill`) or the player (Combat.die): visuals
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
//
// VFX additions (docs/INTEGRATION-v3.md §4, docs/VFX.md §8.2 — the names the VFX bridge uses), emitted since v3:
//   skillPulse          each strike swing / spin pulse / nova release / volley launch of ONE cast (player:
//                       SkillSystem; monster: MonsterSkills swing / pulse / volley) — the VFX never re-times swings
//   monsterTelegraphEnd a telegraphed monster technique resolved (its hits ran) or was cancelled (death, stun)
//   enrage              a warden became enraged below half HP (MonsterSkills.enrage)
//   chainLaunch         a chain link leaves (player chains): lightning shows at once, knives fly flightMs to chainHop;
//                       a monster chain that found nothing in reach (target null: the charge fizzles)
// VFX World lane additions (docs/VFX.md §8.9):
//   monsterSpawn        a monster respawned at its spawn (Combat.respawn): the spawn pop
//   monsterTelegraph    + `live` (the exact live geometry MonsterSkills hit-tests) and `phases` (follow-up swings)
// v4 Phase 1 additions (docs/SPEC-v4.md §6.1, §3.6; append-only):
//   objectSpawn         a player skill placed something in the world (a zone): where, how big, how long, its ticks
//   objectTick          a placed object ticks (a zone pulses), before the hits of that tick
//   objectEnd           a placed object is gone: expire / cap (the 12-object cap) / replaced / consumed / clear
//   blink               the player vanished at `from` and appeared at `to` (an arrival hit follows when `radius`)
//   mend                a mend skill healed the player (each pulse of a heal over time; `first` on the cast)
//   shieldUp            a shield skill raised a shell; shieldHit: it soaked a blow; shieldEnd: broken / expired /
//                       replaced (a burst of `burst` px follows when the skill has one)
//   weaponChanged       the held weapon changed (bag, the "Needs a sword — Equip" line, becoming a class)
//   mechanic            the worn class's mechanic did something worth showing: `type` is the core MechanicEffect
//                       type (full, spent, comboStep, comboBreak, finisher, marked, cashIn, markEnd, stance, placed,
//                       expired, levelUp, consumed); the HUD widget itself reads GameController.mechanicView()
//   statusApplied       + kinds root / launch / expose / lure (monsters and the player)
//   hit / castFire      + `boost` (what the class mechanic added to this cast), `finisher` (its name)
//   heal                + source 'mend'
// Fields marked "(VFX request)" are filled where the emitter knows them (castId on castStart, projectile id / index /
// count, telegraph id / timing / tell / rank, untilMs, source, via / from, spreadTo, heal.from, spark x / y,
// death.killer, playerHurt attacker / skill); they stay optional, so listeners must cope with them missing.
import type Phaser from 'phaser';
import type { MechanicEffect, MechanicView } from '../core/mechanics';
import type { BuffStat, CastBoost, ElementId, MonsterDef, MonsterRank, ShapeKind, SkillDef, StatusKind, WeaponType } from '../core/types';
import type { NodeKind } from '../core/world/types';
import type { Monster } from './entities/Monster';

// ------------------------------------------------------------------ payload types

export interface Pt {
  x: number;
  y: number;
}

/** Who did / suffered something: the player, or a monster instance (valid only while its map is loaded). */
export type Actor = 'player' | Monster;

/** Fields every skill event carries. `skill` is the composed SkillDef (cheap: already in hand at every emitter). */
export interface SkillRef {
  skillId: string;
  skill: SkillDef;
  element?: ElementId;
  /**
   * The player's cast (SkillSystem Cast.id): links castFire → projectiles / hops / novas / hits of the SAME cast
   * (a reprise keeps its id); castStart carries the id reserved at wind-up. Absent for monster techniques.
   */
  castId?: number;
  /** The reprised copy of a cast (same castId) (VFX request). */
  reprise?: boolean;
}

/** A live projectile record (SkillSystem Projectile / MonsterSkills Shot): read it every frame while it flies. */
export interface Mover {
  readonly x: number;
  readonly y: number;
  readonly vx: number;
  readonly vy: number;
  readonly returning?: boolean;
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
  /** Blow direction (radians, from the cast origin toward the target). */
  ang: number;
  /** How the blow arrived when not directly: an arc-rider zap, a pierce, a returning projectile (VFX request). */
  via?: 'arc' | 'pierce' | 'return';
  /** Arc rider: where the zap came from (VFX request). */
  from?: Pt;
  /** v4: what the class mechanic added to the cast this hit belongs to (absent: nothing). */
  boost?: CastBoost;
  /** v4: the cast is a combo finisher of this name ("Finisher", "Roadhouse"). */
  finisher?: string;
  /** v4: the placed object (objectSpawn id) whose tick landed this hit. */
  objectId?: number;
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
  /** v4: what the class mechanic added to this cast (absent: nothing). */
  boost?: CastBoost;
  /** v4: this cast is a combo finisher of this name. */
  finisher?: string;
  /** v4: the bar skill that was pressed, when a stance cast another skill in its place. */
  barId?: string;
  /** v4: the cast was paid with HP (percent of max HP) instead of SP. */
  hpCostPct?: number;
}

export interface ProjectileSpawnEvent extends SkillRef, Pt {
  owner: Actor;
  /** The projectile's image (attach trails to it; it is destroyed by its owner system). */
  obj: Phaser.GameObjects.Image;
  /** The live projectile record (position / velocity every frame; identity until projectileEnd). */
  mover: Mover;
  angle: number;
  speed: number;
  range: number;
  size: number;
  /** Unique per projectile (projectileEnd carries the same id) (VFX request). */
  id?: number;
  /** Volley position: index of count (VFX request). */
  index?: number;
  count?: number;
}

export interface ProjectileEndEvent extends SkillRef, Pt {
  owner: Actor;
  obj: Phaser.GameObjects.Image;
  mover: Mover;
  reason: 'hit' | 'expire' | 'wall' | 'caught';
  /** Same id as its projectileSpawn (VFX request). */
  id?: number;
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
  /** Scene-time window of the marker: progress = (now - start) / (at - start). */
  timing: { start: number; at: number };
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
  /** The caster spins through the dash. */
  spin: boolean;
}

export interface BuffAppliedEvent extends SkillRef, Pt {
  target: Actor;
  stat: BuffStat;
  amount: number;
  durationMs: number;
  /** Scene time the buff ends (VFX request). */
  untilMs?: number;
}

export interface StatusAppliedEvent extends Pt {
  target: Actor;
  kind: StatusKind;
  /** Crowd-control immunity stopped it (player stuns / freezes only). */
  blocked?: boolean;
  /** Scene time the status ends (VFX request). */
  untilMs?: number;
  /** The skill that applied it (VFX request). */
  source?: SkillDef;
}

export interface ComboEvent extends SkillRef, Pt {
  target: Monster;
  name: string;
  consumes: StatusKind;
  /** Fan the Flames: where the burn spread to (VFX request). */
  spreadTo?: Pt[];
}

export interface HealEvent extends Pt {
  amount: number;
  source: 'leech' | 'smite' | 'mend';
  /** The struck target the heal streams from (VFX request). */
  from?: Pt;
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
  /** The monster that struck (not for DoT ticks) and its technique, when known (VFX request). Monster blows on
   *  the player stay `playerHurt` — `hit` is only ever the player's hit on a monster. */
  attacker?: Monster;
  skillId?: string;
  skill?: SkillDef;
}

export interface DeathEvent extends Pt {
  /** Who died: 'player' or the monster (its sprite is still on screen this frame). */
  target: Actor;
  /** Monster rank (monster deaths). */
  rank?: MonsterRank;
  /** What killed the player (player deaths). */
  from?: string;
  /** EXP the player lost (player deaths). */
  expLost?: number;
  /** The player's cast that killed the monster (VFX request). */
  killer?: SkillRef;
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
  /**
   * Why (src/ui/announce.ts words the toast; absent = 'assign'):
   *   assign       the player put a skill in (or moved it) — no toast
   *   clear        the player emptied a slot — no toast
   *   learned      a newly learned skill dropped into an empty own slot ("Flame Spin is on your bar")
   *   class        becoming a class refilled the class slots (the classChanged headline covers it)
   *   classLearned the worn class took a newly learned matching skill ("Pyroblade equipped Flame Spin")
   *   load         a save was padded / repaired on load — no toast
   */
  reason?: 'assign' | 'clear' | 'learned' | 'class' | 'classLearned' | 'load';
  /** The skill placed (learned / classLearned). */
  skillId?: string;
  /** The worn class (class / classLearned). */
  classId?: string;
}

export interface SparkEvent {
  from: SkillDef;
  to: SkillDef;
  /** Where it happened: the struck target (VFX request). */
  x?: number;
  y?: number;
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
  /** Unique per tell; monsterTelegraphEnd carries the same id (VFX request). */
  id?: number;
  /** The live pending record (MonsterSkills.shiftTime moves it): progress = (now - start) / (at - start) (VFX request). */
  timing?: { readonly start: number; readonly at: number };
  /** Exact geometry as MonsterSkills draws and hit-tests it (VFX request). */
  tell?: TellShape;
  rank?: MonsterRank;
  /**
   * The tell's exact LIVE geometry (VFX World lane addition): the very function MonsterSkills hit-tests when the
   * tell lands. Read it every frame: the caster may be pushed mid wind-up, an aim line follows the player.
   */
  live?: () => TellShape;
  /** Every phase of the technique (live records): the wind-up first, then each follow-up swing / pulse. */
  phases?: readonly TellPhase[];
}

/** One phase of a telegraphed technique (MonsterSkills Pending: shiftTime moves it; state flips on resolve / cancel). */
export interface TellPhase {
  readonly start: number;
  readonly at: number;
  readonly state: 'pending' | 'resolved' | 'cancelled';
}

/** Exact telegraph geometry (angles in radians); structurally the VFX's TellGeometry (src/game/vfx/types.ts). */
export type TellShape =
  | { kind: 'zone'; x: number; y: number; rx: number; ry: number }
  | { kind: 'cone'; x: number; y: number; r: number; ang: number; arc: number }
  | { kind: 'lane'; x0: number; y0: number; x1: number; y1: number; width: number }
  | { kind: 'aim'; x: number; y: number; angs: readonly number[]; len: number; /** Per-shot length (a shot stops at the first blocked tile); `len` when absent. */ lens?: readonly number[] }
  | { kind: 'range'; x: number; y: number; r: number }
  | { kind: 'aura'; x: number; y: number; rx: number; ry: number };

/** One phase of a cast: a strike swing, spin pulse, nova release or volley launch (docs/VFX.md §8.2 skillPulse). */
export interface SkillPulseEvent extends SkillRef, Pt {
  owner: Actor;
  /** 0-based phase index of `count` phases in this cast. */
  index: number;
  count: number;
  /** Swing / pulse direction (radians). */
  ang: number;
  aim?: Pt;
}

export interface MonsterTelegraphEndEvent {
  /** The monsterTelegraph id. */
  id: number;
  monster: Monster;
  reason: 'resolve' | 'cancel';
}

export interface EnrageEvent extends Pt {
  monster: Monster;
}

/**
 * A chain link leaves (VFX addition): lightning appears at once, a knife / blade flies `flightMs` before its
 * chainHop. Emitted for the player's chains (SkillSystem.chain), including a chain that found no target (`target`
 * null: the link fizzles at `to`).
 */
export interface ChainLaunchEvent extends SkillRef {
  owner: Actor;
  from: Pt;
  to: Pt;
  index: number;
  target: Actor | null;
  knives: boolean;
  /** Flight time to `to` (ms): 0 for lightning, 90 for knives. */
  flightMs: number;
}

/** A monster (re)appeared at its spawn after its respawn timer (Combat.respawn): the VFX spawn pop. */
export interface MonsterSpawnEvent extends Pt {
  monster: Monster;
  rank: MonsterRank;
}

// ------------------------------------------------------------------ v4 Phase 1 payloads

/** A placed world object as events show it. `obj` is the live record (x / y / radius / level / alive every frame). */
export interface ObjectRef {
  /** Unique for the run; objectSpawn / objectTick / objectEnd / hit.objectId carry the same id. */
  id: number;
  kind: 'zone';
  /** Live record owned by SkillSystem (never keep it past objectEnd). */
  obj: { readonly x: number; readonly y: number; readonly radius: number; readonly level: number; readonly alive: boolean; readonly line?: { x0: number; y0: number; x1: number; y1: number } };
}

export interface ObjectSpawnEvent extends SkillRef, Pt, ObjectRef {
  owner: Actor;
  /** Circle radius, or half the width of a lane. */
  radius: number;
  /** A lane (zone `line`) instead of a circle: its two ends on the ground. */
  line?: { x0: number; y0: number; x1: number; y1: number };
  /** It moves with the caster. */
  follow: boolean;
  /** How long it stands (ms; Infinity: until replaced, used up or the map changes) and the scene time it ends. */
  durationMs: number;
  untilMs: number;
  /** Ms between ticks and how many it lands in all. */
  tickMs: number;
  ticks: number;
  /** The class mechanic's object (Hearth, Runestone): its name. */
  mechanic?: string;
}

export interface ObjectTickEvent extends SkillRef, Pt, ObjectRef {
  /** 0-based tick index of `ticks`. */
  index: number;
  ticks: number;
  radius: number;
}

export interface ObjectEndEvent extends SkillRef, Pt, ObjectRef {
  reason: 'expire' | 'cap' | 'replaced' | 'consumed' | 'clear';
}

export interface BlinkEvent extends SkillRef {
  owner: Actor;
  from: Pt;
  to: Pt;
  /** Shape `to`: a point ahead, the target, in place, or one of the player's own objects. */
  mode: 'point' | 'target' | 'self' | 'object';
  /** Arrival hit radius (px) when the skill has one. */
  radius?: number;
}

export interface MendEvent extends SkillRef, Pt {
  /** HP restored by this pulse. */
  amount: number;
  /** The first pulse (the cast); later pulses of a heal over time are false. */
  first: boolean;
  /** Heal over time: its whole length (ms). */
  overMs?: number;
  /** Resting circle (px) the heal over time needs you to stay in. */
  radius?: number;
}

export interface ShieldUpEvent extends SkillRef, Pt {
  /** HP the shell soaks. */
  amount: number;
  durationMs: number;
  untilMs: number;
  /** Burst radius when it ends (px), if any. */
  burst?: number;
}

export interface ShieldHitEvent extends Pt {
  /** Damage soaked by this blow and what the shell has left. */
  absorbed: number;
  left: number;
  /** Where the blow came from, when known. */
  origin?: Pt;
}

export interface ShieldEndEvent extends SkillRef, Pt {
  reason: 'broken' | 'expired' | 'replaced' | 'clear';
  /** Burst radius (px) when the shell bursts as it ends. */
  burst?: number;
}

export interface WeaponChangedEvent {
  weapon: WeaponType;
  prev: WeaponType;
  /** Why: a swap by the player, becoming a class, or a weapon just bought. */
  reason: 'swap' | 'class' | 'buy';
}

/**
 * The worn class's mechanic did something (docs/SPEC-v4.md §3.6): VFX / audio feedback. `type` is the core effect's
 * type; `effect` the effect itself. Positions: the player's feet, unless `target` / `at` says otherwise.
 */
export interface MechanicEventPayload extends Pt {
  classId: string;
  /** Mechanic kind: gauge | combo | marks | stance | zone. */
  kind: string;
  /** The name shown: the mechanic's, or the finisher's / stance's own. */
  name: string;
  type: MechanicEffect['type'];
  effect: MechanicEffect;
  /** The widget after this effect. */
  view: MechanicView | null;
  /** marked / markEnd: the foe; cashIn: every foe that held marks. */
  target?: Monster;
  targets?: { target: Monster; marks: number; stored: number }[];
  /** spent / finisher / cashIn / consumed: the skill. */
  skillId?: string;
  /** placed / expired / levelUp / consumed: where the object stands (or stood). */
  at?: Pt;
  /** placed / expired / levelUp: the world object id (objectSpawn id), when it exists. */
  objectId?: number;
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
  // VFX requests (docs/VFX.md §8.2), emitted by SkillSystem / MonsterSkills.
  skillPulse: SkillPulseEvent;
  monsterTelegraphEnd: MonsterTelegraphEndEvent;
  enrage: EnrageEvent;
  // VFX runtime additions (docs/VFX.md §8.2): append-only.
  chainLaunch: ChainLaunchEvent;
  // VFX World lane additions (docs/VFX.md §8.9): append-only.
  monsterSpawn: MonsterSpawnEvent;
  // v4 Phase 1 (docs/SPEC-v4.md §6.1, §3.6): append-only.
  objectSpawn: ObjectSpawnEvent;
  objectTick: ObjectTickEvent;
  objectEnd: ObjectEndEvent;
  blink: BlinkEvent;
  mend: MendEvent;
  shieldUp: ShieldUpEvent;
  shieldHit: ShieldHitEvent;
  shieldEnd: ShieldEndEvent;
  weaponChanged: WeaponChangedEvent;
  mechanic: MechanicEventPayload;
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
