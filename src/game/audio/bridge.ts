// Game events → sounds, per map (docs/INTEGRATION-v3.md §4 bus contract). MapScene.create() attaches one bridge
// (one seam line) and its disposer runs on SHUTDOWN, so warping never grows the listener count. Positions are
// spatialised against the camera view (pan + distance); the player's own actions play centred. Phaser-free (types
// only), so tests drive it with a fake scene and a recording sink.
//
// Restraint rules: the first hit of a cast plays full, later hits of the same cast (multi-target spins, novas,
// volleys) get quieter; simultaneous hits collapse through the voice groups (src/game/audio/voices.ts); status
// ticks and footsteps sit at the bottom of the priority list.
import { hashSeed, mulberry32 } from '../../core/rng';
import type { Biome, MapKind } from '../../core/world/types';
import type { Family, MonsterRank, Size, WeaponType } from '../../core/types';
import { type EventBus, type GameEvents, gameBus, Scope } from '../events';
import { objectKey } from '../world/runtime';
import {
  castSound,
  chargeSound,
  comboSound,
  deathSound,
  discoverySound,
  type FistBlow,
  fistSound,
  gatherSound,
  hitSound,
  mechanicSound,
  novaSound,
  statusSound,
  stepSound,
  swingSound,
  tickSound,
} from './bank';
import type { MapInfo } from './ambience';
import type { PlayOptions } from './engine';
import { MIN_SPATIAL_GAIN, spatialize, type View } from './spatial';
import { type GroundGrid, surfaceAt } from './surfaces';

/** Where the bridge sends sounds (the engine; tests record). */
export interface AudioSink {
  play(name: string, opts?: PlayOptions): unknown;
  setMap(info: MapInfo): void;
}

interface MonsterLike {
  x: number;
  y: number;
  def: { family: Family; size: Size; rank: MonsterRank };
}

/** The slice of MapScene the bridge reads (structural: no Phaser import). */
export interface AudioScene {
  events: {
    on(event: string, fn: (...args: never[]) => void): unknown;
    off(event: string, fn: (...args: never[]) => void): unknown;
  };
  cameras: { main: { worldView: { centerX: number; centerY: number; width: number; height: number } } };
  player?: {
    x: number;
    y: number;
    moving: boolean;
    sprite?: { anims?: { currentAnim?: { key: string } | null; currentFrame?: { index: number } | null } };
  };
  cm?: GroundGrid;
  def?: {
    id: string;
    biome: Biome;
    kind: MapKind;
    flags?: readonly string[];
    objects?: readonly { id: string; kind: string; tx: number; ty: number }[];
    nodes?: readonly { id: string; kind: string; tx: number; ty: number }[];
  };
  session?: { player: { weapon: WeaponType }; world?: { chests: readonly string[] } };
}

/** Footstep fallback stride (px) when the walk animation is not playing. */
const STRIDE = 18;
/** Walk animation frames whose feet are planted (1-based Phaser frame index of `_walk_0` / `_walk_2`). */
const CONTACT_FRAMES: ReadonlySet<number> = new Set([1, 3]);

const SIZE_RATE: Readonly<Record<Size, number>> = { S: 1.18, M: 1, L: 0.84 };
const RANK_RATE: Readonly<Record<MonsterRank, number>> = { common: 1, elite: 0.94, warden: 0.8 };
const monsterRate = (m: MonsterLike): number => (SIZE_RATE[m.def.size] ?? 1) * (RANK_RATE[m.def.rank] ?? 1);
const isMonster = (a: unknown): a is MonsterLike => typeof a === 'object' && a !== null && 'def' in a;
const clock = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const TILE = 32;

/** A sounding thing placed on the map (ambience positional emitters, docs/QUALITY-PLAN.md §13). */
interface EmitterDef {
  sound: string;
  /** Seconds between plays. */
  every: [number, number];
  /** Audible within this many tiles of the player (linear fade). */
  radius: number;
  gain?: number;
  rate?: [number, number];
}

