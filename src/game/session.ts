import { SkillBook, type SkillBookState } from '../core/skillbook';
import type { Registry } from '../core/registry';
import type { BuffStat, StatBonus, WeaponType } from '../core/types';
import { WEAPONS } from '../data/weapons';

export const HOTBAR_SIZE = 6;
const SAVE_KEY = 'omnipath.save.v1';

export interface PlayerSave {
  name: string;
  weapon: WeaponType;
  ownedWeapons: WeaponType[];
  level: number;
  exp: number;
  hp: number;
  sp: number;
  coins: number;
  x: number;
  y: number;
  hotbar: (string | null)[];
  bag: { ore: number; fish: number };
  items: string[];
  createdAt: number;
}

export interface SaveData {
  v: 1;
  player: PlayerSave;
  skills: SkillBookState;
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

export function computeStats(p: PlayerSave, bonus: StatBonus, buffs: Buff[]): Stats {
  const w = WEAPONS[p.weapon];
  const lv = p.level;
  const buff = (stat: BuffStat) => buffs.filter((b) => b.stat === stat).reduce((s, b) => s + b.amount, 0);
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
    def: Math.round(2 + lv * 0.8 + buff('def')),
    crit: w.crit + (bonus.crit ?? 0) + buff('crit'),
    speed: 150 * pct(bonus.speed) * pct(buff('speed')),
    cdr: bonus.cdr ?? 0,
    regen: buff('regen'),
  };
}

export class Session {
  book: SkillBook;

  constructor(
    readonly reg: Registry,
    public player: PlayerSave,
    skills?: SkillBookState,
  ) {
    this.book = new SkillBook(reg, skills);
    this.book.level = player.level;
  }

  static create(reg: Registry, name: string, weapon: WeaponType, spawn: { x: number; y: number }): Session {
    const player: PlayerSave = {
      name: name.trim().slice(0, 16) || 'Wanderer',
      weapon,
      ownedWeapons: [weapon],
      level: 1,
      exp: 0,
      hp: 110,
      sp: 40,
      coins: 0,
      x: spawn.x,
      y: spawn.y,
      hotbar: Array(HOTBAR_SIZE).fill(null),
      bag: { ore: 0, fish: 0 },
      items: [],
      createdAt: Date.now(),
    };
    const s = new Session(reg, player);
    s.book.learn(WEAPONS[weapon].basic, 'starting weapon');
    return s;
  }

  static load(reg: Registry): Session | null {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (!raw) return null;
      const data = JSON.parse(raw) as SaveData;
      if (data.v !== 1) return null;
      const p = data.player;
      p.hotbar = [...p.hotbar, ...Array(HOTBAR_SIZE).fill(null)].slice(0, HOTBAR_SIZE);
      p.bag ??= { ore: 0, fish: 0 };
      p.items ??= [];
      return new Session(reg, p, data.skills);
    } catch {
      return null;
    }
  }

  static hasSave(): boolean {
    try {
      return !!localStorage.getItem(SAVE_KEY);
    } catch {
      return false;
    }
  }

  /** Set when the save is being wiped so late autosaves cannot resurrect it. */
  static locked = false;

  static clear(): void {
    Session.locked = true;
    try {
      localStorage.removeItem(SAVE_KEY);
    } catch {
      /* storage unavailable */
    }
  }

  save(): void {
    if (Session.locked) return;
    const data: SaveData = { v: 1, player: this.player, skills: this.book.serialize() };
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify(data));
    } catch {
      /* storage full or unavailable — keep playing */
    }
  }

  /** Puts a newly learned skill on the first empty hotbar slot. */
  autoSlot(id: string): void {
    if (this.player.hotbar.includes(id)) return;
    const basic = WEAPONS[this.player.weapon].basic;
    if (id === basic || Object.values(WEAPONS).some((w) => w.basic === id)) return;
    const i = this.player.hotbar.indexOf(null);
    if (i >= 0) this.player.hotbar[i] = id;
  }
}
