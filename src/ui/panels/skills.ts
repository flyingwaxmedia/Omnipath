// Skills panel (docs/CLIENT-v2.md §7): tabs Skills | Passives | Essences, the per-skill detail view (stats with
// passive adjustments, element + essence slots, hotbar assignment, morphs, variants) and the per-weapon 13-node MORPH
// PATH view (known / ready / open / locked / hidden / sealed nodes, requirement checklist, spark info, charge state,
// morph button). Routing: arg undefined = tabs, 'tree:<weapon>' = path view, anything else = a skill id.
import { elementSlotState, parseVariantId } from '../../core/compose';
import { SECOND_SLOT_OVERBARS } from '../../core/fusion';
import { MASTERY, fusionMinRank } from '../../core/mastery';
import {
  TAG_PASSIVE,
  TAG_PASSIVE_TAGS,
  cooldownPctFor,
  spCostPctFor,
  statPct,
  tagPassiveRank,
  tagPassiveTotalFor,
  tagTotals,
  type TagScopedPct,
} from '../../core/passives';
import type { Registry } from '../../core/registry';
import type { MorphOption } from '../../core/skillbook';
import { WEAPON_TYPES, type EssenceDef, type Requirement, type SkillDef, type WeaponType } from '../../core/types';
import { WEAPONS } from '../../data/weapons';
import { HOTBAR_SIZE } from '../../game/session';
import { SPARK_RUNE } from '../hud';
import { $, $$, esc, hex, shapeText, sourceText } from '../util';
import { type PanelHost, reqList, tab, tabsHtml, wireTabs } from './common';

const BASICS = new Set(Object.values(WEAPONS).map((w) => w.basic));
const TIER_NAME = ['Root', 'Tier I', 'Tier II', 'Capstone'];
/** Requirement types that keep a morph's result hidden until met (mirrors SkillBook's morphOptions). */
const HIDING: ReadonlySet<Requirement['type']> = new Set<Requirement['type']>(['flag', 'mapVisited', 'item']);

// ==================================================================== shared widgets (also used by other panels)

/** sheet(host, ) that plays the slide-in only when the panel opens, not on every re-render (taps, tabs). */
export function sheet(host: PanelHost, title: string, body: string, cls = ''): HTMLElement {
  const again = !!host.modal.querySelector('.sheet');
  return host.sheet(title, body, `${cls}${again ? ' stay' : ''}`);
}

/** ●●○ pips. */
export function pips(n: number, max: number, cls = ''): string {
  let out = '';
  for (let i = 0; i < max; i++) out += `<i class="${i < n ? 'on' : ''}"></i>`;
  return `<span class="pips ${cls}" aria-label="${n} of ${max}">${out}</span>`;
}

/** The spark rune inline (coloured by `color`). */
export function rune(cls = ''): string {
  return `<span class="rune-i ${cls}">${SPARK_RUNE}</span>`;
}

/** Element chip. */
export function elChip(reg: Registry, id: string | undefined): string {
  const el = id ? reg.element(id as never) : undefined;
  return el ? `<span class="chip el" style="--c:${hex(el.color)}">${el.icon} ${esc(el.name)}</span>` : '';
}

/** Essence icons a skill carries, as small badges. */
function essenceBadges(reg: Registry, s: SkillDef): string {
  const list = (s.essences ?? []).map((e) => reg.essence(e)).filter((e): e is EssenceDef => !!e);
  return list.length ? `<span class="ess-badges">${list.map((e) => `<i title="${esc(e.name)}">${e.icon}</i>`).join('')}</span>` : '';
}

/**
 * Element + essence sockets of a known skill: the element slot (free / swap / bound) and one socket per essence
 * slot the skill can ever have (the 2nd locked until SECOND_SLOT_OVERBARS overmastery bars).
 */
export function socketsHtml(host: PanelHost, s: SkillDef): string {
  const { book, reg } = host.ctrl;
  const p = book.progress(s.id);
  const slot = elementSlotState(reg, s);
  const el = s.element ? reg.element(s.element) : undefined;
  const elSock =
    slot === 'free'
      ? `<div class="sock el free"><span class="g">◇</span><small>Element</small><b>Free slot</b></div>`
      : slot === 'swap'
        ? `<div class="sock el on" style="--c:${hex(el!.color)}"><span class="g">${el!.icon}</span><small>Element · swappable</small><b>${esc(el!.name)}</b></div>`
        : `<div class="sock el bound" ${el ? `style="--c:${hex(el.color)}"` : ''}><span class="g">${el ? el.icon : '—'}</span><small>Element · bound</small><b>${el ? esc(el.name) : 'None'}</b></div>`;
  if (s.shape.kind === 'buff') {
    return `<div class="socks">${elSock}<div class="sock ess bound"><span class="g">—</span><small>Essences</small><b>Stances take none</b></div></div>`;
  }
  const slots = book.essenceSlots(s.id);
  const applied = (s.essences ?? []).map((e) => reg.essence(e)).filter((e): e is EssenceDef => !!e);
  const socks: string[] = [];
  for (let i = 0; i < 2; i++) {
    const e = applied[i];
    const label = `Essence ${i ? 'II' : 'I'}`;
    if (e) socks.push(`<div class="sock ess on"><span class="g">${e.icon}</span><small>${label}</small><b>${esc(e.name)}</b></div>`);
    else if (i < slots) socks.push(`<div class="sock ess free"><span class="g">◇</span><small>${label}</small><b>Free slot</b></div>`);
    else {
      const bars = Math.min(p?.overBars ?? 0, SECOND_SLOT_OVERBARS);
      socks.push(
        `<div class="sock ess locked"><span class="g">🔒</span><small>${label}</small><b>${bars}/${SECOND_SLOT_OVERBARS} bars</b></div>`,
      );
    }
  }
  return `<div class="socks">${elSock}${socks.join('')}</div>`;
}

// ==================================================================== weapon paths (13-node morph trees)

export interface PathNode {
  id: string;
  parent: string | null;
  tier: number;
  /** Centre position in the path box, percent. */
  x: number;
  y: number;
}

const ROWS = [8, 33, 58, 83];
const pathCache = new Map<WeaponType, PathNode[]>();

