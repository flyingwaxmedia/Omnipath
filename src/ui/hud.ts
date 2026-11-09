// HUD (docs/CLIENT-v2.md §7): vitals, menu column, zone banner, target pill (warden mode), hotbar (rank badge,
// mastery ring, cooldown, element badge, spark glyph), log, toasts, channel bar and the spark banner.
// Updates are throttled by the caller (≤ 10 Hz) and only touch the DOM when a value changed.
import { classMaxRank, classXpToNext } from '../core/classes';
import type { ElementDef, SkillDef } from '../core/types';
import { WEAPONS } from '../data/weapons';
import { expToNext } from '../game/session';
import type { GameController } from './controller';
import { $, $$, esc } from './util';

export interface TargetInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  element?: ElementDef;
  boss?: boolean;
  elite?: boolean;
}

export type LogKind = 'info' | 'good' | 'rare' | 'warn' | 'loot';

export const MENU: { panel: string; icon: string; label: string }[] = [
  { panel: 'skills', icon: '📖', label: 'Skills' },
  { panel: 'altar', icon: '⚗️', label: 'Fuse' },
  { panel: 'classes', icon: '🏛️', label: 'Class' },
  { panel: 'codex', icon: '📜', label: 'Codex' },
  { panel: 'bag', icon: '🎒', label: 'Bag' },
  { panel: 'map', icon: '🗺️', label: 'Map' },
];

export class Hud {
  readonly el: HTMLElement;
  private hotbar!: HTMLElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private zoneEl!: HTMLElement;
  private channelEl!: HTMLElement;
  private sparkEl!: HTMLElement;
  private vit: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private targetKey = '';
  private sparkSkills = new Set<string>();

