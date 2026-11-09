// In-world text (actors lane; docs/QUALITY-PLAN.md §4, docs/INTEGRATION-v3.md §2): floating combat numbers and
// world labels (NPC / portal / object names, name tags). Floating text over an actor is laid out in lanes (TextAnchor
// below): plate fixed, one callout above it, numbers fanned and stacked above that, words / heals beside the plate.
// Every in-world string goes through here and is drawn with the boot-baked bitmap pixel font (render/fonts.ts +
// render/glyphs.ts, 1 px #24180f outline) at its native size — never scaled, so every glyph pixel is one art pixel.
//
// No emoji in-world: the font has no such glyphs, and PixelText.setText drops anything it cannot draw (accented
// letters fall back to their base letter) instead of drawing boxes — also for text set later through `.text`.
import Phaser from 'phaser';
import { DEPTH } from './depths';
import { pixelFontKey, pixelFontSize } from './fonts';
import { type FontTier, pixelSafe, tierFor } from './glyphs';
import {
  type FloatKind,
  LANE,
  LANE_TIMING,
  type LaneBox,
  type LaneRect,
  type LaneTiming,
  floatKind,
  floatRole,
  freeRow,
  laneAlpha,
  laneOrigin,
  laneRise,
  laneSpan,
  laneSpot,
  sameColumn,
  sideStep,
  splitCount,
} from '../entities/lanes';

export type { FloatKind } from '../entities/lanes';

/** What game code may hold for an in-world label (always a BitmapText now; the union keeps v2 callers compiling). */
export type WorldLabel = Phaser.GameObjects.Text | Phaser.GameObjects.BitmapText;

export interface LabelStyle {
  /** CSS colour, e.g. '#ffe9a0'. */
  color: string;
  /** Size in art px (v2 Text sizes: ≤ 12 small, 13–15 bold, ≥ 16 big pixel font). */
  size?: number;
  bold?: boolean;
  /** Ignored: the pixel font always has its 1 px #24180f outline. */
  stroke?: string;
  /** Origin (default 0.5, 1: centred above the anchor). */
  originX?: number;
  originY?: number;
  depth?: number;
}

/** A BitmapText that only ever holds text the pixel font can draw. */
export class PixelText extends Phaser.GameObjects.BitmapText {
  override setText(value: string | string[]): this {
    const raw = Array.isArray(value) ? value.join('\n') : value === undefined || value === null ? '' : String(value);
    return super.setText(pixelSafe(raw));
  }

  /** Switches tier / colour, keeping the font's native size (pixel-exact). */
  setPixelFont(tier: FontTier, color: string): this {
    const key = pixelFontKey(this.scene, tier, color);
    if (key !== this.font) this.setFont(key, pixelFontSize(this.scene, key));
    return this;
  }
}

function pixelText(scene: Phaser.Scene, x: number, y: number, text: string, tier: FontTier, color: string): PixelText {
  const key = pixelFontKey(scene, tier, color);
  const t = new PixelText(scene, x, y, key, text, pixelFontSize(scene, key), Phaser.GameObjects.BitmapText.ALIGN_CENTER);
  scene.add.existing(t);
  return t;
}

/**
 * A static in-world label at (x, y): NPC / portal / object names, monster plates, the player's name.
 * Default origin (0.5, 1) and depth NAME_TAG.
 */
export function worldLabel(scene: Phaser.Scene, x: number, y: number, text: string, style: LabelStyle): WorldLabel {
  return pixelText(scene, x, y, text, tierFor(style.size ?? 10, style.bold), style.color)
    .setOrigin(style.originX ?? 0.5, style.originY ?? 1)
    .setDepth(style.depth ?? DEPTH.NAME_TAG);
}

// ---------------------------------------------------------------- world text lanes (rules: entities/lanes.ts)

/**
 * Something floating text belongs to (a monster, the player): entities register themselves with trackTextAnchor and
 * WorldText.float lays each string out in that actor's lanes (entities/lanes.ts) instead of where the caller dropped it.
 */