/** The weapon's morph tree laid out: root, T1 per branch, two T2 per branch, the T3 under its parent. */
export function weaponPath(reg: Registry, w: WeaponType): PathNode[] {
  const hit = pathCache.get(w);
  if (hit) return hit;
  const tierOf = (to: string, t?: number) => t ?? reg.skill(to)?.tier ?? 0;
  const root = WEAPONS[w].basic;
  const nodes: PathNode[] = [{ id: root, parent: null, tier: 0, x: 50, y: ROWS[0] }];
  const t1 = reg.morphsFrom(root).filter((m) => tierOf(m.to, m.tier) === 1);
  const n = Math.max(1, t1.length);
  t1.forEach((m1, b) => {
    const bx = (100 * (2 * b + 1)) / (2 * n);
    nodes.push({ id: m1.to, parent: root, tier: 1, x: bx, y: ROWS[1] });
    const t2 = reg.morphsFrom(m1.to).filter((m) => tierOf(m.to, m.tier) === 2);
    t2.forEach((m2, k) => {
      const x2 = bx + (k - (t2.length - 1) / 2) * (100 / (2 * n));
      nodes.push({ id: m2.to, parent: m1.to, tier: 2, x: x2, y: ROWS[2] });
      for (const m3 of reg.morphsFrom(m2.to).filter((m) => tierOf(m.to, m.tier) === 3)) {
        nodes.push({ id: m3.to, parent: m2.to, tier: 3, x: x2, y: ROWS[3] });
      }
    });
  });
  pathCache.set(w, nodes);
  return nodes;
}

/** The weapon path a skill id (or its root) belongs to. */
export function pathOf(reg: Registry, id: string): WeaponType | undefined {
  return WEAPON_TYPES.find((w) => weaponPath(reg, w).some((n) => n.id === id));
}

type NodeState = 'owned' | 'ready' | 'open' | 'locked' | 'veiled' | 'sealed';

interface NodeView extends PathNode {
  def: SkillDef | undefined;
  opt?: MorphOption;
  state: NodeState;
  /** Name and icon may be shown. */
  shown: boolean;
}

function pathViews(host: PanelHost, w: WeaponType): NodeView[] {
  const { book, reg } = host.ctrl;
  const opts = new Map<string, MorphOption[]>();
  const optsOf = (id: string) => {
    let o = opts.get(id);
    if (!o) opts.set(id, (o = book.morphOptions(id)));
    return o;
  };
  return weaponPath(reg, w).map((n): NodeView => {
    const def = reg.skill(n.id);
    if (book.has(n.id)) return { ...n, def, state: 'owned', shown: true, opt: n.parent ? optsOf(n.parent).find((o) => o.morph.to === n.id) : undefined };
    if (!n.parent) return { ...n, def, state: 'locked', shown: true };
    const opt = optsOf(n.parent).find((o) => o.morph.to === n.id);
    if (!book.has(n.parent)) return { ...n, def, opt, state: 'sealed', shown: false };
    if (!opt || !opt.skill) return { ...n, def, opt, state: 'veiled', shown: false };
    const ready = book.isMaxed(n.parent) && (book.progress(n.parent)?.charges ?? 0) > 0 && opt.available;
    return { ...n, def, opt, state: ready ? 'ready' : opt.available ? 'open' : 'locked', shown: true };
  });
}

/** Known / total and ready-to-morph count for a weapon path. */
function pathSummary(host: PanelHost, w: WeaponType): { known: number; total: number; ready: number } {
  const views = pathViews(host, w);
  return {
    known: views.filter((v) => v.state === 'owned').length,
    total: views.length,
    ready: views.filter((v) => v.state === 'ready').length,
  };
}

const STATE_TEXT: Record<NodeState, string> = {
  owned: 'Known',
  ready: 'Ready to morph',
  open: 'Requirements met',
  locked: 'Sealed by requirements',
  veiled: 'Hidden',
  sealed: 'Beyond reach',
};

/** Requirement checklist of a morph, with the implicit "parent mastered + charge" rule and hidden world clues. */
function morphChecklist(host: PanelHost, parent: string, opt: MorphOption, hidden: boolean): string {
  const { book, reg } = host.ctrl;
  const pdef = reg.skill(parent);
  const pp = book.progress(parent);
  const charges = pp?.charges ?? 0;
  const rows: { text: string; ok: boolean }[] = [
    {
      text: `${pdef?.name ?? '?'} at max rank (${pp ? pp.rank : 0}/${pdef?.maxRank ?? '?'})`,
      ok: book.isMaxed(parent),
    },
    { text: `A morph charge (${charges} banked)`, ok: charges > 0 },
  ];
  const reqs = opt.morph.requires ?? [];
  opt.requirements.forEach((r, i) => {
    const req = reqs[i];
    if (hidden && !r.ok && HIDING.has(req?.type)) rows.push({ text: 'Something out in the world…', ok: false });
    else if (req?.type === 'skill' && !nameKnown(host, req.id)) rows.push({ text: `??? rank ${req.rank ?? 1}`, ok: r.ok });
    else rows.push(r);
  });
  return reqList(rows);
}

/** Whether the player may see a skill's name: known, or a visible morph of a skill they know. */
function nameKnown(host: PanelHost, id: string): boolean {
  const { book, reg } = host.ctrl;
  if (book.has(id)) return true;
  return reg.morphsTo(id).some((m) => book.has(m.from) && !!book.morphOptions(m.from).find((o) => o.morph.to === id)?.skill);
}

/** Spark info for a morph that can crack open mid-fight. */
function sparkInfo(host: PanelHost, parent: string, opt: MorphOption): string {
  if (!opt.spark) return '';
  const { book, reg } = host.ctrl;
  const fams = opt.morph.spark?.families;
  const rank = book.rank(parent);
  const pname = esc(reg.skill(parent)?.name ?? '?');
  const others = opt.requirements.every((r) => r.ok);
  return `<div class="spark-info">${rune('lit')}<div>
    <b>Can spark mid-fight</b>
    <small>Hit ${fams?.length ? fams.join(' or ') + ' ' : ''}foes near threat ${opt.spark.threat} with ${pname}. A spark skips the max-rank and charge rules — but not the others.</small>
    ${reqList([
      { text: `${pname} rank ${opt.spark.minParentRank}+ (now ${rank})`, ok: rank >= opt.spark.minParentRank },
      { text: 'Every other requirement met', ok: others },
    ])}
    <small>Watch the rune on your hotbar: it glows when the odds are good.</small></div></div>`;
}