/** Map objects / gather nodes that sound by themselves when the player is near. */
export const EMITTERS: Readonly<Record<string, readonly EmitterDef[]>> = {
  campfire: [{ sound: 'amb_crackle', every: [0.5, 1.4], radius: 7 }],
  ember_vent: [
    { sound: 'amb_crackle', every: [1, 2.5], radius: 6 },
    { sound: 'amb_lava_bubble', every: [3, 7], radius: 6, gain: 0.8 },
  ],
  wind_chime: [{ sound: 'amb_chime', every: [4, 9], radius: 8, rate: [1.05, 1.25] }],
  sun_spring: [{ sound: 'amb_drip', every: [1.5, 3.5], radius: 6, rate: [1.2, 1.5] }],
  fishing: [{ sound: 'amb_plop', every: [5, 12], radius: 7 }],
  storm_tree: [{ sound: 'amb_crackle', every: [3, 7], radius: 6, rate: [1.3, 1.6] }],
  frost_crystal: [{ sound: 'amb_chime', every: [6, 12], radius: 6, gain: 0.5, rate: [1.4, 1.6] }],
  altar: [{ sound: 'amb_chime', every: [8, 14], radius: 5, gain: 0.7, rate: [0.78, 0.84] }],
  wind_shrine: [{ sound: 'amb_gust', every: [6, 12], radius: 6, gain: 0.6 }],
};

interface Emitter {
  def: EmitterDef;
  x: number;
  y: number;
  next: number;
}

/**
 * Which blow of the fist set a bare-handed skill lands (the VFX's rule, vfx/recipe.ts fistClassOf, restated on the
 * skill alone so the audio stays free of the VFX modules): slam for executes and heavy area blows, kick for kicks,
 * spins and light dashes, palm for pushes and spirit forms, hook for heavy punches, jab otherwise.
 */
export function fistBlow(skill: { tags: readonly string[]; power: number; delivery?: string; shape: { kind: string } }): FistBlow {
  const t = skill.tags;
  const kind = skill.shape.kind;
  const heavy = t.includes('heavy') || t.includes('execute') || skill.power >= 2;
  if (t.includes('execute') || (heavy && t.includes('aoe') && kind !== 'spin')) return 'slam';
  if (skill.delivery === 'kick' || kind === 'spin') return 'kick';
  if (kind === 'nova') return 'palm';
  if (heavy) return 'hook';
  if (kind === 'dash') return 'kick';
  if (t.includes('spirit') || t.includes('technique')) return 'palm';
  return 'jab';
}

/** Quieter for every later hit of the same cast. */
export function hitRestraint(hitIndex: number): number {
  return hitIndex <= 0 ? 1 : Math.max(0.35, 0.72 ** hitIndex);
}

