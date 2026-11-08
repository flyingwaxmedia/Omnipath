// TODO(v2 content): see docs/SPEC-v2.md §8.
export type NpcRole = 'smith' | 'priestess' | 'hermit' | 'fisher' | 'trainer' | 'waykeeper' | 'loremaster' | 'villager';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  /** Emoji shown in dialogs. */
  portrait: string;
  /** Texture key (npc_*). */
  texture: string;
  role: NpcRole;
  /** TrainerDef id when this NPC teaches lessons. */
  trainer?: string;
  /** Flavour lines; one is shown at random (or in order for loremasters). */
  lines: string[];
}

export const NPCS: NpcDef[] = [];
