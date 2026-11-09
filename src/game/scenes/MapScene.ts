// MapScene (docs/CLIENT-v2.md §3-§5, §7): one scene for every map. Changing maps restarts it with
// `{ session, ui, mapId, arrive }`; init() resets every per-map field, create() builds the map from the cached
// CompiledMap, and every external listener goes through a disposer list run on SHUTDOWN. The same instance is the
// UI's GameController for the whole run.
import Phaser from 'phaser';
import type { Registry } from '../../core/registry';
import type { FuseResult, SkillBook } from '../../core/skillbook';
import type { SkillDef, WeaponType } from '../../core/types';
import { STRUCTURE_FOOTPRINT, isBlockedPx } from '../../core/world/compile';
import { findPath } from '../../core/world/pathfinding';
import { COLL, type CompiledMap, type MapDef, type PortalDef } from '../../core/world/types';
import { NPCS } from '../../data/npcs';
import { WEAPONS } from '../../data/weapons';
import { mapById } from '../../data/world';
import type { GameController, MinimapView, Outcome, TravelTargetView } from '../../ui/controller';
import type { UI } from '../../ui/ui';
import { bandText, esc, hex, sourceText } from '../../ui/util';
import { Player } from '../entities/Player';
import { PRISM_GATE_SIZE, PRISM_SOCKETS, TILE_MARGIN, TILE_SPACING } from '../textures';
import { START_MAP, Session, type Stats, computeStats } from '../session';
import { Combat } from '../systems/Combat';
import { Interactions, type NodeView, type NpcView, type ObjectView, type PortalView } from '../systems/Interactions';
import { MonsterSkills } from '../systems/MonsterSkills';
import { SkillSystem } from '../systems/SkillSystem';
import {
  TILE,
  addOnce,
  compiled,
  discoveredRoute,
  distToRect,
  gateOpen,
  gateSockets,
  isRevealed,
  markFog,
  nodeReady,
  objectKey,
  portalKey,
  portalOpen,
  regionOf,
  revealMatches,
  travelTargets,
} from '../world/runtime';
import { statPct } from '../../core/passives';

export type Arrival = string | { waystone: string };

export interface MapSceneData {
  session: Session;
  ui: UI;
  mapId?: string;
  /** Portal id in the destination map, a waystone, or undefined (saved x/y, else the map spawn). */
  arrive?: Arrival;
}

/** Prop culling chunk size in tiles. */
const CHUNK = 16;
const DECAL_DEPTH = -60000;
const SPAWN_PROTECT_MS = 2000;
const SOCKET_GREY = 0x4a4f5e;

const OBJECT_LABELS: Partial<Record<string, string>> = {
  waystone: 'Waystone',
  altar: 'Fusion Altar',
  wind_shrine: 'Shrine of Winds',
  obelisk: 'Umbral Obelisk',
  campfire: 'Campfire',
};

const NPC_BY_ID = new Map(NPCS.map((n) => [n.id, n]));

export class MapScene extends Phaser.Scene implements GameController {
  session!: Session;
  reg!: Registry;
  book!: SkillBook;
  ui!: UI;
  mapId = START_MAP;
  def!: MapDef;
  /** Runtime collision copy: closed gates and unrevealed hidden portals are blocked. */
  cm!: CompiledMap;
  private base!: CompiledMap;
  player!: Player;
  combat!: Combat;
  skills!: SkillSystem;
  monsterSkills!: MonsterSkills;
  interactions!: Interactions;
  targetRing!: Phaser.GameObjects.Image;
  private moveMarker!: Phaser.GameObjects.Image;
  npcs: NpcView[] = [];
  objects: ObjectView[] = [];
  nodes: NodeView[] = [];
  portals: PortalView[] = [];
  private chunks: Phaser.GameObjects.Image[][] = [];
  private chunkCols = 0;
  private chunkWin = '';
  private liveChunks = new Set<number>();
  /** Props currently visible (perf budget ≤ 250 on phones). */
  visibleProps = 0;
  private dark: Phaser.GameObjects.Image | null = null;
  private disposers: (() => void)[] = [];
  private warping = false;
  private arrive: Arrival | undefined;
  private hotbarDirty = false;
  private uiT = 0;
  private fogT = 0;
  private saveT = 0;
  private nodeT = 0;
  private frozenUntil = 0;
  private floatPool: Phaser.GameObjects.Text[] = [];
  private tilemap: Phaser.Tilemaps.Tilemap | null = null;

  constructor() {
    super('Map');
  }

  /** Attaches the session before the first start so the UI can read it immediately. */
  bind(session: Session): void {
    this.session = session;
    this.reg = session.reg;
    this.book = session.book;
  }

  // =================================================================== lifecycle

  init(data: MapSceneData): void {
    this.bind(data.session);
    this.ui = data.ui;
    const want = data.mapId ?? data.session.world.mapId;
    this.mapId = mapById(want) ? want : START_MAP;
    this.arrive = data.arrive;
    this.npcs = [];
    this.objects = [];
    this.nodes = [];
    this.portals = [];
    this.chunks = [];
    this.chunkCols = 0;
    this.chunkWin = '';
    this.liveChunks = new Set();
    this.visibleProps = 0;
    this.dark = null;
    this.disposers = [];
    this.warping = false;
    this.hotbarDirty = false;
    this.uiT = this.fogT = this.saveT = this.nodeT = 0;
    this.frozenUntil = 0;
    this.floatPool = [];
    this.tilemap = null;
    this.combat = new Combat(this);
    this.skills = new SkillSystem(this.combat);
    this.monsterSkills = new MonsterSkills(this);
    this.interactions = new Interactions(this);
  }

  create(): void {
    const s = this.session;
    this.def = mapById(this.mapId)!;
    this.base = compiled(this.mapId);
    this.cm = { ...this.base, coll: new Uint8Array(this.base.coll) };
    const cave = ['cave', 'crypt'].includes(this.def.biome);
    this.cameras.main.setBackgroundColor(cave ? '#0b0d14' : '#16261a');

    this.buildGround();
    this.buildProps();
    this.buildStructures();
    this.buildObjects();
    this.buildNodes();
    this.buildNpcs();
    this.buildPortals();
    this.applyPortalBlocks();
    if (this.def.flags?.includes('dark')) this.dark = this.add.image(0, 0, this.darkTexture()).setDepth(150000).setScale(6);

    const start = this.arrivalPoint();
    this.player = new Player(this, start.x, start.y, s.player.name, s.player.weapon);
    s.world.mapId = this.mapId;
    s.world.x = start.x;
    s.world.y = start.y;
    this.targetRing = this.add.image(0, 0, 'target_ring').setVisible(false);
    this.moveMarker = this.add.image(0, 0, 'move_marker').setVisible(false).setDepth(-50000);

    this.combat.spawn();
    this.combat.protectUntil = this.time.now + SPAWN_PROTECT_MS;
    this.combat.lastInput = this.time.now;

    const cam = this.cameras.main;
    cam.startFollow(this.player.sprite, true, 0.12, 0.12);
    this.fitCamera();
    cam.centerOn(start.x, start.y);
    this.listen(this.scale, 'resize', () => this.fitCamera());

    const onDown = (ptr: Phaser.Input.Pointer) => {
      const wp = ptr.positionToCamera(cam) as Phaser.Math.Vector2;
      this.handleTap(wp.x, wp.y);
    };
    this.input.on('pointerdown', onDown);
    this.disposers.push(() => this.input.off('pointerdown', onDown));
    const kb = this.input.keyboard;
    if (kb) {
      const onKey = (e: KeyboardEvent) => this.handleKey(e);
      kb.on('keydown', onKey);
      this.disposers.push(() => kb.off('keydown', onKey));
    }

    this.wireEvents();
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    this.enterMap();
    this.ui.mapChanged();
    cam.fadeIn(220);

    if (!this.book.flag('intro')) {
      this.book.incFlag('intro');
      const w = WEAPONS[s.player.weapon];
      const basic = this.reg.skill(w.basic)!;
      this.time.delayedCall(350, () =>
        this.ui.dialog(
          'Mirelle, Waykeeper',
          '🧭',
          `Welcome to Hearthvale, ${esc(s.player.name)}. You carry ${/^[aeiou]/i.test(w.name) ? 'an' : 'a'} <b>${w.name}</b> and know only <b>${basic.name}</b>.<br><br>
          Tap the ground to walk. Tap a monster to fight it — every strike trains <b>${basic.name}</b>.
          Master it and it will <b>morph</b> into something new.<br><br>
          Elements hide in ordinary work: Brann's forge, the lake, the quarry, the hills. Find them, then <b>fuse</b> them at the altar.
          Touch the waystone here so the vale remembers you.`,
          [{ label: 'Begin' }],
        ),
      );
    } else if (!s.greeted) {
      this.ui.log(`Welcome back, <b>${esc(s.player.name)}</b>.`, 'good');
    }
    s.greeted = true;
    if (s.nav) this.time.delayedCall(350, () => this.navStep());
    if (this.ui.isOpen) this.setPaused(true);
    this.save();
  }