/** One morph as a card: used by the skill detail view and the path view. */
function morphCard(host: PanelHost, parent: string, opt: MorphOption, nodeState?: NodeState): string {
  const { book } = host.ctrl;
  const s = opt.skill;
  const tier = TIER_NAME[opt.tier] ?? `Tier ${opt.tier}`;
  if (opt.owned && s) {
    return `<div class="morph owned"><span class="ico">${s.icon}</span><span><b>${esc(s.name)}</b><small>${tier} · Known · rank ${book.rank(s.id)}/${s.maxRank}</small></span>
      <button class="btn" data-goto="${esc(s.id)}">Open ›</button></div>`;
  }
  if (!s) {
    return `<div class="morph veiled"><span class="ico">❔</span><span><b>??? <small>${tier}</small></b>
      <small class="hint">“${esc(opt.hint)}”</small>${morphChecklist(host, parent, opt, true)}${sparkInfo(host, parent, opt)}</span></div>`;
  }
  const maxed = book.isMaxed(parent);
  const charges = book.progress(parent)?.charges ?? 0;
  const ready = maxed && charges > 0 && opt.available;
  const label = ready ? 'Morph' : !maxed ? 'Master first' : !charges ? 'No charge' : 'Sealed';
  const state = nodeState ?? (ready ? 'ready' : opt.available ? 'open' : 'locked');
  return `<div class="morph ${state}"><span class="ico">${s.icon}</span><span><b>${esc(s.name)} <small>${tier}</small></b>
    <small>${esc(s.desc)}</small><small class="shape">${esc(shapeText(s.shape))}${s.element ? ` · ${elChip(host.ctrl.reg, s.element)}` : ''}</small>
    ${morphChecklist(host, parent, opt, false)}${sparkInfo(host, parent, opt)}
    <button class="btn ${ready ? 'gold' : ''} morph-go" data-morph="${esc(opt.morph.to)}" data-from="${esc(parent)}" ${ready ? '' : 'disabled'}>${label}</button></span></div>`;
}

function wireMorphs(host: PanelHost): void {
  $$<HTMLButtonElement>(host.modal, '[data-morph]').forEach((b) =>
    b.addEventListener('click', () => host.ctrl.morph(b.dataset.from!, b.dataset.morph!)),
  );
  $$<HTMLButtonElement>(host.modal, '[data-goto]').forEach((b) => b.addEventListener('click', () => host.open('skills', b.dataset.goto!)));
}

