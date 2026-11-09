// Small in-world pixel textures the actors lane owns (drawn lazily, once per key): the quest markers over NPC heads
// and the status icons over the player's head (in-world text has no emoji — docs/INTEGRATION-v3.md §1.7).
import type Phaser from 'phaser';
import type { StatusKind } from '../../core/types';
import { PAL, disc, outline, pixelTex, type Ctx } from '../art/pixel';

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
  // Speech bubble with three dots: "in progress". A light parchment core with a dark rim inside the outline and
  // ink-dark dots, so it reads on grey cobblestone (a grey bubble vanished there).
  '…': {
    w: 15,
    h: 12,
    rows: [
      '.rrrrrrrrrrr.',
      'rwwwwwwwwwwwr',
      'rwwwwwwwwwwsr',
      'rwwddwddwddsr',
      'rwwddwddwddsr',
      'rwwwwwwwwwssr',
      '.rrwrrrrrrrr.',
      '..rwr........',
      '..rr.........',
    ],
    pal: { w: '#fff6dc', s: '#d8c8a0', d: '#3a2c22', r: '#6a5440' },
  },
};

/** Draws (once) and returns the texture key of a quest marker. */
export function questMarkerKey(scene: Phaser.Scene, kind: QuestMarkerKind): string {
  const key = MARKER_KEYS[kind];
  const a = MARKER_ART[kind];
  pixelTex(scene, key, a.w, a.h, (c) => sprite(c, a.w, a.h, a.rows, a.pal));
  return key;
}

// ---------------------------------------------------------------- ground marks at their real size

/**
 * A drop shadow `w` art px wide, drawn at that size (docs/QUALITY-PLAN.md §1: no scaled pixel images). Same flat look as
 * the boot 'shadow' (32 x 12, rgba(20,12,6,0.3)); widths round to even numbers so the shadow centres on whole pixels.
 */
export function shadowKey(scene: Phaser.Scene, w: number): string {
  const W = Math.max(8, Math.round(w / 2) * 2);
  if (W === 32 && scene.textures.exists('shadow')) return 'shadow';
  const H = Math.max(4, Math.round((W * 0.375) / 2) * 2);
  const key = `act_shadow_${W}`;
  pixelTex(scene, key, W, H, (c) => disc(c, W / 2, H / 2, W / 2 - 1, H / 2 - 1, 'rgba(20,12,6,0.3)'));
  return key;
}

/** Monster drop shadow width (art px) per rank and baked size (the v2 scale formula, now drawn natively). */
export function monsterShadowW(rank: 'common' | 'elite' | 'warden', size = 1): number {
  const big = rank === 'warden' ? 2.6 : rank === 'elite' ? 1.6 : 1;
  return Math.round(32 * (big * size * 0.8 + 0.2));
}

function ringPx(c: Ctx, cx: number, cy: number, rx: number, ry: number, color: string, thick: number): void {
  c.fillStyle = color;
  const inside = (x: number, y: number, ax: number, ay: number) => ((x + 0.5 - cx) / ax) ** 2 + ((y + 0.5 - cy) / ay) ** 2 <= 1;
  for (let y = Math.floor(cy - ry - 1); y <= Math.ceil(cy + ry + 1); y++)
    for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++)
      if (inside(x, y, rx, ry) && !inside(x, y, rx - thick, ry - thick)) c.fillRect(x, y, 1, 1);
}

/** Target ring sizes (art px) per rank: the v2 48 x 20 ring and its old 1.5x / 2.4x scales, drawn natively. */
export const TARGET_RING_W: Readonly<Record<'common' | 'elite' | 'warden', number>> = { common: 48, elite: 72, warden: 116 };

/**
 * The ring under the current target, drawn at its real size for the rank (MapScene shows it at scale 1 instead of
 * setScale(1.5 / 2.4)). Same look as the boot 'target_ring': dark rim, 2 px gold band, brighter front arc.
 */
export function targetRingKey(scene: Phaser.Scene, rank: 'common' | 'elite' | 'warden'): string {
  const W = TARGET_RING_W[rank];
  const H = Math.round((W * 20) / 48 / 2) * 2;
  const key = `act_target_ring_${W}`;
  pixelTex(scene, key, W, H, (c) => {
    const cx = W / 2;
    const cy = H / 2;
    const rx = cx - 2;
    const ry = cy - 1;
    ringPx(c, cx, cy, rx, ry, PAL.outline, 1);
    ringPx(c, cx, cy, rx - 1, ry - 1, '#ffdd55', rank === 'common' ? 2 : 3);
    c.fillStyle = '#fff3b0';
    const arc = Math.round(W * 0.21);
    for (let x = Math.round(cx - arc); x < Math.round(cx + arc); x++) c.fillRect(x, H - 3, 1, 1);
  });
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
