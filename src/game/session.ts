// Session & save v3 (docs/CLIENT-v2.md §2, docs/SPEC-v4.md §13): the player record, the bag, the persistent world
// state and the SkillBook, plus localStorage persistence. Saves are written under `omnipath.save.v3`; a v2 save (or a
// v1 save) is read and migrated once, and the older key is never removed before a v3 write has succeeded (it is in
// fact kept: only "New game" clears saves).
import { clearLostSlots, migrateBookState } from '../core/save';
import { SkillBook, type Cost } from '../core/skillbook';
import { emptyState, type SkillBookState } from '../core/state';
import type { Registry } from '../core/registry';
import type { BuffStat, StatBonus, WeaponType } from '../core/types';
import { WEAPON_TYPES } from '../core/types';
import { MechanicRuntime } from './systems/mechanic';
import { ownedWeapons } from './systems/weapons';
import { NPCS } from '../data/npcs';
import { WEAPONS } from '../data/weapons';
import { mapById } from '../data/world';
import { gameBus } from './events';
import { becomeRefill, classSlotsFor, noteWorn, padBar, refillClassSlots, slotLearned } from './loadout';

/** Skill-bar slots: 1-5 are class slots while a class is worn, 6-8 are always the player's own (SPEC-v2 §5.1). */
export const HOTBAR_SIZE = 8;
const NPC_NAMES = new Map(NPCS.map((n) => [n.id, n.name]));
export const SAVE_KEY = 'omnipath.save.v3';
export const SAVE_KEY_V2 = 'omnipath.save.v2';
export const SAVE_KEY_V1 = 'omnipath.save.v1';
/** Where new characters (and migrated v1 saves) start. */
export const START_MAP = 'vale.hearthvale';

export interface PlayerSave {
  name: string;
  weapon: WeaponType;
  ownedWeapons: WeaponType[];
  level: number;
  exp: number;
  hp: number;
  sp: number;
  coins: number;
  /** HOTBAR_SIZE (8) slots: 0-4 class slots while a class is worn, 5-7 the player's own. Older 6-slot saves are padded. */
  hotbar: (string | null)[];
  /** AUTO battle switch (hunt nearest monster + cast every equipped skill when in reach). */
  autoOn: boolean;
  /** Item id -> count (materials, consumables, relics). */
  bag: Record<string, number>;
  createdAt: number;
  /** Total unpaused play time in ms: the persistent game clock behind `book.now` (sparks, learn stamps). */
  playMs: number;
}

export interface WorldState {
  /** Where the player stands. x/y < 0 = use the map's default spawn. */
  mapId: string;
  x: number;
  y: number;
  /** Map ids. */
  visited: string[];
  /** 'map#portal' keys the player has seen (world map edges). */
  seenPortals: string[];
  /** Hidden portals revealed, 'map#portal'. */
  revealed: string[];
  /** Attuned waystones, 'map#objectId'. */
  waystones: string[];
  /** Waystone key used for respawn. */
  savePoint: string | null;
  /** 'map#nodeId' -> depletedUntil (epoch ms). */
  nodes: Record<string, number>;
  /** Opened chests, 'map#objectId'. */
  chests: string[];
  /** Warden monster id -> defeatedAt (epoch ms). */
  wardens: Record<string, number>;
  /** mapId -> base64 bitset of explored 4x4-tile cells. */
  fog: Record<string, string>;
}

export interface SaveData {
  v: 3;
  player: PlayerSave;
  book: SkillBookState;
  world: WorldState;
}

export interface Buff {
  stat: BuffStat;
  amount: number;
  until: number;
  source: string;
}

export interface Stats {
  maxHp: number;
  maxSp: number;
  atk: number;
  matk: number;
  def: number;
  crit: number;
  speed: number;
  cdr: number;
  regen: number;
}

export function expToNext(level: number): number {
  return Math.floor(24 * Math.pow(level, 1.6));
}

/**
 * Player stats from level, weapon, the book's activeBonus() (class bonus + passive stat bonuses, already folded)
 * and timed buffs. `defPct` is passives.statPct(totals, 'def') (DEF has no StatBonus field).
 */
