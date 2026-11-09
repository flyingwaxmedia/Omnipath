// The Star Chart (starchart lane; docs/CLIENT-v3.md §3, docs/UX-SIMPLE.md §3): the Skills button opens it. Tabs
// Chart | List | Passives | Essences — Passives and Essences appear only once they have something in them
// (ctrl.unlocks()). Chart = the night sky (../starchart/sky.ts) drawn from ctrl.starChartData() laid out by
// ../starchart/layout.ts, with constellation chips, zoom buttons and the simple card of the tapped star. List = a plain
// icon grid (Class skills / Your skills / Other skills); a tile opens the same card. Passives / Essences: ./skills.ts.
//
// Panel 'skills', arg: none (the last tab, Chart by default) · a tab id 'chart' / 'skills' (the List keeps
// data-tab="skills") / 'list' / 'passives' / 'essences' · 'star:<id>' (centre on it and open its card) · a skill id or
// 'el:<id>' (its card) · 'tree:<weapon>' (that weapon's constellation). dialogs.ts may preset ui.state['skills.tab'].
import '../styles/starchart.css';
import type { WeaponType } from '../../core/types';
import { gameBus } from '../../game/events';
import type { GameController, UnlocksView } from '../controller';
import { type CardModel, cardHtml, cardModel, wireCard } from '../starchart/card';
import { CONSTELLATIONS, type ConstellationId, type StarChartData } from '../starchart/data';
import { layoutStarChart } from '../starchart/layout';
import { type SkyView, TINT, sharedSky } from '../starchart/sky';
import { $, $$, hex } from '../util';
import { type PanelHost, RESUMING, tabsHtml } from './common';
import { essencesTab, listTab, passivesTab, sheet } from './skills';

const TAB = 'skills.tab';
const SEL = 'starchart.sel';
const MORE = 'starchart.more';
/** The star whose card has "Details" open (kept across re-renders: equips, the change feed, Back from a picker). */
const DETAILS = 'starchart.details';
type Tab = 'chart' | 'skills' | 'passives' | 'essences';
const TREE: Record<WeaponType, ConstellationId> = { sword: 'edge', dagger: 'fang', staff: 'lantern' };

/** Where the sky should look once it has a size (set by the panel arg on open). */
let focus: { kind: 'star'; id: string } | { kind: 'const'; c: ConstellationId } | null = null;

/**
 * A real open of the chart (ui.open('skills', arg) emits uiOpen before rendering). Re-renders — taps, the change feed,
 * coming back from a discovery card that covered the chart — are not opens, so the selection and the camera stay.
 */
let opened = false;
/** A fresh transform: its star bursts the next time the chart is on screen (a "Transformed" card may cover it now). */
let burst: string | null = null;
/** The chart stage being watched for size changes (the card, the screen). */
let watched: { stage: HTMLElement; obs: ResizeObserver } | null = null;
gameBus.on('uiOpen', (e) => {
  if (e.panel === 'skills') opened = true;
});

function unlocks(ctrl: GameController): UnlocksView {
  try {
    return ctrl.unlocks();
  } catch {
    return { fusion: false, essences: false, passives: false, classes: false, keepsakes: false, quests: false };
  }
}

/** A fresh open (or a new arg): pick the tab, the selected star and where to look. */
function openWith(host: PanelHost, arg?: string): void {
  delete host.state[SEL];
  delete host.state[MORE];
  delete host.state[DETAILS];
  focus = null;
  if (!arg) return;
  // 'card:<id>': back from the picker (Equip with every slot full) — the same tab, that star's card, the camera as it was.
  if (arg.startsWith('card:')) {
    host.state[SEL] = arg.slice(5);
    return;
  }
  if (arg === 'chart' || arg === 'skills' || arg === 'list' || arg === 'passives' || arg === 'essences') {
    host.state[TAB] = arg === 'list' ? 'skills' : arg;
    return;
  }
  host.state[TAB] = 'chart';
  if (arg.startsWith('tree:')) {
    const w = arg.slice(5) as WeaponType;
    focus = { kind: 'const', c: TREE[w] ?? 'edge' };
    return;
  }
  const id = arg.startsWith('star:') ? arg.slice(5) : arg;
  host.state[SEL] = id;
  focus = { kind: 'star', id };
}