export interface TextAnchor {
  /** Centre x and feet y (world px). */
  readonly x: number;
  readonly y: number;
  /** World y of the top of what stays fixed above the body (name plate, chevron, HP bar, head, status icons). */
  textTop(): number;
  /** World y just under the feet / name tag (callouts the caller put below the feet go here). */
  textBottom(): number;
  /** Half the width to keep clear at the plate's height: the body or the name plate, whichever is wider. */
  textHalfW(): number;
  /** Still shown on the map (alive, visible, not destroyed). */
  textLive(): boolean;
  /** The visible body (world px): other actors' text side-steps off it. */
  textBody(): LaneRect;
  /** Who it is: signed numbers ("-12", "+8") and level / rank-ups belong to the player, plain numbers to foes. */
  readonly textRole: 'player' | 'foe';
}

const ANCHORS = new WeakMap<Phaser.Scene, Set<TextAnchor>>();

/** Registers an actor whose floating text gets lanes (until untrackTextAnchor or the scene shuts down). */
export function trackTextAnchor(scene: Phaser.Scene, a: TextAnchor): void {
  let set = ANCHORS.get(scene);
  if (!set) {
    const fresh = new Set<TextAnchor>();
    ANCHORS.set(scene, fresh);
    set = fresh;
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (ANCHORS.get(scene) === fresh) ANCHORS.delete(scene);
    });
  }
  set.add(a);
}

export function untrackTextAnchor(scene: Phaser.Scene, a: TextAnchor): void {
  ANCHORS.get(scene)?.delete(a);
}

/** The tracked actors of a scene with a role (live ones only). */
export function textAnchors(scene: Phaser.Scene, role: 'player' | 'foe'): TextAnchor[] {
  const out: TextAnchor[] = [];
  for (const a of ANCHORS.get(scene) ?? []) if (a.textRole === role && a.textLive()) out.push(a);
  return out;
}

/** A text's current box (world px). */
const rectOf = (t: PixelText): LaneRect => {
  const x0 = t.x - t.originX * t.width;
  const y0 = t.y - t.originY * t.height;
  return { x0, y0, x1: x0 + t.width, y1: y0 + t.height };
};

const box = (a: TextAnchor): LaneBox => ({
  x: Math.round(a.x),
  y: Math.round(a.y),
  top: a.textTop(),
  bottom: a.textBottom(),
  halfW: a.textHalfW(),
});

interface Floater {
  txt: PixelText;
  kind: FloatKind | 'free';
  anchor: TextAnchor | null;
  /** Under the feet (the caller asked for it: the head is under the top HUD). */
  below: boolean;
  /** Text without its " xN". */
  base: string;
  count: number;
  born: number;
  row: number;
  /** x offset from the anchor (absolute x without one). */
  dx: number;
  /** A number's spawn height above the feet (absolute y without an anchor). */
  lift: number;
  t: LaneTiming;
}

/** Pooled floating combat text for one map (create in MapScene.create, destroy on shutdown). */
export class WorldText {
  private pool: PixelText[] = [];
  private live: Floater[] = [];
  private fanAt = new WeakMap<TextAnchor, number>();
  private hooked = false;

  constructor(private readonly scene: Phaser.Scene) {}

