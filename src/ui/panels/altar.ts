// Fuse panel (panels lane; docs/UX-SIMPLE.md): fusing only takes at an altar (controller.atAltar(); elsewhere the
// panel plans and says where altars stand). Two sockets, ONE line about the pair (the reason sits behind "Details"),
// ONE big Fuse button, the ingredients as pixel tiles (Skills | Elements | Essences — essences once you own one),
// ✓ / ○ marks for pairs you already tried, and the result card. Words stay plain: no slots, shapes or merge rules.
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
import { oneLine } from '../words';
import { sheet } from './skills';
import { type PanelHost, detailsHtml, refIconHtml, tab, tabsHtml, wireTabs, wireToggles } from './common';

const ALTAR_TOWNS = '<b>Hearthvale</b>, <b>Emberwatch</b> or <b>Riftmarch</b>';

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
      lines.push({ kind: 'good', text: `You made <b>${esc(reg.refName(out.result))}</b> from these before${known ? '.' : ' — make it again!'}` });
    } else lines.push({ kind: 'mem', text: `This worked before, but not right now: ${esc(out.message)}` });
  } else if (mem === 'nothing') {
    lines.push(
      out.ok
        ? { kind: 'mem', text: 'Nothing happened last time — but you have grown since.' }
        : { kind: 'mem', text: `Tried before: ${esc(out.message)}` },
    );
  } else {
    lines.push(...ruleLines(host, a, b));
  }
  const pa = parseRef(a);
  const pb = parseRef(b);
  const ess = pa.kind === 'mod' ? reg.essence(pa.id) : pb.kind === 'mod' ? reg.essence(pb.id) : undefined;
  if (ess && mem !== 'discovered') lines.push({ kind: 'info', text: `Uses 1 ${esc(ess.name)} only if it works.` });
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
        return [{ kind: 'no', text: s.element ? `${esc(s.name)} keeps its own element.` : `${esc(s.name)} can’t take an element.` }];
      }
      if (s.element === y.id) return [{ kind: 'no', text: `${esc(s.name)} already has ${esc(el.name)}.` }];
      return [
        slot === 'free'
          ? { kind: 'ok', text: `${esc(s.name)} can take ${esc(el.name)}.` }
          : { kind: 'ok', text: `${esc(s.name)} can trade its element for ${esc(el.name)}.` },
      ];
    }
    if (y.kind === 'mod') {
      const ess = reg.essence(y.id)!;
      const applied = (s.essences ?? []).map((e) => reg.essence(e)).filter((e): e is EssenceDef => !!e);
      const slots = book.essenceSlots(s.id);
      const check = canApplyEssence(s, ess, slots, applied);
      return [
        check.ok
          ? { kind: 'ok', text: `${esc(ess.name)} fits ${esc(s.name)}.` }
          : { kind: 'no', text: `${esc(ess.name)} doesn’t fit ${esc(s.name)}${slots && applied.length >= slots ? ' (no free Rune socket)' : ''}.` },
      ];
    }
    if (y.kind === 'skill') {
      const t = reg.skill(y.id)!;
      const blocker = mergeBlocker(s, t);
      return [
        blocker
          ? { kind: 'no', text: 'These two skills don’t combine.' }
          : { kind: 'ok', text: 'These two skills could combine into one.' },
      ];
    }
  }
  if (pa.kind === 'el' && pb.kind === 'el') return [{ kind: 'ok', text: 'Two elements might make something new.' }];
  return [{ kind: 'no', text: 'An essence needs a skill.' }];
}

/** The pair's ONE line (the first and most useful thing), plus the rest for "Details". */
function pairLine(lines: Line[], a: string | null, b: string | null): { main: Line; more: Line[] } {
  if (!a || !b) return { main: { kind: 'info', text: a || b ? 'Now pick a second one.' : 'Pick two things below to fuse.' }, more: [] };
  const no = lines.find((l) => l.kind === 'no');
  if (no) return { main: no, more: [] };
  const good = lines.find((l) => l.kind === 'good');
  if (good) return { main: good, more: [] };
  const mem = lines.find((l) => l.kind === 'mem');
  if (mem) return { main: { kind: 'mem', text: 'You tried this before.' }, more: lines.filter((l) => l !== mem).concat(mem) };
  return { main: { kind: 'ok', text: 'Try it and see what happens!' }, more: lines.filter((l) => l.kind !== 'info') };
}

function resultCard(host: PanelHost, st: Stored): string {
  const { reg, book } = host.ctrl;
  const r = st.res;
  const fresh = st.fresh ? 'fresh' : '';
  st.fresh = false;
  if (!r.ok) {
    return `<div class="fres bad ${fresh}"><span class="ico">💨</span><div><b>Nothing happened</b><small>Try another pair.</small>
      ${r.hint ? `<p class="whisper">“${esc(r.hint)}”</p>` : ''}</div></div>`;
  }
  const p = parseRef(r.result);
  const s = p.kind === 'skill' ? reg.skill(p.id) : undefined;
  const el = p.kind === 'el' ? reg.element(p.id) : undefined;
  return `<div class="fres good ${r.isNew ? 'new' : ''} ${fresh}">
    <span class="ico">${refIconHtml(host.ctrl, r.result, reg.refIcon(r.result), 48)}</span>
    <div><small class="kick">${r.isNew ? 'NEW!' : 'MADE BEFORE'}</small><b>${esc(r.name)}</b>
      ${s ? `<small>${esc(oneLine(s.desc))}</small>` : el ? `<small>${esc(oneLine(el.desc))}</small>` : ''}
      ${r.consumed ? `<small>Used 1 ${esc(reg.essence(r.consumed)?.name ?? '')}</small>` : ''}
      ${s && book.has(s.id) ? `<button class="btn" data-view="${esc(s.id)}">See skill</button>` : ''}</div></div>`;
}

