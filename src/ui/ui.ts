// UI facade (docs/CLIENT-v2.md §1/§7): created ONCE in main.ts and handed to every MapScene restart. Composes the
// HUD, minimap, dialogs and panels, and owns the shared modal (which panel is open, the discovery-card queue,
// pausing the world while anything modal is up). Everything the game asks of the DOM goes through here.
//
// v3 (docs/INTEGRATION-v3.md §2): owned by the HUD lane. The HUD itself is ./hud.ts (+ ./hud/*); this facade subscribes
// to ctrl.onChange once and owns the AUTO toasts. Panels come from three registries — PANELS (panels lane,
// ./panels/index.ts), STARCHART_PANELS (starchart lane, ./starchart/index.ts) and HUD_PANELS (HUD lane, ./picker.ts)
// — so lanes add panels without editing this file. Player-facing messages for game events: ./announce.ts (panels
// lane). Opening / closing the modal emits uiOpen / uiClose on the game bus; showing a card emits discovery.
import { gameBus } from '../game/events';
import { vfxSettings } from '../game/vfx/runtime/settings';
import { wireAnnouncements } from './announce';
import type { ChangeKind, GameController, NpcDialogView } from './controller';
import {
  type DialogOption,
  type DiscoveryCard,
  renderDialog,
  renderDiscovery,
  runFishing,
  runForge,
  wireDiscoveryCards,
} from './dialogs';
import { Hud, type CastInfo, type LogKind, type TargetInfo } from './hud';
import { Minimap } from './minimap';
import { OPENED_FROM, type OpenedFrom, type PanelHost, type PanelRender, RESUMING } from './panels/common';
import { PANELS as LANE_PANELS, PANELS_FULLSCREEN } from './panels/index';
import { openNpcDialog } from './panels/npc';
import { applyCalm } from './hud/settings';
import { HUD_PANELS } from './picker';
import { STARCHART_FULLSCREEN, STARCHART_PANELS } from './starchart/index';
import { $ } from './util';

export { esc } from './util';
export type { DialogOption, DiscoveryCard } from './dialogs';
export type { CastInfo, TargetInfo } from './hud';

/** Every panel by name (ui.open(name, arg)); the three lane registries never share a name. */
const PANELS: Record<string, PanelRender> = { ...LANE_PANELS, ...STARCHART_PANELS, ...HUD_PANELS };

/** Panels that cover the whole screen (uiOpen.fullscreen: the render lane may sleep the game loop). */
const FULLSCREEN: ReadonlySet<string> = new Set([...STARCHART_FULLSCREEN, ...PANELS_FULLSCREEN]);

/** Scroll containers whose position survives a re-render of the same panel (sheets; the NPC / object dialog). */
const SCROLLERS = ['.sheet-body', '.dialog'];

/** Open "More" / "Hint" / "Details" toggles (wireToggles) by quest + kind + label: a re-render reopens them. */
const TOGGLES = '[data-hint].open, [data-more].open';
const toggleKey = (b: Element): string =>
  `${b.closest('[data-quest]')?.getAttribute('data-quest') ?? ''}|${b.className.replace(/\bopen\b/, '').trim()}|${b.textContent?.trim() ?? ''}`;

/** Reopens the toggles listed in `keys` (each key once per entry) in `root`. */
function reopenToggles(root: ParentNode, keys: readonly string[]): void {
  if (!keys.length) return;
  const left = [...keys];
  root.querySelectorAll<HTMLElement>('[data-hint], [data-more]').forEach((b) => {
    const k = left.indexOf(toggleKey(b));
    const box = b.nextElementSibling as HTMLElement | null;
    if (k < 0 || !box) return;
    left.splice(k, 1);
    box.classList.remove('hidden');
    b.setAttribute('aria-expanded', 'true');
    b.classList.add('open');
  });
}

/** Layout top of `el` (offsets: its pop-in animation's scale ignored) from the visible top of the scroll box `box`. */
function topInView(el: HTMLElement, box: HTMLElement): number {
  const abs = (e: HTMLElement) => {
    let y = 0;
    for (let n: Element | null = e; n instanceof HTMLElement; n = n.offsetParent) y += n.offsetTop;
    return y;
  };
  return abs(el) - abs(box) - box.clientTop - box.scrollTop;
}

