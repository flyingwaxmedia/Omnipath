// The simple skill card (starchart lane; docs/UX-SIMPLE.md §3): big pixel icon, name, ★ rank, one short line,
// cooldown / SP and ONE primary action — Equip (→ ctrl.equipSkill, slots full → the picker 'skill:<id>'),
// "Equipped ✓", "Class skill ✓", Transform (→ ctrl.morph) or the one next step (a small "?" shows the rest). A known
// skill the held weapon cannot use shows its lock instead: "Needs a sword — Equip" (→ ctrl.equipWeapon; SPEC-v4 §2.2).
// "Details" is closed by default. The same card everywhere: a star in the Star Chart, a tile in its List, a class slot
// on the HUD (ui.open('skill', id)), the Codex, the altar, the Pursuits tracker. Data: ctrl.skillCard(id).
//
// cardModel() gathers the data (fog / whisper stars are masked here: a '?' never leaks a name); cardHtml() is a pure
// HTML-string builder (unit-tested in node); wireCard() hooks the buttons up.
import { fusionMinRank } from '../../core/mastery';
import { gameBus } from '../../game/events';
import { reqStep } from '../../game/steps';
import { equipForSkill, lockOf } from '../classinfo';
import type { GameController } from '../controller';
import { weaponGlyph } from '../hud/html';
import type { PanelHost } from '../panels/common';
import { $$, esc } from '../util';
import { lockLine, originText, plural, stars } from '../words';
import type { StarView } from './data';

/** The ONE primary action of a card. */
export type CardPrimary =
  | { kind: 'equip' }
  | { kind: 'equipped'; slot: number }
  | { kind: 'class'; className: string }
  /** `from` set: this card is the form, and its known parent (`from`) can become it right now. */
  | { kind: 'transform'; to: string; toName: string; from?: string; fromName?: string }
  | { kind: 'step'; text: string }
  /** The held weapon cannot use it: `line` = "Needs a sword"; `owned` → the button equips that weapon. */
  | { kind: 'needs'; weapon: string; line: string; owned: boolean }
  | { kind: 'none' };

export interface CardModel {
  id: string;
  kind: 'skill' | 'element' | 'fog' | 'whisper';
  name: string;
  /** Pixel icon data URL ('' → a big '?'). */
  icon: string;
  known: boolean;
  rank: number;
  maxRank: number;
  /** Toward the next star (or along the Mastery bar), 0..1. */
  progress: number;
  mastered: boolean;
  transformReady: boolean;
  line: string;
  /** Seconds (0 = none) and SP; shown only for known or revealed skills. */
  cooldown: number;
  sp: number;
  primary: CardPrimary;
  /** The one step toward the next transform (small, under the action). */
  next?: string;
  /** Everything else still needed (behind a small "?"). */
  rest: string[];
  /** Behind "Details" (closed by default). */
  details: { label: string; value: string }[];
  /** What it transforms into (Details; tap → that star). '?' names stay hidden. */
  forms: { id: string; name: string; known: boolean }[];
  /** The held weapon cannot use it, shown small under another action: "Needs a dagger". */
  lockNote?: { weapon: string; line: string };
  /** Transform ready with more than one form: the other forms it can take now (small "or …" chips → that form's card). */
  alts?: { id: string; name: string }[];
}

export interface CardOptions {
  /** Show "‹ Back" (closes the card / returns to the list). */
  back?: boolean;
  /** The "?" with the rest of the steps is open. */
  more?: boolean;
  /** A small "Show in Star Chart" link (cards opened outside the chart). */
  chartLink?: boolean;
  /** "Details" is open (kept across re-renders once the player opened it; closed by default). */
  details?: boolean;
}

const sentence = (s: string) => (/[.!?)]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const firstLine = (s: string) => {
  const m = /^(.+?[.!?])(\s|$)/.exec(s.trim());
  return (m ? m[1] : s).trim();
};

