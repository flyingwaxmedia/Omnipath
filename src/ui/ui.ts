import { fusionMinRank } from '../core/mastery';
import { parseRef, skillRef } from '../core/refs';
import type { ClassDef, ElementDef, SkillDef, SkillShape, WeaponType } from '../core/types';
import { WEAPONS } from '../data/weapons';
import { HOTBAR_SIZE, expToNext } from '../game/session';
import type { GameController } from './controller';

export const esc = (s: string) =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const $ = <T extends HTMLElement = HTMLElement>(root: ParentNode, sel: string) => root.querySelector(sel) as T;

export interface TargetInfo {
  name: string;
  level: number;
  hp: number;
  maxHp: number;
  element?: ElementDef;
  boss?: boolean;
}

export interface DialogOption {
  label: string;
  action?: () => void;
  /** Keep the dialog open after the action. */
  keep?: boolean;
  disabled?: boolean;
}

interface DiscoveryCard {
  icon: string;
  kicker: string;
  title: string;
  body: string;
  accent?: string;
}

function shapeText(s: SkillShape): string {
  switch (s.kind) {
    case 'strike':
      return `Melee arc · ${s.arc}°${s.hits && s.hits > 1 ? ` · ${s.hits} hits` : ''}`;
    case 'spin':
      return `Spin around you · radius ${s.radius}${s.pulses && s.pulses > 1 ? ` · ${s.pulses} pulses` : ''}`;
    case 'projectile':
      return `Projectile${s.count && s.count > 1 ? ` ×${s.count}` : ''}${s.radial ? ' (all directions)' : ''}${s.pierce ? ` · pierce ${s.pierce >= 99 ? '∞' : s.pierce}` : ''}`;
    case 'dash':
      return `Dash ${s.distance}px${s.width ? ' · hits along the path' : ''}`;
    case 'nova':
      return `Burst at range ${s.range} · radius ${s.radius}`;
    case 'chain':
      return `Chains to ${s.jumps} more foes`;
    case 'buff':
      return `+${s.amount}${s.stat === 'regen' ? '% HP/s' : s.stat === 'crit' ? ' crit' : '%'} ${s.stat === 'regen' ? '' : s.stat.toUpperCase()} for ${s.duration / 1000}s`;
  }
}

function sourceText(src: string, ctrl: GameController): string {
  if (src.startsWith('morph:')) return `Morphed from ${ctrl.reg.skill(src.slice(6))?.name ?? '?'}`;
  if (src.startsWith('fusion:')) {
    const [a, b] = src.slice(7).split('+');
    return `Fusion of ${ctrl.reg.refName(a)} + ${ctrl.reg.refName(b)}`;
  }
  if (src.startsWith('class:')) return `Signature of the ${ctrl.reg.classDef(src.slice(6))?.name ?? '?'}`;
  return src.charAt(0).toUpperCase() + src.slice(1);
}

export class UI {
  readonly root: HTMLElement;
  private hud!: HTMLElement;
  private hotbar!: HTMLElement;
  private logEl!: HTMLElement;
  private toastEl!: HTMLElement;
  private modal!: HTMLElement;
  private targetEl!: HTMLElement;
  private zoneEl!: HTMLElement;
  private channelEl!: HTMLElement;
  private discoveries: DiscoveryCard[] = [];
  private showingDiscovery = false;
  private panel: string | null = null;
  private assigning: string | null = null;
  private fuseSlots: (string | null)[] = [null, null];
  private lastZone = '';

  constructor(
    parent: HTMLElement,
    private ctrl: GameController,
  ) {
    this.root = document.createElement('div');
    this.root.id = 'hud-root';
    parent.appendChild(this.root);
    this.build();
  }

  private build() {
    this.root.innerHTML = `
      <div class="hud">
        <div class="vitals panel-glass">
          <div class="who"><span class="pname"></span> <span class="plv"></span></div>
          <div class="pclass"></div>
          <div class="bar hp"><i></i><span></span></div>
          <div class="bar sp"><i></i><span></span></div>
          <div class="bar xp"><i></i></div>
        </div>
        <div class="menu">
          <button data-panel="grimoire" title="Grimoire"><b>📖</b><small>Skills</small></button>
          <button data-panel="fusion" title="Fusion Altar"><b>⚗️</b><small>Fuse</small></button>
          <button data-panel="classes" title="Classes"><b>🏛️</b><small>Class</small></button>
          <button data-panel="journal" title="Journal"><b>📜</b><small>Journal</small></button>
          <button data-panel="bag" title="Bag"><b>🎒</b><small>Bag</small></button>
        </div>
      </div>
      <div class="zone-banner"></div>
      <div class="target panel-glass hidden"></div>
      <div class="channel hidden"><div class="ch-label"></div><div class="bar"><i></i></div></div>
      <div class="log"></div>
      <div class="hotbar"></div>
      <div class="toasts"></div>
      <div class="modal hidden"></div>
    `;
    this.hud = $(this.root, '.hud');
    this.hotbar = $(this.root, '.hotbar');
    this.logEl = $(this.root, '.log');
    this.toastEl = $(this.root, '.toasts');
    this.modal = $(this.root, '.modal');
    this.targetEl = $(this.root, '.target');
    this.zoneEl = $(this.root, '.zone-banner');
    this.channelEl = $(this.root, '.channel');
    this.hud.querySelectorAll<HTMLButtonElement>('.menu button').forEach((b) =>
      b.addEventListener('click', () => this.open(b.dataset.panel!)),
    );
    this.modal.addEventListener('click', (e) => {
      if (e.target === this.modal && !this.showingDiscovery) this.close();
    });
    // Prevent double-tap zoom & context menus on the HUD.
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    this.renderHotbar();
  }