  /** Registers an external listener that is removed on SHUTDOWN. */
  private listen(target: Phaser.Events.EventEmitter, event: string, fn: (...args: never[]) => void): void {
    target.on(event, fn);
    this.disposers.push(() => target.off(event, fn));
  }

  private shutdown(): void {
    for (const d of this.disposers.splice(0)) d();
    this.monsterSkills.clear();
    this.skills.clear();
    this.combat.clear();
    this.tilemap?.destroy();
    this.tilemap = null;
    this.time.timeScale = 1;
    this.tweens.timeScale = 1;
  }

  private fitCamera(): void {
    const cam = this.cameras.main;
    const { width, height } = this.scale;
    let zoom = Phaser.Math.Clamp(Math.min(width, height) / 380, 1, 1.7);
    const mw = this.cm.w * TILE;
    const mh = this.cm.h * TILE;
    if (this.def.kind === 'arena') zoom = Math.max(0.8, Math.min(zoom, height / mh));
    cam.setZoom(zoom);
    // Maps smaller than the view are centred instead of pinned to the top-left.
    const vw = width / zoom;
    const vh = height / zoom;
    const bx = mw < vw ? (mw - vw) / 2 : 0;
    const by = mh < vh ? (mh - vh) / 2 : 0;
    cam.setBounds(bx, by, Math.max(mw, vw), Math.max(mh, vh));
    this.chunkWin = '';
  }

  // =================================================================== building