function tabsFor(host: PanelHost, cur: string): [Tab, string][] {
  const un = unlocks(host.ctrl);
  const tabs: [Tab, string][] = [
    ['chart', 'Chart'],
    ['skills', 'List'],
  ];
  if (un.passives || cur === 'passives') tabs.push(['passives', 'Passives']);
  if (un.essences || cur === 'essences') tabs.push(['essences', 'Essences']);
  return tabs;
}

function titleHtml(data: StarChartData): string {
  return `Star Chart <span class="sc-count">Stars charted <b>${data.charted}</b> / ${data.total}</span>`;
}

function chipsHtml(data: StarChartData): string {
  const lit = new Set<ConstellationId>();
  const ready = new Set<ConstellationId>();
  for (const s of data.stars) {
    const c = s.constellation === 'universal' ? 'craft' : s.constellation;
    if (s.state === 'known' || s.state === 'mastered' || s.state === 'morphReady') lit.add(c);
    if (s.state === 'morphReady') ready.add(c);
  }
  return CONSTELLATIONS.map(
    (c) =>
      `<button class="sc-chip ${lit.has(c.id) ? '' : 'dim'}" data-c="${c.id}" style="--t:${TINT[c.id]}" aria-label="${c.name}"><i class="sc-dot" aria-hidden="true"></i>${chipName(c.name)}${ready.has(c.id) ? '<em class="sc-ready" aria-label="Ready to transform">✨</em>' : ''}</button>`,
  ).join('');
}

/** "The Lantern" with its "The" in a span: beside a docked card the chips drop it to fit (starchart.css). */
function chipName(name: string): string {
  const m = /^(The )(.+)$/.exec(name);
  return m ? `<span class="sc-the">${m[1]}</span>${m[2]}` : name;
}

/** The selected star's card model (null when nothing is selected or the id is gone). */
function selectedCard(host: PanelHost, data: StarChartData): CardModel | null {
  const id = host.state[SEL] as string | undefined;
  if (!id) return null;
  try {
    return cardModel(host.ctrl, id, data.stars.find((s) => s.id === id));
  } catch {
    return null;
  }
}

export function renderStarChart(host: PanelHost, arg?: string): void {
  const existing = host.modal.querySelector<HTMLElement>('.sheet.starchart');
  // Coming back from a discovery card re-emits uiOpen (the loop sleeps again): a resume, not an open.
  const fresh = opened && !host.state[RESUMING];
  opened = false;
  if (fresh) openWith(host, arg);
  const tabs = tabsFor(host, (host.state[TAB] as string | undefined) ?? 'chart');
  let tab = (host.state[TAB] as Tab | undefined) ?? 'chart';
  if (!tabs.some(([t]) => t === tab)) tab = 'chart';
  host.state[TAB] = tab;
  const data = host.ctrl.starChartData();
  if (tab === 'chart') renderChart(host, data, tabs, fresh ? null : existing);
  else renderPage(host, data, tabs, tab, fresh ? null : existing);
}

// ==================================================================== shared chrome

function wireTabsRow(host: PanelHost, root: ParentNode): void {
  $$<HTMLButtonElement>(root, '.sc-tabs-row .tab').forEach((b) =>
    b.addEventListener('click', () => {
      if (host.state[TAB] === b.dataset.tab && !host.state[SEL]) return;
      host.state[TAB] = b.dataset.tab;
      delete host.state[SEL];
      delete host.state[MORE];
      host.render();
    }),
  );
}

function select(host: PanelHost, id: string | null): void {
  if (id) host.state[SEL] = id;
  else delete host.state[SEL];
  delete host.state[MORE];
  host.render();
}

