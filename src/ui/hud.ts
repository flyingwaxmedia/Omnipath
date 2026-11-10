// HUD v4 (docs/SPEC-v4.md §11.7 "HUD diet", docs/CLIENT-v3.md §2, docs/UX-SIMPLE.md) — no joystick, tap-to-move:
//   top-left    portrait medallion + level badge (heavy frame; tap → Class), "Lv N · Name" and HP / SP bars on a soft
//               dark strip (no frame: you cannot tap it). The stat strip lives in the Class screen now;
//   top-centre  the zone plate: drawn in the display face on arrival, then it shrinks to a small tag (tap → Map; the
//               explored % lives in the Map). The target and auto-travel sit under it (landscape: the toasts too);
//   top-right   framed buttons Skills · Fuse · Class · Codex · Bag · Map · ☰ (Fuse after the first element), the
//               collapsible minimap under them, then the tracker: ONE line, collapsed; tap to open its rows;
//   left edge   round quick buttons: heal (count), recall (count), rest;
//   bottom      the log (fades 4 s after its last line), the class mechanic widget (one per worn class, its only
//               label the mechanic's name), the skill bar (light frames; icon grounds tinted by element; class slots
//               framed in the class colour; a skill that needs another weapon is dimmed and wears that weapon — tap
//               = Equip), the attack cluster (heavy frame; hold to swing, AUTO, Target, SP potion) and the EXP bar.
// Frame weights: heavy (portrait, attack button, menu buttons), light (slots), none (text on a soft dark strip).
// Gold only on things you can tap. Type: one plain pixel face for body and numbers, the drawn display face for the
// zone name and the headline; three sizes (--fs-s, --fs-m, display art).
// The layout pass (layout()) measures the widgets and places the zone plate, bar, log, tracker and toasts so portrait /
// landscape phones, iPads and desktops never overlap, and nothing covers the middle of the screen (where the player
// stands; tap-to-move is the only way to move). Updates are throttled by the caller (≤ 10 Hz) and only touch the
// DOM when a value changed. Frames come from the uiCss custom properties (./hud/art.ts).
import type { ElementDef, SkillDef } from '../core/types';
import { WEAPONS } from '../data/weapons';
import { mapById } from '../data/world';
import { displayText } from '../game/render/fonts';
import { expToNext } from '../game/session';
import { discoveredRoute } from '../game/world/runtime';
import type { BarSlotView, GameController, PursuitView, ZoneView } from './controller';
import { equipForSkill, lockOf } from './classinfo';
import { ensureUiArt, hasV4Art } from './hud/art';
import { mechanicHint, mechanicHtml, mechanicOf, mechanicTap } from './hud/mechanic';
import { MARKER_ART } from '../game/entities/actorArt';
import { HUD_WORDS, SPARK_RUNE, digits, pursuitHtml, pursuitLineHtml, slotHtml, zonePlateHtml, type HudArt, type QuestMarkArt } from './hud/html';
import {
  HOLD_MS,
  HOLD_SLOP,
  PURSUIT_ROWS,
  type HudLayoutClasses,
  type HudScale,
  type Rect,
  barLeft,
  barPlan,
  barWidth,
  cooldownText,
  countText,
  expPercent,
  fitSnap,
  hudLayoutClasses,
  hudScale,
  placeZone,
  rowsThatFit,
} from './hud/layout';
import { $, $$, esc, hex } from './util';

export { SPARK_RUNE } from './hud/html';

export interface TargetInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  element?: ElementDef;
  boss?: boolean;
  elite?: boolean;
}

/** A skill wind-up in progress (pushed by the scene at the HUD tick). */
export interface CastInfo {
  skill: SkillDef;
  /** 0..1 */
  progress: number;
  remainMs: number;
}

export type LogKind = 'info' | 'good' | 'rare' | 'warn' | 'loot';

/** Optional controller extension: stop auto-travel (MapScene implements it). */
type NavController = GameController & { cancelNavigate?: () => void };

/** The top-right buttons (panel name for ui.open, emoji fallback, label, pixel glyph `ui_ico_<glyph>`). */
export const MENU: { panel: string; icon: string; label: string; glyph: string }[] = [
  { panel: 'skills', icon: '✦', label: 'Skills', glyph: 'skills' },
  { panel: 'altar', icon: '⚗', label: 'Fuse', glyph: 'fuse' },
  { panel: 'classes', icon: '⛨', label: 'Class', glyph: 'class' },
  { panel: 'codex', icon: '❖', label: 'Codex', glyph: 'codex' },
  { panel: 'bag', icon: '◘', label: 'Bag', glyph: 'bag' },
  { panel: 'map', icon: '⌖', label: 'Map', glyph: 'map' },
  { panel: 'menu', icon: '☰', label: 'Menu', glyph: 'menu' },
];

/** What the HUD asks of the UI facade. */
export interface HudActions {
  open(panel: string, arg?: string): void;
  toggleAuto(): void;
}

/** v4: the tracker starts collapsed on every screen (a new key: the old default was open). */
const PZ_KEY = 'omnipath.ui.pursuits4';
/** The log goes quiet this long after its last line (SPEC-v4 §11.7). */
export const LOG_QUIET_MS = 4000;

function levelClass(monster: number, player: number): string {
  const d = monster - player;
  if (d >= 5) return 'lv-deadly';
  if (d >= 2) return 'lv-hard';
  if (d <= -4) return 'lv-easy';
  return 'lv-even';
}

/** Puts the digits of foreign HTML (toasts and log lines from announce.ts / the game) in `.num` spans. */
function wrapDigits(root: HTMLElement): void {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/\d/.test(n.nodeValue ?? '')) nodes.push(n as Text);
  for (const n of nodes) {
    const span = document.createElement('span');
    span.innerHTML = digits(esc(n.nodeValue ?? ''));
    n.replaceWith(...Array.from(span.childNodes));
  }
}

function store(key: string, v?: string): string | null {
  try {
    if (v === undefined) return localStorage.getItem(key);
    localStorage.setItem(key, v);
  } catch {
    /* storage unavailable */
  }
  return null;
}

export class Hud {
  readonly el: HTMLElement;
  /** Where the minimap docks (between the button row and the Pursuits). */
  readonly mmDock: HTMLElement;
  private me!: HTMLElement;
  private centre!: HTMLElement;
  private right!: HTMLElement;
  private menuEl!: HTMLElement;
  private pzEl!: HTMLElement;
  private pzList!: HTMLElement;
  private hotbar!: HTMLElement;
  private slotsEl!: HTMLElement;
  private mechEl!: HTMLElement;
  private cluster!: HTMLElement;
  private atkBtn!: HTMLButtonElement;
  /** The AUTO switch (never `$(cluster, '.auto')`: the attack button wears `.auto` too while AUTO is on). */
  private autoBtn!: HTMLButtonElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private zoneEl!: HTMLElement;
  private channelEl!: HTMLElement;
  private castEl!: HTMLElement;
  private navEl!: HTMLElement;
  private sparkEl!: HTMLElement;
  private headEl!: HTMLElement;
  private v: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private slots: BarSlotView[] = [];
  private sparkSkills = new Set<string>();
  private targetKey = '';
  private castKey = '';
  private castProgress = 0;
  private navKey = '';
  private t = { stats: 0, badges: 0, zone: 0, pz: 0, slots: 0 };
  private pursuits: PursuitView[] = [];
  private pzOpen: boolean | null = null;
  /** The open tracker has room for at least one row on this screen. */
  private pzRoom = true;
  /** Slot presses in progress, one per finger (two-thumb play: each press casts or edits on its own). */
  private holds = new Map<number, { i: number; x: number; y: number; timer: number }>();
  private suppressClick = false;
  /** When the target plate last showed a new target (a full-HP target nobody fights hides after a while). */
  private targetSince = 0;
  private targetIdle = false;
  private zoneName = '';
  private zoneFade = 0;
  private sparkSkill = '';
  private sparkTimer = 0;
  private marks: Partial<Record<'busy' | 'ready', QuestMarkArt | null>> = {};
  private layoutQueued = false;
  private uiArt = false;
  private hinted = new Set<string>();
  private headTimer = 0;
  private logTimer = 0;
  private wornColor = '#e9c46a';
  private mechKey = '';
  private toastTimers = new WeakMap<Element, number[]>();
  /** The HUD's pixel size (CSS px per HUD art px = `--ui-px`) and the art-px viewport. */
  private scale: HudScale = { px: 1, n: 1, w: 0, h: 0, fits: true };
  /** The screen-size variants (classes on #hud-root). */
  private lay: HudLayoutClasses = { port: false, narrow: false, short: false, big: false };
  private layKey = '';
  /** Measures the HUD's length variables (calc(N * var(--px)) expressions) in CSS px. */
  private probe!: HTMLElement;

