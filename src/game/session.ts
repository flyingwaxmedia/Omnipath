// Session & save v2 (docs/CLIENT-v2.md §2): the player record, the bag, the persistent world state and the
// SkillBook, plus localStorage persistence with a one-time v1 -> v2 migration.
import { migrateBookState } from '../core/save';
import { SkillBook, type Cost } from '../core/skillbook';
import { emptyState, type SkillBookState } from '../core/state';
import type { Registry } from '../core/registry';
import type { BuffStat, StatBonus, WeaponType } from '../core/types';
import { WEAPON_TYPES } from '../core/types';
import { WEAPONS } from '../data/weapons';

export const HOTBAR_SIZE = 6;
export const SAVE_KEY = 'omnipath.save.v2';
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
  /** 6 slots. */
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
  v: 2;
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

function readPlayer(raw: unknown): PlayerSave {
  const p = isRec(raw) ? raw : {};
  const w = weapon(p.weapon);
  const owned = (Array.isArray(p.ownedWeapons) ? p.ownedWeapons : []).filter((x): x is WeaponType =>
    WEAPON_TYPES.includes(x as WeaponType),
  );
  if (!owned.includes(w)) owned.push(w);
  const hotbar = (Array.isArray(p.hotbar) ? p.hotbar : []).map((x) => (typeof x === 'string' ? x : null));
  return {
    name: str(p.name, 'Wanderer').slice(0, 16) || 'Wanderer',
    weapon: w,
    ownedWeapons: [...new Set(owned)],
    level: Math.max(1, Math.floor(num(p.level, 1))),
    exp: Math.max(0, num(p.exp, 0)),
    hp: Math.max(1, num(p.hp, 110)),
    sp: Math.max(0, num(p.sp, 40)),
    coins: Math.max(0, Math.floor(num(p.coins, 0))),
    hotbar: [...hotbar, ...Array<null>(HOTBAR_SIZE).fill(null)].slice(0, HOTBAR_SIZE),
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

/** v1 save -> v2 (player at the Hearthvale spawn, bag {ore, fish} kept, book migrated). */
function migrateV1(raw: Raw, reg: Registry): SaveData {
  const p = isRec(raw.player) ? raw.player : {};
  const player = readPlayer({ ...p, bag: isRec(p.bag) ? p.bag : {} });
  return { v: 2, player, book: migrateBookState(raw.skills, reg), world: emptyWorld(START_MAP) };
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
  private persisted = false;

  constructor(
    readonly reg: Registry,
    public player: PlayerSave,
    public world: WorldState,
    book?: SkillBookState,
  ) {
    this.book = new SkillBook(reg, book);
    this.book.level = player.level;
    this.book.now = () => this.player.playMs;
    this.book.inv = {
      count: (id) => this.count(id),
      coins: () => this.player.coins,
      spend: (cost) => this.spend(cost),
    };
  }

  static create(reg: Registry, name: string, weaponType: WeaponType, seed = randomSeed()): Session {
    const hp = 110;
    const player: PlayerSave = {
      name: name.trim().slice(0, 16) || 'Wanderer',
      weapon: weaponType,
      ownedWeapons: [weaponType],
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
    s.book.learn(WEAPONS[weaponType].basic, 'starting weapon');
    return s;
  }

  /** Loads the v2 save, or migrates a v1 save once (writing v2, leaving v1 untouched). */
  static load(reg: Registry): Session | null {
    try {
      const raw2 = storageGet(SAVE_KEY);
      if (raw2) {
        const data = JSON.parse(raw2) as unknown;
        if (isRec(data) && data.v === 2) {
          const s = new Session(reg, readPlayer(data.player), readWorld(data.world), migrateBookState(data.book, reg));
          s.ensureBasic();
          return s;
        }
      }
      const raw1 = storageGet(SAVE_KEY_V1);
      if (raw1) {
        const data = JSON.parse(raw1) as unknown;
        if (isRec(data) && data.v === 1) {
          const m = migrateV1(data, reg);
          const s = new Session(reg, m.player, m.world, m.book);
          s.ensureBasic();
          if (!s.book.flag('intro')) s.book.incFlag('intro');
          s.save();
          return s;
        }
      }
    } catch {
      /* corrupt save: start fresh */
    }
    return null;
  }

  static hasSave(): boolean {
    return !!storageGet(SAVE_KEY) || !!storageGet(SAVE_KEY_V1);
  }

  /** Set when the save is being wiped so late autosaves cannot resurrect it. */
  static locked = false;

  static clear(): void {
    Session.locked = true;
    try {
      localStorage.removeItem(SAVE_KEY);
      localStorage.removeItem(SAVE_KEY_V1);
    } catch {
      /* storage unavailable */
    }
  }

  save(): void {
    if (Session.locked) return;
    const now = Date.now();
    for (const [k, until] of Object.entries(this.world.nodes)) if (until <= now) delete this.world.nodes[k];
    const data: SaveData = { v: 2, player: this.player, book: this.book.serialize(), world: this.world };
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

  /** Puts a newly learned skill on the first empty hotbar slot (never basics or passive-ish buffs twice). */
  autoSlot(id: string): void {
    if (this.player.hotbar.includes(id)) return;
    if (Object.values(WEAPONS).some((w) => w.basic === id)) return;
    const skill = this.reg.skill(id);
    if (!skill || skill.tags.includes('monster')) return;
    const i = this.player.hotbar.indexOf(null);
    if (i >= 0) this.player.hotbar[i] = id;
  }

  private ensureBasic(): void {
    const basic = WEAPONS[this.player.weapon].basic;
    if (!this.book.has(basic)) this.book.learn(basic, 'starting weapon');
  }
}