  // ================================================================ HUD

  updateVitals(): void {
    const p = this.ctrl.session.player;
    const st = this.ctrl.stats();
    const cls = this.ctrl.book.state.activeClass ? this.ctrl.reg.classDef(this.ctrl.book.state.activeClass) : null;
    $(this.hud, '.pname').textContent = p.name;
    $(this.hud, '.plv').textContent = `Lv ${p.level}`;
    $(this.hud, '.pclass').textContent = cls ? `${cls.icon} ${cls.name}` : `${WEAPONS[p.weapon].icon} Novice`;
    const hp = $(this.hud, '.bar.hp');
    $(hp, 'i').style.width = `${(100 * p.hp) / st.maxHp}%`;
    $(hp, 'span').textContent = `${Math.ceil(p.hp)} / ${st.maxHp}`;
    const sp = $(this.hud, '.bar.sp');
    $(sp, 'i').style.width = `${(100 * p.sp) / st.maxSp}%`;
    $(sp, 'span').textContent = `${Math.floor(p.sp)} / ${st.maxSp}`;
    $(this.hud, '.bar.xp i').style.width = `${(100 * p.exp) / expToNext(p.level)}%`;
  }

  setZone(name: string): void {
    if (name === this.lastZone) return;
    this.lastZone = name;
    this.zoneEl.textContent = name;
    this.zoneEl.classList.remove('show');
    void this.zoneEl.offsetWidth;
    this.zoneEl.classList.add('show');
  }