export function computeStats(p: PlayerSave, bonus: StatBonus, buffs: readonly Buff[], defPct = 0): Stats {
  const w = WEAPONS[p.weapon];
  const lv = p.level;
  const buff = (stat: BuffStat) => buffs.reduce((s, b) => (b.stat === stat ? s + b.amount : s), 0);
  const pct = (n?: number) => 1 + (n ?? 0) / 100;
  const maxHp = Math.round((110 + 20 * (lv - 1)) * pct(bonus.hp));
  const maxSp = Math.round((40 + 7 * (lv - 1)) * pct(bonus.sp));
  const atk = Math.round((10 + 3 * (lv - 1) + w.atk) * pct(bonus.atk) * pct(buff('atk')));
  const matk = Math.round((8 + 3 * (lv - 1) + w.matk) * pct(bonus.matk) * pct(buff('matk')));
  return {
    maxHp,
    maxSp,
    atk,
    matk,
    def: Math.round((2 + lv * 0.8) * pct(defPct) + buff('def')),
    crit: w.crit + (bonus.crit ?? 0) + buff('crit'),
    speed: 150 * pct(bonus.speed) * pct(buff('speed')),
    cdr: bonus.cdr ?? 0,
    regen: buff('regen'),
  };
}

/** A fresh, random roll seed for the book (client-side randomness is fine; core stays deterministic). */
export function randomSeed(): number {
  try {
    const a = new Uint32Array(1);
    crypto.getRandomValues(a);
    return a[0] || 1;
  } catch {
    return Math.floor(Math.random() * 0xffffffff) || 1;
  }
}

export function emptyWorld(mapId = START_MAP): WorldState {
  return {
    mapId,
    x: -1,
    y: -1,
    visited: [],
    seenPortals: [],
    revealed: [],
    waystones: [],
    savePoint: null,
    nodes: {},
    chests: [],
    wardens: {},
    fog: {},
  };
}

// ------------------------------------------------------------------ defensive readers

type Raw = Record<string, unknown>;
const isRec = (v: unknown): v is Raw => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d: number) => (typeof v === 'number' && Number.isFinite(v) ? v : d);
const str = (v: unknown, d: string) => (typeof v === 'string' ? v : d);
const strs = (v: unknown): string[] => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string'))] : []);
const nums = (v: unknown): Record<string, number> => {
  const out: Record<string, number> = {};
  if (isRec(v)) for (const [k, x] of Object.entries(v)) if (k !== '__proto__' && typeof x === 'number' && Number.isFinite(x)) out[k] = x;
  return out;
};
const weapon = (v: unknown): WeaponType => (WEAPON_TYPES.includes(v as WeaponType) ? (v as WeaponType) : 'sword');
/** Slots in a saved bar (v2 saves had 6). */
const barLength = (p: unknown): number => (isRec(p) && Array.isArray(p.hotbar) ? p.hotbar.length : 0);

function readPlayer(raw: unknown): PlayerSave {
  const p = isRec(raw) ? raw : {};
  const w = weapon(p.weapon);
  return {
    name: str(p.name, 'Wanderer').slice(0, 16) || 'Wanderer',
    weapon: w,
    // SPEC-v4 §13 rule 1: Bare Hands is always owned; the held weapon is unchanged.
    ownedWeapons: ownedWeapons(Array.isArray(p.ownedWeapons) ? p.ownedWeapons : [], w),
    level: Math.max(1, Math.floor(num(p.level, 1))),
    exp: Math.max(0, num(p.exp, 0)),
    hp: Math.max(1, num(p.hp, 110)),
    sp: Math.max(0, num(p.sp, 40)),
    coins: Math.max(0, Math.floor(num(p.coins, 0))),
    hotbar: padBar(p.hotbar, HOTBAR_SIZE),
    autoOn: typeof p.autoOn === 'boolean' ? p.autoOn : false,
    bag: nums(p.bag),
    createdAt: num(p.createdAt, Date.now()),
    playMs: Math.max(0, num(p.playMs, 0)),
  };
}

