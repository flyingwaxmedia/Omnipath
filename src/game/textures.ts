import type Phaser from 'phaser';
import { canvasTex, ellipse, eyes, glow, line, outlined, poly, rect, shade, type Ctx } from './art/common';
import { drawMonsters } from './art/monsters';
import { drawWorld } from './art/world';

// All art is generated at boot so the game ships with zero binary assets.
// Swap any key for a real sprite sheet later without touching game code.
//   - world art (tiles, props, structures, objects, nodes, portals): ./art/world.ts
//   - monsters (mon_*): ./art/monsters.ts
//   - characters (player_*, npc_*) and fx: this file

export { TILE_MARGIN, TILE_SPACING, PRISM_SOCKETS, PRISM_GATE_SIZE } from './art/world';

const OUTLINE = 'rgba(22,18,30,0.8)';

// ---------------------------------------------------------------- characters (40x48 chibi template)

type Held =
  | 'sword'
  | 'dagger'
  | 'staff'
  | 'hammer'
  | 'rod'
  | 'book'
  | 'scroll'
  | 'ledger'
  | 'pickaxe'
  | 'baton'
  | 'compass'
  | 'kite'
  | 'walkstick'
  | 'sunstaff'
  | 'waystaff'
  | 'bow';
type HatKind = 'tall' | 'wide' | 'cap' | 'miner' | 'band' | 'feathercap';

interface Look {
  skin: string;
  hair: string;
  body: string;
  legs: string;
  style?: 'short' | 'long' | 'bun' | 'pony' | 'bald' | 'spiky' | 'braid';
  held?: Held;
  /** Sleeve colour (defaults to body; pass skin for bare arms). */
  sleeves?: string;
  /** Long robe covering the legs. */
  robe?: boolean;
  apron?: string;
  belt?: string;
  /** Diagonal strap across the chest. */
  sash?: string;
  cape?: string;
  scarf?: string;
  /** Collar + hem trim. */
  trim?: string;
  emblem?: string;
  beard?: string;
  mustache?: string;
  hood?: string;
  hat?: { kind: HatKind; color: string; band?: string };
  glasses?: boolean;
  back?: 'pack' | 'quiver' | 'scrolls';
  boots?: string;
  child?: boolean;
}

function drawCharacter(scene: Phaser.Scene, key: string, look: Look) {
  canvasTex(scene, key, 40, 48, (c) => outlined(c, 40, 48, OUTLINE, (b) => paintCharacter(b, look)));
}

