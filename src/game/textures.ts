import Phaser from 'phaser';
import { TILE, TILE_COUNT, T, mulberry32 } from './world/map';


// All art is generated at boot so the prototype ships with zero binary assets.
// Swap any key for a real sprite sheet later without touching game code.

type Ctx = CanvasRenderingContext2D;

function canvas(scene: Phaser.Scene, key: string, w: number, h: number, draw: (c: Ctx) => void) {
  if (scene.textures.exists(key)) return;
  const tex = scene.textures.createCanvas(key, w, h);
  if (!tex) return;
  const ctx = tex.getContext();
  ctx.imageSmoothingEnabled = false;
  draw(ctx);
  tex.refresh();
}

const hex = (n: number) => `#${n.toString(16).padStart(6, '0')}`;

function shade(color: string, amt: number): string {
  const n = parseInt(color.slice(1), 16);
  const r = Math.max(0, Math.min(255, ((n >> 16) & 255) + amt));
  const g = Math.max(0, Math.min(255, ((n >> 8) & 255) + amt));
  const b = Math.max(0, Math.min(255, (n & 255) + amt));
  return hex((r << 16) | (g << 8) | b);
}

function speckle(c: Ctx, x: number, y: number, w: number, h: number, colors: string[], n: number, rnd: () => number, size = 2) {
  for (let i = 0; i < n; i++) {
    c.fillStyle = colors[Math.floor(rnd() * colors.length)];
    c.fillRect(x + Math.floor(rnd() * (w - size + 1)), y + Math.floor(rnd() * (h - size + 1)), size, size);
  }
}

function ellipse(c: Ctx, x: number, y: number, rx: number, ry: number, fill: string) {
  c.fillStyle = fill;
  c.beginPath();
  c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
  c.fill();
}

function eyes(c: Ctx, x: number, y: number, gap: number, r = 2, color = '#1b1b2a') {
  ellipse(c, x - gap, y, r, r * 1.3, color);
  ellipse(c, x + gap, y, r, r * 1.3, color);
  c.fillStyle = '#fff';
  c.fillRect(x - gap, y - r, 1, 1);
  c.fillRect(x + gap, y - r, 1, 1);
}

// ---------------------------------------------------------------- tiles

/** Tiles are drawn edge-to-edge, then copied into an atlas with 1px extruded borders
 *  so fractional camera zoom never samples a neighbouring tile (no seams). */
export const TILE_MARGIN = 1;
export const TILE_SPACING = 2;