  constructor(
    readonly root: HTMLElement,
    private ctrl: GameController,
    private onMenu: (panel: string, arg?: string) => void,
  ) {
    this.el = document.createElement('div');
    this.el.className = 'hud-layer';
    root.appendChild(this.el);
    this.el.innerHTML = `
      <div class="hud">
        <div class="vitals panel-glass">
          <div class="who"><span class="pname"></span> <span class="plv"></span></div>
          <div class="pclass"></div>
          <div class="bar hp"><i></i><span></span></div>
          <div class="bar sp"><i></i><span></span></div>
          <div class="bar xp"><i></i></div>
        </div>
        <div class="menu">${MENU.map(
          (m) => `<button data-panel="${m.panel}" title="${m.label}" aria-label="${m.label}"><b>${m.icon}</b><small>${m.label}</small></button>`,
        ).join('')}</div>
      </div>
      <div class="zone-banner"><b></b><small></small></div>
      <div class="spark-banner"><b></b><small></small></div>
      <div class="target panel-glass hidden"></div>
      <div class="channel hidden"><div class="ch-label"></div><div class="bar"><i></i></div></div>
      <div class="log"></div>
      <div class="hotbar"></div>
      <div class="toasts"></div>`;
    this.hotbar = $(this.el, '.hotbar');
    this.logEl = $(this.el, '.log');
    this.toastEl = $(this.el, '.toasts');
    this.targetEl = $(this.el, '.target');
    this.zoneEl = $(this.el, '.zone-banner');
    this.channelEl = $(this.el, '.channel');
    this.sparkEl = $(this.el, '.spark-banner');
    for (const k of ['pname', 'plv', 'pclass']) this.vit[k] = $(this.el, `.${k}`);
    this.vit.hpI = $(this.el, '.bar.hp i');
    this.vit.hpS = $(this.el, '.bar.hp span');
    this.vit.spI = $(this.el, '.bar.sp i');
    this.vit.spS = $(this.el, '.bar.sp span');
    this.vit.xpI = $(this.el, '.bar.xp i');
    $$<HTMLButtonElement>(this.el, '.menu button').forEach((b) => b.addEventListener('click', () => this.onMenu(b.dataset.panel!)));
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The menu column element (the minimap docks next to it). */
  get menuEl(): HTMLElement {
    return $(this.el, '.hud');
  }

  private set(key: string, el: HTMLElement, value: string, prop: 'text' | 'width' = 'text'): void {
    if (this.last[key] === value) return;
    this.last[key] = value;
    if (prop === 'text') el.textContent = value;
    else el.style.width = value;
  }

  updateVitals(): void {
    const c = this.ctrl;
    const p = c.session.player;
    const st = c.stats();
    const worn = c.book.state.worn ? c.reg.classDef(c.book.state.worn) : undefined;
    const prog = worn ? c.book.state.classes[worn.id] : undefined;
    this.set('name', this.vit.pname, p.name);
    this.set('lv', this.vit.plv, `Lv ${p.level}`);
    const cls = worn && prog
      ? `${worn.icon} ${worn.name} · CR ${prog.rank}${
          prog.rank < classMaxRank(worn) ? ` (${Math.floor((100 * prog.xp) / classXpToNext(prog.rank, worn.tier))}%)` : ' (max)'
        }`
      : `${WEAPONS[p.weapon].icon} Novice`;
    this.set('cls', this.vit.pclass, cls);
    this.set('hpI', this.vit.hpI, `${Math.max(0, (100 * p.hp) / st.maxHp)}%`, 'width');
    this.set('hpS', this.vit.hpS, `${Math.max(0, Math.ceil(p.hp))} / ${st.maxHp}`);
    this.set('spI', this.vit.spI, `${Math.max(0, (100 * p.sp) / st.maxSp)}%`, 'width');
    this.set('spS', this.vit.spS, `${Math.floor(p.sp)} / ${st.maxSp}`);
    this.set('xpI', this.vit.xpI, `${(100 * p.exp) / expToNext(p.level)}%`, 'width');
  }

  banner(title: string, sub = ''): void {
    $(this.zoneEl, 'b').textContent = title;
    $(this.zoneEl, 'small').textContent = sub;
    this.zoneEl.classList.remove('show');
    void this.zoneEl.offsetWidth;
    this.zoneEl.classList.add('show');
  }

  sparkBanner(title: string, sub = ''): void {
    $(this.sparkEl, 'b').textContent = title;
    $(this.sparkEl, 'small').textContent = sub;
    this.sparkEl.classList.remove('show');
    void this.sparkEl.offsetWidth;
    this.sparkEl.classList.add('show');
  }

  setTarget(t: TargetInfo | null): void {
    if (!t) {
      if (this.targetKey !== '') this.targetEl.classList.add('hidden');
      this.targetKey = '';
      return;
    }
    const key = `${t.name}|${t.level}|${Math.ceil(t.hp)}|${t.maxHp}|${t.boss}`;
    if (key === this.targetKey) return;
    const fresh = this.targetKey === '' || !this.targetKey.startsWith(`${t.name}|`);
    this.targetKey = key;
    this.targetEl.classList.remove('hidden');
    this.targetEl.classList.toggle('boss', !!t.boss);
    this.targetEl.classList.toggle('elite', !!t.elite);
    if (fresh || !this.targetEl.querySelector('.bar.tgt i')) {
      const el = t.element ? `<span class="el" title="${t.element.name}">${t.element.icon}</span>` : '<span class="el">◯</span>';
      this.targetEl.innerHTML = `${el}<b>${esc(t.name)}</b> <small>Lv ${t.level}${t.boss ? ' · Warden' : t.elite ? ' · Elite' : ''}</small>
        <div class="bar tgt"><i></i>${t.boss ? '<span></span>' : ''}</div>`;
    }
    $(this.targetEl, '.bar.tgt i').style.width = `${Math.max(0, (100 * t.hp) / t.maxHp)}%`;
    const span = this.targetEl.querySelector('.bar.tgt span');
    if (span) span.textContent = `${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}`;
  }

  setChannel(label: string | null, progress = 0): void {
    if (label === null) {
      this.channelEl.classList.add('hidden');
      return;
    }
    this.channelEl.classList.remove('hidden');
    $(this.channelEl, '.ch-label').textContent = label;
    $(this.channelEl, '.bar i').style.width = `${Math.min(100, progress * 100)}%`;
  }

  log(msg: string, kind: LogKind = 'info'): void {
    const line = document.createElement('div');
    line.className = `line ${kind}`;
    line.innerHTML = msg;
    this.logEl.appendChild(line);
    while (this.logEl.children.length > 6) this.logEl.firstElementChild?.remove();
    setTimeout(() => line.classList.add('fade'), 9000);
  }

  toast(msg: string): void {
    const t = document.createElement('div');
    t.className = 'toast';
    t.innerHTML = msg;
    this.toastEl.appendChild(t);
    while (this.toastEl.children.length > 4) this.toastEl.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  // ---------------------------------------------------------------- hotbar

  renderHotbar(onSlot: (i: number, empty: boolean) => void): void {
    const c = this.ctrl;
    const p = c.session.player;
    const basic = c.reg.skill(WEAPONS[p.weapon].basic)!;
    this.sparkSkills.clear();
    const slot = (i: number, s: SkillDef | undefined) => {
      if (!s) return `<button class="slot empty" data-slot="${i}" aria-label="Empty slot ${i + 1}"><span class="ico">＋</span></button>`;
      const prog = c.book.progress(s.id);
      const rank = prog?.rank ?? 0;
      const max = rank >= s.maxRank;
      const morph = c.book.canMorph(s.id);
      if (c.reg.morphsFrom(s.id).some((m) => !!m.spark && !c.book.has(m.to))) this.sparkSkills.add(s.id);
      const el = s.element ? c.reg.element(s.element) : undefined;
      return `<button class="slot ${max ? 'maxed' : ''} ${morph ? 'can-morph' : ''}" data-slot="${i}" data-skill="${s.id}" aria-label="${esc(s.name)}">
        <span class="ico">${s.icon}</span>
        <span class="rk">${max ? '★' : rank}</span>
        ${el ? `<span class="elb">${el.icon}</span>` : ''}
        <span class="spk" data-w="none" title="Spark window">✦</span>
        <span class="cd"></span><span class="ring"></span><span class="nm">${esc(s.name)}</span>
      </button>`;
    };
    this.hotbar.innerHTML = `
      <div class="slots">${p.hotbar.map((id, i) => slot(i, id ? c.reg.skill(id) : undefined)).join('')}</div>
      ${slot(-1, basic).replace('class="slot', 'class="slot basic')}`;
    $$<HTMLButtonElement>(this.hotbar, '.slot').forEach((b) => {
      const i = Number(b.dataset.slot);
      b.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        onSlot(i, b.classList.contains('empty'));
        b.classList.add('pressed');
        setTimeout(() => b.classList.remove('pressed'), 120);
      });
    });
    this.last = Object.fromEntries(Object.entries(this.last).filter(([k]) => !k.startsWith('slot:')));
    this.updateCooldowns();
  }

  updateCooldowns(): void {
    const c = this.ctrl;
    for (const b of $$<HTMLElement>(this.hotbar, '.slot[data-skill]')) {
      const id = b.dataset.skill!;
      const { remain, total } = c.cooldown(id);
      const h = total > 0 && remain > 0 ? `${(100 * remain) / total}%` : '0%';
      const cd = b.querySelector<HTMLElement>('.cd');
      if (cd && cd.style.height !== h) cd.style.height = h;
      const ok = c.usable(id).ok;
      if (b.classList.contains('disabled') === ok) b.classList.toggle('disabled', !ok);
      const prog = c.book.progress(id);
      if (prog) {
        const pct = `${(100 * prog.xp) / c.book.barSize(id)}%`;
        const ring = b.querySelector<HTMLElement>('.ring');
        if (ring && this.last[`slot:${id}`] !== pct) {
          this.last[`slot:${id}`] = pct;
          ring.style.setProperty('--p', pct);
        }
      }
      const spk = b.querySelector<HTMLElement>('.spk');
      if (spk) {
        const w = this.sparkSkills.has(id) ? c.sparkWindow(id) : 'none';
        if (spk.dataset.w !== w) spk.dataset.w = w;
      }
    }
  }
}
