// Minimap (docs/CLIENT-v2.md §7) — minimal foundation version: a 112 px circle showing a 20-tile radius around the
// player (terrain from the compiled map, unexplored fog cells dimmed), with monster / NPC / portal / node / object
// dots. Collapsible; tap opens the Map panel. The hud-maps stage polishes it (icons, pings, arena framing).
import { cellExplored, fogBits, fogDims, FOG_CELL } from '../game/world/runtime';
import { T } from '../core/world/tiles';
import { COLL } from '../core/world/types';
import type { GameController } from './controller';

const SIZE = 112;
const RADIUS_TILES = 20;

const GROUND: Record<number, [number, number, number]> = {
  [T.GRASS]: [86, 140, 70],
  [T.GRASS2]: [96, 150, 76],
  [T.FLOWERS]: [104, 150, 84],
  [T.PATH]: [168, 138, 92],
  [T.WATER]: [64, 128, 196],
  [T.SAND]: [212, 192, 132],
  [T.STONE]: [128, 128, 132],
  [T.DARK]: [56, 92, 60],
  [T.COBBLE]: [170, 162, 150],
  [T.BRIDGE]: [150, 110, 70],
  [T.EMBER]: [120, 70, 56],
  [T.HILL]: [112, 156, 84],
  [T.DEEP]: [40, 84, 160],
  [T.CAVE]: [92, 84, 80],
  [T.CRYPT]: [92, 88, 104],
  [T.SNOW]: [226, 232, 240],
  [T.ICE]: [176, 210, 236],
  [T.BASALT]: [70, 64, 70],
  [T.LAVA]: [230, 100, 40],
  [T.DUSK]: [104, 80, 120],
  [T.STORMGRASS]: [90, 120, 110],
  [T.GLADE]: [80, 120, 110],
  [T.MOSS]: [70, 110, 70],
};

export class Minimap {
  readonly el: HTMLElement;
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private base: HTMLCanvasElement | null = null;
  private baseKey = '';
  private collapsed = false;

  constructor(
    parent: HTMLElement,
    private ctrl: GameController,
    onOpen: () => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'minimap';
    this.el.innerHTML = `<button class="mm-face" aria-label="Open map"><canvas width="${SIZE * 2}" height="${SIZE * 2}"></canvas></button>
      <button class="mm-toggle" aria-label="Collapse minimap">–</button>`;
    parent.appendChild(this.el);
    this.canvas = this.el.querySelector('canvas')!;
    this.ctx = this.canvas.getContext('2d')!;
    this.el.querySelector('.mm-face')!.addEventListener('click', onOpen);
    const toggle = this.el.querySelector<HTMLButtonElement>('.mm-toggle')!;
    toggle.addEventListener('click', () => {
      this.collapsed = !this.collapsed;
      this.el.classList.toggle('collapsed', this.collapsed);
      toggle.textContent = this.collapsed ? '+' : '–';
      toggle.setAttribute('aria-label', this.collapsed ? 'Expand minimap' : 'Collapse minimap');
      if (!this.collapsed) this.update();
    });
  }

  /** New map: drop the cached terrain. */
  setMap(): void {
    this.base = null;
    this.baseKey = '';
    this.update();
  }

  private terrain(): HTMLCanvasElement {
    const { def, compiled: cm } = this.ctrl.map();
    const fog = this.ctrl.world().fog[def.id] ?? '';
    const key = `${def.id}|${fog}`;
    if (this.base && key === this.baseKey) return this.base;
    this.baseKey = key;
    const c = this.base ?? document.createElement('canvas');
    c.width = cm.w;
    c.height = cm.h;
    const g = c.getContext('2d')!;
    const img = g.createImageData(cm.w, cm.h);
    const bits = fogBits(this.ctrl.world(), def.id, cm);
    const { cw } = fogDims(cm);
    for (let y = 0; y < cm.h; y++) {
      for (let x = 0; x < cm.w; x++) {
        const i = y * cm.w + x;
        const coll = cm.coll[i];
        let rgb = GROUND[cm.ground[i]] ?? [40, 40, 48];
        if (coll & COLL.BLOCK && !(coll & COLL.WATER)) rgb = [rgb[0] * 0.45, rgb[1] * 0.45, rgb[2] * 0.45];
        if (coll & COLL.PORTAL) rgb = [255, 215, 106];
        const seen = cellExplored(bits, cw, Math.floor(x / FOG_CELL), Math.floor(y / FOG_CELL));
        const k = seen ? 1 : 0.18;
        img.data.set([rgb[0] * k, rgb[1] * k, rgb[2] * k, 255], i * 4);
      }
    }
    g.putImageData(img, 0, 0);
    this.base = c;
    return c;
  }

  update(): void {
    if (this.collapsed || !this.el.isConnected) return;
    let view;
    try {
      view = this.ctrl.minimap();
    } catch {
      return;
    }
    const g = this.ctx;
    const S = SIZE * 2;
    const scale = S / (RADIUS_TILES * 2);
    const ptx = view.px / 32;
    const pty = view.py / 32;
    g.save();
    g.clearRect(0, 0, S, S);
    g.fillStyle = '#0c1220';
    g.fillRect(0, 0, S, S);
    g.imageSmoothingEnabled = false;
    g.drawImage(this.terrain(), (-ptx + RADIUS_TILES) * scale, (-pty + RADIUS_TILES) * scale, this.base!.width * scale, this.base!.height * scale);
    const dot = (x: number, y: number, r: number, color: string) => {
      const dx = (x / 32 - ptx + RADIUS_TILES) * scale;
      const dy = (y / 32 - pty + RADIUS_TILES) * scale;
      if (dx < -r || dy < -r || dx > S + r || dy > S + r) return;
      g.fillStyle = color;
      g.beginPath();
      g.arc(dx, dy, r, 0, Math.PI * 2);
      g.fill();
    };
    for (const o of view.objects) dot(o.x, o.y, 4, o.kind === 'waystone' ? '#7ff0ff' : o.kind === 'altar' ? '#c9a0ff' : '#d8e0f0');
    for (const n of view.nodes) if (n.ready) dot(n.x, n.y, 3, '#9fe870');
    for (const p of view.portals) dot(p.x, p.y, 5, p.open ? '#ffd76a' : '#8a8f9e');
    for (const n of view.npcs) dot(n.x, n.y, 4, '#ffe9a0');
    for (const m of view.monsters) dot(m.x, m.y, m.rank === 'warden' ? 6 : m.rank === 'elite' ? 4.5 : 3, m.rank === 'warden' ? '#ff4d9d' : m.rank === 'elite' ? '#ff9a3a' : '#ff5a5a');
    g.fillStyle = '#ffffff';
    g.strokeStyle = '#1a2244';
    g.lineWidth = 2;
    g.beginPath();
    g.arc(S / 2, S / 2, 5, 0, Math.PI * 2);
    g.fill();
    g.stroke();
    g.restore();
  }
}
