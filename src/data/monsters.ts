import type { ElementId } from '../core/types';

export interface DropDef {
  item: string;
  chance: number;
  /** Only drop while the player lacks what the item grants. */
  once?: boolean;
}

export interface MonsterDef {
  id: string;
  name: string;
  level: number;
  hp: number;
  atk: number;
  def: number;
  element?: ElementId;
  exp: number;
  coins: [number, number];
  speed: number;
  aggressive: boolean;
  radius: number;
  attackRange: number;
  attackDelay: number;
  drops?: DropDef[];
  boss?: boolean;
  respawn: number;
}

export const MONSTERS: Record<string, MonsterDef> = {
  jellop: {
    id: 'jellop', name: 'Jellop', level: 1, hp: 40, atk: 4, def: 0, exp: 6, coins: [1, 3],
    speed: 40, aggressive: false, radius: 13, attackRange: 26, attackDelay: 1400, respawn: 8000,
  },
  puddlewisp: {
    id: 'puddlewisp', name: 'Puddlewisp', level: 2, hp: 55, atk: 6, def: 1, element: 'water', exp: 10,
    coins: [1, 4], speed: 50, aggressive: false, radius: 13, attackRange: 28, attackDelay: 1300, respawn: 9000,
  },
  mossling: {
    id: 'mossling', name: 'Mossling', level: 3, hp: 80, atk: 8, def: 2, element: 'earth', exp: 14,
    coins: [2, 5], speed: 45, aggressive: false, radius: 14, attackRange: 28, attackDelay: 1400, respawn: 10000,
  },
  gustling: {
    id: 'gustling', name: 'Gustling', level: 4, hp: 90, atk: 10, def: 2, element: 'wind', exp: 20,
    coins: [3, 6], speed: 80, aggressive: false, radius: 13, attackRange: 28, attackDelay: 1100, respawn: 10000,
    drops: [{ item: 'tome_quickstep', chance: 0.12, once: true }],
  },
  sparkbug: {
    id: 'sparkbug', name: 'Sparkbug', level: 4, hp: 85, atk: 11, def: 3, element: 'lightning', exp: 20,
    coins: [3, 6], speed: 60, aggressive: true, radius: 12, attackRange: 26, attackDelay: 1200, respawn: 10000,
  },
  emberkit: {
    id: 'emberkit', name: 'Emberkit', level: 5, hp: 120, atk: 13, def: 3, element: 'fire', exp: 26,
    coins: [4, 9], speed: 70, aggressive: true, radius: 14, attackRange: 28, attackDelay: 1200, respawn: 11000,
  },
  gloomcap: {
    id: 'gloomcap', name: 'Gloomcap', level: 6, hp: 150, atk: 15, def: 4, element: 'shadow', exp: 34,
    coins: [5, 10], speed: 35, aggressive: true, radius: 14, attackRange: 28, attackDelay: 1500, respawn: 12000,
  },
  thunderhoof: {
    id: 'thunderhoof', name: 'Thunderhoof', level: 10, hp: 1800, atk: 26, def: 8, element: 'lightning', exp: 420,
    coins: [80, 120], speed: 62, aggressive: true, radius: 34, attackRange: 48, attackDelay: 1600, respawn: 180000,
    boss: true,
    drops: [
      { item: 'storm_shard', chance: 1, once: true },
      { item: 'tome_static_field', chance: 0.6, once: true },
    ],
  },
};