export class UI implements PanelHost {
  readonly root: HTMLElement;
  readonly hud: Hud;
  readonly minimap: Minimap;
  readonly modal: HTMLElement;
  readonly state: Record<string, unknown> = {};
  /** Open panel name, or 'dialog' / 'minigame'. */
  private panel: string | null = null;
  private panelArg: string | undefined;
  private discoveries: DiscoveryCard[] = [];
  /** Cards that arrived mid-fight (see discovery()). */
  private held: DiscoveryCard[] = [];
  private holdSince: number | null = null;
  private holdTimer: number | null = null;
  private showingDiscovery = false;
  /**
   * Dialogs and minigames that asked to open while a discovery card was up (and panels or dialogs asked for during a
   * minigame): they start once the cards / the minigame are done, in order.
   */
  private afterCards: (() => void)[] = [];
  /** The press that ends in a backdrop click started on the backdrop (not a long-press that opened the panel). */
  private backdropPress = false;
  /** Scroll positions of the panel a discovery card covered: restored when the card is done and the panel returns. */
  private covered: { key: string; scroll: number[]; toggles: string[] } | null = null;
  /** Mirrors the render lane's loop sleep (src/game/render/config.ts): uiOpen.fullscreen sleeps, uiClose / discovery wake. */
  private loopAsleep = false;
  /** The latest press on the HUD: when it went down / up and whether it started outside the modal (see constructor). */
  private press = { down: 0, up: 0, outside: false };
  /** When the modal last showed new content (a panel, dialog, card or minigame). */
  private shownAt = 0;
  /** Watchdog: when each problem was first seen (cleared once it is gone). */
  private watchSince = new Map<string, number>();
  /** Every repair the watchdog made (playtest / QA read it: `omnipath.ui.watchdogLog`, empty in a healthy run). */
  readonly watchdogLog: { at: number; problem: string; state: string }[] = [];

