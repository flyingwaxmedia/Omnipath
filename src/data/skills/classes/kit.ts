import { GRIP_TAG, type SkillDef, type WeaponType } from '../../../core/types';

/** What a class skill row states; the rest is the same for every class skill. */
export type KitRow = Pick<SkillDef, 'id' | 'name' | 'desc' | 'icon' | 'power' | 'spCost' | 'cooldown' | 'shape' | 'delivery'> &
  Partial<Pick<SkillDef, 'tags' | 'element' | 'status' | 'extra' | 'critBonus' | 'castMs' | 'afterCastMs' | 'riders' | 'hpCost'>>;

/**
 * The 5 skills of a rebuilt class (SPEC-v4 §3.6). Every one is bound to the class weapon (its grip tag is added
 * here), belongs to the class (`classOf`: it only ever sits in that class's slots, never in a fusion) and takes the
 * class's element. Rod class skills are `arcane` (they use MATK). Tier 2, 5 ranks, like the old signature skills.
 */
export function classKit(cls: string, weapon: WeaponType, element: SkillDef['element'], rows: readonly KitRow[]): SkillDef[] {
  const grip = [GRIP_TAG[weapon], ...(weapon === 'staff' ? ['arcane'] : [])];
  return rows.map((row) => ({
    tier: 2,
    maxRank: 5,
    weapons: [weapon],
    classOf: cls,
    ...(element ? { element } : {}),
    ...row,
    tags: [...grip, ...(row.tags ?? [])],
  }));
}