function renderPath(host: PanelHost, w: WeaponType): void {
  const { book, session } = host.ctrl;
  const views = pathViews(host, w);
  const key = `skills.node:${w}`;
  let sel = host.state[key] as string | undefined;
  if (!sel || !views.some((v) => v.id === sel)) {
    sel = (views.find((v) => v.state === 'ready') ?? views.find((v) => v.state === 'open') ?? views.find((v) => v.state !== 'owned' && v.state !== 'sealed') ?? views[0]).id;
  }
  const byId = new Map(views.map((v) => [v.id, v]));
  const lines = views
    .filter((v) => v.parent)
    .map((v) => {
      const p = byId.get(v.parent!)!;
      const cls = v.state === 'owned' ? 'own' : p.state === 'owned' ? 'reach' : 'dim';
      const my = (p.y + v.y) / 2;
      return `<path class="${cls}" d="M${p.x} ${p.y} C${p.x} ${my} ${v.x} ${my} ${v.x} ${v.y}"/>`;
    })
    .join('');
  const nodes = views
    .map((v) => {
      const rk = v.state === 'owned' ? book.rank(v.id) : 0;
      const ch = v.state === 'owned' ? (book.progress(v.id)?.charges ?? 0) : 0;
      const badge =
        v.state === 'owned'
          ? `<i class="mn-rk ${book.isMaxed(v.id) ? 'max' : ''}">${book.isMaxed(v.id) ? '★' : 'R' + rk}</i>${ch ? `<i class="mn-ch">✨${ch}</i>` : ''}`
          : '';
      const spark = v.opt?.spark && v.state !== 'owned' && v.state !== 'sealed' ? `<i class="mn-spark">${SPARK_RUNE}</i>` : '';
      const name = v.shown && v.def ? esc(v.def.name) : '???';
      return `<button class="mnode ${v.state} t${v.tier} ${v.id === sel ? 'sel' : ''}" data-node="${esc(v.id)}" style="left:${v.x}%;top:${v.y}%" aria-label="${name}: ${STATE_TEXT[v.state]}">
        <span class="mn-ico">${v.shown && v.def ? v.def.icon : v.state === 'sealed' ? '·' : '?'}${badge}${spark}</span><span class="mn-name">${name}</span></button>`;
    })
    .join('');
  const cur = byId.get(sel)!;
  let detail: string;
  if (cur.state === 'owned' && cur.def) {
    const p = book.progress(cur.id)!;
    const max = cur.def.maxRank;
    const pct = (100 * p.xp) / book.barSize(cur.id);
    const kids = views.filter((v) => v.parent === cur.id);
    detail = `<div class="node-head"><span class="ico">${cur.def.icon}</span><div><b>${esc(cur.def.name)}</b>
        <small>${TIER_NAME[cur.tier]} · ${book.isMaxed(cur.id) ? `★ Mastered${p.charges ? ` · ${pips(p.charges, MASTERY.maxCharges, 'gold')} charge${p.charges > 1 ? 's' : ''}` : ''}` : `Rank ${p.rank}/${max}`}</small>
        <span class="bar mini ${book.isMaxed(cur.id) ? 'over' : ''}"><i style="width:${pct}%"></i></span></div></div>
      <p class="sub">${esc(cur.def.desc)}</p>
      ${kids.length ? `<p class="sub">${book.isMaxed(cur.id) ? (p.charges ? `Spend a charge on one of its ${kids.length} forms below.` : 'Keep using it: each overmastery bar banks another morph charge.') : `Master it (rank ${max}) to morph it into ${kids.length === 1 ? 'its next form' : `one of ${kids.length} forms`}. You keep ${esc(cur.def.name)}.`}</p>` : '<p class="sub">A capstone: the end of this branch.</p>'}
      <button class="btn wide" data-goto="${esc(cur.id)}">Open ${esc(cur.def.name)} ›</button>
      ${kids.map((k) => (k.opt ? morphCard(host, cur.id, k.opt, k.state) : '')).join('')}`;
  } else if (!cur.parent) {
    detail = `<div class="node-head"><span class="ico">${cur.def?.icon ?? '?'}</span><div><b>${esc(cur.def?.name ?? '?')}</b><small>Root · basic attack</small></div></div>
      <p class="sub">Every ${esc(WEAPONS[w].name)} path starts here. ${session.player.ownedWeapons.includes(w) ? 'Equip it to begin.' : `Brann the Smith in Hearthvale sells one for 🪙${WEAPONS[w].price}.`}</p>`;
  } else if (cur.state === 'sealed') {
    const parent = byId.get(cur.parent)!;
    detail = `<div class="node-head"><span class="ico">❔</span><div><b>???</b><small>${TIER_NAME[cur.tier]} · beyond reach</small></div></div>
      <p class="sub">Learn ${parent.shown && parent.def ? `<b>${esc(parent.def.name)}</b>` : 'the form before it'} first. ${cur.opt?.spark ? 'Rumour says this form can also spark mid-fight.' : ''}</p>`;
  } else {
    detail = morphCard(host, cur.parent, cur.opt!, cur.state);
  }
  const sum = pathSummary(host, w);
  const body = `
    <div class="path-top"><button class="back" aria-label="Back to skills">‹</button>
    <div class="path-tabs" role="tablist">${WEAPON_TYPES.map((x) => {
      const s = pathSummary(host, x);
      return `<button class="ptab ${x === w ? 'on' : ''}" data-path="${x}">${WEAPONS[x].icon} ${esc(WEAPONS[x].name.split(' ').pop()!)}<small>${s.known}/${s.total}${s.ready ? ' · ✨' : ''}</small></button>`;
    }).join('')}</div></div>
    <div class="path-split">
      <div class="mtree-wrap">
        <div class="mtree" style="--n:${views.length}">
          <svg class="mlines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">${lines}</svg>
          ${nodes}
        </div>
        <div class="mlegend"><span><i class="lg owned"></i>Known</span><span><i class="lg ready"></i>Ready</span><span><i class="lg locked"></i>Sealed</span><span><i class="lg veiled"></i>Hidden</span><span>${rune('lit sm')} Spark</span></div>
      </div>
      <div class="mdetail">${detail}</div>
    </div>
    <p class="foot">${sum.known} of ${sum.total} forms known on the ${esc(WEAPONS[w].name)} path</p>`;
  sheet(host, '🌳 Morph Paths', body, 'wide');
  $(host.modal, '.back').addEventListener('click', () => host.open('skills'));
  $$<HTMLButtonElement>(host.modal, '[data-path]').forEach((b) => b.addEventListener('click', () => host.open('skills', `tree:${b.dataset.path}`)));
  $$<HTMLButtonElement>(host.modal, '[data-node]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state[key] = b.dataset.node;
      host.render();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-goto]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state['skills.back'] = `tree:${w}`;
      host.open('skills', b.dataset.goto!);
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-morph]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state[key] = b.dataset.morph;
      host.ctrl.morph(b.dataset.from!, b.dataset.morph!);
    }),
  );
}

// ==================================================================== skills list

interface Group {
  key: string;
  title: string;
  roots: SkillDef[];
  path?: WeaponType;
}

/** The authored skill or raw merge a variant id was composed from. */
function rootId(id: string): string {
  return parseVariantId(id)?.base ?? id;
}

function groupKey(host: PanelHost, s: SkillDef): string {
  const { reg, book } = host.ctrl;
  const w = pathOf(reg, s.id);
  if (w) return `path:${w}`;
  const src = book.progress(s.id)?.source ?? '';
  if (s.mergedFrom) return 'merge';
  if (src.startsWith('class:') || s.id.endsWith('_sig')) return 'sig';
  if (s.tags.includes('echo')) return 'echo';
  if (src.startsWith('lesson:') || s.tags.includes('technique')) return 'tech';
  return 'other';
}

const GROUP_TITLES: Record<string, string> = {
  tech: '🥋 Techniques',
  echo: '👁 Echoes',
  merge: '⚗️ Shape Fusions',
  sig: '🏛️ Class Signatures',
  other: '✧ Other Arts',
};

function skillCard(host: PanelHost, s: SkillDef, variant: boolean, picking: boolean): string {
  const { book, reg, session } = host.ctrl;
  const p = book.progress(s.id)!;
  const max = p.rank >= s.maxRank;
  const pct = (100 * p.xp) / book.barSize(s.id);
  const morph = book.canMorph(s.id);
  const usable = host.ctrl.usable(s.id).ok;
  const slot = session.player.hotbar.indexOf(s.id);
  const isNew = p.uses === 0 && slot < 0 && !BASICS.has(s.id);
  const pickable = picking && !BASICS.has(s.id);
  return `<button class="skill-card ${variant ? 'variant' : ''} ${max ? 'maxed' : ''} ${morph ? 'can-morph' : ''} ${usable ? '' : 'unusable'} ${picking && !pickable ? 'nopick' : ''}" data-skill="${esc(s.id)}" ${picking && !pickable ? 'disabled' : ''}>
    <span class="ico">${s.icon}</span>
    <span class="meta">
      <span class="nm"><b>${esc(s.name)}</b>${elChip(reg, s.element)}${essenceBadges(reg, s)}</span>
      <span class="rank">${max ? `★ Mastered${p.charges ? ` · <em>${p.charges} morph charge${p.charges > 1 ? 's' : ''}</em>` : ''}` : `Rank ${p.rank} / ${s.maxRank}`}${usable ? '' : ` · ${s.weapons?.map((w) => WEAPONS[w].icon).join('') ?? ''} only`}</span>
      <span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span>
    </span>
    <span class="flags">${isNew ? '<i class="new">NEW</i>' : ''}${slot >= 0 ? `<i class="hk">${slot + 1}</i>` : ''}${host.ctrl.isAutoCast(s.id) ? '<i class="au" title="Auto-cast">⟳</i>' : ''}${morph ? '<i class="mr">✨</i>' : ''}</span>
  </button>`;
}