function drawTiles(scene: Phaser.Scene) {
  if (scene.textures.exists('tiles')) return;
  const src = document.createElement('canvas');
  src.width = TILE * TILE_COUNT;
  src.height = TILE;
  const c = src.getContext('2d')!;
  {
    const rnd = mulberry32(42);
    const tile = (i: number, base: string, specks: string[], n: number, extra?: (x: number) => void) => {
      const x = i * TILE;
      c.fillStyle = base;
      c.fillRect(x, 0, TILE, TILE);
      speckle(c, x, 0, TILE, TILE, specks, n, rnd);
      extra?.(x);
    };
    tile(T.GRASS, '#5d9e48', ['#6bae52', '#53913f', '#72b85a'], 40);
    tile(T.GRASS2, '#58994a', ['#4b8a3e', '#66a853', '#79bd5d'], 46, (x) => {
      c.fillStyle = '#4b8a3e';
      for (let i = 0; i < 4; i++) c.fillRect(x + 4 + i * 7, 10 + ((i * 11) % 14), 1, 4);
    });
    tile(T.FLOWERS, '#5d9e48', ['#6bae52', '#53913f'], 30, (x) => {
      const cols = ['#ffd84d', '#ff8fb1', '#ffffff', '#b59cff'];
      for (let i = 0; i < 5; i++) {
        const fx = x + 3 + Math.floor(rnd() * 26);
        const fy = 3 + Math.floor(rnd() * 26);
        c.fillStyle = cols[i % cols.length];
        c.fillRect(fx, fy, 3, 3);
        c.fillStyle = '#c77d1a';
        c.fillRect(fx + 1, fy + 1, 1, 1);
      }
    });
    tile(T.PATH, '#b8925f', ['#a5814f', '#c9a36e', '#9d7a49'], 50);
    tile(T.WATER, '#3c8fd1', ['#4aa0e0', '#357fbd'], 24, (x) => {
      c.fillStyle = '#7cc4f2';
      c.fillRect(x + 4, 8, 8, 1);
      c.fillRect(x + 18, 20, 9, 1);
    });
    tile(T.SAND, '#e2cc8e', ['#d4bc7c', '#eedb9f', '#c9b06d'], 40);
    tile(T.STONE, '#8d8a85', ['#7c7974', '#9f9c97', '#6e6b66'], 50, (x) => {
      c.fillStyle = '#6e6b66';
      c.fillRect(x + 2, 15, 12, 1);
      c.fillRect(x + 18, 6, 1, 10);
    });
    tile(T.DARK, '#3b4a3e', ['#323f35', '#455748', '#2b362e', '#4b3d5a'], 50);
    tile(T.COBBLE, '#a7a29a', ['#8f8a82'], 0, (x) => {
      c.fillStyle = '#8f8a82';
      for (let r = 0; r < 4; r++) {
        c.fillRect(x, r * 8, TILE, 1);
        const off = r % 2 ? 4 : 0;
        for (let k = 0; k < 4; k++) c.fillRect(x + off + k * 8, r * 8, 1, 8);
      }
      speckle(c, x, 0, TILE, TILE, ['#b5b0a8', '#99948c'], 20, rnd);
    });
    tile(T.BRIDGE, '#9a6b3c', ['#8a5e33'], 10, (x) => {
      c.fillStyle = '#6e4a27';
      for (let k = 0; k < 4; k++) c.fillRect(x, k * 8 + 7, TILE, 1);
      c.fillStyle = '#b07d4a';
      for (let k = 0; k < 4; k++) c.fillRect(x, k * 8, TILE, 1);
    });
    tile(T.EMBER, '#6b4a3a', ['#5a3c2f', '#7d5644', '#a0452a', '#3d2a22'], 55, (x) => {
      c.fillStyle = '#ff7a3a';
      c.fillRect(x + 7, 22, 2, 1);
      c.fillRect(x + 23, 9, 1, 2);
    });
    tile(T.HILL, '#86b65a', ['#97c46a', '#78a64e', '#a2cf78'], 44);
    tile(T.DEEP, '#2d6fb0', ['#2a65a1', '#3479bf'], 24, (x) => {
      c.fillStyle = '#4f93d1';
      c.fillRect(x + 10, 12, 7, 1);
    });
  }
  const step = TILE + TILE_SPACING;
  canvas(scene, 'tiles', TILE_COUNT * step, TILE + TILE_MARGIN * 2, (out) => {
    for (let i = 0; i < TILE_COUNT; i++) {
      const sx = i * TILE;
      const dx = i * step + TILE_MARGIN;
      const dy = TILE_MARGIN;
      out.drawImage(src, sx, 0, TILE, TILE, dx, dy, TILE, TILE);
      // Extrude each edge (and corners) by one pixel.
      out.drawImage(src, sx, 0, 1, TILE, dx - 1, dy, 1, TILE);
      out.drawImage(src, sx + TILE - 1, 0, 1, TILE, dx + TILE, dy, 1, TILE);
      out.drawImage(src, sx, 0, TILE, 1, dx, dy - 1, TILE, 1);
      out.drawImage(src, sx, TILE - 1, TILE, 1, dx, dy + TILE, TILE, 1);
      out.drawImage(src, sx, 0, 1, 1, dx - 1, dy - 1, 1, 1);
      out.drawImage(src, sx + TILE - 1, 0, 1, 1, dx + TILE, dy - 1, 1, 1);
      out.drawImage(src, sx, TILE - 1, 1, 1, dx - 1, dy + TILE, 1, 1);
      out.drawImage(src, sx + TILE - 1, TILE - 1, 1, 1, dx + TILE, dy + TILE, 1, 1);
    }
  });
}