export function renderAltar(host: PanelHost): void {
  const { ctrl } = host;
  const { book, reg } = ctrl;
  const at = ctrl.atAltar();
  const socks = sockets(host);
  const [a, b] = socks;
  const ings = book.ingredients();
  const essOn = ctrl.unlocks().essences || ings.essences.length > 0;
  let t = tab(host, 'altar.tab', 'skills');
  if (t === 'essences' && !essOn) t = 'skills';
  const stored = host.state['altar.result'] as Stored | undefined;

  const sockHtml = (ref: string | null, i: number) =>
    ref
      ? `<button class="fsock full" data-fslot="${i}" aria-label="Remove ${esc(reg.refName(ref))}">${refIconHtml(ctrl, ref, reg.refIcon(ref), 48)}<small>${esc(reg.refName(ref))}</small><i class="rm">✕</i></button>`
      : `<button class="fsock" data-fslot="${i}" aria-label="Empty"><span class="ico">＋</span><small>${i ? 'Second' : 'First'}</small></button>`;

  let lines: Line[] = [];
  let block: string | null = null;
  if (a && b) ({ lines, block } = preview(host, a, b));
  const { main, more } = pairLine(lines, a, b);
  const canFuse = !!a && !!b && at && !block;
  const fuseLabel = !at ? 'Fuse at an altar' : 'Fuse';

  // ✓ / ○ marks against the one socketed ingredient.
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
          ? i.ready
            ? ''
            : `<span class="rk">🔒 Rank ${fusionMinRank(s.maxRank)}</span>`
          : i.count !== undefined
            ? `<span class="rk cnt">×${i.count}</span>`
            : '';
        return `<button class="ing ${i.ready ? '' : 'locked'} ${inUse ? 'inuse' : ''}" data-ref="${esc(i.ref)}" data-why="${esc(
          s && !i.ready ? `Reach rank ${fusionMinRank(s.maxRank)} with ${s.name} to fuse it.` : '',
        )}">${refIconHtml(ctrl, i.ref, i.icon, 32)}<small>${esc(i.name)}</small>${badge}${memOf(i.ref)}</button>`;
      })
      .join('');
  const empty: Record<string, string> = {
    elements: 'No elements yet. Quests and the world will teach you some.',
    skills: 'No skills yet.',
    essences: 'No essences yet. Monsters drop them.',
  };
  const skills = [...ings.skills].sort((x, y) => Number(y.ready) - Number(x.ready));
  const entries = t === 'elements' ? ings.elements : t === 'essences' ? ings.essences : skills;
  const tabs: [string, string][] = [
    ['skills', `Skills`],
    ['elements', `Elements`],
    ...(essOn ? ([['essences', 'Essences']] as [string, string][]) : []),
  ];

  // Whispers already heard about what is on the altar (never new information).
  const heard = new Set(book.state.hints);
  const about = [...new Set(socks.filter((r): r is string => !!r).flatMap((r) => reg.recipesWith(r)))]
    .filter((r) => r.hint && heard.has(r.hint) && !book.state.discoveries.includes(pairKey(r.a, r.b)))
    .map((r) => r.hint!)
    .slice(0, 2);
  const made = book.stats().discoveries;
  const mark = (k: Line['kind']) => (k === 'no' ? '✗' : k === 'good' ? '★' : k === 'mem' ? '○' : k === 'ok' ? '✓' : '·');

  const body = `
    ${at ? '' : `<div class="away small"><span class="ico">⚗️</span><div><b>Fuse at a Fusion Altar</b><small>${ALTAR_TOWNS}. You can plan here.</small></div></div>`}
    <div class="altar-split">
      <div class="altar-left">
        <div class="altar-stage ${a && b ? 'armed' : ''}">
          ${sockHtml(a, 0)}
          <span class="core" aria-hidden="true"><i></i></span>
          ${sockHtml(b, 1)}
        </div>
        <p class="fline ${main.kind}"><i>${mark(main.kind)}</i> <span>${main.text}</span></p>
        ${detailsHtml(more.length ? `<ul class="fcheck">${more.map((l) => `<li class="${l.kind}">${mark(l.kind)} <span>${l.text}</span></li>`).join('')}</ul>` : '')}
        <button class="btn gold big fuse" ${canFuse ? '' : 'disabled'}>⚗️ ${fuseLabel}</button>
        <div class="fuse-result">${stored ? resultCard(host, stored) : ''}</div>
      </div>
      <div class="altar-right">
        ${tabsHtml('altar.tab', tabs, t)}
        ${anchor && entries.some((e) => memOf(e.ref)) ? `<p class="memleg"><i class="mem made">✓</i> made something · <i class="mem tried">○</i> tried</p>` : ''}
        ${entries.length ? `<div class="ings">${list(entries)}</div>` : `<p class="sub">${empty[t]}</p>`}
        ${about.length ? `<h3>Whispers</h3>${about.map((h) => `<p class="whisper">“${esc(h)}”</p>`).join('')}` : ''}
      </div>
    </div>
    ${made ? `<p class="foot">${made} thing${made === 1 ? '' : 's'} made so far</p>` : ''}`;
  sheet(host, '⚗️ Fuse', body, 'fusion wide');
  wireTabs(host, 'altar.tab');
  wireToggles(host.modal);

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
        if (btn.dataset.why) host.toast(esc(btn.dataset.why));
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
  $$<HTMLButtonElement>(host.modal, '[data-view]').forEach((btn) => btn.addEventListener('click', () => host.open('skill', btn.dataset.view!)));
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