  /** Soft radial darkness for 'dark' maps (a light hole around the player), generated once per game. */
  private darkTexture(): string {
    const key = 'fx_darkness';
    if (this.textures.exists(key)) return key;
    const tex = this.textures.createCanvas(key, 256, 256);
    if (!tex) return key;
    const g = tex.getContext();
    // Drawn at 6× scale: clear within ~110 px of the player, ~0.6 dark by ~330 px, 0.78 at the 768 px rim.
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(4,6,14,0)');
    grad.addColorStop(0.14, 'rgba(4,6,14,0)');
    grad.addColorStop(0.26, 'rgba(4,6,14,0.35)');
    grad.addColorStop(0.43, 'rgba(4,6,14,0.62)');
    grad.addColorStop(1, 'rgba(4,6,14,0.8)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    tex.refresh();
    return key;
  }

  private buildGround(): void {
    const { w, h, ground } = this.cm;
    const data: number[][] = [];
    for (let y = 0; y < h; y++) data.push(Array.from(ground.subarray(y * w, (y + 1) * w)));
    const tm = this.make.tilemap({ data, tileWidth: TILE, tileHeight: TILE });
    const ts = tm.addTilesetImage('tiles', 'tiles', TILE, TILE, TILE_MARGIN, TILE_SPACING)!;
    tm.createLayer(0, ts, 0, 0)!.setDepth(-100000);
    this.tilemap = tm;
  }

  private buildProps(): void {
    const cols = Math.ceil(this.cm.w / CHUNK);
    const rows = Math.ceil(this.cm.h / CHUNK);
    this.chunkCols = cols;
    this.chunks = Array.from({ length: cols * rows }, () => []);
    for (const pr of this.cm.props) {
      if (!this.textures.exists(pr.kind)) continue;
      const x = pr.tx * TILE + TILE / 2;
      const y = (pr.ty + 1) * TILE;
      const img = this.add.image(x, y, pr.kind).setOrigin(0.5, 1).setDepth(y - 4).setVisible(false);
      this.chunks[Math.floor(pr.ty / CHUNK) * cols + Math.floor(pr.tx / CHUNK)].push(img);
    }
  }

  /**
   * Prop culling: props are indexed in 16×16-tile chunks; only chunks touching the camera view are scanned and
   * only props whose sprite can overlap the view stay visible (tall props reach ~3 tiles above their base).
   * Runs only when the view moves by a tile.
   */
  private cullProps(): void {
    const v = this.cameras.main.worldView;
    const left = v.x - TILE;
    const right = v.right + TILE;
    const top = v.y - TILE;
    const bottom = v.bottom + TILE * 3;
    const key = `${Math.floor(left / TILE)},${Math.floor(top / TILE)},${Math.ceil(right / TILE)},${Math.ceil(bottom / TILE)}`;
    if (key === this.chunkWin) return;
    this.chunkWin = key;
    const span = CHUNK * TILE;
    const rows = this.chunks.length / Math.max(1, this.chunkCols);
    const cx0 = Math.max(0, Math.floor(left / span));
    const cx1 = Math.min(this.chunkCols - 1, Math.floor(right / span));
    const cy0 = Math.max(0, Math.floor(top / span));
    const cy1 = Math.min(rows - 1, Math.floor(bottom / span));
    const next = new Set<number>();
    let shown = 0;
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const ci = cy * this.chunkCols + cx;
        next.add(ci);
        for (const img of this.chunks[ci]) {
          const on = img.x >= left && img.x <= right && img.y >= top && img.y <= bottom;
          if (img.visible !== on) img.setVisible(on);
          if (on) shown++;
        }
      }
    }
    for (const ci of this.liveChunks) {
      if (next.has(ci)) continue;
      for (const img of this.chunks[ci]) if (img.visible) img.setVisible(false);
    }
    this.liveChunks = next;
    this.visibleProps = shown;
  }

  private buildStructures(): void {
    for (const st of this.def.structures ?? []) {
      const fp = STRUCTURE_FOOTPRINT[st.kind];
      const key = `struct_${st.kind}`;
      if (!fp || !this.textures.exists(key)) continue;
      const x = (st.tx + fp.w / 2) * TILE;
      const y = (st.ty + fp.h) * TILE;
      this.add.image(x, y + 4, key).setOrigin(0.5, 1).setDepth(y);
    }
  }

  private label(x: number, y: number, text: string, color: string, size = 10): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, text, {
        fontFamily: 'system-ui, sans-serif',
        fontSize: `${size}px`,
        color,
        stroke: '#000',
        strokeThickness: 3,
        align: 'center',
      })
      .setOrigin(0.5, 1)
      .setResolution(2)
      .setDepth(100000);
  }

  private buildObjects(): void {
    const world = this.session.world;
    for (const def of this.def.objects ?? []) {
      const x = def.tx * TILE + TILE / 2;
      const y = def.ty * TILE + TILE - 4;
      const key = objectKey(this.mapId, def.id);
      let tex = `obj_${def.kind}`;
      if (def.kind === 'waystone' && world.waystones.includes(key)) tex = 'obj_waystone_lit';
      if (def.kind === 'chest' && world.chests.includes(key)) tex = 'obj_chest_open';
      const sprite = this.add.image(x, y, this.textures.exists(tex) ? tex : 'obj_signpost').setOrigin(0.5, 1).setDepth(y);
      const name = OBJECT_LABELS[def.kind];
      const label = name ? this.label(x, y - sprite.displayHeight - 2, name, '#d8f0ff') : null;
      this.objects.push({ kind: 'object', def, x, y: def.ty * TILE + TILE / 2, sprite, label });
    }
  }

  /** Re-textures waystones after attuning from elsewhere (waykeeper, campfire). */
  refreshObjects(): void {
    const world = this.session.world;
    for (const o of this.objects) {
      if (o.def.kind === 'waystone' && world.waystones.includes(objectKey(this.mapId, o.def.id))) o.sprite.setTexture('obj_waystone_lit');
    }
  }

  private buildNodes(): void {
    for (const def of this.def.nodes ?? []) {
      const x = def.tx * TILE + TILE / 2;
      const cy = def.ty * TILE + TILE / 2;
      let sprite: Phaser.GameObjects.Image;
      let bobber: Phaser.GameObjects.Image | null = null;
      if (def.kind === 'fishing') {
        sprite = this.add.image(x, cy, 'node_fishing').setDepth(DECAL_DEPTH);
        bobber = this.add.image(x + 4, cy - 6, 'bobber').setDepth(cy);
      } else {
        const y = def.ty * TILE + TILE - 4;
        sprite = this.add.image(x, y, `node_${def.kind}`).setOrigin(0.5, 1).setDepth(y);
      }
      const v: NodeView = { kind: 'node', def, x, y: cy, sprite, bobber, ready: true };
      this.nodes.push(v);
      this.applyNode(v, nodeReady(this.session.world, this.mapId, def.id));
    }
  }

  private applyNode(v: NodeView, ready: boolean): void {
    if (v.ready === ready && v.sprite.getData('init')) return;
    v.sprite.setData('init', true);
    v.ready = ready;
    if (v.def.kind === 'fishing') {
      v.sprite.setAlpha(ready ? 1 : 0.45);
      if (v.bobber) {
        this.tweens.killTweensOf(v.bobber);
        v.bobber.setVisible(ready).setY(v.y - 6);
        if (ready) this.tweens.add({ targets: v.bobber, y: v.y - 3, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
      }
    } else v.sprite.setTexture(ready ? `node_${v.def.kind}` : 'node_depleted');
  }

  refreshNodes(): void {
    const now = Date.now();
    for (const v of this.nodes) this.applyNode(v, nodeReady(this.session.world, this.mapId, v.def.id, now));
  }

  private buildNpcs(): void {
    for (const place of this.def.npcs ?? []) {
      const def = NPC_BY_ID.get(place.npc);
      if (!def) continue;
      const x = place.tx * TILE + TILE / 2;
      const y = place.ty * TILE + TILE - 6;
      this.add.image(x, y, 'shadow').setDepth(y - 1000);
      const sprite = this.add.image(x, y + 2, this.textures.exists(def.texture) ? def.texture : 'npc_hermit').setOrigin(0.5, 1).setDepth(y);
      const label = this.label(x, y - sprite.displayHeight - 2, `${def.name}\n${def.title}`, '#ffe9a0');
      label.setLineSpacing(-2);
      this.tweens.add({ targets: sprite, scaleY: 1.03, yoyo: true, repeat: -1, duration: 1100 + Math.random() * 300, ease: 'Sine.inOut' });
      this.npcs.push({ kind: 'npc', def, x, y: place.ty * TILE + TILE / 2, sprite, label });
    }
  }

  // ------------------------------------------------------------------- portals

  private buildPortals(): void {
    for (const def of this.def.portals) {
      const v: PortalView = {
        kind: 'portal',
        def,
        x: (def.tx + def.w / 2) * TILE,
        y: (def.ty + def.h / 2) * TILE,
        open: false,
        overlay: null,
        parts: [],
        label: null,
      };
      this.portals.push(v);
      this.drawPortal(v);
    }
  }

  portalIsRevealed(p: PortalDef): boolean {
    return isRevealed(this.session.world, this.mapId, p);
  }

  private drawPortal(v: PortalView): void {
    for (const o of v.parts) o.destroy();
    v.parts = [];
    v.overlay?.destroy();
    v.overlay = null;
    v.label = null;
    const p = v.def;
    v.open = portalOpen(this.session.world, this.book, this.mapId, p);
    const x0 = p.tx * TILE;
    const y0 = p.ty * TILE;
    const w = p.w * TILE;
    const h = p.h * TILE;
    const cx = x0 + w / 2;
    const cy = y0 + h / 2;
    if (p.reveal && !this.portalIsRevealed(p)) {
      const look = p.reveal.look;
      const tex = look === 'rift' ? 'hide_shimmer' : `hide_${look}`;
      const decal = look === 'shimmer' || look === 'fog' || look === 'glyph' || look === 'rift';
      const img = decal
        ? this.add.image(cx, cy, this.textures.exists(tex) ? tex : 'hide_shimmer').setDepth(DECAL_DEPTH + 10)
        : this.add.image(cx, y0 + h, this.textures.exists(tex) ? tex : 'hide_shimmer').setOrigin(0.5, 1).setDepth(y0 + h);
      if (look === 'rift') img.setTint(0xb070ff);
      if (look === 'shimmer' || look === 'rift') img.setAlpha(0);
      v.overlay = img;
      return;
    }
    const border = p.tx <= 0 || p.ty <= 0 || p.tx + p.w >= this.cm.w || p.ty + p.h >= this.cm.h;
    const style = p.kind === 'hidden' ? (border ? 'edge' : 'door') : p.kind;
    const dest = mapById(p.to.map);
    const band = dest ? bandText(dest) : '';
    let text = p.label ?? `To ${dest?.name ?? '???'}${band ? ` (${band})` : ''}`;
    if (p.gate && !v.open) text = `🔒 ${text}`;
    let lx = cx;
    let ly = y0 - 4;
    let ox = 0.5;
    let oy = 1;

    if (p.gate) {
      const gx = Phaser.Math.Clamp(cx, PRISM_GATE_SIZE.w / 2, this.cm.w * TILE - PRISM_GATE_SIZE.w / 2);
      const gy = y0 + h;
      const gate = this.add.image(gx, gy, 'gate_prism').setOrigin(0.5, 1).setDepth(gy);
      v.parts.push(gate);
      const sockets = gateSockets(this.book, p.gate);
      gate.setData('sockets', JSON.stringify(sockets));
      const first = Math.floor((PRISM_SOCKETS.length - sockets.length) / 2);
      sockets.forEach((sk, i) => {
        const at = PRISM_SOCKETS[first + i];
        if (!at) return;
        const gem = this.add
          .image(gx - PRISM_GATE_SIZE.w / 2 + at[0], gy - PRISM_GATE_SIZE.h + at[1], 'gate_socket')
          .setDepth(gy + 1)
          .setTint(sk.color ?? SOCKET_GREY)
          .setAlpha(sk.color === null ? (sk.need ? 0.9 : 0.5) : 1);
        v.parts.push(gem);
        if (sk.color !== null) {
          const glow = this.add.image(gem.x, gem.y, 'fx_dot').setTint(sk.color).setBlendMode(Phaser.BlendModes.ADD).setDepth(gy + 2);
          this.tweens.add({ targets: glow, alpha: { from: 0.9, to: 0.35 }, yoyo: true, repeat: -1, duration: 900 + i * 60 });
          v.parts.push(glow);
        }
      });
      if (v.open) {
        const orb = this.add
          .image(gx, gy - PRISM_GATE_SIZE.h * 0.42, 'fx_orb')
          .setTint(0xbfe8ff)
          .setScale(2.2, 3)
          .setBlendMode(Phaser.BlendModes.ADD)
          .setDepth(gy - 1);
        this.tweens.add({ targets: orb, alpha: { from: 0.75, to: 0.3 }, yoyo: true, repeat: -1, duration: 1200 });
        v.parts.push(orb);
      }
      lx = gx;
      ly = gy - PRISM_GATE_SIZE.h - 4;
    }

    if (style === 'edge' && (!p.gate || v.open)) {
      const angle = { n: 0, e: 90, s: 180, w: 270 }[p.facing];
      const horizontal = p.facing === 'n' || p.facing === 's';
      const span = horizontal ? p.w : p.h;
      const n = Math.max(1, Math.round(span / 2));
      for (let i = 0; i < n; i++) {
        const t = (i + 0.5) / n;
        const x = horizontal ? x0 + w * t : cx;
        const y = horizontal ? cy : y0 + h * t;
        const chev = this.add.image(x, y, 'portal_edge').setAngle(angle).setTint(0xffd76a).setDepth(DECAL_DEPTH + 5);
        this.tweens.add({ targets: chev, alpha: { from: 1, to: 0.45 }, yoyo: true, repeat: -1, duration: 800, delay: i * 120 });
        v.parts.push(chev);
      }
      if (!p.gate) {
        // Beside the chevrons, clear of the arrival tile (2 tiles inward from the rect centre).
        if (p.facing === 'n') [lx, ly, ox, oy] = [x0 + w + 4, cy, 0, 0.5];
        else if (p.facing === 's') [lx, ly, ox, oy] = [x0 + w + 4, cy, 0, 0.5];
        else if (p.facing === 'e') [lx, ly, ox, oy] = [x0 + w, y0 - 4, 1, 1];
        else [lx, ly, ox, oy] = [x0, y0 - 4, 0, 1];
      }
    } else if (style === 'door' && !p.gate) {
      const door = this.add.image(cx, y0 + h, 'portal_door').setOrigin(0.5, 1).setDepth(y0 + h - 2);
      v.parts.push(door);
      ly = y0 + h - door.displayHeight - 2;
    } else if (style === 'stairs') {
      if (p.id === 'up' || p.id === 'ladder') {
        const st = this.add.image(cx, y0 + h, 'portal_stairs_up').setOrigin(0.5, 1).setDepth(y0 + h - 2);
        v.parts.push(st);
        ly = y0 + h - st.displayHeight - 2;
      } else {
        v.parts.push(this.add.image(cx, cy, 'portal_stairs_down').setDepth(DECAL_DEPTH + 5));
        ly = y0 - 2;
      }
    }
    const label = this.label(lx, ly, text, p.gate && !v.open ? '#ffb0a0' : '#ffe9a0').setOrigin(ox, oy);
    v.label = label;
    v.parts.push(label);
  }

  /** Closed portals block movement (they are blocked targets until open). */
  private applyPortalBlocks(): void {
    const { w } = this.cm;
    for (const v of this.portals) {
      const p = v.def;
      for (let y = p.ty; y < p.ty + p.h; y++) {
        for (let x = p.tx; x < p.tx + p.w; x++) {
          if (x < 0 || y < 0 || x >= w || y >= this.cm.h) continue;
          const i = y * w + x;
          this.cm.coll[i] = v.open ? this.base.coll[i] : this.base.coll[i] | COLL.BLOCK;
        }
      }
    }
  }

  /** Re-evaluates gates / reveals (after elements, wardens, reveals) and redraws changed portals. */
  refreshPortals(): void {
    let changed = false;
    for (const v of this.portals) {
      const open = portalOpen(this.session.world, this.book, this.mapId, v.def);
      const sockets = v.def.gate ? JSON.stringify(gateSockets(this.book, v.def.gate)) : '';
      if (open !== v.open || (v.def.gate && sockets !== v.parts[0]?.getData('sockets'))) {
        this.drawPortal(v);
        changed = true;
      }
      if (v.open && (!v.def.reveal || this.portalIsRevealed(v.def))) addOnce(this.session.world.seenPortals, portalKey(this.mapId, v.def.id));
    }
    if (changed) this.applyPortalBlocks();
  }

  // =================================================================== arrival & map entry

  private standable(tx: number, ty: number): boolean {
    if (tx < 0 || ty < 0 || tx >= this.cm.w || ty >= this.cm.h) return false;
    return (this.cm.coll[ty * this.cm.w + tx] & (COLL.BLOCK | COLL.PORTAL)) === 0;
  }

  private arrivalPoint(): { x: number; y: number } {
    const a = this.arrive;
    const world = this.session.world;
    if (typeof a === 'string' && this.base.arrivals[a]) return this.base.arrivals[a];
    if (a && typeof a === 'object') {
      const o = this.def.objects?.find((x) => x.id === a.waystone);
      if (o) {
        for (const [dx, dy] of [
          [0, 1],
          [1, 1],
          [-1, 1],
          [1, 0],
          [-1, 0],
          [0, 2],
          [0, -1],
        ]) {
          if (this.standable(o.tx + dx, o.ty + dy)) return { x: (o.tx + dx) * TILE + TILE / 2, y: (o.ty + dy) * TILE + TILE / 2 };
        }
      }
    }
    if (!a && world.mapId === this.mapId && world.x >= 0 && world.y >= 0) {
      if (this.standable(Math.floor(world.x / TILE), Math.floor(world.y / TILE))) return { x: world.x, y: world.y };
    }
    return this.base.spawn;
  }

  private enterMap(): void {
    const world = this.session.world;
    const first = addOnce(world.visited, this.mapId);
    const vf = `visited:${this.mapId}`;
    if (this.book.flag(vf) < 1) this.book.incFlag(vf);
    for (const v of this.portals) {
      if (!v.def.reveal || this.portalIsRevealed(v.def)) addOnce(world.seenPortals, portalKey(this.mapId, v.def.id));
    }
    markFog(world, this.mapId, this.cm, this.player.x, this.player.y);
    const band = bandText(this.def);
    this.ui.banner(this.def.name, band || (this.def.safety === 'safe' ? 'Safe haven' : ''));
    if (first) this.ui.log(`🗺️ Discovered <b>${esc(this.def.name)}</b>.`, 'info');
  }

  // =================================================================== events

  private wireEvents(): void {
    const ev = this.book.events;
    const ui = this.ui;
    const reg = this.reg;
    const add = (off: () => void) => this.disposers.push(off);
    add(
      ev.on('learned', ({ skill, source }) => {
        this.session.autoSlot(skill.id);
        this.combat.invalidateSparks();
        this.hotbarDirty = true;
        const origin = sourceText(source, reg);
        ui.log(`📖 Learned <b>${esc(skill.name)}</b> <small>(${esc(origin)})</small>`, 'rare');
        if (!source.startsWith('spark:') && source !== 'debug') {
          const el = skill.element ? reg.element(skill.element) : undefined;
          ui.discovery({
            icon: skill.icon,
            kicker: source.startsWith('class:')
              ? 'SIGNATURE SKILL'
              : source.startsWith('echo:')
                ? 'ECHO LEARNED'
                : source.startsWith('lesson:')
                  ? 'TECHNIQUE LEARNED'
                  : skill.generated
                    ? 'NEW INFUSION'
                    : 'NEW SKILL',
            title: skill.name,
            body: `${esc(skill.desc)}<br><small>${esc(origin)}</small>`,
            accent: el ? hex(el.color) : undefined,
          });
        }
        this.save();
      }),
    );
    add(
      ev.on('element', ({ element, source }) => {
        ui.log(`${element.icon} Attuned to <b>${element.name}</b>!`, 'rare');
        ui.discovery({
          icon: element.icon,
          kicker: 'ELEMENT ATTUNED',
          title: element.name,
          body: `${esc(element.desc)}<br><small>${esc(sourceText(source, reg))}</small><br><br>Combine it with a skill at a <b>⚗️ Fusion Altar</b>.`,
          accent: hex(element.color),
        });
        this.refreshPortals();
        this.save();
      }),
    );
    add(
      ev.on('rankUp', ({ skill, rank }) => {
        this.floatText(this.player.x, this.player.y - 50, `${skill.icon} ${skill.name} R${rank}`, '#9fe0ff', 13);
        ui.log(`⬆ <b>${esc(skill.name)}</b> reached rank ${rank}.`, 'good');
        this.hotbarDirty = true;
      }),
    );
    add(
      ev.on('mastered', ({ skill }) => {
        const opts = this.book.morphOptions(skill.id);
        const avail = opts.filter((o) => o.available && !o.owned).length;
        ui.discovery({
          icon: skill.icon,
          kicker: '★ MASTERED',
          title: skill.name,
          body: opts.length
            ? `${avail} form${avail === 1 ? '' : 's'} ready to morph${opts.length > avail ? `, ${opts.length - avail} still sealed` : ''}.
               Open <b>📖 Skills</b> to morph it — you keep ${esc(skill.name)}.`
            : 'Its future lies in fusion. Keep training it: overmastery opens a second essence slot.',
        });
      }),
    );
    add(
      ev.on('charge', ({ skill, charges }) => {
        this.hotbarDirty = true;
        if (charges > 1) ui.toast(`✨ ${esc(skill.name)}: another morph charge (${charges})`);
      }),
    );
    add(
      ev.on('classDiscovered', ({ cls, worn }) => {
        ui.log(`🏛️ Class discovered: <b>${esc(cls.name)}</b>`, 'rare');
        ui.discovery({
          icon: cls.icon,
          kicker: 'CLASS DISCOVERED',
          title: cls.name,
          body: `${esc(cls.desc)}<br><small>${worn ? 'You now wear it.' : 'Wear it from 🏛️ Class in a safe town.'}</small>`,
          accent: '#c9a0ff',
        });
        ui.updateVitals();
      }),
    );
    add(ev.on('classRank', ({ cls, rank }) => ui.toast(`🏛️ <b>${esc(cls.name)}</b> reached Class Rank ${rank}`)));
    add(ev.on('hint', ({ text }) => ui.log(`🌫️ <i>“${esc(text)}”</i>`, 'info')));
    add(
      ev.on('spark', ({ from, to }) => {
        this.hitStop(250);
        this.skills.fxRing(this.player.x, this.player.y - 10, 90, 0xffe9a0, true);
        this.cameras.main.flash(160, 255, 236, 170);
        ui.sparkBanner(`✦ New form: ${to.name}`, `${from.name} cracked open mid-fight`);
        try {
          navigator.vibrate?.(60);
        } catch {
          /* not supported */
        }
      }),
    );
    add(
      ev.on('witness', ({ skill, status, marks, need, anchorShape }) => {
        if (status === 'progress') ui.toast(`👁 Witnessed ${Math.min(marks, need)}/${need}: <b>${esc(skill.name)}</b>`);
        else if (status === 'blocked')
          ui.log(
            `🌫️ <i>The echo of <b>${esc(skill.name)}</b> slips away — you need a ${anchorShape} skill at rank 3 to hold it.</i>`,
            'info',
          );
      }),
    );
    add(ev.on('echo', ({ skill, monster }) => ui.log(`👁 You echo the ${esc(monster.name)}: <b>${esc(skill.name)}</b>`, 'rare')));
    add(
      ev.on('passive', ({ def, rank }) => {
        ui.toast(`✧ Passive <b>${esc(def.name)}</b>${rank > 1 ? ` rank ${rank}` : ''}`);
        ui.log(`✧ Passive: <b>${esc(def.name)}</b> rank ${rank} — ${esc(def.desc)}`, 'good');
      }),
    );
    add(
      ev.on('essence', ({ essence, added, source }) => {
        if (source.startsWith('drop:')) ui.toast(`${essence.icon} Essence of <b>${esc(essence.name)}</b>`);
        ui.log(`${essence.icon} +${added} Essence of <b>${esc(essence.name)}</b>`, 'loot');
      }),
    );
    add(ev.on('lesson', ({ lesson, trainer }) => ui.log(`📜 ${esc(trainer.title)}: <b>${esc(lesson.name)}</b>`, 'good')));
    add(
      ev.on('bestiary', ({ monster, stars, starUp }) => {
        if (starUp) ui.toast(`📕 Bestiary: <b>${esc(monster.name)}</b> ${'★'.repeat(stars)}`);
      }),
    );
    add(ev.on('morphed', () => (this.hotbarDirty = true)));
    add(ev.on('fused', () => (this.hotbarDirty = true)));
  }

  markHotbarDirty(): void {
    this.hotbarDirty = true;
  }

  /** Saves within ~1 s (coalesces bursts such as AoE kills). */
  requestSave(): void {
    this.saveT = Math.max(this.saveT, 9);
  }

  // =================================================================== input

  private hitSprite(img: Phaser.GameObjects.Image, x: number, y: number): boolean {
    const decal = img.originY === 0.5;
    const cy = decal ? img.y : img.y - img.displayHeight * 0.5;
    const r = Math.max(26, (decal ? Math.max(img.displayWidth, img.displayHeight) : img.displayHeight) * 0.5);
    return Math.hypot(img.x - x, cy - y) < r;
  }

  private handleTap(x: number, y: number): void {
    if (this.warping || this.combat.dead) return;
    const now = this.time.now;
    this.combat.lastInput = now;
    this.session.nav = null;
    let best = null as (typeof this.combat.monsters)[number] | null;
    let bestD = Infinity;
    for (const m of this.combat.monsters) {
      if (!m.alive) continue;
      const d = Math.hypot(m.x - x, m.y - m.radius - y);
      if (d < m.radius + 20 && d < bestD) {
        best = m;
        bestD = d;
      }
    }
    if (best) {
      this.interactions.pending = null;
      this.interactions.cancelChannel();
      this.combat.setTarget(best);
      return;
    }
    const views: (NpcView | ObjectView | NodeView)[] = [...this.npcs, ...this.objects, ...this.nodes];
    for (const v of views) {
      if (this.hitSprite(v.sprite, x, y)) {
        this.interactions.approach(v);
        return;
      }
    }
    for (const v of this.portals) {
      if (v.open) continue;
      const onRect = distToRect(v.def, x, y) <= 14;
      const onArt = (v.overlay && this.hitSprite(v.overlay, x, y)) || (v.parts[0] instanceof Phaser.GameObjects.Image && this.hitSprite(v.parts[0], x, y));
      if (onRect || onArt) {
        this.interactions.approach(v);
        return;
      }
    }
    this.interactions.cancelChannel();
    this.interactions.pending = null;
    this.combat.setTarget(null);
    this.player.path = this.pathTo(x, y) ?? [];
    this.moveMarker.setPosition(x, y).setVisible(true).setAlpha(1).setScale(1);
    this.tweens.add({ targets: this.moveMarker, alpha: 0, scale: 0.6, duration: 500 });
  }

  private handleKey(e: KeyboardEvent): void {
    if (this.ui.isOpen || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if (e.key >= '1' && e.key <= '6') this.castSlot(Number(e.key) - 1);
    else if (e.key === ' ') this.castSlot(-1);
  }

  pathTo(x: number, y: number): { x: number; y: number }[] | null {
    return findPath(this.cm, this.player.x, this.player.y, x, y);
  }

  // =================================================================== update

  update(_time: number, delta: number): void {
    if (this.frozenUntil) {
      if (performance.now() < this.frozenUntil) return;
      this.frozenUntil = 0;
      this.time.timeScale = 1;
      this.tweens.timeScale = 1;
    }
    const dt = Math.min(delta, 50) / 1000;
    const now = this.time.now;
    this.session.player.playMs += Math.min(delta, 250);
    const st = this.stats();
    const p = this.player;
    if (!this.combat.dead && !this.warping) {
      this.interactions.update(now);
      this.combat.updatePlayer(now);
      this.followPath(dt, st, now);
      this.checkPortalContact();
    } else p.moving = false;
    this.combat.updateMonsters(dt, now);
    this.monsterSkills.update(dt, now);
    this.skills.update(dt);
    this.combat.updateVitals(dt, now, st);

    p.sync(
      dt,
      this.combat.buffs.map((b) => this.combat.buffColor(b.stat)),
    );
    if (this.combat.windup) p.castBar.setDepth(100001);
    for (const m of this.combat.monsters) if (m.alive) m.sync(dt);
    this.dark?.setPosition(p.x, p.y - 16);
    const t = this.combat.target;
    if (t?.alive) {
      this.targetRing.setPosition(t.x, t.y + 2).setDepth(t.y - 999);
      this.targetRing.setScale(t.warden ? 2.4 : t.elite ? 1.5 : 1);
    } else if (t) this.combat.setTarget(null);
    for (const v of this.portals) {
      if (!v.overlay || v.overlay.alpha === undefined) continue;
      const look = v.def.reveal?.look;
      if (look !== 'shimmer' && look !== 'rift') continue;
      const d = distToRect(v.def, p.x, p.y);
      v.overlay.setAlpha(Phaser.Math.Clamp((4 * TILE - d) / (2 * TILE), 0, 1) * (0.55 + 0.25 * Math.sin(now / 300)));
    }
    this.cullProps();

    this.uiT += dt;
    if (this.uiT > 0.1) {
      this.uiT = 0;
      this.ui.tick();
      this.combat.updateTargetUi();
      const w = this.combat.windup;
      this.ui.setCast(w ? { skill: w.skill, progress: (now - w.start) / Math.max(1, w.until - w.start), remainMs: w.until - now } : null);
      if (this.hotbarDirty && !this.ui.isOpen) {
        this.hotbarDirty = false;
        this.ui.renderHotbar();
      }
    }
    this.fogT += dt;
    if (this.fogT > 0.5 && !this.warping) {
      this.fogT = 0;
      markFog(this.session.world, this.mapId, this.cm, p.x, p.y);
      this.session.world.x = p.x;
      this.session.world.y = p.y;
    }
    this.nodeT += dt;
    if (this.nodeT > 1) {
      this.nodeT = 0;
      this.refreshNodes();
    }
    this.saveT += dt;
    if (this.saveT > 10) {
      this.saveT = 0;
      this.save();
    }
  }

  private followPath(dt: number, st: Stats, now: number): void {
    const p = this.player;
    if (now < p.lockedUntil || !p.path.length) {
      p.moving = false;
      return;
    }
    const wp = p.path[0];
    const dx = wp.x - p.x;
    const dy = wp.y - p.y;
    const d = Math.hypot(dx, dy);
    const step = st.speed * p.speedMult(now) * dt;
    if (d <= step) {
      p.x = wp.x;
      p.y = wp.y;
      p.path.shift();
    } else {
      p.x += (dx / d) * step;
      p.y += (dy / d) * step;
    }
    if (Math.abs(dx) > 1) p.facing = dx > 0 ? 1 : -1;
    p.aimAngle = Math.atan2(dy, dx);
    p.moving = true;
  }

  private checkPortalContact(): void {
    const p = this.player;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    if (tx < 0 || ty < 0 || tx >= this.cm.w || ty >= this.cm.h) return;
    const c = this.cm.coll[ty * this.cm.w + tx];
    if (!(c & COLL.PORTAL) || c & COLL.BLOCK) return;
    const v = this.portals.find((x) => tx >= x.def.tx && tx < x.def.tx + x.def.w && ty >= x.def.ty && ty < x.def.ty + x.def.h);
    if (v?.open) this.warp(v.def.to.map, v.def.to.portal);
  }

  /** Freezes the simulation for `ms` of real time (spark hit-stop). */
  hitStop(ms: number): void {
    this.frozenUntil = performance.now() + ms;
    this.time.timeScale = 0;
    this.tweens.timeScale = 0;
  }

  // =================================================================== warps

  warp(mapId: string, arrive?: Arrival): void {
    if (this.warping || !mapById(mapId)) return;
    this.warping = true;
    this.player.path = [];
    this.interactions.cancelChannel();
    this.interactions.pending = null;
    this.combat.cancelWindup();
    this.session.world.mapId = mapId;
    this.session.world.x = -1;
    this.session.world.y = -1;
    this.save();
    const data: MapSceneData = { session: this.session, ui: this.ui, mapId, arrive };
    if (this.scene.isPaused()) {
      this.scene.restart(data);
      return;
    }
    const cam = this.cameras.main;
    cam.fadeOut(220, 0, 0, 0);
    cam.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => this.scene.restart(data));
  }

  respawnAtSavePoint(): void {
    const world = this.session.world;
    const sp = world.savePoint;
    if (sp && sp.includes('#')) {
      const mapId = sp.slice(0, sp.indexOf('#'));
      const objId = sp.slice(sp.indexOf('#') + 1);
      if (mapById(mapId)) {
        this.ui.toast(`You awaken at the ${esc(mapById(mapId)!.name)} waystone.`);
        this.warp(mapId, { waystone: objId });
        return;
      }
    }
    const hub = regionOf(this.mapId).hub;
    this.ui.toast(`You awaken in ${esc(mapById(hub)?.name ?? 'town')}.`);
    this.warp(hub);
  }

  /** Hidden-portal reveal: a matching cast within 3 tiles of the rect (player or aim point). */
  onCast(skill: SkillDef, aim: { x: number; y: number }): void {
    const world = this.session.world;
    for (const v of this.portals) {
      const p = v.def;
      if (!p.reveal || this.portalIsRevealed(p)) continue;
      if (!revealMatches(skill, p.reveal)) continue;
      const d = Math.min(distToRect(p, this.player.x, this.player.y), distToRect(p, aim.x, aim.y));
      if (d > 3 * TILE) continue;
      addOnce(world.revealed, portalKey(this.mapId, p.id));
      addOnce(world.seenPortals, portalKey(this.mapId, p.id));
      this.skills.fxBurst(v.x, v.y, 0xe8d8ff, 28);
      this.skills.fxRing(v.x, v.y, 60, 0xe8d8ff, false);
      this.cameras.main.shake(160, 0.005);
      this.drawPortal(v);
      this.applyPortalBlocks();
      this.ui.toast('✨ A hidden way opens');
      this.ui.log(`✨ <b>${esc(skill.name)}</b> revealed a hidden way: ${esc(v.label?.text ?? 'somewhere new')}.`, 'rare');
      this.save();
    }
  }

  // =================================================================== items

  alreadyHas(itemId: string): boolean {
    const it = this.reg.item(itemId);
    if (!it) return true;
    switch (it.kind) {
      case 'tome':
        return this.book.has(it.skill);
      case 'shard':
        return this.book.hasElement(it.element);
      case 'relic':
        return this.session.count(it.id) > 0 || this.book.flag(it.flag) > 0;
      default:
        return false;
    }
  }

  /** Grants an item: tomes teach, shards attune, relics set their flag, everything else goes in the bag. */
  obtain(itemId: string, n = 1, _source = 'loot'): void {
    if (itemId === 'coins') {
      this.session.player.coins += n;
      return;
    }
    const it = this.reg.item(itemId);
    if (!it) return;
    this.ui.log(`${it.icon} Obtained <b>${esc(it.name)}</b>${n > 1 ? ` ×${n}` : ''}!`, 'loot');
    switch (it.kind) {
      case 'tome':
        this.book.learn(it.skill, `tome:${it.id}`);
        break;
      case 'shard':
        this.book.learnElement(it.element, `Absorbed from the ${it.name}`);
        break;
      case 'relic':
        this.session.addItem(it.id, n);
        if (this.book.flag(it.flag) < 1) this.book.incFlag(it.flag);
        this.ui.toast(`${it.icon} Relic: <b>${esc(it.name)}</b>`);
        break;
      default:
        this.session.addItem(it.id, n);
    }
  }

  // =================================================================== fx

  floatText(x: number, y: number, text: string, color: string, size: number): void {
    let t = this.floatPool.pop();
    if (!t || !t.active) {
      t = this.add
        .text(0, 0, '', {
          fontFamily: 'system-ui, sans-serif',
          fontStyle: 'bold',
          fontSize: '14px',
          color: '#fff',
          stroke: '#000',
          strokeThickness: 3,
        })
        .setOrigin(0.5)
        .setResolution(2)
        .setDepth(200000);
    }
    const txt = t;
    txt.setText(text).setColor(color).setFontSize(size).setPosition(x, y).setAlpha(1).setVisible(true);
    this.tweens.add({ targets: txt, y: y - 26, duration: 300, ease: 'Quad.out' });
    this.tweens.add({
      targets: txt,
      alpha: 0,
      delay: 450,
      duration: 400,
      onComplete: () => {
        txt.setVisible(false);
        if (this.floatPool.length < 40) this.floatPool.push(txt);
        else txt.destroy();
      },
    });
  }

  // =================================================================== GameController

  stats(): Stats {
    return computeStats(this.session.player, this.book.activeBonus(), this.combat?.buffs ?? [], statPct(this.book.totals(), 'def'));
  }

  castSlot(i: number): void {
    if (!this.combat || this.combat.dead || this.warping) return;
    this.combat.lastInput = this.time.now;
    const pl = this.session.player;
    if (i < 0) {
      const w = WEAPONS[pl.weapon];
      if (!this.combat.target || !this.combat.target.alive) {
        const best = this.combat.nearestMonster(320);
        if (best) this.combat.setTarget(best);
        else this.ui.toast('No enemies nearby.');
      }
      if (this.combat.target) this.combat.castSkill(w.basic);
      return;
    }
    const id = pl.hotbar[i];
    if (id) this.combat.castSkill(id);
  }

  assignSlot(i: number, id: string | null): void {
    const bar = this.session.player.hotbar;
    if (i < 0 || i >= bar.length) return;
    if (id) {
      const at = bar.indexOf(id);
      if (at >= 0) bar[at] = null;
    }
    bar[i] = id;
    this.ui.renderHotbar();
    this.save();
  }

  cooldown(id: string): { remain: number; total: number } {
    return this.combat ? this.combat.cooldown(id) : { remain: 0, total: 0 };
  }

  usable(id: string): { ok: boolean; reason?: string } {
    const s = this.reg.skill(id);
    if (!s || !this.book.has(id)) return { ok: false, reason: 'Unknown skill.' };
    const w = this.session.player.weapon;
    if (s.weapons && !s.weapons.includes(w))
      return { ok: false, reason: `Requires ${s.weapons.map((x) => WEAPONS[x].name).join(' or ')}.` };
    return { ok: true };
  }

  sparkWindow(id: string): 'none' | 'low' | 'good' | 'peak' {
    if (!this.combat) return 'none';
    const m = this.combat.target?.alive ? this.combat.target : this.combat.nearestMonster(320);
    if (!m) return 'none';
    try {
      return this.book.sparkWindow(id, m.def);
    } catch {
      return 'none';
    }
  }

  morph(from: string, to: string): void {
    const res = this.book.morph(from, to);
    if (!res.ok) this.ui.toast(esc(res.message));
    this.save();
    this.ui.refresh();
  }

  atAltar(): boolean {
    if (!this.player) return false;
    return this.objects.some((o) => o.def.kind === 'altar' && Math.hypot(o.x - this.player.x, o.y - this.player.y) <= TILE * 3);
  }

  fuse(a: string, b: string): FuseResult {
    if (!this.atAltar()) return { ok: false, reason: 'requirement', message: 'Fusion only takes at an altar.' };
    const res = this.book.fuse(a, b);
    this.save();
    this.hotbarDirty = true;
    return res;
  }

  wearClass(id: string): Outcome {
    if (!this.isSafe()) return { ok: false, message: 'You can only change classes in a safe town.' };
    const r = this.book.wear(id);
    this.clampVitals();
    this.save();
    return r;
  }

  buyClassNode(classId: string, nodeId: string): Outcome {
    const r = this.book.buyNode(classId, nodeId);
    this.clampVitals();
    this.save();
    return r;
  }

  respecClass(classId: string): Outcome {
    if (!this.isSafe()) return { ok: false, message: 'Respec only in a safe town.' };
    const r = this.book.respec(classId);
    this.clampVitals();
    this.save();
    return r;
  }

  setImprints(ids: string[]): Outcome {
    const r = this.book.setImprints(ids);
    this.clampVitals();
    this.save();
    return r;
  }

  takeLesson(lessonId: string): Outcome {
    const r = this.book.takeLesson(lessonId);
    this.clampVitals();
    this.save();
    this.ui.refresh();
    return r;
  }

  private clampVitals(): void {
    const st = this.stats();
    const pl = this.session.player;
    pl.hp = Math.min(pl.hp, st.maxHp);
    pl.sp = Math.min(pl.sp, st.maxSp);
    this.ui.updateVitals();
  }

  buyWeapon(w: WeaponType): Outcome {
    const pl = this.session.player;
    const def = WEAPONS[w];
    if (pl.ownedWeapons.includes(w)) return { ok: false, message: `You already own a ${def.name}.` };
    if (pl.coins < def.price) return { ok: false, message: `A ${def.name} costs 🪙${def.price}.` };
    pl.coins -= def.price;
    pl.ownedWeapons.push(w);
    this.ui.log(`Bought a <b>${def.name}</b>.`, 'loot');
    return this.equipWeapon(w);
  }

  equipWeapon(w: WeaponType): Outcome {
    const pl = this.session.player;
    if (!pl.ownedWeapons.includes(w)) return { ok: false, message: 'You do not own that weapon.' };
    pl.weapon = w;
    this.player?.setWeapon(w);
    const def = WEAPONS[w];
    if (!this.book.has(def.basic)) this.book.learn(def.basic, `Picked up the ${def.name}`);
    this.ui.log(`${def.icon} Equipped <b>${def.name}</b>.`, 'info');
    this.ui.renderHotbar();
    this.clampVitals();
    this.save();
    return { ok: true, message: `Equipped ${def.name}.` };
  }

  useItem(itemId: string): Outcome {
    const it = this.reg.item(itemId);
    if (!it || this.session.count(itemId) <= 0) return { ok: false, message: 'You have none.' };
    if (it.kind !== 'consumable') return { ok: false, message: `${it.name} cannot be used.` };
    if (this.combat.dead || this.warping) return { ok: false, message: 'Not now.' };
    const st = this.stats();
    const pl = this.session.player;
    switch (it.effect) {
      case 'heal':
        if (pl.hp >= st.maxHp) return { ok: false, message: 'You are already at full health.' };
        pl.hp = Math.min(st.maxHp, pl.hp + (st.maxHp * (it.amount ?? 40)) / 100);
        break;
      case 'sp':
        if (pl.sp >= st.maxSp) return { ok: false, message: 'Your SP is already full.' };
        pl.sp = Math.min(st.maxSp, pl.sp + (st.maxSp * (it.amount ?? 40)) / 100);
        break;
      case 'recall':
        this.session.takeItem(itemId);
        this.ui.close();
        this.respawnAtSavePoint();
        return { ok: true, message: 'The shard crumbles and the world folds.' };
      case 'blink': {
        const p = this.player;
        const a = p.aimAngle;
        let bx = p.x;
        let by = p.y;
        for (let d = 8; d <= 4 * TILE; d += 8) {
          const nx = p.x + Math.cos(a) * d;
          const ny = p.y + Math.sin(a) * d;
          if (isBlockedPx(this.cm, nx, ny)) break;
          bx = nx;
          by = ny;
        }
        this.skills.fxBurst(p.x, p.y - 12, 0xc8b0ff, 12);
        p.x = bx;
        p.y = by;
        p.path = [];
        this.skills.fxBurst(bx, by - 12, 0xc8b0ff, 12);
        break;
      }
    }
    this.session.takeItem(itemId);
    this.ui.log(`${it.icon} Used <b>${esc(it.name)}</b>.`, 'good');
    this.save();
    return { ok: true, message: `Used ${it.name}.` };
  }

  /** Near a waykeeper NPC (selling, travel). */
  private nearRole(role: string): boolean {
    if (!this.player) return false;
    return this.npcs.some((n) => n.def.role === role && Math.hypot(n.x - this.player.x, n.y - this.player.y) <= TILE * 3);
  }

  /** The waystone the player stands at (within 3 tiles), if any. */
  private nearWaystone(): ObjectView | undefined {
    if (!this.player) return undefined;
    return this.objects.find((o) => o.def.kind === 'waystone' && Math.hypot(o.x - this.player.x, o.y - this.player.y) <= TILE * 3);
  }

  canSell(): boolean {
    return this.nearRole('waykeeper');
  }

  canTravel(): boolean {
    return this.nearRole('waykeeper') || !!this.nearWaystone();
  }

  sellItem(itemId: string, count: number): Outcome {
    if (!this.canSell()) return { ok: false, message: 'Only a Waykeeper buys materials.' };
    const it = this.reg.item(itemId);
    if (!it || it.kind !== 'material' || !it.price) return { ok: false, message: 'Nobody buys that.' };
    const n = Math.min(Math.max(0, Math.floor(count)), this.session.count(itemId));
    if (n <= 0) return { ok: false, message: 'You have none to sell.' };
    this.session.takeItem(itemId, n);
    this.session.player.coins += n * it.price;
    this.ui.log(`🪙 Sold ${n} ${esc(it.name)} for 🪙${n * it.price}.`, 'loot');
    this.save();
    return { ok: true, message: `Sold ${n} ${it.name} for ${n * it.price} coins.` };
  }

  isSafe(): boolean {
    return this.def?.safety === 'safe';
  }

  map(): { def: MapDef; compiled: CompiledMap } {
    return { def: this.def, compiled: this.cm };
  }

  world() {
    return this.session.world;
  }

  minimap(): MinimapView {
    const p = this.player;
    return {
      px: p?.x ?? 0,
      py: p?.y ?? 0,
      monsters: (this.combat?.monsters ?? []).filter((m) => m.alive).map((m) => ({ x: m.x, y: m.y, rank: m.def.rank })),
      npcs: this.npcs.map((n) => ({ x: n.x, y: n.y })),
      portals: this.portals
        .filter((v) => !v.def.reveal || this.portalIsRevealed(v.def))
        .map((v) => ({ x: v.x, y: v.y, open: v.open, label: v.label?.text ?? '' })),
      nodes: this.nodes.map((n) => ({ x: n.x, y: n.y, ready: n.ready })),
      objects: this.objects.map((o) => ({ x: o.x, y: o.y, kind: o.def.kind })),
    };
  }

  travelTargets(): TravelTargetView[] {
    const ws = this.nearWaystone();
    return travelTargets(this.session.world, this.mapId, ws ? objectKey(this.mapId, ws.def.id) : undefined);
  }

  travel(key: string): Outcome {
    if (!this.canTravel()) return { ok: false, message: 'Travel from a waystone or a Waykeeper.' };
    const t = this.travelTargets().find((x) => x.key === key);
    if (!t) return { ok: false, message: 'You have not attuned that waystone.' };
    if (t.cost > 0 && !this.session.spend({ coins: t.cost })) return { ok: false, message: `The crossing costs 🪙${t.cost}.` };
    this.ui.close();
    this.warp(t.mapId, { waystone: key.slice(key.indexOf('#') + 1) });
    return { ok: true, message: `Travelling to ${t.name}.` };
  }

  navigateTo(mapId: string): Outcome {
    if (mapId === this.mapId) return { ok: false, message: 'You are already here.' };
    const route = discoveredRoute(this.session.world, this.book, this.mapId, mapId);
    if (!route) return { ok: false, message: 'You know no open road there yet.' };
    this.session.nav = { target: mapId };
    this.ui.close();
    this.navStep();
    return { ok: true, message: `Heading for ${mapById(mapId)?.name ?? mapId}.` };
  }

  /** Stops auto-travel (HUD "Stop" button): forget the target and stand still. */
  cancelNavigate(): void {
    if (!this.session.nav) return;
    this.session.nav = null;
    if (this.player) this.player.path = [];
  }

  /** Auto-travel: walk to the next portal of the route (re-run after each warp). */
  private navStep(): void {
    const nav = this.session.nav;
    if (!nav) return;
    if (nav.target === this.mapId) {
      this.session.nav = null;
      this.ui.toast(`🧭 Arrived at <b>${esc(this.def.name)}</b>.`);
      return;
    }
    const route = discoveredRoute(this.session.world, this.book, this.mapId, nav.target);
    const step = route?.[0];
    const v = step ? this.portals.find((x) => x.def.id === step.portal) : undefined;
    if (!v || !v.open) {
      this.session.nav = null;
      this.ui.toast('🧭 The way is lost. Auto-travel stopped.');
      return;
    }
    this.combat.setTarget(null);
    const path = this.pathTo(v.x, v.y);
    if (!path) {
      this.session.nav = null;
      this.ui.toast('🧭 No path to the exit from here.');
      return;
    }
    this.player.path = path;
    this.ui.toast(`🧭 Heading for ${esc(mapById(nav.target)?.name ?? '')}…`);
  }

  setPaused(paused: boolean): void {
    // Ignore while the scene is between maps (restart in progress).
    if (!this.sys.isActive() && !this.sys.isPaused()) return;
    if (paused && this.scene.isActive()) this.scene.pause();
    else if (!paused && this.scene.isPaused()) this.scene.resume();
  }

  newGame(): void {
    Session.clear();
    location.reload();
  }

  save(): void {
    if (this.player && !this.warping) {
      this.session.world.x = this.player.x;
      this.session.world.y = this.player.y;
    }
    this.session.save();
  }

  // =================================================================== debug (tests / dev only)

  debugWarp(mapId: string, portalId?: string): boolean {
    if (!mapById(mapId)) return false;
    this.warping = false;
    this.warp(mapId, portalId);
    return true;
  }

  /** Whether `gateOpen` would pass for a gate (debug / tests). */
  gateIsOpen(p: PortalDef): boolean {
    return !p.gate || gateOpen(this.book, p.gate);
  }
}
