// What the UI says about classes and weapon locks in v4 (docs/SPEC-v4.md §2.2, §3.4, §12): the fixed rewards of the
// Class Levels (the class tree is gone), the five class skills with the level that opens each, the one line a
// "Become" card shows when the game will also swap the weapon, and the one lock line of a skill that needs another
// weapon ("Needs a sword — Equip"). Pure functions over the registry and plain player data, so node tests cover them.
import { CLASS, classRarity, isKitClass } from '../core/classes';
import type { Registry } from '../core/registry';
import { WEAPON_NEED_WORD, weaponLockLine, weaponNeeded } from '../core/requirements';
import type { ClassDef, Rarity, WeaponType } from '../core/types';
import { WEAPONS } from '../data/weapons';
import type { GameController } from './controller';
import { FRIENDLY, weaponName } from './words';

/** One fixed reward of a Class Level, in one short line ("New skill: Flame Wheel"). */
export interface ClassReward {
  level: number;
  text: string;
}

/** Every reward a class gives after Class Level 1, in level order. */
export function classRewards(reg: Registry, cls: ClassDef): ClassReward[] {
  const out: ClassReward[] = [];
  if (isKitClass(cls)) {
    cls.kit.forEach((id, i) => {
      const at = CLASS.kitAt[i];
      if (at > 1) out.push({ level: at, text: `New skill: ${reg.skill(id)?.name ?? 'a class skill'}` });
    });
  }
  const keep = cls.imprint ? reg.passive(cls.imprint) : undefined;
  if (keep) out.push({ level: CLASS.imprintAt, text: `${FRIENDLY.imprint}: ${keep.name}` });
  if (cls.mechanicUpgrade) out.push({ level: CLASS.mechanicUpgradeAt, text: cls.mechanicUpgrade.line });
  out.push({ level: CLASS.maxLevel, text: `${FRIENDLY.mastered}: a gold border and its full bonus` });
  return out.sort((a, b) => a.level - b.level);
}

/** The next reward as ONE line ("Class Level 4 — New skill: Flame Wheel"), or null once mastered. */
export function nextRewardLine(reg: Registry, cls: ClassDef, level: number): string | null {
  const next = classRewards(reg, cls).find((r) => r.level > level);
  return next ? `${FRIENDLY.classRank} ${next.level} — ${next.text}` : null;
}

/** One of the five class skills and the Class Level that opens it. */
export interface KitRow {
  id: string;
  name: string;
  at: number;
  open: boolean;
}

/** The five class skills in unlock order ([] for a class without its own skills). */
export function kitRows(reg: Registry, cls: ClassDef, level: number): KitRow[] {
  if (!isKitClass(cls)) return [];
  return cls.kit.map((id, i) => ({ id, name: reg.skill(id)?.name ?? '', at: CLASS.kitAt[i], open: level >= CLASS.kitAt[i] }));
}

/** The rarity every class shows (colour + word + pips), wherever it appears. */
export function rarityOf(reg: Registry, classId: string): Rarity {
  const cls = reg.classDef(classId);
  return cls ? classRarity(cls) : 'common';
}

export interface Wielder {
  weapon: WeaponType;
  ownedWeapons: readonly WeaponType[];
}

/** Bare Hands are always owned: they are "nothing equipped". */
export function ownsWeapon(p: Wielder, w: WeaponType): boolean {
  return w === 'fists' || p.ownedWeapons.includes(w);
}

/** "your Rogue Dagger" / "your hands". */
function yours(w: WeaponType): string {
  return w === 'fists' ? 'your hands' : `your ${weaponName(WEAPONS[w].name)}`;
}

/**
 * The one short line a Become card adds when becoming the class changes the weapon (the game swaps it in the same
 * tap): "Also equips your Rogue Dagger." / "Also puts your weapon away." — or, without that weapon, where to get one.
 * Null when nothing changes.
 */
export function becomeSwapLine(cls: Pick<ClassDef, 'weapon'>, p: Wielder): { line: string; missing: boolean } | null {
  const w = cls.weapon;
  if (!w || w === 'any' || w === p.weapon) return null;
  if (w === 'fists') return { line: 'Also puts your weapon away.', missing: false };
  if (!ownsWeapon(p, w)) return { line: `Needs ${WEAPON_NEED_WORD[w]}. Brann sells one in Hearthvale.`, missing: true };
  return { line: `Also equips ${yours(w)}.`, missing: false };
}

/** A skill that needs another weapon: what to equip, the line, and whether one tap can do it. */
export interface WeaponLock {
  need: WeaponType;
  /** "Needs a sword" (the core's wording). */
  line: string;
  /** The player owns that weapon: "Equip" swaps to it. */
  owned: boolean;
}

/** The weapon lock of a skill for this player, or null when the held weapon can use it. */
export function weaponLock(reg: Registry, skillId: string, p: Wielder): WeaponLock | null {
  const s = reg.skill(skillId);
  if (!s) return null;
  const need = weaponNeeded(s, p.weapon);
  const line = weaponLockLine(s, p.weapon);
  if (!need || !line) return null;
  // A skill two weapons can use: prefer one the player owns.
  const pick = s.weapons?.find((w) => ownsWeapon(p, w)) ?? need;
  return { need: pick, line: pick === need ? line : (weaponLockLine({ weapons: [pick] }, p.weapon) ?? line), owned: ownsWeapon(p, pick) };
}

/**
 * The weapon lock as the game reports it (GameController.weaponLock, v4), else worked out here from the registry —
 * so a controller without the method still shows the line.
 */
export function lockOf(ctrl: GameController, skillId: string): WeaponLock | null {
  try {
    if (ctrl.weaponLock) {
      const v = ctrl.weaponLock(skillId);
      return v ? { need: v.weapon, line: v.line, owned: v.owned } : null;
    }
    return weaponLock(ctrl.reg, skillId, ctrl.session.player);
  } catch {
    return null;
  }
}

/** The lock line's one action: equips the weapon the skill needs. */
export function equipForSkill(ctrl: GameController, skillId: string, need: WeaponType): { ok: boolean; message?: string } {
  return ctrl.equipFor ? ctrl.equipFor(skillId) : ctrl.equipWeapon(need);
}