function wireSelectedCard(host: PanelHost, wrap: HTMLElement, m: CardModel, after?: { transformed?: (to: string) => void }): void {
  wireCard(host, wrap, m, {
    back: () => select(host, null),
    select: (id) => select(host, id),
    more: (open) => {
      if (open) host.state[MORE] = m.id;
      else delete host.state[MORE];
    },
    details: (open) => {
      if (open) host.state[DETAILS] = m.id;
      else if (host.state[DETAILS] === m.id) delete host.state[DETAILS];
    },
    transformed: (to) => {
      host.state[SEL] = to;
      delete host.state[MORE];
      after?.transformed?.(to);
      host.render();
    },
  });
}

// ==================================================================== Chart

function renderChart(host: PanelHost, data: StarChartData, tabs: [Tab, string][], existing: HTMLElement | null): void {
  const ctrl = host.ctrl;
  const sky = sharedSky();
  const layout = layoutStarChart(data);
  const m = selectedCard(host, data);
  const more = host.state[MORE] === m?.id;
  const card = m ? cardHtml(m, { back: true, more, details: host.state[DETAILS] === m.id }) : '';
  let root: HTMLElement;
  if (existing && existing.dataset.tab === 'chart') {
    // In place: the canvas, the camera and the chips' scroll position stay.
    root = existing;
    $(root, 'header h2').innerHTML = titleHtml(data);
    const row = $(root, '.sc-tabs-row');
    row.innerHTML = tabsHtml(TAB, tabs, 'chart');
    wireTabsRow(host, row);
    const chips = $(root, '.sc-chips');
    const left = chips.scrollLeft;
    chips.innerHTML = chipsHtml(data);
    chips.scrollLeft = left;
    wireChips(chips, sky);
  } else {
    const hint = ctrl.firstTime?.('star_chart') ?? false;
    const body = sheet(
      host,
      titleHtml(data),
      `<div class="sc-tabs-row">${tabsHtml(TAB, tabs, 'chart')}</div>
      <div class="sc-stage">
        <div class="sc-sky"></div>
        <div class="sc-chips" role="toolbar" aria-label="Constellations">${chipsHtml(data)}</div>
        <div class="sc-zoom"><button data-zoom="in" aria-label="Zoom in">+</button><button data-zoom="out" aria-label="Zoom out">−</button></div>
        ${hint ? '<p class="sc-hint">Drag to look around. Tap a star.</p>' : ''}
        <div class="sc-card-wrap hidden"></div>
      </div>`,
      'starchart',
    );
    root = body.closest<HTMLElement>('.sheet')!;
    root.dataset.tab = 'chart';
    wireTabsRow(host, root);
    wireChips($(root, '.sc-chips'), sky);
    $$<HTMLButtonElement>(root, '.sc-zoom [data-zoom]').forEach((b) => b.addEventListener('click', () => sky.zoomBy(b.dataset.zoom === 'in' ? 1.5 : 1 / 1.5)));
  }
  const stage = $(root, '.sc-stage');
  const wrap = $(root, '.sc-card-wrap');
  wrap.innerHTML = card;
  wrap.classList.toggle('hidden', !m);
  stage.classList.toggle('has-card', !!m);
  if (m) {
    wireSelectedCard(host, wrap, m, {
      transformed: (to) => {
        burst = to;
      },
    });
  }
  sky.mount($(root, '.sc-sky'), {
    tap: (id) => select(host, id),
    icon: (s) => {
      try {
        return s.kind === 'element' ? ctrl.iconUrl('el', s.id.slice(3)) : ctrl.iconUrl('skill', s.id);
      } catch {
        return '';
      }
    },
    elementColor: (id) => {
      const el = ctrl.reg.element(id as never);
      return el ? hex(el.color) : '';
    },
    centred: (c) => {
      for (const b of $$<HTMLButtonElement>(root, '.sc-chip')) b.classList.toggle('on', b.dataset.c === c);
    },
  });
  sky.setData(data, layout);
  sky.setSelected(m ? m.id : null);
  const sync = () => sky.setInsets(measureInsets(stage));
  sync();
  if (watched?.stage !== stage) {
    // The card grows (Details) or the screen turns: keep the picked star out from under it. One observer at a time.
    watched?.obs.disconnect();
    const obs = new ResizeObserver(() => {
      sync();
      const id = host.state[SEL] as string | undefined;
      if (id && stage.isConnected) sky.ensureVisible(id);
    });
    obs.observe(stage);
    obs.observe(wrap);
    watched = { stage, obs };
  }
  const f = focus;
  focus = null;
  const b = burst;
  burst = null;
  sky.whenSized(() => {
    sync();
    if (b) {
      sky.focusStar(b, { minZ: Math.max(1, sky.cam.z) });
      sky.burst(b);
    } else if (f?.kind === 'star') {
      if (!sky.focusStar(f.id, { minZ: 1, fly: false }) && !sky.placedOnce) sky.fitConstellation(TREE[ctrl.session.player.weapon] ?? 'edge', false);
    } else if (f?.kind === 'const') sky.fitConstellation(f.c, false);
    else if (!sky.placedOnce) sky.fitConstellation(TREE[ctrl.session.player.weapon] ?? 'edge', false);
    else if (m) sky.ensureVisible(m.id);
  });
}