function readWorld(raw: unknown): WorldState {
  const w = isRec(raw) ? raw : {};
  const fog: Record<string, string> = {};
  if (isRec(w.fog)) for (const [k, v] of Object.entries(w.fog)) if (typeof v === 'string') fog[k] = v;
  return {
    mapId: str(w.mapId, START_MAP),
    x: num(w.x, -1),
    y: num(w.y, -1),
    visited: strs(w.visited),
    seenPortals: strs(w.seenPortals),
    revealed: strs(w.revealed),
    waystones: strs(w.waystones),
    savePoint: typeof w.savePoint === 'string' ? w.savePoint : null,
    nodes: nums(w.nodes),
    chests: strs(w.chests),
    wardens: nums(w.wardens),
    fog,
  };
}

/** v1 save -> v3 (player at the Hearthvale spawn, bag {ore, fish} kept, book migrated v1 -> v2 -> v3 by core). */
function migrateV1(raw: Raw, reg: Registry): SaveData {
  const p = isRec(raw.player) ? raw.player : {};
  const player = readPlayer({ ...p, bag: isRec(p.bag) ? p.bag : {} });
  return { v: 3, player, book: migrateBookState(raw.skills, reg), world: emptyWorld(START_MAP) };
}

/** The saved record under `key` when it parses and carries version `v`; null otherwise (missing, corrupt, other). */
function readSave(key: string, v: number): Raw | null {
  const raw = storageGet(key);
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as unknown;
    return isRec(data) && data.v === v ? data : null;
  } catch {
    return null;
  }
}

function storageGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------ session

export class Session {
  readonly book: SkillBook;
  /** Runtime only: auto-travel target (navigateTo), survives map restarts. */
  nav: { target: string } | null = null;
  /** Runtime only: wardens / elites defeated this run keyed by spawn slot (elites respawn in 180 s). */
  readonly eliteDeaths = new Map<string, number>();
  /** Runtime only: the welcome-back line was shown this run. */
  greeted = false;
  /** Runtime only: where the next Sudden insight happens (the struck foe; Combat sets it around trySpark). */
  sparkAt: { x: number; y: number } | null = null;
  /** Runtime only: the worn class's mechanic state (never saved; src/game/systems/mechanic.ts). */
  readonly mechanic: MechanicRuntime;
  /** Runtime only: wall-clock time (performance.now) the next weapon swap is allowed (SPEC-v4 §2.2). */
  weaponSwapAt = 0;
  private persisted = false;
  /** A quest re-check after a bag change is queued. */
  private questCheck = false;

  constructor(
    readonly reg: Registry,
    public player: PlayerSave,
    public world: WorldState,
    book?: SkillBookState,
  ) {
    this.book = new SkillBook(reg, book);
    this.mechanic = new MechanicRuntime(this);
    this.book.level = player.level;
    this.book.now = () => this.player.playMs;
    this.book.inv = {
      count: (id) => this.count(id),
      coins: () => this.player.coins,
      spend: (cost) => this.spend(cost),
    };
    // Quest texts name NPCs and maps ('Speak with Fisher Pell', 'Visit Mirror Lake').
    this.book.names = { npc: (id) => NPC_NAMES.get(id), map: (id) => mapById(id)?.name };
    // The book lives as long as the session: forward the events the game bus mirrors (docs/INTEGRATION-v3.md §4).
    const ev = this.book.events;
    ev.on('learned', ({ skill, source }) => {
      // Onto the bar first (class slots / your slots), so 'skillLearned' listeners already see it there.
      slotLearned(this, skill.id);
      gameBus.emit('skillLearned', { skillId: skill.id, skill, element: skill.element, source });
    });
    // The first class (or one found while wearing none) is worn at once: it fills its class slots.
    ev.on('classDiscovered', ({ cls, worn }) => {
      if (!worn) return;
      becomeRefill(this);
      noteWorn(this.book);
      gameBus.emit('classChanged', { classId: cls.id, prev: null, reason: 'discovered' });
    });
    ev.on('spark', ({ from, to }) => gameBus.emit('spark', { from, to, ...(this.sparkAt ?? {}) }));
    ev.on('questAccepted', ({ quest }) => gameBus.emit('questChanged', { questId: quest.id, reason: 'accepted' }));
    ev.on('questProgress', ({ quest }) => gameBus.emit('questChanged', { questId: quest.id, reason: 'progress' }));
    ev.on('questReady', ({ quest }) => gameBus.emit('questChanged', { questId: quest.id, reason: 'ready' }));
    ev.on('questCompleted', ({ quest }) => gameBus.emit('questChanged', { questId: quest.id, reason: 'completed' }));
  }