function paintCharacter(c: Ctx, L: Look): void {
  const cx = 18;
  // Geometry: adults have a big chibi head; kids are shorter with the same face size.
  const g = L.child ? { hy: 23, hr: 8, bt: 30, bb: 41, lt: 39, fy: 43 } : { hy: 14, hr: 9, bt: 22, bb: 38, lt: 36, fy: 43 };
  const sleeves = L.sleeves ?? L.body;
  const boots = L.boots ?? '#3a2a1e';
  const hx = cx + 10; // right hand x
  const hy = g.bt + (L.child ? 8 : 11); // right hand y

  // ---- behind the body
  if (L.cape) {
    poly(c, [cx - 8, g.bt + 1, cx + 8, g.bt + 1, cx + 12, g.fy + 1, cx - 12, g.fy + 1], shade(L.cape, -18));
    rect(c, cx - 12, g.fy - 1, 24, 2, shade(L.cape, -36));
  }
  if (L.back === 'pack') {
    rect(c, cx - 12, g.bt + 1, 24, g.bb - g.bt - 4, '#7a5432');
    rect(c, cx - 12, g.bt + 1, 24, 2, '#9a6e44');
    rect(c, cx - 14, g.bt + 6, 3, 8, '#5a3a22');
    rect(c, cx - 6, g.bt - 4, 12, 5, '#c8b48c');
    rect(c, cx - 6, g.bt - 4, 12, 1, '#e0d0a8');
  }
  if (L.back === 'quiver') {
    rect(c, cx - 12, g.bt - 7, 5, 16, '#6a4426');
    rect(c, cx - 12, g.bt - 7, 5, 1, '#8a6238');
    for (const [dx, col] of [
      [-12, '#e8e0d0'],
      [-10, '#c0503a'],
      [-8, '#e8e0d0'],
    ] as const) {
      rect(c, cx + dx, g.bt - 11, 1, 4, '#8a6238');
      rect(c, cx + dx - 0.5, g.bt - 12, 2, 3, col);
    }
  }
  if (L.back === 'scrolls') {
    rect(c, cx - 13, g.bt - 6, 6, 18, '#5a3a22');
    rect(c, cx - 13, g.bt - 6, 6, 1, '#7a5432');
    rect(c, cx - 12, g.bt - 9, 2, 4, '#efe2c0');
    rect(c, cx - 10, g.bt - 8, 2, 3, '#e0d0a8');
  }

  // ---- legs
  if (!L.robe) {
    rect(c, cx - 6, g.lt, 5, g.fy - g.lt, L.legs);
    rect(c, cx + 1, g.lt, 5, g.fy - g.lt, shade(L.legs, -14));
  }
  rect(c, cx - 7, g.fy, 6, 3, boots);
  rect(c, cx + 1, g.fy, 6, 3, shade(boots, -10));
  rect(c, cx - 7, g.fy, 6, 1, shade(boots, 22));

  // ---- body
  if (L.robe) {
    poly(c, [cx - 8, g.bt, cx + 8, g.bt, cx + 11, g.fy + 1, cx - 11, g.fy + 1], L.body);
    poly(c, [cx + 3, g.bt, cx + 8, g.bt, cx + 11, g.fy + 1, cx + 5, g.fy + 1], shade(L.body, -22));
    line(c, [cx - 2, g.bb - 2, cx - 4, g.fy], shade(L.body, -18), 1, 'butt');
    if (L.trim) rect(c, cx - 11, g.fy - 1, 22, 2, L.trim);
  } else {
    poly(c, [cx - 9, g.bb, cx - 7, g.bt, cx + 7, g.bt, cx + 9, g.bb], L.body);
    poly(c, [cx + 3, g.bt, cx + 7, g.bt, cx + 9, g.bb, cx + 4, g.bb], shade(L.body, -22));
    rect(c, cx - 8, g.bb - 2, 17, 2, shade(L.body, -30));
    if (L.trim) rect(c, cx - 9, g.bb - 1, 18, 1, L.trim);
  }
  if (L.trim) {
    rect(c, cx - 4, g.bt, 8, 2, L.trim);
    rect(c, cx - 1, g.bt + 2, 2, L.robe ? g.fy - g.bt - 3 : g.bb - g.bt - 3, L.trim);
  }
  if (L.apron) {
    rect(c, cx - 5, g.bt + 4, 10, g.bb - g.bt + 1, L.apron);
    rect(c, cx - 5, g.bt + 4, 10, 1, shade(L.apron, 20));
    rect(c, cx - 5, g.bt, 2, 4, L.apron);
    rect(c, cx + 3, g.bt, 2, 4, L.apron);
    rect(c, cx - 3, g.bt + 9, 6, 4, shade(L.apron, -16));
  }
  if (L.sash) line(c, [cx - 7, g.bt + 1, cx + 7, g.bb - 3], L.sash, 2, 'butt');
  if (L.belt) {
    rect(c, cx - 8, g.bb - 6, 16, 2, L.belt);
    rect(c, cx - 1, g.bb - 6, 3, 2, '#d8b04a');
  }
  if (L.emblem) poly(c, [cx, g.bt + 4, cx + 2, g.bt + 6, cx, g.bt + 8, cx - 2, g.bt + 6], L.emblem);
  if (L.back === 'pack') {
    rect(c, cx - 6, g.bt, 2, 9, '#5a3a22');
    rect(c, cx + 4, g.bt, 2, 9, '#5a3a22');
  }

  // ---- arms
  const armH = L.child ? 5 : 7;
  rect(c, cx - 11, g.bt + 2, 3, armH, sleeves);
  rect(c, cx + 8, g.bt + 2, 3, armH, shade(sleeves, -16));
  rect(c, cx - 11, g.bt + 2 + armH, 3, 3, L.skin);
  rect(c, cx + 8, g.bt + 2 + armH, 3, 3, L.skin);

  if (L.scarf) {
    rect(c, cx - 7, g.bt - 1, 14, 3, L.scarf);
    rect(c, cx - 7, g.bt - 1, 14, 1, shade(L.scarf, 22));
    rect(c, cx + 2, g.bt + 2, 3, 7, shade(L.scarf, -14));
  }

  // ---- head
  ellipse(c, cx, g.hy, g.hr, g.hr, L.skin);
  ellipse(c, cx + g.hr * 0.45, g.hy + 2, g.hr * 0.45, g.hr * 0.6, shade(L.skin, -12));
  ellipse(c, cx, g.hy, g.hr - 1, g.hr - 1, L.skin);
  const top = g.hy - g.hr;
  if (L.hood) {
    c.fillStyle = L.hood;
    c.beginPath();
    c.arc(cx, g.hy - 1, g.hr + 2, Math.PI, 0);
    c.fill();
    rect(c, cx - g.hr - 2, g.hy - 1, 4, 10, L.hood);
    rect(c, cx + g.hr - 2, g.hy - 1, 4, 10, shade(L.hood, -18));
    rect(c, cx - g.hr + 1, g.hy - 3, g.hr * 2 - 2, 2, shade(L.hood, -26));
  } else {
    const hair = L.hair;
    if (L.style === 'long' || L.style === 'braid') {
      rect(c, cx - g.hr - 1, g.hy - 3, 4, 14, hair);
      rect(c, cx + g.hr - 3, g.hy - 3, 4, L.style === 'braid' ? 6 : 14, shade(hair, -12));
      if (L.style === 'braid') for (let i = 0; i < 4; i++) ellipse(c, cx - g.hr + 1, g.hy + 11 + i * 3, 2, 1.6, i % 2 ? hair : shade(hair, 16));
    }
    if (L.style === 'bald') {
      rect(c, cx - g.hr, g.hy - 2, 2, 5, hair);
      rect(c, cx + g.hr - 2, g.hy - 2, 2, 5, hair);
      rect(c, cx - 4, top + 2, 4, 1, shade(L.skin, 24));
    } else {
      c.fillStyle = hair;
      c.beginPath();
      c.arc(cx, g.hy - 3, g.hr + 0.5, Math.PI, 0);
      c.fill();
      rect(c, cx - g.hr, g.hy - 4, 4, 7, hair);
      rect(c, cx + 3, g.hy - 8, 6, 4, hair);
      rect(c, cx - 5, top + 1, 5, 1, shade(hair, 26));
      if (L.style === 'bun') {
        ellipse(c, cx, top - 1, 4, 3, hair);
        rect(c, cx - 2, top - 3, 2, 1, shade(hair, 26));
      }
      if (L.style === 'pony') {
        poly(c, [cx + g.hr - 1, g.hy - 6, cx + g.hr + 4, g.hy - 2, cx + g.hr + 3, g.hy + 9, cx + g.hr, g.hy + 4], hair);
        rect(c, cx + g.hr - 1, g.hy - 6, 2, 2, '#c0503a');
      }
      if (L.style === 'spiky')
        for (const dx of [-7, -3, 1, 5]) poly(c, [cx + dx, top + 3, cx + dx + 2, top - 3, cx + dx + 4, top + 3], hair);
    }
  }

  // ---- face
  eyes(c, cx + 1, g.hy + 1, 4, 1.6);
  if (L.glasses) {
    c.strokeStyle = '#c8a050';
    c.lineWidth = 1;
    c.strokeRect(cx - 5.5, g.hy - 1.5, 5, 4);
    c.strokeRect(cx + 2.5, g.hy - 1.5, 5, 4);
    rect(c, cx - 0.5, g.hy, 3, 1, '#c8a050');
  }
  if (L.child) {
    rect(c, cx - 6, g.hy + 3, 2, 1, '#f09a9a');
    rect(c, cx + 6, g.hy + 3, 2, 1, '#f09a9a');
  }
  if (L.beard) {
    poly(c, [cx - 7, g.hy + 3, cx + 8, g.hy + 3, cx + 5, g.hy + 10, cx, g.hy + 14, cx - 4, g.hy + 10], L.beard);
    rect(c, cx - 2, g.hy + 6, 5, 1, shade(L.beard, -30));
  }
  if (L.mustache) {
    rect(c, cx - 3, g.hy + 4, 8, 2, L.mustache);
    rect(c, cx - 4, g.hy + 5, 1, 2, L.mustache);
    rect(c, cx + 5, g.hy + 5, 1, 2, L.mustache);
  }

  // ---- hats
  if (L.hat) {
    const h = L.hat;
    const band = h.band ?? shade(h.color, -30);
    switch (h.kind) {
      case 'tall':
        rect(c, cx - 13, top + 1, 26, 3, h.color);
        rect(c, cx - 7, top - 5, 14, 7, h.color);
        rect(c, cx - 7, top, 14, 2, band);
        rect(c, cx - 7, top - 5, 3, 7, shade(h.color, 20));
        break;
      case 'wide':
        ellipse(c, cx, top + 4, 15, 4, shade(h.color, -24));
        ellipse(c, cx, top + 3, 15, 3.5, h.color);
        ellipse(c, cx, top, 7, 5, h.color);
        rect(c, cx - 7, top + 1, 14, 2, band);
        rect(c, cx - 4, top - 3, 4, 1, shade(h.color, 30));
        break;
      case 'cap':
        c.fillStyle = h.color;
        c.beginPath();
        c.arc(cx, g.hy - 3, g.hr + 1, Math.PI, 0);
        c.fill();
        rect(c, cx - 3, g.hy - 4, 14, 2, shade(h.color, -24));
        rect(c, cx - g.hr - 1, g.hy - 4, g.hr * 2 + 2, 1, band);
        break;
      case 'miner':
        c.fillStyle = h.color;
        c.beginPath();
        c.arc(cx, g.hy - 2, g.hr + 1.5, Math.PI, 0);
        c.fill();
        rect(c, cx - g.hr - 3, g.hy - 3, g.hr * 2 + 6, 2, shade(h.color, -30));
        rect(c, cx - 4, top - 1, 4, 1, shade(h.color, 30));
        glow(c, cx + 1, top + 2, 6, '#fff2a0', 0.6);
        ellipse(c, cx + 1, top + 2, 2.5, 2.5, '#5a5a62');
        ellipse(c, cx + 1, top + 2, 1.6, 1.6, '#fff6c0');
        break;
      case 'band':
        rect(c, cx - g.hr, g.hy - 5, g.hr * 2, 2, h.color);
        line(c, [cx - g.hr, g.hy - 4, cx - g.hr - 4, g.hy + 1], h.color, 2, 'butt');
        line(c, [cx - g.hr, g.hy - 4, cx - g.hr - 2, g.hy + 3], h.color, 2, 'butt');
        break;
      case 'feathercap':
        c.fillStyle = h.color;
        c.beginPath();
        c.ellipse(cx - 1, g.hy - 5, g.hr + 1, 5, -0.15, Math.PI, 0);
        c.fill();
        rect(c, cx - g.hr - 1, g.hy - 5, g.hr * 2 + 2, 2, band);
        poly(c, [cx + 4, g.hy - 7, cx + 13, top - 6, cx + 8, g.hy - 7], '#e8e0d0');
        line(c, [cx + 5, g.hy - 7, cx + 12, top - 5], '#c0503a', 1, 'butt');
        break;
    }
  }

  // ---- held item (right hand)
  switch (L.held) {
    case 'sword':
      rect(c, hx + 1, hy - 27, 4, 24, '#dfe6ee');
      rect(c, hx + 3, hy - 27, 2, 24, '#9aa6b2');
      rect(c, hx + 1, hy - 28, 3, 1, '#ffffff');
      rect(c, hx - 2, hy - 4, 10, 3, '#c9a03a');
      rect(c, hx + 2, hy - 1, 2, 5, '#5a3a1e');
      break;
    case 'dagger':
      rect(c, hx + 1, hy - 13, 3, 11, '#e6edf4');
      rect(c, hx + 3, hy - 13, 1, 11, '#a8b4c0');
      rect(c, hx - 1, hy - 3, 7, 2, '#7a4f2a');
      rect(c, hx + 1, hy - 1, 3, 4, '#7a4f2a');
      break;
    case 'staff':
      rect(c, hx + 1, hy - 25, 3, 38, '#7a5230');
      ellipse(c, hx + 2.5, hy - 26, 4.5, 4.5, '#7fd6ff');
      ellipse(c, hx + 1.5, hy - 27, 1.5, 1.5, '#ffffff');
      break;
    case 'hammer':
      rect(c, hx + 1, hy - 19, 3, 22, '#7a5230');
      rect(c, hx - 3, hy - 23, 11, 7, '#6d747c');
      rect(c, hx - 3, hy - 23, 11, 2, '#9aa2aa');
      rect(c, hx + 6, hy - 23, 2, 7, '#50565e');
      break;
    case 'rod':
      line(c, [hx + 2, hy + 1, hx + 5, hy - 31], '#8a6a3a', 2, 'butt');
      line(c, [hx + 5, hy - 31, hx + 8, hy - 18], 'rgba(230,230,240,0.8)', 1, 'butt');
      rect(c, hx + 7, hy - 18, 2, 2, '#ff4040');
      break;
    case 'walkstick':
      line(c, [hx + 2, hy + 12, hx + 3, hy - 20, hx + 1, hy - 24, hx + 4, hy - 26], '#6a4a2a', 3, 'butt');
      rect(c, hx + 1, hy - 18, 3, 1, '#8a6a3a');
      break;
    case 'sunstaff':
      rect(c, hx + 1, hy - 20, 2, 33, '#d8c8a0');
      glow(c, hx + 2, hy - 24, 7, '#ffe8a0', 0.6);
      c.strokeStyle = '#f2d36b';
      c.lineWidth = 1.6;
      c.beginPath();
      c.arc(hx + 2, hy - 24, 3.5, 0, Math.PI * 2);
      c.stroke();
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
        rect(c, Math.round(hx + 2 + Math.cos(a) * 5.5) - 0.5, Math.round(hy - 24 + Math.sin(a) * 5.5) - 0.5, 1.5, 1.5, '#f2d36b');
      }
      break;
    case 'waystaff':
      rect(c, hx + 1, hy - 19, 3, 32, '#5a4a6a');
      rect(c, hx + 1, hy - 19, 1, 32, '#7a6a8a');
      rect(c, hx - 1, hy - 20, 7, 2, '#3a3040');
      glow(c, hx + 2.5, hy - 25, 8, '#7ff0ff', 0.7);
      poly(c, [hx + 2.5, hy - 31, hx + 6, hy - 25, hx + 2.5, hy - 20, hx - 1, hy - 25], '#bffcff');
      poly(c, [hx + 2.5, hy - 31, hx + 6, hy - 25, hx + 2.5, hy - 20], '#5fd8f0');
      break;
    case 'baton':
      line(c, [hx + 1, hy + 2, hx + 7, hy - 16], '#b88a50', 3, 'butt');
      line(c, [hx + 1, hy + 2, hx + 7, hy - 16], '#d8a868', 1, 'butt');
      rect(c, hx - 1, hy - 2, 6, 2, '#5a3a1e');
      break;
    case 'pickaxe':
      line(c, [hx + 1, hy + 3, hx + 5, hy - 18], '#7a5230', 3, 'butt');
      c.strokeStyle = '#7d848c';
      c.lineWidth = 3;
      c.beginPath();
      c.arc(hx + 5, hy - 10, 10, -Math.PI * 0.85, -Math.PI * 0.15);
      c.stroke();
      rect(c, hx + 3, hy - 21, 4, 4, '#5a6068');
      break;
    case 'book':
      rect(c, cx + 3, g.bt + 6, 11, 9, '#6a2a3a');
      rect(c, cx + 4, g.bt + 7, 9, 7, '#f0e6cc');
      rect(c, cx + 8, g.bt + 7, 1, 7, '#8a7a5a');
      rect(c, cx + 5, g.bt + 9, 2, 1, '#8a7a5a');
      rect(c, cx + 10, g.bt + 9, 2, 1, '#8a7a5a');
      rect(c, cx + 5, g.bt + 11, 2, 1, '#8a7a5a');
      break;
    case 'ledger':
      rect(c, cx + 4, g.bt + 4, 10, 12, '#7a5432');
      rect(c, cx + 5, g.bt + 6, 8, 9, '#efe6cc');
      rect(c, cx + 7, g.bt + 3, 4, 2, '#a0a8b0');
      for (let i = 0; i < 3; i++) rect(c, cx + 6, g.bt + 8 + i * 2, 6, 1, '#8a8070');
      break;
    case 'scroll':
      rect(c, hx - 2, hy - 12, 4, 14, '#efe2c0');
      rect(c, hx - 2, hy - 12, 1, 14, '#ffffff');
      rect(c, hx - 3, hy - 13, 6, 2, '#a0602a');
      rect(c, hx - 3, hy + 1, 6, 2, '#a0602a');
      rect(c, hx + 2, hy - 6, 3, 2, '#c0503a');
      break;
    case 'compass':
      glow(c, cx + 9, g.bt + 9, 6, '#b08cff', 0.5);
      ellipse(c, cx + 9, g.bt + 9, 4, 4, '#c8a050');
      ellipse(c, cx + 9, g.bt + 9, 3, 3, '#2a2440');
      line(c, [cx + 9, g.bt + 7, cx + 10, g.bt + 10], '#d8b8ff', 1, 'butt');
      line(c, [hx + 2, hy + 12, hx + 3, hy - 18], '#6a4a2a', 2, 'butt');
      break;
    case 'kite': {
      const kx = hx + 5;
      const ky = 9;
      line(c, [hx + 1, hy, hx + 4, hy - 10, kx, ky + 7], 'rgba(255,255,255,0.75)', 1, 'butt');
      poly(c, [kx, ky - 7, kx + 5, ky, kx, ky + 7, kx - 4, ky], '#e8443a');
      poly(c, [kx, ky - 7, kx + 5, ky, kx, ky], '#ffd84d');
      poly(c, [kx - 4, ky, kx, ky + 7, kx, ky], '#ffd84d');
      line(c, [kx, ky + 7, kx - 2, ky + 10, kx + 1, ky + 13], '#3d6fd1', 1, 'butt');
      break;
    }
    case 'bow':
      c.strokeStyle = '#7a5230';
      c.lineWidth = 2;
      c.beginPath();
      c.arc(hx - 4, hy - 6, 13, -0.9, 0.9);
      c.stroke();
      line(c, [hx - 4 + Math.cos(-0.9) * 13, hy - 6 + Math.sin(-0.9) * 13, hx - 4 + Math.cos(0.9) * 13, hy - 6 + Math.sin(0.9) * 13], 'rgba(240,235,220,0.9)', 1, 'butt');
      break;
  }
}

