// Small in-world pixel textures the actors lane owns (drawn lazily, once per key): the quest markers over NPC heads
// and the status icons over the player's head (in-world text has no emoji — docs/INTEGRATION-v3.md §1.7).
import type Phaser from 'phaser';
import type { StatusKind } from '../../core/types';
import { PAL, outline, pixelTex, type Ctx } from '../art/pixel';

/** Paints a template ('.' = empty) with a palette, then adds the 1 px dark outline. */
function sprite(c: Ctx, w: number, h: number, rows: readonly string[], pal: Record<string, string>, x = 1, y = 1): void {
  for (let j = 0; j < rows.length; j++)
    for (let i = 0; i < rows[j].length; i++) {
      const col = pal[rows[j][i]];
      if (!col) continue;
      c.fillStyle = col;
      c.fillRect(x + i, y + j, 1, 1);
    }
  outline(c, w, h, PAL.outline);
}

// ---------------------------------------------------------------- quest markers

export type QuestMarkerKind = '!' | '?' | '…';

/** Texture key per marker. */
export const MARKER_KEYS: Readonly<Record<QuestMarkerKind, string>> = {
  '!': 'act_quest_new',
  '?': 'act_quest_ready',
  '…': 'act_quest_busy',
};

const GOLD = { d: '#9a6a1c', g: '#e9b23a', G: '#ffd76a', l: '#fff4c0' };

/** Marker art: canvas size and a template (1 px margin all round for the outline). */
export const MARKER_ART: Readonly<Record<QuestMarkerKind, { w: number; h: number; rows: string[]; pal: Record<string, string> }>> = {
  // Gold exclamation: a tapered bar and a round dot, lit from the top-left.
  '!': {
    w: 9,
    h: 16,
    rows: ['.lGGGg.', 'lGGGGgd', 'lGGGGgd', 'lGGGGgd', '.lGGgd.', '.lGGgd.', '.lGGgd.', '..Ggd..', '..Ggd..', '...d...', '.......', '..lGg..', '.lGGgd.', '..ggd..'],
    pal: GOLD,
  },
  // Gold question mark.
  '?': {
    w: 11,
    h: 16,
    rows: [
      '..lGGGg..',
      '.lGGGGGgd',
      'lGGgddGGd',
      'lGd...lGd',
      '......lGd',
      '.....lGgd',
      '....lGgd.',
      '...lGgd..',
      '...lGd...',
      '...Ggd...',
      '.........',
      '...lGg...',
      '..lGGgd..',
      '...ggd...',
    ],
    pal: GOLD,
  },
  // Grey speech bubble with three dots: "in progress".
  '…': {
    w: 15,
    h: 12,
    rows: [
      '.wwwwwwwwwww.',
      'wwwwwwwwwwwws',
      'wwwwwwwwwwwws',
      'wwddwwddwwdds',
      'wwddwwddwwdds',
      'wwwwwwwwwwwws',
      '.wsssssssssss',
      '..sws........',
      '..ss.........',
    ],
    pal: { w: '#d6d1c8', s: '#a19b92', d: '#5e5852' },
  },
};

/** Draws (once) and returns the texture key of a quest marker. */
export function questMarkerKey(scene: Phaser.Scene, kind: QuestMarkerKind): string {
  const key = MARKER_KEYS[kind];
  const a = MARKER_ART[kind];
  pixelTex(scene, key, a.w, a.h, (c) => sprite(c, a.w, a.h, a.rows, a.pal));
  return key;
}

// ---------------------------------------------------------------- sprite bounds

const tops = new Map<string, number>();

/** First row (from the top) of a texture with a visible pixel — where a character's head or hat really starts. */
export function opaqueTop(scene: Phaser.Scene, key: string): number {
  const hit = tops.get(key);
  if (hit !== undefined) return hit;
  let top = 0;
  const src = scene.textures.exists(key) ? scene.textures.get(key).getSourceImage() : null;
  if (typeof HTMLCanvasElement !== 'undefined' && src instanceof HTMLCanvasElement) {
    const c = src.getContext('2d', { willReadFrequently: true });
    if (c) {
      const { data, width, height } = c.getImageData(0, 0, src.width, src.height);
      top = height;
      for (let y = 0; y < height && top === height; y++)
        for (let x = 0; x < width; x++)
          if (data[(y * width + x) * 4 + 3] > 0) {
            top = y;
            break;
          }
      if (top === height) top = 0;
    }
  }
  tops.set(key, top);
  return top;
}

// ---------------------------------------------------------------- status icons

/** The statuses the player shows over the head (order = display order). */
export const PLAYER_STATUS_ICONS: readonly StatusKind[] = ['stun', 'freeze', 'shock', 'burn', 'poison', 'bleed', 'soak', 'slow'];

/** Status icon art: 7x7 templates on a 9x9 canvas (1 px outline margin). */
export const STATUS_ART: Readonly<Partial<Record<StatusKind, { rows: string[]; pal: Record<string, string> }>>> = {
  burn: { rows: ['...r...', '..rr...', '..ryr..', '.ryyr.r', '.ryyyrr', 'rryWyyr', '.ryyyr.'], pal: { r: '#e2482c', y: '#ffb02e', W: '#fff2b0' } },
  poison: { rows: ['...g...', '..ggg..', '.ggLgg.', '.gLggg.', 'ggggggg', '.gggGg.', '..GGG..'], pal: { g: '#6cc04a', G: '#3f8a2e', L: '#d8ffb0' } },
  bleed: { rows: ['...r...', '..rrr..', '.rrLrr.', '.rLrrr.', 'rrrrrrr', '.rrrRr.', '..RRR..'], pal: { r: '#d0303c', R: '#8a1a26', L: '#ffb0b0' } },
  soak: { rows: ['...b...', '..bbb..', '.bbLbb.', '.bLbbb.', 'bbbbbbb', '.bbbBb.', '..BBB..'], pal: { b: '#4a9ae0', B: '#2a5a9a', L: '#d8f4ff' } },
  slow: { rows: ['bbbbbbb', '.bLLLb.', '..bLb..', '...b...', '..bsb..', '.bsssb.', 'bbbbbbb'], pal: { b: '#7aa8d8', L: '#d8f0ff', s: '#e9c46a' } },
  freeze: { rows: ['c..c..c', '.c.c.c.', '..cWc..', 'ccWWWcc', '..cWc..', '.c.c.c.', 'c..c..c'], pal: { c: '#8ae4ff', W: '#ffffff' } },
  stun: { rows: ['...y...', '...y...', '..yWy..', 'yyWWWyy', '..yWy..', '..y.y..', '.y...y.'], pal: { y: '#ffd84a', W: '#fffbe0' } },
  shock: { rows: ['....yy.', '...yy..', '..yy...', '.yyyyy.', '...yy..', '..yy...', '.yy....'], pal: { y: '#ffe04a' } },
};

/** Draws (once) and returns the 9x9 icon texture for a status, or null when the status has no icon. */
export function statusIconKey(scene: Phaser.Scene, kind: StatusKind): string | null {
  const a = STATUS_ART[kind];
  if (!a) return null;
  const key = `act_status_${kind}`;
  pixelTex(scene, key, 9, 9, (c) => sprite(c, 9, 9, a.rows, a.pal));
  return key;
}