  /**
   * Floats `text` from (x, y): damage numbers, heals, technique names, "LEVEL 5!". Over a tracked actor the string goes
   * in that actor's lane (entities/lanes.ts); `kind` overrides the lane guessed from the text.
   */
  float(x: number, y: number, text: string, color: string, size: number, kind?: FloatKind): void {
    const raw = pixelSafe(text);
    if (!raw) return;
    this.hook();
    const now = this.scene.time.now;
    const k = kind ?? floatKind(raw, size);
    const anchor = this.anchorAt(x, y, floatRole(raw, k));
    const below = !!anchor && y > anchor.y + 4 && (k === 'callout' || k === 'status');
    const [base] = splitCount(raw);
    const tier = tierFor(size);

    if (anchor && (k === 'status' || k === 'callout')) {
      // Coalesce: the same word / callout on the same actor while it is still up → "Text xN".
      const same = this.live.find((f) => f.anchor === anchor && f.kind === k && f.base === base && now - f.born < f.t.life);
      if (same) {
        same.count++;
        same.born = now - same.t.riseMs; // stays up, no second pop
        same.txt.setPixelFont(tier, color).setText(`${base} x${same.count}`);
        this.place(same, now);
        return;
      }
      // One callout per actor: the latest wins.
      if (k === 'callout') for (const f of this.live) if (f.anchor === anchor && f.kind === 'callout' && f.below === below) f.born = -Infinity;
      this.sweep(now);
    }

    const txt = this.take(tier, color);
    txt.setText(raw);
    if (!txt.text) {
      this.recycle(txt);
      return;
    }
    const lane: FloatKind | 'free' = anchor ? k : 'free';
    const f: Floater = { txt, kind: lane, anchor, below, base, count: 1, born: now, row: 0, dx: 0, lift: 0, t: LANE_TIMING[lane] };
    txt.setOrigin(...laneOrigin(lane, below));
    if (!anchor) {
      f.dx = Math.round(x);
      f.lift = Math.round(y);
      // free text: step up past another young free string at the same spot
      while (this.live.some((o) => !o.anchor && now - o.born < LANE.rowHoldMs && Math.abs(o.dx - f.dx) < 12 && Math.abs(o.lift - f.lift) < LANE.row)) f.lift -= LANE.row;
    } else {
      this.lay(f, now);
      this.sidestep(f);
      this.unpile(f, now);
    }
    txt.setVisible(true);
    this.live.push(f);
    this.place(f, now);
  }

  /** The tracked actor a string at (x, y) belongs to (null = free text). */
  private anchorAt(x: number, y: number, role: 'player' | 'foe' | null): TextAnchor | null {
    const set = ANCHORS.get(this.scene);
    if (!set) return null;
    let best: TextAnchor | null = null;
    let score = Infinity;
    for (const a of set) {
      if (!a.textLive()) continue;
      const dx = Math.abs(x - a.x);
      if (dx > Math.max(14, a.textHalfW() * 0.6) + 10) continue;
      // callers aim at the head (or just under the feet when the head is under the HUD)
      const top = a.textTop();
      if (y < top - 60 || y > a.y + 70) continue;
      const dy = y < top ? top - y : y > a.y ? (y - a.y) * 0.5 : 0;
      const sc = dx + dy * 0.5 + (role && role !== a.textRole ? 40 : 0);
      if (sc < score) [best, score] = [a, sc];
    }
    return best;
  }

  /** Picks a new floater's spot in its anchor's lane: stack row, fan offset, spawn height. */
  private lay(f: Floater, now: number): void {
    const a = f.anchor!;
    const mates = this.live.filter((o) => o.anchor === a && sameColumn(o.kind, f.kind) && o.below === f.below && now - o.born < o.t.life);
    if (f.below) {
      f.row = mates.length ? Math.max(...mates.map((o) => o.row)) + 1 : 0;
      return;
    }
    if (f.kind === 'callout') return;
    const held = new Set<number>();
    for (const o of mates) if (now - o.born < LANE.rowHoldMs) for (let k = 0; k < laneSpan(o.kind as FloatKind); k++) held.add(o.row + k);
    f.row = freeRow(held, laneSpan(f.kind as FloatKind));
    if (f.kind !== 'damage' && f.kind !== 'crit') return;
    const i = this.fanAt.get(a) ?? 0;
    this.fanAt.set(a, i + 1);
    f.dx = LANE.fan[i % LANE.fan.length];
    // numbers start above the callout while one is up
    const call = this.live.find((o) => o.anchor === a && o.kind === 'callout' && !o.below && now - o.born < o.t.life);
    f.lift = Math.round(a.y) - (a.textTop() - 1 - (call ? call.txt.height + 1 : 0));
  }