function drawCharacters(scene: Phaser.Scene) {
  const belt = '#5a3a22';
  drawCharacter(scene, 'player_sword', { skin: '#f2c9a0', hair: '#6b3d1e', body: '#3d6fd1', legs: '#3b3b54', held: 'sword', style: 'short', belt });
  drawCharacter(scene, 'player_dagger', { skin: '#f2c9a0', hair: '#2b2b2b', body: '#3e6b3a', legs: '#4a3a2a', held: 'dagger', hood: '#2f4f2c', belt });
  drawCharacter(scene, 'player_staff', { skin: '#f2c9a0', hair: '#d9d1c0', body: '#7a4bc4', legs: '#3b2e54', held: 'staff', hat: { kind: 'tall', color: '#4a2f80' }, trim: '#c8a8ff' });

  drawCharacter(scene, 'npc_blacksmith', { skin: '#d9a77a', hair: '#3a2a1e', style: 'bald', body: '#8a6440', sleeves: '#d9a77a', legs: '#3a3a3a', apron: '#4a3a32', held: 'hammer', beard: '#5a3a1e' });
  drawCharacter(scene, 'npc_priestess', { skin: '#f6d6b8', hair: '#e8d7a0', body: '#f2f2f2', legs: '#d8d8e8', robe: true, hood: '#ffffff', trim: '#d8b04a', held: 'sunstaff', boots: '#c8b890' });
  drawCharacter(scene, 'npc_hermit', { skin: '#e0b896', hair: '#c8c8c8', body: '#6b6b6b', legs: '#4a4a4a', robe: true, hood: '#5a5a5a', beard: '#e8e8e8', belt: '#b8a070', held: 'walkstick' });
  drawCharacter(scene, 'npc_fisher', { skin: '#e8b88f', hair: '#8a5a2a', body: '#2f7f8f', sleeves: '#d8d0b8', legs: '#3b4b5b', held: 'rod', hat: { kind: 'wide', color: '#d8b860', band: '#8a3a2a' }, boots: '#3a4a3a' });

  drawCharacter(scene, 'npc_drillmaster', { skin: '#d8a07a', hair: '#4a3020', style: 'short', mustache: '#4a3020', body: '#a8332a', trim: '#e8c050', belt: '#3a2a1e', legs: '#2e2e3a', held: 'baton', hat: { kind: 'band', color: '#f0ece0' }, boots: '#2a2020' });
  drawCharacter(scene, 'npc_quartermaster', { skin: '#c98e64', hair: '#2a2a2a', style: 'short', body: '#6a6a3a', scarf: '#e0702a', belt: '#4a3020', legs: '#4a4030', hat: { kind: 'cap', color: '#55552e', band: '#e0702a' }, held: 'ledger' });
  drawCharacter(scene, 'npc_waykeeper', { skin: '#f0c8a0', hair: '#3a3050', style: 'long', body: '#2f5f8f', legs: '#2a3a5a', robe: true, trim: '#7ff0ff', emblem: '#bffcff', cape: '#24486e', held: 'waystaff' });
  drawCharacter(scene, 'npc_loremaster', { skin: '#e8c0a0', hair: '#a05a2a', style: 'bun', body: '#5a3a7a', legs: '#3a2a4a', robe: true, trim: '#d8b04a', glasses: true, held: 'book' });
  drawCharacter(scene, 'npc_archivist', { skin: '#c8906a', hair: '#1e1e2a', style: 'braid', body: '#2f6a5a', legs: '#2a4a40', robe: true, sash: '#c8a050', back: 'scrolls', held: 'scroll' });
  drawCharacter(scene, 'npc_wayfinder', { skin: '#d8a880', hair: '#7a4a2a', style: 'spiky', body: '#5a4a3a', legs: '#3a3a4a', cape: '#3a3a6a', scarf: '#7a5ab8', belt: '#3a2a1e', back: 'pack', held: 'compass', boots: '#4a3020' });
  drawCharacter(scene, 'npc_child', { skin: '#f2c9a0', hair: '#c8783a', style: 'short', body: '#e8b030', legs: '#3a5a9a', held: 'kite', child: true, boots: '#8a3a2a' });
  drawCharacter(scene, 'npc_miner', { skin: '#d8a07a', hair: '#3a2a1e', style: 'short', beard: '#6a4a2a', body: '#7a8590', apron: '#3a5a8a', legs: '#3a5a8a', hat: { kind: 'miner', color: '#e8b830' }, held: 'pickaxe' });
  drawCharacter(scene, 'npc_scout', { skin: '#e0b088', hair: '#b8502a', style: 'pony', body: '#4a6a3a', belt: '#4a3020', sash: '#6a4a2a', legs: '#4a3a2a', hat: { kind: 'feathercap', color: '#3a5a2e' }, back: 'quiver', held: 'bow', boots: '#4a3020' });
}