  static create(reg: Registry, name: string, weaponType: WeaponType, seed = randomSeed()): Session {
    const hp = 110;
    const player: PlayerSave = {
      name: name.trim().slice(0, 16) || 'Wanderer',
      weapon: weaponType,
      ownedWeapons: ownedWeapons([weaponType], weaponType),
      level: 1,
      exp: 0,
      hp,
      sp: 40,
      coins: 0,
      hotbar: Array<null>(HOTBAR_SIZE).fill(null),
      autoOn: false,
      bag: {},
      createdAt: Date.now(),
      playMs: 0,
    };
    const s = new Session(reg, player, emptyWorld(START_MAP), emptyState(seed));
    s.ensureBasic();
    return s;
  }

  /**
   * Loads the save (SPEC-v4 §13): the v3 save; else the v2 save, migrated (core migrateBookState takes any book
   * version to v3) and written as v3; else a v1 save. An older key is left untouched.
   */
  static load(reg: Registry): Session | null {
    try {
      const v3 = readSave(SAVE_KEY, 3);
      if (v3) return Session.fromSave(reg, v3, false);
      const v2 = readSave(SAVE_KEY_V2, 2);
      if (v2) {
        const s = Session.fromSave(reg, v2, true);
        s.save();
        return s;
      }
      const v1 = readSave(SAVE_KEY_V1, 1);
      if (v1) {
        const m = migrateV1(v1, reg);
        const s = new Session(reg, m.player, m.world, m.book);
        s.ensureBasic();
        s.repairBar(barLength(isRec(v1.player) ? v1.player : {}), true);
        if (!s.book.flag('intro')) s.book.incFlag('intro');
        s.save();
        return s;
      }
    } catch {
      /* corrupt save: start fresh */
    }
    return null;
  }

  /**
   * A session from a parsed v2 / v3 save record. The book is migrated first (classes merged, class-only skills
   * shelved, echo skills folded …), then the bar drops every slot whose skill the book no longer knows
   * (clearLostSlots, rule 9) BEFORE the class slots are rebuilt and your slots refilled. `migrated`: the save is
   * older than v3, so the class slots are rebuilt from the worn class's kit rather than merely topped up.
   */
  static fromSave(reg: Registry, data: Record<string, unknown>, migrated: boolean): Session {
    // core's migration keeps an explicit "No class" (worn: null), so a reload never re-wears a class.
    const book = migrateBookState(data.book, reg);
    const player = readPlayer(data.player);
    player.hotbar = clearLostSlots(book, player.hotbar);
    const s = new Session(reg, player, readWorld(data.world), book);
    s.ensureBasic();
    s.repairBar(barLength(data.player), migrated);
    return s;
  }

  static hasSave(): boolean {
    return !!storageGet(SAVE_KEY) || !!storageGet(SAVE_KEY_V2) || !!storageGet(SAVE_KEY_V1);
  }

  /** Set when the save is being wiped so late autosaves cannot resurrect it. */
  static locked = false;