function pathCards(host: PanelHost): string {
  const { session } = host.ctrl;
  return `<div class="path-cards">${WEAPON_TYPES.map((w) => {
    const s = pathSummary(host, w);
    const owned = session.player.ownedWeapons.includes(w);
    return `<button class="path-card ${owned || s.known ? '' : 'dim'} ${s.ready ? 'ready' : ''}" data-path="${w}">
      <span class="ico">${WEAPONS[w].icon}</span><span><b>${esc(WEAPONS[w].name.split(' ').pop()!)} path</b>
      <small>${s.known}/${s.total} forms${s.ready ? ` · <em>${s.ready} ready</em>` : ''}</small>
      <span class="bar mini over"><i style="width:${(100 * s.known) / s.total}%"></i></span></span></button>`;
  }).join('')}</div>`;
}

function hotbarStrip(host: PanelHost, picking: number | undefined): string {
  const { session, reg } = host.ctrl;
  const bar = session.player.hotbar;
  return `<div class="hb-strip ${picking !== undefined ? 'picking' : ''}">
    ${bar
      .map((id, i) => {
        const s = id ? reg.skill(id) : undefined;
        return `<button class="hb ${picking === i ? 'on' : ''} ${s ? '' : 'empty'}" data-hb="${i}" aria-label="Hotbar slot ${i + 1}${s ? ': ' + esc(s.name) : ''}">${s ? s.icon : '+'}<small>${i + 1}</small></button>`;
      })
      .join('')}
  </div>
  ${
    picking !== undefined
      ? `<div class="pick-bar"><span>Choose a skill for slot <b>${picking + 1}</b></span>
          ${bar[picking] ? '<button class="btn" data-hbclear>Clear</button>' : ''}<button class="btn" data-hbcancel>Cancel</button></div>`
      : ''
  }`;
}

function skillsTab(host: PanelHost): string {
  const { book } = host.ctrl;
  const known = book.known();
  const knownIds = new Set(known.map((s) => s.id));
  const variants = new Map<string, SkillDef[]>();
  const roots: SkillDef[] = [];
  for (const s of known) {
    const r = rootId(s.id);
    if (r !== s.id && knownIds.has(r)) variants.set(r, [...(variants.get(r) ?? []), s]);
    else roots.push(s);
  }
  const groups = new Map<string, Group>();
  for (const w of WEAPON_TYPES) groups.set(`path:${w}`, { key: `path:${w}`, title: `${WEAPONS[w].icon} ${WEAPONS[w].name.split(' ').pop()} Path`, roots: [], path: w });
  for (const k of Object.keys(GROUP_TITLES)) groups.set(k, { key: k, title: GROUP_TITLES[k], roots: [] });
  for (const s of roots) groups.get(groupKey(host, host.ctrl.reg.skill(rootId(s.id)) ?? s))!.roots.push(s);
  // Path groups follow tree order (root, T1, T2, T3).
  for (const g of groups.values()) {
    if (!g.path) continue;
    const order = weaponPath(host.ctrl.reg, g.path).map((n) => n.id);
    const at = (s: SkillDef) => {
      const i = order.indexOf(rootId(s.id));
      return i < 0 ? 99 : i;
    };
    g.roots.sort((a, b) => at(a) - at(b));
  }
  const picking = host.state['skills.pick'] as number | undefined;
  const stats = book.stats();
  const html = [...groups.values()]
    .filter((g) => g.roots.length)
    .map((g) => {
      const sum = g.path ? pathSummary(host, g.path) : undefined;
      return `<div class="sgroup"><h3>${g.title}${sum ? ` <small>${sum.known}/${sum.total}</small>` : ''}${
        g.path ? `<button class="mini-link" data-path="${g.path}">View path ›</button>` : ''
      }</h3><div class="cards">${g.roots
        .map(
          (s) =>
            `<div class="sk-family">${skillCard(host, s, false, picking !== undefined)}${(variants.get(s.id) ?? [])
              .map((v) => skillCard(host, v, true, picking !== undefined))
              .join('')}</div>`,
        )
        .join('')}</div></div>`;
    })
    .join('');
  return `
    ${hotbarStrip(host, picking)}
    ${picking === undefined ? pathCards(host) : ''}
    ${html}
    <p class="foot">${stats.authoredKnown} of ${stats.authoredTotal} authored skills · ${stats.infusions} infusions · ${stats.echoesKnown}/${stats.echoesTotal} echoes</p>`;
}

// ==================================================================== passives

function scopedChips(s: TagScopedPct, unit: string, invert = false): string[] {
  const out: string[] = [];
  const fmt = (v: number) => `${v > 0 ? '+' : '−'}${Math.abs(Math.round(v * 10) / 10)}%`;
  const good = (v: number) => (invert ? v < 0 : v > 0);
  if (s.all) out.push(`<span class="chip ${good(s.all) ? 'up' : 'down'}">${fmt(s.all)} ${unit}</span>`);
  for (const [t, v] of Object.entries(s.byTag)) if (v) out.push(`<span class="chip ${good(v) ? 'up' : 'down'}">${fmt(v)} ${unit} · ${esc(t)}</span>`);
  return out;
}

function passivesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const tot = book.totals();
  const active = book.passives();
  const totals = tagTotals(reg, book.state.skills);
  // Damage: tag passives + other passives + the worn class's tagPower (shown per scope; powerPctFor caps per skill).
  const dmg: TagScopedPct = { all: tot.tagPower.all + tot.power.all, byTag: { ...tot.tagPower.byTag } };
  for (const [t, v] of Object.entries(tot.power.byTag)) dmg.byTag[t] = (dmg.byTag[t] ?? 0) + v;
  for (const [t, v] of Object.entries(tot.classTagPower)) dmg.byTag[t] = (dmg.byTag[t] ?? 0) + v;
  const bonus = book.activeBonus();
  const statChips: string[] = [];
  const stat = (v: number | undefined, label: string, pct = true) => {
    if (v) statChips.push(`<span class="chip up">+${Math.round(v * 10) / 10}${pct ? '%' : ''} ${label}</span>`);
  };
  stat(bonus.hp, 'HP');
  stat(bonus.sp, 'SP');
  stat(bonus.atk, 'ATK');
  stat(bonus.matk, 'MATK');
  stat(statPct(tot, 'def'), 'DEF');
  stat(bonus.crit, 'crit', false);
  stat(bonus.speed, 'move');
  if (bonus.cdr) statChips.push(`<span class="chip up">−${bonus.cdr}% cooldowns</span>`);
  const fam = Object.entries(tot.vsFamily)
    .filter(([, v]) => v)
    .map(([f, v]) => `<span class="chip up">+${v}% vs ${esc(f)}</span>`);
  const status = tot.vsStatus.map(
    (s) => `<span class="chip up">+${s.pct}% vs ${esc(s.status)}${s.element ? ` (${esc(reg.element(s.element)?.name ?? s.element)})` : ''}</span>`,
  );
  const rows: [string, string[]][] = [
    ['Damage', scopedChips(dmg, 'dmg')],
    ['SP cost', scopedChips(tot.spCost, 'SP', true)],
    ['Cooldown', scopedChips(tot.cooldown, 'CD', true)],
    ['Mastery', scopedChips(tot.masteryXp, 'XP')],
    ['Stats', statChips],
    ['Hunter', [...fam, ...status]],
    ['Rest', tot.regenStill ? [`<span class="chip up">+${tot.regenStill}% regen standing still</span>`] : []],
  ];
  const summary = rows
    .filter(([, c]) => c.length)
    .map(([k, c]) => `<div class="tot-row"><span>${k}</span><div>${c.join('')}</div></div>`)
    .join('');
  const tagRows = TAG_PASSIVE_TAGS.map((t) => {
    const total = totals[t];
    const rank = tagPassiveRank(total);
    const next = rank >= TAG_PASSIVE.maxRank ? null : tagPassiveTotalFor(rank + 1);
    const prev = rank ? tagPassiveTotalFor(rank) : 0;
    const def = reg.passive(`tag_${t}`);
    const pct = next ? Math.min(100, (100 * (total - prev)) / (next - prev)) : 100;
    return `<div class="prow tagp ${rank ? '' : 'dim'}"><span class="ico">${def?.icon ?? '✧'}</span><span>
      <span class="ph"><b>${esc(def?.name ?? t)}</b>${pips(rank, TAG_PASSIVE.maxRank, 'gold')}</span>
      <small>${rank ? esc(def?.desc ?? '') : `Unlocks at ${TAG_PASSIVE.unlockAt} summed ranks of <i>${t}</i> skills`}</small>
      <span class="bar mini ${rank ? 'over' : ''}"><i style="width:${pct}%"></i></span>
      <small class="num">${total}${next ? ` / ${next} toward rank ${rank + 1}` : ' · max rank'}</small></span></div>`;
  }).join('');
  const listOf = (src: 'learned' | 'class' | 'imprint') =>
    active
      .filter((p) => p.source === src)
      .map(
        (p) => `<div class="prow"><span class="ico">${p.def.icon}</span><span><span class="ph"><b>${esc(p.def.name)}</b>${pips(p.rank, p.def.maxRank, 'gold')}</span>
          <small>${esc(p.def.desc)}${p.strength !== 1 ? ` <em>· ×${p.strength} strength</em>` : ''}</small></span></div>`,
      )
      .join('');
  const learned = listOf('learned');
  const cls = listOf('class');
  const imp = listOf('imprint');
  const worn = book.state.worn ? reg.classDef(book.state.worn) : undefined;
  return `
    <p class="sub">Passives are always on. <b>Tag passives</b> grow from the summed ranks of your skills carrying a tag;
    others come from trainers, resonances, your worn class tree and imprints.</p>
    <div class="totals">${summary || '<p class="sub">No bonuses yet.</p>'}</div>
    <h3>Tag passives</h3>${tagRows}
    <h3>Learned <small>trainers · resonances</small></h3>${learned || '<p class="sub">Trainers teach passives; two elements fused at an altar may resonate into one.</p>'}
    <h3>Class tree <small>${worn ? esc(worn.name) : 'no class worn'}</small></h3>${cls || '<p class="sub">Spend Class Rank points in 🏛️ Class → tree. Tree passives work while the class is worn.</p>'}
    <h3>Imprints</h3>${imp || '<p class="sub">Slot the imprint of another class from 🏛️ Class → Imprints.</p>'}`;
}

// ==================================================================== essences

function essencesTab(host: PanelHost): string {
  const { book, reg } = host.ctrl;
  const known = book.known();
  const all = [...reg.essences.values()];
  const held = (id: string) => book.state.essences[id] ?? 0;
  all.sort((a, b) => Number(held(b.id) > 0) - Number(held(a.id) > 0));
  const rows = all
    .map((e) => {
      const n = held(e.id);
      const on = known.filter((s) => s.essences?.includes(e.id));
      const drops = [...reg.monsters.values()].filter((m) => m.essence === e.id);
      const seen = drops.filter((m) => (book.state.bestiary[m.id] ?? 0) > 0);
      const lessons = reg.trainers.flatMap((t) => t.lessons.filter((l) => 'essence' in l.grants && l.grants.essence === e.id).map(() => t.title));
      const mul = [`power ×${e.powerMul}`, `SP ×${e.spMul}`, ...(e.cdMul && e.cdMul !== 1 ? [`CD ×${e.cdMul}`] : [])].join(' · ');
      const src = [
        ...seen.map((m) => esc(m.name)),
        ...(drops.length > seen.length ? [`${drops.length - seen.length} unmet foe${drops.length - seen.length > 1 ? 's' : ''}`] : []),
        ...[...new Set(lessons)].map((t) => esc(t)),
      ];
      return `<div class="erow ${n ? '' : 'dim'}"><span class="ico">${e.icon}${n ? `<i class="cnt">×${n}</i>` : ''}</span><span>
        <span class="ph"><b>${esc(e.name)}</b><span class="chip">${e.category}</span></span>
        <small>${esc(e.desc)}</small>
        <small class="shape">Shapes: ${e.appliesTo.map((k) => `<span class="chip">${k}</span>`).join('')} · ${mul}</small>
        ${on.length ? `<small class="on">On: ${on.map((s) => `${s.icon} ${esc(s.name)}`).join(', ')}</small>` : ''}
        ${src.length ? `<small>From: ${src.join(' · ')}</small>` : ''}</span></div>`;
    })
    .join('');
  return `
    <p class="sub">Essences reshape a skill at a <b>⚗️ Fusion Altar</b>: put a skill and an essence on it. They are used up only on success.
    Every attack has one essence slot; three overmastery bars open a second. Two essences of the same category never stack.</p>
    ${rows}`;
}