// ---------------------------------------------------------------- fx

function drawFx(scene: Phaser.Scene) {
  canvasTex(scene, 'fx_dot', 16, 16, (c) => {
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 16);
  });
  canvasTex(scene, 'fx_orb', 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  canvasTex(scene, 'fx_blade', 32, 10, (c) => {
    poly(c, [0, 5, 8, 2, 30, 4, 32, 5, 30, 6, 8, 8], '#ffffff');
    rect(c, 6, 0, 3, 10, '#c9a03a');
  });
  canvasTex(scene, 'fx_knife', 18, 6, (c) => poly(c, [0, 3, 5, 1, 18, 3, 5, 5], '#ffffff'));
  canvasTex(scene, 'shadow', 32, 12, (c) => ellipse(c, 16, 6, 15, 5, 'rgba(0,0,0,0.28)'));
  canvasTex(scene, 'target_ring', 48, 20, (c) => {
    c.strokeStyle = '#ffdd55';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(24, 10, 21, 8, 0, 0, Math.PI * 2);
    c.stroke();
  });
  canvasTex(scene, 'move_marker', 24, 12, (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(12, 6, 10, 4, 0, 0, Math.PI * 2);
    c.stroke();
  });
}

/** Single entry point: generate every texture the game uses (idempotent per key). */
export function generateTextures(scene: Phaser.Scene): void {
  drawWorld(scene);
  drawCharacters(scene);
  drawMonsters(scene);
  drawFx(scene);
}
