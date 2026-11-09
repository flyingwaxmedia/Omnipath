// Fusion panel (docs/CLIENT-v2.md §7): fusing only takes at an altar (controller.atAltar(); elsewhere the panel plans
// and explains where altars stand). Tabs Elements | Skills | Essences, two sockets, live legality checks, the
// remembered-pair memory (per pair and per ingredient against the socketed one), a result card and whispers.
//
// Spoiler rule: for an UNTRIED pair the panel only states recipe-independent rules (element slots, essence fit,
// shape-merge eligibility) — never whether an authored recipe exists or what it makes. resolveFusion() is used only
// for public failures (same / missing / rank) and to explain pairs the player has already tried.
import { canApplyEssence, elementSlotState, mergeBlocker } from '../../core/compose';
import { resolveFusion, type FusionContext } from '../../core/fusion';
import { fusionMinRank } from '../../core/mastery';
import { pairKey, parseRef } from '../../core/refs';
import type { FuseResult, IngredientEntry } from '../../core/skillbook';
import type { EssenceDef, IngredientRef } from '../../core/types';
import { $, $$, esc } from '../util';
import { sheet } from './skills';
import { type PanelHost, tab, tabsHtml, wireTabs } from './common';

const ALTAR_TOWNS = '<b>Hearthvale</b>, the <b>Emberwatch</b> outpost and <b>Riftmarch</b>';

type Line = { kind: 'ok' | 'no' | 'info' | 'mem' | 'good'; text: string };

interface Stored {
  res: FuseResult;
  a: IngredientRef;
  b: IngredientRef;
  /** Animate the card only on its first render. */
  fresh?: boolean;
}

function sockets(host: PanelHost): (string | null)[] {
  let s = host.state['altar.slots'] as (string | null)[] | undefined;
  if (!s) host.state['altar.slots'] = s = [null, null];
  return s;
}

/** The FusionContext the SkillBook would use, built from its public API (for resolveFusion previews). */
function fusionCtx(host: PanelHost): FusionContext {
  const { book } = host.ctrl;
  return {
    has: (id) => book.has(id),
    rank: (id) => book.rank(id),
    hasElement: (id) => book.hasElement(id),
    essenceCount: (id) => book.state.essences[id] ?? 0,
    overBars: (id) => book.progress(id)?.overBars ?? 0,
    meets: (r) => book.meets(r),
  };
}

/** Live legality for the socketed pair. `block` disables Fuse (public failures only). */
function preview(host: PanelHost, a: IngredientRef, b: IngredientRef): { lines: Line[]; block: string | null } {
  const { book, reg } = host.ctrl;
  const out = resolveFusion(reg, fusionCtx(host), a, b);
  if (!out.ok && (out.reason === 'same' || out.reason === 'missing' || out.reason === 'rank')) {
    return { lines: [{ kind: 'no', text: out.message }], block: out.message };
  }
  const lines: Line[] = [];
  const mem = book.rememberedPair(a, b);
  if (mem === 'discovered') {
    if (out.ok) {
      const known = parseRef(out.result).kind === 'skill' ? book.has(parseRef(out.result).id) : true;
      lines.push({ kind: 'good', text: `You made ${reg.refIcon(out.result)} ${esc(reg.refName(out.result))} from this before${known ? '' : ' — and could again'}.` });
    } else lines.push({ kind: 'mem', text: `This once worked, but now: ${esc(out.message)}` });
  } else if (mem === 'nothing') {
    lines.push(
      out.ok
        ? { kind: 'mem', text: 'You tried this before and nothing came of it — but something in you has changed since.' }
        : { kind: 'mem', text: `Tried before: ${esc(out.message)}` },
    );
  } else {
    lines.push(...ruleLines(host, a, b));
    lines.push({ kind: 'info', text: 'Untried. The altar keeps its secrets until you try.' });
  }
  const pa = parseRef(a);
  const pb = parseRef(b);
  const ess = pa.kind === 'mod' ? reg.essence(pa.id) : pb.kind === 'mod' ? reg.essence(pb.id) : undefined;
  if (ess && mem !== 'discovered') lines.push({ kind: 'info', text: `${ess.icon} ${esc(ess.name)} is used up only if something is made.` });
  return { lines, block: null };
}