// ==================================================================== entry

export function renderSkills(host: PanelHost, arg?: string): void {
  if (arg?.startsWith('tree:')) {
    const w = arg.slice(5) as WeaponType;
    return renderPath(host, WEAPON_TYPES.includes(w) ? w : host.ctrl.session.player.weapon);
  }
  if (arg) return renderSkill(host, arg);
  const t = tab(host, 'skills.tab', 'skills');
  if (t !== 'skills') delete host.state['skills.pick'];
  const body =
    tabsHtml(
      'skills.tab',
      [
        ['skills', 'Skills'],
        ['passives', 'Passives'],
        ['essences', 'Essences'],
      ],
      t,
    ) + (t === 'passives' ? passivesTab(host) : t === 'essences' ? essencesTab(host) : skillsTab(host));
  sheet(host, '📖 Skills', body);
  wireTabs(host, 'skills.tab');
  const { ctrl } = host;
  $$<HTMLButtonElement>(host.modal, '.skill-card').forEach((b) =>
    b.addEventListener('click', () => {
      const pick = host.state['skills.pick'] as number | undefined;
      if (pick !== undefined) {
        ctrl.assignSlot(pick, b.dataset.skill!);
        delete host.state['skills.pick'];
        host.render();
        return;
      }
      host.open('skills', b.dataset.skill!);
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-path]').forEach((b) => b.addEventListener('click', () => host.open('skills', `tree:${b.dataset.path}`)));
  $$<HTMLButtonElement>(host.modal, '[data-hb]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.hb);
      if (host.state['skills.pick'] === i) delete host.state['skills.pick'];
      else host.state['skills.pick'] = i;
      host.render();
    }),
  );
  host.modal.querySelector('[data-hbclear]')?.addEventListener('click', () => {
    ctrl.assignSlot(host.state['skills.pick'] as number, null);
    delete host.state['skills.pick'];
    host.render();
  });
  host.modal.querySelector('[data-hbcancel]')?.addEventListener('click', () => {
    delete host.state['skills.pick'];
    host.render();
  });
}