// ---------------------------------------------------------------- props

function drawProps(scene: Phaser.Scene) {
  const tree = (key: string, leaf: string, trunk = '#6b4423') =>
    canvas(scene, key, 48, 64, (c) => {
      ellipse(c, 24, 58, 16, 5, 'rgba(0,0,0,0.25)');
      c.fillStyle = trunk;
      c.fillRect(20, 38, 8, 20);
      c.fillStyle = shade(trunk, -25);
      c.fillRect(25, 38, 3, 20);
      ellipse(c, 24, 26, 20, 17, shade(leaf, -30));
      ellipse(c, 16, 28, 11, 10, leaf);
      ellipse(c, 32, 28, 11, 10, leaf);
      ellipse(c, 24, 18, 14, 12, leaf);
      ellipse(c, 20, 14, 6, 5, shade(leaf, 30));
      ellipse(c, 30, 22, 4, 3, shade(leaf, 22));
    });
  tree('tree', '#3f8a3a');
  tree('darktree', '#4a3d6b', '#3a2e2a');
  canvas(scene, 'pine', 40, 64, (c) => {
    ellipse(c, 20, 58, 13, 4, 'rgba(0,0,0,0.25)');
    c.fillStyle = '#5c3b1e';
    c.fillRect(17, 46, 6, 12);
    const tri = (y: number, w: number, col: string) => {
      c.fillStyle = col;
      c.beginPath();
      c.moveTo(20, y);
      c.lineTo(20 - w, y + 18);
      c.lineTo(20 + w, y + 18);
      c.fill();
    };
    tri(26, 18, '#2f6b3a');
    tri(14, 14, '#367a42');
    tri(3, 10, '#3f8a4a');
  });
  canvas(scene, 'deadtree', 40, 56, (c) => {
    ellipse(c, 20, 51, 12, 4, 'rgba(0,0,0,0.25)');
    c.strokeStyle = '#3a2a22';
    c.lineWidth = 5;
    c.beginPath();
    c.moveTo(20, 52);
    c.lineTo(20, 20);
    c.moveTo(20, 32);
    c.lineTo(9, 18);
    c.moveTo(20, 26);
    c.lineTo(31, 12);
    c.stroke();
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(9, 18);
    c.lineTo(6, 10);
    c.moveTo(31, 12);
    c.lineTo(35, 6);
    c.stroke();
  });
  canvas(scene, 'bush', 32, 28, (c) => {
    ellipse(c, 16, 24, 12, 3, 'rgba(0,0,0,0.2)');
    ellipse(c, 16, 16, 13, 9, '#3a7d33');
    ellipse(c, 11, 13, 6, 5, '#4a9a40');
    ellipse(c, 21, 12, 5, 4, '#56a84a');
    c.fillStyle = '#e04848';
    c.fillRect(9, 16, 2, 2);
    c.fillRect(20, 18, 2, 2);
  });
  const rock = (key: string, base: string, flecks?: string) =>
    canvas(scene, key, 34, 30, (c) => {
      ellipse(c, 17, 25, 14, 4, 'rgba(0,0,0,0.25)');
      c.fillStyle = shade(base, -30);
      c.beginPath();
      c.moveTo(3, 24);
      c.lineTo(7, 9);
      c.lineTo(17, 3);
      c.lineTo(29, 8);
      c.lineTo(32, 24);
      c.closePath();
      c.fill();
      c.fillStyle = base;
      c.beginPath();
      c.moveTo(7, 20);
      c.lineTo(9, 10);
      c.lineTo(17, 5);
      c.lineTo(26, 10);
      c.lineTo(22, 20);
      c.closePath();
      c.fill();
      if (flecks) {
        c.fillStyle = flecks;
        for (const [x, y] of [[12, 12], [19, 9], [23, 16], [14, 18], [27, 20]]) c.fillRect(x, y, 3, 2);
        c.fillStyle = '#fff6c0';
        c.fillRect(19, 9, 1, 1);
      }
    });
  rock('rock', '#9a968f');
  rock('ore', '#857c74', '#f0b43c');

  // Buildings.
  const house = (key: string, w: number, h: number, wall: string, roof: string, extra?: (c: Ctx) => void) =>
    canvas(scene, key, w, h, (c) => {
      ellipse(c, w / 2, h - 6, w / 2 - 2, 7, 'rgba(0,0,0,0.25)');
      const wallTop = h * 0.42;
      c.fillStyle = wall;
      c.fillRect(8, wallTop, w - 16, h - wallTop - 8);
      c.fillStyle = shade(wall, -25);
      c.fillRect(8, h - 14, w - 16, 6);
      c.fillStyle = roof;
      c.beginPath();
      c.moveTo(0, wallTop + 6);
      c.lineTo(w / 2, 4);
      c.lineTo(w, wallTop + 6);
      c.closePath();
      c.fill();
      c.fillStyle = shade(roof, -30);
      for (let y = 14; y < wallTop; y += 8) c.fillRect(w / 2 - (y / wallTop) * (w / 2) + 6, y, (y / wallTop) * w - 12, 1);
      // door
      c.fillStyle = '#5a3a1e';
      c.fillRect(w / 2 - 9, h - 36, 18, 28);
      c.fillStyle = '#e8c070';
      c.fillRect(w / 2 + 4, h - 22, 2, 2);
      // windows
      c.fillStyle = '#ffe9a8';
      c.fillRect(16, h - 34, 12, 10);
      c.fillRect(w - 28, h - 34, 12, 10);
      c.fillStyle = shade(wall, -40);
      c.fillRect(21, h - 34, 1, 10);
      c.fillRect(w - 23, h - 34, 1, 10);
      extra?.(c);
    });
  house('smithy', 128, 112, '#b9a07a', '#8a3b2a', (c) => {
    c.fillStyle = '#555';
    c.fillRect(96, 6, 14, 30);
    c.fillStyle = '#ff9a3a';
    c.fillRect(99, 2, 8, 5);
    c.fillStyle = '#2b2b2b';
    c.fillRect(54, 30, 20, 8);
    c.fillStyle = '#e6e6e6';
    c.font = 'bold 10px monospace';
    c.fillText('FORGE', 49, 52);
  });
  house('chapel', 128, 140, '#e6e0d2', '#4a6aa8', (c) => {
    c.fillStyle = '#f2d36b';
    c.fillRect(62, 14, 4, 18);
    c.fillRect(56, 20, 16, 4);
  });
  house('hut', 96, 100, '#9c7b54', '#6b7d3a');

  // Interactables.
  canvas(scene, 'shrine', 40, 64, (c) => {
    ellipse(c, 20, 58, 16, 5, 'rgba(0,0,0,0.3)');
    c.fillStyle = '#a7b0b8';
    c.fillRect(8, 50, 24, 8);
    c.fillStyle = '#c4ccd3';
    c.fillRect(13, 12, 14, 40);
    c.fillStyle = '#8c959d';
    c.fillRect(13, 12, 3, 40);
    c.strokeStyle = '#7fe0c0';
    c.lineWidth = 2;
    c.beginPath();
    c.arc(20, 28, 5, 0, Math.PI * 1.5);
    c.stroke();
    c.beginPath();
    c.arc(20, 28, 9, Math.PI, Math.PI * 2.2);
    c.stroke();
    c.fillStyle = '#c4ccd3';
    c.fillRect(9, 6, 22, 7);
  });
  canvas(scene, 'obelisk', 36, 72, (c) => {
    ellipse(c, 18, 66, 14, 5, 'rgba(0,0,0,0.35)');
    c.fillStyle = '#2b2140';
    c.beginPath();
    c.moveTo(18, 2);
    c.lineTo(30, 18);
    c.lineTo(27, 66);
    c.lineTo(9, 66);
    c.lineTo(6, 18);
    c.closePath();
    c.fill();
    c.fillStyle = '#4a3a70';
    c.beginPath();
    c.moveTo(18, 2);
    c.lineTo(18, 66);
    c.lineTo(9, 66);
    c.lineTo(6, 18);
    c.closePath();
    c.fill();
    c.fillStyle = '#b08cff';
    for (const y of [24, 36, 48]) c.fillRect(15, y, 6, 3);
  });
  canvas(scene, 'signpost', 32, 40, (c) => {
    ellipse(c, 16, 37, 8, 3, 'rgba(0,0,0,0.25)');
    c.fillStyle = '#6b4423';
    c.fillRect(14, 12, 4, 26);
    c.fillStyle = '#a8794a';
    c.fillRect(3, 8, 26, 10);
    c.fillStyle = '#5a3a1e';
    c.fillRect(6, 12, 20, 1);
  });
  canvas(scene, 'bobber', 12, 12, (c) => {
    ellipse(c, 6, 6, 5, 5, '#ff4040');
    c.fillStyle = '#fff';
    c.fillRect(1, 6, 10, 2);
  });
}