/** Recipe-independent rules for an untried pair (never reveals whether an authored recipe exists). */
function ruleLines(host: PanelHost, a: IngredientRef, b: IngredientRef): Line[] {
  const { book, reg } = host.ctrl;
  const pa = parseRef(a);
  const pb = parseRef(b);
  const [x, y] = pa.kind === 'skill' ? [pa, pb] : [pb, pa];
  if (x.kind === 'skill') {
    const s = reg.skill(x.id)!;
    if (y.kind === 'el') {
      const el = reg.element(y.id)!;
      const slot = elementSlotState(reg, s);
      if (slot === 'bound') {
        return [{ kind: 'no', text: s.element ? `${esc(s.name)} is bound to ${esc(reg.element(s.element)?.name ?? s.element)}; its slot will not take ${esc(el.name)}.` : `${esc(s.name)} has no element slot.` }];
      }
      if (s.element === y.id) return [{ kind: 'no', text: `${esc(s.name)} already carries ${esc(el.name)}.` }];
      return [
        slot === 'free'
          ? { kind: 'ok', text: `${esc(s.name)} has a free element slot for ${el.icon} ${esc(el.name)}.` }
          : { kind: 'ok', text: `${esc(s.name)} may swap its element for ${el.icon} ${esc(el.name)}, keeping its essences.` },
      ];
    }
    if (y.kind === 'mod') {
      const ess = reg.essence(y.id)!;
      const applied = (s.essences ?? []).map((e) => reg.essence(e)).filter((e): e is EssenceDef => !!e);
      const slots = book.essenceSlots(s.id);
      const check = canApplyEssence(s, ess, slots, applied);
      return [
        check.ok
          ? { kind: 'ok', text: `${ess.icon} ${esc(ess.name)} fits ${esc(s.name)} (${s.shape.kind} · ${applied.length + 1}/${slots} essence slot${slots > 1 ? 's' : ''}).` }
          : { kind: 'no', text: esc(check.message) },
      ];
    }
    if (y.kind === 'skill') {
      const t = reg.skill(y.id)!;
      const blocker = mergeBlocker(s, t);
      return [
        blocker
          ? { kind: 'no', text: `No shape merge: ${esc(blocker)}` }
          : { kind: 'ok', text: 'These two could shape-merge: the stronger shape leads, the other adds a rider.' },
      ];
    }
  }
  if (pa.kind === 'el' && pb.kind === 'el') return [{ kind: 'info', text: 'Two elements answer only to an old union — or resonate within you.' }];
  return [{ kind: 'no', text: 'An essence needs a technique to shape.' }];
}

function resultCard(host: PanelHost, st: Stored): string {
  const { reg, book } = host.ctrl;
  const r = st.res;
  const fresh = st.fresh ? 'fresh' : '';
  st.fresh = false;
  if (!r.ok) {
    return `<div class="fres bad ${fresh}"><span class="ico">💨</span><div><b>Nothing takes shape</b><small>${esc(r.message)}</small>
      ${r.hint ? `<p class="whisper">“${esc(r.hint)}”</p>` : ''}</div></div>`;
  }
  const kind = r.kind === 'authored' ? 'Discovery' : r.kind === 'merge' ? 'Shape fusion' : r.kind === 'essence' ? 'Essence variant' : 'Infusion';
  const p = parseRef(r.result);
  const s = p.kind === 'skill' ? reg.skill(p.id) : undefined;
  return `<div class="fres good ${r.isNew ? 'new' : ''} ${fresh}">
    <span class="ico">${reg.refIcon(r.result)}</span>
    <div><small class="kick">${r.isNew ? `NEW ${kind.toUpperCase()}` : 'ALREADY KNOWN'}</small><b>${esc(r.name)}</b>
      <small>${esc(reg.refName(st.a))} + ${esc(reg.refName(st.b))}${r.consumed ? ` · used 1 ${esc(reg.essence(r.consumed)?.name ?? r.consumed)}` : ''}</small>
      ${s ? `<small>${esc(s.desc)}</small>` : ''}
      ${s && book.has(s.id) ? `<button class="btn" data-view="${esc(s.id)}">View skill ›</button>` : ''}</div></div>`;
}