  constructor(
    parent: HTMLElement,
    readonly ctrl: GameController,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    // "Reduce shake & flashes" (☰ menu) also calms the HUD's own flash pulses.
    applyCalm(vfxSettings.reduceFlash, this.root);
    parent.appendChild(this.root);
    this.hud = new Hud(this.root, ctrl, {
      open: (p, a) => this.open(p, a),
      toggleAuto: () => this.toggleAuto(),
    });
    // The minimap docks under the top-right button row (a small collapsible widget; restyled in hud.css).
    this.minimap = new Minimap(this.hud.mmDock, ctrl, () => this.open('map'));
    this.modal = document.createElement('div');
    this.modal.className = 'modal hidden';
    this.root.appendChild(this.modal);
    // A tap on the backdrop closes the panel — only a tap that STARTED there: a long-press on a skill slot opens the
    // picker / card mid-press, and the click the browser makes when that finger lifts lands on the new backdrop.
    this.modal.addEventListener('pointerdown', (e) => {
      this.backdropPress = e.target === this.modal;
    });
    this.modal.addEventListener('click', (e) => {
      const tapped = this.backdropPress;
      this.backdropPress = false;
      if (e.target === this.modal && tapped && !this.showingDiscovery && this.panel !== 'minigame') this.close();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // A hold that opens the modal mid-press (long-press on a slot → the picker or a skill card; a card arriving under
    // the finger) ends in a click the browser aims at whatever now lies under that finger: a picker tile would equip
    // and close at once. That one click is swallowed; presses that start on the modal, and clicks made any other way
    // (keyboard, code), are untouched.
    this.root.addEventListener(
      'pointerdown',
      (e) => {
        const outside = this.modal.classList.contains('hidden') || !this.modal.contains(e.target as Node);
        this.press = { down: performance.now(), up: 0, outside };
      },
      true,
    );
    const lifted = () => {
      if (!this.press.up) this.press.up = performance.now();
    };
    // On the window: a finger that slides off the HUD and lifts over the world still ends the press (a press left
    // "down" would swallow the next click made without one — keyboard, or code).
    window.addEventListener('pointerup', lifted, true);
    window.addEventListener('pointercancel', lifted, true);
    this.modal.addEventListener(
      'click',
      (e) => {
        const p = this.press;
        const openedMidPress = p.outside && p.down > 0 && p.down < this.shownAt && (p.up === 0 || p.up >= this.shownAt);
        p.outside = false; // one click per press at most
        if (openedMidPress && performance.now() - (p.up || performance.now()) < 700) {
          e.stopPropagation();
          e.preventDefault();
        }
      },
      true,
    );
    // v2 discovery cards (spark, echo, passive, essence, class rank…): the book outlives map restarts, so once.
    wireDiscoveryCards(this, ctrl);
    // Logs, toasts, cards and banners for every book / game-bus event (also once).
    wireAnnouncements(this, ctrl);
    // The change feed (once, run-wide): bar, Pursuits, portrait and stat strip, then the open panel.
    ctrl.onChange((what) => this.changed(what));
    // Never paused (or asleep) without a panel or card to close: see watchdog().
    gameBus.on('uiOpen', (e) => (this.loopAsleep = e.fullscreen));
    gameBus.on('uiClose', () => (this.loopAsleep = false));
    gameBus.on('discovery', () => (this.loopAsleep = false));
    window.setInterval(() => this.watchdog(), 500);
  }

  private changes = new Set<ChangeKind>();
  private changeQueued = false;

  /** Coalesces the change feed: one re-render per burst of bus / book events. */
  private changed(what: ChangeKind): void {
    this.changes.add(what);
    if (this.changeQueued) return;
    this.changeQueued = true;
    queueMicrotask(() => {
      this.changeQueued = false;
      const k = new Set(this.changes);
      this.changes.clear();
      if (k.has('bar') || k.has('class') || k.has('skills')) this.hud.renderHotbar();
      if (k.has('quests') || k.has('skills') || k.has('class')) this.hud.renderPursuits();
      if (k.has('class')) this.hud.updatePortrait(true);
      if (this.panel && PANELS[this.panel] && !this.showingDiscovery) this.render();
    });
  }

  /** The AUTO switch (one switch for every skill, the basic attack included). */
  private toggleAuto(): void {
    const on = !this.ctrl.autoCastOn();
    this.ctrl.setAutoCastOn(on);
    this.toast(on ? 'AUTO is on: you fight by yourself.' : 'AUTO is off.');
  }

  // ================================================================ HUD passthroughs

  updateVitals(): void {
    this.hud.updateVitals();
  }

  updateCooldowns(): void {
    this.hud.updateCooldowns();
  }

  /** ≤ 10 Hz HUD refresh from the scene. */
  tick(): void {
    this.hud.updateVitals();
    this.hud.updateCooldowns();
    this.hud.updateNav();
    this.hud.updateTarget();
    this.minimap.update();
  }

  /** A new map was entered (scene restart): refresh everything map-dependent. */
  mapChanged(): void {
    this.renderHotbar();
    this.minimap.setMap();
    this.hud.renderZone();
    this.hud.renderPursuits();
    this.hud.updatePortrait();
    this.hud.updateQuick();
    this.hud.updateBadges();
    this.hud.updateVitals();
    this.hud.setTarget(null);
    this.hud.setChannel(null);
    this.hud.setCast(null);
    this.hud.updateNav();
  }

  banner(title: string, sub = ''): void {
    this.hud.banner(title, sub);
  }

  /** Mid-fight banner (a sudden insight); with `skillId` its "See it" button opens that skill's card. */
  sparkBanner(title: string, sub = '', skillId = ''): void {
    this.hud.sparkBanner(title, sub, skillId);
  }

  /** Big centre banner ("You are now a Pyroblade"): parchment card with the new look and the class emblem. */
  headline(title: string, sub = '', accent?: string): void {
    this.hud.headline(title, sub, accent);
  }

  /** Talking to an NPC (Interactions): the NPC dialog with its quests (./panels/npc.ts). */
  npcDialog(view: NpcDialogView): void {
    openNpcDialog(this, view);
  }

  setTarget(t: TargetInfo | null): void {
    this.hud.setTarget(t);
  }

  setChannel(label: string | null, progress = 0): void {
    this.hud.setChannel(label, progress);
  }

  /** Skill wind-up in progress (pushed at the HUD tick), or null. */
  setCast(c: CastInfo | null): void {
    this.hud.setCast(c);
  }

  log(msg: string, kind: LogKind = 'info'): void {
    this.hud.log(msg, kind);
  }

  toast(msg: string): void {
    this.hud.toast(msg);
  }

  /**
   * The skill bar from ctrl.barSlots(): tap = cast; an empty slot of yours → open('picker', slot); hold your slot →
   * the picker; hold a class slot → open('skill', id) (the class manages those slots).
   */
  renderHotbar(): void {
    this.hud.renderHotbar();
  }

  /** Brief glow on the hotbar slot an auto-cast just fired. */
  pulseSlot(skillId: string): void {
    this.hud.pulseSlot(skillId);
  }

  /**
   * CSS px the persistent HUD covers along each screen edge (player plate / button row on top, the skill bar and EXP
   * bar at the bottom). The scene widens its camera bounds by these so nothing near a map edge hides under the HUD.
   */
  safeInsets(): { top: number; right: number; bottom: number; left: number } {
    // The scene asks right after mapChanged() / on resize: settle the HUD layout first so the rects are final.
    this.hud.layout();
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out = { top: 0, right: 0, bottom: 0, left: 0 };
    // The zone plate and the minimap count too: on portrait phones they sit under the button rows, and a portal on
    // the north border must not hide under them (playtest: mirror_lake#islet).
    for (const sel of ['.hud-me .me-plate', '.hud-right .menu', '.hud-right .mm-dock', '.hud-centre .zone-banner', '.hotbar .slots', '.expbar']) {
      const el = this.root.querySelector<HTMLElement>(sel);
      if (!el) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1 || getComputedStyle(el).visibility === 'hidden') continue;
      const column = r.height > r.width && r.height > H * 0.3;
      if (column) {
        if (r.right > W * 0.8) out.right = Math.max(out.right, W - r.left);
        else if (r.left < W * 0.2) out.left = Math.max(out.left, r.right);
      } else if (r.top < H * 0.2) out.top = Math.max(out.top, r.bottom);
      else if (r.bottom > H * 0.8) out.bottom = Math.max(out.bottom, H - r.top);
    }
    return out;
  }

  // ================================================================ modal plumbing

  get isOpen(): boolean {
    return this.panel !== null || this.showingDiscovery;
  }

  /** The open panel ('skills', 'altar', …, 'dialog', 'minigame') or null. */
  get current(): string | null {
    return this.panel;
  }

  open(name: string, arg?: string): void {
    if (!PANELS[name]) return;
    // A minigame finishes first: replaced, it never resolved (the forge's ore was spent for nothing). That happened
    // when a card's "See it" opened a panel just as the minigame queued behind that card started.
    if (this.panel === 'minigame') {
      this.afterCards.push(() => this.open(name, arg));
      return;
    }
    // Opened over another panel (a Star Chart card's Equip → the picker): remember it so the new one can go back.
    if (this.panel && this.panel !== name && PANELS[this.panel] && this.modal.dataset.panel?.startsWith(`${this.panel}:`))
      this.state[OPENED_FROM] = { panel: this.panel, ...(this.panelArg !== undefined ? { arg: this.panelArg } : {}) } satisfies OpenedFrom;
    else if (this.panel !== name) delete this.state[OPENED_FROM];
    this.panel = name;
    this.panelArg = arg;
    this.backdropPress = false;
    this.shownAt = performance.now();
    this.modal.classList.remove('hidden');
    this.ctrl.setPaused(true);
    gameBus.emit('uiOpen', { panel: name, ...(arg !== undefined ? { arg } : {}), fullscreen: FULLSCREEN.has(name) });
    this.render();
  }

  close(): void {
    const was = this.panel;
    this.panel = null;
    this.panelArg = undefined;
    delete this.state[OPENED_FROM];
    if (this.showingDiscovery) return;
    if (was) gameBus.emit('uiClose', { panel: was });
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    delete this.modal.dataset.panel;
    this.covered = null;
    this.ctrl.setPaused(false);
    this.renderHotbar();
    // Cards that waited behind the panel / dialog, then dialogs and minigames that waited behind cards (a second one
    // queued behind the same card used to be dropped: its minigame never finished).
    if (this.discoveries.length) this.nextDiscovery();
    else if (this.afterCards.length) this.afterCards.shift()!();
  }

  /** Re-renders the open panel (no-op while a discovery card or dialog is up) and the hotbar. */
  refresh(): void {
    if (this.panel && PANELS[this.panel] && !this.showingDiscovery) this.render();
    this.renderHotbar();
  }

  render(): void {
    if (!this.panel || this.showingDiscovery) return;
    const fn = PANELS[this.panel];
    if (!fn) return;
    const key = `${this.panel}:${this.panelArg ?? ''}`;
    // Back from a discovery card (Accept / Complete in an NPC dialog often teaches something): the card replaced the
    // panel's DOM, so its scroll comes from what it was when the card covered it.
    const memo = this.covered?.key === key ? this.covered : null;
    this.covered = null;
    const scroll = memo?.scroll ?? SCROLLERS.map((sel) => this.modal.querySelector(sel)?.scrollTop ?? 0);
    const rewardShown = memo ? false : this.rewardTopShown();
    const same = !!memo || this.modal.dataset.panel === key;
    const toggles = memo?.toggles ?? (same ? [...this.modal.querySelectorAll(TOGGLES)].map(toggleKey) : []);
    fn(this, this.panelArg);
    this.modal.dataset.panel = key;
    if (same) {
      // …with the same "More" / "Hint" boxes open (else the content above the fold shrinks and the view jumps)…
      reopenToggles(this.modal, toggles);
      // Accept / Complete / equip re-render the panel: stay where the player was scrolled…
      SCROLLERS.forEach((sel, i) => {
        const el = this.modal.querySelector(sel);
        if (el && scroll[i]) el.scrollTop = scroll[i];
      });
      // …but a fresh "Quest complete!" card in an NPC dialog comes into view (its top), and stays in view through the
      // re-renders that follow (the NPC's next line can push it down) unless the player scrolled it away.
      if (rewardShown !== false && this.rewardTopShown() === false) {
        const win = this.modal.querySelector<HTMLElement>('.qwin')!;
        const box = win.closest<HTMLElement>(SCROLLERS.join(', '))!;
        box.scrollTop += topInView(win, box) - 8;
      }
    }
  }

  /** Whether the reward card's top is in its scroller's view (null: no reward card). */
  private rewardTopShown(): boolean | null {
    const win = this.modal.querySelector<HTMLElement>('.qwin');
    const box = win?.closest<HTMLElement>(SCROLLERS.join(', '));
    if (!win || !box) return null;
    const y = topInView(win, box);
    return y >= -1 && y <= box.clientHeight - 24;
  }

  sheet(title: string, body: string, extraClass = ''): HTMLElement {
    this.modal.innerHTML = `
      <div class="sheet ${extraClass}" role="dialog" aria-label="${title.replace(/<[^>]+>/g, '')}">
        <header><h2>${title}</h2><button class="x" aria-label="Close">✕</button></header>
        <div class="sheet-body">${body}</div>
      </div>`;
    $(this.modal, '.x').addEventListener('click', () => this.close());
    return $(this.modal, '.sheet-body');
  }

  // ================================================================ dialogs, cards, minigames

  dialog(speaker: string, portrait: string, text: string, options: DialogOption[]): void {
    const show = () => {
      this.panel = 'dialog';
      this.panelArg = undefined;
      this.backdropPress = false;
      this.shownAt = performance.now();
      this.modal.dataset.panel = 'dialog';
      this.modal.classList.remove('hidden');
      this.ctrl.setPaused(true);
      gameBus.emit('uiOpen', { panel: 'dialog', fullscreen: false });
      renderDialog(this.modal, speaker, portrait, text, options.length ? options : [{ label: 'OK' }], () => this.close());
    };
    // A discovery card (or a minigame) is up: show the dialog right after it.
    if (this.showingDiscovery || this.panel === 'minigame') this.afterCards.push(show);
    else show();
  }

  /**
   * The player is on the way to talk to someone (an NPC / object tap still walking): a card now would pause the walk
   * and swallow the tap — cards wait until that dialog has opened and closed again.
   */
  private talkPending(): boolean {
    try {
      return !!(this.ctrl as GameController & { interactions?: { pending?: unknown } }).interactions?.pending;
    } catch {
      return false;
    }
  }

  discovery(card: DiscoveryCard): void {
    // Mid-fight cards (mastered, class rank, passive, essence, echo…) wait until the fight is over: the playtest saw
    // a Class Rank card pause the game in the middle of the Thunderhoof fight. Same while walking up to an NPC.
    if (this.ctrl.inCombat?.() || this.talkPending()) {
      this.held.push(card);
      this.holdSince ??= Date.now();
      this.holdTimer ??= window.setInterval(() => this.releaseHeld(), 500);
      return;
    }
    this.discoveries.push(card);
    if (!this.showingDiscovery && this.panel !== 'dialog' && this.panel !== 'minigame') this.nextDiscovery();
  }

  /** Shows held cards once the fight is over (or after 30 s anyway). */
  private releaseHeld(): void {
    const long = this.holdSince !== null && Date.now() - this.holdSince > 30000;
    if (this.held.length && (this.ctrl.inCombat?.() || this.talkPending()) && !long) return;
    window.clearInterval(this.holdTimer ?? undefined);
    this.holdTimer = null;
    this.holdSince = null;
    const cards = this.held.splice(0);
    if (!cards.length) return;
    this.discoveries.push(...cards);
    if (!this.showingDiscovery && this.panel !== 'dialog' && this.panel !== 'minigame') this.nextDiscovery();
  }

  private nextDiscovery(): void {
    const card = this.discoveries.shift();
    if (!card) return;
    // The card is about to replace a panel's DOM: remember where it was scrolled (render() puts it back).
    const under = this.modal.dataset.panel;
    if (!this.showingDiscovery && this.panel && under === `${this.panel}:${this.panelArg ?? ''}`)
      this.covered = {
        key: under,
        scroll: SCROLLERS.map((sel) => this.modal.querySelector(sel)?.scrollTop ?? 0),
        toggles: [...this.modal.querySelectorAll(TOGGLES)].map(toggleKey),
      };
    this.showingDiscovery = true;
    this.backdropPress = false;
    this.shownAt = performance.now();
    this.modal.classList.remove('hidden');
    this.modal.dataset.panel = 'discovery';
    this.ctrl.setPaused(true);
    gameBus.emit('discovery', { kind: card.kind ?? card.kicker.toLowerCase(), title: card.title });
    renderDiscovery(this.modal, card, this.discoveries.length > 0, () => {
      this.showingDiscovery = false;
      if (this.discoveries.length) this.nextDiscovery();
      else if (this.afterCards.length) this.afterCards.shift()!();
      else if (this.panel && PANELS[this.panel]) {
        // Back to the panel under the card. A full-screen one hides the world again: re-emit its uiOpen so the game
        // loop goes back to sleep (the card woke it) — flagged as a resume, so the panel keeps its selection.
        if (FULLSCREEN.has(this.panel)) {
          this.state[RESUMING] = true;
          gameBus.emit('uiOpen', { panel: this.panel, ...(this.panelArg !== undefined ? { arg: this.panelArg } : {}), fullscreen: true });
        }
        this.render();
        delete this.state[RESUMING];
        // A panel that draws nothing again (an object dialog shares the name 'dialog' with no NPC) would leave this
        // card on screen with a dead OK button: close instead.
        if (!this.showingDiscovery && this.modal.querySelector(':scope > .discovery')) this.close();
      } else {
        this.panel = null;
        this.modal.classList.add('hidden');
        this.modal.innerHTML = '';
        this.ctrl.setPaused(false);
        gameBus.emit('uiClose', { panel: 'discovery' });
        this.renderHotbar();
      }
    });
  }

  /**
   * A minigame takes the modal. If a discovery card is up (an NPC option such as Forge closes the dialog, which lets
   * the cards that waited behind it show), the minigame starts once the cards are done — never over a card (that left
   * the modal stuck with the card lost).
   */
  private minigame<T>(run: (modal: HTMLElement, done: (v: T) => void) => void): Promise<T> {
    return new Promise((resolve) => {
      const start = () => {
        this.panel = 'minigame';
        this.backdropPress = false;
        this.shownAt = performance.now();
        this.modal.dataset.panel = 'minigame';
        this.modal.classList.remove('hidden');
        this.ctrl.setPaused(true);
        gameBus.emit('uiOpen', { panel: 'minigame', fullscreen: false });
        run(this.modal, (v) => {
          this.close();
          resolve(v);
        });
      };
      if (this.showingDiscovery || this.panel === 'minigame') this.afterCards.push(start);
      else start();
    });
  }

  // ================================================================ watchdog

  /**
   * The softlock guard: the world is never paused (or its loop asleep) without a visible panel or card to close, and the
   * modal never shows something the UI does not know is open. Every 0.5 s each invariant is checked; one broken for
   * 1.5 s is repaired (resume / wake / show the queued card / close the stale modal) and logged — `watchdogLog` always,
   * the console in dev builds. A healthy run never trips it (scripts/playtest.mjs asserts that).
   */
  private watchdog(): void {
    const state = this.ctrl.pauseState?.() ?? 'running';
    const m = this.modal;
    const shown = !m.classList.contains('hidden') && m.childElementCount > 0;
    const card = !!m.querySelector(':scope > .discovery');
    const checks: [string, boolean, () => void][] = [
      ['paused with no panel open', state === 'paused' && !this.isOpen, () => this.ctrl.setPaused(false)],
      ['loop asleep with no panel open', this.loopAsleep && !this.isOpen, () => gameBus.emit('uiClose', { panel: 'watchdog' })],
      ['open but nothing shown', this.isOpen && !shown, () => this.recover()],
      ['card flag without a card', this.showingDiscovery && !card, () => this.recover()],
      ['card left on screen', card && !this.showingDiscovery, () => this.recover()],
      ['modal shown with nothing open', shown && !this.isOpen, () => this.recover()],
      ['cards queued behind nothing', this.discoveries.length > 0 && !this.isOpen, () => this.nextDiscovery()],
      ['dialog queued behind no card', this.afterCards.length > 0 && !this.showingDiscovery && this.panel === null, () => this.afterCards.shift()!()],
      ['held cards with no timer', this.held.length > 0 && this.holdTimer === null, () => (this.holdTimer = window.setInterval(() => this.releaseHeld(), 500))],
      ['panel open over a running world', this.isOpen && state === 'running', () => this.ctrl.setPaused(true)],
    ];
    const now = performance.now();
    for (const [problem, bad, fix] of checks) {
      if (!bad) {
        this.watchSince.delete(problem);
        continue;
      }
      const since = this.watchSince.get(problem) ?? now;
      this.watchSince.set(problem, since);
      if (now - since < 1500) continue;
      this.watchSince.delete(problem);
      const at = `panel=${this.panel ?? '-'}${this.panelArg !== undefined ? `:${this.panelArg}` : ''} card=${this.showingDiscovery} queued=${this.discoveries.length} held=${this.held.length} after=${this.afterCards.length} world=${state} asleep=${this.loopAsleep} modal=${m.dataset.panel ?? '-'}${shown ? '' : ' (hidden)'}`;
      this.watchdogLog.push({ at: Math.round(now), problem, state: at });
      if (this.watchdogLog.length > 50) this.watchdogLog.shift();
      if (import.meta.env.DEV) console.warn(`[omnipath] watchdog: ${problem} — repaired (${at})`);
      try {
        fix();
      } catch (e) {
        if (import.meta.env.DEV) console.warn('[omnipath] watchdog repair failed', e);
      }
      return; // one repair per tick: the next tick re-reads the new state
    }
  }

  /** Brings the modal back to a consistent state: the queued card, else the open panel drawn again, else closed. */
  private recover(): void {
    this.showingDiscovery = false;
    if (this.discoveries.length) {
      this.nextDiscovery();
      return;
    }
    const fn = this.panel ? PANELS[this.panel] : undefined;
    // Object dialogs ('dialog' with no NPC) and minigames cannot be drawn again: those close.
    if (fn && !(this.panel === 'dialog' && this.panelArg === undefined)) {
      this.modal.classList.remove('hidden');
      delete this.modal.dataset.panel;
      this.ctrl.setPaused(true);
      this.render();
      if (this.modal.childElementCount > 0 && !this.modal.querySelector(':scope > .discovery')) return;
    }
    this.close();
  }

  forgeMinigame(): Promise<number> {
    return this.minigame(runForge);
  }

  fishingMinigame(): Promise<boolean> {
    return this.minigame(runFishing);
  }
}