// ---------------------------------------------------------------- characters

interface Look {
  skin: string;
  hair: string;
  body: string;
  legs: string;
  weapon?: 'sword' | 'dagger' | 'staff' | 'hammer' | 'rod';
  beard?: string;
  hood?: string;
  hat?: string;
}

function drawCharacter(scene: Phaser.Scene, key: string, look: Look) {
  canvas(scene, key, 40, 48, (c) => {
    const cx = 18;
    // legs
    c.fillStyle = look.legs;
    c.fillRect(cx - 6, 36, 5, 9);
    c.fillRect(cx + 1, 36, 5, 9);
    c.fillStyle = '#3a2a1e';
    c.fillRect(cx - 7, 43, 6, 3);
    c.fillRect(cx + 1, 43, 6, 3);
    // body
    c.fillStyle = look.body;
    c.beginPath();
    c.moveTo(cx - 9, 38);
    c.lineTo(cx - 7, 22);
    c.lineTo(cx + 7, 22);
    c.lineTo(cx + 9, 38);
    c.closePath();
    c.fill();
    c.fillStyle = shade(look.body, -30);
    c.fillRect(cx - 8, 33, 16, 2);
    // arms
    c.fillStyle = look.skin;
    c.fillRect(cx - 11, 25, 3, 9);
    c.fillRect(cx + 8, 25, 3, 9);
    // head
    ellipse(c, cx, 14, 9, 9, look.skin);
    if (look.hood) {
      c.fillStyle = look.hood;
      c.beginPath();
      c.arc(cx, 13, 11, Math.PI, 0);
      c.fill();
      c.fillRect(cx - 11, 13, 4, 10);
      c.fillRect(cx + 7, 13, 4, 10);
    } else {
      c.fillStyle = look.hair;
      c.beginPath();
      c.arc(cx, 11, 9.5, Math.PI, 0);
      c.fill();
      c.fillRect(cx - 9, 10, 4, 7);
      c.fillRect(cx + 3, 6, 6, 4);
    }
    if (look.hat) {
      c.fillStyle = look.hat;
      c.fillRect(cx - 13, 6, 26, 3);
      c.fillRect(cx - 7, 0, 14, 7);
    }
    eyes(c, cx + 1, 15, 4, 1.6);
    if (look.beard) {
      c.fillStyle = look.beard;
      c.beginPath();
      c.moveTo(cx - 7, 17);
      c.lineTo(cx + 7, 17);
      c.lineTo(cx, 28);
      c.closePath();
      c.fill();
    }
    // weapon in right hand
    const hx = cx + 10;
    switch (look.weapon) {
      case 'sword':
        c.fillStyle = '#dfe6ee';
        c.fillRect(hx + 1, 6, 4, 24);
        c.fillStyle = '#9aa6b2';
        c.fillRect(hx + 3, 6, 2, 24);
        c.fillStyle = '#c9a03a';
        c.fillRect(hx - 2, 29, 10, 3);
        c.fillStyle = '#5a3a1e';
        c.fillRect(hx + 2, 32, 2, 5);
        break;
      case 'dagger':
        c.fillStyle = '#e6edf4';
        c.fillRect(hx + 1, 20, 3, 11);
        c.fillStyle = '#7a4f2a';
        c.fillRect(hx - 1, 30, 7, 2);
        c.fillRect(hx + 1, 32, 3, 4);
        break;
      case 'staff':
        c.fillStyle = '#7a5230';
        c.fillRect(hx + 1, 8, 3, 38);
        ellipse(c, hx + 2.5, 7, 4.5, 4.5, '#7fd6ff');
        ellipse(c, hx + 1.5, 6, 1.5, 1.5, '#ffffff');
        break;
      case 'hammer':
        c.fillStyle = '#7a5230';
        c.fillRect(hx + 1, 14, 3, 20);
        c.fillStyle = '#6d747c';
        c.fillRect(hx - 3, 10, 11, 7);
        break;
      case 'rod':
        c.strokeStyle = '#8a6a3a';
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(hx + 2, 34);
        c.lineTo(hx + 4, 2);
        c.stroke();
        break;
    }
  });
}