  static clear(): void {
    Session.locked = true;
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(SAVE_KEY_V2);
      localStorage.removeItem(SAVE_KEY_V1);
    } catch {
      /* storage unavailable */
    }
  }

  save(): void {
    if (Session.locked) return;
    const now = Date.now();
    for (const [k, until] of Object.entries(this.world.nodes)) if (until <= now) delete this.world.nodes[k];
    const data: SaveData = { v: 3, player: this.player, book: this.book.serialize(), world: this.world };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or unavailable — keep playing */
      return;
    }
    if (!this.persisted) {
      this.persisted = true;
      try {
        void navigator.storage?.persist?.().catch(() => undefined);
      } catch {
        /* not supported */
      }
    }
  }

  // ---------------------------------------------------------------- bag

  count(id: string): number {
    return this.player.bag[id] ?? 0;
  }

  addItem(id: string, n = 1): number {
    const total = this.count(id) + n;
    if (total > 0) this.player.bag[id] = total;
    else delete this.player.bag[id];
    if (n !== 0) this.bagChanged();
    return Math.max(0, total);
  }

  /** Removes `n` of an item if held; false (nothing changed) otherwise. */
  takeItem(id: string, n = 1): boolean {
    if (this.count(id) < n) return false;
    this.addItem(id, -n);
    return true;
  }

  /** Pays a cost (coins + bag items) if the bag covers all of it. */
  spend(cost: Cost): boolean {
    const coins = cost.coins ?? 0;
    const items = Object.entries(cost.items ?? {});
    if (this.player.coins < coins) return false;
    if (items.some(([id, n]) => this.count(id) < n)) return false;
    this.player.coins -= coins;
    for (const [id, n] of items) this.addItem(id, -n);
    return true;
  }

  // ---------------------------------------------------------------- misc

  setLevel(level: number): void {
    this.player.level = Math.max(1, Math.floor(level));
    this.book.level = this.player.level;
  }

  /**
   * Puts a newly learned skill on the bar (src/game/loadout.ts): the worn class takes it into a class slot when it
   * would pick it ('classLearned'), else it drops into the first empty slot of the player's own ('learned').
   * Weapon basics and monster techniques never go on the bar.
   */
  autoSlot(id: string): void {
    slotLearned(this, id);
  }

  /**
   * After loading: drops skills the book no longer knows, then refreshes the worn class's slots. A bar saved with
   * fewer slots (v2: 6) had no class slots at all: the class takes its picks from anywhere on it (no class skill is
   * left in "your" slots beside an empty class slot), and the skills it pushes out of slots 1-5 move into your
   * empty slots. `migrated` (a save older than v3, SPEC-v4 §13 rule 9): the class slots are rebuilt from the worn
   * class's kit, what they held moves to your empty slots, and your slots still empty are refilled by the
   * auto-equip rule. Weapon-bound skills for another weapon stay on the bar (the bar greys them).
   */
  repairBar(savedLength: number, migrated = false): void {
    const bar = this.player.hotbar;
    const gone: number[] = [];
    bar.forEach((id, i) => {
      if (id && !this.book.has(id)) {
        bar[i] = null;
        gone.push(i);
      }
    });
    const convert = savedLength > 0 && savedLength < HOTBAR_SIZE;
    const worn = this.book.state.worn;
    if (convert && worn) {
      const n = classSlotsFor(worn, bar.length);
      const best = new Set(this.book.classSkills(worn, bar.length).slice(0, n));
      for (let i = n; i < bar.length; i++) {
        if (bar[i] && best.has(bar[i]!)) {
          bar[i] = null;
          gone.push(i);
        }
      }
    }
    if (gone.length) gameBus.emit('barChanged', { slots: [...new Set(gone)], reason: 'load' });
    if (migrated) refillClassSlots(this, 'load', { rehome: true, backfill: true });
    else refillClassSlots(this, 'load', { stable: true, rehome: convert });
    noteWorn(this.book);
  }

  /** Bag changed: re-check quests' live objectives (deliveries) once the current change is done (coalesced). */
  private bagChanged(): void {
    if (this.questCheck) return;
    this.questCheck = true;
    queueMicrotask(() => {
      this.questCheck = false;
      this.book.refreshQuests();
    });
  }

  /**
   * The held weapon's basic attack is always known (Bare Hands' is learned the first time the hands are bared:
   * MapScene.equipWeapon). A basic the content does not have yet is skipped.
   */
  ensureBasic(): void {
    const basic = WEAPONS[this.player.weapon].basic;
    if (this.reg.skill(basic) && !this.book.has(basic)) this.book.learn(basic, 'starting weapon');
  }
}
