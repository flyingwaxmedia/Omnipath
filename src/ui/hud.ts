// HUD (docs/CLIENT-v2.md §7): vitals (name, Lv, worn class + CR), menu column (with Map), zone banner
// "<name> · Lv a–b", target pill (warden mode), hotbar (rank badge, mastery ring, cooldown, element badge, spark
// rune), log, toasts, channel bar, cast wind-up bar, the auto-travel pill and the spark banner.
// Updates are throttled by the caller (≤ 10 Hz) and only touch the DOM when a value changed.
import { canBuyNode, classMaxRank, classXpToNext } from '../core/classes';
import type { ElementDef, SkillDef } from '../core/types';
import { WEAPONS } from '../data/weapons';
import { REGIONS, mapById } from '../data/world';
import { expToNext } from '../game/session';
import { discoveredRoute } from '../game/world/runtime';
import type { GameController } from './controller';
import { $, $$, esc, hex } from './util';

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

export const MENU: { panel: string; icon: string; label: string }[] = [
  { panel: 'skills', icon: '📖', label: 'Skills' },
  { panel: 'altar', icon: '⚗️', label: 'Fuse' },
  { panel: 'classes', icon: '🏛️', label: 'Class' },
  { panel: 'codex', icon: '📜', label: 'Codex' },
  { panel: 'bag', icon: '🎒', label: 'Bag' },
  { panel: 'map', icon: '🗺️', label: 'Map' },
];

/** The spark rune: an original four-pointed star split by a crack, inside a faint rune ring. Coloured by CSS. */
export const SPARK_RUNE = `<svg class="rune" viewBox="0 0 24 24" aria-hidden="true">
  <circle class="rg" cx="12" cy="12" r="10.6"/>
  <path class="st" d="M12 1.6 14.2 9.8 22.4 12 14.2 14.2 12 22.4 9.8 14.2 1.6 12 9.8 9.8Z"/>
  <path class="ck" d="M11.3 3.6 12.9 8.4 10.7 11.2 13.6 13 12.2 16.2 13.1 20.2"/>
  <path class="sh" d="M15.6 6.2 17.4 5.3 16.9 7.2Z M6.4 17.4 8.1 16.5 7.7 18.4Z"/>
</svg>`;

function levelClass(monster: number, player: number): string {
  const d = monster - player;
  if (d >= 5) return 'lv-deadly';
  if (d >= 2) return 'lv-hard';
  if (d <= -4) return 'lv-easy';
  return 'lv-even';
}

