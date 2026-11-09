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
  STACK_MAX_PUSH,
  type StackItem,
  floatKind,
  floatRole,
  laneAlpha,
  laneOrigin,
  laneRise,
  laneSpan,
  laneSpot,
  sameColumn,
  sideStep,
  splitCount,
  stackPush,
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
  /** Its name plate while one shows (other actors' numbers start clear of it), else null. */
  textPlate?(): LaneRect | null;
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
  /** Upward push from the lane's stack (entities/lanes.ts stackPush): newer strings below, older ones above. */
  push: number;
  /** Scene time it started an early fade (pushed past the top of its column); Infinity = none. */
  fadeOut: number;
}

/** An early fade (a string pushed past the top of its column) lasts this long (ms). */
const EARLY_FADE_MS = 200;

/** Still on screen (within its life, not done with an early fade). */
const showing = (f: Floater, now: number): boolean => now - f.born < f.t.life && now - f.fadeOut < EARLY_FADE_MS;

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
      const same = this.live.find((f) => f.anchor === anchor && f.kind === k && f.below === below && f.base === base && showing(f, now));
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
    const f: Floater = { txt, kind: lane, anchor, below, base, count: 1, born: now, row: 0, dx: 0, lift: 0, t: LANE_TIMING[lane], push: 0, fadeOut: Infinity };
    txt.setOrigin(...laneOrigin(lane, below));
    if (!anchor) {
      // free text (no live actor there: a killing blow, a world message): it stacks with the other free strings
      f.dx = Math.round(x);
      f.lift = Math.round(y);
    } else {
      this.lay(f, now);
      this.sidestep(f);
      this.unpile(f, now);
      this.clearPlates(f);
    }
    txt.setVisible(true);
    this.live.push(f);
    // lay it out now (its stack push, the older strings pushed up) so the first frame is right
    if (anchor) this.layoutActor(anchor, now);
    else this.layoutFree(now);
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

  /**
   * Picks a new floater's spot in its anchor's lane: fan offset and spawn height. Above the head every lane starts at
   * its base (row 0) and the stack pass (layoutActor) pushes the older strings up; under the feet strings take rows.
   */
  private lay(f: Floater, now: number): void {
    const a = f.anchor!;
    if (f.below) {
      const mates = this.live.filter((o) => o.anchor === a && sameColumn(o.kind, f.kind) && o.below && showing(o, now));
      f.row = mates.length ? Math.max(...mates.map((o) => o.row)) + 1 : 0;
      return;
    }
    if (f.kind !== 'damage' && f.kind !== 'crit') return;
    const i = this.fanAt.get(a) ?? 0;
    this.fanAt.set(a, i + 1);
    f.dx = LANE.fan[i % LANE.fan.length];
    // numbers start right above what is fixed over the head; the stack pass lifts them over a callout that is up
    f.lift = Math.round(a.y) - (a.textTop() - 1);
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
   * or callout, or rise through a neighbour's name plate, steps up a row (the stack grows upward instead of piling up).
   */
  private unpile(f: Floater, now: number): void {
    if (f.kind !== 'damage' && f.kind !== 'crit') return;
    const a = f.anchor!;
    const others: LaneRect[] = [];
    for (const o of this.live)
      if (o.anchor !== a && o.kind !== 'status' && o.kind !== 'heal' && now - o.born < o.t.life * 0.6 && showing(o, now)) others.push(rectOf(o.txt));
    // a neighbour's name plate (the target next to it in a crowd): kept clear over the number's whole rise
    const plates: LaneRect[] = [];
    for (const o of ANCHORS.get(this.scene) ?? []) {
      const plate = o !== a && o.textLive() ? o.textPlate?.() : null;
      if (plate) plates.push(plate);
    }
    if (!others.length && !plates.length) return;
    const hit = (r: LaneRect, o: LaneRect) => r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1;
    const span = laneSpan(f.kind);
    const [ox, oy] = laneOrigin(f.kind, false);
    const w = f.txt.width;
    const h = f.txt.height;
    for (let tries = 0; tries < LANE.maxRows && f.row < LANE.maxRows + 2; tries++) {
      const p = laneSpot(f.kind, false, box(a), f, 0);
      const r = { x0: p.x - ox * w, y0: p.y - oy * h, x1: p.x - ox * w + w, y1: p.y - oy * h + h };
      const path = { ...r, y0: r.y0 - f.t.rise };
      if (!others.some((o) => hit(r, o)) && !plates.some((o) => hit(path, o))) return;
      f.row += span;
    }
  }

  /** A callout over a neighbour's name plate (the player next to an elite) goes up a row at a time until clear. */
  private clearPlates(f: Floater): void {
    if (f.kind !== 'callout' || f.below) return;
    const a = f.anchor!;
    const plates: LaneRect[] = [];
    for (const o of ANCHORS.get(this.scene) ?? []) {
      const plate = o !== a && o.textLive() ? o.textPlate?.() : null;
      if (plate) plates.push(plate);
    }
    if (!plates.length) return;
    const w = f.txt.width;
    const h = f.txt.height;
    for (let tries = 0; tries < LANE.maxRows; tries++) {
      const p = laneSpot('callout', false, box(a), f, 0);
      const r = { x0: p.x - w / 2, y0: p.y - h - f.t.rise, x1: p.x + w / 2, y1: p.y };
      if (!plates.some((o) => r.x0 < o.x1 && o.x0 < r.x1 && r.y0 < o.y1 && o.y0 < r.y1)) return;
      f.row++;
    }
  }

  /** Positions a floater for the time `now` (it follows its actor; `b`: the actor's box this frame). */
  private place(f: Floater, now: number, b?: LaneBox): void {
    const age = now - f.born;
    const rise = laneRise(f.t, age);
    const a = f.anchor;
    const p = a && f.kind !== 'free' ? laneSpot(f.kind, f.below, b ?? box(a), f, f.below ? rise : rise + f.push) : { x: f.dx, y: f.lift - rise - f.push };
    const early = f.fadeOut === Infinity ? 1 : Math.max(0, 1 - (now - f.fadeOut) / EARLY_FADE_MS);
    f.txt.setPosition(Math.round(p.x), Math.round(p.y)).setAlpha(Math.min(laneAlpha(f.t, age), early));
  }

  /**
   * Lays out every string over one actor for `now`: callouts and under-the-feet strings at their spots, then each lane
   * above the head as a stack (entities/lanes.ts stackPush) — numbers over the plate and the callout, words left of the
   * plate, heals right of it — newest at the base, older ones pushed up, the ones pushed past the top fading out.
   */
  private layoutActor(a: TextAnchor, now: number): void {
    const fs = this.live.filter((f) => f.anchor === a && f.kind !== 'free' && showing(f, now));
    if (!fs.length) return;
    const b = box(a);
    let floor = b.top - 1;
    for (const f of fs) {
      if (f.kind !== 'callout' && !f.below) continue;
      this.place(f, now, b);
      if (!f.below) floor = Math.min(floor, Math.round(f.txt.y - f.txt.height) - 1);
    }
    this.stack(fs.filter((f) => !f.below && (f.kind === 'damage' || f.kind === 'crit')), b, now, floor);
    this.stack(fs.filter((f) => !f.below && f.kind === 'status'), b, now, null);
    this.stack(fs.filter((f) => !f.below && f.kind === 'heal'), b, now, null);
  }

  /** One lane's stack over an actor: pushes, early fades, positions. */
  private stack(fs: Floater[], b: LaneBox, now: number, floor: number | null): void {
    if (!fs.length) return;
    fs.sort((p, q) => q.born - p.born);
    const items: StackItem[] = fs.map((f) => {
      const k = f.kind as FloatKind;
      const p = laneSpot(k, false, b, f, laneRise(f.t, now - f.born));
      const x0 = p.x - laneOrigin(k, false)[0] * f.txt.width;
      return { x0, x1: x0 + f.txt.width, y1: p.y, h: f.txt.height, push: f.push };
    });
    this.settle(fs, stackPush(items, floor), now, b);
  }

  /**
   * Free strings (no actor): one stack for all of them, so a burst of killing blows does not pile up on one spot. The
   * actors' strings (already laid out this frame) and name plates are fixed: a free string touching one goes above it.
   */
  private layoutFree(now: number): void {
    const fs = this.live.filter((f) => !f.anchor && showing(f, now));
    if (!fs.length) return;
    fs.sort((p, q) => q.born - p.born);
    const fixed: StackItem[] = [];
    const fix = (r: LaneRect) => fixed.push({ x0: r.x0, x1: r.x1, y1: r.y1, h: r.y1 - r.y0, push: 0 });
    for (const o of this.live) if (o.anchor && showing(o, now)) fix(rectOf(o.txt));
    for (const a of ANCHORS.get(this.scene) ?? []) {
      const plate = a.textLive() ? a.textPlate?.() : null;
      if (plate) fix(plate);
    }
    const items: StackItem[] = fs.map((f) => {
      const w = f.txt.width;
      const h = f.txt.height;
      return { x0: f.dx - w / 2, x1: f.dx + w / 2, y1: f.lift - laneRise(f.t, now - f.born) + h / 2, h, push: f.push };
    });
    this.settle(fs, stackPush([...fixed, ...items]).slice(fixed.length), now);
  }

  /** Applies a stack's pushes (whole-pixel steps, at once), starts early fades past the top, positions the strings. */
  private settle(fs: readonly Floater[], want: readonly number[], now: number, b?: LaneBox): void {
    fs.forEach((f, i) => {
      // at once: the newer string under it is still rising fast, so easing would trail it and overlap
      if (want[i] > f.push) f.push = want[i];
      // pushed past the top of the column: it fades out early (the stack stays about maxRows high)
      if (f.push > STACK_MAX_PUSH && f.fadeOut === Infinity) f.fadeOut = now;
      this.place(f, now, b);
    });
  }

  private tick(): void {
    const now = this.scene.time.now;
    const actors = new Set<TextAnchor>();
    for (const f of this.live) {
      // the actor died or left: the text carries on from where it is (its push is in its new spawn point)
      if (f.anchor && !f.anchor.textLive()) {
        const [ox, oy] = laneOrigin(f.kind, f.below);
        f.dx = Math.round(f.txt.x + (0.5 - ox) * f.txt.width);
        f.lift = Math.round(f.txt.y + (0.5 - oy) * f.txt.height) + laneRise(f.t, now - f.born);
        f.push = 0;
        f.anchor = null;
        f.kind = 'free';
        f.txt.setOrigin(0.5);
      }
      if (f.anchor && f.kind !== 'free' && showing(f, now)) actors.add(f.anchor);
    }
    for (const a of actors) this.layoutActor(a, now);
    this.layoutFree(now);
    this.sweep(now);
  }

  /** Recycles every floater past its life (or done with an early fade). */
  private sweep(now: number): void {
    if (this.live.every((f) => showing(f, now))) return;
    this.live = this.live.filter((f) => {
      if (showing(f, now)) return true;
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