function wireChips(chips: HTMLElement, sky: SkyView): void {
  $$<HTMLButtonElement>(chips, '.sc-chip').forEach((b) => b.addEventListener('click', () => sky.fitConstellation(b.dataset.c as ConstellationId)));
}

/** CSS px of the sky hidden under the chips (top) and the card (bottom on phones, right on wide screens). */
function measureInsets(stage: HTMLElement): { top: number; right: number; bottom: number; left: number } {
  const s = stage.getBoundingClientRect();
  const out = { top: 0, right: 0, bottom: 0, left: 0 };
  const chips = stage.querySelector('.sc-chips')?.getBoundingClientRect();
  if (chips && chips.height) out.top = Math.max(0, chips.bottom - s.top);
  const card = stage.querySelector('.sc-card-wrap:not(.hidden)')?.getBoundingClientRect();
  if (card && card.height) {
    const docked = card.left > s.left + s.width * 0.35 && card.top < s.top + s.height * 0.5;
    if (docked) out.right = Math.max(0, s.right - card.left);
    else out.bottom = Math.max(0, s.bottom - card.top);
  }
  return out;
}

// ==================================================================== List / Passives / Essences

function renderPage(host: PanelHost, data: StarChartData, tabs: [Tab, string][], tab: Exclude<Tab, 'chart'>, existing: HTMLElement | null): void {
  const scroller = existing?.dataset.tab === tab ? existing.querySelector<HTMLElement>('.sc-scroll') : null;
  const keep = scroller?.scrollTop ?? 0;
  const sel = tab === 'skills' ? ((host.state[SEL] as string | undefined) ?? null) : null;
  const m = sel ? selectedCard(host, data) : null;
  const inner = tab === 'skills' ? listTab(host, sel) : tab === 'passives' ? passivesTab(host) : essencesTab(host);
  const body = sheet(
    host,
    titleHtml(data),
    `<div class="sc-tabs-row">${tabsHtml(TAB, tabs, tab)}</div>
    <div class="sc-page ${m ? 'has-card' : ''}">
      <div class="sc-scroll"><div class="sc-inner ${tab}">${inner}</div></div>
      ${m ? `<div class="sc-scrim" aria-hidden="true"></div><div class="sc-card-wrap">${cardHtml(m, { back: true, more: host.state[MORE] === m.id, details: host.state[DETAILS] === m.id })}</div>` : ''}
    </div>`,
    'starchart',
  );
  const root = body.closest<HTMLElement>('.sheet')!;
  root.dataset.tab = tab;
  const sc = $(root, '.sc-scroll');
  if (keep) sc.scrollTop = keep;
  wireTabsRow(host, root);
  $$<HTMLButtonElement>(root, '.sc-tile[data-skill]').forEach((b) => b.addEventListener('click', () => select(host, b.dataset.skill!)));
  root.querySelector('.sc-scrim')?.addEventListener('click', () => select(host, null));
  const wrap = root.querySelector<HTMLElement>('.sc-card-wrap');
  if (m && wrap) wireSelectedCard(host, wrap, m);
  if (sel && !m) delete host.state[SEL];
}