  constructor(
    readonly root: HTMLElement,
    private ctrl: GameController,
    private actions: HudActions,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-layer';
    root.appendChild(this.el);
    this.el.innerHTML = `
      <div class="hud-me">
        <button class="me-medal" aria-label="Your class"><span class="m-bg"></span><span class="m-face"><img alt="" draggable="false"></span><span class="m-ring"></span><b class="m-lv">1</b></button>
        <div class="me-plate">
          <div class="me-name"><span class="plv"></span><i aria-hidden="true">·</i><span class="pname"></span></div>
          <div class="vb hp"><i></i><span></span></div>
          <div class="vb sp"><i></i><span></span></div>
        </div>
      </div>
      <div class="hud-centre">
        <button class="zone-banner" aria-label="Open the map"><span class="zone-plate"></span></button>
        <div class="target hidden"></div>
        <div class="navpill hidden" role="status">
          <button class="np-open" aria-label="Show route on the map"><i class="g g-map" aria-hidden="true"></i><span class="np-txt"><b></b><small></small></span></button>
          <button class="np-stop" aria-label="Stop auto-travel" title="Stop">✕</button>
        </div>
      </div>
      <div class="toasts" aria-live="polite"></div>
      <div class="hud-right">
        <nav class="menu">${MENU.map(
          (m) =>
            `<button data-panel="${m.panel}" aria-label="${m.label}"${m.panel === 'altar' ? ' class="hidden"' : ''}><i class="g g-${m.glyph}" data-e="${m.icon}" aria-hidden="true"></i><small>${m.label}</small><em class="badge" aria-hidden="true"></em></button>`,
        ).join('')}</nav>
        <div class="mm-dock"></div>
        <div class="pursuits hidden">
          <button class="pz-tab" aria-label="${HUD_WORDS.pursuits}" aria-expanded="false"></button>
          <div class="pz-list"></div>
          <button class="pz-more hidden" aria-label="More quests: open the quest log"></button>
        </div>
      </div>
      <div class="quick">
        <button class="qk" data-q="heal" aria-label="${HUD_WORDS.heal}"><span class="q-ico"><i class="g g-potion" aria-hidden="true"></i></span><b class="n"></b><small>${HUD_WORDS.heal}</small></button>
        <button class="qk" data-q="recall" aria-label="${HUD_WORDS.recall}"><span class="q-ico"><i class="g g-recall" aria-hidden="true"></i></span><b class="n"></b><small>${HUD_WORDS.recall}</small></button>
        <button class="qk" data-q="rest" aria-label="${HUD_WORDS.rest}"><span class="q-ico"><i class="g g-rest" aria-hidden="true"></i></span><small>${HUD_WORDS.rest}</small></button>
      </div>
      <div class="log" aria-live="off"></div>
      <div class="hotbar"><div class="mech-dock"></div><div class="slots"></div></div>
      <div class="cluster">
        <button class="atk" aria-label="${HUD_WORDS.attack} (hold to keep swinging)"><i class="g g-attack" aria-hidden="true"></i><span class="cd" aria-hidden="true"></span><span class="ring" aria-hidden="true"></span><span class="rk hidden" aria-hidden="true"></span></button>
        <button class="rb auto" aria-pressed="false" aria-label="${HUD_WORDS.auto}"><i class="g g-auto" aria-hidden="true"></i><em class="pill">${HUD_WORDS.off}</em></button>
        <button class="rb tgt" aria-label="${HUD_WORDS.target}"><i class="g g-target" aria-hidden="true"></i><small>${HUD_WORDS.target}</small></button>
        <button class="rb pot none" aria-label="${HUD_WORDS.potion}"><span class="q-ico"><i class="g g-potion sp" aria-hidden="true"></i></span><b class="n"></b><small>${HUD_WORDS.sp}</small></button>
      </div>
      <div class="expbar" aria-label="${HUD_WORDS.exp}"><i></i><span></span></div>
      <div class="spark-banner"><b></b><small></small><button class="sb-see">See it</button></div>
      <div class="headline" aria-live="polite"><div class="hl-card"><span class="hl-art"></span><span class="hl-txt"><b></b><small></small></span></div></div>
      <div class="channel hidden"><div class="ch-label"></div><div class="cbar"><i></i></div></div>
      <div class="castbar hidden" aria-hidden="true"><div class="cb-label"><img class="cb-ico" alt=""><span class="cb-name"></span></div><div class="cbar"><i></i></div></div>
      <i class="hud-probe" aria-hidden="true" style="position:absolute;left:0;top:0;height:0;visibility:hidden;pointer-events:none"></i>`;
    const q = <T extends HTMLElement = HTMLElement>(sel: string) => $<T>(this.el, sel);
    this.me = q('.hud-me');
    this.centre = q('.hud-centre');
    this.right = q('.hud-right');
    this.menuEl = q('.menu');
    this.mmDock = q('.mm-dock');
    this.pzEl = q('.pursuits');
    this.pzList = q('.pz-list');
    this.hotbar = q('.hotbar');
    this.slotsEl = q('.hotbar .slots');
    this.mechEl = q('.hotbar .mech-dock');
    this.cluster = q('.cluster');
    this.atkBtn = q<HTMLButtonElement>('.cluster .atk');
    this.autoBtn = q<HTMLButtonElement>('.cluster .rb.auto');
    this.logEl = q('.log');
    this.toastEl = q('.toasts');
    this.targetEl = q('.target');
    this.zoneEl = q('.zone-banner');
    this.channelEl = q('.channel');
    this.castEl = q('.castbar');
    this.navEl = q('.navpill');
    this.sparkEl = q('.spark-banner');
    this.headEl = q('.headline');
    this.probe = q('.hud-probe');
    for (const [k, sel] of [
      ['face', '.m-face img'],
      ['lvb', '.m-lv'],
      ['plv', '.plv'],
      ['pname', '.pname'],
      ['hpI', '.vb.hp i'],
      ['hpS', '.vb.hp span'],
      ['spI', '.vb.sp i'],
      ['spS', '.vb.sp span'],
      ['expI', '.expbar i'],
      ['expS', '.expbar span'],
    ] as const)
      this.v[k] = q(sel);
    this.wire();
    this.uiArt = ensureUiArt(ctrl);
    this.el.classList.toggle('ui-art', this.uiArt);
    this.el.classList.toggle('v4-art', this.uiArt && hasV4Art());
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => this.queueLayout());
      for (const e of [this.me, this.right, this.zoneEl, this.cluster, this.hotbar, this.mmDock]) ro.observe(e);
    }
    window.addEventListener('resize', () => this.queueLayout());
    // The render lane re-fits the world's pixel scale (--art-px on <html>) on resize / orientation / DPR changes: the
    // HUD follows it (its own --ui-px write lands here too and settles after one pass).
    if (typeof MutationObserver !== 'undefined')
      new MutationObserver(() => this.queueLayout()).observe(document.documentElement, { attributes: true, attributeFilter: ['style'] });
    this.applyScale(window.innerWidth, window.innerHeight);
  }

  /** The button row element (kept for callers that dock next to it). */
  get menuRow(): HTMLElement {
    return this.menuEl;
  }

  // ================================================================ wiring (once: the HUD lives for the whole run)

  private wire(): void {
    const c = this.ctrl;
    $$<HTMLButtonElement>(this.menuEl, 'button').forEach((b) => b.addEventListener('click', () => this.actions.open(b.dataset.panel!)));
    $(this.me, '.me-medal').addEventListener('click', () => this.actions.open('classes'));
    this.zoneEl.addEventListener('click', () => this.actions.open('map'));
    $(this.navEl, '.np-open').addEventListener('click', () => this.actions.open('map', 'route'));
    $(this.navEl, '.np-stop').addEventListener('click', () => this.cancelNav());
    $(this.pzEl, '.pz-tab').addEventListener('click', () => {
      // Open but no room for a row on this screen: the tap goes to the quest log.
      if (this.pursuitsOpen() && !this.pzRoom) {
        this.actions.open('codex', 'quests');
        return;
      }
      this.pzOpen = !this.pursuitsOpen();
      store(PZ_KEY, this.pzOpen ? '1' : '0');
      this.applyPursuits();
      this.layout();
      if (this.pzOpen && !this.pzRoom) this.actions.open('codex', 'quests');
    });
    this.pzList.addEventListener('click', (e) => {
      const row = (e.target as HTMLElement).closest<HTMLElement>('.pz-row');
      const p = row ? this.pursuits[Number(row.dataset.i)] : undefined;
      if (p) this.actions.open(p.open.panel, p.open.arg);
    });
    // "+N": the rows that did not fit → the quest log.
    $(this.pzEl, '.pz-more').addEventListener('click', () => this.actions.open('codex', 'quests'));
    // A sudden insight's banner: "See it" opens the new skill's card (the banner is the moment's only announcement).
    $(this.sparkEl, '.sb-see').addEventListener('click', () => {
      if (this.sparkSkill) this.actions.open('skill', this.sparkSkill);
      this.hideSpark();
    });
    $$<HTMLButtonElement>(this.el, '.quick .qk').forEach((b) =>
      b.addEventListener('click', () => {
        const kind = b.dataset.q as 'heal' | 'recall' | 'rest';
        const r = c.useQuick(kind);
        if (r.message) this.toast(esc(r.message));
        this.t.stats = 0;
      }),
    );
    // Attack: press = one swing (or target the nearest foe while AUTO is on); hold = keep swinging.
    const atk = this.atkBtn;
    atk.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      try {
        atk.setPointerCapture(e.pointerId);
      } catch {
        /* synthetic events */
      }
      c.castSlot(-1);
      c.holdAttack(true);
      atk.classList.add('pressed');
      this.hint('hold_attack', 'Hold ⚔ to keep swinging.');
    });
    const release = () => {
      c.holdAttack(false);
      atk.classList.remove('pressed');
    };
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) atk.addEventListener(ev, release);
    this.autoBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.actions.toggleAuto();
    });
    $(this.cluster, '.tgt').addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.cycleTarget();
    });
    $(this.cluster, '.pot').addEventListener('click', () => {
      const r = c.useQuick('potion');
      if (r.message) this.toast(esc(r.message));
      this.t.stats = 0;
    });
    // Skill bar (delegated: the slots are re-rendered often). Press a filled slot = cast; hold = edit.
    this.slotsEl.addEventListener('pointerdown', (e) => this.slotDown(e));
    this.slotsEl.addEventListener('click', (e) => this.slotClick(e));
    this.slotsEl.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      const b = (e.target as HTMLElement).closest<HTMLElement>('.slot');
      if (b) this.slotEdit(Number(b.dataset.slot));
    });
    // Every finger on its own: its release casts its slot, its move / cancel drops only its own press.
    window.addEventListener('pointerup', (e) => this.slotUp(e.pointerId));
    window.addEventListener('pointercancel', (e) => this.endHold(e.pointerId));
    window.addEventListener('pointermove', (e) => {
      const h = this.holds.get(e.pointerId);
      if (h && Math.hypot(e.clientX - h.x, e.clientY - h.y) > HOLD_SLOP) this.endHold(e.pointerId);
    });
    // The stance toggle is the one mechanic widget you tap.
    this.mechEl.addEventListener('click', (e) => {
      if (!(e.target as HTMLElement).closest('.mech.tap')) return;
      const r = mechanicTap(c);
      if (r && !r.ok && r.message) this.toast(esc(r.message));
      this.updateMechanic();
    });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Desktop: M opens the map.
    window.addEventListener('keydown', (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || (e.key !== 'm' && e.key !== 'M')) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return;
      if (!this.el.isConnected || this.root.querySelector('.modal:not(.hidden)')) return;
      this.actions.open('map');
    });
  }

  private slotDown(e: PointerEvent): void {
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLElement>('.slot');
    if (!b) return;
    // A new press with no other finger down: whatever click the last long-press swallowed is long gone.
    if (!this.holds.size) this.suppressClick = false;
    e.preventDefault();
    const i = Number(b.dataset.slot);
    const v = this.slots.find((s) => s.index === i);
    if (!v?.skillId) return; // empty slots act on click
    if (v.kind === 'own' && target.closest('.edit')) return; // the edit corner acts on click
    // Cast on release (a quick tap); a hold opens the picker / the card instead and never casts. Other fingers'
    // presses carry on (two thumbs on two slots both cast).
    const id = e.pointerId;
    this.endHold(id);
    b.classList.add('pressed', 'holding');
    this.holds.set(id, {
      i,
      x: e.clientX,
      y: e.clientY,
      timer: window.setTimeout(() => {
        this.endHold(id);
        this.suppressClick = true;
        this.slotEdit(i);
      }, HOLD_MS),
    });
  }

  /** Drops one finger's press in progress (no cast), or every press without an id. */
  private endHold(pointerId?: number): void {
    const ids = pointerId === undefined ? [...this.holds.keys()] : [pointerId];
    for (const id of ids) {
      const h = this.holds.get(id);
      if (!h) continue;
      clearTimeout(h.timer);
      this.holds.delete(id);
      // Another finger may still hold the same slot: keep its look then.
      if ([...this.holds.values()].some((o) => o.i === h.i)) continue;
      this.slotsEl.querySelector(`.slot[data-slot="${h.i}"]`)?.classList.remove('holding', 'pressed');
    }
  }

  /** A press released before it became a hold: cast that finger's slot. */
  private slotUp(pointerId: number): void {
    const h = this.holds.get(pointerId);
    if (!h) return;
    const i = h.i;
    this.endHold(pointerId);
    if (this.equipFor(i)) return;
    const waiting = this.slots.find((x) => x.index === i)?.waiting;
    if (waiting) this.toast(esc(waiting));
    this.ctrl.castSlot(i);
    const b = this.slotsEl.querySelector<HTMLElement>(`.slot[data-slot="${i}"]`);
    if (b) {
      b.classList.remove('tapped');
      void b.offsetWidth;
      b.classList.add('tapped');
    }
  }

  /**
   * A slot whose skill needs another weapon ("Needs a sword — Equip"): the tap equips that weapon when you own it,
   * else says the one line. True when the slot was locked (no cast).
   */
  private equipFor(i: number): boolean {
    const v = this.slots.find((s) => s.index === i);
    if (!v?.skillId) return false;
    const c = this.ctrl;
    const lock = v.lock ? { need: v.lock.weapon, line: v.lock.line, owned: v.lock.owned } : lockOf(c, v.skillId);
    if (!lock) return false;
    if (!lock.owned) {
      this.toast(`${esc(lock.line)}. Brann sells one in Hearthvale.`);
      return true;
    }
    const r = equipForSkill(c, v.skillId, lock.need);
    if (r.message) this.toast(esc(r.message));
    this.renderHotbar();
    return true;
  }

  private slotClick(e: MouseEvent): void {
    if (this.suppressClick) {
      this.suppressClick = false;
      return;
    }
    const target = e.target as HTMLElement;
    const b = target.closest<HTMLElement>('.slot');
    if (!b) return;
    const i = Number(b.dataset.slot);
    const v = this.slots.find((s) => s.index === i);
    if (!v) return;
    if (!v.skillId) {
      if (v.kind === 'own') this.actions.open('picker', String(i));
      else {
        const worn = this.ctrl.wornClass();
        this.toast(worn ? `Your ${esc(worn.name)} fills this slot as you learn its skills.` : 'Your class fills this slot.');
      }
      return;
    }
    if (v.kind === 'own' && target.closest('.edit')) this.actions.open('picker', String(i));
  }

  /** Long-press / right-click: your slot → the picker; a class slot → that skill's card. */
  private slotEdit(i: number): void {
    const v = this.slots.find((s) => s.index === i);
    if (!v) return;
    if (v.kind === 'own') this.actions.open('picker', String(i));
    else if (v.skillId) this.actions.open('skill', v.skillId);
  }

  /** One-line "teach in the moment" hint, once per save (docs/UX-SIMPLE.md rule 9). */
  private hint(key: string, msg: string): void {
    if (this.hinted.has(key)) return;
    // A card or panel is up (it is the moment's announcement): the hint waits for the next quiet render.
    if (this.root.querySelector('.modal:not(.hidden)')) return;
    this.hinted.add(key);
    try {
      if (this.ctrl.firstTime(key)) this.toast(msg);
    } catch {
      /* scene not ready */
    }
  }

  // ================================================================ layout

  queueLayout(): void {
    if (this.layoutQueued) return;
    this.layoutQueued = true;
    requestAnimationFrame(() => {
      this.layoutQueued = false;
      this.layout();
    });
  }

  private portraitPhone(): boolean {
    return this.lay.port;
  }

  /**
   * The HUD's pixel size for this screen (./hud/layout.ts hudScale: the world's k device px per art px when the layout
   * fits) and its screen-size classes, measured in HUD art px. Writes `--ui-px` on <html> and the classes on #hud-root.
   */
  private applyScale(W: number, H: number): void {
    const dpr = window.devicePixelRatio || 1;
    const art = parseFloat(document.documentElement.style.getPropertyValue('--art-px'));
    const k = art > 0 ? Math.round(art * dpr) : Math.ceil(dpr);
    const s = hudScale(W, H, dpr, k);
    const lay = hudLayoutClasses(s.w, s.h);
    const key = `${s.px}|${dpr}|${lay.port}|${lay.narrow}|${lay.short}|${lay.big}`;
    this.scale = s;
    this.lay = lay;
    if (key === this.layKey) return;
    this.layKey = key;
    document.documentElement.style.setProperty('--ui-px', `${s.px}px`);
    // The body face's pixel (CSS px): the HUD's own pixel where that reads well, else the next whole device pixel up
    // (phones: 5 device px instead of 3), so text is always on whole device pixels and never under TEXT_MIN_PX.
    this.el.style.setProperty('--tx', `${textPixel(s.px, dpr)}px`);
    for (const c of ['port', 'narrow', 'short', 'big'] as const) this.root.classList.toggle(`hud-${c}`, lay[c]);
    this.sizeFace();
  }

  /** A HUD length variable in CSS px (`fb` art px when it is missing). */
  private len(name: string, fb: number): number {
    this.probe.style.width = `var(${name})`;
    const w = this.probe.getBoundingClientRect().width;
    return w > 0 ? w : fb * this.scale.px;
  }

  /**
   * Places the skill bar, log, Pursuits, zone plate, target and toasts for this screen (no overlaps; see
   * ./hud/layout.ts). Portrait screens keep the middle band (where the player stands, and every tap must reach the
   * world) free of HUD: the zone plate and target stay in the top band, the Pursuits show ≤ 2 rows above it, and
   * toasts rise above the skill bar instead of stacking down the screen.
   */
  layout(): void {
    if (!this.el.isConnected) return;
    const W = window.innerWidth;
    const H = window.innerHeight;
    this.applyScale(W, H);
    // Every HUD length is in HUD art px: u CSS px each (the constants below are art px too). Boxes sit on whole
    // device px and are whole art px wide, so their frames' pixels stay even under nearest sampling.
    const u = this.scale.px;
    const dpr = window.devicePixelRatio || 1;
    const snap = (v: number) => Math.round(v * dpr) / dpr;
    const whole = (v: number) => Math.ceil(v / u - 0.01) * u;
    const port = this.portraitPhone();
    // Short landscapes (laptops at 2 CSS px per art px, phones on their side) keep the middle band clear like portrait
    // does: the zone plate fades after arrival (a target takes its place in the top band) and toasts rise from above
    // the skill bar instead of stacking down over the player.
    const clearMiddle = port || this.lay.short;
    const m = this.len('--m', 8);
    // Skill bar: its plan (rows, slot size), width, and its left edge (centred, clear of the attack cluster).
    const baseSlot = this.len('--slot', 52);
    const gap = this.len('--sgap', 4);
    const n = this.slots.length || 1;
    const cl = this.cluster.getBoundingClientRect();
    const clLeft = cl.width ? cl.left : W;
    const plan = barPlan({
      n,
      classSlots: this.slots.filter((s) => s.kind === 'class').length,
      twoRows: port,
      room: clLeft - 6 * u - m,
      slot: baseSlot,
      minSlot: 44 * u,
      gap,
      unit: u,
    });
    const slot = plan.slot;
    const slotVar = slot < baseSlot - 0.01 ? `${slot}px` : '';
    if (this.last.barSlot !== slotVar) {
      this.last.barSlot = slotVar;
      if (slotVar) this.hotbar.style.setProperty('--slot', slotVar);
      else this.hotbar.style.removeProperty('--slot');
    }
    this.hotbar.classList.toggle('split', plan.split);
    this.hotbar.classList.toggle('two', plan.rows.length > 1);
    this.setVar('--own-col', String(plan.ownCol || 'auto'));
    // Icons: one icon pixel = one HUD art pixel (32 art px) when the slot frame leaves room, else the largest crisp size.
    const crisp = (room: number, art: number) => (room >= art * u - 0.01 ? art * u : fitSnap(room, art, dpr));
    this.setVar('--ico', `${crisp(slot - 12 * u, 32)}px`);
    // (Glyphs are the buttons' icons, not the bar's: sized from the screen's slot size, not a shrunk bar.)
    this.setVar('--glyph', `${crisp(Math.min(30 * u, baseSlot - 22 * u), 24)}px`);
    const rows = plan.rows;
    const per = Math.max(...rows, 1);
    const bw = barWidth(per, slot, gap);
    this.setVar('--per-row', String(per));
    this.setVar('--bar-w', `${bw}px`);
    const left = barLeft(bw, W, clLeft, 10 * u, m);
    this.setVar('--bar-left', `${snap(left)}px`);
    // Full height (slots + the class / yours tabs): the stacked log and the cast bar sit above it.
    const barH = this.hotbar.offsetHeight || rows.length * slot + (rows.length - 1) * gap;
    this.setVar('--bar-h', `${barH}px`);
    // Log: left of the bar when there is room, else stacked above it.
    const room = left - 2 * m;
    const stacked = room < 170 * u;
    this.logEl.classList.toggle('stacked', stacked);
    // Stacked, its 3 lines (≈ 16 art px each) start right of the quick column (Heal / Recall / Rest) when that column
    // reaches down to them (short landscapes such as 1280×720 put the log's top line under the Rest label).
    const qk = stacked ? this.el.querySelector('.quick')?.getBoundingClientRect() : undefined;
    const logLeft = qk && qk.width > 0 && qk.bottom > this.logEl.getBoundingClientRect().bottom - 3 * 16 * u - 2 * u ? qk.right + 4 * u : 0;
    this.setVar('--log-left', logLeft ? `${snap(logLeft)}px` : '');
    const logRoom = logLeft ? clLeft - 8 * u - logLeft : Infinity;
    this.setVar('--log-w', `${snap(stacked ? Math.min(320 * u, W * 0.62, logRoom) : Math.min(340 * u, room))}px`);
    const menu = this.menuEl.getBoundingClientRect();
    // Pursuits: ≤ 2 rows, above the attack cluster and (portrait) above the middle band; the rest behind "+N".
    this.fitPursuits(Math.min(cl.width ? cl.top - 10 * u : H - 120 * u, H > W ? H * 0.4 : Infinity));
    // Zone plate (+ the target under it): whole art px wide (its natural width rounded up), then placed.
    const me = this.me.getBoundingClientRect();
    const plate = $(this.me, '.me-plate').getBoundingClientRect();
    const zone = this.zoneEl;
    // Natural widths: the column must not cap them (it is sized to the plate below).
    this.centre.style.width = '';
    zone.style.width = '';
    zone.classList.add('compact');
    let zwCompact = whole(zone.getBoundingClientRect().width);
    zone.classList.remove('compact');
    let zw = whole(zone.getBoundingClientRect().width);
    let zh = zone.offsetHeight;
    // Portrait / short landscape, the plate faded away: the column is placed for what it shows now (the target plate).
    if (clearMiddle && zone.classList.contains('gone')) {
      this.targetEl.style.width = '';
      const t = this.targetEl.classList.contains('hidden') ? null : this.targetEl.getBoundingClientRect();
      zw = zwCompact = t && t.width > 0 ? whole(t.width) : 44 * u;
      zh = t && t.height > 0 ? t.height : 0;
    }
    const rect = (el: Element | null): Rect | null => {
      if (!el || (el as HTMLElement).offsetParent === null) return null;
      const r = el.getBoundingClientRect();
      return r.width > 0 ? r : null;
    };
    const mm = rect(this.mmDock);
    const pz = rect(this.pzEl);
    const quick = rect(this.el.querySelector('.quick'));
    const place = placeZone({ W, m, u, zw, zwCompact, zh, below: port ? 0 : 48 * u, portrait: port, plate, me, stats: null, menu, minimap: mm, pursuits: pz, quick });
    zone.classList.toggle('compact', place.compact);
    const width = place.maxW !== undefined ? Math.floor(place.maxW / u) * u : place.compact ? zwCompact : zw;
    zone.style.width = `${width}px`;
    const x = snap(place.x);
    const top = snap(place.top);
    this.centre.style.left = `${x}px`;
    this.centre.style.top = `${top}px`;
    this.centre.style.width = `${width}px`;
    // The target plate: whole art px, its width differing from the plate's by an even number of art px, so centred
    // under the plate it starts on a whole art px too.
    const tg = this.targetEl;
    if (!tg.classList.contains('hidden')) {
      tg.style.width = '';
      let tw = Math.round(whole(tg.getBoundingClientRect().width) / u);
      if ((tw - Math.round(width / u)) % 2) tw++;
      tg.style.width = `${tw * u}px`;
    }
    // Toasts. Landscape: centred under the plate (+ target), slid sideways into the free span when needed. Portrait:
    // they rise from just above the skill bar / attack cluster / log, clear of the player in the middle.
    const centreBottom = this.centre.getBoundingClientRect().bottom;
    if (clearMiddle) {
      // The log (stacked above the bar) keeps room for its 3 lines (≈ 16 art px each) even while they fade.
      const logTop = stacked ? this.logEl.getBoundingClientRect().bottom - 3 * 16 * u : H;
      const barTop = this.hotbar.getBoundingClientRect().top;
      if (port) {
        const anchor = Math.min(cl.width ? cl.top : H, barTop, logTop);
        this.setVar('--toast-bottom', `${snap(H - anchor + 6 * u)}px`);
        this.setVar('--toast-x', `${snap(W / 2)}px`);
        this.setVar('--centre-w', `${Math.floor(W - 2 * m)}px`);
      } else {
        // Landscape: above the bar, centred on it (the attack cluster stands to its right, not under the toasts).
        const cx = left + bw / 2;
        const half = Math.min(cx - m, clLeft - 8 * u - cx);
        this.setVar('--toast-bottom', `${snap(H - Math.min(barTop, logTop) + 6 * u)}px`);
        this.setVar('--toast-x', `${snap(cx)}px`);
        this.setVar('--centre-w', `${Math.floor(Math.max(bw, 2 * half))}px`);
      }
      this.toastEl.classList.add('rise');
      this.setVar('--toast-top', 'auto');
    } else {
      const below = centreBottom;
      const side = (r: DOMRect) => r.width > 0 && r.top < below + 200 * u && r.bottom > below;
      const leftBlocks = [me, this.el.querySelector('.quick')!.getBoundingClientRect()].filter(side);
      const rightBlocks = [this.mmDock.getBoundingClientRect(), this.pzEl.getBoundingClientRect(), menu].filter(side);
      const lo2 = Math.max(m, ...leftBlocks.map((r) => r.right + 8 * u));
      const hi2 = Math.min(W - m, ...rightBlocks.map((r) => r.left - 8 * u));
      const cx = x + width / 2;
      const want = Math.min(440 * u, Math.max(width, hi2 - lo2));
      const tcx = 2 * Math.min(cx - lo2, hi2 - cx) >= want ? cx : Math.max(lo2 + want / 2, Math.min(hi2 - want / 2, cx));
      this.toastEl.classList.remove('rise');
      this.setVar('--toast-top', `${snap(below + 4 * u)}px`);
      this.setVar('--toast-bottom', 'auto');
      this.setVar('--toast-x', `${snap(tcx)}px`);
      this.setVar('--centre-w', `${Math.floor(Math.max(width, 2 * Math.min(tcx - lo2, hi2 - tcx)))}px`);
    }
    this.fitToasts();
  }

  /**
   * Toasts never reach the skill bar (landscape) nor climb into the middle of the screen (portrait): the oldest steps
   * aside first.
   */
  private fitToasts(): void {
    const kids = Array.from(this.toastEl.children) as HTMLElement[];
    for (const k of kids) k.classList.remove('cut');
    if (!kids.length) return;
    const rise = this.toastEl.classList.contains('rise');
    const bar = this.hotbar.getBoundingClientRect();
    if (!bar.height) return;
    const limit = bar.top - 4 * this.scale.px;
    // Rising toasts stop below the middle band (portrait: they may reach a little higher, the bar is two rows).
    const ceiling = window.innerHeight * (this.lay.port ? 0.55 : 0.6);
    for (const k of kids.slice(0, -1)) {
      const r = this.toastEl.getBoundingClientRect();
      if (rise ? r.top >= ceiling : r.bottom <= limit) break;
      k.classList.add('cut');
    }
  }

  private setVar(name: string, value: string): void {
    if (this.last[`var${name}`] === value) return;
    this.last[`var${name}`] = value;
    this.el.style.setProperty(name, value);
  }

  /** The open tracker: at most PURSUIT_ROWS rows, only those above `limit`; "+N" (→ the quest log) for the rest. */
  private fitPursuits(limit: number): void {
    const open = this.pursuitsOpen();
    const tab = $(this.pzEl, '.pz-tab');
    this.pzEl.classList.toggle('open', open);
    const rows = $$<HTMLElement>(this.pzList, '.pz-row');
    rows.forEach((r) => r.classList.remove('cut'));
    const more = $(this.pzEl, '.pz-more');
    let shown = rows.length;
    if (rows.length && open) {
      // Only whole rows above the limit (the first too: with no room at all the tracker stays its one line).
      shown = 0;
      for (const r of rows) {
        if (shown >= PURSUIT_ROWS || r.getBoundingClientRect().bottom > limit) break;
        shown++;
      }
      rows.forEach((r, i) => r.classList.toggle('cut', i >= shown));
    }
    this.pzRoom = !open || shown > 0;
    // No room for a single row: it reads as collapsed (its one line shows); a tap leads to the quest log instead.
    if (open && shown === 0) this.pzEl.classList.remove('open');
    tab.setAttribute('aria-expanded', String(open && shown > 0));
    const rest = open && shown > 0 ? rows.length - shown : 0;
    more.classList.toggle('hidden', rest <= 0);
    more.textContent = rest > 0 ? `+${rest}` : '';
    // No room for "+N" under the rows (a short band): leave it out — every row and the tab still lead on.
    if (rest > 0 && more.getBoundingClientRect().bottom - 10 * this.scale.px > limit) more.classList.add('hidden');
  }

  // ================================================================ vitals, stats, portrait, badges (≤ 10 Hz)

  private set(key: string, el: HTMLElement, value: string, prop: 'text' | 'width' | 'html' = 'text'): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else if (prop === 'html') el.innerHTML = value;
    else el.style.width = value;
  }

  updateVitals(): void {
    const c = this.ctrl;
    const p = c.session.player;
    const st = c.stats();
    this.set('name', this.v.pname, p.name);
    this.set('lv', this.v.plv, `Lv <span class="num">${p.level}</span>`, 'html');
    this.set('lvb', this.v.lvb, String(p.level));
    const hpPct = Math.max(0, Math.min(100, (100 * p.hp) / st.maxHp));
    this.set('hpI', this.v.hpI, `${hpPct}%`, 'width');
    this.set('hpS', this.v.hpS, `${Math.max(0, Math.ceil(p.hp))} / ${st.maxHp}`);
    const low = hpPct < 30 ? '1' : '';
    if (this.last.hpLow !== low) {
      this.last.hpLow = low;
      this.v.hpI.parentElement!.classList.toggle('low', !!low);
    }
    this.set('spI', this.v.spI, `${Math.max(0, Math.min(100, (100 * p.sp) / st.maxSp))}%`, 'width');
    this.set('spS', this.v.spS, `${Math.max(0, Math.floor(p.sp))} / ${st.maxSp}`);
    const next = expToNext(p.level);
    this.set('expI', this.v.expI, `${Math.max(0, Math.min(100, (100 * p.exp) / next))}%`, 'width');
    this.set('expS', this.v.expS, `${HUD_WORDS.exp} ${expPercent(p.exp, next)}`);
    const auto = p.autoOn ? '1' : '';
    if (this.last.auto !== auto) this.applyAuto(p.autoOn);
    const now = performance.now();
    if (now - this.t.stats > 500) {
      this.t.stats = now;
      this.updateQuick();
      this.updatePortrait();
    }
    if (now - this.t.badges > 1000) {
      this.t.badges = now;
      this.updateBadges();
      if (!this.uiArt) {
        this.uiArt = ensureUiArt(c);
        this.el.classList.toggle('ui-art', this.uiArt);
      }
      if (this.uiArt && !this.el.classList.contains('v4-art') && hasV4Art()) this.el.classList.add('v4-art');
    }
    if (now - this.t.zone > 2000) {
      this.t.zone = now;
      this.renderZone();
    }
    if (now - this.t.pz > 3000) this.renderPursuits();
  }

  /** The portrait medallion: the player's current look (worn class outfit). */
  updatePortrait(force = false): void {
    const c = this.ctrl;
    const key = `${c.session.player.weapon}|${c.book.state.worn ?? ''}`;
    if (!force && this.last.face === key) return;
    let url = '';
    try {
      url = c.portraitUrl();
    } catch {
      return;
    }
    if (!url) return;
    this.last.face = key;
    const img = this.v.face as HTMLImageElement;
    img.onload = () => this.sizeFace();
    img.src = url;
    const worn = c.wornClass();
    $(this.me, '.me-medal').style.setProperty('--cc', worn?.color ?? 'transparent');
    $(this.me, '.me-medal').setAttribute('aria-label', worn ? `${worn.name}: open your class` : 'Open your class');
  }

  /** The portrait: 2 HUD art px per sprite px, its head (≈ the top third) centred in the medallion window. */
  private sizeFace(): void {
    const img = this.v.face as HTMLImageElement | undefined;
    if (!img?.complete || !img.naturalWidth) return;
    const u = this.scale.px;
    const w = img.naturalWidth || 40;
    const h = img.naturalHeight || 48;
    img.style.width = `${w * 2 * u}px`;
    img.style.height = `${h * 2 * u}px`;
    img.style.setProperty('--hy', `${Math.round(h * 0.3) * 2 * u}px`);
  }

  /** Gold "new" dots and progressive disclosure (Fuse after the first element). */
  updateBadges(): void {
    const c = this.ctrl;
    let badges: Partial<Record<string, boolean>> = {};
    let fusion = false;
    try {
      badges = c.badges() as unknown as Record<string, boolean>;
      fusion = c.unlocks().fusion;
    } catch {
      return;
    }
    const fuseKey = fusion ? '1' : '';
    if (this.last.fuse !== fuseKey) {
      const first = this.last.fuse === '' && fusion;
      this.last.fuse = fuseKey;
      const b = this.menuEl.querySelector<HTMLElement>('button[data-panel="altar"]');
      b?.classList.toggle('hidden', !fusion);
      if (first && b) {
        b.classList.add('appear');
        setTimeout(() => b.classList.remove('appear'), 2400);
      }
      this.queueLayout();
    }
    for (const panel of ['skills', 'classes', 'codex', 'altar']) {
      const on = !!badges[panel];
      const key = `badge:${panel}`;
      const v = on ? '1' : '';
      if (this.last[key] === v) continue;
      this.last[key] = v;
      this.menuEl.querySelector(`button[data-panel="${panel}"]`)?.classList.toggle('has-badge', on);
    }
  }

  /** Left quick buttons (heal / recall) and the cluster's potion: item art and counts. */
  updateQuick(): void {
    const c = this.ctrl;
    let qs;
    try {
      qs = c.quickSlots();
    } catch {
      return;
    }
    const put = (btn: HTMLElement | null, slot: { itemId: string; count: number } | null, key: string) => {
      if (!btn) return;
      const count = slot?.count ?? 0;
      const k = `${slot?.itemId ?? ''}|${count}`;
      if (this.last[key] === k) return;
      const prevItem = (this.last[key] ?? '').split('|')[0];
      this.last[key] = k;
      const n = btn.querySelector<HTMLElement>('.n');
      if (n) n.textContent = countText(count);
      btn.classList.toggle('none', count <= 0);
      if (slot && slot.itemId !== prevItem) {
        const url = c.iconUrl('item', slot.itemId);
        if (url) btn.querySelector('.q-ico')!.innerHTML = `<img src="${esc(url)}" alt="" draggable="false">`;
      }
    };
    put(this.el.querySelector('.qk[data-q="heal"]'), qs.heal, 'q:heal');
    put(this.el.querySelector('.qk[data-q="recall"]'), qs.recall, 'q:recall');
    put(this.cluster.querySelector('.pot'), qs.potion, 'q:potion');
  }

  // ================================================================ zone plate

  renderZone(z?: ZoneView): void {
    let view = z;
    if (!view) {
      try {
        view = this.ctrl.zone();
      } catch {
        return;
      }
    }
    // The arrival plate wears the name in the drawn display face (render lane: an image); the tag is plain text.
    let title = null;
    try {
      title = displayText(view.name, 'gold');
    } catch {
      title = null;
    }
    const plate = zonePlateHtml(view, title);
    if (this.last.zone === plate) return;
    this.last.zone = plate;
    $(this.zoneEl, '.zone-plate').innerHTML = plate;
    this.zoneEl.setAttribute('aria-label', `${view.name}: open the map`);
    if (view.name !== this.zoneName) {
      this.zoneName = view.name;
      this.armZoneFade();
    }
    this.queueLayout();
  }

  /**
   * The zone plate animates in on arrival and, after a few seconds, shrinks to a small tag (`.tag`). Portrait / short
   * landscape: it fades away altogether (CSS: .hud-port, .hud-short), so the middle band stays clear.
   */
  private armZoneFade(): void {
    this.zoneEl.classList.remove('faded', 'gone', 'tag');
    clearTimeout(this.zoneFade);
    this.queueLayout();
    this.zoneFade = window.setTimeout(() => {
      this.zoneEl.classList.add('faded', 'tag');
      this.queueLayout();
      this.zoneFade = window.setTimeout(() => {
        this.zoneEl.classList.add('gone');
        this.queueLayout();
      }, 650);
    }, 4000);
  }

  /** Map entry: the zone plate shows the new place and pops. */
  banner(title: string, sub = ''): void {
    let z: ZoneView | undefined;
    try {
      z = this.ctrl.zone();
    } catch {
      /* scene not ready */
    }
    if (!z || z.name !== title) z = { name: title, tag: z?.tag ?? 'Safe', band: /^Lv\b/.test(sub) ? sub : (z?.band ?? ''), explored: z?.explored ?? 0, sources: z?.sources ?? [], warden: z?.warden ?? null };
    this.t.zone = performance.now();
    this.renderZone(z);
    this.armZoneFade();
    this.zoneEl.classList.remove('arrive');
    void this.zoneEl.offsetWidth;
    this.zoneEl.classList.add('arrive');
  }

  /** Mid-fight banner (a sudden insight). With `skillId` it carries a "See it" button to that skill's card. */
  sparkBanner(title: string, sub = '', skillId = ''): void {
    const b = $(this.sparkEl, 'b');
    if (title.startsWith('✦')) b.innerHTML = `${SPARK_RUNE}<span>${esc(title.replace(/^✦\s*/, ''))}</span>`;
    else b.textContent = title;
    $(this.sparkEl, 'small').textContent = sub;
    this.sparkSkill = skillId;
    this.sparkEl.classList.toggle('has-see', !!skillId);
    this.sparkEl.classList.remove('show');
    void this.sparkEl.offsetWidth;
    this.sparkEl.classList.add('show');
    clearTimeout(this.sparkTimer);
    // The animation ends invisible: drop .show then, so its button can never be tapped unseen.
    this.sparkTimer = window.setTimeout(() => this.hideSpark(), 3700);
  }

  private hideSpark(): void {
    clearTimeout(this.sparkTimer);
    this.sparkEl.classList.remove('show');
  }

  /** Big centre banner ("You are now a Pyroblade"): parchment card, the new look and the class emblem. */
  headline(title: string, sub = '', accent?: string): void {
    const c = this.ctrl;
    let art = '';
    try {
      const worn = c.wornClass();
      if (worn && title.includes(worn.name)) {
        const face = c.portraitUrl();
        const emb = c.iconUrl('cls', worn.id);
        art = `${face ? `<img class="hl-look" src="${esc(face)}" alt="" draggable="false">` : ''}${emb ? `<img class="hl-emb" src="${esc(emb)}" alt="" draggable="false">` : ''}`;
        accent ??= worn.color;
      }
    } catch {
      /* scene not ready */
    }
    $(this.headEl, '.hl-art').innerHTML = art;
    $(this.headEl, '.hl-art').classList.toggle('hidden', !art);
    $(this.headEl, '.hl-txt b').textContent = title;
    $(this.headEl, '.hl-txt small').textContent = sub;
    this.headEl.style.setProperty('--ac', accent ?? '#e9c46a');
    this.headEl.classList.remove('show');
    void this.headEl.offsetWidth;
    this.headEl.classList.add('show');
    clearTimeout(this.headTimer);
    this.headTimer = window.setTimeout(() => this.headEl.classList.remove('show'), 3400);
    this.updatePortrait(true);
  }

  // ================================================================ target, channel, cast, auto-travel

  setTarget(t: TargetInfo | null): void {
    if (!t) {
      if (this.targetKey !== '') {
        this.targetEl.classList.add('hidden');
        this.queueLayout();
      }
      this.targetKey = '';
      return;
    }
    // Combat may tag a raging warden's name "(enraged)": show it as the plate's enrage state instead.
    const enragedTag = /\s*\(enraged\)\s*$/i.test(t.name);
    const name = t.name.replace(/\s*\(enraged\)\s*$/i, '');
    const key = `${t.name}|${t.level}|${Math.ceil(t.hp)}|${t.maxHp}|${t.boss}`;
    if (key === this.targetKey) return;
    const fresh = this.targetKey === '' || !this.targetKey.startsWith(`${t.name}|`);
    this.targetKey = key;
    if (fresh) {
      this.targetSince = performance.now();
      this.setTargetIdle(false);
      // Portrait / short landscape: the target plate takes the zone plate's place in the top band at once (stacked
      // under it, a warden's plate reached down over the player at 1280×720).
      if ((this.lay.port || this.lay.short) && !this.zoneEl.classList.contains('gone')) {
        clearTimeout(this.zoneFade);
        this.zoneEl.classList.add('faded', 'gone');
        this.queueLayout();
      }
    }
    this.targetEl.classList.remove('hidden');
    this.targetEl.classList.toggle('boss', !!t.boss);
    this.targetEl.classList.toggle('elite', !!t.elite && !t.boss);
    if (fresh || !this.targetEl.querySelector('.tbar i')) {
      const pip = t.element ? this.ctrl.pipUrl('el', t.element.id) : '';
      const el = t.element
        ? pip
          ? `<img class="el" src="${esc(pip)}" alt="${esc(t.element.name)}" title="${esc(t.element.name)}" draggable="false">`
          : `<span class="el" style="--c:${hex(t.element.color)}" title="${esc(t.element.name)}"></span>`
        : '';
      const lv = levelClass(t.level, this.ctrl.session.player.level);
      const tag = t.boss ? '<em class="tg-tag warden">Warden</em>' : t.elite ? '<em class="tg-tag elite">Elite</em>' : '';
      this.targetEl.innerHTML = `<div class="tg-top">${el}<b class="tg-name">${digits(esc(name))}</b><small class="tg-lv ${lv}">Lv <span class="num">${t.level}</span></small>${tag}</div>
        <div class="tbar">${t.boss ? '<em class="tick" title="Enrage at half health"></em>' : ''}<i></i><span></span></div>`;
      this.queueLayout();
    }
    const pct = Math.max(0, (100 * t.hp) / t.maxHp);
    $(this.targetEl, '.tbar i').style.width = `${pct}%`;
    const span = this.targetEl.querySelector('.tbar span');
    if (span) span.textContent = t.boss ? `${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}` : t.hp < t.maxHp ? `${Math.round(pct)}%` : '';
    this.targetEl.classList.toggle('enraged', !!t.boss && t.hp > 0 && (enragedTag || pct < 50));
  }

  private setTargetIdle(idle: boolean): void {
    if (this.targetIdle === idle) return;
    this.targetIdle = idle;
    this.targetEl.classList.toggle('idle', idle);
    this.queueLayout();
  }

  /**
   * ≤ 10 Hz: the target plate shows while you fight, while the target is hurt, and for a few seconds after you pick
   * one; a full-HP target nobody is fighting (walked away, AUTO switched off) stops covering the field.
   */
  updateTarget(): void {
    if (!this.targetKey) return;
    let fighting = false;
    try {
      fighting = !!this.ctrl.inCombat?.();
    } catch {
      /* scene not ready */
    }
    const [, , hp, max] = this.targetKey.split('|');
    const full = Number(hp) >= Number(max);
    this.setTargetIdle(!fighting && full && performance.now() - this.targetSince > 4000);
  }

  /** The NPC quest marker as a data URL (the actors lane's art: '…' in progress, '?' ready), drawn once. */
  private markArt(ready: boolean): QuestMarkArt | null {
    const key = ready ? 'ready' : 'busy';
    if (this.marks[key] !== undefined) return this.marks[key] ?? null;
    let art: QuestMarkArt | null = null;
    try {
      const def = MARKER_ART[ready ? '?' : '…'];
      const c = document.createElement('canvas');
      c.width = def.w;
      c.height = def.h;
      const g = c.getContext('2d');
      if (g) {
        def.rows.forEach((row, y) =>
          [...row].forEach((ch, x) => {
            const col = def.pal[ch];
            if (!col) return;
            g.fillStyle = col;
            g.fillRect(x + 1, y + 1, 1, 1);
          }),
        );
        // The 1 px dark outline the world's markers wear.
        const img = g.getImageData(0, 0, def.w, def.h);
        const a = (x: number, y: number) => x >= 0 && y >= 0 && x < def.w && y < def.h && img.data[(y * def.w + x) * 4 + 3] > 128;
        g.fillStyle = '#24180f';
        for (let y = 0; y < def.h; y++)
          for (let x = 0; x < def.w; x++) if (!a(x, y) && (a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) g.fillRect(x, y, 1, 1);
        art = { url: c.toDataURL(), w: def.w, h: def.h };
      }
    } catch {
      art = null;
    }
    this.marks[key] = art;
    return art;
  }

  setChannel(label: string | null, progress = 0): void {
    if (label === null) {
      if (this.last.ch !== '') {
        this.last.ch = '';
        this.channelEl.classList.add('hidden');
        this.busy();
      }
      return;
    }
    if (this.last.ch !== label) {
      this.last.ch = label;
      this.channelEl.classList.remove('hidden');
      this.busy();
      $(this.channelEl, '.ch-label').textContent = label;
    }
    const w = `${Math.round(Math.min(100, progress * 100))}%`;
    if (this.last.chW !== w) {
      this.last.chW = w;
      $(this.channelEl, '.cbar i').style.width = w;
    }
  }

  /** Cast wind-up: shown above the bar and on the slot; animates smoothly between ≤ 10 Hz pushes. */
  setCast(c: CastInfo | null): void {
    const bar = $(this.castEl, '.cbar i');
    if (!c) {
      if (this.castKey) {
        this.castKey = '';
        this.castEl.classList.add('hidden');
        bar.style.transition = 'none';
        this.slotsEl.querySelectorAll('.slot.casting').forEach((b) => b.classList.remove('casting'));
        this.busy();
      }
      return;
    }
    const restart = this.castKey !== c.skill.id || c.progress + 0.02 < this.castProgress;
    this.castProgress = c.progress;
    if (!restart) return;
    this.castKey = c.skill.id;
    const el = c.skill.element ? this.ctrl.reg.element(c.skill.element) : undefined;
    this.castEl.style.setProperty('--c', el ? hex(el.color) : '#9fe0ff');
    ($(this.castEl, '.cb-ico') as HTMLImageElement).src = this.ctrl.iconUrl('skill', c.skill.id);
    $(this.castEl, '.cb-name').textContent = c.skill.name;
    this.castEl.classList.remove('hidden');
    this.busy();
    bar.style.transition = 'none';
    bar.style.width = `${Math.min(100, c.progress * 100)}%`;
    void bar.offsetWidth;
    bar.style.transition = `width ${Math.max(0, Math.round(c.remainMs))}ms linear`;
    bar.style.width = '100%';
    this.slotsEl.querySelectorAll('.slot.casting').forEach((b) => b.classList.remove('casting'));
    this.slotsEl.querySelector(`.slot[data-skill="${CSS.escape(c.skill.id)}"]`)?.classList.add('casting');
  }

  /** A channel / cast bar is up: the log stacked under it steps aside. */
  private busy(): void {
    this.el.classList.toggle('busy', !!this.castKey || !!this.last.ch);
  }

  /** Auto-travel pill: destination, portals left, Stop. */
  updateNav(): void {
    const c = this.ctrl;
    const nav = c.session.nav;
    let here = '';
    try {
      here = c.map().def.id;
    } catch {
      return;
    }
    const key = nav ? `${here}>${nav.target}` : '';
    if (key === this.navKey) return;
    this.navKey = key;
    if (!nav) {
      this.navEl.classList.add('hidden');
      this.queueLayout();
      return;
    }
    const route = discoveredRoute(c.world(), c.book, here, nav.target);
    const hops = route?.length ?? 0;
    const first = route?.[0] ? mapById(route[0].map)?.portals.find((p) => p.id === route[0].portal) : undefined;
    const next = first ? mapById(first.to.map)?.name : undefined;
    $(this.navEl, '.np-txt b').textContent = `To ${mapById(nav.target)?.name ?? nav.target}`;
    $(this.navEl, '.np-txt small').textContent = hops ? `${hops > 1 && next ? `Next: ${next} · ` : ''}${hops} ${hops === 1 ? 'portal' : 'portals'} to go` : 'Arriving';
    this.navEl.classList.remove('hidden');
    this.queueLayout();
  }

  private cancelNav(): void {
    const c = this.ctrl as NavController;
    if (c.cancelNavigate) c.cancelNavigate();
    else c.session.nav = null;
    this.navKey = '#';
    this.updateNav();
    this.toast('Auto-travel stopped.');
  }

  // ================================================================ log + toasts

  /** Compact log: the last 3 lines; the whole log fades LOG_QUIET_MS after its last line. */
  log(msg: string, kind: LogKind = 'info'): void {
    const line = document.createElement('div');
    line.className = `line ${kind}`;
    line.innerHTML = msg;
    wrapDigits(line);
    this.logEl.appendChild(line);
    while (this.logEl.children.length > 3) this.logEl.firstElementChild?.remove();
    this.logEl.classList.remove('quiet');
    clearTimeout(this.logTimer);
    this.logTimer = window.setTimeout(() => {
      this.logEl.classList.add('quiet');
      this.logTimer = window.setTimeout(() => this.logEl.replaceChildren(), 700);
    }, LOG_QUIET_MS);
  }

  /** Toast under the zone plate (max 3; the same text again just restarts its timer). */
  toast(msg: string): void {
    for (const el of Array.from(this.toastEl.children)) {
      if ((el as HTMLElement).dataset.msg === msg && !el.classList.contains('out')) {
        this.armToast(el as HTMLElement);
        el.classList.remove('bump');
        void (el as HTMLElement).offsetWidth;
        el.classList.add('bump');
        return;
      }
    }
    const t = document.createElement('div');
    t.className = 'toast';
    t.dataset.msg = msg;
    t.innerHTML = msg;
    wrapDigits(t);
    if (/^\s*(✔|Ready to turn in)/.test(msg) || /Ready to turn in/.test(msg)) t.classList.add('gold');
    this.toastEl.appendChild(t);
    while (this.toastEl.children.length > 3) this.toastEl.firstElementChild?.remove();
    this.armToast(t);
    this.fitToasts();
  }

  private armToast(t: HTMLElement): void {
    for (const id of this.toastTimers.get(t) ?? []) clearTimeout(id);
    t.classList.remove('out');
    this.toastTimers.set(t, [window.setTimeout(() => t.classList.add('out'), 2600), window.setTimeout(() => t.remove(), 3100)]);
  }

  // ================================================================ Pursuits tracker

  private pursuitsOpen(): boolean {
    if (this.pzOpen !== null) return this.pzOpen;
    const saved = store(PZ_KEY);
    if (saved === '1' || saved === '0') return (this.pzOpen = saved === '1');
    return false;
  }

  /** Tracked quests first, then at most 2 goals — each ONE line; tap → the quest log / the right panel. */
  renderPursuits(): void {
    this.t.pz = performance.now();
    let list: PursuitView[] = [];
    try {
      list = this.ctrl.pursuits();
    } catch {
      return;
    }
    this.pursuits = list;
    const one = pursuitLineHtml(list, list[0]?.kind === 'quest' ? this.markArt(!!list[0].ready) : null);
    const html = one + list.map((p, i) => pursuitHtml(p, i, p.icon ? this.ctrl.iconUrl(p.icon.kind, p.icon.id) : '', p.kind === 'quest' ? this.markArt(!!p.ready) : null)).join('');
    if (this.last.pz !== html) {
      const before = this.last.pzKeys ?? '';
      const keys = list.map((p) => p.key).join(',');
      this.last.pz = html;
      this.last.pzKeys = keys;
      this.pzList.innerHTML = html.slice(one.length);
      const tab = $(this.pzEl, '.pz-tab');
      tab.innerHTML = one;
      tab.setAttribute('aria-label', list[0] ? `${list[0].title}: ${list[0].line}. Tap for more.` : HUD_WORDS.pursuits);
      this.pzEl.classList.toggle('hidden', !list.length);
      const ready = list.filter((p) => p.ready).length;
      this.pzEl.classList.toggle('has-ready', ready > 0);
      // Something new while folded away: make the tab glow once.
      if (!this.pursuitsOpen() && keys !== before && before !== '') {
        const tab = $(this.pzEl, '.pz-tab');
        tab.classList.remove('nudge');
        void tab.offsetWidth;
        tab.classList.add('nudge');
      }
      this.applyPursuits();
    }
  }

  private applyPursuits(): void {
    const open = this.pursuitsOpen();
    this.pzEl.classList.toggle('open', open);
    $(this.pzEl, '.pz-tab').setAttribute('aria-expanded', String(open));
    this.queueLayout();
  }

  // ================================================================ skill bar

  private art(): HudArt {
    const c = this.ctrl;
    return {
      skill: (id) => c.iconUrl('skill', id),
      pip: (e) => c.pipUrl('el', e),
      cls: (id) => c.iconUrl('cls', id),
    };
  }

  /**
   * Renders the skill bar from ctrl.barSlots() (never a hard-coded size): class slots framed in the class colour with
   * its emblem (a faint emblem when empty), your slots plain. Tap = cast; hold your slot → the picker; hold a class
   * slot → that skill's card; tap an empty slot of yours → the picker.
   */
  renderHotbar(): void {
    const c = this.ctrl;
    const p = c.session.player;
    let slots: BarSlotView[];
    try {
      slots = c.barSlots();
    } catch {
      return;
    }
    this.slots = slots;
    let worn = null;
    try {
      worn = c.wornClass();
    } catch {
      /* scene not ready */
    }
    const art = this.art();
    this.sparkSkills.clear();
    for (const s of slots) if (s.skillId && c.reg.morphsFrom(s.skillId).some((m) => !!m.spark && !c.book.has(m.to))) this.sparkSkills.add(s.skillId);
    this.wornColor = worn?.color ?? '#e9c46a';
    this.last.weapon = p.weapon;
    let locks = 0;
    const html = slots
      .map((s) => {
        const lock = s.lock ? { need: s.lock.weapon, line: s.lock.line, owned: s.lock.owned } : s.skillId ? lockOf(c, s.skillId) : null;
        if (lock) locks++;
        const el = s.element ? c.reg.element(s.element) : undefined;
        return slotHtml(s, art, {
          lock: lock ?? undefined,
          elementColor: el ? hex(el.color) : undefined,
          auto: p.autoOn,
          classColor: s.kind === 'class' ? (worn && s.classId === worn.id ? worn.color : '#b0803a') : undefined,
          className: worn?.name,
          spark: !!s.skillId && this.sparkSkills.has(s.skillId),
        });
      })
      .join('');
    const classCount = slots.filter((s) => s.kind === 'class').length;
    this.slotsEl.innerHTML = html;
    this.hotbar.classList.toggle('has-class', classCount > 0);
    this.last = Object.fromEntries(Object.entries(this.last).filter(([k]) => !k.startsWith('slot:')));
    if (this.castKey) this.slotsEl.querySelector(`.slot[data-skill="${CSS.escape(this.castKey)}"]`)?.classList.add('casting');
    this.applyAuto(p.autoOn);
    this.updateCooldowns();
    this.queueLayout();
    this.updateMechanic();
    if (locks > 0) this.hint('weapon_lock', 'A dimmed skill needs another weapon. Tap it to equip that weapon.');
    if (classCount > 0) this.hint('class_slots', 'Your class fills the framed slots by itself.');
    if (slots.some((s) => s.kind === 'own' && s.skillId)) this.hint('own_slot_hold', 'Hold one of your slots to swap its skill.');
  }

  /**
   * The class mechanic widget above the bar (≤ 10 Hz): one widget for the worn class, hidden when it has none. The
   * first time a kind of widget shows, one line says what it is.
   */
  updateMechanic(): void {
    const v = mechanicOf(this.ctrl);
    const html = v ? mechanicHtml(v, v.color ?? this.wornColor) : '';
    if (html === this.mechKey) return;
    const shown = !!this.mechKey;
    this.mechKey = html;
    this.mechEl.innerHTML = html;
    if (shown !== !!html) {
      this.hotbar.classList.toggle('has-mech', !!html);
      this.queueLayout();
    }
    if (v) this.hint(`mech_${v.kind}`, mechanicHint(v));
  }

  private applyAuto(on: boolean): void {
    this.last.auto = on ? '1' : '';
    const b = this.autoBtn;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', String(on));
    $(b, '.pill').textContent = on ? HUD_WORDS.on : HUD_WORDS.off;
    this.atkBtn.classList.toggle('auto', on);
    this.slotsEl.querySelectorAll<HTMLElement>('.slot[data-skill]').forEach((s) => s.classList.toggle('auto', on));
  }

  /** Brief glow on the slot an auto-cast just fired (the attack button for the basic attack). */
  pulseSlot(skillId: string): void {
    const basic = WEAPONS[this.ctrl.session.player.weapon]?.basic;
    const b = skillId === basic ? this.atkBtn : this.slotsEl.querySelector<HTMLElement>(`.slot[data-skill="${CSS.escape(skillId)}"]`);
    if (!b) return;
    b.classList.remove('autofire');
    void b.offsetWidth;
    b.classList.add('autofire');
  }

  updateCooldowns(): void {
    const c = this.ctrl;
    const sp = c.session.player.sp;
    // Another weapon in hand: the locks on the bar change with it.
    if (this.last.weapon !== undefined && this.last.weapon !== c.session.player.weapon) {
      this.renderHotbar();
      return;
    }
    this.updateMechanic();
    if (this.syncSlotStates()) return;
    for (const b of $$<HTMLElement>(this.slotsEl, '.slot[data-skill]')) {
      const id = b.dataset.skill!;
      this.cooldownOn(b, id);
      const s = c.reg.skill(id);
      const ok = c.usable(id).ok;
      const noSp = !!s && s.spCost > sp;
      if (b.classList.contains('disabled') === ok) b.classList.toggle('disabled', !ok);
      if (b.classList.contains('nosp') !== noSp) b.classList.toggle('nosp', noSp);
      const prog = c.book.progress(id);
      if (prog) {
        const pct = `${Math.min(100, (100 * prog.xp) / Math.max(1, c.book.barSize(id)))}%`;
        if (this.last[`slot:${id}`] !== pct) {
          this.last[`slot:${id}`] = pct;
          b.querySelector<HTMLElement>('.xp i')?.style.setProperty('width', pct);
        }
      }
      const spk = b.querySelector<HTMLElement>('.spk');
      if (spk) {
        const w = c.sparkWindow(id);
        if (spk.dataset.w !== w) spk.dataset.w = w;
      }
    }
    // The attack button: the basic attack's cooldown and rank.
    const basic = WEAPONS[c.session.player.weapon]?.basic;
    if (basic) {
      this.cooldownOn(this.atkBtn, basic);
      const s = c.reg.skill(basic);
      const rank = c.book.rank(basic);
      const rk = s && rank > 0 ? (rank >= s.maxRank ? '★' : String(rank)) : '';
      if (this.last.atkRk !== rk) {
        this.last.atkRk = rk;
        const el = $(this.atkBtn, '.rk');
        el.textContent = rk;
        el.classList.toggle('hidden', !rk);
      }
    }
  }

  /**
   * The class mechanic changes what slots do between bar renders (≈ 3 Hz): "needs more Vow" dims a slot, a skill the
   * meter would power glows; a new weapon lock or a stance's other skill re-renders the bar (true then).
   */
  private syncSlotStates(): boolean {
    const now = performance.now();
    if (now - this.t.slots < 300) return false;
    this.t.slots = now;
    let slots: BarSlotView[];
    try {
      slots = this.ctrl.barSlots();
    } catch {
      return false;
    }
    const shape = (list: BarSlotView[]) => list.map((s) => `${s.skillId ?? ''}|${s.lock?.weapon ?? ''}|${s.lock?.owned ?? ''}|${s.castsAs?.skillId ?? ''}`).join(',');
    if (shape(slots) !== shape(this.slots)) {
      this.renderHotbar();
      return true;
    }
    for (const s of slots) {
      if (!s.skillId) continue;
      const prev = this.slots.find((x) => x.index === s.index);
      if (prev && !!prev.waiting === !!s.waiting && !!prev.boosted === !!s.boosted) continue;
      const b = this.slotsEl.querySelector<HTMLElement>(`.slot[data-slot="${s.index}"]`);
      if (!b) continue;
      const locked = b.classList.contains('wlocked');
      b.classList.toggle('waiting', !locked && !!s.waiting);
      b.classList.toggle('boost', !locked && !s.waiting && !!s.boosted);
      if (!locked) b.setAttribute('aria-label', s.waiting ? `${s.castsAs?.name ?? s.name ?? ''}: ${s.waiting}` : (s.castsAs?.name ?? s.name ?? ''));
    }
    this.slots = slots;
    return false;
  }

  private cooldownOn(b: HTMLElement, id: string): void {
    const { remain, total } = this.ctrl.cooldown(id);
    const f = total > 0 && remain > 0 ? Math.min(1, remain / total) : 0;
    const cd = b.querySelector<HTMLElement>('.cd');
    if (!cd) return;
    const v = f > 0 ? f.toFixed(3) : '0';
    if (cd.dataset.v !== v) {
      cd.dataset.v = v;
      cd.style.setProperty('--cd', v);
      b.classList.toggle('cooling', f > 0);
    }
    const txt = cd.querySelector('b');
    if (txt) {
      // Seconds from 1 s left (below that the wedge says enough; the icon stays clean).
      const s = f > 0 && remain >= 1000 ? cooldownText(remain) : '';
      if (txt.textContent !== s) txt.textContent = s;
    }
  }
}

/** The smallest body-face pixel that still reads on a touch screen, in CSS px (8 of them make a 13 px line). */
export const TEXT_MIN_PX = 1.6;

/**
 * CSS px per pixel of the body face: the HUD's art pixel (`px`) when that is at least TEXT_MIN_PX, else the smallest
 * whole number of device pixels that is (never a fraction of a device pixel: the face stays crisp).
 */
export function textPixel(px: number, dpr: number): number {
  const d = dpr > 0 && Number.isFinite(dpr) ? dpr : 1;
  if (px >= TEXT_MIN_PX - 1e-9) return px;
  return Math.max(Math.round(px * d), Math.ceil(TEXT_MIN_PX * d - 1e-6)) / d;
}