function drawCharacters(scene: Phaser.Scene) {
  drawCharacter(scene, 'player_sword', { skin: '#f2c9a0', hair: '#6b3d1e', body: '#3d6fd1', legs: '#3b3b54', weapon: 'sword' });
  drawCharacter(scene, 'player_dagger', { skin: '#f2c9a0', hair: '#2b2b2b', body: '#3e6b3a', legs: '#4a3a2a', weapon: 'dagger', hood: '#2f4f2c' });
  drawCharacter(scene, 'player_staff', { skin: '#f2c9a0', hair: '#d9d1c0', body: '#7a4bc4', legs: '#3b2e54', weapon: 'staff', hat: '#4a2f80' });
  drawCharacter(scene, 'npc_blacksmith', { skin: '#d9a77a', hair: '#3a2a1e', body: '#7a5a3a', legs: '#3a3a3a', weapon: 'hammer', beard: '#5a3a1e' });
  drawCharacter(scene, 'npc_priestess', { skin: '#f6d6b8', hair: '#e8d7a0', body: '#f2f2f2', legs: '#d8d8e8', hood: '#ffffff' });
  drawCharacter(scene, 'npc_hermit', { skin: '#e0b896', hair: '#c8c8c8', body: '#6b6b6b', legs: '#4a4a4a', beard: '#e8e8e8', hood: '#5a5a5a' });
  drawCharacter(scene, 'npc_fisher', { skin: '#e8b88f', hair: '#8a5a2a', body: '#2f7f8f', legs: '#3b4b5b', weapon: 'rod', hat: '#c9a03a' });
}