  /**
   * Moves a new floater sideways off the bodies of the other side's actors it would cover over its whole rise (the
   * player's numbers in front of a warden; a monster's over the player standing behind it).
   */
  private sidestep(f: Floater): void {
    const a = f.anchor!;
    const set = ANCHORS.get(this.scene);
    if (!set || f.kind === 'free') return;
    const bodies: LaneRect[] = [];
    for (const o of set) if (o !== a && o.textRole !== a.textRole && o.textLive()) bodies.push(o.textBody());
    if (!bodies.length) return;
    const p = laneSpot(f.kind, f.below, box(a), f, 0);
    const [ox, oy] = laneOrigin(f.kind, f.below);
    const w = f.txt.width;
    const h = f.txt.height;
    const r = { x0: p.x - ox * w, y0: p.y - oy * h - (f.below ? 0 : f.t.rise), x1: p.x - ox * w + w, y1: p.y - oy * h + h };
    f.dx += sideStep(r, bodies, a.x);
  }

  /**
   * Neighbours in a crowd each stack their own numbers: a new number that would land on another actor's young number
   * steps up a row (the stack grows upward instead of piling up).
   */
  private unpile(f: Floater, now: number): void {
    if (f.kind !== 'damage' && f.kind !== 'crit') return;
    const a = f.anchor!;
    const others: LaneRect[] = [];
    for (const o of this.live)
      if (o.anchor !== a && (o.kind === 'damage' || o.kind === 'crit' || o.kind === 'free') && now - o.born < o.t.life * 0.6) others.push(rectOf(o.txt));
    if (!others.length) return;
    const span = laneSpan(f.kind);
    const [ox, oy] = laneOrigin(f.kind, false);
    const w = f.txt.width;
    const h = f.txt.height;
    for (let tries = 0; tries < LANE.maxRows && f.row < LANE.maxRows + 2; tries++) {
      const p = laneSpot(f.kind, false, box(a), f, 0);
      const r = { x0: p.x - ox * w, y0: p.y - oy * h, x1: p.x - ox * w + w, y1: p.y - oy * h + h };
      if (!others.some((o) => r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1)) return;
      f.row += span;
    }
  }

  /** Positions a floater for the time `now` (it follows its actor). */
  private place(f: Floater, now: number): void {
    const age = now - f.born;
    const up = laneRise(f.t, age);
    const a = f.anchor;
    const p = a && f.kind !== 'free' ? laneSpot(f.kind, f.below, box(a), f, up) : { x: f.dx, y: f.lift - up };
    f.txt.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(laneAlpha(f.t, age));
  }

  private tick(): void {
    const now = this.scene.time.now;
    for (const f of this.live) {
      // the actor died or left: the text carries on from where it is
      if (f.anchor && !f.anchor.textLive()) {
        const [ox, oy] = laneOrigin(f.kind, f.below);
        f.dx = Math.round(f.txt.x + (0.5 - ox) * f.txt.width);
        f.lift = Math.round(f.txt.y + (0.5 - oy) * f.txt.height) + laneRise(f.t, now - f.born);
        f.anchor = null;
        f.kind = 'free';
        f.txt.setOrigin(0.5);
      }
      if (now - f.born < f.t.life) this.place(f, now);
    }
    this.sweep(now);
  }

  /** Recycles every floater past its life. */
  private sweep(now: number): void {
    if (!this.live.some((f) => now - f.born >= f.t.life)) return;
    this.live = this.live.filter((f) => {
      if (now - f.born < f.t.life) return true;
      this.recycle(f.txt);
      return false;
    });
  }

  private hook(): void {
    if (this.hooked) return;
    this.hooked = true;
    this.scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.tick, this);
    this.scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.destroy());
  }

  private take(tier: FontTier, color: string): PixelText {
    let t = this.pool.pop();
    while (t && !t.active) t = this.pool.pop();
    if (!t) t = pixelText(this.scene, 0, 0, '', tier, color).setDepth(DEPTH.WORLD_TEXT);
    return t.setPixelFont(tier, color);
  }

  private recycle(txt: PixelText): void {
    txt.setVisible(false);
    if (this.pool.length < 40) this.pool.push(txt);
    else txt.destroy();
  }

  /** Drops the pool (the scene destroys its game objects itself on shutdown). */
  destroy(): void {
    if (this.hooked) this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.tick, this);
    this.hooked = false;
    this.pool = [];
    this.live = [];
  }
}