/** Everything the card shows for a skill id, 'el:<id>' element, or a fog / whisper star of the chart. */
export function cardModel(ctrl: GameController, id: string, star?: StarView): CardModel {
  const { reg, book } = ctrl;
  const empty = { rank: 0, maxRank: 0, progress: 0, mastered: false, transformReady: false, cooldown: 0, sp: 0, rest: [], details: [], forms: [] };
  // ---- A '?' in the sky: never show its name.
  if (star && star.kind === 'skill' && (star.state === 'fog' || star.state === 'whisper')) {
    if (star.state === 'whisper') {
      const heard = new Set(book.state.hints);
      const r = reg.recipeList.find((x) => x.result === `skill:${id}` && x.hint && heard.has(x.hint));
      return { ...empty, id, kind: 'whisper', name: 'A hidden fusion', icon: '', known: false, line: r?.hint ? `“${r.hint}”` : 'Something could be made here.', primary: { kind: 'step', text: 'Try fusing at an altar to find it.' } };
    }
    const parent = reg.morphsTo(id).find((m) => book.has(m.from));
    const p = parent ? reg.skill(parent.from) : undefined;
    const opt = parent ? book.morphOptions(parent.from).find((o) => o.morph.to === id) : undefined;
    const step =
      p && book.rank(p.id) < p.maxRank ? `Reach ${p.name} rank ${p.maxRank} first.` : 'Keep exploring: the world holds the key.';
    return { ...empty, id, kind: 'fog', name: 'Unknown star', icon: '', known: false, line: opt ? `“${opt.hint}”` : 'Nobody knows what shines here yet.', primary: { kind: 'step', text: step } };
  }
  const v = ctrl.skillCard(id);
  const element = v.kind === 'element' || id.startsWith('el:');
  let icon = '';
  try {
    icon = v.known || !element ? ctrl.iconUrl(element ? 'el' : 'skill', element ? id.slice(3) : id) : '';
  } catch {
    icon = '';
  }
  if (element) {
    const has = v.known;
    return {
      ...empty,
      id,
      kind: 'element',
      name: has ? v.name : 'Unknown element',
      icon: has ? icon : '',
      known: has,
      line: v.line,
      primary: v.action.kind === 'step' ? { kind: 'step', text: v.action.text } : { kind: 'none' },
    };
  }
  const a = v.action;
  let primary: CardPrimary =
    a.kind === 'equip'
      ? { kind: 'equip' }
      : a.kind === 'equipped'
        ? a.byClass
          ? { kind: 'class', className: a.byClass }
          : { kind: 'equipped', slot: a.slot }
        : a.kind === 'transform'
          ? { kind: 'transform', to: a.to, toName: a.toName }
          : a.kind === 'step'
            ? { kind: 'step', text: a.text }
            : { kind: 'none' };
  const sk = reg.skill(id);
  const prog = book.progress(id);
  // A form a known skill can take right now: this card transforms too (the parent's card offers only its first form,
  // so this is how the player picks another one).
  if (!v.known && sk) {
    const via = reg
      .morphsTo(id)
      .find((x) => book.has(x.from) && book.canMorph(x.from) && book.morphOptions(x.from).some((o) => o.morph.to === id && o.available && !o.owned && !!o.skill));
    if (via) primary = { kind: 'transform', to: id, toName: sk.name, from: via.from, fromName: reg.skill(via.from)?.name ?? '' };
  }
  // A skill on your bar that your weapon cannot use: the lock is the card's one action ("Needs a sword — Equip").
  // Not on the bar yet (Equip) or ready to transform: that action stays, and the lock is one small line under it.
  let lockNote: { weapon: string; line: string } | undefined;
  if (v.known) {
    const lock = lockOf(ctrl, id);
    if (lock && (primary.kind === 'equipped' || primary.kind === 'class' || primary.kind === 'none')) primary = { kind: 'needs', weapon: lock.need, line: lock.line, owned: lock.owned };
    else if (lock) lockNote = { weapon: lock.need, line: lock.line };
  }
  // Transform ready with several forms: the others, as small "or …" chips under the button.
  const alts =
    v.known && primary.kind === 'transform' && !primary.from
      ? book
          .morphOptions(id)
          .filter((o) => o.available && !o.owned && o.skill && o.morph.to !== (primary as { to: string }).to)
          .map((o) => ({ id: o.morph.to, name: o.skill!.name }))
      : [];
  // The rest of what an unknown transform needs (the first step is the action itself).
  const rest: string[] = [];
  if (!v.known) {
    const m = reg.morphsTo(id).find((x) => book.has(x.from));
    const p = m ? reg.skill(m.from) : undefined;
    if (m && p) {
      const steps: string[] = [];
      if (book.rank(p.id) < p.maxRank) steps.push(`Reach ${p.name} rank ${p.maxRank}`);
      for (const r of m.requires ?? []) if (!book.meets(r)) steps.push(reqStep(reg, book, r, p.id));
      if (book.rank(p.id) >= p.maxRank && (book.progress(p.id)?.charges ?? 0) <= 0) steps.push(`Fill the Mastery bar of ${p.name}`);
      rest.push(...steps.slice(1).map(sentence));
    }
  }
  // Details: plain label / value rows (the old detail view, in friendly words).
  const details = [...v.details];
  if (v.known && sk && prog) {
    details.unshift({ label: 'Rank', value: `${prog.rank} of ${sk.maxRank}${prog.rank >= sk.maxRank ? ' · Mastery bar' : ''}` });
    const unlocks = safeUnlocks(ctrl);
    if (unlocks.fusion) {
      const need = fusionMinRank(sk.maxRank);
      details.push({ label: 'Fuse', value: prog.rank >= need ? 'Ready for the altar' : `From rank ${need}` });
    }
    if (unlocks.essences && sk.shape.kind !== 'buff') {
      const on = (sk.essences ?? []).map((e) => reg.essence(e)?.name).filter(Boolean) as string[];
      const n = book.essenceSlots(id);
      details.push({ label: 'Rune sockets', value: on.length ? on.join(', ') : n ? `${plural(n, 'empty socket')}` : 'None yet' });
    }
    const from = originText(prog.source, (kind, x) =>
      kind === 'skill' ? reg.skill(x)?.name : kind === 'monster' ? reg.monster(x)?.name : kind === 'class' ? reg.classDef(x)?.name : reg.item(x)?.name,
    );
    // 'Learned' alone (debug / unknown sources) would read "Learned · Learned": say nothing then.
    if (from && from !== 'Learned') details.push({ label: 'Learned', value: from });
    details.push({ label: 'Used', value: `${prog.uses} ${prog.uses === 1 ? 'time' : 'times'}` });
  }
  const forms = v.known
    ? book.morphOptions(id).map((o) => ({ id: o.morph.to, name: o.skill ? o.skill.name : '?', known: o.owned }))
    : [];
  return {
    id,
    kind: 'skill',
    name: v.name,
    icon,
    known: v.known,
    rank: v.rank,
    maxRank: v.maxRank,
    progress: v.progress,
    mastered: v.known && v.maxRank > 0 && v.rank >= v.maxRank,
    transformReady: v.transformReady,
    line: v.line || (sk ? firstLine(sk.desc) : ''),
    cooldown: v.cooldown,
    sp: v.sp,
    primary,
    // The small transform step under the action — also under a step (the basic attack: "Your weapon swings this by
    // itself." then "Reach rank 10 to transform."), never the same line twice.
    ...(v.next && !(primary.kind === 'step' && primary.text === v.next) && !(primary.kind === 'transform' && primary.from) ? { next: v.next } : {}),
    rest,
    details,
    forms,
    ...(alts.length ? { alts } : {}),
    ...(lockNote ? { lockNote } : {}),
  };
}