function renderSkill(host: PanelHost, id: string): void {
  const { ctrl } = host;
  const { book, reg, session } = ctrl;
  const s = reg.skill(id);
  const p = book.progress(id);
  if (!s || !p) return host.open('skills');
  const max = p.rank >= s.maxRank;
  const bar = book.barSize(id);
  const pct = (100 * p.xp) / bar;
  const usable = ctrl.usable(id);
  const weapons = s.weapons ? s.weapons.map((w) => `${WEAPONS[w].icon} ${w}`).join(', ') : 'Any weapon';
  const morphs = book.morphOptions(id);
  const fuseNeed = fusionMinRank(s.maxRank);
  const tot = book.totals();
  const spPct = spCostPctFor(tot, s);
  const cdPct = cooldownPctFor(tot, s);
  const dmgPct = book.tagPowerFor(s);
  const cdr = ctrl.stats().cdr;
  const sp = Math.max(0, Math.round(s.spCost * (1 + spPct / 100)));
  const cdBase = s.cooldown;
  const cd = cdBase * (1 + cdPct / 100) * (1 - cdr / 100);
  const w = pathOf(reg, rootId(id));
  const root = rootId(id);
  const variants = book.known().filter((v) => v.id !== id && rootId(v.id) === id);
  const isBasic = BASICS.has(id);
  const back = (host.state['skills.back'] as string | undefined) ?? '';
  const morphHtml = morphs.length
    ? `<h3>Morphs ${max ? (p.charges ? `<small>${pips(p.charges, MASTERY.maxCharges, 'gold')} ${p.charges} charge${p.charges > 1 ? 's' : ''}</small>` : '<small>no charge banked</small>') : `<small>unlock at rank ${s.maxRank}</small>`}</h3>
      <div class="morphs">${morphs.map((o) => morphCard(host, id, o)).join('')}</div>
      ${max && p.charges === 0 ? '<p class="sub">Keep using this skill: each overmastery bar banks another morph charge (up to 3).</p>' : ''}`
    : `<h3>Morphs</h3><p class="sub">${s.generated ? 'Composed techniques do not morph — but they can take essences and elements.' : 'No known morphs. Perhaps fusion holds its future.'}</p>`;
  const hotbar = isBasic
    ? '<p class="sub">Your basic attack lives on the big button and auto-attacks when you tap an enemy.</p>'
    : `<h3>Hotbar</h3><div class="hb-pick">${Array.from({ length: HOTBAR_SIZE }, (_, i) => {
        const cur = session.player.hotbar[i];
        const curS = cur ? reg.skill(cur) : undefined;
        return `<button class="hb ${cur === id ? 'on' : ''} ${curS ? '' : 'empty'}" data-assign="${i}" aria-label="Slot ${i + 1}">${curS ? curS.icon : '+'}<small>${i + 1}</small></button>`;
      }).join('')}</div>
      <p class="sub">${session.player.hotbar.includes(id) ? `On slot ${session.player.hotbar.indexOf(id) + 1}. Tap it again to clear, or another slot to move it.` : 'Tap a slot to put it there.'}</p>
      ${autoHtml(host, s)}`;
  const body = `
    <button class="back">‹ ${back.startsWith('tree:') ? 'Path' : 'Skills'}</button>
    <div class="skill-head">
      <span class="big-ico">${s.icon}</span>
      <div>
        <h3 class="nm">${esc(s.name)}</h3>
        <div class="chips">
          <span class="chip tier">${TIER_NAME[s.tier] ?? `Tier ${s.tier}`}</span>
          ${elChip(reg, s.element)}
          ${s.tags
            .filter((t) => t !== s.element && !(s.weapons as string[] | undefined)?.includes(t))
            .map((t) => `<span class="chip">${esc(t)}</span>`)
            .join('')}
        </div>
      </div>
    </div>
    <p>${esc(s.desc)}</p>
    <div class="mastery">
      <div class="mh"><b>${max ? `★ Rank ${p.rank} · mastered` : `Rank ${p.rank} / ${s.maxRank}`}</b><small>${Math.floor(p.xp)} / ${bar} ${max ? 'overmastery' : 'XP'}</small></div>
      <span class="bar mini ${max ? 'over' : ''}"><i style="width:${pct}%"></i></span>
      <div class="mh"><small>Morph charges ${pips(p.charges, MASTERY.maxCharges, 'gold')}</small><small>${p.overBars} overmastery bar${p.overBars === 1 ? '' : 's'}</small></div>
    </div>
    ${socketsHtml(host, s)}
    <div class="kv">
      <span>Effect</span><b>${esc(shapeText(s.shape))}</b>
      ${s.power ? `<span>Power</span><b>${Math.round(s.power * 100)}%${s.critBonus ? ` · +${s.critBonus}% crit` : ''}${dmgPct ? ` <em class="up">+${Math.round(dmgPct)}% bonus</em>` : ''}</b>` : ''}
      <span>Cost</span><b>${sp} SP${sp !== s.spCost ? ` <s>${s.spCost}</s>` : ''} · ${cdBase ? `${(cd / 1000).toFixed(1)}s${Math.abs(cd - cdBase) > 5 ? ` <s>${(cdBase / 1000).toFixed(1)}s</s>` : ''}` : 'weapon speed'}${s.castMs ? ` · ${(s.castMs / 1000).toFixed(2)}s wind-up` : ''}</b>
      ${s.riders ? `<span>Riders</span><b>${riderText(s)}</b>` : ''}
      <span>Weapons</span><b>${weapons}</b>
      <span>Origin</span><b>${esc(sourceText(p.source, reg))}</b>
      <span>Used</span><b>${p.uses} time${p.uses === 1 ? '' : 's'}</b>
      <span>Fusion</span><b>${p.rank >= fuseNeed ? '✅ Ready for the altar' : `Rank ${fuseNeed} to fuse`}</b>
    </div>
    ${usable.ok ? '' : `<p class="warn">${esc(usable.reason ?? '')}</p>`}
    ${hotbar}
    ${w ? `<button class="btn wide" data-path="${w}">🌳 View on the ${esc(WEAPONS[w].name.split(' ').pop()!)} path</button>` : ''}
    ${root !== id && reg.skill(root) && book.has(root) ? `<h3>Base</h3><div class="cards">${skillCard(host, reg.skill(root)!, false, false)}</div>` : ''}
    ${variants.length ? `<h3>Variants <small>${variants.length}</small></h3><div class="cards">${variants.map((v) => skillCard(host, v, true, false)).join('')}</div>` : ''}
    ${morphHtml}`;
  sheet(host, '📖 Skills', body);
  $(host.modal, '.back').addEventListener('click', () => {
    delete host.state['skills.back'];
    host.open('skills', back || undefined);
  });
  wireMorphs(host);
  $$<HTMLButtonElement>(host.modal, '.skill-card').forEach((b) => b.addEventListener('click', () => host.open('skills', b.dataset.skill!)));
  $$<HTMLButtonElement>(host.modal, '[data-path]').forEach((b) =>
    b.addEventListener('click', () => {
      host.state[`skills.node:${b.dataset.path}`] = root;
      delete host.state['skills.back'];
      host.open('skills', `tree:${b.dataset.path}`);
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-assign]').forEach((b) =>
    b.addEventListener('click', () => {
      const i = Number(b.dataset.assign);
      const cur = session.player.hotbar[i];
      ctrl.assignSlot(i, cur === id ? null : id);
      host.render();
    }),
  );
  host.modal.querySelector('[data-auto]')?.addEventListener('click', () => {
    const r = ctrl.toggleAutoCast(id);
    if (r.message) host.toast(esc(r.message));
    host.render();
  });
}

/** Auto-cast switch for a skill (attacks with power and buffs; movement-only skills cannot). */
function autoHtml(host: PanelHost, s: SkillDef): string {
  const { ctrl } = host;
  if (s.shape.kind !== 'buff' && s.power <= 0) return '';
  const on = ctrl.isAutoCast(s.id);
  const master = ctrl.autoCastOn();
  return `<div class="auto-row"><button class="switch ${on ? 'on' : ''}" data-auto role="switch" aria-checked="${on}" aria-label="Auto-cast ${esc(s.name)}"><i></i></button>
    <span><b>⟳ Auto-cast</b><small>${on ? (master ? 'Fires on its own while you fight, when ready.' : 'On, but the AUTO switch on the hotbar is paused.') : 'Off — cast it yourself from the hotbar.'}</small></span></div>`;
}

function riderText(s: SkillDef): string {
  const r = s.riders ?? {};
  const out: string[] = [];
  if (r.returns) out.push('returns to you');
  if (r.reprise) out.push(`echoes after ${(r.reprise.delayMs / 1000).toFixed(1)}s at ${Math.round(r.reprise.mult * 100)}%`);
  if (r.arc) out.push(`arcs to ${r.arc.targets} at ${Math.round(r.arc.mult * 100)}%`);
  if (r.leech) out.push(`leeches ${Math.round(r.leech * 100)}%`);
  if (r.knockback) out.push('knocks back');
  return out.join(' · ') || '—';
}