// ---------------------------------------------------------------- monsters

function drawMonsters(scene: Phaser.Scene) {
  canvas(scene, 'mon_jellop', 32, 32, (c) => {
    ellipse(c, 16, 22, 13, 10, '#4fbf5a');
    ellipse(c, 16, 25, 12, 6, '#3fa84a');
    ellipse(c, 11, 17, 4, 3, '#a8f0a8');
    eyes(c, 16, 21, 4);
    c.fillStyle = '#1b1b2a';
    c.fillRect(14, 26, 4, 1);
  });
  canvas(scene, 'mon_puddlewisp', 32, 34, (c) => {
    c.fillStyle = 'rgba(80,170,255,0.9)';
    c.beginPath();
    c.moveTo(16, 2);
    c.quadraticCurveTo(30, 18, 26, 26);
    c.quadraticCurveTo(16, 34, 6, 26);
    c.quadraticCurveTo(2, 18, 16, 2);
    c.fill();
    ellipse(c, 16, 22, 8, 7, 'rgba(170,220,255,0.8)');
    eyes(c, 16, 21, 3.5, 1.8, '#10305a');
  });
  canvas(scene, 'mon_mossling', 32, 32, (c) => {
    ellipse(c, 16, 21, 13, 11, '#7a6a4a');
    ellipse(c, 16, 15, 12, 7, '#4f8a3a');
    ellipse(c, 10, 13, 4, 3, '#6aa84a');
    ellipse(c, 22, 12, 3, 2, '#6aa84a');
    c.fillStyle = '#3f7a2a';
    c.fillRect(15, 4, 2, 6);
    ellipse(c, 19, 5, 4, 2, '#5fb04a');
    eyes(c, 16, 22, 4, 1.8, '#f5f0c0');
  });
  canvas(scene, 'mon_gustling', 32, 32, (c) => {
    ellipse(c, 6, 16, 6, 4, '#e8f2f8');
    ellipse(c, 26, 16, 6, 4, '#e8f2f8');
    ellipse(c, 16, 18, 11, 10, '#f8fbff');
    ellipse(c, 13, 13, 4, 3, '#ffffff');
    eyes(c, 16, 17, 3.5, 1.6);
    c.fillStyle = '#f0a030';
    c.beginPath();
    c.moveTo(14, 21);
    c.lineTo(18, 21);
    c.lineTo(16, 24);
    c.fill();
    c.strokeStyle = '#9be8c8';
    c.lineWidth = 1;
    c.beginPath();
    c.arc(16, 18, 13, 0.2, 1.2);
    c.stroke();
  });
  canvas(scene, 'mon_sparkbug', 32, 32, (c) => {
    c.strokeStyle = '#2b2b2b';
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(12, 9);
    c.lineTo(8, 2);
    c.moveTo(20, 9);
    c.lineTo(24, 2);
    c.stroke();
    ellipse(c, 8, 2, 2, 2, '#ffe14a');
    ellipse(c, 24, 2, 2, 2, '#ffe14a');
    ellipse(c, 16, 19, 11, 10, '#ffd23a');
    c.fillStyle = '#2b2b2b';
    c.fillRect(15, 10, 2, 19);
    c.fillRect(7, 17, 18, 2);
    ellipse(c, 16, 11, 7, 4, '#2b2b2b');
    eyes(c, 16, 11, 3, 1.4, '#ffe14a');
  });
  canvas(scene, 'mon_emberkit', 36, 32, (c) => {
    c.fillStyle = '#ffb030';
    c.beginPath();
    c.moveTo(30, 22);
    c.quadraticCurveTo(36, 10, 30, 4);
    c.quadraticCurveTo(28, 14, 24, 20);
    c.fill();
    ellipse(c, 16, 21, 12, 9, '#ff7a2a');
    c.fillStyle = '#ff7a2a';
    c.beginPath();
    c.moveTo(6, 16);
    c.lineTo(8, 4);
    c.lineTo(13, 13);
    c.moveTo(26, 16);
    c.lineTo(24, 4);
    c.lineTo(19, 13);
    c.fill();
    ellipse(c, 16, 25, 7, 4, '#ffd8a0');
    eyes(c, 16, 19, 4.5, 1.8);
    c.fillStyle = '#1b1b2a';
    c.fillRect(15, 23, 2, 1);
  });
  canvas(scene, 'mon_gloomcap', 32, 36, (c) => {
    ellipse(c, 16, 28, 7, 7, '#e8dcc8');
    eyes(c, 16, 27, 3, 1.6, '#3a1e4a');
    ellipse(c, 16, 15, 15, 10, '#6b3a9a');
    ellipse(c, 16, 19, 14, 4, '#54307a');
    for (const [x, y, r] of [[9, 12, 2.5], [18, 8, 3], [24, 14, 2]] as const) ellipse(c, x, y, r, r, '#d8c0ff');
  });
  canvas(scene, 'mon_thunderhoof', 96, 84, (c) => {
    ellipse(c, 48, 78, 34, 6, 'rgba(0,0,0,0.3)');
    c.fillStyle = '#1e2a4a';
    for (const x of [24, 36, 58, 70]) c.fillRect(x, 54, 9, 24);
    c.fillStyle = '#0f1628';
    for (const x of [24, 36, 58, 70]) c.fillRect(x, 74, 9, 4);
    ellipse(c, 50, 48, 32, 18, '#2a3a66');
    ellipse(c, 50, 42, 26, 10, '#344a80');
    ellipse(c, 20, 34, 14, 12, '#2a3a66');
    // horns
    c.fillStyle = '#ffe14a';
    c.beginPath();
    c.moveTo(12, 26);
    c.lineTo(2, 4);
    c.lineTo(10, 14);
    c.lineTo(8, 2);
    c.lineTo(18, 24);
    c.fill();
    c.beginPath();
    c.moveTo(24, 24);
    c.lineTo(30, 4);
    c.lineTo(30, 14);
    c.lineTo(38, 6);
    c.lineTo(30, 26);
    c.fill();
    eyes(c, 18, 34, 5, 2.4, '#ffe14a');
    // mane sparks
    c.strokeStyle = '#9fd0ff';
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(40, 30);
    c.lineTo(46, 24);
    c.lineTo(50, 30);
    c.lineTo(56, 24);
    c.lineTo(62, 30);
    c.lineTo(68, 26);
    c.stroke();
  });
}

