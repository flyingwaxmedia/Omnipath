// UI facade (docs/CLIENT-v2.md §1/§7): created ONCE in main.ts and handed to every MapScene restart. Composes the
// HUD, minimap, dialogs and panels, and owns the shared modal (which panel is open, the discovery-card queue,
// pausing the world while anything modal is up). Everything the game asks of the DOM goes through here.
import type { GameController } from './controller';
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
import { renderAltar } from './panels/altar';
import { renderBag } from './panels/bag';
import { renderClasses } from './panels/classes';
import { renderCodex } from './panels/codex';
import type { PanelHost, PanelRender } from './panels/common';
import { renderMap } from './panels/map';
import { renderSkills } from './panels/skills';
import { renderTrainer } from './panels/trainer';
import { $ } from './util';

export { esc } from './util';
export type { DialogOption, DiscoveryCard } from './dialogs';
export type { CastInfo, TargetInfo } from './hud';

const PANELS: Record<string, PanelRender> = {
  skills: renderSkills,
  altar: renderAltar,
  classes: renderClasses,
  codex: renderCodex,
  bag: renderBag,
  trainer: renderTrainer,
  map: renderMap,
};

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
  private pendingDialog: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    readonly ctrl: GameController,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    parent.appendChild(this.root);
    this.hud = new Hud(this.root, ctrl, (p, a) => this.open(p, a));
    this.minimap = new Minimap(this.hud.el, ctrl, () => this.open('map'));
    this.modal = document.createElement('div');
    this.modal.className = 'modal hidden';
    this.root.appendChild(this.modal);
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal && !this.showingDiscovery && this.panel !== 'minigame') this.close();
    });
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // v2 discovery cards (spark, echo, passive, essence, class rank…): the book outlives map restarts, so once.
    wireDiscoveryCards(this, ctrl);
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
    this.minimap.update();
  }

  /** A new map was entered (scene restart): refresh everything map-dependent. */
  mapChanged(): void {
    this.renderHotbar();
    this.minimap.setMap();
    this.hud.updateVitals();
    this.hud.setTarget(null);
    this.hud.setChannel(null);
    this.hud.setCast(null);
    this.hud.updateNav();
  }

  banner(title: string, sub = ''): void {
    this.hud.banner(title, sub);
  }

  sparkBanner(title: string, sub = ''): void {
    this.hud.sparkBanner(title, sub);
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

  renderHotbar(): void {
    this.hud.renderHotbar(
      (i, empty) => {
        if (empty) this.open('skills');
        else this.ctrl.castSlot(i);
      },
      () => {
        const on = !this.ctrl.autoCastOn();
        this.ctrl.setAutoCastOn(on);
        this.toast(on ? '⟳ AUTO on: hunting the nearest foe' : 'AUTO off');
      },
    );
  }

  /** Brief glow on the hotbar slot an auto-cast just fired. */
  pulseSlot(skillId: string): void {
    this.hud.pulseSlot(skillId);
  }

  /**
   * CSS px the persistent HUD covers along each screen edge (vitals / minimap / menu row on top, a menu column on the
   * side, the hotbar at the bottom). The scene widens its camera bounds by these so nothing near a map edge hides
   * under the HUD.
   */
  safeInsets(): { top: number; right: number; bottom: number; left: number } {
    const W = window.innerWidth;
    const H = window.innerHeight;
    const out = { top: 0, right: 0, bottom: 0, left: 0 };
    for (const sel of ['.vitals', '.minimap', '.menu', '.hotbar']) {
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
    this.panel = name;
    this.panelArg = arg;
    this.modal.classList.remove('hidden');
    this.ctrl.setPaused(true);
    this.render();
  }

  close(): void {
    this.panel = null;
    this.panelArg = undefined;
    if (this.showingDiscovery) return;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    this.ctrl.setPaused(false);
    this.renderHotbar();
    if (this.discoveries.length) this.nextDiscovery();
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
    const scroll = this.modal.querySelector('.sheet-body')?.scrollTop ?? 0;
    const same = this.modal.dataset.panel === `${this.panel}:${this.panelArg ?? ''}`;
    fn(this, this.panelArg);
    this.modal.dataset.panel = `${this.panel}:${this.panelArg ?? ''}`;
    if (same) {
      const body = this.modal.querySelector('.sheet-body');
      if (body) body.scrollTop = scroll;
    }
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
      this.modal.dataset.panel = 'dialog';
      this.modal.classList.remove('hidden');
      this.ctrl.setPaused(true);
      renderDialog(this.modal, speaker, portrait, text, options.length ? options : [{ label: 'OK' }], () => this.close());
    };
    // A discovery card is up: show the dialog right after the cards.
    if (this.showingDiscovery) this.pendingDialog = show;
    else show();
  }

  discovery(card: DiscoveryCard): void {
    // Mid-fight cards (mastered, class rank, passive, essence, echo…) wait until the fight is over: the playtest saw
    // a Class Rank card pause the game in the middle of the Thunderhoof fight.
    if (this.ctrl.inCombat?.()) {
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
    if (this.held.length && this.ctrl.inCombat?.() && !long) return;
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
    this.showingDiscovery = true;
    this.modal.classList.remove('hidden');
    this.modal.dataset.panel = 'discovery';
    this.ctrl.setPaused(true);
    renderDiscovery(this.modal, card, this.discoveries.length > 0, () => {
      this.showingDiscovery = false;
      if (this.discoveries.length) this.nextDiscovery();
      else if (this.pendingDialog) {
        const d = this.pendingDialog;
        this.pendingDialog = null;
        d();
      } else if (this.panel && PANELS[this.panel]) this.render();
      else {
        this.panel = null;
        this.modal.classList.add('hidden');
        this.modal.innerHTML = '';
        this.ctrl.setPaused(false);
        this.renderHotbar();
      }
    });
  }

  private minigame<T>(run: (modal: HTMLElement, done: (v: T) => void) => void): Promise<T> {
    return new Promise((resolve) => {
      this.panel = 'minigame';
      this.modal.dataset.panel = 'minigame';
      this.modal.classList.remove('hidden');
      this.ctrl.setPaused(true);
      run(this.modal, (v) => {
        this.close();
        resolve(v);
      });
    });
  }

  forgeMinigame(): Promise<number> {
    return this.minigame(runForge);
  }

  fishingMinigame(): Promise<boolean> {
    return this.minigame(runFishing);
  }
}
