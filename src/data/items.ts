import type { ElementId } from '../core/types';

export type ItemDef =
  | { id: string; name: string; icon: string; kind: 'tome'; skill: string; desc: string }
  | { id: string; name: string; icon: string; kind: 'shard'; element: ElementId; desc: string };

export const ITEMS: Record<string, ItemDef> = {
  tome_quickstep: {
    id: 'tome_quickstep', name: 'Tome of Quickstep', icon: '📘', kind: 'tome', skill: 'quickstep',
    desc: 'A wind-worn booklet of footwork drills.',
  },
  tome_static_field: {
    id: 'tome_static_field', name: 'Tome of Static Field', icon: '📙', kind: 'tome', skill: 'static_field',
    desc: 'Pages that crackle when turned.',
  },
  storm_shard: {
    id: 'storm_shard', name: 'Storm Shard', icon: '💎', kind: 'shard', element: 'lightning',
    desc: 'A crystal of trapped lightning from the heart of Thunderhoof.',
  },
};