export class Hud {
  readonly el: HTMLElement;
  private hotbar!: HTMLElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private targetEl!: HTMLElement;
  private zoneEl!: HTMLElement;
  private channelEl!: HTMLElement;
  private castEl!: HTMLElement;
  private navEl!: HTMLElement;
  private sparkEl!: HTMLElement;
  private vit: Record<string, HTMLElement> = {};
  private last: Record<string, string> = {};
  private targetKey = '';
  private sparkSkills = new Set<string>();
  private castKey = '';
  private castProgress = 0;
  private navKey = '';
  private badgeT = 0;

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
          <div class="pclass"><span class="pcn"></span><span class="pcr"></span></div>
          <div class="bar cr hidden"><i></i></div>
          <div class="bar hp"><i></i><span></span></div>
          <div class="bar sp"><i></i><span></span></div>
          <div class="bar xp"><i></i></div>
        </div>
        <div class="menu">${MENU.map(
          (m) => `<button data-panel="${m.panel}" title="${m.label}" aria-label="${m.label}"><b>${m.icon}</b><small>${m.label}</small><em class="badge" aria-hidden="true"></em></button>`,
        ).join('')}</div>
      </div>
      <div class="zone-banner"><b><span class="zn"></span><span class="zb"></span></b><small></small></div>
      <div class="spark-banner"><b></b><small></small></div>
      <div class="target panel-glass hidden"></div>
      <div class="navpill hidden" role="status">
        <button class="np-open" aria-label="Show route on the map"><span class="np-ico">🧭</span><span class="np-txt"><b></b><small></small></span></button>
        <button class="np-stop" aria-label="Stop auto-travel" title="Stop auto-travel">✕</button>
      </div>
      <div class="channel hidden"><div class="ch-label"></div><div class="bar"><i></i></div></div>
      <div class="castbar hidden" aria-hidden="true"><div class="cb-label"><span class="cb-ico"></span><span class="cb-name"></span></div><div class="bar"><i></i></div></div>
      <div class="log"></div>
      <div class="hotbar"></div>
      <div class="toasts"></div>`;
    this.hotbar = $(this.el, '.hotbar');
    this.logEl = $(this.el, '.log');
    this.toastEl = $(this.el, '.toasts');
    this.targetEl = $(this.el, '.target');
    this.zoneEl = $(this.el, '.zone-banner');
    this.channelEl = $(this.el, '.channel');
    this.castEl = $(this.el, '.castbar');
    this.navEl = $(this.el, '.navpill');
    this.sparkEl = $(this.el, '.spark-banner');
    for (const k of ['pname', 'plv', 'pcn', 'pcr']) this.vit[k] = $(this.el, `.${k}`);
    this.vit.crBar = $(this.el, '.bar.cr');
    this.vit.crI = $(this.el, '.bar.cr i');
    this.vit.hpI = $(this.el, '.bar.hp i');
    this.vit.hpS = $(this.el, '.bar.hp span');
    this.vit.spI = $(this.el, '.bar.sp i');
    this.vit.spS = $(this.el, '.bar.sp span');
    this.vit.xpI = $(this.el, '.bar.xp i');
    $$<HTMLButtonElement>(this.el, '.menu button').forEach((b) => b.addEventListener('click', () => this.onMenu(b.dataset.panel!)));
    $(this.navEl, '.np-open').addEventListener('click', () => this.onMenu('map', 'route'));
    $(this.navEl, '.np-stop').addEventListener('click', () => this.cancelNav());
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  /** The menu column element (the minimap docks next to it). */
  get menuEl(): HTMLElement {
    return $(this.el, '.hud');
  }

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
    const worn = c.book.state.worn ? c.reg.classDef(c.book.state.worn) : undefined;
    const prog = worn ? c.book.state.classes[worn.id] : undefined;
    this.set('name', this.vit.pname, p.name);
    this.set('lv', this.vit.plv, `Lv ${p.level}`);
    if (worn && prog) {
      const max = prog.rank >= classMaxRank(worn);
      this.set('cls', this.vit.pcn, `${worn.icon} ${worn.name}`);
      this.set('cr', this.vit.pcr, `CR ${prog.rank}${max ? ' ★' : ''}`);
      if (this.last.crH !== 'on') {
        this.last.crH = 'on';
        this.vit.crBar.classList.remove('hidden');
      }
      const pct = max ? 100 : Math.min(100, (100 * prog.xp) / classXpToNext(prog.rank, worn.tier));
      this.set('crI', this.vit.crI, `${pct}%`, 'width');
      this.vit.pcr.title = max ? 'Class Rank (max)' : `Class Rank ${prog.rank} · ${Math.floor(pct)}% to the next`;
    } else {
      this.set('cls', this.vit.pcn, `${WEAPONS[p.weapon].icon} Novice`);
      this.set('cr', this.vit.pcr, '');
      if (this.last.crH !== 'off') {
        this.last.crH = 'off';
        this.vit.crBar.classList.add('hidden');
      }
    }
    const hpPct = Math.max(0, (100 * p.hp) / st.maxHp);
    this.set('hpI', this.vit.hpI, `${hpPct}%`, 'width');
    this.set('hpS', this.vit.hpS, `${Math.max(0, Math.ceil(p.hp))} / ${st.maxHp}`);
    const low = hpPct < 30 ? 'low' : '';
    if (this.last.hpLow !== low) {
      this.last.hpLow = low;
      this.vit.hpI.parentElement!.classList.toggle('low', !!low);
    }
    this.set('spI', this.vit.spI, `${Math.max(0, (100 * p.sp) / st.maxSp)}%`, 'width');
    this.set('spS', this.vit.spS, `${Math.floor(p.sp)} / ${st.maxSp}`);
    this.set('xpI', this.vit.xpI, `${(100 * p.exp) / expToNext(p.level)}%`, 'width');
    const t = performance.now();
    if (t - this.badgeT > 1000) {
      this.badgeT = t;
      this.updateBadges();
    }
  }

  /** Menu badges: a skill ready to morph, an unspent class point. */
  private updateBadges(): void {
    const c = this.ctrl;
    const book = c.book;
    const morph = book.known().some((s) => book.canMorph(s.id));
    const worn = book.state.worn ? c.reg.classDef(book.state.worn) : undefined;
    const prog = worn ? book.state.classes[worn.id] : undefined;
    const node = !!worn && !!prog && (worn.tree ?? []).some((n) => canBuyNode(worn, prog, n.id).ok);
    for (const [panel, on] of [
      ['skills', morph],
      ['classes', node],
    ] as const) {
      const key = `badge:${panel}`;
      const v = on ? '1' : '';
      if (this.last[key] === v) continue;
      this.last[key] = v;
      this.el.querySelector(`.menu button[data-panel="${panel}"]`)?.classList.toggle('has-badge', on);
    }
  }

  banner(title: string, sub = ''): void {
    let region = '';
    try {
      const def = this.ctrl.map().def;
      region = REGIONS.find((r) => r.id === def.region)?.name ?? '';
    } catch {
      /* scene not ready */
    }
    const band = /^Lv\b/.test(sub) ? sub : '';
    const kicker = [region, band ? '' : sub].filter(Boolean).join(' · ');
    $(this.zoneEl, '.zn').textContent = title;
    $(this.zoneEl, '.zb').textContent = band ? ` · ${band}` : '';
    $(this.zoneEl, 'small').textContent = kicker;
    this.zoneEl.classList.remove('show');
    void this.zoneEl.offsetWidth;
    this.zoneEl.classList.add('show');
  }

  sparkBanner(title: string, sub = ''): void {
    const b = $(this.sparkEl, 'b');
    if (title.startsWith('✦')) b.innerHTML = `${SPARK_RUNE}<span>${esc(title.replace(/^✦\s*/, ''))}</span>`;
    else b.textContent = title;
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
    // Combat may tag a raging warden's name "(enraged)": show it as the pill's enrage state instead.
    const enragedTag = /\s*\(enraged\)\s*$/i.test(t.name);
    const name = t.name.replace(/\s*\(enraged\)\s*$/i, '');
    const key = `${t.name}|${t.level}|${Math.ceil(t.hp)}|${t.maxHp}|${t.boss}`;
    if (key === this.targetKey) return;
    const fresh = this.targetKey === '' || !this.targetKey.startsWith(`${t.name}|`);
    this.targetKey = key;
    this.targetEl.classList.remove('hidden');
    this.targetEl.classList.toggle('boss', !!t.boss);
    this.targetEl.classList.toggle('elite', !!t.elite && !t.boss);
    if (fresh || !this.targetEl.querySelector('.bar.tgt i')) {
      const elc = t.element ? hex(t.element.color) : '';
      const el = t.element
        ? `<span class="el" title="${esc(t.element.name)}" style="--c:${elc}">${t.element.icon}</span>`
        : '<span class="el none" title="No element">◯</span>';
      const lv = levelClass(t.level, this.ctrl.session.player.level);
      const tag = t.boss ? '<span class="tg-tag warden">Warden</span>' : t.elite ? '<span class="tg-tag elite">Elite</span>' : '';
      this.targetEl.innerHTML = `${t.boss ? '<div class="tg-kick">⚔ Warden</div>' : ''}
        <div class="tg-top">${el}<b class="tg-name">${esc(name)}</b><small class="tg-lv ${lv}">Lv ${t.level}</small>${t.boss ? '' : tag}</div>
        <div class="bar tgt">${t.boss ? '<em class="tick" title="Enrage at half health"></em>' : ''}<i></i><span></span></div>`;
    }
    const pct = Math.max(0, (100 * t.hp) / t.maxHp);
    $(this.targetEl, '.bar.tgt i').style.width = `${pct}%`;
    const span = this.targetEl.querySelector('.bar.tgt span');
    if (span) span.textContent = t.boss ? `${Math.max(0, Math.ceil(t.hp))} / ${t.maxHp}` : t.hp < t.maxHp ? `${Math.round(pct)}%` : '';
    this.targetEl.classList.toggle('enraged', !!t.boss && t.hp > 0 && (enragedTag || pct < 50));
  }

  setChannel(label: string | null, progress = 0): void {
    if (label === null) {
      if (this.last.ch !== '') {
        this.last.ch = '';
        this.channelEl.classList.add('hidden');
      }
      return;
    }
    if (this.last.ch !== label) {
      this.last.ch = label;
      this.channelEl.classList.remove('hidden');
      $(this.channelEl, '.ch-label').textContent = label;
    }
    const w = `${Math.round(Math.min(100, progress * 100))}%`;
    if (this.last.chW !== w) {
      this.last.chW = w;
      $(this.channelEl, '.bar i').style.width = w;
    }
  }

  /** Cast wind-up: shown under the player area and on the hotbar slot; animates smoothly between ≤ 10 Hz pushes. */
  setCast(c: CastInfo | null): void {
    const bar = $(this.castEl, '.bar i');
    if (!c) {
      if (this.castKey) {
        this.castKey = '';
        this.castEl.classList.add('hidden');
        bar.style.transition = 'none';
        this.hotbar.querySelectorAll('.slot.casting').forEach((b) => b.classList.remove('casting'));
      }
      return;
    }
    const restart = this.castKey !== c.skill.id || c.progress + 0.02 < this.castProgress;
    this.castProgress = c.progress;
    if (!restart) return;
    this.castKey = c.skill.id;
    const el = c.skill.element ? this.ctrl.reg.element(c.skill.element) : undefined;
    this.castEl.style.setProperty('--c', el ? hex(el.color) : '#9fe0ff');
    $(this.castEl, '.cb-ico').textContent = c.skill.icon;
    $(this.castEl, '.cb-name').textContent = c.skill.name;
    this.castEl.classList.remove('hidden');
    bar.style.transition = 'none';
    bar.style.width = `${Math.min(100, c.progress * 100)}%`;
    void bar.offsetWidth;
    bar.style.transition = `width ${Math.max(0, Math.round(c.remainMs))}ms linear`;
    bar.style.width = '100%';
    this.hotbar.querySelectorAll('.slot.casting').forEach((b) => b.classList.remove('casting'));
    this.hotbar.querySelector(`.slot[data-skill="${CSS.escape(c.skill.id)}"]`)?.classList.add('casting');
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
      return;
    }
    const route = discoveredRoute(c.world(), c.book, here, nav.target);
    const hops = route?.length ?? 0;
    const first = route?.[0] ? mapById(route[0].map)?.portals.find((p) => p.id === route[0].portal) : undefined;
    const next = first ? mapById(first.to.map)?.name : undefined;
    $(this.navEl, '.np-txt b').textContent = `To ${mapById(nav.target)?.name ?? nav.target}`;
    $(this.navEl, '.np-txt small').textContent = hops
      ? `${hops > 1 && next ? `Next: ${next} · ` : ''}${hops} portal${hops === 1 ? '' : 's'} to go`
      : 'Arriving';
    this.navEl.classList.remove('hidden');
  }

  private cancelNav(): void {
    const c = this.ctrl as NavController;
    if (c.cancelNavigate) c.cancelNavigate();
    else c.session.nav = null;
    this.navKey = '#';
    this.updateNav();
    this.toast('🧭 Auto-travel stopped.');
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
        <span class="spk" data-w="none" title="Spark window">${SPARK_RUNE}</span>
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
    if (this.castKey) this.hotbar.querySelector(`.slot[data-skill="${CSS.escape(this.castKey)}"]`)?.classList.add('casting');
    this.badgeT = 0;
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
        if (spk.dataset.w !== w) {
          spk.dataset.w = w;
          spk.title = w === 'peak' ? 'Spark window: peak' : w === 'good' ? 'Spark window: good' : w === 'low' ? 'Spark window: low' : '';
        }
      }
    }
  }
}