export function renderAltar(host: PanelHost): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const at = ctrl.atAltar();
  const socks = sockets(host);
  const [a, b] = socks;
  const ings = book.ingredients();
  const t = tab(host, 'altar.tab', 'skills');
  const stored = host.state['altar.result'] as Stored | undefined;

  const sockHtml = (ref: string | null, i: number) =>
    ref
      ? `<button class="fsock full" data-fslot="${i}" aria-label="Remove ${esc(reg.refName(ref))}"><span class="ico">${reg.refIcon(ref)}</span><small>${esc(reg.refName(ref))}</small><i class="rm">✕</i></button>`
      : `<button class="fsock" data-fslot="${i}" aria-label="Empty socket"><span class="ico">◇</span><small>${i ? 'Second' : 'First'}</small></button>`;

  let lines: Line[] = [];
  let block: string | null = null;
  if (a && b) ({ lines, block } = preview(host, a, b));
  else lines = [{ kind: 'info', text: a || b ? 'Choose a second ingredient below.' : 'Place two ingredients: a skill and an element, a skill and an essence, two skills, or two elements.' }];
  const canFuse = !!a && !!b && at && !block;
  const fuseLabel = !at ? 'Altar needed' : !a || !b ? 'Fuse' : block ? 'Cannot fuse' : 'Fuse';

  // Memory badges against the one socketed ingredient.
  const anchor = (a && !b) || (!a && b) ? (a ?? b) : null;
  const memOf = (ref: string): string => {
    if (!anchor || ref === anchor) return '';
    const m = book.rememberedPair(anchor, ref);
    return m === 'discovered' ? '<i class="mem made" title="Made something together">✓</i>' : m === 'nothing' ? '<i class="mem tried" title="Tried together">○</i>' : '';
  };
  const list = (entries: IngredientEntry[]) =>
    entries
      .map((i) => {
        const p = parseRef(i.ref);
        const s = p.kind === 'skill' ? reg.skill(p.id) : undefined;
        const inUse = socks.includes(i.ref);
        const badge = s
          ? `<span class="rk">${i.ready ? 'R' + book.rank(s.id) : '🔒R' + fusionMinRank(s.maxRank)}</span>`
          : i.count !== undefined
            ? `<span class="rk cnt">×${i.count}</span>`
            : '';
        return `<button class="ing ${i.ready ? '' : 'locked'} ${inUse ? 'inuse' : ''}" data-ref="${esc(i.ref)}" title="${esc(i.message ?? i.name)}">
          <span class="ico">${i.icon}</span><small>${esc(i.name)}</small>${badge}${memOf(i.ref)}</button>`;
      })
      .join('');
  const empty: Record<string, string> = {
    elements: 'No elements attuned yet. Elements are found by doing things: forging, fishing, mining, meditating, hunting wardens.',
    skills: 'No skills yet.',
    essences: 'No essences held. Monsters drop the essence of what they do; trainers sell some.',
  };
  const skills = [...ings.skills].sort((x, y) => Number(y.ready) - Number(x.ready));
  const entries = t === 'elements' ? ings.elements : t === 'essences' ? ings.essences : skills;

  // Whispers already heard about what is on the altar (never new information).
  const heard = new Set(book.state.hints);
  const about = [...new Set(socks.filter((r): r is string => !!r).flatMap((r) => reg.recipesWith(r)))]
    .filter((r) => r.hint && heard.has(r.hint) && !book.state.discoveries.includes(pairKey(r.a, r.b)))
    .map((r) => r.hint!);
  const recent = book.state.hints.slice(-3).reverse().filter((h) => !about.includes(h));
  const stats = book.stats();

  const body = `
    ${
      at
        ? ''
        : `<div class="away"><span class="ico">⚗️</span><div><b>Fusion only takes at an altar.</b>
            <small>Altars stand in ${ALTAR_TOWNS}. You can plan here; the Fuse button wakes when you stand beside one.</small></div></div>`
    }
    <div class="altar-split">
      <div class="altar-left">
        <div class="altar-stage ${a && b ? 'armed' : ''}">
          ${sockHtml(a, 0)}
          <span class="core" aria-hidden="true"><i></i></span>
          ${sockHtml(b, 1)}
        </div>
        <ul class="fcheck">${lines.map((l) => `<li class="${l.kind}">${l.kind === 'ok' ? '✓' : l.kind === 'no' ? '✗' : l.kind === 'good' ? '★' : l.kind === 'mem' ? '◷' : '·'} <span>${l.text}</span></li>`).join('')}</ul>
        <button class="btn gold fuse" ${canFuse ? '' : 'disabled'}>⚗️ ${fuseLabel}</button>
        <div class="fuse-result">${stored ? resultCard(host, stored) : ''}</div>
      </div>
      <div class="altar-right">
        ${tabsHtml(
          'altar.tab',
          [
            ['elements', `Elements · ${ings.elements.length}`],
            ['skills', `Skills · ${ings.skills.length}`],
            ['essences', `Essences · ${ings.essences.length}`],
          ],
          t,
        )}
        ${anchor ? `<p class="memleg">Against ${reg.refIcon(anchor)} <b>${esc(reg.refName(anchor))}</b>: <i class="mem made">✓</i> made something · <i class="mem tried">○</i> tried</p>` : ''}
        ${entries.length ? `<div class="ings">${list(entries)}</div>` : `<p class="sub">${empty[t]}</p>`}
        ${t === 'skills' ? `<p class="sub">Skills join the altar at rank ${fusionMinRank(99)} (or their max rank). Ingredients are never used up — only essences, and only on success.</p>` : ''}
        ${about.length ? `<h3>Whispers about these</h3>${about.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
        ${recent.length ? `<h3>Recent whispers</h3>${recent.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
      </div>
    </div>
    <p class="foot">${stats.discoveries} discoveries from ${stats.experiments} experiments</p>`;
  sheet(host, '⚗️ Fusion Altar', body, 'fusion wide');
  wireTabs(host, 'altar.tab');

  const changed = () => {
    delete host.state['altar.result'];
    host.render();
  };
  $$<HTMLButtonElement>(host.modal, '[data-fslot]').forEach((btn) =>
    btn.addEventListener('click', () => {
      socks[Number(btn.dataset.fslot)] = null;
      changed();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '.ing').forEach((btn) =>
    btn.addEventListener('click', () => {
      const ref = btn.dataset.ref!;
      if (btn.classList.contains('locked')) {
        host.toast(esc(btn.title));
        return;
      }
      const i = socks.indexOf(ref);
      if (i >= 0) socks[i] = null;
      else {
        const e = socks.indexOf(null);
        socks[e >= 0 ? e : 1] = ref;
      }
      changed();
    }),
  );
  $$<HTMLButtonElement>(host.modal, '[data-view]').forEach((btn) => btn.addEventListener('click', () => host.open('skills', btn.dataset.view!)));
  const fuseBtn = $<HTMLButtonElement>(host.modal, '.fuse');
  fuseBtn.addEventListener('click', () => {
    if (!a || !b || !canFuse) return;
    fuseBtn.disabled = true;
    $(host.modal, '.altar-stage').classList.add('fusing');
    setTimeout(() => {
      const res = ctrl.fuse(a, b);
      socks[0] = socks[1] = null;
      host.state['altar.result'] = { res, a, b, fresh: true } satisfies Stored;
      host.render();
      // The world stays paused; make sure the card is in view on small screens.
      host.modal.querySelector('.fres')?.scrollIntoView({ block: 'nearest' });
    }, 700);
  });
}