/** Subscribes the scene's sounds; returns the disposer (MapScene pushes it on its SHUTDOWN list). */
export function createAudioBridge(scene: AudioScene, sink: AudioSink, bus: EventBus<GameEvents> = gameBus): () => void {
  const scope = new Scope(bus);
  const roared = new WeakSet<object>();
  let lastQuestComplete = -1e9;
  let lastLowHp = -1e9;
  let lastFrame = -1;
  let stepDist = 0;
  let lastX = NaN;
  let lastY = NaN;
  let foot = 0;

  const view = (): View => {
    const wv = scene.cameras.main.worldView;
    return { cx: wv.centerX, cy: wv.centerY, halfW: wv.width / 2, halfH: wv.height / 2 };
  };
  /** A sound at a world position. */
  const at = (name: string, x: number, y: number, o: PlayOptions = {}): void => {
    const sp = spatialize(x, y, view());
    if (sp.gain < MIN_SPATIAL_GAIN) return;
    sink.play(name, { ...o, pan: sp.pan, gain: (o.gain ?? 1) * sp.gain });
  };
  /** A centred sound (the player's own body, UI, fanfares). */
  const here = (name: string, o: PlayOptions = {}): void => {
    sink.play(name, o);
  };
  const weapon = (): WeaponType => scene.session?.player.weapon ?? 'sword';

  // Positional emitters from the map's objects and nodes (seeded per map, so a place keeps its rhythm).
  const rng = mulberry32(hashSeed('omnipath-emitters', scene.def?.id ?? ''));
  const between = ([a, b]: readonly [number, number]) => a + rng() * (b - a);
  const emitters: Emitter[] = [];
  for (const placed of [...(scene.def?.objects ?? []), ...(scene.def?.nodes ?? [])]) {
    for (const def of EMITTERS[placed.kind] ?? []) {
      emitters.push({ def, x: placed.tx * TILE + TILE / 2, y: placed.ty * TILE + TILE / 2, next: clock() + between(def.every) * 1000 });
    }
  }
  const tickEmitters = (px: number, py: number): void => {
    const now = clock();
    for (const e of emitters) {
      if (now < e.next) continue;
      e.next = now + between(e.def.every) * 1000;
      const d = Math.hypot(e.x - px, e.y - py) / TILE;
      if (d >= e.def.radius) continue;
      at(e.def.sound, e.x, e.y, { gain: (e.def.gain ?? 1) * (1 - d / e.def.radius), rate: e.def.rate ? between(e.def.rate) : 1 });
    }
  };

  // ---------------------------------------------------------------- the player's casts
  scope.on('castStart', (e) => {
    if (e.durationMs >= 150) here(chargeSound(e.element ?? e.skill.element));
  });
  scope.on('castFire', (e) => {
    // Strikes / spins / volleys / novas speak through skillPulse, dashes through dash, buffs through buffApplied;
    // blinks, mends and shields through their own events (v4). A zone speaks here, as its field goes down.
    if (e.shape === 'chain' || e.shape === 'zone') here(castSound(e.shape, e.element ?? e.skill.element));
  });

  // ---------------------------------------------------------------- v4: zones, blinks, mends, shields, mechanics
  scope.on('objectTick', (e) => at('zone_tick', e.x, e.y, { gain: e.index === 0 ? 1 : 0.8 }));
  scope.on('objectEnd', (e) => {
    // A map change clears everything at once; an object used up by a skill is spoken for by that skill.
    if (e.reason !== 'clear' && e.reason !== 'consumed') at('zone_end', e.x, e.y);
  });
  scope.on('blink', (e) => {
    if (!isMonster(e.owner)) here(castSound('blink', e.element ?? e.skill.element));
  });
  scope.on('mend', (e) => {
    if (e.first) here(castSound('mend', e.element ?? e.skill.element));
    else here('mend_tick', { gain: 0.8 });
  });
  scope.on('shieldUp', (e) => here(castSound('shield', e.element ?? e.skill.element)));
  scope.on('shieldHit', (e) => {
    // Lean toward the blow, like a hurt.
    here('shield_absorb', { pan: e.origin ? spatialize(e.origin.x, e.origin.y, view()).pan * 0.5 : 0 });
  });
  scope.on('shieldEnd', (e) => {
    if (e.reason === 'broken') here('shield_break');
    else if (e.reason === 'expired') here('shield_break', { gain: 0.55, rate: 1.2 });
    if (e.burst && (e.reason === 'broken' || e.reason === 'expired')) here(novaSound(e.burst), { gain: 0.85 });
  });
  scope.on('mechanic', (e) => {
    const s = mechanicSound(e.type);
    if (!s) return;
    const fx = e.effect;
    switch (fx.type) {
      case 'comboStep':
        // Each step a tone higher: the ear hears the combo climb.
        return here(s, { rate: 1 + 0.12 * Math.max(0, Math.min(4, fx.step - 1)) });
      case 'stance':
        return here(s, { rate: fx.stance ? 0.92 : 1.06 });
      case 'marked':
        return e.target ? at(s, e.target.x, e.target.y, { rate: 1 + 0.09 * Math.max(0, Math.min(4, fx.marks - 1)) }) : undefined;
      case 'markEnd':
        return e.target ? at(s, e.target.x, e.target.y, { rate: 0.8, gain: 0.8 }) : undefined;
      case 'levelUp':
        return e.at ? at(s, e.at.x, e.at.y, { rate: 1 + 0.06 * Math.max(0, Math.min(5, fx.level - 1)) }) : here(s);
      default:
        return here(s);
    }
  });
  scope.on('skillPulse', (e) => {
    const el = e.element ?? e.skill.element;
    const kind = e.skill.shape.kind;
    if (isMonster(e.owner)) {
      if (kind === 'strike' || kind === 'spin') at('mon_swing', e.x, e.y, { rate: monsterRate(e.owner), gain: e.index === 0 ? 1 : 0.7 });
      return;
    }
    const later = e.index > 0 ? 0.8 : 1;
    switch (kind) {
      case 'strike': {
        const heavy = e.skill.tier >= 2 || e.skill.power >= 1.8 || e.skill.tags.includes('heavy');
        here(swingSound(weapon(), heavy), { gain: later });
        if (el && e.index === 0) here(castSound('strike', el));
        break;
      }
      case 'spin':
        if (e.index === 0) here(castSound('spin', el));
        else here('swing_spin', { gain: 0.7 });
        break;
      case 'projectile':
        here(castSound('projectile', el));
        break;
      case 'nova':
        here(castSound('nova', el));
        break;
      default:
        break;
    }
  });
  scope.on('projectileSpawn', (e) => {
    const i = e.index ?? 0;
    if (i >= 3) return;
    if (isMonster(e.owner)) {
      if (i === 0) at('mon_shot', e.x, e.y, { rate: monsterRate(e.owner) });
      return;
    }
    at('proj_whoosh', e.x, e.y, { gain: i === 0 ? 1 : 0.5 });
  });
  scope.on('projectileEnd', (e) => {
    const g = isMonster(e.owner) ? 0.6 : 1;
    if (e.reason === 'wall') at('proj_wall', e.x, e.y, { gain: g });
    else if (e.reason === 'expire' && !isMonster(e.owner)) at('proj_fizzle', e.x, e.y);
    else if (e.reason === 'caught') here('proj_catch');
  });
  scope.on('chainLaunch', (e) => {
    if (e.knives) at('proj_whoosh', e.from.x, e.from.y, { rate: 1.45, gain: 0.6 });
    if (!e.target) at('proj_fizzle', e.to.x, e.to.y);
  });
  scope.on('chainHop', (e) => {
    const rate = 1 + Math.min(6, e.index) * (e.knives ? 0.05 : 0.07);
    at(e.knives ? 'knife_ricochet' : 'zap_chain', e.to.x, e.to.y, { rate });
  });
  scope.on('novaBlast', (e) => {
    at(novaSound(e.radius), e.x, e.y, { gain: isMonster(e.owner) ? 0.85 : 1, rate: e.heavy ? 0.92 : 1 });
  });
  scope.on('dash', (e) => {
    if (isMonster(e.owner)) at('mon_dash', e.from.x, e.from.y, { rate: monsterRate(e.owner) });
    else {
      here(castSound('dash', e.element ?? e.skill.element));
      if (e.spin) here('swing_spin', { gain: 0.6 });
    }
  });
  scope.on('buffApplied', (e) => {
    if (isMonster(e.target)) at('mon_buff', e.x, e.y, { rate: monsterRate(e.target) });
    else here(castSound(e.stat === 'def' ? 'ward' : 'buff', e.element ?? e.skill.element));
  });

  // ---------------------------------------------------------------- hits, statuses, combos
  scope.on('hit', (e) => {
    const el = e.element ?? e.skill.element;
    const g = hitRestraint(e.hitIndex);
    if (e.resisted) {
      at('hit_resist', e.x, e.y, { gain: g });
      return;
    }
    const strong = e.multiplier > 1.25;
    const weak = e.multiplier < 0.8;
    at(hitSound(el), e.x, e.y, { gain: g * (weak ? 0.85 : 1), rate: strong ? 1.06 : weak ? 0.94 : 1 });
    // Bare hands: the blow's own layer (jab / hook / palm / kick / slam) over the element hit.
    if (e.skill.tags.includes('fist')) at(fistSound(fistBlow(e.skill)), e.x, e.y, { gain: g });
    if (e.crit) at('crit', e.x, e.y, { gain: g });
    if (e.via === 'arc') at('zap_chain', e.x, e.y, { gain: 0.45, rate: 1.2 });
  });
  scope.on('dotTick', (e) => at(tickSound(e.kind), e.x, e.y, { gain: 0.8 }));
  scope.on('statusApplied', (e) => {
    if (e.target === 'player') {
      if (e.blocked) here('status_blocked');
      else {
        const s = statusSound(e.kind);
        if (s) here(s);
      }
      return;
    }
    const s = statusSound(e.kind);
    if (s) at(s, e.x, e.y, { gain: 0.7 });
  });
  scope.on('combo', (e) => at(comboSound(e.name), e.x, e.y));
  // (A mend skill's heal is voiced by its own `mend` event.)
  scope.on('heal', (e) => {
    if ((e.source as string) !== 'mend') here('heal');
  });
  scope.on('spark', (e) => {
    if (e.x !== undefined && e.y !== undefined) at('spark_crack', e.x, e.y);
    else here('spark_crack');
  });

  // ---------------------------------------------------------------- the player getting hurt
  scope.on('playerHurt', (e) => {
    const name = e.dot ? 'hurt_dot' : e.heavy ? 'hurt_heavy' : 'hurt';
    // Lean a little toward where the blow came from.
    const pan = e.origin ? spatialize(e.origin.x, e.origin.y, view()).pan * 0.5 : 0;
    here(name, { pan });
    const now = clock();
    if (e.maxHp > 0 && e.hp > 0 && e.hp / e.maxHp < 0.25 && now - lastLowHp > 5000) {
      lastLowHp = now;
      here('hurt_low', { delay: 0.25 });
    }
  });

  // ---------------------------------------------------------------- monsters
  scope.on('monsterTelegraph', (e) => {
    const m = e.monster as unknown as MonsterLike;
    const rank = e.rank ?? m.def.rank;
    if (rank === 'warden' && !roared.has(e.monster)) {
      roared.add(e.monster);
      at('boss_roar', e.x, e.y, { rate: monsterRate(m) / 0.8 });
    }
    at(rank === 'common' ? 'tell' : 'tell_big', e.x, e.y);
    if (e.echo) at('tell_echo', e.x, e.y);
  });
  scope.on('monsterTelegraphEnd', (e) => {
    if (e.reason === 'cancel') at('tell_cancel', e.monster.x, e.monster.y);
  });
  scope.on('enrage', (e) => {
    roared.add(e.monster);
    at('boss_enrage', e.x, e.y);
  });
  scope.on('kill', (e) => {
    if (e.coins > 0) at('coin', e.x, e.y, { delay: 0.14 });
    if (e.elite || e.warden) here('kill_elite', { delay: 0.22 });
  });
  scope.on('death', (e) => {
    if (e.target === 'player') {
      here('player_death');
      return;
    }
    const m = e.target as unknown as MonsterLike;
    if (m.def.rank === 'warden') here('death_warden');
    else at(deathSound(m.def.family), e.x, e.y, { rate: monsterRate(m) });
  });

  // ---------------------------------------------------------------- progress, world, UI
  scope.on('levelUp', () => here('level_up'));
  scope.on('gather', (e) => at(gatherSound(e.node), e.x, e.y));
  scope.on('interact', (e) => {
    if (e.kind === 'node') at('gather_start', e.x, e.y);
    else if (e.kind === 'object') {
      const kind = scene.def?.objects?.find((o) => o.id === e.id)?.kind;
      if (kind === 'chest') {
        const opened = scene.session?.world?.chests.includes(objectKey(e.map, e.id));
        here(opened ? 'ui_nope' : 'chest_open');
      } else if (kind === 'waystone') here('waystone');
      else if (kind === 'altar' || kind === 'wind_shrine' || kind === 'obelisk') here('altar');
      else if (kind === 'campfire') here('campfire');
      else here('ui_tap');
    }
  });
  scope.on('talk', () => here('ui_talk'));
  scope.on('mapEnter', (e) => {
    const d = scene.def;
    if (d && d.id === e.map) sink.setMap({ id: d.id, biome: d.biome, kind: d.kind, flags: d.flags });
    if (e.first) here('map_new', { delay: 0.7 });
  });
  scope.on('warp', () => {
    here('warp_out');
    // The arrival plays through the map restart (the engine outlives the scene).
    here('warp_in', { delay: 0.34 });
  });
  scope.on('questChanged', (e) => {
    switch (e.reason) {
      case 'accepted':
        return here('quest_accept');
      case 'progress':
        return here('quest_tick');
      case 'ready':
        return here('quest_ready');
      case 'completed':
        lastQuestComplete = clock();
        return here('quest_complete');
      case 'abandoned':
        return here('quest_abandon');
      case 'tracked':
        return here('ui_tap');
    }
  });
  scope.on('uiOpen', (e) => {
    if (e.panel !== 'discovery') here('ui_open', { gain: e.panel === 'dialog' ? 0.8 : 1 });
  });
  scope.on('uiClose', (e) => {
    if (e.panel !== 'discovery') here('ui_close');
  });
  scope.on('discovery', (e) => {
    const s = discoverySound(e.kind);
    if (s) here(s);
    else if (clock() - lastQuestComplete > 2000) here('quest_complete');
  });
  scope.on('classChanged', (e) => {
    if (e.reason === 'wear') here(e.classId ? 'class_wear' : 'ui_close');
  });
  scope.on('barChanged', (e) => {
    const r = e.reason ?? 'assign';
    if (r === 'assign') here('slot_set');
    else if (r === 'clear') here('ui_tap');
    else if (r === 'learned' || r === 'classLearned') here('slot_set', { delay: 0.1 });
  });

  // ---------------------------------------------------------------- footsteps (synced to the walk frames)
  const step = (x: number, y: number): void => {
    foot ^= 1;
    here(stepSound(surfaceAt(scene.cm, x, y)), { pan: foot ? 0.06 : -0.06, rate: foot ? 1 : 0.96 });
  };
  const onUpdate = (): void => {
    const p = scene.player;
    if (!p) return;
    if (emitters.length) tickEmitters(p.x, p.y);
    if (!p.moving) {
      lastFrame = -1;
      stepDist = 0;
      lastX = p.x;
      lastY = p.y;
      return;
    }
    const anims = p.sprite?.anims;
    const key = anims?.currentAnim?.key ?? '';
    if (key.endsWith('_walk')) {
      const idx = anims?.currentFrame?.index ?? -1;
      if (idx !== lastFrame) {
        if (CONTACT_FRAMES.has(idx)) step(p.x, p.y);
        lastFrame = idx;
      }
    } else {
      const d = Math.hypot(p.x - lastX, p.y - lastY);
      if (Number.isFinite(d)) stepDist += d;
      if (stepDist >= STRIDE) {
        stepDist = 0;
        step(p.x, p.y);
      }
    }
    lastX = p.x;
    lastY = p.y;
  };
  scene.events.on('update', onUpdate);

  let disposed = false;
  return () => {
    if (disposed) return;
    disposed = true;
    scope.clear();
    scene.events.off('update', onUpdate);
  };
}