// ---------------------------------------------------------------- fx

function drawFx(scene: Phaser.Scene) {
  canvas(scene, 'fx_dot', 16, 16, (c) => {
    const g = c.createRadialGradient(8, 8, 0, 8, 8, 8);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 16, 16);
  });
  canvas(scene, 'fx_orb', 32, 32, (c) => {
    const g = c.createRadialGradient(16, 16, 0, 16, 16, 16);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(0.35, 'rgba(255,255,255,0.85)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = g;
    c.fillRect(0, 0, 32, 32);
  });
  canvas(scene, 'fx_blade', 32, 10, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, 5);
    c.lineTo(8, 2);
    c.lineTo(30, 4);
    c.lineTo(32, 5);
    c.lineTo(30, 6);
    c.lineTo(8, 8);
    c.closePath();
    c.fill();
    c.fillStyle = '#c9a03a';
    c.fillRect(6, 0, 3, 10);
  });
  canvas(scene, 'fx_knife', 18, 6, (c) => {
    c.fillStyle = '#ffffff';
    c.beginPath();
    c.moveTo(0, 3);
    c.lineTo(5, 1);
    c.lineTo(18, 3);
    c.lineTo(5, 5);
    c.closePath();
    c.fill();
  });
  canvas(scene, 'shadow', 32, 12, (c) => ellipse(c, 16, 6, 15, 5, 'rgba(0,0,0,0.28)'));
  canvas(scene, 'target_ring', 48, 20, (c) => {
    c.strokeStyle = '#ffdd55';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(24, 10, 21, 8, 0, 0, Math.PI * 2);
    c.stroke();
  });
  canvas(scene, 'move_marker', 24, 12, (c) => {
    c.strokeStyle = '#ffffff';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(12, 6, 10, 4, 0, 0, Math.PI * 2);
    c.stroke();
  });
}

export function generateTextures(scene: Phaser.Scene): void {
  drawTiles(scene);
  drawProps(scene);
  drawCharacters(scene);
  drawMonsters(scene);
  drawFx(scene);
}