  setTarget(t: TargetInfo | null): void {
    if (!t) {
      this.targetEl.classList.add('hidden');
      return;
    }
    this.targetEl.classList.remove('hidden');
    this.targetEl.classList.toggle('boss', !!t.boss);
    const el = t.element ? `<span class="el" title="${t.element.name}">${t.element.icon}</span>` : '<span class="el">◯</span>';
    this.targetEl.innerHTML = `${el}<b>${esc(t.name)}</b> <small>Lv ${t.level}</small>
      <div class="bar tgt"><i style="width:${(100 * t.hp) / t.maxHp}%"></i></div>`;
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

  log(msg: string, kind: 'info' | 'good' | 'rare' | 'warn' | 'loot' = 'info'): void {
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
    setTimeout(() => t.classList.add('out'), 2200);
    setTimeout(() => t.remove(), 2700);
  }

  // ================================================================ hotbar

  renderHotbar(): void {
    const p = this.ctrl.session.player;
    const basic = this.ctrl.reg.skill(WEAPONS[p.weapon].basic)!;
    const slot = (i: number, s: SkillDef | undefined) => {
      if (!s) return `<button class="slot empty" data-slot="${i}"><span class="ico">＋</span></button>`;
      const prog = this.ctrl.book.progress(s.id);
      const rank = prog?.rank ?? 0;
      const max = rank >= s.maxRank;
      const morph = this.ctrl.book.canMorph(s.id);
      return `<button class="slot ${max ? 'maxed' : ''} ${morph ? 'can-morph' : ''}" data-slot="${i}" data-skill="${s.id}">
        <span class="ico">${s.icon}</span>
        <span class="rk">${max ? '★' : rank}</span>
        ${s.element ? `<span class="elb">${this.ctrl.reg.element(s.element)!.icon}</span>` : ''}
        <span class="cd"></span><span class="ring"></span><span class="nm">${esc(s.name)}</span>
      </button>`;
    };
    this.hotbar.innerHTML = `
      <div class="slots">${p.hotbar.map((id, i) => slot(i, id ? this.ctrl.reg.skill(id) : undefined)).join('')}</div>
      ${slot(-1, basic).replace('class="slot', 'class="slot basic')}
    `;
    this.hotbar.querySelectorAll<HTMLButtonElement>('.slot').forEach((b) => {
      const i = Number(b.dataset.slot);
      const fire = (e: Event) => {
        e.preventDefault();
        if (this.assigning) {
          if (i >= 0) this.ctrl.assignSlot(i, this.assigning);
          this.assigning = null;
          this.root.classList.remove('assigning');
          this.renderHotbar();
          return;
        }
        if (b.classList.contains('empty')) {
          this.open('grimoire');
          return;
        }
        this.ctrl.castSlot(i);
        b.classList.add('pressed');
        setTimeout(() => b.classList.remove('pressed'), 120);
      };
      b.addEventListener('pointerdown', fire);
    });
    this.updateCooldowns();
  }

  updateCooldowns(): void {
    this.hotbar.querySelectorAll<HTMLElement>('.slot[data-skill]').forEach((b) => {
      const id = b.dataset.skill!;
      const { remain, total } = this.ctrl.cooldown(id);
      const cd = $(b, '.cd');
      cd.style.height = total > 0 && remain > 0 ? `${(100 * remain) / total}%` : '0%';
      const usable = this.ctrl.usable(id);
      b.classList.toggle('disabled', !usable.ok);
      const prog = this.ctrl.book.progress(id);
      const s = this.ctrl.reg.skill(id);
      if (prog && s) {
        const pct = (100 * prog.xp) / this.ctrl.book.barSize(id);
        $(b, '.ring').style.setProperty('--p', `${pct}%`);
      }
    });
  }

  // ================================================================ modal plumbing

  get isOpen(): boolean {
    return this.panel !== null || this.showingDiscovery;
  }

  open(name: string): void {
    this.panel = name;
    this.modal.classList.remove('hidden');
    this.ctrl.setPaused(true);
    this.render();
  }

  close(): void {
    this.panel = null;
    this.modal.classList.add('hidden');
    this.modal.innerHTML = '';
    this.ctrl.setPaused(false);
    this.renderHotbar();
    if (this.discoveries.length) this.nextDiscovery();
  }

  refresh(): void {
    if (this.panel && !this.showingDiscovery) this.render();
    this.renderHotbar();
  }

  private sheet(title: string, body: string, extraClass = ''): void {
    this.modal.innerHTML = `
      <div class="sheet ${extraClass}">
        <header><h2>${title}</h2><button class="x" aria-label="Close">✕</button></header>
        <div class="sheet-body">${body}</div>
      </div>`;
    $(this.modal, '.x').addEventListener('click', () => this.close());
  }

  private render(): void {
    switch (this.panel) {
      case 'grimoire':
        return this.renderGrimoire();
      case 'fusion':
        return this.renderFusion();
      case 'classes':
        return this.renderClasses();
      case 'journal':
        return this.renderJournal();
      case 'bag':
        return this.renderBag();
      default:
        if (this.panel?.startsWith('skill:')) return this.renderSkill(this.panel.slice(6));
    }
  }

  // ================================================================ grimoire

  private skillCard(s: SkillDef): string {
    const book = this.ctrl.book;
    const p = book.progress(s.id)!;
    const max = p.rank >= s.maxRank;
    const pct = (100 * p.xp) / book.barSize(s.id);
    const el = s.element ? this.ctrl.reg.element(s.element) : undefined;
    const morph = book.canMorph(s.id);
    return `<button class="skill-card ${max ? 'maxed' : ''} ${morph ? 'can-morph' : ''}" data-skill="${s.id}">
      <span class="ico">${s.icon}</span>
      <span class="meta">
        <b>${esc(s.name)}</b>${el ? ` <span class="chip el" style="--c:#${el.color.toString(16).padStart(6, '0')}">${el.icon} ${el.name}</span>` : ''}
        <span class="rank">${max ? `★ Mastered${p.charges ? ` · <em>${p.charges} morph${p.charges > 1 ? 's' : ''} ready</em>` : ''}` : `Rank ${p.rank} / ${s.maxRank}`}</span>
        <span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span>
      </span>
    </button>`;
  }

  private renderGrimoire(): void {
    const known = this.ctrl.book.known();
    const groups: [string, SkillDef[]][] = [
      ['Weapon Arts', known.filter((s) => s.tier === 0)],
      ['Discovered Forms', known.filter((s) => s.tier >= 1 && !s.generated && !this.isSignature(s))],
      ['Infusions', known.filter((s) => s.generated)],
      ['Class Signatures', known.filter((s) => this.isSignature(s))],
    ];
    const stats = this.ctrl.book.stats();
    const body = `
      <p class="sub">Use a skill to raise its rank. At max rank it can <b>morph</b> into a new form — the original is kept.
      Train past max for more morph charges.</p>
      ${groups
        .filter(([, list]) => list.length)
        .map(([name, list]) => `<h3>${name}</h3><div class="cards">${list.map((s) => this.skillCard(s)).join('')}</div>`)
        .join('')}
      <p class="foot">${stats.authoredKnown} of ${stats.authoredTotal} authored skills discovered · ${stats.infusions} infusions</p>`;
    this.sheet('📖 Grimoire', body);
    this.modal.querySelectorAll<HTMLButtonElement>('.skill-card').forEach((b) =>
      b.addEventListener('click', () => {
        this.panel = `skill:${b.dataset.skill}`;
        this.render();
      }),
    );
  }

  private isSignature(s: SkillDef): boolean {
    return this.ctrl.book.progress(s.id)?.source.startsWith('class:') ?? false;
  }

  private renderSkill(id: string): void {
    const book = this.ctrl.book;
    const reg = this.ctrl.reg;
    const s = reg.skill(id);
    const p = book.progress(id);
    if (!s || !p) return this.open('grimoire');
    const max = p.rank >= s.maxRank;
    const pct = (100 * p.xp) / book.barSize(id);
    const el = s.element ? reg.element(s.element) : undefined;
    const usable = this.ctrl.usable(id);
    const weapons = s.weapons ? s.weapons.map((w) => `${WEAPONS[w].icon} ${w}`).join(', ') : 'Any weapon';
    const morphs = book.morphOptions(id);
    const fuseNeed = fusionMinRank(s.maxRank);
    const isBasic = Object.values(WEAPONS).some((w) => w.basic === id);
    const morphHtml = morphs.length
      ? `<h3>Morphs ${max ? '' : `<small>(unlock at rank ${s.maxRank})</small>`}</h3>
        <div class="morphs">${morphs
          .map((o) => {
            if (o.owned)
              return `<div class="morph owned"><span class="ico">${o.skill!.icon}</span><span><b>${esc(o.skill!.name)}</b><small>Learned</small></span></div>`;
            if (!o.available)
              return `<div class="morph locked"><span class="ico">❔</span><span><b>???</b><small>${esc(o.hint)}</small></span></div>`;
            if (!max)
              return `<div class="morph sealed"><span class="ico">✧</span><span><b>Unknown form</b><small>Master ${esc(s.name)} to reveal it.</small></span></div>`;
            const can = p.charges > 0;
            return `<div class="morph ready"><span class="ico">${o.skill!.icon}</span><span><b>${esc(o.skill!.name)}</b><small>${esc(o.skill!.desc)}</small></span>
              <button class="btn gold" data-morph="${o.morph.to}" ${can ? '' : 'disabled'}>${can ? 'Morph' : 'No charge'}</button></div>`;
          })
          .join('')}</div>
        ${max && p.charges === 0 ? '<p class="sub">Keep using this skill to fill the overmastery bar and earn another morph charge.</p>' : ''}`
      : '<h3>Morphs</h3><p class="sub">No known morphs. Perhaps fusion holds its future.</p>';

    const body = `
      <button class="back">‹ Grimoire</button>
      <div class="skill-head">
        <span class="big-ico">${s.icon}</span>
        <div>
          <h3 class="nm">${esc(s.name)}</h3>
          <div class="chips">
            ${el ? `<span class="chip el" style="--c:#${el.color.toString(16).padStart(6, '0')}">${el.icon} ${el.name}</span>` : ''}
            ${s.tags
              .filter((t) => t !== s.element && !(s.weapons as string[] | undefined)?.includes(t))
              .map((t) => `<span class="chip">${esc(t)}</span>`)
              .join('')}
          </div>
        </div>
      </div>
      <p>${esc(s.desc)}</p>
      <div class="kv">
        <span>Rank</span><b>${max ? `★ ${p.rank} (max)` : `${p.rank} / ${s.maxRank}`}</b>
        <span>${max ? 'Overmastery' : 'Mastery'}</span><b><span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span></b>
        <span>Morph charges</span><b>${p.charges}</b>
        <span>Effect</span><b>${shapeText(s.shape)}</b>
        ${s.power ? `<span>Power</span><b>${Math.round(s.power * 100)}%${s.critBonus ? ` · +${s.critBonus}% crit` : ''}</b>` : ''}
        <span>Cost</span><b>${s.spCost} SP · ${s.cooldown ? `${(s.cooldown / 1000).toFixed(1)}s` : 'weapon speed'}</b>
        <span>Weapons</span><b>${weapons}</b>
        <span>Origin</span><b>${esc(sourceText(p.source, this.ctrl))}</b>
        <span>Uses</span><b>${p.uses}</b>
      </div>
      ${usable.ok ? '' : `<p class="warn">${esc(usable.reason ?? '')}</p>`}
      ${
        isBasic
          ? '<p class="sub">Your basic attack lives on the big button and auto-attacks when you tap an enemy.</p>'
          : `<h3>Hotbar</h3><div class="assign">${Array.from({ length: HOTBAR_SIZE }, (_, i) => {
              const cur = this.ctrl.session.player.hotbar[i];
              const curS = cur ? reg.skill(cur) : undefined;
              return `<button class="btn slotpick ${cur === id ? 'on' : ''}" data-assign="${i}">${curS ? curS.icon : '·'}<small>${i + 1}</small></button>`;
            }).join('')}</div>`
      }
      ${morphHtml}
      <p class="sub">Fusion: ${p.rank >= fuseNeed ? '✅ ready as an ingredient' : `reach rank ${fuseNeed} to use at the altar`}.</p>
    `;
    this.sheet('📖 Grimoire', body);
    $(this.modal, '.back').addEventListener('click', () => {
      this.panel = 'grimoire';
      this.render();
    });
    this.modal.querySelectorAll<HTMLButtonElement>('[data-morph]').forEach((b) =>
      b.addEventListener('click', () => this.ctrl.morph(id, b.dataset.morph!)),
    );
    this.modal.querySelectorAll<HTMLButtonElement>('[data-assign]').forEach((b) =>
      b.addEventListener('click', () => {
        const i = Number(b.dataset.assign);
        const cur = this.ctrl.session.player.hotbar[i];
        this.ctrl.assignSlot(i, cur === id ? null : id);
        this.render();
      }),
    );
  }

  // ================================================================ fusion

  private renderFusion(): void {
    const book = this.ctrl.book;
    const reg = this.ctrl.reg;
    const ings = book.ingredients();
    const [a, b] = this.fuseSlots;
    const slotHtml = (ref: string | null, i: number) =>
      ref
        ? `<button class="fslot full" data-fslot="${i}"><span class="ico">${reg.refIcon(ref)}</span><small>${esc(reg.refName(ref))}</small></button>`
        : `<button class="fslot" data-fslot="${i}"><span class="ico">?</span><small>Empty</small></button>`;
    let memory = '<span class="mem">Place two essences on the altar.</span>';
    if (a && b) {
      const r = book.rememberedPair(a, b);
      memory =
        r === 'discovered'
          ? '<span class="mem good">You have made something from this before.</span>'
          : r === 'nothing'
            ? '<span class="mem bad">You tried this. Nothing happened.</span>'
            : '<span class="mem">An untried combination...</span>';
    }
    const ingHtml = (filter: (r: string) => boolean) =>
      ings
        .filter((i) => filter(i.ref))
        .map((i) => {
          const p = parseRef(i.ref);
          const s = p.kind === 'skill' ? reg.skill(p.id) : undefined;
          const rank = s ? book.rank(s.id) : 0;
          const inUse = this.fuseSlots.includes(i.ref);
          return `<button class="ing ${i.ready ? '' : 'locked'} ${inUse ? 'inuse' : ''}" data-ref="${i.ref}" title="${esc(i.message ?? '')}">
            <span class="ico">${reg.refIcon(i.ref)}</span><small>${esc(reg.refName(i.ref))}</small>
            ${s ? `<span class="rk">${i.ready ? 'R' + rank : '🔒R' + fusionMinRank(s.maxRank)}</span>` : ''}
          </button>`;
        })
        .join('');
    const hints = book.state.hints.slice(-3).reverse();
    const stats = book.stats();
    const body = `
      <p class="sub">Combine two essences — an element and a skill, two skills, or two elements.
      Skills must reach rank 5 first. Some results are hand-crafted; any unaligned attack can be infused with any element.</p>
      <div class="altar">
        ${slotHtml(a, 0)}<span class="plus">+</span>${slotHtml(b, 1)}
        <button class="btn gold fuse" ${a && b ? '' : 'disabled'}>Fuse</button>
      </div>
      <div class="memory">${memory}</div>
      <div class="fuse-result"></div>
      <h3>Elements</h3>
      <div class="ings">${ingHtml((r) => r.startsWith('el:')) || '<p class="sub">No elements attuned yet. Elements are discovered through the world: crafting, fishing, mining, shrines, and bosses.</p>'}</div>
      <h3>Skills</h3>
      <div class="ings">${ingHtml((r) => r.startsWith('skill:'))}</div>
      ${hints.length ? `<h3>Whispers</h3>${hints.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
      <p class="foot">${stats.discoveries} discoveries from ${stats.experiments} experiments</p>
    `;
    this.sheet('⚗️ Fusion Altar', body, 'fusion');
    this.modal.querySelectorAll<HTMLButtonElement>('[data-fslot]').forEach((btn) =>
      btn.addEventListener('click', () => {
        this.fuseSlots[Number(btn.dataset.fslot)] = null;
        this.render();
      }),
    );
    this.modal.querySelectorAll<HTMLButtonElement>('.ing').forEach((btn) =>
      btn.addEventListener('click', () => {
        const ref = btn.dataset.ref!;
        if (btn.classList.contains('locked')) {
          this.toast(esc(btn.title));
          return;
        }
        const at = this.fuseSlots.indexOf(ref);
        if (at >= 0) this.fuseSlots[at] = null;
        else {
          const empty = this.fuseSlots.indexOf(null);
          this.fuseSlots[empty >= 0 ? empty : 1] = ref;
        }
        this.render();
      }),
    );
    $(this.modal, '.fuse').addEventListener('click', () => {
      if (!a || !b) return;
      const altar = $(this.modal, '.altar');
      altar.classList.add('fusing');
      setTimeout(() => {
        const res = this.ctrl.fuse(a, b);
        this.fuseSlots = [null, null];
        if (this.panel !== 'fusion' || this.showingDiscovery) return;
        this.render();
        const out = $(this.modal, '.fuse-result');
        if (res.ok) {
          out.innerHTML = `<div class="result good"><span class="ico">${reg.refIcon(res.result)}</span>
            <span><b>${esc(res.name)}</b><small>${res.isNew ? (res.procedural ? 'New infusion discovered!' : 'New discovery!') : 'Already known.'}</small></span></div>`;
        } else {
          out.innerHTML = `<div class="result bad"><span>${esc(res.message)}</span>${res.hint ? `<small class="whisper">“${esc(res.hint)}”</small>` : ''}</div>`;
        }
      }, 650);
    });
  }

  // ================================================================ classes

  private renderClasses(): void {
    const book = this.ctrl.book;
    const list = this.ctrl.reg.classes.map((c) => book.classProgress(c));
    list.sort((x, y) => Number(y.discovered) - Number(x.discovered) || y.progress - x.progress);
    const bonusText = (c: ClassDef) => {
      const b = c.bonus;
      const parts: string[] = [];
      if (b.atk) parts.push(`+${b.atk}% ATK`);
      if (b.matk) parts.push(`+${b.matk}% MATK`);
      if (b.hp) parts.push(`+${b.hp}% HP`);
      if (b.sp) parts.push(`+${b.sp}% SP`);
      if (b.speed) parts.push(`+${b.speed}% move`);
      if (b.crit) parts.push(`+${b.crit} crit`);
      if (b.cdr) parts.push(`-${b.cdr}% cooldowns`);
      for (const [t, v] of Object.entries(b.tagPower ?? {})) parts.push(`+${v}% ${t} damage`);
      return parts.join(' · ');
    };
    const body = `
      <p class="sub">Classes are never chosen — they are <b>discovered</b> when your collection of skills matches a hidden pattern.
      You may wear any class you have discovered.</p>
      <div class="classes">${list
        .map((cp) => {
          const c = cp.cls;
          if (!cp.discovered)
            return `<div class="cls locked"><span class="ico">❔</span><span><b>???</b><small>“${esc(c.hint)}”</small>
              <span class="bar mini"><i style="width:${cp.progress * 100}%"></i></span></span></div>`;
          const active = book.state.activeClass === c.id;
          return `<div class="cls ${active ? 'active' : ''}"><span class="ico">${c.icon}</span><span><b>${esc(c.name)}</b>
            <small>${esc(c.desc)}</small><small class="bonus">${bonusText(c)}</small>
            ${c.grants?.length ? `<small>Signature: ${c.grants.map((g) => esc(this.ctrl.reg.skill(g)!.name)).join(', ')}</small>` : ''}</span>
            <button class="btn ${active ? '' : 'gold'}" data-cls="${c.id}">${active ? 'Active' : 'Wear'}</button></div>`;
        })
        .join('')}</div>
      <p class="foot">${book.state.classes.length} of ${this.ctrl.reg.classes.length} classes discovered</p>`;
    this.sheet('🏛️ Classes', body);
    this.modal.querySelectorAll<HTMLButtonElement>('[data-cls]').forEach((b) =>
      b.addEventListener('click', () => {
        this.ctrl.setActiveClass(b.dataset.cls!);
        this.render();
      }),
    );
  }

  // ================================================================ journal

  private renderJournal(): void {
    const book = this.ctrl.book;
    const reg = this.ctrl.reg;
    const st = book.stats();
    const els = [...reg.elements.values()];
    const elHtml = els
      .map((e) => {
        const known = book.state.elements[e.id];
        return known
          ? `<div class="el-row"><span class="ico">${e.icon}</span><span><b>${e.name}</b><small>${esc(e.desc)}</small><small class="src">${esc(known.source)}</small></span></div>`
          : `<div class="el-row locked"><span class="ico">❔</span><span><b>???</b><small>${e.tier ? 'Born of two elements.' : 'Hidden somewhere in the world.'}</small></span></div>`;
      })
      .join('');
    const recipes = book.state.discoveries
      .map((k) => {
        const [a, b] = k.split('+');
        const r = reg.recipe(a, b);
        const result = r ? r.result : (() => {
          const pa = parseRef(a);
          const pb = parseRef(b);
          const sk = pa.kind === 'skill' ? pa.id : pb.kind === 'skill' ? pb.id : '';
          const el = pa.kind === 'el' ? pa.id : pb.kind === 'el' ? pb.id : '';
          return skillRef(`${sk}@${el}`);
        })();
        return `<div class="recipe">${reg.refIcon(a)} ${esc(reg.refName(a))} + ${reg.refIcon(b)} ${esc(reg.refName(b))} → <b>${reg.refIcon(result)} ${esc(reg.refName(result))}</b></div>`;
      })
      .join('');
    const flags = book.state.flags;
    const body = `
      <div class="stat-grid">
        <div><b>${st.authoredKnown}</b><small>/ ${st.authoredTotal} skills</small></div>
        <div><b>${st.infusions}</b><small>infusions</small></div>
        <div><b>${st.elementsKnown}</b><small>/ ${st.elementsTotal} elements</small></div>
        <div><b>${st.classesKnown}</b><small>/ ${st.classesTotal} classes</small></div>
        <div><b>${st.discoveries}</b><small>fusions found</small></div>
        <div><b>${flags.kills ?? 0}</b><small>monsters felled</small></div>
      </div>
      <h3>Elements</h3><div class="els">${elHtml}</div>
      <h3>Fusion Codex</h3>${recipes || '<p class="sub">No fusions discovered yet.</p>'}
      ${book.state.hints.length ? `<h3>Whispers</h3>${book.state.hints.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
      <h3>How discovery works</h3>
      <ul class="tips">
        <li><b>Mastery</b> — every use and hit trains a skill. Max rank grants a morph charge.</li>
        <li><b>Morph</b> — spend a charge to learn a new form. You keep the original.</li>
        <li><b>Elements</b> — found by doing things: forging, fishing, mining, meditating, hunting bosses, exploring.</li>
        <li><b>Fusion</b> — combine elements and skills at the altar. Failed experiments whisper hints.</li>
        <li><b>Classes</b> — emerge on their own from the shape of your skill collection.</li>
        <li><b>Weapons</b> — the smith sells other weapons. Mastering several unlocks cross-weapon fusions.</li>
      </ul>
      <button class="btn danger newgame">Start a new character</button>
    `;
    this.sheet('📜 Journal', body);
    $(this.modal, '.newgame').addEventListener('click', () => {
      if (confirm('Erase this character and start over?')) this.ctrl.newGame();
    });
  }

  // ================================================================ bag

  private renderBag(): void {
    const p = this.ctrl.session.player;
    const body = `
      <div class="stat-grid">
        <div><b>🪙 ${p.coins}</b><small>coins</small></div>
        <div><b>🪨 ${p.bag.ore}</b><small>ore</small></div>
        <div><b>🐟 ${p.bag.fish}</b><small>fish</small></div>
      </div>
      <button class="btn eat" ${p.bag.fish > 0 ? '' : 'disabled'}>🐟 Eat a fish (heal 40%)</button>
      <h3>Weapons</h3>
      <div class="weapons">${p.ownedWeapons
        .map((w) => {
          const d = WEAPONS[w];
          const on = p.weapon === w;
          return `<div class="wpn ${on ? 'on' : ''}"><span class="ico">${d.icon}</span><span><b>${d.name}</b><small>${esc(d.blurb)}</small></span>
            <button class="btn ${on ? '' : 'gold'}" data-equip="${w}" ${on ? 'disabled' : ''}>${on ? 'Equipped' : 'Equip'}</button></div>`;
        })
        .join('')}</div>
      <p class="sub">Brann the Smith in Hearthvale sells weapons you don't own yet.</p>
      ${p.items.length ? `<h3>Relics</h3>${p.items.map((i) => `<div class="recipe">${esc(i)}</div>`).join('')}` : ''}
    `;
    this.sheet('🎒 Bag', body);
    $(this.modal, '.eat').addEventListener('click', () => {
      this.ctrl.eatFish();
      this.render();
    });
    this.modal.querySelectorAll<HTMLButtonElement>('[data-equip]').forEach((b) =>
      b.addEventListener('click', () => {
        this.ctrl.equipWeapon(b.dataset.equip as WeaponType);
        this.render();
      }),
    );
  }

  // ================================================================ dialogs & cards

  dialog(speaker: string, portrait: string, text: string, options: DialogOption[]): void {
    this.panel = 'dialog';
    this.modal.classList.remove('hidden');
    this.ctrl.setPaused(true);
    this.modal.innerHTML = `
      <div class="dialog">
        <div class="speaker"><span class="ico">${portrait}</span><b>${esc(speaker)}</b></div>
        <p>${text}</p>
        <div class="opts">${options
          .map((o, i) => `<button class="btn ${i === 0 ? 'gold' : ''}" data-opt="${i}" ${o.disabled ? 'disabled' : ''}>${o.label}</button>`)
          .join('')}</div>
      </div>`;
    this.modal.querySelectorAll<HTMLButtonElement>('[data-opt]').forEach((b) =>
      b.addEventListener('click', () => {
        const o = options[Number(b.dataset.opt)];
        if (!o.keep) this.close();
        o.action?.();
      }),
    );
  }

  discovery(card: DiscoveryCard): void {
    this.discoveries.push(card);
    if (!this.showingDiscovery && this.panel !== 'dialog' && this.panel !== 'minigame') this.nextDiscovery();
  }

  private nextDiscovery(): void {
    const card = this.discoveries.shift();
    if (!card) return;
    this.showingDiscovery = true;
    this.modal.classList.remove('hidden');
    this.ctrl.setPaused(true);
    this.modal.innerHTML = `
      <div class="discovery" style="--accent:${card.accent ?? '#ffd76a'}">
        <div class="rays"></div>
        <div class="kicker">${card.kicker}</div>
        <div class="big-ico">${card.icon}</div>
        <h2>${esc(card.title)}</h2>
        <p>${card.body}</p>
        <button class="btn gold ok">${this.discoveries.length ? 'Next' : 'Onward'}</button>
      </div>`;
    $(this.modal, '.ok').addEventListener('click', () => {
      this.showingDiscovery = false;
      if (this.discoveries.length) this.nextDiscovery();
      else if (this.panel) this.render();
      else {
        this.modal.classList.add('hidden');
        this.modal.innerHTML = '';
        this.ctrl.setPaused(false);
        this.renderHotbar();
      }
    });
  }

  // ================================================================ minigames

  forgeMinigame(): Promise<number> {
    return new Promise((resolve) => {
      this.panel = 'minigame';
      this.modal.classList.remove('hidden');
      this.ctrl.setPaused(true);
      this.modal.innerHTML = `
        <div class="dialog minigame">
          <div class="speaker"><span class="ico">🔨</span><b>The Forge</b></div>
          <p>Strike when the marker is in the <b class="hot">glowing zone</b>. Three strikes.</p>
          <div class="meter"><div class="zone"></div><div class="marker"></div></div>
          <div class="strikes"><span>·</span><span>·</span><span>·</span></div>
          <button class="btn gold strike">🔨 Strike!</button>
        </div>`;
      const marker = $(this.modal, '.marker');
      const zone = $(this.modal, '.meter .zone');
      const strikes = this.modal.querySelectorAll('.strikes span');
      let zoneStart = 0.35 + Math.random() * 0.3;
      const zoneW = 0.18;
      zone.style.left = `${zoneStart * 100}%`;
      zone.style.width = `${zoneW * 100}%`;
      let t = 0;
      let dir = 1;
      let speed = 1.1;
      let n = 0;
      let good = 0;
      let raf = 0;
      let last = performance.now();
      const tick = (now: number) => {
        const dt = (now - last) / 1000;
        last = now;
        t += dir * speed * dt;
        if (t > 1) {
          t = 1;
          dir = -1;
        } else if (t < 0) {
          t = 0;
          dir = 1;
        }
        marker.style.left = `${t * 100}%`;
        raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      $(this.modal, '.strike').addEventListener('click', () => {
        const hit = t >= zoneStart && t <= zoneStart + zoneW;
        strikes[n].textContent = hit ? '✦' : '✕';
        strikes[n].className = hit ? 'hit' : 'miss';
        if (hit) good++;
        n++;
        speed += 0.35;
        zoneStart = 0.15 + Math.random() * 0.65;
        zone.style.left = `${zoneStart * 100}%`;
        if (n >= 3) {
          cancelAnimationFrame(raf);
          setTimeout(() => {
            this.close();
            resolve(good);
          }, 450);
        }
      });
    });
  }

  fishingMinigame(): Promise<boolean> {
    return new Promise((resolve) => {
      this.panel = 'minigame';
      this.modal.classList.remove('hidden');
      this.ctrl.setPaused(true);
      this.modal.innerHTML = `
        <div class="dialog minigame">
          <div class="speaker"><span class="ico">🎣</span><b>Fishing</b></div>
          <p class="fish-msg">Waiting for a bite...</p>
          <div class="pond"><span class="bob">🔴</span></div>
          <button class="btn gold reel">Reel in!</button>
        </div>`;
      const msg = $(this.modal, '.fish-msg');
      const bob = $(this.modal, '.bob');
      let biting = false;
      let done = false;
      const finish = (ok: boolean, text: string) => {
        if (done) return;
        done = true;
        msg.textContent = text;
        setTimeout(() => {
          this.close();
          resolve(ok);
        }, 700);
      };
      const biteAt = 1200 + Math.random() * 2600;
      const t1 = setTimeout(() => {
        biting = true;
        bob.classList.add('bite');
        msg.textContent = '❗ Something bites! Reel in!';
        setTimeout(() => {
          if (biting && !done) finish(false, 'It got away...');
        }, 900);
      }, biteAt);
      $(this.modal, '.reel').addEventListener('click', () => {
        if (biting) finish(true, '🐟 Caught one!');
        else {
          clearTimeout(t1);
          finish(false, 'Too early — the fish swam off.');
        }
      });
    });
  }
}