function safeUnlocks(ctrl: GameController): { fusion: boolean; essences: boolean } {
  try {
    return ctrl.unlocks();
  } catch {
    return { fusion: false, essences: false };
  }
}

/** The card's HTML (pure). Keeps `.skill-head` (and `.back` when `back`) — the playtest drives them. */
export function cardHtml(m: CardModel, o: CardOptions = {}): string {
  const unknown = m.kind === 'fog' || m.kind === 'whisper' || (m.kind === 'element' && !m.known);
  const ico = m.icon
    ? `<img class="px" src="${m.icon}" width="64" height="64" alt="" draggable="false">`
    : `<span class="sc-q" aria-hidden="true">?</span>`;
  const rated = m.kind === 'skill' && m.maxRank > 0;
  const head = `<div class="skill-head ${unknown ? 'unknown' : ''} ${!m.known && m.kind === 'skill' ? 'locked' : ''}">
      <span class="sc-ico ${m.transformReady ? 'ready' : ''} ${m.mastered ? 'mastered' : ''}">${ico}${m.transformReady ? '<i class="sc-spark" aria-hidden="true">✨</i>' : ''}</span>
      <div class="sc-id">
        <h3 class="nm">${esc(m.name)}</h3>
        ${rated && m.known ? `<div class="sc-stars ${m.mastered ? 'gold' : ''}" aria-label="Rank ${m.rank} of ${m.maxRank}">${stars(m.rank, m.maxRank)}</div><div class="sc-bar ${m.mastered ? 'over' : ''}" aria-hidden="true"><i style="width:${Math.round(m.progress * 100)}%"></i></div>` : ''}
        ${rated && !m.known ? '<div class="sc-tag">Not learned yet</div>' : ''}
        ${m.kind === 'element' ? `<div class="sc-tag">${m.known ? 'Element' : 'Not found yet'}</div>` : ''}
      </div>
    </div>`;
  const meta =
    m.kind === 'skill' && (m.cooldown || m.sp)
      ? `<p class="sc-meta">${m.cooldown ? `<span><b>⏱</b> ${m.cooldown} s</span>` : ''}${m.sp ? `<span><b class="sp">◆</b> ${m.sp} SP</span>` : ''}</p>`
      : '';
  const p = m.primary;
  const action =
    p.kind === 'equip'
      ? `<button class="sc-primary" data-act="equip">Equip</button>`
      : p.kind === 'needs'
        ? p.owned
          ? `<button class="sc-primary sc-lock" data-act="weapon" data-w="${esc(p.weapon)}">${weaponGlyph(p.weapon)}<span>${esc(lockLine(p.line, true))}</span></button>`
          : `<div class="sc-step sc-lock">${weaponGlyph(p.weapon)}<span>${esc(p.line)}. Brann sells one in Hearthvale.</span></div>`
      : p.kind === 'equipped'
        ? `<div class="sc-done" role="status">Equipped ✓<small>Slot ${p.slot + 1}</small></div>`
        : p.kind === 'class'
          ? `<div class="sc-done cls" role="status">Class skill ✓<small>Your ${esc(p.className)} uses it.</small></div>`
          : p.kind === 'transform'
            ? p.from
              ? `<button class="sc-primary gold" data-act="transform" data-from="${esc(p.from)}" data-to="${esc(p.to)}">✨ Transform<small>${esc(p.fromName ?? '')} into ${esc(p.toName)}</small></button>`
              : `<button class="sc-primary gold" data-act="transform" data-to="${esc(p.to)}">✨ Transform<small>into ${esc(p.toName)}</small></button>${
                  m.alts?.length
                    ? `<p class="sc-alt">or ${m.alts.map((f) => `<button class="sc-form known" data-star="${esc(f.id)}">${esc(f.name)}</button>`).join('')}</p>`
                    : ''
                }`
            : p.kind === 'step'
              ? `<div class="sc-step"><span class="sc-arrow" aria-hidden="true">➜</span><span>${esc(p.text)}</span>${m.rest.length ? `<button class="sc-more ${o.more ? 'open' : ''}" data-act="more" aria-expanded="${o.more ? 'true' : 'false'}" aria-label="What else?">?</button>` : ''}</div>
                 ${m.rest.length ? `<ul class="sc-rest ${o.more ? '' : 'hidden'}">${m.rest.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`
              : '';
  const rows = m.details.map((d) => `<dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd>`).join('');
  const forms = m.forms.length
    ? `<div class="sc-forms"><span>Transforms into</span>${m.forms
        .map((f) => `<button class="sc-form ${f.known ? 'known' : ''}" data-star="${esc(f.id)}">${esc(f.name)}</button>`)
        .join('')}</div>`
    : '';
  const details = rows || forms ? `<details class="sc-details"${o.details ? ' open' : ''}><summary>Details</summary>${rows ? `<dl>${rows}</dl>` : ''}${forms}</details>` : '';
  return `<div class="sc-card ${m.kind} ${m.transformReady ? 'ready' : ''}" data-card="${esc(m.id)}">
    ${o.back ? '<button class="back sc-back" data-act="back">‹ Back</button>' : ''}
    ${head}
    ${m.line ? `<p class="sc-line">${esc(m.line)}</p>` : ''}
    ${meta}
    <div class="sc-act">${action}</div>
    ${m.lockNote ? `<p class="sc-next sc-locknote">${weaponGlyph(m.lockNote.weapon)}<span>${esc(m.lockNote.line)}.</span></p>` : ''}
    ${m.next ? `<p class="sc-next">${esc(m.next)}</p>` : ''}
    ${details}
    ${o.chartLink ? `<button class="sc-link" data-act="chart">✦ See it in the Star Chart</button>` : ''}
  </div>`;
}

export interface CardHandlers {
  back?: () => void;
  /** After a successful transform (the new skill's id). */
  transformed?: (to: string) => void;
  /** A "Transforms into" chip was tapped. */
  select?: (id: string) => void;
  /** The "?" was toggled. */
  more?: (open: boolean) => void;
  /** "Details" was opened or closed. */
  details?: (open: boolean) => void;
}

/** Wires a rendered card (root = an element containing `.sc-card`). */
export function wireCard(host: PanelHost, root: ParentNode, m: CardModel, h: CardHandlers = {}): void {
  const ctrl = host.ctrl;
  const act = (name: string) => $$<HTMLButtonElement>(root, `.sc-card [data-act="${name}"]`);
  act('back').forEach((b) => b.addEventListener('click', () => h.back?.()));
  act('equip').forEach((b) =>
    b.addEventListener('click', () => {
      const r = ctrl.equipSkill(m.id);
      if (r.ok) {
        host.refresh();
        return;
      }
      // Every slot of yours is full: choose which one (the HUD's picker). Anything else: say why.
      const full = ctrl.barSlots().every((s) => s.kind !== 'own' || !!s.skillId);
      if (full) host.open('picker', `skill:${m.id}`);
      else if (r.message) host.toast(esc(r.message));
    }),
  );
  act('weapon').forEach((b) =>
    b.addEventListener('click', () => {
      const r = equipForSkill(ctrl, m.id, b.dataset.w as never);
      if (!r.ok && r.message) host.toast(esc(r.message));
      host.refresh();
    }),
  );
  act('transform').forEach((b) =>
    b.addEventListener('click', () => {
      const to = b.dataset.to!;
      // A form's own card transforms its parent (data-from); a ready star's card transforms itself.
      ctrl.morph(b.dataset.from || m.id, to);
      if (ctrl.book.has(to)) h.transformed?.(to);
      else host.refresh();
    }),
  );
  $$<HTMLDetailsElement>(root, '.sc-card .sc-details').forEach((d) => d.addEventListener('toggle', () => h.details?.(d.open)));
  act('more').forEach((b) =>
    b.addEventListener('click', () => {
      const list = (b.closest('.sc-act') ?? root).querySelector('.sc-rest');
      const open = !(list?.classList.toggle('hidden') ?? true);
      b.classList.toggle('open', open);
      b.setAttribute('aria-expanded', String(open));
      h.more?.(open);
    }),
  );
  act('chart').forEach((b) => b.addEventListener('click', () => host.open('skills', `star:${m.id}`)));
  $$<HTMLButtonElement>(root, '.sc-card [data-star]').forEach((b) => b.addEventListener('click', () => h.select?.(b.dataset.star!)));
}

/** A real open of the 'skill' panel (ui.open emits uiOpen before rendering): "?" and Details start closed again. */
let cardOpened = false;
gameBus.on('uiOpen', (e) => {
  if (e.panel === 'skill') cardOpened = true;
});

/** Panel 'skill' (arg: skill id or 'el:<id>'): the card on its own sheet (HUD class slots, Codex, altar, Pursuits). */
export function renderSkillCard(host: PanelHost, id?: string): void {
  const ctrl = host.ctrl;
  const sid = id ?? '';
  if (cardOpened) {
    cardOpened = false;
    delete host.state['skill.more'];
    delete host.state['skill.details'];
  }
  // The star as the chart shows it: a '?' star (hidden by a world secret, or a whispered fusion) stays a '?' here too —
  // e.g. a "?" form tapped in Details must not reveal its name.
  let star: StarView | undefined;
  try {
    star = ctrl.starChartData().stars.find((s) => s.id === sid);
  } catch {
    star = undefined;
  }
  const m = cardModel(ctrl, sid, star);
  const open = host.state['skill.more'] === sid;
  const det = host.state['skill.details'] === sid;
  // "See it in the Star Chart" only for a star the chart actually draws (and not for an unknown element).
  const link = !!star && (m.kind !== 'element' || m.known);
  const body = host.sheet(m.kind === 'element' ? 'Element' : 'Skill', cardHtml(m, { more: open, chartLink: link, details: det }), 'skcard-sheet');
  wireCard(host, body, m, {
    transformed: (to) => host.open('skill', to),
    select: (to) => host.open('skill', to),
    more: (o) => {
      if (o) host.state['skill.more'] = sid;
      else delete host.state['skill.more'];
    },
    details: (o) => {
      if (o) host.state['skill.details'] = sid;
      else if (host.state['skill.details'] === sid) delete host.state['skill.details'];
    },
  });
}
